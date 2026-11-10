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
    32: '黄金', 33: '珊瑚', 34: '铅', 35: '生鲜', 36: '蔬菜', 37: '果实',
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
    return ZH[n | 0] || (m.en && m.en.name) || (m.jp && m.jp.name) || '';
  }

  /** 形容词前缀（`var_679(1, n)`，用于随机品质名 `*label_0348`） */
  function adjOf(n, lang) {
    const m = ref(n);
    if (!m) return '';
    const x = lang === 'jp' ? m.jp : m.en;
    return (x && x.adj) || '';
  }

  /**
   * 30540-30565：`var_99(24)` 非 0 时物品名前缀。
   * 1061（野花）例外：材质 35 时不加前缀；f[24] 为 1000/1001 是 630 的特殊档位，不加。
   */
  function workPrefix(it, lang) {
    if (!it || !it.f) return '';
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

  Elona.ItemMaterial = {
    table, ref, nameOf, adjOf, workPrefix, pickTier, materialIndex,
    stats, apply, applyStats,
    count() { const t = table(); return t ? Object.keys(t.materials).length : 0; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
