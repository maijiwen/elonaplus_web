/**
 * 呕吐 —— `chara_vomit`（hsp/start.hsp 201629-201739）。
 *
 * 触发场景（源码 15 处调用）里，本项目当前能接上的是「吃太多」两条：
 *   314918-314921  吃完后 satiety > 12000*2 且 rnd(5)==0
 *   604582-604587  每回合 satiety > 35000 且 rnd(60 + f[404]*5)==0
 * 其余的（陷阱/毒/战斗效果）依赖尚未移植的状态源，未接。
 *
 * 函数本体逐段对照：
 *   201630  var_58(93)++                     呕吐计数
 *   201636  "○○は吐いた。"                   消息
 *   201639  cbit(978) → 清位、var_58(430)=0   吐出体内异物
 *   201653  移除 type 3 的 buff（280+3n）      ← 0-EY 已实现（core/foodleft.js 的表 20..28、67）
 *   201664  地图类型 != 1：统计背包里的 704（吐瀉物），
 *           `rnd(n^3)==0 || 是玩家` → 脚下生成 704
 *   201686  拒食症 cbit(986)：计数 > 10 且 rnd(5)==0 → 患病；
 *           玩家持有 1018（健康のお守り）时 rnd(64)>=1 → 立即痊愈
 *   201718  已患拒食症 → 筋力/耐久/魅力 潜力下降
 *   201725  dmgcon 7（吐き気）
 *   201726  modweight -(1+rnd(5))            ← 0-EX 已实现（var_58(20)，与 potion.js 同源）
 *   201727  饥饿（f22<=0）且计数>0 → 伤害
 *   201737  f22 -= 3000、f446 -= 1000
 */
