'use strict';
/**
 * 表现层 —— Canvas 2D 渲染
 *
 * 图块渲染规则【已确认】来自 cell_draw (start.hsp 行 33082)：
 *   gcopy <图块表>, tile%33*48, tile/33*48   → 每行 33 个图块，图块边长 48px
 *   图块表文件 = graphic/map{var_126(2)}.bmp
 * 视野内以玩家为中心绘制，超出边界的格子用 var_812（默认图块）填充。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const TILE = 48, COLS = 33;

  // ---- 界面布局常量（*label_2099，202948-202998，var_1257=1 的常规布局）----
  const UI_W = 800, UI_H = 600;
  const UI_LEFT = 136;              // var_204 / var_1256
  const UI_TOP = UI_H - 88;         // var_996 = 512（地图视口底边）
  const UI_BOTTOM = UI_H - 16;      // var_1258 = 584
  const MSG_TOP = UI_TOP;           // var_208 = 512
  const MSG_LINE_H = 15;            // var_207
  const MSG_LINES = 4;              // var_206 默认 4：消息区显示 4 行，新消息在底部
  const FONT_UI = (px) => px + 'px "Courier New", "MS Gothic", "ＭＳ ゴシック", "Microsoft YaHei", monospace';
  const FONT_HP = FONT_UI(10);      // 12 - var_205*2（英文）
  const FONT_STAT = FONT_UI(11);    // 13 - var_205*2
  const FONT_MAP = FONT_UI(10);     // 12 + var_892 - var_205*2
  const FONT_MSG = FONT_UI(12);     // var_203(14) - var_205*2

  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  // ---- 物品选择窗口（display_window (800-640)/2, winposy(432), 640, 432）----
  const INV_X = 80, INV_Y = 84, INV_W = 640, INV_H = 432;
  const INV_ROWS = 16, INV_ROW_H = 19;
  // 隔行底纹（原版 cs_listbk 的 gfini/gfdec2 12,14,16 更暗，网页版羊皮纸底需要更浅）
  const ROW_ALT = 'rgba(120,100,64,0.18)';
  // 道具的知识窗（300266：600×408）
  const INFO_X = 100, INFO_Y = 96, INFO_W = 600, INFO_H = 408, INFO_ROWS = 15, INFO_ROW_H = 18; 
  // 情報切替（var_2251）时耐性栏的表头（var_257 同级的元素名，50..60）
  const RESIST_HEAD = ['火', '冷', '雷', '暗', '幻', '毒', '狱', '音', '神', '沌', '魔'];
  // 列位置：原版是 x+320 + (元素-50)*20，但网页版的窗口右上角有 deco_inv 装饰（474..728），
  // 按原样画会被盖住最后几列，所以起点左移、步长收紧到 16px（300..460）。
  const RESIST_X = 300, RESIST_STEP = 15;
  // 页签文字（原版 var_365(var_486) + "アイテムの選択" / "装備品"）
  const INV_TITLE = {
    bag: '调查道具', book: '阅读', identify: '鉴定', throw: '投掷',
    offer: '供奉', equip: '装备品', 'equip-pick': '装备', use: '使用', spell: '咏唱',
  };

  // var_289 / var_290（202948 附近 lang 文本表）
  const FOOD_TEXT = ['Starving!', 'Starving', 'Hungry!', 'Hungry', 'Hungry', '', '', '', '', '', 'Satisfied', 'Satisfied!', 'Bloated'];
  const WATER_TEXT = ['Drying!', 'Drying', 'Thirsty!', 'Thirsty', 'Thirsty', '', '', '', '', '', 'Wetting', 'Wetting!', 'Distended'];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
      this.sheets = {};   // tileset -> Image
      this.ui = null;     // interface.bmp（1440×800）
      this.uik = null;    // 0-DG：黑底透明版（图标切片用）
      this.itemSheet = null;   // item.bmp（33×46 个 48px 图标）
      this.decoInv = null;     // deco_inv.bmp（240×264）
      // 原版地图视口：var_537=17 列、var_538=11 行（800×512），玩家固定在 (8,5) 图块
      this.viewW = Math.ceil(canvas.width / TILE);
      this.viewH = Math.ceil((canvas.height - 88) / TILE);
      this.loadInterfaceSheet().catch(() => { });
      this.loadItemSheet().catch(() => { });
      this.loadDecoInv().catch(() => { });
    }

    loadItemSheet() {
      if (this.itemSheet) return Promise.resolve(this.itemSheet);
      if (!this._itemPromise) {
        this._itemPromise = new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            // 0-EU：优先用构建期生成的 item.png（纯黑已转透明，1584×2208 → 757KB）。
            //   原 item.bmp 有 10.5MB，且必须逐像素抠黑；这里仍保留抠黑循环做兜底
            //   （若 item.png 缺失，下面的 onerror 会退回 bmp）。
            try {
              const cv = document.createElement('canvas');
              cv.width = img.width; cv.height = img.height;
              const g = cv.getContext('2d');
              g.drawImage(img, 0, 0);
              const data = g.getImageData(0, 0, cv.width, cv.height);
              const px = data.data;
              for (let i = 0; i < px.length; i += 4) {
                if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) px[i + 3] = 0;
              }
              g.putImageData(data, 0, 0);
              this.itemSheet = cv;
            } catch (e) {
              this.itemSheet = img;
            }
            resolve(this.itemSheet);
          };
          img.onerror = () => {
            // item.png 不存在 → 退回原始 bmp
            const alt = new Image();
            alt.onload = () => {
              try {
                const cv = document.createElement('canvas');
                cv.width = alt.width; cv.height = alt.height;
                const g = cv.getContext('2d');
                g.drawImage(alt, 0, 0);
                const data = g.getImageData(0, 0, cv.width, cv.height);
                const px = data.data;
                for (let i = 0; i < px.length; i += 4) {
                  if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) px[i + 3] = 0;
                }
                g.putImageData(data, 0, 0);
                this.itemSheet = cv;
              } catch (e) { this.itemSheet = alt; }
              resolve(this.itemSheet);
            };
            alt.onerror = () => resolve(null);
            alt.src = 'assets/graphic/item.bmp';
          };
          img.src = 'assets/graphic/item.png';
        });
      }
      return this._itemPromise;
    }

    loadDecoInv() {
      if (this.decoInv) return Promise.resolve(this.decoInv);
      if (!this._decoPromise) {
        this._decoPromise = new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { this.decoInv = img; resolve(img); };
          img.onerror = () => resolve(null);
          img.src = 'assets/graphic/deco_inv.bmp';
        });
      }
      return this._decoPromise;
    }

    /** interface.bmp —— 原版所有 HUD / 窗口切片都取自这张 1440×800 的图 */
    loadInterfaceSheet() {
      if (this.ui) return Promise.resolve(this.ui);
      if (this._uiPromise) return this._uiPromise;
      this._uiPromise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.ui = img;
          // 0-DG：interface.bmp 上的小图标（模式图标 / 状态图标 / 分类图标 / 列表箭头）
          //   在原版里都以 gmode 2（加算）绘制，黑色即透明。网页版直接 drawImage 会带上黑底，
          //   因此另做一份「纯黑→透明」的副本专供图标切片使用（窗口边框仍用原图）。
          try {
            const cv = document.createElement('canvas');
            cv.width = img.width; cv.height = img.height;
            const g = cv.getContext('2d');
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, cv.width, cv.height);
            const px = d.data;
            for (let i = 0; i < px.length; i += 4) {
              if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) px[i + 3] = 0;
            }
            g.putImageData(d, 0, 0);
            this.uik = cv;
          } catch (e) { this.uik = img; }
          resolve(img);
        };
        img.onerror = () => resolve(null);
        img.src = 'assets/graphic/interface.bmp';
      });
      return this._uiPromise;
    }

    /** gcopy 3, sx, sy, w, h → 画到 (dx, dy) */
    gcopy(sx, sy, w, h, dx, dy) {
      if (!this.ui || w <= 0 || h <= 0) return;
      this.ctx.drawImage(this.ui, sx, sy, w, h, dx, dy, w, h);
    }

    /**
     * 0-DG：图标切片（黑底透明版 interface.bmp）。
     * 原版这些 16×16 / 24×24 / 48×48 的小图都用 gmode 2 画，黑色即透明。
     */
    gspr(sx, sy, w, h, dx, dy, dw, dh) {
      const img = this.uik || this.ui;
      if (!img || w <= 0 || h <= 0) return;
      const tw = dw === undefined ? w : dw, th = dh === undefined ? h : dh;
      this.ctx.drawImage(img, sx, sy, w, h, dx, dy, tw, th);
    }

    /** 预加载图块表 */
    loadSheet(tileset) {
      if (this.sheets[tileset]) return Promise.resolve(this.sheets[tileset]);
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { this.sheets[tileset] = img; resolve(img); };
        img.onerror = () => reject(new Error('图块表加载失败: map' + tileset + '.bmp'));
        img.src = 'assets/graphic/map' + tileset + '.bmp';
      });
    }

    clear() {
      const c = this.ctx;
      c.fillStyle = '#000';
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * 0-FT：当前视野左上角的世界格坐标。
     *   平时 = 玩家 − (8,5)（原版 `var_537/538` 的固定半屏偏移）；
     *   装修模式下改为光标 − (8,5)，于是光标恒在视口正中、移动光标即可看视野外。
     */
    camOrigin(game) {
      const OX = 8, OY = 5;
      const D = Elona.Home && Elona.Home.design;
      const cx = (D && D.active) ? (D.x | 0) : (game.player.x | 0);
      const cy = (D && D.active) ? (D.y | 0) : (game.player.y | 0);
      return { x: cx - OX, y: cy - OY, ox: OX, oy: OY };
    }

    /** 0-FT：画布像素 → 地图格（鼠标点击统一走这里，避免各处各写一份偏移） */
    screenToCell(game, sx, sy) {
      const c = this.camOrigin(game);
      return { x: c.x + Math.floor(sx / TILE), y: c.y + Math.floor(sy / TILE) };
    }

    /** 绘制地图（玩家固定在视口第 8 列 / 第 5 行，视口 800×512） */
    drawMap(game) {
      const map = game.map, ctx = this.ctx;
      const sheet = this.sheets[map.tileset];
      if (!sheet) { this.drawHud(game); return; }
      const ox = 8, oy = 5;                 // var_537/2, var_538/2
      // 0-FT：装修模式（`*label_2444`）时镜头改为跟随**光标**，
      //   原版 `var_1311/1312` 就是屏幕坐标，光标移出窗口时 `var_537/538`
      //   会整屏滚动（234300 一段在光标贴边时 `var_537 += 方向`）。
      //   这里等价实现：把光标固定在视口正中，其余按 startX/startY 平移。
      const cam = this.camOrigin(game);
      const startX = cam.x, startY = cam.y;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, UI_W, UI_TOP);          // 地图只占 0..511，下方是消息窗
      ctx.clip();
      for (let vy = 0; vy < this.viewH; vy++) {
        for (let vx = 0; vx < this.viewW; vx++) {
          const mx = startX + vx, my = startY + vy;
          const dx = vx * TILE, dy = vy * TILE;
          if (mx < 0 || my < 0 || mx >= map.width || my >= map.height) {
            // 越界：原版用默认图块 var_812 (=531) 填充
            this.drawTile(sheet, 531, dx, dy);
            continue;
          }
          const cell = map.cells[my][mx];
          this.drawTile(sheet, cell[0], dx, dy);
          // 地形特性图块（cell_featread 的 id = field6 \ 1000）：门/楼梯/告示板等
          // 原版在地图对象绘制段 229643 另绘 kind==2 的图块，这里用 feat id 直接绘制。
          // 陷阱(type 14)不绘制，避免暴露未发现的陷阱。
          // 0-EU：feat / deco 是叠在地面上的「贴图」，原图里它们周围是纯黑背景
          //   （打开的门 236、告示板 727、街告示板 732 的黑底占 6 成以上）。
          //   直接 drawImage 会盖出黑方块，所以改走「边缘连通的纯黑→透明」的副本；
          //   门板内部的黑色纹路不连边，仍保留。
          const featTile = cell[6] % 1000;
          const featType = Math.floor(cell[6] / 1000) % 100;
          if (featTile && featType !== 14) {
            this.drawTileKeyed(sheet, map.tileset, featTile, dx, dy);
          }
          // 装饰图层 field[7]: 高 16 位为图块ID、低 16 位为参数（33677: f7\10, f7/10）
          const deco = cell[7];
          if (deco) {
            const decoTile = Math.floor(deco / 10);
            if (decoTile) {
              ctx.globalAlpha = 0.55;   // 装饰半透明，避免完全遮住底层
              this.drawTileKeyed(sheet, map.tileset, decoTile, dx, dy);
              ctx.globalAlpha = 1;
            }
          }
        }
      }
      this.drawGroundItems(game, startX, startY);
      this.drawMefs(game, startX, startY);
      this.drawCharas(game, startX, startY);
      // 玩家不一定在正中（装修时光标居中），按实际相对位置画
      this.drawPlayer(game, game.player.x - startX, game.player.y - startY);
      if (Elona.Hud && Elona.Hud.drawCharaBars) {
        Elona.Hud.drawCharaBars(this, game, startX, startY);
      }
      this.drawEffects(game, startX, startY);
      this.drawWeatherOverlay(game);      // 天气滤镜（雨/雪/以太风）
      this.drawTorchLight(game, startX, startY);   // 0-FY：火把光照遮罩
      this.drawTargetOverlay(game, startX, startY);
      this.drawDesignCursor(game, startX, startY);
      this.drawDirArrows(game, startX, startY);
      ctx.restore();
      this.drawHud(game);
      if (Elona.UI && Elona.UI.invOpen) this.drawInventory(game);
    }

    /**
     * 0-CE：绘制地面物品（此前完全没画，导致城镇家具/掉落物都看不到）。
     * 图形来自 item.bmp（Elona.ItemDB.graphic），缩小到 30px 叠在地块上；
     * 同格有角色时不画（角色优先），物品数量 > 1 时右下角标数量。
     * 原版绘制段：map 对象 kind==0 的物品在 *label_2873 绘制（229618-229660 附近）。
     */
    drawGroundItems(game, startX, startY) {
      const items = game.groundItems;
      if (!items || !items.length || !this.itemSheet) return;
      if (!Elona.ItemDB || !Elona.ItemDB.graphic) return;
      const ctx = this.ctx;
      // 原版按整格绘制（36234：gcopy 3, 144 + idx*48, 752, 48, 48）
      // 0-DF：大件图标是 48×96（data/tables/item_icons.json），底对齐格子底部向上延伸，
      //   因此必须按 y 从小到大绘制（远处的先画，近处的高家具才能正确遮挡）。
      const list = items.slice().sort((a, b) =>
        ((a.f[6] | 0) - (b.f[6] | 0)) || ((a.f[5] | 0) - (b.f[5] | 0)));
      for (const it of list) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        const x = it.f[5] | 0, y = it.f[6] | 0;
        const vx = x - startX, vy = y - startY;
        if (vx < 0 || vy < -1 || vx >= this.viewW || vy >= this.viewH + 1) continue;
        // 同格有角色 → 不画（角色图层优先）
        if (game.map && game.map.cell) {
          const c = game.map.cell(x, y);
          if (c && c[1] !== 0) continue;
        }
        const gid = Elona.ItemDB.graphic(it.id);
        if (!Number.isFinite(gid) || gid < 0) continue;
        const ih = (Elona.ItemDB.iconHeight ? Elona.ItemDB.iconHeight(gid) : TILE) | 0;
        const sx = (gid % COLS) * TILE, sy = Math.floor(gid / COLS) * TILE;
        if (sx + TILE > this.itemSheet.width || sy + ih > this.itemSheet.height) continue;
        const dx = vx * TILE;
        const dy = vy * TILE + TILE - ih;      // 底对齐格底
        ctx.drawImage(this.itemSheet, sx, sy, TILE, ih, dx, dy, TILE, ih);
        const n = it.f[0] | 0;
        if (n > 1) {
          ctx.save();
          ctx.font = 'bold 13px "Courier New", monospace';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(0,0,0,0.9)';
          ctx.fillText(String(n), dx + TILE + 1, dy + ih + 1);
          ctx.fillStyle = '#fff';
          ctx.fillText(String(n), dx + TILE, dy + ih);
          ctx.restore();
        }
      }
    }

    /**
     * 绘制地面魔法效果（mef）。
     * 原版使用独立特效图；这里用半透明色块表示类型，避免依赖未提取的素材。
     */
    drawMefs(game, startX, startY) {
      if (!game.mef || !game.mef.s) return;
      const ctx = this.ctx;
      const colors = {
        1: 'rgba(120,200,60,.35)', 2: 'rgba(180,180,180,.45)',
        3: 'rgba(80,200,80,.35)', 5: 'rgba(255,120,40,.45)',
        6: 'rgba(60,120,255,.35)', 9: 'rgba(30,30,60,.5)',
      };
      for (let vy = 0; vy < this.viewH; vy++) {
        for (let vx = 0; vx < this.viewW; vx++) {
          const mx = startX + vx, my = startY + vy;
          const cell = game.map.cell(mx, my);
          if (!cell || !cell[8]) continue;
          const m = game.mef.s[cell[8] - 1];
          if (!m || !m[0]) continue;
          let col = colors[m[0]];
          if (!col) col = (m[0] >= 13 && m[0] <= 22)
            ? 'rgba(80,120,220,.35)' : 'rgba(255,255,255,.2)';
          ctx.fillStyle = col;
          ctx.fillRect(vx * TILE, vy * TILE, TILE, TILE);
          // mef type 7：原版 603024-603030 以 `*var_490(4)*` 的文本形式显示
          if (m[0] === 7) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px "Courier New", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('*' + (m[4] | 0) + '*', vx * TILE + TILE / 2, vy * TILE + TILE / 2);
          }
        }
      }
    }

    /**
     * 近距离能力的方向箭头 —— 315670「どの方向？」的选择界面。
     * 原版借 `*label_2104` / `*label_2893` 在玩家周围画方向提示；这里用
     * 八个半透明箭头画在邻接格上，按键即发动（见 core/dirsel.js）。
     */
    drawDirArrows(game, startX, startY) {
      // 两处共用同一套箭头：能力的「どの方向？」（DirSel）与对目标方向的操作（Interact）
      const D = (Elona.DirSel && Elona.DirSel.active) ? Elona.DirSel
        : ((Elona.Interact && Elona.Interact.active) ? Elona.Interact : null);
      if (!D) return;
      const ctx = this.ctx;
      const cells = D.arrowCells(game);
      for (const c of cells) {
        const vx = c.x - startX, vy = c.y - startY;
        if (vx < 0 || vy < 0 || vx >= this.viewW || vy >= this.viewH) continue;
        const px = vx * TILE, py = vy * TILE;
        const pulse = 0.28 + 0.18 * Math.sin((performance.now() % 900) / 900 * Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,180,${pulse.toFixed(3)})`;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = 'rgba(255,255,220,.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        ctx.fillStyle = '#fff8c0';
        ctx.font = `${Math.floor(TILE * 0.62)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.label, px + TILE / 2, py + TILE / 2 + 1);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    /**
     * 0-FS：装修模式的光标 —— `*label_2444`（234300-234340）用 `var_1311/1312`
     * 画一个方框，并把要铺的图块以半透明叠在上面（原版 `gmode 4` 的预览）。
     * 光标移到哪一格，就把当前选中的地砖 `var_1663` 预览在那里。
     */
    drawDesignCursor(game, startX, startY) {
      const H = Elona.Home;
      if (!H || !H.design || !H.design.active) return;
      const D = H.design;
      const ctx = this.ctx;
      const vx = (D.x | 0) - startX, vy = (D.y | 0) - startY;
      if (vx < 0 || vy < 0 || vx >= this.viewW || vy >= this.viewH) return;
      const px = vx * TILE, py = vy * TILE;
      const sheet = this.sheets[game.map.tileset];
      ctx.save();
      if (sheet) {
        ctx.globalAlpha = 0.45;
        this.drawTile(sheet, D.tile | 0, px, py);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
      ctx.restore();
    }

    /**
     * 瞄准 / 锁定覆盖层 —— `*label_2672`（283536-283808）。
     *
     * 原版这一段做三件事：
     *   ① `get_route` + `route_info` 把「玩家 → 光标」的每一格 `gfini 50,50,100`
     *      （50% 白色）+ `gfinc 25,25,25` 铺成半透明路径；
     *   ② 光标格 `gfini` 后描白框（283552 / 283605）；
     *   ③ `txttargetnpc`（283056）在左下角 `x=100, y=var_217-45-行号*20` 打 3 行信息。
     * 本项目 0-GW 之前只画了光标、信息走 HTML 弹窗；现在按原版全部画到画布上：
     *   · 路径：只要有「光标」或「已锁定目标」就画（射线/直线魔法的命中走向）；
     *   · 信息：瞄准会话进行中显示（锁定后由消息窗播报一次）。
     */
    drawTargetOverlay(game, startX, startY) {
      const ctx = this.ctx;
      const Aim = Elona.Aim;
      if (!Aim || !game || !game.player) return;
      const cur = Aim.cursor || null;
      const tgt = Aim.target ? Aim.target(game) : null;
      const me = game.player;
      const dest = cur ? { x: cur.x | 0, y: cur.y | 0 }
        : (tgt && tgt.tile ? { x: tgt.tile.x | 0, y: tgt.tile.y | 0 } : null);

      // ① 半透明路径
      if (dest && Aim.pathCells) {
        const cells = Aim.pathCells(game, me.x | 0, me.y | 0, dest.x, dest.y, 40);
        for (const c of cells) {
          const vx = c.x - startX, vy = c.y - startY;
          if (vx < 0 || vy < 0 || vx >= this.viewW || vy >= this.viewH) continue;
          const px = vx * TILE, py = vy * TILE;
          ctx.fillStyle = 'rgba(255,255,255,0.28)';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
        }
      }

      // ② 光标 / 已锁定目标
      const box = (x, y, fill, stroke) => {
        const vx = x - startX, vy = y - startY;
        if (vx < 0 || vy < 0 || vx >= this.viewW || vy >= this.viewH) return;
        const px = vx * TILE, py = vy * TILE;
        ctx.fillStyle = fill;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
      };
      if (cur) {
        const info = Aim.inspect(game);
        // 看不见的格子用红色提示（283740 会拦下锁定）
        box(cur.x, cur.y, info.inSight ? 'rgba(255,255,255,.42)' : 'rgba(255,80,80,.35)',
          info.inSight ? '#ffffff' : '#ff9090');
      } else if (tgt && tgt.tile && !tgt.ground) {
        // 锁定的是角色才画绿框；锁定地面（var_2189）只画路径，免得整局都在闪
        box(tgt.tile.x, tgt.tile.y, 'rgba(120,255,150,.20)', 'rgba(120,255,150,.85)');
      }

      // ③ 左下角的目标信息（只在瞄准中显示）
      if (cur && Aim.describe) {
        const info = Aim.describe(game);
        const lines = (info && info.lines) || [];
        if (lines.length) {
          const baseY = UI_TOP - 52;                 // var_217 - var_810 - 45（留出与消息窗的间距）
          ctx.save();
          ctx.font = FONT_UI(13);                    // 源码 14 - var_205*2
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          for (let i = 0; i < lines.length; i++) {
            // 数组第 0 行是「现在目标是…」，原版画在最高处；最后一行贴着 baseY
            const ty = baseY - (lines.length - 1 - i) * 20;
            if (ty < 0) continue;
            const tx = 100;
            ctx.fillStyle = 'rgba(0,0,0,.9)';
            ctx.fillText(lines[i], tx + 1, ty + 1);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(lines[i], tx, ty);
          }
          ctx.restore();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
        }
      }
    }

    /** 事件 21 的粒子效果（mef type 7 删除时）——近似 *label_4376 209874-209919 */
    drawEffects(game, startX, startY) {
      if (!game.effects || !game.effects.length) return;
      const ctx = this.ctx;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const px = game.player.x, py = game.player.y;
      const ox = 8, oy = 5;
      const sx = (startX === undefined) ? (px - ox) : startX;
      const sy = (startY === undefined) ? (py - oy) : startY;
      for (const e of game.effects) {
        if (e.kind === 'beam') { this.drawBeam(e, now, sx, sy); continue; }
        if (e.kind !== 'particles') continue;
        const age = (now - e.t) / 900;                 // 0 → 1
        if (age < 0 || age > 1) continue;
        const cx = (e.x - px + ox) * TILE + TILE / 2;
        const cy = (e.y - py + oy) * TILE + TILE / 2;
        ctx.fillStyle = `rgba(255,240,180,${(1 - age).toFixed(3)})`;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const r = age * TILE * 1.6;
          const s = 3 * (1 - age) + 1;
          ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r - age * 24, s, s);
        }
      }
    }

    /**
     * 射线动画 —— 沿 `get_route` 的路径逐格飞出（0-GW）。
     * 与伤害结算无关（伤害在 Spell.effectType1 里已经算完），只是把「射线沿着
     * 锁定路径移动」这件事画出来：头部一格最亮，尾部依次变淡，结束时整体消失。
     */
    drawBeam(e, now, startX, startY) {
      const cells = e.cells || [];
      if (!cells.length) return;
      const dur = (e.dur | 0) || 500;
      const t = (now - e.t) / dur;                 // 0 → 1（飞行），>1 淡出
      if (t < 0 || t > 1.8) return;
      const fade = t <= 1 ? 1 : Math.max(0, 1 - (t - 1) / 0.8);
      const n = cells.length;
      const col = e.color || '#dff0ff';
      const ctx = this.ctx;
      // 格中心（世界坐标已换算成屏幕像素）
      const px = (i) => ((cells[Math.max(0, Math.min(n - 1, i))].x - startX) * TILE) + TILE / 2;
      const py = (i) => ((cells[Math.max(0, Math.min(n - 1, i))].y - startY) * TILE) + TILE / 2;
      const pos = Math.min(n, Math.max(0, t * n));     // 头部在「第几格」
      const whole = Math.min(n, Math.floor(pos));
      const pts = [];
      for (let i = 0; i < whole; i++) pts.push([px(i), py(i)]);
      if (whole < n) {
        const f = pos - whole;
        const a = Math.max(0, whole - 1);
        pts.push([px(a) + (px(whole) - px(a)) * f, py(a) + (py(whole) - py(a)) * f]);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 光束主体：外层彩色 + 内层白芯
      if (pts.length >= 2) {
        const stroke = (color, alpha, w) => {
          ctx.strokeStyle = this._rgba(color, alpha);
          ctx.lineWidth = w;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.stroke();
        };
        stroke(col, 0.30 * fade, TILE * 0.52);
        stroke(col, 0.45 * fade, TILE * 0.26);
        stroke('#ffffff', 0.60 * fade, TILE * 0.10);
      }
      // 头部光核
      const hx = pts.length ? pts[pts.length - 1][0] : px(0);
      const hy = pts.length ? pts[pts.length - 1][1] : py(0);
      const hg = ctx.createRadialGradient(hx, hy, 1, hx, hy, TILE * 0.45);
      hg.addColorStop(0, this._rgba('#ffffff', 0.9 * fade));
      hg.addColorStop(0.4, this._rgba(col, 0.6 * fade));
      hg.addColorStop(1, this._rgba(col, 0));
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(hx, hy, TILE * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /** '#rrggbb' + alpha → rgba() 字符串（光束用） */
    _rgba(hex, a) {
      const h = String(hex || '#ffffff').replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
    }

    // =====================================================================
    // HUD / 消息窗 —— 严格按 *label_2102 / *label_2106 / msg_write 的坐标绘制
    // =====================================================================

    /** 无阴影文字（对应 HSP 的 mes） */
    text(s, x, y, color, font) {
      const ctx = this.ctx;
      ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = color; ctx.fillText(s, x, y);
    }

    /** 带黑色描边的白字（对应 HSP 的 bmes） */
    btext(s, x, y, color, font) {
      const ctx = this.ctx;
      ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#000'; ctx.fillText(s, x + 1, y + 1);
      ctx.fillStyle = color; ctx.fillText(s, x, y);
    }

    /**
     * 天气滤镜 —— 原版用独立的雨/雪图层（cell_draw 的天气段），
     * 本项目没有对应素材，改为在整张地图上叠一层半透明色。
     * 以太风用紫色调，与原版 `envEffect` 的氛围一致（属表现层简化，见差异报告）。
     */
    drawWeatherOverlay(game) {
      if (!Elona.Weather || !game) return;
      const w = Elona.Weather.current(game);
      if (!w) return;
      const ctx = this.ctx;
      const tint = {
        1: 'rgba(130,40,160,0.13)',   // 以太风
        2: 'rgba(225,235,255,0.16)',  // 雪
        3: 'rgba(40,70,130,0.12)',    // 雨
        4: 'rgba(20,40,90,0.20)',     // 暴雨
      }[w];
      if (!tint) return;
      ctx.save();
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, UI_W, UI_TOP);
      ctx.restore();
    }

    /**
     * 0-FY：火把光照 —— 353931-353954 的 var_65(37) 与 249360-249375 的画面色调。
     *   原版点火把时把夜间色调改为 (80,65,50) 的暖棕，并把 var_1893 从 15 降到 8；
     *   33041 在野外地图另给亮度 -50。网页版用「以玩家为中心的径向暖光 + 外围压暗」
     *   表达同一效果，且**只在火把点亮时**叠加，避免改变默认的白天画面。
     */
    drawTorchLight(game, startX, startY) {
      if (!game || !game.getV65 || (game.getV65(37) | 0) !== 1) return;
      const ctx = this.ctx;
      const hour = game.getV65(13) | 0;
      const night = hour >= 20 || hour < 6;
      const R = TILE * 8;                       // var_1893 = 8 格
      const px = (game.player.x - startX + 0.5) * TILE;
      const py = (game.player.y - startY + 0.5) * TILE;
      const outer = night ? 'rgba(24,16,8,0.58)' : 'rgba(40,26,8,0.18)';
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, UI_W, UI_TOP);
      ctx.clip();
      const grad = ctx.createRadialGradient(px, py, R * 0.12, px, py, R);
      grad.addColorStop(0, 'rgba(255,196,110,0.02)');
      grad.addColorStop(0.6, night ? 'rgba(120,80,35,0.10)' : 'rgba(255,205,120,0.02)');
      grad.addColorStop(1, outer);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, UI_W, UI_TOP);
      ctx.restore();
    }

    drawHud(game) {
      if (!this.ui) return;
      const p = game.player;
      if (!p || !game.map) return;

      // *label_2102：底部条（0,448,192,16）+ 消息窗底纹（496,528,192,72）
      for (let x = 0; x < UI_W; x += 192) {
        const w = Math.min(192, UI_W - x);
        this.gcopy(0, 448, w, 16, x, UI_BOTTOM);
        this.gcopy(496, 528, w, 72, x, MSG_TOP);
      }
      this.gcopy(120, 504, UI_LEFT, 88, 0, MSG_TOP);          // 左面板
      this.gspr(208, 376, 16, 16, UI_LEFT + 6, UI_BOTTOM);    // 模式图标
      for (let c = 0; c < 10; c++) {                          // 10 个状态图标
        const xoff = c === 8 ? 8 : (c === 9 ? 14 : 0);
        this.gspr(c * 16, 376, 16, 16, UI_LEFT + c * 47 + 148 + xoff, UI_BOTTOM + 1);
      }
      // 地图名（var_494(0)）/ 层数（maplevel）
      this.text(String(game.map.name || '').slice(0, 16), UI_LEFT + 24, UI_BOTTOM + 2, '#000', FONT_MAP);

      // 0-DD：先画消息（消息栏可展开，展开时会被数值条压住，与原版层级一致）
      this.drawMessages();
      this.drawBars(p);
      this.drawStatSlots(p);
      this.drawMoney(p);
      this.drawStatusLines(p, game);
      // 0-DD：界面增强层（时钟 / 技能监视 / 法术状态 / 小地图）
      if (Elona.Hud) {
        Elona.Hud.drawClock(this, game);
        Elona.Hud.drawWatch(this, game);        // 0-DF：只画玩家锁定过的条目（透明）
        Elona.Hud.drawSkillMonitor(this, game); // F2 调试用全表（默认关闭）
        Elona.Hud.drawBuffBox(this, game);
        Elona.Hud.drawMinimap(this, game);
      }
    }

    /** HP/MP 条与睡意/满腹度细条（203124-203226） */
    drawBars(p) {
      const x1 = idiv(UI_W - 84, 2) - 100;   // var_1262 = 258
      const x2 = idiv(UI_W - 84, 2) + 40;    // var_1264 = 398
      const y = UI_TOP - 12;                 // var_1263/1265 = 500

      // 0-DF：去掉 0-DD 加的半透明暗底 —— 原版数值条直接压在地形上
      this.gcopy(312, 504, 104, 15, x1, y);       // HP 框
      this.gcopy(312, 504, 104, 15, x2 - 10, y);  // MP 框

      const hp = p.get(50) | 0, hpMax = p.get(51) | 0;
      if (hp > 0) {
        const w = Math.min(100, idiv(hp * 84, hpMax));
        this.gcopy(412 - w, 520, w, 5, x1 + 16, y + 5);
      }
      // HP 下方细条：var_58(182) = **斗志**（203137-203151）
      //   0..100 用普通条；>100（変身/進化/高品质）用「超级条」并按其超出量绘制
      const sat = p.get(182) | 0;
      if (sat > 0 && sat <= 100) {
        const w = Math.min(100, idiv(sat * 84, 100));
        this.gcopy(412 - w, 525, w, 2, x1 + 16, y + 10);
      } else if (sat > 100) {
        const w = Math.min(100, idiv((sat - 100) * 84, 100));
        this.gcopy(1439 - w, 492, w, 2, x1 + 16, y + 10);
      }
      // MP 下方细条：var_58(60) = **破防計量（ガードブレイク）**（203153-203164）
      //   >= 100 → 120 表示破防；每回合 -1 降到 100 归 0（216287-216305）
      const slp = p.get(60) | 0;
      if (slp > 0 && slp <= 100) {
        const w = Math.min(100, idiv(slp * 84, 100));
        this.gcopy(532 - w, 525, w, 2, x2 + 6, y + 10);
      } else if (slp > 100) {
        this.gcopy(1355, 585, 84, 2, x2 + 6, y + 10);
      }
      const mp = p.get(55) | 0, mpMax = p.get(56) | 0;
      if (mp > 0) {
        const w = Math.min(100, idiv(mp * 84, mpMax));
        this.gcopy(532 - w, 520, w, 5, x2 + 6, y + 5);
      }

      this.btext(hp + '(' + hpMax + ')', x1 + 20, y - 8, '#fff', FONT_HP);
      this.btext(mp + '(' + mpMax + ')', x2 + 10, y - 8, '#fff', FONT_HP);
      this.btext(sat + '%', x1 + 106, y + 1, '#fff', FONT_HP);
      this.btext(slp + '%', x2 + 96, y + 1, '#fff', FONT_HP);
    }

    /** 底部 10 格：8 项属性 + 速度 + DV/PV（203227-203281） */
    drawStatSlots(p) {
      const y = UI_BOTTOM + 2;               // var_1269 = 586
      for (let c = 0; c < 10; c++) {
        const x = UI_LEFT + c * 47 + 168 - 2;   // var_1268 = 302 + 47c
        if (c < 8) {
          this.gcopy(0, 440, 28, 16, x, y);
          const color = (p.get(240 + c) | 0) < 0 ? 'rgb(200,0,0)' : '#000';
          this.text(String(p.skill(10 + c) | 0), x, y, color, FONT_STAT);
        } else if (c === 8) {
          this.gcopy(0, 440, 34, 16, x + 8, y);
          const base = p.skill(18) | 0;
          const spd = Math.max(10, idiv((p.get(11) | 0) * (100 + (p.get(37) | 0)), 100));
          const color = base > spd ? 'rgb(200,0,0)' : (base < spd ? 'rgb(0,120,0)' : '#000');
          this.text(String(spd), x + 8, y, color, FONT_STAT);
        } else {
          this.gcopy(0, 440, 64, 16, x + 14, y);
          let dvMul = p.get(77) | 0, pvMul = p.get(76) | 0;
          if ((p.get(71) | 0) < 0) dvMul = 100;
          if ((p.get(70) | 0) < 0) pvMul = 100;
          let dv = idiv((p.get(71) | 0) * dvMul, 100) + dvMul - 100;   // var_1276
          let pv = idiv(((p.get(70) | 0) + idiv(pvMul, 25)) * pvMul, 100); // var_1277
          if ((p.get(60) | 0) >= 100) { dv = 0; pv = 0; }             // 睡眠中
          this.text(dv + '/' + pv, x + 14, y, '#000', FONT_STAT);
        }
      }
    }

    /** 金钱 / pp / Sp / Lv（203294-203317） */
    drawMoney(p) {
      const yy = UI_TOP - 16;                // var_1269 = 496
      // 0-DF：去掉 0-DD 加的半透明暗底（原版直接压在地形上）

      let xx = UI_W - 220;                   // var_1268 = 580
      this.gspr(0, 392, 24, 24, xx, yy - 4);
      this.btext((p.get(30) | 0) + ' gp', xx + 28, yy + 2, '#fff', FONT_STAT);
      xx = UI_W - 90;                        // 710
      this.gspr(24, 392, 24, 24, xx, yy - 4);
      this.btext((p.get(31) | 0) + ' pp', xx + 28, yy + 2, '#fff', FONT_STAT);
      this.btext('Sp' + (p.get(52) | 0) + '/' + (p.get(53) | 0),
        UI_W - 292, yy + 2, '#fff', FONT_STAT);
      this.gspr(48, 392, 24, 24, 4, yy - 4);
      this.btext('Lv' + (p.get(38) | 0) + '/' + ((p.get(36) | 0) - (p.get(35) | 0)),
        32, UI_TOP - 14, '#fff', FONT_STAT);
    }

    /** 左下方状态文字行（203327-...），先实现饥饿 / 口渴两项 */
    drawStatusLines(p, game) {
      let y = UI_TOP - 50;                   // var_1269 = 462
      const line = (txt, color) => {
        if (!txt) return;
        this.gcopy(84, 416, 95, 15, 8, y);   // var_205=1 的英文底板
        this.text(txt, 14, y + 1, color, FONT_STAT);
        y -= 20;
      };

      // 天气（203971：bmes ... var_272(var_65(17))）—— 只在非晴朗时占一行
      if (game && Elona.Weather) {
        const w = Elona.Weather.current(game);
        if (w !== 0) line(Elona.Weather.name(w), Elona.Weather.color(w));
        // 以太病：原版无数值显示，这里按千分制给出百分比（便于观察累积）
        const eth = game.getV65(Elona.Weather.V_ETHER) | 0;
        if (eth > 0) line(`以太病 ${idiv(eth % 1000, 10)}%`, 'rgb(150,0,150)');
      }

      // 0-DD：饱食 / 口渴 / 各类状态异常统一由 Hud.statusLines 提供
      //   （顺序与源码 203327+ 一致：先饥饿、再口渴，其后是 cbit/状态表条目）
      const rows = (Elona.Hud && Elona.Hud.statusLines) ? Elona.Hud.statusLines(game) : [];
      for (const r of rows) line(r.text, r.color);
    }

    // =====================================================================
    // 物品选择窗口 —— 复刻 *label_2826 / *label_2825（297090-297366）
    // =====================================================================

    /** 物品名颜色（cs_list 的 1 模式） */
    itemColor(it) {
      if (!it || typeof it === 'number') return '#0a0a0a';
      let color = '#0a0a0a';
      if ((it.f[8] | 0) >= 3) {
        const b = it.f[17] | 0;
        if (b === 1) color = 'rgb(10,110,30)';
        else if (b === -1) color = 'rgb(150,10,10)';
        else if (b === -2) color = 'rgb(100,10,100)';
      }
      if (it.eqSlot >= 0) color = 'rgb(120,80,0)';
      return color;
    }

    /**
     * 装备窗（*label_2815 295513-295900）：
     *   行 = 种族肢体（var_121(1) → var_58(100..)），左列部位名、第二列快捷键方块、
     *   第三列装备名（空 = 「-」）、右侧重量；底部「装備重量/命中修正/ダメージ修正/DV/PV」。
     */
    drawEquipWindow(game) {
      const UI = Elona.UI, K = Elona.UiKit, E = Elona.Equipment;
      if (!UI || !K || !this.ui || !E) return;
      const ctx = this.ctx;
      const rows = UI.equipmentRows(game);
      let sel = UI.equipSel | 0;
      if (sel >= rows.length) sel = Math.max(0, rows.length - 1);
      if (sel < 0) sel = 0;
      // var_893 = 14：一页 14 行，超过时用 +/- 翻页（var_894 / var_895）
      const pages = Math.max(1, Math.ceil(rows.length / 14));
      const page = Math.min(pages - 1, Math.floor(sel / 14));
      const start = page * 14;

      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, UI_W, UI_H);
      K.drawWindow(ctx, this.ui, INV_X, INV_Y, INV_W, INV_H);

      // 标题页签「装備品」
      const title = '装备品';
      const tabW = 288 + Math.max(0, Math.min(200, title.length * 16 - 120));
      ctx.fillStyle = '#cfc3b2';
      ctx.fillRect(INV_X + 34, INV_Y - 4, tabW, 32);
      ctx.strokeStyle = '#6b5d49';
      ctx.lineWidth = 1;
      ctx.strokeRect(INV_X + 34.5, INV_Y - 3.5, tabW - 1, 31);
      ctx.font = K.FONT(13);
      K.btext(ctx, title, INV_X + 34 + (tabW - ctx.measureText(title).width) / 2,
        INV_Y + 2, '#fff', K.FONT(13));
      // 分类图标（装备页签位：装甲）
      this.gspr(288 + 48, 48, 48, 48, INV_X + 46, INV_Y - 14, 48, 48);
      if (this.decoInv) {
        const d = this.decoInv;
        ctx.drawImage(d, 0, 0, 144, 48, INV_X + INV_W - 136, INV_Y - 6, 144, 48);
        ctx.drawImage(d, 0, 48, 48, 72, INV_X + INV_W - 186, INV_Y - 6, 48, 72);
        // 情報切替 时这块装饰会盖住右侧的耐性栏，先让位
        if (!UI.invInfoCols) {
          ctx.drawImage(d, 0, 48, 48, 72, INV_X + INV_W - 246, INV_Y - 6, 48, 72);
        }
        ctx.drawImage(d, 0, 120, 48, 72, INV_X - 6, INV_Y - 6, 48, 72);
      }

      // 表头（display_topic 295618 / 295621）
      const topic = (x, label) => {
        this.gspr(120, 360, 24, 16, x, INV_Y + 37, 24, 16);
        ctx.font = K.FONT(12);
        const tw = ctx.measureText(label).width;
        K.text(ctx, label, x + 26, INV_Y + 38, '#000', K.FONT(12));
        ctx.fillStyle = '#000';
        ctx.fillRect(x + 22, INV_Y + 51, tw + 14, 1);
      };
      topic(INV_X + 28, '部位/装备品名称');
      // 295619：情報切替 时隐藏「重さ」表头，改为显示耐性栏
      const infoCols = !!UI.invInfoCols;
      if (!infoCols) topic(INV_X + 486, '重量');
      else this.drawResistHead(ctx, K, INV_X + RESIST_X, INV_Y + 40);

      // 行（var_893 = 14）
      const rowH = 19;
      ctx.save();
      ctx.beginPath();
      ctx.rect(INV_X + 26, INV_Y + 56, 588, 14 * rowH + 2);
      ctx.clip();
      for (let i = 0; i < 14; i++) {
        const idx = start + i;
        if (idx >= rows.length) break;
        const r = rows[idx];
        const rowY = INV_Y + 60 + i * rowH;
        const isSel = idx === sel;
        if (i % 2 === 0) {
          ctx.fillStyle = ROW_ALT;
          ctx.fillRect(INV_X + 70, rowY, 540, 18);
        }
        if (isSel) {
          ctx.fillStyle = 'rgba(40,18,4,0.9)';
          ctx.fillRect(INV_X + 26, rowY - 1, 592, 19);
          ctx.strokeStyle = '#4a3a2a';
          ctx.strokeRect(INV_X + 26.5, rowY - 0.5, 591, 18);
        }
        // 部位图标（295655：gcopy 3, 600 + (type-1)*24, 336, 24, 24）
        if (r.type >= 1 && r.type <= 11) {
          this.gspr(600 + (r.type - 1) * 24, 336, 24, 24, INV_X + 20, rowY - 3, 20, 20);
        }
        // 部位名（295666：利手槽显示「利手」而不是「手」）
        const part = r.dominant ? '利手' : E.typeName(r.type);
        ctx.font = K.FONT(12);
        K.text(ctx, part, INV_X + 44, rowY + 2, isSel ? '#fdf6e3' : '#241a0c', K.FONT(12));
        // 快捷键方块（display_key 295663）
        const lx = INV_X + 92, ly = rowY - 1;
        ctx.fillStyle = isSel ? 'rgba(253,246,227,0.9)' : 'rgba(215,205,180,0.95)';
        ctx.fillRect(lx, ly, 22, 17);
        ctx.strokeStyle = '#5a4a30';
        ctx.strokeRect(lx + 0.5, ly + 0.5, 21, 16);
        K.text(ctx, 'abcdefghijklmn'.charAt(i), lx + 7, ly + 2,
          '#241a0c', K.FONT(11));
        // 装备名 / 「-」
        const it = r.item;
        let name = '-';
        let color = isSel ? '#fdf6e3' : '#5a5040';
        if (it) {
          name = Elona.ItemDB.name(it);
          const n = it.f[0] | 0;
          if (n > 1) name = `${n} ${name}`;
          color = isSel ? '#fdf6e3' : this.itemColor(it);
        }
        ctx.font = K.FONT(12);
        let nm = name;
        // 295...：情報切替 时名称截到 22 字符，给耐性栏让位
        if (infoCols) {
          while (nm.length > 1 && ctx.measureText(nm).width > 165) nm = nm.slice(0, -1);
        } else {
          while (nm.length > 1 && ctx.measureText(nm).width > 400) nm = nm.slice(0, -1);
        }
        K.text(ctx, nm, INV_X + 124, rowY + 2, color, K.FONT(12));
        // 耐性栏（equipinfo 31474：只画 type 2 的附魔）
        if (infoCols && it) this.drawResistRow(ctx, K, it, INV_X + RESIST_X, rowY + 2);
        // 重量（右列；空部位同样画「-」，与原版 cs_list 一致）
        ctx.font = K.FONT(12);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillStyle = color;
        if (!infoCols) {
          ctx.fillText(it ? K.cnvweight((it.f[7] | 0) * Math.max(1, it.f[0] | 0)) : '-',
            INV_X + 600, rowY + 2);
        }
        ctx.textAlign = 'left';
      }
      ctx.restore();

      // 底部：装備重量 / 命中修正 / ダメージ修正 / DV/PV（295645-295652）
      const p = game.player;
      const w = E.totalWeight(p);
      const wc = E.weightClass(game, w);
      const dvpv = E.dvPv(p);
      const note = `装备重量: ${K.cnvweight(w)}(${E.WEIGHT_TEXT[wc]})`
        + ` 命中修正:${p.get(72) | 0} 伤害修正:${p.get(73) | 0}`
        + ` DV/PV:${dvpv.dv}/${dvpv.pv}`;
      ctx.font = K.FONT(11);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#000';
      ctx.fillText(note, INV_X + 30, INV_Y + 367);
      // 295616：var_346 + var_347 + var_343（既知の情報 / 情報切替 / 閉じる）
      ctx.fillText('↑↓[选择]  x[知识]  z[切换]  Enter[穿脱]  a~n[部位]  Esc[关闭]',
        INV_X + 30, INV_Y + 386);
      ctx.textAlign = 'right';
      ctx.fillText(`Page.${page + 1}/${pages}`, INV_X + INV_W - 40, INV_Y + 367);
      ctx.textAlign = 'left';
      if (UI.invInfo) this.drawItemKnowledge(game);
    }

    /**
     * 0-GU / 297059-297084：物品窗顶部的命令条。
     *   原版每个命令 = 48×48 的分类图标 + 名称 + `var_559(id)` 的按键副标签，
     *   当前命令再加一层 `gmode 5,,,70` 的高亮；右下角提示 `Tab [メニュー切替]`。
     *   本项目没有那张 icon 表贴图，用色块 + 名称 + 按键文本代替（见 A509）。
     */
    drawItemCmdBar(game, ctx, K) {
      const IC = Elona.ItemCmd;
      if (!IC) return;
      const cmds = IC.list(game);
      if (!cmds.length) return;
      const cur = IC.current(game);
      const w = 58, h = 22, y = INV_Y - 30;
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < cmds.length; i++) {
        const id = cmds[i];
        const x = INV_X + 34 + i * w;
        const on = id === cur;
        ctx.fillStyle = on ? 'rgba(240,225,180,0.92)' : 'rgba(40,36,30,0.55)';
        ctx.fillRect(x, y, w - 4, h);
        ctx.strokeStyle = on ? '#fff3cf' : '#6b5d49';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 5, h - 1);
        const nm = IC.name(id, 'ch') || IC.name(id, 'jp');
        const key = IC.keyHint(id);
        ctx.font = K.FONT(11);
        K.btext(ctx, nm.slice(0, 3), x + (w - 4) / 2, y + h / 2 - 1,
          on ? '#2a2010' : '#d9d2c4', K.FONT(11));
        if (key) {
          ctx.font = K.FONT(9);
          K.btext(ctx, key, x + (w - 4) / 2, y + h - 4,
            on ? '#6a5a30' : '#8d8474', K.FONT(9));
        }
      }
      ctx.font = K.FONT(10);
      ctx.fillStyle = '#cfc3b2';
      ctx.fillText('Tab[切换命令]', INV_X + 34 + cmds.length * w + 8, y + h / 2);
      ctx.restore();
    }

    drawInventory(game) {
      const UI = Elona.UI, K = Elona.UiKit;
      if (!UI || !K || !this.ui) return;
      // w 键的装备窗是「部位表」，与物品列表共用窗口但布局不同（*label_2815）
      if (UI.invMode === 'equip') { this.drawEquipWindow(game); return; }
      const ctx = this.ctx;
      const rows = UI.inventoryRows ? UI.inventoryRows(game) : [];
      // 0-GU / 296794：使用模式的标题取 var_365(var_486) + 「アイテムの選択」
      const IC = Elona.ItemCmd;
      const useCmd = (IC && UI.invMode === 'use') ? IC.current(game) : 0;
      const title = (IC && UI.invMode === 'use')
        ? IC.pickTitle(useCmd || 14)
        : (INV_TITLE[UI.invMode] || 'Items');
      const pages = Math.max(1, Math.ceil(rows.length / INV_ROWS));
      let sel = UI.invSel | 0;
      if (sel >= rows.length) sel = Math.max(0, rows.length - 1);
      const page = Math.min(pages - 1, Math.floor(sel / INV_ROWS));
      const start = page * INV_ROWS;

      // label_2132：整屏淡出
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, UI_W, UI_H);

      K.drawWindow(ctx, this.ui, INV_X, INV_Y, INV_W, INV_H);

      // 标题页签
      const tabW = 288 + Math.max(0, Math.min(200, title.length * 8 - 120));
      ctx.fillStyle = '#cfc3b2';
      ctx.fillRect(INV_X + 34, INV_Y - 4, tabW, 32);
      ctx.strokeStyle = '#6b5d49';
      ctx.lineWidth = 1;
      ctx.strokeRect(INV_X + 34.5, INV_Y - 3.5, tabW - 1, 31);
      ctx.font = K.FONT(13);
      K.btext(ctx, title, INV_X + 34 + (tabW - ctx.measureText(title).width) / 2,
        INV_Y + 2, '#fff', K.FONT(13));

      // 分类图标（gcopy 3, 288 + var_558(var_486)*48, 48, 48,48）
      {
        const ic = (IC && UI.invMode === 'use') ? IC.icon(useCmd || 14) : -1;
        this.gspr(288 + (ic >= 0 ? ic : 1) * 48, 48, 48, 48, INV_X + 46, INV_Y - 14, 48, 48);
      }
      // 0-GU / 297059-297084：命令条（当前组 + 高亮当前命令）
      if (IC && UI.invMode === 'use') this.drawItemCmdBar(game, ctx, K);

      // deco_inv.bmp：窗口四角的皮革装饰
      if (this.decoInv) {
        const d = this.decoInv;
        ctx.drawImage(d, 0, 0, 144, 48, INV_X + INV_W - 136, INV_Y - 6, 144, 48);
        ctx.drawImage(d, 0, 48, 48, 72, INV_X + INV_W - 186, INV_Y - 6, 48, 72);
        if (!UI.invInfoCols) {
          ctx.drawImage(d, 48, 48, 48, 72, INV_X + INV_W - 246, INV_Y - 6, 48, 72);
        }
        ctx.drawImage(d, 0, 120, 48, 72, INV_X - 6, INV_Y - 6, 48, 72);
      }

      // 表头（display_topic）
      const topic = (x, label) => {
        this.gspr(120, 360, 24, 16, x, INV_Y + 37, 24, 16);
        ctx.font = K.FONT(12);
        const tw = ctx.measureText(label).width;
        K.text(ctx, label, x + 26, INV_Y + 38, '#000', K.FONT(12));
        ctx.fillStyle = '#000';
        ctx.fillRect(x + 22, INV_Y + 51, tw + 14, 1);
      };
      topic(INV_X + 28, '道具名称');
      const isBook = UI.invMode === 'book';
      const infoCols = !!UI.invInfoCols;
      if (infoCols) this.drawResistHead(ctx, K, INV_X + RESIST_X, INV_Y + 40);
      else topic(INV_X + 526, isBook ? '价格' : '重量');

      // 列表
      ctx.save();
      ctx.beginPath();
      ctx.rect(INV_X + 30, INV_Y + 56, 580, INV_ROWS * INV_ROW_H + 2);
      ctx.clip();
      for (let i = 0; i < INV_ROWS; i++) {
        const idx = start + i;
        if (idx >= rows.length) break;
        const row = rows[idx];
        const rowY = INV_Y + 60 + i * INV_ROW_H;
        if (i % 2 === 0) {
          ctx.fillStyle = ROW_ALT;
          ctx.fillRect(INV_X + 70, rowY, 540, 18);
        }

        let name = '', right = '', id = -1, count = 0, weight = 0;
        if (UI.invMode === 'spell') {
          const nameObj = Elona.Spell ? Elona.Spell.actionName(row) : null;
          name = nameObj ? (nameObj.en || nameObj.jp || `#${row}`) : `#${row}`;
          const mp = Elona.Spell ? Elona.Spell.calcSpellCostMp(row, game.player, game) : 0;
          const st = game.player.spellStock[row - 400] | 0;
          right = `MP ${mp} x${st}`;
        } else if (typeof row === 'number') {
          id = row;
          name = Elona.ItemDB.name(id, 'en');
          count = (Elona.ItemDB.eq(id) || {}).value || 0;
          right = isBook ? `${Elona.ItemDB.value(id)} gp` : K.cnvweight(0);
        } else {
          id = row.id;
          count = row.f[0] | 0;
          name = Elona.ItemDB.name(id, 'en');
          // 0-DF：使用列表里脚下物品加标记（源码中它们来自 header -1）
          if (row._onGround && UI.invMode === 'use') name = '〔地面〕' + name;
          weight = (row.f[7] | 0) * count;
          right = K.cnvweight(weight);
        }
        if (count > 1) name = count + ' ' + name;

        // 选中行（cs_list：深色底 + 内框 + 右侧箭头）
        if (idx === sel) {
          ctx.font = K.FONT(12);
          const tw = Math.min(ctx.measureText(name).width + 34, 480);
          ctx.fillStyle = 'rgba(40,18,4,0.9)';
          ctx.fillRect(INV_X + 84, rowY - 1, tw, 19);
          ctx.strokeStyle = '#4a3a2a';
          ctx.strokeRect(INV_X + 84.5, rowY - 0.5, tw - 1, 18);
          this.gspr(48, 360, 16, 16, INV_X + 84 + tw - 20, rowY + 1, 16, 16);
        }

        // 物品图标（item.bmp 的 48px 切片缩到行高附近）
        if (id >= 0 && this.itemSheet) {
          const g = Elona.ItemDB.graphic(id);
          if (Number.isFinite(g) && g >= 0) {
            const sx = (g % COLS) * TILE, sy = Math.floor(g / COLS) * TILE;
            if (sx + TILE <= this.itemSheet.width && sy + TILE <= this.itemSheet.height) {
              ctx.drawImage(this.itemSheet, sx, sy, TILE, TILE, INV_X + 37, rowY - 1, 20, 20);
            }
          }
        }

        // 名称
        let nm = name;
        ctx.font = K.FONT(12);
        const nameMax = infoCols ? 205 : 470;
        while (nm.length > 1 && ctx.measureText(nm).width > nameMax) nm = nm.slice(0, -1);
        const isSel = idx === sel;
        K.text(ctx, nm, INV_X + 84, rowY + 2,
          isSel ? '#fdf6e3' : this.itemColor(row), K.FONT(12));
        // 耐性栏（equipinfo 31474）
        if (infoCols && typeof row === 'object' && row) {
          this.drawResistRow(ctx, K, row, INV_X + RESIST_X, rowY + 2);
        }

        // 右列（重量 / 价格 / MP）
        ctx.font = K.FONT(12);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isSel ? '#fdf6e3' : '#0a0a0a';
        ctx.fillText(right, INV_X + 600, rowY + 2);
        ctx.textAlign = 'left';
      }
      ctx.restore();

      // 底部：总重 + 页码（display_note / showscroll）
      const p = game.player;
      let total = 0;
      for (const it of p.inv) if (it) total += (it.f[7] | 0) * (it.f[0] | 0);
      const maxW = p.get(44) | 0;
      const cargo = game.getV65 ? (game.getV65(80) | 0) : 0;
      const cargoMax = game.getV65 ? (game.getV65(82) | 0) : 0;
      const cargoPart = cargoMax > 0
        ? ` Cargo ${K.cnvweight(cargo)}/${K.cnvweight(cargoMax)}` : '';
      const note = `${rows.length} items  (Weight ${K.cnvweight(total)}/${K.cnvweight(maxW)}${cargoPart})`;
      ctx.font = K.FONT(10);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#000';
      // 0-FJ：原来右对齐到 INV_X+580，运费文字一长就会压到右下角的 Page.x/x
      ctx.fillText(note, INV_X + 30, INV_Y + 367);
      // 297101：var_340 + var_346 + var_347 + var_343（+ 保持指定，仅 Examine）
      const hint = (UI.invMode === 'bag')
        ? '↑↓[选择]  x[知识]  z[情报切换]  *[保持]  Enter[决定]  Esc[关闭]'
        : '↑↓[选择]  x[知识]  z[切换]  Enter[决定]  Esc[关闭]';
      ctx.fillText(hint, INV_X + 30, INV_Y + 386);
      const pageText = `Page.${page + 1}/${pages}`;
      ctx.textAlign = 'right';
      ctx.fillText(pageText, INV_X + INV_W - 40, INV_Y + 367);
      ctx.textAlign = 'left';
      // 道具的知识窗盖在列表上（原版从列表按 x / 回车进入，Esc 返回列表）
      if (UI.invInfo) this.drawItemKnowledge(game);
    }

    /** 耐性栏表头（var_2251 的 "火 冷 雷 闇 幻 毒 獄 音 神 沌 魔"） */
    drawResistHead(ctx, K, x, y) {
      ctx.font = K.FONT(11);
      for (let i = 0; i < RESIST_HEAD.length; i++) {
        K.text(ctx, RESIST_HEAD[i], x + i * RESIST_STEP, y, '#000', K.FONT(10));
      }
    }

    /**
     * 单件物品的耐性栏（equipinfo 31474-31515）：
     *   遍历 15 个附魔，只取 `id \ 10000 == 2`（耐性），
     *   列位置 = x + (元素 - 50) * 20，文字 = (|power/2/50|+1)，>5 时显示 "+"。
     */
    drawResistRow(ctx, K, it, x, y) {
      if (!it || !it.f) return;
      for (let n = 0; n < 15; n++) {
        const eid = it.f[40 + n * 2] | 0;
        if (eid === 0) break;
        if (Math.trunc(eid / 10000) !== 2) continue;
        const elem = eid % 10000;
        if (elem < 50 || elem > 60) continue;
        const pw = it.f[41 + n * 2] | 0;
        let lv = Math.abs(Math.trunc(Math.trunc(pw / 2) / 50)) + 1;
        const txt = lv > 5 ? '+' : String(lv);
        ctx.font = K.FONT(10);
        K.text(ctx, txt, x + (elem - 50) * RESIST_STEP, y, pw >= 0 ? '#1a4a1a' : '#7a1a1a', K.FONT(10));
      }
    }

    /**
     * 道具的知识窗（*label_2833 300264-300330）
     *   标题「道具的知识」+ 道具名 topic + 15 行 × 18px + Page.x/y + 底部提示
     */
    drawItemKnowledge(game) {
      const UI = Elona.UI, K = Elona.UiKit, II = Elona.ItemInfo;
      if (!UI || !K || !II || !UI.invInfo) return;
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, UI_W, UI_H);
      K.drawWindow(ctx, this.ui, INFO_X, INFO_Y, INFO_W, INFO_H);

      const title = '道具的知识';
      const tabW = 300;
      ctx.fillStyle = '#cfc3b2';
      ctx.fillRect(INFO_X + 34, INFO_Y - 4, tabW, 32);
      ctx.strokeStyle = '#6b5d49';
      ctx.lineWidth = 1;
      ctx.strokeRect(INFO_X + 34.5, INFO_Y - 3.5, tabW - 1, 31);
      ctx.font = K.FONT(13);
      K.btext(ctx, title, INFO_X + 34 + (tabW - ctx.measureText(title).width) / 2,
        INFO_Y + 2, '#fff', K.FONT(13));

      const info = II.build(game, UI.invInfo);
      // 道具名 topic（display_topic itemname）
      this.gspr(120, 360, 24, 16, INFO_X + 24, INFO_Y + 30, 24, 16);
      ctx.font = K.FONT(13);
      let nm = info.name;
      while (nm.length > 1 && ctx.measureText(nm).width > INFO_W - 100) nm = nm.slice(0, -1);
      K.text(ctx, nm, INFO_X + 52, INFO_Y + 30, this.itemColor(UI.invInfo), K.FONT(13));
      const tw = ctx.measureText(nm).width;
      ctx.fillStyle = '#000';
      ctx.fillRect(INFO_X + 48, INFO_Y + 48, tw + 12, 1);

      // 折行 + 分页
      const lines = this.wrapInfoLines(ctx, info.lines, INFO_W - 110, K.FONT(12));
      const pages = Math.max(1, Math.ceil(lines.length / INFO_ROWS));
      let page = UI.invInfoPage | 0;
      if (page < 0) page = 0;
      if (page >= pages) page = pages - 1;
      const start = page * INFO_ROWS;

      ctx.save();
      ctx.beginPath();
      ctx.rect(INFO_X + 30, INFO_Y + 56, INFO_W - 50, INFO_ROWS * INFO_ROW_H + 4);
      ctx.clip();
      const COL = { 1: '#006400', 2: '#000064', 3: '#506400', 4: '#503200', 8: '#006464', 9: '#b40000', 7: '#000' };
      for (let i = 0; i < INFO_ROWS; i++) {
        const ln = lines[start + i];
        if (!ln) break;
        const y = INFO_Y + 62 + i * INFO_ROW_H;
        const color = COL[ln.icon] || '#000';
        if (ln.icon > 0) {
          this.gspr(72 + ln.icon * 24, 336, 24, 24, INFO_X + 36, y - 4, 18, 18);
        }
        ctx.font = K.FONT(12);
        if (ln.align === 'right') {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillStyle = color;
          ctx.fillText(ln.text, INFO_X + INFO_W - 40, y);
          ctx.textAlign = 'left';
        } else {
          K.text(ctx, ln.text, INFO_X + 68, y, color, K.FONT(12));
        }
      }
      ctx.restore();

      // 底部
      ctx.font = K.FONT(11);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#000';
      ctx.fillText('回车、Shift/Esc [关闭]  +/-[翻页]', INFO_X + 30, INFO_Y + INFO_H - 42);
      ctx.textAlign = 'right';
      ctx.fillText(`Page.${page + 1}/${pages}`, INFO_X + INFO_W - 40, INFO_Y + INFO_H - 42);
      ctx.textAlign = 'left';
    }

    /** 情报行折行：返回 [{icon, text, align}]，同一逻辑行折出的第 2 行起 icon = 0 */
    wrapInfoLines(ctx, lines, maxW, font) {
      ctx.font = font;
      const out = [];
      for (const ln of lines) {
        const raw = String(ln.text || '');
        if (ln.align === 'right') { out.push(ln); continue; }
        let cur = '';
        let first = true;
        for (const ch of raw) {
          const test = cur + ch;
          if (cur && ctx.measureText(test).width > maxW) {
            out.push({ icon: first ? ln.icon : 0, text: cur, align: 'left' });
            first = false;
            cur = ch;
          } else {
            cur = test;
          }
        }
        out.push({ icon: first ? ln.icon : 0, text: cur, align: 'left' });
      }
      return out;
    }

    /**
     * 消息窗文字（msg_write：x=var_204+6，y=var_208+6，行高 15）
     * 0-DD：支持纵向展开到 5 倍高度（F3 循环 4 → 8 → 12 → 16 → 20 行），
     *       展开时窗口向视野方向长高，原版行为一致（不保留更早的消息）。
     */
    drawMessages() {
      const extra = (Elona.Hud && Elona.Hud.opts) ? (Elona.Hud.opts.msgExpand | 0) : 0;
      const total = MSG_LINES + extra;
      const top = MSG_TOP - extra * MSG_LINE_H;
      const lines = this.messageLines();
      const shown = lines.slice(-total);
      const font = FONT_MSG;
      if (extra > 0) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.86)';
        ctx.fillRect(0, top, UI_W, UI_BOTTOM - top);
        ctx.restore();
        this.text(`▲ 消息栏 ${total} 行（F3 收起）`, UI_W - 168, top + 2, 'rgba(220,210,170,0.85)', FONT_UI(10));
      }
      const startY = top + 6;
      for (let i = 0; i < shown.length; i++) {
        this.text(shown[i], UI_LEFT + 6, startY + i * MSG_LINE_H, '#fff', font);
      }
    }

    /** 把 UI.messages 折行并按版本缓存 */
    messageLines() {
      const UI = Elona.UI;
      const version = (UI && UI.msgVersion) | 0;
      if (this._msgCache && this._msgCache.v === version) return this._msgCache.lines;
      const ctx = this.ctx;
      ctx.font = FONT_MSG;
      const maxW = UI_W - UI_LEFT - 12;      // var_216 - var_204 - 6
      const lines = [];
      for (const msg of ((UI && UI.messages) || [])) {
        for (const raw of String(msg).split('\n')) {
          let cur = '';
          for (const ch of raw) {
            const test = cur + ch;
            if (cur && ctx.measureText(test).width > maxW) {
              const sp = cur.lastIndexOf(' ');
              if (sp > 0) { lines.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; }
              else { lines.push(cur); cur = ch; }
            } else {
              cur = test;
            }
          }
          lines.push(cur);
        }
      }
      this._msgCache = { v: version, lines };
      return lines;
    }

    /** 绘制玩家以外的角色（NPC/怪物），使用 character.bmp 第 24 行 */
    drawCharas(game, startX, startY) {
      const ch = this.sheets.character;
      if (!ch) return;
      const ctx = this.ctx;
      // 0-DD：骑乘中的坐骑不单独绘制（玩家贴图的 ridebk/ride 层已包含它）
      const mountIdx = (game.getV65 ? (game.getV65(183) | 0) : 0);
      for (const c of game.charas) {
        if (!c || c.index === 0 || c.get(0) !== 1) continue;
        if (mountIdx !== 0 && (c.index | 0) === mountIdx && (c.get(196) | 0) === 0) continue;
        const vx = c.x - startX, vy = c.y - startY;
        if (vx < 0 || vy < 0 || vx >= this.viewW || vy >= this.viewH) continue;
        // 只有具备 PCC 外观的角色（玩家 / cbit(967)）才走合成图；
        // 其余 NPC 一律使用 character.bmp 中各自的 var_58(7) 贴图。
        if (Elona.PCC && c.pcc) {
          if (Elona.PCC.ready(c, game) && Elona.PCC.draw(ctx, c, vx * TILE, vy * TILE, TILE, game)) continue;
          Elona.PCC.preload(c, game).catch(() => { });
        }
        const idx = this.charaSpriteIndex(c);
        if (idx < 0) continue;
        const sx = (idx % COLS) * TILE, sy = Math.floor(idx / COLS) * TILE;
        if (sx + TILE > ch.width || sy + TILE > ch.height) continue;
        ctx.drawImage(ch, sx, sy, TILE, TILE, vx * TILE, vy * TILE, TILE, TILE);
        // 0-DG：听诊器（478）→ 贴图下方显示 HP / MP / 斗志 三条
        if (c.__hpbar) this.drawAllyBars(c, vx * TILE, vy * TILE);
      }
    }

    /**
     * 0-DG：同伴的 HP/MP/斗志 小条（听诊器 toggles c.__hpbar）。
     * 原版在同伴贴图正下方画三条 3px 高的彩条（HP 蓝=可进食，见 wiki「对同伴使用的道具」）。
     */
    drawAllyBars(c, dx, dy) {
      const ctx = this.ctx;
      const w = TILE - 8, x = dx + 4, y = dy + TILE - 10;
      const bars = [
        { v: c.hpMax ? (c.hp / c.hpMax) : 0, col: (c.get(22) | 0) >= 9000 ? '#4a9cff' : '#3ad14a' },
        { v: c.mpMax ? (c.mp / c.mpMax) : 0, col: '#4a9cff' },
        { v: (c.get(182) | 0) / 200, col: '#ffb03a' },
      ];
      ctx.save();
      for (let i = 0; i < bars.length; i++) {
        const by = y + i * 4;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(x - 1, by - 1, w + 2, 4);
        ctx.fillStyle = bars[i].col;
        const fw = Math.max(0, Math.min(1, bars[i].v || 0)) * w;
        ctx.fillRect(x, by, fw, 2);
      }
      ctx.restore();
    }

    /**
     * 角色贴图在 character.bmp 中的网格序号 —— cell_draw 34423-34433：
     *   var_847 = (var_58(7) - var_58(435)*1000) / 1000      → 调色板号（未实现）
     *   var_838 = var_58(7) \ 1000 + var_58(435)*1000
     *   var_58(7) == 0 且 var_58(435) == 1 → 13000
     *   694..724 区间直接使用原值
     * var_597 网格：列 = idx \ 33，行 = idx / 33（48px/格，33 列）。
     */
    charaSpriteIndex(c) {
      let raw = c.get(7) | 0;
      const css = c.get(435) | 0;
      if (raw === 0) {
        if (css === 1) raw = 13000;
        else return -1;
      }
      if (raw >= 694 && raw <= 724) return raw;
      return (raw % 1000) + css * 1000;
    }

    drawTile(sheet, tileId, dx, dy) {
      const sx = (tileId % COLS) * TILE;
      const sy = Math.floor(tileId / COLS) * TILE;
      if (sx + TILE > sheet.width || sy + TILE > sheet.height || tileId < 0) return;
      this.ctx.drawImage(sheet, sx, sy, TILE, TILE, dx, dy, TILE, TILE);
    }

    /**
     * 0-EU：把「与图块边缘连通的纯黑」抠成透明后再画（按 tileset + 图块 id 缓存）。
     *
     * 为什么不用整张表的黑→透明副本：门（726）这类**整块都是画面**的图块，内部也有
     * 纯黑像素，整表抠会把门板打穿。只抠「从四边泛洪能到达的黑」＝背景，既能让
     * 打开的门（236）、告示板（727/732）透出地面，又不会破坏关闭的门。
     */
    drawTileKeyed(sheet, tileset, tileId, dx, dy) {
      const cv = this.keyedTile(sheet, tileset, tileId);
      if (cv) this.ctx.drawImage(cv, dx, dy, TILE, TILE);
      else this.drawTile(sheet, tileId, dx, dy);
    }

    /** 取得（并缓存）抠过背景的 48×48 图块画布 */
    keyedTile(sheet, tileset, tileId) {
      const id = tileId | 0;
      if (id < 0 || !sheet) return null;
      const sx = (id % COLS) * TILE, sy = Math.floor(id / COLS) * TILE;
      if (sx + TILE > sheet.width || sy + TILE > sheet.height) return null;
      if (!this._keyed) this._keyed = new Map();
      const key = (tileset | 0) + ':' + id;
      const hit = this._keyed.get(key);
      if (hit !== undefined) return hit;
      let cv = null;
      try {
        cv = document.createElement('canvas');
        cv.width = TILE; cv.height = TILE;
        const g = cv.getContext('2d');
        g.drawImage(sheet, sx, sy, TILE, TILE, 0, 0, TILE, TILE);
        const img = g.getImageData(0, 0, TILE, TILE);
        const px = img.data;
        const isBlack = (p) => px[p * 4] === 0 && px[p * 4 + 1] === 0 && px[p * 4 + 2] === 0;
        const seen = new Uint8Array(TILE * TILE);
        const stack = [];
        const push = (x, y) => {
          if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
          const p = y * TILE + x;
          if (seen[p] || !isBlack(p)) return;
          seen[p] = 1; stack.push(p);
        };
        for (let i = 0; i < TILE; i++) { push(i, 0); push(i, TILE - 1); push(0, i); push(TILE - 1, i); }
        while (stack.length) {
          const p = stack.pop();
          px[p * 4 + 3] = 0;
          const x = p % TILE, y = (p - x) / TILE;
          push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
        }
        g.putImageData(img, 0, 0);
      } catch (e) {
        cv = null;   // 取不到像素（跨域等）→ 退回原图
      }
      if (this._keyed.size > 4096) this._keyed.clear();
      this._keyed.set(key, cv);
      return cv;
    }

    /**
     * 绘制角色图块。
     * 【已确认】cell_draw 中角色图块来自 character.bmp 的第 24 行：
     *   gcopy 5, index*48, 1152   (1152 = 24 * 48)
     * 玩家外观在原版由 create_pcpic 叠加 PCC 部件生成，属后续模块；
     * 垂直切片先用 character.bmp 的一条固定精灵。
     */
    drawPlayer(game, ox, oy) {
      const ctx = this.ctx;
      const ch = this.sheets.character;
      const dx = ox * TILE, dy = oy * TILE;
      if (Elona.PCC) {
        if (Elona.PCC.ready(game.player, game) && Elona.PCC.draw(ctx, game.player, dx, dy, TILE, game)) return;
        Elona.PCC.preload(game.player, game).catch(() => { });
      }
      if (ch) {
        let idx = this.charaSpriteIndex(game.player);
        if (idx < 0) idx = 16;   // 第 0 行第 16 号（冒险者外观）作为 PCC 未就绪时的占位
        ctx.drawImage(ch, (idx % COLS) * TILE, Math.floor(idx / COLS) * TILE, TILE, TILE, dx, dy, TILE, TILE);
      } else {
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(dx + 8, dy + 8, TILE - 16, TILE - 16);
      }
    }

    /**
     * 世界地图步行模式 —— 0-CH：改为绘制原版世界地图 ntyris（95×55）的地块，
     * 与普通地图同样的 48px 图块与视野跟随，而不是把 world.bmp 拉伸。
     */
    drawWorldMap(game) {
      const ctx = this.ctx, cv = this.canvas;
      const WM = Elona.WorldMap;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cv.width, cv.height);
      if (!WM || !WM.cells) {
        ctx.fillStyle = '#e8d18a';
        ctx.font = FONT_MSG;
        ctx.textAlign = 'center';
        ctx.fillText('正在载入世界地图……', cv.width / 2, cv.height / 2);
        return;
      }
      // 0-GW：世界地图上要画玩家立绘，角色表也必须就绪（平时只在进城时载入）
      if (!this.sheets.character) this.loadCharacterSheet().catch(() => { });
      // 世界地图的 tileset（ntyris = 0）可能与当前城镇不同，需要按需加载
      let sheet = this.sheets[WM.tileset];
      if (!sheet) {
        this.loadSheet(WM.tileset).catch(() => { });
      }
      const w = game.worldMap;
      const look = game.worldLook;             // 0-FT：查看模式的光标（null = 正常）
      const cam = look || w;                   // 镜头中心：查看时跟光标，否则跟玩家
      const ox = 8, oy = 5;
      const startX = cam.x - ox, startY = cam.y - oy;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, UI_W, UI_TOP);
      ctx.clip();
      for (let vy = 0; vy < this.viewH; vy++) {
        for (let vx = 0; vx < this.viewW; vx++) {
          const mx = startX + vx, my = startY + vy;
          const dx = vx * TILE, dy = vy * TILE;
          let tile = 531;                       // 越界用默认图块
          if (mx >= 0 && my >= 0 && mx < WM.width && my < WM.height) {
            tile = WM.cells[my][mx][0] | 0;
          }
          if (sheet) this.drawTile(sheet, tile, dx, dy);
          else { ctx.fillStyle = '#203020'; ctx.fillRect(dx, dy, TILE, TILE); }
        }
      }
      // 249758：`cell_featset var_132(1,cnt), var_132(2,cnt), var_132(15,cnt), 15, cnt\100, cnt/100`
      //   —— 据点在世界上就是 `var_132(15)` 这个图块，直接画在入口格上。
      //   `var_132(15)` 的图（城镇 132 / 城堡 140 / 洞窟 133、138 等）四周是纯黑，
      //   所以走 keyed 版把「连到边缘的黑」抠成透明，露出底层地形。
      const ST = Elona.Sites;
      const wid = (game.getV65 ? (game.getV65(850) | 0) : 0) || 4;
      const siteCells = new Set();          // 已画过地标的格（"x,y"），用于避免再叠圆点
      const placed = (ST && ST.ready && ST.ready())
        ? ST.ofWorld(wid, { placed: true }, game) : [];
      if (sheet) {
        for (const s of placed) {
          if (!s || !s.fields) continue;
          const fig = s.fields[15] | 0;
          if (!fig) continue;
          const mx = s.fields[1] | 0, my = s.fields[2] | 0;
          if (mx < startX || my < startY
            || mx >= startX + this.viewW || my >= startY + this.viewH) continue;
          siteCells.add(mx + ',' + my);
          this.drawTileKeyed(sheet, WM.tileset, fig, (mx - startX) * TILE, (my - startY) * TILE);
        }
      }
      // 玩家标记（画在城镇标记之前，避免挡住城镇名）
      //   0-FT：查看模式下镜头不跟玩家，所以标记要按玩家真实世界坐标换算。
      //   0-GW：世界地图上也画玩家立绘（character.bmp / PCC 合成图），
      //        贴图未就绪时才退回原来的白点。
      const pvx = (w.x | 0) - startX, pvy = (w.y | 0) - startY;
      if (pvx >= 0 && pvy >= 0 && pvx < this.viewW && pvy < this.viewH) {
        const px = pvx * TILE + TILE / 2, py = pvy * TILE + TILE / 2;
        // 先垫一层淡光晕，深色地形上也能看清自己
        ctx.beginPath();
        ctx.arc(px, py, TILE * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,248,200,.22)';
        ctx.fill();
        const hasSprite = !!(this.sheets.character
          && (this.charaSpriteIndex(game.player) >= 0
            || (Elona.PCC && Elona.PCC.ready && Elona.PCC.ready(game.player, game))));
        if (hasSprite) {
          this.drawPlayer(game, pvx, pvy);
        } else {
          const pulse = 5 + Math.sin(performance.now() / 250) * 1.2;
          ctx.beginPath();
          ctx.arc(px, py, pulse, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#000';
          ctx.stroke();
        }
        if (look) {
          // 查看模式下镜头已离开玩家，给标记加个「你」，免得找不到自己
          ctx.font = FONT_UI(10);
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(0,0,0,.85)';
          ctx.fillText('你', px + 1, py - 6);
          ctx.fillStyle = '#fff';
          ctx.fillText('你', px, py - 7);
        }
      }
      // 城镇标记（世界坐标与地图格一一对应）
      const towns = (Elona.Towns && Elona.Towns.LIST) || [];
      const townName = (t) => ((Elona.Towns && Elona.Towns.labelOf) ? Elona.Towns.labelOf(t) : t.label);
      ctx.textAlign = 'center';
      ctx.font = FONT_UI(10);
      for (const t of towns) {
        const vx = t.wx - startX, vy = t.wy - startY;
        if (vx < 0 || vy < 0 || vx >= this.viewW || vy >= this.viewH) continue;
        const x = vx * TILE + TILE / 2, y = vy * TILE + TILE / 2;
        const current = game.map && game.map.name === t.name;
        // 已经有地标贴图的格（如 Vernis 的城镇图）不再叠圆点，只保留名字；
        // 名字也挪到图块下方，免得压住建筑。
        const hasArt = siteCells.has(t.wx + ',' + t.wy);
        if (!hasArt) {
          ctx.fillStyle = current ? '#ffd700' : '#f0e0b0';
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#000';
          ctx.stroke();
        }
        // 名字画在点/地标下方（有贴图时贴到图块下沿），黑底描边保证在任何地形上都清晰
        ctx.font = FONT_UI(11);
        const tx = x, ty = y + (hasArt ? 34 : 15);
        const nm = townName(t);
        ctx.fillStyle = 'rgba(0,0,0,.8)';
        ctx.fillText(nm, tx + 1, ty + 1);
        ctx.fillStyle = 'rgba(0,0,0,.8)';
        ctx.fillText(nm, tx - 1, ty - 1);
        ctx.fillStyle = current ? '#ffd700' : '#ffffff';
        ctx.fillText(nm, tx, ty);
      }
      // 0-FA：站点 / 随机地城入口（*label_2469 的槽位 450..499 与 35 个固定站点）。
      //   贴图已在上面按 `var_132(15)` 铺好；这里只补「状态点 + 名字」，
      //   没有贴图的条目（全表 12 条 var_132(15)==0）才回退成原来的圆点/菱形。
      if (ST && ST.ready && ST.ready()) {
        for (const s of placed) {
          if (!s || !s.fields) continue;
          const mx = s.fields[1] | 0, my = s.fields[2] | 0;
          const vx = mx - startX, vy = my - startY;
          if (vx < 0 || vy < 0 || vx >= this.viewW || vy >= this.viewH) continue;
          const x = vx * TILE + TILE / 2, y = vy * TILE + TILE / 2;
          const k = s.fields[0] | 0;
          const nefia = k >= 20 && k <= 27;
          const cleared = (s.fields[20] | 0) === -1;
          const awake = (s.fields[32] | 0) !== 0;
          const isProp = !!s.player;                 // 0-FF：玩家自建地产
          const hasArt = siteCells.has(mx + ',' + my);
          if (!hasArt) {
            // 无地标图的条目：沿用原来的色块标记
            ctx.save();
            ctx.translate(x, y);
            ctx.beginPath();
            if (nefia) {
              ctx.moveTo(0, -8); ctx.lineTo(7, 0); ctx.lineTo(0, 8); ctx.lineTo(-7, 0); ctx.closePath();
            } else {
              ctx.rect(-4, -4, 8, 8);
            }
            ctx.fillStyle = isProp ? '#8ef0a0'
              : (cleared ? 'rgba(120,120,125,.9)'
                : (awake ? '#e86ad6' : (s.dyn ? '#ff9a3c' : '#7ec8ff')));
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#000';
            ctx.stroke();
            ctx.restore();
          } else if (isProp || s.dyn) {
            // 有地标图的动态条目：只在右上角补一个小状态点，不遮住贴图
            ctx.beginPath();
            ctx.arc(x + 16, y - 16, 3, 0, Math.PI * 2);
            ctx.fillStyle = isProp ? '#8ef0a0'
              : (cleared ? 'rgba(170,170,175,.95)' : (awake ? '#e86ad6' : '#ff9a3c'));
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#000';
            ctx.stroke();
          }
          if (!s.dyn && !isProp) continue;           // 固定站点只画贴图，避免文字刷屏
          const label = ST.nameOf(s.id, undefined, game);
          const ty = hasArt ? y + 34 : y - 12;
          // 有贴图时把「危险度 / 已攻略」并进同一行，避免第二行压到下一格
          const line = hasArt
            ? `${label}　${cleared ? '已攻略' : ''}${s.fields[17] | 0}层`
            : label;
          ctx.font = FONT_UI(hasArt ? 9 : 10);
          ctx.fillStyle = 'rgba(0,0,0,.85)';
          ctx.fillText(line, x + 1, ty + 1);
          ctx.fillStyle = isProp ? '#b6ffc8' : (awake ? '#ffb6f0' : '#ffe0a0');
          ctx.fillText(line, x, ty);
          if (isProp) { ctx.fillStyle = '#ffffff'; continue; }   // 地产没有「层数」
          if (hasArt) continue;                                  // 已合并进同一行
          ctx.font = FONT_UI(9);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(`${cleared ? '已攻略 ' : ''}${s.fields[17] | 0}层`, x, ty + 11);
        }
      }
      // 0-FT：查看模式 —— 光标恒在视口正中（黄虚线框），左下角报坐标 / 地名
      if (look) {
        const cx = ox * TILE, cy = oy * TILE;
        ctx.save();
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(cx + 1, cy + 1, TILE - 2, TILE - 2);
        ctx.setLineDash([]);
        ctx.restore();

        let place = '';
        for (const t of (Elona.Towns && Elona.Towns.LIST) || []) {
          if (t.wx === (look.x | 0) && t.wy === (look.y | 0)) { place = townName(t); break; }
        }
        if (!place && ST && ST.ready && ST.ready()) {
          const hit = placed.find((x) => x && x.fields
            && (x.fields[1] | 0) === (look.x | 0) && (x.fields[2] | 0) === (look.y | 0));
          if (hit) place = ST.nameOf(hit.id, undefined, game) || '';
        }
        const txt = `(${look.x}, ${look.y})${place ? '　' + place : ''}`;
        ctx.save();
        ctx.font = FONT_UI(11);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const tw = ctx.measureText(txt).width;
        // 贴右上角：左下角被 HUD 的 HP/MP 状态条压着（UI_TOP 下方就是状态行）
        const rx = UI_W - tw - 18, ry = 26;
        ctx.fillStyle = 'rgba(14,12,9,0.72)';
        ctx.fillRect(rx - 6, ry - 3, tw + 12, 16);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(txt, rx, ry - 1);
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
      }
      ctx.restore();

      // 0-DD：世界地图也是普通地图，套用同一套 HUD（时钟 / 消息栏 / 小地图 / 数值条）
      this.drawHud(game);
      // 操作提示放在视野顶部中央（底部留给 HP/MP 条）
      {
        const ctx = this.ctx;
        const msg = game.worldLook
          ? '查看模式：方向键移动光标　* / Esc 退出'
          : '方向键移动　城镇/地点按回车进入　* 查看　M 返回';
        ctx.save();
        ctx.font = FONT_UI(11);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const tx = UI_W / 2, ty = 6;
        const tw = ctx.measureText(msg).width;
        ctx.fillStyle = 'rgba(14,12,9,0.66)';
        ctx.fillRect(tx - tw / 2 - 6, ty - 2, tw + 12, 16);
        ctx.fillStyle = 'rgba(255,252,220,0.95)';
        ctx.fillText(msg, tx, ty);
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
      }
    }

    loadCharacterSheet() {
      if (this.sheets.character) return Promise.resolve(this.sheets.character);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          // 原版以黑色为透明色（cell_draw 的 gmode 2）；把纯黑背景处理成透明，
          // 这样 NPC 贴图会叠在当前格子的地图背景上。
          try {
            const cv = document.createElement('canvas');
            cv.width = img.width; cv.height = img.height;
            const g = cv.getContext('2d');
            g.drawImage(img, 0, 0);
            const data = g.getImageData(0, 0, cv.width, cv.height);
            const p = data.data;
            for (let i = 0; i < p.length; i += 4) {
              if (p[i] === 0 && p[i + 1] === 0 && p[i + 2] === 0) p[i + 3] = 0;
            }
            g.putImageData(data, 0, 0);
            this.sheets.character = cv;
            resolve(cv);
          } catch (_) {
            this.sheets.character = img;
            resolve(img);
          }
        };
        img.onerror = () => resolve(null);
        img.src = 'assets/graphic/character.bmp';
      });
    }
  }

  Elona.Renderer = Renderer;
  Elona.TILE_SIZE = TILE;
})(window);
