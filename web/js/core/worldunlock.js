'use strict';
/**
 * 世界地图解锁与跨世界入口（core/worldunlock.js）—— 0-Y0
 *
 * 【源码依据】start.hsp
 *   249618-249649  world_update：var_65(20) == 4 / 44 / 70 / 91 分别
 *                  map_initcustom "ntyris" / "styris" / "lost" / "ether"
 *                  —— 世界地图本体就是四张（用户所指三张为 4/44/70）。
 *   249783-251301  *label_2474 的 site 表：var_132(30, site) = 所属世界地图 id
 *                  统计：=4 43 处、=44 27 处、=70 15 处、=91 5 处、=47 1 处、=var_410 2 处
 *   245653         跨世界移动时只处理 var_132(30, cnt) == var_65(850) 的据点
 *   237573-237593  从世界区域进入子地图：850==4→20=10、44→51、70→71、91→92
 *   20000-20112    主线进度 var_65(250+2) 的分部与任务提示：
 *                    >= 180「サウスティリスがあなたを呼んでいる」（南提里斯开放）
 *                    == 365  浮遊大陸（エーテル）
 *                    >= 367「古の庭園からメルガストでロストイルヴァへ」（Lost Irva）
 *   245749-245763  状态 180 / 345 的「三年后」剧情跳跃分别落回 4 / 44
 *   389264         剧情 606 的次元歪曲航行：var_65(850) = 44
 *   389328-389332  飞空艇：var_65(20)==71(ウルム・レゾン, 70) → 44；
 *                          var_65(20)==65(古の庭園, 44) → 70
 *   421976         诺恩对话：var_65(850) = 70
 *
 * 【与旧实现的差别】此前项目所有城镇（Towns.LIST 14 个）不分世界，
 * 在 4 号世界地图上按坐标即可进入属于 44 的城镇；travelToWorld 也没有
 * 任何进度门槛。这里按 var_65(252) 把进入方式收口到主线进度。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 主任务状态 var_65(250 + 2) */
  const V_STATE = 252;

  /** 世界地图 id → 解锁条件（minState 为源码主线进度阈值） */
  const WORLDS = [
    { id: 4, name: '北提里斯', file: 'ntyris', minState: 0,
      via: '初始', src: '249622' },
    { id: 44, name: '南提里斯', file: 'styris', minState: 180,
      via: '提里斯关所 / 次元歪曲航行', src: '20067 / 389264 / 245749' },
    { id: 91, name: '浮游大陆', file: 'ether', minState: 365,
      via: '飞空艇', src: '20088 / 245758' },
    { id: 70, name: '失落伊尔瓦', file: 'lost', minState: 367,
      via: '梅尔加斯特（古代庭园）', src: '20094 / 389332 / 421976' },
  ];

  /**
   * 跨世界入口 site（源码 12261-12267 / 12373 / 12297 的地名与
   * 389328-389332 的飞空艇往返）。key = 当前世界 + ':' + site id。
   */
  const GATES = [
    { world: 4, site: 43, to: 44, label: '提里斯关所北侧' },
    { world: 44, site: 45, to: 4, label: '提里斯关所南侧' },
    { world: 44, site: 65, to: 70, label: '古代庭园' },
    { world: 70, site: 71, to: 44, label: '乌尔姆·雷宗' },
  ];

  function state(g) {
    return (g && typeof g.getV65 === 'function') ? (g.getV65(V_STATE) | 0) : 0;
  }

  function rule(worldId) {
    return WORLDS.find((w) => w.id === (worldId | 0)) || null;
  }

  /** 该世界当前是否已随主线解锁 */
  function isUnlocked(g, worldId) {
    const w = rule(worldId);
    if (!w) return false;
    if (w.id === 4) return true;                 // 初始世界无条件开放
    return state(g) >= w.minState;
  }

  /** 尚未解锁时的提示（供日志） */
  function lockedMessage(g, worldId) {
    const w = rule(worldId);
    if (!w) return '那片大陆还不存在于这个世界上。';
    return `通往${w.name}的道路尚未开启（主线进度 ${state(g)} / 需要 ${w.minState}，${w.via}）。`;
  }

  /** 当前世界 + 脚下 site 是否对应一个跨世界入口 */
  function gateFor(worldId, siteId) {
    return GATES.find((x) => x.world === (worldId | 0) && x.site === (siteId | 0)) || null;
  }

  /** 已解锁的世界 id 列表（供 UI / 回归） */
  function available(g) {
    return WORLDS.filter((w) => isUnlocked(g, w.id)).map((w) => w.id);
  }

  Elona.WorldUnlock = {
    V_STATE, WORLDS, GATES,
    state, rule, isUnlocked, lockedMessage, gateFor, available,
  };
})(typeof window !== 'undefined' ? window : globalThis);
