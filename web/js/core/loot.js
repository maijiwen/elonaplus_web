/**
 * 死亡掉落 —— *label_2287（222138-222618，481 行）
 *
 * 原版唯一调用点：死亡处理（200426-201319 块）的 201319 `var_581 = prm_985; gosub *label_2287`
 * —— 无论物理 / 法术 / 状态致死，都汇到这一处。本项目没有统一入口，由调用方在
 * 「同伴倒下判定之后、清 ACTIVE 之前」调用 `Elona.Loot.onDeath(g, dead, killer)`：
 *   · game.js 远程击杀 / 近战击杀各一处
 *   · ai.js 状态与地面效果致死一处
 * `Chara.vanquish`（194128）在原版**不**掉落（任务目标移除 / 队伍溢出用），故不接。
 *
 * ## 规则（逐段对应）
 *   222139-222146  死者是玩家 → 只刷新格子，不掉落
 *   222147-222155  同伴（index < 16）→ 不掉落（装备随复活保留）
 *   222156-222221  不死从者（cbit 992）战死 → 变回暗之棺（由 core/necro.js 的
 *                  onNecroDeath 在 battle.js 钩子里实现，这里不重复）
 *   222221-222223  友军（关系 10）→ 不掉落
 *   222225-222232  地图 33（教学洞窟）的 観光客(185) / 特殊部隊(204) → 不掉落
 *   222233-222239  cbit 17 → 全额金币掉落（钱包清零）
 *   222240-222251  cbit 969 / 23 / (27&964) / 964 / 1015 → 不掉落（店员 / 马 / 魅了 / 任务保护）
 *   222252-222257  以太风（var_65(306)==-2）时职业 13 死而复生（关系复位，不掉落）
 *   222258-222490  背包逐件判定（见 dropDecide）
 *   222393-222473  黑猫(260)同伴击杀 → 舔装备：品质 ≥3 的装备追加附魔并标记 ibit 8
 *   222474-222477  掉落装备清空装备槽（var_58(100+n) 保留槽类型、清物品下标）
 *   222478-222490  落到死亡格（item_stack 合并；合并不了就新槽）
 *   222491-222499  非商店职业：品质 ≥4 / 以太风 / 1/10 → 掉 金币/4
 *   222500-222536  玩家信仰库米罗米(神 8) → 5 类杂物各 1/30（类别 52000/53000/54000/68000/77000）
 *   222537-222618  按职业类别掉杂物：1/7/3/4 → 1/20 装备(52000)；2 → 1/20 魔法具(53000)
 *                  + 1/40 食物(54000)；5 → 1/50 食物。等级 calcobjlv(玩家等级)、
 *                  品质 calcfixlv(2)。
 *   222619-222848  label_2288 —— 按 creature 类别（refchara(种族,3)）掉杂物：
 *                  类别 3 → 52000/53000/随机装备/随机道具/68000 各按分母；
 *                  类别 1/2 → 1/20 残骸(62000)+remain_make；类别 6/4/5 → 装备与食物组合。
 *   222848-223811  label_2289 —— 残骸 / 尸体 / 卵 / 标本 / 种族专属：
 *                  · 62000 残骸（gated 1/40）
 *                  · 卡片 504 / 503（品质 6、特定种族、决斗、信仰库米罗米等并集）
 *                  · 袜子 1248（种族名含 /man/ 且 1/400，或以太风；remain_make）
 *                  · 361（职业 1010/1026）
 *                  · 尸体 204（var_65(250+372)==100 肉人偶 / var_1174 / 品质≥4）+
 *                    槽掩码 f[32]、品质加成 f[20]、337
 *                  · 1274 / 1272 / 1273（var_65(250+347)==100）
 *                  · 183/184/185 → 77001×N + 284
 *                  · var_1569 特例（140→355；175/177/178→421×2；地图37 的 257）
 *                  · 种族专属表 SPECIES_DROPS（1210/1211/1212、869 進化の導石、
 *                    772×12、906×10、1325-1331 等约 60 条）
 *
 * 【字段对照】var_58(9)=关系 27=种族 25=品质 30=金币 38=等级 61=神 150=职业；
 *   var_99(3)=物品id 4=装备部位 20=品质修正 5/6=坐标 1=价值 7=重量 22=剩余回合
 *   23=物种 32=槽掩码；ibit(8)=已被舔 ibit(12)=no-drop。
 * 【var_99(18)】原版这里是「装备槽下标」——本项目对应 item.eqSlot（f[18] 不可靠，勿用）。
 * 201252-201320 死亡块：
 *   201303  skillexp 161, 击杀者, 10 + (尸体+卵+奶+残骸)*4
 *   201305  击杀者带 cbit 992（死灵）→ skillexp 161, 玩家, 30 + 上式*8
 *   201316  击杀者 -31/-30 → var_65(250+386) = 100；201320 无条件清 0（只活一次）
 *   222156-222221  死灵从者战死 → 暗之棺 903，label_2287 直接 return
 *   223808-223810  职业 13（冒険者）→ gosub *label_4283 生成遗物装备
 *
 * 【0-FO 用户决定】源码 237666-237684 / 302480-302503 的 var_65(250+347)
 *   （gettime() 算「距上次存档 ≥10 分钟」的防 S/L 稀有掉落总开关）**不移植**：
 *   网页版所有稀有掉落无条件生效，既没有会话计时也没有 v597 门。
 *   表项里的 v597 标记仅作「源码原本有门」的存档注释，不再参与判定。
 * 【0-FN 复核】var_132(16, mapId) 在本项目就是 core/ranch.js 的 mapType（牧场 = 31），
 *   已接通，A465 的牧场品质/蛋奶/皮分支不再恒不触发。
 * 【仍按 0 处理】var_126(6)（内容层剧情标志）。
 * 【已知偏差】HSP 的 `|`/`&` 是按位逻辑、不短路，源码长条件里的 rnd() 会被全部求值；
 *   本项目用 `||`/`&&` 短路，概率一致但 RNG 消耗序列不同（与 C1 同类）。
 */
