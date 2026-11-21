'use strict';
/**
 * 公会（ギルド）—— 会员、排名、诺玛（quota）、交付、月度结算
 *
 * 源码依据（hsp/start.hsp）：
 *   364-375        guildname：var_65(263/264/265) → 公会名，263=法师 264=战士 265=盗贼
 *   319-333        ranktitle(cat)：var_65(cat+120)/100 → var_66(0..9, cat)，公会 cat=8 → var_65(128)
 *   376287-377324  三位会长的对话：脱退 / 【今月の一斉訓練】 / 投資 50 / 公会战
 *   377325-378182  三位番人（守卫）的对话：入会审查、领取诺玛、报告诺玛
 *   376366-376371  脱退时清 263/266/469/216
 *   377440-377470  法师公会加入：128=10000、263=1、266=0、216=1000
 *   377526-377537  法师诺玛 = 40 - var_65(128)/400（GP）
 *   377811        盗贼诺玛 = (10000 - var_65(128)) * 3 + 1000（金币）
 *   378092-378096  战士诺玛 = 1 座、类型 rnd(8)、层数 30 - var_65(128)/400
 *   377578        升级奖励：金货 10000 - rank + 500 + size*10，白金币 limit(4 - rank/2500, 1, 4)
 *   296860-298930  纳品箱（地图 36/56）：GP += (var_99(25) + 5) * 个数
 *   302355-302380  月替：未完成的诺玛清零（266/267/269）
 *   342269-342288  卖赃物：269 -= 售价
 *   376404-376450  一斉訓練：按公会规模给全员潜力（modgrowth 10..18），下次 30 天后
 *   376428-376443  投资 50：(limit(size+50,1,250)^2 + 500) * 20 金，size += 50
 *   609420-609440  通关随机奈菲亚：类型/层数达标时 267--
 *
 * 说明：加入 / 报告 / 脱退 / 训练 / 投资 这些**菜单流程本身**由已编译的
 * 对话脚本（talkscripts species 288/290/291/292/294/297）执行；本模块只提供
 * 脚本依赖的状态读写与几处**未编译区间**的补齐（交付、月替、通关计数）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const V = (g, n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);
  const S = (g, n, v) => { if (g && g.setV65) g.setV65(n, v | 0); };
  const idiv = (a, b) => Math.trunc((a | 0) / (b | 0));
  const limit = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

  /** 公会 id（对应源码 var_65(250+13/14/15)，263/264/265） */
  const MAGE = 1;
  const FIGHTER = 2;
  const THIEF = 3;

  const GUILDS = {
    [MAGE]: {
      id: MAGE, flag: 263, size: 207, task: 469,
      jp: '魔術士ギルド', ch: '法师公会', en: 'Mages Guild',
      town: '鲁米埃斯特', master: 288, guard: 290,
      joinText: '向公会的纳品箱上交解读书籍，攒够 15 公会点数后找番人审查。',
    },
    [FIGHTER]: {
      id: FIGHTER, flag: 264, size: 208, task: 470,
      jp: '戦士ギルド', ch: '战士公会', en: 'Fighters Guild',
      town: '卡普尔港', master: 291, guard: 297,
      joinText: '通关指定类型、指定层数以上的随机奈菲亚后找番人审查。',
    },
    [THIEF]: {
      id: THIEF, flag: 265, size: 209, task: 471,
      jp: '盗賊ギルド', ch: '盗贼公会', en: 'Thieves Guild',
      town: '达尔菲', master: 292, guard: 294,
      joinText: '把善恶值降到 -100 以下后找番人审查。',
    },
  };

  /** 关卡的公会状态槽（var_65） */
  const SLOT = {
    RANK: 128,        // 公会排名分（= 位次 × 100，越小越高）
    GP: 266,          // 法师：剩余公会点数
    NEFIA: 267,       // 战士：剩余通关座数
    NEFIA_LV: 268,    // 战士：要求的层数
    STOLEN: 269,      // 盗贼：还差多少金币的赃物
    NEFIA_TYPE: 693,  // 战士：要求的奈菲亚类型（+20 后与 map type 比较）
    WAR: 465,         // 盗贼下水道清理任务（250+215），不是公会战
  };

  /**
   * 公会战任务槽（var_65(250+247/249/248)）—— 源码 21292-21370。
   * 注意源码里三者的归属和「击杀哪个会长推进哪个槽」是交错的：
   *   法师公会战 = 497（250+247）：由战士会长(291)/盗贼会长(292)被杀推进
   *   战士公会战 = 499（250+249）：由法师会长(288)/盗贼会长(292)被杀推进
   *   盗贼公会战 = 498（250+248）：由法师会长(288)/战士会长(291)被杀推进
   * 即「除自己公会外的两个会长」之一被杀，就完成自己接下的公会战任务。
   * 状态：0 未接 / 1 已接（待暗杀）/ 2 已暗杀待报告 / >=1000 已完成。
   */
  const WAR_SLOT = { [MAGE]: 497, [FIGHTER]: 499, [THIEF]: 498 };
  /** 被杀会长 species → 推进的其它两个公会战槽（源码 200647-200702） */
  const MASTER_KILL = {
    288: [499, 498],   // 法师会长被杀 → 战士、盗贼的公会战达成
    291: [497, 498],   // 战士会长被杀 → 法师、盗贼
    292: [499, 497],   // 盗贼会长被杀 → 战士、法师
  };
  /** 公会大师 species（用于「目标」判断与复仇者） */
  const MASTER_SPECIES = { [MAGE]: 288, [FIGHTER]: 291, [THIEF]: 292 };

  function def(id) { return GUILDS[id | 0] || null; }

  /** 当前所属公会 id（0 = 无） */
  function of(g) {
    for (const id of [MAGE, FIGHTER, THIEF]) {
      if (V(g, GUILDS[id].flag) !== 0) return id;
    }
    return 0;
  }

  function isMember(g, id) {
    const d = def(id);
    return !!(d && V(g, d.flag) !== 0);
  }

  /** 公会名（guildname，364-375）；无公会返回空串 */
  function name(g, id, lang) {
    const gid = (id === undefined || id === null) ? of(g) : (id | 0);
    const d = def(gid);
    if (!d) return '';
    if (lang === 'jp') return d.jp;
    if (lang === 'en') return d.en;
    return d.ch;
  }

  function rankScore(g) { return V(g, SLOT.RANK); }

  /** 位次（var_65(128)/100；100 = 见习，1 = 下任大师） */
  function rankPos(g) { return idiv(rankScore(g), 100); }

  /** 公会称号（ranktitle(8)，319-333） */
  function rankTitle(g, lang) {
    if (!rankScore(g)) return '';
    if (Elona.Rank && Elona.Rank.title) return Elona.Rank.title(g, 8, lang || 'ch') || '';
    return '';
  }

  /** 公会规模（var_58(207/208/209, 0)，会长对话里 50 起） */
  function size(g, id) {
    const d = def((id === undefined || id === null) ? of(g) : id);
    const p = g && g.player;
    if (!d || !p || !p.get) return 0;
    return p.get(d.size) | 0;
  }

  /** 投资 50 金所需金额（376438： (limit(size+50,1,250)^2 + 500) * 20） */
  function investCost(g, id) {
    const n = limit(size(g, id) + 50, 1, 250);
    return (n * n + 500) * 20;
  }

  /** 法师公会 GP 需求（377530：40 - rank/400） */
  function mageQuota(g) { return Math.max(1, 40 - idiv(rankScore(g), 400)); }

  /** 盗贼公会赃物金额需求（377811：(10000 - rank) * 3 + 1000） */
  function thiefQuota(g) { return (10000 - rankScore(g)) * 3 + 1000; }

  /** 战士公会层数需求（378092：30 - rank/400） */
  function fighterLevel(g) { return Math.max(1, 30 - idiv(rankScore(g), 400)); }

  /** 当前诺玛摘要；无任务返回 null */
  function quota(g, id) {
    const d = def((id === undefined || id === null) ? of(g) : id);
    if (!d || !isMember(g, d.id)) return null;
    if (!V(g, d.task)) return null;
    if (d.id === MAGE) {
      return { kind: 'gp', label: '公会点数', left: V(g, SLOT.GP) };
    }
    if (d.id === THIEF) {
      return { kind: 'stolen', label: '赃物金额', left: V(g, SLOT.STOLEN) };
    }
    return {
      kind: 'nefia', label: '奈菲亚', left: V(g, SLOT.NEFIA),
      level: V(g, SLOT.NEFIA_LV), type: V(g, SLOT.NEFIA_TYPE),
    };
  }

  /**
   * 向纳品箱上交物品（298905-298930）。
   * 地图 36/56（法师公会）时按 (书籍等级 + 5) × 个数 累积公会点数。
   * @returns {{gp:number, left:number}|null}
   */
  function deliverBook(g, it) {
    if (!g || !it || !it.f) return null;
    const map = V(g, 20);
    if (map !== 36 && map !== 56) return null;
    if (!isMember(g, MAGE)) return null;
    const count = it.f[0] | 0;
    if (count <= 0) return null;
    const bookLv = it.f[25] | 0;
    const gp = (bookLv + 5) * count;
    const left = Math.max(0, V(g, SLOT.GP) - gp);
    S(g, SLOT.GP, left);
    it.f[0] = 0;
    return { gp, left };
  }

  /**
   * 通关随机奈菲亚（609420-609440）：
   *   任务进行中 且 危险度 >= 要求层数 且 类型匹配（693 + 20 == map type）→ 267--。
   * @param {{danger:number, type:number}} info
   * @returns {boolean} 是否计入
   */
  function onNefiaCleared(g, info) {
    if (!g || !info) return false;
    if (!isMember(g, FIGHTER)) return false;
    if (!V(g, GUILDS[FIGHTER].task) && V(g, WAR_SLOT[FIGHTER]) !== 1) return false;
    if ((V(g, SLOT.NEFIA) | 0) <= 0) return false;
    if ((info.danger | 0) < V(g, SLOT.NEFIA_LV)) return false;
    if (V(g, SLOT.NEFIA_TYPE) + 20 !== (info.type | 0)) return false;
    S(g, SLOT.NEFIA, V(g, SLOT.NEFIA) - 1);
    return true;
  }

  /** 月替：未完成的诺玛失效（302355-302380） */
  function monthlyExpire(g) {
    const out = [];
    if (!g) return out;
    if (V(g, SLOT.GP) > 0) { S(g, SLOT.GP, 0); out.push('法师公会的诺玛失效了。'); }
    if (V(g, SLOT.STOLEN) > 0) { S(g, SLOT.STOLEN, 0); out.push('盗贼公会的诺玛失效了。'); }
    if (V(g, SLOT.NEFIA) > 0) {
      S(g, SLOT.NEFIA_LV, 15);
      S(g, SLOT.NEFIA_TYPE, (g.rng && g.rng.rnd) ? g.rng.rnd(8) : 0);
      S(g, SLOT.NEFIA, 0);
      out.push('战士公会的诺玛失效了。');
    }
    return out;
  }

  /**
   * 一斉訓練（376404-376430）：按公会规模给玩家与同伴恢复潜力。
   * 源码对槽 0..244 里状态正常、未离队的角色做 modgrowth(10..18, 规模)。
   * @returns {number} 受影响角色数
   */
  function monthlyTraining(g) {
    const id = of(g);
    if (!id) return 0;
    const amount = limit(size(g, id), 50, 200);
    if (!Elona.Stats || !Elona.Stats.modGrowth) return 0;
    let n = 0;
    const charas = (g && g.charas) || [];
    for (let i = 0; i < charas.length && i < 245; i++) {
      const c = charas[i];
      if (!c || !c.get || (c.get(0) | 0) !== 1) continue;
      for (let k = 10; k <= 18; k++) Elona.Stats.modGrowth(c, k, i, amount, g);
      n++;
    }
    return n;
  }

  // ---------------- 公会战支线（21292-21370 / 200647-200702 / 376528-377302） ----------------

  /** 某公会的公会战任务状态（0/1/2/>=1000） */
  function warState(g, id) {
    const slot = WAR_SLOT[id | 0];
    return slot ? V(g, slot) : 0;
  }

  /** 接下公会战任务：由会长对话触发，把本公会战槽置 1（376528/376874/377220） */
  function acceptWar(g, id) {
    const slot = WAR_SLOT[id | 0];
    if (!slot) return false;
    S(g, slot, 1);
    return true;
  }

  /**
   * 击杀一位会长时推进公会战（源码 200647-200702）：
   * 死者 species 命中 MASTER_KILL，把对应两个「非本公会」的战槽由 1 推进到 2。
   * @param {object} g
   * @param {number} species 死者种族 id
   * @returns {number[]} 本次被推进到 2 的公会战槽号
   */
  function onMasterKilled(g, species) {
    const slots = MASTER_KILL[species | 0];
    if (!slots || !g) return [];
    const advanced = [];
    for (const slot of slots) {
      if (V(g, slot) === 1) {
        S(g, slot, 2);
        advanced.push(slot);
      }
    }
    return advanced;
  }

  /** 公会战任务的中文说明（日志/委托面板用，源码 21303/21329/21355） */
  function warText(g, id) {
    const st = warState(g, id);
    if (!st) return '';
    if (st === 1) return '暗杀其他公会会长中的一位。';
    if (st === 2) return '回本公会会长处报告。';
    if (st >= 1000) return '[达成] 公会战。';
    return '';
  }

  /**
   * 公会战报告完成（376593/376610 等）：战槽置 1000 并领取奖励。
   * 源码奖励 itemcreate：747（白金）、622、55，见 376566-376568。
   * @returns {{ok:boolean, rewards:number[]}}
   */
  function reportWar(g, id) {
    if (warState(g, id) !== 2) return { ok: false, rewards: [] };
    const slot = WAR_SLOT[id | 0];
    S(g, slot, 1000);
    const rewards = [];
    if (Elona.ItemDB && Elona.ItemDB.create) {
      const p = g.player;
      const x = p ? (p.get ? p.get(1) : 0) : 0;
      const y = p ? (p.get ? p.get(2) : 0) : 0;
      for (const itemId of [747, 622, 55]) {
        try { Elona.ItemDB.create(itemId, 1, g.rng, x, y, g); rewards.push(itemId); }
        catch (e) { /* 生成器缺失时跳过，仍标记完成 */ }
      }
    }
    return { ok: true, rewards };
  }

  /**
   * 复仇者生成（源码 241305-241340 / 242805-242815）。
   *
   * 源码在进入特定地图时，若对应任务槽 == 1（已接未完成），`characreate` 一只复仇者：
   *   · 各公会战：走进**对方**公会地图时生成该公会会长作为复仇者；
   *   · 狗尾巴任务（var_65(501)=250+251）：地图 69（狗神森）生成 species 517；
   *   · 状态 >=1000 的完成态（如 250+251==1001）在对应地图生成 517（242815）。
   * 这里按任务槽与地图做映射，spawn 回调由宿主注入（避免依赖角色工厂）。
   *
   * @param {object} g
   * @param {number} mapId 当前地图 id（var_65(20)）
   * @param {function} spawn (species:number, opt:{avenger:boolean}) => boolean
   * @returns {number} 生成的复仇者数量
   */
  function maybeSpawnAvenger(g, mapId, spawn) {
    if (!g || typeof spawn !== 'function') return 0;
    const mid = mapId | 0;
    let n = 0;
    // 地图 → 公会（对方公会地图；沿用 towns 注释：法师 36/56、战士、盗贼）。
    // 具体地图 id 源码由 var_132(10, mapId) 判定，这里用已有的城镇地图 id 集合。
    const GUILD_MAPS = {
      36: MAGE, 56: MAGE,       // 法师公会（露米埃斯特）
      57: FIGHTER, 58: FIGHTER, // 战士公会（卡普尔港）
      59: THIEF, 60: THIEF,     // 盗贼公会（达尔菲）
    };
    const myGuild = of(g);
    const mapGuild = GUILD_MAPS[mid];
    // 走进别的公会地图，且自己有公会战进行中 → 该地图所属会长作为复仇者出现
    if (myGuild && mapGuild && mapGuild !== myGuild && warState(g, myGuild) === 1) {
      if (spawn(MASTER_SPECIES[mapGuild], { avenger: true })) n++;
    }
    // 狗尾巴任务（250+251 = 501）：地图 69（狗神森）状态 1 → species 517 复仇者
    if (mid === 69 && V(g, 501) === 1) {
      if (spawn(517, { avenger: true })) n++;
    }
    return n;
  }

  /**
   * 进入地图时统一钩子：由 game.loadMap 调用，内部用 Elona.Encounter.spawn 兜底生成复仇者。
   * @returns {number} 生成数量
   */
  function onEnterMap(g, mapId) {
    if (!g) return 0;
    const spawn = (species, opt) => {
      if (Elona.Encounter && Elona.Encounter.spawn) {
        try {
          const r = Elona.Encounter.spawn(g, species, 1, { avenger: true, ...(opt || {}) });
          return !!(r && (r.ok !== false));
        } catch (e) { return false; }
      }
      return false;
    };
    return maybeSpawnAvenger(g, mapId, spawn);
  }

  /** 概要文本（给面板/调试用） */
  function summary(g) {
    const id = of(g);
    if (!id) return '没有所属公会';
    const d = def(id);
    const q = quota(g, id);
    let s = d.ch + '（' + rankTitle(g) + '，位次 ' + rankPos(g) + '）规模 ' + size(g, id);
    if (q) {
      s += '；诺玛剩余 ' + q.left;
      if (q.kind === 'nefia') s += '（要求 ' + q.level + ' 层以上，类型 ' + q.type + '）';
    }
    return s;
  }

  Elona.Guild = {
    MAGE, FIGHTER, THIEF, GUILDS, SLOT, WAR_SLOT, MASTER_KILL, MASTER_SPECIES,
    of, isMember, name, rankScore, rankPos, rankTitle,
    size, investCost, mageQuota, thiefQuota, fighterLevel,
    quota, deliverBook, onNefiaCleared, monthlyExpire, monthlyTraining, summary,
    warState, acceptWar, onMasterKilled, warText, reportWar, maybeSpawnAvenger, onEnterMap,
  };
})(typeof window !== 'undefined' ? window : globalThis);
