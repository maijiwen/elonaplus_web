'use strict';
/**
 * 事务所打工 / 认真乞讨 —— core/work.js（0-GB）
 *
 * 【源码锚点】
 *   350459-350568  `*label_3016` 的留言板分支：事务所（var_65(20)==80 &&
 *                  var_65(22)==70）打出 `txtsetwork 8` 的 8 项菜单
 *   10963-10993    `#deffunc txtsetwork`：8 个选项文本（工作 A/B/C × 100/500 回合、
 *                  整理文件、取消）
 *   350477-350500  var_444 0..5 → var_58(140,0)=26/27/28、var_58(141)=100/500
 *   350501-350545  选项 6「軽く整理整頓する」：var_65(13)++、var_2385++ 的彩蛋
 *   604733-604743  rowact 26/27/28 每回合 `gosub *label_2927`
 *   309726-309829  `*label_2927` 每回合判定（技能 14/12 成功率、SP、配额、
 *                  「…还差点什么」中断）与结束「歇了口气」
 *   330871-330875  能力 830「本気物乞い」→ `gosub *label_2915`
 *   604788-604790  rowact 29 每回合 `gosub *label_2915`
 *   307377-307634  `*label_2915`：61 回合，每 20 回合向 3 格内 NPC 讨钱，
 *                  结束显示合计并 decfame 40
 *
 * 【与 0-FX 的关系】0-FX 的 `completeRowAct(26..28)` 曾按「50 + turns*2」直接发金币，
 *   但原版打工并不发现钱：它削减事务所分配的工作配额
 *   var_65(250+436/437/438)（250+436=686 等），配额用完后的报酬由事务所 NPC 的
 *   对话脚本（419836-419866）结算。0-GB 按源码改为配额驱动，并保留一份
 *   「兼职津贴」以便没有事务所剧情时仍有反馈（见 finish 的 allowance，差异登记在 0-GB.5）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** var_65(250+436/437/438) —— 工作 A/B/C 的剩余配额 */
  const QUOTA = { 26: 686, 27: 687, 28: 688 };
  const JOB = { 26: '工作A', 27: '工作B', 28: '工作C' };
  /** txtsetwork 8（10963-10993） */
  const MENU = [
    '工作A 做 100 回合', '工作B 做 100 回合', '工作C 做 100 回合',
    '工作A 做 500 回合', '工作B 做 500 回合', '工作C 做 500 回合',
    '简单整理一下文件', '什么都不做',
  ];
  /** 350515-350545：var_2385 第 3/5/6/9/10 次的彩蛋 */
  const TIDY_LINES = {
    3: '…发现了前任留下的工作C重要文件！',
    5: '…发现前任的涂鸦，但太脏读不了！',
    6: '…出现了多个同名文件，分不清哪个是最新的！',
    9: '…看到了不该看的东西。',
    10: '…翻出一堆不知道该不该扔的笔记。',
  };

  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const V = (g, n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
  const setV = (g, n, v) => { if (g && g.setV65) g.setV65(n, v | 0); };
  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);
  const S = (c, n) => (c && typeof c.skill === 'function' ? (c.skill(n) | 0) : 0);
  const rnd = (g, n) => (g && g.rng ? g.rng.rnd(Math.max(1, n | 0)) : 0);
  const limit = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

  /** 菜单文本（供 UI 面板使用） */
  function menu() { return MENU.slice(); }

  /** 当前三项工作配额 */
  function quotas(g) {
    return { 686: V(g, 686), 687: V(g, 687), 688: V(g, 688) };
  }

  /** 350461：是否站在事务所（var_65(20)==80 && var_65(22)==70） */
  function isOffice(g) { return V(g, 20) === 80 && V(g, 22) === 70; }

  /**
   * 选中登记簿的一项（350470-350545）。
   * @returns {object} 0..5 启动 rowact；6 整理文件；7 取消
   */
  function begin(g, choice) {
    const c = choice | 0;
    if (c === 7) return { ok: false, reason: 'cancel', end: 'none' };
    if (c === 6) return tidy(g);
    if (c < 0 || c > 5) return { ok: false, reason: 'bad-choice' };
    if (!isOffice(g)) return { ok: false, reason: 'not-office', message: '这不是事务所的登记簿。' };
    const A = Elona.Actions;
    if (!A) return { ok: false, reason: 'no-actions' };
    const type = 26 + (c % 3);
    const turns = c < 3 ? 100 : 500;
    const quota = V(g, QUOTA[type]);
    if (quota <= 0) {
      g.log(`${JOB[type]}的配额已经做完了。`);
      return { ok: false, reason: 'quota-done', type };
    }
    const r = A.begin(g, type, turns, {
      job: type, turns, quotaStart: quota, worked: 0, fails: 0,
      tidyCount: g.tidyCount | 0,
    });
    if (r.ok) g.log(`你开始做${JOB[type]}（${turns} 回合，剩余配额 ${quota}）。`);
    return r;
  }

  /** 350501-350545：整理文件彩蛋（不进入 rowact） */
  function tidy(g) {
    const n = (g.tidyCount | 0) + 1;
    g.tidyCount = n;
    setV(g, 13, V(g, 13) + 1);                 // var_65(13)++（小时 +1）
    g.log('总之先把一堆散乱的笔记和文件整理了一下…。');
    if (TIDY_LINES[n]) g.log(TIDY_LINES[n]);
    if (g.endTurn) g.endTurn();                // gosub *label_4352
    return {
      ok: true, action: 'tidy', tidyCount: n,
      egg: TIDY_LINES[n] || '', message: TIDY_LINES[n] || '整理完了。',
    };
  }

  /**
   * *label_2927 每回合（309726-309820）。
   * 调用时 var_58(141) > 0；返回 interrupted 时由 actions.js 直接收尾。
   */
  function tick(g, type, pl) {
    const payload = pl || {}, p = g.player;
    const left = G(p, 141);
    if (type === 29) return begTick(g, payload, left);
    if (!(type in QUOTA)) return null;

    // 309727：dmgsp 0, rnd(2) —— 只掷一次 RNG，避免额外消耗随机序列
    const cost = rnd(g, 2);
    if (Elona.Status && Elona.Status.dmgsp) {
      try { Elona.Status.dmgsp(p, cost); } catch (e) { p.set(52, G(p, 52) - cost); }
    } else p.set(52, G(p, 52) - cost);

    // 309730 / 309763 / 309796：rnd(技能14+100)+rnd(技能12+100) < rnd(200) → 失败
    let ok = true;
    if (rnd(g, S(p, 14) + 100) + rnd(g, S(p, 12) + 100) < rnd(g, 200)) {
      ok = false;
      payload.fails = (payload.fails | 0) + 1;
      g.log('失败了。');
    }
    if (ok) {
      // 309740 / 309770 / 309802：各自的「还差点什么」门槛
      let blocked = false;
      if (type === 26) blocked = V(g, 687) > 500 || G(p, 52) < idiv(G(p, 53), 2);
      else if (type === 27) blocked = (V(g, 688) % 2 === 1) || V(g, 90) >= 30;
      else blocked = (payload.tidyCount | 0) < 3 || V(g, 13) < 8 || V(g, 13) > 17;
      if (blocked) {
        ok = false;
        // 309743 / 309773 / 309805：每 51 回合才真正 rowactend 中断
        if (left % 51 === 0) {
          g.log('…不行，还差点什么！');
          if (Elona.Actions && Elona.Actions.interrupt) {
            Elona.Actions.interrupt(g, 'work');
          } else {
            p.set(140, 0); p.set(141, 0); g.rowActPayload = null;
          }
          return { interrupted: true, type, reason: 'missing-something' };
        }
      }
    }
    if (ok) {
      const q = QUOTA[type];
      setV(g, q, Math.max(0, V(g, q) - (1 + rnd(g, 2))));
      payload.worked = (payload.worked | 0) + 1;
    }
    return { type, progressed: ok, quota: V(g, QUOTA[type]), left };
  }

  /** 309822-309829：打工结束只「歇了口气」+ rowactend */
  function finish(g, type, pl) {
    const payload = pl || {};
    const left = V(g, QUOTA[type] || 686);
    g.log('你歇了口气。');
    // 原版报酬由事务所 NPC 对话按配额结算（419836-419866）。网页版在没有该剧情
    // 链路时给一份与「实际削减的配额」挂钩的兼职津贴，避免玩家白做（0-GB.5 差异）。
    const worked = payload.worked | 0;
    const allowance = worked > 0 ? Math.min(worked * 2, 500) : 0;
    if (allowance > 0) {
      g.player.set(30, G(g.player, 30) + allowance);
      g.log(`事务所结算了 ${allowance} gold 的兼职津贴。`);
    }
    g.log(`工作配额剩余：A ${V(g, 686)} / B ${V(g, 687)} / C ${V(g, 688)}。`);
    return { ok: true, type, worked, allowance, quota: left };
  }

  /** 能力 830「本気物乞い」（330871-330875 → *label_2915） */
  function startBeg(g) {
    const A = Elona.Actions;
    if (!A) return { ok: false, reason: 'no-actions' };
    const p = g.player;
    p.set(145, 0);                     // var_58(145) 累计布施
    const r = A.begin(g, 29, 61, { begTotal: 0, begRounds: 0 });
    if (r.ok) g.log('你开始乞讨了。');
    return Object.assign({ action: 'beg', started: !!(r && r.ok) }, r);
  }

  /**
   * 307394-307599：每 20 回合向 3 格内 NPC 讨钱。
   * 源码的 var_58(14/251/256) 与 cbit 992 等筛选合并为「活着、有金币、非玩家」；
   * rnd(3)==0 才给，金额 = 等级*2+5，特殊 NPC /50，有特定 cbit 时按公式夹取。
   */
  function begTick(g, pl, left) {
    const payload = pl || {}, p = g.player;
    if (left % 20 !== 0) return { type: 29, skipped: true, left };
    payload.begRounds = (payload.begRounds | 0) + 1;
    let sum = 0, donors = 0;
    for (const c of (g.charas || [])) {
      if (!c || c === p || G(c, 0) !== 1 || G(c, 30) <= 0) continue;
      const d = Math.max(Math.abs((c.x | 0) - (p.x | 0)), Math.abs((c.y | 0) - (p.y | 0)));
      if (d > 3) continue;
      if (rnd(g, 3) !== 0) continue;
      let amount = G(c, 38) * 2 + 5;                   // var_58(38) 等级
      const role = G(c, 150);
      if ((role >= 1000 && role < 2000) || role === 2003) amount = idiv(amount, 50);
      if (Elona.Status && Elona.Status.cbit
          && (Elona.Status.cbit(c, 23) === 1 || Elona.Status.cbit(c, 27) === 1
              || Elona.Status.cbit(c, 964) === 1)) {
        amount = limit(idiv(amount + 1, 5) + 1, 1, 300);
      }
      amount = Math.min(Math.max(1, amount | 0), G(c, 30));
      c.set(30, G(c, 30) - amount);
      p.set(30, G(p, 30) + amount);
      p.set(145, G(p, 145) + amount);
      sum += amount; donors++;
    }
    payload.begTotal = (payload.begTotal | 0) + sum;
    if (sum > 0) g.log(`你从 ${donors} 个人那里讨到了 ${sum} gold。`);
    else g.log('没有人理你…。');
    return { type: 29, left, sum, donors, total: payload.begTotal };
  }

  /** 307601-307634：结束结算（合计布施 + 名声 -40） */
  function begFinish(g, pl) {
    const payload = pl || {}, p = g.player;
    const total = G(p, 145) || (payload.begTotal | 0);
    if (total > 0) {
      g.log(`你一共讨到了 ${total} gold 的布施。`);
      const fame = G(p, 34);
      p.set(34, Math.max(0, fame - 40));
      g.log('名声下降了 40。');
    }
    p.set(145, 0);
    return { ok: true, type: 29, total, fame: G(p, 34) };
  }

  Elona.Work = {
    menu, quotas, isOffice, begin, tidy, tick, finish,
    startBeg, begTick, begFinish,
    QUOTA, JOB, MENU, TIDY_LINES,
  };
})(window);
