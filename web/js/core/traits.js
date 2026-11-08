'use strict';
/**
 * 「特徴と体質」一览 —— `*label_2697`（285132-285676，545 行）
 *
 * 【源码结构】
 *   285133-285168  feat / 变异 / 先天 / エーテル病 的条目
 *                   `repeat 229` 对每个 feat 调 `*label_0043`（var_96=0 → 说明分支）：
 *                     stat==0                 → 未定义，跳过
 *                     var_92 == 0 且 var_65(93) > 0 → 「取得できるフィート」
 *                     var_97(id) != 0         → 已获得的条目（var_484(1) = 10000+id）
 *                   var_65(93) 是剩余可取得的 feat 点数（开局 3，每 5 级 +1，见 221390/211912）
 *   285169-285253  逐条排版：左列等级名（var_94），右列 `[标签] 说明`（var_93(2+等级)）
 *   285258-285604  64 条 cbit 判定 + 若干 var_58 / var_65 判定，各推一行 `[标签] 说明`
 *   285609-285640  首饰（var_58(10000+n) 编码）带来的附加说明
 *   285641-285676  分页与绘制
 *
 * 【数据】
 *   web/data/tables/traits.json  由 tools/extract_traits.py 提取
 *     entries[i].when  {k:'cbit'|'cbit-or-player'|'f58'|'v65sign'}
 *     entries[i].tag/jp/en（含 {0} 占位符）
 *     personalities[]  var_278 性格名表（JP/EN）
 *   web/data/tables/feats.json  由 tools/extract_feats.py 提取
 *     cat（var_92(0)：0=feat 1=变异 2=先天 3=エーテル病）、maxLevel（var_92(2)）、
 *     levels（var_94，等级名）、ranks（var_93(2..)，各等级的说明）
 *
 * 【取得（285802-285837）】
 *   「取得できるフィート」段的条目都带 `key`（段内行号 0..9），
 *   面板按同一数字键取得；取得逻辑在 `Elona.Feat.take`（见 core/feat.js）。
 *   条件不足的条目（`stat == -1`，如二刀流 19 / 盾殴り 43）**不会**进这一段。
 *
 * 【本实现的差异】
 *   1. 285609-285640 的首饰说明（`var_58(10000+n)` 的 15 段编码 + `*label_0336`）未移植：
 *      本项目首饰的附魔说明走物品描述，不在这张编码表里。
 *   2. 非玩家角色（var_244 != 0）的「あなた→he/his/him」代换未做。
 *   3. 分页（285652-285676）改为纵向滚动。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  /** 285218-285249：var_92(0) → 分类标签 */
  const CAT_TAG = {
    0: { jp: '[フィート]', en: '[Feat]' },
    1: { jp: '[変異]', en: '[Mutation]' },
    2: { jp: '[先天]', en: '[Race]' },
    3: { jp: '[ｴｰﾃﾙ病]', en: '[Ether]' },
  };

  let TABLE = null;
  let FEAT_TABLE = null;

  async function load() {
    if (!TABLE) TABLE = await Elona.Data.table('traits');
    if (!FEAT_TABLE && Elona.Feat) {
      try { FEAT_TABLE = await Elona.Feat.loadTable(); } catch (e) { FEAT_TABLE = null; }
    }
    return TABLE;
  }

  function ready() { return !!TABLE; }
  function table() { return TABLE; }
  function feats() { return FEAT_TABLE; }
  function setTable(t) { TABLE = t; }
  function setFeatTable(t) { FEAT_TABLE = t; }

  // 汉化：ch 字段优先（feats.json 的 levels/ranks 有 ch；traits.json 暂无 ch，自动回退 jp/en）
  const langOf = (v, lang) => (v ? (v.ch || (lang === 'jp' ? v.jp : v.en)) || v.en || v.jp : '');

  /** var_278：性格名（0 = 未設定） */
  function personalityName(n, lang) {
    const list = TABLE && TABLE.personalities;
    if (!list || !list.length) return '';
    const i = n | 0;
    if (i < 0 || i >= list.length) return '';
    return langOf(list[i], lang);
  }

  /** 占位符 {0} 的实际值 */
  function fill(text, entry, c) {
    if (!text || text.indexOf('{0}') < 0) return text;
    let v = '';
    for (const a of (entry.args || [])) {
      if (a.k === 'f58') v = String(c.get(a.f) | 0);
      else if (a.k === 'personality') v = personalityName(c.get(a.f | 0) | 0, 'en');
    }
    return text.split('{0}').join(v);
  }

  /** 条件求值（只覆盖 traits.json 里出现的四种） */
  function test(g, c, when) {
    const cbit = (n) => (Elona.Status && Elona.Status.cbit ? (Elona.Status.cbit(c, n | 0) ? 1 : 0) : 0);
    switch (when.k) {
      case 'cbit': return cbit(when.bit) === 1;
      case 'cbit-or-player': return cbit(when.bit) === 1 || (c.index | 0) === 0;
      case 'f58': {
        const v = c.get(when.f | 0) | 0;
        if (when.op === '!=') return v !== (when.v === undefined ? 0 : when.v);
        if (when.op === '>') return v > (when.v === undefined ? 0 : when.v);
        return false;
      }
      case 'v65sign': {
        if ((c.index | 0) !== 0) return false;              // 285428：& var_244 == 0
        const v = g.getV65 ? (g.getV65(when.v | 0) | 0) : 0;
        if (v === 0) return false;
        return v > 0 ? 1 : -1;
      }
      default: return false;
    }
  }

  /**
   * 「取得できるフィート」的 id 表（285134-285157）。
   * 正常走 `Elona.Feat.available`（带 var_92 与取得条件 stat 判定）；
   * feat.js 还没载入时退回「cat == 0 全列」，保证单测/早期渲染不会空白。
   */
  function availIdsOf(ch, g, F) {
    if (Elona.Feat && Elona.Feat.available) return Elona.Feat.available(ch, g);
    return Object.keys(F).map((k) => parseInt(k, 10))
      .filter((id) => F[String(id)] && (F[String(id)].cat | 0) === 0)
      .sort((a, b) => a - b);
  }

  /**
   * 组装整个列表（285133-285604）。
   * @param {object} g
   * @param {object} c 角色（默认玩家）
   * @param {string} [lang] 'jp' | 'en'
   * @returns {{groups: Array<{key:string, title:string, items:Array<object>}>}}
   */
  function build(g, c, lang) {
    const L = (lang === 'jp') ? 'jp' : 'en';
    const ch = c || (g && g.player);
    if (!ch) return { groups: [] };
    const points = (g && g.getV65) ? (g.getV65(93) | 0) : 0;
    const F = (FEAT_TABLE && FEAT_TABLE.feats) || {};
    const groups = [];

    // ---- 1) feat / 变异 / 先天 / エーテル病
    //   285134-285168：var_65(93) > 0 且是玩家时，先列「取得できるフィート」。
    //   注意 `stat == 1 && var_92 == 0` 的判定**不看是否已取得**，
    //   所以多级 feat 会同时出现在两段里（可继续升级）。
    const available = [];
    const owned = [];
    const availIds = (points > 0 && (ch.index | 0) === 0) ? availIdsOf(ch, g, F) : [];
    for (let k = 0; k < availIds.length; k++) {
      const id = availIds[k] | 0;
      const rec = F[String(id)];
      if (!rec) continue;
      const lv = Elona.Feat.get(ch, id) | 0;
      const it = featItem(rec, id, lv, L, true);
      it.key = k;                     // 285727 display_key：按键 = 段内行号（0..9）
      it.maxLevel = (rec.maxLevel === undefined) ? 1 : (rec.maxLevel | 0);
      it.maxed = it.maxLevel <= lv;
      available.push(it);
    }
    {
      const ids = Object.keys(F).map((k) => parseInt(k, 10)).sort((a, b) => a - b);
      for (const id of ids) {
        const rec = F[String(id)];
        if (!rec) continue;
        const lv = Elona.Feat ? (Elona.Feat.get(ch, id) | 0) : 0;
        if (lv === 0) continue;         // 285159：var_97(id) != 0
        owned.push(featItem(rec, id, lv, L, false));
      }
    }
    if (available.length) {
      groups.push({
        key: 'available',
        title: L === 'jp' ? '◆ 取得できるフィート' : '[Available feats]',
        items: available,
      });
    }
    if (owned.length) {
      groups.push({
        key: 'feats',
        title: L === 'jp' ? '◆ 特徴と体質' : '[Feats and traits]',
        items: owned,
      });
    }

    // ---- 2) [bit] 等逐条判定（285258-285604）
    const bits = [];
    const list = (TABLE && TABLE.entries) || [];
    for (const e of list) {
      const r = test(g, ch, e.when);
      if (!r) continue;
      if (e.when.k === 'v65sign') {
        const alt = (e.entries || []).find((x) => x.sign === r);
        if (!alt) continue;
        bits.push({ left: '', tag: langOf(e.tag, L), text: langOf(alt, L) });
        continue;
      }
      bits.push({
        left: '',
        tag: langOf(e.tag, L),
        text: fill(langOf(e, L), e, ch),
      });
    }
    if (bits.length) groups.push({ key: 'bits', title: '', items: bits });
    return { groups };
  }

  /** 单条 feat 的显示（285197-285251） */
  function featItem(rec, id, lv, L, isAvailable) {
    const cat = (rec.cat === undefined) ? 0 : (rec.cat | 0);
    const maxLv = (rec.maxLevel === undefined) ? 1 : (rec.maxLevel | 0);
    const levels = rec.levels || [];
    const ranks = rec.ranks || [];
    // 左列：var_94(等级)，到顶时 var_94(max-1)+"(MAX)"
    let left = '';
    if (levels.length) {
      const idx = Math.max(0, Math.min(lv, maxLv - 1));
      left = langOf(levels[idx], L) || langOf(levels[0], L);
      if (lv >= maxLv) left += '(MAX)';
    } else if (lv > 0) {
      left = '+' + lv;
    }
    // 右列：[标签] + var_93(2+abs(等级))
    const tag = langOf(CAT_TAG[cat] || CAT_TAG[0], L);
    let text = '';
    if (ranks.length) {
      const idx = Math.max(0, Math.min(lv, ranks.length - 1));
      text = langOf(ranks[idx], L);
    }
    if (!text) text = rec.nameCh || rec.name || ('feat ' + id);
    return { left, tag, text, id, level: lv, cat, available: !!isAvailable };
  }

  Elona.Traits = {
    load, ready, table, feats, setTable, setFeatTable,
    build, test, personalityName, CAT_TAG,
    _internals: { featItem, fill, langOf },
  };
})(typeof window !== 'undefined' ? window : global);
