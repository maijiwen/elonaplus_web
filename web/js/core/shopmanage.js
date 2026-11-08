'use strict';
/**
 * 自营店收款机 / 营业天赋（core/shopmanage.js）
 *
 * 【源码锚点（ElonaPlus 2.33R）】
 *   233240-233265  收款机菜单：店类型变更(11) / 店主訓練(12) / 営業フィート獲得(13) /
 *                  1日の販売数を制限(14)；训练费用 var_1782 = limit((交渉+魅力)/100+1,1,20)，
 *                  `sorg(156)==0`（没学过交渉）时不可选。
 *   234459-234513  case 11：`var_132(39,map) > now` 则拒绝，成功后置 now+24*15（360 小时），
 *                  `var_132(13,map) = 选中项-1`。
 *   234514-234544  case 12：`item_find 1041,3,1`（青铜币），扣费后
 *                  `modgrowth 店番,156,150` / `modgrowth 店番,17,150`。
 *   234545-234648  case 13：业绩 var_58(439) 门槛 120 / 360，最多 2 个（var_58(440)）；
 *                  1..5 → cbit 1020..1024；1020 附带 `skillmod 17, 店番, 30000`，
 *                  获取不消耗业绩。
 *   234649-234666  case 14：`var_132(37,map) = 选中项-1`（0 无限制 / 1 15 品 / 2 5 品）。
 *   233398-233411  装修结束重扫地面：tile 37（样本柜台）上的物品 ibit(21)=1，其余清 0。
 *   399842-399850  丧失狂宫傀儡巫女美伊露：清 1020-1024、var_58(440)=0，
 *                  曾有 1020 时 `skillmod 17, -30000`。
 *   214504-214525  generatemoney：地图更新补足店主持金（本模块只负责触发时机，
 *                  公式在 core/shop.js 的 Shop.generateMoney）。
 *
 * 【项目差异】原版把店类型/冷却/日限存在 var_132(13/37/39, mapId)，本项目存在
 *   `Property.siteOf(g, slot).fields[13/37/39]`，语义等价。菜单选择用 API 参数代替
 *   `*label_2896` 的方向键循环。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const SHOP_TYPE = 102;
  const F_ACTIVE = 0;
  const F_WORKER = 80;
  const F_SALES = 439;      // var_58(439)：营业实绩（自营店日结时 +1）
  const F_FEATS = 440;      // var_58(440)：已获得的营业天赋数
  const SK_NEGOTIATION = 156;
  const SK_CHARISMA = 17;
  const BRONZE_COIN = 1041;
  const TILE_SAMPLE = 37;
  const IBIT_SAMPLE = 21;

  /** 营业天赋：菜单序号 → cbit（234608-234622） */
  const FEATS = [
    { value: 1, cbit: 1020, jp: '気品', zh: '气度（客所持金上升 / 魅力）' },
    { value: 2, cbit: 1021, jp: '審美眼', zh: '审美眼（物物交换汇率上升）' },
    { value: 3, cbit: 1022, jp: '調達', zh: '独自采购（独自稼ぎ ×1.5）' },
    { value: 4, cbit: 1023, jp: '提携力', zh: '提携力（同行时买卖强化）' },
    { value: 5, cbit: 1024, jp: '営業笑顔', zh: '营业微笑（悩殺攻撃）' },
  ];
  /** 经营种类（var_132(13)），与 shopsale.js 的 GENRE_NAMES 一致 */
  const GENRES = ['万事屋', '食品店', '魔法店', '武具店', '旅馆', '装饰家具店', '废品店'];
  /** 每日销售数（var_132(37)） */
  const SALES_LIMITS = ['无限制', '1 日 15 品（交涉经验 +）', '1 日 5 品（交涉经验 ++）'];

  const nowHours = (g) => (g && g.nowHours) ? (g.nowHours() | 0) : 0;

  function siteOf(g, siteId) {
    if (!Elona.Property || !Elona.Property.siteOf) return null;
    return Elona.Property.siteOf(g, siteId | 0);
  }
  function fieldsOf(g, siteId) {
    const s = siteOf(g, siteId);
    if (!s) return null;
    if ((s.type | 0) !== SHOP_TYPE) return null;
    if (!s.fields) s.fields = {};
    return s.fields;
  }
  function workerOf(g, siteId) {
    return Elona.ShopSale ? Elona.ShopSale.workerOf(g, siteId | 0) : null;
  }
  const fail = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});

  // ------------------------------------------------------------------
  // 菜单 12：店主训练
  // ------------------------------------------------------------------
  /** 233240-233243：青铜币费用；没学过交渉时返回 1000000（菜单隐藏） */
  function trainingCost(g, worker) {
    if (!worker || !worker.skill) return 1000000;
    const S = Elona.Stats;
    if (S && S.sorg && S.sorg(worker, SK_NEGOTIATION) === 0) return 1000000;
    const neg = worker.skill(SK_NEGOTIATION) | 0;
    const cha = worker.skill(SK_CHARISMA) | 0;
    return limit(idiv(neg + cha, 100) + 1, 1, 20);
  }

  function findCoins(p, need) {
    const inv = (p && p.inv) || [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (!it || (it.f[0] | 0) < need) continue;
      const id = it.id !== undefined ? (it.id | 0) : (it.f[3] | 0);
      if (id === BRONZE_COIN) return { index: i, it };
    }
    return null;
  }

  function train(g, siteId) {
    const w = workerOf(g, siteId);
    if (!w) return fail('no-worker');
    const cost = trainingCost(g, w);
    if (cost >= 1000000) return fail('no-negotiation');
    const found = findCoins(g.player, cost);
    if (!found) return fail('no-coin', { cost });
    found.it.f[0] = (found.it.f[0] | 0) - cost;
    if ((found.it.f[0] | 0) <= 0) g.player.inv[found.index] = null;
    const S = Elona.Stats;
    if (S && S.modGrowth) {
      S.modGrowth(w, SK_NEGOTIATION, w.index | 0, 150, g);
      S.modGrowth(w, SK_CHARISMA, w.index | 0, 150, g);
    }
    return { ok: true, cost, worker: w, message: `${w.name || '店番'}请来了讲师，潜力得到了开发！` };
  }

  // ------------------------------------------------------------------
  // 菜单 11：更改经营种类
  // ------------------------------------------------------------------
  function changeType(g, siteId, genre) {
    const f = fieldsOf(g, siteId);
    if (!f) return fail('not-shop');
    const gv = genre | 0;
    if (gv < 0 || gv >= GENRES.length) return fail('bad-genre');
    const now = nowHours(g);
    const until = f[39] | 0;
    if (until > now) return fail('cooldown', { until, remaining: until - now });
    f[39] = now + 24 * 15;                       // 234481：360 小时
    f[13] = gv;                                 // 234482：选中项 - 1
    return {
      ok: true, genre: gv, name: GENRES[gv], until: f[39],
      message: `店种类变更：${GENRES[gv]}。`,
    };
  }

  // ------------------------------------------------------------------
  // 菜单 13：营业天赋
  // ------------------------------------------------------------------
  function featGate(w) {
    const got = w.get(F_FEATS) | 0;
    if (got >= 2) return null;
    return got === 0 ? 120 : 360;
  }

  function grantFeat(g, siteId, value) {
    const w = workerOf(g, siteId);
    if (!w) return fail('no-worker');
    const feat = FEATS.find((x) => x.value === (value | 0));
    if (!feat) return fail('bad-feat');
    const got = w.get(F_FEATS) | 0;
    const gate = featGate(w);
    if (gate === null) return fail('max-feats', { got });
    if ((w.get(F_SALES) | 0) < gate) return fail('low-sales', { need: gate, have: w.get(F_SALES) | 0 });
    const S = Elona.Status;
    if (S && S.cbit && S.cbit(w, feat.cbit)) return fail('owned', { cbit: feat.cbit });
    if (S && S.cbitmod) S.cbitmod(w, feat.cbit, true);
    // 234634-234636：気品附带魅力 +30000 经验（约 30 级）
    if (feat.cbit === 1020 && Elona.Stats && Elona.Stats.skillMod) {
      Elona.Stats.skillMod(w, SK_CHARISMA, w.index | 0, 30000, g);
    }
    w.set(F_FEATS, got + 1);
    return {
      ok: true, cbit: feat.cbit, value: feat.value, name: feat.zh,
      owned: got + 1, message: `${w.name || '店番'}获得了营业天赋「${feat.jp}」。`,
    };
  }

  /** 399842-399850：傀儡巫女美伊露去除全部营业天赋，不重置业绩 */
  function removeFeats(g, c) {
    if (!c) return fail('no-worker');
    const S = Elona.Status;
    let hadElegance = S && S.cbit ? !!S.cbit(c, 1020) : false;
    if (S && S.cbitmod) {
      for (const f of FEATS) S.cbitmod(c, f.cbit, false);
    }
    if (hadElegance && Elona.Stats && Elona.Stats.skillMod) {
      Elona.Stats.skillMod(c, SK_CHARISMA, c.index | 0, -30000, g);
    }
    c.set(F_FEATS, 0);
    return { ok: true, cleared: FEATS.length, refundedCharisma: hadElegance };
  }

  // ------------------------------------------------------------------
  // 菜单 14 / 柜台样本 / 状态
  // ------------------------------------------------------------------
  function setSalesLimit(g, siteId, level) {
    const f = fieldsOf(g, siteId);
    if (!f) return fail('not-shop');
    const v = level | 0;
    if (v < 0 || v >= SALES_LIMITS.length) return fail('bad-limit');
    f[37] = v;
    return { ok: true, level: v, name: SALES_LIMITS[v], message: `日销售限制：${SALES_LIMITS[v]}。` };
  }

  /** 233398-233411：tile 37 上的物品打 ibit(21)（非売品 / 样本用），离开柜台清掉 */
  function markSamples(g) {
    const items = (g && g.groundItems) || [];
    const I = Elona.ItemDB;
    let on = 0, off = 0;
    for (const it of items) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      const x = it.f[5] | 0, y = it.f[6] | 0;
      let sample = false;
      if (x >= 0 && y >= 0 && Elona.MapFeat && Elona.MapFeat.read) {
        const t = Elona.MapFeat.read(g, x, y);
        sample = !!(t && (t.type | 0) === TILE_SAMPLE);
      }
      if (I && I.ibitmod) I.ibitmod(IBIT_SAMPLE, it, sample ? 1 : 0);
      if (sample) on++; else off++;
    }
    return { ok: true, samples: on, cleared: off };
  }

  function status(g, siteId) {
    const f = fieldsOf(g, siteId);
    if (!f) return { ok: false, reason: 'not-shop' };
    const w = workerOf(g, siteId);
    return {
      ok: true,
      siteId: siteId | 0,
      genre: f[13] | 0, genreName: GENRES[f[13] | 0] || GENRES[0],
      changeUntil: f[39] | 0, changeReady: (f[39] | 0) <= nowHours(g),
      salesLimit: f[37] | 0, salesLimitName: SALES_LIMITS[f[37] | 0] || SALES_LIMITS[0],
      worker: w ? (w.name || ('chara ' + (w.index | 0))) : null,
      sales: w ? (w.get(F_SALES) | 0) : 0,
      feats: w ? (w.get(F_FEATS) | 0) : 0,
      featGate: w ? featGate(w) : null,
      trainingCost: w ? trainingCost(g, w) : null,
      ownedFeats: w && Elona.Status && Elona.Status.cbit
        ? FEATS.filter((x) => Elona.Status.cbit(w, x.cbit)).map((x) => x.zh) : [],
    };
  }

  /** 独立 LCG：跨日补持金不能消耗 g.rng，否则会改变随机地城/掉落/战斗的序列 */
  function localRng(seed) {
    return (Elona.Shop && Elona.Shop.localRng)
      ? Elona.Shop.localRng(seed)
      : { rnd: () => 0 };
  }

  /**
   * 249298-249303：大地图行走 / 在家时的日变化给角色补持金。
   * 只在 `g.worldMap` 存在时触发；随机源用 (绝对小时, 角色下标) 派生的独立 LCG，
   * 保证「同一时刻同一角色结果一致」且不污染全局序列（0-FP.4 的回归教训）。
   */
  function onDayChange(g) {
    if (!g || !g.worldMap || !Elona.Shop || !Elona.Shop.generateMoney) return 0;
    let n = 0;
    const now = nowHours(g);
    for (const c of (g.charas || [])) {
      if (!c || (c.get(F_ACTIVE) | 0) !== 1) continue;
      if (!Elona.Shop.isShopkeeper(c)) continue;
      const seed = Math.imul(now ^ 0x9e3779b9, 31) + (c.index | 0) + 1;
      Elona.Shop.generateMoney(g, c, localRng(seed));
      n++;
    }
    return n;
  }

  Elona.ShopManage = {
    SHOP_TYPE, FEATS, GENRES, SALES_LIMITS, BRONZE_COIN,
    F_SALES, F_FEATS, TILE_SAMPLE, IBIT_SAMPLE,
    trainingCost, train, changeType, grantFeat, featGate, removeFeats,
    setSalesLimit, markSamples, status, onDayChange,
  };
})(typeof window !== 'undefined' ? window : global);
