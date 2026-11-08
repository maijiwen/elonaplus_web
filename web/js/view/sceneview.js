'use strict';
/**
 * 剧情播放器（view/sceneview.js）—— 表现层
 *
 * 【源码依据】start.hsp 591627-592112
 *   布局：上下各留 60px 黑边（var_1661=60、var_1662=var_217-60，592059-592060）
 *         背景图从 640×480 拉伸铺满中间区域（gzoom var_216, 480, 4, 0,0, 640,480，592021）
 *         旁白文字 16px、行高 20px、水平居中（592048-592071）
 *   每页淡入 15 帧 × 16 级 alpha（592074-592085）
 *
 * 【已实现的偏差（见 docs/02-diff-report.md）】
 *   1. 源码在每页淡入后**自动续行**（无 waitkey），按键(bit128)直接结束整段。
 *      网页默认改为「按键推进」，并可用选项 sceneAuto 恢复自动推进，Esc 跳过整段。
 *   2. `{mc}` 的音乐是 MIDI，浏览器无法播放，改为语义相近的环境音循环。
 *   3. `{actor_N}` 的第二个字段（头像编号）没有对应素材，面板只显示名字。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const W = 800, H = 600;
  const BAR = 60;                  // var_1661
  const FONT = '16px "MS Gothic", "ＭＳ ゴシック", "Microsoft YaHei", monospace';
  const LINE_H = 20;
  const FADE_STEPS = 15;           // 592074: repeat 15, 1
  const FADE_MS = 30;              // 592076: await 30

  /** {mc} 的名字 → 我们的环境音（MIDI 无法播放，只能按场景语义取近似） */
  const MC_ALIAS = [
    [/^mcTown/i, 'town'],
    [/^mcDungeon/i, 'field'],
    [/^mcField/i, 'field'],
    [/^mcHome/i, 'town'],
    [/^mcUnrest/i, 'thunder'],
    [/^mcBattle/i, 'fire'],
  ];

  let canvas = null, ctx = null;
  let active = false;
  let skipFlag = false;
  let keyResolve = null;
  let advanceFlag = false;      // 淡入过程中按下的键：缓冲到本页结束时生效
  let playCount = 0;            // 已结束的剧情段数（含被跳过），供调试与测试判断「这一段播完了」
  let root = null;

  function ensureCanvas() {
    if (canvas) return;
    root = document.querySelector('#game .stage');
    if (!root) return;
    canvas = document.createElement('canvas');
    canvas.id = 'scene-canvas';
    canvas.width = W;
    canvas.height = H;
    canvas.className = 'scene-canvas hidden';
    root.appendChild(canvas);
    ctx = canvas.getContext('2d');
  }

  // ---------------------------------------------------------------- 输入
  function onKey(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { skipFlag = true; }
    // 淡入动画（约 450ms）里按键也要算数，否则会丢输入
    advanceFlag = true;
    if (keyResolve) { const r = keyResolve; keyResolve = null; r(); }
  }
  function onClick() {
    if (!active) return;
    advanceFlag = true;
    if (keyResolve) { const r = keyResolve; keyResolve = null; r(); }
  }

  /** 等一页看完（按键 / 点击 / 自动倒计时 / 跳过） */
  function waitPage(autoMs) {
    if (skipFlag) return Promise.resolve();
    // 本页淡入期间已经按过键 → 立即进入下一页
    if (advanceFlag) { advanceFlag = false; return Promise.resolve(); }
    return new Promise((resolve) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        keyResolve = null;
        resolve();
      };
      keyResolve = fin;
      // 自动播放：按文字量给一点阅读时间（源码是固定 450ms 淡入后立刻续行）
      const timer = autoMs > 0 ? setTimeout(fin, autoMs) : null;
      if (skipFlag) fin();
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- 绘制
  function drawBackground(img) {
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (img && img.complete && img.naturalWidth) {
      // 592021：640×480 拉伸到 (W, H-2*BAR)
      ctx.drawImage(img, 0, BAR, W, H - BAR * 2);
    }
    // 592059-592060：上下黑边
    ctx.fillStyle = 'rgb(5,5,5)';
    ctx.fillRect(0, 0, W, BAR);
    ctx.fillRect(0, H - BAR, W, BAR);
    ctx.restore();
  }

  /** 按画布宽度断行（原版靠 bmes 的宽度参数，这里用 720px 近似） */
  function wrap(text, maxW) {
    ctx.font = FONT;
    const out = [];
    let buf = '';
    for (const ch of text) {
      const t = buf + ch;
      if (ctx.measureText(t).width > maxW && buf) {
        out.push(buf);
        buf = ch;
      } else {
        buf = t;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  function drawPage(page, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (page.kind === 'txt') {
      // 逐行取显示文本（有译文用译文）；断行后重排
      const vis = [];
      (page.lines || []).forEach((l, i) => {
        const s = Elona.Scene.text(page.keys[i] || '', l);
        if (s.trim()) wrap(s, 720).forEach((x) => vis.push(x));
      });
      const n = vis.length;
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      vis.forEach((line, i) => {
        // 592051：var_1661 + 28 + (9 - n/2 + i) * 20
        const y = BAR + 28 + (9 - n / 2 + i) * LINE_H;
        ctx.fillStyle = 'rgb(10,10,10)';
        ctx.fillText(line, W / 2 + 1, y + 1);      // 592061-592069 的阴影
        ctx.fillStyle = 'rgb(240,240,240)';
        ctx.fillText(line, W / 2, y);
      });
    } else {
      // 台词：底部对话框 + 名字牌（原版为气泡，见文件头的偏差说明）
      const text = Elona.Scene.text(page.keys[0] || '', (page.lines || []).join(' '));
      const boxH = 150, boxY = H - BAR - boxH - 8;
      ctx.fillStyle = 'rgba(8,10,14,0.86)';
      ctx.fillRect(40, boxY, W - 80, boxH);
      ctx.strokeStyle = 'rgba(200,180,120,0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(40.5, boxY + 0.5, W - 81, boxH - 1);

      if (page.actor && page.actor.name) {
        ctx.font = '13px "MS Gothic", "Microsoft YaHei", monospace';
        const nw = ctx.measureText(page.actor.name).width + 18;
        ctx.fillStyle = 'rgba(40,34,22,0.95)';
        ctx.fillRect(40, boxY - 20, nw, 20);
        ctx.fillStyle = 'rgb(232,209,138)';
        ctx.textAlign = 'left';
        ctx.fillText(page.actor.name, 49, boxY - 5);
      }

      ctx.font = FONT;
      ctx.textAlign = 'left';
      const vis = wrap(text, W - 130);
      vis.slice(0, 5).forEach((line, i) => {
        ctx.fillStyle = 'rgb(235,235,235)';
        ctx.fillText(line, 60, boxY + 34 + i * 24);
      });
    }
    ctx.restore();
  }

  /** 淡入一页（592074-592085：15 帧、alpha 从 16 递增到 240） */
  async function showPage(img, page) {
    for (let i = 1; i <= FADE_STEPS; i++) {
      if (skipFlag) break;
      // 淡入期间按键 → 立刻显示整页（而不是跳过这一页），符合阅读习惯
      if (advanceFlag) { advanceFlag = false; break; }
      ctx.save();
      drawBackground(img);
      drawPage(page, Math.min(1, i / FADE_STEPS));
      ctx.restore();
      await sleep(FADE_MS);
    }
    drawBackground(img);
    drawPage(page, 1);
  }

  // ---------------------------------------------------------------- 主流程
  const imgCache = {};

  function loadImage(name) {
    if (!name) return Promise.resolve(null);
    if (imgCache[name]) return Promise.resolve(imgCache[name]);
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { imgCache[name] = im; resolve(im); };
      im.onerror = () => { imgCache[name] = null; resolve(null); };
      im.src = 'assets/graphic/' + name + '.bmp';
    });
  }

  function playSe(file) {
    if (!file || !Elona.Audio || !Elona.Audio.sfx) return;
    Elona.Audio.sfx(String(file).replace(/\.wav$/i, ''));
  }

  function playMc(name) {
    if (!name || !Elona.Audio) return;
    for (const [re, key] of MC_ALIAS) {
      if (re.test(name)) { Elona.Audio.bgm(key); return; }
    }
    // 未识别的音乐名：保持当前 BGM 不变（原版走 var_114(138) 动态加载）
  }

  /**
   * 播放一个区块。
   * @param {object} g     Game 实例（用于记录 var_65(36)）
   * @param {number} id    区块号（var_1877）
   * @param {object} opts  { lang, auto }
   */
  async function play(g, id, opts) {
    if (active) return false;
    ensureCanvas();
    if (!canvas || !Elona.Scene) return false;

    const o = opts || {};
    if (o.lang) Elona.Scene.setLang(o.lang);
    await Elona.Scene.load();
    await Elona.Scene.loadTrans();

    const seq = Elona.Scene.sequence(id);
    if (!seq.length) return false;

    active = true;
    skipFlag = false;
    canvas.classList.remove('hidden');
    window.addEventListener('keydown', onKey, true);
    canvas.addEventListener('mousedown', onClick);

    let img = null;
    try {
      for (const cmd of seq) {
        if (skipFlag) break;
        switch (cmd.t) {
          case 'pic':
            img = await loadImage(cmd.arg);
            break;
          case 'se':
            playSe(cmd.arg);
            break;
          case 'mc':
            playMc(cmd.arg);
            break;
          case 'fade':
            drawBackground(img);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            break;
          case 'fadein':
            for (let i = 1; i <= 25; i++) {          // 591707: repeat 25
              if (skipFlag) break;
              ctx.save();
              drawBackground(img);
              ctx.globalAlpha = Math.min(1, i / 25);
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, W, H);
              ctx.restore();
              await sleep(10);
            }
            break;
          case 'wait':
            await sleep(1000);                        // 592045: await 1000
            break;
          case 'page':
            advanceFlag = false;            // 上一页的按键不应跨越到这一页
            await showPage(img, cmd);
            if (!skipFlag) {
              // 自动播放时的停留时间：按字数估算（60ms/字，最少 1.2s）
              const n = (cmd.lines || []).join('').length;
              await waitPage(o.auto ? Math.max(1200, n * 60) : 0);
            }
            break;
          case 'end':
            skipFlag = true;
            break;
          default:
            break;
        }
      }
    } finally {
      window.removeEventListener('keydown', onKey, true);
      canvas.removeEventListener('mousedown', onClick);
      canvas.classList.add('hidden');
      active = false;
      keyResolve = null;
      playCount++;
      if (g && Elona.Scene) Elona.Scene.markPlayed(g, id);   // var_65(36)
    }
    return true;
  }

  /** 外部（比如自动播放选项）随时跳过 */
  function skip() {
    skipFlag = true;
    if (keyResolve) { const r = keyResolve; keyResolve = null; r(); }
  }

  Elona.SceneView = {
    play, skip,
    isActive: () => active,
    /** 已结束的剧情段数（含被跳过的）。测试用它判断「这一段确实播完了」 */
    playedCount: () => playCount,
    _drawForTest: { wrap, drawPage },
  };
})(window);
