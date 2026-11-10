'use strict';
/**
 * 信息面板层 —— 对应原版 key_* 里的信息类快捷键。
 *
 * 面板全部由 JS 动态创建（不改动 index.html 的结构），统一挂在 #screen 的父容器
 * (.stage) 内，样式见 css/style.css 的 `.pui-*` 段。
 *
 * 面板与按键的对应（config.txt 键名 → 本模块方法）：
 *   key_charainfo (c) → openCharaInfo   原版 label_2784
 *   key_skill     (a) → openSkills      原版 label_2739
 *   key_wipe      (W) → openSkills(3)   原版 label_2743（技能第 3 页：广域能力）
 *   key_trait     (F) → openTraits      原版 label_2695
 *   key_journal   (j) → openJournal     原版 label_2700
 *   key_msglog    (/) → openMsgLog      原版 label_4325
 *   key_help      (?) → openHelp        原版 label_4319
 *   key_look      (l) → openLook        原版 label_2675
 *   Esc / key_esc      → openMenu       原版 label_4367
 *   key_save      (S) → openSaveSlots   原版 label_2845
 *
 * 说明：原版这些画面都是 HSP 直接绘制的窗口；本实现用等价的 HTML 面板，
 * 内容字段尽量与源码一致（字段来源见各处注释）。凡数据不足的项留空，不臆造。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  const ATTR_NAMES = [
    [10, 'Strength 筋力'], [11, 'Constitution 耐久'], [12, 'Dexterity 器用'], [13, 'Perception 感覚'],
    [14, 'Learning 習得'], [15, 'Will 意志'], [16, 'Magic 魔力'], [17, 'Charisma 魅力'],
  ];

  const GOD_NAMES = null;   // 由 MapFeat.GOD_NAMES 提供

  /** 12 项属性耐性（var_82(50..61)）—— 人物信息窗的「耐性」页 */
  // 耐性索引 → 名称。名称取自源码 `var_81(50..61)`（3761-3893）：
  //   火炎 / 冷気 / 電撃 / 暗黒 / 幻惑 / 毒 / 地獄 / 音 / 神経 / 混沌 / 魔法 / 出血
  //   注意 58 是「神経」不是「神」——以前缩写成「神」，与 feat 160 的 +神经 对不上。
  const RESIST_ROWS = [
    [50, '火焰'], [51, '冷气'], [52, '电击'], [53, '暗黑'],
    [54, '幻惑'], [55, '毒'], [56, '地狱'], [57, '音'],
    [58, '神经'], [59, '混沌'], [60, '魔法'], [61, '出血'],
  ];

  /** 取面板根（open 之前返回 null） */
  function E_(g) {
    void g;
    return (P && P.root) ? P.root : null;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  const P = {
    root: null,
    kind: null,
    sel: 0,
    charaPage: 0,
    charaCursor: 0,   // 人物信息窗列表页的光标行
    rows: [],          // 当前面板的可选行
    onPick: null,      // 物品选择器的回调
    keyCapture: null,  // 键位设置：正在等待输入的 action id

    // ---------- DOM ----------
    ensure() {
      if (this.root) return this.root;
      // 挂到 body：标题画面（#game 尚未激活）也能打开选项面板
      const stage = document.body;
      const el = document.createElement('div');
      el.id = 'pui';
      el.className = 'pui hidden';
      el.innerHTML = '<div class="pui-box"><div class="pui-head"><span id="pui-title"></span>'
        + '<span class="pui-hint" id="pui-hint">Esc 关闭</span></div>'
        + '<div class="pui-body" id="pui-body"></div></div>';
      stage.appendChild(el);
      el.addEventListener('click', (ev) => {
        const row = ev.target.closest('.pui-row');
        if (row) {
          this.sel = parseInt(row.dataset.i, 10) | 0;
          this.renderSel();
          this.confirm();
        }
      });
      this.root = el;
      this.paperTile();
      return el;
    },

    /**
     * 0-DG：窗口底色与原版的 `window`（interface.bmp）保持一致。
     * 从 interface.bmp 的内部纹理里裁一块可无缝平铺的 144×96（x 周期 18 格×8px、
     * y 周期 12 格×8px，见 uikit.drawWindow），转成 data URI 交给 CSS 的 --pui-tile。
     */
    paperTile() {
      if (this._paperDone) return;
      this._paperDone = true;
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = 144; cv.height = 96;
          cv.getContext('2d').drawImage(img, 64, 96, 144, 96, 0, 0, 144, 96);
          document.documentElement.style.setProperty('--pui-tile', `url(${cv.toDataURL('image/png')})`);
        } catch (e) { /* 取不到纹理就退回 CSS 里的米色 */ }
      };
      img.onerror = () => { };
      img.src = 'assets/graphic/interface.bmp';
    },

    isOpen() { return !!(this.root && !this.root.classList.contains('hidden')); },

    close() {
      if (this.root) this.root.classList.add('hidden');
      this.kind = null;
      this.rows = [];
      this.onPick = null;
      this.keyCapture = null;
      const cb = this.onClose;
      this.onClose = null;
      if (cb) cb();
    },

    /** 打开一个通用面板 */
    open(kind, title, html, opts) {
      // 0-DG：同一时间只允许一个窗口 —— 关掉物品窗口（Canvas）与 NPC/商店/委托板
      if (Elona.UI) {
        if (Elona.UI.invOpen) Elona.UI.closeInventory();
        for (const id of ['npc', 'shop', 'quest']) {
          const el = Elona.UI.el(id);
          if (el) el.classList.add('hidden');
        }
      }
      const el = this.ensure();
      this.kind = kind;
      // 注意：rows 由各面板在调用 open() 之前设置；这里只接受显式覆盖
      if (opts && opts.rows) this.rows = opts.rows;
      this.sel = 0;
      this.onPick = (opts && opts.onPick) || null;
      el.querySelector('#pui-title').textContent = title;
      el.querySelector('#pui-hint').textContent = (opts && opts.hint) || 'Esc 关闭';
      const body = el.querySelector('#pui-body');
      this.onKeyFn = null;                    // 面板切换时清掉上一个面板的专属按键
      body.onclick = null;                    // 清掉上一个面板专属的点击处理（存档槽用）
      body.innerHTML = html;
      el.classList.remove('hidden');
      // opts.cls：祭坛画面（altar-box）等需要整块自定义底图的窗口
      el.querySelector('.pui-box').className = 'pui-box'
        + (opts && opts.wide ? ' wide' : '')
        + (opts && opts.cls ? ' ' + opts.cls : '');
      this.renderSel();
    },

    renderSel() {
      if (!this.root) return;
      const rows = this.root.querySelectorAll('.pui-row');
      rows.forEach((r, i) => r.classList.toggle('sel', i === this.sel));
      const cur = rows[this.sel];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    },

    /**
     * 简单的「选一行」窗口（原版 *label_2683 的通用列表，用在本项目的
     * 搭档编成等场合）。↑/↓ 移动，Enter 确定，Esc 取消。
     */
    chooseRow(title, labels, cb) {
      const rows = (labels || []).map((t, i) => ({ i, t }));
      if (!rows.length) { if (cb) cb(-1); return; }
      const html = rows.map((r) => `<div class="pui-row" data-i="${r.i}">`
        + `<span class="pui-key">${'abcdefghijklmnopqrs'[r.i] || ''}</span>`
        + `<span class="pui-name">${esc(r.t)}</span></div>`).join('');
      this.open('choose', title, html, {
        hint: '↑/↓ 选择　Enter 确定　Esc 取消',
        rows,
        onPick: (row) => {
          this.close();
          if (cb) cb(row.i | 0);
        },
      });
    },

    /** 改名（原版「名前をつける」，289724 → var_63(0)） */
    openRename(g, who, onDone) {
      this.rows = [];
      const cur = (who && typeof who.name === 'string') ? who.name : '';
      const html = '<div class="pui-note">输入新的名字。</div>'
        + '<div style="padding:10px 4px"><input id="rename-in" type="text" maxlength="24" '
        + `value="${esc(cur)}" style="width:100%;box-sizing:border-box;font-size:15px;padding:6px 8px" /></div>`
        + '<div class="pui-dim">Enter 确定 · Esc 取消</div>';
      this.open('rename', '名前 / Name', html, { hint: 'Enter 确定 · Esc 取消' });
      const inp = document.getElementById('rename-in');
      if (!inp) return;
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      const submit = () => {
        const name = String(inp.value || '').trim();
        this.close();
        if (!name) { if (onDone) onDone({ ok: false, message: '名字不能为空。' }); return; }
        const old = who.name;
        who.name = name;
        if (who.cname === old) who.cname = name;   // 显示名沿用旧值时同步
        const msg = `名字改成了「${name}」。`;
        if (g && g.log) g.log(msg);
        if (onDone) onDone({ ok: true, message: msg, name });
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      });
    },

    /** 别名（…の変容 454 → *label_2725 的输入窗，320265-320271） */
    openAlias(g, who, onDone) {
      this.rows = [];
      const cur = (who && typeof who.alias === 'string') ? who.alias : '';
      const html = '<div class="pui-note">输入新的别名（会显示在名字后面的「」里）。</div>'
        + '<div style="padding:10px 4px"><input id="alias-in" type="text" maxlength="24" '
        + `value="${esc(cur)}" style="width:100%;box-sizing:border-box;font-size:15px;padding:6px 8px" /></div>`
        + '<div class="pui-dim">Enter 确定 · Esc 取消</div>';
      this.open('alias', '別名 / Alias', html, { hint: 'Enter 确定 · Esc 取消' });
      const inp = document.getElementById('alias-in');
      if (!inp) return;
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      const submit = () => {
        const alias = String(inp.value || '').trim();
        this.close();
        if (!alias) { if (onDone) onDone({ ok: false }); return; }
        who.alias = alias;
        who.cname = `${who.name || ''}「${alias}」`;   // 原版 var_63(0)+「var_63(1)」
        const msg = `别名改成了「${alias}」。`;
        if (g && g.log) g.log(msg);
        if (onDone) onDone({ ok: true, message: msg, alias });
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      });
    },

    // ======================================================================
    // 0-EP：「誰が使用する？」效果本体（core/itemfx_use.js）用到的通用窗口
    // ======================================================================
    /**
     * 文本输入窗（原版 `*label_2892`，304911 附近；`var_478` 保存结果）。
     *   哲学家面具 59「新しい種族は？」、空白名片 60「新しい職業は？」用它。
     * @param {string} title 标题
     * @param {string} cur   初始值
     * @param {function(string|null)} onDone 确定 → 文本；取消 → null
     * @param {object} [opts] { note }
     */
    openTextInput(title, cur, onDone, opts) {
      const o = opts || {};
      this.rows = [];
      const id = 'pui-textin';
      const html = `<div class="pui-note">${esc(o.note || '请输入文字。')}</div>`
        + '<div style="padding:10px 4px"><input id="' + id + '" type="text" maxlength="24" '
        + `value="${esc(cur || '')}" style="width:100%;box-sizing:border-box;font-size:15px;padding:6px 8px" /></div>`
        + '<div class="pui-dim">Enter 确定 · Esc 取消</div>';
      this.open('textinput', title, html, { hint: 'Enter 确定 · Esc 取消' });
      const inp = document.getElementById(id);
      if (!inp) return;
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (onDone) onDone(v); };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          const v = String(inp.value || '');
          this.onClose = null;
          this.close();
          finish(v);
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          this.onClose = null;
          this.close();
          finish(null);
        }
      });
      this.onClose = () => finish(null);
    },

    /**
     * y/n 确认窗（原版 `*label_2896` 的 `var_487(0,0)=y` / `(0,1)=n` 两行菜单）。
     *   星光笔 62「発動には魔法のインクを N 個消費する。効果を発動する？」用它。
     *   注意原版 `var_444 == 0` 才是「y」，1 是「n」。
     */
    openConfirm(title, onDone, opts) {
      const o = opts || {};
      const yes = o.yes || '是';
      const no = o.no || '否';
      this.rows = [{ v: true, t: yes }, { v: false, t: no }];
      const html = `<div class="pui-note">${esc(title)}</div>`
        + `<div class="pui-row" data-i="0"><span class="pui-key">y</span><span class="pui-name">${esc(yes)}</span></div>`
        + `<div class="pui-row" data-i="1"><span class="pui-key">n</span><span class="pui-name">${esc(no)}</span></div>`;
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (onDone) onDone(!!v); };
      this.open('confirm', o.title || '确认', html, {
        hint: 'y = 是　n = 否　Esc = 否',
        onPick: (row) => {
          this.onClose = null;
          this.close();
          finish(!!row.v);
        },
      });
      this.onKeyFn = (e) => {
        if (e.key === 'y' || e.key === 'Y') {
          this.onClose = null; this.close(); finish(true); return true;
        }
        if (e.key === 'n' || e.key === 'N') {
          this.onClose = null; this.close(); finish(false); return true;
        }
        return false;
      };
      this.onClose = () => finish(false);
    },

    /**
     * 搭档（タッグ）二选一 —— 原版 `txtselecttc 2`（11296-11310）+ `*label_2896`。
     *   var_121(0) =「タッグ左側」、var_121(1) =「タッグ右側」；
     *   选 1 时 `var_244 = var_58(167, var_244)`（换成搭档）。
     *   本项目改成「列出两名成员的名字，选谁就以谁为对象」（差异 A411）。
     * @param {object} g
     * @param {Array<{label:string,chara:object}>} options
     * @param {function(object)} onPick 收到选中的角色；取消时不会调用
     */
    openTagPick(g, options, onPick) {
      const opts = (options || []).filter(Boolean);
      if (!opts.length) {
        if (Elona.ItemFxUse) Elona.ItemFxUse.abort();
        return;
      }
      this.rows = opts.map((o, i) => ({ i, label: o.label }));
      let html = '<div class="pui-note">这个对象处于搭档编成中。要把谁作为对象？</div>';
      opts.forEach((o, i) => {
        html += `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-key">${'abcdefghijklmnopqrs'[i] || ''}</span>`
          + `<span class="pui-name">${esc(o.label)}</span>`
          + `<span class="pui-dim">${i === 0 ? '当前选中的一边' : '另一边'}</span></div>`;
      });
      this.open('tagpick', '搭档选择', html, {
        hint: '↑↓ 选择　Enter 确定　Esc 取消',
        onPick: (row) => {
          this.onClose = null;
          this.close();
          if (onPick) onPick(opts[row.i].chara, row.i);
        },
      });
      // Esc → 原版 `stat == 0` → goto *label_4363（不消耗回合），这里把会话清掉
      this.onClose = () => { if (Elona.ItemFxUse) Elona.ItemFxUse.abort(); };
    },

    /**
     * 0-EP：精神分析窗 —— `gosub *label_2688`（284578）。
     * 能力 626「精神分析」选中邻格目标后打开；内容由 `core/analyze.js` 的 `panel(g, c)` 组装。
     * @param {object} g
     * @param {object} c 目标角色
     */
    openAnalyze(g, c) {
      const A = Elona.Analyze;
      if (!A || !A.panel || !c) {
        if (Elona.UI) Elona.UI.pushMessage('现在无法分析。');
        return;
      }
      let p = null;
      try { p = A.panel(g, c); } catch (e) { p = null; }
      if (!p) { if (Elona.UI) Elona.UI.pushMessage('现在无法分析。'); return; }
      this.rows = [];
      const html = '<div class="pui-note" style="white-space:pre-wrap;line-height:1.7">'
        + esc(p.text || '') + '</div>';
      this.open('analyze', p.title || '精神分析', html, { wide: true, hint: 'Esc 关闭' });
    },

    /**
     * 四次元ポケット（463，340393-340428）。
     * 原版借临时商店文件（shoptmp.s2）当容器；本项目直接用 game.pocket 这个数组，
     * 面板里点一下就「放入 / 取出」。
     */
    openPocket(g) {
      if (!g) return;
      if (!g.pocket) g.pocket = { items: [] };
      const P = g.pocket;
      const p = g.player;
      const cap = P.cap || 10;
      const wLimit = (P.weight || 0) * 10;
      const weightOf = (arr) => arr.reduce((s, it) => s + Math.max(0, (it.f[7] | 0)) * (it.f[0] | 0), 0);
      const rows = [];
      let html = `<div class="pui-note">四次元口袋　收纳 ${P.items.length}/${cap} 种　`
        + `重量 ${weightOf(P.items)}/${wLimit || '—'}</div>`;

      html += '<div class="pui-sep">口袋里的东西（点击取出）</div>';
      if (!P.items.length) html += '<div class="pui-dim">空。</div>';
      P.items.forEach((it, i) => {
        const nm = Elona.ItemDB ? Elona.ItemDB.name(it, 'jp') : ('item ' + it.id);
        html += `<div class="pui-row" data-i="${rows.length}"><span class="pui-key">${'abcdefghijklmnopqrs'[rows.length] || ''}</span>`
          + `<span class="pui-name">${esc(nm)} ×${it.f[0] | 0}</span></div>`;
        rows.push({ take: i });
      });
      html += '<div class="pui-sep">背包（点击放入）</div>';
      const inv = (p && p.inv) || [];
      let shown = 0;
      for (let k = 0; k < inv.length && shown < 24; k++) {
        const it = inv[k];
        if (!it || (it.f[0] | 0) <= 0) continue;
        if (it.eqSlot >= 0) continue;                     // 装备中的不能放
        const nm = Elona.ItemDB ? Elona.ItemDB.name(it, 'jp') : ('item ' + it.id);
        html += `<div class="pui-row" data-i="${rows.length}"><span class="pui-key">${'abcdefghijklmnopqrs'[rows.length] || ''}</span>`
          + `<span class="pui-name">${esc(nm)} ×${it.f[0] | 0}</span></div>`;
        rows.push({ put: k });
        shown++;
      }
      if (!shown) html += '<div class="pui-dim">背包里没有可以放进去的东西。</div>';

      this.open('pocket', '四次元ポケット', html, {
        hint: '↑/↓ 选择　Enter 确定　Esc 关闭',
        rows,
        onPick: (row) => {
          if (!row) return;
          if (row.take !== undefined) {
            const it = P.items[row.take];
            P.items.splice(row.take, 1);
            if (p) p.inv.push(it);
            this.openPocket(g);                            // 重绘
            return;
          }
          if (row.put !== undefined) {
            const it = p.inv[row.put];
            if (!it) { this.openPocket(g); return; }
            if (P.items.length >= cap && P.items.indexOf(it) < 0) {
              if (g.log) g.log('口袋已经装不下更多种类了。');
              this.openPocket(g);
              return;
            }
            const w = weightOf(P.items) + Math.max(0, (it.f[7] | 0)) * (it.f[0] | 0);
            if (wLimit && w > wLimit) {
              if (g.log) g.log('太重了，口袋装不下。');
              this.openPocket(g);
              return;
            }
            p.inv[row.put] = null;
            P.items.push(it);
            this.openPocket(g);
          }
        },
      });
    },

    /** 键盘处理；返回 true 表示已消费 */
    handleKey(e) {
      if (!this.isOpen()) return false;
      // 输入框（许愿等）内不拦截按键，只放行 Esc
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
        return false;
      }
      // 键位设置：捕获下一次按键
      if (this.keyCapture) {
        const k = Elona.Keys.keyName(e);
        if (k === 'Escape') { this.keyCapture = null; this.openOptions(); return true; }
        const r = Elona.Keys.bind(this.keyCapture, k);
        const act = Elona.Keys.actionById(this.keyCapture);
        this.keyCapture = null;
        this.openOptions(r.ok
          ? `已把「${act ? act.label : ''}」绑定到 ${k === ' ' ? 'Space' : k}。`
          : '该键被其它动作占用且无法移出。');
        return true;
      }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
      if (this.onKeyFn && this.onKeyFn(e)) { e.preventDefault(); return true; }
      if (!this.rows.length) return false;
      if (e.key === 'ArrowUp' || e.key === '8') { e.preventDefault(); this.move(-1); return true; }
      if (e.key === 'ArrowDown' || e.key === '2') { e.preventDefault(); this.move(1); return true; }
      if (e.key === 'PageUp' || e.key === '+') { e.preventDefault(); this.move(-10); return true; }
      if (e.key === 'PageDown' || e.key === '-') { e.preventDefault(); this.move(10); return true; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.confirm(); return true; }
      return false;
    },

    move(d) {
      const n = this.rows.length;
      if (!n) return;
      this.sel = (this.sel + d + n) % n;
      this.renderSel();
    },

    confirm() {
      const row = this.rows[this.sel];
      if (row === undefined) return;
      if (this.onPick) this.onPick(row);
    },

    // ======================================================================
    // 角色信息（c → label_2784）—— 0-CK 按原版重做为「多页 + 方向键翻页」
    // ======================================================================
    /**
     * 【0-CK】原版人物窗（*label_2784 + 绘制段 293630-293800）是**分页**的：
     *   · 第 1 页：基本信息（名前/異名/種族/性別/職業 + 年齢/身長/体重/INIT/AP +
     *     レベル/経験/必要値/信仰/所属）、◆能力（元の値）- 潜在能力、◆その他、
     *     ◆Essentialモード、◆プロフィール、◆祝福と呪い、◆各種修正
     *   · 第 2 页起：◆スキルと特殊能力 列表（能力の名称 / Lv(潜在) / 効果），每页 16 行
     *   · 右下角显示 Page.x/y，方向键左右翻页
     *
     * 字段来源（293700-293800）：
     *   名前 var_63(0)、異名 var_63(1)、性別 var_58(8)、身長 var_58(19)cm、体重 var_58(20)kg、
     *   INIT var_58(160)+var_58(198)/var_58(199)、AP var_58(173)(var_58(159))、
     *   レベル var_58(38)、経験 var_58(36)、信仰 var_58(61)、能力 var_82(10+n)/潜力 var_82(610+n)/1e6、
     *   生命力 var_58(2)、マナ var_58(3)、狂気度 var_58(86)、速度 var_58(11)、
     *   名声 var_58(34)、カルマ var_58(49)、技能点 var_58(41)
     */
    async openCharaInfo(g, target) {
      // 0-EP：`*label_2784` 由调用方把 `var_243` 设成目标再 gosub（洞察透镜 72），
      //   所以这里允许传入任意角色；不传就是玩家自己。
      this.charaTarget = target || null;
      const p = this.charaTarget || g.player;
      this.rows = [];
      if (!p) return;
      this.charaPage = 0;
      await this.renderCharaInfo(g);
    },

    /** 技能描述表（actions.json 的 desc）缓存 */
    async skillDescTable() {
      if (this._skillDesc) return this._skillDesc;
      try {
        this._skillDesc = (await Elona.Data.table('actions')) || {};
      } catch (e) { this._skillDesc = {}; }
      return this._skillDesc;
    },

    /** 潜力 → 评价（原版 233091-233130 的七档） */
    attrRank(pot) {
      const v = pot | 0;
      if (v >= 400) return 'Supreme';
      if (v >= 300) return 'Amazing';
      if (v >= 200) return 'Superb';
      if (v >= 150) return 'Great';
      if (v >= 100) return 'Good';
      if (v >= 50) return 'Bad';
      return 'Hopeless';
    },

    /** 技能列表：100..399 中已习得的技能，按 id 升序（原版按此顺序列出） */
    async skillRows(p) {
      const names = (await Elona.Data.table('skills')).skillNames || {};
      const descs = await this.skillDescTable();
      const out = [];
      const pot = p.potential || {};
      for (let id = 100; id < 400; id++) {
        const raw = pot[id] | 0;
        if (!raw) continue;
        const nm = names[String(id)] || {};
        const act = descs[String(id)] || {};
        out.push({
          id,
          lv: idiv(raw, 1000000),
          exp: idiv(raw % 1000000, 1000),
          potv: raw % 1000,               // 成长率 = 原版「潜在 %」
          // 汉化：技能名读同层级的 ch（skills.json 的 skillNames 为 {jp, en, ch}）
          name: nm.ch || nm.jp || (act.name && (act.name.ch || act.name.jp)) || ('技能 ' + id),
          en: nm.en || (act.name && act.name.en) || '',
          desc: (act.desc && (act.desc.ch || act.desc.jp)) || '',
        });
      }
      return out;
    },

    /** 渲染人物信息（按 this.charaPage 分页；0-DF 增加耐性 / 魔法页与「,」锁定） */
    async renderCharaInfo(g) {
      // 0-EP：洞察透镜 72 要显示**别人**的信息窗（原版 `var_243 = var_244`）
      const p = this.charaTarget || g.player;
      if (!p) return;
      const skills = await this.skillRows(p);
      const table = (await Elona.Data.table('skills')) || {};
      const names = table.skillNames || {};
      const descs = await this.skillDescTable();

      // 列表页：技能 → 耐性 → 魔法（每页 16 项）
      const lists = [];
      lists.push({
        kind: 'skill', title: 'スキルと特殊能力',
        items: skills.map((r) => ({
          watchKind: 'skill', id: r.id, label: r.name,
          sub: `${r.lv}.${String(r.exp).padStart(3, '0')}(${r.potv}%)`,
          desc: r.desc || '',
        })),
      });
      // 0-EU：耐性页此前只有名字（`sub` 恒为空、说明是内部的 var_82 编号），
      //   读起来像「没有数据」。这里补上 值 / 潜在 / 评价 与 actions.json 的说明文本。
      lists.push({
        kind: 'resist', title: '耐性',
        items: RESIST_ROWS.map(([id, label]) => {
          const v = p.skill ? (p.skill(id) | 0) : 0;
          const raw = (p.potential && p.potential[id]) | 0;
          const potv = idiv(raw % 1000000, 1000);
          const act = descs[String(id)] || {};
          // 原版耐性是 var_82(50..60)：0 = 完全没有，100 = 普通，>100 = 有耐性。
          // 显示成「数值 + 档位」，一眼能看出是「真的没数据」还是「本来就没有耐性」。
          const rank = v <= 0 ? '无' : (v < 100 ? '弱点' : (v === 100 ? '普通' : (v < 200 ? '耐性' : '强耐性')));
          return {
            watchKind: 'resist', id,
            label,
            sub: potv ? `${v}（${rank}）潜力 ${potv}%` : `${v}（${rank}）`,
            desc: (act.desc && (act.desc.ch || act.desc.jp))
              || (act.name && (act.name.ch || act.name.jp)) || '属性耐性',
          };
        }),
      });
      // 0-EU：魔法页改为**始终存在**（没学会时显示空列表提示），否则新角色
      //   翻不到这一页，会以为「法术完全没有显示」。
      const st = p.spellStock || [];
      const spells = [];
      for (let i = 0; i < 200; i++) {
        const n = st[i] | 0;
        if (n <= 0) continue;
        const sid = 400 + i;
        const nm = names[String(sid)] || {};
        const act = descs[String(sid)] || {};
        spells.push({
          watchKind: 'spell', id: i,
          label: nm.ch || nm.jp || nm.en || (act.name && (act.name.ch || act.name.jp)) || ('魔法 ' + sid),
          sub: 'x' + n,
          desc: (act.desc && (act.desc.ch || act.desc.jp)) || '',
        });
      }
      lists.push({ kind: 'spell', title: '魔法', items: spells });

      const per = 16;
      const pages = [{ info: true }];
      for (let li = 0; li < lists.length; li++) {
        const n = Math.max(1, Math.ceil(lists[li].items.length / per));
        for (let pg = 0; pg < n; pg++) pages.push({ li, pg });
      }
      const total = pages.length;
      const cur = Math.max(0, Math.min(total - 1, this.charaPage | 0));
      this.charaPage = cur;
      const page = pages[cur];

      // 第 1 页：基本信息
      if (page.info) {
        this.rows = [];
        this.open('charainfo', `角色信息　Page.${cur + 1}/${total}`,
          this.charaInfoPage1(g, p),
          { wide: true, cls: 'ci-sheet', hint: '← → 翻页　Esc 关闭' });
        this.onKeyFn = (e) => this.charaNav(e, g, cur, total);
        return;
      }

      const list = lists[page.li];
      const from = page.pg * per;
      const slice = list.items.slice(from, from + per);
      this.charaCursor = Math.max(0, Math.min(slice.length - 1, this.charaCursor | 0));
      this.rows = [];
      this.open('charainfo',
        `角色信息　Page.${cur + 1}/${total}　${list.title}`,
        this.charaListPage(list, slice, from, list.items.length, p),
        { wide: true, hint: '↑↓ 选择　, 锁定/解除　← → 翻页　Esc 关闭' });
      this.highlightCharaRows();
      this.onKeyFn = (e) => {
        if (this.charaNav(e, g, cur, total)) return true;
        if (e.key === 'ArrowUp' || e.key === '8') { this.moveCharaCursor(-1); return true; }
        if (e.key === 'ArrowDown' || e.key === '2') { this.moveCharaCursor(1); return true; }
        if (e.key === ',' || e.key === '，') { this.toggleWatchRow(slice[this.charaCursor], g); return true; }
        if (e.key === 'Enter' || e.key === ' ') { this.toggleWatchRow(slice[this.charaCursor], g); return true; }
        const k = 'abcdefghijklmnop'.indexOf(e.key);
        if (k >= 0 && k < slice.length) {
          this.charaCursor = k;
          this.highlightCharaRows();
          return true;
        }
        return false;
      };
    },

    /** 列表页翻页（← →） */
    charaNav(e, g, cur, total) {
      if (e.key === 'ArrowLeft' && cur > 0) {
        this.charaPage = cur - 1; this.charaCursor = 0;
        this.renderCharaInfo(g);
        return true;
      }
      if (e.key === 'ArrowRight' && cur < total - 1) {
        this.charaPage = cur + 1; this.charaCursor = 0;
        this.renderCharaInfo(g);
        return true;
      }
      return false;
    },

    /** 光标在列表页内上下移动（只改高亮，不重建 DOM） */
    moveCharaCursor(d) {
      const rows = this.root ? this.root.querySelectorAll('tr.ci-item') : [];
      if (!rows.length) return;
      this.charaCursor = (this.charaCursor + d + rows.length) % rows.length;
      this.highlightCharaRows();
    },

    highlightCharaRows() {
      if (!this.root) return;
      const rows = this.root.querySelectorAll('tr.ci-item');
      rows.forEach((r, i) => r.classList.toggle('ci-sel', i === (this.charaCursor | 0)));
    },

    /**
     * 锁定/解除一项（原版：人物信息窗内把项目加入「常时表示」列表）。
     * 锁定后立即重绘本页，★ 与高亮随之更新。
     */
    toggleWatchRow(row, g) {
      if (!row || !Elona.Hud) return;
      const on = Elona.Hud.toggleWatch(row.watchKind, row.id, row.label);
      const keep = this.charaCursor | 0;
      this.renderCharaInfo(g);
      this.charaCursor = keep;
      this.highlightCharaRows();
      if (Elona.UI && Elona.UI.pushMessage) {
        Elona.UI.pushMessage(on ? `锁定监视：${row.label}` : `解除监视：${row.label}`);
      }
    },

    /** 第 1 页：基本信息 / 能力 / Essential / その他 / プロフィール / 祝福 / 修正 */
    /** 0-FH：var_58(161..165) → 中文经历 5 行（profiletext.js） */
    profileLines(p, g) {
      if (Elona.ProfileText) {
        const t = g && g.profileTable ? g.profileTable : (this._profileTable || null);
        return Elona.ProfileText.of(p, t);
      }
      return p.profile ? [p.profile] : [];
    },
    profileHtml(p, g) {
      const ls = this.profileLines(p, g);
      return ls.length ? ls.map(esc).join('<br>') : '（还没有记录）';
    },

    /**
     * 第 1 页：与角色创建总览同款的羊皮纸三栏布局（0-FH）。
     *   顶部三组基本信息 + 右上角立绘；
     *   左「能力 / 其它信息」、中「Essential / 经历」、右「祝福与诅咒 / 各种修正」；
     *   底部的扩展段（天气 / 以太病 / 耐性 / 觉醒 / 破防）保留原有数据，只是横向压缩。
     */
    /**
     * 0-FI：第 1 页直接调用 view/charcreate.js 的共享 summaryHtml()，
     *   与创建人物最后的总览窗口使用同一段 HTML / 同一套 cc-sum-* 样式。
     *   用户要求去掉天气 / 以太病 / 耐性 / 破防 / AP / 觉醒等扩展字段，
     *   这些数据仍在各自的列表页（技能 / 耐性 / 魔法）里可查。
     */
    charaInfoPage1(g, p) {
      const need = (Elona.Stats && Elona.Stats.expNeeded) ? Elona.Stats.expNeeded(p) : (p.get(36) | 0);
      const gods = (Elona.MapFeat && Elona.MapFeat.GOD_NAMES) || null;
      const godName = gods ? (gods[p.get(61) | 0] || '—') : '—';
      const mode = Elona.GameMode ? Elona.GameMode.get(g) : { zh: '本质' };
      const face = (Elona.CharCreate && Elona.CharCreate.faceTileOf)
        ? Elona.CharCreate.faceTileOf((p.get(8) | 0), (p.get(13) | 0))
        : { img: 'face1.bmp', x: 0, y: 0 };
      const ATTR = (Elona.CharCreate && Elona.CharCreate.ATTRS) || [
        { ch: '力量', icon: '◆', color: '#1b3f8f' }, { ch: '耐久', icon: '◆', color: '#1b3f8f' },
        { ch: '灵巧', icon: '◆', color: '#4a7a2a' }, { ch: '感知', icon: '◆', color: '#4a7a2a' },
        { ch: '学习', icon: '◆', color: '#2b5fa8' }, { ch: '意志', icon: '◆', color: '#8e8a1e' },
        { ch: '魔力', icon: '◆', color: '#128ca0' }, { ch: '魅力', icon: '◆', color: '#bb2020' },
      ];
      const attrs = ATTR.map((a, i) => {
        const id = 10 + i;
        const v = p.skill ? (p.skill(id) | 0) : 0;
        const potv = idiv(((p.potential && p.potential[id]) | 0) % 1000000, 1000);
        return { icon: a.icon, color: a.color, ch: a.ch, value: v, rank: this.attrRank(potv) };
      });
      const timeText = `${g.getV65(11) | 0}/${g.getV65(12) | 0} ${(g.getV65(13) | 0)}:00`;
      const weight = (Elona.Feat && Elona.Feat.invWeight) ? Elona.Feat.invWeight(p) : 0;
      const misc = [
        `荷车重量 ${weight} / 上限 ${(p.get(53) | 0) || 140} s`,
        `装备重量 ${weight}`,
        `回合 ${g.turn | 0} / 总时间 ${timeText}`,
        '证明：无持续效果',
      ];
      if ((g.getV65(850) | 0) === 47) {
        const cond = p.get(197) | 0;
        const names = (Elona.Vehicle && Elona.Vehicle.SHIP_CONDITION) || null;
        misc.push(`船只状态：${names ? (names[cond] || '') : ''}（${cond}）`);
      }
      const html = Elona.CharCreate.summaryHtml({
        face, name: p.name || '—', nameInput: false,
        head: [
          ['cc-sum-c1', [['姓名', ''], ['别名', esc(p.title || p.alias || '无')],
            ['种族', esc(Elona.RaceName ? Elona.RaceName.zh(p.raceName) : (p.raceName || '—'))],
            ['性别', (p.get(8) | 0) === 1 ? '女性' : '男性'],
            ['职业', esc(Elona.RaceName ? Elona.RaceName.classZh(p.className) : (p.className || '—'))]]],
          ['cc-sum-c2', [['年龄', '—'], ['身高', `${p.get(19) | 0} cm`],
            ['体重', `${p.get(20) | 0} kg`],
            ['INIT', `${(p.get(160) | 0) + (p.get(198) | 0)}/${p.get(199) | 0}`],
            ['AP', `${p.get(173) | 0}(${p.get(159) | 0})`]]],
          ['cc-sum-c3', [['等级', String(p.level | 0)], ['经验', String(p.get(36) | 0)],
            ['所需经验', String(need)], ['信仰', esc(godName)], ['所属', esc(p.guild || '无')]]],
        ],
        attrs, misc,
        modeName: mode.zh,
        essential: [
          `HP/MP　${p.hp | 0}/${p.hpMax | 0}　${p.mp | 0}/${p.mpMax | 0}`,
          `生命力　${p.get(2) | 0}(${p.get(52) | 0})`,
          `魔力　${p.get(3) | 0}(${p.get(53) | 0})`,
          `疯狂度　${p.get(86) | 0}%`,
          `速度　${p.get(11) | 0}`,
          `名声　${p.get(34) | 0}　业力　${p.get(49) | 0}`,
          `战力评价　${this.combatRating(p) | 0} 阶相当`,
        ],
        profile: this.profileLines(p, g).length ? this.profileLines(p, g) : ['（还没有记录）'],
        bless: 15,
        fix: [
          [`格斗　${this.meleeText(p)}`, `减轻　${p.get(48) | 0}%`],
          [`魔法威力　${this.magicPowerText(p)}`, `命中　${this.hitText(p)}`,
            `回避　${this.evadeText(p)}`],
        ],
      });
      return `<div class="ci-sheet-wrap">${html}</div>`;
    },

    /** 瞄准确认后要继续发动的能力 id（openAbilities → openAim → 确认） */
    pendingAbility: 0,
    /** 瞄准确认后要继续咏唱的地面法术 id（类别 7000，315731 的 *label_2670） */
    pendingSpell: 0,
    pendingSpellRange: 1,
    /**
     * 0-EP：投掷 —— 选中物品后记下背包下标，进入 `*` 键式的自由光标，
     * 回车锁定后由 `main.js` 的 `handleAimKey` 调 `game.throwAt(x, y)`。
     * -1 = 没有待投掷的物品（原版这里是「选目标 → 抛物线」）。
     */
    pendingThrow: -1,

    /** 列表页（技能 / 耐性 / 魔法共用的 16 行表格） */
    charaListPage(list, slice, from, totalItems, p) {
      const letters = 'abcdefghijklmnop';
      const hud = Elona.Hud;
      let html = `<div class="ci-sec">◆ ${esc(list.title)}（${totalItems}）</div>`
        + '<table class="ci-table ci-skills"><tr><th></th><th>名称</th><th>値</th><th>効果</th></tr>';
      for (let i = 0; i < slice.length; i++) {
        const r = slice[i];
        const locked = hud && hud.isWatched ? hud.isWatched(r.watchKind, r.id) : false;
        html += `<tr class="ci-item${locked ? ' ci-on' : ''}">`
          + `<td class="ci-key">${letters[i] || ''}</td>`
          + `<td class="ci-skill-name">${locked ? '★' : ''}${esc(r.label)}</td>`
          + `<td class="ci-nums">${esc(r.sub || '')}</td>`
          + `<td class="ci-skill-desc">${esc(r.desc || '')}</td></tr>`;
      }
      if (!slice.length) {
        const empty = list.kind === 'spell' ? '还没有学会任何魔法。' : '没有条目。';
        html += `<tr><td></td><td colspan="3" class="ci-dim">${empty}</td></tr>`;
      }
      html += '</table>';
      html += `<div class="ci-foot">↑↓ 移动　, 锁定/解除　— 锁定的项目会常驻显示在视野左侧`
        + `（第 ${from + 1}–${from + slice.length} 项）</div>`;
      if (list.kind === 'skill' && p) {
        html += `<div class="ci-foot">剩余 ${p.get(41) | 0} 点可以分配到技能</div>`;
      }
      return html;
    },

    // ======================================================================
    // 0-CL：能力の発動窗口（a 键 / key_apply，原版 *label_2739 的 ability 段）
    //   列表来自 Elona.Ability.list（技能 300/301 + 已觉醒的 600..879 能力），
    //   每项显示 能力の名称 / コスト(Sp) / 能力の効果（actions.json desc），
    //   a–p 快捷键选择发动（g.useAbility），←→ 翻页，16 行/页。
    // ======================================================================
    /**
     * 0-CQ：「力の覚醒」—— AP 天赋菜单（410400-411925）
     *
     * 原版由特定 NPC（老师）提供，菜单三层：
     *   自分の力 / 仲間の力 → 能力を伸ばす・フィート取得・魔法や技能の会得・
     *   戦闘スタイル変更・品質上昇・スキルボーナス
     * 本实现拍平成一页表格（a~p 快捷键选条目，Tab 切换对象，←→ 翻页）。
     */
    async openAwaken(g, charaIndex) {
      if (!Elona.AP) return;
      const idx = (charaIndex === undefined || charaIndex === null)
        ? (this.awakenTarget | 0) : (charaIndex | 0);
      const c = g.charas[idx] || g.player;
      this.awakenTarget = c.index | 0;
      const data = Elona.AP.menu(g, c);
      const flat = [];
      for (const grp of data.groups) for (const it of grp.items) flat.push({ grp: grp.title, it });

      const per = 16;
      const total = Math.max(1, Math.ceil(flat.length / per));
      const cur = Math.max(0, Math.min(total - 1, this.awakenPage | 0));
      this.awakenPage = cur;
      const slice = flat.slice(cur * per, cur * per + per);
      const letters = 'abcdefghijklmnop';

      let html = `<div class="ci-dim">対象：${esc(c.name || 'あなた')}　`
        + `AP：<b>${data.ap}</b> / ${Elona.AP.AP_MAX}　`
        + `品質：${c.get(25) | 0}　適正距離：${c.get(208) | 0}　移動確率：${c.get(207) | 0}%`
        + `　（Tab 切换对象）</div>`;
      html += '<table class="ci-table ci-skills"><tr><th></th><th>分類</th><th>名称</th>'
        + '<th>効果</th><th>消費</th><th>状態</th></tr>';
      for (let i = 0; i < slice.length; i++) {
        const { grp, it } = slice[i];
        const st = it.owned ? '習得済み' : (it.disabled ? (it.reason || '不可') : '可');
        const cls = it.owned ? 'ci-on' : (it.disabled ? 'ci-dim' : '');
        html += `<tr class="${cls}"><td class="ci-key">${letters[i] || ''}</td>`
          + `<td class="ci-dim">${esc(grp)}</td>`
          + `<td class="ci-skill-name">${esc(it.label)}</td>`
          + `<td class="ci-skill-desc">${esc(it.note || '')}</td>`
          + `<td class="ci-nums">${it.cost} AP</td>`
          + `<td class="ci-dim">${esc(st)}</td></tr>`;
      }
      if (!slice.length) html += '<tr><td></td><td colspan="5" class="ci-dim">没有可选项。</td></tr>';
      html += '</table>';

      this.open('awaken', `力の覚醒　Page.${cur + 1}/${total}`, html,
        { wide: true, hint: 'a~p 选择　Tab 切换对象　← → 翻页　Esc 关闭' });

      const roster = [g.player].concat(
        (g.charas || []).slice(1, 16).filter((m) => m && (m.get(0) | 0) === 1));

      this.onKeyFn = (e) => {
        if (e.key === 'ArrowLeft' && cur > 0) { this.awakenPage = cur - 1; this.openAwaken(g, this.awakenTarget); return true; }
        if (e.key === 'ArrowRight' && cur < total - 1) { this.awakenPage = cur + 1; this.openAwaken(g, this.awakenTarget); return true; }
        if (e.key === 'Tab') {
          const pos = roster.findIndex((m) => (m.index | 0) === this.awakenTarget);
          const nxt = roster[(pos + 1) % Math.max(1, roster.length)];
          if (nxt) { this.awakenPage = 0; this.openAwaken(g, nxt.index | 0); }
          return true;
        }
        const k = 'abcdefghijklmnopqrstuvwxyz'.indexOf(e.key);
        if (k >= 0 && k < slice.length) {
          const { it } = slice[k];
          const r = Elona.AP.spend(g, c, it);
          this.pushMessage(r.message);
          this.openAwaken(g, this.awakenTarget);
          return true;
        }
        return false;
      };
    },

    async openAbilities(g) {
      if (!Elona.Ability) return;
      if (Elona.Feat && Elona.Feat.unlockAbilities) Elona.Feat.unlockAbilities(g.player, g);
      const list = Elona.Ability.list(g, g.player).filter((a) => a.id >= 300);
      this.abilPage = Math.max(0, Math.min(this.abilPage | 0, Math.max(0, Math.ceil(list.length / 16) - 1)));
      const per = 16;
      const total = Math.max(1, Math.ceil(list.length / per));
      const cur = Math.max(0, Math.min(total - 1, this.abilPage | 0));
      this.abilPage = cur;
      const slice = list.slice(cur * per, cur * per + per);
      const letters = 'abcdefghijklmnop';
      const descs = await this.skillDescTable();

      let html = '<table class="ci-table ci-skills"><tr><th></th><th>能力の名称</th>'
        + '<th>コスト</th><th>能力の効果</th></tr>';
      for (let i = 0; i < slice.length; i++) {
        const a = slice[i];
        const d = (descs[String(a.id)] || {}).desc || {};
        html += `<tr><td class="ci-key">${letters[i] || ''}</td>`
          + `<td class="ci-skill-name">${esc(a.name)}</td>`
          + `<td class="ci-nums">${a.cost} Sp</td>`
          + `<td class="ci-skill-desc">${esc(d.ch || d.jp || '')}</td></tr>`;
      }
      if (!slice.length) {
        html += '<tr><td></td><td colspan="3" class="ci-dim">没有已觉醒的特殊能力。</td></tr>';
      }
      html += '</table>';

      // 翻页与快捷键（open 之后设置）
      this.open('abilities', `能力の発動　Page.${cur + 1}/${total}`, html,
        { wide: true, hint: 'a~p 发动　← → 翻页　Esc 关闭' });
      this.onKeyFn = (e) => {
        if (e.key === 'ArrowLeft' && cur > 0) { this.abilPage = cur - 1; this.openAbilities(g); return true; }
        if (e.key === 'ArrowRight' && cur < total - 1) { this.abilPage = cur + 1; this.openAbilities(g); return true; }
        const k = 'abcdefghijklmnopqrstuvwxyz'.indexOf(e.key);
        if (k >= 0 && k < slice.length) {
          const target = slice[k];
          // 0-CW：ネクロフォース(743) 需要二次菜单（txtsetnecro 6，332789-332795）
          if (target.id === 743) { this.openNecroMenu(g); return true; }
          // 0-DC：乗馬(301) 需要先选一个同伴（319690-319760）
          if (target.id === 301) { this.openRidePick(g); return true; }
          // 0-DH：窃盗(300) 先弹物品选择窗（var_486 = 27 → *label_3026，319566-319596）
          if (target.id === 300 && g.stealTargets && g.stealTargets(g.player).length) {
            this.openStealSelect(g);
            return true;
          }
          const r = g.useAbility(target.id);
          // `request` 是「还要再选一次」的约定，之前完全没处理 ——
          // 684（呼び寄せ/待機）就是这样「按下去什么都不发生」的。
          if (r && r.request === 'ally-select') {
            const list = Elona.Companion.allies(g).filter((c) => (c.index | 0) !== 0 && (c.get(0) | 0) !== 6);
            this.openAllySelect(g, '对谁使用？', list, (ally) => {
              const r2 = g.useAbility(target.id, { target: ally });
              if (r2 && r2.message) this.pushMessage(r2.message);
              for (const m of ((r2 && r2.messages) || [])) this.pushMessage(m);
            }, 'a~p 选择　Esc 关闭');
            return true;
          }
          // 需要目标但视野内没有 / 没有锁定 → 打开瞄准（*label_2670）
          if (r && r.reason === 'need-target' && r.aimChara) {
            this.pendingAbility = target.id;
            this.close();
            this.openAim(g);
            return true;
          }
          // 近距离能力（类别 8000）没有锁定目标 → 315670「どの方向？」
          //   方向键 / 小键盘 1..9 选邻格，由 core/dirsel.js 结算后接着发动
          //   0-EP：626 精神分析（类别 10000）也走这一档，但它允许「对自己」（回车）
          if (r && r.reason === 'need-direction' && Elona.DirSel) {
            this.close();
            Elona.DirSel.start(g, target.id, { allowSelf: !!r.allowSelf });
            this.pushMessage(r.allowSelf
              ? '对谁使用？（方向键 / 小键盘 1-9 选人，回车 = 自己，Esc 取消）'
              : '哪个方向？（方向键 / 小键盘 1-9，Esc 取消）');
            return true;
          }
          // 0-EP：626 精神分析 —— 目标处于タッグ编成中 → 318832 的 txtselecttc 2 二选一
          if (r && r.reason === 'tag-pick') {
            this.close();
            this.openTagPick(g, r.options, (chara) => {
              const r2 = g.useAbility(target.id, { target: chara, resume: true, tagPicked: true });
              if (r2 && r2.request === 'analyze') this.openAnalyze(g, r2.target);
              else {
                if (r2 && r2.message) this.pushMessage(r2.message);
                for (const m of ((r2 && r2.messages) || [])) this.pushMessage(m);
              }
            });
            return true;
          }
          // 0-EP：626 精神分析 → 分析窗（`gosub *label_2688`，284578）
          if (r && r.request === 'analyze' && r.target) {
            this.close();
            this.openAnalyze(g, r.target);
            return true;
          }
          if (r && r.message) this.pushMessage(r.message);
          for (const m of ((r && r.messages) || [])) this.pushMessage(m);
          this.close();
          return true;
        }
        return false;
      };
    },

    /**
     * 收容所面板（233005-233023 的状态显示 + 233293 的「檻から出して収容」）。
     */
    openCamp(g) {
      const C = Elona.Camp;
      const st = C ? C.status(g) : null;
      if (!st) {
        this.open('camp', '収容所', '<div class="pui-note">ここには収容所がない。</div>', {});
        return;
      }
      // 囚犯名单（cbit 1041）
      const inmates = [];
      const list = (g.charas || []);
      for (let i = 1; i < list.length; i++) {
        const c = list[i];
        if (c && Elona.Status && Elona.Status.cbit(c, 1041)) inmates.push(c);
      }
      if (g.propertySites) {
        for (const k of Object.keys(g.propertySites)) {
          const site = g.propertySites[k];
          if (site && site.inmates) for (const c of site.inmates) inmates.push(c);
        }
      }
      const lvlName = (C.TOIL_LEVELS[st.toilLv] || C.TOIL_LEVELS[0]).jp;
      let html = `<div class="pui-note">現在の収容者は <b>${st.count}</b> 体 / ${st.max} 体、`
        + `労働強度は ${st.toilLv}（${esc(lvlName)}）、`
        + `溜まっている労働エナジーは ${st.toilEnergy} / ${st.energyMax} だ。`
        + `<br>（收容 ${st.count}/${st.max} 人，劳动强度 ${st.toilLv}（${esc(lvlName)}），`
        + `蓄积能量 ${st.toilEnergy}/${st.energyMax}）</div>`;
      // 囚犯名单
      html += '<div class="pui-sub">収容者（Inmates）</div>';
      html += '<table class="pui-table"><tr><th>No.</th><th>囚人</th><th>状態</th></tr>';
      inmates.forEach((c, i) => {
        const key = 'abcdefghijklmnop'[i] || String(i + 1);
        html += `<tr class="pui-row" data-act="release" data-i="${i}">`
          + `<td>${key}</td>`
          + `<td>${esc(c.name || '囚人')}</td>`
          + `<td>${esc(c.get(0) === 1 ? '生存' : '死亡')}</td></tr>`;
      });
      html += '</table>';
      html += '<div class="pui-sub">操作（Operations）</div>';
      html += '<table class="pui-table">'
        + '<tr class="pui-row" data-act="toil"><td>x</td>'
        + `<td>労働強度の変更（Change Toil-Lv）<br>`
        + `<span class="ci-dim">Current: Lv${st.toilLv} ${esc(lvlName)}</span></td></tr>`
        + '<tr class="pui-row" data-act="exchange"><td>z</td>'
        + `<td>労働エナジー交換（Exchange Toil-Energy）<br>`
        + `<span class="ci-dim">Toil-Energy: ${st.toilEnergy} / ${st.energyMax}</span></td></tr>`
        + '</table>';
      this.open('camp', '収容所', html, {
        hint: 'a~p 放出　x 強度変更　z エネルギー交換　Esc 閉じる',
      });
      this.onKeyFn = (e) => {
        const k = 'abcdefghijklmnop'.indexOf(e.key);
        if (k >= 0 && k < inmates.length) {
          const r = C.release(g, inmates[k]);
          if (r && r.message) this.pushMessage(r.message);
          this.openCamp(g);
          return true;
        }
        if (e.key === 'x') { this.openCampToil(g); return true; }
        if (e.key === 'z') { this.openCampExchange(g); return true; }
        return false;
      };
    },

    /**
     * 骑乘对象选择（能力 301「乗馬」，319690-319760）。
     * 列出槽 1..15 的同伴；选定后进入 3 项菜单（取る / 乗せる / 取消）。
     */
    openRidePick(g) {
      const R = Elona.Riding;
      if (!R) return;
      const list = R.candidates(g);
      if (!list.length) {
        this.open('ride-pick', '騎乗', '<div class="pui-note">这里没有可以骑乘的同伴。</div>', {});
        return;
      }
      const letters = 'abcdefghijklmnop';
      let html = '<table class="pui-table"><tr><th>No.</th><th>名前</th><th>速度</th></tr>';
      list.forEach((c, i) => {
        html += `<tr class="pui-row" data-i="${i}"><td>${letters[i] || ''}</td>`
          + `<td>${esc(c.name || '')}</td><td>${c.get(11) | 0}</td></tr>`;
      });
      html += '</table>';
      this.open('ride-pick', '騎乗', html, { hint: 'a~p 選択　Esc 閉じる' });
      this.onKeyFn = (e) => {
        const k = letters.indexOf(e.key);
        if (k < 0 || k >= list.length) return false;
        this.openRide(g, list[k]);
        return true;
      };
    },

    /**
     * 骑乘面板（319749-319767 + txtsetride 11104-11121）。
     * 3 项：キャンセル / 乗る（你骑它）/ 乗せる（它骑你）。
     */
    openRide(g, npc) {
      const R = Elona.Riding;
      if (!R || !npc) return;
      const chk = R.canRide(g, npc);
      if (!chk.ok) {
        this.open('ride', '騎乗', `<div class="pui-note">${esc(chk.message || '')}</div>`, {});
        return;
      }
      const items = R.menu();
      let html = `<div class="pui-note">${esc(npc.name || '')}</div>`;
      html += '<table class="pui-table"><tr><th>No.</th><th>選択肢</th></tr>';
      items.forEach((it, i) => {
        html += `<tr class="pui-row" data-i="${it.mode}"><td>${'abc'[i]}</td><td>${esc(it.label)}</td></tr>`;
      });
      html += '</table>';
      this.open('ride', '騎乗', html, { hint: 'a~c 選択　Esc 閉じる' });
      this.onKeyFn = (e) => {
        const k = 'abc'.indexOf(e.key);
        if (k < 0 || k >= items.length) return false;
        const mode = items[k].mode;
        if (mode < 0) { this.close(); return true; }
        const r = R.begin(g, npc, mode);
        if (r && r.message) this.pushMessage(r.message);
        if (r && r.extra) for (const m of r.extra) this.pushMessage(m);
        this.close();
        return true;
      };
    },

    /**
     * 劳动强度变更面板（234164-234195，txtsetwlevel 5）。
     */
    openCampToil(g) {
      const C = Elona.Camp;
      const st = C ? C.status(g) : null;
      if (!st) {
        this.open('camp-toil', '労働強度の変更', '<div class="pui-note">ここには収容所がない。</div>', {});
        return;
      }
      let html = `<div class="pui-note">現在の労働強度：<b>${st.toilLv}</b></div>`;
      html += '<table class="pui-table"><tr><th>No.</th><th>強度</th><th>説明</th></tr>';
      C.TOIL_LEVELS.forEach((t, i) => {
        const key = 'abcd'[i];
        const cur = t.lv === st.toilLv ? '（現在）' : '';
        html += `<tr class="pui-row" data-i="${t.lv}">`
          + `<td>${key}</td><td>${t.lv}</td>`
          + `<td>${esc(t.jp)}${cur}<br><span class="ci-dim">${esc(t.en)}</span></td></tr>`;
      });
      html += '</table>';
      this.open('camp-toil', '労働強度の変更', html, { hint: 'a~d 変更　Esc 閉じる' });
      this.onKeyFn = (e) => {
        const k = 'abcd'.indexOf(e.key);
        if (k >= 0 && k < C.TOIL_LEVELS.length) {
          const r = C.setToilLevel(g, C.TOIL_LEVELS[k].lv);
          if (r && r.message) this.pushMessage(r.message);
          this.openCamp(g);
          return true;
        }
        return false;
      };
    },

    /**
     * 劳动能量兑换面板（234197-234433，txtsetwpoint 11）。
     */
    openCampExchange(g) {
      const C = Elona.Camp;
      const st = C ? C.status(g) : null;
      if (!st) {
        this.open('camp-exchange', '労働エナジー交換', '<div class="pui-note">ここには収容所がない。</div>', {});
        return;
      }
      let html = `<div class="pui-note">労働エナジー：<b>${st.toilEnergy}</b> / ${st.energyMax}</div>`;
      html += '<table class="pui-table"><tr><th>No.</th><th>商品</th><th>必要エネルギー</th></tr>';
      C.EXCHANGE_ITEMS.forEach((e, i) => {
        const key = 'abcdefghij'[i];
        html += `<tr class="pui-row" data-i="${e.idx}"><td>${key}</td>`
          + `<td>${esc(e.jp)}<br><span class="ci-dim">${esc(e.en)}</span></td>`
          + `<td>${e.cost}</td></tr>`;
      });
      html += '</table>';
      this.open('camp-exchange', '労働エナジー交換', html, { hint: 'a~j 交換　Esc 閉じる' });
      this.onKeyFn = (e) => {
        const k = 'abcdefghij'.indexOf(e.key);
        if (k >= 0 && k < C.EXCHANGE_ITEMS.length) {
          const r = C.exchangeEnergy(g, C.EXCHANGE_ITEMS[k].idx);
          if (r && r.message) this.pushMessage(r.message);
          this.openCampExchange(g);
          return true;
        }
        return false;
      };
    },

    /**
     * 深淵魔術菜单 —— `txtsetabyss 10` + `*label_2896`（314050-314060）。
     * 10 项：閉じる + 9 个法术（未达深淵魔力门槛的显示为「<深淵魔力N以上で解放>」）。
     */
    openAbyssMenu(g) {
      const items = (Elona.Abyss && Elona.Abyss.menu(g)) || [];
      const pw = Elona.Abyss ? Elona.Abyss.power(g) : 0;
      let html = `<div class="pui-note">深淵魔術書 —— 深淵魔力: <b>${pw}</b></div>`;
      html += '<table class="pui-table"><tr><th>No.</th><th>術</th></tr>';
      items.forEach((it, i) => {
        const key = 'abcdefghij'[i] || String(i + 1);
        const cls = it.unlocked ? '' : ' ci-dim';
        html += `<tr class="pui-row${cls}" data-i="${i}"><td>${key}</td>`
          + `<td>${esc(it.label)}</td></tr>`;
      });
      html += '</table>';
      this.open('abyss', '深淵魔術', html, { hint: 'a~j 選択　Esc 閉じる' });
      this.onKeyFn = (e) => {
        const k = 'abcdefghij'.indexOf(e.key);
        if (k >= 0 && k < items.length) {
          const it = items[k];
          if (!it.unlocked) {
            this.pushMessage(`<深淵魔力${it.need}以上で解放>`);
            return true;
          }
          const r = Elona.Abyss.cast(g, it.id);
          if (r && r.message) this.pushMessage(r.message);
          this.close();
          return true;
        }
        return false;
      };
    },

    /**
     * 死灵术命令菜单 —— `txtsetnecro 6` + `*label_2896`（332789-332795）。
     * 6 项：キャンセル / 全回収 / MP強化 / HP回復 / 自爆命令 / 招集。
     */
    openNecroMenu(g) {
      const items = (Elona.Necro && Elona.Necro.FORCE_MENU) || [];
      let html = '<div class="pui-note">ネクロフォース —— 使役アンデッド制御</div>';
      html += '<table class="pui-table"><tr><th>No.</th><th>命令</th></tr>';
      items.forEach((it, i) => {
        const key = 'abcdef'[i] || String(i + 1);
        html += `<tr class="pui-row" data-i="${i}"><td>${key}</td>`
          + `<td>${esc(it.jp)}<span class="ci-dim"> / ${esc(it.en)}</span></td></tr>`;
      });
      html += '</table>';
      this.open('necro', 'ネクロフォース', html, { hint: 'a~f 選択　Esc 閉じる' });
      this.onKeyFn = (e) => {
        const k = 'abcdef'.indexOf(e.key);
        if (k >= 0 && k < items.length) {
          const r = g.useAbility(743, { choice: items[k].id });
          for (const m of ((r && r.messages) || [])) this.pushMessage(m);
          if (r && r.message) this.pushMessage(r.message);
          this.close();
          return true;
        }
        return false;
      };
    },

    /** 战力评估（原版「戦力評価」的展示值：等级×10 + 四项基础能力均值） */
    combatRating(p) {
      const lv = p.level | 0;
      const sum = p.skill ? ((p.skill(10) + p.skill(11) + p.skill(12) + p.skill(13)) | 0) : 0;
      return lv * 10 + idiv(sum, 4);
    },
    /** 打撃修正（展示用：按戦術技能换算的 NdM 形式） */
    meleeText(p) {
      const s = Elona.Stats ? (Elona.Stats.sorg(p, 104) | 0) : 0;
      return `${2 + idiv(s, 20)}d${10 + s}+${s * 3}`;
    },
    /** 魔法威力（293863-293869）：附魔 34 的 var_58(98) + 魔力，含变异壳/var_65(428) 修正 */
    magicPowerText(p) {
      const idiv = (a, b) => Math.trunc(a / b);
      const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
      let v = idiv(limit(idiv((p.get(98) | 0) * 2, 3), 0, 1000), 10)
        + limit(idiv(p.skill(16), 10), 0, 150) + 100;
      if ((p.get(64) | 0) >= 15000 && (p.get(64) | 0) < 35000
        && Elona.Status && Elona.Status.findbuff(p, 34) !== -1) v = idiv(v * 6, 5);
      return `${v}%`;
    },
    hitText(p) {
      const s = Elona.Stats ? (Elona.Stats.sorg(p, 104) | 0) : 0;
      return `${100 + s}%`;
    },
    evadeText(p) {
      const s = Elona.Stats ? (Elona.Stats.sorg(p, 187) | 0) : 0;
      return `${100 + s}%`;
    },

    /**
     * 角色已习得技能列表（【0-BU】对应原版 *label_2784 的「◆ スキルと特殊能力」段：
     *   repeat 400-150,150 → 技能 id 150..399，条件 var_82(cnt, 角色) != 0）。
     * 技能名取自 data/tables/skills.json 的 skillNames（与技能一览面板同源）。
     * 汉化：名称读同层级的 ch，英文名另存 en 供次要行显示。
     * @returns {Promise<Array<{id,name,en,level,potential}>>}
     */
    async skillListOf(p) {
      const out = [];
      if (!p) return out;
      let names = {};
      try {
        const t = await Elona.Data.table('skills');
        names = (t && t.skillNames) || {};
      } catch (e) { names = {}; }
      const pot = p.potential || {};
      for (let id = 150; id < 400; id++) {
        const raw = pot[id] | 0;
        if (!raw) continue;                       // var_82(cnt, 角色) != 0
        const nm = names[String(id)];
        out.push({
          id,
          name: nm ? (nm.ch || nm.jp || nm.en || ('skill ' + id)) : ('skill ' + id),
          en: nm ? (nm.en || '') : '',
          level: idiv(raw, 1000000),              // 潜力 = 等级
          potential: idiv(raw % 1000000, 1000),   // 剩余可成长空间（%）
        });
      }
      return out;
    },

    // ======================================================================
    // 技能 / 能力（a → label_2739；W → label_2743 第 3 页）
    // ======================================================================
    /** page: 0 = 技能，1 = 法术库存，2 = 广域能力（第 3 页） */
    async openSkills(g, page) {
      const p = g.player;
      if (!p) return;
      const pg = page | 0;
      if (pg === 1) return this.openSpellPage(g);
      if (pg === 2) return this.openWideSkills(g);

      const table = await Elona.Data.table('skills');
      const names = (table && table.skillNames) || {};
      const rows = [];
      // 玩家已习得技能：potential 的键（潜力×1e6 + 经验×1000 + 成长率）
      const pot = p.potential || {};
      for (const k in pot) {
        const id = parseInt(k, 10);
        if (!(id >= 0) || id < 10 || id > 600) continue;
        const raw = pot[k] | 0;
        const lv = idiv(raw, 1000000);
        if (lv <= 0) continue;
        const nm = names[String(id)];
        // 汉化：主名读 ch，英文名放次要行
        rows.push({ id, name: nm ? (nm.ch || nm.jp || nm.en || ('skill ' + id)) : ('skill ' + id),
          en: nm ? (nm.en || '') : '', level: lv,
          potential: idiv(raw % 1000000, 1000) });
      }
      rows.sort((a, b) => b.level - a.level || a.id - b.id);
      this.rows = rows.map((r) => r.id);
      const html = '<div class="pui-note">潜力 = 剩余可成长空间（原版 var_82 的低位）。</div>'
        + rows.map((r) => `<div class="pui-row" data-i="${this.rows.indexOf(r.id)}">`
          + `<span class="pui-name">${esc(r.name)}</span>`
          + `<span class="pui-dim">${esc(r.en)}</span>`
          + `<span class="pui-num">Lv ${r.level}</span>`
          + `<span class="pui-num">潜力 ${r.potential}%</span></div>`).join('');
      this.open('skills', `技能一览（${rows.length}）`, html || '<div class="pui-dim">还没有任何技能。</div>',
        { wide: true, hint: '↑↓ 选择　Esc 关闭' });
    },

    /** 法术库存（var_495，玩家 400..599 各一格） */
    async openSpellPage(g) {
      const p = g.player;
      const st = p.spellStock || [];
      const table = await Elona.Data.table('skills');
      const names = (table && table.skillNames) || {};
      const rows = [];
      for (let i = 0; i < 200; i++) {
        const n = st[i] | 0;
        if (n <= 0) continue;
        const id = 400 + i;
        const nm = names[String(id)];
        // 汉化：主名读 ch，英文名放次要行
        rows.push({ id, name: nm ? (nm.ch || nm.jp || nm.en || id) : id,
          en: nm ? (nm.en || '') : '', count: n });
      }
      this.rows = rows.map((r) => r.id);
      const html = rows.length
        ? rows.map((r, i) => `<div class="pui-row" data-i="${i}"><span class="pui-name">${esc(r.name)}</span>`
          + `<span class="pui-dim">${esc(r.en)}</span><span class="pui-num">${r.count} 次</span></div>`).join('')
        : '<div class="pui-dim">还没有记忆任何魔法。</div>';
      this.open('spells', `魔法库存（${rows.length}）`, html, { wide: true });
    },

    /**
     * 第 3 页 —— 原版 key_wipe(W) 的分派目标 label_2743。
     * 该画面列出「广域能力」（var_83(3,id)/1000*1000 == 3000 的能力），
     * 其数据来自 tables/abilities.json（tools/extract_abilities.py）。
     */
    async openWideSkills(g) {
      const p = g.player;
      let ab = null;
      try { ab = await Elona.Data.table('abilities'); } catch (e) { ab = null; }
      const list = (ab && (ab.abilities || ab.list)) || ab || [];
      const rows = [];
      const arr = Array.isArray(list) ? list : Object.keys(list).map((k) => Object.assign({ id: Number(k) }, list[k]));
      const S = Elona.Spell;
      for (const a of arr) {
        if (!a) continue;
        const id = a.id | 0;
        const unlocked = Elona.Feat && Elona.Feat.flag ? !!Elona.Feat.flag(p, id - 600) : false;
        // 名称/消耗/说明取自动作表 var_83（actions.json）
        const nmObj = S && S.actionName ? S.actionName(id) : null;
        const cost = S && S.field ? (S.field(id, 2) | 0) : (a.cost | 0);
        // 288779 只把 3000 档排除在**主列表**外；炼成雨/液体操纵弹这类药水能力仍可发动
        const passive = Elona.Ability ? Elona.Ability.isPassive(id) : false;
        rows.push({
          id, unlocked, cost, passive,
          name: (nmObj && (nmObj.ch || nmObj.en || nmObj.jp)) || a.name || ('ability ' + id),
        });
      }
      rows.sort((x, y) => (x.unlocked === y.unlocked ? x.id - y.id : (x.unlocked ? -1 : 1)));
      this.rows = rows;
      const html = rows.length
        ? rows.map((r, i) => `<div class="pui-row" data-i="${i}"><span class="pui-name">${esc(r.name)}</span>`
          + `<span class="pui-num">${r.cost} SP</span>`
          + `<span class="pui-dim">${r.unlocked ? (r.passive ? '已习得（被动）' : '可发动') : '未习得'}</span></div>`).join('')
        : '<div class="pui-dim">没有广域能力数据（abilities.json 缺失）。</div>';
      // 288745 label_2738：能力发动窗口（Enter 发动）
      this.open('wide', `能力发动（${rows.filter((r) => r.unlocked).length} / ${rows.length}）`, html, {
        wide: true, hint: '↑↓ 选择　Enter 发动　Esc 关闭',
        onPick: (row) => {
          if (!row || !row.unlocked) { Elona.UI.pushMessage('这个能力还没有觉醒。'); return; }
          if (row.passive) { Elona.UI.pushMessage('这是被动能力，无需发动。'); return; }
          const r = g.useAbility(row.id);
          if (r && r.request && Elona.consumeSpellRequest) Elona.consumeSpellRequest(r);
          // 有 request 时不要关窗：request 可能刚打开了另一个窗口（选药水 / 选同伴）
          if (r && r.ok && !r.request) this.close();
        },
      });
    },

    // ======================================================================
    // 特性（F → label_2695）
    // ======================================================================
    /**
     * 特徴と体質（F → *label_2697，285132-285676）
     *
     * 原版把条目按「取得できるフィート / 特徴と体質」两段排出，之后是逐条的
     * `[bit]` / `[その他]` / `[性格]` 等判定行。左侧显示等级名（var_94），
     * 右侧是 `[标签] 说明`（var_93(2+等级) 或 traits.json 的文本）。
     *
     * 差异：首饰编码说明（285609-285640）与「条件不足」标记未接，见 core/traits.js 头部。
     */
    async openTraits(g) {
      try { await Elona.Traits.load(); } catch (e) { /* 无数据 */ }
      if (!Elona.Traits.ready()) {
        this.open('traits', '特徴と体質', '<div class="pui-dim">数据（traits.json）缺失。</div>', { wide: true });
        return;
      }
      this._profFeat = null;
      this.renderTraits(g);
    },

    /**
     * 特征与体质的绘制 —— `*label_2697`（285132-285676）建表，
     * 之后进入 `*label_2698`（285677-285837）的绘制与按键循环：
     * 段标题、`display_key` 行号、等级/说明、以及「取得」的按键分支都在这里。
     * 本方法是这两段的等价实现（HTML 面板版）。
     *
     * 「取得できるフィート」段的每一行都是可选行：
     *   原版 285727 `display_key …, cnt` 给段内第 cnt 行标上数字键，
     *   285802-285837 在按下该键（var_138 == var_446(cnt)）且 var_65(93) > 0 时取得。
     * 本项目沿用同一套键位：段内第 0 行 = 键 0，第 9 行 = 键 9；
     * 方向键上下移动光标、Enter 取得当前行。
     */
    renderTraits(g) {
      const p = g.player;
      const data = Elona.Traits.build(g, p, 'en');
      const pts = (g.getV65(93) | 0);
      const availIds = [];
      let n = 0;
      let html = '';
      for (const grp of data.groups) {
        if (grp.title) html += `<div class="pui-sep">${esc(grp.title)}</div>`;
        for (const it of grp.items) {
          n++;
          if (grp.key === 'available') {
            const i = availIds.length;
            availIds.push(it.id);
            const key = i < 10 ? String(i) : '';
            html += `<div class="pui-row pui-trait pui-trait-avail" data-i="${i}">`
              + `<span class="pui-key">${key}</span>`
              + `<span class="pui-tleft">${esc(it.left || '')}</span>`
              + `<span class="pui-ttext"><span class="pui-ttag">${esc(it.tag)}</span>${esc(it.text)}</span>`
              + `<span class="pui-num">${it.level | 0}/${it.maxLevel | 0}${it.maxed ? ' MAX' : ''}</span></div>`;
            continue;
          }
          html += `<div class="pui-trait${it.available ? ' pui-trait-avail' : ''}">`
            + `<span class="pui-tleft">${esc(it.left || '')}</span>`
            + `<span class="pui-ttext"><span class="pui-ttag">${esc(it.tag)}</span>${esc(it.text)}</span></div>`;
        }
      }
      if (!n) html = '<div class="pui-dim">特に何もない。(Nothing particular.)</div>';
      this.rows = availIds;
      this.open('traits', `特徴と体質（${n}）${pts > 0 ? '　取得可能 ' + pts : ''}`, html, {
        wide: true,
        hint: availIds.length ? '0~9 取得 / 升级该行　↑↓ 选择　Enter 取得　Esc 关闭' : 'Esc 关闭',
        onPick: (id) => this.takeFeat(g, id),
      });
      this.onKeyFn = (e) => {
        if (!availIds.length || !/^[0-9]$/.test(e.key)) return false;
        const id = availIds[parseInt(e.key, 10)];
        if (id === undefined) return false;
        this.takeFeat(g, id);
        return true;
      };
    },

    /** 285802-285837：取得 / 升级一个 feat */
    takeFeat(g, id) {
      if (id === undefined || id === null) return;
      const r = Elona.Feat.take(g, id | 0);
      const nm = Elona.Feat.name(id | 0) || ('feat ' + id);
      if (r.ok) {
        // 285820-285822：var_761 = -10000 + var_95（光标记号）+ snd 61
        this._profFeat = -10000 + (id | 0);
        g.log(`取得了特性「${nm}」（Lv ${r.level}／剩余 ${r.points} 点）。`);
        if (Elona.Sound && Elona.Sound.play) { try { Elona.Sound.play(61); } catch (e) { /* 无声卡 */ } }
        this.renderTraits(g);
        return;
      }
      if (r.reason === 'max') {
        g.log(`「${nm}」已经到顶了，无法继续取得。`);       // 285814
      } else if (r.reason === 'no-points') {
        g.log('没有可用的天赋点。');
      } else if (r.reason === 'requirement') {
        g.log(`「${nm}」的取得条件尚未满足。`);
      } else {
        g.log(`无法取得「${nm}」。`);
      }
    },

    // ======================================================================
    // 冒险日记（j → *label_2700 / 285929-286136）
    // ======================================================================
    /**
     * 原版把整本日记拼进 note 缓冲：News / Quest / Quest Item / Title & Ranking /
     * Income & Expense / Completed Quests 六段。正文由 `core/journal.js` 执行
     * `journal.json`（由 `tools/extract_journal.py` 从 4 段源码编译而来）。
     *
     * 与原版不同：面板纵向滚动而非半页翻页；正文取 en 分支；消息池（var_440）未接。
     * 进行中的委托本应由 `*label_0273` 渲染（var_434 记录），本项目用 Quest 模块近似。
     */
    async openJournal(g) {
      this.rows = [];
      try { await Elona.Journal.load(); } catch (e) { /* 无数据 */ }
      const p = g.player;
      const cls = (c) => (c === 'head' ? 'pui-jhead'
        : c === 'done' ? 'pui-jdone'
          : c === 'blue' ? 'pui-jblue'
            : c === 'red' ? 'pui-jred'
              : c === 'blank' ? 'pui-jblank' : 'pui-jbody');

      const top = '<div class="pui-kv"><span>日期</span><span>'
        + `${esc(`${g.year} 年 ${g.getV65(11) | 0} 月 ${g.getV65(12) | 0} 日 ${g.clockText()}`)}</span></div>`
        + `<div class="pui-kv"><span>现在地</span><span>${esc((g.map && g.map.name) || '-')}</span></div>`
        + `<div class="pui-kv"><span>等级 / 金币</span><span>${p.level | 0} ／ ${p.get(30) | 0} GP</span></div>`;

      let html = top;
      const secs = Elona.Journal.ready() ? Elona.Journal.sections(g) : null;
      if (!secs) {
        html += '<div class="pui-dim">日记数据（journal.json）缺失。</div>';
      } else {
        for (const s of secs) {
          html += `<div class="pui-sep">${esc(s.title)}</div>`;
          if (!s.lines.length) { html += '<div class="pui-dim">（没有内容）</div>'; continue; }
          for (const ln of s.lines) {
            if (ln.cls === 'blank') { html += '<div class="pui-jblank"></div>'; continue; }
            html += `<div class="${cls(ln.cls)}">${esc(ln.text)}</div>`;
          }
          // 进行中的委托：原版在 Quest 段用 *label_0273 渲染（var_428 = 2 分支）
          if (s.title === 'Quest') {
            const actives = (Elona.Quest && Elona.Quest.activeQuests) ? Elona.Quest.activeQuests(g) : [];
            for (const a of actives) {
              for (const ln of Elona.Journal.questDetail(g, a)) {
                if (ln.cls === 'blank') { html += '<div class="pui-jblank"></div>'; continue; }
                html += `<div class="${cls(ln.cls)}">${esc(ln.text)}</div>`;
              }
              html += '<div class="pui-jblank"></div>';
            }
          }
        }
      }
      this.open('journal', '冒险日记', html, { wide: true, hint: '↑↓ 滚动　Esc 关闭' });
    },

    // ======================================================================
    // 消息记录（/ → label_4325）
    // ======================================================================
    openMsgLog(g) {
      this.rows = [];
      const msgs = (Elona.UI.messages || []).slice().reverse();
      const html = msgs.length
        ? msgs.map((m) => `<div class="pui-line">${esc(m)}</div>`).join('')
        : '<div class="pui-dim">还没有任何消息。</div>';
      this.open('msglog', '消息记录', html, { wide: true, hint: '↑↓ 滚动　Esc 关闭' });
    },

    // ======================================================================
    // 帮助（? → label_4319）
    // ======================================================================
    /**
     * 许愿输入框（*label_2729 的 txt_select → 文本输入）。
     * 玩家输入愿望文本后交给 Elona.Wish.run 结算。
     */
    openWish(g, onDone) {
      this.rows = [];
      this.onPick = null;
      const html = ''
        + '<div class="pui-note">愿望女神：「想许什么愿？」</div>'
        + '<div class="pui-dim">常用关键字：金币 / 白金币 / 小奖章 / 年轻 / 赎罪 / 变性 / 死 / 送还 / '
        + '技能+技能名 / 道具+物品名 / 卡片+角色名 / 标本+角色名 / 神名（艾赫卡托尔 等）/ '
        + '新年快乐 / 圣诞快乐 / 巧克力 / Q</div>'
        + '<div style="padding:10px 4px"><input id="wish-in" type="text" maxlength="40" '
        + 'style="width:100%;box-sizing:border-box;font-size:15px;padding:6px 8px;'
        + 'background:#e6dcc0;color:inherit;border:1px solid #6b5a3a;" /></div>'
        + '<div class="pui-dim">Enter 确定 · Esc 取消</div>';
      this.open('wish', '许愿 / Wish', html, { hint: 'Enter 确定 · Esc 取消' });
      const inp = document.getElementById('wish-in');
      if (!inp) return;
      setTimeout(() => inp.focus(), 0);
      const submit = () => {
        const text = inp.value || '';
        this.close();
        const r = Elona.Wish
          ? Elona.Wish.run(g, text, {})
          : { ok: false, messages: ['许愿模块未加载。'] };
        for (const m of (r.messages || [])) { if (g.log) g.log(m); }
        if (onDone) onDone(r);
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      });
    },

    /**
     * 生日设定（情报屋菜单 82，420776-420878）。
     * 原版用两个数字输入框选「月 / 日」，设定后不可更改。
     */
    openBirthday(g, onDone) {
      this.rows = [];
      this.onPick = null;
      const b = Elona.NPC.birthday(g);
      if (b.month && b.day) {
        const html = `<div class="pui-note">「你的生日是 ${b.month} 月 ${b.day} 日，我已经记下了。」</div>`;
        this.open('birthday', '誕生日 / Birthday', html, { hint: 'Esc 关闭' });
        return;
      }
      const html = ''
        + '<div class="pui-note">「请告诉我你的生日。之后就不能更改了。」</div>'
        + '<div style="padding:8px 4px;display:flex;gap:8px;align-items:center">'
        + '<input id="bd-m" type="number" min="1" max="12" value="1" style="width:70px;font-size:15px;padding:4px 6px">'
        + '<span>月</span>'
        + '<input id="bd-d" type="number" min="1" max="31" value="1" style="width:70px;font-size:15px;padding:4px 6px">'
        + '<span>日</span>'
        + '<button id="bd-ok" style="margin-left:8px">确定</button>'
        + '</div><div class="pui-dim">Enter 确定 · Esc 取消</div>';
      this.open('birthday', '誕生日 / Birthday', html, { hint: 'Enter 确定 · Esc 取消' });
      const m = document.getElementById('bd-m');
      const d = document.getElementById('bd-d');
      const ok = document.getElementById('bd-ok');
      if (!m || !d || !ok) return;
      setTimeout(() => m.focus(), 0);
      const submit = () => {
        const r = Elona.NPC.setBirthday(g, parseInt(m.value, 10), parseInt(d.value, 10));
        this.close();
        if (g.log) g.log(r.message);
        if (onDone) onDone(r);
      };
      ok.onclick = submit;
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      };
      m.addEventListener('keydown', onKey);
      d.addEventListener('keydown', onKey);
    },

    openHelp() {
      this.rows = [];
      const K = Elona.Keys;
      const groups = [
        ['移动', ['move']],
        ['探索', ['look', 'search', 'dig', 'bash', 'rest', 'hijump', 'close', 'goUp', 'goDown', 'interact', 'target']],
        ['物品', ['get', 'drop', 'inventory', 'quickinv', 'eat', 'read', 'drink', 'zap', 'use', 'open', 'dip', 'offer', 'throw', 'wear', 'itemstack', 'give', 'pray', 'wipe']],
        ['战斗', ['fire', 'cast', 'skill', 'ammo']],
        ['信息', ['charainfo', 'journal', 'trait', 'msglog', 'help', 'pageup', 'pagedown']],
        ['系统', ['save', 'esc']],
      ];
      let html = '<div class="pui-note">键位取自 original/config.txt，可在「选项 → 键位设置」中修改。</div>';
      for (const [title, ids] of groups) {
        html += `<div class="pui-sep">${esc(title)}</div><div class="pui-cols">`;
        for (const id of ids) {
          const a = K.actionById(id);
          if (!a) continue;
          const keys = K.bindings[id] || a.keys || [];
          html += `<div class="pui-kv"><span class="pui-key">${esc(keys.map((k) => (k === ' ' ? 'Space' : k)).join(' / '))}</span>`
            + `<span>${esc(a.label)}</span></div>`;
        }
        html += '</div>';
      }
      html += '<div class="pui-sep">提示</div><div class="pui-dim">'
        + '鼠标可点击物品窗口与地图格；方向键/小键盘 1-9 移动；5 原地等待。'
        + '</div>';
      this.open('help', '帮助', html, { wide: true });
    },

    // ======================================================================
    // 查看（l → label_2675）—— 目标一览
    // ======================================================================
    /** `l` 键（*label_2675，283812-283952）：视野内目标一览，按行快捷键锁定 */
    openLook(g) {
      // 283818：先算候选表（*label_2841）；空表直接提示，不进列表窗
      const tab = Elona.Aim.listFor(g);
      if (!tab.list.length) {
        g.log('视野内没有可以锁定的目标。');   // 283824
        this.close();
        return;
      }
      this.lookData = tab;
      this.lookPage = Math.max(0, Math.min(this.lookPage | 0, tab.pages - 1));
      this.renderLook(g);
    },

    renderLook(g) {
      const tab = this.lookData;
      if (!tab) { this.close(); return; }
      const letters = 'abcdefghijklmnop';       // var_446 = 每行的快捷键
      const page = Math.max(0, Math.min(this.lookPage | 0, tab.pages - 1));
      this.lookPage = page;
      const slice = tab.list.slice(page * tab.per, page * tab.per + tab.per);
      this.rows = slice;
      const html = slice.map((t, i) => {
        const icon = t.hostile ? '⚔' : '☺';
        const lockSlot = tab.me ? (tab.me.get(29) | 0) : 0;
        const on = (lockSlot | 0) === (t.chara.index | 0);
        return `<div class="pui-row${on ? ' sel' : ''}" data-i="${i}">`
          + `<span class="pui-key">${letters[i] || ''}</span>`
          + `<span class="pui-num">${t.dist}</span>`
          + `<span class="pui-name">${icon} ${esc(t.name)}</span>`
          + `<span class="pui-dim">Lv ${t.level}　HP ${t.hp}/${t.hpMax}　(${t.x},${t.y})${on ? '　★锁定中' : ''}</span>`
          + '</div>';
      }).join('');
      this.open('look', `目标一览　Page.${page + 1}/${tab.pages}`, html, {
        wide: true, hint: 'a~p 锁定　← → 翻页　Esc 关闭',
        onPick: (t) => {
          if (!t) return;
          Elona.Aim.apply(g, { kind: 'chara', target: t.chara, tile: { x: t.x, y: t.y } });
          g.log(`锁定了目标：${t.name}。`);       // 283929
          this.close();
        },
      });
      this.onKeyFn = (e) => {
        if (e.key === 'ArrowLeft' && page > 0) { this.lookPage = page - 1; this.renderLook(g); return true; }
        if (e.key === 'ArrowRight' && page < tab.pages - 1) { this.lookPage = page + 1; this.renderLook(g); return true; }
        const k = 'abcdefghijklmnopqrstuvwxyz'.indexOf(e.key);
        if (k >= 0 && k < slice.length) {                  // 283913-283932
          this.onPick(slice[k]);
          return true;
        }
        return false;
      };
    },

    // ======================================================================
    // 瞄准覆盖层（`*` 键，*label_2670 / *label_2672）
    // ======================================================================
    /**
     * 原版是阻塞式循环：每帧 `key_check` + `cursor_check`，方向键移动
     * `var_1311/1312`，回车 `var_138 == var_144` 确认，Esc `var_150` 取消，
     * PageUp/Down（`var_341/342`）在自由模式下跳到上一个/下一个角色。
     *
     * 本项目改成「状态在 Elona.Aim、渲染在 Renderer、按键在 main.js」：
     * 这里只负责在按键后刷新提示文字。
     */
    aimRefresh(g) {
      if (!Elona.Aim.active) { this.close(); return; }
      const info = Elona.Aim.inspect(g);
      const s = Elona.Aim.s;
      const mode = s.free ? '自由锁定' : '角色锁定';
      const head = info.inSight ? '' : '<div class="pui-line pui-dim">（视野范围外）</div>';
      const rows = info.lines.map((x) => `<div class="pui-line">${esc(x)}</div>`).join('');
      const html = head + rows;
      const title = `${mode}　光标 (${s.x},${s.y})`;
      const hint = s.free
        ? '方向键移动　+/- 跳到角色　回车锁定　Esc 取消'
        : '方向键切换目标　←/→ 翻页　回车锁定　Esc 取消';
      const el = this.root;
      if (this.kind !== 'aim' || !el || el.classList.contains('hidden')) {
        this.open('aim', title, html, { wide: false, hint });
        // open() 会把 sel 归零并清掉 onKeyFn；瞄准自己处理全部按键
        this.rows = [];
        this.onKeyFn = null;
        return;
      }
      el.querySelector('#pui-title').textContent = title;
      el.querySelector('#pui-hint').textContent = hint;
      el.querySelector('#pui-body').innerHTML = html;
    },

    /**
     * `*` 键（`var_167` = key_target → 605915 → `*label_2670`）。
     * 大地图（`var_126(6) == 1`）上原版是「环顾四周」，进的是自由锁定（283789 之前
     * 的 `var_1784` 分支）；普通地图进角色锁定。
     * 本项目：普通地图先给「角色锁定」，若视野内一个目标都没有则退化成自由锁定
     * （否则玩家会卡在一个空列表里，什么也按不了）。
     */
    openAim(g) {
      const world = (g.map && g.map.header && (g.map.header[6] | 0) === 1);
      const tab = world ? null : Elona.Aim.listFor(g);
      const free = world || !tab || !tab.list.length;
      const s = Elona.Aim.start(g, { free });
      if (!free && !s.list.length) g.log('视野内没有可以锁定的目标。');
      if (free && world) g.log('环顾四周 —— 方向键移动光标，回车确认。');
      this.aimRefresh(g);
    },

    /**
     * 0-EO：强制「自由光标」—— 地面指定法术（类别 7000）用它。
     * 原版 315731 `gosub *label_2670` 是全屏光标，可以在射程内任意移动，
     * 不是「八方向一格」（那是 `*label_2893`）。
     */
    openAimFree(g) {
      Elona.Aim.start(g, { free: true });
      g.log('指定位置 —— 方向键移动光标，回车确认，Esc 取消。');
      this.aimRefresh(g);
    },
    openRidePickTarget(g, r) {
      const html = `<div class="pui-line">${esc(r.message)}</div>`
        + `<div class="pui-row" data-i="0"><span class="pui-key">y</span>`
        + `<span class="pui-name">骑乘者 ${esc(r.rider ? r.rider.name : '')}</span></div>`
        + `<div class="pui-row" data-i="1"><span class="pui-key">n</span>`
        + `<span class="pui-name">坐骑 ${esc(r.target ? r.target.name : '')}</span></div>`;
      this.open('aim-ride', '锁定哪一个？', html, {
        wide: false, hint: 'y 骑乘者　n 坐骑　Esc 取消',
        onPick: (row) => {
          const i = this.rows.indexOf(row);
          const res = Elona.Aim.confirmPick(g, i === 0);
          this.close();
          if (res.message) Elona.UI.pushMessage(res.message);
          // 0-EP：投掷时锁定之后要接着投出去（否则流程会停在「已锁定」）
          const pt = this.pendingThrow | 0;
          if (res.ok && pt >= 0 && res.tile) {
            this.pendingThrow = -1;
            const res3 = g.throwAt(res.tile.x, res.tile.y);
            if (res3 && res3.message) Elona.UI.pushMessage(res3.message);
          }
        },
      });
      this.rows = [{ i: 0 }, { i: 1 }];
    },

    // ======================================================================
    // 通用物品选择器
    // ======================================================================
    /**
     * @param {object} g
     * @param {object} opt { title, filter(item,idx), hint, onPick(idx,item) }
     */
    openItemPicker(g, opt) {
      const p = g.player;
      const rows = [];
      for (let i = 0; i < p.inv.length; i++) {
        const it = p.inv[i];
        if (!it || (it.f[0] | 0) <= 0) continue;
        if (opt.filter && !opt.filter(it, i)) continue;
        rows.push({ idx: i, item: it });
      }
      this.rows = rows;
      const html = rows.length
        ? rows.map((r, i) => {
          // opt.decorate(item) 可以往「装备中」那一列塞额外信息（魔杖用来看充能/效果）
          const extra = opt.decorate ? String(opt.decorate(r.item) || '') : '';
          const dim = [r.item.eqSlot >= 0 ? '装备中' : '', extra].filter(Boolean).join('　');
          return `<div class="pui-row" data-i="${i}">`
            + `<span class="pui-name">${esc(Elona.ItemDB.name(r.item.id, 'jp'))}</span>`
            + `<span class="pui-dim">${esc(dim)}</span>`
            + `<span class="pui-num">×${r.item.f[0] | 0}</span></div>`;
        }).join('')
        : '<div class="pui-dim">没有符合条件的物品。</div>';
      this.open('picker', opt.title || '选择物品', html, {
        wide: true, hint: opt.hint || '↑↓ 选择　Esc 取消',
        onPick: (row) => {
          this.onClose = null;
          this.close();
          if (opt.onPick) opt.onPick(row.idx, row.item);
        },
      });
      // 0-EP：Esc 关闭也要通知调用方（拟态镜 150 需要「やっぱりやめた。」）
      if (opt.onCancel) this.onClose = () => { if (opt.onCancel) opt.onCancel(); };
    },

    // ======================================================================
    // 炼成雨 / 液体操纵弹的「选药水」窗口（var_486 = 23, 11）
    // ======================================================================
    /**
     * 296498（模式 23 子模式 11）= 药水类且排除禁用表：
     *   奶 574 / 雪 587 / 果汁 1005 / 空瓶 601 / 火焰瓶 577 / 潜力药水 287 /
     *   速度潜力药水 847 / 下降药水 706 / 蓝色胶囊 771 / 韦尔尼斯经典原味糖 799 /
     *   赫尔墨斯之血 626
     * 选中后直接调用 `Potion.rain` / `Potion.spray`。
     */
    openPotionPick(g, kind) {
      const P = Elona.Potion;
      if (!P || !P.canRain) { Elona.UI.pushMessage('药剂模块未加载。'); return; }
      const spray = kind === 'spray';
      this.openItemPicker(g, {
        title: spray ? '液体操纵弹：用哪瓶药水？' : '炼成雨：用哪瓶药水？',
        hint: '↑↓ 选择　Esc 取消（不可用于炼成雨的药水已隐藏）',
        filter: (it) => P.canRain(it),
        onPick: (idx, it) => {
          const r = spray ? P.spray(g, g.player, it) : P.rain(g, g.player, it);
          for (const m of (r.messages || [])) g.log(m);
          if (r.message) g.log(r.message);
          if (!r.ok) {
            if (r.reason === 'no-potion') g.log('没有可以使用的药水。');
            return;
          }
          if (g.endTurn) g.endTurn();
        },
      });
    },

    // ======================================================================
    // X框架（effect 138）—— 二次改造：选发射器 → 选机能
    // ======================================================================
    /**
     * 357364-357430：
     *   1) `var_486 = 23, 29` —— 只列**已改造过**（f[27] != 0）的瓶塞发射器
     *   2) `*label_2896` 的 6 项机能菜单（与已有改造相同的项会回「機能が被っている」）
     *   3) 写入 f[31] 并消耗 1 个 X框架
     */
    openXFrame(g, item, r) {
      const FX = Elona.ItemFx;
      if (!FX) { Elona.UI.pushMessage('物品效果模块未加载。'); return; }
      const isPoti = (it) => [1203, 1202, 1201, 1200].indexOf(it.f[3] | 0) >= 0;
      const step = (r && r.step) || 'potioman';
      if (step === 'potioman') {
        this.openItemPicker(g, {
          title: '要对哪台瓶塞发射器进行二次改造？',
          hint: '↑↓ 选择　Esc 取消（只列已经改造过的）',
          filter: (it) => isPoti(it) && (it.f[27] | 0) !== 0,
          onPick: (idx, poti) => {
            this.openXFrame(g, item, {
              step: 'mode', potioman: poti, current: Math.trunc((poti.f[27] | 0) / 100),
            });
          },
        });
        return;
      }
      const poti = r.potioman;
      const cur = r.current | 0;
      const MODES = [
        { id: 1, label: '旋转之脚（混乱 + 濒死斩杀）' },
        { id: 2, label: '威猛膀臂（伤害 ×1.1）' },
        { id: 3, label: '双核（伤害 ×1.8，消耗瓶塞 +1）' },
        { id: 4, label: '高速服务器（装填后立即射击）' },
        { id: 5, label: '头部狙击（伤害必定最大）' },
        { id: 6, label: '迷乱飞驰（混乱 + 削减 SP）' },
      ].filter((m) => m.id !== cur);
      this.rows = MODES;
      const html = MODES.map((m, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${esc(m.label)}</span></div>`).join('');
      this.open('xframe', '追加哪种机能？（X形态变换）', html, {
        wide: true, hint: '↑↓ 选择　Enter 确定　Esc 取消',
        onPick: (row) => {
          const rr = FX.dispatch(g, item, { potioman: poti, mode: row.id });
          if (rr && rr.message) g.log(rr.message);
          if (rr && rr.ok && g.endTurn) g.endTurn();
          this.close();
        },
      });
    },

    // ======================================================================
    // 丢弃（选择式，对应 var_486=2）
    // ======================================================================
    openDrop(g) {
      this.openItemPicker(g, {
        title: '丢弃哪件物品？',
        filter: (it) => it.eqSlot < 0,
        onPick: (idx, it) => {
          const p = g.player;
          if (g.dropItem(p, idx, p.x, p.y)) {
            g.log(`你放下了 ${Elona.ItemDB.name(it.id, 'en')}。`);
            g.endTurn();
          } else g.log('无法放下这件物品。');
        },
      });
    },

    // ======================================================================
    // 魔杖（Z，var_486=9 → *label_2986）
    // ======================================================================
    /**
     * 选一根魔杖往哪个方向挥（315822：「Which direction do you want to zap the wand?」）。
     * 效果 id 与充能来自 `*label_1934` 的 `var_59 == 14` 分支（见 core/wand.js）。
     * 选中后交给 `game.useItem` → `Wand.use`，它会自己判断自身系/需要目标。
     */
    openZap(g) {
      const W = Elona.Wand;
      if (!W) { Elona.UI.pushMessage('魔杖模块未加载。'); return; }
      const isWand = (it) => W.isWand(it);
      const any = g.player.inv.some((it) => it && (it.f[0] | 0) > 0 && isWand(it));
      if (!any) { g.log('你没有可使用的魔杖。'); return; }

      this.openItemPicker(g, {
        title: '使用哪根魔杖？',
        filter: (it) => it && (it.f[0] | 0) > 0 && isWand(it),
        decorate: (it) => {
          const charges = W.chargesOf(it);
          const eid = W.effectOf(it);
          const nm = eid && Elona.Spell ? Elona.Spell.actionName(eid) : null;
          const label = nm ? ((nm.ch || nm.en || nm.jp) || ('#' + eid)) : '未知效果';
          return `${charges} 发 / ${label}`;
        },
        onPick: (idx) => {
          // 0-EO：先按方向键选方向（315822「どの方向に振る？」），由 DirSel 的 item 档接手
          const r = g.useItem(idx, 0, { askDirection: true });
          if (r && r.reason === 'need-direction' && Elona.DirSel) {
            Elona.DirSel.startItem(g, idx, 1, null, { allowEmpty: true });
            Elona.UI.pushMessage('朝哪个方向挥杖？（方向键 / 小键盘 1-9，Esc 取消）');
            return;
          }
          if (r && r.ok) return;                       // 成功：Wand.use 已写日志并结束回合
          if (r && (r.reason === 'no-charge' || r.reason === 'no-target')) return;   // 已写日志
          if (r && r.reason) Elona.UI.pushMessage(`魔杖没有起作用（${r.reason}）。`);
        },
      });
    },

    // ======================================================================
    // 打开容器（o，var_486=15）
    // ======================================================================
    /**
     * 容器存取（o → var_486=15 → label_2998，298813-298818 / 344751-344905）。
     *
     * 两步：先选要打开哪件容器，再进入存取窗口。
     * 存取窗口里 Enter 取出、p 放入；内容物随物品一起进存档（见 core/container.js）。
     */
    openContainer(g) {
      const C = Elona.Container;
      if (!C) { Elona.UI.pushMessage('容器模块未加载。'); return; }
      if (C.blockedOnWorldMap(g)) { Elona.UI.pushMessage('在世界地图上不能整理容器。'); return; }

      const list = C.listContainers(g);
      if (!list.length) { g.log('你没有可以打开的容器。'); return; }
      // 344752-344753：进入提包界面时扣一次善恶（刷新窗口不重复扣）
      if (list.length === 1) {
        if (C.beforeOpen) C.beforeOpen(g, list[0].item);
        this.openContainerPanel(g, list[0].item);
        return;
      }

      this.rows = list;
      const html = list.map((r, i) => {
        const sm = C.summary(r.item);
        return `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-name">${esc(Elona.ItemDB.name(r.item.id, 'en'))}</span>`
          + `<span class="pui-dim">${sm.kinds} 种 / ${sm.count} 件</span></div>`;
      }).join('');
      this.open('container-pick', '打开哪个容器？', html, {
        wide: true, hint: '↑↓ 选择　Enter 打开　Esc 关闭',
        onPick: (row) => {
          if (C.beforeOpen) C.beforeOpen(g, row.item);
          this.openContainerPanel(g, row.item);
        },
      });
    },

    /** 容器的存取窗口 */
    openContainerPanel(g, it) {
      const C = Elona.Container;
      // 0-FB：344910-344940 —— 宝箱类容器第一次打开时先开锁（f[26] 锁等级），
      //   再按 *label_3000 生成内容（落在脚下），随后 f[25]=0 变成普通空容器。
      //   f[25]==0 的普通容器（冰箱/书架等）不受影响。
      if (Elona.DungeonFx && Elona.DungeonFx.openChest) {
        const r = Elona.DungeonFx.openChest(g, g.player, it);
        if (r && r.locked) {
          const u = r.unlock || {};
          let msg = '锁打不开。';
          if (u.reason === 'no-lockpick') msg = '你没有开锁工具。';
          else if (u.reason === 'beyond') msg = '这个锁的构造超出了你的技术。';
          else if (u.reason === 'fail') msg = '开锁失败了。';
          Elona.UI.pushMessage(msg);
          return;
        }
        if (r && r.result && r.result.spawned > 0) {
          Elona.UI.pushMessage(`从${Elona.ItemDB.name(it.id, 'en')}里散落出 ${r.result.spawned} 件东西。`);
        }
      }
      const items = C.contents(it);
      const sm = C.summary(it);
      this.rows = items.map((x, i) => ({ idx: i, item: x }));

      const head = `<div class="pui-note">${esc(Elona.ItemDB.name(it.id, 'en'))}`
        + `　${sm.kinds} 种 / ${sm.count} 件 / 重 ${sm.weight}</div>`;
      const rowsHtml = this.rows.length
        ? this.rows.map((r, i) => {
          const n = r.item.f[0] | 0;
          const w = (r.item.weight | 0) * n;
          return `<div class="pui-row" data-i="${i}">`
            + `<span class="pui-name">${esc(Elona.ItemDB.name(r.item.id, 'en'))}</span>`
            + `<span class="pui-num">×${n}</span>`
            + `<span class="pui-dim">重 ${w}</span></div>`;
        }).join('')
        : '<div class="pui-note">（空）</div>';

      this.open('container', `${Elona.ItemDB.name(it.id, 'en')}`, head + rowsHtml, {
        wide: true, hint: 'Enter 取出　p 放入　Esc 关闭',
        onPick: (row) => {
          const r = C.take(g, it, row.idx);
          Elona.UI.pushMessage(r.message);
          if (r.ok) g.endTurn();
          this.openContainerPanel(g, it);
        },
      });
      this.onKeyFn = (e) => {
        if (e.key !== 'p') return false;
        this.pickPutInto(g, it);
        return true;
      };
    },

    /** 从背包里挑一件放进容器 */
    pickPutInto(g, it) {
      const C = Elona.Container;
      this.openItemPicker(g, {
        title: `把什么放进${Elona.ItemDB.name(it.id, 'en')}？`,
        filter: (x) => x.eqSlot < 0 && x !== it,
        onPick: (idx) => {
          const r = C.put(g, it, idx);
          Elona.UI.pushMessage(r.message);
          if (r.ok) g.endTurn();
          this.openContainerPanel(g, it);
        },
      });
    },

    // ======================================================================
    // 浸泡（B，var_486=17）—— 两步选择
    // ======================================================================
    /**
     * 浸泡（B，`var_486 = 17`）：先选「浸入的液体」，再选目标物品。
     * 效果本体在 `core/dip.js`（`dipcursed` 348266 + `*label_3015` 348331-348747，0-DN）。
     */
    openDip(g) {
      const D = Elona.Dip;
      const isLiquid = (it) => (D && D.isLiquid ? D.isLiquid(it)
        : (Elona.ItemDB.ref(it.id, 5) === 52000 || (it.f[24] | 0) === 35));
      this.openItemPicker(g, {
        title: '把什么浸入？', filter: isLiquid,
        onPick: (srcIdx, src) => {
          this.openItemPicker(g, {
            title: `把 ${Elona.ItemDB.name(src.id, 'en')} 涂到哪件物品上？`,
            filter: (it, i) => i !== srcIdx && (it.f[0] | 0) > 0,
            onPick: (dstIdx, dst) => {
              const r = D ? D.dip(g, src, dst) : null;
              if (r && r.message) Elona.UI.pushMessage(r.message);
              g.endTurn();
            },
          });
        },
      });
    },

    // ======================================================================
    // 给予（G，label_2748）
    // ======================================================================
    openGive(g, dirKey) {
      const p = g.player;
      let npc = null;
      if (dirKey) {
        // 0-EO：原版「どの方向に？」（*label_2748 → *label_2893）—— 只认那一格
        const d = { 1: [-1, 1], 2: [0, 1], 3: [1, 1], 4: [-1, 0],
          6: [1, 0], 7: [-1, -1], 8: [0, -1], 9: [1, -1] }[dirKey | 0];
        if (d) {
          const x = p.x + d[0], y = p.y + d[1];
          const cell = g.map && g.map.cell ? g.map.cell(x, y) : null;
          if (cell && cell[1]) {
            const c = g.charas[cell[1] - 1];
            if (c && c !== p && (c.get(0) | 0) === 1) npc = c;
          }
        }
      } else {
        for (const c of g.charas) {
          if (!c || c === p || (c.get(0) | 0) !== 1) continue;
          if (Math.abs(c.x - p.x) <= 1 && Math.abs(c.y - p.y) <= 1) { npc = c; break; }
        }
      }
      if (!npc) { g.log('那个方向没有可以把东西交给的人。'); return; }
      this.openItemPicker(g, {
        title: `把什么交给 ${npc.name}？`,
        filter: (it) => it.eqSlot < 0,
        onPick: (idx) => {
          const r = Elona.NPC.perform(g, npc, 'give', idx);
          if (r && r.message) g.log(r.message);
        },
      });
    },

    // ======================================================================
    // 祭坛（p → *label_2976 → *label_2609 / *label_2613）
    // ======================================================================
    /**
     * 站在祭坛上按 p。原版 *label_2976（341861-341870）只做一次分叉：
     *   item_find 60002                        ← 祭坛是物品（refitem 9 == 60002）
     *   找到 && 祭坛神 != 玩家信仰 → *label_2609 祭坛画面（改宗 / 信仰 / 舍弃）
     *   否则                        → *label_2613 祈祷确认
     * 注意「没有祭坛」也走 2613 —— 原版允许在任何地方向自己的神祈祷。
     */
    openAltar(g) {
      const F = Elona.Faith;
      const p = g && g.player;
      if (!F || !p) { Elona.UI.pushMessage('信仰模块未加载。'); return; }
      const altar = F.altarAt ? F.altarAt(g, p.x, p.y) : null;
      const faith = p.get(F.F_GOD) | 0;
      if (!altar || (altar.f[25] | 0) === faith) { this.openPray(g, faith); return; }
      this.openAltarScene(g, altar);
    },

    /**
     * *label_2609（272344-272611）—— 祭坛画面。
     * 背景 bg_altar.bmp、中央 650×270 窗口、《神名》按神上色、神的一句话、
     * 神说明（272291-272343 的 var_122）与右上立绘 godN.bmp 都由 AltarView 生成。
     */
    openAltarScene(g, altar) {
      const F = Elona.Faith;
      const AV = Elona.AltarView;
      const p = g.player;
      const god = altar.f[25] | 0;
      const faith = p.get(F.F_GOD) | 0;
      const name = F.name(god);
      // 272353-272382：有信仰时是「改宗到 X」（祭坛无主则「舍弃信仰」），否则「信仰 X」
      const rows = faith !== 0
        ? [{ i: 0, act: 'convert', label: god === 0 ? '舍弃信仰' : `改宗到 ${name}` }]
        : [{ i: 0, act: 'convert', label: `信仰 ${name}` }];
      rows.push({ i: 1, act: 'cancel', label: '算了' });
      if (!AV) { Elona.UI.pushMessage('祭坛画面模块未加载。'); return; }
      this.open('altar', '', AV.buildHtml(god, name, rows), {
        cls: 'altar-box', rows, hint: '',
        onPick: (row) => {
          this.close();
          if (!row || row.act !== 'convert') return;
          // 272582-272586：先放九神之印（convert 内部），并把祭坛的供奉计数清零
          const r = F.convert(g, p, god);
          if (altar && altar.f) altar.f[17] = 0;
          for (const m of (r.messages || [])) Elona.UI.pushMessage(m);
          g.endTurn();
        },
      });
    },

    /**
     * *label_2613（272654-272724）—— 向自己的神祈祷的确认。
     * 没有信仰时原版直接「你并不信仰任何神，只是试着祈祷了一下。」（272655-272660）。
     */
    openPray(g, faith) {
      const F = Elona.Faith;
      const p = g.player;
      const god = (typeof faith === 'number') ? faith : (p.get(F.F_GOD) | 0);
      if (god === 0) {
        Elona.UI.pushMessage('你并不信仰任何神，只是试着祈祷了一下。');
        return;
      }
      const piety = p.get(F.F_PIETY) | 0;
      const charge = p.get(F.F_CHARGE) | 0;
      this.chooseRow(`要向 ${F.name(god)} 祈祷吗？（恩惠 ${piety}/${F.capOf(p)}　充能 ${Math.min(100, Math.floor(charge / 10))}%）`,
        ['祈祷', '算了'], (i) => {
          if (i !== 0) return;
          const r = F.pray(g, p);
          for (const m of (r.messages || [])) Elona.UI.pushMessage(m);
          if (!r.ok) {
            if (r.message) Elona.UI.pushMessage(r.message);
            return;
          }
          g.endTurn();
        });
    },

    // ======================================================================
    // 献祭（O，var_486=19）
    // ======================================================================
    openOfferAtAltar(g) {
      const F = Elona.Faith;
      const M = Elona.MapFeat;
      const altar = (F && F.altarAt) ? F.altarAt(g, g.player.x, g.player.y)
        : (M && M.altarAt(g, g.player.x, g.player.y));
      if (!altar) { g.log('这里没有祭坛。'); return; }
      if ((g.player.get(61) | 0) === 0) { g.log('你没有信仰任何神，先祈祷吧。'); return; }
      this.openItemPicker(g, {
        title: '献上哪件物品？',
        onPick: (idx, it) => {
          const r = (F && F.offer) ? F.offer(g, g.player, idx) : M.offer(g, g.player, idx);
          if (r && r.ok) {
            for (const m of (r.messages || [])) this.pushMsg(m);
            if (!r.messages || !r.messages.length) {
              if (r.contested) this.pushMsg(`${r.name} 守护住了祭坛。`);
              else if (r.takenOver) this.pushMsg(`你夺取了祭坛，${r.name} 的虔诚提升了。`);
              else this.pushMsg(`你把 ${Elona.ItemDB.name(it.id, 'en')} 献给了 ${r.name}。`);
            }
            g.endTurn();
          } else {
            this.pushMsg((r && r.message) || '献祭失败。');
          }
        },
      });
    },

    pushMsg(t) { Elona.UI.pushMessage(t); },

    // ======================================================================
    // 素材 / 材料（m → label_2582）
    // ======================================================================
    /**
     * 调合 / 炼金面板 —— 数据来自 *label_2645 的配方表（recipes.json）。
     *
     * 【说明】原版 `m` 键是「素材」画面（label_2582，语义未确认），调合实际由
     * 「使用调合道具」进入（var_486 分支）。本项目两处都缺，故把调合挂在 `m` 上，
     * 已在 docs/02-diff-report.md 登记。
     */
    /**
     * 素材窗口 —— 原版 `m`（key_material）对应的 *label_2582（270703-270880）。
     *
     * 原版界面：标题「所持マテリアル」，每行「名称 ×数量」+ 右列说明，带图标。
     * 本项目没有单独的材料图标素材，用分类名代替图标。
     *
     * 因为 0-AQ 把「调合 / 炼金」挂在 `m` 上只是个临时安排，这里把 `m` 还原成
     * 素材窗口，调合改为在面板内按 `r` 进入（差异报告 A58）。
     */
    async openMaterials(g, keepSel) {
      const Mat = Elona.Material;
      if (!Mat) { Elona.UI.pushMessage('材料模块未加载。'); return null; }
      await Mat.load();

      const held = Mat.list(g);
      this.rows = held;
      const head = '<div class="pui-note">材料与物品是两套库存（var_497）。'
        + '在地下城的矿脉 / 泉 / 残骸 / 植物上按 Space 可以采集。</div>';
      const body = held.length
        ? held.map((r, i) => {
          const d = Mat.def(r.id);
          const cat = d && d.cats && d.cats[0] ? Mat.catName(d.cats[0]) : '';
          return `<div class="pui-row" data-i="${i}">`
            + `<span class="pui-name">${esc(Mat.name(r.id, 'en'))}</span>`
            + `<span class="pui-dim">${esc(cat)}</span>`
            + `<span class="pui-num">×${r.count}</span></div>`
            + `<div class="pui-dim" style="padding:0 6px 4px 6px">${esc(Mat.desc(r.id, 'en'))}</div>`;
        }).join('')
        : '<div class="pui-note">（还没有任何材料）</div>';

      this.open('materials', `所持材料（${held.length} 种）`, head + body, {
        wide: true, hint: 'r 调合 / 炼金　↑↓ 选择　Esc 关闭',
      });
      this.sel = Math.min(keepSel === undefined ? 0 : keepSel, Math.max(0, held.length - 1));
      this.renderSel();
      this.onKeyFn = (e) => {
        if (e.key === 'r' || e.key === 'R') { this.openCraft(g); return true; }
        return false;
      };
      return held;
    },

    /** 调合 / 炼金面板（数据来自 *label_2645 的配方表） */
    async openCraft(g, keepSel) {
      if (!Elona.Craft) { Elona.UI.pushMessage('调合模块未加载。'); return null; }
      await Elona.Craft.load();
      const rows = Elona.Craft.list(g);
      this.rows = rows;
      const html = '<div class="pui-note">调合成功率取决于对应技能等级与配方需求等级；'
        + '失败时有 1/3 概率损失材料。</div>'
        + rows.map((r, i) => {
          const miss = r.ok ? `${r.mats.length} 种材料` : '缺：' + r.missing.slice(0, 2).map((m) => Elona.Craft.matName(m)).join('、');
          // 未习得需求技能时，成功率恒为 0（rpdiff 的 -125 分支），单独提示
          const rateTxt = r.skillOk ? `${r.rate}% ${r.rateText}` : `未习得技能 ${r.lackSkills.join('/')}`;
          // 0-CM：必要時間（window_recipe2，279822-279834）
          const timeTxt = r.time ? `${r.time.text}` : '';
          return `<div class="pui-row" data-i="${i}">`
            + `<span class="pui-name">${esc(r.name)}</span>`
            + `<span class="pui-dim">${esc(miss)}</span>`
            + `<span class="pui-num">${esc(rateTxt)}　${esc(timeTxt)}</span></div>`;
        }).join('');
      const sel = keepSel === undefined ? 0 : keepSel;
      this.open('craft', `调合 / 炼金（${rows.length} 个配方）`, html, {
        wide: true, hint: '↑↓ 选择　Enter 调合　Esc 关闭',
        onPick: async (row) => {
          // 0-FY：*label_2659 —— 选中配方只是「开始调合」，要等 rowact 12
          //   跑完必要回合数才在 Game.completeRowAct 里结算成功/失败。
          const res = await Elona.Craft.begin(g, row.id);
          if (res && res.started) {
            Elona.UI.pushMessage(`开始调合（约 ${res.turns} 回合，移动会中断）。`);
            this.close();
            return;
          }
          Elona.UI.pushMessage(res ? res.message : '无法调合。');
          await this.openCraft(g, this.sel);
        },
      });
      this.sel = Math.min(sel, Math.max(0, rows.length - 1));
      this.renderSel();
      return rows;
    },

    // ======================================================================
    // 釣り（使用钓竿 → 320007-320014「钓几小时」）
    // ======================================================================
    /**
     * 钓鱼时长选择窗 —— 对应 320007-320014。
     * 原版用 `gosub *label_2892` 的数字输入框，提示「何時間釣ろうか？」；
     * 这里改成固定档位列表（1/2/3/6/12 小时），选定后进入 rowact 7。
     * 收竿条件：时间到、鱼饵用完、背包满（见 core/fishing.js）。
     */
    openFishHours(g, rodIdx, spPaid) {
      const F = Elona.Fishing;
      if (!F) { Elona.UI.pushMessage('钓鱼模块未加载。'); return; }
      const hours = [1, 2, 3, 6, 12];
      const rows = hours.map((h) => ({ hours: h }));
      this.rows = rows;
      const rod = g.player.inv[rodIdx];
      const bait = rod ? (rod.f[9] | 0) : 0;
      const rodName = rod ? Elona.ItemDB.name(rod, 'en') : '钓竿';
      const head = `<div class="pui-note">《${esc(rodName)}》`
        + `　剩余鱼饵 ${bait}　釣り技能 ${g.player.skill(F.SKILL) | 0}</div>`;
      const body = rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${r.hours} 小时</span>`
        + `<span class="pui-dim">大约 ${r.hours * 60} 分钟游戏时间</span></div>`).join('');
      this.open('fish', '釣り — 要钓几个小时？', head + body, {
        hint: '↑↓ 选择　Enter 开始　Esc 取消',
        onPick: (row) => {
          const r = F.start(g, rodIdx, row.hours, { spPaid: !!spPaid });
          if (r && r.ok) Elona.UI.pushMessage(r.immediate ? '用机械假饵立刻有鱼上钩。' : `你开始钓鱼（${row.hours} 小时）。`);
          this.close();
        },
      });
      this.sel = 0;
      this.renderSel();
    },

    // ======================================================================
    // 坐具（使用椅子/沙发/王座 → *label_3016 effect 44，349999-350071）
    // ======================================================================
    /**
     * 坐下菜单。原版 350015-350028 按 `f[25]` 动态生成：
     *   くつろぐ（总是有）/ マイチェアにする（f25≠1）/ お客用のチェアにする（f25≠2）
     *   / 誰でも座っていい（f25≠0）
     */
    openSitMenu(g, it) {
      const F = Elona.ItemFx;
      if (!F) { Elona.UI.pushMessage('物品效果模块未加载。'); return; }
      const opts = F.sitOptions(it);
      const rows = opts.map((o) => ({ opt: o }));
      this.rows = rows;
      const name = esc(Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : '椅子');
      const own = it.f[25] | 0;
      const ownText = own === 1 ? '我的座位' : (own === 2 ? '客人的座位' : '谁都可以坐');
      const head = `<div class="pui-note">《${name}》　当前：${ownText}</div>`;
      const body = rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${esc(r.opt.label)}</span></div>`).join('');
      this.open('sit', '坐下', head + body, {
        hint: '↑↓ 选择　Enter 确定　Esc 取消',
        onPick: (row) => {
          const r = F.sitApply(g, it, row.opt.value);
          if (r && r.ok) Elona.UI.pushMessage(r.message);
          this.close();
        },
      });
      this.sel = 0;
      this.renderSel();
    },

    // ======================================================================
    // 梳妆台（itemfx 19 → *label_2809，295248-295352）
    // ======================================================================
    /**
     * 「隐藏身体部位」面板：5 个开关（胸 / 腿 / 腰带 / 手套 / 披风）。
     * 开关量写 `var_508(20..24)`：0 = 显示、1 = 隐藏（23863/24008/24032/24054/24075/24121）。
     */
    openDressPanel(g, c) {
      const P = Elona.PCC;
      if (!P || !P.HIDE_PARTS) { Elona.UI.pushMessage('外观模块未加载。'); return; }
      const who = (c && c.name) || '你';
      const build = () => {
        const st = P.hideState(c);
        return P.HIDE_PARTS.map((p) => ({ part: p, hidden: !!st[p.key] }));
      };
      const bodyOf = (rows) => rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${esc(r.part.jp)}　${esc(r.part.en)}</span>`
        + `<span class="pui-name">${r.hidden ? '隐藏' : '显示'}</span></div>`).join('');
      const paint = (keep) => {
        const rows = build();
        this.rows = rows;
        this.open('dress', `整理装扮　${who}`,
          `<div class="pui-note">关掉某一项后，该部位不再绘制（原版「Parts to hide」）</div>` + bodyOf(rows), {
            hint: '↑↓ 选择　Enter 切换　Esc 关闭',
            onPick: (row) => {
              const idx = this.rows.indexOf(row);
              const r = Elona.ItemFx.dressToggle(g, c, row.part.key);
              if (r && r.ok) Elona.UI.pushMessage(r.message);
              paint(idx);
            },
          });
        this.sel = Math.max(0, Math.min(keep | 0, this.rows.length - 1));
        this.renderSel();
      };
      paint(0);
    },

    // ======================================================================
    // 写作台（itemfx 114，350072-350458）
    // ======================================================================
    /** 350092-350099：取消 / 稿件生产 / 自费出版 / 法术书转换 */
    openDeskMenu(g, it) {
      const W = Elona.Writing;
      if (!W) { Elona.UI.pushMessage('写作模块未加载。'); return; }
      const opts = W.deskOptions(g);
      const rows = opts.map((o) => ({ opt: o }));
      this.rows = rows;
      const head = `<div class="pui-note">灵感：${W.inspiration(g)}　所持金：${g.player.get(30) | 0} gold`
        + `　稿件：${W._internals.countInInv(g.player, W.MANUSCRIPT)} 份</div>`;
      const body = rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${esc(r.opt.label)}</span></div>`).join('');
      this.open('desk', '写作台', head + body, {
        hint: '↑↓ 选择　Enter 确定　Esc 取消',
        onPick: (row) => {
          const v = row.opt.value | 0;
          if (v === 0) { this.close(); return; }
          if (v === 1) {
            const r = W.startWrite(g);
            if (!r.ok) Elona.UI.pushMessage(r.message);
            this.close();
            return;
          }
          if (v === 2) {
            const r = W.publish(g);
            Elona.UI.pushMessage(r.message);
            this.close();
            return;
          }
          if (v === 3) { this.openSpellbookPick(g); return; }
          this.close();
        },
      });
      this.sel = 0;
      this.renderSel();
    },

    /** 350195-350200：选一个有库存的法术转成魔法书 */
    openSpellbookPick(g) {
      const W = Elona.Writing;
      const opts = W.spellbookOptions(g);
      if (opts.length <= 1) {
        Elona.UI.pushMessage('没有可以转化的法术。');
        this.close();
        return;
      }
      const rows = opts.map((o) => ({ opt: o }));
      this.rows = rows;
      const body = rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${esc(r.opt.label)}</span></div>`).join('');
      this.open('spellbook', '法术书转换', body, {
        hint: '↑↓ 选择　Enter 确定　Esc 返回',
        onPick: (row) => {
          const v = row.opt.value | 0;
          if (!v) { this.openDeskMenu(g, null); return; }
          const r = W.toSpellbook(g, v);
          Elona.UI.pushMessage(r.message);
          this.close();
        },
      });
      this.sel = 0;
      this.renderSel();
    },

    // ======================================================================
    // 留言板 / 家产清单（itemfx 8 → *label_2435，232969）
    // ======================================================================
    openBoard(g, lines) {
      const arr = Array.isArray(lines) ? lines : [];
      this.rows = [];
      const body = arr.map((s) => `<div class="pui-row"><span class="pui-name">${esc(s)}</span></div>`).join('');
      this.open('board', '留言板', body || '<div class="pui-note">（空空如也）</div>', {});
      this.sel = -1;
      this.renderSel();
    },

    // ======================================================================
    // 0-FS：房屋告示板（ハウスボード 611）—— 233240-233300
    // ======================================================================
    /**
     * 菜单本体（233269-233300）。每行对应源码的一个 var_1302：
     *   0 家の模様替え / 2 家の情報 / 3 滞在者の移動 / 4 仲間の滞在 /
     *   6 使用人を募集する / 7 生成される扉変更 / 16 タイルグループ変更 /
     *   9 外装変更 / 23 お片付け機能
     */
    openHomeBoard(g, res) {
      const H = Elona.Home;
      if (!H) return;
      this.onClose = null;                 // 清掉上一个窗口（如雇人面板）的取消回调
      const menu = (res && res.menu) || H.menu(g);
      const head = (res && res.head) || H.inventoryHead(g);
      this.rows = menu.map((m, i) => ({ i, key: m.key, label: m.label }));
      const html = `<div class="pui-note">${esc(head)}</div>`
        + this.rows.map((r) => `<div class="pui-row" data-i="${r.i}">`
          + `<span class="pui-key">${'abcdefghij'[r.i] || ''}</span>`
          + `<span class="pui-name">${esc(r.label)}</span></div>`).join('');
      this.open('homeboard', '房屋告示板', html, {
        hint: '↑/↓ 选择　Enter 确定　Esc 关闭',
        onPick: (row) => this.homeBoardAct(g, row.key),
      });
      this.onKeyFn = (e) => {
        if (e.key && e.key.length === 1) {
          const i = 'abcdefghij'.indexOf(e.key.toLowerCase());
          if (i >= 0 && i < this.rows.length) {
            this.sel = i;
            this.renderSel();
            this.homeBoardAct(g, this.rows[i].key);
            return true;
          }
        }
        return false;
      };
    },

    /** 告示板菜单项结算 */
    homeBoardAct(g, key) {
      const H = Elona.Home;
      if (!H) return;
      if (key === 'design') {
        this.close();
        H.design.start(g);
        if (g.designSel === undefined) g.designSel = true;
        Elona.UI.pushMessage('装修模式：方向键移动光标，回车＝铺当前地砖，');
        Elona.UI.pushMessage('右键＝取光标下的地砖，T＝打开地砖一览，Esc＝结束。');
        return;
      }
      if (key === 'info') { this.openHomeInfo(g); return; }
      if (key === 'stay') { this.openHomeStay(g); return; }
      if (key === 'move') { this.openHomeMove(g); return; }
      if (key === 'hire') { this.openHomeHire(g); return; }
      if (key === 'door') {
        const r = H.cycleDoor(g);
        Elona.UI.pushMessage(r.message);
        this.openHomeBoard(g);
        return;
      }
      if (key === 'tileset') {
        const r = H.cycleTileset(g);
        Elona.UI.pushMessage(r.message);
        if (Elona.reloadTilesetSheet) Elona.reloadTilesetSheet(g.map.tileset);
        this.openHomeBoard(g);
        return;
      }
      if (key === 'exterior') {
        this.openTextInput('外装変更', '', (v) => {
          if (v === null) { this.openHomeBoard(g); return; }
          const n = parseInt(String(v).trim(), 10);
          const r = H.setExterior(g, Number.isFinite(n) ? n : 0);
          Elona.UI.pushMessage(r.message);
          this.openHomeBoard(g);
        }, { note: '请输入 1〜33（0 = 恢复默认外观）。' });
        return;
      }
      if (key === 'collect') {
        const r = H.collectAll(g);
        Elona.UI.pushMessage(r.message);
        if (r.count) g.endTurn();
        this.openHomeBoard(g);
        return;
      }
    },

    /** 家の情報（233520-233560）：価値 / 家宝ランク / 滞在者 */
    openHomeInfo(g) {
      const H = Elona.Home;
      if (!H) return;
      const v = H.homeInfo(g);
      const star = (n) => '★'.repeat(Math.max(1, n | 0));
      const rows = [
        ['家的等级', `${v.rank}（${v.rankName}）`],
        ['地图', v.file],
        ['现在的位置', `第 ${v.floor} 层 / 最多 ${v.maxFloor} 层`],
        ['道具上限', `${v.cap} 个`],
        ['基本', `${v.base}　${star(v.stars.base)}`],
        ['家具', `${v.furn}　${star(v.stars.furn)}`],
        ['家宝', `${v.heir}　${star(v.stars.heir)}`],
        ['综合', `${Math.trunc((v.base + v.furn + v.heir) / 3)}　${star(v.stars.total)}`],
        ['滞在者', `${v.stayers} 人 / 上限 ${v.maxStayers} 人`],
        ['持有建筑', `${v.estates} 处`],
      ];
      const html = rows.map((r) => `<div class="pui-row"><span class="pui-name">${esc(r[0])}</span>`
        + `<span class="pui-num" style="margin-left:auto">${esc(r[1])}</span></div>`).join('');
      this.rows = [];
      this.open('homeinfo', '家の情報 / 家的信息', html, { hint: 'Esc 返回' });
      this.sel = -1;
      this.renderSel();
    },

    /** 仲間の滞在（233731-233800）：让同伴留在家里 / 取消 */
    openHomeStay(g) {
      const H = Elona.Home;
      const P = Elona.Party;
      if (!H || !P) return;
      const members = P.members(g) || [];
      if (!members.length) {
        Elona.UI.pushMessage('现在没有可以留下来的同伴。');
        this.openHomeBoard(g);
        return;
      }
      this.rows = members.map((c, i) => ({ i, c }));
      const html = `<div class="pui-note">选一名同伴，让他留在这个家里（再选一次则取消）。</div>`
        + members.map((c) => {
          const staying = H.isStaying(c, 7);
          return `<div class="pui-row" data-i="${c.index | 0}">`
            + `<span class="pui-key">${staying ? '◆' : ''}</span>`
            + `<span class="pui-name">${esc(c.name || '')}</span>`
            + `<span class="pui-num" style="margin-left:auto">Lv ${c.level | 0}${staying ? '・滞在中' : ''}</span></div>`;
        }).join('');
      this.open('homestay', '仲間の滞在', html, {
        hint: '↑/↓ 选择　Enter 确定　Esc 返回',
        onPick: (row) => {
          const c = row.c;
          const r = H.isStaying(c, 7) ? H.unstayAlly(g, c) : H.stayAlly(g, c);
          Elona.UI.pushMessage(r.message || '');
          this.openHomeStay(g);
        },
      });
    },

    /** 滞在者の移動（233651-233745）：把选中的滞在者叫到身边 */
    openHomeMove(g) {
      const H = Elona.Home;
      if (!H) return;
      const list = [];
      for (let i = 57; i < 245; i++) {
        const c = g.charas[i];
        if (c && (c.get(0) | 0) === 1) list.push(c);
      }
      const party = (Elona.Party && Elona.Party.members) ? Elona.Party.members(g) : [];
      for (const c of party) if (list.indexOf(c) < 0 && H.isStaying(c, 7)) list.push(c);
      if (!list.length) {
        Elona.UI.pushMessage('这层没有可以移动的人。');
        this.openHomeBoard(g);
        return;
      }
      this.rows = list.map((c, i) => ({ i, c }));
      const html = `<div class="pui-note">把谁叫到你现在站的位置？</div>`
        + list.map((c) => `<div class="pui-row" data-i="${c.index | 0}">`
          + `<span class="pui-name">${esc(c.name || '')}</span>`
          + `<span class="pui-num" style="margin-left:auto">(${c.x | 0}, ${c.y | 0})</span></div>`).join('');
      this.open('homemove', '滞在者の移動', html, {
        hint: '↑/↓ 选择　Enter 确定　Esc 返回',
        onPick: (row) => {
          const r = H.moveStayer(g, row.c, g.player.x, g.player.y);
          Elona.UI.pushMessage(r.message || '');
          this.openHomeBoard(g);
        },
      });
    },

    /** 使用人を募集する（235039-235145） */
    openHomeHire(g) {
      const H = Elona.Home;
      if (!H) return;
      const r = H.recruit(g);
      if (!r.ok) {
        Elona.UI.pushMessage(r.message);
        this.openHomeBoard(g);
        return;
      }
      this.rows = r.candidates.map((c, i) => ({ i, cand: c }));
      const html = `<div class="pui-note">谁要来应聘？（家里的上限：${H.rank(g) + 2} 人）</div>`
        + r.candidates.map((c) => `<div class="pui-row" data-i="${c.slot | 0}">`
          + `<span class="pui-name">${esc(c.chara.name || '')}</span>`
          + `<span class="pui-num" style="margin-left:auto">Lv ${c.chara.level | 0}・${c.cost | 0} GP</span></div>`).join('');
      this.open('homehire', '使用人を募集する', html, {
        hint: '↑/↓ 选择　Enter 雇用　Esc 取消',
        onPick: (row) => {
          const hr = H.hire(g, row.cand);
          Elona.UI.pushMessage(hr.message || '');
          this.openHomeBoard(g);
        },
      });
      this.onClose = () => {
        // 取消 → 候选全部撤掉（源码末尾 chara_vanquish state 10）
        for (const c of g.charas) {
          if (c && (c.get(0) | 0) === 10) c.set(0, 0);
        }
      };
    },

    // ======================================================================
    // 0-FS：装修用的地砖一览（*label_2670 的「決定キーでタイル一覧」，234300）
    // ======================================================================
    /**
     * 33 个一页的地砖面板。缩略图直接从 map<tileset>.bmp 裁 48×48 画进 canvas，
     * 与地图渲染用的是同一张图，所以选到的图块号可以直接写进 cell[0]。
     */
    openTilePalette(g, page) {
      const H = Elona.Home;
      if (!H) return;
      const PER = 33;
      const total = 825;                         // 33 列 × 25 行
      let pg = (page | 0);
      pg = Math.max(0, Math.min(Math.floor((total - 1) / PER), pg));
      const start = pg * PER;
      const sheet = (Elona.renderer && Elona.renderer.sheets) ? Elona.renderer.sheets[g.map.tileset | 0] : null;
      const cells = [];
      for (let i = 0; i < PER; i++) {
        const id = start + i;
        if (id >= total) break;
        cells.push(`<div class="pui-tile" data-i="${id}" title="图块 ${id}">`
          + `<canvas width="24" height="24" data-tile="${id}"></canvas>`
          + `<span>${id}</span></div>`);
      }
      const html = `<div class="pui-note">选择要铺的地砖（第 ${pg + 1} / ${Math.ceil(total / PER)} 页）。`
        + ` 当前：${H.design.tile | 0}　←/→ 翻页</div>`
        + `<div class="pui-tiles">${cells.join('')}</div>`;
      this.rows = [];
      this.open('tiles', '地砖一览', html, { hint: '点击选择　←/→ 翻页　Esc 返回' });
      // 画缩略图
      const cvs = this.root ? this.root.querySelectorAll('canvas[data-tile]') : [];
      for (const cv of cvs) {
        const id = parseInt(cv.dataset.tile, 10) | 0;
        const sx = (id % 33) * 48, sy = Math.floor(id / 33) * 48;
        try {
          const c2 = cv.getContext('2d');
          c2.imageSmoothingEnabled = false;
          if (sheet) c2.drawImage(sheet, sx, sy, 48, 48, 0, 0, 24, 24);
        } catch (e) { /* 图未就绪时留空 */ }
      }
      const body = this.root ? this.root.querySelector('#pui-body') : null;
      if (body) {
        body.onclick = (ev) => {
          const t = ev.target.closest('.pui-tile');
          if (!t) return;
          H.design.setTile(parseInt(t.dataset.i, 10) | 0);
          this.close();
          Elona.UI.pushMessage(`地砖换成了 ${H.design.tile}。`);
        };
      }
      this.onKeyFn = (e) => {
        if (e.key === 'ArrowLeft' || e.key === '4' || e.key === 'PageUp') {
          this.openTilePalette(g, pg - 1); return true;
        }
        if (e.key === 'ArrowRight' || e.key === '6' || e.key === 'PageDown') {
          this.openTilePalette(g, pg + 1); return true;
        }
        return false;
      };
    },

    // ======================================================================
    // 0-DO：三个「对目标使用 / 兑换」窗口（itemfx 108 / 116 / 91）
    // ======================================================================
    /** 108 ヤカテクト积分卡（359211-359469）：8 项兑换 */
    openYaca(g) {
      const F = Elona.ItemFx;
      if (!F) return;
      const opts = F.yacaOptions();
      const rows = opts.map((o) => ({ opt: o }));
      this.rows = rows;
      const pts = g.getV65 ? (g.getV65(661) | 0) : 0;
      const head = `<div class="pui-note">持有 ヤカポイント：${pts}</div>`;
      const body = rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${esc(r.opt.label)}</span></div>`).join('');
      this.open('yaca', 'ヤカテクト', head + body, {
        hint: '↑↓ 选择　Enter 确定　Esc 取消',
        onPick: (row) => {
          const v = row.opt.value | 0;
          if (!v) { this.close(); return; }
          const r = F.yacaRedeem(g, v);
          Elona.UI.pushMessage(r.message);
          if (r.ok) this.close();
        },
      });
      this.sel = 0;
      this.renderSel();
    },

    /** 116 如意耳かき（359470-359831）：取消 / 给他掏 / 让他给你掏 */
    openMimikaki(g, it, target, options) {
      const F = Elona.ItemFx;
      if (!F) return;
      const rows = (options || []).map((o) => ({ opt: o }));
      this.rows = rows;
      const who = (target && target.name) || '你';
      const head = `<div class="pui-note">对象：${esc(who)}</div>`;
      const body = rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${esc(r.opt.label)}</span></div>`).join('');
      this.open('mimikaki', '如意耳かき', head + body, {
        hint: '↑↓ 选择　Enter 确定　Esc 取消',
        onPick: (row) => {
          const v = row.opt.value | 0;
          const r = F.mimikakiApply(g, it, target, v);
          if (r && r.message) Elona.UI.pushMessage(r.message);
          if (!r || !r.cancelled) this.close();
        },
      });
      this.sel = 0;
      this.renderSel();
    },

    /** 91 邪成鎌ネクロマンティス：4 个融合配方（txtsetnecrom 5） */
    openNecroFuse(g) {
      const N = Elona.Necro;
      if (!N || !N.fuseMenu) { Elona.UI.pushMessage('死灵术模块未加载。'); return; }
      const opts = N.fuseMenu();
      const rows = opts.map((o) => ({ opt: o }));
      this.rows = rows;
      const head = '<div class="pui-note">消耗 25% 斗志，两个素材都会变回暗之棺。</div>';
      const body = rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${esc(r.opt.label)}</span></div>`).join('');
      this.open('necro-fuse', '死者融合', head + body, {
        hint: '↑↓ 选择　Enter 确定　Esc 取消',
        onPick: (row) => {
          const v = row.opt.value | 0;
          if (v === 4) { this.close(); return; }
          const r = Elona.ItemFx.necromantisApply(g, v);
          Elona.UI.pushMessage(r.message || '融合失败了。');
          if (r.ok) this.close();
        },
      });
      this.sel = 0;
      this.renderSel();
    },

    // ======================================================================
    // 银行（使用 ヤカテクトの預金箱 1097 → 358530-358661）
    // ======================================================================
    /**
     * 银行窗口。原版菜单固定 6 项（11077-11103）：
     *   取消 / 金貨を取り出す / 10万入れる / 100万入れる / 1000万入れる / 1億入れる
     */
    openBank(g, boxIdx) {
      const E = Elona.Economy;
      if (!E) { Elona.UI.pushMessage('经济模块未加载。'); return; }
      const box = g.player.inv[boxIdx];
      if (!box) { Elona.UI.pushMessage('找不到存钱箱。'); return; }
      const balance = E.balance(box);
      const gold = g.player.get(30) | 0;
      const head = `<div class="pui-note">[ 現在の預金額：${balance} gold ]`
        + `　所持金 ${gold} gold</div>`;
      const rows = [
        { act: 1, label: `金貨を取り出す（${balance} gold）` },
        { act: 2, label: '10万 gold 入れる' },
        { act: 3, label: '100万 gold 入れる' },
        { act: 4, label: '1000万 gold 入れる' },
        { act: 5, label: '1億 gold 入れる' },
        { act: 0, label: 'キャンセル' },
      ];
      this.rows = rows;
      const html = rows.map((r, i) =>
        `<div class="pui-row" data-i="${i}"><span class="pui-name">${esc(r.label)}</span></div>`).join('');
      this.open('bank', 'ヤカテクト銀行', head + html, {
        hint: '↑↓ 选择　Enter 确定　Esc 关闭',
        onPick: (row) => {
          const res = E.bankTrade(g, box, row.act);
          if (res.ok) {
            if (res.taken) Elona.UI.pushMessage(`引き出した：${res.taken} gold`);
            else if (res.stored) Elona.UI.pushMessage(`預けた：${res.stored} gold（残高 ${res.balance}）`);
            g.endTurn();
          } else if (res.message) {
            Elona.UI.pushMessage(res.message);
          }
          this.openBank(g, boxIdx);
        },
      });
    },

    // ======================================================================
    // 栽培（使用作物管理セット 1174 → 手入れ / 收获）
    // ======================================================================
    /**
     * 栽培窗口 —— 对应 364492-364490（手入れ的 5 种方式）、365009（收获）、
     * 364292-364334（施肥）。原版站在作物格上使用对应道具；这里用一个面板统一入口。
     */
    async openFarm(g) {
      const F = Elona.Farm;
      if (!F) { Elona.UI.pushMessage('栽培模块未加载。'); return; }
      await F.load();
      const p = g.player;
      const feat = F.plantAt(g, p.x, p.y);
      const st = F.STAGES;
      const head = feat
        ? `<div class="pui-note">脚下的作物：${esc(F.stageName(feat))}`
          + `　种类 ${feat.sub | 0}　照料余力 ${feat.arg3 | 0}</div>`
        : '<div class="pui-note">脚下没有作物。站到作物格上再使用作物管理セット。</div>';
      const rows = [];
      if (feat && (feat.id | 0) !== st.RIPE) {
        for (let i = 1; i <= 5; i++) rows.push({ act: 'tend', choice: i, label: `手入れ ${i}：${F.TEXT.tend[i - 1]}` });
      }
      if (feat && (feat.id | 0) === st.RIPE) rows.push({ act: 'harvest', label: '收获' });
      if (feat && (feat.id | 0) === st.GROWING && F.isField(g, p.x, p.y)) {
        rows.push({ act: 'fertilize', label: '施肥' });
      }
      this.rows = rows;
      const html = rows.length
        ? rows.map((r, i) => `<div class="pui-row" data-i="${i}"><span class="pui-name">${esc(r.label)}</span></div>`).join('')
        : '<div class="pui-dim">现在没有可做的事。</div>';
      this.open('farm', '栽培', head + html, {
        hint: '↑↓ 选择　Enter 执行　Esc 关闭',
        onPick: (row) => {
          let r = null;
          if (row.act === 'tend') r = F.tend(g, p.x, p.y, row.choice);
          else if (row.act === 'harvest') r = F.harvest(g, p.x, p.y);
          else if (row.act === 'fertilize') r = F.fertilize(g, p.x, p.y);
          if (r && r.ok) g.endTurn();
          this.openFarm(g);
        },
      });
    },

    // ======================================================================
    // 料理（烹饪器具 → *label_2303，225016-225136；itemfx effect 15）
    // ======================================================================
    /**
     * 319873-319892：先选食材（`var_486 = 16`：类别 57000 且 `f[26] == 0`），
     * 再扣 SP（`rnd(8) + 8`，SP < 50 时有失败判定），最后走 `*label_2303`。
     */
    openCook(g, tool) {
      const CK = Elona.Cook;
      if (!CK) { Elona.UI.pushMessage('料理系统未加载。'); return; }
      const p = g.player;
      const skill = p.skill ? (p.skill(CK.SKILL) | 0) : 0;
      const tier = CK.toolTier(tool);
      const cap = CK.TIER_CAP[tier] === undefined ? 9 : CK.TIER_CAP[tier];
      this.openItemPicker(g, {
        title: `用${Elona.ItemDB.name(tool.id, 'en')}料理（料理 ${skill}　上限品质 ${cap}）`,
        filter: (it) => CK.isIngredient(g, it),
        hint: '↑↓ 选择　Enter 料理　Esc 取消',
        decorate: (it) => {
          const cat = Math.floor((it.f[25] | 0) / 1000);
          return cat ? `类别 ${cat}` : '';
        },
        onPick: (idx) => {
          const r = CK.cook(g, tool, idx);
          if (r.ok) {
            Elona.UI.pushMessage(r.message);
            Elona.UI.pushMessage(`品质 ${r.quality}。` + (r.purified ? '（胸像的火焰净化了它）' : ''));
            g.endTurn();
          } else if (r.message) {
            Elona.UI.pushMessage(r.message);
            if (r.reason === 'exhausted') g.endTurn();
          }
        },
      });
    },

    // ======================================================================
    // 生産（使用工具 → *label_2578）
    // ======================================================================
    /**
     * 生产窗口 —— 对应 *label_2578（270386-270700）。
     *
     * 原版：使用「工具 / 錬金術の道具 / 宝石加工ツール / 裁縫セット」（var_99(19)=1..4）
     * 后进入，列出该技能能做的所有产物（技能+3 < 需求 的不显示）。
     * 每行显示：产物名、需求技能等级、所需材料（有/需），Enter 开始制作。
     */
    async openProduce(g, kitType, keepSel) {
      const Pr = Elona.Produce;
      const Mat = Elona.Material;
      if (!Pr) { Elona.UI.pushMessage('生产模块未加载。'); return null; }
      await Pr.load();
      await Mat.load();

      const rows = Pr.list(g, kitType);
      this.rows = rows;
      const skill = Pr.kitSkill(kitType);
      const lv = g.player.skill(skill) | 0;
      // 工具名（没有对应工具时用通用名，例如从控制台直接打开）
      const kit = Pr.kits(g).find((k) => k.type === kitType);
      const kitName = kit ? Elona.ItemDB.name(kit.item.id, 'en') : '工具';

      const head = `<div class="pui-note">${esc(Pr.SKILL_NAME[skill] || '')} 技能 ${lv}`
        + '　材料来自采集（矿脉 / 泉 / 残骸 / 植物）与调合。</div>';
      const body = rows.length
        ? rows.map((r, i) => {
          const mats = r.mats.map((m) => {
            const have = Mat.get(g, m[0]) | 0;
            const mark = have >= m[1] ? '' : '!';
            return `${mark}${Mat.name(m[0], 'en')} ${have}/${m[1]}`;
          }).join('，');
          return `<div class="pui-row" data-i="${i}">`
            + `<span class="pui-name">${esc(r.name)}</span>`
            + `<span class="pui-dim">Lv${r.req}　${esc(mats)}</span>`
            + `<span class="pui-num">${r.ok ? '可制作' : '材料不足'}</span></div>`;
        }).join('')
        : '<div class="pui-note">这件工具暂时没有可制作的东西（技能等级太低）。</div>';

      this.open('produce', `生産 — ${esc(kitName)}（${rows.length} 种）`, head + body, {
        wide: true, hint: '↑↓ 选择　Enter 制作　Esc 关闭',
        onPick: (row) => {
          if (!row.ok) {
            Elona.UI.pushMessage('生产的条件没有满足。');
            return;
          }
          const res = Pr.produce(g, row.id);
          Elona.UI.pushMessage(res.message);
          if (res.ok) {
            // 生产是一次行动（原版回到窗口并 page_save）
            g.endTurn();
            Elona.UI.pushMessage(`品质 ${['', '', '普通', '良品', '逸品'][res.fix] || res.fix}、等级 ${res.level}`);
          }
          this.openProduce(g, kitType, this.sel);
        },
      });
      this.sel = Math.min(keepSel === undefined ? 0 : keepSel, Math.max(0, rows.length - 1));
      this.renderSel();
      return rows;
    },

    // ======================================================================
    // 快捷栏（z → label_2735）
    // ======================================================================
    /**
     * 20 个快捷槽 —— var_65(40+n)。
     * Enter 使用；s 绑定法术/技能；x 绑定物品；d 清除。
     * 原版的绑定入口在技能/物品菜单内，本实现改为在快捷栏内发起（功能等价，已登记差异）。
     */
    async openQuickSlots(g, keepSel) {
      if (!Elona.QuickSlot) { Elona.UI.pushMessage('快捷栏模块未加载。'); return; }
      await Elona.QuickSlot.loadNames();
      const rows = Elona.QuickSlot.all(g);
      this.rows = rows;
      const html = '<div class="pui-note">Enter 使用　s 绑定技能/法术　x 绑定物品　d 清除该槽</div>'
        + rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-key">{${i + 1}}</span>`
          + `<span class="pui-name">${esc(r.label)}</span>`
          + `<span class="pui-dim">${r.kind === 'empty' ? '' : r.kind}</span></div>`).join('');
      this.open('quick', '快捷栏', html, {
        wide: true, hint: 'Enter 使用　s 绑定　x 绑定物品　d 清除　Esc 关闭',
        onPick: (row) => this.useQuick(g, row.index),
      });
      this.sel = Math.min(keepSel === undefined ? 0 : keepSel, rows.length - 1);
      this.renderSel();
      this.onKeyFn = (e) => {
        if (e.key === 's') { this.bindQuickSpell(g); return true; }
        if (e.key === 'x') { this.bindQuickItem(g); return true; }
        if (e.key === 'd') {
          Elona.QuickSlot.clear(g, this.sel);
          Elona.UI.pushMessage(`已清除 {${this.sel + 1}}。`);
          this.openQuickSlots(g, this.sel);
          return true;
        }
        return false;
      };
    },

    /** 使用某个快捷槽（label_2735） */
    useQuick(g, index) {
      const r = Elona.QuickSlot.use(g, index);
      if (r.message) Elona.UI.pushMessage(r.message);
      if (r.action === 'item-mode') {
        this.close();
        Elona.UI.openUse(g, r.mode);        // 288629-288632：打开对应模式的物品选择
      } else if (r.ok && r.kind === 'spell') {
        this.close();
      }
      return r;
    },

    /** 把法术库存里的一个法术绑定到当前槽 */
    bindQuickSpell(g) {
      const target = this.sel;
      const st = g.player.spellStock || [];
      const list = [];
      for (let i = 0; i < 200; i++) {
        if ((st[i] | 0) > 0) list.push({ id: 400 + i, n: st[i] | 0 });
      }
      if (!list.length) { Elona.UI.pushMessage('你还没有记忆任何魔法。'); return; }
      this.rows = list;
      const html = list.map((s, i) => `<div class="pui-row" data-i="${i}">`
        + `<span class="pui-name">${esc(Elona.QuickSlot.labelOf(s.id))}</span>`
        + `<span class="pui-num">${s.n} 次</span></div>`).join('');
      this.open('quickbind', `绑定法术到 {${target + 1}}`, html, {
        wide: true, hint: 'Enter 绑定　Esc 取消',
        onPick: (row) => {
          Elona.QuickSlot.bindSpell(g, target, row.id);
          Elona.UI.pushMessage(`已把 ${Elona.QuickSlot.labelOf(row.id)} 绑定到 {${target + 1}}。`);
          this.openQuickSlots(g, target);
        },
      });
    },

    /** 把背包里的一件物品绑定到当前槽（模式 14 = 使用） */
    bindQuickItem(g) {
      const target = this.sel;
      this.openItemPicker(g, {
        title: `把哪件物品绑定到 {${target + 1}}？`,
        filter: (it) => it.eqSlot < 0,
        onPick: (idx, it) => {
          Elona.QuickSlot.bindItem(g, target, it.id, 14);
          Elona.UI.pushMessage(`已把 ${Elona.ItemDB.name(it.id, 'en')} 绑定到 {${target + 1}}。`);
          this.openQuickSlots(g, target);
        },
      });
    },

    // ======================================================================
    // 剧本回放（原版 602119-602135：可选已播放过的区块重看）
    // ======================================================================
    /**
     * 列出剧本区块。原版只列 var_65(36) 之前的区块（602125 的 cnt <= var_65(36)），
     * 这里保持一致；未播放过的区块标灰且不可选。
     */
    async openScenes() {
      if (!Elona.Scene) { Elona.UI.pushMessage('剧情模块未加载。'); return null; }
      await Elona.Scene.load();
      await Elona.Scene.loadTrans();
      const ids = Elona.Scene.blockIds();
      const played = Elona.Scene.playedTo(Elona.game);
      const rows = ids.map((id) => {
        const seq = Elona.Scene.sequence(id);
        const first = seq.find((c) => c.t === 'page' && c.lines && c.lines.length);
        const preview = first ? Elona.Scene.text(first.keys[0] || '', first.lines[0]).slice(0, 24) : '（无文本）';
        return { id, label: `场景 ${id}`, preview, ok: id <= played, pages: seq.filter((c) => c.t === 'page').length };
      });
      this.rows = rows;
      // 诊断：当前地图 id / 子地图 / 主任务状态 / 待触发规则
      // （对应源码 var_65(20) / var_65(22) / var_65(250+2) 与触发链 246741-248481）
      let diag = '';
      if (Elona.Story) {
        const g = Elona.game;
        const mapId = g.getV65(20) | 0;
        const subId = g.getV65(Elona.Story.V_SUBMAP) | 0;
        const st = Elona.Story.state(g);
        const d = Elona.Story.diagnose(g);
        const pending = d.yes.map((r) => r.block);
        diag = '<div class="pui-note">当前：地图 ' + esc(g.map ? g.map.name : '?')
          + '（id ' + mapId + ' / 子地图 ' + subId + '）　主任务状态 ' + st
          + '　待触发规则 ' + (pending.length ? pending.join(', ') : '无')
          + '　未知条件 ' + d.unknown.length + ' 条</div>';
      }
      const html = diag
        + '<div class="pui-note">只列出已播放过的场景（var_65(36) = '
        + played + '）。Enter 播放，播放中按 Esc 跳过。</div>'
        + rows.map((r, i) => `<div class="pui-row${r.ok ? '' : ' dim'}" data-i="${i}">`
          + `<span class="pui-key">${r.id.toString().padStart(3, ' ')}</span>`
          + `<span class="pui-name">${esc(r.preview)}</span>`
          + `<span class="pui-dim">${r.ok ? r.pages + ' 页' : '未解锁'}</span></div>`).join('');
      this.open('scenes', `剧本回放（${rows.length} 个区块）`, html, {
        wide: true, hint: '↑↓ 选择　Enter 播放　Esc 关闭',
        onPick: async (row) => {
          if (!row.ok) { Elona.UI.pushMessage('这个场景还没播放过。'); return; }
          this.close();
          await Elona.SceneView.play(Elona.game, row.id, {
            auto: !!(Elona.Options && Elona.Options.values.sceneAuto),
          });
        },
      });
      return rows;
    },

    // ======================================================================
    // 游戏内菜单（Esc / key_esc → label_4367；原版还有「Game Setting」）
    // ======================================================================
    openMenu() {
      const items = [
        { id: 'resume', label: '返回游戏' },
        { id: 'save', label: '保存 / 读取（存档槽）' },
        { id: 'options', label: '选项 / 键位设置' },
        { id: 'scene', label: '剧本回放' },
        { id: 'help', label: '帮助' },
        { id: 'title', label: '返回标题画面' },
      ];
      this.rows = items;
      const html = items.map((it, i) => `<div class="pui-row" data-i="${i}"><span class="pui-name">${esc(it.label)}</span></div>`).join('');
      this.open('menu', '游戏菜单', html, {
        hint: '↑↓ 选择　Esc 返回游戏',
        onPick: (it) => {
          if (it.id === 'resume') this.close();
          else if (it.id === 'save') this.openSaveSlots();
          else if (it.id === 'options') { this.onClose = null; this.openOptions(); }
          else if (it.id === 'scene') this.openScenes();
          else if (it.id === 'help') this.openHelp();
          else if (it.id === 'title') { this.close(); if (Elona.toTitle) Elona.toTitle(); }
        },
      });
    },

    // ======================================================================
    // 存档槽（原版 label_2845 的「保存并退出」；本实现提供多槽位）
    // ======================================================================
    async openSaveSlots(note) {
      const g = Elona.game;
      const list = await Elona.Save.list().catch(() => []);
      const known = {};
      for (const s of list) known[s.slot] = s;
      const slots = [];
      for (let i = 1; i <= 6; i++) {
        const id = 'slot' + i;
        slots.push({ id, label: `${id}`, info: known[id] ? (known[id].time || '有存档') : '（空）' });
      }
      this.rows = slots;
      const html = (note ? `<div class="pui-note">${esc(note)}</div>` : '')
        + slots.map((s, i) => `<div class="pui-row" data-i="${i}"><span class="pui-name">${esc(s.label)}</span>`
          + `<span class="pui-dim">${esc(s.info)}</span>`
          + `<span class="pui-num">点击 = 保存</span></div>`).join('')
        + '<div class="pui-sep">读取</div>'
        + slots.map((s, i) => `<div class="pui-row" data-i="${slots.length + i}" data-load="1">`
          + `<span class="pui-name">读取 ${esc(s.label)}</span>`
          + `<span class="pui-dim">${esc(s.info)}</span></div>`).join('');
      // 读取行不参与箭头选择，只用点击
      this.open('slots', '存档槽', html, {
        wide: true, hint: '点击槽位保存；下段为读取　Esc 关闭',
        onPick: () => { /* 由点击分支处理 */ },
      });
      // 覆盖点击行为：区分保存 / 读取
      const body = this.root.querySelector('#pui-body');
      body.onclick = async (ev) => {
        const row = ev.target.closest('.pui-row');
        if (!row) return;
        const i = parseInt(row.dataset.i, 10) | 0;
        const slot = slots[i % slots.length];
        if (!slot) return;
        if (row.dataset.load) {
          try {
            const data = await Elona.Save.load(slot.id);
            this.close();
            await Elona.loadGame(data);
            Elona.UI.pushMessage(`已读取存档 ${slot.id}。`);
          } catch (err) { Elona.UI.pushMessage('读取失败：' + err.message); }
        } else {
          try {
            await Elona.Save.save(slot.id, g.serialize());
            Elona.UI.pushMessage(`已保存到 ${slot.id}。`);
            this.openSaveSlots(`已保存到 ${slot.id}。`);
          } catch (err) { Elona.UI.pushMessage('保存失败：' + err.message); }
        }
      };
    },

    // ======================================================================
    // 选项（原版 config.txt 的 (Screen)/(Sound)/(General) 段）
    // ======================================================================
    async openOptions(note, onClose) {
      if (onClose !== undefined) this.onClose = onClose || null;
      const Opt = Elona.Options;
      const o = Opt ? Opt.values : {};
      const K = Elona.Keys;
      const row = (i, label, val) => `<div class="pui-row" data-i="${i}"><span class="pui-name">${esc(label)}</span>`
        + `<span class="pui-num">${esc(val)}</span></div>`;
      const items = [];
      let html = note ? `<div class="pui-note">${esc(note)}</div>` : '';
      html += '<div class="pui-sep">画面</div>';
      items.push({ id: 'fullscreen', label: '全屏（fullscreen）' });
      html += row(items.length - 1, '全屏（fullscreen）', o.fullscreen ? '开' : '关');
      // 注意：Options.values 的键名与 config.txt 一致（windowAnime / msg_addTime），
      // 不能用面板行的 id（anime / msgTime）直接取值，否则显示与实际状态不符。
      items.push({ id: 'anime', label: '动画（anime_wait）' });
      html += row(items.length - 1, '动画（anime_wait）', o.windowAnime ? '开' : '关');
      items.push({ id: 'msgTime', label: '消息时间前缀（msg_addTime）' });
      html += row(items.length - 1, '消息时间前缀（msg_addTime）', o.msg_addTime ? '开' : '关');

      items.push({ id: 'sceneAuto', label: '剧情自动播放（sceneAuto）' });
      html += row(items.length - 1, '剧情自动播放（sceneAuto）', o.sceneAuto ? '开' : '关');

      html += '<div class="pui-sep">声音</div>';
      items.push({ id: 'sound', label: '音效（sound）' });
      html += row(items.length - 1, '音效（sound）', o.sound ? '开' : '关');
      items.push({ id: 'music', label: '音乐（music）' });
      html += row(items.length - 1, '音乐（music）', o.music ? '开' : '关');
      items.push({ id: 'volume', label: '音量（0-100）' });
      html += row(items.length - 1, '音量（0-100）', String(o.volume | 0));

      html += '<div class="pui-sep">操作</div>';
      items.push({ id: 'shiftEsc', label: 'Shift 当 Esc（key_sCancel）' });
      html += row(items.length - 1, 'Shift 当 Esc（key_sCancel）', K.shiftAsEsc ? '开' : '关');
      items.push({ id: 'keybind', label: '键位设置…' });
      html += row(items.length - 1, '键位设置…', '');
      items.push({ id: 'keyreset', label: '键位恢复默认' });
      html += row(items.length - 1, '键位恢复默认', '');

      this.rows = items;
      this.open('options', '选项', html, {
        wide: true, hint: 'Enter 切换　Esc 返回菜单',
        onPick: (it) => {
          if (it.id === 'keybind') { this.openKeybinds(); return; }
          if (it.id === 'keyreset') { K.reset(); this.openOptions('键位已恢复为 original/config.txt 的默认值。'); return; }
          if (it.id === 'shiftEsc') { K.shiftAsEsc = !K.shiftAsEsc; this.openOptions(); return; }
          if (it.id === 'volume') {
            const v = ((o.volume | 0) + 10) % 110;
            Opt.set('volume', v);
            if (Elona.Audio) Elona.Audio.setVolume(v / 100);
            this.openOptions();
            return;
          }
          if (Opt) { Opt.toggle(it.id); this.openOptions(); }
        },
      });
    },

    /**
     * 0-DG：ペットとの再会 / 隠れていたもの（事件 12 / 38，608095-608200）。
     *   kind = 'pet'：犬(165) 猫(164) クマ(108) 少女(166)
     *   kind = 'family'：妹(436) お嬢様(485) 姉(493) 少女(494) 少年(963) 弟(921) 執事(965) 兄(922)
     *   加入时等级 = limit(玩家等级 × 2/3 + 1, 1, 50)（608153 / 608195）。
     */
    openPetReunion(g, kind) {
      const P = Elona.Party;
      const p = g.player;
      const lv = Math.max(1, Math.min(50, Math.floor((p.level | 0) * 2 / 3) + 1));
      const PETS = [
        { id: 165, label: '犬だ！' }, { id: 164, label: '猫だ！' },
        { id: 108, label: 'クマだ！' }, { id: 166, label: '少女だ！' },
      ];
      const FAMILY = [
        { id: 436, label: '妹だ！' }, { id: 485, label: 'お嬢様だ！' },
        { id: 493, label: '姉だ！' }, { id: 494, label: '少女だ！' },
        { id: 963, label: '少年だ！' }, { id: 921, label: '弟だ！' },
        { id: 965, label: '執事だ！' }, { id: 922, label: '兄だ！' },
      ];
      const list = (kind === 'family') ? FAMILY : PETS;
      const title = (kind === 'family') ? '隠れていたもの' : 'ペットとの再会';
      const intro = (kind === 'family')
        ? '你察觉到背后的气息，停下了脚步。回头看到的是……'
        : '你听见熟悉的叫声，停下脚步。船难时失散的宠物正高兴地跑过来！你的宠物是……';
      const html = '<div class="pui-note">' + esc(intro) + '</div>'
        + list.map((it, i) => `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-key">${'abcdefgh'[i]}</span>`
          + `<span class="pui-name">${esc(it.label)}</span>`
          + `<span class="pui-dim">Lv${lv}</span></div>`).join('');
      this.rows = list;
      this.open('reunion', title, html, { hint: 'a~d 选择　Esc 关闭' });
      const pick = (i) => {
        const it = list[i];
        if (!it) return;
        this.close();
        if (!P) return;
        const r = P.addPet(g, it.id, lv);
        if (Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage(r.message);
        if (g.endTurn) g.endTurn();
      };
      this.onPick = (row) => pick(list.indexOf(row));
      this.onKeyFn = (e) => {
        const i = 'abcdefgh'.indexOf(e.key);
        if (i >= 0) { pick(i); return true; }
        return false;
      };
    },

    // ======================================================================
    // 0-DG：同伴 —— 战术指示 / 同伴选择
    // ======================================================================

    /**
     * 战术指示（战斗模式）—— 源码 11818-11860 的 txtsettactical + 340627-340674。
     *   @param {object} [target] 指定单个同伴；省略则对视野内全体同伴生效
     */
    openTactical(g, target) {
      const C = Elona.Companion;
      if (!C) return;
      const cur = target ? C.modeOf(target) : null;
      const rows = C.MODE_NAMES.map((m, i) => ({ ...m, i }));
      const html = '<div class="ci-sec">◆ 戦術指示'
        + (target ? `（${esc(target.name)}）` : '（全体同伴）') + '</div>'
        + rows.map((m, i) => `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-key">${'abcd'[i]}</span>`
          + `<span class="pui-name">${esc(m.jp)}${cur === m.id ? '　← 现在' : ''}</span>`
          + `<span class="pui-dim">${esc(m.en)}</span></div>`).join('')
        + '<div class="pui-note">突撃＝主动追击／防御＝伤害 1/3、不主动进攻／'
        + '迎撃＝留在玩家附近／交渉＝不攻击，改用交涉能力削减 SP。</div>';
      this.rows = rows;
      this.open('tactical', '戦術指示', html, { hint: 'a~d 选择　Esc 关闭' });
      const apply = (i) => {
        const m = rows[i] ? rows[i].id : 0;
        const r = target ? C.setMode(g, target, m) : C.setModeAll(g, m, { x: g.player.x, y: g.player.y, r: 6 });
        if (Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage(r.message || '');
        this.close();
      };
      this.onPick = (row) => apply(row.i);
      this.onKeyFn = (e) => {
        const i = 'abcd'.indexOf(e.key);
        if (i >= 0) { apply(i); return true; }
        return false;
      };
    },

    /**
     * 0-DH：evochat —— 与同伴的互动窗口（415000-415035 菜单 / 418417-418631 结算）。
     *
     * 三个子页对应源码的 var_1294：
     *   'main'      var_1294 == 1  優しくする / 困らせる / 10万gold / 心の開錠 / 暴走する
     *   'pet'       var_1294 == 2  抱きつく / なでなで / キス / 色々する / 我に返る
     *   'intimate'  var_1294 == 3  優しく / 激しく / 小休憩（只做体力消耗，描写从略）
     *   'unlock'    var_1294 == -1 心の開錠の路線（119..130）
     *
     * 顶部按原版用红心显示「行動力」与「幸福度」（426611-426637）。
     */
    openEvochat(g, ally, sub) {
      const C = Elona.Companion;
      if (!C || !ally) return;
      const mode = sub || 'main';
      const hearts = (n, max) => '♥'.repeat(Math.max(0, n | 0))
        + '♡'.repeat(Math.max(0, (max | 0) - (n | 0)));
      const ap = C.actionPoints(g);
      const hap = C.happiness(ally);
      let items, title, hint, note;

      if (mode === 'pet') {
        items = C.petOptions().map((o, i) => ({ ...o, key: 'abcdefgh'[i] }));
        title = `じゃれあう — ${ally.name}`;
        hint = 'a~e 选择　Esc 关闭';
        note = '抱きつく・なでなで・キス・色々する 只改表情、不消耗行动力；'
          + '「我に返る」消耗 4 点行动力，换取 8 点幸福度。';
      } else if (mode === 'intimate') {
        items = [
          { id: 'gentle', act: 102, key: 'a', label: '優しく（体力 3-7）' },
          { id: 'hard', act: 103, key: 'b', label: '激しく（体力 5-14）' },
          { id: 'rest', act: 104, key: 'c', label: '小休憩' },
          { id: 'back', act: 131, key: 'd', label: '戻る' },
        ];
        title = `二人の時間 — ${ally.name}`;
        hint = 'a~d 选择　Esc 关闭';
        note = '（本项目的这一节只保留源码的体力消耗与时间经过，描写从略。）';
      } else if (mode === 'unlock') {
        const rates = C.unlockRates(g, ally);
        const cb = (n) => (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(ally, n) : 0;
        const list = C.ROUTES.filter((r) => {
          if (r.act === 129) return !cb(1038);
          if (r.act === 130) return !cb(1039);
          return true;
        });
        items = list.map((r, i) => ({
          act: r.act, key: 'abcdefghijkl'[i],
          label: `[開錠${rates[r.rate] | 0}%] ${r.line}`,
          rel: r.rel, jp: r.jp,
        }));
        items.push({ id: 'back', act: 131, key: 'abcdefghijkl'[items.length], label: '戻る' });
        title = `心の開錠 — ${ally.name}`;
        hint = 'a~m 选择　Esc 关闭';
        note = `成功率由两人的「鍵開け」（你 ${C.lockPicking(g.player)} / ${ally.name} ${C.lockPicking(ally)}）`
          + `与好感 ${ally.get(17) | 0}、主从 ${ally.get(169) | 0} 决定。失败也会消耗 1 点行动力。`;
      } else {
        items = C.chatOptions(g, ally).map((o, i) => ({ ...o, key: 'abcdefgh'[i] }));
        title = `evochat — ${ally.name}`;
        hint = 'a~h 选择　Esc 关闭';
        note = C.canChat(g, ally)
          ? '每一次搭话消耗 1 点行动力（睡一觉回满 10 点）。对方幸福度满 10 时无法继续。'
          : '现在没法互动：行动力为 0，或对方已经很满足了（睡一觉可恢复行动力）。';
      }

      const head = '<div class="ci-sec">◆ ' + esc(ally.name) + '</div>'
        + '<div class="pui-kv"><span>行動力</span><b class="dh-hearts">' + hearts(ap, C.AP_MAX) + ` ${ap}/${C.AP_MAX}</b></div>`
        + '<div class="pui-kv"><span>幸福度</span><b class="dh-hearts">' + hearts(hap, C.HAPPY_MAX) + ` ${hap}/${C.HAPPY_MAX}</b></div>`
        + (ally.get(C.ROUTE) | 0
          ? `<div class="pui-kv"><span>関係</span><b>${esc(C.ROUTES.find((r) => r.rel === (ally.get(C.ROUTE) | 0)) ? C.ROUTES.find((r) => r.rel === (ally.get(C.ROUTE) | 0)).jp : '—')}</b></div>`
          : '');

      const html = head
        + items.map((o, i) => `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-key">${esc(o.key || '')}</span>`
          + `<span class="pui-name">${esc(o.label)}</span>`
          + (o.jp ? `<span class="pui-dim">${esc(o.jp)}</span>` : '') + '</div>').join('')
        + `<div class="pui-note">${esc(note)}</div>`;

      this.rows = items;
      this.open('evochat', title, html, { hint });
      const pick = (i) => {
        const it = items[i];
        if (!it) return;
        if (it.id === 'end') { this.close(); return; }
        if (it.id === 'back') {
          if (mode === 'unlock') this.openEvochat(g, ally, 'main');
          else this.openEvochat(g, ally, 'main');
          return;
        }
        const r = C.chat(g, ally, it.act);
        if (r.message && Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage(r.message);
        if (r.sub) { this.openEvochat(g, ally, r.sub); return; }
        this.openEvochat(g, ally, 'main');
        if (Elona.UI && Elona.UI.refresh) Elona.UI.refresh();
      };
      this.onPick = (row) => pick(items.indexOf(row));
      this.onKeyFn = (e) => {
        const ch = (e.key || '').toLowerCase();
        const i = items.findIndex((x) => x.key === ch);
        if (i >= 0) { pick(i); return true; }
        return false;
      };
    },

    /**
     * 0-DH：窃盗の対象選び（源码 `var_486 = 27`，299168 → *label_3026 311077）。
     *   列出脚下所有「有主物品」；选中哪件就偷哪件。难度用 stealPower 与重量提示。
     */
    openStealSelect(g) {
      const p = g.player;
      const list = g.stealTargets(p).slice(0, 16);
      if (!list.length) {
        this.pushMessage('脚下没有可偷的有主物品。');
        return;
      }
      const rows = list.map((it, i) => {
        const pw = g.stealPower ? (g.stealPower(p, it) | 0) : 0;
        const w = (it.f[7] | 0);
        return {
          it, key: 'abcdefghijklmnop'[i],
          label: Elona.ItemDB.name(it.id, 'en'),
          sub: `重量 ${w}　窃盗力 ${pw}`,
        };
      });
      const html = '<div class="ci-sec">◆ 何を盗む？</div>'
        + rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-key">${r.key}</span>`
          + `<span class="pui-name">${esc(r.label)}</span>`
          + `<span class="pui-dim">${esc(r.sub)}</span></div>`).join('')
        + '<div class="pui-note">被人看见会掉 karma；夜间与高「窃盗」技能更容易得手。</div>';
      this.rows = rows;
      this.open('steal-select', '窃盗', html, { hint: 'a~p 选择　Esc 关闭' });
      const pick = (i) => {
        const r = rows[i];
        if (!r) return;
        this.close();
        const res = g.startSteal(p, r.it);
        if (res && res.message) this.pushMessage(res.message);
        if (res && res.ok && g.endTurn) g.endTurn();
      };
      this.onPick = (row) => pick(rows.indexOf(row));
      this.onKeyFn = (e) => {
        const i = 'abcdefghijklmnop'.indexOf((e.key || '').toLowerCase());
        if (i >= 0 && i < rows.length) { pick(i); return true; }
        return false;
      };
    },

    /**
     * 0-DH / 0-DO：調教鞭（746，effect 52）—— 源码 `txtsettamer`（10900-10960）的 18 项菜单。
     *   355538-355946 是完整的处理体，本面板按 var_444 的取值逐项对应：
     *     0 拾い食いの禁止/解除（cbit 1033）
     *     1 アイテム拾いの禁止/解除（cbit 1032）
     *     2 喋り方を変える（`var_58(18)` 计数、`var_58(188)` 在 1/2 之间切换，355746-355768）
     *     3 特に理由はないが鞭で打つ（気質 -1，355822-355828）
     *     4 逆に鞭で打ってもらう（気質 +1，地上有鞭子 864 时再 +1，上限 10）
     *     5..16 別行動時の行動指定（`var_58(202) = var_444 - 4`，355640；需調教技能 169 ≥ 150）
     *     17 キャンセル
     *   ※ 5..16 只写字段：本项目还没有「同伴离家时的行为」AI，已登记在差异表。
     */
    openTamerWhip(g, ally) {
      const C = Elona.Companion;
      if (!C || !ally) return;
      const CB = (n) => (Elona.Status && Elona.Status.cbit ? Elona.Status.cbit(ally, n) : 0);
      const ORDER = 202;                       // var_58(202)：別行動時の行動
      const ORDERS = [
        { v: 1, label: '远距离散步' }, { v: 2, label: '近距离散步' },
        { v: 3, label: '直立不动待机' }, { v: 4, label: '照样随行' },
        { v: 5, label: '优先本职' }, { v: 6, label: '兴起时路上演奏' },
        { v: 7, label: '偶尔布教' }, { v: 8, label: '有时跳舞' },
        { v: 9, label: '有空就除蜗牛' }, { v: 10, label: '挑客卖春' },
        { v: 11, label: '禁止在街上训练' }, { v: 12, label: '在那一带乞讨' },
      ];
      const tone = () => ((ally.get(188) | 0) === 2 ? '粗暴' : '普通');
      const build = () => {
        const cur = ally.get(ORDER) | 0;
        const list = [
          { id: 'eat', label: `拾い食い：${CB(1033) ? '禁止中' : '允许'}（切换）` },
          { id: 'pick', label: `アイテム拾い：${CB(1032) ? '禁止中' : '允许'}（切换）` },
          { id: 'tone', label: `说话方式：${tone()}（切换）` },
          { id: 'whip', label: '用鞭子抽一下（気質 -1）' },
          { id: 'handover', label: '把鞭子交给对方（気質 +1）' },
        ];
        for (const o of ORDERS) {
          list.push({ id: 'order' + o.v, v: o.v,
            label: `别行动时：${o.label}${cur === o.v ? '（当前）' : ''}` });
        }
        list.push({ id: 'end', label: '结束' });
        return list;
      };
      const render = () => {
        const items = build();
        const temper = ally.get(C.TEMPER) | 0;
        const html = '<div class="ci-sec">◆ ' + esc(ally.name) + ' 的管教</div>'
          + `<div class="pui-kv"><span>気質</span><b>${temper}</b></div>`
          + `<div class="pui-kv"><span>幸福度</span><b>${C.happiness(ally)} / ${C.HAPPY_MAX}</b></div>`
          + items.map((o, i) => `<div class="pui-row" data-i="${i}">`
            + `<span class="pui-name">${esc(o.label)}</span></div>`).join('')
          + '<div class="pui-note">禁止拾い食い后，同伴不会吃掉地上的食物；'
          + '禁止アイテム拾い后，同伴不再捡起地上的无主物品。</div>';
        this.rows = items;
        this.open('tamer', `${ally.name} — 調教鞭`, html,
          { hint: '↑↓ 选择　Enter 确定　Esc 关闭' });
        const doIt = (i) => {
          const it = items[i];
          if (!it) return;
          if (it.id === 'end') { this.close(); return; }
          if (it.id === 'eat') {
            Elona.Status.cbitmod(ally, 1033, CB(1033) ? 0 : 1);
            this.pushMessage(`拾い食いを${CB(1033) ? '禁止' : '許可'}した。`);
            render();
            return;
          }
          if (it.id === 'pick') {
            Elona.Status.cbitmod(ally, 1032, CB(1032) ? 0 : 1);
            this.pushMessage(`アイテム拾いを${CB(1032) ? '禁止' : '許可'}した。`);
            render();
            return;
          }
          if (it.id === 'tone') {                       // 355746-355768
            let n = (ally.get(18) | 0) + 1;
            if (n >= 7) {
              n = 0;
              ally.set(188, (ally.get(188) | 0) === 1 ? 2 : 1);
            }
            ally.set(18, n);
            this.pushMessage(`说话方式变成了「${tone()}」。`);
            render();
            return;
          }
          if (it.id === 'whip') {
            // 355822-355828：気質 -1（0 时变 -1，下限 -10）
            let t = (ally.get(C.TEMPER) | 0) - 1;
            if (t === 0) t = -1;
            if (t < -10) t = -10;
            ally.set(C.TEMPER, t);
            this.pushMessage('你挥下了鞭子。');
            render();
            return;
          }
          if (it.id === 'handover') {                   // 355649-355690
            let t = (ally.get(C.TEMPER) | 0) + 1;
            const hasWhip = (g.groundItems || []).some((x) => x && (x.id | 0) === 864
              && (x.f[0] | 0) > 0 && (x.f[5] | 0) === (ally.x | 0) && (x.f[6] | 0) === (ally.y | 0));
            if (hasWhip) t += 1;
            if (t > 10) t = 10;
            ally.set(C.TEMPER, t);
            this.pushMessage('你把鞭子交给了对方。');
            render();
            return;
          }
          if (it.id.indexOf('order') === 0) {           // 355631-355648
            if ((ally.skill(169) | 0) < 150) {
              this.pushMessage('需要更高的調教等级……');
              return;
            }
            ally.set(ORDER, it.v | 0);
            this.pushMessage(`指示：${ORDERS.find((o) => o.v === it.v).label}。`);
            render();
          }
        };
        this.onPick = (row) => doIt(items.indexOf(row));
      };
      render();
    },

    /**
     * 0-DH：一緒に食事の食材選び（源码 `var_486 = 23, 17` 的食物选择窗）。
     *   只列背包里的食物（`refitem(id,5) == 57000`），选中后两人分食一份。
     */
    openMealSelect(g, ally) {
      const inv = (g.player.inv || []).filter((it) => it && (it.f[0] | 0) > 0
        && Elona.ItemDB && Elona.ItemDB.ref(it.id, 5) === 57000);
      if (!inv.length) {
        if (Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage('背包里没有食物。');
        return;
      }
      const rows = inv.slice(0, 16);
      const html = '<div class="ci-sec">◆ 和 ' + esc(ally.name) + ' 一起吃什么？</div>'
        + rows.map((it, i) => `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-key">${'abcdefghijklmnop'[i]}</span>`
          + `<span class="pui-name">${esc(Elona.ItemDB.name(it.id, 'en'))}</span>`
          + `<span class="pui-dim">x${it.f[0] | 0}</span></div>`).join('')
        + '<div class="pui-note">两人分食一份：满腹度增加量减半，食物技能经验合计 200%。</div>';
      this.rows = rows;
      this.open('meal-select', '一緒に食事', html, { hint: 'a~p 选择　Esc 关闭' });
      const pick = (i) => {
        const it = rows[i];
        if (!it) return;
        this.close();
        const r = g.startShareMeal(g, ally, it);
        if (!r.ok && Elona.UI && Elona.UI.pushMessage) {
          Elona.UI.pushMessage(r.message || '吃不下。');
        }
      };
      this.onPick = (row) => pick(rows.indexOf(row));
      this.onKeyFn = (e) => {
        const i = 'abcdefghijklmnop'.indexOf((e.key || '').toLowerCase());
        if (i >= 0 && i < rows.length) { pick(i); return true; }
        return false;
      };
    },

    /**
     * 0-EN：进化道具对「正在骑乘的同伴」使用 → 骑乘者 / 坐骑 二选一。
     *   源码 360681-360703：
     *     `if ( var_58(168, var_244) != 0 )`（168 = 坐骑槽号）
     *     `txtselecttc 2` 列两行 → `if ( var_444 == 1 ) var_244 = var_58(167, var_244)`
     *   即第 2 项选「坐骑」（167 是骑乘者持有的坐骑槽号）；`stat == 0` 时整次使用中止。
     */
    openEvolveRiding(g, idx, rider, mount) {
      if (!rider) return;
      const rows = [{ id: 'rider', label: rider.name, c: rider }];
      if (mount) rows.push({ id: 'mount', label: mount.name, c: mount });
      const html = '<div class="ci-sec">◆ 要进化哪一个？</div>'
        + rows.map((r, i) => `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-key">${'ab'[i]}</span>`
          + `<span class="pui-name">${esc(r.label)}</span>`
          + `<span class="pui-dim">${r.id === 'rider' ? '骑乘者' : '坐骑'}</span></div>`).join('');
      this.rows = rows;
      this.open('evolve-pick', '进化', html, { hint: 'a/b 选择　Esc 关闭' });
      const pick = (i) => {
        const r = rows[i];
        this.close();
        if (!r) return;
        // idxOrItem 既可能是背包下标，也可能是脚下物品实例（t 窗口的地面列表）
        const res = (typeof idx === 'number' && idx >= 0)
          ? g.useItem(idx, 0, { target: r.c })
          : g.useGroundItem(idx, { target: r.c });
        const say = (t) => { if (t && Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage(t); };
        if (res && res.message) say(res.message);
        for (const m of ((res && res.messages) || [])) say(m);
      };
      this.onPick = (row) => pick(rows.indexOf(row));
      this.onKeyFn = (e) => {
        const i = 'ab'.indexOf(e.key);
        if (i >= 0) { pick(i); return true; }
        return false;
      };
    },

    /**
     * 同伴列表（待機 / 呼び出し / 复活 / 队伍编成共用）—— 源码 284100-284160 的
     * 「誰を呼び戻す？」窗口。
     * @param {object[]} list 可选同伴
     * @param {function} onPick 收到 (chara) 回调
     */
    /**
     * @param {Function} [extra] 每行右侧的附加列（284443 的「獲得部位/技能」列）
     */
    openAllySelect(g, title, list, onPick, hint, extra) {
      const C = Elona.Companion;
      const stateOf = (c) => {
        const st = c.get(0) | 0;
        if (st === 1) return '在场';
        if (st === 6) return '死亡';
        if (st === 7) return '待命中';
        return '—';
      };
      const html = '<div class="ci-sec">◆ ' + esc(title) + '</div>'
        + list.map((c, i) => {
          const tail = extra ? String(extra(c) || '') : '';
          return `<div class="pui-row" data-i="${i}">`
            + `<span class="pui-key">${'abcdefghijklmnop'[i] || ''}</span>`
            + `<span class="pui-name">${esc(c.name)}</span>`
            + `<span class="pui-dim">Lv${c.get(38) | 0}　${stateOf(c)}`
            + (C ? `　亲和 ${c.get(17) | 0}／服从 ${c.get(169) | 0}` : '')
            + (tail ? `　<b>${esc(tail)}</b>` : '') + '</span></div>';
        }).join('');
      this.rows = list;
      this.open('ally-select', title, html, { hint: hint || 'a~p 选择　Esc 关闭' });
      const pick = (i) => {
        const c = list[i];
        if (!c) return;
        this.close();
        if (onPick) onPick(c);
      };
      this.onPick = (row) => pick(list.indexOf(row));
      this.onKeyFn = (e) => {
        const i = 'abcdefghijklmnop'.indexOf(e.key);
        if (i >= 0) { pick(i); return true; }
        return false;
      };
    },

    /**
     * 能力複合機（684，效果 32，364518-364670）：基因合成。
     *   原版流程：素体 → 供体 → y/n 确认 → 移植部位/技能/等级 → 供体消失 → 素体的人物卡。
     * @param {object} g
     * @param {object} it 能力複合機（工具，不消耗）
     */
    openGeneMachine(g, it) {
      const GM = Elona.GeneMachine;
      const C = Elona.Companion;
      if (!GM || !C) return;
      // 284033-284040：var_1790==5 只列 var_58(0)==1（在场）的同伴
      const all = C.allies(g).filter((c) => c && (c.index | 0) !== 0 && (c.get(0) | 0) === 1);
      if (all.length < 2) {
        if (Elona.UI) Elona.UI.pushMessage('至少需要两名在场的同伴才能进行基因合成。');
        return;
      }
      const skName = (id) => {
        const s = (Elona.NPC && Elona.NPC.skillName) ? Elona.NPC.skillName(id) : '';
        return (s && !/^skill \d+$/.test(s)) ? s : String(id);
      };
      if (Elona.UI) Elona.UI.pushMessage('首先是素体……要选择作为素体的同伴。');
      this.openAllySelect(g, '选择作为素体的同伴', all, (recip) => {
        const rest = all.filter((c) => c !== recip);
        if (Elona.UI) Elona.UI.pushMessage('接着是被提取基因的同伴。这个同伴在合成后会永久消失。');
        // 284271-284280 / 284440-284465：供体列表右侧显示「獲得部位/技能」预览
        const previewOf = (donor) => {
          const pv = GM.preview(g, recip, donor);
          const sk = pv.skills.length ? pv.skills.map(skName).join('、') : '无';
          return `${pv.part ? GM.PART_NAME[pv.part] : '无'}／${sk}`;
        };
        this.openAllySelect(g, `要把谁的基因合成给${recip.name}？`, rest, (donor) => {
          const pre = GM.check(g, recip, donor);
          if (!pre.ok) {
            if (Elona.UI) Elona.UI.pushMessage(pre.message);
            return;
          }
          const pv = GM.preview(g, recip, donor);
          const note = `部位：${pv.part ? GM.PART_NAME[pv.part] : '无'}　`
            + `技能：${pv.skills.length ? pv.skills.map(skName).join('、') : '无'}`;
          this.openConfirm(
            `真的要把${donor.name}（Lv${donor.get(38) | 0}）的能力合成给${recip.name}（Lv${recip.get(38) | 0}）吗？`
            + `\n${note}\n※ ${donor.name} 会永久消失，背包里的物品也会丢失。`,
            (yes) => {
              if (!yes) return;
              const r = GM.synthesize(g, recip, donor, { part: pv.part, skills: pv.skills });
              for (const m of r.messages) {
                if (Elona.UI) Elona.UI.pushMessage(m);
              }
              if (r.ok) {
                if (g.endTurn) g.endTurn();
                // 364660：合成后显示素体的人物卡（*label_2784）
                this.openCharaInfo(g, recip);
              }
            },
            { title: '基因合成' },
          );
        }, 'a~p 选择　Esc 关闭', previewOf);
      }, 'a~p 选择　Esc 关闭');
      void it;
    },

    /** 0-DG：同伴的互动菜单（i 干涉的入口之一） */
    openCompanionMenu(g, c) {
      const C = Elona.Companion;
      if (!C || !c) return;
      const st = c.get(0) | 0;
      const items = [];
      if (st === 1) items.push({ id: 'wait', label: '在这里待命' });
      if (st === 7) items.push({ id: 'call', label: '叫回身边' });
      if (st === 1) items.push({ id: 'tactical', label: '战术指示（战斗模式）' });
      // 0-DH：タッグ（组合）—— 编成（194040）/ 解散（194057）
      if (C.tagPartner(c)) {
        const pt = g.charas[C.tagPartner(c)];
        items.push({ id: 'tag-end', label: `解散搭档（与 ${pt ? pt.name : '?'}）` });
      } else if (st === 1) {
        items.push({ id: 'tag-begin', label: '收某人做搭档（自己掌握移动）' });
      }
      items.push({ id: 'info', label: '查看状态' });
      // 289885-289949（var_400 == 37）：大事な仲間 —— 基因合成 / 出售 / 解雇都会跳过
      const isPrecious = !!(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 1053) === 1);
      items.push({
        id: 'precious',
        label: isPrecious ? '解除「重要的同伴」' : '指定为「重要的同伴」',
      });
      const html = '<div class="ci-sec">◆ ' + esc(c.name) + '</div>'
        + `<div class="pui-kv"><span>等级</span><b>${c.get(38) | 0}</b></div>`
        + `<div class="pui-kv"><span>状态</span><b>${st === 1 ? '在场' : (st === 6 ? '死亡' : (st === 7 ? '待命' : '—'))}</b></div>`
        + `<div class="pui-kv"><span>亲和</span><b>${c.get(17) | 0}（${(Elona.Relation && Elona.Relation.romanceStage) ? Elona.Relation.romanceStage(c.get(17) | 0).jp : ''}）</b></div>`
        + `<div class="pui-kv"><span>服从</span><b>${c.get(169) | 0}</b></div>`
        + `<div class="pui-kv"><span>幸福度</span><b>${C.happiness(c)} / ${C.HAPPY_MAX}</b></div>`
        + `<div class="pui-kv"><span>戰鬥模式</span><b>${C.modeName(C.modeOf(c))}</b></div>`
        + `<div class="pui-kv"><span>搭档</span><b>${(() => {
          const pi = C.tagPartner(c);
          const pt = pi ? g.charas[pi] : null;
          if (!pt) return '—';
          const role = (c.get(C.TAG_ROLE) | 0) === 1 ? '追随' : 'ベース';
          return `${pt.name}（${role}）`;
        })()}</b></div>`
        + items.map((it, i) => `<div class="pui-row" data-i="${i}"><span class="pui-key">${'abcdefgh'[i]}</span>`
          + `<span class="pui-name">${esc(it.label)}</span></div>`).join('');
      this.rows = items;
      this.open('companion', c.name, html, { hint: 'a~f 选择　Esc 关闭' });
      const pick = (i) => {
        const it = items[i];
        if (!it) return;
        if (it.id === 'wait') { this.close(); C.wait(g, c); return; }
        if (it.id === 'call') { this.close(); C.call(g, c); return; }
        if (it.id === 'tactical') { this.openTactical(g, c); return; }
        if (it.id === 'tag-end') {
          const r = C.tagEnd(g, c);
          if (Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage(r.message);
          this.close();
          return;
        }
        if (it.id === 'tag-begin') {
          const cand = C.tagCandidates(g, c);
          if (!cand.length) {
            if (Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage('没有可以收为搭档的同伴。');
            return;
          }
          this.openAllySelect(g, `和${c.name}组成搭档的是？`, cand, (t) => {
            const r = C.tagBegin(g, c, t);
            if (Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage(r.message);
          }, 'a~p 选择　Esc 关闭');
          return;
        }
        if (it.id === 'precious') {
          // 289885-289949：置位/清位 cbit(1053)，按亲和度给一句反应
          const S = Elona.Status;
          const aff = c.get(17) | 0;
          const on = !(S && S.cbit && S.cbit(c, 1053) === 1);
          if (S && S.cbitmod) S.cbitmod(c, 1053, on);
          if (Elona.UI && Elona.UI.pushMessage) {
            if (on) {
              Elona.UI.pushMessage(aff >= 150 ? `${c.name}理所当然地挺起了胸膛。`
                : aff >= 100 ? `${c.name}有点不好意思。`
                  : aff >= 0 ? `${c.name}有点吃惊。` : `${c.name}嫌恶地咂了咂嘴。`);
            } else {
              Elona.UI.pushMessage(aff >= 150 ? `${c.name}有点绝望……。`
                : aff >= 100 ? `${c.name}在想着什么……。`
                  : aff >= 0 ? `${c.name}在害怕……。` : `${c.name}朝地上吐了口唾沫。`);
            }
          }
          this.close();
          return;
        }
        this.close();
      };
      this.onPick = (row) => pick(items.indexOf(row));
      this.onKeyFn = (e) => {
        const i = 'abcdefgh'.indexOf(e.key);
        if (i >= 0) { pick(i); return true; }
        return false;
      };
    },

    /**
     * 0-FO：家畜干涉菜单（289600-289616 / 415317-415328）。
     * 原版在按 i 选到 cbit 960 的家畜时把「带出来 / 挖残骸」等塞进同一张菜单，
     * 这里单独成窗，并把梳理、榨奶、喂食也一起放进来。
     */
    openLivestockMenu(g, c) {
      const R = Elona.Ranch;
      if (!R || !c) return;
      const items = [
        { id: 'brush', label: '梳理（爱抚之手 701 + 大型ブラシ）' },
        { id: 'milk', label: '榨奶（紧抱 710）' },
        { id: 'feed', label: '喂家畜饲料（1071）' },
        { id: 'milkfeed', label: '喂奶（574，提升成长度）' },
      ].concat(R.interactMenu(g, c));
      const gene = R.geneText(c);
      const S = (n) => c.get(n) | 0;
      const findInv = (id) => (g.player && Array.isArray(g.player.inv))
        ? g.player.inv.find((x) => x && (x.f[0] | 0) > 0 && (x.f[3] | 0) === id) : null;
      const html = '<div class="ci-sec">◆ ' + esc(c.name || '家畜') + '</div>'
        + `<div class="pui-kv"><span>家畜特性</span><b>${esc(gene.texts.length ? gene.texts.join('；') : '无')}</b></div>`
        + `<div class="pui-kv"><span>皮肉 / 蛋奶</span><b>${gene.a} / ${gene.b}</b></div>`
        + `<div class="pui-kv"><span>梳理计数</span><b>${S(177)} / 5</b></div>`
        + `<div class="pui-kv"><span>成长度</span><b>${S(59)}</b></div>`
        + `<div class="pui-kv"><span>満腹度 / 体重</span><b>${S(22)} / ${S(20)}kg</b></div>`
        + `<div class="pui-kv"><span>生病计数</span><b>${S(261)}</b></div>`
        + items.map((it, i) => `<div class="pui-row" data-i="${i}"><span class="pui-key">${'abcdefghijklmnop'[i] || '·'}</span>`
          + `<span class="pui-name">${esc(it.label)}</span></div>`).join('');
      this.rows = items;
      this.open('livestock', c.name || '家畜', html, { hint: 'a~p 选择　Esc 关闭' });
      const show = (r) => {
        if (r && r.message && Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage(r.message);
        else if (r && r.reason && Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage(`没能完成：${r.reason}`);
      };
      const pick = (i) => {
        const it = items[i];
        if (!it) return;
        let r = null;
        if (it.id === 'brush') r = R.brush(g, g.player, c);
        else if (it.id === 'milk') r = R.milk(g, g.player, c);
        else if (it.id === 'feed') r = R.giveItem(g, c, findInv(1071));
        else if (it.id === 'milkfeed') r = R.giveItem(g, c, findInv(574));
        else r = R.runInteract(g, c, it.id);
        show(r);
        this.close();
      };
      this.onPick = (row) => pick(items.indexOf(row));
      this.onKeyFn = (e) => {
        const i = 'abcdefghijklmnop'.indexOf(e.key);
        if (i >= 0 && i < items.length) { pick(i); return true; }
        return false;
      };
    },

    /**
     * 0-FP：自营店收款机（233240-233265 / 234459-234665）。
     * 由店铺里的レジスター 562 触发；菜单选择用「下一档」循环代替原版的方向键选单。
     */
    openShopRegister(g, siteId) {
      const M = Elona.ShopManage;
      if (!M) return;
      const cur = (Elona.Property && Elona.Property.currentSite)
        ? Elona.Property.currentSite(g) : null;
      const id = (siteId | 0) || (cur ? (cur.id | 0) : 0);
      const say = (m) => { if (m && Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage(m); };
      if (!id) { say('这里不是自家店铺。'); return; }
      const st = M.status(g, id);
      if (!st.ok) { say('这里不是自家店铺。'); return; }
      const items = [
        { id: 'type', label: `更改店类型（当前 ${st.genreName} → 下一种）` },
        { id: 'train', label: `训练店番（青铜币 ${st.trainingCost >= 1000000 ? '不可训练' : st.trainingCost + ' 枚'}）` },
        { id: 'feat', label: `获取营业天赋（${st.feats}/2，业绩 ${st.sales}，门槛 ${st.featGate === null ? '已满' : st.featGate}）` },
        { id: 'limit', label: `日销售限制（${st.salesLimitName} → 下一档）` },
        { id: 'samples', label: '标记样本柜台（tile 37 → 非卖品）' },
        { id: 'clear', label: '去除全部营业天赋（傀儡巫女）' },
        { id: 'money', label: '刷新店主持金（generatemoney）' },
      ];
      const html = '<div class="ci-sec">◆ 收款机 / ' + esc(st.worker || '没有店番') + '</div>'
        + `<div class="pui-kv"><span>经营种类</span><b>${esc(st.genreName)}</b></div>`
        + `<div class="pui-kv"><span>类型可更改</span><b>${st.changeReady ? '现在' : ('绝对小时 ' + st.changeUntil)}</b></div>`
        + `<div class="pui-kv"><span>营业实绩 / 天赋</span><b>${st.sales} / ${st.feats}</b></div>`
        + `<div class="pui-kv"><span>已获天赋</span><b>${esc(st.ownedFeats.length ? st.ownedFeats.join('；') : '无')}</b></div>`
        + `<div class="pui-kv"><span>雅卡点数</span><b>${g.getV65 ? (g.getV65(661) | 0) : 0}</b></div>`
        + items.map((it, i) => `<div class="pui-row" data-i="${i}"><span class="pui-key">${'abcdefghijklmnop'[i] || '·'}</span>`
          + `<span class="pui-name">${esc(it.label)}</span></div>`).join('');
      this.rows = items;
      this.open('shop-register', '收款机', html, { hint: 'a~g 选择　Esc 关闭' });
      const pick = (i) => {
        const it = items[i];
        if (!it) return;
        const worker = Elona.ShopSale ? Elona.ShopSale.workerOf(g, id) : null;
        let r = null;
        if (it.id === 'type') r = M.changeType(g, id, (st.genre + 1) % M.GENRES.length);
        else if (it.id === 'train') r = M.train(g, id);
        else if (it.id === 'feat') {
          const S = Elona.Status;
          const next = worker && M.FEATS.find((f) => !(S && S.cbit && S.cbit(worker, f.cbit)));
          r = next ? M.grantFeat(g, id, next.value) : { ok: false, reason: 'no-feat-left' };
        } else if (it.id === 'limit') r = M.setSalesLimit(g, id, (st.salesLimit + 1) % M.SALES_LIMITS.length);
        else if (it.id === 'samples') r = M.markSamples(g);
        else if (it.id === 'clear') r = M.removeFeats(g, worker);
        else if (it.id === 'money') {
          let n = 0;
          if (Elona.Shop && Elona.Shop.generateMoney) {
            for (const c of (g.charas || [])) {
              if (c && (c.get(0) | 0) === 1 && Elona.Shop.isShopkeeper(c)) {
                Elona.Shop.generateMoney(g, c); n++;
              }
            }
          }
          r = { ok: true, message: `已检查 ${n} 位店主的持金。` };
        }
        say(r && (r.message || (r.ok ? '完成。' : ('没能完成：' + r.reason))));
        this.close();
      };
      this.onPick = (row) => pick(items.indexOf(row));
      this.onKeyFn = (e) => {
        const i = 'abcdefghijklmnop'.indexOf(e.key);
        if (i >= 0 && i < items.length) { pick(i); return true; }
        return false;
      };
    },

    /** 键位设置：列出所有动作，Enter 后按新键 */
    openKeybinds() {
      const K = Elona.Keys;
      this.rows = K.ACTIONS.filter((a) => a.keys || a.special !== 'move').map((a) => a);
      const html = '<div class="pui-note">选择一项后按任意键完成绑定；Esc 取消。</div>'
        + this.rows.map((a, i) => `<div class="pui-row" data-i="${i}">`
          + `<span class="pui-key">${esc((K.bindings[a.id] || []).map((k) => (k === ' ' ? 'Space' : k)).join(' / ') || '—')}</span>`
          + `<span class="pui-name">${esc(a.label)}</span>`
          + `<span class="pui-dim">${esc(a.origin || '')}</span></div>`).join('');
      this.open('keybind', '键位设置', html, {
        wide: true, hint: 'Enter 开始录入　Esc 返回',
        onPick: (a) => {
          this.keyCapture = a.id;
          const el = this.root.querySelector('#pui-hint');
          if (el) el.textContent = `请按下「${a.label}」的新按键…（Esc 取消）`;
        },
      });
    },
  };

  Elona.Panels = P;
})(window);
