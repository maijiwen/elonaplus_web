'use strict';
/**
 * 用户图像覆盖（core/graphicoverride.js）—— `user/graphic/` 与 `user/graphic2/`
 *
 * 【原版语义】原版把这几个目录的**单格 bmp** 直接贴进内存图集，相当于「只替换一格素材」。
 *   玩家因此可以在不改动整张大图集的情况下换掉某个物品/角色的图标。
 *
 *   | 文件                | 目标图集 | 格号            | 源码 |
 *   | ------------------- | -------- | --------------- | ---- |
 *   | `graphic/chara_N.bmp` | 角色图集（gsel 5） | N        | 302981-302990 |
 *   | `graphic/item_N.bmp`  | 物品图集（gsel 1） | N        | 303014-303022 |
 *   | `graphic/Pic_N.bmp`   | 角色图集（gsel 5） | 692 + N  | 302992-303002 |
 *   | `item/planN.bmp`      | 物品图集（gsel 1） | 890 + N  | 303003-303013 |
 *   | `graphic/faceN.bmp`   | 单独一张（不贴图集） | —      | 293431 / 294994 / 425517 |
 *   | `graphic2/faceN_X.bmp` | 单独一张（高清立绘） | —      | 289363-289411 / 294683-294697 |
 *   | `graphic2/cutinN.bmp` | 单独一张（事件过场） | —      | 210336 |
 *   | `graphic2/animeEX.bmp` | 单独一张（动画）    | —      | 210268 |
 *
 * 【贴图规则】源码是 `picload file, 1` —— HSP 的第二参数 1 表示「用左上角像素当透明色」。
 *   网页版同样处理：取该 bmp 的左上角像素，把同色像素抠成透明后再贴。
 *
 * 【时机】图集加载完（`loadCharacterSheet` / `loadItemSheet`）之后调用 `applyTo(renderer)`。
 *   目录变更（`invalidate`）后需要重新调用。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const TILE = 48;        // 原版 cell 32×48 的「方格里格」；网页 renderer 用 48
  const COLS = 33;

  // 两套图集分开记「已贴过」—— 角色与物品的加载时机不同，不能共用一个标记
  const done = { chara: false, item: false };
  let applied = false;    // 两套都贴过了
  let applying = null;

  // ---------------------------------------------------------------- 工具
  function toCanvas(sheet) {
    if (!sheet) return null;
    if (typeof sheet.getContext === 'function') return sheet;
    try {
      const cv = global.document.createElement('canvas');
      cv.width = sheet.width;
      cv.height = sheet.height;
      cv.getContext('2d').drawImage(sheet, 0, 0);
      return cv;
    } catch (e) { return null; }
  }

  function loadImage(blob) {
    return new Promise((resolve) => {
      let url = null;
      try { url = global.URL.createObjectURL(blob); } catch (e) { resolve(null); return; }
      const img = new global.Image();
      img.onload = () => { global.URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { global.URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  /** 取左上角像素作为透明色，返回处理后的 canvas（失败则原图） */
  function keyedCanvas(img) {
    try {
      const cv = global.document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height);
      const p = d.data;
      if (!p.length) return cv;
      const kr = p[0], kg = p[1], kb = p[2];
      // 左上角完全透明就不用抠
      if (p[3] !== 0) {
        for (let i = 0; i < p.length; i += 4) {
          if (p[i] === kr && p[i + 1] === kg && p[i + 2] === kb) p[i + 3] = 0;
        }
        g.putImageData(d, 0, 0);
      }
      return cv;
    } catch (e) { return img; }
  }

  /** 把一张单格图贴到图集的第 cell 格（33 列） */
  function blit(sheetCanvas, src, cell) {
    if (!sheetCanvas || !src) return false;
    try {
      const c = cell | 0;
      if (c < 0) return false;
      const x = (c % COLS) * TILE;
      const y = Math.floor(c / COLS) * TILE;
      if (y >= sheetCanvas.height) return false;
      const g = sheetCanvas.getContext('2d');
      g.clearRect(x, y, TILE, TILE);
      // 原图可能不是 48×48（高清素材），按比例缩放到格子里
      g.drawImage(src, 0, 0, src.width, src.height, x, y, TILE, TILE);
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- 主流程
  /**
   * 把 user/graphic 与 user/item 下的单格 bmp 贴到渲染器的图集上。
   * @param {object} r Elona.Renderer 实例
   * @returns {Promise<{chara:number, item:number, pic:number, plan:number}>}
   */
  async function applyTo(r) {
    const stat = { chara: 0, item: 0, pic: 0, plan: 0 };
    const U = Elona.UserDir;
    // 不判 ready：内置素材包也算来源（见文件头「三层取数」）。
    if (!r || !U) return stat;
    if (applying) return applying;
    applying = (async () => {
      const chara = toCanvas(r.sheets && r.sheets.character);
      const item = toCanvas(r.itemSheet);
      if (chara && r.sheets) r.sheets.character = chara;
      if (item) r.itemSheet = item;

      // graphic/chara_N.bmp → 角色图集第 N 格（302981-302990）
      if (chara && !done.chara) {
        for (const name of await U.list('graphic', 'chara_*.bmp')) {
          const n = parseInt(String(name).slice(6), 10);
          if (!(n >= 0)) continue;
          const b = await U.readBytes('graphic/' + name);
          if (!b) continue;
          const img = await loadImage(new global.Blob([b], { type: 'image/bmp' }));
          if (!img) continue;
          if (blit(chara, keyedCanvas(img), n)) stat.chara++;
        }
        // graphic/Pic_N.bmp → 角色图集第 692+N 格（302992-303002）
        for (const name of await U.list('graphic', 'Pic_*.bmp')) {
          const n = parseInt(String(name).slice(4), 10);
          if (!(n >= 0)) continue;
          const b = await U.readBytes('graphic/' + name);
          if (!b) continue;
          const img = await loadImage(new global.Blob([b], { type: 'image/bmp' }));
          if (!img) continue;
          if (blit(chara, keyedCanvas(img), 692 + n)) stat.pic++;
        }
        done.chara = true;
      }
      if (item && !done.item) {
        // graphic/item_N.bmp → 物品图集第 N 格（303014-303022）
        for (const name of await U.list('graphic', 'item_*.bmp')) {
          const n = parseInt(String(name).slice(5), 10);
          if (!(n >= 0)) continue;
          const b = await U.readBytes('graphic/' + name);
          if (!b) continue;
          const img = await loadImage(new global.Blob([b], { type: 'image/bmp' }));
          if (!img) continue;
          if (blit(item, keyedCanvas(img), n)) stat.item++;
        }
        // item/planN.bmp → 物品图集第 890+N 格（303003-303013）
        for (const name of await U.list('item', 'plan*.bmp')) {
          const n = parseInt(String(name).slice(4), 10);
          if (!(n >= 0)) continue;
          const b = await U.readBytes('item/' + name);
          if (!b) continue;
          const img = await loadImage(new global.Blob([b], { type: 'image/bmp' }));
          if (!img) continue;
          if (blit(item, keyedCanvas(img), 890 + n)) stat.plan++;
        }
        done.item = true;
      }
      applied = done.chara || done.item;
      return stat;
    })();
    try { return await applying; } finally { applying = null; }
  }

  // ---------------------------------------------------------------- 单张图
  /**
   * 玩家自定义脸 —— `user/graphic/faceN.bmp`（425517-425530 / 293430-293435）。
   *
   * 源码：`if (var_58(13) < 0) { var_121 = user\graphic\face<abs(13+1)>.bmp;
   *        if (var_58(13) != -1) { if (exist) picload } }`
   *   → portrait **< -1** 才贴自定义脸，N = |portrait+1|（-2 → face1.bmp，-40 → face39.bmp）；
   *   portrait == -1 是「用 graphic\face1.bmp 的默认格」，走内置脸图集。
   * 创建角色时肖像范围就是 -40..30（295185/295211），负数这一段全是自定义脸。
   * @returns {Promise<string|null>} blob URL / 静态 URL / null
   */
  async function faceUrl(portrait) {
    const p = portrait | 0;
    if (p >= -1) return null;                    // -1 与正数都走内置脸图集
    const n = Math.abs(p + 1);
    const U = Elona.UserDir;
    if (!U) return null;
    return U.url('graphic/face' + n + '.bmp');
  }

  /** 自定义脸编号（portrait → faceN.bmp 的 N；返回 0 表示不用自定义脸） */
  function faceNoOf(portrait) {
    const p = portrait | 0;
    return p < -1 ? Math.abs(p + 1) : 0;
  }

  /**
   * 高清立绘 —— `user/graphic2/faceN_X.bmp`（289363-289411）。
   * 源码按 `var_58(431)`（立绘编号）拼文件名，X 是表情：B 是默认，
   * A/Q/F/H/E 是不同情绪，取不到就依次回退（289365-289377）。
   * @param {number} picNo 立绘编号
   * @param {string} [mood] 'B'|'A'|'Q'|'F'|'H'|'E'
   */
  async function highResFaceUrl(picNo, mood) {
    const n = picNo | 0;
    if (n <= 0) return null;
    const U = Elona.UserDir;
    if (!U) return null;
    // 源码顺序：先试请求的表情，再按 B→A→Q→F→H→E 回退
    const order = [];
    const m = String(mood || 'B').toUpperCase();
    order.push(m);
    for (const x of ['B', 'A', 'Q', 'F', 'H', 'E']) if (x !== m) order.push(x);
    for (const x of order) {
      const u = await U.url('graphic2/face' + n + '_' + x + '.bmp');
      if (u) return u;
    }
    return null;
  }

  /** 事件过场立绘 —— `user/graphic2/cutinN.bmp`（210336） */
  async function cutinUrl(n) {
    const U = Elona.UserDir;
    if (!U) return null;
    return U.url('graphic2/cutin' + (n | 0) + '.bmp');
  }

  /** 动画素材 —— `user/graphic2/animeEX.bmp`（210268） */
  async function animeExUrl() {
    const U = Elona.UserDir;
    if (!U) return null;
    return U.url('graphic2/animeEX.bmp');
  }

  const GraphicOverride = {
    TILE, COLS,
    applyTo,
    faceUrl, faceNoOf, highResFaceUrl, cutinUrl, animeExUrl,
    /** 目录变了：下次 applyTo 重新贴 */
    invalidate() { done.chara = false; done.item = false; applied = false; },
    get applied() { return applied; },
    // 工具（测试用）
    _blit: blit, _keyedCanvas: keyedCanvas, _toCanvas: toCanvas,
  };

  Elona.GraphicOverride = GraphicOverride;
})(window);
