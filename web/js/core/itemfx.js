'use strict';
/**
 * 物品「使用效果」分派（core/itemfx.js）—— `*label_3016`（348748 起的 16k 行）
 *
 * 【源码结构】
 *   349962  var_1302 = var_99(19, var_579)      // 19 = 效果类别
 *   349966  起 147 个 `if ( var_1302 == N | var_1303 ) { … }`
 *           —— `var_1303` 是反编译残留的恒 0 变量（`var_1303 = 0` 与 `var_1303++`
 *           都在 `goto` 之后，永远执行不到），所以这串 if 等价于 switch(case)。
 *   每个分支结束于 `goto *label_3017`（364789：`gosub *label_2225` 收尾）
 *   或 `goto *label_4363`（直接回主循环，不再做行动收尾）。
 *
 * 【effect 是怎么挂到物品上的】
 *   物品创建表 `*label_1934`（38464 起，约 13 万行）里逐个硬编码：
 *     `if ( var_60 == 1332 ) { … var_99(19, var_579) = 155 … }`
 *   共 226 个物品、147 种效果。映射见 `web/data/tables/itemfx.json`。
 *
 * 【分工】
 *   药水 / 卷轴 / 食物 / 法杖 / 乐器 / 钓竿 / 床 / 载具 / 产权书 / 深渊书 …
 *   已经在 `game.useItem()` 里各有专门分支，本模块**只补它没覆盖的**：
 *   家具就座（44）等「物件交互」类效果。
 *
 *   `describe(it)` 给兜底提示用：物品有已知效果但本模块未实现时，
 *   返回准确的中文说明，替代原来的「什么也没有发生」。
 *
 * 【已实现】
 *   44 坐具（13 件：round chair / sofa / throne / wooden horse / 座布団 …）
 *      350001  在背包里（inv_getowner != -1）→ 「床に置かないと使えない」
 *      350013  「あなたは〈X〉に座った」→ 菜单
 *      350015-350028  菜单项按 f[25] 动态生成：
 *                      くつろぐ(0) / マイチェア(1) / お客用(2) / 誰でも(3)
 *      350031-350067  选择结果：0 只提示、1/2/0 写回 f[25]
 *      ※ 原版「くつろぐ」只出一句提示，不改变任何数值（350036-350040），
 *        这里逐字照做，不擅自加回复效果。
 *
 *   61 人偶 / 小魔像（4 件：Cleaning Doll / small stone·wooden golem / bisque doll）
 *      356896  get_freeally() 没有空槽 → 「何も起きない…」
 *      356905  使用者是同伴（1..15）→ 同样无事发生
 *      356938  characreate 56, 525/682/683/972, -3, 0
 *      356962  var_581 = 56 → *label_4274 入队（队伍满则 vanquish）
 *
 *   74 书架（6 种 id）
 *      356067  世界地图上禁止
 *      356076  按 id 写 `var_99(9)` 内容编号 → 打开容器窗口
 *
 *   90 烟 / 烟管（5 件：tobacco / cigarette / hamaki / tobacco pipe / kiseru）
 *      352814  世界地图上直接返回；352862 NPC 不能吸
 *      352886  加烟瘾(f[442]) + buff 43 + 士气 + 属性锻炼；1043 是「嚼」分支
 *      352976  香烟(1044) 留下烟蒂 1048
 *
 *   93 调味料（4 件：salt / sugar / pepper / soy sauce）
 *      354589  对自己或友好目标 → 放弃
 *      354649  对蜗牛 → 融化
 *
 *   8 / 15 / 19 / 44 / 52 / 58 / 61 / 74 / 90 / 91 / 93 / 108 / 114 / 116 / 137
 *   这 15 种已实现；58 进化宝石的 167 条规则表落在 `core/evolution.js`，
 *   15 烹饪的算法落在 `core/cook.js`（品质公式 + make_dish + 附魔）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 效果类别（var_99(19)）—— 只列已实现的 */
  const E = {
    BOARD: 8,
    DRESS: 19,
    SIT: 44,
    WHIP: 52,
    DOLL: 61,
    AWAKE_ORB: 67,      // 0-FA ★《觉醒之宝玉》931，359885-359918
    SHELF: 74,
    FEAST_BASKET: 75,   // 0-EY 大型野餐篮（992），356325-356370
    XMAS_CAKE: 100,     // 0-EY 圣诞蛋糕套餐（1106），356280-356324
    NECROMANTIS: 91,
    SMOKE: 90,
    SEASON: 93,
    YACA: 108,
    DESK: 114,
    MIMIKAKI: 116,
    PARTS: 137,
    EVOLVE: 58,
    COOK: 15,
    BOTTLE: 115,
    KUMIROMI: 41,
    SNOW: 14,       // 雪：5 个堆一个雪人（353904-353926）
    REPEL: 102,     // 驱兽药片：回避遇敌计数 = 100（356279-356295）
    CORK: 135,      // 软木塞包：+100 药水瓶塞（351241-351256）
    XFRAME: 138,    // X框架：二次改造（357364-357430）
    // ---- 0-EP：「誰が使用する？」效果本体（core/itemfx_use.js 实现） ----
    STETHOSCOPE: 5,     // 听诊器 478
    LEASH: 23,          // 绳扣 634
    SANDBAG: 45,        // 沙袋 733
    PHILO_MASK: 59,     // 哲学家面具 877
    BLANK_CARD: 60,     // 空白名片 878
    ASTRAL_PEN: 62,     // 星光笔 900
    SOUL_SPINDLE: 66,   // 灵魂纺锤 930
    INSIGHT_LENS: 72,   // 洞察透镜 980
    BODY_FORMER: 73,    // 异形身体 990
    SHIFT_CORE: 77,     // 形态核心 999-1003
    AMMO_BOX: 80,       // 弹药箱 1022
    FIRST_AID: 81,      // 急救包 1023
    ELEMENT_EYES: 85,   // 元素之眼 1037
    BIO_PRINTER: 95,    // 生物打印机 1062
    FIXITY_ANCHOR: 104, // 固定锚 1135
    G_FINGER: 117,      // G指 1209
    BIGAMY: 120,        // 重婚许可证 1206
    LESIMAS: 122,       // 蕾西玛斯碎片 1210
    SOCKS: 125,         // 袜子 1248
    ANERING: 127,       // 安宁剂 1251
    DRUG_KISERU: 128,   // 药烟管 933
    SPIRITIUM: 130,     // 灵质 1255
    SURVIVAL_EX: 132,   // 生存力扩张液 1253
    RES_UPPER: 139,     // 抗性上限 1271
    DV_FIXER: 140,      // DV 修正剂 1270
    PV_FIXER: 141,      // PV 修正剂 1269
    MANA_DESTONE: 142,  // 魔力结晶石 1273
    FIGHT_DESTONE: 143, // 战斗结晶石 1272
    AWAKE_DESTONE: 145, // 清醒结晶石 1274
    FLOAT_CAGE: 146,    // 浮空笼 1295
    MIMIRROCRY: 150,    // 拟态镜 1308
    GENE_MACHINE: 32,   // 0-FK 能力複合機 684（364518-364670，core/genemachine.js）
  };

  /**
   * 0-EP：交给 `core/itemfx_use.js` 的「誰が使用する？」效果（31 个）。
   * 这些效果在原版里**无条件**先 `gosub *label_2893`（邻格箭头），不看锁定目标，
   * 所以不走下面 `TARGET_EFFECTS` + `lockTarget` 那套判断。
   */
  const USE_EFFECTS = [
    5, 23, 45, 59, 60, 62, 66, 72, 73, 77, 80, 81, 85, 95, 104, 117,
    120, 122, 125, 127, 128, 130, 132, 139, 140, 141, 142, 143, 145, 146, 150,
  ];

  /** 改造/二次改造的 6 种机能名（372560-372590 的菜单 + 357364 的 X 形态） */
  const POTI_MODE = ['', '旋转之脚', '威猛膀臂', '双核', '高速服务器', '头部狙击', '迷乱飞驰'];

  /**
   * 原版会用 `*label_2893` 先问「誰に使用する？」的效果号（350569-359482）。
   * 这些效果在进入本体之前都会 `gosub *label_2893` 取 `var_244`（相邻一格的角色）。
   */
  const TARGET_EFFECTS = [
    5, 19, 23, 45, 52, 58, 59, 60, 62, 66, 72, 73, 77, 80, 81, 85,
    90, 93, 95, 104, 116, 117, 120, 122, 125, 127, 128, 130, 132, 137,
    139, 140, 141, 142, 143, 145, 146, 150,
  ];
  /** 本项目**已经实现**、且需要先选目标的效果（其余效果还没实现，不拦） */
  const IMPLEMENTED_TARGET_EFFECTS = [19, 58, 90, 93, 116, 137];
  /**
   * 允许「对自己使用」的效果：原版里准星按 Esc（`stat == 0`）时 `var_244` 保持 0，
   * 也就是「对自己」。本项目用回车/5 表达这个语义（Esc 仍是取消）。
   */
  const SELF_EFFECTS = [19, 116, 137];


  /** 原版时间戳（var_99(9) 的冷却用）：时 + 日*24 + 月*720 + 年*8640 */
  function clockStamp(g) {
    if (!g || !g.getV65) return 0;
    const h = g.getV65(13) | 0, d = g.getV65(12) | 0;
    const mo = g.getV65(11) | 0, y = g.getV65(10) | 0;
    return h + d * 24 + mo * 24 * 30 + y * 24 * 30 * 12;
  }

  /**
   * 当前锁定目标 —— 优先用 Aim 的锁定（`var_58(29)` / 地面锁定），
   * 退回旧的 `g.manualTarget`。许多物品效果（梳妆台 / 调味料 / 进化 / 发射器）
   * 在原版里都是「没有锁定就弹准星」（`gosub *label_2836`），这里就是那一步的结果。
   */
  function lockTarget(g) {
    if (Elona.Aim) {
      const t = Elona.Aim.target(g);
      if (t && t.chara) return t.chara;
      return null;
    }
    return g.manualTarget || null;
  }

  /** HSP 的 `\`（整数除，向零截断）与 `limit()` */
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

  /** 身体部位名（`var_257`）：1..9 与 `ItemDB.initSlots` 的 CODE 表一致 */
  const PART_NAME = ['', '头', '颈', '背', '体', '手', '指', '腕', '腰', '足'];

  /** 书架类物品 id → 内容编号（`var_99(9)`，356076-356084） */
  const SHELF_SLOT = {
    100: 10,    // potions
    124: 11,    // breads
    773: 12, 318: 12, 151: 12, 78: 12,   // large/old bookshelf / craft book shelf / bookshelf
  };

  /**
   * 人偶 / 魔像 → characreate 的生物 id（356938-356961）
   *   886  Cleaning Doll        → 525
   *   965  small stone golem   → 682
   *   962  small wooden golem  → 683
   *   1127 bisque doll         → 972
   */
  const DOLL_SPECIES = {
    886: 525,
    965: 682,
    962: 683,
    1127: 972,
  };

  /** 使用后不会消耗 MP 的人偶（356913-356919 分支里没有 var_58(55) 的改写） */
  const DOLL_FREE = { 886: true };

  /** 烟类物品 id（352886 / 352956） */
  const TOBACCO = 1043;          // 刻みタバコ：嚼，不加烟瘾
  const CIGARETTE = 1044;        // 紙巻きタバコ：吸完留下烟蒂 1048
  /** 烟类 → 锻炼的属性/技能 id（352916-352927） */
  const SMOKE_SKILL = { 1044: 13, 1045: 12, 1046: 14, 1047: 17 };

  /** 调味料 id → 撒上去的台词（354597-354641） */
  const SEASON_LINE = {
    1053: '你把酱油浇到了{who}的头上。「给我住手……」',
    1052: '你把胡椒撒向了{who}。「啊——嚏！」',
    786:  '你把砂糖撒在了{who}身上。「甜！」',
    785:  '你把盐抹在了{who}身上……{who}一脸茫然。',
  };

  /**
   * ヤカテクト积分兑换（359211-359469）
   *   菜单 0..7（txtsetypoint 8，11504-11540），花费是 `var_65(661)` ヤカポイント。
   *   第 5 参是品质等级（genLevel），`var_99(17) = 0` 表示清掉祝福/诅咒状态。
   */
  const YACA_COST = [0, 100, 300, 500, 1000, 2000, 10000, 50000];
  const YACA_OPTIONS = [
    { value: 0, label: '取消' },
    { value: 1, label: '卡拉维卡握手权（100 点）' },
    { value: 2, label: '柱子套装包（300 点）' },
    { value: 3, label: '墓碑收藏（500 点）' },
    { value: 4, label: '饭团与绿茶一年份（1000 点）' },
    { value: 5, label: '超重量室内套装（2000 点）' },
    { value: 6, label: '固定神器抽奖（10000 点）' },
    { value: 7, label: '精选香草 8 打（50000 点）' },
  ];
  /** 兑换产物：id, 个数, 品质等级（var_638 / itemcreate 第 5 参） */
  const YACA_ITEMS = {
    2: [[276, 1, 2], [277, 1, 2], [278, 1, 2], [593, 1, 2], [586, 1, 2], [595, 1, 2], [139, 1, 2], [138, 1, 2]],
    3: [[170, 1, 0], [169, 1, 0], [168, 1, 0], [167, 1, 0], [166, 1, 0], [166, 1, 0], [165, 1, 0], [164, 1, 0]],
    4: [[812, 360, 360, 1], [1070, 360, 360, 0]],
    5: [[172, 1, 0], [171, 1, 0], [173, 1, 0], [109, 1, 0], [279, 1, 0]],
    7: [[425, 1, 40], [427, 1, 16], [426, 1, 10], [424, 1, 10], [423, 1, 10], [422, 1, 10]],
  };

  /** f[25] 的座位归属（350017-350028 / 350048-350066） */
  const SEAT = { FREE: 0, MINE: 1, GUEST: 2 };

  let DATA = null;

  const ItemFx = {
    E, SEAT,

    /** 效果表（itemfx.json），未加载时为 null */
    get data() { return DATA; },

    async load() {
      if (DATA) return DATA;
      if (Elona.Data && Elona.Data.fetchJson) {
        DATA = await Elona.Data.fetchJson('data/tables/itemfx.json');
      } else {
        const res = await fetch('data/tables/itemfx.json');
        DATA = await res.json();
      }
      return DATA;
    },

    /** 直接注入（测试用） */
    ready(d) { DATA = d || null; return this; },

    /** 物品的效果类别（var_99(19)） */
    effectOf(it) {
      if (!it || !it.f) return 0;
      return it.f[19] | 0;
    },

    /** 该效果是否已经由本模块实现 */
    isImplemented(eff) {
      if (Elona.ItemFxUse && Elona.ItemFxUse.handles(eff)) return true;
      return eff === E.BOARD || eff === E.DESK || eff === E.DRESS
        || eff === E.SIT || eff === E.WHIP || eff === E.DOLL || eff === E.SHELF
        || eff === E.AWAKE_ORB
        || eff === E.NECROMANTIS || eff === E.SMOKE || eff === E.SEASON || eff === E.YACA
        || eff === E.MIMIKAKI || eff === E.PARTS || eff === E.EVOLVE
        || eff === E.COOK || eff === E.BOTTLE || eff === E.KUMIROMI
        || eff === E.SNOW || eff === E.CORK || eff === E.XFRAME || eff === E.REPEL
        || eff === E.FEAST_BASKET || eff === E.XMAS_CAKE || eff === E.GENE_MACHINE;
    },

    /** 该效果的归属模块（'' = 无人实现） */
    ownerOf(eff) {
      const ent = this.entryOf(eff);
      return (ent && ent.owner) || '';
    },

    /** 效果表条目 */
    entryOf(eff) {
      if (!DATA) return null;
      return (DATA.effects && DATA.effects[String(eff)]) || null;
    },

    /**
     * 尝试处理一次「使用」。
     *
     * @param {object} g
     * @param {object} it 物品实例
     * @param {object} [opts] { onGround:boolean }
     * @returns {object|null} null = 本模块不管，交给 useItem 原有分支
     */
    dispatch(g, it, opts) {
      const eff = this.effectOf(it);
      if (!eff) return null;
      const o = opts || {};
      // 0-EP：31 个「誰が使用する？」效果 —— 无条件先走邻格箭头（*label_2893），
      //   由 core/itemfx_use.js 统一处理「目标 / タッグ二选一 / 空目标收尾」。
      if (Elona.ItemFxUse && Elona.ItemFxUse.handles(eff)) {
        return Elona.ItemFxUse.dispatch(g, it, o);
      }
      // 0-EO：原版先用 `*label_2893` 选一个**相邻的角色**（「誰に使用する？」），
      //   再进效果本体（350569-359482 共 40 余处）。没有目标也没有锁定时，
      //   先要一次方向（UI 收到 need-direction 后开八方向箭头）。
      //   世界地图上没有角色层，交给各效果自己报「不能在这里用」。
      const onWorld = !!(g && (g.worldMap
        || (g.map && g.map.header && (g.map.header[6] | 0) === 1)));
      if (!o.target && !lockTarget(g) && !onWorld
          && TARGET_EFFECTS.indexOf(eff) >= 0
          && IMPLEMENTED_TARGET_EFFECTS.indexOf(eff) >= 0) {
        return { ok: false, effect: eff, reason: 'need-direction',
          allowSelf: SELF_EFFECTS.indexOf(eff) >= 0 };
      }
      switch (eff) {
        case E.BOARD: return this.boardUse(g, it, o);
        case E.DESK: return this.deskUse(g, it, o);
        case E.DRESS: return this.dressUse(g, it, o);
        case E.SIT: return this.sitStart(g, it, o);
        case E.WHIP: return this.whipUse(g, it, o);
        case E.DOLL: return this.dollUse(g, it, o);
        case E.SHELF: return this.shelfStart(g, it, o);
        // 0-FA：★《觉醒之宝玉》（效果 67）—— 把附近的随机地城变成觉醒地城
        case E.AWAKE_ORB:
          return Elona.RandDungeon ? Elona.RandDungeon.awakenOrb(g)
            : { ok: false, effect: eff, reason: 'no-module' };
        // 0-EY：野餐篮 / 圣诞蛋糕（效果号由 create.v99_19 写入物品实例）
        case E.FEAST_BASKET:
        case E.XMAS_CAKE:
          return Elona.FoodLeft ? Elona.FoodLeft.feast(g, it, eff) : null;
        case E.NECROMANTIS: return this.necromantisUse(g, it, o);
        case E.SMOKE: return this.smokeUse(g, it, o);
        case E.SEASON: return this.seasonUse(g, it, o);
        case E.YACA: return this.yacaUse(g, it, o);
        case E.MIMIKAKI: return this.mimikakiUse(g, it, o);
        case E.PARTS: return this.partsUse(g, it, o);
        case E.EVOLVE: return this.evolveUse(g, it, o);
        case E.COOK: return this.cookUse(g, it, o);
        case E.BOTTLE: return this.bottleUse(g, it, o);
        case E.KUMIROMI: return this.kumiromiUse(g, it, o);
        case E.SNOW: return this.snowUse(g, it, o);
        case E.REPEL: return this.repelUse(g, it, o);
        case E.CORK: return this.corkUse(g, it, o);
        case E.XFRAME: return this.xframeUse(g, it, o);
        default: return null;
      }
    },

    // ==================================================================
    // 8 留言板 / 登记簿（register / house board / operating board，350459-350568）
    // ==================================================================
    /**
     * 两种情形：
     *   350461  `var_65(20) == 80 & var_65(22) == 70` —— 事务所的**打工登记簿**，
     *           菜单 8 项对应行动 26/27/28（各 100 / 500 回合），选项 6 是整理文件的彩蛋
     *           （`var_2385` 第 3/5/6/9/10 次各有一句台词）。
     *           → 打工走 rowact 26/27/28，本项目没有这套行动，**阻塞**（准确提示，不假装能用）。
     *   350553  其它情况只能在**自宅**（`var_126(6) == 5`）使用，否则「这里不能用」；
     *           自宅里 `goto *label_2435`（232969）—— 家产清单：
     *           「<地图名>里有 N 件道具和 M 件家具（上限 X 个）」+ 各地产的一行摘要。
     */
    boardUse(g, it, opts) {
      const o = opts || {};
      const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
      const sub = g.getV65 ? (g.getV65(22) | 0) : 0;
      // 0-FP：レジスター 562 摆在自家店里 → 收款机菜单（233240-233265）。
      // 原版 350553 的「只能在自宅」判定在这里被 233240 的店铺分支覆盖。
      const regSite = (Elona.Property && Elona.Property.currentSite)
        ? Elona.Property.currentSite(g) : null;
      const itId = it ? ((it.id !== undefined ? (it.id | 0) : (it.f[3] | 0))) : 0;
      if (regSite && (regSite.type | 0) === 102 && itId === 562) {
        return {
          ok: true, effect: E.BOARD, action: 'shop-register',
          siteId: regSite.id | 0, message: '收款机。',
        };
      }
      // 350461：事务所 —— 0-GB 起打开 txtsetwork 8 的打工菜单（不再阻塞）
      if (mapId === 80 && sub === 70) {
        const W = Elona.Work;
        if (!W) return { ok: false, effect: E.BOARD, reason: 'no-work-module' };
        g.log('这是事务所的打工登记簿。');
        return {
          ok: true, effect: E.BOARD, action: 'work-menu', request: 'work-menu',
          options: W.menu(), message: '要选择哪项工作？',
        };
      }
      // 350553：只能在自宅
      const mt = (g.map && g.map.header && (g.map.header[6] | 0)) || 0;
      if (!(Elona.Home && Elona.Home.inHome(g)) && mt !== 5) {
        const msg = '这里不能用。';
        g.log(msg);
        return { ok: false, effect: E.BOARD, reason: 'not-home', message: msg };
      }
      // 0-FS：自宅 → 233240-233300 的菜单（装修 / 家の情報 / 滞在 / 使用人募集 / 外装…）
      if (Elona.Home && Elona.Home.inHome(g)) {
        const head = Elona.Home.inventoryHead(g);
        g.log(head);
        return {
          ok: true, effect: E.BOARD, action: 'home-board',
          head, lines: [head], menu: Elona.Home.menu(g), message: head,
        };
      }
      // 232986-233002：家产清单
      let items = 0, furn = 0;
      for (const g2 of (g.groundItems || [])) {
        if (!g2 || (g2.f[0] | 0) <= 0) continue;
        if (Elona.ItemDB && (Elona.ItemDB.ref(g2.id, 5) | 0) === 60000) furn++;
        else items++;
      }
      const cap = (g.map && g.map.header && (g.map.header[18] | 0)) || 0;
      const mapName = (g.map && g.map.name) || '自家';
      const head = `${mapName}里有 ${items} 件道具和 ${furn} 件家具`
        + (cap ? `（道具上限 ${cap} 个）` : '') + '。';
      g.log(head);
      // 233026 起：已建地产的一行摘要
      const lines = [head];
      if (Elona.Property && Elona.Property.list) {
        const sites = Elona.Property.list(g) || [];
        if (sites.length) {
          const names = sites.map((s) => (s.jp || s.name || ('建筑#' + (s.type | 0))));
          lines.push(`保有建筑 ${sites.length} 处：${names.join('、')}`);
        }
      }
      g.log(lines[lines.length - 1]);
      return { ok: true, effect: E.BOARD, action: 'board', lines, message: head };
    },

    // ==================================================================
    // 19 梳妆台（dresser，350569-350620）
    // ==================================================================
    /**
     * 「给谁化妆？」→ 准星选人 → `*label_2809`（295248）**隐藏身体部位**面板。
     *
     * 350598  `if ( var_244 < 16 )` —— 只能对玩家/同伴用；NPC（>= 16）最后落到「不可能」。
     * 350582  目标被载（`var_58(168)`）时会先问「也对骑手用？」—— 需二次确认窗口，未接。
     *
     * 面板本身是 6 项（Done / Chest / Leg / Belt / Glove / Mantle），
     * 开关量写在 `var_508(20..24)`：**0 = 显示，1 = 隐藏**（23863/24008/24032/24054/24075/24121
     * 都是 `== 0` 才绘制）。本项目把它存在 `c.pcc[20..24]`，由 `PCC.compose` 跳过对应层。
     */
    dressUse(g, it, opts) {
      const o = opts || {};
      const c = o.target || g.player;
      if (!c) return null;
      if ((c.index | 0) >= 16) {
        const msg = '不可能。';
        g.log(msg);
        return { ok: false, effect: E.DRESS, reason: 'npc', message: msg };
      }
      const P = Elona.PCC;
      if (!P || !P.HIDE_PARTS) {
        const msg = '现在无法整理外观。';
        g.log(msg);
        return { ok: false, effect: E.DRESS, reason: 'no-pcc', message: msg };
      }
      const nm = c.name || '你';
      g.log(`你替${nm}整理了一下装扮。`);
      return { ok: true, effect: E.DRESS, action: 'dressup', target: c,
        parts: P.HIDE_PARTS, state: P.hideState(c) };
    },

    /** 面板里切换一项（295346-295351） */
    dressToggle(g, c, key) {
      const P = Elona.PCC;
      if (!P || !P.setHide) return { ok: false, reason: 'no-pcc' };
      const st = P.hideState(c);
      const next = !st[key];
      P.setHide(c, key, next);
      const part = (P.HIDE_PARTS || []).find((p) => p.key === key);
      const label = part ? part.jp : key;
      const msg = next ? `${label}的显示已关闭。` : `${label}恢复显示。`;
      g.log(msg);
      return { ok: true, key, hidden: next, message: msg };
    },

    // ==================================================================
    // 114 写作台 / 书桌（350072-350458）
    // ==================================================================
    /**
     * 350074  必须在脚下（`inv_getowner(var_579) != -1` → 「要放在地上才能使用」）
     * 350092  菜单 4 项：取消 / 稿件生产 / 自费出版 / 法术书转换
     * 具体执行在 `core/writing.js`（稿件是 rowact 25，出版与法术书转换是一次性结算）。
     */
    deskUse(g, it, opts) {
      const o = opts || {};
      if (!o.onGround) {
        const msg = '要放在地上才能使用。';
        g.log(msg);
        return { ok: false, effect: E.DESK, reason: 'not-on-ground', message: msg };
      }
      const W = Elona.Writing;
      if (!W) {
        const msg = '现在无法写作。';
        g.log(msg);
        return { ok: false, effect: E.DESK, reason: 'no-module', message: msg };
      }
      const ins = W.inspiration(g);
      return { ok: true, effect: E.DESK, action: 'writing-desk', item: it,
        inspiration: ins, options: W.deskOptions(g) };
    },

    // ==================================================================
    // 44 坐具（349999-350071）
    // ==================================================================
    /**
     * 坐下 / 设置座位归属。
     * 350001：物品在背包里（`inv_getowner(prm) != -1`）→ 必须先放地上。
     */
    sitStart(g, it, opts) {
      if (!opts.onGround) {
        g.log('要放在地上才能使用。');
        return { ok: false, effect: E.SIT, reason: 'not-on-ground', message: '要放在地上才能使用。' };
      }
      const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : '椅子';
      g.log(`你坐在${name}上。`);
      return {
        ok: true, effect: E.SIT, action: 'sit', item: it,
        options: this.sitOptions(it),
      };
    },

    /** 350015-350028：菜单项按当前 f[25] 过滤 */
    sitOptions(it) {
      const own = it.f[25] | 0;
      const out = [{ value: 0, label: '放松一会儿' }];                    // くつろぐ
      if (own !== SEAT.MINE) out.push({ value: 1, label: '设为我的座位' });
      if (own !== SEAT.GUEST) out.push({ value: 2, label: '设为客人的座位' });
      if (own !== SEAT.FREE) out.push({ value: 3, label: '谁都可以坐' });
      return out;
    },

    /**
     * 结算坐下菜单。
     * @param {number} choice 0=放松 1=我的 2=客人 3=谁都可以
     */
    sitApply(g, it, choice) {
      const v = choice | 0;
      const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : '椅子';
      if (v === 0) {                                   // 350036-350040
        g.log('你尽情地放松了一会儿。');
        return { ok: true, message: '你尽情地放松了一会儿。' };
      }
      if (v === 1) {                                   // 350042-350050
        it.f[25] = SEAT.MINE;
        g.log(`${name}成了你的专用座位。`);
        return { ok: true, seat: SEAT.MINE, message: `${name}成了你的专用座位。` };
      }
      if (v === 2) {                                   // 350051-350059
        it.f[25] = SEAT.GUEST;
        g.log(`${name}成了访客的座位。`);
        return { ok: true, seat: SEAT.GUEST, message: `${name}成了访客的座位。` };
      }
      if (v === 3) {                                   // 350060-350068
        it.f[25] = SEAT.FREE;
        g.log(`${name}成了谁都可以坐的座位。`);
        return { ok: true, seat: SEAT.FREE, message: `${name}成了谁都可以坐的座位。` };
      }
      return { ok: false, reason: 'bad-choice' };
    },

    // ==================================================================
    // 52 調教鞭（355538-355946）
    // ==================================================================
    /**
     * 746 号物品的专用分支在 `game.useItem` 里（先检查附近有没有同伴），
     * 菜单在 `Panels.openTamerWhip`（18 项，对应 `txtsettamer`）。
     * 这里只登记「已实现」，把控制权交回原分支。
     */
    whipUse(g, it, opts) { return null; },

    // ==================================================================
    // 61 人偶 / 小魔像（356894-356966）
    // ==================================================================
    /**
     * 使用人偶 → 以 `characreate` 生成一个生物并收进队伍。
     *
     *   356896  var_1442 = get_freeally()   队伍没有空槽 → 「何も起きない…」
     *   356905  使用者是同伴（var_243 != 0 且 < 16）→ 同样无事发生
     *   356913  Cleaning Doll(886)        → 「它以机械声动了起来……」
     *   356920  small stone/wooden golem  → 「魔像启动了。」+ MP ×0.8
     *   356928  bisque doll(1127)         → 「人偶开始动了起来。」+ MP ×0.8
     *   356936  消耗 1 个
     *   356938-356961  characreate 56, <species>, -3, 0
     *   356962  var_581 = 56 → gosub *label_4274（入队，队伍满则消失）
     *
     * MP 消耗的原文是 `var_58(55,0) = (var_58(55,0)+1)*8/10`，
     * 而 `var_58(55/56)` 在本项目对应 MP / MPMAX（不是 HP），
     * 所以效果是「当前 MP 降到 80%」。
     */
    dollUse(g, it, opts) {
      const o = opts || {};
      const id = it.id | 0;
      const species = DOLL_SPECIES[id];
      if (!species) return null;
      const P = Elona.Party;
      if (!P) return null;

      // 356905-356912：同伴不能替玩家使用
      const ui = o.userIndex | 0;
      if (ui !== 0 && ui < 16) {
        return this._dollNothing(g, 'nothing-user');
      }
      // 356896-356904：没有可用的队伍槽
      const free = P.freeAlly ? P.freeAlly(g) : P.freeSlot(g);
      if (!free) return this._dollNothing(g, 'full');

      // 356913-356935：台词 + MP 消耗
      let line;
      if (id === 886) {
        line = '它以机械声开始动了起来。怎么看都像是机器人。';
      } else if (id === 965 || id === 962) {
        line = '魔像启动了。';
      } else {
        line = '人偶开始动了起来。';
      }
      g.log(line);
      const p = g.player;
      let mpCost = 0;
      if (p && !DOLL_FREE[id]) {
        const before = p.get(55) | 0;
        p.set(55, ((before + 1) * 8 / 10) | 0);
        mpCost = before - (p.get(55) | 0);
      }

      // 356936-356937：消耗 1 个
      it.f[0] = (it.f[0] | 0) - 1;
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);

      // 356938-356961：characreate 56, <species>, -3, 0
      //   原版不指定 var_640（等级），沿用调用前残留值；这里优先取 g.var640，
      //   没有则按玩家等级（地图生成 / 大部分动作都会把 var_640 设成接近玩家等级）。
      const lv = Math.max(1, (g.var640 != null ? (g.var640 | 0) : (p ? (p.get(38) | 0) : 1)) || 1);
      const spot = P.nearSpot ? P.nearSpot(g, p ? p.x : 0, p ? p.y : 0) : { x: p ? p.x : 0, y: p ? p.y : 0 };
      let slot = 56;
      if (g.charas[slot] && (g.charas[slot].get(0) | 0) === 1) {
        // 临时槽被占用时不覆盖活角色，退到 57 起的空槽
        slot = 57;
        while (slot < 245 && g.charas[slot]) slot++;
      }
      let c = null;
      if (Elona.CharaFactory && Elona.CharaFactory.create) {
        try {
          c = Elona.CharaFactory.create(g, species, lv, spot.x, spot.y,
            { index: slot, var641: 2 });
        } catch (e) { c = null; }
      }
      if (!c) {
        return { ok: false, effect: E.DOLL, reason: 'create-failed',
          message: '……但是什么也没有出现。' };
      }
      // 356962-356963：var_581 = 56 → *label_4274
      const join = P.joinChara ? P.joinChara(g, c) : { ok: false, message: '' };
      if (!join.ok) {
        return { ok: false, effect: E.DOLL, reason: join.reason || 'join-failed',
          message: join.message, line, mpCost };
      }
      g.log(join.message);
      // 使用道具消耗一回合
      if (g.endTurn) g.endTurn();
      return { ok: true, effect: E.DOLL, action: 'summon',
        chara: c, slot: join.slot, line, mpCost, message: join.message };
    },

    /** 356897-356903 / 356905-356911：「什么也没有发生……」 */
    _dollNothing(g, reason) {
      const msg = '什么也没有发生……';
      g.log(msg);
      return { ok: false, effect: E.DOLL, reason, message: msg };
    },

    // ==================================================================
    // 74 书架 / 书堆（356065-356088）
    // ==================================================================
    /**
     * 打开书架。
     *   356067  世界地图上不能这么做（`var_126(6) == 1`）
     *   356076  按物品 id 指定内容编号 `var_99(9)`：100→10 / 124→11 / 773·318·151·78→12
     *   356085  `goto *label_2998` —— 打开容器（原版读 `tmp/shop<f9>.s2`）
     * 本项目由 `Container` 把内容物挂在物品实例上，因此这里只做前置判定与槽位写入，
     * 真正的窗口由 `Panels.openContainerPanel()` 打开。
     */
    shelfStart(g, it, o) {
      const onWorld = !!(g && (g.worldMap || (g.map && g.map.header && (g.map.header[6] | 0) === 1)));
      if (onWorld) {
        g.log('在世界地图上不能这样做。');
        return { ok: false, effect: E.SHELF, reason: 'world-map', message: '在世界地图上不能这样做。' };
      }
      const slot = SHELF_SLOT[it.id | 0];
      if (slot) it.f[9] = slot;
      const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : '书架';
      g.log(`你翻看书架《${name}》。`);
      return { ok: true, effect: E.SHELF, action: 'container', item: it };
    },

    // ==================================================================
    // 90 烟 / 烟管（352812-352983）
    // ==================================================================
    /**
     * 吸烟。原作流程是「先选使用者（*label_2104/2893 的准星选人）」，本项目没有
     * 准星选人，因此用 `opts.target` 指定目标，缺省为玩家自己。
     *
     *   352814  世界地图上直接返回（无提示）
     *   352846  使用者正骑着 / 被载（var_58(168)）时原版会再问「也对骑手用？」
     *           —— 需要二次确认窗口，本实现未接（登记在案）
     *   352862  var_244 >= 16（NPC）→ 「不行」
     *   352886  非「刻みタバコ(1043)」：加烟瘾 + buff 43 + 士气 + 技能经验
     *   352956  刻みタバコ：嚼，品质 > 10 时降低烟瘾
     *   352967  烟瘾夹在 0..200
     *   352976  香烟(1044) 留下一根烟蒂 1048
     */
    smokeUse(g, it, opts) {
      const o = opts || {};
      // 352814：世界地图
      const onWorld = !!(g && (g.worldMap || (g.map && g.map.header && (g.map.header[6] | 0) === 1)));
      if (onWorld) {
        return { ok: false, effect: E.SMOKE, reason: 'world-map', message: '' };
      }
      const c = o.target || g.player;
      if (!c) return null;
      const id = it.id | 0;
      const idx = c.index | 0;
      // 352862：NPC 不能吸烟
      if (idx >= 16) {
        g.log('「不行」');
        return { ok: false, effect: E.SMOKE, reason: 'npc', message: '「不行」' };
      }
      const nm = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : '烟';
      const who = c.name || '你';
      // 352875
      const line = `${who}吸了${nm}。`;
      g.log(line);

      const q = it.f[20] | 0;                       // var_99(20) = 品质
      let flavor = '';
      if (id !== TOBACCO) {
        // 352888：烟瘾为 0 → 咳嗽
        const dep0 = c.get(442) | 0;
        flavor = dep0 <= 0 ? '*咳*' : '*呼*';
        g.log(flavor);
        // 352902：addbuff 43，强度 = (10+品质)*器用潜力/2，持续 (10+品质)*20 回合
        const power = Math.floor((10 + q) * ((Elona.Stats ? (Elona.Stats.sorg(c, 13) | 0) : 100)) / 2);
        const turns = (10 + q) * 20;
        if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, c, 43, power, turns);
        // 352903-352908：烟瘾 +20，并播报依赖度
        c.set(442, dep0 + 20);
        const dep1 = c.get(442) | 0;
        const pct = Math.max(1, Math.min(100, Math.floor(dep1 / 2)));
        g.log(`${who}对烟的依赖度是 ${pct}%。`);
        // 352910-352912：士气
        if ((c.get(22) | 0) < 10000) c.set(22, (c.get(22) | 0) + 1000);
        // 352913-352915：玩家专属的两个全局计数
        if (idx === 0 && g.getV65 && g.setV65) {
          const r = (g.rng && g.rng.rnd) ? g.rng.rnd(3) : 0;
          g.setV65(634, (g.getV65(634) | 0) + 3 + r);
          g.setV65(614, (g.getV65(614) | 0) + 1);
        }
        // 352916-352954：锻炼对应属性 + 潜力成长
        const sk = SMOKE_SKILL[id];
        if (sk) {
          const base = idx === 0 ? 10000 : 12000;
          const per = idx === 0 ? 800 : 1000;
          if (Elona.Stats && Elona.Stats.skillExp) {
            Elona.Stats.skillExp(c, sk, idx, base + q * per, 0, 0, g);
          }
          const grow = 50 + Math.max(0, Math.min(150, q * 10));
          if (Elona.Stats && Elona.Stats.modGrowth) Elona.Stats.modGrowth(c, sk, idx, grow, g);
        }
      } else {
        // 352956-352965：嚼烟叶
        flavor = '*嚼*';
        g.log(flavor);
        if (q > 10) c.set(442, (c.get(442) | 0) - (q - 10));
      }
      // 352967-352972：夹在 0..200
      let dep = c.get(442) | 0;
      if (dep > 200) dep = 200;
      if (dep < 0) dep = 0;
      c.set(442, dep);

      // 352973-352974：消耗 1 个
      it.f[0] = (it.f[0] | 0) - 1;
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
      // 352975：gosub *label_2225（行动收尾）
      if (g.endTurn) g.endTurn();

      // 352976-352979：香烟留下烟蒂 1048
      if (id === CIGARETTE) this._spawnAt(g, 1048, c.x | 0, c.y | 0);

      return { ok: true, effect: E.SMOKE, action: 'smoke', target: c,
        line, flavor, addiction: dep, message: line };
    },

    /** itemcreate -1, <id>, x, y, 0 —— 在地面放一件物品 */
    _spawnAt(g, id, x, y) {
      if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
      let it = null;
      try { it = Elona.ItemDB.createItem(id, 1); } catch (e) { it = null; }
      if (!it) return null;
      it.f[5] = x;
      it.f[6] = y;
      it.f[21] = -1;
      if (!Array.isArray(g.groundItems)) g.groundItems = [];
      g.groundItems.push(it);
      if (g.refreshGroundCell) g.refreshGroundCell(x, y);
      return it;
    },

    // ==================================================================
    // 93 调味料（354575-354677）
    // ==================================================================
    /**
     * 把盐 / 糖 / 胡椒 / 酱油撒到别人身上（恶作剧）。
     *   354589  目标是玩家自己或关系 10（友好）→ 「……我改主意了」
     *   354597-354641  四种调味料各自的台词
     *   354643  var_58(177) <= 3 → +1（被捉弄次数）
     *   354649  目标是蜗牛（var_63(2) == "snail"）→ 融化，受到致命伤害
     * 目标取 `opts.target`，否则用项目已有的锁定目标 `g.manualTarget`。
     */
    seasonUse(g, it, opts) {
      const o = opts || {};
      const c = o.target || lockTarget(g) || null;
      const id = it.id | 0;
      if (!SEASON_LINE[id]) return null;
      const noWay = { ok: false, effect: E.SEASON, reason: 'invalid', message: '……还是算了。' };
      // 354586-354596 / 354668-354674
      if (!c || (c.get(0) | 0) !== 1) {
        g.log('不可能。');
        return { ok: false, effect: E.SEASON, reason: 'no-target', message: '不可能。' };
      }
      if ((c.index | 0) === 0 || (c.get(9) | 0) === 10) {
        g.log('……我改主意了。');
        return noWay;
      }
      const who = c.name || '对方';
      const line = SEASON_LINE[id].replace(/\{who\}/g, who);
      g.log(line);
      // 354643-354645
      if ((c.get(177) | 0) <= 3) c.set(177, (c.get(177) | 0) + 1);
      // 354646：消耗 1 个
      it.f[0] = (it.f[0] | 0) - 1;
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
      // 354649-354665：蜗牛遇盐
      let melted = false;
      if ((c.raceName || '') === 'snail') {
        melted = true;
        g.log(`${who}开始融化了！`);
        const hp = c.get(50) | 0;
        const r = (g.rng && g.rng.rnd) ? g.rng.rnd : (n) => Math.floor(Math.random() * n);
        const dmg = hp > 10 ? hp - r(10) : r(20000);
        if (Elona.Battle && Elona.Battle.applyDamage) {
          Elona.Battle.applyDamage(c, dmg, g, g.player, 0);
        } else {
          c.hp = Math.max(0, (c.hp | 0) - dmg);
        }
      }
      return { ok: true, effect: E.SEASON, action: 'season', target: c,
        line, melted, message: line };
    },

    // ==================================================================
    // 108 ヤカテクト积分卡（359211-359469）
    // ==================================================================
    /**
     * 「那是只能在店里或家中使用的东西」（359212）。
     * 判定用 `var_132(16, var_65(20)) == 102`（当前地图是「店」）或地图 7 / 61。
     * 本项目的地产类型存在 `v132`（按槽位），「当前是否在自家店里」用 `Property.currentSite`。
     */
    yacaUse(g, it, opts) {
      const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
      const site = (Elona.Property && Elona.Property.currentSite)
        ? Elona.Property.currentSite(g) : null;
      const inShop = !!(site && (site.type | 0) === 102);
      const isHome = mapId === 7 || mapId === 61;
      if (!inShop && !isHome) {
        const msg = '那是只能在店里或家中使用的东西。';
        g.log(msg);
        return { ok: false, effect: E.YACA, reason: 'not-shop', message: msg };
      }
      const pts = g.getV65 ? (g.getV65(661) | 0) : 0;
      g.log(`「现在攒了 ${pts} ヤカポイント，要怎么办？」`);
      return { ok: true, effect: E.YACA, action: 'yaca', points: pts, options: YACA_OPTIONS };
    },

    /** 108 的菜单项（给面板用） */
    yacaOptions() { return YACA_OPTIONS.slice(); },

    /** 359226-359466：7 种兑换 */
    yacaRedeem(g, value) {
      const v = value | 0;
      if (v <= 0) return { ok: true, effect: E.YACA, cancelled: true };
      const cost = YACA_COST[v] | 0;
      const pts = g.getV65 ? (g.getV65(661) | 0) : 0;
      const no = (msg) => {
        g.log(msg);
        return { ok: false, effect: E.YACA, reason: 'points', message: msg };
      };
      if (!cost || pts < cost) return no('「不够啊。」');
      // 359240-359270：握手权，且 `var_65(662) \ 2 == 1` 时不能叠
      if (v === 1) {
        if (((g.getV65(662) | 0) % 2) === 1) {
          const m = '「权利是不能囤的哦。」';
          g.log(m);
          return { ok: false, effect: E.YACA, reason: 'rights', message: m };
        }
        g.setV65(661, pts - cost);
        g.setV65(662, (g.getV65(662) | 0) + 1);
        const msg = '「以后也请多多关照我家的妹妹！」';
        g.log(msg);
        return { ok: true, effect: E.YACA, kind: 'handshake',
          rights: g.getV65(662) | 0, message: msg };
      }
      g.setV65(661, pts - cost);
      // 359425-359436：固定神器抽奖 → evadd 82
      if (v === 6) {
        g.log('「会出什么呢——？」');
        if (Elona.Event && Elona.Event.add) Elona.Event.add(82, 0, 0);
        return { ok: true, effect: E.YACA, kind: 'lottery', message: '「会出什么呢——？」' };
      }
      // 其余：在脚下生成一批物品
      g.log('有什么东西滚到了脚下。');
      const list = YACA_ITEMS[v] || [];
      const made = [];
      for (const spec of list) {
        const id = spec[0] | 0;
        const n = spec[1] | 0;
        const lv = spec.length > 2 ? (spec[2] | 0) : 0;
        const f20 = spec.length > 3 ? (spec[3] | 0) : null;
        const item = this._spawnAt(g, id, g.player.x | 0, g.player.y | 0);
        if (!item) continue;
        if (n > 0) item.f[0] = n;
        item.genLevel = lv;
        item.f[17] = 0;                      // var_99(17, var_579) = 0
        if (f20 !== null) item.f[20] = f20;
        made.push(item);
      }
      return { ok: true, effect: E.YACA, kind: 'items', items: made,
        spent: cost, message: '有什么东西滚到了脚下。' };
    },

    // ==================================================================
    // 137 死体パーツ / necro parts（357560-357849）
    // ==================================================================
    /**
     * 把「填充了粘菌的尸体部件」贴到目标身上 → **长出一个新的身体部位槽**。
     *   357582-357640  扫描 `var_58(100..129)`（装备部位槽），统计已有部位类型
     *   357645-357760  在第一个空槽写入 `var_99(32) * 10000`（**只有类型、没有物品**）
     *   357790-357800  目标已有同类型部位 → 「既存の部位の影響で、拒絶反応が出て失敗した…」
     *   357800  `gosub *label_2143` 重算 → 357801 消耗 1 个
     * 部位代码（var_257）：1 頭 / 2 首 / 3 背 / 4 体 / 5 手 / 6 指 / 7 腕 / 8 腰 / 9 足
     * —— 与 `ItemDB.initSlots` 的 `CODE` 表一致。
     */
    partsUse(g, it, opts) {
      const o = opts || {};
      const c = o.target || g.player;
      if (!c || (c.get(0) | 0) !== 1) return null;
      const type = it.f[32] | 0;
      if (type < 1 || type > PART_NAME.length - 1) return null;
      const no = (msg) => {
        g.log(msg);
        return { ok: false, effect: E.PARTS, reason: 'impossible', message: msg };
      };
      // 357592：`if ( var_244 >= 16 )` 只对玩家/同伴有效
      if ((c.index | 0) >= 16 || (c.index | 0) === 0 && o.npcOnly) return no('那是不可能的。');
      // 357582-357620：已有部位类型
      const have = [];
      for (let n = 0; n < 30; n++) {
        const v = c.get(100 + n) | 0;
        if (v === 0) break;
        have.push(Math.trunc(v / 10000));
      }
      if (have.indexOf(type) >= 0) {
        // 357790-357797
        const msg = '受既有部位的影响，出现了排斥反应，失败了……';
        g.log(msg);
        return { ok: false, effect: E.PARTS, reason: 'reject', message: msg };
      }
      // 357645-357760：写第一个空槽
      let slot = -1;
      for (let n = 0; n < 30; n++) {
        if ((c.get(100 + n) | 0) !== 0) continue;
        c.set(100 + n, type * 10000);
        slot = n;
        break;
      }
      if (slot < 0) return no('那是不可能的。');
      // 357800：*label_2143（部位变化后重算）
      if (Elona.Mutation && Elona.Mutation.refresh) Elona.Mutation.refresh(c, g);
      // 357801-357802：消耗 1 个
      it.f[0] = (it.f[0] | 0) - 1;
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
      const msg = `${c.name || '你'}获得了新的${PART_NAME[type]}！`;
      g.log(msg);
      return { ok: true, effect: E.PARTS, part: type, slot, target: c, message: msg };
    },

    // ==================================================================
    // 116 如意耳かき（359470-359831）
    // ==================================================================
    /**
     * 「谁来掏耳朵」→ 对目标使用。
     *   359511  目标是同伴（`var_58(17) < 150` 好感）→ 「やんわりと断った」，并重置冷却计数
     *   359527  目标是玩家（`var_244 == 0`）→ 直接进入「被掏」流程
     *   359534  `txtsetmimikaki 3`：取消 / 耳掃除する / 耳掃除してもらう
     *           · 选项 1 → `evadd 90`（由事件系统处理）
     *           · 选项 2 → 进入 5 次判定的小游戏
     *   359644-359670  5 次：`rnd(器用12 + 耐久13 + 筋力11 + 学习15) > rnd(sorg(18) + 10)`
     *                   失败 >= 3 → 耳道破裂（`dmgcon 0, 9, 100`）
     *   359692  `var_2590 = rnd(sqrt(器用12 + 1) + 10)`，分 5 档给经验 5000..9000
     */
    mimikakiUse(g, it, opts) {
      const o = opts || {};
      const c = o.target || g.player;
      if (!c || (c.get(0) | 0) !== 1) return null;
      const stamp = clockStamp(g);
      // 359511-359520：同伴好感不足 → 拒绝，并把「上次使用时间」写回物品
      if ((c.index | 0) !== 0 && (c.get(17) | 0) < 150) {
        it.f[9] = stamp;
        it.f[33] = 0;
        const msg = `${c.name}委婉地拒绝了你。`;
        g.log(msg);
        return { ok: false, effect: E.MIMIKAKI, reason: 'refuse', message: msg };
      }
      // 359527：对自己用 → 直接开始
      if ((c.index | 0) === 0) {
        return this.mimikakiPlay(g, it, c);
      }
      // 359534-359570：三项菜单
      const options = [
        { value: 0, label: '取消' },
        { value: 1, label: '给他掏耳朵' },
        { value: 2, label: '让他给你掏耳朵' },
      ];
      return { ok: true, effect: E.MIMIKAKI, action: 'mimikaki', target: c, options,
        item: it };
    },

    /** 359570-359610 / 359644-359830：菜单结算 */
    mimikakiApply(g, it, target, choice) {
      const c = target || g.player;
      const v = choice | 0;
      if (v === 0) return { ok: true, effect: E.MIMIKAKI, cancelled: true };
      if (v === 1) {
        // 359577：交给事件系统（evadd 90）
        if (Elona.Event && Elona.Event.add) Elona.Event.add(90, c.index | 0, 0);
        g.log(`你开始给${c.name || '对方'}掏耳朵。`);
        return { ok: true, effect: E.MIMIKAKI, kind: 'event90', message: 'event 90' };
      }
      if (v === 2) return this.mimikakiPlay(g, it, c);
      return { ok: false, reason: 'bad-choice' };
    },

    /**
     * 被掏耳朵的小游戏（359644-359830）。
     * 原版用 `await 500` 分 5 段演出；这里一次算完并给出结果。
     */
    mimikakiPlay(g, it, who) {
      const p = g.player;
      const other = (who && (who.index | 0) !== 0) ? who : p;
      const sk = (ch, id) => (ch && typeof ch.skill === 'function' ? (ch.skill(id) | 0) : 0);
      const R = (n) => ((g.rng && g.rng.rnd) ? g.rng.rnd(Math.max(1, n | 0))
        : Math.floor(Math.random() * Math.max(1, n | 0)));
      const atkBase = sk(other, 12) + sk(other, 13) + sk(p, 11) + sk(p, 15);
      const defBase = (Elona.Stats ? (Elona.Stats.sorg(p, 18) | 0) : 10) + 10;
      let okCount = 0, badCount = 0;
      for (let n = 0; n < 5; n++) {
        if (R(atkBase) > R(defBase)) okCount++;
        else badCount++;
      }
      // 359671-359688：失败 3 次以上 → 耳道破裂
      if (badCount >= 3) {
        const msg = '耳挖棒膨胀了，你的耳道破裂了！';
        g.log(msg);
        if (Elona.Spell && Elona.Spell.dmgconOf) Elona.Spell.dmgconOf(g, p, 9, 100);
        return { ok: true, effect: E.MIMIKAKI, kind: 'burst', okCount, badCount, message: msg };
      }
      // 359692-359760：耳垢品质 → 5 档
      const grade = R(Math.trunc(Math.sqrt(sk(other, 12) + 1)) + 10);
      let label = '', exp = 5000;
      if (grade < 5) { label = '掏出了粉末状的耳垢！'; exp = 5000; }
      else if (grade < 15) { label = '掏出了碎片状的耳垢！'; exp = 6000; }
      else if (grade < 20) { label = '掏出了膜状的耳垢！'; exp = 7000; }
      else if (grade < 25) { label = '掏出了一块耳垢！'; exp = 8000; }
      else { label = '掏出了一整条连着的耳垢！'; exp = 9000; }
      g.log(label);
      if (Elona.Stats && Elona.Stats.skillExp) {
        Elona.Stats.skillExp(other, 12, other.index | 0, exp, 0, 0, g);
        Elona.Stats.skillExp(other, 13, other.index | 0, exp, 0, 0, g);
        Elona.Stats.skillExp(p, 11, 0, exp, 0, 0, g);
        Elona.Stats.skillExp(p, 15, 0, exp, 0, 0, g);
      }
      return { ok: true, effect: E.MIMIKAKI, kind: 'clean', okCount, badCount,
        grade, exp, message: label };
    },

    // ==================================================================
    // 91 邪成鎌ネクロマンティス（355215-355537）—— 前端在 necro.js
    // ==================================================================
    /**
     * 真正的融合逻辑已经在 `core/necro.js` 的 `fuse(a, b)` 里（355516-355537），
     * 缺的是原作 355220-355400 的**前端**：4 个配方菜单 + 「已有一只就不能再使役」
     * + 在视野内挑两只素材。这部分补在 `Necro.fuseStart`，这里只做门槛与分派。
     */
    necromantisUse(g, it, opts) {
      const o = opts || {};
      const p = g.player;
      if (!p) return null;
      // 355217：斗志 < 25%
      if ((p.get(182) | 0) < 25) {
        const msg = '什么也没有发生……';
        g.log(msg);
        return { ok: false, effect: E.NECROMANTIS, reason: 'no-power', message: msg };
      }
      const N = Elona.Necro;
      if (!N || !N.fuseStart) {
        const msg = '现在无法进行死者融合。';
        g.log(msg);
        return { ok: false, effect: E.NECROMANTIS, reason: 'no-module', message: msg };
      }
      const opts2 = N.fuseMenu ? N.fuseMenu() : [];
      return { ok: true, effect: E.NECROMANTIS, action: 'necro-fuse', options: opts2 };
    },

    /** 355240-355400：选中配方后真正开融合 */
    necromantisApply(g, choice) {
      const N = Elona.Necro;
      if (!N || !N.fuseStart) return { ok: false, reason: 'no-module' };
      return N.fuseStart(g, choice | 0);
    },

    // ==================================================================
    // 58 进化宝石（360661-364083，3423 行 / 168 条规则）
    // ==================================================================
    /**
     * 用进化宝石（869）对同伴使用 → 按种族+物品 f[25]+进化次数匹配规则 → 进化。
     * 数据在 `evolution.json`，逻辑在 `core/evolution.js`。
     *
     * 360664  `gosub *label_2893` —— 准星选人。这个准星与普通的瞄准不同：
     *         305110-305231 里按**任意方向键即返回 1**，目标就是玩家旁边那一格。
     *         所以原版的表现是「八方向箭头 + 按一下方向键」，本项目交给 `core/dirsel.js`
     *         的 `item` 档（`DirSel.startItem`），没有目标时返回 `need-direction`。
     * 360673  `if ( var_704(...) > 0 )` 取该格角色；空格的教训走 364067「それは無理だ。」
     * 360681  `var_58(168) != 0`（目标正在骑乘）→ 骑乘者/坐骑二选一（返回 `riding`）。
     * 361960  好感 < 150 → 拒绝；361970 变异壳 → 拒绝。
     * 364035  改名 + 改贴图 + skillmod + 斗志下限 + 消耗 + 等级 +1。
     */
    evolveUse(g, it, opts) {
      const o = opts || {};
      const c = o.target || lockTarget(g) || null;
      if (!c) {
        // 没有目标 → 「どの方向？」：UI 层收到后关物品窗并开方向箭头
        return { ok: false, effect: E.EVOLVE, reason: 'need-direction', dirs: true,
          message: '按哪个方向使用？' };
      }
      const idx = c.index | 0;
      if (idx <= 0 || idx >= 16 || (c.get(0) | 0) !== 1) {
        return { ok: false, effect: E.EVOLVE, reason: 'not-ally',
          message: '只能对同伴使用。' };
      }
      // 360681-360703：目标被骑乘着 → 列表窗问「进化骑乘者还是坐骑」
      if ((c.get(168) | 0) !== 0) {
        const mount = (g.charas || [])[c.get(167) | 0] || null;
        return { ok: false, effect: E.EVOLVE, reason: 'riding', target: c, mount,
          message: '要进化哪一个？' };
      }
      const EV = Elona.Evolution;
      if (!EV) {
        const msg = '进化系统未加载。';
        g.log(msg);
        return { ok: false, effect: E.EVOLVE, reason: 'no-module', message: msg };
      }
      const r = EV.evolve(g, it, c);
      if (r && r.ok && g.endTurn) g.endTurn();
      return Object.assign({ effect: E.EVOLVE }, r);
    },

    // ==================================================================
    // 41 クミロミの秘密の経験（物品 715，364099-364126）
    // ==================================================================
    /**
     * 「库米罗米的秘密经验」—— 每次给 1 点天赋点，但受「经验」限制：
     *   364101  `if ( var_65(827) > var_58(38, 0) )` → 「ダメ…経験…足りない…」
     *   364111  `var_65(827) += 10`（每次 +10，因此上限约为 等级/10 + 1 次）
     *   364112  `var_99(0) -= 1`（消耗一个）
     *   364114  `var_65(93)++`（天赋点 +1）
     *
     * 364126 `goto *label_3017`：走正常的「使用物品」收尾（消耗一回合）。
     */
    kumiromiUse(g, it, opts) {
      void opts;
      const p = g.player;
      if (!p) return { ok: false, effect: E.KUMIROMI, reason: 'no-user', message: '没有使用者。' };
      const used = g.getV65 ? (g.getV65(827) | 0) : 0;
      const level = p.get(38) | 0;
      if (used > level) {
        const msg = '库米罗米的声音：「不行……经验……还不够……」';
        g.log(msg);
        return { ok: false, effect: E.KUMIROMI, reason: 'not-enough-exp', message: msg };
      }
      if (g.setV65) {
        g.setV65(827, used + 10);                                  // 364111
        g.setV65(93, (g.getV65(93) | 0) + 1);                      // 364114
      }
      it.f[0] = Math.max(0, (it.f[0] | 0) - 1);                     // 364112
      g.log('库米罗米祝福了你。你现在可以再取得一个新的天赋了！');
      if (g.endTurn) g.endTurn();
      return { ok: true, effect: E.KUMIROMI, points: (g.getV65 ? (g.getV65(93) | 0) : 0) };
    },

    // ==================================================================
    // 15 烹饪器具（353874-353880 → *label_2965 var_1302 == 184 → *label_2303）
    // ==================================================================
    /**
     * 这条分支只有 7 行，看起来像空实现，实际是三层跳转：
     *   353876  `var_396 = 184`（184 = 料理技能）
     *   353877  `gosub *label_2960`（只处理 `var_396 >= 300`，184 直接穿过去）
     *   318380  `*label_2965: var_1302 = var_396` → 于是命中 319868 的 `var_1302 == 184`
     *   319873  `var_486 = 16`（筛选：类别 57000 且 `f[26] == 0`）
     *   319892  `gosub *label_2303`（料理本体）
     * 算法见 `core/cook.js`。
     */
    cookUse(g, it, opts) {
      const o = opts || {};
      const CK = Elona.Cook;
      if (!CK) {
        const msg = '料理系统未加载。';
        g.log(msg);
        return { ok: false, effect: E.COOK, reason: 'no-module', message: msg };
      }
      // 直接指定食材（测试 / 快捷路径）
      if (o.foodIdx !== undefined && o.foodIdx !== null) {
        const r = CK.cook(g, it, o.foodIdx, o);
        if (r.ok && g.endTurn) g.endTurn();
        return Object.assign({ effect: E.COOK }, r);
      }
      const p = g.player;
      const any = !!(p && p.inv && p.inv.some((x) => CK.isIngredient(g, x)));
      if (!any) {
        const msg = '没有可以料理的食材。';
        g.log(msg);
        return { ok: false, effect: E.COOK, reason: 'no-food', message: msg };
      }
      return { ok: true, effect: E.COOK, action: 'cook', tool: it };
    },

    // ==================================================================
    // 14 雪 → 堆雪人（353904-353926）
    // ==================================================================
    /**
     * `t` 对雪是**真正的使用**（不是淋撒）：堆叠数 >= 5 时消耗 5 个，
     * 在脚下生成 541（雪だるま）；不足 5 个 → 「雪が足りない…」。
     */
    snowUse(g, it, o) {
      const p = (o && o.user) || g.player;
      if (!p) return { ok: false, effect: E.SNOW, reason: 'no-user' };
      const n = it.f[0] | 0;
      if (n < 5) {
        const msg = '雪不够……';
        g.log(msg);
        return { ok: false, effect: E.SNOW, reason: 'need-snow', message: msg, need: 5, have: n };
      }
      it.f[0] = n - 5;                                          // removeitem var_579, 5
      if (Elona.ItemDB && Elona.ItemDB.createItem) {
        const sm = Elona.ItemDB.createItem(541, 1, g.rng);
        if (sm) {
          sm.f[5] = p.x | 0; sm.f[6] = p.y | 0; sm.f[21] = -1;
          if (g.groundItems) g.groundItems.push(sm);
          if (g.refreshGroundCell) g.refreshGroundCell(sm.f[5], sm.f[6]);
        }
      }
      const msg = `${p.name || '你'}堆了个雪人！`;
      g.log(msg);
      return { ok: true, effect: E.SNOW, action: 'snowman', used: 5, message: msg };
    },

    // ==================================================================
    // 102 驱兽药片（356279-356295）
    // ==================================================================
    /**
     * `var_65(250 + 375) = 100`（回避遇敌计数，1 点 = 4 英里），消耗 1 个。
     * 台词「<物品名>を周辺に散布した。」；每走一格由 `Game.tickEncounterCancel` 递减。
     */
    repelUse(g, it, o) {
      const name = Elona.ItemDB ? Elona.ItemDB.name(it.id, 'jp') : '驱兽药片';
      if (g.setV65) g.setV65(625, 100);
      it.f[0] = Math.max(0, (it.f[0] | 0) - 1);
      const msg = `把${name}散布在了周围。（剩余 ${100 * 4} 英里）`;
      g.log(msg);
      return { ok: true, effect: E.REPEL, action: 'repel', miles: 400, message: msg };
    },

    // ==================================================================
    // 135 软木塞包（351241-351256）
    // ==================================================================
    /**
     * 打开软木塞包：`var_65(250 + 439) += 100`（药水瓶塞 +100），消耗 1 个。
     * 台词「ポーションの栓を100個手に入れた。[残りN個]」。
     */
    corkUse(g, it, o) {
      let n = 0;
      if (g.getV65 && g.setV65) {
        g.setV65(689, (g.getV65(689) | 0) + 100);
        n = g.getV65(689) | 0;
      }
      it.f[0] = Math.max(0, (it.f[0] | 0) - 1);
      const msg = `获得了 100 个药水瓶塞。[剩余 ${n} 个]`;
      g.log(msg);
      return { ok: true, effect: E.CORK, action: 'cork', plugs: 100, left: n, message: msg };
    },

    // ==================================================================
    // 138 X框架 → 二次改造（357364-357430）
    // ==================================================================
    /**
     * ★X形态 / 「构造改变」：给**已改造过**（f[27] != 0）的瓶塞发射器再叠一项机能，
     * 写入 f[31]（与改造店写入的 f[27]\100 是「任一命中即生效」的叠加关系）。
     *   · 选中的机能与已有改造相同 → 「それは機能が被っている…」
     *   · 成功 → 消耗 1 个 X框架，台词「Xフレームチェンジ！」
     *
     * opts: { potioman, mode }，缺任一项时返回 action='xframe' 让 UI 继续追问。
     */
    xframeUse(g, it, o) {
      const opt = o || {};
      const poti = opt.potioman || null;
      const mode = opt.mode | 0;
      if (!poti) {
        return { ok: false, effect: E.XFRAME, action: 'xframe', step: 'potioman', item: it };
      }
      const cur = (poti.f[27] | 0);
      if (!mode || mode < 1 || mode > 6) {
        return { ok: false, effect: E.XFRAME, action: 'xframe', step: 'mode',
          item: it, potioman: poti, current: idiv(cur, 100) };
      }
      if (idiv(cur, 100) === mode) {
        const msg = '那是重复的机能……。';
        g.log(msg);
        return { ok: false, effect: E.XFRAME, reason: 'same', message: msg };
      }
      poti.f[31] = mode;                                        // 357412
      const nm = POTI_MODE[mode] || ('机能' + mode);
      it.f[0] = Math.max(0, (it.f[0] | 0) - 1);                 // item_separate var_579
      const msg = `X形态变换！【${nm}】`;
      g.log(msg);
      return { ok: true, effect: E.XFRAME, action: 'xframe', mode, potioman: poti, message: msg };
    },

    // ==================================================================
    // 115 药水栓发射器（ポーショマン / potioman，352994-353243）
    // ==================================================================
    /**
     * 物品 1200-1203 是「把药水栓高速射出的器具」，四型：
     *   1200 初期型（威力吃握力）     1201 带护盾型（射完卸力）
     *   1202 同步型（可发射手榴弹）   1203 自我型（充能等级 +1）
     *
     * 【判读（几处容易看错的）】
     *   · `var_99(26)` = 剩余弹量 0..4；为 0 时先装填，一次吃 **4 个栓**
     *   · `var_65(250+439)` = var_65(689)，是**栓的库存计数器**，不是背包物品
     *   · `var_99(27) \ 100` 与 `var_99(31)` 是**两套机能编号 1..6**：
     *       前者由改造店写入（372612），后者由 X-Frame Change 写入（357364）。
     *       两者是「任一命中即生效」的叠加关系，可以同时拥有两种机能。
     *   · `var_99(20)` = Potion-charge 等级（3；1203 是 4），进伤害倍率，
     *       射击后在 353193 归零
     *   · 353088 的 `var_58(179)` 扣的是**使用者**（var_243）不是目标
     *
     * 【没做的】准星选人（用 opts.target / Aim 的锁定目标）、
     * `var_1117` 52-56 的射击演出、`var_1072` 震屏。见差异表 A363。
     */
    bottleUse(g, it, opts) {
      const o = opts || {};
      const user = o.user || g.player || null;
      if (!user) {
        return { ok: false, effect: E.BOTTLE, reason: 'no-user', message: '没有使用者。' };
      }
      const ST = Elona.Stats;
      const sk = (n) => (ST && ST.sorg ? (ST.sorg(user, n) | 0) : (user.skill ? (user.skill(n) | 0) : 0));
      const id = it.f[3] | 0;
      /** 353062 / 353096 / 353157 …：两套机能编号任一命中 */
      const grp = (n) => (idiv(it.f[27] | 0, 100) === n || (it.f[31] | 0) === n);
      const plugs = () => (g.getV65 ? (g.getV65(689) | 0) : 0);
      const uname = user.name || '你';

      // ---- 353000-353022：装填 ----
      if ((it.f[26] | 0) <= 0) {
        if (plugs() < 4) {
          const msg = '药水栓不够……。';
          g.log(msg);
          return { ok: false, effect: E.BOTTLE, reason: 'no-plug', message: msg };
        }
        if (g.setV65) g.setV65(689, plugs() - 4);
        it.f[26] = 4;
        const left = plugs();
        const msg = `${uname}装进了药水栓。[剩余 ${left} 个]`;
        g.log(msg);
        // 353020：只有机能 4（連射）会装完立刻接着射；其余到此为止
        if (!grp(4)) {
          return { ok: true, effect: E.BOTTLE, action: 'reload', left, message: msg };
        }
      }

      // ---- 353024：地图类型 1 不能用（原版无提示，这里是本项目补的一句）----
      const mt = (g.map && g.map.header) ? (g.map.header[6] | 0) : 0;
      if (mt === 1) {
        const msg = '这里不能用。';
        g.log(msg);
        return { ok: false, effect: E.BOTTLE, reason: 'map', message: msg };
      }

      // ---- 353027-353033：锁定目标（原版 `gosub *label_2836` 弹准星）----
      const tgt = o.target || lockTarget(g) || null;
      if (!tgt || (tgt.get(0) | 0) === 0) {
        const msg = '先按 f 锁定一个目标，再使用发射器。';
        g.log(msg);
        return { ok: false, effect: E.BOTTLE, reason: 'no-target', message: msg };
      }

      // ---- 353034：射程 6 格 + 视线 ----
      const d = Math.max(Math.abs((tgt.x | 0) - (user.x | 0)), Math.abs((tgt.y | 0) - (user.y | 0)));
      const los = (Elona.Spell && Elona.Spell.fovLos)
        ? (Elona.Spell.fovLos(g, user.x, user.y, tgt.x, tgt.y) | 0) : 1;
      if (d > 6 || los === 0) {
        const msg = '射程外。';
        g.log(msg);
        return { ok: false, effect: E.BOTTLE, reason: 'out-of-range', message: msg };
      }

      // ---- 353045：对非敌对目标先确认（`*label_2838`，y/n）----
      if ((tgt.get(9) | 0) >= 0 && o.confirm !== true) {
        return {
          ok: false, effect: E.BOTTLE, reason: 'confirm', needConfirm: true, target: tgt,
          message: `真的要攻击${tgt.name}吗？`,
        };
      }

      // ---- 353087：1201 射完卸力（var_58(179) 是装备重量带来的护甲减值）----
      if (id === 1201) user.set(179, (user.get(179) | 0) - 2);

      // ---- 353092-353108：威力 ----
      const R = (g.rng && g.rng.rnd) ? ((n) => (n > 0 ? ((g.rng.rnd(n) | 0) % n) : 0)) : (() => 0);
      const lv = user.get(38) | 0;
      const f20 = it.f[20] | 0;
      const f26 = it.f[26] | 0;
      const v2566 = (id === 1200) ? 1 : 0;
      const core = (sk(10) * (v2566 + 5) / 25 + 5) * ((sk(189) + 1) / 5 + 5);
      const lvPart = (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000))
        * 4 * Math.sqrt(limit(lv, 1, 2000) * 3) + 30 + 1;
      // 机能 5（精密）没有 rnd 项（353097）
      let dmg = grp(5)
        ? core + (sk(16) * 4 + 5) + lvPart * 3 / 4
        : core + R(sk(16) * 4 + 5) + lvPart * 3 / 4;
      dmg = Math.trunc(dmg / 3 * (f20 + 3));                    // 353099
      if (dmg < 10) dmg = 10;                                   // 353100
      if (grp(2)) dmg = Math.trunc(dmg * 11 / 10);              // 353103
      if (grp(3) && f26 >= 2) dmg = Math.trunc(dmg * 9 / 5);    // 353106

      const events = [];
      const dmgcon = (cc, cond, pow) => {
        if (!Elona.Resist || !Elona.Resist.dmgcon || !g.dmgconTable) return;
        try { Elona.Resist.dmgcon(g, g.dmgconTable, cc, cond, pow); } catch (e) { /* 表未加载 */ }
      };
      const castFx = (fxId, power) => {
        const SP = Elona.Spell;
        if (!SP || !SP.dispatchEffect) return false;
        try {
          SP.dispatchEffect(g, user, fxId, tgt, power, (SP.field ? SP.field(fxId, 1) : 0));
          return true;
        } catch (e) { return false; }
      };

      // ---- 353110-353116：主伤害（穿过护甲 64，MP 也掉）----
      if ((tgt.get(0) | 0) === 1 && Elona.Battle && Elona.Battle.applyDamage) {
        Elona.Battle.applyDamage(tgt, dmg, g, user, 64);
        events.push({ kind: 'damage', value: dmg, attr: 64 });
        if ((tgt.get(0) | 0) === 1) {
          const mp = idiv(dmg, 100) + 5;
          tgt.set(55, Math.max(0, (tgt.get(55) | 0) - mp));
          events.push({ kind: 'mp', value: mp });
        }
      }

      // ---- 353117-353137：1202 型的外挂手榴弹（グレネード 655）----
      if ((tgt.get(0) | 0) === 1 && id === 1202) {
        if (f26 === 1 || (grp(3) && f26 === 2)) {
          const pw = limit(sk(10) * 5 + sk(189) * 20 + 500, 800, 50000);
          if (castFx(655, pw)) events.push({ kind: 'spell', id: 655, power: pw });
        }
      }

      // ---- 353139-353154：附加属性伤害（var_99(32) 是属性，第二参数是固定值）----
      const attr32 = it.f[32] | 0;
      if ((tgt.get(0) | 0) === 1 && attr32 > 0 && Elona.Battle && Elona.Battle.applyDamage) {
        const inner = (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000))
          * 4 * Math.sqrt(limit(lv, 1, 2000) * 3) + 30 + 1;
        let add;
        if (grp(5)) add = core + sk(16) * 4 + 5 + inner / 2;
        else add = core + R(sk(16) * 4 + 5 + idiv(inner, 8)) + inner * 3 / 8;
        add = Math.trunc(add / 5 * (f20 + 3));
        if (grp(2)) add = Math.trunc(add * 11 / 10);
        if (grp(3) && f26 >= 2) add = Math.trunc(add * 9 / 5);
        if (add < 1) add = 1;
        Elona.Battle.applyDamage(tgt, add, g, user, attr32, 500 + limit(sk(16) * 2, 1, 4000));
        events.push({ kind: 'damage', value: add, attr: attr32 });
      }

      // ---- 353156-353165：机能 1（回旋）→ 混乱；濒死则补一记首狩り ----
      if ((tgt.get(0) | 0) === 1 && grp(1)) {
        dmgcon(tgt, 7, 50 + limit(idiv(sk(10), 2), 1, 1000));
        if ((tgt.get(50) | 0) <= idiv(tgt.get(51) | 0, 10)) {
          if (castFx(812, 110)) events.push({ kind: 'spell', id: 812, power: 110 });
        }
      }

      // ---- 353167-353178：机能 6（弹道）→ 中毒 + 寄生计数 + SP 伤害 ----
      if ((tgt.get(0) | 0) === 1 && grp(6)) {
        dmgcon(tgt, 5, 50 + limit(idiv(sk(12), 2), 1, 1000));
        tgt.set(148, (tgt.get(148) | 0) + 1);
        const sp = limit(R(idiv(sk(12), 50) + 1) + 5, 5, 30);
        if (Elona.Status && Elona.Status.dmgsp) {
          try { Elona.Status.dmgsp(tgt, sp); } catch (e) { /* 状态模块未就绪 */ }
        }
        events.push({ kind: 'sp', value: sp });
      }

      // ---- 353180-353184：使用者涨技能（筋力 / 魔力 / 射撃）----
      if ((user.get(0) | 0) === 1 && Elona.Stats && Elona.Stats.skillExp) {
        for (const sid of [10, 16, 189]) {
          try { Elona.Stats.skillExp(user, sid, user.index | 0, 50, 0, 0, g); }
          catch (e) { /* 技能表未加载 */ }
        }
      }

      // ---- 353185-353193：扣弹（机能 3 双发要 2 发），充能归零 ----
      let shells = 0;
      it.f[26] = Math.max(0, (it.f[26] | 0) - 1);
      shells++;
      if (grp(3) && (it.f[26] | 0) > 0) {
        it.f[26] = (it.f[26] | 0) - 1;
        shells++;
      }
      it.f[20] = 0;                                             // 353193

      // ---- 353195-353234：爆栓充能（var_2378 = 100 表示满，进而触发 849）----
      let full = 0;
      const v252 = g.getV65 ? (g.getV65(252) | 0) : 0;
      if (v252 < 350) { if (lv >= 130) full = 100; }
      else if (lv >= 50) full = 100;
      if ((user.index | 0) < 16 || (user.get(58) | 0) === 100 || (user.index | 0) === 0) full = 100;
      if (g.getV65 && (g.getV65(273) | 0) === 1) full = 100;
      // 353211：NPC 且「品质 > 3、满血过半、充能 < 200」时取消（var_1636 是全局变量，
      // 本项目没有对应量，按「未设置」处理 → 不取消）
      if (g.getV65 && (g.getV65(193) | 0) === 888) full = 0;
      if ((user.get(266) | 0) === -1 && (user.get(185) | 0) !== 0) full = 0;
      if ((user.get(266) | 0) === 1 || (user.get(266) | 0) === 2) full = 0;

      if ((user.get(182) | 0) >= 100 && full === 100 && (tgt.get(0) | 0) === 1) {
        // 353232 只设了 var_396 = 849，没设 var_578 → 走 calcSpellPower
        if (Elona.Spell && Elona.Spell.cast) {
          try {
            Elona.Spell.cast(g, user, 849, tgt);
            events.push({ kind: 'spell', id: 849 });
          } catch (e) { /* 效果表未加载 */ }
        }
      }

      // ---- 353236-353240：射出的栓落在目标格（可捡回）----
      if (Elona.ItemDB && Elona.ItemDB.createItem) {
        const plug = Elona.ItemDB.createItem(1299, shells);
        if (plug) {
          plug.f[5] = tgt.x | 0;
          plug.f[6] = tgt.y | 0;
          plug.f[21] = -1;
          if (g.groundItems) g.groundItems.push(plug);
          if (g.refreshGroundCell) g.refreshGroundCell(plug.f[5], plug.f[6]);
        }
      }
      it.f[17] = 0;                                             // 353238

      const msg = `${uname}把药水栓射进了${tgt.name}。（${dmg} 伤害）`;
      g.log(msg);
      return {
        ok: true, effect: E.BOTTLE, action: 'bottle', target: tgt,
        damage: dmg, shells, events, message: msg,
      };
    },

    // ==================================================================
    // 未实现效果的准确提示（替代「什么也没有发生」）
    // ==================================================================
    /**
     * @returns {string|null} 有已知效果但未实现时返回说明
     */
    describe(it) {
      const eff = this.effectOf(it);
      if (!eff || this.isImplemented(eff)) return null;
      const ent = this.entryOf(eff);
      const nm = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : '该物品';
      if (!ent) return `《${nm}》的使用效果（类别 ${eff}）尚未移植。`;
      if (ent.owner && ent.owner !== 'itemfx.js') return null;   // 由别的模块实现，不报未移植
      const where = ent.items && ent.items.length
        ? `（同类：${ent.items.slice(0, 3).map((x) => x.name).join(' / ')}）` : '';
      return `《${nm}》的使用效果（类别 ${eff}，源码 ${ent.start}-${ent.end}）尚未移植。${where}`;
    },

    /** 统计：已实现 / 未实现各多少种（调试用） */
    stats() {
      if (!DATA) return null;
      const all = Object.keys(DATA.effects || {}).map(Number);
      const done = all.filter((e) => this.isImplemented(e));
      const owned = all.filter((e) => !this.isImplemented(e) && this.ownerOf(e));
      return {
        total: all.length,
        done: done.length,
        doneIds: done.sort((a, b) => a - b),
        owned: owned.length,
        ownedIds: owned.sort((a, b) => a - b),
        lines: DATA.meta ? DATA.meta.coveredLines : 0,
      };
    },
  };

  Elona.ItemFx = ItemFx;
})(window);
