'use strict';
/**
 * 物品材质系统 —— start.hsp 28256-28888（0-GK）
 *
 *   *label_0351 (28256-28659)  46 个材质索引的词表初始化：
 *       var_679 材质名 + 形容词前缀（if var_52 = 日文 / else = 英文）
 *       var_680 8 个属性系数        var_681 附魔 id/数值 对
 *       var_682 ibit 标记            var_683/684 材质等级表
 *   *label_0353 (28664-28753)  按 rnd(100) 选材质档位（3/2/1/0）
 *   *label_0355 (28804-28873)  用 var_680 缩放物品价值/重量/属性
 *   *label_0356 (28874-28888)  用 var_681/682 附加附魔（encadd）与 ibit
 *   itemname 30540-30565         「<材质>細工の / <material>work 」名称前缀
 *
 * 数据表：web/data/tables/item_materials.json（tools/extract_item_materials.py 生成）。
 * 浏览器走 Elona.Data.tableSync，node 测试可直接注入 Elona.ItemMaterialData。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  let cached = null;

  /** 中文界面用的材质名（源码 28256-28659 的日/英名对照翻译） */
  const ZH = {
    0: '砂', 1: '皮革', 2: '丝绸', 3: '布', 4: '鳞', 5: '玻璃', 7: '秘银',
    8: '以太', 9: '钢', 10: '铁', 11: '水晶', 12: '青铜', 13: '钻石',
    14: '灵布', 15: '红宝石', 16: '纸', 17: '宵晒', 18: '骨', 19: '铁链',
    20: '黑曜石', 21: '云母', 22: '珍珠', 23: '翡翠', 24: '龙鳞', 25: '银',
    26: '白金', 27: '扎伊隆', 28: '狮鹫鳞', 29: '钛', 30: '铬', 31: '精金',
    32: '黄金', 33: '珊瑚', 34: '铅', 35: '食材', 36: '蔬菜', 37: '果实',
    38: '药草', 39: '谜之物体', 40: '神器', 41: '宝石', 42: '魔法之木',
    43: '木', 44: '竹', 45: '纳米机械',
  };

  function table() {
    if (Elona.ItemMaterialData && Elona.ItemMaterialData.materials) return Elona.ItemMaterialData;
    if (!cached && Elona.Data && Elona.Data.tableSync) {
      try { cached = Elona.Data.tableSync('item_materials'); } catch (e) { cached = null; }
    }
    return cached;
  }

  /** 材质记录；缺号（源码没有 6 号）返回 null */
  function ref(n) {
    const t = table();
    if (!t) return null;
    return t.materials[String(n | 0)] || null;
  }

  function nameOf(n, lang) {
    const m = ref(n);
    if (!m) return '';
    if (lang === 'jp') return (m.jp && m.jp.name) || (m.en && m.en.name) || '';
    if (lang === 'en') return (m.en && m.en.name) || (m.jp && m.jp.name) || '';
    // 中文材质名有表；缺号时按「日文优先」回退（英文只在 en 模式用）
    if (lang === 'en') return (m.en && m.en.name) || (m.jp && m.jp.name) || ZH[n | 0] || '';
    return ZH[n | 0] || (m.jp && m.jp.name) || (m.en && m.en.name) || '';
  }

  /** 形容词前缀（`var_679(1, n)`，用于随机品质名 `*label_0348`） */
  function adjOf(n, lang) {
    const m = ref(n);
    if (!m) return '';
    const x = (lang === 'en') ? m.en : (m.jp || m.en);
    return (x && x.adj) || '';
  }

  /**
   * 30539-30549：`var_724 == 60000`（refitem(id,5) 的家具/杂项类别）才允许
   * 把 `var_99(24)` 材质转成名字前缀；食物（57000）、工具（59000）等类别
   * 虽然也带材质字段（如草莓的 35=食材），源码并不会给它们加「食材細工の」。
   * 1061（野花）例外：材质 35 时不加前缀；f[24] 为 1000/1001 是 630 的特殊档位，不加。
   */
  function workPrefix(it, lang) {
    if (!it || !it.f) return '';
    // var_724 = refitem(var_99(3), 5)（start.hsp:30331）。优先取实例上的
    // var_657（field657），旧档/测试桩缺该字段时回查物品定义表。
    let cat = it.field657 | 0;
    if (!cat && Elona.ItemDB && Elona.ItemDB.ref) {
      try { cat = Elona.ItemDB.ref(it.id | 0, 5) | 0; } catch (e) { cat = 0; }
    }
    if (cat !== 60000) return '';
    const n = it.f[24] | 0;
    if (!n || n >= 1000) return '';
    if ((it.id | 0) === 1061 && n === 35) return '';
    const name = nameOf(n, lang);
    if (!name) return '';
    if (lang === 'jp') return name + '細工の';
    if (lang === 'en') return name + 'work ';
    return name + '制';
  }

  /**
   * 28674-28700：材质档位选择。rnd(100) < 5 → 3（最高），< 25 → 2，
   * < 55 → 1，否则 0；再按 var_683/684 的 5×4 表取一个材质索引。
   * @param {number} r 0..99 的随机值（由调用方给，便于测试）
   */
  function pickTier(r) {
    const v = r | 0;
    return v < 5 ? 3 : (v < 25 ? 2 : (v < 55 ? 1 : 0));
  }

  /**
   * 28713-28747：`var_99(24) = var_683(var_400, var_686)` 或 `var_684(...)`。
   * 表为 5 行（var_686 等级 0..4）× 4 列（var_400 档位 0..3）。
   * 另外 28674-28690 的 `rnd(25)==0 → 35`、高档位低概率 45/44/43 属调用方的
   * 随机层，这里只做确定性的查表。
   */
  function materialIndex(tier, level, key) {
    const t = table();
    if (!t || !t.tiers) return 0;
    const rows = t.tiers[key === '684' ? '684' : '683'] || [];
    const row = rows[Math.max(0, Math.min(level | 0, rows.length - 1))];
    return (row && row[Math.max(0, Math.min(tier | 0, row.length - 1))]) | 0;
  }

  /** var_680 系数（价值/重量/命中/伤害/防御/回避/命中修正/图标） */
  function stats(n) {
    const m = ref(n);
    return m ? (m.coeffs || []) : [];
  }

  /**
   * *label_0356（28874-28888）：把材质的附魔与 ibit 应用到物品实例。
   * 原版 `encadd var_579, enc, val, 0, 1` / `ibitmod bit, var_579, 1`。
   */
  function apply(it, g, opt) {
    const m = ref(it && it.f ? (it.f[24] | 0) : 0);
    if (!m || !it) return { enchants: 0, ibits: 0 };
    const o = opt || {};
    let enc = 0, bits = 0;
    const DB = Elona.ItemDB;
    for (const pair of (m.enchants || [])) {
      const id = pair[0] | 0, val = pair[1] | 0;
      if (!id) continue;                              // 源码 `if ( == 0 ) break`
      if (DB && typeof DB.encadd === 'function') {
        try { DB.encadd(it, id, val, g || null, o); enc++; } catch (e) { /* noop */ }
      } else if (it.enchantTable) {
        it.enchantTable.push([id, val]); enc++;
      }
    }
    for (const bit of (m.ibits || [])) {
      if (!bit) continue;
      if (DB && typeof DB.ibitmod === 'function') {
        try { DB.ibitmod(bit | 0, it, 1); bits++; } catch (e) { /* noop */ }
      }
    }
    return { enchants: enc, ibits: bits };
  }

  /**
   * *label_0355（28804-28873）的核心系数：价值 ×c0/100、重量按 c1 缩放、
   * 未设命中修正时取 c7。完整公式还依赖 var_690（品质模式）与 rnd(30)，
   * 这里提供可由调用方显式调用的确定性版本，不自动生成时执行。
   */
  function applyStats(it, mode) {
    const c = stats(it && it.f ? (it.f[24] | 0) : 0);
    if (!c.length || !it || !it.f) return it;
    const f = it.f;
    if (c[0] !== undefined) f[7] = Math.floor((f[7] | 0) * (c[0] | 0) / 100);
    if (c[1] !== undefined) f[1] = Math.floor((f[1] | 0) * ((c[1] | 0) / 4 + 200) / 400);
    if ((f[22] | 0) === 0 && c[7] !== undefined) f[22] = c[7] | 0;
    if (mode === 'fixed') {
      if ((f[13] | 0) > 0) f[13] = Math.floor((c[2] | 0) * (f[13] | 0) * 9 / 91);
      if ((f[12] | 0) > 0) f[12] = Math.floor((c[3] | 0) * (f[12] | 0) * 5 / 91);
      if ((f[14] | 0) > 0) f[14] = Math.floor((c[4] | 0) * (f[14] | 0) * 7 / 91);
      if ((f[15] | 0) > 0) f[15] = Math.floor((c[5] | 0) * (f[15] | 0) * 9 / 91);
      if ((f[11] | 0) !== 0 && c[6] !== undefined) f[11] = Math.floor((f[11] | 0) * (c[6] | 0) / 120);
    }
    return it;
  }

  // ======================================================================
  // 素材変化の巻物（0-Z12）—— 326087-326202 的三张循环表
  // ======================================================================
  /**
   * 卷轴 500 / 501 / 502 把目标物品的材质沿固定环推进一格。
   * 源码是三段平铺的 `if ( var_99(24, var_579) == N ) { var_687 = M }`：
   *   500 劣悪素材の巻物（power 10）：16→3→2→21→44→35→1→5→4→33→12→34→18→16，缺省 16
   *   501 素材変化の巻物（power 180）：27→43→20→30→10→9→19→25→26→32→22→28→(祝福?24:27)
   *                                   / 24→(祝福?31:27) / 31→27，缺省 27
   *   502 *素材変化*巻物（power 350）：17→14→24→11→29→45→7→31→23→13→(祝福?15:17)
   *                                   / 15→(祝福?8:17) / 8→17，缺省 17
   * 「祝福」判定用**卷轴自己**的 `var_99(17) < 1`（326113 / 326150）。
   */
  const CYCLE = {
    500: {
      16: 3, 3: 2, 2: 21, 21: 44, 44: 35, 35: 1, 1: 5, 5: 4, 4: 33,
      33: 12, 12: 34, 34: 18, 18: 16,
    },
    501: {
      27: 43, 43: 20, 20: 30, 30: 10, 10: 9, 9: 19, 19: 25, 25: 26,
      26: 32, 32: 22, 22: 28, 31: 27,
    },
    502: {
      17: 14, 14: 24, 24: 11, 11: 29, 29: 45, 45: 7, 7: 31, 31: 23,
      23: 13, 8: 17,
    },
  };
  const CYCLE_DEFAULT = { 500: 16, 501: 27, 502: 17 };

  /**
   * 下一档材质。
   * @param {number} toolId 500 / 501 / 502
   * @param {number} mat    当前材质
   * @param {boolean} blessed 卷轴是否祝福（`var_99(17) >= 1`）
   */
  function nextMaterial(toolId, mat, blessed) {
    const t = toolId | 0, m = mat | 0;
    if (t === 501) {
      if (m === 28) return blessed ? 24 : 27;
      if (m === 24) return blessed ? 31 : 27;
    }
    if (t === 502) {
      if (m === 13) return blessed ? 15 : 17;
      if (m === 15) return blessed ? 8 : 17;
    }
    const tbl = CYCLE[t];
    if (!tbl) return 0;
    const v = tbl[m];
    return v === undefined ? (CYCLE_DEFAULT[t] | 0) : v;
  }

  /**
   * 换材质：start.hsp *label_0354 → *label_0355 → *label_0356（28754-28888）逐段移植。
   *
   *   label_0354：先按旧材质的 var_681 表逐条 encremove（去掉旧材质自带附魔），
   *               反算骰面基数 var_689 = 价值*400/(旧价值系数/4+200)，
   *               gosub label_0598（var_59=10 → label_1934，普通装备不改基础字段），
   *               恢复价值，写入新材质（var_687）后进入 label_0355。
   *   label_0355：按新材质系数缩放骰面/价值/命中，并用品质分母 + rnd(30)/rnd(25)
   *               重算 5 个附魔加成槽 f[13/12/14/15/11]（随机骰波动，var_690==0 分支），
   *               末尾 gosub label_0356。
   *   label_0356：按新材质的 var_681 表逐条 encadd、var_682 表逐条 ibitmod。
   *
   * @param g 游戏对象（提供 rng；encadd/encremove 需要）
   * @returns {boolean} 是否发生材质变化
   */
  function changeTo(it, newMat, g) {
    if (!it || !it.f) return false;
    const f = it.f;
    const oldMat = f[24] | 0;
    const nm = newMat | 0;
    if (nm === oldMat) return false;
    const co = stats(oldMat) || [], cn = stats(nm) || [];
    const DB = Elona.ItemDB;
    const rnd = (n) => ((g && g.rng && typeof g.rng.rnd === 'function')
      ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));

    // ---- label_0354 开头：移除旧材质自带附魔（var_681 表最多 8 对） ----
    const oldRec = ref(oldMat);
    if (oldRec) {
      for (const pair of (oldRec.enchants || [])) {
        const id = pair[0] | 0, val = pair[1] | 0;
        if (!id) break;                                   // 源码 `if (==0) break`
        if (DB && typeof DB.encremove === 'function') {
          try { DB.encremove(it, id, val, g); } catch (e) { /* noop */ }
        }
      }
      // 旧材质 ibit 清除（避免残留耐火/耐酸等材质特性）
      for (const bit of (oldRec.ibits || [])) {
        if (!bit) break;
        if (DB && typeof DB.ibitmod === 'function') {
          try { DB.ibitmod(bit | 0, it, 0); } catch (e) { /* noop */ }
        }
      }
    }

    // ---- label_0354：反算骰面基数 var_689 = 价值*400/(旧价值系数/4+200) ----
    // 源码对 refitem==60000 有另一分支（金币等），装备一般都走 else。
    const refitem = (f[3] | 0);
    let var689;
    if (co[1] !== undefined) var689 = idiv((f[1] | 0) * 400, idiv(co[1] | 0, 4) + 200);
    else var689 = f[1] | 0;

    // 清 f[13]/f[12]/f[14]/f[15]（源码 28776-28785 的条件段；换材质装备通常都带附魔加成）
    f[13] = 0; f[12] = 0; f[14] = 0; f[15] = 0;

    // label_0598（var_59=10 → label_1934）：普通装备不改基础字段，仅保留 var_689 回写价值
    void refitem;

    // 写入新材质
    f[24] = nm;

    // ---- label_0355：按新材质缩放 ----
    // 骰面/价值基数：f[7] = f[7] * 新重量系数/100
    if (cn[0] !== undefined) f[7] = Math.max(1, idiv((f[7] | 0) * (cn[0] | 0), 100));
    // 价值：f[1] = var689 * (新价值系数/4+200)/400
    const valDiv = (cn[1] !== undefined) ? (idiv(cn[1] | 0, 4) + 200) : 400;
    f[1] = Math.max(1, idiv(var689 * valDiv, 400));
    // 命中修正：f[22]==0 时取新材质的图标/命中位 c7
    if ((f[22] | 0) === 0 && cn[7] !== undefined) f[22] = cn[7] | 0;

    // 品质分母 var_400(1)：默认 120；品质1→150，品质3→100，品质≥4→80（28823-28831）
    const qual = f[4] | 0;
    const denom = qual === 1 ? 150 : (qual === 3 ? 100 : (qual >= 4 ? 80 : 120));
    // var_690==0 分支（28855-28871）：分母带 rnd(30)/rnd(25) 的随机骰波动。
    // 换材质（卷轴/素材槌）不设 var_690，沿用 0，故走此分支。
    if ((f[13] | 0) !== 0) f[13] = idiv((cn[2] | 0) * (f[13] | 0) * 9, denom - rnd(30));
    if ((f[12] | 0) !== 0) f[12] = idiv((cn[3] | 0) * (f[12] | 0) * 5, denom - rnd(30));
    if ((f[14] | 0) !== 0) f[14] = idiv((cn[4] | 0) * (f[14] | 0) * 7, denom - rnd(30));
    if ((f[15] | 0) !== 0) f[15] = idiv((cn[5] | 0) * (f[15] | 0) * 9, denom - rnd(30));
    if ((f[11] | 0) !== 0) f[11] = idiv((f[11] | 0) * (cn[6] | 0), denom + rnd(25));

    // ---- label_0356：加新材质自带附魔与 ibit ----
    const newRec = ref(nm);
    if (newRec) {
      for (const pair of (newRec.enchants || [])) {
        const id = pair[0] | 0, val = pair[1] | 0;
        if (!id) break;
        if (DB && typeof DB.encadd === 'function') {
          try { DB.encadd(it, id, val, g, { prm553: 1 }); } catch (e) { /* noop */ }
        } else if (it.enchantTable) {
          it.enchantTable.push([id, val]);
        }
      }
      for (const bit of (newRec.ibits || [])) {
        if (!bit) break;
        if (DB && typeof DB.ibitmod === 'function') {
          try { DB.ibitmod(bit | 0, it, 1); } catch (e) { /* noop */ }
        }
      }
    }
    return true;
  }

  Elona.ItemMaterial = {
    table, ref, nameOf, adjOf, workPrefix, pickTier, materialIndex,
    stats, apply, applyStats,
    nextMaterial, changeTo, CYCLE,
    count() { const t = table(); return t ? Object.keys(t.materials).length : 0; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
