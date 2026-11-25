'use strict';
/**
 * 死亡分派（剧情击杀钩子）—— core/storykill.js
 *
 * 【源码依据】start.hsp 200456-201175（`damage` / `chara_vanquish` 之后的死者物种分派）
 *
 * 原版在**扣血致死之后、掉落之前**，按死者物种（`var_58(27, prm_985)`）做一次大分派：
 *     if ( var_58(27, prm_985) == 141 ) {          ← 愚者之魔石（死者的洞穴 BOSS）
 *         txt_select "[愚者の魔石]を手に入れた！"
 *         var_65(250 + 3) = 1                      ← 主线标记
 *     }
 *     if ( var_58(27, prm_985) == 508 ) {          ← データレジスタ
 *         if ( var_65(250 + 2) < 266 ) { … var_65(250 + 2) = 266 … }
 *     }
 *   …共 65 个物种分支（本表由 tools/gen_storykill.js 从源码生成）。
 *
 * 这一段是**主线任务真正的推进器**：三魔石（141/143/144）、莱米伊德遗迹的
 * 耶鲁士自律战斗通信机（508）、以太发生器（516）、魔歇拉·摩多（672）、
 * 混沌巨城的夜烟神（789）、爱克尔贝伊尔（911）、奥鲁菲（923/1015/1017）、
 * 亚大伯斯的分身（886）…… 都在这里改 `var_65(250+2)` 或 `var_65(250+n)`。
 * 另外还有三条分支讨伐（710/743/755）、清掃（524）、锈铃（860）、
 * 熊出没（1131/1132）、决斗（`var_65(250+306)`）等支线/设施钩子。
 *
 * 【与 KillReward 的分工】
 *   KillReward.onKill  = 经验 / 观察学习（200426-200455、196675-196828）
 *   StoryKill.run      = 剧情标记与事件（200456-201175，本模块）
 *   顺序与源码一致：先经验，再本模块，最后掉落（*label_2287）。
 *
 * 【忠实性约定】
 *   · 条件无法求值（例如涉及 `cnt` 或源码局部变量）→ **不执行该条副作用**，
 *     并在 `actions` 里记 `skipped`，绝不臆测成功。
 *   · `snd` 只转发给音频层（无声卡时静默），不影响状态。
 *   · `chara_vanquish prm_985`（物种 886）在 JS 里由 onDeath 的收尾统一处理，
 *     这里只记录 `vanquish: true`。
 */
