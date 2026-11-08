'use strict';
/**
 * 角色模块
 *
 * 原版把所有角色属性放在同一个多维数组 var_58(属性索引, 角色索引) 中。
 * 下面这些索引【已从源码确认】：
 *   [0]   存在标志（1 = 该槽位有角色且活跃）      —— dmghp / cell_draw
 *   [1]   地图 X 坐标                              —— cell_draw / map_placeplayer
 *   [2]   地图 Y 坐标                              —— cell_draw / map_placeplayer
 *   [9]   阵营关系（>=0 / -1 / <-1 用于魔法命中）  —— calcmagiccontrol
 *   [38]  等级 Lv                                  —— 存档 header.txt 拼接
 *   [50]  当前 HP   [51] 最大 HP                   —— healhp
 *   [52]  当前 SP(体力) [53] 最大 SP                —— healsp
 *   [55]  当前 MP   [56] 最大 MP                   —— healmp
 *   [60]  睡意（0..100+，>=100 时 DV/PV 归零）     —— 212388 / label_2106
 *   [182] 满腹度细条（0..100+）                    —— modgauge
 *   [80]  当前所在地图 ID                          —— map_placeplayer
 *   [85]/[86] 特殊场景与进度                       —— dmghp
 *   [167]/[168]/[171]/[172] 骑乘 / 归家坐标        —— map_placeplayer
 *   [264]/[267] buff 相关                          —— dmghp
 * 其余索引【未确认】，保留数值不做解释。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  // 属性索引常量（便于阅读）
  const A = {
    ACTIVE: 0, X: 1, Y: 2, RELATION: 9, LEVEL: 38,
    HP: 50, HP_MAX: 51, SP: 52, SP_MAX: 53, MP: 55, MP_MAX: 56,
    NUTRITION: 22, MAP: 80, RIDE: 167, IS_RIDING: 168, HOME_X: 171, HOME_Y: 172,
  };

  const ATTR_COUNT = 500;   // 原版数组容量（var_58 第二维容量远大于此，这里取够用值）

  class Chara {
    constructor(index) {
      this.index = index;
      this.v = new Array(ATTR_COUNT).fill(0);
      // 名称与外观
      this.name = '';
      this.race = 0;
      this.classId = 0;
      this.raceName = '';       // 种族键名（var_63(2)）
      this.className = '';      // 职业键名（var_63(3)）
      this.cname = '';          // 显示名（含称号）
      // 0-EP：var_63 的另外几个槽（哲学家面具 / 空白名片 / 形态核心用）
      this.raceDisplay = '';    // var_63(7)：种族**显示名**（哲学家面具 59 写入）
      this.classDisplay = '';   // var_63(6)：职业**显示名**（空白名片 60 写入）
      this.altName = '';        // var_63(9)：另一个形态的名字（形态核心 77 互换）
      // 技能/属性值：对应原版 var_82(技能id, 角色)（不含 +600 的成长数组）
      this.skillVals = {};
      // 潜力/成长：对应原版 var_82(技能id+600, 角色)（core/resist.js、core/stats.js 使用）
      this.potential = {};
      // 魔力库存 var_495[200]：法术 400..599 各占一格（仅玩家 index 0 使用）
      this.spellStock = new Array(200).fill(0);
      this.inv = [];
    }
    get(key) { return this.v[key]; }
    set(key, val) { this.v[key] = val; return this; }

    /** 读取技能/属性值 —— 对应 var_82(id, chara) */
    skill(id) { return this.skillVals[id] || 0; }
    setSkill(id, val) { this.skillVals[id] = val; return this; }

    get hp() { return this.v[A.HP]; }
    set hp(x) { this.v[A.HP] = x; }
    get hpMax() { return this.v[A.HP_MAX]; }
    set hpMax(x) { this.v[A.HP_MAX] = x; }
    get mp() { return this.v[A.MP]; }
    set mp(x) { this.v[A.MP] = x; }
    get mpMax() { return this.v[A.MP_MAX]; }
    set mpMax(x) { this.v[A.MP_MAX] = x; }
    get sp() { return this.v[A.SP]; }
    set sp(x) { this.v[A.SP] = x; }
    get spMax() { return this.v[A.SP_MAX]; }
    set spMax(x) { this.v[A.SP_MAX] = x; }
    get level() { return this.v[A.LEVEL]; }
    set level(x) { this.v[A.LEVEL] = x; }
    get x() { return this.v[A.X]; }
    set x(v) { this.v[A.X] = v; }
    get y() { return this.v[A.Y]; }
    set y(v) { this.v[A.Y] = v; }

    toJSON() {
      return {
        index: this.index, v: this.v, name: this.name, race: this.race, classId: this.classId,
        raceName: this.raceName, className: this.className, cname: this.cname,
        raceDisplay: this.raceDisplay || '', classDisplay: this.classDisplay || '',
        altName: this.altName || '',
        alias: this.alias || '',
        skillVals: this.skillVals, inv: this.inv,
        // var_82(id+600)：潜力/成长编码（0-EP 起持久化，否则药水/结晶石的效果读档即失）
        potential: this.potential,
        // var_97 玩家 feat / var_98 能力解锁标志（core/feat.js）
        feats: this.feats, featFlags: this.featFlags,
        // var_508 PCC 部件（core/pcc.js）
        pcc: this.pcc,
        // 魔力库存 var_495
        spellStock: this.spellStock,
      };
    }
    static fromJSON(o) {
      const c = new Chara(o.index);
      c.v = o.v.slice();
      c.name = o.name; c.race = o.race; c.classId = o.classId;
      c.raceName = o.raceName || ''; c.className = o.className || '';
      c.cname = o.cname; c.skillVals = o.skillVals || {};
      c.raceDisplay = o.raceDisplay || '';
      c.classDisplay = o.classDisplay || '';
      c.altName = o.altName || '';
      c.potential = o.potential || {};
      c.alias = o.alias || '';
      c.feats = o.feats || null; c.featFlags = o.featFlags || null;
      c.pcc = o.pcc || null;
      if (Array.isArray(o.spellStock)) {
        for (let i = 0; i < 200; i++) c.spellStock[i] = o.spellStock[i] | 0;
      }
      // 物品实例需要还原为 Item 对象（否则读档后失去方法）
      c.inv = (o.inv || []).map((x) => (global.Elona.Item ? global.Elona.Item.fromJSON(x) : x));
      return c;
    }
  }

  /**
   * `chara_vanquish`（194128-194149）—— 让一个角色从场上消失。
   *
   * 原版不是「删掉这个槽」，而是把 `var_58(0)` 清零；槽位留着，下次
   * `characreate` / 刷怪可复用。这里有三个副作用必须一起做，否则地图
   * 格子上会留下幽灵占位（走到那里会被挡住）：
   *   194129-194134  正在骑乘/被载 → 先把载者的格子标记归位，再 `tag_end`
   *   194136-194138  消失的是坐骑 → `ride_end`
   *   194140-194142  类型 1/10 的常规角色 → 清掉脚下格子的占用
   *   194144-194145  `var_58(0)` / `var_58(150)` 归零
   *   194146-194148  非任务目标（`cbit 992` 未置位）→ `check_quest`
   */
  Chara.vanquish = function (g, idx) {
    const i = idx | 0;
    const c = (g && g.charas) ? g.charas[i] : null;
    if (!c || typeof c.get !== 'function') return false;
    const type = c.get(A.ACTIVE) | 0;
    if (type === 0) return false;                      // 已经是空的

    if ((c.get(A.IS_RIDING) | 0) !== 0) {              // 194129
      const m = g.charas[c.get(A.RIDE) | 0];
      if (m && g.map && g.map.cells && g.map.inBounds && g.map.inBounds(m.x, m.y)) {
        g.map.cells[m.y][m.x][1] = 0;                  // var_704(x,y,1) = 0
      }
    }
    const mount = (g.getV65 ? (g.getV65(183) | 0) : -1);
    if (i === mount) {                                 // 194136
      if (Elona.Riding && Elona.Riding.end) {
        try { Elona.Riding.end(g); } catch (e) { /* 骑乘系统未就绪 */ }
      }
    } else if (type === 1 || type === 10) {            // 194140
      if (g.map && g.map.cells && g.map.inBounds && g.map.inBounds(c.x, c.y)) {
        g.map.cells[c.y][c.x][1] = 0;
      }
    }
    c.set(A.ACTIVE, 0);                                // 194144
    c.set(150, 0);                                     // 194145
    const cb = Elona.Status && Elona.Status.cbit;
    if (!(cb && (cb(c, 992) | 0) === 1) && Elona.QuestCheck && Elona.QuestCheck.check) {
      try { Elona.QuestCheck.check(g); } catch (e) { /* 委托系统未就绪 */ }
    }
    return true;
  };

  /**
   * 部位清单工具（源码 `*label_2235` 219133-219190）。
   * 单独拆出来是因为它只依赖角色的 `get/set`，不依赖 CharaFactory —— 便于单测。
   * 原版用 `getstr var_121, src, cnt*3, 124` 按 3 字节步长切，等价于按 `|` 切分。
   */
  const CharaParts = {
    /** 部位名 → 类型号（219140-219184 的 if 链） */
    NAMES: { '頭': 1, '首': 2, '背': 3, '体': 4, '手': 5, '指': 6, '腕': 7, '腰': 8, '足': 9 },
    /**
     * 把「頭|体|背|手|…」写成 `var_58(100..129)`（= 类型 × 10000）。
     * 结尾固定补 10（尾）与 11（翼）。**不清空**原有槽（原版由调用方先清零）。
     * @returns {number} 写入槽数（含尾部两个）
     */
    apply(c, text) {
      if (!c) return 0;
      let slot = 100;
      const toks = String(text || '').split('|');
      for (let i = 0; i < 30; i++) {
        const t = toks[i];
        if (!t) break;                         // 219137：strsize == 0 → break
        const n = CharaParts.NAMES[t];
        if (!n) continue;
        c.set(slot++, n * 10000);
      }
      c.set(slot++, 10 * 10000);               // 219186
      c.set(slot++, 11 * 10000);               // 219188
      return slot - 100;
    },
  };

  Elona.Chara = Chara;
  Elona.ATTR = A;
  Elona.CharaParts = CharaParts;
})(window);
