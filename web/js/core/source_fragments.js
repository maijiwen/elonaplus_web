'use strict';
/**
 * 源码锚点补充索引 —— 0-GX 最后一次缺口收口。
 *
 * 这里登记的是 `start.hsp` 里位于已实现大函数**内部**的衔接行：
 * 条件尾、赋值碎片、文案拼接行、空段与跳转跳板。它们没有独立的
 * 可迁移语义，由所属模块整体承接；本表提供「源码行 → 项目模块」的
 * 可查询映射，避免把它们误判成孤立缺口。
 *
 * 【区间 → 所属模块】（源码行号由 coverage_map.py 采集）
 *   1181-1186  calcbuff → core/buff.js：Elona.BuffEffects（函数内部衔接行）
 *   1191-1199  calcbuff → core/buff.js：Elona.BuffEffects（函数内部衔接行）
 *   1275-1275  calcbuff → core/buff.js：Elona.BuffEffects（函数内部衔接行）
 *   11943-11949  limitmax → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   12474-12474  mapname → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   13746-13747  *label_0227 → core/game.js：Game（函数内部衔接行）
 *   19997-19997  fltname → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   24271-24272  *label_0286 → core/game.js：Game（函数内部衔接行）
 *   24276-24276  *label_0288 → core/game.js：Game（函数内部衔接行）
 *   25509-25509  cardplayerinit → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   26028-26028  *label_0318 → core/item.js：ItemDB（函数内部衔接行）
 *   26091-26092  *label_0321 → core/item.js：ItemDB（函数内部衔接行）
 *   26148-26149  *label_0324 → core/item.js：ItemDB（函数内部衔接行）
 *   26364-26364  *label_0335 → core/item.js：ItemDB（函数内部衔接行）
 *   29233-29233  *label_0357 → core/item.js：ItemDB（函数内部衔接行）
 *   29863-29864  *label_0397 → core/item.js：ItemDB（函数内部衔接行）
 *   29887-29888  *label_0399 → core/item.js：ItemDB（函数内部衔接行）
 *   29899-29900  *label_0401 → core/item.js：ItemDB（函数内部衔接行）
 *   30197-30197  *label_0405 → core/item.js：ItemDB（函数内部衔接行）
 *   30537-30539  itemname → core/item.js：instanceName（函数内部衔接行）
 *   31284-31285  *label_0408 → core/item.js：ItemDB（函数内部衔接行）
 *   31320-31321  *label_0411 → core/item.js：ItemDB（函数内部衔接行）
 *   31401-31410  item_stack → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   31521-31522  *label_0417 → core/item.js：ItemDB（函数内部衔接行）
 *   31663-31666  goneutral → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   31687-31688  *label_0436 → core/item.js：ItemDB（函数内部衔接行）
 *   31811-31817  modrank → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   32232-32232  *label_0450 → core/item.js：ItemDB（函数内部衔接行）
 *   32262-32263  *label_0454 → core/item.js：ItemDB（函数内部衔接行）
 *   32309-32310  *label_0457 → core/item.js：ItemDB（函数内部衔接行）
 *   32368-32370  *label_0462 → core/item.js：ItemDB（函数内部衔接行）
 *   32571-32571  breath_list → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   38463-38463  *label_0596 → core/textutil.js：TextUtil（函数内部衔接行）
 *   192907-192907  *label_1945 → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   192940-192941  *label_1949 → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   193506-193508  modimp2 → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   193823-193825  check_quest → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   194037-194039  refreshspeed → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   194126-194127  *label_1977 → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   194216-194226  *label_1983 → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   194574-194575  *label_1996 → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   195723-195724  fuel → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   196305-196315  healmp → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   196629-196630  *label_2025 → core/game.js：Game（函数内部衔接行）
 *   196673-196674  *label_2028 → core/game.js：Game（函数内部衔接行）
 *   197459-197460  *label_2038 → core/game.js：Game（函数内部衔接行）
 *   199070-199070  dmghp → core/battle.js：applyDamage（函数内部衔接行）
 *   201389-201390  *label_2046 → core/game.js：Game（函数内部衔接行）
 *   201442-201450  dmgsp → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   201459-201468  dmgsptalk → core/game.js：Game（所属模块整体承接）（函数内部衔接行）
 *   201510-201511  *label_2054 → core/game.js：Game（函数内部衔接行）
 *   201524-201525  *label_2056 → core/game.js：Game（函数内部衔接行）
 *   211714-211715  *label_2140 → core/stats.js：Stats（函数内部衔接行）
 *   211718-211718  *label_2142 → core/stats.js：Stats（函数内部衔接行）
 *   211958-211958  *label_2145 → core/stats.js：Stats（函数内部衔接行）
 *   212232-212234  calcattackhit → core/battle.js：calcAttackHit（函数内部衔接行）
 *   212255-212260  calcattackhit → core/battle.js：calcAttackHit（函数内部衔接行）
 *   212266-212268  calcattackhit → core/battle.js：calcAttackHit（函数内部衔接行）
 *   212911-212918  calcattackdmg → core/battle.js：calcAttackDmg（函数内部衔接行）
 *   212966-212966  calcattackdmg → core/battle.js：calcAttackDmg（函数内部衔接行）
 *   212972-212972  calcattackdmg → core/battle.js：calcAttackDmg（函数内部衔接行）
 *   213051-213060  calcattackdmg → core/battle.js：calcAttackDmg（函数内部衔接行）
 *   213106-213115  calcattackdmg → core/battle.js：calcAttackDmg（函数内部衔接行）
 *   213275-213276  calcattackdmg → core/battle.js：calcAttackDmg（函数内部衔接行）
 *   340675-340675  *label_2973 → core/actions.js：Actions（函数内部衔接行）
 *   340765-340771  *label_2973 → core/actions.js：Actions（函数内部衔接行）
 *   342521-342526  *label_2982 → core/actions.js：Actions（函数内部衔接行）
 *   343502-343503  *label_2991 → core/source_anchors.js：groundCollide（函数内部衔接行）
 *   344906-344909  *label_2998 → core/actions.js：Actions（函数内部衔接行）
 *   426670-426679  *label_3073 → core/dialogue.js：Dialogue（函数内部衔接行）
 *   589914-589914  *label_4273 → core/equipment.js：Equipment（函数内部衔接行）
 *   589936-589936  *label_4273 → core/equipment.js：Equipment（函数内部衔接行）
 *   590706-590706  *label_4285 → core/equipment.js：Equipment（函数内部衔接行）
 *   590774-590774  *label_4286 → core/equipment.js：Equipment（函数内部衔接行）
 *   591344-591353  *label_4292 → core/arena.js：Elona.Arena（函数内部衔接行）
 *   591357-591367  *label_4292 → core/arena.js：Elona.Arena（函数内部衔接行）
 *   602303-602309  *label_4348 → core/scene.js：Elona.Scene（函数内部衔接行）
 *   603022-603023  *label_4349 → core/scene.js：Elona.Scene（函数内部衔接行）
 *   603031-603031  *label_4349 → core/scene.js：Elona.Scene（函数内部衔接行）
 *   603037-603044  *label_4349 → core/scene.js：Elona.Scene（函数内部衔接行）
 *   603158-603161  *label_4350 → core/game.js：endTurn / advanceHours（函数内部衔接行）
 *   603934-603942  *label_4352 → core/game.js：endTurn / advanceHours（函数内部衔接行）
 *   604588-604589  *label_4356 → core/game.js：endTurn / advanceHours（函数内部衔接行）
 *   605494-605499  *label_4363 → core/game.js：endTurn / advanceHours（函数内部衔接行）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const ROWS = [{"a":1181,"b":1186,"seg":"calcbuff","js":"core/buff.js","fn":"Elona.BuffEffects"},{"a":1191,"b":1199,"seg":"calcbuff","js":"core/buff.js","fn":"Elona.BuffEffects"},{"a":1275,"b":1275,"seg":"calcbuff","js":"core/buff.js","fn":"Elona.BuffEffects"},{"a":11943,"b":11949,"seg":"limitmax","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":12474,"b":12474,"seg":"mapname","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":13746,"b":13747,"seg":"*label_0227","js":"core/game.js","fn":"Game"},{"a":19997,"b":19997,"seg":"fltname","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":24271,"b":24272,"seg":"*label_0286","js":"core/game.js","fn":"Game"},{"a":24276,"b":24276,"seg":"*label_0288","js":"core/game.js","fn":"Game"},{"a":25509,"b":25509,"seg":"cardplayerinit","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":26028,"b":26028,"seg":"*label_0318","js":"core/item.js","fn":"ItemDB"},{"a":26091,"b":26092,"seg":"*label_0321","js":"core/item.js","fn":"ItemDB"},{"a":26148,"b":26149,"seg":"*label_0324","js":"core/item.js","fn":"ItemDB"},{"a":26364,"b":26364,"seg":"*label_0335","js":"core/item.js","fn":"ItemDB"},{"a":29233,"b":29233,"seg":"*label_0357","js":"core/item.js","fn":"ItemDB"},{"a":29863,"b":29864,"seg":"*label_0397","js":"core/item.js","fn":"ItemDB"},{"a":29887,"b":29888,"seg":"*label_0399","js":"core/item.js","fn":"ItemDB"},{"a":29899,"b":29900,"seg":"*label_0401","js":"core/item.js","fn":"ItemDB"},{"a":30197,"b":30197,"seg":"*label_0405","js":"core/item.js","fn":"ItemDB"},{"a":30537,"b":30539,"seg":"itemname","js":"core/item.js","fn":"instanceName"},{"a":31284,"b":31285,"seg":"*label_0408","js":"core/item.js","fn":"ItemDB"},{"a":31320,"b":31321,"seg":"*label_0411","js":"core/item.js","fn":"ItemDB"},{"a":31401,"b":31410,"seg":"item_stack","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":31521,"b":31522,"seg":"*label_0417","js":"core/item.js","fn":"ItemDB"},{"a":31663,"b":31666,"seg":"goneutral","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":31687,"b":31688,"seg":"*label_0436","js":"core/item.js","fn":"ItemDB"},{"a":31811,"b":31817,"seg":"modrank","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":32232,"b":32232,"seg":"*label_0450","js":"core/item.js","fn":"ItemDB"},{"a":32262,"b":32263,"seg":"*label_0454","js":"core/item.js","fn":"ItemDB"},{"a":32309,"b":32310,"seg":"*label_0457","js":"core/item.js","fn":"ItemDB"},{"a":32368,"b":32370,"seg":"*label_0462","js":"core/item.js","fn":"ItemDB"},{"a":32571,"b":32571,"seg":"breath_list","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":38463,"b":38463,"seg":"*label_0596","js":"core/textutil.js","fn":"TextUtil"},{"a":192907,"b":192907,"seg":"*label_1945","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":192940,"b":192941,"seg":"*label_1949","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":193506,"b":193508,"seg":"modimp2","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":193823,"b":193825,"seg":"check_quest","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":194037,"b":194039,"seg":"refreshspeed","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":194126,"b":194127,"seg":"*label_1977","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":194216,"b":194226,"seg":"*label_1983","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":194574,"b":194575,"seg":"*label_1996","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":195723,"b":195724,"seg":"fuel","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":196305,"b":196315,"seg":"healmp","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":196629,"b":196630,"seg":"*label_2025","js":"core/game.js","fn":"Game"},{"a":196673,"b":196674,"seg":"*label_2028","js":"core/game.js","fn":"Game"},{"a":197459,"b":197460,"seg":"*label_2038","js":"core/game.js","fn":"Game"},{"a":199070,"b":199070,"seg":"dmghp","js":"core/battle.js","fn":"applyDamage"},{"a":201389,"b":201390,"seg":"*label_2046","js":"core/game.js","fn":"Game"},{"a":201442,"b":201450,"seg":"dmgsp","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":201459,"b":201468,"seg":"dmgsptalk","js":"core/game.js","fn":"Game（所属模块整体承接）"},{"a":201510,"b":201511,"seg":"*label_2054","js":"core/game.js","fn":"Game"},{"a":201524,"b":201525,"seg":"*label_2056","js":"core/game.js","fn":"Game"},{"a":211714,"b":211715,"seg":"*label_2140","js":"core/stats.js","fn":"Stats"},{"a":211718,"b":211718,"seg":"*label_2142","js":"core/stats.js","fn":"Stats"},{"a":211958,"b":211958,"seg":"*label_2145","js":"core/stats.js","fn":"Stats"},{"a":212232,"b":212234,"seg":"calcattackhit","js":"core/battle.js","fn":"calcAttackHit"},{"a":212255,"b":212260,"seg":"calcattackhit","js":"core/battle.js","fn":"calcAttackHit"},{"a":212266,"b":212268,"seg":"calcattackhit","js":"core/battle.js","fn":"calcAttackHit"},{"a":212911,"b":212918,"seg":"calcattackdmg","js":"core/battle.js","fn":"calcAttackDmg"},{"a":212966,"b":212966,"seg":"calcattackdmg","js":"core/battle.js","fn":"calcAttackDmg"},{"a":212972,"b":212972,"seg":"calcattackdmg","js":"core/battle.js","fn":"calcAttackDmg"},{"a":213051,"b":213060,"seg":"calcattackdmg","js":"core/battle.js","fn":"calcAttackDmg"},{"a":213106,"b":213115,"seg":"calcattackdmg","js":"core/battle.js","fn":"calcAttackDmg"},{"a":213275,"b":213276,"seg":"calcattackdmg","js":"core/battle.js","fn":"calcAttackDmg"},{"a":340675,"b":340675,"seg":"*label_2973","js":"core/actions.js","fn":"Actions"},{"a":340765,"b":340771,"seg":"*label_2973","js":"core/actions.js","fn":"Actions"},{"a":342521,"b":342526,"seg":"*label_2982","js":"core/actions.js","fn":"Actions"},{"a":343502,"b":343503,"seg":"*label_2991","js":"core/source_anchors.js","fn":"groundCollide"},{"a":344906,"b":344909,"seg":"*label_2998","js":"core/actions.js","fn":"Actions"},{"a":426670,"b":426679,"seg":"*label_3073","js":"core/dialogue.js","fn":"Dialogue"},{"a":589914,"b":589914,"seg":"*label_4273","js":"core/equipment.js","fn":"Equipment"},{"a":589936,"b":589936,"seg":"*label_4273","js":"core/equipment.js","fn":"Equipment"},{"a":590706,"b":590706,"seg":"*label_4285","js":"core/equipment.js","fn":"Equipment"},{"a":590774,"b":590774,"seg":"*label_4286","js":"core/equipment.js","fn":"Equipment"},{"a":591344,"b":591353,"seg":"*label_4292","js":"core/arena.js","fn":"Elona.Arena"},{"a":591357,"b":591367,"seg":"*label_4292","js":"core/arena.js","fn":"Elona.Arena"},{"a":602303,"b":602309,"seg":"*label_4348","js":"core/scene.js","fn":"Elona.Scene"},{"a":603022,"b":603023,"seg":"*label_4349","js":"core/scene.js","fn":"Elona.Scene"},{"a":603031,"b":603031,"seg":"*label_4349","js":"core/scene.js","fn":"Elona.Scene"},{"a":603037,"b":603044,"seg":"*label_4349","js":"core/scene.js","fn":"Elona.Scene"},{"a":603158,"b":603161,"seg":"*label_4350","js":"core/game.js","fn":"endTurn / advanceHours"},{"a":603934,"b":603942,"seg":"*label_4352","js":"core/game.js","fn":"endTurn / advanceHours"},{"a":604588,"b":604589,"seg":"*label_4356","js":"core/game.js","fn":"endTurn / advanceHours"},{"a":605494,"b":605499,"seg":"*label_4363","js":"core/game.js","fn":"endTurn / advanceHours"}];
  function lookup(n) {
    const i = n | 0;
    return ROWS.find((r) => r.a <= i && i <= r.b) || null;
  }
  Elona.SourceFragments = {
    lookup, all: () => ROWS.slice(), count: () => ROWS.length,
    lines: () => ROWS.reduce((s, r) => s + r.b - r.a + 1, 0),
    modules: () => Array.from(new Set(ROWS.map((r) => r.js))).sort(),
  };
})(window);
