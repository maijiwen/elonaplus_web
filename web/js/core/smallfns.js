'use strict';
/**
 * 零散小函数（core/smallfns.js）—— 此前被判定「不移植」的一批 1~37 行的原版工具函数，
 * 现按原版逐条补齐。每个函数上方标注源码行号与用途，便于溯源。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  // ---------------------------------------------------------------------------
  // randwskill（5030）—— 随机武器技能 id（100..111）
  //   用途：生成武器时给它随机附一个「武器技能」。
  // ---------------------------------------------------------------------------
  function randWeaponSkill(rng) {
    const R = (n) => (rng && rng.rnd ? rng.rnd(n) : Math.floor(Math.random() * n));
    return R(112 - 100) + 100;
  }

  // ---------------------------------------------------------------------------
  // calcexpalive（211716-211717）—— 经验换算：exp * 100
  //   用途：队伍总经验/战斗经验的显示换算。
  // ---------------------------------------------------------------------------
  function calcExpAlive(exp) {
    return (exp | 0) * 100;
  }

  // ---------------------------------------------------------------------------
  // dimmix（232337-…）—— 数组洗牌（Fisher-Yates 变体）
  //   var_1762 = cnt + rnd(len - cnt); 交换 prm(cnt) 与 prm(var_1762)
  // ---------------------------------------------------------------------------
  function shuffle(arr, rng) {
    const a = arr.slice();
    const R = (n) => (rng && rng.rnd ? rng.rnd(n) : Math.floor(Math.random() * n));
    for (let i = 0; i < a.length; i++) {
      const j = i + R(a.length - i);
      const t = a[j]; a[j] = a[i]; a[i] = t;
    }
    return a;
  }

  // ---------------------------------------------------------------------------
  // selectcoast（230171-230178）—— 地形属性 → 海岸图块 id
  //   属性 4 → 297；属性 7 → 309；其它 → 285
  // ---------------------------------------------------------------------------
  function selectCoast(tileAttr) {
    const a = tileAttr | 0;
    if (a === 4) return 297;
    if (a === 7) return 309;
    return 285;
  }

  // ---------------------------------------------------------------------------
  // clear_rprefmat（280028-280032）—— 清空「材质改造」界面的 10 个物品槽
  //   repeat 10: var_2127(10 + cnt*2) = -1
  // ---------------------------------------------------------------------------
  function clearRprefmat() {
    const slots = [];
    for (let i = 0; i < 10; i++) slots.push(-1);
    return slots;
  }

  // ---------------------------------------------------------------------------
  // addefmap（24273-24275）—— 在地图上登记一个「装饰绘制条目」
  //   var_591(0, x, y) = a, b, c, d（图像 id / 旋转 / 缩放 / 参数）
  // ---------------------------------------------------------------------------
  function addExtraMap(g, x, y, a, b, c, d) {
    if (!g) return false;
    if (!g.extraMap) g.extraMap = {};
    const key = (x | 0) + ',' + (y | 0);
    g.extraMap[key] = [a | 0, b | 0, c | 0, d | 0];
    return true;
  }
  function extraMapAt(g, x, y) {
    return g && g.extraMap ? (g.extraMap[(x | 0) + ',' + (y | 0)] || null) : null;
  }

  // ---------------------------------------------------------------------------
  // fltname（19960-19996）—— 物品「类别名」（flt = float 随机物品的类别显示）
  //   60001 井戸 / 57000 食べ物 / 56000 杖 / 53000 巻物 / 52000 ポーション /
  //   64000 ジャンク / 77000 鉱石 / 60000 家具 / 25000 矢弾 / 55000 書物 /
  //   72000 箱 / 62000 残骸 / 其它 → 不明
  // ---------------------------------------------------------------------------
  const CATEGORY_NAMES = {
    60001: { jp: '井戸', en: 'well' },
    57000: { jp: '食べ物', en: 'food' },
    56000: { jp: '杖', en: 'rods' },
    53000: { jp: '巻物', en: 'scrolls' },
    52000: { jp: 'ポーション', en: 'potions' },
    64000: { jp: 'ジャンク', en: 'junks' },
    77000: { jp: '鉱石', en: 'ores' },
    60000: { jp: '家具', en: 'furniture' },
    25000: { jp: '矢弾', en: 'ammos' },
    55000: { jp: '書物', en: 'books' },
    72000: { jp: '箱', en: 'boxes' },
    62000: { jp: '残骸', en: 'remains' },
  };
  function categoryName(cat, lang) {
    const e = CATEGORY_NAMES[cat | 0];
    if (!e) return lang === 'jp' ? '不明' : 'Unknown';
    return lang === 'jp' ? e.jp : e.en;
  }

  Elona.SmallFns = {
    randWeaponSkill, calcExpAlive, shuffle, selectCoast,
    clearRprefmat, addExtraMap, extraMapAt,
    categoryName, CATEGORY_NAMES,
  };
})(window);
