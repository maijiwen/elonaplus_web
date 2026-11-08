'use strict';
/**
 * 怪物生成模块 —— 对应原版 characreate(192863) → *label_2238 / *label_2240 的选怪 + 建怪。
 *
 * 【数据来源（均由 tools/*.py 从 hsp/start.hsp 机械提取，数据与逻辑分离）】
 *   1) 选怪候选表 `*label_3105`（var_59==1）→ web/data/tables/monster.json（1164 条，**保持源码顺序**）
 *        每 species 一条：等级阈值 thr / 权重分子 num / var_637 类别 / var_638 指定 id / var_514 标签
 *        权重累加：var_1006 += num / (500 + abs(目标等级 - thr) * 400) + 1
 *   2) 生物定义表 `*label_4269`（var_59==3）→ creature.json（1163 条）
 *        每条含 `ops`（var_59==3 的语句序列，保留 if/else）、race/klass 链接（var_62 + gosub label_3103/3104）
 *   3) 种族/职业初始化 `*label_3103` / `*label_3104`（var_59==3）→ race_class.json 的 races/classes[].ops
 *   4) 建怪流程语句 `*label_2238` 收尾 / `*label_2240` / `*label_2216` → characreate.json（routines）
 *
 * 【本模块做什么】
 *   - `pick()`  —— 逐字复现 *label_3105 的加权轮盘（含 var_637/638/514/636 过滤器）。
 *   - `create()`—— 用一个**小型 HSP 语句解释器**按原顺序执行上述 ops：
 *         · creature ops → var_58 字段 / 名称 / 种族(gosub 3103) / 职业(gosub 3104)
 *         · label_2238 收尾 → var_58(25) 等级档 / shade 特例 / gosub label_2240
 *         · label_2240 → 年龄/身高/体重/外观/称号/职业标记 → gosub label_2216 → gosub label_2174
 *         · label_2216 → 按等级给 var_82(50..60) 与战斗技能默认值（skillinit）
 *         · label_2174 的 213908-213948 段 → HP/MP/SP 上限（本文件 statRecalc）
 *         · 收尾 var_58(50/55/52)=var_58(51/56/53)、var_58(13/16/18/188/198/199/160)
 *   - 解释器对**无法执行的语句**（装备生成 itemcreate、药水/城镇 NPC 特例、repeat 循环体等）
 *     记录到 `ctx.unimpl`，绝不臆造——这些在返回值 `unimplemented` 中如实列出。
 *
 * 【已知未移植（不臆造）】
 *   - 装备生成 *label_2236 / *label_2237（itemcreate / calcobjlv / calcfixlv）→ 怪物无初始装备
 *   - *label_2234（装备/物品生成）、*label_4283（名字生成）、*label_2889 等
 *   - label_2174 的 var_58(450..) cbit 基表 memcpy(var_1405) 与 calcbuff/label_2225/refreshspeed
 *     后的 var_58(88/403/67/70/71) 细节
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const STATUS_ATTR = { HP: 50, HP_MAX: 51, SP: 52, SP_MAX: 53, MP: 55, MP_MAX: 56, LEVEL: 38 };

  const MON = { data: null };     // monster.json
  const CRE = { data: null };     // creature.json
  const CRA = { data: null };     // characreate.json（routines）
  const RC = { data: null };      // race_class.json
  const NAMES = { data: null };   // names.json（data/name.csv 的音节表）

  // ========================================================================
  // 一、表达式求值器（HSP 子集：算术 / 比较 / & | / rnd / limit / 变量读取）
  // ========================================================================
  const CMP_OPS = ['==', '!=', '<=', '>=', '<', '>'];

  function Parser(src, ctx) { this.s = src; this.i = 0; this.ctx = ctx; }

  Parser.prototype.ws = function () { while (this.i < this.s.length && this.s[this.i] === ' ') this.i++; };
  Parser.prototype.eat = function (t) {
    this.ws();
    if (this.s.startsWith(t, this.i)) { this.i += t.length; return true; }
    return false;
  };
  // 【HSP 语义】`&` 与 `|` 为**同一优先级、从左到右**求值（不是 C 的 & 高于 |）。
  // 证据：*label_2219 (215605) `var_243 == 0 | var_58(9,var_243) == 10 & var_503(2) >= 20`
  //      只有按左到右解析为 `(玩家 | 同伴) & 自设陷阱(sub>=20)` 才符合游戏语义。
  Parser.prototype.Expr = function () {
    let v = this.Cmp();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === '|' && this.s[this.i + 1] !== '|') { this.i++; const r = this.Cmp(); v = (v || r) ? 1 : 0; }
      else if (c === '&' && this.s[this.i + 1] !== '&') { this.i++; const r = this.Cmp(); v = (v && r) ? 1 : 0; }
      else break;
    }
    return v;
  };
  Parser.prototype.And = function () {
    let v = this.Cmp();
    for (;;) {
      this.ws();
      if (this.s[this.i] === '&' && this.s[this.i + 1] !== '&') { this.i++; const r = this.Cmp(); v = (v && r) ? 1 : 0; }
      else break;
    }
    return v;
  };
  Parser.prototype.Cmp = function () {
    const l = this.Add();
    this.ws();
    for (const op of CMP_OPS) {
      if (this.s.startsWith(op, this.i)) {
        this.i += op.length;
        const r = this.Add();
        switch (op) {
          case '==': return l === r ? 1 : 0;
          case '!=': return l !== r ? 1 : 0;
          case '<': return l < r ? 1 : 0;
          case '>': return l > r ? 1 : 0;
          case '<=': return l <= r ? 1 : 0;
          case '>=': return l >= r ? 1 : 0;
        }
      }
    }
    return l;
  };
  Parser.prototype.Add = function () {
    let v = this.Mul();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === '+') { this.i++; v = (v + this.Mul()) | 0; }
      else if (c === '-') { this.i++; v = (v - this.Mul()) | 0; }
      else break;
    }
    return v;
  };
  Parser.prototype.Mul = function () {
    let v = this.Unary();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === '*') { this.i++; v = (v * this.Unary()) | 0; }
      else if (c === '/') { this.i++; v = idiv(v, this.Unary()); }
      // 注意：HSP 的 `\` 是**余数**（不是整除），与 "/" 不同（spell.js 里 f3\1000 亦证明）
      else if (c === '\\') { this.i++; const r = this.Unary(); v = r === 0 ? 0 : (v % r); }
      else break;
    }
    return v;
  };
  Parser.prototype.Unary = function () {
    this.ws();
    if (this.s[this.i] === '-') { this.i++; return -this.Unary(); }
    if (this.s[this.i] === '+') { this.i++; return this.Unary(); }
    return this.Primary();
  };
  Parser.prototype.Primary = function () {
    this.ws();
    if (this.s[this.i] === '(') {
      this.i++;
      const v = this.Expr();
      this.ws();
      if (this.s[this.i] === ')') this.i++;
      return v;
    }
    const m = /^(\d+)/.exec(this.s.slice(this.i));
    if (m) { this.i += m[1].length; return parseInt(m[1], 10); }
    const im = /^([A-Za-z_]\w*)/.exec(this.s.slice(this.i));
    if (!im) { this.ctx.unimpl('expr:' + this.s.slice(this.i, this.i + 24)); this.i++; return 0; }
    const name = im[1];
    this.i += name.length;
    this.ws();
    let args = null;
    if (this.s[this.i] === '(') {
      this.i++;
      args = [];
      this.ws();
      if (this.s[this.i] === ')') { this.i++; }
      else {
        for (;;) {
          args.push(this.Expr());
          this.ws();
          if (this.s[this.i] === ',') { this.i++; continue; }
          if (this.s[this.i] === ')') { this.i++; break; }
          this.ctx.unimpl('args:' + name);
          break;
        }
      }
    }
    return this.ctx.call(name, args);
  };

  /** 按 ctx 求值一个 HSP 表达式字符串 */
  function evalExpr(src, ctx) {
    const p = new Parser(String(src), ctx);
    const v = p.Expr() | 0;
    if (p.i < String(src).trim().length) ctx.unimpl('trailing:' + String(src).slice(p.i));
    return v;
  }

  /** 顶层逗号切分（忽略括号内与字符串内的逗号） */
  function splitTop(src) {
    const parts = [];
    let depth = 0, cur = '', inStr = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '"') inStr = !inStr;
      if (!inStr) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      }
      cur += c;
    }
    parts.push(cur);
    return parts.map((x) => x.trim());
  }

  function firstStringLiteral(src) {
    const m = /"((?:[^"\\]|\\.)*)"/.exec(src);
    return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null;
  }

  /** 按顶层 `+` 切分字符串表达式（忽略括号/字符串内的加号） */
  function splitPlus(src) {
    const out = [];
    let depth = 0, inStr = false, cur = '';
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '"') inStr = !inStr;
      if (!inStr) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === '+' && depth === 0) { out.push(cur); cur = ''; continue; }
      }
      cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  }

  /** 随机 NPC 名 —— 对照 randomname (25856-25899)，使用 data/name.csv 音节表 */
  function randomName(ctx) {
    // 源码依据：`*label_0316`（25901-26007）—— data/name.csv 音节表的随机抽取
    //（加载在 *label_0315 的 25843 `noteload "data\name.csv"`），对应
    // tools/extract_names.py → names.json + 本函数。
    const tab = NAMES.data;
    if (!tab || !tab.prefixJp || !tab.prefixJp.length) return '名無し';
    const rng = ctx.rng || Elona.rng;
    for (let tries = 0; tries < 100; tries++) {
      let s = tab.prefixJp[rng.rnd(tab.prefixJp.length)] || '';
      if (!s) continue;
      if (rng.rnd(8) === 0) s += 'ー';
      if (rng.rnd(5) !== 0) s += tab.suffixJp[rng.rnd(tab.suffixJp.length)] || '';
      if (s.length < 4) continue;
      if (s.length < 6 && rng.rnd(3) !== 0) continue;
      if (s.length < 8 && rng.rnd(2) !== 0) continue;
      if (s.charAt(0) === 'ー' || s.indexOf('ーッ') >= 0) continue;
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    return '名無し';
  }

  /**
   * 字符串表达式求值（var_63 赋值用）。
   * 支持 lang(jp,en)、"..."、var_63(n, var_581)、randomname()、cnven(...) 与 + 拼接。
   * 本项目按日文模式（var_52=1）取 lang 的第一个参数。
   */
  function evalStringExpr(src, ctx) {
    const s = String(src).trim();
    let m = /^lang\(([\s\S]*)\)$/.exec(s);
    if (m) {
      const parts = splitTop(m[1]);
      return evalStringExpr(parts[0] || '', ctx);
    }
    const plus = splitPlus(s);
    if (plus.length > 1) return plus.map((p) => evalStringExpr(p, ctx)).join('');
    const q = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
    if (q) return q[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    m = /^var_63\((\d+),\s*var_581\)$/.exec(s);
    if (m) return ctx.name63[parseInt(m[1], 10)] || '';
    if (/^randomname\(/.test(s)) return randomName(ctx);
    m = /^cnven\(([\s\S]*)\)$/.exec(s);
    if (m) {
      const t = evalStringExpr(m[1], ctx);
      return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    }
    const lit = firstStringLiteral(s);
    return lit === null ? '' : lit;
  }

  // ========================================================================
  // 二、解释上下文（执行一条 ops 序列）
  // ========================================================================
  function Ctx(g, chara) {
    this.g = g;
    this.c = chara;
    this.rng = (g && g.rng) || Elona.rng;
    this.var60 = 0;         // var_60   选定/指定的 creature id（-1 = 随机）
    this.var581 = chara.index;
    this.vars = {};         // var_582 / var_685 / var_1474 / var_1023 / ... 等标量
    this.v65 = {};          // var_65(n) 覆写（默认走 g.getV65）
    this.v121 = {};         // var_121(n) 字符串（装备槽串）
    this.pendRace = null;   // var_62
    this.mode = 3;          // var_59
    this.pot = {};          // skillinit 累加的「成长潜力」var_82(id+600)
    this.name63 = {};       // var_63(c, var_581)
    this.unimpl = [];       // 未支持语句记录
    this._seen = {};
  }
  Ctx.prototype.mark = function (s) { if (!this._seen[s]) { this._seen[s] = 1; this.unimpl.push(s); } };
  Ctx.prototype.level = function () { return this.c.get(STATUS_ATTR.LEVEL); };
  Ctx.prototype.creatureId = function () { return this.c.get(27); };

  /** var_65(n) 读取：优先 ctx 覆写，其次 g.getV65，最后 0 */
  Ctx.prototype.get65 = function (n) {
    if (this.v65[n] !== undefined) return this.v65[n];
    if (this.g && typeof this.g.getV65 === 'function') return this.g.getV65(n);
    if (n === 10) return (this.g && this.g.year) || 0;   // var_65(10) = 当前年份
    return 0;
  };

  /** 标识符/函数取值（表达式求值器的 call 回调） */
  Ctx.prototype.call = function (name, args) {
    const c = this.c, A = args || [];
    switch (name) {
      case 'rnd': return this.rng.rnd(A[0] === undefined ? 0 : A[0]);
      case 'limit': return limit(A[0], A[1], A[2]);
      case 'abs': return Math.abs(A[0] | 0);
      case 'int': return A[0] | 0;
      case 'sqrt': return Math.sqrt(Math.abs(A[0] | 0)) | 0;
      case 'expf': return Math.exp(A[0]);
      case 'logf': return Math.log(A[0]);
      case 'var_58': return A.length >= 2 ? c.get(A[0]) : 0;
      case 'var_65': return this.get65(A[0]);
      case 'var_82': return c.skill(A[0]);
      case 'var_59': return this.mode;               // var_59 模式（16=字段查询 / 3=初始化）
      case 'var_60': return this.var60;
      case 'var_581': return this.var581;
      case 'var_691': return this.vars['var_691'] !== undefined ? this.vars['var_691'] : this.var581;
      case 'var_52': return 1;                       // 语言开关：本项目按日文模式
      case 'var_205': return 0;                      // 英文模式
      case 'cbit': return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, A[0]) : 0;
      case 'findchara': case 'inv_sum': case 'var_132': case 'var_126': case 'var_99':
      case 'var_97': case 'var_98': case 'stat': case 'sorg': case 'var_1437':
        this.mark('func:' + name);
        return 0;
      default: break;
    }
    if (name.startsWith('var_')) {                   // 普通标量变量
      const k = name;
      if (this.vars[k] !== undefined) return this.vars[k];
      return 0;
    }
    this.mark('sym:' + name);
    return 0;
  };

  // ========================================================================
  // 三、语句执行
  // ========================================================================
  /** label_2235：依 var_121(1) 的装备槽串写入 var_58(100..) 槽位码（实现见 Elona.ItemDB.initSlots） */
  function initSlots(ctx) {
    const s = ctx.v121[1];
    if (!s) { ctx.mark('slots:no-var121'); return; }
    if (Elona.ItemDB && Elona.ItemDB.initSlots) { Elona.ItemDB.initSlots(ctx.c, s); return; }
    ctx.mark('slots:no-ItemDB');
  }

  /** var_62 + gosub *label_3103/3104 —— 应用种族/职业初始化 */
  function applyRaceOrClass(ctx, which) {
    const tbl = which === '3103' ? (RC.data && RC.data.races) : (RC.data && RC.data.classes);
    const r = tbl && tbl[ctx.pendRace];
    if (!r) { ctx.mark('gosub310' + (which === '3103' ? '3' : '4') + ':' + ctx.pendRace); return; }
    if (which === '3103') { ctx.c.raceName = ctx.pendRace; if (r.csvName) ctx.c.raceName = r.csvName; }
    else { ctx.c.className = ctx.pendRace; if (r.csvName) ctx.c.className = r.csvName; }
    if (r.ops && r.ops.length) runOps(r.ops, ctx);
    else {                                            // 退化路径（无 ops 时用旧 init/skills）
      for (const k in (r.init || {})) {
        if (k.startsWith('v58_')) ctx.c.set(parseInt(k.slice(4), 10), evalExpr(r.init[k], ctx));
        else if (k.startsWith('body')) ctx.v121[k.slice(4)] = r.init[k];
      }
      for (const k in (r.skills || {})) Elona.Stats.skillInit(ctx.pot, parseInt(k, 10), r.skills[k], { level: ctx.level(), creatureId: ctx.creatureId() });
    }
  }

  /** 执行单条语句；返回 true = 正常，false = 提前结束（return） */
  function execStmt(s, ctx) {
    let m;
    // var_63(c, var_581) = 字符串
    m = /^var_63\((\d+), var_581\) = (.*)$/.exec(s);
    if (m) {
      const idx = parseInt(m[1], 10);
      const txt = evalStringExpr(m[2], ctx);
      ctx.name63[idx] = txt;
      if (idx === 0) ctx.c.name = ctx.name63[0];
      if (idx === 2) ctx.c.raceName = ctx.name63[2];
      if (idx === 3) ctx.c.className = ctx.name63[3];
      return true;
    }
    // var_58(F, var_581) = / += / -= / *= / /=  （支持 `= a, b, c` 连续赋值）
    m = /^var_58\((\d+), var_581\)\s*(=|\+=|-=|\*=|\/=)\s*(.*)$/.exec(s);
    if (m) {
      const f = parseInt(m[1], 10), op = m[2], rhs = m[3];
      const parts = op === '=' ? splitTop(rhs) : [rhs];
      parts.forEach((p, k) => {
        const v = evalExpr(p, ctx);
        const key = f + k;
        if (op === '=') ctx.c.set(key, v);
        else if (op === '+=') ctx.c.set(key, (ctx.c.get(key) + v) | 0);
        else if (op === '-=') ctx.c.set(key, (ctx.c.get(key) - v) | 0);
        else if (op === '*=') ctx.c.set(key, (ctx.c.get(key) * v) | 0);
        else if (op === '/=') ctx.c.set(key, idiv(ctx.c.get(key), v));
      });
      return true;
    }
    // var_82(F, var_581) = / += / -= …（技能 / 耐性 / 属性值）
    //   种族 ops 用这一形式直接给耐性：妖精 `var_82(53)=500`（暗黑）、
    //   巫妖 `var_82(51)=500`（冷气）…；此前没有这条分支，落进通用 `var_\w+`
    //   分支后被当成标量写进 ctx.vars['var_82']，等于整段种族耐性全部丢失。
    //   索引可能是变量（`var_82(var_2745, var_581) = 500`），所以用表达式求值。
    m = /^var_82\((.+?),\s*(var_581|var_691)\)\s*(=|\+=|-=|\*=|\/=)\s*(.*)$/.exec(s);
    if (m) {
      const idx = evalExpr(m[1], ctx) | 0;
      const op = m[3];
      const v = evalExpr(m[4], ctx);
      let cur = ctx.c.skill(idx);
      if (op === '=') cur = v;
      else if (op === '+=') cur += v;
      else if (op === '-=') cur -= v;
      else if (op === '*=') cur *= v;
      else if (op === '/=') cur = idiv(cur, v);
      ctx.c.setSkill(idx, cur | 0);
      return true;
    }
    // var_121(n) = "装备槽串"（label_2235 的输入）
    m = /^var_121\((\d+)\) = (.*)$/.exec(s);
    if (m) { const t = firstStringLiteral(m[2]); ctx.v121[parseInt(m[1], 10)] = t === null ? '' : t; return true; }
    // var_62 = "race" / var_59 = n
    m = /^var_62 = "(.*)"$/.exec(s);
    if (m) { ctx.pendRace = m[1]; return true; }
    m = /^var_59 = (\d+)$/.exec(s);
    if (m) { ctx.mode = parseInt(m[1], 10); return true; }
    // gosub
    m = /^gosub \*label_(3103|3104)$/.exec(s);
    if (m) { applyRaceOrClass(ctx, m[1]); return true; }
    m = /^gosub \*label_2235$/.exec(s);
    if (m) { initSlots(ctx); return true; }
    // skillinit（支持 var_581 / var_691 —— label_2216 用 var_691 作目标）
    m = /^skillinit (-?\d+), (var_581|var_691), (.*)$/.exec(s);
    if (m) {
      Elona.Stats.skillInit(ctx.pot, parseInt(m[1], 10), evalExpr(m[3], ctx), { level: ctx.level(), creatureId: ctx.creatureId() });
      return true;
    }
    // cbitmod
    m = /^cbitmod (-?\d+), var_581, (-?\d+)$/.exec(s);
    if (m) { if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(ctx.c, parseInt(m[1], 10), parseInt(m[2], 10)); return true; }
    // refreshspeed var_581（refreshspeed 193826）
    if (/^refreshspeed var_581$/.test(s)) {
      if (Elona.Stats && Elona.Stats.refreshSpeed) Elona.Stats.refreshSpeed(ctx.c, ctx.g);
      return true;
    }
    // var_65(n) ++ / -- / op= expr
    m = /^var_65\((-?\d+)\)\s*(\+\+|--|(\+|-|\*|\/=?)=)\s*(.*)$/.exec(s);
    if (m) {
      const n = parseInt(m[1], 10);
      let v = ctx.get65(n);
      if (m[2] === '++') v++;
      else if (m[2] === '--') v--;
      else {
        const r = evalExpr(m[4], ctx);
        if (m[2] === '+=') v += r; else if (m[2] === '-=') v -= r;
        else if (m[2] === '*=') v *= r; else if (m[2] === '/=') v = idiv(v, r);
        else v = r;
      }
      ctx.v65[n] = v | 0;
      return true;
    }
    // 通用 var_X(...) / var_X 赋值（注意：`=` 也要匹配，写成 [+-*/]?=）
    m = /^(var_\w+)(\((.*)\))?\s*(\+\+|--|[+\-*/]?=)\s*(.*)$/.exec(s);
    if (m) {
      const name = m[1], op = m[4], rhs = m[5];
      let v = ctx.vars[name] !== undefined ? ctx.vars[name] : 0;
      if (op === '++') v++;
      else if (op === '--') v--;
      else {
        const r = evalExpr(rhs || '0', ctx);
        if (op === '+=') v += r; else if (op === '-=') v -= r;
        else if (op === '*=') v *= r; else if (op === '/=') v = idiv(v, r);
        else v = r;
      }
      ctx.vars[name] = v | 0;
      return true;
    }
    ctx.mark('stmt:' + s.slice(0, 40));
    return true;
  }

  /** 执行 statements / rawunimpl 序列 */
  function runOps(ops, ctx) {
    if (!ops) return;
    const condStack = [];
    const active = () => condStack.every((x) => x);
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      if (o.op === 'if') { condStack.push(active() ? evalExpr(o.c, ctx) !== 0 : false); continue; }
      if (o.op === 'else') {
        if (condStack.length) {
          // 仅当外层活跃时才需要翻转，否则保持 false
          const outer = condStack.slice(0, -1).every((x) => x);
          condStack[condStack.length - 1] = outer ? !condStack[condStack.length - 1] : false;
        }
        continue;
      }
      if (o.op === 'end') { condStack.pop(); continue; }
      if (!active()) continue;
      if (o.op === 'stmt') { if (!execStmt(o.s, ctx)) return; continue; }
      // rawunimpl
      const s = o.s || '';
      if (/^return/.test(s)) return;
      if (/gosub \*label_2240/.test(s)) { runOps(ctx.routines && ctx.routines.post, ctx); continue; }
      if (/gosub \*label_2239/.test(s)) {                      // 219666-219675：品质 4/5 的名字与等级补正
        const c = ctx.c, q = ctx.vars['var_641'] | 0;
        if (q === 4 || q === 5) {
          const name = c.name || '';
          // var_385/386 在日文模式是『』（9392-9411；本项目按 var_52=1 处理）
          c.name = q === 4 ? ('『' + name + '』') : ('《' + name + '》');
          const lv = c.get(STATUS_ATTR.LEVEL) | 0;
          c.set(STATUS_ATTR.LEVEL, q === 4 ? idiv(lv * 10, 8) : idiv(lv * 10, 6));
          c.level = c.get(STATUS_ATTR.LEVEL) | 0;
        }
        continue;
      }
      if (/gosub \*label_2234/.test(s)) {                      // NPC/怪物装备生成（219999）
        if (Elona.EquipGen) {
          try {
            ctx.equip = Elona.EquipGen.generate(ctx.g, ctx.c,
              { var1461: ctx.vars['var_1461'], var577: ctx.vars['var_577'] });
          } catch (e) { ctx.mark('label_2234:' + e.message); }
        } else ctx.mark('label_2234:no-EquipGen');
        continue;
      }
      if (/gosub \*label_2216/.test(s)) { defaultSkillBase(ctx); runOps(ctx.routines && ctx.routines.skills, ctx); continue; }
      if (/gosub \*label_2174/.test(s)) { statRecalc(ctx); continue; }
      if (/gosub \*label_3105/.test(s)) {
        if (ctx.mode === 3 && ctx.creatureOps) { ctx.ranCreature = true; runOps(ctx.creatureOps, ctx); }
        else ctx.mark('gosub3105:' + s.slice(0, 30));
        continue;
      }
      ctx.mark('raw:' + s.slice(0, 40));
    }
  }

  // ========================================================================
  // 四、label_2174 的 213908-213948：HP/MP/SP 上限（含 var_58(25) 档位倍率）
  // ========================================================================
  function statRecalc(ctx) {
    const c = ctx.c;
    // 213386：把潜力写回为当前技能值 var_82(cnt) = var_82(cnt+600)/1000000
    Elona.Stats.syncSkillValues(c, ctx.pot);
    // 213388-213457：固有 cbit 基表（var_1405 → var_58(450..479) + var_58(214) 档位）
    if (Elona.Stats.applyInnateBits) {
      try { Elona.Stats.applyInnateBits(c, ctx.g); }
      catch (e) { ctx.mark('applyInnateBits:' + e.message); }
    }
    // 213461-213793：装备对属性的加成（DV/PV/命中/伤害/武器类型/附魔）
    if (Elona.Stats.applyEquipment) {
      try { ctx.equipBonus = Elona.Stats.applyEquipment(c, ctx.g); }
      catch (e) { ctx.mark('applyEquipment:' + e.message); }
    }
    // 213795-213977：技能/属性修正（var_58(240..) 加成、var_58(84) 衰减、盾/攻击回数 DV 修正等）
    if (Elona.Stats.applySkillCorrections) {
      try { ctx.skillCorr = Elona.Stats.applySkillCorrections(c, ctx.g); }
      catch (e) { ctx.mark('applySkillCorrections:' + e.message); }
    }
    const cid = c.get(27);
    // 213908-213948 段：HP/MP/SP 上限（含 var_58(25) 档位倍率）——
    // 与玩家路径共用 Elona.Stats.calcMaxStats，避免两处实现分叉。
    const st = Elona.Stats.calcMaxStats(c, { creatureId: cid });
    c.set(STATUS_ATTR.HP_MAX, st.hpMax);
    c.set(STATUS_ATTR.MP_MAX, st.mpMax);
    c.set(STATUS_ATTR.SP_MAX, st.spMax);
    // 213959-213977 已由 applySkillCorrections 覆盖（cbit34 / var_58(403,67) 上限）
    // 213980：refreshspeed
    if (Elona.Stats.refreshSpeed) {
      try { ctx.speed = Elona.Stats.refreshSpeed(c, ctx.g); }
      catch (e) { ctx.mark('refreshSpeed:' + e.message); }
    }
    ctx.mark('label_2174:var_58(450..)cbit基表/label_2225');
  }

  // ========================================================================
  // 五、label_2216 的 214992-215017（repeat 循环体，本文件手写）
  // ========================================================================
  function defaultSkillBase(ctx) {
    const c = ctx.c, L = c.get(STATUS_ATTR.LEVEL);
    c.potential = ctx.pot;                     // skillGain/modGrowth 需要直接读写 var_82(id+600)
    for (let cnt = 50; cnt <= 60; cnt++) {
      let a;
      if (L < 100) a = L * 2 + 98;
      else a = idiv(L, 2) + 250;
      if (a > 400) a = 400;
      if (cnt === 60 || L === 1) a = limit(idiv(a, 2), 100, 200);
      const cur = c.skill(cnt);                     // 新建角色为 0（del_chara 后）
      if (cur !== 0) {
        if (cur < 100) a = cur;
        if (cur >= 400) a += cur;
        if (c.get(58) !== 0) a = cur;
        ctx.mark('label_2216:existing-var_82(' + cnt + ')');
      }
      ctx.pot[cnt] = limit(a, 1, 800) * 1000000;
    }
    if (ctx.vars['var_1438'] === 1) ctx.mark('label_2216:var_1438-extras');
    // 215465-215467：repeat 492-400, 400 → skillgain var_691, cnt, 等级, 200
    if (Elona.Stats.skillGain) {
      for (let sk = 400; sk < 492; sk++) Elona.Stats.skillGain(c, c.index, sk, L, 200, ctx.g);
    }
  }

  // ========================================================================
  // 六、选怪 pick（*label_3105，var_59==1）
  // ========================================================================
  /**
   * 分配角色槽 —— 原版 characreate 的 prm_869 由调用方给出；怪物/召唤使用 57..244
   * （`*label_2238` 219533 `repeat 245-57, 57` 的空槽查找即为此区间）。
   * 这里默认取 57 起的第一个空槽，避免占用玩家槽 0。
   */
  function firstFreeSlot(g) {
    for (let k = 57; k < 245; k++) if (!g.charas[k]) return k;
    return g.charas.length;
  }
  // var_550 标签表（*label_4270，587755 起）—— 索引 = monster.json 的 tagIdx
  const TAGS = { data: null };

  const CharaFactory = {
    get monTable() { return MON.data; },
    get tagTable() { return TAGS.data; },
    get creTable() { return CRE.data; },
    get routines() { return CRA.data && CRA.data.routines; },
    setTables(mon, cre, cra, rc, mtag) {
      if (mon) MON.data = mon;
      if (cre) CRE.data = cre;
      if (cra) CRA.data = cra;
      if (rc) RC.data = rc;
      if (mtag) TAGS.data = mtag;
    },
    async loadTables() {
      if (!MON.data) MON.data = await Elona.Data.table('monster');
      if (!CRE.data) CRE.data = await Elona.Data.table('creature');
      if (!CRA.data) CRA.data = await Elona.Data.table('characreate');
      if (!RC.data) RC.data = await Elona.Data.table('race_class');
      if (!NAMES.data) NAMES.data = await Elona.Data.table('names');
      if (!TAGS.data) TAGS.data = await Elona.Data.table('monster_tags');
    },

    /**
     * 选怪 —— 逐字复现 *label_3105（var_59==1）加权轮盘。
     * 过滤次序与原码一致：等级阈值 → var_637 → var_638 → var_514 → var_636 → 累加权重。
     * @param {object} g
     * @param {number} level 目标等级 var_640
     * @param {object} [opt] { t637=0, t638=0, tag='', tags636=[], var550={} }
     * @returns {number} creature id（无可选时 0）
     */
    pick(g, level, opt) {
      opt = opt || {};
      const t637 = opt.t637 === undefined ? 0 : opt.t637;
      const t638 = opt.t638 === undefined ? 0 : opt.t638;
      const tag = opt.tag === undefined ? '' : opt.tag;
      const t = MON.data || [];
      let cum = 0;
      const cand = [];
      for (const e of t) {
        if (e.thr > level) continue;                                     // if (THR > var_640) goto next
        if (e.t637 !== null && t637 !== e.t637) continue;                // if (var_637 != A) goto next
        // if (var_638 != 0) { if (var_638 != B) goto next } → 允许条件为 (ctx==0 || ctx==B)
        if (e.t638 !== null && !(t638 === 0 || t638 === e.t638)) continue;
        if (e.tag !== null && !(tag === '' || tag === e.tag)) continue;  // if (var_514 != "") { if (var_514 != TAG) goto }
        // var_636 标签串包含判定（fltn "cat" → var_549 = "/cat/"）
        //   hay 取 var_550(tagIdx)；tag 名既可显式传 tags636，也可传 tagName 由本表查
        const seq636 = opt.tags636 || (opt.tagName ? ['/' + opt.tagName + '/'] : null);
        if (opt.t636 || seq636) {
          // 原版每个条目都执行 instr(var_550(n), ...)：没有标签串的条目（空串）一律排除
          const hay = (e.tagIdx === null) ? ''
            : ((opt.var550 && opt.var550[e.tagIdx])
              || (TAGS.data && TAGS.data[e.tagIdx]) || '');
          let ok = true;
          for (let k = 0; k < seq636.length; k++) {
            if (hay.indexOf(seq636[k]) === -1) { ok = false; break; }
          }
          if (!ok) continue;
        }
        cum += idiv(e.num, 500 + Math.abs(level - e.thr) * 400) + 1;
        cand.push({ id: e.id, w: cum });
      }
      if (!cand.length) return 0;
      const r = ((g && g.rng) || Elona.rng).rnd(cum);
      for (const c of cand) if (r < c.w) return c.id;
      return cand[cand.length - 1].id;
    },

    /** 取生物定义记录（creature.json） */
    ref(id) { return (CRE.data || {})[String(id)] || null; },

    /**
     * 玩家角色创建：执行种族 / 职业的 ops 序列。
     *
     * 对应源码（物理行 442467-442480）：
     *   del_chara 0
     *   var_62 = var_1482 ; var_59 = 3 ; gosub *label_3103   ← 种族
     *   var_62 = var_1483 ; var_59 = 3 ; gosub *label_3104   ← 职业
     *
     * 与 `core/game.js` 原先手写的 `race.init + race.skills` 相比，走 ops 才能拿到：
     *   · `var_82(50..60) = 500/80/200` 这类**种族固有耐性**（妖精/巫妖/僵尸…）
     *   · `var_63(2)` / `var_121(1)` 等字符串字段与 `gosub *label_2235` 的肢体槽
     *   · 种族 ops 里带条件的赋值（`var_58(8)` 性别、`var_58(7)` 外观等）
     *
     * @returns {{pot:object, body:string, name63:object, v121:object, unimpl:string[]}}
     *   `pot` 为 `var_82(id+600)` 的成长潜力累加器，调用方写完 `c.potential` 后
     *   还要 `Stats.syncSkillValues(c, pot)`。
     */
    applyRaceClass(g, c, raceKey, classKey) {
      const ctx = new Ctx(g, c);
      ctx.mode = 3;                                  // var_59 = 3（初始化模式）
      ctx.var60 = c.get(27) | 0;
      ctx.var581 = c.index;
      ctx.routines = CRA.data && CRA.data.routines;
      ctx.pendRace = raceKey;
      applyRaceOrClass(ctx, '3103');
      if (classKey) { ctx.pendRace = classKey; applyRaceOrClass(ctx, '3104'); }
      return {
        pot: ctx.pot,
        body: ctx.v121[1] || '',
        name63: ctx.name63,
        v121: ctx.v121,
        unimpl: ctx.unimpl.slice(),
      };
    },

    /**
     * 建怪 —— characreate 的忠实实现：按 *label_2238 的顺序执行数据表语句序列。
     * @param {number} speciesId var_60（0/-1 表示随机）
     * @param {number} level     目标等级 var_640
     * @param {object} [opt] { var641 档位, var1023, var1024, var581 指定槽位 }
     * @returns {Elona.Chara} 或 null
     */
    create(g, speciesId, level, x, y, opt) {
      opt = opt || {};
      const idx = opt.index !== undefined ? opt.index : firstFreeSlot(g);
      const c = new Elona.Chara(idx);
      c.set(0, 1);
      const ctx = new Ctx(g, c);
      ctx.routines = CRA.data && CRA.data.routines;
      ctx.var60 = speciesId === 0 || speciesId === -1 || speciesId === undefined
        ? CharaFactory.pick(g, level, opt) : speciesId;
      ctx.vars['var_640'] = level;
      ctx.vars['var_641'] = opt.var641 || 0;
      ctx.vars['var_1023'] = opt.var1023 || 0;
      ctx.vars['var_1024'] = opt.var1024 || 0;
      ctx.vars['var_582'] = ctx.var60 + 1;
      // 选怪失败（*label_3105 无候选）→ 原版 characreate 走 `stat = 0` 分支，
      //   用临时槽 56 收尾并且不留下任何角色（192889-192906），这里等价地返回 null。
      if (!ctx.var60) return null;
      // 选定生物定义（对齐 *label_2238:219650 的 `var_59 = 3 ; gosub *label_3105`）
      const rec = CharaFactory.ref(ctx.var60);
      if (!rec) return null;
      ctx.creatureOps = rec.ops;
      ctx.pendRace = rec.race;
      // 按 *label_2238 执行：收尾段里 `var_59 = 3 ; gosub *label_3105` 会执行 creature ops，
      // 其中再 gosub *label_3103/3104 完成种族/职业初始化，末尾 `gosub *label_2240` 完成后处理。
      runOps(ctx.routines && ctx.routines.main, ctx);
      if (!ctx.ranCreature) ctx.mark('creature-ops-not-run(var_60=' + ctx.var60 + ')');
      // *label_2240 末尾已把 HP/MP/SP 填满；若未跑到则补算（对应 label_2174 段）
      if (!c.get(STATUS_ATTR.HP_MAX)) statRecalc(ctx);
      c.hp = c.hpMax; c.mp = c.mpMax; c.sp = c.spMax;
      c.level = c.get(STATUS_ATTR.LEVEL) || (level | 0);
      if (Elona.Stats && Elona.Stats.expNeeded) c.set(36, Elona.Stats.expNeeded(c));   // *label_2151
      c.raceName = c.raceName || (rec.race || 'creature');
      c.name = c.name || (rec.nameCh || rec.nameJp || ('creature#' + ctx.var60));
      c.x = x; c.y = y;
      // var_58(27) = 物种 id —— 原版 characreate 写入；dmghp 的种族 668 减免、附魔的
      // 龙/不死/神特攻（raceTag）、寄生种族映射、各 var_58(27)==N 分支都依赖它。
      if (!(c.get(27) | 0)) c.set(27, ctx.var60);
      c.var1461 = ctx.vars['var_1461'] | 0;      // 职业装备档（*label_3104 设置，*label_2234 使用）
      c.var577 = ctx.vars['var_577'] | 0;
      g.charas[idx] = c;
      if (typeof g.syncCharaCells === 'function') g.syncCharaCells();
      c.__characreate = { creatureId: ctx.var60, unimpl: ctx.unimpl.slice(), pot: ctx.pot, equip: ctx.equip || null };
      return c;
    },

    /**
     * 对**已存在**的角色重跑 `*label_2174`（213373-219675 的派生值重算段）。
     * 对话脚本在「临时造角色 → 改种族 → 收同伴」之后会 `gosub *label_2174`，
     * 原版靠它把 HP/MP/SP 上限、速度、装备加成、固有位重新算一遍。
     */
    refresh(g, c) {
      if (!c) return null;
      const ctx = new Ctx(g, c);
      ctx.routines = CRA.data && CRA.data.routines;
      ctx.var60 = c.get(27) | 0;
      ctx.vars['var_640'] = c.get(STATUS_ATTR.LEVEL) | 0;
      ctx.vars['var_641'] = 0;
      ctx.vars['var_582'] = ctx.var60 + 1;
      c.potential = c.potential || {};
      statRecalc(ctx);
      c.hpMax = c.get(STATUS_ATTR.HP_MAX) | 0;
      c.mpMax = c.get(STATUS_ATTR.MP_MAX) | 0;
      c.spMax = c.get(STATUS_ATTR.SP_MAX) | 0;
      if (c.hp > c.hpMax) c.hp = c.hpMax;
      if (c.mp > c.mpMax) c.mp = c.mpMax;
      if (c.sp > c.spMax) c.sp = c.spMax;
      return c;
    },

    /**
     * `*label_2235`（219133-219190）：把「頭|体|背|手|…」这种部位清单
     * 写成角色的 `var_58(100..129)`（= 部位类型 × 10000）。
     * 原版用 `getstr var_121, src, cnt*3, 124` 按 3 字节步长切，等价于按 `|` 切分。
     * 结尾固定补上 10（尾）与 11（翼）两个部位。
     * 注意：本函数**不清空**原有槽 —— 原版是调用方先清零（375198-375201）。
     * @returns {number} 写入的部位数（含尾部两个）
     */
    applyPartList(c, text) {
      return (Elona.CharaParts && Elona.CharaParts.apply)
        ? Elona.CharaParts.apply(c, text) : 0;
    },

    /** 供测试直接调用内部函数 */
    _internals: { Ctx, runOps, execStmt, evalExpr, statRecalc, defaultSkillBase, initSlots, Parser },
  };

  Elona.CharaFactory = CharaFactory;
})(window);
