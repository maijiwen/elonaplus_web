'use strict';
/**
 * 料理（cooking）—— effect 15（353874-353880）+ *label_2303（225016-225136）
 *
 * 【效果链路】这一段容易被误判成「7 行的空分支」，实际是三层跳转：
 *
 *   353874  if ( var_1302 == 15 ) {          ; 用烹饪器具
 *   353876      var_396 = 184                ; 184 = 料理技能 id（var_81(184) = "料理"）
 *   353877      gosub *label_2960            ; 技能执行器
 *   353878      goto *label_3017
 *
 *   *label_2960（315840）只处理 `var_396 >= 300`（法术），184 直接穿过去；
 *   紧接着就是：
 *
 *   318379  *label_2965
 *   318380      var_1302 = var_396           ; ← 把 184 写回 var_1302
 *   319868  if ( var_1302 == 184 ) {         ; ← 于是命中这里
 *   319870      var_1586 = var_579           ; var_1586 = 器具
 *   319873      var_486 = 16                 ; 物品筛选：类别 57000 且 f[26] == 0
 *   319875      gosub *label_2824           ; 选食材
 *   319876      if ( stat == 0 ) return 0
 *   319878      if ( var_243 == 0 ) {        ; 玩家自己
 *   319879          if ( SP < 50 ) { if ( SP < rnd(75) ) → 「疲労し過ぎて失敗した！」
 *   319887          dmgsp 0, rnd(15/2+1) + 15/2+1
 *   319892      gosub *label_2303           ; ← 料理本体
 *
 * 【label_2303 的算法】
 *   var_1585 = 料理技能等级
 *   品质 = rnd(技能+6) + rnd(器具档次/50 + 1)
 *   品质 = min(品质, 技能/5 + 7)
 *   品质 = rnd(品质+1)
 *   品质 > 3 时再 rnd 一次
 *   技能 >= 5  且 品质 < 3 → 1/4 概率抬到 3
 *   技能 >= 10 且 品质 < 3 → 1/3 概率抬到 3
 *   品质 += 器具档次 / 100
 *   夹到 1..9，再按器具档次设上限：
 *      200→8  150→7  100→6  80→5  60→4  40→3（225/10 不设限）
 *   make_dish：f[2] = 菜品贴图、f[7] = 500、f[26] = 品质、f[27] = 保鲜期
 *   f[20] += limit(玩家料理技能/100, 0, 20)
 *   品质 > 2 时 skillexp 184, 30 + 品质 * 5
 *
 * 【器具档次 = 器具的 f[25]（items.json 的 v99_25）】
 *   調理機 306 / フードプロセッサー 142 = 200，バーベキューセット 606 = 225，
 *   オーブン 112 = 150，調理台 153/154/155 = 100，携帯調理道具 256 = 80，
 *   鍋 223 = 60，焚き火 255 = 40，《賢者の錬金釜》790 = 10。
 *
 * 【数据】web/data/tables/dishimage.json = var_416(品质 0..9, 类别 1..8)（13738-13745）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  const SKILL_COOK = 184;      // var_81(184) = 料理
  const CAT_FOOD = 57000;      // refitem(id, 5)
  const BUST_ID = 1096;        // イツパロトルの胸像（胸前火焰 → 净化食材）
  /** var_83(2, 184) = 15（2114 行 `var_83(0, 184) = 14, 0, 15, 10000, 0`） */
  const SP_COEF = 15;
  /** 器具档次 → 品质上限（225080-225105） */
  const TIER_CAP = { 200: 8, 150: 7, 100: 6, 80: 5, 60: 4, 40: 3 };

  let DISH = null;

  async function load() {
    if (DISH) return DISH;
    DISH = await Elona.Data.table('dishimage');
    return DISH;
  }
  function setTable(t) { DISH = t; }

  const rndOf = (g, n) => (g && g.rng ? g.rng.rnd(n) : Math.floor(Math.random() * n));

  /** 菜品贴图 var_416(品质, 类别)（13738-13745） */
  function dishImage(quality, category) {
    if (!DISH) return 0;
    const col = DISH[String(category | 0)];
    if (!col) return 0;
    const q = Math.max(0, Math.min(9, quality | 0));
    return col[q] | 0;
  }

  /** 器具档次 = f[25] */
  function toolTier(toolIt) { return toolIt ? (toolIt.f[25] | 0) : 0; }

  /** 可作食材：类别 57000 且未烹调（296376-296385，var_486 == 16） */
  function isIngredient(g, it) {
    if (!it || (it.f[0] | 0) <= 0) return false;
    if (!Elona.ItemDB || !Elona.ItemDB.ref) return false;
    if (Elona.ItemDB.ref(it.id, 5) !== CAT_FOOD) return false;
    return (it.f[26] | 0) === 0;
  }

  /** 游戏内小时数（var_65(10..13)） */
  function clockHours(g) {
    const V = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    return V(13) + V(12) * 24 + V(11) * 24 * 30 + V(10) * 24 * 30 * 12;
  }

  /**
   * make_dish（31310-31319）：把一件食材变成「菜品」。
   *   不换物品 id，只换贴图 / 价值 / 品质 / 保鲜期。
   */
  function makeDish(g, it, quality) {
    const q = Math.max(0, Math.min(9, quality | 0));
    it.f[2] = dishImage(q, idiv(it.f[25] | 0, 1000));
    it.f[7] = 500;
    if ((it.f[24] | 0) === 35 && (it.f[27] | 0) >= 0) {
      it.f[27] = clockHours(g) + 72;
    }
    it.f[26] = q;
    return it;
  }

  /** 地面（玩家脚下）是否有某件物品 —— item_find 的 prm_571 = 1 分支 */
  function groundHas(g, id) {
    if (!g || !Array.isArray(g.groundItems) || !g.player) return null;
    const px = g.player.x, py = g.player.y;
    for (const it of g.groundItems) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if ((it.id | 0) !== (id | 0)) continue;
      if ((it.f[5] | 0) !== (px | 0) || (it.f[6] | 0) !== (py | 0)) continue;
      return it;
    }
    return null;
  }

  /**
   * 品质判定（225032-225105）—— 逐句照抄，注意每次 `rnd` 的时机。
   * @param {number} skill 料理技能等级 var_1585
   * @param {number} tier  器具档次 var_99(25, 器具)
   */
  function rollQuality(g, skill, tier) {
    const R = (n) => rndOf(g, Math.max(1, n | 0));
    let s = skill | 0;
    if (s <= 0) s = 1;
    let q = R(s + 6) + R(idiv(tier, 50) + 1);
    const cap = idiv(s, 5) + 7;
    if (q > cap) q = cap;
    q = R(q + 1);
    if (q > 3) q = R(q);
    if (s >= 5 && q < 3 && R(4) === 0) q = 3;
    if (s >= 10 && q < 3 && R(3) === 0) q = 3;
    q += idiv(tier, 100);
    if (q > 9) q = 9;
    if (q < 1) q = 1;
    const tcap = TIER_CAP[tier];
    if (tcap !== undefined && q > tcap) q = tcap;
    return q;
  }

  /**
   * 料理本体（319868-319897 的 SP 段 + 225016-225136 的 label_2303）。
   * @param {object} g
   * @param {object} toolIt 烹饪器具
   * @param {number} foodIdx 食材在玩家背包里的下标
   * @param {object} [opts] { skipSp:true } 跳过 SP 消耗（测试用）
   * @returns {{ok:boolean, reason?:string, message?:string, quality?:number, item?:object}}
   */
  function cook(g, toolIt, foodIdx, opts) {
    const o = opts || {};
    const p = g.player;
    if (!p || !p.inv) return { ok: false, reason: 'no-player' };
    const food = p.inv[foodIdx];
    if (!food) return { ok: false, reason: 'no-item', message: '没有可料理的食材。' };
    if (!isIngredient(g, food)) {
      return { ok: false, reason: 'not-ingredient', message: '这不是能料理的食材。' };
    }
    // ---- 319878-319890：SP 消耗与过劳判定 ----
    if (!o.skipSp && Elona.Status && Elona.Status.dmgsp) {
      const sp = p.get(52) | 0;
      const base = idiv(SP_COEF, 2) + 1;
      if (sp < 50 && sp < rndOf(g, 75)) {
        Elona.Status.dmgsp(p, base);
        const msg = '疲労し過ぎて失敗した！';
        if (g.log) g.log(msg);
        return { ok: false, reason: 'exhausted', message: msg };
      }
      Elona.Status.dmgsp(p, rndOf(g, base) + base);
    }

    // ---- 225017：把食材从堆里拆出 1 个 ----
    if (Elona.ItemDB && Elona.ItemDB.separate) Elona.ItemDB.separate(p, foodIdx);
    const it = p.inv[foodIdx] || food;
    const foodName = Elona.ItemDB.name(it, 'jp');

    // ---- 225019-225027：脚下有イツパロトルの胸像 → 净化（清 f[17]） ----
    let purified = false;
    const bust = groundHas(g, BUST_ID);
    if (bust && (bust.f[0] | 0) >= 1) {
      it.f[17] = 0;
      purified = true;
    }

    // ---- 225028-225105：品质 ----
    const skill = (p.skill ? p.skill(SKILL_COOK) : 0) | 0;
    const tier = toolTier(toolIt);
    const q = rollQuality(g, skill, tier);

    // ---- 225106：make_dish ----
    makeDish(g, it, q);

    // ---- 225107-225109：台词 ----
    const toolName = toolIt ? Elona.ItemDB.name(toolIt, 'jp') : '器具';
    // 0-EZ：料理名由 ItemDB.name 走 foodname 中文表（itemname 30169-30172）
    const msg = `用${toolName}把${foodName}做成了${Elona.ItemDB.name(it, 'jp')}。`;
    if (g.log) g.log(msg);

    // ---- 225110-225112：清「腐坏」标志 + 营养加成 ----
    if (Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(18, it, 0);
    it.f[20] = (it.f[20] | 0) + limitF(idiv(p.skill ? p.skill(SKILL_COOK) : 0, 100), 0, 20);

    // ---- 225113-225135：按类别加附魔 ----
    const power = 50 + (it.f[20] | 0) * 30;
    const cat = idiv(it.f[25] | 0, 1000);
    const ENC = { 1: 161, 8: 151, 2: 180, 3: 179, 7: 174, 4: 162, 6: 185, 5: 188 };
    if (ENC[cat] && Elona.ItemDB.encadd) {
      Elona.ItemDB.encadd(it, 3 * 10000 + ENC[cat], power, g, { prm553: 1 });
    }

    // ---- 225131-225133：技能经验 ----
    if (q > 2 && Elona.Stats && Elona.Stats.skillExp) {
      Elona.Stats.skillExp(p, SKILL_COOK, p.index | 0, 30 + q * 5, 0, 0, g);
    }

    // ---- 225134：item_stack ----
    if (Elona.ItemDB.stack) Elona.ItemDB.stack(p, foodIdx);

    return { ok: true, quality: q, purified, item: it, message: msg };
  }

  function limitF(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** SP 消耗值（给定随机数的情形下便于测试） */
  function spCost() {
    const base = idiv(SP_COEF, 2) + 1;
    return { base, min: base, max: base * 2 - 1 };
  }

  Elona.Cook = {
    load, setTable,
    SKILL: SKILL_COOK, CAT_FOOD, TIER_CAP,
    isIngredient, toolTier, dishImage, makeDish, rollQuality,
    cook, spCost, clockHours,
  };
})(typeof window !== 'undefined' ? window : globalThis);
