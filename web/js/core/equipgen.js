'use strict';
/**
 * 装备生成 + 装备动作模块
 *
 * 【对应源码】
 *   *label_2234  218259-219132  NPC/怪物装备生成（职业装备档 var_1461 → var_453 意图数组 → 消费循环）
 *   *label_2980  342486-342502  装备动作（把 var_579 的物品装进 var_1090 槽）
 *   *label_2981  342503-342513  卸下
 *   *label_2982  342514+       按槽类型查已装备的物品
 *   eqweaponlight 218229-218236 / eqweaponheavy 218237-218247 / eqrandweaponmage 218249-218257
 *   generatemoney 214504-214525
 *
 * 【var_453 数组语义（已确认）】
 *   dim var_453, 2, 50；`dup var_454, var_453(0,0)` … `dup var_468, var_453(0,14)`
 *   ⇒ var_45X(k) = var_453(0, X-454+k)；`var_455 = A, B` 是多元素赋值 → var_453(0,1)=A、var_453(0,2)=B。
 *   本模块用扁平数组 E（长度 100）承载，E[X-454] 即 var_X；E[k] 为 row0、E[50+k] 为 row1。
 *
 * 【消费循环的槽类型 → 主列】（详见 equipgen.json 的 consumer，取自 218667-219102）
 *   1→0  2→13  3→9  4→6  5→1,5,2  6→11,12  7→7  8→10  9→8  10→3  11→4
 *
 * 【未移植（如实标注）】
 *   · *label_3105(var_59=4) 的特殊外观、var_99(20) 高价值附魔
 *     （依赖 var_132(0, mapId)>=20 的全局判定）
 *   · 消费循环里 var_1466 的 15 次「重掷到价值达标」仅按同一过滤条件实现
 *   · cbit(964) 等全局开关按 g.getV65 读取（缺省 0）；var_65(250+347) 的稀有门已随 0-FO 移除，
 *     在 Ctx.get65 里恒返回 100 —— 218455-218662 的种族专属黑星装备因此才会掉落
 *     （304→722 弩张 1/25、309-311→723 双刃 1/30、147/613/679→1169 蟹肉棒 等）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const mod = (a, b) => (b === 0 ? 0 : (a % b));

  const DATA = { t: null };

  // 复用 monster.js 的表达式求值器（同为 HSP 子集解析器）；无则自建
  function makeParser() {
    const P = Elona.CharaFactory && Elona.CharaFactory._internals && Elona.CharaFactory._internals.Parser;
    if (P) return P;
    return null;
  }

  // ------------------------------------------------------------------------
  // 上下文
  // ------------------------------------------------------------------------
  function Ctx(g, c) {
    this.g = g;
    this.c = c;
    this.rng = (g && g.rng) || Elona.rng;
    this.E = new Array(100).fill(0);      // var_453
    this.vars = {};                       // var_1459/1460/1461/…/var_60/var_639/var_579…
    this.v65 = {};
    this.unimpl = [];
    this._seen = {};
  }
  Ctx.prototype.mark = function (s) { if (!this._seen[s]) { this._seen[s] = 1; this.unimpl.push(s); } };
  Ctx.prototype.get65 = function (n) {
    // 218457/218464/…：`var_65(250 + 347) == 100` 是稀有掉落防 S/L 开关。
    // 0-FO 已按用户要求整体移除该门（见 loot.js 头注），所以这里恒为 100，
    // 否则 218455-218662 这整段「种族专属黑星装备」会被判成永不触发。
    if ((n | 0) === 597) return 100;
    if (this.v65[n] !== undefined) return this.v65[n];
    if (this.g && typeof this.g.getV65 === 'function') return this.g.getV65(n);
    return 0;
  };
  Ctx.prototype.item = function (x) { return (x >= 0 && this.c.inv) ? this.c.inv[x] : null; };
  /** var_99(f, x) 读取（物品实例字段） */
  Ctx.prototype.itemField = function (f, x) {
    const it = this.item(x);
    if (!it) return 0;
    if (f === 18) return it.eqSlot || 0;
    return it.f[f] || 0;
  };
  Ctx.prototype.setItemField = function (f, x, v) {
    const it = this.item(x);
    if (!it) return;
    if (f === 18) { it.eqSlot = v; return; }
    it.f[f] = v;
  };

  /** var_45X / var_45X(k) 读写：E[X-454(+k)]
   *  （注意：下标必须是 3 位，否则会把 var_1460/var_1461 等标量误判成数组元素） */
  const isE = (name) => /^var_4\d\d$/.test(name)
    && Number(name.slice(4)) >= 450 && Number(name.slice(4)) <= 502;

  Ctx.prototype.call = function (name, args) {
    const A = args || [];
    if (isE(name)) {
      const base = Number(name.slice(4)) - 454;
      return this.E[base + (A.length ? A[0] : 0)] || 0;
    }
    switch (name) {
      case 'rnd': return this.rng.rnd(A[0] === undefined ? 0 : A[0]);
      case 'limit': return limit(A[0], A[1], A[2]);
      case 'abs': return Math.abs(A[0] | 0);
      case 'int': return A[0] | 0;
      case 'calcobjlv': return Elona.ItemDB.calcObjLv(A[0] || 0, this.g);
      case 'calcfixlv': return Elona.ItemDB.calcFixLv(A.length ? A[0] : 0, this.g);
      case 'eqweaponlight': return eqWeaponLight(this.rng);
      case 'eqweaponheavy': return eqWeaponHeavy(this.rng);
      case 'var_58': return A.length >= 2 ? this.c.get(A[0]) : 0;
      case 'var_99': return this.itemField(A[0], A[1]);
      case 'var_65': return this.get65(A[0]);
      case 'var_581': return this.c.index;
      case 'var_60': case 'var_639': case 'var_400': case 'var_579':
      case 'var_691': case 'var_1090': case 'stat':
        return this.vars[name] !== undefined ? this.vars[name] : 0;
      case 'var_132': case 'var_126': case 'cbit': case 'getworker':
        this.mark('func:' + name);
        return 0;
      default: break;
    }
    if (name.startsWith('var_')) return this.vars[name] !== undefined ? this.vars[name] : 0;
    this.mark('sym:' + name);
    return 0;
  };

  // ------------------------------------------------------------------------
  // 辅助函数（逐字对应源码）
  // ------------------------------------------------------------------------
  function eqWeaponLight(rng) {
    if (rng.rnd(2)) return 10003;
    if (rng.rnd(2)) return 10009;
    return 10004;
  }
  function eqWeaponHeavy(rng) {
    if (rng.rnd(3) === 0) return 10001;
    if (rng.rnd(3) === 0) return 10010;
    if (rng.rnd(3) === 0) return 10008;
    return 10005;
  }
  /** generatemoney (214504-214525) —— 只写 var_58(30)（金钱） */
  function generateMoney(ctx, idx) {
    const c = ctx.c;
    let v = ctx.rng.rnd(100) + ctx.rng.rnd(c.get(38) * 50 + 1);
    const f150 = c.get(150);
    if ((f150 >= 1000 && f150 < 2000) || f150 === 2003) {
      v += 2500 + c.get(151) * 250;
      if (f150 === 1009) v = 25000 + c.get(151) * 500;
    }
    if (ctx.call('var_132', [16, ctx.get65(20)]) === 102) ctx.mark('generatemoney:worker-bonus');
    if (c.get(30) < idiv(v, 2)) c.set(30, v);
    return v;
  }

  // ------------------------------------------------------------------------
  // 语句执行
  // ------------------------------------------------------------------------
  function firstStringLiteral(src) {
    const m = /"((?:[^"\\]|\\.)*)"/.exec(src);
    return m ? m[1] : null;
  }
  /** 含字符串字面量的条件：只支持 `var_63(c, var_581) == "str"` 形式 */
  function evalStringCond(c, ctx) {
    const m = /var_63\((\d+), var_581\)\s*==\s*"([^"]*)"/.exec(c);
    if (!m) { ctx.mark('strcond:' + c.slice(0, 30)); return 0; }
    const idx = parseInt(m[1], 10);
    const name = idx === 2 ? ctx.c.raceName : (idx === 3 ? ctx.c.className : (ctx.c.nameV63 || {})[idx] || '');
    return name === m[2] ? 1 : 0;
  }
  function evalCond(s, ctx) {
    if (s.indexOf('"') >= 0) return evalStringCond(s, ctx);
    const P = makeParser();
    if (!P) { ctx.mark('no-parser'); return 0; }
    const p = new P(s, ctx.call ? { call: ctx.call.bind(ctx), unimpl: ctx.mark.bind(ctx) } : ctx);
    return p.Expr() | 0;
  }
  function evalExpr(s, ctx) {
    const P = makeParser();
    if (!P) { ctx.mark('no-parser'); return 0; }
    const p = new P(String(s), { call: ctx.call.bind(ctx), unimpl: ctx.mark.bind(ctx) });
    return p.Expr() | 0;
  }

  /** flt：设定 var_640（等级）/ var_641（品质）。`flt` 无参时走默认值。 */
  function doFlt(ctx, a640, a641) {
    ctx.vars['var_640'] = (a640 === undefined || a640 === '')
      ? Elona.ItemDB.calcObjLv(ctx.get65(22), ctx.g) : evalExpr(a640, ctx);
    ctx.vars['var_641'] = (a641 === undefined || a641 === '')
      ? Elona.ItemDB.calcFixLv(2, ctx.g) : evalExpr(a641, ctx);
  }

  /** itemcreate：造物并放进 ctx.c.inv，var_579 = 下标（-1 = 失败），stat = 0/1 */
  function doItemCreate(ctx, container, idExpr) {
    const id = idExpr === undefined ? -1 : evalExpr(idExpr, ctx);
    const opt = {
      itemId: id,
      container: container === undefined ? -1 : evalExpr(container, ctx),
      level: ctx.vars['var_640'],
      fix: ctx.vars['var_641'],
      t637: ctx.vars['var_637'] || 0,
      t639: ctx.vars['var_639'] || 0,
    };
    const it = Elona.ItemDB.create(ctx.g, opt);
    if (!it) { ctx.vars['var_579'] = -1; ctx.vars['stat'] = 0; return 0; }
    ctx.c.inv.push(it);
    ctx.vars['var_579'] = ctx.c.inv.length - 1;
    ctx.vars['stat'] = 1;
    return 1;
  }

  /**
   * *label_2980：把 var_579 的物品装进 var_1090 槽（342486-342502）
   * @param {number} rawSlot var_1090（100..129）；本模块内部统一用该原值
   * 注：原版 `var_99(18) = var_1090` 存的是原值(100..129)；本项目内部改用 0 基序号(0..29)，
   *     以免与 `c.get(100+n)` 的用法混淆（行为等价，仅存的整数偏移不同）。
   */
  function equipAction(ctx, rawSlot, itemIdx) {
    const c = ctx.c;
    if (itemIdx === -1 || itemIdx === undefined) return 0;
    const v = c.get(rawSlot);
    if (mod(v, 10000) !== 0) return 0;                  // 342490：槽已被占
    const it = ctx.item(itemIdx);
    if (!it) return 0;
    if (it.eqSlot !== undefined && it.eqSlot >= 0) return 0;   // 342493：物品已装在别处
    if (ctx.c.index === 0 && Elona.ItemDB.identify) Elona.ItemDB.identify(it, 2);   // 342497-342499
    it.eqSlot = rawSlot - 100;                          // var_99(18)（见上注）
    c.set(rawSlot, idiv(v, 10000) * 10000 + itemIdx + 1);
    return 1;
  }

  function execStmt(s, ctx) {
    let m;
    // memset var_453, 0, 20*4*2 → 清空前 40 个（row0 col0..39）
    if (/^memset var_453/.test(s)) { for (let i = 0; i < 40; i++) ctx.E[i] = 0; return; }
    // flt [a], [b]
    m = /^flt\s*(.*)$/.exec(s);
    if (m) {
      const parts = m[1].split(',').map((x) => x.trim());
      doFlt(ctx, parts[0], parts[1]);
      return;
    }
    // var_45X = A, B   （多元素赋值到 E）
    m = /^(var_4\d\d)\s*=\s*(.*)$/.exec(s);
    if (m && Number(m[1].slice(4)) >= 453 && Number(m[1].slice(4)) <= 502) {
      const base = Number(m[1].slice(4)) - 454;
      const parts = m[2].split(',').map((x) => x.trim());
      ctx.E[base] = evalExpr(parts[0], ctx);
      if (parts.length > 1) ctx.E[base + 1] = evalExpr(parts[1], ctx);
      return;
    }
    // var_45X(k) = expr
    m = /^(var_4\d\d)\((\d+)\)\s*=\s*(.*)$/.exec(s);
    if (m && Number(m[1].slice(4)) >= 453 && Number(m[1].slice(4)) <= 502) {
      const base = Number(m[1].slice(4)) - 454 + parseInt(m[2], 10);
      ctx.E[base] = evalExpr(m[3], ctx);
      return;
    }
    // var_58(F, var_581) = / op= expr
    m = /^var_58\((\d+), var_581\)\s*(=|\+=|-=|\*=|\/=)\s*(.*)$/.exec(s);
    if (m) {
      const f = parseInt(m[1], 10), op = m[2], v = evalExpr(m[3], ctx);
      const cur = ctx.c.get(f);
      if (op === '=') ctx.c.set(f, v);
      else if (op === '+=') ctx.c.set(f, (cur + v) | 0);
      else if (op === '-=') ctx.c.set(f, (cur - v) | 0);
      else if (op === '*=') ctx.c.set(f, (cur * v) | 0);
      else ctx.c.set(f, idiv(cur, v));
      return;
    }
    // var_99(F, X) = expr
    m = /^var_99\((\d+), ([^)]+)\)\s*(=|\+=|-=)\s*(.*)$/.exec(s);
    if (m) {
      const f = parseInt(m[1], 10), x = evalExpr(m[2], ctx), op = m[3];
      const cur = ctx.itemField(f, x);
      const v = evalExpr(m[4], ctx);
      ctx.setItemField(f, x, op === '=' ? v : (op === '+=' ? cur + v : cur - v));
      return;
    }
    // cbitmod / item_separate / item_identify / var_691
    if (/^cbitmod /.test(s)) { ctx.mark('cbitmod'); return; }
    // gosub
    m = /^gosub \*label_(\d+)$/.exec(s);
    if (m) {
      if (m[1] === '2144') { ctx.mark('gosub2144:mutant'); return; }
      if (m[1] === '2980') { equipAction(ctx, ctx.vars['var_1090'] | 0, ctx.vars['var_579']); return; }
      if (m[1] === '3105') { ctx.mark('gosub3105:var_59=4'); return; }
      ctx.mark('gosub' + m[1]);
      return;
    }
    // 函数调用语句
    m = /^eqrandweaponmage\s+(\S+)$/.exec(s);
    if (m) {
      const prm = evalExpr(m[1], ctx);
      const r = ctx.rng.rnd(2);
      if (r === 0) { ctx.E[455 - 454] = 10003; ctx.E[455 - 454 + 1] = prm; }
      if (r === 1) { ctx.E[455 - 454] = 10006; ctx.E[455 - 454 + 1] = prm; }
      return;
    }
    m = /^generatemoney\s+(.+)$/.exec(s);
    if (m) { generateMoney(ctx, ctx.c.index); return; }
    m = /^itemcreate\s*\((.*)\)$/.exec(s) || /^itemcreate\s+(.*)$/.exec(s);
    if (m) {
      const parts = m[1].split(',').map((x) => x.trim());
      doItemCreate(ctx, parts[0], parts[1]);
      return;
    }
    // 通用 var_X 赋值 / ++ / --（注意：`=` 也要匹配，写成 [+-*/]?=）
    m = /^(var_\w+)(\((.*)\))?\s*(\+\+|--|[+\-*/]?=)\s*(.*)$/.exec(s);
    if (m) {
      const name = m[1], op = m[4];
      let v = ctx.vars[name] !== undefined ? ctx.vars[name] : 0;
      if (op === '++') v++;
      else if (op === '--') v--;
      else {
        // 注意：本正则共 5 个捕获组 → 右值在 m[5]（曾误写为 m[6]，导致标量赋值被静默清零）
        const r = evalExpr(m[5] || '0', ctx);
        if (op === '+=') v += r; else if (op === '-=') v -= r;
        else if (op === '*=') v *= r; else if (op === '/=') v = idiv(v, r);
        else v = r;
      }
      ctx.vars[name] = v | 0;
      return;
    }
    ctx.mark('stmt:' + s.slice(0, 40));
  }

  function runOps(ops, ctx) {
    if (!ops) return;
    const stack = [];
    const active = () => stack.every((x) => x);
    for (const o of ops) {
      if (o.op === 'if') { stack.push(active() ? (evalCond(o.c, ctx) !== 0) : false); continue; }
      if (o.op === 'else') {
        if (stack.length) {
          const outer = stack.slice(0, -1).every((x) => x);
          stack[stack.length - 1] = outer ? !stack[stack.length - 1] : false;
        }
        continue;
      }
      if (o.op === 'end') { stack.pop(); continue; }
      if (!active()) continue;
      if (o.op === 'stmt') { execStmt(o.s, ctx); continue; }
      ctx.mark('raw:' + (o.s || '').slice(0, 30));
    }
  }

  // ------------------------------------------------------------------------
  // 消费循环（218663-219132，逐类型分支）
  // ------------------------------------------------------------------------
  /** 依对应列的 var_45X 生成一件物品并装备；返回是否装备成功 */
  function genAndEquip(ctx, rawSlot, col, opts) {
    const c = ctx.c;
    const R = (n) => ctx.rng.rnd(n);
    const id = ctx.E[col] || 0;
    if (!id) return false;
    const rawId = ctx.E[col];
    const isHand = !!opts.hand;                 // 槽类型 5（手）额外有 var_1466/重掷逻辑
    const tries = isHand && ctx.vars['var_1466'] ? 15 : 1;
    for (let t = 0; t < tries; t++) {
      // flt calcobjlv(var_58(38, var_581)), calcfixlv(var_1459 + var_45X(1))
      const fixBonus = ctx.E[col + 1] || 0;
      doFlt(ctx, 'calcobjlv(var_58(38, var_581))', 'calcfixlv(' + (ctx.vars['var_1459'] + fixBonus) + ')');
      let itemId = rawId;
      if (rawId >= 10000) { ctx.vars['var_639'] = rawId; itemId = -1; }   // 随机生成并按 var_639 过滤
      ctx.vars['var_60'] = itemId;
      doItemCreate(ctx, String(c.index), String(itemId));
      if (ctx.vars['var_579'] < 0) return false;
      const it = ctx.item(ctx.vars['var_579']);
      // 218684-218688：类别 4/5 且 var_1465==100 → 附魔等级（原版排除 id 759）
      if ((it.f[4] === 4 || it.f[4] === 5) && ctx.vars['var_1465'] === 100 && it.f[3] !== 759) {
        it.f[20] = limit(idiv(c.get(38), 30), 0, 10);
      }
      // 手槽的价值重掷：var_1466 路径「价值>1500 且 cnt<14」；var_1462「<4000」；var_1463「>1500」
      let retry = false;
      if (isHand && cntLess14(opts.cnt)) {
        if (ctx.vars['var_1466'] && it.f[7] > 1500) retry = true;
        else if (opts.retryUnder4000 && ctx.vars['var_1462'] && it.f[7] < 4000) retry = true;
        else if (opts.retryOver1500 && ctx.vars['var_1463'] && it.f[7] > 1500) retry = true;
      }
      if (!isHand && opts.retryOver1500 && cntLess14(opts.cnt) && it.f[7] > 1500) retry = true;
      if (retry) { it.f[0] = 0; continue; }
      if (equipAction(ctx, rawSlot, ctx.vars['var_579']) !== 1) return false;
      ctx.E[col] = 0;                                     // 218692 等：装备后清空该意图列
      return true;
    }
    return false;
  }
  const cntLess14 = (cnt) => (cnt - 100) < 14;

  function equipLoop(ctx) {
    const c = ctx.c;
    // 218663-218666：var_1465（高价值附魔开关）
    ctx.vars['var_1465'] = 0;
    if (Elona.Status && Elona.Status.cbit(c, 964) !== 1 && ctx.call('var_132', [0, ctx.get65(20)]) >= 20) ctx.vars['var_1465'] = 100;

    // 218667 repeat 30, 100 → cnt = 100..129
    for (let cnt = 100; cnt < 130; cnt++) {
      const slotVal = c.get(cnt);
      const type = idiv(slotVal, 10000);
      if (type === 0) break;                                     // 218669-218671
      const cols = (DATA.t && DATA.t.consumer[String(type)]) || null;
      if (!cols) continue;
      if (type === 5) {
        // 218914-218990：手槽 —— var_1466 / var_455 / var_459 / var_456
        if (ctx.vars['var_1466']) { if (genAndEquip(ctx, cnt, cols[0], { hand: true, cnt })) continue; }
        if (ctx.E[1]) { if (genAndEquip(ctx, cnt, 1, { hand: true, retryUnder4000: true, retryOver1500: true, cnt })) continue; }
        if (ctx.E[5]) { if (genAndEquip(ctx, cnt, 5, { hand: true, retryOver1500: true, cnt })) continue; }
        if (ctx.E[2]) { if (genAndEquip(ctx, cnt, 2, { hand: true, cnt })) continue; }
        continue;
      }
      // 其余类型：按列顺序取第一个非零
      for (const col of cols) {
        if (!ctx.E[col]) continue;
        if (genAndEquip(ctx, cnt, col, { cnt })) break;
      }
    }
    // 219129-219131
    ctx.vars['var_1462'] = 0;
    ctx.vars['var_1463'] = 0;
    ctx.vars['var_1466'] = 0;

    // 219104-219127：creature 专属
    const R = (n) => ctx.rng.rnd(n);
    const cid = c.get(27);
    if (cid === 326) {
      if (R(150) === 0) { doFlt(ctx, '', ''); doItemCreate(ctx, String(c.index), '707'); }
      else {
        ctx.vars['var_640'] = Elona.ItemDB.calcObjLv(c.get(38), ctx.g);
        ctx.vars['var_641'] = Elona.ItemDB.calcFixLv(0, ctx.g);
        ctx.vars['var_639'] = 60005;
        doItemCreate(ctx, String(c.index), '0');
      }
    }
    if (cid === 351 || cid === 352) {
      for (let k = 0; k < 6; k++) {
        doFlt(ctx, '', '');
        ctx.vars['var_1467'] = 1;
        doItemCreate(ctx, String(c.index), '772');
        if (ctx.vars['stat'] !== 0) {
          const it = ctx.item(ctx.vars['var_579']);
          it.f[0] += R(4);
          if (R(2)) { it.f[27] = -1; it.f[2] = 336; }
        }
      }
    }
    return ctx;
  }

  // ------------------------------------------------------------------------
  // 对外接口
  // ------------------------------------------------------------------------
  const EquipGen = {
    get table() { return DATA.t; },
    setTable(t) { DATA.t = t; },
    async loadTable() { if (!DATA.t) DATA.t = await Elona.Data.table('equipgen'); return DATA.t; },

    /** 辅助函数导出（便于测试） */
    eqWeaponLight(rng) { return eqWeaponLight(rng || Elona.rng); },
    eqWeaponHeavy(rng) { return eqWeaponHeavy(rng || Elona.rng); },

    /**
     * 为角色生成并装备 NPC 装备 —— 对应 *label_2234。
     * @param {object} g
     * @param {Elona.Chara} c 需已由 CharaFactory 建好（含 var_58(25)/var_1461 与槽表）
     * @param {object} [opt] { var1461, var577 }
     * @returns {{equipped:number[], unimpl:string[]}}
     */
    generate(g, c, opt) {
      opt = opt || {};
      // 218272-218277：mutant 先长出 limit(等级/3, 0, 16) 个肉体部位
      //   （生成路径 var_685 = 1，219590 → 静默）
      if (c.raceName === 'mutant') {
        const reps = Math.min(Math.max(Math.trunc((c.level || 0) / 3), 0), 16);
        for (let i = 0; i < reps; i++) this.growMutantPart(g, c, { silent: true });
      }
      const ctx = new Ctx(g, c);
      ctx.vars['var_1461'] = opt.var1461 !== undefined ? opt.var1461 : (c.var1461 || 0);
      ctx.vars['var_577'] = opt.var577 || 0;
      ctx.vars['var_1459'] = 0;
      ctx.vars['var_1460'] = 0;
      runOps(DATA.t && DATA.t.routines.profiles, ctx);
      equipLoop(ctx);
      const equipped = [];
      for (let n = 0; n < 30; n++) {
        const idx = Elona.ItemDB.slotItemIndex(c, n);
        if (idx >= 0) equipped.push({ slot: n, type: Elona.ItemDB.slotTypeOf(c, n), itemIndex: idx, itemId: c.inv[idx] ? c.inv[idx].f[3] : 0 });
      }
      c.equipGenUnimpl = ctx.unimpl.slice();
      return { equipped, unimpl: ctx.unimpl.slice(), var1461: ctx.vars['var_1461'] };
    },

    /**
     * *label_2980 装备动作（供测试/UI 调用）
     * @param {number} rawSlot var_1090 原值（100..129）
     */
    equipAction(c, rawSlot, itemIdx) {
      const ctx = new Ctx({ rng: Elona.rng }, c);
      return equipAction(ctx, rawSlot, itemIdx);
    },

    /**
     * *label_2144（211733-211853）：mutant 的肉体部位成长。
     * 只检查第一个空槽（源码 211850 的 break 使 repeat 只跑一次）；
     * 按 7/9/8/4/6/5/5/1 的概率生成 首/背中/手/指/腕/腰/足/頭（槽值 = 类型*10000）。
     * @param {object} [opt] { silent } —— 对应 var_685：角色生成（219590）与读档
     *   （220484）时为 1 静默；通常游玩（220233 归零）为 0 → 211747 等八处播报
     *   「〜の身体から新たな〜が生えてきた！」（英文 `grow` + `_s`，8250-8265：
     *   玩家无 s、NPC 有 s；部位名取 var_257，9144 / 9172 的表）。
     * @returns {number} 生成的槽类型（0 = 本次未成长）
     */
    growMutantPart(g, c, opt) {
      opt = opt || {};
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      let type = 0;
      for (let cnt = 100; cnt < 130; cnt++) {
        if (c.get(cnt) !== 0) continue;
        if (R(7) === 0) type = 2;
        else if (R(9) === 0) type = 3;
        else if (R(8) === 0) type = 5;
        else if (R(4) === 0) type = 6;
        else if (R(6) === 0) type = 7;
        else if (R(5) === 0) type = 8;
        else if (R(5) === 0) type = 9;
        else if (R(1) === 0) type = 1;
        if (type) c.set(cnt, type * 10000);
        break;
      }
      if (!type) return 0;
      // 211851：`gosub *label_2143` —— 重算「身体が複雑」(var_58(68))
      if (Elona.Equipment && Elona.Equipment.updateComplex) Elona.Equipment.updateComplex(c);
      // 211740-211849：var_685 == 0 时播报（211747 / 211761 / 211775 / 211789 /
      //   211803 / 211817 / 211831 / 211845 的同一句模板，部位名按类型取 var_257）
      if (!opt.silent && g && typeof g.log === 'function') {
        const jp = (g.lang === 'jp');
        const part = (Elona.Equipment && Elona.Equipment.typeName)
          ? Elona.Equipment.typeName(type, jp ? 'jp' : 'en') : '';
        const s = ((c.index | 0) === 0) ? '' : 's';   // _s(var_691)
        g.log(jp
          ? `${c.name || '?'}の身体から新たな${part}が生えてきた！`
          : `${c.name || '?'} grow${s} a new ${part}!`);
      }
      return type;
    },
    _internals: { Ctx, runOps, equipAction, doItemCreate, doFlt, eqWeaponLight, eqWeaponHeavy, generateMoney, evalExpr, evalCond },
  };

  Elona.EquipGen = EquipGen;
})(window);
