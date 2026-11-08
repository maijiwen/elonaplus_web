'use strict';
/**
 * 文本变量替换器（core/textvar.js）—— `*label_0258` / `*label_0259`
 *
 * 【源码依据】hsp/start.hsp
 *   16243-17992  `*label_0258`  正式对话的 {var} 替换器（全源码 110+ 处 `gosub *label_0258`）
 *   17993-19669  `*label_0259`  guide 版替换器（多 {guide1..9}）
 *   13748-16241  35 个 `#defcfunc _xxx`：语气助词 / 称呼 / 万圣节台词，
 *                按 `var_58(18, ch)`（口调 0..6）× `var_58(188, ch)`（礼貌 0/1）选短语，
 *                再拼 `var_334(prm)`（标点，`9090` 定义：`。` `？` `！` 空）。
 *
 * 【原版行为】
 *   repeat 30 次：找 `{`、取到 `}` 的键、查表替换、再找下一个。
 *   键不认识时 var_121 保持原键，替换回去等于不变（30 次后自然结束）。
 *
 * 【键的三类】
 *   1. 名称类：ref / you / player / aka / npc / nptc / npcc / me
 *      onii / syujin / sex        —— 按语言与玩家性别（var_58(8,0)）
 *   2. 语气类：ある / う / が / か / かな / だ / よ / だな / だろ / る /
 *              のだ / な / くれ / しろ / 見るな / ごめん
 *      → `_aru(3)` 等 18 个函数，数据在 web/data/text/vars.json
 *   3. 演出类：Basic / Embarrassment / Fun / Happy / Angry / Question
 *      → 写 `var_58(79, ch)` 表情帧（原版 326 = 26 + 100*3，帧号带 100*3 基址）
 *              seChangePage … seDog（309 个）
 *      → `snd N`，这里映射成语义音效交给 audio.js
 *
 * 【数据】tools/extract_textvars.py → web/data/text/vars.json
 *   funcs / map / emote / se / guide / punct
 *
 * 【字段】
 *   var_58(18, ch)   口调（0 丁寧/1 男性的/2 女性的/3 陰気/4 老人/5 古風/6 獣人）
 *   var_58(188, ch)  礼貌标记（1 = 敬语变体）
 *   var_58(8, 0)     玩家性别（0 男 / 1 女）
 *   var_58(79, ch)   表情帧（对话立绘用）
 *   var_58(166, 0)   guide 模式（{guide1..9} 写入）
 *   var_65(814)      自家客人数（{ref} 用，仅 var_419==1 时替换）
 *   var_63(0/1, ch)  名字 / 别名
 *   var_334(prm)     标点后缀
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const MAX_PASS = 30;            // 16244 `repeat 30`

  /** se* → audio.js 的语义名（未列出的只记录编号，不出声） */
  const SE_SEMANTIC = {
    seChangePage: 'more', seMore: 'more', seCursor1: 'cursor', seClick1: 'cursor',
    seOk: 'ok', seFile: null, seSave: 'write',
    seMelee1: 'attack', seMelee2: 'attack', seMiss: 'miss',
    seAtkSword: 'attack', seAtkFire: 'attack', seAtkIce: 'attack',
    seKill: 'kill', seKill2: 'kill', seDead: 'dead',
    seGetGold: 'gold', sePayGold: 'pay', seGet: 'pickup', seGet2: 'pickup',
    seGet3: 'pickup', seDrop: 'drop', seEat: 'eat', seDrink: 'drink',
    seEquip: 'equip', seWear: 'wear', seScroll: 'scroll', seOpenBook: 'read',
    seHeal1: 'heal', seTeleport1: 'teleport', seDig: 'dig', seDig2: 'dig',
    seBash: 'bash', seTrap: 'trap', seOpenChest: 'chest', seLocked: 'locked',
    seOpenDoor: 'door', seOpenDoor2: 'door', seSpell: 'spell',
    sePray: 'pray', sePray2: 'pray', seOffer: 'offer', seOffer2: 'offer',
    seSkill: 'skill', seFeat: 'feat', seLevelup: null,
    seWater: 'water', seMizu: 'water', seWind: null,
    seInv: 'inv', seDing: 'coin', seDing2: 'coin', seSlap: 'hurt',
    seComplete: 'levelup', seNice: 'ok', seAlert: null,
    seFishing1: null, seFishCast: null, seFishGet: null,
  };

  let DATA = null;                // vars.json
  const warnOnce = new Set();

  const TextVar = {
    /** 数据是否已就绪（未就绪时 expand 原样返回） */
    get loaded() { return !!DATA; },
    /** 原始表（调试/测试用） */
    get data() { return DATA; },

    /** 注入已解析的 vars.json */
    ready(vars) { DATA = vars || null; return this; },

    /** 从 web/data/text/vars.json 读取 */
    async load(url) {
      if (DATA) return DATA;
      const p = url || 'data/text/vars.json';
      if (Elona.Data && Elona.Data.fetchJson) {
        DATA = await Elona.Data.fetchJson(p);
      } else {
        const res = await fetch(p);
        DATA = await res.json();
      }
      return DATA;
    },

    /** 语气函数：等价 `_xxx(prm)`，返回短语 + 标点 */
    phrase(func, ch, punct, rnd) {
      if (!DATA) return null;
      const f = DATA.funcs[func];
      if (!f) return null;
      const tone = ch && typeof ch.get === 'function' ? (ch.get(18) | 0) : 0;
      const polite = ch && typeof ch.get === 'function' ? (ch.get(188) | 0) : 0;
      const byTone = f[String(tone)] || f['0'];
      if (!byTone) return null;
      const pool = byTone[polite === 1 ? '1' : '0'] || byTone['0'] || byTone['1'] || [];
      if (!pool.length) return '';
      const r = rnd || Math.floor;
      let out = pool[r(pool.length) % pool.length];
      const pj = DATA.punct[this.lang === 'en' ? 'en' : 'jp'];
      out += pj[Math.max(0, Math.min(3, punct | 0))] || '';
      return out;
    },

    /** 表情名 → 帧号；不认识返回 null */
    emoteFrame(name) {
      if (!DATA) return null;
      const v = DATA.emote[name];
      return v === undefined ? null : v;
    },

    /** 音效名 → { name, snd, semantic } */
    soundOf(name) {
      if (!DATA) return null;
      const n = DATA.se[name];
      if (n === undefined) return null;
      return { name, snd: n, semantic: SE_SEMANTIC[name] === undefined ? null : SE_SEMANTIC[name] };
    },

    /**
     * 展开一段文本。
     *
     * @param {string} text
     * @param {object} [ctx]
     *   ctx.player  玩家 Chara（{player} / {aka} / 性别）
     *   ctx.npc     {npc} / {nptc} 的对象 Chara（原版 var_244）
     *   ctx.npcc    {npcc} 的对象 Chara（原版 var_243）
     *   ctx.lang    'jp' | 'en'（默认 jp；对应 var_52 / var_205）
     *   ctx.punct   0..3（默认 3 = 无标点）
     *   ctx.refGuests 客人数（null = 不替换 {ref}）
     *   ctx.rnd     (n)=>0..n-1
     *   ctx.onSound  (info)=>void
     *   ctx.onEmote  (frame, ch)=>void
     * @returns {string}
     */
    expand(text, ctx) {
      const s0 = String(text == null ? '' : text);
      if (!s0 || s0.indexOf('{') < 0) return s0;
      if (!DATA) {
        // 数据未加载：只去掉演出标记，保持旧行为
        return s0.replace(/\{[A-Za-z0-9_]+\}/g, '');
      }
      const c = ctx || {};
      const lang = c.lang === 'en' ? 'en' : 'jp';
      const o = {
        lang,
        punct: c.punct === undefined ? 3 : c.punct,
        rnd: c.rnd || (n => Math.floor(Math.random() * n)),
        player: c.player || null,
        npc: c.npc || null,
        npcc: c.npcc || null,
        ctx: c,
      };
      this.lang = lang;

      // 原版 16244 `repeat 30`：最多替换 30 个键，其余原样保留
      let out = '';
      let rest = s0;
      for (let pass = 0; pass < MAX_PASS; pass++) {
        const open = rest.indexOf('{');
        if (open < 0) break;
        const close = rest.indexOf('}', open + 1);
        if (close < 0) break;
        out += rest.slice(0, open);
        const key = rest.slice(open + 1, close);
        const rep = this._key(key, o);
        out += (rep === null || rep === undefined) ? rest.slice(open, close + 1) : rep;
        rest = rest.slice(close + 1);
      }
      return out + rest;
    },

    /** 单个键 → 替换值（null = 不认识，保留原样） */
    _key(key, o) {
      if (!key) return null;
      const D = DATA;
      const lang = o.lang;
      const ch = o.npc;
      const sex = o.player && typeof o.player.get === 'function' ? (o.player.get(8) | 0) : 0;

      // —— 1. 称呼类（label_0258 16252-16404）——
      if (key === 'ref') {
        if (o.ctx.refGuests == null) return null;
        const n = o.ctx.refGuests | 0;
        return lang === 'en' ? (n + ' guest' + (n === 1 ? '' : 's')) : String(n);
      }
      if (key === 'you') return this.phrase('_kimi', ch, o.punct, o.rnd);
      if (key === 'me') return this.phrase('_ore', ch, o.punct, o.rnd);
      if (key === 'player') return this._name(o.player, lang);
      if (key === 'aka') {
        if (o.player && o.player.alias) return o.player.alias;
        return this._name(o.player, lang);
      }
      if (key === 'npc' || key === 'nptc') return this._name(ch, lang);
      if (key === 'npcc') return this._name(o.npcc, lang);
      if (key === 'onii') {
        if (lang === 'jp') return sex === 1 ? 'お姉' : 'お兄';
        return sex === 1 ? 'sister' : 'brother';
      }
      if (key === 'syujin') {
        if (lang === 'jp') return sex === 1 ? 'お嬢様' : 'ご主人様';
        return 'master';
      }
      if (key === 'sex') {
        if (lang === 'jp') return sex === 1 ? '女' : '男';
        return sex === 1 ? 'girl' : 'boy';
      }

      // —— 2. 语气类（16286-16348）——
      const fn = D.map[key];
      if (fn) return this.phrase(fn, ch, o.punct, o.rnd);

      // —— 3. 演出类（16405-17992）——
      const frame = D.emote[key];
      if (frame !== undefined) {
        if (o.ctx.onEmote) o.ctx.onEmote(frame, ch);
        else if (ch && typeof ch.set === 'function') ch.set(79, frame);
        return '';
      }
      const snd = D.se[key];
      if (snd !== undefined) {
        const info = { name: key, snd, semantic: SE_SEMANTIC[key] === undefined ? null : SE_SEMANTIC[key] };
        if (o.ctx.onSound) o.ctx.onSound(info);
        else if (Elona.Audio && info.semantic) {
          try { Elona.Audio.play(info.semantic); } catch (e) { /* 音频未初始化 */ }
        }
        return '';
      }
      // —— 4. guide 模式（label_0259 18075-18120）——
      const g = D.guide[key];
      if (g !== undefined) {
        if (o.ctx.onStat) o.ctx.onStat(166, g);
        else if (o.ctx.player && typeof o.ctx.player.set === 'function') o.ctx.player.set(166, g);
        return '';
      }

      if (!warnOnce.has(key)) {
        warnOnce.add(key);
        if (global.console && console.debug) console.debug('[textvar] 未知键 {' + key + '}');
      }
      return null;
    },

    _name(ch, lang) {
      if (!ch) return '';
      if (typeof ch === 'string') return ch;
      if (typeof ch.cname === 'string' && ch.cname) return ch.cname;
      if (typeof ch.name === 'string' && ch.name) return ch.name;
      if (typeof ch.name === 'function') return ch.name(lang) || '';
      return '';
    },

    /** 便捷：只取文本（丢弃音效/表情副作用） */
    render(text, ctx) {
      return this.expand(text, Object.assign({ onSound: () => {}, onEmote: () => {} }, ctx || {}));
    },
  };

  Elona.TextVar = TextVar;
})(window);
