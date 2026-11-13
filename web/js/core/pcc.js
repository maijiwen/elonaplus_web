'use strict';
/**
 * PCC（Paper Character Chip）外观合成 —— 对应原版 create_pcpic（23785-24270）
 *
 * 【已确认 数据结构】var_508(0..24, chara) = PCC 部件 id：
 *   paletteIndex = id / 1000（HSP 整除）
 *   partNumber   = id \ 1000（HSP 余数）→ 文件 pcc_<layer>_<partNumber>.bmp
 *   合成顺序（源码 exist/picload 顺序）：
 *     mantle → hairbk → ridebk → body → eye → pants → cloth → chest → leg
 *     → belt → glove → ride → mantlebk → hair → subhair → etc(11/12/13)
 *   每层用调色板 var_223(r,g,b, paletteIndex) 着色（gfdec2），本实现用
 *   canvas multiply + destination-in 复现「保留明暗、替换色相」。
 *
 * 【已确认 默认部件】23789-23796：
 *   body = var_58(8)+1, eye = var_58(8)+7,
 *   hair = 2 + rnd(31)*1000, cloth = 1 + rnd(31)*1000, pants = 1 + rnd(31)*1000,
 *   ride = 1
 *
 * 【骑乘外观】23885-24119（0-DD 补齐条件）
 *   玩家骑乘时（var_65(183) != 0 且 prm_500 == 0 且 var_508(16) != 0）：
 *     · 先画 pcc_ridebk_N（坐骑 + 骑手背影）→ 再画 body 等
 *     · 跳过 leg（骑手双腿不下垂）
 *     · 最后画 pcc_ride_N（骑手的跨坐部分，盖在坐骑前面）
 *   N = var_508(16) % 1000：1 = 马、3 = 红龙、4 = 黑影龙（素材决定）
 *
 * 【未移植】prm_501==1 时按装备覆盖各层（*label_0285）、world/worldship 特殊外观。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const BASE = 'assets/graphic/PCCs/';
  const W = 128, H = 192;

  /** 各层可用部件数（PCCs 目录实测；源码 23785-24270 用 exist 逐层判断） */
  const PART_COUNT = {
    belt: 3, body: 6, boots: 1, chest: 7, cloth: 17, etc: 43, eye: 13,
    glove: 2, hair: 18, hairbk: 4, leg: 5, mantle: 4, mantlebk: 4,
    pants: 7, ride: 4, ridebk: 4, subhair: 18, world: 4, worldship: 6,
  };
  /** 少数层的编号不连续（实测 hairbk 只有 2/5/10/13），需精确判定 */
  const PART_IDS = { hairbk: [2, 5, 10, 13] };
  function partExists(name, part) {
    const ids = PART_IDS[name];
    if (ids) return ids.indexOf(part | 0) >= 0;
    const max = PART_COUNT[name] | 0;
    return max > 0 && part >= 1 && part <= max;
  }

  let PALETTE = null;
  const IMG = {};        // path -> Image
  const FAILED = {};     // path -> true：文件不存在（源码 exist 判定失败）
  const TINT = {};       // key -> canvas
  let ensureTried = false;

  /** 图片加载（浏览器环境；Node 测试中返回 rejected 由调用方忽略） */
  function loadImage(path) {
    if (IMG[path]) return Promise.resolve(IMG[path]);
    return new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') { reject(new Error('no Image')); return; }
      const im = new Image();
      im.onload = () => { IMG[path] = im; resolve(im); };
      im.onerror = () => reject(new Error('missing ' + path));
      im.src = path;
    });
  }

  async function loadPalette() {
    if (PALETTE) return PALETTE;
    PALETTE = (await Elona.Data.table('palette')).palette;
    return PALETTE;
  }
  function setPalette(p) { PALETTE = p; }

  /** 默认部件（23789-23796）；rng 可选 */
  function ensure(c, rng) {
    if (!c) return;
    if (!c.pcc) c.pcc = new Array(25).fill(0);
    if (c.pcc[15]) return;
    const R = (n) => ((rng || (c.__game && c.__game.rng) || Elona.rng).rnd(n));
    const sex = c.get(8) | 0;
    c.pcc[15] = sex + 1;
    c.pcc[14] = sex + 7;
    c.pcc[1] = 2 + R(31) * 1000;
    c.pcc[9] = 1 + R(31) * 1000;
    c.pcc[7] = 1 + R(31) * 1000;
    c.pcc[16] = 1;
  }

  /**
   * 层定义：[名称, var_508 下标, 出现条件]
   *   'always'   —— 恒绘制
   *   'riding'   —— 只在骑乘时绘制
   *   'walking'  —— 只在未骑乘时绘制
   */
  const LAYERS = [
    ['mantle', 4, 'always'], ['hairbk', 1, 'always'], ['ridebk', 16, 'riding'],
    ['body', 15, 'always'], ['eye', 14, 'always'],
    ['pants', 7, 'always'], ['cloth', 9, 'always'], ['chest', 2, 'always'],
    ['leg', 3, 'walking'], ['belt', 5, 'always'],
    ['glove', 8, 'always'], ['ride', 16, 'riding'], ['mantlebk', 4, 'always'],
    ['hair', 1, 'always'], ['subhair', 10, 'always'],
    ['etc', 11, 'always'], ['etc', 12, 'always'], ['etc', 13, 'always'],
  ];

  /** 该角色当前是否处于「骑乘中」的绘制状态（只对玩家生效，与 23904 一致） */
  function isRiding(g, c) {
    if (!g || !c) return false;
    if ((c.index | 0) !== 0) return false;
    return (g.getV65 ? (g.getV65(183) | 0) : 0) !== 0;
  }

  // ==========================================================================
  // 隐藏部位（梳妆台 itemfx 19 → *label_2809，295248-295352）
  // ==========================================================================
  /**
   * `var_508(20..24)` 是「部位是否绘制」：
   *   23863 `if ( var_508(24, prm_500) == 0 ) { …画 mantle… }`
   *   24008 `if ( var_508(20, prm_500) == 0 ) { …画 chest… }`
   *   24032 → 21 leg、24054 → 22 belt、24075 → 23 glove、24121 → 24 mantle(背)
   *   —— **0 = 显示，1 = 隐藏**（菜单里 295321 把 0 显示成 "On"，指的是绘制开着）。
   * 变量落在 `c.pcc[]` 的 20..24 位（该数组本来就按 var_508 建，长度 25）。
   */
  const HIDE_INDEX = { chest: 20, leg: 21, belt: 22, glove: 23, mantle: 24, mantlebk: 24 };
  /** 菜单顺序（*label_2809 的 295258：Done/Chest/Leg/Belt/Glove/Mantle） */
  const HIDE_PARTS = [
    { key: 'chest', idx: 20, jp: '胸', en: 'Chest' },
    { key: 'leg', idx: 21, jp: '腿', en: 'Leg' },
    { key: 'belt', idx: 22, jp: '腰带', en: 'Belt' },
    { key: 'glove', idx: 23, jp: '手套', en: 'Glove' },
    { key: 'mantle', idx: 24, jp: '披风', en: 'Mantle' },
  ];

  /** 该层是否被「隐藏部位」关掉 */
  function isHidden(c, layerName) {
    const i = HIDE_INDEX[layerName];
    if (i === undefined || !c || !c.pcc) return false;
    return (c.pcc[i] | 0) !== 0;
  }

  /** 读取 5 个开关（true = 隐藏） */
  function hideState(c) {
    const out = {};
    for (const p of HIDE_PARTS) out[p.key] = !!(c && c.pcc && (c.pcc[p.idx] | 0) !== 0);
    return out;
  }

  /** 写一个开关（0 = 显示，1 = 隐藏，与源码一致） */
  function setHide(c, key, hidden) {
    const p = HIDE_PARTS.find((x) => x.key === key);
    if (!p || !c) return false;
    if (!c.pcc) c.pcc = new Array(25).fill(0);
    c.pcc[p.idx] = hidden ? 1 : 0;
    c.__pccCache = null;          // 合成缓存失效
    return true;
  }

  /** 预加载某角色的全部部件图片 */
  async function preload(c, g) {
    ensure(c);
    await loadPalette();
    const riding = isRiding(g, c);
    const jobs = [];
    for (const [name, idx, when] of LAYERS) {
      if (when === 'riding' && !riding) continue;
      if (when === 'walking' && riding) continue;
      if (isHidden(c, name)) continue;
      const id = c.pcc[idx] | 0;
      if (!id) continue;
      const part = id % 1000;
      if (!part) continue;
      const path = BASE + 'pcc_' + name + '_' + part + '.bmp';
      if (!partExists(name, part)) { FAILED[path] = true; continue; }
      jobs.push(loadImage(path).catch(() => { FAILED[path] = true; return null; }));
    }
    await Promise.all(jobs);
  }

  /** 取着色后的部件 canvas（缓存） */
  function tinted(name, part, palIdx) {
    const key = name + '_' + part + '_' + palIdx;
    if (TINT[key]) return TINT[key];
    const img = IMG[BASE + 'pcc_' + name + '_' + part + '.bmp'];
    if (!img || typeof document === 'undefined') return null;
    const pal = (PALETTE && PALETTE[palIdx]) || [255, 255, 255];
    // 调色板 0/1 为占位黑色，表示「不染色」（身体等部件使用）
    const noTint = (palIdx | 0) <= 1;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    if (!noTint && (pal[0] !== 255 || pal[1] !== 255 || pal[2] !== 255)) {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = 'rgb(' + pal[0] + ',' + pal[1] + ',' + pal[2] + ')';
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    // BMP 无 Alpha：把背景色（43,133,133，调色后同比例变化）设为透明
    const bg = noTint ? [43, 133, 133] : [
      Math.round(43 * pal[0] / 255),
      Math.round(133 * pal[1] / 255),
      Math.round(133 * pal[2] / 255),
    ];
    const id = g.getImageData(0, 0, W, H);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - bg[0]) <= 3 && Math.abs(d[i + 1] - bg[1]) <= 3
        && Math.abs(d[i + 2] - bg[2]) <= 3) {
        d[i + 3] = 0;
      }
    }
    g.putImageData(id, 0, 0);
    TINT[key] = cv;
    return cv;
  }

  function pccKey(c, g) {
    return (c.pcc || []).join(',') + '|' + (c.get(8) | 0) + '|' + (isRiding(g, c) ? 'R' : '');
  }

  /** 合成到 128x192 的离屏 canvas；缺图时跳过该层（按 pcc 内容缓存） */
  function compose(c, gg) {
    if (typeof document === 'undefined') return null;
    ensure(c);
    const riding = isRiding(gg, c);
    const key = pccKey(c, gg);
    if (c.__pccCache && c.__pccCache.key === key) return c.__pccCache.canvas;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    let any = false;
    for (const [name, idx, when] of LAYERS) {
      if (when === 'riding' && !riding) continue;
      if (when === 'walking' && riding) continue;
      if (isHidden(c, name)) continue;                       // var_508(20..24) 隐藏部位
      const id = c.pcc[idx] | 0;
      if (!id) continue;
      const part = id % 1000;
      const palIdx = Math.floor(id / 1000);
      if (!part) continue;
      const path = BASE + 'pcc_' + name + '_' + part + '.bmp';
      // 源码 23785-24270 每层先 exist 判断：文件不存在就跳过该层，
      // 不能因为 hairbk_18 之类缺图让整张立绘变空白（0-FI）。
      if (!partExists(name, part) || FAILED[path]) { FAILED[path] = true; continue; }
      // 图未加载完时不缓存空结果，等 preload 完成后再合成
      if (!IMG[path]) return null;
      const im = tinted(name, part, palIdx);
      if (!im) continue;
      g.drawImage(im, 0, 0);
      any = true;
    }
    c.__pccCache = { key, canvas: any ? cv : null };
    c.__pccFrames = null;
    return any ? cv : null;
  }

  /**
   * 从 128×192 的 4×4 精灵表中裁出单帧（32×48）。
   * 帧 0 = 正面站立，与原版地图上的默认朝向一致。
   */
  function frame(c, index, gg) {
    const cv = compose(c, gg);
    if (!cv) return null;
    const key = pccKey(c, gg);
    if (!c.__pccFrames || c.__pccFrames.key !== key) c.__pccFrames = { key, frames: [] };
    const i = (index | 0) % 16;
    if (c.__pccFrames.frames[i]) return c.__pccFrames.frames[i];
    const col = i % 4, row = Math.floor(i / 4);
    const out = document.createElement('canvas');
    out.width = 32; out.height = 48;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, col * 32, row * 48, 32, 48, 0, 0, 32, 48);
    c.__pccFrames.frames[i] = out;
    return out;
  }

  /**
   * 绘制到地图格。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} c
   * @param {number} dx 左上角像素
   * @param {number} dy
   * @param {number} tile 格子像素（默认 48）
   */
  function draw(ctx, c, dx, dy, tile, gg) {
    const fr = frame(c, 0, gg);
    if (!fr) return false;
    const t = tile || 48;
    // 0-HM：原版地图上的 PCC 角色按素材原尺寸绘制（33367 `gmode 2, 32, 48`），
    //   与普通 NPC 的 48×48 格对齐，不再放大成 48×72（此前会显得比 NPC 大一圈）。
    const scale = t / 48;
    const w = Math.round(32 * scale);
    const h = Math.round(48 * scale);
    ctx.drawImage(fr, dx + Math.round((t - w) / 2), dy + t - h, w, h);
    return true;
  }

  /** 是否全部图片已就绪（用于 renderer 决定是否回退） */
  function ready(c, gg) {
    ensure(c);
    const riding = isRiding(gg, c);
    for (const [name, idx, when] of LAYERS) {
      if (when === 'riding' && !riding) continue;
      if (when === 'walking' && riding) continue;
      const id = c.pcc[idx] | 0;
      if (!id) continue;
      const part = id % 1000;
      if (!part) continue;
      const path = BASE + 'pcc_' + name + '_' + part + '.bmp';
      if (!partExists(name, part) || FAILED[path]) { FAILED[path] = true; continue; }
      if (!IMG[path]) return false;
    }
    return !!PALETTE;
  }

  Elona.PCC = {
    ensure, preload, compose, frame, draw, ready, isRiding,
    loadPalette, setPalette,
    HIDE_PARTS, HIDE_INDEX, isHidden, hideState, setHide,   // 梳妆台（itemfx 19）
    LAYERS, W, H, PART_COUNT, partExists,
  };
})(window);
