'use strict';
/**
 * 成对持续行动（0-GD）—— 脱衣 / 行為 三段式（源码 309871-311064）
 *
 *   11 脱衣    *label_2929  309871-310418  25+rnd(10) 回合（玩家每回合走 actionsp）
 *   32 脱衣    *label_2930  310420-310705  25+rnd(10) 回合（每回合 dmgsp 10+rnd(20)，NPC 可能失神）
 *   24 行為    *label_2931  310706-311064  11 回合（每回合 dmgsp 5，完成段只有收尾台词）
 *
 * 双方**同时**进入 rowact：`var_58(152)` 记录对方索引，接收方 +10000 标记；
 * 发起方回合数 T，接收方 2T。每回合的演出沿用原版文本的含蓄措辞
 * （16 种「…攻めている/攻められている…」），本项目不新增任何描写。
 *
 * 入口（全部接到本模块）：
 *   - 道具效果 821（336762-336801）：范围内的目标替使用者发起 24；
 *   - NPC 诱惑 AI（593795-593835 的 202==10 / 593443 的 cbit(1048)）；
 *   - NPC 对话脚本（talkscripts 的 `call L:2929/2930/2931`，dialogue.js 转接）；
 *   - 验证 / 调试：直接调 beginPair。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const rndOf = (g) => (g.rng && g.rng.rnd) ? g.rng.rnd : (() => 0);

  /** 三段的参数（309874 / 310425 / 310708 的 setup 与每回合分支的差异点） */
  const STAGES = {
    11: { expMul: 1, talk: 150, climaxFx: true, settle: true, gold: true, cost: 'stamina' },
    32: { expMul: 5, talk: 151, climaxFx: true, settle: true, gold: false, cost: 'sp10', faint: true },
    24: { expMul: 0, talk: 150, climaxFx: false, settle: false, gold: false, cost: 'sp5' },
  };

  function manages(type) { const t = type | 0; return t === 11 || t === 24 || t === 32; }

  /** 16 种演出文本（310018-310088，{t} = 玩家的对象）。17 号在源码里没有文本。 */
  const FLAVOR = [null,
    '你粗暴地摆布着{t}…。', '你不紧不慢地挑逗着{t}…。', '你用娴熟的技巧摆布着{t}…。',
    '你贴着{t}耳边低声细语…。', '你用偏门的玩法对待着{t}…。', '你缠绵不已地摆布着{t}…。',
    '你借助魔力摆布着{t}…。', '你撒娇般地缠着{t}…。',
    '{t}粗暴地摆布着你…。', '{t}不紧不慢地挑逗着你…。', '{t}用娴熟的技巧摆布着你…。',
    '{t}贴着你耳边低声细语…。', '{t}用偏门的玩法对待着你…。', '{t}缠绵不已地摆布着你…。',
    '{t}借助魔力摆布着你…。', '{t}撒娇般地缠着你…。',
  ];

  /** 演出文本 → 参与判定的属性（310048-310090）：
   *   1-7 → 玩家 var_82(10..16)；8-14 → 对象 var_82(10..16)；15-17 恒 1；
   *   玩家没有性癖设定（var_58(200)==0）时也恒 1（310088）。 */
  function flavorAttr(v, pref, player, partner) {
    const p = pref | 0;
    if (p === 0) return 1;
    const n = v | 0;
    if (n >= 1 && n <= 7) return (player.skill(9 + n) | 0);
    if (n >= 8 && n <= 14) return partner ? (partner.skill(n + 2) | 0) : 0;
    return 1;
  }

  /** 收尾台词（310310-310345 / 311055-311063，三段共用） */
  const AFTER = ['「真是太棒了…」', '「好、好厉害…」', '「不、不行了…」', '「好、好激烈…」', '「完、完败了…」'];
  /** 接收方每 5 回合的喘息（310176-310184，var_65(191)==100 时） */
  const GASP = ['「呜嗯…」', '「毛绒绒的…」', '「可恶、可是…」', '「哈啊、哈啊…」', '「唔呵呵…」'];

  // ---------------------------------------------------------------- 工具
  function los(g, a, b) {
    if (!a || !b) return false;
    if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1) return true;
    if (!g || !g.map) return true;                       // 无地图上下文按可见处理
    if (Elona.Spell && Elona.Spell.fovLos) return !!Elona.Spell.fovLos(g, a.x, a.y, b.x, b.y);
    return true;
  }
  function seen(g, c) {
    if (!c) return false;
    if ((c.index | 0) === 0) return true;
    return g && g.player ? los(g, g.player, c) : false;
  }
  function hasCbit(c, bit) {
    return !!(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, bit | 0));
  }
  /** var_58(182) += n，带上限（与 Social.addMorale 同式：409/214/25 决定 100 或 200） */
  function addMoraleCap(c, n) {
    let v = (c.get(182) | 0) + (n | 0);
    if (v > 100 && (c.get(409) | 0) <= 0
      && ((c.get(214) | 0) <= 0 || (c.index | 0) === 0)
      && ((c.get(25) | 0) < 4 || (c.index | 0) <= 16)) v = 100;
    if (v > 200) v = 200;
    c.set(182, v);
    return v;
  }
  function skillExp(c, id, n) {
    if (!c || !n) return;
    if (Elona.Stats && Elona.Stats.skillExp) {
      Elona.Stats.skillExp(c, id | 0, c, n | 0, 0, 0, Elona.game);
    }
  }
  function dmgcon(g, c, id, pow) {
    if (Elona.Resist && g.dmgconTable) {
      Elona.Resist.dmgcon(g, g.dmgconTable, c, id | 0, pow | 0);
    }
  }
  function dmgsp(g, c, n) {
    if (Elona.Status && Elona.Status.dmgsp) {
      try { Elona.Status.dmgsp(c, n | 0); return; } catch (e) { /* 模块异常时走手写 */ }
    }
    c.sp = (c.sp | 0) - (n | 0);
  }
  function charaOf(g, idx) {
    if (!g || idx === undefined) return null;
    if ((idx | 0) === 0) return g.player || null;
    return (g.charas || [])[idx | 0] || null;
  }

  /** 双方同时结束（rowactend 两次，309911 / 310414 / 311063） */
  function endPair(g, a, b) {
    a.set(140, 0); a.set(141, 0);
    if ((a.index | 0) === 0) g.rowActPayload = null; else a.rowActPayload = null;
    if (b) {
      b.set(140, 0); b.set(141, 0);
      b.rowActPayload = null;
    }
  }

  // ---------------------------------------------------------------- 开始
  /**
   * 三段共用的 setup 分支（309874-309896 / 310425-310447 / 310708-310718）。
   * @param {number} type 11 / 32 / 24
   * @param {object} a 发起方（rowact 变 0 时调用的那一位）
   * @param {object} b 接收方（回合数 ×2，var_58(152) 带 +10000 标记）
   */
  function beginPair(g, type, a, b) {
    const st = STAGES[type | 0];
    if (!st || !a || !b) return { ok: false, reason: 'bad-args' };
    if ((a.get(0) | 0) !== 1 || (b.get(0) | 0) !== 1) return { ok: false, reason: 'dead' };
    if ((a.get(140) | 0) !== 0 || (b.get(140) | 0) !== 0) return { ok: false, reason: 'busy' };
    const T = (type === 24) ? 11 : 25 + rndOf(g)(10);   // 309876 / 310427 / 310710
    a.set(140, type | 0); a.set(141, T); a.set(152, b.index | 0);
    b.set(140, type | 0); b.set(141, T * 2); b.set(152, (a.index | 0) + 10000);
    const pa = { kind: 'intimacy', type: type | 0, partner: b.index | 0 };
    if ((a.index | 0) === 0) g.rowActPayload = pa; else a.rowActPayload = pa;
    b.rowActPayload = { kind: 'intimacy', type: type | 0, partner: a.index | 0, receive: true };
    // 309888 / 310437：`synccheck(var_243)` 时「○○は服を脱ぎ始めた。」；2931 无消息
    if (g.log && (type === 11 || type === 32) && seen(g, a)) {
      g.log(`${a.name}开始脱起了衣服。`);
    }
    return { ok: true, type: type | 0, turns: T, partner: b.index | 0 };
  }

  // ---------------------------------------------------------------- 每回合
  /** 兴奋度 +2（310100-310127 / 311028-311050；+10 的路径不带上限检查，源码同） */
  function pleasure2(g, a, b) {
    for (const X of [a, b]) {
      if (!X || (X.get(0) | 0) !== 1) continue;
      if ((X.get(60) | 0) < 100) {
        X.set(60, (X.get(60) | 0) + 2);
        if ((X.get(60) | 0) >= 100) {
          X.set(60, 120);
          // 310108：animeload 87 + snd 299（演出层，本项目省略）
        }
      }
    }
  }

  /** var_58(85,0)==7 时的斗志 / MP 块（310128-310161，2930/2931 同） */
  function drainMoraleBlock(g, a, b) {
    const player = g.player;
    if (!player || (player.get(85) | 0) !== 7) return;
    addMoraleCap(a, 2);
    if (b) addMoraleCap(b, 2);
    for (const X of [a, b]) {
      if (!X || (X.get(0) | 0) !== 1) continue;
      const other = (X === a) ? b : a;
      const w = Math.sqrt(limit(((other ? other.skill(17) : 0) | 0) * 2 - (X.skill(15) | 0), 4, 3600));
      X.set(55, (X.get(55) | 0) - Math.floor(w * ((X.get(182) | 0) + 100) / 20));
      if ((X.get(55) | 0) < 0 && (X.get(182) | 0) >= 100) {
        if (Elona.Status && Elona.Status.dmgmp) Elona.Status.dmgmp(X, X.get(38) | 0);
      }
    }
  }

  /**
   * 每回合（604685-604693 的分派 + 604785 的递减：本函数在递减**前**被调）。
   * @returns {object|null} 本回合摘要；null = 交给完成段
   */
  function tickFor(g, c, type, left) {
    if (!c || !manages(type)) return null;
    const st = STAGES[type];
    const l = (left === undefined) ? (c.get(141) | 0) : (left | 0);
    if (l <= 0) return null;
    let partner = c.get(152) | 0;
    const receive = partner >= 10000;
    if (receive) partner -= 10000;
    const p = charaOf(g, partner);
    // 309899 / 310445 / 310726：对方已不在或不再处于同一段 → 收场
    if (!p || (p.get(0) | 0) !== 1 || (p.get(140) | 0) !== type) {
      if (g.log && !receive && type !== 24 && seen(g, c)) {
        g.log('「我、我和那家伙才没有那种关系！我什么都不知道，饶了我…！」');
      }
      endPair(g, c, p);
      return { brokeUp: true };
    }
    // ---- 每回合消耗（309920-309937 / 310452-310483 / 310745-310753）----
    const isPc = (c.index | 0) === 0;
    if (type === 11) {
      if (isPc) {
        // actionsp 0, 1+rnd(2)（actionsp 定义 194xxx：SP<50 时 rnd(75) 掷失败）
        const cost = 1 + rndOf(g)(2);
        const sp = c.sp | 0;
        const ok = !(sp < 50 && sp < rndOf(g)(75));
        dmgsp(g, c, cost);
        if (!ok) {
          if (g.log && seen(g, c)) g.log('疲劳过度，失败了！');
          endPair(g, c, p);
          return { failed: true, reason: 'exhausted' };
        }
      }
      // NPC 发起方：actionsp 对非玩家恒成功且不扣（源码 194439 的早退）
    } else {
      const n = (type === 32) ? 10 + rndOf(g)(20) : 5;
      dmgsp(g, c, n);
      if (type === 32 && !isPc && st.faint) {
        // 310462：NPC SP < max/3 → 失神收场
        if ((c.sp | 0) < idiv(c.spMax | 0, 3)) {
          c.set(256, 100);
          if (g.log && seen(g, c)) {
            g.log(`${c.name}因过于激烈而昏了过去！`);
            g.log('疲劳过度，失败了！');
          }
          endPair(g, c, p);
          return { failed: true, reason: 'faint' };
        }
      }
    }
    c.set(79, 17 + 100 * 3);                              // 309940：表情 17 × 3 回合
    // ---- 演出 / 兴奋度 / 斗志（309942-310190）----
    if (Elona.Status && Elona.Status.makeSound) {
      try { Elona.Status.makeSound(g, c.x, c.y, 5, 8, 0, c.index | 0); } catch (e) { /* 表现层 */ }
    }
    const player = g.player;
    if (player && ((c.index | 0) === 0 || (p.index | 0) === 0)
      && ((player.get(141) | 0) % 5 === 0)) {
      const pref = player.get(200) | 0;
      const v = (pref > 0) ? pref : 1 + rndOf(g)(17);
      const partnerOfPlayer = ((c.index | 0) === 0) ? p : c;
      if (g.log && v >= 1 && v <= 16 && FLAVOR[v] && seen(g, c)) {
        g.log(FLAVOR[v].replace('{t}', partnerOfPlayer.name || '对方'));
      }
      const attr = flavorAttr(v, pref, player, partnerOfPlayer);
      // 310094：`rnd(sqrt(var_2387 + 100)) > rnd(100)` → 对方兴奋 +10
      if (rndOf(g)(Math.max(1, Math.round(Math.sqrt(attr + 100)))) > rndOf(g)(100)) {
        partnerOfPlayer.set(60, (partnerOfPlayer.get(60) | 0) + 10);
      }
    }
    pleasure2(g, c, p);
    drainMoraleBlock(g, c, p);
    if (receive) {
      // 310164-310188：接收方（var_2386 == 0）在 `var_58(141) \ 5 == 0` 时
      //   synccheck → txtef 9 → customtalk var_243, 150/151 → gosub *label_0258
      //   → **只有 var_65(191) == 100（没播到自定义台词）才用内置文本兜底**。
      // 150/151 在内置台词表 *label_4269 里不存在，所以没配台词文件就不出声。
      if (l % 5 === 0 && seen(g, c)) {
        const r = (Elona.Talk && Elona.Talk.speak)
          ? Elona.Talk.speak(g, c, st.talk)          // 内部会把 191 置 0/100
          : ((g.setV65 && g.setV65(191, 100)), { spoken: false });
        if (!r.spoken && g.log && (!g.getV65 || (g.getV65(191) | 0) === 100)) {
          g.log(GASP[rndOf(g)(GASP.length)]);
        }
      }
      return { receive: true };
    }
    return { turn: true };
  }

  // ---------------------------------------------------------------- 完成
  /** 收尾台词（三段都有） */
  function postLines(g, a, b) {
    if (!g.log || !seen(g, a)) return;
    g.log(AFTER[rndOf(g)(AFTER.length)]);
    if (b && (b.index | 0) === 0) g.log('」');            // 310343：txtef 20 的收尾引号
  }

  /** 11 / 32 的完成段（310203-310298 / 310652-310700）：状态 / 技能经验 / 报酬 */
  function settleCompletion(g, a, b, type, out) {
    const st = STAGES[type];
    const mul = st.expMul | 0;
    const rnd = rndOf(g);
    for (let k = 0; k < 2; k++) {
      const X = (k === 0) ? a : b;
      a.set(257, 0);                                      // 310203（源码两次都写 var_243）
      if (k === 1 && b && (b.get(0) | 0) === 1) {
        if (rnd(3) === 0) dmgcon(g, b, 11, 500);
        if (rnd(5) === 0) dmgcon(g, b, 3, 500);
        dmgcon(g, b, 11, 300);
        if (Elona.Status && Elona.Status.healsan) Elona.Status.healsan(b, 10);
        skillExp(b, 11, 250 * mul + (((b.index | 0) >= 57) ? 1000 : 0));
        skillExp(b, 15, 250 * mul + (((b.index | 0) >= 57) ? 1000 : 0));
      }
      if ((a.get(27) | 0) === 335 || (a.get(27) | 0) === 352) {
        skillExp(a, 11, 250);                             // 源码在 repeat 内 → 生效两次
        skillExp(a, 15, 250);
      }
      if (X && (X.get(0) | 0) === 1) {
        if (rnd(15) === 0) dmgcon(g, X, 12, 200);
        skillExp(X, 17, 250 * mul + (((X.index | 0) >= 57) ? 1000 : 0));
      }
    }
    const price = (a.skill(17) | 0) * (50 + rnd(50)) + 100;
    out.price = price;
    if (a.index === 0 || (b && b.index === 0)) {
      if (g.setV65) g.setV65(278, (g.getV65 ? (g.getV65(278) | 0) : 0) + 1);
    }
    postLines(g, a, b);
    if (type === 11 && b && (b.index | 0) !== 0) goldSettle(g, a, b, price, out);
  }

  /** 11 号完成段的金钱结算（310300-310415） */
  function goldSettle(g, a, b, price, out) {
    const rnd = rndOf(g);
    if ((b.get(30) | 0) >= price) {
      if (g.log && seen(g, a)) g.log('「来，把零花钱收下吧」');
    } else {
      if (g.log && seen(g, a)) g.log('「这就是我钱包里的全部了…」');
      if (rnd(3) === 0 && (a.index | 0) !== 0) {
        if (g.log && seen(g, a)) g.log(`${a.name}勃然大怒：「在瞧不起谁？」`);
        a.set(29, b.index | 0); a.set(201, 20);
        if (g.log && seen(g, b)) g.log(`${b.name}反唇相讥：「有意见吗？」`);
        b.set(29, a.index | 0); b.set(201, 20);
      }
    }
    if ((b.get(30) | 0) <= 0) b.set(30, 1);
    const pay = b.get(30) | 0;
    b.set(30, (b.get(30) | 0) - pay);
    if ((a.index | 0) === 0) {
      if (Elona.Relation && Elona.Relation.modimp) {
        try { Elona.Relation.modimp(b, 5, g); } catch (e) { /* 模块缺失时跳过 */ }
      }
      const it = Elona.ItemDB ? Elona.ItemDB.createItem(54, pay) : null;
      if (it) {
        it.f[5] = a.x; it.f[6] = a.y;
        if (g.groundItems) g.groundItems.push(it);
        if (g.refreshGroundCell) g.refreshGroundCell(a.x, a.y);
      }
      if (g.log) g.log('有什么东西滚落在了脚边。');
      if ((a.index | 0) === 0 && a.set) a.set(49, (a.get(49) | 0) - 1);   // modkarma 0, -1
    } else {
      a.set(30, (a.get(30) | 0) + pay);
    }
    out.paid = pay;
  }

  /**
   * 完成段。源码在 `var_58(141)` 归零后的下一次 gosub 里走这里：
   * 接收方只 rowactend 自己（310193）；发起方走完整结算后双方一起结束。
   */
  function finishFor(g, c, type) {
    if (!c || !manages(type)) return { ok: false, reason: 'bad-type' };
    let partner = c.get(152) | 0;
    const receive = partner >= 10000;
    if (receive) {
      partner -= 10000;
      endPair(g, c, charaOf(g, partner));
      return { done: true, receive: true, type };
    }
    const p = charaOf(g, partner);
    const st = STAGES[type];
    const out = { done: true, type };
    if (st.settle) settleCompletion(g, c, p, type, out);
    else postLines(g, c, p);                              // 24：只有收尾台词
    endPair(g, c, p);
    return out;
  }

  // ---------------------------------------------------------------- 入口
  /**
   * 194439 hostileaction —— 攻击（或敌对行为）之后的后续反应：
   *   中立 → 瞪眼（relation -2）→ 再犯则勃然大怒（relation -3，锁定攻击者）；
   *   中立目标每次被打先扣 karma -2；karma 跌破 -30 成为犯人 → gohostile。
   *   源码 194439-194531：
   *     194440  `if (prm_912 >= 16 | prm_913 == 0) return`
   *     194448  `if (var_58(9,t) != -3) var_58(79,t) = 418`
   *     194451  relation == 10 → 「glares at you」
   *     194462  relation == 0 且攻击者是玩家/同伴 → modkarma -2
   *     194478  relation > -2 → 瞪眼，relation = -2
   *     194488  relation <= -2 → 「gets furious!」，relation = -3、201 = 80、29 = 攻击者
   *     194511  cbit(960) 动物兴奋（地图 67 除外）
   *     194528  结束目标正在进行的行动（rowactend）
   */
  function hostileAction(g, user, t) {
    if (!t || !user) return;
    const uidx = user.index | 0, tidx = t.index | 0;
    if (uidx >= 16 || tidx === 0) return;                    // 194440
    if ((user.get(58) | 0) === 0 && uidx !== 0) return;      // 194443

    if ((t.get(9) | 0) !== -3) t.set(79, 18 + 100 * 4);      // 194448-194450
    if ((t.get(9) | 0) === 10) {
      if (g.log) g.log(`${t.name}露出了嫌弃的表情。`);        // 194457
    } else {
      // 194461-194465：玩家（或同伴）打中关系 0 的中立者 → karma -2
      if (uidx <= 16 && (t.get(9) | 0) === 0) modKarma(g, -2);
      // 194466-194476：202 号职业（执法者）在未通缉时只警告不还手
      const wanted = (g.getV65 ? (g.getV65(258) | 0) : 0);
      if ((t.get(27) | 0) === 202 && wanted === 0) {
        if (g.log) g.log(`${t.name}朝你瞪了过来。`);
        return;
      }
      const rel = t.get(9) | 0;
      if (rel > -2) {                                        // 194478-194487
        if (g.log) g.log(`${t.name}朝你瞪了过来。`);
        t.set(9, -2);
      } else {
        if (rel !== -3 && g.log) g.log(`${t.name}勃然大怒！`); // 194489-194497
        t.set(9, -3);
        t.set(201, 80);
        t.set(29, uidx);                                     // 锁定攻击者
      }
    }
    // 194511-194527：cbit 960 的动物群兴奋（地图 67 除外）
    if (hasCbit(t, 960) && (g.getV65 ? (g.getV65(20) | 0) : 0) !== 67) {
      if (rndOf(g)(50) === 0) {
        if (g.log) g.log('动物们兴奋了起来！');
        for (const c of (g.charas || [])) {
          if (!c || !hasCbit(c, 960)) continue;
          c.set(29, 0); c.set(201, 20); c.set(79, 18 + 100 * 3);
        }
      }
    }
    // 194528-194530：打断目标正在进行的行动
    if ((t.get(140) | 0) !== 13 && (t.get(140) | 0) !== 0) {
      t.set(140, 0); t.set(141, 0); t.set(142, 0);
    }
  }

  /**
   * 31689 modkarma 的移植子集：玩家 var_58(49) 增减 + 上下限 + 犯罪化。
   *   var_767 = 20（上限）；[-100, 20]；跨过 -30 → 「你成了犯人」+ gohostile(31654)。
   */
  function modKarma(g, n) {
    const p = g.player;
    if (!p || !n) return;
    modifyKarmaValue(p, n, g);
  }

  /** 31689-31757 modkarma：只处理 karma 值与犯罪门槛（缺 trait 162/169 的修正） */
  function modifyKarmaValue(c, n, g) {
    const before = c.get(49) | 0;
    const delta = n | 0;
    if (g && g.log) g.log(`业力(${delta})`);
    if (delta < 0 && before >= -30 && before + delta < -30) {
      if (g && g.log) g.log('你现在是犯人了。');              // 31737
      goHostile(g);
    }
    let v = before + delta;
    if (v > 20) v = 20;
    if (v < -100) v = -100;
    c.set(49, v);
  }

  /** 31654 gohostile：守卫职业（150 = 14/16/24/1010/1026）全部转为敌对 */
  function goHostile(g) {
    for (let i = 57; i < 245; i++) {
      const c = (g.charas || [])[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      const job = c.get(150) | 0;
      if (job !== 14 && job !== 16 && job !== 24 && job !== 1010 && job !== 1026) continue;
      c.set(9, -3);
      c.set(201, 80);
      c.set(79, 18 + 100 * 2);
    }
  }

  /**
   * 道具效果 821（336762-336801）：范围内的目标「身体开始寻求快乐」，
   * 并由**目标**对使用者发起 24（源码交换 var_243/var_244 后 gosub *label_2931）。
   */
  function applyAphrodisiac(g, user) {
    if (!user) return { ok: false };
    const rnd = rndOf(g);
    const range = (Elona.Social && Elona.Social.rangeOf) ? Elona.Social.rangeOf() : 4;
    let hit = 0, resisted = 0;
    for (const t of (g.charas || [])) {
      if (!t || t === user || (t.get(0) | 0) !== 1) continue;
      if ((t.get(140) | 0) !== 0) continue;               // 336780：已在行动中 → 跳过
      const d = Math.max(Math.abs(t.x - user.x), Math.abs(t.y - user.y));
      if (d > range) continue;
      if (!los(g, user, t)) continue;
      // 336786：抗性 = limit(HP×10/maxHP,1,10) × 意志 / 5，rnd(使用者魅力) < 抗性 → 抵抗
      const resist = idiv(limit(idiv((t.get(50) | 0) * 10, Math.max(1, t.get(51) | 0)), 1, 10)
        * (t.skill(15) | 0), 5);
      if (rnd(Math.max(1, user.skill(17) | 0)) < resist) {
        t.set(79, 21 + 100);
        resisted++;
        continue;
      }
      t.set(79, 17 + 100);
      if (g.log && seen(g, t)) g.log(`${t.name}的身体开始寻求快乐。`);
      hostileAction(g, user, t);
      if (beginPair(g, 24, t, user).ok) hit++;
    }
    return { ok: true, hit, resisted };
  }

  /**
   * AI 入口（ai.js 每次行动前调用）：
   *   - cbit(1048)（593443）：贴着玩家且玩家空闲 → 直接发起 32；
   *   - 202==10（593795-593835）：在 NPC 里物色目标，播报后贴身发起 11。
   * @returns {boolean} true = 本次行动已被占用
   */
  function aiTry(g, c) {
    if (!c || (c.get(0) | 0) !== 1) return false;
    const player = g.player;
    const rnd = rndOf(g);
    if (hasCbit(c, 1048)) {
      if (!player || (player.get(0) | 0) !== 1) return false;
      const d = Math.max(Math.abs(c.x - player.x), Math.abs(c.y - player.y));
      if (d === 1 && (player.get(140) | 0) === 0) {
        return !!beginPair(g, 32, c, player).ok;
      }
      return false;                                       // 距离 > 1 → 常规 AI 接近
    }
    if ((c.get(202) | 0) === 10
      && (((c.get(58) | 0) === 100 && (c.get(29) | 0) === 0) || rnd(5) === 0)) {
      let target = null, dist = 99;
      for (const o of (g.charas || [])) {
        if (!o || o === c || (o.get(0) | 0) !== 1) continue;
        if ((o.index | 0) < 16) continue;                 // 源码 repeat 40,57：冒险者槽
        if (rnd(2) === 0) continue;
        const d = Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y));
        if (d >= 6 || !los(g, c, o)) continue;
        target = o; dist = d;
        break;                                            // 源码命中即 break
      }
      if (target) {
        if (g.log && seen(g, c) && seen(g, target)) {
          g.log(`${c.name}似乎在物色${target.name}…。`);
        }
        if (dist === 1 && (target.get(140) | 0) === 0) {
          c.set(29, 0);
          return !!beginPair(g, 11, c, target).ok;
        }
        // 距离 2..5 → 让常规 AI 接近（源码 goto *label_4309）
      }
    }
    return false;
  }

  const Intimacy = {
    STAGES, FLAVOR, GASP, AFTER, manages,
    beginPair, tickFor, finishFor, endPair, applyAphrodisiac, aiTry, hostileAction,

    /** 玩家侧（Actions.tickRowAct 调用；完成段在本模块内收尾） */
    tick(g, type) {
      const p = g.player;
      if (!p) return null;
      const left = p.get(141) | 0;
      if (left <= 0) return finishFor(g, p, type);
      return tickFor(g, p, type, left);
    },

    /** 玩家侧完成段（兼容入口） */
    finish(g, type) { return this.finishFor(g, g.player, type); },
  };

  Elona.Intimacy = Intimacy;
})(window);
