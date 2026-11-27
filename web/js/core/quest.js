'use strict';
/**
 * 委托（掲示板）系统 —— 按原版 var_434 表逐项移植
 *
 * 【源码依据】
 *   *label_4284（590658-590705）  为城镇 NPC 分配 var_434 槽位（每名 NPC 一个）
 *   *label_4286（590718-590773）  为当前地图的槽位生成/刷新委托
 *   *label_4287（590775-591122）  委托生成：全部 11 种类型与各自的数值公式
 *   *label_4285（590707-590717）  报酬计算
 *   *label_2704（286278-286510）  掲示板列表：4 条/页，Page N/M，左右键翻页
 *   *label_3063（424977-425087）  接受委托：最多 5 件未完成
 *   *label_4288（591123-591141）  每日递减 var_434(9)，归零 → 失败
 *   *label_4291（591182-591260）  失败：var_65(250+38)++、decfame(40)、部分类型追加惩罚
 *   *label_4294（591469-591626）  完成并领取报酬
 *   415663-415745                  委托人对话中的「缴纳/报告」选项
 *
 * 【var_434 字段（已确认）】
 *   0 委托人角色索引   1 地图   2 刷新/生成时刻   3 类型   4 子类型
 *   5 难度             6 报酬金 7 报酬物品类别    8 状态（0 未接 / 1 进行中 / 3 待报告）
 *   9 剩余天数（-1 = 无期限）        10 目标（配送/调达）
 *   11 物品 id         12 目标数据（地图/种族/重量/点数）
 *   13 进度            14 分类   15 配送计数
 *
 * 【类型（var_434(3)）】
 *   1001 HUNT    歼灭敌人          1002 DELIVER 配送
 *   1003 COOK    缴纳料理          1004 SUPPLY  缴纳指定物品
 *   1006 HARVEST 缴纳作物          1007 ESCORT  护送
 *   1008 CONQUER 讨伐特定怪物      1009 PARTY   派对
 *   1010 HUNTEX  歼灭特定怪物      1011 COLLECT 调达
 *   1013 TRAP    拆除陷阱
 *
 * 【已标注的偏差（当前 Web 版缺少对应子系统）】
 *   - 原版 1007/1009/1006/1013 会进入专用地图并按分钟/回合计时；这里改为在
 *     城镇/地下城内直接累计：护送 = 进入地下城，派对 = 与委托人对话举办，
 *     作物 = 向委托人缴纳食物，陷阱 = 在地下城拆除陷阱。
 *   - 1002 的配送目的地原版是另一座城镇；当前只有 vernis 有人口，改为镇内另一名 NPC。
 *   - 1001/1010 原版「清空区域」，这里用「击倒 N 只怪物」近似（N 由难度换算）。
 *   - 0-Z84：报酬改为按 *label_4294 在玩家当前格生成金币/白金币/物品；
 *     var_645/1514/1518-1520（222062-222073）分类轮盘已提取，用于 rewardItem 1..5。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const R = (g, n) => (((g && g.rng) || Elona.rng)).rnd(n);

  const MAX_ACTIVE = 5;          // 425002：未完成委托上限 5
  const PAGE_SIZE = 4;           // 286297：var_893 = 4
  const DAY_H = 24;
  /** 接受后传送到专用地图（原版 var_65(64)=13）的委托类型 */
  const QUEST_MAP_TYPES = [1001, 1006, 1008, 1009, 1010, 1013];

  const TYPE = {
    HUNT: 1001, DELIVER: 1002, COOK: 1003, SUPPLY: 1004,
    HARVEST: 1006, ESCORT: 1007, CONQUER: 1008, PARTY: 1009,
    HUNTEX: 1010, COLLECT: 1011, TRAP: 1013,
  };
  const TYPE_NAMES = {
    1001: '讨伐', 1002: '配送', 1003: '料理', 1004: '缴纳',
    1006: '收获', 1007: '护送', 1008: '讨伐', 1009: '派对',
    1010: '讨伐', 1011: '调达', 1013: '陷阱',
  };
  // 0-Z84 / start.hsp:222062-222073：var_434(7) 的 1..5 是类别轮盘索引，
  // 只有 >=10000 时才是直接物品 id（591562-591580）。
  const REWARD_CATS = {
    1: [10000, 10000, 24000, 24000, 25000, 12000, 16000, 20000, 19000, 18000, 22000, 14000, 32000, 34000], // var_645
    2: [53000, 56000, 54000],                                                                                  // var_1518
    3: [12000, 16000, 20000, 19000, 18000, 22000, 14000],                                                     // var_1519
    4: [10000, 24000, 25000],                                                                                  // var_1520
    5: [52000, 53000, 56000, 54000, 57000],                                                                    // var_1514
  };
  /** 地图名 → 原版 var_65(20) 地图编号（mapfile 11977-12110） */
  const MAP_IDS = {
    vernis: 5, kapul: 11, yowyn: 12, rogueden: 14, palmia: 15,
    noyel: 33, lumiest: 36, eirel: 50, melkawn1: 52, kurualm: 53,
    valm: 54, melugas: 55, arcbelc: 56, ludus: 57,
  };

  const DELIVERABLES = [233, 253, 571, 573, 574];

  function nowH(g) {
    if (g && g.nowHours) return g.nowHours();
    return 0;
  }
  function curDay(g) { return idiv(nowH(g), DAY_H); }
  function mapName(g) { return g && g.map ? g.map.name : null; }
  function mapId(g) {
    // 0-Z49：源码直接读 var_65(20)，不能只按地图名查静态表（地图 73/79 要排除）
    const live = (g && g.getV65) ? (g.getV65(20) | 0) : 0;
    if (live) return live;
    const n = mapName(g);
    return (n && MAP_IDS[n]) || (g && g.mapId) || 0;
  }
  /** 当前地图是不是允许掲示板/生成委托的城镇（源码 246395-246402）。
   *  var_126(6)==3 且 var_65(20) 不是 73/79，且 var_132(34,mapId)!=4；
   *  Web 版没有 var_132 表，用 Towns/MAP_IDS 白名单近似，并排除 73/79。 */
  function isQuestTown(g) {
    const name = mapName(g);
    if (!name || !MAP_IDS[name]) return false;
    const id = mapId(g);
    if (id === 73 || id === 79) return false;
    return true;
  }

  /** 当前地图危险度 —— 原版 var_65(189)；未移植时退化为玩家等级 */
  function danger(g) {
    const v = g && g.getV65 ? (g.getV65(189) | 0) : 0;
    if (v > 0) return v;
    return Math.max(1, (g && g.player ? (g.player.level | 0) : 1));
  }
  /** 名声 var_58(34) */
  function fame(g) {
    return g && g.player ? (g.player.get(34) | 0) : 0;
  }
  function playerSkill(g, id) {
    return g && g.player && g.player.skill ? (g.player.skill(id) | 0) : 0;
  }
  /** HSP roundmargin（8701-8708） */
  function roundMargin(g, v, margin) {
    if (v > margin) return v - R(g, v - margin);
    if (v < margin) return v + R(g, margin - v);
    return v;
  }

  // ---------------------------------------------------------------------------
  // 一、生成（*label_4287）
  // ---------------------------------------------------------------------------
  function nextId(g) {
    g._questSeq = (g._questSeq | 0) + 1;
    return g._questSeq;
  }

  function isEligible(npc, g) {
    if (!npc || npc === g.player) return false;
    if ((npc.get(0) | 0) !== 1) return false;
    if ((npc.index | 0) === 0) return false;
    const role = npc.get(150) | 0;
    if (role === 0 || role === 3) return false;          // 590735-590743
    if ((npc.get(27) | 0) === 23) return false;
    return true;
  }

  function eligibleNpcs(g) {
    return (g.charas || []).filter((c) => isEligible(c, g));
  }

  function randomDeliverable(g) {
    return DELIVERABLES[R(g, DELIVERABLES.length)];
  }

  /** 随机生物（1008/1010 用）—— 对应 characreate 56,0,-3,0 的选怪 */
  function randomCreature(g, level) {
    if (!Elona.CharaFactory || !Elona.CharaFactory.pick) return 0;
    return Elona.CharaFactory.pick(g, Math.max(1, level | 0), {}) | 0;
  }

  function creatureName(id) {
    if (!Elona.CharaFactory) return '怪物';
    const rec = Elona.CharaFactory.ref(id);
    return rec ? (rec.nameCh || rec.nameJp || rec.nameEn || ('#' + id)) : ('#' + id);
  }

  /**
   * 生成一条委托 —— 严格按 *label_4287 的判定顺序与公式。
   * @returns {object} 新的 var_434 记录（type=0 表示该槽位本次无委托）
   */
  function makeQuest(g, npc, id) {
    const now = nowH(g);
    const q = {
      id: id,
      clientIndex: npc.index,
      clientName: npc.name,
      map: mapName(g),
      mapId: mapId(g),
      created: now,
      refreshAt: now + R(g, 4) * DAY_H,       // var_434(2)
      type: 0,
      subtype: 0,
      difficulty: 0,
      rewardGold: 0,
      rewardItem: 0,
      status: 0,
      daysLeft: -1,
      targetClientIndex: -1,
      targetName: '',
      targetMapName: '',
      escortClientIndex: -1,
      itemId: 0,
      targetData: 0,
      targetCreature: 0,
      progress: 0,
      category: 0,
      deliverCount: 0,
      requiredLevel: 0,
      rewardFactor: 0,
      need: 0,
      lastDay: curDay(g),
      failed: false,
      mapHintDone: false,
    };
    if (R(g, 3) === 0) return q;                              // 590781-590783
    if ((q.clientIndex | 0) === 0) return q;

    // 1011 COLLECT（590787-590826）：15 选 1 的调达
    if (R(g, 14) === 0 && mapId(g) !== 77) {
      const pool = eligibleNpcs(g).filter((c) => c.index !== npc.index
        && (c.get(150) | 0) !== 0
        && ((c.get(150) | 0) === 4 || (c.get(150) | 0) === 14)
        && (c.get(9) | 0) === 0);
      if (pool.length) {
        const target = pool[R(g, pool.length)];
        let itemId = 0;
        if (Elona.ItemDB && Elona.ItemDB.create) {
          const it = Elona.ItemDB.create(g, { level: 40, fix: 2 });
          if (it) itemId = it.id;
        }
        if (itemId) {
          Object.assign(q, {
            type: TYPE.COLLECT, category: 3, subtype: 0,
            daysLeft: R(g, 3) + 2,
            difficulty: idiv(target.level | 0, 3),
            targetClientIndex: target.index, targetName: target.name,
            itemId: itemId, rewardItem: 5, rewardFactor: 60,   // 590819：var_434(7)=5
          });
        }
      }
      return finishPrice(g, q, npc);
    }

    // 1010 HUNTEX（590828-590857）：名声 30000 以上
    if (fame(g) >= 30000 && R(g, 13) === 0) {
      let diff = R(g, idiv(danger(g), 2) + 10) + R(g, idiv(fame(g), 2500) + 1);
      diff = roundMargin(g, diff, idiv(danger(g), 2));
      if (diff > 4444) diff = 4444;
      const minLv = limit(idiv(diff, 7), 5, 30);
      let cre = randomCreature(g, idiv(diff, 2));
      for (let i = 0; i < 50 && cre; i++) {
        const rec = Elona.CharaFactory.ref(cre);
        if (!rec || (rec.fields && (rec.fields['38'] | 0) >= minLv)) break;
        cre = randomCreature(g, idiv(diff, 2));
      }
      Object.assign(q, {
        difficulty: diff, created: now + (R(g, 6) + 2) * DAY_H,
        refreshAt: 0, category: 1, type: TYPE.HUNTEX, subtype: 0,
        rewardItem: 5, daysLeft: -1, rewardFactor: 140,
        targetCreature: cre, need: limit(idiv(diff, 10) + 3, 3, 12),
      });
      return finishPrice(g, q, npc);
    }

    // 1008 CONQUER（590859-590889）：名声 50000 以上
    if (fame(g) >= 50000 && R(g, 20) === 0) {
      let diff = R(g, idiv(danger(g), 2) + 10) + R(g, idiv(fame(g), 2500) + 1);
      diff = roundMargin(g, diff, idiv(danger(g), 2));
      if (diff > 4000) diff = 4000;
      const minLv = limit(idiv(diff, 4), 5, 30);
      let cre = randomCreature(g, idiv(diff, 2));
      for (let i = 0; i < 50 && cre; i++) {
        const rec = Elona.CharaFactory.ref(cre);
        if (!rec || (rec.fields && (rec.fields['38'] | 0) >= minLv)) break;
        cre = randomCreature(g, idiv(diff, 2));
      }
      Object.assign(q, {
        difficulty: diff, created: now + (R(g, 6) + 2) * DAY_H,
        refreshAt: 0, category: 8, type: TYPE.CONQUER, subtype: 0,
        rewardItem: 1, daysLeft: -1, rewardFactor: 175,
        targetCreature: cre,
      });
      return finishPrice(g, q, npc);
    }

    // 1007 ESCORT（590890-590936）：11 选 1
    if (R(g, 11) === 0 && mapId(g) !== 77 && mapId(g) !== 81) {
      const sub = R(g, 3);
      let factor;
      let days;
      let diff;
      if (sub === 0) {
        factor = 140 + R(g, 30);
        days = R(g, 8) + 6;
        diff = limit(R(g, idiv(danger(g), 2) + 10) + R(g, idiv(fame(g), 500) + 1) + 1, 1, 80);
      } else if (sub === 1) {
        factor = 130 + R(g, 30);
        days = R(g, 5) + 2;
        diff = limit(idiv(factor, 10) + 1, 1, 40);
      } else {
        factor = 80 + R(g, 30);
        days = R(g, 8) + 6;
        diff = limit(idiv(factor, 20) + 1, 1, 40);
      }
      // 1007 目的地：原版 var_1558 / var_1559 中的其他城镇（var_434(12)=地图 id）
      const curName = mapName(g);
      let dests = [];
      if (Elona.Towns && Elona.Towns.escortTargets) {
        dests = Elona.Towns.escortTargets(curName);
      }
      if (!dests.length) {
        // 0-Z23：兜底也用中文城镇名（与 towns.js 的 cn 一致），避免委托文本露英文
        dests = [
          { name: 'kapul', id: 11, label: '卡普尔港' },
          { name: 'yowyn', id: 12, label: '约温' },
          { name: 'palmia', id: 15, label: '帕尔米亚' },
        ].filter((d) => d.name !== curName);
      }
      const dest = dests[R(g, dests.length)] || dests[0];
      // 0-Z0 / world_sites.json：dest.label 是英文名（Kapul / Yowyn …），
      // 显示必须用同一张表的中文字段。targetMapName 仍保留地图文件名，
      // 供 onArriveTown 与掲示板 {map} 占位符定位；targetName 只用于显示。
      const destZh = dest.zh
        || (Elona.Towns && Elona.Towns.labelOf ? Elona.Towns.labelOf(dest) : '')
        || dest.name;
      Object.assign(q, {
        created: now + (R(g, 6) + 2) * DAY_H, refreshAt: 0,
        type: TYPE.ESCORT, category: 6, subtype: sub,
        targetData: dest.id,              // var_434(12)：目的地地图编号
        targetMapName: dest.name,
        targetName: destZh,               // 显示用：world_sites.json 的中文名
        rewardItem: 5, daysLeft: days, difficulty: diff,
        rewardFactor: factor,
      });
      return finishPrice(g, q, npc);
    }

    // 1013 TRAP（590937-590959）
    if ((R(g, 35) === 0 || (mapId(g) === 14 && R(g, 8) === 0)
      || (mapId(g) === 57 && R(g, 12) === 0))
      && mapId(g) !== 77 && mapId(g) !== 81) {
      let diff = limit(R(g, playerSkill(g, 159) + idiv(playerSkill(g, 13), 30) + 5),
        idiv(Math.floor(Math.sqrt(playerSkill(g, 159)) + 1), 2) + 5,
        idiv(fame(g), 2000) + 5);
      if (diff > 66) diff = 66;
      Object.assign(q, {
        difficulty: diff, created: now + (R(g, 6) + 2) * DAY_H, refreshAt: 0,
        type: TYPE.TRAP, category: 10, subtype: fame(g) >= 15000 ? R(g, 2) : 0,
        rewardItem: 0, daysLeft: -1, targetData: diff + R(g, 5),
        progress: 0, rewardFactor: 0,
      });
      q.refreshAt = q.created;
      return q;
    }

    // 1009 PARTY（590961-590978）
    if ((R(g, 23) === 0 || (mapId(g) === 15 && R(g, 8) === 0)
      || (mapId(g) === 56 && R(g, 2) === 0))
      && mapId(g) !== 77 && mapId(g) !== 81) {
      let diff = limit(R(g, danger(g) + idiv(playerSkill(g, 17), 10) + 10),
        Math.floor(1.5 * Math.sqrt(danger(g) + 4)) + 10,
        idiv(fame(g), 1000) + 10);
      if (diff > 995) diff = 995;
      Object.assign(q, {
        difficulty: diff, created: now + (R(g, 6) + 2) * DAY_H, refreshAt: 0,
        type: TYPE.PARTY, category: 7, subtype: 0,
        rewardItem: 0, daysLeft: -1, targetData: diff * 10 + R(g, 50),
        progress: 0, rewardFactor: 0,
      });
      q.refreshAt = q.created;
      return q;
    }

    // 1006 HARVEST（590980-590993）
    if ((R(g, 30) === 0 || (mapId(g) === 12 && R(g, 2) === 0)
      || (mapId(g) === 57 && R(g, 8) === 0) || (mapId(g) === 77 && R(g, 2) === 0))
      && mapId(g) !== 81) {
      const diff = limit(R(g, idiv(danger(g), 3) + 2), 2, 50);
      Object.assign(q, {
        difficulty: diff, created: now + (R(g, 6) + 2) * DAY_H, refreshAt: 0,
        type: TYPE.HARVEST, category: 5, subtype: 0,
        rewardItem: 5, daysLeft: -1, targetData: 15000 + diff * 2500,
        progress: 0, rewardFactor: 60 + diff * 2,
      });
      return finishPrice(g, q, npc);
    }

    // 1001 HUNT（590995-591006）
    if (R(g, 8) === 0) {
      let diff = limit(R(g, idiv(danger(g), 2) + 10) + R(g, idiv(fame(g), 500) + 1) + 1, 1, 80);
      diff = roundMargin(g, diff, idiv(danger(g), 2));
      Object.assign(q, {
        difficulty: diff, created: now + (R(g, 6) + 2) * DAY_H, refreshAt: 0,
        type: TYPE.HUNT, category: 1, subtype: 0,
        rewardItem: 1, daysLeft: -1, rewardFactor: 135,
        need: limit(idiv(diff, 5) + 3, 3, 30),
      });
      return finishPrice(g, q, npc);
    }

    // 1003 COOK（591008-591040）
    if (R(g, 6) === 0 || mapId(g) === 77) {
      if (mapId(g) !== 81) {
        const foodCat = R(g, 8) + 1;
        const lv = R(g, 7) + 3;
        let rewardItem = 5;
        if (foodCat === 4) rewardItem = 52000;
        if (foodCat === 6) rewardItem = 25000;
        if (foodCat === 1) rewardItem = 25000;
        if (foodCat === 5) rewardItem = 52000;
        if (foodCat === 7) rewardItem = 77000;
        if (foodCat === 2) rewardItem = 56000;
        if (foodCat === 3) rewardItem = 53000;
        Object.assign(q, {
          type: TYPE.COOK, category: 3, subtype: 0,
          daysLeft: R(g, 6) + 2, rewardItem: rewardItem,
          targetData: foodCat, requiredLevel: lv,
          difficulty: lv * 3, rewardFactor: 60 + lv * 3,
        });
        return finishPrice(g, q, npc);
      }
    }

    // 1004 SUPPLY（591042-591054）
    if (R(g, 5) === 0 || mapId(g) === 81) {
      const diff = limit(R(g, idiv(danger(g), 2) + 5) + 1, 1, 30);
      Object.assign(q, {
        type: TYPE.SUPPLY, category: 3, subtype: 0,
        daysLeft: R(g, 6) + 2, rewardItem: 5,
        itemId: randomDeliverable(g),
        difficulty: diff, rewardFactor: 65 + diff,
      });
      return finishPrice(g, q, npc);
    }

    // 1002 DELIVER（591056-591121）
    if (R(g, 6) === 0 || (mapId(g) === 53 && R(g, 2) === 0)) {
      const pool = eligibleNpcs(g).filter((c) => c.index !== npc.index);
      if (pool.length) {
        const dest = pool[R(g, pool.length)];
        const dup = (g.quests || []).some((x) => x !== q && x.type === TYPE.DELIVER
          && (x.status === 1 || x.status === 3) && x.targetClientIndex === dest.index);
        if (!dup) {
          const itemId = randomDeliverable(g);
          let rewardItem = 5;
          const cat = Elona.ItemDB ? Elona.ItemDB.ref(itemId, 5) : 0;
          if (cat === 54000) rewardItem = 2;
          if (cat === 77000) rewardItem = 3;
          if (cat === 64000) rewardItem = 77000;
          if (cat === 60000) rewardItem = 60000;
          const rewardFactor = 70 + R(g, 40);
          Object.assign(q, {
            type: TYPE.DELIVER, category: 2, subtype: 0,
            daysLeft: R(g, 12) + 3, rewardItem: rewardItem,
            itemId: itemId,
            targetClientIndex: dest.index, targetName: dest.name,
            difficulty: limit(idiv(rewardFactor, 20) + 1, 1, 25),
            rewardFactor: rewardFactor,
          });
        }
      }
      return finishPrice(g, q, npc);
    }

    return q;
  }

  /** 报酬（*label_4285） */
  function finishPrice(g, q, npc) {
    if (!q.type) return q;
    let gold = idiv(((q.difficulty + 3) * 100 + R(g, q.difficulty * 30 + 200) + 400)
      * (q.rewardFactor || 100), 100);
    gold = idiv(gold * 100, 100 + idiv(q.difficulty * 2, 3));
    if (q.category !== 3 && q.category !== 2) {
      const half = idiv(danger(g), 2);
      if (half < q.difficulty) {
        gold = idiv(gold * (100 + limit(idiv(q.difficulty - half, 5) * 25, 50, 200)), 100);
      }
    }
    q.rewardGold = Math.max(0, gold);
    // 刷新时刻只对未接委托有意义
    if (!q.refreshAt) q.refreshAt = q.created;
    return q;
  }

  // ---------------------------------------------------------------------------
  // 二、委托表维护
  // ---------------------------------------------------------------------------
  function syncActive(g) {
    if (!Array.isArray(g.quests)) g.quests = [];
    g.activeQuests = g.quests.filter((q) => q.status === 1 || q.status === 3);
    return g.activeQuests;
  }

  /**
   * 保证当前地图的委托槽位齐全（*label_4286）。
   * 每名符合条件的 NPC 一个槽位；未接委托在 refreshAt 到期后重新生成。
   */
  function ensure(g) {
    if (!g) return [];
    if (!Array.isArray(g.quests)) g.quests = [];
    const name = mapName(g);
    // 0-Z49 / 246395-246402：只有城镇地图才生成/刷新委托。
    // 家、洞窟、专用任务图都不张贴新委托（此前测试在家也能贴出条目）。
    if (!isQuestTown(g)) { syncActive(g); return g.quests; }
    const now = nowH(g);
    for (const npc of eligibleNpcs(g)) {
      let q = g.quests.find((x) => x.map === name && x.clientIndex === npc.index);
      if (!q) {
        q = makeQuest(g, npc, nextId(g));
        g.quests.push(q);
        continue;
      }
      if (q.map !== name) {
        if (q.status === 0) {
          const nq = makeQuest(g, npc, q.id);
          Object.assign(q, nq, { map: name, mapId: mapId(g) });
        } else {
          q.map = name;
          q.mapId = mapId(g);
        }
        continue;
      }
      if (q.status === 0 && now >= (q.refreshAt || 0)) {
        const nq = makeQuest(g, npc, q.id);
        Object.assign(q, nq);
      }
    }
    syncActive(g);
    return g.quests;
  }

  function clientAlive(g, q) {
    return (g.charas || []).some((c) => c && c.index === q.clientIndex && (c.get(0) | 0) === 1);
  }

  /** 掲示板可接取列表（*label_2704 的筛选条件） */
  function available(g) {
    ensure(g);
    // 0-Z49：非城镇地图上掲示板没有任何可接委托（286295 的 var_434(1)==var_65(20)
    // 只会在城镇里成立；测试夹具不得再在家/洞窟里贴出委托）。
    if (!isQuestTown(g)) return [];
    const name = mapName(g);
    return g.quests.filter((q) => q
      && q.type !== 0
      && q.status === 0
      && q.map === name
      && q.daysLeft !== 0
      && clientAlive(g, q));
  }

  function forClient(g, npc) {
    if (!g || !npc) return null;
    ensure(g);
    const name = mapName(g);
    return g.quests.find((q) => q.map === name && q.clientIndex === npc.index
      && (q.status === 0 || q.status === 1 || q.status === 3)) || null;
  }

  function activeQuests(g) {
    if (!Array.isArray(g.activeQuests)) syncActive(g);
    return g.activeQuests;
  }

  function activeCount(g) { return activeQuests(g).length; }

  // ---------------------------------------------------------------------------
  // 三、接受 / 完成 / 报告
  // ---------------------------------------------------------------------------
  function accept(g, id) {
    ensure(g);
    // 0-Z49 / *label_3063：接取也限定在城镇（掲示板与委托人对话都只在城镇发生）
    if (!isQuestTown(g)) return { ok: false, reason: 'not-town', message: '这里没有可以接受的委托。' };
    const q = g.quests.find((x) => x.id === id);
    if (!q || q.type === 0) return { ok: false, reason: 'no-quest', message: '委托不存在。' };
    if (q.status !== 0) return { ok: false, reason: 'accepted', message: '这份委托已经在进行中了。' };
    if (activeCount(g) >= MAX_ACTIVE) {
      return { ok: false, reason: 'busy',
        message: `未完成的委托太多了（上限 ${MAX_ACTIVE} 件），先完成一些再来吧。` };
    }
    if (q.daysLeft === 0) return { ok: false, reason: 'expired', message: '这份委托已经过期了。' };
    q.status = 1;
    q.lastDay = curDay(g);
    if (q.daysLeft === undefined) q.daysLeft = -1;
    if (q.type === TYPE.ESCORT) spawnEscortFollower(g, q);
    if (q.type === TYPE.DELIVER && q.targetClientIndex >= 0) {
      const dest = g.quests.find((x) => x.clientIndex === q.targetClientIndex);
      if (dest) dest.deliverCount = (dest.deliverCount | 0) + 1;
      // 425070-425081：接受配送委托时把配达物放进背包
      if (Elona.ItemDB && q.itemId) {
        const it = Elona.ItemDB.createItem(q.itemId, 1);
        if (it) g.player.inv.push(it);
      }
    }
    // 425065：modimp var_244, 7
    const client = (g.charas || []).find((c) => c && c.index === q.clientIndex);
    if (client && Elona.NPC && Elona.NPC.modImp) Elona.NPC.modImp(client, 7, g);
    syncActive(g);
    return { ok: true, quest: q, enterMap: QUEST_MAP_TYPES.indexOf(q.type) >= 0,
      message: `接受了 ${q.clientName} 的委托：${describe(q)}。` };
  }

  function markComplete(q) {
    if (!q) return false;
    if (q.status === 1) q.status = 3;
    return true;
  }

  /**
   * 1003 COOK 的缴纳判定 —— 415704-415713：
   *   `refitem(id,5)==57000 && f[25]/1000 == var_434(12) && f[26] == var_434(13)`
   * 源码没有「指定物品 id」，而是按食物类别 + 料理品质匹配背包里的任意料理。
   * 此前 Web 端把 COOK 当成 `itemId` 委托（itemId 恒为 0），导致该类委托永远
   * 无法完成、委托菜单也永远不出现缴纳项。
   */
  function findCookItem(g, q) {
    if (!q || !Elona.ItemDB) return null;
    const inv = (g && g.player && g.player.inv) || [];
    const cat = q.targetData | 0;
    const lv = q.requiredLevel | 0;
    for (const it of inv) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if (Elona.ItemDB.ref(it.id | 0, 5) !== 57000) continue;
      if (Math.trunc((it.f[25] | 0) / 1000) !== cat) continue;
      if ((it.f[26] | 0) !== lv) continue;
      return it;
    }
    return null;
  }

  /** 消耗指定物品实例 1 件（findCookItem 用） */
  function consumeInstance(g, it) {
    if (!it) return false;
    it.f[0] = (it.f[0] | 0) - 1;
    if ((it.f[0] | 0) > 0) return true;
    const inv = (g && g.player && g.player.inv) || [];
    const k = inv.indexOf(it);
    if (k >= 0) inv[k] = null;
    return true;
  }

  /** 料理类别中文名（FoodName 表；表未就绪时退回「料理」） */
  function cookCategoryName(q) {
    try {
      if (Elona.FoodName && Elona.FoodName.categoryName) {
        const n = Elona.FoodName.categoryName(q.targetData | 0);
        if (n) return n;
      }
    } catch (_) { /* 表未就绪 */ }
    return '料理';
  }

  function isComplete(g, q) {
    if (!q || q.type === 0) return false;
    if (q.status === 3) return true;
    switch (q.type) {
      case TYPE.COOK:
        return !!findCookItem(g, q);
      case TYPE.COLLECT:
      case TYPE.SUPPLY:
        return hasItem(g, q.itemId);
      case TYPE.DELIVER:
        return q.status === 3;
      case TYPE.HARVEST:
      case TYPE.TRAP:
      case TYPE.PARTY:
        return q.progress >= q.targetData;
      case TYPE.ESCORT:
        return q.status === 3;
      case TYPE.CONQUER:
        return q.status === 3;
      case TYPE.HUNT:
      case TYPE.HUNTEX:
        return q.progress >= q.need;
      default:
        return false;
    }
  }

  function hasItem(g, id) {
    const inv = g.player && g.player.inv ? g.player.inv : [];
    return inv.some((it) => it && it.id === id && (it.f[0] | 0) > 0);
  }
  function countItem(g, id) {
    const inv = g.player && g.player.inv ? g.player.inv : [];
    let n = 0;
    for (const it of inv) if (it && it.id === id && (it.f[0] | 0) > 0) n += it.f[0] | 0;
    return n;
  }
  function consumeItem(g, id, count) {
    const inv = g.player.inv || [];
    let need = count || 1;
    for (let i = 0; i < inv.length && need > 0; i++) {
      const it = inv[i];
      if (!it || it.id !== id || (it.f[0] | 0) <= 0) continue;
      const take = Math.min(need, it.f[0] | 0);
      it.f[0] = (it.f[0] | 0) - take;
      need -= take;
      if (it.f[0] <= 0) inv[i] = null;
    }
    return need <= 0;
  }

  /** 击倒怪物（1001/1010/1008） */
  function onKill(g, target) {
    if (!g || !target) return null;
    const species = (target.__characreate && (target.__characreate.creatureId | 0))
      || (target.get(27) | 0);
    const out = [];
    for (const q of activeQuests(g)) {
      if (q.status !== 1) continue;
      if (q.type === TYPE.CONQUER) {
        if (species && species === (q.targetCreature | 0)) {
          markComplete(q);
          out.push({ quest: q, progress: 1, need: 1, completed: true });
        }
      } else if (q.type === TYPE.HUNTEX) {
        if (species && species === (q.targetCreature | 0)) {
          q.progress = Math.min((q.progress | 0) + 1, q.need | 0);
          // 1010 与 1001 一样，源码（193766-193794）的完成条件是「场上敌人全灭」，
          // 不是数够 var_434(5)。委托地图内统一交给 QuestMap.onKill，
          // 否则 6+rnd(4) 只怪里杀满 need（3..12）就提前完成，后续敌人白杀。
          if (!g.questMap || (g.questMap.type | 0) !== TYPE.HUNTEX) {
            if (q.progress >= q.need) markComplete(q);
          }
          out.push({ quest: q, progress: q.progress, need: q.need, completed: q.status === 3 });
        }
      } else if (q.type === TYPE.HUNT) {
        q.progress = Math.min((q.progress | 0) + 1, q.need | 0);
        // 193762-193794：任务地图里的 HUNT 完成条件是「场上 var_69==-3 的敌人
        // 全灭」，不是数够 var_434(5)。完成判定与日志提示交给 QuestMap.onKill。
        if (!g.questMap || (g.questMap.type | 0) !== TYPE.HUNT) {
          if (q.progress >= q.need) markComplete(q);
        }
        out.push({ quest: q, progress: q.progress, need: q.need, completed: q.status === 3 });
      }
    }
    syncActive(g);
    return out.length ? out : null;
  }

  /** 进入地下层 —— 护送已改为专用地图（QuestMap），普通地下城不再完成任务 */
  function onEnterFloor(g, depth) {
    return null;
  }

  /** 拆除陷阱（1013）：普通陷阱 +1，特殊陷阱 +10（306015-306030 的近似） */
  function onTrapDisarmed(g, info) {
    if (!g) return null;
    const gain = (info && info.sub >= 20) ? 10 : 1;
    for (const q of activeQuests(g)) {
      if (q.status === 1 && q.type === TYPE.TRAP) {
        q.progress = (q.progress | 0) + gain;
        if (q.progress >= q.targetData) markComplete(q);
        syncActive(g);
        return { quest: q, progress: q.progress, need: q.targetData, completed: q.status === 3 };
      }
    }
    return null;
  }

  /** 缴纳物品（1002 配达 / 1003 料理 / 1004 缴纳 / 1011 调达） */
  function handOver(g, questId) {
    const q = activeQuests(g).find((x) => x.id === questId);
    if (!q) return { ok: false, reason: 'no-active', message: '没有这件委托。' };
    if (q.status !== 1) return { ok: false, reason: 'state', message: '这份委托现在无法缴纳。' };
    // 1003 料理没有固定 itemId，按「食物类别 + 料理品质」找背包里的任意料理。
    let cookItem = null;
    if (q.type === TYPE.COOK) {
      cookItem = findCookItem(g, q);
      if (!cookItem) {
        return { ok: false, reason: 'no-item',
          message: `需要 ${cookCategoryName(q)}（等级 ${q.requiredLevel}）。` };
      }
    } else if (!q.itemId || !hasItem(g, q.itemId)) {
      return { ok: false, reason: 'no-item',
        message: `需要 ${itemName(q.itemId)}。` };
    }
    // 417244-417284：源码选项 25（配達物を渡す）/ 26（缴纳）在 gosub *label_4278
    // 收走物品后**直接** `gosub *label_4294` 发报酬并清委托，不需要再选「报告委托」。
    if (q.type === TYPE.COOK) consumeInstance(g, cookItem);
    else consumeItem(g, q.itemId, 1);
    markComplete(q);
    const result = report(g, q.id, { consumed: true });
    syncActive(g);
    return {
      ok: true,
      quest: q,
      completed: true,
      report: result,
      message: result.ok ? result.message
        : (q.type === TYPE.DELIVER ? '把配达物交给了对方。'
          : (q.type === TYPE.COOK ? `缴纳了${cookCategoryName(q)}。` : `缴纳了 ${itemName(q.itemId)}。`)),
    };
  }

  /** 1006 收获：把背包里的食物按重量缴纳给委托人 */
  function harvest(g, questId) {
    const q = activeQuests(g).find((x) => x.id === questId);
    if (!q || q.type !== TYPE.HARVEST) return { ok: false, reason: 'no-quest', message: '没有收获委托。' };
    if (q.status !== 1) return { ok: false, reason: 'state', message: '这份委托现在无法缴纳。' };
    const inv = g.player.inv || [];
    let gained = 0;
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (!it || (it.f[0] | 0) <= 0) continue;
      if (!isFood(it.id)) continue;
      const unit = it.weight === undefined ? (it.f[7] | 0) : (it.weight | 0);
      const total = unit * (it.f[0] | 0);
      const remain = q.targetData - (q.progress | 0);
      if (remain <= 0) break;
      if (total <= remain) {
        gained += total;
        q.progress = (q.progress | 0) + total;
        it.f[0] = 0;
        inv[i] = null;
      } else {
        // 只取走需要的重量（按件折算）
        const needCount = unit > 0 ? Math.max(1, Math.ceil(remain / unit)) : (it.f[0] | 0);
        const take = Math.min(needCount, it.f[0] | 0);
        const add = unit * take;
        q.progress = (q.progress | 0) + Math.min(add, remain);
        gained += Math.min(add, remain);
        it.f[0] = (it.f[0] | 0) - take;
        if (it.f[0] <= 0) inv[i] = null;
      }
    }
    if (q.progress >= q.targetData) markComplete(q);
    syncActive(g);
    const base = gained > 0
      ? `缴纳了 ${gained} 重量的作物（${q.progress}/${q.targetData}）。`
      : '背包里没有可缴纳的作物。';
    return { ok: gained > 0, quest: q, gained: gained, completed: q.status === 3,
      message: base + (q.status === 3
        ? `日志已更新。回去找${q.clientName}汇报委托，领取报酬吧。` : '') };
  }

  /** 1009 派对：举办一次派对，按交涉/魅力获得分数 */
  function party(g, questId) {
    const q = activeQuests(g).find((x) => x.id === questId);
    if (!q || q.type !== TYPE.PARTY) return { ok: false, reason: 'no-quest', message: '没有派对委托。' };
    if (q.status !== 1) return { ok: false, reason: 'state', message: '这份委托现在无法举办。' };
    const score = R(g, 10 + (g.player.level | 0) * 2) + 5 + idiv(playerSkill(g, 17), 2);
    q.progress = (q.progress | 0) + score;
    if (q.progress >= q.targetData) markComplete(q);
    syncActive(g);
    return { ok: true, quest: q, gained: score, completed: q.status === 3,
      message: `派对气氛 +${score}（${q.progress}/${q.targetData}）`
        + (q.status === 3
          ? `日志已更新。回去找${q.clientName}汇报委托，领取报酬吧。` : '') };
  }

  /** 1011 调达：从目标 NPC 处取得委托物品 */
  function collect(g, questId) {
    const q = activeQuests(g).find((x) => x.id === questId);
    if (!q || q.type !== TYPE.COLLECT) return { ok: false, reason: 'no-quest', message: '没有调达委托。' };
    if (q.status !== 1) return { ok: false, reason: 'state', message: '这份委托现在无法调达。' };
    if (hasItem(g, q.itemId)) return { ok: false, reason: 'has-item', message: '你已经拿到了委托物品。' };
    if (!Elona.ItemDB) return { ok: false, reason: 'no-item', message: '物品数据未就绪。' };
    const it = Elona.ItemDB.createItem(q.itemId, 1);
    if (!it) return { ok: false, reason: 'no-item', message: '没能取得物品。' };
    g.player.inv.push(it);
    return { ok: true, quest: q, item: it,
      message: `取得了 ${itemName(q.itemId)}，把它带给委托人吧。` };
  }

  function itemName(id) {
    if (!id) return '物品';
    return Elona.ItemDB ? Elona.ItemDB.name(id) : ('item ' + id);
  }
  /**
   * 委托文本里的地名汉化 —— 数据源是 world_sites.json（经 Sites / Towns 读取）。
   * 旧存档里可能存的是地图文件名（kapul）或英文 label（Port Kapul），
   * 这里统一回查中文名，避免委托正文/护送目标出现英文城镇名。
   */
  function placeName(v) {
    if (!v) return '';
    const T = Elona.Towns;
    const low = String(v).toLowerCase();
    if (T && T.LIST) {
      const t = T.LIST.find((x) => x && (
        x.name === v || x.label === v || x.zh === v
        || String(x.name).toLowerCase() === low
        || String(x.label).toLowerCase() === low
      ));
      if (t) return T.labelOf ? T.labelOf(t) : (t.zh || t.label || t.name);
    }
    return String(v);
  }

  /** 掲示板 {map} 占位符：护送用目的地，其余用委托发布城镇（均为中文名） */
  function boardMapName(q) {
    if (!q) return '这附近';
    if (q.type === TYPE.ESCORT) return placeName(q.targetName || q.targetMapName);
    const id = q.mapId | 0;
    if (id && Elona.Sites && Elona.Sites.nameOf) {
      const n = Elona.Sites.nameOf(id, 'ch');
      if (n) return n;
    }
    return placeName(q.map) || '这附近';
  }
  function isFood(id) {
    return Elona.ItemDB ? Elona.ItemDB.ref(id, 5) === 57000 : false;
  }

  // ---------------------------------------------------------------------------
  // 1007 护送：委托人跟随玩家，抵达目的城镇后自动报告
  // ---------------------------------------------------------------------------
  function escortSlots() {
    return (Elona.Towns && Elona.Towns.ESCORT_SLOTS) || [236, 237, 238, 239, 240];
  }

  function freeEscortSlot(g) {
    for (const s of escortSlots()) {
      const c = g.charas[s];
      if (!c || (c.get(0) | 0) !== 1) return s;
    }
    return -1;
  }

  function nearSpot(g, x, y) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    const canWalk = g.map && typeof g.map.walkable === 'function';
    for (const d of dirs) {
      const nx = x + d[0], ny = y + d[1];
      if (canWalk && !g.map.walkable(nx, ny)) continue;
      const cell = canWalk && g.map.cell ? g.map.cell(nx, ny) : null;
      if (cell && cell[1] !== 0) continue;
      return { x: nx, y: ny };
    }
    return { x, y };
  }

  /** 接受护送委托时生成跟随者（原版 cbit 963 的委托人） */
  function spawnEscortFollower(g, q) {
    if (!g || !q || q.type !== TYPE.ESCORT) return null;
    const cur = g.charas[q.escortClientIndex];
    if (cur && (cur.get(0) | 0) === 1) return cur;
    if (!Elona.CharaFactory) return null;
    const client = (g.charas || []).find((c) => c && c.index === q.clientIndex) || null;
    const slot = freeEscortSlot(g);
    if (slot < 0) return null;
    const spot = nearSpot(g, g.player.x, g.player.y);
    // 0-FE：换图后原委托人 NPC 已不在场上，改用委托上缓存的物种/等级重建
    let species = q.escortSpecies | 0;
    let level = q.escortLevel | 0;
    if (client) {
      species = (client.__characreate && (client.__characreate.creatureId | 0))
        || (client.get(27) | 0) || species || 16;
      level = Math.max(1, client.level | 0);
      q.escortSpecies = species;
      q.escortLevel = level;
    }
    if (!species) species = 16;
    if (!level) level = 1;
    q.escortSpecies = species;                           // 0-FE：换图/读档后靠这两个字段重建
    q.escortLevel = level;
    let c = null;
    try {
      c = Elona.CharaFactory.create(g, species, level, spot.x, spot.y, { index: slot });
    } catch (_) { c = null; }
    if (!c) return null;
    c.set(9, 0);
    c.set(150, 3);
    c.name = q.clientName;
    c.__escortQuest = q.id;
    q.escortClientIndex = slot;
    return c;
  }

  function removeEscortFollower(g, q) {
    const c = g.charas[q.escortClientIndex];
    if (c) c.set(0, 0);
    q.escortClientIndex = -1;
    if (g.syncCharaCells) g.syncCharaCells();
  }

  /** 读档/进城后恢复跟随者 */
  function restoreEscortFollowers(g) {
    for (const q of activeQuests(g)) {
      if (q.status === 1 && q.type === TYPE.ESCORT) {
        q.escortClientIndex = -1;
        spawnEscortFollower(g, q);
      }
    }
  }

  function followToward(g, c, p) {
    if (!g.map || typeof g.map.walkable !== 'function') return false;
    const tries = [];
    const dx = p.x - c.x, dy = p.y - c.y;
    if (dx !== 0) tries.push([dx > 0 ? 1 : -1, 0]);
    if (dy !== 0) tries.push([0, dy > 0 ? 1 : -1]);
    tries.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    for (const [sx, sy] of tries) {
      const nx = c.x + sx, ny = c.y + sy;
      if (!g.map || !g.map.walkable(nx, ny)) continue;
      const cell = g.map.cell(nx, ny);
      if (cell && cell[1] !== 0) continue;
      const old = g.map.cell(c.x, c.y);
      if (old) old[1] = 0;
      c.x = nx; c.y = ny;
      const nc = g.map.cell(nx, ny);
      if (nc) nc[1] = c.index + 1;
      return true;
    }
    return false;
  }

  /** 每回合：护送者跟随；若死亡则失败 */
  function tickEscort(g) {
    const fails = [];
    for (const q of activeQuests(g)) {
      if (q.status !== 1 || q.type !== TYPE.ESCORT) continue;
      if ((q.escortClientIndex | 0) < 0) { spawnEscortFollower(g, q); continue; }
      const c = g.charas[q.escortClientIndex];
      // 0-FE：换图（野外遭遇 / 委托地图 / 世界地图）后角色槽位会丢，重新生成即可；
      //        只有「槽位里的人已经死了」才算护送失败。
      if (!c) { q.escortClientIndex = -1; spawnEscortFollower(g, q); continue; }
      if ((c.get(0) | 0) !== 1) { fails.push(q); continue; }
      if (Math.max(Math.abs(c.x - g.player.x), Math.abs(c.y - g.player.y)) > 1) {
        followToward(g, c, g.player);
      }
    }
    for (const q of fails) {
      failQuest(g, q);
      removeEscortFollower(g, q);
    }
    syncActive(g);
    return fails.length ? fails : null;
  }

  /** 抵达目的城镇：自动完成并报告（原版 event 16） */
  function onArriveTown(g, townName) {
    const out = [];
    for (const q of activeQuests(g)) {
      if (q.status !== 1 || q.type !== TYPE.ESCORT) continue;
      if (q.targetMapName !== townName) continue;
      markComplete(q);
      const rr = report(g, q.id);
      removeEscortFollower(g, q);
      out.push({ quest: q, report: rr });
    }
    syncActive(g);
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------------------
  // 四、期限 / 失败
  // ---------------------------------------------------------------------------
  function failQuest(g, q) {
    const type = q.type;
    const client = q.clientName;
    // var_65(250+38)++：委托失败数
    if (g.setV65) g.setV65(288, (g.getV65(288) | 0) + 1);
    // decfame 40（591258）
    if (g.player) {
      const f = g.player.get(34) | 0;
      const loss = idiv(f, 40) + 5 + R(g, idiv(idiv(f, 40) + 5, 2)) - R(g, idiv(idiv(f, 40) + 5, 2));
      g.player.set(34, Math.max(0, f - loss));
    }
    if (type === TYPE.DELIVER && q.targetClientIndex >= 0) {
      const dest = g.quests.find((x) => x.clientIndex === q.targetClientIndex);
      if (dest) dest.deliverCount = Math.max(0, (dest.deliverCount | 0) - 1);
      if (g.player) g.player.set(49, (g.player.get(49) | 0) - 20);   // modkarma -20
    }
    if (type === TYPE.ESCORT && g.player) {
      g.player.set(49, (g.player.get(49) | 0) - 10);                 // modkarma -10
      removeEscortFollower(g, q);
    }
    q.failed = true;
    q.status = 0;
    q.type = 0;
    q.progress = 0;
    q.refreshAt = nowH(g) + R(g, 4) * DAY_H;
    if (g.clearQuestMapSnapshot) g.clearQuestMapSnapshot(q.id);
    return { failed: true, quest: q, type: type, clientName: client };
  }

  /** 每回合调用；只在跨日时递减天数（*label_4288） */
  function tick(g) {
    if (!g) return null;
    ensure(g);
    const day = curDay(g);
    const failures = [];
    for (const q of g.quests) {
      if (!q) continue;
      if (q.status === 1) {
        if (q.lastDay === undefined) q.lastDay = day;
        while (day > q.lastDay) {
          q.lastDay++;
          if (q.daysLeft >= 0) {
            q.daysLeft--;
            if (q.daysLeft <= 0) {
              failures.push(failQuest(g, q));
              break;
            }
          }
        }
      }
    }
    syncActive(g);
    return failures.length ? failures : null;
  }

  // ---------------------------------------------------------------------------
  // 五、报告 / 报酬（*label_4294）
  // ---------------------------------------------------------------------------
  /** 0-Z84 / 591481：itemcreate -1, id, var_58(1,0), var_58(2,0), n —— 落在玩家当前格 */
  function dropGround(g, it) {
    if (!it) return null;
    it.f[5] = g.player.x;
    it.f[6] = g.player.y;
    if (g.groundItems) g.groundItems.push(it);
    if (g.refreshGroundCell) g.refreshGroundCell(it.f[5], it.f[6]);
    return it;
  }
  function dropReward(g, id, count) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    return dropGround(g, Elona.ItemDB.createItem(id | 0, Math.max(1, count | 0)));
  }
  function dropGenerated(g, opt) {
    if (!Elona.ItemDB || !Elona.ItemDB.create) return null;
    return dropGround(g, Elona.ItemDB.create(g, opt));
  }

  function report(g, id, opts) {
    ensure(g);
    const q = g.quests.find((x) => x.id === id);
    if (!q || (q.status !== 1 && q.status !== 3)) {
      return { ok: false, reason: 'no-active', message: '没有这件进行中的委托。' };
    }
    if (q.status !== 3 && isComplete(g, q)) markComplete(q);
    if (q.status !== 3) {
      return { ok: false, reason: 'incomplete', message: `委托尚未完成：${progressText(g, q)}。` };
    }
    // 缴纳型：报告时收走物品。handOver()（选项 25/26）已在调用前收走，
    // 用 opts.consumed 避免同格的另一件同名物品被误扣。
    if (!(opts && opts.consumed)) {
      if (q.type === TYPE.COOK) {
        const dish = findCookItem(g, q);
        if (dish) consumeInstance(g, dish);
      } else if (q.type === TYPE.SUPPLY || q.type === TYPE.COLLECT) {
        if (hasItem(g, q.itemId)) consumeItem(g, q.itemId, 1);
      }
    }
    // 0-Z84 / *label_4294：金币、白金币、物品都 itemcreate 到玩家当前格，
    // 不再直接改 player 的货币字段（591479-591493）。
    const player = g.player;
    const gold = q.rewardGold | 0;
    if (gold > 0) dropReward(g, 54, gold);
    let plat = limit(R(g, 1 + idiv(fame(g), 10000)), 1, 3);
    if (q.type === TYPE.CONQUER || q.type === TYPE.HUNTEX) plat += 2;
    if (q.type === TYPE.PARTY) plat = 1;               // 591483-591484
    dropReward(g, 55, plat);

    // 591494-591547：各委托类型的特殊报酬（var_434(12)=targetData, (13)=progress）
    const target = q.targetData | 0;
    const done = q.progress | 0;
    if (q.type === TYPE.PARTY && idiv(target * 150, 100) < done) {
      dropReward(g, 724, 1 + idiv(done, 10));          // 591497
    }
    if (q.type === TYPE.TRAP) {
      const can = dropReward(g, 1130, 1);              // 591502
      if (can) { can.f[26] = limit(1 + idiv(done, 5), 1, 30); can.f[17] = 0; }
      if (idiv(target * 125, 100) <= done || q.subtype === 1) dropReward(g, 1041, 1); // 591507
      const n = limit(1 + idiv(target, 15), 1, 5);
      for (let i = 0; i < n; i++) dropGenerated(g, { level: done, fix: 2, itemId: 687 }); // 591511
    }
    if (q.type === TYPE.HARVEST) {
      if (idiv(target * 125, 100) < done) dropReward(g, 1041, 1); // 591517
      const skill = (player.skill && player.skill(180)) || 0;
      const v = R(g, limit(idiv(skill, 2), 0, 30) + 80);         // 591519
      if (v >= 90) dropReward(g, 419, R(g, 2) === 0 ? 3 : 2);
      else if (v >= 70) {
        if (R(g, 2) === 0) dropReward(g, 420, 3);
        else dropReward(g, 554, 4);
      } else if (v >= 50) dropReward(g, 553, 4);
      else if (R(g, 2) === 0) dropReward(g, 418, 5);
      else dropReward(g, 417, 5);
    }

    // 591548-591583：var_434(7) 是类别轮盘索引 1..5，>=10000 才是直接物品 id
    if (q.rewardItem) {
      let n = R(g, R(g, 4) + 1) + 1;
      if (q.type === TYPE.CONQUER || q.type === TYPE.HUNTEX) n += 2;
      const level = idiv((q.difficulty | 0) + idiv(danger(g), 2), 2) + 1;
      for (let i = 0; i < n; i++) {
        let fix = 2;
        if (R(g, 2)) { fix = 3; if (R(g, 12) === 0) fix = 4; }   // 591554-591560
        const fixlv = (Elona.ItemDB && Elona.ItemDB.calcFixLv)
          ? Elona.ItemDB.calcFixLv(fix, g) : fix;
        if (q.rewardItem >= 10000) {
          dropGenerated(g, { level: level, fix: fixlv, t638: q.rewardItem });
        } else {
          const pool = REWARD_CATS[q.rewardItem] || REWARD_CATS[5];
          dropGenerated(g, { level: level, fix: fixlv, t638: pool[R(g, pool.length)] });
        }
      }
    }
    // 名声：calcfame(difficulty*3+10)
    let fameGain = idiv((q.difficulty * 3 + 10) * 100,
      100 + idiv(idiv(fame(g), 100) * idiv(fame(g), 100), 2500));
    if (fameGain < 5) fameGain = R(g, 5) + 1;
    player.set(34, (player.get(34) | 0) + fameGain);
    if (g.setV65) g.setV65(74, fameGain);
    // var_65(250+25)++ 达成数
    if (g.setV65) g.setV65(275, (g.getV65(275) | 0) + 1);
    if (q.type === TYPE.DELIVER && q.targetClientIndex >= 0) {
      const dest = g.quests.find((x) => x.clientIndex === q.targetClientIndex);
      if (dest) dest.deliverCount = Math.max(0, (dest.deliverCount | 0) - 1);
    }
    q.status = 0;
    q.type = 0;
    q.progress = 0;
    q.refreshAt = nowH(g) + R(g, 4) * DAY_H;
    if (g.clearQuestMapSnapshot) g.clearQuestMapSnapshot(q.id);
    syncActive(g);
    return { ok: true, quest: q, gold: gold, platinum: plat, fame: fameGain,
      message: `${q.clientName} 的委托完成了！获得 ${gold} gold、${plat} 白金、${fameGain} 名声。有什么东西滚到了脚边。` };
  }

  // 0-Z84：报酬不再塞背包，统一落到玩家当前格（*label_4294）
  function addRewardItem(g, it) { return dropGround(g, it); }

  // ---------------------------------------------------------------------------
  // 六、描述 / UI 辅助
  // ---------------------------------------------------------------------------
  function progressText(g, q) {
    switch (q.type) {
      case TYPE.HUNT:
      case TYPE.HUNTEX:
        return `已击倒 ${q.progress}/${q.need} 只`;
      case TYPE.CONQUER:
        return q.status === 3 ? '已讨伐目标' : `讨伐 ${creatureName(q.targetCreature)}`;
      case TYPE.DELIVER:
        return q.status === 3 ? '已送达目的地' : `把 ${itemName(q.itemId)} 交给 ${placeName(q.targetName)}`;
      case TYPE.COOK:
        return `缴纳${cookCategoryName(q)}（需要等级 ${q.requiredLevel}）`;
      case TYPE.SUPPLY:
        return `缴纳 ${itemName(q.itemId)}`;
      case TYPE.HARVEST:
        return `缴纳作物 ${q.progress}/${q.targetData}`;
      case TYPE.ESCORT:
        return q.status === 3 ? '已护送到达' : `护送到 ${placeName(q.targetName || q.targetMapName) || '目的地'}`;
      case TYPE.PARTY:
        return `派对分数 ${q.progress}/${q.targetData}`;
      case TYPE.COLLECT:
        return `从 ${placeName(q.targetName)} 处取得 ${itemName(q.itemId)}`;
      case TYPE.TRAP:
        return `拆除陷阱 ${q.progress}/${q.targetData} 点`;
      default:
        return '未知委托';
    }
  }

  function describe(q) {
    if (!q) return '';
    switch (q.type) {
      case TYPE.HUNT:
        return `歼灭怪物（${q.need} 只）`;
      case TYPE.HUNTEX:
        return `歼灭 ${creatureName(q.targetCreature)}（${q.need} 只）`;
      case TYPE.CONQUER:
        return `讨伐 ${creatureName(q.targetCreature)}`;
      case TYPE.DELIVER:
        return `把 ${itemName(q.itemId)} 配送给 ${placeName(q.targetName)}`;
      case TYPE.COOK:
        return `缴纳${cookCategoryName(q)}（等级 ${q.requiredLevel}）`;
      case TYPE.SUPPLY:
        return `缴纳 ${itemName(q.itemId)}`;
      case TYPE.HARVEST:
        return `缴纳作物（重量 ${q.targetData}）`;
      case TYPE.ESCORT:
        return `护送 ${q.clientName} 到 ${placeName(q.targetName || q.targetMapName) || '目的地'}`;
      case TYPE.PARTY:
        return `获得 ${q.targetData} 点派对分数`;
      case TYPE.COLLECT:
        return `从 ${placeName(q.targetName)} 处调达 ${itemName(q.itemId)}`;
      case TYPE.TRAP:
        return `拆除陷阱（${q.targetData} 点）`;
      default:
        return '无委托';
    }
  }

  /** 原版 ★ 数 = var_434(5)/5+1（286413） */
  function stars(q) {
    if (!q) return '';
    const n = limit(idiv(q.difficulty | 0, 5) + 1, 1, 10);
    return n <= 5 ? '★'.repeat(n) : ('★×' + n);
  }

  function daysText(q) {
    if (q.daysLeft < 0) return '即時';
    return `${q.daysLeft} 日`;
  }

  function rewardText(q) {
    if (!q) return '';
    let s = `${q.rewardGold | 0} gold`;
    if (q.rewardItem) s += ' + 物品';
    return s;
  }

  /**
   * 掲示板条目的描述正文（源码 *label_0273 + board.txt 模板 + *label_0274 占位符）。
   * 旧版只有按类型现编的一两句话；这里改为从 board.json 抽一条完整叙事模板，
   * 填入 {reward}/{ref}/{map}/{client}/{objective}/{you}/{me} 等源码占位符。
   * 抽取序号由委托 id 决定，保证同一条委托重绘时文字不变（原版随机只抽一次）。
   */
  function boardEntry(g, q) {
    if (!q) return null;
    const J = Elona.Journal;
    if (!J || !J.boardLine || typeof J.questKey !== 'function') return null;
    if (!J.board) return null;                       // board.txt 尚未加载
    const key = J.questKey(g, q);
    if (!key) return null;
    const seed = (q.id | 0) + (q.clientIndex | 0) * 7;
    const hit = J.boardLine(key, 'ch', g, seed)
      || J.boardLine(key, 'en', g, seed)
      || J.boardLine(key, 'jp', g, seed);
    if (!hit) return null;
    return { key: key, name: hit.name, body: fillBoardTokens(hit.body, g, q) };
  }

  /** 源码 22185-22280 的 {xxx} 替换表 */
  function fillBoardTokens(body, g, q) {
    const who = (g && g.player && g.player.name) || '你';
    const ctx = {
      client: q.clientName || '委托人',
      map: boardMapName(q),
      ref: boardRef(q),
      you: '你', me: '我',
      npc: placeName(q.targetName) || '目标人物',
      player: who, aka: who,
      reward: `${q.rewardGold | 0} 金币${q.rewardItem ? '和物品' : ''}`,
      objective: describe(q),
      deadline: daysText(q),
    };
    return String(body || '').replace(/\{([^}]+)\}/g, (m, k) => (
      Object.prototype.hasOwnProperty.call(ctx, k) ? String(ctx[k]) : ''
    ));
  }

  /** var_121(10)：模板里的 {ref}（22017-22123） */
  function boardRef(q) {
    switch (q.type | 0) {
      case TYPE.HARVEST: return `${q.targetData | 0}`;
      case TYPE.TRAP:
      case TYPE.PARTY: return `${q.targetData | 0}`;
      case TYPE.CONQUER: return `${Math.floor((q.difficulty | 0) * 10 / 6)}`;
      case TYPE.HUNTEX: return `${Math.floor((q.difficulty | 0) * 3 / 2)}`;
      case TYPE.DELIVER:
      case TYPE.COLLECT:
      case TYPE.SUPPLY: return itemName(q.itemId);
      default: return `${q.need | 0}`;
    }
  }

  /** 掲示板条目的标题（源码 var_121(3)，来自 board.txt 的 "名称:正文"） */
  function boardName(g, q) {
    const e = boardEntry(g, q);
    return e ? e.name : describe(q);
  }

  /**
   * 委托正文。mode=0 掲示板（var_428=0），mode=1 委托人对话（var_428=1，
   * 22125-22131 追加「有件事想拜托你 / 期限 / 怎么样？」）。
   */
  function boardTalkText(g, q, mode) {
    const e = boardEntry(g, q);
    let s = e ? e.body : '';
    if (!s) {
      // board.txt 未加载时退回逐类型简报，保证 UI 不会空白
      const who = q.clientName || '委托人';
      const rw = `${q.rewardGold | 0} 金币`;
      s = mode ? `${who}有件事想拜托你：${describe(q)}。报酬 ${rw}。`
        : `${who}：${describe(q)}。报酬 ${rw}。`;
    }
    if (mode && q.daysLeft !== -1) {
      s += `期限还剩 ${q.daysLeft | 0} 天。`;
    }
    if (mode) s += '愿意接受吗？';
    return s;
  }

  function questText(q, g) {
    return boardTalkText(g, q, 0);
  }

  /**
   * 委托人菜单追加项（对应 415663-415745）。
   * 【0-BT 确认】`tradecheck`（365562，唯一调用点 415491）的「委托取货 NPC 菜单加
   * 交换项（动作 20）」由下方 DELIVER/COLLECT 分支等价覆盖（q.targetClientIndex
   * 对应 var_434(10,q)==NPC、城镇判定由委托生成时保证），不再单移植。
   */
  function npcServices(g, npc) {
    if (!g || !npc) return [];
    ensure(g);
    const out = [];
    const own = forClient(g, npc);
    if (own) {
      if (own.status === 3) {
        out.push({ id: 'quest-report', label: '报告委托', questId: own.id });
      } else if (own.status === 1) {
        if (isComplete(g, own)) out.push({ id: 'quest-report', label: '报告委托', questId: own.id });
        else out.push({ id: 'quest-info', label: '询问委托', questId: own.id });
        if (QUEST_MAP_TYPES.indexOf(own.type) >= 0) {
          out.push({ id: 'quest-enter', label: '前往委托地点', questId: own.id });
        }
        if (own.type === TYPE.HARVEST) out.push({ id: 'quest-harvest', label: '缴纳作物', questId: own.id });
        if (own.type === TYPE.PARTY) out.push({ id: 'quest-party', label: '举办派对', questId: own.id });
        if (own.type === TYPE.COOK) {
          if (findCookItem(g, own)) {
            out.push({ id: 'quest-deliver',
              label: `缴纳${cookCategoryName(own)}（等级 ${own.requiredLevel}）`,
              questId: own.id });
          }
        } else if (own.type === TYPE.SUPPLY) {
          if (hasItem(g, own.itemId)) {
            out.push({ id: 'quest-deliver', label: `缴纳 ${itemName(own.itemId)}`, questId: own.id });
          }
        }
      } else if (own.status === 0 && own.type !== 0) {
        out.push({ id: 'quest-accept', label: '听取委托', questId: own.id });
      }
    }
    // 1002 配送目的地
    for (const q of activeQuests(g)) {
      if (q.type === TYPE.DELIVER && q.status === 1
        && q.targetClientIndex === npc.index && hasItem(g, q.itemId)) {
        out.push({ id: 'quest-deliver', label: `交付 ${itemName(q.itemId)}`, questId: q.id });
      }
      if (q.type === TYPE.COLLECT && q.status === 1
        && q.targetClientIndex === npc.index && !hasItem(g, q.itemId)) {
        out.push({ id: 'quest-collect', label: `调达 ${itemName(q.itemId)}`, questId: q.id });
      }
    }
    return out;
  }

  Elona.Quest = {
    TYPE, TYPE_NAMES, MAX_ACTIVE, PAGE_SIZE, QUEST_MAP_TYPES, isQuestTown,
    makeQuest, generate: ensure, ensure, available, forClient, activeQuests, activeCount,
    syncActive,
    accept, report, tick, isComplete, markComplete, hasItem, countItem, consumeItem,
    findCookItem, cookCategoryName,
    fail: failQuest,
    onKill, onEnterFloor, onTrapDisarmed, handOver, harvest, party, collect,
    spawnEscortFollower, restoreEscortFollowers, tickEscort, onArriveTown,
    describe, progressText, stars, daysText, rewardText, questText, itemName, placeName, boardMapName,
    boardEntry, boardName, boardTalkText,
    npcServices, nowH, curDay,
  };
})(window);
