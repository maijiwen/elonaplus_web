'use strict';
/**
 * 修改器弹窗（F4）
 *
 * 只实现「物品」页，其余八页先占位。物品页的字段不写死在 JS 里：
 * tools/gen_itemfields.py 把 Elona-YAS-CSVs/item.csv 转成
 * web/data/tables/itemfields.json（中文标签 + var_99 字段索引 + 校验范围），
 * 打开弹窗 / 切换页签时都重新从 game.player.inv 读值，避免显示旧存档。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const TABS = [
    { id: 'system', label: '系统参数' },
    { id: 'status', label: '状态' },
    { id: 'skill', label: '技能' },
    { id: 'item', label: '物品' },
    { id: 'spell', label: '魔法库存' },
    { id: 'ability', label: '特殊能力' },
    { id: 'feat', label: '天赋' },
    { id: 'material', label: '材料' },
    { id: 'quest', label: '委托' },
  ];

  const Modifier = {
    TABS,
    root: null,
    tabsEl: null,
    bodyEl: null,
    game: null,
    tab: 'item',
    fields: null,
    index: 1,
    _indexValid: true,
    _built: false,
    _loadPromise: null,
    _fieldInputs: [],

    init() {
      this.root = document.getElementById('modifier');
      this.tabsEl = document.getElementById('modifier-tabs');
      this.bodyEl = document.getElementById('modifier-body');
      if (!this.root || !this.tabsEl || !this.bodyEl) return;
      this._build();
      this._built = true;
    },

    isOpen() {
      return !!(this.root && !this.root.classList.contains('hidden'));
    },

    async open(game) {
      if (!this.root) return false;
      if (game) this.game = game;
      this.root.classList.remove('hidden');
      try {
        await this._ensureFields();
        if (this.isOpen()) this.switchTab(this.tab || 'item', true);
      } catch (e) {
        this._setStatus('字段表载入失败：' + (e && e.message ? e.message : String(e)), true);
      }
      return true;
    },

    close() {
      if (!this.root) return false;
      this.root.classList.add('hidden');
      return true;
    },

    toggle(game) {
      return this.isOpen() ? (this.close(), false) : this.open(game);
    },

    /** 页签切换：每次切回物品页都重新读当前游戏状态 */
    switchTab(tab, force) {
      const t = TABS.find((x) => x.id === tab);
      if (!t || !this._built) return false;
      this.tab = t.id;
      for (const b of this.tabsEl.querySelectorAll('button[data-tab]')) {
        const on = b.getAttribute('data-tab') === t.id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      for (const page of this.bodyEl.querySelectorAll('.mod-page')) {
        const on = page.getAttribute('data-page') === t.id;
        page.classList.toggle('hidden', !on);
      }
      if (t.id === 'item' && (force || this.fields)) this.refresh();
      return true;
    },

    /** 弹窗开着时只吃 Esc；其它键（尤其方向键）留给表单或 main.js 的模态拦截 */
    handleKey(e) {
      if (!this.isOpen()) return false;
      if (e.key === 'Escape' || e.key === 'Esc') {
        this.close();
        return true;
      }
      return false;
    },

    // ---------- 构建 DOM ----------
    _build() {
      this.tabsEl.innerHTML = '';
      for (const t of TABS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mod-tab';
        b.setAttribute('data-tab', t.id);
        b.textContent = t.label;
        this.tabsEl.appendChild(b);
      }
      this.tabsEl.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('button[data-tab]') : null;
        if (b) this.switchTab(b.getAttribute('data-tab'));
      });

      this.bodyEl.innerHTML = '';
      for (const t of TABS) {
        const page = document.createElement('section');
        page.className = 'mod-page hidden';
        page.setAttribute('data-page', t.id);
        if (t.id === 'item') {
          page.innerHTML = this._itemPageHtml();
        } else {
          page.innerHTML = '<div class="mod-placeholder">【' + t.label + '】页面尚未实现。</div>';
        }
        this.bodyEl.appendChild(page);
      }

      const itemPage = this.bodyEl.querySelector('[data-page="item"]');
      this.itemForm = itemPage.querySelector('#mod-item-form');
      this.indexInput = itemPage.querySelector('#mod-item-index');
      this.indexHint = itemPage.querySelector('#mod-item-index-hint');
      this.indexError = itemPage.querySelector('#mod-item-index-error');
      this.nameInput = itemPage.querySelector('#mod-item-name');
      this.fieldsEl = itemPage.querySelector('#mod-item-fields');
      this.statusEl = itemPage.querySelector('#mod-item-status');
      this.saveBtn = itemPage.querySelector('#mod-item-save');

      this.indexInput.addEventListener('input', () => this._onIndexInput());
      itemPage.querySelector('#mod-item-prev').addEventListener('click', () => this._stepIndex(-1));
      itemPage.querySelector('#mod-item-next').addEventListener('click', () => this._stepIndex(1));
      itemPage.querySelector('#mod-item-reset').addEventListener('click', () => this.refresh(true));
      this.itemForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this._saveItem();
      });
    },

    _itemPageHtml() {
      return [
        '<form id="mod-item-form" autocomplete="off">',
        '  <div class="mod-line">',
        '    <label for="mod-item-index">物品索引</label>',
        '    <button type="button" id="mod-item-prev" class="mod-arrow" aria-label="上一个物品">◀</button>',
        '    <input id="mod-item-index" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" value="1" />',
        '    <button type="button" id="mod-item-next" class="mod-arrow" aria-label="下一个物品">▶</button>',
        '    <span id="mod-item-index-hint" class="mod-hint"></span>',
        '  </div>',
        '  <div id="mod-item-index-error" class="mod-field-error"></div>',
        '  <div class="mod-line">',
        '    <label for="mod-item-name">物品名称</label>',
        '    <input id="mod-item-name" type="text" readonly class="mod-readonly" />',
        '  </div>',
        '  <div id="mod-item-fields" class="mod-fields"></div>',
        '  <div class="mod-actions">',
        '    <button type="submit" id="mod-item-save">保存</button>',
        '    <button type="button" id="mod-item-reset">还原</button>',
        '    <span id="mod-item-status" class="mod-status" role="status"></span>',
        '  </div>',
        '</form>',
      ].join('\n');
    },

    async _ensureFields() {
      if (this.fields && this.fields.length) return;
      if (!this._loadPromise) {
        this._loadPromise = (async () => {
          let data = Elona.Data && Elona.Data.tableSync
            ? Elona.Data.tableSync('itemfields') : null;
          if (!data && Elona.Data && Elona.Data.table) data = await Elona.Data.table('itemfields');
          if (!data || !Array.isArray(data.fields) || !data.fields.length) {
            throw new Error('itemfields.json 为空');
          }
          this.fields = data.fields;
          this._buildFields();
        })().catch((e) => { this._loadPromise = null; throw e; });
      }
      await this._loadPromise;
    },

    _buildFields() {
      this.fieldsEl.innerHTML = '';
      this._fieldInputs = [];
      for (const def of this.fields) {
        const wrap = document.createElement('div');
        wrap.className = 'mod-field';
        wrap.setAttribute('data-field-index', String(def.index));

        const line = document.createElement('div');
        line.className = 'mod-field-line';
        const label = document.createElement('label');
        label.textContent = def.label + '  [' + def.index + ']';
        label.title = def.sourceName;
        label.htmlFor = 'mod-item-f-' + def.index;
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'mod-item-f-' + def.index;
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.setAttribute('data-field-index', String(def.index));
        input.addEventListener('input', () => this._validateField(def, input));
        line.appendChild(label);
        line.appendChild(input);

        const err = document.createElement('div');
        err.className = 'mod-field-error';
        err.id = 'mod-item-f-' + def.index + '-error';
        wrap.appendChild(line);
        wrap.appendChild(err);
        this.fieldsEl.appendChild(wrap);
        this._fieldInputs.push({ def, input, err });
      }
    },

    // ---------- 物品页数据 ----------
    _inventory() {
      const p = this.game && this.game.player;
      if (!p || !Array.isArray(p.inv)) return [];
      return p.inv.filter((x) => x && Array.isArray(x.f));
    },

    _currentItem() {
      if (!this._indexValid) return null;
      const inv = this._inventory();
      return inv[this.index - 1] || null;
    },

    refresh(force) {
      if (!this.fields) return;
      const inv = this._inventory();
      const count = inv.length;
      this.indexHint.textContent = count ? '背包共 ' + count + ' 件' : '背包为空';
      let n = Number.parseInt(this.indexInput.value, 10);
      if (!Number.isInteger(n) || n < 1) n = this.index || 1;
      if (count && n > count) n = count;
      if (!count) n = 1;
      this.index = n;
      this.indexInput.value = String(n);
      this._setIndexError('');
      this._indexValid = true;

      const it = inv[n - 1];
      if (!it) {
        this.nameInput.value = '';
        for (const f of this._fieldInputs) {
          f.input.value = '';
          f.input.disabled = true;
          f.err.textContent = '';
        }
        this.saveBtn.disabled = true;
        if (force) this._setStatus('背包中没有可修改的物品。', true);
        return;
      }
      this.nameInput.value = this._itemName(it);
      for (const f of this._fieldInputs) {
        const v = it.f[f.def.index];
        f.input.value = String(v === undefined || v === null ? 0 : v);
        f.input.disabled = false;
        this._validateField(f.def, f.input, false);
      }
      this._updateSaveState();
      if (force) this._setStatus('已按当前存档重新载入。', false);
    },

    _itemName(it) {
      try {
        if (Elona.ItemDB && Elona.ItemDB.name) {
          return Elona.ItemDB.name(it, 'ch') || Elona.ItemDB.name(it, 'jp') || '';
        }
      } catch (e) { /* 物品表未加载时退回编号 */ }
      return '(物品 ' + ((it.id | 0) || (it.f[3] | 0)) + ')';
    },

    _onIndexInput() {
      // 「只能输入数字」：非数字字符直接剔除，负号和小数点都进不来。
      const clean = String(this.indexInput.value).replace(/[^\d]/g, '').slice(0, 6);
      if (clean !== this.indexInput.value) this.indexInput.value = clean;
      const n = Number.parseInt(clean, 10);
      const count = this._inventory().length;
      if (!clean || !Number.isInteger(n) || n < 1) {
        this._indexValid = false;
        this.saveBtn.disabled = true;
        this._setIndexError('请输入大于 0 的整数。');
        this._setStatus('物品索引不合法。', true);
        return;
      }
      if (count && n > count) {
        this._indexValid = false;
        this.saveBtn.disabled = true;
        this._setIndexError('超出背包范围（1 - ' + count + '）。');
        this._setStatus('物品索引超出范围。', true);
        return;
      }
      this.index = n;
      this._indexValid = true;
      this.refresh();
    },

    _stepIndex(delta) {
      const count = this._inventory().length;
      if (!count) {
        this._setStatus('背包为空，无法切换物品。', true);
        return;
      }
      const base = Number.parseInt(this.indexInput.value, 10);
      const from = Number.isInteger(base) && base >= 1 ? base : this.index;
      const next = Math.max(1, Math.min(count, from + delta));
      this.indexInput.value = String(next);
      this.index = next;
      this._indexValid = true;
      this.refresh();
    },

    _validateValue(def, raw) {
      const s = String(raw == null ? '' : raw).trim();
      if (!/^[+-]?\d+$/.test(s)) return '请输入整数。';
      const v = Number(s);
      if (!Number.isSafeInteger(v)) return '数值超出 32 位整数范围。';
      if (v < def.min || v > def.max) return '范围 ' + def.min + ' ~ ' + def.max + '。';
      return null;
    },

    _validateField(def, input, updateStatus) {
      const err = this._validateValue(def, input.value);
      input.classList.toggle('bad', !!err);
      const row = this.fieldsEl.querySelector('[data-field-index="' + def.index + '"]');
      if (row) row.classList.toggle('bad', !!err);
      const errEl = row && row.querySelector('.mod-field-error');
      if (errEl) errEl.textContent = err || '';
      this._updateSaveState();
      if (err && updateStatus !== false) this._setStatus(def.label + '：' + err, true);
      return !err;
    },

    _updateSaveState() {
      if (!this.saveBtn) return;
      const okIndex = this._indexValid && !!this._currentItem();
      const okFields = this._fieldInputs.every((f) => !this._validateValue(f.def, f.input.value));
      this.saveBtn.disabled = !(okIndex && okFields);
    },

    _saveItem() {
      const it = this._currentItem();
      if (!it) {
        this._setStatus('请先选择背包中有效的物品索引。', true);
        return;
      }
      const pending = [];
      for (const f of this._fieldInputs) {
        const err = this._validateValue(f.def, f.input.value);
        if (err) {
          f.input.focus();
          this._setStatus(f.def.label + '：' + err, true);
          return;
        }
        pending.push({ index: f.def.index, value: Number(f.input.value) });
      }
      for (const p of pending) it.f[p.index] = p.value;
      if (Elona.UI && Elona.UI.invalidateInventory) Elona.UI.invalidateInventory();
      this.refresh();
      this._setStatus('已保存物品 ' + this.index + ' 的 ' + pending.length + ' 个字段。', false);
      if (Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage('修改器：物品 ' + this.index + ' 已保存。');
    },

    _setIndexError(msg) {
      if (this.indexError) this.indexError.textContent = msg || '';
      if (this.indexInput) this.indexInput.classList.toggle('bad', !!msg);
    },

    _setStatus(msg, isError) {
      if (!this.statusEl) return;
      this.statusEl.textContent = msg || '';
      this.statusEl.classList.toggle('bad', !!isError);
    },
  };

  Elona.Modifier = Modifier;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Modifier.init());
  } else {
    Modifier.init();
  }
})(window);
