'use strict';
/**
 * 特技型持续行动（0-GC）—— 源码里 `var_58(140)` 取下列值的 rowact：
 *
 *   19 説得      *label_2921  308477-308721    5 回合
 *   20 ギャグ    *label_2922  308724-308959    5 回合
 *   21 嘘        *label_2923  308962-309221    5 回合
 *   22 脅迫      *label_2924  309224-309483    5 回合
 *   23 歌        *label_2925  309486-309678    5 回合
 *   33 応援      *label_2920  308286-308452    5 回合
 *   30 飛跳殺法  *label_2918  308104-308174    5 回合（跳起 → 落地重击）
 *   31 奇襲穿孔  *308176-309284               10 回合（潜入地下 → 破土攻击）
 *   16 分食      *label_2926  309681-309721   20 回合（料理篮）
 *   18 分食      *label_2928  309831-309871   20 回合（蛋糕）
 *
 * 这些 rowact 在原版是**每个角色各自持有**的（604690-604760 的分派对
 * `var_243` 逐个跑一遍），所以本模块同时提供：
 *   玩家侧  begin / tick / finish
 *   任意角色 startRowact / tickFor / finishFor（AI 每回合调 Actions.tickChara）
 * 11（脱衣）/ 24（行為）是成人向内容，按项目尺度豁免，见 docs/01 的 0-GC.5。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /**
   * 5 个社交特技。对照用的属性号（源码第二部的 `var_82(id, var_243)`）：
   *   19 説得 = var_82(15) 意志 / 20 ギャグ = var_82(13) 感覚 /
   *   21 嘘   = var_82(12) 器用 / 22 脅迫 = var_82(10) 筋力 /
   *   23 歌   = var_82(16) 魅力
   * 共同项 `var_82(156)`（説得技能）与同伴加成 `var_2380` 一起进对抗。
   */
  const SOCIAL = {
    19: { aid: 816, name: '说服', stat: 15, msg: '开始说服' },
    20: { aid: 817, name: '搞笑绝活', stat: 13, msg: '开始讲搞笑段子' },
    21: { aid: 818, name: '信口开河', stat: 12, msg: '开始信口开河' },
    22: { aid: 819, name: '胁迫地狱', stat: 10, msg: '开始胁迫' },
    23: { aid: 820, name: '魔唱', stat: 16, msg: '开始魔唱' },
  };

  /** 各类型完成的回合数（308104 / 308176 / 308477 的 `var_58(141)`） */
  const TURNS = { 19: 5, 20: 5, 21: 5, 22: 5, 23: 5, 33: 5, 30: 5, 31: 10, 16: 20, 18: 20 };

  /** 能力 id → rowact 类型（供 ability.js / ability0.js 调用） */
  const OF_ABILITY = {
    816: 19, 817: 20, 818: 21, 819: 22, 820: 23,
    875: 33, 876: 33,
    856: 30, 857: 31,
  };

  /** 本模块接管的 rowact 类型 */
  function manages(type) {
    const t = type | 0;
    return (t >= 19 && t <= 23) || t === 33 || t === 30 || t === 31 || t === 16 || t === 18;
  }

  const hasBuff = (c, id) => !!(Elona.Status && Elona.Status.findbuff
    && Elona.Status.findbuff(c, id | 0) >= 0);
  const hasCbit = (c, bit) => !!(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, bit | 0));
  const hostile = (c) => !!c && (c.get(9) | 0) <= -1;

  /** 说 `/解放` 的「视野内」判定：`fov_los(施放者, 目标)` */
  function los(g, a, b) {
    if (!a || !b) return false;
    if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1) return true;   // 相邻恒可见
    // 没有地图上下文（世界地图 / 测试桩）时不做遮挡判定，按可见处理
    if (!g || !g.map) return true;
    if (Elona.Spell && Elona.Spell.fovLos) return !!Elona.Spell.fovLos(g, a.x, a.y, b.x, b.y);
    return true;
  }

  /** 施放者是否被玩家看见（源码里的 `synccheck`） */
  function seenByPlayer(g, c) {
    if (!c) return false;
    if ((c.index | 0) === 0) return true;
    const p = g && g.player;
    if (!p) return false;
    return los(g, p, c);
  }

  /**
   * 308530 的索敌半径：`var_83(3, 656) \ 1000 + 1`
   * 能力 656「鼓舞」的类别是 3006 → 3 + 1 = 4 格。
   */
  function rangeOf() {
    const f = (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(656, 3) | 0) : 3006;
    return Math.max(1, idiv(f, 1000) + 1);
  }

  /** 以某角色为中心的索敌（不依赖 g.player，NPC 施放时同样正确） */
  function charsNear(g, actor, radius) {
    const out = [];
    const r = radius | 0;
    for (const c of (g.charas || [])) {
      if (!c || c === actor || (c.get(0) | 0) !== 1) continue;
      const d = Math.max(Math.abs(c.x - actor.x), Math.abs(c.y - actor.y));
      if (d > r) continue;
      out.push({ chara: c, dist: d });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  /**
   * 308530-308560 / 308790-308820 的「同伴加入」段，逐条件照抄：
   *   · `var_58(0, cnt) == 1`（活着）
   *   · 不是自己
   *   · 施放者 index < 16（玩家与同伴）→ 只在 index < 16 里找；
   *     施放者 index >= 16（NPC）→ 只在**同 `var_58(9)` 阵营**里找
   *   · 距离 <= `var_83(3,656)\1000 + 1`
   *   · `fov_los` 通过
   *   · `var_58(266) == 3`（行动模式「応援」）且带 buff 65
   *   · 累加 `var_2380 += (var_82(162) + 10) / 5`；
   *     第一个中选者记为 var_2381，之后每个 1/4 概率替换
   *
   * 起手段的 `customtalk var_243, 143`（308332 / 308523 / 308770 / 309008 /
   * 309270 / 309532 六处同构）+ `if (var_65(191) == 100)` 的内置文本，
   * 由 `builtin` 参数传入：播到自定义台词就不再说内置那句。
   * @param {string} [builtin] 内置起手文本（191 == 100 时才播）
   * @returns {{count:number, bonus:number, first:object|null, spoken:boolean}}
   */
  function helpers(g, actor, builtin) {
    let count = 0, bonus = 0, first = null;
    const range = rangeOf();
    const actorIdx = actor.index | 0;
    // 308332 / 308523：先 customtalk 143，没台词表才播内置那句
    let spoken = false;
    if (Elona.Talk && Elona.Talk.speak) {
      const r = Elona.Talk.speak(g, actor, 143);             // var_65(191) 在内部置 0/100
      spoken = !!(r && r.spoken);
    } else if (g.setV65) {
      g.setV65(191, 100);
    }
    if (!spoken && builtin && g.log && (!g.getV65 || (g.getV65(191) | 0) === 100)) {
      g.log(builtin);
    }
    for (const it of charsNear(g, actor, range)) {
      const c = it.chara;
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (c === actor) continue;
      if (actorIdx < 16) {
        if ((c.index | 0) >= 16) continue;
      } else if ((c.get(9) | 0) !== (actor.get(9) | 0)) continue;
      if (!los(g, actor, c)) continue;
      if ((c.get(266) | 0) !== 3) continue;
      if (!hasBuff(c, 65)) continue;
      count++;
      bonus += idiv((c.skill(162) | 0) + 10, 5);
      if (!first) first = c;
      else if (g.rng.rnd(4) === 0) first = c;
    }
    return { count, bonus, first, spoken };
  }

  /** 3 格内的敌对角色（19-23 的效果对象，源码用 `var_58(9, cnt)` 过滤） */
  function foes(g, actor) {
    return charsNear(g, actor, 3)
      .map((it) => it.chara)
      .filter((c) => c !== actor && hostile(c));
  }

  /** 3 格内的同阵营角色（33 応援：`var_58(9)` 相同且不是敌对） */
  function allies(g, actor) {
    const rel = actor.get(9) | 0;
    return charsNear(g, actor, 3)
      .map((it) => it.chara)
      .filter((c) => c !== actor && (c.get(9) | 0) === rel && !hostile(c));
  }

  /**
   * 斗志（var_58(182)）加减。源码 409/214/25 三个字段决定上限是 100 还是 200。
   */
  function addMorale(c, n) {
    let v = (c.get(182) | 0) + n;
    if (v > 100 && (c.get(409) | 0) <= 0
      && ((c.get(214) | 0) <= 0 || (c.index | 0) === 0)
      && ((c.get(25) | 0) < 4 || (c.index | 0) <= 16)) v = 100;
    if (v > 200) v = 200;
    c.set(182, v);
    return v;
  }

  /** 说话式 SP 伤害（源码 `dmgsptalk`）：允许降到负数，-100 触发溃败 */
  function talkSp(c, n) {
    c.sp = (c.sp | 0) - (n | 0);
    return c.sp | 0;
  }

  function skillExp(c, id, n) {
    if (Elona.Stats && Elona.Stats.skillExp) {
      Elona.Stats.skillExp(c, id | 0, c, n | 0, 0, 0, Elona.game);
    }
  }

  /**
   * 19-23 的每回合判定（308560-308700，五个分支同构，只有属性号不同）。
   * @returns {object} 本回合摘要，供验证脚本读取
   */
  function socialTick(g, actor, type) {
    const def = SOCIAL[type];
    if (!def) return null;
    const stat = def.stat | 0;
    const sk = actor.skill(stat) | 0;
    const talk = actor.skill(156) | 0;
    const pl = (actor.index | 0) === 0 ? (g.rowActPayload || {}) : (actor.rowActPayload || {});
    const bonus = pl.bonus | 0;
    const out = { targets: 0, hit: 0, fled: 0, sp: 0 };
    for (const t of foes(g, actor)) {
      out.targets++;
      // 308603：`rnd(sk + 156 + var_2380) > rnd(对手 sk)`
      if (g.rng.rnd(sk + talk + bonus) <= g.rng.rnd(t.skill(stat) | 0)) {
        t.set(79, 21 + 100);                       // 未命中：摇头动作
        continue;
      }
      out.hit++;
      t.set(79, 20 + 100);
      t.set(182, Math.max(0, (t.get(182) | 0) - 10));       // 308605
      if (g.rng.rnd(20) === 0) {
        if ((t.get(254) | 0) === 0) t.set(254, 1);          // 308622 動揺
      }
      // 308630：只有非「特殊 NPC」才给经验（cbit 23/27/964/960/992/985）
      const skip = [23, 27, 964, 960, 992, 985].some((b) => hasCbit(t, b));
      if (!skip && (t.index | 0) !== 0) {
        skillExp(actor, stat, 20);
        skillExp(actor, 156, 20);
      }
      // 308640-308660：按目标剩余 SP 分五档放大疲劳
      let mul = 1;
      const sp = t.spMax | 0;
      if ((t.sp | 0) < idiv(sp, 2)) mul = 2;
      if ((t.sp | 0) < idiv(sp, 3)) mul = 3;
      if ((t.sp | 0) < idiv(sp, 4)) mul = 4;
      if ((t.sp | 0) < idiv(sp, 5)) mul = 5;
      let d = idiv((sk + talk) * 5 * mul, Math.max(1, t.skill(stat) | 0)) + 1;
      if ((t.get(25) | 0) >= 4) d = idiv(d, 5) + 1;
      talkSp(t, d);
      out.sp += d;
      // 308680-308700：SP <= -100 → 溃败
      //   源码 `var_58(50, var_244) = -1` 把 HP 直接压到 -1，再由
      //   `dmghp 10, -30 / -31` 以「說得致死」的属性收尾（无掉落）。
      if ((t.sp | 0) <= -100 && !hasCbit(t, 985)) {
        skillExp(actor, 156, limit((t.get(38) | 0) * (t.get(38) | 0) / 10 | 0, 10, 1000));
        t.hp = -1;
        out.fled++;
        const suicide = (t.get(25) | 0) >= 4 || (t.get(150) | 0) !== 0;
        if (g.log && seenByPlayer(g, t)) {
          g.log(suicide
            ? `${t.name}露出无畏的笑容，突然自尽了。`
            : `${t.name}战到疲惫，静静离去了。`);
        }
        if (Elona.Battle && Elona.Battle.applyDamage) {
          Elona.Battle.applyDamage(t, 10, g, actor, suicide ? -31 : -30, 0);
        }
        if (Elona.NPC && Elona.NPC.checkTalk) Elona.NPC.checkTalk(g, actor, t);
      }
    }
    if (g.log && out.hit && seenByPlayer(g, actor)) g.log(`${actor.name}滔滔不绝地说着。`);
    return out;
  }

  /** 33 応援的每回合判定（308380-308450） */
  function cheerTick(g, actor) {
    const pl = (actor.index | 0) === 0 ? (g.rowActPayload || {}) : (actor.rowActPayload || {});
    const bonus = pl.bonus | 0;
    const sk = actor.skill(17) | 0;
    const out = { targets: 0, hit: 0, sp: 0 };
    for (const t of allies(g, actor)) {
      out.targets++;
      if ((t.get(256) | 0) > 60) t.set(256, 59);
      t.set(251, 0);
      addMorale(t, 2);
      if (g.rng.rnd(sk + bonus) <= g.rng.rnd(t.skill(17) | 0)) {
        t.set(79, 21 + 100);
        continue;
      }
      out.hit++;
      t.set(79, 6 + 100);
      let n = 1;
      if ((actor.skill(17) | 0) >= 100) n = 2;
      if ((actor.skill(17) | 0) >= 150) n = 3;
      if ((actor.skill(17) | 0) >= 200) n = 4;
      if (Elona.Status && Elona.Status.healsp) Elona.Status.healsp(t, n);
      out.sp += n;
    }
    skillExp(actor, 17, 40);                                // 308449
    return out;
  }

  /**
   * 30 飛跳殺法落地攻击（308140-308162）：
   *   `((var_82(13)/5+5) * ((var_82(153)+1)/5+5) + rnd(var_82(153)*2+5)
   *     + ((limit(等级-50,1,2000)+limit(等级-100,1,2000))*4*sqrt(limit(等级,1,2000)*3)+31)/2) * 4`
   * 31 奇襲穿孔同式但用 var_82(11) / var_82(163)，倍率 9（308222）。
   */
  function leapFinish(g, actor, type) {
    const lv = limit(actor.get(38) | 0, 1, 2000);
    const stat = (type === 30) ? (actor.skill(13) | 0) : (actor.skill(11) | 0);
    const apt = (type === 30) ? (actor.skill(153) | 0) : (actor.skill(163) | 0);
    const body = idiv(stat, 5) + 5;
    const body2 = idiv(apt + 1, 5) + 5;
    const lvlPart = idiv((limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4
      * Math.sqrt(limit(lv, 1, 2000) * 3) + 30 + 1, 2);
    const mult = (type === 30) ? 4 : 9;
    const d = (body * body2 + g.rng.rnd(apt * 2 + 5) + lvlPart) * mult;
    // 308145：5 格内取最近的敌对目标
    let target = null, best = 99;
    for (const it of charsNear(g, actor, 5)) {
      if (!hostile(it.chara)) continue;
      if (it.dist < best) { best = it.dist; target = it.chara; }
    }
    if (!target) {
      if (g.log && seenByPlayer(g, actor)) {
        g.log(type === 30 ? '然而差了一点点，没有命中。' : '然而没有人注意到地下的动静。');
      }
      return { ok: true, hit: false, damage: 0 };
    }
    if (g.log && seenByPlayer(g, actor)) {
      g.log(type === 30
        ? `${actor.name}借着落下的势头攻击了${target.name}。`
        : `${actor.name}从地下跃出，奇袭了${target.name}。`);
    }
    if (Elona.Battle && Elona.Battle.applyDamage) {
      Elona.Battle.applyDamage(target, d, g, actor, 64, 1000);
    }
    return { ok: true, hit: true, damage: d, target };
  }

  /**
   * 16 / 18 分食的完成段（309708-309720 / 309858-309870）：
   *   `var_58(22) = 13000`（满腹度）、`modgrowth 10..19 +var_65(250+303)*4+5`、
   *   `chara_anorexia`（已有拒食症则呕吐）。
   */
  function eatFinish(g, actor, pl) {
    const rank = (pl && pl.rank) | 0;
    actor.set(22, 13000);
    const gain = rank * 4 + 5;
    if (Elona.Stats && Elona.Stats.modGrowth) {
      for (let s = 10; s <= 19; s++) Elona.Stats.modGrowth(actor, s, gain);
    }
    // 201928 chara_anorexia：已患拒食症（cbit 986）时吃完必定呕吐
    if (hasCbit(actor, 986) && Elona.Vomit && Elona.Vomit.vomit) {
      const v = Elona.Vomit.vomit(g, actor);
      if (v && v.messages && g.log) for (const m of v.messages) g.log(m);
    }
    if (g.log && seenByPlayer(g, actor)) g.log(`${actor.name}吃完了。`);
    return { ok: true, type: pl && pl.type, growth: gain };
  }

  /**
   * 给任意角色挂一个 rowact（玩家走 g.rowActPayload，NPC 挂在角色自身上）。
   * 604690-604760 的分派对每个角色都跑一遍，所以 NPC 也需要自己的行动。
   */
  function startRowact(g, c, type, turns, payload) {
    if (!c) return { ok: false, reason: 'no-chara' };
    const t = type | 0;
    const left = Math.max(1, turns | 0);
    c.set(140, t);
    c.set(141, left);
    c.set(142, 0);
    if ((c.index | 0) === 0) g.rowActPayload = payload || null;
    else c.rowActPayload = payload || null;
    return { ok: true, type: t, turns: left };
  }

  const Social = {
    SOCIAL, TURNS, OF_ABILITY, manages,

    /**
     * 起一个 5 回合社交特技（19-23）。
     * @param {object} [actor] 施放者，省略时为玩家（NPC 施放时同样挂 rowact）
     */
    begin(g, type, actor) {
      const def = SOCIAL[type];
      if (!def) return { ok: false, reason: 'bad-type' };
      const c = actor || g.player;
      const isPc = (c.index | 0) === 0;
      // 起手台词：customtalk 143 优先，没有台词文件才播内置那句（308523 等）
      const h = helpers(g, c, isPc ? `你${def.msg}。（${TURNS[type]} 回合）`
        : `${c.name}${def.msg}。`);
      const r = startRowact(g, c, type, TURNS[type], {
        kind: 'social', type, bonus: h.bonus, joined: h.count,
      });
      if (g.log && seenByPlayer(g, c)) {
        if (h.count === 1) g.log(`${h.first ? h.first.name : '同伴'}也加入了${def.name}！`);
        else if (h.count > 1) g.log(`${h.first ? h.first.name : '同伴'}们也加入了${def.name}！`);
      }
      return r;
    },

    /** 33 応援（308286-308340） */
    beginCheer(g, actor) {
      const c = actor || g.player;
      const isPc = (c.index | 0) === 0;
      const h = helpers(g, c, null);
      const r = startRowact(g, c, 33, TURNS[33], {
        kind: 'cheer', bonus: h.bonus, joined: h.count,
      });
      if (g.log && seenByPlayer(g, c)) {
        // 308300：周围没有同伴时的原版提示
        if (h.count === 0) g.log(isPc ? '你孤零零一个人……' : `${c.name}孤零零一个人……`);
        // 308332：只有没播到自定义台词（191 == 100）才说「○○は応援を始めた。」
        else if (!h.spoken && (!g.getV65 || (g.getV65(191) | 0) === 100)) {
          g.log(isPc ? '你开始声援。' : `${c.name}开始声援。`);
        }
        if (h.count === 1) g.log(`${h.first ? h.first.name : '同伴'}也加入了声援！`);
        else if (h.count > 1) g.log(`${h.first ? h.first.name : '同伴'}们也加入了声援！`);
      }
      return r;
    },

    /** 30 飛跳殺法 / 31 奇襲穿孔 */
    beginLeap(g, type, actor) {
      const c = actor || g.player;
      const r = startRowact(g, c, type, TURNS[type], { kind: 'leap', type });
      if (r.ok && g.log && seenByPlayer(g, c)) {
        const isPc = (c.index | 0) === 0;
        g.log(isPc ? (type === 30 ? '你高高跃起。' : '你潜入地下。')
          : `${c.name}${type === 30 ? '高高跃起' : '潜入地下'}。`);
      }
      return r;
    },

    /**
     * 16 / 18 分食：源码 356300-356370 对 `repeat 16`（玩家与同伴）逐个
     * `gosub *label_2926 / *label_2928`，每人各自进入 20 回合的进食。
     * @param {object} opts { rank } var_65(250+303)
     */
    beginEat(g, type, opts) {
      const o = opts || {};
      const rank = o.rank | 0;
      const payload = { kind: 'eat', type, rank };
      let n = 0;
      for (const c of (g.charas || [])) {
        if (!c || (c.index | 0) >= 16) continue;
        if ((c.get(0) | 0) !== 1) continue;
        startRowact(g, c, type, TURNS[type], payload);
        n++;
      }
      if (g.log) g.log(type === 18 ? '你取出了蛋糕。' : '你在篮子里摊开了料理。');
      return { ok: n > 0, type, turns: TURNS[type], people: n };
    },

    /** NPC / 任意角色的每回合（Actions.tickChara 调用） */
    tickFor(g, c, type, left) {
      if (!c) return null;
      const l = (left === undefined ? (c.get(141) | 0) : (left | 0));
      if (l <= 0) return null;                 // 交给完成段
      // 308562 / 308384：`var_65(801)==0 & var_65(250+413)==0` 才动
      if (g.getV65 && ((g.getV65(801) | 0) !== 0 || (g.getV65(663) | 0) !== 0)) return null;
      if (type >= 19 && type <= 23) return socialTick(g, c, type);
      if (type === 33) return cheerTick(g, c);
      if (type === 16 || type === 18) {
        // 309696 / 309846：每 5 回合一句「*むしゃむしゃ*」
        if (l % 5 === 0 && g.log && seenByPlayer(g, c)) g.log(' *むしゃむしゃ* ');
        return { eating: true };
      }
      return null;                             // 30 / 31 没有每回合逻辑
    },

    /** 玩家侧（Actions.tickRowAct 调用） */
    tick(g, type, pl) { return this.tickFor(g, g.player, type); },

    /** 任意角色的完成段 */
    finishFor(g, c, type, pl) {
      if (!c) return { ok: false };
      if (type >= 19 && type <= 23) {
        if (g.log && seenByPlayer(g, c)) g.log(`${c.name}歇了口气。`);   // 308705
        return { ok: true, type, social: true };
      }
      if (type === 33) {
        if (g.log && seenByPlayer(g, c)) g.log(`${c.name}结束了声援。`);
        return { ok: true, type, cheer: true };
      }
      if (type === 30 || type === 31) return leapFinish(g, c, type);
      if (type === 16 || type === 18) return eatFinish(g, c, pl);
      return { ok: false, reason: 'bad-type' };
    },

    /** 玩家侧（Game.completeRowAct 调用） */
    finish(g, type, pl) { return this.finishFor(g, g.player, type, pl); },

    /** 能力 id → rowact 类型；不是本模块管的返回 0 */
    typeOf(aid) { return OF_ABILITY[aid | 0] | 0; },

    isSocial(type) { return (type >= 19 && type <= 23); },

    /** 供验证 / 调试 */
    helpers, charsNear, rangeOf, startRowact,
  };

  Elona.Social = Social;
})(window);
