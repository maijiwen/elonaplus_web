'use strict';
/**
 * 玩家 feat（特性/变异）系统 —— 对应原版：
 *   var_97(id)                     feat 等级（正 = 特性，负 = 变异/缺陷）
 *   var_98(abilityId - 600)        能力解锁标志（var_81 为能力名表）
 *   *label_0043 (5036-6294)        feat 说明/效果分派（var_95 = feat id，var_96 = 0 文本 / 1 效果）
 *   *label_0044 (6295-6334)        种族初始 feat
 *   *label_2607 (272116-272289)    信仰神对属性/技能成长的加成（var_58(61)=神，var_58(62)=信仰值）
 *   *label_2225 (216702-216733)    负重上限/负重档位（var_58(43/44/45)）与 refreshspeed 0
 *
 * 数据结构（web/data/tables/feats.json，由 tools/extract_feats.py 机械提取）：
 *   { feats: { "205": {name, ops:[if|else|end|stmt], raw} },
 *     raceFeats: { "dwarf": {"152":2, "155":1}, ... },
 *     godBonus: { "3": {ops, raw}, ... } }
 *
 * 表达式/语句解释器只覆盖 *label_0043 / *label_2607 实际出现的语法：
 *   var_58(var_691) / var_82(var_691) / var_97 / var_98 / var_95
 *   limit / 四则（HSP 整除）/ if-else-end / cbitmod
 * 任何未覆盖语句都会记入 unimpl（不静默当作 0）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  let DATA = null;
  let ABILITIES = null;

  async function loadTable() {
    if (DATA) return DATA;
    DATA = await Elona.Data.table('feats');
    return DATA;
  }
  function setTable(t) { DATA = t; }
  async function loadAbilities() {
    if (ABILITIES) return ABILITIES;
    ABILITIES = await Elona.Data.table('abilities');
    return ABILITIES;
  }
  function setAbilities(t) { ABILITIES = t; }

  // ------------------------------------------------------------------
  // var_97 / var_98 存储（挂在 Chara 上，随存档序列化）
  // ------------------------------------------------------------------
  const FEAT_SLOTS = 500;
  function ensure(c) {
    if (!c.feats) c.feats = new Array(FEAT_SLOTS).fill(0);
    if (!c.featFlags) c.featFlags = {};
    return c;
  }
  function get(c, id) {
    if (!c || !c.feats) return 0;
    const v = c.feats[id];
    return v === undefined ? 0 : v;
  }
  function setFeat(c, id, v) {
    ensure(c);
    c.feats[id] = v | 0;
    return c.feats[id];
  }
  function addFeat(c, id, dv) { return setFeat(c, id, get(c, id) + (dv | 0)); }
  /** var_98(n)：n 为能力 id - 600（源码写法 var_98(601 - 600)） */
  function flag(c, n) {
    if (!c || !c.featFlags) return 0;
    const v = c.featFlags[n];
    return v === undefined ? 0 : v;
  }
  function setFlag(c, n, v) { ensure(c); c.featFlags[n] = v | 0; return c.featFlags[n]; }

  /** 种族初始 feat（*label_0044）：按种族键名写入 var_97 */
  function applyRaceFeats(c) {
    if (!DATA || !DATA.raceFeats) return [];
    const map = DATA.raceFeats[c.raceName];
    if (!map) return [];
    const ids = [];
    for (const k in map) { setFeat(c, parseInt(k, 10), map[k]); ids.push(parseInt(k, 10)); }
    return ids;
  }

  // ------------------------------------------------------------------
  // 表达式求值（复用 monster.js 的 HSP 子集 Parser）
  // ------------------------------------------------------------------
  function FeatCtx(c, g, featId) {
    this.c = c;
    this.g = g || null;
    this.featId = featId | 0;
    this.partyCount = 0;
    this.unimpl = [];
    this._seen = {};
  }
  FeatCtx.prototype.mark = function (s) {
    if (!this._seen[s]) { this._seen[s] = 1; this.unimpl.push(s); }
  };
  FeatCtx.prototype.call = function (name, args) {
    const A = args || [];
    const c = this.c;
    switch (name) {
      case 'limit': return limit(A[0], A[1], A[2]);
      case 'abs': return Math.abs(A[0] | 0);
      case 'int': return A[0] | 0;
      case 'rnd': return ((this.g && this.g.rng) || Elona.rng).rnd(A[0] | 0);
      case 'var_58': return c.get(A[0] | 0);
      case 'var_82': return c.skill(A[0] | 0);
      case 'var_97': return get(c, A[0] | 0);
      case 'var_98': return flag(c, A[0] | 0);
      case 'var_95': return this.featId;
      case 'var_691': return 0;
      case 'var_1457': return this.partyCount;
      case 'sorg': return (Elona.Stats && Elona.Stats.sorg) ? Elona.Stats.sorg(c, A[0] | 0) : 0;
      case 'var_65': return (this.g && this.g.getV65) ? this.g.getV65(A[0] | 0) : 0;
      case 'cbit': return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, A[0] | 0) : 0;
      default: break;
    }
    if (name.startsWith('var_')) {           // 未移植标量：记入 unimpl 并返回 0
      this.mark('sym:' + name);
      return 0;
    }
    this.mark('func:' + name);
    return 0;
  };

  function parser() {
    const P = Elona.CharaFactory && Elona.CharaFactory._internals
      && Elona.CharaFactory._internals.Parser;
    if (!P) throw new Error('feat.js 需要 monster.js 的 Parser');
    return P;
  }
  function evalExpr(src, ctx) {
    const P = parser();
    const p = new P(String(src), ctx);
    const v = p.Expr() | 0;
    if (p.i < String(src).trim().length) ctx.mark('trailing:' + String(src).slice(p.i));
    return v;
  }

  // ------------------------------------------------------------------
  // 语句执行
  // ------------------------------------------------------------------
  const ASSIGN = /^(var_58|var_82|var_97|var_98)\(([^)]*)\)\s*(\+\+|--|[+\-*/]?=)\s*(.*)$/;

  /** 取顶层逗号前的第一个参数（var_58(field, chara) 只用到 field；chara 恒为 0） */
  function firstArg(src) {
    let depth = 0;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) return src.slice(0, i);
    }
    return src;
  }

  function execStmt(s, ctx) {
    let m;
    m = /^cbitmod (-?\d+), 0, (-?\d+)$/.exec(s);
    if (m) {
      if (Elona.Status && Elona.Status.cbitmod) {
        Elona.Status.cbitmod(ctx.c, parseInt(m[1], 10), parseInt(m[2], 10) !== 0);
      }
      return;
    }
    m = ASSIGN.exec(s);
    if (m) {
      const kind = m[1], idx = evalExpr(firstArg(m[2]), ctx), op = m[3], rhs = m[4];
      const read = () => {
        if (kind === 'var_58') return ctx.c.get(idx);
        if (kind === 'var_82') return ctx.c.skill(idx);
        if (kind === 'var_97') return get(ctx.c, idx);
        return flag(ctx.c, idx);
      };
      const write = (v) => {
        if (kind === 'var_58') ctx.c.set(idx, v | 0);
        else if (kind === 'var_82') ctx.c.setSkill(idx, v | 0);
        else if (kind === 'var_97') setFeat(ctx.c, idx, v);
        else setFlag(ctx.c, idx, v);
      };
      let v = read();
      if (op === '++') v++;
      else if (op === '--') v--;
      else {
        const r = evalExpr(rhs || '0', ctx);
        if (op === '+=') v += r; else if (op === '-=') v -= r;
        else if (op === '*=') v *= r; else if (op === '/=') v = idiv(v, r);
        else v = r;
      }
      write(v);
      return;
    }
    ctx.mark('stmt:' + s.slice(0, 48));
  }

  function runOps(ops, ctx) {
    if (!ops) return;
    const cond = [];
    const active = () => cond.every((x) => x);
    for (const o of ops) {
      if (o.op === 'if') { cond.push(active() ? evalExpr(o.c, ctx) !== 0 : false); continue; }
      if (o.op === 'else') {
        if (cond.length) {
          const outer = cond.slice(0, -1).every((x) => x);
          cond[cond.length - 1] = outer ? !cond[cond.length - 1] : false;
        }
        continue;
      }
      if (o.op === 'end') { cond.pop(); continue; }
      if (!active()) continue;
      if (o.op === 'stmt') execStmt(o.s, ctx);
    }
  }

  // ------------------------------------------------------------------
  // *label_0043 效果应用（213855-213863）
  // ------------------------------------------------------------------
  /**
   * 应用全部玩家 feat 效果。
   * 原版：repeat 229 → if ( var_97(cnt) != 0 ) { var_95 = cnt ; gosub *label_0043 }
   * 应在属性修正之后、HP/MP/SP 计算之前调用（顺序见 Stats.applySkillCorrections 的注释）。
   * @returns {{unimpl:string[], applied:number[]}}
   */
  function apply(c, g) {
    const unimpl = [], applied = [];
    if (!DATA || !DATA.feats || !c) return { unimpl, applied };
    // var_1457（队伍人数）：*label_0043 里虽然目前没有 feat 用到，
    // 但与 *label_2229 保持同一取值，免得将来接上时默认成 0。
    let party = 0;
    const charas = (g && g.charas) || [];
    for (let k = 0; k < 16; k++) {
      const o = charas[k];
      if (!o || o.get(0) !== 1) continue;
      if (k === 0 || o.get(58) === 100) party++;
    }
    for (let id = 0; id < 229; id++) {
      if (get(c, id) === 0) continue;
      const f = DATA.feats[String(id)];
      if (!f || !f.ops || !f.ops.length) continue;
      const ctx = new FeatCtx(c, g, id);
      ctx.partyCount = party;
      runOps(f.ops, ctx);
      applied.push(id);
      for (const u of ctx.unimpl) unimpl.push('feat' + id + ':' + u);
    }
    return { unimpl, applied };
  }

  // ------------------------------------------------------------------
  // *label_0043 的「说明模式」返回值 stat（var_96 == 0）
  // ------------------------------------------------------------------
  /**
   * `gosub *label_0043` 在 var_96 == 0（说明模式）下的返回值：
   *   0  该 id 没有说明块（未定义）
   *   1  正常
   *  -1  说明块里命中 `return -1`（取得条件不足，5313-5323 的盾殴り /
   *      5339-5349 的二刀流：sorg(168) / sorg(166) 为 0）
   *
   * `*label_2697`（285148）用 `if ( stat == 0 ) continue`，
   * 所以 -1 的条目**不会**进「取得できるフィート」。
   */
  function textStat(c, g, id) {
    if (!DATA || !DATA.feats) return 0;
    const f = DATA.feats[String(id | 0)];
    if (!f) return 0;
    if (f.req && f.req.length) {
      const ctx = new FeatCtx(c, g, id);
      for (const cond of f.req) {
        let v = 0;
        try { v = evalExpr(cond, ctx) | 0; } catch (e) { v = 0; }
        if (v !== 0) return -1;
      }
    }
    return 1;
  }

  /** var_92(0)：0 = feat / 1 = 变异 / 2 = 先天 / 3 = エーテル病 */
  function catOf(id) {
    const f = DATA && DATA.feats && DATA.feats[String(id | 0)];
    return f && f.cat !== undefined ? (f.cat | 0) : 0;
  }

  /** var_92(2)：最高等级（缺省 1） */
  function maxLevelOf(id) {
    const f = DATA && DATA.feats && DATA.feats[String(id | 0)];
    const v = f && f.maxLevel !== undefined ? (f.maxLevel | 0) : 1;
    return v > 0 ? v : 1;
  }

  /**
   * 「取得できるフィート」的条目 id（285134-285157）。
   *
   * 源码对 0..228 逐个跑说明模式，命中 `stat == 1 && var_92 == 0` 就入表——
   * **不看是否已经取得**，所以两级以上的 feat（如 24 短距離走者）会同时
   * 出现在「可取得」和「已取得」两段里，可以在前者继续升到下一级。
   */
  function available(c, g) {
    const ch = c || (g && g.player);
    const out = [];
    if (!ch || !DATA || !DATA.feats) return out;
    const ids = Object.keys(DATA.feats).map((k) => parseInt(k, 10)).sort((a, b) => a - b);
    for (const id of ids) {
      if (catOf(id) !== 0) continue;               // var_92 != 0（变异/先天/エーテル病）不列
      if (textStat(ch, g, id) !== 1) continue;     // stat == 0 / -1 都不列
      out.push(id);
    }
    return out;
  }

  /**
   * 取得 / 升级一个 feat（285802-285837）。
   *
   *   var_65(93) > 0 → 选中项 `var_484(1) < 10000`（可取得段）→
   *     `var_92(2) <= var_97(id)` 时提示「これ以上取得できない」；
   *     否则 var_65(93)--、var_97(id)++、`*label_2174` 重算。
   *
   * @returns {{ok:boolean, reason?:string, level?:number, points?:number, maxLevel?:number}}
   */
  function take(g, id, c) {
    const ch = c || (g && g.player);
    id = id | 0;
    if (!ch) return { ok: false, reason: 'no-chara' };
    if ((ch.index | 0) !== 0) return { ok: false, reason: 'not-player' };   // 285135：var_244 == 0
    if (!g || !g.getV65) return { ok: false, reason: 'no-game' };
    const points = g.getV65(93) | 0;
    if (points <= 0) return { ok: false, reason: 'no-points' };             // 285803
    const stat = textStat(ch, g, id);
    if (stat === 0) return { ok: false, reason: 'unknown' };                // 285148
    if (stat === -1) return { ok: false, reason: 'requirement' };           // 不入「可取得」段
    const maxLv = maxLevelOf(id);
    const lv = get(ch, id) | 0;
    if (maxLv <= lv) return { ok: false, reason: 'max', maxLevel: maxLv };   // 285809
    g.setV65(93, points - 1);                                               // 285819
    setFeat(ch, id, lv + 1);                                                // 285822
    if (Elona.Stats && Elona.Stats.recalcStats) Elona.Stats.recalcStats(ch, g);  // 285824 label_2174
    return { ok: true, id, level: lv + 1, points: points - 1, maxLevel: maxLv };
  }

  /** *label_2607：信仰神对属性/技能成长的加成（var_58(61) = 神 id） */
  function applyGodBonus(c, g) {
    const unimpl = [];
    if (!DATA || !DATA.godBonus || !c) return { unimpl, applied: false };
    const god = c.get(61) | 0;
    if (!god) return { unimpl, applied: false };
    const e = DATA.godBonus[String(god)];
    if (!e || !e.ops || !e.ops.length) return { unimpl, applied: false };
    const ctx = new FeatCtx(c, g, -1);
    runOps(e.ops, ctx);
    for (const u of ctx.unimpl) unimpl.push('god' + god + ':' + u);
    return { unimpl, applied: true };
  }

  /**
   * *label_2229（216817-218228）：按当前技能/属性/队伍状态解锁能力。
   * 每条能力 = `if (<cond>) { if (var_98(id-600)==0) var_98(id-600)=1 }`。
   * @returns {{unlocked:number[], unimpl:string[]}}
   */
  function unlockAbilities(c, g) {
    const unlocked = [], unimpl = [];
    if (!ABILITIES || !ABILITIES.abilities || !c) return { unlocked, unimpl };
    // var_1457：玩家 + var_58(58)==100 的队友（216818-216826）
    let party = 0;
    const charas = (g && g.charas) || [];
    for (let cnt = 0; cnt < 16; cnt++) {
      const o = charas[cnt];
      if (!o || o.get(0) !== 1) continue;
      if (cnt === 0 || o.get(58) === 100) party++;
    }
    const ctx = new FeatCtx(c, g, -1);
    ctx.partyCount = party;
    for (const a of ABILITIES.abilities) {
      const idx = (a.id | 0) - 600;
      if (flag(c, idx) !== 0) continue;
      if (evalExpr(a.cond, ctx) !== 0) {
        setFlag(c, idx, 1);
        unlocked.push(a.id);
      }
    }
    for (const u of ctx.unimpl) unimpl.push('ability:' + u);
    return { unlocked, unimpl };
  }

  // ------------------------------------------------------------------
  // *label_2225：负重（216702-216733）
  // ------------------------------------------------------------------
  /** inv_weight(0)：背包内物品重量合计（var_99(7) = 重量，可为负 = 钱等）
   *  源码 29738-29756：prm_606 == 0（玩家背包）时先把 var_65(80) 清零，
   *  再把「负重量物品」的重量（取绝对值）累加进 var_65(80)（荷车重量）。 */
  function invWeight(c, g) {
    let w = 0, neg = 0;
    for (const it of (c && c.inv) || []) {
      if (!it || !it.f || !it.f[0]) continue;
      const iw = it.f[7] | 0;
      if (iw >= 0) w += iw * it.f[0];
      else neg += -iw * it.f[0];
    }
    if (c.index === 0 && g && g.setV65) g.setV65(80, neg);
    return w;
  }

  /**
   * 计算 var_58(43) 负重上限、var_58(44) 负重阈值、var_58(45) 负重档位（0..4），
   * 末尾 refreshspeed（原码 216732）。
   */
  function applyWeight(c, g) {
    ensure(c);
    const hasBuff52 = !!(Elona.Status && Elona.Status.findbuff && Elona.Status.findbuff(c, 52) !== -1);
    const w = limit(invWeight(c, g), 0, 20000000);
    const f205 = get(c, 205), f201 = get(c, 201);
    c.set(43, hasBuff52
      ? idiv(w * (10 + f205 * 2), 10)
      : idiv(w * (10 - f201 + f205 * 2), 10));
    c.set(44, c.skill(10) * 500 + c.skill(11) * 250 + c.skill(153) * 2000 + 45000);
    const cap = c.get(43), thr = c.get(44);
    let tier = 0;
    if (cap > thr * 2) tier = 4;
    else if (cap > thr) tier = 3;
    else if (cap > idiv(thr, 4) * 3) tier = 2;
    else if (cap > idiv(thr, 2)) tier = 1;
    c.set(45, tier);
    if (Elona.Stats && Elona.Stats.refreshSpeed) Elona.Stats.refreshSpeed(c, g);
    return { weight: cap, threshold: thr, tier };
  }

  /**
   * 特性 / 病征名。
   * 【A24】英文模式（var_205）按原版 lang() 显示英文名：等级名取
   *   feats.json 的 levels[lv-1].en，没有等级名时回退条目原名（日文原文）。
   *   日文模式返回日文原字段，中文模式仍是项目既有的汉化名。
   * @param {number} id
   * @param {number} [lv] 等级（默认 1）
   * @param {string} [lang] 显式指定 'jp' / 'en' / 'ch'，不传时读 Options.language
   */
  function name(id, lv, lang) {
    const f = DATA && DATA.feats && DATA.feats[String(id)];
    if (!f) return '';
    const cur = lang || (Elona.Lang && Elona.Lang.current ? Elona.Lang.current() : 'ch');
    const n = Math.max(0, ((lv | 0) || 1) - 1);
    const byLevel = f.levels && f.levels[n];
    if (cur === 'en') return (byLevel && byLevel.en) || f.name || '';
    if (cur === 'jp') return (byLevel && byLevel.jp) || f.name || '';
    // 汉化：feats.json 的 nameCh 优先（缺条目回退日文原字段）
    return f.nameCh || f.name || '';
  }
  function table() { return DATA; }

  Elona.Feat = {
    loadTable, setTable, table,
    loadAbilities, setAbilities,
    get, set: setFeat, add: addFeat,
    flag, setFlag,
    textStat, catOf, maxLevelOf, available, take,
    applyRaceFeats, apply, applyGodBonus, unlockAbilities,
    invWeight, applyWeight,
    name,
    _internals: { FeatCtx, runOps, execStmt, evalExpr },
  };
})(window);
