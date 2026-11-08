'use strict';
/**
 * NPC 自定义对话（core/talk.js）—— customtalk（192942-193157）
 *
 * 【源码依据】
 *   192946-192955  若 cbit(989, npc) 且 user/talk/<var_63(4,npc)> 存在 → 载入该文件
 *   192957-192961  否则若 var_58(27,npc) == 343 → 用 var_1030(var_58(157,npc)) 的内容
 *   192964-193116  talkType（100..151）→ 标签名 %txtXXX
 *   193117-193118  在文本里找 `%txtXXX,JP` / `%txtXXX,EN`，截到下一个 `%`
 *   193119-193150  段内多行时随机取一行；地图 35 + 类型 106 的顺序循环（var_58(428)）
 *   193141         非对话类（106/135/137-141）会 `txtef 9`（这里是「喊叫」标记）
 *
 * 【数据】tools/extract_talk.py 把 user/talk/*.txt（cp932）转成
 *   web/data/talk/<key>.json = { key, tags: { txtCalm: { jp:[...], en:[...] }, ... } }
 *
 * 【字段】
 *   cbit 989       该 NPC 有自定义台词文件
 *   var_63(4, npc) 台词文件名（不含 .txt）
 *   var_58(27)     种族 id（343 = 用了 var_1030 表的自定义种族）
 *   var_58(157)    自定义种族的台词索引
 *   var_58(428)    地图 35 上的顺序播放计数器
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const CBIT_CUSTOM = 989;

  /** talkType → 标签名（192964-193116，共 52 项） */
  const TYPES = {
    100: 'txtCalm', 101: 'txtAggro', 102: 'txtDead', 103: 'txtKilled',
    104: 'txtWelcome', 106: 'txtDialog', 107: 'txtNight', 108: 'txtInsult',
    109: 'txtKiss', 110: 'txtChoco', 111: 'txtDiscipline', 112: 'txtDisciplineOff',
    113: 'txtDisciplineEat', 114: 'txtCharge', 115: 'txtKizuna', 116: 'txtChargeS',
    117: 'txtChargeA', 118: 'txtNade', 119: 'txtSpecial', 120: 'txtHug',
    121: 'txtMidNight', 122: 'txtDiscipline2', 123: 'txtInsult2', 124: 'txtRideOff',
    125: 'txtRideOffPC', 126: 'txtRideOn', 127: 'txtRideOnPC', 128: 'txtFawnOn',
    129: 'txtLimit', 130: 'txtBfast', 131: 'txtMaterial', 132: 'txtMultiple',
    133: 'txtDrain', 134: 'txtCreate', 135: 'txtEXAct', 136: 'txtEXReact',
    137: 'txtDialogB', 138: 'txtDialogE', 139: 'txtDialogF', 140: 'txtDialogH',
    141: 'txtMeal', 142: 'txtShift', 143: 'txtBtalk', 144: 'txtMizuAsobi',
    145: 'txtMizuAsobiEnd', 146: 'txtTag', 147: 'txtTagEvo', 148: 'txtLeading',
    149: 'txtClementia', 150: 'txtPleasure', 151: 'txtPleasureHard',
  };

  /** 会「喊出来」（txtef 9）的类型：除对话/EXAct 之外的都算（193141） */
  const QUIET_TYPES = [106, 135, 137, 138, 139, 140, 141];
  /** 找不到台词时直接返回 0 的类型（193155） */
  const NO_FALLBACK = [106, 137, 138, 139, 140, 141, 146];

  const cache = new Map();       // key → { tags }

  /** 台词里的 {Question} {Angry} {se0} 等是对话特效标记 */
  const MARK_RE = /\{[A-Za-z0-9_]+\}/g;

  const Talk = {
    TYPES, QUIET_TYPES, NO_FALLBACK, CBIT_CUSTOM,

    /** 去掉特效标记，只留可读文本 */
    stripMarks(text) {
      if (!text) return '';
      return String(text).replace(MARK_RE, '').trim();
    },

    /** 该台词是否带特效标记（原版 txtef 9 之类） */
    hasMarks(text) { return MARK_RE.test(String(text || '')); },

    /** 解析 cp932 转来的纯文本（浏览器端不直接用，留给测试与工具） */
    parse(text, lang) {
      const out = {};
      const segs = String(text || '').replace(/\r\n?/g, '\n').split(/(?=^%txt)/m);
      for (const seg of segs) {
        if (!seg.startsWith('%txt')) continue;
        const nl = seg.indexOf('\n');
        const head = (nl < 0 ? seg : seg.slice(0, nl)).trim();
        const body = nl < 0 ? '' : seg.slice(nl + 1);
        const m = /^%(txt[A-Za-z0-9_]+)\s*,\s*(JP|EN)/i.exec(head);
        if (!m) continue;
        const tag = m[1];
        const lg = m[2].toLowerCase();
        if (lang && lg !== lang) continue;
        const lines = [];
        for (const raw of body.split('\n')) {
          const s = raw.trim();
          if (s.startsWith('%')) break;               // 193118：截到下一个 %
          if (!s || s.startsWith('//')) continue;
          const clean = s.replace(/\s*\/\/.*$/, '').trim();
          if (clean) lines.push(clean);
        }
        if (!lines.length) continue;
        out[tag] = out[tag] || {};
        out[tag][lg] = lines;
      }
      return out;
    },

    /** 加载一份对话文件（data/talk/<key>.json） */
    async load(key) {
      const k = String(key || '').replace(/\.txt$/i, '');
      if (!k) return null;
      if (cache.has(k)) return cache.get(k);
      let data = null;
      try {
        data = await Elona.Data.fetchJson('data/talk/' + k + '.json');
      } catch (e) {
        data = null;
      }
      cache.set(k, data);
      return data;
    },

    /** 启动时把 index.json 里所有对话文件读进缓存 */
    async preloadAll() {
      let idx = null;
      try {
        idx = await Elona.Data.fetchJson('data/talk/index.json');
      } catch (e) {
        return { count: 0, files: [] };
      }
      const files = (idx && idx.files) || [];
      for (const row of files) await this.load(row.key);
      return { count: files.length, files: files.map((r) => r.key) };
    },

    /** 同步取（表已进缓存时） */
    cached(key) {
      return cache.get(String(key || '').replace(/\.txt$/i, '')) || null;
    },

    /** 文件键名（var_63(4, npc)，即文件名去掉 .txt） */
    fileKey(npc) {
      if (!npc) return '';
      return String(npc.talkFile || '').replace(/\.txt$/i, '');
    },

    /** 是否配了自定义台词（cbit 989 + 文件名） */
    hasCustom(npc) {
      if (!npc) return false;
      if (npc.talkFile) return true;
      if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(npc, CBIT_CUSTOM) === 1) {
        return !!(npc.talkFile || '');
      }
      return false;
    },

    /** 给 NPC 绑定台词文件（等价于 cbitmod 989 + var_63(4) 赋值） */
    bind(npc, key) {
      if (!npc) return false;
      const k = String(key || '').replace(/\.txt$/i, '');
      npc.talkFile = k || null;
      if (Elona.Status && Elona.Status.cbitmod) {
        Elona.Status.cbitmod(npc, CBIT_CUSTOM, k ? true : false);
      }
      return !!k;
    },

    /**
     * 取一句台词（对应 customtalk 本体）。
     * @param {object} g
     * @param {object} npc
     * @param {number} type talkType（100..151）
     * @param {object} [opts] { lang, data }
     * @returns {object|null} { text, tag, quiet, raw }
     */
    say(g, npc, type, opts) {
      const o = opts || {};
      const t = type | 0;
      const tag = TYPES[t];
      if (!tag) return null;

      // 192946-192961：拿到台词表
      let tags = null;
      const key = this.fileKey(npc);
      if (this.hasCustom(npc) && key) {
        const data = o.data || this.cached(key);
        if (!data) return null;              // 文件没加载 → 交给调用方走默认
        tags = data.tags || data;
      } else if (npc && (npc.get(27) | 0) === 343) {
        // 192957-192961：自定义种族的内置台词
        const arr = npc.talkLines || (npc.get(157) ? null : null);
        if (!arr) return null;
        tags = arr;
      } else {
        return null;
      }

      const seg = tags[tag];
      if (!seg) return null;

      const lang = o.lang || 'en';
      let lines = seg[lang];
      if (!lines || !lines.length) lines = seg.jp || seg.en;
      if (!lines || !lines.length) return null;

      let pick = null;
      // 193120-193134：地图 35 且是对话类型时顺序播放（var_58(428) 计数）
      if ((g && (g.getV65(20) | 0) === 35) && t === 106 && npc && (npc.index | 0) > 16
        && (npc.get(27) | 0) === 343 && lines.length > 1) {
        let seq = npc.get(428) | 0;
        if (seq > 100) seq = 0;
        pick = lines[Math.min(seq, lines.length - 1)];
        npc.set(428, (seq + 1) % lines.length);
      } else if (lines.length > 1) {
        const rnd = (g && g.rng && g.rng.rnd) ? g.rng.rnd.bind(g.rng) : (n) => Math.floor(Math.random() * n);
        pick = lines[rnd(lines.length)];
      } else {
        pick = lines[0];
      }
      if (!pick) return null;

      // 台词里的 {player} / {ある} / {Angry} / {seOk} 由 *label_0258 替换（16243-17992）。
      // 原来这里直接 stripMarks 把标记删掉，导致称呼与语气词丢失。
      let text = this.stripMarks(pick);
      if (Elona.TextVar && Elona.TextVar.loaded) {
        text = Elona.TextVar.expand(pick, {
          player: (g && g.player) || null,
          npc,
          lang,
          punct: 3,
          rnd: (n) => ((g && g.rng && g.rng.rnd) ? g.rng.rnd(n) : Math.floor(Math.random() * n)),
          onSound: (info) => {
            if (Elona.Audio && info.semantic) { try { Elona.Audio.play(info.semantic); } catch (e) { /* 忽略 */ } }
          },
        });
      }

      return {
        text,
        raw: pick,
        tag,
        quiet: QUIET_TYPES.indexOf(t) >= 0,
      };
    },

    /** 列表：所有可用标签名（调试/测试用） */
    tagNames() { return Object.keys(TYPES).map((k) => TYPES[k]); },
  };

  Elona.Talk = Talk;
  if (typeof module !== 'undefined' && module.exports) module.exports = Talk;
})(typeof window !== 'undefined' ? window : global);
