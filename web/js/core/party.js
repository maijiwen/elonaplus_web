'use strict';
/**
 * 队伍与宠物（core/party.js）
 *
 * 【源码依据】
 *   get_freeally（194227-194256）：队伍槽 = 角色池 1..15；
 *     上限 = limit(var_82(17,0)/5 + 1, 2, 15)   —— var_82(17,0) 是**玩家的魅力技能**
 *     另有「同伴数 >= 15 → 满」的兜底
 *   邀请入伙（421368-421412，对话动作 51）：
 *     ① 玩家等级×3/2+10 < NPC 等级 → 「力量差距太大」拒绝
 *     ② 好感 >= 200 且 var_58(85, NPC) > 0 → 成功：
 *        get_freeally() 找空槽 → *label_4274 → var_58(150)=0（清角色类型）、
 *        var_58(80)=0（清地图归属）、var_58(17)=100（好感重置）→ *label_4276（加入队伍）
 *     ③ var_58(85)==0 → 「先雇我一次试试」；否则「感觉合不来」
 *   护卫委托（421312，动作 50）：花钱临时雇佣
 *   宠物战（417113/417152/417184，动作 40/41/49）：宠物决斗 / 团队战 / EX 战
 *   宠物获得：捕获玉（items 685 monster ball / 699 little ball）、马屋(57)、奴隶商(36)
 *
 * 【本实现的近似】（登记 A201）
 *   · 同伴标记用 `c.__ally = true`（不占用 var_58(167/168)，那两个字段在本项目已用于坐骑/被载）
 *   · 跟随：每回合朝玩家移动一格（复用 quest.js 的 followToward 思路）
 *   · 好感 >= 200 即视为满足「好感 + 共事经历」两个条件（var_58(85) 的共事次数未移植）
 *   · 宠物战用「战力比」快速结算，不进入地图战斗（原版是进入竞技场实打）
 *   · 临时护卫按「剩余天数」到期自动离队
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const MAX_SLOT = 15;

  /** 魅力技能（var_82(17, 玩家)） */
  function charisma(g) {
    const p = g.player;
    if (!p) return 0;
    if (Elona.Stats && Elona.Stats.sorg) return Elona.Stats.sorg(p, 17) | 0;
    return p.skill ? (p.skill(17) | 0) : 0;
  }

  /** 队伍人数上限（get_freeally 194229）：limit(魅力/5+1, 2, 15) */
  function maxSize(g) {
    return limit(idiv(charisma(g), 5) + 1, 2, 15);
  }

  function isAlly(c) {
    return !!(c && c.__ally && (c.get(0) | 0) === 1);
  }

  /**
   * 当前同伴（含宠物、待機中、死亡等待复活的）列表。
   * 0-DG：同伴改为常驻 `game.party`（换图不再丢失），角色池里的只是「在场」的那部分；
   *   待機（var_58(0)=7）与阵亡（=6）的同伴仍留在 party 里，所以这里以 party 为准，
   *   party 为空时回退到扫描角色池（兼容旧存档 / 测试夹具）。
   */
  function members(g) {
    if (Array.isArray(g.party)) {
      const out = g.party.filter((c) => c && (c.__ally || c.__pet));
      out.sort((a, b) => (a.index | 0) - (b.index | 0));
      return out;
    }
    const out = [];
    for (let i = 1; i < 245; i++) {
      const c = g.charas[i];
      if (isAlly(c)) out.push(c);
    }
    out.sort((a, b) => (a.index | 0) - (b.index | 0));
    return out;
  }

  /** 加入常驻同伴表（去重） */
  function addToParty(g, c) {
    if (!c) return;
    if (!Array.isArray(g.party)) g.party = [];
    if (g.party.indexOf(c) < 0) g.party.push(c);
  }

  /** 从常驻同伴表移除（解雇 / 卖掉 / 合成消耗） */
  function removeFromParty(g, c) {
    if (!Array.isArray(g.party)) return;
    const i = g.party.indexOf(c);
    if (i >= 0) g.party.splice(i, 1);
  }

  /**
   * 0-DG：换图后把同伴放回角色池（原版同伴随身移动）。
   *   只处理「在场」的同伴（var_58(0)==1）；待機 / 阵亡的留在 party 里不动。
   */
  function restore(g) {
    if (!g || !Array.isArray(g.party) || !g.player) return 0;
    // 0-FS：滞在者（var_58(80)）只在**它所在的地图/楼层**登场。
    //   源码 237755-237780：出图时 `var_58(80) != 0` 的角色一律 var_58(0) = 9；
    //   237845-237866 进图时 `var_58(80) == 当前地图` → 1，自宅还要 `var_58(438) == 当前层`。
    const curMap = g.getV65 ? (g.getV65(20) | 0) : 0;
    const curFloor = g.getV65 ? (g.getV65(22) | 0) : 1;
    for (const c of g.party) {
      if (!c || !c.get || c === g.player) continue;
      const stay = c.get(80) | 0;
      if (!stay) continue;
      const here = (stay === curMap)
        && (stay !== 7 || (c.get(438) | 0) === curFloor);
      c.set(0, here ? 1 : 9);
    }
    let n = 0;
    for (const c of g.party) {
      if (!c || (c.get(0) | 0) !== 1) continue;
      const slot = c.index | 0;
      if (slot <= 0) continue;
      const old = g.charas[slot];
      if (old && old !== c) old.set(0, 0);
      g.charas[slot] = c;
      const spot = nearSpot(g, g.player.x, g.player.y);
      c.x = spot.x; c.y = spot.y;
      if (c.hp <= 0) c.hp = Math.max(1, c.hpMax | 0);
      n++;
    }
    if (g.syncCharaCells) g.syncCharaCells();
    return n;
  }

  /** 宠物 = 队伍中的非人形（种族不是人类/艾莱亚等，用 var_58(27) 的种族 id 粗分） */
  function pets(g) {
    return members(g).filter((c) => (c.get(150) | 0) === 0 || c.__pet);
  }

  /** 找一个空的队伍槽（1..15） */
  function freeSlot(g) {
    for (let i = 1; i < MAX_SLOT + 1; i++) {
      const c = g.charas[i];
      if (!c || (c.get(0) | 0) !== 1) return i;
    }
    return -1;
  }

  /**
   * get_freeally（194227-194256）的逐字实现 —— 与 freeSlot 的差别：
   *   · 搜索范围只有 `1 .. limit(魅力/5+1, 2, 15)`（`repeat limit(...), 1`），
   *     后面的空槽即使存在也不会被用到 —— 这是原版的「魅力决定可用槽数」。
   *   · 同伴数 >= 15 时直接返回 0（第二段 repeat 245 的统计）。
   *   · 返回 0 表示「没有可用的队伍槽」。
   */
  function freeAlly(g) {
    const hi = limit(idiv(charisma(g), 5) + 1, 2, MAX_SLOT);
    let found = 0;
    for (let i = 1; i <= hi; i++) {
      const c = g.charas[i];
      if (!c || (c.get(0) | 0) === 0) { found = i; break; }
    }
    // 194232-194241：统计在场同伴数（槽 1..15 且 cdata(0)==1）
    let n = 0;
    for (let i = 1; i <= MAX_SLOT; i++) {
      const c = g.charas[i];
      if (c && (c.get(0) | 0) === 1) n++;
    }
    if (n >= MAX_SLOT) return 0;
    return found;
  }

  /**
   * 队伍里的神仆数 —— 对应 272736-272749 的统计：
   *   `repeat 16-1 : if (var_58(0, cnt) != 0) if (var_63(2, cnt) == "servant") var_400++`
   * 即扫角色池槽 1..15（含待機 7 / 阵亡 6 的同伴，只要 cdata(0) 非 0），
   * 不限于「此刻在场」的成员。
   *
   * 【注意】var_63(2) 在本项目映射到 `chara.raceName`（见 monster.js 的 execStmt：
   * `var_63(2, var_581)` → raceName），而种族 `servant` 的 ops 会写入它
   * （race_class.json races.servant.ops）。`chara.alias` 是另一条线（PCC / 许愿用），
   * 早期实现按 alias 统计会永远数到 0，故这里两条都认，以 raceName 为准。
   */
  function servants(g) {
    let n = 0;
    for (let i = 1; i <= MAX_SLOT; i++) {
      const c = g && g.charas ? g.charas[i] : null;
      if (!c || (c.get(0) | 0) === 0) continue;
      if (c.raceName === 'servant' || c.alias === 'servant') n++;
    }
    return n;
  }

  /**
   * `var_581 = N : gosub *label_4274`（589937 起）的核心部分 —— 把刚用
   * characreate 生成在临时槽（通常是 56）的角色收进队伍。
   *   589938  var_1442 = get_freeally()
   *   589939  为 0 → 「队伍人数已达上限」+ chara_vanquish（角色直接消失）
   *   否则把该角色搬进空槽、清 var_58(150) / var_58(80)、好感 100
   *   590142-590152  relocate 之后的字段归一化：
   *     var_58(34) = var_58(69) - 100    （用旧 69 算一次）
   *     var_58(9) = 10、var_58(69) = 10  （友好度 10 —— 不是 0）
   *     var_58(150) = 0、var_58(177) = 0、var_58(84) = 0
   *     cbitmod 970 / 979 = 0
   * @returns {{ok:boolean, slot?:number, message:string}}
   */
  function joinChara(g, c) {
    if (!c) return { ok: false, reason: 'no-chara', message: '……什么也没有出现。' };
    const slot = freeAlly(g);
    if (!slot) {
      // 589939-589962：队伍满 → 生成的角色 vanquish
      const name = c.name || '那个';
      g.charas[c.index] = null;
      c.set(0, 0);
      if (typeof g.charaVanquish === 'function') { try { g.charaVanquish(c.index); } catch (e) { /* noop */ } }
      if (g.syncCharaCells) g.syncCharaCells();
      return { ok: false, reason: 'full',
        message: `由于同伴人数已达上限，无法成为同伴……。${name}不知何时消失了……` };
    }
    if (!moveToSlot(g, c, slot)) {
      // relocate 不可用时的兜底
      if (g.charas[c.index] === c) g.charas[c.index] = null;
      g.charas[slot] = c;
      c.index = slot;
    }
    // 589974-589990：从道场/廃モンスター牧場收回寄放者时，先回收 821/822 计数并清 cbit 960
    if (Elona.School && Elona.School.onJoin) Elona.School.onJoin(g, c);
    c.__ally = true;
    c.__pet = true;
    addToParty(g, c);
    // 590142-590152：原版把新同伴的关系/归属字段统一归一化
    c.set(34, (c.get(69) | 0) - 100);
    c.set(9, 10);           // 友好度 10（0 会当成中立，宠物不会跟随/护卫）
    c.set(69, 10);
    c.set(150, 0);
    c.set(177, 0);
    c.set(84, 0);
    c.set(80, 0);           // 清地图归属（项目字段）
    const cb = Elona.Status && Elona.Status.cbitmod;
    if (cb) { try { cb(c, 970, 0); cb(c, 979, 0); } catch (e) { /* 特性系统未就绪 */ } }
    if (!(c.hp > 0)) c.hp = Math.max(1, c.hpMax | 0);
    if (g.syncCharaCells) g.syncCharaCells();
    return { ok: true, slot, chara: c,
      message: `${c.name}成了同伴（${members(g).length}/${maxSize(g)}）。` };
  }

  /**
   * 把角色搬到指定槽 —— 复用 game.relocateChara（原版 relocate_chara 194307），
   * 以正确处理坐骑 / 被载者 / 能力值规范化等附带行为。
   */
  function moveToSlot(g, c, slot) {
    if (!c) return false;
    if (c.index === slot) return true;
    if (g.relocateChara) {
      const r = g.relocateChara(c.index, slot, 0);
      return !!(r && r.ok);
    }
    // 兜底（旧路径）
    const old = g.charas[c.index];
    if (old === c) g.charas[c.index] = null;
    g.charas[slot] = c;
    c.index = slot;
    if (g.syncCharaCells) g.syncCharaCells();
    return true;
  }

  /** 附近可站立格 */
  function nearSpot(g, x, y) {
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (!g.map || !g.map.inBounds(nx, ny)) continue;
      const chk = g.map.check(nx, ny);
      if (chk.walkable) return { x: nx, y: ny };
    }
    return { x, y };
  }

  /**
   * 邀请入伙（对话动作 51）
   * @returns {{ok:boolean, reason?:string, message:string}}
   */
  function recruit(g, npc) {
    if (!npc) return { ok: false, message: '没有对象。' };
    if (isAlly(npc)) return { ok: false, message: `${npc.name} 已经在队伍里了。` };
    const p = g.player;
    const pl = (p.level | 0), nl = (npc.get(38) | 0) || (npc.level | 0);
    // 421369：等级差
    if (idiv(pl * 3, 2) + 10 < nl) {
      return { ok: false, reason: 'level',
        message: '「要我做你的同伴？实力差得太远了。」' };
    }
    // 421373：好感 >= 200
    const imp = npc.get(17) | 0;
    if (imp < 200) {
      return { ok: false, reason: 'impression',
        message: '「现在还不觉得能和你合得来……」' };
    }
    // 421402-421407：var_58(85) = 共事经历，需 > 0（先雇为护卫/佣兵一次）
    if ((npc.get(85) | 0) <= 0) {
      return { ok: false, reason: 'experience',
        message: '「要我做同伴？实力上没问题，不过我想先确认能不能和你合得来——先雇我一次试试吧。」' };
    }
    if (members(g).length >= maxSize(g)) {
      return { ok: false, reason: 'full',
        message: '「队伍已经满了，调整一下人数再来吧。」' };
    }
    const slot = freeSlot(g);
    if (slot < 0) return { ok: false, reason: 'full', message: '没有空的队伍槽位。' };
    moveToSlot(g, npc, slot);
    npc.__ally = true;
    addToParty(g, npc);
    npc.set(150, 0);                       // 421409：清角色类型
    npc.set(80, 0);                        // 421410：清地图归属
    npc.set(17, 100);                      // 421411：好感重置 100
    npc.set(9, 0);                         // 友好
    if (g.syncCharaCells) g.syncCharaCells();
    return { ok: true, slot,
      message: `${npc.name} 加入了队伍（${members(g).length}/${maxSize(g)}）。` };
  }

  /** 解雇 / 离队 */
  function dismiss(g, npc) {
    if (!isAlly(npc)) return { ok: false, message: `${npc.name} 不在队伍里。` };
    npc.__ally = false;
    npc.__pet = false;
    removeFromParty(g, npc);
    if (npc.__tempDays) npc.__tempDays = 0;
    return { ok: true, message: `${npc.name} 离开了队伍。` };
  }

  /**
   * 加入一只宠物（捕获玉 / 马屋 / 奴隶商）
   * @param {number} species 生物 id
   * @param {number} level
   * @param {string} [name]
   */
  function addPet(g, species, level, name) {
    if (!Elona.CharaFactory) return { ok: false, message: '现在无法收服宠物。' };
    if (members(g).length >= maxSize(g)) {
      return { ok: false, reason: 'full', message: '队伍已经满了。' };
    }
    const slot = freeSlot(g);
    if (slot < 0) return { ok: false, reason: 'full', message: '没有空的队伍槽位。' };
    const p = g.player;
    const spot = nearSpot(g, p.x, p.y);
    let c = null;
    try {
      c = Elona.CharaFactory.create(g, species, Math.max(1, level | 0), spot.x, spot.y, { index: slot });
    } catch (e) { c = null; }
    if (!c) return { ok: false, message: '收服失败了……' };
    g.charas[slot] = c;
    c.index = slot;
    c.__ally = true;
    c.__pet = true;
    // 0-DG：个别 source 的 characreate 不写 HP 时兜底，避免加入时就是「濒死」
    if (!(c.hp > 0)) c.hp = Math.max(1, c.hpMax | 0);
    if (!(c.mp >= 0)) c.mp = Math.max(0, c.mpMax | 0);
    addToParty(g, c);
    c.set(150, 0);
    c.set(9, 0);
    if (name) c.name = name;
    if (g.syncCharaCells) g.syncCharaCells();
    return { ok: true, slot, pet: c,
      message: `${c.name} 成为了你的宠物（${members(g).length}/${maxSize(g)}）。` };
  }

  /** 临时护卫（对话动作 50）：花 gold 雇 X 天，到期离队 */
  function hireGuard(g, npc, days, cost) {
    if (isAlly(npc)) return { ok: false, message: `${npc.name} 已经在队伍里了。` };
    const p = g.player;
    const d = Math.max(1, days | 0);
    const price = Math.max(1, cost | 0);
    if ((p.get(30) | 0) < price) {
      return { ok: false, reason: 'money', message: `护卫需要 ${price} gold。` };
    }
    if (members(g).length >= maxSize(g)) {
      return { ok: false, reason: 'full', message: '队伍已经满了。' };
    }
    const slot = freeSlot(g);
    if (slot < 0) return { ok: false, reason: 'full', message: '没有空的队伍槽位。' };
    p.set(30, p.get(30) - price);
    moveToSlot(g, npc, slot);
    npc.__ally = true;
    addToParty(g, npc);
    npc.__tempDays = d;
    npc.set(150, 0);
    npc.set(9, 0);
    npc.set(85, (npc.get(85) | 0) + 1);      // 421402：共事经历 +1 → 之后可邀请入伙
    if (g.syncCharaCells) g.syncCharaCells();
    return { ok: true, days: d, cost: price,
      message: `雇佣了 ${npc.name} 作为护卫（${d} 天，-${price} gold）。` };
  }

  /** 跟随移动：朝玩家走一格（与 quest.js followToward 同思路） */
  function followToward(g, c, p) {
    if (!g.map || typeof g.map.walkable !== 'function') return false;
    const dx = p.x - c.x, dy = p.y - c.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1) return false;   // 已经贴身
    const tries = [];
    if (dx !== 0) tries.push([dx > 0 ? 1 : -1, 0]);
    if (dy !== 0) tries.push([0, dy > 0 ? 1 : -1]);
    tries.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    for (const [sx, sy] of tries) {
      const nx = c.x + sx, ny = c.y + sy;
      if (!g.map.walkable(nx, ny)) continue;
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

  /** 每回合：同伴跟随 + 临时护卫到期 */
  function tick(g) {
    const p = g.player;
    if (!p) return;
    for (const c of members(g)) {
      // 0-DG：待機（7）/ 阵亡（6）的同伴不跟队、不计护卫天数
      if ((c.get(0) | 0) !== 1) continue;
      if (c.__tempDays !== undefined && c.__tempDays !== null) {
        c.__tempDays = (c.__tempDays | 0) - 1;
        if (c.__tempDays <= 0) {
          c.__ally = false;
          c.__tempDays = 0;
          if (g.log) g.log(`${c.name} 的护卫契约到期了。`);
          continue;
        }
      }
      // 距离太远（>6）直接传送到附近，避免掉队
      const d = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
      if (d > 6) {
        const spot = nearSpot(g, p.x, p.y);
        const old = g.map && g.map.cell ? g.map.cell(c.x, c.y) : null;
        if (old) old[1] = 0;
        c.x = spot.x; c.y = spot.y;
        const nc = g.map && g.map.cell ? g.map.cell(c.x, c.y) : null;
        if (nc) nc[1] = c.index + 1;
        continue;
      }
      if (d > 1) followToward(g, c, p);
    }
  }

  /** 宠物战力（宠物战用）：等级×10 + 最大HP/2 + 攻击技能×5 */
  function petPower(c) {
    if (!c) return 0;
    const lv = (c.get(38) | 0) || (c.level | 0);
    const hp = Math.max(1, (c.hpMax | 0) || (c.get(51) | 0) || 1);
    const atk = Elona.Stats && Elona.Stats.sorg ? (Elona.Stats.sorg(c, 104) | 0) : 0;
    return lv * 10 + idiv(hp, 2) + atk * 5;
  }

  /**
   * 宠物战（对话动作 40 决斗 / 41 团队战 / 49 EX 战）
   * 本实现：按战力比快速结算（A201），胜利给金币与宠物经验。
   * @param {'duel'|'team'|'ex'} mode
   * @param {number} [petIndex] 出战的宠物（缺省用第一只）
   */
  function petBattle(g, mode, petIndex) {
    const list = pets(g);
    if (!list.length) return { ok: false, message: '「你还没有可以出战的宠物。」' };
    const pet = (petIndex !== undefined && list.find((c) => c.index === petIndex)) || list[0];
    const n = mode === 'team' ? 3 : (mode === 'ex' ? 5 : 1);
    const lv = Math.max(1, ((pet.get(38) | 0) || 1) + (mode === 'ex' ? 5 : 2));
    const myPower = petPower(pet) * (mode === 'team' ? 3 : 1);
    const foePower = (lv * 10 + 60) * (mode === 'team' ? 3 : 1) * (mode === 'ex' ? 2 : 1);
    const win = (g.rng ? g.rng.rnd(myPower + foePower) : 0) < myPower;
    const label = mode === 'team' ? '团队战' : (mode === 'ex' ? 'EX 战' : '宠物决斗');
    if (!win) {
      return { ok: true, win: false, mode, pet: pet.index,
        message: `【${label}】${pet.name} 败下阵来……（对手等级约 ${lv}）` };
    }
    const reward = lv * 50 * (mode === 'team' ? 2 : 1) * (mode === 'ex' ? 3 : 1);
    const p = g.player;
    if (p) p.set(30, (p.get(30) | 0) + reward);
    // 宠物经验（skillGain 通用经验）
    if (Elona.Stats && Elona.Stats.skillExp) {
      Elona.Stats.skillExp(pet, 104, pet.index | 0, 200 + lv * 30, 1, 0, g);
    }
    return { ok: true, win: true, mode, pet: pet.index, reward,
      message: `【${label}】${pet.name} 获胜！获得 ${reward} gold，宠物获得经验。` };
  }

  /**
   * 捕获玉收服（items 685 monster ball / 699 little ball）—— **使用**路径。
   * A202（0-HG）：源码 340944-340976 已定位，是**确定性条件判定，没有任何成功率**：
   *   · 340945 目标 index>=57、var_58(150)==0、var_58(25)!=6、cbit 976/992 均不成立
   *   · 340952 球等级 var_99(26) >= 目标等级 var_58(38)
   *   · 340959 HP <= 最大 HP / 10
   *   · 340968 地图非 6/40/35，且非「30 且层数 1」
   * 投掷路径见 core/throw.js 的 capture() / captureLittle()（340921-341010）。
   * 本函数保留项目既有的「相邻 8 格自动选目标」交互（源码投掷由玩家瞄准）。
   * @param {object} item 捕获玉实例（调用方负责扣数量）
   */
  function capture(g, item) {
    if (!g || !g.player) return { ok: false, message: '现在无法使用。' };
    const p = g.player;
    const target = findCaptureTarget(g, p);
    if (!target) {
      return { ok: false, reason: 'no-target', message: '附近没有可以捕获的对象。' };
    }
    // ---- 340944-340976：判定全部通过才捕获（源码为条件制，无概率判定）----
    const tl = Math.max(1, (target.get(38) | 0) || (target.level | 0) || 1);
    // 1) 不可捕获对象（340945）：同伴/冒险者槽、有角色类型、NPC 档位 6、cbit 976/992
    const role = target.get(150) | 0;
    const C = Elona.Status && Elona.Status.cbit;
    if ((target.index | 0) < 57 || role !== 0 || (target.get(25) | 0) === 6
      || (C && C(target, 976)) || (C && C(target, 992))) {
      return { ok: false, reason: 'invalid',
        message: '「その生物には無効だ。」（这种生物无法捕获。）' };
    }
    // 2) 球的强度（var_99(26)）需 >= 目标等级（340952）
    const ballLv = (item.f[26] | 0) || 1;
    if (tl > ballLv) {
      return { ok: false, reason: 'ball-level',
        message: '「その生物を捕獲するには、より高レベルのモンスターボールが必要だ。」（球的等级不够。）' };
    }
    // 3) 目标须削弱到 HP <= 最大 HP / 10（340959）
    const hpNow = target.get(50) | 0, hpMax = target.get(51) | 0;
    if (hpNow > idiv(hpMax, 10)) {
      return { ok: false, reason: 'hp',
        message: '「捕獲するためにはもっと弱らせる必要がある。」（需要先把目标打到濒死。）' };
    }
    // 4) 地图限制（340968）：6 竞技场 / 40 宠物竞技场 / 35 怪物之森 / (30 且层数 1)
    const mid = g.getV65(20) | 0, mfl = g.getV65(22) | 0;
    if (mid === 6 || mid === 40 || mid === 35 || (mid === 30 && mfl === 1)) {
      return { ok: false, reason: 'area',
        message: '「この場所では捕獲できない。」（这个地方不能捕获。）' };
    }
    if (members(g).length >= maxSize(g)) {
      return { ok: false, reason: 'full', message: '队伍已经满了，无法再收服。' };
    }
    // 成功（340977-340983）：球记录种别/等级，原个体消失（chara_vanquish），
    // 使用球时按 f[23]/f[27] 生成新个体（不保留目标的装备/特性）
    const species = (target.__characreate && (target.__characreate.creatureId | 0))
      || (target.get(27) | 0) || 0;
    item.f[23] = species; item.f[27] = tl;
    const slot = freeSlot(g);
    if (slot < 0) return { ok: false, reason: 'full', message: '没有空的队伍槽位。' };
    const name = target.name;
    // 从地图上移除原角色
    const oldCell = g.map && g.map.cell ? g.map.cell(target.x, target.y) : null;
    if (oldCell) oldCell[1] = 0;
    target.set(0, 0);
    const r = addPet(g, species || 1, tl, name);
    if (!r.ok) {
      target.set(0, 1);
      if (oldCell) oldCell[1] = target.index + 1;
      return r;
    }
    if (g.syncCharaCells) g.syncCharaCells();
    return { ok: true, rate: 100, pet: name,
      message: `「${name}」をモンスターボールに捕獲した。（捕获成功！${name} 成为了你的宠物。）` };
  }

  /**
   * 0-DH：支配（法术 435）成功 —— 把**同一个个体**收为同伴（325624-325628 的
   *   `var_581 = var_244 : gosub *label_4274`）。与捕获球不同，保留原个体与装备。
   * @returns {{ok:boolean, message:string}}
   */
  function dominate(g, c) {
    if (!c || c.index === 0) return { ok: false, message: '没有对象。' };
    if (isAlly(c)) return { ok: false, reason: 'already', message: `${c.name}已经是同伴了。` };
    if (members(g).length >= maxSize(g)) {
      return { ok: false, reason: 'full', message: '队伍已满，支配不了。' };
    }
    // 敌对关系解除（var_58(9) = 10 为友方）
    c.set(9, 10);
    c.set(69, 10);
    c.__ally = true;
    c.__pet = true;
    c.__dominated = true;
    if (!(c.hp > 0)) c.hp = Math.max(1, c.hpMax | 0);
    addToParty(g, c);
    // 从敌对列表里移除、刷新格子索引
    if (g.syncCharaCells) g.syncCharaCells();
    const msg = `${c.name}成为了你的同伴。`;
    if (g.log) g.log(msg);
    return { ok: true, message: msg, chara: c.index | 0 };
  }

  /** 相邻 8 格内可作为捕获目标的角色（非同伴、存活、非玩家） */
  function findCaptureTarget(g, p) {
    if (!g || !p) return null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = p.x + dx, y = p.y + dy;
        if (!g.map || !g.map.inBounds(x, y)) continue;
        const chk = g.map.check(x, y);
        if (chk.charaIndex < 0) continue;
        const c = g.charas[chk.charaIndex];
        if (!c || c === p) continue;
        if ((c.get(0) | 0) !== 1) continue;
        if (isAlly(c)) continue;
        return c;
      }
    }
    return null;
  }

  /** 队伍一览文本 */
  function summary(g) {
    const ms = members(g);
    if (!ms.length) return '队伍里只有你一个人。';
    const lines = ms.map((c) => {
      const lv = (c.get(38) | 0) || 0;
      const tag = c.__pet ? '宠物' : (c.__tempDays ? `护卫(${c.__tempDays}天)` : '同伴');
      return `${c.name}（${tag} Lv${lv}）`;
    });
    return `队伍 ${ms.length}/${maxSize(g)}：` + lines.join('、');
  }

  Elona.Party = {
    MAX_SLOT, maxSize, charisma, isAlly, members, pets, servants, freeSlot, freeAlly,
    recruit, dismiss, addPet, hireGuard, tick, followToward, petPower, petBattle, summary,
    capture, findCaptureTarget, dominate, joinChara,
    nearSpot, addToParty, removeFromParty, restore,   // 0-DG
  };
})(window);
