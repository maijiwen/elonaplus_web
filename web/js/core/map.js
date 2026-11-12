'use strict';
/**
 * 地图模块 —— 地图数据模型与通行判定
 *
 * 【格式已确认】由 start.hsp 的 map_reload / label_2873 反推：
 *   .idx : 100 个 int32   (HSP 变量 var_126)
 *   .map : 宽 × 高 × 10 个 int32 (HSP 变量 var_704(x, y, 0..9))
 *   .obj : 400 × 5 个 int32 (HSP 变量 var_469(0..4, n))
 *   HSP 多维数组内存布局为「第一维下标最快」，即 idx = x + y*w + f*w*h
 *
 * 【已确认的 var_126 字段】
 *   [0]=宽 [1]=高 [2]=图块图形集(0..3, 对应 graphic/mapN.bmp)
 *   [4]/[5]=楼梯/入口坐标(编码为 y*1000+x)  [12]=地图类型(传给 map_tileset)
 *   [15]=自定义地图标记
 *
 * 【已确认的 var_704 字段（部分）】
 *   [0] 图块ID（绘制用；map_converttile 会把 0/1/3/4/>=100 的符号值替换成真实图块）
 *   [1] 角色占用（值为 chara 索引 + 1，0 表示空）—— 见 cell_check
 *   [6] 地形 feature 相关（cell_check 中 field6\1000 作为图块ID查表）
 *   [7] 装饰图块（33677: var_838 = f7\10, f7/10）
 *   其余字段语义【未确认】，保留原值不做解释。
 *
 * 【通行判定已确认】来自 cell_check (start.hsp 行 32344)：
 *   越界 / field1!=0 / (field6!=0 且 attr(7, field6\1000)&4) / attr(7, field0)&4  → 不可通行
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  // 图块属性表的字段索引（var_593 的第 1 维）
  const ATTR_WALK = 7;   // 通行标志位: &4 表示阻挡

  class GameMap {
    constructor(json, tileAttrs) {
      this.name = json.name;
      this.width = json.width;
      this.height = json.height;
      this.tileset = json.tileset;      // 对应 graphic/map{tileset}.bmp
      this.header = json.header;        // var_126 (100 个 int)
      // 0-CG：cells 必须深拷贝——Data.map() 返回的是**缓存对象**，
      // 直接引用会让上一次载入写入的 cell[1]（角色）/cell[4]（物品通道）残留，
      // 导致再次载入同一张地图时所有预设物品都被判为「该格已有物品」而跳过。
      this.cells = (json.cells || []).map((row) => row.map((c) => c.slice()));
      this.objects = json.objects || [];// var_469 解出的对象列表
      this.attrs = tileAttrs || {};

      // ---- 迷雾 / 视野状态（对应原版 var_105 / var_704(x,y,2) / var_812）----
      //   fogTile  : var_812，未探索格的记忆图块（map_setfog 228461 写入）
      //   open     : 「整图已揭示」的地图（城镇/野外/自家等，228475 的分支）
      //   seen/vis : 0-DW 新增的布尔表；原版用
      //              「记忆图块 != 雾图块」判已探索、用 var_105==var_104 判当前可见
      this.fogTile = 531;
      this.open = false;
      this.seen = null;
      this.vis = null;
      this._fovReady = false;
    }

    inBounds(x, y) {
      return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    // ==================== 迷雾 / 视野（0-DW） ====================
    /**
     * 初始化迷雾 —— 对应原版 map_setfog（228461-228521）。
     *   · 所有格子的记忆图块（var_704(x,y,2)）先写 fogTile（var_812）
     *   · open 地图（城镇/野外/自家…）再把记忆图块写成真实图块，等于「全图已探索」
     * @param {number} fogTile var_812
     * @param {boolean} open 是否整图揭示
     */
    initFog(fogTile, open) {
      const n = this.width * this.height;
      this.fogTile = fogTile | 0;
      this.open = !!open;
      this.seen = new Uint8Array(n);
      this.vis = new Uint8Array(n);
      for (let y = 0; y < this.height; y++) {
        const row = this.cells[y];
        for (let x = 0; x < this.width; x++) {
          const c = row[x];
          // 原版：记忆图块 = var_812；open 地图随后 = 真实图块
          if (c[2] !== undefined) c[2] = this.open ? (c[0] | 0) : this.fogTile;
          if (this.open) this.seen[y * this.width + x] = 1;
        }
      }
      this._fovReady = true;
    }

    /** 该格是否曾经进入过视野（已探索） */
    isSeen(x, y) {
      if (!this.inBounds(x, y) || !this.seen) return false;
      return this.seen[y * this.width + x] === 1;
    }

    /** 该格本帧是否在玩家视野内 */
    isVisible(x, y) {
      if (!this.inBounds(x, y) || !this.vis) return false;
      return this.vis[y * this.width + x] === 1;
    }

    /** 标记「当前可见」：写 var_105 等价状态，并把记忆图块更新为真实图块（*label_2115） */
    setVisible(x, y) {
      if (!this.inBounds(x, y) || !this.vis) return;
      const idx = y * this.width + x;
      this.vis[idx] = 1;
      this.seen[idx] = 1;
      const c = this.cells[y][x];
      if (c[2] !== undefined) c[2] = c[0] | 0;
    }

    /** 只标记「已探索」（魔法地图 / 物质感知）：不进入当前可见 */
    markSeen(x, y) {
      if (!this.inBounds(x, y) || !this.seen) return;
      this.seen[y * this.width + x] = 1;
      const c = this.cells[y][x];
      if (c[2] !== undefined) c[2] = c[0] | 0;
    }

    cell(x, y) {
      if (!this.inBounds(x, y)) return null;
      return this.cells[y][x];
    }

    /** 取图块属性表条目（按当前 tileset） */
    attr(tileId, field) {
      const t = this.attrs[String(this.tileset)];
      if (!t) return 0;
      const v = t[String(tileId)];
      if (!v) return 0;
      return v[field] || 0;
    }

    /**
     * 通行判定 —— 对应 cell_check(x, y)
     * 返回 { walkable: bool, charaIndex: number }
     */
    check(x, y) {
      if (!this.inBounds(x, y)) return { walkable: false, charaIndex: -1 };
      const c = this.cells[y][x];
      let walkable = true;
      let charaIndex = -1;
      if (c[1] !== 0) { charaIndex = c[1] - 1; walkable = false; }
      if (c[6] !== 0) {
        // cell_check 32344：`var_593(7, var_704(x,y,6) \ 1000)`。
        // HSP `\` = 取余 → 用 feat 的图块 id（低 3 位）查通行属性。
        const tid = c[6] % 1000;
        if (this.attr(tid, ATTR_WALK) & 4) walkable = false;
      }
      if (this.attr(c[0], ATTR_WALK) & 4) walkable = false;
      return { walkable, charaIndex };
    }

    walkable(x, y) { return this.check(x, y).walkable; }

    /** 图块ID: 图块表每行 33 个图块，边长 48px（cell_draw 中 gcopy 的定位方式） */
    static get TILE_SIZE() { return 48; }
    static get TILE_COLS() { return 33; }
  }

  Elona.GameMap = GameMap;
})(window);
