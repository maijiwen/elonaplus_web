'use strict';
/**
 * 随机事件 —— 对应 start.hsp `*label_2616`（273223-273571，入口分派）
 * 与 `*label_2617`（273572-278851，56 个事件的实体）。
 *
 * 【调用点（源码行号）】
 *   · 603940  Advance_hour 尾部：清醒时每小时一次（var_577 != 9）
 *   · 311896  就寝循环 `repeat var_2395 { var_65(13)++ ; gosub *label_4352 }`：睡眠中每小时一次
 *   · 312243-312255 醒来后的强制事件链：var_2081 = 1 → 100 → 200 → 300
 *   · 343801  航海（var_2081 = 666 → 事件 47）
 *   · 604208  航海事件表（var_2082 > 0 → 48/49/50/53/55）
 *
 * 【var_577 的判定（重要）】
 *   311885 就寝流程 `var_577 = 9`，311946 起床 `var_577 = 0`；270919/272588 是
 *   「文本窗口带背景图」的状态。random_event 的 273341 `if (var_577 == 9)` 大块是
 *   **睡眠中的事件表**（梦境/孩子/添い寝/灵感），清醒时走 273430 之后的地图表。
 *   本模块用参数 `sleeping` 表达，`tickHour(g, {sleeping:true})` 即等价于 var_577==9。
 *
 * 【槽位】
 *   var_65(250+435)=685 灵感   var_65(180)=180 旅经验   var_65(250+416)=666 梦境阶段
 *   var_65(250+444)=694 船等级 var_65(250+447)=697 海域  var_65(250+432)=682 乘客数
 *   var_65(850)=850 大区域（4 诺斯提利斯 / 47 海）       var_65(17)=17 天气
 *   var_126(22) 街安全感  var_126(33) 人狼遊儀阶段  var_126(34) 人狼遊儀进度
 *   var_58(59) 成长阶段（-5 婴儿 … 0 成年）  var_58(182) 亲密度
 *   var_58(197) 船耐久  var_58(169) 关系  var_58(30) 金币  var_58(31) 白金币
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const R = (g, n) => ((g && g.rng) ? g.rng : Elona.rng).rnd(n);
  const V = (g, n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);
  const S = (g, n, v) => { if (g && g.setV65) g.setV65(n, v | 0); };
  const cb = (c, bit) => ((Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, bit) : 0);
  const cbmod = (c, bit, on) => { if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit, on); };

  // ---------------------------------------------------------------- 槽位
  const SLOT = {
    IDEN: 685,          // var_65(250+435) 灵感
    TRAVEXP: 180,       // var_65(180) 旅经验
    DREAM: 666,         // var_65(250+416) 奇妙な階段の夢 阶段 0..4
    SHIP: 694,          // var_65(250+444) 船等级（0 无船 / 3,5,6 …）
    SEA: 697,           // var_65(250+447) 海域 id
    CREW: 682,          // var_65(250+432) 船上乘客
    REGION: 850,        // var_65(850) 大区域（4 诺斯提利斯 / 47 海）
    WEATHER: 17,        // var_65(17) 天气（1 = 以太风）
    MONTH: 11, DAY: 12, HOUR: 13,
  };
  const MAP_SLOT = {
    SECURITY: 22,       // var_126(22) 街安全感
    RITUAL: 33,         // var_126(33) 人狼遊儀阶段（0 无 / 1 狼 / 2 处刑 / 3 结束）
    RITUAL_LV: 34,      // var_126(34) 人狼遊儀进度 0..200
  };

  /** 事件状态（宿主可持久化到存档） */
  class State {
    constructor() {
      this.v2080 = 0;      // 人狼/处刑链标记（10 = 处刑待发）
      this.v2081 = 0;      // 强制事件（1/100/200/300/666）
      this.v2082 = 0;      // 航海事件（10/11/12）
      this.v2083 = 0;      // 选中的 NPC 槽
      this.v2084 = 0;      // 添い寝触发（100/1000/2000）
      this.v2087 = 0;      // 神狼降临坐标
      this.v2088 = 0;
      this.lastId = 0;
      this.count = 0;
    }
    toJSON() { return Object.assign({}, this); }
    static fromJSON(o) {
      const s = new State();
      if (o) Object.assign(s, o);
      return s;
    }
  }

  function stateOf(g) {
    if (!g) return new State();
    if (!g.randomEventState) g.randomEventState = new State();
    return g.randomEventState;
  }

  const mk = (g, n) => (g && g.map ? g.map[n] : 0) | 0;
  const mapIdOf = (g) => V(g, 20);
  const subMapOf = (g) => V(g, 22);

  /** var_126(6) = var_132(0, mapId)：site 表的 kind（1 大陆 / 2 野外 / 3 城市 / 5 自宅 / 6 / 7 / 20..） */
  function mapKind(g) {
    const id = mapIdOf(g);
    if (Elona.Sites && Elona.Sites.get) {
      const s = Elona.Sites.get(id);
      if (s && s.fields) return s.fields[0] | 0;
    }
    const known = { 4: 1, 47: 1, 70: 1, 54: 3, 7: 5 };
    return known[id] || 0;
  }

  /** var_126(n) 的通用读取：取自 site 表 fields[n] */
  function mapVar(g, n) {
    if (n === MAP_SLOT.SECURITY || n === MAP_SLOT.RITUAL || n === MAP_SLOT.RITUAL_LV) {
      const m = g && g.mapVar126;
      if (m && m[n] !== undefined) return m[n] | 0;
      if (g && g.v126 && g.v126[n] !== undefined) return g.v126[n] | 0;
      return 0;
    }
    const s = Elona.Sites && Elona.Sites.get ? Elona.Sites.get(mapIdOf(g)) : null;
    return (s && s.fields && s.fields[n]) ? (s.fields[n] | 0) : 0;
  }
  function setMapVar(g, n, v) {
    if (!g) return;
    if (!g.v126) g.v126 = {};
    g.v126[n] = v | 0;
  }

  // ---------------------------------------------------------------- 事件记录
  function log(g, msg) {
    if (!msg) return;
    if (g && typeof g.log === 'function') g.log(msg);
  }

  /**
   * 构造一次事件并让宿主（或默认策略）选择。
   * 默认策略：取第一个选项 —— 与原版对话框默认光标一致（var_763 = -1 时首选 1）。
   */
  function ask(g, ev) {
    const opts = ev.options || [];
    if (!opts.length) return ev;
    ev.selected = 1;
    let sel = 0;
    const chooser = Elona.RandomEvent && Elona.RandomEvent.chooser;
    if (typeof chooser === 'function') {
      try { sel = chooser(g, ev) | 0; } catch (e) { sel = 0; }
    }
    const hit = opts.find((o) => (o.value | 0) === sel);
    ev.selected = hit ? (hit.value | 0) : (opts[0].value | 0);
    ev.selectedLabel = (hit || opts[0]).label;
    ev.auto = !hit;
    return ev;
  }

  function finish(g, ev) {
    stateOf(g).lastId = ev.id | 0;
    stateOf(g).count++;
    if (ev.title) log(g, `【${ev.title}】`);
    if (ev.text) log(g, ev.text);
    for (const l of (ev.lines || [])) log(g, l);
    return ev;
  }

  /** 灵感 +1（273642 / 274022 等 30 余处的公共片段） */
  function gainIden(g) {
    S(g, SLOT.IDEN, V(g, SLOT.IDEN) + 1);
    log(g, `灵感 +1（当前 ${V(g, SLOT.IDEN)}）`);
  }
  /** 旅经验 +1（273649 / 273779 等） */
  function gainTravExp(g) {
    S(g, SLOT.TRAVEXP, V(g, SLOT.TRAVEXP) + 1);
    log(g, `旅经验 +1（当前 ${V(g, SLOT.TRAVEXP)}）`);
  }

  function chara(g, idx) {
    if (!g || !g.charas) return null;
    const c = g.charas[idx | 0];
    return (c && c.get) ? c : null;
  }
  function nameOf(c) {
    if (!c) return '某人';
    if (typeof c.name === 'string' && c.name) return c.name;
    if (c.get) {
      const a = c.get(1) ? '' : '';
      void a;
    }
    return '某人';
  }
  function modImp(c, v, g) { if (Elona.NPC && Elona.NPC.modImp && c) Elona.NPC.modImp(c, v, g); }
  /** implevel2（193395-193417）：关系值 → 等级 0..7 */
  function implevel2(v) {
    if (v < -100) return 0;
    if (v < 0) return 1;
    if (v < 100) return 2;
    if (v < 150) return 3;
    if (v < 200) return 4;
    if (v < 250) return 5;
    if (v < 300) return 6;
    return 7;
  }
  /**
   * modimp2（193418-193452）：改变 var_58(169)「关系值」。
   * npc.js 只导出了 modImp（友好度 var_58(17)），关系值这一支此前没有实现，
   * 随机事件的孩子事件（38-46）与强制作业（26）都要用它，因此在本地按源码实现。
   */
  function modImp2(c, v, g) {
    if (!c) return 0;
    const lv = implevel2(c.get(169) | 0);
    let d;
    if (v < 0) d = v;
    else {
      d = idiv(v * 100, 50 + lv * lv * lv);
      if (d === 0 && lv < R(g, 10)) d = 1;
    }
    if ((c.get(441) | 0) <= -11 && d > 0) d = idiv(d * 3, 2);
    let rel = (c.get(169) | 0) + d;
    if ((c.get(441) | 0) >= 0) rel = Math.min(300, rel);
    else rel = Math.min(300 + limit(idiv((c.skill ? c.skill(158) : 0) + 10, 5), 0, 699), rel);
    rel = Math.max(-300, rel);
    c.set(169, rel);
    return d;
  }
  /** modkarma（31689-31720）：玩家业值 var_58(49) */
  function modKarma(g, v) {
    const p = g && g.player;
    if (!p) return 0;
    let d = v | 0;
    if (d < 0 && (p.get(97 + 162) | 0)) { d = idiv(d * 75, 100); if (d === 0) return 0; }
    if (d < 0 && (p.get(97 + 169) | 0)) d = idiv(d * 150, 100);
    p.set(49, (p.get(49) | 0) + d);
    log(g, `业值变动（${d >= 0 ? '+' : ''}${d}）`);
    return d;
  }
  function skillExp(g, skillId, charaIdx, exp, div, tea) {
    if (!Elona.Stats || !Elona.Stats.skillExp) return;
    const c = chara(g, charaIdx);
    if (!c) return;
    Elona.Stats.skillExp(c, skillId, charaIdx | 0, exp, div, tea, g);
  }
  function modGrowth(g, c, skillId, delta) {
    if (Elona.Stats && Elona.Stats.modGrowth && c) Elona.Stats.modGrowth(c, skillId, 0, delta, g);
  }
  function addBuff(g, c, id, p1, p2) {
    if (Elona.Status && Elona.Status.addbuff && c) Elona.Status.addbuff(g, c, id, p1, p2);
  }
  /** itemcreate 的简化：直接塞进玩家背包 */
  function giveItem(g, id, n, tag) {
    const p = g && g.player;
    if (!p || !p.inv) return null;
    if (!Elona.ItemDB || !Elona.ItemDB.eq || !Elona.ItemDB.eq(id)) return null;
    const it = Elona.ItemDB.createItem(id, n || 1);
    if (!it) return null;
    it.f[0] = n || 1;
    it.f[5] = p.x; it.f[6] = p.y; it.f[21] = -1;
    if (tag !== undefined && tag !== null) it.f[17] = tag | 0;
    for (let i = 0; i < p.inv.length; i++) {
      if (!p.inv[i] || (p.inv[i].f[0] | 0) <= 0) { p.inv[i] = it; return it; }
    }
    p.inv.push(it);
    return it;
  }
  function itemName(id) {
    if (Elona.ItemDB && Elona.ItemDB.name) {
      const n = Elona.ItemDB.name(id, 'cn');
      if (n) return n;
      const e = Elona.ItemDB.name(id, 'en');
      if (e) return e;
    }
    return `物品${id}`;
  }
  /** 玩家背包空格（inv_getfreeid） */
  function invFree(g) {
    const p = g && g.player;
    if (!p || !p.inv) return -1;
    for (let i = 0; i < p.inv.length; i++) {
      if (!p.inv[i] || (p.inv[i].f[0] | 0) <= 0) return i;
    }
    return p.inv.length < 200 ? p.inv.length : -1;
  }
  /** 宠物/同伴槽（16..244，非玩家） */
  function companionSlots(g) {
    const out = [];
    for (let i = 16; i < 245; i++) {
      const c = chara(g, i);
      if (c && (c.get(0) | 0) === 1) out.push(i);
    }
    return out;
  }
  function randCompanion(g, minFriend) {
    for (let t = 0; t < 20; t++) {
      const slot = R(g, V(g, 3) + 1) + 57;
      if (slot >= 245) continue;
      const c = chara(g, slot);
      if (!c) continue;
      if ((c.get(0) | 0) !== 1) continue;
      if (minFriend !== undefined && (c.get(17) | 0) < minFriend) continue;
      return slot;
    }
    return 0;
  }
  /** dmghp <角色>, 99999, -11 的等价：直接判定死亡（var_58(0)=0、var_58(50)=-1） */
  function killNpc(g, slot) {
    const c = chara(g, slot);
    if (!c) return;
    if (Elona.Battle && Elona.Battle.dmghp) { Elona.Battle.dmghp(g, c, 99999, -11); return; }
    c.set(50, -1);
    c.set(0, 0);
  }
  function createNpc(g, creatureId, level) {
    if (!Elona.CharaFactory) return null;
    const p = g.player;
    return Elona.CharaFactory.create(g, creatureId, level, p.x, p.y, {});
  }
  function language(g) { return (g && g.lang) || 'cn'; }
  function cn(g, cnText, enText) { return language(g) === 'en' ? enText : cnText; }
  function pick(g, arr) { return arr[R(g, arr.length)]; }

  /** var_82(19, 0)：玩家的幸运（属性 19） */
  function luck(g) { return (g && g.player && g.player.skill) ? (g.player.skill(19) | 0) : 0; }
  /** var_65(189)：玩家等级（用于生成强度） */
  function plevel(g) { return V(g, 189) || (g.player ? (g.player.get(17) | 0) : 1); }

  // ---------------------------------------------------------------- 分派
  /**
   * 每小时 tick —— *label_2616 的入口（273223-273571）。
   * @param {object} g 游戏对象
   * @param {object} [opts] { sleeping:boolean , force:number }
   * @returns {object|null} 事件记录
   */
  function tickHour(g, opts) {
    const o = opts || {};
    if (!g || !g.player) return null;
    const st = stateOf(g);
    const id = choose(g, st, !!o.sleeping, o.force);
    if (!id) return null;
    return dispatch(g, id, st);
  }

  /** 分派决策；返回事件 id 或 0 */
  function choose(g, st, sleeping, force) {
    const kind = mapKind(g);                 // var_126(6)
    const rid = V(g, 20), sub = V(g, 22);
    if (force !== undefined && force !== null) {
      st.v2081 = force | 0;
      const f = forcedEvent(g, st);
      st.v2081 = 0;
      // 调试/脚本入口：非醒来链的 id 直接原样返回
      if (!f && H[force | 0]) return force | 0;
      return f;
    }

    // 273230-273232：非城市地图清掉「人狼链」
    if (kind !== 3) st.v2080 = 0;

    // 273234-273254：强制事件（醒来链 / 航海）
    if (st.v2081 === 1) return 57;
    if (st.v2081 === 100) return 27;
    if (st.v2081 === 200) return 29;
    if (st.v2081 === 300) return 30;
    if (st.v2080 === 10) return 28;
    if (mapVar(g, MAP_SLOT.RITUAL) === 3 && !sleeping) return 31;
    if (st.v2081 === 666) { st.v2081 = 0; return 47; }

    // 273271-273297：航海事件链（var_2082）
    if (st.v2082 > 0) {
      if (rid === 47) {
        const v = st.v2082;
        if (v === 10) { st.v2082 = 0; return 53; }
        if (v === 11) {
          const r = R(g, 3);
          st.v2082 = 0;
          return r === 0 ? 48 : (r === 1 ? 49 : 50);
        }
        if (v === 12) { st.v2082 = 0; return 55; }
        return 0;
      }
      st.v2082 = 0;
    }

    // 273301-273341：扫描一个「有事」的 NPC（var_2083）
    if (st.v2081 < 100 && st.v2080 !== 10) {
      st.v2083 = pickEventNpc(g);
      st.v2080 = 0;

      // 273343-273428：睡眠中的生活事件表
      if (sleeping) return sleepingTable(g, st, kind);

      // 273430-273445：清醒时的公共前置
      if (kind !== 1 && (V(g, 140) !== 0)) return 0;         // var_58(140,0)：正在被通缉/任务中
      if (kind === 5) return 0;                              // 自宅不触发
      if (rid === 54 && sub === 3) return 0;                 // ヴァルム B3

      // 273447-273540：孩子事件（var_58(59) 成长阶段）
      if (st.v2083 > 0) {
        const child = chara(g, st.v2083);
        const stage = child ? (child.get(59) | 0) : 0;
        if (stage === -5) return 36;
        if (stage === -4) return 37;
        if (stage === -3 || stage === -2 || stage === -1) {
          let t = child.get(16) | 0;
          if (t > 2) { child.set(16, 0); t = 0; }
          child.set(16, t + 1);
          if (stage === -3) return 38 + t;
          if (stage === -2) return 41 + t;
          return 44 + t;
        }
      }

      // 273542-273556：陆上事件表
      if (V(g, SLOT.REGION) !== 47) {
        let ev = 0;
        if (R(g, 30) === 0) ev = 17;
        if (R(g, 25) === 0) ev = 16;
        if (R(g, 25) === 0) ev = 12;
        if (R(g, 50) === 0) ev = 9;
        if (R(g, 80) === 0) ev = 14;
        if (R(g, 50) === 0) ev = 8;
        if (R(g, 80) === 0) ev = 13;
        if (ev) return ev;
      } else if (rid === 47) {
        // 273558-273570：海上
        if ((V(g, 17) === 4 || V(g, 17) === 1) && R(g, 10 + V(g, SLOT.SHIP) * 2) === 0) return 47;
        if (V(g, SLOT.SHIP) > 0) {
          if (V(g, SLOT.SHIP) < 6 && R(g, 10) === 0) return 51;
          if (R(g, 10) === 0) return 52;
        }
        if (R(g, 60) === 0) return 56;
      }

      // 273573-273583：城市
      if (kind === 3) {
        if (R(g, 25) === 0) return 15;
        return 0;
      }
      // 273585-273595：大陆（世界地图）
      if (kind === 1) {
        if (R(g, 20)) return 0;
        if (R(g, 3) === 0) return 56;
        return 0;
      }
      // 273597-273600：其它（野外地图）
      if (R(g, 25) === 0) return 10;
      if (R(g, 25) === 0) return 11;
    }
    return 0;
  }

  /** var_2081 的强制事件映射（醒来链） */
  function forcedEvent(g, st) {
    if (st.v2081 === 1) return 57;
    if (st.v2081 === 100) return 27;
    if (st.v2081 === 200) return 29;
    if (st.v2081 === 300) return 30;
    if (st.v2081 === 666) return 47;
    return 0;
  }

  /** 273301-273341：挑一个「有事件标记」的角色 */
  function pickEventNpc(g) {
    let v2083 = 0;
    const n = limit(V(g, 3), 0, 245);
    for (let cnt = 0; cnt < n; cnt++) {
      const c = chara(g, cnt);
      if (!c) continue;
      if (cb(c, 1034) !== 1) continue;
      if ((c.get(0) | 0) !== 1) continue;
      if ((c.get(251) | 0) > 0) continue;      // 眩晕
      if ((c.get(256) | 0) >= 60) continue;    // 睡眠
      if (R(g, 100) > 10) continue;
      const prev = chara(g, v2083);
      const stage = prev ? (prev.get(59) | 0) : 0;
      if (stage === -4 && R(g, 10) > 7) continue;
      if (stage === -3 && R(g, 10) > 5) continue;
      if (stage === -2 && R(g, 10) > 3) continue;
      if (stage === -1 && R(g, 10) > 3) continue;
      v2083 = cnt;
      break;
    }
    return v2083;
  }

  /** 273343-273428：睡眠中的事件表（var_577 == 9） */
  function sleepingTable(g, st, kind) {
    const p = g.player;
    let ev = 0;
    // 273344-273346：信神且 rnd(12) → 信仰の深まり
    if ((p.get(61) | 0) !== 0 && R(g, 12) === 0) ev = 18;
    if (R(g, 120) === 0) ev = 4;        // 不気味な夢（带幸运门槛）
    if (R(g, 100) === 0) ev = 33;       // 繋がる夢廻廊
    if (R(g, 50) === 0) ev = 3;         // 成長のきざし
    if (R(g, 25) === 0) ev = 2;         // 魔法使いの夢
    if (R(g, 150) === 0) ev = 5;        // 呪いのつぶやき
    if (R(g, 150) === 0) ev = 35;       // 奇妙な階段の夢
    if (R(g, 20) === 0) ev = 6;         // 自然治癒力
    if (R(g, 20) === 0) ev = 7;         // 瞑想力
    if (R(g, 120) === 0) ev = 8;        // 悪意ある手
    if (R(g, 300) === 0) ev = 32;       // 胡蝶の夢
    if (R(g, 50) === 0) ev = 23;        // 夢の中の収穫
    if (R(g, 300) === 0) ev = 24;       // 才能の開花
    if (R(g, 120) === 0) ev = 22;       // 怪物の夢
    if (R(g, 100) === 0) ev = 34;       // 羊の悪夢
    if (R(g, 50) === 0 || st.v2084 === 2000) ev = 25;   // 添い寝
    // 273396-273422：身上带着 767（「夢見の枕」类）时的额外机会
    if ((p.get(142) | 0) >= 0) {
      const eqSlot = p.get(142) | 0;
      const it = p.inv ? p.inv[eqSlot] : null;
      if (it && (it.id | 0) === 767) {
        if ((p.get(61) | 0) !== 0 && R(g, 2) === 0) ev = 18;
        if (R(g, 2) === 0) ev = 6;
        if (R(g, 10) === 0) ev = 3;
        if (R(g, 60) === 0) ev = 24;
      }
    }
    if (st.v2083 > 0) {
      const c = chara(g, st.v2083);
      if (c && (c.get(59) | 0) === -5) ev = 36;
    }
    if (R(g, 200) === 0) ev = 20;                                   // 幸運の日
    if (R(g, 250) === 0 && invFree(g) !== -1) ev = 19;               // 宝を埋める夢
    if (R(g, 10000) === 0 && invFree(g) !== -1) ev = 21;             // 運命の気まぐれ
    if (st.v2084 === 1000) ev = 26;                                  // 強制添い寝
    void kind;
    return ev;
  }

  // ---------------------------------------------------------------- 事件实体
  const H = {};

  /* ============ 31 処刑の時間（273592-273700）============ */
  H[31] = function (g, st) {
    const ev = { id: 31, title: '处刑的时间', options: [], lines: [] };
    let target = 0;
    for (let i = 16; i < 245; i++) {
      const c = chara(g, i);
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (cb(c, 992)) continue;
      if (cb(c, 971) === 1) continue;
      if ((c.get(9) | 0) === -1) continue;
      if ((c.get(413) | 0) === 0) continue;
      if (target === 0 || (c.get(413) | 0) > (chara(g, target).get(413) | 0)) target = i;
    }
    if (!target) { ev.text = '广场上没有人被押上刑台。'; return finish(g, ev); }
    const t = chara(g, target);
    const nm = nameOf(t);
    ev.text = `${nm}「呜哇——！」`;
    killNpc(g, target);
    setMapVar(g, MAP_SLOT.RITUAL, 0);                        // 273633：遊儀结束
    setMapVar(g, MAP_SLOT.SECURITY, mapVar(g, MAP_SLOT.SECURITY) + 5);
    ev.lines.push(`街的安全感上升了 5（当前 ${mapVar(g, MAP_SLOT.SECURITY)}）。`);
    gainIden(g);
    gainTravExp(g);
    ev.lines.push('你听见远处传来处刑的钟声。「南无。」');
    // 273662-273696：若场上已无人狼/侦探 → 仪式失败，市民胜利
    let wolf = 0;
    for (let i = 16; i < 245; i++) {
      const c = chara(g, i);
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (cb(c, 992)) continue;
      const cid = c.get(27) | 0;
      if (cid === 666 || cid === 697) { wolf++; break; }
    }
    if (!wolf) {
      setMapVar(g, MAP_SLOT.RITUAL_LV, 0);
      ev.lines.push(`【人狼游仪失败：${mapVar(g, MAP_SLOT.RITUAL_LV)}/200】`);
      ev.lines.push('狼们的仪式被确认失败了。市民阵营获胜。');
    }
    return finish(g, ev);
  };

  /* ============ 28 狼の襲撃（273701-273904）============ */
  H[28] = function (g, st) {
    const ev = { id: 28, title: '狼的袭击', options: [], lines: [] };
    st.v2080 = 0;
    let victim = 0;
    // 273704-273720：优先咬死「侦探」(696)
    for (let t = 0; t < 20; t++) {
      const slot = R(g, V(g, 3) + 1) + 57;
      if (slot >= 245) continue;
      const c = chara(g, slot);
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(27) | 0) !== 696) continue;
      if ((c.get(151) | 0) === 0) continue;
      if (R(g, (c.get(86) | 0) + 8) <= 5) {
        killNpc(g, slot);
        st.v2080 = 10;
        victim = slot;
        break;
      }
    }
    // 273721-273752：否则杀一个市民，累计进度
    if (st.v2080 !== 10) {
      for (let t = 0; t < 20; t++) {
        const slot = R(g, V(g, 3) + 1) + 57;
        if (slot >= 245) continue;
        const c = chara(g, slot);
        if (!c) continue;
        if ((c.get(0) | 0) === 1) {
          const cid = c.get(27) | 0;
          if (cid === 666 || cid === 696 || cid === 697) continue;
        }
        if ((c.get(0) | 0) === 1) {
          const cid = c.get(27) | 0;
          if (cid === 673 || (c.get(25) | 0) > 3 || cb(c, 992) === 1) {
            st.v2080 = 100;                        // 有妖狐/强敌 → 中止
            break;
          }
        }
        st.v2087 = c.get(1) | 0;
        st.v2088 = c.get(2) | 0;
        if ((c.get(0) | 0) === 1) {
          const lv = limit(c.get(38) | 0, 1, 50);
          setMapVar(g, MAP_SLOT.RITUAL_LV, Math.min(200, mapVar(g, MAP_SLOT.RITUAL_LV) + lv));
          ev.text = `${nameOf(c)}「呜哇——！」`;
          killNpc(g, slot);
          st.v2080 = 10;
          victim = slot;
          break;
        }
      }
    }
    if (st.v2080 === 0) { ev.text = '今夜街上很安静。'; return finish(g, ev); }
    if (st.v2080 === 100) { st.v2080 = 0; ev.text = '狼在暗处窥探了一阵，最终退走了。'; return finish(g, ev); }

    setMapVar(g, MAP_SLOT.RITUAL, 1);
    ev.title = '狼的袭击';
    ev.lines.push('[人狼造成了牺牲。有投票权的各位请对可疑人物投出处刑票。]');
    gainIden(g);
    gainTravExp(g);
    ev.lines.push('街角传来狼嚎与微弱的惨叫。');
    ev.lines.push(`【人狼游仪进行中：${mapVar(g, MAP_SLOT.RITUAL_LV)}/200】`);
    st.v2080 = 0;

    // 273799-273899：进度满 200 → 神狼 / 九尾降临
    if (mapVar(g, MAP_SLOT.RITUAL_LV) >= 200) {
      let fox = 0;
      for (let i = 16; i < 245; i++) {
        const c = chara(g, i);
        if (!c || (c.get(0) | 0) !== 1) continue;
        if (cb(c, 992)) continue;
        if ((c.get(27) | 0) === 673) { fox = 1; break; }
      }
      if (!fox) {
        ev.lines.push('献祭的合计等级达到 200，神狼降临了。狼阵营获胜。');
        createNpc(g, 1126, limit(85 + idiv(plevel(g), 2), 85, 2000));
        for (let i = 16; i < 245; i++) {
          const c = chara(g, i);
          if (!c) continue;
          if ((c.get(27) | 0) === 666) {
            const pic = c.get(7) | 0;
            if (pic === 136 || pic === 153) c.set(7, 759);
            if (pic === 137 || pic === 320) c.set(7, 760);
            if (typeof c.name === 'string' && c.name.indexOf('市民') === 0) c.name = '人狼' + c.name.slice(2);
            c.set(69, -3); c.set(9, -3); c.set(29, 0);
          }
          if ((c.get(27) | 0) === 697) {
            if ((c.get(7) | 0) === 781) c.set(7, (c.get(8) | 0) === 0 ? 759 + 6000 : 760 + 6000);
            if (typeof c.name === 'string' && c.name.indexOf('侦探') === 0) c.name = '人狼侦探' + c.name.slice(2);
            c.set(69, -3); c.set(9, -3); c.set(29, 0);
          }
        }
      } else {
        ev.lines.push('潜伏的妖狐夺取了人狼游仪，九尾降临了。狐阵营获胜。');
        createNpc(g, 1125, limit(90 + idiv(plevel(g), 2), 90, 2000));
        for (let i = 16; i < 245; i++) {
          const c = chara(g, i);
          if (!c) continue;
          if ((c.get(27) | 0) === 673) {
            const pic = c.get(7) | 0;
            if (pic === 136 || pic === 153 || pic === 137 || pic === 320) c.set(7, 764);
            if (typeof c.name === 'string' && c.name.indexOf('市民') === 0) c.name = '妖狐' + c.name.slice(2);
            c.set(13, -1);
          }
        }
      }
    }
    st.v2087 = 0;
    st.v2088 = 0;
    void victim;
    return finish(g, ev);
  };

  /* ============ 15 殺人鬼（273905-273945）============ */
  H[15] = function (g) {
    const ev = { id: 15, title: '杀人鬼', options: [], lines: [] };
    let victim = 0;
    for (let t = 0; t < 20; t++) {
      const slot = R(g, V(g, 3) + 1) + 57;
      if (slot >= 245) continue;
      const c = chara(g, slot);
      if (!c || (c.get(0) | 0) !== 1) continue;
      ev.text = `${nameOf(c)}「呜哇——！」`;
      killNpc(g, slot);
      victim = slot;
      break;
    }
    if (!victim) { ev.text = '街上一切如常。'; return finish(g, ev); }
    gainIden(g);
    gainTravExp(g);
    ev.lines.push('街角传来惨叫。你看见卫兵慌慌张张地跑过。「杀人啦，杀人啦！！」');
    return finish(g, ev);
  };

  /* ============ 14 謎のご馳走（273946-273970）============ */
  H[14] = function (g) {
    const ev = {
      id: 14, title: '谜之盛宴', text: '你发现眼前摆着一桌盛宴。',
      options: [{ value: 1, label: '吃' }, { value: 2, label: '离开' }], lines: [],
    };
    ask(g, ev);
    if (ev.selected === 1) {
      const p = g.player;
      p.set(22, 15000);                       // 273959：饱食度
      ev.lines.push('なかなか美味しかった。「悪くない。」你咂了咂嘴。');
    } else {
      ev.lines.push('你决定不去碰那桌来历不明的东西。');
    }
    return finish(g, ev);
  };

  /* ============ 27 朝のひととき（273971-274154）============ */
  H[27] = function (g) {
    const ev = { id: 27, title: '清晨的一刻', options: [{ value: 1, label: '吃' }, { value: 2, label: '不吃' }], lines: [] };
    let cook = 0, cooks = 0;
    for (let i = 1; i < 16; i++) {
      const c = chara(g, i);
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(17) | 0) < 150) continue;
      if ((c.skill ? (c.skill(184) | 0) : 0) < 1) continue;
      cooks++;
      if (cook === 0 || R(g, 2) === 0) cook = i;
    }
    if (!cook) { ev.text = '今天没有人准备早餐。'; return finish(g, ev); }
    const nm = nameOf(chara(g, cook));
    ev.text = cooks === 0
      ? `看来 ${nm} 正在准备早餐。`
      : `看来 ${nm} 他们正在准备早餐。`;
    ask(g, ev);
    if (ev.selected === 1) {
      const p = g.player;
      skillExp(g, 184, cook, 1000, 0, 0);
      gainIden(g);
      let taste = R(g, (chara(g, cook).skill ? (chara(g, cook).skill(184) | 0) : 0) + 2);
      for (let i = 1; i < 16; i++) {
        const c = chara(g, i);
        if (!c || (c.get(0) | 0) !== 1) continue;
        if ((c.get(17) | 0) < 150) continue;
        if (i === cook) continue;
        if ((c.skill ? (c.skill(184) | 0) : 0) < 1) continue;
        taste += R(g, idiv(c.skill ? (c.skill(184) | 0) : 0, 2) + 2);
        skillExp(g, 184, i, 500, 0, 0);
      }
      let grade = 1, tasteText = '目が覚めるようなまずさだ。';
      if (taste >= 1 && taste <= 10) { grade = 2; tasteText = '少し物足りない味だ。'; }
      if (taste >= 11 && taste <= 20) { grade = 3; tasteText = 'そつのない味だ。'; }
      if (taste >= 21 && taste <= 40) { grade = 4; tasteText = 'かなりいける。'; }
      if (taste >= 41 && taste <= 60) { grade = 5; tasteText = '这是美味！'; }
      if (taste >= 61) { grade = 6; tasteText = '最高美味！从早上开始就幸福满点！'; }
      ev.lines.push(tasteText);
      for (let i = 0; i < 16; i++) {
        const c = chara(g, i);
        if (!c) continue;
        c.set(22, 12000); c.set(446, 12000);
        if ((c.get(0) | 0) !== 1) continue;
        for (let sk = 10; sk <= 19; sk++) modGrowth(g, c, sk, grade);
        if (c.set) c.set(79, 6 + 300);        // 进食动作帧
      }
      void p;
      ev.lines.push('全员都吃饱了，状态很好。');
    } else {
      const c = chara(g, cook);
      if (c) c.set(79, 13 + 300);
      ev.lines.push(`${nm} 有点失落……。`);
    }
    return finish(g, ev);
  };

  /* ============ 57 ささやかな支援（274155-274202）============ */
  H[57] = function (g) {
    const ev = { id: 57, title: '微薄的支援', text: '向导似乎筹集到了支援物资。', options: [{ value: 1, label: '多谢' }], lines: [] };
    ask(g, ev);
    gainIden(g);
    const lv = V(g, 250 + 2);
    let id = 68;
    if (lv >= 210 && lv < 350) id = 69;
    if (lv >= 350 && lv < 1010) id = 70;
    if (lv >= 1010) id = 71;
    const it = giveItem(g, id, 1, 0);
    giveItem(g, 16, 1, 0);
    ev.lines.push(it ? `有什么东西滚到了脚边（${itemName(id)}）。` : '背包满了，物资掉在了地上。');
    return finish(g, ev);
  };

  /* ============ 29 手作りのプレゼント（274203-274405）============ */
  function handmade(g, skillId, title, armorSet) {
    const ev = { id: 0, title, options: [{ value: 1, label: '收下' }, { value: 2, label: '不要' }], lines: [] };
    if ((g.player.get(253) | 0) !== 0) { ev.text = '今晚没有人来送东西。'; return finish(g, ev); }
    let maker = 0, makers = 0;
    for (let i = 1; i < 16; i++) {
      const c = chara(g, i);
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (i === 0) continue;
      if ((c.get(17) | 0) < 200) continue;
      if ((c.skill ? (c.skill(skillId) | 0) : 0) < 1) continue;
      makers++;
      if (maker === 0 || R(g, 2) === 0) maker = i;
    }
    if (!maker) { ev.text = '今晚没有人熬夜做东西。'; return finish(g, ev); }
    const nm = nameOf(chara(g, maker));
    ev.text = makers === 0
      ? `${nm} 熬夜为你做了点什么。`
      : `${nm} 他们熬夜为你做了点什么。`;
    ask(g, ev);
    if (ev.selected === 1) {
      skillExp(g, skillId, maker, 1000, 0, 0);
      let quality = R(g, (chara(g, maker).skill ? (chara(g, maker).skill(skillId) | 0) : 0) + 10) + 1;
      for (let i = 1; i < 16; i++) {
        const c = chara(g, i);
        if (!c || (c.get(0) | 0) !== 1) continue;
        if (i === maker) continue;
        if ((c.skill ? (c.skill(skillId) | 0) : 0) < 1) continue;
        quality += R(g, idiv(c.skill(skillId) | 0, 2) + 5) + 1;
        skillExp(g, skillId, i, 500, 0, 0);
      }
      gainIden(g);
      let itemId = 450;
      const th = [20, 30, 40, 50, 60, 70, 80, 90, 100];
      const low = [465, 470, 460, 439, 458, 454, 467, 446, 436];
      const high = [457, 442, 5, 65, 462, 9, 440, 444, 6];
      const table = (skillId === 177) ? high : low;
      for (let k = 0; k < 9; k++) { if (quality >= th[k]) itemId = table[k]; }
      if (skillId === 177 && quality < 20) itemId = 445;
      const it = giveItem(g, itemId, 1, 1);
      ev.lines.push(it ? `有什么东西滚到了脚边（${itemName(itemId)}）。` : '背包满了，东西掉在了地上。');
      if (it) ev.lines.push(`${nm} 显得很高兴。`);
    } else {
      chara(g, maker).set(79, 13 + 300);
      ev.lines.push(`${nm} 半哭着把东西扔掉了。`);
    }
    void armorSet;
    return finish(g, ev);
  }
  H[29] = (g) => { const e = handmade(g, 176, '手制的礼物', 0); e.id = 29; return e; };
  H[30] = (g) => { const e = handmade(g, 177, '手织的礼物', 1); e.id = 30; return e; };

  /* ============ 13 ご馳走の匂い（274607-274633）============ */
  H[13] = function (g) {
    const ev = { id: 13, title: '佳肴的香气', text: '不知从何处飘来阵阵饭菜香，你的胃开始抗议了。', options: [{ value: 1, label: '饿死了…' }] };
    gainIden(g);
    gainTravExp(g);
    g.player.set(22, (g.player.get(22) | 0) - 5000);
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 1 不運の回避（274634-274659）============ */
  H[1] = function (g) {
    const ev = { id: 1, title: '避开了不幸', text: '你有一瞬间感到不祥的预感，但它很快就消失了。', options: [{ value: 1, label: '好' }] };
    gainIden(g);
    gainTravExp(g);
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 24 才能の開花（274660-274681）============ */
  H[24] = function (g) {
    const ev = { id: 24, title: '才能开花', text: '你的才能突然开花了！', options: [{ value: 1, label: '哇哦' }], lines: [] };
    gainIden(g);
    // 274669-274671：var_396 = 1113 → *label_2960，随机技能潜力提升
    const p = g.player;
    const skills = [];
    for (let s = 10; s < 20; s++) if ((p.skill ? p.skill(s) : 0) > 0) skills.push(s);
    if (skills.length && Elona.Stats && Elona.Stats.modGrowth) {
      const s = skills[R(g, skills.length)];
      Elona.Stats.modGrowth(p, s, 0, 100, g);
      ev.lines.push('某个技能的潜在能力上升了。');
    }
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 18 信仰の深まり（274682-274726）============ */
  H[18] = function (g) {
    const god = g.player.get(61) | 0;
    const names = ['', '无', '艾莉丝', '杰哈', '鲁尔', '艾斯', '玛娜', '伊兹', '欧帕', '朱亚'];
    const ev = {
      id: 18, title: '信仰加深',
      text: `梦中，你触碰到了伟大者的威光。${names[god] || ''}`,
      options: [{ value: 1, label: '神啊…' }], lines: [],
    };
    gainIden(g);
    skillExp(g, 181, 0, 1000, 6, 1000);
    ev.lines.push('信仰技能获得了经验。');
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 12 マテリアルの発見 / 23 夢の中の収穫 ============ */
  function materials(g, value, title, text) {
    const ev = { id: 0, title, text, options: [{ value: 1, label: '好' }], lines: [] };
    gainIden(g);
    const id = (Elona.ItemDB && Elona.ItemDB.pickCand) ? Elona.ItemDB.pickCand(g, value, { t637: 0, t638: 0, t639: 0 }) : 0;
    if (id) {
      const it = giveItem(g, id, 1, 0);
      ev.lines.push(it ? `获得了素材：${itemName(id)}。` : '背包满了，素材掉在了地上。');
    } else {
      ev.lines.push('捡到了一些素材。');
    }
    ask(g, ev);
    return finish(g, ev);
  }
  H[12] = (g) => {
    const e = materials(g, V(g, 578) || 100, '素材的发现', '被石头绊倒的瞬间，你发现了几样素材。');
    e.id = 12; gainTravExp(g); return e;
  };
  H[23] = (g) => { const e = materials(g, 200, '梦中的收获', '梦里，你悠闲地采集着素材。'); e.id = 23; return e; };

  /* ============ 36 原因は何だ？（274780-274938）============ */
  H[36] = function (g, st) {
    const slot = st.v2083;
    const c = chara(g, slot);
    if (!c) return null;
    const nm = nameOf(c);
    const milkSlot = (() => {
      const p = g.player;
      if (!p.inv) return -1;
      for (let i = 0; i < p.inv.length; i++) {
        const it = p.inv[i];
        if (it && (it.id | 0) === 574 && (it.f[0] | 0) >= 1) return i;
      }
      return -1;
    })();
    const milkCount = milkSlot >= 0 ? (g.player.inv[milkSlot].f[0] | 0) : 0;
    const ev = {
      id: 36, title: '原因是什么？', text: `${nm} 突然开始大哭！`,
      options: [
        { value: 1, label: '放着不管' },
        { value: 2, label: '哄他' },
        { value: 3, label: '一起哭' },
        { value: 4, label: `喂奶（持有 ${milkCount}）` },
      ], lines: [],
    };
    // 274815-274824：正确答案
    let want = 1;
    if ((c.get(182) | 0) <= 0) want = 2;
    if ((c.get(50) | 0) < idiv((c.get(51) | 0) * 9, 10)) want = 3;
    if ((c.get(22) | 0) <= 5000) want = 4;
    ask(g, ev);
    const sel = ev.selected;
    if (sel === 4) {
      if (milkCount === 0) {
        ev.lines.push('你试着自己想办法，但并没有那么顺利地产出奶来。');
        modImp(c, -10, g);
        return finish(g, ev);
      }
      g.player.inv[milkSlot].f[0] = milkCount - 1;
      if ((g.player.inv[milkSlot].f[0] | 0) <= 0) g.player.inv[milkSlot] = null;
      c.set(22, (c.get(22) | 0) + 1000);
      if (want !== 4) {
        ev.lines.push(`喝了一点，但他并不是特别想喝奶。`);
      } else {
        ev.lines.push(`${nm} 喝了奶后突然安静下来……打了个小嗝。`);
        modImp(c, 10, g);
        modImp2(c, 10, g);
      }
      return finish(g, ev);
    }
    if (sel === want) {
      const lines = {
        1: `${nm} 突然停止了哭泣。到底是什么呢……？`,
        2: `一开始哄，${nm} 就立刻不哭了。……已经在笑了！`,
        3: `${nm} 开始轻轻拍你。……是想安慰你吗？`,
      };
      ev.lines.push(lines[sel] || `${nm} 安静下来了。`);
      if (sel === 1) modImp2(c, 10, g);
      else if (sel === 2) modImp(c, 10, g);
      else modImp(c, 10, g);
    } else {
      const lines = {
        1: `${nm} 一直哭到哭累了为止……`,
        2: `不管是抱起来还是唱摇篮曲，${nm} 都完全不肯停止哭泣……`,
        3: `${nm} 睁大眼睛呆住了。`,
      };
      ev.lines.push(lines[sel] || `${nm} 还在哭。`);
      if (sel === 1) modImp2(c, -10, g);
      else if (sel === 2) modImp2(c, -10, g);
      else modImp(c, -10, g);
    }
    return finish(g, ev);
  };

  /* ============ 37 子供の自己表現（274939-275025）============ */
  H[37] = function (g, st) {
    const c = chara(g, st.v2083);
    if (!c) return null;
    const nm = nameOf(c);
    const ev = {
      id: 37, title: '孩子的自我表达', text: `${nm} 突然坐下，开始耍赖！`,
      options: [
        { value: 1, label: '放着不管' },
        { value: 2, label: '听他说' },
        { value: 3, label: '就这么拖走' },
        { value: 4, label: '给 500 gold 零花钱' },
      ], lines: [],
    };
    ask(g, ev);
    if (ev.selected === 1) { ev.lines.push(`${nm} 在地上滚了一会儿，判断没用之后停了下来。`); modImp(c, -5, g); modImp2(c, 5, g); }
    if (ev.selected === 2) { ev.lines.push(`${nm} 用贫乏的词汇拼命想传达心情……`); modImp(c, 5, g); }
    if (ev.selected === 3) { ev.lines.push(`${nm} 一边哭一边反过来想拖走你……`); modImp2(c, -5, g); }
    if (ev.selected === 4) {
      const p = g.player;
      if ((p.get(30) | 0) < 500) {
        ev.lines.push(`${nm} 注意到你的钱包很瘪，很有礼貌地拒绝了。`);
        modImp2(c, -5, g);
      } else {
        p.set(30, (p.get(30) | 0) - 500);
        ev.lines.push(`${nm} 高兴地开始数金币！希望他别上瘾……`);
        modImp(c, 5, g); modImp2(c, -5, g);
      }
    }
    return finish(g, ev);
  };

  /* ============ 38-46 孩子的日常（275026-275884）============ */
  const CHILD_DREAM = ['世界最强', '火车头', '副驾驶', '圣诞老人', '发明家', '英雄', '花店老板', '加州卷'];
  H[38] = function (g, st) {
    const c = chara(g, st.v2083); if (!c) return null;
    const nm = nameOf(c);
    let best = 10, val = 0;
    for (let s = 10; s <= 17; s++) { const v = c.skill ? (c.skill(s) | 0) : 0; if (v > val) { val = v; best = s; } }
    const dream = CHILD_DREAM[best - 10];
    const ev = {
      id: 38, title: '将来的梦想', text: `${nm} 说将来想成为${dream}……`,
      options: [{ value: 1, label: '真是个好梦想' }, { value: 2, label: '认真考虑一下吧' }, { value: 3, label: '为了能实现而学习吧' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) { ev.lines.push(`${nm}「嘿嘿嘿……」「模仿我的梦想也可以哦！」`); modImp(c, 5, g); modImp2(c, -5, g); }
    if (ev.selected === 2) { ev.lines.push(`${nm}「我是认真的！」「不行吗？」`); modImp(c, -5, g); }
    if (ev.selected === 3) { ev.lines.push(`${nm}「那我算了」「诶——？」`); }
    return finish(g, ev);
  };
  const CHILD_TREASURE = ['光滑的小石子', '某个东西的螺丝', '蝉蜕', '鲜艳的落叶', '谜之绒毛', '掉落的羽毛', '揪下的花瓣', '西瓜虫'];
  H[39] = function (g, st) {
    const c = chara(g, st.v2083); if (!c) return null;
    const nm = nameOf(c);
    let best = 10, val = 0;
    for (let s = 10; s <= 17; s++) { const v = c.skill ? (c.skill(s) | 0) : 0; if (v > val) { val = v; best = s; } }
    const tr = CHILD_TREASURE[best - 10];
    const ev = {
      id: 39, title: '发现宝物', text: `${nm} 满脸笑容地递给你${tr}……`,
      options: [{ value: 1, label: '加入收藏' }, { value: 2, label: '收下然后偷偷扔掉' }, { value: 3, label: '别捡垃圾了去学习' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) { ev.lines.push(`${nm}「不给你哦！？」「只是给你看看！只是看看！」`); modImp(c, -5, g); }
    if (ev.selected === 2) { ev.lines.push(`${nm}「要好好珍惜哦♪」「找它可费劲了！」`); modImp(c, 5, g); }
    if (ev.selected === 3) { ev.lines.push(`${nm}「对不起……」「明明不是垃圾……」`); modImp2(c, 5, g); }
    return finish(g, ev);
  };
  H[40] = function (g, st) {
    const c = chara(g, st.v2083); if (!c) return null;
    const nm = nameOf(c);
    const ev = {
      id: 40, title: '自己的根源', text: `${nm} 想知道自己是从哪里来的……`,
      options: [{ value: 1, label: '是基因组合生出来的' }, { value: 2, label: '是鹳鸟送来的' }, { value: 3, label: '是从桥下捡来的' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) ev.lines.push(`${nm}「基因……？？？」「听不懂！」`);
    if (ev.selected === 2) { ev.lines.push(`${nm}「鹳鸟是从哪里把我送来的？」「绝对是骗人的～」`); modImp(c, -5, g); }
    if (ev.selected === 3) { ev.lines.push(`${nm}「震惊！」「我、我不是这个家的孩子！？」`); modImp2(c, -5, g); }
    return finish(g, ev);
  };
  H[41] = function (g, st) {
    const c = chara(g, st.v2083); if (!c) return null;
    const nm = nameOf(c);
    const ev = {
      id: 41, title: '脑内战斗', text: `${nm} 似乎在和幻想中的敌人战斗……`,
      options: [{ value: 1, label: '算是想象训练吧…' }, { value: 2, label: '要在现实世界里努力' }, { value: 3, label: '要打就该学战斗' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) ev.lines.push(`${nm}「呔！」「还挺有两下子！」`);
    if (ev.selected === 2) { ev.lines.push(`${nm}「明明是好地方……」「可、可是……」`); modImp(c, -5, g); }
    if (ev.selected === 3) { ev.lines.push(`${nm}「太无聊了不要」「那种东西学战术技能就够了！」`); modImp2(c, -5, g); }
    return finish(g, ev);
  };
  H[42] = function (g, st) {
    const c = chara(g, st.v2083); if (!c) return null;
    const nm = nameOf(c);
    const ev = {
      id: 42, title: '这个世界是画布', text: `${nm} 默默地在地上画画……`,
      options: [{ value: 1, label: '品味不错' }, { value: 2, label: '最后要好好擦掉' }, { value: 3, label: '要不要正经学画画？' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) { ev.lines.push(`${nm}「好害羞」「不要随便看啦——」`); modImp(c, 5, g); }
    if (ev.selected === 2) { ev.lines.push(`${nm}「那种事我知道啦」「那我现在就擦掉！」`); modImp(c, -5, g); }
    if (ev.selected === 3) { ev.lines.push(`${nm}「学习？算了」「我又不是想画得多好」`); modImp2(c, -5, g); }
    return finish(g, ev);
  };
  H[43] = function (g, st) {
    const c = chara(g, st.v2083); if (!c) return null;
    const nm = nameOf(c);
    const ev = {
      id: 43, title: '学习的意义', text: `${nm} 追问为什么小孩子必须学习！`,
      options: [{ value: 1, label: '为了增加将来的选择' }, { value: 2, label: '长大了也要为工作学习' }, { value: 3, label: '因为孩子笨父母会丢脸' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) ev.lines.push(`${nm}「不太明白意思……」「反正我要当冒险者，没关系吧」`);
    if (ev.selected === 2) { ev.lines.push(`${nm}「我以为长大了就不用学习了」「有些东西只能现在学吗……」`); modImp2(c, 5, g); }
    if (ev.selected === 3) { ev.lines.push(`${nm}「大人总是这样……！你把孩子当成什么了！？」`); modImp(c, -5, g); }
    return finish(g, ev);
  };
  H[44] = function (g, st) {
    const c = chara(g, st.v2083); if (!c) return null;
    const nm = nameOf(c);
    const ev = {
      id: 44, title: '自我炫耀', text: `${nm} 似乎在自己给自己起外号……`,
      options: [{ value: 1, label: '先改变自己再谈称呼' }, { value: 2, label: '一起帮他想' }, { value: 3, label: '去学习增加词汇量' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) ev.lines.push(`${nm}「意义不明」「我要练决胜姿势，你去那边」`);
    if (ev.selected === 2) { ev.lines.push(`${nm}「品味太老土了，算了」「好烦，走开！」`); modImp2(c, -5, g); }
    if (ev.selected === 3) { ev.lines.push(`${nm}「学习学习，吵死了」「你有资格说教吗？」`); modImp(c, -5, g); }
    return finish(g, ev);
  };
  H[45] = function (g, st) {
    const c = chara(g, st.v2083); if (!c) return null;
    const nm = nameOf(c);
    const ev = {
      id: 45, title: '自我意识', text: `${nm} 担心自己的打扮是不是比周围人土……`,
      options: [{ value: 1, label: '有那么奇怪吗？' }, { value: 2, label: '我觉得有个性很好' }, { value: 3, label: '要学学时尚吗？' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) { ev.lines.push(`${nm}「算了……」「找错商量对象了」`); modImp2(c, -5, g); }
    if (ev.selected === 2) { ev.lines.push(`${nm}「太有个性会被笑的！」「我不想和别人差太多……」`); modImp(c, -5, g); }
    if (ev.selected === 3) { ev.lines.push(`${nm}「我能做到吗……？」「既然你这么说，我试试看」`); modImp(c, 5, g); }
    return finish(g, ev);
  };
  H[46] = function (g, st) {
    const c = chara(g, st.v2083); if (!c) return null;
    const nm = nameOf(c);
    const ev = {
      id: 46, title: '边缘人', text: `${nm} 强烈主张不要把他当小孩！`,
      options: [{ value: 1, label: '大人有相应的责任和义务' }, { value: 2, label: '说这种话就还是小孩' }, { value: 3, label: '看来是学习不够' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) ev.lines.push(`${nm}「不要用难懂的词糊弄我……」「……大人也很辛苦吗？」`);
    if (ev.selected === 2) { ev.lines.push(`${nm}「别把我当傻子！」「真的大人就算被当小孩也能面不改色吗？」`); modImp(c, -5, g); }
    if (ev.selected === 3) ev.lines.push(`${nm}「边缘人是指存在于多个集团边界上的人……」「我要学到什么程度你才承认我是大人？」`);
    return finish(g, ev);
  };

  /* ============ 10 野営跡の発見（275885-275925）============ */
  H[10] = function (g) {
    const ev = {
      id: 10, title: '发现野营痕迹',
      text: '你发现有人在此野营过的痕迹。周围散落着吃剩的东西和杂物。说不定能找到些有用的东西。',
      options: [{ value: 1, label: '调查' }, { value: 2, label: '离开' }], lines: [],
    };
    gainIden(g);
    gainTravExp(g);
    ask(g, ev);
    if (ev.selected === 1) {
      const id = (Elona.ItemDB && Elona.ItemDB.pickCand)
        ? Elona.ItemDB.pickCand(g, limit(plevel(g), 1, 50), { t637: 0, t638: 0, t639: 0 })
        : 0;
      if (id) {
        const it = giveItem(g, id, 1, 0);
        ev.lines.push(it ? `有什么东西滚到了脚边（${itemName(id)}）。` : '背包满了，东西掉在了地上。');
      } else {
        ev.lines.push('什么也没找到。');
      }
    } else {
      ev.lines.push('你决定不去碰它。');
    }
    return finish(g, ev);
  };

  /* ============ 4 不気味な夢（275926-275995）============ */
  H[4] = function (g) {
    const ev = {
      id: 4, title: '诡异的梦',
      text: '你做了一个诡异的梦。阴沉的无数只眼睛凝视着你，不知从何处传来笑声。「咯咯咯……找到你了……咯咯」'
        + '你翻了两下身，梦就结束了。',
      options: [{ value: 1, label: '奇怪的梦' }], lines: [],
    };
    gainIden(g);
    const p = g.player;
    let hit = 0;
    if (Elona.Status && Elona.Status.findbuff && Elona.Status.findbuff(p, 60) === -1) {
      for (const base of [13, 15, 19]) {
        const sk = base;
        if ((p.skill ? p.skill(sk) : 0) <= 0) continue;
        const cur = p.get(240 + (sk - 10)) | 0;
        const pot = p.skill ? (p.skill(sk) | 0) : 0;
        if (pot - cur > 0) {
          p.set(240 + (sk - 10), cur - (idiv(pot, 3) + 5));
          hit++;
        }
      }
    }
    if (!hit) ev.lines.push('好像什么也没发生。');
    else ev.lines.push('某个技能的潜在能力下降了。');
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 22 怪物の夢（275996-276019）============ */
  H[22] = function (g) {
    const ev = {
      id: 22, title: '怪物的梦',
      text: '你在和怪物战斗。正要挥剑砍向丑陋的怪物时，怪物发出了惨叫。「我就是你！你就是我！」'
        + '你被自己的呻吟声惊醒了。',
      options: [{ value: 1, label: '呜…嗯…' }], lines: [],
    };
    gainIden(g);
    const id = (Elona.ItemDB && Elona.ItemDB.pickCand) ? Elona.ItemDB.pickCand(g, 100, { t637: 0, t638: 0, t639: 0 }) : 0;
    if (id) giveItem(g, id, 1, 0);
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 35 奇妙な階段の夢（276020-276235）============ */
  const DREAM_STAGE = [
    {
      title: '奇妙楼梯的梦',
      text: '你一丝不挂地独自站在昏暗的楼梯中间。楼梯上方是无边的黑暗，看不见尽头……'
        + '楼梯很远的下方，能看到像火焰一样的灯光在微微摇曳。',
      options: [{ value: 1, label: '下楼梯看看' }, { value: 2, label: '还是别靠近比较好' }, { value: 3, label: '全裸最棒！' }],
      go: '你走完楼梯，发现了一个洞窟。在那里你的意识中断了。',
    },
    {
      title: '奇妙洞窟的梦',
      text: '你一丝不挂地站在一个奇妙洞窟前。背后是昏暗的楼梯。洞窟两侧，火焰诡异地摇曳着。',
      options: [{ value: 1, label: '进去看看' }, { value: 2, label: '去别处找找' }, { value: 3, label: '全裸万岁！' }],
      go: '你小心翼翼地走进洞窟。途中，你的意识中断了。',
    },
    {
      title: '奇妙二人组的梦',
      text: '你一丝不挂地在洞窟里前进。但一对打扮陌生的二人组出现了，挡在你面前。他们像在打量你。',
      options: [{ value: 1, label: '想要衣服' }, { value: 2, label: '太、太羞耻了' }, { value: 3, label: '你们也脱啊！' }],
      go: '他们用熟练的手法递给你衣服和道具，催你往前走。你就这样走到了洞窟出口，意识中断了。',
    },
    {
      title: '奇妙长楼梯的梦',
      text: '你站在洞窟出口。洞窟前方是一眼望不到头的长楼梯，一直向下延伸……',
      options: [{ value: 1, label: '下楼梯看看' }, { value: 2, label: '有话想问二人组' }, { value: 3, label: '不需要衣服！' }],
      go: '楼梯有几百级。走完之后，你的意识中断了。',
    },
    {
      title: '奇妙之门的梦',
      text: '你站在一扇紧闭的门前。背后是长长的楼梯。在朦胧的意识中，你感觉到这扇门是某种巨大的境界。',
      options: [{ value: 1, label: '向门后前进' }, { value: 2, label: '再往前感觉有危险' }, { value: 3, label: '破坏这扇门！' }],
      go: '你下定决心，把手放在门上。门后的光景是……',
    },
  ];
  H[35] = function (g) {
    const stage = limit(V(g, SLOT.DREAM), 0, 4);
    const d = DREAM_STAGE[stage];
    const ev = { id: 35, title: d.title, text: d.text, options: d.options.slice(), lines: [] };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) {
      if (stage === 4) {
        ev.lines.push(d.go);
        ev.lines.push('……你在晨光中醒来，感到某种东西已经不同了。');
        S(g, SLOT.DREAM, 0);
      } else {
        ev.lines.push(d.go);
        S(g, SLOT.DREAM, stage + 1);
      }
    } else if (ev.selected === 2) {
      ev.lines.push('你警惕着，没有动……');
      if (stage > 0) S(g, SLOT.DREAM, stage - 1);
    } else {
      ev.lines.push('你任由解放感驱使，跳了起来、滚来滚去！');
      skillExp(g, 13, 0, 300, 0, 0);
    }
    return finish(g, ev);
  };

  /* ============ 34 羊の悪夢（276236-276305）============ */
  H[34] = function (g) {
    const ev = {
      id: 34, title: '羊的噩梦',
      text: '你被羊群围住了。放眼望去，尽是些颜色诡异的羊。到处响着咩咩的叫声，吵得要命……',
      options: [{ value: 1, label: '数羊' }, { value: 2, label: '扑向羊群' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (ev.selected === 1) {
      ev.lines.push('一只羊……两只羊……');
      if (R(g, 25) === 0) {
        ev.lines.push('数着数着，你和一只紫色的羊对上了眼。');
        ev.lines.push('对上眼了。');
        addBuff(g, g.player, 11, 99999, 666);
      } else {
        ev.lines.push('数着数着，你陷入了深深的睡眠……');
        skillExp(g, 173, 0, 1000, 0, 0);
      }
    } else {
      if (R(g, 2) === 0) {
        ev.lines.push('被袭击的羊群……突然乘风飞起，像蒲公英的绒毛一样飞走了。');
      } else {
        ev.lines.push('正要扑上去的瞬间，一只巨大的貘出现了。貘把逃跑的羊一只只吃光，吃完就消失了。');
      }
    }
    return finish(g, ev);
  };

  /* ============ 33 繋がる夢廻廊（276306-276346）============ */
  H[33] = function (g) {
    let slot = -1;
    for (let i = 1; i < 16; i++) {
      const c = chara(g, i);
      if (!c) continue;
      if ((c.get(0) | 0) === 0 && (c.get(17) | 0) < 100 && R(g, 10) === 0) { slot = i; break; }
    }
    if (slot <= 0) return null;
    const c = chara(g, slot);
    const nm = nameOf(c);
    const ev = {
      id: 33, title: '相连的梦回廊',
      text: `${nm} 出现在你的梦里。因为是梦，你们聊了平时说不出的话，做了平时做不到的事，气氛很热烈。`,
      options: [{ value: 1, label: '开心！' }], lines: [],
    };
    gainIden(g);
    modImp(c, 20, g);
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 32 胡蝶の夢（276347-276376）============ */
  H[32] = function (g) {
    const ev = {
      id: 32, title: '蝴蝶之梦',
      text: '梦中的你是另一副模样。你在眺望你自己的生活。梦中的你坚信这里就是现实。'
        + '你正看着电脑屏幕读着文字……并没有察觉到，另一个你正在看着这一切。',
      options: [{ value: 1, label: '这是现实' }, { value: 2, label: '这是梦' }, { value: 3, label: '你是谁？' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    if (Elona.Status && Elona.Status.dmgsan) Elona.Status.dmgsan(g.player, 50, g);
    else if (typeof g.player.san === 'number') g.player.san = Math.max(0, g.player.san - 50);
    ev.lines.push('你的精神受到了一些伤害。');
    if (R(g, 5) === 0) { skillExp(g, 15, 0, 1000, 0, 0); ev.lines.push('意志技能获得了经验。'); }
    return finish(g, ev);
  };

  /* ============ 25 添い寝 / 26 強制添い寝（276377-277069）============ */
  function bedPartner(g, st) {
    if (st.v2083 > 0) return st.v2083;
    for (let i = 1; i < 16; i++) {
      const c = chara(g, i);
      if (c && cb(c, 962) === 1 && (c.get(0) | 0) === 1) return i;
    }
    return 0;
  }
  H[25] = function (g, st) {
    const slot = bedPartner(g, st);
    const c = chara(g, slot);
    if (!c) return null;
    if (st.v2084 === 2000) st.v2084 = 0;
    const nm = nameOf(c);
    const ev = {
      id: 25, title: '同床',
      text: `你忽然醒了过来。身边是 ${nm}。`,
      options: [
        { value: 1, label: '不在意继续睡' },
        { value: 2, label: '赶下去' },
        { value: 3, label: '温柔地抚摸' },
        { value: 4, label: '轻轻抱住' },
        { value: 5, label: '在耳边低语' },
        { value: 6, label: '撒个娇' },
      ], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    const rel = (v) => { c.set(182, limit((c.get(182) | 0) + v, 0, 200)); };
    switch (ev.selected) {
      case 1: ev.lines.push('感觉像被轻轻拍打，但你没在意，继续睡了。'); break;
      case 2: ev.lines.push(`${nm} 滚来滚去，最后去了别处。`); rel(-10); break;
      case 3: ev.lines.push(`${nm} 自己蹭了过来。`); rel(15); break;
      case 4: ev.lines.push(`${nm} 的身体很热……`); rel(20); break;
      case 5: ev.lines.push(`${nm} 沉默地听着你的话……`); rel(10); break;
      case 6: ev.lines.push(`${nm} 抱住你，在你耳边说了些什么……`); rel(10); break;
    }
    ev.lines.push(`（亲密度 ${c.get(182) | 0}）`);
    return finish(g, ev);
  };
  H[26] = function (g, st) {
    const slot = bedPartner(g, st);
    const c = chara(g, slot);
    if (!c) return null;
    if (st.v2084) st.v2084 = 0;
    const nm = nameOf(c);
    const ev = {
      id: 26, title: '被迫同床',
      text: `要怎么办呢。${nm} 就在床上。`,
      options: [
        { value: 1, label: '放着不管自己睡' },
        { value: 2, label: '让他跪下道歉' },
        { value: 3, label: '让他舔你的手' },
        { value: 4, label: '扇一巴掌' },
        { value: 5, label: '揉揉他' },
      ], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    const rel = (v) => c.set(182, limit((c.get(182) | 0) + v, 0, 200));
    const fear = (v) => c.set(169, limit((c.get(169) | 0) + v, 0, 400));
    const stronger = () => (R(g, Math.max(1, g.player.skill ? g.player.skill(10) : 1)) >
      R(g, Math.max(1, c.skill ? c.skill(10) : 1)));
    switch (ev.selected) {
      case 1: ev.lines.push('你无视他，自己睡了。'); break;
      case 2:
        if ((c.get(169) | 0) >= 200 || stronger()) { ev.lines.push(`${nm} 不明所以地一个劲道歉。`); modImp2(c, 5, g); rel(10); }
        else { ev.lines.push(`${nm} 拒绝了，但你强行让他道歉。`); modImp2(c, 3, g); rel(15); modImp(c, -5, g); }
        fear(1);
        break;
      case 3:
        if ((c.get(169) | 0) >= 200 || stronger()) { ev.lines.push(`${nm} 战战兢兢地开始照做。`); modImp2(c, 8, g); rel(15); }
        else { ev.lines.push(`${nm} 拒绝了，你强行让他照做。`); modImp2(c, 8, g); rel(10); modImp(c, -2, g); }
        break;
      case 4:
        if ((c.get(169) | 0) >= 200) { ev.lines.push(`${nm} 默默忍着。`); modImp2(c, 10, g); rel(35); fear(1); }
        else if (stronger()) { ev.lines.push(`你按住 ${nm}，强行动手。`); modImp2(c, 15, g); rel(30); modImp(c, -15, g); }
        else { ev.lines.push(`${nm} 拼命抵抗了！`); modImp2(c, 5, g); rel(15); }
        break;
      case 5:
        if ((c.get(169) | 0) >= 200) { ev.lines.push(`${nm} 乖乖地任你抚摸……`); modImp2(c, 2, g); rel(10); }
        else if (stronger()) { ev.lines.push(`${nm} 挣扎起来，你按住他继续。`); modImp2(c, 2, g); rel(15); modImp(c, -2, g); }
        else { ev.lines.push(`${nm} 嫌恶地挣扎了！`); rel(5); }
        break;
    }
    if ((c.get(182) | 0) >= 100) {
      ev.lines.push(`${nm} 再也忍耐不住，逃走了！`);
      modImp(c, -5, g);
      rel(-100);
      modKarma(g, -5);
    }
    ev.lines.push(`（亲密度 ${c.get(182) | 0}）`);
    return finish(g, ev);
  };

  /* ============ 19 宝を埋める夢 / 20 幸運の日 / 21 運命の気まぐれ ============ */
  H[19] = function (g) {
    const ev = { id: 19, title: '埋宝的梦', text: '你在梦里埋下了宝物。你立刻跳起来，把地点写在了纸上。', options: [{ value: 1, label: '哇哦' }], lines: [] };
    gainIden(g);
    const it = giveItem(g, 621, 1, 0);
    ev.lines.push(it ? `你把${itemName(621)}放进了背包。` : '背包满了。');
    ask(g, ev);
    return finish(g, ev);
  };
  H[20] = function (g) {
    const ev = { id: 20, title: '幸运的一天', text: '喵呜喵呜喵！', options: [{ value: 1, label: '哇哦' }], lines: [] };
    gainIden(g);
    addBuff(g, g.player, 19, 777, 1500);
    ev.lines.push('你感到幸运降临了。');
    ask(g, ev);
    return finish(g, ev);
  };
  H[21] = function (g) {
    const ev = { id: 21, title: '命运的反复无常', text: '喵呜？被你找到了！', options: [{ value: 1, label: '哇哦' }], lines: [] };
    gainIden(g);
    const it = giveItem(g, 721, 1, 0);
    ev.lines.push(it ? `你把${itemName(721)}放进了背包。` : '背包满了。');
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 5 呪いのつぶやき（277142-277189）============ */
  H[5] = function (g) {
    const ev = {
      id: 5, title: '诅咒的低语',
      text: '不知从何处传来的诅咒低语，妨碍了你的睡眠。',
      options: [{ value: 1, label: '睡不着…' }], lines: [],
    };
    gainIden(g);
    ask(g, ev);
    const p = g.player;
    const pray = (p.skill ? (p.skill(181) | 0) : 0) > 0;
    if (pray && R(g, 2) === 0) {
      ev.lines.push('你献上祈祷，消除了诅咒的低语。');
    } else {
      let cursed = 0;
      if (p.inv) {
        for (const it of p.inv) {
          if (!it || (it.f[0] | 0) <= 0) continue;
          if ((it.f[2] | 0) === 0) { cursed = 1; break; }
        }
      }
      if (cursed) ev.lines.push('身上某件装备被诅咒了。');
      else if (Elona.Event && Elona.Event.add) { Elona.Event.add(26); ev.lines.push('某种不好的东西缠上了你。'); }
      else ev.lines.push('一阵寒意掠过。');
    }
    return finish(g, ev);
  };

  /* ============ 8 悪意ある手（277190-277234）============ */
  H[8] = function (g) {
    const ev = {
      id: 8, title: '恶意之手',
      text: '一只怀着恶意的手悄悄伸来，在你没察觉时偷走了金币。',
      options: [{ value: 1, label: '可恶的小偷…' }], lines: [],
    };
    gainIden(g);
    gainTravExp(g);
    ask(g, ev);
    const p = g.player;
    let loss = R(g, idiv(p.get(30) | 0, 8) + 1);
    if (cb(p, 15)) loss = 0;
    if (loss > 0) {
      p.set(30, (p.get(30) | 0) - loss);
      ev.lines.push(`损失了 ${loss} 枚金币。`);
    } else {
      ev.lines.push('没有损失。');
    }
    return finish(g, ev);
  };

  /* ============ 11 冒険者の遺骸（277235-277294）============ */
  H[11] = function (g) {
    const ev = {
      id: 11, title: '冒险者的遗骸',
      text: '你在这个地方发现了力尽而亡的冒险者遗骸。已经快要腐朽的骨头，和几件像是他身上装备的东西散落着。',
      options: [{ value: 1, label: '搜刮' }, { value: 2, label: '埋葬' }], lines: [],
    };
    gainIden(g);
    gainTravExp(g);
    ask(g, ev);
    const p = g.player;
    if (ev.selected === 1) {
      ev.lines.push('你搜刮了遗物。');
      modKarma(g, -2);
      const id = (Elona.ItemDB && Elona.ItemDB.pickCand) ? Elona.ItemDB.pickCand(g, limit(plevel(g), 1, 80), { t637: 0, t638: 0, t639: 0 }) : 0;
      if (id) {
        const it = giveItem(g, id, 1, 0);
        ev.lines.push(it ? `有什么东西滚到了脚边（${itemName(id)}）。` : '背包满了。');
      }
    } else {
      ev.lines.push('你把骨头和遗物埋葬了。');
      modKarma(g, 5);
    }
    void p;
    return finish(g, ev);
  };

  /* ============ 2 魔法使いの夢（277295-277317）============ */
  H[2] = function (g) {
    const ev = {
      id: 2, title: '魔法师的梦',
      text: '梦中你遇到了一位红发的魔法师。「谁啊，你这家伙？唔，看来我闯进了错误的梦中。抱歉。作为赔礼……」'
        + '魔法师转了转手指。你感到一阵轻微的头痛。',
      options: [{ value: 1, label: '奇怪的梦' }], lines: [],
    };
    gainIden(g);
    const id = (Elona.ItemDB && Elona.ItemDB.pickCand) ? Elona.ItemDB.pickCand(g, 100, { t637: 0, t638: 0, t639: 0 }) : 0;
    if (id) {
      const it = giveItem(g, id, 1, 0);
      ev.lines.push(it ? `获得了${itemName(id)}。` : '背包满了。');
    }
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 3 成長のきざし（277318-277356）============ */
  H[3] = function (g) {
    const ev = {
      id: 3, title: '成长的征兆',
      text: '长年锻炼的成果似乎结出了果实。难以入眠、一直在思考的你，忽然对自身的技术有了新的想法。',
      options: [{ value: 1, label: '好！' }], lines: [],
    };
    gainIden(g);
    const p = g.player;
    const cand = [];
    for (let s = 0; s < 400; s++) {
      if (s >= 10 && s < 20 && (p.skill ? p.skill(s) : 0) > 0) cand.push(s);
    }
    if (cand.length && Elona.Stats && Elona.Stats.modGrowth) {
      const s = cand[R(g, cand.length)];
      Elona.Stats.modGrowth(p, s, 0, 15, g);
      ev.lines.push('某个技能的潜在能力上升了。');
    }
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 6 自然治癒力の向上 / 7 瞑想力の向上 ============ */
  H[6] = function (g) {
    const ev = {
      id: 6, title: '自然治愈力提升',
      text: '身体莫名发烫，你醒了过来。回过神时，手臂上的伤疤已经完全消失了。',
      options: [{ value: 1, label: '好' }], lines: [],
    };
    gainIden(g);
    skillExp(g, 154, 0, 1000, 0, 0);
    ev.lines.push('治愈技能获得了经验。');
    ask(g, ev);
    return finish(g, ev);
  };
  H[7] = function (g) {
    const ev = {
      id: 7, title: '瞑想力提升',
      text: '即使在梦中你也保持着惊人的理性。就像在冥想时一样，你感到了心灵的平和。',
      options: [{ value: 1, label: '好' }], lines: [],
    };
    gainIden(g);
    skillExp(g, 155, 0, 1000, 0, 0);
    ev.lines.push('冥想技能获得了经验。');
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 9 路上に転がる幸運（277397-277423）============ */
  H[9] = function (g) {
    const ev = {
      id: 9, title: '滚落路边的幸运',
      text: '低头走路时，你幸运地发现了一枚白金币。',
      options: [{ value: 1, label: '幸运！' }], lines: [],
    };
    const p = g.player;
    p.set(31, (p.get(31) | 0) + 1);
    gainIden(g);
    gainTravExp(g);
    ev.lines.push('获得了 1 枚白金币。');
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 16 発狂した金持ち（277424-277456）============ */
  H[16] = function (g) {
    const ev = {
      id: 16, title: '发狂的富翁',
      text: '一个发狂的富翁一边叫喊着什么，一边撒着金币……',
      options: [{ value: 1, label: '幸运！' }], lines: [],
    };
    const p = g.player;
    const gold = limit(R(g, idiv((p.get(30) | 0) + 1, 10) + 1), 100, 99999) + 20 * luck(g);
    p.set(30, (p.get(30) | 0) + gold);
    gainIden(g);
    gainTravExp(g);
    ev.lines.push(`获得了 ${gold} 枚金币。`);
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 17 辻プリースト（277457-277486）============ */
  H[17] = function (g) {
    const ev = {
      id: 17, title: '路边的神官',
      text: '突然，一位从对面走来的神官在擦肩而过时对你施了魔法。「No problem.」',
      options: [{ value: 1, label: '谢谢' }], lines: [],
    };
    const p = g.player;
    if (Elona.Spell && Elona.Spell.heal) Elona.Spell.heal(g, p, 800);
    else if (typeof p.hp === 'number') p.hp = Math.min(p.hpMax || p.hp + 800, p.hp + 800);
    gainIden(g);
    gainTravExp(g);
    ev.lines.push('你的伤势被治好了。');
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 56 旅の途中で / 海の波間に（277487-278134）============ */
  const SCENE_ACTOR_SEA = ['水手', '船长', '海水浴客', '街的孩子', '观光客', '海盗', '老人', '败残兵', '粗野的海盗', '海盗枪手'];
  const SCENE_ACTOR_LOST = ['旅人', '学者', '丘之子', '阿尔凯', '佣兵战士', '佣兵射手', '佣兵魔术师', '盗贼团的保镖', '盗贼团的杀手', '盗贼团的术士'];
  const SCENE_ACTOR_TOWN = [
    '市民', '贵族', '街的孩子', '朋克', '佣兵', '乞丐', '老人', '败残兵', '农夫', '矿夫',
    '清扫员', '流氓', '娼妇', '艺术家', '卫兵', '温泉迷', '情报屋', '吟游诗人', '观光客', '推销员',
  ];
  const SCENE_MON_SEA = ['梦魇鲨', '海妖克拉肯', '枪鱼', '飞鱼', '魔鬼鱼', '挑衅乌贼', '海豚战士', '猥琐海葵'];
  const SCENE_MON_LAND = [
    '蜗牛', '寄居蟹', '蝙蝠', '小猪', '野兔', '羊', '飞蛙', '猎犬', '巨大松鼠', '杀人松鼠',
    '眼镜蛇', '蝎子', '花斑蜘蛛', '猫', '狗', '老鼠', '鸡', '野马', '地痞', '牧羊犬',
    '普奇', '红普奇', '狗头人', '伊克', '兽人', '曼德拉草', '史莱姆', '大蝙蝠', '骷髅', '僵尸',
    '食人鬼', '哥布林', '狼', '熊', '火蜥蜴',
  ];
  const SCENE_TREE = ['冷杉', '白蜡树', '椰子树', '榉树', '枯木', '果树', '杉树', '山毛榉'];
  const SCENE_DRINK = ['可乐', '麦茶', '绿茶', '挥发油', '食盐水', '媚药', '奶', '啤酒', '威士忌', '克里姆艾尔', '污水'];
  const SCENE_DRAGON = [
    '绿龙', '红龙', '白龙', '电气龙', '冥界龙', '混沌龙', '鲸头鹳', '打击鹰', '哈耳庇厄', '箭鸭',
    '邪长尾雀', '飞龙', '黑狮鹫', '朱雀',
  ];
  const SCENE_ADJ = [
    '奇怪发型的', '样子可疑的', '濒死的', '伤痕累累的', '血淋淋的', '美丽的', '面色苍白的',
    '插着箭的', '流着鼻涕的', '瘦骨嶙峋的', '疲惫不堪的', '已经死了的',
  ];
  const SCENE_SEA_LINES = [
    (a, m, d, t, adj) => `一群海豚正把 ${adj}${a} 抛来抛去地玩耍……`,
    (a, m, d, t, adj) => `你看见 ${a} 正咬住暴怒的 ${m}……`,
    (a, m, d, t, adj) => `海面上只露出 ${a} 的双腿，${d} 看了两眼……`,
    (a, m, d, t, adj) => `一只头上插着 ${a} 的鲸鱼正在喷水……`,
    (a, m, d, t, adj) => `叼着河豚的 ${m} 正在纠缠 ${a}……`,
    (a, m, d, t, adj) => `你看见 ${a} 骑在 ${m} 上挥舞着剑……`,
    (a, m, d, t, adj) => `${a} 想骑上海豚，结果被尾巴狠狠打中要害……`,
    (a, m, d, t, adj) => `${a} 和一群不明团体一起在揍鲨鱼……`,
    (a, m, d, t, adj) => `${a} 想从海獭那里抢贝壳，被石头砸了……`,
    (a, m, d, t, adj) => `在水面上奔跑的忍者被浮上来的 ${m} 绊倒，沉了下去……`,
    (a, m, d, t, adj) => `跳起来的 ${m} 把飞着的 ${d} 击落了……`,
    (a, m, d, t, adj) => `${adj}${a} 被白色的手拖进海里消失了……`,
  ];
  const SCENE_LAND_LINES = [
    (a, m, d, t, adj, dr) => `路边，${a} 正在向 ${m} 求饶……`,
    (a, m, d, t, adj, dr) => `想偷偷拿走 ${t} 的 ${a}，被 ${m} 举报了……`,
    (a, m, d, t, adj, dr) => `${a} 把 ${t} 扔掉了……`,
    (a, m, d, t, adj, dr) => `${m} 不知为何正对着 ${t} 威吓……`,
    (a, m, d, t, adj, dr) => `${m} 和 ${a} 一边喝 ${dr} 一边跳舞……`,
    (a, m, d, t, adj, dr) => `${adj}${a} 抱着 ${t} 在模仿蝉鸣……`,
    (a, m, d, t, adj, dr) => `${adj}${a} 四肢着地和 ${m} 一起嚎叫……`,
    (a, m, d, t, adj, dr) => `${adj}${a} 正猛烈地跳着走……`,
    (a, m, d, t, adj, dr) => `路边喝 ${dr} 的 ${a} 突然发光，然后炸成了碎片……`,
    (a, m, d, t, adj, dr) => `${a} 从 ${t} 上把 ${dr} 浇到了 ${m} 头上，${m} 正在闹……`,
    (a, m, d, t, adj, dr) => `${adj}${a} 们正要从你面前横穿过去……`,
    (a, m, d, t, adj, dr) => `${adj}${a} 正在把筷子插进地面……`,
    (a, m, d, t, adj, dr) => `${adj}${a} 正在大口吃着某种肉……`,
    (a, m, d, t, adj, dr) => `趴着的 ${m} 正咬着 ${t}……`,
    (a, m, d, t, adj, dr) => `叼着骨头的 ${m} 正被骷髅战士拼命追赶……`,
    (a, m, d, t, adj, dr) => `${a} 把 ${t} 夹在屁股里，右手食指挖着鼻孔，左手打着拳……`,
    (a, m, d, t, adj, dr) => `${a} 正手舞足蹈地做体操……`,
    (a, m, d, t, adj, dr) => `${a} 正在练习模仿 ${m}……水准相当高。`,
    (a, m, d, t, adj, dr) => `${adj}${a} 头上套着奇怪的东西被卫兵带走了……`,
  ];
  const SCENE_LOST_EXTRA = [
    (a, m, d, t, adj) => `撞上大陆结界的 ${d} 被弹开，坠落下去了……`,
    (a, m, d, t, adj) => `${adj}${a} 被 ${d} 一把抓住，带去了某处……`,
    (a, m, d, t, adj) => `下半身埋在地里的 ${a} 正被 ${m} 和 ${d} 啄着……`,
    (a, m, d, t, adj) => `${a} 被 ${d} 的粪便轰炸，受了伤……`,
  ];
  H[56] = function (g) {
    const rid = V(g, 20);
    let actors, mons, extra = null;
    if (rid === 47) { actors = SCENE_ACTOR_SEA; mons = SCENE_MON_SEA; }
    else if (rid === 70) { actors = SCENE_ACTOR_LOST; mons = SCENE_MON_LAND; extra = SCENE_LOST_EXTRA; }
    else { actors = SCENE_ACTOR_TOWN; mons = SCENE_MON_LAND; }
    const a = pick(g, actors), m = pick(g, mons), d = pick(g, SCENE_DRAGON);
    const t = pick(g, SCENE_TREE), adj = pick(g, SCENE_ADJ), dr = pick(g, SCENE_DRINK);
    let line;
    if (rid === 47) {
      line = pick(g, SCENE_SEA_LINES)(a, m, d, t, adj);
    } else {
      line = pick(g, SCENE_LAND_LINES)(a, m, d, t, adj, dr);
    }
    if (extra && R(g, 6) === 0) line = pick(g, extra)(a, m, d, t, adj);
    const ev = {
      id: 56,
      title: rid === 47 ? '在海浪之间' : '旅途之中',
      text: line,
      options: [{ value: 1, label: rid === 47 ? '海真辽阔啊' : '还是不要牵扯进去为好' }], lines: [],
    };
    S(g, SLOT.IDEN, V(g, SLOT.IDEN) + 7);
    S(g, SLOT.TRAVEXP, V(g, SLOT.TRAVEXP) + 7);
    ev.lines.push(`灵感 +7（当前 ${V(g, SLOT.IDEN)}）。`);
    ev.lines.push(`旅经验 +7（当前 ${V(g, SLOT.TRAVEXP)}）。`);
    ask(g, ev);
    return finish(g, ev);
  };

  /* ============ 47 荒れ狂う海（278135-278195）============ */
  H[47] = function (g) {
    const ether = V(g, SLOT.WEATHER) === 1;
    const ev = {
      id: 47, title: '狂暴之海',
      text: '像惨叫般的轰鸣，摇动身体的波浪振动……仿佛恶魔带来的狂风之中，你低声嘟囔。',
      options: [{ value: 1, label: ether ? '以太之风' : '好大的雷雨' }], lines: [],
    };
    gainIden(g);
    gainTravExp(g);
    ask(g, ev);
    const p = g.player;
    const dur = p.get(197) | 0;
    if (dur > 0) {
      p.set(197, dur - 1);
      if ((p.get(197) | 0) <= 0) {
        ev.lines.push('浪墙压碎了一切，在你祈祷之前船就被大海吞没了。');
        S(g, SLOT.SHIP, 0);
        for (const slot of companionSlots(g)) {
          const c = chara(g, slot);
          if ((c.get(259) | 0) < 5) {
            if (Elona.Status && Elona.Status.wet) Elona.Status.wet(g, c, 5);
            c.set(263, (c.get(263) | 0) + 10);
          }
        }
      } else {
        ev.lines.push(`船体受损（耐久 ${p.get(197)}）。`);
      }
    } else {
      ev.lines.push('这次总算平安度过了。');
    }
    return finish(g, ev);
  };

  /* ============ 55 大漁の予感（278196-278314）============ */
  const SEA_FISH = {
    11: [348, 349], 36: [349, 350], 93: [354, 347], 54: [351, 345], 53: [352, 353],
  };
  H[55] = function (g) {
    const ev = {
      id: 55, title: '大渔的预感',
      text: '看得见鱼群……现在的话能捕到大量的鱼！',
      options: [{ value: 1, label: '开始捕鱼' }, { value: 2, label: '离开' }], lines: [],
    };
    gainIden(g);
    gainTravExp(g);
    ask(g, ev);
    if (ev.selected === 1) {
      if (invFree(g) === -1) {
        ev.lines.push('背包满了。');
      } else {
        const sea = idiv(V(g, SLOT.SEA), 100);
        const table = SEA_FISH[sea] || [348, 349];
        let count = R(g, 6) + 8;
        if (V(g, SLOT.SHIP) === 2) count = R(g, 11) + 16;
        const id = pick(g, table);
        giveItem(g, id, count, 0);
        ev.lines.push(`一转眼就捕到了 ${count} 条${itemName(id)}。`);
        if (V(g, SLOT.SHIP) === 2) ev.lines.push('你用了渔船网。');
      }
    } else {
      ev.lines.push('你放过了鱼群。');
    }
    return finish(g, ev);
  };

  /* ============ 53 謎の船影（278315-278419）============ */
  H[53] = function (g) {
    const ship = V(g, SLOT.SHIP);
    const ev = {
      id: 53, title: '神秘的船影',
      text: '前方发现了船影。从这里看不出是什么船。',
      options: [{ value: 1, label: '靠近看看' }, { value: 3, label: '离开' }], lines: [],
    };
    if (ship === 3 || ship >= 5) ev.options.splice(1, 0, { value: 2, label: '总之先发制人' });
    gainIden(g);
    gainTravExp(g);
    ask(g, ev);
    if (ev.selected === 1) {
      let hostile = 0;
      if (R(g, Math.max(1, 22 - limit(idiv((V(g, 80) + 1) * 15, V(g, 82) + 1), 5, 20))) === 0) hostile = 1;
      ev.lines.push(hostile ? '对方是海盗船！战斗开始了。' : '对方似乎是商船。');
      if (hostile) {
        S(g, 26, 7);            // var_65(26) = 7：进入船战（*label_2459 未移植，见 02 A39x）
      }
    } else if (ev.selected === 2) {
      if (ship === 3 || ship === 5 || ship === 6) {
        ev.lines.push(ship === 6 ? '鱼雷命中！对方的船耐久下降了。' : '炮击命中！对方的船耐久下降了。');
      } else {
        ev.lines.push('船被攻击惊到，慌忙逃走了。');
      }
    } else {
      ev.lines.push('你离开了。');
    }
    return finish(g, ev);
  };

  /* ============ 48/49/50 漂流者（278420-278688）============ */
  function drifter(g, opt) {
    const ev = {
      id: opt.id, title: opt.title, text: opt.text,
      options: [{ value: 1, label: opt.abandonLabel }], lines: [],
    };
    const ship = V(g, SLOT.SHIP);
    const crew = V(g, SLOT.CREW);
    const cap = opt.cap;
    if (crew < cap) ev.options.push({ value: 2, label: '让他上船' });
    if (opt.itemId && hasItem(g, opt.itemId)) ev.options.push({ value: 3, label: opt.throwLabel });
    gainIden(g);
    gainTravExp(g);
    ask(g, ev);
    if (ev.selected === 1) {
      ev.lines.push(opt.abandonText);
      modKarma(g, -(opt.karma || 1));
    } else if (ev.selected === 2) {
      const n = opt.many ? (3 + R(g, 8)) : 1;
      const room = Math.max(0, cap - crew);
      const take = Math.min(n, room);
      S(g, SLOT.CREW, crew + take);
      ev.lines.push('「谢谢！」');
      if (take < n) ev.lines.push('「再也上不来了吗……真遗憾。」');
      ev.lines.push('把他们平安送到陆地吧。');
    } else {
      consumeItem(g, opt.itemId, 1);
      ev.lines.push(opt.throwText);
    }
    void ship;
    return finish(g, ev);
  }
  function hasItem(g, id) {
    const p = g.player;
    if (!p || !p.inv) return false;
    return p.inv.some((it) => it && (it.id | 0) === id && (it.f[0] | 0) >= 1);
  }
  function consumeItem(g, id, n) {
    const p = g.player;
    if (!p || !p.inv) return false;
    for (let i = 0; i < p.inv.length; i++) {
      const it = p.inv[i];
      if (it && (it.id | 0) === id && (it.f[0] | 0) >= n) {
        it.f[0] = (it.f[0] | 0) - n;
        if (it.f[0] <= 0) p.inv[i] = null;
        return true;
      }
    }
    return false;
  }
  const SHIP_CAP = 20;   // var_1289：船的载员上限（源码取自船等级表，本项目取 20）
  H[48] = (g) => drifter(g, {
    id: 48, title: '被冲走的人',
    text: '你在浪间发现了一个挣扎的漂流者。「被大浪卷走，一路漂到这里来了！」',
    abandonLabel: '见死不救', abandonText: '「怎么这样……」',
    throwLabel: '扔一个救生圈然后离开', throwText: '「能得救……可是！？」',
    itemId: 409, cap: SHIP_CAP,
  });
  H[49] = (g) => drifter(g, {
    id: 49, title: '逃脱之后',
    text: '你发现了一个乘着小木筏的漂流者。「我从无人岛自力逃出来了，但已经到极限了……」',
    abandonLabel: '见死不救', abandonText: '「太、太过分了」',
    throwLabel: '扔一份旅粮然后离开', throwText: '「就让我靠这个撑下去！？」',
    itemId: 333, cap: SHIP_CAP,
  });
  H[50] = (g) => drifter(g, {
    id: 50, title: '漂流者们',
    text: '你发现了好几名漂流者。「船沉了，就变成这样了……」',
    abandonLabel: '一起见死不救', abandonText: '「魔鬼……」',
    throwLabel: '扔一个救生圈然后离开', throwText: '「让开！是我的！」「还有孩子啊！？」',
    itemId: 409, cap: SHIP_CAP, many: true, karma: 3,
  });

  /* ============ 51 上空の脅威 / 52 海中の脅威（278689-278851）============ */
  function seaThreat(g, opt) {
    const ship = V(g, SLOT.SHIP);
    const ev = {
      id: opt.id, title: opt.title, text: opt.text,
      options: [{ value: 1, label: '紧急撤离' }, { value: 2, label: opt.fightLabel }], lines: [],
    };
    gainIden(g);
    gainTravExp(g);
    ask(g, ev);
    const p = g.player;
    const power = opt.id === 51 ? (ship === 3 || ship === 5) : (ship >= 5);
    const ok = R(g, Math.max(1, ship * 2)) > R(g, 10);
    if (ev.selected === 1) {
      if (ok) ev.lines.push('在受到大损伤之前成功逃走了。');
      else {
        ev.lines.push('好不容易逃掉了，但船受了不小的损伤。');
        p.set(197, (p.get(197) | 0) - 1);
      }
    } else {
      if (power) ev.lines.push(opt.winText);
      else {
        ev.lines.push('好歹打退了，但船受了不小的损伤。');
        p.set(197, (p.get(197) | 0) - 1);
      }
    }
    if ((p.get(197) | 0) <= 0) {
      ev.lines.push('接连的损伤之下，你的船终于大破了。');
      S(g, SLOT.SHIP, 0);
    }
    return finish(g, ev);
  }
  H[51] = (g) => seaThreat(g, {
    id: 51, title: '上空的威胁',
    text: '天空突然变暗，船连续受到冲击……你向外看去，映入眼帘的是……海鸟。'
      + '巨大的海鸟成群结队地袭击了船！',
    fightLabel: '好好迎接它们', winText: '在受到大损伤之前用大炮赶走了它们。',
  });
  H[52] = (g) => seaThreat(g, {
    id: 52, title: '海中的威胁',
    text: '突然，船像被从海中顶起一样剧烈摇晃……你凝神看向海里，目睹了鲨鱼正在撞击船底！',
    fightLabel: '想把它做成鱼翅', winText: '在受到大损伤之前用鱼雷炸死了鲨鱼。',
  });

  // ---------------------------------------------------------------- 执行
  /**
   * 执行一次事件。全部 56 个 id（1-57，无 54）都有实现；
   * 返回 null 表示该事件的前置条件不成立（源码里走 *label_2618 / return）。
   */
  function dispatch(g, id, st) {
    st = st || stateOf(g);
    const fn = H[id | 0];
    if (!fn) return null;
    return fn(g, st);
  }

  const RandomEvent = {
    SLOT, MAP_SLOT, State,
    handlers: H,
    /** 可选：宿主注入选项 UI。签名 (g, ev) => 选中的 value；返回 0 表示用默认值 */
    chooser: null,
    stateOf,
    tickHour,
    dispatch,
    choose,
    mapKind,
    mapVar,
    setMapVar,
    has(id) { return !!H[id | 0]; },
    /** 已实现的事件 id 列表 */
    ids() { return Object.keys(H).map((k) => k | 0).sort((a, b) => a - b); },
    /**
     * 就寝时的小时推进（311894-311906）：每小时一次，等价于 var_577 == 9。
     * @returns {object[]} 本轮触发的事件
     */
    sleepHours(g, hours) {
      const out = [];
      const n = Math.max(0, hours | 0);
      for (let i = 0; i < n; i++) {
        const ev = tickHour(g, { sleeping: true });
        if (ev) out.push(ev);
      }
      return out;
    },
    /** 醒来后的强制事件链（312243-312255） */
    wakeChain(g) {
      const out = [];
      const hour = V(g, SLOT.HOUR);
      const push = (force) => {
        const ev = tickHour(g, { sleeping: true, force });
        if (ev) out.push(ev);
      };
      push(1);
      if (hour >= 4 && hour <= 9) push(100);
      if (hour >= 4 && hour <= 12) push(200);
      if (hour >= 4 && hour <= 12) push(300);
      return out;
    },
  };

  Elona.RandomEvent = RandomEvent;
})(typeof window !== 'undefined' ? window : globalThis);