(function (global) {
  'use strict';
  const Elona = global.Elona = global.Elona || {};

  const idiv = (a, b) => Math.floor((a | 0) / (b || 1));
  const limit = (v, a, b) => Math.max(a, Math.min(b, v));

  function cbit(c, n) {
    if (!Elona.Status || !Elona.Status.cbit) return 0;
    return Elona.Status.cbit(c, n) | 0;
  }

  /** 222302-222324：剧情专属物品 —— 无论什么条件都不掉落 */
  const NO_DROP_IDS = [908, 922, 875, 923, 950, 951, 958, 959];
  /** 222340-222379：种族专属物品（种族 → 物品）；663 的 948 只受地图条件管（222326） */
  const SPECIES_NO_DROP = {
    484: [676], 482: [796], 359: [677], 306: [673],
    331: [678], 338: [679], 339: [675], 342: [674],
  };
  /** 222500-222536：库米罗米的掉落类别 */
  const KUMIROMI_CATS = [52000, 53000, 54000, 68000, 77000];
  /** 职业类别 → 掉落表：[概率分母, 类别][] */
  const CLASS_DROPS = {
    1: [[20, 52000]],
    7: [[20, 52000]],
    3: [[20, 52000]],
    4: [[20, 52000]],
    2: [[20, 53000], [40, 54000]],
    5: [[50, 54000]],
  };

  /** 222156-222221：死灵从者战死 → 变回暗之棺 903（由 necro.js 生成，这里直接 return） */
  const NECRO_COFFIN_SPECIES = [447, 21, 100, 150, 47, 578, 416, 579];
  /** 223808-223810：职业 13（冒険者）死亡 → *label_4283 */
  const ADVENTURER_JOB = 13;
  /** 590590-590632：*label_4283 的装备槽 → var_638 / var_639 类别 */
  const ADV_SLOT_CAT = {
    1: { t638: 12000 }, 4: { t638: 16000 }, 5: { t638: 10000 },
    10: { t639: 24001 }, 11: { t639: 25001 },
  };

  let RC = null;                                   // race_class.json 缓存
  let RT = null;                                   // race_tags.json 缓存
  function classCat(c) {
    if (!c || !c.className) return 0;
    if (!RC && Elona.Data && Elona.Data.tableSync) {
      try { RC = Elona.Data.tableSync('race_class'); } catch (e) { RC = null; }
    }
    if (!RC || !RC.classes || !RC.classes[c.className]) return 0;
    return (RC.classes[c.className].fields && RC.classes[c.className].fields['4']) | 0;
  }
  /** 测试注入用 */
  function setClassTable(t) { RC = t; }
  function setRaceTags(t) { RT = t; }

  /**
   * refchara(id, 8, 1) —— 种族标签串（"/man/"、"/undead/nefia6/" …）。
   * 数据在 web/data/tables/race_tags.json（源 472605-587756 的 var_61==8 分支）。
   * 0-FM 用 rec.race/rec.nameCh 取，creature.json 里没有这两个字段，恒返回空串，
   * 导致 222883 的 /man/ 判定（袜子 1/400）永远不触发；0-FN 改走标签表。
   */
  function raceTagOf(sp) {
    if (!RT && Elona.Data && Elona.Data.tableSync) {
      try { RT = Elona.Data.tableSync('race_tags'); } catch (e) { RT = null; }
    }
    if (RT && RT.tags) return String(RT.tags[String(sp | 0)] || '');
    if (Elona.EnchantFX && Elona.EnchantFX.raceTag) {
      try { return String(Elona.EnchantFX.raceTag(sp | 0) || ''); } catch (e) { return ''; }
    }
    return '';
  }

  /** 取绑定好 this 的 rnd —— rng.rnd 是原型方法，裸调用会丢 this（浏览器实测炸过） */
  function rndOf(g) {
    const owner = (g && g.rng) ? g.rng : (Elona.rng || null);
    if (owner && typeof owner.rnd === 'function') return (n) => owner.rnd(n);
    return () => 0;
  }

  /** 落地：先尝试与同格同类合并（item_stack -1），合并不了就追加（item_copy） */
  function dropGround(g, it, x, y) {
    it.f[5] = x | 0;
    it.f[6] = y | 0;
    if (Array.isArray(g.groundItems)) {
      for (const o of g.groundItems) {
        if (!o || !o.f || !(o.f[0] | 0)) continue;
        if ((o.f[5] | 0) !== (x | 0) || (o.f[6] | 0) !== (y | 0)) continue;
        if ((o.f[3] | 0) !== (it.f[3] | 0)) continue;
        if (Elona.ItemDB && Elona.ItemDB.stackableGround
          && Elona.ItemDB.stackableGround(o, it) === false) continue;
        // 逐字段比较（与 item_stack 31322-31400 同判据，跳过数量/坐标/类别/名称）
        let diff = false;
        for (let fld = 1; fld < 70; fld++) {
          if (fld === 1 || fld === 4 || fld === 5 || fld === 6 || fld === 27 || fld === 30) continue;
          if ((o.f[fld] | 0) !== (it.f[fld] | 0)) { diff = true; break; }
        }
        if (!diff) {
          o.f[0] = (o.f[0] | 0) + (it.f[0] | 0);
          return { merged: true };
        }
      }
      g.groundItems.push(it);
    }
    if (g.refreshGroundCell) { try { g.refreshGroundCell(x | 0, y | 0); } catch (e) { /* 头less 测试 */ } }
    return { merged: false };
  }

  /** 按类别生成一件杂物（flt calcobjlv / calcfixlv(2) → itemcreate 0） */
  function makeCatItem(g, cat, level, x, y) {
    const I = Elona.ItemDB;
    if (!I || !I.create) return null;
    const it = I.create(g, {
      level: I.calcObjLv(level, g),
      fix: I.calcFixLv(2, g),
      t638: cat | 0,
    });
    if (it) dropGround(g, it, x, y);
    return it;
  }

  /**
   * remain_make (31286-31312)：给「残骸 / 尸体」类物品写归属与价值。
   * var_99(23)=物种、var_99(22)=剩余回合、var_99(7)=重量、var_99(1)=价值。
   * 204（尸体）走单独公式；1214（大尸体）另一套；其余按等级线性。
   */
  function remainMake(it, dead) {
    if (!it || !dead) return it;
    it.f[23] = dead.get(27) | 0;
    it.f[22] = idiv((dead.get(7) | 0) - (dead.get(435) | 0) * 1000, 1000);
    it.f[7] = (dead.get(20) | 0) + 1;
    if ((it.f[3] | 0) === 204) {
      it.f[7] = limit(idiv(it.f[7], 10) * 500, 500, 50000);
      it.f[1] = limit(idiv(it.f[7] + 20000, 7), 2700, 10000);
    } else if ((it.f[3] | 0) === 1214) {
      it.f[7] = limit(idiv(it.f[7], 10) * 500, 5000, 100000);
      it.f[1] = limit((dead.get(38) + 30) * 300, 3000, 90000);
    } else {
      it.f[7] = limit(idiv(it.f[7], 10) * 50, 0, 5000);
      it.f[1] = limit((dead.get(38) | 0) * 40 + 600, 1, 12000);
      // refchara(种族, 6) < 20 且 var_58(69) < -1 → 价值按种族系数打折
      const r6 = refcharaField(dead.get(27) | 0, 6);
      if (r6 < 20 && (dead.get(69) | 0) < -1) {
        it.f[1] = it.f[1] * limit(4 - idiv(r6, 5), 1, 5);
      }
    }
    return it;
  }

  /** refchara(id, field) —— creature 表的字段查询（字段 3 = 类别，6 = 种族系数） */
  function refcharaField(id, field) {
    const CF = Elona.CharaFactory;
    if (!CF || !CF.ref) return 0;
    const rec = CF.ref(id | 0);
    if (!rec || !rec.fields) return 0;
    return rec.fields[String(field)] | 0;
  }

  /** 222060-222080：源码里的类别候选数组 */
  const CAT_645 = [10000, 10000, 24000, 24000, 25000, 12000, 16000, 20000, 19000, 18000, 22000, 14000, 32000, 34000];
  const CAT_1520 = [10000, 24000, 25000];

  /**
   * 按种族/职业类别掉杂物（label_2288 / label_2289，222619-222848）。
   * var_1302 = refchara(种族, 3)（creature 字段 3 = 类别）。
   * 每个类别有一组「概率分母 → 类别」的独立判定，全部互不排斥。
   */
  const RACE_CAT_DROPS = {
    3: [[40, 52000], [40, 53000], [40, 'rand645'], [40, 'rand1520'], [20, 68000]],
    1: [[20, 62000, 'remain']],
    2: [[20, 62000, 'remain']],
    6: [[10, 32000], [10, 34000], [20, 54000], [10, 52000], [10, 53000],
      [20, 72000], [10, 68000], [10, 77000]],
    4: [[5, 'rand645'], [5, 'rand1520'], [20, 72000], [4, 68000]],
    5: [[5, 'rand645'], [5, 'rand1520'], [15, 54000], [5, 52000], [5, 53000],
      [10, 72000], [4, 68000], [4, 77000]],
  };

  /**
   * 按种族类别掉杂物。killer = 行动者（var_244），等级用于 calcobjlv。
   * gated 对应 222666 / 222681 的 `var_65(250+372)<=0 & var_65(250+386)==0`：
   * 只有类别 1/2（人形 / 动物）的 62000 残骸受肉人偶标志抑制。
   */
  function raceCatDrops(g, dead, killer, x, y, gated) {
    const cat = refcharaField(dead.get(27) | 0, 3);
    const table = RACE_CAT_DROPS[cat];
    if (!table) return;
    const R = (n) => rndOf(g)(Math.max(1, n | 0));
    const actorLv = killer ? (killer.get(38) | 0) : (dead.get(38) | 0);
    for (const entry of table) {
      const denom = entry[0];
      let c = entry[1];
      const isRemain = entry[2] === 'remain';
      if (isRemain && gated === false) continue;             // 222666 / 222681
      if (R(denom) !== 0) continue;
      // rnd(length(var_645)) 本身已是 0..len-1，旧实现多减 1 会越界到 undefined
      if (c === 'rand645') c = CAT_645[R(CAT_645.length)];
      else if (c === 'rand1520') c = CAT_1520[R(CAT_1520.length)];
      const it = makeCatItem(g, c, actorLv, x, y);
      if (it && isRemain) remainMake(it, dead);
    }
  }

  // ------------------------------------------------------------------------
  // label_2289（222848-223811）：残骸 / 尸体 / 卵 / 标本 / 种族专属
  // ------------------------------------------------------------------------
  /** 生成一件指定 id 的物品并落地；opts.f 为实例字段覆盖，opts.cnt 为数量 */
  function spawnItem(g, id, x, y, opts) {
    const I = Elona.ItemDB;
    if (!I || !I.createItem) return null;
    opts = opts || {};
    const it = I.createItem(id | 0, opts.cnt || 1);
    if (!it) return null;
    if (opts.f) for (const k in opts.f) it.f[k | 0] = opts.f[k];
    if (opts.post) opts.post(it);
    dropGround(g, it, x, y);
    return it;
  }

  /** `flt` 无参 → 等级取 calcobjlv(0)、品质 calcfixlv(2)，生成随机物品 */
  /**
   * `flt` + `itemcreate -1, 0`（类别随机）。opts：
   *   prm    —— calcobjlv 的参数（源码 `flt calcobjlv(var_58(38, xx))` 的 xx 等级；
   *             缺省 0 = 地图基础等级，与 flt 无参一致）
   *   raw    —— true = `flt 等级, 品质` 直传（223538 的 92000：等级不抖动）
   *   fixRaw —— 品质直传值（raw 时用）
   *   t639   —— 大类别过滤器（223096 的 77001 写 var_639；此时 var_638 被清 0）
   */
  function spawnRandom(g, x, y, cat, opts) {
    const I = Elona.ItemDB;
    if (!I || !I.create) return null;
    opts = opts || {};
    const level = opts.raw
      ? (opts.prm === undefined ? 0 : (opts.prm | 0))
      : I.calcObjLv(opts.prm === undefined ? 0 : (opts.prm | 0), g);
    const it = I.create(g, {
      level,
      fix: opts.fixRaw !== undefined ? (opts.fixRaw | 0) : I.calcFixLv(2, g),
      t638: opts.t639 ? 0 : (cat | 0),
      t639: opts.t639 | 0,
    });
    if (!it) return null;
    if (opts.f) for (const k in opts.f) it.f[k | 0] = opts.f[k];
    dropGround(g, it, x, y);
    return it;
  }

  /**
   * 223130-223250：var_1569 特例表（种族 → 必掉物品序列）。
   * 223110 起 `repeat 10`，遇到 -1 终止。
   */
  function specTableDrops(g, dead, x, y) {
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    const sp = dead.get(27) | 0;
    let list = null;
    if (sp === 140) list = [355];
    if ((sp === 175 || sp === 177 || sp === 178) && mapId !== 74) list = [421, 421];
    if (mapId === 37 && sp === 257) list = [665, 55, 55, 55, 55, 621];
    if (!list) return;
    for (const id of list) spawnItem(g, id, x, y);
  }

  /**
   * 223130-223145 + 223250-223800：种族专属掉落表。
   * 每条：[概率分母(0 = 无条件), 物品id, 附加选项]
   *   opts: { f:{字段:值}, cnt:数量, v597:源码原本有防 S/L 门（0-FO 起不拦截）, jobNot:[排除职业],
   *           map:限定地图, cbitNot:需要 cbit(n)!=1, repeat:重复次数 }
   */
  const SPECIES_DROPS = {
    // 223137-223151 位于 `if (var_65(20) != 74)` 块内；223320 起的表不受该门限制
    2: [[0, 1210, { f: { 17: 0 }, notMap74: true }]],
    458: [[0, 1211, { f: { 17: 0 }, notMap74: true }]],
    911: [[0, 1212, { f: { 17: 0 }, notMap74: true }]],
    5: [[30, 702, { v597: true }]],
    34: [[4, 717, {}]],
    12: [[6, 1128, {}]],
    99: [[90, 708, {}]], 100: [[90, 708, {}]], 101: [[90, 708, {}]],
    117: [[14, 720, { v597: true }]],
    168: [[30, 740, { v597: true }]],
    307: [[90, 709, {}]], 308: [[90, 709, {}]],
    189: [[30, 711, { v597: true }]], 190: [[30, 711, { v597: true }]],
    169: [[60, 1266, { v597: true }]],
    748: [[15, 1266, { v597: true }]],
    745: [[6, 1266, { v597: true }]], 746: [[6, 1266, { v597: true }]], 747: [[6, 1266, { v597: true }]],
    213: [[50, 672, { f: { 25: 169 } }]], 499: [[50, 672, { f: { 25: 169 } }]],
    1162: [[10, 1333, { v597: true }]],
    // 223428：633 的 f[22] = (体重 - 装备重*1000)/1000
    1161: [[20, 633, { v597: true, post: (it, d) => { it.f[22] = idiv((d.get(7) | 0) - (d.get(435) | 0) * 1000, 1000); } }]],
    1152: [[0, 1197, { cnt: 3 }]],
    250: [[20, 715, { v597: true }]],
    1072: [[30, 1267, { v597: true, f: { 25: 'rnd1000' } }]],
    706: [[30, 1267, { v597: true, f: { 25: 'rnd1000' } }]],
    705: [[30, 1267, { v597: true, f: { 25: 'rnd1000' } }]],
    704: [[30, 1267, { v597: true, f: { 25: 'rnd1000' } }]],
    1143: [[0, 626, { f: { 17: -2 } }]],
    673: [[9, 1304, {}]],
    341: [[3, 635, {}]],
    85: [[60, 737, {}]], 86: [[60, 737, {}]], 87: [[60, 737, {}]],
    328: [[0, 55, { cnt: 'rnd3' }], [2, 622, {}]],
    329: [[0, 54, { cnt: 'gold2500' }]],
    410: [[20, 683, { v597: true }]],
    415: [[2, 744, {}]],
    460: [[2, 825, {}]],
    419: [[0, 859, { map: 58 }]],
    498: [[20, 861, { v597: true }]],
    97: [[40, 898, { v597: true }]], 98: [[40, 898, { v597: true }]],
    401: [[40, 898, { v597: true }]], 580: [[40, 898, { v597: true }]],
    461: [[20, 827, { v597: true, cbitNot: 964 }]],
    462: [[20, 827, { v597: true, cbitNot: 964 }]],
    463: [[20, 827, { v597: true, cbitNot: 964 }]],
    487: [[20, 827, { v597: true, cbitNot: 964 }]],
    734: [[2, 984, { f: { 17: -1 } }]],
    166: [[10, 1040, { f: { 17: 0 } }]],
    389: [[20, 1050, { f: { 17: 0 } }]],
    674: [[15, 957, { v597: true }]],
    676: [[0, 1019, { f: { 17: 0 } }]],
    675: [[0, 1015, { f: { 17: 0 } }]],
    668: [[0, 1016, { f: { 17: 0 } }]],
    665: [[0, 1018, { f: { 17: 0 } }]],
    640: [[0, 1013, { f: { 17: 0 } }]],
    639: [[0, 1017, { f: { 17: 0 } }]],
    637: [[0, 1012, { f: { 17: 0 } }]],
    624: [[0, 1014, { f: { 17: 0 } }]],
    793: [[0, 750, { f: { 17: 0 } }]],
    672: [[0, 638, { f: { 17: 1 } }]],
    572: [[40, 900, { v597: true, jobNot: [4, 3] }]],
    573: [[30, 900, { v597: true, jobNot: [4, 3] }]],
    574: [[20, 900, { v597: true, jobNot: [4, 3] }]],
    93: [[30, 974, { v597: true }]], 94: [[30, 974, { v597: true }]],
    520: [[20, 974, { v597: true }]],
    244: [[30, 1083, { v597: true }]],
    229: [[80, 1009, { v597: true }]],
    695: [[50, 1009, {}]],
    // 223795-223799：f[8]==1 是「角色」的性别字段判据，源码不写物品 f[8]
    852: [[0, 1035, { needF8: 1 }]],
    1136: [[0, 779, { needF8: 0 }]],
  };

  /** var_65(597)==100 的 869（進化の導石）掉落表：[概率分母, 品质] */
  const EVOLVE_869 = {
    100: { 505: 14, 219: 14, 137: 14, 44: 14, 386: 14, 399: 16, 158: 11, 501: 12, 512: 13, 434: 13, 406: 13 },
    70: { 446: 14, 431: 14, 457: 14, 400: 14, 469: 11, 501: 12 },
    50: { 395: 14, 529: 14, 387: 11, 511: 16 },
  };

  function label2289Drops(g, dead, killer, out, flags) {
    const R = (n) => rndOf(g)(Math.max(1, n | 0));
    const x = dead.x | 0, y = dead.y | 0;
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    const V = (n) => (g.getV65 ? (g.getV65(n) | 0) : 0);
    // var_244 = 行动者：战斗击杀 = 击杀者，状态/陷阱等被动死亡 = 死者本人（其回合内结算）
    const actor = killer || dead;
    const actorLv = actor.get(38) | 0;
    // 肉人偶标记：core/freshdoll.js 已自行生成人偶时由 flags 覆盖，
    // 使 label_2289 的 gated 判定照样抑制普通尸体/卵/奶/残骸/标本。
    const v372 = (flags.v372 !== undefined) ? (flags.v372 | 0) : V(622);
    // 201316/201320：v386 只在本次死亡内有效，由 computeKillFlags 写在 flags 上，
    // 不再污染全局 var_65（旧实现设了 100 就再也不清，会永久抑制后续掉落）
    const v386 = (flags.v386 !== undefined) ? (flags.v386 | 0) : V(636);
    // 0-FO：源码 var_65(250+347) 的防 S/L 门按用户要求整体移除，稀有掉落恒开。
    const sp = dead.get(27) | 0;
    const job = dead.get(150) | 0;
    const quality = dead.get(25) | 0;
    const gated = (v372 <= 0 && v386 === 0);   // 反复出现的公共前置

    // 222849-222858：62000 残骸类（calcobjlv(行动者等级)）
    if (gated && R(40) === 0) {
      const it = spawnRandom(g, x, y, 62000, { prm: actorLv });
      if (it) remainMake(it, dead);
    }
    // 222859-222862：地图 35 到此为止
    if (mapId === 35) return;

    // 222863-222905：卡片 504 / 503（含 175 等一堆条件的并集）
    const cardCond = () => (
      R(175) === 0 || V(556) === -2 || quality === 6
      || sp === 878 || sp === 877 || sp === 876 || sp === 875 || sp === 534
      || (quality === 4 && R(2) === 0) || (quality === 5 && R(3) === 0)
      || ((g.charas && g.charas[0] ? (g.charas[0].get(61) | 0) : 0) === 8 && R(35) === 0)
    );
    if (mapId !== 6 && job !== 20 && (dead.index | 0) >= 16) {
      // itemcreate -1, 504 / 503：指定物品 id（カード / 標本本体），不是类别随机
      if (cardCond()) {
        const it = spawnItem(g, 504, x, y);
        if (it) { it.f[22] = idiv(dead.get(7) | 0, 1000) + (dead.get(435) | 0) * 1000; it.f[23] = sp; }
      }
      if (v372 <= 0 && v386 === 0 && cardCond()) {
        const it = spawnItem(g, 503, x, y);
        if (it) { it.f[22] = idiv(dead.get(7) | 0, 1000) + (dead.get(435) | 0) * 1000; it.f[23] = sp; }
      }
    }

    // 222881-222894：袜子 1248（refchara(种族,8,1) 含 "/man/" 且 1/400，或以太风）
    const raceStr = raceTagOf(sp);
    if ((raceStr.indexOf('/man/') >= 0 && R(400) === 0) || V(556) === -2) {
      const it = spawnItem(g, 1248, x, y);
      // 222891 是 rnd(31)（0..30），旧实现多减 1 会写出负数
      if (it) { remainMake(it, dead); it.f[23] = sp; it.f[22] = R(31); }
    }
    if (V(556) === -2 && g.setV65) g.setV65(556, -1);

    // 222925-222928：职业 1010 / 1026 → 361「商人のカバン」。
    // 344752-344753：每次打开 -10 karma；内容物 = 店主库存（经商页「打开可以获取店主的所有商品」）。
    if (job === 1010 || job === 1026) {
      const bag = spawnItem(g, 361, x, y, { f: { 25: dead.get(153) | 0, 21: 2 } });
      if (bag) {
        bag.inv = [];
        for (const src of (Array.isArray(dead.inv) ? dead.inv : [])) {
          if (!src || (src.f[0] | 0) <= 0) continue;
          try {
            const cp = Elona.Item && Elona.Item.fromJSON
              ? Elona.Item.fromJSON(JSON.parse(JSON.stringify(src.toJSON())))
              : null;
            if (cp) { cp.f[0] = src.f[0] | 0; bag.inv.push(cp); }
          } catch (e) { /* 克隆失败的单件跳过，不影响其它商品 */ }
        }
      }
    }

    if ((dead.index | 0) >= 16) {
      // 222905-222924：var_65(250+372)==100 → 尸体 204（肉人偶 / Rank10 料理）
      if (v372 === 100 && !flags.dollAlready) {
        const it = spawnItem(g, 204, x, y);
        if (it) {
          const anatomy0 = (g.charas && g.charas[0] ? (g.charas[0].skill(161) | 0) : 0);
          it.f[2] = 1119;
          it.f[26] = 10;
          it.f[27] = clockHours(g) + 240;
          // 222911-222919：牧场用 /20+2 且 limit [1,10]；否则只加梳理计数，==74 写 f[31]
          if (v132Is(g, 16, 31) && cbit(actor, 960) === 1) {
            it.f[20] = (it.f[20] | 0) + limit(R(idiv(anatomy0 + 1, 20) + 2) + 0, 1, 10) + (dead.get(177) | 0);
          } else {
            it.f[20] = (it.f[20] | 0) + (dead.get(177) | 0);
            if (v132Is(g, 16, 74)) it.f[31] = 1;
          }
          remainMake(it, dead);
          // 222921：源码取 var_58(7/435, var_244)（行动者），不是死者
          it.f[22] = idiv(actor.get(7) | 0, 1000) + (actor.get(435) | 0) * 1000;
          it.f[23] = sp;
        }
      }
      // 222937-222945：var_1175 → 573（卵）
      if (gated && (flags.v1175 === 1 || flags.v38 || (v132Is(g, 16, 31) && cbit(dead, 960) === 1 && (dead.get(261) | 0) === 0))) {
        const it = spawnItem(g, 573, x, y);
        if (it) {
          it.f[23] = sp;
          it.f[7] = limit(idiv(dead.get(20) | 0, 10) * 40, 20, 10000);
          it.f[1] = limit(idiv((dead.get(20) | 0) + 2400, 4), 600, 3000);
        }
      }
      // 222946-222955：var_1176 → 574（奶）
      if (gated && (flags.v1176 === 1 || flags.v38 || (v132Is(g, 16, 31) && cbit(dead, 960) === 1 && (dead.get(261) | 0) === 0))) {
        const it = spawnItem(g, 574, x, y);
        if (it) it.f[23] = sp;
      }
      // 222956-223060：var_1174 / 品质≥4 → 尸体 204（普通）
      if (gated && (flags.v1174 === 1 || quality >= 4 || flags.v38
        || (v132Is(g, 16, 31) && cbit(dead, 960) === 1 && (dead.get(261) | 0) === 0))) {
        const it = spawnItem(g, 204, x, y);
        if (it) {
          const f407 = dead.get(407) | 0;
          let v1564 = 0, v1565 = 0, v1566 = 0, v1567 = 0;
          if (f407 >= 1 && f407 <= 3) v1564 = f407;
          if (f407 >= 7 && f407 <= 9 && R(f407 * f407) > 30) v1565 = 1;
          if (f407 >= 4 && f407 <= 6) v1566 = f407;
          if (f407 >= 10 && f407 <= 12) {
            if (R(f407 * f407) > 60) v1567++;
            if (R(f407 * f407) > 60) v1567++;
            if (R(f407 * f407) > 60) v1567++;
          }
          if (v132Is(g, 16, 31) && cbit(dead, 960) === 1) {
            it.f[20] = (it.f[20] | 0) + limit(R(idiv((g.charas && g.charas[0] ? (g.charas[0].skill(161) | 0) : 0) + 1, 40) + 2) + v1564, 0, 5) + 5 + (dead.get(59) | 0) + (dead.get(177) | 0);
          } else {
            it.f[20] = (it.f[20] | 0) + (dead.get(177) | 0);
          }
          if (v132Is(g, 16, 74)) it.f[31] = 1;
          it.f[32] = 0;
          // 装备槽掩码（var_99(32)）：按 30 个槽的类型位或
          for (let cnt = 100; cnt < 130; cnt++) {
            const t = idiv(dead.get(cnt) | 0, 10000);
            if (t === 0) break;
            const bits = [0, 1, 10, 1000, 100, 10000, 100000, 1000000, 10000000, 100000000];
            if (t >= 1 && t <= 9 && it.f[32] < bits[t]) it.f[32] += bits[t];
          }
          const ranch = v132Is(g, 16, 31) && cbit(dead, 960) === 1;
          const anatomy = (g.charas && g.charas[0] ? (g.charas[0].skill(161) | 0) : 0);
          const extraRoll = () => R(1 + (anatomy > (dead.get(38) | 0) ? 1 : 0));
          // 223036 / 223037-223042
          remainMake(it, dead);
          if (ranch) it.f[0] = (it.f[0] | 0) + extraRoll() + v1565;
          let leather = null;
          if (ranch) {
            // 223043-223048：337（皮）；f[20] 是 +=，f[0] 直接赋值
            leather = spawnItem(g, 337, x, y, {
              post: (o) => {
                o.f[20] = (o.f[20] | 0) + limit(R(idiv(anatomy + 1, 40) + 2) + v1566, 0, 5)
                  + 5 + (dead.get(59) | 0) + (dead.get(177) | 0);
                o.f[0] = 1 + extraRoll() + v1567;
              },
            });
          }
          // 223049-223051：源码再对 var_579 调一次 remain_make（有 337 时作用在皮上）
          remainMake(leather || it, dead);
        }
      }
    }

    // 223060-223082：1274 / 1272 / 1273（0-FO：稀有掉落门已移除）
    if (R(10) === 0) {
      if (flags.v1178 === 1 && v386 === 0 && ((dead.get(198) | 0) + (dead.get(160) | 0)) >= 1000) {
        spawnItem(g, 1274, x, y, { f: { 26: dead.get(198) | 0, 27: dead.get(160) | 0, 31: dead.get(199) | 0, 17: 0 } });
      }
      // 223072 / 223078：limit 作用于 (lv/10+1)*10 之后，上限 999（旧实现先限再乘 10）
      if (v386 === 100) {
        spawnItem(g, 1272, x, y, { f: { 26: limit((idiv(dead.get(38) | 0, 10) + 1) * 10, 1, 999), 17: 0 } });
      }
      if (flags.v1180 === 1) {
        spawnItem(g, 1273, x, y, { f: { 26: limit((idiv(dead.get(38) | 0, 10) + 1) * 10, 1, 999), 17: 0 } });
      }
    }

    // 223083-223089：信仰库米罗米(神 8) 或 var_1177 → 62000
    const playerGod = (g.charas && g.charas[0]) ? (g.charas[0].get(61) | 0) : 0;
    if ((playerGod === 8 && R(6) === 0) || flags.v1177 === 1) {
      if (gated) {
        const it = spawnRandom(g, x, y, 62000);
        if (it) remainMake(it, dead);
      }
    }

    // 223090-223104：183/184/185 → 77001 若干 + 284
    let v1568 = -1;
    if (sp === 183) v1568 = 8;
    if (sp === 184) v1568 = 4;
    if (sp === 185) v1568 = 2;
    if (v386 === 100) v1568 = -1;
    if (v1568 !== -1) {
      // 223096：flt calcobjlv(死者等级) + var_639 = 77001（大类别过滤，var_638 清 0）
      for (let i = 0; i < v1568; i++) {
        spawnRandom(g, x, y, 0, { t639: 77001, prm: dead.get(38) | 0 });
      }
      if (R(3) === 0) spawnItem(g, 284, x, y);
    }

    // 223110-223145：var_1569 特例
    specTableDrops(g, dead, x, y);

    // 223136-223319：`if (var_65(20) != 74)` 只包住 1210/1211/1212 + 進化の導石 869 + 1300。
    // 223320 起的种族专属表在门**外**（旧实现把整段包了进去，map 74 会误屏蔽全部表）。
    if (mapId !== 74) {
      // 869 進化の導石（0-FO：不再有 v347 门）
      for (const denom of [100, 70, 50]) {
        const tbl = EVOLVE_869[denom];
        if (R(denom) === 0 && tbl && tbl[sp] !== undefined) {
          spawnItem(g, 869, x, y, { f: { 25: tbl[sp] } });
        }
      }
      // 无条件 869 表（524 / 175 / 177 / 378 / 379 / 306 等）
      const ALWAYS_869 = {
        524: 11, 175: 11, 177: 12, 378: 12, 379: 13, 178: 16, 377: 16,
        306: 13, 331: 13, 338: 13, 339: 13, 342: 13, 359: 13,
        482: 13, 484: 13, 517: 13, 923: 13,
      };
      if (ALWAYS_869[sp] !== undefined) {
        spawnItem(g, 869, x, y, { f: { 25: ALWAYS_869[sp] } });
        if (sp === 379) spawnItem(g, 876, x, y);
      }
      // rnd(30)==0 → 1300
      if (R(30) === 0) {
        spawnItem(g, 1300, x, y, { f: { 26: limit((idiv(dead.get(38) | 0, 10) + 1) * 10, 10, 100) } });
      }
      // lv>29 && rnd(400)==0 → 869 品质 15
      if ((dead.get(38) | 0) > 29 && R(400) === 0) {
        spawnItem(g, 869, x, y, { f: { 25: 15 } });
      }

    } // 223319：map != 74 的门到此结束

    // 223320-223806：种族专属掉落表（不受 map 74 限制）
    const table = SPECIES_DROPS[sp];
    if (table) {
      for (const entry of table) {
        const denom = entry[0], id = entry[1], o = entry[2] || {};
        if (o.notMap74 && mapId === 74) continue;
        if (o.map !== undefined && o.map !== mapId) continue;
        // 0-FO：v597 只是「源码原本有防 S/L 门」的注释标记，不再拦截
        if (o.jobNot && o.jobNot.indexOf(job) >= 0) continue;
        if (o.cbitNot && cbit(dead, o.cbitNot) === 1) continue;
        if (o.needF8 !== undefined && (dead.get(8) | 0) !== o.needF8) continue;
        if (denom !== 0 && R(denom) !== 0) continue;
        let cnt = 1;
        if (o.cnt === 'rnd3') cnt = 1 + R(3);
        else if (o.cnt === 'gold2500') cnt = 2500 + R((g.charas && g.charas[0] ? (g.charas[0].get(34) | 0) : 0) + 1000);
        else if (typeof o.cnt === 'number') cnt = o.cnt;
        const f = {};
        if (o.f) for (const k in o.f) f[k] = (o.f[k] === 'rnd1000') ? R(1000) + 1 : o.f[k];
        spawnItem(g, id, x, y, {
          cnt, f,
          post: o.post ? (it) => o.post(it, dead, g) : undefined,
        });
      }
    }

    // 302-305 → 771
    if (sp >= 302 && sp <= 305 && R(60) === 0) spawnItem(g, 771, x, y);
    // 302 / 1085 → 92000 若干
    if (sp === 302 || sp === 1085) {
      // 223534：flt 死者等级, 2（等级与品质都是直传，不抖动）
      const reps = 2 + R(4);
      for (let i = 0; i < reps; i++) {
        const it = spawnRandom(g, x, y, 92000, { prm: dead.get(38) | 0, raw: true, fixRaw: 2 });
        if (it && (it.f[1] | 0) < 800) it.f[0] = R(5) + 1;
      }
    }
    // 351 / 352 → 772 ×12
    if (sp === 351 || sp === 352) {
      for (let i = 0; i < 12; i++) {
        const it = spawnItem(g, 772, x, y);
        if (it && R(2)) { it.f[27] = -1; it.f[2] = 336; }
      }
    }
    // 627 → 906 ×10
    if (sp === 627) for (let i = 0; i < 10; i++) spawnItem(g, 906, x, y);
    // 1157 → 1325..1331
    if (sp === 1157) {
      for (const id of [1331, 1330, 1329, 1328, 1327, 1326, 1325]) {
        if (R(3) === 0) spawnItem(g, id, x, y);
      }
    }
    // 666：var_126(6)==3 → 629 + 55
    if (sp === 666 && R(2) === 0 && v126Is(g, 6) === 3) {
      spawnItem(g, 629, x, y); spawnItem(g, 55, x, y);
    }
    // 684：var_65(250+296)==11 → 置 12 + 955(4) + 1248(3)
    if (sp === 684 && V(546) === 11) {
      if (g.setV65) g.setV65(546, 12);
      spawnItem(g, 955, x, y, { cnt: 4 });
      spawnItem(g, 1248, x, y, { cnt: 3 });
    }
    // 259：var_65(250+213)==1000
    if (sp === 259 && V(463) === 1000 && R(25) === 0) spawnItem(g, 672, x, y, { f: { 25: 162 } });
    // wizard / gunner 职业（223490 / 223498）
    if ((dead.className === 'wizard') && R(100) === 0) spawnItem(g, 1307, x, y);
    if ((dead.className === 'gunner') && R(100) === 0) spawnItem(g, 1306, x, y);

    // 223807-223810：职业 13（冒険者）→ *label_4283
    if (job === ADVENTURER_JOB) adventurerGear(g, dead, out);
  }

  /**
   * var_132(16, mapId)：源码是「地图类型」二维表，本项目对应 core/ranch.js 的 mapType
   * （0-BK 起由 world_sites.json 提供，牧场 = 31）。接通后 222926/222937/222946/222975
   * 的健康仔畜必掉蛋/奶/尸体、223043 的皮、223016 的 f[31] 才真正可达（A465 收口）。
   */
  function v132(g, field) {
    if (field === 16) {
      if (Elona.Ranch && Elona.Ranch.mapType) {
        try { return Elona.Ranch.mapType(g) | 0; } catch (e) { return 0; }
      }
      if (Elona.FoodLeft && Elona.FoodLeft.mapType) {
        try { return Elona.FoodLeft.mapType(g) | 0; } catch (e) { return 0; }
      }
    }
    if (Elona.World && Elona.World.getV132) {
      try { return Elona.World.getV132(g, field) | 0; } catch (e) { return 0; }
    }
    return 0;
  }
  function v132Is(g, field, val) { return v132(g, field) === (val | 0) ? 1 : 0; }

  /**
   * *label_4283（590557-590657）—— 按身体装备槽批量生成物品。
   * 223808-223810 由职业 13（冒険者）死亡触发；220026 / 220075 / 220087 等是 NPC 创建。
   * `itemcreate var_581, 0, -1, -1, 0` 的第一参是角色下标 → 物品进死者背包，
   * 源码如此（并不落地），本项目照做；label_4282 的命名链由 ItemDB 代劳。
   */
  function adventurerGear(g, dead, out) {
    const I = Elona.ItemDB;
    if (!I || !I.create) return 0;
    const R = (n) => rndOf(g)(Math.max(1, n | 0));
    const inv = dead.inv || (dead.inv = []);
    const isAdv = (dead.get(150) | 0) === ADVENTURER_JOB;
    let made = 0;
    for (let rep = 0; rep < 100; rep++) {
      // 590561-590582：最多随机 4 次找空槽；被占用且非装备 / 非 no-drop 就清掉再用
      let slot = -1;
      for (let k = 0; k < 4; k++) {
        const i = R(Math.max(1, inv.length));
        const o = inv[i];
        if (!o || !(o.f[0] | 0)) { slot = i; break; }
        if ((o.eqSlot | 0) !== 0) continue;
        if (Elona.ItemDB.ibit && Elona.ItemDB.ibit(12, o)) continue;
        o.f[0] = 0; slot = i; break;
      }
      if (slot < 0) slot = Math.max(0, inv.length - 1);
      // 590590-590632：从 var_58(100..129) 的身体槽类型挑一个 var_638 / var_639
      let cat = null;
      for (let cnt = 100; cnt < 130; cnt++) {
        const t = idiv(dead.get(cnt) | 0, 10000);
        if (t === 0) break;
        if (ADV_SLOT_CAT[t]) { cat = ADV_SLOT_CAT[t]; break; }
      }
      if (!cat) break;                                   // 590633-590635
      const it = I.create(g, {
        level: dead.get(38) | 0,                        // 590584 `flt lv, 3` 直传
        fix: isAdv ? 3 : I.calcFixLv(2, g),
        t638: cat.t638 | 0, t639: cat.t639 | 0,
      });
      if (!it) break;                                  // 590637-590639
      it.f[8] = 3;                                     // 590640
      it.f[29] = 0;                                    // 590649
      inv[slot] = it;
      made++;
      if (!isAdv && R(3)) break;                        // 590651-590655
    }
    if (out && made) out.adventurerGear = made;
    return made;
  }

  function v126Is(g, n) {
    if (Elona.World && Elona.World.getV126) {
      try { return Elona.World.getV126(g, n) | 0; } catch (e) { return 0; }
    }
    return 0;
  }

  function clockHours(g) {
    if (Elona.Status && Elona.Status.clockHours) return Elona.Status.clockHours(g);
    const V = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    return V(13) + V(12) * 24 + V(11) * 24 * 30 + V(10) * 24 * 30 * 12;
  }

  /**
   * 201254-201313：击杀奖励标志 var_1174-1180（决定尸体 / 残骸 / 卵 / 奶掉落）。
   * 依赖击杀者的「解剖」技能 161 与同伴队伍。
   * 同时实现 201303 / 201305 的 skillexp 161（wiki「解剖学」的经验那一段）。
   */
  function computeKillFlags(g, dead, killer) {
    const R = (n) => rndOf(g)(Math.max(1, n | 0));
    const flags = {
      v1173: 0, v1174: 0, v1175: 0, v1176: 0, v1177: 0,
      v1178: 0, v1180: 0, v38: 0, v386: 0, dollAlready: false,
    };
    if (R(60) === 0) flags.v1174 = 1;
    // 源码 prm_987 的「无来源伤害」是 -2（毒 / 出血 / 地形 / 嘴炮等），
    // 本项目 ai.js 对这类死亡传 null；映射到 -2 才能顺带触发 223075 的 var_1180。
    const kidx = killer ? (killer.index | 0) : -2;
    if (killer && kidx >= 0) {
      if ((killer.get(27) | 0) === 260 && (killer.get(9) | 0) === 10) flags.v1173 = kidx;
      let v1179 = (killer.skill ? (killer.skill(161) | 0) : 0) + 1;
      if ((killer.skill ? (killer.skill(161) | 0) : 0) > 0) v1179 += 50;
      if ((killer.get(9) | 0) === 10 || kidx === 0) {
        const charas = g.charas || [];
        for (let cnt = 1; cnt < 16; cnt++) {
          const c = charas[cnt];
          if (!c || (c.get(0) | 0) !== 1) continue;
          if (cnt === kidx) continue;
          v1179 += (c.skill ? (c.skill(161) | 0) : 0) + 1;
        }
      }
      const root = Math.trunc(Math.sqrt(Math.max(0, v1179)));
      if (root > R(150) && R(3) === 0) flags.v1174 = 1;
      if (root > R(150) && R(3) === 0) flags.v1175 = 1;
      if (root > R(150) && R(3) === 0) flags.v1176 = 1;
      if (root > R(150) && R(3) === 0) flags.v1177 = 1;
      // 201303：击杀者获得 10 + (C+E+M+R)*4 解剖经验
      const n = flags.v1174 + flags.v1175 + flags.v1176 + flags.v1177;
      if (Elona.Stats && Elona.Stats.skillExp) {
        try { Elona.Stats.skillExp(killer, 161, kidx, 10 + n * 4, 0, 0, g); } catch (e) { /* 无技能表 */ }
        // 201305：击杀者是死灵术生物（cbit 992）→ 玩家另得 30 + (C+E+M+R)*8
        if (cbit(killer, 992) === 1 && g.charas && g.charas[0]) {
          try { Elona.Stats.skillExp(g.charas[0], 161, 0, 30 + n * 8, 0, 0, g); } catch (e) { /* 同上 */ }
        }
      }
    } else {
      flags.v1178 = 1;
    }
    if (kidx === -2) flags.v1180 = 1;
    // 201316：只在本次死亡内有效；201320 由调用点复位。这里用 flags 传递，避免全局污染。
    if (kidx === -31 || kidx === -30) flags.v386 = 100;
    return flags;
  }

  /**
   * 222393-222473：黑猫舔装备。
   * 判据（201259-201265）：击杀者是 种族 260（黒猫）且关系 10（同伴）。
   * 条件：ibit(8) 未置、类别 < 50000、装备部位 f[4] >= 3。
   * 附魔：idx = (死者 魔力技(16) + 玩家 技19) \ 10，只处理 0..9：
   *   (死者16 + 猫16) \ 2 == 0 → 20050+idx（威力 101）
   *   否则 idx 0 → 20060/51；1..8 → 10010+idx/301；9 → 10018/201（222438-222467）。
   */
  function catLick(g, dead, killer, it) {
    if (!killer || !Elona.ItemDB || !Elona.ItemDB.encadd) return null;
    if ((killer.get(27) | 0) !== 260 || (killer.get(9) | 0) !== 10) return null;
    if (Elona.ItemDB.ibit(8, it) === 1) return null;
    if (((it.f[4] | 0) < 3) || ((Elona.ItemDB.ref(it.id, 5) | 0) >= 50000)) return null;
    Elona.ItemDB.ibitmod(8, it, 1);
    const idx = idiv((dead.skill(16) | 0) + (g && g.charas && g.charas[0] ? (g.charas[0].skill(19) | 0) : 0), 10);
    const paired = idiv((dead.skill(16) | 0) + (killer.skill(16) | 0), 2) === 0;
    if (idx >= 0 && idx <= 9) {
      if (paired) {
        Elona.ItemDB.encadd(it, 20050 + idx, 101, g, {});
      } else if (idx === 0) {
        Elona.ItemDB.encadd(it, 20060, 51, g, {});
      } else {
        Elona.ItemDB.encadd(it, 10010 + Math.min(8, idx), idx === 9 ? 201 : 301, g, {});
      }
    }
    return { name: killer.name || '黑猫' };
  }

  /**
   * 背包逐件判定（222258-222490）。
   * @returns {{item:object, licked:object|null}[]} 掉落的物品
   */
  function dropInventory(g, dead, killer, out) {
    const R = (n) => rndOf(g)(Math.max(1, n | 0));
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    const wind = g.getV65 ? ((g.getV65(250 + 306) | 0) === -2) : false;
    const quality = dead.get(25) | 0;
    const job = dead.get(150) | 0;
    const species = dead.get(27) | 0;
    const dropped = [];
    const inv = dead.inv || [];
    for (let idx = 0; idx < inv.length; idx++) {
      const it = inv[idx];
      if (!it || !(it.f[0] | 0)) continue;               // 222260-222262
      if (job === 20) break;                             // 222265-222267
      let drop = 0;                                      // var_1442
      if ((it.f[4] | 0) > 4 || (it.f[3] | 0) === 55) drop = 1;   // 222268-222270
      if (R(30) === 0) drop = 1;                         // 222271-222273
      if (quality >= 4) {
        if (R(2) === 0) drop = 1;                        // 222274-222278
        if ((it.f[20] | 0) > 0) drop = 1;                // 222279-222283
      }
      if (job === 13 && R(5) !== 0) drop = 0;            // 222284-222288
      if (mapId === 6 && R(4) !== 0) drop = 0;           // 222289-222293
      if ((it.f[4] | 0) === 6) drop = 1;                 // 222294-222296（弹药槽）
      if (wind && (it.f[4] | 0) >= 4) drop = 1;          // 222297-222301
      if (NO_DROP_IDS.indexOf(it.f[3] | 0) >= 0) drop = 0;   // 222302-222325
      if (mapId !== 76 && species === 663 && (it.f[3] | 0) === 948) drop = 0;   // 222326-222332
      if (mapId === 80 && (g.getV65(22) | 0) === 100 && (it.f[3] | 0) === 995) drop = 0;
      const ban = SPECIES_NO_DROP[species];
      if (ban && ban.indexOf(it.f[3] | 0) >= 0) drop = 0;    // 222340-222379
      if (mapId === 74 && job === 4 && (it.f[4] | 0) === 6) drop = 0;   // 222380-222386
      if (Elona.ItemDB && Elona.ItemDB.ibit(12, it) === 1) drop = 1;    // 222387-222389
      if (drop === 0) continue;                          // 222390-222392

      const licked = catLick(g, dead, killer, it);       // 222393-222473
      if (licked) {
        out.messages.push(`${licked.name} 把 ${Elona.ItemDB.name(it.id, 'en')} 舔了舔。`);
      }
      // 222474-222477：清装备槽（保留槽类型）
      if ((it.eqSlot | 0) >= 0) {
        if (Elona.ItemDB && Elona.ItemDB.unequipSlot) Elona.ItemDB.unequipSlot(dead, it.eqSlot | 0);
        it.eqSlot = -1;
      }
      // 222478-222490：落到死亡格，从背包移除
      dropGround(g, it, dead.x | 0, dead.y | 0);
      dropped.push({ item: it, licked: !!licked });
      inv[idx] = null;
    }
    return dropped;
  }

  /**
   * 死亡掉落主入口（*label_2287）。
   * @param {object} g
   * @param {object} dead 死者（prm_985）
   * @param {object|null} killer 击杀者（prm_987；状态/地面效果致死传 null）
   * @returns {object|null} { dropped, gold, goldAll, messages }；不掉落时 null
   */
  function onDeath(g, dead, killer) {
    if (!dead || !dead.get) return null;
    const idx = dead.index | 0;
    if (idx === 0) return null;                          // 222139-222146：玩家
    if (idx < 16) return null;                           // 222147-222155：同伴
    // 222156-222221：死灵从者战死 → 变回暗之棺 903 后直接 return（棺由 necro.js 生成）
    {
      const sp0 = dead.get(27) | 0;
      if (cbit(dead, 992) === 1 && NECRO_COFFIN_SPECIES.indexOf(sp0) >= 0
        && cbit(dead, 960) !== 1 && cbit(dead, 1035) !== 1) return null;
    }
    // 0-FA：地城主击破（状态/掉落路径也要能触发，onBossKilled 自带去重）
    if (Elona.RandDungeon && Elona.RandDungeon.onBossKilled) {
      Elona.RandDungeon.onBossKilled(g, dead);
    }
    const out = { dropped: [], gold: 0, goldAll: 0, messages: [] };
    const R = (n) => rndOf(g)(Math.max(1, n | 0));
    const x = dead.x | 0, y = dead.y | 0;

    // 222221-222223：友军
    if ((dead.get(9) | 0) === 10) return null;
    // 222225-222232：教学洞窟的剧情角色
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    if (mapId === 33) {
      const sp = dead.get(27) | 0;
      if (sp === 185 || sp === 204) return null;
    }
    // 222233-222239：cbit 17 → 全额金币
    if (cbit(dead, 17) === 1) {
      const gold = dead.get(30) | 0;
      if (gold > 0) {
        const pile = Elona.ItemDB ? Elona.ItemDB.createItem(54, gold) : null;
        if (pile) dropGround(g, pile, x, y);
        dead.set(30, 0);
        out.goldAll = gold;
      }
    }
    // 222240-222251：保护位 → 不掉落
    if (cbit(dead, 969) === 1) return out.dropped.length ? out : null;
    if ((cbit(dead, 23) === 1) || (cbit(dead, 27) === 1 && cbit(dead, 964) === 1)) {
      return out.dropped.length ? out : null;
    }
    if (cbit(dead, 964) === 1) return out.dropped.length ? out : null;
    if (cbit(dead, 1015) === 1) return out.dropped.length ? out : null;
    // 222252-222257：以太风时职业 13 只是把关系复位 / 清决斗标记，源码**不 return**，
    // 后面的掉落照常走（旧实现误判成「死而复生 → 不掉落」）
    const wind = g.getV65 ? ((g.getV65(250 + 306) | 0) === -2) : false;
    if (wind && (dead.get(150) | 0) === 13) {
      dead.set(9, dead.get(69) | 0);
      dead.set(201, 0);
    }

    // 222258-222490：背包掉落
    out.dropped = dropInventory(g, dead, killer, out);

    // 222491-222499：金币 /4
    const job = dead.get(150) | 0;
    if (!((job >= 1000 && job < 2000) || job === 2003)) {
      const quality = dead.get(25) | 0;
      if (quality >= 4 || wind || R(10) === 0) {
        const gold = dead.get(30) | 0;
        if (gold > 0) {
          const part = idiv(gold, 4);
          if (part > 0) {
            const pile = Elona.ItemDB ? Elona.ItemDB.createItem(54, part) : null;
            if (pile) dropGround(g, pile, x, y);
            dead.set(30, gold - part);
            out.gold = part;
          }
        }
      }
    }

    // 222500-222536：玩家信仰库米罗米（神 8）→ 杂物加成（等级 = 行动者 var_244）
    const p = (g && g.charas && g.charas[0]) || null;
    const actorLv = killer ? (killer.get(38) | 0) : (dead.get(38) | 0);
    if (p && (p.get(61) | 0) === 8) {
      for (const cat of KUMIROMI_CATS) {
        if (R(30) === 0) makeCatItem(g, cat, actorLv, x, y);
      }
    }

    // 222537-222618：按职业类别掉杂物（等级 = 行动者 var_244）
    const cat = classCat(dead);
    const table = CLASS_DROPS[cat];
    if (table) {
      for (const [denom, c] of table) {
        if (R(denom) === 0) makeCatItem(g, c, actorLv, x, y);
      }
    }

    // 222619-222848：label_2288 —— 按 creature 类别（refchara(种族,3)）掉杂物。
    // 源码对地图 35 的提前 return 在 label_2289 的 222859（在第一段 62000 之后），
    // label_2288 本身不受影响（旧实现整段跳过了）。
    // 0-EZ 的神经支配之线已在能力结算处生成肉人偶；把标记带到 Loot，
    // 避免再生成一具 204，同时让 label_2288 / 2289 的 gated 抑制普通掉落。
    let pendingDoll = 0;
    if (Elona.FleshDoll && typeof Elona.FleshDoll.consume === 'function') {
      pendingDoll = Elona.FleshDoll.consume(g, dead) | 0;
    }
    const dollFlag = pendingDoll > 0 ? 100 : (g.getV65 ? (g.getV65(622) | 0) : 0);
    const killerIdx = killer ? (killer.index | 0) : -1;
    const taskGuard = (killerIdx === -31 || killerIdx === -30) ? 100 : 0;
    raceCatDrops(g, dead, killer, x, y, dollFlag <= 0 && taskGuard === 0);

    // 222848-223811：label_2289 —— 残骸 / 尸体 / 卵 / 标本 / 种族专属
    const flags = computeKillFlags(g, dead, killer);
    if (pendingDoll > 0) {
      flags.v372 = 100;
      flags.dollAlready = true;
    }
    const before = countGround(g, x, y);
    label2289Drops(g, dead, killer, out, flags);
    if (countGround(g, x, y) > before) out.extra = true;

    // 201320：var_65(250+386) 无条件复位（本项目不再写它，这里兼容外部旧调用）
    if (g.setV65) g.setV65(636, 0);
    // 223811：cell_refresh（dropGround 已内部处理）
    return out;
  }

  /** 统计某格地面物品件数（用于判断 label_2289 是否产出） */
  function countGround(g, x, y) {
    if (!Array.isArray(g.groundItems)) return 0;
    let n = 0;
    for (const o of g.groundItems) {
      if (o && o.f && (o.f[5] | 0) === (x | 0) && (o.f[6] | 0) === (y | 0) && (o.f[0] | 0)) n++;
    }
    return n;
  }

  Elona.Loot = {
    onDeath, dropGround, makeCatItem, catLick, classCat, setClassTable,
    setRaceTags, raceTagOf, adventurerGear, v132,
    // 便于测试
    _internals: {
      remainMake, raceCatDrops, label2289Drops, computeKillFlags, refcharaField,
      spawnItem, spawnRandom, specTableDrops, dropInventory,
    },
  };
})(window);
