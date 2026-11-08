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
    const it = dropAtFeet(g, c, 889);
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
      message += `（获得了 ${Elona.ItemDB.name(889, 'en')}）`;
    }
    return { ok: true, message, item: r.item };
  }

  /** 物品是否媚藥性（ibit(6) == 1 或 id 620） */
  function isAphrodisiac(it) {
    if (!it) return false;
    if ((it.id | 0) === 620) return true;
    return !!(Elona.ItemDB && Elona.ItemDB.ibit && Elona.ItemDB.ibit(6, it) === 1);
  }

  Elona.Love = { loveMiracle, loveMiracle2, lovePotionGiven, cuddle, isAphrodisiac, dropAtFeet };
})(window);
