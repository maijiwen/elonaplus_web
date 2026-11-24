'use strict';
/**
 * 小奖章兑换（core/medal.js）—— 米拉尔工房的「交换」系统
 *
 * 【源码依据】start.hsp
 *   calcmedalvalue        213985-214061   物品 → 奖章价值（默认 1）
 *   商店类型 1016         238547-238563   地图 34 `smith0` 里 209 号（ミラル）的 var_58(150)=1016,100
 *   固定货架 25 件        427227-427305   PETSHOP_IDS（shop.js 已按此生成库存）
 *   交易界面              296905-296936   `var_486 == 28` 时显示「(持っているメダル: N枚)」
 *   兑换结算              299173-299222   奖章不足 → 拒绝；否则扣 622、给货、convertartifact
 *
 * 【货币】小奖章 = 物品 622。原版不是用金币买，而是 `item_find 622, 3, 1` 取背包里
 *   622 的总数（299196-299203），再按 `calcmedalvalue(商品)` 扣（299213）。
 *   因此本模块只提供「以奖章计价 / 支付」的纯逻辑，实际入包与堆叠交给 shop.js。
 *
 * 【注意】这里不使用金币：1016 号店在原版里没有买卖，只有交换（`var_486 = 28`）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 奖章物品 id（622 小さなメダル / 小徽章） */
  const MEDAL_ID = 622;

  /**
   * calcmedalvalue（213985-214061）：物品 id → 需要多少枚奖章。
   * 源码是 24 个 `if (var_99(3, item) == N) return V` + `return 1`。
   */
  const VALUE = {
    430: 15,    // 成長の巻物
    431: 8,     // 信仰の巻物
    502: 7,     // 素材変化の巻物
    480: 20,    // 支配の杖
    421: 5,     // 神器の種
    603: 20,    // 社長椅子
    615: 5,     // 請求書
    559: 10,    // エーテル抗体
    516: 3,     // 水
    616: 18,    // 徴税官の納税箱
    623: 85,    // 妹の秘密の日記
    624: 25,    // お嬢様の日記
    505: 12,    // 妹の日記
    625: 11,    // 鳥居
    626: 60,    // ヘルメスの血
    1113: 30,   // 注射器
    1037: 35,   // エレメンタルアイ
    1186: 40,   // 世界制服
    892: 50,    // ★《ST-02 シールド》
    627: 55,    // ★《賢者の兜》
    56: 65,     // ★《ディアボロス》
    742: 72,    // 巣穴探索許可証
    760: 47,    // ガロクの槌
    1310: 14,   // ヘアバンド
    1311: 19,   // サディスティックテイル
  };

  /**
   * 米拉尔固定货架（427227-427305，`cnt == 0..24` 的顺序即索引）。
   * 与 shop.js 的 PETSHOP_IDS 同源；这里保留一份是为了让本模块可独立测试。
   */
  const GOODS = [
    430, 431, 502, 480, 421, 603, 615, 559, 516, 616, 623, 505, 624,
    625, 626, 627, 56, 742, 760, 892, 1037, 1186, 1113, 1310, 1311,
  ];

  /** calcmedalvalue：接受物品实例或物品 id */
  function value(itemOrId) {
    const id = (itemOrId && typeof itemOrId === 'object')
      ? (itemOrId.id | 0) : (itemOrId | 0);
    return VALUE[id] || 1;                                  // 214061 `return 1`
  }

  /** 背包里 622 的总枚数（`item_find 622, 3, 1` → `var_99(0)`） */
  function count(g) {
    const p = g && g.player;
    if (!p || !p.inv) return 0;
    let n = 0;
    for (const it of p.inv) {
      if (it && (it.id | 0) === MEDAL_ID && (it.f[0] | 0) > 0) n += it.f[0] | 0;
    }
    return n;
  }

  /**
   * 支付奖章（299213）：从背包各堆里扣，扣光的格子置空。
   * @returns {number} 实际扣掉的枚数（不足时扣到 0 为止）
   */
  function pay(g, amount) {
    const p = g && g.player;
    let need = Math.max(0, amount | 0);
    if (!p || !p.inv || need <= 0) return 0;
    let paid = 0;
    for (let i = 0; i < p.inv.length && need > 0; i++) {
      const it = p.inv[i];
      if (!it || (it.id | 0) !== MEDAL_ID) continue;
      const have = it.f[0] | 0;
      if (have <= 0) continue;
      const take = Math.min(have, need);
      it.f[0] = have - take;
      if ((it.f[0] | 0) <= 0) p.inv[i] = null;
      need -= take;
      paid += take;
    }
    return paid;
  }

  /** 1016 号店（ミラル）的判定：原版 ROLES 里只有它是奖章交换 */
  function isMedalShop(role) { return (role | 0) === 1016; }

  Elona.Medal = {
    MEDAL_ID, VALUE, GOODS,
    value, count, pay, isMedalShop,
  };
})(typeof window !== 'undefined' ? window : globalThis);
