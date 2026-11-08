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
 *
 * 未实现（登记在差异报告中）：
 *   language（本实现只有英文数据）、windowW/H、scroll、envEffect、joypad、net 系列。
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
        damage: 'damage_show', sceneAuto: 'sceneAuto',
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
    },
  };

  Elona.Options = Options;
})(window);
