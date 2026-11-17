'use strict';
/**
 * 生育系统（Su 扩展器 / 生命核心 / 遗传 / 胚胎 / 出生 / 育儿）—— core/birth.js
 *
 * 【源码依据 hsp/start.hsp（原版 1.64，CP932）】
 *   351256-351375  效果 131/132 注射 Su 扩展器（131 靠 var_1303 贯穿到 132），
 *                  1254(X)→var_58(213) 女核心，1253(Y)→var_58(187) 男核心，
 *                  阶段 var_58(42)=-1000000，寄生 cbit978 清除，var_58(430)=受体种族。
 *                  （注射本体在 core/itemfx_use.js 的 eff132，本模块提供后续链路。）
 *   201765-201862  #deffunc gain_iden 遗传物质积累（阶段 1）：
 *                  仅在 -1000000 < var_58(42) <= -2000000 外（即 == -1000000 档）生效，
 *                  取供体最高基础抗性（50 魔抗优先，其次 51..59，最后 60），
 *                  进度 -= limit(最高抗性/100 + quality, 5, 20) * 10000；
 *                  每降一整档把 var_1191（抗性 id）写进 var_58(42) 的百/个位；
 *                  var_58(430,受体)=var_58(27,供体)；<= -1500000 再减 500000 → 阶段 1 完成。
 *   226805-226831  eatstatus 里阶段 2（妊娠）进食推进：
 *                  -2000000 < var_58(42) <= -12000000 时
 *                  var_58(42) -= limit(nutrition/1000, 1, 5) * 100000；
 *                  进度 = (var_58(42)+2000000)/-100000；<= -12000000 → evadd 93（出生）。
 *   609072-609205  效果 93 出生事件：
 *                  var_2853 = 受体种族（受体 0 时取 var_58(430) 供体种族），
 *                  var_2854 = var_58(430) 最后一个供体的种族；
 *                  var_58(42) = -var_58(42)/10000；cbit1051；
 *                  循环 20 次，按 187(儿子)/213(女儿) 核心数：
 *                    characreate 56, var_2854（临时槽，提供遗传参数）
 *                    + characreate -1, var_2853（正式子嗣，玩家坐标）
 *                    子嗣 59=-5 / 21=当前年 / 25=6 / 8=性别 / 13=-1 /
 *                    名 "son of X"/"daughter of X"（《》包裹）/
 *                    cbit1034 + (受体 0 或无物种时 cbit1050) /
 *                    继承 207/208/209/212/215-219/220-224 共 15 项 /
 *                    chara_vanquish 56 / 核心数-- / *label_4274 入队；
 *                  收尾 42/430/193=0；最后 characreate -1,690（白鹳）在玩家脚下。
 *   330810-330851  效果 843 直接输血：dmgcon(源,9) + healcon(目标,9,差额)
 *                  + gain_iden(源,目标,5)。
 *
 *  wiki「生育系统」词条为线索，具体实现一律以 start.hsp 为准。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const Birth = {};

  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
  const rnd = (g, n) => ((g && g.rng && typeof g.rng.rnd === 'function')
    ? g.rng.rnd(Math.max(1, n | 0)) : 0);
  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);
  const S = (c, n) => (c && typeof c.skill === 'function' ? (c.skill(n) | 0) : 0);
  const cb = (c, bit) => (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, bit) | 0) : 0;
  const cbmod = (c, bit, on) => { if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit, on ? 1 : 0); };
  const sorg = (c, id) => (Elona.Resist && Elona.Resist.sorg) ? (Elona.Resist.sorg(c, id) | 0) : S(c, id);
  const log = (g, s) => { if (g && typeof g.log === 'function') g.log(String(s)); };
  function nameOf(g, c) {
    if (!c) return '某人';
    if ((c.index | 0) === 0) return '你';
    if (typeof c.name === 'function') return c.name('zh') || c.name('en') || '某人';
    return c.name || '某人';
  }
  const raceOf = (c) => G(c, 27);

  // 阶段常量（var_58(42)）
  const PHASE1 = -1000000;     // 阶段 1 起点：已注入核心，等待遗传物质
  const PHASE1_DONE = -1500000; // 阶段 1 完成线
  const PHASE2 = -2000000;     // 阶段 2 起点：胚胎，等待进食
  const BIRTH = -12000000;     // 出生线

  /**
   * 201770-201795：取供体最高的一项基础抗性，返回 { value, id }。
   * 顺序：先 60（魔抗/介质）→ 50 → 51..59，仅当严格大于当前最大值时替换；
   * 最后再用 60 `>=` 复核一次（源码 201833-201835 的重复判定）。
   */
  function bestResist(donor) {
    let val = sorg(donor, 60), id = 60;
    for (let n = 50; n <= 59; n++) {
      const v = sorg(donor, n);
      if (v > val) { val = v; id = n; }
    }
    if (sorg(donor, 60) >= val) { val = sorg(donor, 60); id = 60; }
    return { value: val, id };
  }

  /**
   * gain_iden（201765-201862）：把一份遗传物质注入受体。
   * @param donor   供体角色（var_1014）
   * @param receiver 受体角色（var_1015）
   * @param quality  遗传物质品质（var_1016，如输血=5 / 吸血之牙=5 / 贪食之牙=7）
   * @returns {{applied:boolean, progress:number, phase1Done:boolean}}
   */
  function gainIden(g, donor, receiver, quality) {
    if (!receiver) return { applied: false, progress: 0, phase1Done: false };
    const cur = G(receiver, 42);
    // 仅阶段 1：var_58(42) <= -1000000 且 > -2000000
    if (!(cur <= PHASE1 && cur > PHASE2)) {
      return { applied: false, progress: 0, phase1Done: false };
    }
    const best = bestResist(donor);
    let st = cur - limit(idiv(best.value, 100) + (quality | 0), 5, 20) * 10000;
    // 201822-201828：每跨过一整档（万位归零）把抗性 id 写进百位；
    //   百位也归零则写进个位。这里按源码的余数判定等价处理。
    if (idiv(st, 10000) === 0) st -= best.id * 100;
    else if (idiv(st, 100) === 0) st -= best.id;
    receiver.set(42, st);
    if (donor && (G(donor, 0) === 1 || (donor.index | 0) >= 0)) {
      receiver.set(430, raceOf(donor));
    } else {
      receiver.set(430, 0);
    }
    log(g, `${nameOf(g, receiver)}获得了${nameOf(g, donor)}的遗传因子。`);
    const progress = idiv(st + 1000000, -10000) + 50;
    let phase1Done = false;
    if (st > PHASE1_DONE) {
      log(g, `[阶段 1 进度 ${progress} %]`);
    } else {
      receiver.set(42, st - 500000);          // 201849：完成后再 -500000 进入阶段 2
      phase1Done = true;
      log(g, '[生存能力扩展！] 阶段 1 完成。此后需要通过进食来培养。');
    }
    return { applied: true, progress, phase1Done, resistId: best.id, resistValue: best.value };
  }

  /** 是否处于阶段 2（妊娠） */
  function inPhase2(c) {
    const v = G(c, 42);
    // 源码 226805：`var_58(42) <= -2000000 & var_58(42) > -12000000`（含起点）
    return v <= PHASE2 && v > BIRTH;
  }
  /** 阶段 2 进度百分比（0..100） */
  function phase2Progress(c) {
    return idiv(G(c, 42) + 2000000, -100000);
  }

  /**
   * eatstatus 的阶段 2 推进（226805-226831）。
   * @param nutrition 食物营养（源码 var_1583）
   * @returns {{advanced:boolean, due:boolean, progress:number}}
   */
  function phase2Gain(g, eater, nutrition) {
    if (!inPhase2(eater)) return { advanced: false, due: false, progress: 0 };
    let st = G(eater, 42) - limit(idiv(nutrition | 0, 1000), 1, 5) * 100000;
    eater.set(42, st);
    const progress = phase2Progress(eater);
    if (st > BIRTH) {
      log(g, `[阶段 2 进度 ${progress} %]`);
      return { advanced: true, due: false, progress };
    }
    // 226826-226831：出生 —— 原版 evadd 93，下一事件回合处理；这里直接登记待办。
    log(g, '[HAPPY BIRTHDAY!!] 阶段 2 完成。');
    if (!g.birthPending) g.birthPending = [];
    if (g.birthPending.indexOf(eater.index | 0) < 0) g.birthPending.push(eater.index | 0);
    return { advanced: true, due: true, progress };
  }

  /** 兼容入口：吃任意食物后调用（只推进阶段 2，阶段 1 靠 gain_iden） */
  function onEat(g, eater, nutrition) {
    return phase2Gain(g, eater, nutrition);
  }

  /**
   * 出生（609072-609205）：把母亲的男/女核心转成子嗣。
   * @param motherIdx 受体角色下标（0 = 玩家）
   * @returns {{born:Array, stork:object|null}}
   */
  function birth(g, motherIdx) {
    const out = { born: [], stork: null };
    if (!g || !g.charas) return out;
    const m = g.charas[motherIdx | 0];
    if (!m) return out;
    const donorRace = G(m, 430);
    let species = (motherIdx | 0) === 0 ? donorRace : raceOf(m);
    if (!species) species = donorRace;           // 609095：受体 0 → var_58(430)
    if (!species) species = 1;                    // 无物种兜底（避免空 characreate）
    // 609100：var_58(42) = -var_58(42)/10000（剩余阶段数）
    if (G(m, 42) < 0) m.set(42, idiv(-G(m, 42), 10000));
    cbmod(m, 1051, true);

    const inheritFields = [207, 208, 209, 212, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224];
    let guard = 0;
    while ((G(m, 187) > 0 || G(m, 213) > 0) && guard++ < 20) {
      const isSon = G(m, 187) > 0;
      const geneSpecies = donorRace || species;
      // 临时槽 56：提供遗传参数（var_2854 = 供体种族）
      let template = null;
      try {
        template = Elona.Monster.create(g, geneSpecies, -3, m.x | 0, m.y | 0, { index: 56 });
      } catch (e) { template = null; }
      // 正式子嗣：var_2853 = 受体种族，在母亲坐标
      let child = null;
      try {
        child = Elona.Monster.create(g, species, Math.max(1, G(m, 38)), m.x | 0, m.y | 0, { var1023: 1 });
      } catch (e) { child = null; }
      if (!child) break;
      // 609124-609132 / 609166-609174：新生儿字段
      child.set(59, -5);                          // 婴儿阶段
      child.set(21, g.getV65 ? (g.getV65(10) | 0) : (g.year || 0)); // 出生年
      child.set(25, 6);                           // 先天品质 6（独特化）
      cbmod(child, 1034, true);
      child.set(8, isSon ? 0 : 1);                // 性别：0 男 / 1 女
      child.set(13, -1);
      const mn = nameOf(g, m);
      const fullName = `${mn}的${isSon ? '儿子' : '女儿'}`;
      if (typeof child.setName === 'function') child.setName(fullName);
      else child.name = fullName;
      child.displayName = `《${fullName}》`;
      // cbit1050：受体为玩家或无供体物种
      if ((motherIdx | 0) === 0 || !donorRace) cbmod(child, 1050, true);
      // 继承 15 项参数/抗性（源码从临时槽 56 复制）
      if (template) {
        for (const f of inheritFields) child.set(f, G(template, f));
      }
      // chara_vanquish 56：抹掉临时槽
      if (template && typeof template.vanquish === 'function') template.vanquish();
      else if (g.charas && g.charas[56] && g.charas[56] !== child) g.charas[56] = null;
      // 核心数自减
      m.set(isSon ? 187 : 213, G(m, isSon ? 187 : 213) - 1);
      // *label_4274 入队
      let joined = false;
      try { if (Elona.Party && Elona.Party.joinChara) { Elona.Party.joinChara(g, child); joined = true; } } catch (e) { joined = false; }
      log(g, `白鹳先生送来了${fullName}。`);
      out.born.push({ child, index: child.index | 0, son: isSon, name: fullName, joined });
    }
    // 609195-609200：收尾清零
    m.set(42, 0); m.set(430, 0);
    if (g.setV65) g.setV65(250 + 193, 0);
    // 609203：characreate -1, 690（白鹳）在玩家脚下
    try {
      const p = g.player;
      out.stork = Elona.Monster.create(g, 690, Math.max(1, G(m, 38)), p.x | 0, p.y | 0, {});
    } catch (e) { out.stork = null; }
    if (g.birthPending) {
      const i = g.birthPending.indexOf(motherIdx | 0);
      if (i >= 0) g.birthPending.splice(i, 1);
    }
    return out;
  }

  /** 每回合处理 pending 出生（对应事件 93 在事件队列里被消费） */
  function tickBirths(g) {
    if (!g || !g.birthPending || !g.birthPending.length) return [];
    const list = g.birthPending.slice();
    const results = [];
    for (const idx of list) results.push(birth(g, idx));
    g.birthPending = [];
    return results;
  }

  /**
   * 直接输血的生育补充（330844-330847）：
   *   源扣 MP（dmgcon 9）已在 ability0 的 T[843] 完成；
   *   这里补目标回 MP（healcon 9, 差额）与 gain_iden(源,目标,5)。
   */
  function transfuse(g, donor, receiver, mpDrained) {
    if (!receiver) return { healed: 0, gene: null };
    let healed = 0;
    if (Elona.Status && Elona.Status.healcon) {
      try { healed = Elona.Status.healcon(receiver, 9, Math.max(0, mpDrained | 0)); } catch (e) { healed = 0; }
    }
    const gene = gainIden(g, donor, receiver, 5);
    return { healed, gene };
  }

  // ---- 育儿行为（wiki：走神 / 嗜睡 / 逆反 / 教育投资）----
  // 源码依据（219xxx-220xxx 的 child AI 与 290xxx 的教育）：这些属于孩子成长阶段的
  //   AI 修正，实际字段为 var_58(59)（成长阶段 -5..0）与兴趣 var_？。为避免与
  //   已实现的 randomevent 育儿事件冲突，这里只提供纯函数供 AI / 交互层查询。

  /** 孩子的成长阶段（-5 幼年 … 0 成年）；非孩子返回 null */
  function stageOf(c) {
    if (!c) return null;
    const v = G(c, 59);
    return v < 0 ? v : null;
  }

  /**
   * 走神放弃行动概率（源码 594466-594520，按成长阶段 var_58(59)）：
   *   -5 → rnd(100)<20 / -4 → <15 / -3 → <10 / -2 → <5；
   *   -1 → limit(var_58(169),1,150)/10 + 80 <= rnd(100)，即 20 - limit(169,1,150)/10 %。
   * 注：顺从度字段是 var_58(169)（非 181）。
   */
  function distractionRate(c) {
    const st = stageOf(c);
    if (st === null) return 0;
    const table = { '-5': 20, '-4': 15, '-3': 10, '-2': 5 };
    if (st === -1) return Math.max(0, 20 - idiv(limit(G(c, 169), 1, 150), 10));
    return table[String(st)] || 0;
  }

  /** 是否走神（调用方在 AI 决策前查询） */
  function isDistracted(g, c) {
    const rate = distractionRate(c);
    return rate > 0 && rnd(g, 100) < rate;
  }

  /**
   * 嗜睡（wiki：幼年/幼童每回合 5%、童年夜 23-6 点 5%、成长夜 2%；
   *   入睡时长幼年 rnd(301)+100，其余 rnd(151)+50）。
   */
  function sleepiness(g, c, hour) {
    const st = stageOf(c);
    if (st === null) return { sleep: false, turns: 0 };
    const h = hour | 0;
    const night = h >= 23 || h < 6;
    let chance = 0, turns = rnd(g, 151) + 50;
    if (st === -5) { chance = 5; turns = rnd(g, 301) + 100; }
    else if (st === -4) chance = 5;
    else if (st === -3 && night) chance = 5;
    else if (st === -2 && night) chance = 2;
    if (chance <= 0 || rnd(g, 100) >= chance) return { sleep: false, turns: 0 };
    return { sleep: true, turns };
  }

  /** 逆反：幼童期 50% 拒绝道具给予/索取；叛逆期 50% 拒绝战术指示 */
  function isDefiant(g, c, kind) {
    const st = stageOf(c);
    if (st === null) return false;
    if (kind === 'item' && st === -4) return rnd(g, 100) < 50;
    if (kind === 'tactic' && st === -1) return rnd(g, 100) < 50;
    return false;
  }

  /**
   * 教育投资（wiki：兴趣>=80 → 消耗 PC 10000 金 + 孩子 80 兴趣，
   *   技能组经验 += 300 + PC 学习/20；或投资兴趣 → 好感+2、15 次随机技能 +
   *   (600 + PC 学习/10) 经验）。兴趣字段项目里 children 用 get(16) 轮转，
   *   这里只做确定性的资源扣除与经验值计算，由交互层负责选择技能组。
   */
  function investEducation(g, parent, child, skillGroup) {
    if (!parent || !child) return { ok: false, reason: 'no-target' };
    const interest = G(child, 16);
    if (interest < 80) return { ok: false, reason: 'low-interest' };
    const gold = G(parent, 30);                        // var_58(30) = 玩家金币
    if (gold < 10000) return { ok: false, reason: 'no-gold' };
    parent.set(30, gold - 10000);
    child.set(16, interest - 80);
    const learn = S(parent, 18);                        // 技能 18 = 学習
    const amount = 300 + idiv(learn, 20);
    if (Elona.Stats && Elona.Stats.skillExp && skillGroup) {
      try { Elona.Stats.skillExp(child, skillGroup, parent, amount, 0, 0, g); } catch (e) { /* noop */ }
    }
    return { ok: true, amount, skill: skillGroup | 0 };
  }

  Birth.gainIden = gainIden;
  Birth.bestResist = bestResist;
  Birth.inPhase2 = inPhase2;
  Birth.phase2Progress = phase2Progress;
  Birth.phase2Gain = phase2Gain;
  Birth.onEat = onEat;
  Birth.birth = birth;
  Birth.tickBirths = tickBirths;
  Birth.transfuse = transfuse;
  Birth.stageOf = stageOf;
  Birth.distractionRate = distractionRate;
  Birth.isDistracted = isDistracted;
  Birth.sleepiness = sleepiness;
  Birth.isDefiant = isDefiant;
  Birth.investEducation = investEducation;
  Birth.PHASE1 = PHASE1;
  Birth.PHASE1_DONE = PHASE1_DONE;
  Birth.PHASE2 = PHASE2;
  Birth.BIRTH = BIRTH;

  Elona.Birth = Birth;
})(typeof window !== 'undefined' ? window : globalThis);
