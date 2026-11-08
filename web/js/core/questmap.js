'use strict';
/**
 * 委托专用地图 —— 对应原版地图 13（var_65(64)=13，*label_2413）
 *
 * 【源码依据】
 *   接受委托：425158-425162 `var_65(70)=type ; var_65(66)=当前地图/层/坐标 ;
 *                                var_65(64)=13 ; var_65(65)=1 ; var_1777=2`
 *   地图生成：*label_2413（230571-231098）按 var_65(70) 分派：
 *     1001 HUNT    → 28~33 × 20~25 的怪物地图（var_1736=6 → *label_2414）
 *     1008/1010    → *label_2423：以原城镇地图为底图放置目标怪物
 *     1006 HARVEST → *label_2416：农田地图 + 作物 + 納入箱(item 560) + 120 时间
 *     1009 PARTY   → *label_2422：派对会场 + 客人 + 60 时间
 *     1013 TRAP    → *label_2415：陷阱地带 + 大量陷阱 + 500 时间
 *     1007 ESCORT  → 普通地图；委托人跟随，抵达目的地触发 evadd 16
 *
 * 【本实现的近似】
 *   - 原版地图由 map_initialize/map_createroom 等 BMP 图块生成器构造；这里用
 *     与 generateDungeon 相同的矩形房间/走廊表示，图块 33=地板、468=墙、9/10=草地。
 *   - 收获不再需要把作物放进納入箱，而是在地图内拾取作物即累计重量
 *     （原版 var_99(21)=4 的作物 + 納入箱 item 560）。
 *   - 派对的分数来源原版包含料理/饮料/表演等；这里简化为与客人交谈得分。
 *   - 陷阱在原版需要「解除陷阱」技能；这里同时允许踩掉会消失的陷阱来推进度，
 *     避免低等级角色完全无法完成。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const R = (g, n) => (((g && g.rng) || Elona.rng)).rnd(n);

  const FLOOR = 33, WALL = 468, GRASS = 9, DIRT = 10;
  const FOOD_IDS = [233, 571, 573];

  function mk(id) { return [id, 0, id, 0, 0, 0, 0, 0, 0, 0]; }

  function blank(W, H, fill) {
    const cells = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) row.push(mk(fill));
      cells.push(row);
    }
    return cells;
  }

  function carve(cells, x, y, w, h, id) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (cells[yy] && cells[yy][xx]) cells[yy][xx] = mk(id);
      }
    }
  }

  /** 中央大厅 + 少量随机墙柱；返回入口/出口 */
  /**
   * 生成一片「开阔场地」。
   *   原版委托地图（*label_2414 / 2415 / 2416）都是 `map_initialize` 后整片铺
   *   **可通行地面**（var_1618 / var_1619），再随机撒少量装饰，没有围墙。
   *   ※ 0-FC 初版用 WALL(468) 做外框，玩家走不到地图边缘，也就无法按原版
   *   （343336-343419「走到地图边缘 → 离开」）离开委托，故改为整片可走 + 稀疏障碍。
   */
  function arena(g, W, H, floorId, obstacleRate) {
    const cells = blank(W, H, floorId);
    const n = Math.floor(W * H * (obstacleRate || 0.04));
    for (let i = 0; i < n; i++) {
      const x = 1 + R(g, Math.max(1, W - 2));
      const y = 1 + R(g, Math.max(1, H - 2));
      cells[y][x] = mk(WALL);
    }
    const entry = { x: 2, y: 2 };
    const exit = { x: W - 3, y: H - 3 };
    cells[entry.y][entry.x] = mk(floorId);
    cells[exit.y][exit.x] = mk(floorId);
    return { cells, entry, exit };
  }

  function floorCells(cells) {
    const out = [];
    for (let y = 1; y < cells.length - 1; y++) {
      for (let x = 1; x < cells[y].length - 1; x++) {
        if (cells[y][x][0] !== WALL) out.push({ x, y });
      }
    }
    return out;
  }

  function pickSpots(g, list, n, avoid) {
    const out = [];
    const used = new Set();
    if (avoid) for (const a of avoid) used.add(a.x + ',' + a.y);
    for (let t = 0; t < n * 40 && out.length < n; t++) {
      const p = list[R(g, list.length)];
      const k = p.x + ',' + p.y;
      if (used.has(k)) continue;
      used.add(k);
      out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  function headerFor(W, H, entry, exit) {
    const header = new Array(100).fill(0);
    header[0] = W; header[1] = H; header[2] = 1;
    if (entry) header[5] = entry.y * 1000 + entry.x;
    if (exit) header[4] = exit.y * 1000 + exit.x;
    return header;
  }

  function monsterId(g, level) {
    try { return Elona.CharaFactory.pick(g, Math.max(1, level | 0), {}) | 0; }
    catch (_) { return 0; }
  }

  // ---------------------------------------------------------------------------
  // 各类型地图
  // ---------------------------------------------------------------------------
  /**
   * 1001 街道清扫 / 怪物猎杀 —— 原版 `*label_2414`（231099-231132）。
   *
   * 【源码依据】
   *   230805-230810：`var_126(12)=300`（地图类型）、`var_126(0)=28+rnd(6)`、
   *                  `var_126(1)=20+rnd(6)`、`var_1736=6` → 走 *label_2414。
   *   231100-231111：全图填 tile 3（墙），随机 `rnd(W*H/30)` 格改成 tile 1（地板）。
   *   231117-231125：放 **10 + rnd(6)** 只随机怪（characreate -1, 0 = 不指定种）。
   *   231126-231131：撒 **10 + rnd(10)** 个 80000 类地面物品（var_99(21)=1）。
   *
   * 【与 1010 的区别】
   *   1001 是**程序生成的独立地图**；1010「城镇剿灭」是**城镇底图**（见 buildTown）。
   */
  function buildHunt(g, q) {
    const W = 28 + R(g, 6), H = 20 + R(g, 6);
    // 231100-231111：全图铺符号 3（map_tileset(300) 下 → 可通行的岩地），
    //   再随机把 W*H/30 格改成符号 1（var_1619 = 砖墙，阻挡）。
    //   符号方向容易搞反：3 是**地面**、1 才是**障碍**。
    const cells = blank(W, H, FLOOR);
    const wallCount = R(g, Math.max(1, Math.floor(W * H / 30)));
    for (let i = 0; i < wallCount; i++) {
      // 边界一圈不放障碍：保证玩家总能走到地图边缘离图（343336-343419）
      const x = 1 + R(g, Math.max(1, W - 2));
      const y = 1 + R(g, Math.max(1, H - 2));
      if (!cells[y] || !cells[y][x]) continue;
      cells[y][x] = mk(WALL);
    }
    // 落点与出口：必须是可通行格
    const list = floorCells(cells);
    const entry = list[R(g, list.length)] || { x: 2, y: 2 };
    const exit = list[R(g, list.length)] || { x: 2, y: 2 };
    cells[entry.y][entry.x] = mk(FLOOR);
    cells[exit.y][exit.x] = mk(FLOOR);

    // 231118-231125：10 + rnd(6) 只随机怪
    const monsters = [];
    const n = 10 + R(g, 6);
    for (let i = 0; i < n; i++) {
      const id = monsterId(g, q.difficulty || 1);
      if (!id) continue;
      monsters.push({ id, level: Math.max(1, q.difficulty | 0), x: 0, y: 0 });
    }
    // 231126-231131：10 + rnd(10) 个 80000 类物品
    const items = [];
    const itemN = 10 + R(g, 10);
    for (let i = 0; i < itemN; i++) items.push({ t638: 80000, x: 0, y: 0 });

    return {
      json: { name: '战场', width: W, height: H, tileset: 1, header: headerFor(W, H, entry, exit), cells, objects: [] },
      entry, exit, monsters, npcs: [], items, traps: [],
    };
  }

  function buildBoss(g, q) {
    const W = 32, H = 24;
    const a = arena(g, W, H, FLOOR, 0.03);
    const list = floorCells(a.cells).filter((p) => Math.abs(p.x - a.entry.x) + Math.abs(p.y - a.entry.y) > 12);
    const spot = (list.length ? list[R(g, list.length)] : a.exit);
    const bossId = q.targetCreature || monsterId(g, q.difficulty || 1);
    const monsters = [];
    if (bossId) {
      monsters.push({ id: bossId, level: Math.max(1, q.difficulty | 0), x: spot.x, y: spot.y });
    }
    const es = pickSpots(g, floorCells(a.cells), q.type === 1010 ? Math.max(1, q.need || 3) : 0,
      [a.entry, spot]);
    if (q.type === 1010) {
      for (const s of es) {
        if (bossId) monsters.push({ id: bossId, level: Math.max(1, idiv((q.difficulty | 0) * 3, 2)), x: s.x, y: s.y });
      }
    }
    return {
      json: { name: '讨伐地', width: W, height: H, tileset: 1, header: headerFor(W, H, a.entry, a.exit), cells: a.cells, objects: [] },
      entry: a.entry, exit: a.exit, monsters, npcs: [], items: [], traps: [],
    };
  }

  /**
   * 1006 协助收获 —— 原版 `*label_2416`（231294-231428）。
   *   231295 `var_65(84) = 120`（限时 120 分钟）、231297 `var_126(14) = 2`（室外）、
   *   231302 `var_126(12) = 4`（城镇 33 用 13）、231304-231305
   *   `var_126(0) = 58 + rnd(16)`、`var_126(1) = 50 + rnd(16)`。
   *   231313 地图名「街周辺の畑 / Farmland」。
   */
  function buildFarm(g, q) {
    const W = 58 + R(g, 16), H = 50 + R(g, 16);
    const cells = blank(W, H, GRASS);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) cells[y][x] = mk(R(g, 5) === 0 ? DIRT : GRASS);
    }
    const entry = { x: 2, y: 2 };
    const exit = { x: W - 3, y: H - 3 };
    const list = floorCells(cells);
    const items = [];
    // 作物：原版 30 块田；这里按目标重量铺足（含堆叠），保证可达标
    const stack = 1 + Math.min(4, Math.floor((q.targetData | 0) / 50000));
    let totalWeight = 0;
    for (let i = 0; i < 300 && totalWeight < (q.targetData | 0) * 1.2; i++) {
      const p = list[R(g, list.length)];
      const id = FOOD_IDS[R(g, FOOD_IDS.length)];
      if (!Elona.ItemDB) break;
      const it = Elona.ItemDB.createItem(id, stack);
      if (!it) continue;
      it.f[5] = p.x; it.f[6] = p.y;
      it.f[21] = 4;                       // 原版「未收获作物」标记
      totalWeight += (it.f[7] | 0) * (it.f[0] | 0);
      items.push(it);
    }
    // 少量随机怪物（原版 30 只）
    const monsters = [];
    const spots = pickSpots(g, list, 12, [entry, exit]);
    for (const s of spots) {
      const id = monsterId(g, Math.max(1, q.difficulty | 0));
      if (id) monsters.push({ id, level: Math.max(1, q.difficulty | 0), x: s.x, y: s.y });
    }
    return {
      json: { name: '农田', width: W, height: H, tileset: 1, header: headerFor(W, H, entry, exit), cells, objects: [] },
      entry, exit, monsters, npcs: [], items, traps: [], turns: 120,
    };
  }

  // -------------------------------------------------------------------------
  // 1009 PARTY —— *label_2422（231647-232128，482 行）
  // -------------------------------------------------------------------------
  // tileset 11（map_tileset 11，227495-227501）：
  //   var_1618=465（外周）/ var_1471=212（大厅地毯）/ var_1619=467（墙）/ var_1620=203（房间木地板）
  const PARTY_TILE = { OUT: 465, CARPET: 212, WOOD: 203, WALL: 467 };
  // 231751-231760：客人分档表 var_484(rnd(3), 档)（档 0 = 乞食/老人 … 档 9 = 船长/情报屋）
  const PARTY_GUESTS = [
    [171, 9, 36], [269, 273, 35], [269, 174, 8], [174, 16, 239], [16, 185, 41],
    [185, 274, 184], [274, 272, 70], [272, 38, 1], [38, 206, 72], [206, 73, 69],
  ];
  const PARTY_ROOM_ITEMS = [88, 313, 156, 606];       // 钢琴/赌桌/长桌/烤肉架
  const PARTY_TRASH = [217, 218, 216, 215, 215, 152, 152, 91, 189];   // 231827
  const PARTY_BAR = [296, 300, 312, 604];             // 228697：门口的酒

  function buildParty(g, q) {
    const W = 38, H = 28;                             // 231654-231655 var_126(0)/(1)
    const items = [];
    const used = new Set();                           // var_704(x,y,4) 的近似：已放物品的格子
    const put = (id, x, y) => {
      if (!Elona.ItemDB) return null;
      const it = Elona.ItemDB.createItem(id, 1);
      if (!it) return null;
      it.f[5] = x; it.f[6] = y;
      it.f[21] = 1;                                   // 232122-232127：var_99(21) = 1
      items.push(it);
      used.add(x + ',' + y);
      return it;
    };

    // 231656-231667：map_initialize → 外圈留 0，其余全铺 100（converttile 后 = 212 地毯）
    const cells = blank(W, H, 0);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) cells[y][x] = mk(100);
    }

    // 231668-231670：map_createroom 4 × 80（227526：最多 30 间；var_1657 = 4 → 边长 rnd(4)+5）
    const rooms = [];
    for (let t = 0; t < 80 && rooms.length < 30; t++) {
      const w = R(g, 4) + 5, h = R(g, 4) + 5;
      const x0 = R(g, Math.max(1, W - 4 - 8)) + 3;    // 228611
      const y0 = R(g, Math.max(1, H - 4 - 8)) + 3;    // 228612
      if (x0 + w - 1 >= W || y0 + h - 1 >= H) continue;
      let hit = false;                                // 228636-228650：不与已有房间重叠
      for (const r of rooms) {
        const dx = r.x - 1 - x0, dy = r.y - 1 - y0;
        if (-r.w - 2 < dx && dx < w && -r.h - 2 < dy && dy < h) { hit = true; break; }
      }
      if (hit) continue;
      rooms.push({ x: x0, y: y0, w, h });
      // 228659-228670：门口样式（两侧墙 / 门口 + 酒瓶）
      const d1 = (R(g, 2) === 0) ? 1 + R(g, 2) : 0;
      const d2 = (R(g, 2) === 0) ? 1 + R(g, 2) : 0;
      const lastX = w - 1, lastY = h - 1;
      for (let ry = 0; ry < h; ry++) {
        for (let rx = 0; rx < w; rx++) {
          let tile = 3;                               // → 203 木地板
          const edge = rx === 0 || ry === 0 || rx === lastX || ry === lastY;
          if (edge) {
            if (d1 === 1 && rx === 0) tile = 1;       // 228687-228691：整面左墙
            if (d2 === 1 && ry === 0 && rx !== 0 && rx !== lastX) {
              tile = 1;                               // 228692-228708：上墙 + 门口摆酒
              if (R(g, 3)) put(PARTY_BAR[R(g, 4)], x0 + rx, y0 + ry + 1);
              else if (rx % 2 === 1) put(584, x0 + rx, y0 + ry + 1);
            }
            if (d1 === 2 && rx === lastX) tile = 1;   // 228710-228713：整面右墙
            if (d2 === 2 && ry === lastY) {
              tile = 1;                               // 228715-228730：下墙 + 门口摆酒
              if (R(g, 3)) put(PARTY_BAR[R(g, 4)], x0 + rx, y0 + ry + 1);
              else if (rx % 2 === 1) put(584, x0 + rx, y0 + ry + 1);
            }
          }
          cells[y0 + ry][x0 + rx] = mk(tile);
        }
      }
    }

    // 231671：map_converttile（tileset 11 的四条映射都是单值，无扰动）
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = cells[y][x][0];
        cells[y][x] = mk(t === 0 ? PARTY_TILE.OUT
          : t === 100 ? PARTY_TILE.CARPET
            : t === 1 ? PARTY_TILE.WALL
              : t === 3 ? PARTY_TILE.WOOD : t);
      }
    }

    // 231672-231750：500 次 4×4 扫描 → 宴会桌 / 长桌 / 现代桌椅
    const free4 = (x0, y0, tile) => {
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          if (cells[y0 + dy][x0 + dx][0] !== tile) return false;
          if (used.has((x0 + dx) + ',' + (y0 + dy))) return false;   // var_704(...,4) != 0
        }
      }
      return true;
    };
    for (let t = 0; t < 500; t++) {
      const x0 = R(g, W - 5), y0 = R(g, H - 5);
      if (free4(x0, y0, PARTY_TILE.CARPET)) {         // 地毯上：宴席装饰
        const kind = R(g, 5);
        if (kind < 2) {                               // 231695-231698：2×2 宴会桌
          for (let dy = 1; dy <= 2; dy++) {
            for (let dx = 1; dx <= 2; dx++) cells[y0 + dy][x0 + dx] = mk(473);
          }
        } else if (kind === 2) {                      // 231700-231712：3×3 长桌 + 桶
          for (let dy = 0; dy <= 2; dy++) {
            for (let dx = 0; dx <= 2; dx++) {
              if (dx === 1 && dy === 1) cells[y0 + 1][x0 + 1] = mk(664);
              else {
                cells[y0 + dy][x0 + dx] = mk(206);
                put(91, x0 + dx, y0 + dy);
              }
            }
          }
        } else if (kind === 3) {                      // 231713-231719：椅子 + 灯
          cells[y0 + 1][x0 + 1] = mk(204);
          put(585, x0 + 1, y0 + 1);
        } else {                                      // 231720-231726：台座 + 雕像
          cells[y0 + 1][x0 + 1] = mk(69);
          put(138, x0 + 1, y0 + 1);
        }
      }
      if (free4(x0, y0, PARTY_TILE.WOOD)) {           // 231730-231748：木地板 → 现代桌椅
        put(83, x0 + 1, y0 + 1);
        if (R(g, 2)) put(92, x0 + 1, y0);
        if (R(g, 2)) put(92, x0 + 1, y0 + 2);
        if (R(g, 2)) put(92, x0, y0 + 1);
        if (R(g, 2)) put(92, x0 + 2, y0 + 1);
      }
    }

    // 231761-231810：每个房间 → 道具 + 按难度分档的客人
    const npcs = [];
    for (const r of rooms) {
      const iw = Math.max(1, r.w - 2), ih = Math.max(1, r.h - 2);
      const area = iw * ih;                           // var_1745
      // 231767：档 = limit(rnd(难度/3 + 3), 0, 9)
      const tier = Math.min(9, Math.max(0, R(g, Math.floor((q.difficulty | 0) / 3) + 3)));
      const spot = () => ({ x: r.x + 1 + R(g, iw), y: r.y + 1 + R(g, ih) });
      for (const id of PARTY_ROOM_ITEMS) {          // 231768-231799：钢琴/赌桌/长桌/烤肉架
        if (R(g, (id === 313 || id === 606) ? 3 : 2) === 0) {
          const s = spot(); put(id, s.x, s.y);
        }
      }
      const n = R(g, Math.floor(area / 5) + 2) + Math.floor(area / 5) + 3;   // 231800
      for (let i = 0; i < n; i++) {
        const s = spot();
        const lv = tier * 7 + R(g, 5);                // 231802 var_1023
        npcs.push({
          id: PARTY_GUESTS[tier][R(g, 3)],            // 231803
          level: Math.max(1, lv),
          x: s.x, y: s.y, role: 3, guest: true,
          gold: lv * (20 + R(g, 20)),                 // 231808 var_58(30)
        });
      }
    }

    // 231811-231814：底部舞台（x 17..20, y 27）
    for (let x = 17; x <= 20; x++) cells[27][x] = mk(144);

    // 231816-231818：玩家落点（rnd(W/3)+W/3, rnd(H/3)+H/3），吸附到可走的格子
    const walkable = (x, y) => {
      const t = cells[y] && cells[y][x] ? cells[y][x][0] : -1;
      return t === PARTY_TILE.CARPET || t === PARTY_TILE.WOOD || t === PARTY_TILE.OUT;
    };
    let entry = {
      x: Math.floor(W / 3) + R(g, Math.floor(W / 3)),
      y: Math.floor(H / 3) + R(g, Math.floor(H / 3)),
    };
    if (!walkable(entry.x, entry.y)) {
      outer:
      for (let rad = 1; rad < W; rad++) {
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dx = -rad; dx <= rad; dx++) {
            const x = entry.x + dx, y = entry.y + dy;
            if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
            if (walkable(x, y)) { entry = { x, y }; break outer; }
          }
        }
      }
    }
    const exit = { x: entry.x, y: entry.y };

    // 231820-231829：25+rnd(10) 件杂物
    const floors = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const t = cells[y][x][0];
        if ((t === PARTY_TILE.CARPET || t === PARTY_TILE.WOOD) && !used.has(x + ',' + y)) {
          floors.push({ x, y });
        }
      }
    }
    const trashN = 25 + R(g, 10);
    for (let i = 0; i < trashN && floors.length; i++) {
      const p = floors[R(g, floors.length)];
      put(PARTY_TRASH[R(g, 9)], p.x, p.y);
    }

    // 231830-232121：按会场模板（var_65(850)）与主线进度（var_65(252)）的固定嘉宾
    //   模板取不到原始值，近似：Palmia(15) 用 44（皇女西尔维娅等），其余城市用 4。
    const story = g.getV65 ? (g.getV65(252) | 0) : 0;
    const template = ((q.mapId | 0) === 15) ? 44 : 4;
    // characreate -3 = 自动找空位：在大厅地板里随机挑一格
    const addFixed = (id, lv) => {
      const p = floors.length ? floors[R(g, floors.length)] : entry;
      npcs.push({ id, level: Math.max(1, lv || 1), x: p.x, y: p.y, role: 3, guest: true, fixed: true });
    };
    if (template === 4) {
      addFixed(story < 225 ? (R(g, 5) === 0 ? 28 : 29) : 29);        // 231830-231853
      addFixed(231); addFixed(31); addFixed(247);                    // 231855-231868
      const k = R(g, 4);                                             // 231869-231912
      if (k === 0) { addFixed(900); addFixed(902); }
      else if (k === 1) { addFixed(899); addFixed(896); }
      else if (k === 2) { addFixed(898); addFixed(519); }
      else addFixed(897);
      for (const id of [223, 252, 322, 33, 34]) if (R(g, 5) === 0) addFixed(id);
      if (story >= 440 && R(g, 10) === 0) addFixed(654);             // 231949-231957
    } else {
      if (story >= 225 && story < 355) {                             // 231960-231984
        if (R(g, 3) === 0) addFixed(790);
        else if (R(g, 3) === 0) addFixed(33);
        else addFixed(34);
      }
      if (story >= 355 && story < 365) {                             // 231985-232000
        if (R(g, 2) === 0) addFixed(33); else addFixed(34);
      }
      if (story >= 365 && story < 725) {                             // 232001-232027
        if (R(g, 3) === 0) addFixed(790, 178);
        else if (R(g, 3) === 0) addFixed(33);
        else addFixed(34);
      }
      if (story >= 725) {                                            // 232028-232054
        if (R(g, 3) === 0) addFixed(790, 200);
        else if (R(g, 3) === 0) addFixed(33);
        else addFixed(34);
      }
      addFixed(445); addFixed(374); addFixed(893);                   // 232055-232069
      if ((g.getV65 ? (g.getV65(250 + 244) | 0) : 0) === 1001) addFixed(495);   // 232070
      for (const id of [381, 367, 351, 352, 449]) if (R(g, 5) === 0) addFixed(id);
      if (story >= 440 && R(g, 5) === 0) addFixed(711);              // 232112-232120
    }

    return {
      json: { name: '派对会场', width: W, height: H, tileset: 11,
        header: headerFor(W, H, entry, exit), cells, objects: [] },
      entry, exit, monsters: [], npcs, items, traps: [], turns: 60,   // 231648 var_65(84)=60
    };
  }

  /**
   * 1013 拆除陷阱 —— 原版 `*label_2415`（231134-231293）。
   *   231135 `var_65(84) = 500`（限时 500 分钟）、231137 `var_126(14) = 2`（室外）、
   *   231143-231148 `var_126(12) = 19/20`（近町 / 地雷原）、231139-231141 城镇 33 用 13。
   *   231150-231151 `var_126(0) = 65 + rnd(16)`、`var_126(1) = 50 + rnd(16)`。
   */
  function buildTrap(g, q) {
    const W = 65 + R(g, 16), H = 50 + R(g, 16);
    const a = arena(g, W, H, GRASS, 0.03);
    const list = floorCells(a.cells);
    const subs = [7, 9, 15, 16, 23, 24, 25, 26, 27, 28];
    const traps = [];
    const count = Math.max(20, (q.targetData | 0) + 10);
    const spots = pickSpots(g, list, count, [a.entry, a.exit]);
    for (const s of spots) {
      traps.push({ x: s.x, y: s.y, sub: subs[R(g, subs.length)] });
    }
    return {
      json: { name: '陷阱地带', width: W, height: H, tileset: 1, header: headerFor(W, H, a.entry, a.exit), cells: a.cells, objects: [] },
      entry: a.entry, exit: a.exit, monsters: [], npcs: [], items: [], traps, turns: 500,
    };
  }

  const BUILDERS = {
    // 0-FC：按源码 230804-230831 的分派表
    //   1001 → var_1736=6 → *label_2414（独立生成的怪物地图）
    //   1006 → *label_2416（农田）
    //   1009 → *label_2422（派对会场）
    //   1013 → *label_2415（陷阱地带）
    //   1008 / 1010 → *label_2423（城镇底图，只有怪物没有 NPC）—— 见 buildTown
    1001: buildHunt, 1008: buildBoss, 1010: buildBoss,
    1006: buildFarm, 1009: buildParty, 1013: buildTrap,
  };

  /**
   * 城镇剿灭 / 城镇讨伐 —— 原版 `*label_2423`（232129-232180）。
   *
   * 【源码依据】
   *   232132 `map_initcustom mapfile(var_65(66))` —— **直接加载委托人所在城镇的原地图**，
   *   不是程序生成的新地图。地图名 var_494(0) = 「市街地 / Urban Area」。
   *   232135 `var_65(26) = 5`（从外部进入）、232136 `map_placeplayer`。
   *   232138-232148（1008 城镇讨伐）：放 **1 只**目标怪，
   *       等级 = var_434(5)（委托难度），品质 var_641 = 5，限时 60*6 = 360 分钟。
   *   232149-232159（1010 城镇剿灭）：放 **6 + rnd(4) 只**同种怪，
   *       等级 = var_434(5) * 3 / 2，品质 var_641 = 1，var_58(197) = 10。
   *   232173-232179：清空全图 feat（var_704(x,y,6) = 0）—— 没有门、陷阱、楼梯。
   *
   * 【为什么「只有怪物没有 NPC」是自然成立的】
   *   原版的城镇 NPC 由 populateTown 单独生成到角色槽；`map_initcustom` 只读地图文件，
   *   本身不生成任何 NPC。本项目的 `Game.loadMap` 同样只载入地形与物件、不生成 NPC
   *   （见 game.js loadMap 与 populateTown 的分工），所以只要不调用 populateTown，
   *   进入的就是「城镇布局 + 零 NPC + 委托怪物」。
   *
   * @param {object} g 游戏实例
   * @param {object} q 委托
   * @param {object} townMap 已载入的城镇地图 JSON（{ width, height, tileset, header, cells, objects }）
   * @returns {object} 与其它 builder 同构的地图描述
   */
  function buildTown(g, q, townMap) {
    const W = townMap.width | 0, H = townMap.height | 0;
    const cells = (townMap.cells || []).map((row) => row.map((c) => c.slice()));
    const header = (townMap.header || new Array(100).fill(0)).slice();
    header[0] = W; header[1] = H;
    header[2] = townMap.tileset | 0;
    header[10] = 0;               // 232130：var_126(10) = 0（无最深层概念）
    header[14] = 2;               // 232131：var_126(14) = 2（室外）

    // 清空全图 feat（232173-232179）
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (cells[y] && cells[y][x]) cells[y][x][6] = 0;
      }
    }

    // 玩家落点：map_placeplayer 的默认行为（地图入口坐标 header[5]）
    //   城镇地图的 header[5] 多数为 0（无预置入口），此时落在地图中央。
    const ph = header[5] | 0;
    let entry = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
    if (ph) {
      const ex = ph % 1000, ey = idiv(ph, 1000);
      if (ex > 0 && ey > 0 && ex < W && ey < H) entry = { x: ex, y: ey };
    }

    // 可站立的空地（放怪 + 玩家落点用）
    //   城镇地图中央可能是墙或建筑，因此按通行属性（attr(7,tile)&4 = 阻挡）筛选。
    const free = [];
    const walkable = (x, y) => {
      const c = cells[y] && cells[y][x];
      if (!c) return false;
      const attrs = (g && g.tileAttrs && g.tileAttrs[String(townMap.tileset | 0)]) || null;
      if (!attrs) return true;
      const a = attrs[String(c[0] | 0)] || [];
      return !((a[7] | 0) & 4);
    };
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!walkable(x, y)) continue;
        if (Math.abs(x - entry.x) + Math.abs(y - entry.y) <= 4) continue;
        free.push({ x, y });
      }
    }
    // 玩家落点改成最近的可站立点
    if (!walkable(entry.x, entry.y) && free.length) {
      const s = free[R(g, free.length)];
      entry = { x: s.x, y: s.y };
    }

    const monsters = [];
    const targetId = q.targetCreature || 0;
    const diff = Math.max(1, q.difficulty | 0);
    if (q.type === 1008) {
      // 232141-232147：1 只目标怪，品质 5
      if (targetId && free.length) {
        const s = free[R(g, free.length)];
        monsters.push({ id: targetId, level: diff, x: s.x, y: s.y, fix: 5 });
      }
    } else if (q.type === 1010) {
      // 232149-232158：6 + rnd(4) 只同种怪，等级 = 难度*3/2，品质 1
      const n = 6 + R(g, 4);
      const lvl = idiv(diff * 3, 2);
      for (let i = 0; i < n; i++) {
        if (!targetId || !free.length) break;
        const s = free[R(g, free.length)];
        monsters.push({ id: targetId, level: lvl, x: s.x, y: s.y, fix: 1 });
      }
    }

    // 出口：入口处放上楼梯（返回城镇）
    const exit = { x: entry.x, y: entry.y };
    return {
      json: { name: '市街地', width: W, height: H, tileset: townMap.tileset | 0, header, cells, objects: townMap.objects || [] },
      entry, exit, monsters, npcs: [], items: [], traps: [],
      // 1008 限时 360 分钟（232139）；1010 不限时
      turns: q.type === 1008 ? 360 : 0,
      townMap: true,
    };
  }

  function build(g, q) {
    const fn = BUILDERS[q.type];
    return fn ? fn(g, q) : null;
  }

  // ---------------------------------------------------------------------------
  // 派对得分（calcpartyscore 216749-216787 / calcpartyscore2 216788-216816）
  // ---------------------------------------------------------------------------
  /**
   * 从宾客全表**重算**派对得分（原版不是累加，是每次全量重算后写回 var_434(13)）。
   *   宾客 = index ≥ 16（原版槽位 57..244）：
   *     · 兴奋度 var_58(17) ≥ 53 → 名人（cbit 23/27/964）加 limit((等级+1)/5+1, 1, 20)，
   *       普通客人加 等级 + 5
   *     · 兴奋度 < 50 → 扣 20
   * @returns {{score:number, prev:number, delta:number}}
   */
  function partyScore(g) {
    const q = activeQuest(g);
    if (!q || (q.type | 0) !== 1009) return { score: 0, prev: 0, delta: 0 };
    const ST = Elona.Status;
    let score = 0;
    const n = Math.min((g.charas ? g.charas.length : 0), 245);
    for (let i = 16; i < n; i++) {
      const c = g.charas[i];
      if (!c || (c.get(0) | 0) !== 1) continue;                 // 216752
      if (ST && ST.cbit && ST.cbit(c, 992) === 1) continue;     // 216755
      const imp = c.get(17) | 0;
      const lv = c.get(38) | 0;
      if (imp >= 53) {                                          // 216758
        const special = ST && ST.cbit
          && (ST.cbit(c, 23) === 1 || ST.cbit(c, 27) === 1 || ST.cbit(c, 964) === 1);
        score += special ? Math.min(20, Math.max(1, idiv(lv + 1, 5) + 1)) : lv + 5;
      }
      if (imp < 50) score -= 20;                                // 216766-216768
    }
    const prev = q.progress | 0;                                // var_434(13)
    q.progress = score;                                         // 216786
    return { score, prev, delta: score - prev };
  }

  /**
   * calcpartyscore2（216788-216816）：高品质宾客的「满足」加成。
   *   兴奋度 ≥ 53 且品质（var_58(25)）≥ 4 → 加成 += 20 + 等级/3；
   *   总分 = 总分 × (100 + 加成) / 100。
   */
  function partyScore2(g) {
    const q = activeQuest(g);
    if (!q || (q.type | 0) !== 1009) return { bonus: 0, satisfied: [], score: q ? (q.progress | 0) : 0 };
    const base = q.progress | 0;
    let bonus = 0;
    const satisfied = [];
    const n = Math.min((g.charas ? g.charas.length : 0), 245);
    for (let i = 16; i < n; i++) {
      const c = g.charas[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(17) | 0) < 53) continue;
      if ((c.get(25) | 0) < 4) continue;                        // 216798：品质 ≥ 4
      bonus += 20 + idiv(c.get(38) | 0, 3);                     // 216799
      satisfied.push(c.name || ('#' + c.index));
    }
    if (bonus !== 0) q.progress = idiv(base * (100 + bonus), 100);   // 216815
    return { bonus, satisfied, score: q.progress | 0 };
  }

  /**
   * 派对结束（事件 14，606768-606797）：重算最终得分并判定。
   *   目标（var_434(12)）≤ 得分 → var_434(8)=3（完成）「パーティーは大盛況だった！」
   *   否则「パーティーはぐだぐだになった…」。
   */
  function partyFinal(g) {
    const q = activeQuest(g);
    if (!q || (q.type | 0) !== 1009) return null;
    partyScore(g);                                              // 606771
    const r2 = partyScore2(g);                                  // 606772
    const score = q.progress | 0;
    const messages = [`最终得分是 ${score} 点！`];               // 606776
    let completed = false;
    if ((q.targetData | 0) <= score) {                          // 606778
      if (Elona.Quest) Elona.Quest.markComplete(q);
      Elona.Quest.syncActive(g);
      completed = true;
      messages.push('派对取得了大成功！');                       // 606785
    } else {
      messages.push('派对变得一塌糊涂……');                       // 606794
    }
    return { score, completed, satisfied: r2.satisfied, messages };
  }

  // ---------------------------------------------------------------------------
  // 地图内事件
  // ---------------------------------------------------------------------------
  /**
   * 客人交谈（1009）——原版对话只涨「关注度」（var_58(14)），**不直接给派对得分**；
   * 得分唯一来源是興奮度（演奏/舞蹈/説法把客人抬到 53 以上后的全量重算）。
   * 这里保留交谈的演出（0-BS 的撞人交谈），但不再给分数。
   */
  function onGuestTalk(g, npc) {
    const q = activeQuest(g);
    if (!q || q.type !== 1009 || q.status !== 1) return null;
    const s = partyScore(g);
    return { quest: q, score: s.score, completed: false,
      message: `和 ${npc.name} 打了声招呼（当前气氛 ${s.score}/${q.targetData}）。` };
  }

  /** 收获地图拾取作物（1006）：按重量累计 */
  function onPickup(g, weight) {
    const q = activeQuest(g);
    if (!q || q.type !== 1006 || q.status !== 1 || !(weight > 0)) return null;
    q.progress = (q.progress | 0) + weight;
    if (q.progress >= q.targetData) {
      Elona.Quest.markComplete(q);
      Elona.Quest.syncActive(g);
      return { quest: q, completed: true,
        message: `收获了 ${weight} 重量（${q.progress}/${q.targetData}）。纳入了足够的作物！` };
    }
    return { quest: q, completed: false,
      message: `收获了 ${weight} 重量（${q.progress}/${q.targetData}）。` };
  }

  /** 陷阱地图中踩掉会消失的陷阱时也计入进度（见文件头注记） */
  function onTrapTriggered(g, f) {
    const q = activeQuest(g);
    if (!q || q.type !== 1013 || q.status !== 1) return null;
    q.progress = (q.progress | 0) + 1;
    if (q.progress >= q.targetData) {
      Elona.Quest.markComplete(q);
      Elona.Quest.syncActive(g);
    }
    return { quest: q, progress: q.progress, need: q.targetData, completed: q.status === 3 };
  }

  /** 击倒后检查战场是否肃清 */
  function onKill(g) {
    const q = activeQuest(g);
    if (!q || q.status !== 1) return null;
    if (q.type !== 1001 && q.type !== 1010 && q.type !== 1008) return null;
    if (q.type === 1008) {
      if (q.status === 3) {
        return { quest: q, completed: true, message: '目标已被讨伐！可以从入口楼梯返回城镇报告。' };
      }
      return null;
    }
    const alive = (g.charas || []).some((c) => c && c.get(0) === 1 && (c.get(9) | 0) <= -1);
    if (!alive) {
      Elona.Quest.markComplete(q);
      Elona.Quest.syncActive(g);
      return { quest: q, completed: true, message: '区域已制压！可以从入口楼梯返回城镇报告。' };
    }
    return null;
  }

  /** 每回合：时限（*label_2415/2416/2422 的 var_65(84)） */
  function tick(g) {
    const m = g && g.questMap;
    if (!m) return null;
    const q = activeQuest(g);
    if (!q) return null;
    const out = { messages: [] };
    if (m.turns !== undefined && m.turns > 0) {
      m.turns--;
      if (m.turns <= 0) {
        // 606768-606797：派对按「最终得分」结算，而不是看进度是否达标
        if (q.type === 1009) {
          const fin = partyFinal(g);
          out.timeUp = true;
          out.completed = !!(fin && fin.completed);
          out.failed = !out.completed;
          out.messages.push('时间到！');
          if (fin) out.messages.push(...fin.messages);
          if (out.failed && Elona.Quest.fail) Elona.Quest.fail(g, q);
        } else {
          const nowComplete = q.progress >= q.targetData;
          if (nowComplete) {
            Elona.Quest.markComplete(q);
            Elona.Quest.syncActive(g);
            out.timeUp = true;
            out.completed = true;
            out.messages.push('时间到！委托达成，返回城镇报告吧。');
          } else {
            out.timeUp = true;
            out.failed = true;
            out.messages.push('时间到，委托失败了……');
            if (Elona.Quest.fail) Elona.Quest.fail(g, q);
          }
        }
      }
    }
    return out;
  }

  function activeQuest(g) {
    if (!g || !g.questMap) return null;
    const q = (g.quests || []).find((x) => x.id === g.questMap.questId);
    if (!q || q.status !== 1) return null;
    return q;
  }

  /** 每回合：时限（*label_2415/2416/2422 的 var_65(84)） */
  function tick(g) {
    const m = g && g.questMap;
    if (!m) return null;
    const q = activeQuest(g);
    if (!q) return null;
    const out = { messages: [] };
    // 时限（*label_2415/2416/2422 的 var_65(84)）
    if (m.turns !== undefined && m.turns > 0) {
      m.turns--;
      if (m.turns <= 0) {
        // 606768-606797：派对按「最终得分」结算，而不是看进度是否达标
        if (q.type === 1009) {
          const fin = partyFinal(g);
          out.timeUp = true;
          out.completed = !!(fin && fin.completed);
          out.failed = !out.completed;
          out.messages.push('时间到！');
          if (fin) out.messages.push(...fin.messages);
          if (out.failed && Elona.Quest.fail) Elona.Quest.fail(g, q);
        } else {
          const nowComplete = q.progress >= q.targetData;
          if (nowComplete) {
            Elona.Quest.markComplete(q);
            Elona.Quest.syncActive(g);
            out.timeUp = true;
            out.completed = true;
            out.messages.push('时间到！委托达成，返回城镇报告吧。');
          } else {
            out.timeUp = true;
            out.failed = true;
            out.messages.push('时间到，委托失败了……');
            if (Elona.Quest.fail) Elona.Quest.fail(g, q);
          }
        }
      }
    }
    return out;
  }

  Elona.QuestMap = {
    build, buildTown, onGuestTalk, onPickup, onTrapTriggered, onKill, tick,
    partyScore, partyScore2, partyFinal,
    activeQuest, FLOOR, WALL,
  };
})(window);
