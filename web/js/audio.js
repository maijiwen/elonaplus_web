'use strict';
/**
 * 音频层 —— 对应 config.txt 的 (Sound) 段：sound / music / heartbeat。
 *
 * 【资源】web/assets/sound/ 下是原版 sound 目录里可直接被浏览器播放的 .wav。
 * 【重要差异】原版 BGM 是 .mid（MIDI），现代浏览器没有内建 MIDI 合成器，
 *   无法在不引入额外库的情况下播放。因此本实现：
 *     - 音效（原版 `snd N`）→ 按语义映射到同名 wav；
 *     - BGM（原版 .mid）→ 用同目录的环境音 wav（bg_town / bg_wind / bg_rain …）代替，
 *       并在差异报告中登记「BGM 未还原为 MIDI 原曲」。
 * 【心跳音】Heart1.wav 对应 config.txt 的 heartbeat（低血量时播放）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 语义名 → 候选文件（随机取一个，与原版 snd 的多个变体一致） */
  const SFX = {
    attack: ['atk1', 'atk2', 'atksword', 'attack00'],
    hit: ['tm2_hit000', 'stab'],
    miss: ['miss'],
    kill: ['kill1', 'kill2'],
    dead: ['dead1'],
    door: ['door1', 'door2'],
    locked: ['locked1'],
    pickup: ['get1', 'get2', 'get3'],
    gold: ['getgold1'],
    pay: ['paygold1'],
    eat: ['eat1'],
    drink: ['drink1'],
    read: ['book1'],
    scroll: ['scroll'],
    equip: ['equip1'],
    wear: ['wear'],
    drop: ['drop1'],
    spell: ['spell'],
    heal: ['heal1'],
    teleport: ['teleport1'],
    dig: ['dig1', 'dig2'],
    bash: ['bash1'],
    trap: ['trap1'],
    chest: ['chest1'],
    levelup: ['ding1', 'complete1'],
    feat: ['feat'],
    skill: ['skill'],
    pray: ['pray1', 'pray2'],
    offer: ['offer1', 'offer2'],
    cursor: ['cursor1'],
    cancel: ['cancel-01'],
    ok: ['ok1'],
    coin: ['ding2'],
    hurt: ['slap'],
    water: ['water'],
    wind: ['wave'],
    write: ['write1'],
    more: ['more1'],
    inv: ['inv'],
  };

  const BG = {
    town: 'bg_town', field: 'bg_wind', rain: 'bg_rain', sea: 'bg_sea',
    fire: 'bg_fire', thunder: 'bg_thunder',
  };

  const BASE = 'assets/sound/';
  const cache = {};
  let bgmEl = null;
  let bgmName = null;
  let enabled = true;
  let musicOn = true;
  let volume = 0.6;

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function el(name) {
    if (!cache[name]) {
      const a = new Audio(BASE + name + '.wav');
      a.preload = 'auto';
      cache[name] = a;
    }
    return cache[name];
  }

  const Audio2 = {
    /** 语义名播放（未知名静默忽略，避免刷日志） */
    play(name) {
      if (!enabled || volume <= 0) return null;
      const list = SFX[name];
      if (!list) return null;
      try {
        const a = el(pick(list));
        a.volume = volume;
        a.currentTime = 0;
        const p = a.play();
        if (p && p.catch) p.catch(() => { /* 浏览器策略：需用户交互后才允许播放 */ });
        return a;
      } catch (e) { return null; }
    },

    /** 原版 `snd N` 的近似映射（仅处理能确定语义的编号） */
    playIndex(n) {
      const map = {
        100: 'cursor', 101: 'cursor', 102: 'cursor',
        20: 'cancel', 22: 'ok', 23: 'ok', 24: 'coin', 44: 'levelup',
        47: 'drop', 73: 'bash',
      };
      const nm = map[n | 0];
      if (nm) return this.play(nm);
      return null;
    },

    /**
     * 按**文件名**播放音效 —— 剧情脚本的 {se} 给的是原版 wav 文件名
     * （如 "bg_wind.wav"），与 SFX 的语义名无关，故单独一个入口。
     */
    sfx(file) {
      if (!enabled || volume <= 0 || !file) return null;
      const name = String(file).replace(/\.wav$/i, '');
      try {
        const a = el(name);
        a.volume = volume;
        a.currentTime = 0;
        const p = a.play();
        if (p && p.catch) p.catch(() => { /* 浏览器策略：需用户交互后才允许播放 */ });
        return a;
      } catch (e) { return null; }
    },

    /** 环境音 / BGM（循环） */
    bgm(name) {
      const file = BG[name] || BG.town;
      if (!musicOn || volume <= 0) return;
      if (bgmName === file && bgmEl && !bgmEl.paused) return;
      this.stopBgm();
      try {
        bgmEl = new Audio(BASE + file + '.wav');
        bgmEl.loop = true;
        bgmEl.volume = volume * 0.45;
        bgmName = file;
        const p = bgmEl.play();
        if (p && p.catch) p.catch(() => { /* 自动播放被拦截时静默 */ });
      } catch (e) { bgmEl = null; }
    },

    stopBgm() {
      if (bgmEl) { try { bgmEl.pause(); } catch (e) { /* ignore */ } }
      bgmEl = null;
      bgmName = null;
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (bgmEl) bgmEl.volume = volume * 0.45;
    },

    get volume() { return volume; },

    setEnabled(on) { enabled = !!on; if (!enabled) this.stopBgm(); },
    setMusic(on) { musicOn = !!on; if (!musicOn) this.stopBgm(); },
    get enabled() { return enabled; },
    get musicOn() { return musicOn; },
  };

  Elona.Audio = Audio2;
})(window);
