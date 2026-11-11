'use strict';
/**
 * 钓鱼（釣り）系统 —— 使用「釣竿」道具开始，回合制小游戏。
 *
 * 源码依据（hsp/start.hsp）：
 *   28889-29232   *label_0357  钓鱼表 var_692/var_693（113 条，见 tools/extract_fish.py → data/tables/fish.json）
 *   319897-320018 物品使用分支 var_1302 == 185（釣り技能号）：使用钓竿的前置判定与「钓几小时」输入
 *   312707-312777 *label_2938  抽鱼（按钓竿等级选池、加权随机）+ *label_2939 收获结算
 *   312778-312973 *label_2940  钓鱼主循环（rowact 7，每回合一次）
 *   604652-604657 主循环里 rowact == 7 时每回合 `var_58(141)--` 并调 *label_2940
 *
 * 关键状态（逐字对应）：
 *   var_58(140) = 7        行动中（rowact）
 *   var_58(141)            本回合预算，起始 30，每钓上一条重置为 30
 *   var_58(142)            钓竿在背包里的下标
 *   var_58(79)             挥竿动画值（表现层用，本实现忽略）
 *   var_65(824)            本次是否用了「マシンルアー」（890）→ 立即上钩
 *   var_2411               小游戏状态 0 待机 / 1 等待咬钩 / 2 咬钩 / 3 挣扎 / 4 上陆
 *   var_2412               收竿时刻（绝对分钟），由「钓几小时」设定
 *   var_2409               本杆抽中的鱼表下标
 *   var_99(9, 钓竿)        剩余鱼饵数，每钓上一条 -1，为 0 时收竿
 *   var_99(28, 钓竿)       钓竿等级 0..5，决定能钓到哪一档（var_692(1) == 该值）
 *
 * 已确认的判定链：
 *   · 没有釣り技能 → 「釣りの仕方を知らない。」（319899）
 *   · 背包满 → 「バックパックが一杯だ。」（319907）
 *   · 钓竿没饵（var_99(9)==0）→ 「釣竿には餌が付いていない。」（319916）
 *   · 上下或左右 3 格内有水（var_593(0, tile)==3）→ 否则「釣りをする場所が見当たらない。」（319950）
 *   · 自己站在水里 → 「水の中からは釣れない。」（319960）
 *   · 体力 < 50 且 < rnd(75) → 失败并扣体力（319986-319995）；否则扣 体力/2+1
 *   · 抽鱼：tier = limit(钓竿等级 ±1, 0, 5)；地图 91→6、44→+200、70→+300（312719-312727）
 *   · 逃走：鱼的难度 >= rnd(釣り技能+1) → 跑掉（312919）
 *   · 收获：fish 618 的品质系数 = (rnd(10)*rnd(10)+80)/10，垃圾 619 固定 10（312752-312757）
 *           价值 f[1] = 表(6)/10*系数，重量 f[7] = 表(5)/10*系数（312761-312762）
 *           名称走 var_693（表下标写在物品字段 23），见 ItemDB.instanceName
 *
 * 未移植（如实记录）：
 *   · 挥竿/咬钩的帧动画与音效（var_848 / snd 87-89）：本项目用日志文本表达同一事件序列
 *   · var_65(250+23)==1 时的第二条「背包满」判定（var_65(251) 未移植）
 *   · 地图 44/70/91 的专属鱼池：var_65(850)（世界地图 id）在本项目恒为 0，
 *     只在世界地图 site 系统移植后才会生效
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const SKILL_FISH = 185;      // 釣り
  const ROD_CAT = 59000;       // refitem(id,5)：钓竿类别
  const SUPER_LURE = 890;      // マシンルアー
  const FISH_ID = 618;         // 鱼（名称来自钓鱼表）
  const JUNK_ID = 619;         // 垃圾
  const ROWACT_FISH = 7;       // var_58(140)
  const TURNS = 30;            // var_58(141) 起始值
  const INV_MAX = 200;         // inv_getheader(0)：玩家背包 200 格

  /** 小游戏状态（var_2411） */
  const STATE = { IDLE: 0, WAIT: 1, HOOK: 2, FIGHT: 3, LAND: 4 };

  /** 朝向 → 位移（与 core/actions.js 的 FACE 保持一致：0 上 1 右 2 左 3 下） */
  const FACE = [[0, -1], [1, 0], [-1, 0], [0, 1]];

  const TEXT = {
    start: '你开始钓鱼。',                       // 312783「釣りを始めた。」
    noSkill: '你不知道怎么钓鱼。',                // 319903
    full: '背包满了。',                          // 319911
    noBait: '钓竿上没挂饵。',                     // 319920
    noWater: '这里似乎不是钓鱼的地方。',           // 319955
    swimming: '站在水里钓不到鱼。',                // 319964
    tired: '你太累了，失败了！',                   // 319991
    lure: '你还用上了机械假饵。',                  // 312810
    bob: '浮标轻轻动了一下……',                    // 3128xx 咬钩前的小动画
    hook: '有东西咬钩了！',                       // 312886 咬钩
    fight: '鱼在拼命挣扎……',                     // 312905 挣扎
    escape: '鱼脱钩跑掉了。',                     // 312919 判定失败
    land: '你钓上来了！',                         // 312941
    nothing: '什么也没钓到……',                    // 312963
    stopTime: '你收了竿。',                       // 312858「釣りを切り上げた。」
    stopBait: '鱼饵用完了，你收了竿。',
  };

  const Fishing = {
    data: null,
    /** 每根钓竿的小游戏状态：不写进存档（读档后 rowact 7 会安全结束） */
    runs: new WeakMap(),

    async load() {
      if (this.data) return this.data;
      this.data = await Elona.Data.table('fish');
      return this.data;
    },

    /**
     * 钓鱼表。回合内是同步流程（不能 await），所以先尝试取启动预加载的缓存副本。
     * 未预加载时返回空数组 —— 表现是「什么也没钓到」，不会崩。
     */
    entries() {
      if (!this.data && Elona.Data && Elona.Data.tableSync) {
        const t = Elona.Data.tableSync('fish');
        if (t) this.data = t;
      }
      return (this.data && this.data.entries) || [];
    },

    // ------------------------------------------------------------------
    // 基础设施
    // ------------------------------------------------------------------
    /** 绝对时刻（分钟）：原版 312854 的表达式 */
    absTime(g) {
      const V = (n) => g.getV65(n) | 0;
      return V(14) + V(13) * 60 + V(12) * 60 * 24 + V(11) * 60 * 24 * 30
        - 1000000000 + V(10) * 60 * 24 * 30 * 12;
    },

    /** 该图块是否水（var_593(0, tile) == 3，见 tile_attributes.json 字段 0） */
    isWater(g, x, y) {
      const cell = g.map && g.map.cell(x, y);
      if (!cell) return false;
      return (g.map.attr(cell[0], 0) | 0) === 3;
    },

    /**
     * 找水面方向（319926-319949）：先看上下 3 格，再看左右 3 格。
     * 返回 {dx, dy, x, y, dist} 或 null。
     */
    waterTarget(g) {
      const p = g.player;
      for (let i = 0; i < 3; i++) {
        const y = p.y + i - 1;
        if (y !== p.y && this.isWater(g, p.x, y)) return { dx: 0, dy: y - p.y, x: p.x, y, dist: Math.abs(y - p.y) };
      }
      for (let i = 0; i < 3; i++) {
        const x = p.x + i - 1;
        if (x !== p.x && this.isWater(g, x, p.y)) return { dx: x - p.x, dy: 0, x, y: p.y, dist: Math.abs(x - p.x) };
      }
      return null;
    },

    /**
     * 空背包格数（inv_getspace）。
     * 原版玩家的背包是固定 200 格（inv_getheader(0) → 0,200）；
     * 本项目的背包是可变长数组，因此按「已用件数」反推剩余格数，
     * 只有钓到第 200 件时才会出现「バックパックが一杯だ」。
     */
    invSpace(c, g) {
      if (!c || !c.inv) return 0;
      let used = 0;
      for (let i = 0; i < c.inv.length; i++) {
        if (c.inv[i] && (c.inv[i].f[0] | 0) > 0) used++;
      }
      // 226382：Abnormal（var_65(250+23)==1）时玩家的背包按 `inv_sum(0) > 20` 直接判满
      if (g && c === g.player && ((g.getV65(273) | 0) === 1) && used > 20) return 0;
      return Math.max(0, INV_MAX - used);
    },

    /** 把物品放进背包（itemcreate 之后 item_stack） */
    addToInv(c, it) {
      let slot = -1;
      for (let k = 0; k < c.inv.length; k++) {
        if (!c.inv[k] || (c.inv[k].f[0] | 0) <= 0) { slot = k; break; }
      }
      if (slot === -1) { c.inv.push(it); slot = c.inv.length - 1; }
      else c.inv[slot] = it;
      if (Elona.ItemDB && Elona.ItemDB.stack) Elona.ItemDB.stack(c, slot);
      return it;
    },

    /** 背包里第一根钓竿的下标，-1 = 没有 */
    findRod(c) {
      if (!c || !c.inv || !Elona.ItemDB) return -1;
      for (let i = 0; i < c.inv.length; i++) {
        const it = c.inv[i];
        if (!it || (it.f[0] | 0) <= 0) continue;
        if (Elona.ItemDB.ref(it.id, 5) === ROD_CAT) return i;
      }
      return -1;
    },

    // ------------------------------------------------------------------
    // 前置判定（319897-319998）
    // ------------------------------------------------------------------
    /**
     * 能不能开始钓。返回 { ok, reason, message }
     * 体力扣除见 `payStamina`：原版在输入「几小时」之前扣（319986-319998），这里保持同序。
     */
    canUse(g, rodIdx) {
      const p = g.player;
      const idx = (rodIdx === undefined || rodIdx === null) ? this.findRod(p) : rodIdx;
      if (idx < 0) return { ok: false, reason: 'no-rod', message: '你没有钓竿。' };
      const rod = p.inv[idx];
      if (!rod) return { ok: false, reason: 'no-rod', message: '你没有钓竿。' };
      if ((p.skill(SKILL_FISH) | 0) === 0) return { ok: false, reason: 'no-skill', message: TEXT.noSkill };   // 319899
      if (this.invSpace(p, g) === 0) return { ok: false, reason: 'full', message: TEXT.full };            // 319907 + 226382
      if ((rod.f[9] | 0) <= 0) return { ok: false, reason: 'no-bait', message: TEXT.noBait };                 // 319916
      const t = this.waterTarget(g);
      if (!t) return { ok: false, reason: 'no-water', message: TEXT.noWater };                                // 319950
      if (this.isWater(g, p.x, p.y)) return { ok: false, reason: 'swimming', message: TEXT.swimming };        // 319960
      return { ok: true, rodIdx: idx, rod, target: t };
    },

    /** 让玩家面朝水面（319969-319983） */
    faceTo(g, dx, dy) {
      for (let i = 0; i < FACE.length; i++) {
        if (FACE[i][0] === dx && FACE[i][1] === dy) { g.facing = i; return i; }
      }
      return g.facing;
    },

    /**
     * 319986-319998：体力判定 + 扣除，**在询问「钓几小时」之前**执行（原版取消输入也会扣）。
     *   失败：sp<50 且 sp<rnd(75) → 提示「疲労し過ぎて失敗した！」后扣 sp/2+1（319987-319995）
     *   成功：dmgsp 扣 `rnd(sp/2+1) + sp/2+1`（319998）
     */
    payStamina(g) {
      const p = g.player;
      const sp = p.get(52) | 0;
      const half = idiv(sp, 2) + 1;
      if (sp < 50 && sp < g.rng.rnd(75)) {
        g.log(TEXT.tired);
        if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(p, half);
        g.endTurn();
        return { ok: false, reason: 'tired' };
      }
      const cost = half + g.rng.rnd(half);
      if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(p, cost);
      return { ok: true, cost };
    },

    /**
     * 使用钓竿 —— 由 Game.useItem 调用（物品类别 59000）。
     * 返回 { ok:true, action:'fish-hours', rodIdx, spPaid }，由 UI 询问「钓几小时」后调 start()。
     */
    useRod(g, idx) {
      if (Elona.Actions && Elona.Actions.busy(g)) return { ok: false, reason: 'busy' };
      const r = this.canUse(g, idx);
      if (!r.ok) {
        g.log(r.message);
        return { ok: false, reason: r.reason };
      }
      // 转身面向水面（319969-319983）
      this.faceTo(g, r.target.dx, r.target.dy);
      // 319986-319998：体力先扣，再问小时数
      const pay = this.payStamina(g);
      if (!pay.ok) return { ok: false, reason: pay.reason };
      return { ok: true, action: 'fish-hours', rodIdx: r.rodIdx, hours: 1, spPaid: true };
    },

    /**
     * 开始钓鱼 —— 320009-320018 的「钓几小时」+ 312789-312828 的 rowact 建立。
     * @param {number} idx  钓竿下标
     * @param {number} hours 预约小时数（原版输入框，默认 1）
     * @param {{spPaid?:boolean}} [opts] useRod 已经扣过体力时传 { spPaid: true }
     */
    start(g, idx, hours, opts) {
      const p = g.player;
      const can = this.canUse(g, idx);
      if (!can.ok) { g.log(can.message); return { ok: false, reason: can.reason }; }
      // 体力（319986-319998）：独立调用 start() 时仍然自己扣一次
      if (!(opts && opts.spPaid)) {
        const pay = this.payStamina(g);
        if (!pay.ok) return { ok: false, reason: pay.reason };
      }
      this.faceTo(g, can.target.dx, can.target.dy);
      const h = limit(hours === undefined ? 1 : (hours | 0), 1, 24);
      // 320011-320014：var_2412 = 现在 + 小时*60
      const run = { deadline: this.absTime(g) + h * 60, state: STATE.IDLE, fishIdx: -1, rodIdx: idx, hours: h };
      this.runs.set(p, run);

      p.set(140, ROWACT_FISH);
      p.set(141, TURNS);
      p.set(142, idx);
      g.log(h > 1 ? `${TEXT.start}（${h} 小时）` : TEXT.start);   // 312793

      // マシンルアー（312803-312827）：有 890 就用上，直接上一条鱼并收竿
      const hasLure = this.findItem(p, SUPER_LURE) >= 0;
      g.setV65(824, hasLure ? 1 : 0);
      if (hasLure) {
        g.log(TEXT.lure);
        const picked = this.pickFish(g, idx);
        if (picked) this.createCatch(g, picked);
        this.rowActEnd(g, p);
        // 312824：1/10 概率呕吐（复用 0-BD 的 chara_vomit）
        if (Elona.Vomit && g.rng.rnd(10) === 0) {
          const v = Elona.Vomit.vomit(g, p);
          if (v) for (const m of v.messages) g.log(m);
        }
        g.endTurn();
        return { ok: true, started: false, immediate: true };
      }
      g.endTurn();
      return { ok: true, started: true, hours: h, turns: TURNS };
    },

    findItem(c, id) {
      if (!c || !c.inv) return -1;
      for (let i = 0; i < c.inv.length; i++) {
        const it = c.inv[i];
        if (it && (it.f[0] | 0) > 0 && it.id === id) return i;
      }
      return -1;
    },

    rowActEnd(g, p) {
      p.set(140, 0); p.set(141, 0); p.set(142, 0);
      this.runs.delete(p);
    },

    // ------------------------------------------------------------------
    // 抽鱼（*label_2938，312707-312745）
    // ------------------------------------------------------------------
    /**
     * 按钓竿等级选出可钓的池，再按权重抽一条。
     * @returns {{index:number, entry:object}|null}
     */
    pickFish(g, rodIdx) {
      const p = g.player;
      const rod = p.inv[rodIdx];
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      const entries = this.entries();
      if (!entries.length) return null;

      // 312719：tier = limit(钓竿等级 + (rnd5==0) - (rnd5==0), 0, 5)
      let tier = limit(((rod && rod.f[28]) | 0) + (R(5) === 0 ? 1 : 0) - (R(5) === 0 ? 1 : 0), 0, 5);
      const mapId = g.getV65(850) | 0;
      if (mapId === 91) tier = 6;             // 312720-312722
      if (mapId === 44) tier += 200;          // 312723-312725
      if (mapId === 70) tier += 300;          // 312726-312728

      // 312715-312735：累加权重的轮盘
      const pool = [];
      let total = 0;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if ((e.graphic | 0) === 0) continue;         // 312716：0 号占位条目跳过
        if ((e.tier | 0) !== tier) continue;
        total += e.weight | 0;
        pool.push({ index: i, upto: total });
      }
      if (!total) {
        // 312736：var_2409 默认 1（0 号是占位，1 号是「金魚」）
        return entries[1] ? { index: 1, entry: entries[1] } : null;
      }
      const roll = R(total);                          // exrand_rnd
      for (const c of pool) {
        if (c.upto > roll) return { index: c.index, entry: entries[c.index] };
      }
      const last = pool[pool.length - 1];
      return { index: last.index, entry: entries[last.index] };
    },

    // ------------------------------------------------------------------
    // 收获（*label_2939，312747-312777）
    // ------------------------------------------------------------------
    createCatch(g, picked) {
      const p = g.player;
      const e = picked.entry;
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      const it = Elona.ItemDB.createItem(e.itemId, 1);
      it.f[23] = picked.index;                       // 312750：名称下标
      it.f[2] = e.graphic | 0;                       // 312751：外观图号
      // 312752-312760：品质系数
      let mult = 10;
      if (e.itemId === FISH_ID) mult = idiv(R(10) * R(10) + 80, 10);
      else if (e.itemId === JUNK_ID) mult = 10;
      it.f[1] = idiv(e.v10 | 0, 10) * mult;          // 312761：价值
      it.f[7] = idiv(e.w10 | 0, 10) * mult;          // 312762：重量
      const mapId = g.getV65(850) | 0;
      if (mapId === 44) it.f[22] = 5;                // 312763-312768
      if (mapId === 70) it.f[22] = 7;
      this.addToInv(p, it);

      const name = Elona.ItemDB.instanceName(it, 'en');
      g.log(`你钓上来了 ${name}！`);                   // 312772
      // 312775：鱼饵 -1
      const rod = p.inv[this.runs.get(p) ? this.runs.get(p).rodIdx : (p.get(142) | 0)];
      if (rod) rod.f[9] = Math.max(0, (rod.f[9] | 0) - 1);
      return it;
    },

    // ------------------------------------------------------------------
    // 每回合（*label_2940，312835-312973）
    // ------------------------------------------------------------------
    /**
     * @returns {{messages:string[], caught:number, ended:boolean}|null}
     */
    tick(g) {
      const p = g.player;
      if ((p.get(140) | 0) !== ROWACT_FISH) return null;
      const out = { type: ROWACT_FISH, messages: [], caught: 0, ended: false };
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));

      // 604654：var_58(141)--
      let left = (p.get(141) | 0) - 1;
      p.set(141, left);

      const run = this.runs.get(p);
      const rodIdx = run ? run.rodIdx : (p.get(142) | 0);
      const rod = p.inv[rodIdx];
      if (!run || !rod || (rod.f[0] | 0) <= 0) {
        // 读档或状态丢失：安全收竿
        this.rowActEnd(g, p);
        out.ended = true;
        return out;
      }

      // 312836-312853：背包满
      if (this.invSpace(p, g) === 0) {
        out.messages.push(TEXT.full);
        this.rowActEnd(g, p);
        out.ended = true;
        return out;
      }
      // 312854：超时或没饵 → 收竿
      const now = this.absTime(g);
      if (run.deadline <= now || (rod.f[9] | 0) <= 0) {
        out.messages.push((rod.f[9] | 0) <= 0 ? TEXT.stopBait : TEXT.stopTime);
        this.rowActEnd(g, p);
        out.ended = true;
        return out;
      }

      // 312835 起：本回合预算还没用完 → 小游戏推进
      if (left > 0) {
        if (R(3) === 0) {                       // 312862
          run.state = STATE.WAIT;
          const picked = this.pickFish(g, rodIdx);
          run.fishIdx = picked ? picked.index : -1;
        }
        if (run.state === STATE.WAIT) {         // 312866
          if (R(2) === 0) {
            out.messages.push(TEXT.bob);
            if (R(3) === 0) run.state = STATE.HOOK;
            if (R(6) === 0) run.state = STATE.IDLE;
          }
        }
        if (run.state === STATE.HOOK) {         // 312886
          out.messages.push(TEXT.hook);
          run.state = R(10) !== 0 ? STATE.FIGHT : STATE.IDLE;   // 312897
        }
        if (run.state === STATE.FIGHT) {        // 312905
          out.messages.push(TEXT.fight);
          const e = this.entries()[run.fishIdx];
          if (!e || (e.diff | 0) >= R((p.skill(SKILL_FISH) | 0) + 1)) run.state = STATE.IDLE;   // 312919
          else run.state = STATE.LAND;
        }
        if (run.state === STATE.LAND) {         // 312927
          const e = this.entries()[run.fishIdx];
          if (e) {
            this.createCatch(g, { index: run.fishIdx, entry: e });
            out.caught++;
          }
          out.messages.push(TEXT.land);
          // 312944：还有时间也有饵 → 重置 30 回合继续钓
          if (run.deadline > this.absTime(g) && (rod.f[9] | 0) > 0) {
            run.state = STATE.IDLE;
            p.set(141, TURNS);
          } else {
            this.rowActEnd(g, p);
            out.ended = true;
          }
          // 312952 gosub *label_2167 → skillexp 185, 0, 100
          if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, SKILL_FISH, p, 100, 1, 0, g);
          return out;
        }
        // 312955：1/10 概率体力 -1
        if (R(10) === 0) {
          if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(p, 1);
        }
        return out;
      }

      // 312960-312972：预算用完，本轮什么也没钓到
      out.messages.push(TEXT.nothing);
      if (run.deadline > now && (rod.f[9] | 0) > 0) {
        run.state = STATE.IDLE;
        p.set(141, TURNS);
      } else {
        this.rowActEnd(g, p);
        out.ended = true;
      }
      return out;
    },
  };

  Elona.Fishing = Fishing;
  Elona.Fishing.STATE = STATE;
  Elona.Fishing.SKILL = SKILL_FISH;
  Elona.Fishing.ROWACT = ROWACT_FISH;
  Elona.Fishing.TEXT = TEXT;
})(window);
