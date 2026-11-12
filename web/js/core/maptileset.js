'use strict';
/**
 * 地图图块集参数 —— 原版 `#deffunc map_tileset`（start.hsp 227405-227690）
 *
 * 原版在每次 map_init 时调用 `map_tileset var_126(12)`，按「地图类型」一次性决定：
 *   var_1618 / var_1619 / var_1620  基础地面图块（地形生成用，本项目多数未用到）
 *   var_1471                        隐藏通道被挖开后的默认地面（A4）
 *   var_812                         未探索区域的「雾」图块（map_setfog 写入 var_704(x,y,2)）
 *
 * 本项目此前把地图类型（header[12]）当成 tileset 统一写成了 1，这是两回事：
 *   header[2]  = 图块图形集（graphic/mapN.bmp），原版这些地图确实都是 1
 *   header[12] = map_tileset 的参数（var_126(12) = var_132(18, mapId)），A4 要用它
 * 这里按 var_132(18, mapId) 取回真实类型，再按源码分支给出 var_1471 / var_812。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** var_812（雾图块）：[基础值, 随机范围, 概率分母]，用法 `base + (rnd(div)==0) * rnd(range)` */
  const FOG = {
    0: [529, 1, 1],
    1: [396, 4, 2],
    2: [529, 1, 1],
    3: [535, 1, 1],       // var_1619(469) + 66
    4: [528, 1, 1],       // 227650 起：具体地形还会细分，这里取初始值
    6: [529, 1, 1],
    7: [530, 1, 1],
    10: [531, 1, 1],
    11: [530, 1, 1],
    15: [535, 1, 1],
    16: [555, 1, 1],
    17: [531, 1, 1],
    18: [531, 1, 1],
    19: [535, 1, 1],
    20: [533, 1, 1],
    96: [697, 1, 1],
    97: [553, 1, 1],
    98: [542, 1, 1],
    99: [702, 1, 1],
    100: [530, 1, 1],
    101: [530, 1, 1],
    200: [531, 1, 1],
    300: [528, 1, 1],
  };

  /** var_1471（隐藏通道默认地面）：[基础值, 随机范围, 概率分母] */
  const HIDDEN = {
    0: [33, 4, 2],
    3: [41, 1, 1],
    6: [45, 3, 2],
    7: [68, 1, 1],
    10: [33, 4, 2],
    11: [212, 1, 1],
    15: [38, 5, 2],
    16: [102, 1, 1],
    17: [14, 1, 1],
    18: [15, 1, 1],
    19: [38, 1, 1],
    20: [23, 1, 1],
    96: [351, 1, 1],
    97: [154, 2, 1],
    98: [23, 1, 1],
    99: [178, 1, 1],
    100: [103, 1, 1],
    101: [100, 1, 1],
    200: [33, 4, 2],
  };

  function rngOf(g) {
    return (g && g.rng) ? g.rng : (Elona.rng || { rnd: (n) => Math.floor(Math.random() * n) });
  }
  function mapIdOf(g) {
    return (g && g.getV65) ? (g.getV65(20) | 0) : 0;
  }

  /**
   * var_126(12)：map_tileset 的参数。
   *   原版 237968：`var_126(12) = var_132(18, var_65(20))`。
   *   本项目提取的 .idx 里该字段为 0，所以优先用 world_sites 的 fields[18]；
   *   程序生成的地图（如随机地城 header[12]=2）直接用自己的值。
   */
  function mapType(g) {
    const m = g && g.map;
    if (!m) return 0;
    const h = (m.header && (m.header[12] | 0)) || 0;
    if (h) return h;
    const S = Elona.Sites;
    if (S && S.get) {
      const rec = S.get(mapIdOf(g), g);
      const f = rec && rec.fields;
      if (f && f[18] !== undefined && f[18] !== null) return f[18] | 0;
    }
    return h;
  }

  /** var_126(6)：地图 kind（1=大陆 3=城镇 5=自家 … 20..27=ネフィア） */
  function kindOf(g) {
    const m = g && g.map;
    if (!m) return 0;
    const h = (m.header && (m.header[6] | 0)) || 0;
    if (h) return h;
    const S = Elona.Sites;
    return (S && S.kindOf) ? (S.kindOf(mapIdOf(g)) | 0) : 0;
  }

  /**
   * 整图揭示的地图（245630-245640）：
   *   mapId 40 / 6 / 30 / 32 / 34 / 84 / 93 / 35，
   *   kind 1/2/3/5（大陆 / 野外 / 城镇 / 自家），
   *   mapId 13 且 var_65(70)==1009。
   * 这些地图 map_setfog 之后会把记忆图块整体写成真实图块，等于没有迷雾。
   */
  function isOpen(g) {
    const id = mapIdOf(g);
    const k = kindOf(g);
    if (id === 40 || id === 6) return true;
    if (k === 1 || k === 2 || k === 3 || k === 5) return true;
    if (id === 30 || id === 32 || id === 34 || id === 84 || id === 93 || id === 35) return true;
    if (id === 13 && (g.getV65 && (g.getV65(70) | 0) === 1009)) return true;
    return false;
  }

  /** `base + (rnd(div)==0) * rnd(range)` —— 对应 var_1471 / var_812 的取法 */
  function pick(spec, rng) {
    if (!spec) return 0;
    const base = spec[0] | 0;
    const range = Math.max(1, spec[1] | 0);
    const div = Math.max(1, spec[2] | 0);
    if (range <= 1) return base;
    if (rng.rnd(div) === 0) return base + rng.rnd(range);
    return base;
  }

  /**
   * 隐藏通道被挖开后的默认地面（var_1471）。
   * 源码用完即取：`var_1471 + (rnd(var_1471(2)) == 0) * rnd(var_1471(1))`。
   */
  function hiddenGround(g) {
    const id = mapIdOf(g);
    const t = mapType(g);
    const rng = rngOf(g);
    // 227630：地图 76 有专门覆盖（且与 prm 是否为 0 有关）
    if (id === 76) return pick(t === 0 ? [211, 1, 1] : [202, 1, 1], rng);
    // 227551：300 → map 88 时为 316，否则 0
    if (t === 300) return id === 88 ? 316 : 0;
    return pick(HIDDEN[t] || [33, 1, 1], rng);
  }

  /** 未探索区域的雾图块（var_812） */
  function fogTile(g) {
    const t = mapType(g);
    return pick(FOG[t] || [531, 1, 1], rngOf(g));
  }

  /**
   * 判断一个记忆图块值是否属于本图的「雾图块」变体。
   *   var_812 在部分地图会随机取变体（如地图类型 1 取 396..399），
   *   读档重建 seen 时不能只比较 fogTile() 当时的某一个具体值。
   */
  function isFog(g, tile) {
    const spec = FOG[mapType(g)] || [531, 1, 1];
    const base = spec[0] | 0;
    const range = Math.max(1, spec[1] | 0);
    const t = tile | 0;
    return t >= base && t < base + range;
  }

  Elona.MapTileset = { mapType, kindOf, isOpen, hiddenGround, fogTile, isFog, FOG, HIDDEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.MapTileset;
})(typeof window !== 'undefined' ? window : global);
