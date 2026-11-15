'use strict';
/**
 * MIDI BGM 播放器（web/js/midibgm.js）—— 补上原版 BGM 的「播放管线」。
 *
 * 【为什么需要它】
 *   原版 BGM 是 `sound\*.mid`（`*label_0069` 7400-7460：`mmload/mmplay` 或
 *   `DMLOADFNAME/DMPLAY`，文件名来自 `user\music\musiclist.txt` 的
 *   `文件名 <TAB> 曲名` 映射，6870-6884）。现代浏览器既没有 MIDI 合成器也没有
 *   `mmplay`，所以此前只能拿同名环境音 wav 顶替（见 audio.js 头部说明）。
 *   素材本身一直在 `web/assets/sound/`（83 首 .mid），缺的只是「解析 + 合成」。
 *
 * 【实现】纯前端、零依赖：
 *   1. `parseSMF()`：解析标准 MIDI 文件（MThd / MTrk、可变长度 delta、
 *      running status、meta 0x51 变速、0x2F 结束）。
 *   2. `buildTimeline()`：把所有轨道合并成按秒排序的音符表（含 tempo map）。
 *   3. `play()`：用 WebAudio 的 OscillatorNode/GainNode 实时合成 ——
 *      按 GM 音色号归到几种波形，通道 10（index 9）当打击乐（噪声 + 低频正弦）。
 *
 * 【与原版的差异】不是 Roland SC-88 的音色，只是「能听出是同一首曲子」的合成，
 *   登记在 17 册 A36 行（音色近似，音符/节拍/循环与原曲一致）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  // ---------------------------------------------------------------- 解析

  function u32(b, p) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }
  function u16(b, p) { return (b[p] << 8) + b[p + 1]; }
  function str4(b, p) { return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]); }

  /** 读可变长度整数（每字节 7 位，最高位为继续标志） */
  function varint(b, p) {
    let v = 0, n = 0, c;
    do { c = b[p + n]; v = (v << 7) | (c & 0x7f); n++; } while ((c & 0x80) && n < 5);
    return { value: v >>> 0, next: p + n };
  }

  /**
   * 解析 SMF。
   * @returns {{format:number, division:number, tracks:Array<Array<object>>}|null}
   *   事件：{tick, type:'on'|'off'|'prog'|'tempo', ch, note, vel, prog, us}
   */
  function parseSMF(buffer) {
    const b = new Uint8Array(buffer);
    if (b.length < 14 || str4(b, 0) !== 'MThd') return null;
    const hlen = u32(b, 4);
    const format = u16(b, 8);
    const ntrks = u16(b, 10);
    const division = u16(b, 12);
    const tracks = [];
    let p = 8 + hlen;
    for (let k = 0; k < ntrks && p + 8 <= b.length; k++) {
      if (str4(b, p) !== 'MTrk') break;
      const len = u32(b, p + 4);
      const end = Math.min(b.length, p + 8 + len);
      let q = p + 8;
      let tick = 0, status = 0;
      const evs = [];
      while (q < end) {
        const d = varint(b, q); tick += d.value; q = d.next;
        if (q >= end) break;
        let st = b[q];
        if (st & 0x80) { status = st; q++; }
        else st = status;                       // running status
        if (!st) break;
        const hi = st & 0xf0, ch = st & 0x0f;
        if (hi === 0x90 || hi === 0x80) {
          const note = b[q], vel = b[q + 1]; q += 2;
          if (hi === 0x80 || vel === 0) evs.push({ tick, type: 'off', ch, note });
          else evs.push({ tick, type: 'on', ch, note, vel });
        } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
          q += 2;
        } else if (hi === 0xc0) {
          evs.push({ tick, type: 'prog', ch, prog: b[q] });
          q += 1;
        } else if (hi === 0xd0) {
          q += 1;
        } else if (st === 0xff) {
          const mt = b[q]; q++;
          const l = varint(b, q); q = l.next;
          if (mt === 0x51 && l.value === 3) {
            const us = (b[q] << 16) + (b[q + 1] << 8) + b[q + 2];
            evs.push({ tick, type: 'tempo', us });
          }
          q += l.value;
          if (mt === 0x2f) break;
        } else if (st === 0xf0 || st === 0xf7) {
          const l = varint(b, q); q = l.next + l.value;
        } else {
          q++;                                  // 未知状态：跳过 1 字节，避免死循环
        }
      }
      tracks.push(evs);
      p += 8 + len;
    }
    return { format, division, tracks };
  }

  /**
   * 把轨道合并成「秒」为单位的音符表。
   * @returns {{notes:Array, duration:number, programs:object}}
   *   notes: {start, dur, note, ch, prog, vel}
   */
  function buildTimeline(smf) {
    if (!smf || !smf.tracks || !smf.tracks.length) return { notes: [], duration: 0 };
    // SMPTE 时基：division 高字节为负帧率 —— 极少见，按 25fps 处理
    const ppq = (smf.division & 0x8000)
      ? ((smf.division & 0x7f) ? (smf.division & 0x7f) : 25) * ((240 - (smf.division >> 8)) || 1)
      : (smf.division || 96);
    const fixed = !!(smf.division & 0x8000);

    // 1) 收集所有 tempo 事件（多轨时以 format 1 的第 0 轨为主，其余也合并）
    const tempos = [];
    for (const tr of smf.tracks) {
      for (const e of tr) if (e.type === 'tempo') tempos.push(e);
    }
    tempos.sort((a, b) => a.tick - b.tick);
    const tempoAt = [];
    let lastUs = 500000, lastTick = 0, lastSec = 0;
    tempoAt.push({ tick: 0, sec: 0, us: 500000 });
    for (const t of tempos) {
      if (t.tick === 0) { lastUs = t.us; tempoAt[0] = { tick: 0, sec: 0, us: t.us }; continue; }
      lastSec += fixed ? (t.tick - lastTick) / ppq
        : ((t.tick - lastTick) * lastUs) / (ppq * 1e6);
      lastTick = t.tick; lastUs = t.us;
      tempoAt.push({ tick: t.tick, sec: lastSec, us: t.us });
    }
    function toSec(tick) {
      let lo = tempoAt[0];
      for (const seg of tempoAt) { if (seg.tick <= tick) lo = seg; else break; }
      return fixed ? tick / ppq : lo.sec + ((tick - lo.tick) * lo.us) / (ppq * 1e6);
    }

    // 2) 程序号（每通道最后一次赋值，用于选波形）
    const programs = {};
    for (const tr of smf.tracks) {
      for (const e of tr) if (e.type === 'prog') programs[e.ch] = e.prog;
    }

    // 3) 匹配 note on/off（按通道 + 音高，先入先出）
    const notes = [];
    let duration = 0;
    for (const tr of smf.tracks) {
      const open = {};
      for (const e of tr) {
        if (e.type === 'on') {
          const k = e.ch + ':' + e.note;
          (open[k] = open[k] || []).push(e);
        } else if (e.type === 'off') {
          const k = e.ch + ':' + e.note;
          const list = open[k];
          if (!list || !list.length) continue;
          const on = list.shift();
          const s = toSec(on.tick), en = toSec(e.tick);
          notes.push({
            start: s, dur: Math.max(0.03, en - s), note: on.note,
            ch: on.ch, prog: (programs[on.ch] | 0), vel: on.vel,
          });
          if (en > duration) duration = en;
        }
      }
      // 没收到 note off 的音符按 0.5 秒截断（避免挂音）
      for (const k in open) {
        for (const on of open[k]) {
          const s = toSec(on.tick);
          notes.push({ start: s, dur: 0.5, note: on.note, ch: on.ch, prog: (programs[on.ch] | 0), vel: on.vel });
          if (s + 0.5 > duration) duration = s + 0.5;
        }
      }
    }
    notes.sort((a, b) => a.start - b.start);
    return { notes, duration, programs };
  }

  // ---------------------------------------------------------------- 合成

  /** GM 音色号 → 波形（近似分组：88 号以后多为合成音色） */
  function waveOf(prog, ch) {
    if (ch === 9) return 'noise';
    const p = prog | 0;
    if (p < 8) return 'triangle';        // 钢琴
    if (p < 16) return 'triangle';       // 色彩打击
    if (p < 24) return 'sine';           // 风琴/簧风琴
    if (p < 32) return 'triangle';       // 吉他
    if (p < 40) return 'sine';           // 贝斯
    if (p < 48) return 'sawtooth';       // 弦乐
    if (p < 56) return 'sawtooth';       // 合奏
    if (p < 64) return 'square';         // 铜管
    if (p < 72) return 'square';         // 簧管
    if (p < 80) return 'sine';           // 笛
    if (p < 88) return 'sawtooth';       // 合成主音
    return 'triangle';
  }

  const NOTE_HZ = [];
  for (let i = 0; i < 128; i++) NOTE_HZ[i] = 440 * Math.pow(2, (i - 69) / 12);

  // ---------------------------------------------------------------- 播放

  let ctx = null;
  let bus = null;
  let timer = null;
  let current = null;      // {notes, duration, startedAt, index, loop, url}
  let volume = 0.45;
  let stopped = true;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function killBus() {
    if (timer) { clearInterval(timer); timer = null; }
    if (bus) {
      try { bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setValueAtTime(0, ctx.currentTime); } catch (e) { /* ignore */ }
      try { bus.disconnect(); } catch (e) { /* ignore */ }
      bus = null;
    }
    current = null;
    stopped = true;
  }

  /** 排一个音（打击乐走噪声） */
  function scheduleNote(tl, note, at) {
    const t0 = at + note.start;
    const dur = note.dur;
    const gain = (note.vel / 127) * 0.26;
    const wave = waveOf(note.prog, note.ch);
    if (wave === 'noise') {
      const n = Math.min(2048, Math.max(64, Math.floor(ctx.sampleRate * Math.min(0.08, dur))));
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = gain * 0.9;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200 + (note.note % 12) * 260;
      src.connect(bp); bp.connect(g); g.connect(bus);
      src.start(t0); src.stop(t0 + Math.min(0.12, dur + 0.02));
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = NOTE_HZ[note.note] || 440;
    const g = ctx.createGain();
    const atk = 0.012;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + atk);
    g.gain.linearRampToValueAtTime(gain * 0.7, t0 + Math.min(dur * 0.6, 0.6));
    g.gain.setTargetAtTime(0.0001, t0 + Math.max(atk, dur), 0.05);
    osc.connect(g); g.connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.12);
  }

  const LOOKAHEAD = 1.4;   // 提前排程的秒数

  function pump() {
    if (!current || !ctx) return;
    const c = current;
    const now = ctx.currentTime - c.startedAt;
    const horizon = now + LOOKAHEAD;
    // 循环：排到结尾就从头再来
    while (c.index < c.notes.length || c.loop) {
      if (c.index >= c.notes.length) {
        if (!c.loop) break;
        c.round = (c.round | 0) + 1;
        c.startedAt = ctx.currentTime - 0;
        c.index = 0;
      }
      const n = c.notes[c.index];
      if (n.start > horizon) break;
      scheduleNote(c, n, c.startedAt);
      c.index++;
    }
    if (!c.loop && c.index >= c.notes.length) {
      const left = c.duration - (ctx.currentTime - c.startedAt);
      if (left <= 0.05) killBus();
    }
  }

  const MidiBgm = {
    get supported() { return !!(global.AudioContext || global.webkitAudioContext); },
    get playing() { return !stopped && !!current; },

    /** 只解析、不播放（供 verify 脚本与调试用） */
    parse(buffer) { return buildTimeline(parseSMF(buffer)); },

    /**
     * 播放一首 .mid（循环）。
     * @param {string} url 资源 URL
     * @param {object} [opts] { loop=true, onerror }
     * @returns {Promise<boolean>} 解析成功并开始播放 → true
     */
    async play(url, opts) {
      const o = opts || {};
      const ac = ensureCtx();
      if (!ac) return false;
      killBus();
      let tl = null;
      try {
        const res = await fetch(url);
        if (!res.ok) return false;
        tl = buildTimeline(parseSMF(await res.arrayBuffer()));
      } catch (e) { return false; }
      if (!tl || !tl.notes || !tl.notes.length) return false;
      if (ac.state === 'suspended' && ac.resume) { try { await ac.resume(); } catch (e) { /* ignore */ } }
      bus = ac.createGain();
      bus.gain.value = volume;
      bus.connect(ac.destination);
      current = {
        notes: tl.notes, duration: tl.duration || 60,
        startedAt: ac.currentTime + 0.08, index: 0, round: 0,
        loop: o.loop !== false, url,
      };
      stopped = false;
      pump();
      timer = setInterval(pump, 220);
      return true;
    },

    stop() { killBus(); },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (bus) { try { bus.gain.value = volume; } catch (e) { /* ignore */ } }
    },

    getVolume() { return volume; },
  };

  Elona.MidiBgm = MidiBgm;
  // 供 Node 端的 verify 脚本直接拿解析器（不依赖 fetch / AudioContext）
  Elona.MidiParse = { parseSMF, buildTimeline };
})(typeof window !== 'undefined' ? window : globalThis);