(function (global) {
  'use strict';
  const Elona = global.Elona = global.Elona || {};

  /** 关键字段（var_58） */
  const F = {
    SATIETY: 22,        // 満腹度
    NUTRITION: 446,     // 栄養
    VOMIT: 93,          // 呕吐次数
    FOREIGN: 430,       // 体内异物
    ANOREXIA_REF: 58,   // 拒食症复发判定用
  };

  /** 位标志 */
  const BIT = { FOREIGN: 978, ANOREXIA: 986 };

  /** 吐瀉物 / 健康のお守り */
  const ITEM_VOMIT = 704;
  const ITEM_AMULET = 1018;

  /** 条件 id 7 = 吐き気（dmgcon） */
  const COND_NAUSEA = 7;

  function cbit(c, bit) {
    return Elona.Status && Elona.Status.cbit ? (Elona.Status.cbit(c, bit) | 0) : 0;
  }
  function cbitmod(c, bit, on) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit, on);
  }
  function cond(g, c, id, power) {
    if (Elona.Resist && g.dmgconTable) Elona.Resist.dmgcon(g, g.dmgconTable, c, id, power);
  }

  /**
   * 地图类型（var_126(6)）—— 只用来判断「是否世界地图（==1）」。
   * 本项目没有 var_132 的完整表，按地图名近似：world → 1、dungeon* → 3、其余按城镇 20。
   */
  function mapTypeOf(g) {
    const n = (g.map && g.map.name) || '';
    if (n === 'world' || n.indexOf('world') === 0) return 1;
    if (n.indexOf('dungeon') === 0) return 3;
    return 20;
  }

  /** 背包里某物品的总数（对应 inv_getheader 的遍历） */
  function countItem(c, id) {
    let n = 0;
    const inv = c.inv || [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (it && (it.f[0] | 0) > 0 && it.id === id) n += it.f[0] | 0;
    }
    return n;
  }

  /**
   * 执行一次呕吐。
   * @param {object} g 游戏
   * @param {object} c 角色（玩家 c.index === 0）
   * @returns {object} 结果摘要（便于测试与界面提示）
   */
  function vomit(g, c) {
    const rnd = (n) => g.rng.rnd(Math.max(1, n | 0));
    const isPlayer = (c.index | 0) === 0;
    const out = {
      ok: true, vomited: true, dropped: false, anorexia: false, cured: false,
      damage: 0, messages: [],
    };
    // 201630：计数 +1
    c.set(F.VOMIT, (c.get(F.VOMIT) | 0) + 1);

    const en = !!(Elona.Options && Elona.Options.values && Elona.Options.values.lang === 'en');
    // 角色名：Chara 上是字符串字段，怪物模板里也可能是 name(lang) 函数
    const nm = (typeof c.name === 'function' ? (c.name('en') || '') : (c.name || '')) || '某人';
    out.messages.push(en ? `${nm} vomits.` : `${nm} 吐了。`);

    // 201639-201651：吐出体内异物
    if (cbit(c, BIT.FOREIGN)) {
      cbitmod(c, BIT.FOREIGN, false);
      out.messages.push(en ? `${nm} spits out the foreign object!` : `${nm} 吐出了体内的异物！`);
      c.set(F.FOREIGN, 0);
      if (isPlayer) c.set(54, 0);        // var_98(654-600) = 0（玩家能力标志）
    }

    // 201653-201663：删除全部 type 3（加速成长类）buff —— var_75(0,id)==3 的 20..28、67
    if (Elona.FoodLeft && Elona.FoodLeft.clearGrowthBuffs) {
      const removed = Elona.FoodLeft.clearGrowthBuffs(g, c);
      if (removed) out.growthBuffsRemoved = removed;
    }

    // 201664-201684：生成吐瀉物
    //   地图类型 != 1（非世界地图）；n = 2 + 背包里 704 的数量
    if (mapTypeOf(g) !== 1) {
      const n = 2 + countItem(c, ITEM_VOMIT);
      if (rnd(n * n * n) === 0 || isPlayer) {
        let it = null;
        try { it = Elona.ItemDB.createItem(ITEM_VOMIT, 1); } catch (_) { it = null; }
        if (it) {
          it.f[5] = c.x; it.f[6] = c.y; it.f[21] = -1;
          if (!isPlayer) it.f[23] = c.get(27) | 0;   // 201680：价格 = 该角色的所持金
          if (g.groundItems) {
            g.groundItems.push(it);
            if (g.refreshGroundCell) g.refreshGroundCell(c.x, c.y);
          }
          out.dropped = true;
          out.messages.push(en ? 'Something is left on the ground.' : '地上留下了什么。');
        }
      }
    }

    // 201686-201724：拒食症
    if (cbit(c, BIT.ANOREXIA) === 0) {
      const cnt = c.get(F.VOMIT) | 0;
      const trigger = isPlayer
        ? (cnt > 10)
        : (rnd(4) === 0);
      if (trigger && rnd(5) === 0) {
        cbitmod(c, BIT.ANOREXIA, true);
        out.anorexia = true;
        out.messages.push(en ? `${nm} develops an anorexia.` : `${nm} 得了拒食症。`);
        // 玩家的健康のお守り有 63/64 概率立刻治愈
        if (isPlayer && countItem(c, ITEM_AMULET) >= 1) {
          if (rnd(64) >= 1) {
            cbitmod(c, BIT.ANOREXIA, false);
            out.anorexia = false;
            out.cured = true;
            out.messages.push(en ? 'But Amulet of Jure shines and the anorexia has gone.'
              : '但是健康のお守り发出光芒，拒食症立刻痊愈了。');
          }
        }
      }
    } else {
      // 201719：已患病 → 潜力下降（f58==100 或 玩家 f25<4）
      if ((c.get(F.ANOREXIA_REF) | 0) === 100 || (isPlayer && (c.get(25) | 0) < 4)) {
        if (Elona.Stats && Elona.Stats.skillMod) {
          Elona.Stats.skillMod(c, 10, c, -50, g);
          Elona.Stats.skillMod(c, 11, c, -75, g);
          Elona.Stats.skillMod(c, 17, c, -100, g);
        }
      }
    }

    // 201725：吐き気
    cond(g, c, COND_NAUSEA, 100);

    // 201726：modweight -(1+rnd(5)) —— 体重字段 var_58(20)（与 potion.js modWeight 同源）
    const wLoss = 1 + rnd(5);
    c.set(20, Math.max(0, (c.get(20) | 0) - wLoss));
    out.weightLoss = wLoss;

    // 201727-201736：饥饿状态下呕吐会掉血
    if ((c.get(F.SATIETY) | 0) <= 0 && (c.get(F.VOMIT) | 0) > 0) {
      const per = c.skill ? (c.skill(13) | 0) : 0;
      const cnt = Math.min(30, Math.max(1, c.get(F.VOMIT) | 0));
      const dmg = Math.trunc(per / 10) * cnt + 10;
      out.damage = dmg;
      if (Elona.Status && Elona.Status.dmghp) Elona.Status.dmghp(g, c, dmg, -3);
      else c.hp = Math.max(0, (c.hp | 0) - dmg);
    }

    // 201737-201738
    c.set(F.SATIETY, (c.get(F.SATIETY) | 0) - 3000);
    c.set(F.NUTRITION, (c.get(F.NUTRITION) | 0) - 1000);

    return out;
  }

  // ---------------------------------------------------------------- 触发
  /**
   * 吃完后的「吃太多」判定 —— 314918-314921。
   * @returns {object|null} 触发时返回 vomit 的结果
   */
  function afterEat(g, c) {
    if ((c.get(F.SATIETY) | 0) <= 12000 * 2) return null;
    if (g.rng.rnd(5) !== 0) return null;
    return vomit(g, c);
  }

  /**
   * 每回合的「过量」判定 —— 604582-604587。
   * 注意源码还带 `var_58(257) >= 45`（该字段语义未确认，未纳入）。
   * @returns {object|null}
   */
  function tickTurn(g, c) {
    if ((c.get(F.SATIETY) | 0) <= 35000) return null;
    const denom = 60 + (c.get(404) | 0) * 5;
    if (g.rng.rnd(Math.max(1, denom)) !== 0) return null;
    return vomit(g, c);
  }

  Elona.Vomit = {
    F, BIT, ITEM_VOMIT, ITEM_AMULET, COND_NAUSEA, mapTypeOf,
    vomit, afterEat, tickTurn,
  };
})(typeof window !== 'undefined' ? window : globalThis);
