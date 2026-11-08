'use strict';
/**
 * 料理名（core/foodname.js）—— 0-EZ，以 hsp/start.hsp 为准
 *
 * 【源码】#defcfunc foodname（12587-13741）
 *   参数 prm_457 = 食材类别（f[25]/1000，1..8）、prm_458 = 食材基础名、
 *   prm_459 = 品质 Rank（f[26]，1..10）、prm_460 = 生物/钓获编号（f[23]）。
 *   调用点 itemname 30169-30172：
 *     var_719 = var_719 + foodname(var_99(25,prm_617)/1000, <名字>, var_99(26,prm_617), var_99(23,prm_617))
 *   品质 10 是「<生物名>の肉人形」（12732），即受肉苏生 / 神经支配之线生成的肉人偶。
 *
 * 【本项目】此前 ItemDB.name(料理实例) 只返回食材原名（日文/中文物品名），
 *   foodname 整段未接线。按用户要求改用 wiki「食物」页「可烹饪食物的料理名称」表的中文名，
 *   数据落在 web/data/tables/dishnames.json（8 类 × Rank1..9 + Rank10 肉人偶）。
 *
 * 【差异】源码部分名字会拼接 prm_458（食材名 / 生物名），wiki 表是简化名；
 *   按用户要求直接采用 wiki 中文名，不再拼接。文本/动画/音效仍省略。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let TABLE = null;

  async function load() {
    if (TABLE) return TABLE;
    if (Elona.Data && Elona.Data.table) TABLE = await Elona.Data.table('dishnames');
    return TABLE;
  }

  function setTable(t) { TABLE = t || null; return TABLE; }

  /** 同步取表（浏览器 Data.tableSync / 测试注入） */
  function tableSync() {
    if (TABLE) return TABLE;
    if (Elona.Data && Elona.Data.tableSync) TABLE = Elona.Data.tableSync('dishnames');
    return TABLE;
  }

  function has(cat, quality) {
    const t = tableSync();
    if (!t) return false;
    const row = t[String(cat | 0)];
    return !!(row && row[quality | 0]);
  }

  /**
   * 取料理中文名；无表 / 无对应条目时返回 null，由调用方回退到食材原名。
   * @param {number} cat       f[25]/1000（1..8）
   * @param {number} quality   f[26]（1..10）
   * @param {string} baseName  食材原名（保留参数以对齐源码 prm_458）
   * @param {string} lang      项目显示语言（表本身是中文，语言参数只作透传）
   */
  function of(cat, quality, baseName, lang) {
    const t = tableSync();
    if (!t) return null;
    const row = t[String(cat | 0)];
    if (!row) return null;
    const nm = row[quality | 0];
    return nm || null;
  }

  /** 类别 → 中文名（给面板/文档用） */
  function categoryName(cat) {
    const t = tableSync();
    return (t && t.meta && t.meta.category && t.meta.category[String(cat | 0)]) || '';
  }

  Elona.FoodName = { load, setTable, tableSync, has, of, categoryName };
})(window);
