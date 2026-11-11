'use strict';
/**
 * 魔力充填 / 魔力抽取 —— 特殊能力 630 / 629（源码 326463-326651）
 *
 * ## 630 魔力の充填（326478-326581）
 *   326479-326486  `var_65(25) < 10` → 「充填するには最低でも魔力の貯蓄が10必要だ。」
 *   326487         `var_65(25) -= 10`
 *   326502         不可充填：290 / 480 / 289 / 732 / 687（且 f[26] != 0）
 *   326511         `f[9] > var_1008`（上限）→ 「これ以上充填できない」
 *   326522-326531  失败判定三次：`rnd(var_578/25+1)==0`、54000 类 `rnd(4)==0`、
 *                  `rnd(var_1008²+1)==0`
 *   326534-326546  成功量 = 2（魔道具 164 判定再加 1），不超过 var_1008；
 *                  54000 类固定 1（判定再加 1）
 *   326552         `f[9] += var_400`；326557 练技能 164 +50
 *   326560-326568  失败时 `rnd(limit(魔道具,0,198)+2)==0` → 物品破裂（数量 -1）
 *
 * ## 629 魔力の抽出（326594-326647）
 *   326599         ibit 13（no-drop）→ 拒绝
 *   326613-326629  基础量按 var_1008（上限）：1→100+、2→25+、<=4→5+、<=6→3+、其余 1
 *   326632-326638  `var_1008 >= 14` 时另算；否则 × f[9]
 *   326645         物品数量归 0；326647 练技能 164 +100
 *
 * `var_1008`（充能上限）来自物品模板表 `var_59 == 2` 分支，由
 * `tools/extract_recharge.py` 抽成 web/data/tables/recharge.json。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => ((a / b) | 0);
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const F_COUNT = 0;      // var_99(0) 数量
  const F_CHARGE = 9;     // var_99(9) 使用次数 / 充能
  const F_SUB = 26;       // var_99(26) 子类型
  const SKILL_DEV = 164;  // 魔道具
  const V_POWER = 25;     // var_65(25) 充填用魔力
  const NO_FILL = [290, 480, 289, 732];

  let table = null;

  async function load() {
    if (table) return table;
    try {
      table = await Elona.Data.table('recharge');
    } catch (e) {
      table = { maxCharge: {} };
    }
    return table;
  }

  /** 充能上限（未收录的物品返回 0 = 不可充能） */
  function maxOf(id) {
    if (!table) return 0;
    const v = (table.maxCharge || {})[String(id | 0)];
    return (v === undefined) ? 0 : (v | 0);
  }

  function devOf(c) {
    if (Elona.Stats && Elona.Stats.sorg) return (Elona.Stats.sorg(c, SKILL_DEV) | 0);
    return (c && typeof c.get === 'function') ? (c.get(SKILL_DEV) | 0) : 0;
  }
  function rnd(g, n) {
    const R = (g && g.rng) ? g.rng : Elona.rng;
    return (R && R.rnd) ? (R.rnd(Math.max(1, n | 0)) | 0) : 0;
  }
  function isPotionLike(id) {
    return Elona.ItemDB && Elona.ItemDB.ref && (Elona.ItemDB.ref(id | 0, 5) | 0) === 54000;
  }
  function powerOf(it) {
    if (Elona.Wand && Elona.Wand.isWand && Elona.Wand.isWand(it)) return Elona.Wand.basePower(it) | 0;
    return 100;
  }

  /**
   * 630 魔力の充填。
   * @returns {{ok:boolean, reason?:string, message?:string, added?:number}}
   */
  function fill(g, c, it) {
    if (!it || (it.f[F_COUNT] | 0) <= 0) return { ok: false, reason: 'no-item' };
    const pool = g.getV65 ? (g.getV65(V_POWER) | 0) : 0;
    if (pool < 10) {                                       // 326479-326486
      return { ok: false, reason: 'low-power', message: '要充填至少需要 10 点魔力储蓄。' };
    }
    const id = it.f[3] | 0;
    if (NO_FILL.indexOf(id) >= 0 || (id === 687 && (it.f[F_SUB] | 0) !== 0)) {
      return { ok: false, reason: 'no-fill', message: '那个好像不能充填。' };   // 326502-326509
    }
    const max = maxOf(id);
    if (!max) return { ok: false, reason: 'no-fill', message: '那个好像不能充填。' };
    if ((it.f[F_CHARGE] | 0) > max) {
      return { ok: false, reason: 'full', message: '那个已经不能再充填了。' };   // 326511-326521
    }
    if (g.setV65) g.setV65(V_POWER, pool - 10);            // 326487

    // 326522-326532：三段失败判定
    let ok = true;
    if (rnd(g, idiv(powerOf(it), 25) + 1) === 0) ok = false;
    if (isPotionLike(id) && rnd(g, 4) === 0) ok = false;
    if (rnd(g, max * max + 1) === 0) ok = false;

    const dev = devOf(c);
    if (ok) {
      let add = 2;                                          // 326534
      if (rnd(g, dev + 2) >= rnd(g, 100) + 1) add += 1;     // 326535-326537
      if (add + (it.f[F_CHARGE] | 0) > max) add = max - (it.f[F_CHARGE] | 0) + 1;   // 326538-326540
      if (isPotionLike(id)) {                               // 326541-326546
        add = 1;
        if (rnd(g, dev + 2) >= rnd(g, 100) + 1) add += 1;
      }
      it.f[F_CHARGE] = (it.f[F_CHARGE] | 0) + add;           // 326552
      if (Elona.Stats && Elona.Stats.skillExp) {
        try { Elona.Stats.skillExp(c, SKILL_DEV, c.index | 0, 50, 9999, 0, g); } catch (e) { /* 忽略 */ }
      }
      return { ok: true, added: add, message: `充填完成（+${add}）。` };
    }
    // 326560-326568：失败，小概率破裂
    if (rnd(g, limit(dev, 0, 198) + 2) === 0) {
      it.f[F_COUNT] = Math.max(0, (it.f[F_COUNT] | 0) - 1);
      return { ok: false, reason: 'explode', message: '物品破裂了！' };
    }
    return { ok: false, reason: 'fail', message: '充填失败了。' };
  }

  /**
   * 629 魔力の抽出（毁掉物品换成充填用魔力）。
   * @returns {{ok:boolean, reason?:string, message?:string, gained?:number}}
   */
  function drain(g, c, it) {
    if (!it || (it.f[F_COUNT] | 0) <= 0) return { ok: false, reason: 'no-item' };
    if (Elona.Status && Elona.Status.ibit && Elona.Status.ibit(c, 13)) {
      return { ok: false, reason: 'no-drop', message: '那是你的重要物品，无法毁掉。' };  // 326599-326608
    }
    const id = it.f[3] | 0;
    const max = maxOf(id);
    if (!max) return { ok: false, reason: 'no-fill', message: '那个物品无法抽出魔力。' };
    const dev = devOf(c);
    let gain = 1;
    if (max === 1) gain = 100 + limit(idiv(dev + 1, 10), 0, 50);       // 326613-326616
    else if (max === 2) gain = 25 + limit(idiv(dev + 1, 10), 0, 10);    // 326617-326620
    else if (max <= 4) gain = 5 + limit(idiv(dev + 1, 10), 0, 3);       // 326621-326624
    else if (max <= 6) gain = 3 + limit(idiv(dev + 1, 10), 0, 2);       // 326625-326628
    const charge = it.f[F_CHARGE] | 0;
    if (max >= 14) {                                                     // 326632-326635
      gain = idiv(charge + 1, 2) + charge * limit(idiv(dev + 1, 10), 0, 2);
    } else {
      gain = gain * charge;                                              // 326637
    }
    if (g.setV65) g.setV65(V_POWER, (g.getV65(V_POWER) | 0) + gain);
    it.f[F_COUNT] = 0;                                                   // 326645
    if (Elona.Stats && Elona.Stats.skillExp) {
      try { Elona.Stats.skillExp(c, SKILL_DEV, c.index | 0, 100, 9999, 0, g); } catch (e) { /* 忽略 */ }
    }
    return { ok: true, gained: gain, message: `毁掉物品，抽出 ${gain} 点魔力（合计 ${g.getV65(V_POWER) | 0}）。` };
  }

  Elona.Recharge = { load, maxOf, fill, drain, V_POWER, SKILL_DEV };
})(window);
