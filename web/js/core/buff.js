'use strict';
/**
 * Buff 属性作用模块 —— 对应 `#deffunc calcbuff`（start.hsp 628-1704）。
 *
 * 【已确认】
 *   calcbuff(角色 prm_274, buff id prm_275, 强度 prm_276)：
 *     · id ∈ [20,28] → 成长率：var_58(270 + (id-20+10) - 10) = prm_276
 *     · id == 67    → 全技能成长率：var_58(270 + 19 - 10) = prm_276
 *     · 其余 62 个 id → 逐 id 的 var_82/var_58/cbitmod 加成（数据表 buffs.json）
 *   负角色索引（prm_274 < 0）只用于取得说明文本（var_78）。
 *
 * 【数据来源】tools/extract_calcbuff.py → web/data/tables/buffs.json
 *   每个 id: { desc:{jp,en}, ops:[if/else/end/stmt/return] }
 *
 * 【未移植】var_79（UI 显示用威力）不作实际用途，仅保留赋值。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  let TABLE = null;

  // ---------- 极简表达式求值（HSP 子集） ----------
  function Parser(src, ctx) {
    this.s = String(src);
    this.i = 0;
    this.ctx = ctx;
  }
  Parser.prototype.ws = function () { while (this.i < this.s.length && this.s[this.i] === ' ') this.i++; };
  Parser.prototype.Expr = function () {
    let v = this.Cmp();
    for (;;) {
      this.ws();
      if (this.s[this.i] === '|' && this.s[this.i + 1] !== '|') { this.i++; v = (v || this.Cmp()) ? 1 : 0; }
      else break;
    }
    return v;
  };
  Parser.prototype.Cmp = function () {
    let v = this.Add();
    for (;;) {
      this.ws();
      if (this.s[this.i] === '&' && this.s[this.i + 1] !== '&') { this.i++; v = (v && this.Add()) ? 1 : 0; continue; }
      const rest = this.s.slice(this.i);
      const m = /^(==|!=|<=|>=|<|>)/.exec(rest);
      if (!m) break;
      this.i += m[1].length;
      const r = this.Add();
      switch (m[1]) {
        case '==': v = v === r ? 1 : 0; break;
        case '!=': v = v !== r ? 1 : 0; break;
        case '<': v = v < r ? 1 : 0; break;
        case '>': v = v > r ? 1 : 0; break;
        case '<=': v = v <= r ? 1 : 0; break;
        case '>=': v = v >= r ? 1 : 0; break;
      }
    }
    return v;
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
      else break;
    }
    return v;
  };
  Parser.prototype.Unary = function () {
    this.ws();
    if (this.s[this.i] === '-') { this.i++; return -this.Unary(); }
    if (this.s[this.i] === '(') {
      this.i++;
      const v = this.Expr();
      this.ws();
      if (this.s[this.i] === ')') this.i++;
      return v;
    }
    const nm = /^(\d+)/.exec(this.s.slice(this.i));
    if (nm) { this.i += nm[1].length; return parseInt(nm[1], 10); }
    const im = /^([A-Za-z_]\w*)/.exec(this.s.slice(this.i));
    if (!im) { this.i++; this.ctx.mark('expr:' + this.s.slice(this.i, this.i + 20)); return 0; }
    const name = im[1];
    this.i += name.length;
    this.ws();
    let args = null;
    if (this.s[this.i] === '(') {
      this.i++;
      args = [];
      this.ws();
      if (this.s[this.i] === ')') this.i++;
      else {
        for (;;) {
          args.push(this.Expr());
          this.ws();
          if (this.s[this.i] === ',') { this.i++; continue; }
          if (this.s[this.i] === ')') { this.i++; break; }
          this.ctx.mark('args:' + name);
          break;
        }
      }
    }
    return this.ctx.call(name, args) | 0;
  };

  // ---------- 上下文 ----------
  function Ctx(c, id, power) {
    this.c = c;
    this.id = id;
    this.power = power;
    this.vars = {};
    this.unimpl = [];
    this._seen = {};
  }
  Ctx.prototype.mark = function (s) { if (!this._seen[s]) { this._seen[s] = 1; this.unimpl.push(s); } };
  Ctx.prototype.call = function (name, args) {
    const A = args || [];
    const c = this.c;
    switch (name) {
      case 'prm_274': return c.index;
      case 'prm_275': return this.id;
      case 'prm_276': return this.power;
      case 'var_79': case 'var_80': return this.vars[name] || 0;
      case 'var_82': return c.skill(A[0]);
      case 'var_58': return c.get(A[0]);
      case 'limit': return limit(A[0], A[1], A[2]);
      case 'abs': return Math.abs(A[0] | 0);
      case 'lang': return 0;                 // 说明文本，不影响数值
      default:
        if (name.startsWith('var_')) return this.vars[name] || 0;
        this.mark('sym:' + name);
        return 0;
    }
  };
  function evalExpr(src, ctx) {
    const p = new Parser(src, ctx);
    return p.Expr() | 0;
  }

  // ---------- 语句 ----------
  function execStmt(s, ctx) {
    let m;
    if (/^var_78 = /.test(s)) return;                     // 说明文本，忽略
    m = /^(var_\d+) = (.*)$/.exec(s);
    if (m) { ctx.vars[m[1]] = evalExpr(m[2], ctx); return; }
    m = /^var_82\((\d+), prm_274\)\s*(\+=|=)\s*(.*)$/.exec(s);
    if (m) {
      const id = parseInt(m[1], 10), v = evalExpr(m[3], ctx);
      ctx.c.setSkill(id, m[2] === '=' ? v : (ctx.c.skill(id) + v));
      return;
    }
    m = /^var_58\((\d+), prm_274\)\s*(\+=|=)\s*(.*)$/.exec(s);
    if (m) {
      const f = parseInt(m[1], 10), v = evalExpr(m[3], ctx);
      ctx.c.set(f, m[2] === '=' ? v : (ctx.c.get(f) + v));
      return;
    }
    m = /^cbitmod (-?\d+), prm_274, (-?\d+)$/.exec(s);
    if (m) { if (Elona.Status) Elona.Status.cbitmod(ctx.c, parseInt(m[1], 10), parseInt(m[2], 10)); return; }
    ctx.mark('stmt:' + s.slice(0, 30));
  }

  function runOps(ops, ctx) {
    const stack = [];
    const active = () => stack.every((x) => x);
    for (const o of ops) {
      if (o.op === 'if') { stack.push(active() ? (evalExpr(o.c, ctx) !== 0) : false); continue; }
      if (o.op === 'else') {
        if (stack.length) {
          const outer = stack.slice(0, -1).every((x) => x);
          stack[stack.length - 1] = outer ? !stack[stack.length - 1] : false;
        }
        continue;
      }
      if (o.op === 'end') { stack.pop(); continue; }
      if (o.op === 'return') { if (active()) return true; continue; }
      if (!active()) continue;
      if (o.op === 'stmt') { execStmt(o.s, ctx); continue; }
    }
    return false;
  }

  // ---------- 对外 ----------
  /** var_75(0, id) == 2 的 debuff 集合（start.hsp 409-470 的初始化表） */
  const DEBUFF = new Set([2, 6, 8, 9, 11, 13, 16, 39, 56, 57, 61, 71]);

  const BuffEffects = {
    get table() { return TABLE; },
    setTable(t) { TABLE = t; },
    async loadTable() { if (!TABLE) TABLE = await Elona.Data.table('buffs'); return TABLE; },

    /** buff id 是否属于 debuff（var_75(0, id) == 2） */
    isDebuff(id) { return DEBUFF.has(id | 0); },

    /**
     * 只求 `var_79`（持续回合）而不改角色 —— 对应 `calcbuff -1, id, power`
     * （315898：效果引擎在 addbuff 之前先算持续回合）。
     * 每个 id 的 ops 都把 `var_79 = …` 放在最前面，然后才按 `prm_274 < 0` 分支返回，
     * 因此用 index = -1 的假角色跑一遍即可拿到回合数。
     */
    turnsOf(id, power) {
      const e = TABLE && TABLE[String(id)];
      if (!e) return 100;
      const fake = {
        index: -1,
        get: () => 0,
        set: () => {},
        skill: () => 0,
        setSkill: () => {},
      };
      const ctx = new Ctx(fake, id | 0, power | 0);
      runOps(e.ops, ctx);
      const n = ctx.vars.var_79 | 0;
      return n || 100;
    },

    /**
     * 对应 calcbuff(chara, buffId, power)。会直接修改角色技能/字段/位标志。
     * @returns {{applied:boolean, desc:object|null, unimpl:string[]}}
     */
    apply(c, id, power) {
      const ctx = new Ctx(c, id, power);
      // 628-658：成长率（id 20..28）
      if (id >= 20 && id <= 28) {
        const v = power;
        c.set(270 + (id - 20 + 10) - 10, v);
        return { applied: true, growth: true, desc: null, unimpl: ctx.unimpl };
      }
      // 644-658：全技能成长率（67）
      if (id === 67) {
        c.set(270 + 19 - 10, power);
        return { applied: true, growth: true, desc: null, unimpl: ctx.unimpl };
      }
      const e = TABLE && TABLE[String(id)];
      if (!e) return { applied: false, desc: null, unimpl: ['buff:' + id] };
      runOps(e.ops, ctx);
      return { applied: true, desc: e.desc || null, unimpl: ctx.unimpl };
    },
    _internals: { Parser, Ctx, runOps, execStmt, evalExpr },
  };

  Elona.BuffEffects = BuffEffects;
})(window);
