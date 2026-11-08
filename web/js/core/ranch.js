'use strict';
/**
 * 牧场繁殖（牧場 / 家畜）—— 每日刷新时让牧场里的家畜繁殖。
 *
 * 源码依据（hsp/start.hsp）：
 *   235945-235949  #defcfunc cbreeder   繁殖系数 = refrace(种族,9)*100/(100+等级*5)
 *   235950-236207  *label_2455          牧场每日处理（家畜扫描 → 繁殖 → 新生儿遗传）
 *   249205-249226  日变化时触发：地图类型 var_132(16)==31（牧場）→ gosub *label_2455
 *   284440         调试列显示 cbreeder+1（本实现忽略）
 *   32233-32249    #defcfunc getworker 在 1..15 号角色里找 var_58(80)==mapId 的「牧场主」
 *
 * 关键字段：
 *   var_58(960)   cbit：这只角色是家畜
 *   var_58(407)   遗传字段 A（亲代传给子代，见 childGene）
 *   var_58(408)   遗传字段 B
 *   var_58(21)    出生年（var_65(10)）
 *   var_58(59)    = -5（家畜的友好度初值）
 *   var_58(22)    満腹度，每过一天 -300*天数，下限 4000
 *   var_58(261)   家畜的「已生产」标记 → 参数 +500（该字段语义未确认，按原值使用）
 *   var_132(16)   地图类型：31 = 牧場
 *   var_126(16)   该地图上次刷新的时刻（小时）
 *   var_1823      经过的天数（= 本轮的繁殖判定次数）
 *
 * 判定链（236005-236009）：
 *   rnd(5000) > (cbreeder*100+1)/(100+家畜数*20) - 家畜数*2 → 本轮结束
 *   （家畜数为 0 时还有 1/30 的例外，允许继续）
 * 子代遗传（236011-236143）：对 407/408 各做一次「同组 1/5 概率上/下移」的级联。
 * 子代种族（236145-236198）：rnd(2) 取亲代种族，rnd(10)!=0 时锁定同族，再按 14 条特例改种族。
 *
 * 每日处理的第二段（236208-236390，`*label_2456`）是**家畜产出**：
 *   卵(573) / 乳(574) / フン(575) / 動物の骨(222) 或 クズ(45)，
 *   产出类型由 `var_400 = rnd(5)` 决定；`var_58(261) > 0` 的家畜固定产 575。
 *   累积量（235975-235986）：`var_1820` = 408 在 7..9 加、4..6 减；
 *   `var_1821` = 408 在 10..12 加、1..3 减；`var_1822` = 背包里的 575 数量*100 + (261>0 的家畜)*500。
 *
 * 0-FO 按「畜牧」wiki 页反查后补齐（以 start.hsp 为准，见各方法注释）：
 *   233266-233291  收款机菜单（任命种畜 / 移动家畜 / 撒饲料 / 场内消毒 / 繁殖·生产防止代码）
 *   233870-234003  撒饲料 1071 / 消毒 1155 的实际结算
 *   248946-248969  日变化时清 cbit 1012（梳理冷却）/ 1018（已榨奶）
 *   249205-249226  牧场 var_1823 = limit(天数+1, 1, 30) * 5（旧实现漏了 ×5）
 *   289604-290919  干涉菜单「挖取残骸」5 项 / 「带出来」
 *   298254-298297  赠予奶 574 / 饲料 1071
 *   318882-318973  喝奶（能力 1101）的成长度 var_58(59)
 *   333956-334025  爱抚之手 701 + 大型ブラシ 921 → 梳理计数 var_58(177)
 *   334957-335057  紧抱 710 → 榨奶
 *   415317-415328 / 418985-419035  演技训练 / 活畜献祭菜单
 *   419102-419115  献祭恩惠 15*(梳理计数+1)、信仰经验 limit(好感,1,300)
 *
 * 未移植（如实记录）：
 *   · 牧场地图类型与「牧场主」槽位：原版来自运行期表 var_132(16)/var_58(80)，
 *     本项目用 core/sites.js 的 world_sites.json + 地图名近似；找不到时可用
 *     `Ranch.setWorker()` 或控制台 `ranch worker` 指定
 *   · `var_65(70)` 相关分支、产权书购买与商店陈列（建造部分已在 core/property.js）
 *   · 236285 源码把蛋价值公式里的 `var_99(7, var_579)` 误写成 `var_99(7, cnt)`
 *     （取到另一件物品的重量），wiki 也提到这个 bug；本实现按「设计意图」用蛋自身 f[7]。
 *   · 家畜贴图按成长度缩放、size 角标等纯表现层
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const MAP_TYPE_RANCH = 31;   // var_132(16) == 31
  const F_HERD = 960;          // cbit 960：家畜
  const F_GENE_A = 407;        // 家畜特性 A（皮肉：肉质/皮质/肉量/皮量）
  const F_GENE_B = 408;        // 家畜特性 B（蛋奶：奶量/卵量）
  const F_BIRTH_YEAR = 21;
  const F_GROW = 59;           // 成长度 -5..0（旧注释误写成「友好度初值」）
  const F_NUTRITION = 22;      // 満腹度 4000..10000
  const F_SICK = 261;          // 生病状态计数（旧注释误写成「已生产」标记）
  const F_SICK_BUFF = 250;     // 生病时叠加的毒状态计数
  const F_BRUSH = 177;         // 梳理计数，上限 5
  const F_WEIGHT = 20;         // 体重 kg
  const F_IMP = 17;            // 好感度（modimp）
  const F_MAST = 169;          // 主仆度 / 服从度（modimp2）
  const F_INTEREST = 14;       // 兴趣（演技训练消耗）
  const F_ACTION = 79;         // 行动表情 / 动画
  const CB_BRUSH = 1012;       // 本次牧场更新内已梳理
  const CB_MILK = 1018;        // 本次牧场更新内已榨奶
  const CB_TOIL = 1042;        // 劳动能量（榨奶不扣生命力）
  const CB_NODROP = 13;        // ibit：no-drop（演技训练不能用）
  const CB_HANG = 985;         // 吊り下げ中，不能带出来
  const ITEM_BRUSH = 921;      // 牧畜用の大型ブラシ
  const ITEM_FEED = 1071;      // 家畜の餌
  const ITEM_DISINFECT = 1155; // 浄化消毒薬
  const ITEM_MILK = 574;       // 乳
  const ITEM_BUTTER = 1073;    // バター（投掷 → 梳理计数上限 2）
  const SKILL_PERFORM = 13;    // 演技 / 感知（源码 skillexp 13）
  const SKILL_FAITH = 181;     // 信仰
  const REMAINS_IDS = {        // 289606-289614 的干涉菜单 18..22
    18: 341, 19: 340, 20: 339, 21: 338, 22: 337,
  };

  /** 8741-8742：var_270 / var_271 的家畜特性名（0 表示无特性） */
  const GENE_A = [
    '', '肉质不错', '肉质很好', '肉质极好',
    '皮质不错', '皮质很好', '皮质极好',
    '肉量较少', '肉量很多', '肉量极多',
    '皮量较少', '皮量很多', '皮量极多',
  ];
  const GENE_B = [
    '', '奶的出产似乎不太好', '奶的出产不好', '奶的出产非常不好',
    '不太常产卵', '不怎么产卵', '几乎不产卵',
    '很会产卵', '产卵很多', '产卵极多',
    '奶的出产不错', '奶的出产很好', '奶的出产极好',
  ];

  function cbitOf(c, n) {
    return (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, n) | 0) : 0;
  }
  function setCbit(c, n, v) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, n, !!v);
  }
  function ibitOf(it, n) {
    return (it && Elona.ItemDB && Elona.ItemDB.ibit) ? (Elona.ItemDB.ibit(n, it) | 0) : 0;
  }
  function rndOf(g) {
    return (n) => (g && g.rng && typeof g.rng.rnd === 'function')
      ? (g.rng.rnd(Math.max(1, n | 0)) | 0) : 0;
  }
  function logMsg(g, s) {
    if (!g || !s) return;
    if (typeof g.log === 'function') g.log(s);
    else if (Array.isArray(g.messages)) g.messages.push(s);
  }
  /** modimp / modimp2：源码把好感 17 与主从 169 分别累加（递减由其它模块处理） */
  function modImp(c, v) { if (c) c.set(F_IMP, (c.get(F_IMP) | 0) + (v | 0)); }
  function modImp2(c, v) { if (c) c.set(F_MAST, (c.get(F_MAST) | 0) + (v | 0)); }
  function skillExp(g, c, id, exp) {
    if (Elona.Stats && Elona.Stats.skillExp && c) {
      try { Elona.Stats.skillExp(c, id, c.index | 0, exp | 0, 0, 0, g); } catch (e) { /* 无技能表 */ }
    }
  }
  /** var_132(37/39, mapId)：繁殖/生产防止代码，存在地图实例上 */
  function mapFlag(g, field) {
    if (!g || !g.map) return 0;
    const f = g.map.ranchFlags || (g.map.ranchFlags = {});
    return f[field] | 0;
  }
  function setMapFlag(g, field, v) {
    if (!g || !g.map) return;
    const f = g.map.ranchFlags || (g.map.ranchFlags = {});
    f[field] = v | 0;
  }
  function isHerd(c) { return !!c && cbitOf(c, F_HERD) === 1; }
  function nameOfC(c) { return (c && (c.name || '家畜')) || '家畜'; }

  /** inv_find / item_find：在角色背包里找指定 id 且数量 >0 的物品 */
  function findItem(g, id, owner) {
    const inv = owner ? owner.inv : (g && g.groundItems);
    if (!Array.isArray(inv)) return null;
    for (const it of inv) {
      if (it && (it.f[0] | 0) > 0 && (it.f[3] | 0) === (id | 0)) return it;
    }
    return null;
  }
  function consumeOne(it) {
    if (!it) return;
    it.f[0] = Math.max(0, (it.f[0] | 0) - 1);
  }
  /** 落到玩家脚下（等价 itemcreate -1, id, var_58(1,0), var_58(2,0)） */
  function dropAtPlayer(g, id, cnt) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem || !g || !g.player) return null;
    let it = null;
    try { it = Elona.ItemDB.createItem(id | 0, cnt || 1); } catch (e) { return null; }
    if (!it) return null;
    it.f[5] = g.player.x | 0; it.f[6] = g.player.y | 0;
    if (Array.isArray(g.groundItems)) g.groundItems.push(it);
    if (typeof g.refreshGroundCell === 'function') g.refreshGroundCell(it.f[5], it.f[6]);
    return it;
  }
  /** remain_make 的公共部分（31286-31309）；ranch 挖残骸用 */
  function remainFields(it, c) {
    if (!it || !c) return it;
    it.f[23] = c.get(27) | 0;
    it.f[22] = idiv((c.get(7) | 0) - (c.get(435) | 0) * 1000, 1000);
    it.f[7] = limit(idiv((c.get(20) | 0) + 1, 10) * 50, 0, 5000);
    it.f[1] = limit((c.get(38) | 0) * 40 + 600, 1, 12000);
    it.f[20] = 0;
    return it;
  }

  /** 子代种族特例（236154-236198）：亲代种族 id → 子代种族 id */
  const SPECIES_OVERRIDE = {
    319: 176, 332: 164, 35: 36, 570: 10,
    534: 323, 414: 323, 203: 323,
    484: 149, 483: 149,
    482: 1, 481: 1,
    359: 347, 360: 347,
    306: 337, 356: 337,
    357: 245, 338: 245,
    355: 19, 339: 19,
    358: 171, 342: 171,
    331: 164, 336: 164,
    435: 452, 458: 452,
  };

  const Ranch = {
    _races: null,

    async load() {
      if (!this._races && Elona.Data) this._races = await Elona.Data.table('race_class');
      return this._races;
    },

    /** 同步取种族表（启动预加载后可同步拿到） */
    races() {
      if (!this._races && Elona.Data && Elona.Data.tableSync) {
        const t = Elona.Data.tableSync('race_class');
        if (t) this._races = t;
      }
      return this._races;
    },

    /**
     * 地图类型 —— var_132(16, mapId)。
     * 数据源是 core/sites.js 的 world_sites.json（0-BK 起不再按名字猜）。
     */
    mapType(g) {
      if (!g || !g.map) return 0;
      const v = g.map.mapType | 0;                   // 显式指定（控制台/测试用）
      if (v) return v;
      const S = Elona.Sites;
      if (S && typeof S.ready === 'function' && S.ready()) {
        const t = S.typeOf(g.getV65 ? (g.getV65(20) | 0) : 0, { mapName: g.map.name }, g);
        if (t) return t;
      }
      return /^ranch/i.test(g.map.name || '') ? MAP_TYPE_RANCH : 0;
    },

    /**
     * 该地图的 worker 键（var_65(20)）。
     * 本项目的随机迷宫没有 var_65(20)（恒 0），此时退回 1，避免所有地图共用同一个种畜。
     */
    workerKey(g) {
      return (g.getV65(20) | 0) || 1;
    },

    /**
     * getworker（32233-32249）：在 1..15 号角色里找 var_58(80)==mapId。
     * 原版 1..15 是「店员/家畜」专用槽；本项目没有槽位约定（NPC 分散在任意下标），
     * 所以先按原版顺序找 1..15，找不到再放宽到全表（见差异报告）。
     */
    getWorker(g, mapId) {
      const id = (mapId === undefined) ? this.workerKey(g) : (mapId | 0);
      if (id <= 0) return null;
      let fallback = null;
      for (let i = 0; i < g.charas.length; i++) {
        const c = g.charas[i];
        if (!c || (c.get(0) | 0) !== 1) continue;
        if ((c.get(80) | 0) !== id) continue;
        if (i >= 1 && i <= 15) return c;      // 原版槽位优先
        if (!fallback) fallback = c;
      }
      return fallback;
    },

    /** 把某只角色登记为该地图的「牧场主/种畜」（相当于写入 var_58(80)） */
    setWorker(c, mapId) {
      if (!c) return false;
      c.set(80, (mapId | 0) || 1);
      return true;
    },

    /** cbreeder（235945-235949） */
    breederRate(c) {
      if (!c) return 0;
      const t = this.races();
      const key = c.raceName || (t && t.raceList && (t.raceList[c.race | 0] || [])[0]) || '';
      let v = 0;
      if (t && t.races && t.races[key] && t.races[key].fields) {
        v = t.races[key].fields['9'] | 0;      // refrace(种族, 9)
      }
      return idiv(v * 100, 100 + (c.get(38) | 0) * 5);
    },

    /** 牧场里的家畜（cbit(960)） */
    herdList(g) {
      const out = [];
      for (const c of g.charas) {
        if (!c || (c.get(0) | 0) !== 1) continue;
        if (Elona.Status && Elona.Status.cbit(c, F_HERD) === 1) out.push(c);
      }
      return out;
    },

    /**
     * 子代遗传（236011-236143）：对 407/408 各做一次级联。
     * 注意第 1 组的三条**都会掷骰**（后写的覆盖前面的），与原版一致。
     */
    childGene(v, R) {
      let out = 0;
      if (v >= 2 && v <= 3 && R(5) === 0) out = 3;
      if (v >= 1 && v <= 3 && R(5) === 0) out = 2;
      if (v >= 0 && v <= 3 && R(5) === 0) out = 1;
      if (out === 0) {
        if (v >= 5 && v <= 6 && R(5) === 0) out = 6;
        if (v >= 4 && v <= 6 && R(5) === 0) out = 5;
        if ((v === 0 || (v >= 4 && v <= 6)) && R(5) === 0) out = 4;
      }
      if (out === 0) {
        if (v >= 8 && v <= 9 && R(5) === 0) out = 9;
        if (v >= 7 && v <= 9 && R(5) === 0) out = 8;
        if ((v === 0 || (v >= 7 && v <= 9)) && R(5) === 0) out = 7;
      }
      if (out === 0) {
        if (v >= 11 && v <= 12 && R(5) === 0) out = 12;
        if (v >= 10 && v <= 12 && R(5) === 0) out = 11;
        if ((v === 0 || (v >= 10 && v <= 12)) && R(5) === 0) out = 10;
      }
      return out;
    },

    /**
     * 每日处理（*label_2455）。原版由日变化触发（249205-249226）。
     * @param {object} g
     * @param {object} [opts] { parent, attempts }
     * @returns {{ok:boolean, attempts:number, born:Array, messages:string[]}|null}
     */
    tickDay(g, opts) {
      const o = opts || {};
      if (this.mapType(g) !== MAP_TYPE_RANCH) return null;

      // var_126(16)：该地图上次刷新时刻（本项目存在地图实例属性上，重载地图会重置）
      const now = this.nowHour(g);
      if (g.map.refreshTime === undefined) g.map.refreshTime = now;
      if (now < g.map.refreshTime) return null;

      let attempts = o.attempts;
      if (attempts === undefined) {
        // 249209-249223：首次刷新 var_126(16)==0 → 1 次；之后牧场
        // `var_1823 = limit((now - var_126(16))/24 + 1, 1, 30) * 5`（旧实现漏了 ×5）
        attempts = g.map.refreshTime === 0
          ? 1 : limit(idiv(now - g.map.refreshTime, 24) + 1, 1, 30) * 5;
        attempts = Math.max(1, attempts);
      }
      g.map.refreshTime = now;
      // 248946-248969：renew_major 时清掉「本次更新内已梳理 / 已榨奶」标记
      this.clearDailyFlags(g);

      const parent = o.parent || this.getWorker(g);
      if (!parent) {
        return { ok: false, attempts, born: [], messages: ['牧场里还没有种畜（var_58(80) 未设置）。'] };
      }
      const born = this.breedRound(g, parent, attempts);
      const prod = this.produceRound(g);
      if (prod) {
        born.messages.push(...prod.messages);
        born.produced = prod.produced;
        born.herd = prod.herd;
      }
      return born;
    },

    /**
     * 家畜产出（236208-236390，`*label_2456`）。
     * 每只家畜（含牧场主）在围栏的随机空地生成 卵/乳/粪/骨/垃圾。
     * @param {object} g
     * @param {object} [opts] { herd }
     */
    produceRound(g, opts) {
      const o = opts || {};
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      const res = { ok: true, produced: [], messages: [], herd: 0, made: 0 };
      const herd = o.herd || this.herdList(g);
      res.herd = herd.length;
      const p = g.player;

      // 235957-235986：累积量。
      // 源码 `inv_getheader -1` 扫的是**地面物品**（不是玩家背包）：每堆 575 +100；
      // 再按家畜 261>0（生病）每只 +500。0-FO 修正：旧实现错扫了玩家背包。
      let n20 = 0, n21 = 0, n22 = 0;
      if (Array.isArray(g.groundItems)) {
        for (const it of g.groundItems) {
          if (it && (it.f[0] | 0) > 0 && (it.f[3] | 0) === 575) n22 += 100;
        }
      }
      for (const c of herd) {
        if ((c.get(F_SICK) | 0) > 0) n22 += 500;
        const v = c.get(F_GENE_B) | 0;                    // 408
        if (v >= 7 && v <= 9) n20 += v;
        if (v >= 4 && v <= 6) n20 -= v;
        if (v >= 10 && v <= 12) n21 += v;
        if (v >= 1 && v <= 3) n21 -= v;
      }

      const worker = this.getWorker(g);
      let made = 0;                                        // var_1826
      for (const c of g.charas) {
        if (!c || (c.get(0) | 0) !== 1) continue;          // 236214
        const isHerd = !!(Elona.Status && Elona.Status.cbit(c, F_HERD) === 1);
        if (!isHerd && c !== worker) continue;             // 236217
        if (c !== worker) {
          // 236221-236231：消毒 buff 60 期间不染病；否则 rnd(10000)<=肮脏度 → 生病计数 +30，
          // 已有生病计数 → 毒状态计数 250 +30（wiki 的「肮脏度与消毒药」）
          const hasBuff = (Elona.Status && Elona.Status.findbuff)
            ? (Elona.Status.findbuff(c, 60) !== -1) : false;
          if (!hasBuff) {
            if (R(10000) <= n22 && (c.get(F_SICK) | 0) < 100) {
              c.set(F_SICK, (c.get(F_SICK) | 0) + 30);
            }
            if ((c.get(F_SICK) | 0) > 0 && (c.get(F_SICK_BUFF) | 0) < 100) {
              c.set(F_SICK_BUFF, (c.get(F_SICK_BUFF) | 0) + 30);
            }
          }
          if ((c.get(F_SICK) | 0) > 0) c.set(F_ACTION, 8 + 100 * 30);   // 236233-236235
        }
        // 236237-236239：生产防止代码 var_132(39)==10 → break（生病判定仍已执行）
        if (mapFlag(g, 39) === 10) break;
        if ((c.index | 0) === 0) continue;                 // 236240
        // 236243-236247：围栏内的随机空地
        const x = limit(R(11) + 4, 0, g.map.width - 1);
        const y = limit(R(8) + 4, 0, g.map.height - 1);
        const cell = g.map.cell(x, y);
        if (!cell || (cell[4] | 0) !== 0) continue;
        let type = R(5);                                   // var_400
        if (R(made + 1) > 2) continue;                     // 236251-236253
        // 236254-236273：家畜越多越难产
        if (herd.length > 10 && R(4) === 0) continue;
        if (herd.length > 20 && R(4) === 0) continue;
        if (herd.length > 30 && R(4) === 0) continue;
        if (herd.length > 40 && R(4) === 0) continue;
        if ((c.get(F_SICK) | 0) > 0) type = 2;              // 236274-236276
        const level = Elona.ItemDB.calcObjLv(c.get(38) | 0, g);   // 236248
        const drop = (id) => {
          const it = this.dropItem(g, id, x, y, level, 2);
          if (it) res.produced.push(it);
          return it;
        };

        if (type === 0) {                                  // 卵 573
          if (n20 > 1 && R(n20) > R(80)) {
            const it = drop(573);
            if (it) this.fillEgg(it, c);
          }
          if (n20 < 1 && n20 + R(100) < 0) made++;
          if (R(60) === 0 || ((c.race | 0) === 195 && R(20) === 0)) {
            made++;
            const it = drop(573);
            if (it) this.fillEgg(it, c);
          }
          continue;
        }
        if (type === 1) {                                  // 乳 574
          if (n21 > 1 && R(n21) > R(50)) {
            const it = drop(574);
            if (it) it.f[23] = c.race | 0;
          }
          if (n21 < 1 && n21 + R(100) < 0) made++;
          const sp = (c.race | 0) === 772 || (c.race | 0) === 1107;
          if (R(60) === 0 || (c.raceName === 'sheep' && R(20) === 0) || (sp && R(20) === 0)) {
            made++;
            const it = drop(574);
            if (it) it.f[23] = c.race | 0;
          }
          continue;
        }
        if (type === 2) {                                  // フン 575
          if (R(80) === 0) {
            const it = drop(575);
            if (it) {
              it.f[23] = c.race | 0;
              it.f[7] = limit(idiv(c.get(20) | 0, 10) * 150, 30, 15000);
              it.f[1] = limit(idiv((c.get(20) | 0) + 3600, 4), 900, 4500);
            }
          }
          continue;
        }
        if (type === 3) {                                  // 骨 / 垃圾
          if (R(80) === 0) drop(R(2) ? 45 : 222);
          continue;
        }
        // type 4：什么也不产
      }
      res.made = made;
      if (made > 0) res.messages.push(`牧场里产出了 ${made} 样东西。`);
      return res;
    },

    /** 卵 573 的重量与价值（236284-236285） */
    fillEgg(it, c) {
      it.f[23] = c.race | 0;
      it.f[7] = limit(idiv(c.get(20) | 0, 10) * 40, 20, 10000);
      it.f[1] = limit(idiv((it.f[7] | 0) + 2400, 4), 600, 3000);
      return it;
    },

    /** itemcreate(-1, id, x, y, 0)：直接落到地面 */
    dropItem(g, id, x, y, level, fix) {
      let it = null;
      try {
        it = Elona.ItemDB.createItem(id, 1);
      } catch (e) { it = null; }
      if (!it) return null;
      it.f[5] = x; it.f[6] = y;
      if (level !== undefined) it.genLevel = level;
      if (fix !== undefined) it.genFix = fix;
      if (g.groundItems) g.groundItems.push(it);
      const cell = g.map.cell(x, y);
      if (cell) cell[4] = 1;
      if (typeof g.refreshGroundCell === 'function') g.refreshGroundCell(x, y);
      return it;
    },

    /**
     * 繁殖循环（236005-236207）。
     * @param {object} g
     * @param {object} parent 种畜（var_1803）
     * @param {number} attempts 判定次数（var_1823）
     */
    breedRound(g, parent, attempts) {
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      const n = Math.max(0, attempts | 0);
      const res = { ok: true, attempts: n, born: [], messages: [], herd: 0, fed: 0 };
      if (!parent) { res.ok = false; return res; }

      // 235957-235992：家畜扫描（数量、遗传、饱食度）
      const herd = this.herdList(g);
      res.herd = herd.length;
      for (const c of herd) {
        if ((c.get(F_SICK) | 0) > 0) res.fed += 500;
        // 236011-236143 的遗传值只用于子代，这里不做累计（原版的 var_1820/1821 未参与判定）
        c.set(F_NUTRITION, Math.max(4000, (c.get(F_NUTRITION) | 0) - n * 300));
      }

      const rate = this.breederRate(parent);
      const key = parent.raceName || '';
      const year = g.getV65(10) | 0;

      // 235994-235999：种畜不存在或繁殖防止代码 var_132(37)==10 → 跳过整个繁殖循环
      // （源码 goto *label_2456，产出仍会执行；这里由 tickDay 接着调 produceRound）
      if (mapFlag(g, 37) === 10) {
        res.ok = true; res.prevented = true;
        return res;
      }

      for (let k = 0; k < n; k++) {
        // 236000-236003：quickling 有 2/10 概率直接结束
        if (key === 'quickling' && R(10) >= 8) break;
        // 236005-236008
        const th = idiv(rate * 100 + 1, 100 + res.herd * 20) - res.herd * 2;
        if (R(5000) > th) {
          if (res.herd !== 0 || R(30) !== 0) break;
        }
        // 236010-236143：子代遗传
        const geneA = this.childGene(parent.get(F_GENE_A) | 0, R);
        const geneB = this.childGene(parent.get(F_GENE_B) | 0, R);
        // 236144-236153：生成等级 = 亲代等级，品质 1；种族 rnd(2) 取亲代
        let species = R(2) !== 0 ? (parent.race | 0) : 0;
        // 236154-236198：特例种族
        const ov = SPECIES_OVERRIDE[parent.race | 0];
        if (ov !== undefined) species = ov;
        if ((parent.get(25) | 0) === 6) species = 323;    // 236166-236168
        // 236199：characreate(-1, 种族, 4+rnd(11), 4+rnd(8))
        const level = 4 + R(11);
        const fix = 4 + R(8);
        const baby = this.spawnChild(g, parent, species, level, fix);
        if (baby) {
          // 236201-236206
          if (Elona.Status) Elona.Status.cbitmod(baby, F_HERD, true);
          baby.set(F_BIRTH_YEAR, year);
          baby.set(F_GROW, -5);
          baby.set(F_GENE_A, geneA);
          baby.set(F_GENE_B, geneB);
          res.born.push(baby);
          res.herd++;
          res.messages.push(`${this.nameOf(baby)} 出生了。`);
        }
      }
      return res;
    },

    spawnChild(g, parent, species, level, fix) {
      if (!Elona.CharaFactory) return null;
      const pos = this.freeCellNear(g, parent.x, parent.y);
      let c = null;
      try {
        c = Elona.CharaFactory.create(g, species | 0, level, pos.x, pos.y, { var641: fix });
      } catch (e) { c = null; }
      return c;
    },

    /** 亲代身边找一个可站的格子（原版 characreate 的 x=-1 分支） */
    freeCellNear(g, x, y) {
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      for (let k = 0; k < 20; k++) {
        const tx = limit(x - 2 + R(5), 0, g.map.width - 1);
        const ty = limit(y - 2 + R(5), 0, g.map.height - 1);
        const cell = g.map.cell(tx, ty);
        if (!cell) continue;
        if ((g.map.attr(cell[0], 7) & 4) !== 0) continue;      // 不可通行
        const chk = g.map.check ? g.map.check(tx, ty) : { charaIndex: -1 };
        if (chk && chk.charaIndex >= 0) continue;
        return { x: tx, y: ty };
      }
      return { x, y };
    },

    nameOf(c) {
      if (!c) return '家畜';
      if (typeof c.name === 'function') return c.name('en') || '家畜';
      return c.name || '家畜';
    },

    nowHour(g) {
      const V = (k) => g.getV65(k) | 0;
      return V(13) + V(12) * 24 + V(11) * 24 * 30 + V(10) * 24 * 30 * 12;
    },

    // ==================================================================
    // 0-FO：畜牧照料 / 副产品 / 干涉（逐段对应 start.hsp）
    // ==================================================================

    /** 248959-248969：renew_major 时清 cbit 1012（梳理）/ 1018（榨奶） */
    clearDailyFlags(g) {
      if (!g || !Array.isArray(g.charas)) return 0;
      let n = 0;
      for (const c of g.charas) {
        if (!c || (c.get(0) | 0) !== 1) continue;
        if (cbitOf(c, CB_BRUSH) === 1) { setCbit(c, CB_BRUSH, 0); n++; }
        if (cbitOf(c, CB_MILK) === 1) { setCbit(c, CB_MILK, 0); n++; }
      }
      return n;
    },

    isRanch(g) { return this.mapType(g) === MAP_TYPE_RANCH; },
    /** 源码 333956 / 334959 / 289604：家畜 cbit 960 或本图牧场主都算「畜牧对象」 */
    isLivestock(g, c) { return !!c && (isHerd(c) || c === this.getWorker(g)); },

    /** 8741-8742：梳理时显示的家畜特性（407 皮肉 / 408 蛋奶） */
    geneText(c) {
      const a = c ? (c.get(F_GENE_A) | 0) : 0;
      const b = c ? (c.get(F_GENE_B) | 0) : 0;
      const texts = [];
      if (a > 0 && GENE_A[a]) texts.push(GENE_A[a]);
      if (b > 0 && GENE_B[b]) texts.push(GENE_B[b]);
      return { a, b, texts };
    },

    /**
     * 333956-334025：爱抚之手 701 + 大型ブラシ 921 → 梳理。
     * 条件：玩家发动、目标是家畜/种畜、在牧场、背包持有 921。
     * cbit 1012 = 本次牧场更新内已梳理 → 只显示特性、不加计数。
     * 效果：f[177] +1（上限 5）、modimp +10、置 cbit 1012。
     */
    brush(g, actor, target, opts) {
      const res = { ok: false, reason: '', genes: [], message: '' };
      if (!this.isRanch(g)) { res.reason = 'not-ranch'; return res; }
      if (!actor || (actor.index | 0) !== 0) { res.reason = 'not-player'; return res; }
      if (!this.isLivestock(g, target)) { res.reason = 'not-livestock'; return res; }
      const it = (opts && opts.item) || findItem(g, ITEM_BRUSH, g.player);
      if (!it || (it.f[0] | 0) < 1) {
        res.reason = 'no-brush';
        res.message = '身上没有牧畜用大型刷子（921），无法梳理。';
        return res;
      }
      const gene = this.geneText(target);
      res.genes = gene.texts.slice();
      const who = nameOfC(target);
      logMsg(g, `${nameOfC(actor)}给${who}梳了梳毛。`);
      if (gene.texts.length) logMsg(g, `家畜特性：${gene.texts.join('；')}。`);
      if (cbitOf(target, CB_BRUSH) === 1) {
        res.reason = 'cooldown';
        res.message = '最近刚梳理过，这次只能看看家畜特性。';
        logMsg(g, res.message);
        return res;
      }
      target.set(F_ACTION, 6 + 100 * 3);                       // 334019
      const n = Math.min(5, (target.get(F_BRUSH) | 0) + 1);   // 334020-334023
      target.set(F_BRUSH, n);
      modImp(target, 10);                                       // 334024
      setCbit(target, CB_BRUSH, 1);                             // 334025
      res.ok = true; res.brushCount = n;
      res.message = `梳理完成（${who} 的梳理计数 ${n}/5）。`;
      logMsg(g, res.message);
      return res;
    },

    /**
     * 334957-335057：紧抱 710 → 榨奶。
     * 条件：牧场 + 家畜/种畜；cbit 1018 已榨过、成长度 f[59] != 0 都拒绝；
     * 生命力 sorg(2)<=2 时需要二次确认（确认后榨干致死）。
     * 奶 574 的 f[20] = 177 + (408 in 10..12 ? 408-9 : 0) + 5 + 59
     *                 + rnd(limit(player.skill(12)/100,0,2)+1)。
     */
    milk(g, actor, target, opts) {
      const res = { ok: false, reason: '', message: '' };
      if (!this.isRanch(g)) { res.reason = 'not-ranch'; return res; }
      if (!actor || (actor.index | 0) !== 0) { res.reason = 'not-player'; return res; }
      if (!this.isLivestock(g, target)) { res.reason = 'not-livestock'; return res; }
      if (cbitOf(target, CB_MILK) === 1) {
        res.reason = 'empty'; res.message = '还没攒下奶，等下一次牧场更新吧。';
        logMsg(g, res.message); return res;
      }
      const grow = target.get(F_GROW) | 0;
      if (grow !== 0) {
        res.reason = 'young'; res.message = '还没长大到能榨奶的程度。';
        logMsg(g, res.message); return res;
      }
      const life = (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(target, 2) | 0) : 0;
      if (life <= 2 && !(opts && opts.force)) {
        res.reason = 'confirm';
        res.message = '硬榨下去它会死，确定要继续吗？（force）';
        return res;
      }
      const R = rndOf(g);
      const geneB = target.get(F_GENE_B) | 0;
      const geneBonus = (geneB >= 10 && geneB <= 12) ? geneB - 9 : 0;   // 335002-335004
      const skill12 = (g.player && g.player.skill) ? (g.player.skill(12) | 0) : 0;
      const dice = R(limit(idiv(skill12, 100), 0, 2) + 1);
      const it = dropAtPlayer(g, ITEM_MILK, 1);
      if (it) {
        it.f[23] = target.get(27) | 0;
        it.f[20] = (target.get(F_BRUSH) | 0) + geneBonus + 5 + grow + dice;
        res.item = it;
      }
      setCbit(target, CB_MILK, 1);
      res.ok = true;
      res.message = `从${nameOfC(target)}身上榨出了浓奶。`;
      logMsg(g, res.message);
      if (cbitOf(target, CB_TOIL) === 1) {
        setCbit(target, CB_TOIL, 0);                            // 335038-335046
        res.energy = true;
        logMsg(g, `${nameOfC(target)}靠劳动能量撑住了疲劳。`);
      } else if (life <= 2) {
        // 334996-335013：榨干 → evadd 68（死亡）
        if (Elona.Chara && Elona.Chara.vanquish) Elona.Chara.vanquish(g, target.index | 0);
        res.killed = true;
      } else {
        // 335055：skillmod 2, target, -sorg(2)/2*1000（生命力减半）
        if (Elona.Stats && Elona.Stats.skillMod) {
          Elona.Stats.skillMod(target, 2, target.index | 0, -idiv(life, 2) * 1000, g);
        }
        res.weakened = true;
      }
      return res;
    },

    /** 298254-298297：赠予家畜 574 乳 / 1071 饲料 / 1073 黄油等 */
    giveItem(g, target, item) {
      if (!item) return { ok: false, reason: 'no-item' };
      const id = item.f[3] | 0;
      if (id === ITEM_MILK) {
        if (!isHerd(target)) return { ok: false, reason: 'not-livestock' };
        if ((target.get(F_NUTRITION) | 0) >= 8000) {
          const m = '「现在肚子饱饱的！」';
          logMsg(g, m);
          return { ok: false, reason: 'full', message: m };
        }
        const bless = item.f[17] | 0;
        consumeOne(item);
        return this.drinkMilk(g, target, bless);
      }
      if (id === ITEM_FEED) {
        if ((target.get(F_NUTRITION) | 0) >= 10000) return { ok: false, reason: 'full' };
        return this.feedOne(g, target, item);
      }
      // 341180-341191 黄油(1073) 上限 2；354635-354645 盐/胡椒/砂糖/酱油 上限 4
      if (id === ITEM_BUTTER || [204, 205, 206, 207].indexOf(id) >= 0) {
        return this.seasoning(g, target, item, id === ITEM_BUTTER ? 2 : 4);
      }
      return { ok: false, reason: 'not-feed' };
    },

    /** 298272-298297：喂一份家畜饲料 */
    feedOne(g, target, item) {
      if (!isHerd(target)) return { ok: false, reason: 'not-livestock' };
      consumeOne(item);
      const bonus = item.f[20] | 0;
      // 298286-289：inv_find 1114（肥胖上限道具）没找到才增重
      const base = limit(target.get(F_WEIGHT) | 0, 1, 100000000);
      const gain = idiv(base * (bonus + 1), 100) + bonus + 1;
      target.set(F_WEIGHT, (target.get(F_WEIGHT) | 0) + gain);
      target.set(F_NUTRITION, (target.get(F_NUTRITION) | 0) + 2500);
      const msg = `给${nameOfC(target)}喂了家畜饲料，体重增加到 ${target.get(F_WEIGHT) | 0}kg。`;
      logMsg(g, msg);
      return { ok: true, gain, weight: target.get(F_WEIGHT) | 0, message: msg };
    },

    /** 318882-318973：能力 1101（喝奶）的成长度变化 */
    drinkMilk(g, target, bless) {
      const res = { ok: true, grew: 0, message: '' };
      const grow = target.get(F_GROW) | 0;
      if (grow <= -1 && (target.get(F_NUTRITION) | 0) < 8000 && cbitOf(target, 1034) !== 1) {
        if (bless >= 0) {
          target.set(F_GROW, Math.min(0, grow + 1));
          res.grew++;
          if (isHerd(target)) {
            modImp(target, 10); modImp2(target, 10);
            target.set(F_ACTION, 17 + 100 * 30);
          }
        }
        if (bless >= 1 && (target.get(F_GROW) | 0) <= -1) {
          target.set(F_GROW, Math.min(0, (target.get(F_GROW) | 0) + 1));
          res.grew++;
          if (isHerd(target)) { modImp(target, 10); modImp2(target, 10); }
        }
        res.message = `${nameOfC(target)}喝了奶，蹭蹭地长大了。`;
        logMsg(g, res.message);
      }
      if (bless <= -1) {
        if ((target.get(F_GROW) | 0) >= -4) {
          target.set(F_GROW, (target.get(F_GROW) | 0) - 1);
          res.grew--;
          if (isHerd(target)) { modImp(target, -20); modImp2(target, -20); }
        }
        res.cursed = true;
      }
      target.set(F_NUTRITION, (target.get(F_NUTRITION) | 0) + 1200);  // 318966
      return res;
    },

    /** 黄油 / 调味料增加梳理计数（341189-341191、354643-354645） */
    seasoning(g, target, item, cap) {
      if (!isHerd(target)) return { ok: false, reason: 'not-livestock' };
      const n = target.get(F_BRUSH) | 0;
      if (n <= (cap - 1)) target.set(F_BRUSH, n + 1);
      consumeOne(item);
      const msg = `${nameOfC(target)}被抹了一身，梳理计数 ${target.get(F_BRUSH) | 0}/${cap}。`;
      logMsg(g, msg);
      return { ok: true, count: target.get(F_BRUSH) | 0, message: msg };
    },

    /** 233870-233936：收款机「餌を撒く」——对所有家畜一次性增重 + 满腹 */
    scatterFeed(g, item) {
      const it = item || findItem(g, ITEM_FEED, g.player);
      if (!it || (it.f[0] | 0) < 1) {
        const m = '没有家畜饲料（1071）。'; logMsg(g, m);
        return { ok: false, reason: 'no-feed', message: m };
      }
      consumeOne(it);
      const herd = this.herdList(g);
      for (const c of herd) {
        if ((c.get(256) | 0) > 60) c.set(256, 59);            // 233916-233918
        c.set(251, 0); c.set(263, 0); c.set(252, 0);           // 233919-233921
        c.set(F_ACTION, 16 + 100 * 1);
        // 233928：modweight( (10000-満腹度)/1000 clamped 1..5000 )
        const gain = idiv(limit(10000 - (c.get(F_NUTRITION) | 0), 1, 5000), 1000);
        c.set(F_WEIGHT, (c.get(F_WEIGHT) | 0) + gain);
        c.set(F_NUTRITION, 10000);
        modImp2(c, 15);                                         // 233931
      }
      const msg = `在牧场里撒了饲料，${herd.length} 只家畜围了过来。`;
      logMsg(g, msg);
      return { ok: true, herd: herd.length, message: msg };
    },

    /** 233938-234003：收款机「場内消毒」——净化消毒药 1155 */
    disinfect(g, item) {
      const it = item || findItem(g, ITEM_DISINFECT, g.player);
      if (!it || (it.f[0] | 0) < 1) {
        const m = '没有净化消毒药（1155）。'; logMsg(g, m);
        return { ok: false, reason: 'no-disinfectant', message: m };
      }
      const f17 = it.f[17] | 0;                                 // 233973-233982
      const power = f17 === 0 ? 40 : (f17 === -1 ? 20 : (f17 === -2 ? 10 : 5));
      consumeOne(it);
      const herd = this.herdList(g);
      for (const c of herd) {
        c.set(F_ACTION, 6 + 100 * 1);
        if (Elona.Status && Elona.Status.healcon) {
          try { Elona.Status.healcon(c, 1, power); } catch (e) { /* 无状态表 */ }
          try { Elona.Status.healcon(c, 12, power); } catch (e) { /* 同上 */ }
        }
        if (Elona.Status && Elona.Status.addbuff && Elona.Status.findbuff
          && Elona.Status.findbuff(c, 60) === -1) {
          Elona.Status.addbuff(g, c, 60, 50, 600);              // 233996-233998
        }
        // 0-FO：清掉本模块的生病计数（源码靠 healcon 的病気状态）
        c.set(F_SICK, 0); c.set(F_SICK_BUFF, 0);
        modImp(c, 15);                                          // 233999
      }
      const msg = `场内消毒完成，${herd.length} 只家畜都精神了些。`;
      logMsg(g, msg);
      return { ok: true, power, herd: herd.length, message: msg };
    },

    /** 419102-419115 + 415323-415327：活畜献祭 */
    sacrifice(g, target) {
      if (!isHerd(target)) return { ok: false, reason: 'not-livestock' };
      const p = g.player;
      if (!p || (p.get(61) | 0) === 0) return { ok: false, reason: 'no-faith' };
      const brush = target.get(F_BRUSH) | 0;
      const piety = 15 * (brush + 1);                            // 419113
      const exp = limit(target.get(F_IMP) | 0, 1, 300);          // 419114
      if (Elona.Faith && Elona.Faith.modPiety) Elona.Faith.modPiety(g, p, piety);
      skillExp(g, p, SKILL_FAITH, exp);
      if (Elona.Chara && Elona.Chara.vanquish) Elona.Chara.vanquish(g, target.index | 0);
      const msg = `${nameOfC(target)}化成光消失了。（恩惠 +${piety}，信仰经验 +${exp}）`;
      logMsg(g, msg);
      return { ok: true, piety, faithExp: exp, message: msg };
    },

    /** 415317-415321 + 418985-419035：演技训练（消耗一件非 no-drop 道具） */
    actingTraining(g, target, item) {
      if (!isHerd(target)) return { ok: false, reason: 'not-livestock' };
      if ((target.get(F_INTEREST) | 0) <= 0) return { ok: false, reason: 'no-interest' };
      const it = item || (g.player && g.player.inv && g.player.inv.find(
        (x) => x && (x.f[0] | 0) > 0 && ibitOf(x, CB_NODROP) !== 1));
      if (!it || (it.f[0] | 0) < 1) return { ok: false, reason: 'no-item' };
      if (ibitOf(it, CB_NODROP) === 1) return { ok: false, reason: 'no-drop' };
      consumeOne(it);
      skillExp(g, g.player, SKILL_PERFORM, 30);                  // 419031
      skillExp(g, target, SKILL_PERFORM, 30);                    // 419032
      modImp2(target, 10);                                       // 419033
      target.set(F_INTEREST, (target.get(F_INTEREST) | 0) - 30); // 419034
      target.set(15, this.nowHour(g) + 12);                      // 419035
      const msg = `${nameOfC(target)}学会了一个小把戏，兴趣 -30。`;
      logMsg(g, msg);
      return { ok: true, message: msg };
    },

    /**
     * 289604-290919：干涉「挖取残骸」5 项（18 骨 341 / 19 心 340 / 20 眼 339 /
     * 21 体液 338 / 22 皮 337）。条件：家畜或牧场主、HP 满。
     * 生命力 sorg(2)<4 时需要确认（确认后按源码 evadd 68 直接死亡）。
     */
    excavate(g, actor, target, kind, force) {
      const id = REMAINS_IDS[kind | 0];
      if (!id) return { ok: false, reason: 'bad-kind' };
      if (!this.isLivestock(g, target)) return { ok: false, reason: 'not-livestock' };
      if ((g.player && target.hp !== undefined)
        && (target.hp | 0) < (target.hpMax | 0)) return { ok: false, reason: 'wounded' };
      const life = (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(target, 2) | 0) : 0;
      if (life < 4 && !force) {
        return { ok: false, reason: 'confirm', message: '硬挖下去它会死，确定要继续吗？（force）' };
      }
      const it = dropAtPlayer(g, id, 1);
      if (it) remainFields(it, target);
      let nm = '残骸';
      if (Elona.ItemDB && Elona.ItemDB.name) {
        try { nm = Elona.ItemDB.name(id, 'en') || nm; } catch (e) { /* 名称表未加载 */ }
      }
      const msg = `从${nameOfC(target)}身上取出了${nm}。`;
      logMsg(g, msg);
      if (life < 4) {
        if (Elona.Chara && Elona.Chara.vanquish) Elona.Chara.vanquish(g, target.index | 0);
        return { ok: true, item: it, killed: true, message: msg };
      }
      // 290916-290917：dmghp maxHP（-26 无属性）→ 留 1 HP；生命力变 1/4
      if (target.hp !== undefined) target.hp = Math.max(1, (target.hp | 0) - (target.hpMax | 0));
      if (Elona.Stats && Elona.Stats.skillMod) {
        Elona.Stats.skillMod(target, 2, target.index | 0, -idiv(life * 3, 4) * 1000, g);
      }
      return { ok: true, item: it, weakened: true, message: msg };
    },

    /** 289601-289603 / 289803-289825：把家畜「带出来」成为同伴 */
    bringOut(g, target) {
      if (!isHerd(target)) return { ok: false, reason: 'not-livestock' };
      if (cbitOf(target, CB_HANG) === 1) {
        const m = '吊着的状态没法带出来。'; logMsg(g, m);
        return { ok: false, reason: 'hanging', message: m };
      }
      if (!Elona.Party || !Elona.Party.joinChara) return { ok: false, reason: 'no-party' };
      const r = Elona.Party.joinChara(g, target);
      if (!r || r.ok === false) {
        const m = '同伴已经满员，带不出来。'; logMsg(g, m);
        return { ok: false, reason: 'full', message: m };
      }
      setCbit(target, F_HERD, 0);
      target.set(80, 0);
      const msg = `把${nameOfC(target)}带出了牧场。`;
      logMsg(g, msg);
      return { ok: true, message: msg };
    },

    /** 233731-233793：任命 / 撤换种畜（removeworker → var_58(80)=mapId） */
    assignBreeder(g, chara) {
      if (!chara) return { ok: false, reason: 'no-chara' };
      this.removeBreeder(g);
      this.setWorker(chara, this.workerKey(g));
      const msg = `已任命 ${nameOfC(chara)} 为本牧场的种畜。`;
      logMsg(g, msg);
      return { ok: true, message: msg };
    },
    removeBreeder(g) {
      const w = this.getWorker(g);
      if (w) w.set(80, 0);
      return w || null;
    },

    /** 233651-233729：把家畜/种畜移动到指定格 */
    moveLivestock(g, chara, x, y) {
      if (!chara || !g.map || !g.map.cell) return { ok: false, reason: 'bad-target' };
      const cell = g.map.cell(x, y);
      if (!cell) return { ok: false, reason: 'bad-cell' };
      if ((g.map.attr && (g.map.attr(cell[0], 7) & 4) !== 0) || (cell[1] | 0) !== 0) {
        return { ok: false, reason: 'blocked' };
      }
      const old = g.map.cell(chara.x, chara.y);
      if (old) old[1] = 0;
      chara.x = x | 0; chara.y = y | 0;
      chara.set(1, x | 0); chara.set(2, y | 0);
      chara.set(171, x | 0); chara.set(172, y | 0);
      cell[1] = (chara.index | 0) + 1;
      const msg = `把${nameOfC(chara)}移动到了 (${x | 0}, ${y | 0})。`;
      logMsg(g, msg);
      return { ok: true, message: msg };
    },

    /** 233275-233289 / 234005-234060：繁殖(37) / 生产(39) 防止代码 */
    togglePrevent(g, which, on) {
      const f = (which === 'production' || which === 39) ? 39 : 37;
      setMapFlag(g, f, on ? 10 : 0);
      return { field: f, value: mapFlag(g, f) };
    },
    preventFlags(g) {
      return { breeding: mapFlag(g, 37) === 10, production: mapFlag(g, 39) === 10 };
    },

    /** 233266-233291：牧场收款机（レジスター 562）菜单 */
    registerMenu(g) {
      if (!this.isRanch(g)) return [];
      const f = this.preventFlags(g);
      const out = [
        { id: 4, label: '任命种畜（ブリーダー）' },
        { id: 3, label: '移动家畜 / 种畜' },
        { id: 17, label: '撒饲料（消耗 家畜の餌 1071）' },
        { id: 18, label: '场内消毒（消耗 浄化消毒薬 1155）' },
      ];
      if (!f.breeding) out.push({ id: 19, label: '启动 繁殖防止代码' });
      if (!f.production) out.push({ id: 20, label: '启动 生产防止代码' });
      if (f.breeding) out.push({ id: 21, label: '解除 繁殖防止代码' });
      if (f.production) out.push({ id: 22, label: '解除 生产防止代码' });
      return out;
    },

    /** 执行收款机菜单项（id 与 registerMenu 一致） */
    runRegister(g, id, opts) {
      const o = opts || {};
      switch (id | 0) {
        case 3: return this.moveLivestock(g, o.chara, o.x, o.y);
        case 4: return this.assignBreeder(g, o.chara);
        case 17: return this.scatterFeed(g, o.item);
        case 18: return this.disinfect(g, o.item);
        case 19: return this.togglePrevent(g, 37, true);
        case 20: return this.togglePrevent(g, 39, true);
        case 21: return this.togglePrevent(g, 37, false);
        case 22: return this.togglePrevent(g, 39, false);
        default: return { ok: false, reason: 'unknown' };
      }
    },

    /** 289600-289616 / 415317-415328：对家畜按 i 干涉时的菜单 */
    interactMenu(g, target) {
      const out = [];
      if (!target) return out;
      if (isHerd(target)) out.push({ id: 'bring-out', label: '带出来（成为同伴）' });
      if (this.isLivestock(g, target)
        && (target.hp === undefined || (target.hp | 0) >= (target.hpMax | 0))) {
        out.push({ id: 'dig-18', label: '剔骨（動物の骨 341）' });
        out.push({ id: 'dig-19', label: '掏心（心臓 340）' });
        out.push({ id: 'dig-20', label: '挖眼（眼 339）' });
        out.push({ id: 'dig-21', label: '榨汁（体液 338）' });
        out.push({ id: 'dig-22', label: '剥皮（皮 337）' });
      }
      if (isHerd(target) && (target.get(F_INTEREST) | 0) > 0) {
        out.push({ id: 'acting', label: '演技训练（消耗一件道具）' });
      }
      if (isHerd(target) && g.player && (g.player.get(61) | 0) !== 0) {
        out.push({ id: 'sacrifice', label: '把家畜献给神' });
      }
      return out;
    },

    /** 执行干涉菜单项 */
    runInteract(g, target, id, opts) {
      const o = opts || {};
      if (id === 'bring-out') return this.bringOut(g, target);
      if (id === 'acting') return this.actingTraining(g, target, o.item);
      if (id === 'sacrifice') return this.sacrifice(g, target);
      if (typeof id === 'string' && id.indexOf('dig-') === 0) {
        return this.excavate(g, g.player, target, Number(id.slice(4)), !!o.force);
      }
      return { ok: false, reason: 'unknown' };
    },

    /** 牧场摘要（给控制台 / 面板用） */
    status(g) {
      const herd = this.herdList(g);
      const w = this.getWorker(g);
      return {
        ranch: this.isRanch(g),
        worker: w ? nameOfC(w) : null,
        breederRate: w ? this.breederRate(w) : 0,
        herd: herd.length,
        sick: herd.filter((c) => (c.get(F_SICK) | 0) > 0).length,
        dirtiness: (Array.isArray(g.groundItems)
          ? g.groundItems.filter((it) => it && (it.f[0] | 0) > 0 && (it.f[3] | 0) === 575).length : 0) * 100
          + herd.filter((c) => (c.get(F_SICK) | 0) > 0).length * 500,
        flags: this.preventFlags(g),
      };
    },
  };

  Elona.Ranch = Ranch;
  Elona.Ranch.MAP_TYPE_RANCH = MAP_TYPE_RANCH;
  Elona.Ranch.SPECIES_OVERRIDE = SPECIES_OVERRIDE;
})(window);
