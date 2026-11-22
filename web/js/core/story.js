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

  /**
   * 【A46】原版 246741-248481 是「按源码顺序扫描一次触发链」，命中几条就播几条，
   * 没有单次播放段数上限。此前项目加了 8 段上限，会让排在后面的规则被吞掉。
   * 这里改回无上限；run() 是单趟 for 遍历，本身有界，不会形成死循环。
   * 常量保留为 Infinity 只为兼容外部诊断代码对 Story.MAX_SCENES 的读取。
   */
  const MAX_SCENES = Infinity;

  /**
   * 0-GI：触发链上 `var_232 = lang(...)` 的文本（链里只有 1 条，248121）。
   * 原版把这些行直接打进消息窗；项目按中文呈现，未收录的回落到英文。
   */
  const STORY_TEXT = {
    '  あなたはヨウィンで荷馬車から抜け出した。': '  你在约温从货车上爬了出来。',
  };

  let data = null;
  let loading = null;
  let mapData = null;
  let mapLoading = null;

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

  /** A-R4-04：进图副作用表（evadd / chara_vanquish / var_58(13)） */
  async function loadMapEvents() {
    if (mapData) return mapData;
    if (mapLoading) return mapLoading;
    mapLoading = (async () => {
      try {
        mapData = await Elona.Data.fetchJson('data/scene/map_events.json');
      } catch (e) {
        mapData = { rules: [], meta: {} };
      }
      return mapData;
    })();
    return mapLoading;
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
        if ((col | 0) !== 16) return null;
        // 城镇：id 就是 var_132(16) 的值
        const t = townType(row);
        if (t !== null) return t;
        // 其他地图：查各站点数据表（等价 var_132(16, mapId)）
        if (Elona.Sites && typeof Elona.Sites.field === 'function') {
          const v = Elona.Sites.field(16, row | 0, g);
          return (v === undefined || v === null) ? null : (v | 0);
        }
        return null;
      },
      v58(field, chara) {
        const list = (g && g.charas) || [];
        const c = list[chara | 0];
        if (!c || typeof c.get !== 'function') return null;
        const v = c.get(field | 0);
        return v === undefined || v === null ? 0 : (v | 0);
      },
      /** var_126(i)：地图头（本项目 map.header，0/1 = 宽高，6 = 地图类型） */
      v126(i) {
        const h = g && g.map && g.map.header;
        if (!h) return null;
        const v = h[i | 0];
        return v === undefined || v === null ? 0 : (v | 0);
      },
      /** findchara(species)：当前地图内活着的同种角色下标，找不到返回 0 */
      findchara(species) {
        const list = (g && g.charas) || [];
        for (let i = 1; i < list.length; i++) {
          const c = list[i];
          if (c && typeof c.get === 'function'
            && (c.get(0) | 0) === 1 && (c.get(27) | 0) === (species | 0)) return i;
        }
        return 0;
      },
      /** rnd(n)：与源码一致，条件中的 rnd 也要实际消耗随机数 */
      rnd(n) {
        if (!g || !g.rng || typeof g.rng.rnd !== 'function') return null;
        return g.rng.rnd(n | 0) | 0;
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
      case 'v126': {
        const i = ev(node.i, ctx);
        return i === null ? null : ctx.v126(i);
      }
      case 'findchara': {
        const sp = ev(node.species, ctx);
        return sp === null ? null : ctx.findchara(sp);
      }
      case 'rnd': {
        const n = ev(node.n, ctx);
        return n === null ? null : ctx.rnd(n);
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
        // HSP 的 & 不做短路：所有操作数都会求值（含 rnd），最后再判定
        let unknown = false;
        let all = 1;
        for (const a of node.a) {
          const v = ev(a, ctx);
          if (v === null) { unknown = true; continue; }
          if (!v) all = 0;
        }
        return all ? (unknown ? null : 1) : 0;
      }
      case 'or': {
        // 同上：| 也不短路
        let unknown = false;
        let any = 0;
        for (const a of node.a) {
          const v = ev(a, ctx);
          if (v === null) { unknown = true; continue; }
          if (v) any = 1;
        }
        return any ? 1 : (unknown ? null : 0);
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
      // 【A46】不再按已触发段数提前 break：源码顺序扫描整条链，命中即播
      if (testRule(r, ctx) !== 'yes') continue;

      // 源码顺序：先播放（gosub *label_4295），再改状态
      if (o.play !== false && Elona.SceneView) {
        await Elona.SceneView.play(g, r.block, { auto: !!o.auto });
      } else if (Elona.Scene) {
        Elona.Scene.markPlayed(g, r.block);
      }

      for (const e of r.effects || []) {
        if (e.k === 'setState') g.setV65(V_STATE, e.v | 0);
        // 0-GI：链上的其它副作用（原版散落在 *label_4295 之后）
        else if (e.k === 'evadd') {
          // evadd 57 / 88：把事件压入队列（247797 / 247105 / 248210）
          if (g.events && typeof g.events.add === 'function') g.events.add(e.id | 0);
          else if (Elona.Event && typeof Elona.Event.add === 'function') Elona.Event.add(e.id | 0);
        } else if (e.k === 'setV65') {
          g.setV65(e.i | 0, e.v | 0);
        } else if (e.k === 'addV65') {
          // var_65(10) += 3：约温线的三年时间跳跃（248115 / 248169）
          g.setV65(e.i | 0, (g.getV65(e.i | 0) | 0) + (e.v | 0));
        } else if (e.k === 'text') {
          const line = STORY_TEXT[e.jp] || e.en || e.zh || '';
          if (line && g.log) g.log(line);
        } else if (e.k === 'newline') {
          if (g.log) g.log('');
        }
        // 其余（未识别的 HSP 语句）保持 recorded-only，已在 triggers.json 标 supported:false
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

  /**
   * A-R4-04：执行地图初始化链里的非剧情副作用。
   * 原版这些语句与 var_1877 剧情块混在同一个地图初始化函数里（246741-248481），
   * 由 tools/extract_story_triggers.py 抽成 map_events.json，这里按源码顺序解释执行：
   *   evadd        → 事件入队（可带参数）
   *   vanquish     → chara_vanquish findchara(N)
   *   portrait     → var_58(13) = N（立绘）
   * @returns {Promise<number>} 本此执行的规则数
   */
  async function runMapEvents(g) {
    if (!g) return 0;
    await loadMapEvents();
    const rules = (mapData && mapData.rules) || [];
    const ctx = makeCtx(g);
    let fired = 0;
    for (const r of rules) {
      if (!r || r.ok === false) continue;
      if (testRule(r, ctx) !== 'yes') continue;
      for (const e of r.effects || []) {
        if (e.k === 'evadd') {
          const args = (e.args || []).map((a) => ev(a, ctx));
          if (args.some((a) => a === null)) continue;
          if (g.events && typeof g.events.add === 'function') {
            g.events.add(e.id | 0, args[0], args[1]);
          } else if (Elona.Event && typeof Elona.Event.add === 'function') {
            Elona.Event.add(e.id | 0, args[0], args[1]);
          }
        } else if (e.k === 'vanquish') {
          const sp = ev(e.species, ctx);
          if (sp === null) continue;
          const idx = ctx.findchara(sp);
          if (idx && Elona.Chara && typeof Elona.Chara.vanquish === 'function') {
            try { Elona.Chara.vanquish(g, idx); } catch (err) { /* 目标已不在场 */ }
          }
        } else if (e.k === 'portrait') {
          const sp = ev(e.species, ctx);
          if (sp === null) continue;
          const idx = ctx.findchara(sp);
          const c = idx ? g.charas[idx] : null;
          if (c && typeof c.set === 'function' && (c.get(13) | 0) !== (e.v | 0)) {
            c.set(13, e.v | 0);
          }
        }
      }
      fired++;
    }
    return fired;
  }

  /** 读取当前主任务状态 */
  function state(g) {
    return g && typeof g.getV65 === 'function' ? (g.getV65(V_STATE) | 0) : 0;
  }

  Elona.Story = {
    V_STATE, V_SUBMAP, V_MAP, MAX_SCENES,
    load, loadMapEvents, ev, makeCtx, testRule, diagnose, run, onMapEnter,
    runMapEvents, state,
    rules() { return (data && data.rules) || []; },
    meta() { return (data && data.meta) || {}; },
    _reset() { data = null; loading = null; mapData = null; mapLoading = null; },
  };
})(window);
