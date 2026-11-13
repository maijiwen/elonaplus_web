'use strict';
/**
 * 地图效果（mef / Map Effect）子系统
 * 对应原版 `dim var_490, 9, 200`（23392）与 addmef(32283) / delmef(32264) / cell 字段 var_704(x,y,8)。
 *
 * 【已确认 字段布局】（addmef 32306）
 *   var_490(0, slot) = 类型(type)
 *   var_490(1, slot) = id + prm_693*10000
 *   var_490(2, slot) = x     var_490(3, slot) = y
 *   var_490(4..8, slot) = prm_688..prm_692
 *   地图格 var_704(x, y, 8) = slot + 1（0 = 无 mef）
 *
 * 【已确认 规则】
 *   - addmef(type==5) 且 tile 属性 var_593(0, tile) == 3 时拒绝放置（32285-32288）
 *   - 若格上已有 mef → 复用该槽；否则取第一个空槽；无空槽则随机覆盖一槽并清掉旧格标记（32294-32304）
 *   - delmef：清零该槽 + 清格标记，再把「编号最大的非空槽」搬进来填补（32270-32281，顺序不影响语义）
 *   - delmef 对 type==7 会 evadd 21（事件）→ 由 core/event.js 处理
 *
 * 【已移植】每回合结算 `tick()`（主循环 604202-604340 的类型 3/5/6/13-22）；
 *   type 7 的倒计时 `tickType7()`（603032-603036）与删除事件；
 *   渲染（半透明色块 + type 7 文本）见 renderer.js。
 * 【已移植】类型 6（液体/水渍）：濡湿 25 → 按投掷档结算药水（var_59=15 → 2953，
 *   见 core/potion.js 的 apply/after）→ 敌对行为 → 清除水渍（604313-604340）。
 * 【未移植】击杀归属（check_kill 的归属）、类型 1/2/4/8/9 的特例效果（散落在其它例程）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const SLOTS = 200;
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));   // HSP 整除

  class Mef {
    constructor() {
      this.s = [];
      for (let i = 0; i < SLOTS; i++) this.s.push(new Array(9).fill(0));
    }

    /**
     * addmef(x, y, type, id, a, b, c, d, e, f) —— 逐字移植 32283-32308。
     * 返回占用的槽号；被拒绝时返回 -1。
     */
    add(g, x, y, type, id, a, b, c, d, e, f) {
      const cell = g.map.cell(x, y);
      if (!cell) return -1;
      if (type === 5 && g.map.attr(cell[0], 0) === 3) return -1;      // 32285-32288
      let slot = cell[8] !== 0 ? cell[8] - 1 : -1;                    // 32290-32292
      if (slot === -1) {                                              // 32293-32304
        for (let i = 0; i < SLOTS; i++) { if (this.s[i][0] === 0) { slot = i; break; } }
        if (slot === -1) {
          slot = (g.rng ? g.rng.rnd(SLOTS) : 0);
          const old = this.s[slot];
          const oc = g.map.cell(old[2], old[3]);
          if (oc && oc[8] === slot + 1) oc[8] = 0;
        }
      }
      const n = (v) => (v === undefined ? 0 : v);
      this.s[slot] = [type, id + n(f) * 10000, x, y, n(a), n(b), n(c), n(d), n(e)];
      cell[8] = slot + 1;                                            // 32307
      return slot;
    }

    /**
     * delmef(slot) —— 逐字移植 32264-32282。
     * type==7 时先 `evadd 21, x, y`（32265-32267）：粒子动画事件由 core/event.js 处理。
     */
    del(g, slot) {
      const m = this.s[slot];
      if (!m || m[0] === 0) return;
      if (m[0] === 7 && g.events && typeof g.events.add === 'function') {
        g.events.add(21, m[2], m[3]);
      }
      const cell = g.map.cell(m[2], m[3]);
      if (cell && cell[8] === slot + 1) cell[8] = 0;                 // 32268
      this.s[slot] = new Array(9).fill(0);                           // 32269
      for (let i = SLOTS - 1; i > slot; i--) {                       // 32270-32281
        if (this.s[i][0] !== 0) {
          this.s[slot] = this.s[i].slice();
          const c2 = g.map.cell(this.s[slot][2], this.s[slot][3]);
          if (c2) c2[8] = slot + 1;
          this.s[i] = new Array(9).fill(0);
          break;
        }
      }
    }

    /** var_490(0, slot)：mef 类型（供视线/路径的 type==9 判定用） */
    typeOf(slot) { return (this.s[slot] ? this.s[slot][0] : 0); }

    /** 地图格 (x,y) 上的 mef 类型；无则返回 0 */
    typeAt(g, x, y) {
      const cell = g.map.cell(x, y);
      if (!cell || cell[8] === 0) return 0;
      return this.typeOf(cell[8] - 1);
    }

    /**
     * 每回合结算 —— 主地图循环 604202-604340 的 mef 部分。
     *   类型 3（酸）     ：var_82(63)/50 < 7 时受 rnd(power/25+5)+1 伤害（元素 63）
     *   类型 5（火）     ：power>=0 → power/12 + rnd(power/12+5) 伤害（元素 50）；
     *                      power<0  → dmgmp(rnd(10) - power/100)
     *   类型 13..22     ：power/2 + rnd(power/2+5)，经 calcmagiccontrol 后按类型施加 dmgcon 并扣血（元素 68）
     *   类型 6（液体）   ：wet(25) + 按投掷档用药水（2953）+ 敌对行为 + 清除水渍
     * 【未移植】check_kill 的击杀归属。
     * @returns {object|null} 结算结果（无 mef 时 null）
     */
    tick(g, c) {
      if (!c || c.get(0) !== 1 || !g.map) return null;
      const cell = g.map.cell(c.x, c.y);
      if (!cell || cell[8] === 0) return null;
      const slot = cell[8] - 1;
      const m = this.s[slot];
      if (!m || m[0] === 0) return null;
      const type = m[0];
      const power = m[5];
      const src = m[6];
      const rng = g.rng || Elona.rng;
      const R = (n) => rng.rnd(n);
      const res = { type, slot, power };
      const cbit = (bit) => (Elona.Status ? Elona.Status.cbit(c, bit) : 0);
      const findbuff = (id) => (Elona.Status ? Elona.Status.findbuff(c, id) : -1);

      if (type === 3) {                                        // 604210-604234 酸
        if ((cbit(5) === 0 || c.get(262) > 0) && findbuff(52) === -1 && idiv(c.skill(63), 50) < 7) {
          const dmg = R(idiv(power, 25) + 5) + 1;
          if (Elona.Battle) Elona.Battle.applyDamage(c, dmg);
          res.dmg = dmg;
        }
        return res;
      }
      if (type === 5) {                                        // 604235-604258 火
        if (power >= 0) {
          const dmg = idiv(power, 12) + R(idiv(power, 12) + 5);
          if (Elona.Battle) Elona.Battle.applyDamage(c, dmg);
          res.dmg = dmg;
        } else if (Elona.Status && Elona.Status.dmgmp) {
          Elona.Status.dmgmp(c, R(10) - idiv(power, 100), g);
          res.mp = true;
        }
        return res;
      }
      if (type >= 13 && type <= 22) {                          // 604259-604312 属性残滓
        let v = idiv(power, 2) + R(idiv(power, 2) + 5);
        if (Elona.Spell && Elona.Spell.calcMagicControl && src >= 0 && g.charas && g.charas[src]) {
          const mc = Elona.Spell.calcMagicControl(g, g.charas[src], c, v);
          if (mc.avoided) { res.dmg = 0; return res; }                  // 604262 stat==1 → 跳过整个残滓效果
          v = mc.dmg;
        }
        if (v >= 0) {
          const COND = { 13: 22, 14: 23, 15: 3, 16: 4, 17: 6, 18: 1, 19: 21, 20: 7, 21: 2, 22: 5 };
          if (COND[type] !== undefined && Elona.Resist && g.dmgconTable) {
            Elona.Resist.dmgcon(g, g.dmgconTable, c, COND[type], idiv(v, 10) + 1);
          }
          if (Elona.Battle) Elona.Battle.applyDamage(c, v);
          res.dmg = v;
        }
        return res;
      }
      if (type === 6) {                                        // 604313-604340 液体
        if ((cbit(5) === 0 || c.get(262) > 0) && findbuff(52) === -1) {
          if (Elona.Status && Elona.Status.wet) Elona.Status.wet(c, 25);
          res.wet = true;
          // 604332-604338：踩到水渍 → 等同于被投掷这份药水（var_59=15 → label_0598）
          //   var_2431 = 1（投掷档）、var_2362 = mef 的诅咒等级、物品 id = m[7]
          const itemId = m[7] | 0;
          const curse = m[8] | 0;
          const caster = (g.charas && g.charas[src]) ? g.charas[src] : null;
          if (itemId && Elona.Potion && Elona.Potion.apply) {
            const r = Elona.Potion.apply(g, caster || c, c, itemId, power | 0, curse,
              { thrown: true, noAfter: true });
            if (r) {
              res.potion = { itemId, power: r.power, messages: r.messages };
            }
            // 投掷档：水分 +400、饱腹 +30（314906-314915）
            res.after = Elona.Potion.after(g, caster || c, c, itemId, { thrown: true });
          }
          // 604334：非玩家投出的水渍 → 记一次敌对行为
          const HA = (Elona.Intimacy && Elona.Intimacy.hostileAction)
            || (Elona.Relation && Elona.Relation.hostileAction);
          if (src !== 0 && (c.index | 0) !== 0 && HA && g.charas && g.charas[src]) {
            HA(g, g.charas[src], c);
          }
          this.del(g, slot);                                    // 604339
        }
        return res;
      }
      return res;
    }

    /**
     * type 5（火）的扩散（602981-603021，每小时一次）。
     * 源码（main_init 的 mef 段）：
     *   · var_126(14) == 2（野外）且 var_126(6) != 1（不在世界地图）时才扩散
     *   · 天气 3/4（雨/雪）时直接 delmef（火被浇灭）
     *   · 地图 33 / 73 且第 100 层时直接 delmef
     *   · 每小时 rnd(35) == 0 → 向 3 个随机相邻格扩散火焰 mef，并对该格调用 mapitem_fire
     * @returns {object} 扩散结果 { spread: [{x,y}], burned: number }
     */
    spreadFire(g) {
      const out = { spread: [], burned: 0 };
      if (!g || !g.map) return out;
      // 野外（var_126(14) == 2）且不在世界地图（var_126(6) != 1）时才扩散
      const mapType = (g.map.header && g.map.header[6] | 0) || 0;
      if (mapType === 1) return out;
      const rng = g.rng || Elona.rng;
      const R = (n) => rng.rnd(n);
      for (let i = 0; i < SLOTS; i++) {
        const m = this.s[i];
        if (!m || m[0] !== 5) continue;
        // 602982-602987：野外且不是世界地图时，天气 3/4 会浇灭火焰
        const weather = g.getV65 ? (g.getV65(17) | 0) : 0;
        if (mapType !== 1 && (weather === 3 || weather === 4)) {
          this.del(g, i);
          continue;
        }
        // 602988-602995：地图 33 / 73 的第 100 层不燃烧
        const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
        const depth = g.getV65 ? (g.getV65(22) | 0) : 0;
        if ((mapId === 33 || mapId === 73) && depth === 100) { this.del(g, i); continue; }
        // 603001-603006：1/35 的概率扩散
        if (R(35) !== 0) continue;
        const fx = m[2], fy = m[3];
        const power = m[5], src = m[6];
        for (let k = 0; k < 3; k++) {
          const nx = R(2) + fx - R(2);
          const ny = R(2) + fy - R(2);
          if (nx < 0 || ny < 0 || nx >= g.map.width || ny >= g.map.height) continue;
          const cell = g.map.cell(nx, ny);
          if (!cell) continue;
          // 603014-603017：目标是墙 → 变成地板
          if ((g.map.attr(cell[0], 7) & 4) !== 0) { cell[0] = 37; continue; }
          this.add(g, nx, ny, 5, 24, R(15) + 20, power, src);
          out.spread.push({ x: nx, y: ny });
          if (Elona.ItemDB && Elona.ItemDB.mapitemFire) {
            if (Elona.ItemDB.mapitemFire(g, nx, ny, null)) out.burned++;
          }
        }
      }
      return out;
    }

    /**
     * type 7 的计数（603032-603036）：
     * `var_490(4)` 不为 -1 时每回合递减，减到 0 则 delmef（进而触发事件 21）。
     * 其余类型无此行为。
     */
    tickType7(g) {
      const out = [];
      for (let i = 0; i < SLOTS; i++) {
        const m = this.s[i];
        if (!m || m[0] !== 7) continue;
        if ((m[4] | 0) !== -1) {
          m[4]--;
          if (m[4] <= 0) {
            out.push({ slot: i, x: m[2], y: m[3] });
            this.del(g, i);
          }
        }
      }
      return out;
    }

    /** 遍历所有非空槽（渲染 type 7 文本/blink 用） */
    forEach(fn) {
      for (let i = 0; i < SLOTS; i++) {
        const m = this.s[i];
        if (m && m[0] !== 0) fn(m, i);
      }
    }

    toJSON() { return { s: this.s }; }
    static fromJSON(o) {
      const m = new Mef();
      if (o && Array.isArray(o.s)) {
        for (let i = 0; i < SLOTS; i++) if (o.s[i]) m.s[i] = o.s[i].slice();
      }
      return m;
    }
  }

  Elona.Mef = Mef;
})(window);
