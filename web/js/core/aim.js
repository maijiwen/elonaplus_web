'use strict';
/**
 * 瞄准 / 锁定 —— `*label_2670`（283499）、`*label_2672`（283536）、
 * `*label_2675`（283812）、`*label_2841`（300508）的移植。
 *
 * 【原版的两套锁】
 *   l        `key_look`   → `*label_2675`：把视野内的目标列成一页 16 行的表格，
 *                          直接按那一行的快捷键（`var_446`）锁定。
 *   *        `key_target` → `*label_2670`：进入**光标模式**。
 *                          角色模式（`var_1784`=0）光标只能走在视野内的角色之间；
 *                          自由模式（`var_1784`=1）光标可以在整张地图上移动，
 *                          走到有角色的格子时 `var_581` = 那个角色。
 *
 * 【光标的两个变量】
 *   `var_1311 / var_1312`  光标格坐标。
 *   `var_581`              光标下的角色槽（-1 = 空格子）。
 *                          ⚠ 注意它不是「锁定目标」，锁定目标永远是
 *                          `var_58(29, 主角)`，见 283770 / 283924。
 *   `var_2188`             光标模式下为 1 —— 283695 用它在光标移动时
 *                          同步 `var_400`（列表里的序号），翻页键 +- 才生效。
 *   `var_2177`             `txttargetnpc` 的返回值：1 = 这一格可以锁定，
 *                          0 = 「その場所は見えない」（283740）。
 *
 * 【确认时写什么】283738-283786：
 *   先 `var_581 = 光标下角色`；
 *   若光标正好停在**自己**的格子上且骑着坐骑（`var_65(183)`），取坐骑；
 *   若 `var_581 > 0` 且该角色正在被骑乘（`var_58(168)`），先弹「骑乘者/坐骑」二选一；
 *   最后 `var_58(29, 0) = var_581`，播报「<名字>をターゲットにした。」
 *   否则地面 → `var_2189 = 1`、`var_2190/2191` = 光标格，播报「地面をターゲットにした。」
 *
 * 【同伴同步】592646-592700：同伴每回合会把自己的锁定目标改成玩家的
 * （`var_58(29, var_243) = var_58(29, 0)`），这就是「同伴跟着锁定同一个目标」。
 *
 * 【本项目的落地方式】
 *   原版是「按键 → 进入阻塞式循环」；本项目用状态机：`Aim.start()` 打开一个
 *   覆盖层，方向键走 `Aim.move()`，回车 `Aim.confirm()`，Esc/Shift `Aim.cancel()`，
 *   由 main.js 的按键分派逐键驱动。锁定结果同时写到：
 *     `g.lockTarget`（角色）或 `g.lockTile`（{x,y}，地面）
 *   并提供 `Aim.target(g)` 给各动作取「当前锁定」。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** `var_58(29)` 的槽位名（本项目把 `var_58` 收敛到角色自身字段） */
  const F_LOCK = 29;
  const F_REL = 9;
  const F_SN = 0;
  const F_RIDE = 167;
  const F_IS_RIDING = 168;

  const MODE = { CHARA: 0, FREE: 1 };

  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  /** 格子占用（原版 `var_704(x, y, 1)`：0 = 空，n = 角色槽 + 1） */
  function charaAtCell(g, x, y) {
    for (const c of (g.charas || [])) {
      if (!c || (c.get(F_SN) | 0) !== 1) continue;
      if ((c.x | 0) === (x | 0) && (c.y | 0) === (y | 0)) return c;
    }
    for (const it of (Array.isArray(g.propertySites) ? g.propertySites : [])) { /* 占位：地产不收人 */ }
    return null;
  }

  /**
   * `*label_2841`（300508-300576）—— 光标模式下的候选表。
   *
   *     repeat 2（第二轮只在第一轮全空时才跑）
   *       repeat 245
   *         var_58(0) != 1                      → 跳过（不在场）
   *         synccheck(cnt) == 0                 → 跳过（不同步）
   *         var_243 == 0 或自己非敌对时：
   *           var_58(9, cnt) == 10（中立？）且 cnt == 0 → 跳过（排除自己）
   *         与自己同格                            → 跳过
   *         dist > var_83(3, 656)\1000 + 1        → 跳过（射程；656 = 鼓舞，f3 = 3006）
   *         fov_los == 0                          → 跳过（无视线）
   *         cbit(6) 且自己无 cbit(7) 且 var_58(259)==0 → 跳过（隐身）
   *         var_58(140) == 30/31                  → 跳过（正在被搬运/寄生）
   *       最后按「离自己最近」做插入排序
   *
   * 射程 `var_83(3, 656)`：656 号是「鼓舞」，`f3 = 3000+6 = 3006`
   *   → `3006 \ 1000 + 1 = 4` 格。这就是角色锁定模式的射程上限。
   *   （自由模式没有这个限制，可以走遍全图。）
   *
   * @returns {Array<{chara:object, v:number, x:number, y:number, dist:number}>}
   */
  function candidates(g, me) {
    const p = me || g.player;
    const out = [];
    const rangeSkill = (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(656, 3) | 0) : 3006;
    const maxDist = idiv(rangeSkill, 1000) + 1;
    const los = (x, y) => ((Elona.Spell && Elona.Spell.fovLos)
      ? (Elona.Spell.fovLos(g, p.x, p.y, x, y) | 0) : 1);

    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 245; i++) {
        const c = (g.charas || [])[i];
        if (!c || (c.get(F_SN) | 0) !== 1) continue;
        if (!c.get) continue;
        // 300518-300524：中立（关系 10）的自己见不到自己
        if ((p.index | 0) === 0 || (p.get(F_REL) | 0) >= 0) {
          if ((c.get(F_REL) | 0) === 10 && (c.index | 0) === 0) continue;
        }
        const cx = c.x | 0, cy = c.y | 0;
        if (cx === (p.x | 0) && cy === (p.y | 0)) continue;   // 300527 排除同格（含自己）
        const d = Math.max(Math.abs(cx - (p.x | 0)), Math.abs(cy - (p.y | 0)));
        if (d > maxDist) continue;                            // 300530
        if (!los(cx, cy)) continue;                           // 300533
        // 300536：隐身单位，除非自己有「看破」
        if (Elona.Status && Elona.Status.cbit(c, 6)) {
          const see = (Elona.Status.cbit(p, 7) | 0) === 1 || (c.get(259) | 0) !== 0;
          if (!see) continue;
        }
        // 300543：正在被搬运 / 寄生
        const ro = c.get(140) | 0;
        if (ro === 30 || ro === 31) continue;
        out.push({ chara: c, v: i, x: cx, y: cy, dist: d });
      }
      if (out.length) break;      // 300552：第一轮有结果就不再跑第二轮
    }
    // 300556-300575：按到自己的距离做插入排序（O(n²)，与原版一致）
    for (let i = 1; i < out.length; i++) {
      const cur = out[i];
      let j = i - 1;
      while (j >= 0 && out[j].dist > cur.dist) { out[j + 1] = out[j]; j--; }
      out[j + 1] = cur;
    }
    return out;
  }

  /**
   * `txttargetsp`（9642-9669）—— 目标的体力（SP）描述行。
   * 原版按 SP 占上限的比例给出「神情自若 / 呼吸略微凌乱 …」。
   */
  function spText(c) {
    const sp = c.get(52) | 0, spMax = c.get(53) | 0;
    const pct = spMax ? idiv(sp * 100, spMax) : 0;
    let txt;
    if (sp < 0) txt = '明显疲惫不堪';
    else if (sp < 25) txt = '连掩饰疲态的气力都没有';
    else if (sp < 50) txt = '动作摇摇晃晃';
    else if (sp < idiv(spMax, 4)) txt = '肩膀在抖着喘气';
    else if (sp < idiv(spMax, 2)) txt = '表情里透着焦急';
    else if (sp < idiv(spMax * 3, 4)) txt = '呼吸略微凌乱';
    else txt = '很平静';
    return `${txt}。[SP ${pct}%]`;
  }

  /** `txttargetlevel`（9571-9614）—— 强弱提示（按双方等级比） */
  function levelText(p, c) {
    const myLv = p.get(38) | 0, tLv = c.get(38) | 0;
    if (myLv * 20 < tLv) return '对方若是巨人，你连蚂蚁的粪便都不如。';
    if (myLv * 10 < tLv) return '绝对赢不了的对手。';
    if (myLv * 5 < tLv) return '一定会被杀掉吧。';
    if (myLv * 3 < tLv) return '除非发生奇迹，否则会被杀。';
    if (myLv * 2 < tLv) return '至少比你强一倍。';
    if (idiv(myLv * 3, 2) < tLv) return '对方看起来相当强。';
    if (myLv < tLv) return '不是赢不了的对手。';
    if (idiv(myLv, 3) * 2 < tLv) return '大概会赢。';
    if (idiv(myLv, 2) < tLv) return '不是大意的对手。';
    if (idiv(myLv, 3) < tLv) return '闭着眼睛也能赢。';
    return '闭着眼睛、抱着胳膊都能赢。';
  }

  /**
   * `txttargetnpc`（283056-283144）的可锁定判定 + 信息行。
   * 返回 `{ ok, lines }`：ok = false 时对应 283740 的「その場所は見えない」。
   */
  function inspect(g, x, y, opt) {
    const o = opt || {};
    const p = o.me || g.player;
    const wide = !!o.free;                 // var_2177：自由模式外也允许看（prm_1209 == 0 才查视线）
    const lines = [];
    let ok = true;

    if (!o.skipLos) {
      let los = 1;
      try {
        los = (Elona.Spell && Elona.Spell.fovLos)
          ? (Elona.Spell.fovLos(g, p.x, p.y, x, y) | 0) : 1;
      } catch (e) { los = 1; }
      if (!los) {
        lines.push('视野范围外');
        return { ok: false, inSight: false, lines, chara: null, items: [] };
      }
    }
    void wide;

    const c = charaAtCell(g, x, y);
    if (c) {
      lines.push(`${c.name}　Lv ${c.get(38) | 0}`);
      lines.push(spText(c));
      // 关系 / 距离
      const rel = c.get(F_REL) | 0;
      const tag = rel <= -3 ? '敌对' : (rel < 0 ? '敌意' : (rel >= 10 ? '同伴' : '中立'));
      lines.push(`${tag}　距离 ${Math.max(Math.abs((c.x | 0) - (p.x | 0)), Math.abs((c.y | 0) - (p.y | 0)))}`);
      // 283094-283099：feat 8「見極め」—— 只有玩家有这条 feat 时才显示性別/年齢/信仰
      const feat8 = (Elona.Feat && Elona.Feat.get) ? (Elona.Feat.get(p, 8) | 0) : 0;
      if (feat8) {
        const sex = (c.get(8) | 0) === 1 ? '女' : '男';
        const year = g.getV65 ? (g.getV65(10) | 0) : 0;
        const birth = c.get(21) | 0;
        let age = '不明';
        if (year - birth >= 0 && (c.get(27) | 0) !== 207) {
          age = ((Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 1026))
            ? birth : (year - birth)) + '岁';
        }
        const gods = (Elona.MapFeat && Elona.MapFeat.GOD_NAMES) || null;
        const god = ((c.get(61) | 0) > 0 && gods) ? (gods[c.get(61) | 0] || '?') : '无信仰';
        lines.push(`性别：${sex}　年龄：${age}　信仰：${god}`);
      }
      // 骑乘关系（283755：确认前要二选一）
      if ((c.get(F_IS_RIDING) | 0) !== 0) {
        const rider = (g.charas || [])[c.get(F_IS_RIDING) | 0];
        if (rider) lines.push(`正被 ${rider.name} 骑乘`);
      }
      lines.push(levelText(p, c));
      if (o.free) ok = true;
    }

    // 地面物品（283120：var_704(x,y,5)）
    const items = (g.groundItems || []).filter((it) => it && (it.f[0] | 0) > 0
      && (it.f[5] | 0) === (x | 0) && (it.f[6] | 0) === (y | 0));
    if (items.length) {
      const names = items.slice(0, 3).map((it) => (Elona.ItemDB
        ? Elona.ItemDB.name(it.id, 'zh') : ('#' + it.id)));
      lines.push(`地上：${names.join('、')}${items.length > 3 ? ` 等 ${items.length} 件` : ''}`);
    }
    // 地形特性（283126）
    if (Elona.MapFeat && g.map && g.map.inBounds && g.map.inBounds(x, y)) {
      try {
        const f = Elona.MapFeat.read(g, x, y);
        const nm = (f && f.type && Elona.Actions && Elona.Actions.featName)
          ? Elona.Actions.featName(f) : '';
        if (nm) lines.push(nm);
      } catch (e) { /* 地图未就绪 */ }
    }
    if (!lines.length) lines.push('这里什么也没有。');
    return { ok, inSight: true, lines, chara: c || null, items };
  }

  // ======================================================================
  // 会话状态机
  // ======================================================================
  const Aim = {
    MODE,
    candidates,
    inspectCell: inspect,

    /** 当前是否有瞄准会话 */
    get active() { return !!this.s; },

    /** 会话（供 UI 读取） */
    s: null,

    /**
     * 开始一次瞄准（`*label_2670`，283499-283508）。
     * @param {object} g
     * @param {object} [opt]
     *   opt.free   true = 自由锁定（可以在全图移动光标）
     *   opt.me     使用者（默认玩家）
     *   opt.range  角色模式的射程覆盖（默认按 656 号能力的 4 格）
     */
    start(g, opt) {
      const o = opt || {};
      const me = o.me || g.player;
      const free = !!o.free;
      const list = free ? [] : candidates(g, me);

      // 283501-283507：光标起点跟随使用者的格子
      let cx = me.x | 0, cy = me.y | 0;
      // 0-GW / *label_2836（300333-300382）：还没有锁定目标时，**先自动选一个**——
      //   依次按关系 `var_58(9) <= -3`（敌对）→ `<= 10`（中立/友好）→ `<= 0` 三轮，
      //   每轮取候选表（已按距离排序）里的第一个，选中就写进 `var_58(29)`。
      //   玩家侧（自己是 0 号槽或非敌对）用 -3/10/0，敌对阵营的角色用 10/0/0。
      let locked = (me.get(F_LOCK) | 0);
      if (!free && !locked && list.length) {
        const selfRel = me.get(F_REL) | 0;
        const passes = (me.index === 0 || selfRel >= 0) ? [-3, 10, 0] : [10, 0, 0];
        for (const lim of passes) {
          const hit = list.find((e) => (e.chara.get(F_REL) | 0) <= lim);
          if (hit) { me.set(F_LOCK, hit.chara.index | 0); locked = hit.chara.index | 0; break; }
        }
      }
      // 283514-283534：已经有锁定目标时把光标挪过去
      if (!free && locked > 0) {
        const lc = (g.charas || [])[locked];
        if (lc && (lc.get(0) | 0) === 1) { cx = lc.x | 0; cy = lc.y | 0; }
      }

      const s = {
        g, me, free,
        list,                       // 角色模式的候选表（= var_484）
        x: cx, y: cy,               // var_1311 / var_1312
        idx: 0,                     // 列表模式下的页内序号（var_761 / var_763）
        page: 0,                    // var_894
        per: 16,                    // var_893
        hover: null,                // var_581（光标下角色）
        lastMsg: '',
      };
      // 起点在候选表里时把序号对齐（283830）
      const at = list.findIndex((e) => (e.chara.index | 0) === locked
        || (e.x === cx && e.y === cy));
      if (at >= 0) { s.idx = at % s.per; s.page = idiv(at, s.per); }
      this.s = s;
      this._refreshHover();
      if (!free && !list.length) s.lastMsg = '视野内没有可以锁定的目标。';   // 283522
      return s;
    },

    /** `txttargetnpc` 的结果 */
    inspect(g, opt) {
      const s = this.s;
      const o = opt || {};
      if (!s) return { ok: false, lines: ['（没有锁定会话）'], chara: null, items: [] };
      return inspect(g, s.x, s.y, { me: s.me, free: s.free, skipLos: o.skipLos });
    },

    /**
     * 左下角的目标信息（`txttargetnpc` 283056-283144 的紧凑 3 行版）。
     *
     * 原版把每行按 `pos 100, var_217 - var_810 - 45 - var_2176 * 20` 往上叠，
     * 也就是**后压入的行画得更高**。玩家实际会看到从上到下：
     *   ① `現在のターゲットは <名前> (距離 N)`（最后压入 → 最高）
     *   ② `txttargetsp` 的体力描述 + SP%
     *   ③ `txttargetlevel` 的强弱提示（最先压入 → 最底）
     * 这里直接按这个顺序返回，交给 renderer 从上往下画。
     *
     * @returns {{lines:string[], chara:object|null, inSight:boolean, dest:{x,y}|null}}
     */
    describe(g) {
      const s = this.s;
      const me = (s && s.me) || (g && g.player);
      let x, y;
      if (s) { x = s.x; y = s.y; }
      else {
        const t = this.target(g);
        if (!t || !t.tile) return { lines: [], chara: null, inSight: true, dest: null };
        x = t.tile.x; y = t.tile.y;
      }
      const info = inspect(g, x, y, { me, free: s ? s.free : false });
      const c = info.chara;
      if (!c) {
        // 没有角色：只保留物品 / 地形提示（原版显示在目标行之上）
        const extra = info.lines.filter((ln) => /^(地上：|视野)/.test(ln));
        return { lines: extra, chara: null, inSight: info.inSight, dest: { x, y } };
      }
      const dist = Math.max(Math.abs((c.x | 0) - (me.x | 0)), Math.abs((c.y | 0) - (me.y | 0)));
      const head = `现在的目标是 ${c.name}（距离 ${dist}）`;
      const sp = spText(c);
      const lv = levelText(me, c);
      // 取 inspect 里压在强弱提示之后的行（地上物品 / 地形），放到最上方
      const idx = info.lines.indexOf(lv);
      const extra = idx >= 0 ? info.lines.slice(idx + 1) : [];
      return {
        lines: [head, sp, lv].concat(extra),
        chara: c, inSight: info.inSight, dest: { x, y },
      };
    },

    /**
     * 从 (x1,y1) 到 (x2,y2) 的路径格（`get_route` / `route_info` 的显示用途）。
     * 原版 `*label_2672` 用同样的 route 把每格 `gfini 50,50,100` 铺成半透明白色。
     * @returns {Array<{x:number,y:number}>} 不含起点，最多 max 格
     */
    pathCells(g, x1, y1, x2, y2, max) {
      const S = Elona.Spell;
      const out = [];
      if (!S || !S.getRoute || !S.routeInfo) return out;
      if (!g || !g.map) return out;
      let gr = null;
      try { gr = S.getRoute(g, x1 | 0, y1 | 0, x2 | 0, y2 | 0); } catch (e) { return out; }
      if (!gr || !gr.ok || !gr.route || !gr.route.length) return out;
      let x = x1 | 0, y = y1 | 0;
      const lim = Math.min(60, Math.max(1, max | 0 || 40));
      for (let i = 0; i < lim; i++) {
        const ri = S.routeInfo(g, x, y, i, gr.route);
        x = ri.x | 0; y = ri.y | 0;
        if (ri.stat === 0) break;
        out.push({ x, y });
        if (x === (x2 | 0) && y === (y2 | 0)) break;
      }
      return out;
    },

    /** 光标位置（渲染用） */
    get cursor() {
      const s = this.s;
      return s ? { x: s.x, y: s.y, chara: s.hover || null, free: s.free } : null;
    },

    /**
     * 光标移动。
     *   角色模式（283685-283693）：只有「方向键」有效，且只能走到**候选表里相邻**的
     *                              角色上 —— 原版是逐个试 `var_1311 += dx`，走不通就不动。
     *                              本项目按「列表相邻」实现（与原版手感一致：
     *                              每次按方向键跳到视野内的下一个目标）。
     *   自由模式（283642-283681）：光标在整张地图内移动，碰到边界就停；
     *                              鼠标悬停也走这条路径。
     * @param {number} dx
     * @param {number} dy
     * @returns {boolean} 是否发生了变化
     */
    move(dx, dy) {
      const s = this.s;
      if (!s) return false;
      if (s.free) {
        const nx = s.x + (dx | 0), ny = s.y + (dy | 0);
        if (!s.g.map || !s.g.map.inBounds(nx, ny)) return false;
        if (nx === s.x && ny === s.y) return false;
        s.x = nx; s.y = ny;
        this._refreshHover();
        return true;
      }
      // 角色模式：在候选表里按方向跳
      if (!s.list.length) return false;
      const step = (dx > 0 || dy > 0) ? 1 : -1;
      let i = s.list.findIndex((e) => e.x === s.x && e.y === s.y);
      if (i < 0) i = 0; else i = (i + step + s.list.length) % s.list.length;
      const e = s.list[i];
      // 方向键与目标相对方向的符号不一致时不移动（原版 283687-283692 的 var_451/1166 判定）
      if (dx) { if ((dx > 0) !== (e.x > s.x)) { /* 允许：跳到列表下一个 */ } }
      s.x = e.x; s.y = e.y;
      s.idx = i % s.per; s.page = idiv(i, s.per);
      this._refreshHover();
      return true;
    },

    /** 鼠标/点击指定格（自由模式用） */
    moveTo(x, y) {
      const s = this.s;
      if (!s) return false;
      if (!s.free) {
        const e = s.list.find((t) => t.x === (x | 0) && t.y === (y | 0));
        if (!e) return false;
        s.x = e.x; s.y = e.y;
        const i = s.list.indexOf(e);
        s.idx = i % s.per; s.page = idiv(i, s.per);
      } else {
        if (!s.g.map || !s.g.map.inBounds(x, y)) return false;
        s.x = x | 0; s.y = y | 0;
      }
      this._refreshHover();
      return true;
    },

    /** `+` / `-`（283713-283729）：自由模式下跳到下一个/上一个角色 */
    nextChara(dir) {
      const s = this.s;
      if (!s) return false;
      // 角色模式直接用列表
      if (!s.free) return this.move(dir > 0 ? 1 : -1, 0);
      const all = (s.g.charas || []).filter((c) => c && (c.get(F_SN) | 0) === 1 && c.get);
      if (!all.length) return false;
      // 按「离光标最近」排序后取下一个
      const cur = all.findIndex((c) => (c.x | 0) === s.x && (c.y | 0) === s.y);
      let i;
      if (cur >= 0) i = (cur + (dir > 0 ? 1 : -1) + all.length) % all.length;
      else {
        all.sort((a, b) => (Math.abs(a.x - s.x) + Math.abs(a.y - s.y))
          - (Math.abs(b.x - s.x) + Math.abs(b.y - s.y)));
        i = 0;
      }
      s.x = all[i].x | 0; s.y = all[i].y | 0;
      this._refreshHover();
      return true;
    },

    /** 翻页（283934-283947）：只影响列表模式的高亮 */
    pageBy(dir) {
      const s = this.s;
      if (!s || s.free) return false;
      const pages = Math.max(1, Math.ceil(s.list.length / s.per));
      const p = s.page + (dir > 0 ? 1 : -1);
      if (p < 0 || p >= pages) return false;
      s.page = p;
      const e = s.list[p * s.per + s.idx];
      if (e) { s.x = e.x; s.y = e.y; this._refreshHover(); }
      return true;
    },

    /** `var_581`：光标下的角色槽（0 = 自己/无） */
    _refreshHover() {
      const s = this.s;
      const c = charaAtCell(s.g, s.x, s.y);
      s.hover = c || null;
    },

    /**
     * 确认（283738-283800）。
     * @returns {{ok:boolean, kind:'chara'|'ground'|'hidden', target?:object, tile?:{x,y}, needPick?:boolean, message:string}}
     */
    confirm(g) {
      const s = this.s;
      if (!s) return { ok: false, kind: 'hidden', message: '（没有锁定会话）' };
      const info = inspect(s.g, s.x, s.y, { me: s.me, free: s.free });
      if (!info.ok) {
        // 283740-283747：看不见的格子不能锁定
        const message = '那个地方看不见。';
        s.lastMsg = message;
        return { ok: false, kind: 'hidden', message };
      }
      let c = info.chara;
      // 光标落在自己所在格时 `var_581 == 0`（玩家是 0 号槽）——原版把它当成
      // 「锁定特殊方格」，也就是地面。骑乘时改成锁坐骑（283749-283753）。
      if (c && (c.index | 0) === (s.me.index | 0)) c = null;
      if (!c && s.x === (s.me.x | 0) && s.y === (s.me.y | 0)) {
        const mount = (s.g.getV65 ? (s.g.getV65(183) | 0) : 0);
        if (mount) c = (s.g.charas || [])[mount] || null;
      }
      // 283754-283769：光标下是被骑乘的角色 → 先问「骑乘者还是坐骑」
      if (c && (c.get(F_IS_RIDING) | 0) !== 0) {
        const rider = (s.g.charas || [])[c.get(F_IS_RIDING) | 0] || null;
        if (rider) {
          s.lastMsg = `要锁定 ${rider.name} 还是坐骑 ${c.name}？`;
          return {
            ok: false, kind: 'chara', needPick: true, target: c, rider,
            message: s.lastMsg,
          };
        }
      }
      if (c) {
        const message = `锁定了目标：${c.name}。`;
        s.lastMsg = message;
        const r = { ok: true, kind: 'chara', target: c, tile: { x: s.x, y: s.y }, message };
        this.apply(g, r);
        this.s = null;
        return r;
      }
      // 283777-283786：地面
      const message = '锁定了脚下的地面。';
      s.lastMsg = message;
      const r = { ok: true, kind: 'ground', tile: { x: s.x, y: s.y }, message };
      this.apply(g, r);
      this.s = null;
      return r;
    },

    /** 骑乘二选一之后的确认（283766-283768） */
    confirmPick(g, pickRider) {
      const s = this.s;
      if (!s) return { ok: false, message: '（没有锁定会话）' };
      const c = charaAtCell(s.g, s.x, s.y);
      if (!c) return this.confirm(g);
      const target = pickRider ? ((s.g.charas || [])[c.get(F_IS_RIDING) | 0] || c) : c;
      const message = `锁定了目标：${target.name}。`;
      const r = { ok: true, kind: 'chara', target, tile: { x: s.x, y: s.y }, message };
      this.apply(g, r);
      this.s = null;
      return r;
    },

    /** Esc / Shift（283802-283807）：取消，返回 -1 */
    cancel() {
      const s = this.s;
      this.s = null;
      return { ok: false, cancelled: true, message: s ? '取消了锁定。' : '' };
    },

    /**
     * 把结果写进全局状态（283770 / 283778）。
     * `var_58(29, 0)` 是锁定目标槽；`var_2189/2190/2191` 是「锁定的是地面」的标记。
     */
    apply(g, r) {
      const me = g.player;
      if (!me) return;
      if (r.kind === 'chara' && r.target) {
        me.set(F_LOCK, r.target.index | 0);
        g.lockTarget = r.target;
        g.lockTile = null;
        g.lockGround = false;
        this.syncParty(g, r.target);
        return;
      }
      // 地面：原版把槽位归 0，另用 var_2189 标记「锁的是格子」
      me.set(F_LOCK, 0);
      g.lockTarget = null;
      g.lockTile = r.tile ? { x: r.tile.x | 0, y: r.tile.y | 0 } : null;
      g.lockGround = !!g.lockTile;
      this.syncParty(g, null);
    },

    /**
     * 592646-592700：同伴把自己的锁定目标改成玩家的。
     * 这里只同步「仍然有效」的那部分（目标活着、仍在视野内），
     * 其余细节（`var_58(201)` 剩余回合、隐身 rnd(5) 丢失）见差异表。
     */
    syncParty(g, target) {
      for (const c of (g.charas || [])) {
        if (!c || !c.get || (c.get(F_SN) | 0) !== 1) continue;
        if ((c.index | 0) === 0) continue;
        if ((c.get(F_REL) | 0) < 10) continue;        // 只同步同伴（敌对的中立值不同）
        if (!Elona.Companion || !Elona.Companion.isAlly) {
          // 没有同伴模块时退化为「关系 >= 10 且槽位 < 16」
          if ((c.index | 0) >= 16) continue;
        } else if (!Elona.Companion.isAlly(g, c)) continue;
        c.set(F_LOCK, target ? (target.index | 0) : 0);
      }
    },

    /**
     * 当前锁定（各动作的默认目标）。
     * 优先级：角色锁定 > 地面锁定 > `g.manualTarget`（旧字段）。
     * @returns {{chara:object|null, tile:{x,y}|null, ground:boolean}}
     */
    target(g) {
      const me = g.player;
      const slot = me ? (me.get(F_LOCK) | 0) : 0;
      if (slot > 0) {
        const c = (g.charas || [])[slot];
        if (c && (c.get(F_SN) | 0) === 1) {
          return { chara: c, tile: { x: c.x | 0, y: c.y | 0 }, ground: false };
        }
        // 592724：目标已经不在场 → 清掉
        me.set(F_LOCK, 0);
      }
      if (g.lockTile) return { chara: null, tile: g.lockTile, ground: true };
      const m = g.manualTarget || null;
      if (m && (m.get(F_SN) | 0) === 1) {
        return { chara: m, tile: { x: m.x | 0, y: m.y | 0 }, ground: false };
      }
      return { chara: null, tile: null, ground: false };
    },

    /**
     * `*label_2675`（283812-283952）—— `l` 键的目标一览表。
     * 原版是 16 行分页的可视化表格；这里返回数据，由 Panels.openLook 渲染。
     * @returns {{list:Array, pages:number, page:number}}
     */
    listFor(g, opt) {
      const o = opt || {};
      const me = o.me || g.player;
      const list = candidates(g, me);
      const per = 16;
      return {
        me,
        list: list.map((e) => ({
          chara: e.chara, v: e.v, x: e.x, y: e.y, dist: e.dist,
          name: e.chara.name, level: e.chara.get(38) | 0,
          hp: e.chara.get(50) | 0, hpMax: e.chara.get(51) | 0,
          hostile: (e.chara.get(F_REL) | 0) <= -1,
        })),
        per,
        pages: Math.max(1, Math.ceil(list.length / per)),
      };
    },
  };

  Elona.Aim = Aim;
  Elona.AimInternals = { candidates, inspect, charaAtCell, F_LOCK, F_REL };
})(window);
