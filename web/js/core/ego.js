'use strict';
/**
 * 「エゴ」前缀与品质前缀（core/ego.js）—— `*label_0346` / `*label_0348` / `*label_0349`
 *
 * 【源码依据】
 *   28015-28070  var_671(egoId) = 名前缀（烈火の / 氷結の …，19 个）
 *                `var_672(0, egoId) = kind, encClass` —— HSP 的连续赋值一次写
 *                两维：var_672(0,id) = 适用类型（0..3），var_672(1,id) = **物品
 *                类别过滤条件**（不是「附魔类别」）。28107-28111 把它作为
 *                `encflt(var_657, var_672(1,cnt))` 的第二参数，var_657 是
 *                `refitem(物品id, 5)`（物品类别）；encflt 定义见 26218-26241。
 *                var_670(0, egoId) = 附魔 (id, power) 对列表
 *   28091-28093  var_674(0..9) = 品质前缀（唄う / 輝く / 強力な …，10 个）
 *   28095-28100  *label_0348：加随机附魔，`var_99(23) = 20000 + rnd(10)`
 *   28101-28127  *label_0349：按 var_676 选 ego → `var_99(23) = 10000 + egoId` → egoadd
 *   28001-28008  egoadd：逐对 `encadd(item, id, randomencp(power))`
 *
 * 【字段 23 的编码】
 *   < 10000   普通用途（鱼的图鉴索引 / 卵乳的种族 id）
 *   10000 +   ego 前缀下标
 *   20000 +   品质前缀下标
 *
 * 数据：tools/extract_ego.py → web/data/tables/ego.json
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const FIELD = 23;
  const EGO_BASE = 10000;
  const QUALITY_BASE = 20000;
  /** var_676 == 4 时不加 ego（28136-28139） */
  const KIND_NONE = 4;

  let data = null;

  function table() {
    if (data) return data;
    if (Elona.Data && Elona.Data.tableSync) {
      try { data = Elona.Data.tableSync('ego'); } catch (e) { data = null; }
    }
    return data;
  }

  const Ego = {
    FIELD, EGO_BASE, QUALITY_BASE, KIND_NONE,

    async load() {
      if (data) return data;
      try { data = await Elona.Data.table('ego'); } catch (e) { data = null; }
      return data;
    },

    ready() { return !!table(); },

    list() {
      const t = table();
      return (t && t.egos) || [];
    },

    qualities() {
      const t = table();
      return (t && t.quality) || [];
    },

    get(id) {
      const i = id | 0;
      return this.list().find((e) => e.id === i) || null;
    },

    /** ego 名前缀 */
    nameOf(id, lang) {
      const e = this.get(id);
      if (!e) return '';
      return lang === 'jp' ? (e.nameJp || '') : (e.nameEn || '');
    },

    qualityName(idx, lang) {
      const q = this.qualities()[idx | 0];
      if (!q) return '';
      return lang === 'jp' ? (q.jp || '') : (q.en || '');
    },

    /**
     * 字段 23 解析：{ kind: 'ego'|'quality'|'none', id, prefix }
     */
    parse(f23) {
      const v = f23 | 0;
      if (v >= QUALITY_BASE) return { kind: 'quality', id: v - QUALITY_BASE };
      if (v >= EGO_BASE) return { kind: 'ego', id: v - EGO_BASE };
      return { kind: 'none', id: v };
    },

    /** 按字段 23 取前缀（ItemDB.name 用） */
    prefixOf(it, lang) {
      if (!it || !it.f) return '';
      const p = this.parse(it.f[FIELD]);
      if (p.kind === 'ego') return this.nameOf(p.id, lang);
      if (p.kind === 'quality') return this.qualityName(p.id, lang);
      return '';
    },

    /**
     * 挑一个 ego（28101-28114）。
     * @param {object} g
     * @param {number} kind var_676（0..3 参与筛选，4 = 不加）
     * @param {number} category 物品类别 var_657（用于 encflt）
     * @returns {object|null}
     */
    pick(g, kind, category) {
      const k = kind | 0;
      if (k === KIND_NONE) return null;                  // 28136-28139
      const rnd = (g && g.rng && g.rng.rnd) ? g.rng.rnd.bind(g.rng) : (n) => Math.floor(Math.random() * n);
      const cands = [];
      for (const e of this.list()) {
        if ((e.kind | 0) !== k) continue;                // 28104
        const encClass = e.encClass | 0;
        if (encClass !== 0) {                            // 28107-28111
          // encflt(物品类别, 过滤条件)：1 → 30000..49999、2 → 12000..23999、
          // 3 → 12000..23999 或 10000、10000 → 精确等于 10000（26218-26241）。
          if (Elona.ItemDB && Elona.ItemDB.encflt && !Elona.ItemDB.encflt(category | 0, encClass)) continue;
        }
        cands.push(e);
      }
      if (!cands.length) return null;                    // 28115-28117
      return cands[rnd(cands.length)];
    },

    /**
     * 给物品加 ego（egoadd 28001-28008 + 28118-28120）。
     * @param {object} it 物品实例
     * @param {number} egoId
     * @param {object} g
     */
    apply(it, egoId, g) {
      const e = this.get(egoId);
      if (!it || !e) return null;
      const rnd = (g && g.rng && g.rng.rnd) ? g.rng.rnd.bind(g.rng) : (n) => Math.floor(Math.random() * n);
      const added = [];
      for (const pair of (e.enchants || [])) {
        const encId = pair[0] | 0;
        const power = pair[1] | 0;
        try {
          if (Elona.ItemDB && Elona.ItemDB.randomencp && Elona.ItemDB.encadd) {
            const p = Elona.ItemDB.randomencp(power, g);
            Elona.ItemDB.encadd(it, encId, p, g);
          } else if (Elona.ItemDB && Elona.ItemDB.encadd) {
            Elona.ItemDB.encadd(it, encId, power, g);
          } else {
            continue;
          }
          added.push(encId);
        } catch (err) { /* 单条附魔失败不影响其它 */ }
      }
      if (it.f) it.f[FIELD] = EGO_BASE + (e.id | 0);
      it.egoId = e.id | 0;
      return { ego: e, added };
    },

    /** 品质前缀（28095-28100） */
    applyQuality(it, idx) {
      if (!it || !it.f) return null;
      const qs = this.qualities();
      if (!qs.length) return null;
      const i = (idx === undefined) ? 0 : (idx | 0);
      if (i < 0 || i >= qs.length) return null;
      it.f[FIELD] = QUALITY_BASE + i;
      it.qualityId = i;
      return qs[i];
    },

    /** 给物品加品质前缀（随机），对应 28099 `var_99(23) = 20000 + rnd(var_675)` */
    applyRandomQuality(it, g) {
      const qs = this.qualities();
      if (!qs.length) return null;
      const rnd = (g && g.rng && g.rng.rnd) ? g.rng.rnd.bind(g.rng) : (n) => Math.floor(Math.random() * n);
      return this.applyQuality(it, rnd(qs.length));
    },
  };

  Elona.Ego = Ego;
  if (typeof module !== 'undefined' && module.exports) module.exports = Ego;
})(typeof window !== 'undefined' ? window : global);
