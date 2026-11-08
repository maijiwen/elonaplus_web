'use strict';
/**
 * 「操作する対象の方向は？」 —— `*label_2749`（289330-289800）
 *
 * 【原版行为】
 *   城/地图内按 `key_interact`（默认 i）→
 *     289334  `txt_select "操作する対象の方向は？"`
 *     289337  `gosub *label_2893`（在玩家周围 8 格画方向箭头，等按键）
 *   方向键 → `*label_2893` 把光标移一格后 `return 1`（305215-305228）；
 *   回车（`var_144`）→ 光标停在玩家自己身上，`return 1`（305161-305166）；
 *   `stat == 0`（取消 / 光标回到自己）→「自身互动菜单」（289338-289346）。
 *   选定方向后：
 *     289347  `var_244 = var_704(x, y, 1)`（该格的角色，0 = 空）
 *     289348  空 → 提示「その方向には、操作できる対象はない。」后返回地图
 *     289357  `var_244 -= 1`（换成 chara 索引；玩家自己 → 0）
 *     289359+ 骑乘/被骑乘的二选一、立绘、然后是 56 项的互动菜单
 *   玩家自己（索引 0）时菜单只留下「立ち姿を変える / アイテム画像の付与 /
 *   タッグ編成 / 口調を変える / 名前をつける / 情報」这 6 项（289690-289733）。
 *
 * 【本项目】
 *   原版是阻塞循环；这里做成状态机，由 main.js 逐键驱动：
 *     `Interact.start(g)`          → 画 8 个箭头（renderer.drawDirArrows）
 *     方向键 / 小键盘 1..9          → `Interact.pick(g, key)` 结算该格的目标
 *     回车 / 空格 / 5               → `Interact.confirm(g)` → 自身互动菜单
 *     Esc                          → `Interact.cancel()`
 *   箭头绘制与能力的「どの方向？」（core/dirsel.js）共用同一套渲染。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 八方向（与 *label_2893 的小键盘顺序一致：左下起顺时针） */
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

  /** 该格的角色（原版 `var_704(x, y, 1)`：0 = 空；只认活着的） */
  function charaAt(g, x, y) {
    const cell = (g.map && g.map.cell) ? g.map.cell(x, y) : null;
    if (!cell || (cell[1] | 0) === 0) return null;
    const c = g.charas[(cell[1] | 0) - 1];
    return (c && (c.get(0) | 0) === 1) ? c : null;
  }

  const Interact = {
    active: false,
    /** 原版 289334 的提示语 */
    prompt: '要操作哪个方向？',
    DIRS,

    dirOfKey(key) {
      // 键位表与能力的「どの方向？」保持一致（core/dirsel.js）
      if (Elona.DirSel && Elona.DirSel.dirOfKey) {
        const d = Elona.DirSel.dirOfKey(key);
        if (d) return d;
      }
      const k = Number(key);
      return DIRS.filter((d) => d.key === k)[0] || null;
    },

    /** 供渲染层取箭头（renderer.drawDirArrows） */
    arrowCells(g) {
      if (!this.active || !g || !g.player) return [];
      const p = g.player;
      return DIRS.map((d) => ({ x: p.x + d.dx, y: p.y + d.dy, label: d.label, key: d.key }));
    },

    /** 进入方向选择（原版 289334-289337） */
    start(g) {
      this.active = true;
      this._g = g || null;
      if (g) g.interactSel = true;
      return { ok: true, prompt: this.prompt, dirs: DIRS.slice() };
    },

    cancel() {
      const was = this.active;
      this.active = false;
      if (this._g) this._g.interactSel = false;
      this._g = null;
      return { ok: was, reason: was ? 'cancelled' : 'inactive' };
    },

    /**
     * 选一个方向并结算（原版 305215-305228 + 289347-289357）。
     * @returns {{ok:boolean, action?:string, npc?:object, message?:string}}
     */
    pick(g, key) {
      const d = this.dirOfKey(key);
      if (!d) return { ok: false, reason: 'bad-direction' };
      if (!this.active) return { ok: false, reason: 'inactive' };
      this.active = false;
      if (g) g.interactSel = false;
      this._g = null;

      const p = g.player;
      const map = g.map;
      const x = (p.x | 0) + d.dx, y = (p.y | 0) + d.dy;
      const empty = { ok: false, reason: 'no-target', message: this.promptNoTarget() };
      if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return empty;

      const c = charaAt(g, x, y);
      if (!c) return empty;
      // 289359-289461：骑乘者 / 被骑乘者二选一。本项目把「骑」的双方都当作可操作对象，
      // 直接作用于该格角色（不弹二选一，登记 A395）。
      return { ok: true, action: 'chara', npc: c, dir: d };
    },

    /** 289342 / 289352：空格的提示（var_364） */
    promptNoTarget() {
      // 原版：var_364 = "その方向には、操作できる対象はない。"
      return '那个方向上没有可以操作的对象。';
    },

    /**
     * 回车 → 光标仍在玩家自己身上（305161-305166）→ 自身互动菜单
     * @returns {{ok:boolean, action:'self'}}
     */
    confirm(g) {
      const was = this.active;
      this.active = false;
      if (g) g.interactSel = false;
      this._g = null;
      return { ok: was, action: 'self' };
    },
  };

  Elona.Interact = Interact;
})(typeof window !== 'undefined' ? window : globalThis);
