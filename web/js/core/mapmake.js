'use strict';
/**
 * 原版随机地城生成（core/mapmake.js）
 *
 * 【源码依据】hsp/start.hsp
 *   *label_2413        230571-231098  地图尺寸 / 布局类型 var_1736 / 生成失败重掷
 *   map_initialize     227782-227796  房间数上限 30、符号地图清零
 *   map_createroom     228525-228746  房间（mode 0..4）、重叠检测、门洞
 *   map_createroomdoor 228470-228523  指定方向开门
 *   map_connectroom    229080-229144  房间两两相连（方向表 var_528 + 随机游走挖通道）
 *   map_digtoentrance1 228367-228456  已由 core/mapdig.js 移植，这里直接复用
 *   map_makedoor       229145-229174  房间边缘放闭门（feat 21）
 *   map_placeupstairs  228748-228760  / map_placedownstairs 228761-228776
 *   map_converttile    227391-227418  符号图 → 真实图块
 *   *label_2417..2431  231429-232600  10 种布局（var_1736 = 1..10）
 *
 * 【符号图与原版一致】var_704(x,y,0)：
 *   0 = 未挖的墙（map_digcheck 唯一可挖区）
 *   1 = 房间墙（map_tileset 的 var_1619 = 462）
 *   3 = 房间地板 / 通道口（var_1620 = 13）
 *   4 = 挖通道时的埋伏格（var_1650 概率命中）
 *   100 = 通道 / 房间内部地板（var_1471 = 33）
 * convert() 把它们映射到项目既有图块：3 / >=100 → 33（地板），其余 → 468（墙）。
 * 图块编号属于渲染载体差异，布局 / 房间 / 走廊 / 门 / 楼梯全部照源码生成。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const FLOOR = 33, WALL = 468;
  const DOOR_TILE = 726;          // var_1600（map_tileset 227422）
  const DOOR_TYPE = 21;           // cell_featset 的闭门 type
  const STAIRS_UP_TYPE = 10, STAIRS_DOWN_TYPE = 11;
  const DIRS = [[0, 1], [-1, 0], [1, 0], [0, -1]];   // var_528(0/1, 0..3)：下/左/右/上

  const idiv = (a, b) => (b ? Math.trunc(a / b) : 0);
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

  function rngOf(g) { return (g && g.rng) || Elona.rng || { rnd: () => 0 }; }

  /**
   * 布局类型 var_1736（230589-230705）。
   * @param {number} kind var_132(0, mapId)，随机地城为 20..27
   * @param {function} R rnd(n)
   * @param {object} opt {siteType: var_132(16,mapId), depth: var_65(22), forced: var_3}
   */
  function layoutOf(kind, R, opt) {
    opt = opt || {};
    let layout = 1;
    if (R(30) === 0) layout = 3;                      // 230589
    switch (kind | 0) {
      case 20:                                        // 230592-230612
        layout = 2;
        if (R(4) === 0) layout = 1;
        if (R(6) === 0) layout = 10;
        if (R(10) === 0) layout = 4;
        if (R(25) === 0) layout = 8;
        break;
      case 22:                                        // 230613-230630
        layout = 2;
        if (R(6) === 0) layout = 1;
        if (R(6) === 0) layout = 10;
        if (R(25) === 0) layout = 8;
        if (R(20) === 0) layout = 4;
        break;
      case 21:                                        // 230631-230648
        layout = 1;
        if (R(5) === 0) layout = 4;
        if (R(10) === 0) layout = 3;
        if (R(25) === 0) layout = 2;
        break;
      case 23:                                        // 230649-230666
        layout = 1;
        if (R(5) === 0) layout = 4;
        if (R(6) === 0) layout = 5;
        if (R(7) === 0) layout = 2;
        break;
      case 24:                                        // 230667-230675
        layout = 1;
        if (R(3) === 0) layout = 10;
        if (R(7) === 0) layout = 8;
        break;
      case 25:                                        // 230676-230684
        layout = 1;
        if (R(3) === 0) layout = 5;
        if (R(5) === 0) layout = 4;
        break;
      case 26:                                        // 230685-230696
        layout = 1;
        if (R(5) === 0) layout = 2;
        if (R(6) === 0) layout = 5;
        if (R(7) === 0) layout = 10;
        break;
      case 27:                                        // 230697-230705
        layout = 2;
        if (R(5) === 0) layout = 3;
        if (R(7) === 0) layout = 8;
        break;
      default: break;
    }
    // 230706-230803：固定地图按 var_132(16) 指定布局（主线地城 / 特殊地图）
    const st = opt.siteType | 0, d = opt.depth | 0;
    if (st === 3) {                                   // 230709-230772
      layout = 1;
      if (d === 1) layout = 2;
      if (d === 5 || d === 15 || d === 25) layout = 5;
      if (d === 10 || d === 20 || d === 30) layout = 3;
      if (d < 30 && R(4) === 0) layout = 2;
      if (R(5) === 0) layout = 4;
      if (R(20) === 0) layout = 8;
      if (R(6) === 0) layout = 10;
    } else if (st === 16 || st === 17 || st === 18) layout = 1;
    else if (st === 26 || st === 68) layout = 8;
    else if (st === 27) layout = 10;
    else if (st === 38) layout = 9;
    else if (st === 69 || st === 88) layout = 2;
    if (opt.forced) layout = opt.forced | 0;         // 230832-230834 var_3
    return layout;
  }

  class Builder {
    constructor(g, opt) {
      this.g = g;
      this.opt = opt || {};
      const rng = rngOf(g);
      this.R = (n) => rng.rnd(Math.max(1, n | 0));
      this.W = 0; this.H = 0;
      this.cell = [];
      this.rooms = [];
      this.doors = [];
      this.up = null; this.down = null;
      this.layout = 1;
      this.margin = 3;       // var_1658
      this.randSize = 4;     // var_1657
      this.roomTarget = 0;   // var_1630
      this.area = 0;         // var_1734
      this.mapLevel = 0;     // var_126(10)
      this.connRetries = 1;  // var_1674
      this.ambush = 20;      // var_1650
      this.noDown = false;
    }

    /** map_initialize（227782-227796） */
    initialize(W, H) {
      this.W = W | 0 || this.W;
      this.H = H | 0 || this.H;
      this.cell = [];
      for (let y = 0; y < this.H; y++) {
        const row = [];
        for (let x = 0; x < this.W; x++) row.push([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        this.cell.push(row);
      }
      this.rooms = [];
      this.doors = [];
      this.up = null; this.down = null;
      this.roomTarget = Math.min(30, idiv(this.W * this.H, 70));
      this.area = this.W * this.H;
      this.mapLevel = idiv(this.W * this.H, 100);
      this.noDown = false;
      return this;
    }

    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
    sym(x, y) { return this.inBounds(x, y) ? (this.cell[y][x][0] | 0) : 1; }
    setSym(x, y, v) { if (this.inBounds(x, y)) this.cell[y][x][0] = v; }

    /** 给 MapDig / MapFeat 用的最小 g 视图：cell[0] 就是符号图 */
    shim() {
      const self = this;
      return {
        rng: this.g && this.g.rng,
        map: {
          width: this.W, height: this.H,
          cell(x, y) { return self.inBounds(x, y) ? self.cell[y][x] : null; },
        },
      };
    }

    /**
     * map_createroom（228525-228746）
     * @returns 1 = 成功建房间，0 = 100 次尝试都放不下（原版会让整张图重掷）
     */
    createRoom(mode) {
      mode = mode | 0;
      if (this.rooms.length >= 30) return 0;
      const P = [[0, 0, 0], [1, 1, 0], [2, 1, 1], [3, 2, 3], [4, 3, 0]][mode] || [0, 0, 0];
      const shape = P[0], wallMode = P[1], doorMode = P[2];
      const idx = this.rooms.length;
      let ok = 0, x = 0, y = 0, w = 0, h = 0, edgeDir = -1;

      for (let t = 0; t < 100; t++) {
        if (shape === 0) {                              // 228557-228561
          w = this.R(this.randSize) + this.margin;
          h = this.R(this.randSize) + this.margin;
          x = this.R(this.W) + 2;
          y = this.R(this.H) + 2;
        } else if (shape === 1) {                      // 228563-228567：3 的倍数对齐
          w = idiv(this.R(this.randSize) + this.margin, 3) * 3 + 5;
          h = idiv(this.R(this.randSize) + this.margin, 3) * 3 + 5;
          x = idiv(this.R(this.W), 3) * 3 + 2;
          y = idiv(this.R(this.H), 3) * 3 + 2;
        } else if (shape === 2) {                      // 228569-228592：贴边大房间
          const dir = this.R(4);
          edgeDir = dir;                              // var_1651：门开在远离地图边的那一侧
          if (dir === 3 || dir === 0) {
            x = this.R(this.W - idiv(this.margin * 3, 2) - 2) + idiv(this.margin, 2);
            w = this.R(this.margin) + idiv(this.margin, 2) + 3;
            h = this.margin;
            y = dir === 3 ? 0 : this.H - h;
          } else {
            y = this.R(this.H - idiv(this.margin * 3, 2) - 2) + idiv(this.margin, 2);
            w = this.margin;
            h = this.R(this.margin) + idiv(this.margin, 2) + 3;
            x = dir === 1 ? 0 : this.W - w;
          }
        } else if (shape === 3) {                      // 228594-228607：小正方形
          w = 3; h = 3;
          const mx = this.W - this.margin * 2 - w - 2 + 1;
          const my = this.H - this.margin * 2 - h - 2 + 1;
          if (mx < 1 || my < 1) break;
          x = this.margin + 1 + this.R(mx);
          y = this.margin + 1 + this.R(my);
        } else {                                       // 228608-228612
          w = this.R(this.randSize) + this.margin;
          h = this.R(this.randSize) + this.margin;
          x = this.R(this.W - this.randSize - 8) + 3;
          y = this.R(this.H - this.randSize - 8) + 3;
        }
        const ex = x + w - 1, ey = y + h - 1;
        if (ex >= this.W || ey >= this.H) continue;   // 228616-228621
        if (shape === 1 && (ex + 1 >= this.W || ey + 1 >= this.H)) continue;
        if (shape === 0 && this.sym(ex, ey) !== 3) continue;  // 228630-228634
        let clash = false;
        for (let j = 0; j < this.rooms.length; j++) { // 228635-228651
          const o = this.rooms[j];
          const dx = o.x - 1 - x, dy = o.y - 1 - y;
          if ((-o.w - 2 < dx && dx < w) && (-o.h - 2 < dy && dy < h)) { clash = true; break; }
        }
        if (clash) continue;
        ok = 1;
        break;
      }
      if (!ok) return 0;

      const room = { x, y, w, h, cx: x + idiv(w, 2), cy: y + idiv(h, 2) };
      this.rooms.push(room);
      // 228659-228670：两条边各 1/2 概率留「缺口」标记 var_1663(1/2)
      const gap1 = this.R(2) === 0 ? 1 + this.R(2) : 0;
      const gap2 = this.R(2) === 0 ? 1 + this.R(2) : 0;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          let s = 3;                                   // 房间内部地板
          if (wallMode !== 0 && (xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1)) {
            if (wallMode === 1) s = 1;                // 墙
            else if (wallMode === 2) s = 4;
            else if (wallMode === 3) {                // 228685-228731：带缺口 / 酒桶的墙
              s = 3;
              if (gap1 === 1 && xx === 0) s = 1;
              if (gap1 === 2 && xx === w - 1) s = 1;
              if (gap2 === 1 && yy === 0) s = 1;
              if (gap2 === 2 && yy === h - 1) s = 1;
            }
          }
          this.setSym(x + xx, y + yy, s);
        }
      }
      // 228737-228745：房间门。mode 2 沿用贴边方向 var_1651（228570），
      // 这样门一定开在房间内侧、两侧格子都在地图内。
      if (doorMode === 1) this.createRoomDoor(edgeDir >= 0 ? edgeDir : this.R(4), idx, doorMode);
      if (doorMode === 2 || doorMode === 3) {
        for (let d = 0; d < 4; d++) this.createRoomDoor(d, idx, doorMode);
      }
      return 1;
    }

    /** map_createroomdoor（228470-228523） */
    createRoomDoor(dir, idx, roomType) {
      const r = this.rooms[idx];
      if (!r) return { ok: false };
      const side = (dir === 3 || dir === 0) ? r.w : r.h;
      const cand = [];
      for (let k = 0; k < Math.max(0, side - 2); k++) cand.push(k);
      for (let i = cand.length - 1; i > 0; i--) {    // rndshuffle var_1652
        const j = this.R(i + 1);
        const t = cand[i]; cand[i] = cand[j]; cand[j] = t;
      }
      for (const k of cand) {
        let x, y, pair;
        if (dir === 3) { x = r.x + k + 1; y = r.y + r.h - 1; pair = [[0, -1], [0, 1]]; }
        else if (dir === 0) { x = r.x + k + 1; y = r.y; pair = [[0, -1], [0, 1]]; }
        else if (dir === 1) { x = r.x + r.w - 1; y = r.y + k + 1; pair = [[-1, 0], [1, 0]]; }
        else { x = r.x; y = r.y + k + 1; pair = [[-1, 0], [1, 0]]; }
        let ok = true;
        for (const [dx, dy] of pair) {
          const nx = x + dx, ny = y + dy;
          if (!this.inBounds(nx, ny) || this.sym(nx, ny) === 1) { ok = false; break; }
        }
        if (!ok) continue;
        this.setSym(x, y, 3);                        // 228517
        if (roomType !== 3) this.putDoor(x, y);     // 228518-228520
        return { ok: true, x, y };
      }
      return { ok: false };
    }

    /** cell_featset(x, y, var_1600, 21, rnd(limit(层数*3/2+1,1,300))) —— 229171 / 228519 */
    putDoor(x, y) {
      if (!this.inBounds(x, y)) return;
      const lv = (this.opt.depth | 0);
      const sub = this.R(clamp(idiv(lv * 3, 2) + 1, 1, 300));
      this.cell[y][x][6] = DOOR_TILE + DOOR_TYPE * 1000 + sub * 100000;
      this.doors.push({ x, y, sub });
    }

    /** map_placeupstairs / map_placedownstairs（228748-228776） */
    placeStairs(isUp, px, py) {
      const r = this.rooms[this.rooms.length - 1];
      let x = px, y = py;
      if (x === undefined || y === undefined) {
        if (!r) return false;
        x = this.R(Math.max(1, r.w - 2)) + r.x + 1;
        y = this.R(Math.max(1, r.h - 2)) + r.y + 1;
      }
      if (!this.inBounds(x, y)) return false;
      const pos = { x, y };
      if (isUp) {
        this.up = pos;
        this.cell[y][x][6] = this.cell[y][x][6] || (STAIRS_UP_TYPE * 1000);
      } else {
        // 228762：到最深层不再放下行楼梯（网页版仍保留坐标供 header 使用）
        if (this.opt.maxDepth > 0 && (this.opt.depth | 0) >= this.opt.maxDepth) this.noDown = true;
        this.down = pos;
        this.cell[y][x][6] = this.cell[y][x][6] || (STAIRS_DOWN_TYPE * 1000);
      }
      return true;
    }

    /**
     * map_connectroom（229080-229144）：相邻房间按随机方向各开一个口，
     * 再用 map_digtoentrance1 把两个口挖通。失败 → 整张图重掷（stat==0）。
     */
    connectRooms() {
      if (this.rooms.length < 2 || !Elona.MapDig) return 0;
      const shim = this.shim();
      for (let i = 0; i < this.rooms.length - 1; i++) {
        const tries = this.R(this.connRetries + 1) + 1;   // repeat rnd(var_1674+1)+1
        for (let n = 0; n < tries; n++) {
          let sx = -1, sy = -1, tx = -1, ty = -1;
          for (let side = 0; side < 2; side++) {
            const r = this.rooms[i + side];
            // 原版 `continue cnt` 会保留上一轮的开口坐标；这里改为重掷方向直到
            // 找到合法开口，语义相同（每个房间对都要有一个可用的门口）。
            for (let pick = 0; pick < 12; pick++) {
              const dir = this.R(4);
              const [dx, dy] = DIRS[dir];
              let x, y;
              if (dir === 1) { x = r.x; y = r.y + this.R(Math.max(1, r.h - 2)) + 1; }
              else if (dir === 2) { x = r.x + r.w - 1; y = r.y + this.R(Math.max(1, r.h - 2)) + 1; }
              else if (dir === 3) { x = r.x + this.R(Math.max(1, r.w - 2)) + 1; y = r.y; }
              else { x = r.x + this.R(Math.max(1, r.w - 2)) + 1; y = r.y + r.h - 1; }
              // 229112-229121：开口两侧已有地板则换一个方向
              if (dx !== 0 && (this.sym(x, y - 1) === 3 || this.sym(x, y + 1) === 3)) continue;
              if (dy !== 0 && (this.sym(x - 1, y) === 3 || this.sym(x + 1, y) === 3)) continue;
              const nx = x + dx, ny = y + dy;
              if (!this.inBounds(nx, ny)) continue;
              this.setSym(x, y, 3);                    // 229122 门口
              this.setSym(nx, ny, 100);               // 229128 通道起点
              if (side === 0) { sx = nx; sy = ny; } else { tx = nx; ty = ny; }
              break;
            }
          }
          if (sx < 0 || tx < 0) continue;
          const reached = Elona.MapDig.digToEntrance1(shim, sx, sy, tx, ty, 1,
            { ambush: this.ambush, featType: 22 });
          if (!reached) return 0;
        }
      }
      return 1;
    }

    /** map_makedoor（229145-229174）：房间边框上非墙的格子放闭门 */
    makeDoors() {
      let n = 0;
      for (const r of this.rooms) {
        const ring = [];
        for (let x = r.x; x < r.x + r.w; x++) { ring.push([x, r.y]); ring.push([x, r.y + r.h - 1]); }
        for (let y = r.y + 1; y < r.y + r.h - 1; y++) { ring.push([r.x, y]); ring.push([r.x + r.w - 1, y]); }
        for (const [x, y] of ring) {
          if (!this.inBounds(x, y) || this.sym(x, y) === 1) continue;
          if (this.cell[y][x][6]) continue;            // 已有门 / 楼梯，不重复写
          this.putDoor(x, y);
          n++;
        }
      }
      return n;
    }

    /** map_converttile（227391-227418），项目图块语义：地板 33 / 墙 468 */
    convert() {
      const cells = [];
      for (let y = 0; y < this.H; y++) {
        const row = [];
        for (let x = 0; x < this.W; x++) {
          const src = this.cell[y][x];
          const s = src[0] | 0;
          const tile = (s === 3 || s >= 100) ? FLOOR : WALL;
          row.push([tile, 0, tile, 0, 0, 0, src[6] | 0, 0, 0, 0]);
        }
        cells.push(row);
      }
      return {
        ok: true, layout: this.layout, width: this.W, height: this.H,
        cells, up: this.up, down: this.down,
        rooms: this.rooms.slice(), doors: this.doors.slice(),
        roomCount: this.rooms.length, mapLevel: this.mapLevel,
        noDown: this.noDown,
        header126: { 0: this.W, 1: this.H, 4: this.down ? this.down.y * 1000 + this.down.x : 0,
          5: this.up ? this.up.y * 1000 + this.up.x : 0, 10: this.mapLevel },
      };
    }

    /** 连通性校验（原版靠 stat==0 重掷；这里显式 BFS 保证网页版一定能走通） */
    connected(cells) {
      if (!this.up || !this.down) return false;
      const W = this.W, H = this.H;
      const seen = new Uint8Array(W * H);
      const q = [[this.up.x, this.up.y]];
      seen[this.up.y * W + this.up.x] = 1;
      while (q.length) {
        const [x, y] = q.shift();
        if (x === this.down.x && y === this.down.y) return true;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (seen[k] || cells[ny][nx][0] !== FLOOR) continue;
          seen[k] = 1; q.push([nx, ny]);
        }
      }
      return false;
    }

    /** *label_2417 / 2420 / 2421 / 2418 / 2419 / 2426 / 2428 / 2431 */
    runLayout(layout) {
      this.layout = layout;
      const R = this.R;
      switch (layout) {
        case 1: {                                     // 231429-231449 标准房间迷宫
          if (!this.createRoom(1)) return 0;
          this.placeStairs(true);
          if (!this.createRoom(1)) return 0;
          this.placeStairs(false);
          for (let i = 0; i < this.roomTarget; i++) this.createRoom(1);
          // 原版 stat==0 会整张重掷（230868-230870）；这里保留挖通道的结果，
          // 由 build() 的连通性校验决定重掷，避免个别通道挖不通就白扔一整张好图。
          this.connectRooms();
          this.makeDoors();
          return 1;
        }
        case 2: {                                     // 231539-231622 洞穴 + 房间
          this.randSize = 3;
          this.initialize(this.W, this.H);
          let x = idiv(this.W, 2), y = idiv(this.H, 2), dir = 0;
          this.setSym(x, y, 3);
          for (let i = 0; i < this.area; i++) {      // 231546-231579 随机游走
            if (R(2) === 0) dir = R(4);
            if (dir === 2) { x++; if (x > this.W - 2) { dir = 0; x = this.W - 2; } }
            if (dir === 1) { x--; if (x < 1) { dir = 3; x = 1; } }
            if (dir === 0) { y++; if (y > this.H - 2) { dir = 1; y = this.H - 2; } }
            if (dir === 3) { y--; if (y < 1) { dir = 2; y = 1; } }
            this.setSym(x, y, 3);
          }
          if (!this.createRoom(0)) return 0;
          this.placeStairs(true);
          if (!this.createRoom(0)) return 0;
          this.placeStairs(false);
          for (let i = 0; i < this.roomTarget; i++) this.createRoom(0);
          for (let n = 0; n < 10; n++) {             // 231593-231621 var_1735 = 10 块随机小矩形
            let ok = 0, px = 0, py = 0, rw = 0, rh = 0;
            for (let t = 0; t < 100; t++) {
              px = R(this.W); py = R(this.H);
              if (this.sym(px, py) !== 3) continue;
              rw = R(this.randSize) + this.margin;
              rh = R(this.randSize) + this.margin;
              const ix = R(rw), iy = R(rh);
              if (px > 1 && py > 1 && px + rw < this.W - 2 && py + rh < this.H - 2) {
                rw = ix; rh = iy; ok = 1; break;
              }
            }
            if (!ok) continue;
            for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) this.setSym(px + xx, py + yy, 3);
          }
          return 1;
        }
        case 3: {                                     // 231623-231646 大开间
          const W = 48 + R(20), H = 22;
          this.initialize(W, H);
          this.mapLevel = idiv(W * H, 20);
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) this.setSym(x, y, 3);
          let a = R(idiv(W, 2)) + 2, b = R(idiv(W, 2)) + idiv(W, 2) - 2;
          if (R(2) === 0) { const t = a; a = b; b = t; }
          this.placeStairs(true, a, R(H - 4) + 2);
          this.placeStairs(false, b + 1, R(H - 4) + 2);
          return 1;
        }
        case 4:                                       // 231450-231492 大房间 + 迷宫墙
        case 5: {                                     // 231493-231538 同上但地图更宽
          this.margin = 8;
          const W = layout === 5 ? 48 + R(20) : this.W;
          const H = layout === 5 ? 22 : this.H;
          this.initialize(W, H);
          this.mapLevel = idiv(W * H, layout === 5 ? 20 : 100);
          const m = this.margin - 1;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            this.setSym(x, y, (x > m && y > m && x + 1 < W - m && y + 1 < H - m) ? 100 : 1);
          }
          if (!this.createRoom(2)) return 0;
          this.placeStairs(true);
          if (!this.createRoom(2)) return 0;
          this.placeStairs(false);
          for (let i = 0; i < this.roomTarget; i++) this.createRoom(2);
          if (R(2) === 0) {
            for (let i = 0; i < idiv(this.roomTarget, 4) + 1; i++) this.createRoom(3);
          } else {
            const k = this.margin + 1 + R(3);
            for (let y = k; y < H - k; y++) for (let x = k; x < W - k; x++) this.setSym(x, y, 1);
          }
          return 1;
        }
        case 8: {                                     // 232271-232335 纵向蜿蜒通道
          const W = 30, H = 60 + R(60);
          this.initialize(W, H);
          this.mapLevel = idiv(W * H, 20);
          let width = 6, x0 = idiv(W, 2) - idiv(width, 2), gap = 0;
          for (let y = 2; y < H - 2; y++) {
            for (let k = 0; k < width; k++) this.setSym(x0 + k, y, 100);
            if (gap <= 0 && R(2)) gap = R(12);
            if (R(2) && width > 4) width -= R(2);
            if (gap > 0) {
              if (gap < 5 && width > 3) { width -= R(2); gap--; }
              if (gap > 4 && width < 10) { width++; gap--; }
            }
            if (x0 > 1) x0 -= R(2);
            if (x0 + width < W - 1) x0 += R(2);
            if (x0 + width > W) width = W - x0;
          }
          for (let t = 0; t < 5000; t++) {
            const x = R(W), y = R(15);
            if (this.sym(x, y) === 100) { this.placeStairs(true, x, y); break; }
          }
          for (let t = 0; t < 5000; t++) {
            const x = R(W), y = H - R(15) - 1;
            if (this.sym(x, y) === 100) { this.placeStairs(false, x, y); break; }
          }
          return this.up && this.down ? 1 : 0;
        }
        case 9:                                       // 232346-232356 label_2428
        case 10: {                                    // 232502-232600 label_2431
          const n = layout === 9 ? 12 : 5 + R(4), step = 2;
          const W = n * (step * 2) - step + 8;
          this.initialize(W, W);
          this.mapLevel = idiv(W * W, 12);
          this.maze(n, step, true);
          if (layout === 10) this.carveRoundRooms(50);
          return this.up && this.down ? 1 : 0;
        }
        default:
          return this.runLayout(1);
      }
    }

    /**
     * label_2430（232357-232500）：深度优先挖迷宫（回溯法）。
     * 反编译源码里 `/` 是整数除、`\` 是取余，这里按行/列语义实现。
     */
    maze(n, step, withStairs) {
      const R = this.R;
      const seen = new Array(n * n).fill(0);
      seen[0] = 7;                                    // var_1765(0) = 7
      let idx = 0;
      const dirs = [0, 1, 2, 3];
      const carve = (x, y) => { if (this.inBounds(x, y)) this.setSym(x, y, 100); };
      for (let guard = 0; guard < 200000; guard++) {
        for (let i = 3; i > 0; i--) { const j = R(i + 1); const t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t; }
        let moved = false;
        for (const d of dirs) {
          const old = idx;
          let j = idx;
          const row = idiv(j, n), col = j % n;
          if (d === 0) { if (row === 0) continue; j -= n; }
          else if (d === 1) { if (col === n - 1) continue; j += 1; }
          else if (d === 2) { if (row === n - 1) continue; j += n; }
          else { if (col === 0) continue; j -= 1; }
          // 232406-232408：目标格已访问 → 恢复移动前的下标再试下一个方向
          if (seen[j] !== 0) { idx = old; continue; }
          // 232411-232412：以「移动前」的格子为基准算通道起点
          const bx = col * step * 2 + step;
          const by = row * step * 2 + step;
          idx = j;
          if (d === 0) {
            seen[idx] = 3;
            for (let yy = 0; yy < step * 2; yy++) for (let xx = 0; xx < step - 1; xx++)
              carve(bx + xx - step + 4, by - step * 2 + yy - step + 4);
          } else if (d === 1) {
            seen[idx] = 4;
            for (let yy = 0; yy < step - 1; yy++) for (let xx = 0; xx < step * 3 - 1; xx++)
              carve(bx + xx - step + 4, by + yy - step + 4);
          } else if (d === 2) {
            seen[idx] = 1;
            for (let yy = 0; yy < step * 3 - 1; yy++) for (let xx = 0; xx < step - 1; xx++)
              carve(bx + xx - step + 4, by + yy - step + 4);
          } else {
            seen[idx] = 2;
            for (let yy = 0; yy < step - 1; yy++) for (let xx = 0; xx < step * 2; xx++)
              carve(bx + xx - step * 2 - step + 4, by + yy - step + 4);
          }
          moved = true;
          break;
        }
        if (moved) continue;
        if (seen[idx] === 7) break;                  // 232459-232460 回到起点
        const back = seen[idx];
        if (back === 1) idx -= n;
        else if (back === 2) idx += 1;
        else if (back === 3) idx += n;
        else if (back === 4) idx -= 1;
        else break;
      }
      if (!withStairs) return;
      // 232481-232500：两个相距 >= 10 的地板格分别作为上行 / 下行楼梯
      let up = null, down = null;
      for (let t = 0; t < 4000 && !down; t++) {
        const x = R(this.W), y = R(this.H);
        if (this.sym(x, y) !== 100) continue;
        if (!up) { up = { x, y }; continue; }
        const dist = Math.sqrt((x - up.x) ** 2 + (y - up.y) ** 2);
        if (dist < 10 && t < 1000) continue;
        down = { x, y };
      }
      if (up && down) { this.placeStairs(true, up.x, up.y); this.placeStairs(false, down.x, down.y); }
    }

    /**
     * label_2431 232508-232604：迷宫里再挖 50 个圆形空地。
     * 源码对每格检查八个邻格必须为「未挖 0 / 原通道 100 / 本房间标记 var_1773」，
     * 全部满足才写 var_1773 = 101 + 房间序号（convert 时 >=100 即为地板）。
     */
    carveRoundRooms(count) {
      const R = this.R;
      const NB = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (let n = 0; n < count; n++) {
        let cx = 0, cy = 0, radius = 0, found = false;
        for (let t = 0; t < 200; t++) {
          cx = R(this.W); cy = R(this.H);
          if (this.sym(cx, cy) === 100) { radius = 10 + R(4); found = true; break; }
        }
        if (!found) continue;
        const tag = 101 + n;
        const half = idiv(radius, 2);
        for (let y = cy - half; y <= cy + half; y++) {
          for (let x = cx - half; x <= cx + half; x++) {
            if (x < 1 || y < 1 || x >= this.W - 1 || y >= this.H - 1) continue;
            if (Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) >= half) continue;
            let ok = true;
            for (const [dx, dy] of NB) {
              const s = this.sym(x + dx, y + dy);
              if (s !== 0 && s !== 100 && s !== tag) { ok = false; break; }
            }
            if (ok) this.setSym(x, y, tag);
          }
        }
      }
    }
  }

  /**
   * 生成一张随机地城。原版生成失败会 `goto *label_2413` 整张重掷（230868-230870），
   * 这里同样重试；额外做一次连通性校验，避免网页版出现走不到楼梯的死图。
   * @returns {object|null} convert() 的结果，或 null（调用方需兜底）
   */
  function build(g, opt) {
    opt = opt || {};
    const R = (n) => rngOf(g).rnd(Math.max(1, n | 0));
    for (let attempt = 0; attempt < 16; attempt++) {
      const W = 34 + R(15), H = 22 + R(15);         // 230575-230576
      const layout = layoutOf(opt.kind, R, opt);
      const b = new Builder(g, opt);
      b.initialize(W, H);
      if (!b.runLayout(layout)) continue;
      const out = b.convert();
      if (!b.connected(out.cells)) continue;
      if (!b.up || !b.down) continue;
      return out;
    }
    return null;
  }

  Elona.MapMake = { build, layoutOf, Builder, FLOOR, WALL, DIRS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.MapMake;
})(typeof window !== 'undefined' ? window : global);
