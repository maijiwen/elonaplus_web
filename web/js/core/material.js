/**
 * 材料（マテリアル）系统 —— 与物品（item）完全独立的一套库存。
 *
 * 源码依据（hsp/start.hsp）：
 *   23409   dim var_497, 400              材料库存，按材料 id 计数
 *   38157-38462  材料定义表
 *                 var_999(0, id) = 需求等级, 稀有度, 图标id
 *                 var_1001(id)   = 名称 lang("jp","en")
 *                 var_1002(id)   = 说明 lang("jp","en")
 *                 var_1000(0..4, id) = 分类标签（18 = 通用）
 *   270284  random_material(等级, 深度)     随机抽材料
 *   270325  matgetmain(材料, 数量, 原因)    获得材料
 *   270369  matdelmain(材料, 数量)          扣除材料
 *   270703  *label_2582                    素材窗口（config 的 key_material = "m"）
 *
 * 数据由 tools/extract_materials.py 提取到 web/data/tables/materials.json。
 */
(function (global) {
  'use strict';
  const Elona = global.Elona = global.Elona || {};

  /** 材料槽数（dim var_497, 400） */
  const SLOTS = 400;

  /** 随机抽取时 rnd(59) —— 源码 270291，实际定义了 0..58 共 59 种 */
  const RAND_MAX = 59;

  /** 分类编号（var_1000/var_2049） */
  const CAT = {
    WOOD: 10,        // 木・革・繊維
    PAPER: 12,       // 紙・インク
    WATER: 13,       // 水（泉）
    ORE: 14,         // 鉱石（採掘）
    PLANT: 15,       // 草・樹液（採取）
    SALVAGE: 16,     // 遺伝子・羽（回収）
    GENERIC: 18,     // 汎用
    SEARCH_A: 9,     // 探索系（地块分类）
    SEARCH_B: 11,    // 默认值（无对应采集分支）
    OTHER: 19,
  };

  let DATA = null;            // materials.json 的 materials 段
  let CATS = null;            // materials.json 的 categories 段

  async function load() {
    if (DATA) return DATA;
    const t = await Elona.Data.table('materials');
    DATA = t.materials || {};
    CATS = t.categories || {};
    return DATA;
  }

  /** 材料定义（未加载时返回 null） */
  function def(id) {
    return DATA ? (DATA[String(id)] || null) : null;
  }

  function name(id, lang) {
    const d = def(id);
    if (!d) return `材料 ${id}`;
    return (lang === 'jp' ? d.nameJp : d.nameEn) || d.nameJp || d.nameEn || `材料 ${id}`;
  }

  function desc(id, lang) {
    const d = def(id);
    if (!d) return '';
    return (lang === 'jp' ? d.descJp : d.descEn) || d.descJp || '';
  }

  /** 该材料是否属于某分类（var_1000 的 5 个槽） */
  function hasCat(id, cat) {
    const d = def(id);
    if (!d || !d.cats) return false;
    return d.cats.some((c) => c === cat);
  }

  // ---------------------------------------------------------------- 库存
  /** 确保 g.materials 存在 */
  function ensure(g) {
    if (!Array.isArray(g.materials)) g.materials = new Array(SLOTS).fill(0);
    if (g.materials.length < SLOTS) g.materials.length = SLOTS;
    return g.materials;
  }

  function get(g, id) {
    const inv = ensure(g);
    return inv[id] | 0;
  }

  function set(g, id, n) {
    const inv = ensure(g);
    inv[id] = Math.max(0, n | 0);
    return inv[id];
  }

  /**
   * 获得材料 —— matgetmain（270325-270368）。
   * @param {number} reason 0=入手 1=掘り当てた 2=釣り上げた 3=採取 4=回収 5=見つけた 6=受け取った
   * @returns {{id:number, n:number, name:string, message:string|null, silent:boolean}}
   */
  const GAIN_TEXT = {
    0: '入手した。', 1: '掘り当てた。', 2: '釣り上げた。', 3: '採取した。',
    4: '回収した。', 5: '見つけた。', 6: '受け取った。',
  };
  const GAIN_TEXT_EN = {
    0: 'obtained.', 1: 'dug up.', 2: 'fished up.', 3: 'gathered.',
    4: 'salvaged.', 5: 'found.', 6: 'received.',
  };

  function add(g, id, n, reason) {
    const cnt = (n | 0) || 1;
    const inv = ensure(g);
    if (id < 0 || id >= SLOTS) return { id, n: 0, name: '', message: null, silent: true };
    inv[id] = (inv[id] | 0) + cnt;
    const nm = name(id, 'en');
    // reason 6（受け取った）在原版里也不打印消息（270331 直接 return）
    const silent = reason === 6;
    let message = null;
    if (!silent) {
      const tail = (Elona.Options && Elona.Options.values && Elona.Options.values.lang === 'jp')
        ? 'マテリアル:' + name(id, 'jp') + 'を' + cnt + '個' + (GAIN_TEXT[reason] || GAIN_TEXT[0])
        : `You get ${cnt} ${nm}. `;
      message = `${tail}(${inv[id]})`;
    }
    return { id, n: cnt, name: nm, message, silent };
  }

  /**
   * 扣除材料 —— matdelmain（270369-270382）。
   * 数量为 0 时按 1 处理；不足时**不检查**（源码直接减，允许变负）。
   * @returns {{ok:boolean, id:number, removed:number, left:number, message:string}}
   */
  function remove(g, id, n) {
    let cnt = (n | 0);
    if (cnt === 0) cnt = 1;
    const inv = ensure(g);
    if (id < 0 || id >= SLOTS) return { ok: false, id, removed: 0, left: 0, message: '无效的材料编号。' };
    if ((inv[id] | 0) < cnt) {
      return { ok: false, id, removed: 0, left: inv[id] | 0, message: `材料不足（${name(id, 'en')} ${inv[id] | 0}/${cnt}）。` };
    }
    inv[id] = (inv[id] | 0) - cnt;
    return {
      ok: true, id, removed: cnt, left: inv[id] | 0,
      message: `マテリアル:${name(id, 'en')}を${cnt}個失った(残り ${inv[id] | 0})`,
    };
  }

  // ---------------------------------------------------------------- 随机抽取
  /**
   * 随机抽一种材料 —— random_material（270284-270324）。
   *
   * 逐行对照：
   *   repeat 500
   *     var_2050 = rnd(59)                  → id，0（クズ）跳过
   *     if (cnt \ 10 == 0) { 等级++; 深度++; }   ← 前 10 次**每次都**提升（源码如此）
   *     if (var_999(0,id) > 等级) continue      → 需求等级太高
   *     if (var_999(1,id) > 深度*10) continue   → 稀有度太高
   *     分类：var_1000(0..4) 任一 == 目标分类 或 == 18（通用）→ 通过，否则 continue
   *     if (rnd(var_999(1,id)) == 0) → 选中
   *
   * 500 次都没抽到则返回 0（クズ）。
   *
   * @param {number} level 起始等级（var_2046）
   * @param {number} depth 起始深度（var_2047）
   * @param {number} cat   目标分类（var_2049）
   * @param {function} rnd 随机函数 rnd(n) → [0,n)
   */
  function random(level, depth, cat, rnd) {
    const r = rnd || ((n) => Math.floor(Math.random() * n));
    let lv = level | 0;
    let dp = depth | 0;
    for (let i = 0; i < 500; i++) {
      const id = r(RAND_MAX);
      if (id === 0) continue;
      // cnt \ 10 == 0 → 前 10 次（cnt = 0..9）每轮都提升
      if (Math.trunc(i / 10) === 0) { lv++; dp++; }
      const d = def(id);
      if (!d) continue;
      if ((d.level | 0) > lv) continue;
      if ((d.rarity | 0) > dp * 10) continue;
      // 分类：任一槽等于目标分类，或等于 18（通用）
      let ok = false;
      for (let k = 0; k < 5; k++) {
        const c = (d.cats && d.cats[k]) | 0;
        if (c === 0) break;
        if (c === cat || c === CAT.GENERIC) { ok = true; break; }
      }
      if (!ok) continue;
      if (r(Math.max(1, d.rarity | 0)) === 0) return id;
    }
    return 0;
  }

  // ---------------------------------------------------------------- 列表
  /** 持有的材料（非 0 的槽），按 id 升序 —— 对应 *label_2582 的循环（270711） */
  function list(g) {
    const inv = ensure(g);
    const out = [];
    for (let i = 0; i < SLOTS; i++) {
      if ((inv[i] | 0) !== 0) out.push({ id: i, count: inv[i] | 0 });
    }
    return out;
  }

  /** 分类名 */
  function catName(cat) {
    const s = CATS && CATS[String(cat)];
    return s || `分类 ${cat}`;
  }

  Elona.Material = {
    SLOTS, RAND_MAX, CAT,
    load, def, name, desc, hasCat, catName,
    ensure, get, set, add, remove, random, list,
  };
})(typeof window !== 'undefined' ? window : globalThis);
