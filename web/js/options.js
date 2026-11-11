'use strict';
/**
 * 选项层 —— 对应 original/config.txt 中可由玩家修改的项。
 *
 * 已实现（与 config.txt 的键同名）：
 *   fullscreen   0/1        全屏
 *   windowAnime  0/1        动画（同时控制渲染层的过场动画）
 *   msg_addTime  0/1        消息是否带 [时:分] 前缀
 *   sound        0/1        音效
 *   music        0/1        音乐（环境音）
 *   volume       0..100     音量（本项目新增，原版由系统音量控制）
 *   key_sCancel  0/1        Shift 当 Esc（存于 Elona.Keys）
 *   damage_show  0/1        是否显示伤害数字
 *   heartbeat    0/1        低血量心跳音（0-FZ / B3，199732-199743）
 *   windowW/H    像素       窗口大小（0-FZ / B5）：800×600 是原版分辨率，
 *                           这里改成「画布不变、按 windowW/800 放大显示」，
 *                           由 main.js 的 fitStage 读取（屏幕不够时自动收小）。
 *
 * 未实现（登记在差异报告中）：
 *   scroll、envEffect、joypad、net 系列（纯表现/外设层）。
 *   language 见 core/lang.js：只切换**数据表里的名称**（物品/技能），
 *   代码里硬编码的中文短句不随之变化。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const STORAGE = 'elona.options.v1';

  const DEFAULTS = {
    fullscreen: 0,
    windowAnime: 1,
    msg_addTime: 1,
    sound: 1,
    music: 1,
    volume: 60,
    damage_show: 1,
    heartbeat: 1,              // config.txt heartbeat.=1；低血量受击时播 snd 32
    // config.txt windowW/windowH：原版默认 800×600。本项目把「窗口放大」
    // 做成 画布不变 + CSS 缩放（windowW / 800），所以默认给出 1.25 倍。
    windowW: 1000,
    windowH: 750,
    // config.txt language：0 = 日本語 / 1 = English；本项目默认 2 = 中文
    language: 2,
    // 本项目新增：剧情自动播放。
    // 源码 591651-592085 的播放器没有 waitkey，每页淡入(15×30ms)后自动续行，
    // 按键(bit128)则直接结束整段。默认 0 = 按键推进（便于阅读），置 1 复现原版行为。
    sceneAuto: 0,
  };

  function load() {
    const v = Object.assign({}, DEFAULTS);
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) Object.assign(v, JSON.parse(raw));
    } catch (e) { /* 用默认 */ }
    return v;
  }

  const Options = {
    values: load(),

    get(key) { return this.values[key]; },

    save() {
      try { localStorage.setItem(STORAGE, JSON.stringify(this.values)); } catch (e) { /* ignore */ }
    },

    /** 通用开关（Config 面板的行 id） */
    toggle(id) {
      const map = {
        fullscreen: 'fullscreen', anime: 'windowAnime',
        msgTime: 'msg_addTime', sound: 'sound', music: 'music',
        damage: 'damage_show', sceneAuto: 'sceneAuto', heartbeat: 'heartbeat',
      };
      const key = map[id];
      if (!key) return;
      this.values[key] = this.values[key] ? 0 : 1;
      this.save();
      this.apply();
    },

    set(key, val) {
      this.values[key] = val;
      this.save();
      this.apply();
    },

    /** 应用需要即时生效的项 */
    apply() {
      const v = this.values;
      if (Elona.Audio) {
        Elona.Audio.setEnabled(!!v.sound);
        Elona.Audio.setMusic(!!v.music);
        Elona.Audio.setVolume((v.volume | 0) / 100);
      }
      // 全屏
      try {
        const doc = document;
        if (v.fullscreen) {
          if (!doc.fullscreenElement && doc.documentElement.requestFullscreen) {
            doc.documentElement.requestFullscreen().catch(() => { });
          }
        } else if (doc.fullscreenElement && doc.exitFullscreen) {
          doc.exitFullscreen().catch(() => { });
        }
      } catch (e) { /* 某些环境禁止全屏 */ }
      // 窗口大小（B5）：改完立即重排舞台缩放
      if (typeof Elona.applyStageScale === 'function') {
        try { Elona.applyStageScale(); } catch (e) { /* 无渲染层 */ }
      }
    },

    /** 窗口大小档位（原版 config 是任意 windowW/H，这里给几档常用值） */
    WINDOW_PRESETS: [
      { w: 800, h: 600, label: '800×600（原版 1.0 倍）' },
      { w: 1000, h: 750, label: '1000×750（1.25 倍）' },
      { w: 1200, h: 900, label: '1200×900（1.5 倍）' },
      { w: 1600, h: 1200, label: '1600×1200（2 倍）' },
    ],

    /** 当前档位下标（不在预设里时取最接近的一档） */
    windowPresetIndex() {
      const w = this.values.windowW | 0;
      let best = 0, diff = Infinity;
      this.WINDOW_PRESETS.forEach((p, i) => {
        const d = Math.abs(p.w - w);
        if (d < diff) { diff = d; best = i; }
      });
      return best;
    },

    /** 切换到下一档窗口大小 */
    cycleWindowSize() {
      const list = this.WINDOW_PRESETS;
      const next = list[(this.windowPresetIndex() + 1) % list.length];
      this.values.windowW = next.w;
      this.values.windowH = next.h;
      this.save();
      this.apply();
      return next;
    },
  };

  Elona.Options = Options;
})(window);
