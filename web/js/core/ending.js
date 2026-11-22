'use strict';
/**
 * 结局演出（core/ending.js）—— 0-EN
 *
 * 【源码依据 hsp/start.hsp】
 *   label_4365  606175-606351  レシマス制覇（物种 2 死亡 → evadd 1）
 *   label_4368  606352-606442  レミード制圧（物种 458 死亡 → evadd 36）
 *   label_4371  606443-606531  神の間制圧（物种 923 于 76:179 死亡 → evadd 75）
 *
 * 事件 1/36/75 的入队已由 storykill.json（200607 / 200877 / 200564）完成；
 * 事件脚本执行到 `gosub 4365/4368/4371` 时调用本模块。原版这三段以
 * `txt_select` + 动画 + 分数面板呈现，本模块保留：
 *   · 关键台词（中文化）与「再看一次？」的重播循环（606339-606348 等）；
 *   · 结局状态写入 606349 `var_65(250+2)=180`、606439-440 `=340` + `var_65(823)=1`；
 *   · レシマス 中 606203/606270 的临时青年（物种 23）生成与消失。
 * 纯表现部分（void.bmp / g1.bmp / 分数表 / 音乐）按项目惯例从简。
 *
 * 【差异登记】D-013 的 823 写入点即 606440，本模块落地后不再挂起。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const V_STATE = 252;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 606182-606320 / 606359-606410 / 606450-606501 的关键台词 */
  const LINES = {
    lesimas: [
      '信じられない！你征服了奈菲亚迷宫「雷希墨斯」！',
      '从台座上，传来了不知是谁的声音。',
      '「你抵达这里，是早已注定的事……迟早而已。」',
      '房间里的空气骤然紧绷，一个俊美的青年出现在你面前。',
      '「依照奈菲亚永远的盟约，这个可怜老人所守护的东西，从今往后就属于你。」',
      '你望向台座上那本装饰华丽的书。青年露出恶作剧般的微笑，靠向墙壁。',
      '当你回过神来，青年已不见踪影。你甩开不安，缓缓向书伸出手……',
    ],
    rehmido: [
      '信じられない！你压制了古代遗迹「雷米伊德」！',
      '漫长的旅途终于结出了果实。',
      '……你的旅程仍未结束。',
    ],
    god: [
      '信じられない！你压制了神之殿！',
      '混沌之神倒下了。',
      '……你的旅程仍未结束。',
    ],
  };

  /** 606349 / 606439-440：拒绝重播后的状态写入 */
  function applyState(g, which) {
    if (!g || typeof g.setV65 !== 'function') return;
    if (which === 'lesimas') {
      g.setV65(V_STATE, 180);
    } else if (which === 'rehmido') {
      g.setV65(V_STATE, 340);
      g.setV65(823, 1);
    }
    // 神之间：段位 720 已在 200568 写入事件 75 时落位，这里不再改。
  }

  /** 逐行显示，缺 UI 时直接写入消息日志 */
  function showLines(g, lines, i, done) {
    const P = Elona.Panels;
    if (i >= lines.length) { done(); return; }
    if (!P || typeof P.open !== 'function') {
      if (g && typeof g.log === 'function') lines.forEach((s) => g.log(s));
      done();
      return;
    }
    P.open('ending', '结局', `<div class="pui-note" style="white-space:pre-wrap">${esc(lines[i])}</div>`,
      { hint: 'Enter 继续' });
    let moved = false;
    const next = () => {
      if (moved) return;
      moved = true;
      P.onClose = null;
      P.close();
      showLines(g, lines, i + 1, done);
    };
    P.onKeyFn = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { next(); return true; }
      return false;
    };
    P.onClose = next;
  }

  /** 606339-606348：是否重播；选 n（false）才落状态 */
  function askReplay(g, which, done) {
    const P = Elona.Panels;
    const finish = () => { applyState(g, which); if (done) done(); };
    if (!P || typeof P.openConfirm !== 'function') { finish(); return; }
    P.openConfirm('再看一次达成场景？', (yes) => {
      if (yes) play(g, which, done);
      else finish();
    }, { title: '结局' });
  }

  /**
   * 播放结局。
   * @param {object} g
   * @param {'lesimas'|'rehmido'|'god'} which
   * @param {function} [done] 用户看完（含拒绝重播）后回调
   */
  function play(g, which, done) {
    const lines = LINES[which] || [];
    if (!g) { if (done) done(); return; }
    if (which === 'lesimas' && Elona.CharaFactory && Elona.CharaFactory.create && g.player) {
      // 606203：青年（物种 23）出现在玩家所在格
      const lv = Math.max(1, g.player.get(38) | 0);
      const who = Elona.CharaFactory.create(g, 23, lv, g.player.x | 0, g.player.y | 0);
      showLines(g, lines, 0, () => {
        // 606270：`chara_vanquish findchara(23)`
        if (who && Elona.Chara && Elona.Chara.vanquish) {
          try { Elona.Chara.vanquish(g, who.index); } catch (e) { /* noop */ }
        }
        askReplay(g, which, done);
      });
      return;
    }
    showLines(g, lines, 0, () => askReplay(g, which, done));
  }

  Elona.Ending = { play, applyState, LINES, V_STATE };
})(window);
