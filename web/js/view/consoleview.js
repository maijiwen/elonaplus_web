'use strict';
/**
 * 调试控制台 —— 界面层（view/consoleview.js）
 *
 * 【打开方式】反引号 ` （config.txt 没有占用这个键）。
 *   · 打开时用 capture 阶段拦截 keydown，游戏不会收到按键
 *   · Esc 关闭；↑↓ 翻历史；Tab 补全命令名
 *
 * 【为什么放在 view 层】命令逻辑在 core/console.js（可单测），这里只管 DOM 与输入。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const MAX_LINES = 400;

  let root = null, outEl = null, inputEl = null;
  let open = false;
  const history = [];
  let histIdx = -1;

  function ensureDom() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'devconsole';
    root.className = 'hidden';
    root.innerHTML = ''
      + '<div class="dc-head">调试控制台　<span class="dc-hint">` 开关　Enter 执行　↑↓ 历史　Tab 补全　Esc 关闭</span></div>'
      + '<div class="dc-out"></div>'
      + '<div class="dc-input"><span class="dc-prompt">&gt;</span><input type="text" spellcheck="false" autocomplete="off" /></div>';
    document.body.appendChild(root);
    outEl = root.querySelector('.dc-out');
    inputEl = root.querySelector('input');

    inputEl.addEventListener('keydown', onInputKey);
    // 点输出区不抢焦点
    outEl.addEventListener('mousedown', (e) => e.preventDefault());
  }

  function write(text, cls) {
    ensureDom();
    const line = document.createElement('div');
    line.className = 'dc-line' + (cls ? ' ' + cls : '');
    line.textContent = text;
    outEl.appendChild(line);
    while (outEl.childElementCount > MAX_LINES) outEl.removeChild(outEl.firstChild);
    outEl.scrollTop = outEl.scrollHeight;
  }

  async function submit() {
    const line = inputEl.value;
    inputEl.value = '';
    if (!line.trim()) return;
    history.push(line);
    histIdx = history.length;
    write('> ' + line, 'dc-cmd');
    const r = await Elona.Console.exec(Elona.game, line);
    if (r.clear) { outEl.innerHTML = ''; return; }
    for (const l of r.lines) write(l, r.ok ? '' : 'dc-err');
    if (r.close) close();
  }

  function onInputKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!history.length) return;
      histIdx += e.key === 'ArrowUp' ? -1 : 1;
      histIdx = Math.max(0, Math.min(history.length, histIdx));
      inputEl.value = histIdx >= history.length ? '' : history[histIdx];
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const cur = inputEl.value.trim();
      if (!cur || cur.includes(' ')) return;
      const hits = Elona.Console.commands().filter((n) => n.startsWith(cur));
      if (hits.length === 1) { inputEl.value = hits[0] + ' '; return; }
      if (hits.length > 1) write('  ' + hits.join(' '), 'dc-hint');
    }
  }

  function openConsole() {
    ensureDom();
    if (open) return;
    open = true;
    root.classList.remove('hidden');
    if (!outEl.childElementCount) {
      write('Elona 调试控制台。输入 help 查看命令。', 'dc-hint');
    }
    inputEl.focus();
  }

  function close() {
    if (!open || !root) return;
    open = false;
    root.classList.add('hidden');
    inputEl.blur();
  }

  function toggle() { open ? close() : openConsole(); }

  // ---------------------------------------------------------------- 全局按键
  // 分成两个监听，顺序很关键：
  //   1) capture 阶段只处理 ` 开关。**不能**在这里对其它按键 stopPropagation——
  //      那会让事件到不了输入框本身（target 也收不到），回车就失效了。
  //   2) bubble 阶段再吃掉事件，阻止 main.js 的游戏按键。
  //      consoleview.js 在 index.html 里排在 main.js 之前，
  //      所以这里的 bubble 监听先注册、先执行，stopImmediatePropagation 能挡住游戏。
  window.addEventListener('keydown', (e) => {
    if (e.key === '`' || e.code === 'Backquote') {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }
  }, true);

  window.addEventListener('keydown', (e) => {
    if (!open) return;
    // 焦点跑到别处时拉回输入框，避免按键被游戏吃掉
    if (document.activeElement !== inputEl) inputEl.focus();
    e.stopImmediatePropagation();
  }, false);

  Elona.ConsoleView = {
    open: openConsole,
    close,
    toggle,
    isOpen: () => open,
    log: (text) => write(text),
  };
})(window);
