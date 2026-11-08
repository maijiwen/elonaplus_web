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
 *   40/41/49：宠物决斗 / 团队战 / EX 战（需要宠物与队伍系统，本实现未做，登记 A199）
 *
 * 【本实现的近似】
 *   · 对手用 Elona.CharaFactory.pick 生成（等级随玩家），数量 1（决斗）/ 3（乱斗）
 *   · 用 g.arena 记录当前对局；击杀全部对手 → 结算（金币 + 胜场）；
 *     玩家倒下 → 记败场（在 game 的死亡分支调用 onPlayerDown）
 *   · 每日次数见 days(g)：决斗/乱斗各 1 次、宠物竞技场 3 次
 *   · 成绩存在 g.arenaStats = { wins, losses }（随存档序列化）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /** 当前游戏内「日」序号（年*360 + 月*30 + 日，与 quest.curDay 同量纲） */
  function curDay(g) {
    const y = g.getV65(10) | 0, mo = g.getV65(11) | 0, d = g.getV65(13) | 0;
    return y * 360 + mo * 30 + d;
  }

  function stats(g) {
    if (!g.arenaStats) g.arenaStats = { wins: 0, losses: 0 };
    return g.arenaStats;
  }

  /** 竞技场对手等级（416986-416990）：(100 - var_65(120)/100)/3*2+3，不低于 var_132(22)（此处用玩家等级近似） */
  function opponentLevel(g) {
    const p = g.player;
    const base = idiv((100 - idiv(g.getV65(120) | 0, 100)), 3) * 2 + 3;
    return Math.max(limit((p && p.level) | 0, 1, 2000), base, 1);
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

  function start(g, keeper, mode, opt) {
    if (g.arena) return { ok: false, message: '比赛正在进行中。' };
    const d = days(g);
    const isPetMode = (mode === 'pet-duel' || mode === 'pet-team' || mode === 'pet-ex');
    if (isPetMode && d.pet >= 3) {
      return { ok: false, message: '「今天的比赛已经结束了，明天再来吧。」' };
    }
    if (!isPetMode && mode === 'rumble' && d.rumble >= 1) {
      return { ok: false, message: '「今天的乱斗已经结束了，明天再来吧。」' };
    }
    if (!isPetMode && mode !== 'rumble' && d.duel >= 1) {
      return { ok: false, message: '「今天的决斗已经结束了，明天再来吧。」' };
    }
    // 0-CF：宠物战（40/41/49）—— 对手数量与等级按出战宠物决定，进入地图实打
    const isPet = (mode === 'pet-duel' || mode === 'pet-team' || mode === 'pet-ex');
    let pet = null, petIdx = -1;
    if (isPet) {
      const pets = (Elona.Party && Elona.Party.pets) ? Elona.Party.pets(g) : [];
      if (!pets.length) return { ok: false, message: '「你还没有可以出战的宠物。」' };
      petIdx = (opt && opt.petIndex !== undefined && pets.find((c) => c.index === opt.petIndex))
        ? opt.petIndex : pets[0].index;
      pet = g.charas[petIdx];
      if (!pet) return { ok: false, message: '找不到出战的宠物。' };
    }
    const n = mode === 'rumble' ? 3
      : (mode === 'pet-team' ? 3 : (mode === 'pet-ex' ? 5 : 1));
    const petLv = pet ? Math.max(1, (pet.get(38) | 0) || 1) : 1;
    const lv = isPet
      ? Math.max(1, petLv + (mode === 'pet-ex' ? 5 : 2))
      : opponentLevel(g);
    const picked = [];
    for (let i = 0; i < n; i++) {
      // 0-CM：map_placearena 区域放置（227999 普通竞技场传 0、238805 宠物竞技场传 1）
      let spot = placeArena(g, isPet ? 1 : 0);
      if (!spot) spot = freeCellNear(g, keeper, 5);   // 地形不满足时回退
      if (!spot) break;
      let cid = 0;
      try {
        cid = Elona.CharaFactory ? Elona.CharaFactory.pick(g, lv, {}) : 0;
      } catch (e) { cid = 0; }
      if (!cid) break;
      let slot = -1;
      for (let k = 57; k < 245; k++) {
        const c = g.charas[k];
        if (!c || (c.get(0) | 0) !== 1) { slot = k; break; }
      }
      if (slot < 0) break;
      let opp = null;
      try {
        opp = Elona.CharaFactory.create(g, cid, lv, spot.x, spot.y, { index: slot });
      } catch (e) { opp = null; }
      if (!opp) continue;
      opp.index = slot;
      opp.set(0, 1);
      opp.set(9, -3);                        // 敌对
      opp.x = spot.x; opp.y = spot.y;
      g.charas[slot] = opp;
      picked.push(slot);
    }
    if (!picked.length) return { ok: false, message: '找不到合适的对手……' };
    // 416943-416960：骑乘中 → 立刻下马
    if (Elona.Riding && Elona.Riding.mountOf && Elona.Riding.mountOf(g)) {
      try { Elona.Riding.dismount(g); } catch (e) { /* 忽略 */ }
    }
    // 竞技场是单人战：同伴退场（原版通过换图把队伍留在外面；这里用状态 7 近似）
    const withdrawn = [];
    for (let i = 1; i < 16; i++) {
      const c = g.charas && g.charas[i];
      if (!c || c.get(0) !== 1) continue;
      if (isPet && i === petIdx) continue;             // 宠物战保留出战宠物
      withdrawn.push(i);
      c.set(0, 7);
      c.set(201, 0);
      c.set(9, 0);
    }
    if (g.syncCharaCells) g.syncCharaCells();
    g.arena = { mode, opponents: picked.slice(), alive: picked.length, level: lv,
      petMode: isPet, petIndex: petIdx, withdrawn };
    if (isPetMode) d.pet++;
    else if (mode === 'rumble') d.rumble++;
    else d.duel++;
    const label = isPet
      ? (mode === 'pet-team' ? '团队战' : (mode === 'pet-ex' ? 'EX 战' : '宠物决斗'))
      : (mode === 'rumble' ? '乱斗' : '决斗');
    const reward = lv * 100 * picked.length;
    g.arena.reward = reward;
    const who = isPet ? `你的宠物 ${pet.name} 出战` : '你';
    return {
      ok: true, opponents: picked, level: lv, reward, petMode: isPet,
      message: `【${label}】${who}，对手是 ${picked.length} 名等级约 ${lv} 的战士。胜利可获得 ${reward} gold。`,
    };
  }

  /** 对手被击杀 —— 由 KillReward.onKill 调用；全灭时结算 */
  function onKill(g, def) {
    const a = g.arena;
    if (!a || !def) return null;
    const idx = a.opponents.indexOf(def.index);
    if (idx < 0) return null;
    a.alive = Math.max(0, a.alive - 1);
    if (a.alive > 0) return { alive: a.alive, message: `还剩 ${a.alive} 名对手。` };
    // 全灭结算 —— 591379-591430：名声 var_65(74)，胜场 3/10/30/50/100 掉奖励
    const st = stats(g);
    st.wins++;
    const p = g.player;
    const fameGain = a.fame || (50 + (a.level | 0) * 2);
    let reward = 0;
    const drops = [];
    let rankText = '';
    let matText = '';
    if (p) {
      p.set(34, (p.get(34) | 0) + fameGain);
      // 591309 / 591388：宠物竞技场 modrank 1，普通竞技场 modrank 0（单次最多 2 位）
      if (Elona.Rank && Elona.Rank.modRank) {
        try {
          const rr = Elona.Rank.modRank(g, a.petMode ? 1 : 0, 100, 2);
          if (rr && rr.text) rankText = rr.text;
        } catch (e) { /* 排名表未就绪 */ }
      }
      const total = (a.petMode ? (g.petWins = (g.petWins || 0) + 1) : (g.arenaWins = (g.arenaWins || 0) + 1));
      let tier = 0;
      if (total % 100 === 0) tier = 100;
      else if (total % 50 === 0) tier = 50;
      else if (total % 30 === 0) tier = 30;
      else if (total % 10 === 0) tier = 10;
      else if (total % 3 === 0) tier = 3;
      if (tier === 100) {
        p.set(34, (p.get(34) | 0) + 30000);
        const n = limit(idiv(total, 100) + 1, 2, 4);
        for (let k = 0; k < n; k++) drops.push(711);
      } else if (tier === 50) drops.push(900);
      else if (tier === 30) drops.push(430);
      else if (tier === 10) drops.push(1173);
      else if (tier === 3) drops.push(372);
      // 591336-591343 / 591422-591429：胜场数每 5 给材料 40、每 20 给材料 41
      if (tier !== 100 && Elona.Material && Elona.Material.add) {
        const nWin = a.petMode ? (g.petWins | 0) : (g.arenaWins | 0);
        const matId = (nWin % 20 === 0) ? 41 : ((nWin % 5 === 0) ? 40 : 0);
        if (matId) {
          try {
            const mr = Elona.Material.add(g, matId, 1, 6);
            if (mr && mr.name) matText = `，并获得材料「${mr.name}」`;
          } catch (e) { /* 材料表未就绪 */ }
        }
      }
      for (const id of drops) {
        let it = null;
        try { it = Elona.ItemDB.create(g, { itemId: id }); } catch (e) { it = null; }
        if (!it) continue;
        it.f[0] = 1; it.eqSlot = -1; it.f[17] = 0;
        it.f[5] = p.x; it.f[6] = p.y;
        if (g.groundItems) g.groundItems.push(it);
        else p.inv.push(it);
      }
    }
    reward = 0;
    // 0-CF：宠物战胜利 → 出战宠物获得经验（原版是宠物成长的主要来源之一）
    let petGain = null;
    if (a.petMode && a.petIndex >= 0) {
      const pet = g.charas[a.petIndex];
      if (pet && (pet.get(0) | 0) === 1 && Elona.Stats && Elona.Stats.skillExp) {
        Elona.Stats.skillExp(pet, 104, pet.index | 0, 200 + (a.level | 0) * 30, 1, 0, g);
        petGain = 200 + (a.level | 0) * 30;
      }
    }
    const modeLabel = a.petMode
      ? (a.mode === 'pet-team' ? '团队战' : (a.mode === 'pet-ex' ? 'EX 战' : '宠物决斗'))
      : (a.mode === 'rumble' ? '乱斗' : '决斗');
    restoreWithdrawn(g, a);
    g.arena = null;
    const dropTxt = drops.length ? `，脚下出现了 ${drops.length} 件奖励` : '';
    return { won: true, reward, fame: fameGain, drops, petGain, rankText, matText,
      message: `${modeLabel}胜利！获得 ${fameGain} 名声${dropTxt}${matText}${rankText ? `。${rankText}` : ''}${petGain ? `，宠物获得 ${petGain} 经验` : ''}（累计 ${st.wins} 胜 ${st.losses} 负）。` };
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

  /** 玩家倒下 —— 由 game 的死亡分支调用 */
  function onPlayerDown(g) {
    const a = g.arena;
    if (!a) return null;
    const st = stats(g);
    st.losses++;
    // 591354-591356：败北只扣名声 60（没有死亡惩罚）
    const p = g.player;
    let rankText = '';
    if (p) {
      const f = p.get(34) | 0;
      p.set(34, Math.max(0, f - 60));
      // 591189（普通）/ 591354（宠物）：modrank -100
      if (Elona.Rank && Elona.Rank.modRank) {
        try {
          const rr = Elona.Rank.modRank(g, a.petMode ? 1 : 0, -100, 0);
          if (rr && rr.text) rankText = rr.text;
        } catch (e) { /* 排名表未就绪 */ }
      }
    }
    restoreWithdrawn(g, a);
    g.arena = null;
    return { lost: true, rankText,
      message: `比赛失败……失去了 60 点名声${rankText ? `。${rankText}` : ''}（累计 ${st.wins} 胜 ${st.losses} 负）` };
  }

  /** 成绩文本（var_506 == 23 / 42） */
  function scoreText(g) {
    const st = stats(g);
    const total = st.wins + st.losses;
    if (!total) return '「你还没有参加过比赛。」';
    const rate = idiv(st.wins * 100, total);
    return `「你的战绩：${st.wins} 胜 ${st.losses} 负（胜率 ${rate}%）。」`;
  }

  Elona.Arena = { start, onKill, onPlayerDown, stats, scoreText, opponentLevel, curDay, placeArena,
    days, restoreWithdrawn };
})(window);
