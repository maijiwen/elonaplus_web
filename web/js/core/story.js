'use strict';
/**
 * 剧情触发引擎（core/story.js）
 *
 * 【源码依据】start.hsp 246741-248481（调试串 "Map:Proc scene"，246740）
 *
 * 原版是一条**扁平的条件链**，在每次地图初始化时顺序执行：
 *     if ( <cond> ) {
 *         if ( <cond> ) {
 *             var_1877 = <区块号>
 *             gosub *label_4295          ← 立刻播放整段剧情（阻塞）
 *             var_65(250 + 2) = <新状态>
 *         }
 *     }
 * 关键点：**同一次遍历里，前面的规则改完状态后，后面的规则仍会继续判定**，
 * 所以一次进图可能连续播好几段（原版就是这样，本实现照做，但加了上限防死循环）。
 *
 * 条件被提取成 AST（tools/extract_story_triggers.py），本模块只做解释执行，
 * 从不 eval 字符串。
 *
 * 【变量语义】
 *   var_65(20)      当前地图 id（本项目的约定，见 docs/01-dev-progress.md）
 *   var_65(22)      同一地点的子地图/楼层（原版 237233、237307）
 *   var_65(250 + n) 主任务状态与标记（n = 2 是主状态）
 *   var_132(col,id) 地图属性表 —— 原版运行时构建，见下方已知限制
 *   var_58(f, i)    第 i 个角色的第 f 个字段
 *
 * 【已知限制（详见 docs/02-diff-report.md）】
 *   var_132 在原版是 `dim var_132, 40, 500`（23393）的运行时表，地图进入时才填充，
 *   项目没有静态数据源。本实现只对**城镇**给出 v132(16, id) = id
 *   （依据：mapfile() 11977-12110 中 vernis=5 / palmia=15 等，类型与地图 id 相同），
 *   其余返回 null → 依赖它的规则判定为「未知」而**不会触发**，并在诊断里计数。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 主任务状态（var_65(250 + 2)） */
  const V_STATE = 252;
  /** 同一地点的子地图/楼层（var_65(22)） */
  const V_SUBMAP = 22;
  /** 当前地图 id（var_65(20)） */
  const V_MAP = 20;

  /** 单次进图最多连续播放几段，防止规则互相触发形成死循环 */
  const MAX_SCENES = 8;

  let data = null;
  let loading = null;

  async function load() {
    if (data) return data;
    if (loading) return loading;
    loading = (async () => {
      try {
        data = await Elona.Data.fetchJson('data/scene/triggers.json');
      } catch (e) {
        data = { rules: [], meta: {} };
      }
      return data;
    })();
    return loading;
  }

  /** 城镇的 var_132(16, id) = id（mapfile 的类型值与城镇地图 id 相同） */
  function townType(id) {
    const t = Elona.Towns && Elona.Towns.byId ? Elona.Towns.byId(id) : null;
    return t ? t.id : null;
  }

  /**
   * 求值上下文。
   * 返回 null 表示「无法确定」，调用方必须把它当作不成立，而不是 0。
   */
  function makeCtx(g) {
    return {
      g,
      v65(i) {
        if (!g || typeof g.getV65 !== 'function') return null;
        const v = g.getV65(i | 0);
        return v === undefined || v === null ? 0 : (v | 0);
      },
      v132(col, row) {
        // 只支持「城镇」这一种可确定的情况
        if ((col | 0) !== 16) return null;
        const t = townType(row);
        return t === null ? null : t;
      },
      v58(field, chara) {
        const list = (g && g.charas) || [];
        const c = list[chara | 0];
        if (!c || typeof c.get !== 'function') return null;
        const v = c.get(field | 0);
        return v === undefined || v === null ? 0 : (v | 0);
      },
    };
  }

  /** 解释执行一个 AST 节点：返回数字，或 null（无法确定） */
  function ev(node, ctx) {
    if (!node || typeof node !== 'object') return null;
    switch (node.k) {
      case 'num':
        return node.v | 0;
      case 'add': {
        let s = 0;
        for (const a of node.a) {
          const v = ev(a, ctx);
          if (v === null) return null;
          s += v;
        }
        return s;
      }
      case 'v65': {
        const i = ev(node.i, ctx);
        return i === null ? null : ctx.v65(i);
      }
      case 'v132': {
        const col = ev(node.col, ctx);
        const row = ev(node.row, ctx);
        if (col === null || row === null) return null;
        return ctx.v132(col, row);
      }
      case 'v58': {
        const f = ev(node.field, ctx);
        const c = ev(node.chara, ctx);
        if (f === null || c === null) return null;
        return ctx.v58(f, c);
      }
      case 'cmp': {
        const l = ev(node.l, ctx);
        const r = ev(node.r, ctx);
        if (l === null || r === null) return null;
        switch (node.op) {
          case '==': return l === r ? 1 : 0;
          case '!=': return l !== r ? 1 : 0;
          case '<': return l < r ? 1 : 0;
          case '>': return l > r ? 1 : 0;
          case '<=': return l <= r ? 1 : 0;
          case '>=': return l >= r ? 1 : 0;
          default: return null;
        }
      }
      case 'and': {
        // HSP 的 & 对 0/1 是位与，等价于逻辑与；先判假即可短路
        let unknown = false;
        for (const a of node.a) {
          const v = ev(a, ctx);
          if (v === null) { unknown = true; continue; }
          if (!v) return 0;
        }
        return unknown ? null : 1;
      }
      case 'or': {
        let unknown = false;
        for (const a of node.a) {
          const v = ev(a, ctx);
          if (v === null) { unknown = true; continue; }
          if (v) return 1;
        }
        return unknown ? null : 0;
      }
      case 'unsupported':
        return null;
      default:
        return null;
    }
  }

  /**
   * 判定一条规则。
   * @returns {'yes'|'no'|'unknown'} unknown 表示有条件无法求值
   */
  function testRule(rule, ctx) {
    if (!rule || rule.ok === false) return 'no';
    let unknown = false;
    for (const c of rule.conds || []) {
      const v = ev(c, ctx);
      if (v === null) { unknown = true; continue; }
      if (!v) return 'no';          // 短路：任一条件为假即不成立
    }
    return unknown ? 'unknown' : 'yes';
  }

  /** 诊断用：逐条统计当前状态下 成立/不成立/未知 的数量 */
  function diagnose(g) {
    const ctx = makeCtx(g);
    const out = { yes: [], no: 0, unknown: [], total: 0 };
    for (const r of (data && data.rules) || []) {
      out.total++;
      const t = testRule(r, ctx);
      if (t === 'yes') out.yes.push(r);
      else if (t === 'unknown') out.unknown.push(r);
      else out.no++;
    }
    return out;
  }

  /**
   * 按源码顺序跑一遍触发链。
   *
   * @param {object} g      Game 实例
   * @param {object} opts   { play:boolean }  play=false 时只推进状态、不播放（测试/静默模式）
   * @returns {Promise<{block:number, nextState:number|null}[]>} 本次触发的区块
   */
  async function run(g, opts) {
    const o = opts || {};
    await load();
    const fired = [];
    if (!data.rules.length) return fired;

    const ctx = makeCtx(g);
    // 注意：每触发一条就重新构造上下文不必要（都是实时读 g），但规则间状态会变，
    // 所以每次判定都直接读 g（makeCtx 的闭包就是实时读），无需重建。
    for (const r of data.rules) {
      if (fired.length >= MAX_SCENES) break;
      if (testRule(r, ctx) !== 'yes') continue;

      // 源码顺序：先播放（gosub *label_4295），再改状态
      if (o.play !== false && Elona.SceneView) {
        await Elona.SceneView.play(g, r.block, { auto: !!o.auto });
      } else if (Elona.Scene) {
        Elona.Scene.markPlayed(g, r.block);
      }

      for (const e of r.effects || []) {
        if (e.k === 'setState') g.setV65(V_STATE, e.v | 0);
        // evadd / 其它副作用：原版会挂定时事件或改物品，本项目尚未移植，
        // 已在 triggers.json 的 effects 里标 supported:false，这里不臆造效果。
      }
      fired.push({ block: r.block, nextState: r.nextState, line: r.line });
    }
    return fired;
  }

  /**
   * 进入地图后检查剧情 —— 对应原版把触发链放在地图初始化里（246740 "Map:Proc scene"）。
   * 只有在游戏状态为 PLAY 时才真正播放，避免在读档/创建角色的过渡里弹剧情。
   */
  async function onMapEnter(g, opts) {
    if (!g) return [];
    const playable = !!(Elona.Game && g.state === Elona.Game.STATE.PLAY);
    return run(g, Object.assign({}, opts, { play: playable && opts && opts.play !== false }));
  }

  /** 读取当前主任务状态 */
  function state(g) {
    return g && typeof g.getV65 === 'function' ? (g.getV65(V_STATE) | 0) : 0;
  }

  Elona.Story = {
    V_STATE, V_SUBMAP, V_MAP, MAX_SCENES,
    load, ev, makeCtx, testRule, diagnose, run, onMapEnter, state,
    rules() { return (data && data.rules) || []; },
    meta() { return (data && data.meta) || {}; },
    _reset() { data = null; loading = null; },
  };
})(window);
