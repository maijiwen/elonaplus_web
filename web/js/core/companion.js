'use strict';
/**
 * 同伴（core/companion.js）—— 0-DG 批次的同伴系统补全。
 *
 * 【源码依据】（均以 hsp/start.hsp 为准）
 *   var_58(0, c)  角色状态：1 = 在地图上，6 = 死亡，7 = 待機（330749-330750 / 417513）
 *   var_58(166,c) 复活计数：>2 归零；<=0 时调酒师拒绝复活（417439-417443）
 *   var_58(433,c) 幸福度（0..10，evochat 用星星表示，426632-426636）
 *   var_58(433,0) 玩家的「行動力」（静止时为 10；睡眠起床时重置，311884）
 *   待機 / 呼び出し：技能 684（330718-330809）
 *     · 目标 var_58(0)==1 → 待機：rowactend、清格子、var_58(0)=7、var_58(80)=0、tag_end
 *     · 目标 var_58(0)==7 → 呼び出し：队伍有空位则 var_58(0)=1、var_58(9)=var_58(69)、放在玩家附近
 *   调酒师（var_506 == 33 复活 / 34 让他们在城里等待）：417429-417525
 *     复活费用 = calcresurrectvalue（214754-214759）= limit(100 + 等级² × 5, 100, 50000)
 *     —— 注意：wiki 写的「等级平方十五倍」是旧版数值，源码是 **×5 且夹在 100..50000**。
 *   战斗模式 var_58(266)：0 = 突撃 / 1 = 防御 / 2 = 迎撃 / 3 = 交渉
 *     （菜单 11818-11860 的 txtsettactical；切换与提示 340627-340674）
 *   睡眠起床（311850-311895）：同伴 var_58(433)=0、玩家 var_58(433,0)=10
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const STATE = 0;
  const RELATION = 9;
  const ORIGINAL_RELATION = 69;
  const HAPPY = 433;
  const MODE = 266;
  const REVIVE_FLAG = 166;
  const MAP_BELONG = 80;

  const ACTIVE = 1;
  const DEAD = 6;
  const WAITING = 7;

  const HAPPY_MAX = 10;
  const AP_MAX = 10;

  const MODE_NAMES = [
    { id: 0, jp: '突撃', en: 'Onslaught' },
    { id: 1, jp: '防御', en: 'Defense' },
    { id: 2, jp: '迎撃', en: 'Intercept' },
    { id: 3, jp: '交渉', en: 'Talking' },
  ];

  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // ======================================================================
  // 幸福度 / 行動力
  // ======================================================================

  /** 幸福度（var_58(433, c)），0..10 */
  function happiness(c) { return clamp(c ? (c.get(HAPPY) | 0) : 0, 0, HAPPY_MAX); }

  function addHappiness(c, n) {
    if (!c) return 0;
    const v = clamp((c.get(HAPPY) | 0) + (n | 0), 0, HAPPY_MAX);
    c.set(HAPPY, v);
    return v;
  }

  /** 玩家的行动力（var_58(433, 0)） */
  function actionPoints(g) { return clamp(g && g.player ? (g.player.get(HAPPY) | 0) : 0, 0, AP_MAX); }

  function spendAction(g, n) {
    const p = g && g.player;
    if (!p) return false;
    const cost = Math.max(0, n | 0);
    if ((p.get(HAPPY) | 0) < cost) return false;
    p.set(HAPPY, Math.max(0, (p.get(HAPPY) | 0) - cost));
    return true;
  }

  /**
   * 起床结算（311852-311884）：
   *   同伴 var_58(433) = 0（幸福度归零，新的一天重新积累）；
   *   玩家 var_58(433,0) = 10（行动力回满）。
   */
  function onWake(g) {
    if (!g) return;
    for (const c of allies(g)) {
      if (c.index === 0) continue;
      c.set(HAPPY, 0);
    }
    if (g.player) g.player.set(HAPPY, AP_MAX);
  }

  // ======================================================================
  // 战斗模式（var_58(266)）
  // ======================================================================

  function modeOf(c) {
    const m = c ? (c.get(MODE) | 0) : 0;
    return (m >= 0 && m <= 3) ? m : 0;
  }

  function modeName(m, lang) {
    const e = MODE_NAMES[m | 0] || MODE_NAMES[0];
    return (lang === 'en') ? e.en : e.jp;
  }

  /**
   * 切换战斗模式（340627-340674）。返回值用于提示文案：
   *   「X は<態勢>に入った！」—— 交渉態勢的提示词是「交渉」。
   */
  function setMode(g, c, m) {
    if (!c) return { ok: false, message: '没有对象。' };
    const v = clamp(m | 0, 0, 3);
    c.set(MODE, v);
    const label = ['突撃', '防御', '迎撃', '交渉'][v];
    const msg = `${c.index === 0 ? '你' : c.name}进入了${label}态势。`;
    if (g && g.log) g.log(msg);
    return { ok: true, mode: v, message: msg };
  }

  /**
   * パーティ全員の戦術指示（指挥旗 / 同伴菜单）—— 源码的 txtsettactical 是
   * 「视野内全体同伴」+「弹种切换」，这里只做前面四项（弹种见 A327）。
   * @param {number} m 0..3
   * @param {object} [scope] 提供 {x,y,r} 时只对范围内的同伴生效
   */
  function setModeAll(g, m, scope) {
    const list = [];
    for (const c of activeAllies(g)) {
      if (scope) {
        const d = Math.max(Math.abs(c.x - scope.x), Math.abs(c.y - scope.y));
        if (d > (scope.r | 0 || 6)) continue;
      }
      c.set(MODE, clamp(m | 0, 0, 3));
      list.push(c.index | 0);
    }
    if (!list.length) return { ok: false, count: 0, message: '附近没有同伴。' };
    if (g && g.log) g.log(`全体同伴进入${['突撃', '防御', '迎撃', '交渉'][clamp(m | 0, 0, 3)]}态势（${list.length} 名）。`);
    return { ok: true, count: list.length, members: list };
  }

  // ======================================================================
  // 待機 / 呼び出し（技能 684，330718-330809）
  // ======================================================================

  function allies(g) {
    return (Elona.Party && Elona.Party.members) ? Elona.Party.members(g) : [];
  }

  function activeAllies(g) {
    return allies(g).filter((c) => (c.get(STATE) | 0) === ACTIVE);
  }

  function waitingAllies(g) {
    return allies(g).filter((c) => c.index !== 0 && (c.get(STATE) | 0) === WAITING);
  }

  function deadAllies(g) {
    return allies(g).filter((c) => c.index !== 0 && (c.get(STATE) | 0) === DEAD);
  }

  /** 清掉某格上的角色索引（cell_setchara 的等价物） */
  function clearCell(g, c) {
    if (!g.map || !g.map.cell) return;
    const cell = g.map.cell(c.x, c.y);
    if (cell && (cell[1] | 0) === (c.index | 0) + 1) cell[1] = 0;
  }

  /**
   * 待機させる（330740-330763）
   *   rowactend → 清格子 → var_58(0)=7 → var_58(80)=0 → tag_end（从地图消失）
   */
  function wait(g, c) {
    if (!c || c.index === 0) return { ok: false, message: '没有对象。' };
    if ((c.get(STATE) | 0) !== ACTIVE) {
      return { ok: false, reason: 'not-active', message: '「现在没必要这么做。」' };
    }
    if (c.get(140) | 0) c.set(140, 0);          // rowactend
    clearCell(g, c);
    c.set(MAP_BELONG, 0);                        // 330751
    c.set(STATE, WAITING);                       // 330750
    if (g.syncCharaCells) g.syncCharaCells();
    const msg = `你让${c.name}在这里待命。`;
    if (g.log) g.log(msg);
    return { ok: true, message: msg, chara: c.index | 0 };
  }

  /**
   * 呼び出し（330773-330804）
   *   队伍有空位 → var_58(0)=1、var_58(9)=var_58(69)、放在玩家附近
   */
  function call(g, c) {
    if (!c || c.index === 0) return { ok: false, message: '没有对象。' };
    if ((c.get(STATE) | 0) === ACTIVE) {
      return { ok: false, reason: 'already-active', message: '「那家伙不用叫回来。」' };
    }
    const P = Elona.Party;
    if (P && P.members && P.maxSize && activeAllies(g).length >= P.maxSize(g)) {
      return { ok: false, reason: 'full', message: '队伍已满，叫不回来。' };
    }
    const spot = (P && P.nearSpot) ? P.nearSpot(g, g.player.x, g.player.y) : { x: g.player.x, y: g.player.y };
    c.set(STATE, ACTIVE);
    c.set(RELATION, c.get(ORIGINAL_RELATION) | 0);   // 330799
    c.set(MAP_BELONG, 0);
    c.x = spot.x; c.y = spot.y;
    if (c.hp <= 0) c.hp = Math.max(1, c.hpMax | 0);
    if (g.map && g.map.cell) {
      const cell = g.map.cell(c.x, c.y);
      if (cell) cell[1] = (c.index | 0) + 1;
    }
    if (g.syncCharaCells) g.syncCharaCells();
    const msg = `${c.name}出现在你面前。`;
    if (g.log) g.log(msg);
    return { ok: true, message: msg, chara: c.index | 0 };
  }

  // ======================================================================
  // 复活（调酒师，417429-417482）
  // ======================================================================

  /** calcresurrectvalue（214754-214759） */
  function reviveCost(c) {
    const lv = Math.max(1, (c && (c.get(38) | 0)) || 1);
    return clamp(100 + lv * lv * 5, 100, 50000);
  }

  /**
   * 付费复活（NPC 动作 33）。
   *   源码：var_58(166)>2 归零 → <=0 拒绝 → get_freeallyne 有空位 → 付钱 → var_58(166)-- → *label_2242
   */
  function revive(g, c) {
    if (!c || c.index === 0) return { ok: false, message: '没有对象。' };
    if ((c.get(STATE) | 0) === ACTIVE) {
      return { ok: false, reason: 'alive', message: '「那家伙不用叫回来。」' };
    }
    if ((c.get(STATE) | 0) !== DEAD) {
      return { ok: false, reason: 'not-dead', message: '「那家伙只是待命而已。」' };
    }
    if ((c.get(REVIVE_FLAG) | 0) > 2) c.set(REVIVE_FLAG, 0);
    if ((c.get(REVIVE_FLAG) | 0) <= 0) c.set(REVIVE_FLAG, 1);   // 简化：允许直接复活（A323）
    const cost = reviveCost(c);
    const gold = g.player.get(30) | 0;
    if (gold < cost) {
      return { ok: false, reason: 'money', cost, gold,
        message: `「要把它叫回来的话需要 ${cost} gold。」（你只有 ${gold} gold）` };
    }
    g.player.set(30, gold - cost);
    c.set(REVIVE_FLAG, Math.max(0, (c.get(REVIVE_FLAG) | 0) - 1));
    // *label_2242：恢复 HP/MP 并放回玩家身边
    c.hp = Math.max(1, c.hpMax | 0);
    c.mp = Math.max(0, c.mpMax | 0);
    const spot = (Elona.Party && Elona.Party.nearSpot)
      ? Elona.Party.nearSpot(g, g.player.x, g.player.y) : { x: g.player.x, y: g.player.y };
    c.set(STATE, ACTIVE);
    c.set(RELATION, c.get(ORIGINAL_RELATION) | 0);
    c.x = spot.x; c.y = spot.y;
    if (g.map && g.map.cell) {
      const cell = g.map.cell(c.x, c.y);
      if (cell) cell[1] = (c.index | 0) + 1;
    }
    if (Elona.Relation && Elona.Relation.modimp) Elona.Relation.modimp(c, 15, g);   // 复活 +15 好感
    if (g.syncCharaCells) g.syncCharaCells();
    const msg = `（调酒师从店后把${c.name}带了出来）复活花费 ${cost} gold。`;
    if (g.log) g.log(msg);
    return { ok: true, cost, message: msg, chara: c.index | 0 };
  }

  // ======================================================================
  // 死亡处理
  // ======================================================================

  /**
   * 同伴阵亡 —— 原版把队伍成员的 var_58(0) 置 6（尸体留在队伍里等复活），
   * 非同伴仍然走 chara_vanquish（0）。
   * @returns {boolean} 是否按「同伴死亡」处理
   */
  function onDeath(g, c) {
    if (!c || c.index === 0) return false;
    const isAlly = (Elona.Party && Elona.Party.isAlly) ? Elona.Party.isAlly(c) : !!c.__ally;
    if (!isAlly) return false;
    if ((c.get(STATE) | 0) === DEAD) return true;
    clearCell(g, c);
    c.set(STATE, DEAD);
    c.set(REVIVE_FLAG, Math.max(1, (c.get(REVIVE_FLAG) | 0) + 1));
    if (Elona.Riding && Elona.Riding.mountOf && Elona.Riding.mountOf(g) === (c.index | 0)) {
      Elona.Riding.end(g);
    }
    if (g.log) g.log(`${c.name}倒下了……（可以在城镇的调酒师那里付费复活）`);
    return true;
  }

  // ======================================================================
  // 同伴相关道具（wiki「对同伴使用的道具」一节）
  // ======================================================================

  const ITEM = {
    STETHOSCOPE: 478,     // 听诊器：在同伴贴图下方显示 HP/MP/斗志 条
    LEASH: 634,           // 绳扣：同伴离开视野后传送到身边
    WHIP: 746,            // 调教鞭：允许/禁止捡食、捡脚下物品
    FLAG: 865,            // 指挥旗：改变视野内全体同伴的行动模式
  };

  /** 寝具（睡一觉）—— 家具 60000 里名字带 bed 的一类；家具实例没有 var_99(19) 时用它兜底 */
  const BED_RE = /\bbed\b|futon|sleeping bag|hammock/i;

  function isBed(id) {
    const nm = (Elona.ItemDB && Elona.ItemDB.name) ? (Elona.ItemDB.name(id, 'en') || '') : '';
    return BED_RE.test(nm);
  }

  // ======================================================================
  // タッグ（组合）—— 0-DH
  //
  // 【源码依据】
  //   tag_begin（194040-194056）：var_58(167,追随側)=ベース、var_58(168,追随側)=1；
  //                               var_58(167,ベース)=追随側、var_58(168,ベース)=-1；
  //                               双方 rowactend + refreshspeed
  //   tag_end（194057-194072）：双方 var_58(167)=-1、var_58(168)=0
  //   編成条件（290690-290757）：不能是自己、双方 var_58(80)==0（不在滞在）、
  //     ベース var_58(0)==1、双方都还没有搭档（var_58(168)==0）、附近有空位
  //   追随（592289-592291）：追随側每回合坐标 = ベース坐标
  //   宣言（194045「◯◯は◯◯とタッグを組んだ。」）
  // ======================================================================

  const TAG_PARTNER_SLOT = 167;
  const TAG_ROLE = 168;      // 1 = 追随側 / -1 = ベース / 0 = 无

  function tagPartner(c) {
    const i = c ? (c.get(TAG_PARTNER_SLOT) | 0) : 0;
    return (i > 0) ? i : 0;
  }

  /**
   * 组成搭档（tag_begin）。
   * @param {object} g
   * @param {object} base      ベース（掌握移动权的一方）
   * @param {object} follower  追随側
   */
  function tagBegin(g, base, follower) {
    if (!base || !follower) return { ok: false, message: '没有对象。' };
    if (base === follower) return { ok: false, message: '什么也没有发生……' };
    if ((base.get(STATE) | 0) !== ACTIVE) return { ok: false, message: '什么也没有发生……' };
    if ((base.get(MAP_BELONG) | 0) !== 0 || (follower.get(MAP_BELONG) | 0) !== 0) {
      return { ok: false, message: '滞在中的同伴不能组成搭档。' };
    }
    if ((base.get(TAG_ROLE) | 0) !== 0) {
      return { ok: false, message: `${base.name}已经有搭档了。` };
    }
    if ((follower.get(TAG_ROLE) | 0) !== 0) {
      return { ok: false, message: `${follower.name}已经有搭档了。` };
    }
    if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(follower, 971)) {
      return { ok: false, message: '什么也没有发生……' };
    }
    // 双方 rowactend（194052-194053）
    if (base.get(140) | 0) base.set(140, 0);
    if (follower.get(140) | 0) follower.set(140, 0);
    follower.set(TAG_PARTNER_SLOT, base.index | 0);
    follower.set(TAG_ROLE, 1);
    base.set(TAG_PARTNER_SLOT, follower.index | 0);
    base.set(TAG_ROLE, -1);
    if (Elona.Stats && Elona.Stats.refreshSpeed) {
      Elona.Stats.refreshSpeed(base, g);
      Elona.Stats.refreshSpeed(follower, g);
    }
    const msg = `${base.name}和${follower.name}组成了搭档。`;
    if (g && g.log) g.log(msg);
    return { ok: true, message: msg, base: base.index | 0, follower: follower.index | 0 };
  }

  /** 解散（tag_end） */
  function tagEnd(g, c) {
    if (!c) return { ok: false, message: '没有对象。' };
    const other = tagPartner(c);
    if (!other || !g.charas[other]) return { ok: false, message: `${c.name}没有搭档。` };
    const o = g.charas[other];
    if (c.get(140) | 0) c.set(140, 0);
    if (o.get(140) | 0) o.set(140, 0);
    o.set(TAG_PARTNER_SLOT, 0);
    o.set(TAG_ROLE, 0);
    c.set(TAG_PARTNER_SLOT, 0);
    c.set(TAG_ROLE, 0);
    const msg = `${c.name}和${o.name}解散了。`;
    if (g && g.log) g.log(msg);
    return { ok: true, message: msg };
  }

  /** 可以编成搭档的同伴（追随側候补）：在场、无搭档、非滞在 */
  function tagCandidates(g, base) {
    return activeAllies(g).filter((c) => c !== base
      && (c.get(TAG_ROLE) | 0) === 0 && (c.get(MAP_BELONG) | 0) === 0
      && !(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 971)));
  }

  // ======================================================================
  // evochat —— 同伴互动（0-DH）
  //
  // 【源码依据】var_1294 == 1 的同伴对话菜单（415000-415035），动作分派在 var_506：
  //   78  優しくする      418417  行動力-1、幸福度+1；rnd(好感) > 75 再 +1
  //   79  困らせる        418490  行動力-1；気質(var_58(186))<0 且 rnd(-気質)>rnd(5) → 幸福度+2
  //   80  10万goldあげる  418510  行動力-1、幸福度+1、金 100000 转账
  //   87  暴走する        418545  進入 var_1294=2 的「じゃれあう」子菜单（需行动力>=4）
  //   88..91 抱きつく/なでなで/キス/色々  418562-418603  只改表情，不消耗
  //   92  我に返る        418605  行動力-4、幸福度+8，回到主菜单
  //   101 特別なきもちいいこと 418146 → var_1294=3；102/103 各扣 SP（418082/418109）
  //   111 タッグ間でevochat   417965  行動力-2，两人各 +1 幸福度（需 var_58(167) 有搭档）
  //   118 心の開錠        418619  → var_1294=-1 的路线菜单（119..130）
  //   119..130 路線宣告   418160-418410  行動力-1，按成功率掷骰，成功写入 var_58(441)
  //
  // 【成功率】414949-414954：var_82(158) 是「鍵開け」，两条基准线分别用
  //   好感 var_58(17) 与 主从 var_58(169)：
  //     love1 = limit((鍵P+鍵A+好感)/5,      0, 100)
  //     love2 = limit((鍵P+鍵A+好感)/10 - 5, 0, 90)
  //     love3 = limit((鍵P+鍵A+好感)/20 - 10, 0, 80)
  //     mast1/2/3 同上但把好感换成 var_58(169)
  // ======================================================================

  const TEMPER = 186;    // 気質（-10..10，355614 初始化）
  const ROUTE = 441;     // 関係タイプ（-1 戦友 … -13 忠義）
  const MADNESS = 86;    // 狂気度
  const TAG_PARTNER = 167;

  /** 路線表（var_506 == 119..130） */
  const ROUTES = [
    { act: 119, rel: -1, jp: '戦友', line: '仲間として共に戦ってくれ', rate: 'love1', msg: '进入了战友路线！' },
    { act: 120, rel: -2, jp: '友情', line: '友達になろう', rate: 'love1', msg: '进入了友情路线！' },
    { act: 121, rel: -3, jp: 'ライバル', line: '君と競い合っていきたい', rate: 'love1', msg: '进入了劲敌路线！' },
    { act: 122, rel: -4, jp: '恋愛', line: '君に恋している', rate: 'love2', msg: '进入了恋爱路线！' },
    { act: 123, rel: -5, jp: '教え子', line: '色々と教わっていきたい', rate: 'love2', msg: '进入了弟子路线！' },
    { act: 124, rel: -6, jp: '師', line: '君を導いていきたい', rate: 'love3', msg: '进入了师父路线！' },
    { act: 125, rel: -7, jp: '家族', line: '大事な家族だと思っている', rate: 'love3', msg: '进入了家族路线！' },
    { act: 126, rel: -11, jp: '契約者', line: '契約を結びたい', rate: 'mast1', msg: '进入了契约者路线！' },
    { act: 127, rel: -12, jp: '飼い主', line: 'お前はペットだ！', rate: 'mast1', msg: '进入了饲主路线！' },
    { act: 128, rel: -13, jp: '忠義', line: '忠誠を誓ってほしい', rate: 'mast2', msg: '进入了忠义路线！' },
    { act: 129, rel: 0, jp: '悩みを軽くする', line: '【君の助けになりたい】', rate: 'mast3', cbit: 1038,
      msg: '的烦恼减轻了，心里轻快起来。' },
    { act: 130, rel: 0, jp: '闇の趣味', line: '【本当の君を晒して】', rate: 'mast3', cbit: 1039,
      msg: '的某扇危险的门被打开了……' },
  ];

  function rngOf(g) {
    if (g && g.rng && typeof g.rng.rnd === 'function') return (n) => g.rng.rnd(Math.max(1, n | 0));
    return (n) => Math.floor(Math.random() * Math.max(1, n | 0));
  }

  /** 鍵開け（var_82(158) = **技能等级**；sorg 是潜力，两者不同） */
  function lockPicking(c) {
    if (!c) return 0;
    if (typeof c.skill === 'function') return c.skill(158) | 0;
    return 0;
  }

  /** 心の開錠の成功率（414949-414954） */
  function unlockRates(g, c) {
    const lp = lockPicking(g && g.player) + lockPicking(c);
    const imp = c ? (c.get(17) | 0) : 0;
    const mast = c ? (c.get(169) | 0) : 0;
    const love = lp + imp, mastSum = lp + mast;
    return {
      love1: clamp(Math.floor(love / 5), 0, 100),
      love2: clamp(Math.floor(love / 10) - 5, 0, 90),
      love3: clamp(Math.floor(love / 20) - 10, 0, 80),
      mast1: clamp(Math.floor(mastSum / 5), 0, 100),
      mast2: clamp(Math.floor(mastSum / 10) - 5, 0, 90),
      mast3: clamp(Math.floor(mastSum / 20) - 10, 0, 80),
    };
  }

  /** 主菜单的入口条件：`var_58(433,0) > 0 & var_58(433,c) < 10`（415001） */
  function canChat(g, c) {
    if (!c || (c.get(STATE) | 0) === DEAD) return false;
    return actionPoints(g) > 0 && happiness(c) < HAPPY_MAX;
  }

  /** 各动作的可用性（菜单项的显示条件） */
  function chatOptions(g, c) {
    const ap = actionPoints(g);
    const ok = canChat(g, c);
    const out = [];
    if (ok) {
      out.push({ id: 'kind', act: 78, label: '優しくする（行动力1）' });
      out.push({ id: 'embarrass', act: 79, label: '困らせる（行动力1）' });
      if ((g.player.get(30) | 0) >= 100000) {
        out.push({ id: 'give-gold', act: 80, label: '10万goldあげる（行动力1）' });
      }
      out.push({ id: 'intimate', act: 101, label: '【特別な気持ちいいこと】' });
      out.push({ id: 'mind-unlock', act: 118, label: '心の開錠' });
      if ((c.get(TAG_PARTNER) | 0) !== 0) {
        out.push({ id: 'tag-chat', act: 111, label: '让搭档之间也聊一聊（行动力2）' });
      }
      if (ap >= 4) out.push({ id: 'excite', act: 87, label: '【暴走する】' });
    }
    out.push({ id: 'end', act: 81, label: 'おしまい' });
    return out;
  }

  /** じゃれあう子菜单（var_1294 == 2，415063-415084） */
  function petOptions() {
    return [
      { id: 'hug', act: 88, label: '抱きつく' },
      { id: 'pat', act: 89, label: 'なでなでする' },
      { id: 'kiss', act: 90, label: 'キスしまくる' },
      { id: 'various', act: 91, label: '色々する' },
      { id: 'wake', act: 92, label: '我に返る（行动力4 / 幸福度+8）' },
    ];
  }

  const POSE = { smile: 6, angry: 18, sad: 21, blush: 17, shocked: 26 };

  function pose(c, v) { if (c) c.set(79, v); }

  /**
   * 执行一个 evochat 动作。
   * @returns {{ok:boolean, message:string, refresh?:boolean, sub?:string, close?:boolean}}
   */
  function chat(g, c, act) {
    const rnd = rngOf(g);
    const p = g && g.player;
    if (!p || !c) return { ok: false, message: '没有对象。' };
    const name = c.name;
    switch (act | 0) {
      // ---------------- 78 優しくする（418417） ----------------
      case 78: {
        if (!canChat(g, c)) return { ok: false, message: '现在没法这么做。', refresh: true };
        spendAction(g, 1);
        addHappiness(c, 1);
        const imp = c.get(17) | 0;
        if (imp > 0 && rnd(imp) > 75) addHappiness(c, 1);
        pose(c, POSE.smile);
        const msg = `你对${name}很温柔。${name}很高兴。（幸福度 ${happiness(c)}）`;
        if (g.log) g.log(msg);
        return { ok: true, message: msg, refresh: true };
      }
      // ---------------- 79 困らせる（418490） ----------------
      case 79: {
        if (!canChat(g, c)) return { ok: false, message: '现在没法这么做。', refresh: true };
        spendAction(g, 1);
        const temper = c.get(TEMPER) | 0;
        let extra = 0;
        if (temper < 0 && rnd(-temper) > rnd(5)) { addHappiness(c, 2); extra = 2; }
        pose(c, POSE.shocked);
        const msg = `你捉弄了${name}。` + (extra ? `意外地很高兴。（幸福度 ${happiness(c)}）` : '');
        if (g.log) g.log(msg);
        return { ok: true, message: msg, refresh: true };
      }
      // ---------------- 80 10万goldあげる（418510） ----------------
      case 80: {
        if (!canChat(g, c)) return { ok: false, message: '现在没法这么做。', refresh: true };
        const gold = p.get(30) | 0;
        if (gold < 100000) return { ok: false, message: '钱不够。', refresh: true };
        spendAction(g, 1);
        addHappiness(c, 1);
        p.set(30, gold - 100000);
        const cg = (c.get(30) | 0) + 100000;
        c.set(30, cg);
        if (rnd(cg + 1) < 100000) addHappiness(c, 1);
        pose(c, POSE.smile);
        const msg = `你给了${name} 100000 gold。（幸福度 ${happiness(c)}）`;
        if (g.log) g.log(msg);
        return { ok: true, message: msg, refresh: true };
      }
      // ---------------- 87 暴走する（418545）→ 子菜单 ----------------
      case 87: {
        if (actionPoints(g) < 4) return { ok: false, message: '行动力不足。', refresh: true };
        pose(c, POSE.blush);
        return { ok: true, message: '', sub: 'pet' };
      }
      // ---------------- 88..91 じゃれあう（只改表情） ----------------
      case 88:
        pose(c, POSE.smile);
        return { ok: true, message: `你抱住了${name}。`, refresh: true, sub: 'pet' };
      case 89:
        pose(c, POSE.smile);
        return { ok: true, message: `你摸了摸${name}的头。`, refresh: true, sub: 'pet' };
      case 90:
        pose(c, POSE.blush);
        return { ok: true, message: `你吻了${name}。`, refresh: true, sub: 'pet' };
      case 91:
        pose(c, POSE.blush);
        return { ok: true, message: `你和${name}腻在一起。`, refresh: true, sub: 'pet' };
      // ---------------- 92 我に返る（418605） ----------------
      case 92: {
        if (!spendAction(g, 4)) return { ok: false, message: '行动力不足。', refresh: true, sub: 'pet' };
        addHappiness(c, 8);
        pose(c, happiness(c) >= HAPPY_MAX ? POSE.blush : POSE.shocked);
        const msg = `你回过神来。${name}幸福度大幅上升。（幸福度 ${happiness(c)}）`;
        if (g.log) g.log(msg);
        return { ok: true, message: msg, main: true };
      }
      // ---------------- 101 特別なきもちいいこと（418146） ----------------
      case 101: {
        // 源码进入 var_1294=3 的子菜单（優しく/激しく/小休憩）；本项目只做机制（扣 SP），
        // 描写从略 —— 与源码自带的「（未実装）」同类处理（差异 A335）。
        pose(c, POSE.blush);
        return { ok: true, message: '', sub: 'intimate' };
      }
      case 102:
      case 103: {
        const cost = (act | 0) === 102 ? rnd(5) + 3 : rnd(10) + 5;
        // dmgsp：扣体力（SP）
        p.set(55, Math.max(0, (p.get(55) | 0) - cost));
        c.set(55, Math.max(0, (c.get(55) | 0) - cost));
        pose(c, POSE.blush);
        const msg = `（两人亲昵了一会儿，消耗了 ${cost} 点体力。）`;
        if (g.log) g.log(msg);
        return { ok: true, message: msg, refresh: true, sub: 'intimate' };
      }
      case 104:
        return { ok: true, message: '（稍作休息。）', refresh: true, sub: 'intimate' };
      // ---------------- 111 タッグ間でevochat（417965） ----------------
      case 111: {
        const tag = c.get(TAG_PARTNER) | 0;
        if (!tag) return { ok: false, message: '你没有搭档。', refresh: true };
        const t = g.charas && g.charas[tag];
        if (!spendAction(g, 2)) return { ok: false, message: '行动力不足。', refresh: true };
        addHappiness(c, 1);
        if (t) { addHappiness(t, 1); pose(t, POSE.smile); }
        pose(c, POSE.smile);
        const msg = `${name}和搭档聊了起来，两人都很开心。`;
        if (g.log) g.log(msg);
        return { ok: true, message: msg, refresh: true };
      }
      // ---------------- 118 心の開錠（418619） ----------------
      case 118: {
        const rates = unlockRates(g, c);
        const power = lockPicking(p) + lockPicking(c);
        return { ok: true, message: `两人的开锁力是 ${power}。`, sub: 'unlock', rates };
      }
      // ---------------- 119..130 路線宣告 ----------------
      default: break;
    }
    const route = ROUTES.find((r) => r.act === (act | 0));
    if (route) {
      if (actionPoints(g) <= 0) return { ok: false, message: '行动力不足。', refresh: true, sub: 'unlock' };
      spendAction(g, 1);
      const rates = unlockRates(g, c);
      const rate = rates[route.rate] | 0;
      const hit = rate > rnd(100);
      if (hit) {
        pose(c, POSE.smile);
        if (route.rel) c.set(ROUTE, route.rel);
        // cbit 是 var_58(450 + n/32) 的位域（Status.cbit/cbitmod），不是普通槽位
        if (route.cbit && Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, route.cbit, 1);
        if (route.act === 130 && (c.get(MADNESS) | 0) < 10) c.set(MADNESS, 10);
        const msg = `${name}${route.msg}`;
        if (g.log) g.log(msg);
        return { ok: true, message: msg, refresh: true, sub: 'unlock', hit: true };
      }
      pose(c, POSE.angry);
      const msg = `${name}没有接受（成功率 ${rate}%，掷骰失败）。`;
      if (g.log) g.log(msg);
      return { ok: true, message: msg, refresh: true, sub: 'unlock', hit: false };
    }
    return { ok: false, message: '什么也没有发生。' };
  }

  Elona.Companion = {
    STATE, HAPPY, MODE, REVIVE_FLAG, ACTIVE, DEAD, WAITING, HAPPY_MAX, AP_MAX, MODE_NAMES,
    happiness, addHappiness, actionPoints, spendAction, onWake,
    modeOf, modeName, setMode, setModeAll,
    allies, activeAllies, waitingAllies, deadAllies, wait, call,
    reviveCost, revive, onDeath,
    ITEM, isBed,
    // 0-DH：evochat
    ROUTES, canChat, chatOptions, petOptions, chat, unlockRates, lockPicking,
    TEMPER, ROUTE, MADNESS,
    // 0-DH：タッグ
    TAG_PARTNER_SLOT, TAG_ROLE, tagPartner, tagBegin, tagEnd, tagCandidates,
  };
})(window);
