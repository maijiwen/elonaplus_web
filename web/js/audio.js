'use strict';
/**
 * 音频层 —— 对应 config.txt 的 (Sound) 段：sound / music / heartbeat。
 *
 * 【资源】web/assets/sound/ 下是原版 sound 目录里可直接被浏览器播放的 .wav。
 * 【音效编号】原版 `snd N` 的编号→文件名表在 `js/sndtable.js`（由 tools/gen_sndmap.js
 *   从 start.hsp 的 sndload 表生成，307 项），本层直接查表，与源码一一对应。
 * 【重要差异】原版 BGM 是 .mid（MIDI），现代浏览器没有内建 MIDI 合成器。
 *   0-S0 起由 `js/midibgm.js` 补上播放管线：解析 SMF → WebAudio 实时合成
 *   （音色是近似合成，音符 / 节拍 / 循环与原曲一致，见 17 册 A36）。
 *   该模块不可用（旧浏览器无 AudioContext / 解析失败）时才退回同名环境音 wav。
 *     - 音效（原版 `snd N`）→ 查 sndtable.js 播放同名 wav；
 *     - BGM（原版 .mid）→ `Audio.midi(文件名)` 走 MidiBgm。
 * 【心跳音】Heart1.wav 对应 config.txt 的 heartbeat（低血量时播放，源码 snd 32）。
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

  // ---------------------------------------------------------------- 用户目录（0-Z29）
  /**
   * 原版 `user\sound\seN.wav` / `user\music\*` 是玩家自定义的音效与 BGM：
   *   6767-6870  `var_119 = var_47 + "user\sound\"` → `sndload se0..se99.wav, 188..287`
   *   7430-7452  播 BGM 时先找 `user\music\<文件>`，找不到才退回 `sound\<文件>`
   *
   * 网页版的做法：拿到目录后**一次性**把所有音频转成 blob URL 缓存到表里，
   * 这样 `sfx()` / `midi()` 仍是同步函数（调用点太多，不能全改成 await）。
   */
  const userSfx = new Map();        // 'se0' → blob:
  const userMusic = new Map();      // 'pop01.mid' → blob:

  async function refreshUserAssets() {
    userSfx.clear();
    userMusic.clear();
    const U = Elona.UserDir;
    // 不判 ready：内置素材包（web/assets/user/）也算来源，和原版「直接读 user\sound\」一致。
    if (!U || !U.list || !U.url) return { sfx: 0, music: 0 };
    try {
      for (const n of await U.list('sound', '*.wav')) {
        const u = await U.url('sound/' + n);
        if (u) userSfx.set(String(n).replace(/\.wav$/i, '').toLowerCase(), u);
      }
    } catch (e) { /* 目录不可读就跳过 */ }
    try {
      for (const pat of ['*.mid', '*.midi', '*.mp3', '*.ogg', '*.wav']) {
        for (const n of await U.list('music', pat)) {
          const u = await U.url('music/' + n);
          if (u) userMusic.set(String(n).toLowerCase(), u);
        }
      }
    } catch (e) { /* 同上 */ }
    return { sfx: userSfx.size, music: userMusic.size };
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

    /**
     * 原版 `snd N` —— 直接查 `js/sndtable.js` 的编号表（由 start.hsp 的 sndload 生成）。
     * 编号 75-80 是环境底噪（bg_*），按循环播放；其余一次性播放。
     * se0-se99 原版安装目录就没有文件，这里静默返回（与 HSP 的 mmload 失败一致）。
     */
    playIndex(n) {
      const id = n | 0;
      const table = Elona.SND_FILES || {};
      const file = table[id];
      if (!file) return null;
      if ((Elona.SND_MISSING || []).indexOf(file + '.wav') >= 0) return null;
      const amb = Elona.SND_AMBIENT || {};
      if (amb[id]) { this.bgmFile(amb[id]); return null; }
      return this.sfx(file);
    },

    /** 该编号对应哪个 wav（供测试与差异核对） */
    fileNameOf(n) {
      return (Elona.SND_FILES || {})[n | 0] || null;
    },

    /**
     * 按**文件名**播放音效 —— 剧情脚本的 {se} 给的是原版 wav 文件名
     * （如 "bg_wind.wav"），与 SFX 的语义名无关，故单独一个入口。
     */
    sfx(file) {
      if (!enabled || volume <= 0 || !file) return null;
      const name = String(file).replace(/\.wav$/i, '');
      try {
        // 0-Z29：`user\sound\seN.wav` 优先（原版 6767-6870 把 se0-se99 指到 user 目录）
        const u = userSfx.get(name.toLowerCase());
        const a = u ? new Audio(u) : el(name);
        a.volume = volume;
        a.currentTime = 0;
        const p = a.play();
        if (p && p.catch) p.catch(() => { /* 浏览器策略：需用户交互后才允许播放 */ });
        return a;
      } catch (e) { return null; }
    },

    /** 用户目录里有没有这个音效（差异核对 / 测试用） */
    userSfxUrl(name) { return userSfx.get(String(name || '').replace(/\.wav$/i, '').toLowerCase()) || null; },
    /** 用户目录里有没有这个 BGM */
    userMusicUrl(name) { return userMusic.get(String(name || '').toLowerCase()) || null; },
    /** 重新扫描 user/sound 与 user/music（目录变更后调用） */
    refreshUserAssets,

    /** 环境音 / BGM（循环）—— 语义名入口 */
    bgm(name) {
      this.bgmFile(BG[name] || BG.town);
    },

    /** 按**文件名**循环环境音（源码 snd 75-80 就是这种用法） */
    bgmFile(file) {
      if (!musicOn || volume <= 0 || !file) return;
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
      if (Elona.MidiBgm) Elona.MidiBgm.stop();     // 0-S0：同时停掉 MIDI 合成
    },

    /**
     * 0-S0：原版 BGM —— 直接放 `sound\*.mid`（`*label_0069` 7400-7460 的
     *   `mmload/mmplay`）。素材在 web/assets/sound/ 下共 83 首。
     *
     * @param {string} file 文件名（含 .mid，来自 user\music\musiclist.txt 的第一列）
     * @param {string} [fallbackKey] 合成器不可用时的环境音语义名（town / field / …）
     * @returns {boolean} 是否真的用 MIDI 播了
     */
    midi(file, fallbackKey) {
      if (!file) return false;
      if (!musicOn || volume <= 0) return false;
      const name = String(file);
      if (bgmName === name && Elona.MidiBgm && Elona.MidiBgm.playing) return true;
      // 0-Z29 / 7430-7437：先找 `user\music\<文件>`，找不到才退回 `sound\<文件>`
      const u = userMusic.get(name.toLowerCase()) || null;
      const src = u || ('assets/sound/' + name);
      // 玩家放的是 mp3/ogg/wav 时原版直接 DMPLAY（7439-7442），网页用 <audio> 循环
      if (!/\.(mid|midi)$/i.test(name)) return this.bgmUrl(src, name, fallbackKey);
      if (Elona.MidiBgm && Elona.MidiBgm.supported) {
        this.stopBgm();
        Elona.MidiBgm.setVolume(volume * 0.5);
        bgmName = name;
        Elona.MidiBgm.play(src, { loop: true }).then((okv) => {
          if (!okv) {
            if (bgmName === name) bgmName = null;
            if (fallbackKey) this.bgm(fallbackKey);
          }
        }).catch(() => { if (fallbackKey) this.bgm(fallbackKey); });
        return true;
      }
      if (fallbackKey) this.bgm(fallbackKey);       // 无合成器：退回环境音
      return false;
    },

    /**
     * 0-Z29：按完整 URL 循环播一段 BGM（用户目录里的 mp3/ogg/wav）。
     * @param {string} src
     * @param {string} name 用于去重的逻辑名
     * @param {string} [fallbackKey] 播放失败时的环境音语义名
     */
    bgmUrl(src, name, fallbackKey) {
      if (!musicOn || volume <= 0 || !src) return false;
      if (bgmName === name && bgmEl && !bgmEl.paused) return true;
      this.stopBgm();
      try {
        bgmEl = new Audio(src);
        bgmEl.loop = true;
        bgmEl.volume = volume * 0.45;
        bgmName = name;
        const p = bgmEl.play();
        if (p && p.catch) p.catch(() => { if (fallbackKey) this.bgm(fallbackKey); });
        return true;
      } catch (e) {
        bgmEl = null;
        if (fallbackKey) this.bgm(fallbackKey);
        return false;
      }
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (bgmEl) bgmEl.volume = volume * 0.45;
      if (Elona.MidiBgm) Elona.MidiBgm.setVolume(volume * 0.5);
    },

    get volume() { return volume; },

    setEnabled(on) { enabled = !!on; if (!enabled) this.stopBgm(); },
    setMusic(on) { musicOn = !!on; if (!musicOn) this.stopBgm(); },
    get enabled() { return enabled; },
    get musicOn() { return musicOn; },
  };

  Elona.Audio = Audio2;
})(window);
