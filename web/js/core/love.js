'use strict';
/**
 * 恋爱奇迹（core/love.js）—— lovemiracle / lovemiracle2 与媚藥流程
 *
 * 【源码依据】hsp/start.hsp：
 *   224921-224951  lovemiracle(prm_1079)：rnd(2) 触发；在目标脚下生成 卵(573)/乳(574)，
 *                  var_99(23)=var_58(27)（提供者的角色种别 id）、var_99(7)=limit(等级/10*40,20,10000)、
 *                  var_99(1)=limit((等级+2400)/4,600,3000)；snd 107 + animeload 15
 *   224952-224969  lovemiracle2(prm_1080)：在脚下生成 手作りチョコ(889)，
 *                  var_99(23)=var_58(27)、var_99(17)=0（无诅咒）；
 *                  料理技能(184)<10 且 rnd(5)==0 → var_99(27)=5；
 *                  var_58(86)>0 → var_99(27)=1
 *   226676-226701  给 NPC 吃下带 ibit(6)（媚薬性质）的食物：目标「変な気分」、
 *                  var_58(79)=17+100*3（蛊惑状态）、好感<100 时 modimp +30、karma −10、
 *                  dmgcon(7,500)、lovemiracle；玩家自己吃只有「興奮した！」
 *   318645-318712  事件 1135（媚藥を飲ませる）：诅咒的媚藥 → 轻蔑 modimp/modimp2 −15；
 *                  普通媚藥 → 蛊惑、dmgcon(7,100)、modimp limit(力量/20,0,15)、
 *                  lovemiracle、modimp2 +10
 *   290448-290470  同伴互动选项 12（いちゃつく）：lovemiracle2 + customtalk(110)
 *
 * 【约定】技能 id >= 300 叫「特殊能力」；184 料理、17 好感度、20 等级、86 愤怒值。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /** 在角色脚下生成物品（itemcreate -1, id, x, y, 0 的惯例，参考 Ranch.dropItem） */
  function dropAtFeet(g, c, id) {
    let it = null;
    try { it = Elona.ItemDB.createItem(id, 1); } catch (e) { it = null; }
    if (!it) return null;
    it.f[5] = c.x | 0;
    it.f[6] = c.y | 0;
    if (g.groundItems) g.groundItems.push(it);
    const cell = g.map ? g.map.cell(c.x | 0, c.y | 0) : null;
    if (cell) cell[4] = 1;
    if (typeof g.refreshGroundCell === 'function') g.refreshGroundCell(c.x | 0, c.y | 0);
    return it;
  }

  /**
   * lovemiracle（224921-224951）：rnd(2) 触发，目标脚下生成 卵/乳。
   * @returns {{triggered:boolean, item?:object, kind?:'egg'|'milk'}}
   */
  function loveMiracle(g, c) {
    const out = { triggered: false };
    if (!c || (c.index | 0) === 0) return out;          // prm_1079 == 0 → 直接返回
    if (g.rng.rnd(2) !== 0) return out;                 // rnd(2) 非 0 → 不触发
    out.triggered = true;
    const kind = g.rng.rnd(2) ? 'egg' : 'milk';
    const it = dropAtFeet(g, c, kind === 'egg' ? 573 : 574);
    if (it) {
      it.f[23] = c.get(27) | 0;                                   // 提供者角色种别
      if (kind === 'egg') {
        it.f[7] = limit(idiv(c.get(20) | 0, 10) * 40, 20, 10000); // 卵 573
        it.f[1] = limit(idiv((c.get(20) | 0) + 2400, 4), 600, 3000);
      }
    }
    out.item = it || undefined;
    out.kind = kind;
    return out;
  }

  /**
   * lovemiracle2（224952-224969）：脚下生成 手作りチョコ(889)。
   * @returns {{item?:object, blessed?:number}}
   */
  function loveMiracle2(g, c) {
    if (!c) return {};
    // 224953 `itemcreate -1, 889, var_58(1, 0), var_58(2, 0), 0`：
    // 落点是**玩家（index 0）脚下**，c 只是提供者（决定 f[23] / f[27]）。
    const at = (g && g.player) ? g.player : c;
    const it = dropAtFeet(g, at, 889);
    let f27 = 0;
    if (it) {
      it.f[23] = c.get(27) | 0;                 // var_99(23) = var_58(27)
      it.f[17] = 0;                             // var_99(17) = 0（无诅咒）
      // 224959-224964：料理技能(184) < 10 且 rnd(5)==0 → f[27]=5
      if ((c.skill(184) | 0) < 10 && g.rng.rnd(5) === 0) { it.f[27] = 5; f27 = 5; }
      // 224965-224967：var_58(86) > 0（愤怒/兴奋状态）→ f[27]=1
      if ((c.get(86) | 0) > 0) { it.f[27] = 1; f27 = 1; }
    }
    return { item: it || undefined, f27 };
  }

  /**
   * 给 NPC 吃下媚藥 / 媚藥性食物（226676-226701 + 318645-318712）。
   * 媚藥本体是物品 620；带 ibit(6) 的食物（ fortunecookie 738 等）走 226676 分支。
   * @param {object} g
   * @param {object} npc 目标 NPC（var_243 / var_244）
   * @param {object} it 媚藥物品
   * @returns {{ok:boolean, message:string, cursed?:boolean}}
   */
  function lovePotionGiven(g, npc, it) {
    const msg = [];
    const curse = (it.f[17] | 0);
    const isPotion = (it.id | 0) === 620;
    const name = npc.name || '对方';

    if (isPotion && curse <= -1) {
      // 318650-318664：诅咒的媚藥 → 轻蔑
      msg.push(`媚藥被诅咒了。${name}用轻蔑的眼神看着你。`);
      if (Elona.Relation && Elona.Relation.modimp) Elona.Relation.modimp(npc, -15, g);
      if (Elona.Relation && Elona.Relation.modimp2) Elona.Relation.modimp2(npc, -15, g);
      return { ok: true, cursed: true, message: msg.join('') };
    }

    // 226685-226695（食物路径）/ 318666+（媚藥事件路径）
    msg.push(`${name}觉得「好像…有什么奇怪的感觉…」`);
    npc.set(79, 17 + 100 * 3);                       // 蛊惑状态显示（var_58(79) = 17+300）
    const imp = npc.get(17) | 0;
    if (isPotion) {
      // 318685+：dmgcon(7,100)、modimp limit(力量/20,0,15)、lovemiracle、modimp2 +10
      if (Elona.Resist && g.dmgconTable) Elona.Resist.dmgcon(g, g.dmgconTable, npc, 7, 100);
      if (imp < 100 && Elona.Relation && Elona.Relation.modimp) {
        Elona.Relation.modimp(npc, limit(idiv(npc.get(20) | 0, 20), 0, 15), g);
      }
      const mr = loveMiracle(g, npc);
      if (mr.triggered && mr.item) {
        msg.push(`啊…！${name}的脚下掉出了 ${mr.kind === 'egg' ? '一枚卵' : '一瓶乳'}！`);
      }
      if (Elona.Relation && Elona.Relation.modimp2) Elona.Relation.modimp2(npc, 10, g);
    } else {
      // 226685+：modimp +30、karma −10、dmgcon(7,500)、lovemiracle
      if (imp < 100 && Elona.Relation && Elona.Relation.modimp) Elona.Relation.modimp(npc, 30, g);
      const p = g.player;
      if (p) p.set(49, (p.get(49) | 0) - 10);        // modkarma 0, -10
      const mr = loveMiracle(g, npc);
      if (mr.triggered && mr.item) {
        msg.push(`啊…！${name}的脚下掉出了 ${mr.kind === 'egg' ? '一枚卵' : '一瓶乳'}！`);
      }
      if (Elona.Resist && g.dmgconTable) Elona.Resist.dmgcon(g, g.dmgconTable, npc, 7, 500);
      npc.set(79, 17 + 100 * 3);
    }
    return { ok: true, cursed: false, message: msg.join('') };
  }

  /**
   * 同伴互动选项 12「いちゃつく」（290448-290470）：lovemiracle2 + 恋人台词。
   * @returns {{ok:boolean, message:string, item?:object}}
   */
  function cuddle(g, npc) {
    if (!npc) return { ok: false, message: '没有对象。' };
    const r = loveMiracle2(g, npc);
    const name = npc.name || '同伴';
    let message = `${name}扭扭捏捏地从怀里掏出了一个包裹。`;
    // 290458-290470 的三选一台词（var_65(191)==100 且 var_52 时的分支）
    const lines = [
      `「收下吧…这是${name}的心意。」`,
      `${name}红着脸慌忙把巧克力塞给了你。`,
      `${name}微笑着展示了藏在身后的巧克力。`,
    ];
    message += ' ' + lines[g.rng.rnd(lines.length)];
    if (r.item && Elona.ItemDB) {
      message += `（获得了 ${Elona.ItemDB.name(889)}）`;
    }
    return { ok: true, message, item: r.item };
  }

  /** 物品是否媚藥性（ibit(6) == 1 或 id 620） */
  function isAphrodisiac(it) {
    if (!it) return false;
    if ((it.id | 0) === 620) return true;
    return !!(Elona.ItemDB && Elona.ItemDB.ibit && Elona.ItemDB.ibit(6, it) === 1);
  }

  // ==========================================================================
  // 情人节（2 月，var_65(11)==2）的两个操作弹窗动作 —— 289744-289753 入口
  // ==========================================================================
  /**
   * 动作 12「チョコをねだる」（290452-290482）。
   * 入口条件：2 月、好感 >= 200、非玩家自己、var_65(505)==1（当天还没讨过）。
   * 结算：lovemiracle2 在玩家脚下生成手作りチョコ(889) → 季节台词 →
   *       「何かが足元に転がってきた。」→ var_65(505)=0 关掉当天的入口。
   */
  function begChocolate(g, npc) {
    if (!npc) return { ok: false, message: '没有对象。' };
    const r = loveMiracle2(g, npc);
    const name = npc.name || '对方';
    const lines = [
      `「收下吧…这是${name}的心意。」`,
      `${name}扭扭捏捏地从怀里掏出了一个小包裹。`,
      `${name}红着脸慌忙把巧克力塞给了你。`,
      `${name}微笑着展示了藏在身后的巧克力。`,
      `「…真的可以送给我这样的人吗？」`,
    ];
    const rng = (g && g.rng) || Elona.rng;
    const pick = (rng && typeof rng.rnd === 'function') ? rng.rnd(lines.length) : 0;
    // 290458-290477：`customtalk var_244, 110` 会把 var_65(191) 置 100，
    // 只有 NPC 配了台词文件时才有这一组日文多选台词；否则是固定的 "Here you are."。
    // 汉化口径：两种都给中文（有台词文件 → 5 选 1 演出，没有 → 固定一句）。
    const hasTalk = !!(npc.talkFile || (Elona.Status && Elona.Status.cbit
      && Elona.Status.cbit(npc, 989)));
    let message = hasTalk ? lines[pick] : '「给你。」';
    message += ' 有什么东西滚到了脚边。';
    if (g && typeof g.setV65 === 'function') g.setV65(505, 0);   // 290481
    return { ok: true, message, item: r.item, f27: r.f27 };
  }

  /**
   * 动作 15「自分をプレゼント」（290579-290683）。
   * 按好感 var_58(17) 分 6 档给出反应；< 100 时 modimp 扣分
   * （290597 -20 / 290614 -10 / 290631 -10），>= 100 只演出不扣分。
   * 入口条件：2 月、非玩家自己、var_65(515)!=0（活动开启）。
   */
  function giftSelf(g, npc) {
    if (!npc) return { ok: false, message: '没有对象。' };
    const imp = npc.get(17) | 0;
    const name = npc.name || '对方';
    let delta = 0;
    let message;
    if (imp < 0) {
      delta = -20;
      message = `${name}露骨地露出嫌恶的表情！「好恶心」「离我远点！这个变态！」`;
    } else if (imp < 50) {
      delta = -10;
      message = `${name}是真心觉得你恶心！「别再靠过来了」「护卫！护卫！！」`;
    } else if (imp < 100) {
      delta = -10;
      message = `${name}后退了一步，明显被吓到了。「呜、哇啊…」／${name}决定当作什么都没看见。`;
    } else if (imp < 150) {
      message = `${name}的脸僵住了。「诶？」又看了你一眼之后就呆住了…。`;
    } else if (imp < 200) {
      message = `${name}苦笑着…。困惑地劝你还是快点去把身体洗干净。`;
    } else {
      message = `${name}是真心在担心你的脑袋…。「快去把那些巧克力洗掉吧」`;
    }
    if (delta) {
      if (Elona.Relation && Elona.Relation.modimp) Elona.Relation.modimp(npc, delta, g);
      else if (Elona.NPC && Elona.NPC.modImp) Elona.NPC.modImp(npc, delta, g);
      else npc.set(17, Math.max(-100, imp + delta));
    }
    return { ok: true, message, delta, friendship: npc.get(17) | 0 };
  }

  /**
   * 357146-357151：手工巧克力失败 → 「你弄得浑身都是巧克力」，
   * var_65(515)=1 打开动作 15「把自己当作礼物」的入口。
   * 343570-343578：洗澡冲掉巧克力 → var_65(515)=0。
   */
  function chocoSplash(g) {
    if (g && typeof g.setV65 === 'function') g.setV65(515, 1);
    return { ok: true, message: '你弄得浑身都是巧克力。' };
  }
  function washOffChoco(g) {
    const on = !!(g && typeof g.getV65 === 'function' && (g.getV65(515) | 0) !== 0);
    if (on && g && typeof g.setV65 === 'function') g.setV65(515, 0);
    return { ok: true, washed: on, message: on ? '沾在身上的巧克力被冲掉了。' : '' };
  }

  Elona.Love = {
    loveMiracle, loveMiracle2, lovePotionGiven, cuddle, isAphrodisiac, dropAtFeet,
    begChocolate, giftSelf, chocoSplash, washOffChoco,
  };
})(window);
