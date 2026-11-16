'use strict';
/**
 * 负重阻挡 / 货物压伤 / 旅行结算 —— 0-Z3（负重・载具・旅行三机制收口）。
 *
 * 【源码定位】start.hsp
 *   343028-343043  玩家移动尝试的阻挡（*label_2989 的 cell_check 之后）：
 *     · var_58(45,0) >= 4（压溃中）且 var_17 == 0（非无重模式）
 *       → 「潰れていて動けない！」，var_237++ 消耗 1 回合，不移动；
 *     · var_126(6) == 1（世界地图）且 var_65(80) > var_65(82) * 2（货物超上限两倍）
 *       → 「荷車が重すぎて動けない！」，同样消耗 1 回合。
 *     （0-GL 已把同一判定接在 Actions.bash；本模块补普通/世界移动两条路径。）
 *   604895-604908  玩家回合结算（turn_end:pc 前）：
 *     var_58(45,0) >= 3（超過及以上）且 rnd(20) == 0
 *       → 「荷物に圧迫されもがいた」，dmghp( var_58(51) * (43*10/44 + 10) / 200 + 1, -6 )。
 *   248724-248846  旅行结算：进入地图类型 3（城镇）/ 7（自宅）/ 2（野外）时，
 *     若旅行里数累计达 300（源码 var_65(180) < -300 的负累计口径，本实现按
 *     wiki「每格 4 里、300 里结算」以正数累计，行为等价）：
 *       · 提示「从 X 出发后 N日M小时的旅を終えた」（出发时间 var_65(181) /
 *         出发地图 var_65(182)，237600-237602 记录）；
 *       · 全队（PC + 同伴）skillexp 182 = 5 + 里数*2/5（248751 / 248807）；
 *       · 八维（10..17）与全部已学技能（100..112 / 150..191 / 300..302）
 *         skillexp = limit(182等/10 + 里数/2 + 学习(14)/4 + 50, 1, 2000)
 *         （248779-248803）；清零 var_65(180)（248846）。
 *       · 材料获得进度 +50 段（248753-248776）：仅同伴（源码 repeat 16 中 `cnt==0 continue`，
 *         玩家另有分支且不含此段）满足 var_58(17,cnt)>=100 时，按五组技能等级
 *         163→191 / 185→192 / 180→193 / 151→194 / 159→195 做随机判定：
 *         skill>0 且 limit(skill,0,100) + 里程 > rnd(1000) → 对应材料获得进度 +50。
 *   237600-237602  出发记录：进地图类型 3 / 2 / 自宅（var_65(20)==7）或从未记录时，
 *     var_65(181) = 总小时数、var_65(182) = 换图前的地图 id（var_65(19)，237110）。
 *
 * 【关联】
 *   负重四档（var_58(43/44/45)）→ core/feat.js applyWeight（label_2225 已移植）；
 *   速度惩罚（档1 -10 / 档2 -30 / 档3 -50 与荷车超重）→ core/stats.js refreshSpeed；
 *   举重经验（每 10 回合 phase 3，档非 0 → +4，世界地图 1/20）→ core/turncycle.js 2162；
 *   荷车/载具上限与超重惩罚 → core/vehicle.js；
 *   货物遇敌公式 → core/encounter.js roll（343641-343644 已移植）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 8838-8841：var_292 负重档位名（0=无 / 1..4） */
  const TIER_NAMES = ['', '重荷', '压迫', '超重', '压溃中'];

  /**
   * 248753-248776：旅行结算的材料获得进度 +50 判定表（技能 id → var_58 材料进度字段）。
   * 这五个字段是材料获得进度，不是技能潜力：源码 200462-200478 采集技能
   * （163/185/180/151/159）会累加对应字段，415118-415122 判定任一 >200 即出现
   * 能力 66「マテリアルを受け取る / Recieve materials.」供玩家领取材料。
   * 源码只对 cnt=1..15 的同伴做（cnt==0 玩家在 248806 另有分支但无此段），
   * 且要求 var_58(17,cnt) >= 100。
   */
  const MATERIAL_PROGRESS_PAIRS = [
    [163, 191], // var_82(163) → var_58(191)
    [185, 192], // var_82(185) → var_58(192)
    [180, 193], // var_82(180) → var_58(193)
    [151, 194], // var_82(151) → var_58(194)
    [159, 195], // var_82(159) → var_58(195)
  ];

  const R = (g, n) => ((g && g.rng) ? g.rng : Elona.rng).rnd(Math.max(1, n | 0));
  const idiv = (a, b) => Math.trunc((a | 0) / (b | 0));
  const V = (g, n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);

  /** 货物重量 var_65(80) / 上限 var_65(82)（core/vehicle.js 维护） */
  function cargoWeight(g) { return V(g, 80); }
  function cargoLimit(g) { return V(g, 82); }

  /**
   * 玩家移动尝试的阻挡（343028-343043）。
   * @param {object} g   game
   * @param {boolean} isWorld 是否世界地图（var_126(6) == 1）
   * @returns {null | {reason:string}} null = 不阻挡
   */
  function blockMove(g, isWorld) {
    const p = g && g.player;
    if (!p) return null;
    // 343030-343039：压溃中（档 4）→ 无法移动，消耗 1 回合
    if ((p.get(45) | 0) >= 4) {
      return { reason: 'crushed', message: '被货物压得动弹不得！' };
    }
    // 343040-343043：世界地图 + 货物超上限两倍 → 无法移动，消耗 1 回合
    if (isWorld && cargoWeight(g) > cargoLimit(g) * 2) {
      return { reason: 'cargo', message: '货车装得太重，动不了！' };
    }
    return null;
  }

  /**
   * 世界地图成功移动一格后的里数累计（wiki：每格 4 里）。
   * 源码 248731 用负累计（var_65(180) < -300），本实现按正数累计、
   * 结算判 >= 300，行为等价（docs/17 0-Z3 登记口径差）。
   */
  function worldStep(g) {
    if (!g || !g.setV65) return 0;
    const miles = (V(g, 180) | 0) + 4;
    g.setV65(180, miles);
    return miles;
  }

  /** 总小时数（248727 同式：年*24*30*12 + 月*24*30 + 日*24 + 时） */
  function totalHours(g) {
    return V(g, 13) + V(g, 12) * 24 + V(g, 11) * 24 * 30 + V(g, 10) * 24 * 30 * 12;
  }

  /** 出发地图名（mapname(var_65(182))） */
  function mapNameOf(g, id) {
    const i = id | 0;
    if (Elona.Towns && Elona.Towns.byId) {
      const t = Elona.Towns.byId(i);
      if (t && t.name) return (Elona.Towns.townName && g) ? g.townName(t) : t.name;
    }
    if (Elona.Sites && Elona.Sites.nameOf) {
      const n = Elona.Sites.nameOf(i, 'ch') || Elona.Sites.nameOf(i);
      if (n) return n;
    }
    return '未知的土地';
  }

  function mapTypeOf(g) {
    if (Elona.Sites && Elona.Sites.kindOf) return Elona.Sites.kindOf(V(g, 20)) | 0;
    return 0;
  }

  /**
   * 换图后的出发记录（237600-237602）与 300 里旅行结算（248724-248846）。
   * 在 loadMap 尾部调用（此时 var_65(20) 已是新地图，var_65(19) 由调用方
   * 以换图前的地图 id 传入）。
   * @param {object} g game
   * @param {number} prevMapId 换图前的地图 id（var_65(19)）
   */
  function onEnterMap(g, prevMapId) {
    if (!g || !g.player) return null;
    const type = mapTypeOf(g);
    const curMapId = V(g, 20);
    // 237600-237602：进城镇 / 野外 / 自宅（或从未记录）→ 记录出发时间与地图
    if (type === 3 || type === 2 || curMapId === 7 || V(g, 181) === 0) {
      g.setV65(181, totalHours(g));
      g.setV65(182, (prevMapId === undefined || prevMapId === null) ? V(g, 19) : (prevMapId | 0));
    }
    // 248724：结算只在进城镇（类型 3）/ 自宅（20==7）/ 类型 2 时判
    if (!(type === 3 || curMapId === 7 || type === 2)) return null;
    const miles = V(g, 180) | 0;
    if (miles < 300) return null;
    const hours = totalHours(g) - V(g, 181);
    g.log(`从${mapNameOf(g, V(g, 182))}出发后，结束了 ${idiv(hours, 24)} 日 ${hours % 24} 小时的旅行。`);
    // 248751 / 248807：全队旅行技能经验
    const list = (g.charas || []).filter((c) => c && (c.get(0) | 0) === 1);
    for (const c of list) {
      skillExpSafe(g, c, 182, 5 + idiv(miles * 2, 5), 0, 1000);
      // 248779-248803：八维 + 全部已学技能
      const exp = Math.max(1, Math.min(2000,
        idiv(lvOf(c, 182), 10) + idiv(miles, 2) + idiv(lvOf(c, 14), 4) + 50));
      for (let id = 10; id <= 17; id++) skillExpSafe(g, c, id, exp, 0, 1000);
      for (const [lo, hi] of [[100, 112], [150, 191], [300, 302]]) {
        for (let id = lo; id <= hi; id++) {
          if (hasSkill(c, id)) skillExpSafe(g, c, id, exp, 0, 1000);
        }
      }
      // 248753-248776：材料获得进度 +50（仅同伴 cnt=1..15；玩家分支 248806 不含此段）
      //   源码 var_58(0,cnt)==9 的跳过已在 list 过滤；这里排除玩家本人。
      if (c !== g.player && (c.index | 0) !== 0 && (c.get(17) | 0) >= 100) {
        for (const [skillId, matField] of MATERIAL_PROGRESS_PAIRS) {
          const lv = lvOf(c, skillId);
          if (lv <= 0) continue;
          // limit(skill,0,100) + 里程 > rnd(1000) → 对应材料获得进度 +50
          if (Math.min(100, lv) + miles > R(g, 1000)) {
            c.set(matField, (c.get(matField) | 0) + 50);
          }
        }
      }
    }
    g.log(`${(g.player && g.player.name) || '你'}和同伴走了约 ${miles} 里，积累了经验。`);
    g.setV65(180, 0);                                 // 248846
    return { miles, hours };
  }

  function lvOf(c, id) {
    try { return (c.skill ? c.skill(id) : 0) | 0; } catch (e) { return 0; }
  }
  function hasSkill(c, id) {
    try { return (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(c, id) | 0) > 0 : false; }
    catch (e) { return false; }
  }
  function skillExpSafe(g, c, id, exp, divisor, teacher) {
    try {
      if (Elona.Stats && Elona.Stats.skillExp) {
        Elona.Stats.skillExp(c, id, c.index | 0, exp, divisor, teacher, g);
      }
    } catch (e) { /* 单个技能失败不阻断结算 */ }
  }

  /**
   * 玩家回合结算的货物压伤（604895-604908）。
   * 档 >= 3（超過及以上）且 rnd(20)==0 → dmghp(hpMax * (43*10/44 + 10) / 200 + 1, -6)。
   * 在 Game.endTurn 的回合周期调用后执行。
   * @returns {number} 实际伤害（0 = 未触发）
   */
  function cargoHurt(g) {
    const p = g && g.player;
    if (!p) return 0;
    if ((p.get(45) | 0) < 3) return 0;
    if (R(g, 20) !== 0) return 0;
    const w = (p.get(43) | 0), cap = (p.get(44) | 0);
    const hpMax = p.get(51) | 0;                      // var_58(51) = 最大 HP
    const dmg = idiv(hpMax * (idiv(w * 10, cap) + 10), 200) + 1;
    g.log(`${p.name || '你'}被货物压得喘不过气来！`);
    if (Elona.Battle && Elona.Battle.applyDamage) {
      // 604907：dmghp var_243, ..., -6 —— 元素 -6（无属性减免链，与 -2 同走 applyDamage）
      Elona.Battle.applyDamage(p, dmg, g, null, 0, 0);
    }
    return dmg;
  }

  /**
   * 下楼梯踏空（344614-344625）：负重 >= 3 档（超過 / 潰れ中）时
   *   `stat==0 | rnd(5 - 档位)==0` → 从楼梯滚落，受到两倍于普通压伤的伤害。
   *   源码：`dmghp var_243, var_58(51)*(var_58(43)*10/var_58(44)+10)/100+1, -7`
   *   （普通压伤 604895-604908 是 /200+1，故此处恰为两倍）。
   * @returns {number} 实际伤害（0 = 未触发）
   */
  function stairFall(g) {
    const p = g && g.player;
    if (!p) return 0;
    const tier = p.get(45) | 0;
    if (tier < 3) return 0;
    if (R(g, 5 - tier) !== 0) return 0;
    const w = p.get(43) | 0, cap = Math.max(1, p.get(44) | 0);
    const hpMax = p.get(51) | 0;
    const dmg = idiv(hpMax * (idiv(w * 10, cap) + 10), 100) + 1;
    if (g.log) g.log(`哇啊！${p.name || '你'}从楼梯上踏空了。`);
    if (Elona.Battle && Elona.Battle.applyDamage) {
      Elona.Battle.applyDamage(p, dmg, g, null, 0, 0);   // 344620：dmghp …, -7
    }
    return dmg;
  }

  /** 状态栏 / 面板用的档位名 */
  function tierName(c) {
    if (!c) return '';
    return TIER_NAMES[(c.get(45) | 0)] || '';
  }

  Elona.Travel = {
    TIER_NAMES,
    blockMove, worldStep, onEnterMap, cargoHurt, stairFall, tierName,
    cargoWeight, cargoLimit, totalHours,
  };
})(window);
