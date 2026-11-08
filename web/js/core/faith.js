'use strict';
/**
 * 信仰（Faith）—— `*label_2606` ~ `*label_2615`（272104-273222）
 *
 * 覆盖的源码段：
 *   272009-272065  #deffunc modpiety          恩惠值增加 + 1500/2500/4000 阶段推进
 *   272066-272103  *label_2605                 NPC 随机信仰（按种族/物种指定）
 *   272104-272115  *label_2606                 神名表（9 位）
 *   272116-272289  *label_2607                 信仰对技能成长的被动加成（feats.json 的 godBonus）
 *   272290-272343  *label_2608                 祭坛画面的神说明
 *   272344-272611  *label_2609                 改宗 / 初次信仰菜单（含神罚 + 九神之印）
 *   272612-272653  *label_2612                 改宗后的状态重置
 *   272654-272724  *label_2613                 祈祷（阈值、神降临、奖励）
 *   272725-273023  *label_2613（续）           全回复、阶段奖励：神仆 / 秘宝 / 神器 / 神降临
 *   273024-273203  *label_2614                 供奉（尸体重量、喜好品、夺取祭坛、失败受罚）
 *   273204-273222  *label_2615                 夺取失败的神罚（1114 / 622 / 1106）
 *   603913-603933  Advance_hour 的每小时充能与衰减
 *   342452-342470  在自家祭坛上放水 → 祝福的水
 *
 * 字段：
 *   var_58(61) 信仰神 0..8（0 = 无之艾斯 / 无信仰）
 *   var_58(62) 恩惠值（上限 = 信仰技能 × 100）
 *   var_58(63) 祈祷充能 0..1000
 *   var_65(807) 信仰奖励阶段（偶数 = 已领取，奇数 = 待领取）
 *
 * 【约定】`idiv` 对应 HSP 的 `/`（向零截断），`mod` 对应 `\`。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const mod = (a, b) => (b === 0 ? 0 : (a % b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // ---------------------------------------------------------------- 字段
  const F_GOD = 61;
  const F_PIETY = 62;
  const F_CHARGE = 63;
  const F_SKILL_FAITH = 181;

  const V_STAGE = 807;          // var_65(807)
  const V_SUMMONED = 549;       // var_65(250+299)：本月已请神
  const V_RESERVED = 822;       // var_65(822)：被拒绝/暂存的神仆数
  const V_NO_DECAY = 187;       // var_65(187)：装备附魔 59「信仰不衰减」

  const ITEM_SEAL = 971;        // 九神之印
  const ITEM_MAP = 621;         // 宝の地図
  const ITEM_RELIC_GENERIC = 672; // 秘宝（伊兹帕罗特/艾赫卡托尔/奥帕托斯/朱亚用）
  const ITEM_ETHER_ANTIDOTE = 559; // 以太抗体药（宝玉已拿过时的代替品）
  const ITEM_WATER = 516;

  const BUFF_PUNISH = 13;       // 天罚
  const BUFF_HOLY_VEIL = 10;    // 圣光加护

  /**
   * 九位神。字段全部来自 *label_2606 / 272784-272962 / 272972-273023 / 379xxx。
   *   servant   神仆的 NPC id（characreate 56, x）
   *   relic     第二阶段奖励（秘宝 / 宝玉）的物品 id；0 表示用 672 + relicMark
   *   relicMark 672 的 var_99(25) 标记（165/163/164/166）
   *   relic2    额外的秘宝（朱亚同时拿 681 与 672）
   *   artifact  第三阶段奖励（神赐武器）
   *   artCount  var_65(250 + N) —— 该神器的领取次数（第 2 次换成宝图）
   *   orb       光玉的物品 id（与神对话、恩惠 ≥ 4000 时给）
   *   orbFlag   var_65(250 + N) —— 光玉已领取标记
   *   npc       神降临时的 NPC id
   */
  const GODS = [
    {
      id: 0, name: '无之艾斯', en: 'Eyth of Infidel', short: '无信仰',
      offering: '—', servant: 0, relic: 0, artifact: 0, orb: 0, npc: 0,
      passive: '无畏无赖：对神性角色的伤害 +40%',
    },
    {
      id: 1, name: '机械之玛尼', en: 'Mani of Machine', short: '玛尼',
      offering: '尸体 / 枪械 / 机械', servant: 262,
      relic: 818, artifact: 674, artCount: 530, orb: 823, orbFlag: 489, npc: 342,
      passive: '精密攻击：造成的物理伤害 +20%',
    },
    {
      id: 2, name: '风之露露薇', en: 'Lulwy of Wind', short: '露露薇',
      offering: '尸体 / 弓 / 箭矢', servant: 263,
      relic: 680, artifact: 673, artCount: 526, orb: 819, orbFlag: 485, npc: 306,
      passive: '露露薇附体：消耗 SP 短时间内大幅加速',
    },
    {
      id: 3, name: '元素之伊兹帕罗特', en: 'Itzpalt of Element', short: '伊兹帕罗特',
      offering: '尸体 / 魔杖', servant: 264,
      relic: ITEM_RELIC_GENERIC, relicMark: 165, artifact: 676, artCount: 533, orb: 829, orbFlag: 492, npc: 484,
      passive: '魔力吸收：从周围的空气中吸取魔力',
    },
    {
      id: 4, name: '幸运之艾赫卡托尔', en: 'Ehekatl of Luck', short: '艾赫卡托尔',
      offering: '尸体 / 鱼', servant: 260,
      relic: ITEM_RELIC_GENERIC, relicMark: 163, artifact: 678, artCount: 527, orb: 820, orbFlag: 486, npc: 331,
      passive: '艾赫卡托尔流魔术：咏唱消耗在 0.1~1.1 倍间浮动',
    },
    {
      id: 5, name: '大地之奥帕托斯', en: 'Opatos of Earth', short: '奥帕托斯',
      offering: '尸体 / 矿石', servant: 265,
      relic: ITEM_RELIC_GENERIC, relicMark: 164, artifact: 679, artCount: 528, orb: 821, orbFlag: 487, npc: 338,
      passive: '奥帕托斯之壳：受到的一切伤害 −10%',
    },
    {
      id: 6, name: '治愈之朱亚', en: 'Jure of Healing', short: '朱亚',
      offering: '尸体 / 花', servant: 266,
      relic: 681, relic2: ITEM_RELIC_GENERIC, relic2Mark: 166,
      artifact: 677, artCount: 531, orb: 824, orbFlag: 490, npc: 359,
      passive: '朱亚的祈祷：回复自己失去的体力',
    },
    {
      id: 7, name: '收获之库米罗米', en: 'Kumiromi of Harvest', short: '库米罗米',
      offering: '尸体 / 蔬菜', servant: 261,
      relic: 682, artifact: 675, artCount: 529, orb: 822, orbFlag: 488, npc: 339,
      passive: '无限活性：每回合自动回复体力',
    },
    {
      id: 8, name: '财富之雅卡泰克特', en: 'Yacatect of Wealth', short: '雅卡泰克特',
      offering: '尸体 / 首饰 / 戒指', servant: 354,
      relic: 797, artifact: 796, artCount: 532, orb: 828, orbFlag: 491, npc: 482,
      passive: '全部收集：掉落判定增加',
    },
  ];

  function godOf(id) { return GODS[id | 0] || GODS[0]; }
  function nameOf(id, lang) {
    const g0 = godOf(id);
    return lang === 'en' ? g0.en : g0.name;
  }

  // ---------------------------------------------------------------- 小工具
  function rnd(g, n) {
    if (n <= 0) return 0;
    if (g && g.rng && g.rng.rnd) return g.rng.rnd(n) | 0;
    if (Elona.rng && Elona.rng.rnd) return Elona.rng.rnd(n) | 0;
    return 0;
  }
  function getV(g, n) { return (g && g.getV65) ? (g.getV65(n) | 0) : 0; }
  function setV(g, n, v) { if (g && g.setV65) g.setV65(n, v | 0); }
  /** var_65(20)：当前地图 id（与 RandomEvent 一致） */
  function mapIdOf(g) { return getV(g, 20); }
  /** var_65(22)：地图内的子编号（var_65(20)==76 & var_65(22)==179 的神域判定用） */
  function subMapOf(g) { return getV(g, 22); }
  function faithSkill(c) { return c && c.skill ? (c.skill(F_SKILL_FAITH) | 0) : 0; }
  function pietyCap(c) { return faithSkill(c) * 100; }   // 272055

  /** 祭坛：refitem(id,9) == 60002 的地面物品（item_find 60002） */
  function altarAt(g, x, y) {
    if (Elona.MapFeat && Elona.MapFeat.altarAt) return Elona.MapFeat.altarAt(g, x, y);
    if (!g || !Array.isArray(g.groundItems)) return null;
    for (const it of g.groundItems) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if (x !== undefined && (it.f[5] !== x || it.f[6] !== y)) continue;
      if (Elona.ItemDB && Elona.ItemDB.ref(it.id, 9) === 60002) return it;
    }
    return null;
  }

  /** 地面生成（`itemcreate -1, id` 的等价） */
  function dropItem(g, c, id, n) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    const it = Elona.ItemDB.createItem(id | 0, n || 1);
    if (!it) return null;
    it.f[0] = n || 1;
    it.f[5] = c ? (c.x | 0) : 0;
    it.f[6] = c ? (c.y | 0) : 0;
    it.f[21] = -1;
    if (g && Array.isArray(g.groundItems)) g.groundItems.push(it);
    if (g && g.refreshGroundCell && c) g.refreshGroundCell(c.x, c.y);
    return it;
  }

  /** 背包里有没有（含地面） */
  function ownsItem(g, c, id) {
    const has = (arr) => Array.isArray(arr) && arr.some(
      (it) => it && (it.id | 0) === (id | 0) && (it.f[0] | 0) > 0);
    if (has(c && c.inv)) return true;
    if (has(g && g.groundItems)) return true;
    return !!(g && g.faithObtained && g.faithObtained[id | 0]);
  }
  function markObtained(g, id) {
    if (!g) return;
    if (!g.faithObtained) g.faithObtained = Object.create(null);
    g.faithObtained[id | 0] = 1;
  }

  function recalc(c, g) {
    if (Elona.Stats && Elona.Stats.recalcStats && c) Elona.Stats.recalcStats(c, g);
  }

  /** 天罚（buff 13）：`var_396 = 622; var_578 = 10000` → calcbuff 里 var_79 = 强度 */
  function punish(g, c) {
    if (!c) return { ok: false };
    if (Elona.Status && Elona.Status.addbuff) {
      Elona.Status.addbuff(g, c, BUFF_PUNISH, 10000, 10000);
      recalc(c, g);
      return { ok: true, buff: BUFF_PUNISH, power: 10000, turns: 10000 };
    }
    return { ok: false };
  }

  // ---------------------------------------------------------------- modpiety
  /**
   * modpiety（272009-272065）。
   * 先把「恩惠已到阶段上限」的阶段号推进一格（并给出提示），再按上限判定，
   * 最后按地图 35（诺耶尔？）的 1/10 折算写入。
   * @returns {{ok:boolean, stage?:number, bumped?:boolean, message?:string}}
   */
  const BUMP_MSG = '现在向神祈祷，也许会得到特别的东西！';

  function modPiety(g, c, amount) {
    if (!c) return { ok: false, messages: [] };
    const stage = getV(g, V_STAGE);
    let bumped = false;
    const caps = { 4: 4000, 2: 2500, 0: 1500 };   // v807 → 需要的恩惠
    if (caps[stage] !== undefined && (c.get(F_PIETY) | 0) >= caps[stage]) {
      setV(g, V_STAGE, stage + 1);
      bumped = true;
    }
    const messages = bumped ? [BUMP_MSG] : [];
    if (pietyCap(c) < (c.get(F_PIETY) | 0)) {                 // 272055
      messages.push('你的信仰已经高到不能再高了。');
      return { ok: false, reason: 'capped', bumped, messages, message: messages[messages.length - 1] };
    }
    const mapId = mapIdOf(g);
    c.set(F_PIETY, (c.get(F_PIETY) | 0) + idiv(amount | 0, 1 + (mapId === 35 ? 9 : 0)));
    return {
      ok: true, bumped, messages,
      message: bumped ? BUMP_MSG : null,
      stage: getV(g, V_STAGE),
    };
  }

  // ---------------------------------------------------------------- NPC 信仰
  /**
   * *label_2605（272066-272103）：NPC 的随机信仰。
   * 在「第一次和这个 NPC 说话」时调用（365651）——不是创建时。
   * 部分物种固定信仰某位神（神仆、神域 NPC 等），其余在 0..8 里随机；
   * 抽到 0（无之艾斯）就打 cbit 990，以后不再重抽。
   */
  const SPECIES_GOD = {
    262: 1, 342: 1, 358: 1, 382: 1,      // 玛尼系
    263: 2, 306: 2, 356: 2, 639: 2,      // 露露薇系
    264: 3, 484: 3, 483: 3, 624: 3,      // 伊兹帕罗特系
    260: 4, 331: 4, 336: 4,              // 艾赫卡托尔系
    265: 5, 338: 5, 357: 5, 231: 5,      // 奥帕托斯系
    266: 6, 359: 6, 360: 6, 347: 6,      // 朱亚系
    261: 7, 339: 7, 355: 7, 637: 7,      // 库米罗米系
    354: 8, 482: 8, 481: 8,              // 雅卡泰克特系
    252: 0, 640: 0,
  };

  function assignNpcFaith(g, c) {
    if (!c) return null;
    if ((c.index | 0) === 0) return null;                    // 玩家跳过
    if ((c.get(F_GOD) | 0) !== 0) return null;
    if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 990)) return null;
    let god = rnd(g, 9);
    const sp = c.get(27) | 0;
    if (SPECIES_GOD[sp] !== undefined) god = SPECIES_GOD[sp];
    c.set(F_GOD, god);
    if (god === 0 && Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, 990, 1);
    return god;
  }

  // ---------------------------------------------------------------- 改宗
  /**
   * 改宗 / 初次信仰（272573-272653）。
   *   · 没有天罚时先在地上放一枚九神之印（272582-272586）
   *   · 本来就有信仰 → 旧神激怒 + 神罚（272587-272603）
   *   · 写新神、重置恩惠/充能/阶段/特殊能力（272605-272620）
   */
  function convert(g, c, god) {
    const prev = c.get(F_GOD) | 0;
    const out = {
      ok: true, god: god | 0, prev, messages: [], enraged: false,
      seal: false, punished: false,
    };
    if (Elona.Status && Elona.Status.findbuff && Elona.Status.findbuff(c, BUFF_PUNISH) === -1) {
      dropItem(g, c, ITEM_SEAL, 1);
      out.seal = true;
      out.messages.push('你得到了「九神之印」。');
    }
    if (prev !== 0) {
      out.enraged = true;
      out.messages.push(`${nameOf(prev)} 震怒了。`);
      punish(g, c);
      out.punished = true;
      out.messages.push('你受到了天罚 —— 防御、魔防与速度都下降了。');
    }
    c.set(F_GOD, god | 0);
    resetAfterConvert(g, c, god | 0);
    out.messages.push(god === 0
      ? '你现在是一个无信仰者了。'
      : `你现在是 ${nameOf(god)} 的信徒了！`);
    return out;
  }

  /** *label_2612（272612-272653）：改宗后的重置 */
  function resetAfterConvert(g, c, god) {
    setV(g, 282, getV(g, 282) + 1);          // var_65(250+32)++
    c.set(F_PIETY, 0);
    c.set(F_CHARGE, 500);
    setV(g, V_STAGE, 0);
    if (Elona.Feat && Elona.Feat.setFlag) {
      Elona.Feat.setFlag(c, 23, 0);          // 623 ジュアの祈り
      Elona.Feat.setFlag(c, 24, 0);          // 624 魔力の吸収
      Elona.Feat.setFlag(c, 25, 0);          // 625 ルルウィの憑依
      if (god === 3) Elona.Feat.setFlag(c, 24, 1);
      if (god === 6) Elona.Feat.setFlag(c, 23, 1);
      if (god === 2) Elona.Feat.setFlag(c, 25, 1);
    }
    setV(g, V_SUMMONED, 1);
  }

  // ---------------------------------------------------------------- 祈祷
  /** label_2974（340772-340794）：HP/MP/SP 全回复 + 清异常（不动 debuff） */
  function fullRestore(c) {
    const clear = [445, 250, 251, 254, 253, 252, 263, 256, 255, 257, 258, 267, 268, 412];
    for (const f of clear) c.set(f, 0);
    if ((c.get(269) | 0) > 1) c.set(269, 1);
    c.set(50, c.get(51) | 0);      // HP
    c.set(55, c.get(56) | 0);      // MP
    c.set(52, c.get(53) | 0);      // SP
    return { hp: c.get(50) | 0, mp: c.get(55) | 0, sp: c.get(52) | 0 };
  }

  /**
   * 祈祷（272654-273023）。
   * 条件：恩惠 ≥ 200 且充能 ≥ 1000；效果 = 全回复 + 圣光加护 200，充能清零，
   * 恩惠 ×85%，然后若阶段号为奇数则领奖（神仆/秘宝/神器）并 +1。
   */
  function pray(g, c) {
    const god = c.get(F_GOD) | 0;
    if (god === 0) {
      return { ok: false, reason: 'no-faith', message: `你并不信仰任何神，只是试着祈祷了一下。` };
    }
    const piety = c.get(F_PIETY) | 0;
    const charge = c.get(F_CHARGE) | 0;
    if (piety < 200 || charge < 1000) {
      return { ok: false, reason: 'indifferent', god, piety, charge,
        message: `${nameOf(god)} 对你漠不关心。` };
    }
    // 272694-272713：特殊地图（76-179 的神域 / 剧情推进到 845..899 时神无暇）
    if (mapIdOf(g) === 76 && subMapOf(g) === 179) {
      const flag = getV(g, 252);
      if (flag < 845) {
        return { ok: false, reason: 'unreachable', message: `从这里似乎传达不到神那里……。` };
      }
      if (flag >= 845 && flag < 900) {
        return { ok: false, reason: 'busy', message: `${nameOf(god)} 现在好像也腾不出手……。` };
      }
    }

    // 顺序与源码略有出入：源码是「1120 全回复 → 451 圣光加护」，
    // 但本项目的 buff 生效要靠 recalc 重算，重算会把刚补满的 HP 按新上限裁一刀，
    // 所以这里先加 buff 并重算，再做全回复 —— 结果状态与源码一致。
    if (Elona.Status && Elona.Status.addbuff) {
      Elona.Status.addbuff(g, c, BUFF_HOLY_VEIL, 200, 55);    // 451：15 + 200/5
      recalc(c, g);
    }
    const healed = fullRestore(c);
    c.set(F_CHARGE, 0);
    c.set(F_PIETY, idiv(piety * 85, 100));

    const out = {
      ok: true, god, prayed: true, healed,
      piety: c.get(F_PIETY) | 0, charge: 0,
      messages: [`你对 ${nameOf(god)} 祈祷了。`],
      reward: null,
    };
    const stage = getV(g, V_STAGE);
    if (mod(stage, 2) === 1) {                                 // 272729
      out.reward = giveReward(g, c, god, stage);
      out.messages.push(...(out.reward.messages || []));
      setV(g, V_STAGE, stage + 1);                             // 272970
      out.stage = stage + 1;
    }
    const summon = trySummonGod(g, c, god);
    if (summon) {
      out.summoned = summon;
      out.messages.push(summon.message);
    }
    return out;
  }

  /** 272731-272969：按阶段发放奖励 */
  function giveReward(g, c, god, stage) {
    const out = { stage, messages: [], ok: true };
    if (stage === 1) {
      const r = giveServant(g, c, god);
      out.kind = 'servant';
      out.servant = r;
      out.messages.push(...(r.messages || []));
      return out;
    }
    if (stage === 3) {
      const r = giveRelic(g, c, god);
      out.kind = 'relic';
      out.items = r.items;
      out.messages.push(...(r.messages || []));
      return out;
    }
    if (stage === 5) {
      const r = giveArtifact(g, c, god);
      out.kind = 'artifact';
      out.items = r.items;
      out.messages.push(...(r.messages || []));
      return out;
    }
    out.kind = 'none';
    return out;
  }

  /**
   * 272731-272853：神仆（`characreate 56, 60, -3, 0` → `var_581 = 56` → `gosub *label_4274`）
   *
   * 【为什么走宠物系统】源码最后一步是 *label_4274（589937-590160），那是**通用的
   * 「加入同伴」流程**：get_freeally() 判上限 → 搬进空槽 → 归一化关系字段。
   * 神仆只是「生成后立刻 join」的 NPC，和捕获/支配/邀请入伙共用同一条链路，
   * 所以这里调 Party.joinChara（宠物系统），不再自己造队伍槽。
   *
   * 【上限】两道闸门，272736-272790：
   *   ① `var_400 + var_65(822) >= var_82(181, 0) / 10` —— 信仰技能/10（+ 暂存数）
   *   ② `get_freeally() == 0` —— 魅力决定的同伴携带上限
   * 神仆的识别是 `var_63(2) == "servant"`，由 race_class.json 的 servant 种族 ops 写入
   * （monster.js 把它映射到 chara.raceName），所以统计交给 Party.servants(g)。
   *
   * 等级：源码 `characreate 56, 60, -3, 0` 的 -3 表示「不指定等级覆盖」（var_1023/1024 = -1），
   * 等级走 creature 表的基础值（神仆都是 8 级起），不用玩家等级推算。
   */
  function giveServant(g, c, god) {
    const gd = godOf(god);
    const out = { ok: false, messages: [] };
    if (!gd.servant) { out.reason = 'no-servant'; return out; }
    const have = (Elona.Party && Elona.Party.servants)
      ? Elona.Party.servants(g)
      : countServants(g);
    const cap = idiv(faithSkill(c), 10);
    if (have + getV(g, V_RESERVED) >= cap) {
      out.reason = 'servant-limit';
      out.messages.push('以现在的信仰技能，已经不能再收神之使徒为同伴了。');
      return out;
    }
    if (Elona.Party && Elona.Party.freeAlly && Elona.Party.freeAlly(g) === 0) {
      // 272783-272788：同伴已满 → 赠礼无法领取（原版随后询问是否放弃，这里直接告知）
      out.reason = 'party-full';
      out.messages.push('同伴已经满了，没能收到神的赠礼。');
      return out;
    }
    let npc = null;
    if (Elona.CharaFactory && Elona.CharaFactory.create) {
      // 地图等级（var_65(22)）作为生成等级；地图没有等级时退回玩家等级
      const mapLv = getV(g, 22) | 0;
      const lv = Math.max(1, mapLv || ((g.player && g.player.level) | 0) || 1);
      npc = Elona.CharaFactory.create(g, gd.servant, lv, c.x, c.y, {});
    }
    if (!npc) { out.reason = 'no-chara'; out.messages.push('神之使徒没有出现。'); return out; }
    // raceName 已由种族 ops 写成 "servant"；alias 只做兼容兜底，不覆盖名字/显示名
    if (!npc.raceName) npc.raceName = 'servant';
    if (Elona.Party && Elona.Party.joinChara) {
      const j = Elona.Party.joinChara(g, npc);
      if (j && j.ok === false) { out.reason = j.reason; out.messages.push(j.message); return out; }
      out.slot = j && j.slot;
      out.message = j && j.message;
    }
    out.ok = true;
    out.npc = npc;
    out.messages.push(servantLine(god));
    return out;
  }

  /**
   * 已带神仆数的本地回退 —— Party.servants（宠物系统）不可用时使用。
   * 判定与 272739 一致：`var_63(2, x) == "servant"`，本项目映射到 raceName。
   */
  function countServants(g) {
    let n = 0;
    const charas = (g && g.charas) || [];
    for (let i = 1; i < 16; i++) {
      const m = charas[i];
      if (!m || (m.get(0) | 0) === 0) continue;
      if (m.raceName === 'servant' || m.alias === 'servant') n++;
    }
    return n;
  }

  function servantLine(god) {
    const lines = {
      1: '这个机器人似乎硬得吓人。',
      2: '这位黑天使在加速时好像能发挥惊人的力量。',
      3: '这个放逐者好像能连续射出箭矢魔法。',
      4: '被这只猫舔过的装备，会得到艾赫卡托尔的祝福。',
      5: '这位骑士就算让她拿相当重的东西也不会抱怨。',
      6: '这位防卫者能用圣手治疗受到致命伤的同伴，每次睡眠后可以再用一次。',
      7: '这位妖精饭后会吐出种子，睡一觉之后才能再吐一次。',
      8: '这只鹅吃饱了就会下白金币，睡一觉之后才能再下。',
    };
    return lines[god] || '神之使徒成为了你的同伴。';
  }

  /** 272855-272903：秘宝 / 宝玉 */
  function giveRelic(g, c, god) {
    const gd = godOf(god);
    const items = [];
    const messages = [];
    const push = (id, mark) => {
      if (!id) return;
      // var_498(1, id)：宝玉拿过就换成以太抗体药
      if (id !== ITEM_RELIC_GENERIC && ownsItem(g, c, id)) {
        dropItem(g, c, ITEM_ETHER_ANTIDOTE, 1);
        items.push(ITEM_ETHER_ANTIDOTE);
        messages.push('已经拿过的宝玉换成了一瓶以太抗体药。');
        return;
      }
      const it = dropItem(g, c, id, 1);
      if (it && mark) it.f[25] = mark | 0;
      items.push(id);
      markObtained(g, id);
    };
    push(gd.relic, gd.relicMark);
    if (gd.relic2) push(gd.relic2, gd.relic2Mark);      // 朱亚：681 + 672(166)
    messages.push('有什么东西滚到了脚边。');
    return { items, messages };
  }

  /** 272904-272968：神赐武器（重复获得时换成宝の地図） */
  function giveArtifact(g, c, god) {
    const gd = godOf(god);
    const items = [];
    const messages = [];
    if (!gd.artifact) return { items, messages: ['神没有任何表示。'], duplicate: false };
    let id = gd.artifact;
    if (gd.artCount) {
      setV(g, gd.artCount, getV(g, gd.artCount) + 1);
      if (getV(g, gd.artCount) >= 2) id = ITEM_MAP;
    }
    dropItem(g, c, id, 1);
    items.push(id);
    markObtained(g, id);
    messages.push(id === ITEM_MAP
      ? '已经拿过这件神器了，脚边多了一张宝の地図。'
      : '有什么东西滚到了脚边。');
    return { items, messages, duplicate: id === ITEM_MAP };
  }

  /**
   * 272972-273023：神降临。
   * 11 月、众神的休战地（map 20）、阶段 ≥ 3、且本月还没请过神。
   */
  function trySummonGod(g, c, god) {
    if (!g.getV65) return null;
    if ((g.getV65(11) | 0) !== 11) return null;
    if (mapIdOf(g) !== 20) return null;
    if (god === 0) return null;
    if (getV(g, V_STAGE) < 3) return null;
    if (getV(g, V_SUMMONED) !== 0) return null;
    const gd = godOf(god);
    if (!gd.npc) return null;
    setV(g, V_SUMMONED, gd.npc);
    let npc = null;
    if (Elona.CharaFactory && Elona.CharaFactory.create) {
      npc = Elona.CharaFactory.create(g, gd.npc, Math.max(1, (g.player && g.player.level) | 0), c.x, c.y, {});
    }
    if (npc) npc.set(197, 30);       // var_58(197) = 30
    return { npc: gd.npc, message: '你的祈祷把神召唤来了！' };
  }

  // ---------------------------------------------------------------- 供奉
  /** 273061-273075：供奉价值 */
  function offerValue(it) {
    if (!it) return 0;
    let val = 25;
    if ((it.id | 0) === 204) {                     // 死体
      val = limit(idiv(it.f[7] | 0, 200), 1, 50);
      if ((it.f[27] | 0) < 0) val = 1;             // 腐烂
    }
    if ((it.id | 0) === 902 || (it.id | 0) === 1264) val = 60;
    return val;
  }

  /**
   * 供奉（273025-273203）。
   * @param {object} g
   * @param {object} c 玩家
   * @param {number} idx 背包下标
   * @returns {object}
   */
  function offer(g, c, idx) {
    const it = c.inv && c.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item' };
    const altar = altarAt(g, c.x, c.y);
    if (!altar) return { ok: false, reason: 'no-altar' };
    const faith = c.get(F_GOD) | 0;
    if (faith === 0) {
      return { ok: false, reason: 'no-faith', message: '你并不信仰神，只是试着供奉了一下。' };
    }

    const val = offerValue(it);
    const altarGod = altar.f[25] | 0;
    const out = { ok: true, value: val, god: faith, name: nameOf(faith), messages: [] };

    if (altarGod !== faith) {
      // 273076-273130：夺取祭坛
      const win = altarGod === 0 || rnd(g, 17) <= val;
      out.contested = true;
      out.altarGod = altarGod;
      if (win) {
        const r = modPiety(g, c, val * 5);
        c.set(F_CHARGE, (c.get(F_CHARGE) | 0) + val * 30);
        altar.f[25] = faith;
        out.takenOver = true;
        out.bumped = !!r.bumped;
        out.messages.push(altarGod === 0
          ? `异世界之中，${nameOf(faith)} 主张了这座空白祭坛的权利。`
          : `奇异的雾出现了，${nameOf(faith)} 与 ${nameOf(altarGod)} 的幻影相互争斗。`);
        out.messages.push(`${nameOf(faith)} 支配了祭坛。`);
        for (const m of (r.messages || [])) out.messages.push(m);
      } else {
        const p = punishContest(g, c);
        out.failed = true;
        out.punished = true;
        out.messages.push(`异样的雾出现了，${nameOf(altarGod)} 守住了祭坛。`);
        out.messages.push(...(p.messages || []));
      }
    } else {
      // 273132-273200：同神供奉
      const r = modPiety(g, c, val);
      c.set(F_CHARGE, (c.get(F_CHARGE) | 0) + val * 7);
      out.offered = true;
      out.bumped = !!r.bumped;
      out.messages.push(offerLine(g, c, it, val, faith));
      for (const m of (r.messages || [])) out.messages.push(m);
    }

    it.f[0] = 0;                       // 273202：removeitem
    if (g && g.refreshGroundCell) g.refreshGroundCell(c.x, c.y);
    return out;
  }

  function offerLine(g, c, it, val, god) {
    const nm = itemName(it);
    if (val >= 60) return `${nm} 耀眼地闪了一下就消失了。`;
    if (val >= 15) return `${nm} 闪闪发光地消失了。`;
    if (val >= 5) return `${nm} 一瞬间闪了一下就消失了。`;
    return `${nm} 消失了。`;
  }

  function itemName(it) {
    if (Elona.ItemDB && Elona.ItemDB.name) {
      try { return Elona.ItemDB.name(it, 'jp') || ('item ' + it.id); } catch (e) { /* noop */ }
    }
    return '物品 ' + it.id;
  }

  /** *label_2615（273204-273222）：夺取祭坛失败的神罚 */
  function punishContest(g, c) {
    const messages = [];
    const S = Elona.Spell;
    if (S && S.dispatchEffect) {
      S.dispatchEffect(g, c, 1114, c, 500);      // 呪いの言葉
      if (rnd(g, 2)) S.dispatchEffect(g, c, 622, c, 250);
      if (rnd(g, 2)) S.dispatchEffect(g, c, 1106, c, 100);
    } else {
      if (rnd(g, 2)) punish(g, c);
    }
    messages.push('祭坛拒绝了你的供奉，你受到了神的责罚。');
    return { messages };
  }

  // ---------------------------------------------------------------- 每小时
  /**
   * Advance_hour（603913-603933）：
   *   大地图（var_126(6) == 1）：1/40 概率恩惠 −1，充能 +4
   *   其它地图：1/5 概率恩惠 −1，充能 +32
   * 装备附魔 59（var_65(187)）时恩惠不衰减。
   */
  function tickHour(g, opts) {
    const sleeping = !!(opts && opts.sleeping);
    if (sleeping) return null;
    const p = g && g.player;
    if (!p) return null;
    const wild = mapKind(g) === 1;
    let decay = 0;
    if (getV(g, V_NO_DECAY) === 0) {
      if (wild ? rnd(g, 40) === 0 : rnd(g, 5) === 0) {
        p.set(F_PIETY, (p.get(F_PIETY) | 0) - 1);
        decay = 1;
      }
    }
    p.set(F_CHARGE, (p.get(F_CHARGE) | 0) + (wild ? 4 : 32));
    if ((p.get(F_PIETY) | 0) < 0) p.set(F_PIETY, 0);
    return { wild, decay, charge: p.get(F_CHARGE) | 0, piety: p.get(F_PIETY) | 0 };
  }

  /** var_126(6)：0 普通地图 / 1 大地图 / 3 城市 / 5 野外 */
  function mapKind(g) {
    if (Elona.RandomEvent && Elona.RandomEvent.mapKind) {
      try { return Elona.RandomEvent.mapKind(g) | 0; } catch (e) { /* noop */ }
    }
    const id = mapIdOf(g);
    const known = { 4: 1, 47: 1, 70: 1, 54: 3, 7: 5 };
    return known[id] || 0;
  }

  // ---------------------------------------------------------------- 水
  /**
   * 342452-342470：把水（516）放在自家祭坛上 → 祝福的水（f[17] = 1）。
   * @returns {boolean} 是否发生了祝福
   */
  function blessWater(g, c, it) {
    if (!it || (it.id | 0) !== ITEM_WATER) return false;
    if ((it.f[17] | 0) === 1) return false;
    const altar = altarAt(g, it.f[5], it.f[6]);
    if (!altar) return false;
    if ((altar.f[25] | 0) !== (c.get(F_GOD) | 0)) return false;
    it.f[17] = 1;
    return true;
  }

  // ---------------------------------------------------------------- 信仰卷轴
  /**
   * 信仰の巻物（效果 1107，320932-320995）。
   *   · 目标是别人 → 什么也不发生
   *   · 没有信仰 → 什么也不发生
   *   · 诅咒（var_2362 <= -1）→「你的神对你的信仰产生了怀疑」+ 信仰技能 −1000
   *   · 正常 → 充能 +500、恩惠 +75（modpiety）、信仰经验 +1000（祝福 +1750）
   * @returns {object}
   */
  function useScroll(g, c, it) {
    const out = { ok: true, messages: [] };
    if (!c) return { ok: false, reason: 'no-target' };
    if ((c.get(F_GOD) | 0) === 0) {
      out.messages.push('什么也没有发生……');
      return out;
    }
    const curse = it ? (it.f[17] | 0) : 0;
    if (curse <= -1) {
      skillExp(g, c, F_SKILL_FAITH, -1000);
      out.messages.push('你的神对你的信仰产生了怀疑。');
      out.cursed = true;
      return out;
    }
    out.messages.push(`你感受到了 ${nameOf(c.get(F_GOD))} 温暖的目光。`);
    c.set(F_CHARGE, (c.get(F_CHARGE) | 0) + 500);
    const mp = modPiety(g, c, 75);
    out.messages.push(...(mp.messages || []));
    skillExp(g, c, F_SKILL_FAITH, 1000 + (curse >= 1 ? 750 : 0));
    out.charge = c.get(F_CHARGE) | 0;
    out.piety = c.get(F_PIETY) | 0;
    return out;
  }

  /** var_82(id) 的经验（skillexp <id>, <c>, <exp>） */
  function skillExp(g, c, id, exp) {
    if (!Elona.Stats || !Elona.Stats.skillExp) return;
    Elona.Stats.skillExp(c, id, c.index | 0, exp, 0, 0, g);
  }

  // ---------------------------------------------------------------- 光玉
  /**
   * 378792 / 379146 / ... ：和神对话时，恩惠 ≥ 4000 且没拿过 → 送光玉（只一次）。
   * @returns {object|null}
   */
  function lightOrb(g, c, god) {
    const gd = godOf(god);
    if (!gd.orb) return null;
    if ((c.get(F_GOD) | 0) !== (god | 0)) return null;
    if ((c.get(F_PIETY) | 0) < 4000) return null;
    if (getV(g, gd.orbFlag) !== 0) return null;
    setV(g, gd.orbFlag, 1000);
    dropItem(g, c, gd.orb, 1);
    markObtained(g, gd.orb);
    return { ok: true, item: gd.orb, message: '神递给你一件东西 ——「这是你应得的。」' };
  }

  // ---------------------------------------------------------------- 入口
  /** 祭坛面前的四个分支（label_2976 / 2609 / 2613 / 2614） */
  function altarScene(g, c) {
    const altar = altarAt(g, c.x, c.y);
    if (!altar) return { kind: 'none', reason: 'no-altar', message: '这里没有祭坛。' };
    const altarGod = altar.f[25] | 0;
    const faith = c.get(F_GOD) | 0;
    return {
      kind: faith === altarGod ? 'pray' : 'menu',
      altar, altarGod, faith,
      canConvert: faith === 0 || altarGod !== faith,
      godName: nameOf(altarGod),
    };
  }

  const Faith = {
    GODS, F_GOD, F_PIETY, F_CHARGE, F_SKILL_FAITH,
    V_STAGE, V_SUMMONED, V_RESERVED, V_NO_DECAY,
    ITEM_SEAL, ITEM_MAP, ITEM_WATER, ITEM_ETHER_ANTIDOTE,
    BUFF_PUNISH, BUFF_HOLY_VEIL,
    godOf, name: nameOf, altarAt, altarScene, assignNpcFaith, SPECIES_GOD,
    pietyOf: (c) => (c.get(F_PIETY) | 0),
    chargeOf: (c) => (c.get(F_CHARGE) | 0),
    capOf: pietyCap,
    stageOf: (g) => getV(g, V_STAGE),
    offeringOf: (god) => godOf(god).offering,
    modPiety, convert, resetAfterConvert, pray, fullRestore, punish, punishContest,
    giveReward, giveServant, giveRelic, giveArtifact, giveServantLine: servantLine,
    trySummonGod, offer, offerValue, tickHour, mapKind, blessWater, lightOrb, useScroll,
    dropItem, ownsItem, _internals: { idiv, mod, limit, rnd, getV, setV },
  };

  Elona.Faith = Faith;
})(typeof window !== 'undefined' ? window : globalThis);
