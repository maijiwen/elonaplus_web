'use strict';
/**
 * 异常状态（状态异常）系统 —— 对应原版的 cbit / findbuff / addbuff / healcon
 * 以及每回合结算例程 label_2224(215805-216701)。
 *
 * 【已确认公式来源（start.hsp 行号）】
 *   cbit(bit, chara)      (277-279)   --------------------------------------------------
 *     word = var_58(450 + bit/32, chara)；返回 word 的第 (bit%32) 位（0/1）
 *   cbitmod(bit, chara, v) (280-287)  置位/清位
 *   findbuff(chara, id)   (194668-194679) ----------------------------------------------
 *     在 16 个增益槽（每槽 3 个字段，起点 var_58(280)）中查找 id，返回槽号或 -1
 *     槽内布局：280+slot*3 = id；+1 = 参数1；+2 = 参数2
 *   addbuff(chara, id, p1, p2) (194682+) -----------------------------------------------
 *     p2<=0 → 无效；已有同 id 且现有 p2>=新 p2 → 无效；否则占用空槽/同 id 槽
 *     【未移植】原版按 var_75(0,id)==2 等对 p1/p2 的修正与提示文本
 *   healcon(chara, kind, amount) (196316-196628) --------------------------------------
 *     按 kind 找到对应状态字段并扣除 amount；归零时清 0（kind==3 麻痺例外，置 -1）
 *   label_2224 每回合结算 (215805-216701) --------------------------------------------
 *     见下方 statusTick()，已逐条对照原版
 *
 * 【HSP 语义】`/` 为整数除法（向零截断）；`\` 为取模。
 * 【依赖】扣血/回血沿用 Elona.Battle.applyDamage / 本模块 healhp / healmp。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // ---- healcon 的 kind → 状态字段映射（源自 196316-196628 的 prm_958 分派）----
  const KIND_FIELD = {
    22: 175, 23: 176, 6: 255, 4: 253, 5: 254, 3: 252, 18: 412, 21: 445,
    1: 250, 2: 251, 7: 256, 9: 258, 8: 257, 11: 260, 12: 261,
  };

  // ---- 状态表（由 data/tables/status.json 提供；同时缓存 condId → field）----
  let STATUS_TABLE = null;
  let FIELD_BY_COND = null;

  async function loadTable() {
    if (STATUS_TABLE) return STATUS_TABLE;
    const raw = await Elona.Data.table('status');
    STATUS_TABLE = raw.conditions;
    FIELD_BY_COND = {};
    for (const k in STATUS_TABLE) FIELD_BY_COND[k] = STATUS_TABLE[k].field;
    return STATUS_TABLE;
  }

  /** 同步设置状态表（无网络环境/测试用） */
  function setTable(conditions) {
    STATUS_TABLE = conditions;
    FIELD_BY_COND = {};
    for (const k in conditions) FIELD_BY_COND[k] = conditions[k].field;
  }

  // ================= cbit / cbitmod（277-287）=================
  function cbit(c, bit) {
    const word = c.get(450 + idiv(bit, 32));
    return (word >>> (bit % 32)) & 1;
  }
  function cbitmod(c, bit, on) {
    const idx = 450 + idiv(bit, 32);
    const mask = 1 << (bit % 32);
    const word = c.get(idx);
    c.set(idx, on ? (word | mask) : (word & ~mask));
  }

  // ================= findbuff / addbuff（194668-）=================
  function buffSlotId(c, slot) { return c.get(280 + slot * 3); }
  function findbuff(c, id) {
    for (let cnt = 0; cnt < 16; cnt++) {
      const cur = c.get(280 + cnt * 3);
      if (cur === 0) return -1;
      if (cur === id) return cnt;
    }
    return -1;
  }
  /**
   * 添加增益/减益。返回 1 = 已写入；0 = 无效（原版会给出提示文本，此处省略）。
   * 【未移植】原版对 var_75(0,id)==2 等类型会改写 p1/p2，且“已有同强度”时提示。
   */
  function addbuff(g, c, id, p1, p2) {
    if (p2 <= 0) return 0;
    let slot = -1;
    for (let cnt = 0; cnt < 16; cnt++) {
      const cur = c.get(280 + cnt * 3);
      if (cur === id) {
        if (c.get(280 + cnt * 3 + 2) < p2) { slot = cnt; break; }
        return 0;   // 已有同强度或更强的同种增益 → 无效
      }
      if (cur === 0) { slot = cnt; break; }
    }
    if (slot === -1) slot = (g.rng ? g.rng.rnd(16) : 0);
    c.set(280 + slot * 3, id);
    c.set(280 + slot * 3 + 1, p1);
    c.set(280 + slot * 3 + 2, p2);
    return 1;
  }
  /**
   * 删除增益 —— delbuff(194798-194830)：清空第 slot 槽并把后续槽位整体前移。
   * 副作用：id 16 → 清 cbit(973)；18 → 清 cbit(980)；36 → var_58(174)=0；63 → var_65(250+419)=0。
   * 【未移植】id 15 的 incognitoend（UI）、prm_930==0 时的提示文本。
   * 【近似】var_65(250+419) 为全局值，此处写入角色字段 var_58(250+419) 近似（未确认）。
   */
  function delbuff(c, slot) {
    const id = c.get(280 + slot * 3);
    if (id === 16) cbitmod(c, 973, false);
    if (id === 18) cbitmod(c, 980, false);
    if (id === 36) c.set(174, 0);
    if (id === 63) c.set(250 + 419, 0);
    c.set(280 + slot * 3, 0);
    for (let cnt = slot; cnt < 16 - 1; cnt++) {              // repeat 15-slot, slot
      if (c.get(280 + cnt * 3) === 0 && c.get(280 + (cnt + 1) * 3) !== 0) {
        for (let f = 0; f < 3; f++) {
          c.set(280 + cnt * 3 + f, c.get(280 + (cnt + 1) * 3 + f));
          c.set(280 + (cnt + 1) * 3 + f, 0);
        }
      }
    }
  }

  // ================= healcon（196316-196628）=================
  /**
   * 递减/清除某个状态。
   * @param {number} kind    条件种类（1..23，与 dmgcon 的 condId 一致）
   * @param {number} amount  扣除量；0 = 直接清除
   */
  function healcon(c, kind, amount) {
    const f = KIND_FIELD[kind];
    if (f === undefined) return 0;
    if (c.get(f) > 0) {
      if (amount === 0) c.set(f, 0);
      else c.set(f, c.get(f) - amount);
      if (c.get(f) <= 0) c.set(f, kind === 3 ? -1 : 0);   // 麻痺(kind3)归零后置 -1
    }
    return 1;
  }

  /**
   * cure_anorexia（201615-201628）：清除拒食症 cbit(986)（源码同段还有提示文案与音效）。
   * 四条治愈途径：精英品质自然回复（216676）、起床（311873）、绿茶/永生蜜酒（319168）。
   * @returns {number} 1 = 原本患病且已治愈
   */
  function cureAnorexia(g, c) {
    if (!c || cbit(c, 986) === 0) return 0;
    cbitmod(c, 986, 0);
    if (g && g.log && (c.index | 0) < 16) g.log(`${c.name}的厌食症治好了。`);
    return 1;
  }

  /** 游戏内小时数（var_65(10..13)，与 cook.js clockHours 同式） */
  function clockHours(g) {
    const V = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    return V(13) + V(12) * 24 + V(11) * 24 * 30 + V(10) * 24 * 30 * 12;
  }

  /**
   * 饱腹度 / 水分每小时衰减 —— label_2223（215675-215801），
   * 由每小时的 *label_4352（603447 gosub）调用；不是每回合。
   *   var_1449 = 8*50 = 400（世界地图 8*10 = 80；地图 54 三层为 8，项目无该表 → 略）。
   *   水分 446：未濡湿 −decay/2；濡湿时（<10000）+decay；buff61 再 −decay/4；NPC <3000 → 3000。
   *   饱腹 22：−decay；var_58(42)<=-2000000 再 −decay；buff61 再 −decay/2；
   *     **feat 158（朱伊安人「饥饿缓和」）**：<=5000 时 +decay/2，即净衰减减半（215756-215759）。
   *     NPC <3000 且未患拒食症 → 3000（215796-215798）。
   *   注：源码 `var_97(158)` 是**玩家**的天赋数组，却对循环里的所有角色生效 —— 照抄。
   * @param {number} hours 本次推进的小时数
   */
  function foodTick(g, hours) {
    const n = Math.max(0, hours | 0);
    if (!n || !g || !g.charas) return 0;
    const decay = g.worldMap ? 80 : 400;                 // 215676-215681
    const map900 = (g.var65_250_2 | 0) === 900;          // 215694/215747 `var_65(250+2) != 900`
    const slow = !!(Elona.Feat && g.player && Elona.Feat.get && Elona.Feat.get(g.player, 158));
    let touched = 0;
    for (let h = 0; h < n; h++) {
      for (const c of g.charas) {
        if (!c || (c.get(0) | 0) !== 1) continue;
        const isP = (c.index | 0) === 0;
        const w0 = idiv(c.get(446) | 0, 1000), f0 = idiv(c.get(22) | 0, 1000);
        let w = c.get(446) | 0;
        if (w <= 0) w = 1;                                // 215689-215691
        const wet = c.get(259) | 0;
        if (!map900 && wet <= 0) w -= idiv(decay, 2);    // 215693-215697
        if (wet > 0 && w < 10000) w += decay;            // 215698-215701
        if (findbuff(c, 61) !== -1) w -= idiv(decay, 4);// 215702-215704
        if (!isP && w < 3000) w = 3000;                  // 215743-215745
        let f = c.get(22) | 0;
        if (!map900) f -= decay;                         // 215747-215749
        if ((c.get(42) | 0) <= -2000000) f -= decay;     // 215750-215752
        if (findbuff(c, 61) !== -1) f -= idiv(decay, 2);// 215753-215755
        if (slow && f <= 5000) f += idiv(decay, 2);      // 215756-215759 feat 158
        if (!isP && f < 3000 && cbit(c, 986) === 0) f = 3000;  // 215796-215798
        c.set(446, w); c.set(22, f);
        touched++;
        // 215705-215741 / 215761-215795：玩家跨越 1000/2000/5000 档位时的提示
        if (isP && g.log) {
          const w1 = idiv(w, 1000), f1 = idiv(f, 1000);
          if (w1 !== w0 && (w0 === 1 || w0 === 2 || w0 === 5)) {
            g.log(w0 === 1 ? '再不喝水就要变成木乃伊了！'
              : (w0 === 2 ? '口渴得眼冒金星……' : '喉咙干了，得喝点什么。'));
          }
          if (f1 !== f0 && (f0 === 1 || f0 === 2 || f0 === 5)) {
            g.log(f0 === 1 ? '再不吃就要饿死了！'
              : (f0 === 2 ? '饿得头晕……' : '肚子饿了。'));
          }
        }
      }
    }
    return touched;
  }

  /**
   * 食物腐烂的时间推进 —— 223820-223946（每小时由时间推进例程调用）。
   *   f[24]==35（食材材质）且 f[27]>0 且 f[27] <= 当前小时 → f[27]=-1、f[2]=336。
   *   ibit(19)（防腐处理）免疫；背包/地面都扫描。
   *   0-EY：地面冷藏格生肉持续保鲜（223823-223838）、牧场晾晒石干制
   *   （223846-223920，晴天 / mapType 31 / dryrock 格）由 core/foodleft.js 判定。
   *   【仍未移植】牧场工人特例（223856-223862）与 var_593 完整地面设施表。
   */
  function rotTick(g, advancedHours) {
    if (!g) return 0;
    const now = clockHours(g) + Math.max(0, advancedHours | 0);   // 在推进后的时刻判定
    const db = Elona.ItemDB;
    const FL = Elona.FoodLeft;
    const preserved = (it) => !!(db && db.ibit && db.ibit(19, it));
    let n = 0;
    const scan = (list, ground) => {
      for (const it of (list || [])) {
        if (!it || !it.f || (it.f[0] | 0) <= 0) continue;
        if ((it.f[24] | 0) !== 35) continue;
        const until = it.f[27] | 0;
        if (until <= 0) continue;                         // -1 已腐坏
        // 223823-223838：地面生肉在冷藏格上，每小时把到期时刻推到 now+72
        if (ground && FL && FL.fridgeCheck(g, it, now)) continue;
        if (until > now) continue;                        // 未到期
        if (preserved(it)) continue;                     // 223850 ibit(19)
        // 223846-223920：晾晒石干制；非晴天时源码 continue（本次既不干制也不腐烂）
        if (ground && FL) {
          const pre = FL.rotCheck(g, it, ground, now);
          if (pre) continue;
        }
        it.f[27] = -1;                                   // 223943
        it.f[2] = 336;                                   // 223944
        n++;
        if (!ground && g.log) g.log(`有食物腐烂了。（${db && db.name ? db.name(it.id, 'ch') : '食物'}）`);
      }
    };
    scan(g.player && g.player.inv, false);
    scan(g.groundItems, true);
    return n;
  }

  // ================= 回血/回蓝（healhp / healmp，196278/196295）=================
  function healhp(c, n) {
    const before = c.hp;
    c.hp = Math.min(c.hp + n, c.hpMax);
    const delta = c.hp - before;
    // 原版 healhp 同时在饱食度 <100 时补充营养（var_1099 默认为 >=0）
    if (c.get(60) < 100) {
      c.set(60, c.get(60) + idiv(delta * 40, c.hpMax));
      if (c.get(60) >= 100) c.set(60, 99);
    }
  }
  /**
   * healmp（196295-196304）：回复 MP（上限钳制到 mpMax，因此治不好负值 MP）。
   * 同时魔力漏出（侵蝕 var_58(445)）>1 时衰减：445 = 445/2 - 10，下限 1
   * （只有 healcon(c,21,0) 才能彻底清除）。
   */
  function healmp(c, n) {
    c.mp = Math.min(c.mp + n, c.mpMax);
    if ((c.get(445) | 0) > 1) {
      let v = idiv(c.get(445) | 0, 2) - 10;
      if (v < 1) v = 1;
      c.set(445, v);
    }
  }
  /**
   * dmgmp（201391-201441）：扣除 MP —— 「魔力反噬」子系统的本体。
   *   ① 魔力漏出（侵蝕 445）> 0 时追加损耗：445 上限 100，
   *      额外 = 445*50，源码 `if (var_1182 == 0) /5` 中 var_1182 从未被赋值（恒 0）
   *      → 恒等于额外 = 445*10（201397-201400，照抄反编译源码）。
   *   ② MP 下限 -99999（201402-201404）。
   *   ③ MP 变负 → 魔力反噬（201415-201436）：
   *      伤害 = -MP * 400 / (100 + 魔力极限(164)*10)
   *      玩家持 feat 156（艾莱亚人「魔力反噬减半」）→ 再 /2；
   *      NPC → /5（-80%），且伤害 <10 时不结算。
   *      命中走 dmghp（元素 -2 = 无元素减免）→ Battle.applyDamage。
   * @param {object} [g] 传入 g 才结算反噬（含文案）；只扣 MP 的旧调用保持兼容
   * @returns {number} 实际扣除量（含漏出增幅）
   */
  function dmgmp(c, n, g) {
    let amt = n | 0;
    const leak = c.get(445) | 0;
    if (leak > 0) {
      const capped = leak > 100 ? 100 : leak;
      c.set(445, capped);
      amt += idiv(capped * 50, 5);                       // 201397-201400
    }
    c.mp -= amt;
    if (c.mp < -99999) c.mp = -99999;                    // 201402-201404
    if (c.mp < 0 && g) manaBacklash(g, c);               // 201405
    return amt;
  }
  /**
   * 魔力反噬（201415-201436）：「マナの反動がXの精神を蝕んだ！」。
   * 与 wiki「魔法技能·魔力极限」页一致：
   *   反噬伤害 = 负蓝量绝对值 * 400 / (100 + 魔力极限*10)；艾莱亚 PC 再降一半，NPC 降 80%。
   * @returns {number} 1 = 流程完成（含 NPC 伤害 <10 的跳过分支，源码 201426 同样 return 1）
   */
  function manaBacklash(g, c) {
    // 201415-201417 → *label_2158：MP 变负时练「魔力の限界 164」
    //   `limit(abs(MP) * 400 / (maxMP + 1), 1, 400)`
    if (Elona.Stats && Elona.Stats.skillExp) {
      const ex = limit(idiv((-c.mp) * 400, (c.get(56) | 0) + 1), 1, 400);
      try { Elona.Stats.skillExp(c, 164, c.index | 0, ex, 0, 0, g); } catch (e) { /* noop */ }
    }
    let dmg = idiv((-c.mp) * 400, 100 + (c.skill(164) | 0) * 10);   // 201418
    if ((c.index | 0) === 0) {
      if (Elona.Feat && Elona.Feat.get && Elona.Feat.get(c, 156)) { // 201420-201421
        dmg = idiv(dmg, 2);
      }
    } else {
      dmg = idiv(dmg, 5);                                          // 201424
      if (dmg < 10) return 1;                                      // 201426-201427
    }
    if (g.log) g.log(`魔力反噬侵蚀了${c.name}的精神！（${dmg} 点伤害）`);
    if (Elona.Battle && Elona.Battle.applyDamage) {
      // 201435：dmghp cc, dmg, -2 —— 元素 -2 无属性减免链
      Elona.Battle.applyDamage(c, dmg, g, null, 0, 0);
    }
    return 1;
  }
  /**
   * healsan（201469）：降低狂気值 var_58(86)，下限 0；cbit(1039) 时下限抬到 10。
   * 【未确认】var_58(86) 语义（chara.js 注释曾记为"特殊场景/进度"，此处按 healsan 用法视为狂気值）。
   */
  function healsan(c, n) {
    c.set(86, Math.max(0, c.get(86) - n));
    if (cbit(c, 1039) === 1 && c.get(86) < 10) c.set(86, 10);
  }
  /**
   * dmgsan（201480-201509）：狂気值 var_58(86) 增加；
   * 增加量 = n / max(1, 精神抵抗技能54/50)，再受 feat 166 / var_58(257) 减免。
   * 10% 概率、或增加量 > 4、或累计值 > 49 时追加混乱 dmgcon(11)。
   * @returns {number} 1 = 生效，0 = 无效（超人类 var_58(25)>=4 且 var_58(58)!=100）
   */
  function dmgsan(c, n, g) {
    if (c.get(58) !== 100 && c.get(25) >= 4) return 0;
    let div = idiv(c.skill(54), 50);
    if (div <= 0) div = 1;
    let amount = idiv(n | 0, div);
    if (c.index < 16 && Elona.Feat && Elona.Feat.get && Elona.Feat.get(c, 166)) {
      amount = amount - ((g && g.rng ? g.rng.rnd(4) : Math.floor(Math.random() * 4)) + 1);
    }
    if (c.get(257) > 0) amount--;
    if (amount > 0) c.set(86, c.get(86) + amount);
    else amount = 1;
    if (c.get(86) > 100) c.set(86, 100);
    const rnd = (k) => (g && g.rng ? g.rng.rnd(k) : Math.floor(Math.random() * k));
    if (rnd(10) === 0 || rnd(amount + 1) > 5 || rnd(c.get(86) + 1) > 50) {
      if (Elona.Resist && g && g.dmgconTable) Elona.Resist.dmgcon(g, g.dmgconTable, c, 11, 100);
    }
    return 1;
  }
  /** healsp（体力回复）：var_58(52) += n，钳制到 var_58(53)。refreshspeed 未移植（提示省略）。 */
  function healsp(c, n) { c.sp = Math.min(c.sp + n, c.spMax); }

  /**
   * make_sound（194162-194215）：在 (x,y) 制造声响。
   * 距离 < radius 的角色（存活、隐形强度<=60、非睡眠 var_58(181)>=0、非行动中），
   * `rnd(prob)==0` 时：若 var_58(251)!=0（睡眠）→ 清零吵醒 +「物音に気付き目を覚ました」；
   * prm_906 非 0 时（演奏等）再 rnd(500)==0 激怒 → turn_aggro。
   * 偷窃调用 make_sound(x, y, 5, 8)（只吵醒，不激怒）。
   * @returns {string[]} 触发的台词
   */
  function makeSound(g, x, y, radius, prob, aggro, srcIdx) {
    const out = [];
    const R = (n) => ((g && g.rng) || Elona.rng).rnd(Math.max(1, n | 0));
    for (let i = 1; i < 245; i++) {
      const c = g.charas && g.charas[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(256) | 0) > 60) continue;
      if ((c.get(181) | 0) < 0) continue;
      if ((c.get(140) | 0) !== 0) continue;
      const dx = (x | 0) - (c.x | 0), dy = (y | 0) - (c.y | 0);
      if (Math.trunc(Math.sqrt(dx * dx + dy * dy)) >= (radius | 0)) continue;
      if (R(prob || 1) !== 0) continue;
      if ((c.get(251) | 0) !== 0) {
        c.set(251, 0);                                   // 吵醒
        out.push(`${c.name}被响动吵醒了。`);
        c.set(79, 21 + 100 * 2);
        if (aggro && (c.get(58) | 0) === 0 && R(500) === 0) {
          out.push(`${c.name}忍无可忍了！`);
          if (g.turnAggro) g.turnAggro(c, srcIdx | 0, 80);
          else c.set(9, -3);
        }
      }
      // 194210-194212：声源正在演奏/表演（rowact 11 / 32 / 24）时，
      //   附近被吵到的人表情变成「拍手/惊讶」（var_58(79) = 26 + 100*10）
      if (srcIdx !== undefined && srcIdx !== null) {
        const src = g.charas && g.charas[srcIdx | 0];
        if (src) {
          const ra = src.get(140) | 0;
          if (ra === 11 || ra === 32 || ra === 24) c.set(79, 26 + 100 * 10);
        }
      }
    }
    return out;
  }
  /** dmgsp（体力扣除）：var_58(52) -= n，下限 0。 */
  function dmgsp(c, n) { c.sp = Math.max(c.sp - n, 0); }
  /**
   * wet（195661）：目标被淋湿，var_58(259) 累加；var_58(412)!=0（防水）时免疫。
   * 【未移植】提示文本与 cbit(6) 的"身形显露"分支。
   */
  /** `wet`（195661-195722）：var_58(259) 濡れ累计；var_58(412) 水中时无效 */
  function wet(c, n) { if (c.get(412) !== 0) return 0; c.set(259, c.get(259) + n); return 1; }

  /**
   * 每回合状态结算 —— 逐条对照 label_2224(215805-216701)
   * 只移植与状态字段直接相关的通用部分；地图/剧情特例（var_65(850)、var_65(20)、
   * 地形 var_65(250+2)、瘴気(var_691>=16 的 buff71 分支) 等）未移植，见文末说明。
   * @returns {Object} { poison, sleep, erosion, bleed } 各状态本回合的效果摘要
   */
  function statusTick(g, c) {
    const rng = g.rng;
    const out = {};
    // var_1450（215845）：本回合是否允许自然回复；
    //   毒/侵蝕/窒息/病気/麻痺/出血/饥饿/口渴 等结算时清零（源码各块内的 var_1450 = 0）
    let regenBlocked = false;

    // 603959 + 604638-604651：角色回合计数 var_58(26)++；每 25 个自身回合结算负面附魔
    //   （21 随机传送 / 45 吸血 / 72 吸 MP / 46 妨碍成长 / 47 召唤魔物 → *label_2294）
    c.set(26, (c.get(26) | 0) + 1);
    // 216287-216305：ガードブレイク计量每回合 -1（含一次体质相关的额外衰减）
    //   破防状态（120）递减到 100 时归 0，即解除破防
    {
      const gb = c.get(60) | 0;
      if (gb > 0) {
        let nv = gb - 1;
        if (nv === 100) nv = 0;
        c.set(60, nv);
      }
      const gb2 = c.get(60) | 0;
      if (gb2 > 0 && rng.rnd((c.skill(11) | 0) * 2 + 100) > rng.rnd(4000)) {
        let nv2 = gb2 - 1;
        if (nv2 === 100) nv2 = 0;
        c.set(60, nv2);
      }
    }

    // 216073-216091：状态 261（衰弱）—— 1/80 随机弱化一项属性（附魔「XX属性维持」可挡）
    if ((c.get(261) | 0) > 0 && Elona.Weaken) {
      const wa = Elona.Weaken.tickAtrophy(g, c);
      if (wa) out.atrophy = wa;
    }

    // 604645-604650：同一时机的寄生结算（体内 → 脑，顺序同源码）
    if (((c.get(26) | 0) % 25) === 0 && Elona.Parasite) {
      if (Elona.Status && Elona.Status.cbit(c, 978)) {
        const tb = Elona.Parasite.tickBody(g, c);
        if (tb && tb.length) {
          out.parasiteBody = tb;
          if (c.index === 0) for (const e of tb) if (e.text) g.log(e.text);
        }
      }
      if (Elona.Status && Elona.Status.cbit(c, 1045)) {
        const tk = Elona.Parasite.tickBrain(g, c);
        if (tk && tk.length) {
          out.parasiteBrain = tk;
          if (c.index === 0) for (const e of tk) if (e.text) g.log(e.text);
        }
      }
    }
    if (((c.get(26) | 0) % 25) === 0 && Elona.ItemDB && Elona.ItemDB.negativeEnchant) {
      const ne = Elona.ItemDB.negativeEnchant(g, c);
      if (ne && ne.length && c.index === 0) {
        for (const e of ne) {
          if (e.kind === 'teleport') g.log('你身上的诅咒装备发动了传送！');
          else if (e.kind === 'bleed') g.log('身上的诅咒装备吸取了你的血……');
          else if (e.kind === 'manaleak') g.log('身上的诅咒装备吸取了你的魔力……');
          else if (e.kind === 'exp-drain') g.log('身上的诅咒装备阻碍了你的成长……');
          else if (e.kind === 'summon') g.log('诅咒装备召来了魔物！');
        }
      }
      out.negativeEnchant = ne;
    }

    // --- 睡眠 251（215846-215856）：每回合回 1 HP/1 MP，强度 -1 ---
    if (c.get(251) > 0) {
      if (c.get(251) > 100) c.set(251, 100);
      healcon(c, 2, 1);
      if (c.get(251) > 0) c.set(79, 100 + 2);
      healhp(c, 1);
      healmp(c, 1);
      out.sleep = true;
    }

    // --- 毒 250（215857-215890）：每回合扣 (最大HP/15+2) 点，强度 -1 ---
    if (c.get(250) > 0) {
      if (c.get(250) > 100) c.set(250, 100);
      const dmg = idiv(c.hpMax, 15) + 2;
      Elona.Battle.applyDamage(c, dmg);
      if (c.index === 0) g.log(`【毒】${c.name} 受到 ${dmg} 点毒伤害（剩余 HP ${c.hp}）。`);
      healcon(c, 1, 1);
      if (c.get(250) > 0) c.set(79, 100 + 8);
      out.poison = dmg;
      regenBlocked = true;                   // 215889
    }

    // --- 侵蝕 445（215891-215925）：每回合扣 MP 与 SP，强度 -1 ---
    // （MP 扣除走 dmgmp：漏出增幅 + MP 变负时同样会触发魔力反噬，201405）
    if (c.get(445) > 0) {
      if (c.get(445) > 100) c.set(445, 100);
      const m = rng.rnd(2 + idiv(c.skill(16), 10));
      dmgmp(c, m, g);
      if (c.get(52) > 0) c.set(52, c.get(52) - 1);
      healcon(c, 21, 1);
      out.erosion = m;
      regenBlocked = true;                   // 215926
    }

    // --- 窒息 263（215928-215956）：-rnd(3)；归零解除，否则无属性伤害且停止自然回复 ---
    if ((c.get(263) | 0) > 0) {
      if (c.get(263) > 100) c.set(263, 100);                 // 215929-215931
      const v = (c.get(263) | 0) - rng.rnd(3);              // 215941
      if (v <= 0) {
        c.set(263, 0);
        if ((c.index | 0) === 0 && g.log) g.log(`${c.name}终于保住了气道。「咳、咳！」`);
      } else {
        c.set(263, v);
        const d = idiv(c.hpMax, 15) + 2;                    // 215953 dmghp …, -21
        if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(c, d, g, null, 0, 0);
        if ((c.index | 0) === 0 && g.log) g.log(`【窒息】${c.name} 无法呼吸，受到 ${d} 点伤害。`);
        out.suffocation = d;
        regenBlocked = true;                               // 215954 var_1450 = 0
      }
    }

    // --- 病気 261（216084-216090）：高阶生物小概率自愈（rnd(200)==0 时清除）---
    if (c.get(25) >= 4 && rng.rnd(200) === 0) healcon(c, 12, 0);

    // --- 盲目 253（216092-216099）---
    if (c.get(253) > 0) {
      if (c.get(253) > 100) c.set(253, 100);
      healcon(c, 4, 1);
      if (c.get(253) > 0) c.set(79, 100 + 10);
    }

    // --- 麻痺 252（216101-216115）：强度 -1；归零后为 -1，50% 概率转正为 0 ---
    if (c.get(252) > 0) {
      if (c.get(252) > 100) c.set(252, 100);
      healcon(c, 3, 1);
      if (c.get(252) > 0) c.set(79, 100 + 15);
      regenBlocked = true;                   // 216105：麻痺回合不自然回复
    }
    if (c.get(252) < 0) {
      if (rng.rnd(2) === 0) c.set(252, 0);
    }

    // --- 混乱 254（216116-216124）---
    if (c.get(254) > 0) {
      if (c.get(254) > 100) c.set(254, 100);
      healcon(c, 5, 1);
      if (c.get(254) > 0) c.set(79, 100 + 11);
    }

    // --- 恐怖 255（216125-216133）---
    if (c.get(255) > 0) {
      if (c.get(255) > 100) c.set(255, 100);
      healcon(c, 6, 1);
      if (c.get(255) > 0) c.set(79, 100 + 13);
    }

    // --- 朦朧 256（216134-216142）---
    if (c.get(256) > 0) {
      if (c.get(256) > 100) c.set(256, 100);
      healcon(c, 7, 1);
      if (c.get(256) > 0) c.set(79, 100 + 12);
    }

    // --- 酔 257（216143-216151）---
    if (c.get(257) > 0) {
      if (c.get(257) > 100) c.set(257, 100);
      healcon(c, 8, 1);
      if (c.get(257) > 0) c.set(79, 100 + 6);
    }

    // --- 出血 258（216152-216169）：每回合扣血（与毒强度联动），本回合不递减 ---
    if (c.get(258) > 0) {
      if (c.get(258) > 100) c.set(258, 100);
      let r1451 = 0;
      if (c.get(250) > 0) r1451 = idiv(c.get(250), 8);
      if (c.hp !== 0) {
        const a = idiv(limit(idiv(c.hp, 10), 1, 20000)
          * (r1451 + 1 + idiv(c.get(258), 4)), 10) + 3;
        const dmg = rng.rnd(a) + 1;
        Elona.Battle.applyDamage(c, dmg);
        if (c.index === 0) g.log(`【出血】${c.name} 流血不止，受到 ${dmg} 点伤害（剩余 HP ${c.hp}）。`);
        out.bleed = dmg;
      }
      c.set(79, 100 + 9);
      regenBlocked = true;                   // 216167
    }

    // --- 怯 175 / 震え 176（216224-216241）：仅做上限钳制与视觉 ---
    if (c.get(175) > 0) { if (c.get(175) > 100) c.set(175, 100); c.set(79, 100 + 28); }
    if (c.get(176) > 0) { if (c.get(176) > 100) c.set(176, 100); c.set(79, 100 + 29); }

    // --- 饥饿 / 脱水（216562-216596）：源码只对主角（var_691==0）扣血/扣 SP，
    //     且 food<2000 / water<2000 时清零 var_1450（停止自然回复）---
    if ((c.index | 0) === 0) {
      const food = c.get(22) | 0, water = c.get(446) | 0, wet = c.get(259) | 0;
      if (food < 2000) {
        regenBlocked = true;
        if (food < 1000 && (c.get(140) | 0) !== 1 && (c.get(140) | 0) !== 16) {
          const d = rng.rnd(2) + idiv(c.hpMax, 50) + 1;   // 216577：`var_58(51,0)` = 玩家最大 HP
          if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(c, d, g, null, 0, 0);
          out.hunger = d;
        }
      }
      if (water < 2000 && wet <= 0) {
        regenBlocked = true;
        if (water < 1000 && (c.get(52) | 0) > -100) {
          const s = rng.rnd(10) + 10;                       // 216590-216594
          dmgsp(c, s);
          out.thirst = s;
        }
      }
    }

    // --- 自然回复（216640-216680）：var_1450==1 且无 buff9（自然回復阻害）时结算 ---
    //   HP：量 = rnd(治愈(154)/3 + 1) + 1；rnd(6)==0 或 buff3（回復強化）时回复；
    //       饱食(22) >= 10000（満腹）时再给一次 rnd(6)==0 的回复机会。
    //   MP：rnd(5)==0 时回复 rnd(冥想(155)/2 + 1) + 1 —— 「冥想」技能的本体效果。
    //   饥饿(22<1000，216577)/脱水(446<2000 且未濡れ，216593)回合不回复；
    //   中毒・侵蝕・出血・麻痺回合同样不回复（上面各块的 regenBlocked）。
    //   rnd(1000)==0 且 quality(25)>=4 → 93/257 清零（cure_anorexia 的字段部分，216672-216676）。
    // 【未移植】不死系种族在特定地图「回复变扣血」的特例（216653-216663，地图依赖）；
    //           cure_anorexia 的提示文本。
    if (!regenBlocked) {
      const starving = (c.get(22) | 0) < 2000;                    // 216577：`22 < 2000` 时 var_1450=0
      const dehydrated = (c.get(446) | 0) < 2000 && (c.get(259) | 0) <= 0;
      if (!starving && !dehydrated && findbuff(c, 9) === -1) {
        const hAmt = rng.rnd(idiv(c.skill(154), 3) + 1) + 1;
        let hp = 0, mp = 0;
        if (rng.rnd(6) === 0 || findbuff(c, 3) !== -1) {
          healhp(c, hAmt);
          hp += hAmt;
        }
        if (rng.rnd(6) === 0 && (c.get(22) | 0) >= 10000) {
          healhp(c, hAmt);
          hp += hAmt;
        }
        if (rng.rnd(5) === 0) {
          const mAmt = rng.rnd(idiv(c.skill(155), 2) + 1) + 1;
          healmp(c, mAmt);
          mp += mAmt;
        }
        if (hp || mp) out.regen = { hp, mp };
        if (rng.rnd(1000) === 0 && (c.get(25) | 0) >= 4) {
          cureAnorexia(g, c);                               // 216674-216676（此前只清 93/257，病没治）
          c.set(93, 0);
          c.set(257, 0);
          out.anorexiaCured = true;
        }
      }
    }

    // --- 216242-216244 / 216340-216341：每回合复位攻击临时标志 ---
    if (c.get(178) > 0) c.set(178, 0);       // 本回合已消耗体力（*label_3007 346025）
    if (c.get(405) !== 0) c.set(405, 0);     // 装备「追撃」本回合已触发

    // --- 216340-216362：斗志（var_58(182)）自然衰减；216244-216247：清 var_58(183) ---
    if (Elona.Morale && Elona.Morale.tick) Elona.Morale.tick(g, c);
    return out;
  }

  Elona.Status = {
    loadTable, setTable, cbit, cbitmod, findbuff, addbuff, delbuff, healcon,
    healhp, healmp, dmgmp, manaBacklash, healsan, dmgsan, healsp, dmgsp, wet, statusTick, makeSound,
    cureAnorexia, foodTick, rotTick, clockHours,
    KIND_FIELD,
    get table() { return STATUS_TABLE; },
    fieldByCond: (cond) => FIELD_BY_COND && FIELD_BY_COND[String(cond)],
  };
})(window);
