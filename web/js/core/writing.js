'use strict';
/**
 * 写作台（core/writing.js）—— 物品使用效果 114 的实现体
 *
 * 【源码】
 *   350072-350458  `*label_3016` 的 effect 114（写作台 / 书桌，6 种桌子）
 *     350074  必须在脚下：`inv_getowner(var_579) != -1` → 「床に置かないと使えない」
 *     350083  `if (0)` —— 一行死代码（原本想给灵感 +500）
 *     350086-350091  灵感 `var_65(250+435)` 夹在 0..999
 *     350092-350099  菜单 4 项：取消 / 稿件生产 / 自费出版 / 法术书转换
 *     350108  选项 1：灵感 < 5 → 「灵感不够」；否则 `gosub *label_2913` 开始写作
 *     350127  选项 2：钱 < 30000 → 「还需要更多的钱」；否则选稿 → 需要 10 份
 *     350195  选项 3：选法术 → 库存减半 → 生成对应的魔法书
 *   307063-307090  `*label_2913`：写作 rowact 25 的开头与每回合部分
 *
 * 【稿件 / 出版的关键数值】
 *   稿件 = 1197，`var_99(27)`（f[27]）= 品质 0..6
 *     307081 `var_2371 = limit((rnd(写作150 + 器用13 + 感覚14 + 200) + 1) / 200, 0, 6)`
 *   书 = 1198，350172 `var_99(1) = (品质*3 + 10) * 3 * 份数`
 *
 * 【本实现的近似】
 *   · 原版 rowact 25 由主循环每回合调 `*label_2913`；本项目挂到 `Actions.tickRowAct`
 *     （与钓鱼 7 / 演奏 6 同一机制）。
 *   · 350181-350184 的「给书起名」需要一个文本输入窗，本项目暂无该 UI，
 *     书先用默认名，品质与价值照写。已登记（见 docs 0-DN）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const R = (g, n) => {
    const m = Math.max(1, n | 0);
    if (g && g.rng && g.rng.rnd) return g.rng.rnd(m);
    if (Elona.rng && Elona.rng.rnd) return Elona.rng.rnd(m);
    return Math.floor(Math.random() * m);
  };

  const INS = 635;              // var_65(250+435)：灵感
  const MANUSCRIPT = 1197;      // 原稿
  const BOOK = 1198;            // 自费出版的书
  const PUBLISH_COST = 30000;   // 350128
  const PUBLISH_NEED = 10;      // 350146
  const ROWACT_WRITE = 25;      // 307071 var_58(140) = 25
  const F_ROWACT = 140;
  const F_ROWLEFT = 141;

  /** 技能 id：写作 / 器用 / 感覚（307081） */
  const SK_WRITING = 150, SK_DEX = 13, SK_PER = 14;

  /**
   * 法术 id → 魔法书物品 id（350201-350440 的 80 条硬编码）。
   * 键是 `var_396`（法术 id，400..491），值是 `var_60`（物品 id）。
   */
  const SPELLBOOK = {
    400: 249, 401: 250, 402: 251, 403: 252, 404: 548, 405: 550,
    406: 386, 407: 387, 408: 20, 410: 116, 411: 21, 412: 22,
    413: 247, 414: 257, 415: 263, 416: 265, 417: 264, 418: 660,
    419: 32, 420: 33, 421: 34, 422: 267, 423: 268, 424: 118,
    428: 248, 429: 246, 430: 410, 431: 269, 432: 270, 433: 272,
    434: 271, 435: 481, 436: 484, 438: 546, 441: 289, 442: 365,
    443: 367, 444: 369, 445: 371, 446: 373, 447: 374, 448: 378,
    449: 380, 450: 381, 451: 383, 452: 396, 453: 397, 454: 434,
    455: 564, 456: 569, 457: 582, 458: 628, 459: 697, 460: 696,
    462: 710, 463: 731, 464: 732, 468: 870, 469: 1246, 470: 1247,
    471: 1245, 473: 1244, 474: 978, 475: 1033, 476: 1243, 477: 1076,
    478: 1242, 479: 1241, 480: 1240, 481: 1239, 482: 1238, 483: 1237,
    484: 1236, 485: 1235, 486: 1234, 487: 1233, 488: 1232, 489: 1231,
    490: 1230, 491: 1229,
  };

  // ---------------------------------------------------------------- 灵感
  function inspiration(g) {
    return (g && g.getV65) ? (g.getV65(INS) | 0) : 0;
  }
  function setInspiration(g, v) {
    const n = limit(v | 0, 0, 999);          // 350086-350091
    if (g && g.setV65) g.setV65(INS, n);
    return n;
  }

  // ---------------------------------------------------------------- 菜单
  /** 350092-350099：4 项 */
  function deskOptions(g) {
    const ins = inspiration(g);
    return [
      { value: 0, label: '取消' },
      { value: 1, label: `稿件生产（灵感 ${ins}）` },
      { value: 2, label: `自费出版（${PUBLISH_COST} gold）` },
      { value: 3, label: '法术书转换（库存减半）' },
    ];
  }

  /** 350103-350126：选项 1 —— 开始写作 */
  function startWrite(g) {
    const p = g.player;
    if (!p) return { ok: false, reason: 'no-player', message: '现在无法写作。' };
    if ((p.get(F_ROWACT) | 0) !== 0) {
      return { ok: false, reason: 'busy', message: '你正忙着别的事情。' };
    }
    if (inspiration(g) < 5) {                       // 350109
      const msg = '灵感不够……';
      g.log(msg);
      return { ok: false, reason: 'inspiration', message: msg };
    }
    p.set(F_ROWACT, ROWACT_WRITE);                  // 307071
    p.set(F_ROWLEFT, idiv(inspiration(g), 5) + 1);  // 307072
    const msg = `你开始写作。（${p.get(F_ROWLEFT)} 回合）`;
    g.log(msg);
    return { ok: true, turns: p.get(F_ROWLEFT) | 0, message: msg };
  }

  /** 307073-307090：每回合产出一份稿件 */
  function writeTick(g) {
    const p = g.player;
    if (!p || (p.get(F_ROWACT) | 0) !== ROWACT_WRITE) return null;
    const left = p.get(F_ROWLEFT) | 0;
    if (left <= 0) {                                 // 307088 rowactend
      p.set(F_ROWACT, 0);
      p.set(F_ROWLEFT, 0);
      return { finished: true, type: ROWACT_WRITE };
    }
    // 307079-307080：每 3 回合一声
    // 307077-307080：灵感 -5，品质 = limit((rnd(三个技能和+200)+1)/200, 0, 6)
    setInspiration(g, inspiration(g) - 5);
    const base = skillSum(p) + 200;
    const q = limit(idiv(R(g, base) + 1, 200), 0, 6);
    const it = spawnAt(g, MANUSCRIPT, p.x | 0, p.y | 0);
    if (it) it.f[27] = q;                            // 307082
    p.set(F_ROWLEFT, left - 1);
    return { type: ROWACT_WRITE, left: left - 1, quality: q, produced: !!it };
  }

  function skillSum(p) {
    const sk = (id) => (typeof p.skill === 'function' ? (p.skill(id) | 0) : 0);
    return sk(SK_WRITING) + sk(SK_DEX) + sk(SK_PER);
  }

  // ---------------------------------------------------------------- 出版
  /** 350127-350193 */
  function publish(g) {
    const p = g.player;
    if (!p) return { ok: false, reason: 'no-player', message: '现在无法出版。' };
    // 350128
    if ((p.get(30) | 0) < PUBLISH_COST) {
      const msg = '要出版书还需要更多的钱……';
      g.log(msg);
      return { ok: false, reason: 'money', message: msg };
    }
    // 350146：需要 10 份稿件
    const n = countInInv(p, MANUSCRIPT);
    if (n < PUBLISH_NEED) {
      const msg = `要出版书还需要更多稿件……（${n}/${PUBLISH_NEED}）`;
      g.log(msg);
      return { ok: false, reason: 'manuscript', message: msg };
    }
    // 350154-350159
    p.set(30, (p.get(30) | 0) - PUBLISH_COST);
    const first = findInInv(p, MANUSCRIPT);
    const quality = first ? (first.f[27] | 0) : 0;   // var_2371
    const qty = limit(PUBLISH_NEED, 1, 1000);        // var_2558
    const f17 = first ? (first.f[17] | 0) : 0;       // var_2559
    consumeInInv(p, MANUSCRIPT, PUBLISH_NEED);

    const book = spawnAt(g, BOOK, p.x | 0, p.y | 0);
    if (!book) {
      return { ok: false, reason: 'spawn', message: '书没有出现……' };
    }
    book.f[4] = 100;                                  // 350170 itemcreate(..., 100)
    book.f[27] = quality;                             // 350171
    book.f[1] = (quality * 3 + 10) * 3 * qty;         // 350172
    book.f[17] = f17;                                 // 350174
    if (Elona.ItemDB && Elona.ItemDB.identify) Elona.ItemDB.identify(book, 3);
    const msg = '有什么东西掉在了脚下。';
    g.log(msg);
    return { ok: true, book, quality, value: book.f[1], cost: PUBLISH_COST, message: msg };
  }

  // ---------------------------------------------------------------- 法术书
  /** 350195-350454：列出库存 > 0 的法术 */
  function spellbookOptions(g) {
    const p = g.player;
    const out = [{ value: 0, label: '取消' }];
    if (!p || !p.spellStock) return out;
    for (let i = 0; i < p.spellStock.length; i++) {
      const stock = p.spellStock[i] | 0;
      if (stock <= 0) continue;
      const id = 400 + i;
      if (!SPELLBOOK[id]) continue;
      out.push({ value: id, label: `法术 #${id}（库存 ${stock}）` });
    }
    return out;
  }

  /**
   * @param {number} spellId var_396（400..491）
   * 350198-350200：`var_2433 = var_495(法术-400)/2000`；`var_495(...) /= 2`
   */
  function toSpellbook(g, spellId) {
    const p = g.player;
    const sid = spellId | 0;
    const itemId = SPELLBOOK[sid];
    if (!p || !p.spellStock || !itemId) {
      g.log('「不行」');
      return { ok: false, reason: 'no-spell', message: '「不行」' };
    }
    const slot = sid - 400;
    const stock = p.spellStock[slot] | 0;
    if (stock <= 0) {
      return { ok: false, reason: 'no-stock', message: '那个法术没有库存。' };
    }
    const grade = idiv(stock, 2000);                   // var_2433
    p.spellStock[slot] = idiv(stock, 2);               // 350200
    const it = spawnAt(g, itemId, p.x | 0, p.y | 0);
    if (it) {
      it.f[9] = 1;                                     // 350443
      if (Elona.ItemDB && Elona.ItemDB.identify) Elona.ItemDB.identify(it, 3);
    }
    const msg = '有什么东西掉在了脚下。';
    g.log(msg);
    return { ok: true, item: it, itemId, grade, stockLeft: p.spellStock[slot] | 0, message: msg };
  }

  // ---------------------------------------------------------------- 工具
  function spawnAt(g, id, x, y) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    let it = null;
    try { it = Elona.ItemDB.createItem(id, 1); } catch (e) { it = null; }
    if (!it) return null;
    it.f[5] = x; it.f[6] = y; it.f[21] = -1;
    if (!Array.isArray(g.groundItems)) g.groundItems = [];
    g.groundItems.push(it);
    if (g.refreshGroundCell) g.refreshGroundCell(x, y);
    return it;
  }

  function findInInv(p, id) {
    for (const it of (p.inv || [])) {
      if (it && (it.id | 0) === id && (it.f[0] | 0) > 0) return it;
    }
    return null;
  }
  function countInInv(p, id) {
    let n = 0;
    for (const it of (p.inv || [])) {
      if (it && (it.id | 0) === id && (it.f[0] | 0) > 0) n += (it.f[0] | 0);
    }
    return n;
  }
  function consumeInInv(p, id, n) {
    let left = n | 0;
    for (const it of (p.inv || [])) {
      if (left <= 0) break;
      if (!it || (it.id | 0) !== id) continue;
      const have = it.f[0] | 0;
      if (have <= 0) continue;
      const take = Math.min(have, left);
      it.f[0] = have - take;
      left -= take;
    }
    return n - left;
  }

  Elona.Writing = {
    INS, MANUSCRIPT, BOOK, PUBLISH_COST, PUBLISH_NEED, ROWACT_WRITE, SPELLBOOK,
    inspiration, setInspiration,
    deskOptions, startWrite, writeTick,
    publish, spellbookOptions, toSpellbook,
    _internals: { spawnAt, findInInv, countInInv, consumeInInv, skillSum },
  };
})(typeof window !== 'undefined' ? window : globalThis);
