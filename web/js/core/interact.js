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

  // ----------------------------------------------------------------------
  // A395：互动对象的立绘层（289359-289421）
  //
  // 原版在「方向确定之后、互动菜单之前」画两张 300×500 的立绘：
  //   289363-289380  被选中者的立绘，`pos var_216 - 300, var_217 - 588`
  //                   （168 == 0 → 右半边；否则左半边）
  //   289390-289408  若被选中者有坐骑（167 > 0），坐骑的立绘固定画在左半边
  // 素材路径 `\user\graphic2\face<431>_<表情>.bmp`（用户自定义立绘）。
  // `var_58(431)` 由互动菜单「口調を変える」(27) → *label_2797 设置，
  // 默认 0 表示没有立绘（原版全程不画）。
  // ----------------------------------------------------------------------
  /** 立绘目录（300×500 BMP） */
  const FACE_DIR = 'assets/user/graphic2/';
  const FACE_W = 300;
  const FACE_H = 500;
  /** 800×600 画面里 `var_217 - 588` = 12 */
  const FACE_Y = 12;
  /** `var_216 - 300` */
  const FACE_RIGHT_X = 500;

  /**
   * 表情后缀 —— 289363-289380 的六个 if **依次覆盖**，顺序不能换：
   *   `var_58(79)` = 动作编号 + 100 × 类别，源码用取余 `\ 100` 取动作编号；
   *   `var_58(264) > 0`（睡眠/倒下）与 HP < 最大 HP 的一半 → _E。
   * @returns {string|null} 例如 face1_B.bmp
   */
  function faceFile(c) {
    const id = c.get(431) | 0;
    if (id <= 0) return null;
    const act = (c.get(79) | 0) % 100;
    let suf = 'B';
    if (act === 18 || (c.get(264) | 0) > 0) suf = 'A';
    if (act === 21) suf = 'Q';
    if (act === 6) suf = 'F';
    if (act === 17) suf = 'H';
    if ((c.get(50) | 0) < (c.get(51) | 0) / 2 || act === 26) suf = 'E';
    return `face${id}_${suf}.bmp`;
  }

  /** 一张立绘的位置；没有立绘（431 == 0）时返回 null */
  function faceAt(c) {
    const file = faceFile(c);
    if (!file) return null;
    return {
      file,
      // 289363-289380：168==0 画右半边，否则画左半边
      x: (c.get(168) | 0) === 0 ? FACE_RIGHT_X : 0,
      y: FACE_Y,
      w: FACE_W,
      h: FACE_H,
    };
  }

  /** 搭档立绘的位置 —— 289390-289408 固定画在右半边（var_216 - 300） */
  function partnerFaceAt(c) {
    const f = faceAt(c);
    if (!f) return null;
    return { file: f.file, x: FACE_RIGHT_X, y: FACE_Y, w: FACE_W, h: FACE_H };
  }

  /**
   * 0-Z1：组队搭档索引。本模块保持自包含（不依赖 core/companion.js 是否已加载）：
   *   168==0 表示没有搭档；tag_end 把 167 复位为 -1，0 也可能是「玩家当搭档」。
   */
  function partnerIndexOf(c) {
    if (!c || (c.get(168) | 0) === 0) return -1;
    return c.get(167) | 0;
  }

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
    /** A395：当前要画的立绘（renderer.drawFaceLayer 读取） */
    faces: [],

    /** 立绘文件名（供立绘选择界面预览；见 faceFile） */
    faceFile,

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
      this.faces = [];
      this._g = g || null;
      if (g) g.interactSel = true;
      return { ok: true, prompt: this.prompt, dirs: DIRS.slice() };
    },

    /**
     * A395：计算要显示的两张立绘（289363-289421）。
     * 只在 `var_58(431) > 0` 时才有内容 —— 原版同样是「用户放了立绘素材
     * 并用互动菜单设过编号」才画得出来。
     * 0-Z1：`var_58(167)` 是**组队搭档**（不是坐骑）；搭档立绘固定画右半边。
     * @param {object} g
     * @param {object} c 被选中的角色
     */
    showFaces(g, c) {
      const list = [];
      const own = c ? faceAt(c) : null;
      if (own) list.push(own);
      const pi = partnerIndexOf(c);
      const partner = (pi >= 0 && g && g.charas) ? (g.charas[pi] || null) : null;
      if (partner) {
        const f = partnerFaceAt(partner);
        if (f) list.push(f);
      }
      this.faces = list;
      return list;
    },

    clearFaces() {
      this.faces = [];
    },

    cancel() {
      const was = this.active;
      this.active = false;
      this.faces = [];
      if (this._g) this._g.interactSel = false;
      this._g = null;
      return { ok: was, reason: was ? 'cancelled' : 'inactive' };
    },

    /**
     * 选一个方向并结算（原版 305215-305228 + 289347-289357）。
     * @returns {{ok:boolean, action?:string, npc?:object, mount?:object, message?:string}}
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
      // 0-Z1：289359-289421 的双立绘 + 289443 的 `txtselecttc 2`。
      //   `var_58(167,c) > 0` 是**组队搭档**（坐骑另用 var_65(183)），
      //   此时弹「タッグ左側 / タッグ右側」成员选择窗；选右侧时
      //   `var_244 = var_58(167, var_244)` 换成搭档，再开操作弹窗。
      this.showFaces(g, c);
      const pi = partnerIndexOf(c);
      const partner = (pi >= 0 && g.charas) ? (g.charas[pi] || null) : null;
      return { ok: true, action: 'chara', npc: c, dir: d, partner };
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
      this.faces = [];
      if (g) g.interactSel = false;
      this._g = null;
      return { ok: was, action: 'self' };
    },
  };

  Elona.Interact = Interact;
})(typeof window !== 'undefined' ? window : globalThis);
