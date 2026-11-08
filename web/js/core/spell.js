'use strict';
/**
 * 法术 / 怪物能力 引擎（第一阶段：强度与消耗计算）
 *
 * 原版把“法术/技能/怪物能力”统一放在 var_83(字段, id) 数据表里（*label_0033/0034，
 * 行 1706-4394），并配套 var_81(名称)/var_84,var_85(说明)。本模块把该数据表加载为
 * Elona.Spell.Actions（数据与逻辑分离，来自 web/data/tables/actions.json），
 * 并移植四个纯计算 defcfunc（行号见下）：
 *
 *   calcspellpower      214809-214824  法术/能力威力 var_578
 *   calcspellfail       214827-214915  施法失败率 var_1430（1..100）
 *   calcspellcostmp     214918-214932  MP 消耗
 *   calcspellcoststock  214935-214944  魔力库存(var_495)消耗
 *
 * var_83 字段语义（依 calcspell* 与 *label_2960 用法）：
 *   f0 = 关联技能 id（skillexp var_83(0,id)）  f1 = 动作类型码（2960 据此分派）
 *   f2 = SP 消耗（dmgsp var_83(2,id)/2+1）      f3 = 射程打包值（\1000 + 1）
 *   f4 = 元素/属性 id（calcspellfail 用到）
 *
 * 不确定项（按项目原则标注，不臆测）：
 *   - var_65(183)：当前坐骑的角色索引（0 = 未骑乘）→ g.getV65(183)。
 *   - calcspellcostmp 末尾原码为 `if ( var_63(3, var_1434) == "wizard" )`，
 *     其中 var_1434 是本函数**未初始化的局部变量**（=0），故等价于“玩家(chara0)职业为 wizard”。
 *     这是原版 bug，本实现忠实复现，并加注释。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));   // HSP 整数除法（向零截断）
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // ---- var_83 动作数据表（web/data/tables/actions.json）----
  let ACTIONS = null;

  async function loadTable() {
    if (ACTIONS) return ACTIONS;
    ACTIONS = await Elona.Data.table('actions');
    return ACTIONS;
  }
  function setTable(t) { ACTIONS = t; }
  /** 读取 var_83(field, id)；对应原版 var_83(field, id) */
  function field(id, idx) {
    const e = ACTIONS && ACTIONS[String(id)];
    return e ? (e.f[idx] || 0) : 0;
  }
  function actionName(id) {
    const e = ACTIONS && ACTIONS[String(id)];
    return e ? e.name : null;
  }

  // ================= calcspellpower（214809-214824）=================
  /**
   * @param {number} id 法术/能力 id（var_396）
   * @param {object} c  施法者（Chara）
   * @returns {number} var_578 威力
   */
  function calcSpellPower(id, c) {
    if (id >= 600) {                       // 怪物能力：直接由 f0 决定
      const f0 = field(id, 0);
      if (f0 !== 0) return f0 * 10 + 50;
      return 100;
    }
    if (c.index === 0) {                   // 玩家：法术技能 ×5 + 咏唱(172) ×5 + 50
      return c.skill(id) * 5 + c.skill(172) * 5 + 50;
    }
    if (c.skill(172) === 0) {              // NPC 无咏唱技能：按等级
      if (c.index >= 16) return limit(c.level, 1, 1000) * 6 + 10;
    }
    return c.skill(172) * 10 + 50;
  }

  // ================= calcspellfail（214827-214915）=================
  /**
   * 施法失败率（越小越易成功；90 表示基础成功 90%）。
   * 返回 1..100。
   */
  function calcSpellFail(id, c, g) {
    if (c.index !== 0) {                   // 214828：NPC 分支（原码 prm_1068 != 0）
      let v = 95;
      if (c.className === 'warmage') v += 5;
      if (Elona.Status && Elona.Status.findbuff(c, 56) !== -1) v -= 3;
      if (Elona.Status && Elona.Status.findbuff(c, 2) !== -1) {
        v -= (c.get(25) > 3) ? 35 : 70;
      }
      return v;
    }
    // 玩家分支（214846-214915）
    let base = 4;
    const arm = Elona.Battle.carmor(c);    // 169 / 170 / 171
    if (arm === 169) base = 17 - idiv(c.skill(169), 5);
    if (arm === 170) base = 12 - idiv(c.skill(170), 5);
    if (base < 4) base = 4;
    // 214857：骑乘中 base += 4（var_65(183) = 当前坐骑的影，0 = 未骑乘）
    //   注：base 越大 → 「装备惩罚」项越大 → 失败率越低（坐骑替你分担了负担）
    const mountIdx = (g && g.getV65) ? (g.getV65(183) | 0) : 0;
    if (mountIdx !== 0) base += 4;
    if (id === 441) base += c.skill(441);
    if (id === 464) base += idiv(c.skill(464), 3);
    if (c.get(428) === 1) base = base * 3;  // var_58(428,0)==1
    let v = 90 + c.skill(id) - idiv(field(id, 4) * base, 5 + c.skill(172) * 4);
    if (arm === 169) { if (v > 80) v = 80; }
    else if (arm === 170) { if (v > 92) v = 92; }
    else { if (v > 100) v = 100; }
    if (c.get(32) & 4) v -= 6;              // 214887 var_58(32) & 4
    if (c.get(32) & 1) {                    // 214890
      if (c.get(96) === 1) v -= 5;
    }
    if (c.className === 'warmage') v += 5;
    if (Elona.Status && Elona.Status.findbuff(c, 56) !== -1) v -= 3;
    if (Elona.Status && Elona.Status.findbuff(c, 2) !== -1) {
      v -= (c.get(25) > 3) ? 35 : 70;
    }
    if (v > 100) v = 100;
    if (v < 1) v = 1;
    return v;
  }

  // ================= calcspellcostmp（214918-214932）=================
  function calcSpellCostMp(id, c, g) {
    const f2 = field(id, 2);
    let cost;
    if (c.index === 0) {
      // 214920：个别法术直接按表值（传送/解咒/生成类）
      if ([413, 461, 457, 438, 409, 408, 410, 466].includes(id)) return f2;
      cost = idiv(f2 * (100 + c.skill(id) * 3), 100) + idiv(c.skill(id), 8);
    } else {
      cost = idiv(f2 * (50 + c.skill(172) * 2), 100);
    }
    // 214929：原码 `var_63(3, var_1434)`，var_1434 为未初始化局部(=0) → 读玩家职业
    const cls = (g && g.charas && g.charas[0]) ? g.charas[0].className : '';
    if (cls === 'wizard') cost = idiv(cost * 90, 100);
    return cost;
  }

  // ================= calcspellcoststock（214935-214944）=================
  /** 消耗 var_495(id-400) 魔力库存（玩家专用，随机项） */
  function calcSpellCostStock(id, c, g) {
    const f2 = field(id, 2);
    let v = idiv(f2 * 200, c.skill(id) * 3 + 100);
    if (v < idiv(f2, 5)) v = idiv(f2, 5);
    const rng = (g && g.rng) ? g.rng : Elona.rng;
    v = rng.rnd(idiv(v, 6) + 1) + idiv(v, 6);
    if (v < 1) v = 1;
    return v;
  }

  // ===================== 视线 / 遮挡（fov_los，36275-36649）=====================
  /**
   * 单格是否遮挡视线（fov_los 的 tile 检查）：
   *   var_593(7, var_704(x,y,0)) & 1  或  var_593(7, var_704(x,y,6)\1000) & 1
   * 即：图块本身、或图块的 feature 图块，其属性位 7 的第 0 位被置位 → 遮挡。
   */
  function losBlockedTile(g, x, y) {
    const cell = g.map.cell(x, y);
    if (!cell) return true;                                    // 越界视为遮挡
    if (g.map.attr(cell[0], 7) & 1) return true;
    if (g.map.attr(idiv(cell[6], 1000), 7) & 1) return true;
    return false;
  }
  /** mef 槽内类型查询（优先 g.mef；兼容旧的 g.mefTypeOf 钩子；都没有则视为无 mef） */
  function mefTypeOf(g, slotIdx) {
    if (g.mef) return g.mef.typeOf(slotIdx);
    if (typeof g.mefTypeOf === 'function') return g.mefTypeOf(slotIdx);
    return 0;
  }
  /**
   * 地面魔法效果（mef）遮挡：var_704(x,y,8)!=0 且 var_490(0,该值-1)==9 且 var_65(250+348)==0。
   * mef 存储见 core/mef.js（var_490 等价物）。
   */
  function losBlockedMef(g, x, y) {
    const cell = g.map.cell(x, y);
    if (!cell || cell[8] === 0) return false;
    return mefTypeOf(g, cell[8] - 1) === 9 && (g.var65_250_348 || 0) === 0;
  }

  /**
   * fov_los(x1,y1,x2,y2) —— 视线判定（36275-36649，Bresenham）。
   * 返回 1=通畅、0=被遮挡。端点自身不检查；沿途每格检查 tile 与 mef 遮挡。
   * 守卫：var_65(173)==10 时关闭全部遮挡判定（原版每处检查均带此守卫）。
   * 【简化标注】原版对「纯轴 / 单斜角(1×2,2×1)」设有专用快速路径，并有「先整条 mef 扫描、
   *   再整条 tile 扫描」的两段式；本实现统一用一次 Bresenham 逐格检查，格子序列与返回 0
   *   的时机等价，略去专用路径的性能优化与个别提前 return 1 的捷径。
   */
  function fovLos(g, x1, y1, x2, y2) {
    if (g.var65_173 === 10) return 1;
    const blocked = (x, y) => losBlockedTile(g, x, y) || losBlockedMef(g, x, y);
    const dx = x2 - x1, dy = y2 - y1;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 2 && ady < 2) return 1;                          // 相邻格恒可见
    if (adx === 0) {                                           // 纯垂直
      const step = dy > 0 ? 1 : -1;
      for (let y = y1 + step; y !== y2; y += step) if (blocked(x1, y)) return 0;
      return 1;
    }
    if (ady === 0) {                                           // 纯水平
      const step = dx > 0 ? 1 : -1;
      for (let x = x1 + step; x !== x2; x += step) if (blocked(x, y1)) return 0;
      return 1;
    }
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    let err = adx - ady, x = x1, y = y1;
    while (x !== x2 || y !== y2) {
      const e2 = err << 1;
      if (e2 > -ady) { err -= ady; x += sx; }
      if (e2 < adx) { err += adx; y += sy; }
      if (x === x2 && y === y2) break;
      if (blocked(x, y)) return 0;
    }
    return 1;
  }

  // ===================== calcskill（4396+）：法术伤害骰与元素 =====================
  /**
   * 单个法术的伤害骰表。原版 calcskill 是一个按法术 id 分支的大 switch（4396 起）。
   * 已移植：**type 2 单体魔法 12 个 id**（414-418 / 485-491）+ **type 4 治疗系**
   *  （400/401/402/403/405/406/407/623/624）。
   * 其余 id 返回 null → 由调用方标记「未实现」（不臆造公式）。
   *
   * 原版形参：calcskill(var_396=id, var_243=施法者, var_578=威力, var_2422)
   *   var_86 = var_82(var_83(0,id), 施法者)     —— 关联技能等级
   *   prm_279 = var_578                          —— 法术威力
   *   prm_280 = var_2422                         —— 语义未确认，本实现缺省 0
   * 结果写入 var_89(骰子数) / var_90(面数) / var_91(加成) / var_87(元素) / var_88(元素参数)。
   * @returns {{dice:number,sides:number,bonus:number,elem:number,elemArg:number}|null}
   */
  function calcSkill(id, caster, power, arg2422) {
    const a = arg2422 || 0;                                    // var_2422（默认 0）
    const sk = caster.skill(field(id, 0));                     // var_86
    const d20 = idiv(power, 20) + 4 + 1;                       // var_90（/20 档）
    const d15 = idiv(power, 15) + 4 + 1;                       // var_90（/15 档）
    const dice = idiv(a, 70) + 1 + idiv(sk, 13);               // var_89
    const arg = 150 + idiv(power, 30);                         // var_88（150 档）
    switch (id) {
      // ---- 治疗系（type 4，calcskill 400/401/402/403/405/406/407）----
      case 400: return { dice: 1 + idiv(sk, 30), sides: idiv(power, 40) + 6, bonus: idiv(power, 30), elem: 0, elemArg: 0 };
      case 401: return { dice: 2 + idiv(sk, 26), sides: idiv(power, 25) + 6, bonus: idiv(power, 15), elem: 0, elemArg: 0 };
      case 405: return { dice: 2 + idiv(sk, 22), sides: idiv(power, 18) + 6, bonus: idiv(power, 10), elem: 0, elemArg: 0 };
      case 402: return { dice: 3 + idiv(sk, 15), sides: idiv(power, 12) + 6, bonus: idiv(power, 6), elem: 0, elemArg: 0 };
      case 403: return { dice: 5 + idiv(sk, 10), sides: idiv(power, 7) + 6, bonus: idiv(power, 2), elem: 0, elemArg: 0 };
      case 406: return { dice: 0, sides: 1, bonus: sk * 5 + power * 2, elem: 0, elemArg: 0 };
      case 407: return { dice: 0, sides: 1, bonus: sk * 5 + idiv(power * 3, 2), elem: 0, elemArg: 0 };
      // 623/624 祈祷：面数用 var_58(62)（【未确认】疑为最大 MP；按原码 var_58(62,施法者) 读取）
      case 623: return { dice: 1 + idiv(sk, 10), sides: idiv(caster.get(62), 70) + 1 + 1, bonus: 0, elem: 0, elemArg: 0 };
      case 624: return { dice: 1 + idiv(sk, 20), sides: idiv(caster.get(62), 140) + 1 + 1, bonus: 0, elem: 0, elemArg: 0 };
      // ---- 吐息系（type 8，calcskill 602-609）：var_86=skill(11) ----
      case 602: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(50) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 50, elemArg: 150 + sk * 21 };
      case 603: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(51) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 51, elemArg: 150 + sk * 21 };
      case 604: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(52) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 52, elemArg: 150 + sk * 21 };
      case 605: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(53) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 53, elemArg: 150 + sk * 21 };
      case 606: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(59) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 59, elemArg: 150 + sk * 21 };
      case 607: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(57) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 57, elemArg: 15 + sk * 2 };
      case 608: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(56) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 56, elemArg: 150 + sk * 21 };
      case 609: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(58) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 58, elemArg: 150 + sk * 21 };
      // 0-EL：610/611/612（猛毒/幻影/能量吐息）原先缺 calcskill 分支，与 602-609 同构
      case 610: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(55) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 55, elemArg: 150 + sk * 21 };
      case 611: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(54) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 54, elemArg: 150 + sk * 21 };
      case 612: return { dice: 1 + idiv(sk, 10), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(60) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20), elem: 60, elemArg: 200 };
      // 763 破坏奔流：bonus 还加 MP 上限/4（4835-4839 的 var_91）
      case 763: return { dice: 1 + idiv(sk, 12), sides: 2 + idiv(sk, 10) + idiv(limit(caster.skill(60) - 400, 1, sk * 2), 20) + 1, bonus: idiv(sk, 20) + idiv(caster.get(56) | 0, 4), elem: 60, elemArg: 200 };
      // 837 沙尘炮
      case 837: return { dice: 1 + idiv(sk, 12), sides: 2 + idiv(sk, 10) + 1, bonus: idiv(sk, 20), elem: 64, elemArg: 200 };
      case 414: return { dice, sides: d20, bonus: 0, elem: 60, elemArg: 100 };
      case 491: return { dice, sides: d20, bonus: 0, elem: 64, elemArg: arg };
      case 415: return { dice, sides: d15, bonus: 0, elem: 56, elemArg: arg };
      case 416: return { dice, sides: d15, bonus: 0, elem: 58, elemArg: arg };
      case 417: return { dice, sides: d15, bonus: 0, elem: 59, elemArg: arg };
      case 418: return { dice, sides: d15, bonus: 0, elem: 53, elemArg: arg };
      case 485: return { dice, sides: d15, bonus: 0, elem: 50, elemArg: arg };
      case 486: return { dice, sides: d15, bonus: 0, elem: 51, elemArg: arg };
      case 487: return { dice, sides: d15, bonus: 0, elem: 52, elemArg: arg };
      case 488: return { dice, sides: d15, bonus: 0, elem: 54, elemArg: arg };
      case 489: return { dice, sides: d15, bonus: 0, elem: 55, elemArg: arg };
      case 490: return { dice, sides: d15, bonus: 0, elem: 57, elemArg: arg };
      // ---- type 1 弹道系（calcskill 419-423/459/475/480-484）：var_86=skill(16) ----
      case 419: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 51, elemArg: 150 + idiv(power, 40) };
      case 420: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 50, elemArg: 150 + idiv(power, 40) };
      case 421: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 52, elemArg: 150 + idiv(power, 40) };
      case 422: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 53, elemArg: 150 + idiv(power, 40) };
      case 423: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 54, elemArg: 150 + idiv(power, 40) };
      case 459: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 20) + 4 + 1, bonus: 0, elem: 60, elemArg: 100 };
      case 475: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 20) + 4 + 1, bonus: 0, elem: 64, elemArg: 100 };
      case 480: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 56, elemArg: 150 + idiv(power, 40) };
      case 481: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 55, elemArg: 150 + idiv(power, 40) };
      case 482: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 57, elemArg: 150 + idiv(power, 40) };
      case 483: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 59, elemArg: 150 + idiv(power, 40) };
      case 484: return { dice: idiv(a, 65) + 1 + idiv(sk, 14), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 58, elemArg: 150 + idiv(power, 40) };
      // ---- type 3 球/范围系（calcskill 404/431-434/460/469-473/476/478/479/644/655）----
      case 404: return { dice: idiv(sk, 20) + 3, sides: idiv(power, 15) + 5 + 1, bonus: idiv(power, 10), elem: 0, elemArg: 0 };
      case 431: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 51, elemArg: 150 + idiv(power, 50) };
      case 432: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 50, elemArg: 150 + idiv(power, 50) };
      case 433: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 59, elemArg: 150 + idiv(power, 50) };
      case 434: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 57, elemArg: 150 + idiv(power, 50) };
      case 460: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 20) + 4 + 1, bonus: 0, elem: 60, elemArg: 100 };
      case 469: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 53, elemArg: 150 + idiv(power, 50) };
      case 470: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 52, elemArg: 150 + idiv(power, 50) };
      case 471: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 56, elemArg: 150 + idiv(power, 50) };
      case 473: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 55, elemArg: 150 + idiv(power, 50) };
      case 478: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 54, elemArg: 150 + idiv(power, 50) };
      case 479: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 15) + 4 + 1, bonus: 0, elem: 58, elemArg: 150 + idiv(power, 50) };
      case 476: return { dice: idiv(a, 60) + 1 + idiv(sk, 15), sides: idiv(power, 20) + 4 + 1, bonus: 0, elem: 64, elemArg: 100 };
      case 644: return { dice: 1 + idiv(sk, 15), sides: 15 + idiv(sk, 5) + 1, bonus: 0, elem: 64, elemArg: 100 };
      case 655: return { dice: idiv(power, 110) + 1, sides: idiv(power, 10) + 2 + 1, bonus: 0, elem: 57, elemArg: 150 + idiv(power, 40) };
      // ---- type 6 吸血/接触系（calcskill 601/613-618/748/758）----
      case 601: return { dice: 1 + idiv(sk, 15), sides: 3 + idiv(sk, 20) + 1, bonus: idiv(sk, 4), elem: 56, elemArg: 200 };
      case 748: return { dice: 1 + idiv(sk, 9), sides: 7 + idiv(sk, 10) + 1, bonus: idiv(sk, 2), elem: 68, elemArg: 200 };
      case 613: case 614: return { dice: 1 + idiv(sk, 10), sides: 3 + 1, bonus: 0, elem: 68, elemArg: 100 };
      case 615: case 616: case 617: case 618: return { dice: 1 + idiv(sk, 10), sides: 3 + 1, bonus: 0, elem: 68, elemArg: 150 + sk * 24 };
      case 758: return { dice: 1 + idiv(sk, 5), sides: 2 + idiv(sk, 10) + 1, bonus: idiv(sk, 5), elem: 55, elemArg: 100 };
      default: return null;
    }
  }

  /**
   * calcskill + 315956-315961 的天赋加成：
   *   施法者是玩家、持 var_97(165) 天赋、属性是 50(火)/51(冰)/52(雷) 时，
   *   骰「面数」×125%（var_90 = var_90 * 125 / 100）。
   * 骰「个数」用 var_2422（原始强度），不受这个加成影响。
   */
  function diceOf(g, caster, id, power) {
    const d = calcSkill(id, caster, power, (g && g.var2422) || 0);
    if (!d) return d;
    if (caster && (caster.index | 0) === 0 && Elona.Feat && Elona.Feat.get
      && Elona.Feat.get(caster, 165)) {
      if (d.elem === 50 || d.elem === 51 || d.elem === 52) d.sides = idiv(d.sides * 125, 100);
    }
    return d;
  }

  // ===================== 前置检查（*label_2959，315574-315839）=====================
  /**
   * 目标合法性检查。移植 AI 会走到的 **NPC 路径**（var_243!=0 / var_2367==0）。
   * 返回 { ok, target, nothing?, reason? }：
   *   ok=false → 中止（对应 return 0）；nothing=true → 通过但无事发生（var_2421=1）。
   * 【未移植】var_2367（道具/法杖施放）改判分支（315581-315611）、f1==6 且 cbit(1017) 的
   *   var_2435（超额射程豁免）、玩家侧的方向/目标选择 UI（label_2104/2836/2838/2670/2893）。
   */
  function precheck(g, caster, id, target, tile) {
    if (id > 879) return { ok: true, target: caster };          // 315576：超范围动作 → 自身
    const f3 = field(id, 3);
    const cls = idiv(f3, 1000) * 1000;                         // var_938 目标选择类别
    // 315701 / 315758 / 315787 / 316029：射程 = `var_83(3,id) \ 1000 + 1`
    //   （HSP 的 `\` 是整数除）。原先写成 `% 1000 + 1` 是错的：
    //   656 = 3000+6 → 4 格（aim.js 的准星射程也是这么算的），414 = 2000+6 → 3 格。
    const range = idiv(f3, 1000) + 1;
    const tg = target;
    const isNpc = caster.index !== 0;
    const dist2 = (a, b) => Elona.Battle.dist(a.x, a.y, b.x, b.y);

    if (cls === 8000) {                                        // 方向系
      // 玩家：315670「どの方向？」→ 方向键选邻格（core/dirsel.js）。
      //   有角色 → 对它发动；空格子 → var_2421 = 1（对地面发动），315679。
      if (!isNpc) {
        if (!tg) {
          if (!tile) return { ok: false, reason: 'need-direction' };
          const cell = (g.map && g.map.cell) ? g.map.cell(tile.x, tile.y) : null;
          if (!cell) return { ok: false, reason: 'no_tile' };
          if (dist2({ x: caster.x, y: caster.y }, { x: tile.x, y: tile.y }) > range) {   // 315703
            return { ok: false, reason: 'out_of_range' };
          }
          if ((cell[1] | 0) === 0) return { ok: true, target: null, tile, ground: true }; // 315679-315682
          const at = g.charas[(cell[1] | 0) - 1];
          if (!at || (at.get(0) | 0) !== 1) return { ok: true, target: null, tile, ground: true };
          return { ok: true, target: at };
        }
        if (dist2(tg, caster) > range) return { ok: false, reason: 'out_of_range' };   // 315701
        const v140 = tg.get(140);
        if (v140 === 30 || v140 === 31) return { ok: false, reason: 'wall' };          // 315707
        return { ok: true, target: tg };
      }
      if (dist2(tg, caster) > range) return { ok: false, reason: 'out_of_range' };   // 315701
      const v140 = tg.get(140);
      if (v140 === 30 || v140 === 31) return { ok: false, reason: 'wall' };          // 315707
      return { ok: true, target: tg };
    }
    if (cls === 7000 || (cls === 9000 && g.var2189 === 1 && !isNpc)) {               // 地面指定 / 视线系
      // 7000 是「点一个格子」（造墙/造门/酸/火墙 等）：玩家侧由方向选择给出 tile
      if (cls === 7000 && tile) {
        if (dist2({ x: caster.x, y: caster.y }, { x: tile.x, y: tile.y }) > range) {
          return { ok: false, reason: 'out_of_range' };
        }
        if (!fovLos(g, caster.x, caster.y, tile.x, tile.y)) return { ok: false, reason: 'no_los' };
        return { ok: true, target: null, tile };
      }
      if (cls === 7000 && !isNpc) return { ok: false, reason: 'need-tile' };
      if (!fovLos(g, caster.x, caster.y, tg.x, tg.y)) return { ok: false, reason: 'no_los' };
      return { ok: true, target: tg };
    }
    if (cls === 3000 || cls === 10000) {                       // 自身/单体系
      if (isNpc && field(id, 1) === 3) {                       // 315757：NPC 的范围魔法需校验
        if (dist2(tg, caster) > range) return { ok: false, reason: 'out_of_range' };
        if (!fovLos(g, caster.x, caster.y, tg.x, tg.y)) return { ok: false, reason: 'no_los' };
      }
      return { ok: true, target: caster };                     // 315766：var_244 = var_243（自身）
    }
    if (cls === 2000 || cls === 6000 || cls === 9000) {        // 单体目标系
      if (dist2(tg, caster) > range) return { ok: false, reason: 'out_of_range' };   // 315787
      if (!fovLos(g, caster.x, caster.y, tg.x, tg.y)) return { ok: false, reason: 'no_los' };  // 315802
      return { ok: true, target: tg };
    }
    if (cls === 5000) return { ok: true, target: tg };         // 方向系（NPC 无需选择）
    return { ok: true, target: tg };                           // 315839 末尾
  }

  // ===================== 复合咏唱 + 统一魔法伤害结算 =====================
  /**
   * 复合咏唱（314796-314811）：施法开始时按法术 id 归组，用 `encfindpower` 取装备上
   * 对应附魔强度的**总和**，换算成 0..5 的加成系数。
   *   73 组：485/486/420/419/432/431（火炎⇄冷気）
   *   74 组：488/490/423/482/478/434（幻惑⇄音）
   *   75 组：416/489/484/481/479/473（毒⇄神経）
   *   85 组：418/415/422/480/469/471（暗黒⇄地獄）
   */
  const CHORUS_GROUPS = {
    73: [485, 486, 420, 419, 432, 431],
    74: [488, 490, 423, 482, 478, 434],
    75: [416, 489, 484, 481, 479, 473],
    85: [418, 415, 422, 480, 469, 471],
  };
  /** 316180-316219：主伤害属性 → 追加伤害属性（成对互换） */
  const CHORUS_ADD = {
    50: 51, 51: 50,     // 火炎 ⇄ 冷気
    54: 57, 57: 54,     // 幻惑 ⇄ 音
    55: 58, 58: 55,     // 毒   ⇄ 神経
    53: 56, 56: 53,     // 暗黒 ⇄ 地獄
  };

  /** 返回 { key, k } —— k 为 0 表示该组无效（未持附魔） */
  function chorusCoef(caster, id) {
    for (const key of Object.keys(CHORUS_GROUPS)) {
      if (CHORUS_GROUPS[key].indexOf(id | 0) < 0) continue;
      const pw = (Elona.ItemDB && Elona.ItemDB.encfindpower)
        ? (Elona.ItemDB.encfindpower(caster, parseInt(key, 10)) | 0) : -1;
      return { key: parseInt(key, 10), k: limit(idiv(pw + 1, 50), 0, 5) };
    }
    return null;
  }

  /**
   * 统一的魔法伤害结算：dmghp（带属性 id）+ 复合咏唱追加伤害。
   * @param {object} g
   * @param {object} caster 施法者（复合咏唱的装备来源）
   * @param {object} tg     目标
   * @param {number} dmg    主伤害（var_1588）
   * @param {number} elem   属性 id（var_87）
   * @param {number} id     法术 id（var_396）
   * @returns {number} 主伤害实际扣除量
   */
  function applyMagicDamage(g, caster, tg, dmg, elem, id) {
    const E = (elem === undefined || elem === null) ? 0 : (elem | 0);
    const applied = Elona.Battle.applyDamage(tg, dmg, g, caster, E, 0);
    // 316178-316221：目标存活且主伤害 >= 5 → 复合咏唱追加对应属性伤害
    if (applied > 0 && dmg >= 5 && tg && tg.get(0) === 1) {
      const co = chorusCoef(caster, id);
      if (co && co.k > 0) {
        const add = CHORUS_ADD[E];
        if (add !== undefined) {
          Elona.Battle.applyDamage(tg, idiv(dmg, 5) * co.k + 1, g, caster, add, 0);
        }
      }
    }
    return applied;
  }

  // ===================== 效果分派（*label_2960，315840+）=====================
  /**
   * type 2：单体目标魔法（316763-316906）——逐字移植。
   * 依据 spec §7.1：role 掷伤害 → 会心 → 完全詠唱(buff32) ×11 → dmghp → 湿/元素附加/魔法反射。
   */
  function effectType2(g, caster, id, tg, power) {
    const dice = diceOf(g, caster, id, power);
    if (!dice) return { ok: true, type: 2, implemented: false, reason: 'calcskill 未移植该 id' };
    if (!tg || tg.get(0) !== 1) return { ok: true, type: 2, implemented: true, noTarget: true };

    let dmg = Elona.Battle.role(g.rng, dice.dice, dice.sides, dice.bonus);   // 316767
    // 【未移植】calcmagicrit（212189）会心判定 → 此处恒无会心（var_1139=0）
    if (Elona.Status && Elona.Status.findbuff(caster, 32) !== -1) {         // 316792 完全詠唱
      if (caster.index !== 0 || tg.get(9) === -3) dmg = dmg * 11;           // 316794 ×11
    }
    // 316841：dmghp 带属性 id（dice.elem）+ 复合咏唱追加伤害
    const applied = applyMagicDamage(g, caster, tg, dmg, dice.elem, id);
    const nm = actionName(id);
    if (g.log) {
      g.log(`${caster.name} 施放「${nm ? (nm.ch || nm.jp) : id}」命中${tg.index === 0 ? '你' : tg.name} —— `
        + `${applied} 点伤害（剩余 HP ${tg.hp}）。`);
    }
    return { ok: true, type: 2, implemented: true, dmg: applied, elem: dice.elem, target: tg, destroyed: tg.hp <= 0 };
  }

  /**
   * 治疗例程 —— `*label_2971`（340436-340469）逐字移植。
   * 计算回血量后，对目标（骑乘时额外含坐骑/玩家，见 var_65(183) 分支）执行
   * healhp + 若干 healcon（清除恐怖/毒/混乱/朦朧/出血）+ healsan。
   * 340438-340448：骑乘中若目标是「坐骑」或「玩家」，则同时治疗两者
   *   （var_65(183) = 当前坐骑的角色索引，0 = 未骑乘）。
   */
  function healRoutine(g, caster, tg, dice) {
    const targets = [tg];
    const v183 = (g && g.getV65) ? (g.getV65(183) | 0) : 0;
    if (v183 !== 0 && (tg.index === v183 || tg.index === 0)) {          // 340438-340447
      targets[1] = (tg.index === v183) ? g.charas[0] : g.charas[v183];
    }
    let bonusPct = (caster.className === 'priest') ? 25 : 1;            // 340449-340453
    if (caster.get(409) === 4) bonusPct += 25;                          // 340455-340456
    const base = Elona.Battle.role(g.rng, dice.dice, dice.sides, dice.bonus);
    const heal = idiv(base * (100 + bonusPct), 100) + idiv(tg.hpMax, 50);   // 340458
    let total = 0;
    for (const t of targets) {                                          // 340460 repeat var_2511
      if (!t || t.get(0) !== 1) continue;
      const before = t.hp;
      Elona.Status.healhp(t, heal);                                     // 340461
      Elona.Status.healcon(t, 6, 0);                                    // 340462 恐怖（省略 amount → 清除）
      Elona.Status.healcon(t, 1, 50);                                   // 340463 毒
      Elona.Status.healcon(t, 5, 50);                                   // 340464 混乱
      Elona.Status.healcon(t, 7, 30);                                   // 340465 朦朧
      Elona.Status.healcon(t, 9, 20);                                   // 340466 出血
      Elona.Status.healsan(t, 1);                                       // 340467
      total += t.hp - before;
    }
    return { heal, total };
  }

  /**
   * type 4：治疗（316907-316977）——逐字移植。
   * 主体为 `gosub *label_2971`；id==623（Prayer of Jure）追加自愈与 buff。
   * 【未移植】316909-316944 的纯提示文本（txt_select）；316952-316967 的 buff 释放循环
   *   （依赖 var_75(0,id) 增益类型表，未提取）；316969-316971 的 var_2362>=1 分支
   *   （var_2362 缺省 0 → 不触发）；316972 sickifcursed；var_1117/label_2111 动画。
   */
  function effectType4(g, caster, id, tg, power) {
    const dice = diceOf(g, caster, id, power);
    if (!dice) return { ok: true, type: 4, implemented: false, reason: 'calcskill 未移植该 id' };
    if (!tg || tg.get(0) !== 1) return { ok: true, type: 4, implemented: true, noTarget: true };

    const r = healRoutine(g, caster, tg, dice);                        // 316945
    if (id === 623) {                                                  // 316946-316951
      if (tg.index === 0) Elona.Status.healhp(tg, idiv(tg.hpMax, 5));  // 316948
      Elona.Status.addbuff(g, tg, 10, idiv(tg.get(62), 2), 50);        // 316950
      Elona.Status.addbuff(g, tg, 3, 30, 50);                          // 316951
    }
    const nm = actionName(id);
    if (g.log) {
      g.log(`${caster.name} 施放「${nm ? (nm.ch || nm.jp) : id}」，回复${tg.index === 0 ? '你' : tg.name} `
        + `${r.total} 点 HP（剩余 HP ${tg.hp}）。`);
    }
    return { ok: true, type: 4, implemented: true, healed: r.total, target: tg };
  }

  // ===================== get_route（36650-36922）=====================
  /**
   * 生成从 (x1,y1) 到 (x2,y2) 的逐格通路 —— 供 breathList 沿路铺开放射。
   * 返回 { ok, route:[{axis,step}], len }：axis 1=x 轴、2=y 轴；step=±1（0=原地）。
   * 对应原版 var_794(0/1,i)（轴/步长）、var_795（长度）；遇阻挡 return 0（stat==0）。
   * 结构：Bresenham 变体；垂直/水平与 1×2、2×1 斜角有专用路径。
   */
  function getRoute(g, x1, y1, x2, y2) {
    const route = [];
    const push = (axis, step) => { route.push({ axis, step }); };
    const blocked = (x, y) => {
      const cell = g.map.cell(x, y);
      if (!cell) return true;
      if (g.map.attr(cell[0], 7) & 1) return true;
      if (g.map.attr(idiv(cell[6], 1000), 7) & 1) return true;
      return false;
    };
    const dy = y2 - y1, dx = x2 - x1;
    if (dy === 0 && dx === 0) { push(2, 0); return { ok: true, route, len: 1 }; }    // 36656
    const ady = Math.abs(dy), adx = Math.abs(dx);
    if (dx === 0) {                                                  // 36664 垂直
      if (dy > 0) {
        let y = y1 + 1; push(2, 1);
        while (y < y2) { if (blocked(x1, y)) return { ok: false, route, len: 0 }; y++; push(2, 1); }
      } else {
        let y = y1 - 1; push(2, -1);
        while (y > y2) { if (blocked(x1, y)) return { ok: false, route, len: 0 }; y--; push(2, -1); }
      }
      return { ok: true, route, len: route.length };
    }
    if (dy === 0) {                                                  // 36708 水平
      if (dx > 0) {
        let x = x1 + 1; push(1, 1);
        while (x < x2) { if (blocked(x, y1)) return { ok: false, route, len: 0 }; x++; push(1, 1); }
      } else {
        let x = x1 - 1; push(1, -1);
        while (x > x2) { if (blocked(x, y1)) return { ok: false, route, len: 0 }; x--; push(1, -1); }
      }
      return { ok: true, route, len: route.length };
    }
    const sx = dx < 0 ? -1 : 1;                                      // var_876
    const sy = dy < 0 ? -1 : 1;                                      // var_877
    if (adx === 1 && ady === 2) {                                    // 36764
      if (!blocked(x1, y1 + sy)) { push(2, sy); push(2, 0); push(1, sx); return { ok: true, route, len: 3 }; }
    }
    if (ady === 1 && adx === 2) {                                    // 36782
      if (!blocked(x1 + sx, y1)) { push(1, sx); push(1, 0); push(2, sy); return { ok: true, route, len: 3 }; }
    }
    const err0 = adx * ady;                                          // var_878
    const dbl = err0 << 1;                                           // var_879
    if (adx >= ady) {                                                // 36801
      let e = ady * ady;                                             // var_880
      const inc = e << 1;                                            // var_881
      let cx = x1 + sx, cy;                                          // var_875 / var_874
      push(1, sx);
      if (e === err0) { cy = y1 + sy; push(2, sy); e -= dbl; } else { cy = y1; }
      for (;;) {                                                     // label_0511
        if (x2 - cx === 0) break;                                    // label_0512
        if (blocked(cx, cy)) return { ok: false, route, len: 0 };
        e += inc;
        if (e < err0) { cx += sx; push(1, sx); }
        else if (e > err0) {
          cy += sy; push(2, sy);
          if (blocked(cx, cy)) return { ok: false, route, len: 0 };
          e -= dbl; cx += sx; push(1, sx);
        } else { cy += sy; push(2, sy); e -= dbl; cx += sx; push(1, sx); }
      }
      return { ok: true, route, len: route.length };
    }
    let e = adx * adx;                                               // var_882
    const inc = e << 1;                                              // var_881
    let cy = y1 + sy, cx;                                            // var_874 / var_875
    push(2, sy);
    if (e === err0) { cx = x1 + sx; push(1, sx); e -= dbl; } else { cx = x1; }
    for (;;) {                                                       // label_0513
      if (y2 - cy === 0) break;                                      // label_0514
      if (blocked(cx, cy)) return { ok: false, route, len: 0 };
      e += inc;
      if (e < err0) { cy += sy; push(2, sy); }
      else if (e > err0) {
        cx += sx; push(1, sx);
        if (blocked(cx, cy)) return { ok: false, route, len: 0 };
        e -= dbl; cy += sy; push(2, sy);
      } else { cx += sx; push(1, sx); e -= dbl; cy += sy; push(2, sy); }
    }
    return { ok: true, route, len: route.length };
  }

  // ===================== breath_list（32482-32570）=====================
  /**
   * 沿 route 生成吐息覆盖格集合 —— 逐字移植。
   * 每前进一格，以其为中心的 var_800 宽横截面覆盖；var_801==100（全力）时截面更宽。
   * 返回 { cells:[{x,y}], count }（原版写 var_798(x,y,cnt)/var_799）。
   * 【未移植】var_796/var_797（视口原点）的裁剪（32539）；本实现不裁剪以免漏掉视口外的格。
   */
  function breathList(g, caster, id, route) {
    const cells = [];
    let width = 1;                                                   // var_800
    let hx = caster.x, hy = caster.y;                                // var_220 / var_222
    const range = (field(id, 3) % 1000) + 1;                         // 32488 var_83(3,id)\1000+1（取模）
    const var801 = g.var801 || 0;
    const W = g.map.width, H = g.map.height;                         // var_126(0/1)
    const len = route.length || 1;
    for (let i = 0; i < range; i++) {
      const r = route[i % len];
      if (r.axis === 1) hx += r.step; else hy += r.step;
      if (var801 === 100) {                                          // 32495-32521
        if (i < 5) { if (i === 1 || i === 2) width = 3; else if (i === 3) width = 5; else if (i === 4) width = 7; }
        else { if (i === 5) width = 7; else if (i === 6) width = 9; else if (i >= 7) width = 13; }
      } else {                                                       // 32522-32534
        if (i < 6) { if (idiv(i, 3) === 1) width += 2; }
        else { width -= 2; if (width < 3) width = 3; }
      }
      for (let dy = 0; dy < width; dy++) {                           // 32535
        const cy = hy + dy - idiv(width, 2);                         // var_802
        for (let dx = 0; dx < width; dx++) {                         // 32537
          const cx = hx + dx - idiv(width, 2);                       // var_803
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;       // 32542
          if (id !== 763 && id !== 730) {                             // 32545
            const cell = g.map.cell(cx, cy);
            if (cell && (g.map.attr(cell[0], 7) & 1)) continue;       // 32546
          }
          if (cells.length >= 100) break;                             // 32550
          if (cells.some((c) => c.x === cx && c.y === cy)) continue;  // 32553-32564 去重
          cells.push({ x: cx, y: cy });                               // 32565
        }
      }
    }
    return { cells, count: cells.length };
  }

  // ===================== calcmagiccontrol（314488-314526）=====================
  /**
   * 魔法控制/抵抗判定 —— 逐字移植（返回 avoided=1 表示被回避，var_1588 归零）。
   * 仅当施受双方 skill(188) 非 0 且同阵营时生效，按 skill 差随机削减伤害。
   * @returns {{avoided:boolean, dmg:number}}
   */
  /** skillexp 188（314514/314520）：免伤时 8/4，减伤后 30/2；卷入者只有自己会魔力控制才拿经验 */
  function magicControlExp(g, c, exp, div) {
    if (!c || !Elona.Stats || !Elona.Stats.skillExp) return;
    Elona.Stats.skillExp(c, 188, c, exp, div, 0, g);
  }
  /**
   * calcmagiccontrol（314488-314522）—— 魔力控制（技能 188）。
   *   双方同阵营（var_58(9) 同号档）且任一方会魔力控制时：
   *     施法者*5 + 卷入者 > rnd(伤害+1) → 完全免伤；
   *     否则伤害 = rnd(伤害*100/(100 + 施法者*10 + 卷入者*2) + 1)。
   *   免伤时返回 avoided=true（调用方跳过本次结算，stat==1），并给双方技能经验。
   *   【0-EX】补上原版同段里的「は巻き込みを免れた。」文案与 skillexp。
   */
  function calcMagicControl(g, caster, target, dmg) {
    const s1 = caster.skill(188) | 0, s2 = target.skill(188) | 0;
    if (s1 === 0 && s2 === 0) return { avoided: false, dmg };          // 314489
    const r1 = caster.get(9), r2 = target.get(9);
    const sameGroup = (r1 >= 0 && r2 >= 0) || (r1 === -1 && r2 === -1) || (r1 < -1 && r2 < -1);
    if (!sameGroup) return { avoided: false, dmg };                    // 314490
    let d = dmg;
    if (s1 * 5 + s2 > g.rng.rnd(dmg + 1)) d = 0;                       // 314491
    else d = g.rng.rnd(idiv(dmg * 100, 100 + s1 * 10 + s2 * 2) + 1);   // 314495
    if (d > 0 && caster.get(27) === 1130 && caster.get(58) === 0
      && g.rng.rnd(100) < caster.get(214) * 5) d = 0;                  // 314498-314505
    if (d < 1) {                                                       // 314506-314516
      if (g && g.log && (target.index | 0) < 16) g.log(`${target.name}躲过了波及。`);
      if (s2 !== 0) magicControlExp(g, target, 8, 4);
      magicControlExp(g, caster, 8, 4);
      return { avoided: true, dmg: 0 };
    }
    if (s2 !== 0) magicControlExp(g, target, 30, 2);                    // 314517-314518
    magicControlExp(g, caster, 30, 2);                                  // 314520
    return { avoided: false, dmg: d };
  }

  /**
   * type 8：吐息/放射（318129-318362）——逐字移植。
   * var_2378 判定 →（气力满则转 715，未实现）→ get_route → breath_list → 逐格 fov_los 过滤 →
   * 命中角色求伤害（role + 全力加成 + 30）→ calcmagiccontrol → 完全詠唱×11 → dmghp。
   * 【未移植】地面元素效果 addmef/delmef/mapitem_fire/mapitem_cold（mef 子系统未纳入）；
   *   var_2378==100 且气力≥100 时的 715(Converge Breath，type 0) 转换；提示文本与图块动画。
   * 【近似】dmghp(197974) 的完整抗性/属性链未移植 → 用 Battle.applyDamage 扣血。
   */
  function effectType8(g, caster, id, tg, power) {
    const dice = diceOf(g, caster, id, power);
    if (!dice) return { ok: true, type: 8, implemented: false, reason: 'calcskill 未移植该 id' };
    const lv = caster.level;

    // var_2378：是否“全力吐息”（318131-318163）；var_65(250+2)/(250+23)/172、var_1636 语义未确认 → 缺省 0
    let r2378 = 0;
    const mtype = g.var65_250_2 || 0;
    if (mtype < 350) { if (lv >= 130) r2378 = 100; }
    if (mtype >= 350) { if (lv >= 50) r2378 = 100; }
    if (caster.index < 16 || caster.get(58) === 100 || caster.index === 0) r2378 = 100;
    if ((g.var65_250_23 || 0) === 1) r2378 = 100;
    if (caster.index >= 16 && caster.get(25) > 3 && caster.hp > idiv(caster.hpMax, 2) && caster.get(182) < 200) {
      if ((g.var1636 || 0) !== 100) r2378 = 0;
    }
    if (caster.get(266) === -1 && caster.get(185) !== 0) r2378 = 0;
    if (caster.get(266) === 1 || caster.get(266) === 2) r2378 = 0;
    if ((g.var65_172 || 0) === 100) r2378 = 0;

    if (r2378 === 100 && caster.get(182) >= 100) {                    // 318164-318174
      return { ok: true, type: 8, implemented: false, convertedTo715: true,
        reason: 'var_2378=100 且气力≥100 → 转 715(Converge Breath, type 0 未实现)' };
    }

    if (!tg || tg.get(0) !== 1) return { ok: true, type: 8, implemented: true, noTarget: true };
    const gr = getRoute(g, caster.x, caster.y, tg.x, tg.y);            // 318177
    if (!gr.ok) return { ok: true, type: 8, implemented: true, noRoute: true };   // 318178-318181

    const v183B = (g && g.getV65) ? (g.getV65(183) | 0) : 0;            // 318223
    const bl = breathList(g, caster, id, gr.route);                    // 318211
    const var801 = g.var801 || 0;
    const results = [];
    for (const cell of bl.cells) {                                     // 318214 repeat var_799
      if (!fovLos(g, caster.x, caster.y, cell.x, cell.y)) continue;     // 318217
      if (cell.x === caster.x && cell.y === caster.y) continue;         // 318220
      // 318223-318228：坐骑放吐息时跳过玩家所在格（避免自伤）
      if (v183B !== 0 && v183B === caster.index && tg.index === 0) continue;
      const c2 = g.map.cell(cell.x, cell.y);
      if (!c2) continue;
      // 318251-318255：清除格上 type9 的 mef
      if (c2[8] !== 0 && mefTypeOf(g, c2[8] - 1) === 9 && g.mef) g.mef.del(g, c2[8] - 1);
      // 318256-318288：按元素在格上铺地面效果（火/冰/雷/…）
      if (g.mef) {
        const MEF_ID = { 50: [13, 1268], 51: [14, 1270], 52: [15, 1272], 53: [16, 1274], 54: [17, 1276],
          55: [18, 1299], 56: [19, 1301], 57: [20, 1303], 58: [21, 1305], 59: [22, 1307], 60: [23, 1309] };
        const mi = MEF_ID[dice.elem];
        if (mi) {
          const pw = caster.skill(11) + idiv((limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000))
            * 4 * Math.sqrt(limit(lv, 1, 2000) * 3) + 30 + 1, 10);
          g.mef.add(g, cell.x, cell.y, mi[0], mi[1], 3 + g.rng.rnd(3), pw, caster.index);
        }
      }
      // 319xxx：地面物品的火/冰破坏（mapitem_fire / mapitem_cold）
      if (Elona.ItemDB && (dice.elem === 50 || dice.elem === 51)) {
        if (dice.elem === 50) Elona.ItemDB.mapitemFire(g, cell.x, cell.y, caster);
        else Elona.ItemDB.mapitemCold(g, cell.x, cell.y);
      }
      if (c2[1] === 0) continue;                                       // 318289
      let tIdx = c2[1] - 1;
      if (tIdx === caster.index) continue;                             // 318291
      let t = g.charas[tIdx];
      if (!t || t.get(0) !== 1) continue;
      if (t.get(140) === 30 || t.get(140) === 31) continue;             // 318292
      if (t.get(168) !== 0 && tIdx !== 0) {                             // 318295-318306 护身
        const gd = g.charas[t.get(167)];
        if (gd && g.rng.rnd(t.hp + 1) < g.rng.rnd(gd.hp + 1)) { tIdx = t.get(167); t = g.charas[tIdx] || t; }
      }
      let dmg = Elona.Battle.role(g.rng, dice.dice, dice.sides, dice.bonus)     // 318307
        + (var801 === 100) * idiv(caster.skill(11), 10) * idiv(caster.skill(188) + 10, 2)
        + (var801 === 100) * (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4 * Math.sqrt(limit(lv, 1, 2000) * 3)
        + 30;
      if (caster.get(418) !== 0) {                                     // 318308-318310
        dmg = idiv(dmg * (100 + idiv(limit(caster.get(418), 0, 2000), 10)), 100);
      }
      const mc = calcMagicControl(g, caster, t, dmg);                   // 318311
      if (mc.avoided) continue;                                         // 318312
      dmg = mc.dmg;
      if (Elona.Status.findbuff(caster, 32) !== -1 && (caster.index !== 0 || t.get(9) === -3)) dmg *= 11;  // 318315-318320
      const applied = applyMagicDamage(g, caster, t, dmg, dice.elem, id);   // 318340 dmghp + 复合咏唱
      // dmghp 内的 199644-199656：火/冰伤害破坏目标道具（施法者持有 941/1172 时免疫）
      if (Elona.ItemDB && (dice.elem === 50 || dice.elem === 51)) {
        const has = (iid) => (caster.inv || []).some((x) => x && x.f[0] > 0 && x.f[3] === iid);
        if (dice.elem === 50 && !has(941) && Elona.ItemDB.itemFire) Elona.ItemDB.itemFire(t, tIdx, -1, g);
        if (dice.elem === 51 && !has(1172) && Elona.ItemDB.itemCold) Elona.ItemDB.itemCold(t, tIdx, -1, g);
      }
      results.push({ index: tIdx, dmg: applied });
    }

    // 收尾：清除 完全詠唱 buff32（318344-318359）
    const b32 = Elona.Status.findbuff(caster, 32);
    if (b32 !== -1 && (caster.index !== 0 || (tg && tg.get(9) === -3))) {
      Elona.Status.delbuff(caster, b32);
    }
    const nm = actionName(id);
    if (g.log && results.length) {
      g.log(`${caster.name} 喷出「${nm ? (nm.ch || nm.jp) : id}」，波及 ${results.length} 个目标。`);
    }
    return { ok: true, type: 8, implemented: true, cells: bl.cells.length, hits: results };
  }

  // ===================== route_info（32441-32481）=====================
  /**
   * 沿 route 前进一格并做通行性校验 —— 逐字移植（原版用 var 形参回写 x/y，返回 stat）。
   * @returns {{x:number,y:number,stat:number}} stat: 1=有效；0=中止（越界/阻挡）；-1=跳过（拐角/零步）
   * 【未移植】var_796/797（视口原点）的裁剪。
   */
  function routeInfo(g, x, y, i, route) {
    const len = route.length || 1;
    const r = route[i % len];
    const nx = r.axis === 1 ? x + r.step : x;
    const ny = r.axis === 2 ? y + r.step : y;
    const nxt = route[(i + 1) % len];
    if (idiv(i, len) % 2 === 0 && nxt && nxt.axis !== r.axis) return { x: nx, y: ny, stat: -1 };   // 32448-32452
    if (i >= len) {                                                   // 32453
      const cell = g.map.cell(nx, ny);
      if (!cell) return { x: nx, y: ny, stat: 0 };
      if (g.map.attr(cell[0], 7) & 1) return { x: nx, y: ny, stat: 0 };
      if (cell[6] !== 0 && (g.map.attr(idiv(cell[6], 1000), 7) & 1)) return { x: nx, y: ny, stat: 0 };
      if (cell[8] !== 0 && mefTypeOf(g, cell[8] - 1) === 9 && (g.var65_250_348 || 0) === 0) {
        return { x: nx, y: ny, stat: 0 };
      }
    }
    if (r.step === 0) return { x: nx, y: ny, stat: -1 };              // 32477
    return { x: nx, y: ny, stat: 1 };
  }

  // ===================== calcmagicrit（212189-212231）=====================
  /**
   * 魔法会心判定 —— 逐字移植。原版设置 var_1139(会心=1)，返回值 var_1364 恒为 0。
   * @returns {number} 1=会心，0=未会心
   */
  function calcMagicCrit(g, caster, target) {
    const rng = g.rng;
    if (Elona.Status.cbit(caster, 1003) && caster.hp >= 0
      && limit(idiv(caster.hpMax, caster.hp + 1), 1, 20) > rng.rnd(20)) return 1;    // 212192-212199
    if (caster.get(256) !== 0 && rng.rnd(8) === 0) return 1;                          // 212200
    if (Elona.Status.findbuff(caster, 32) !== -1 && rng.rnd(2) === 0) return 1;      // 212206
    let crit = 0;
    if (caster.get(67) * 4 + 10 > rng.rnd(400) + target.get(403) * 2) {              // 212212
      crit = 1;
      if (Elona.Status.findbuff(target, 33) !== -1 && target.get(64) < 15000) crit = 0;
    }
    if (rng.rnd(5000) < caster.skill(13) + 50) {                                     // 212218
      crit = 1;
      if (Elona.Status.cbit(target, 1003) && target.hp >= 0
        && limit(idiv(target.hpMax, target.hp + 1), 1, 20) > rng.rnd(5)) crit = 0;
      if (Elona.Status.findbuff(target, 33) !== -1 && target.get(64) < 15000) crit = 0;
    }
    return crit;
  }

  // ===================== 小工具 =====================
  /** 同阵营判定（316403-316417 / 314490） —— 用于治疗雨/魔法控制。 */
  function sameGroup(a, b) {
    const ra = a.get(9), rb = b.get(9);
    if ((a.index === 0 || ra >= 0) && rb >= 0) return true;
    if (ra === -1 && rb === -1) return true;
    if (ra < -1 && rb < -1) return true;
    return false;
  }
  /** 施法者视角下 tIdx 是否为"敌对/值得记录的目标"（316123-316146）。 */
  function isHostile(g, caster, tIdx) {
    const t = g.charas[tIdx];
    if (!t) return false;
    const cr = caster.get(9), tr = t.get(9);
    if (cr !== 10 && tr !== cr && tIdx !== caster.index) return true;
    if (cr === 10 && tr !== 10 && tIdx !== 0) return true;
    if (caster.get(58) === 100 && cr !== 10 && tr === 10) return true;
    if (caster.index === 0 && tr !== 10 && tIdx !== 0) return true;
    return false;
  }
  /** dmgcon 便捷封装（用游戏加载的异常状态条件表）。 */
  function dmgconOf(g, target, condId, power) {
    if (!Elona.Resist || !g.dmgconTable) return 0;
    return Elona.Resist.dmgcon(g, g.dmgconTable, target, condId, power);
  }
  /**
   * 把角色放到目标坐标并同步地图占格 —— `*label_2911` 前段（306052-306075）逐字移植。
   * 【未移植】306076 起的地形/陷阱/门/矿脉处理（依赖 label_2218/2219/2221/2910/3010 与 var_503 feat 表），
   *   故此处只做「清旧格标记 → 写入坐标 → 标记新格 → 骑乘/被载同步」。
   */
  function placeChar(g, c, x, y) {
    if (!g.map.inBounds(x, y)) return false;
    const from = g.map.cell(c.x, c.y);                               // 306058
    if (from && from[1] === c.index + 1) from[1] = 0;
    c.x = x; c.y = y;                                                // 306059-306060
    const to = g.map.cell(x, y);
    if (to) to[1] = c.index + 1;                                     // 306061
    const v183 = (g && g.getV65) ? (g.getV65(183) | 0) : 0;          // 306062-306067：玩家移动带动同乘者
    if (c.index === 0 && v183 !== 0 && g.charas[v183]) {
      g.charas[v183].x = c.x; g.charas[v183].y = c.y;
    }
    if (c.get(168) === -1) {                                         // 306068-306073：被载者跟随
      const rider = g.charas[c.get(167)];
      if (rider) { rider.x = c.x; rider.y = c.y; }
    }
    return true;
  }

  /**
   * type 1：弹道/直线飞行（315991-316269）——逐字移植（沿 route 前进最多 20 格）。
   * 【近似】dmghp 完整抗性链 → Battle.applyDamage；【未移植】mapitem_fire/cold、delmef、mef 铺场、
   *   var_2425-2428（気）追加伤害、label_2174 技能刷新、var_65(175) 守卫。
   */
  function effectType1(g, caster, id, tg, power) {
    const dice = diceOf(g, caster, id, power);
    if (!dice) return { ok: true, type: 1, implemented: false, reason: 'calcskill 未移植该 id' };
    if (!tg || tg.get(0) !== 1) return { ok: true, type: 1, implemented: true, noTarget: true };
    const range = (field(id, 3) % 1000) + 1;                          // var_83(3,id)\1000+1（取模）
    const gr = getRoute(g, caster.x, caster.y, tg.x, tg.y);            // 315993
    if (!gr.ok) return { ok: true, type: 1, implemented: true, noRoute: true };
    const hits = [];
    let realTarget = -1;                                              // var_2438
    let px = caster.x, py = caster.y;                                 // var_220/var_222（逐格累加）
    for (let i = 0; i < 20; i++) {                                    // 316019 repeat 20
      const ri = routeInfo(g, px, py, i, gr.route);                    // 316020（原地推进 var_220/222）
      px = ri.x; py = ri.y;
      if (ri.stat === 0) break;
      if (ri.stat === -1) continue;
      if (Elona.Battle.dist(px, py, caster.x, caster.y) > range) break; // 316029
      if (!fovLos(g, caster.x, caster.y, px, py)) continue;            // 316032
      if (px === caster.x && py === caster.y) continue;                // 316035
      const cell = g.map.cell(px, py);
      if (!cell) continue;
      // 316058-316068：清除格上 mef（475 自身系 / type 9 视线型）
      if (cell[8] !== 0 && g.mef) {
        if (id === 475) g.mef.del(g, cell[8] - 1);
        if (cell[8] !== 0 && mefTypeOf(g, cell[8] - 1) === 9) g.mef.del(g, cell[8] - 1);
      }
      if (cell[1] === 0) continue;                                     // 316069
      let tIdx = cell[1] - 1;
      if (tIdx === caster.index) continue;
      let t = g.charas[tIdx];
      if (!t || t.get(0) !== 1) continue;
      if (((g && g.getV65) ? (g.getV65(183) | 0) : 0) !== 0 && ((g && g.getV65) ? (g.getV65(183) | 0) : 0) === caster.index && tIdx === 0) continue;   // 316072-316078
      if (t.get(140) === 30 || t.get(140) === 31) continue;            // 316079
      let dmg = Elona.Battle.role(g.rng, dice.dice, dice.sides, dice.bonus);     // 316082
      if (calcMagicCrit(g, caster, t)) dmg = Elona.Battle.rolemax(dice.dice, dice.sides, dice.bonus);  // 316084
      const mc1 = calcMagicControl(g, caster, t, dmg);                  // 316107-316109
      if (mc1.avoided) continue;
      dmg = mc1.dmg;                                                    // 0-EX：必须用减伤后的值
      if (t.get(168) !== 0 && tIdx !== 0) {                            // 316111-316122 护身
        const gd = g.charas[t.get(167)];
        if (gd && g.rng.rnd(t.hp + 1) < g.rng.rnd(gd.hp + 1)) { tIdx = t.get(167); t = g.charas[tIdx] || t; }
      }
      if (realTarget === -1 && isHostile(g, caster, tIdx)) realTarget = tIdx;   // 316123-316146
      if (Elona.Status.findbuff(caster, 32) !== -1 && (caster.index !== 0 || t.get(9) === -3)) dmg *= 11;  // 316147-316151
      const applied = applyMagicDamage(g, caster, t, dmg, dice.elem, id);   // 316174 dmghp + 复合咏唱
      if (id === 475) Elona.Status.wet(t, 5);                          // 316175-316177
      if (t.get(94) > 0 && (caster.index >= 16 || tIdx >= 16)) {        // 316222-316225 魔法反射
        const refl = limit(idiv(dmg * t.get(94), 200) + 1, 1, idiv(caster.hpMax, 10));
        applyMagicDamage(g, t, caster, refl, dice.elem, id);   // 316225/316678 魔法反射
      }
      hits.push({ index: tIdx, dmg: applied });
    }
    const b32 = Elona.Status.findbuff(caster, 32);
    if (b32 !== -1 && (caster.index !== 0 || tg.get(9) === -3)) Elona.Status.delbuff(caster, b32);  // 316240-316257
    return { ok: true, type: 1, implemented: true, hits, realTarget };   // 316258-316261 var_244=var_2438
  }

  /**
   * type 3：球/范围（316270-316760 + `*label_2961` 316305-316728）——逐字移植。
   * 半径 = f3\1000+1（644 自爆固定 2）；双层遍历圆域，dist 与 fov_los 过滤。
   * 404=治癒の雨 / 637=狂気治癒の雨（同阵营治疗）；644=自爆（施法者 HP 归零）。
   * 【未移植】mef 铺场/消除、mapitem_fire/cold、var_2425-2428 追加伤害、644 的 2962/2963 连锁（多人自爆）。
   */
  function effectType3(g, caster, id, tg, power) {
    // 637（狂気治癒の雨）无 calcskill 分支，用占位骰（不产生伤害）
    const dice = diceOf(g, caster, id, power)
      || (id === 637 ? { dice: 0, sides: 1, bonus: 0, elem: 0, elemArg: 0 } : null);
    if (!dice) return { ok: true, type: 3, implemented: false, reason: 'calcskill 未移植该 id' };
    // 315679：目标是地面（var_2421 = 1）时，范围以该格为中心（爆裂拳 / 自爆 等）
    if ((!tg || tg.get(0) !== 1) && !(g && g.dirTile)) {
      return { ok: true, type: 3, implemented: true, noTarget: true };
    }
    let radius = (field(id, 3) % 1000) + 1;                           // 316307 var_1899 = f3\1000+1（取模）
    if (id === 644) radius = 2;                                       // 316308-316310
    const vx = (tg && tg.get(0) === 1) ? tg.x : g.dirTile.x;
    const vy = (tg && tg.get(0) === 1) ? tg.y : g.dirTile.y;          // var_1311/1312
    const hits = [];
    let realTarget = -1;
    for (let cy = vy - radius; cy <= vy + radius; cy++) {              // 316331
      if (cy < 0 || cy >= g.map.height) continue;
      for (let cx = vx - radius; cx <= vx + radius; cx++) {            // 316336
        if (cx < 0 || cx >= g.map.width) continue;
        if (Elona.Battle.dist(vx, vy, cx, cy) > radius) continue;      // 316341
        if (!fovLos(g, vx, vy, cx, cy)) continue;                      // 316344
        const cell = g.map.cell(cx, cy);
        if (!cell) continue;
        // 316347-316356：清除格上 mef（476 / type 9）
        if (cell[8] !== 0 && g.mef) {
          if (id === 476) g.mef.del(g, cell[8] - 1);
          if (cell[8] !== 0 && mefTypeOf(g, cell[8] - 1) === 9) g.mef.del(g, cell[8] - 1);
        }
        // 316xxx：地面物品的火/冰破坏
        if (Elona.ItemDB && (dice.elem === 50 || dice.elem === 51)) {
          if (dice.elem === 50) Elona.ItemDB.mapitemFire(g, cx, cy, caster);
          else Elona.ItemDB.mapitemCold(g, cx, cy);
        }
        if (cell[1] === 0) continue;                                   // 316357
        let tIdx = cell[1] - 1;
        let t = g.charas[tIdx];
        if (!t || t.get(0) !== 1) continue;
        if (id === 404 || id === 637) {                                // 316401-316474
          if (sameGroup(caster, t)) {
            if (id === 404) healRoutine(g, caster, t, dice);           // 316424 gosub 2971
            else { Elona.Status.healsan(t, 1); Elona.Status.healcon(t, 5, 50); }   // 316437-316471
          }
          continue;
        }
        if (cx === caster.x && cy === caster.y) continue;              // 316475
        if (((g && g.getV65) ? (g.getV65(183) | 0) : 0) !== 0 && ((g && g.getV65) ? (g.getV65(183) | 0) : 0) === caster.index && tIdx === 0) continue;   // 316478
        if (tIdx === caster.index) continue;                           // 316506
        if (t.get(168) !== 0 && tIdx !== 0) {                          // 316361-316376 护身
          const gd = g.charas[t.get(167)];
          if (gd && g.rng.rnd(t.hp + 1) < g.rng.rnd(gd.hp + 1)) { tIdx = t.get(167); t = g.charas[tIdx] || t; }
        }
        let dmg = Elona.Battle.role(g.rng, dice.dice, dice.sides, dice.bonus);    // 316507
        if (calcMagicCrit(g, caster, t)) dmg = Elona.Battle.rolemax(dice.dice, dice.sides, dice.bonus);   // 316508
        const mc2 = calcMagicControl(g, caster, t, dmg);                // 316534
        if (mc2.avoided) continue;
        dmg = mc2.dmg;                                                  // 0-EX：必须用减伤后的值
        dmg += idiv((limit(caster.level - 50, 1, 2000) + limit(caster.level - 100, 1, 2000))    // 316566
          * 4 * Math.sqrt(limit(caster.level, 1, 2000) * 3) + 30 + 1, 3);
        if (Elona.Status.findbuff(caster, 32) !== -1 && (caster.index !== 0 || t.get(9) === -3)) dmg *= 11;  // 316579-316581
        if (realTarget === -1 && isHostile(g, caster, tIdx)) realTarget = tIdx;   // 316377-316400
        const applied = applyMagicDamage(g, caster, t, dmg, dice.elem, id);   // 316507 dmghp + 复合咏唱
        if (t.get(94) > 0 && id !== 655 && (caster.index >= 16 || tIdx >= 16)) {   // 316678-316680 反射
          const refl = limit(idiv(dmg * t.get(94), 200) + 1, 1, idiv(caster.hpMax, 10));
          applyMagicDamage(g, t, caster, refl, dice.elem, id);   // 316225/316678 魔法反射
        }
        hits.push({ index: tIdx, dmg: applied });
      }
    }
    if (id === 644) { caster.set(50, 0); caster.set(256, 70); }         // 316724-316727 自爆
    const b32 = Elona.Status.findbuff(caster, 32);
    if (b32 !== -1 && (caster.index !== 0 || (tg && tg.get(9) === -3))) Elona.Status.delbuff(caster, b32);  // 316708-316722
    return { ok: true, type: 3, implemented: true, hits, realTarget };
  }

  /**
   * type 5：传送/杂项（317708-318128）——移植核心落点计算与移动。
   * 408 Teleport(自身) / 619 Shadow Step / 620 Draw Shadow / 409 定点 / 635 施法者↔目标。
   * 【未移植/近似】`*label_2911` 完整落点校验（此处用 walkable 近似）、410/627 的随机散布差、
   *   810 的投掷、635 偷窃、var_65/命运/陷阱等全局分支。
   */
  function effectType5(g, caster, id, tg, power) {
    if (!tg || tg.get(0) !== 1) return { ok: true, type: 5, implemented: true, noTarget: true };
    // 306269-306278 / 317866：附魔「会妨碍传送」(22) → 传送被挡下
    //   注意：飞兽传送/影步走的是别的分支，不受影响
    if (Elona.ItemDB && Elona.ItemDB.encfind && Elona.ItemDB.encfind(tg, 22) !== -1
      && !(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(tg, 985))) {
      return { ok: true, type: 5, implemented: true, blocked: true, reason: 'anti-teleport' };
    }
    const R = g.rng;
    let target = tg;
    if (id === 408) target = caster;                                    // 317812-317814
    let baseX = null, baseY = null;
    if (id === 619) { baseX = tg.x; baseY = tg.y; }                     // 317815-317818
    else if (id === 620) { baseX = caster.x; baseY = caster.y; }        // 317837-317840
    else if (id === 810) {                                              // 317819-317836
      const t2 = tg.get(29);
      if (t2 !== -1 && g.charas[t2]) { baseX = g.charas[t2].x; baseY = g.charas[t2].y; }
      else { baseX = g.charas[0].x; baseY = g.charas[0].y; }
    }
    if (id === 409 || id === 635) {                                     // 317841-317852 定点/换位
      const c2 = g.map.cell(tg.x, tg.y);
      if (!c2 || c2[1] === 0) return { ok: true, type: 5, implemented: true, moved: false };
    }
    let nx = 0, ny = 0, ok = false;
    for (let cnt = 0; cnt < 200; cnt++) {                              // 317948 repeat 200
      if (id === 619 || id === 620) {                                   // 317956-317979
        const sp = idiv(cnt, 8) + 2;
        nx = baseX + R.rnd(sp) - R.rnd(sp);
        ny = baseY + R.rnd(sp) - R.rnd(sp);
      } else if (id === 810) {                                          // 317962-317973
        const sp = Math.max(1, tg.get(208));
        const k = idiv(cnt, 8) + 1 + sp;
        nx = baseX + R.rnd(k) - R.rnd(k);
        ny = baseY + R.rnd(k) - R.rnd(k);
      } else {                                                          // 317981-317983 随机全图
        nx = R.rnd(g.map.width - 2) + 1;
        ny = R.rnd(g.map.height - 2) + 1;
      }
      if (!g.map.inBounds(nx, ny) || nx === 0 || ny === 0) continue;
      if (!g.map.walkable(nx, ny)) continue;
      ok = true; break;
    }
    if (!ok) return { ok: true, type: 5, implemented: true, moved: false };
    placeChar(g, target, nx, ny);                                       // 318116 label_2911
    return { ok: true, type: 5, implemented: true, moved: true, targetIndex: target.index, x: nx, y: ny };
  }

  /**
   * type 6：吸血/啃咬/接触异常（316978-317395）——逐字移植。
   * 601 吸血(SP 转移+出血) / 748 啃咬(回复+饱食+抗性削减) / 758 记忆毒(抗性归零) /
   * 613-618 接触异常(dmgcon) / 614 addbuff 61。
   * 【未移植/近似】dmghp 抗性链(→applyDamage)、encfind、gain_iden、label_2174、var_65(250+2) 特例。
   */
  function effectType6(g, caster, id, tg, power) {
    const dice = diceOf(g, caster, id, power);
    if (!dice) return { ok: true, type: 6, implemented: false, reason: 'calcskill 未移植该 id' };
    if (!tg || tg.get(0) !== 1) return { ok: true, type: 6, implemented: true, noTarget: true };
    const hits = [];
    const hit = (t, d) => hits.push({ index: t.index, dmg: applyMagicDamage(g, caster, t, d, dice.elem, id) });
    if (id === 601) {                                                   // 317142-317194
      if (tg.sp > 0) Elona.Status.healsp(caster, 12);
      Elona.Status.dmgsp(tg, g.rng.rnd(6) + 5);
      if (caster.index === 0 && tg.index < 16 && (tg.get(17) >= 150 || tg.get(169) >= 150)) {
        Elona.Status.healcon(tg, 12, 5);                                // 317167
        dmgconOf(g, tg, 9, 50);                                         // 317187
      } else {
        if (g.rng.rnd(30) === 0) dmgconOf(g, tg, 12, 20);               // 317170-317171
        hit(tg, Elona.Battle.role(g.rng, dice.dice, dice.sides, dice.bonus));   // 317190
        dmgconOf(g, tg, 9, 75);                                         // 317191
      }
      Elona.Status.healcon(caster, 9, 75);                              // 317193
    } else {
      hit(tg, Elona.Battle.role(g.rng, dice.dice, dice.sides, dice.bonus)   // 317195-317196
        + idiv((limit(caster.level - 50, 1, 2000) + limit(caster.level - 100, 1, 2000))
          * 4 * Math.sqrt(limit(caster.level, 1, 2000) * 3) + 30 + 1, 3));
    }
    if (id === 748) {                                                   // 317198-317233
      dmgconOf(g, tg, 9, 75);
      if (caster.hp <= idiv(caster.hpMax * 2, 3)) Elona.Status.healhp(caster, idiv(caster.hpMax, 3));
      caster.set(22, caster.get(22) + 75);
      if (tg.get(25) < 4) {
        const pot = (Elona.Resist) ? Elona.Resist.sorg(tg, 11) : tg.skill(11);
        if (tg.skill(11) >= idiv(pot, 2)) {
          const v = pot - tg.get(240);
          if (v > 0) tg.set(240, tg.get(240) - (idiv(v * power, 2000) + 5));
        }
      }
    }
    if (id === 758) {                                                   // 317234-317266
      if (tg.index === 0 || tg.get(25) < 4) {
        for (const n of [10, 11, 12, 17, 18, 14, 13, 16, 15, 19]) tg.set(240 + n, tg.get(240 + n) - 50);
      }
    }
    if (id === 617) dmgconOf(g, tg, 6, dice.elemArg);                   // 317268
    if (id === 618) dmgconOf(g, tg, 2, dice.elemArg);                   // 317271
    if (id === 615) dmgconOf(g, tg, 1, dice.elemArg);                   // 317274
    if (id === 616) dmgconOf(g, tg, 3, dice.elemArg);                   // 317277
    if (id === 614) Elona.Status.addbuff(g, tg, 61, 9999999, 100);      // 317280
    if (id === 613 && tg.get(25) < 4 && Elona.Status.findbuff(tg, 60) === -1) {   // 317283-317318
      const n = g.rng.rnd(10);
      const pot = (Elona.Resist) ? Elona.Resist.sorg(tg, 10 + n) : tg.skill(10 + n);
      const v = pot - tg.get(240 + n);
      if (v > 0) tg.set(240 + n, tg.get(240 + n) - (idiv(v * power, 2000) + 1));
    }
    return { ok: true, type: 6, implemented: true, hits };
  }

  /**
   * type 7：召唤（317396-317707）——移植等级/数量/关系计算。
   * 【未移植】`characreate` / `calcobjlv` / `calcfixlv` / `fltn`：**怪物生成引擎未纳入本项目**，
   *   因此本函数不会凭空造怪；仅当宿主提供 `g.summonMonster(g, caster, id, level, tg)` 时才调用它。
   *   未提供时返回 implemented:false（明确标注，不臆造）。
   */
  function effectType7(g, caster, id, tg, power) {
    // 0-EJ：召唤全流程在 core/summon.js（317396-317712），这里只做分派。
    if (Elona.Summon) return Elona.Summon.run(g, caster, id, tg, power);
    // 兜底（模块缺失时保持旧行为，不静默失败）
    if (id === 663 && caster.index !== 0 && caster.get(182) < 100) {     // 317398-317404
      return cast(g, caster, 732, tg);
    }
    if (caster.index !== 0 && (caster.index < 16 || Elona.Status.cbit(caster, 960) === 1
      || caster.get(58) === 100 || caster.get(9) === 10)) {             // 317414-317419
      return cast(g, caster, 732, tg);
    }
    return { ok: true, type: 7, implemented: false, reason: 'summon 模块未加载' };
  }

  /**
   * type 10：远距离物理攻击（315970-315989）。
   * 已接入 `Elona.Battle.attackSeq`（= *label_3006 多段武器攻击驱动）；
   * 单次结算 *label_3007 仍复用 calcAttackHit/calcAttackDmg 通用管线（属性附魔等未逐字移植）。
   * cbit(1016) 时改用 var_58(29) 指定目标（315972-315976）。
   */
  function effectType10(g, caster, id, tg, power) {
    let target = tg;
    if (caster.index !== 0 && Elona.Status.cbit(caster, 1016)) {        // 315972-315976
      const t2 = caster.get(29);
      if (t2 >= 0 && g.charas[t2]) target = g.charas[t2];
    }
    if (!target || target.get(0) !== 1) return { ok: true, type: 10, implemented: true, noTarget: true };
    const r = Elona.Battle.attackSeq(g, caster, target);                // *label_3006
    const first = (r.attacks && r.attacks[0]) || null;
    return { ok: true, type: 10, implemented: true, approx: true,
      hit: !!(first && first.hit), target: target.index, result: r };
  }

  /**
   * type 0：`*label_2965`/`*label_2966` 的杂项动作（318379-325279）。
   * **绝大多数 id 属玩家侧 UI/元操作**（物品选择器 label_2824/2847、世界地图 1162、商店、Return 428 等），
   * 其 UI 子系统未纳入本项目 → 一律返回 `implemented:false`。
   * 本函数只实现不依赖 UI 的纯逻辑子集：
   *   645 / 1114「呪い（诅咒物品）」—— 325281-325360：按目标意志与威力判定，给其一件物品打诅咒标记。
   * 【近似】原版优先在装备槽（var_58(100..129)）与背包（inv）中挑选并要求 var_99(17) 的免疫判定；
   *   本项目物品模型只有 inv → 仅从 inv 取，且保留免疫（var_99(17)==1）判定。
   */
  // ==========================================================================
  // type 0 特殊攻击 702-707 / 731 / 749（*label_2965 的对应分支，322522-324733）
  // ==========================================================================
  const SPECIAL_ATTACKS = { 702: 1, 703: 1, 704: 1, 705: 1, 706: 1, 707: 1, 731: 1, 749: 1 };

  function v65(g, n) { return (g && typeof g.getV65 === 'function') ? g.getV65(n) : 0; }
  function set65(g, n, v) { if (g && typeof g.setV65 === 'function') g.setV65(n, v); }
  function cbitOf(c, bit) { return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, bit) : 0; }
  function damageOne(g, tg, d) {
    if (Elona.Battle && Elona.Battle.applyDamage) return Elona.Battle.applyDamage(tg, d);
    tg.hp = (tg.hp || 0) - d;
    return d;
  }
  function condOf(g, tg, id, power) {
    if (Elona.Resist && g.dmgconTable) Elona.Resist.dmgcon(g, g.dmgconTable, tg, id, power);
  }

  /** 武器类型码 var_58(97) → 默认技能（各分支 322668/322803/322928/324254/324377/324508/324640） */
  function specialSkill(caster, id) {
    const wt = caster.get(97);
    if (id === 702) return wt === 1 ? 100 : (wt === 101 ? 101 : (wt === 1001 ? 105 : 100));
    if (id === 703) return 101;
    if (id === 704) return wt === 3 ? 100 : (wt === 103 ? 102 : 100);
    if (id === 705) return 103;
    if (id === 706) return (wt === 5 || wt === 105) ? (wt === 5 ? 104 : 105) : 104;
    if (id === 707) return 105;
    if (id === 731) return 107;
    return 168;                                   // 749
  }

  function specialAttack(g, caster, tg, id) {
    const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
    const out = { ok: true, type: 0, implemented: true, target: tg };
    if (id !== 749 && caster.get(182) < 100) { out.noStamina = true; return out; }
    if (id === 749 && (caster.get(32) & 1) === 0) { out.noShield = true; return out; }
    caster.set(182, caster.get(182) - 100);       // 322532/322654/...
    if (caster.get(182) >= 100) {                  // var_1636=100 / var_65(801)=2
      g.var1636 = 100;
      if (v65(g, 801) === 0) set65(g, 801, 2);
    }
    let s = specialSkill(caster, id);
    // 322581/322704/322839/322963/324290/324412/324542：被防御方弹开
    const parry = {
      702: [1, 101, 1001], 703: [2], 704: [3, 103], 705: [4], 706: [5, 105], 707: [6],
    };
    const pt = parry[id];
    if (pt && pt.indexOf(tg.get(97)) >= 0 && cbitOf(tg, 985) !== 1 && tg.skill(187) > 0) {
      if (R(tg.skill(187) + 500) > R(caster.skill(187) + 500)) {
        s = limit(s - tg.skill(187), 1, 2000);
      }
    }
    if (id === 749 && (tg.get(32) & 1) && tg.get(96) === 1 && cbitOf(tg, 985) !== 1) {
      s = limit(caster.skill(168) - tg.skill(168) - tg.skill(187), 1, 2000);   // 324684
    }
    // var_2452：装备附魔等级均值（322598-322614 等）
    let sum = 1, n = 0;
    for (const it of (caster.inv || [])) {
      if (!it || !it.f || !it.f[0] || it.f[18] === 0) continue;
      sum += limit(it.f[20] || 0, 0, 20);
      n++;
    }
    if (sum <= 0) sum = 1;
    if (n <= 0) n = 1;
    const m = limit(idiv(sum, n) * 3 + 10, 13, 40);

    let dmg;
    if (id === 707) {
      // 324576-324614：17 连击，每击 /16
      set65(g, 193, 1000);
      dmg = 0;
      for (let i = 0; i < 17; i++) {
        if (tg.get(0) !== 1) break;
        const one = Math.trunc(limit(caster.get(184) + idiv(s + 1, 2), 16, 2500) / 16
          * Math.sqrt(s) * Math.sqrt(Math.max(0, m - 2)) + R(idiv(s, 10) + 1));
        dmg += damageOne(g, tg, one);
      }
      set65(g, 193, 0);
    } else {
      const minB = (id === 749) ? 2 : 2;
      const base = limit(caster.get(184) + idiv(s + 1, 2), minB, 2500);
      let raw = base * Math.sqrt(s) * Math.sqrt(Math.max(0, m - 2)) + R(s + 1);
      if (id === 749) raw = raw / 2;              // 324704
      dmg = damageOne(g, tg, Math.trunc(raw));
    }
    // 322617-322631 等：目标饱食度 +40
    if (tg.get(0) === 1) {
      if (tg.get(60) < 100) {
        tg.set(60, tg.get(60) + 40);
        if (tg.get(60) >= 100) tg.set(60, 120);
      }
    }
    // 各分支的追加效果
    if (id === 702 && tg.get(182) > 0) tg.set(182, idiv(tg.get(182), 2));   // 322771
    if (id === 703 && tg.get(255) === 0) tg.set(255, 5);                     // 322895
    if (id === 704 && tg.get(258) < 15) tg.set(258, 15);                     // 323025
    if (id === 705) tg.set(179, 4);                                          // 324346
    if (id === 706 && tg.get(256) < 10) tg.set(256, 10);                     // 324474
    if (id === 707) tg.set(148, 5);                                          // 324607
    if (id === 749) {                                                        // 324720-324723
      condOf(g, tg, 7, 50 + Math.trunc(Math.sqrt(caster.skill(168))) * 15 + cbitOf(caster, 30) * 30);
      if (tg.get(252) === 0) tg.set(252, R(2) + cbitOf(caster, 30));
    }
    if (id === 731) {                                                        // 322615：吸收 MP
      const mpd = limit(baseVal(caster, s) * Math.sqrt(s) * Math.sqrt(Math.max(0, m - 2)) / 5,
        1, Math.max(1, idiv(tg.get(56), 2)));
      tg.set(55, Math.max(0, tg.get(55) - Math.trunc(mpd)));
    }
    // 322632/322756 等：技能经验
    if (!cbitOf(tg, 23) && !cbitOf(tg, 27) && !cbitOf(tg, 964)
      && !cbitOf(tg, 960) && !cbitOf(tg, 992) && !cbitOf(tg, 985) && Elona.Stats) {
      Elona.Stats.skillExp(caster, 152, caster.index, 400, 0, 5, g);
      Elona.Stats.skillExp(caster, s, caster.index, 400, 0, 5, g);
    }
    caster.set(178, 1);
    out.dmg = dmg;
    out.skill = s;
    return out;
  }
  function baseVal(c, s) { return limit(c.get(184) + idiv(s + 1, 2), 2, 2500); }

  /**
   * 雾 / 烟幕 / 酸液 / 火柱 —— 325598-325820 的 addmef 段。
   *   436 蜘蛛网 (mef 1, 11, -1, 威力×2)　437 闇の霧 (mef 2, 30, 8+rnd(15+威力/25))
   *   455 酸の水溜り (mef 3, 19, rnd(10)+5，命中者 170=-100 酸伤)
   *   456 火柱 (mef 5, 24, rnd(10)+5，命中者 170=-200 火伤 + mapitem_fire)
   *   472 光の霧 (mef 8, 4, 8+rnd(15+威力/25))　634 エーテルの霧 (mef 4, 20, rnd(4)+2)
   *   789 黒煙 (mef 9, 963, 15，威力固定 1000、半径 3、120 次尝试)
   * 落点范围 `var_400(0)` = 半径，`var_400(1)` = 尝试次数；每格按
   *   `x = cx + rnd(R) - rnd(R)` 抖动，越界 / dist>=R / rnd(2)==0 就跳过（325748-325764）。
   */
  const FOG_IDS = [436, 437, 455, 456, 472, 634, 789];
  function fogEffect(g, caster, id, tg, power) {
    const R = (n) => ((g && g.rng) ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    const cx = (tg && tg.get && tg.get(0) === 1) ? tg.x : caster.x;
    const cy = (tg && tg.get && tg.get(0) === 1) ? tg.y : caster.y;
    let radius = 3;
    let tries = 2 + idiv(power, 50) + 1;
    if (id === 634) { radius = 2; tries = 1 + idiv(power, 100) + 2; }
    if (id === 789) { radius = 3; tries = 120; power = 1000; }
    const TEXT = {
      436: '蜘蛛网笼罩了四周。',
      437: '四周被浓重的暗雾笼罩。',
      455: '四周出现了酸液水洼。',
      456: '地面喷出了火柱。',
      472: '四周被耀眼的光雾笼罩。',
      634: '以太之雾弥漫开来。',
      789: '四周被黑烟笼罩。',
    };
    if (TEXT[id]) g.log(TEXT[id]);
    const mef = g.mef;
    let placed = 0;
    if (mef && mef.add) {
      for (let i = 0; i < tries; i++) {
        const x = cx + R(radius) - R(radius);
        const y = cy + R(radius) - R(radius);
        if (x < 0 || y < 0 || x >= g.map.width || y >= g.map.height) continue;
        if (Elona.Battle.dist(cx, cy, x, y) >= radius) continue;
        if (R(2) === 0) continue;
        if (id === 436) mef.add(g, x, y, 1, 11, -1, power * 2, caster.index);
        else if (id === 437) mef.add(g, x, y, 2, 30, 8 + R(15 + idiv(power, 25)), power, caster.index);
        else if (id === 455) mef.add(g, x, y, 3, 19, R(10) + 5, power, caster.index);
        else if (id === 456) {
          mef.add(g, x, y, 5, 24, R(10) + 5, power, caster.index);
          if (Elona.ItemDB && Elona.ItemDB.mapitemFire) Elona.ItemDB.mapitemFire(g, x, y, caster);
        } else if (id === 472) mef.add(g, x, y, 8, 4, 8 + R(15 + idiv(power, 25)), power, caster.index);
        else if (id === 634) mef.add(g, x, y, 4, 20, R(4) + 2, power, caster.index);
        else if (id === 789) mef.add(g, x, y, 9, 963, 15, power, caster.index);
        placed++;
      }
    }
    return { ok: true, type: 0, implemented: true, fog: { id, placed, radius, tries } };
  }

  function effectType0(g, caster, id, tg, power) {
    if (FOG_IDS.indexOf(id) >= 0) return fogEffect(g, caster, id, tg, power);
    // 0-EL：吐息补全 —— 698/773 可变吐息（转向 602..612）、763 破坏奔流、837 沙尘炮
    //   写在 *label_2965 的分支里，且都属 type 0（动作表 f1=0），见 core/breathx.js
    if (Elona.BreathX && Elona.BreathX.has(id)) return Elona.BreathX.run(g, caster, id, tg, power);
    // 0-EH：近接系特殊能力（631/685/710/742/745/769/831）—— 原版写在 *label_2965
    //   的 var_1302 分支里，复用近接例程 *label_3006，见 core/melee.js
    if (Elona.Melee && Elona.Melee.has(id)) return Elona.Melee.run(g, caster, id, tg);
    // 0-EI：自身强化系（673/677/686/709/736/779/783）—— 同属 *label_2965 的
    //   var_1302 分支，但效果是 addbuff / 状态字段，见 core/buffact.js
    if (Elona.BuffAct && Elona.BuffAct.has(id)) return Elona.BuffAct.run(g, caster, id, tg);
    // 0-EK：斗志技 / 广域系（750/741/803/804）—— 同属 *label_2965 的 var_1302 分支，
    //   效果围绕 var_58(182) 斗志与 var_58(266) 行动模式，见 core/gauge.js
    if (Elona.Gauge && Elona.Gauge.has(id)) return Elona.Gauge.run(g, caster, id, tg);
    // 0-EM：*label_2965 里剩下的 116 条零散分支（见 core/ability0.js）
    if (Elona.Ability0 && Elona.Ability0.has(id)) return Elona.Ability0.run(g, caster, id, tg, power);
    // 428 Return：玩家归返（325075-325126）
    if (id === 428) {
      if (caster.index !== 0) return { ok: true, type: 0, implemented: true, nothing: true };
      if (g.getV65 && g.getV65(63) !== 0) { g.setV65(63, 0); return { ok: true, type: 0, implemented: true, cancelled: true }; }
      const map = g.getV65 ? g.getV65(20) : 0;
      const danger = g.getV65 ? g.getV65(22) : 0;
      const blocked = (map === 49 && danger === 129) || (map === 76 && danger === 179)
        || (g.getV65 && g.getV65(850) === 47);
      if (blocked) return { ok: true, type: 0, implemented: true, request: 'return', blocked: true };
      g.pendingMap = g.returnMap || 'vernis';
      return { ok: true, type: 0, implemented: true, request: 'return', travel: true };
    }
    // 411 Identify：玩家鉴定（320479-320496）
    if (id === 411) {
      if (caster.index !== 0) return { ok: true, type: 0, implemented: true, nothing: true };
      const pw = (power === undefined) ? calcSpellPower(id, caster) : power;
      return { ok: true, type: 0, implemented: true, request: 'identify', power: pw | 0 };
    }
    // 1162 World map（318471-318497）
    if (id === 1162) {
      return { ok: true, type: 0, implemented: true, request: 'worldmap' };
    }
    // 441 願い（324962-324988）：打开许愿输入；特定地图女神够不着
    if (id === 441) {
      const mapId = (g.getV65 ? (g.getV65(20) | 0) : 0);
      const danger = (g.getV65 ? (g.getV65(22) | 0) : 0);
      if (mapId === 35 && (caster.index | 0) !== 0) {
        return { ok: true, type: 0, implemented: true, nothing: true };
      }
      if (mapId === 76 && danger === 179) {
        return { ok: true, type: 0, implemented: true, request: 'wish', noPower: true };
      }
      if (g.setV65) g.setV65(36, (g.getV65(36) | 0) + 1);   // var_65(250+36)++
      return { ok: true, type: 0, implemented: true, request: 'wish' };
    }
    // 632 変容の眼差し（320275-320399）：对目标施加变异
    //   var_396 == 1144 的「只正向 + 2+rnd(3) 次」是药水/道具效果，此处按法术语义 1 次、可正可负
    if (id === 632) {
      if (!tg || tg.get(0) !== 1) return { ok: true, type: 0, implemented: true, noTarget: true };
      if (!Elona.Mutation) return { ok: true, type: 0, implemented: false, reason: 'mutation 模块未加载' };
      const r = Elona.Mutation.mutate(g, tg, { count: 1 });
      return { ok: true, type: 0, implemented: true, mutation: r, messages: r.messages };
    }
    // 653 / 654：寄生（318758-318817）
    //   653 = 刺入皮肤送入 → *label_2334（脑寄生）
    //   654 = 口中送入     → *label_2336（体内寄生；种族取施法者 var_58(27)，玩家则取 var_58(430)）
    if (id === 653 || id === 654) {
      if (!tg || tg.get(0) !== 1) return { ok: true, type: 0, implemented: true, noTarget: true };
      if (!Elona.Parasite) return { ok: true, type: 0, implemented: false, reason: 'parasite 模块未加载' };
      let r;
      if (id === 653) {
        r = Elona.Parasite.brain(g, tg);
      } else {
        const species = (caster.index | 0) === 0
          ? (caster.get(430) | 0) : (caster.get(27) | 0);
        r = Elona.Parasite.body(g, tg, species);
      }
      return { ok: true, type: 0, implemented: true, parasite: r, message: r.message };
    }
    // 787 / 788 / 723：属性弱化系（335767-335765 / 336807-336900 / 321882-321960）
    //   787 槲寄生投掷 → 力量(10) 弱化，base 20，强度取施法者精灵术(180)
    //   788 魔力芳香   → 范围内同阵营回气力/MP，敌方速度(18)弱化，base 10
    //   723 卷轴缠身   → 器用(12) 弱化，base 10，并给对方 var_58(268)（束缚回合）
    //   三者都受「品质>=4 / 附魔 6*10000+10+idx 属性维持 / 已低于基础一半」三重免疫
    if (id === 787 || id === 788 || id === 723) {
      const rng = g.rng;
      const wk = Elona.Weaken;
      if (!wk) return { ok: true, type: 0, implemented: false, reason: 'weakens 模块未加载' };
      const spirit = caster.skill(180) | 0;
      const ctrl = caster.skill(111) | 0;
      const magic = caster.skill(150) | 0;

      if (id === 787) {
        if (!tg || tg.get(0) !== 1) return { ok: true, type: 0, implemented: true, noTarget: true };
        // 335782：MP 削减
        if (Elona.Status && Elona.Status.dmgmp) {
          Elona.Status.dmgmp(tg, idiv(ctrl, 5) + rng.rnd(5 + idiv(ctrl, 5)), g);
        }
        // 335783-335788：对神族额外伤害
        let slay = 0;
        const tag = Elona.EnchantFX ? Elona.EnchantFX.raceTag(tg.get(27) | 0) : '';
        if (tag.indexOf('/god/') >= 0) {
          let d = (idiv(ctrl, 3) + 1) * (idiv(spirit + 1, 3) + 1) + rng.rnd(ctrl + 5);
          d = idiv(d * 50, (tg.skill(180) | 0) + 50);
          slay = damageOne(g, tg, d);
        }
        // 335794-335812：力量弱化
        const w = wk.weaken(g, tg, 0, spirit, { base: 20 });
        return { ok: true, type: 0, implemented: true, weaken: w, slay,
          message: w.ok ? `${tg.name || '相手'}は弱くなった。` : '' };
      }

      if (id === 723) {
        if (!tg || tg.get(0) !== 1) return { ok: true, type: 0, implemented: true, noTarget: true };
        if ((tg.get(268) | 0) <= 0) tg.set(268, rng.rnd(3));
        const w = wk.weaken(g, tg, 2, magic, { base: 10, needBuff60: true });
        return { ok: true, type: 0, implemented: true, weaken: w,
          message: w.ok ? `${tg.name || '相手'}の動きが鈍った。` : '' };
      }

      // 788 芳香：范围（var_83(3,656)/1000 + 1 格，需 LOS）
      const range = idiv((Elona.Spell && Elona.Spell.field ? Elona.Spell.field(656, 3) : 0), 1000) + 1;
      const hits = [];
      for (const t of (g.charas || [])) {
        if (!t || t.get(0) !== 1) continue;
        if (Math.max(Math.abs(t.x - caster.x), Math.abs(t.y - caster.y)) > range) continue;
        if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, caster.x, caster.y, t.x, t.y)) continue;
        const sameSide = (caster.index | 0) < 16 || (caster.index | 0) === 0
          ? (t.get(9) | 0) !== -3
          : (t.get(9) | 0) === (caster.get(9) | 0);
        if (sameSide) {
          t.set(182, Math.min(200, (t.get(182) | 0) + 15));
          if (Elona.Status && Elona.Status.healmp) {
            Elona.Status.healmp(t, idiv(t.get(56) | 0, 50) + rng.rnd(5 + spirit)
              + idiv(spirit, 2) * Math.trunc(Math.sqrt(spirit + 1)));
          }
          hits.push({ index: t.index, kind: 'buff' });
        } else {
          const w = wk.weaken(g, t, 8, spirit, { base: 10, needBuff60: true });
          hits.push({ index: t.index, kind: 'weaken', weaken: w });
        }
      }
      return { ok: true, type: 0, implemented: true, aroma: hits };
    }

    // 0-ER：type-0 的实用法术（清浄なる光/全浄化/解呪/神託/魔法の地図/物質感知/
    //   壁生成/扉生成/肉体復活/精神復活/自己の変容/復活/四次元ポケット/収穫/メテオ/グラビティ）
    //   逐条见 core/spellutil.js
    if (Elona.SpellUtil && Elona.SpellUtil.has(id)) return Elona.SpellUtil.run(g, caster, id, tg, power);
    if (SPECIAL_ATTACKS[id]) {
      if (!tg) return { ok: true, type: 0, implemented: true, noTarget: true };
      return specialAttack(g, caster, tg, id);
    }
    if (id !== 645 && id !== 1114) {
      return { ok: true, type: 0, implemented: false,
        reason: 'label_2965/2966 的该 id 属玩家侧 UI/元操作，未移植' };
    }
    if (!tg || tg.get(0) !== 1) return { ok: true, type: 0, implemented: true, noTarget: true };
    let r400 = 75 + tg.skill(19);                                     // 325290
    // 325291-325293：附魔「保护你免受诅咒」(43) → r400 += encfind(43)/2
    if (Elona.ItemDB && Elona.ItemDB.encfind) {
      const e43 = Elona.ItemDB.encfind(tg, 43);
      if (e43 !== -1) r400 += idiv(e43, 2);
    }
    if (g.rng.rnd(r400) > idiv(power, 2) + ((g.var2362 <= -1) ? 100 : 0)) {
      return { ok: true, type: 0, implemented: true, cursed: false, reason: 'resisted' };   // 325294-325295
    }
    const inv = tg.inv || [];
    if (!inv.length) return { ok: true, type: 0, implemented: true, cursed: false, reason: 'no_item' };
    const it = inv[g.rng.rnd(inv.length)];                            // 325338-325339
    if (it && it.f) {
      if (it.f[17] === 1) {                                           // 325341-325349 免疫诅咒
        return { ok: true, type: 0, implemented: true, cursed: false, reason: 'immune', item: it };
      }
      it.f[17] = (it.f[17] === -1) ? -2 : -1;                         // 325351-325356
    }
    return { ok: true, type: 0, implemented: true, cursed: true, item: it };
  }

  /**
   * 执行一个动作/法术/能力的效果。
   * 移植范围：前置检查 2959 + 威力计算 + 效果分派 2960 的 **buff 系(f1>=1000)**、
   *   **type 0（纯逻辑子集）/1/2/3/4/6/7/8/10**（type 5 传送、type 7 召唤为简化/受限实现，见各函数注释）。
   * 【未实现，不得视为原版行为】type 0 中依赖 UI 的其余 id：返回 { implemented:false }。
   * 【未移植的外层】2950/2952 的玩家 MP 消耗与失败率流程、var_2378(boss 强化 → 718/715) 后处理、
   *   calcmagicrit 会心、dmghp 的完整抗性链（此处以 Battle.applyDamage 近似）。
   * @returns {Object} { ok, type, target, implemented, ... }
   */
  function cast(g, caster, id, target, tile) {
    // 314581（*label_2950）：魔法咏唱的 var_2362（物品诅咒等级）恒为 0；
    //   只有药剂/魔杖等道具路径会把它设成物品的 f[17]。
    if (g) g.var2362 = 0;
    const pre = precheck(g, caster, id, target, tile);
    if (!pre.ok) return { ok: false, type: field(id, 1), reason: pre.reason };
    if (pre.nothing) return { ok: true, type: field(id, 1), nothing: true };
    const f1 = field(id, 1);
    const raw = calcSpellPower(id, caster);
    // 314770-314771：var_578 与 var_2422 都先取 calcspellpower 的结果 ——
    //   骰「个数」用 var_2422（原始强度），骰「面数」用增幅后的 var_578。
    //   314955 的 calcskill 调用把这第二个实参原样传下去，所以两者必须分开存。
    if (g) g.var2422 = raw;
    const power = applyPowerBoost(g, caster, id, raw);          // 314772-314784
    // 315679：对地面发动（var_2421 = 1）—— 效果结算需要格子坐标时从这里取
    if (pre.tile && g) g.dirTile = { x: pre.tile.x | 0, y: pre.tile.y | 0 };
    return dispatchEffect(g, caster, id, pre.target, power, f1);
  }

  /**
   * 咏唱施法的威力增幅（314772-314784）。
   *   var_2423 = limit(var_58(98)*2/3, 0, 1000)/10        ← 附魔「魔法威力增强」合计/15%（上限 100）
   *            + limit(var_82(16)/10, 0, 150)             ← 魔力/10%（上限 150）；453 不加这一项
   *   var_578 = var_578 * (100 + var_2423) / 100
   *   魔装（状態 64 在 15000..34999 且带 buff 34）→ ×6/5
   *   咏唱モード（`var_58(428, 0) == 1` 且施法者是玩家或 var_58(58)==100）→ ×6/5
   *
   * 这个增幅只属于「咏唱」这一条路径：魔杖/药剂/卷轴在各自的例程里算
   * （315382-315388 / 314869-314872），所以不能放在 dispatchEffect 里，
   * 否则道具施法会被叠加两次。
   */
  function applyPowerBoost(g, caster, id, power) {
    let pw = power;
    if (!caster || pw <= 0) return pw;
    let add = idiv(limit(idiv((caster.get(98) | 0) * 2, 3), 0, 1000), 10);
    if (id !== 453) add += limit(idiv(caster.skill(16), 10), 0, 150);
    if (add) pw = idiv(pw * (100 + add), 100);
    if ((caster.get(64) | 0) >= 15000 && (caster.get(64) | 0) < 35000
      && Elona.Status && Elona.Status.findbuff && Elona.Status.findbuff(caster, 34) !== -1) {
      pw = idiv(pw * 6, 5);
    }
    // 314782：var_58(428, 0) 是**玩家**的咏唱模式开关，不是 var_65(428)
    const p0 = (g && g.charas) ? g.charas[0] : null;
    const mode = p0 ? (p0.get(428) | 0) : 0;
    if (mode === 1 && ((caster.get(58) | 0) === 100 || (caster.index | 0) === 0)) {
      pw = idiv(pw * 6, 5);
    }
    return pw;
  }

  /**
   * 效果分派（`*label_2960`）本体 —— 不含 precheck。供 cast 与「道具使用」复用：
   * 原版 item-use 例程（2953/2955）会直接 `gosub *label_2960`（跳过 2959 前置检查）。
   * @param {number} [powerOverride] 威力覆盖（道具使用会把 var_578 设为物品威力）
   */
  /**
   * 支配（435）—— 325555-325650。
   *   · 玩家在竞技场/宠物竞技场/特定地图无法使用（325567）
   *   · 持有道具 663 时威力 ×3/2（325578-325581）
   *   · 成功判定：`rnd(威力/15 + 5) >= 目标等级`（325582）
   *   · 「绝不服从」列表（325585）：玩家本人 / 关系 10 / 槽位 <16 / 亡灵使役 /
   *     品质 >= 4 / 有角色类型 / cbit 976 / var_58(197)==10 / cbit 963
   *   · 命中该列表 → 改为**麻痹**（var_58(252) = 品质>=4 ? 10 : 30）（325636-325648）
   *   · 否则收为同伴（325624-325628 → *label_4274）
   */
  function effectDominate(g, caster, target, power) {
    if (!target) return { ok: true, implemented: true, dominate: { none: true }, target };
    const R = (n) => (g && g.rng ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    const CB = (c, n) => (Elona.Status && Elona.Status.cbit ? Elona.Status.cbit(c, n) : 0);
    // 玩家侧的地图限制
    if (caster && caster.index === 0) {
      const mid = g && g.getV65 ? (g.getV65(20) | 0) : 0;
      if (mid === 6 || mid === 40 || mid === 76 || mid === 42
        || (g && g.getV65 && (g.getV65(32) | 0) !== 0)) {
        return { ok: true, implemented: true, blocked: true, target,
          message: '在这个地方没有效果。' };
      }
      if (CB(target, 992)) {
        return { ok: true, implemented: true, dominate: { none: true }, target,
          message: '什么也没有发生……' };
      }
    }
    let pw = power;
    const has663 = (caster && caster.inv ? caster.inv : [])
      .some((it) => it && (it.f[0] | 0) > 0 && (it.id | 0) === 663);
    if (has663) pw = idiv(pw * 3, 2);
    let won = R(idiv(pw, 15) + 5) >= (target.get(38) | 0);

    const neverObeys = target.index === 0 || (target.get(9) | 0) === 10
      || (target.index | 0) < 16 || CB(target, 992) || (target.get(25) | 0) >= 4
      || (target.get(150) | 0) !== 0 || CB(target, 976)
      || (target.get(197) | 0) === 10 || CB(target, 963);

    if (neverObeys) {
      if ((target.get(252) | 0) !== 0) won = false;
      if (!won) {
        return { ok: true, implemented: true, dominate: { resisted: true }, target,
          message: `${target.name}抵抗了。` };
      }
      const para = (target.get(25) | 0) >= 4 ? 10 : 30;
      target.set(252, para);
      return { ok: true, implemented: true, dominate: { paralyzed: true, turns: para }, target,
        message: `${target.name}的身体被支配了。` };
    }
    if (!won) {
      return { ok: true, implemented: true, dominate: { resisted: true }, target,
        message: `${target.name}抵抗了。` };
    }
    if (Elona.Party && Elona.Party.dominate) {
      const r = Elona.Party.dominate(g, target);
      return { ok: true, implemented: true, dominate: { joined: r.ok }, target,
        message: r.message || '' };
    }
    return { ok: true, implemented: false, target, why: 'no-party' };
  }

  function dispatchEffect(g, caster, id, target, power, f1in) {
    const f1 = (f1in === undefined) ? field(id, 1) : f1in;

    // 注意：威力增幅（314772-314784）在 cast() 里做，道具施法在各自的例程里做。
    // 这里只做「已经把 var_578 算好之后」的效果分派。

    // 325555-325650：支配（435）—— 由独立分支处理（不走 type 分派）。
    if (id === 435) return effectDominate(g, caster, target, power);

    if (idiv(f1, 1000) === 1) {                                // 315852 buff 系
      const buffId = f1 % 1000;                                // var_400
      // 315874-315887：祝福/诅咒对强度的影响（debuff 方向相反）
      //   buff  ：var_2362>=1 → ×1.5；<=-1 → 50
      //   debuff：var_2362>=1 → 50；<=-1 → ×1.5
      let pw = power;
      const curse = (g && g.var2362) ? (g.var2362 | 0) : 0;
      const deb = (Elona.BuffEffects && Elona.BuffEffects.isDebuff)
        ? Elona.BuffEffects.isDebuff(buffId) : false;
      if (!deb) {
        if (curse >= 1) pw = idiv(pw * 150, 100);
        if (curse <= -1) pw = 50;
      } else {
        if (curse >= 1) pw = 50;
        if (curse <= -1) pw = idiv(pw * 150, 100);
      }
      // 315898：持续回合取自 calcbuff 的 var_79（`calcbuff -1, var_400, var_578`）
      const dur = (Elona.BuffEffects && Elona.BuffEffects.turnsOf)
        ? Elona.BuffEffects.turnsOf(buffId, pw)
        : ((g.var79 !== undefined) ? g.var79 : 100);
      const added = Elona.Status ? Elona.Status.addbuff(g, target, buffId, pw, dur) : 0;
      return { ok: true, type: f1, implemented: true, buff: { id: buffId, added: !!added, power: pw, turns: dur }, target };
    }
    if (f1 === 0) return effectType0(g, caster, id, target, power);   // type 0 杂项（纯逻辑子集）
    if (f1 === 1) return effectType1(g, caster, id, target, power);   // 弹道
    if (f1 === 2) return effectType2(g, caster, id, target, power);   // 单体魔法
    if (f1 === 3) return effectType3(g, caster, id, target, power);   // 球/范围
    if (f1 === 4) return effectType4(g, caster, id, target, power);   // 治疗
    if (f1 === 5) return effectType5(g, caster, id, target, power);   // 传送
    if (f1 === 6) return effectType6(g, caster, id, target, power);   // 吸血/接触
    if (f1 === 7) return effectType7(g, caster, id, target, power);   // 召唤
    if (f1 === 8) return effectType8(g, caster, id, target, power);   // 吐息/放射
    if (f1 === 10) return effectType10(g, caster, id, target, power); // 远程物理
    return { ok: true, type: f1, implemented: false, target };
  }

  Elona.Spell = {
    loadTable, setTable, field, actionName,
    calcSpellPower, calcSpellFail, calcSpellCostMp, calcSpellCostStock, applyPowerBoost,
    calcSkill, fovLos, losBlockedTile, precheck,
    effectType0, effectType1, effectType2, effectType3, effectType4, effectType5, effectType6, effectType7, effectType8, effectType10,
    healRoutine, getRoute, routeInfo, breathList, calcMagicControl, calcMagicCrit, isHostile, sameGroup, placeChar, mefTypeOf, cast, dispatchEffect,
    dmgconOf,   // 0-EL：此前漏导出，导致 battle/abyss/itemfx 里的 dmgcon 调用全部静默跳过
    applyMagicDamage, chorusCoef, CHORUS_GROUPS, CHORUS_ADD,
    idiv, limit,
  };
})(window);
