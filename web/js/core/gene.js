'use strict';
/**
 * 基因（遺伝子）—— core/gene.js
 *
 * 【源码依据】
 *   302562-302638  *label_2858 / *label_2859（var_541 = 15 读 / 14 写）
 *   303502-303570  存档里的 9 个基因文件：
 *                    gene.s1       100 int（元数据：名称、等级、日期）
 *                    g_cdata.s1    var_58（角色字段）
 *                    g_sdata.s1    var_82（技能）
 *                    g_spell.s1    var_495（法术）
 *                    g_inv.s1      var_99（背包）
 *                    g_spact.s1    var_98（能力）
 *                    g_mat.s1      var_497（素材）
 *                    g_card.s1     var_2329（卡牌）
 *                    g_genetemp.s1 40 int（继承点数等）
 *   302569-302577  读档后统计：var_2295 = sorg(10..19) 之和；var_2296 = sorg(100..399) 之和
 *   220468         读基因（新角色继承时）
 *   311939         存基因
 *
 * 网页版用一个 JSON 存到 localStorage（`elona.gene.v1`），
 * 结构与原版的 9 个文件一一对应，便于迁移。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const STORAGE_KEY = 'elona.gene.v1';
  const MAX_SLOTS = 8;              // 原版是目录里的 gene_header.txt + 9 个文件，这里按槽位存

  // 需要保存的玩家字段（var_58 里真正有意义的那些）
  //   0=状态 1/2=坐标 9=关系 12..17=属性 20?= 21..25=出生日期 27=种族 30=金币 38=等级 …
  const CHARA_FIELDS = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
    60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
    80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
    100, 101, 102, 103, 150, 173, 189, 191, 199, 200, 201, 202, 203, 204, 205,
  ];

  function safeLocal() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* 隐私模式 */ }
    return null;
  }

  const Gene = {
    STORAGE_KEY, MAX_SLOTS,

    /** 内存兜底（node 测试 / 无 localStorage 时） */
    _mem: null,

    _readAll() {
      if (this._mem) return this._mem;
      const ls = safeLocal();
      if (!ls) return { slots: [] };
      try {
        const raw = ls.getItem(STORAGE_KEY);
        this._mem = raw ? JSON.parse(raw) : { slots: [] };
      } catch (e) {
        this._mem = { slots: [] };
      }
      return this._mem;
    },

    _writeAll(data) {
      this._mem = data;
      const ls = safeLocal();
      if (!ls) return false;
      try {
        ls.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
      } catch (e) {
        return false;
      }
    },

    /**
     * 把玩家抓成一份基因（对应 g_cdata/g_sdata/g_spell/g_inv/g_spact/g_mat/g_card）。
     * @param {object} g
     * @param {object} [meta] { name }
     */
    capture(g, meta) {
      const p = g.player;
      if (!p) return null;
      const m = meta || {};

      const fields = {};
      for (const k of CHARA_FIELDS) fields[k] = p.get(k) | 0;

      // var_82：技能（源数组直接拷）
      const skills = {};
      if (p.skillVals) for (const k of Object.keys(p.skillVals)) skills[k] = p.skillVals[k] | 0;
      const skillExp = {};
      if (p.skillExps) for (const k of Object.keys(p.skillExps)) skillExp[k] = p.skillExps[k] | 0;

      // var_495：法术（p.spells / p.spellStock）
      const spells = {};
      const spellsSrc = p.spells || p.spellStock || null;
      if (spellsSrc) for (const k of Object.keys(spellsSrc)) spells[k] = spellsSrc[k] | 0;

      // var_99：背包（只存 id/数量/生成等级，避免整份实例字段膨胀）
      const inv = [];
      for (const it of (p.inv || [])) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        inv.push({
          id: it.id | 0, n: it.f[0] | 0,
          f: (it.f || []).slice(0, 30).map((x) => x | 0),
          name: it.name || null,
        });
      }

      // var_98：能力（已觉醒）
      const abilities = [];
      if (Elona.Feat && Elona.Feat.flag) {
        for (let i = 0; i < 280; i++) if (Elona.Feat.flag(p, i) !== 0) abilities.push(i);
      }

      // var_497：素材
      const materials = {};
      if (Elona.Material && Elona.Material.get) {
        for (let i = 0; i < 400; i++) {
          const n = Elona.Material.get(g, i) | 0;
          if (n) materials[i] = n;
        }
      }

      // gene.s1 的元数据（100 int）：名称、等级、年月日、版本
      const header = {
        name: m.name || p.name || '',
        level: p.get(38) | 0,
        year: g.getV65(10) | 0,
        month: g.getV65(11) | 0,
        day: g.getV65(12) | 0,
        race: p.raceName || '',
        className: p.className || '',
        turn: g.turn | 0,
      };

      return {
        v: 1,
        header,
        fields: fields,
        skills, skillExp, spells, inv, abilities, materials,
        // g_genetemp：继承点数（302569-302577）
        bonus: this.bonusOf({ skills }),
        savedAt: Date.now(),
      };
    },

    /**
     * 继承点数（302569-302577）：
     *   var_2295 = sorg(10..19) 之和
     *   var_2296 = sorg(100..399) 之和
     */
    bonusOf(gene) {
      const sk = (gene && gene.skills) || {};
      let a = 0, b = 0;
      for (let i = 10; i < 20; i++) a += sk[i] | 0;
      for (let i = 100; i < 400; i++) b += sk[i] | 0;
      return { attr: a, skill: b };
    },

    /** 保存到槽位（0 起） */
    save(g, slot, meta) {
      const idx = Math.max(0, Math.min(MAX_SLOTS - 1, slot | 0));
      const gene = this.capture(g, meta);
      if (!gene) return { ok: false, reason: 'no-player' };
      const data = this._readAll();
      data.slots[idx] = gene;
      const written = this._writeAll(data);
      return { ok: true, slot: idx, written, header: gene.header };
    },

    list() {
      const data = this._readAll();
      return (data.slots || []).map((g, i) => (g ? { slot: i, header: g.header, bonus: g.bonus } : null));
    },

    /** 读取槽位 */
    load(slot) {
      const data = this._readAll();
      return (data.slots || [])[slot | 0] || null;
    },

    remove(slot) {
      const data = this._readAll();
      const idx = slot | 0;
      if (!data.slots || !data.slots[idx]) return { ok: false, reason: 'empty' };
      data.slots[idx] = null;
      this._writeAll(data);
      return { ok: true, slot: idx };
    },

    /**
     * 把基因套用到玩家（302578-302592：先把 var_58/var_82 清空再写入）。
     * @param {object} g
     * @param {object} gene
     * @param {object} [opts] { keepPosition: true }
     */
    apply(g, gene, opts) {
      const o = opts || {};
      const p = g.player;
      if (!p || !gene) return { ok: false, reason: 'bad-args' };

      const x = p.x, y = p.y;
      // 302578-302588：清空后写回
      for (const k of Object.keys(gene.fields || {})) p.set(Number(k), gene.fields[k] | 0);
      if (p.skillVals) {
        for (const k of Object.keys(p.skillVals)) delete p.skillVals[k];
        for (const k of Object.keys(gene.skills || {})) p.skillVals[k] = gene.skills[k] | 0;
      }
      if (p.skillExps && gene.skillExp) {
        for (const k of Object.keys(p.skillExps)) delete p.skillExps[k];
        for (const k of Object.keys(gene.skillExp)) p.skillExps[k] = gene.skillExp[k] | 0;
      }
      const spellField = p.spells ? 'spells' : (p.spellStock ? 'spellStock' : null);
      if (spellField) {
        p[spellField] = {};
        for (const k of Object.keys(gene.spells || {})) p[spellField][k] = gene.spells[k] | 0;
      }

      // var_99：背包重建
      if (Elona.ItemDB) {
        p.inv = [];
        for (const row of (gene.inv || [])) {
          let it = null;
          try { it = Elona.ItemDB.createItem(row.id, row.n || 1); } catch (e) { it = null; }
          if (!it) continue;
          if (row.f) for (let i = 0; i < row.f.length; i++) it.f[i] = row.f[i] | 0;
          if (row.name) it.name = row.name;
          p.inv.push(it);
        }
      }

      // var_98：能力
      if (Elona.Feat && Elona.Feat.setFlag) {
        for (let i = 0; i < 280; i++) Elona.Feat.setFlag(p, i, 0);
        for (const i of (gene.abilities || [])) Elona.Feat.setFlag(p, i | 0, 1);
      }

      // var_497：素材
      if (Elona.Material && Elona.Material.set) {
        for (const k of Object.keys(gene.materials || {})) Elona.Material.set(g, Number(k), gene.materials[k] | 0);
      }

      if (!o.keepPosition) { p.x = x; p.y = y; }
      return { ok: true, bonus: this.bonusOf(gene) };
    },

    /** 清空所有槽位（调试用） */
    clearAll() {
      this._writeAll({ slots: [] });
      return true;
    },
  };

  Elona.Gene = Gene;
  if (typeof module !== 'undefined' && module.exports) module.exports = Gene;
})(typeof window !== 'undefined' ? window : global);
