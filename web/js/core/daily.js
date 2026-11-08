'use strict';
/**
 * 冒险日和（修行日和）与命运信标 —— 对应 start.hsp：
 *   · 每日技能组轮换        603613-603685
 *   · 组经验累计与完成度    32076-32125（skillexp 内）
 *   · 经验 ×3 加成          32005-32032（skillexp 内，已实现，读 var_65(250+420)）
 *   · ネフィア热狂状态      603209-603236
 *   · 命运信标（每层金币）  231028-231068
 *
 * 【槽位约定】`var_65(250 + n)` = 槽位 250+n：
 *   670 = 当日技能组(0..4)   671-675 = 各组的累计经验
 *   678 = 完成度(0..7)       603 = ネフィア热狂(100)  604 = 触发月  605 = 剩余小时
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // 32009-32031：五组技能
  const GROUPS = [
    [153, 154, 155, 164, 169, 170, 171, 181],                       // 0 修行
    [152, 166, 167, 168, 173, 186, 187, 189],                       // 1 戦闘
    [156, 160, 176, 177, 178, 179, 180, 183, 184, 185, 300],        // 2 仕事
    [157, 158, 159, 163, 175, 182, 190, 301],                       // 3 探索
    [150, 151, 161, 162, 165, 172, 174, 188],                       // 4 勉強
  ];
  const GROUP_NAMES = ['修行', '戦闘', '仕事', '探索', '勉強'];
  // 603646-603684
  const GROUP_MSG = [
    '今日は絶好の修行日和だ。',
    '今日は絶好の戦闘日和だ。',
    '今日は絶好の仕事日和だ。',
    '今日は絶好の探索日和だ。',
    '今日は絶好の勉強日和だ。',
  ];
  const NEED = 15000;        // 32077：每组达标线

  const SLOT_GROUP = 670;
  const SLOT_EXP0 = 671;     // 671..675
  const SLOT_DONE = 678;
  const SLOT_FEVER = 603;
  const SLOT_FEVER_MONTH = 604;
  const SLOT_FEVER_HOURS = 605;

  const V = (g, n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);
  const S = (g, n, v) => { if (g && g.setV65) g.setV65(n, v | 0); };

  /** 当日技能组（0..4） */
  function group(g) { return limit(V(g, SLOT_GROUP), 0, 4); }
  function setGroup(g, v) { S(g, SLOT_GROUP, limit(v | 0, 0, 4)); }
  function groupExp(g, i) { return V(g, SLOT_EXP0 + i) | 0; }
  function doneCount(g) { return V(g, SLOT_DONE) | 0; }
  function groupName(g) { return GROUP_NAMES[group(g)]; }

  /** 该技能是否属于当日组（skillexp 的 ×3 判定用） */
  function inCurrentGroup(g, skillId) {
    const t = group(g);
    if (t === 1 && skillId >= 100 && skillId < 112) return true;    // 32014
    return (GROUPS[t] || []).indexOf(skillId) >= 0;
  }

  /**
   * 32076-32125：把一次技能经验计入对应组；达 15000 时完成度 +1（上限 7）。
   * @returns {boolean} 本次是否刚刚达标
   */
  function addGroupExp(g, skillId, amount) {
    if (!(amount > 0)) return false;
    for (let i = 0; i < 5; i++) {
      if ((GROUPS[i] || []).indexOf(skillId) < 0) continue;
      const cur = groupExp(g, i);
      if (cur >= NEED) return false;
      const nv = cur + amount;
      S(g, SLOT_EXP0 + i, Math.min(nv, NEED));
      if (nv >= NEED && doneCount(g) < 7) S(g, SLOT_DONE, doneCount(g) + 1);
      return nv >= NEED;
    }
    return false;
  }

  /**
   * 603613-603685：每日轮换。
   * 逻辑：repeat 2 { 当前组累计 >= 15000 → 下一组并跳出；否则 rnd(5) }
   */
  function tickDay(g) {
    const out = { messages: [], group: 0, changed: false };
    const R = (n) => ((g && g.rng) ? g.rng.rnd(n) : Math.floor(Math.random() * n));
    const before = group(g);
    for (let pass = 0; pass < 2; pass++) {
      const cur = group(g);
      if (groupExp(g, cur) >= NEED) {
        setGroup(g, (cur + 1) % 5);
        break;
      }
      setGroup(g, R(5));
    }
    out.group = group(g);
    out.changed = out.group !== before;
    out.messages.push(GROUP_MSG[out.group]);
    return out;
  }

  /**
   * 603209-603236：ネフィア热狂（整点时）。
   *   15..24 点、`rnd(14) < 日-10`、本月的月份未触发过 → 热狂 100，持续 48+rnd(12) 小时
   */
  function tickHour(g) {
    const out = { messages: [], started: false, ended: false };
    const R = (n) => ((g && g.rng) ? g.rng.rnd(n) : Math.floor(Math.random() * n));
    const month = V(g, 11) | 0;
    const day = V(g, 12) | 0;

    // 603209-603221：倒计时与结束
    if (V(g, SLOT_FEVER) === 100) {
      if (V(g, SLOT_FEVER_HOURS) > 0) S(g, SLOT_FEVER_HOURS, V(g, SLOT_FEVER_HOURS) - 1);
      if (V(g, SLOT_FEVER_HOURS) <= 0 || V(g, SLOT_FEVER_MONTH) !== month) {
        S(g, SLOT_FEVER, 0);
        out.ended = true;
        out.messages.push('ネフィアは静まった。');
      }
    }
    // 603222-603236：触发
    if (idiv(month, 3) !== 0 && day >= 15 && day <= 24) {
      if (R(14) < day - 10) {
        if (V(g, SLOT_FEVER_MONTH) !== month) {
          S(g, SLOT_FEVER_MONTH, month);
          S(g, SLOT_FEVER, 100);
          S(g, SLOT_FEVER_HOURS, R(12) + 48);
          out.started = true;
          out.messages.push('ランダムネフィアが熱狂状態に突入した！');
        }
      }
    }
    return out;
  }

  /**
   * 231028-231068：命运信标 —— 进入随机地城（type 8）的**新层**时发放。
   *
   *   231030  深度 = limit(var_65(22), 1, 400)
   *   231033  金币 = limit(d*50 + d*sqrt(d+1)*5 + 200, 300, 50000)
   *   231034  热狂(603==100) → 额外物品 724，数量 limit(d/3, 1, 70)
   *   231041  完成度(678) >= 7 → 3 件品质 5 物品 + 「このフロアには運命を感じる…！」
   *           并重置 678 与 671-675
   *
   * @param {object} g
   * @param {object} [opt] { mapType, depth, explored }
   * @returns {{ok:boolean, gold?:number, items?:Array, fate?:boolean, messages:string[]}}
   */
  function onEnterFloor(g, opt) {
    opt = opt || {};
    const out = { ok: false, messages: [] };
    const mapType = (opt.mapType === undefined) ? 8 : (opt.mapType | 0);
    if (mapType !== 8) return out;                       // 231028：只对随机地城
    const depth = limit(opt.depth === undefined ? (g.dungeonDepth | 0) : (opt.depth | 0), 1, 400);
    // 231029：本层未探索过（web 端用 g._destinyFloor 记录上次发放的层）
    const last = (g._destinyFloor | 0);
    if (opt.explored === undefined && last === depth) return out;
    g._destinyFloor = depth;
    out.ok = true;

    const gold = limit(depth * 50 + Math.floor(depth * Math.sqrt(depth + 1) * 5) + 200, 300, 50000);
    const p = g.player;
    const drop = (id, count, fix) => {
      if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
      let it = null;
      try { it = Elona.ItemDB.createItem(id, 1, g.rng); } catch (e) { it = null; }
      if (!it) return null;
      it.f[0] = Math.max(1, count | 0);
      if (fix) it.f[4] = fix;
      it.f[5] = p.x; it.f[6] = p.y;
      const cell = g.map && g.map.cell ? g.map.cell(p.x, p.y) : null;
      if (cell) cell[4] = 1;
      g.groundItems.push(it);
      return it;
    };

    drop(54, gold);
    out.gold = gold;
    out.items = [{ id: 54, count: gold }];
    out.messages.push(`運命の気配がする…（${gold} gold）`);

    if (V(g, SLOT_FEVER) === 100) {                      // 231034
      drop(724, limit(idiv(depth, 3), 1, 70));
      out.items.push({ id: 724, count: limit(idiv(depth, 3), 1, 70) });
    }
    if (doneCount(g) >= 7) {                             // 231041
      for (let i = 0; i < 3; i++) {
        let it = null;
        try { it = Elona.ItemDB.create(g, { level: depth + 10, fix: 5 }); } catch (e) { it = null; }
        if (!it) continue;
        it.f[5] = p.x; it.f[6] = p.y;
        const cell = g.map && g.map.cell ? g.map.cell(p.x, p.y) : null;
        if (cell) cell[4] = 1;
        g.groundItems.push(it);
        out.items.push({ id: it.id, count: it.f[0] | 0, fix: 5 });
      }
      out.fate = true;
      out.messages.push('このフロアには運命を感じる…！');
      S(g, SLOT_DONE, 0);
      for (let i = 0; i < 5; i++) S(g, SLOT_EXP0 + i, 0);
    }
    return out;
  }

  /** 调试/UI 用：当前状态一览 */
  function status(g) {
    return {
      group: group(g),
      name: groupName(g),
      exp: [0, 1, 2, 3, 4].map((i) => groupExp(g, i)),
      done: doneCount(g),
      fever: V(g, SLOT_FEVER) === 100,
    };
  }

  Elona.Daily = {
    GROUPS, GROUP_NAMES, GROUP_MSG, NEED,
    SLOT_GROUP, SLOT_EXP0, SLOT_DONE, SLOT_FEVER, SLOT_FEVER_MONTH, SLOT_FEVER_HOURS,
    group, setGroup, groupExp, groupName, inCurrentGroup,
    addGroupExp, tickDay, tickHour, status,
    onEnterFloor,
    // 兼容命名
    Destiny: { onEnterFloor },
  };
})(window);
