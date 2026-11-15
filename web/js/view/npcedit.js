'use strict';
/**
 * NPC 外观编辑器（view/npcedit.js）—— 四个操作弹窗动作的接线层
 *
 * 【源码依据】hsp/start.hsp（cp932，行号为 1 起始）
 *   294968-295245  *label_2803「着替えさせる」（动作 8）：
 *     两页菜单（基本 9 项 + 自定义角色/骑乘时；详细 8 项），左右键改
 *     var_508(部件,角色)（打包成 颜色*1000 + 部件编号）、var_58(13) 肖像、
 *     cbit 967 自定义角色；Enter 决定、Esc 取消并还原。
 *     部件表见 *label_2789（294362-294445）：1 髪 / 10 副髪 / 15 体 /
 *     9 服 / 7 パンツ / 11-13 饰品 / 14 目 / 16 骑乘 / 1(色) 髪色。
 *   294768-294965  *label_2800「姿を変える」（动作 14）：
 *     扫 user/graphic/Pic_1..40.bmp，菜单「決定 / 元々の姿にする / 適用：Pic_N」；
 *     左右键在 var_58(7) = 694..724 间切换，var_58(95) 存原图，
 *     var_65(173) 标记「已改外形」，全屏窗口 + 镜子装饰。
 *   294463-294575  *label_2791「アイテム画像の移動」（动作 25）：
 *     方向键改 var_58(448/449)，z 切 cbit 1025（前后层）、x 切 cbit 1052（左右反转），
 *     Enter 决定、取消键还原 var_2240/2241；每帧 redraw 1 实时重画。
 *   294575-294670  *label_2794「アイテム画像のサイズ調整」（动作 26）：
 *     上下改 var_58(99)、左右改 var_58(46)、z/x 改 var_58(47) 角度，
 *     取消还原 var_2242/2243/2244。
 *   34275-34347 / 33164-33221  脚下道具图像的绘制：
 *     pos = (x+12+448, y+18+449)，grotate 角度 = 47*6.54498469498，
 *     输出宽 = W/2 + 46*2、高 = H/2 + 99*2，cbit 1052 时水平镜像，
 *     cbit 1025 决定画在角色之前（后层）还是之后（前层）。
 *
 * 【本项目的等价实现】
 *   · 294784 / 302992：`user` 是玩家自定义目录，往里放同名素材就会替换游戏中
 *     同名的原本素材。原版从 `user\graphic\Pic_1..40.bmp` 逐个 picload，
 *     按编号覆盖 character.bmp 的 693+N 号槽（即 var_58(7)=694..724）。
 *     Web 版映射到 `assets/user/graphic/Pic_N.bmp`（同名 .png 亦可）；
 *     文件不存在才回退内置槽。仓库里该目录默认为空，用户自行放入素材即生效。
 *   · 「画面上边看边拖」用面板内的 canvas 直接拖拽，同时把值写回 var_58；
 *     主循环每帧重画地图（main.js startLoop），所以地图上的脚下图像同步实时变化。
 *
 * 纯逻辑（不依赖 DOM）导出为 Elona.NPCEdit，供回归脚本在 Node 里直接 require；
 * 面板方法挂在 Elona.Panels 上，复用其 open / onKeyFn / onClose 按键体系。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const KEY_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

  function cbitOf(who, bit) {
    if (Elona.Status && Elona.Status.cbit) return Elona.Status.cbit(who, bit) | 0;
    return ((who.get(450 + idiv(bit, 32)) | 0) >>> (bit % 32)) & 1;
  }
  function cbitSet(who, bit, on) {
    if (Elona.Status && Elona.Status.cbitmod) { Elona.Status.cbitmod(who, bit, !!on); return; }
    const idx = 450 + idiv(bit, 32), mask = 1 << (bit % 32);
    who.set(idx, on ? ((who.get(idx) | 0) | mask) : ((who.get(idx) | 0) & ~mask));
  }

  // ---------------------------------------------------------------- 换装
  /** web/assets/graphic/PCCs 实测的部件数量（对应源码的 exist 边界） */
  const PART_MAX = { hair: 18, subhair: 18, cloth: 17, pants: 7, body: 6, eye: 13, etc: 43, ride: 4 };
  const COLOR_MAX = 30;                 // 294... `31 - 1`
  const PORTRAIT_MIN = -41, PORTRAIT_MAX = 31;

  /** 与 view/charcreate.js 的 LOOK_PAGES 逐项一致（*label_2789） */
  const DRESS_PAGES = [
    [
      { jp: '确定', key: 'done' },
      { jp: '肖像', key: 'portrait' },
      { jp: '发型', idx: 1, layer: 'hair' },
      { jp: '副发型', idx: 10, layer: 'subhair' },
      { jp: '发色', idx: 1, color: true },
      { jp: '身体', idx: 15, layer: 'body' },
      { jp: '衣服', idx: 9, layer: 'cloth' },
      { jp: '裤子', idx: 7, layer: 'pants' },
      { jp: '详细设置', key: 'page1' },
    ],
    [
      { jp: '肤色', idx: 15, color: true },
      { jp: '衣服颜色', idx: 9, color: true },
      { jp: '裤子颜色', idx: 7, color: true },
      { jp: '饰品 1', idx: 11, layer: 'etc' },
      { jp: '饰品 2', idx: 12, layer: 'etc' },
      { jp: '饰品 3', idx: 13, layer: 'etc' },
      { jp: '眼睛', idx: 14, layer: 'eye' },
      { jp: '基本设置', key: 'page0' },
    ],
  ];

  /** 第 10 项：NPC 是「自定义角色」开关，玩家自己是「骑乘时」部件（295005-295010） */
  function dressRows(who, page) {
    const base = DRESS_PAGES[page | 0].map((x) => Object.assign({}, x));
    if ((page | 0) === 0) {
      base.push((who.index | 0) !== 0
        ? { jp: '自定义角色', key: 'custom' }
        : { jp: '骑乘时', idx: 16, layer: 'ride' });
    }
    return base;
  }

  function dressValue(who, it) {
    if (it.key === 'portrait') return who.get(13) | 0;
    if (it.key === 'custom') return cbitOf(who, 967);
    if (it.idx === undefined) return 0;
    const v = (who.pcc && who.pcc[it.idx] | 0) || 0;
    return it.color ? idiv(v, 1000) : (v % 1000);
  }

  /** 左右键改一个部件（294... + 295180-295245）。dir = +1 / -1 */
  function dressChange(who, it, dir) {
    if (it.key === 'done') return { kind: 'done' };
    if (it.key === 'page0' || it.key === 'page1') {
      return { kind: 'page', page: it.key === 'page1' ? 1 : 0 };
    }
    if (it.key === 'portrait') {
      const v = clamp((who.get(13) | 0) + dir, PORTRAIT_MIN, PORTRAIT_MAX);
      who.set(13, v);
      return { kind: 'value', value: v };
    }
    if (it.key === 'custom') {
      const on = cbitOf(who, 967) ? 0 : 1;
      cbitSet(who, 967, on);
      return { kind: 'custom', value: on };
    }
    if (it.idx === undefined) return { kind: 'none' };
    if (!who.pcc) who.pcc = new Array(25).fill(0);
    const old = who.pcc[it.idx] | 0;
    const color = idiv(old, 1000), part = old % 1000;
    if (it.color) {
      who.pcc[it.idx] = clamp(color + dir, 0, COLOR_MAX) * 1000 + part;
    } else {
      const max = PART_MAX[it.layer] || 1;
      let p = part + dir;
      // 源码用 `exist graphic\PCCs\pcc_<layer>_<n>.bmp` 判边界；
      // 本项目用 PCC.partExists 跳过缺失的部件文件。
      const exists = (n) => !(Elona.PCC && Elona.PCC.partExists)
        || Elona.PCC.partExists(it.layer, n);
      while (p >= 1 && p <= max && !exists(p)) p += dir;
      if (p < 1 || p > max) return { kind: 'value', value: part };
      who.pcc[it.idx] = color * 1000 + p;
    }
    // 非玩家角色要让地图上改用 PCC 合成图，否则换装看不出效果
    if ((who.index | 0) !== 0) cbitSet(who, 967, 1);
    return { kind: 'value', value: dressValue(who, it) };
  }

  // ---------------------------------------------------------------- 改变外形
  /** 源码 repeat 40 扫 Pic_1..40；var_58(7) 的有效区间是 694..724（31 个槽） */
  function shapeCandidates() {
    const out = [];
    for (let n = 1; n <= 31; n++) {
      // 294784 `var_47 + "user\\graphic\\Pic_" + (cnt+1) + ".bmp"`、
      // 302992 `dirlist var_119 + "Pic_*.bmp"`：user 目录优先，覆盖内置槽。
      // Web 版同时接受同名 .png（浏览器友好），两者都缺才回退 character.bmp。
      const base = `assets/user/graphic/Pic_${n}`;
      out.push({
        n, chip: 693 + n,
        file: `${base}.bmp`,
        files: [`${base}.bmp`, `${base}.png`],
      });
    }
    return out;
  }
  function shapeEnter(g, who) {
    const orig = who.get(7) | 0;
    if (orig < 694 || orig > 724) {          // 294808-294811：存原图再套默认外形
      who.set(95, orig);
      who.set(7, 694);
    }
    if (g && typeof g.setV65 === 'function') g.setV65(173, 1);
    return { orig, cur: who.get(7) | 0 };
  }
  function shapeApply(g, who, n) {
    const chip = clamp(693 + (n | 0), 694, 724);
    who.set(7, chip);
    if (g && typeof g.setV65 === 'function') g.setV65(173, 1);
    return chip;
  }
  function shapeRestore(g, who, orig) {
    who.set(7, orig | 0);
    cbitSet(who, 967, 0);                    // 294890：恢复原样时关掉自定义角色
    if (g && typeof g.setV65 === 'function') g.setV65(173, 0);
    return who.get(7) | 0;
  }

  // ---------------------------------------------------------------- 道具图像
  /** var_58(448/449) 的边界（294510-294543） */
  function markMove(who, dx, dy) {
    who.set(448, clamp((who.get(448) | 0) + (dx | 0), 0, 22));
    who.set(449, clamp((who.get(449) | 0) + (dy | 0), -62, 0));
    return { x: who.get(448) | 0, y: who.get(449) | 0 };
  }
  /** var_58(99/46/47) 的边界（294610-294660） */
  function markAdjust(who, dv, dh, da) {
    who.set(99, clamp((who.get(99) | 0) + (dv | 0), -9, 36));
    who.set(46, clamp((who.get(46) | 0) + (dh | 0), -9, 36));
    who.set(47, clamp((who.get(47) | 0) + (da | 0), -11, 11));
    return { v: who.get(99) | 0, h: who.get(46) | 0, a: who.get(47) | 0 };
  }
  /** 34278-34347 的绘制参数，renderer 与编辑器 canvas 共用 */
  function markGeometry(who, w, h) {
    return {
      id: who.get(447) | 0,
      x: 12 + (who.get(448) | 0),
      y: (h > 48 ? 14 : 18) + (who.get(449) | 0),
      w: Math.max(1, w / 2 + (who.get(46) | 0) * 2),
      h: Math.max(1, h / 2 + (who.get(99) | 0) * 2),
      flip: cbitOf(who, 1052) ? -1 : 1,
      angle: (who.get(47) | 0) * 6.54498469498 * Math.PI / 180,
      behind: !!cbitOf(who, 1025),
    };
  }

  const API = {
    PART_MAX, COLOR_MAX, DRESS_PAGES, dressRows, dressValue, dressChange,
    shapeCandidates, shapeEnter, shapeApply, shapeRestore,
    markMove, markAdjust, markGeometry,
    cbitOf, cbitSet,
  };
  Elona.NPCEdit = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  // ======================================================================
  // 面板（浏览器）
  // ======================================================================
  if (typeof document === 'undefined') return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const $ = (P, sel) => (P.root ? P.root.querySelector(sel) : null);

  /** 角色头像（face1/face2 图集，与 charcreate.faceTileOf 同一套） */
  function paintFace(P, who, sel) {
    const box = $(P, sel);
    if (!box || !Elona.CharCreate || !Elona.CharCreate.faceTileOf) return;
    const f = Elona.CharCreate.faceTileOf(who.get(8) | 0, Math.max(0, who.get(13) | 0));
    box.style.backgroundImage = `url('assets/graphic/${f.img}')`;
    box.style.backgroundPosition = `-${f.x | 0}px -${f.y | 0}px`;
  }

  let charSheet = null;
  function characterSheet(cb) {
    if (charSheet) { cb(charSheet); return; }
    const img = new Image();
    img.onload = () => { charSheet = img; cb(img); };
    img.onerror = () => cb(null);
    img.src = 'assets/graphic/character.bmp';
  }
  const COLS = 33, TILE = 48;

  let itemSheet = null;
  function itemImage(cb) {
    if (itemSheet) { cb(itemSheet); return; }
    const img = new Image();
    img.onload = () => { itemSheet = img; cb(img); };
    img.onerror = () => cb(null);
    img.src = 'assets/graphic/item.png';
  }
  function gidOf(id) {
    return (Elona.ItemDB && Elona.ItemDB.graphic) ? Elona.ItemDB.graphic(id) : -1;
  }
  function iconH(gid) {
    return (Elona.ItemDB && Elona.ItemDB.iconHeight) ? (Elona.ItemDB.iconHeight(gid) | 0) : TILE;
  }

  /** 把 character.bmp 的一格放大画到 canvas（外形预览 / 编辑器角色底图） */
  function drawChip(ctx, sheet, chip, dx, dy, scale) {
    if (!sheet || chip < 0) return;
    const sx = (chip % COLS) * TILE, sy = idiv(chip, COLS) * TILE;
    if (sx + TILE > sheet.width || sy + TILE > sheet.height) return;
    ctx.drawImage(sheet, sx, sy, TILE, TILE, dx, dy, TILE * scale, TILE * scale);
  }

  /** 按 markGeometry 在任意 ctx 上画脚下道具图像（与 renderer 同一套参数） */
  function drawMark(ctx, isheet, who, ox, oy, scale) {
    const gid = gidOf(who.get(447) | 0);
    if (!isheet || gid < 0) return null;
    const h = iconH(gid) || TILE;
    const m = markGeometry(who, TILE, h);
    const sx = (gid % COLS) * TILE, sy = idiv(gid, COLS) * TILE;
    if (sx + TILE > isheet.width || sy + h > isheet.height) return m;
    ctx.save();
    const cx = ox + (m.x + m.w / 2) * scale;
    const cy = oy + (m.y + m.h / 2) * scale;
    ctx.translate(cx, cy);
    ctx.rotate(m.angle);
    ctx.scale(m.flip, 1);
    ctx.drawImage(isheet, sx, sy, TILE, h,
      -m.w * scale / 2, -m.h * scale / 2, m.w * scale, m.h * scale);
    ctx.restore();
    return m;
  }

  function install(P) {
    // ------------------------------------------------------------ 8 换装
    P.openDress = function (g, who) {
      if (!who) return;
      const orig = {
        pcc: (who.pcc || []).slice(),
        portrait: who.get(13) | 0,
        custom: cbitOf(who, 967),
      };
      let page = 0, confirmed = false;
      const rows = () => dressRows(who, page);
      const html = () => `<div class="ne-wrap ne-dress">`
        + `<div class="ne-list">${rows().map((r, i) => `<div class="pui-row ne-row" data-i="${i}">`
          + `<span class="pui-key">${KEY_LETTERS[i] || ''}</span>`
          + `<span class="pui-name">${esc(r.jp)}</span>`
          + `<span class="ne-val" id="ne-v-${i}"></span></div>`).join('')}</div>`
        + `<div class="ne-preview"><div class="ne-face" id="ne-face"></div>`
        + `<canvas id="ne-pcc" width="128" height="192"></canvas>`
        + `<div class="ne-note" id="ne-note"></div></div></div>`;

      const paint = () => {
        const list = rows();
        P.rows = list.map((r, i) => ({ i, r }));
        P.renderSel();
        list.forEach((r, i) => {
          const v = $(P, `#ne-v-${i}`);
          if (v) v.textContent = (r.key === 'done' || r.key === 'page0'
            || r.key === 'page1' || r.key === 'custom')
            ? (r.key === 'custom' ? (dressValue(who, r) ? '开' : '关') : '')
            : String(dressValue(who, r));
        });
        paintFace(P, who, '#ne-face');
        const note = $(P, '#ne-note');
        if (note) note.textContent = `第 ${page + 1} 页　肖像 ${who.get(13) | 0}　`
          + `自定义角色 ${cbitOf(who, 967) ? '开' : '关'}`;
        const cv = $(P, '#ne-pcc');
        if (cv && Elona.PCC && Elona.PCC.preload) {
          Elona.PCC.preload(who, g).then(() => {
            const done = (canvas) => {
              if (!canvas || !cv.isConnected) return;
              const c2 = cv.getContext('2d');
              c2.clearRect(0, 0, cv.width, cv.height);
              c2.imageSmoothingEnabled = false;
              c2.drawImage(canvas, 0, 0, cv.width, cv.height);
            };
            done(Elona.PCC.compose(who, g));
          }).catch(() => { });
        }
      };

      const apply = (it, dir) => {
        const r = dressChange(who, it, dir);
        if (r.kind === 'done') { confirmed = true; P.close(); return; }
        if (r.kind === 'page') {
          page = r.page;
          P.sel = 0;
          $(P, '#pui-body').innerHTML = html();
          paint();
          return;
        }
        paint();
      };

      P.open('dress', '肖像 / 换装（着替え）', html(), {
        wide: true, hint: '↑/↓ 选项目　←/→ 改变　Enter 决定　Esc 取消',
      });
      P.onActivate = (i) => apply(rows()[i] || rows()[0], 1);
      P.onKeyFn = (e) => {
        const it = rows()[P.sel | 0] || rows()[0];
        if (e.key === 'ArrowLeft' || e.key === '4') { apply(it, -1); return true; }
        if (e.key === 'ArrowRight' || e.key === '6') { apply(it, 1); return true; }
        return false;
      };
      P.onClose = () => {
        if (confirmed) return;
        who.pcc = orig.pcc.slice();
        who.set(13, orig.portrait);
        cbitSet(who, 967, orig.custom);
      };
      paint();
    };

    // ------------------------------------------------------------ 14 改变外形
    P.openShape = function (g, who) {
      if (!who) return;
      const st = shapeEnter(g, who);
      const list = shapeCandidates();
      let n = clamp((who.get(7) | 0) - 693, 1, list.length);
      let confirmed = false;
      // Pic_N.png 缺失缓存放在闭包里：P.openShape 是匿名函数表达式，
      // 函数体内并不存在 openShape 这个标识符（旧写法会抛 ReferenceError）。
      const missing = Object.create(null);
      const rowsDef = [
        { jp: '确定', key: 'done' },
        { jp: '恢复原来的样子', key: 'restore' },
        { jp: '适用：Pic_N', key: 'pick' },
      ];
      const html = () => `<div class="ne-wrap ne-shape">`
        + `<div class="ne-list">${rowsDef.map((r, i) => `<div class="pui-row ne-row" data-i="${i}">`
          + `<span class="pui-key">${KEY_LETTERS[i] || ''}</span>`
          + `<span class="pui-name">${r.key === 'pick' ? `适用：Pic_${n}` : esc(r.jp)}</span>`
          + `<span class="ne-val" id="ne-v-${i}"></span></div>`).join('')}</div>`
        + `<div class="ne-preview"><canvas id="ne-shape" width="192" height="192"></canvas>`
        + `<div class="ne-note" id="ne-shape-note"></div></div></div>`;

      const paint = () => {
        P.rows = rowsDef.map((r, i) => ({ i, r }));
        P.renderSel();
        const idx = $(P, '#ne-v-2');
        if (idx) idx.textContent = `chip ${list[n - 1].chip}`;
        const note = $(P, '#ne-shape-note');
        if (note) note.textContent = `Pic_${n} ／ var_58(7) = ${who.get(7) | 0}`
          + `　原图 var_58(95) = ${who.get(95) | 0}`;
        const cv = $(P, '#ne-shape');
        if (!cv) return;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = 'rgba(60,44,24,.16)';
        ctx.fillRect(0, 0, cv.width, cv.height);
        // 素材存在性只探测一次，避免每次左右切换都刷 404。
        // user/graphic 优先（源码 294784 / 302992）：.bmp → .png 依次尝试，
        // 都不存在才回退 character.bmp 的 693+N 内置槽（原版自带提示图）。
        const item = list[n - 1];
        const fallback = () => {
          characterSheet((sheet) => {
            if (!cv.isConnected) return;
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.imageSmoothingEnabled = false;
            drawChip(ctx, sheet, item.chip, 0, 0, 4);
          });
        };
        const tryFile = (i) => {
          if (i >= item.files.length) { fallback(); return; }
          const file = item.files[i];
          if (missing[file]) { tryFile(i + 1); return; }
          const custom = new Image();
          custom.onload = () => {
            if (!cv.isConnected) return;
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawImage(custom, 0, 0, cv.width, cv.height);
          };
          custom.onerror = () => { missing[file] = true; tryFile(i + 1); };
          custom.src = file;
        };
        tryFile(0);
      };

      const finish = (restore) => {
        if (restore) shapeRestore(g, who, st.orig);
        else if (g && typeof g.setV65 === 'function') g.setV65(173, 0);
        confirmed = true;
        P.close();
      };
      P.open('shape', '改变外形（個別画像の変更）', html(), {
        wide: true, hint: '←/→ 换外形　Enter 决定　Esc 取消',
      });
      P.onActivate = (i) => {
        const k = (rowsDef[i] || rowsDef[0]).key;
        if (k === 'done') finish(false);
        else if (k === 'restore') finish(true);
        else { n = clamp(n + 1, 1, list.length); shapeApply(g, who, n); }
      };
      P.onKeyFn = (e) => {
        if (e.key === 'ArrowLeft' || e.key === '4') {
          n = clamp(n - 1, 1, list.length); shapeApply(g, who, n);
          $(P, '#pui-body').innerHTML = html(); paint(); return true;
        }
        if (e.key === 'ArrowRight' || e.key === '6') {
          n = clamp(n + 1, 1, list.length); shapeApply(g, who, n);
          $(P, '#pui-body').innerHTML = html(); paint(); return true;
        }
        return false;
      };
      P.onClose = () => {
        if (confirmed) return;
        shapeRestore(g, who, st.orig);
      };
      paint();
    };

    // ------------------------------------------------------------ 25 / 26 道具图像
    /**
     * @param {'move'|'adjust'} mode
     */
    P.openItemMark = function (g, who, mode) {
      if (!who) return;
      const isMove = mode !== 'adjust';
      const orig = {
        x: who.get(448) | 0, y: who.get(449) | 0,
        v: who.get(99) | 0, h: who.get(46) | 0, a: who.get(47) | 0,
        b1025: cbitOf(who, 1025), b1052: cbitOf(who, 1052),
      };
      let confirmed = false;
      const SCALE = 3;
      const html = () => `<div class="ne-wrap ne-mark">`
        + `<div class="ne-canvas-box"><canvas id="ne-mark" width="360" height="360"></canvas></div>`
        + `<div class="ne-side"><div class="ne-readout" id="ne-readout"></div>`
        + `<div class="ne-hint">${isMove
          ? '在画布里直接拖动脚下图像改变位移。<br>方向键微调，z 切前后层，x 左右翻转。'
          : '在画布里直接拖动改变纵向 / 横向大小。<br>方向键微调，z / x 调整角度。'}</div>`
        + `<div class="ne-hint">Enter 决定　Esc 取消（还原）</div></div></div>`;

      const paint = () => {
        const cv = $(P, '#ne-mark');
        if (!cv) return;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.imageSmoothingEnabled = false;
        // 画布中心放一个 48px 格（放大 3 倍），模拟地图上的角色
        const ox = (cv.width - TILE * SCALE) / 2;
        const oy = (cv.height - TILE * SCALE) / 2;
        ctx.strokeStyle = 'rgba(80,60,30,.5)';
        ctx.strokeRect(ox, oy, TILE * SCALE, TILE * SCALE);
        // 等两张图集都就绪再按 cbit 1025 的层次顺序画，避免异步回调乱序
        const m = markGeometry(who, TILE, iconH(gidOf(who.get(447) | 0)) || TILE);
        characterSheet((cs) => itemImage((is) => {
          if (!cv.isConnected) return;
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.imageSmoothingEnabled = false;
          if (m.behind) drawMark(ctx, is, who, ox, oy, SCALE);
          drawChip(ctx, cs, who.get(7) | 0, ox, oy, SCALE);
          if (!m.behind) drawMark(ctx, is, who, ox, oy, SCALE);
        }));
        const out = $(P, '#ne-readout');
        if (out) {
          out.textContent = isMove
            ? `位移 X ${who.get(448) | 0} (0..22)　Y ${who.get(449) | 0} (-62..0)\n`
              + `前后层 ${cbitOf(who, 1025) ? '后' : '前'}　翻转 ${cbitOf(who, 1052) ? '开' : '关'}`
            : `纵向 ${who.get(99) | 0}　横向 ${who.get(46) | 0}　角度 ${who.get(47) | 0}`
              + `\n前后层 ${cbitOf(who, 1025) ? '后' : '前'}　翻转 ${cbitOf(who, 1052) ? '开' : '关'}`;
        }
      };

      const redrawMap = () => {
        // main.js 的 startLoop 每帧 drawMap，字段改了地图自然实时重画；
        // 这里只更新 lastMove 让「静止时不重绘」的优化不会挡住本次改动。
        if (Elona.renderer && typeof performance !== 'undefined') {
          Elona.renderer.lastMove = performance.now();
        }
        paint();
      };

      P.open('item-mark', isMove ? '移动道具图像' : '调整道具图像', html(), {
        wide: true, hint: '拖拽 / 方向键 调整　Enter 决定　Esc 取消',
      });
      P.rows = [];
      P.onKeyFn = (e) => {
        const k = e.key;
        if (k === 'ArrowUp' || k === '8') {
          if (isMove) markMove(who, 0, -1); else markAdjust(who, 1, 0, 0);
          redrawMap(); return true;
        }
        if (k === 'ArrowDown' || k === '2') {
          if (isMove) markMove(who, 0, 1); else markAdjust(who, -1, 0, 0);
          redrawMap(); return true;
        }
        if (k === 'ArrowLeft' || k === '4') {
          if (isMove) markMove(who, -1, 0); else markAdjust(who, 0, -1, 0);
          redrawMap(); return true;
        }
        if (k === 'ArrowRight' || k === '6') {
          if (isMove) markMove(who, 1, 0); else markAdjust(who, 0, 1, 0);
          redrawMap(); return true;
        }
        if (k === 'z' || k === 'Z') {
          if (isMove) cbitSet(who, 1025, !cbitOf(who, 1025));
          else markAdjust(who, 0, 0, 1);
          redrawMap(); return true;
        }
        if (k === 'x' || k === 'X') {
          if (isMove) cbitSet(who, 1052, !cbitOf(who, 1052));
          else markAdjust(who, 0, 0, -1);
          redrawMap(); return true;
        }
        if (k === 'Enter' || k === ' ') { confirmed = true; P.close(); return true; }
        return false;
      };
      P.onClose = () => {
        if (confirmed) return;
        who.set(448, orig.x); who.set(449, orig.y);
        who.set(99, orig.v); who.set(46, orig.h); who.set(47, orig.a);
        cbitSet(who, 1025, orig.b1025); cbitSet(who, 1052, orig.b1052);
        redrawMap();
      };

      // 画布内直接拖拽：move 改位移，adjust 改尺寸（拖动增量按放大倍率折算）
      const cv = $(P, '#ne-mark');
      if (cv) {
        let last = null;
        cv.addEventListener('mousedown', (ev) => {
          last = { x: ev.offsetX, y: ev.offsetY };
          ev.preventDefault();
        });
        cv.addEventListener('mousemove', (ev) => {
          if (!last) return;
          const dx = Math.round((ev.offsetX - last.x) / SCALE);
          const dy = Math.round((ev.offsetY - last.y) / SCALE);
          if (!dx && !dy) return;
          last = { x: ev.offsetX, y: ev.offsetY };
          if (isMove) markMove(who, dx, dy);
          else markAdjust(who, dy, dx, 0);
          redrawMap();
        });
        const up = () => { last = null; };
        cv.addEventListener('mouseup', up);
        cv.addEventListener('mouseleave', up);
      }
      paint();
    };
  }

  if (Elona.Panels) install(Elona.Panels);
  API.install = install;
})(typeof window !== 'undefined' ? window : globalThis);
