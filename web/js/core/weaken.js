'use strict';
/**
 * 属性弱化与「属性维持」附魔 —— start.hsp 213828-213854 / 335794-335812 / 336868-336900 / 321933-321950 / 216073-216080
 *
 * 【机制】
 *   角色字段 `var_58(240 + idx)`（idx 0..9 对应属性 10..19）是**属性修正累计**，
 *   最终属性 = 技能值 + 240+idx（stats.js 的 applyEquipment 213828-213853 已实现）。
 *   「弱化」就是把这个累计值往负数方向推。
 *
 * 【三重免疫（顺序同源码）】
 *   ① `var_58(25) >= 4`（品质 4 / 精英《名前》）→ 完全不弱化
 *   ② `encfind(c, 6*10000 + 10 + idx) != -1`（附魔「XX属性维持」）→ 该属性不弱化
 *   ③ 当前值已低于基础值的 1/2 → 不再继续弱化
 *   （芳香 788 与枷锁 723 还多一条：`findbuff(c, 60) != -1` 时跳过）
 *
 * 【弱化量】
 *   `diff = 基础值(sorg) - 240+idx`；`p = (power + 1)/4 + base`；
 *   `减少量 = diff * p / 2000 + 5`（整除）
 *
 * 【调用点（源码 id）】
 *   787 槲寄生投掷   → 力量(10)  base=20
 *   788 魔力芳香     → 速度(18)  base=10
 *   723 卷轴缠身     → 器用(12)  base=10
 *   4   噩梦事件     → 魅力(13)/意志(15)/幸运(19)，减少量 = sorg/3 + 5
 *   状态 261         → 1/80 随机一项属性，减少量 = sorg/25 + 1
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => Math.trunc(a / b);

  const FIELD_BASE = 240;          // var_58(240 + idx)
  const ENC_MAINTAIN = 60010;      // 6*10000 + 10

  function sorg(c, id) {
    if (Elona.Stats && Elona.Stats.sorg) return Elona.Stats.sorg(c, id) | 0;
    return c && c.skill ? (c.skill(id) | 0) : 0;
  }
  function cur(c, id) { return c && c.skill ? (c.skill(id) | 0) : 0; }

  /** 是否可以弱化该属性（①②③ 三重免疫） */
  function canWeaken(g, c, idx, opts) {
    opts = opts || {};
    if (!c || !c.get) return { ok: false, reason: 'no-target' };
    if ((c.get(25) | 0) >= 4) return { ok: false, reason: 'quality' };      // ①
    if (Elona.ItemDB && Elona.ItemDB.encfind
      && Elona.ItemDB.encfind(c, ENC_MAINTAIN + (idx | 0)) !== -1) {
      return { ok: false, reason: 'maintain' };                            // ②
    }
    if (opts.needBuff60 && Elona.Status && Elona.Status.findbuff
      && Elona.Status.findbuff(c, 60) !== -1) {
      return { ok: false, reason: 'buff60' };
    }
    const base = sorg(c, 10 + (idx | 0));
    if (cur(c, 10 + (idx | 0)) < idiv(base, 2)) return { ok: false, reason: 'floor' };   // ③
    return { ok: true, base };
  }

  /**
   * 通用弱化。
   * @param {object} g
   * @param {object} c 目标
   * @param {number} idx 0..9（属性 10+idx）
   * @param {number} power 强度来源（如 var_82(180) 精灵术 / var_82(150) 魔术）
   * @param {{base?:number, needBuff60?:boolean, fixed?:number}} [opts]
   *        base = 公式里的常数项（槲寄生 20 / 芳香·枷锁 10）
   *        fixed = 直接指定减少量（噩梦事件用）
   * @returns {{ok:boolean, reason?:string, amount?:number}}
   */
  function weaken(g, c, idx, power, opts) {
    opts = opts || {};
    const chk = canWeaken(g, c, idx, opts);
    if (!chk.ok) return chk;
    const base = chk.base;
    let loss = 0;
    if (opts.fixed !== undefined) {
      loss = opts.fixed | 0;
    } else {
      const diff = base - (c.get(FIELD_BASE + (idx | 0)) | 0);
      if (diff <= 0) return { ok: false, reason: 'no-bonus' };
      const p = idiv((power | 0) + 1, 4) + (opts.base === undefined ? 10 : (opts.base | 0));
      loss = idiv(diff * p, 2000) + 5;
    }
    if (loss <= 0) return { ok: false, reason: 'no-loss' };
    c.set(FIELD_BASE + (idx | 0), (c.get(FIELD_BASE + (idx | 0)) | 0) - loss);
    if (Elona.Stats && Elona.Stats.recalcStats) Elona.Stats.recalcStats(c, g);
    return { ok: true, amount: loss, attr: 10 + (idx | 0) };
  }

  /** 状态 261 的随机弱化 —— 216073-216080（1/80，减少量 sorg/25+1） */
  function tickAtrophy(g, c) {
    if (!c || (c.get(261) | 0) <= 0) return null;
    const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
    if (R(80) !== 0) return null;
    const idx = R(10);
    // 这一处不判品质/附魔，直接看 encfind（源码同样只判 encfind）
    if (Elona.ItemDB && Elona.ItemDB.encfind
      && Elona.ItemDB.encfind(c, ENC_MAINTAIN + idx) !== -1) return null;
    const loss = idiv(sorg(c, 10 + idx), 25) + 1;
    c.set(FIELD_BASE + idx, (c.get(FIELD_BASE + idx) | 0) - loss);
    if (Elona.Stats && Elona.Stats.recalcStats) Elona.Stats.recalcStats(c, g);
    return { ok: true, amount: loss, attr: 10 + idx };
  }

  /** 噩梦事件（var_1302 == 4，275926-275965）：魅力 13 / 意志 15 / 幸运 19 */
  function nightmare(g, c) {
    const out = [];
    if (!c) return out;
    if (Elona.Status && Elona.Status.findbuff && Elona.Status.findbuff(c, 60) !== -1) return out;
    for (const attr of [13, 15, 19]) {
      const idx = attr - 10;
      if (Elona.ItemDB && Elona.ItemDB.encfind
        && Elona.ItemDB.encfind(c, ENC_MAINTAIN + idx) !== -1) continue;
      const diff = sorg(c, attr) - (c.get(FIELD_BASE + idx) | 0);
      if (diff > 0) {
        c.set(FIELD_BASE + idx, (c.get(FIELD_BASE + idx) | 0) - (idiv(sorg(c, attr), 3) + 5));
        out.push({ attr });
      }
    }
    if (out.length && Elona.Stats && Elona.Stats.recalcStats) Elona.Stats.recalcStats(c, g);
    return out;
  }

  Elona.Weaken = { weaken, canWeaken, tickAtrophy, nightmare, FIELD_BASE, ENC_MAINTAIN };
})(typeof window !== 'undefined' ? window : global);
