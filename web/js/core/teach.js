'use strict';
/**
 * 个别指导（core/teach.js）—— 0-GT
 *
 * 【源码依据 hsp/start.hsp】`*label_2972`（340470-340545），能力 840 的入口
 *   （`ability0.js` 的 `T[840]` 只做了「var_58(60) >= 100」的前置检查后
 *    返回 `request:'teach'`，此前没有消费方，等于空转）
 *
 *   340472        gosub *label_2707 —— 选目标（本项目用同伴选择窗）
 *   340480-340499 距离与视线：超出 `var_83(3, 656) \ 1000 + 1` 或没有 fov_los
 *                 →「範囲外だ。」
 *   340500-340507 目标 `var_58(60) >= 100` →「手遅れだ。」
 *   340509-340516 目标 `var_58(60) <= 0` →「指導の必要はなさそうだ。」
 *   340518-340519 customtalk 148 + 随机台词（`*label_0258`）
 *   340520-340536 自定义台词失败（`var_65(191) == 100`）时随机回一句
 *   340537-340543 转移：`limit(f60(目标)/2, 1, 100 - f60(自己))`，
 *                 目标减去、自己加上，自己满 100 时压到 99
 *
 * 【差异】A504 —— 目标的选取交给界面层（同伴列表），效果本体在 `teach()`；
 *   随机回话用 `Elona.IdleTalk.line` 的同族做法，缺少台词表时退回固定四条。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc((a | 0) / (b | 0)));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);
  const F60 = 60;                       // var_58(60) 指导点数

  /** 340482：射程 = `var_83(3, 656) \ 1000 + 1`（656 = 3006 → 4 格） */
  function range() {
    const f = (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(656, 3) | 0) : 3006;
    return idiv(f, 1000) + 1;
  }
  function dist(a, b) {
    return Math.max(Math.abs((a.x | 0) - (b.x | 0)), Math.abs((a.y | 0) - (b.y | 0)));
  }
  function los(g, a, b) {
    if (Elona.Spell && Elona.Spell.fovLos) return Elona.Spell.fovLos(g, a.x, a.y, b.x, b.y) ? 1 : 0;
    return 1;
  }

  /** 340480-340516：三种拒绝 */
  function check(g, c, t) {
    if (!c || !t) return { ok: false, reason: 'no-target' };
    if (dist(c, t) > range() || los(g, c, t) === 0) return { ok: false, reason: 'out-of-range' };
    if (G(t, F60) >= 100) return { ok: false, reason: 'too-late' };
    if (G(t, F60) <= 0) return { ok: false, reason: 'no-need' };
    return { ok: true };
  }

  const REFUSE = {
    'out-of-range': '超出范围。',
    'too-late': '太迟了。',
    'no-need': '看来没有必要指导。',
    'no-target': '没有选择对象。',
  };
  /** 340524-340533：目标回话（jp / en 各四条，随机取一条） */
  const REPLIES = [
    { jp: '了解！', en: 'I got it.' },
    { jp: '気をつけるよ。', en: "I'll be careful." },
    { jp: 'なるほど…', en: 'Hmmm...' },
    { jp: 'ＯＫ', en: 'Okay.' },
  ];

  /**
   * 340518-340543：执行一次指导。
   * @returns {object} { ok, reason?, transferred?, messages: [] }
   */
  function teach(g, c, t) {
    const out = { ok: false, messages: [] };
    const chk = check(g, c, t);
    if (!chk.ok) {
      out.reason = chk.reason;
      out.messages.push(REFUSE[chk.reason] || '无法指导。');
      return out;
    }
    // 340518：customtalk 148（NPC 的专属台词；没有台词时不写 var_65(191)）
    if (Elona.Talk && Elona.Talk.speak) {
      try { Elona.Talk.speak(g, t, 148); } catch (e) { /* 没有台词表时忽略 */ }
    }
    const R = (n) => ((g && g.rng) ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    const line = REPLIES[R(REPLIES.length)] || REPLIES[0];
    // 340520-340536：只有自定义台词落空（var_65(191) == 100）时才回一句
    const failed = (g && typeof g.getV65 === 'function') ? (g.getV65(191) | 0) === 100 : true;
    if (failed) out.messages.push(`${t.name || '对方'}：「${line.jp}」`);
    // 340538-340543：转移一半，且不超过自己的余量
    const n = limit(idiv(G(t, F60), 2), 1, 100 - G(c, F60));
    t.set(F60, G(t, F60) - n);
    c.set(F60, Math.min(99, G(c, F60) + n));
    out.ok = true;
    out.transferred = n;
    out.messages.push(`你把要领教给了${t.name || '对方'}（${n}）。`);
    return out;
  }

  Elona.Teach = { range, check, teach, REFUSE, REPLIES, F60 };
})(window);
