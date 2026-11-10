'use strict';
/**
 * 游戏核心逻辑层 —— 与表现层解耦（不直接操作 DOM/Canvas）
 *
 * 回合推进（垂直切片版本）：
 *   玩家每执行一次「消耗回合」的动作（移动/等待），turn 计数器 +1，
 *   然后跑一次 ai_check 的占位实现（当前仅处理 NPC 占位）。
 *   完整 AI / 时间片调度属于后续模块，此处只保证回合计数与状态变化正确。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const A = Elona.ATTR;
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));   // HSP 整除（向零截断）
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const STATE = { MENU: 0, CREATE: 1, PLAY: 2, DEAD: 3 };
  /** 旧存档迁移用：地图名 → var_65(20) 地图编号 */
  const MAP_IDS_SAVE = { vernis: 5 };

  // 八方向偏移（与原版小键盘方向一致：1..9，5 为等待）
  const DIRS = {
    1: [-1, 1], 2: [0, 1], 3: [1, 1],
    4: [-1, 0], 5: [0, 0], 6: [1, 0],
    7: [-1, -1], 8: [0, -1], 9: [1, -1],
  };

  /**
   * 0-FY：书页消耗 —— 313908-313928。
   *   源码动的是 `var_99(9, 书)`（可阅读次数），不是堆叠数 `var_99(0)`；
   *   页数减到 0 才 removeitem（书散成灰）。0-FX 之前本项目误用 f[0]，
   *   导致一本书读一次就没了。
   * 放在模块作用域，便于 verify 脚本用 `Game.prototype.settleReading.call(桩对象)`
   *   这种不携带类方法的方式调用。
   * @returns {boolean} 书是否彻底消失
   */
  function consumeBookPage(it, force) {
    const uses = it.f[9] | 0;
    if (!force && uses > 1) { it.f[9] = uses - 1; return false; }
    it.f[9] = 0;
    it.f[0] = 0;
    return true;
  }

  class Game {
    constructor() {
      this.state = STATE.MENU;
      this.map = null;
      this.player = null;
      this.charas = [];       // 对应原版 var_58 的角色池，索引与原版一致
      this.party = [];        // 0-DG：常驻同伴表（换图不丢；待機/阵亡也留着）
      this.groundItems = [];  // 地面物品（var_99 中 owner=-1 的实例；f[5]/f[6] = 坐标）
      this.mef = new Elona.Mef();  // 地面魔法效果（原版 var_490）；见 core/mef.js
      // type 7 召唤所需的宿主钩子：由 spell.js 的 effectType7 调用（见下方定义）
      this.summonMonster = (gg, caster, id, level, target) => this.doSummon(caster, level, target);
      this.turn = 0;          // 回合计数
      this.year = 517;        // 游戏年份 —— 已确认: var_65(10) = 517,10,12,16,10 (行 602271)
      this.messages = [];     // 消息日志（对应原版 msg_newlog）
      this.rng = Elona.rng;
      this.tileAttrs = null;
      this.mapIndex = null;
      this.maxLog = 200;
      this.var1374 = 1;       // 连续攻击回数（calcattackhit 用；默认 1 次）
      // var_65 全局表的已移植子集（装备附魔等会写入）
      //   602271：`var_65(10) = 517, 10, 12, 16, 10`
      //   → 年 517 / 月 10 / 日 12 / 时 16 / 分 10（新游戏的开局时间）
      this.v65 = { 11: 10, 12: 12, 13: 16, 14: 10 };
      // 地产表 var_132（300..449）与自建建筑表（0-EA：随存档一起保存）
      this.v132 = {};
      this.propertySites = {};
      // 0-FS：自宅（site 7）的楼层状态 —— 每层的地面物品与人物分开存
      this.homeFloor = 1;
      this.homeFloors = {};
      this.homeNpcs = {};
      this.homeTiles = {};        // 装修过的格子（homeN → "x,y" → 图块号）
      // 0-FF：renew_major 间隔计时（key → 绝对小时数）
      this.farmRenew = {};
      // 事件队列（evadd/evid/evfind）—— 每回合处理队尾一条（603050-603060）
      this.events = Elona.EventQueue ? new Elona.EventQueue() : null;
      // 表现层效果（mef type7 删除时的粒子动画等），仅用于渲染
      this.effects = [];
      // 投掷目标选择状态：{ itemIndex } / null
      this.throwState = null;
      this.facing = 2;        // var_58(83)：0=北 1=西 2=南 3=东（8 方向表）
      // 瞄准 / 锁定（*label_2670 的产物）：
      //   var_58(29, 主角) 是角色锁定的槽位，本体存放在角色字段里；
      //   下面两个是渲染与「锁了地面」的辅助状态（var_2189/2190/2191）。
      this.lockTarget = null; // 被锁定的角色（= var_58(29,0) 指向的那个）
      this.lockTile = null;   // 锁定的格子 { x, y }（角色锁定时同步为该角色所在格）
      this.lockGround = false; // true = 锁的是地面而不是角色
      this.stairBack = null;  // 暂定的楼梯返回点
      this.dungeonDepth = 0;  // var_65(22)：0 = 地表/城镇
      this.dungeonFloors = {}; // 已生成的楼层缓存 { depth: {json, up, down, monsters, items} }
      this.townSnapshot = null; // 进入地下时的城镇快照（NPC/地面物品）
      this.transitioning = false;
      this.pendingInteraction = null;  // 撞到中立 NPC 后由表现层消费（打开对话）
      this.quests = [];                // var_434：每名 NPC 一个委托槽位
      this.activeQuests = [];          // status 1/3 的委托（上限 5，见 Quest.MAX_ACTIVE）
      this._questSeq = 0;
      this.questMap = null;            // 委托专用地图（原版 var_65(64)=13）
      this.townPos = {};               // 各城镇上次离开时的坐标
      this.townNpcTable = null;        // 各城镇固定 NPC 表（town_npcs.json）
      this.worldMap = null;            // 世界地图步行模式 {x,y}
      this.worldLook = null;           // 0-FT：世界地图查看模式的光标 {x,y}（按 * 开关）
      // 0-FA：随机地城（*label_2469 / *label_2475，槽位 450..499）
      this.randSites = {};             // 运行时随机地城站点（随存档保存）
      this.randDungeonMeta = { init: false, lastWorld: 0 };
      this.dungeonSiteId = 0;          // var_65(20)：当前所在随机地城的 site id
      this.dungeonMinDepth = 1;        // var_132(17)：入口层
      this.dungeonMaxDepth = 0;        // var_132(10)：最深层
      this.dungeonCleared = false;     // var_132(20) == -1：地城主已被击破
      this.dungeonAwake = false;       // var_132(32) != 0：觉醒地城
      // 0-FB：地城补充机制（core/dungeonfx.js）
      this.dungeonKind = 0;            // var_132(0)：20..27（决定 nefia tag 与挖墙掉落表）
      this.isRandomDungeon = false;    // var_132(16) == 8
      this.dungeonMedalSeed = 0;       // var_132(38)：深层小徽章骰（>0 才掉 622）
      this.dungeonCoreSeed = 0;        // var_132(35)：觉醒核心品质种子（>0 才掉 969）
      // 0-FC：野外地图（map id 2）的进入来源，返回世界地图时用
      this.wildTrip = null;             // { wx, wy, worldId, town }
      if (Elona.Sites && Elona.Sites.bindGame) Elona.Sites.bindGame(this);
    }

    /** var_65(n) 读取 —— 已确认 var_65(10) = 年份；其余未移植项缺省 0 */
    getV65(n) {
      if (n === 10) return this.year;
      // 0-FR：var_65(250+347) 的防 S/L 门已整体移除，任何直接读 597 的地方
      //   （equipgen 之外还有喝水许愿块 315190 等）统一视为 100。
      if (n === 597) return 100;
      const v = this.v65[n];
      return v === undefined ? 0 : v;
    }
    /** var_65(n) 写入（仅用于已移植的全局） */
    setV65(n, v) { this.v65[n] = v | 0; }

    // ---------- 时间（var_65(10..15)） ----------
    /**
     * 时间推进 —— 主循环 603094-603157。
     *   var_1046 = 速度 × (100 + var_58(37)) / 100（下限 10）
     *   var_2839 = (var_126(9) - var_58(10,0)) / var_1046 + 1  ← 速度越快越小
     *   var_65(15) += limit(var_2839/5 + 1, 7, 21)；满 60 → 分钟 var_65(14)++；
     *   满 60 分 → 小时 var_65(13)++；满 24 时 → 日 var_65(12)++；日 > 30 → 月 var_65(11)++。
     * 【注记】var_58(10,0) 是玩家的「行动计」；本引擎一次按键 = 一个回合，按刚行动完（0）算。
     */
    advanceClock() {
      // 603045-603049：var_1046 = 速度 * (100 + var_58(37)) / 100（下限 10）
      //                var_2839 = (var_126(9) - var_58(10,0)) / var_1046 + 1
      //   0-FY：var_58(10,0) 现在是真实的玩家行动计（turngauge.js），不再是恒 0。
      //   世界地图移动不走 endTurn，此时 turnDelta 可能还留着上一张地图的值，
      //   所以这里按当前 gauge 重新算，与 TurnGauge.delta() 保持同一个公式。
      // 603099：var_65(15) += limit(var_2839 / 5 + 1, 7, 21)
      const p = this.player;
      const rawSpd = p ? (p.get(11) | 0) : 100;
      const spd = Math.max(10, idiv(rawSpd * (100 + (p ? (p.get(37) | 0) : 0)), 100));
      const cost = (Elona.WorldMap && Elona.WorldMap.turnCost)
        ? Elona.WorldMap.turnCost(this) : 10000;      // var_126(9) = var_132(9, mapId)
      const gauge = p ? (p.get(10) | 0) : 0;          // var_58(10,0)
      const turns = Math.max(1, idiv(cost - gauge, spd) + 1);   // var_2839
      const base = idiv(turns, 5) + 1;
      // 603113-603118：地图 54 的第 3 层每回合走 3000~9000 时间单位
      const special = (this.getV65(20) | 0) === 54 && (this.getV65(22) | 0) === 3;
      let units = special ? limit(base, 3000, 9000) : limit(base, 7, 21);
      // 603119-603122：地图 30 且天气为 1/2/4（雨雪豪雨）→ 每回合额外 3000
      if ((this.getV65(20) | 0) === 30) {
        const w = this.getV65(17) | 0;
        if (w === 1 || w === 2 || w === 4) units += 3000;
      }
      // 603123-603128：持续行动的时间加权 —— 钓鱼每回合 +420+rnd(60)（约 7 分钟），
      //   收容所打工（26/27/28）+30。同样一个回合，做的事不同、耗时也不同。
      const act = p ? (p.get(140) | 0) : 0;            // var_58(140)
      if (act === 7) units += 420 + (this.rng ? this.rng.rnd(60) : 0);
      else if (act === 26 || act === 27 || act === 28) units += 30;
      let acc = (this.getV65(15) | 0) + units;
      if (acc < 60) { this.setV65(15, acc); return; }
      const minutes = (this.getV65(14) | 0) + idiv(acc, 60);
      this.setV65(15, acc % 60);
      const hours = idiv(minutes, 60);           // 整小时增量
      this.setV65(14, minutes % 60);
      if (hours > 0) this.advanceHours(hours);
    }

    /**
     * 0-CM：小时级时间快进 —— 对应原版每小时 `var_65(13)++ ; gosub *label_4352`
     * 的循环（调合的必要时间、281762-281775）。
     * 在当前小时基础上前进 n 小时，跨日归零并触发跨日结算。
     *
     * 【0-GN / 603686-603912 `*label_4352` 的跨日 / 跨月 / 跨年段】
     *   603686-603697  var_65(545) 的 1/10 重掷、576 从 200 回到 100、580 清零
     *                  → 由 Weather.tickHour / Daily.tickDay 的整点结算承载
     *   603698-603748  var_126(6)==3 时的角色扫描与 gosub 2616 / 2445
     *                  → Quest.tick / Encounter / Arena 的每日重置
     *   603755-603769  公会排名过期（var_65(140+cnt)-- 与 modrank）
     *                  → daily.js 的 addGroupExp / tickDay
     *   603770-603798  日历推进（var_65(10..13)：时 / 日 / 月 / 年，含 31 天进位、
     *                  12 月进位、跨年 825/95/851 衰减）→ 本方法的小时累加与跨日分支
     *   603801-603845  每月 1/15 日、节日与委托计时（var_65(557/554/549/514/607)）
     *                  → Quest.tick / Festival / Story.run
     *   603845-603912  税率、悬赏与特殊地图的每日随机增量（var_65(524/690) 等）
     *                  → Economy.tick / Quest.tick
     *   逐项近似口径见 docs/02 A493；特殊地图专属扫描由宿主按地图模块注入。
     */
    advanceHours(n, opts) {
      const sleepMode = !!(opts && opts.sleeping);
      const advanced = Math.max(0, n | 0);
      // 0-EX：每小时饱腹度/水分衰减（label_2223 215675-215801，源码 603447 gosub）
      //   与食物腐烂判定（223820-223946）；两者都按「游戏小时」而非回合结算。
      if (advanced > 0 && Elona.Status) {
        if (Elona.Status.foodTick) Elona.Status.foodTick(this, advanced);
        if (Elona.Status.rotTick) Elona.Status.rotTick(this, advanced);
      }
      let hours = (this.getV65(13) | 0) + Math.max(0, n | 0);
      // 0-GS / 603444-603559：整点的眠気累加与一次性提示（天亮 / 困意 / 饥饿 / 日记）
      const hourly = (times) => {
        if (!Elona.Hourly) return;
        for (let k = 0; k < times; k++) {
          const sl = Elona.Hourly.sleepiness(this, { sleeping: sleepMode });
          for (const m of sl.messages) this.log(m);
          const nt = Elona.Hourly.notices(this);
          for (const m of nt.messages) this.log(m);
        }
      };
      if (hours < 24) {
        this.setV65(13, hours);
        hourly(Math.max(1, advanced));
        // 整点事件 —— *label_4352：天气倒计时与重 roll（603256-603443）
        if (Elona.Weather) Elona.Weather.tickHour(this);
        // 0-DC：火焰 mef 每小时扩散（602981-603021）→ 点燃地面物品
        this.spreadFireHourly();
        // 0-DB：每 10 小时生成一次访客（603122-603127 `var_65(4) \ 10 == 0 → *label_2458`）
        this.spawnVisitorsHourly();
        // 603209-603236：ネフィア热狂（随机地城的「热狂状态」）
        if (Elona.Daily && this.player) {
          const fv = Elona.Daily.tickHour(this);
          for (const m of (fv.messages || [])) this.log(m);
        }
        // 603940：随机事件（*label_2616）—— 清醒时每小时一次
        this.randomEventHours(advanced, sleepMode);
        return;
      }
      let day = (this.getV65(12) | 0) + idiv(hours, 24);
      this.setV65(13, hours % 24);
      hourly(Math.max(1, advanced));
      if (Elona.Weather) Elona.Weather.tickHour(this);
      this.spreadFireHourly();
      this.spawnVisitorsHourly();
      let newMonth = false;
      if (day > 30) { day -= 30; this.setV65(11, (this.getV65(11) | 0) + 1); newMonth = true; }
      this.setV65(12, day);
      if ((this.getV65(11) | 0) > 12) { this.setV65(11, 1); this.year++; }
      // 0-GS / 603560-603612：跨日的播报、心情档位重掷与日记提示
      if (Elona.Hourly) {
        const nd = Elona.Hourly.newDay(this);
        for (const m of nd.messages) this.log(m);
      }
      // 跨日：冒险日和轮换（603613-603685）
      if (Elona.Daily && this.player) {
        const dv = Elona.Daily.tickDay(this);
        for (const m of (dv.messages || [])) this.log(m);
      }
      // 0-GL / 590235-590401 `*label_4277`：冒险者契约到期 / 离场 / 回归 / 换地图。
      // 源码每次地图更新调一次，本项目按跨日聚合（每次给一次 rnd(60) 机会，保守）。
      if (Elona.Adventurer && this.player) {
        const ar = Elona.Adventurer.refresh(this, { hours: 1 });
        for (const m of ar.messages) this.log(m);
      }
      // 跨日：自营店的当日营业（*label_2445，235208-235225；由 603752 在每日主循环里调用）
      if (Elona.ShopSale && this.player) {
        const sr = Elona.ShopSale.settleAll(this);
        for (const m of (sr.messages || [])) this.log(m);
      }
      // 0-FP：249298-249303 地图更新补足店主持金（generatemoney 214504-214525）。
      // 只在世界地图上跨日时触发，避免城镇内平白消耗全局 RNG。
      if (Elona.ShopManage && this.player) Elona.ShopManage.onDayChange(this);
      // 跨日：**投资的城镇店铺**的当日营业额（279026-279100，9 个槽位 var_65(120..128)）
      // 注意这与自营店（`*label_2446`）是两套东西：这里的钱直接落在脚边。
      if (Elona.Economy && this.player) {
        const inc = Elona.Economy.dailyIncome(this, { noGoods: true });
        if (inc && inc.gold > 0) this.log(`店铺今天的收入是 ${inc.gold} gold。`);
      }
      // 跨日：栽培的成长（249264-249294，每株按天数推进 *label_3021）
      if (Elona.Farm && this.player) {
        const fg = Elona.Farm.tickDay(this, 1);
        if (fg && fg.messages && fg.messages.length) {
          for (const m of fg.messages.slice(0, 3)) this.log(m);
        }
      }
      // 跨日：牧场的每日处理（249205-249226，地图类型 31 = 牧場）
      if (Elona.Ranch && this.player) {
        const rr = Elona.Ranch.tickDay(this);
        if (rr) {
          for (const m of (rr.messages || [])) this.log(m);
          if (rr.born && rr.born.length) this.log(`牧场里新增了 ${rr.born.length} 只家畜。`);
        }
      }
      // 收容所的劳动产出（248971-249017，renew_major；收容所地图每 120 小时 = 5 天一次）
      if (Elona.Camp && this.player) {
        const cp = Elona.Camp.producePeriodically(this);
        if (cp) {
          for (const m of (cp.messages || [])) this.log(m);
        }
      }
      // 跨月：税金结算（279226-279320）
      if (newMonth && Elona.Economy && this.player) {
        const tx = Elona.Economy.monthly(this);
        for (const m of (tx.messages || [])) this.log(m);
      }
      // 603940：随机事件（*label_2616）
      this.randomEventHours(advanced, sleepMode);
    }

    /**
     * 随机事件的小时推进（*label_2616，273223-273571）。
     * @param {number} count 推进的小时数（每小时一次判定）
     * @param {boolean} sleeping var_577 == 9（就寝流程，311885）
     * @returns {object[]} 本轮触发的事件
     */
    randomEventHours(count, sleeping) {
      const out = [];
      if (!this.player) return out;
      for (let i = 0; i < (count | 0); i++) {
        // 603913-603933：信仰的每小时充能（清醒时 +32 / 大地图 +4）与衰减
        if (Elona.Faith) Elona.Faith.tickHour(this, { sleeping: !!sleeping });
        if (Elona.RandomEvent) {
          const ev = Elona.RandomEvent.tickHour(this, { sleeping: !!sleeping });
          if (ev) out.push(ev);
        }
      }
      return out;
    }

    /**
     * 0-DC：火焰 mef 每小时扩散（602981-603021）。
     * 火焰以 1/35 的概率向 3 个随机相邻格蔓延，并对新点燃的格调用 mapitem_fire。
     */
    spreadFireHourly() {
      if (!this.mef || !this.mef.spreadFire) return null;
      const fs = this.mef.spreadFire(this);
      if (fs && fs.spread && fs.spread.length) {
        this.log(`火焰向四周蔓延了（${fs.spread.length} 格）。`);
      }
      return fs;
    }

    /**
     * 0-DB：建筑内访客的定时生成（603122-603127）。
     *   源码在整点时 `var_65(4)++`，并**每 10 小时**调用一次 `*label_2458`（访客生成）。
     *   本项目用 `var_65(4)` 记录「自上次生成以来的整点数」。
     */
    spawnVisitorsHourly() {
      if (!this.player) return null;
      const counter = (this.getV65(4) | 0) + 1;
      this.setV65(4, counter);
      if (counter % 10 !== 0) return null;
      return this.spawnVisitors(5);
    }

    /**
     * 0-DB：在当前建筑里生成访客（`*label_2458`，236834-236875）。
     * 源码在进图时 `repeat 5` 调用一次（248643-248647）。
     * @param {number} [rounds] 生成轮数
     */
    spawnVisitors(rounds) {
      if (!Elona.Property || !this.pendingSite) return null;
      const site = Elona.Property.siteOf(this, this.pendingSite);
      if (!site || !site.player) return null;
      // 必须仍在这座建筑的地图上（pendingSite 离开后不会清空）
      const file = Elona.Sites ? Elona.Sites.estateFile(site.type) : '';
      if (file && this.map && this.map.name !== file) return null;
      let total = 0;
      const n = rounds === undefined ? 5 : (rounds | 0);
      for (let i = 0; i < n; i++) {
        const vs = Elona.Property.spawnVisitors(this, site);
        total += (vs && vs.spawned) || 0;
      }
      if (total > 0) this.log(`有 ${total} 位客人走了进来。`);
      return { spawned: total };
    }

    /** 绝对小时数（用于商店盘点等计时，与源码一致：日*24 + 月*24*30 + 年*24*30*12） */
    nowHours() {
      return (this.getV65(13) | 0) + (this.getV65(12) | 0) * 24
        + (this.getV65(11) | 0) * 24 * 30 + (this.getV65(10) | 0) * 24 * 30 * 12;
    }

    /** 当前时间文本（[时:分]） */
    clockText() {
      return `${this.getV65(13) | 0}:${String(this.getV65(14) | 0).padStart(2, '0')}`;
    }

    // ---------- 消息 ----------
    log(text) {
      // 0-DD：只在「该回合的第一条消息」前加分钟数（原版「添加时间信息」选项）
      //   原版消息栏形如 `[48] あなたは…`，分钟数取 var_65(14)
      const turn = this.turn | 0;
      const prefix = (this._msgTurn !== turn)
        ? `[${String(this.getV65(14) | 0).padStart(2, '0')}] ` : '';
      this._msgTurn = turn;
      const line = prefix + text;
      this.messages.push(line);
      if (this.messages.length > this.maxLog) this.messages.shift();
      if (this.onMessage) this.onMessage(line);
    }

    // ---------- 新游戏 ----------
    /**
     * 角色创建 —— 对应原版 characreate 的「种族 + 职业」部分
     *
     * 已确认的调用顺序（start.hsp 行 221235-221240）：
     *   var_62 = 种族名 ; var_59 = 3 ; gosub *label_3103   ← 种族初始化
     *   var_62 = 职业名 ; var_59 = 3 ; gosub *label_3104   ← 职业初始化
     * 两者都通过 skillinit 累加「成长潜力」，之后 label_2174(213385) 把潜力
     * 写回为当前属性值 var_82(id)，再由 cnvbonus 计算 HP/MP/SP 上限。
     *
     * @param {string} name      角色名
     * @param {string} raceKey   种族键名（如 'yerles'）
     * @param {string} classKey  职业键名（如 'warrior'）
     */
    async buildPlayer(name, raceKey, classKey, opts) {
      const rc = await Elona.Data.table('race_class');
      const race = rc.races[raceKey] || {};
      const cls = rc.classes[classKey] || {};
      const S = Elona.Stats;

      const p = new Elona.Chara(0);
      p.name = name || 'Elona';
      p.raceName = raceKey;
      p.className = classKey;
      p.set(A.ACTIVE, 1);
      p.level = 1;
      p.set(35, 0);                       // var_58(35) 当前经验
      p.set(36, S.expNeeded(p));          // var_58(36) 下一级所需（*label_2151）

      // 1) 种族 / 职业初始化 —— 走与 NPC 同一条 ops 路径（var_59 = 3）
      //    原版 442467-442480：del_chara 0 → var_62=种族 → gosub 3103 → var_62=职业 → gosub 3104
      //    这条路才会执行 `var_82(50..60) = 500` 的种族固有耐性、`var_121(1)` 的肢体、
      //    以及 `var_63(2/3)` 的种族/职业键名。旧实现只取 race.init / race.skills，
      //    结果「选了妖精也没有妖精的耐性」。
      let pot = {};
      let body = (race.init || {}).body1 || '';
      if (Elona.CharaFactory && Elona.CharaFactory.applyRaceClass) {
        await Elona.CharaFactory.loadTables();
        const info = Elona.CharaFactory.applyRaceClass(this, p, raceKey, classKey);
        pot = info.pot || {};
        if (info.body) body = info.body;
        if (info.unimpl && info.unimpl.length) p.__buildUnimpl = info.unimpl;
      } else {
        // 兜底（CharaFactory 未加载）：旧路径
        const ctx = { level: p.level, creatureId: 0, year: this.year, rng: this.rng };
        this.applyCharaInit(p, race.init, ctx);
        for (const k in (race.skills || {})) S.skillInit(pot, parseInt(k, 10), race.skills[k], ctx);
        for (const k in (cls.skills || {})) S.skillInit(pot, parseInt(k, 10), cls.skills[k], ctx);
      }
      p.potential = pot;
      S.syncSkillValues(p, pot);   // 潜力 → 当前属性值
      p.bodySlots = body;          // 供 startGame 的 *label_2235 初始化
      // 2) 计算 HP/MP/SP 上限（cnvbonus）
      const st = S.calcMaxStats(p, { creatureId: 0 });
      p.hpMax = st.hpMax; p.mpMax = st.mpMax; p.spMax = st.spMax;
      p.hp = st.hpMax; p.mp = st.mpMax; p.sp = st.spMax;   // 对应 220004-220006
      p.set(22, 9000);                    // 219704：初始营养
      p.set(446, 9000);                   // 219710：初始水分
      if (opts) {
        if (opts.gender !== undefined) p.set(8, opts.gender | 0);
        if (opts.profile) {
          for (let i = 0; i < 5; i++) p.set(161 + i, opts.profile[i] | 0);
        }
      }
      return p;
    }

    /** 新游戏：构建角色 → 物品 / 地图 / NPC */
    async newGame(name, raceKey, classKey) {
      const p = await this.buildPlayer(name, raceKey, classKey);
      await this.startGame(p, classKey);
      return true;
    }

    /**
     * 角色创建时的天赋（Feat）结算。
     *
     * 源码依据：
     *   442779  `*label_2271`：`var_65(93) = 3`（可取得 3 次）→ `gosub *label_0044`（种族 feat）
     *   442817  `gosub *label_2695`：列出可取得的 feat（cat 0 + `*label_0043` 说明模式 stat == 1）
     *   571637  `var_65(93)--` / 571651 `if ( var_65(93) == 0 )`
     *   440691  `var_58(41) = 5 + var_97(154), 5 + var_97(154)`
     *
     * 种族 feat 先由 `Feat.applyRaceFeats` 写入，这里只叠加玩家点选的部分；
     * 同一 id 再选一次会升一级（受 `maxLevelOf` 限制，对应 285809）。
     *
     * @returns {{used:number, points:number, growthBonus:number}}
     */
    applyBirthFeats(p, feats) {
      const extra = (feats || []).map((x) => x | 0).filter((x) => x >= 0 && x < 229);
      let used = 0;
      for (const id of extra) {
        if (used >= 3) break;                             // var_65(93) 只有 3 点
        const cur = Elona.Feat.get(p, id) | 0;
        const maxLv = Elona.Feat.maxLevelOf(id) | 0;
        if (cur >= maxLv) continue;                       // 285809「これ以上取得できない」
        Elona.Feat.set(p, id, cur + 1);                   // 285822 `var_97(id)++`
        used++;
      }
      const points = Math.max(0, 3 - used);               // 285819 `var_65(93)--`
      this.setV65(93, points);
      // 41 = 升级技能奖励点；42 = 同值（耶鲁士人的 feat 154 让两者都 +1）
      const growthBonus = 5 + (Elona.Feat.get(p, 154) | 0);
      p.set(41, growthBonus);
      p.set(42, growthBonus);
      return { used, points, growthBonus };
    }

    /**
     * 创建时选的「特筆すべき才能」（专长技能）。
     * 源码 827531-827539（`*label_3057`）：
     *   skillgain 0, var_1503, 1
     *   skillmod var_1503, 0, 9000
     *   modgrowth 0, var_1503, 83
     *   var_1503 = 0
     * @returns {{id:number, level:number}|null}
     */
    applyBirthSkill(p, skillId) {
      const id = skillId | 0;
      if (!id || !Elona.Stats) return null;
      const S = Elona.Stats;
      if (S.skillGain) S.skillGain(p, 0, id, 1, 0, this);
      if (S.skillMod) S.skillMod(p, id, 0, 9000, this);
      if (S.modGrowth) S.modGrowth(p, id, 0, 83, this);
      return { id, level: p.skill(id) | 0 };
    }

    /** 用已构建好的角色开始游戏（角色创建页面确认后调用） */
    async startGame(p, classKey, opts) {
      opts = opts || {};
      const rc = await Elona.Data.table('race_class');
      const race = rc.races[p.raceName] || {};
      const cls = rc.classes[p.className] || {};
      this.player = p;
      this.charas[0] = p;
      this.turn = 0;
      this.messages = [];
      // 442779：`*label_2271` 里 `var_65(93) = 3`（可选 3 个天赋）；
      // 之后每 5 级 +1，见 Stats.levelUp 的 211909-211913。
      this.setV65(93, 3);

      await this.loadAllTables();
      // 0-DD：buff 名称表（var_76）供「法术状态」面板显示
      if (Elona.Hud && Elona.Hud.loadNames) Elona.Hud.loadNames().catch(() => { });
      // 0-DF：item.bmp 中 96 高的物品图标（大件家具/装饰）
      if (Elona.ItemDB && Elona.ItemDB.loadIconTable) Elona.ItemDB.loadIconTable().catch(() => { });
      // PCC 调色板（var_223）与外观部件；保留创建页面已随机出的外观
      if (Elona.PCC) {
        await Elona.PCC.loadPalette();
        if (!p.pcc) Elona.PCC.ensure(p, this.rng);
        Elona.PCC.preload(p).catch(() => { });
      }
      p.inv = [];
      // 天气/以太病初始化（var_65(17)/(18)）
      if (Elona.Weather) Elona.Weather.init(this);
      // 装备槽表（*label_2235，数据来自种族 var_121(1)）——供 *label_3006 攻击驱动使用
      Elona.ItemDB.initSlots(p, p.bodySlots || (race.init || {}).body1);
      // 初始物品 / 金钱 / 友方标志 —— *label_2241（220235-220357）
      this.giveStartingItems(p, classKey || p.className);
      // 店铺槽（var_65(120..128)）：602312 / 602920 的初始化值
      //   10000 = 未开店（279029 判定）；开店时由投资改成 < 10000
      for (let i = 0; i < 9; i++) this.setV65(120 + i, 10000);
      this.setV65(123, 5000);
      this.setV65(125, 5000);
      // 荷车负重上限（220013-220014）：var_65(81) = 80000 ; var_65(82) = var_65(81)
      if (Elona.Vehicle && Elona.Vehicle.syncCargoLimit) Elona.Vehicle.syncCargoLimit(this);
      // 税金滞纳月数 / 预付税额（279226-279320）
      this.setV65(179, 0);
      this.setV65(609, 0);
      // 固有 cbit 基表（213388-213457）：玩家清零
      Elona.Stats.applyInnateBits(p, this);
      // 0-FI：Purge 模式的 10000 技能点 / 能力点（221801-221820）
      if (Elona.GameMode) Elona.GameMode.applyStart(this, p);
      // 种族初始 feat（*label_0044：var_97 种族特性）+ 创建时选的天赋
      Elona.Feat.applyRaceFeats(p);
      this.applyBirthFeats(p, opts.feats);
      // 442505 / 827531：创建时选的专长技能，进入游戏后立刻结算
      this.applyBirthSkill(p, opts.skill);
      // 装备加成重算（*label_2175 的 213461-213793）：DV/PV/命中/伤害/武器类型
      Elona.Stats.applyEquipment(p, this);
      // 技能/属性修正（213795-213977，含 feat 效果/神加成）与速度刷新（refreshspeed 193826）
      Elona.Stats.applySkillCorrections(p, this);
      Elona.Stats.refreshSpeed(p, this);
      // 负重上限/档位（*label_2225，末尾会再刷新一次速度）
      Elona.Feat.applyWeight(p, this);
      // 属性可能被修正 → 依 label_2174 的顺序重算 HP/MP/SP 上限
      const st2 = Elona.Stats.calcMaxStats(p, { creatureId: 0 });
      p.hpMax = st2.hpMax; p.mpMax = st2.mpMax; p.spMax = st2.spMax;
      p.hp = p.hpMax; p.mp = p.mpMax; p.sp = p.spMax;

      // 原版：角色创建后直接出现在「自家」—— 家的等级 0 时是北ティリス的洞窟，
      //   map_init 238842 `map_initcustom "home" + var_65(24)`。此前本项目从 vernis 开场，
      //   0-FS 起改为真正的自家洞窟（home0，含两个使用人与告示板）。
      this.setV65(24, 0);                    // var_65(24)：家的等级（0 = 初始洞窟）
      this.setV65(259, 0);                   // var_65(250+259)：还没搬过家
      if (Elona.Home) {
        await Elona.Sites.load();
        await Elona.Sites.mapNames();
        Elona.Home.ensureSite(this);
        await Elona.Home.enter(this, 1);
      } else {
        await this.loadMap('vernis');
      }
      this.log('欢迎来到 Elona（Web 重制版）。');
      if (Elona.Home) this.log('这里是你的家。按「回车」调查脚下的东西，用告示板可以装修与雇人。');
      const raceZh = Elona.RaceName ? Elona.RaceName.zh(p.raceName) : (race.jpName || p.raceName);
      const classZh = Elona.RaceName ? Elona.RaceName.classZh(p.className) : (cls.jpName || p.className);
      this.log(`创建角色: ${p.name} / 种族 ${raceZh} / 职业 ${classZh}`);
      this.log(`HP ${p.hpMax}  MP ${p.mpMax}  SP ${p.spMax}  Lv ${p.level}`);

      this.populateTown();
      // 0-GL / 590181-590189 `*label_4275`：槽 16..39 生成冒险者 NPC（原版新游戏 / 调试开局调用）
      if (Elona.Adventurer) Elona.Adventurer.spawnAll(this);
      this.checkStoryEvents();     // 0-DG：起始城镇是 Vernis → 首次入城会触发「ペットとの再会」
      this.state = STATE.PLAY;
      return true;
    }

    /**
     * 城镇 NPC 生成 —— vernis 使用原版固定坐标表（239933-240034）；
     * 其他城镇按原版城镇构成生成通用店主/服务/市民（角色表 var_58(150)）。
     * 每座城镇使用 Elona.Towns 约定的固定 var_58 槽位，保证委托 clientIndex 稳定。
     */
    populateTown(townName) {
      const name = townName || (this.map && this.map.name);
      if (!this.map || this.map.name !== name) return;
      const town = Elona.Towns && Elona.Towns.byName(name);
      if (!town) return;
      const p = this.player;
      const used = new Set([`${p.x},${p.y}`]);
      let nextSlot = town.base;
      const slotEnd = town.base + town.size;
      const randomSpot = () => {
        for (let t = 0; t < 2000; t++) {
          const x = this.rng.rnd(this.map.width);
          const y = this.rng.rnd(this.map.height);
          if (!this.map.walkable(x, y)) continue;
          if (Math.abs(x - p.x) <= 1 && Math.abs(y - p.y) <= 1) continue;
          const k = `${x},${y}`;
          if (used.has(k)) continue;
          used.add(k);
          return { x, y };
        }
        return null;
      };
      const spawn = (creatureId, x, y, role, level, extra) => {
        const slot = nextSlot++;
        if (slot >= slotEnd) return null;
        let pos;
        if ((x | 0) < 0) pos = randomSpot();
        else {
          const k = `${x},${y}`;
          if (!this.map.walkable(x, y) || used.has(k)) return null;
          used.add(k);
          pos = { x, y };
        }
        if (!pos) return null;
        let c = null;
        try {
          c = Elona.CharaFactory.create(this, creatureId, Math.max(1, level | 0), pos.x, pos.y, { index: slot });
        } catch (_) {
          return null;
        }
        if (!c) return null;
        c.set(9, 0);                                  // 中立
        c.set(69, 0);
        if (role) c.set(150, role);
        if (extra) extra(c);
        return c;
      };

      const table = this.townNpcTable && this.townNpcTable[name];
      const folkPool = [16, 39, 440, 441, 495, 69, 70, 74, 269, 326];
      if (table && Array.isArray(table.npcs)) {
        // 原版 map_init_main 固定 NPC 表（tools/extract_town_npcs.py 提取）
        for (const e of table.npcs) {
          if (e.cond) continue;                  // 剧情条件 NPC：当前进度不生成
          const times = Math.max(1, e.count | 0);
          for (let i = 0; i < times; i++) {
            const cid = e.id ? (e.id | 0) : folkPool[this.rng.rnd(folkPool.length)];
            const role = e.id ? (e.role | 0) : ((e.role | 0) || 4);
            const lv = e.level
              || (role >= 5 ? 8 + this.rng.rnd(8) : 3 + this.rng.rnd(5));
            const extra = (e.sprite > 0 || e.sex >= 0)
              ? (c) => {
                if (e.sprite > 0) c.set(7, e.sprite | 0);
                if (e.sex >= 0) c.set(8, e.sex | 0);
              }
              : null;
            spawn(cid, e.x, e.y, role, lv, extra);
          }
        }
      } else {
        // JSON 缺失时的兜底：通用店主/服务/市民
        const generic = [
          [1, 1006, 8], [41, 1004, 8], [1, 1005, 8], [40, 7, 8],
          [74, 12, 8], [70, 9, 8], [69, 8, 8], [77, 14, 5],
          [16, 4, 3],
        ];
        for (const [id, role, lv] of generic) spawn(id, -3, 0, role, lv);
      }

      // 0-FU：城镇放一口井（物品 109「井戸」，*label_2954 的喝水事件对象）。
      //   原版井是地图自带的家具；本项目地图数据没带，运行时补一口。
      if (Elona.Well && Elona.ItemDB) {
        const spot = randomSpot();
        if (spot) {
          try {
            const well = Elona.ItemDB.createItem(Elona.Well.WELL, 1, this.rng);
            if (well) {
              well.f[5] = spot.x; well.f[6] = spot.y;
              const wcell = this.map.cell(spot.x, spot.y);
              if (wcell) wcell[4] = 1;
              this.groundItems.push(well);
            }
          } catch (e) { /* 生成失败不阻塞建城 */ }
        }
      }

      this.syncCharaCells();
      this.log(`${town.label} 的街道上可以看到店主、市民和服务区 NPC。`);
    }

    /** 载入游戏运行所需的全部数据表（原 newGame 内的初始化段） */
    async loadAllTables() {
      await Elona.ItemDB.load();
      await Elona.ItemDB.loadCand();   // 物品候选轮盘 *label_0598
      await Elona.ItemDB.loadEnchant();// 附魔表 var_649/var_653/var_651
      this.dmgconTable = (await Elona.Data.table('dmgcon')).conditions;
      await Elona.Status.loadTable();
      await Elona.BuffEffects.loadTable();
      await Elona.Stats.loadCreatureBits();
      await Elona.Spell.loadTable();
      await Elona.Battle.loadWeaponSpells();
      await Elona.Battle.loadWeaponRange();
      await Elona.ItemUse.loadTable();
      await Elona.Resist.loadTable();   // 0-BS：resist_msgs（resistmod/resistmodh 提示文本）
      if (Elona.Relation && Elona.Relation.loadWords) await Elona.Relation.loadWords();  // 0-BV：关系阶段名表
      await Elona.CharaFactory.loadTables();
      await Elona.EquipGen.loadTable();
      await Elona.Feat.loadTable();
      await Elona.Feat.loadAbilities();
      if (Elona.NPC) await Elona.NPC.loadTable();
      this.townNpcTable = await Elona.Data.table('town_npcs');
    }

    /**
     * 玩家初始物品 —— *label_2241（220235-220357）。
     * 固定物品：333(旅糧)×8、233(携帯食料)×4、31(酒)×2；随后按职业追加。
     * 所有初始物品 var_99(8)=3（已鉴定）、var_99(17)=0。
     * 金钱：var_58(30)=3000+rnd(501)（221786-221788）。
     */
    giveStartingItems(p, classKey) {
      const add = (id, count, f17) => {
        const it = Elona.ItemDB.createItem(id, count);
        if (!it) return;
        it.f[0] = count;
        it.f[8] = 3;                                  // 220353
        if (f17 !== undefined) it.f[17] = f17;
        p.inv.push(it);
      };
      add(333, 8);                                    // 220241-220242
      add(233, 4);                                    // 220244-220245
      add(31, 2);                                     // 220247-220248
      switch (classKey) {
        case 'warrior': case 'predator':
          add(1041, 3, 0); break;                     // 220249-220254 / 220280-220285
        case 'thief':
          add(636, 3, 0); add(1181, 3, 0); break;     // 220255-220264
        case 'wizard':
          add(257, 3, 0); add(116, 1, 0); break;      // 220265-220273
        case 'farmer':
          add(427, 2, 0); break;                      // 220274-220279
        case 'archer':
          add(16, 5, 0); add(160, 1, 0); break;       // 220286-220294
        case 'warmage':
          add(378, 3, 0); add(978, 1, 0); break;      // 220295-220303
        case 'tourist': {
          const it = Elona.ItemDB.createItem(342, 1); // 220304-220309（f9=50）
          if (it) { it.f[0] = 1; it.f[8] = 3; it.f[9] = 50; it.f[17] = 0; p.inv.push(it); }
          break;
        }
        case 'pianist':
          add(88, 1, 0); add(691, 1, 0); break;       // 220310-220317
        case 'gunner':
          add(16, 5, 0); add(161, 1, 0); break;       // 220318-220326
        case 'priest':
          add(249, 3, 0); add(1076, 1, 0); break;     // 220327-220335
        case 'claymore':
          add(68, 5, 0); add(433, 1, 0); break;       // 220336-220344
        default: break;
      }
      // 220236-220239：友方标志 / 关系 / 魔道具修正 / cbit 967
      p.set(25, 2);
      p.set(9, 10);
      p.set(69, 10);
      if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(p, 967, 1);
      // 221786-221801：初始金钱按游戏模式（var_65(273)）取值
      p.set(30, Elona.GameMode
        ? Elona.GameMode.startingGold(this) : 3000 + this.rng.rnd(501));
    }

    /**
     * 应用种族 init 数据。
     * 源数据里存的是原样表达式（如 "var_65(10) - (rnd(20) + 15)"、字面整数），
     * 因此这里做最小求值：只支持数字、var_65(10)（当前年份）与 rnd(n)。
     */
    applyCharaInit(p, init, ctx) {
      if (!init) return;
      for (const key in init) {
        if (key.startsWith('v58_')) {
          const idx = parseInt(key.slice(4), 10);
          const v = this.evalInitExpr(init[key], ctx);
          if (v !== null) p.set(idx, v);
        }
        // init 中的 bodyN 等外观字段由 PCC 合成模块使用（尚未移植）
      }
    }

    evalInitExpr(expr, ctx) {
      let e = String(expr)
        .replace(/var_65\(10\)/g, String(ctx.year))
        .replace(/rnd\((\d+)\)/g, (m, n) => String(ctx.rng.rnd(parseInt(n, 10))));
      if (!/^[-0-9+*/() ]+$/.test(e)) return null;
      try { return Math.trunc(eval(e)); } catch (err) { return null; }
    }

    // ---------- 地图 ----------
    async loadMap(name) {
      if (!this.tileAttrs) this.tileAttrs = (await Elona.Data.tileAttributes()).tilesets;
      // 0-FY：246213 / 252210 —— 载入地图时把所有角色的行动计 var_58(10) 清零
      if (Elona.TurnGauge && Elona.TurnGauge.reset) Elona.TurnGauge.reset(this);
      // 0-EA：离开自建建筑前先把地面物品收进 site.stock（原版 235253-235255 写 inv_*.s2）
      if (Elona.Property && Elona.Property.stashStock) Elona.Property.stashStock(this);
      const json = await Elona.Data.map(name);
      this.map = new Elona.GameMap(json, this.tileAttrs);
      // 地图对象 → 地形特性 / 地面物品（map_initcustom 227693-227735 / map_reload 227761-227777）。
      // 【注记】原版城镇走 map_reload，只创建 kind==0 的物品；kind==2 的地形对象由
      //   map_initcustom 写入。本项目统一在 loadMap 应用两者，否则城镇的门/楼梯不存在。
      // 【0-CJ / A210】原版 227753 在 map_reload 前把「地上且 owner==1 的食物」清掉
      //   （`var_99(21)==1` 且 `refitem(id,5)==57000`），城镇地上没吃完的食物会腐坏消失。
      //   本项目换图时地面物品整体重置（下面这行），食物自然随之消失，语义等价；
      //   这里保留显式清理，是为了与原版行为一一对应、便于将来做「保留地面物品」时衔接。
      {
        const kept = [];
        for (const it of (this.groundItems || [])) {
          if (!it || (it.f[0] | 0) <= 0) continue;
          const owned = (it.f[21] | 0) === 1;
          const isFood = Elona.ItemDB && Elona.ItemDB.ref
            ? (Elona.ItemDB.ref(it.id, 5) | 0) === 57000 : false;
          if (owned && isFood) continue;          // 227753：丢弃
          kept.push(it);
        }
        this.groundItems = kept;
      }
      this.groundItems = [];                      // 原版换图 = 全新地图（地面物品不保留）
      if (Elona.MapFeat && Elona.MapFeat.applyObjects) {
        Elona.MapFeat.applyObjects(this, json.objects);
      }
      if (Elona.ItemDB && Elona.ItemDB.data) {
        for (const o of (json.objects || [])) {
          if (!o || o[4] !== 0 || !(o[0] | 0)) continue;
          const cell = this.map.cell(o[1], o[2]);
          if (!cell || cell[4] !== 0) continue;
          const it = Elona.ItemDB.createItem(o[0] | 0, 1);
          if (!it) continue;
          if ((it.f[0] | 0) <= 0) it.f[0] = 1;
          // 原版 map_reload（227771-227773）：`var_99(21) = var_469(3)` —— 该字段是**所有者**。
          // 城镇预设物品的 obj 第 4 字段均为 1（=「有主」），因此这些东西**不能白拿**，
          // 拾取会走偷窃流程（见 game.stealAt / Actions.get）。
          it.f[5] = o[1] | 0; it.f[6] = o[2] | 0; it.f[21] = o[3] | 0;
          // 城镇预设物品（obj 第 4 字段 >= 0 = 有主）单独标记，避免与「未收获作物 f[21]=4」混淆
          if ((o[3] | 0) >= 0) it.townOwned = true;
          this.groundItems.push(it);
          cell[4] = 1;
        }
      }
      // 放置玩家：优先使用 header[5]（入口坐标，编码为 y*1000+x），
      // 否则从地图中心向外螺旋查找第一个可通行格（避免落在角落）
      let px = 0, py = 0, placed = false;
      const ent = this.map.header[5];
      if (ent && ent > 0) {
        const ex = ent % 1000, ey = Math.floor(ent / 1000);
        if (this.map.walkable(ex, ey)) { px = ex; py = ey; placed = true; }
      }
      if (!placed) {
        const cx = Math.floor(this.map.width / 2), cy = Math.floor(this.map.height / 2);
        for (let r = 0; r < Math.max(this.map.width, this.map.height) && !placed; r++) {
          for (let dy = -r; dy <= r && !placed; dy++) {
            for (let dx = -r; dx <= r && !placed; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const x = cx + dx, y = cy + dy;
              if (this.map.walkable(x, y)) { px = x; py = y; placed = true; }
            }
          }
        }
      }
      this.player.x = px;
      this.player.y = py;
      this.player.set(A.MAP, 0);
      // 当前地图编号 var_65(20) 与子地图 var_65(22)
      // 来源：start.hsp 中 map_reload 的静态注册表（tools/extract_map_ids.py）；
      // 没有静态注册的地图（随机迷宫等）退回城镇编号，仍无则 0。
      let mapId = 0, subId = 0;
      const isHomeMap = /^home\d+$/.test(this.map.name || '');
      if (Elona.MapIds && !isHomeMap) {
        await Elona.MapIds.load();
        const hit = Elona.MapIds.lookup(this.map.name);
        if (hit) { mapId = hit.id; subId = hit.sub === null ? 1 : hit.sub; }
      }
      if (!mapId && !isHomeMap && Elona.Towns) {
        const town = Elona.Towns.byName(this.map.name);
        if (town) { mapId = town.id; subId = 1; }
      }
      // 自宅（home0..home6）：var_65(20) = 7，层数由 g.homeFloor 决定（core/home.js）
      if (isHomeMap) {
        mapId = 7;
        subId = Math.max(1, (this.homeFloor | 0) || 1);
        // var_126(6) = var_132(0, 7) = 5（屋内）—— 家具/告示板/种草等判定都读它
        this.map.header[6] = 5;
        const hd = Elona.Home ? Elona.Home.def(this) : null;
        this.map.header[18] = hd ? hd.cap : (this.map.header[18] | 0);
      }
      this.setV65(20, mapId);
      this.setV65(22, subId);
      // 0-DI：武具店的矢弹充填「每张地图一次」（var_132(37, 地图) == 100）
      // 换图即重置（原版由 map_init 重建 var_132 表）
      this.shopReloadMap = -1;
      // var_65(850)：所属世界地图 id（var_132(30, mapId)，249783 的 site 表 / 602349）
      // —— 钓鱼的专属鱼池（312720-312728）、天气与地图刷新都读它
      if (Elona.Sites && Elona.Sites.ready && Elona.Sites.ready()) {
        const world = Elona.Sites.worldOf(mapId) | 0;
        if (world) this.setV65(850, world);
        else if (!(this.getV65(850) | 0)) this.setV65(850, 4);   // 默认北ティリス
      }
      // 同步 cell 的角色占用字段（原版 field[1] = chara 索引 + 1）
      this.syncCharaCells();
      // 0-CZ：当前生效的载具（194002-194010：海域用海上载具、陆上地形用陆上载具）
      if (Elona.Vehicle && Elona.Vehicle.updateCurrent) Elona.Vehicle.updateCurrent(this);
      // 0-CW：暗之棺自动召唤（227980-228107）—— 持有 991 異界墓地の鍵 时，
      //   进图后把背包里的暗之棺依次放出（最多 15 具）。死灵不能跨图携带，
      //   所以每次进图都重新从棺里召唤，与原版一致。
      if (this.state === STATE.PLAY && Elona.Necro && Elona.Necro.summonOnLoad) {
        const ns = Elona.Necro.summonOnLoad(this);
        if (ns && ns.summoned && ns.summoned.length) {
          this.log(`異界墓地の鍵が共鳴し、${ns.summoned.length} 体の死霊が棺から目覚めた。`);
          this.syncCharaCells();
        }
      }
      // 剧情触发链（原版 246741-248481 位于地图初始化函数内，"Map:Proc scene"）：
      // 只在游戏进行中才跑，避免读档/建角色的过渡里弹剧情。
      if (this.state === STATE.PLAY && Elona.Story) {
        Elona.Story.onMapEnter(this).catch(() => { /* 剧情失败不阻塞移动 */ });
      }
      return this.map;
    }

    /**
     * 0-DG：进入地图后检查剧情事件 —— 目前只接 247786-247795：
     *   地图 5（Vernis）且 var_65(250+7)==0 → 置 1 并压入事件 12（ペットとの再会）。
     *   事件由 Elona.Event.handlers[12] 处理（打开选择窗口）。
     */
    checkStoryEvents() {
      if ((this.getV65(20) | 0) === 5 && (this.getV65(257) | 0) === 0) {
        this.setV65(257, 1);
        if (this.events && this.events.add) this.events.add(12);
      }
    }

    /**
     * 0-DG：换图后把在场同伴放回角色池（原版同伴随身移动）。
     * 只是 Elona.Party.restore 的入口，便于各处统一调用。
     */
    restoreParty() {
      if (!Elona.Party || !Elona.Party.restore) return 0;
      return Elona.Party.restore(this);
    }

    syncCharaCells() {
      // 清空
      for (let y = 0; y < this.map.height; y++)
        for (let x = 0; x < this.map.width; x++)
          this.map.cells[y][x][1] = 0;
      for (const c of this.charas) {
        if (!c || c.get(A.ACTIVE) !== 1) continue;
        const { x, y } = c;
        if (this.map.inBounds(x, y)) this.map.cells[y][x][1] = c.index + 1;
      }
    }

    // ---------- 0-BW：撞到 NPC 时的交换位置（原版 343053-343080）----------
    /**
     * 判断撞到的 NPC 是否可以被「交换位置」（原版 cell_swap 分支）。
     *
     * 【源码依据】start.hsp 343053-343080：
     *   if ( var_788 != (-1) & var_788 != 0 ) {            ; 目标格有角色
     *     if ( var_58(9, cc) >= 10                        ; 关系好
     *       | var_58(140, cc) == 30 | == 31               ; 特定状态
     *       | (var_58(9, cc) == -1 & var_2527 != 0)
     *       | (var_58(9, cc) == 0 & 地图类别 == 101 | 102) ) {   ; 城镇地图上的中立 NPC
     *         cell_swap var_243, cc                        ; ★ 交换位置
     *         if ( var_58(140, cc) != 30 & != 31 ) 「…と入れ替わった。」
     *   否则 → *label_3031 对话窗口（城镇固定人物/剧情人物走这条）
     *
     * 【已知偏差 A187】var_2527 与地图类别 101/102 的完整判定未移植：
     *   本实现按「市民类 NPC（var_58(150) ∈ {0,3,4}）可被交换」近似——
     *   城镇固定人物/剧情人物（role ≠ 0,3,4）走对话窗口；
     *   野外若出现 role=0 的 NPC 也会被交换（原版需城镇地图 101/102 才换）。
     */
    canSwapWith(target) {
      if (!target) return false;
      if ((target.get(9) | 0) <= -1) return false;          // 敌对 → 攻击，不交换
      // 0-EU：**剧情 NPC**（有固定对话脚本的种族）不参与交换 ——
      //   原版这类角色撞上去是走 `*label_3031` 的对话窗口，只有普通市民才 `cell_swap`。
      //   此前用「role 0/3/4 一律可换」近似，导致带台词的剧情角色被顶着走、
      //   再也触发不了对话。这里按 talkscripts 的种族表精确判定。
      if (Elona.Dialogue) {
        try {
          if (Elona.Dialogue.canTalk && Elona.Dialogue.canTalk(target)) return false;
          if (Elona.Dialogue.canTalkService && Elona.Dialogue.canTalkService(target)) return false;
        } catch (e) { /* 对话表未就绪 → 按下面的通用规则 */ }
      }
      // 0-DE：店主的「让开」服务（`var_58(150)` 为商店/服务角色）另有处理，保持不换
      const rel = target.get(9) | 0;
      const state140 = target.get(140) | 0;
      if (rel >= 10) return true;                          // 343055：关系好
      if (state140 === 30 || state140 === 31) return true;  // 343055：状态 30/31
      // 普通市民（role 0/3/4）→ 可被交换；城镇固定人物与剧情人物（role ≠ 0,3,4）→ 对话窗口
      const role = (Elona.NPC && Elona.NPC.roleOf) ? Elona.NPC.roleOf(target) : 0;
      return (role === 0 || role === 3 || role === 4);
    }

    /**
     * 与 NPC 交换位置（cell_swap）——原版 343069 + 「と入れ替わった。」提示（343074）
     */
    swapWith(target) {
      const p = this.player;
      if (!p || !target) return false;
      const px = p.x, py = p.y;
      const tx = target.x, ty = target.y;
      p.x = tx; p.y = ty;
      target.x = px; target.y = py;
      if (this.syncCharaCells) this.syncCharaCells();
      this.log(`你和 ${target.name} 交换了位置。`);
      // 0-GP / 343081-343227：交换位置后的被偷钱（271 号种族）与演出中 NPC /
      //   搭档的五档好感度反应；343228-343229 的 *label_2992 落脚处理已由
      //   onEnterCell / MapFeat 承担。
      if (Elona.Bump && Elona.Bump.onSwap) {
        try {
          const br = Elona.Bump.onSwap(this, p, target);
          if (br && br.messages) for (const m of br.messages) this.log(m);
        } catch (e) { /* 碰撞后续失败不影响换位 */ }
      }
      this.endTurn();
      return true;
    }

    // ---------- 玩家动作 ----------
    /**
     * 移动/等待。dir 为 1..9（5 表示原地等待）。返回是否消耗了回合。
     *
     * 【0-GM / 343806-344044 `*label_2992` 的落脚处理】
     *   343806-343825  自动行走 var_65(30) 的四邻 cell_check → 本项目无自动行走，
     *                  由 movePlayer 的一次一格输入替代；
     *   343826-343860  踩到灰烬 / 烧毁地块（var_704(...,0)==267）→ MapFeat 的地形消息；
     *   343861-343930  地块上的物品与地形特征（var_704(...,4)、addefmap、snd 32 处）
     *                  → MapFeat.read / mef.tick / Property.ambientMessage；
     *   343931-344044  陷阱、门、采集点与移动音效 → Actions / MapFeat / Encounter。
     *   本项目的 `movePlayer` 在落脚后统一调用 `endTurn()`，把这些检查分散到
     *   `MapFeat` / `mef` / `Encounter` / `Property` 各自模块，详见 docs/02 A492。
     */
    movePlayer(dir) {
      if (this.state !== STATE.PLAY) return false;
      const d = DIRS[dir];
      if (!d) return false;
      const p = this.player;
      // 0-FX / 0-FY：持续行动中按方向键 = 中断（*label_2844，604590-604640）。
      //   按「等待」(dir 5) 不算中断，继续推进当前行动。
      //   0-FY 起按源码分流：1/2/3/17/25 先弹 y/n 确认，13/16/18 不可中断，
      //   buff 65 保护下的 19-23/33 也不能中断，其它类型直接中断。
      if (dir !== 5 && (p.get(140) | 0) !== 0 && Elona.Actions) {
        const r = Elona.Actions.requestInterrupt(this, 'move', (res) => {
          if (res && res.ok && res.type) this.log(`你中断了${res.name}。`);
        });
        if (r && (r.reason === 'no-interrupt' || r.reason === 'buff')) {
          this.log(`${r.name}期间无法中断。`);
        }
        return false;
      }
      if (dir === 5) {
        this.log('你等待了一会儿。');
        this.endTurn();
        return true;
      }
      const nx = p.x + d[0], ny = p.y + d[1];
      // 0-GP / 342926-343027：移动前的摇晃（var_58(257)）与坐骑 / 搭档的
      //   演出反应。摇晃造成的 var_58(3/4) 偏移按一次一格输入替代，不改写 nx/ny。
      if (Elona.Bump && Elona.Bump.onBeforeMove) {
        try {
          const bm = Elona.Bump.onBeforeMove(this, p);
          if (bm && bm.messages) for (const m of bm.messages) this.log(m);
        } catch (e) { /* 演出反应失败不影响移动 */ }
      }
      // 朝向（var_58(83)）：0=北 1=东 2=西 3=南；斜向时 y 覆盖 x（343484-343501 的顺序）
      if (d[0] > 0) this.facing = 1; else if (d[0] < 0) this.facing = 2;
      if (d[1] > 0) this.facing = 3; else if (d[1] < 0) this.facing = 0;
      // 0-CE：城镇地图边缘继续前进 → 进入世界地图（原版走出城镇即回到世界地图）
      if (!this.map.inBounds(nx, ny)) {
        // 野外遭遇地图：走到边缘即撤离（原版打不过可以跑）
        if (this.encounterTrip) {
          this.endTurn();
          this.leaveEncounter();
          return true;
        }
        // 0-FC：野外 / 委托地图 —— 朝地图外走即离开（原版 343336-343419）。
        //   `var_58(3/4,var_243)` 越界且 `var_65(22)==1` →「「<地图名>」を去る？」→ y →
        //   `var_65(22)--` + `var_1777=4` 重新载入：野外回世界地图原坐标（237463），
        //   委托地图回委托城镇（237483）。委托地图另有任务警告（343367-343385）。
        if (this.wildTrip || this.questMap) {
          this.confirmLeaveMap();
          return true;
        }
        const town = (Elona.Towns && this.map) ? Elona.Towns.byName(this.map.name) : null;
        if (town && !this.questMap && !(this.dungeonDepth > 0)) {
          this.endTurn();
          this.enterWorldMap();
          return true;
        }
        this.log('那里无法通行。');
        return false;
      }
      if (!this.map.walkable(nx, ny)) {
        const chk = this.map.check(nx, ny);
        if (chk.charaIndex >= 0) {
          // 原版 343286-343311：撞上角色时按关系分流 ——
          //   var_58(9) <= -1（敌对）→ *label_3006 攻击；
          //   否则（中立/友好）→ *label_3031 对话，不造成伤害。
          const target = this.charas[chk.charaIndex];
          if (target && target.index !== p.index) {
            if ((target.get(9) | 0) <= -1) {
              // 0-GP / 343232-343275：骑乘中（var_65(183)!=0）带 buff 53 撞到
              //   敌对 NPC → 冲撞：换位、伤害、畏缩（var_58(175)=10）、技能 301 经验。
              let charged = false;
              if (Elona.Bump && Elona.Bump.tryMountCharge) {
                try {
                  const cr = Elona.Bump.tryMountCharge(this, p, target);
                  if (cr && cr.ok) {
                    for (const m of (cr.messages || [])) this.log(m);
                    this.endTurn();
                    charged = true;
                  }
                } catch (e) { /* 冲撞失败退回普通攻击 */ }
              }
              if (!charged) this.attackTarget(target);
            } else if (this.canSwapWith(target)) {
              // 0-BW：原版 343053-343080 —— 普通市民与玩家**交换位置**
              //   （cell_swap var_243, var_244；提示「あなたと入れ替わった。」）
              this.swapWith(target);
            } else {
              // 城镇固定人物（店主/情报商等）与剧情人物 → 打开互动窗口
              //   （原版 *label_3031 对话菜单）
              // 派对地图：撞到客人 = 交谈得分（1009）
              if (this.questMap && this.questMap.type === 1009 && Elona.QuestMap) {
                const gr = Elona.QuestMap.onGuestTalk(this, target);
                if (gr) this.log(gr.message);
                this.endTurn();
                return true;
              }
              this.log(`你向 ${target.name} 打了声招呼。`);
              this.endTurn();
              // 0-GP / 343276-343285：var_183 的放行与 cbit 1049 的对话分派
              //   都由 *label_3031 的互动窗口承担；scripted 标记供 UI 选择脚本。
              const scripted = !!(Elona.Bump && Elona.Bump.wantsDialogue
                && Elona.Bump.wantsDialogue(target));
              this.pendingInteraction = { action: 'npc', npc: target, scripted };
            }
            return true;
          }
        }
        if (Elona.MapFeat) {
          const f = Elona.MapFeat.read(this, nx, ny);
          // 撞掲示板 = 打开委托一览（*label_2704，286277-286510）
          if (f.type === Elona.MapFeat.TYPE.BOARD) {
            this.endTurn();
            this.pendingInteraction = { action: 'questBoard' };
            return true;
          }
          // 撞门 = 尝试开锁/开门（*label_2991 → *label_3003，343504-343507）
          if (f.type === Elona.MapFeat.TYPE.DOOR_CLOSED) {
            const r = Elona.MapFeat.openDoor(this, p, nx, ny);
            if (r.ok) {
              this.log(r.locked ? '你撬开锁，打开了门。' : '你打开了门。');
            } else {
              this.log(r.locked ? '门锁着，你没能打开。' : '门打不开。');
            }
            this.endTurn();
            return true;
          }
        }
        this.log('那里无法通行。');
        return false;
      }
      p.x = nx; p.y = ny;
      this.syncCharaCells();
      // 343587-343604：回避遇敌的剩余距离（var_65(625)，每走一格 -1，1 格 = 4 英里）
      this.tickEncounterCancel();
      // 进入格子的地形特性 / 陷阱（*label_2911 的 306076+）
      this.onEnterCell(p, nx, ny);
      this.endTurn();
      return true;
    }

    /**
     * 回避遇敌（`var_65(250 + 375)` = var_65(625)）：每走一格 -1，剩余距离按 ×4 英里显示。
     * 药剂效果见 itemfx effect 102（驱兽药片）。
     * 注：本项目还没有随机遇敌系统，计数只负责显示与到期提示。
     */
    tickEncounterCancel() {
      if (!this.getV65 || !this.setV65) return 0;
      let n = this.getV65(625) | 0;
      if (n <= 0) return 0;
      n -= 1;
      this.setV65(625, n);
      if (n <= 0) this.log('回避遇敌的效果消失了。');
      else this.log(`剩余 ${n * 4} 英里。`);
      return n;
    }

    /** 地形特性 / 陷阱结算（core/mapfeat.js）—— 仅玩家输出日志 */
    onEnterCell(c, x, y) {
      if (!Elona.MapFeat || !this.map) return null;
      const r = Elona.MapFeat.onEnter(this, c, x, y);
      if (c.index !== 0) return r;
      if (r.disarmed) {
        this.log('你解除了陷阱。');
        if (Elona.Quest) {
          const tr = Elona.Quest.onTrapDisarmed(this, Elona.MapFeat.read(this, x, y));
          if (tr) this.log(`委托进度：${Elona.Quest.progressText(this, tr.quest)}` +
            (tr.completed ? '（可以报告了）' : ''));
        }
      }
      else if (r.revealed) this.log('你发现了陷阱。');
      else if (r.avoided) this.log('你避开了陷阱。');
      else if (r.triggered) {
        this.log('你触发了陷阱！');
        if (r.dmg) this.log(`受到 ${r.dmg} 点伤害（剩余 HP ${c.hp}）。`);
        if (r.teleported) this.log('空间扭曲，你被传送到了别处。');
        // 1013：踩掉会消失的陷阱也计入撤去进度（见 questmap.js 注记）
        if (this.questMap && this.questMap.type === 1013 && Elona.QuestMap) {
          const after = Elona.MapFeat.read(this, x, y);
          if (after.type !== Elona.MapFeat.TYPE.TRAP || after.id === 0) {
            const tr = Elona.QuestMap.onTrapTriggered(this, after);
            if (tr) this.log(`委托进度：${Elona.Quest.progressText(this, tr.quest)}` +
              (tr.completed ? '（可以报告了）' : ''));
          }
        }
      }
      return r;
    }

    // ---------- 地形交互（Enter / Space） ----------

    /**
     * 足元/面前的地形交互 —— 对应原版 Enter 的自动选择（605554-605638）+ label_2993/2976/3004。
     * 优先级：祭坛 > 楼梯 > 开着的门(关闭) > 面前关着的门(开启) > 告示板等。
     * @returns {object|null} 动作结果；`action:'shop'` 由表现层打开商店。
     */
    interact() {
      if (this.state !== STATE.PLAY) return null;
      const p = this.player;
      const M = Elona.MapFeat;
      if (!M) return null;

      // 0-FS：自宅里的昇降階段是**地面家具**（750 / 751），不是地形特性 ——
      //   237217-237232 `if ( var_65(20) == 7 ) { if ( mapitemfind(x,y,751) … }`。
      //   因此要在「祭坛 / 采集点 / 地形楼梯」之前先看脚下有没有这两件家具。
      if (Elona.Home && Elona.Home.inHome(this)) {
        const hs = Elona.Home.stairsAt(this, p.x, p.y);
        if (hs) {
          const pr = Elona.Home.useStairs(this, hs.up);
          if (pr && pr.catch) pr.catch((e) => this.log('楼梯处理失败：' + e.message));
          return { ok: true, action: 'home-stairs', up: !!hs.up, item: hs.item, pending: pr };
        }
      }

      // 1) 祭坛（item_find 60002）：无信仰 → 祈祷；有信仰 → 献祭物品选择
      const altar = M.altarAt(this, p.x, p.y);
      if (altar) {
        const faith = p.get(61) | 0;
        if (faith === 0) {
          const r = M.pray(this, p);
          if (r && r.ok) {
            this.log(`你开始信仰 ${r.name}。`);
            this.endTurn();
          }
          return r;
        }
        return { ok: true, action: 'offer', altar };
      }

      // 2) 采集点（type 24..28）—— *label_2941（312985）：
      //    原版是 40 回合的持续行动「採取」，期间玩家留在原地、移动即中断，
      //    结束后才由 *label_2909（305786）结算材料。0-FX 之前本项目是「按一下立刻产出」。
      if (Elona.Gather && Elona.Gather.spotAt(this, p.x, p.y)) {
        const A = Elona.Actions;
        if (A && (p.get(140) | 0) === 0) {
          const st = A.begin(this, 8, 40, { x: p.x, y: p.y, turns: 40 });
          if (st.ok) {
            this.log('你开始在这里采集……（约 40 回合，移动会中断）');
            this.endTurn();
            return { ok: true, action: 'gather-rowact', turns: 40 };
          }
        }
        // 没有动作层（或已在别的行动中）时退回即时结算，不卡住交互
        const r = Elona.Gather.gather(this);
        for (const msg of r.messages) this.log(msg);
        if (r.ok) this.endTurn();
        return r;
      }

      // 3) 楼梯（type 10 / 11）
      const st = M.stairsAt(this, p.x, p.y);
      if (st) return this.useStairs(st.up);

      // 3) 脚下的开门 → 关闭（label_3004）
      const here = M.read(this, p.x, p.y);
      if (here.type === M.TYPE.DOOR_OPEN) {
        const r = M.closeDoor(this, p, p.x, p.y);
        if (r.ok) { this.log('你关上了门。'); this.endTurn(); }
        else this.log('有什么挡住了，门关不上。');
        return r;
      }

      // 4) 面前：关着的门 → 开锁/开门；告示板等 → 文本
      // var_58(83)：0=北 1=东 2=西 3=南（343484-343501）
      const FACE = [[0, -1], [1, 0], [-1, 0], [0, 1]];
      const d = FACE[this.facing | 0] || [0, 1];
      const fx = p.x + d[0], fy = p.y + d[1];
      const f = M.read(this, fx, fy);
      if (f.type === M.TYPE.DOOR_CLOSED) {
        const r = M.openDoor(this, p, fx, fy);
        if (r.ok) { this.log(r.locked ? '你撬开锁，打开了门。' : '你打开了门。'); }
        else this.log(r.locked ? '门锁着，你没能打开。' : '门打不开。');
        this.endTurn();
        return r;
      }
      // 掲示板 → 委托一览（*label_2704，286277-286510）
      if (f.type === M.TYPE.BOARD) {
        return { ok: true, action: 'questBoard' };
      }
      const txt = M.boardText(this, fx, fy);
      if (txt) { this.log(txt); this.endTurn(); return { ok: true, text: txt }; }

      // 4.5) 0-FU：井 / 圣井 / 马桶（地面家具 109 / 602 / 650）→ 喝水
      //   *label_2954；源码在交互菜单里选「飲む」，这里直接喝（一口 = 一次交互）
      {
        const w = Elona.Well
          && (Elona.Well.wellAt(this, p.x, p.y) || Elona.Well.wellAt(this, fx, fy));
        if (w) {
          const wr = Elona.Well.drink(this, w);
          for (const msg of wr.messages) this.log(msg);
          if (wr.requestWish) return { ok: true, action: 'wish' };
          if (wr.dried && (w.f[0] | 0) <= 0) this.refreshGroundCell(w.f[5] | 0, w.f[6] | 0);
          this.endTurn();
          return { ok: true, action: 'well-drink', result: wr };
        }
      }

      // 5) 相邻的 NPC 不在 Enter 的处理范围内：
      //    原版 Enter 只做「自己脚下那一格」的 cell_featread（605557-605638），
      //    对角色操作是另一个键 key_interact（*label_2749 → core/interact.js），
      //    撞上去搭话则由 pendingInteraction 处理。这里若再扫一圈邻居，
      //    就变成「随机抓一个旁边的人」，与源码不符（0-EQ 修正）。
      this.log('这附近没有可以操作的东西。');
      return { ok: false, reason: 'nothing' };
    }

    /**
     * 上下楼梯 —— 237253-237279。
     *   下：var_65(26)=1；var_65(22)++（sub==0）或 = sub；记录 var_126(4)
     *   上：var_65(26)=2；var_65(22)--（sub==0）或 = sub；记录 var_126(5)
     * 地图切换：下楼梯 → 随机生成的地下楼层；上楼梯 → 上一层或返回城镇。
     *   生成规则见 core/mapmake.js（原版 *label_2413 的 10 种布局）。
     */
    useStairs(up) {
      if (this.transitioning) return { ok: false, reason: 'busy' };
      // 0-FS：自宅的楼层（地面家具 750/751 触发，见 core/home.js useStairs）
      if (Elona.Home && Elona.Home.inHome(this)) {
        const pr = Elona.Home.useStairs(this, up);
        if (pr && pr.catch) pr.catch((e) => this.log('楼梯处理失败：' + e.message));
        return { ok: true, up, home: true, pending: pr };
      }
      // 护送任务期间不能进入地下城（原版委托人会跟随，但本作地下城不保留城镇 NPC）
      if (Elona.Quest && Elona.Quest.activeQuests) {
        const escorting = Elona.Quest.activeQuests(this)
          .some((q) => q.status === 1 && q.type === 1007);
        if (escorting) {
          this.log('护送途中不能进入地下城。');
          return { ok: false, reason: 'escort' };
        }
      }
      // 委托地图：入口/出口楼梯 → 返回城镇
      if (this.questMap && up) {
        this.leaveQuestMap();
        return { ok: true, up, floor: 0, map: 'town' };
      }
      // 0-FC：野外地图（map id 2）不再有上楼梯 —— 离图走地图边缘（movePlayer 的越界分支）
      const p = this.player;
      const M = Elona.MapFeat;
      const f = M ? M.read(this, p.x, p.y) : { sub: 0 };
      const sub = (f && f.sub) || 0;
      if (up) {
        // 0-FA：入口层（var_132(17)）的上行楼梯直接回地面，而不是退到更浅的地下层
        if ((this.dungeonDepth | 0) <= Math.max(1, this.dungeonMinDepth | 0)) {
          this.setV65(26, 2);
          this.setV65(22, 0);
          this.leaveDungeon();
          return { ok: true, up, floor: 0, map: 'town', reason: 'exit' };
        }
        const target = sub > 0 ? sub : this.dungeonDepth - 1;
        this.setV65(26, 2);
        this.setV65(22, Math.max(0, target));
        if (target <= 0) {
          this.leaveDungeon();
          return { ok: true, up, floor: 0, map: 'town' };
        }
        this.enterDungeon(target, true);
        return { ok: true, up, floor: target, map: `dungeon${target}` };
      }
      const target = sub > 0 ? sub : this.dungeonDepth + 1;
      // 0-FA：228762 `map_placedownstairs` —— 到达 var_132(10) 最深层后不再放下行楼梯
      if (this.dungeonMaxDepth > 0 && target > this.dungeonMaxDepth) {
        this.log('这里已经是地城的最深层了，没有继续向下的楼梯。');
        return { ok: false, reason: 'bottom' };
      }
      this.setV65(26, 1);
      this.setV65(22, target);
      // 最深攻略层数 var_65(189)：随机地城刷新时的危险度基准（249355）
      this.setV65(189, Math.max(this.getV65(189) | 0, target));
      if (!this.townSnapshot) {
        this.townSnapshot = {
          map: this.map.name, x: p.x, y: p.y,
          charas: this.charas.slice(), items: this.groundItems.slice(),
        };
      }
      this.enterDungeon(target, false);
      // 231028-231068：命运信标 —— 随机地城（type 8）首次进入该层时发放
      if (Elona.Daily && Elona.Daily.onEnterFloor) {
        const dy = Elona.Daily.onEnterFloor(this, { mapType: 8, depth: target });
        for (const m of (dy.messages || [])) this.log(m);
      }
      return { ok: true, up, floor: target, map: `dungeon${target}` };
    }

    /**
     * 0-HA 之前的近似生成器（48×36 房间 + L 形走廊）。
     * 现在只作为 MapMake 连续重掷都失败时的兜底，正常流程不再使用。
     */
    legacyDungeon(depth) {
      const W = 48, H = 36, FLOOR = 33, WALL = 468;
      const mk = (id) => [id, 0, id, 0, 0, 0, 0, 0, 0, 0];
      const cells = [];
      for (let y = 0; y < H; y++) {
        const row = [];
        for (let x = 0; x < W; x++) row.push(mk(WALL));
        cells.push(row);
      }
      const rooms = [];
      for (let t = 0; t < 240 && rooms.length < 12; t++) {
        const w = 4 + this.rng.rnd(6), h = 4 + this.rng.rnd(4);
        const x = 2 + this.rng.rnd(W - w - 4), y = 2 + this.rng.rnd(H - h - 4);
        if (rooms.some((o) => x < o.x + o.w + 1 && x + w + 1 > o.x
          && y < o.y + o.h + 1 && y + h + 1 > o.y)) continue;
        rooms.push({ x, y, w, h, cx: x + idiv(w, 2), cy: y + idiv(h, 2) });
        for (let yy = y; yy < y + h; yy++) {
          for (let xx = x; xx < x + w; xx++) cells[yy][xx] = mk(FLOOR);
        }
      }
      if (rooms.length < 2) {
        rooms.length = 0;
        const r = { x: 6, y: 6, w: 16, h: 10, cx: 14, cy: 11 };
        rooms.push(r);
        for (let yy = r.y; yy < r.y + r.h; yy++) {
          for (let xx = r.x; xx < r.x + r.w; xx++) cells[yy][xx] = mk(FLOOR);
        }
        rooms.push({ x: 28, y: 20, w: 12, h: 8, cx: 34, cy: 24 });
        for (let yy = 20; yy < 28; yy++) {
          for (let xx = 28; xx < 40; xx++) cells[yy][xx] = mk(FLOOR);
        }
      }
      const carve = (x, y) => {
        if (x > 0 && y > 0 && x < W - 1 && y < H - 1) cells[y][x] = mk(FLOOR);
      };
      for (let i = 1; i < rooms.length; i++) {
        const a = rooms[i - 1], b = rooms[i];
        let x = a.cx, y = a.cy;
        while (x !== b.cx) { carve(x, y); x += x < b.cx ? 1 : -1; }
        while (y !== b.cy) { carve(x, y); y += y < b.cy ? 1 : -1; }
        carve(x, y);
      }
      let end = rooms[0], best = -1;
      for (const r of rooms) {
        const d = Math.abs(r.cx - rooms[0].cx) + Math.abs(r.cy - rooms[0].cy);
        if (d > best) { best = d; end = r; }
      }
      return {
        W, H, cells, rooms,
        up: { x: rooms[0].cx, y: rooms[0].cy },
        down: { x: end.cx, y: end.cy },
      };
    }

    /**
     * 随机迷宫生成（0-HA：改走原版 *label_2413 / map_createroom / map_connectroom /
     * map_makedoor，实现见 core/mapmake.js）。图块：33 = 地板，468 = 墙（tileset 1）。
     * 后半段（怪物 / 地面物品 / 采集点 / 陷阱 / 地城主）沿用项目既有逻辑。
     */
    generateDungeon(depth) {
      const FLOOR = 33;
      let W, H, cells, rooms, up, down, mm = null;
      if (Elona.MapMake) {
        mm = Elona.MapMake.build(this, {
          kind: this.dungeonKind | 0,
          depth,
          maxDepth: this.dungeonMaxDepth | 0,
          siteType: this.siteType | 0,       // var_132(16, mapId)，由宿主地图模块注入
          forced: this.forcedLayout | 0,     // var_3，调试 / 测试可强制布局
        });
      }
      if (mm && mm.ok) {
        W = mm.width; H = mm.height; cells = mm.cells;
        rooms = mm.rooms; up = mm.up; down = mm.down;
      } else {
        const lg = this.legacyDungeon(depth);
        W = lg.W; H = lg.H; cells = lg.cells;
        rooms = lg.rooms; up = lg.up; down = lg.down;
      }

      // 随机怪物：用 *label_3105 的加权轮盘选生物，等级随层数
      // 0-FA：觉醒地城（var_132(32)!=0）按源码 213479 把怪物等级提到地城等级
      const isBottom = this.dungeonMaxDepth > 0 && depth >= this.dungeonMaxDepth;
      const awake = !!this.dungeonAwake;
      const monsters = [];
      const count = Math.min(12, 4 + idiv(depth, 2));
      // 0-FB：236719-236753 —— 随机地城按 kind 用 nefia1..nefia8 过滤（1/20 用 nefia0），
      //   等级 calcobjlv(层数) 且下限 5（236721-236723）。
      const monLv = Math.max(5, depth);
      const monTag = Elona.DungeonFx ? Elona.DungeonFx.kindTag(this, this.dungeonKind) : '';
      for (let i = 0; i < count; i++) {
        const spot = this.randomFloorCell(cells, W, H, up, down);
        if (!spot) break;
        let cid = 0;
        try {
          cid = Elona.CharaFactory.pick(this, monLv, monTag ? { tagName: monTag } : {});
        } catch (_) { cid = 0; }
        if (!cid) continue;
        monsters.push({
          id: cid,
          level: awake ? Math.max(1, depth) : Math.max(1, depth + this.rng.rnd(3) - 1),
          x: spot.x, y: spot.y,
        });
      }

      // 0-FA：地城主（609357-609365）—— 最深层、品质 4、等级 = 层数+20（觉醒 +100），
      //   源码 `cbitmod 976` 与 `var_132(20,id)=var_244`；网页版用 isDungeonBoss 标记。
      let boss = null;
      if (isBottom && !this.dungeonCleared) {
        const spot = this.randomFloorCell(cells, W, H, up, down);
        let bid = 0;
        try { bid = Elona.CharaFactory.pick(this, Math.max(1, depth + 20), monTag ? { tagName: monTag } : {}); } catch (_) { bid = 0; }
        if (spot && bid) {
          boss = {
            id: bid, level: Math.max(1, depth + (awake ? 100 : 20)),
            x: spot.x, y: spot.y, quality: 4,
          };
        }
      }

      // 地面物品 / 特性 —— map_randsite（228777-228919）
      // 原版按地图类型（var_126(6)）分流：类型 2/3 放地面物品，类型 20..27 放祭坛/喷泉/采集点。
      // 本项目的地下城生成器同时代表这两类地图，故两条分支都跑（见差异报告 A68）。
      const items = [];
      const R = (n) => this.rng.rnd(n);
      if (Elona.RandSite) {
        const ctx = {
          month: this.getV65(11) | 0,
          mapId: this.getV65(20) | 0,
          playerLevel: (this.player && this.player.level) | 0,
          v850: this.getV65(850) | 0,
        };
        const nSite = Elona.RandSite.countOf(2, W, H, R);
        for (let i = 0; i < nSite; i++) {
          const pos = Elona.RandSite.pickCell(cells, W, H, R, (tile) => tile === FLOOR);
          if (!pos) break;
          const what = Elona.RandSite.roll(R, 2, ctx);
          if (!what) continue;
          if (what.kind === 'feat') {
            cells[pos.y][pos.x][6] = (what.id | 0) + (what.type | 0) * 1000;
            continue;
          }
          let it = null;
          try {
            if (what.kind === 'item') {
              it = Elona.ItemDB.createItem(what.id, 1);
              if (what.god !== undefined) it.f[25] = what.god;   // 祭壇的神 id
            } else {
              it = Elona.ItemDB.create(this, {
                level: Math.max(1, what.level | 0),
                fix: what.fix ? what.fix : undefined,
                t639: what.cat || 0,
              });
            }
          } catch (_) { it = null; }
          if (!it) continue;
          it.f[5] = pos.x; it.f[6] = pos.y;
          cells[pos.y][pos.x][4] = 1;                            // 物品通道
          items.push(it);
        }
      }

      // 采集点 —— map_randsite（228777-228842）的放置概率。
      // 注意：原版只在「地块 20..27 且室外」的格子放，24 号采集点的分类由地块决定；
      // 本项目地下城地面统一是 33 号地块，24 号在那里没有分类可判，故只放 25..28。
      const spots = [];
      const nSpots = 3 + this.rng.rnd(3);
      for (let i = 0; i < nSpots; i++) {
        const spot = this.randomFloorCell(cells, W, H, up, down);
        if (!spot) break;
        const site = Elona.Gather ? Elona.Gather.rollSite((n) => this.rng.rnd(n)) : null;
        if (!site || site.type === 24) continue;
        spots.push({ x: spot.x, y: spot.y, id: site.id, type: site.type });
      }

      const header = new Array(100).fill(0);
      header[0] = W; header[1] = H; header[2] = 1;
      header[4] = down.y * 1000 + down.x;
      header[5] = up.y * 1000 + up.x;
      header[12] = 2;
      // 0-HA：原版 var_126(10)（230577 / 231626 / 232274 / 232350）随布局给出地图等级
      header[10] = mm ? (mm.mapLevel | 0) : idiv(W * H, 100);
      // 0-FB：地城地图的 var_126(6) 就是 kind（20..27）——种族分布（236719）与
      //   挖墙掉落表（313183-313266）都按它分派，0-FA 之前一直是 0。
      header[6] = this.dungeonKind | 0;
      // 0-FB：230989-231013 —— 陷阱 / 网 / 木桶（生成阶段直接写 cells）
      let hazards = null;
      if (Elona.DungeonFx && Elona.DungeonFx.placeFloorHazards) {
        const t = (this.tileAttrs || {})[String(1)] || {};
        hazards = Elona.DungeonFx.placeFloorHazards(this, W, H, depth, awake, {
          cells,
          attrOf: (tid, fld) => { const v = t[String(tid)]; return v ? (v[fld] || 0) : 0; },
        });
      }
      return {
        json: { name: `dungeon${depth}`, width: W, height: H, tileset: 1, header, cells, objects: [] },
        up, down, monsters, items, spots, boss, bottom: isBottom, hazards,
        layout: mm ? mm.layout : 0, rooms, doors: mm ? mm.doors : [],
        mapLevel: header[10], source: mm ? 'map_make' : 'legacy',
      };
    }

    randomFloorCell(cells, W, H, up, down) {
      for (let t = 0; t < 500; t++) {
        const x = 1 + this.rng.rnd(W - 2), y = 1 + this.rng.rnd(H - 2);
        if (cells[y][x][0] !== 33) continue;
        if (Math.abs(x - up.x) <= 2 && Math.abs(y - up.y) <= 2) continue;
        if (Math.abs(x - down.x) <= 2 && Math.abs(y - down.y) <= 2) continue;
        return { x, y };
      }
      return null;
    }

    /**
     * 0-FC：野外地图上的随机落点（避开入口与出口，周围 2 格内不落）。
     * 野外地图的图块不是固定的 33，所以不能复用 randomFloorCell。
     */
    /** 在任意地图上随机找一个可站立的格子（物品 / 怪物随机落点用） */
    randWalkableCell() {
      const m = this.map;
      if (!m) return null;
      const W = m.width | 0, H = m.height | 0;
      for (let t = 0; t < 400; t++) {
        const x = 1 + this.rng.rnd(Math.max(1, W - 2));
        const y = 1 + this.rng.rnd(Math.max(1, H - 2));
        if (m.walkable(x, y)) return { x, y };
      }
      return null;
    }

    wildFloorCell(W, H, entry, exit) {
      const cells = this.map && this.map.cells;
      if (!cells) return null;
      for (let t = 0; t < 300; t++) {
        const x = 1 + this.rng.rnd(W - 2), y = 1 + this.rng.rnd(H - 2);
        if (!cells[y] || !cells[y][x]) continue;
        if (this.map.walkable && !this.map.walkable(x, y)) continue;
        if (Math.abs(x - entry.x) <= 2 && Math.abs(y - entry.y) <= 2) continue;
        if (Math.abs(x - exit.x) <= 2 && Math.abs(y - exit.y) <= 2) continue;
        return { x, y };
      }
      return null;
    }

    /** 进入/切换地下楼层（缓存已生成的地图） */
    async enterDungeon(depth, fromBelow) {
      if (this.transitioning) return;
      this.transitioning = true;
      try {
        if (!this.tileAttrs) this.tileAttrs = (await Elona.Data.tileAttributes()).tilesets;
        if (!Elona.ItemDB.data) await this.loadAllTables();
        let f = this.dungeonFloors[depth];
        if (!f) {
          f = this.generateDungeon(depth);
          this.dungeonFloors[depth] = f;
        }
        this.map = new Elona.GameMap(f.json, this.tileAttrs);
        const M = Elona.MapFeat;
        if (M) {
          M.write(this, f.up.x, f.up.y, 232, M.TYPE.STAIRS_UP, Math.max(0, depth - 1), 0);
          // 0-FA：228762 最深层不再放下行楼梯
          if (!f.bottom) M.write(this, f.down.x, f.down.y, 231, M.TYPE.STAIRS_DOWN, depth + 1, 0);
          for (const sp of (f.spots || [])) M.write(this, sp.x, sp.y, sp.id, sp.type, 0, 0);
        }
        this.mef = new Elona.Mef();
        // 0-FB：230999 —— 网的 MEF 需要 g.map 与 g.mef 都就绪，故生成阶段只收坐标
        if (f.hazards && f.hazards.webCells) {
          for (const w of f.hazards.webCells) {
            try { this.mef.add(this, w.x, w.y, 1, 11, -1, w.power); } catch (_) { /* 单格失败不影响楼层 */ }
          }
        }
        this.groundItems = f.items.slice();
        for (const it of this.groundItems) this.refreshGroundCell(it.f[5], it.f[6]);
        this.charas = [this.player];
        const entry = fromBelow ? f.down : f.up;
        this.player.x = entry.x; this.player.y = entry.y;
        this.syncCharaCells();
        this.restoreParty();          // 0-DG：同伴随行
        this.checkStoryEvents();       // 0-DG：进图剧情（Vernis 宠物再会）
        for (const m of f.monsters) {
          try {
            const c = Elona.CharaFactory.create(this, m.id, m.level, m.x, m.y);
            if (c) { c.set(9, -3); c.set(69, 0); }
          } catch (_) { /* 单只生成失败不影响楼层 */ }
        }
        // 0-FA：地城主（品质 4、等级 层数+20）与最深层提示
        if (f.boss) {
          try {
            const b = Elona.CharaFactory.create(this, f.boss.id, f.boss.level,
              f.boss.x, f.boss.y, { var641: 4 });
            if (b) {
              b.set(9, -3); b.set(69, 0);
              b.isDungeonBoss = true;
              b.name = `${b.name} Lv${f.boss.level}`;
              this.log(`当心！这一层由${b.name}守卫着。`);
            }
          } catch (_) { /* 生成失败不影响楼层 */ }
        }
        if (f.bottom) this.log('看来已经到达这座地城的最深层了……');
        if (Elona.RandDungeon && Elona.Sites && this.dungeonSiteId) {
          const site = Elona.Sites.get(this.dungeonSiteId, this);
          const fx = Elona.RandDungeon.floorEffect(site, depth);
          if (fx && fx.text) this.log(fx.text);
        }
        this.syncCharaCells();
        this.dungeonDepth = depth;
        this.setV65(22, depth);
        // 0-FB：247590-247604 —— 觉醒地城的核心品质种子、深层地城的小徽章骰
        if (Elona.DungeonFx && Elona.DungeonFx.rollSeeds) {
          Elona.DungeonFx.rollSeeds(this, depth, this.dungeonAwake);
        }
        this.map.header[4] = f.down.y * 1000 + f.down.x;
        this.map.header[5] = f.up.y * 1000 + f.up.x;
        if (this.onMapChange) this.onMapChange(this.map);
        this.log(`你进入了地下 ${depth} 层。`);
        if (Elona.Quest) {
          const prs = Elona.Quest.onEnterFloor(this, depth);
          if (prs) for (const pr of prs) this.log(`委托达成：护送到了目的地（${pr.quest.clientName}）。`);
        }
      } finally {
        this.transitioning = false;
      }
    }

    /** 从地下返回城镇（恢复进入前的 NPC / 地面物品 / 坐标） */
    async leaveDungeon() {
      if (this.transitioning) return;
      this.transitioning = true;
      try {
        const snap = this.townSnapshot;
        await this.loadMap(snap ? snap.map : 'vernis');
        if (snap) {
          this.charas = snap.charas;
          this.player = snap.charas[0];
          this.groundItems = snap.items;
          for (const it of this.groundItems) this.refreshGroundCell(it.f[5], it.f[6]);
          this.player.x = snap.x; this.player.y = snap.y;
        } else {
          this.charas = [this.player];
          this.populateTown();
          this.restoreParty();        // 0-DG：同伴随行
        }
        this.mef = new Elona.Mef();
        this.dungeonDepth = 0;
        this.setV65(22, 0);
        // 0-FA：离开地城后清掉当前地城上下文（下次进入由 enterSite 重新设置）
        this.dungeonSiteId = 0;
        this.dungeonMinDepth = 1;
        this.dungeonMaxDepth = 0;
        this.dungeonCleared = false;
        this.dungeonAwake = false;
        this.syncCharaCells();
        this.townSnapshot = null;
        if (this.onMapChange) this.onMapChange(this.map);
        this.log('你回到了地面。');
      } finally {
        this.transitioning = false;
      }
    }

    /**
     * 进入委托专用地图 —— 对应原版 425158-425162（var_65(64)=13, var_1777=2）。
     * 地图内容由 core/questmap.js 按委托类型生成。
     */
    async enterQuestMap(q, opts) {
      if (this.transitioning || !q || !Elona.QuestMap) return false;
      opts = opts || {};
      this.transitioning = true;
      try {
        if (!this.tileAttrs) this.tileAttrs = (await Elona.Data.tileAttributes()).tilesets;
        if (!Elona.ItemDB.data) await this.loadAllTables();
        if (!opts.fromLoad && !this.questMap) {
          const p = this.player;
          // 快照的「来源地图」必须是城镇；若当前不在城镇（例如刚从野外/世界地图回来），
          // 退回默认城镇，避免 leaveQuestMap 载入不存在的地图。
          const cur = this.map ? this.map.name : null;
          const from = (cur && Elona.Towns && Elona.Towns.isTown(cur)) ? cur : 'vernis';
          this.townSnapshot = {
            map: from, x: p.x, y: p.y,
            charas: this.charas.slice(), items: this.groundItems.slice(),
          };
        }
        this.worldMap = null;          // 进入委托地图 = 离开世界地图
        const built = await this.buildQuestMapFor(q);
        if (!built) { this.transitioning = false; return false; }
        this.map = new Elona.GameMap(built.json, this.tileAttrs);
        this.mef = new Elona.Mef();
        // 0-FC 修正：1001 / 1013 的 builder 只给 `{ t638 }` 这类**描述符**（原版是
        //   `itemcreate -1, 0, -1, -1` 的随机落点），这里实例化并随机铺到可站立格。
        this.groundItems = [];
        for (const it of built.items) {
          let item = it;
          if (it && !it.f) {
            item = Elona.ItemDB.create(this, {
              itemId: it.id === undefined ? -1 : it.id,
              t638: it.t638 || 0,
              level: Math.max(1, q.difficulty | 0),
              container: -1,
            });
            if (!item) continue;
            const spot = this.randWalkableCell();
            if (!spot) continue;
            item.f[5] = spot.x; item.f[6] = spot.y;
            item.f[21] = 1;                    // var_99(21)=1（野外/任务图标记）
          }
          this.groundItems.push(item);
          this.refreshGroundCell(item.f[5], item.f[6]);
        }
        this.charas = [this.player];
        this.player.x = built.entry.x; this.player.y = built.entry.y;
        this.syncCharaCells();
        this.restoreParty();          // 0-DG：同伴随行

        // 怪物（builder 给 (0,0) 表示「随机落点」，与 characreate -1,0,-3,0 一致）
        for (const m of built.monsters) {
          try {
            let mx = m.x | 0, my = m.y | 0;
            if (mx <= 0 || my <= 0 || (this.map.walkable && !this.map.walkable(mx, my))) {
              const spot = this.randWalkableCell();
              if (spot) { mx = spot.x; my = spot.y; }
            }
            const c = Elona.CharaFactory.create(this, m.id, m.level, mx, my);
            if (c) { c.set(9, -3); c.set(69, 0); }
          } catch (_) { /* 单只失败不影响地图 */ }
        }
        // NPC（派对客人 / 护送委托人）
        const qm = {
          questId: q.id, type: q.type, turns: built.turns,
          entry: built.entry, exit: built.exit, clientIndex: -1,
        };
        for (const n of built.npcs) {
          try {
            const c = Elona.CharaFactory.create(this, n.id, n.level, n.x, n.y);
            if (!c) continue;
            c.set(9, 0);
            c.set(150, n.role || 3);
            if (n.gold) c.set(30, n.gold | 0);        // 231808：客人持金 = 等级×(20+rnd(20))
            if (n.name) c.name = n.name;
            if (n.escort) qm.clientIndex = c.index;
          } catch (_) { /* ignore */ }
        }
        this.syncCharaCells();

        const M = Elona.MapFeat;
        if (M) {
          for (const t of built.traps) {
            M.write(this, t.x, t.y, 234, M.TYPE.TRAP, t.sub, 0);
          }
          // 0-FC：委托地图不再放入口楼梯 —— 原版靠「走到地图边缘」离图（343336-343419），
          //   由 movePlayer 的越界分支 → confirmLeaveMap。
          // 0-FE：护送（1007）根本不进任务图，委托人随玩家在世界地图上移动，故此分支删除。
        }
        this.questMap = qm;
        this.setV65(70, q.type);
        this.setV65(66, this.map.name);
        this.setV65(20, 0);
        this.dungeonDepth = 0;
        this.setV65(22, 0);
        if (this.onMapChange) this.onMapChange(this.map);
        this.log(`你被带到了${this.map.name}（${Elona.Quest.TYPE_NAMES[q.type] || '委托'}）。`);
        if (q.type === 1009) this.log('和会场里的客人交谈，把派对气氛推向高潮吧。');
        if (q.type === 1006) this.log(`收集总重量 ${q.targetData} 的作物（拾取即可）。`);
        if (q.type === 1013) this.log(`解除 ${q.targetData} 点的陷阱。`);
        if (q.type === 1008 && q.targetCreature && Elona.CharaFactory) {
          const rec = Elona.CharaFactory.ref(q.targetCreature);
          if (rec) this.log(`目标：${rec.nameCh || rec.nameJp || rec.nameEn}。`);
        }
        return true;
      } finally {
        this.transitioning = false;
      }
    }

    /**
     * 0-FC：按委托类型构建委托地图。
     *   1008 城镇讨伐 / 1010 城镇剿灭 → **委托人所在城镇的原地图**（只有怪物，没有 NPC）。
     *       源码 `*label_2423`（232129-232180）：`map_initcustom mapfile(var_65(66))`，
     *       不生成 NPC（NPC 由 populateTown 单独生成，委托地图不调用它）。
     *   1001 / 1006 / 1009 / 1013 → 程序生成的随机任务地图（*label_2414/2416/2422/2415）。
     * @returns {Promise<object|null>}
     */
    async buildQuestMapFor(q) {
      if (!q || !Elona.QuestMap) return null;
      if (q.type === 1008 || q.type === 1010) {
        const townName = this.townSnapshot && this.townSnapshot.map
          ? this.townSnapshot.map
          : (this.map ? this.map.name : null);
        const town = Elona.Towns && Elona.Towns.byName(townName);
        if (!town) return null;
        try {
          const json = await Elona.Data.map(town.name);
          if (!json) return null;
          return Elona.QuestMap.buildTown(this, q, json);
        } catch (e) {
          this.log('城镇地图载入失败：' + e.message);
          return null;
        }
      }
      return Elona.QuestMap.build(this, q);
    }

    /** 从委托地图返回城镇（原版 var_65(66) 记录的坐标） */
    async leaveQuestMap() {
      if (this.transitioning) return;
      this.transitioning = true;
      try {
        const snap = this.townSnapshot;
        await this.loadMap(snap ? snap.map : 'vernis');
        if (snap) {
          this.charas = snap.charas;
          this.player = snap.charas[0];
          this.groundItems = snap.items;
          for (const it of this.groundItems) this.refreshGroundCell(it.f[5], it.f[6]);
          this.player.x = snap.x; this.player.y = snap.y;
          // 快照坐标可能来自别的地图（例如刚从野外回来），不可站时退到随机可站格
          if (this.map && this.map.walkable && !this.map.walkable(this.player.x, this.player.y)) {
            const spot = this.randWalkableCell();
            if (spot) { this.player.x = spot.x; this.player.y = spot.y; }
          }
        } else {
          this.charas = [this.player];
          this.populateTown();
          this.restoreParty();        // 0-DG：同伴随行
        }
        this.mef = new Elona.Mef();
        this.questMap = null;
        this.dungeonDepth = 0;
        this.setV65(22, 0);
        this.setV65(70, 0);
        this.syncCharaCells();
        this.townSnapshot = null;
        if (this.onMapChange) this.onMapChange(this.map);
        this.log('你回到了城镇。');
      } finally {
        this.transitioning = false;
      }
    }

    /**
     * 世界地图移动 —— 在城镇之间移动（原版 var_65(64)=目的地地图 id）。
     * 目的城镇会按 Elona.Towns 的固定槽位重建 NPC；护送中的委托人会一起移动。
     */
    async travelToTown(name) {
      if (this.transitioning) return false;
      if (!Elona.Towns || !Elona.Towns.isTown(name)) return false;
      if (this.map && this.map.name === name) return false;
      if (this.dungeonDepth > 0 || this.questMap) return false;
      this.transitioning = true;
      try {
        const from = this.map ? this.map.name : null;
        if (from && Elona.Towns.isTown(from)) {
          this.townPos[from] = { x: this.player.x, y: this.player.y };
        }
        // 护送中的委托人（复制体）随身携带
        const escorts = [];
        if (Elona.Quest) {
          for (const q of Elona.Quest.activeQuests(this)) {
            if (q.status !== 1 || q.type !== 1007) continue;
            const c = this.charas[q.escortClientIndex];
            if (c && (c.get(0) | 0) === 1) {
              c.set(0, 0);
              escorts.push({ q: q, c: c });
            }
          }
        }
        await this.loadMap(name);
        this.charas = [this.player];
        const pos = this.townPos[name];
        if (pos && this.map.walkable(pos.x, pos.y)) {
          this.player.x = pos.x; this.player.y = pos.y;
        }
        this.restoreParty();          // 0-DG：同伴随行
        this.mef = new Elona.Mef();
        this.dungeonDepth = 0;
        this.questMap = null;
        // 城镇的子地图号按 map_reload 的注册表（245818-246036）保持 1，
        //   不能清成 0 —— 否则「子地图」显示与剧情规则（var_65(22)）会对不上。
        if (!(this.getV65(22) | 0)) this.setV65(22, 1);
        this.populateTown(name);
        // 把护送委托人放回专用槽位并贴近玩家
        for (const e of escorts) {
          const c = e.c;
          let slot = -1;
          for (const s of Elona.Towns.ESCORT_SLOTS) {
            const old = this.charas[s];
            if (!old || (old.get(0) | 0) !== 1) { slot = s; break; }
          }
          if (slot < 0) { e.q.escortClientIndex = -1; continue; }
          let nx = this.player.x, ny = this.player.y;
          for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const tx = this.player.x + d[0], ty = this.player.y + d[1];
            const cell = this.map.cell(tx, ty);
            if (this.map.walkable(tx, ty) && cell && cell[1] === 0) { nx = tx; ny = ty; break; }
          }
          c.index = slot;
          c.set(0, 1);
          c.x = nx; c.y = ny;
          this.charas[slot] = c;
          e.q.escortClientIndex = slot;
        }
        this.syncCharaCells();
        const town = Elona.Towns.byName(name);
        // 抵达目的城镇：护送完成并自动报告（原版 evadd 16）
        if (Elona.Quest) {
          const arr = Elona.Quest.onArriveTown(this, name);
          if (arr) for (const a of arr) {
            this.log(a.report && a.report.message ? a.report.message
              : `你把 ${a.quest.clientName} 送到了 ${town.label}。`);
          }
          Elona.Quest.ensure(this);
        }
        if (this.onMapChange) this.onMapChange(this.map);
        this.log(`你来到了 ${town.label}。`);
        return true;
      } finally {
        this.transitioning = false;
      }
    }

    /**
     * 进入世界地图步行模式（原版在世界地图上逐格移动）。
     * 仅在城镇地表可用。
     */
    async enterWorldMap() {
      if (this.transitioning || this.questMap || this.dungeonDepth > 0) return false;
      const town = Elona.Towns && this.map ? Elona.Towns.byName(this.map.name) : null;
      // 0-FS：自宅也能出门（原版从家里上楼 = var_126(6)==5 → var_65(20)=var_65(850)）
      const home = (Elona.Home && Elona.Home.inHome(this)) ? Elona.Home.site(this) : null;
      if (!town && !home) return false;
      if (Elona.WorldMap) await Elona.WorldMap.load();
      // 0-FA：*label_2469 / *label_2470 —— 进入大地图时补足 / 刷新随机地城入口
      if (Elona.Sites) {
        await Elona.Sites.load();
        Elona.Sites.bindGame(this);
      }
      if (Elona.RandDungeon) {
        const wid = (home ? (home.world | 0) : 0) || (this.getV65(850) | 0) || 4;
        Elona.RandDungeon.onEnterWorld(this, wid);
      }
      if (home) {
        this.setV65(850, (home.world | 0) || 4);
        this.worldMap = { x: home.x | 0, y: home.y | 0 };
        this.log('你走出了家门，来到了世界地图。');
        return true;
      }
      this.worldMap = { x: town.wx, y: town.wy };
      this.log('你来到了世界地图。');
      return true;
    }

    /** 离开世界地图，返回当前城镇（不切换地图） */
    leaveWorldMap() {
      if (!this.worldMap) return false;
      this.worldMap = null;
      this.worldLook = null;                    // 0-FT：顺手退出查看模式
      this.log('你回到了城镇。');
      return true;
    }

    /**
     * 0-FT：世界地图「查看模式」（原版世界里按 `*` 后方向键移动浏览光标）。
     *
     * 源码里世界地图的镜头位置是 `var_537/538`，方向键移动的是**光标**而不是玩家；
     * 网页版的 `game.worldMap` 同时承担「玩家坐标」与「镜头中心」，所以另开一个
     * `worldLook` 只挪镜头 —— 玩家该停哪还停哪，退出查看模式镜头自动回到玩家。
     */
    worldLookToggle() {
      if (!this.worldMap) return false;
      if (this.worldLook) { this.worldLook = null; return false; }
      this.worldLook = { x: this.worldMap.x | 0, y: this.worldMap.y | 0 };
      return true;
    }

    /** 查看模式下移动光标（不改玩家坐标，也不消耗时间/触遇敌） */
    worldLookMove(dir) {
      if (!this.worldLook) return false;
      const d = DIRS[dir];
      if (!d || dir === 5) return false;
      const WM = Elona.WorldMap;
      const w = (WM && WM.width) || 95, h = (WM && WM.height) || 55;
      this.worldLook.x = limit(this.worldLook.x + (d[0] | 0), 0, w - 1);
      this.worldLook.y = limit(this.worldLook.y + (d[1] | 0), 0, h - 1);
      return true;
    }

    /** 世界地图逐格移动；踩到城镇即进入 */
    worldMoveDir(dir) {
      const d = DIRS[dir];
      if (!d || dir === 5) return false;
      return this.worldMove(d[0], d[1]);
    }

    worldMove(dx, dy) {
      const w = this.worldMap;
      if (!w || this.transitioning) return false;
      const nx = w.x + (dx | 0), ny = w.y + (dy | 0);
      if (Elona.WorldMap && !Elona.WorldMap.walkable(nx, ny)) {
        this.log('那里无法通行。');
        return false;
      }
      w.x = nx; w.y = ny;
      // 343594-343604：回避遇敌（var_65(250+375)）每走一格 −1，并按 ×4 英里提示
      this.tickEncounterCancel();
      this.advanceClock();
      if (Elona.Quest) Elona.Quest.tick(this);
      // 0-DG：站到 site 的入口格**不再自动进入**，改为提示「按回车进入」。
      //   原版世界地图上站在入口格后由确认键（var_577 == 6）触发进入，
      //   见 docs/02-diff-report.md A321；这里只做提示，按 Enter 由 worldEnter() 处理。
      const site = this.siteUnderFoot();
      const town = site ? null
        : (Elona.Towns && Elona.Towns.LIST.find((t) => t.wx === nx && t.wy === ny));
      if (site || town) {
        const label = site ? ((Elona.Sites.nameOf(site.id, 'jp') || Elona.Sites.nameOf(site.id))) : town.label;
        // 0-FA：随机地城按源码 mapname() 的提示补上「入口危险度」
        const danger = (site && site.dyn) ? `（入口危险度 ${site.fields[17] | 0} 层相当）` : '';
        this.log(`你来到了${label}${danger}。按「回车」进入。`);
      }
      // 343587-343805：野外遭遇。世界地图在网页版是独立面板（画不出怪物），
      //   所以命中后转入「野外」地图（2nouti）打一场，结束后回到原世界坐标。
      if (!site && !town && Elona.Encounter && !this.encounterTrip) {
        const enc = Elona.Encounter.rollWorld(this);
        if (enc) this.startWorldEncounter(enc);
      }
      return true;
    }

    /**
     * 世界地图遭遇 → 进入野外战斗地图（2nouti）。
     *   原版 `var_1777 = 4; goto *label_2459`（重进地图）后在该地图上就地生成怪物；
     *   网页版的世界地图没有角色层，因此改为载入「野外」地图（site 2）承载战斗，
     *   退出时用 `leaveEncounter()` 回到原来的城镇与世界坐标。
     * @returns {Promise<boolean>}
     */
    async startWorldEncounter(enc) {
      if (!enc || this.transitioning || this.encounterTrip || this._parleying) return false;
      // 378312-378415 / 378660-378730：盗贼团（302）与艾莱亚暴徒团（303）的「谈判」。
      //   这条路在原版是进入地图后强制触发的对话事件；网页版先问，再决定是否进战斗。
      this._parleying = true;
      let parley = 'fight';
      try {
        parley = await this.encounterParley(enc);
      } finally {
        this._parleying = false;
      }
      if (parley === 'leave') return false;
      this.transitioning = true;
      const from = this.map ? this.map.name : null;
      this.encounterTrip = {
        town: from, wx: this.worldMap ? this.worldMap.x : 0,
        wy: this.worldMap ? this.worldMap.y : 0, type: enc.type | 0,
        escortQuestId: enc.escortQuestId || null,
      };
      this.worldMap = null;
      try {
        await this.loadMap('2nouti');
        this.charas = [this.player];
        this.restoreParty();
        // 0-FE：护送委托人随行（原版 var_1287==3 的袭击里委托人必须在场）
        if (Elona.Quest && Elona.Quest.restoreEscortFollowers) Elona.Quest.restoreEscortFollowers(this);
        this.mef = new Elona.Mef();
        this.dungeonDepth = 0;
        this.questMap = null;
        this.setV65(20, 2);            // 野外
        this.setV65(22, 1);
        this.setV65(189, Math.max(this.getV65(189) | 0, 1));   // 609737：难度只升不降
        this.log(enc.message);
        if (Elona.Encounter) {
          const eq = enc.escortQuestId && Elona.Quest && Elona.Quest.activeQuests
            ? Elona.Quest.activeQuests(this).find((q) => q.id === enc.escortQuestId) : null;
          const sp = Elona.Encounter.spawn(this, enc.type, enc.strength, { quest: eq });
          if (sp && sp.message) this.log(sp.message);
          if (sp && sp.created.length) this.log(`有 ${sp.created.length} 个敌人挡住了去路！`);
          else this.log('四周一片寂静……');
        }
        if (this.onMapChange) this.onMapChange(this.map);
        return true;
      } catch (e) {
        this.log('进入野外失败：' + e.message);
        this.encounterTrip = null;
        return false;
      } finally {
        this.transitioning = false;
      }
    }

    /**
     * 盗贼团 / 艾莱亚暴徒团的谈判（378312-378415 / 378660-378730）。
     *
     * 源码（事件 302 = 盗贼团，303 = 艾莱亚暴徒团）：
     *   · `var_58(30, 0) <= 10`（所持金 ≤ 10）→ 首领丢下一句嘲讽主动撤走，不进入战斗；
     *   · 否则弹出选项：1 = 返り討ちにする（战斗） / 0 = 降参する（投降）；
     *   · 投降 → `var_58(30,0) -= var_58(30,0)/5`（暴徒团是 /20），
     *     并 `refitem(id, 10) == 1` 的物品全部交付（货车货物 + 旅粮）；
     *   · 之后 `var_1777 = 4` 重进地图（网页版即：不进战斗，直接回到世界地图）。
     *
     * @returns {Promise<'fight'|'leave'>}
     */
    async encounterParley(enc) {
      const type = enc && (enc.type | 0);
      if (type !== 4 && type !== 8) return 'fight';
      const p = this.player;
      if (!p) return 'fight';
      const gold = p.get(30) | 0;
      if (gold <= 10) {
        this.log(type === 4
          ? '「啧，一个铜板都没有的乞丐吗。别浪费大爷的时间，滚吧。」盗贼团撤走了。'
          : '「你这穷光蛋，别在这里碍事！」艾莱亚的煽动者带着人走了。');
        return 'leave';
      }
      const fight = await this.askParley(type, idiv(gold, type === 4 ? 5 : 20));
      if (fight) return 'fight';
      const cost = idiv(gold, type === 4 ? 5 : 20);
      p.set(30, Math.max(0, gold - cost));
      const given = this.handOverCargo();
      this.log(`你交出了 ${cost} gold 与 ${given} 件货物（含旅粮）。`);
      this.log('「算你识相。」对方放你过去了。');
      return 'leave';
    }

    /** 弹出「战斗 / 投降」确认；没有 UI 时按源码默认光标（第一项 = 战斗） */
    askParley(type, cost) {
      const P = Elona.Panels;
      if (!P || typeof P.openConfirm !== 'function') return Promise.resolve(true);
      const title = (type === 4 ? '盗贼团挡住了去路。' : '艾莱亚暴徒团围了上来。')
        + `\n「把货车里的货和 ${cost} gold 交出来，就饶你一命。」`;
      return new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(!!v); } };
        try {
          P.openConfirm(title, done, { title: type === 4 ? '盗贼团' : '艾莱亚暴徒团',
            yes: '战斗', no: '投降' });
        } catch (e) {
          done(true);
        }
      });
    }

    /** 378370-378384：交付所有 `refitem(id, 10) == 1` 的物品（货车货物 / 旅粮） */
    handOverCargo() {
      const p = this.player;
      if (!p || !Array.isArray(p.inv) || !Elona.ItemDB) return 0;
      let n = 0;
      for (let i = 0; i < p.inv.length; i++) {
        const it = p.inv[i];
        if (!it || (it.f[0] | 0) <= 0) continue;
        if ((Elona.ItemDB.ref(it.id | 0, 10) | 0) !== 1) continue;
        n += it.f[0] | 0;
        it.f[0] = 0;
        p.inv[i] = null;
      }
      // 377384 `gosub *label_2225`：重算负重（var_65(80) 货车载重在这里刷新）
      if (Elona.Feat && Elona.Feat.invWeight) {
        try { Elona.Feat.invWeight(p, this); } catch (e) { /* 计算失败不影响交付 */ }
      }
      return n;
    }

    /** 野外战斗结束 → 回到原城镇并恢复世界地图坐标 */
    async leaveEncounter() {
      const trip = this.encounterTrip;
      if (!trip) return false;
      this.encounterTrip = null;
      const town = trip.town;
      if (town && Elona.Towns && Elona.Towns.isTown(town)) {
        await this.travelToTown(town);
      }
      this.worldMap = { x: trip.wx | 0, y: trip.wy | 0 };
      this.log('你回到了世界地图。');
      return true;
    }

    /** 野外地图里还有活着的敌人吗（用于自动收场） */
    encounterEnemiesLeft() {
      if (!this.encounterTrip || !this.charas) return 0;
      let n = 0;
      for (const c of this.charas) {
        if (!c || (c.index | 0) === 0) continue;
        if ((c.get(0) | 0) !== 1) continue;
        if ((c.get(9) | 0) > -1) continue;             // 非敌对（同伴等）
        n++;
      }
      return n;
    }

    /**
     * 0-DG：当前世界地图格上的 site（入口格精确判定）。
     * var_65(850) 是「当前所在的世界 id」，但它在坐船/载具时会变；
     * 找不到时退回 4（北ティリス）再找一次，避免在海上/其它世界时整个入口失效。
     */
    siteUnderFoot() {
      const w = this.worldMap;
      if (!w) return null;
      if (!(Elona.Sites && Elona.Sites.ready && Elona.Sites.ready())) return null;
      const cur = (this.getV65(850) | 0) || 4;
      const hit = Elona.Sites.at(cur, w.x, w.y, this);
      if (hit) return hit;
      return cur === 4 ? null : Elona.Sites.at(4, w.x, w.y, this);
    }

    /**
     * 0-DG：世界地图上按回车 —— 进入脚下的 site。
     *   城镇（site kind 3）→ travelToTown；正站在出发城镇上 → 直接回城。
     *
     * 0-FC：脚下**没有站点也没有城镇**时 → 进入「野外地图」。
     *   源码 237303-237460：世界地图（var_126(6)==1）按确认键，
     *   `if ( var_503(1) != 15 ) { var_65(20) = 2 }` —— 目标地图 id 2 即「野外」。
     *   野外地图由 240076-240572 的 `if ( var_65(20) == 2 )` 段程序化生成
     *   （34×22，按玩家脚下地形分森/草原/荒野/砂丘/湿原/雪原/水上/平地）。
     * @returns {boolean} 是否消费了按键
     */
    worldEnter() {
      const w = this.worldMap;
      if (!w) return false;
      if (this.transitioning) return true;          // 正在换图，忽略本次输入
      const site = this.siteUnderFoot();
      if (!site) {
        const town = Elona.Towns && Elona.Towns.LIST.find((t) => t.wx === w.x && t.wy === w.y);
        // 0-FC：空白格 → 野外地图（原版 var_65(20)=2）
        if (!town) { this.enterWilderness(); return true; }
        this.worldMap = null;
        if (this.map && this.map.name === town.name) { this.log(`你回到了 ${town.label}。`); return true; }
        this.travelToTown(town.name);
        return true;
      }
      const cur = Elona.Towns && Elona.Towns.byId(site.id);
      this.worldMap = null;                          // 进入 site = 离开世界地图
      if (cur && this.map && this.map.name === cur.name) {   // 就是当前所在地
        this.log(`你回到了 ${cur.label}。`);
        return true;
      }
      this.enterSite(site);
      return true;
    }

    /**
     * 0-FC：进入野外地图（map id 2）。
     *   地形取玩家当前所在的世界地图格子的图块 id（源码 var_65(62)，343586 赋值）。
     * @returns {Promise<boolean>}
     */
    async enterWilderness() {
      if (this.transitioning || !Elona.WildMap) return false;
      const w = this.worldMap;
      // 玩家脚下的图块 id（世界地图的 cell[0]）
      let tileId = 0;
      if (w && Elona.WorldMap && typeof Elona.WorldMap.tileAt === 'function') {
        tileId = Elona.WorldMap.tileAt(w.x, w.y) | 0;
      }
      const wid = (this.getV65(850) | 0) || 4;
      const level = Math.max(1, this.getV65(189) | 0 || this.player.level | 0 || 1);
      const built = Elona.WildMap.build(this, { tileId, level, worldId: wid });
      if (!built) return false;

      this.transitioning = true;
      try {
        if (!this.tileAttrs) this.tileAttrs = (await Elona.Data.tileAttributes()).tilesets;
        if (!Elona.ItemDB.data) await this.loadAllTables();
        // 记录进入前的位置，便于从野外返回世界地图
        this.wildTrip = {
          wx: w ? w.x : 0, wy: w ? w.y : 0, worldId: wid,
          town: this.map ? this.map.name : null,
        };
        this.worldMap = null;
        this.map = new Elona.GameMap(built.json, this.tileAttrs);
        this.mef = new Elona.Mef();
        this.groundItems = [];
        this.charas = [this.player];
        this.player.x = built.entry.x; this.player.y = built.entry.y;
        this.syncCharaCells();
        this.restoreParty();

        // 地面物品（随机落点）
        for (const it of built.items) {
          const spot = this.wildFloorCell(built.json.width, built.json.height, built.entry, built.exit);
          if (!spot) continue;
          const item = Elona.ItemDB.create(this, {
            itemId: it.id === undefined ? -1 : it.id,
            t638: it.t638 || 0,
            level: level,
            container: -1,
          });
          if (!item) continue;
          item.f[5] = spot.x; item.f[6] = spot.y;
          item.f[21] = 1;                 // var_99(21)=1：野外标记
          this.groundItems.push(item);
          this.refreshGroundCell(spot.x, spot.y);
        }
        // 怪物
        for (const m of built.monsters) {
          const spot = this.wildFloorCell(built.json.width, built.json.height, built.entry, built.exit);
          if (!spot) continue;
          try {
            const c = Elona.CharaFactory.create(this, m.id, m.level, spot.x, spot.y);
            if (c) { c.set(9, -3); c.set(69, 0); }
          } catch (_) { /* 单只失败不影响地图 */ }
        }
        this.syncCharaCells();

        // 0-FC：野外地图没有出口楼梯 —— 原版 343336-343419 是「走到地图边缘再往外走」离图，
        //   由 movePlayer 的越界分支处理（confirmLeaveMap → leaveWilderness）。

        this.setV65(20, Elona.WildMap.WORLD_MAP);   // var_65(20) = 2（野外）
        this.setV65(22, 1);
        this.dungeonDepth = 0;
        this.questMap = null;
        if (this.onMapChange) this.onMapChange(this.map);
        this.log(`你走进了${built.name}。`);
        return true;
      } catch (e) {
        this.log('进入野外失败：' + e.message);
        this.wildTrip = null;
        return false;
      } finally {
        this.transitioning = false;
      }
    }

    /** 0-FC：从野外地图返回世界地图（走到地图边缘继续前进时调用，原版 343336-343419） */
    async leaveWilderness() {
      const trip = this.wildTrip;
      if (!trip) return false;
      if (this.transitioning) return true;
      this.transitioning = true;
      try {
        this.wildTrip = null;
        this.setV65(20, 0);
        this.setV65(22, 0);
        this.dungeonDepth = 0;
        if (Elona.WorldMap && typeof Elona.WorldMap.load === 'function') await Elona.WorldMap.load();
        if (Elona.Sites) { await Elona.Sites.load(); Elona.Sites.bindGame(this); }
        // 0-FA：*label_2469 / *label_2470 —— 回到大地图时刷新随机地城入口
        if (Elona.RandDungeon) {
          const wid = (this.getV65(850) | 0) || trip.worldId || 4;
          Elona.RandDungeon.onEnterWorld(this, wid);
        }
        this.worldMap = { x: trip.wx | 0, y: trip.wy | 0 };
        this.log('你回到了世界地图。');
        return true;
      } finally {
        this.transitioning = false;
      }
    }

    /**
     * 0-FC：在野外 / 委托地图上朝地图外走时的离开确认。
     *   原版 343362-343416：`「<var_494(0)>」を去る？` → y/n；
     *   委托地图额外警告（343367-343385）：
     *     - 1006 收获 / 1009 音乐会 / 1013 撤除陷阱 →「注意！現在のクエストは現時点で終了となる。」
     *     - 其余未完成委托 →「注意！現在のクエストは失敗に終わってしまう。」
     *   确认后：野外 → 世界地图原坐标（237463-237465 的 `var_65(20) = var_65(850)`）；
     *   委托地图 → 委托城镇（237483 的 `var_65(20) = var_65(66)`）。
     */
    confirmLeaveMap() {
      if (this._leavePrompt) return;                 // 确认窗已弹出，忽略连按
      const isWild = !!this.wildTrip;
      const qm = this.questMap;
      const P = Elona.Panels;
      let title;
      if (isWild) {
        title = '离开这片野外吗？';
      } else {
        const tname = (Elona.Quest && Elona.Quest.TYPE_NAMES && qm)
          ? (Elona.Quest.TYPE_NAMES[qm.type] || '委托') : '委托';
        const q = qm ? ((Elona.Quest.activeQuests(this) || []).find((x) => x.id === qm.questId)) : null;
        const finished = !!(q && q.status === 3);
        title = `离开这个${tname}现场吗？`;
        if (q && !finished) {
          title += (qm.type === 1006 || qm.type === 1009 || qm.type === 1013)
            ? '（注意：委托将在此结束）'
            : '（注意：委托将被判定为失败）';
        }
      }
      if (!P || !P.openConfirm) {                    // 无 UI（测试环境）→ 直接离开
        if (isWild) this.leaveWilderness(); else this.abandonQuestMap();
        return;
      }
      this._leavePrompt = true;
      P.openConfirm(title, (yes) => {
        this._leavePrompt = false;
        if (!yes) return;
        if (isWild) this.leaveWilderness();
        else this.abandonQuestMap();
      }, { yes: '离开', no: '留下' });
    }

    /**
     * 0-FC：离开未完成的委托地图 = 放弃委托（原版 343394-343411）。
     *   1006 / 1009 / 1013 结束本次委托（343394-343400 的 `var_65(801)=0` / `var_65(84)=0`）；
     *   其余类型走失败结算（343376-343385「任务将失败」）。
     */
    async abandonQuestMap() {
      const qm = this.questMap;
      if (!qm) return;
      const q = (Elona.Quest && Elona.Quest.activeQuests)
        ? (Elona.Quest.activeQuests(this) || []).find((x) => x.id === qm.questId)
        : null;
      if (q && q.status === 1 && Elona.Quest.fail) {
        Elona.Quest.fail(this, q);
        this.log('委托失败了……');
      }
      await this.leaveQuestMap();
    }

    /**
     * 进入世界地图上的 site。
     *   城镇（kind 3）→ travelToTown（会重建 NPC）
     *   地产/固定地图（kind 5 / 31 / 101..105 等）→ 直接加载对应地图文件
     *   ネフィア（kind 20..27）→ 随机迷宫（enterDungeon，与 *label_2475 同类）
     */
    /**
     * 0-FE：进入农田（var_132(16) == 103 / crop_1）时的地图刷新。
     *   249018-249042 堆肥箱转化（每次只转化一个）+ 按栽培等级触发野兽灾害。
     */
    onEnterFarmMap() {
      const F = Elona.Farm;
      if (!F || !this.map || !this.player) return;
      if (F.mapType(this) !== 103) return;
      F.compostTick(this);
      // 0-FE/0-FF：野兽灾害属于 `renew_major`（*label_2467），农田的间隔是 120 小时
      //   （249265-249267 `var_126(3) = now + 120`），所以只在「距上次刷新满 5 天」时掷一次，
      //   否则反复进出农田就能刷神器之种。
      const key = 'farm:' + (this.getV65(20) | 0);
      if (!F.renewDue(this, key)) return;
      if (F.raidChance(this)) F.beastRaid(this);
    }

    async enterSite(site) {
      if (!site || this.transitioning) return false;
      const S = Elona.Sites;
      const kind = site.fields[0] | 0;
      // 0-DF：优先显示日文名（原版 mapname(id) 的输出），缺失时退回英文
      const nameJp = (S && S.nameOf(site.id, 'jp')) || '';
      const nameEn = (S && S.nameOf(site.id)) || ('site ' + site.id);
      const siteLabel = nameJp || nameEn;
      this.worldMap = null;

      if (kind === 3) {
        const town = Elona.Towns && Elona.Towns.byId(site.id);
        if (town) { await this.travelToTown(town.name); return true; }
      }

      // 0-FS：自宅 —— site 7（kind 5）。map_init 238842 用家的等级决定地图文件
      //   （home0..home6），与「女仆宅邸 61 / 避难所 30」这类固定 kind 5 据点区分开。
      if ((site.id | 0) === 7 || (site.player && (site.type | 0) === 7)) {
        if (!Elona.Home) return false;
        const ok = await Elona.Home.enter(this, 1);
        if (ok) this.log(`你进入了${siteLabel}。`);
        return ok;
      }

      if (kind >= 20 && kind <= 27) {
        // 0-FA：*label_2462 `map_init`（237835-237842）把层数钳制在
        //   [var_132(17) 入口危险度, var_132(10) 最深层]，网页版此前固定从第 1 层起。
        const start = Math.max(1, (S && S.minLevel(site.id)) || 1);
        const bottom = Math.max(start, (S && S.maxLevel(site.id)) || (start + 2));
        this.dungeonFloors = {};
        this.dungeonSiteId = site.id | 0;
        this.dungeonMinDepth = start;
        this.dungeonMaxDepth = bottom;
        this.dungeonCleared = (site.fields[20] | 0) === -1;
        this.dungeonAwake = (site.fields[32] | 0) !== 0;
        // 0-FB：kind（20..27）决定怪物种族分布与挖墙掉落表；type 8 才是随机地城
        this.dungeonKind = kind | 0;
        this.isRandomDungeon = (site.fields[16] | 0) === 8;
        this.dungeonMedalSeed = 0;
        this.dungeonCoreSeed = 0;
        // var_132(6)：该地城的最深到达层数（觉醒之宝玉 359904 要求为 0 才可活性化）
        if (site.dyn) site.fields[6] = Math.max(site.fields[6] | 0, start);
        const p = this.player;
        if (!this.townSnapshot) {
          this.townSnapshot = {
            map: this.map ? this.map.name : 'vernis', x: p.x, y: p.y,
            charas: this.charas.slice(), items: this.groundItems.slice(),
          };
        }
        await this.enterDungeon(start, false);
        this.setV65(20, site.id | 0);
        this.log(`你进入了${siteLabel}。入口的危险度是 ${start} 层相当，最深层 ${bottom} 层。`);
        return true;
      }

      // 玩家建筑（0-CY）：地图取自建筑对应的固定地图 id（var_132(15)）
      // 0-DB：原版按 **site 类型**（var_132(16)）决定 map_initcustom 的文件名（238053-238145），
      // 之前误用 Sites.fileOf(151) → 落到 _default('vernis')，导致「进自己的博物馆却进了 Vernis」。
      const file = (site.player && site.map)
        ? ((S && S.estateFile(site.type)) || (S ? S.fileOf(site.map) : 'vernis'))
        : (S ? S.fileOf(site.id) : 'vernis');
      await S.mapNames();
      if (!S.hasMapSync(file)) {
        this.log(`${siteLabel} 的地图（${file}）尚未提取，无法进入。`);
        return false;
      }
      this.pendingSite = site.id | 0;
      await this.loadMap(file);
      this.setV65(20, site.id | 0);
      this.setV65(22, 1);
      this.dungeonDepth = 0;
      // 换图 = 全新地图，角色池清空（原版 relocate_chara 的效果）
      this.charas = [this.player];
      this.syncCharaCells();
      this.restoreParty();            // 0-DG：同伴随行
      this.onEnterFarmMap();           // 0-FE：农田刷新（堆肥箱 / 野兽灾害）
      this.checkStoryEvents();         // 0-DG：进图剧情
      // 0-DB：建筑内部布置（家具 / 容量）与访客生成（238053-238145 / 236834-236875）
      if (site.player && Elona.Property) {
        // 0-EA：店内货物/金库的钱要留在原地（首次进图才摆家具）
        const init = Elona.Property.enterStock(this, site);
        if (init && init.ok) {
          // 源码进图时 `repeat 5 : gosub *label_2458`（248643-248647）
          let total = 0;
          for (let i = 0; i < 5; i++) {
            const vs = Elona.Property.spawnVisitors(this, site);
            total += (vs && vs.spawned) || 0;
          }
          if (total > 0) this.log(`${siteLabel} 里有 ${total} 位客人。`);
        }
      }
      this.log(`你进入了${siteLabel}。`);
      if (this.onMapChange) this.onMapChange(this.map);
      return true;
    }

    /**
     * 0-GO / 604021-604026：启动归航 / 船出倒计时（var_65(63)）。
     * 原版由归还卷轴、法术 428 与世界地图的船出写入；本项目 spell.js 428
     * 仍保留「立即归返」的既有行为，这里提供延迟归返入口，倒计时由
     * endTurn 里的 TurnCycle.worldReturn 逐回合递减并做阻止判定。
     */
    startReturnTravel(turns, destination) {
      if (!Elona.TurnCycle) return { ok: false };
      return Elona.TurnCycle.startReturn(this, turns === undefined ? 3 : turns, destination);
    }

    /** 归返（法术 428）：地下时回到进入前的城镇；否则加载归返地图（缺省 vernis）。 */
    returnToTown() {
      if (this.questMap) {
        this.leaveQuestMap();
        return { ok: true, map: 'town' };
      }
      if (this.dungeonDepth > 0) {
        this.leaveDungeon();
        this.endTurn();
        return { ok: true, map: 'town' };
      }
      const name = this.pendingMap || this.returnMap || 'vernis';
      this.pendingMap = null;
      this.loadMap(name).then(() => {
        this.log(`你归返到了 ${this.map.name}。`);
        if (this.onMapChange) this.onMapChange(this.map);
      }).catch((e) => this.log('归返失败：' + e.message));
      this.endTurn();
      return { ok: true, map: name };
    }

    // ---------- 物品使用 / 装备 ----------

    /**
     * 装备/卸下背包物品（*label_2980 / *label_2981）。
     * 已装备 → 卸下；未装备 → 放入第一个匹配空槽。
     */
    equipFromInventory(idx) {
      const p = this.player;
      const it = p.inv && p.inv[idx];
      if (!it || (it.f[0] | 0) <= 0) { this.log('没有这件物品。'); return { ok: false, reason: 'no-item' }; }
      if (it.eqSlot >= 0) {
        Elona.ItemDB.unequipItem(p, idx);
        this.log(`卸下了 ${Elona.ItemDB.name(it.id, 'en')}。`);
      } else {
        // 595523-595543：feat 161（妖精「无法装备 2s 以上的物品」）
        //   `if ( var_97(161) != 0 ) { if ( var_99(7, var_579) > 2000 ) 拒绝 }`
        if (Elona.Feat && (Elona.Feat.get(p, 161) | 0) !== 0 && (it.f[7] | 0) > 2000) {
          this.log('那太重了，装备不了。');
          return { ok: false, reason: 'too-heavy' };
        }
        if (!Elona.ItemDB.equipLocById(it.id)) {
          this.log('这件物品不能装备。');
          return { ok: false, reason: 'not-equipable' };
        }
        const n = Elona.ItemDB.equipSlot(p, idx);
        if (n < 0) { this.log('没有合适的空装备槽。'); return { ok: false, reason: 'no-slot' }; }
        this.log(`装备了 ${Elona.ItemDB.name(it.id, 'en')}。`);
      }
      if (Elona.Stats) {
        Elona.Stats.applyEquipment(p, this);
        Elona.Stats.applySkillCorrections(p, this);
        Elona.Stats.refreshSpeed(p, this);
      }
      if (Elona.Feat) Elona.Feat.applyWeight(p, this);
      this.endTurn();
      return { ok: true, eqSlot: it.eqSlot };
    }

    /**
     * 使用一件道具 —— ItemUse（*label_2953/2955）+ *label_2947/2948 专例的入口。
     * @param {number} idx 背包下标
     * @param {number} [modeHint] 13=使用/读 14=吃 15=饮
     */
    useItem(idx, modeHint, opts) {
      const p = this.player;
      const it = p.inv && p.inv[idx];
      if (!it || (it.f[0] | 0) <= 0) { this.log('没有这件物品。'); return { ok: false, reason: 'no-item' }; }
      // 0-FX：var_58(140)!=0 期间不能做新动作（原版 label_2844 会先问「要中断吗」）
      if ((p.get(140) | 0) !== 0) {
        const nm = Elona.Actions ? Elona.Actions.rowactName(p.get(140) | 0) : '行动';
        this.log(`你正在${nm}，先做完再说。`);
        return { ok: false, reason: 'busy' };
      }
      if (it.eqSlot >= 0) { this.log('装备中的物品不能使用。'); return { ok: false, reason: 'equipped' }; }
      // 物品使用效果（*label_3016，349962-364788）：按 var_99(19) 分派。
      // 目前覆盖「坐具」(44)、「人偶/小魔像」(61)、「书架」(74)、「烟」(90)、「调味料」(93)；
      // 其余效果由下方各专例分支处理。
      if (Elona.ItemFx) {
        const fr = Elona.ItemFx.dispatch(this, it, {
          onGround: !!(opts && opts.onGround),
          // effect 115 需要目标与「真的要攻击吗」的确认，由 UI 透传。
          // 0-EP：`null` 是「邻格没有人」这个**已确定的结果**，不能退化成「尚未选择」，
          //   所以这里必须原样透传（`'target' in opts`）。
          target: (opts && 'target' in opts) ? opts.target : undefined,
          dir: (opts && opts.dir) || undefined,
          confirm: !!(opts && opts.confirm),
        });
        if (fr) return fr;
      }
      // 生产工具（var_99(19) = 1..4）→ 打开生产窗口（348854-348859）
      if (Elona.Produce) {
        const kit = Elona.Produce.kitTypeOf(it);
        if (kit) {
          return {
            ok: true, action: 'produce', kit,
            skill: Elona.Produce.kitSkill(kit),
            item: Elona.ItemDB.name(it.id, 'en'),
          };
        }
      }
      // 种子（refitem(id,9) == 58500）→ 播种（*label_3020，364910-364957）
      if (Elona.Farm && Elona.Farm.isSeed(it)) {
        const fr = Elona.Farm.plant(this, idx);
        if (fr && fr.ok) this.endTurn();
        return fr || { ok: false };
      }
      // 0-CQ：进化 —— 吃下『リトルシスター』(319) 的尸体（226245-226275）
      //   尸体 f[23]==319 且 f[31]!=1 时触发；每 3 次耐久+1、每 6 次力量+1，
      //   并把技能 100..399 的潜力各 +rnd(10)+1。
      if (Elona.Evolve && Elona.Evolve.isEvolveCorpse(it)) {
        const r = Elona.Evolve.evolve(this, p);
        this.log(r.message);
        if ((it.f[0] | 0) > 0) it.f[0]--;
        this.endTurn();
        return { ok: true, evolve: r };
      }
      // 0-DB：劳动器具（1294 奴隷グルグル / 1293 奴隷バタバタ）→ 收容所内积累劳动能量
      //   （358394-358425 → var_65(91)=107/108 → *label_2932 → 311143-311165 / 311249-311261）
      if (Elona.Camp && Elona.Camp.WORK_TOOLS && Elona.Camp.WORK_TOOLS[it.id | 0]) {
        const wr = Elona.Actions.startWork(this, it.id | 0);
        return wr;
      }
      // 0-DB：操作面板（1199）→ 收容所的运营面板（233292-233301 的站点菜单）
      //   源码里站点菜单项 24=収容 / 25=労働強度変更 / 26=労働エナジー交換
      if ((it.id | 0) === 1199 && Elona.Camp && Elona.Camp.campOf && Elona.Camp.campOf(this)) {
        return { ok: true, action: 'camp-manage', message: '' };
      }
      // 0-CZ/0-DA：载具产权书 → 陆上呼出（326255-326314）/ 海上出航（326316-326410）
      if (Elona.Vehicle && Elona.Vehicle.isVehicle(it)) {
        const vr = Elona.Vehicle.isLandVehicle(it)
          ? Elona.Vehicle.callLand(this, it)
          : Elona.Vehicle.sail(this, it);
        this.log(vr.message);
        if (vr.ok) this.endTurn();
        return vr;
      }
      // 0-FS：家の権利書 344 / 引越しの権利書 897（232700-232845）
      //   站在世界地图的空白格上读 → 就地建/搬自己的家（site 7），然后立刻进屋。
      if (Elona.Home && Elona.Home.isDeed(it)) {
        const hr = Elona.Home.build(this, it);
        if (hr.ok) {
          if (this.worldMap) this.advanceClock();
          else this.endTurn();
          const pr = Elona.Home.enter(this, 1);
          if (pr && pr.catch) pr.catch((e) => this.log('进入新家失败：' + e.message));
        } else {
          this.log(hr.message);
        }
        return hr;
      }
      // 0-CY / 0-FF：产权书（521 博物館 / 1296 収容所 / 522 店 / 542 畑 / 543 倉庫 /
      //            572 牧場 / 712 ダンジョン / 909 廃モンスター牧場）
      //   232700-232920：**只能在世界地图上**、对着一个没有其它据点的格子读，
      //   读完就在该格生成据点（var_132(16) = 建筑类型），而不是在城镇里就地建造。
      if (Elona.Property && Elona.Property.isBuildItem(it)) {
        const pr = Elona.Property.build(this, it, { confirmed: !!(opts && opts.confirm) });
        this.log(pr.message);
        if (pr.ok) {
          if (this.worldMap) this.advanceClock();
          else this.endTurn();
        }
        return pr;
      }
      // 0-CX：深淵魔術書(1249) → 打开深淵法术菜单。
      //   0-FY：解読用石/古書物(687) 按源码 *label_2947 改为「分回合解读」，
      //   读完才由 Elona.Abyss.decode 转成深淵魔力，不再按一下立刻到账。
      if (Elona.Abyss) {
        if ((it.id | 0) === Elona.Abyss.BOOK_ID) {
          return { ok: true, action: 'abyss-book', menu: Elona.Abyss.menu(this),
            power: Elona.Abyss.power(this) };
        }
      }
      // 0-CW：暗之棺（903）→ 召唤死灵（var_1302 == 63，355947-356064）
      if (Elona.Necro && Elona.Necro.isCoffin(it)) {
        const nr = Elona.Necro.summon(this, it, {});
        this.log(nr.message);
        if (nr.ok) {
          this.endTurn();
          return { ok: true, action: 'summon-undead', chara: nr.chara, learned: nr.learned };
        }
        return nr;
      }
      // 0-CF：捕获玉（685 monster ball / 699 little ball）→ 收服相邻怪物为宠物
      if ((it.id | 0) === 685 || (it.id | 0) === 699) {
        if (!Elona.Party || !Elona.Party.capture) {
          this.log('现在无法使用捕获玉。');
          return { ok: false, reason: 'no-party' };
        }
        const cap = Elona.Party.capture(this, it);
        this.log(cap.message);
        if (cap.ok) {
          if ((it.f[0] | 0) > 0) it.f[0]--;
          this.endTurn();
        } else if (cap.reason === 'no-target') {
          return { ok: false, reason: 'no-target' };
        } else if (cap.reason === 'full') {
          return { ok: false, reason: 'full' };
        } else {
          // 失败也消耗一颗
          if ((it.f[0] | 0) > 0) it.f[0]--;
          this.endTurn();
        }
        return { ok: cap.ok, capture: cap };
      }
      // 作物管理セット（1174）→ 打开栽培面板（手入れ/收获）
      if (Elona.Farm && (it.id | 0) === 1174) {
        return { ok: true, action: 'farm', idx };
      }
      // 0-FE：有機肥料（920，var_1302 == 65，364292-364334）→ 成长期作物直接催熟（253）
      if (Elona.Farm && (it.id | 0) === Elona.Farm.FERTILIZER) {
        const fr = Elona.Farm.fertilize(this);
        if (fr.ok) {
          if ((it.f[0] | 0) > 0) it.f[0]--;
          this.endTurn();
        }
        return fr;
      }
      // 0-FE：クミロミの活性化の宝玉（682，var_1302 == 31，364492-364534）
      //   → 种子期/成长期成长一级；枯萎复苏；成熟拒绝；72 小时冷却
      if (Elona.Farm && (it.id | 0) === Elona.Farm.JEWEL) {
        const jr = Elona.Farm.reviveOrGrow(this, undefined, undefined, it);
        if (jr.ok) this.endTurn();
        return jr;
      }
      // ヤカテクトの預金箱（1097）→ 银行窗口（358530-358661）
      if (Elona.Economy && (it.id | 0) === Elona.Economy.BANK_ITEM) {
        return { ok: true, action: 'bank', idx };
      }
      // 請求書（615）→ 缴税（279230-279243 生成，交给大使馆纳付）
      if (Elona.Economy && (it.id | 0) === Elona.Economy.BILL_ITEM) {
        const r = Elona.Economy.payBill(this, it);
        if (r.ok) {
          this.log(`缴纳了 ${r.paid} gold 的税金。`);
          this.gridChanged = true;
          if (this.onMapChange) { /* 地面物品清理由 renderer 处理 */ }
        } else if (r.reason === 'no-money') {
          this.log(`金貨が足りない…（需要 ${r.need}，持有 ${r.gold}）`);
        }
        return r;
      }
      // 0-DH：調教鞭（746）→ 同伴管教菜单（txtsettamer，10900-10960）
      if ((it.id | 0) === (Elona.Companion ? Elona.Companion.ITEM.WHIP : 746)) {
        const list = Elona.Companion ? Elona.Companion.activeAllies(this) : [];
        if (!list.length) { this.log('附近没有同伴。'); return { ok: false, reason: 'no-ally' }; }
        return { ok: true, action: 'tamer-whip' };
      }
      // 0-FK：能力複合機（684，效果 32，364518-364670）→ 基因合成（同伴二阶段选择）
      if (Elona.GeneMachine && (it.id | 0) === Elona.GeneMachine.ITEM) {
        if (!Elona.Companion || !Elona.Companion.allies(this).length) {
          this.log('你身边没有同伴。');
          return { ok: false, reason: 'no-ally' };
        }
        return { ok: true, action: 'gene-machine', item: it, idx };
      }
      // 0-DG：床 / 寝具 → 睡觉（*label_2937，312425-312455）
      if (Elona.Companion && Elona.Companion.isBed(it.id)) {
        const sr = Elona.Actions.startSleep(this, it);
        if (sr.ok) this.endTurn();
        return sr;
      }
      // 0-DG：听诊器（478）→ 同伴贴图下方显示 HP/MP/斗志 条
      //   0-EP：正常路径已由 core/itemfx_use.js 的 effect 5 接管（cbit 966 + __hpbar），
      //   这里只剩「itemfx_use.js 未加载」时的兜底。
      if ((it.id | 0) === (Elona.Companion ? Elona.Companion.ITEM.STETHOSCOPE : 478)) {
        const list = Elona.Companion.activeAllies(this);
        if (!list.length) { this.log('你身边没有同伴。'); return { ok: false, reason: 'no-ally' }; }
        const on = !list[0].__hpbar;
        for (const c of Elona.Party.members(this)) c.__hpbar = on;
        this.log(on ? '你给同伴戴上了听诊器（显示 HP/MP/斗志）。' : '你取下了听诊器。');
        return { ok: true, hpbar: on };
      }
      // 0-DG：指挥旗（865）→ 打开战术指示（全体同伴的战斗模式）
      if ((it.id | 0) === (Elona.Companion ? Elona.Companion.ITEM.FLAG : 865)) {
        if (!Elona.Companion.activeAllies(this).length) {
          this.log('附近没有同伴。');
          return { ok: false, reason: 'no-ally' };
        }
        return { ok: true, action: 'tactical', scope: 'all' };
      }
      // 0-DG：绳扣（634）→ 同伴掉队时立即传送回身边
      //   0-EP：正常路径已由 core/itemfx_use.js 的 effect 23 接管（cbit 968 + __leash），
      //   这里只剩「itemfx_use.js 未加载」时的兜底。
      if ((it.id | 0) === (Elona.Companion ? Elona.Companion.ITEM.LEASH : 634)) {
        const p0 = this.player;
        for (const c of Elona.Companion.activeAllies(this)) {
          if (typeof c.__leash !== 'boolean') c.__leash = true;
          c.__leash = !c.__leash;
        }
        this.log('绳扣已切换：同伴掉队时会' + (Elona.Companion.activeAllies(this)[0] && Elona.Companion.activeAllies(this)[0].__leash ? '' : '不') + '被拉回身边。');
        return { ok: true };
      }
      // 魔杖（refitem(id,5) == 56000）→ Wand.use（342598 的 *label_2986）
      if (Elona.Wand && Elona.Wand.isWand(it)) {
        return Elona.Wand.use(this, idx, opts);
      }
      // 乐器（refitem(id,5) == 60000 或 959 号）→ 演奏（319815-319866 的 var_1302 == 183 分支）
      if (Elona.Perform && Elona.Perform.isInstrument(it)) {
        const pf = Elona.Perform.use(this, idx);
        if (pf && pf.ok) return Object.assign({ ok: true, action: 'perform' }, pf);
        return pf || { ok: false };
      }
      // 钓竿（refitem(id,5) == 59000）→ 钓鱼（319897-320018 的 var_1302 == 185 分支）
      if (Elona.Fishing && Elona.ItemDB.ref(it.id, 5) === 59000) {
        const rf = Elona.Fishing.useRod(this, idx);
        if (rf && rf.ok) return Object.assign({ ok: true }, rf);
        return rf || { ok: false };
      }
      const cat = Elona.ItemDB.ref(it.id, 5);
      let mode = modeHint;
      if (!mode) mode = cat === 52000 ? 15 : ((cat === 57000 || cat === 91000) ? 14 : 13);
      // 食物（57000 / 91000 / f24==35）：*label_2944 → *label_2304 的结算
      const edible = cat === 57000 || cat === 91000 || (it.f[24] | 0) === 35;
      if (mode === 14 && edible) {
        return this.eatFood(p, it);
      }
      // 书物（54000）：*label_2947 —— 分回合阅读；魔法书读完加魔力库存，
      //   783 食谱学配方、687 古书解读成深淵魔力（0-FY 补齐）。
      if (cat === 54000) {
        if (opts && opts.instant) return this.readSpellbook(p, it);
        return this.beginReading(idx, opts);
      }
      const r = Elona.ItemUse.use(this, p, it, mode, p);
      if (!r || !r.implemented) {
        // 有已知但未实现的使用效果（itemfx.json）时给出准确说明
        const hint = Elona.ItemFx ? Elona.ItemFx.describe(it) : null;
        const msg = hint
          || ((r && r.special) ? '这个物品需要专用的阅读/使用例程（尚未移植）。' : '什么也没有发生。');
        this.log(msg);
        return Object.assign({ ok: false, hint: hint || undefined }, r);
      }
      this.log(`使用了 ${Elona.ItemDB.name(it.id, 'en')}。`);
      // 0-BT：药水专例消息（Potion.dispatch 的 messages）
      if (r.messages && r.messages.length) {
        for (const m of r.messages) this.log(m);
      }
      // 0-BS：resistmod/resistmodh 效果消息（itemuse.json entry.resist）
      if (r.resist && r.resist.length) {
        for (const rr of r.resist) if (rr.message) this.log(rr.message);
      }
      // 使用是一次行动；效果若为 UI 请求（如鉴定卷轴 411）由表现层消费
      this.endTurn();
      return Object.assign({ ok: true }, r);
    }

    /**
     * 使用**脚下**的物品（0-DF）。
     *
     * 源码 296199 的 `repeat 2`：cnt=0 遍历地图物品（inv_getheader -1）、cnt=1 遍历背包，
     * 所以 t 键（var_486=14）的使用列表是「脚下物品 + 背包物品」。
     * 这里把该物品临时移入背包末尾以复用 useItem 的全部专例；
     * 使用后若物品仍存在且未进入 rowact（床/家具这类不消耗），再放回原格。
     */
    useGroundItem(it, opts) {
      if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item' };
      const p = this.player;
      const x = it.f[5] | 0, y = it.f[6] | 0;
      const gi = (this.groundItems || []).indexOf(it);
      if (gi < 0) return this.useItem(p.inv.indexOf(it));
      this.groundItems.splice(gi, 1);
      let slot = -1;
      for (let k = 0; k < p.inv.length; k++) {
        if (!p.inv[k] || (p.inv[k].f[0] | 0) <= 0) { slot = k; break; }
      }
      if (slot === -1) { p.inv.push(it); slot = p.inv.length - 1; } else { p.inv[slot] = it; }
      const r = this.useItem(slot, 0, Object.assign({ onGround: true }, opts || {}));
      // 未消耗且没进入 rowact → 放回地面
      const still = p.inv.indexOf(it);
      if (still >= 0 && (it.f[0] | 0) > 0 && (p.get(140) | 0) === 0) {
        p.inv[still] = null;
        it.f[5] = x; it.f[6] = y;
        this.groundItems.push(it);
        if (it.townOwned) it.f[21] = it.f[21] || 1;
      }
      this.refreshGroundCell(x, y);
      return r;
    }

    /**
     * 开始进食 —— *label_2944（313507-313545）。
     *   var_58(140)=1（进食中）、141=8 回合（feat 225 → 4，食物 812 → 1）、
     *   142=物品下标；物品在吃完前不消耗。
     *   var_58(140) 已为 1 时拒绝（原版 rowact 中不能再次进食）。
     */
    eatFood(p, it) {
      if ((p.get(140) | 0) === 1) {
        this.log('你正在进食，先吃完再说。');
        return { ok: false, reason: 'busy' };
      }
      if ((p.get(22) | 0) > 10000) {
        this.log('你现在太饱了，吃不下。');
        return { ok: false, reason: 'too-full' };
      }
      let turns = 8;
      if (p.index === 0 && Elona.Feat && Elona.Feat.get && Elona.Feat.get(p, 225)) turns = 4;
      if (it.id === 812) turns = 1;
      p.set(140, 1);
      p.set(141, turns);
      p.set(142, p.inv.indexOf(it));
      this.log(`你开始进食 ${Elona.ItemDB.name(it.id, 'en')}（${turns} 回合）。`);
      this.endTurn();
      return { ok: true, started: true, turns };
    }

    /**
     * 0-DH：一緒に食事 —— 与同伴分享一份食物（源码动作 84，421144-421189）。
     *   原版先弹食物选择窗（`var_486 = 23, 17`），选中后两人共用一份：
     *   营养增加量减半、技能经验两人各得一份（合计 200%）。
     */
    startShareMeal(g, ally, it) {
      if (!ally) return { ok: false, message: '没有同伴。' };
      const p = this.player;
      if (!it || (it.f[0] | 0) <= 0) return { ok: false, message: '没有可以吃的东西。' };
      if ((p.get(22) | 0) > 10000 || (ally.get(22) | 0) > 10000) {
        this.log('（有一方还很饱，吃不下。）');
        return { ok: false, reason: 'too-full' };
      }
      this._mealShare = { ally };
      const r = this.eatFood(p, it);
      if (!r.ok) this._mealShare = null;
      else this.log(`（和${ally.name}一起分着吃。）`);
      return r;
    }

    /** 每回合推进进食（原版 rowact 的 var_58(141)--） */
    advanceEating(p) {
      if (!p || (p.get(140) | 0) !== 1) return null;
      const left = (p.get(141) | 0) - 1;
      p.set(141, left);
      if (left > 0) return { turnsLeft: left };
      return this.finishEating(p);
    }

    /**
     * 0-GM / 203900-203915：教程提示窗口的文案（原版 `var_1280` → gosub *label_0262）。
     * 原版用 ie_guide.bmp 画窗口；本项目用日志/Panel 文本呈现，只还原取词与变量展开。
     * @param {number|string} id 教程编号（exhelp.txt 的 %N 类别）
     */
    showGuide(id) {
      const r = Elona.IdleTalk && Elona.IdleTalk.guide(this, id, { lang: 'en' });
      if (!r || !r.text) return null;
      for (const row of r.text.split('\n')) {
        if (row.trim()) this.log(row.trim());
      }
      return r;
    }

    /**
     * 吃完结算 —— *label_2944 的完成段（313546-313587）+ *label_2304（225137-226114）。
     *   营养、水分、SP、食物技能成长、消耗 1 个物品。
     */
    finishEating(p) {
      const who = (p.index | 0) === 0 ? '你'
        : (typeof p.name === 'function' ? (p.name('zh') || p.name('en') || '某人') : (p.name || '某人'));
      const idx = p.get(142) | 0;
      const it = p.inv && p.inv[idx];
      p.set(140, 0); p.set(141, 0); p.set(142, 0);
      if (!it || (it.f[0] | 0) <= 0) {
        this.log('进食结束了。');
        return { ok: false, reason: 'no-item' };
      }
      const id = it.id;
      const f20 = it.f[20] | 0;
      const f26 = it.f[26] | 0;
      const cursed = (it.f[17] | 0) <= -1;
      const rotten = (it.f[24] | 0) === 35 && (it.f[27] | 0) < 0;   // 225511-225519

      // 营养：默认 2500；带饮料 +2500；1128/1129 大幅减少；味道 f26>0 时 ×175%
      let gain = 2500;
      if (Elona.ItemDB.ref(id, 10) === 1) gain += 2500;
      if (id === 1128) gain = idiv(gain, 20);
      if (id === 1129) gain = idiv(gain, 25);
      if (f26 > 0) gain = idiv(gain * 175, 100);
      if (cursed) gain = idiv(gain, 2);                 // 226092-226094：诅咒食物营养减半
      // 0-DH：一緒に食事（421144-421189「仲良く料理を分け合った…」）——
      //   同一份食物两人分，満腹度增加量减半、经验两人各得一份（总 200%）。
      const shared = this._mealShare && this._mealShare.ally;
      if (shared) gain = idiv(gain, 2);
      p.set(22, (p.get(22) | 0) + gain);

      // 57000 类食物回复 SP（226112-226114）
      if (Elona.Status && Elona.Status.healsp) {
        Elona.Status.healsp(p, 5 + f26 * 3 + f20 * 3);
      }

      // 0-DH：分享用餐 —— 同伴也吃到同一份（营养减半的那一半、技能经验各一份）
      if (shared) {
        const ally = shared;
        this._mealShare = null;
        if (ally && (ally.get(0) | 0) === 1) {
          ally.set(22, (ally.get(22) | 0) + gain);
          if (Elona.Status && Elona.Status.healsp) {
            Elona.Status.healsp(ally, 5 + f26 * 3 + f20 * 3);
          }
          if (Elona.Stats && Elona.Stats.skillExp) {
            for (const e of this.foodSkillGrowth(it, f20, f26)) {
              Elona.Stats.skillExp(ally, e.id, ally, e.rotten ? idiv(e.exp, 3) : e.exp, 1, 0, this);
            }
          }
          if (Elona.Companion) Elona.Companion.addHappiness(ally, 1);
          this.log(`${ally.name}也一起吃了（营养 +${gain}）。`);
        }
      }

      // 313561-313583：附带的饮料补充水分
      if (Elona.ItemDB.ref(id, 10) === 1 && (p.get(446) | 0) < 12000) {
        p.set(446, (p.get(446) | 0) + 2000);
        this.log(`${who}连附带的饮料也喝完了。`);
      }

      // 食物技能成长（*label_2304）：先按食物类型取基础值，再按味道 f26 修正
      if (Elona.Stats) {
        if (f20 > 0 && Elona.Stats.modGrowth) {
          Elona.Stats.modGrowth(p, 18, p, idiv(f20, 2) + 3, this);   // 225469-225471
        }
        for (const e of this.foodSkillGrowth(it, f20, f26)) {
          // 226066-226075：腐烂食物（f27 < 0）技能经验 ×1/3
          const exp = rotten ? idiv(e.exp, 3) : e.exp;
          Elona.Stats.skillExp(p, e.id, p, exp, 1, 0, this);        // 226088
        }
      }

      // 0-BS：食物的耐性效果（*label_2304 内的 resistmod/resistmodh 调用，
      // start.hsp 195109/195294；物品侧调用点由 extract_itemuse.py 第二遍提取到 itemuse.json，58 处）
      const eatEntry = Elona.ItemUse.entryOf(id, 12);
      if (eatEntry && eatEntry.resist && Elona.Resist) {
        for (const rr of eatEntry.resist) {
          const delta = Elona.ItemUse.evalNum(rr.delta);
          if (delta === null) continue;   // 无法求值的表达式：不做处理（不臆造）
          const fn = rr.kind === 'resistmodh' ? Elona.Resist.resistModH : Elona.Resist.resistMod;
          const out = fn(p, rr.ele, delta);
          if (out.message) this.log(out.message);
        }
      }

      // 226013-226059：尸体（204）—— 人型尸体的三种反应
      //   `refchara(f[23], 8, 1)` 的种族标签含 `/man/` 才是人肉（226014-226016）：
      //     · 吃了人肉 → var_65(250+30)++（食人次数）
      //     · feat 41「食人」→「这是你最爱的人肉！」（不扣狂气、不混乱）
      //     · 否则 → 狂气 -15、混乱 150，且 1/5 概率觉醒 feat 41（226034-226045）
      //     · 非人型尸体 + 有 feat 41 →「虽然你更想吃人肉……」
      if (id === 204) {
        const species = it.f[23] | 0;
        const tag = (Elona.EnchantFX && Elona.EnchantFX.raceTag)
          ? Elona.EnchantFX.raceTag(species) : '';
        const isMan = tag.indexOf('/man/') >= 0;
        const cannibal = (Elona.Feat && Elona.Feat.get) ? (Elona.Feat.get(p, 41) | 0) : 0;
        if (isMan) {
          this.setV65(280, (this.getV65(280) | 0) + 1);      // 226017
          if (cannibal) {
            this.log('这是你最爱的人肉！');                    // 226022
          } else {
            this.log('这是人肉……呜呃！');                      // 226029
            if (Elona.Status && Elona.Status.dmgsan) Elona.Status.dmgsan(p, 15, this);
            if (Elona.Resist && this.dmgconTable) {
              Elona.Resist.dmgcon(this, this.dmgconTable, p, 11, 150);
            }
            if (this.rng.rnd(5) === 0) {                       // 226034-226045
              Elona.Feat.set(p, 41, 1);
              this.log('你觉得自己好像能接受人肉了……（取得特性「食人」）');
            }
          }
        } else if (cannibal) {
          this.log('虽然你更想吃人肉……');                     // 226055
        }
      }

      // 0-GM / 226445-226465：738 フォーチュンクッキー —— 读了饼干里的签文
      //   先 gosub *label_0263 取 %COOKIE2；祝福（f17>=1）或普通（f17==0 且 rnd(2)）
      //   再取 %COOKIE1 覆盖 var_122；最后只输出最后一次的结果。
      if (id === 738 && (p.index | 0) < 16 && Elona.IdleTalk) {
        const bless = it.f[17] | 0;
        this.log(`${who}读了饼干里的签文。`);
        let fortune = Elona.IdleTalk.cookie(this, 2, { lang: 'en' });
        if (bless >= 1 || (bless === 0 && this.rng.rnd(2) !== 0)) {
          const second = Elona.IdleTalk.cookie(this, 1, { lang: 'en' });
          if (second) fortune = second;
        }
        if (fortune && fortune.text) this.log(fortune.text);
      }

      // 313650-313664：饼类食物有概率噎住（var_58(263) = 100 + rnd(100)）
      if ((id === 755 && this.rng.rnd(3)) || (id === 756 && this.rng.rnd(10) === 0)
        || (id === 1107 && this.rng.rnd(3) === 0) || (id === 1108 && this.rng.rnd(3) === 0)) {
        p.set(263, 100 + this.rng.rnd(100));
        this.log(`${who}被饼噎住了！`);
      }
      if (rotten) this.log(`${who}吃下了腐烂的食物……`);

      // 226709-226804：食物附魔的食用效果（体力/魔力吸取、属性与技能经验、
      //   潜力回复、属性维持 buff、终结、时停）
      if (Elona.EnchantFX && Elona.EnchantFX.applyFood) {
        const fx = Elona.EnchantFX.applyFood(this, p, it);
        if (fx.length) {
          const kinds = fx.map((x) => x.kind);
          if (kinds.indexOf('apocalypse') >= 0) this.log('你感到世界在扭曲……（终结发动）');
          if (kinds.indexOf('time-stop') >= 0) this.log('时间停止了。');
          if (kinds.indexOf('potential') >= 0) this.log('你的潜力发生了变化。');
          if (kinds.indexOf('growth-buff') >= 0) this.log('你感到成长变得容易了。');
        }
      }

      it.f[0] = (it.f[0] | 0) - 1;
      if (it.f[0] <= 0) it.f[0] = 0;
      this.log(`${who}吃完了 ${Elona.ItemDB.name(id, 'en')}（营养 +${gain}）。`);
      // 226079 chara_anorexia：患拒食症（cbit 986）时进食必定呕吐（201928-201933）。
      let vomited = null;
      if (Elona.Vomit && Elona.Status && Elona.Status.cbit(p, 986)) {
        vomited = Elona.Vomit.vomit(this, p);
        if (vomited) for (const m of vomited.messages) this.log(m);
      }
      // 314918-314921：吃太多（満腹度 > 12000*2）时有 1/5 概率呕吐
      if (Elona.Vomit) {
        const over = !vomited ? Elona.Vomit.afterEat(this, p) : null;
        if (over) { vomited = over; for (const m of over.messages) this.log(m); }
      }
      return { ok: true, gain, rotten, cursed, nutrition: p.get(22), vomited: !!vomited };
    }

    /**
     * 0-EY：投掷食物命中角色时的「瞬间进食」（341640-341647 → label_2945/2946）。
     * 把外部物品临时挂到进食者背包上，复用 finishEating 的全部结算（营养 / 经验 /
     * 附魔 / 拒食症呕吐），再撤掉临时槽；物品耗尽后由调用方从地面容器移除。
     */
    eatItemNow(eater, it) {
      if (!eater || !it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item' };
      const inv = eater.inv || (eater.inv = []);
      let idx = -1;
      for (let i = 0; i < inv.length; i++) {
        if (!inv[i] || (inv[i].f[0] | 0) <= 0) { idx = i; break; }
      }
      if (idx < 0) { idx = inv.length; inv.push(it); } else { inv[idx] = it; }
      eater.set(142, idx);
      const res = this.finishEating(eater);
      if (inv[idx] === it) inv[idx] = null;
      return res;
    }

    /** 食物 → 技能经验表（225170-225380 的分支简化） */
    foodSkillGrowth(it, f20, f26) {
      const type = idiv(it.f[25] | 0, 1000);
      let list;
      if (type === 1 || it.id === 571) {
        list = [[10, 30], [11, 40], [17, 10]];
      } else if (type === 8) {
        list = [[17, 20], [13, 20], [15, 20]];
      } else if (type === 2 || it.id === 1103) {
        list = [[15, 50], [14, 50]];
      } else if (type === 3 || it.id === 1102) {
        list = [[16, 50], [17, 20], [13, 30]];
      } else if (type === 5) {
        list = [[10, 25], [12, 25], [14, 25], [11, 25]];
      } else if (type === 6) {
        list = [[16, 40], [12, 30], [14, 30]];
      } else if (type === 4) {
        list = [[14, 40], [12, 40], [13, 20]];
      } else if (type === 7 || type === 9) {
        list = [[11, 60], [12, 40]];
      } else {
        // 225745-225748：普通食物，全属性小幅成长
        list = [[10, 130], [11, 130], [17, 130], [16, 130], [12, 130],
          [13, 130], [14, 130], [15, 130], [18, 130]];
      }
      return list.map(([id, base]) => {
        let exp = base + (type === 0 ? 0 : f20);
        // 225475-225491：味道修正
        if (f26 > 0) {
          if (f26 < 3) exp = idiv(exp, 2);
          else exp = idiv(exp * (50 + f26 * 20), 100);
        }
        return { id, exp };
      });
    }

    /**
     * 0-FX：开始读书 —— *label_2947（313738-313760）。
     *   var_400 = 难度：783 教材 50；687 古书 50 + f25*50 + f25²*20；
     *             法术书 var_83(4, spellId)（本项目 actions.json 的 f[4]）
     *   var_58(141) = var_400 / (2 + 読書150) + 1   ← 阅读技能越高读得越快
     *   var_58(142) = 书；之后每回合递减，减到 0 才走 313864 的结算。
     */
    beginReading(idx, opts) {
      const p = this.player;
      const it = p.inv && p.inv[idx];
      if (!it) return { ok: false, reason: 'no-item' };
      const A = Elona.Actions;
      if (!A) return this.readSpellbook(p, it);
      const entry = Elona.ItemUse.entryOf(it.id, 13);
      const spellId = entry && entry.spell ? (entry.spell | 0) : 0;
      const eid = it.id | 0;
      let diff;
      if (eid === 783) diff = 50;
      else if (eid === 687) {
        const n = it.f[25] | 0;
        diff = 50 + n * 50 + n * n * 20;
      } else diff = (spellId && Elona.Spell) ? (Elona.Spell.field(spellId, 4) | 0) : 100;
      if (diff <= 0) diff = 100;
      const lit = p.skill ? (p.skill(150) | 0) : 0;   // 読書
      const turns = idiv(diff, 2 + lit) + 1;
      const started = A.begin(this, 2, turns, { idx, id: eid, spellId, diff });
      if (!started.ok) { this.log(started.message || '现在不能读书。'); return started; }
      const verb = eid === 687 ? '解读' : (eid === 783 ? '研究' : '读');
      this.log(`你开始${verb}${Elona.ItemDB.name(eid, 'en')}。（约 ${turns} 回合）`);
      this.endTurn();
      return { ok: true, action: 'reading', spellId, turns, reading: true };
    }

    /**
     * 0-FX：持续行动完成结算 —— 只有 var_58(141) 减到 0 且没被中断才会进来。
     * 由 core/actions.js 的通用倒计时调用。
     */
    completeRowAct(type, payload) {
      const pl = payload || {};
      const A = Elona.Actions;
      if (type === 2) {
        const it = (this.player.inv || [])[pl.idx] || null;
        if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'book-gone' };
        return this.settleReading(it, pl.spellId | 0);
      }
      if (type === 8 && Elona.Gather) {
        // 采集点：40 回合后真正产出（*label_2941 → *label_2909）
        const r = Elona.Gather.gather(this);
        for (const m of (r.messages || [])) this.log(m);
        return r;
      }
      if (type === 12 && Elona.Craft && Elona.Craft.finish) {
        // 0-FY：調合（*label_2659 → *label_2658）—— 回合数已在 rowact 里消耗完
        return Elona.Craft.finish(this, pl);
      }
      if (type === 10 && pl.campMode) {
        // 0-FY：*label_2932 的建设(101) / 训练(104) 分支
        return this.completeCampRowAct(pl);
      }
      if (type >= 26 && type <= 28 && Elona.Work) {
        // 0-GB：按 *label_2927 结算（配额削减 + 歇了口气），不再凭空发金币
        return Elona.Work.finish(this, type, pl);
      }
      if (type === 29 && Elona.Work) {
        return Elona.Work.begFinish(this, pl);
      }
      // 0-GC：特技型持续行动的完成段（19-23 / 33 / 30 / 31 / 16 / 18）
      if (Elona.Social && ((type >= 19 && type <= 23) || type === 33
        || type === 30 || type === 31 || type === 16 || type === 18)) {
        return Elona.Social.finish(this, type, pl);
      }
      if (typeof pl.onDone === 'function') return pl.onDone(this, type, pl);
      this.log(`你完成了${A ? A.rowactName(type) : '行动'}。`);
      return { ok: true, type };
    }

    /** 0-FY：书页消耗（类方法入口，实现见模块级 consumeBookPage） */
    consumeBookPage(it, force) { return consumeBookPage(it, force); }

    /**
     * 0-FY：*label_2932 的 101 建设 / 104 训练完成段（311715-311724 / 311770-311785）。
     *   101 调用 *label_2979 在世界地图落地据点；本项目接到 Property.build，
     *   若该道具不是产权书则只把 f[21] 标成「已建成」（差异见 0-FY.6）。
     */
    completeCampRowAct(pl) {
      const mode = pl.campMode | 0;
      const p = this.player;
      if (this.setV65) this.setV65(91, 0);
      if (mode === 101) {
        const it = (p.inv || []).find((x) => x && (x.f[0] | 0) > 0 && (x.id | 0) === (pl.itemId | 0));
        if (it) {
          it.f[21] = 3;                       // var_99(21) = 3：已建成
          if (Elona.Property && Elona.Property.isBuildItem(it) && Elona.Property.build) {
            const r = Elona.Property.build(this, it, { confirmed: true });
            this.log(r && r.ok ? `你建好了避难所。${r.message || ''}` : '避难所组装完了，但这里放不下据点。');
          } else {
            this.log('你建好了避难所。');
          }
        } else {
          this.log('你建好了避难所。');
        }
      } else if (mode === 104) {
        const sid = pl.skill | 0;
        if (sid && Elona.Stats && Elona.Stats.skillExp) {
          Elona.Stats.skillExp(p, sid, p.index, 100, 1, 0, this);
        }
        this.log('你完成了训练。');
      } else {
        this.log('你完成了工作。');
      }
      return { ok: true, mode };
    }

    /**
     * 0-FY：读书每回合的 *label_2217（215469-215570）判定。
     *   var_1442 = 1；按 (読書150 × 属性能力 × 4 + 250) 与书的难度互掷，
     *   失败时 rowactend + 书页 -1，并附带吸魔 / 混乱 / 召唤等副作用。
     *   返回 {failed:true} 时由 Actions.tickRowAct 提前结束 rowact（不结算）。
     */
    tickReading(pl) {
      const p = this.player;
      if (!pl) return null;
      const it = (p.inv || [])[pl.idx] || null;
      if (!it || (it.f[0] | 0) <= 0) return { failed: true, reason: 'book-gone' };
      const diff = Math.max(1, pl.diff | 0);
      const lit = p.skill ? (p.skill(150) | 0) : 0;                 // 読書
      const ability = Math.max(1, p.skill ? (p.skill(16) | 0) : 1); // var_82(16)
      const r = (n) => this.rng.rnd(Math.max(1, n | 0));
      let bad = false;
      // var_58(253) 盲目 / var_58(254) 混乱：原版必失败 / 3/4 失败
      const blind = Elona.Status && Elona.Status.cbit ? (Elona.Status.cbit(p, 978) | 0) : 0;
      if (blind) bad = true;
      else if (r((lit + ability) * ability * 4 + 250) < r(diff + 1)) {
        if (r(7) === 0) bad = true;
        if (ability * 10 < diff && r(ability * 10 + 1) < r(diff + 1)) bad = true;
        if (ability * 20 < diff && r(ability * 20 + 1) < r(diff + 1)) bad = true;
        if (ability * 30 < diff && r(ability * 30 + 1) < r(diff + 1)) bad = true;
      }
      if (!bad) return { failed: false };
      // 失败演出（215525-215570 的三选一；召唤怪物分支本项目不生成怪，折算为提示）
      if (r(4) === 0) {
        p.mp = Math.max(0, (p.mp | 0) - Math.max(1, idiv(p.mp | 0, 4)));
        this.log('你被吸走了魔力！');
      } else if (r(4) === 0) {
        this.log('太难懂了！头脑一片混乱。');
      } else {
        this.log('魔力之涡发生了异变，阅读被迫中断。');
      }
      const gone = consumeBookPage(it, false);
      if (gone) this.log(`${Elona.ItemDB.name(it.id, 'en')}化作了尘土。`);
      return { failed: true, reason: 'vortex', consumed: gone };
    }

    /**
     * 阅读结算 —— *label_2947（313802-313931）。
     *   783 レシピ：学配方 var_500(f[23])++，书必定消失；
     *   687 古書物：深淵魔力 += (f[25]+1)*100（上限 100000），f[26]=1、f[9]=1，不消耗；
     *   其它魔法书：gain = (rnd(51)+50) * (90 + 暗記165 + (暗記>0)*20) / 200 + 100，
     *     上限 999；skillgain(法术技能, 1, gain)；已读标记 var_498(2,bookId)=1；
     *     同伴获得 skillexp 150 / 400 与 165 / (10 + 难度/2)；最后 f[9]--。
     * 【已核对】313864 增益用的是 var_82(165)（暗記），而回合数 313751 用
     *   var_82(150)（読書）—— 0-FX 文档曾把 165 记成偏差，实为源码正确行为。
     * 【注】分回合阅读由 beginReading / completeRowAct 承接；本函数也是
     *   opts.instant 的立即结算入口。
     */
    settleReading(it, spellId) {
      const p = this.player;
      const eid = it.id | 0;
      const bname = Elona.ItemDB.name(eid, 'en');

      // 313802-313827：レシピ（教材）
      if (eid === 783) {
        if ((it.f[25] | 0) === 0) {
          this.log('这张纸片上没有写任何配方。');
          return { ok: false, reason: 'empty-recipe' };
        }
        const rid = it.f[23] | 0;
        if (!this.knownRecipes) this.knownRecipes = {};
        this.knownRecipes[rid] = 1;
        consumeBookPage(it, true);
        this.log(`你学会了配方 #${rid}！${bname}化作了尘土。`);
        return { ok: true, recipe: rid, learned: true };
      }

      // 313828-313863：古書物 / 解読用石
      if (eid === 687) {
        if (!Elona.Abyss || !Elona.Abyss.decode) {
          this.log('你无法解读这本书。');
          return { ok: false, reason: 'no-abyss' };
        }
        const ab = Elona.Abyss.decode(this, it);
        this.log(`你解读了 ${bname}！${ab.message || ''}`);
        return Object.assign({ ok: true, decoded: true, book: eid }, ab);
      }

      if (!spellId) { this.log('这本书无法解读。'); return { ok: false, reason: 'no-spell' }; }
      const readSkill = p.skill(165) | 0;                 // 暗記（313864）
      let gain = idiv((this.rng.rnd(51) + 50) * (90 + readSkill + (readSkill > 0 ? 20 : 0)), 200) + 100;
      if (gain > 999) gain = 999;
      if (Elona.Stats && Elona.Stats.skillGain) {
        Elona.Stats.skillGain(p, p.index, spellId, 1, gain, this);
      }
      const stock = p.spellStock ? p.spellStock[spellId - 400] : 0;
      // var_498(2, bookId) = 1（已读过的书，313877-313880）
      if (!this.readBooks) this.readBooks = {};
      this.readBooks[eid] = 1;
      // item_identify（313904）
      if (Elona.ItemDB && Elona.ItemDB.identify) Elona.ItemDB.identify(it, 1);
      // 313880-313903：视野内同伴获得読書 / 暗記经验
      if (Elona.Stats && Elona.Stats.skillExp && this.charas) {
        for (const c of this.charas) {
          if (!c || c === p || (c.get(0) | 0) !== 1) continue;
          if (Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) > 5) continue;
          Elona.Stats.skillExp(c, 150, p, 400, 1, 0, this);
          Elona.Stats.skillExp(c, 165, p, 10 + idiv(Elona.Spell && Elona.Spell.field
            ? (Elona.Spell.field(spellId, 4) | 0) : 0, 2), 1, 0, this);
        }
      }
      const gone = consumeBookPage(it, false);
      this.log(`你读完了 ${bname}，魔力库存 +${gain}（当前 ${stock}）。${gone ? '书化作了尘土。' : ''}`);
      return { ok: true, spellId, gain, stock, bookGone: gone };
    }

    readSpellbook(p, it) {
      const entry = Elona.ItemUse.entryOf(it.id, 13);
      const spellId = entry && entry.spell ? (entry.spell | 0) : 0;
      const r = this.settleReading(it, spellId);
      this.endTurn();
      return r;
    }

    /**
     * 玩家咏唱法术/能力 —— *label_2950 的玩家路径（315507-315573）。
     * 消耗：MP（calcspellcostmp）+ 魔力库存（calcspellcoststock）；
     * 失败率：calcspellfail（var_1430）；效果：Spell.cast（前置检查 + *label_2960）。
     * @param {number} id 法术/能力 id（400-599）
     */
    castPlayerSpell(id, opts) {
      const p = this.player;
      const S = Elona.Spell;
      if (!S) return { ok: false, reason: 'no-spell' };
      const slot = id - 400;
      const stock = p.spellStock ? (p.spellStock[slot] | 0) : 0;
      if (stock <= 0) { this.log('你还没有习得这个法术。'); return { ok: false, reason: 'no-stock' }; }

      const f1 = S.field(id, 1);
      let target = p;
      const selfOnly = f1 === 0 || f1 === 4 || f1 === 5 || idiv(f1, 1000) === 1;
      if (!selfOnly) {
        target = Elona.Throw ? Elona.Throw.nearestEnemy(this, p, 20) : null;
        if (!target) { this.log('没有可以瞄准的目标。'); return { ok: false, reason: 'no-target' }; }
      }
      // 地面指定（var_83(3,id) 的类别 7000）：玩家侧先选方向再咏唱（315674-315683）
      const tile = (opts && opts.tile) || null;
      const pre = S.precheck ? S.precheck(this, p, id, target, tile) : { ok: true, target, tile };
      if (!pre.ok && pre.reason === 'need-tile') return { ok: false, reason: 'need-tile' };
      if (!pre.ok) {
        // 315794「射程距離外だ。」/ 315720「その場所は見えない。」
        this.log(pre.reason === 'out_of_range' ? '射程距离外。'
          : (pre.reason === 'no_los' ? '那个地方看不见。' : '咏唱中止。'));
        return { ok: false, reason: pre.reason };
      }
      // 214650-314656：艾赫卡托尔（神 4）信徒 —— 消耗 = cost/10 + rnd(cost+1)，最低 1
      //（wiki「魔法技能」页记作「艾赫卡托尔流魔术：咏唱消耗在 0.1~1.1 倍间浮动」）
      let mpCost = S.calcSpellCostMp(id, p, this);
      if ((p.get(61) | 0) === 4) {
        mpCost = idiv(mpCost, 10) + this.rng.rnd(mpCost + 1);
        if (mpCost < 1) mpCost = 1;
      }
      // 314655-314658：物种 1041（异世界猎豹）咏唱不消耗 MP（玩家物种恒 0，仅照抄分支）
      const freeCast = (p.get(27) | 0) === 1041;
      if (!freeCast && p.mp < mpCost && !(opts && opts.overcast)) {
        // 314562-314582：「マナが足りないが、それでも詠唱を試みる？」——
        // 允许超量施法（MP 扣成负值 → 魔力反噬）。UI 钩子由 main.js 注入；
        // 无钩子时退回旧行为（拒绝）。
        if (Elona.overcastConfirm) {
          Elona.overcastConfirm(this, id, (ok) => {
            if (ok) this.castPlayerSpell(id, Object.assign({}, opts || {}, { overcast: true }));
          });
          return { ok: false, reason: 'overcast', spell: id, mpCost };
        }
        this.log('MP 不足。');
        return { ok: false, reason: 'no-mp' };
      }
      const stockCost = S.calcSpellCostStock(id, p, this);

      // 消耗（314641-314645 玩家库存扣除；314658-314661 MP 走 dmgmp ——
      //   魔力漏出增幅 + MP 变负时的「魔力反噬」都在 dmgmp 内结算）
      if (!freeCast) Elona.Status.dmgmp(p, mpCost, this);
      p.spellStock[slot] = Math.max(0, stock - stockCost);

      const fail = S.calcSpellFail(id, p, this);
      if (this.rng.rnd(100) < fail) {
        this.log('咏唱失败了。');
        this.endTurn();
        return { ok: false, reason: 'fail', failed: true };
      }
      const r = S.cast(this, p, id, pre.target || target, tile);
      const nameObj = S.actionName(id);
      const nm = nameObj ? (nameObj.ch || nameObj.en || nameObj.jp || `#${id}`) : `#${id}`;
      this.log(`你咏唱了 ${nm}。`);
      // 效果自带的台词（406/407/412/429/430/461/464/465/466 …）
      if (r && r.message) this.log(r.message);
      for (const m of ((r && r.messages) || [])) this.log(m);
      if (r && r.request && Elona.consumeSpellRequest) Elona.consumeSpellRequest(r);
      this.endTurn();
      return r;
    }

    /**
     * 发动能力 / 特殊技能 —— *label_2958（315507-315573）。
     * 实现在 core/ability.js（便于单测），这里只做转发。
     * @param {number} id 600..879 为能力（需 var_98 已解锁）；300/301 为特殊技能
     */
    useAbility(id, opts) {
      if (!Elona.Ability) return { ok: false, reason: 'no-ability' };
      return Elona.Ability.use(this, id, opts);
    }

    // ---------- 射击 / 投掷 ----------

    /**
     * f 键（*label_2839 → *label_3005）。
     * 2836 会先用 `var_58(29, 主角)`（= 手动锁定的目标），没有才自动索敌，
     * 所以这里先看锁定目标，未锁定/已失效时才退化成「最近的敌人」。
     */
    fireAtNearest() {
      const p = this.player;
      const lock = Elona.Aim ? Elona.Aim.target(this) : null;
      if (lock && lock.chara) return this.fireAtTarget(lock.chara);
      const target = Elona.Throw ? Elona.Throw.nearestEnemy(this, p, 20) : null;
      if (!target) { this.log('没有可以射击的目标。'); return { ok: false, reason: 'no-target' }; }
      return this.fireAtTarget(target);
    }

    /**
     * 向指定目标射击 —— 与 fireAtNearest 共用同一结算（*label_2839 → *label_3005）。
     * 供 `*` 手动锁定目标后使用。
     */
    fireAtTarget(target) {
      const p = this.player;
      if (!target || (target.get(0) | 0) !== 1 || (target.hp | 0) <= 0) {
        this.log('目标已经不在了。');
        return { ok: false, reason: 'no-target' };
      }
      const r = Elona.Battle.rangedAttack(this, p, target);
      if (!r.ok) {
        const msg = {
          'no-weapon': '你没有装备射击武器。',
          'no-ammo': '需要装填箭矢或子弹。',
          'mismatch': '弹药的种类不匹配。',
        }[r.reason] || '无法射击。';
        this.log(msg);
        return r;
      }
      const a = r.result;
      if (!a) { this.log('射击失败。'); this.endTurn(); return r; }
      if (!a.hit) this.log(`你向 ${target.name} 射击 —— 未命中。`);
      else this.log(`你向 ${target.name} 射击${a.critical ? '（会心一击！）' : ''} —— ${a.dmg} 点伤害，剩余 HP ${target.hp}`);
      if (target.hp <= 0) {
        this.log(`${target.name} 被击倒了。`);
        // 0-GH：近战 / 远程 / 法术 / 能力统一走 Battle.onDeath
        //   （经验、招募、盗窃、暗棺、竞技场、掉落、坐骑、士气、委托）
        const dth = Elona.Battle.onDeath(this, target, this.player);
        if (Elona.Quest && dth && dth.quest) {
          for (const pr of dth.quest) {
            this.log(`委托进度：${Elona.Quest.progressText(this, pr.quest)}` +
              (pr.completed ? '（可以报告了）' : ''));
          }
          if (this.questMap && Elona.QuestMap) {
            const kr = Elona.QuestMap.onKill(this);
            if (kr && kr.message) this.log(kr.message);
          }
        }
      }
      this.endTurn();
      return r;
    }

    /** 开始投掷：选择背包下标后进入目标选择模式 */
    beginThrow(idx) {
      if (!Elona.Throw) return { ok: false, reason: 'no-module' };
      const chk = Elona.Throw.canThrow(this.player, idx);
      if (!chk.ok) {
        const msg = {
          'no-item': '没有这件物品。', equipped: '装备中的物品不能投掷。',
          'no-drop': '那是你重要的物品，无法投掷。', 'too-heavy': '太重了，投不出去……！',
          occupied: '这个怪物球里已经装了生物。',
        }[chk.reason] || '无法投掷。';
        this.log(msg);
        return chk;
      }
      this.throwState = { itemIndex: idx };
      return { ok: true, awaitingTarget: true };
    }

    /** 投掷到指定格 */
    throwAt(tx, ty) {
      if (!this.throwState) return { ok: false, reason: 'no-throw' };
      const idx = this.throwState.itemIndex;
      this.throwState = null;
      const r = Elona.Throw.throwItem(this, this.player, idx, tx, ty);
      if (!r.ok) {
        this.log(r.reason === 'blocked' ? '那里投不过去。' : '投掷失败。');
        return r;
      }
      const nm = Elona.ItemDB ? Elona.ItemDB.name(r.itemId, 'en') : `#${r.itemId}`;
      this.log(`你投出了 ${nm}${r.missed ? '（落点偏移）' : ''}。`);
      if (r.captured) {
        const c = r.captured;
        if (c.ok) this.log(`捕获成功！（生物 ${c.creatureId} / Lv ${c.level}）`);
        else {
          const msg = {
            immune: '那个生物无法捕获。', 'ball-level': '怪物球的等级不足。',
            'too-strong': '需要先把它削弱到濒死。', area: '这里无法捕获。',
          }[c.reason] || '捕获失败。';
          this.log(msg);
        }
      }
      if (r.placed) this.log('物品落在了地上。');
      // 0-GR：命中角色的效果文案（かばう / 命中 / 决斗 / 寄生 …）
      for (const m of (r.messages || [])) this.log(m);
      // 0-GR：341854-341858 貯金箱被打碎后散落金币
      if (r.ground && r.ground.gold > 0) this.log(`存钱罐碎了，散落 ${r.ground.gold} 枚金币。`);
      if (r.effect.includes('fire')) this.log('燃起了火焰！');
      if (r.effect.includes('acid')) this.log('溅出了酸液！');
      if (r.effect.includes('smoke')) this.log('烟雾弥漫开来。');
      this.endTurn();
      return r;
    }

    /** 装填/切换弹药（A 键 → label_2852 301414-301501） */
    cycleAmmo() {
      const p = this.player;
      let slot = -1;
      for (let n = 0; n < 30; n++) {
        if (Math.floor(p.get(100 + n) / 10000) === 11) { slot = n; break; }
      }
      if (slot < 0) { this.log('你没有装备弹药。'); return { ok: false, reason: 'no-ammo' }; }
      const idx = (p.get(100 + slot) % 10000) - 1;
      const ammo = p.inv && p.inv[idx];
      if (!ammo) { this.log('弹药槽是空的。'); return { ok: false, reason: 'empty' }; }
      // 特殊弹选择（var_99(9)）；普通弹药只有「通常弹」一种
      const cur = (ammo.f[9] === undefined ? -1 : (ammo.f[9] | 0));
      const types = [];
      for (let n = 0; n < 15; n++) {
        const v = ammo.f[40 + n * 2];
        if (!v) break;
        if (Math.floor(v / 10000) === 9) types.push(n);
      }
      if (!types.length) { this.log(`${Elona.ItemDB.name(ammo.id, 'en')}：通常弹（无限）。`); return { ok: true, type: -1 }; }
      const next = types.indexOf(cur) + 1;
      const sel = next >= types.length ? -1 : types[next];
      ammo.f[9] = sel;
      this.log(sel === -1 ? '当前弹药：通常弹（无限）。' : `当前弹药：特殊弹 #${sel + 1}。`);
      return { ok: true, type: sel };
    }

    // ---------- 表现效果（mef type 7 事件） ----------

    /** 事件 21：粒子飞散（*label_4376 209864-209928 的近似表现） */
    addParticles(x, y) {
      this.effects.push({ kind: 'particles', x, y, t: (typeof performance !== 'undefined' ? performance.now() : Date.now()) });
    }

    updateEffects(now) {
      if (!this.effects.length) return;
      const t = now || (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.effects = this.effects.filter((e) => t - e.t < 900);
    }

    // ---------- 地面物品 ----------
    /** 取 (x,y) 上的第一件地面物品 */
    groundItemAt(x, y) {
      for (const it of this.groundItems) {
        if (it && it.f[0] > 0 && it.f[5] === x && it.f[6] === y) return it;
      }
      return null;
    }

    /** 更新格子的“有物品”标记（var_704(x,y,4)；本实现用 1/0 近似原版的图块打包值） */
    refreshGroundCell(x, y) {
      const cell = this.map && this.map.cell(x, y);
      if (!cell) return;
      cell[4] = this.groundItemAt(x, y) ? 1 : 0;
    }

    /**
     * 把背包第 idx 件物品放到地面 —— 0-GW 按 *label_2979（342404-342451）补齐：
     *   - opt.silent（var_2264 == 1，偷窃/收纳路径，311723）：先尝试与脚下同类堆
     *     合并（342410-342412 的 item_stack，516「水」不合并）；没合并成则
     *     写入状态 3（var_99(21)=3）、序号 var_99(9) = var_65(27)+5 并 var_65(27)++、
     *     序号 > 50 时 var_99(26)=10（342426-342433）。
     *   - 非静默：原版不做地面合并、总是新堆（342413-342425）；地面槽满时
     *     「もう周りに物を置くスペースがない！」（本项目 groundItems 无槽上限，
     *     见 docs/02 A517 的近似口径）。
     *   - 营火 255 落地 → var_126(20)=1 的等价标志（342482）。
     * 342452-342470：放在**自己信仰的神**的祭坛上的水 → 祝福的水。
     */
    dropItem(c, idx, x, y, opt) {
      opt = opt || {};
      const it = c.inv && c.inv[idx];
      if (!it || (it.f[0] | 0) <= 0 || it.eqSlot >= 0) return false;
      it.f[5] = x;
      it.f[6] = y;
      if (opt.silent) {
        // 342410-342412：item_stack(-1, …) —— 与同格同类同品质堆合并（水 516 除外）
        if ((it.f[3] | 0) !== 516) {
          const tgt = (this.groundItems || []).find((o) => o && (o.f[0] | 0) > 0
            && (o.f[3] | 0) === (it.f[3] | 0) && (o.f[4] | 0) === (it.f[4] | 0)
            && (o.f[5] | 0) === (x | 0) && (o.f[6] | 0) === (y | 0));
          if (tgt) {
            tgt.f[0] = (tgt.f[0] | 0) + (it.f[0] | 0);
            c.inv[idx] = null;
            this.refreshGroundCell(x, y);
            return true;
          }
        }
        it.f[21] = 3;                                   // 342427
        const serial = (this.getV65 ? (this.getV65(27) | 0) : 0) + 5;   // 342428
        it.f[9] = serial;
        if (this.setV65) this.setV65(27, (this.getV65(27) | 0) + 1);    // 342429
        if (serial > 50) it.f[26] = 10;                 // 342430-342432
      }
      it.f[21] = (it.f[21] === 3) ? 3 : -1;             // 所有者 = 地面（保留偷窃状态）
      c.inv[idx] = null;
      this.groundItems.push(it);
      this.refreshGroundCell(x, y);
      if ((it.f[3] | 0) === 255) this.campfireFlag = true;   // 342482 / var_126(20)=1
      // 342452-342470：放在**自己信仰的神**的祭坛上的水 → 祝福的水
      if (Elona.Faith && Elona.Faith.blessWater(this, c, it)) {
        this.log('水受到了祝福。');
      }
      return true;
    }

    /**
     * 0-CI/0-CP：偷窃脚下的**有主物品**（城镇预设物品）—— 对应原版 311077-311690。
     *
     * 流程（*label_2932 var_65(91)==105 的 rowact 10）：
     *   startSteal：var_58(140)=10、var_58(141)=2+limit(重量/500,0,50)、
     *     var_58(142)=物品、var_58(152)=主人，「◯◯に目星をつけた。」
     *   tickSteal（每回合，311402-311613）：
     *     - 陷阱物品 688/689 rnd(15)==0 → 9999 伤害并中断
     *     - make_sound(x, y, 5, 8)：可能吵醒附近睡眠 NPC（194162）
     *     - 目击判定（311478-311520）：`p = rnd(能力+1)*(80+(看不见PC)*50+欧氏距离*20)/100`，
     *       冒险者（槽<57）p×2/3；`rnd(感覚+1) > p` 被发现 → 台词 + modimp -5，
     *       一轮后「盗みを見咎められた！」karma -5、主人 -2/modimp -20、gohostile → 中断
     *     - 主人死亡 / owner 角色类型 20 / 不可偷 ibit(5) / 重量>=力量*500 / 使用中 → 中断
     *       （主人距离 >=3 不中断，311555-311567）
     *   finishSteal（311614-311690）：背包满则等待；金钱(54)全数转入 gold；
     *     其余整件拷贝入包（ibit 9 赃物、f[21]=0）；经验 300 = limit(重量/25,0,450)+50；
     *     var_65(250+45)++；karma>=-30 时 rnd(3)==0 → 良心呵责 karma -1
     * 偷窃能力（每回合重算，311435-311447）：`窃盗(300)*5 + 器用(12) + 25`；
     *   夜间（>=19 或 <7）×15/10；品质修正 f[4]==3 ×8/10、==4 ×5/10、>4 /25。
     *
     * stealAt() 为同步复合（startSteal + 推进到结束），供测试与一次性调用。
     */
    stealTargets(c) {
      const out = [];
      for (const it of this.groundItems) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        if (it.f[5] !== c.x || it.f[6] !== c.y) continue;
        if (!it.townOwned) continue;
        out.push(it);
      }
      return out;
    }

    /** 偷窃能力 var_399（311435-311447） */
    stealPower(c, item) {
      const stealSkill = Elona.Stats && Elona.Stats.sorg ? (Elona.Stats.sorg(c, 300) | 0) : 0;
      const dex = Elona.Stats && Elona.Stats.sorg ? (Elona.Stats.sorg(c, 12) | 0) : 0;
      let power = stealSkill * 5 + dex + 25;
      const hour = this.getV65(13) | 0;
      if (hour >= 19 || hour < 7) power = idiv(power * 15, 10);
      const fixlv = (item && item.f[4]) | 0;
      if (fixlv === 3) power = idiv(power * 8, 10);
      else if (fixlv === 4) power = idiv(power * 5, 10);
      else if (fixlv > 4) power = idiv(power, 25);
      return power;
    }

    /** 一轮目击判定（311478-311520）→ {discovered, by, shout} */
    stealWitness(c, item) {
      const R = (n) => (this.rng ? this.rng.rnd(Math.max(1, n | 0)) : 0);
      const out = { discovered: false, by: null, shout: '' };
      const power = this.stealPower(c, item);
      const ownerIdx = (this._steal && this._steal.owner) | 0;
      const owner = (ownerIdx > 0 && ownerIdx < 245) ? this.charas[ownerIdx] : null;
      // 311430-311433：主人敌对时只判主人
      const ownerHostile = owner && (owner.get(69) | 0) === -3;
      for (let i = 16; i < 245; i++) {
        const n = this.charas[i];
        if (!n || (n.get(0) | 0) !== 1) continue;
        if ((n.get(251) | 0) !== 0) continue;               // 睡眠中无察觉
        if ((n.get(256) | 0) >= 60) continue;
        if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(n, 992)) continue;
        const dx = n.x - c.x, dy = n.y - c.y;
        const d = Math.trunc(Math.sqrt(dx * dx + dy * dy));
        if (d > 5) continue;
        if (ownerHostile && i !== ownerIdx) continue;
        if (i !== ownerIdx) {
          // 311466-311473：有 1098（监控?）物品的格子旁的角色不参与（简化跳过）
        }
        const canSee = !(Elona.Spell && Elona.Spell.fovLos) || Elona.Spell.fovLos(this, n.x, n.y, c.x, c.y);
        let pr = idiv(R(power + 1) * (80 + (canSee ? 0 : 50) + d * 20), 100);
        if ((i | 0) < 57) pr = idiv(pr * 2, 3);
        const percep = Elona.Stats && Elona.Stats.sorg ? (Elona.Stats.sorg(n, 13) | 0) : 0;
        if (R(percep + 1) > pr) {
          out.discovered = true;
          out.by = n;
          const role = n.get(150) | 0;
          out.shout = (role === 14) ? `「貴様、何をしている！」（${n.name}）` : `「ガード！ガード！」（${n.name}）`;
          if (Elona.NPC && Elona.NPC.modImp) Elona.NPC.modImp(n, -5, this);
          else n.set(17, (n.get(17) | 0) - 5);
          n.set(79, 20 + 100 * 5);
          break;
        }
      }
      return out;
    }

    /** 开始偷窃（rowact 10 建立，311077-311095） */
    startSteal(c, pick) {
      if (!c) return { ok: false, message: '没有对象。' };
      if ((c.get(140) | 0) !== 0) return { ok: false, message: '你正在忙别的事情。' };
      const targets = this.stealTargets(c);
      if (!targets.length) return { ok: false, reason: 'no-target', message: '脚下没有可偷的有主物品。' };
      // 0-DH：源码 319566-319596 是先 `var_486 = 27` 打开物品选择窗口（*label_3026），
      //   选中哪件就偷哪件；这里接受外部指定，未指定时退回第一件。
      const it = (pick && targets.indexOf(pick) >= 0) ? pick : targets[0];
      const ownerIdx = it.f[21] | 0;
      c.set(140, 10);
      c.set(141, 2 + limit(idiv(it.f[7] | 0, 500), 0, 50));
      c.set(142, 0);
      this._steal = { item: it, owner: ownerIdx, stolen: 0, discovered: false, by: null, shout: '' };
      const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : ('item ' + it.id);
      return { ok: true, action: 'steal', item: name,
        message: `${name}に目星をつけた。（你盯上了 ${name}，开始行窃……）` };
    }

    /**
     * 每回合推进（rowact 10，由 Actions.tickRowAct 调用）。
     * @returns {{done?:boolean, interrupted?:boolean, stolen?:number, discovered?:boolean, message:string}}
     */
    tickSteal() {
      const c = this.player;
      const st = this._steal;
      if (!c || !st || !st.item) {
        if (c) { c.set(140, 0); c.set(141, 0); }
        return null;
      }
      const it = st.item;
      const R = (n) => (this.rng ? this.rng.rnd(Math.max(1, n | 0)) : 0);
      const abort = (msg, extra) => {
        c.set(140, 0); c.set(141, 0);
        this._steal = null;
        return Object.assign({ interrupted: true, message: msg }, extra || {});
      };
      // 311402-311421：陷阱物品（铁处女 688 / 断头台 689）
      if ((it.id | 0) === 688 && R(15) === 0) {
        if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(c, 9999);
        else c.hp = 0;
        return abort('突然ふたが閉まった！（铁处女猛然合上！）');
      }
      if ((it.id | 0) === 689 && R(15) === 0) {
        if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(c, 9999);
        else c.hp = 0;
        return abort('突然ギロチンが落ちてきた！（断头台落下！）');
      }
      // 311452：make_sound(x, y, 5, 8) —— 可能吵醒附近睡眠 NPC
      if (Elona.Status && Elona.Status.makeSound) {
        for (const m of Elona.Status.makeSound(this, c.x, c.y, 5, 8, 0, 0)) this.log(m);
      }
      // 311478-311544：目击判定 + 被发现后果
      const wit = this.stealWitness(c, it);
      if (wit.discovered) {
        st.discovered = true; st.by = wit.by; st.shout = wit.shout;
        this.log(wit.shout);
        this.log('盗みを見咎められた！（你偷东西被发现了！）');
        c.set(49, (c.get(49) | 0) - 5);
        const ownerIdx = st.owner | 0;
        const owner = (ownerIdx > 0 && ownerIdx < 245) ? this.charas[ownerIdx] : null;
        if (owner && (owner.get(0) | 0) === 1 && (it.id | 0) !== 202 && (owner.get(251) | 0) === 0) {
          owner.set(9, -2);
          if (Elona.NPC && Elona.NPC.modImp) Elona.NPC.modImp(owner, -20, this);
          else owner.set(17, (owner.get(17) | 0) - 20);
        }
        for (let i = 16; i < 245; i++) {              // gohostile
          const n = this.charas[i];
          if (!n || (n.get(0) | 0) !== 1) continue;
          if (Elona.Party && Elona.Party.isAlly && Elona.Party.isAlly(n)) continue;
          const dx = n.x - c.x, dy = n.y - c.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) > 8) continue;
          n.set(9, -3);
        }
        return abort('行動を中断した。（你中止了行窃。）',
          { discovered: true, by: wit.by, shout: wit.shout });
      }
      // 311545-311613：目标/物品有效性检查
      // （0-CI 约定：城镇预设物品 f[21]=1 是「有主」标记而非角色槽；
      //   主人有效性只对真实 NPC 槽（>=57）判定，311617 同源码语义）
      const ownerIdx = st.owner | 0;
      const owner = (ownerIdx >= 57 && ownerIdx < 245) ? this.charas[ownerIdx] : null;
      if (owner && (owner.get(0) | 0) !== 1) return abort('対象は死んでいる。（目标已经死了。）行動を中断した。');
      if (owner && (owner.get(150) | 0) === 20) return abort('それは盗めない。（那东西偷不了。）行動を中断した。');
      if ((it.f[0] | 0) <= 0) return abort('行動を中断した。（你中止了行窃。）');
      if (Elona.ItemDB && Elona.ItemDB.ibit && Elona.ItemDB.ibit(5, it)) {
        return abort('それは盗めない。（那东西偷不了。）行動を中断した。');
      }
      // 311580：重量 >= 当前力量(var_82(10))*500 → 太重
      if ((it.f[7] | 0) >= (c.skill(10) | 0) * 500) {
        return abort('重すぎて手に負えない。（太重了拿不动。）行動を中断した。');
      }
      const left = (c.get(141) | 0) - 1;
      c.set(141, left);
      if (left > 0) return { keep: true, left, message: '' };
      return this.finishSteal(c);
    }

    /** 结算（311614-311690） */
    finishSteal(c) {
      const st = this._steal;
      const it = st && st.item;
      if (!it) { c.set(140, 0); c.set(141, 0); return { done: true, stolen: 0, message: '' }; }
      const R = (n) => (this.rng ? this.rng.rnd(Math.max(1, n | 0)) : 0);
      const ownerIdx = st.owner | 0;
      const owner = (ownerIdx >= 57 && ownerIdx < 245) ? this.charas[ownerIdx] : null;
      if (owner && (owner.get(0) | 0) !== 1) {
        c.set(140, 0); c.set(141, 0); this._steal = null;
        return { interrupted: true, message: '行動を中断した。（目标已经不在了。）' };
      }
      // 背包满 → 提示但不结束（原版 return 不 rowactend，下回合重试）
      let slot = -1;
      for (let k = 0; k < c.inv.length; k++) {
        if (!c.inv[k] || (c.inv[k].f[0] | 0) <= 0) { slot = k; break; }
      }
      if (slot === -1 && c.inv.length >= 40) {
        return { keep: true, message: 'バックパックには、もうアイテムを入れる余裕がない。（背包满了。）' };
      }
      // 311626-311660：金钱(54) 转 gold；其余整件入包（ibit 9 赃物、f[21]=0）
      const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : ('item ' + it.id);
      if ((it.id | 0) === 54) {
        c.set(30, (c.get(30) | 0) + (it.f[0] | 0));
        it.f[0] = 0;
        this.groundItems = this.groundItems.filter((x) => x !== it);
      } else {
        it.f[21] = 0;
        it.townOwned = false;
        if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(9, it, 1);
        if (slot === -1) { c.inv.push(it); slot = c.inv.length - 1; } else { c.inv[slot] = it; }
        if (Elona.ItemDB && Elona.ItemDB.stack) Elona.ItemDB.stack(c, slot);
        this.groundItems = this.groundItems.filter((x) => x !== it);
      }
      this.refreshGroundCell(c.x, c.y);
      // 经验 300（311677）
      if (Elona.Stats && Elona.Stats.skillExp) {
        Elona.Stats.skillExp(c, 300, c.index | 0, limit(idiv(it.f[7] | 0, 25), 0, 450) + 50, 0, 0, this);
      }
      this.setV65(345, (this.getV65(345) | 0) + 1);   // var_65(250+45) 偷窃计数
      // 良心呵责（311681-311689）
      let conscience = false;
      if ((c.get(49) | 0) >= -30 && R(3) === 0) {
        conscience = true;
        c.set(49, (c.get(49) | 0) - 1);
      }
      c.set(140, 0); c.set(141, 0);
      this._steal = null;
      return {
        done: true, stolen: 1, name,
        discovered: st.discovered, by: st.by, shout: st.shout, conscience,
        message: `${name}を盗んだ。（你偷到了 ${name}。）`,
      };
    }

    /**
     * 同步复合偷窃（startSteal + 推进至结束），供测试与一次性调用。
     * @returns {{stolen:number, discovered:boolean, by:object|null, names:string[]}}
     */
    stealAt(c) {
      const out = { stolen: 0, discovered: false, by: null, names: [] };
      const st0 = this.startSteal(c);
      if (!st0.ok) { out.reason = st0.reason || 'start-fail'; out.message = st0.message; return out; }
      for (let guard = 0; guard < 100; guard++) {
        const r = this.tickSteal();
        if (!r) break;
        if (r.message) out.message = r.message;
        if (r.discovered) { out.discovered = true; out.by = r.by; out.shout = r.shout; }
        if (r.stolen) {
          out.stolen += r.stolen;
          if (r.name) out.names.push(r.name);
        }
        if (r.done || r.interrupted) break;
      }
      return out;
    }


    /**
     * 0-CQ：死亡惩罚（var_1302==6，609826-609905）—— 玩家死亡时结算。
     *   刻死纹（cbit 1036）：
     *     已有 → 「刻まれた死紋の色が変わっていく…！」；karma<-30 → modkarma +10；
     *       八维 10..17 各 skillexp -1000（经验下降，可能降级）
     *     没有 → 「死紋が刻まれていなかった…」+ 获得刻死纹（cbitmod 1036,1）
     *   首次死亡习得特殊能力 869（var_98(269)=1）
     *   var_65(85)>=20000 → modcorrupt -2000（以太病好转；本实现为直接减 var_65(85)）
     *   丢失 refitem(id,10)==1 的物品（除 333）「◯◯を失った。」
     *   decfame(0,10)（32223-32231）：损失 = 声望/10+5 ± 抖动，声望下限 0
     */
    deathPenalty() {
      const p = this.player;
      const msgs = [];
      const R = (n) => (this.rng ? this.rng.rnd(Math.max(1, n | 0)) : 0);
      const C = Elona.Status && Elona.Status.cbit;
      const CM = Elona.Status && Elona.Status.cbitmod;
      if (C && C(p, 1036)) {
        msgs.push('刻まれた死紋の色が変わっていく…！（刻死纹的颜色开始变化……）');
        if ((p.get(49) | 0) < -30) p.set(49, (p.get(49) | 0) + 10);
        if (Elona.Stats && Elona.Stats.skillExp) {
          for (let id = 10; id <= 17; id++) {          // 八维 skillexp -1000
            if ((p.skill(id) | 0) === 0) continue;
            Elona.Stats.skillExp(p, id, p.index | 0, -1000, 0, 0, this);
          }
        }
      } else {
        msgs.push('死紋が刻まれていなかったので能力値の減少はないが…。（没有刻死纹，能力值不会下降……）');
        if (CM) CM(p, 1036, 1);
        msgs.push('あなたの身体に死紋が刻まれた！（你的身体被刻上了死纹！）');
      }
      msgs.push('【刻死紋状態で死亡すると能力値が永続低下する。睡眠を取るまで消えない。】');
      // 特殊能力 869（var_98(269)=1）
      if (Elona.Feat && Elona.Feat.flag && Elona.Feat.setFlag && Elona.Feat.flag(p, 269) === 0) {
        Elona.Feat.setFlag(p, 269, 1);
        msgs.push('あなたは新しい能力を得た。（你习得了新的能力。）');
      }
      // modcorrupt -2000（609877）
      if ((this.getV65(85) | 0) >= 20000) {
        this.setV65(85, Math.max(0, (this.getV65(85) | 0) - 2000));
      }
      // 丢失「掉落 flag」物品（refitem(id,10)==1，除 333，609880-609896）
      for (const it of (p.inv || [])) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        if ((it.id | 0) === 333) continue;
        if (Elona.ItemDB && Elona.ItemDB.ref && Elona.ItemDB.ref(it.id, 10) === 1) {
          const nm = Elona.ItemDB.name(it, 'en');
          msgs.push(`${nm}を失った。（你失去了 ${nm}。）`);
          it.f[0] = 0;
        }
      }
      // decfame(0, 10)（32223-32231）
      const fame = p.get(34) | 0;
      let loss = idiv(fame, 10) + 5;
      loss = loss + R(idiv(loss, 2) + 1) - R(idiv(loss, 2) + 1);
      p.set(34, Math.max(0, fame - loss));
      msgs.push(`名声値を${loss}失った。（你失去了 ${loss} 点声望。）`);
      return { messages: msgs, fameLoss: loss };
    }

    /**
     * map_placecharaonentrance（227797-227945）—— 把角色放到地图的「入口」附近。
     *
     * 入口类型 `type`（原版 prm_1085）：
     *   1 / 2  → 用 `var_126(5)` / `var_126(4)` 记录的入口坐标（编码 y*1000+x）
     *   3      → 按地图类型 `var_65(35)` 与地图 id `var_65(20)` 的硬编码表（各地图专属位置）
     *   4      → 地图中心
     *   8      → 下方中央
     *   5      → 随机位置
     *   6      → 出生点 `var_65(5)/(6)` 附近随机
     *   7      → 使用调用方事先给的坐标（this._placeX / this._placeY）
     * `jitter`（prm_1086）> 0 时坐标再叠加 ±rnd(jitter) 的抖动。
     *
     * @param {number} charaIndex 要放置的角色槽
     * @param {number} type 入口类型
     * @param {number} [jitter]
     * @returns {{ok:boolean, x:number, y:number}}
     */
    placeCharaOnEntrance(charaIndex, type, jitter) {
      const c = this.charas[charaIndex | 0];
      if (!c) return { ok: false, x: 0, y: 0 };
      const H = this.map.header || [];
      const W = this.map.width | 0, Hh = this.map.height | 0;
      const R = (n) => (this.rng ? this.rng.rnd(Math.max(1, n | 0)) : 0);
      const jit = jitter | 0;
      let x = 0, y = 0;
      const t = type | 0;
      if (t === 1 || t === 2) {
        const v = H[t === 1 ? 5 : 4] | 0;
        x = v % 1000; y = Math.floor(v / 1000);
        if (jit) { x += R(jit) - R(jit); y += R(jit) - R(jit); }
      } else if (t === 3) {
        // 按地图类型（var_65(35)）取基准，再按地图 id 覆盖（原版 227819-227915）
        const mt = this.getV65(35) | 0;
        const id = this.getV65(20) | 0;
        if (mt === 1) { x = W - 2; y = Math.floor(Hh / 2); }
        else if (mt === 2) { x = 1; y = Math.floor(Hh / 2); }
        else if (mt === 3) { x = Math.floor(W / 2); y = Hh - 2; }
        else { x = Math.floor(W / 2); y = 1; }
        // 各地图的专属坐标（原版硬编码表，只列本项目会用到的那几个）
        const FIX = {
          15: [mt === 2 ? 1 : W - 2, mt === 2 ? 14 : 22],      // palmia
          33: [mt === 2 ? 1 : (mt === 3 ? 28 : 5), mt === 2 ? 3 : (mt === 0 ? 22 : 32)],
          36: [mt === 2 ? 25 : 58, mt === 2 ? 1 : 21],
          92: [mt === 2 ? 1 : 39, mt === 2 ? 44 : 67],
          95: [mt === 2 ? 1 : 78, mt === 2 ? 33 : 54],
          96: [mt === 2 ? 1 : 42, mt === 2 ? 34 : 27],
          25: [1, 14],
        };
        if (FIX[id]) { x = FIX[id][0]; y = FIX[id][1]; }
        // 玩家上一格（var_65(60)/(61)）优先
        if ((this.getV65(60) | 0) !== -1) {
          const px = this.getV65(60) | 0, py = this.getV65(61) | 0;
          if (px !== 0 || py !== 0) { x = px; y = py; }
        }
      } else if (t === 4) {
        x = Math.floor(W / 2); y = Math.floor(Hh / 2);
      } else if (t === 8) {
        x = Math.floor(W / 2); y = Hh - 2;
      } else if (t === 5) {
        x = R(W - 5) + 2; y = R(Hh - 5) + 2;
      } else if (t === 6) {
        x = (this.getV65(5) | 0) + R(1); y = (this.getV65(6) | 0) + R(1);
      } else if (t === 7) {
        x = this._placeX | 0; y = this._placeY | 0;
      } else {
        x = Math.floor(W / 2); y = Math.floor(Hh / 2);
      }
      x = Math.max(0, Math.min(W - 1, x));
      y = Math.max(0, Math.min(Hh - 1, y));
      c.x = x; c.y = y;
      if (this.map.cell) {
        const cell = this.map.cell(x, y);
        if (cell) cell[1] = c.index + 1;
      }
      if (this.syncCharaCells) this.syncCharaCells();
      return { ok: true, x, y };
    }

    /**
     * relocate_chara（194307-194437）—— 把角色 `src` 的整份数据搬到槽位 `dst`。
     *
     * 原版逐字段搬运（var_58 500 项 / var_82 1200 技能 / var_99 70 物品字段 / var_63 10 个名字），
     * 本项目角色是对象（字段都在实例里），因此「搬数据」= 把对象放到 `dst` 槽并改写 index。
     * 仍需复现的附带行为：
     *   ① src 是玩家坐骑 → 结束骑乘并把 src 对齐到玩家
     *   ② src 有「被载者」（var_58(168) != 0）→ 被载者落到 src 当前格并解除
     *   ③ dst == -1 → 找 57..244 空槽；**全满时随机淘汰一个 var_58(150)==0 的角色**腾位置
     *   ④ keepPos == 1 → 保留 dst 原有的坐标/关系/状态（并把 src 放到 dst 原位）
     *   ⑤ 搬运后把能力值在 100..500 之外的部分重置为 100（194418-194430 的耐性规范化）
     *
     * @param {number} src 源槽位
     * @param {number} dst 目标槽位（-1 = 自动找空位）
     * @param {number} [keepPos] 1 = 保留目标位置
     * @returns {{ok:boolean, dst:number, reason?:string}}
     */
    relocateChara(src, dst, keepPos) {
      src = src | 0;
      const c = this.charas[src];
      if (!c) return { ok: false, dst: -1, reason: 'no-chara' };
      // ① 坐骑
      if (this.rideIndex !== undefined && this.rideIndex === src) {
        this.rideIndex = -1;
        c.x = this.player.x; c.y = this.player.y;
      }
      // ② 被载者
      const riderIdx = c.get(168) | 0;
      if (riderIdx !== 0) {
        const rider = this.charas[c.get(167)];
        if (rider) {
          const cell = this.map && this.map.cell ? this.map.cell(c.x, c.y) : null;
          if (cell) cell[1] = rider.index + 1;
          rider.x = c.x; rider.y = c.y;
          if (Elona.AI && Elona.AI.tagEnd) Elona.AI.tagEnd(c);
        }
        c.set(167, 0); c.set(168, 0);
      }
      // ③ 找空槽（dst == -1）
      let target = dst | 0;
      if (target === -1) {
        for (let i = 57; i < 245; i++) {
          const o = this.charas[i];
          if (!o || (o.get(0) | 0) === 0) { target = i; break; }
        }
        if (target === -1) {
          // 全满 → 随机淘汰一个「无角色类型」的角色（原版 chara_vanquish）
          for (let t = 0; t < 200; t++) {
            const i = 57 + (this.rng ? this.rng.rnd(245 - 57) : 0);
            const o = this.charas[i];
            if (o && (o.get(0) | 0) === 1 && (o.get(150) | 0) === 0) {
              o.set(0, 0);                      // vanquish
              target = i;
              break;
            }
          }
          if (target === -1) return { ok: false, dst: -1, reason: 'full' };
        }
      }
      const old = this.charas[target];
      // ④ keepPos：保存目标位原有的位置/关系/状态
      let saved = null;
      if (keepPos === 1) {
        saved = old
          ? { x: old.x, y: old.y, rel: old.get(9) | 0, s201: old.get(201) | 0, s50: old.get(50) | 0 }
          : null;
      }
      // 清源槽 → 放到目标槽
      this.charas[src] = null;
      if (old && old !== c) old.set(0, 0);      // 目标位原有角色废弃
      this.charas[target] = c;
      c.index = target;
      // 关系/状态复位（原版 194412-194416：keepPos 恢复，否则清 29/201）
      if (keepPos === 1 && saved) {
        c.x = saved.x; c.y = saved.y;
        c.set(9, saved.rel);
        c.set(201, saved.s201);
        c.set(50, saved.s50);
      } else {
        c.set(29, 0);
        c.set(201, 0);
      }
      // ⑤ 能力值规范化（194418-194430）：
      //   技能 50..60 的等级若落在 (100, 500) 区间内 → 重置为 100；
      //   区间外保留原值，超过 500 的钳到 500；同时经验与成长率清零（只写等级部分）。
      //   条件：非牧场场景（var_65(193) != 200）且（目标槽 < 16 或 cbit(960) != 1）。
      if ((this.getV65(193) | 0) !== 200) {
        const important = (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, 960) === 1 : false;
        if (target < 16 || !important) {
          if (c.potential) {
            for (let sk = 50; sk < 61; sk++) {
              const lv = (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(c, sk) | 0) : 0;
              let v = 100;
              if (lv >= 500 || lv <= 100) v = lv;
              if (v > 500) v = 500;
              c.potential[sk] = v * 1000000;
            }
          }
        }
      }
      // 地图占用
      if (this.map && this.map.cell) {
        const cell = this.map.cell(c.x, c.y);
        if (cell) cell[1] = c.index + 1;
      }
      if (this.syncCharaCells) this.syncCharaCells();
      return { ok: true, dst: target };
    }

    /** 拾取脚下全部地面物品 */
    pickupAt(c) {
      let picked = 0;
      let pickedCampfire = false;   // 0-GW：本轮拾起过营火 255（342366-342385）
      let pickedWeight = 0;
      let blocked = false;
      const rest = [];
      for (const it of this.groundItems) {
        if (!it || it.f[0] <= 0) continue;
        if (it.f[5] !== c.x || it.f[6] !== c.y) { rest.push(it); continue; }
        // 0-CI：城镇预设物品（有主）不能白拿 → 留给 stealAt 处理
        if (it.townOwned) { rest.push(it); continue; }
        // 297590-297608：var_99(21)==2 是「无法搬动」的标记（行商/船商掉落的 361 提包，
        //   见 loot.js 222902）。源码在这里 `goto *label_4363` 中止拾取并提示
        //   「それは持ち運べない。」。提包只能就地用 o 键打开（容器面板会列出地面容器）。
        if ((it.f[21] | 0) === 2) {
          if (!blocked) { this.log('那是搬不动的。'); blocked = true; }
          rest.push(it);
          continue;
        }
        // 341920-341958：药水栓（1299）**不进背包**，直接加到库存计数器 var_65(689)。
        // 它是「货币式」的消耗品，装填发射器时按 4 个一组扣（353000-353013）。
        if ((it.f[3] | 0) === 1299) {
          const n = it.f[0] | 0;
          it.f[0] = 0;
          if (this.setV65) this.setV65(689, (this.getV65(689) | 0) + n);
          this.log(`[药水栓：${this.getV65 ? (this.getV65(689) | 0) : n} 个]`);
          picked++;
          continue;
        }
        pickedWeight += (it.f[7] | 0) * (it.f[0] | 0);
        let slot = -1;
        for (let k = 0; k < c.inv.length; k++) {
          if (!c.inv[k] || (c.inv[k].f[0] | 0) <= 0) { slot = k; break; }
        }
        if (slot === -1) {
          c.inv.push(it);
          if (Elona.ItemDB) Elona.ItemDB.stack(c, c.inv.length - 1);
        } else {
          c.inv[slot] = it;
          if (Elona.ItemDB) Elona.ItemDB.stack(c, slot);
        }
        it.f[21] = 0;                      // 所有者 = 玩家/角色
        // 0-BY：唯一物品重复 → 化为星尘（convertartifact 222003-222063）
        if (Elona.ItemDB && Elona.ItemDB.convertArtifact) {
          const slotIdx = c.inv.indexOf(it);
          const conv = Elona.ItemDB.convertArtifact(c, slotIdx);
          if (conv) this.log(`${conv.name} 化成了星尘。`);
        }
        // 0-GW / 342338：逐件拾取播报（「(名前)は(物品)を拾った。」；NPC 的 _s 分支
        //   342355-342365 由 AI 拾取承担，本项目 NPC 不拾取，见 docs/02 A517）
        {
          const nm = (Elona.ItemDB && Elona.ItemDB.instanceName)
            ? Elona.ItemDB.instanceName(it) : String(it.f[3] | 0);
          this.log(`你拾取了 ${nm}。`);
          if ((it.f[3] | 0) === 255) pickedCampfire = true;
        }
        picked++;
      }
      this.groundItems = rest;
      this.refreshGroundCell(c.x, c.y);
      // 0-GW / 342366-342385：玩家拾起营火 255 后，若地面（inv -1）再无 255 →
      //   var_126(20)=0 + 重选 BGM（label_0069）。本项目无 BGM 模块，只清标志；
      //   判定放在地面列表重建之后，避免把刚拾走的算进去。
      if (pickedCampfire && this.campfireFlag
        && !this.groundItems.some((o) => o && (o.f[0] | 0) > 0 && (o.f[3] | 0) === 255)) {
        this.campfireFlag = false;
      }
      // 0-GW / 342398：`gosub *label_2225` 重算负重（feat.js 的 applyWeight，
      //   var_58(43/44/45)）；endTurn 里还有一份，这里保持源码顺序
      if (picked > 0 && Elona.Feat && Elona.Feat.applyWeight) {
        try { Elona.Feat.applyWeight(c, this); } catch (e) { /* 缺表时静默 */ }
      }
      // 1006：拾取作物即累计重量
      if (picked > 0 && this.questMap && this.questMap.type === 1006 && Elona.QuestMap) {
        const hr = Elona.QuestMap.onPickup(this, pickedWeight);
        if (hr && hr.message) this.log(hr.message);
      }
      return picked;
    }

    /** 移除一件地面物品（被烧毁/冻碎后） */
    removeGroundItem(it) {
      const x = it.f[5], y = it.f[6];
      const i = this.groundItems.indexOf(it);
      if (i >= 0) this.groundItems.splice(i, 1);
      this.refreshGroundCell(x, y);
    }

    /**
     * 0-GM / 604861-605014：`*label_4358` 的 turn_end:pc 收尾链。
     *
     * 源码把这段挂在「玩家一次行动结束」上；本项目 endTurn() 已经承担了
     * 时间推进（603094-603157）、状态结算（215805-216701）、行动计（603075-603092）、
     * 委托递减、mef、事件队列（603050-603060）、负重刷新（193826）、升级（604850-604858）
     * 与 NPC AI，所以这里只补原先缺席的几处每回合状态推进：
     *   604869-604879  var_58(191,0)==8 → 日志更新提示 + 191 += 1000
     *   604880-604885  var_65(98) 计时器跨 10000 + var_65(91)=100
     *   604886-604892  负重档 >=3 时 1/20 概率的超重压伤
     *   604898-604990  var_65(801) / 663 递减、664 找种族 1014 的跟踪者
     *   604991-605010  var_65(623)>9999 → evadd 18 + 生成 4 个 945
     * 未知字段（var_17 / var_126(6)）与原本就由 NPC AI 处理的动画延迟用保守近似，
     * 详见 docs/02 A492。
     */
    turnEndTail(actor) {
      const pc = actor || this.player;
      if (!pc || typeof pc.get !== 'function') return null;
      const out = { journal: false, timer98: false, crush: 0, timer801: 0, tracker: 0, ambush: false };

      // 604869-604879：日志有更新
      if ((pc.get(191) | 0) === 8 && (pc.get(52) | 0) < 50) {
        pc.set(191, (pc.get(191) | 0) + 1000);
        this.log('日志已更新。');
        out.journal = true;
      }

      // 604880-604885：var_65(98) 的跨阈值计时（gosub *label_2932 由 Quest.tick 覆盖）
      const t98 = this.getV65(98) | 0;
      if (t98 !== 0 && t98 < 10000) {
        this.setV65(98, t98 + 10000);
        this.setV65(91, 100);
        out.timer98 = true;
      }

      // 604886-604892：超重压伤。原版伤害用 var_58(43/44)/var_58(51) 的比值，
      // 本项目用当前 HP 作近似（不臆造原版字段语义）。
      if ((pc.get(45) | 0) >= 3 && this.rng && this.rng.rnd(20) === 0) {
        const hpmax = Math.max(1, pc.get(51) | 0);
        const hp = Math.max(1, pc.hp | 0);
        const dmg = Math.max(1, Math.floor(hpmax * (hp * 10 / hpmax + 10) / 200) + 1);
        if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(pc, dmg, this, null, -6, 0);
        else pc.hp = Math.max(0, (pc.hp | 0) - dmg);
        out.crush = dmg;
      }

      // 604898-604990：限时召唤/追踪计时器
      const t801 = this.getV65(801) | 0;
      if (t801 > 0) {
        const left = t801 - 1;
        this.setV65(801, left);
        out.timer801 = left;
        const alive = (pc.get(0) | 0) === 1;
        if (!alive || left === 0) {
          this.setV65(664, 0);                       // 追踪结束
        } else {
          // 604937-604960：在活跃角色里找种族 1014，写入 var_65(664)
          let found = 0;
          const list = this.charas || [];
          for (let i = 0; i < list.length; i++) {
            const c = list[i];
            if (!c || i === (pc.index | 0) || (c.get && (c.get(0) | 0) !== 1)) continue;
            if (c.get && (c.get(27) | 0) === 1014) { found = i; break; }
          }
          this.setV65(664, found);
          if (found && (this.getV65(663) | 0) === 0) this.setV65(663, left + 1);
          out.tracker = found;
        }
      } else if ((this.getV65(663) | 0) > 0) {
        // 604985-604990：663 是 801 的镜像计时，单独递减
        const left = (this.getV65(663) | 0) - 1;
        this.setV65(663, left > 0 ? left : 0);
        out.timer801 = left;
      }

      // 604991-605010：var_65(623) > 9999 → evadd 18 + 生成 4 个 945 伏兵
      if ((this.getV65(623) | 0) > 9999) {
        if (this.events && typeof this.events.add === 'function') this.events.add(18, 0, 0);
        if (Elona.CharaFactory && typeof Elona.CharaFactory.create === 'function') {
          for (let i = 0; i < 4; i++) {
            const c = Elona.CharaFactory.create(this, 945, 5, pc.x, pc.y);
            if (c && typeof c.set === 'function') { c.set(201, 300); c.set(29, 0); }
          }
        }
        this.setV65(623, -9999);
        out.ambush = true;
      }
      return out;
    }

    /**
     * 0-GM / 605015-605199：`*label_4359` 的 pc_turn_init 开局链。
     *   · 605020-605022 神谕提示（1/1000，本项目无 txtgod，只记录概率位）
     *   · 605023      var_65(808) 每回合清零
     *   · 605024-605030 随从/坐骑坐标同步（var_65(183)、var_58(167)）
     *   · 605031-605037 以太侵蚀 >= 20000 的致死已在 endTurn 的 Weather 分支实现
     *   · 605038-605120 var_65(30) 自动行走校验（本项目无自动行走，按设计跳过）
     *   · 605121-605170 var_1231/2364/2845 三个一次性提示（由 UI 层按需显示）
     *   · 605171-605199 var_253 的动画刷新（Canvas 重写）
     */
    turnStartInit() {
      const pc = this.player;
      const out = { oracle: false, followers: 0 };
      if (!pc) return out;
      if ((this.getV65(185) | 0) && this.rng && this.rng.rnd(1000) === 0) out.oracle = true;
      this.setV65(808, 0);
      // 随从 / 坐骑坐标跟随玩家
      const ids = [this.getV65(183) | 0, pc.get(167) | 0];
      for (const idx of ids) {
        if (!idx || idx === (pc.index | 0)) continue;
        const c = (this.charas || [])[idx];
        if (!c) continue;
        c.x = pc.x; c.y = pc.y;
        out.followers++;
      }
      return out;
    }

    /**
     * 结束一个回合：回合数 +1，先结算玩家异常状态，再推进所有 NPC 行动。
     *
     * 说明：玩家与 NPC 的异常状态都「每回合结算一次」，对应原版主回合循环中
     * 对每个角色调用 label_2224(215805-216701)。NPC 在 AI.runAll 内逐个结算，
     * 玩家在此处结算（endTurn 只在真正消耗回合的动作后才被调用，故不会重复结算）。
     *
     * 【0-GM / 604167-604581 `*label_4356` 的回合前处理】
     *   604167-604340  buff / 以太病 / 天气 / 地面效果 → Weather.tickTurn、mef.tick、
     *                  Status.statusTick、Vomit.tickTurn、Potion.tickTurn（上方各分支）；
     *   604341-604360  var_58(280+cnt*3+2) 的 buff 计时递减与 16 号 buff 致死
     *                  → Status.statusTick 的 buff 到期处理；
     *   604361-604390  地图 74 的守卫刷新 / evadd 91 → QuestMap.tick 与 EventQueue；
     *   604391-604460  醉酒（85）、眩晕（251）、行动阻断（263/256/181/buff 57）
     *                  → AI.runAll 的行动计与 Actions.requestInterrupt；
     *   604461-604520  踩到 1098 的随机异常与 dmgcon → mef.tick / Resist.dmgcon；
     *   604521-604581  醉酒 NPC 搭话与寻衅（var_58(257)）→ npc.talk / Relation.modimp。
     *   「行动被跳过」在原版是 goto *label_4358，本项目由 TurnGauge.tick 的
     *   行动计返回 0 次来等效表达，详见 docs/02 A492。
     */
    endTurn() {
      this.turn++;
      // 609737：难度（var_65(189)）取到达过的最高地图层数，只升不降（遭遇的危险度基准）
      if ((this.getV65(189) | 0) < (this.getV65(22) | 0)) {
        this.setV65(189, this.getV65(22) | 0);
      }
      // 605347-605348：回合开始时清零「同回合连续被击次数」（var_58(444)）
      //   dmghp 198553-198560 用它做防连击减伤：>=50 开始递减，>=200 强制 1 点
      if (this.player && this.player.set) this.player.set(444, 0);
      if (this.state !== STATE.PLAY) return;
      // 0-GM / 605015-605199：pc_turn_init 的每回合状态（808 清零、随从坐标同步等）
      this.turnStartInit();
      // 0-GU / 605349-605415：主循环尾部的常驻检查
      //   濒死习得「命乞い」（605402-605415）与真实时间的「已玩 N 小时」播报（605383-605396）
      if (Elona.MainLoop) Elona.MainLoop.tick(this);
      // 0-GO / 603956-604166：*label_4354 的回合开始（速度修正复位、回合计数、
      //   每 10 回合的技能/SP 成长）与 *label_4355 的 var_65(63) 归航倒计时。
      //   归航成功时原版 goto *label_2459 中断本回合，这里 loadMap 后直接 return，
      //   不再重复调用 endTurn（returnToTown 内部已有一次 endTurn）。
      if (Elona.TurnCycle) {
        Elona.TurnCycle.beginAction(this, 0);
        Elona.TurnCycle.playerPeriodic(this);
        const wr = Elona.TurnCycle.worldReturn(this);
        if (wr && wr.travel && wr.destination) {
          const dest = wr.destination;
          this.pendingMap = dest;
          this.loadMap(dest).then(() => {
            this.log(`归返到了 ${this.map.name}。`);
            if (this.onMapChange) this.onMapChange(this.map);
          }).catch((e) => this.log('归返失败：' + e.message));
          if (this.onTurn) this.onTurn(this.turn);
          return;
        }
      }
      // 时间推进（603094-603157）：每个行动约 7~21 时间单位，60 单位 = 1 分钟
      this.advanceClock();
      // 0-FY：行动计累加（603075-603092）+ *label_4353 的行动次数结算。
      //   返回 { 角色 index: 本回合行动次数 }，玩家恒为 0（按键已执行）。
      const budgets = Elona.TurnGauge ? Elona.TurnGauge.tick(this) : null;
      // 委托期限（*label_4288）：跨日递减剩余天数，归零则失败
      if (Elona.Quest) {
        const qrs = Elona.Quest.tick(this);
        if (qrs) for (const qr of qrs) {
          this.log(`委托失败：${Elona.Quest.TYPE_NAMES[qr.type] || '委托'}（${qr.clientName}）。`);
        }
      }

      // 护送：委托人跟随玩家（城镇/世界地图移动期间）
      if (Elona.Quest && Elona.Quest.tickEscort && !this.questMap) {
        const ef = Elona.Quest.tickEscort(this);
        if (ef) for (const q of ef) this.log(`护送失败：${q.clientName} 下落不明。`);
      }

      // 委托专用地图：护送跟随 / 时限（*label_2415/2416/2422）
      if (this.questMap && Elona.QuestMap) {
        const qr = Elona.QuestMap.tick(this);
        if (qr) {
          for (const msg of (qr.messages || [])) this.log(msg);
          if (qr.failed) this.leaveQuestMap();
          else if (qr.timeUp && qr.completed) this.leaveQuestMap();
        }
      }

      // 玩家异常状态的每回合结算（毒/出血扣血、睡眠回血、各状态强度递减…）
      if (Elona.Status && this.player) {
        Elona.Status.statusTick(this, this.player);
      }
      // 0-CD：队伍/宠物的跟随与临时护卫到期
      if (Elona.Party && this.player && this.player.hp > 0) {
        Elona.Party.tick(this);
      }
      // 进食 / 阅读等 rowact 的每回合推进（var_58(140)=1 时 var_58(141)--）
      if (this.player && this.player.hp > 0) this.advanceEating(this.player);
      // 休息 / 挖掘等 rowact 的每回合推进（var_58(140)=3/4/9，见 core/actions.js）
      if (this.player && this.player.hp > 0 && Elona.Actions && Elona.Actions.tickRowAct) {
        Elona.Actions.tickRowAct(this);
      }
      // 以太病累积（604172-604199）：天气=以太风且室外时按概率累积
      if (this.player && this.player.hp > 0 && Elona.Weather && Elona.Weather.tickTurn) {
        // 0-CR：以太侵蚀 >= 20000 → 每回合 999999 无属性伤害（605036）
        if ((this.getV65(85) | 0) > 20000) {
          if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(this.player, 999999);
          else this.player.hp = 0;
          this.log('以太侵蚀超过了极限，你的身体开始崩溃！（受到 999999 伤害）');
        }
        Elona.Weather.tickTurn(this);
      }
      // 过量进食 → 呕吐（604582-604587）／水分过量 → 失禁（604588-604592）。
      // 原版在**角色循环**里对 var_243 逐人判定，这里同样遍历全地图角色。
      {
        const list = (this.charas && this.charas.length) ? this.charas : [];
        const seen = new Set();
        for (const c of list) {
          if (!c || seen.has(c) || (c.hp | 0) <= 0) continue;
          seen.add(c);
          if (Elona.Vomit && Elona.Vomit.tickTurn) {
            const v = Elona.Vomit.tickTurn(this, c);
            if (v) for (const m of v.messages) this.log(m);
          }
          if (Elona.Potion && Elona.Potion.tickTurn) {
            const w = Elona.Potion.tickTurn(this, c);
            if (w) for (const m of w.messages) this.log(m);
          }
        }
        // 玩家不在 charas 里时补一次
        const p = this.player;
        if (p && (p.hp | 0) > 0 && !seen.has(p)) {
          if (Elona.Vomit && Elona.Vomit.tickTurn) {
            const v = Elona.Vomit.tickTurn(this, p);
            if (v) for (const m of v.messages) this.log(m);
          }
          if (Elona.Potion && Elona.Potion.tickTurn) {
            const w = Elona.Potion.tickTurn(this, p);
            if (w) for (const m of w.messages) this.log(m);
          }
        }
      }
      // 地面魔法效果（mef）每回合结算 —— 主循环 604202-604340（类型 3/5/6/13-22）
      if (this.mef && this.player && this.player.hp > 0) {
        const mr = this.mef.tick(this, this.player);
        if (mr && mr.dmg > 0) this.log(`地面效果造成了 ${mr.dmg} 点伤害。`);
        if (mr && mr.wet) this.log('你被液体浸湿了。');
      }
      // mef type 7 计数（603032-603036）→ 归零时 delmef → evadd 21
      if (this.mef && this.mef.tickType7) this.mef.tickType7(this);
      // 0-DB：建筑内的环境消息（*label_2476 的 252220-252300 段）
      //   博物馆的访客窃窃私语 / 访客评价，店的顾客嘈杂声
      if (Elona.Property && Elona.Property.ambientMessage) {
        const amb = Elona.Property.ambientMessage(this);
        if (amb) this.log(amb);
      }
      // 事件队列：每回合处理队尾一条（603050-603060）
      if (this.events) this.events.process(this);
      if (this.player && this.player.hp <= 0) {
        this.state = STATE.DEAD;
        // 0-FI：Loss 模式（201186）玩家死亡 → var_65(196)=4，存档作废
        if (Elona.GameMode) {
          const gm = Elona.GameMode.onPlayerDeath(this);
          if (gm && gm.deleteSave) this.log('【失落模式】存档已作废，本次冒险到此结束。');
        }
        // 0-CQ：死亡惩罚（var_1302==6，609826-609905）
        if (this.deathPenalty) {
          for (const m of this.deathPenalty().messages) this.log(m);
        }
        // 0-CC：竞技场中倒下 → 记败场
        if (Elona.Arena && Elona.Arena.onPlayerDown) {
          const ar = Elona.Arena.onPlayerDown(this);
          if (ar && ar.message) this.log(ar.message);
        }
        this.log('你被异常状态击倒了……');
        if (this.onTurn) this.onTurn(this.turn);
        return;
      }
      // 负重档位（var_58(45)）→ 速度惩罚（var_58(39)）→ refreshspeed（*label_2225）
      if (Elona.Feat && this.player) Elona.Feat.applyWeight(this.player, this);
      // 604850-604858：玩家经验足够则升级（*label_2145）
      if (Elona.Stats && this.player) {
        const lv = Elona.Stats.checkLevelUp(this.player, this);
        if (lv.levels) this.log(`你升级了！当前等级 ${this.player.level}。`);
      }

      // 野外遭遇（343587-343805）：野外地图每回合按地块/天气/载重掷骰，
      //   命中后在身边生成怪物（类型 1/2/3/4/5/8，见 core/encounter.js）
      if (this.player && this.player.hp > 0 && Elona.Encounter) {
        const enc = Elona.Encounter.tick(this);
        if (enc && enc.spawned && enc.spawned.length && this.onEncounter) this.onEncounter(enc);
      }
      // NPC 回合 —— 对应原版 ai_check（更正后的完整行为见 core/ai.js 顶部说明）
      if (Elona.AI) {
        Elona.AI.runAll(this, budgets);
        if (this.player.hp <= 0) {
          this.state = STATE.DEAD;
          // 0-CQ：死亡惩罚（var_1302==6，609826-609905）
          if (this.deathPenalty) {
            for (const m of this.deathPenalty().messages) this.log(m);
          }
          if (Elona.Arena && Elona.Arena.onPlayerDown) {
            const ar = Elona.Arena.onPlayerDown(this);
            if (ar && ar.message) this.log(ar.message);
          }
          this.log('你倒下了……');
        }
      }
      // 野外遭遇战：敌人全灭 → 回到世界地图
      if (this.encounterTrip && this.encounterTrip.type && this.encounterEnemiesLeft() === 0) {
        this.log('敌人已经全部倒下。');
        this.leaveEncounter();
      }
      // 0-GM / 604861-605014：turn_end:pc 的收尾状态（日志更新 / 801 计时 / 伏兵事件）
      this.turnEndTail();
      if (this.onTurn) this.onTurn(this.turn);
    }

    // ---------- NPC / 战斗 ----------
    /**
     * 生成一个 NPC —— 使用与玩家相同的「种族数据 → 潜力 → 属性」链路
     * 但**未**包含原版 NPC 生成（*label_2237）的等级缩放、装备生成、掉落等逻辑，
     * 属于最小可用实现，仅用于验证战斗公式。
     */
    async spawnMonster(raceKey, x, y, level) {
      const rc = this.charaData || (this.charaData = await Elona.Data.table('race_class'));
      const race = rc.races[raceKey] || {};
      const S = Elona.Stats;
      const idx = this.charas.length;
      const c = new Elona.Chara(idx);
      // 显示中文名（Elona.RaceName 本地化表；raw 键名仍保存在 c.raceName）
      c.name = (Elona.RaceName ? Elona.RaceName.zh(raceKey) : (race.jpName || raceKey));
      c.raceName = raceKey;
      c.set(A.ACTIVE, 1);
      c.level = level || 1;
      const ctx = { level: c.level, creatureId: 0, year: this.year, rng: this.rng };
      let pot = {};
      let body = (race.init || {}).body1 || '';
      // 与 CharaFactory 同一条种族 ops 路径（否则这个调试用生成器会漏掉种族耐性/肢体）
      if (Elona.CharaFactory && Elona.CharaFactory.applyRaceClass) {
        await Elona.CharaFactory.loadTables();
        const info = Elona.CharaFactory.applyRaceClass(this, c, raceKey, null);
        pot = info.pot || {};
        if (info.body) body = info.body;
      } else {
        for (const k in (race.skills || {})) S.skillInit(pot, parseInt(k, 10), race.skills[k], ctx);
      }
      c.potential = pot;
      S.syncSkillValues(c, pot);
      if (body) Elona.ItemDB.initSlots(c, body);
      const st = S.calcMaxStats(c, { creatureId: 0 });
      c.hpMax = st.hpMax; c.mpMax = st.mpMax; c.spMax = st.spMax;
      c.hp = st.hpMax; c.mp = st.mpMax; c.sp = st.spMax;
      c.x = x; c.y = y;
      // 属性中与防御相关的字段（来源见 elf 数据 var_58 初始化，NPC 暂用种族默认值）
      c.set(70, 0); c.set(71, 0); c.set(76, 100); c.set(77, 100);
      // 敌对标志 —— var_58(9) = -3（gohostile 行 31654-31662 确认）
      c.set(9, -3);
      c.set(201, 80);
      this.charas[idx] = c;
      this.syncCharaCells();
      return c;
    }

    /**
     * type 7 召唤的宿主钩子（spell.js effectType7 调用）—— 用 CharaFactory 建怪（同步）。
     * 见 core/monster.js：选怪 = label_3105 加权轮盘；建怪 = label_4269 的生物定义。
     */
    doSummon(caster, level) {
      if (!this.map || !Elona.CharaFactory) return null;
      const lv = Math.max(1, level | 0);
      const sid = Elona.CharaFactory.pick(this, lv, {});
      for (let k = 0; k < 8; k++) {
        const x = caster.x + this.rng.rnd(3) - 1;
        const y = caster.y + this.rng.rnd(3) - 1;
        if (!this.map.walkable(x, y)) continue;
        const m = Elona.CharaFactory.create(this, sid, lv, x, y);
        if (caster.get(9) >= 0) m.set(9, caster.get(9));
        return m;
      }
      return null;
    }

    /**
     * 攻击目标角色 —— 对应 *label_3006 多段武器攻击驱动（Battle.attackSeq）。
     * 装备槽为空时自动退化为格闘（var_1322 == 106），与源一致。
     */
    attackTarget(target) {
      const p = this.player;
      const r = Elona.Battle.attackSeq(this, p, target);
      const attacks = r.attacks || [];
      if (r.magic) {
        this.log(`特殊攻击（法术 ${r.spell}）→ ${target.name}`);
        this.endTurn();
        return r;
      }
      for (const a of attacks) {
        if (!a || !a.hit) {
          this.log(`攻击 ${target.name} —— 未命中（命中${a ? a.hitPower : 0} vs 回避${a ? a.evaPower : 0}）`);
          continue;
        }
        const crit = a.critical ? '（会心一击！）' : '';
        this.log(`攻击 ${target.name}${crit} —— ${a.dmg} 点伤害（护甲${a.armor}），剩余 HP ${target.hp}`);
      }
      if (target.hp <= 0) {
        this.log(`${target.name} 被击倒了。`);
        // 0-GH：近战 / 远程 / 法术 / 能力统一走 Battle.onDeath
        //   （经验、招募、盗窃、暗棺、竞技场、掉落、坐骑、士气、委托）
        const dth = Elona.Battle.onDeath(this, target, this.player);
        if (Elona.Quest && dth && dth.quest) {
          for (const pr of dth.quest) {
            this.log(`委托进度：${Elona.Quest.progressText(this, pr.quest)}` +
              (pr.completed ? '（可以报告了）' : ''));
          }
          if (this.questMap && Elona.QuestMap) {
            const kr = Elona.QuestMap.onKill(this);
            if (kr && kr.message) this.log(kr.message);
          }
        }
      }
      this.endTurn();
      return r;
    }

    // ---------- 存读档 ----------
    serialize() {
      return {
        version: 1,
        turn: this.turn,
        map: this.map ? this.map.name : null,
        // 随机迷宫没有对应的 data/maps/*.json，直接内嵌当前地图
        mapJson: this.map ? {
          name: this.map.name, width: this.map.width, height: this.map.height,
          tileset: this.map.tileset, header: this.map.header,
          cells: this.map.cells, objects: this.map.objects,
        } : null,
        dungeonDepth: this.dungeonDepth,
        player: this.player ? this.player.toJSON() : null,
        rng: this.rng.serialize(),
        mef: this.mef ? this.mef.toJSON() : null,
        v65: this.v65,
        // 0-EA：地产表 var_132（300..449 的建筑类型）与 site 表（含 site.stock）
        v132: this.v132,
        propertySites: this.propertySites,
        // 0-FF：renew_major 的间隔计时（农田野兽灾害 / 堆肥箱按 120 小时刷新）
        farmRenew: this.farmRenew || {},
        // 0-FA：随机地城站点（槽位 450..499）与当前地城上下文
        randDungeon: Elona.RandDungeon ? Elona.RandDungeon.snapshot(this) : null,
        dungeonSiteId: this.dungeonSiteId,
        dungeonMinDepth: this.dungeonMinDepth,
        dungeonMaxDepth: this.dungeonMaxDepth,
        dungeonCleared: this.dungeonCleared,
        dungeonAwake: this.dungeonAwake,
        // 0-FC：野外地图的返回点（worldMap 不入档，但 wildTrip 要）
        wildTrip: this.wildTrip ? {
          wx: this.wildTrip.wx | 0, wy: this.wildTrip.wy | 0,
          worldId: this.wildTrip.worldId | 0, town: this.wildTrip.town || null,
        } : null,
        // 0-FB：kind / 随机地城标记 / 觉醒核心种子 / 小徽章骰
        dungeonKind: this.dungeonKind,
        isRandomDungeon: this.isRandomDungeon,
        dungeonMedalSeed: this.dungeonMedalSeed,
        dungeonCoreSeed: this.dungeonCoreSeed,
        materials: this.materials,      // var_497 材料库存（core/material.js）
        // 0-FS：自宅的楼层状态（每层的地面物品 / 人物，源码 inv_<地图id>_<100+层>.s2）
        homeFloor: this.homeFloor | 0,
        homeFloors: this.homeFloors || {},
        homeNpcs: this.homeNpcs || {},
        homeTiles: this.homeTiles || {},
        // 0-FY：var_500 已学配方 / var_498(2,id) 已读过的书
        knownRecipes: this.knownRecipes || {},
        readBooks: this.readBooks || {},
        // 0-GA：var_515 牌组张数 / 已获得的一次性能力
        cardDeck: this.cardDeck || {},
        learnedAbilities: this.learnedAbilities || {},
        groundItems: this.groundItems.map((it) => it.toJSON()),
        events: this.events ? this.events.toJSON() : null,
        facing: this.facing,
        quests: this.quests,
        questSeq: this._questSeq,
        questMap: this.questMap ? {
          questId: this.questMap.questId, type: this.questMap.type,
          turns: this.questMap.turns,
        } : null,
        townPos: this.townPos,
        messages: this.messages.slice(-50),
        savedAt: new Date().toISOString(),
      };
    }

    async deserialize(data) {
      this.tileAttrs = (await Elona.Data.tileAttributes()).tilesets;
      await Elona.ItemDB.load();
      await Elona.ItemDB.loadCand();   // 物品候选轮盘 *label_0598（tools/extract_itemcand.py）
      await Elona.ItemDB.loadEnchant();// 附魔表 var_649/var_653/var_651
      this.dmgconTable = (await Elona.Data.table('dmgcon')).conditions;
      await Elona.Status.loadTable();
      await Elona.BuffEffects.loadTable();
      await Elona.Stats.loadCreatureBits();
      await Elona.Spell.loadTable();
      await Elona.Battle.loadWeaponRange();
      await Elona.ItemUse.loadTable();
      await Elona.Resist.loadTable();   // 0-BS：resist_msgs（resistmod/resistmodh 提示文本）
      if (Elona.Relation && Elona.Relation.loadWords) await Elona.Relation.loadWords();  // 0-BV：关系阶段名表
      await Elona.CharaFactory.loadTables();
      await Elona.EquipGen.loadTable();   // NPC/怪物装备生成表 *label_2234
      await Elona.Feat.loadTable();       // feat 表 *label_0043/0044/2607
      await Elona.Feat.loadAbilities();   // 能力解锁条件 *label_2229
      if (Elona.NPC) await Elona.NPC.loadTable();
      this.townNpcTable = await Elona.Data.table('town_npcs');
      const json = data.mapJson || await Elona.Data.map(data.map);
      this.map = new Elona.GameMap(json, this.tileAttrs);
      this.dungeonDepth = data.dungeonDepth | 0;
      // 地形对象（kind==2）需重建；kind==0 的物品来自存档，避免重复生成
      if (Elona.MapFeat && Elona.MapFeat.applyObjects) {
        Elona.MapFeat.applyObjects(this, json.objects);
      }
      this.player = Elona.Chara.fromJSON(data.player);
      this.charas = [this.player];
      this.turn = data.turn || 0;
      this.messages = data.messages || [];
      this.rng.deserialize(data.rng);
      this.mef = data.mef ? Elona.Mef.fromJSON(data.mef) : new Elona.Mef();
      this.v65 = data.v65 || {};
      // 0-EA：地产表与自建建筑（旧存档没有这两项时按「没有地产」处理）
      this.worldLook = null;                    // 0-FT：瞬态，不进存档
      this.v132 = data.v132 || {};
      this.propertySites = data.propertySites || {};
      this.farmRenew = data.farmRenew || {};
      // 0-FS：自宅的楼层状态（旧存档缺字段时按「还没进过家」处理）
      this.homeFloor = Math.max(1, data.homeFloor | 0 || 1);
      this.homeFloors = data.homeFloors || {};
      this.homeNpcs = data.homeNpcs || {};
      this.homeTiles = data.homeTiles || {};
      // 0-FY：旧存档缺字段时按「还没学过配方 / 没读过书」处理
      this.knownRecipes = data.knownRecipes || {};
      this.readBooks = data.readBooks || {};
      this.cardDeck = data.cardDeck || {};
      this.learnedAbilities = data.learnedAbilities || {};
      // 0-FA：随机地城站点与当前地城上下文（旧存档缺字段时按空表处理）
      if (Elona.RandDungeon) Elona.RandDungeon.restore(this, data.randDungeon);
      if (Elona.Sites && Elona.Sites.bindGame) Elona.Sites.bindGame(this);
      this.dungeonSiteId = data.dungeonSiteId | 0;
      this.dungeonMinDepth = Math.max(1, data.dungeonMinDepth | 0 || 1);
      this.dungeonMaxDepth = data.dungeonMaxDepth | 0;
      this.dungeonCleared = !!data.dungeonCleared;
      this.dungeonAwake = !!data.dungeonAwake;
      // 0-FC：野外地图返回点
      this.wildTrip = data.wildTrip ? {
        wx: data.wildTrip.wx | 0, wy: data.wildTrip.wy | 0,
        worldId: data.wildTrip.worldId | 0, town: data.wildTrip.town || null,
      } : null;
      // 0-FB
      this.dungeonKind = data.dungeonKind | 0;
      this.isRandomDungeon = !!data.isRandomDungeon;
      this.dungeonMedalSeed = data.dungeonMedalSeed | 0;
      this.dungeonCoreSeed = data.dungeonCoreSeed | 0;
      // 材料库存 var_497：旧存档没有该字段时按空库存处理
      this.materials = Array.isArray(data.materials) ? data.materials.slice() : new Array(400).fill(0);
      if (Elona.Material) Elona.Material.ensure(this);
      if (Elona.Weather) Elona.Weather.init(this);   // 旧存档缺 var_65(17)/(18) 时补默认值
      this.groundItems = (data.groundItems || []).map((o) => Elona.Item.fromJSON(o));
      for (const it of this.groundItems) this.refreshGroundCell(it.f[5], it.f[6]);
      this.events = data.events && Elona.EventQueue ? Elona.EventQueue.fromJSON(data.events) : new Elona.EventQueue();
      this.facing = data.facing === undefined ? 2 : (data.facing | 0);
      // 委托表 var_434（旧存档只有 questBoard/activeQuest，做最小迁移）
      this.quests = Array.isArray(data.quests) ? data.quests : [];
      this._questSeq = data.questSeq | 0;
      if (!this.quests.length && data.questBoard && Array.isArray(data.questBoard.quests)) {
        this.quests = data.questBoard.quests
          .filter((q) => q && q.type)
          .map((q) => ({
            id: q.id, clientIndex: q.clientIndex, clientName: q.clientName,
            map: data.questBoard.map, mapId: MAP_IDS_SAVE[data.questBoard.map] || 0,
            created: data.questBoard.generated || 0,
            refreshAt: (data.questBoard.generated || 0) + 24,
            type: q.type === 'kill' ? 1001 : (q.type === 'deliver' ? 1004 : 0),
            subtype: 0, difficulty: q.difficulty || 1,
            rewardGold: q.rewardGold || 0, rewardItem: 0,
            status: 0, daysLeft: 3, targetClientIndex: -1, targetName: '',
            itemId: q.itemId || 0, targetData: 0, targetCreature: 0,
            progress: 0, category: 1, deliverCount: 0, requiredLevel: 0,
            rewardFactor: 100, need: q.need || 1, lastDay: 0, failed: false,
          }));
      }
      if (Elona.Quest && Elona.Quest.syncActive) Elona.Quest.syncActive(this);
      if (!this._questSeq) {
        this._questSeq = this.quests.reduce((m, q) => Math.max(m, q.id | 0), 0);
      }
      // 城镇 NPC 不写入存档，读档后按原版固定表重建（否则委托人/委托都会消失）
      this.questMap = null;
      if (data.questMap && Elona.QuestMap) {
        const qq = this.quests.find((x) => x && x.id === data.questMap.questId && x.status === 1);
        if (qq) await this.enterQuestMap(qq, { fromLoad: true });
      }
      this.townPos = data.townPos || {};
      const savedTown = Elona.Towns && Elona.Towns.byName(this.map.name);
      if (!this.questMap && this.dungeonDepth === 0 && savedTown) {
        this.charas = [this.player];
        this.populateTown(this.map.name);
        if (Elona.Quest && Elona.Quest.restoreEscortFollowers) {
          Elona.Quest.restoreEscortFollowers(this);
        }
        Elona.Quest.ensure(this);
      }
      this.syncCharaCells();
      this.state = STATE.PLAY;
      return true;
    }
  }

  Game.STATE = STATE;
  Game.DIRS = DIRS;
  Elona.Game = Game;
})(window);
