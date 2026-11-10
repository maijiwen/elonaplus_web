'use strict';
/**
 * 物品特殊名称片段（core/itemnamex.js）—— *label_0405（29922-30168）
 *
 * 【源码】`itemname` 在 30534-30536 用 `if (var_52) gosub *label_0405` 进入，
 * 之后逐条 `var_719 += lang("JP","EN")` 累加名称片段：
 *   29922-29931  578 / 617 / 869 的查找表后缀（var_720 / 721 / 722）
 *   29932-30147  1200-1203 瓶塞发射器的 potioman 型号（f27 / f32 / f31）
 *   30148-30168  687 古书、783 定制道具、书名 / 技能书 / 饮品名等
 *
 * 【数据】tools/extract_itemnamex.py 把 71 条规则编译成
 *   web/data/tables/itemnamex.json（条件栈 + 带 {var_NNN:field} 占位符的模板）。
 *
 * 【差异】原版只在日文模式（var_52）进入该段；本项目按调用方语言参数直接
 *   选择 jp / en 模板，让中文与英文界面也能显示 potioman 型号等片段。
 *   外部查找表（var_720/721/723/725/726/81/278）由宿主通过
 *   `Elona.ItemNameExtraTables` 注入，缺表时该片段静默跳过，不臆造文本。
 *   869 的 var_722 片段已由 `ItemDB._instanceBody` 的 HEART_NAMES 接管，这里跳过。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let cached = null;
  /** 已由 ItemDB 其它分支接管的物品 id（避免同名片段重复出现） */
  const SKIP_IDS = [869];

  function table() {
    if (!cached) {
      cached = (Elona.ItemNameExtraData && Elona.ItemNameExtraData.rules)
        ? Elona.ItemNameExtraData : null;
      if (!cached && Elona.Data && Elona.Data.tableSync) {
        try { cached = Elona.Data.tableSync('itemnamex'); } catch (e) { cached = null; }
      }
    }
    return (cached && cached.rules) ? cached : null;
  }

  function field(it, n) {
    if (!it) return 0;
    if (n === 3) return it.id | 0;             // var_99(3) 是物品 id
    return (it.f && it.f[n]) | 0;
  }

  function catOf(it) {
    if (!it) return 0;
    if (it.field657) return it.field657 | 0;
    if (Elona.ItemDB && Elona.ItemDB.ref) {
      try { return Elona.ItemDB.ref(it.id | 0, 5) | 0; } catch (e) { return 0; }
    }
    return 0;
  }

  function ibit(bit, it) {
    if (Elona.ItemDB && Elona.ItemDB.ibit) return Elona.ItemDB.ibit(bit, it) | 0;
    const v = (it && it.f && it.f[20]) | 0;
    return (v >> bit) & 1;
  }

  function compare(a, op, b) {
    switch (op) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '<': return a < b;
      default: return null;
    }
  }

  /** 单条条件求值；null 表示「看不懂」，调用方按保守跳过处理 */
  function evalCond(c, ctx) {
    if (!c) return true;
    const it = ctx.it;
    switch (c.k) {
      case 'f3': case 'f8': case 'f23': case 'f25': case 'f26':
      case 'f27': case 'f31': case 'f32': {
        const n = +c.k.slice(1);
        return compare(field(it, n), c.op, c.v);
      }
      case 'f27div': return compare(Math.floor(field(it, 27) / 100), c.op, c.v);
      case 'ibit': return compare(ibit(c.bit, it), c.op, c.v);
      case 'cat': return compare(catOf(it), c.op, c.v);
      case 'jpMode': return ctx.lang === 'jp';
      case 'not': {
        const r = evalCond(c.of, ctx);
        return r === null ? null : !r;
      }
      case 'any': return c.of.some((x) => evalCond(x, ctx) === true);
      case 'all': return c.of.every((x) => evalCond(x, ctx) === true);
      default: return null;                 // raw：保守跳过
    }
  }

  /** 查外部表；var_81 先尝试项目的技能名表 */
  function lookup(name, idx, ctx) {
    const t = Elona.ItemNameExtraTables || {};
    const row = t[name];
    if (row && row[idx] !== undefined && row[idx] !== null) return String(row[idx]);
    if (name === 'var_81' && Elona.Stats && Elona.Stats.skillName) {
      try { return String(Elona.Stats.skillName(idx) || ''); } catch (e) { return ''; }
    }
    return '';
  }

  /** 展开模板里的 {var_NNN:field} 占位符；查不到表就返回空串 */
  function render(tpl, ctx) {
    const s = String(tpl || '');
    return s.replace(/\{(var_\d+):(\d+)\}/g, (m, name, fld) => {
      const v = lookup(name, field(ctx.it, +fld), ctx);
      // 查不到外部表时整段模板作废（避免留下「《》という題名の」这类半截文本）
      if (!v) { ctx.missing = true; return ''; }
      return v;
    });
  }

  /**
   * 生成 *label_0405 的名称片段（按规则顺序累加）。
   * @returns {string} 片段；无命中 / 无表时返回 ''
   */
  function prefix(it, lang) {
    const t = table();
    if (!t || !it) return '';
    const L = String(lang || 'en').toLowerCase();
    const ctx = { it, lang: L, missing: false };
    let out = '';
    for (const r of t.rules) {
      if (SKIP_IDS.indexOf(it.id | 0) >= 0 && r.cond.some((c) => c.k === 'f3')) continue;
      let ok = true;
      for (const c of r.cond || []) {
        const v = evalCond(c, ctx);
        if (v !== true) { ok = false; break; }
      }
      if (!ok) continue;
      const add = r.add;
      if (add.k === 'lit') {
        ctx.missing = false;
        const tpl = L === 'jp' ? add.jp : add.en;
        const s = render(tpl, ctx);
        if (!ctx.missing && s) out += s;
      } else if (add.k === 'baseName' && Elona.ItemDB) {
        // 30135：1005 果汁会临时把 id 换成 f23，取该物品的基础名
        const id = field(it, 23);
        if (id) out += String(Elona.ItemDB.name(id, L) || '');
      }
    }
    return out;
  }

  const ItemNameExtra = {
    SKIP_IDS,
    table, prefix, evalCond, render,
    ready(data) { cached = (data && data.rules) ? data : null; return this; },
    count() { const t = table(); return t ? t.rules.length : 0; },
  };

  Elona.ItemNameExtra = ItemNameExtra;
  if (typeof module !== 'undefined' && module.exports) module.exports = ItemNameExtra;
})(typeof window !== 'undefined' ? window : global);
