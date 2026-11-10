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

  // =========================================================================
  // 0-GT / *label_0407（30951-31190）：物品名后缀
  // =========================================================================
  let cachedSuffix = null;
  function suffixTable() {
    if (!cachedSuffix) {
      cachedSuffix = (Elona.ItemNameSuffixData && Elona.ItemNameSuffixData.range)
        ? Elona.ItemNameSuffixData : null;
      if (!cachedSuffix && Elona.Data && Elona.Data.tableSync) {
        try { cachedSuffix = Elona.Data.tableSync('itemnamesuffix'); } catch (e) { cachedSuffix = null; }
      }
    }
    return (cachedSuffix && cachedSuffix.range) ? cachedSuffix : null;
  }

  /** `{f9}` / `{level}` / `{n}` 填充 */
  function fill(tpl, it, extra) {
    return String(tpl || '').replace(/\{f(\d+)\}/g, (_, n) => String(field(it, Number(n))))
      .replace(/\{level\}/g, String((extra && extra.level) || 0))
      .replace(/\{n\}/g, String((extra && extra.n) || 0));
  }

  /**
   * 生成 *label_0407 的后缀（按源码顺序累加）。
   * 只返回「装饰性」后缀；903 暗の棺 / 869 进化道具 / 1267 随机名 / 342 充能名
   * 已由 `ItemDB._instanceBody`、`core/necro.js` 或缺失的 var_721 表承担，这里跳过。
   * @param {object} it
   * @param {string} lang 'jp' | 'en'
   * @returns {string}
   */
  function suffix(it, lang) {
    const t = suffixTable();
    if (!t || !it) return '';
    const L = String(lang || 'en').toLowerCase() === 'jp' ? 'jp' : 'en';
    const id = it.id | 0;
    const f = (n) => field(it, n);
    const S = t.single || {};
    const pick = (key, extra) => fill((S[key] || {})[L] || '', it, extra);
    const cat = catOf(it);
    let out = '';

    if (f(8) >= 3) {
      // 30952-30954：强化值
      if (f(20) !== 0) out += `+${f(20)} `;
      // 30956-30959：987/1008/988/989 的 f26 是投掷计数，显示前清零
      if (t.clearF26.indexOf(id) >= 0) {
        if ((it.f[26] | 0) !== 0) it.f[26] = 0;
      }
      // 30960-30971：LV 后缀
      if (f(26) !== 0 && t.lvIds.indexOf(id) >= 0) out += `(LV.${f(26)})`;
      if (id === (t.lvSingle[0] | 0)) out += `(LV.${f(26)})`;
      if (id === (t.lvCombined.id | 0)) {
        out += `(LV.${idiv(f(26) + f(27) + f(31), t.lvCombined.div | 0 || 10)})`;
      }
      // 30972-30974：充能次数
      if (ibit(4, it) === 1) out += pick('charges');
      // 30975-30981：食物等级
      if (cat === (t.rank.cat | 0) && f(25) !== 0 && f(26) !== 0) out += pick('rank');
      // 30982-30984：染料编号
      if (id === 519) out += pick('no');
      // 30996-30998：瓶塞发射器装弹数
      if (t.bullets.ids.indexOf(id) >= 0) out += pick('bullets');
      // 30999-31001：剩余回合
      if (id === (t.remain5.id | 0)) out += pick('remain5');
      // 31002-31072：变体名（陷阱 / 长枪 / 棺材以外的机关）
      const vs = (t.variants || {})[String(id)];
      if (vs) {
        let hit = null;
        for (const v of vs) {
          if (v.max !== undefined) { if (f(25) <= v.max) { hit = v; break; } }
          else if (f(25) === (v.f25 | 0)) { hit = v; break; }
        }
        if (hit) out += L === 'jp' ? hit.jp : hit.en;
      }
      // 31073-31084：「モードN」（f2 减基数）
      for (const m of (t.modes || [])) {
        if (id === (m.id | 0)) {
          const n = f(2) - (m.base | 0);
          out += L === 'jp' ? `モード${n}` : ` mode ${n}`;
        }
      }
      // 31132-31154：骰子表示 ` (XdY+Z)(N)`
      if (id !== (t.dice.skipId | 0)) {
        if (f(10) !== 0 || f(13) !== 0 || f(12) !== 0) {
          out += ' (';
          if (f(10) !== 0) {
            out += `${f(10)}d${f(11)}`;
            if (f(12) !== 0) out += f(12) > 0 ? `+${f(12)}` : `${f(12)}`;
            out += ')';
            if (f(13) !== 0) out += `(${f(13)})`;
          } else {
            out += `${f(13)},${f(12)})`;
          }
        }
      }
      // 31155-31157：命中 / 追加骰
      if (f(14) !== 0 || f(15) !== 0) out += ` [${f(14)},${f(15)}]`;
    }
    // 31159-31163：失物（原版只在英文模式显示）
    if (L === 'en' && (t.lostProperty.ids || []).indexOf(id) >= 0) out += pick('lost');
    // 31169-31176：怪物球
    if (id === (t.ball.id | 0)) {
      out += pick('ball', { level: f(26) });
    }
    // 31177-31185：容器锁等级
    if (cat === (t.lock.cat | 0) && f(25) !== 0 && f(26) > 1
        && id !== 784 && id !== 1105) {
      out += fill((S.lock || {})[L] || '', it, { n: f(26) });
    }
    return out;
  }

  function idiv(a, b) { return (b === 0 ? 0 : Math.trunc((a | 0) / (b | 0))); }

  const ItemNameExtra = {
    SKIP_IDS,
    table, prefix, evalCond, render,
    suffixTable, suffix,
    ready(data) { cached = (data && data.rules) ? data : null; return this; },
    count() { const t = table(); return t ? t.rules.length : 0; },
  };

  Elona.ItemNameExtra = ItemNameExtra;
  if (typeof module !== 'undefined' && module.exports) module.exports = ItemNameExtra;
})(typeof window !== 'undefined' ? window : global);
