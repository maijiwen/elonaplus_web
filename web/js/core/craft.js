'use strict';
/**
 * 调合 / 炼金（blending）—— 原版 *label_2645 的配方表 + rpdiff / blendcheckmat / label_2657 消耗
 *
 * 【已确认】配方表结构（start.hsp 280043 起，`dim var_2119, 100, 1899`）：
 *   var_2119(0, id)      产物 id        var_2119(1, id)   必要时间（低位=回合，高位 /10000=小时）
 *   var_2119(2, id)      催化剂标记（>0 时第 1 个材料不消耗）
 *   var_2119(10+2n, id)  第 n 个所需技能   (11+2n) 需求等级
 *   var_2119(20+n, id)   第 n 个材料（每槽消耗 1 个，最多 10 槽）
 *   var_718(id)          配方名 lang("jp","en")
 * 由 tools/extract_recipes.py 机械提取到 data/tables/recipes.json。
 * 【0-CM 已确认】必要时间的编码（279822-279834 window_recipe2 / 281758-281775 执行）：
 *   HSP 的 `\` 是取模 —— `var_2149 \ 10000` = 低位回合数、`var_2149 / 10000` = 小时数。
 *   <10000 → 每个产物耗时「N 回合」的 rowact 12；>=10000 → 先等低位回合，
 *   之后每个产物 `var_65(13)++ ; gosub *label_4352` 推进高位小时。
 *
 * 【已确认】成功率 rpdiff（279498-279570）：
 *   基础 80；材料祝福(f[17]>=1) 每件 -10（需求等级缩放下降 → **成功率上升**）、
 *   诅咒(f[17]<=-1) 每件 +20（→ 成功率下降）—— 见 279509-279531 的 `var_2126` 与消息文本；
 *   每个需求技能：玩家技能 <=0 → -125；否则 `d = -(需求*200/技能 - 200)`，d>0 时 d/5，下限 -125；
 *   最后 <25 → 0，>100 → 100。
 *   判定：`rpdiff(...) < rnd(100)` 即失败（281089）。
 *
 * 【已确认】材料匹配（279627-279644）：
 *   < 9000 → 精确物品 id；9000-9999 → 物品标签串 var_543 含 `/标签/`（9004 = 任意物品）；
 *   >= 10000 → 物品类别 refitem(id,5) == 该值。标签表由 extract_recipes.py 从
 *   `*label_1935`（169603-172272，1,334 组 `var_542`/`var_543`，526 组有标签）提取为 item_tags.json。
 *
 * 【已确认】消耗（label_2657，281054-281086）：
 *   每个材料槽各消耗 1 个；成功时必定消耗；失败时仅 `rnd(3)==0` 才消耗；
 *   催化剂配方（var_2119(2)>0）的第 1 槽不消耗；产物 10024 的配方完全不消耗。
 *
 * 【推断/简化，见差异报告】
 *   - 原版由「使用调合道具」进入（var_486 分支），本项目把入口挂在 `m` 键（原版 m = 素材画面 label_2582）。
 *   - 原版逐槽手动选材料；本实现自动从背包与 4 格内地面挑选匹配物品（结果等价）。
 *   - 产物生成：id 10000-10025 的 22 个配方有专属分支（`*label_2660`，281835-282961），
 *     由 `core/craftprod.js` 处理；其余配方走通用路径（`var_2119(1)` 的数量，每次 1 个）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const MATERIAL_RANGE = 4;      // 原版 dist(item, player) > 4 不计入
  const MAX_MATS = 10;
  const UNSAFE_PRODUCT = 208;    // 垃圾炼成：排除 587/699（279611）

  let DATA = null;
  let TAGS = null;

  async function load() {
    if (!DATA) DATA = await Elona.Data.table('recipes');
    if (!TAGS) TAGS = await Elona.Data.table('item_tags');
    return DATA;
  }

  /** 物品标签串（var_543） */
  function tagOf(itemId) { return (TAGS && TAGS[String(itemId)]) || ''; }

  /** 材料 id → 可读名（用于面板） */
  function matName(matId) {
    if (matId >= 10000) return `类别 ${matId}`;
    if (matId === 9004) return '任意物品';
    if (matId > 9000) {
      const lb = DATA && DATA.labels && DATA.labels[String(matId)];
      return lb ? `任意「${lb}」` : `标签 ${matId}`;
    }
    return Elona.ItemDB ? Elona.ItemDB.name(matId, 'en') : String(matId);
  }

  /** 材料是否匹配某物品（blendcheckmat 的核心判据，279627-279644） */
  function matMatches(matId, item) {
    if (!item) return false;
    if (matId < 9000) return item.id === matId;
    if (matId < 10000) {
      if (matId === 9004) return true;                 // 任意物品
      const tag = tagOf(item.id);
      const want = DATA && DATA.labels && DATA.labels[String(matId)];
      if (!want) return false;                          // 无标签名数据 → 不接受
      return tag.indexOf('/' + want + '/') >= 0;
    }
    return Elona.ItemDB.ref(item.id, 5) === matId;      // 类别匹配
  }

  /**
   * 收集候选物品：背包 + 4 格内地面（279590-279620 的过滤条件）
   * @returns {Array<{item:object, where:'inv'|'ground', idx:number}>}
   */
  function pool(g) {
    const p = g.player;
    const out = [];
    const usable = (it) => {
      if (!it || (it.f[0] | 0) <= 0) return false;
      if (it.eqSlot >= 0) return false;                 // 装备中不参与
      if ((it.f[18] | 0) !== 0) return false;           // var_99(18)（已被占用）
      if (Elona.ItemDB.ibit && Elona.ItemDB.ibit(13, it)) return false;   // ibit(bit, item)
      return true;
    };
    for (let i = 0; i < p.inv.length; i++) {
      const it = p.inv[i];
      if (!usable(it)) continue;
      out.push({ item: it, where: 'inv', idx: i });
    }
    if (Array.isArray(g.groundItems)) {
      for (let i = 0; i < g.groundItems.length; i++) {
        const it = g.groundItems[i];
        if (!usable(it)) continue;
        const d = Math.max(Math.abs(it.f[5] - p.x), Math.abs(it.f[6] - p.y));
        if (d > MATERIAL_RANGE) continue;
        out.push({ item: it, where: 'ground', idx: i });
      }
    }
    return out;
  }

  /** 某材料 id 在候选池里的可用数量（blendmatnum，279657-279721） */
  function countMat(g, matId, exclude) {
    const used = exclude || new Set();
    let n = 0;
    for (const cand of pool(g)) {
      if (used.has(cand.item)) continue;
      if (matMatches(matId, cand.item)) n += (cand.item.f[0] | 0);
    }
    return n;
  }

  /**
   * 为配方挑出实际要消耗的物品实例（每槽一个）。
   * @returns {{ok:boolean, picks:Array, missing:number[]}}
   */
  function pickMaterials(g, recipe) {
    const poolList = pool(g);
    const used = new Set();
    const picks = [];
    const missing = [];
    const mats = (recipe.mats || []).slice(0, MAX_MATS);
    for (let i = 0; i < mats.length; i++) {
      const mid = mats[i];
      if (!mid) break;
      let found = null;
      for (const cand of poolList) {
        if (used.has(cand.item)) continue;
        if (mid === UNSAFE_PRODUCT) continue;            // 占位（产物判断在下面做）
        if (matMatches(mid, cand.item)) { found = cand; break; }
      }
      if (!found) { missing.push(mid); continue; }
      used.add(found.item);
      picks.push(found);
    }
    // 279611：产物为 208（垃圾）时排除 587/699 这两种重要物品
    if ((recipe.products[0] | 0) === UNSAFE_PRODUCT) {
      for (let i = picks.length - 1; i >= 0; i--) {
        const id = picks[i].item.id;
        if (id === 587 || id === 699) { missing.push((recipe.mats || [])[i]); picks.splice(i, 1); }
      }
    }
    return { ok: missing.length === 0, picks, missing };
  }

  /**
   * 成功率 —— rpdiff（279498-279570）。
   * @param {object} g
   * @param {object} recipe
   * @param {Array} picks 已选材料（空数组 = 原版 rpdiff(id,-1,-1) 的调用）
   */
  function successRate(g, recipe, picks) {
    const p = g.player;
    let base = 80;
    let scale = 100;
    const list = picks || [];
    if (list.length > 0) {
      for (const it of list) {
        const bless = it.item.f[17] | 0;
        let d = 0;
        // 279509-279512：祝福 -10（需求下降→更容易成功）、诅咒 +20（需求上升→更难）
        if (bless >= 1) d -= 10;
        if (bless <= -1) d += 20;
        scale += d;
      }
    }
    for (const pair of (recipe.skills || [])) {
      const sid = pair[0] | 0;
      const need = pair[1] | 0;
      if (!sid) break;
      const have = p.skill(sid) | 0;
      if (have <= 0) { base -= 125; continue; }          // 未习得 → 直接 -125
      let needV = need;
      if (list.length > 0) {
        needV = idiv(need * scale, 100);
        if (needV < 1) needV = 1;
      }
      let d = -(idiv(needV * 200, have) - 200);
      if (d > 0) d = idiv(d, 5);
      if (d < -125) d = -125;
      base += d;
    }
    if (base < 25) base = 0;
    if (base > 100) base = 100;
    return base;
  }

  /** 成功率文字（rpsuccessrate，279467-279495） */
  function rateText(rate) {
    if (rate >= 100) return 'Perfect!';
    if (rate >= 90) return 'A piece of cake!';
    if (rate >= 80) return 'Very likely';
    if (rate >= 70) return 'No problem';
    if (rate >= 60) return 'Probably OK';
    if (rate >= 50) return 'Maybe';
    if (rate >= 40) return 'Bad';
    if (rate >= 30) return 'Very bad';
    if (rate >= 20) return 'Almost impossible';
    return 'Impossible!';
  }

  /**
   * 0-CM：必要时间（window_recipe2，279822-279834）。
   * products[1] 编码：低位 = 回合数（HSP `\ 10000` 取模）、高位 = 小时数（/ 10000）。
   * @returns {{turns:number, hours:number, text:string}}
   */
  function timeOf(recipe) {
    const raw = (recipe && recipe.products && (recipe.products[1] | 0)) || 0;
    const turns = raw % 10000;
    const hours = idiv(raw, 10000);
    let text = `${turns}ターン`;
    if (hours > 0) text += `と${hours}時間`;
    return { turns, hours, text };
  }

  /** 配方列表（含当前可用性），供面板显示 */
  function list(g) {
    if (!DATA) return [];
    const out = [];
    for (const k in DATA.recipes) {
      const r = DATA.recipes[k];
      const pick = pickMaterials(g, r);
      const rate = successRate(g, r, pick.picks);
      // 需求技能是否已习得（未习得时 rpdiff 直接 -125，成功率为 0）
      const skillOk = (r.skills || []).every((pair) => !pair[0] || (g.player.skill(pair[0]) | 0) > 0);
      const lackSkills = (r.skills || []).filter((pair) => pair[0] && (g.player.skill(pair[0]) | 0) <= 0)
        .map((pair) => pair[0]);
      out.push({
        id: r.id, name: r.en || r.jp, jp: r.jp,
        rate, rateText: rateText(rate),
        time: timeOf(r),                              // 0-CM：必要時間
        ok: pick.ok, missing: pick.missing, skillOk, lackSkills,
        mats: (r.mats || []).filter((x) => x),
        products: r.products,
        skills: r.skills,
      });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  /**
   * 执行调合 —— label_2658（281087-281760）+ 消耗 label_2657（281054-281086）。
   * @returns {{ok:boolean, success?:boolean, rate?:number, product?:object, message:string}}
   */
  // 特殊产物分支要 await CraftProduct.load()，所以结算本身是 async；
  // rowact 完成回调拿到的是 Promise，调用链（Actions.tickRowAct）不依赖返回值。
  async function settle(g, recipeId, opts) {
    const o = opts || {};
    const r = DATA.recipes[String(recipeId)];
    if (!r) return { ok: false, message: '没有这个配方。' };
    // 0-FY：rowact 12 完成时 var_58(140) 已被 Actions.tickRowAct 清零，
    //   所以只有「立即结算」路径才需要拒绝进行中的其它行动。
    if (!o.rowact && (g.player.get(140) | 0) !== 0) return { ok: false, message: '你正忙着别的事情。' };

    const pick = pickMaterials(g, r);
    if (!pick.ok) {
      const names = pick.missing.map(matName).join('、');
      return { ok: false, message: `材料不足：还需要 ${names}。` };
    }
    const rate = successRate(g, r, pick.picks);
    // 281089：rpdiff(...) < rnd(100) → 失败
    const success = rate >= g.rng.rnd(100);
    let product = null;
    let productPid = 0;    // 0-DX：走 *label_2660 时记下配方产物号（10000-10025）

    if (success) {
      const pid = r.products[0] | 0;
      // 0-DX：产物 id >= 10000 走 *label_2660 的专属分支（craftprod.js）
      // —— 之前这里统一 createItem(products[0])，13 个特殊配方会生成不存在的物品。
      const CP = Elona.CraftProduct;
      if (CP && CP.isSpecial(pid)) {
        if (CP.load) { try { await CP.load(); } catch (e) { /* 表缺失时按空表 */ } }
        const built = CP.build(g, { pid, picks: pick.picks, recipe: r });
        product = built.item || null;
        productPid = pid;
      } else {
        // products[1] 是必要时间而非数量 —— 每次调合产出 1 个
        const qty = 1;
        if (pid > 0 && Elona.ItemDB) {
          product = Elona.ItemDB.createItem(pid, qty);
          if (product) {
            product.f[0] = qty;
            let slot = -1;
            for (let k = 0; k < g.player.inv.length; k++) {
              if (!g.player.inv[k] || (g.player.inv[k].f[0] | 0) <= 0) { slot = k; break; }
            }
            if (slot >= 0) g.player.inv[slot] = product;
            else g.player.inv.push(product);
          }
        }
      }
    }

    // ---- 必要时间（0-CM：279822-279834 + 281758-281775）----
    const tm = timeOf(r);
    if (tm.hours > 0) {
      // >=10000：每个产物推进高位小时（var_65(13)++ ; gosub *label_4352）
      if (g.advanceHours) g.advanceHours(tm.hours);
    }
    // ---- 消耗（label_2657）----
    const cat = (r.flag2 | 0) > 0;
    for (let i = 0; i < pick.picks.length; i++) {
      const cand = pick.picks[i];
      if ((r.products[0] | 0) === 10024) break;       // 281063：该配方不消耗
      if (cat && i === 0) continue;                   // 281066：催化剂槽不消耗
      let consume = success;
      if (!success) consume = g.rng.rnd(3) === 0;     // 281073：失败时 1/3 概率损失
      if (!consume) continue;
      const it = cand.item;
      it.f[0] = (it.f[0] | 0) - 1;
      if (cand.where === 'ground') {
        if ((it.f[0] | 0) <= 0) g.removeGroundItem(it);
        else g.refreshGroundCell(it.f[5], it.f[6]);
      }
    }

    // ---- 技能经验（281732-281735）：50 + 需求等级 ----
    if (Elona.Stats && Elona.Stats.skillExp && g.player.get(0) === 1) {
      for (const pair of (r.skills || [])) {
        const sid = pair[0] | 0;
        if (!sid) break;
        Elona.Stats.skillExp(g.player, sid, g.player.index, 50 + (pair[1] | 0), 9999, 0, g);
      }
    }

    const name = r.en || r.jp;
    if (success) {
      if (productPid === 10023) {
        g.log(`调合成功：${name} → 生体复原完成。`);   // 产物是怪物本体
      } else {
        const pname = product && Elona.ItemDB ? Elona.ItemDB.name(product.id, 'en') : '';
        g.log(`调合成功：${name}${pname ? ' → ' + pname : ''}。`);
      }
    } else {
      g.log(`调合失败！（${name}）`);                  // 281095
    }
    // 回合部分的耗时：rowact 12 的 var_58(141) = 低位回合数（281758-281766）
    //   0-FY：走 rowact 时回合已经在持续行动过程中逐回合消耗掉了，这里不能再快进。
    if (!o.rowact) {
      if (tm.turns > 0) {
        for (let k = 0; k < tm.turns; k++) g.endTurn();
      } else {
        g.endTurn();
      }
    }
    return {
      ok: true, success, rate, product, productPid,
      message: success ? `调合成功：${name}` : `调合失败：${name}`,
    };
  }

  /**
   * 立即结算入口（保留兼容 0-CM 的调用与验证脚本）。
   * @param {object} [opts] {rowact:true} 表示由持续行动完成回调调用
   */
  async function craft(g, recipeId, opts) {
    await load();
    return settle(g, recipeId, opts);
  }

  /**
   * 0-FY：调合改为持续行动 —— *label_2659（281742-281775）。
   *   源码 `var_58(140)=12 ; var_58(141) = 必要時間 \ 10000`，
   *   回合里每 1/30 概率显示「*こねこね*」，141 归零才 gosub *label_2658 结算。
   *   高位（必要时间 / 10000，即小时）在结束时由 advanceHours 补上。
   */
  async function begin(g, recipeId) {
    await load();
    const r = DATA.recipes[String(recipeId)];
    if (!r) return { ok: false, message: '没有这个配方。' };
    if ((g.player.get(140) | 0) !== 0) return { ok: false, message: '你正忙着别的事情。' };
    const pick = pickMaterials(g, r);
    if (!pick.ok) {
      return { ok: false, message: `材料不足：还需要 ${pick.missing.map(matName).join('、')}。` };
    }
    const tm = timeOf(r);
    const turns = Math.max(1, tm.turns | 0);
    const A = Elona.Actions;
    if (!A) return settle(g, recipeId, {});        // 没有动作层时退回即时结算
    const st = A.begin(g, 12, turns, { recipeId, hours: tm.hours, turns: tm.turns });
    if (!st.ok) return { ok: false, message: st.message || '现在不能调合。' };
    g.log(`你开始调合 ${r.en || r.jp}。（${tm.text}）`);
    g.endTurn();
    return { ok: true, started: true, turns, hours: tm.hours, recipeId };
  }

  /** 由 Game.completeRowAct(12) 调用；此时数据已在 begin() 时载入。 */
  function finish(g, payload) {
    const pl = payload || {};
    if (!DATA) return { ok: false, message: '配方表尚未载入。' };
    return settle(g, pl.recipeId | 0, { rowact: true });
  }

  Elona.Craft = {
    load, list, craft, begin, finish, successRate, rateText, timeOf, matMatches, matName, countMat,
    pickMaterials, tagOf,
    get data() { return DATA; },
    get tags() { return TAGS; },
    MAX_MATS, MATERIAL_RANGE,
  };
})(window);
