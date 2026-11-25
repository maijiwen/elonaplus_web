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
  /**
   * 281089：真正的成功率判定是 `rpdiff(var_2120, -1, -1)` —— 第二个参数（材料数）传 -1，
   * 于是 279509-279531 的祝福/诅咒修正整段被跳过。也就是说**素材祝福只影响界面显示**
   * （window_recipe2 传的是 var_2141 = 已选材料数），不参与实际掷骰。
   * 这是源码的行为；若想改成「祝福真的提高成功率」，把这里置 false 即可。
   */
  const SETTLE_IGNORES_MATERIALS = true;
  /** 281213：武具制作（柔 1087 / 剛 1089 / 鋭 1091）—— 产物是槽 0 的材料本身 */
  const MAKE_EQUIP = { 1087: 1, 1089: 1, 1091: 1 };

  let DATA = null;
  let TAGS = null;

  async function load() {
    if (!DATA) DATA = await Elona.Data.table('recipes');
    if (!TAGS) TAGS = await Elona.Data.table('item_tags');
    return DATA;
  }

  /** 物品标签串（var_543） */
  function tagOf(itemId) { return (TAGS && TAGS[String(itemId)]) || ''; }

  /**
   * 279645-279655 的 `blendcheckext`：`var_2119(40+n)` 非 0 时，该槽材料必须是指定
   *   物种的尸体（`var_99(23)` == `var_2119(40+n) \ 10000`，即低 4 位）。
   *   例：220 にぎりプチ → 10003 = プチ(3) 的尸体；223 特製の肉まん → 10251 = トロール(251)。
   */
  function extOk(recipe, slot, item) {
    const ext = (recipe && recipe.ext) || [];
    const v = ext[slot] | 0;
    if (!v) return true;
    if (!item) return false;
    return (item.f[23] | 0) === (v % 10000);
  }

  /** 材料 id → 可读名（用于面板） */
  function matName(matId) {
    if (matId >= 10000) return `类别 ${matId}`;
    if (matId === 9004) return '任意物品';
    if (matId > 9000) {
      const lb = DATA && DATA.labels && DATA.labels[String(matId)];
      return lb ? `任意「${lb}」` : `标签 ${matId}`;
    }
    return Elona.ItemDB ? Elona.ItemDB.name(matId) : String(matId);
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
      if ((it.f[21] | 0) > 0) return false;             // 279612：已被别人占用（owner > 0）
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
        if (matMatches(mid, cand.item) && extOk(recipe, i, cand.item)) { found = cand; break; }
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
   * A28 逐槽选料：返回某材料槽可选的具体物品实例（源码 279880-279960 的逐槽选择窗）。
   *   候选 = 背包 + 4 格内地面里匹配该材料 id 的可用实例（与 pool/matMatches 同源）。
   * @param {object} g
   * @param {object} recipe 配方对象（含 mats 数组）
   * @param {number} slot 材料槽下标（0-based）
   * @param {Set} [exclude] 已被其它槽占用的实例
   * @returns {Array<{item:object,where:string,idx:number}>}
   */
  function candidatesFor(g, recipe, slot, exclude) {
    const mats = (recipe && recipe.mats) || [];
    const mid = mats[slot] | 0;
    if (!mid || mid === UNSAFE_PRODUCT) return [];
    const used = exclude || new Set();
    const out = [];
    for (const cand of pool(g)) {
      if (used.has(cand.item)) continue;
      if (matMatches(mid, cand.item) && extOk(recipe, slot, cand.item)) out.push(cand);
    }
    return out;
  }

  /**
   * A28：把 UI 传来的 {where,idx} 还原为候选对象，并校验仍匹配配方槽位。
   * @returns {{ok:boolean, picks:Array, missing:number[]}}
   */
  function resolvePicks(g, refs) {
    const poolList = pool(g);
    const picks = [];
    const missing = [];
    const used = new Set();
    for (const ref of refs) {
      if (!ref) continue;
      let found = null;
      for (const cand of poolList) {
        if (cand.where !== ref.where || (cand.idx | 0) !== (ref.idx | 0)) continue;
        if (used.has(cand.item)) continue;
        found = cand; break;
      }
      if (found) { used.add(found.item); picks.push(found); }
      else missing.push(0);
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

  /**
   * 280631：只有 `var_500(id) > 0` 的配方才会出现在「どのレシピを使う？」里。
   *   var_500 的初值来自 *label_2644 —— `var_2161` 里登记的配方（recipes.json 的 cat=1，
   *   本版是 200-272 共 73 条）全部置 1；没登记的（cat=0，本版是 1277/1282-1285/1333
   *   这 6 条食谱专属配方）必须读 783 レシピ 才会 +1。
   */
  function isKnown(g, r) {
    if (!r) return false;
    if ((r.cat | 0) > 0) return true;
    const kr = g && g.knownRecipes;
    return !!(kr && (kr[r.id] | 0) > 0);
  }

  /**
   * 配方名 —— rpname（29901-29909）：
   *   var_718 有名字就用它；否则 `id >= 400` 时退回 `var_54(id - 400)`，
   *   也就是**产物物品的名字**（6 条食谱专属配方没有 var_718，wiki 上的名字就是产物名）。
   */
  function recipeName(rid) {
    // DATA 只在 load() 之后才有；读 783 可能发生在第一次开调合窗之前，
    //   这时用 tableSync 同步取一次表（读不到就退回 #id）。
    let tbl = DATA;
    if (!tbl && Elona.Data && Elona.Data.tableSync) {
      try { tbl = Elona.Data.tableSync('recipes'); } catch (e) { tbl = null; }
    }
    const r = tbl && tbl.recipes && tbl.recipes[String(rid)];
    if (!r) return '?????';                       // rpname 的兜底（29903）
    if (r.en || r.jp) return r.en || r.jp;
    const pid = (r.products && (r.products[0] | 0)) || 0;
    return (pid && Elona.ItemDB) ? Elona.ItemDB.name(pid) : String(rid);
  }

  /** 配方列表（含当前可用性），供面板显示 */
  function list(g) {
    if (!DATA) return [];
    const out = [];
    for (const k in DATA.recipes) {
      const r = DATA.recipes[k];
      if (!isKnown(g, r)) continue;                    // 280631
      const pick = pickMaterials(g, r);
      const rate = successRate(g, r, pick.picks);
      // 需求技能是否已习得（未习得时 rpdiff 直接 -125，成功率为 0）
      const skillOk = (r.skills || []).every((pair) => !pair[0] || (g.player.skill(pair[0]) | 0) > 0);
      const lackSkills = (r.skills || []).filter((pair) => pair[0] && (g.player.skill(pair[0]) | 0) <= 0)
        .map((pair) => pair[0]);
      out.push({
        id: r.id, name: recipeName(r.id), jp: r.jp,
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

  // ======================================================================
  // 281087-281745：*label_2658 的产物分支
  // ======================================================================
  /**
   * 非 10000 系列的 33 个专属分支（源码对每个产物 id 各写一段独立的
   * `if ( var_2119(0, var_2120) == id ) { flt ; itemcreate -1, id2, x, y, N }`）。
   *
   *   id       产物物品 id
   *   n        itemcreate 的第 5 参数 = 数量（`var_694 != 0` 时写进 var_99(0)，
   *            见 224871-224872；0/缺省 = 1 个）
   *   bless    写入 `var_99(17)`：0 = 无祝福无诅咒，1 = 祝福
   *   copy20   把槽 0 材料的 f[20]（加值）抄进产物
   *   f25      直接写 f[25]
   *
   * 未列出的产物走通用分支（281714-281719）：1 件、`flt` 的默认强度与品质。
   * 10000-10025 由 core/craftprod.js 的 *label_2660 处理；1087/1089/1091 见 MAKE_EQUIP。
   */
  const PRODUCT_SET = {
    812: [{ id: 812, n: 10, copy20: 1 }],                                  // にぎりめし ×10
    934: [{ id: 934, n: 4, copy20: 1, bless: 1 }],                         // こだわりコーヒー ×4
    1070: [{ id: 1070, n: 2, copy20: 1, bless: 1 },                        // 喫茶：緑茶 ×2
      { id: 1069, n: 2, copy20: 1, bless: 1 }],                            //       紅茶 ×2
    1071: [{ id: 1071, n: 1, copy20: 1 }],                                 // 配合飼料
    208: [{ id: 208 }, { id: 221 }, { id: 46 }, { id: 26 }],               // がらくた錬成 ×4 种
    1074: [{ id: 1074 }, { id: 1073 }, { id: 1072 }],                      // 乳製品 3 种
    1116: [{ id: 1116, n: 5 }],                                            // 撒き餌 ×5
    392: [{ id: 392, n: 8, bless: 1 }],                                    // 硫酸 ×8
    577: [{ id: 577, n: 8, bless: 1 }],                                    // 自家製火炎瓶 ×8
    499: [{ id: 499, n: 6 }, { id: 498, n: 6 }, { id: 497, n: 6 }],        // ジャンクフード ×3 种
    1107: [{ id: 1107 }, { id: 1108 }],                                    // 鏡開き 2 种
    1080: [{ id: 1082, copy20: 1 }, { id: 1080, copy20: 1 },               // 発酵凝固 4 种
      { id: 1081, copy20: 1 }, { id: 1053 }],
    262: [{ id: 262 }, { id: 27 }, { id: 28 }, { id: 29 }, { id: 30 }],    // 有害ポーション 5 种
    260: [{ id: 260, n: 2, copy20: 1 }, { id: 259, n: 2, copy20: 1 },      // 麦加工 5 种
      { id: 253, n: 2, bless: 1 }, { id: 205, n: 2, bless: 1 },
      { id: 1131, n: 2, bless: 1 }],
    31: [{ id: 31, n: 8, bless: 1 }],                                      // 瞬間発酵 ×8
    344: [{ id: 344, bless: 1, f25: 1 }],                                  // ログハウス
    987: [{ id: 987 }], 1008: [{ id: 1008 }],                              // 魔剣転生 / 真・魔剣転生
    988: [{ id: 988 }], 989: [{ id: 989 }],                                // 魔力爆弾 / すごい魔力爆弾
    1133: [{ id: 1133 }], 1312: [{ id: 1312 }],                            // たる爆弾 / ウンチ爆弾
    1044: [{ id: 1044, copy20: 1 }, { id: 1045, copy20: 1 },               // 煙草加工 4 种
      { id: 1046, copy20: 1 }, { id: 1047, copy20: 1 }],
    1136: [{ id: 1136, copy20: 1 }, { id: 601, copy20: 1 }],               // 抗体結晶 + 空瓶
  };

  /** 903（暗之棺）的档次门槛 —— 282037-282062，注意最高档是 7000 而不是 10000 */
  function coffinGrade(v) {
    const x = v | 0;
    if (x > 7000) return 9;
    if (x > 5000) return 8;
    if (x > 3000) return 7;
    if (x > 2000) return 6;
    if (x > 1800) return 5;
    if (x > 1500) return 4;
    if (x > 1000) return 3;
    return 2;
  }

  /** 放进背包（等价 `itemcreate -1` + `item_stack`） */
  function putInInv(g, it) {
    const inv = g.player.inv;
    let slot = -1;
    for (let k = 0; k < inv.length; k++) {
      if (!inv[k] || (inv[k].f[0] | 0) <= 0) { slot = k; break; }
    }
    if (slot >= 0) inv[slot] = it;
    else { inv.push(it); slot = inv.length - 1; }
    if (Elona.ItemDB.stack) Elona.ItemDB.stack(g.player, slot);
    return it;
  }

  /**
   * 生成一件分支表产物 —— `flt`（默认强度/品质）+ `itemcreate`，
   * 随后按分支写 `var_99(17)` / `var_99(20)` / `var_99(25)` 并全鉴定。
   */
  function makeProduct(g, spec, m0) {
    const it = Elona.ItemDB.create(g, { itemId: spec.id, container: 0 });
    if (!it) return null;
    it.f[0] = (spec.n | 0) > 0 ? (spec.n | 0) : 1;
    it.f[17] = spec.bless | 0;
    if (spec.copy20 && m0) it.f[20] = m0.f[20] | 0;
    if (spec.f25 !== undefined) it.f[25] = spec.f25 | 0;
    if (Elona.ItemDB.identify) Elona.ItemDB.identify(it, 3);
    return putInInv(g, it);
  }

  /**
   * 走 *label_2658 的产物分支。
   * @returns {Array<object>} 生成的物品（可能多件，顺序与源码一致）
   */
  function buildBranch(g, pid, picks) {
    const m0 = picks[0] ? picks[0].item : null;
    const m1 = picks[1] ? picks[1].item : null;
    const out = [];
    const add = (spec) => { const it = makeProduct(g, spec, m0); if (it) out.push(it); return it; };

    switch (pid) {
      // 282911-282932：不等価交換 —— 数量 = 5 件材料价值之和（上限 9999）
      case 54: {
        let v = 0;
        for (let i = 0; i < 5; i++) {
          const m = picks[i] && picks[i].item;
          if (m && Elona.ItemDB.calcValue) v += Elona.ItemDB.calcValue(g.player, m, 3, g) | 0;
        }
        if (v > 9999) v = 9999;
        add({ id: 54, n: v > 0 ? v : 1 });
        break;
      }
      // 282670-282684：手作りボール —— 等级 = limit((已攻略最深层+10)*2/3, 1, 200)
      case 685: {
        const lv = limit(idiv(((g.getV65(189) | 0) + 10) * 2, 3), 1, 200);
        const it = add({ id: 685 });
        if (it) { it.f[26] = lv; it.f[1] = 2000 + lv * lv + lv * 1060; }
        break;
      }
      // 282407-282446：ネクロマンシー —— 暗之棺档次取槽 1 材料的价值
      case 903: {
        const gd = coffinGrade(m1 ? (m1.f[1] | 0) : 0);
        const it = add({ id: 903 });
        if (it) {
          it.f[25] = gd;                                   // var_99(25)
          it.f[7] = (it.f[7] | 0) + gd * 1000;             // var_99(7) += 档 × 1000
        }
        if (g.playSnd) g.playSnd(116);                     // 282437：snd 116
        // 282443：额外 600 点炼金术经验
        if (Elona.Stats && Elona.Stats.skillExp) {
          Elona.Stats.skillExp(g.player, 178, g.player.index, 600, 9999, 0, g);
        }
        break;
      }
      // 282477-282486：魔統合 —— 神石档次随陷阱知识(175) 解锁，1275 再随机一次
      case 1194: {
        const s175 = g.player.skill(175) | 0;
        const roll = () => limit(g.rng.rnd(s175 < 20 ? 2 : (s175 < 30 ? 3 : (s175 < 40 ? 4 : 5))), 0, 9);
        add({ id: 1196, f25: roll() });
        add({ id: 1195, f25: roll() });
        add({ id: 1194, f25: roll() });
        add({ id: 1275, f25: g.rng.rnd(6) });
        break;
      }
      // 282669-282684 之外的 992：ピクニックバスケット —— 加值 = 3 + 材料 f[26] 均值
      case 992: {
        let sum = 0;
        for (let i = 0; i < 6; i++) {
          const m = picks[i] && picks[i].item;
          if (m) sum += m.f[26] | 0;
        }
        const bonus = sum !== 0 ? (idiv(sum, 6) + 3) : 0;
        add({ id: 992 });
        if (out[0]) out[0].f[20] = bonus;                // var_99(20, var_579) = var_2165
        break;
      }
      // 282590-282600：ハンバーガー —— 每做 6 个额外掉出一只愤怒汉堡
      case 1109: {
        const cnt = (g.getV65(250 + 368) | 0) + 1;
        g.setV65(250 + 368, cnt);
        if (cnt % 6 === 0 && Elona.CharaFactory && Elona.CharaFactory.create) {
          try {
            const c = Elona.CharaFactory.create(g, 937, 1, g.player.x, g.player.y);
            if (c) c.set(79, 18 + 100 * 2);
          } catch (e) { /* 单只生成失败不阻断 */ }
          for (let k = 0; k < 4; k++) if (g.playSnd) g.playSnd(161);
        }
        add({ id: 1109 });
        break;
      }
      default: {
        const set = PRODUCT_SET[pid];
        if (!set) return out;
        for (const spec of set) add(spec);
        break;
      }
    }
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

    // A28：优先使用 UI 逐槽选定的实例（payload.picks，元素为 {where,idx}），
    //   没有则退回自动挑料（原「自动选料」路径仍兼容）。
    // A30：批量制作时 begin() 已经把实例解析好放进 payload.items，直接沿用，
    //   这样第 2 件以后不会因为「上一件把材料用完、pool() 已过滤掉」而重新挑料。
    let pick;
    if (Array.isArray(o.items) && o.items.length) {
      const list = o.items.filter((x) => x && x.item && (x.item.f[0] | 0) > 0);
      if (list.length < o.items.length) {
        return { ok: false, message: '材料不足：调合需要的材料已经用完。' };
      }
      pick = { ok: true, picks: list, missing: [] };
    } else if (Array.isArray(o.picks)) {
      const named = resolvePicks(g, o.picks);
      pick = named.ok ? named : pickMaterials(g, r);
    } else {
      pick = pickMaterials(g, r);
    }
    if (!pick.ok) {
      const names = pick.missing.map(matName).join('、');
      return { ok: false, message: `材料不足：还需要 ${names}。` };
    }
    // 面板显示的成功率带素材祝福（window_recipe2 的 rpdiff(var_2120, var_2141, -1)），
    // 但真正的判定是 281089 的 `rpdiff(var_2120, -1, -1)` —— 材料数传 -1，
    // 于是祝福/诅咒只改变界面显示，不参与实际掷骰。这里按源码分开算。
    const rate = successRate(g, r, pick.picks);
    const rollRate = SETTLE_IGNORES_MATERIALS ? successRate(g, r, []) : rate;
    // 281089：rpdiff(...) < rnd(100) → 失败
    const success = rollRate >= g.rng.rnd(100);
    let product = null;
    let products = [];     // A30：*label_2658 的产物分支可能一次生成多件
    let productPid = 0;    // 0-DX：走 *label_2660 时记下配方产物号（10000-10025）
    const tm = timeOf(r);

    if (success) {
      const pid = r.products[0] | 0;
      const CP = Elona.CraftProduct;
      // 281096-281099：木の加工 / 石の加工 / 焼き物 的工具不会被消耗 ——
      //   源码先把槽 0 的计数 +1，label_2657 再 -1，净变化 0。
      if (pid === 10011 || pid === 10012 || pid === 10022) {
        const tool = pick.picks[0] && pick.picks[0].item;
        if (tool) tool.f[0] = (tool.f[0] | 0) + 1;
      }
      // 281837-281852：*label_2660 开头先把产物对象从堆里拆出来（item_separate）。
      //   10000 系列大多以「槽 0 材料本身」为产物，堆叠 > 1 时若不拆，
      //   改的就是整堆（例如往 5 个面包里揉香草，5 个都会变成加料面包）。
      if (pid >= 10000 && pid !== 10011 && pid !== 10012 && pid !== 10022) {
        const m0 = pick.picks[0] && pick.picks[0].item;
        if (m0 && (m0.f[0] | 0) > 1 && Array.isArray(g.player.inv)) {
          const k = g.player.inv.indexOf(m0);
          if (k >= 0 && Elona.ItemDB.separate) Elona.ItemDB.separate(g.player, k);
        }
      }
      // 281213-281240：武具制作（柔/剛/鋭 三种配方，产物号 1087/1089/1091）。
      //   产物不是 1087 号物品，而是**槽 0 的材料本身**按 `flt , 4` 重掷：
      //   强度 = calcobjlv(当前深度)（有浮动）、品质固定 4（无品质浮动，
      //   但 itemcreate 内部 224288-224301 的幸运判定仍可 +1）。
      if (MAKE_EQUIP[pid]) {
        const m0 = pick.picks[0] && pick.picks[0].item;
        const tid = m0 ? (m0.id | 0) : 0;
        if (tid) {
          if (g.playSnd) g.playSnd(58);                  // 281214：snd 58
          const mkOne = () => {
            const it = Elona.ItemDB.create(g, { itemId: tid, fix: 4, container: -1 });
            if (!it) return null;
            it.f[0] = 1;
            it.f[17] = 0;                                // 281217：var_99(17) = 0
            if (Elona.ItemDB.identify) Elona.ItemDB.identify(it, 3);
            return putInInv(g, it);
          };
          product = mkOne();
          if (product) products.push(product);
          if (tid !== 955) {                             // 281228：非 955 时再做一件
            const extra = mkOne();
            if (extra) products.push(extra);
          }
          productPid = pid;
        }
      } else if (CP && CP.isSpecial(pid)) {
        if (CP.load) { try { await CP.load(); } catch (e) { /* 表缺失时按空表 */ } }
        const built = CP.build(g, { pid, picks: pick.picks, recipe: r });
        product = built.item || null;
        if (product) products.push(product);
        productPid = pid;
      } else {
        // 281087-281745：*label_2658 的 33 个专属分支 + 通用分支。
        //   products[1] 是必要时间而非数量；每件产物各自 `flt` 取强度/品质。
        const built = buildBranch(g, pid, pick.picks);
        if (built.length) {
          products = built;
          product = built[0];
        } else if (pid > 0 && Elona.ItemDB) {
          // 通用分支：1 件，强度 calcobjlv(深度)、品质 calcfixlv(2)，无祝福
          const it = Elona.ItemDB.create(g, { itemId: pid, container: 0 });
          if (it) {
            it.f[0] = 1;
            it.f[17] = 0;                                // 281718：var_99(17) = 0
            if (Elona.ItemDB.identify) Elona.ItemDB.identify(it, 3);
            product = putInInv(g, it);
            products = [product];
          }
        }
      }
    }
    // ---- 必要时间（0-CM：279822-279834 + 281758-281775）----
    if (tm.hours > 0) {
      // >=10000：每个产物推进高位小时（var_65(13)++ ; gosub *label_4352）
      if (g.advanceHours) g.advanceHours(tm.hours);
    }
    // ---- 消耗（label_2657）----
    //   `var_2119(2, id)`（催化剂标记）在源码里是 `var_2119(0, id) = 产物, 时间, 标记`
    //   这一行的第 3 个值，recipes.json 落在 products[2]；字段 `flag2` 是另一处显式赋值，
    //   本版源码里没有任何配方用到它。
    const cat = (((r.products && (r.products[2] | 0)) || (r.flag2 | 0)) > 0);
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

    // ---- 技能经验（281732-281735）：50 + 需求等级 + 消耗小时数 × 25 ----
    //   源码 `skillexp skill, 0, 50 + var_2119(11+2n) + var_2127(2)/10000*25, 2, 50`
    //   —— 之前漏掉了 `必要时间/10000*25`（即小时数 × 25）。
    if (Elona.Stats && Elona.Stats.skillExp && g.player.get(0) === 1) {
      const exp = 50 + tm.hours * 25;
      for (const pair of (r.skills || [])) {
        const sid = pair[0] | 0;
        if (!sid) break;
        Elona.Stats.skillExp(g.player, sid, g.player.index, exp + (pair[1] | 0), 9999, 0, g);
      }
    }

    const name = recipeName(r.id);
    if (success) {
      if (productPid === 10023) {
        g.log(`调合成功：${name} → 生体复原完成。`);   // 产物是怪物本体
      } else {
        const pname = product && Elona.ItemDB ? Elona.ItemDB.name(product.id) : '';
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
      ok: true, success, rate, rollRate, product, products, productPid,
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
   * 280585-280596：连续制作数量 `var_428` 的上限 ——
   *   取「所有材料槽里堆叠数的最小值」，最多 10；催化剂配方（var_2119(2)==2）跳过第 0 槽。
   * 源码 280578 起 `var_400 = 10`，再逐槽 `if (var_99(0, m) < var_400) var_400 = var_99(0, m)`。
   */
  function maxCount(g, recipe, picks) {
    let lim = 10;
    const list = picks || [];
    for (let i = 0; i < list.length; i++) {
      if ((((recipe.products && (recipe.products[2] | 0)) || (recipe.flag2 | 0)) === 2) && i === 0) continue;  // 280591
      const n = list[i].item ? (list[i].item.f[0] | 0) : 0;
      if (n < lim) lim = n;
    }
    return Math.max(1, Math.min(10, lim));
  }

  /**
   * 0-FY：调合改为持续行动 —— *label_2659（281742-281775）。
   *   源码 `var_58(140)=12 ; var_58(141) = 必要時間 \ 10000`，
   *   回合里每 1/30 概率显示「*こねこね*」，141 归零才 gosub *label_2658 结算。
   *   高位（必要时间 / 10000，即小时）在结束时由 advanceHours 补上。
   * A30：加入「幾つ作る？」（280571-280596）的连续制作数 —— 每做完一件重新走一遍
   *   label_2658（每件各掷一次成功率、各消耗一次材料），回合与小时按件累加。
   */
  async function begin(g, recipeId, opts) {
    await load();
    const o = opts || {};
    const r = DATA.recipes[String(recipeId)];
    if (!r) return { ok: false, message: '没有这个配方。' };
    if (!isKnown(g, r)) return { ok: false, message: `你还没有学会「${recipeName(r.id)}」的配方。` };
    if ((g.player.get(140) | 0) !== 0) return { ok: false, message: '你正忙着别的事情。' };
    // A28：逐槽选料结果（{where,idx}[]）；未传则沿用自动挑料校验
    let pick;
    if (Array.isArray(o.picks)) {
      const named = resolvePicks(g, o.picks);
      pick = named.ok ? named : { ok: false, missing: (r.mats || []).slice(0, named.picks.length) };
    } else {
      pick = pickMaterials(g, r);
    }
    if (!pick.ok) {
      return { ok: false, message: `材料不足：还需要 ${pick.missing.map(matName).join('、')}。` };
    }
    const tm = timeOf(r);
    // 280585-280596：数量上限 = 材料最小堆叠（≤10），用户请求值再钳一次
    const maxN = maxCount(g, r, pick.picks);
    let count = o.count === undefined ? 1 : (o.count | 0);
    if (!(count > 0)) count = 1;
    if (count > maxN) count = maxN;
    const turns = Math.max(1, tm.turns | 0) * count;
    const A = Elona.Actions;
    // 没有动作层时即时结算，同样要把 picks 与件数传下去
    if (!A) {
      let res = null;
      for (let i = 0; i < count; i++) {
        res = await settle(g, recipeId, { picks: o.picks });
        if (!res || !res.ok) break;
      }
      return res || { ok: false, message: '无法调合。' };
    }
    const items = pick.picks.map((c) => ({ item: c.item, where: c.where }));
    const st = A.begin(g, 12, turns, {
      recipeId, hours: tm.hours, turns: tm.turns, picks: o.picks, items, count,
    });
    if (!st.ok) return { ok: false, message: st.message || '现在不能调合。' };
    g.log(count > 1
      ? `你开始调合 ${recipeName(r.id)} ×${count}。（每件 ${tm.text}）`
      : `你开始调合 ${recipeName(r.id)}。（${tm.text}）`);
    g.endTurn();
    return { ok: true, started: true, turns, hours: tm.hours, count, maxCount: maxN, recipeId };
  }

  /**
   * 由 Game.completeRowAct(12) 调用；此时数据已在 begin() 时载入。
   * A30：连续制作 —— 逐件结算（281790-281800：每件结束后 `if (var_2127(1) > 0)` 再走一遍）。
   *   材料中途用完就停下（源码 label_2656 的 stat==0 分支）。
   */
  async function finish(g, payload) {
    const pl = payload || {};
    if (!DATA) return { ok: false, message: '配方表尚未载入。' };
    const n = Math.max(1, pl.count | 0);
    const made = [];
    let last = null;
    for (let i = 0; i < n; i++) {
      const res = await settle(g, pl.recipeId | 0, {
        rowact: true, items: pl.items, picks: pl.picks,
      });
      if (!res || !res.ok) { last = res; break; }
      if (res.products) made.push.apply(made, res.products);
      last = res;
    }
    if (!last) return { ok: false, message: '没有结算。' };
    return Object.assign({}, last, { made, count: n });
  }

  Elona.Craft = {
    load, list, craft, begin, finish, successRate, rateText, timeOf, matMatches, matName, countMat,
    pickMaterials, candidatesFor, resolvePicks, tagOf, maxCount, isKnown, recipeName,
    get data() { return DATA; },
    get tags() { return TAGS; },
    /** 已实现的产物分支 id（*label_2658 的 33 项 + 10000 系列见 craftprod） */
    get branchIds() {
      const s = new Set(Object.keys(PRODUCT_SET).map(Number));
      for (const k of [54, 685, 903, 992, 1109, 1194]) s.add(k);
      for (const k of Object.keys(MAKE_EQUIP)) s.add(Number(k));
      return Array.from(s).sort((a, b) => a - b);
    },
    MAX_MATS, MATERIAL_RANGE,
  };
})(window);
