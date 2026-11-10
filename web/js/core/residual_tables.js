'use strict';
/**
 * A 组：数据表 / 文案 / 系数 —— 运行时查询与执行（core/residual_tables.js）
 *
 * 【源码依据 hsp/start.hsp，逐段编译为 web/data/tables/residual_tables.json】
 *   28256-28659  物品材质 / 类别名与系数表（var_679/680/681/682/683/684，38 类 + 7 固定名）
 *   28664-28753  随机成长量与材质档位选择（var_685/686）
 *   28754-28803  物品重量重算（var_99(22) 基准值公式）
 *   28804-28873  物品重量 × 类别系数（var_680 惩罚表与 28816-28869 缩放）
 *   28874-28888  附魔 / 位标志回填（var_681/682）
 *   19710-19956  talk.txt 口调语料按 cbit(1049) 等 45 条优先链 + 2 条兜底
 *   8313-8374    #defcfunc he 主语文案
 *   8375-8451    #defcfunc his 所有格文案
 *   8452-8513    #defcfunc him 宾语文案
 *   8664-8696    #defcfunc cnvdate 日期格式文案（/ 取商、\ 取余，248737 行佐证）
 *   279724-279808 blendlist 调合配方候选扫描（8 条跳过规则 / 3 档目标分类）
 *   280568-280650 *label_2647 配方筛选（菜单 / 最小堆叠 / 结果分支）
 *   282974-283053 #defcfunc txtitemoncell 地上物品文案（睡眠评价 / 炼金术士彩蛋）
 *   29670-29715  #deffunc item_compress 物品堆叠压缩（200*(cnt²+1) 阈值）
 *   29812-29850  #deffunc item_separatefish 渔获按尺寸拆分
 *   37329-37386  #deffunc conv_crlf 换行规整：与 core/textutil.js 同源等价封装
 *   37414-37431  #deffunc rm_crlf 删除 CR/LF：与 core/textutil.js 同源等价封装
 *   223812-223954 *label_2290 全角色时间推进（时间换算常量 / 干燥 / 腐败）
 *   335-363      *label_0026 早期排行称号文本表（var_66/67）
 *   5031-5035    *label_0042 开局内存声明（var_92/93/94）
 *   12475-12478  #defcfunc txtbuilding 建筑名
 *   211702-211713 #defcfunc cnveqweight 装备重量换算
 *   26150-26168  #deffunc flt 物品生成过滤标志
 *   279423-279448 #defcfunc rpmatname 材质名
 *   302735-302744 #defcfunc getnpctxt NPC 语料解析
 *   342404-342485 *label_2979 物品重量差额记录
 *
 * 【数据加载】测试环境用 Elona.ResidualTablesData 直接注入；浏览器环境走
 *   Elona.Data.tableSync('residual_tables')。参考 core/itemnamex.js 的 ready()/table() 模式。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let cached = null;

  function table() {
    if (!cached) {
      cached = (Elona.ResidualTablesData && Elona.ResidualTablesData.ranges)
        ? Elona.ResidualTablesData : null;
      if (!cached && Elona.Data && Elona.Data.tableSync) {
        try { cached = Elona.Data.tableSync('residual_tables'); } catch (e) { cached = null; }
      }
    }
    return cached;
  }

  // ---------------------------------------------------------------- 基础工具
  function idiv(a, b) { return b === 0 ? 0 : Math.trunc(a / b); }
  function imod(a, b) { return a - idiv(a, b) * b; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lang(L) { return L === 'jp' ? 'jp' : 'en'; }
  function cmp(a, op, v) {
    switch (op) {
      case '==': return a === v;
      case '!=': return a !== v;
      case '<=': return a <= v;
      case '>=': return a >= v;
      case '<': return a < v;
      case '>': return a > v;
      case 'in': return v.indexOf(a) >= 0;
      default: return false;
    }
  }

  // ================================================================ 材质表 28256-28659
  /** 取 var_400 类别块（38 个）的日/英名、var_680 系数、var_681 附魔、var_682 位标志 */
  function category(index, L) {
    const D = table(); if (!D) return null;
    const c = D.materials.categories[String(index)];
    if (!c) return null;
    const jp = c.names[0] || [], en = c.names[1] || [];
    return {
      idx: c.idx, src: c.src, coefSrc: c.coefSrc, enchSrc: c.enchSrc, flagsSrc: c.flagsSrc,
      jp: jp.slice(), en: en.slice(), name: (lang(L) === 'jp' ? jp : en).slice(),
      coef: (c.coef || []).slice(), enchants: (c.ench || []).slice(),
      flags: (c.flags || []).slice(),
    };
  }
  /** 36-42 的固定类别名 */
  function fixedName(index) {
    const D = table(); if (!D) return null;
    const f = D.materials.fixed[String(index)];
    return f ? { idx: Number(index), name: f.names.slice(), src: f.src, enSrc: f.enSrc } : null;
  }
  /** var_683/var_684：源码以 var_683(var_400, var_686) 索引，等价于 rows[level][tier] */
  function groupAt(name, tier, level) {
    const D = table(); if (!D) return 0;
    const g = D.materials.groups[name];
    if (!g) return 0;
    const row = g.rows[level];
    return row ? (row[tier] | 0) : 0;
  }
  function categoryCount() { const D = table(); return D ? D.materials.order.length : 0; }
  function categoryOrder() { const D = table(); return D ? D.materials.order.slice() : []; }

  // ================================================================ 成长量 28664-28753
  /** 28680-28694：rnd(100) → 材质档位 0..3 */
  function tierOf(r) {
    const D = table(); if (!D) return 0;
    const t = D.growth.tier;
    for (let i = 0; i < t.length; i++) {
      if (t[i].lt !== undefined && r < t[i].lt) return t[i].tier | 0;
    }
    return t[t.length - 1].else | 0;
  }

  /**
   * 执行 *label_0353 的材质选择链，返回 var_99(24)（材质 id）。
   * ctx: { rnd(n), v58(i), var_685, var_577, var_687, var_688, var_657,
   *        var_640, id, f24 }（f24 / var_687 / var_688 会被就地消费）
   */
  function selectMaterial(ctx) {
    const D = table(); if (!D) return 0;
    const g = D.growth;
    let level;
    if (ctx.var_685) level = idiv(ctx.v58(38) | 0, g.fixedGrowth.div15) + 1;
    else level = idiv(ctx.rnd((ctx.var_640 | 0) + 1) | 0, g.fixedGrowth.div10) + 1;

    // 28671-28679：630 号物品先掷 1000/1001
    if ((ctx.id | 0) === g.special630.id) {
      level = ctx.rnd(level + 1) | 0;
      ctx.f24 = ctx.rnd(2) === 0 ? g.special630.rnd2[0] : g.special630.rnd2[1];
    }
    let tier = tierOf(ctx.rnd(100) | 0);
    if ((ctx.var_577 | 0) === g.ch577.val) { level = 0; tier = 0; }

    if ((ctx.var_687 | 0) !== 0) {
      const m = ctx.var_687 | 0;
      ctx.var_687 = 0;
      ctx.f24 = m;
      return ctx.f24 | 0;
    }
    if (level >= 5) level = g.cap.max;
    level = clamp((ctx.rnd(level + 1) | 0) + (ctx.var_688 | 0), 0, g.cap.max);
    ctx.var_688 = 0;
    if ((ctx.var_657 | 0) === g.cat60000.id) {
      ctx.f24 = ctx.rnd(2) === 0 ? g.cat60000.rnd2[0] : g.cat60000.rnd2[1];
    }
    if ((ctx.f24 | 0) === 1000) {
      const o = g.mat1000;
      let m = ctx.rnd(o.rndN) !== 0 ? groupAt(o.primary, tier, level)
                                    : groupAt(o.secondary, tier, level);
      if (level >= o.hi.levelGe && ctx.rnd(o.hi.rndN) === 0) m = o.hi.id;
      ctx.f24 = m;
    }
    if ((ctx.f24 | 0) === 1001) {
      const o = g.mat1001;
      let m = ctx.rnd(o.rndN) !== 0 ? groupAt(o.primary, tier, level)
                                    : groupAt(o.secondary, tier, level);
      if (level === o.lv1.levelEq && ctx.rnd(o.lv1.rndN) === 0) m = o.lv1.id;
      if (level === o.lv2.levelEq && ctx.rnd(o.lv2.rndN) === 0) m = o.lv2.id;
      ctx.f24 = m;
    }
    if (ctx.rnd(g.rnd25.rndN) === 0) ctx.f24 = g.rnd25.id;
    return ctx.f24 | 0;
  }

  // ================================================================ 重量 28754-28888
  /** 28767/28770/28772/28775：重算基准值 var_689 */
  function baseValue(f1, f23, cat, coef1) {
    const D = table(); if (!D) return f1 | 0;
    const w = D.weightRecalc;
    if ((cat | 0) === 60000) {
      let v = (f23 | 0) !== 0
        ? idiv((f1 | 0) * w.formula60000.mul,
               w.formula60000.add + (f23 | 0) * w.formula60000.f23mul)
        : (f1 | 0);
      return v - (coef1 | 0) * D.weightCoef.value60000.mul;
    }
    return idiv((f1 | 0) * w.formulaElse.mul,
                idiv(coef1 | 0, w.formulaElse.coefDiv) + w.formulaElse.add);
  }
  /** 28777-28781：任一骰字段非零则把 12/13/14/15 一并清零 */
  function clearDice(fields) {
    const D = table(); if (!D) return Object.assign({}, fields);
    const out = Object.assign({}, fields);
    const fs = D.weightRecalc.clearFields;
    let dirty = false;
    for (let i = 0; i < fs.length; i++) if ((out[fs[i]] | 0) !== 0) { dirty = true; break; }
    if (dirty) for (let i = 0; i < fs.length; i++) out[fs[i]] = 0;
    return out;
  }
  /** 28816-28825：var_641 → [主除数基准, 副值] */
  function penalty(var641) {
    const D = table(); if (!D) return [0, 0];
    const p = D.weightCoef.penalty;
    const v = var641 | 0;
    if (v === 1) return p[1].pair.slice();
    if (v === 3) return p[2].pair.slice();
    if (v >= 4) return p[3].pair.slice();
    return p[0].pair.slice();
  }
  /**
   * 执行 *label_0355：把 var_680 系数套到物品字段上（返回新字段对象）。
   * opts: { coef, cat, var_641, var_690, rnd(n) }
   */
  function applyWeightCoef(fields, opts) {
    const D = table(); if (!D) return Object.assign({}, fields);
    const w = D.weightCoef, out = Object.assign({}, fields);
    const coef = opts.coef || [], rnd = opts.rnd || function () { return 0; };
    const ci = w.coefIdx, fl = w.fields, sc = w.scales;
    out[7] = idiv((out[7] | 0) * (coef[w.field7.coefIdx] | 0), w.field7.div);
    if ((opts.cat | 0) === 60000) {
      out[1] = (out[1] | 0) + (coef[w.value60000.coefIdx] | 0) * w.value60000.mul;
    } else {
      out[1] = idiv((out[1] | 0) * w.valueElse.base,
                    idiv(coef[w.valueElse.coefIdx] | 0, w.valueElse.div) + w.valueElse.add);
    }
    if ((out[22] | 0) === 0) out[22] = coef[w.field22.coefIdx] | 0;
    const pair = penalty(opts.var_641 | 0);
    const keys = ['hit', 'dv', 'pv', 'dmg'];
    const c11 = coef[ci.f11] | 0;
    if ((opts.var_690 | 0) === 100) {
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i], F = fl[k], v = out[F] | 0;
        if (v > 0) out[F] = idiv((coef[ci[k]] | 0) * v * sc[k], pair[0] - 29);
        else if (v < 0) out[F] = idiv((coef[ci[k]] | 0) * v * sc[k], pair[0]);
      }
      if ((out[fl.f11] | 0) !== 0) out[fl.f11] = idiv((out[fl.f11] | 0) * c11, pair[0]);
    } else if ((opts.var_690 | 0) === 0) {
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i], F = fl[k];
        if ((out[F] | 0) !== 0)
          out[F] = idiv((coef[ci[k]] | 0) * (out[F] | 0) * sc[k], pair[0] - rnd(30));
      }
      if ((out[fl.f11] | 0) !== 0)
        out[fl.f11] = idiv((out[fl.f11] | 0) * c11, pair[0] + rnd(25));
    }
    return out;
  }
  /** 28874-28888：按材质回放 var_681 附魔与 var_682 位标志 */
  function materialEnchants(index) {
    const D = table(); if (!D) return [];
    const c = D.materials.categories[String(index)];
    if (!c || !c.ench) return [];
    const out = [], e = c.ench;
    for (let i = 0; i + 1 < e.length && i / 2 < D.applyMat.enchRepeat; i += 2) {
      if ((e[i] | 0) === 0) break;
      out.push({ id: e[i] | 0, power: e[i + 1] | 0 });
    }
    return out;
  }
  function materialBits(index) {
    const D = table(); if (!D) return [];
    const c = D.materials.categories[String(index)];
    if (!c || !c.flags) return [];
    const out = [];
    for (let i = 0; i < c.flags.length && i < D.applyMat.bitRepeat; i++) {
      const b = c.flags[i] | 0;
      if (b === 0) break;
      out.push(b);
    }
    return out;
  }

  // ================================================================ talk.txt 口调 19710-19956
  function evalClause(c, ctx) {
    switch (c.k) {
      case 'cbit': return (ctx.cbit(c.bit) | 0) === c.eq;
      case 'v58': return cmp(ctx.v58(c.i) | 0, c.op, c.v);
      case 'v58or': {
        const v = ctx.v58(c.i) | 0;
        const hit = c.ranges.some(function (r) { return v >= r[0] && v < r[1]; });
        return hit || c.eq.indexOf(v) >= 0;
      }
      case 'v65': return cmp(ctx.v65(c.i) | 0, c.op, c.v);
      case 'v132': {
        const j = typeof c.j === 'object' ? (ctx.v65(c.j.v65) | 0) : c.j;
        return cmp(ctx.v132(c.i, j) | 0, c.op, c.v);
      }
      case 'v132t': {
        const j = typeof c.j === 'object' ? (ctx.v65(c.j.v65) | 0) : c.j;
        return (ctx.v132(c.i, j) | 0) !== 0;
      }
      case 'ch': return cmp(ctx.v244 | 0, c.op, c.v);
      case 'rnd': return cmp(ctx.rnd(c.n) | 0, c.op, c.v);
      case 'rndT': return (ctx.rnd(c.n) | 0) !== 0;
      case 'any': return c.of.some(function (x) { return evalClause(x, ctx); });
      default: return false;
    }
  }
  function evalCond(cond, ctx) {
    for (let i = 0; i < cond.length; i++) if (!evalClause(cond[i], ctx)) return false;
    return true;
  }
  function buildKey(parts, ctx) {
    const D = table(); if (!D) return '';
    let s = '';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (Object.prototype.hasOwnProperty.call(p, 'lit')) s += p.lit;
      else if (Object.prototype.hasOwnProperty.call(p, 'lang'))
        s += ctx.lang === 'jp' ? D.talkTone.langToken.jp : D.talkTone.langToken.en;
      else if (Object.prototype.hasOwnProperty.call(p, 'v65')) s += String(ctx.v65(p.v65) | 0);
      else if (Object.prototype.hasOwnProperty.call(p, 'v58')) s += String(ctx.v58(p.v58) | 0);
    }
    return s;
  }
  /**
   * 按 19716-19944 的优先链选出 talk.txt 的检索标记（含 lang 的 JP/EN 后缀）。
   * ctx: { lang, v244, cbit(bit), v58(i), v65(i), v132(i,j), rnd(n) }
   */
  function selectTone(ctx) {
    const D = table(); if (!D) return '';
    for (let i = 0; i < D.talkTone.rules.length; i++) {
      const r = D.talkTone.rules[i];
      if (evalCond(r.cond, ctx)) return buildKey(r.key, ctx);
    }
    for (let i = 0; i < D.talkTone.fallback.length; i++) {
      const r = D.talkTone.fallback[i];
      if (evalCond(r.cond, ctx)) return buildKey(r.key, ctx);
    }
    return buildKey(D.talkTone.fallback[D.talkTone.fallback.length - 1].key, ctx);
  }
  function toneRuleCount() { const D = table(); return D ? D.talkTone.rules.length : 0; }
  function toneFallbackCount() { const D = table(); return D ? D.talkTone.fallback.length : 0; }

  // ================================================================ 代词 8313-8513
  function pronoun(fname, ch, custom, ctx) {
    const D = table(); if (!D) return '';
    const f = D.pronouns.funcs[fname];
    if (!f) return '';
    const L = lang(ctx.lang), GW = D.pronouns.genderWords[L];
    const c = ch | 0;
    if (custom) {
      if (fname === 'his' && L === 'jp' && c === 0) return f.selfJp.text;
      for (let i = 0; i < f.custom.length; i++) {
        const r = f.custom[i];
        let hit = false;
        for (let a = 0; a < r.m.length && !hit; a++)
          for (let b = 0; b < r.m[a].length; b++)
            if (GW[r.m[a][b]] === ctx.gender) { hit = true; break; }
        if (hit) return L === 'jp' ? r.jp : r.en;
      }
      const fb = L === 'jp' ? f.fallbackJp : f.fallbackEn;
      if (fb.self !== undefined && c === 0) return fb.self;
      return (ctx.sex | 0) === 0 ? fb.sex0 : fb.sex1;
    }
    const n = f.normal;
    if (c < D.pronouns.bounds.lo || c >= D.pronouns.bounds.hi) return n.oob;
    if (ctx.syncOk === false) return n.sync0;
    if (c === 0) return n.self;
    return (ctx.sex | 0) === 0 ? n.sex0 : n.sex1;
  }
  function he(ch, custom, ctx) { return pronoun('he', ch, custom, ctx); }
  function his(ch, custom, ctx) { return pronoun('his', ch, custom, ctx); }
  function him(ch, custom, ctx) { return pronoun('him', ch, custom, ctx); }

  // ================================================================ cnvdate 8664-8696
  function formatDate(hours, mode, L) {
    const D = table(); if (!D) return '';
    const c = D.cnvdate;
    let T = Math.trunc(hours) | 0;
    const hour = imod(T, 24);
    let day = imod(idiv(T, 24), 30);
    if (day === 0) { day = 30; T -= 24 * 30; }
    let month = imod(idiv(idiv(T, 24), 30), 12);
    if (month === 0) { month = 12; T -= 24 * 30 * 12; }
    const year = idiv(idiv(idiv(T, 24), 30), 12);
    const m = mode | 0;
    let s;
    if (lang(L) === 'jp') {
      s = '' + year + c.jp.year + month + c.jp.month + day + c.jp.day;
      if (m === 1) s += hour + c.jp.hour;
      else if (m === 2) s = '' + month + c.jp.month + day + c.jp.day + hour + c.jp.hour;
    } else {
      s = '' + year + c.en.sep + month + c.en.dateSep + day + c.en.sep;
      if (m === 1) s += hour + c.en.hour;
      else if (m === 2) s = '' + month + c.en.dateSep + day + c.en.sep + hour + c.en.hour;
    }
    return s;
  }

  // ================================================================ 调合 279724-280650
  function classifyTarget(v) {
    const D = table(); if (!D) return '';
    const c = D.blendCandidates.classify;
    v = v | 0;
    if (v < 9000) return c[0].mode;
    if (v < 10000) return c[1].mode;
    return c[2].mode;
  }
  function candidateSkipRules() {
    const D = table(); return D ? D.blendCandidates.skipRules.slice() : [];
  }
  function candidateCap() { const D = table(); return D ? D.blendCandidates.maxResults : 0; }
  function blendMenu(L) {
    const D = table(); if (!D) return [];
    return D.blendFilter.menu.map(function (x) {
      return { jp: x.jp, en: x.en, key: x.key, text: lang(L) === 'jp' ? x.jp : x.en, src: x.src };
    });
  }
  function blendResultAction(var444) {
    const D = table(); if (!D) return '';
    const bs = D.blendFilter.resultBranches;
    for (let i = 0; i < bs.length; i++) if (String(bs[i].var444) === String(var444)) return bs[i].action;
    return bs[bs.length - 1].action;
  }

  // ================================================================ 地上物品 282974-283053
  function joinWord(L) {
    const D = table(); if (!D) return '';
    return lang(L) === 'jp' ? D.itemOnCell.joinWord.jp : D.itemOnCell.joinWord.en;
  }
  /** 282980：把 -var_704 拆成 3 个 5080 基址的堆叠下标 */
  function decodeStack(neg) {
    const D = table(); if (!D) return [];
    const d = D.itemOnCell.stackDecode, v = Math.abs(neg | 0), out = [];
    out.push(idiv(v, 1) % 1000 + d.base);
    out.push(idiv(v, 1000) % 1000 + d.base);
    out.push(idiv(v, 1000000) % 1000 + d.base);
    return out.map(function (x) { return x === d.skip ? null : x; });
  }
  function sleepNote(id, L) {
    const D = table(); if (!D) return '';
    const ns = D.itemOnCell.sleepNotes;
    for (let i = 0; i < ns.length; i++)
      if (ns[i].ids.indexOf(id | 0) >= 0)
        return lang(L) === 'jp' ? ns[i].jp : ns[i].en;
    return '';
  }
  function alcNote(id, L, isAlchemist) {
    const D = table(); if (!D || !isAlchemist) return '';
    const ns = D.itemOnCell.alcNotes;
    for (let i = 0; i < ns.length; i++)
      if (ns[i].id === (id | 0)) return lang(L) === 'jp' ? ns[i].jp : ns[i].en;
    return '';
  }
  /** 生成 txtitemoncell 全文 */
  function groundText(o, L) {
    const D = table(); if (!D) return '';
    const t = D.itemOnCell;
    if ((o.count | 0) > D.itemOnCell.fewThreshold)
      return (lang(L) === 'jp' ? t.many.jp : t.many.en).replace('{n}', String(o.count | 0));
    let s = '';
    const f21 = o.f21 | 0;
    let tpl;
    if (f21 <= 0) tpl = t.templates[0];
    else if (f21 === 3) tpl = t.templates[1];
    else tpl = t.templates[2];
    s += (lang(L) === 'jp' ? tpl.jp : tpl.en).replace('{name}', String(o.name || ''));
    s += sleepNote(o.id, L);
    s += alcNote(o.id, L, o.isAlchemist);
    return s;
  }

  // ================================================================ 堆叠 / 渔获 29670-29850
  /** 29673：200 * (cnt*cnt + 1) */
  function compressThreshold(cnt) {
    const D = table(); if (!D) return 0;
    return D.itemCompress.threshold.mul * ((cnt * cnt) + 1);
  }
  /** 29812-29831：渔获拆分 */
  function splitFish(count) {
    const D = table(); if (!D) return { keep: count | 0, made: null };
    const c = count | 0;
    if (c <= D.separateFish.noSplitBelow) return { keep: c, made: null };
    return { keep: D.separateFish.splitRule.kept, made: c - 1 };
  }
  function fishNoFreeSlot(L) {
    const D = table(); if (!D) return '';
    const t = D.separateFish.noFreeSlot;
    return lang(L) === 'jp' ? t.jp : t.en;
  }
  function fishGround(L) {
    const D = table(); if (!D) return '';
    const t = D.separateFish.ground;
    return lang(L) === 'jp' ? t.jp : t.en;
  }

  // ================================================================ CRLF 37329-37431（同源等价封装）
  function idCrlf(s) {
    const t = String(s == null ? '' : s);
    if (t.indexOf('\n') >= 0) return 0;
    if (t.indexOf('\r') >= 0) return 1;
    return 100;
  }
  function convCrlf(s, mode) {
    const t = String(s == null ? '' : s);
    if (!t.length) return t;
    const m = mode | 0;
    if (m > 2 || m < 0) return t;
    const d = idCrlf(t);
    if (d === 100 || d === m) return t;
    const oldSep = d === 0 ? '\n' : '\r';
    const newSep = m === 0 ? '\n' : (m === 1 ? '\r' : '\n');
    return t.split(oldSep).join(newSep);
  }
  function rmCrlf(s) { return String(s == null ? '' : s).replace(/[\r\n]/g, ''); }
  function toLf(s) {
    return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  // ================================================================ 时间推进 223812-223954
  function toHours(h, d, m, y) {
    const D = table(); if (!D) return 0;
    const c = D.timeAdvance.toHours;
    return (h | 0) * c.hour + (d | 0) * c.day + (m | 0) * c.month + (y | 0) * c.year;
  }

  // ================================================================ 其余小段
  function rankTitle(row, rank, L) {
    const D = table(); if (!D) return '';
    const t = D.rankTitles[lang(L)][String(row)];
    return t ? (t[rank] || '') : '';
  }
  function eqWeightBand(w, L) {
    const D = table(); if (!D) return '';
    const bs = D.cnvEqWeight.bands;
    for (let i = 0; i < bs.length; i++) {
      if (bs[i].ge === null || (w | 0) >= bs[i].ge)
        return lang(L) === 'jp' ? bs[i].jp : bs[i].en;
    }
    return '';
  }
  function buildingText(name, L) {
    const D = table(); if (!D) return '';
    return (lang(L) === 'jp' ? D.building.jp : D.building.en)
      .replace('{name}', String(name || ''));
  }
  function fltLevels(objLv, fixLv) {
    const D = table(); if (!D) return { obj: 0, fix: 0 };
    return {
      obj: (objLv | 0) === 0 ? D.flt.objLv.zero : (objLv | 0),
      fix: (fixLv | 0) === 0 ? D.flt.fixLv.zero : (fixLv | 0),
      objField: D.flt.objLv.field, fixField: D.flt.fixLv.field,
    };
  }
  function materialNameClass(v) {
    const D = table(); if (!D) return '';
    const c = D.rpmatname.classify;
    v = v | 0;
    if (v < 9000) return c[0].via;
    if (v < 10000) return c[1].via;
    return c[2].via;
  }
  function extLabel(v, charName, L) {
    const D = table(); if (!D) return '';
    const e = D.rpmatname.ext;
    if ((v | 0) < e.ge) return '';
    const idx = idiv(v | 0, e.div);
    if (idx < 0 || idx >= e.max) return e.bugged;
    return String(charName || '') + (lang(L) === 'jp' ? e.corpseJp : e.corpseEn);
  }
  /** 302735-302744：从语料缓冲里按 key 取引号内文本 */
  function getnpctxt(key, fallback, buffer) {
    const D = table(); if (!D) return fallback;
    const b = String(buffer == null ? '' : buffer);
    const p = b.indexOf(key);
    if (p === -1) return fallback;
    const q = b.indexOf(D.getnpctxt.quote, p);
    if (q === -1) return fallback;
    const e = b.indexOf(D.getnpctxt.quote, q + 1);
    const rel = e === -1 ? -1 : (e - (q + 1));
    const len = clamp(rel, 0, D.getnpctxt.maxLen);
    return b.substr(q + 1, len);
  }
  function dropDelta(f0, amount) {
    const D = table(); if (!D) return 0;
    return (f0 | 0) - (amount | 0);   // 342405 var_2521
  }
  function dropSerial(counter) {
    const D = table(); if (!D) return { serial: 0, f26: 0 };
    const s = D.dropWeight.serial;
    const serial = (counter | 0) + s.base;
    return { serial: serial, f26: serial > s.over ? s.f26 : 0, counterNext: (counter | 0) + 1 };
  }

  // ================================================================ API
  const ResidualTables = {
    ready(data) { cached = (data && data.ranges) ? data : null; return this; },
    table,
    ranges() { const D = table(); return D ? D.ranges.slice() : []; },
    count() { const D = table(); return D ? Object.keys(D).length : 0; },

    category, fixedName, groupAt, categoryCount, categoryOrder,
    tierOf, selectMaterial,
    baseValue, clearDice, penalty, applyWeightCoef, materialEnchants, materialBits,
    selectTone, toneRuleCount, toneFallbackCount, evalCond, evalClause, buildKey,
    he, his, him,
    formatDate,
    classifyTarget, candidateSkipRules, candidateCap, blendMenu, blendResultAction,
    joinWord, decodeStack, sleepNote, alcNote, groundText,
    compressThreshold, splitFish, fishNoFreeSlot, fishGround,
    idCrlf, convCrlf, rmCrlf, toLf,
    toHours,
    rankTitle, eqWeightBand, buildingText, fltLevels,
    materialNameClass, extLabel, getnpctxt, dropDelta, dropSerial,
  };

  Elona.ResidualTables = ResidualTables;
  if (typeof module !== 'undefined' && module.exports) module.exports = ResidualTables;
})(typeof window !== 'undefined' ? window : globalThis);
