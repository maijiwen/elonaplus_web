'use strict';
/**
 * 能力 / 特殊技能发动 —— *label_2958（315507-315573）与能力一览（*label_2739，288753-288784）。
 *
 * 数据来源（全部已存在）：
 *   tables/actions.json   var_83(field, id)：[0] 训练属性/图标、[1] 效果类型、[2] SP 消耗、
 *                         [3] 类别×1000（3000/10000 = 被动）、[4] 威力基数；另含名称与说明
 *   tables/abilities.json *label_2229 的觉醒条件（core/feat.js 的 unlockAbilities 求值）
 *   core/spell.js         *label_2959 前置检查 + calcspellpower + *label_2960 效果分派
 *
 * 判定顺序（逐行对应）：
 *   1. 288650-288660：能力需 `var_98(id-600) != 0`
 *   2. 315527-315539：睡眠/麻痹时 1/5 概率发不出来（被动类 3000/10000 不判）
 *   3. 315541-315556：玩家 + id>=600 → 体力 `sp<50 且 sp<rnd(75)` 失败；
 *      否则 `dmgsp(SP/2+1 + rnd(SP/2+1))`、`skillexp var_83(0,id) 25`
 *   4. 315558：`calcspellpower(id)` → 315569 `*label_2960` 效果分派
 *
 * 列表（*label_2739，288777-288784）：
 *   技能 300/301 + `var_98(cnt)==1` 的 600+cnt（cnt 0..279），
 *   排除 `var_83(3,id)/1000*1000 == 3000`（被动）与 746/667/693/740 四个特例。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  /** *label_2739 里被排除的四个 id（288779） */
  const EXCLUDED = [746, 667, 693, 740];

  /**
   * 死灵术的两个能力（743 ネクロフォース / 854 アクセルネクロ）。
   * 源码 `var_83(3, id) = 3000 + 6`（3746 / 3752），按 288779 的
   * `var_83(3,id)/1000*1000 != 3000` 会被当作「被动」排除在能力一览之外；
   * 但玩家首次召唤死灵时 356052-356059 会明确授予 743，且 743/854 都在
   * `*label_2960` 的效果分派里有自己的分支（332786 / 331553）。
   * 因此这里放行这两个 id（登记 A257）。
   */
  const NECRO_ABILITIES = [743, 854];

  /**
   * 药水系的「广域能力」：751 炼成雨 / 826 液体操纵弹。
   * 两者的 var_83(3,id) 是 3006，按 288779 会被排除在**能力一览**之外，
   * 但它们确实是从 W 页（*label_2743）发动的主动能力，因此这里放行
   * （与 NECRO_ABILITIES 同一处理方式）。
   */
  const POTION_ABILITIES = [751, 826];

  const Ability = {
    /**
     * 该 id 是否是「被动」类。
     * 288779 只排除 `var_83(3,id)/1000*1000 == 3000`；
     * 10000 只是 315527 里「睡眠时也会失败」的例外，不表示被动。
     */
    isPassive(id) {
      const S = Elona.Spell;
      if (!S || !S.field) return false;
      if (NECRO_ABILITIES.indexOf(id | 0) >= 0) return false;   // 见 NECRO_ABILITIES 注释
      if (POTION_ABILITIES.indexOf(id | 0) >= 0) return false;  // 见 POTION_ABILITIES 注释
      return this.isWide(id);
    },

    /** 广域能力（var_83(3,id)/1000*1000 == 3000）：不在主能力一览里，改由 W 页发动 */
    isWide(id) {
      const S = Elona.Spell;
      if (!S || !S.field) return false;
      return idiv(S.field(id, 3), 1000) * 1000 === 3000;
    },

    /** SP 消耗（var_83(2, id)） */
    cost(id) {
      const S = Elona.Spell;
      return (S && S.field) ? (S.field(id, 2) | 0) : 0;
    },

    name(id, lang) {
      const S = Elona.Spell;
      const n = S && S.actionName ? S.actionName(id) : null;
      if (!n) return '#' + id;
      // 汉化：actions.json 的 name.ch 优先
      return (n.ch || (lang === 'jp' ? n.jp : n.en) || n.jp || n.en || '#' + id);
    },

    /**
     * 可发动能力一览（*label_2739）。
     * @returns {{id:number, name:string, cost:number, unlocked:boolean, passive:boolean}[]}
     */
    list(g, c) {
      const ch = c || (g && g.player);
      if (!ch) return [];
      if (Elona.Feat && Elona.Feat.unlockAbilities) Elona.Feat.unlockAbilities(ch, g);   // 先按当前状态觉醒
      const out = [];
      // 288763-288776：技能 300 / 301
      for (const id of [300, 301]) {
        if ((ch.skill(id) | 0) !== 0) {
          out.push({ id, name: this.name(id), cost: this.cost(id), unlocked: true, passive: false });
        }
      }
      // 288777-288784：已觉醒的能力
      for (let n = 0; n < 280; n++) {
        if (Elona.Feat.flag(ch, n) === 0) continue;
        const id = 600 + n;
        if (this.isWide(id)) continue;              // 广域能力走 W 页（*label_2743）
        if (EXCLUDED.indexOf(id) >= 0) continue;
        out.push({ id, name: this.name(id), cost: this.cost(id), unlocked: true, passive: false });
      }
      return out;
    },

    /** 是否已觉醒（var_98） */
    isUnlocked(c, id) {
      if (!c || !Elona.Feat || !Elona.Feat.flag) return false;
      return Elona.Feat.flag(c, (id | 0) - 600) !== 0;
    },

    /**
     * 发动。
     * @param {object} g 游戏
     * @param {number} id 600..879 能力 / 300、301 特殊技能
     * @param {object} [opts] { target } 指定目标（省略则自动索敌）
     * @returns {object} Spell.cast 的结果，另加 ok/reason
     */
    use(g, id, opts) {
      const p = g.player;
      const S = Elona.Spell;
      const aid = id | 0;
      if (!S) return { ok: false, reason: 'no-spell' };
      const o = opts || {};

      // 1. 觉醒判定
      if (aid >= 600 && !this.isUnlocked(p, aid)) {
        g.log('这个能力还没有觉醒。');
        return { ok: false, reason: 'locked' };
      }
      // 被动类（3000/10000）不进发动列表（288779），这里也直接拒绝（源码只把它们从列表剔除）
      if (this.isPassive(aid)) {
        g.log('这是被动能力，无法主动发动。');
        return { ok: false, reason: 'passive' };
      }
      // 2. 睡眠/麻痹（315527-315539）
      //    315527：`var_83(3,id)/1000*1000` 为 **3000（广域）与 10000（自身中心）时不判**。
      //    626 精神分析是 10000，所以睡着也能用。
      const f3x = S.field(aid, 3);
      const clsx = idiv(f3x, 1000) * 1000;
      if (!o.resume && clsx !== 3000 && clsx !== 10000) {
        if ((p.get(254) | 0) !== 0 || (p.get(253) | 0) !== 0) {
          if (g.rng.rnd(5) === 0) {
            g.log('你无法集中精神。');
            return { ok: false, reason: 'disturbed' };
          }
        }
      }
      // 3. 体力（315541-315556）
      if (!o.resume && aid >= 600) {
        const sp = p.get(52) | 0;
        const cost = this.cost(aid);
        if (sp < 50 && sp < g.rng.rnd(75)) {
          g.log('你太累了，发动失败。');
          if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(p, idiv(cost, 2) + 1);
          return { ok: false, reason: 'tired' };
        }
        if (Elona.Status && Elona.Status.dmgsp) {
          Elona.Status.dmgsp(p, idiv(cost, 2) + 1 + g.rng.rnd(idiv(cost, 2) + 1));
        }
        if (Elona.Stats && Elona.Stats.skillExp) {
          Elona.Stats.skillExp(p, S.field(aid, 0), p, 25, 0, 0, g);   // 315555
        }
      }

      // 3.5 【0-EP】626 精神分析（318819-318868）
      //   类别 10000 在 `*label_2959`（315755-315769）里只是 `var_244 = var_243`
      //   （目标暂定为使用者），真正的目标由效果本体自己
      //   `gosub *label_2893`（318827）去选：
      //     · 邻格箭头：方向键 = 玩家的一格邻格，回车 / 空格 = 自己
      //     · 318832 目标处于タッグ编成中 → `txtselecttc 2` 二选一
      //     · 318850「あなたは◯の心を覗いた。」→ `gosub *label_2688`（分析窗）
      //     · 318857 没选到目标 → 「それは無理だ。」
      //   选完目标后用 `resume: true` 再进来，跳过上面的睡眠 / SP 段（只该扣一次；
      //   原版的 SP 段在 `*label_2958`，目标选择在它之后）。
      if (aid === 626) {
        if (!o.target) {
          return {
            ok: false, reason: 'need-direction', dirs: true, range: 1,
            neighbor: true, allowSelf: true, analyze: true,
          };
        }
        const tg = o.target;
        if (!tg || (tg.get(0) | 0) !== 1) {
          g.log('那是办不到的。');
          return { ok: false, reason: 'no-target' };
        }
        if ((tg.get(168) | 0) !== 0 && !o.tagPicked) {
          const partner = (Elona.Companion && Elona.Companion.tagPartner)
            ? Elona.Companion.tagPartner(tg) : null;
          return {
            ok: false, reason: 'tag-pick', analyze: true, aid,
            options: [
              { label: tg.name || '对方', chara: tg },
              { label: partner ? partner.name : '（没有搭档）', chara: partner || tg },
            ],
          };
        }
        g.log(`你窥视了${tg.name || '对方'}的心。`);
        if (g.endTurn) g.endTurn();                       // 318867 → *label_2970 → 消耗回合
        return { ok: true, action: 'analyze', target: tg, request: 'analyze' };
      }
      // 4. 死灵术专用能力（不走法术分派）
      //    743 ネクロフォース（332786-333076）：需要二次选择，choice 由 UI 传入
      //    854 アクセルネクロ（331553-331594）：直接对视野内死灵生效
      if (aid === 743 || aid === 854) {
        if (!Elona.Necro) { g.log('死灵术模块未加载。'); return { ok: false, reason: 'no-necro' }; }
        if (aid === 743 && (o.choice === undefined || o.choice === null)) {
          return { ok: true, request: 'necro-menu', menu: Elona.Necro.FORCE_MENU };
        }
        const r = (aid === 743)
          ? Elona.Necro.necroForce(g, o.choice | 0)
          : Elona.Necro.accelNecro(g);
        for (const m of (r.messages || [])) { if (m) g.log(m); }
        if (r.message) g.log(r.message);
        if (r.ok && g.endTurn) g.endTurn();
        return r || { ok: false };
      }

      // 4.3b 舞蹈（767，330860-330864 → *label_2914，307090-307247）
      //     不走法术分派：rowact 17 的持续行动；派对会场里 41 回合
      if (aid === 767) {
        if (!Elona.Perform) { g.log('舞蹈模块未加载。'); return { ok: false, reason: 'no-perform' }; }
        const r = Elona.Perform.startDance(g, c);
        if (!r.ok) { g.log(r.message || '现在无法跳舞。'); return r; }
        return { ok: true, action: 'dance', started: true };
      }

      // 4.4 説法（713，330866-330869 → *label_2916，307623-308011）
      //     不走法术分派：它是一个 61 回合的持续行动（var_58(140)=15）
      if (aid === 713) {
        if (!Elona.Preach) { g.log('说法模块未加载。'); return { ok: false, reason: 'no-preach' }; }
        const r = Elona.Preach.start(g);
        if (!r.ok) { g.log(r.message || '现在无法说法。'); return r; }
        if (g.endTurn) g.endTurn();
        return { ok: true, action: 'preach', started: true };
      }

      // 4.5 合奏（676，330878-330931）
      //     扫描附近可合奏的角色累积 var_1026；为 0 → 「あなたはひとりぼっちだ…。」
      //     否则 var_396 = 183（演奏技能）→ *label_2960 开始 121 回合的合奏演奏
      if (aid === 676) {
        if (!Elona.Perform) { g.log('演奏模块未加载。'); return { ok: false, reason: 'no-perform' }; }
        const en = Elona.Perform.ensemble(g);
        if (en && en.ok) {
          g.log(`你发动了 ${this.name(aid)}。`);
          return Object.assign({ ok: true, action: 'perform' }, en);
        }
        return en || { ok: false };
      }

      // 4.55 窃盗（300，319566-319596 → var_486=27 → 299168 → *label_3026 → 311077）
      //   原版：在能力窗口选「窃盗」→ 打开只列脚下物品的选择窗口（var_486=27）
      //   → 选中后建立 rowact 10（var_58(140)=10、141=2+limit(重量/500,0,50)）。
      //   本实现直接对脚下的第一件有主物品开始行窃（多件时的选择窗口见差异报告）。
      if (aid === 300) {
        if (!g.startSteal) { g.log('偷窃模块未加载。'); return { ok: false, reason: 'no-steal' }; }
        const st = g.startSteal(p);
        if (!st || !st.ok) {
          g.log((st && st.message) || '脚下没有可偷的东西。');
          return { ok: false, reason: (st && st.reason) || 'no-target' };
        }
        g.log(st.message);
        if (g.endTurn) g.endTurn();
        return Object.assign({ ok: true, action: 'steal' }, st);
      }

      // 4.55b 呼び寄せ／待機（684，330718-330809）
      //   目标 var_58(0)==1 → 待機；==7 → 呼び出し。
      //   有指定目标时直接用；否则返回 request，由 UI 打开同伴列表（原版 gosub *label_2683）。
      if (aid === 684) {
        if (!Elona.Companion) { g.log('同伴模块未加载。'); return { ok: false, reason: 'no-companion' }; }
        const C = Elona.Companion;
        // 330718 的入参是 `var_58(29, 主角)`（锁定槽）；没锁定才 `gosub *label_2683` 弹准星。
        let tgt = o.target || null;
        if (!tgt && Elona.Aim) {
          const lock = Elona.Aim.target(g);
          if (lock && lock.chara) tgt = lock.chara;
        }
        if (!tgt) {
          // 原版这里 `gosub *label_2683`（选角色窗，能看到**全队**，不受锁定射程限制），
          // 所以用同伴列表而不是瞄准光标。
          const list = C.allies(g).filter((c) => c.index !== 0 && (c.get(0) | 0) !== 6);
          if (!list.length) { g.log('你没有同伴。'); return { ok: false, reason: 'no-ally' }; }
          return { ok: true, request: 'ally-select', menu: 'call' };
        }
        if ((g.getV65(20) | 0) === 6) { g.log('这里什么也没有发生……'); return { ok: false, reason: 'arena' }; }
        const st = tgt.get(0) | 0;
        if (st === 1) {
          const r = C.wait(g, tgt);
          if (g.endTurn) g.endTurn();
          return r;
        }
        if (st === 7) {
          const r = C.call(g, tgt);
          if (r.ok && g.endTurn) g.endTurn();
          return r;
        }
        g.log('什么也没有发生……');
        return { ok: false, reason: 'invalid' };
      }

      // 4.6 乗馬（301，319598-319810）
      //     已在骑乘 → 下马；否则先选一个可骑乘的同伴（槽 1..15）
      if (aid === 301) {
        if (!Elona.Riding) { g.log('骑乘模块未加载。'); return { ok: false, reason: 'no-riding' }; }
        if (Elona.Riding.mountOf(g)) {
          const r = Elona.Riding.dismount(g);
          if (r && r.message) g.log(r.message);
          if (g.endTurn) g.endTurn();
          return r || { ok: false };
        }
        return { ok: true, request: 'ride-pick' };
      }

      // 4.7 斗志门槛（var_58(182)，见 Morale.COST 的源码逐分支提取）
      //   原版在斗志不足时会替换为弱化效果（如 663 → 732）；本项目暂按「拦下并提示」处理。
      const mgate = (Elona.Morale && Elona.Morale.canUse) ? Elona.Morale.canUse(p, aid) : { ok: true, need: 0 };
      if (!mgate.ok) {
        g.log(Elona.Morale.TEXT.notEnough(mgate.need, mgate.have));
        return { ok: false, reason: 'no-morale', need: mgate.need, have: mgate.have };
      }

      // 5. 目标
      //    优先级：显式传入 > 手动锁定（`var_58(29, 主角)`）> 自动索敌。
      //    原版 `*label_2959` 的取目标段同样先读锁定槽（592654 起），
      //    取不到才调 `*label_2836` 弹准星 —— 这里缺的一环由 Aim 补上。
      const f1 = S.field(aid, 1);
      let target = o.target || p;
      // 目标类别（var_938 = var_83(3,id)/1000*1000）决定要不要目标：
      //   2000/6000/7000/8000/9000 = 单体/接触/视线/邻接/吐息 → 必须有目标
      //   3000/10000 = 自身或范围自身中心 → 不需要（315757-315766）
      // 旧写法按 f1==0 判「自身」是错的：742 腹部重击、631 群击、710 紧抱 等
      // 的 f1 都是 0，但前者要对目标、后两者虽然也 f1=0 却走 3000/10000 类别。
      const f3 = S.field(aid, 3);
      const cls = idiv(f3, 1000) * 1000;
      // 750【力之解放】在动作表里是 2010（类别 2000），但 322494 的分支完全不用目标，
      //   只切换 `var_58(266)` 的方针。原版会先要一次目标再忽略，这里直接按自身处理。
      const SELF_CAST = { 750: 1 };
      const needsTarget = !SELF_CAST[aid]
        && (cls === 2000 || cls === 6000 || cls === 7000 || cls === 8000 || cls === 9000);
      const selfOnly = !needsTarget
        && (SELF_CAST[aid] || f1 === 0 || f1 === 4 || f1 === 5 || f1 === 9 || idiv(f1, 1000) === 1);
      if (!selfOnly && !o.target && Elona.Aim) {
        const lock = Elona.Aim.target(g);
        if (lock && lock.chara && (lock.chara.get(0) | 0) === 1) target = lock.chara;
      }
      // 4.8 近距离能力（类别 8000）且没有锁定目标 → 315670「どの方向？」：
      //     原版让玩家按方向键指定邻格，不自动索敌。这里把决定权交回 UI。
      //     （对地面发动时 UI 传 o.tile，走 precheck 的 var_2421 = 1 分支）
      if (!o.target && !o.tile && target === p
        && Elona.DirSel && Elona.DirSel.needs(aid, p)) {
        return { ok: false, reason: 'need-direction', dirs: true, range: Elona.DirSel.rangeOf(aid) };
      }
      if (!selfOnly && !o.target && !o.tile && target === p) {
        target = Elona.Throw ? Elona.Throw.nearestEnemy(g, p, 20) : null;
        if (!target) {
          // 没有锁定、视野内也没有敌人：交给 UI 打开瞄准（`*label_2670`），
          // 而不是只丢一句「没有目标」就结束 —— 这正是之前「什么都没发生」的来源。
          if (Elona.Aim) return { ok: false, reason: 'need-target', aimChara: true };
          g.log('没有可以瞄准的目标。');
          return { ok: false, reason: 'no-target' };
        }
      }
      const pre = S.precheck ? S.precheck(g, p, aid, target, o.tile) : { ok: true, target };
      if (!pre.ok) {
        // 315794「射程距離外だ。」等
        g.log(pre.reason === 'out_of_range' ? '射程距离外。'
          : (pre.reason === 'no_los' ? '那个地方看不见。' : '发动中止。'));
        return { ok: false, reason: pre.reason };
      }

      // 5. 效果分派（315558-315569）
      const r = S.cast(g, p, aid, pre.target || null, o.tile);
      // 不消耗回合的能力（如 750 力之解放：322516 直接 `return 0`，只切换方针）
      if (r && r.noTurn) return Object.assign({ ok: true }, r);
      if (mgate.need > 0 && Elona.Morale && Elona.Morale.spend) Elona.Morale.spend(p, aid);
      g.log(`你发动了 ${this.name(aid)}。`);
      if (g.endTurn) g.endTurn();
      return Object.assign({ ok: true }, r || {});
    },
  };

  Elona.Ability = Ability;
  Elona.Ability.EXCLUDED = EXCLUDED;
})(window);
