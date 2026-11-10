'use strict';
/**
 * 0-GX 收口：源码→实现映射索引（core/source_anchors.js）
 * 数据源 web/data/tables/source_anchors.json，由 tools/extract_source_anchors.py
 * 逐行校验 hsp/start.hsp（cp932）后编译产出；IIFE 模块 Elona.SourceAnchors。
 * 浏览器走 Elona.Data.tableSync('source_anchors')，node 测试可注入
 * Elona.SourceAnchorsData；两者都缺时使用本文件内置的完整索引。
 *
 * 【(a) 已实现映射的源码区间逐条登记（hsp/start.hsp 行号）】
 *  37434-38156    role → core/battle.js::role  掷骰 role/rolemax 与角色定位，battle.js 导出 role
 *  198611-199003  dmghp → core/battle.js::applyDamage  dmghp 扣血主逻辑，applyDamage 逐分支落地
 *  0628-1019      calcbuff → core/buff.js::Elona.BuffEffects  calcbuff 成长率与 buff ops，BuffEffects.apply 承接
 *  30566-30923    itemname → core/item.js::instanceName  itemname 名称前后缀拼装，ItemDB.instanceName 承接
 *  199232-199518  dmghp → core/battle.js::applyDamage  dmghp 斗志与致死结算，applyDamage 尾部
 *  194831-195108  delbuff → core/status.js::delbuff  delbuff 清空槽位并把后续槽位整体前移
 *  196829-197033  check_kill → core/battle.js::onDeath  击杀与死亡结算，onDeath 派发同伴与掉落
 *  1332-1517      calcbuff → core/buff.js::Elona.BuffEffects  calcbuff 后段 ops，随 BuffEffects 规则表
 *  1521-1705      calcbuff → core/buff.js::Elona.BuffEffects  calcbuff 末段，随 BuffEffects 规则表
 *  29428-29603    itemlist/label_0370 → core/game.js::groundItems  itemlist 一族物品遍历，groundItems 数组承接
 *  30315-30457    itemname → core/item.js::instanceName  itemname 定义段，物品名拼装入口
 *  192751-192888  fixaiact → core/ai.js::Elona.AI  AI 行动槽修正，随 npcTurn/castBranch 决策链
 *  193158-193284  customtalk → core/event.js::Elona.Event  customtalk 之后的 findchara 族，event.js 承接
 *  194680-194797  addbuff → core/status.js::addbuff  addbuff 写入 buff 槽与持续回合
 *  12479-12586    txtskillchange → core/stats.js::Elona.Stats  属性变化文案，随 Stats 成长播报模块承接
 *  201763-201869  chara_morasi → core/potion.js::morasi  失禁尾部与 gain_iden 段，随 morasi 结算
 *  194438-194533  hostileaction → core/intimacy.js::hostileAction  敌对行动的表情/嫌弃/karma 近似
 *  345623-345709  label_3005 → core/source_anchors.js::strongestElementSkill  按最大元素属性选法术，本模块实现
 *  29313-29398    item_find → core/game.js::groundItems  item_find 地面与背包扫描，groundItems 遍历承接
 *  213139-213216  calcattackdmg → core/battle.js::calcAttackDmg  伤害计算骰与护甲减伤
 *  591261-591335  label_4291 → core/arena.js::Elona.Arena  竞技场胜利名声结算，Arena 模块承接
 *  1204-1271      calcbuff → core/buff.js::Elona.BuffEffects  calcbuff 中段，随 BuffEffects 规则表
 *  212366-212432  calcattackhit → core/battle.js::calcAttackHit  命中计算与骑乘/回避修正
 *  1113-1173      calcbuff → core/buff.js::Elona.BuffEffects  calcbuff 子区间，随 BuffEffects 规则表
 *  195601-195660  label_2015 → core/monster.js::Elona.CharaFactory  animeload 与 label_2174 怪物生成，CharaFactory 承接
 *  30476-30533    itemname → core/item.js::instanceName  itemname 子区间，同一名称拼装流程
 *  194613-194667  incognitoend → core/chara.js::Elona.Chara  变装结束与 cell_setchara/removechara，Chara 对象模型承接
 *  199011-199064  dmghp → core/battle.js::applyDamage  dmghp 中子区间，同一扣血流程
 *  602929-602980  label_4349 → core/scene.js::Elona.Scene  场景变量初始化与 gosub 2644，Scene 模块承接
 *  194257-194306  get_freeallyne → core/companion.js::Elona.Companion  同伴空位扫描与 del_chara，Companion 模块承接
 *  199081-199130  dmghp → core/battle.js::applyDamage  dmghp 中子区间，斗志结算前置
 *  1282-1324      calcbuff → core/buff.js::Elona.BuffEffects  calcbuff 子区间，随 BuffEffects 规则表
 *  1060-1101      calcbuff → core/buff.js::Elona.BuffEffects  calcbuff 子区间，随 BuffEffects 规则表
 *  201547-201588  modweight → core/feat.js::applyWeight  负重修正 modweight，Feat.applyWeight 承接
 *  201321-201360  dmghp → core/battle.js::applyDamage  dmghp 受击音效与 cbit(19) 分支
 *  213009-213048  calcattackdmg → core/battle.js::calcAttackDmg  伤害计算子区间，护甲与回避量
 *  29255-29293    inv_getheader → core/game.js::groundItems  背包与地面扫描衔接，groundItems 遍历承接
 *  31721-31759    sin_reduction → core/economy.js::Elona.Economy  罪与声望结算文案，Economy 模块承接
 *  604801-604839  rowactend → core/game.js::Elona.Game  rowactend 行动收尾，Game 回合循环承接
 *  0265-0302      cbit → core/status.js::cbit  cbit/cbitmod 位标志读写，Status.cbit 承接
 *  591432-591468  label_4292 → core/arena.js::Elona.Arena  区域制压结算，Arena 模块承接
 *  0376-0407      title_table → core/titletext.js::Elona.TitleText  称号文本表（市长/村长/司祭），TitleText 承接
 *  1025-1056      calcbuff → core/buff.js::Elona.BuffEffects  calcbuff 子区间，随 BuffEffects 规则表
 *  343453-343483  label_2991 → core/source_anchors.js::groundCollide  移动与碰撞段前置，本模块实现
 *  29611-29640    removeitem → core/game.js::groundItems  removeitem/item_copy，groundItems 数组承接
 *  32413-32440    cell_movechara → core/map.js::Elona.GameMap  角色格子移动，GameMap 承接
 *  36247-36274    cell_itemlist → core/mapfeat.js::Elona.MapFeat  地面物品列扫描，MapFeat 承接
 *  213246-213272  calcattackdmg → core/battle.js::calcAttackDmg  伤害计算子区间，倍率结算
 *  0309-0334      refrace → core/racename.js::Elona.RaceName  refrace/ranktitle 种族称号，RaceName 承接
 *  212291-212315  calcattackhit → core/battle.js::calcAttackHit  命中计算子区间
 *  194540-194562  rowact_item → core/actions.js::Elona.Actions  rowact_item 行动行，Actions 模块承接
 *  29648-29669    item_delete → core/game.js::groundItems  item_delete/inv_getspace/inv_sum 槽管理
 *  602905-602925  label_4348 → core/scene.js::Elona.Scene  场景变量初始化，Scene 模块承接
 *  213353-213372  cnvbonus → core/battle.js::calcAttackDmg  伤害加成换算 cnvbonus
 *  11958-11976    maplevel → core/mapids.js::Elona.MapIds  地图层级名 maplevel，MapIds 承接
 *  196276-196294  healhp → core/status.js::Elona.Status  healhp 回血，Status 模块承接
 *  342331-342348  pickup_fx → core/game.js::groundItems  拾取音效与文案，groundItems/pickupAt 承接
 *  30173-30188    itemname_grown → core/item.js::instanceName  itemname grown 前缀，instanceName 承接
 *  343312-343327  label_2991 → core/source_anchors.js::groundCollide  移动前处理，随 groundCollide 规则表
 *  25814-25828    csvsort → core/smallfns.js::Elona.SmallFns  csvsort CSV 解析工具，SmallFns 模块承接
 *  29910-29921    itemowner → core/game.js::groundItems  itemowner 物品归属，groundItems 承接
 *  31548-31559    rndshuffle → core/rng.js::Elona.RNG  rndshuffle 随机洗牌，RNG 模块承接
 *  194150-194161  turn_aggro → core/ai.js::Elona.AI  turn_aggro 仇恨轮转，AI 模块承接
 *  343508-343586  label_2991 → core/source_anchors.js::groundCollide  地面效果结算，本模块实现
 *
 * 【两个新缺口的规则表】见 RULES.strongestElement（345623-345709）与
 *   RULES.groundCollide（343508-343586），对应 strongestElementSkill(c) 与
 *   groundCollide(g, c, ctx) 两个 API。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  // ---- 内置映射索引（模块本体，可脱离注入直接查询） ----
  // 每条: [起, 止, HSP段名, JS文件, 函数/模块名, 一句话理由]
  const ANCHORS = [
    [37434, 38156, 'role', 'core/battle.js', 'role', '掷骰 role/rolemax 与角色定位，battle.js 导出 role'],
    [198611, 199003, 'dmghp', 'core/battle.js', 'applyDamage', 'dmghp 扣血主逻辑，applyDamage 逐分支落地'],
    [628, 1019, 'calcbuff', 'core/buff.js', 'Elona.BuffEffects', 'calcbuff 成长率与 buff ops，BuffEffects.apply 承接'],
    [30566, 30923, 'itemname', 'core/item.js', 'instanceName', 'itemname 名称前后缀拼装，ItemDB.instanceName 承接'],
    [199232, 199518, 'dmghp', 'core/battle.js', 'applyDamage', 'dmghp 斗志与致死结算，applyDamage 尾部'],
    [194831, 195108, 'delbuff', 'core/status.js', 'delbuff', 'delbuff 清空槽位并把后续槽位整体前移'],
    [196829, 197033, 'check_kill', 'core/battle.js', 'onDeath', '击杀与死亡结算，onDeath 派发同伴与掉落'],
    [1332, 1517, 'calcbuff', 'core/buff.js', 'Elona.BuffEffects', 'calcbuff 后段 ops，随 BuffEffects 规则表'],
    [1521, 1705, 'calcbuff', 'core/buff.js', 'Elona.BuffEffects', 'calcbuff 末段，随 BuffEffects 规则表'],
    [29428, 29603, 'itemlist/label_0370', 'core/game.js', 'groundItems', 'itemlist 一族物品遍历，groundItems 数组承接'],
    [30315, 30457, 'itemname', 'core/item.js', 'instanceName', 'itemname 定义段，物品名拼装入口'],
    [192751, 192888, 'fixaiact', 'core/ai.js', 'Elona.AI', 'AI 行动槽修正，随 npcTurn/castBranch 决策链'],
    [193158, 193284, 'customtalk', 'core/event.js', 'Elona.Event', 'customtalk 之后的 findchara 族，event.js 承接'],
    [194680, 194797, 'addbuff', 'core/status.js', 'addbuff', 'addbuff 写入 buff 槽与持续回合'],
    [12479, 12586, 'txtskillchange', 'core/stats.js', 'Elona.Stats', '属性变化文案，随 Stats 成长播报模块承接'],
    [201763, 201869, 'chara_morasi', 'core/potion.js', 'morasi', '失禁尾部与 gain_iden 段，随 morasi 结算'],
    [194438, 194533, 'hostileaction', 'core/intimacy.js', 'hostileAction', '敌对行动的表情/嫌弃/karma 近似'],
    [345623, 345709, 'label_3005', 'core/source_anchors.js', 'strongestElementSkill', '按最大元素属性选法术，本模块实现'],
    [29313, 29398, 'item_find', 'core/game.js', 'groundItems', 'item_find 地面与背包扫描，groundItems 遍历承接'],
    [213139, 213216, 'calcattackdmg', 'core/battle.js', 'calcAttackDmg', '伤害计算骰与护甲减伤'],
    [591261, 591335, 'label_4291', 'core/arena.js', 'Elona.Arena', '竞技场胜利名声结算，Arena 模块承接'],
    [1204, 1271, 'calcbuff', 'core/buff.js', 'Elona.BuffEffects', 'calcbuff 中段，随 BuffEffects 规则表'],
    [212366, 212432, 'calcattackhit', 'core/battle.js', 'calcAttackHit', '命中计算与骑乘/回避修正'],
    [1113, 1173, 'calcbuff', 'core/buff.js', 'Elona.BuffEffects', 'calcbuff 子区间，随 BuffEffects 规则表'],
    [195601, 195660, 'label_2015', 'core/monster.js', 'Elona.CharaFactory', 'animeload 与 label_2174 怪物生成，CharaFactory 承接'],
    [30476, 30533, 'itemname', 'core/item.js', 'instanceName', 'itemname 子区间，同一名称拼装流程'],
    [194613, 194667, 'incognitoend', 'core/chara.js', 'Elona.Chara', '变装结束与 cell_setchara/removechara，Chara 对象模型承接'],
    [199011, 199064, 'dmghp', 'core/battle.js', 'applyDamage', 'dmghp 中子区间，同一扣血流程'],
    [602929, 602980, 'label_4349', 'core/scene.js', 'Elona.Scene', '场景变量初始化与 gosub 2644，Scene 模块承接'],
    [194257, 194306, 'get_freeallyne', 'core/companion.js', 'Elona.Companion', '同伴空位扫描与 del_chara，Companion 模块承接'],
    [199081, 199130, 'dmghp', 'core/battle.js', 'applyDamage', 'dmghp 中子区间，斗志结算前置'],
    [1282, 1324, 'calcbuff', 'core/buff.js', 'Elona.BuffEffects', 'calcbuff 子区间，随 BuffEffects 规则表'],
    [1060, 1101, 'calcbuff', 'core/buff.js', 'Elona.BuffEffects', 'calcbuff 子区间，随 BuffEffects 规则表'],
    [201547, 201588, 'modweight', 'core/feat.js', 'applyWeight', '负重修正 modweight，Feat.applyWeight 承接'],
    [201321, 201360, 'dmghp', 'core/battle.js', 'applyDamage', 'dmghp 受击音效与 cbit(19) 分支'],
    [213009, 213048, 'calcattackdmg', 'core/battle.js', 'calcAttackDmg', '伤害计算子区间，护甲与回避量'],
    [29255, 29293, 'inv_getheader', 'core/game.js', 'groundItems', '背包与地面扫描衔接，groundItems 遍历承接'],
    [31721, 31759, 'sin_reduction', 'core/economy.js', 'Elona.Economy', '罪与声望结算文案，Economy 模块承接'],
    [604801, 604839, 'rowactend', 'core/game.js', 'Elona.Game', 'rowactend 行动收尾，Game 回合循环承接'],
    [265, 302, 'cbit', 'core/status.js', 'cbit', 'cbit/cbitmod 位标志读写，Status.cbit 承接'],
    [591432, 591468, 'label_4292', 'core/arena.js', 'Elona.Arena', '区域制压结算，Arena 模块承接'],
    [376, 407, 'title_table', 'core/titletext.js', 'Elona.TitleText', '称号文本表（市长/村长/司祭），TitleText 承接'],
    [1025, 1056, 'calcbuff', 'core/buff.js', 'Elona.BuffEffects', 'calcbuff 子区间，随 BuffEffects 规则表'],
    [343453, 343483, 'label_2991', 'core/source_anchors.js', 'groundCollide', '移动与碰撞段前置，本模块实现'],
    [29611, 29640, 'removeitem', 'core/game.js', 'groundItems', 'removeitem/item_copy，groundItems 数组承接'],
    [32413, 32440, 'cell_movechara', 'core/map.js', 'Elona.GameMap', '角色格子移动，GameMap 承接'],
    [36247, 36274, 'cell_itemlist', 'core/mapfeat.js', 'Elona.MapFeat', '地面物品列扫描，MapFeat 承接'],
    [213246, 213272, 'calcattackdmg', 'core/battle.js', 'calcAttackDmg', '伤害计算子区间，倍率结算'],
    [309, 334, 'refrace', 'core/racename.js', 'Elona.RaceName', 'refrace/ranktitle 种族称号，RaceName 承接'],
    [212291, 212315, 'calcattackhit', 'core/battle.js', 'calcAttackHit', '命中计算子区间'],
    [194540, 194562, 'rowact_item', 'core/actions.js', 'Elona.Actions', 'rowact_item 行动行，Actions 模块承接'],
    [29648, 29669, 'item_delete', 'core/game.js', 'groundItems', 'item_delete/inv_getspace/inv_sum 槽管理'],
    [602905, 602925, 'label_4348', 'core/scene.js', 'Elona.Scene', '场景变量初始化，Scene 模块承接'],
    [213353, 213372, 'cnvbonus', 'core/battle.js', 'calcAttackDmg', '伤害加成换算 cnvbonus'],
    [11958, 11976, 'maplevel', 'core/mapids.js', 'Elona.MapIds', '地图层级名 maplevel，MapIds 承接'],
    [196276, 196294, 'healhp', 'core/status.js', 'Elona.Status', 'healhp 回血，Status 模块承接'],
    [342331, 342348, 'pickup_fx', 'core/game.js', 'groundItems', '拾取音效与文案，groundItems/pickupAt 承接'],
    [30173, 30188, 'itemname_grown', 'core/item.js', 'instanceName', 'itemname grown 前缀，instanceName 承接'],
    [343312, 343327, 'label_2991', 'core/source_anchors.js', 'groundCollide', '移动前处理，随 groundCollide 规则表'],
    [25814, 25828, 'csvsort', 'core/smallfns.js', 'Elona.SmallFns', 'csvsort CSV 解析工具，SmallFns 模块承接'],
    [29910, 29921, 'itemowner', 'core/game.js', 'groundItems', 'itemowner 物品归属，groundItems 承接'],
    [31548, 31559, 'rndshuffle', 'core/rng.js', 'Elona.RNG', 'rndshuffle 随机洗牌，RNG 模块承接'],
    [194150, 194161, 'turn_aggro', 'core/ai.js', 'Elona.AI', 'turn_aggro 仇恨轮转，AI 模块承接'],
    [343508, 343586, 'label_2991', 'core/source_anchors.js', 'groundCollide', '地面效果结算，本模块实现'],
  ];

  // 每条: [起, 止, HSP段名]
  const BYDESIGN = [
    [197521, 197973, 'txteledmg'],
    [201948, 202344, 'net_send/net_read'],
    [600574, 600763, 'cnvjkey'],
    [37139, 37311, 'window2'],
    [23618, 23784, 'label_0282'],
    [36923, 37076, 'display_customkey'],
    [605200, 605328, 'label_4360'],
    [602136, 602247, 'label_4343'],
    [31563, 31653, 'winposy'],
    [177, 259, 'netload'],
    [425380, 425447, 'label_3068'],
    [202768, 202818, 'label_2087/2088'],
    [31436, 31473, 'colorres'],
    [202999, 203033, 'label_2100/2101'],
    [425453, 425483, 'label_3071'],
    [365578, 365606, 'label_3029/3030'],
    [602103, 602118, 'label_4342'],
  ];

  const RULES = {
    strongestElement: {
      source: '345623-345709',
      label: '*label_3005',
      bit: 1016,
      defaultSkill: 414,
      scan: [[50, 485], [51, 486], [52, 487], [53, 418], [54, 488],
        [55, 489], [56, 415], [57, 490], [58, 416], [59, 417]],
      attr60: 60,
      id60: 414,
      overrideSlot: 414,
      override: { 1: 485, 2: 486, 3: 487, 4: 418, 5: 488, 6: 489,
        7: 415, 8: 490, 9: 416, 10: 417, 11: 414 },
      resultVar: 'var_396',
      castLabel: '*label_2950',
    },
    groundCollide: {
      source: '343508-343586',
      label: '*label_2991',
      featSlot: 6,
      mefSlot: 8,
      tileSlot: 0,
      feat: { trapdoor: 21, pot: 30 },
      mef: { cobweb: 1, typeField: 0, hpField: 5 },
      tile: { waterType: 3, waterSub: 5, wetTurns: 20 },
      cobweb: { checkBase: 25, attrStr: 10, attrDex: 12, hpMul: 3, hpDiv: 4 },
      spiderRace: 'spider',
      labels: { trapdoor: '*label_3003', pot: '*label_2987', abort: '*label_4358' },
    },
  };

  function normAnchor(a) {
    if (Array.isArray(a)) {
      return { start: a[0], end: a[1], range: a[0] + '-' + a[1],
        hsp: a[2], js: a[3], fn: a[4], why: a[5] || '' };
    }
    return { start: a.start, end: a.end,
      range: a.range || (a.start + '-' + a.end),
      hsp: a.hsp, js: a.js, fn: a.fn, why: a.why || '' };
  }
  function normDesign(d) {
    if (Array.isArray(d)) {
      return { start: d[0], end: d[1], range: d[0] + '-' + d[1],
        hsp: d[2], reason: d[3] || '' };
    }
    return { start: d.start, end: d.end,
      range: d.range || (d.start + '-' + d.end),
      hsp: d.hsp, reason: d.reason || '' };
  }
  function normRules(r) {
    return r && r.strongestElement && r.groundCollide ? r : RULES;
  }

  /** 取数据：注入 > Data.tableSync > 内置（每次读取，便于测试切换注入） */
  function data() {
    let doc = null;
    if (Elona.SourceAnchorsData && Elona.SourceAnchorsData.anchors) {
      doc = Elona.SourceAnchorsData;
    } else if (Elona.Data && Elona.Data.tableSync) {
      try { doc = Elona.Data.tableSync('source_anchors'); } catch (e) { doc = null; }
    }
    if (!doc || !doc.anchors) {
      return {
        anchors: ANCHORS.map(normAnchor),
        byDesign: BYDESIGN.map(normDesign),
        rules: RULES,
      };
    }
    return {
      anchors: (doc.anchors || []).map(normAnchor),
      byDesign: (doc.byDesign || []).map(normDesign),
      rules: normRules(doc.rules),
    };
  }

  /** 行号 → 命中条目（含 a 类与 b 类），闭区间边界 */
  function lookup(line) {
    const n = Number(line);
    if (!Number.isFinite(n)) return null;
    const d = data();
    for (const a of d.anchors) {
      if (n >= a.start && n <= a.end) {
        return { kind: 'anchor', start: a.start, end: a.end, range: a.range,
          hsp: a.hsp, js: a.js, fn: a.fn, why: a.why };
      }
    }
    for (const b of d.byDesign) {
      if (n >= b.start && n <= b.end) {
        return { kind: 'byDesign', start: b.start, end: b.end, range: b.range,
          hsp: b.hsp, reason: b.reason };
      }
    }
    return null;
  }

  function all() { return data().anchors.map(normAnchor); }
  function byDesign() { return data().byDesign.map(normDesign); }

  // ------------------------------------------------------------------ 规则读取
  function num(v, dft) { return v === undefined || v === null ? dft : (v | 0); }

  function read82(c, n) {
    if (!c) return 0;
    if (typeof c.get82 === 'function') return c.get82(n) | 0;
    const arr = c.var82 || c.v82 || c.attrs || c.attr;
    if (Array.isArray(arr)) return arr[n] | 0;
    if (arr && typeof arr === 'object') return arr[n] | 0;
    return 0;
  }
  function read58(c, slot) {
    if (!c) return 0;
    if (typeof c.get58 === 'function') return c.get58(slot) | 0;
    if (c.var58_414 !== undefined) return c.var58_414 | 0;
    const m = c.var58 || c.v58;
    if (Array.isArray(m)) return m[slot] | 0;
    if (m && typeof m === 'object') return m[slot] | 0;
    return 0;
  }
  function hasElementBit(c, bit) {
    if (c && typeof c.hasBit === 'function') return !!c.hasBit(bit);
    if (c && c.bit1016 !== undefined) return !!c.bit1016;
    return true;
  }

  /**
   * *label_3005（345623-345709）：cbit(1016) 角色按 var_82(50..60) 最大属性选元素法术，
   * var_58(414) 的 1..11 覆写表最后生效，结果写入 var_396 并 gosub *label_2950。
   * 返回选中的法术 id（var_2539 / var_396）。
   */
  function strongestElementSkill(c) {
    const R = data().rules.strongestElement;
    if (!hasElementBit(c, R.bit)) return 0;
    let max = read82(c, R.attr60);
    let id = R.defaultSkill;
    for (const pair of R.scan) {
      const v = read82(c, pair[0]);
      if (v > max) { max = v; id = pair[1]; }
    }
    if (read82(c, R.attr60) >= max) id = R.id60;
    const ov = read58(c, R.overrideSlot);
    if (ov >= 1 && ov <= 11) id = R.override[String(ov)];
    return id;
  }

  /**
   * *label_2991（343508-343586）：移动/碰撞后的地面效果。
   * 旧格 var_704(...,6) 的 var_503(1) 判定 21/30，当前格 var_704(...,8) 的
   * 蛛网 mef、挣脱检定、耐久 3/4 衰减，以及水地块（3/5）的湿身。
   * g 提供 cell/rng/log/delMef/setMefHp/wet，ctx 可覆盖坐标与格子数据。
   */
  function groundCollide(g, c, ctx) {
    g = g || {}; c = c || {}; ctx = ctx || {};
    const R = data().rules.groundCollide;
    const x = num(ctx.x, num(c.x, 0));
    const y = num(ctx.y, num(c.y, 0));
    const oldX = num(ctx.oldX, num(c.oldX, x));
    const oldY = num(ctx.oldY, num(c.oldY, y));
    const out = {
      x: x, y: y, oldX: oldX, oldY: oldY,
      events: [], messages: [], aborted: false,
      pot: false, trapdoor: false, wet: false, wetTurns: 0,
      cobweb: null, mefIndex: -1,
      mefHpBefore: 0, mefHpAfter: 0, mefRemoved: false,
    };

    function cell(slot, cx, cy) {
      if (ctx.cell) return ctx.cell(slot, cx, cy) | 0;
      if (g.cell) return g.cell(cx, cy, slot) | 0;
      return 0;
    }
    function feat1(cx, cy) {
      if (ctx.feat1 !== undefined) return ctx.feat1 | 0;
      if (g.feat1) return g.feat1(cx, cy) | 0;
      return 0;
    }
    function mefType(i) {
      if (ctx.mefType !== undefined) return ctx.mefType | 0;
      if (g.mefType) return g.mefType(i) | 0;
      const m = (g.mef && g.mef[i]) || (ctx.mef && ctx.mef[i]);
      return m ? (m.type | 0) : 0;
    }
    function mefHp(i) {
      if (ctx.mefHp !== undefined) return ctx.mefHp | 0;
      if (g.mefHp) return g.mefHp(i) | 0;
      const m = (g.mef && g.mef[i]) || (ctx.mef && ctx.mef[i]);
      return m ? (m.hp | 0) : 0;
    }
    function rnd(n) {
      if (ctx.rnd) return ctx.rnd(n) | 0;
      if (g.rng && g.rng.rnd) return g.rng.rnd(n) | 0;
      return Math.floor(Math.random() * ((n | 0) || 1));
    }
    function log(msg) {
      if (!msg) return;
      out.messages.push(msg);
      if (g.log) g.log(msg);
    }

    // 旧格特征：cell_featread 后 var_503(1) == 21 / 30
    if (cell(R.featSlot, oldX, oldY) !== 0) {
      const f1 = feat1(oldX, oldY);
      if (f1 === R.feat.trapdoor) {
        out.trapdoor = true;
        out.events.push({ kind: 'trapdoor', label: R.labels.trapdoor, x: oldX, y: oldY });
      }
      if (f1 === R.feat.pot) {
        out.pot = true;
        out.events.push({ kind: 'pot', label: R.labels.pot, x: oldX, y: oldY });
      }
    }

    // 当前格 mef 槽 8：蛛网（var_490(0,idx) == 1）
    const m = cell(R.mefSlot, x, y);
    if (m !== 0) {
      const idx = m - 1;
      out.mefIndex = idx;
      if (mefType(idx) === R.mef.cobweb) {
        const hp = mefHp(idx);
        out.mefHpBefore = hp;
        out.mefHpAfter = hp;
        const race = ctx.race !== undefined ? ctx.race : (c.race || (g.raceOf ? g.raceOf(c) : ''));
        const isSpider = String(race) === R.spiderRace;
        const cb = { present: true, isSpider: isSpider, hpBefore: hp,
          hpAfter: hp, checkLeft: 0, checkRight: 0, shook: false, removed: false };
        if (!isSpider) {
          const left = rnd(hp + R.cobweb.checkBase);
          const right = rnd(read82(c, R.cobweb.attrStr) + read82(c, R.cobweb.attrDex) + 1);
          cb.checkLeft = left;
          cb.checkRight = right;
          if (left < right) {
            cb.shook = true;
            cb.removed = true;
            out.mefRemoved = true;
            if (g.delmef) g.delmef(idx);
            out.events.push({ kind: 'cobweb-shook', mefIndex: idx });
            log('振り払った');
          } else {
            const after = Math.floor(hp * R.cobweb.hpMul / R.cobweb.hpDiv);
            cb.hpAfter = after;
            out.mefHpAfter = after;
            if (g.setMefHp) g.setMefHp(idx, after);
            out.aborted = true;
            out.events.push({ kind: 'cobweb-caught', mefIndex: idx, hpAfter: after,
              label: R.labels.abort });
            log('ひっかかった');
          }
        } else {
          out.events.push({ kind: 'cobweb-skip-spider', mefIndex: idx });
        }
        out.cobweb = cb;
      }
    }

    // 当前格水地块：var_593(0,tile)==3 && var_593(1,tile)==5 → wet 20
    const tileId = cell(R.tileSlot, x, y);
    const tType = ctx.tileType !== undefined ? (ctx.tileType | 0)
      : (g.tileType ? g.tileType(tileId) | 0 : 0);
    const tSub = ctx.tileSub !== undefined ? (ctx.tileSub | 0)
      : (g.tileSub ? g.tileSub(tileId) | 0 : 0);
    if (tType === R.tile.waterType && tSub === R.tile.waterSub) {
      out.wet = true;
      out.wetTurns = R.tile.wetTurns;
      if (g.wet) g.wet(c, R.tile.wetTurns);
      out.events.push({ kind: 'water', tileId: tileId, turns: R.tile.wetTurns });
    }
    return out;
  }

  const SourceAnchors = {
    lookup: lookup,
    all: all,
    byDesign: byDesign,
    strongestElementSkill: strongestElementSkill,
    groundCollide: groundCollide,
    rules: function () { return data().rules; },
    _internals: { ANCHORS: ANCHORS, BYDESIGN: BYDESIGN, RULES: RULES, data: data },
  };
  Elona.SourceAnchors = SourceAnchors;
  if (typeof module !== 'undefined' && module.exports) module.exports = SourceAnchors;
})(typeof window !== 'undefined' ? window : global);
