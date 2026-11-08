/**
 * 生産（用材料制作物品）—— 使用「工具类道具」进入的生产窗口。
 *
 * 源码依据（hsp/start.hsp）：
 *   348854-348859  var_99(19) == 1..4 时 → var_486 = 0、gosub *label_2578（生产窗口）
 *   270386-270439  *label_2578 列表：遍历物品 id 0..var_729(=1336)，用 *label_1939 查配方
 *   38464-38478    prodcheck()：技能足够且材料齐全才算可做
 *   270612-270682  执行：吃材料 → 品质判定 → calcobjlv/calcfixlv → itemcreate → 技能经验
 *   192335-192747  *label_1939 配方表（按产物的物品 id 索引）
 *
 * 工具 → 技能（348854 + 270402-270421 的 var_2055 分支）：
 *   1 工具（161）      → 176 工作
 *   2 錬金術の道具(127) → 178 錬金術
 *   3 宝石加工ツール(393)→ 179 宝石細工
 *   4 裁縫セット（160） → 177 裁縫
 */
(function (global) {
  'use strict';
  const Elona = global.Elona = global.Elona || {};

  /** 工具类型（var_99(19) / var_2055）→ 技能 id */
  const KIT_SKILL = { 1: 176, 2: 178, 3: 179, 4: 177 };

  /** 技能 id → 名称（172 起是生产系技能） */
  const SKILL_NAME = { 176: '工作', 177: '裁縫', 178: '錬金術', 179: '宝石細工' };

  let DATA = null;

  async function load() {
    if (DATA) return DATA;
    const t = await Elona.Data.table('production');
    DATA = t.recipes || {};
    return DATA;
  }

  function def(id) {
    return DATA ? (DATA[String(id)] || null) : null;
  }

  /** 该物品是否是生产工具（var_99(19) = 1..4） */
  function kitTypeOf(it) {
    if (!it) return 0;
    const t = it.f[19] | 0;
    return KIT_SKILL[t] ? t : 0;
  }

  /** 工具对应的技能 */
  function kitSkill(type) {
    return KIT_SKILL[type] | 0;
  }

  /** 背包里可用的工具（按 var_99(19) 判定） */
  function kits(g) {
    const out = [];
    const inv = g.player && g.player.inv ? g.player.inv : [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (!it || (it.f[0] | 0) <= 0) continue;
      const t = kitTypeOf(it);
      if (t) out.push({ idx: i, item: it, type: t, skill: KIT_SKILL[t] });
    }
    return out;
  }

  /**
   * prodcheck —— 38464-38478。
   *   技能等级 < 需求 → 不可做；任一材料数量不足 → 不可做。
   * @returns {boolean}
   */
  function canProduce(g, r) {
    if (!r) return false;
    const p = g.player;
    const Mat = Elona.Material;
    if ((p.skill(r.skill) | 0) < (r.req | 0)) return false;
    for (const pair of (r.mats || [])) {
      if ((Mat.get(g, pair[0]) | 0) < (pair[1] | 0)) return false;
    }
    return true;
  }

  /** 缺哪些材料（给界面用） */
  function missingMats(g, r) {
    const Mat = Elona.Material;
    const out = [];
    for (const pair of (r.mats || [])) {
      const have = Mat.get(g, pair[0]) | 0;
      if (have < (pair[1] | 0)) out.push({ id: pair[0], need: pair[1], have });
    }
    return out;
  }

  /**
   * 该工具能做的配方列表 —— 270394-270439。
   *
   * 过滤条件（270401-270424）：
   *   1. 配方技能必须等于工具对应技能
   *   2. `技能等级 + 3 < 需求等级` 的**不显示**（270422：var_82(skill,0) + 3 < var_998(1) → continue）
   * @returns {Array<{id, skill, req, mats, ok, missing, name}>}
   */
  function list(g, kitType) {
    const skill = KIT_SKILL[kitType] | 0;
    const lv = g.player.skill(skill) | 0;
    const out = [];
    for (const key of Object.keys(DATA || {})) {
      const r = DATA[key];
      if ((r.skill | 0) !== skill) continue;
      if (lv + 3 < (r.req | 0)) continue;                 // 270422
      out.push({
        id: r.id, skill: r.skill, req: r.req, mats: r.mats,
        name: Elona.ItemDB.name(r.id, 'en'),
        ok: canProduce(g, r),
        missing: missingMats(g, r),
      });
    }
    out.sort((a, b) => (a.req - b.req) || (a.id - b.id));
    return out;
  }

  /**
   * 执行生产 —— 270636-270682。
   *
   * 逐行对照：
   *   repeat 6: var_497(mat) -= n; 累计 var_2057（总材料数）
   *   var_641 = 2
   *   if (rnd(100 + req*2) < 技能 + 20) var_641 = 3
   *   if (rnd(200 + req*2) < 技能 + 20) var_641 = 4
   *   flt calcobjlv(技能), calcfixlv(var_641) → itemcreate(产物 id)
   *   var_99(17) = 0（祝福清零）、item_identify 3（完全鉴定）
   *   skillexp(技能, 0, limit(100 + 总材料*30, 100, 1500))
   *   var_65(250+47..50)++ 分别对应技能 178/176/179/177
   *
   * @returns {{ok:boolean, item?:object, id?:number, fix?:number, level?:number,
   *            used?:number, message:string, reason?:string}}
   */
  function produce(g, id) {
    const r = def(id);
    const p = g.player;
    const Mat = Elona.Material;
    if (!r) return { ok: false, reason: 'no-recipe', message: '没有这个配方。' };
    if (!canProduce(g, r)) {
      return { ok: false, reason: 'requirement', message: '生产的条件没有满足。' };
    }

    // 材料消耗（270637-270644）
    let used = 0;
    for (const pair of (r.mats || [])) {
      Mat.remove(g, pair[0], pair[1]);
      used += pair[1] | 0;
    }

    const skillLv = p.skill(r.skill) | 0;
    const req = r.req | 0;
    const R = (n) => g.rng.rnd(Math.max(1, n | 0));

    // 品质判定（270646-270652）
    let fix = 2;
    if (R(100 + req * 2) < skillLv + 20) fix = 3;
    if (R(200 + req * 2) < skillLv + 20) fix = 4;

    // itemcreate：等级取 calcobjlv(技能)，品质取 var_641
    const level = Elona.ItemDB.calcObjLv(skillLv, g);
    let it = null;
    try {
      it = Elona.ItemDB.create(g, { itemId: r.id, level, fix });
    } catch (e) { it = null; }
    if (!it) {
      // 理论上不会发生；材料已经扣掉，如实返回失败
      return { ok: false, reason: 'create-failed', message: '制作失败了。', used };
    }
    it.f[17] = 0;                       // var_99(17) = 0 祝福清零
    it.f[8] = 3;                        // item_identify 579, 3 完全鉴定
    it.f[5] = p.x; it.f[6] = p.y;

    // 放入背包第一个空位（与 pickupAt 一致，满了就追加）
    let slot = -1;
    for (let k = 0; k < p.inv.length; k++) {
      if (!p.inv[k] || (p.inv[k].f[0] | 0) <= 0) { slot = k; break; }
    }
    if (slot >= 0) p.inv[slot] = it; else p.inv.push(it);
    // item_stack 0, var_579, 1：尝试与已有同类合并
    const idx = p.inv.indexOf(it);
    if (idx >= 0 && Elona.ItemDB.stack) Elona.ItemDB.stack(p, idx);

    // 生产计数（270663-270674）
    const cntSlot = { 178: 47, 176: 48, 179: 49, 177: 50 }[r.skill];
    if (cntSlot) g.setV65(250 + cntSlot, (g.getV65(250 + cntSlot) | 0) + 1);

    // 技能经验（label_2169 / 212186-212188）
    const exp = Math.min(1500, Math.max(100, 100 + used * 30));
    if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, r.skill, p, exp, 1, 0, g);

    return {
      ok: true, item: it, id: r.id, fix, level, used,
      message: `制作了 ${Elona.ItemDB.name(r.id, 'en')}。`,
    };
  }

  Elona.Produce = {
    KIT_SKILL, SKILL_NAME,
    load, def, kitTypeOf, kitSkill, kits,
    canProduce, missingMats, list, produce,
  };
})(typeof window !== 'undefined' ? window : globalThis);