(function (global) {
  'use strict';

  const Elona = global.Elona = global.Elona || {};

  /** 主线状态槽位（var_65(250 + 2)） */
  const V_STATE = 252;

  /**
   * 消息中文化。键是源码 `lang()` 的日文原文；未收录的回落英文原文。
   * （原文见 tools/gen_storykill.js 生成的 storykill.json 的 `jp` / `en`）
   */
  const MSG_ZH = {
    '現在ポイント': '现在积分',
    'これで熊の出没も少しは減るだろう。': '这样熊的骚扰应该会少一些了。',
    'これで将来的に熊の出没が減るだろう。': '这样一来，将来熊的骚扰会减少吧。',
    'あなたは今や神殺しだ。': '你如今已是弑神者。',
    '[愚者の魔石]を手に入れた！': '获得了【愚者之魔石】！',
    '[覇者の魔石]を手に入れた！': '获得了【霸者之魔石】！',
    '[賢者の魔石]を手に入れた！': '获得了【贤者之魔石】！',
    'ジャーナルが更新された。': '日志已更新。',
    'クエストを達成した！': '任务达成！',
    '[太陽のアンク]を手に入れた！': '获得了【太阳之锚】！',
    '[データチップ]を手に入れた！': '获得了【数据芯片】！',
    '[混沌の翼]を手に入れた！': '获得了【混沌之翼】！',
    '[データレジスタ]を手に入れた！': '获得了【数据寄存器】！',
    '回収用カプセルに高純度のエーテル塊を入れた。': '把高纯度以太块放进了回收胶囊。',
    '清掃完了！': '清扫完成！',
    '[錆びついた鈴]を手に入れた！': '获得了【锈蚀的铃】！',
    'けたたましい警報が鳴り響いた！': '刺耳的警报声响彻四周！',
  };

  /**
   * 源码里不在物种分支内的两条剧情钩子（同样在 200456-201175 段内）。
   *   200585-200598  决斗对手死亡 → 「＊決闘終了＊」+ `var_65(250 + 306) = -3`
   *   201215-201219  物种 34 → `var_65(250 + 53)++`；213/499 → `var_65(250 + 52)++`
   *     （击杀计数，用于「討伐」类委托/统计）
   */
  const EXTRA = [
    {
      id: 'duel', line: 200585,
      test: (c) => (c.v65(250 + 306) | 0) > 0
        && ((c.deadIndex | 0) === (c.v65(250 + 306) | 0) || (c.deadIndex | 0) === 0),
      effects: [
        { k: 'msg', jp: '＊決闘終了＊', en: '*Duel-Over!*', zh: '＊决斗结束＊' },
        { k: 'snd', id: 122 },
        { k: 'setV65', i: 250 + 306, v: -3 },
      ],
    },
    { id: 'kill34', line: 201211, species: 34, effects: [{ k: 'addV65', i: 250 + 53, v: 1 }] },
    { id: 'kill213', line: 201213, species: 213, effects: [{ k: 'addV65', i: 250 + 52, v: 1 }] },
    { id: 'kill499', line: 201213, species: 499, effects: [{ k: 'addV65', i: 250 + 52, v: 1 }] },
    // 200766-200777 ビッグダディ(318)：击杀者是自己/前 16 槽/cbit 992 时，
    //   `evadd 27, x, y`（事件 27 在死者位置生成リトルシスター 319）；
    //   否则只提示「小姐姐已经被转移走了」。
    {
      id: 'kill318Spawn', line: 200766, species: 318,
      test: (c) => {
        const k = c.killerIndex | 0;
        if (k < 0) return false;
        if (k === 0 || k < 16) return true;
        return !!(c.killer && Elona.Status && Elona.Status.cbit
          && Elona.Status.cbit(c.killer, 992));
      },
      effects: [{ k: 'evadd', id: 27, at: 'dead', line: 200768 }],
    },
    {
      id: 'kill318Evacuated', line: 200770, species: 318,
      test: (c) => {
        const k = c.killerIndex | 0;
        if (k < 0) return false;
        if (k === 0 || k < 16) return false;
        return !(c.killer && Elona.Status && Elona.Status.cbit
          && Elona.Status.cbit(c.killer, 992));
      },
      effects: [{
        k: 'msg', line: 200774,
        zh: '大爹地已经把小妹妹转移到别处了。',
        en: 'Big daddy had already evacuated Little sister to somewhere.',
      }],
    },
  ];

  let TABLE = null;
  let loading = null;
  let BY_SPECIES = null;

  function tableSync() {
    if (TABLE) return TABLE;
    if (Elona.StoryKillData && Elona.StoryKillData.rules) { TABLE = Elona.StoryKillData; }
    else if (Elona.Data && Elona.Data.tableSync) {
      try { TABLE = Elona.Data.tableSync('storykill'); } catch (e) { TABLE = null; }
    }
    if (TABLE && !BY_SPECIES) index();
    return TABLE;
  }

  function index() {
    BY_SPECIES = new Map();
    for (const r of (TABLE.rules || [])) BY_SPECIES.set(r.species | 0, r);
  }

  async function load() {
    if (TABLE) return TABLE;
    if (loading) return loading;
    loading = (async () => {
      if (Elona.StoryKillData && Elona.StoryKillData.rules) TABLE = Elona.StoryKillData;
      else if (Elona.Data && Elona.Data.fetchJson) {
        try { TABLE = await Elona.Data.fetchJson('data/tables/storykill.json'); } catch (e) { TABLE = null; }
      }
      if (TABLE) index();
      return TABLE;
    })();
    return loading;
  }

  // ---------------------------------------------------------------- 条件求值

  const UNKNOWN = Symbol('unknown');

  function num(v) {
    if (v === UNKNOWN || v === undefined || v === null) return UNKNOWN;
    return v | 0;
  }

  function fieldOf(c, which) {
    if (which === 'dead') return c.dead;
    if (which === 'killer') return c.killer;
    return null;
  }

  /** 操作数求值；无法确定返回 UNKNOWN（绝不当作 0） */
  function evalOperand(node, c) {
    if (!node || typeof node !== 'object') return UNKNOWN;
    switch (node.k) {
      case 'num': return node.v | 0;
      case 'v65': return c.v65(node.i);
      case 'prm':
        if (node.which === 'dead') return c.deadIndex;
        if (node.which === 'killer') return c.killerIndex;
        return UNKNOWN;
      case 'v58': {
        const ch = fieldOf(c, node.c);
        if (!ch || typeof ch.get !== 'function') return UNKNOWN;
        return ch.get(node.f) | 0;
      }
      case 'cbit': {
        const ch = fieldOf(c, node.c);
        if (!ch || !Elona.Status || typeof Elona.Status.cbit !== 'function') return UNKNOWN;
        return Elona.Status.cbit(ch, node.n) ? 1 : 0;
      }
      default: return UNKNOWN;
    }
  }

  const CMP = {
    '==': (a, b) => a === b,
    '!=': (a, b) => a !== b,
    '<': (a, b) => a < b,
    '>': (a, b) => a > b,
    '<=': (a, b) => a <= b,
    '>=': (a, b) => a >= b,
  };

  /**
   * 条件求值：1 / 0 / UNKNOWN。
   * `and` 短路假、`or` 短路真；其余不确定时整体不确定。
   */
  function evalCond(node, c) {
    if (!node) return 1;
    switch (node.k) {
      case 'and': {
        let unknown = false;
        for (const a of node.a) {
          const v = evalCond(a, c);
          if (v === 0) return 0;
          if (v === UNKNOWN) unknown = true;
        }
        return unknown ? UNKNOWN : 1;
      }
      case 'or': {
        let unknown = false;
        for (const a of node.a) {
          const v = evalCond(a, c);
          if (v === 1) return 1;
          if (v === UNKNOWN) unknown = true;
        }
        return unknown ? UNKNOWN : 0;
      }
      case 'cmp': {
        const l = num(evalOperand(node.l, c));
        const r = num(evalOperand(node.r, c));
        if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
        const fn = CMP[node.op];
        if (!fn) return UNKNOWN;
        return fn(l, r) ? 1 : 0;
      }
      default: return UNKNOWN;
    }
  }

  function allTrue(list, c) {
    return testConds(list, c) === 1;
  }

  /** 三态：1 全真 / 0 有假 / UNKNOWN 全部可真但含不可求值项 */
  function testConds(list, c) {
    let unknown = false;
    for (const n of (list || [])) {
      const v = evalCond(n, c);
      if (v === 0) return 0;
      if (v === UNKNOWN) unknown = true;
    }
    return unknown ? UNKNOWN : 1;
  }

  // ---------------------------------------------------------------- 副作用

  function say(g, zh, extra) {
    if (!g || typeof g.log !== 'function') return;
    g.log(zh + (extra || ''));
  }

  function playSnd(id) {
    if (!Elona.Audio || typeof Elona.Audio.playIndex !== 'function') return;
    try { Elona.Audio.playIndex(id | 0); } catch (e) { /* 无声卡 */ }
  }

  function applyEffect(g, e, c, out) {
    switch (e.k) {
      case 'setV65':
        if (typeof g.setV65 !== 'function') return;
        g.setV65(e.i | 0, e.v | 0);
        out.push({ k: 'setV65', i: e.i, v: e.v, line: e.line });
        break;
      case 'addV65': {
        if (typeof g.setV65 !== 'function') return;
        const cur = g.getV65(e.i | 0) | 0;
        g.setV65(e.i | 0, cur + (e.v | 0));
        out.push({ k: 'addV65', i: e.i, v: e.v, from: cur, line: e.line });
        break;
      }
      case 'evadd': {
        const add = (g.events && typeof g.events.add === 'function')
          ? g.events.add.bind(g.events)
          : (Elona.Event && typeof Elona.Event.add === 'function' ? Elona.Event.add : null);
        if (!add) { out.push({ k: 'skipped', why: 'no-event-queue', id: e.id }); return; }
        if (e.at === 'dead' && c.dead) add(e.id | 0, c.dead.x | 0, c.dead.y | 0);
        else add(e.id | 0);
        out.push({ k: 'evadd', id: e.id, line: e.line });
        break;
      }
      case 'snd':
        playSnd(e.id);
        out.push({ k: 'snd', id: e.id, line: e.line });
        break;
      case 'msg': {
        const zh = e.zh || MSG_ZH[e.jp] || e.en || e.jp || '';
        say(g, zh);
        out.push({ k: 'msg', text: zh, line: e.line });
        break;
      }
      case 'vanquish':
        // 原版 `chara_vanquish prm_985`：由 onDeath 的收尾统一置 var_58(0)=0
        out.push({ k: 'vanquish', line: e.line });
        break;
      default:
        out.push({ k: 'skipped', why: 'unknown-effect:' + e.k });
    }
  }

  /** 组装求值上下文 */
  function makeCtx(g, dead, killer) {
    return {
      g, dead, killer,
      deadIndex: dead ? (dead.index | 0) : 0,
      killerIndex: (killer && killer.index !== undefined) ? (killer.index | 0) : -1,
      v65(i) {
        if (!g || typeof g.getV65 !== 'function') return UNKNOWN;
        const v = g.getV65(i | 0);
        if (v === undefined || v === null) return 0;
        return v | 0;
      },
    };
  }

  /**
   * 执行一次死亡分派（由 `Battle.onDeath` 调用，幂等交给调用方的 `__death` 标记）。
   *
   * @param {object} g 游戏实例
   * @param {object} dead 死者（`prm_985`）
   * @param {object} [killer] 击杀者（`prm_987`，可为 null）
   * @returns {{species:number, actions:Array, matched:boolean}}
   */
  function run(g, dead, killer) {
    const out = { species: 0, actions: [], matched: false };
    if (!g || !dead || typeof dead.get !== 'function') return out;
    const sp = dead.get(27) | 0;
    out.species = sp;
    const c = makeCtx(g, dead, killer);

    // 1) 物种分支
    const tbl = tableSync();
    const rule = tbl && BY_SPECIES ? BY_SPECIES.get(sp) : null;
    if (rule) {
      if (allTrue(rule.gate, c)) {
        out.matched = true;
        // blocks：同一个 if 块里的语句共享一次条件求值（源码语义），块内语句顺序执行
        for (const b of (rule.blocks || [])) {
          const t = testConds(b.conds, c);
          if (t === 0) { out.actions.push({ k: 'blocked', line: b.effects[0] && b.effects[0].line, why: 'cond' }); continue; }
          if (t === UNKNOWN) { out.actions.push({ k: 'skipped', line: b.effects[0] && b.effects[0].line, why: 'unknown-cond' }); continue; }
          for (const e of b.effects) applyEffect(g, e, c, out.actions);
        }
      }
    }

    // 2) 非物种分支（决斗 / 击杀计数）
    for (const x of EXTRA) {
      if (x.species !== undefined && (x.species | 0) !== sp) continue;
      if (x.test && !x.test(c)) continue;
      out.matched = true;
      for (const e of x.effects) applyEffect(g, e, c, out.actions);
    }
    return out;
  }

  /** 诊断：当前状态下某个物种会触发哪些副作用（不执行） */
  function preview(g, species, killer) {
    const tbl = tableSync();
    const rule = tbl && BY_SPECIES ? BY_SPECIES.get(species | 0) : null;
    if (!rule) return null;
    const fake = { index: 1000, get: (f) => (f === 27 ? (species | 0) : 0), x: 0, y: 0 };
    const c = makeCtx(g, fake, killer);
    return {
      species: species | 0,
      gate: allTrue(rule.gate, c),
      blocks: (rule.blocks || []).map((b) => ({
        effects: b.effects.map((e) => ({ k: e.k, line: e.line })),
        pass: testConds(b.conds, c) === 1,
      })),
    };
  }

  Elona.StoryKill = {
    V_STATE, MSG_ZH, EXTRA,
    load, run, preview, evalCond, makeCtx,
    rules() { const t = tableSync(); return (t && t.rules) || []; },
    _reset() { TABLE = null; loading = null; BY_SPECIES = null; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
