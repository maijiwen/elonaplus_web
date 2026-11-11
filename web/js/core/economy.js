'use strict';
/**
 * 经济系统（core/economy.js）—— 银行 / 税 / 自营店
 *
 * 【源码依据】
 *   银行   358530-358661  ヤカテクトの預金箱（物品 1097）
 *   建筑税 214540-214607  #defcfunc calccostbuilding
 *   雇工费 214468-214538  #defcfunc calchirecost / #deffunc calccosthire
 *   所得税 214608-214618  #defcfunc calccosttax
 *   月度结算 279226-279320  发账单 / 滞纳 / 起诉 / 交通工具维护费
 *   自营店 278975-279007  #defcfunc calcincome
 *   日收入 279026-279100  9 个店铺槽的每日进账与进货
 *
 * 【字段】
 *   var_58(30,0)  玩家金币
 *   var_58(49,0)  karma（善恶值，影响税率）
 *   var_58(189,0) 职业/专长标记（==10 时店铺收入 ×95%）
 *   var_99(25,i)  存钱箱里的金额
 *   var_99(9,i)   上次交易时刻（防「ウチウチ詐欺」：同一时刻只能交易一次）
 *   var_65(24)    自家等级（建筑税 var_65(24)² × 200）
 *   var_65(120+i) 店铺投资额（>= 10000 视为未开店）
 *   var_65(170)   雇工费基准（calccosthire 写入）
 *   var_65(179)   税金滞纳月数
 *   var_65(250+231) == 1000 → 建筑税 +6000
 *   var_65(250+359) 预付税额
 *   var_65(250+442) 陆上交通工具等级（1..4）
 *   var_65(250+446) 海上交通工具等级（1..6）
 *   var_97(38)    专长「会計」等级（每级税率 -7%）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const GOLD_ITEM = 54;        // 金币物品
  const BANK_ITEM = 1097;      // ヤカテクトの預金箱
  const BILL_ITEM = 615;       // 請求書
  const TAX_BOX = 616;         // 徴税士の納税箱（纳付窗口的入口）

  const TAX_CAP = 1000000000;  // 貯金箱上限（358614）

  // 交通工具维护费（214570-214598）
  const VEHICLE_LAND = { 1: 500, 2: 2000, 3: 10000, 4: 200000 };
  const VEHICLE_SEA = { 1: 100, 2: 3000, 3: 10000, 4: 50000, 5: 100000, 6: 150000 };

  // 建筑税单价（214548-214568）
  const BUILDING_COST = {
    101: 1500,   // 博物館
    31: 1000,    // 牧場
    105: 2500,   // 収容所
    103: 750,    // 畑
    102: 2000,   // 店
    104: 750,    // 倉庫
  };

  // 雇工日薪（214468-214510）
  const HIRE_COST = { 18: 450, 7: 250, 9: 350, 12: 500, 5: 750, 8: 250, 14: 50 };

  function idiv(a, b) { return Math.trunc((a | 0) / (b | 0)); }
  function limit(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  const Economy = {
    GOLD_ITEM, BANK_ITEM, BILL_ITEM, TAX_BOX, TAX_CAP,
    BUILDING_COST, VEHICLE_LAND, VEHICLE_SEA, HIRE_COST,

    // ==================================================================
    // 一、银行（358530-358661）
    // ==================================================================

    /** var_99(25)：箱内金额 */
    balance(box) {
      if (!box || !box.f) return 0;
      return box.f[25] | 0;
    },

    /** var_99(9)：上次交易时刻（用于「ウチウチ詐欺」检测） */
    stamp(box) {
      if (!box || !box.f) return 0;
      return box.f[9] | 0;
    },

    /** 当前绝对小时（358552：时 + 日*24 + 月*24*30 + 年*24*30*12） */
    nowHours(g) {
      if (!g || !g.getV65) return 0;
      const hour = g.getV65(13) | 0;
      const day = g.getV65(12) | 0;
      const month = g.getV65(11) | 0;
      const year = g.getV65(10) | 0;
      return hour + day * 24 + month * 24 * 30 + year * 24 * 30 * 12;
    },

    /**
     * 银行交易本体。
     * @param {object} g
     * @param {object} box 存钱箱物品实例
     * @param {number} action 0=取消/欺诈检测 1=全部取出 2=10万 3=100万 4=1000万 5=1亿
     * @returns {object} { ok, reason, taken, stored, balance }
     */
    bankTrade(g, box, action) {
      if (!box) return { ok: false, reason: 'no-box' };
      const p = g.player;
      const now = this.nowHours(g);
      const act = action | 0;

      if (act === 0) {
        // 358551：不做任何事就走 → 时间戳仍被刷新（原版如此）
        box.f[9] = now;
        return { ok: false, reason: 'cancel', balance: this.balance(box) };
      }

      if (act === 1) {
        // 358560-358588：全部取出
        const amt = this.balance(box);
        box.f[9] = now;
        if (amt <= 0) {
          return { ok: false, reason: 'empty', message: '「これぞ金を産むガチョウ…って空っぽやんか！」', balance: 0 };
        }
        box.f[25] = 0;
        this.dropGold(g, amt);
        return { ok: true, taken: amt, balance: 0 };
      }

      // 358590-358659：存款
      const table = { 2: 100000, 3: 1000000, 4: 10000000, 5: 100000000 };
      const amount = table[act] || 0;
      if (amount <= 0) return { ok: false, reason: 'bad-action' };

      const gold = p.get(30) | 0;
      if (amount > gold) {
        box.f[9] = now;
        return { ok: false, reason: 'no-money', message: '金貨が足りない…', balance: this.balance(box) };
      }
      if (this.balance(box) >= TAX_CAP) {
        box.f[9] = now;
        return { ok: false, reason: 'full', message: '貯金箱は一杯だ。', balance: this.balance(box) };
      }

      p.set(30, gold - amount);
      // 358658：存入即按 1.1 倍计息（整数除法：先 /10 再 *11）
      box.f[25] = idiv(this.balance(box) + amount, 10) * 11;
      box.f[9] = now;
      return { ok: true, stored: amount, balance: this.balance(box) };
    },

    /** itemcreate -1, 54, x, y, amount：金币落到脚下 */
    dropGold(g, amount) {
      const n = amount | 0;
      if (n <= 0) return null;
      let it = null;
      try {
        it = Elona.ItemDB.createItem(GOLD_ITEM, n);
      } catch (e) { it = null; }
      if (!it) return null;
      const p = g.player;
      it.f[5] = p.x; it.f[6] = p.y;
      if (g.groundItems) g.groundItems.push(it);
      if (typeof g.refreshGroundCell === 'function') g.refreshGroundCell(it.f[5], it.f[6]);
      return it;
    },

    /** 玩家背包里的存钱箱 */
    findBankBox(p) {
      if (!p || !p.inv) return null;
      return p.inv.find((it) => it && (it.f[0] | 0) > 0 && (it.id | 0) === BANK_ITEM) || null;
    },

    // ==================================================================
    // 二、税（214540-214618 / 279226-279320）
    // ==================================================================

    /** 税率系数：limit(100 - limit(karma/2,0,50) - 7*会計 - (karma>=20)*5, 25, 200) */
    taxModifier(p) {
      if (!p) return 100;
      const karma = p.get(49) | 0;
      // 214537：`7 * var_97(38)` —— feat 38「見習い会計士」的**等级**（1..2），
      // 不是 var_98 的能力标志位。
      const accounting = (Elona.Feat && Elona.Feat.get) ? (Elona.Feat.get(p, 38) | 0) : 0;
      return limit(100 - limit(idiv(karma, 2), 0, 50) - 7 * accounting - (karma >= 20 ? 5 : 0), 25, 200);
    },

    /**
     * 建筑维持费（214540-214607）。
     * 遍历 300..449 的地产槽位（var_132(16, cnt)），累加各建筑单价。
     */
    calcBuilding(g) {
      let cost = 0;
      let museums = 0;
      let shops = 0;
      const homeLv = (g.getV65(24) | 0);
      cost += homeLv * homeLv * 200;                       // 214544
      if ((g.getV65(481) | 0) === 1000) cost += 6000;      // 214545（250+231）

      // 214548-214569：地产槽 300..449
      const v132 = (g && g.v132) || {};
      for (let id = 300; id <= 449; id++) {
        const type = v132[String(id)] | 0;
        if (!type) continue;
        const add = BUILDING_COST[type];
        if (add === undefined) continue;
        cost += add;
        if (type === 101) museums++;
        if (type === 102) shops++;
      }

      // 214570-214598：交通工具维护费
      const land = g.getV65(692) | 0;    // 250+442
      const sea = g.getV65(696) | 0;     // 250+446
      cost += VEHICLE_LAND[land] || 0;
      cost += VEHICLE_SEA[sea] || 0;

      // 214600-214604：没有博物馆/店时把对应店铺槽设成「未开店」
      if (museums === 0) g.setV65(123, 10000);
      if (shops === 0) g.setV65(125, 10000);

      // 214606
      const p = g.player;
      cost = Math.abs(idiv(cost * this.taxModifier(p), 100));
      return cost;
    },

    /** 所得税（214608-214618） */
    calcTax(g) {
      const p = g.player;
      const gold = p.get(30) | 0;
      let v = 0;
      v += limit(idiv(gold, 33), 100, 100000);                    // 214610
      const spend = g.getV65(170) | 0;                             // 累计雇工费
      if (gold < idiv(spend, 10)) v += idiv(spend, 100);           // 214611-214613
      if (v >= 100000) v = 100000;                                 // 214614-214616
      return Math.abs(idiv(v * this.taxModifier(p), 10));          // 214617
    },

    /** 月度总账单（279242）：雇工费 + 建筑 + 所得税 */
    monthlyBill(g) {
      return (g.getV65(170) | 0) + this.calcBuilding(g) + this.calcTax(g);
    },

    /** var_65(250+359)：预付税额 */
    prepaid(g) { return g.getV65(609) | 0; },
    setPrepaid(g, v) { g.setV65(609, Math.max(0, v | 0)); },

    /** var_65(179)：滞纳月数 */
    arrears(g) { return g.getV65(179) | 0; },

    /**
     * 每月结算（279226-279320）。
     * @returns {object} { messages, bill, arrears, sued }
     */
    monthly(g) {
      const res = { messages: [], bill: 0, arrears: this.arrears(g), sued: false };
      const p = g.player;

      // 279226-279252：没有预付 → 发账单
      if (this.prepaid(g) <= 0) {
        this.setPrepaid(g, 0);
        // 279241：生成请求书物品（到脚下）
        let bill = null;
        try { bill = Elona.ItemDB.createItem(BILL_ITEM, 1); } catch (e) { bill = null; }
        if (bill) {
          bill.f[5] = p.x; bill.f[6] = p.y;
          bill.f[23] = idiv(this.monthlyBill(g) * (100 + g.rng.rnd(20)), 100);   // 279242-279243
          if (g.groundItems) g.groundItems.push(bill);
          if (typeof g.refreshGroundCell === 'function') g.refreshGroundCell(bill.f[5], bill.f[6]);
        }
        res.bill = bill ? (bill.f[23] | 0) : 0;
        g.setV65(179, this.arrears(g) + 1);
        res.arrears = this.arrears(g);
        res.messages.push('請求書が送られてきた。');
      } else {
        // 279253-279272：扣预付
        const need = this.prepaid(g) - this.monthlyBill(g);
        this.setPrepaid(g, need);
        res.messages.push(need > 0 ? '今月分は既に納税している。' : '先払い分が今月でなくなった。');
      }

      // 279274-279290：滞纳 1..4 月的警告
      const arr = this.arrears(g);
      if (arr > 1 && arr <= 4) {
        res.messages.push(arr > 3
          ? `警告！！ 早急にパルミア大使館まで行き、税金を納めなければならない。（${arr - 1} ヶ月滞納）`
          : `注意！ 税金を ${arr - 1} ヶ月分滞納している。`);
      }
      // 279291-279310：滞纳 > 4 月 → 起诉
      if (arr > 4) {
        res.sued = true;
        res.messages.push(`あなたは税金を ${arr - 1} ヶ月滞納した罪で訴えられた。`);
        if (Elona.Fame && Elona.Fame.dec) {
          res.fameLoss = Elona.Fame.dec(g, 50);
        } else if (typeof g.decfame === 'function') {
          res.fameLoss = g.decfame(50);
        } else {
          res.fameLoss = 50;
        }
        res.messages.push(`名声値を ${res.fameLoss} 失った。`);
        if (Elona.Karma && Elona.Karma.mod) Elona.Karma.mod(g, -60);
        else if (typeof g.modkarma === 'function') g.modkarma(-60);
      }

      // 279311-279318：交通工具维护费重置
      if ((g.getV65(692) | 0) !== 0 || (g.getV65(696) | 0) !== 0) {
        res.messages.push('陸と海の乗り物の維持費がリセットされた。');
        g.setV65(692, 0);
        g.setV65(696, 0);
      }
      return res;
    },

    /**
     * 缴纳账单 —— 源码 298946-299010（`var_486 == 24 & var_486(1) == 2` 的纳付模式）。
     *
     * 入口不是「对请求书使用」，而是使用「徴税士の納税箱」616
     * （344762-344770 `var_486 = 24, 2` → 打开纳付清单）。清单里只列三种凭证：
     *   · 615 請求書   → 金额 = `var_99(23)`，要求 `var_65(179) > 0`（有滞纳才收）
     *   · 1084 120万納税書 → 固定 120 万，`var_65(250+359) += 1200000`
     *   · 1085 1200万納税書 → 固定 1200 万，`var_65(250+359) += 12000000`
     * 缴纳后凭证消耗；615 另外把滞纳月数 `var_65(179)` 减 1（不是清零）。
     */
    payBill(g, bill) {
      if (!bill || (bill.id | 0) !== BILL_ITEM) return { ok: false, reason: 'not-bill' };
      const p = g.player;
      // 299007-299012：没有欠税时不受理
      if ((g.getV65(179) | 0) <= 0) return { ok: false, reason: 'not-due' };
      const amount = bill.f[23] | 0;
      if (amount <= 0) return { ok: false, reason: 'bad-bill' };
      const gold = p.get(30) | 0;
      if (gold < amount) return { ok: false, reason: 'no-money', need: amount, gold };

      p.set(30, gold - amount);
      bill.f[0] = 0;                                    // 299031-299032 `var_99(0)--`
      g.setV65(179, Math.max(0, (g.getV65(179) | 0) - 1));
      return { ok: true, paid: amount, kind: 'tax' };
    },

    /** 1084 / 1085 的定额纳税（298970-299040）：扣钱后把金额计入 `var_65(250+359)` */
    payTaxDocument(g, it) {
      const id = it ? (it.id | 0) : 0;
      const amount = id === 1084 ? 1200000 : (id === 1085 ? 12000000 : 0);
      if (!amount) return { ok: false, reason: 'not-document' };
      const p = g.player;
      const gold = p.get(30) | 0;
      if (gold < amount) return { ok: false, reason: 'no-money', need: amount, gold };
      p.set(30, gold - amount);
      it.f[0] = 0;
      g.setV65(609, (g.getV65(609) | 0) + amount);      // 299037-299043
      return { ok: true, paid: amount, kind: 'document' };
    },

    /** 纳付清单里可缴的凭证（299010-299045 只认这三种） */
    payableDocuments(g) {
      const out = [];
      for (const it of (g.player.inv || [])) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        const id = it.id | 0;
        if (id === BILL_ITEM || id === 1084 || id === 1085) out.push(it);
      }
      return out;
    },

    // ==================================================================
    // 三、自营店（278975-279100）
    // ==================================================================

    /**
     * 单个店铺的日收入（278975-279007）。
     * base = (100 - 投资额/100)：恰好 99 时 ×70，否则 ×50；再按店铺种类加权。
     */
    calcIncome(g, slot) {
      const invest = g.getV65(120 + (slot | 0)) | 0;
      let v = 100 - idiv(invest, 100);
      if (v === 99) v = v * 70;
      else v = v * 50;
      switch (slot | 0) {
        case 2: v = idiv(v * 120, 100); break;
        case 4: v = idiv(v * 60, 100); break;
        case 0: v = idiv(v * 80, 100); break;
        case 1: v = idiv(v * 70, 100); break;
        case 6: v = idiv(v * 25, 100); break;
        case 5: v = idiv(v * 20, 100); break;
        case 8: v = idiv(v * 15, 100); break;
        case 3: v = v * 3; break;
        default: break;
      }
      return v | 0;
    },

    /** 店铺是否开着（var_65(120+i) < 10000） */
    shopOpen(g, slot) { return (g.getV65(120 + (slot | 0)) | 0) < 10000; },

    /**
     * 每日店铺结算（279026-279100）。
     * 原版还会按 var_1512/var_645 生成商品；这里保留收入与「是否补货」的骨架，
     * 商品抽取走 ItemDB.create（与原版 itemcreate 同一条链路）。
     * @returns {object} { gold, shops:[], goods:[] }
     */
    dailyIncome(g, opts) {
      const o = opts || {};
      const p = g.player;
      const res = { gold: 0, shops: [], goods: [], total: 0 };
      const arrears = this.arrears(g);
      const discount = (p.get(189) | 0) === 10;        // 279034

      for (let slot = 0; slot < 9; slot++) {
        if (!this.shopOpen(g, slot)) continue;
        const base = this.calcIncome(g, slot);
        if (base <= 0) continue;
        const R = (n) => g.rng.rnd(Math.max(1, n | 0));
        let gold = base + R(idiv(base, 3) + 1) - R(idiv(base, 3) + 1);   // 279032
        res.total += gold;
        if (discount) gold = idiv(gold, 100) * 95;                        // 279034-279036
        res.gold += gold;
        res.shops.push({ slot, gold, invest: g.getV65(120 + slot) | 0 });

        // 279053-279099：按滞纳程度决定今日进货件数
        let count;
        if (arrears <= 1) {
          count = R(R(3) + 1) + 1 + (R((g.getV65(170) | 0) + this.calcBuilding(g) + this.calcTax(g)) > R(50000) ? 1 : 0);
        } else {
          count = 1;
        }
        // 279055-279068：商品等级与品质。见習い補給係（var_97(39)）让 `rnd(4|6) < 等级`
        // 成立时品质 +1；灵布等「魔法具」类别还会换成 58005（高品质魔法具）。
        const supply = (Elona.Feat && Elona.Feat.get) ? (Elona.Feat.get(p, 39) | 0) : 0;
        for (let k = 0; k < count; k++) {
          if (o.noGoods) break;
          let lv = idiv(100 - idiv(g.getV65(120 + slot) | 0, 100), 2) + 1;
          if (arrears <= 1) {
            lv += idiv((g.getV65(170) | 0) + this.calcBuilding(g) + this.calcTax(g), 5000);
          }
          lv = Elona.ItemDB.calcObjLv ? Elona.ItemDB.calcObjLv(lv, g) : Math.max(1, lv);
          const fix = Elona.ItemDB.calcFixLv
            ? Elona.ItemDB.calcFixLv(3 + (R(arrears <= 1 ? 4 : 6) < supply ? 1 : 0), g)
            : 3;
          let it = null;
          try {
            it = Elona.ItemDB.create(g, { level: lv, fix });
          } catch (e) { it = null; }
          if (it) {
            // 279065-279068：`var_638 == 57000`（魔法具）且 `rnd(5) < var_97(39)`
            //   → `var_639 = 58005`，即换成高品质魔法具。
            if ((Elona.ItemDB.ref(it.id, 5) | 0) === 57000 && R(5) < supply) {
              try {
                const hi = Elona.ItemDB.create(g, { level: lv, fix, t638: 58005 });
                if (hi && hi.id) it = hi;
              } catch (e) { /* 没有该小类时保留原物 */ }
            }
            it.f[5] = -1; it.f[6] = -1;
            res.goods.push(it);
          }
        }
      }

      // 279038：itemcreate -1, 54, -1, -1, gold（落到玩家脚下）
      if (res.gold > 0 && !o.dryRun) this.dropGold(g, res.gold);
      return res;
    },

    // ==================================================================
    // 雇工（214468-214538）
    // ==================================================================

    /** calchirecost：店员日薪（按职业 var_58(150)） */
    hireCost(c) {
      if (!c) return 0;
      const job = c.get(150) | 0;
      if (job === 26) return c.get(38) | 0;      // 214491：按等级
      return HIRE_COST[job] || 0;
    },

    /** calccosthire：在 57..244 里累加店员日薪，写回 var_65(170) */
    calcHire(g) {
      let sum = 0;
      for (let i = 57; i <= 244; i++) {
        const c = g.charas[i];
        if (!c || (c.get(0) | 0) !== 1) continue;
        if ((c.get(150) | 0) === 0) continue;
        sum += this.hireCost(c);
      }
      sum = Math.abs(idiv(sum * this.taxModifier(g.player), 100));
      g.setV65(170, sum);
      return sum;
    },
  };

  Elona.Economy = Economy;
  if (typeof module !== 'undefined' && module.exports) module.exports = Economy;
})(typeof window !== 'undefined' ? window : global);
