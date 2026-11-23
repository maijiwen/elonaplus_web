'use strict';
/**
 * 每日任务（daily quest）—— core/dailyquest.js
 *
 * 【与 core/daily.js 区分】daily.js 是「冒险日和 / 命运信标」（var_65 250+x 槽），
 *   本文件是日志里的「每日任务 / Daily Quest」（var_58(190-195) 玩家字段）。
 *
 * 【源码依据 hsp/start.hsp】
 *   20201-20311  *label_0269 日志栏（"@QD[Daily Quest]"，任务类型文案）
 *   302351-302395 存档版本迁移时初始化（var_58 190-195）
 *   603560-603615 过夜刷新（var_65(13)>=24）：
 *       · 已完成的任务让进度 var_58(194)++
 *       · 用**日期做种子**重掷 var_58(191/190)（1..8，避开旧值，保证同日一致）
 *       · 194 >= 195 时 195 += 10 并 `gosub *label_2625` 发奖励
 *       · 195<=0 或 >=1010 时重置 195=10 / 194=0
 *   279354-279420  *label_2625 奖励发放：按 `195/10 % 7` 取 1270/1271/1269，
 *       `itemcreate` 后写进家的库存（原版 shop4.s2），并提示"奖励已送到你家"。
 *   225180-225470  吃食物判定（var_58(190)，按 var_99(25)/1000 食物类别）
 *   312467 / 313572 / 365850 / 237768 / 237780  行动类判定（191 == 2/1/3/6/7）
 *
 * 【数据模型】var_58(190/191, 0)（玩家字段）：
 *     `类型(1..8) + 完成标志×1000`（HSP 里 `\` 是**取余**，故 `\1000` 取类型）
 *     var_58(194)=已完成数（进度），var_58(195)=目标点数（初始 10，每达标 +10）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);
  const V = (g, n) => (g && typeof g.getV65 === 'function' ? (g.getV65(n) | 0) : 0);

  /** 任务类型 → 文案（对应 *label_0269 的 191/190 \1000 == N 分支） */
  const QUEST1 = {   // var_58(191)：行动类
    1: '喝些饮料。', 2: '在世界地图上走走。', 3: '和人对话。', 4: '打败更高等级的对手。',
    5: '向某人传达自己的感受。', 6: '探索随机奈菲亚。', 7: '游历野外。', 8: '运动到轻度疲劳。',
  };
  const QUEST2 = {   // var_58(190)：吃食类
    1: '吃肉类食物。', 2: '吃蛋类食物。', 3: '吃蔬菜。', 4: '吃水果。',
    5: '吃面包。', 6: '吃树果。', 7: '吃水产。', 8: '吃面条。',
  };

  /** 独立的确定性 rnd（日期种子 → [0,n-1]），不影响 g.rng 主序列（源码用 randomize 日期） */
  function seededRnd(seed, n) {
    let s = (seed | 0) >>> 0;
    s = (s ^ 61) ^ (s >>> 16); s = (s + (s << 3)) >>> 0; s ^= s >>> 4;
    s = Math.imul(s, 0x27d4eb2d) >>> 0; s ^= s >>> 15;
    return (s >>> 0) % n;
  }

  /**
   * 完成任务判定：`类型匹配 → += 1000`（源码各判定点）。
   * @param {object} g
   * @param {'q1'|'q2'} which 191(行动) / 190(吃食)
   * @param {number} type 任务类型 1..8
   * @returns {boolean} 是否完成（本次置位）
   */
  function complete(g, which, type) {
    const p = g && g.player;
    if (!p) return false;
    const field = which === 'q2' ? 190 : 191;
    const cur = G(p, field);
    if ((cur % 1000) === type) {                      // 源码 `\1000` 是取余：类型吻合
      p.set(field, cur + 1000);                     // 完成标志
      if (g.log) g.log('日志更新了。');
      return true;
    }
    return false;
  }

  /**
   * 吃食物判定（源码 225180-225470）。var_399 = 食物字段25 / 1000。
   * @param {object} g
   * @param {object} it 食物物品
   */
  function checkEat(g, it) {
    if (!it) return false;
    const p = g && g.player;
    if (!p) return false;
    const id = it.id | 0;
    const cat = Math.trunc((it.f[25] | 0) / 1000);   // var_399
    // 单一类别映射（类别 → 任务类型）
    const map = { 1: 1, 8: 2, 2: 3, 3: 4, 7: 5, 4: 6, 6: 7, 5: 8 };
    // 特殊物品：571(肉)、1103(蔬菜)、1102(水果)、1104(水产)
    const special = { 571: 1, 1103: 3, 1102: 4, 1104: 7 };
    if (special[id]) return complete(g, 'q2', special[id]);
    if (map[cat]) return complete(g, 'q2', map[cat]);
    // 1050 / 852（旅粮类）满足 肉/蔬菜/水果/面包/树果/水产
    if (id === 1050 || id === 852) {
      for (const t of [1, 3, 4, 5, 6, 7]) if (complete(g, 'q2', t)) return true;
    }
    return false;
  }

  /** 喝饮料判定（313572：refitem(id,10)==1） */
  function checkDrink(g, it) {
    if (!it) return false;
    const ref10 = (Elona.ItemDB && Elona.ItemDB.ref) ? (Elona.ItemDB.ref(it.id | 0, 10) | 0) : 0;
    if (ref10 === 1) return complete(g, 'q1', 1);
    return false;
  }

  /** 和人对话（365854） */
  function checkDialogue(g) { return complete(g, 'q1', 3); }
  /** 探索随机奈菲亚（237768：var_132(16, 地图)==8） */
  function checkNefia(g) { return complete(g, 'q1', 6); }
  /** 游历野外（237780：var_65(20)==2） */
  function checkWild(g) { return complete(g, 'q1', 7); }
  /** 世界地图走走（312467） */
  function checkWorldMap(g) { return complete(g, 'q1', 2); }

  /** 把奖励放进家的库存：正在家第一层 → groundItems；否则 homeFloors['1'] */
  function deliverToHome(g, item) {
    if (!g || !item) return false;
    const inHomeFirst = Elona.Home && Elona.Home.inHome && Elona.Home.inHome(g)
      && (Elona.Home.floor ? (Elona.Home.floor(g) | 0) === 1 : true);
    if (inHomeFirst && Array.isArray(g.groundItems)) {
      g.groundItems.push(item);
      if (g.refreshGroundCell) g.refreshGroundCell(item.f[5], item.f[6]);
      return true;
    }
    if (!g.homeFloors) g.homeFloors = {};
    const key = '1';
    if (!Array.isArray(g.homeFloors[key])) g.homeFloors[key] = [];
    g.homeFloors[key].push(item.toJSON ? item.toJSON() : item);
    return true;
  }

  /**
   * 奖励发放（*label_2625，279354-279420）。
   *   按 `195/10 % 7` 决定道具：0/3/4/6 → 1270(PV)、1/5 → 1269(DV)、2 → 1271(Res)。
   * @returns {{ok:boolean, item?:object, message:string}}
   */
  function reward(g) {
    const p = g && g.player;
    if (!p) return { ok: false, message: '' };
    const n = G(p, 195);
    const r = Math.trunc(n / 10) % 7;                   // 195/10 \ 7（/ 整除、\ 取余）
    // 源码 279382-279403 逐项：0→1270, 1→1269, 2→1271, 3→1270, 4→1269, 5→1270, 6→1269
    const MAP = { 0: 1270, 1: 1269, 2: 1271, 3: 1270, 4: 1269, 5: 1270, 6: 1269 };
    const itemId = MAP[r] !== undefined ? MAP[r] : 1270;
    let item = null;
    if (Elona.ItemDB && Elona.ItemDB.createItem) {
      try { item = Elona.ItemDB.createItem(itemId, 1); } catch (e) { item = null; }
    }
    if (item) deliverToHome(g, item);
    if (Elona.Audio && Elona.Audio.playIndex) { try { Elona.Audio.playIndex(24); } catch (e) { /* noop */ } }
    const msg = '每日任务的奖励道具已作为工资送到你家。';
    if (g.log) g.log(msg);
    return { ok: !!item, item, message: msg };
  }

  /**
   * 过夜刷新（603575-603612）—— 由 hourly.newDay 调用。
   * @returns {{messages:string[], mood:number, reward:object|null, rerolled:boolean}}
   */
  function newDayRefresh(g) {
    const out = { messages: [], mood: 0, reward: null, rerolled: false };
    const p = g && g.player;
    if (!p) return out;
    // 603575-603580：已完成的两个任务让进度 +1
    if (G(p, 191) >= 1000) { p.set(194, G(p, 194) + 1); out.mood++; }
    if (G(p, 190) >= 1000) { p.set(194, G(p, 194) + 1); out.mood++; }
    out.messages.push('日记更新了。');
    // 603588-603603：用日期做种子重掷类型（1..8，避开旧值；同日结果确定）
    const y = V(g, 10), mo = V(g, 11), d = V(g, 12);
    const old1 = G(p, 191) % 1000;
    for (let cnt = 0; cnt < 10; cnt++) {
      const v = seededRnd(d + mo + y + cnt, 8) + 1;      // randomize(日+月+年+cnt)
      if (v !== old1) { p.set(191, v); out.rerolled = true; break; }
    }
    const old2 = G(p, 190) % 1000;
    for (let cnt = 0; cnt < 10; cnt++) {
      const v = seededRnd(d + mo * 2 + y * 2 + cnt, 8) + 1;   // randomize(日+月*2+年*2+cnt)
      if (v !== old2) { p.set(190, v); out.rerolled = true; break; }
    }
    // 603605-603611：阈值推进 + 奖励；越界重置
    if (G(p, 194) >= G(p, 195)) { p.set(195, G(p, 195) + 10); out.reward = reward(g); }
    if (G(p, 195) <= 0 || G(p, 195) >= 1010) { p.set(195, 10); p.set(194, 0); }
    return out;
  }

  Elona.DailyQuest = {
    QUEST1, QUEST2,
    complete, checkEat, checkDrink, checkDialogue, checkNefia, checkWild, checkWorldMap,
    reward, deliverToHome, newDayRefresh, seededRnd,
    describe(g) {
      const p = g && g.player;
      if (!p) return { q1: '', q2: '' };
      return {
        q1: QUEST1[G(p, 191) % 1000] || '',
        q2: QUEST2[G(p, 190) % 1000] || '',
        done: G(p, 194), goal: G(p, 195),
        q1done: G(p, 191) >= 1000, q2done: G(p, 190) >= 1000,
      };
    },
  };
})(typeof window !== 'undefined' ? window : global);
