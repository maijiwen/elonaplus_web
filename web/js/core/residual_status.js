'use strict';
/**
 * D 组：状态 / 物品工具 / 小工具函数收口（core/residual_status.js）
 * 数据规则表 web/data/tables/residual_status.json，由 tools/extract_residual_status.py 逐行校验。
 *
 * 【源码区间逐条登记（hsp/start.hsp，cp932 解码）】
 *   224184-224244：label_2295 自伤状态自检 254/251/252/263 + 背包鉴定链 → selfHarmCheck()/appraise()
 *   201589-201614：modheight 身高槽 19 公式与长高/变矮播报 → modHeight()
 *   201615-201628：cure_anorexia 厌食治疗 cbit 986 / snd 65 → anorexia()/cureAnorexia()
 *   201928-201933：chara_anorexia 厌食发作 chara_vomit → charaAnorexia()
 *   201870-201898：eatstatus 进食心情状态效果 → eatStatus()
 *   201899-201927：eatstatusfood 食物品质效果 → eatStatusFood()
 *   196631-196651：spillblood 血迹 mef 字段 7 → bloodStain()/spillBlood()
 *   196652-196672：spillfrag 碎片 mef 字段 7 → bloodStain()/spillFrag()
 *   29604-29610：itemturn 全局计数器 826 与物品槽 30 → itemRot()
 *   31286-31309：remain_make 尸体分支 204/1214 与价值公式 → remainMake()
 *   201526-201541：advfavoriteskill 技能 100..399 取 2 项 → advFavoriteSkill()
 *   201542-201546：advfavoritestat 属性 10..17 → advFavoriteStat()
 *   192908-192919：relationbetween 关系槽 9 条件链 → relationBetween()
 *   192920-192930：calcage 年龄换算 / 不明 / cbit 1026 → calcAge()
 *   194563-194573：wake_up 白天 7..22 时唤醒 57..244 号 → wakeUp()
 *   201361-201388：label_2045 濒死播报 6 条台词 → label2045()
 *   211959-212087：label_2146..2158 技能成长衰减链 → growthChain()
 *   212172-212185：label_2166..2168 的 skillexp 174/185/165 → growthChain()
 *   226858-227252：label_2305..2335 synccheck 播报族 30 条 → pronounSynccheck()
 *   202819-202947：label_2089..2098 comevdisp 变量族 → comevdisp()/browserSaveHours()
 *   210969-211000：label_2115/2116 变量赋值与八邻域位掩码 → variableAssign()/neighborBitmask()
 *   26065-26090：getinheritance 基因继承 → getInheritance()
 *   26150-26193：flt / fltn / discsetmc / fltsetdungeon → fltFamily()/fltn()/discsetmc()
 *   29294-29312：fix_find 物品 555 的 f21==3 重置与 snd 90 → fixFind()
 *   31523-31535：csvstr2 逗号分隔 44 最多 40 段 → csvstr2()
 *   32260-32261：calcshopreform var_126(18)*100+1000 → calcShopReform()
 *   29901-29909：rpname 自定义名 / 400 门槛 / ????? → rpname()
 *   201512-201523：actionsp 槽 52 与 rnd(75) → actionsp()
 *   26029-26064：label_0319 伙伴应援台词 11 条 → cheerLine()
 *   229175-229203：label_2384 rnd(100) 判定与背包计数公式 → rnd100Gate()/inventoryCount()
 *   291069-291096：label_2750 命名确认播报与 cbit 977 → nameConfirm()
 *   602270-602302：label_4347 日期时间初始化 517,10,12,16,10 → dateInit()
 *   19670-19709：label_0260..0263 strmid/instr 子串与 %END → misc.talkBlock
 *   25829-25855：label_0310 sdim 与 ndata.csv/name.csv 装载 → misc.nameTable
 *   26008-26027：label_0317 团体名后缀词表 → misc.guildSuffix
 *   28874-28888：label_0356 附魔 8 组与位标志 10 组 → misc.applyMat
 *   31411-31435：label_0413 物品堆叠合并与汇总播报 → misc.itemStack
 *   37387-37413：label_0539 getstr 分段拼接 → misc.crlfJoin
 *   000303-000308：refclass 职业引用 var_59=16（源码 303-308）→ misc.refclass
 *   000364-000375：guildname 公会名 263/264/265（源码 364-375）→ guildName()
 *   5024-5027：randskill 150..190 / randattb 10..17 → randSkill()/randAttb()
 *   8653-8661：stxt 播报 var_58(253,0)==0 门控 → misc.stxt
 *   8710-8725：at 回合延时与重绘标志 → misc.at
 *   11950-11957：label_0218 前缀词表 2 组 5 档 → prefixWord()
 *   194576-194612：incognitobegin 变装开始跳过链与 79=221 → incognitoBegin()
 *   235635-235656：label_2447 var_126(10) 公式 → cellRefreshLevel()
 *   235860-235889：label_2451 食物 60000 与价值除数 → foodValue()
 *   279451-279464：blendcheckext 调合扩展检查 10000/1499 → blendCheckExt()
 *   280034-280041：label_2644 var_500 位登记 → misc.bitScan
 *   304316-304331：label_2876 环形缓冲 (v+1) mod 4 → ringIndex()
 *   344646-344650：label_2994 var_2535 上限 2000 → clamp2000()
 *   603945-603955：label_4353 var_124>=245 与 var_58(10) 回绕 → misc.turnReset
 *   220619-220624：label_2251 四个 rnd(45)+1 → rand45()
 *   220812-220822：label_2256 分页 (var_701-1)/var_893 → pageClamp()
 *   340772-340794：label_2974 状态字段清零表 → clearStatusFields()
 *   211370-211440：label_2127 目标格差 >1 拒绝 → moveCheck()
 *   235890-235944：label_2452 var_65(22)!=1 返回 → depthGate()
 *   425317-425379：label_3067 由 core/residual_map.js 的 eventZoneInit() 覆盖
 *   31537-31547：cargocheck 由 core/residual_map.js 的 cargoCheck() 覆盖
 *   28874-28888：附魔位标志回填由 core/residual_tables.js 的 materialEnchants/materialBits 覆盖
 *   37329-37386：conv_crlf 由 core/residual_tables.js 的 convCrlf 覆盖
 *   37414-37431：rm_crlf 由 core/residual_tables.js 的 rmCrlf 覆盖
 *   26150-26168：flt 主体由 core/residual_tables.js 的 fltLevels 覆盖
 *   212088-212171：label_2159..2165 由 core/turncycle.js 的 GROWTH 表覆盖
 *
 * 【数据加载】测试环境注入 Elona.ResidualStatusData；浏览器环境走
 *   Elona.Data.tableSync('residual_status')。参考 core/residual_tables.js 的 ready()/table() 模式。
 * 【HSP 语义】/ 为整数除法（向零截断）；\ 为取模。status.js 与 cnvdate 同源口径。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let cached = null;
  function table() {
    if (!cached) {
      cached = (Elona.ResidualStatusData && Elona.ResidualStatusData.ranges)
        ? Elona.ResidualStatusData : null;
      if (!cached && Elona.Data && Elona.Data.tableSync) {
        try { cached = Elona.Data.tableSync('residual_status'); } catch (e) { cached = null; }
      }
    }
    return cached;
  }
  function ready(data) { cached = (data && data.ranges) ? data : null; return this; }
  function RULE(name) { const D = table(); return (D && D.rules) ? (D.rules[name] || {}) : {}; }
  function TOP(name) { const D = table(); return D ? (D[name] || []) : []; }

  // ---------------------------------------------------------------- 基础工具
  function idiv(a, b) { return b === 0 ? 0 : Math.trunc(a / b); }
  function imod(a, b) { return b === 0 ? 0 : a - idiv(a, b) * b; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function L(x) { return x === 'jp' ? 'jp' : 'en'; }
  function fill(tpl, dict) {
    return String(tpl == null ? '' : tpl).replace(/\{([A-Za-z0-9_]+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(dict, k) ? String(dict[k]) : m;
    });
  }
  function seededRng(seed) {
    let s = (seed | 0) || 1;
    return function (n) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return n > 0 ? (s >>> 0) % n : 0; };
  }
  function rndOf(rng, seed) {
    if (rng && typeof rng.rnd === 'function') return function (n) { return rng.rnd(n) | 0; };
    if (typeof rng === 'function') return function (n) { return rng(n) | 0; };
    return seededRng(seed);
  }
  function val(x) { return x | 0; }
  function words(ctx) {
    const self = (ctx.ch === undefined ? 0 : val(ctx.ch)) === 0;
    return {
      name: ctx.name || '',
      _s: self ? '' : 's',
      your: self ? 'your ' : "'s ",
      he: self ? 'you' : 'he',
      is: self ? 'are' : 'is',
      have: self ? 'have' : 'has',
      him: self ? 'you' : 'him',
      var_1134: ctx.var1134 || '',
      newName: ctx.newName || '',
    };
  }

  // ================================================================ 224184-224244：自伤自检与鉴定
  /** 224184-224244：254/251/252/263 任一非 0 则 label_2295 直接 return */
  function selfHarmCheck(state) {
    const R = RULE('selfHarmCheck');
    const get = typeof state === 'function' ? state : function (i) { return (state && state[i]) || 0; };
    const ids = (R.fields || []).slice();
    const hit = ids.filter(function (i) { return val(get(i)) !== 0; });
    return { blocked: hit.length > 0, hit: hit, fields: ids, chara: R.chara, src: R.src };
  }
  /** 224184-224244：var_400 = v82(13,0)+v82(162,0)*5, 1500+v99(29,item)*5 */
  function appraiseRoll(skill13, skill162, f29) {
    const R = RULE('appraise'); const K = R.roll || {};
    return [val(skill13) + val(skill162) * (K.skillMul || 5),
            (K.secondBase || 1500) + val(f29) * (K.secondMul || 5)];
  }
  /** 224184-224244：a > rnd(b*5) 命中鉴定；a > rnd(b) 命中品质感觉 */
  function appraiseHit(a, b, roll, qualityOnly) {
    const R = RULE('appraise'); const m = qualityOnly ? 1 : ((R.roll && R.roll.rareMul) || 5);
    const range = val(b) * m;
    return { range: range, hit: val(a) > val(roll), src: R.src };
  }
  /** 224184-224244：鉴定链规则（技能 162 / 经验 50 / 阈值 50000 / 三条文案） */
  function appraise() { return RULE('appraise'); }

  // ================================================================ 201589-201614：modheight
  /** 201589-201614：h = h*(100+pct)/100 + (pct>0) - (pct<0)，下限 1；物品 1114 阻断 */
  function modHeight(height, pct, opts) {
    const R = RULE('modHeight'); opts = opts || {};
    if (opts.hasItem1114) return { changed: false, height: val(height), blockItem: R.blockItem, text: null, src: R.src };
    const p = val(pct);
    let h = idiv(val(height) * (100 + p), 100) + (p > 0 ? 1 : 0) - (p < 0 ? 1 : 0);
    h = Math.max(h, R.minHeight || 1);
    let text = null;
    if (opts.syncOk) {
      const w = words(opts);
      if (p > 0) text = { jp: fill(R.texts.tallerJp, w), en: fill(R.texts.tallerEn, w) };
      else if (p < 0) text = { jp: fill(R.texts.smallerJp, w), en: fill(R.texts.smallerEn, w) };
    }
    return { changed: true, height: h, minHeight: R.minHeight, text: text, src: R.src };
  }

  // ================================================================ 201615-201628 / 201928-201933：厌食症
  /** 201615-201628 / 201928-201933：cbit 986 厌食症的发作与治疗 */
  function anorexia(ctx) {
    const R = RULE('anorexia'); ctx = ctx || {};
    const has = !!ctx.bit986;
    const attack = { vomit: has && R.attack.vomit, result: has ? R.attack.result : R.attack.emptyResult };
    let cure = null;
    if (ctx.cure && has) {
      const w = words(ctx);
      cure = {
        cleared: true,
        broadcast: !!(ctx.syncOk || val(ctx.cc) < R.ccBound),
        text: { jp: fill(R.cureText.jp, w), en: fill(R.cureText.en, w) },
        snd: R.snd,
      };
    }
    return { bit: R.bit, attack: attack, cure: cure, src: R.src, attackSrc: R.attackSrc };
  }
  function cureAnorexia(ctx) { return anorexia(Object.assign({}, ctx, { cure: true })); }
  /** 201928-201933：cbit 986 为 0 返回 0，否则 chara_vomit 返回 1 */
  function charaAnorexia(ctx) { return anorexia(Object.assign({}, ctx, { cure: false })).attack; }

  // ================================================================ 201870-201927：进食状态
  function eatImpl(v, ctx, isFood) {
    const R = RULE('eatStatus'); ctx = ctx || {};
    const B = isFood ? R.buff.food : R.buff.status;
    const RND = rndOf(ctx.rng, 0);
    const out = {
      alive: ctx.alive === undefined ? true : !!ctx.alive,
      hungerDelta: 0, text: null, buff: null, healsan: 0, vomit: false,
      src: isFood ? R.foodSrc : R.src,
    };
    if (!out.alive) return out;
    const w = words(ctx);
    if (val(v) <= R.badAt) {
      out.hungerDelta = -R.hungerDelta;
      out.text = { jp: fill(R.badText.jp, w), en: fill(R.badText.en, w) };
      out.vomit = !!R.vomit;
    }
    if (val(v) >= R.goodAt) {
      out.text = { jp: fill(R.goodText.jp, w), en: fill(R.goodText.en, w) };
      if (RND(R.buff.chance) === 0)
        out.buff = { id: R.buff.id, power: B.power, duration: B.base + RND(B.rndRange) };
      out.healsan = isFood ? R.healsan.food : R.healsan.status;
    }
    return out;
  }
  /** 201870-201898：eatstatus 心情 <= -1 减饱食 1500 并呕吐；>= 1 加 buff 19/100 与 healsan 2 */
  function eatStatus(mood, ctx) { return eatImpl(mood, ctx, false); }
  /** 201899-201927：eatstatusfood 加 buff 19/200、时长 700+rnd(300) 与 healsan 3 */
  function eatStatusFood(quality, ctx) { return eatImpl(quality, ctx, true); }

  // ================================================================ 196631-196672：血迹与碎片
  /** 196631-196672：mef 字段 7 个位存血迹(<5)、十位存碎片(<4)，中心格先行 */
  function bloodStain(kind, ctx) {
    const R = RULE('bloodStain'); ctx = ctx || {};
    const frag = kind === 'frag' || kind === 'spillfrag';
    const n = val(ctx.n) + 1;
    const RND = rndOf(ctx.rng, 0);
    const w = val(ctx.w), h = val(ctx.h);
    const mef = ctx.mef || function () { return 0; };
    const setMef = ctx.setMef || function () {};
    const blocked = ctx.blocked || function () { return false; };
    const updates = [];
    for (let c = 0; c < n; c++) {
      let x, y;
      if (c === 0) { x = val(ctx.x); y = val(ctx.y); }
      else { x = val(ctx.x) + RND(2) - RND(2); y = val(ctx.y) + RND(2) - RND(2); }
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (blocked(x, y)) continue;
      const v = val(mef(x, y));
      let nv = v;
      if (frag) {
        if (idiv(v, 10) < R.frag.cap) { nv = imod(v, 10) + (idiv(v, 10) + 1) * 10; setMef(x, y, nv); updates.push([x, y, nv]); }
      } else {
        if (imod(v, 10) < R.blood.cap) { nv = v + 1; setMef(x, y, nv); updates.push([x, y, nv]); }
      }
    }
    return { kind: frag ? 'frag' : 'blood', updates: updates, caps: { blood: R.blood.cap, frag: R.frag.cap }, src: R.src };
  }
  /** 196631-196651：spillblood 血迹 mef */
  function spillBlood(ctx) { return bloodStain('blood', ctx); }
  /** 196652-196672：spillfrag 碎片 mef */
  function spillFrag(ctx) { return bloodStain('frag', ctx); }

  // ================================================================ 29604-29610：itemturn
  /** 29604-29610：全局计数器 var_65(826) 归零下限 0 后自增，写入物品槽 30 */
  function itemRot(counter, items, index) {
    const R = RULE('itemRot');
    let c = val(counter);
    if (c < R.resetBelow) c = R.resetBelow;
    c++;
    if (items && index !== undefined && items[index]) items[index][R.itemField] = c;
    return { counter: c, field: R.itemField, value: c, src: R.src };
  }

  // ================================================================ 31286-31309：remain_make
  /** 31286-31309：按物品 id 204 / 1214 / 其它三档生成尸体字段 23/22/7/1 */
  function remainMake(ctx) {
    const R = RULE('remainMake'); ctx = ctx || {};
    const v58 = ctx.v58 || function () { return 0; };
    const f = {
      23: val(v58(27, val(ctx.cc))),
      22: idiv(val(v58(7, val(ctx.cc))) - val(v58(435, val(ctx.cc))) * 1000, 1000),
      7: val(v58(20, val(ctx.cc))) + 1,
      1: 0,
    };
    const id = val(ctx.itemId);
    let branch = null;
    for (let i = 0; i < R.branches.length; i++) if (R.branches[i].id === id) { branch = R.branches[i]; break; }
    if (!branch) branch = R.branches[R.branches.length - 1];
    const mul = (id === 204 || id === 1214) ? 500 : 50;
    f[7] = clamp(idiv(f[7], 10) * mul, branch.lo, branch.hi);
    if (id === 204) f[1] = clamp(idiv(f[7] + 20000, 7), branch.priceLo, branch.priceHi);
    else if (id === 1214) f[1] = clamp((val(v58(38, val(ctx.cc))) + 30) * 300, branch.priceLo, branch.priceHi);
    else {
      f[1] = clamp(val(v58(38, val(ctx.cc))) * 40 + 600, branch.priceLo, branch.priceHi);
      const race = ctx.refchara ? val(ctx.refchara(val(v58(27, val(ctx.cc))), branch.raceRef)) : 99;
      if (race < branch.raceThreshold && val(v58(branch.corpseField, val(ctx.cc))) < branch.corpseThreshold)
        f[1] *= clamp(4 - idiv(race, 5), 1, 5);
    }
    return { fields: f, branch: branch.id, src: R.src };
  }

  // ================================================================ 201526-201546：冒险者擅长
  /** 201526-201541：randomize(seed) 后抽 rnd(300)+100，取 2 个 var_83(0,id)!=0 的技能 */
  function advFavoriteSkill(seed, rng, isValid) {
    const R = RULE('advFavorite').skill;
    const RND = rndOf(rng, seed);
    const ids = []; let guard = 0;
    while (ids.length < R.count && guard++ < 400) {
      const id = RND(R.rndN) + R.lo;
      if (isValid && !isValid(id)) continue;
      ids.push(id);
    }
    return { seed: val(seed), ids: ids, count: ids.length, lo: R.lo, hi: R.hi, src: '201526-201541' };
  }
  /** 201542-201546：rnd(8)+10 的擅长属性 */
  function advFavoriteStat(seed, rng) {
    const R = RULE('advFavorite').stat;
    const id = rndOf(rng, seed)(R.rndN) + R.lo;
    return { seed: val(seed), id: id, lo: R.lo, hi: R.hi, src: '201542-201546' };
  }

  // ================================================================ 192908-192930：关系 / 年龄
  /** 192908-192919：按源码嵌套条件链求值，关系槽 9 的 -2/-3 阈值 */
  function relationBetween(v9) {
    const R = RULE('relationBetween'); const v = val(v9);
    if (v >= R.thresholds[0]) { if (v <= R.thresholds[1]) return { value: -3, src: R.src }; }
    else { if (v >= R.thresholds[0]) return { value: -3, src: R.src }; }
    return { value: R.result, src: R.src };
  }
  /** 192920-192930：年龄 = 当前年 - 出生年；年份倒挂/种族 207 返回「不明」；cbit 1026 返回出生年 */
  function calcAge(ctx) {
    const R = RULE('calcAge'); ctx = ctx || {};
    const lang = L(ctx.lang), year = val(ctx.year), birth = val(ctx.birth);
    if (year - birth < 0) return { age: R.unknownText[lang], unknown: true, src: R.src };
    if (val(ctx.race) === R.raceUnknown) return { age: R.unknownText[lang], unknown: true, src: R.src };
    if (ctx.ageless) return { age: birth, unknown: false, src: R.src };
    return { age: year - birth, unknown: false, src: R.src };
  }

  // ================================================================ 194563-194573：wake_up
  /** 194563-194573：7..22 时扫描 57..244 号，睡眠 251>0 且 rnd(10)!=0 则清零 */
  function wakeUp(ctx) {
    const R = RULE('wakeUp'); ctx = ctx || {};
    const hour = val(ctx.hour);
    const active = hour >= R.hours[0] && hour <= R.hours[1];
    const get = ctx.get || function () { return 0; };
    const set = ctx.set || function () {};
    const RND = rndOf(ctx.rng, 0);
    const cleared = [];
    if (active) for (let c = R.range[0]; c < R.range[1]; c++)
      if (val(get(R.statusField, c)) > 0 && RND(R.rnd) !== 0) { set(R.statusField, c, 0); cleared.push(c); }
    return { active: active, hours: R.hours.slice(), range: R.range.slice(), statusField: R.statusField, cleared: cleared, src: R.src };
  }

  // ================================================================ 201361-201388：label_2045
  /** 201361-201388：cbit 985 濒死播报，rnd(20)==0 时从 6 条台词里选，末尾复位 809/1132 */
  function label2045(ctx) {
    const R = RULE('label2045'); ctx = ctx || {};
    const out = { bit: R.bit, prefix: null, lines: (R.lines || []).slice(), chance: R.rnd, reset: R.reset, src: R.src };
    const skip = R.skipSources.indexOf(val(ctx.source)) >= 0;
    if (ctx.bit985 && val(ctx.phase) === R.phaseValue && !skip && ctx.syncOk)
      out.prefix = fill(R.prefix[L(ctx.lang)], words(ctx));
    return out;
  }

  // ================================================================ 211959-212185：技能成长链
  function growthExp(label, ctx) {
    const g = TOP('growth').find(function (x) { return x.label === label; });
    if (!g || !g.calls || !g.calls[0]) return null;
    const e = g.calls[0].exp;
    if (typeof e !== 'string') return e;
    const v58 = ctx.v58 || function () { return 0; };
    const v65 = ctx.v65 || function () { return 0; };
    const v82 = ctx.v82 || function () { return 0; };
    const v83 = ctx.v83 || function () { return 0; };
    switch (label) {
      case 2154: return clamp(idiv(val(ctx.var1362), clamp(val(v82(156, val(ctx.cc))), 1, 100) + 10), 10, 300);
      case 2156: return val(v65(22)) * 2 + 20;
      case 2157: return (val(v83(2, val(ctx.var1362))) + 10) * 2 * (1 + (ctx.var1363 | 0));
      case 2158: return clamp(idiv(Math.abs(val(v58(55, val(ctx.cc)))) * 400, val(v58(56, val(ctx.cc))) + 1), 1, 400);
      case 2168: return 30 + val(v83(4, val(ctx.var396)));
      default: return e;
    }
  }
  /** 211959-212087 / 212172-212185：按 label 返回衰减规则或 skillexp 指令；212088-212171 由 turncycle.js 承接 */
  function growthChain(label, ctx) {
    ctx = ctx || {}; const id = val(label);
    for (let i = 0; i < TOP('growth').length; i++) {
      const g = TOP('growth')[i];
      if (g.label !== id) continue;
      const out = { label: id, src: g.src, kind: g.kind };
      if (g.kind === 'decay' || g.kind === 'clamp') { out.ranges = g.ranges; out.rules = g.rules; }
      if (g.kind === 'formula') {
        const Lv = clamp(val(ctx.v58 ? ctx.v58(38, val(ctx.cc)) : 0), 1, 200);
        let v = Lv * (Lv + 1) * (Lv + 2) * (Lv + 3) + 3000;
        if (v > g.cap || v < 0) v = g.cap;
        out.value = v; out.field = g.field;
      }
      if (g.kind === 'growth') { out.add = g.add; out.lo = g.lo; out.hi = g.hi; }
      if (g.calls) {
        out.calls = g.calls.map(function (c) {
          return { skill: c.skill, chara: c.chara, exp: growthExp(id, ctx), p3: c.p3, p4: c.p4 };
        });
      }
      if (g.skipBits) out.skipBits = g.skipBits.slice();
      return out;
    }
    for (let i = 0; i < TOP('growthCovered').length; i++) {
      const c = TOP('growthCovered')[i];
      if (c.label === id) return { label: id, src: c.src, kind: 'coveredBy', module: c.module, skills: (c.skills || []).slice() };
    }
    return { label: id, src: '', kind: 'none' };
  }

  // ================================================================ 226858-227252：synccheck 播报族
  /** 226858-227252：按 label 取 2305..2335 播报，渲染代词并返回效果指令 */
  function pronounSynccheck(label, ctx) {
    ctx = ctx || {}; const id = val(label);
    let B = null;
    for (let i = 0; i < TOP('broadcasts').length; i++) if (TOP('broadcasts')[i].label === id) { B = TOP('broadcasts')[i]; break; }
    if (!B) return null;
    const tpl = L(ctx.lang) === 'jp' ? B.jp : B.en;
    return {
      label: B.label, src: B.src, txtef: B.txtef, pre: B.pre.slice(),
      jp: B.jp, en: B.en, text: fill(tpl, words(ctx)),
      effects: B.effects.map(function (e) { return e.slice(); }),
    };
  }
  function broadcastCount() { return TOP('broadcasts').length; }

  // ================================================================ 202819-202947：comevdisp 族
  /** 202819-202947：comevdisp 变量族规则（事件码 252 / 慢加载 300 / 保存时刻 2） */
  function comevdisp() { return RULE('comevdisp'); }
  /** 202867：小时 = 时 + 日*24 + 月*24*30 + 年*24*30*12 + 24*30 */
  function browserSaveHours(h, d, m, y) {
    const S = RULE('comevdisp').saveHours;
    return val(h) + val(d) * S.hoursPerDay + val(m) * S.hoursPerDay * S.daysPerMonth
      + val(y) * S.hoursPerDay * S.daysPerMonth * S.monthsPerYear + S.addHours;
  }
  /** 202846 / 202932：慢加载提示文案 */
  function slowLoadText(lang) { const C = RULE('comevdisp').slowText; return C ? C[L(lang)] : ''; }

  // ================================================================ 210969-211000：变量赋值
  /** 210969-210985：label_2115 的 mef/物品字段赋值规则 */
  function variableAssign() { return RULE('variableAssign'); }
  /** 210986-211000：label_2116 的九宫格位掩码 1000/1/8/2/4/16/32/64/128 */
  function neighborBitmask(x, y, grid) {
    const R = RULE('variableAssign'); const bits = R.neighborBits || [];
    const entries = [];
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i], nx = val(x) + b[0], ny = val(y) + b[1];
      const key = nx + ',' + ny;
      if (grid) grid[key] = val(grid[key]) + b[2];
      entries.push([nx, ny, b[2]]);
    }
    return { entries: entries, grid: grid || null, src: R.src };
  }

  // ================================================================ 26065-26090：基因继承
  /** 26065-26090：seed=物品槽30+1，repeat 10 抽 rnd(15)，基因槽 40+2*id，去重后按 rnd(4)>count 收录 */
  function getInheritance(ctx) {
    const R = RULE('getInheritance'); ctx = ctx || {};
    const RND = rndOf(ctx.rng, ctx.seed);
    const v99 = ctx.v99 || function () { return 0; };
    const genes = [];
    for (let i = 0; i < R.repeat; i++) {
      const id = RND(R.rndN);
      if (val(v99(R.geneBase + id * R.geneStep, val(ctx.item))) === 0) continue;
      if (R.dedup && genes.indexOf(id) >= 0) continue;
      const flag = val(v99(R.geneBase + id * R.geneStep + R.geneFlagOffset, val(ctx.item)));
      if (RND(R.rnd4) > genes.length || flag < 0) genes.push(id);
    }
    return { genes: genes, count: genes.length, src: R.src };
  }

  // ================================================================ 26150-26193：flt 族
  /** 26150-26193：flt / fltn / discsetmc / fltsetdungeon 规则 */
  function fltFamily() { return RULE('fltFamily'); }
  /** 26150-26168：objLv=0 时 calcobjlv(var_65(22))，fixLv=0 时 calcfixlv(2) */
  function flt(objLv, fixLv, ctx) {
    const R = RULE('fltFamily').flt; ctx = ctx || {};
    return {
      obj: val(objLv) === 0 ? (ctx.calcobjlv ? val(ctx.calcobjlv(val(ctx.dungeonLevel))) : 0) : val(objLv),
      fix: val(fixLv) === 0 ? (ctx.calcfixlv ? val(ctx.calcfixlv(2)) : 0) : val(fixLv),
      cleared: R.cleared.slice(), src: '26150-26168',
    };
  }
  /** 26169-26181：fltn 按分隔符 47 切最多 10 段，各段包裹成 /xxx/ */
  function fltn(s) {
    const R = RULE('fltFamily').fltn;
    const raw = String(s == null ? '' : s).split(String.fromCharCode(R.separator));
    const parts = [];
    for (let i = 0; i < raw.length && i < R.repeat; i++) if (raw[i] !== '') parts.push(R.wrap + raw[i] + R.wrap);
    return { parts: parts, count: parts.length, separator: R.separator, src: '26169-26181' };
  }
  /** 26183-26184：discsetmc 返回 rnd(87) */
  function discsetmc(rng) { const R = RULE('fltFamily').discsetmc; return rndOf(rng, 0)(R.rndN); }
  /** 26185-26192：fltsetdungeon 三档表 644/645/646，先 rnd(20)==0，再 rnd(3)==0 */
  function fltsetdungeon(rng, tables) {
    const R = RULE('fltFamily').fltsetdungeon;
    const RND = rndOf(rng, 0);
    tables = tables || {};
    const pick = function (arr) { return (arr && arr.length) ? arr[RND(arr.length)] : 0; };
    if (RND(R.rnd20) === 0) return { table: R.tables[0], id: pick(tables[R.tables[0]]), src: '26185-26192' };
    if (RND(R.rnd3) === 0) return { table: R.tables[1], id: pick(tables[R.tables[1]]), src: '26185-26192' };
    return { table: R.tables[2], id: pick(tables[R.tables[2]]), src: '26185-26192' };
  }

  // ================================================================ 29294-29312：fix_find
  /** 29294-29312：物品 555 且 f21==3 时 f21=0 / f9=0 / f26=100 并 snd 90 */
  function fixFind(ctx) {
    const R = RULE('fixFind'); ctx = ctx || {};
    const items = ctx.items || []; const touched = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (val(it[0]) <= 0 || val(it[3]) !== R.item) continue;
      if (val(it[21]) === R.f21) {
        it[21] = R.reset['21']; it[9] = R.reset['9']; it[26] = R.reset['26']; touched.push(R.snd);
      }
    }
    return { item: R.item, reset: R.reset, snd: R.snd, touched: touched, src: R.src };
  }

  // ================================================================ 31523-31547：csvstr2 / cargocheck
  /** 31523-31535：csvstr2 按 ASCII 44 逗号切分，最多 40 段 */
  function csvstr2(s) {
    const R = RULE('csvstr2');
    const parts = String(s == null ? '' : s).split(String.fromCharCode(R.separator));
    return { parts: parts.slice(0, R.maxParts), count: Math.min(parts.length, R.maxParts), separator: R.separator, src: R.src };
  }
  /** 31537-31547：cargocheck 两个分支均返回 1，由 core/residual_map.js 的 cargoCheck 承接调用点 */
  function cargoCheck() { const R = RULE('cargoCheck'); return { result: R.result, maps: R.maps.slice(), module: R.coveredBy, src: R.src }; }

  // ================================================================ 32260-32261：calcshopreform
  /** 32260-32261：var_126(18)*100+1000 */
  function calcShopReform(v) { const R = RULE('calcShopReform'); return { value: val(v) * R.mul + R.add, mul: R.mul, add: R.add, src: R.src }; }

  // ================================================================ 201512-201523：actionsp
  /** 201512-201523：仅玩家走 SP 判定，SP<50 且 SP<rnd(75) 时返回 0，否则返回 1 */
  function actionsp(cc, sp, amount, rng) {
    const R = RULE('actionsp');
    if (val(cc) !== R.playerOnly) return { spent: true, ret: 1, amount: val(amount), src: R.src };
    const RND = rndOf(rng, 0);
    if (val(sp) < R.threshold && val(sp) < RND(R.rnd)) return { spent: true, ret: 0, amount: val(amount), src: R.src };
    return { spent: true, ret: 1, amount: val(amount), src: R.src };
  }

  // ================================================================ 29901-29909：rpname
  /** 29901-29909：自定义名优先；idx>=400 取 var_54(idx-400)；否则 ????? */
  function rpname(idx, custom, names) {
    const R = RULE('rpname'); const i = val(idx);
    if (custom && custom[i]) return { name: custom[i], src: R.src };
    if (i >= R.threshold) return { name: (names && names[i - R.threshold]) || R.fallback, src: R.src };
    return { name: R.fallback, src: R.src };
  }

  // ================================================================ 26029-26064：伙伴应援台词
  /** 26029-26064：var_630 的 11 条应援台词（ラーネイレ / ロミアス / ルルウィ 等） */
  function cheerLine(id, lang) {
    const lines = TOP('cheerLines');
    for (let i = 0; i < lines.length; i++) if (lines[i].id === val(id))
      return { id: lines[i].id, jp: lines[i].jp, en: lines[i].en, text: lines[i][L(lang)], src: '26029-26064' };
    return null;
  }

  // ================================================================ 229175-229203 / 291069-291096：判定与确认
  /** 229175-229203：var_1675 >= rnd(100) 判定门 */
  function rnd100Gate(threshold, roll) { return { pass: val(threshold) >= val(roll), gate: RULE('rnd100').gate, src: RULE('rnd100').src }; }
  /** 229202-229203：var_444 = (count*10-1)/400 */
  function inventoryCount(count) {
    const R = RULE('rnd100');
    return { value: idiv(val(count) * R.countMul - R.countSub, R.countDiv), src: R.src };
  }
  /** 291069-291096：命名确认播报与 cbit 977 */
  function nameConfirm(name, lang) {
    const R = RULE('nameConfirm'); const l = L(lang); const w = words({ name: name || '' });
    w.newName = name || '';
    return {
      bit: R.bit,
      prompt: fill(R.prompt[l], w),
      cancel: fill(R.cancel[l], w),
      named: fill(R.named[l], w),
      src: R.src,
    };
  }

  // ================================================================ 602270-602302：日期初始化
  /** 602270-602302：var_65(10..14)=517,10,12,16,10；var_2784=1；load=3 / newGame=4 */
  function dateInit() { return RULE('dateInit'); }

  // ================================================================ 其它小工具规则
  /** 000364-000375（源码 364-375）：guildname 按 263/264/265 位取公会名 */
  function guildName(bits, lang) {
    const R = RULE('misc').guildname; const l = L(lang);
    const get = typeof bits === 'function' ? bits : function (i) { return (bits && bits[i]) || 0; };
    let name = R.default[l];
    for (let i = 0; i < R.bits.length; i++) if (val(get(R.bits[i].v65)) !== 0) name = R.bits[i][l];
    return { name: name, bits: R.bits.map(function (b) { return b.v65; }), src: R.src };
  }
  /** 5024-5025：randskill 返回 rnd(41)+150 */
  function randSkill(rng) { const R = RULE('misc').randskill; return { id: rndOf(rng, 0)(R.rndN) + R.lo, lo: R.lo, hi: R.hi, src: R.src }; }
  /** 5026-5027：randattb 返回 rnd(8)+10 */
  function randAttb(rng) { const R = RULE('misc').randattb; return { id: rndOf(rng, 0)(R.rndN) + R.lo, src: R.src }; }
  /** 11950-11957：label_0218 前缀词表 2 组 5 档 */
  function prefixWord(group, rank, lang) {
    const R = RULE('misc').prefixWords; const g = val(group), r = val(rank);
    const row = R.groups[g] && R.groups[g][r];
    return row ? { group: g, rank: r, jp: row.jp, en: row.en, text: row[L(lang)], src: R.src } : null;
  }
  /** 194576-194612：incognitobegin 跳过链与 var_58(79)=221 设置 */
  function incognitoBegin(ctx) {
    const R = RULE('misc').incognitobegin; ctx = ctx || {};
    const out = { duel: !!ctx.duel, snd: R.snd, skips: R.skips, set: R.set, duelText: R.duelText, src: R.src };
    return out;
  }
  /** 235635-235656：var_126(10) = (100 - var_65(125)/100)/4 + 1 */
  function cellRefreshLevel(v65_125) {
    const R = RULE('misc').label2447;
    return { value: idiv(R.base - idiv(val(v65_125), R.div), R.div4) + R.add, src: R.src };
  }
  /** 235860-235889：食物 60000 加 limit(f1/50,50,500)，价值按类别除 20/10/10/1000 */
  function foodValue(cat, f1) {
    const R = RULE('misc').label2451; const c = val(cat);
    const div = R.valueDiv[String(c)] || R.valueDiv.default;
    return {
      category: c,
      homeAdd: c === R.foodCat ? clamp(idiv(val(f1), 50), 50, 500) : 0,
      divisor: div,
      value: idiv(val(f1), div),
      src: R.src,
    };
  }
  /** 279451-279464：blendcheckext 取 mod 10000，落在 [0,1499) 且与 f23 相等返回 1 */
  function blendCheckExt(value, f23) {
    const R = RULE('misc').blendcheckext; const v = val(value);
    if (v < R.ge) return { ok: 0, src: R.src };
    const m = imod(v, R.mod);
    if (m < 0 || m >= R.upper) return { ok: 0, src: R.src };
    return { ok: val(f23) === m ? 1 : 0, mod: m, src: R.src };
  }
  /** 304316-304331：环形缓冲 (v+1) mod 4 */
  function ringIndex(v) { const R = RULE('misc').ringIndex; return { index: imod(val(v) + 1, R.mod), mod: R.mod, src: R.src }; }
  /** 344646-344650：var_2535 上限 2000 */
  function clamp2000(v) { const R = RULE('misc').clamp2000; return { value: Math.min(val(v), R.cap), cap: R.cap, src: R.src }; }
  /** 220619-220624：四个 rnd(45)+1 */
  function rand45(rng) {
    const R = RULE('misc').rand45; const RND = rndOf(rng, 0); const out = [];
    for (let i = 0; i < R.count; i++) out.push(RND(R.rndN) + R.add);
    return { values: out, src: R.src };
  }
  /** 220812-220822：分页上限 (var_701-1)/var_893 */
  function pageClamp(total, per) { return { value: idiv(val(total) - 1, val(per) || 1), src: RULE('misc').pageClamp.src }; }
  /** 340772-340794：状态字段清零表 */
  function clearStatusFields() { const R = RULE('misc').clearStatus; return { fields: R.fields.slice(), capField: R.capField, cap: R.cap, restore: R.restore, src: R.src }; }
  /** 211370-211440：目标格差 >1 拒绝 */
  function moveCheck(dx, dy) { const R = RULE('misc').moveCheck; return { ok: Math.abs(val(dx)) <= R.maxDelta && Math.abs(val(dy)) <= R.maxDelta, src: R.src }; }
  /** 235890-235944：var_65(22)!=1 返回 */
  function depthGate(depth) { const R = RULE('misc').depthGate; return { pass: val(depth) === R.eq, src: R.src }; }
  /** 25000 段小工具规则集合 */
  function misc() { return RULE('misc'); }

  // ================================================================ 登记表与统计
  /** 全部源码区间登记 */
  function ranges() { return (table() ? table().ranges : []).slice(); }
  /** 226858-227252 之外的 trivial 段登记（纯音效 / 整屏绘制 / 声明） */
  function trivial() { return TOP('trivial').slice(); }
  /** 由其它模块承接的区间登记 */
  function coveredBy() { return TOP('coveredBy').slice(); }
  function stats() {
    const D = table();
    return {
      ranges: D ? D.ranges.length : 0,
      rules: D ? Object.keys(D.rules).length : 0,
      broadcasts: D ? D.broadcasts.length : 0,
      growth: D ? D.growth.length : 0,
      growthCovered: D ? D.growthCovered.length : 0,
      cheerLines: D ? D.cheerLines.length : 0,
      trivial: D ? D.trivial.length : 0,
      coveredBy: D ? D.coveredBy.length : 0,
      parasiteCheck: D ? (D.parasiteCheck ? 1 : 0) : 0,
    };
  }

  const ResidualStatus = {
    ready: ready, table: table, ranges: ranges, trivial: trivial, coveredBy: coveredBy, stats: stats,
    selfHarmCheck: selfHarmCheck, appraise: appraise, appraiseRoll: appraiseRoll, appraiseHit: appraiseHit,
    modHeight: modHeight,
    anorexia: anorexia, cureAnorexia: cureAnorexia, charaAnorexia: charaAnorexia,
    eatStatus: eatStatus, eatStatusFood: eatStatusFood,
    bloodStain: bloodStain, spillBlood: spillBlood, spillFrag: spillFrag,
    itemRot: itemRot, remainMake: remainMake,
    advFavoriteSkill: advFavoriteSkill, advFavoriteStat: advFavoriteStat,
    relationBetween: relationBetween, calcAge: calcAge, wakeUp: wakeUp, label2045: label2045,
    growthChain: growthChain,
    pronounSynccheck: pronounSynccheck, broadcastCount: broadcastCount,
    comevdisp: comevdisp, browserSaveHours: browserSaveHours, slowLoadText: slowLoadText,
    variableAssign: variableAssign, neighborBitmask: neighborBitmask,
    getInheritance: getInheritance,
    fltFamily: fltFamily, flt: flt, fltn: fltn, discsetmc: discsetmc, fltsetdungeon: fltsetdungeon,
    fixFind: fixFind, csvstr2: csvstr2, cargoCheck: cargoCheck, calcShopReform: calcShopReform,
    actionsp: actionsp, rpname: rpname, cheerLine: cheerLine,
    rnd100Gate: rnd100Gate, inventoryCount: inventoryCount, nameConfirm: nameConfirm,
    dateInit: dateInit,
    guildName: guildName, randSkill: randSkill, randAttb: randAttb, prefixWord: prefixWord,
    incognitoBegin: incognitoBegin, cellRefreshLevel: cellRefreshLevel, foodValue: foodValue,
    blendCheckExt: blendCheckExt, ringIndex: ringIndex, clamp2000: clamp2000, rand45: rand45,
    pageClamp: pageClamp, clearStatusFields: clearStatusFields, moveCheck: moveCheck,
    depthGate: depthGate, misc: misc,
  };

  Elona.ResidualStatus = ResidualStatus;
  if (typeof module !== 'undefined' && module.exports) module.exports = ResidualStatus;
})(window);
