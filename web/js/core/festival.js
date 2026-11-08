'use strict';
/**
 * 万圣节 Trick-or-Treat（core/festival.js）—— _trick 与事件 1025
 *
 * 【源码依据】hsp/start.hsp：
 *   16156-16350  _trick(prm_489)：按 var_58(18, var_244)（角色种别 0..6）与
 *     var_58(188, var_244)==1（激动状态）返回 7×2 句台词之一，尾接 var_334(prm_489)
 *     标点（9090：jp "。" "？" "！" ""；9093：en "." "?" "!" ""）。调用方传 3 → 空后缀。
 *   366745-366930  事件 1025（10 月 25 日 Trick-or-Treat）：
 *     - 在玩家背包找 825 ギャラメル / 889 手作りチョコ / 738 フォーチュンクッキー /
 *       945 ロミアス / 799 ヴェルニースオリジナル / 942 どんぐり / 906 栗 / 191 アピの実
 *     - 菜单：把某个菓子あげる（3..10）/ イタズラされる（2）/ イタズラする（1）
 *     - 给出 → 「わーい！」「ハッピーハロウィン！」→ NPC 回赠 かぼちゃランタン(979)
 *       （itemcreate 在玩家脚下；放不下时提示「部屋が一杯で置けなかった…」）
 *     - イタズラされる → NPC 向自己周围 ±3 的格子扔 28 次火炎瓶：
 *       addmef(x, y, 5, 24, rnd(15)+20, 50, npc) + mapitem_fire
 *     - イタズラする → 「ひっ…ガード！ガード！」karma −2
 *     - 结束：var_58(150, npc) = 2002（已应付）、var_58(9, npc) = -1
 *
 * 【本实现的触发条件（登记）】原版由万圣节事件 NPC 触发；本项目按日期
 * （10 月 25 日）对未应付过（var_58(150) != 2002）的 NPC 生效。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 角色种别 0..6 的台词（var_58(18)），[0]=通常（var_58(188)!=1）、[1]=激动（==1） */
  const TRICK_LINES = [
    ['トリック・オア・トリート？', 'トリック・オア・トリート？'],
    ['菓子をだせ！イタズラされたいのか！', 'イタズラされるか大人しくお菓子をわたすか、えらべ！'],
    ['イタズラしちゃうぞー。', 'お菓子ちょうだいっ！'],
    ['お菓子ください…。', 'お菓子くださいな…。'],
    ['菓子は用意できておるか。', '菓子の用意はできておるのかえ？'],
    ['菓子を頂戴しにまいった！', '菓子を頂きとうござりまする。'],
    ['お菓子ほしいッス。', 'お菓子ほしいのにゃー。'],
  ];

  /** var_334 标点表（9090）：_trick(n) 尾部追加 */
  const SUFFIX = ['。', '？', '！', ''];

  /** 可给的菓子（366760-366800）：菜单 id 3..10 → 物品 id */
  const GIVE_ITEMS = { 3: 825, 4: 889, 5: 738, 6: 945, 7: 799, 8: 942, 9: 906, 10: 191 };
  const HALLOWEEN_MONTH = 10, HALLOWEEN_DAY = 25;
  const DONE_STATE = 2002;

  /**
   * _trick(prm_489)（16156-16350）。
   * @param {object} g
   * @param {object} npc var_244
   * @param {number} [suffixIdx] var_334 下标（原版调用方传 3 = 空后缀）
   * @returns {string}
   */
  function trickText(g, npc, suffixIdx) {
    if (!npc) return 'Trick or Treat?';
    const role = (npc.get(18) | 0);
    const excited = (npc.get(188) | 0) === 1;
    const idx = (role >= 0 && role < TRICK_LINES.length) ? role : g.rng.rnd(TRICK_LINES.length);
    const line = TRICK_LINES[idx][excited ? 1 : 0];
    const sfx = SUFFIX[(suffixIdx === undefined) ? 3 : (suffixIdx | 0)] || '';
    return line + sfx;
  }

  /** 今天是否万圣节（10/25） */
  function isTrickTime(g) {
    return (g.getV65(11) | 0) === HALLOWEEN_MONTH && (g.getV65(12) | 0) === HALLOWEEN_DAY;
  }

  function findGiveable(g) {
    const inv = g.player.inv || [];
    const found = {};
    for (const k of Object.keys(GIVE_ITEMS)) {
      const id = GIVE_ITEMS[k];
      for (let i = 0; i < inv.length; i++) {
        const it = inv[i];
        if (it && (it.f[0] | 0) > 0 && (it.id | 0) === id) { found[k] = i; break; }
      }
    }
    return found;
  }

  /**
   * 事件 1025 开始 —— 构建菜单（366745-366810）。
   * @returns {{ok:boolean, action:string, title:string, options:Array}}
   */
  function startTrick(g, npc) {
    if (!npc) return { ok: false, message: '没有对象。' };
    const found = findGiveable(g);
    const options = [];
    // 原版菜单顺序：191(10) → 906(9) → 942(8) → 799(7) → 945(6) → 738(5) → 889(4) → 825(3)
    for (let k = 10; k >= 3; k--) {
      if (found[k] === undefined) continue;
      const it = g.player.inv[found[k]];
      const name = Elona.ItemDB ? Elona.ItemDB.name(it.id, 'en') : ('item ' + it.id);
      options.push({ label: `${name} をあげる`, arg: { choice: +k, idx: found[k] } });
    }
    options.push({ label: 'イタズラされる', arg: { choice: 2 } });
    options.push({ label: 'イタズラする', arg: { choice: 1 } });
    return {
      ok: true, action: 'trick-or-treat',
      title: `${trickText(g, npc, 3)}　（Trick or Treat?）`,
      options,
    };
  }

  /**
   * 事件 1025 结算（366812-366930）。
   * @param {{choice:number, idx?:number}} arg
   */
  function resolveTrick(g, npc, arg) {
    if (!npc) return { ok: false, message: '没有对象。' };
    const choice = arg ? (arg.choice | 0) : 0;
    const msg = [];
    if (choice >= 3 && choice <= 10) {
      // 给出菓子 → NPC 回赠 かぼちゃランタン(979)（366865-366895）
      const idx = arg.idx | 0;
      const it = g.player.inv && g.player.inv[idx];
      if (it && (it.f[0] | 0) > 0) {
        it.f[0] = (it.f[0] | 0) - 1;
        if ((it.f[0] | 0) <= 0) g.player.inv[idx] = null;
      }
      msg.push('「わーい！」', '「ハッピーハロウィン！」', '「コレあげる。」');
      if (Elona.Love && Elona.Love.dropAtFeet) {
        const gift = Elona.Love.dropAtFeet(g, g.player, 979);
        if (!gift) msg.push('（放不下了…）');
        else if (Elona.ItemDB) msg.push(`获得了 ${Elona.ItemDB.name(979, 'en')}！`);
      }
    } else if (choice === 2) {
      // イタズラされる → 28 次火炎瓶（366897-366928）
      msg.push('「これでも食らうがいい！」');
      let thrown = 0;
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      for (let k = 0; k < 28; k++) {
        const tx = (npc.x | 0) + R(3) - R(3);
        const ty = (npc.y | 0) - R(3) + R(3);
        if (!g.map || !g.map.inBounds(tx, ty)) continue;
        if (tx === (npc.x | 0) && ty === (npc.y | 0)) continue;
        thrown++;
        msg.push(`${npc.name}扔出了火炎瓶！`);
        if (Elona.Mef && Elona.Mef.add) {
          // addmef(x, y, 5, 24, rnd(15)+20, 50, npc)
          Elona.Mef.add(g, tx, ty, 5, 24, R(15) + 20, 50, npc.index | 0, 0, 0, 0);
        }
      }
      if (!thrown) msg.push('（火炎瓶没有落到任何地方。）');
    } else if (choice === 1) {
      // イタズラする → karma −2（366930-366940）
      msg.push('「ひっ…ガード！ガード！」');
      const p = g.player;
      if (p) p.set(49, (p.get(49) | 0) - 2);
    } else {
      return { ok: false, message: '' };
    }
    // 结束状态（366942-366943）
    npc.set(150, DONE_STATE);
    npc.set(9, -1);
    return { ok: true, message: msg.join('\n') };
  }

  Elona.Festival = { trickText, isTrickTime, startTrick, resolveTrick, GIVE_ITEMS, TRICK_LINES };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.Festival;
})(typeof window !== 'undefined' ? window : global);
