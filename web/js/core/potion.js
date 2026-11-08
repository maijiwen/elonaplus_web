'use strict';
/**
 * 药水专例效果 —— 效果引擎内的 spell 专例分支 + efstatusfix（祝福/诅咒档位修正）
 *
 * 【已确认 1】efstatusfix(a,b,c,d)（start.hsp 305774-305784）：
 *   var_2362 = 使用中物品的 var_99(17)（= 物品 f[17] 诅咒等级，314859/315273 处设置）
 *   <=-2 → a（重诅咒）；-1 → b（诅咒）；0 → c（普通）；>=1 → d（祝福）
 *
 * 【已确认 2】效果引擎内的药水专例（*label_2970 前的 if (var_1302 == N) 分支）：
 *   1116 酸(319315)      dmghp (rnd(p/10+5)+p/10)*fix(50,100,200,300)/100+1；cbit 978（寄生）清除
 *   1154 剧痛(319328)    dmghp 大公式（含施法者 174/178 技能），元素 57
 *   1103 水(319357)      sickifcursed：诅咒 → dmgcon 12(病) 200
 *   1171 消毒(319392)    healcon 1/12 各 fix(5,10,20,40)*2 + addbuff 60
 *   1170 醒酒(319402)    生成空瓶 1263、healsp 15、sickifcursed、1/2 发胖（无 1114 时）
 *   1105 技能药(320886)  随机技能 skillgain；诅咒=不避让已有、普通 100 次、祝福 2000 次
 *   1119 潜力药(321039)  已有技能 modgrowth p*fix(-3,-2,4,5)/150（诅咒为负）
 *   1106 罪人之血(321078) skillexp rnd(10..19) 号技能 fix(-2000,-2000,-1000,-250)
 *   1139 奇迹之血(321098) skillmod 18（玩家 6k/8k、NPC 15k/20k 档）
 *   1133 火炎瓶(340215)  dmghp (rnd(p/3+5)+p/3)*fix(50,100,200,300)/100+1、元素 50、addmef 火
 *
 * 【0-EJ 补全】`*label_2953`（314833-314962）整段：
 *   power()   314869-314886 药水强度 = 炼金术(178)×4 + limit(等级×8,0,8000) + 基础强度，
 *             再乘魔法威力（附魔98×2/3 上限1000 → /10，+ 魔力16/5 上限300）与魔装 ×6/5；
 *             投掷档（水渍）不加炼金与等级；炼成雨/操纵弹用 90% 基础强度
 *   after()   314895-314960 炼金 +50 经验（雪 587/染料 519 除外；雨只给 5）、
 *             饮用 水分+2000/饱腹+150、投掷 水分+400/饱腹+30、饱腹>24000 呕吐、
 *             水分>18000 四选一台词、水分>=24000 失禁
 *   morasi()  201740-201762 失禁：水分归 5000，非世界地图时脚下生成 1115（尿）
 *   apply()   var_59=15 → *label_0598 → 2953 的完整一次（专例 → 通用引擎 → 善后）
 *   rain()/spray()  751 炼成雨 / 826 液体操纵弹：视野内按 90% 强度逐个施用
 *
 * 【已知偏差 A176】dmghp 用 Battle.applyDamage（简化扣血）：
 *   原版的元素抗性（63=酸/57/50=火）、伤害来源与致死结算不在此处理。
 * 【已知偏差 A177】1116 的动画/1154 的 gosub *label_2111（画面特效）不移植。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /**
   * 物品诅咒等级 → var_2362 档位（f[17]：<=-2 重诅咒 / -1 诅咒 / 0 普通 / >=1 祝福）
   */
  function curseOf(item) {
    const f17 = ((item && item.f && item.f[17]) | 0);
    return f17;
  }

  /**
   * efstatusfix(a, b, c, d)（305774-305784）
   * @param {number} curse var_2362
   */
  function fix(curse, a, b, c, d) {
    if (curse <= -2) return a;
    if (curse === -1) return b;
    if (curse === 0) return c;
    return d;
  }

  /** 帮手：安全调用 Battle.applyDamage，返回伤害与是否倒下 */
  function dealDamage(target, dmg) {
    const B = Elona.Battle;
    let done = 0;
    if (B && B.applyDamage) done = B.applyDamage(target, dmg);
    else { target.hp = Math.max(0, (target.hp | 0) - Math.max(0, dmg)); done = Math.max(0, dmg); }
    return { dmg: done, killed: (target.hp | 0) <= 0 };
  }

  /** sickifcursed（201934-201947）：诅咒时 prm_1024 概率生病（dmgcon 12, 200） */
  function sickIfCursed(g, curse, target, n, messages) {
    if (curse <= -1) {
      if (g.rng.rnd(n + (n === 0 ? 1 : 0)) === 0) {
        messages.push(`${target.name || '它'}感觉不舒服。`);
        if (Elona.Resist && g.dmgconTable) {
          Elona.Resist.dmgcon(g, g.dmgconTable, target, 12, 200);
        }
        return 1;
      }
    }
    return 0;
  }

  /** 动作名（actionName 返回 {jp,en}；取日文原文显示） */
  function actName(id) {
    const n = Elona.Spell && Elona.Spell.actionName ? Elona.Spell.actionName(id) : null;
    if (!n) return String(id);
    return (typeof n === 'string') ? n : (n.ch || n.jp || n.en || String(id));
  }

  // ---------------------------------------------------------------- 专例表
  // 每个 fn(g, target, power, ctx) → { ok, messages, killed? }
  // ctx = { curse, caster, item }
  const SPECIAL = {};

  // 1116 酸（319315-319335）：伤害 + 寄生（cbit 978）清除
  SPECIAL[1116] = function (g, target, power, ctx) {
    const messages = [];
    messages.push('咕哇啊！');
    messages.push(`酸液溶蚀了 ${target.name || '它'}。`);
    if (Elona.Status && Elona.Status.cbit(target, 978)) {
      Elona.Status.cbitmod(target, 978, 0);
      messages.push(`${target.name || '它'}体内的异物被溶化了。`);
      if (target.set) target.set(430, 0); else target[430] = 0;
    }
    const p = power | 0;
    const dmg = idiv((g.rng.rnd(idiv(p, 10) + 5) + idiv(p, 10)) * fix(ctx.curse, 50, 100, 200, 300), 100) + 1;
    const r = dealDamage(target, dmg);
    return { ok: true, messages, killed: r.killed, dmg: r.dmg };
  };

  // 1154 剧痛之药（319328-319356）：大公式伤害，元素 57
  SPECIAL[1154] = function (g, target, power, ctx) {
    const messages = ['咕哇啊啊啊！！'];
    const caster = ctx.caster || target;
    const s174 = Elona.Stats ? Elona.Stats.sorg(caster, 174) : 0;
    const s178 = Elona.Stats ? Elona.Stats.sorg(caster, 178) : 0;
    const lv = (target.get ? target.get(38) : (target[38] | 0)) | 0;
    // 原式：((sorg(174)+1)/5+5) * ((sorg(178)+1)/5+5) + rnd(p+1)
    //       + (limit(lv-50,1,2000)+limit(lv-100,1,2000))*4*sqrt(limit(lv,1,2000)*3) + 30
    const a = idiv(s174 + 1, 5) + 5;
    const b = idiv(s178 + 1, 5) + 5;
    const l1 = limit(lv - 50, 1, 2000);
    const l2 = limit(lv - 100, 1, 2000);
    const l3 = limit(lv, 1, 2000);
    const dmg2 = a * b + g.rng.rnd((power | 0) + 1)
      + idiv((l1 + l2) * 4 * Math.sqrt(l3 * 3), 1) + 30;
    const r = dealDamage(target, dmg2);
    return { ok: true, messages, killed: r.killed, dmg: r.dmg };
  };

  // 1103 水（319357-319370）：清爽的水；诅咒时生病
  SPECIAL[1103] = function (g, target, power, ctx) {
    const messages = ['*咕嘟* 真是清澈的水。'];
    sickIfCursed(g, ctx.curse, target, 1, messages);
    return { ok: true, messages };
  };

  // 1171 消毒药（319392-319401）：治疗状态 1/12 + 光 buff
  SPECIAL[1171] = function (g, target, power, ctx) {
    const messages = [`${target.name || '它'}被消毒了。`];
    const amt = fix(ctx.curse, 5, 10, 20, 40) * 2;
    if (Elona.Status) {
      Elona.Status.healcon(target, 1, amt);
      Elona.Status.healcon(target, 12, amt);
      Elona.Status.addbuff(g, target, 60, 50, 3000);
    }
    return { ok: true, messages };
  };

  // 1170 醒酒药（319402-319426）：生成空瓶 + SP 回复 + 可能发胖
  SPECIAL[1170] = function (g, target, power, ctx) {
    const messages = ['「嗝」'];
    if (Elona.ItemDB) {
      const bottle = Elona.ItemDB.createItem(1263, 1, g.rng);
      bottle.f[5] = target.x; bottle.f[6] = target.y; bottle.f[21] = -1;
      if (g.groundItems) g.groundItems.push(bottle);
      if (g.refreshGroundCell) g.refreshGroundCell(target.x, target.y);
    }
    if (Elona.Status && Elona.Status.healsp) Elona.Status.healsp(target, 15);
    sickIfCursed(g, ctx.curse, target, 1, messages);
    if (g.rng.rnd(2) === 0) {
      // 背包里没有 1114（减肥药？）时发胖（var_58(20)++）
      let has = false;
      if (target.inv) has = target.inv.some((it) => it && it.id === 1114);
      if (!has) {
        if (target.set) target.set(20, (target.get(20) | 0) + 1); else target[20] = (target[20] | 0) + 1;
        messages.push(`${target.name || '它'}胖了。`);
      }
    }
    return { ok: true, messages };
  };

  // 1105 技能药（320886-321038）：随机习得 100..399 中的一项技术
  SPECIAL[1105] = function (g, target, power, ctx) {
    const messages = [];
    const cap = fix(ctx.curse, 0, 0, 100, 2000);
    if (ctx.curse >= 0) {
      for (let t = 0; t < 200; t++) {
        const sk = g.rng.rnd(400 - 100) + 100;
        if (!Elona.Spell || !Elona.Spell.field(sk, 0)) continue;    // var_83(0,sk)!=0
        const owned = Elona.Stats.sorg(target, sk) !== 0 || (target.skill && target.skill(sk) !== 0);
        if (t < cap && owned) continue;                             // 祝福/普通：避开已拥有
        if (Elona.Stats) Elona.Stats.skillGain(target, target.index | 0, sk, 1, 0, g);
        messages.push(`${target.name || '它'}掌握了 ${actName(sk)} 的技术！`);
        return { ok: true, messages, skill: sk };
      }
      messages.push('什么也没有发生。');
      return { ok: true, messages };
    }
    // 诅咒：第一次抽到什么就是什么（不避让）
    for (let t = 0; t < 200; t++) {
      const sk = g.rng.rnd(400 - 100) + 100;
      if (!Elona.Spell || !Elona.Spell.field(sk, 0)) continue;
      if (Elona.Stats) Elona.Stats.skillGain(target, target.index | 0, sk, 1, 0, g);
      messages.push(`${target.name || '它'}掌握了 ${actName(sk)} 的技术！`);
      return { ok: true, messages, skill: sk };
    }
    messages.push('什么也没有发生。');
    return { ok: true, messages };
  };

  // 1119 潜力的药（321039-321077）：已有技能的成长率全体修正
  SPECIAL[1119] = function (g, target, power, ctx) {
    const messages = [];
    const mult = fix(ctx.curse, -3, -2, 4, 5);
    if (Elona.Stats) {
      for (let sk = 100; sk < 400; sk++) {
        if (!Elona.Spell || !Elona.Spell.field(sk, 0)) continue;    // var_83(0,cnt)!=0
        if (Elona.Stats.sorg(target, sk) === 0) continue;           // 只修已有
        Elona.Stats.modGrowth(target, sk, target, idiv((power | 0) * mult, 150), g);
      }
    }
    messages.push(ctx.curse >= 0
      ? `${target.name || '它'}的技能潜在能力上升了。`
      : `${target.name || '它'}的技能潜在能力下降了。`);
    return { ok: true, messages };
  };

  // 1106 罪人的血（321078-321085）：随机 10..19 号技能经验大幅减少
  SPECIAL[1106] = function (g, target, power, ctx) {
    const messages = [];
    const sk = g.rng.rnd(20 - 10) + 10;
    if (Elona.Stats) {
      Elona.Stats.skillExp(target, sk, target.index | 0, fix(ctx.curse, -2000, -2000, -1000, -250), undefined, 0, g);
    }
    return { ok: true, messages, skill: sk };
  };

  // 1139 奇迹之血（321098-321112）：魅力(18)经验修正（玩家/NPC 不同档）
  SPECIAL[1139] = function (g, target, power, ctx) {
    const messages = [`${target.name || '它'}的血液沸腾般发热，身体充满了新的力量！`];
    const isPlayer = (target.index | 0) === 0 || target === g.player;
    const exp = isPlayer
      ? fix(ctx.curse, -4000, -1000, 6000, 8000)
      : fix(ctx.curse, -4000, -1000, 15000, 20000);
    if (Elona.Stats) Elona.Stats.skillMod(target, 18, target.index | 0, exp, g);
    return { ok: true, messages };
  };

  // ------------------------------------------------------------ 饮品专例
  // 这些饮品在源码里不是 buff 型，而是各自一段 var_1302 分支（见每条的注释）。

  /** ibit 辅助：.f 与 ItemDB 都可用 */
  function ib(item, bit) {
    if (!item || !Elona.ItemDB || !Elona.ItemDB.ibit) return 0;
    try { return Elona.ItemDB.ibit(bit | 0, item) | 0; } catch (e) { return 0; }
  }

  /** 在地上（目标所在格）生成一个物品（`itemcreate -1, id, x, y, 0`） */
  function dropAt(g, target, id, count) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    const it = Elona.ItemDB.createItem(id | 0, count || 1, g && g.rng);
    if (!it) return null;
    it.f[5] = target.x | 0; it.f[6] = target.y | 0; it.f[21] = -1;
    if (g.groundItems) g.groundItems.push(it);
    if (g.refreshGroundCell) g.refreshGroundCell(it.f[5], it.f[6]);
    return it;
  }

  /** 身高（var_58(19)）/ 体重（var_58(20)）/ 家畜成长度（var_58(59)） */
  function modHeight(c, n) { c.set(19, (c.get(19) | 0) + (n | 0)); }
  function modWeight(c, n) { c.set(20, Math.max(0, (c.get(20) | 0) + (n | 0))); }
  function skillExp(c, id, n, g) {
    if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(c, id | 0, c.index | 0, n | 0, undefined, 0, g);
  }
  function vomitOnce(g, c, messages) {
    const v = (Elona.Vomit && Elona.Vomit.vomit) ? Elona.Vomit.vomit(g, c) : null;
    if (v && v.messages) messages.push.apply(messages, v.messages);
  }
  function hasItem(c, id) {
    return !!(c && c.inv && c.inv.some((x) => x && (x.f[3] | 0) === (id | 0) && (x.f[0] | 0) > 0));
  }

  // 1101 奶（318882-318972）：家畜成长 + 身高 ±1~5 + 饱腹 +1200；诅咒再 -1500 并呕吐
  SPECIAL[1101] = function (g, target, power, ctx) {
    const messages = [];
    const name = target.name || '它';
    const curse = ctx.curse | 0;
    const rnd = (n) => g.rng.rnd(n);
    if (curse <= -1) messages.push('呜哇，这是被诅咒的。味道很危险……');
    else messages.push('味道很浓，好像会上瘾。');
    // 家畜（成长度 <= -1）且没吃饱、没被「成长停止」：成长 +1
    const growth = target.get(59) | 0;
    if (growth <= -1 && (target.get(22) | 0) < 8000 && !(Elona.Status && Elona.Status.cbit(target, 1034))) {
      messages.push(`${name}迅速地成长了。`);
      target.set(59, growth + 1);
      if (Elona.Relation && Elona.Relation.modimp) Elona.Relation.modimp(target, 10, g);
      if (Elona.Relation && Elona.Relation.modimp2) Elona.Relation.modimp2(target, 10, g);
      if (curse >= 1 && (target.get(59) | 0) <= -1) {
        target.set(59, (target.get(59) | 0) + 1);
        if (Elona.Relation && Elona.Relation.modimp) Elona.Relation.modimp(target, 10, g);
        if (Elona.Relation && Elona.Relation.modimp2) Elona.Relation.modimp2(target, 10, g);
      }
      if ((target.get(22) | 0) >= 8000) messages.push('「嗝ぅ」');
    }
    if (curse >= 1) modHeight(target, rnd(5) + 1);
    if (curse <= -1) {
      modHeight(target, -(rnd(5) + 1));
      if ((target.get(59) | 0) >= -4) {
        target.set(59, (target.get(59) | 0) - 1);
        if (Elona.Relation && Elona.Relation.modimp) Elona.Relation.modimp(target, -20, g);
        if (Elona.Relation && Elona.Relation.modimp2) Elona.Relation.modimp2(target, -20, g);
      }
    }
    // `var_58(22) += 1000 * (120 / 100)`；诅咒食物的 -1500 与呕吐走 eatstatus
    target.set(22, (target.get(22) | 0) + 1200);
    if (curse <= -1) {
      target.set(22, Math.max(0, (target.get(22) | 0) - 1500));
      vomitOnce(g, target, messages);
    }
    return { ok: true, messages };
  };

  // 1159 咖啡（340120-340149）：玩家加「睡意耐性」，NPC 睡眠清零；混合咖啡牛奶时身高 ±1~2
  SPECIAL[1159] = function (g, target, power, ctx) {
    const messages = [`${target.name || '它'}的睡意消散了。`];
    const curse = ctx.curse | 0;
    if ((target.index | 0) === 0) {
      if (g && g.setV65) g.setV65(250 + 384, (g.getV65(250 + 384) | 0) + 15 + g.rng.rnd(11));
    } else {
      target.set(251, 0);
    }
    if (ib(ctx.item, 1) === 1) {
      if (curse >= 1) modHeight(target, g.rng.rnd(2) + 1);
      if (curse <= -1) modHeight(target, -(g.rng.rnd(2) + 1));
    }
    return { ok: true, messages };
  };

  // 1160 果汁（340150-3402xx）：按果汁种类给技能经验，饱腹 +500，生成空瓶（1263）
  SPECIAL[1160] = function (g, target, power, ctx) {
    const messages = [];
    const it = ctx.item;
    const f25 = (it && it.f ? (it.f[25] | 0) : 0);
    if (!f25) return { ok: true, messages };                    // 无前缀果汁：没有效果
    const A = (target.index | 0) === 0 ? 1 : 15;
    const B = ib(it, 18) === 1 ? 1.5 : 1;                       // ibit(18)=混合果汁
    const Q = idiv(f25, 1000);
    if (Q === 2) {                                              // 蔬菜
      skillExp(target, 15, 50 * A * B, g); skillExp(target, 14, 50 * A * B, g);
    } else if (Q === 3) {                                       // 水果
      skillExp(target, 16, 50 * A * B, g); skillExp(target, 17, 20 * A * B, g);
      skillExp(target, 13, 30 * A * B, g);
    } else if (Q === 4) {                                       // 果实
      skillExp(target, 16, 40 * A * B, g); skillExp(target, 12, 30 * A * B, g);
      skillExp(target, 14, 30 * A * B, g);
    }
    dropAt(g, target, 1263, 1);
    const curse = ctx.curse | 0;
    target.set(22, (target.get(22) | 0) + 500);
    if (curse >= 1) modWeight(target, g.rng.rnd(2) + 1);
    if (curse <= -1) {
      modWeight(target, -(g.rng.rnd(2) + 1));
      target.set(22, Math.max(0, (target.get(22) | 0) - 1500));
      vomitOnce(g, target, messages);
    }
    return { ok: true, messages };
  };

  // 1165 绿茶（325162-325185）：毒/麻痹/混乱/模糊/出血减轻，呕吐计数 -1，体重下降
  SPECIAL[1165] = function (g, target, power, ctx) {
    const messages = [];
    const a = ((ctx.item && ctx.item.f ? (ctx.item.f[20] | 0) : 0)) * 2 + 15;
    if (Elona.Status && Elona.Status.healcon) {
      for (const k of [6, 1, 5, 7, 3]) Elona.Status.healcon(target, k, a);
      Elona.Status.healcon(target, 12, idiv(a, 2) + 3);
    }
    if ((target.get(93) | 0) > 0) target.set(93, (target.get(93) | 0) - 1);   // 呕吐计数
    if (!hasItem(target, 1114)) {
      const w = limit(target.get(20) | 0, 1, 100000000);
      const f20 = (ctx.item && ctx.item.f ? (ctx.item.f[20] | 0) : 0);
      modWeight(target, -(idiv(w * (f20 + 1), 100) + 1));
    }
    return { ok: true, messages };
  };

  // 1156 永生蜜酒（319158-319171）：healhp 上限*4/5+200 → cure_anorexia → 93=0 → dmgcon 8
  SPECIAL[1156] = function (g, target, power, ctx) {
    const messages = [];
    if (Elona.Status) {
      if (Elona.Status.healhp) Elona.Status.healhp(target, idiv((target.get(51) | 0) * 4, 5) + 200);
      if (Elona.Status.cureAnorexia) Elona.Status.cureAnorexia(g, target);   // 0-EX：拒食症治愈途径之一
      target.set(93, 0);
      if (Elona.Resist && g.dmgconTable) {
        Elona.Resist.dmgcon(g, g.dmgconTable, target, 8, g.rng.rnd(1000) + 1000);
      }
      messages.push(`${typeof target.name === 'function' ? target.name('ch') : (target.name || '目标')}的伤口以惊人的速度愈合了……`);
    }
    return { implemented: true, messages };
  };

  // 1166 红茶（325186-325193）：SP +5、MP +(f20+5)%最大MP +5
  SPECIAL[1166] = function (g, target, power, ctx) {
    const messages = [];
    if (Elona.Status) {
      if (Elona.Status.healsp) Elona.Status.healsp(target, 5);
      if (Elona.Status.healmp) {
        const f20 = (ctx.item && ctx.item.f ? (ctx.item.f[20] | 0) : 0);
        Elona.Status.healmp(target, 5 + idiv((f20 + 5) * (target.get(56) | 0), 100));
      }
    }
    return { ok: true, messages };
  };

  // 1169 麦茶（319433-319458）：治愈 +200 经验，生成空瓶，诅咒则生病
  SPECIAL[1169] = function (g, target, power, ctx) {
    const messages = ['*咕嘟* 喉咙舒服多了。'];
    skillExp(target, 154, 200, g);
    dropAt(g, target, 1263, 1);
    sickIfCursed(g, ctx.curse, target, 1, messages);
    return { ok: true, messages };
  };

  // 1146 柠檬汽水（319459-319499）：SP +25，生成 1262，诅咒则生病
  SPECIAL[1146] = function (g, target, power, ctx) {
    const messages = ['*咻哇哇* 好爽口！', `${target.name || '它'}恢复了一点体力。`];
    dropAt(g, target, 1262, 1);
    if (Elona.Status && Elona.Status.healsp) Elona.Status.healsp(target, 25);
    sickIfCursed(g, ctx.curse, target, 1, messages);
    return { ok: true, messages };
  };

  // 1142 食盐水（319500-319543）：蜗牛种会被盐溶化；骑机（382）会启动防盐系统
  SPECIAL[1142] = function (g, target, power, ctx) {
    const messages = [];
    if ((target.get(27) | 0) === 382) {
      messages.push('「防盐系统启动」');
      dropAt(g, target, 812, 1);
    }
    const raceEn = (target.race === 'snail') || (target.get(27) | 0) === 382;
    if (raceEn) {
      messages.push(`是盐！${target.name || '它'}开始溶化了！`);
      const hp = target.get(50) | 0;
      const dmg = hp > 10 ? hp - g.rng.rnd(10) : g.rng.rnd(20000);
      dealDamage(target, dmg);
    } else {
      messages.push('「好咸～」');
    }
    return { ok: true, messages };
  };

  // 1130 尿/呕吐物（319544-319563）：难喝；诅咒则生病
  SPECIAL[1130] = function (g, target, power, ctx) {
    const messages = ['*咕嘟* 好难喝！'];
    sickIfCursed(g, ctx.curse, target, 1, messages);
    return { ok: true, messages };
  };

  // 1133 火炎瓶（340215-340226）：火焰伤害 + 地面火 mef
  SPECIAL[1133] = function (g, target, power, ctx) {
    const messages = [`${target.name || '它'}被火焰包围了。`];
    const p = power | 0;
    const dmg = idiv((g.rng.rnd(idiv(p, 3) + 5) + idiv(p, 3)) * fix(ctx.curse, 50, 100, 200, 300), 100) + 1;
    const r = dealDamage(target, dmg);
    if (Elona.Mef && Elona.Mef.add) {
      Elona.Mef.add(g, target.x, target.y, 5, 24, g.rng.rnd(15) + 25, p, (ctx.caster ? ctx.caster.index : 0) | 0);
    }
    // mapitem_fire（引燃地面物品）：未移植（A177）
    return { ok: true, messages, killed: r.killed, dmg: r.dmg };
  };

  /**
   * 药水实际强度 —— `*label_2953` 314869-314886（饮用/投掷/炼成雨共用）。
   *
   *   饮用（q/t）  ：炼金术(178)×4 + limit(等级×8, 0, 8000) + 基础强度
   *   炼成雨/操纵弹（var_2429 = 90）：炼金术×4 + limit(等级×8,0,8000) + 基础强度×0.9
   *   投掷/水渍（var_2431 = 1）：**不加**炼金与等级，直接用投掷侧给的强度（50+投掷×10）
   *
   *   魔法威力 var_2423 = limit(附魔98×2/3, 0, 1000)/10 + limit(魔力16/5, 0, 300)
   *   var_578 = var_578 × (100 + var_2423) / 100
   *   魔装（状态 64 在 15000..34999 且带 buff 34）→ ×6/5
   *
   * @param {object} user 使用者（var_243）
   * @param {number} base 基础强度（var_578，来自 itemuse.json 的 power）
   * @param {object} [opts] { thrown: 投掷/水渍, rain: 炼成雨·液体操纵弹(90%) }
   */
  function potionPower(g, user, base, opts) {
    const o = opts || {};
    const alchemy = (user && user.skill) ? (user.skill(178) | 0) : 0;
    const lv = (user && user.get) ? (user.get(38) | 0) : 0;
    let pw = base | 0;
    if (o.rain) pw = alchemy * 4 + limit(lv * 8, 0, 8000) + idiv(pw * 90, 100);
    else if (!o.thrown) pw = alchemy * 4 + limit(lv * 8, 0, 8000) + pw;
    // 314872：魔法威力（药剂这一路是 魔力/5，不是咏唱的 魔力/10）
    const enc = (user && user.get) ? (user.get(98) | 0) : 0;
    const mag = (user && user.skill) ? (user.skill(16) | 0) : 0;
    const boost = idiv(limit(idiv(enc * 2, 3), 0, 1000), 10) + limit(idiv(mag, 5), 0, 300);
    pw = idiv(pw * (100 + boost), 100);
    if (user && user.get) {
      const st = user.get(64) | 0;
      if (st >= 15000 && st < 35000 && Elona.Status && Elona.Status.findbuff
        && Elona.Status.findbuff(user, 34) !== -1) pw = idiv(pw * 6, 5);
    }
    return pw | 0;
  }

  /** 314920-314954：水分 > 18000 时的四选一台词（var_1454 = rnd(4)） */
  const FIDGET = [
    '{n}坐立不安地扭动着……',
    '{n}扭来扭去地蹭着身子……',
    '{n}拼命地忍耐着……',
    '{n}微微颤抖地忍着……',
  ];

  /**
   * 瓶塞计数（`var_65(250 + 439)`，即 var_65(689)）。
   *
   * 源码里只有「药水贴图 = 354」的物品才会给瓶塞：
   *   342594 使用药剂（`var_59 = 15` 链尾）  → +1
   *   340870 投掷/淋撒（`var_243 == 0` 才计数）→ +1
   *   328387 液体操纵弹 / 328550 炼成雨     → +1（**消耗的那一瓶**，不是每个目标）
   *   348335 混合（dip.js 已接）
   *   351241 软木塞包（effect 135）        → +100
   *   421806 魔法店讨口子                  → 5 + limit(交涉/10, 1, 200)
   *
   * @returns {number} 实际增加的数量（0 = 该物品不产瓶塞）
   */
  function addPlug(g, item, n) {
    if (!g || !item || !g.getV65 || !g.setV65) return 0;
    const f2 = (item.f && item.f[2]) | 0;
    if (f2 !== 354) return 0;
    const add = (n === undefined || n === null) ? 1 : (n | 0);
    if (add <= 0) return 0;
    g.setV65(689, (g.getV65(689) | 0) + add);
    return add;
  }

  /**
   * 强效道具 buff（38）→ 斗志 +5（342594-342598）。
   *   饮用：喝的人加；投掷：投掷者加（wiki ②）。
   */
  function moraleBonus(c) {
    if (!c || !Elona.Status || !Elona.Status.findbuff) return false;
    if (Elona.Status.findbuff(c, 38) === -1) return false;
    if (Elona.Morale && Elona.Morale.add) Elona.Morale.add(c, 5);
    return true;
  }

  /**
   * 魔法店讨瓶塞（421798-421814，`var_506 == 115`）。
   *
   *   cbit(974) == 0 → 「现在没有多余的」（421799-421801）
   *   否则 → 台词 → `var_2731 = 5 + limit(店等级,1,200)/10` → 瓶塞 += var_2731
   *          → 台词「获得了N个药水塞。[剩余M个]」→ 清 cbit(974)
   *
   * @param {object} keeper 魔法店店主（var_58(150) == 1004）
   * @returns {{ok:boolean, count:number, total:number, messages:string[]}}
   */
  function requestPlugs(g, keeper) {
    const messages = [];
    if (!keeper || !Elona.Status || !Elona.Status.cbit) {
      return { ok: false, count: 0, total: 0, messages: ['……'] };
    }
    if (Elona.Status.cbit(keeper, 974) === 0) {
      messages.push('现在没有多余的。');
      return { ok: false, count: 0, total: (g && g.getV65) ? (g.getV65(689) | 0) : 0, messages };
    }
    messages.push('不知道你要用来做什么……如果是废品可以拿走。');
    const n = 5 + idiv(limit(keeper.get(151) | 0, 1, 200), 10);
    let total = n;
    if (g && g.getV65 && g.setV65) {
      total = (g.getV65(689) | 0) + n;
      g.setV65(689, total);
    }
    messages.push(`获得了${n}个药水塞。[剩余${total}个]`);
    Elona.Status.cbitmod(keeper, 974, false);
    return { ok: true, count: n, total, messages };
  }

  /**
   * 失禁 —— `chara_morasi`（201740-201762）。
   *   台词 → 非世界地图时在脚下生成 1115（尿）→ 水分归 5000
   * @returns {string[]} 消息
   */
  function morasi(g, c) {
    if (!c || !c.set) return [];
    const name = c.name || '它';
    const messages = [`${name}失禁了。`];
    if ((c.index | 0) !== 0) messages.push('「……唔！」');
    let hdr = 0;
    try { hdr = (g && g.map && g.map.header) ? (g.map.header[6] | 0) : 0; } catch (e) { hdr = 0; }
    if (hdr !== 1 && !(g && g.var1095) && Elona.ItemDB && Elona.ItemDB.createItem) {
      const it = Elona.ItemDB.createItem(1115, 1, g && g.rng);
      if (it) {
        it.f[5] = c.x | 0; it.f[6] = c.y | 0; it.f[21] = -1;
        if (g.groundItems) g.groundItems.push(it);
        if (g.refreshGroundCell) g.refreshGroundCell(it.f[5], it.f[6]);
      }
    }
    c.set(446, 5000);
    return messages;
  }

  /**
   * 饮用/投掷之后的水分与饱腹结算 —— `*label_2953` 314895-314960。
   *
   *   314895-314905：炼金术 +50 经验（雪 587 / 染料 519 除外；炼成雨只给 5）
   *   314908-314915：投掷/炼成雨 → 水分 +400、饱腹 +30；饮用 → 水分 +2000、饱腹 +150
   *   314917：饱腹 > 24000 → 1/5 概率呕吐
   *   314920：水分 > 18000 → 四选一台词
   *   314955：水分 >= 24000 → 1/5 概率失禁
   *
   * @returns {string[]} 消息
   */
  function after(g, user, target, itemId, opts) {
    const o = opts || {};
    const messages = [];
    const R = (n) => ((g && g.rng) ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    const t = target || user;
    if (!t || !t.set) return messages;
    if ((itemId | 0) !== 587 && (itemId | 0) !== 519 && user && Elona.Stats
      && Elona.Stats.skillExp) {
      Elona.Stats.skillExp(user, 178, user.index | 0, o.rain ? 5 : 50, undefined, 0, g);
    }
    const thrown = !!(o.thrown || o.rain);
    // 342594-342598：有强效道具 buff 时斗志 +5（饮用=喝的人；投掷=投掷者）
    if (o.rain) { /* 炼成雨：源码只对使用者判定一次，见 rain() */ }
    else if (thrown) moraleBonus(user);
    else moraleBonus(t);
    t.set(446, (t.get(446) | 0) + (thrown ? 400 : 2000));
    t.set(22, (t.get(22) | 0) + (thrown ? 30 : 150));
    if ((t.get(22) | 0) > 24000 && R(5) === 0) {
      const v = (Elona.Vomit && Elona.Vomit.vomit) ? Elona.Vomit.vomit(g, t) : null;
      if (v && v.messages) messages.push.apply(messages, v.messages);
    }
    if ((t.get(446) | 0) > 18000) {
      messages.push(FIDGET[R(4)].replace('{n}', t.name || '它'));
    }
    if ((t.get(446) | 0) >= 24000 && R(5) === 0) {
      messages.push.apply(messages, morasi(g, t));
    }
    return messages;
  }

  /**
   * 把一份药水用在某个角色身上 —— `var_59 = 15` → `*label_0598` → `*label_2953`。
   *
   * 效果本体先走专例表，再走通用效果引擎（`*label_2960` 的 buff/type 分派），
   * 最后补「水分 / 饱腹 / 呕吐 / 失禁」与炼金经验。
   *
   * @param {object} user     使用者（var_243）
   * @param {object} target   承受者（var_244）
   * @param {number} itemId   药水物品 id（决定效果表条目）
   * @param {number} basePower 基础强度（var_578）
   * @param {number} curse    物品诅咒等级 f[17]
   * @param {object} [opts]   { thrown, rain, power(已算好的强度), noAfter, item }
   * @returns {null|{spell,power,result,messages}}
   */
  function apply(g, user, target, itemId, basePower, curse, opts) {
    const o = opts || {};
    const entry = (Elona.ItemUse && Elona.ItemUse.entryOf)
      ? Elona.ItemUse.entryOf(itemId | 0, 15) : null;
    if (!entry || entry.spell === null || entry.spell === undefined) return null;
    const tgt = target || user;
    let pw;
    if (o.power !== undefined) {
      pw = potionPower(g, user, o.power | 0, { thrown: true });
    } else {
      pw = potionPower(g, user, basePower | 0, o);
    }
    // 315874-315887 的祝福/诅咒修正走效果引擎的 buff 分支（读 var_2362）
    if (g) g.var2362 = curse | 0;
    let r = dispatch(g, entry.spell, tgt, pw,
      { curse: curse | 0, caster: user, item: o.item || null });
    if (!r) {
      r = Elona.Spell
        ? Elona.Spell.dispatchEffect(g, user, entry.spell, tgt, pw)
        : { implemented: false };
    }
    const messages = (r && r.messages) ? r.messages.slice() : [];
    if (!o.noAfter) messages.push.apply(messages, after(g, user, tgt, itemId | 0, o));
    return { spell: entry.spell, power: pw, result: r, messages };
  }

  /**
   * 每回合的水分过量判定（604590-604594）：水分 > 35000 → 1/60 概率失禁。
   * 与 Vomit.tickTurn（饱腹 > 35000 → 呕吐）并列。
   * @returns {null|{messages:string[]}}
   */
  function tickTurn(g, c) {
    if (!c || !c.get) return null;
    if ((c.get(446) | 0) <= 35000) return null;
    if (!g.rng || g.rng.rnd(60) !== 0) return null;
    return { messages: morasi(g, c) };
  }

  /**
   * 炼成雨（751）/ 液体操纵弹（826）不能用的药水。
   * 奶 574 / 雪 587 / 果汁 1005 / 空瓶子 601 / 火焰瓶 577 / 潜力药水 287 /
   * 速度潜力药水 847 / 下降药水 706 / 蓝色胶囊 771 / 韦尔尼斯经典原味糖 799 / 赫尔墨斯之血 626
   */
  const NO_RAIN = new Set([574, 587, 1005, 601, 577, 287, 847, 706, 771, 799, 626]);

  /** 精油 1035 / 挥发油 1036：炼成雨与操纵弹不附加濡湿 */
  const NO_WET = new Set([1035, 1036]);

  /** 该物品能否用于炼成雨/液体操纵弹 */
  function canRain(item) {
    if (!item) return false;
    if (Elona.ItemDB && Elona.ItemDB.ref(item.f[3] | 0, 5) !== 52000) return false;
    return !NO_RAIN.has(item.f[3] | 0);
  }

  /** 从背包里挑一瓶可用于炼成雨的药水（AI 与未接选择 UI 时用；优先非诅咒） */
  function pickRainPotion(c) {
    const inv = (c && c.inv) || [];
    let best = null;
    for (const it of inv) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if (!canRain(it)) continue;
      if (!best || ((it.f[17] | 0) >= 0 && (best.f[17] | 0) < 0)) best = it;
    }
    return best;
  }

  /** 技能 656 的射程（`var_83(3, 656) \ 1000 + 1`，328584） */
  function rainRange() {
    const f = (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(656, 3) | 0) : 0;
    return ((f / 1000) | 0) + 1;
  }

  function distOf(g, a, b) {
    if (Elona.Battle && Elona.Battle.dist) return Elona.Battle.dist(a.x, a.y, b.x, b.y);
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  function losOf(g, a, b) {
    if (Elona.Spell && Elona.Spell.fovLos) return !!Elona.Spell.fovLos(g, a.x, a.y, b.x, b.y);
    return true;
  }

  /**
   * 炼成雨（751，328514-328596）—— 向视野内的队友投掷药水（强度 90%）。
   *   只对**自己与同伴**生效（玩家：index < 16；NPC：同种族 var_58(9) 相同）
   *   射程 = var_83(3,656)/1000+1，且要有视线
   *   非精油/挥发油 → 濡湿 25 回合
   *   每命中一个单位都给炼金术 +5 经验（在 after 里按 rain 档处理）
   *
   * @param {object} item 药水（缺省时自动挑一瓶）
   * @returns {object} { ok, item, targets, messages }
   */
  function rain(g, caster, item) {
    const pot = item || pickRainPotion(caster);
    if (!pot) return { ok: false, reason: 'no-potion', messages: ['没有可用的药水。'] };
    if (!canRain(pot)) return { ok: false, reason: 'banned', messages: ['这瓶药水不能用于炼成雨。'] };
    const itemId = pot.f[3] | 0;
    const base = (Elona.ItemUse && Elona.ItemUse.entryOf)
      ? Number((Elona.ItemUse.entryOf(itemId, 15) || {}).power) || 0 : 0;
    const curse = pot.f[17] | 0;
    const range = rainRange();
    const self = (caster.index | 0) === 0;
    const group = caster.get ? (caster.get(9) | 0) : 0;
    const out = { ok: true, item: itemId, targets: [], messages: [] };
    const nameOf = (Elona.ItemDB && Elona.ItemDB.name)
      ? Elona.ItemDB.name(itemId, 'jp') : ('#' + itemId);
    out.messages.push(`${nameOf}之雨哗啦啦地落了下来。`);
    if ((pot.f[0] | 0) > 0) pot.f[0]--;
    // 328550：使用者是玩家时，消耗的这瓶药水（贴图 354）+1 瓶塞
    if (self) { addPlug(g, pot, 1); moraleBonus(caster); }
    for (const t of (g.charas || [])) {
      if (!t || (t.get(0) | 0) !== 1 || t === caster) continue;
      if (self) { if ((t.index | 0) >= 16) continue; }
      else if ((t.get(9) | 0) !== group) continue;
      if (distOf(g, caster, t) > range || !losOf(g, caster, t)) continue;
      if (!NO_WET.has(itemId) && Elona.Status && Elona.Status.wet) Elona.Status.wet(t, 25);
      // 每个目标各走一次 *label_2953（炼成雨档：水分+400 / 饱腹+30 / 炼金 +5 经验）
      const r = apply(g, caster, t, itemId, base, curse, { rain: true });
      if (r && r.messages) out.messages.push.apply(out.messages, r.messages);
      out.targets.push(t.index | 0);
    }
    return out;
  }

  /**
   * 液体操纵弹（826，328350-328454）—— 向视野内的敌人投掷药水（强度 90%）并追加 PVDV 伤害。
   *   伤害 = (魔力/5+5)×((炼金+1)/5+5) + rnd(炼金+5)
   *          + ((limit(lv-50,1,2000)+limit(lv-100,1,2000))×4×sqrt(limit(lv,1,2000)×3)+30+1)/4
   *
   * @param {object} item 药水（缺省时自动挑一瓶）
   */
  function spray(g, caster, item) {
    const pot = item || pickRainPotion(caster);
    if (!pot) return { ok: false, reason: 'no-potion', messages: ['没有可用的药水。'] };
    if (!canRain(pot)) return { ok: false, reason: 'banned', messages: ['这瓶药水不能用于液体操纵弹。'] };
    const itemId = pot.f[3] | 0;
    const base = (Elona.ItemUse && Elona.ItemUse.entryOf)
      ? Number((Elona.ItemUse.entryOf(itemId, 15) || {}).power) || 0 : 0;
    const curse = pot.f[17] | 0;
    const range = rainRange();
    const self = (caster.index | 0) === 0;
    const group = caster.get ? (caster.get(9) | 0) : 0;
    const lv = caster.get ? (caster.get(38) | 0) : 0;
    const mag = caster.skill ? (caster.skill(16) | 0) : 0;
    const alch = caster.skill ? (caster.skill(178) | 0) : 0;
    const R = (n) => ((g.rng) ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    const dmgBase = (idiv(mag, 5) + 5) * (idiv(alch + 1, 5) + 5) + R(alch + 5)
      + idiv((limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4
        * Math.sqrt(limit(lv, 1, 2000) * 3) + 30 + 1, 4);
    const out = { ok: true, item: itemId, targets: [], messages: [],
      message: `${caster.name || '它'}把液体凝成弹丸散射了出去。` };
    if ((pot.f[0] | 0) > 0) pot.f[0]--;
    // 328387：同上
    if (self) { addPlug(g, pot, 1); moraleBonus(caster); }
    for (const t of (g.charas || [])) {
      if (!t || (t.get(0) | 0) !== 1 || t === caster) continue;
      if (self) { if ((t.get(9) | 0) !== -3) continue; }
      else if ((t.get(9) | 0) === group) continue;
      if (distOf(g, caster, t) > range || !losOf(g, caster, t)) continue;
      const before = t.hp | 0;
      if (Elona.Battle && Elona.Battle.applyDamage) {
        Elona.Battle.applyDamage(t, dmgBase, g, caster, 64, 1000);
      } else t.hp = Math.max(0, before - dmgBase);
      out.targets.push(t.index | 0);
      if ((t.get(0) | 0) !== 1) continue;                       // 死了就不再上药水
      if (!NO_WET.has(itemId) && Elona.Status && Elona.Status.wet) Elona.Status.wet(t, 25);
      const r = apply(g, caster, t, itemId, base, curse, { rain: true });
      if (r && r.messages) out.messages.push.apply(out.messages, r.messages);
    }
    return out;
  }

  /**
   * 药水专例分派：spell id 命中 SPECIAL 时执行专例（原版专例优先于通用效果引擎，
   * 处理完 goto *label_2970 直接结束）。
   * @param {object} ctx { curse, caster, item }
   * @returns {null | {ok, messages, ...}} null = 非专例（走通用引擎）
   */
  function dispatch(g, spellId, target, power, ctx) {
    const fn = SPECIAL[spellId];
    if (!fn) return null;
    return fn(g, target, power | 0, ctx || { curse: 0 });
  }

  Elona.Potion = {
    curseOf, fix, dispatch, SPECIAL, sickIfCursed,
    potionPower, power: potionPower, after, morasi, apply, tickTurn,
    addPlug, moraleBonus, requestPlugs,
    rain, spray, canRain, pickRainPotion, NO_RAIN, NO_WET,
  };
})(window);
