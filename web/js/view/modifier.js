'use strict';
/**
 * 修改器弹窗（F4）
 *
 * 字段表都由 CSV 机械生成，不写死在 JS 里：
 *   tools/gen_itemfields.py   → itemfields.json  （var_99：物品页）
 *   tools/gen_statefields.py  → statefields.json （var_58 / var_65 / var_82：状态页）
 *   tools/gen_skillsfields.py → skillfields.json （var_82：技能页）
 * 打开弹窗 / 切换页签时都重新从当前游戏状态读值，避免显示旧存档。
 * 目前实现「物品」「状态」「技能」三页，其余六页占位但页签切换可用。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const TABS = [
    { id: 'system', label: '系统参数' },
    { id: 'status', label: '状态' },
    { id: 'skill', label: '技能' },
    { id: 'item', label: '物品' },
    { id: 'spell', label: '魔法库存' },
    { id: 'material', label: '材料' },
    { id: 'quest', label: '委托' },
  ];
  const LABEL_MAX = 10;
  const ELLIPSIS = '......';

  const Modifier = {
    TABS,
    root: null,
    tabsEl: null,
    bodyEl: null,
    game: null,
    tab: 'item',

    // 物品页（沿用 0-Z39 的字段名，便于旧测试/调用方）
    fields: null,
    index: 1,
    _indexValid: true,
    _fieldInputs: [],

    // 状态页：charas 的槽位索引与原版 var_58 第二维一致，0 = 主角
    stateFields: null,
    charaIndex: 0,
    _charaIndexValid: true,
    _stateFieldInputs: [],

    // 技能页：var_82(skill_id, 人物索引)，同样 0 = 主角
    skillFields: null,
    skillIndex: 0,
    _skillIndexValid: true,
    _skillFieldInputs: [],

    _built: false,
    _loadPromise: null,

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
        this._setStatus('字段表载入失败：' + (e && e.message ? e.message : String(e)), true, this.tab);
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

    /** 页签切换：切到物品/状态页时都重新读当前游戏状态 */
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
      if (t.id === 'status' && (force || this.stateFields)) this.refreshChara();
      if (t.id === 'skill' && (force || this.skillFields)) this.refreshSkill();
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
        if (t.id === 'item') page.innerHTML = this._itemPageHtml();
        else if (t.id === 'status') page.innerHTML = this._statusPageHtml();
        else if (t.id === 'skill') page.innerHTML = this._skillPageHtml();
        else page.innerHTML = '<div class="mod-placeholder">【' + t.label + '】页面尚未实现。</div>';
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

      const statusPage = this.bodyEl.querySelector('[data-page="status"]');
      this.charaForm = statusPage.querySelector('#mod-chara-form');
      this.charaIndexInput = statusPage.querySelector('#mod-chara-index');
      this.charaIndexHint = statusPage.querySelector('#mod-chara-index-hint');
      this.charaIndexError = statusPage.querySelector('#mod-chara-index-error');
      this.charaNameInput = statusPage.querySelector('#mod-chara-name');
      this.stateFieldsEl = statusPage.querySelector('#mod-status-fields');
      this.charaStatusEl = statusPage.querySelector('#mod-status-status');
      this.charaSaveBtn = statusPage.querySelector('#mod-status-save');
      this.charaIndexInput.addEventListener('input', () => this._onCharaIndexInput());
      statusPage.querySelector('#mod-chara-prev').addEventListener('click', () => this._stepCharaIndex(-1));
      statusPage.querySelector('#mod-chara-next').addEventListener('click', () => this._stepCharaIndex(1));
      statusPage.querySelector('#mod-status-reset').addEventListener('click', () => this.refreshChara(true));
      this.charaForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this._saveChara();
      });

      const skillPage = this.bodyEl.querySelector('[data-page="skill"]');
      this.skillForm = skillPage.querySelector('#mod-skill-form');
      this.skillIndexInput = skillPage.querySelector('#mod-skill-index');
      this.skillIndexHint = skillPage.querySelector('#mod-skill-index-hint');
      this.skillIndexError = skillPage.querySelector('#mod-skill-index-error');
      this.skillNameInput = skillPage.querySelector('#mod-skill-name');
      this.skillFieldsEl = skillPage.querySelector('#mod-skill-fields');
      this.skillStatusEl = skillPage.querySelector('#mod-skill-status');
      this.skillSaveBtn = skillPage.querySelector('#mod-skill-save');
      this.skillIndexInput.addEventListener('input', () => this._onSkillIndexInput());
      skillPage.querySelector('#mod-skill-prev').addEventListener('click', () => this._stepSkillIndex(-1));
      skillPage.querySelector('#mod-skill-next').addEventListener('click', () => this._stepSkillIndex(1));
      skillPage.querySelector('#mod-skill-reset').addEventListener('click', () => this.refreshSkill(true));
      this.skillForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this._saveSkill();
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

    _statusPageHtml() {
      return [
        '<form id="mod-chara-form" autocomplete="off">',
        '  <div class="mod-line">',
        '    <label for="mod-chara-index">人物索引</label>',
        '    <button type="button" id="mod-chara-prev" class="mod-arrow" aria-label="上一个人物">◀</button>',
        '    <input id="mod-chara-index" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" value="0" />',
        '    <button type="button" id="mod-chara-next" class="mod-arrow" aria-label="下一个人物">▶</button>',
        '    <span id="mod-chara-index-hint" class="mod-hint"></span>',
        '  </div>',
        '  <div id="mod-chara-index-error" class="mod-field-error"></div>',
        '  <div class="mod-line">',
        '    <label for="mod-chara-name">人物名称</label>',
        '    <input id="mod-chara-name" type="text" readonly class="mod-readonly" />',
        '  </div>',
        '  <div id="mod-status-fields" class="mod-fields"></div>',
        '  <div class="mod-actions">',
        '    <button type="submit" id="mod-status-save">保存</button>',
        '    <button type="button" id="mod-status-reset">还原</button>',
        '    <span id="mod-status-status" class="mod-status" role="status"></span>',
        '  </div>',
        '</form>',
      ].join('\n');
    },

    _skillPageHtml() {
      return [
        '<form id="mod-skill-form" autocomplete="off">',
        '  <div class="mod-line">',
        '    <label for="mod-skill-index">人物索引</label>',
        '    <button type="button" id="mod-skill-prev" class="mod-arrow" aria-label="上一个人物">◀</button>',
        '    <input id="mod-skill-index" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" value="0" />',
        '    <button type="button" id="mod-skill-next" class="mod-arrow" aria-label="下一个人物">▶</button>',
        '    <span id="mod-skill-index-hint" class="mod-hint"></span>',
        '  </div>',
        '  <div id="mod-skill-index-error" class="mod-field-error"></div>',
        '  <div class="mod-line">',
        '    <label for="mod-skill-name">人物姓名</label>',
        '    <input id="mod-skill-name" type="text" readonly class="mod-readonly" />',
        '  </div>',
        '  <div id="mod-skill-fields" class="mod-fields"></div>',
        '  <div class="mod-actions">',
        '    <button type="submit" id="mod-skill-save">保存</button>',
        '    <button type="button" id="mod-skill-reset">还原</button>',
        '    <span id="mod-skill-status" class="mod-status" role="status"></span>',
        '  </div>',
        '</form>',
      ].join('\n');
    },

    /** 长字段名：只显示前 10 字 + ......；完整名放 title，鼠标悬停自然浮出 */
    _shortLabel(label) {
      const s = String(label == null ? '' : label);
      const chars = Array.from(s);
      return chars.length > LABEL_MAX ? chars.slice(0, LABEL_MAX).join('') + ELLIPSIS : s;
    },

    /** 统一存储键：var_65 的字段按全局槽分组，var_58 按角色字段号分组 */
    _storeKey(def) {
      if (def.store === 'v65') return ('v65:' + def.v65);
      if (def.store === 'var82') return ('var82:' + def.index);
      return ('var58:' + def.index);
    },

    /** 魔法点这类字段只在玩家（角色槽 0）显示 */
    _fieldVisible(def, charIndex) {
      return !(def.playerOnly && (charIndex | 0) !== 0);
    },

    _readStatusValue(c, def) {
      if (def.store === 'v65') {
        return this.game && this.game.getV65 ? this.game.getV65(def.v65) : 0;
      }
      if (def.store === 'var82') return c.skill(def.index);
      return c.get(def.index);
    },

    _writeStatusValue(c, def, value) {
      if (def.store === 'v65') {
        if (this.game && this.game.setV65) this.game.setV65(def.v65, value);
      } else if (def.store === 'var82') {
        c.setSkill(def.index, value);
      } else {
        c.set(def.index, value);
      }
    },

    /** var_65(85) 的两个叫法指向同一槽：编辑一个，另一个输入框立即跟着变 */
    _syncLinkedFields(input, value, page) {
      if (page !== 'status') return;
      const key = this._storeKey(input._modDef || {});
      for (const f of this._stateFieldInputs) {
        if (f.input === input || this._storeKey(f.def) !== key || f.input.disabled) continue;
        f.input.value = String(value);
        f.input.classList.remove('bad');
        if (f.err) f.err.textContent = '';
        const row = f.input.closest ? f.input.closest('.mod-field') : null;
        if (row) row.classList.remove('bad');
      }
    },

    async _ensureFields() {
      if (this.fields && this.stateFields && this.skillFields) return;
      if (!this._loadPromise) {
        this._loadPromise = (async () => {
          const load = async (name) => {
            let data = Elona.Data && Elona.Data.tableSync
              ? Elona.Data.tableSync(name) : null;
            if (!data && Elona.Data && Elona.Data.table) data = await Elona.Data.table(name);
            if (!data || !Array.isArray(data.fields) || !data.fields.length) {
              throw new Error(name + '.json 为空');
            }
            return data.fields;
          };
          const [itemFields, stateFields, skillFields] = await Promise.all([
            load('itemfields'), load('statefields'), load('skillfields'),
          ]);
          this.fields = itemFields;
          this.stateFields = stateFields;
          this.skillFields = skillFields;
          this._buildFieldRows(this.fieldsEl, this.fields, 'mod-item', 'item');
          this._buildFieldRows(this.stateFieldsEl, this.stateFields, 'mod-status', 'status');
          this._buildFieldRows(this.skillFieldsEl, this.skillFields, 'mod-skill', 'skill');
        })().catch((e) => { this._loadPromise = null; throw e; });
      }
      await this._loadPromise;
    },

    _buildFieldRows(container, defs, prefix, page) {
      container.innerHTML = '';
      const list = [];
      for (const def of defs) {
        const key = def.row === undefined ? 'i' + def.index : 's' + def.row;
        // 物品/技能页用字段索引（都唯一）；状态页用 CSV 行号，避免历史重复索引撞 id。
        const inputId = prefix + '-f-'
          + (page === 'status' && def.row !== undefined ? 's' + def.row : def.index);
        const wrap = document.createElement('div');
        wrap.className = 'mod-field';
        wrap.setAttribute('data-key', key);
        wrap.setAttribute('data-field-index', String(def.index));
        if (def.shared) wrap.classList.add('shared');

        const line = document.createElement('div');
        line.className = 'mod-field-line';
        const label = document.createElement('label');
        label.textContent = this._shortLabel(def.label);
        // title 保留完整中文名 + 原始字段名 + 存储槽，长名字截断后悬停仍看得到
        const storeText = page === 'item'
          ? 'var_99(' + def.index + ')'
          : (def.store === 'v65' ? 'var_65(' + def.v65 + ')'
            : (def.store === 'var82' ? 'var_82(' + def.index + ')' : 'var_58(' + def.index + ')'));
        label.title = def.label + '（' + def.sourceName + '，' + storeText + '）'
          + (def.shared ? '；与另一字段共用同一存储槽，修改会同步' : '');
        label.htmlFor = inputId;
        const input = document.createElement('input');
        input.type = 'text';
        input.id = inputId;
        input._modDef = def;
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.setAttribute('data-field-index', String(def.index));
        input.addEventListener('input', () => this._validateField(def, input, true, page));
        line.appendChild(label);
        line.appendChild(input);

        const err = document.createElement('div');
        err.className = 'mod-field-error';
        err.id = inputId + '-error';
        wrap.appendChild(line);
        wrap.appendChild(err);
        container.appendChild(wrap);
        list.push({ def, input, err });
      }
      if (page === 'status') this._stateFieldInputs = list;
      else if (page === 'skill') this._skillFieldInputs = list;
      else this._fieldInputs = list;
      return list;
    },

    // ---------- 物品页数据 ----------
    _inventory() {
      const p = this.game && this.game.player;
      if (!p || !Array.isArray(p.inv)) return [];
      return p.inv.filter((x) => x && Array.isArray(x.f));
    },
    _currentItem() {
      if (!this._indexValid) return null;
      return this._inventory()[this.index - 1] || null;
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
          f.input.value = ''; f.input.disabled = true; f.err.textContent = '';
        }
        this.saveBtn.disabled = true;
        if (force) this._setStatus('背包中没有可修改的物品。', true, 'item');
        return;
      }
      this.nameInput.value = this._itemName(it);
      for (const f of this._fieldInputs) {
        const v = it.f[f.def.index];
        f.input.value = String(v === undefined || v === null ? 0 : v);
        f.input.disabled = false;
        this._validateField(f.def, f.input, false, 'item');
      }
      this._updateSaveState('item');
      if (force) this._setStatus('已按当前存档重新载入。', false, 'item');
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
        this._setStatus('物品索引不合法。', true, 'item');
        return;
      }
      if (count && n > count) {
        this._indexValid = false;
        this.saveBtn.disabled = true;
        this._setIndexError('超出背包范围（1 - ' + count + '）。');
        this._setStatus('物品索引超出范围。', true, 'item');
        return;
      }
      this.index = n;
      this._indexValid = true;
      this.refresh();
    },

    _stepIndex(delta) {
      const count = this._inventory().length;
      if (!count) {
        this._setStatus('背包为空，无法切换物品。', true, 'item');
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

    // ---------- 状态页数据（var_58） ----------
    _characters() {
      return (this.game && Array.isArray(this.game.charas)) ? this.game.charas : [];
    },
    _currentChara() {
      if (!this._charaIndexValid) return null;
      return this._characters()[this.charaIndex] || null;
    },

    refreshChara(force) {
      if (!this.stateFields) return;
      const list = this._characters();
      const max = Math.max(0, list.length - 1);
      this.charaIndexHint.textContent = list.length
        ? '0＝主角，共 ' + list.length + ' 个角色槽' : '没有角色槽';
      let n = Number.parseInt(this.charaIndexInput.value, 10);
      if (!Number.isInteger(n) || n < 0) n = this.charaIndex || 0;
      if (n > max) n = max;
      this.charaIndex = n;
      this.charaIndexInput.value = String(n);
      this._setCharaIndexError('');
      this._charaIndexValid = true;

      const c = list[n];
      if (!c) {
        this.charaNameInput.value = '';
        for (const f of this._stateFieldInputs) {
          f.input.value = ''; f.input.disabled = true; f.err.textContent = '';
        }
        this.charaSaveBtn.disabled = true;
        if (force) this._setStatus('该角色槽为空。', true, 'status');
        return;
      }
      this.charaNameInput.value = this._charaName(c);
      for (const f of this._stateFieldInputs) {
        const row = f.input.closest ? f.input.closest('.mod-field') : null;
        const visible = this._fieldVisible(f.def, n);
        if (row) row.classList.toggle('hidden', !visible);
        if (!visible) {
          f.input.value = '';
          f.input.disabled = true;
          f.err.textContent = '';
          continue;
        }
        const v = this._readStatusValue(c, f.def);
        f.input.value = String(v === undefined || v === null ? 0 : v);
        f.input.disabled = false;
        this._validateField(f.def, f.input, false, 'status');
      }
      this._updateSaveState('status');
      if (force) this._setStatus('已按当前存档重新载入。', false, 'status');
    },

    _charaName(c) {
      try {
        if (Elona.Relation && Elona.Relation.nameOf) {
          const n = Elona.Relation.nameOf(c);
          if (n && n !== '?') return n;
        }
      } catch (e) { /* 关系模块未就绪时退回实例字段 */ }
      return c.cname || c.name || c.nameEn || ('角色 ' + c.index);
    },

    _onCharaIndexInput() {
      const clean = String(this.charaIndexInput.value).replace(/[^\d]/g, '').slice(0, 6);
      if (clean !== this.charaIndexInput.value) this.charaIndexInput.value = clean;
      const n = Number.parseInt(clean, 10);
      const max = Math.max(0, this._characters().length - 1);
      if (clean === '' || !Number.isInteger(n) || n < 0) {
        this._charaIndexValid = false;
        this.charaSaveBtn.disabled = true;
        this._setCharaIndexError('请输入非负整数（0＝主角）。');
        this._setStatus('人物索引不合法。', true, 'status');
        return;
      }
      if (n > max) {
        this._charaIndexValid = false;
        this.charaSaveBtn.disabled = true;
        this._setCharaIndexError('超出角色范围（0 - ' + max + '）。');
        this._setStatus('人物索引超出范围。', true, 'status');
        return;
      }
      this.charaIndex = n;
      this._charaIndexValid = true;
      this.refreshChara();
    },

    _stepCharaIndex(delta) {
      const list = this._characters();
      const max = Math.max(0, list.length - 1);
      const base = Number.parseInt(this.charaIndexInput.value, 10);
      const from = Number.isInteger(base) && base >= 0 ? base : this.charaIndex;
      const next = Math.max(0, Math.min(max, from + delta));
      this.charaIndexInput.value = String(next);
      this.charaIndex = next;
      this._charaIndexValid = true;
      this.refreshChara();
    },

    // ---------- 通用校验 / 保存 ----------
    _validateValue(def, raw) {
      const s = String(raw == null ? '' : raw).trim();
      if (!/^[+-]?\d+$/.test(s)) return '请输入整数。';
      const v = Number(s);
      if (!Number.isSafeInteger(v)) return '数值超出 32 位整数范围。';
      if (v < def.min || v > def.max) return '范围 ' + def.min + ' ~ ' + def.max + '。';
      return null;
    },

    _validateField(def, input, updateStatus, page) {
      const err = this._validateValue(def, input.value);
      input.classList.toggle('bad', !!err);
      const row = input.closest ? input.closest('.mod-field') : null;
      if (row) row.classList.toggle('bad', !!err);
      const errEl = row && row.querySelector('.mod-field-error');
      if (errEl) errEl.textContent = err || '';
      this._updateSaveState(page || 'item');
      if (err && updateStatus !== false) {
        this._setStatus(def.label + '：' + err, true, page || 'item');
      } else if (!err && updateStatus === true) {
        // 用户把非法值改正后，清掉上一次留在状态栏的错误提示；
        // 不碰「已保存」这类正常提示，也不动 refresh() 的静默校验。
        const el = this._statusElFor(page || 'item');
        if (el && el.classList.contains('bad')) this._setStatus('', false, page || 'item');
        this._syncLinkedFields(input, String(input.value).trim(), page || 'item');
      }
      return !err;
    },

    _updateSaveState(page) {
      const kind = page === 'status' ? 'status' : (page === 'skill' ? 'skill' : 'item');
      const inputs = kind === 'status' ? this._stateFieldInputs
        : (kind === 'skill' ? this._skillFieldInputs : this._fieldInputs);
      const btn = kind === 'status' ? this.charaSaveBtn
        : (kind === 'skill' ? this.skillSaveBtn : this.saveBtn);
      if (!btn) return;
      const okIndex = kind === 'status'
        ? (this._charaIndexValid && !!this._currentChara())
        : (kind === 'skill'
          ? (this._skillIndexValid && !!this._currentSkillChara())
          : (this._indexValid && !!this._currentItem()));
      const okFields = inputs.every((f) => {
        const row = f.input.closest ? f.input.closest('.mod-field') : null;
        if (row && row.classList.contains('hidden')) return true;
        return !this._validateValue(f.def, f.input.value);
      });
      btn.disabled = !(okIndex && okFields);
    },

    _saveItem() {
      const it = this._currentItem();
      if (!it) {
        this._setStatus('请先选择背包中有效的物品索引。', true, 'item');
        return;
      }
      const pending = [];
      for (const f of this._fieldInputs) {
        const err = this._validateValue(f.def, f.input.value);
        if (err) {
          f.input.focus();
          this._setStatus(f.def.label + '：' + err, true, 'item');
          return;
        }
        pending.push({ index: f.def.index, value: Number(f.input.value) });
      }
      for (const p of pending) it.f[p.index] = p.value;
      if (Elona.UI && Elona.UI.invalidateInventory) Elona.UI.invalidateInventory();
      this.refresh();
      this._setStatus('已保存物品 ' + this.index + ' 的 ' + pending.length + ' 个字段。', false, 'item');
      if (Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage('修改器：物品 ' + this.index + ' 已保存。');
    },

    _saveChara() {
      const c = this._currentChara();
      if (!c) {
        this._setStatus('请先选择有效的角色槽（0＝主角）。', true, 'status');
        return;
      }
      const pending = [];
      for (const f of this._stateFieldInputs) {
        const row = f.input.closest ? f.input.closest('.mod-field') : null;
        if (row && row.classList.contains('hidden')) continue;   // 魔法点只在玩家页生效
        const err = this._validateValue(f.def, f.input.value);
        if (err) {
          f.input.focus();
          this._setStatus(f.def.label + '：' + err, true, 'status');
          return;
        }
        pending.push({ def: f.def, value: Number(f.input.value) });
      }
      for (const p of pending) this._writeStatusValue(c, p.def, p.value);
      this.refreshChara();
      this._setStatus('已保存角色 ' + this.charaIndex + ' 的 ' + pending.length + ' 个字段。', false, 'status');
      if (Elona.UI && Elona.UI.pushMessage) {
        Elona.UI.pushMessage('修改器：角色 ' + this.charaIndex + ' 已保存。');
      }
    },

    // ---------- 技能页数据（var_82） ----------
    _currentSkillChara() {
      if (!this._skillIndexValid) return null;
      return this._characters()[this.skillIndex] || null;
    },

    refreshSkill(force) {
      if (!this.skillFields) return;
      const list = this._characters();
      const max = Math.max(0, list.length - 1);
      this.skillIndexHint.textContent = list.length
        ? '0＝主角，共 ' + list.length + ' 个角色槽' : '没有角色槽';
      let n = Number.parseInt(this.skillIndexInput.value, 10);
      if (!Number.isInteger(n) || n < 0) n = this.skillIndex || 0;
      if (n > max) n = max;
      this.skillIndex = n;
      this.skillIndexInput.value = String(n);
      this._setSkillIndexError('');
      this._skillIndexValid = true;

      const c = list[n];
      if (!c) {
        this.skillNameInput.value = '';
        for (const f of this._skillFieldInputs) {
          f.input.value = ''; f.input.disabled = true; f.err.textContent = '';
        }
        this.skillSaveBtn.disabled = true;
        if (force) this._setStatus('该角色槽为空。', true, 'skill');
        return;
      }
      this.skillNameInput.value = this._charaName(c);
      for (const f of this._skillFieldInputs) {
        const row = f.input.closest ? f.input.closest('.mod-field') : null;
        const visible = this._fieldVisible(f.def, n);
        if (row) row.classList.toggle('hidden', !visible);
        if (!visible) {
          f.input.value = ''; f.input.disabled = true; f.err.textContent = '';
          continue;
        }
        const v = this._readStatusValue(c, f.def);
        f.input.value = String(v === undefined || v === null ? 0 : v);
        f.input.disabled = false;
        this._validateField(f.def, f.input, false, 'skill');
      }
      this._updateSaveState('skill');
      if (force) this._setStatus('已按当前存档重新载入。', false, 'skill');
    },

    _onSkillIndexInput() {
      const clean = String(this.skillIndexInput.value).replace(/[^\d]/g, '').slice(0, 6);
      if (clean !== this.skillIndexInput.value) this.skillIndexInput.value = clean;
      const n = Number.parseInt(clean, 10);
      const max = Math.max(0, this._characters().length - 1);
      if (clean === '' || !Number.isInteger(n) || n < 0) {
        this._skillIndexValid = false;
        this.skillSaveBtn.disabled = true;
        this._setSkillIndexError('请输入非负整数（0＝主角）。');
        this._setStatus('人物索引不合法。', true, 'skill');
        return;
      }
      if (n > max) {
        this._skillIndexValid = false;
        this.skillSaveBtn.disabled = true;
        this._setSkillIndexError('超出角色范围（0 - ' + max + '）。');
        this._setStatus('人物索引超出范围。', true, 'skill');
        return;
      }
      this.skillIndex = n;
      this._skillIndexValid = true;
      this.refreshSkill();
    },

    _stepSkillIndex(delta) {
      const max = Math.max(0, this._characters().length - 1);
      const base = Number.parseInt(this.skillIndexInput.value, 10);
      const from = Number.isInteger(base) && base >= 0 ? base : this.skillIndex;
      const next = Math.max(0, Math.min(max, from + delta));
      this.skillIndexInput.value = String(next);
      this.skillIndex = next;
      this._skillIndexValid = true;
      this.refreshSkill();
    },

    _saveSkill() {
      const c = this._currentSkillChara();
      if (!c) {
        this._setStatus('请先选择有效的角色槽（0＝主角）。', true, 'skill');
        return;
      }
      const pending = [];
      for (const f of this._skillFieldInputs) {
        const row = f.input.closest ? f.input.closest('.mod-field') : null;
        if (row && row.classList.contains('hidden')) continue;
        const err = this._validateValue(f.def, f.input.value);
        if (err) {
          f.input.focus();
          this._setStatus(f.def.label + '：' + err, true, 'skill');
          return;
        }
        pending.push({ def: f.def, value: Number(f.input.value) });
      }
      for (const p of pending) this._writeStatusValue(c, p.def, p.value);
      this.refreshSkill();
      this._setStatus('已保存角色 ' + this.skillIndex + ' 的 ' + pending.length + ' 个技能。', false, 'skill');
      if (Elona.UI && Elona.UI.pushMessage) {
        Elona.UI.pushMessage('修改器：角色 ' + this.skillIndex + ' 的技能已保存。');
      }
    },

    _setIndexError(msg) {
      if (this.indexError) this.indexError.textContent = msg || '';
      if (this.indexInput) this.indexInput.classList.toggle('bad', !!msg);
    },
    _setCharaIndexError(msg) {
      if (this.charaIndexError) this.charaIndexError.textContent = msg || '';
      if (this.charaIndexInput) this.charaIndexInput.classList.toggle('bad', !!msg);
    },
    _setSkillIndexError(msg) {
      if (this.skillIndexError) this.skillIndexError.textContent = msg || '';
      if (this.skillIndexInput) this.skillIndexInput.classList.toggle('bad', !!msg);
    },
    _statusElFor(page) {
      if (page === 'status') return this.charaStatusEl;
      if (page === 'skill') return this.skillStatusEl;
      return this.statusEl;
    },
    _setStatus(msg, isError, page) {
      const el = this._statusElFor(page);
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('bad', !!isError);
    },
  };

  Elona.Modifier = Modifier;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Modifier.init());
  } else {
    Modifier.init();
  }
})(window);
