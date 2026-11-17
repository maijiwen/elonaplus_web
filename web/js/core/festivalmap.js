'use strict';
/**
 * 节日城镇地图（core/festivalmap.js）—— 祈雨祭 / 圣夜祭
 *
 * 【唯一权威】hsp/start.hsp
 *   245916-245931  地图 57（ludus）：8 月把 var_132(29,57) 置 1 →
 *                 gosub *label_2477 → map_reload "ludus_fest"；
 *                 非 8 月清标志、回 "ludus"。
 *   245932-245948  地图 33（noyel）：12 月把 var_132(29,33) 置 1 →
 *                 gosub *label_2478 → map_reload "noyel_fest"；
 *                 非 12 月清标志、回 "noyel"。
 *   252304-252429  *label_2477：卢杜斯节日 NPC（含 518 布偶装打工者、摊贩、
 *                 观光客、吟游诗人、旅人、清扫员），全部 cbit 991。
 *   252430-252632  *label_2478：诺耶尔节日祭坛/神像/年糕 + 金田摩托车、
 *                 布偶装打工者、信仰狂信者、纪念品商、摊贩、游客等，全部 cbit 991。
 *
 * wiki 节日页（用户提供，仅作参考）：8 月祈雨祭在路多斯、12 月圣诞祭在诺耶尔，
 * 举办城镇地图会多出节日物品和 NPC。wiki 未给出的具体坐标、种类、数量、字段
 * 一律以 start.hsp 上述锚点为准。
 *
 * 【网页版适配】
 * - 原版 `map_reload "xxx_fest"` 是「换图」；本项目直接按节日月份选择
 *   web/data/maps/{ludus_fest,noyel_fest}.json，但把 GameMap.name 保持为普通城镇名
 *   （原版地图名函数不因地图文件切换，Towns/存档都按普通名索引）。
 * - label_2477/2478 开头会清空地面物品再做 map_reload；本项目两者合成一步，
 *   节日 json 的物件已由 loadMap 生成，这里只补 label 里 `itemcreate` 的 4 件诺耶尔祭品。
 * - cbit 991 是「节日临时 NPC」标记，清场时按源码 57..244 槽位 vanquish。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const FLAG_COL = 29;
  const SLOT_MIN = 57, SLOT_MAX = 244;

  const FESTIVALS = [
    {
      key: 'ludus', id: 57, normal: 'ludus', festival: 'ludus_fest', month: 8,
      label: 'label_2477', name: '祈雨祭', town: '卢杜斯',
    },
    {
      key: 'noyel', id: 33, normal: 'noyel', festival: 'noyel_fest', month: 12,
      label: 'label_2478', name: '圣夜祭', town: '诺耶尔',
    },
  ];
  const BY_NORMAL = Object.create(null);
  const BY_FILE = Object.create(null);
  for (const f of FESTIVALS) {
    BY_NORMAL[f.normal] = f;
    BY_FILE[f.normal] = f;
    BY_FILE[f.festival] = f;
  }

  const v65 = (g, n) => (g && typeof g.getV65 === 'function' ? (g.getV65(n) | 0) : 0);

  function setFlag(g, f, on) {
    if (!g || !f) return 0;
    const v = on ? 1 : 0;
    if (Elona.Sites && typeof Elona.Sites.setField === 'function') {
      Elona.Sites.setField(FLAG_COL, f.id, v, g);
    } else {
      g.v132Fields = g.v132Fields || Object.create(null);
      g.v132Fields[String(f.id)] = g.v132Fields[String(f.id)] || Object.create(null);
      g.v132Fields[String(f.id)][String(FLAG_COL)] = v;
    }
    return v;
  }

  function flag(g, f) {
    if (!g || !f) return 0;
    if (Elona.Sites && typeof Elona.Sites.field === 'function') {
      return Elona.Sites.field(FLAG_COL, f.id, g) | 0;
    }
    const row = g.v132Fields && g.v132Fields[String(f.id)];
    return row ? (row[String(FLAG_COL)] | 0) : 0;
  }

  /** 源码 245917 / 245933：只看月份，不看日期；跨月后需重新进图才会换回来。 */
  function isActive(g, f) {
    return !!f && v65(g, 11) === (f.month | 0);
  }

  /**
   * 选择要载入的地图文件，并同步 var_132(29, mapId)。
   * @returns {{file:string, canonical:string, festival:object|null, def:object|null}}
   */
  function selectMap(g, name) {
    const key = String(name || '');
    const f = BY_FILE[key] || null;
    if (!f) return { file: key, canonical: key, festival: null, def: null };
    const on = isActive(g, f);
    setFlag(g, f, on);
    return {
      file: on ? f.festival : f.normal,
      canonical: f.normal,
      festival: on ? f : null,
      def: f,
    };
  }

  /** 载入后把地图对象标记为节日图；地图名仍保持普通城镇名。 */
  function tagLoadedMap(map, sel) {
    if (!map || !sel || !sel.canonical) return null;
    map.name = sel.canonical;
    map.mapFile = sel.file;
    map.festival = sel.festival ? sel.festival.key : null;
    map.festivalLabel = sel.festival ? sel.festival.label : null;
    if (map.jsonName === undefined) map.jsonName = sel.file;
    return map;
  }

  /** map_init 收尾：var_126 的节日标志给闲聊台词用（idletalk 的 attr(29)）。 */
  function onMapLoaded(g, mapId) {
    const id = mapId | 0;
    const f = FESTIVALS.find((x) => x.id === id) || null;
    g.mapAttrs = g.mapAttrs || Object.create(null);
    const on = !!f && !!g.map && g.map.festival === f.key;
    g.mapAttrs[FLAG_COL] = on ? 1 : 0;
    return g.mapAttrs[FLAG_COL];
  }

  /**
   * 读档路径：deserialize 不走 loadMap，需按存档里的 var_132(29) 恢复节日标记。
   * 这样 populateTown 会继续生成 label_2477/2478 的临时 NPC，而不是读档后全丢。
   */
  function restoreMeta(g) {
    if (!g || !g.map) return null;
    const f = FESTIVALS.find((x) => x.id === (g.getV65 ? (g.getV65(20) | 0) : 0)) || null;
    g.map.festival = f && flag(g, f) === 1 ? f.key : null;
    g.map.festivalLabel = g.map.festival && f ? f.label : null;
    onMapLoaded(g, f ? f.id : 0);
    return g.map.festival;
  }

  function firstFreeSlot(g) {
    for (let i = SLOT_MIN; i <= SLOT_MAX; i++) {
      const c = g.charas && g.charas[i];
      if (!c || (c.get(0) | 0) === 0) return i;
    }
    return -1;
  }

  function occupied(g) {
    const out = new Set();
    for (const c of (g.charas || [])) {
      if (c && (c.get(0) | 0) === 1) out.add(c.x + ',' + c.y);
    }
    return out;
  }

  function randomSpot(g, used) {
    const W = g.map ? (g.map.width | 0) : 0;
    const H = g.map ? (g.map.height | 0) : 0;
    if (!W || !H) return null;
    for (let t = 0; t < 2000; t++) {
      const x = g.rng.rnd(W), y = g.rng.rnd(H);
      if (!g.map.walkable(x, y)) continue;
      const k = x + ',' + y;
      if (used.has(k)) continue;
      used.add(k);
      return { x, y };
    }
    return null;
  }

  function fixedSpot(g, used, x, y) {
    const k = x + ',' + y;
    if (!g.map || !g.map.walkable(x, y) || used.has(k)) return null;
    used.add(k);
    return { x, y };
  }

  function randomName(g) {
    if (Elona.CharaFactory && typeof Elona.CharaFactory.randomName === 'function') {
      try { return Elona.CharaFactory.randomName(g); } catch (e) { /* 兜底 */ }
    }
    return '无名者';
  }

  /**
   * characreate 等价：全部临时 NPC 都置 cbit 991；只有源码显式置 985 的才置。
   * extra(c) 在设置完默认中立/情绪后执行，顺序与 label_2477/2478 一致。
   */
  function spawn(g, used, sp, x, y, extra) {
    const slot = firstFreeSlot(g);
    if (slot < 0) return null;
    const pos = (x | 0) < 0 ? randomSpot(g, used) : fixedSpot(g, used, x, y);
    if (!pos) return null;
    let c = null;
    try {
      c = Elona.CharaFactory.create(g, sp, 1, pos.x, pos.y, { index: slot });
    } catch (e) {
      return null;
    }
    if (!c) return null;
    c.set(0, 1);
    // 源码只对摊贩/纪念品商显式写 var_58(9)=0、var_58(69)=0；
    // 其他节日 NPC 保留 characreate 的默认性格/情绪，不在这里统一定死。
    if (typeof Elona.Status !== 'undefined' && Elona.Status.cbitmod) {
      Elona.Status.cbitmod(c, 991, 1);
      if (extra && extra.cbit985) Elona.Status.cbitmod(c, 985, 1);
    }
    c.festivalNpc = true;
    if (extra && typeof extra === 'function') extra(c);
    g.charas[slot] = c;
    return c;
  }

  function vendorName(g, suffix) {
    return randomName(g) + suffix;
  }

  function souvenir(c) {
    c.set(9, 0);
    c.set(69, 0);
    c.set(202, 3);
    c.set(150, 1018);
    c.set(151, 30);
  }

  function street(c) {
    c.set(9, 0);
    c.set(69, 0);
    c.set(202, 3);
    c.set(150, 1022);
    c.set(151, 30);
  }

  /** 清空 cbit 991 的节日 NPC —— 252424-252428 / 252625-252630。 */
  function clearNpcs(g) {
    let n = 0;
    for (let i = SLOT_MIN; i <= SLOT_MAX; i++) {
      const c = g.charas && g.charas[i];
      if (!c || (c.get(0) | 0) === 0) continue;
      if (!(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 991))) continue;
      if (Elona.Chara && typeof Elona.Chara.vanquish === 'function') {
        Elona.Chara.vanquish(g, i);
      } else {
        c.set(0, 0);
      }
      g.charas[i] = null;
      n++;
    }
    return n;
  }

  /** 252314-252420：卢杜斯祈雨祭 NPC 表。 */
  function spawnLudus(g) {
    const used = occupied(g);
    let n = 0;
    const add = (sp, x, y, extra) => {
      if (spawn(g, used, sp, x, y, extra)) n++;
    };
    add(518, 30, 22, Object.assign(function () {}, { cbit985: true }));
    add(70, 9, 20, Object.assign(function (c) {
      c.set(202, 3); c.set(150, 1002); c.set(151, 10);
      c.name = vendorName(g, '的食料商');
    }, { cbit985: false }));
    add(239, 16, 33, souvenirName(g));
    add(271, 35, 33, souvenirName(g));
    add(271, 13, 42, streetName(g));
    add(271, 21, 20, streetName(g));
    add(271, 34, 45, streetName(g));
    for (let i = 0; i < 10; i++) add(350, -3, 0);
    for (let i = 0; i < 5; i++) add(326, -3, 0);
    for (let i = 0; i < 5; i++) {
      add(185, -3, 0);
      add(271, -3, 0);
      add(473, -3, 0);
    }
    for (let i = 0; i < 3; i++) add(320, -3, 0);
    return n;
  }

  function souvenirName(g) {
    return function (c) {
      souvenir(c);
      c.name = vendorName(g, '的纪念品商');
    };
  }

  function streetName(g) {
    return function (c) {
      street(c);
      c.name = vendorName(g, '的小摊贩');
    };
  }

  /** 252441-252460：label_2478 里 4 个额外 itemcreate（节日 json 不含它们）。 */
  function spawnNoyelItems(g) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return 0;
    const list = [
      [763, 29, 16, 1, 0],  // 台座
      [686, 29, 16, 1, 0],  // 朱亚的神像
      [171, 29, 17, 1, 6],  // 祭坛（f[25]=6）
      [756, 29, 17, 5, 0],  // 年糕（f[21]=5）
    ];
    let n = 0;
    for (const [id, x, y, owner, f25] of list) {
      const cell = g.map && g.map.cell ? g.map.cell(x, y) : null;
      if (!cell || cell[4] !== 0) continue;
      let it = null;
      try { it = Elona.ItemDB.createItem(id, 1); } catch (e) { continue; }
      if (!it) continue;
      if ((it.f[0] | 0) <= 0) it.f[0] = 1;
      it.f[5] = x; it.f[6] = y; it.f[21] = owner;
      if (f25) it.f[25] = f25;
      if (owner >= 0) it.townOwned = true;
      if (g.pushGroundItem(it, { warn: false })) {
        cell[4] = 1;
        n++;
      }
    }
    return n;
  }

  /** 252462-252623：诺耶尔圣夜祭 NPC 表。 */
  function spawnNoyel(g) {
    const used = occupied(g);
    let n = 0;
    const add = (sp, x, y, extra) => {
      if (spawn(g, used, sp, x, y, extra)) n++;
    };
    add(345, 48, 19, function (c) { c.set(150, 3); });
    add(348, 30, 17, function (c) { c.set(150, 3); });
    add(174, 38, 19, Object.assign(function (c) {
      // 252478-252484：先写 Opatos 再被 rnd(2) 覆盖，原版实际只会是 Mani/Ehekatl。
      c.name = g.rng.rnd(2) ? '玛尼狂信者' : '艾赫卡特尔狂信者';
    }, { cbit985: true }));
    for (const [x, y] of [[35, 19], [37, 18], [37, 21], [39, 20], [38, 21]]) {
      add(347, x, y);
    }
    add(70, 17, 8, Object.assign(function (c) {
      c.set(202, 3); c.set(150, 1002); c.set(151, 10);
      c.name = vendorName(g, '的食料商');
    }, { cbit985: false }));
    add(239, 25, 8, souvenirName(g));
    add(271, 24, 22, souvenirName(g));
    add(1, 38, 12, Object.assign(function (c) {
      c.set(202, 3); c.set(150, 1007); c.set(151, 10);
      c.name = vendorName(g, '的黑市商人');
    }, { cbit985: false }));
    add(271, 28, 9, streetName(g));
    add(271, 29, 24, streetName(g));
    for (let i = 0; i < 20; i++) {
      add(349, -3, 0);
      add(350, -3, 0);
    }
    for (let i = 0; i < 15; i++) add(326, -3, 0);
    for (let i = 0; i < 7; i++) {
      add(335, -3, 0);
      add(185, -3, 0);
      add(274, -3, 0);
      add(174, -3, 0);
    }
    for (let i = 0; i < 3; i++) {
      add(332, -3, 0);
      add(185, -3, 0);
    }
    return n;
  }

  /**
   * 在 populateTown 末尾调用：按当前图的节日标记生成 label_2477/2478 内容。
   * 先清一遍 991，保证重复进图/读档不会叠加。
   */
  function spawnContent(g) {
    const f = g && g.map && g.map.festival
      ? FESTIVALS.find((x) => x.key === g.map.festival) : null;
    if (!f) return { festival: null, npcs: 0, items: 0, cleared: clearNpcs(g) };
    const cleared = clearNpcs(g);
    const npcs = f.key === 'ludus' ? spawnLudus(g) : spawnNoyel(g);
    const items = f.key === 'noyel' ? spawnNoyelItems(g) : 0;
    return { festival: f.key, label: f.label, npcs, items, cleared };
  }

  Elona.FestivalMap = {
    FLAG_COL, FESTIVALS,
    isFestivalMap: (f) => !!f && !!(f && f.festival),
    byId(id) { return FESTIVALS.find((f) => f.id === (id | 0)) || null; },
    byName(name) { return BY_NORMAL[String(name || '')] || null; },
    isActive, flag, setFlag, selectMap, tagLoadedMap, onMapLoaded, restoreMeta,
    spawnContent, clearNpcs,
    spawnLudus, spawnNoyel, spawnNoyelItems,
    clearGroundExcept(g, keep) {
      const k = new Set(keep || []);
      const out = [];
      for (const it of (g.groundItems || [])) {
        if (it && k.has(it.f[3] | 0)) continue;
        if (it) it.f[0] = 0;
        out.push(it);
      }
      g.groundItems = out.filter((it) => it && (it.f[0] | 0) > 0);
      return g.groundItems.length;
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.FestivalMap;
})(window);
