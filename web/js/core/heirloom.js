'use strict';
/**
 * 遗产继承（形見のカバン / 遺産相続）—— core/heirloom.js
 *
 * 【源码依据】hsp/start.hsp（CP932，ASCII 锚点）
 *   290247-290303  *label_3067：「留下遗传因子」= 设 var_65(98)=配偶下标（relation.js makeGene 已接）
 *   311919-311944  *label_2935 睡觉时：cbit 962 配偶存活 → 生成新遗传因子 + 双向 gain_iden
 *   302558-302638  *label_2858 读基因存档（var_541=15）：算继承点数、过滤并复制背包物品到 shop3
 *       302563-302568  var_2295 = Σ sorg(10..19)（属性）、var_2296 = Σ sorg(100..399)（技能）
 *       302569          var_2297 += limit(var_58(30)/100, 1000, 100000)（金币）
 *       302590-302627  物品过滤：跳过 511 / 1210-1212 / 578 / 品质6(f[4]==6) / ibit(5)；
 *                       717→var_2298、1212→2299、1211→2300、1210→2301 标志；
 *                       refitem(id,5)==25000 → f[9]=-1（弹药还原）；item_copy 到 shop3
 *   302534-302557  *label_2857 读 shop3（var_541=4）应用点数：
 *       var_2295 = limit((var_2295-250)/7, 5, 50) → var_58(31,0)（白金币）
 *       var_2296 = limit((var_2296-250)/8, 5, 40) → var_58(41,0)（技能点）
 *       var_58(30,0) += var_2297（金币）；素材 var_497(cnt)/=3
 *   326218-326245  效果 1128（遗产相続の権利書 511）：var_65(97) += 3（继承权 +3）
 *   297569 / 297717-297722  形見のカバン 510（var_486=22,1）：
 *       打开需 var_65(97) >= 1（否则「没有继承权」）；取一件 → var_65(97)--
 *   301545 / 602351  var_65(97)<0 → 1（新档兜底）；调试可设 1000
 *
 * 网页版：遗产物品与点数存一份 JSON（localStorage `elona.heirloom.v1`），
 * 结构与源码 gene.s1 + shop3.s2 一一对应，node 测试用内存兜底。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const STORAGE_KEY = 'elona.heirloom.v1';
  const HEIR_ITEM = 510;        // 形見のカバン（遗物提包）
  const DEED_ITEM = 511;        // 遺産相続の権利書（继承权书）
  const EFFECT_CLAIM = 1128;    // 权书阅读触发的效果号
  const V87 = 97;               // var_65(97) 继承权计数

  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));

  function safeLocal() {
    try { if (typeof localStorage !== 'undefined') return localStorage; } catch (e) { /* 隐私模式 */ }
    return null;
  }

  /** 技能求和：源码 sorg(id,0) 即 var_82(id,0) 的原始技能值 */
  function sumSkills(p, from, to) {
    let s = 0;
    if (!p || typeof p.skill !== 'function') return 0;
    for (let i = from; i < to; i++) s += p.skill(i) | 0;
    return s;
  }

  /** 物品是否属于「不可继承」清单（源码 302595-302626） */
  function isExcluded(id, it) {
    // A132 修正：源码 302610 `if ( var_99(3,cnt) == 511 | refitem(var_99(3,cnt),9) == 53100 ) continue`
    //   排除继承权书本身 **以及全部产权书**（refitem f9==53100：家/店/博物馆/农田/仓库/牧场/迷宫/搬家）。
    //   此前只排 511，漏了其它产权书 —— wiki 也明确「各类产权书不可继承」。
    if (id === DEED_ITEM) return true;                 // 511 继承权书本身
    const IDB = Elona.ItemDB;
    if (IDB && typeof IDB.ref === 'function' && (IDB.ref(id, 9) | 0) === 53100) return true; // 各类产权书
    if (id === 1210 || id === 1211 || id === 1212) return true;  // 三碎片（同时由 specialFlag 记元数据）
    if (id === 578) return true;                       // 存钱罐
    if (((it.f && it.f[4]) | 0) === 6) return true;    // 品质6（黑星）
    if (IDB && typeof IDB.ibit === 'function' && IDB.ibit(5, it) !== 0) return true; // 唯一物品
    return false;
  }

  /** 特殊标志物品（源码 302592-302601）：记入遗产元数据，给后代开局剧情用 */
  function specialFlag(id) {
    if (id === 717) return 'lomias';       // ロミアスの秘密の経験
    if (id === 1212) return 'chaos';       // 軍神の欠片
    if (id === 1211) return 'rehmido';     // レミードの欠片
    if (id === 1210) return 'leshimas';    // レシマスの欠片
    return null;
  }

  const Heirloom = {
    STORAGE_KEY, HEIR_ITEM, DEED_ITEM, EFFECT_CLAIM, V87,

    _mem: null,

    _read() {
      if (this._mem) return this._mem;
      const ls = safeLocal();
      if (!ls) return { record: null };
      try {
        const raw = ls.getItem(STORAGE_KEY);
        this._mem = raw ? JSON.parse(raw) : { record: null };
      } catch (e) { this._mem = { record: null }; }
      return this._mem;
    },

    _write(data) {
      this._mem = data;
      const ls = safeLocal();
      if (!ls) return false;
      try { ls.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
      catch (e) { return false; }
    },

    /**
     * 从玩家当前状态生成一份遗产记录（对应 *label_2858 读基因后算点数 + 复制物品）。
     * @param {object} g
     * @returns {object|null} { attrSum, skillSum, goldBonus, items[], flags{}, savedAt }
     */
    capture(g) {
      const p = g && g.player;
      if (!p) return null;
      const attrSum = sumSkills(p, 10, 20);       // var_2295：力量10..幸运19
      const skillSum = sumSkills(p, 100, 400);   // var_2296：技能 100..399
      const gold = p.get(30) | 0;
      const goldBonus = limit(idiv(gold, 100), 1000, 100000);  // var_2297

      const items = [];
      const flags = {};
      const inv = p.inv || [];
      const IDB = Elona.ItemDB;
      for (const it of inv) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        const id = it.id | 0;
        const fl = specialFlag(id);
        if (fl) flags[fl] = 1;
        if (isExcluded(id, it)) continue;
        // 复制物品实例（对应 item_copy）：保留 f[0..29] 与 id/name
        const f = (it.f || []).slice(0, 30).map((x) => x | 0);
        // 弹药：refitem(id,5)==25000 → f[9]=-1（换回普通弹）
        if (IDB && IDB.ref && (IDB.ref(id, 5) | 0) === 25000) f[9] = -1;
        f[18] = 0;                              // var_99(18,cnt)=0（清除来源）
        items.push({ id, n: f[0] | 0, f, name: it.name || null });
      }
      return {
        attrSum, skillSum, goldBonus, items, flags,
        owner: p.name || '', savedAt: Date.now(), v: 1,
      };
    },

    /** 保存遗产记录（对应把 shop3.s2 写入存档目录） */
    save(g) {
      const rec = this.capture(g);
      if (!rec) return { ok: false, reason: 'no-player' };
      const written = this._write({ record: rec });
      return { ok: true, written, record: rec };
    },

    load() { return (this._read().record || null); },
    has() { return !!this.load(); },
    clear() { this._write({ record: null }); return true; },

    /**
     * 继承点数（*label_2857 302534-302553）：把遗产点数加到新角色身上。
     * @returns {{platinum:number, skillPoints:number, gold:number, materialDiv:number}}
     */
    applyBonus(g, rec) {
      const r = rec || this.load();
      const p = g && g.player;
      if (!p || !r) return { platinum: 0, skillPoints: 0, gold: 0, materialDiv: 0, applied: false };
      const platinum = limit(idiv((r.attrSum | 0) - 250, 7), 5, 50);
      const skillPoints = limit(idiv((r.skillSum | 0) - 250, 8), 5, 40);
      const gold = r.goldBonus | 0;
      p.set(31, (p.get(31) | 0) + platinum);      // var_58(31,0) 白金币
      p.set(41, (p.get(41) | 0) + skillPoints);   // var_58(41,0) 技能点
      p.set(30, (p.get(30) | 0) + gold);          // var_58(30,0) 金币
      // 素材 /=3（302554-302556）：项目 Material.set 若存在则逐项处理
      if (Elona.Material && typeof Elona.Material.set === 'function' && typeof Elona.Material.get === 'function') {
        for (let i = 0; i < 400; i++) {
          const v = Elona.Material.get(g, i) | 0;
          if (v) Elona.Material.set(g, i, idiv(v, 3));
        }
      }
      return { platinum, skillPoints, gold, materialDiv: 3, applied: true, flags: r.flags || {} };
    },

    /** 继承权 var_65(97)：读取 */
    rights(g) { return g && typeof g.getV65 === 'function' ? (g.getV65(V87) | 0) : 0; },

    /** 继承权 +3（效果 1128，326231 var_65(97)+=3） */
    claim(g) {
      if (!g || typeof g.setV65 !== 'function') return { ok: false, reason: 'no-game' };
      const cur = this.rights(g);
      g.setV65(V87, cur + 3);
      return { ok: true, added: 3, total: cur + 3 };
    },

    /** 兜底：var_65(97)<0 → 1（301545-301546） */
    ensurePositive(g) {
      if (this.rights(g) < 0 && g && typeof g.setV65 === 'function') g.setV65(V87, 1);
      return this.rights(g);
    },

    /**
     * 打开遗物提包 510：源码 var_486=22,1 打开时需继承权 ≥1，且列出全部遗产（只读）。
     * @returns {{ok:boolean, items:Array, rights:number, reason?:string}}
     */
    openTrunk(g, it) {
      const rec = this.load();
      if (!rec) return { ok: false, reason: 'no-legacy', items: [], rights: this.rights(g) };
      if (this.rights(g) < 1) return { ok: false, reason: 'no-right', items: [], rights: 0 };
      return { ok: true, items: rec.items.map((x) => Object.assign({}, x)), rights: this.rights(g), flags: rec.flags || {} };
    },

    /**
     * 从提包取一件遗产（源码 297717 var_65(97)--）：消耗 1 继承权，物品移出遗产记录。
     * @param {number} idx 遗产物品下标
     * @returns {{ok:boolean, item?:object, rights?:number, reason?:string}}
     */
    take(g, idx) {
      const data = this._read();
      const rec = data.record;
      if (!rec) return { ok: false, reason: 'no-legacy' };
      if (this.rights(g) < 1) return { ok: false, reason: 'no-right' };
      const i = idx | 0;
      if (i < 0 || i >= (rec.items || []).length) return { ok: false, reason: 'bad-index' };
      const row = rec.items.splice(i, 1)[0];
      g.setV65(V87, this.rights(g) - 1);         // var_65(97)--
      this._write(data);
      // 生成物品实例（对应 gosub label_2104 把物品交给玩家）
      let it = null;
      if (Elona.ItemDB && typeof Elona.ItemDB.createItem === 'function') {
        try { it = Elona.ItemDB.createItem(row.id, row.n || 1, null); } catch (e) { it = null; }
        if (it && row.f) for (let k = 0; k < row.f.length; k++) it.f[k] = row.f[k] | 0;
        if (it && row.name) it.name = row.name;
      }
      return { ok: true, item: it, row, rights: this.rights(g) };
    },

    /** 效果 1128 是否是遗产权书（供 itemfx / settleReading 判定） */
    isClaimEffect(eff) { return (eff | 0) === EFFECT_CLAIM; },
  };

  Elona.Heirloom = Heirloom;
  if (typeof module !== 'undefined' && module.exports) module.exports = Heirloom;
})(typeof window !== 'undefined' ? window : global);
