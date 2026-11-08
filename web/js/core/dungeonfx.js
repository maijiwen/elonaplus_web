'use strict';
/**
 * 地城机制补充包（core/dungeonfx.js）—— 0-FB
 *
 * 承载四项 wiki「地城」页要求、但 0-FA 尚未落地的机制：
 *   ① 8 类怪物种族分布（`fltn "nefia1".."nefia8"`）
 *   ② 陷阱的生成放置 / 探知 / 拆除 / 深渊魔力奖励
 *   ③ 独立宝箱（锁等级、开锁、内容生成）
 *   ④ 按地城类型（`var_126(6)`）分表的挖墙掉落
 * 以及用户点名的**击破掉落**（记忆碎片 1191 / 奈菲亚之核 969 / 小徽章 622 / 白金币）。
 *
 * 【权威源码 hsp/start.hsp】
 *   击破掉落       609445-609735（var_1302 == 5 分支，玩家脚下 itemcreate）
 *   觉醒种子       247590-247604（var_132(38) 深层标记、var_132(35) 核心品质种子）
 *   969 生成特判   224599-224760（f[25] 由 var_132(35) 决定，按值附 3xxxx 附魔）
 *   容器生成特判   224785-224806（f[25] 内容编号 / f[26] 锁等级 / f[27] 随机种子）
 *   容器打开       344910-344940（f[25]=0 空、f[26]>0 → 开锁、否则 label_3000）
 *   开锁           *label_2994/2995/2997（344646-344750）
 *   宝箱内容       *label_3000（345092-345292）
 *   种族分布       236719-236753（nefia tag 与 kind 的对应不是顺序的）
 *   陷阱放置       map_trap 228983-229030、map_web 229031-229054、map_barrel 229055-229078
 *   放置数量       230989-231013（觉醒层 8 的个位、网、木桶）
 *   挖墙掉落       313181-313481（var_444 按 var_126(6) 分表）
 *
 * 【物品 id 语义（items.json 核对）】
 *   54 金币 / 55 白金币 / 236 归还卷轴 / 238- / 239 宝石宝箱 / 241 金库
 *   622 小徽章 / 638 脱出卷轴 / 969 奈菲亚之核 / 1191 记忆碎片 / 1204 变忆结晶
 *   636 开锁工具 / 637 万能钥匙 / 559 以太抗体药 / 1041 铜币 / 1255 灵力结晶
 *   283 袋（偷来的）/ 284 小钱包 / 734 钱包 / 415/416 宝石箱（稀有池）
 *
 * 【项目侧对照】
 *   var_132(n, map) → 本项目用 `g.dungeon*` 字段（见 game.js 构造）：
 *     var_132(32) 觉醒 → g.dungeonAwake；var_132(35) → g.dungeonCoreSeed；
 *     var_132(38) → g.dungeonMedalSeed；var_65(22) 层数 → g.dungeonDepth
 *   var_65(250+353) 狂热 → g.getV65(603) === 100（core/daily.js 已实现）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const idiv = (a, b) => Math.floor((a | 0) / (b || 1));
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

  function rndOf(g) {
    const owner = (g && g.rng) ? g.rng : (Elona.rng || null);
    if (owner && typeof owner.rnd === 'function') return (n) => owner.rnd(Math.max(1, n | 0));
    return () => 0;
  }
  function V(g, n) { return (g && g.getV65) ? (g.getV65(n) | 0) : 0; }
  function S(g, n, v) { if (g && g.setV65) g.setV65(n, v | 0); }
  /** 当前地图类型 var_126(6)：1 = 世界地图 */
  function mapType(g) {
    try { return (g.map && g.map.header) ? (g.map.header[6] | 0) : 0; } catch (e) { return 0; }
  }
  function depthOf(g) {
    if (g && g.dungeonDepth) return g.dungeonDepth | 0;
    return V(g, 22) | 0;
  }
  /** 狂热状态 var_65(250+353) == 100 */
  function isFever(g) { return V(g, 603) === 100; }

  // ==========================================================================
  // 一、击破掉落（609445-609735）
  // ==========================================================================

  /** 609470-609698：地城主素材按**种族名**取（`var_63(2, boss)`），缺省 175 */
  const MAT = {
    kobolt: 300, orc: 168, largeanimal: 162, lizardman: 168, minotaur: 186,
    yerles: 111, norland: 167, eulderna: 160, fairy: 300, asura: 166,
    slime: 173, doggod: 186, dwarf: 163, juere: 183, zombie: 184,
    elea: 165, rabbit: 182, sheep: 177, frog: 190, worm: 163,
    snail: 111, mandrake: 165, beetle: 172, mushroom: 180, bat: 187,
    ent: 176, lich: 174, bacteria: 151, ghost: 175, spirit: 160,
    eye: 151, mazin: 152, wasp: 180, giant: 161, imp: 156,
    hand: 184, snake: 157, drake: 188, goblin: 185, bear: 186,
    armor: 158, medusa: 178, cupid: 188, karune: 180, harpy: 164,
    dragon: 179, dinosaur: 182, beast: 172, spider: 177, golem: 153,
    rock: 189, zanan: 183, skeleton: 158, piece: 152, cat: 187,
    dog: 190, roran: 150, rat: 157, shell: 162, catgod: 187,
    machinegod: 189, undeadgod: 188, machine: 176, wisp: 155, bird: 161,
    seamonster: 181, catsister: 167, mutant: 164, yeek: 156, yith: 174,
    servant: 172, horse: 153, god: 166, quickling: 173, metal: 179,
    vehicle: 175,
  };
  const MAT_DEFAULT = 175;

  /** 969 生成时的附魔表（224606-224750）：f[25] → encadd 30000+id，威力 500 */
  const CORE_ENC = [
    168, 173, 166, 167, 152, 189, 154, 175, 169, 170, 171,
    157, 187, 155, 174, 188, 172, 153, 176, 177, 179, 300,
    190, 185, 161, 150, 151, 165, 181, 156, 160, 183, 301,
  ];

  /** calcfame（32217-32222） */
  function calcFame(g, base) {
    const p = g && g.player;
    const f34 = p ? (p.get(34) | 0) : 0;
    let v = idiv((base | 0) * 100, 100 + idiv(idiv(f34, 100) * idiv(f34, 100), 2500));
    if (v < 5) v = rndOf(g)(5) + 1;
    return v;
  }

  /** 种族名（creature.json 的 race 字段；兼容 dead.race） */
  function raceNameOf(g, c) {
    if (!c) return '';
    if (c.race) return String(c.race);
    const CRE = Elona.CharaFactory && Elona.CharaFactory.creTable;
    if (!CRE || typeof c.get !== 'function') return '';
    const rec = CRE[String(c.get(27) | 0)] || null;
    return (rec && rec.race) ? String(rec.race) : '';
  }
  function materialOf(g, c) {
    const r = raceNameOf(g, c);
    return MAT[r] !== undefined ? MAT[r] : MAT_DEFAULT;
  }

  /** 969 的 f[25]/附魔（224599-224760）：任何 969 生成都走这里 */
  function applyCoreSeed(g, it, seed) {
    if (!it || (it.id | 0) !== 969) return it;
    const R = rndOf(g);
    let q;
    if ((seed | 0) <= 0) q = R(50);
    else q = (seed | 0) - 1;
    it.f[25] = q;
    if (q >= 0 && q < CORE_ENC.length && Elona.ItemDB && Elona.ItemDB.encadd) {
      Elona.ItemDB.encadd(it, 3 * 10000 + CORE_ENC[q], 500, g, { noFilter: true });
    }
    return it;
  }

  /**
   * 击破地城主后的掉落（609445-609735）。
   * 全部落在**玩家脚下**（源码 var_58(1,0)/var_58(2,0)）。
   * @param {object} g
   * @param {object} dead 地城主
   * @param {object} [out] RandDungeon.onBossKilled 的返回对象（追加 messages）
   */
  function onBossKilled(g, dead, out) {
    const I = Elona.ItemDB;
    if (!g || !I) return null;
    const R = rndOf(g);
    const depth = clamp(depthOf(g), 1, 400);
    const awake = !!g.dungeonAwake;
    const fever = isFever(g);
    const px = g.player ? (g.player.x | 0) : 0;
    const py = g.player ? (g.player.y | 0) : 0;
    const res = out || { messages: [] };
    res.drops = [];
    const give = (it) => {
      if (!it) return null;
      if (Elona.Loot && Elona.Loot.dropGround) Elona.Loot.dropGround(g, it, px, py);
      res.drops.push(it);
      return it;
    };
    const mk = (id, n) => give(I.createItem(id, Math.max(1, n | 0)));

    // ---- 609446-609459：固定杂项 ----
    const level = I.calcObjLv(depth, g);
    const fix = I.calcFixLv(2, g);
    give(I.create(g, { level, fix, t638: 54000 }));            // 食物（54000 类）
    mk(638, 1);                                                // 脱出の巻物
    mk(236, 1);                                                // 帰還の巻物
    const goldVal = clamp(depth * 50 + depth * Math.sqrt(depth + 1) * 5 + 200, 300, 50000);
    mk(54, Math.round(goldVal));                               // 金币
    mk(55, clamp(1 + idiv(depth, 20), 1, 5));                  // 白金币
    const gemBox = mk(239, 1);                                 // 宝石宝箱
    if (gemBox) {
      genContainerFields(g, gemBox, depth);
      gemBox.f[26] = 0;                                        // 609460：var_99(26) = 0，不上锁
    }

    // ---- 609461-609469：首杀计数（250+426 → 250+428，上限 7）----
    if (V(g, 20) !== 42 && V(g, 676) < 1) {
      S(g, 676, V(g, 676) + 1);
      if (V(g, 676) >= 1 && V(g, 678) < 7) S(g, 678, V(g, 678) + 1);
    }

    // ---- 609470-609714：记忆碎片 / 变忆结晶 ----
    const mat = materialOf(g, dead);
    const bonus = (awake ? 1 : 0) + (fever ? 1 : 0);           // var_2111
    const frags = mk(1191, 1 + bonus);
    if (frags) {
      frags.f[25] = mat;                                       // 素材
      frags.f[26] = clamp(depth, 1, 999);                      // 记忆强度 = 层数
      frags.f[17] = 0;                                         // 清诅咒
    }
    const crys = mk(1204, clamp(1 + idiv(depth, 50), 1, 5) + bonus);
    if (crys) {
      crys.f[25] = mat;
      crys.f[17] = 0;
    }
    res.material = mat;
    res.fragments = 1 + bonus;
    res.crystals = clamp(1 + idiv(depth, 50), 1, 5) + bonus;

    // ---- 609716-609727：深层标记 → 小徽章 ----
    const medalSeed = g.dungeonMedalSeed | 0;
    if (medalSeed > 0) {
      let n = 1;
      if (fever) n++;
      if (awake) n++;
      mk(622, n);
      res.medals = n;
    }
    g.dungeonMedalSeed = 0;                                    // 609728

    // ---- 609729-609735：觉醒 + 核心种子 → 奈菲亚之核 ----
    const coreSeed = g.dungeonCoreSeed | 0;
    if (awake && coreSeed > 0) {
      const core = mk(969, 1);
      applyCoreSeed(g, core, coreSeed);
      res.core = true;
    }
    g.dungeonCoreSeed = 0;                                     // 609735

    // ---- 609736-609761：最深记录 + 名声 ----
    if (V(g, 189) < depth) S(g, 189, depth);
    const fameGain = calcFame(g, depth * 30 + 200);
    S(g, 74, fameGain);
    if (g.player) g.player.set(34, (g.player.get(34) | 0) + fameGain);
    res.fame = fameGain;

    // ---- 609752：modrank 2, 300, 8 ----
    if (Elona.Rank && Elona.Rank.modRank) Elona.Rank.modRank(g, 2, 300, 8);

    if (g.log) {
      g.log('何かが足元に転がってきた。');
      g.log(`获得 ${fameGain} 点名声。`);
    }
    res.messages.push('有什么东西滚到了脚边。');
    res.messages.push(`获得 ${fameGain} 点名声。`);
    return res;
  }

  // ==========================================================================
  // 二、觉醒种子（247590-247604）
  // ==========================================================================
  /**
   * 进入随机地城时骰两个种子：
   *   var_132(38)：`rnd(层数)`，<50 → -1（永不掉小徽章），否则保留
   *   var_132(35)（仅觉醒）：`rnd(层数)`，<50 → -1；≥50 → `rnd(50)+1`
   * @returns {{medalSeed:number, coreSeed:number}}
   */
  function rollSeeds(g, depth, awake) {
    const R = rndOf(g);
    const d = Math.max(1, depth | 0);
    let medal = 0;
    if (g.isRandomDungeon && !(g.dungeonMedalSeed | 0)) {
      medal = R(d);
      if (medal < 50) medal = -1;
    } else {
      medal = g.dungeonMedalSeed | 0;
    }
    let core = g.dungeonCoreSeed | 0;
    if (awake && core === 0) {
      core = R(d);
      if (core < 50) core = -1;
      else core = R(50) + 1;
    }
    g.dungeonMedalSeed = medal;
    g.dungeonCoreSeed = core;
    return { medalSeed: medal, coreSeed: core };
  }

  // ==========================================================================
  // 三、8 类怪物种族分布（236719-236753）
  // ==========================================================================
  /** kind（20..27）→ nefia tag；注意 21↔nefia3、22↔nefia2 的**非顺序**对应 */
  const KIND_TAG = {
    20: 'nefia1', 21: 'nefia3', 22: 'nefia2', 23: 'nefia4',
    24: 'nefia5', 25: 'nefia6', 26: 'nefia7', 27: 'nefia8',
  };

  /**
   * 随机地城选怪用的 tag（`fltn`）。
   * 1/20 概率用 `nefia0`（跨种类），否则按 kind 取。
   * 非随机地城返回 ''（不传 tagName）。
   * @returns {string}
   */
  function kindTag(g, kind) {
    if (!g || !g.isRandomDungeon) return '';
    if (rndOf(g)(20) === 0) return 'nefia0';
    return KIND_TAG[kind | 0] || 'nefia0';
  }

  // ==========================================================================
  // 四、陷阱 / 网 / 木桶的生成放置（228983-229078、230989-231013）
  // ==========================================================================
  /** map_trap 的深度过滤（229005-229022）：id 6/1/5 在 ≤5 层不出现，7 在 ≤25 层不出现 */
  function trapIdAllowed(g, id) {
    const d = depthOf(g);
    if (d <= 5 && (id === 6 || id === 1 || id === 5)) return false;
    if (d <= 25 && id === 7 && V(g, 70) !== 1013) return false;
    return true;
  }

  /**
   * 找可放置格：可站立（tileAttr 第 7 位 & 4 == 0）且无 feat。
   * `cells`/`attrOf` 供 generateDungeon 阶段使用（此时还没有 g.map）。
   */
  function pickFeatCell(g, W, H, R, cells, attrOf) {
    for (let t = 0; t < 200; t++) {
      const x = R(W - 5) + 2;
      const y = R(H - 5) + 2;
      const cell = cells ? (cells[y] && cells[y][x]) : (g.map && g.map.cell(x, y));
      if (!cell) continue;
      if (cells && (cell[0] | 0) !== 33) continue;         // 生成阶段只认地板
      const attr = cells
        ? (attrOf ? attrOf(cell[0], 7) : 0)
        : g.map.attr(cell[0], 7);
      if ((attr & 4) !== 0) continue;                      // 不可站
      if ((cell[6] | 0) !== 0) continue;                   // 已有 feat
      return { x, y, cell };
    }
    return null;
  }

  /** map_trap（228983-229030）：放陷阱，返回是否成功 */
  function placeTrap(g, x, y, depth) {
    const M = Elona.MapFeat;
    if (!M) return false;
    const R = rndOf(g);
    // prm_1126 == 0 → rnd(10)（229000-229004）
    const sub = R(10);
    if (!trapIdAllowed(g, sub)) return false;
    M.write(g, x, y, 0, M.TYPE.TRAP, sub, 0);              // cell_featset x,y,0,14,sub
    return true;
  }

  /**
   * 生成一层的陷阱 / 网 / 木桶（230989-231013）。
   * @param {object} g
   * @param {number} W
   * @param {number} H
   * @param {number} depth
   * @param {boolean} awake 觉醒地城
   * @param {object} [ctx] { cells, attrOf } —— 生成阶段直接写 cells
   * @returns {{traps:number, webs:number, barrels:number}}
   */
  function placeFloorHazards(g, W, H, depth, awake, ctx) {
    const R = rndOf(g);
    const M = Elona.MapFeat;
    if (!M) return { traps: 0, webs: 0, barrels: 0 };
    const c = ctx || {};
    const out = { traps: 0, webs: 0, barrels: 0 };
    const d = depth | 0;

    // 230989：觉醒层个位 8 → 密集陷阱（W*H/5），否则 rnd(W*H/80)
    let trapN;
    if (awake && ((d % 10) + 10) % 10 === 8) trapN = idiv(W * H, 5);
    else trapN = R(idiv(W * H, 80) || 1);
    for (let i = 0; i < trapN; i++) {
      const p = pickFeatCell(g, W, H, R, c.cells, c.attrOf);
      if (!p) break;
      if (placeTrapAt(g, p.cell, d)) out.traps++;
    }

    // 230999：1/5 概率铺网；网数量再 1/5 概率放大到 W*H/5
    //   网是 MEF（addmef x,y,1,11,-1,depth*10+100），而 Mef.add 是实例方法且需要 g.map，
    //   生成阶段两者都不存在 —— 这里只收集坐标，由 `enterDungeon` 在 g.mef 建好后铺。
    out.webCells = [];
    if (R(5) === 0) {
      let webN = R(idiv(W * H, 40) || 1);
      if (R(5) === 0) webN = R(idiv(W * H, 5) || 1);
      for (let i = 0; i < webN; i++) {
        const p = pickFeatCell(g, W, H, R, c.cells, c.attrOf);
        if (!p) break;
        out.webCells.push({ x: p.x, y: p.y, power: d * 10 + 100 });
        out.webs++;
      }
    }

    // 231008：1/4 概率放木桶（feat type 30）
    if (R(4) === 0) {
      const barrelN = clamp(R(idiv(W * H, 500) + 1) + 1, 3, 15);
      for (let i = 0; i < barrelN; i++) {
        const p = pickFeatCell(g, W, H, R, c.cells, c.attrOf);
        if (!p) break;
        p.cell[6] = M.TYPE.POT + M.TYPE.POT * 1000;        // cell_featset x,y,var_1624,30
        out.barrels++;
      }
    }
    return out;
  }

  /** 直接在 cell 上写陷阱（生成阶段没有 g.map） */
  function placeTrapAt(g, cell, depth) {
    const M = Elona.MapFeat;
    if (!cell) return false;
    const sub = rndOf(g)(10);
    if (!trapIdAllowed(g, sub)) return false;
    cell[6] = 0 + M.TYPE.TRAP * 1000 + sub * 100000;
    return true;
  }

  // ==========================================================================
  // 五、宝箱：生成特判 / 开锁 / 内容生成
  // ==========================================================================
  const CONTAINER_CAT = 72000;      // refitem(id,5)

  /**
   * 容器创建特判（224785-224806）。
   *   f[25] = 层数+5（内容编号；本项目兼作「未开箱」标记）
   *   f[26] = rnd(层数+1)（锁等级 Lock-Lv）
   *   f[27] = rnd(30000)（随机种子）
   * 283 袋 / 284 小钱包 / 415·416 宝石箱 / 734 钱包另有覆盖。
   */
  function genContainerFields(g, it, depth) {
    if (!it || !Elona.ItemDB) return it;
    const I = Elona.ItemDB;
    if ((I.ref(it.id, 5) | 0) !== CONTAINER_CAT) return it;
    const R = rndOf(g);
    const d = Math.max(0, depth | 0);
    const onMap30 = V(g, 20) === 30;                       // var_65(20) != 30
    const id = it.id | 0;
    it.f[25] = d * (onMap30 ? 0 : 1) + 5;
    if (id === 1105) it.f[25] = 0;
    const p = g && g.player;
    const plv = p ? (p.get(38) | 0) : 1;
    if (id === 283) it.f[25] = (R(10) + 1) * (idiv(plv, 10) + 1);
    if (id === 415 || id === 416) it.f[25] = plv;
    it.f[26] = R(Math.abs(d) * (onMap30 ? 0 : 1) + 1);
    if (id === 284 || id === 283) it.f[26] = R(15);
    it.f[27] = R(30000);
    if (id === 734) {
      it.f[26] = clamp(R(I.calcObjLv(d, g) + 2) + 1, 1, 200);
      it.f[1] = (it.f[26] | 0) * 25 + 150;
    }
    return it;
  }

  /**
   * 开锁（label_2994/2995/2997，344646-344750）。
   * 需要背包里有 636（开锁工具）；有 637（万能钥匙）时技能 +50%。
   * 失败 1/3 概率损耗一把 636。
   * @returns {{ok:boolean, reason?:string, power?:number, lock?:number}}
   */
  function tryUnlock(g, c, it) {
    const I = Elona.ItemDB;
    if (!I) return { ok: false, reason: 'no-itemdb' };
    const R = rndOf(g);
    const lock = clamp(it.f[26] | 0, 0, 2000);             // var_2535
    const inv = (c && c.inv) || [];
    let pick = -1, key = -1;
    for (let i = 0; i < inv.length; i++) {
      const x = inv[i];
      if (!x || (x.f[0] | 0) <= 0) continue;
      if ((x.id | 0) === 636 && pick < 0) pick = i;
      if ((x.id | 0) === 637 && key < 0) key = i;
    }
    if (pick < 0) return { ok: false, reason: 'no-lockpick', lock };
    const skill = c.skill(158) | 0;
    const power = key >= 0 ? idiv(skill * 150, 100) + 5 : skill;   // var_399
    if (power * 2 < lock) return { ok: false, reason: 'beyond', power, lock };
    if (idiv(power, 2) >= lock) {
      // 「楽勝だ」→ 必成
    } else if (R(R(power * 2) + 1) < lock) {
      // 失败：1/3 损耗工具
      if (R(3) === 0) {
        inv[pick].f[0] = (inv[pick].f[0] | 0) - 1;
        if ((inv[pick].f[0] | 0) <= 0) inv[pick] = null;
      }
      return { ok: false, reason: 'fail', power, lock };
    }
    // 成功：skillexp 158, 100 + clamp(lock*2,1,400)
    if (Elona.Stats && Elona.Stats.skillExp && c.get(0) === 1) {
      Elona.Stats.skillExp(c, 158, c.index, 100 + clamp(lock * 2, 1, 400), 9999, 0, g);
    }
    return { ok: true, power, lock };
  }

  /** var_1513（222063）：宝箱内容抽的 13 个大类 */
  const CHEST_CATS = [10000, 24000, 12000, 16000, 20000, 19000, 18000,
    22000, 14000, 32000, 34000, 54000, 59000];
  /** var_645（222064）：稀有池（415/416 宝石箱） */
  const RARE_CATS = [10000, 10000, 24000, 24000, 25000, 12000, 16000,
    20000, 19000, 18000, 22000, 14000, 32000, 34000];
  /** 345123：宝石宝箱 1/60 掉以太抗体药 */
  const ETHER_CURE = 559;

  /**
   * 宝箱内容生成（*label_3000，345092-345292）。
   * 物品落在玩家脚下（原版 itemcreate 到 var_58(1,0)/var_58(2,0)）。
   * @returns {{ok:boolean, spawned:number, gold?:number, items:Array}}
   */
  function rollChestContent(g, it) {
    const I = Elona.ItemDB;
    if (!g || !I) return { ok: false, spawned: 0, items: [] };
    const R = rndOf(g);
    const id = it.id | 0;
    const p = g.player || { x: 0, y: 0, get: () => 0, set: () => {} };
    const px = p.x | 0, py = p.y | 0;
    const res = { ok: true, spawned: 0, items: [] };
    const give = (x) => {
      if (!x) return null;
      if (Elona.Loot && Elona.Loot.dropGround) Elona.Loot.dropGround(g, x, px, py);
      res.items.push(x);
      res.spawned++;
      return x;
    };
    // 394：礼盒特效（var_396），本实现无特效系统，直接按普通箱处理
    let n = 3 + R(5);                                     // var_400
    if (id === 415 || id === 416 || id === 734) n = 1;
    const baseLv = clamp(it.f[25] | 0, 1, 2000);           // 内容等级 = f[25]
    for (let i = 0; i < n; i++) {
      // ---- 钱包类：只出金币（345162-345212）----
      if (id === 734) {
        const val = it.f[1] | 0;
        let amount;
        let jackpot = 0;
        if (R(30) === 0 && V(g, 347) === 100 && R(30) === 0) {
          amount = 20 * val; jackpot = 1;
        } else {
          amount = R(idiv(val, 10) + 1) + 1;
        }
        if (R(75) === 0 && V(g, 347) === 100) {
          amount = 50 * val + 7500; jackpot = 2;
        }
        give(I.createItem(54, Math.max(1, amount)));
        res.gold = (res.gold | 0) + amount;
        res.jackpot = jackpot || res.jackpot;
        continue;
      }
      if (id === 284) {
        let amount = R(1000) + 1;
        if (R(5) === 0) amount = R(9) + 1;
        if (R(10) === 0) amount = R(5000) + 5000;
        if (R(20) === 0) amount = R(20000) + 10000;
        give(I.createItem(54, amount));
        res.gold = (res.gold | 0) + amount;
        continue;
      }
      // ---- 一般内容 ----
      let forced = 0;                                     // var_60
      let fix = 3;                                        // var_400（每件重置为 3）
      if (id === 239 && R(60) === 0) forced = ETHER_CURE;
      let t638 = CHEST_CATS[R(CHEST_CATS.length)];
      let t639 = 0;
      if (i > 0 && R(3) !== 0) {
        if (R(3) !== 0) { t638 = 68000; t639 = 0; } else { t638 = 0; t639 = 77001; }
      }
      if (id === 241) {
        if (R(3) !== 0) { t638 = 68000; t639 = 0; } else { t638 = 0; t639 = 77001; }
      }
      if (id === 415 || id === 416) {
        t639 = 0;
        t638 = RARE_CATS[R(RARE_CATS.length)];
        fix = id === 416 ? 4 : 3;
        if (R(30) === 0) forced = ETHER_CURE;
      }
      const lv = I.calcObjLv(baseLv, g);
      const q = I.calcFixLv(fix, g);
      let item = null;
      if (forced) item = I.createItem(forced, 1);
      else item = I.create(g, { level: lv, fix: q, t638, t639 });
      give(item);
    }
    // ---- 345215-345290：追加掉落 ----
    if (id !== 734 && R(10) === 0) give(I.createItem(622, 1));
    if (id === 239 || id === 240) {
      if (R(10) === 0) give(I.createItem(622, 1));
    }
    if (id === 239) {
      give(I.createItem(422 + R(6), 1));                 // 素材（モージア..）
    } else if (id === 240) {
      if (R(4) === 0) give(I.createItem(422 + R(6), 1));
      else give(I.createItem(1255, 1));
    }
    if (id === 240 && R(2) === 0) give(I.createItem(1041, 1));
    if (id === 241 && R(4) === 0) give(I.createItem(1041, 1));
    if (id === 240 && (it.f[13] | 0) === 7 && R(30) === 0) give(I.createItem(290, 1));
    // ---- 345284-345291：钱包类业值 ----
    if (id === 284) modKarma(g, -4);
    if (id === 283) modKarma(g, -8);
    it.f[25] = 0;                                        // 已开
    if (g.log) g.log('内容物散落到了脚边。');
    return res;
  }

  function modKarma(g, v) {
    const p = g && g.player;
    if (!p) return 0;
    const cur = p.get(49) | 0;
    p.set(49, cur + (v | 0));
    return v;
  }

  /**
   * 打开容器的统一入口（344910-344940 的项目化包装）。
   *   ① f[25]==0 → 空箱，直接开面板
   *   ② f[26]>0（锁）→ 先开锁；失败则中止
   *   ③ 未开过（f[25]!=0）→ 生成内容到脚下，f[25]=0
   * @returns {{ok:boolean, locked?:boolean, empty?:boolean, result?:object, unlock?:object}}
   */
  function openChest(g, c, it) {
    if (!it) return { ok: false, reason: 'no-item' };
    const id = it.id | 0;
    if ((it.f[25] | 0) === 0) return { ok: true, empty: true };
    if ((it.f[26] | 0) > 0 && id !== 784 && id !== 1105) {
      const u = tryUnlock(g, c, it);
      if (!u.ok) return { ok: false, locked: true, unlock: u };
      it.f[26] = 0;                                      // 开过一次后不再上锁
    }
    const result = rollChestContent(g, it);
    return { ok: true, empty: false, result };
  }

  // ==========================================================================
  // 六、按地城类型的挖墙掉落（313181-313481）
  // ==========================================================================
  /**
   * var_444 判定表（313183-313266）：mapType = var_126(6)。
   * 每项 [分母, 物品 id]；-1 = 77000 类随机物。
   * 同一次结算里多个 if 会依次覆盖，因此用列表顺序模拟。
   */
  const DIG_TABLE = {
    2: [[3, 54], [30, 38]],          // 街道
    3: [[3, 54], [30, 38]],          // 城镇
    20: [[5, -1]],                   // 洞窟
    27: [[10, 220], [100, 1178], [120, 972]],          // 湖
    22: [[5, 942], [100, 943], [200, 946]],            // 森林
    21: [[8, 960], [120, 241]],                        // 塔
    23: [[8, 960], [120, 241]],                        // 营寨
    24: [[5, 575], [10, 573], [20, 571], [130, 1124]], // 巢窟
    25: [[10, 301], [20, 81], [30, 305], [180, 708]],  // 陵园
    26: [[5, 1122], [10, 1123], [40, 540], [300, 1066]], // 矿山
  };
  /** 船内（商船/海贼船）覆盖 313268-313277 */
  const SHIP_OVERRIDE = [[1, 45], [10, 43], [20, 936]];

  /**
   * 挖墙成功时的掉落判定（var_444）。
   * @param {object} g
   * @param {boolean} hasMineLamp 是否持有 1100（再判定一次）
   * @returns {number} 物品 id；0 = 无；-1 = 随机 77000 类
   */
  function rollDigDrop(g, hasMineLamp) {
    const R = rndOf(g);
    const mt = mapType(g);
    const table = DIG_TABLE[mt];
    if (!table) return 0;
    const roll = () => {
      let x = 0;
      for (const [denom, id] of table) {
        if (R(denom) === 0) x = id;
      }
      return x;
    };
    let v = roll();
    // 313279-313379：持有 1100（矿山灯）时**再掷一次整表**，非 0 则覆盖
    if (hasMineLamp) {
      const v2 = roll();
      if (v2 !== 0) v = v2;
    }
    // 船内：把任何结果换成杂物
    if (g.map && g.map.name && /商船|海贼船/.test(g.map.name)) {
      for (const [denom, id] of SHIP_OVERRIDE) {
        if (R(denom) === 0) v = id;
      }
    }
    return v;
  }

  /**
   * 挖穿后的掉落结算（313448-313481）。
   * @returns {{item:object|null, id:number, message:string}}
   */
  function digDrop(g, x, y) {
    const I = Elona.ItemDB;
    if (!g || !I) return { item: null, id: 0, message: '' };
    const depth = clamp(depthOf(g), 1, 2000);
    const p = g.player;
    let hasLamp = false;
    if (p && Array.isArray(p.inv)) {
      hasLamp = p.inv.some((it) => it && (it.id | 0) === 1100 && (it.f[0] | 0) > 0);
    }
    const v = rollDigDrop(g, hasLamp);
    if (!v) return { item: null, id: 0, message: '' };
    let it = null;
    if (v > 0) {
      it = I.createItem(v, 1);
      if (it && v === 1124) it.f[26] = clamp(rndOf(g)(idiv(depth + 3, 3) + 2), 0, 99);
    } else {
      it = I.create(g, { level: I.calcObjLv(depth, g), fix: I.calcFixLv(3, g), t638: 77000 });
    }
    if (!it) return { item: null, id: v, message: '' };
    if (Elona.Loot && Elona.Loot.dropGround) Elona.Loot.dropGround(g, it, x | 0, y | 0);
    S(g, 296, V(g, 296) + 1);                            // var_65(250+46)++ 挖墙计数
    return { item: it, id: v, message: '从碎石堆里找到了什么东西。' };
  }

  Elona.DungeonFx = {
    MAT, MAT_DEFAULT, CORE_ENC, CHEST_CATS, RARE_CATS, DIG_TABLE, KIND_TAG,
    calcFame, raceNameOf, materialOf, applyCoreSeed,
    onBossKilled, rollSeeds, kindTag,
    trapIdAllowed, placeTrap, placeFloorHazards,
    genContainerFields, tryUnlock, rollChestContent, openChest,
    rollDigDrop, digDrop,
    mapType, depthOf, isFever,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.DungeonFx;
})(typeof window !== 'undefined' ? window : global);
