'use strict';
/**
 * 剧情传送（主线 / 支线任务接取后传送到固定地图）
 *
 * 【源码依据】
 * 原版的「剧情传送」不是一套独立机制，而是**散落在 NPC 对话分支里的赋值**：
 *     var_65(250 + 2) = <新阶段>     ← 推进主线阶段（var_65(250+2) 是主状态）
 *     var_65(64) = <目标地图 id>     ← 目标地图
 *     var_65(65) = <子地图 / 层>
 *     var_1777 = 2 | 4               ← 触发换图（*label_2459 的 map_exit 分支）
 * 换图由 237493-237565 的 `if ( var_1777 == 2 )` 完成：
 *     var_65(20) = var_65(64); var_65(22) = var_65(65)
 *     若 var_65(70) == 0（不是委托地图），还会把 var_65(5/6) 设成目标 site 的坐标。
 *
 * 【已定位的传送点】
 *   386376-386380  NPC 菜单（主线 399） → 地图 54（Valm）子 1
 *   386417-386421  NPC 菜单（主线 398） → 地图 54（Valm）子 1
 *   389083-389094  NPC 菜单（主线 390/…） → 地图 70（Lost Irva）子 1
 *   389259-389268  剧情收尾 → 地图 44（South Tyris）子 1，阶段推进到 366
 *   408123-408134  剧情收尾 → 地图 76（混沌の城）子 179，阶段推进到 995
 *   408683-408690  剧情收尾 → 地图 76（混沌の城）子 178
 *   409371-409378  NPC 菜单 → 地图 76（混沌の城）子 179
 *   421666-421682  NPC 菜单 61（商队运输，主线 350 → 351） → 目的地的 var_132(30)
 *
 * 【本实现的取舍】
 *   - 原版的传送全部挂在 NPC 对话脚本（hsp/scene*.hsp 与 *label_3067 的分支）上，
 *     而项目的 NPC 对话是 JSON 脚本 + 服务菜单混合体，无法一一对应到 HSP 的
 *     var_506 菜单号。因此这里把**可确认的传送目标**做成数据表，由
 *     `services(g, npc)` 按 NPC 所在地图与主线阶段给出「前往…」菜单项。
 *   - 阶段推进（var_65(250+2)）在传送时同步写入，与源码顺序一致
 *     （源码里 setState 在 var_65(64) 之前或之后都有，不影响结果）。
 *   - 目的地地图 id 用 var_132 的地图 id 语义；进入时走 game.travelToTown /
 *     loadMap，而不是源码的 var_1777 换图分支（网页版的地图切换唯一入口）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 主线阶段槽位 var_65(250 + 2) */
  const V_STATE = 252;

  /**
   * 传送点表。
   *   map     目标地图 id（var_65(64)）
   *   sub     目标子地图 / 层（var_65(65)），缺省 1
   *   stage   传送后写入的主线阶段（var_65(250+2)），null = 不改
   *   label   菜单文字
   *   at      触发条件：所在地图 id（var_65(20)）
   *   minStage / maxStage  主线阶段区间（含）
   */
  const WARPS = [
    // 386376-386380：主线 399 → Valm
    { map: 54, sub: 1, stage: 399, label: '前往 Valm', at: 15, minStage: 399, maxStage: 399 },
    // 386417-386421：主线 398 → Valm
    { map: 54, sub: 1, stage: 398, label: '前往 Valm', at: 15, minStage: 398, maxStage: 398 },
    // 389083-389094：主线 390 → Lost Irva
    { map: 70, sub: 1, stage: 390, label: '前往 Lost Irva', at: 56, minStage: 390, maxStage: 396 },
    // 389259-389268：主线收尾 → South Tyris
    { map: 44, sub: 1, stage: 366, label: '前往 South Tyris', at: 70, minStage: 365, maxStage: 365 },
    // 408123-408134：主线 995 → 混沌の城 179
    { map: 76, sub: 179, stage: 995, label: '前往混沌巨城', at: 76, minStage: 880, maxStage: 990 },
    // 409371-409378：NPC 菜单 → 混沌の城 179
    { map: 76, sub: 179, stage: null, label: '前往混沌巨城', at: 76, minStage: 700, maxStage: 1010 },
  ];

  /**
   * 地图 id → 地图文件名（`mapfile()` 覆盖不到的 id 走这里）。
   * 源码依据：
   *   238942-238953  map id 44 → "styris"、70 → "lost"、91 → "ether"
   *   240837-240841  map id 76 的子层 146 → "chaos2"（其余子层是 chaos 系列）
   *   world_sites.json 的 mapFile 表已覆盖城镇（54 → valm、15 → palmia 等）
   */
  const MAP_FILES = {
    44: 'styris', 70: 'lost', 91: 'ether', 76: 'chaos',
  };

  /** 混沌巨城（map id 76）的子层 → 地图文件 */
  const CHAOS_FILES = {
    146: 'chaos2', 149: 'chaos3', 150: 'chaos4', 151: 'chaos5',
    152: 'chaos6', 153: 'chaos7', 154: 'chaos8', 155: 'chaos9',
    156: 'chaos10', 157: 'chaos11',
  };

  /** 地图 id → 地图文件名 / 城镇名 */
  function mapNameOf(id, sub) {
    if (id === 76) {
      const c = CHAOS_FILES[sub | 0];
      return c || MAP_FILES[76];
    }
    const S = Elona.Sites;
    if (S && S.fileOf) {
      const f = S.fileOf(id);
      if (f && f !== '_default') return f;
    }
    if (MAP_FILES[id | 0]) return MAP_FILES[id | 0];
    const t = Elona.Towns && Elona.Towns.byId ? Elona.Towns.byId(id) : null;
    return t ? t.name : null;
  }

  /** 地图 id → 显示名 */
  function labelOf(id) {
    const S = Elona.Sites;
    const jp = S && S.nameOf ? (S.nameOf(id, 'jp') || S.nameOf(id)) : '';
    if (jp) return jp;
    const t = Elona.Towns && Elona.Towns.byId ? Elona.Towns.byId(id) : null;
    return t ? t.label : (`map ${id}`);
  }

  /**
   * 当前状态下可用的传送服务（供 NPC 菜单使用）。
   * @param {object} g 游戏实例
   * @param {object} npc 当前对话的 NPC（可空）
   * @returns {Array<{id:string,label:string,map:number,sub:number,stage:number|null}>}
   */
  function services(g, npc) {
    if (!g) return [];
    const at = g.getV65 ? (g.getV65(20) | 0) : 0;
    const stage = g.getV65 ? (g.getV65(V_STATE) | 0) : 0;
    const out = [];
    for (const w of WARPS) {
      if (w.at && w.at !== at) continue;
      if (w.minStage !== undefined && stage < w.minStage) continue;
      if (w.maxStage !== undefined && stage > w.maxStage) continue;
      out.push({
        id: 'story-warp', label: w.label, map: w.map, sub: w.sub,
        stage: w.stage === undefined ? null : w.stage,
      });
    }
    return out;
  }

  /**
   * 执行传送。
   *   1) 若指定了阶段，先写 var_65(250+2)（源码里 setState 与传送顺序不固定）
   *   2) 切到目标地图（var_65(20) = var_65(64)，var_65(22) = var_65(65)）
   * @param {object} g 游戏实例
   * @param {object} w 传送点（services 返回的结构）
   * @returns {Promise<boolean>}
   */
  async function warp(g, w) {
    if (!g || !w || g.transitioning) return false;
    const mapId = w.map | 0;
    const sub = w.sub === undefined ? 1 : (w.sub | 0);
    const file = mapNameOf(mapId, sub);
    if (!file) {
      g.log(`地图 ${mapId} 尚未提取，无法前往。`);
      return false;
    }
    g.transitioning = true;
    try {
      if (w.stage !== null && w.stage !== undefined) {
        g.setV65(V_STATE, w.stage | 0);
      }
      // 世界地图状态：目标不在当前世界时回到地面
      g.worldMap = null;
      g.wildTrip = null;
      g.questMap = null;
      g.dungeonDepth = 0;
      await g.loadMap(file);
      g.setV65(20, mapId);
      g.setV65(22, sub);
      g.charas = [g.player];
      g.syncCharaCells();
      g.restoreParty();
      g.checkStoryEvents();
      g.log(`你被带到了${labelOf(mapId)}。`);
      if (g.onMapChange) g.onMapChange(g.map);
      return true;
    } catch (e) {
      g.log('传送失败：' + e.message);
      return false;
    } finally {
      g.transitioning = false;
    }
  }

  Elona.StoryWarp = {
    V_STATE, WARPS, services, warp, mapNameOf, labelOf,
  };
})(window);
