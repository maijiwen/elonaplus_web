'use strict';
/**
 * 0-GX 最终批次：4.1 固定清单与第 0 节点名两块最大零散缺口的规则表与 API。
 * 数据源 web/data/tables/residual_final.json，由 tools/extract_residual_final.py
 * 逐行校验 hsp/start.hsp（cp932）后编译产出；IIFE 模块 Elona.ResidualFinal。
 *
 * 【本批处理的源码区间逐条登记（hsp/start.hsp 行号）】
 *  30225-30314   节点0缺口：物品名 var_719 前后缀拼装（prm_617 / var_99(3) 分支）
 *  0335-0363     label_0026 早期排行称号文本表（335-363 的零填充写法）
 *  25900-25900   random_title 声明行
 *  37314-37328   id_crlf CRLF 处理
 *  197461-197520 copy_chara 全字段复制（memcpy 600*4*2 / 500*4 / var_63 ×10）
 *  222619-222847 label_2288 物种专属分派（refchara(种族,3) 的 var_1302 链）
 *  223955-223991 label_2291 角色生成随机性格
 *  229827-229866 label_2392 notesel 文本载入（var_1708）
 *  229928-229957 label_2397 notesel 文本（var_433）
 *  230181-231622 label_2410..2420 地图初始化 / 生成主流程（var_126 各字段与入口设施）
 *  232947-232968 label_2434 var_400 = 7
 *  235164-235169 label_2443 var_1340 = 0
 *  235683-235699 label_2449 var_444 = 0
 *  237796-237816 label_2460 repeat 57
 *  237817-237830 label_2461 gosub *label_2460
 *  249768-249782 label_2473 repeat var_126(1)
 *  271045-272103 label_2591..2605 随机站点进场 / atx 动画族
 *  278852-278855 label_2618 var_243 = 0
 *  278856-278902 label_2619 re_select 配方重选
 *  278971-278974 label_2621 var_138 = ""
 *  281038-281053 label_2656 var_1442 = 1
 *  282962-282973 label_2661 item_stack 0, var_579
 *  283955-283960 label_2679 var_910 = 33
 *  284002-284005 label_2682 var_218 = -1
 *  286895-286911 label_2712 snd 26
 *  287072-287084 label_2716 snd 26
 *  287624-287636 label_2724 del_str 路径清洗
 *  287730-287732 label_2728 var_121 = lang(...)
 *  288728-288745 label_2737 var_242 = 0
 *  288746-288752 label_2738 gosub *label_2958
 *  291908-291914 label_2771 var_244 = var_243
 *  294450-294463 label_2790 var_444 = -2
 *  295363-295404 label_2812 var_1322=106 对话类型（var_1369=-1）
 *  295600-295610 label_2816 var_763 = -1
 *  296099-296113 label_2820 if ( var_58(141, var_244) != 0 )
 *  296114-296132 label_2821 if ( var_701 < 1 )
 *  296133-296154 label_2822 if ( var_701 < 1 )
 *  300687-300690 label_2843 var_691 = 50
 *  300691-300702 label_2844 var_242 = 0
 *  300965-300985 label_2849 if ( var_99(3, var_579) == 563 )
 *  301182-301413 label_2851 Dump:Init（生成角色并 gosub 3103）
 *  301502-301509 label_2853 inv_getheader -1
 *  302526-302532 label_2856 var_65(184)++
 *  302656-302681 label_2861 var_400 = 12
 *  304470-304476 label_2880 snd 49
 *  304904-304910 label_2891 wparam / ginfo 窗口输入（byDesign）
 *  305368-305380 label_2901 await / stick 闪屏循环（byDesign）
 *  305381-305389 label_2902 clrobj 屏幕对象（byDesign）
 *  305759-305763 label_2905 noteadd / objprm 屏幕对象（byDesign）
 *  305764-305773 label_2906 CreateMutexA 单实例互斥
 *  340431-340435 label_2970 var_579 = var_2436
 *  341871-341873 label_2977 item_exchange var_579, var_580
 *  342527-342548 label_2983 if ( var_99(3, var_579) == 783 )
 *  342583-342597 label_2985 var_59 = 15
 *  342877-342923 label_2988 repeat 17 扫描（var_2526）
 *  344651-344739 label_2995 item_find 636 道具检查
 *  344742-344750 label_2997 txtmore
 *  345086-345091 label_2999 item_stack var_243, var_2464
 *  348233-348245 label_3010 if ( var_65(70) == 1013 )
 *  348246-348249 label_3011 var_704(...) = var_1471
 *  348250-348265 label_3012 if ( var_58(52, var_243) < 0 )
 *  365528-365561 clientguide 委托引导
 *  365607-365698 节点0缺口：label_3031 NPC 对话门控（三道 won't listen 闸门）
 *  365985-365999 label_3032 var_701 = 0
 *  425448-425452 label_3070 snd 10
 *  591176-591181 label_4290 var_581 = 0
 *  602248-602269 label_4346 inv_getheader 0
 *  604861-605199 label_4358..4359 turn_end:pc 与 pc_turn_init
 *
 * 【数据加载】测试环境注入 Elona.ResidualFinalData 优先；浏览器环境走
 * Elona.Data.tableSync('residual_final')。规则表由 JSON 提供，JS 负责解释执行。
 * 13 组真实段编译成规则 + API；小段由 trivial(a) / trivialAll() 逐条查询；
 * HSP 整屏绘制与窗口输入原语登记在 byDesign()。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let cached = null;

  function table() {
    if (!cached) {
      if (Elona.ResidualFinalData && Elona.ResidualFinalData.ranges) {
        cached = Elona.ResidualFinalData;
      } else if (Elona.Data && Elona.Data.tableSync) {
        try { cached = Elona.Data.tableSync('residual_final'); } catch (e) { cached = null; }
      }
    }
    return cached;
  }

  function T() { return table() || {}; }
  function R() { return T().rules || {}; }
  function lang(L) { return L === 'jp' ? 'jp' : 'en'; }
  function idiv(a, b) { return b === 0 ? 0 : Math.trunc(a / b); }
  function arr(v) { return Array.isArray(v) ? v.slice() : []; }

  // ---------------------------------------------------------------- 总览 / 区间
  function ready(data) { cached = (data && data.ranges) ? data : null; return this; }
  function ranges() { return arr(T().ranges).map(function (r) { return r.slice(); }); }
  function rangeCount() { return arr(T().ranges).length; }
  function hasRange(a, b) {
    return arr(T().ranges).some(function (r) { return r[0] === a && r[1] === b; });
  }
  function stats() { return T().stats || {}; }
  function rules() { return R(); }
  function rule(key) { return R()[key] || null; }
  function ruleKeys() { return Object.keys(R()); }
  function ruleCount() { return Object.keys(R()).length; }

  // ---------------------------------------------------------------- 222619-222847 物种专属分派
  function speciesDispatch() { return R().speciesDispatch || null; }
  function speciesClass(id) {
    const D = speciesDispatch(); if (!D) return null;
    return arr(D.classes).find(function (c) { return c.id === (id | 0); }) || null;
  }
  function speciesCats(id) {
    const c = speciesClass(id);
    return c ? arr(c.rolls).map(function (r) { return r.cat; }) : [];
  }
  function speciesRolls(id, rnd) {
    const c = speciesClass(id); if (!c) return [];
    const q = typeof rnd === 'function' ? rnd : function () { return 0; };
    return arr(c.rolls).filter(function (r) { return q(r.den) === 0; })
      .map(function (r) { return r.cat; });
  }
  function speciesClassCount() { const D = speciesDispatch(); return D ? arr(D.classes).length : 0; }
  function speciesGuard() { const D = speciesDispatch(); return D ? D.guard : null; }

  // ---------------------------------------------------------------- 230181-231622 地图初始化主流程
  function mapInit() { return R().mapInit || null; }
  function mapLabels() { const D = mapInit(); return D ? arr(D.labels) : []; }
  function mapSizes() { const D = mapInit(); return D ? arr(D.sizes) : []; }
  function mapSize(label) {
    return mapSizes().find(function (s) { return s.label === label; }) || null;
  }
  function mapDefaults() { const D = mapInit(); return D ? (D.defaults || {}) : {}; }
  function mapVar126Fields() { const D = mapInit(); return D ? (D.var126Fields || {}) : {}; }
  function mapVar126_12() { const D = mapInit(); return D ? arr(D.var126_12) : []; }
  function mapCoast() { const D = mapInit(); return D ? (D.coast || {}) : {}; }
  function mapFacilityTable() { const D = mapInit(); return D ? arr(D.facilityTable) : []; }
  function mapFacility(key) {
    return mapFacilityTable().find(function (f) { return f.key === (key | 0); }) || null;
  }
  function mapTypeToFacility() { const D = mapInit(); return D ? arr(D.mapTypeToFacility) : []; }
  function mapEntryGosubs() { const D = mapInit(); return D ? arr(D.entryGosubs) : []; }

  // ---------------------------------------------------------------- 301182-301413 Dump:Init
  function dumpInit() { return R().dumpInit || null; }
  function dumpSections() { const D = dumpInit(); return D ? arr(D.sections) : []; }
  function dumpSection(name) { return dumpSections().indexOf(name) >= 0 ? name : null; }
  function dumpGosubs() { const D = dumpInit(); return D ? arr(D.gosubs) : []; }
  function dumpVersion() { const D = dumpInit(); return D ? D.version : ''; }
  function dumpSkillTier(v) {
    const D = dumpInit(); if (!D) return '';
    const n = v | 0;
    for (const t of arr(D.skillTiers)) {
      if (t.min === null || n >= t.min) return t.label;
    }
    return 'hopeless';
  }
  function dumpDateVars() { const D = dumpInit(); return D ? arr(D.dateVars) : []; }

  // ---------------------------------------------------------------- 344651-344739 item_find 636
  function itemFind636() { return R().itemFind636 || null; }
  function lockpickConstants() {
    const D = itemFind636(); if (!D) return {};
    return { lockpickId: D.lockpickId, skeletonKeyId: D.skeletonKeyId,
             snd: D.snd, skillVar: D.skillVar, difficultyVar: D.difficultyVar };
  }
  function lockpickSkill(skill, hasKey) {
    const D = itemFind636(); if (!D) return 0;
    const s = skill | 0;
    return hasKey ? idiv(s * 150, 100) + 5 : s;
  }
  function lockpickOutcome(skill, difficulty, hasKey, rnd) {
    const D = itemFind636(); if (!D) return null;
    const q = typeof rnd === 'function' ? rnd : function () { return 0; };
    const v = lockpickSkill(skill, hasKey);
    const d = difficulty | 0;
    if (v * 2 < d) return 'no-skill';
    if (idiv(v, 2) >= d) return 'easy';
    const a = q(v * 2);          // rnd(var_399 * 2)
    const b = q(a + 1);          // rnd(a + 1)
    return b < d ? 'fail' : 'ok';
  }
  function lockpickMsgs(L) {
    const D = itemFind636(); if (!D) return [];
    return arr(D.messages[lang(L)]);
  }

  // ---------------------------------------------------------------- 604861-605199 turn_end:pc
  function turnEndPc() { return R().turnEndPc || null; }
  function turnEndSteps() { const D = turnEndPc(); return D ? arr(D.steps) : []; }
  function turnEndStep(i) { return turnEndSteps()[i | 0] || null; }
  function pcTurnInitSteps() { const D = turnEndPc(); return D ? arr(D.pcTurnInit) : []; }
  function turnEndConstants() { const D = turnEndPc(); return D ? (D.constants || {}) : {}; }
  function turnEndGosubs() { const D = turnEndPc(); return D ? arr(D.gosubs) : []; }

  // ---------------------------------------------------------------- 271045-272103 随机站点 / atx
  function randSiteAtx() { return R().randSiteAtx || null; }
  function atxLabels() { const D = randSiteAtx(); return D ? arr(D.labels) : []; }
  function atxInitParams() { const D = randSiteAtx(); return D ? (D.init || {}) : {}; }
  function atxSites() { const D = randSiteAtx(); return D ? arr(D.sites) : []; }
  function atxSite(type) {
    return atxSites().find(function (s) { return s.type === (type | 0); }) || null;
  }
  function atxAnimId(type) { const s = atxSite(type); return s ? s.anim : null; }
  function atxSndList() { const D = randSiteAtx(); return D ? arr(D.snd) : []; }
  function atxEntryNumbers() { const D = randSiteAtx(); return D ? (D.entryNumbers || {}) : {}; }
  function atxInitCount() {
    // atxinit 在 271252 / 271333 / 271358 / 271419 / 271533 / 271554 / 271578 / 271614 / 271663 / 271814 / 271844 调用
    return [271252, 271333, 271358, 271419, 271533, 271554, 271578, 271614, 271663, 271814, 271844];
  }

  // ---------------------------------------------------------------- 197461-197520 copy_chara
  function copyChara() { return R().copyChara || null; }
  function copyCharaFields() {
    const D = copyChara(); if (!D) return [];
    return arr(D.fields).map(function (f) { return f.n; });
  }
  function copyCharaMemBlocks() { const D = copyChara(); return D ? arr(D.memBlocks) : []; }
  function copyCharaOverrides() { const D = copyChara(); return D ? (D.overrides || {}) : {}; }
  function copyCharaCbits() { const D = copyChara(); return D ? arr(D.cbits) : []; }
  function copyCharaSlotRange() { return [57, 245]; }

  // ---------------------------------------------------------------- 342877-342923 repeat 17
  function repeat17() { return R().repeat17 || null; }
  function repeat17Range(x, y, isPc, f28) {
    const D = repeat17(); if (!D) return null;
    const size = isPc ? (D.pcScan.size | 0) : ((f28 | 0) - 2);
    const half = idiv(size, 2);
    return { size: size, half: half,
             xLo: (x | 0) - half, xHi: (x | 0) + half,
             yLo: (y | 0) - half, yHi: (y | 0) + half,
             counter: D.counter, conditions: arr(D.conditions) };
  }
  function repeat17Conditions() { const D = repeat17(); return D ? arr(D.conditions) : []; }

  // ---------------------------------------------------------------- 365528-365561 clientguide
  function clientGuide() { return R().clientGuide || null; }
  function clientGuideScan(slots, opts) {
    const D = clientGuide(); if (!D) return [];
    const o = opts || {};
    const q = o.qtable || {};
    const mapVar22 = o.mapVar22 === undefined ? 1 : o.mapVar22;
    const cur = o.currentMap || 0;
    const out = [];
    for (let i = 0; i < 5; i++) {
      const id = arr(slots)[i];
      const e = q[id]; if (!e) continue;
      if (e.flag8 !== 1 || mapVar22 !== 1) continue;
      let target = -1;
      if (e.type3 === 1011 && e.field1 === cur) target = e.field10;
      if (e.type3 === 1002) {
        const n = q[e.field10];
        if (n && n.field1 === cur) target = n.field0;
      }
      if (target === -1) continue;
      let dup = false;
      for (let j = 0; j < i; j++) { if (arr(slots)[j] === id) { dup = true; break; } }
      if (!dup) out.push(target);
    }
    return out;
  }
  function clientGuideCases() { const D = clientGuide(); return D ? arr(D.cases) : []; }

  // ---------------------------------------------------------------- 295363-295404 对话类型 106
  function dialog106() { return R().dialog106 || null; }
  function dialog106Type(equipLoc, stat) {
    const D = dialog106(); if (!D) return null;
    if ((equipLoc | 0) === 10) return 103;
    if ((stat | 0) === 1 && (equipLoc | 0) === 5) return 111;
    return D.init.var_1322;
  }
  function dialog106Labels(L) {
    const D = dialog106(); if (!D) return [];
    return arr(D.labels[lang(L)]);
  }
  function dialog106Skips() { const D = dialog106(); return D ? arr(D.skips) : []; }
  function dialog106Gosubs() { const D = dialog106(); return D ? arr(D.gosubs) : []; }

  // ---------------------------------------------------------------- 278856-278902 re_select
  function reSelect() { return R().reSelect || null; }
  function reSelectInit() { const D = reSelect(); return D ? (D.init || {}) : {}; }
  function reSelectWidth(w) { return (w | 0) + 36; }
  function reSelectHeight(gifoh, noteInfo, itemCount) {
    return (gifoh | 0) + (noteInfo | 0) * 15 + 80 + (itemCount | 0) * 20;
  }
  function reSelectDraw() { const D = reSelect(); return D ? arr(D.draw) : []; }

  // ---------------------------------------------------------------- 365607-365698 NPC 对话门控
  function npcTalkGate() { return R().npcTalkGate || null; }
  function talkGateCheck(s) {
    const D = npcTalkGate(); if (!D) return null;
    const o = s || {};
    for (const g of arr(D.gates)) {
      if (g.id === 'training' && o.cbit960 === 1 && o.map20 === 67 && o.var106 === 0) return g.id;
      if (g.id === 'excited' && o.cbit960 === 1 && o.var132_16 === 100 && o.var106 === 0) return g.id;
      if (g.id === 'deaf' && o.slot9 <= -1 && o.cbit960 !== 1 && o.cbit1049 !== 1 && o.var106 === 0) return g.id;
    }
    return null;
  }
  function talkGateMsgs(L) {
    const D = npcTalkGate(); if (!D) return [];
    return arr(D.gates).map(function (g) { return lang(L) === 'jp' ? g.jp : g.en; });
  }
  function talkGateInit() { const D = npcTalkGate(); return D ? arr(D.init) : []; }
  function talkGateTutorial() { const D = npcTalkGate(); return D ? arr(D.tutorial) : []; }
  function talkGateCommon() { const D = npcTalkGate(); return D ? (D.gateCommon || {}) : {}; }

  // ---------------------------------------------------------------- 30225-30314 物品名片段
  function itemNameFragments() { return R().itemNameFragments || null; }
  function itemNameIds() {
    const D = itemNameFragments(); if (!D) return [];
    return [1265, 60000, 1325, 1326, 1327, 1328, 1329, 1330, 1331, 344, 615, 704, 1115, 672];
  }
  function bodyPartName(idx, L) {
    const D = itemNameFragments(); if (!D) return '';
    const list = arr(D.bodyParts[lang(L)]);
    return list[(idx | 0) - 1] || '';
  }
  function godName(key, L) {
    const D = itemNameFragments(); if (!D) return '';
    const g = arr(D.gods).find(function (x) { return String(x.key) === String(key); });
    if (!g) return '';
    return lang(L) === 'jp' ? g.jp : g.en;
  }
  function itemNameFragment(id, p, L) {
    const D = itemNameFragments(); if (!D) return '';
    const l = lang(L), o = p || {}, n = id | 0;
    if (n === 1265) return bodyPartName(o.f32, l);
    if (n === 60000 || (n >= 1325 && n <= 1331)) {
      const v = o.f23 | 0;
      if (v >= 13 || v < 0) return '';
      return 'var_282(' + v + ')';
    }
    if (n === 344) return l === 'jp' ? String(o.ref279 || '') + 'の' : ' of ' + String(o.ref279 || '');
    if (n === 615) return l === 'jp' ? (o.f23 | 0) + 'goldの' : ' <' + (o.f23 | 0) + ' gp>';
    if (n === 704 || n === 1115) {
      const v = o.f23 | 0;
      if (v < 0 || v >= 1499) return '/bugged/';
      const nm = String(o.refChara || '');
      return l === 'jp' ? nm + 'の' : ' of ' + nm;
    }
    if (n === 672) return godName(o.f25, l);
    return '';
  }
  function itemNameGods(L) {
    const D = itemNameFragments(); if (!D) return [];
    return arr(D.gods).map(function (g) { return lang(L) === 'jp' ? g.jp : g.en; });
  }

  // ---------------------------------------------------------------- trivial / byDesign 查询
  function trivialAll() { return arr(T().trivial); }
  function trivial(a) {
    if (a === undefined) return null;
    const n = a | 0;
    return trivialAll().find(function (t) {
      return t.range[0] === n || (n >= t.range[0] && n <= t.range[1]);
    }) || null;
  }
  function trivialCount() { return trivialAll().length; }
  function trivialTypes() {
    const out = {};
    trivialAll().forEach(function (t) { out[t.type] = (out[t.type] || 0) + 1; });
    return out;
  }
  function trivialStatements(a) { const t = trivial(a); return t ? arr(t.statements) : []; }
  function byDesign() { return arr(T().byDesign); }
  function byDesignCount() { return byDesign().length; }
  function byDesignReasons() { return byDesign().map(function (b) { return b.reason; }); }

  const ResidualFinal = {
    ready: ready, table: table, tableSyncName: function () { return 'residual_final'; },
    ranges: ranges, rangeCount: rangeCount, hasRange: hasRange, stats: stats,
    rules: rules, rule: rule, ruleKeys: ruleKeys, ruleCount: ruleCount,

    speciesDispatch: speciesDispatch, speciesClass: speciesClass,
    speciesCats: speciesCats, speciesRolls: speciesRolls,
    speciesClassCount: speciesClassCount, speciesGuard: speciesGuard,

    mapInit: mapInit, mapLabels: mapLabels, mapSizes: mapSizes, mapSize: mapSize,
    mapDefaults: mapDefaults, mapVar126Fields: mapVar126Fields,
    mapVar126_12: mapVar126_12, mapCoast: mapCoast,
    mapFacilityTable: mapFacilityTable, mapFacility: mapFacility,
    mapTypeToFacility: mapTypeToFacility, mapEntryGosubs: mapEntryGosubs,

    dumpInit: dumpInit, dumpSections: dumpSections, dumpSection: dumpSection,
    dumpGosubs: dumpGosubs, dumpVersion: dumpVersion,
    dumpSkillTier: dumpSkillTier, dumpDateVars: dumpDateVars,

    itemFind636: itemFind636, lockpickConstants: lockpickConstants,
    lockpickSkill: lockpickSkill, lockpickOutcome: lockpickOutcome,
    lockpickMsgs: lockpickMsgs,

    turnEndPc: turnEndPc, turnEndSteps: turnEndSteps, turnEndStep: turnEndStep,
    pcTurnInitSteps: pcTurnInitSteps, turnEndConstants: turnEndConstants,
    turnEndGosubs: turnEndGosubs,

    randSiteAtx: randSiteAtx, atxLabels: atxLabels, atxInitParams: atxInitParams,
    atxSites: atxSites, atxSite: atxSite, atxAnimId: atxAnimId,
    atxSndList: atxSndList, atxEntryNumbers: atxEntryNumbers,
    atxInitCount: atxInitCount,

    copyChara: copyChara, copyCharaFields: copyCharaFields,
    copyCharaMemBlocks: copyCharaMemBlocks, copyCharaOverrides: copyCharaOverrides,
    copyCharaCbits: copyCharaCbits, copyCharaSlotRange: copyCharaSlotRange,

    repeat17: repeat17, repeat17Range: repeat17Range,
    repeat17Conditions: repeat17Conditions,

    clientGuide: clientGuide, clientGuideScan: clientGuideScan,
    clientGuideCases: clientGuideCases,

    dialog106: dialog106, dialog106Type: dialog106Type,
    dialog106Labels: dialog106Labels, dialog106Skips: dialog106Skips,
    dialog106Gosubs: dialog106Gosubs,

    reSelect: reSelect, reSelectInit: reSelectInit, reSelectWidth: reSelectWidth,
    reSelectHeight: reSelectHeight, reSelectDraw: reSelectDraw,

    npcTalkGate: npcTalkGate, talkGateCheck: talkGateCheck,
    talkGateMsgs: talkGateMsgs, talkGateInit: talkGateInit,
    talkGateTutorial: talkGateTutorial, talkGateCommon: talkGateCommon,

    itemNameFragments: itemNameFragments, itemNameIds: itemNameIds,
    bodyPartName: bodyPartName, godName: godName,
    itemNameFragment: itemNameFragment, itemNameGods: itemNameGods,

    trivial: trivial, trivialAll: trivialAll, trivialCount: trivialCount,
    trivialTypes: trivialTypes, trivialStatements: trivialStatements,
    byDesign: byDesign, byDesignCount: byDesignCount,
    byDesignReasons: byDesignReasons,
  };

  Elona.ResidualFinal = ResidualFinal;
  if (typeof module !== 'undefined' && module.exports) module.exports = ResidualFinal;
})(typeof window !== 'undefined' ? window : globalThis);
