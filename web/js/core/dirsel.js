'use strict';
/**
 * 方向选择（近距离能力）—— `*label_2959` 的 8000 分支（315665-315712）。
 *
 * 【原版行为】
 *   玩家发动「var_83(3, id) \ 1000 * 1000 == 8000」的能力、且**没有锁定目标**时：
 *     315670  `txt_select "どの方向？"`
 *     315673  `gosub *label_2104`（等按键）
 *     315674  `gosub *label_2893`（把方向换算成 `var_1311 / var_1312`）
 *     315679  `var_704(var_1311, var_1312, 1) == 0` → 格子是空的：
 *               `var_2421 = 1`（标记「目标是地面」）、`var_2101 = 0`，直接 return 1
 *     315683  否则 `var_244 = var_704(...) - 1`（取该格角色）
 *     315685  目标正在被骑乘（`var_58(168) != 0`）→ 「骑乘者 / 坐骑」二选一
 *   锁定目标时则**跳过选择**，只校验 `dist > var_83(3, id) \ 1000 + 1` 就中止（315699）。
 *   最后 315710：目标格 `var_58(140)` 为 30/31（墙）→ 中止。
 *
 * 【本项目的落地方式】
 *   原版是阻塞式循环；这里做成状态机，由 main.js 逐键驱动：
 *     `DirSel.start(g, id)` 打开方向层（渲染 8 个箭头）
 *     方向键 / 小键盘 1..9 → `DirSel.pick(g, dx, dy)` → 结算并接着发动
 *     Esc → `DirSel.cancel()`
 *
 *   与能力窗的衔接：`Ability.use` 遇到需要方向时返回
 *   `{ ok:false, reason:'need-direction', dirs:true, range }`，
 *   面板据此关窗并调用 `DirSel.start`。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 八方向（顺序与原版小键盘一致：左下起顺时针） */
  const DIRS = [
    { key: 1, dx: -1, dy: 1, label: '↙' },
    { key: 2, dx: 0, dy: 1, label: '↓' },
    { key: 3, dx: 1, dy: 1, label: '↘' },
    { key: 4, dx: -1, dy: 0, label: '←' },
    { key: 6, dx: 1, dy: 0, label: '→' },
    { key: 7, dx: -1, dy: -1, label: '↖' },
    { key: 8, dx: 0, dy: -1, label: '↑' },
    { key: 9, dx: 1, dy: -1, label: '↗' },
  ];

  /** 格子上的角色（原版 `var_704(x, y, 1)`：0 = 空） */
  function charaAt(g, x, y) {
    const cell = (g.map && g.map.cell) ? g.map.cell(x, y) : null;
    if (!cell || cell[1] === 0) return null;
    const c = g.charas[cell[1] - 1];
    return (c && (c.get(0) | 0) === 1) ? c : null;
  }

  const DirSel = {
    active: false,
    aid: 0,
    /** 'ability' 能力（g.useAbility）/ 'spell' 咏唱（g.castPlayerSpell 的格子指定）
     *  / 'item' 使用道具（进化道具 58 的邻格指定，g.useItem） */
    kind: 'ability',
    range: 1,
    itemIdx: -1,
    /** 使用道具时，若道具在脚下（t 窗口的地面列表），这里是那个物品实例 */
    groundItem: null,
    /** 道具档：回车/5 = 对自己（原版准星 Esc 时 var_244 保持 0） */
    allowSelf: false,
    /** 道具档：空格也继续，把方向交给 useItem（魔杖 315827） */
    allowEmpty: false,
    /**
     * 0-EP：道具档的「邻格无人也要继续」。
     *   `*label_2893` 的语义是「选玩家的一格邻格」：越界 / 邻格没有角色都只是
     *   `stat = 0`（var_244 不变 → 目标为空），由效果本体自己去打印「それは無理だ。」。
     *   打开这个开关后，`commit` 会把 `target: null` 原样交给 `useItem`。
     */
    passEmpty: false,
    /** 上次发动留下的事件（给 UI 取用） */
    lastResult: null,

    /** 开范围：`var_83(3, id) \ 1000 + 1`（315703），通常都是 1 */
    rangeOf(id) {
      const S = Elona.Spell;
      const f3 = (S && S.field) ? (S.field(id, 3) | 0) : 8000;
      // 315701/315758/315787：射程 = `var_83(3,id) \ 1000 + 1`（HSP 的 `\` 是整数除）
      return Math.floor(f3 / 1000) + 1;
    },

    /** 是否该走方向选择（类别 8000 且是玩家） */
    needs(id, caster) {
      const S = Elona.Spell;
      if (!S || !S.field) return false;
      if (caster && (caster.index | 0) !== 0) return false;
      const f3 = S.field(id, 3) | 0;
      return Math.floor(f3 / 1000) * 1000 === 8000;
    },

    /**
     * 近距离能力的方向选择。
     * @param {object} g
     * @param {number} id 能力 id
     * @param {object} [opts] { allowSelf } —— 0-EP 的 626 精神分析允许「对自己」
     */
    start(g, id, opts) {
      const o = opts || {};
      this.active = true;
      this.kind = 'ability';
      this.aid = id | 0;
      this.itemIdx = -1;
      this.groundItem = null;
      this.allowSelf = !!o.allowSelf;
      this.allowEmpty = false;
      this.passEmpty = false;
      this.range = this.rangeOf(id);
      this.lastResult = null;
      if (g) g.dirSel = { aid: this.aid, range: this.range };
      return { ok: true, aid: this.aid, range: this.range, allowSelf: this.allowSelf, dirs: DIRS.slice() };
    },

    /**
     * 咏唱的地面指定（`var_83(3,id)` 类别 7000：造墙/造门/酸/火墙 等）。
     * 与能力的「どの方向？」共用箭头与按键，只是结算时改调 castPlayerSpell。
     */
    startCast(g, id, range) {
      this.active = true;
      this.kind = 'spell';
      this.aid = id | 0;
      this.itemIdx = -1;
      this.groundItem = null;
      this.allowSelf = false;
      this.allowEmpty = false;
      this.range = Math.max(1, range | 0 || 1);
      this.lastResult = null;
      if (g) g.dirSel = { aid: this.aid, range: this.range, kind: 'spell' };
      return { ok: true, aid: this.aid, range: this.range, dirs: DIRS.slice() };
    },

    /**
     * 通用「做哪个方向？」—— 原版这些动作都走 `*label_2893`：
     *   挖掘 d（`*label_2736`，288688-288700「どの方向を掘る？」）
     *   体当たり b（`*label_2737`，288728-288740）
     *   给东西 g（`*label_2748`，289262「どの方向に？」）
     *   关门 c（`*label_3004`，345579-345592「何を閉める？」）
     * 回调 cb(g, dx, dy) 自行结算。
     */
    startCmd(g, label, cb) {
      this.active = true;
      this.kind = 'cmd';
      this.cmdLabel = label || '';
      this.cmdCb = cb || null;
      this.itemIdx = -1;
      this.groundItem = null;
      this.allowSelf = false;
      this.allowEmpty = false;
      this.aid = 0;
      this.range = 1;
      this.lastResult = null;
      if (g) g.dirSel = { kind: 'cmd', label: this.cmdLabel };
      return { ok: true, kind: 'cmd', dirs: DIRS.slice() };
    },

    /** (dx, dy) → 小键盘方向号（1..9），供 `Actions.dig/bash` 这类按下标取方向的接口用 */
    keyOf(dx, dy) {
      const d = DIRS.filter((x) => x.dx === (dx | 0) && x.dy === (dy | 0))[0];
      return d ? d.key : 5;
    },

    /**
     * 使用道具的邻格指定 —— `*label_2893`（305110-305231）。
     *
     * 原版有两类用法，本项目都用这一档：
     *   ① 选**相邻的角色**（进化 360673、调味料 354575、梳妆台 350569 …）
     *      → 按方向键取该格角色，交给 `Game.useItem(idx, 0, { target })`
     *   ② 选**方向**（魔杖 315827「どの方向に振る？」）
     *      → `opts.allowEmpty`：格子空也继续，把 `{ dir }` 一并交给 useItem
     *
     * @param {object} [opts] { allowSelf: 允许回车=自己, allowEmpty: 空格也继续（魔杖） }
     */
    startItem(g, idx, range, groundItem, opts) {
      const o = opts || {};
      this.active = true;
      this.kind = 'item';
      this.itemIdx = idx | 0;
      this.groundItem = groundItem || null;
      this.allowSelf = !!o.allowSelf;
      this.allowEmpty = !!o.allowEmpty;
      this.passEmpty = !!o.passEmpty;
      this.aid = 0;
      this.range = Math.max(1, range | 0 || 1);
      this.lastResult = null;
      if (g) g.dirSel = { kind: 'item', idx: this.itemIdx, range: this.range };
      return { ok: true, kind: 'item', idx: this.itemIdx, range: this.range,
        allowSelf: this.allowSelf, passEmpty: this.passEmpty, dirs: DIRS.slice() };
    },

    /**
     * 「对自己」—— 原版准星按 Esc（`stat == 0`）时 `var_244` 保持 0 的语义。
     * 这里用回车 / 5 触发（Esc 仍是取消），只对 `allowSelf` 的效果有效。
     */
    commitSelf(g) {
      if (!this.active || !this.allowSelf) {
        return { ok: false, reason: 'no-self' };
      }
      const kind = this.kind;
      const aid0 = this.aid;
      this.active = false;
      g.dirSel = null;
      if (kind === 'ability') {
        // 0-EP：626 精神分析 —— 回车 = 对自己使用（`*label_2893` 的 var_244 保持 0）
        const ra = g.useAbility(aid0, { target: g.player, resume: true });
        this.lastResult = ra || null;
        return ra || { ok: false };
      }
      if (kind !== 'item') return { ok: false, reason: 'no-self' };
      const r = this.groundItem
        ? g.useGroundItem(this.groundItem, { target: g.player })
        : g.useItem(this.itemIdx, 0, { target: g.player });
      this.groundItem = null;
      this.lastResult = r || null;
      return r || { ok: false };
    },

    /** 供渲染层取箭头 */
    arrowCells(g) {
      if (!this.active || !g || !g.player) return [];
      const p = g.player;
      return DIRS.map((d) => ({ x: p.x + d.dx, y: p.y + d.dy, label: d.label, key: d.key }));
    },

    /** 按键 → 方向（小键盘 1..9 / 方向键 / WASD） */
    dirOfKey(key) {
      const table = {
        1: 1, 2: 2, 3: 3, 4: 4, 6: 6, 7: 7, 8: 8, 9: 9,
        ArrowLeft: 4, ArrowRight: 6, ArrowUp: 8, ArrowDown: 2,
        h: 4, l: 6, k: 8, j: 2, y: 7, u: 9, b: 1, n: 3,
        Home: 7, End: 3, PageUp: 9, PageDown: 1,
      };
      const k = table[key];
      if (k === undefined) return null;
      return DIRS.filter((d) => d.key === k)[0] || null;
    },

    /** 选方向并发动（原版按方向键即发动） */
    pick(g, key) {
      const d = this.dirOfKey(key);
      if (!d) return { ok: false, reason: 'bad-direction' };
      return this.commit(g, d.dx, d.dy);
    },

    commit(g, dx, dy) {
      const id = this.aid;
      if (!this.active) return { ok: false, reason: 'inactive' };
      this.active = false;
      g.dirSel = null;
      const p = g.player;
      const x = (p.x | 0) + (dx | 0);
      const y = (p.y | 0) + (dy | 0);
      const map = g.map;
      if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) {
        // 0-EP：邻格越界 = `*label_2893` 的 stat = 0（目标为空），交给效果本体
        if (this.kind === 'item' && this.passEmpty) {
          const dir0 = { dx: dx | 0, dy: dy | 0 };
          const rz = this.groundItem
            ? g.useGroundItem(this.groundItem, { target: null, dir: dir0 })
            : g.useItem(this.itemIdx, 0, { target: null, dir: dir0 });
          this.groundItem = null;
          this.lastResult = rz || null;
          return rz || { ok: false };
        }
        g.log('那里无法通行。');
        return { ok: false, reason: 'out_of_map' };
      }
      if (this.kind === 'spell') {
        const r2 = g.castPlayerSpell(id, { tile: { x, y } });
        this.lastResult = r2 || null;
        return r2 || { ok: false };
      }
      if (this.kind === 'cmd') {
        const fn = this.cmdCb;
        this.cmdCb = null;
        const r4 = fn ? (fn(g, dx | 0, dy | 0) || { ok: true }) : { ok: false };
        this.lastResult = r4 || null;
        return r4 || { ok: false };
      }
      if (this.kind === 'item') {
        const c = charaAt(g, x, y);
        const dir = { dx: dx | 0, dy: dy | 0 };
        // 360673：格子是空的 → `var_244` 不变 → 364067「それは無理だ。」/ 364077「仲間にしか使えない。」
        //   魔杖（allowEmpty）例外：方向本身就是目标（315827）。
        //   0-EP：passEmpty 时把 target = null 交给效果本体（它自己会打印「那是办不到的。」）
        if (!c && !this.allowEmpty && !this.passEmpty) {
          return { ok: false, reason: 'no-chara', message: '只能对同伴使用。' };
        }
        const tgt = c || (this.passEmpty ? null : undefined);
        const r3 = this.groundItem
          ? g.useGroundItem(this.groundItem, { target: tgt, dir })
          : g.useItem(this.itemIdx, 0, { target: tgt, dir });
        this.groundItem = null;
        this.lastResult = r3 || null;
        return r3 || { ok: false };
      }
      const c = charaAt(g, x, y);
      // 315683：有角色 → 对它发动；315679：空 → var_2421 = 1（对地面发动）
      // 0-EP：`resume: true` —— 目标选择在 SP 扣除之后，重入时不能再扣一次
      const r = c
        ? g.useAbility(id, { target: c, resume: true })
        : g.useAbility(id, { tile: { x, y }, resume: true });
      this.lastResult = r || null;
      return r || { ok: false };
    },

    cancel() {
      const was = this.active;
      this.active = false;
      this.aid = 0;
      this.itemIdx = -1;
      this.groundItem = null;
      this.allowSelf = false;
      this.allowEmpty = false;
      this.passEmpty = false;
      return { ok: was, reason: was ? 'cancelled' : 'inactive' };
    },
  };

  Elona.DirSel = DirSel;
})(window);
