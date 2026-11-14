'use strict';
/**
 * 竞技场（core/arena.js）—— 对应原版竞技场 NPC 的「試合に出る」与「成績を聞く」
 *
 * 【源码依据】start.hsp 416977-417260（var_506 == 21/22/23）：
 *   21 决斗：检查当日是否已结束（var_132(26, 地图) 时间戳）→ 生成 1 名对手
 *           （characreate 56；等级 = (100 - var_65(120)/100)/3*2+3，
 *            不低于 var_132(22, 地图)）→ 确认「挑戦する / やめる」→
 *            设置 var_65(70)=1,1,0,1（竞技场模式）、var_65(64)=6、var_65(65)=1、
 *            var_1777=2、var_2208=1 → 进入战斗
 *   22 乱斗：同上，但对手是「复数」（var_1843 组）
 *   23 成绩：显示胜/负场
 *
 * 【0-DI 补完】416942-417108 / 591368-591431 / 246633-246675：
 *   · 决斗（var_132(26)）与乱斗（var_132(27)）**各自**每天 1 次；
 *     宠物竞技场（var_132(39)）每天 3 次（417124-417130 / 417152-417157）
 *   · 开战前强制下马（var_65(183) → ride_end，416943-416960）并让同伴退场
 *   · 胜利给的是**名声**（var_65(74)）而不是金币；
 *     胜场达到 3/10/30/50/100 时在脚下掉落对应奖励（246640-246665）
 *   40/41/49：宠物决斗 / 团队战 / EX 战 —— 0-HV 已实现（出战宠物选择见 284006-284122）
 *
 * 【本实现的近似】
 *   · 对手用 Elona.CharaFactory.pick 生成（等级按赛制公式），数量 1（决斗）/ 3+rnd(4)（乱斗）
 *   · 用 g.arena 记录当前对局；击杀全部对手 → 结算（名声 + 胜场 + 奖励物品）；
 *     玩家倒下 → 记败场（在 game 的死亡分支调用 onPlayerDown）
 *   · 成绩存在 g.arenaStats = { wins, losses }（随存档序列化）
 *
 * 【0-HU / A200 按源码还原的部分】
 *   · 416986-417035：决斗/乱斗/宠物战的对手等级**公式各不相同**，且决斗会
 *     排除 492/421/385/384/26/27/32/25 八个种族（repeat 50 重挑）。
 *   · 416979 / 417041：当日限制是 `var_132(26/27, 地图) = 绝对小时 + 24`，
 *     不是「日历天翻转」；宠物竞技场 `var_132(39)` 每日 3 次、`var_132(35)`
 *     是重置时间戳（417124-417130）。网页的 var_132 运行时表用 g.arenaData 近似。
 *   · 417075-417079：`var_65(70) = 1,1,0,1`（HSP 连续赋值 → 70..73）+ 64=6/65=1；
 *     胜负通用判定见 check_quest 193766-193804（要求对手 var_58(69) = -3）。
 *   · 416976 / 417115 + 32217-32222：胜利名声是 `calcfame(0, …)`，不是固定值。
 *   · 591400 `var_132(22/23, 地图)++`；591158/591174 `var_65(70)=0,0,0,0` 清模式。
 *   （0-HV 起已按 417103 / 417225 换到 arena_1 / arena_2 专用地图，胜负与奖励见下方 0-HV 段。）
 *
 * 【0-HV / A200 按源码还原的部分】（用户要求「检查竞技场机制是否已完全移植，没有就补全」）
 *   · 入口是服务角色槽 var_58(150)：10 → 21 决斗 / 22 乱斗 / 23 成绩（415080-415175）；
 *     11 → 40 宠物决斗 / 41 团队战 / 49 EX 战 / 42 成绩（415449-415473）。
 *   · 417087-417095 / 417202-417210：正在决斗（var_65(250+306) > 0，即 var_65(556)）→
 *     snd 27 +「決闘の呪いからは逃げられない！」，不许再开赛。
 *   · 591368-591431 `*label_4293`（人）与 591268-591366 `*label_4292`（宠）是**两套**结算：
 *     人胜 snd 69 → modrank 0,100,2 → 中央 `map_placeupstairs`（留场走楼梯出去）；
 *     宠胜先给每只出战宠物 `calcfame(...)*2`（双倍）并补 HP 到半数 → snd 69 → EX 战只记
 *     var_65(802)/803 → 普通 modrank 1,100,2 → 605176 `var_1777 = 4` + snd 49 直接离场。
 *   · 246633-246718 奖励表：人 3/10/30/50/100 → 372/1173/430/900/711+706+621×N；
 *     宠 3/10/30/50/100 → 501/502/1060/869(充 15)/630+869(充 13)×N；非 100 档
 *     %20 → 材料 41、%5 → 材料 40。
 *   · 591182-591189 人败北只有 modrank 0,-100（**不扣名声**）；591347-591365 宠败北
 *     modrank 1,-100 + `decfame 0,60`（32223-32230）。606532 + 220442：竞技场里倒下
 *     **没有**死亡惩罚（`var_65(70) != 0` 时不 evadd 6），由 game.js 死亡分支短路。
 *   · 227947-227971 `map_placearena` 左右半区站位；238712/238759 的 arena_1 / arena_2
 *     由 game.enterArenaMap 换图，game.leaveArenaMap 回 var_65(66..69)。
 *
 * 【仍开放】
 *   · 观众兴奋度 var_65(250+373)（605000-605013 满 9999 → evadd 18 观众冲场）未移植。
 *   · var_132 运行时表用 g.arenaData 近似；fltn 物种标签仍用固定 id。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /** 源码 `snd N` —— 有音频层才播（纯表现：无层 / 浏览器未解锁都静默） */
  function snd(g, n) {
    if (g && typeof g.playSnd === 'function') { try { g.playSnd(n); } catch (e) { /* 无声卡 */ } }
  }

  /** 当前游戏内「日」序号（年*360 + 月*30 + 日，与 quest.curDay 同量纲） */
  function curDay(g) {
    const y = g.getV65(10) | 0, mo = g.getV65(11) | 0, d = g.getV65(13) | 0;
    return y * 360 + mo * 30 + d;
  }

  /** 绝对游戏时间（小时）：源码 `var_65(13)+12*24+11*24*30+10*24*30*12` */
  function absHours(g) {
    const v = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    return v(13) + v(12) * 24 + v(11) * 24 * 30 + v(10) * 24 * 30 * 12;
  }

  /**
   * var_132(n, 地图) 运行时表（A43 未整体移植，竞技场用到的 6 格在此登记）：
   *   22/23 普通 / 宠物竞技场难度（每胜 +1）、26/27 下次可挑战的绝对小时、
   *   35 宠物次数重置时间戳、39 当日宠物战次数。
   */
  function a132(g) {
    if (!g.arenaData) g.arenaData = { 22: 0, 23: 0, 26: 0, 27: 0, 35: 0, 39: 0 };
    return g.arenaData;
  }

  /** 416979 / 417041 / 417124-417130：决斗·乱斗的 +24h 冷却与宠物战每日 3 次 */
  function cooldown(g, mode) {
    const d = a132(g), now = absHours(g);
    const isPetMode = (mode === 'pet-duel' || mode === 'pet-team' || mode === 'pet-ex');
    if (isPetMode) {
      if (d[35] <= now) d[39] = 0;                 // 417125-417127：跨天清零
      return d[39] >= 3;                            // 417128-417130
    }
    const key = mode === 'rumble' ? 27 : 26;
    return d[key] > now;                           // 416979 / 417041
  }

  /** 开赛后写冷却（417077-417081）与次数 */
  function markStarted(g, mode) {
    const d = a132(g), now = absHours(g);
    const isPetMode = (mode === 'pet-duel' || mode === 'pet-team' || mode === 'pet-ex');
    if (isPetMode) {
      d[39] = (d[39] | 0) + 1;
      if (d[35] <= now) d[35] = now + 24;
    } else {
      d[mode === 'rumble' ? 27 : 26] = now + 24;
    }
  }

  /**
   * 416976 / 417115 的 calcfame 入参 + 32217-32222 的 calcfame 本体：
   *   base = (220 - var_65(120或121)/50) * (100 + limit(难度,0,玩家Lv))/100 + 2
   *   fame = base*100 / (100 + (名声/100)*(名声/100)/2500)，< 5 时取 rnd(5)+1
   */
  function fameReward(g, petMode) {
    const d = a132(g);
    const p = g.player;
    const rank = petMode ? (d[23] | 0) : (d[22] | 0);
    const v120 = (g.getV65 ? (g.getV65(petMode ? 121 : 120) | 0) : 0);
    // 416975（人）与 417112（宠物）的第二个括号**不同**：
    //   人   `100 + limit(var_132(22), 0, var_58(38, 0))`   ← 上限是玩家等级
    //   宠物 `50  + limit(var_132(23), 0, 50)`              ← 上限固定 50
    const cap = petMode ? 50 : (p ? ((p.get(38) | 0) || (p.level | 0) || 0) : 0);
    const base = idiv((220 - idiv(v120, 50)) * ((petMode ? 50 : 100) + limit(rank, 0, cap)), 100) + 2;
    const f = p ? (p.get(34) | 0) : 0;
    const denom = 100 + idiv(idiv(f, 100) * idiv(f, 100), 2500);
    let out = idiv(base * 100, denom || 100);
    if (out < 5) {
      const R = (g.rng && g.rng.rnd) ? g.rng.rnd.bind(g.rng) : () => 0;
      out = R(5) + 1;
    }
    return out | 0;
  }

  /** 417075-417079 / 591158 / 591174：竞技场模式标志的写入与清除 */
  function setQuestMode(g, on) {
    if (!g || typeof g.setV65 !== 'function') return;
    g.setV65(70, on ? 1 : 0);
    g.setV65(71, on ? 1 : 0);
    g.setV65(72, 0);
    g.setV65(73, on ? 1 : 0);
  }

  /** 决斗生成时排除的八个种族（416998-417025） */
  const EXCLUDE_RACES = [492, 421, 385, 384, 26, 27, 32, 25];

  function stats(g) {
    if (!g.arenaStats) g.arenaStats = { wins: 0, losses: 0 };
    return g.arenaStats;
  }

  /**
   * 竞技场对手等级（416985-416990 / 417054-417059 / 417131-417140 / 417162-417175）。
   *   `tier = var_65(120 或 121) / 100`（排名点数 / 100：100 = 无名，1 = 冠军）
   *   决斗 / 宠物决斗 `(100 - tier) / 3 * 2 + 3`   ← HSP 整数除法，**先 /3 再 *2**
   *   乱斗 / 宠物团队 `(100 - tier) / 2 + 1`
   *   下限：决斗 var_132(22)、乱斗 var_132(22)*4/5、宠物同理用 var_132(23)。
   * 原版**不**与玩家等级取大；等级完全由排名与胜场决定（满排名时是 3 级）。
   */
  function opponentLevel(g, mode) {
    const d = a132(g);
    const petMode = (mode === 'pet-duel' || mode === 'pet-team' || mode === 'pet-ex');
    const wide = (mode === 'rumble' || mode === 'pet-team' || mode === 'pet-ex');
    const v = (g.getV65 ? (g.getV65(petMode ? 121 : 120) | 0) : 0);
    const base = wide
      ? idiv(100 - idiv(v, 100), 2) + 1
      : idiv(100 - idiv(v, 100), 3) * 2 + 3;
    const rank = petMode ? (d[23] | 0) : (d[22] | 0);
    const floor = wide ? idiv(rank * 4, 5) : rank;
    return Math.max(base, floor, 1);
  }

  /** 417026-417028：`var_2710 = limit(var_1843(1) / 3 * 2, 1, 130)`（先除后乘） */
  function minOpponentLevel(lv) {
    return limit(idiv(lv, 3) * 2, 1, 130);
  }

  /** 找一个玩家附近的可站立空格 */
  function freeCellNear(g, c, radius) {
    const p = g.player;
    for (let r = 1; r <= (radius || 4); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = p.x + dx, y = p.y + dy;
          if (!g.map || !g.map.inBounds(x, y)) continue;
          const chk = g.map.check(x, y);
          if (!chk.walkable) continue;
          return { x, y };
        }
      }
    }
    return null;
  }

  /**
   * 0-CM：竞技场对手的区域放置 —— map_placearena（227947-227977）。
   *   反复 `x = rnd(7)+5（type 0 再 +8）, y = rnd(6)+6`，放上角色后校验区域：
   *     type 0 → x∈[13,20), y∈[6,12)；type 1 → x∈[5,12), y∈[6,12)。
   *   落点不在区域内（或不可站）→ 清格重试（var_704(x,y,1)=0）。
   * 原版在竞技场专用地图（var_65(20)==40）上保证区域内必有空位；本实现的地形
   * 不保证，200 次尝试失败后回退到玩家附近找空位（登记为已知偏差）。
   * @returns {{x:number, y:number}|null}
   */
  function placeArena(g, type) {
    const R = (n) => g.rng.rnd(Math.max(1, n | 0));
    for (let t = 0; t < 200; t++) {
      let x = R(7) + 5;
      const y = R(6) + 6;
      if (type === 0) x += 8;                        // 227954-227956
      // 227966-227976 的区域校验
      const inRegion = (type === 0)
        ? (x >= 13 && y >= 6 && x < 20 && y < 12)
        : (x >= 5 && y >= 6 && x < 12 && y < 12);
      if (!inRegion) continue;                       // var_704(x,y,1)=0 后重试
      if (!g.map || !g.map.inBounds(x, y)) continue;
      const chk = g.map.check(x, y);
      if (!chk.walkable) continue;
      const cell = g.map.cell(x, y);
      if (cell && (cell[1] | 0) !== 0) continue;     // 已有角色 → 清格重试
      return { x, y };
    }
    return null;
  }

  /**
   * 开始一场比赛。
   * @param {object} g
   * @param {object} keeper 竞技场 NPC
   * @param {'duel'|'rumble'} mode
   * @returns {{ok:boolean, message:string, opponents?:number[]}}
   */
  /** 每日次数表 —— 决斗/乱斗各 1 次，宠物竞技场 3 次 */
  function days(g) {
    const day = curDay(g);
    if (!g.arenaDays || g.arenaDays.day !== day) {
      g.arenaDays = { day, duel: 0, rumble: 0, pet: 0 };
    }
    return g.arenaDays;
  }

  /** 赛制 → 竞技场地图（238712 `map_initcustom "arena_1"` / 238759 `"arena_2"`） */
  const ARENA_MAPS = {
    duel: 'arena_1', rumble: 'arena_1',
    'pet-duel': 'arena_2', 'pet-team': 'arena_2', 'pet-ex': 'arena_2',
  };

  /** 宠物竞技场（菜单 40 / 41 / 49，地图 40「arena_2」） */
  function isPetArena(mode) {
    return mode === 'pet-duel' || mode === 'pet-team' || mode === 'pet-ex';
  }

  /** 参赛人数：417054 起 `repeat 3 + rnd(4)`（乱斗）、417163 `rnd(9-1)+2`（团队战） */
  function countOf(g, mode, opt) {
    const R = (n) => (g.rng ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    if (mode === 'rumble') return 3 + R(4);            // 238743 repeat 3 + rnd(4)
    if (mode === 'pet-team') return R(9 - 1) + 2;      // 417163 → 2..9
    if (mode === 'pet-ex') {
      const n = (opt && (opt.petCount | 0)) || 0;      // 417186 由 label_2683 的出战数决定
      return Math.max(1, n);
    }
    return 1;                                          // 决斗 / 宠物决斗
  }

  /**
   * 开战前的「报价」——416977-417060 / 417123-417200 的对话前半段。
   * 原版先报「相手はレベル N だ。挑むか？」再等玩家选「Alright. / I'll pass.」，
   * 所以报价与开战必须分两步（UI 用 renderPickList 承载）。
   */
  function quote(g, keeper, mode, opt) {
    if (!mode) return { ok: false, message: '没有这种比赛。' };
    if (g.arena) return { ok: false, message: '比赛正在进行中。' };
    const pet = isPetArena(mode);
    // 416979 / 417041：`var_132(26/27) > 绝对小时` 就是「今天已经打过」；
    // 417124-417130：宠物竞技场 `var_132(39) >= 3`，跨天由 `var_132(35)` 重置。
    if (cooldown(g, mode)) {
      return { ok: false, message: '「今天的比赛已经结束了，明天再来吧。」' };
    }
    let petIndex = -1;
    let petList = [];
    if (pet) {
      const pets = (Elona.Party && Elona.Party.pets) ? Elona.Party.pets(g) : [];
      if (!pets.length) return { ok: false, message: '「你还没有可以出战的宠物。」' };
      const want = (opt && opt.petIndex !== undefined) ? (opt.petIndex | 0) : pets[0].index;
      petIndex = pets.some((c) => (c.index | 0) === want) ? want : (pets[0].index | 0);
      if (!g.charas[petIndex]) return { ok: false, message: '找不到出战的宠物。' };
      petList = pets.map((c) => c.index | 0);
    }
    const lv = opponentLevel(g, mode);                  // 416985 / 417054 / 417131
    const d = a132(g);
    const tier = idiv(g.getV65 ? (g.getV65(pet ? 121 : 120) | 0) : 0, 100);
    // 417030 / 417058 / 417135 / 417167：冠军（位次 1）且该场地 29 胜以上
    const champion = tier === 1 && ((d[pet ? 23 : 22] | 0) >= 29);
    return {
      ok: true, mode, petMode: pet, level: lv, count: countOf(g, mode, opt),
      fame: fameReward(g, pet), petIndex, petList, champion,
      arenaMap: ARENA_MAPS[mode] || 'arena_1',
    };
  }

  /** 417075-417079 / 417205-417208：竞技场模式标志（人 70=1,1,0,1；宠物 70=2,0,0,1） */
  function setArenaMode(g, on, pet) {
    if (!g || typeof g.setV65 !== 'function') return;
    g.setV65(70, on ? (pet ? 2 : 1) : 0);
    g.setV65(71, on ? (pet ? 0 : 1) : 0);
    g.setV65(72, 0);
    g.setV65(73, on ? 1 : 0);
  }

  /**
   * 开始一场比赛。
   * 对手在这里生成到 57..244 的空槽（与原版 `characreate 56` 后转正一致），
   * 但**真正的站位**要等 `beginBattle`（换到 arena_1/arena_2 之后）。
   * @param {object} g
   * @param {object} keeper 竞技场 NPC
   * @param {'duel'|'rumble'|'pet-duel'|'pet-team'|'pet-ex'} mode
   * @returns {{ok:boolean, message:string, opponents?:number[], arenaMap?:string}}
   */
  function start(g, keeper, mode, opt) {
    const q = quote(g, keeper, mode, opt);
    if (!q.ok) return q;
    // 417087-417095 / 417202-417210：正在决斗中（var_65(250+306) > 0）→ 不许再开赛
    //   `snd 27` +「決闘の呪いからは逃げられない！」→ goto *label_3067
    if ((g.getV65 ? (g.getV65(556) | 0) : 0) > 0) {
      snd(g, 27);
      return { ok: false, duelCurse: true, message: '「决斗的诅咒是无法逃脱的！」' };
    }
    const isPet = q.petMode;
    const lv = q.level;
    const minLv = minOpponentLevel(lv);                 // 417026 var_2710
    const picked = [];
    const pending = [];
    for (let i = 0; i < q.count; i++) {
      let slot = -1;
      for (let k = 57; k < 245; k++) {
        const c = g.charas[k];
        if (!c || (c.get(0) | 0) !== 1) { slot = k; break; }
      }
      if (slot < 0) break;
      let opp = null;
      // 416981-417025：决斗 `repeat 50` 反复重挑；乱斗 / 宠物战只挑一次
      const tries = (mode === 'duel') ? 50 : 1;
      for (let t = 0; t < tries; t++) {
        let cid = 0;
        try { cid = Elona.CharaFactory ? Elona.CharaFactory.pick(g, lv, {}) : 0; } catch (e) { cid = 0; }
        if (!cid) break;
        let cand = null;
        try {
          cand = Elona.CharaFactory.create(g, cid, lv, g.player.x, g.player.y, { index: slot });
        } catch (e) { cand = null; }
        if (!cand) continue;
        const race = cand.get(27) | 0;
        if (mode === 'duel' && EXCLUDE_RACES.indexOf(race) >= 0) { g.charas[slot] = null; continue; }
        if (mode === 'duel' && (cand.get(38) | 0) < minLv) { g.charas[slot] = null; continue; }
        opp = cand;
        break;
      }
      if (!opp) continue;
      opp.index = slot;
      opp.set(0, 1);
      opp.set(9, -3);                        // 417029 当前关系
      opp.set(69, -3);                       // 238739 原始关系（check_quest 193769 只判它）
      g.charas[slot] = opp;
      picked.push(slot);
      // 238735：决斗重建时按 `var_1843(1)` = 事先抽到的**种族**、`var_1844` 等级
      pending.push({ slot, species: opp.get(27) | 0, level: opp.get(38) | 0 });
    }
    if (!picked.length) return { ok: false, message: '找不到合适的对手……' };
    // 416943-416960：骑乘中 → 立刻下马（没有空位就中止）
    if (Elona.Riding && Elona.Riding.mountOf && Elona.Riding.mountOf(g)) {
      try { Elona.Riding.dismount(g); } catch (e) { /* 忽略 */ }
    }
    // 417214-417219 `gosub *label_2683`（var_1790 = 2）：宠物战先挑出战宠物。
    //   原版团队战由 284106-284122 按 `var_1843(1)` 自动勾选同样数量，
    //   EX 战勾 1 只；这里「玩家指定的那只优先，其余按列表顺序补足」。
    const petSlots = [];
    if (isPet) {
      petSlots.push(q.petIndex);
      const want = (mode === 'pet-duel') ? 1 : Math.max(1, q.count | 0);
      for (const idx of q.petList) {
        if (petSlots.length >= want) break;
        if (petSlots.indexOf(idx) < 0) petSlots.push(idx);
      }
    }
    // 竞技场是单人战：同伴退场（原版换图时队伍留在外面，238718-238725 状态 8）
    const withdrawn = [];
    for (let i = 1; i < 16; i++) {
      const c = g.charas && g.charas[i];
      if (!c || c.get(0) !== 1) continue;
      if (isPet && petSlots.indexOf(i) >= 0) continue;   // 宠物战保留出战宠物
      withdrawn.push(i);
      c.set(0, 7);
      c.set(201, 0);
      c.set(9, 0);
    }
    if (g.syncCharaCells) g.syncCharaCells();
    g.arena = {
      mode, opponents: picked.slice(), alive: picked.length, level: lv,
      petMode: isPet, petIndex: q.petIndex, petSlots, withdrawn, fame: q.fame,
      mapName: q.arenaMap, pending, champion: q.champion, cleared: false,
    };
    markStarted(g, mode);                               // var_132(26/27/39)
    setArenaMode(g, true, isPet);                       // 417075 / 417205
    // 417103-417104 / 417209-417210：`var_65(66) = 地图, 子地图, x, y`
    if (g.setV65) {
      g.setV65(66, g.getV65(20) | 0);
      g.setV65(67, g.getV65(22) | 0);
      g.setV65(68, g.player.x | 0);
      g.setV65(69, g.player.y | 0);
    }
    const label = isPet
      ? (mode === 'pet-team' ? '团队战' : (mode === 'pet-ex' ? 'EX 战' : '宠物决斗'))
      : (mode === 'rumble' ? '乱斗' : '决斗');
    const who = isPet
      ? `${petSlots.map((i) => g.charas[i].name).join('、')} 出战`
      : '你';
    return {
      ok: true, opponents: picked, level: lv, reward: 0, petMode: isPet,
      fame: q.fame, arenaMap: q.arenaMap, count: picked.length, petSlots, mode,
      petIndex: q.petIndex,
      message: `【${label}】${who}，对手是 ${picked.length} 名等级约 ${lv} 的战士。胜利可获得 ${q.fame} 名声。`,
    };
  }

  /** 竞技场地图（32×24 / 25×14）里找个能站的格子（不踩已有角色） */
  function walkableAt(g, x, y) {
    if (!g.map || !g.map.inBounds(x, y)) return null;
    const chk = g.map.check(x, y);
    if (!chk.walkable) return null;
    const cell = g.map.cell(x, y);
    if (cell && (cell[1] | 0) !== 0) return null;
    return { x, y };
  }

  /**
   * 换到竞技场地图之后摆位 —— 238732-238757（map 6）与 238792-238809（map 40）。
   *   决斗 1 体 → `characreate -1, 种族, x-1, y-4`
   *   乱斗 3+rnd(4) 体 → `characreate -1, 0, x-1, y-5`
   *   宠物战 → `map_placearena 槽, 1`（左半区 x 5..12 / y 6..12）
   */
  function beginBattle(g) {
    const a = g && g.arena;
    if (!a || !a.pending) return null;
    const p = g.player;
    const CB = Elona.Status && Elona.Status.cbitmod;
    let placed = 0;
    // 238792-238809：宠物方 `map_placearena cnt, 0` → 右半区 x 13..19 / y 6..11，
    //   敌人 `map_placearena var_581, 1` → 左半区 x 5..11 / y 6..11。
    if (a.petMode && a.petSlots) {
      for (const i of a.petSlots) {
        const c = g.charas && g.charas[i];
        if (!c) continue;
        let spot = placeArena(g, 0) || freeCellNear(g, p, 8);
        if (!spot) continue;
        c.x = spot.x; c.y = spot.y;
        c.set(0, 1);
        c.set(201, 30);
        if (CB) CB(c, 976, 1);
      }
    }
    for (const o of a.pending) {
      const c = g.charas && g.charas[o.slot];
      if (!c) continue;
      let spot = null;
      if (a.petMode) {
        spot = placeArena(g, 1);
      } else {
        const by = (a.mode === 'rumble') ? (p.y | 0) - 5 : (p.y | 0) - 4;
        spot = walkableAt(g, (p.x | 0) - 1, by);
      }
      if (!spot) spot = freeCellNear(g, p, 6);
      if (!spot) continue;
      c.x = spot.x; c.y = spot.y;
      c.set(201, 30);                       // 238736 var_58(201) = 30
      if (CB) CB(c, 976, 1);                // 238740 cbitmod 976（竞技场标记）
      placed++;
    }
    if (g.syncCharaCells) g.syncCharaCells();
    g.arena.placed = placed;
    return { placed };
  }

  /**
   * 对手被击杀 —— 由 KillReward.onKill 调用；全灭时结算。
   *
   * 原版有**两套**胜利结算，走不同的 ctx：
   *   人（决斗 / 乱斗）591368-591431 `*label_4293`
   *     snd 69 → 「あなたは勝利した！」→ modrank 0,100,2 → var_58(34,0) += var_65(74)
   *     → 「外への階段が現れた。」→ map_placeupstairs 场地正中 → var_132(22)++ → var_65(250+57)++
   *     → 3/10/30/50/100 胜奖励（var_1873）→ %20 材料 41 / %5 材料 40
   *   宠物（决斗 / 团队 / EX）591268-591366 `*label_4292`
   *     先给**全部出战宠物**算名声（591279 `calcfame(...) * 2`，HP 至少补到一半）
   *     → snd 69 → 「あなたのチームは勝利した！」
   *     → EX（var_1846 == 1）：只记 var_65(802)++ 与 var_65(803) 最高击破等级，**不给名声/排名/胜场**
   *     → 普通：var_58(34,0) += var_65(74) → modrank 1,100,2 → var_132(23)++ → var_65(250+58)++
   *     → 3/10/30/50/100 胜奖励（var_1874）→ 材料同人
   *   宠物竞技场结算完由 605176 `var_1777 = 4` 直接离场（**没有楼梯**）；
   *   人竞技场则留在场地里，玩家自己走中央的上行楼梯出去。
   */
  function onKill(g, def) {
    const a = g.arena;
    if (!a || !def) return null;
    const idx = a.opponents.indexOf(def.index);
    if (idx < 0) return null;
    a.alive = Math.max(0, a.alive - 1);
    if (a.alive > 0) return { alive: a.alive, message: `还剩 ${a.alive} 名对手。` };
    const st = stats(g);
    st.wins++;
    const p = g.player;
    const dd = a132(g);
    const rankKey = a.petMode ? 23 : 22;
    const drops = [];
    let rankText = '';
    let matText = '';
    let petFame = [];
    let exRecord = null;

    setArenaMode(g, false, a.petMode);                 // 591158 / 591174 var_65(70)=0,0,0,0

    /** 246640-246716 / 246574-246717：掉落一件奖励到脚下 */
    const drop = (id, opt) => {
      let it = null;
      try { it = Elona.ItemDB.create(g, { itemId: id }); } catch (e) { it = null; }
      if (!it || !p) return;
      it.f[0] = 1; it.eqSlot = -1; it.f[17] = 0;
      it.f[5] = p.x; it.f[6] = p.y;
      // 246702 / 246715：`var_99(25) = 15 / 13`（869 进化道具的充能数）
      if (opt && opt.charge) it.f[25] = opt.charge | 0;
      if (g.groundItems) { g.groundItems.push(it); if (g.refreshGroundCell) g.refreshGroundCell(p.x, p.y); }
      else p.inv.push(it);
      drops.push(id);
    };

    /** 3/10/30/50/100 胜的档位奖励（591398-591430 / 591312-591344） */
    const tierReward = (wins) => {
      let tier = 0;
      if (wins % 100 === 0) tier = 100;
      else if (wins % 50 === 0) tier = 50;
      else if (wins % 30 === 0) tier = 30;
      else if (wins % 10 === 0) tier = 10;
      else if (wins % 3 === 0) tier = 3;
      if (tier === 100) {
        // 591399-591400 / 591313：100 胜的庆祝音（人 61+60，宠只有 61）
        if (a.petMode) snd(g, 61); else { snd(g, 61); snd(g, 60); }
        p.set(34, (p.get(34) | 0) + 30000);            // 591406 / 591320
        if (a.petMode) {
          // 246704-246716：`repeat limit(var_132(23)/100, 1, 3)` → 630 + 869(充能13)
          const n = limit(idiv(wins, 100), 1, 3);
          for (let k = 0; k < n; k++) { drop(630); drop(869, { charge: 13 }); }
        } else {
          // 246661-246680：`repeat limit(var_132(22)/100 + 1, 2, 4)` → 711 + 706 + 621
          const n = limit(idiv(wins, 100) + 1, 2, 4);
          for (let k = 0; k < n; k++) { drop(711); drop(706); drop(621); }
        }
        return tier;
      }
      if (a.petMode) {
        if (tier === 50) drop(869, { charge: 15 });    // 246698-246702
        else if (tier === 30) drop(1060);              // 246693-246696
        else if (tier === 10) drop(502);               // 246685-246692
        else if (tier === 3) drop(501);                // 246676-246684
      } else {
        if (tier === 50) drop(900);                    // 246667
        else if (tier === 30) drop(430);               // 246663
        else if (tier === 10) drop(1173);              // 246659
        else if (tier === 3) drop(372);                // 246655
      }
      // 591336-591343 / 591422-591429：每 20 胜给材料 41、每 5 胜给材料 40（100 胜分支不给）
      if (Elona.Material && Elona.Material.add) {
        const matId = (wins % 20 === 0) ? 41 : ((wins % 5 === 0) ? 40 : 0);
        if (matId) {
          try {
            const mr = Elona.Material.add(g, matId, 1, 6);
            if (mr && mr.name) matText = `，并获得材料「${mr.name}」`;
          } catch (e) { /* 材料表未就绪 */ }
        }
      }
      return tier;
    };

    if (a.petMode) {
      // 591269-591281：出战宠物先拿「双倍名声」，HP 至少补到一半 → snd 69（胜败都响）
      petFame = teamFame(g, a);
      snd(g, 69);
      if (a.mode === 'pet-ex') {
        // 591296-591306：EX 战只更新击破等级记录，不碰名声 / 排名 / 胜场
        const cleared = a.level | 0;
        g.setV65(802, (g.getV65(802) | 0) + 1);
        if (cleared > (g.getV65(803) | 0)) {
          exRecord = { from: g.getV65(803) | 0, to: cleared };
          g.setV65(803, cleared);
        }
      } else {
        const fameGain = a.fame || 0;
        if (p) p.set(34, (p.get(34) | 0) + fameGain);   // 591308
        if (Elona.Rank && Elona.Rank.modRank) {         // 591309 modrank 1, 100, 2
          try {
            const rr = Elona.Rank.modRank(g, 1, 100, 2);
            if (rr && rr.text) rankText = rr.text;
          } catch (e) { /* 排名表未就绪 */ }
        }
        dd[23] = (dd[23] | 0) + 1;                      // 591310
        g.petWins = (g.petWins || 0) + 1;               // 591311 var_65(250+58)++
        tierReward(dd[23] | 0);
      }
    } else {
      snd(g, 69);                                       // 591374：人竞技场胜利音
      const fameGain = a.fame || 0;
      if (p) p.set(34, (p.get(34) | 0) + fameGain);     // 591389
      if (Elona.Rank && Elona.Rank.modRank) {           // 591388 modrank 0, 100, 2
        try {
          const rr = Elona.Rank.modRank(g, 0, 100, 2);
          if (rr && rr.text) rankText = rr.text;
        } catch (e) { /* 排名表未就绪 */ }
      }
      dd[22] = (dd[22] | 0) + 1;                        // 591396
      g.arenaWins = (g.arenaWins || 0) + 1;             // 591397 var_65(250+57)++
      tierReward(dd[22] | 0);
    }

    const modeLabel = (!a.petMode)
      ? (a.mode === 'rumble' ? '乱斗' : '决斗')
      : (a.mode === 'pet-team' ? '团队战' : (a.mode === 'pet-ex' ? 'EX 战' : '宠物决斗'));

    // 591393-591395：人竞技场胜利后 **不立刻离开**，在场地中央生成上行楼梯
    //   `map_placeupstairs var_126(0) / 2, var_126(1) / 2`，玩家自己走上去才出图。
    //   宠物竞技场没有这一步（605176 `var_1777 = 4` 直接离场），由 game.leaveArenaMap 处理。
    let stairs = null;
    const onMap = inArena(g);
    if (!a.petMode && onMap) {
      const M = Elona.MapFeat;
      const cx = idiv(g.map.width | 0, 2);
      const cy = idiv(g.map.height | 0, 2);
      if (M && M.write) M.write(g, cx, cy, 232, M.TYPE.STAIRS_UP, 0, 0);
      a.cleared = true;
      a.stairs = { x: cx, y: cy };
      stairs = a.stairs;
    } else if (!onMap) {
      // 没换图的旧路径（例如单元测试 / 未接换图时的调用）：就地结算并归队
      restoreWithdrawn(g, a);
      g.arena = null;
    }

    // 605173-605198：宠物竞技场结算完直接离场（`var_1777 = 4` + snd 49），没有楼梯可走
    //   snd 49 无条件（605177 只在 `var_1845 != 0` 分支内，胜败都会走到）；
    //   没换图的旧路径只响音、不调 leaveArenaMap（那会依赖 arenaReturn）。
    if (a.petMode) {
      snd(g, 49);                                       // 605177
      if (onMap && typeof g.leaveArenaMap === 'function') {
        const pr = g.leaveArenaMap();
        if (pr && pr.catch) pr.catch(() => { });
      }
    }

    const parts = [];
    parts.push(`${modeLabel}胜利！`);
    if (a.petMode) {
      if (petFame.length) {
        parts.push(petFame.map((x) => `${x.name} 获得 ${x.fame} 名声`).join('、') + '。');
      }
      if (a.mode === 'pet-ex') {
        parts.push(exRecord
          ? `EX 战击破等级记录更新（Lv${exRecord.from} → Lv${exRecord.to}）。`
          : `EX 战击破（对手 Lv${a.level | 0}，记录 Lv${g.getV65(803) | 0}）。`);
      } else {
        parts.push(`你获得 ${a.fame || 0} 名声${rankText ? `。${rankText}` : ''}`);
      }
    } else {
      parts.push(`你获得 ${a.fame || 0} 名声${rankText ? `。${rankText}` : ''}`);
    }
    if (drops.length) parts.push(`脚下出现了 ${drops.length} 件奖励`);
    if (matText) parts.push(matText.replace(/^，/, ''));
    if (stairs) parts.push('外への階段が現れた。');
    parts.push(`（累计 ${st.wins} 胜 ${st.losses} 负）`);
    return {
      won: true, reward: 0, fame: a.fame || 0, drops, petFame, exRecord, rankText, matText,
      cleared: !!stairs, stairs, petMode: !!a.petMode, mode: a.mode,
      leaveMap: !!a.petMode,
      message: parts.join(''),
    };
  }

  /** 让退场的同伴回到玩家身边（原版换图回来时队伍自动归位） */
  function restoreWithdrawn(g, a) {
    if (!a || !a.withdrawn) return;
    const p = g.player;
    for (const i of a.withdrawn) {
      const c = g.charas && g.charas[i];
      if (!c) continue;
      c.set(0, 1);
      const spots = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
      for (const [dx, dy] of spots) {
        const x = p.x + dx, y = p.y + dy;
        if (g.map && g.map.inBounds(x, y) && g.map.check(x, y).walkable) { c.x = x; c.y = y; break; }
      }
    }
    if (g.syncCharaCells) g.syncCharaCells();
  }

  /** 当前是否站在竞技场地图里（原版 `var_65(20) == 6 | == 40`） */
  function inArena(g) {
    return !!(g && g.arena && g.questMap && g.questMap.arena);
  }

  /**
   * decfame（32223-32230）：
   *   `v = fame / div + 5; v += rnd(v/2) - rnd(v/2); fame -= v`（下限 0）
   * @returns {number} 实际扣掉的名声
   */
  function decfame(g, owner, div) {
    const c = owner || (g && g.player);
    if (!c) return 0;
    const R = (n) => ((g && g.rng && g.rng.rnd) ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    const f0 = c.get(34) | 0;
    let v = idiv(f0, div | 0) + 5;
    v += R(idiv(v, 2)) - R(idiv(v, 2));
    c.set(34, Math.max(0, f0 - v));
    return v;
  }

  /**
   * 591269-591281：宠物竞技场结束时对**每只出战宠物**的结算。
   *   `var_58(34, cnt) += calcfame(cnt, (220 - var_65(121)/50) * (50 + limit(var_132(23),0,50)) / 100 + 2) * 2`
   *   同时 `if (var_58(50,cnt) < var_58(51,cnt)/2) var_58(50,cnt) = var_58(51,cnt)/2`
   *   —— 只有 `var_1635(cnt) == 1`（本场出战）的宠物参与。
   * 注意第二个括号固定是 `50 + limit(难度, 0, 50)`，与人的 `100 + limit(难度, 0, 玩家Lv)` 不同。
   */
  function teamFame(g, a) {
    if (!a || !a.petMode) return [];
    const d = a132(g);
    const v121 = g.getV65 ? (g.getV65(121) | 0) : 0;
    const base = idiv((220 - idiv(v121, 50)) * (50 + limit(d[23] | 0, 0, 50)), 100) + 2;
    const R5 = () => ((g.rng && g.rng.rnd) ? g.rng.rnd(5) : 0);
    const list = (a.petSlots && a.petSlots.length)
      ? a.petSlots.slice()
      : ((a.petIndex >= 0) ? [a.petIndex] : []);
    const out = [];
    for (const i of list) {
      const c = g.charas && g.charas[i];
      if (!c) continue;
      const hpMax = c.get(51) | 0;
      if ((c.get(50) | 0) < idiv(hpMax, 2)) c.set(50, idiv(hpMax, 2));
      const f0 = c.get(34) | 0;
      const denom = 100 + idiv(idiv(f0, 100) * idiv(f0, 100), 2500);   // 32218
      let gain = idiv(base * 100, denom || 100);
      if (gain < 5) gain = R5() + 1;
      gain *= 2;                                                        // 591279 的 `* 2`
      c.set(34, f0 + gain);
      out.push({ index: i, name: c.name, fame: gain });
    }
    return out;
  }

  /**
   * 玩家在竞技场里倒下。
   *
   * 【源码】玩家 HP 归零 → 606532 `*label_4374` → 606540 `if (var_65(70)) goto *label_4290`
   *   → `gosub *label_2245`（220442：**只有 var_65(70) == 0 才会 evadd 6**，
   *     也就是普通死亡事件/死亡惩罚在竞技场里完全不触发）
   *   → `var_1777 = 4` 离场，回 var_65(66..69) 记录的原地图与坐标。
   * 结算在 `*label_4291`（591182-591189 & 591347-591365）：
   *   人（决斗 / 乱斗）：只 `modrank 0, -100`，「あなたは敗北した。」—— **不扣名声**。
   *   宠物（团队 / EX）：`modrank 1, -100` + `decfame 0, 60`，「あなたのチームは敗北した。」
   * 两种情况都不掉金币/装备，也不进死亡画面。
   */
  function onPlayerDown(g) {
    const a = g.arena;
    if (!a) return null;
    const st = stats(g);
    st.losses++;
    const p = g.player;
    let rankText = '';
    let fameLoss = 0;

    snd(g, 50);                                        // 606534 *label_4374 开头的死亡音
    if (a.petMode) {
      snd(g, 69);                                      // 591281：*label_4292 里胜败都响
      // 591354-591355：团队战败北 → modrank 1, -100 + decfame 0, 60
      if (Elona.Rank && Elona.Rank.modRank) {
        try {
          const rr = Elona.Rank.modRank(g, 1, -100, 0);
          if (rr && rr.text) rankText = rr.text;
        } catch (e) { /* 排名表未就绪 */ }
      }
      fameLoss = decfame(g, p, 60);
    } else if (Elona.Rank && Elona.Rank.modRank) {
      // 591187-591189：「あなたは敗北した。」+ modrank 0, -100（**不扣名声**）
      try {
        const rr = Elona.Rank.modRank(g, 0, -100, 0);
        if (rr && rr.text) rankText = rr.text;
      } catch (e) { /* 排名表未就绪 */ }
    }

    setArenaMode(g, false, a.petMode);                 // 591174 var_65(70) = 0,0,0,0
    restoreWithdrawn(g, a);
    const arenaMap = a.mapName;
    const petMode = !!a.petMode;
    g.arena = null;

    // 原版是「被抬出场」而不是死：至少留一口气，否则回到原地图会立刻再判死
    let revived = 0;
    if (p && (p.get(50) | 0) <= 0) {
      const hp = Math.max(1, idiv(p.get(51) | 0, 3));
      p.set(50, hp);
      p.set(52, Math.max(0, p.get(52) | 0));          // SP 不清零，只保证不为负
      revived = hp;
    }

    const modeLabel = petMode
      ? (a.mode === 'pet-team' ? '团队战' : (a.mode === 'pet-ex' ? 'EX 战' : '宠物决斗'))
      : (a.mode === 'rumble' ? '乱斗' : '决斗');
    if (petMode) snd(g, 49);                           // 605177：宠物竞技场离场音
    const parts = [];
    parts.push(petMode ? '你的队伍败北了。' : '你败北了。');
    if (fameLoss) parts.push(`失去了 ${fameLoss} 点名声。`);
    if (rankText) parts.push(rankText);
    if (revived) parts.push(`你被抬出了竞技场（HP ${revived}）。`);
    parts.push(`（累计 ${st.wins} 胜 ${st.losses} 负）`);
    return {
      lost: true, rankText, fameLoss, revisedHp: revived, arenaMap, petMode,
      leaveMap: true,
      message: parts.join(''),
    };
  }

  /**
   * 成绩（var_506 == 23 人 / 42 宠物）—— 417234-417239：
   *   「現在は var_132(22 或 23) 勝だ。3勝、5勝、10勝、20勝、30勝、50勝、100勝の
   *     倍数毎にボーナスを与える」
   * 顺带报出 ranktitle（319-333）算出的称号与位次。
   * @param {object} g
   * @param {number} [cat] 0 = 竞技场（120/22），1 = 宠物竞技场（121/23）
   */
  function scoreText(g, cat) {
    const pet = (cat | 0) === 1;
    const d = a132(g);
    const wins = (pet ? d[23] : d[22]) | 0;
    const st = stats(g);
    const parts = [];
    if (!wins && !st.wins && !st.losses) {
      parts.push('「你还没有参加过比赛，随时可以来挑战。」');
    } else {
      parts.push(`「现在是 ${wins} 胜。每逢 3 / 5 / 10 / 20 / 30 / 50 / 100 胜的倍数都会给奖励。」`);
    }
    if (Elona.Rank && Elona.Rank.title) {
      try {
        const pos = Elona.Rank.position ? (Elona.Rank.position(g, pet ? 1 : 0) | 0) : 0;
        const t = Elona.Rank.title(g, pet ? 1 : 0, 'ch');
        if (t) parts.push(`你现在被称为「${t}」${pos ? `（第 ${pos} 位）` : ''}。`);
      } catch (e) { /* 排名表未就绪 */ }
    }
    const total = st.wins + st.losses;
    if (total) {
      const rate = idiv(st.wins * 100, total);
      parts.push(`累计 ${st.wins} 胜 ${st.losses} 负（胜率 ${rate}%）。`);
    }
    return parts.join('');
  }

  Elona.Arena = { start, onKill, onPlayerDown, stats, scoreText, opponentLevel, curDay, placeArena,
    days, restoreWithdrawn,
    // 0-HU / A200
    absHours, a132, cooldown, markStarted, fameReward, setQuestMode, EXCLUDE_RACES,
    // 0-HV / A200：报价 → 换图 → 摆位 → 结算 → 离场
    quote, beginBattle, walkableAt, setArenaMode, minOpponentLevel, isPetArena, countOf,
    inArena, decfame, teamFame, ARENA_MAPS };
})(window);
