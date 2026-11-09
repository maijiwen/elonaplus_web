'use strict';
/**
 * 玩家动作层 —— 原版配置键里「尚未实现」的探索/物品动作。
 *
 * 每个动作都注明来源（start.hsp 标签 + 行号）。凡是由源码直接确认的，注释写
 * 【已确认】；凡是原版依赖本项目尚未移植的子系统、只能按上下文近似的，写
 * 【推断】并在 docs/01-dev-progress.md 的差异表中登记。
 *
 * 动作与按键的对应关系见 core/keys.js（键名取自 original/config.txt），
 * 按键 → 分派标签的提取结果见 docs/03-keymap.md。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // 角色行动的 var_58 字段（与 Game.eatFood 一致）
  const F_ROWACT = 140;      // 行动类别：1=进食 3=睡眠 4=休息 9=挖掘 107/108=收容所劳动
  const F_ROWLEFT = 141;     // 剩余回合
  const F_ROWARG = 142;      // 附加参数

  /**
   * 0-FX：原版持续行动（rowact）全表。
   *
   * 名称取自 var_366（9145 / 9153 的日/英两份表），起点取自
   * 「var_58(140, var_243) = N」的赋值处，每回合分派在 604652-604800。
   * 玩家在 var_58(140) != 0 期间不能操作，只有 var_58(141) 减到 0
   * （且中途没被 label_2844 中断）才执行完成结算。
   *
   * owner 标明由哪个模块接管每回合逻辑；'generic' = 由本文件的通用倒计时处理。
   */
  const ROWACT_DEFS = {
    1: { name: '进食', src: '313508 *label_2944', turns: 8, owner: 'Game.advanceEating' },
    2: { name: '读书', src: '313738 *label_2947', turns: null, owner: 'generic → Game.completeRowAct' },
    3: { name: '睡眠', src: '312427 *label_2937', turns: 20, owner: 'Actions.finishSleep' },
    4: { name: '休息', src: '312365 *label_2936', turns: 50, owner: 'Actions.tickRowAct' },
    5: { name: '採掘（挖矿/挖墙）', src: '313126 *label_2943', turns: 40, owner: 'generic' },
    6: { name: '演奏', src: '306514 *label_2912', turns: 121, owner: 'Perform.tick' },
    7: { name: '钓鱼', src: '312799 *label_2940', turns: null, owner: 'Fishing.tick' },
    8: { name: '採取（采集点）', src: '312985 *label_2941', turns: 40, owner: 'generic' },
    9: { name: '探索（挖采集点）', src: '313008 *label_2942', turns: 20, owner: 'Actions.finishDig' },
    10: { name: '偷窃 / 建设 / 训练', src: '311082 *label_2932', turns: null, owner: 'Game.tickSteal / Camp' },
    11: { name: '脱衣', src: '309874 *label_2929', turns: 25, owner: 'Intimacy.tick' },
    12: { name: '調合', src: '281753 *label_2659', turns: null, owner: 'generic' },
    13: { name: '蓄力', src: '308014 *label_2917', turns: null, owner: 'BuffAct.chargeTick' },
    14: { name: '伐採', src: '（由 10 号分支转入）', turns: null, owner: 'generic' },
    15: { name: '説法', src: '307632 *label_2916', turns: null, owner: 'Preach.tick' },
    16: { name: '分食（料理篮）', src: '309681 *label_2926', turns: 20, owner: 'Social.tick' },
    17: { name: '舞蹈', src: '307099 *label_2914', turns: null, owner: 'Perform.danceTick' },
    18: { name: '分食（蛋糕）', src: '309831 *label_2928', turns: 20, owner: 'Social.tick' },
    19: { name: '説得', src: '308477 *label_2921', turns: 5, owner: 'Social.tick' },
    20: { name: 'ギャグ', src: '308724 *label_2922', turns: 5, owner: 'Social.tick' },
    21: { name: '嘘', src: '308962 *label_2923', turns: 5, owner: 'Social.tick' },
    22: { name: '脅迫', src: '309224 *label_2924', turns: 5, owner: 'Social.tick' },
    23: { name: '歌', src: '309486 *label_2925', turns: 5, owner: 'Social.tick' },
    24: { name: '行为', src: '310708 *label_2931', turns: 11, owner: 'Intimacy.tick' },
    25: { name: '執筆', src: '307072 *label_2913', turns: null, owner: 'Writing.writeTick' },
    26: { name: '仕事（打工）', src: '350477 *label_2927', turns: 100, owner: 'generic' },
    27: { name: '仕事（打工）', src: '350481 *label_2927', turns: 100, owner: 'generic' },
    28: { name: '仕事（打工）', src: '350485 *label_2927', turns: 100, owner: 'generic' },
    29: { name: '物乞い（乞讨）', src: '307386 *label_2915', turns: null, owner: 'generic' },
    30: { name: '飛跳殺法', src: '308104 *label_2918', turns: 5, owner: 'Social.finish' },
    31: { name: '奇襲穿孔', src: '308176 *label_2919', turns: 10, owner: 'Social.finish' },
    32: { name: '脱衣', src: '310317 *label_2930', turns: 25, owner: 'Intimacy.tick' },
    33: { name: '応援', src: '308286 *label_2920', turns: 5, owner: 'Social.tick' },
    107: { name: '收容所劳动', src: '358394 *label_2932', turns: 21, owner: 'Camp.workTick' },
    108: { name: '收容所劳动', src: '358394 *label_2932', turns: 61, owner: 'Camp.workTick' },
  };

  /**
   * 0-FY：中断规则表（604590-604640）。
   *   源码 `var_58(143,0) == 1`（有按键输入）时：
   *     · 140 属于 {17 舞, 1 食事, 2 読書, 3 睡眠, 25 執筆} → gosub *label_2844
   *       弹「○○を中断したほうがいいだろうか？」的 y/n 确认；
   *     · 其余类型 → var_444 = 0，直接中断，不问；
   *     · 13 蓄力 / 16·18 特殊进食 → 604609 明确排除，**不允许中断**；
   *     · 带 buff 65 且 140 属于 {19,20,21,22,23,33} → var_444 = 2，
   *       「この行動は中断できない」（也不中断）。
   *   0-FX 之前本项目把所有 rowact 一律直接中断且没有例外，这里按源码补齐。
   */
  const CONFIRM_INTERRUPT = [1, 2, 3, 17, 25];
  const NO_INTERRUPT = [13, 16, 18];
  const BUFF_PROTECTED = [19, 20, 21, 22, 23, 33];

  const DIRS = {
    1: [-1, 1], 2: [0, 1], 3: [1, 1], 4: [-1, 0], 5: [0, 0],
    6: [1, 0], 7: [-1, -1], 8: [0, -1], 9: [1, -1],
  };

  const Actions = {
    DIRS,
    ROWACT_DEFS,
    F_ROWACT, F_ROWLEFT, F_ROWARG,

    /** var_366 的行动名（中断提示用） */
    rowactName(type) {
      const d = ROWACT_DEFS[type | 0];
      return d ? d.name : '行动';
    },
    defOf(type) { return ROWACT_DEFS[type | 0] || null; },

    /**
     * 0-FX：通用「开始一个持续行动」。
     * 写 var_58(140/141/142)，把完成结算需要的上下文挂到 g.rowActPayload。
     * 原版在 label_2844 里问「要中断吗？」；本项目把「任何新动作」都视为中断，
     * 由 Game.movePlayer / Game.useItem / Game.attack 等入口调 interrupt()。
     */
    begin(g, type, turns, payload) {
      const p = g && g.player;
      if (!p) return { ok: false, reason: 'no-player' };
      if ((p.get(F_ROWACT) | 0) !== 0) {
        return { ok: false, reason: 'busy', message: '你正忙着别的事情。' };
      }
      p.set(F_ROWACT, type | 0);
      p.set(F_ROWLEFT, Math.max(1, turns | 0));
      p.set(F_ROWARG, 0);
      g.rowActPayload = payload || null;
      return { ok: true, type: type | 0, turns: Math.max(1, turns | 0) };
    },

    CONFIRM_INTERRUPT, NO_INTERRUPT, BUFF_PROTECTED,

    /** 中断当前持续行动（不执行完成结算） */
    interrupt(g, why) {
      const p = g && g.player;
      if (!p || (p.get(F_ROWACT) | 0) === 0) return { ok: false };
      const type = p.get(F_ROWACT) | 0;
      p.set(F_ROWACT, 0); p.set(F_ROWLEFT, 0); p.set(F_ROWARG, 0);
      g.rowActPayload = null;
      return { ok: true, type, why: why || 'action', name: this.rowactName(type) };
    },

    /**
     * 0-FY：按 604590-604609 判断「现在这次输入能不能中断当前行动」。
     * @returns {{ok:boolean, reason?:string, confirm:boolean, type:number, name:string}}
     */
    canInterrupt(g) {
      const p = g && g.player;
      const type = p ? (p.get(F_ROWACT) | 0) : 0;
      const name = this.rowactName(type);
      if (!type) return { ok: false, reason: 'idle', confirm: false, type, name };
      if (NO_INTERRUPT.indexOf(type) >= 0) {
        return { ok: false, reason: 'no-interrupt', confirm: false, type, name };
      }
      if (BUFF_PROTECTED.indexOf(type) >= 0 && Elona.Status && Elona.Status.findbuff) {
        try {
          if (Elona.Status.findbuff(p, 65) >= 0) {
            return { ok: false, reason: 'buff', confirm: false, type, name };
          }
        } catch (e) { /* 状态模块缺失时按无 buff 处理 */ }
      }
      return { ok: true, confirm: CONFIRM_INTERRUPT.indexOf(type) >= 0, type, name };
    },

    /**
     * 请求中断 —— 核心层不依赖视图层。
     * 视图层注入 `Elona.rowactInterruptConfirm(g, name, done)`（main.js → Panels.openConfirm）；
     * 没有注入时（node 测试 / 无 UI 的自动化）同步按「确认 = 是」处理，保持旧行为。
     * @param {function} [done] 收到最终中断结果；取消时 {ok:false, reason:'cancel'}
     */
    requestInterrupt(g, why, done) {
      const chk = this.canInterrupt(g);
      if (!chk.ok) { if (done) done(chk); return chk; }
      const finish = (yes) => {
        const r = yes
          ? this.interrupt(g, why || 'action')
          : { ok: false, reason: 'cancel', type: chk.type, name: chk.name };
        if (done) done(r);
      };
      if (chk.confirm && typeof Elona.rowactInterruptConfirm === 'function') {
        Elona.rowactInterruptConfirm(g, chk.name, finish);
        return { ok: true, pending: true, confirm: true, type: chk.type, name: chk.name };
      }
      finish(true);
      // 同步中断时把结果一起返回，方便调用方判断
      return Object.assign({ ok: true, pending: false, confirm: chk.confirm,
        type: chk.type, name: chk.name }, { result: (g.player.get(F_ROWACT) | 0) === 0 });
    },

    /**
     * 0-FY：NPC 的 rowact 中断（604606-604640）。
     * 源码输出「<名字>は<行动>を中断した。」；13/16/18 同样豁免。
     */
    interruptChara(g, c, why) {
      if (!c || (c.get(F_ROWACT) | 0) === 0) return { ok: false };
      const type = c.get(F_ROWACT) | 0;
      if (NO_INTERRUPT.indexOf(type) >= 0) return { ok: false, reason: 'no-interrupt' };
      c.set(F_ROWACT, 0); c.set(F_ROWLEFT, 0); c.set(F_ROWARG, 0);
      const name = this.rowactName(type);
      if (g && g.log) g.log(`${c.name || '对方'}中断了${name}。`);
      return { ok: true, type, why: why || 'action', name, chara: c };
    },

    // ======================================================================
    // 通用小工具
    // ======================================================================

    /** 世界地图（var_126(6)==1）期间禁止绝大多数地图动作 —— 主循环各分支的公共前置 */
    onWorldMap(g) { return !!(g && g.worldMap) || (g.map && g.map.header && (g.map.header[6] | 0) === 1); },

    /** 面前格（按 g.facing：0=北 1=东 2=西 3=南，见 343484-343501） */
    frontCell(g) {
      const p = g.player;
      const FACE = [[0, -1], [1, 0], [-1, 0], [0, 1]];
      const d = FACE[g.facing | 0] || [0, 1];
      return { x: p.x + d[0], y: p.y + d[1], dx: d[0], dy: d[1] };
    },

    /** 视野内的角色（look / 手动目标用）。半径取 20，与原版索敌半径一致 */
    visibleCharas(g, radius) {
      const p = g.player;
      const r = radius || 20;
      const out = [];
      for (const c of g.charas) {
        if (!c || c === p || (c.get(0) | 0) !== 1) continue;
        const d = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
        if (d > r) continue;
        out.push({ chara: c, dist: d });
      }
      out.sort((a, b) => a.dist - b.dist);
      return out;
    },

    /** 该角色是否敌对（var_58(9) <= -1，343286-343311） */
    isHostile(c) { return !!c && (c.get(9) | 0) <= -1; },

    /**
     * 正在进行的行动是否允许新行动 —— 原版 rowact（var_58(140)!=0）时会先问
     * 「是否中断」（*label_2844）。这里直接拒绝，并给出提示。
     */
    busy(g) {
      const p = g.player;
      if ((p.get(F_ROWACT) | 0) !== 0) {
        g.log('你正忙着别的事情。');
        return true;
      }
      return false;
    },

    // ======================================================================
    // l —— 查看（*label_2675）
    // ======================================================================
    /**
     * 原版 key_look：先把视野内的目标列成表（var_46 = "com_target" 的画面），
     * 没有目标时提示 "You look around and find nothing."（283824）。
     * 本实现把目标表交给表现层面板渲染（view/panels.js 的 openLook）。
     */
    look(g) {
      const targets = [];
      for (const t of this.visibleCharas(g, 20)) {
        const c = t.chara;
        targets.push({
          kind: 'chara', name: c.name, dist: t.dist, x: c.x, y: c.y,
          hostile: this.isHostile(c), hp: c.hp | 0, hpMax: c.hpMax | 0, level: c.level | 0,
          title: (Elona.NPC && Elona.NPC.roleName) ? Elona.NPC.roleName(Elona.NPC.roleOf(c)) : '',
        });
      }
      // 地面物品与地形特性也一并列出（原版 look 的目标表同样包含这些对象）
      const p = g.player;
      for (const it of g.groundItems) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        const d = Math.max(Math.abs(it.f[5] - p.x), Math.abs(it.f[6] - p.y));
        if (d > 20) continue;
        targets.push({
          kind: 'item', name: Elona.ItemDB.name(it.id, 'en'), dist: d,
          x: it.f[5], y: it.f[6], count: it.f[0] | 0,
        });
      }
      if (Elona.MapFeat) {
        for (let y = p.y - 8; y <= p.y + 8; y++) {
          for (let x = p.x - 8; x <= p.x + 8; x++) {
            if (!g.map || !g.map.inBounds(x, y)) continue;
            const f = Elona.MapFeat.read(g, x, y);
            if (!f || !f.type) continue;
            if (f.type === Elona.MapFeat.TYPE.TRAP && f.id !== Elona.MapFeat.DISCOVERED) continue; // 未发现的陷阱不可见
            const name = this.featName(f);
            if (!name) continue;
            targets.push({
              kind: 'feat', name, dist: Math.max(Math.abs(x - p.x), Math.abs(y - p.y)), x, y,
            });
          }
        }
      }
      targets.sort((a, b) => a.dist - b.dist);
      if (!targets.length) {
        g.log('你环视四周，什么也没有发现。');   // 283824
        g.endTurn();
        return { ok: false, reason: 'nothing', targets };
      }
      g.log('你环视四周，仔细查看周围的情况。');
      return { ok: true, targets };
    },

    /** 地形特性 → 显示名（仅列已确认可在画面上看到的类别） */
    featName(f) {
      const T = Elona.MapFeat.TYPE;
      switch (f.type) {
        case T.STAIRS_UP: return '上楼的楼梯';
        case T.STAIRS_DOWN: return '下楼的楼梯';
        case T.TRAP: return f.id === Elona.MapFeat.DISCOVERED ? '陷阱' : '';
        case T.DOOR_OPEN: return '开着的门';
        case T.DOOR_CLOSED: return '关着的门';
        case T.BOARD: return '掲示板';
        case T.MINE: return '矿脉';
        case T.SPRING: return '泉';
        case T.REMAINS: return '遗迹';
        case T.PLANT: return '植物';
        case T.MEDAL: return '小徽章';
        default: return '';
      }
    },

    // ======================================================================
    // s —— 搜索（*label_3009，348054-348232）
    // ======================================================================
    /**
     * 【已确认】流程（348074-348231）：
     *   1. 搜索次数 var_237++，提示 "You search the surroundings carefully."
     *   2. 遍历周围格子：
     *      - 陷阱（type 14）：*label_2218 侦测成功 → cell_featset(id=234) + "You discover a trap."
     *      - 隐藏通路（type 22）：侦测成功 → *label_3011（改成可通行）+ "You discover a hidden path."
     *      - 小徽章（type 32）：站在其上 → 变物品 622 + "You find a small coin!"
     *                             不在其上 → "You sense something." / "You see something shines."
     *   3. 站在已发现陷阱上 → *label_2910 解除
     *   4. 脚下的矿脉/泉/遗迹/植物（type 24..28）→ 转入对应的 rowact（挖掘等）
     * 【推断】扫描半径：源码用固定矩形窗口遍历，本实现取切比雪夫半径 6。
     */
    search(g) {
      if (this.onWorldMap(g)) { g.log('在世界地图上无法搜索。'); return { ok: false }; }
      if (this.busy(g)) return { ok: false };
      const p = g.player;
      const M = Elona.MapFeat;
      if (!M) return { ok: false };
      p.set(237, (p.get(237) | 0) + 1);
      g.log('你仔细地搜索了周围。');

      const R = 6;
      const found = [];
      for (let y = p.y - R; y <= p.y + R; y++) {
        for (let x = p.x - R; x <= p.x + R; x++) {
          if (!g.map.inBounds(x, y)) continue;
          const f = M.read(g, x, y);
          if (f.type === M.TYPE.TRAP && f.id !== 0 && f.id !== M.DISCOVERED) {
            if (M.detect(g, p)) {
              M.reveal(g, x, y);
              found.push({ kind: 'trap', x, y });
              g.log('你发现了陷阱。');                       // 348154
              if (Elona.Stats && Elona.Stats.skillExp && p.get(0) === 1) {
                Elona.Stats.skillExp(p, 159, p.index, 30, 9999, 0, g);   // 探知技能经验（*label_2218 后）
              }
            }
          } else if (f.type === M.TYPE.HIDDEN) {
            if (M.detect(g, p)) {
              // *label_3011：把隐藏通路改成普通地板（图块 33）
              const cell = g.map.cell(x, y);
              if (cell) { cell[0] = 33; cell[6] = 0; }
              found.push({ kind: 'hidden', x, y });
              g.log('你发现了隐藏的通路。');                 // 348166
            }
          } else if (f.type === M.TYPE.MEDAL) {
            if (x === p.x && y === p.y) {
              M.clear(g, x, y);
              if (Elona.ItemDB) {
                const it = Elona.ItemDB.createItem(622, 1);
                if (it) {
                  it.f[5] = p.x; it.f[6] = p.y; it.f[21] = -1;
                  g.groundItems.push(it);
                  g.refreshGroundCell(p.x, p.y);
                }
              }
              found.push({ kind: 'medal', x, y });
              g.log('你找到了一枚小徽章！');                 // 348178
            } else {
              const d = Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
              g.log(d > 2 ? '这附近似乎藏着什么……' : '你看到什么东西在闪光。');
            }
          }
        }
      }

      // 站在已发现的陷阱上 → 解除（348206-348213）
      const here = M.read(g, p.x, p.y);
      if (here.type === M.TYPE.TRAP && here.id === M.DISCOVERED) {
        if (M.disarm(g, p, here)) {
          M.disarmed(g, p, p.x, p.y, here);
          g.log('你解除了陷阱。');
          found.push({ kind: 'disarmed', x: p.x, y: p.y });
          if (Elona.Quest) {
            const tr = Elona.Quest.onTrapDisarmed && Elona.Quest.onTrapDisarmed(g, here);
            if (tr) g.log(`委托进度：${Elona.Quest.progressText(g, tr.quest)}` + (tr.completed ? '（可以报告了）' : ''));
          }
        } else {
          g.log('解除陷阱失败了。');
        }
      }

      g.endTurn();
      return { ok: true, found };
    },

    // ======================================================================
    // D —— 挖掘（*label_2736 → *label_2942，312997-3130xx）
    // ======================================================================
    /**
     * 【已确认】可挖条件（288716）：
     *   目标格 `attr(7, tile) & 4` 必须非 0（即被阻挡的墙/岩石），
     *   且 `attr(0, tile) != 3`、不能在世界地图、不能在特定地图类型上。
     * 【已确认】rowact：var_58(140)=9、var_58(141)=20（313007-313009）。
     * 【已确认】每回合：`var_58(26,chara) \ 5 == 0` 时输出 "*カキン*" 等拟声（313028-313036）。
     * 【已确认】完成时检查背包/地面 id=621 的埋藏物（313044-313060）。
     * 【推断】挖穿后的地形处理：源码把挖开的格子交给 cell_refresh / map 重建，
     *   本实现把该格图块改写为地板 33（与随机迷宫的地板图块一致）。
     */
    dig(g, dir) {
      if (this.onWorldMap(g)) { g.log('在世界地图上无法挖掘。'); return { ok: false }; }
      if (this.busy(g)) return { ok: false };
      const p = g.player;
      const d = DIRS[dir || 8] || [0, -1];
      // 未指定方向时用面朝方向
      const dx = dir ? d[0] : this.frontCell(g).dx;
      const dy = dir ? d[1] : this.frontCell(g).dy;
      const tx = p.x + dx, ty = p.y + dy;
      if (!g.map.inBounds(tx, ty)) { g.log('那里挖不到。'); return { ok: false }; }
      const cell = g.map.cell(tx, ty);
      const blocked = (g.map.attr(cell[0], 7) & 4) !== 0;
      const kind = g.map.attr(cell[0], 0);
      if (!blocked || kind === 3) { g.log('那里不需要挖掘。'); return { ok: false }; }  // 288716

      p.set(F_ROWACT, 9);
      p.set(F_ROWLEFT, 20);
      p.set(F_ROWARG, ty * 1000 + tx);          // 记录挖掘目标格
      g.log('你开始挖掘。');                     // 313014
      g.endTurn();
      return { ok: true, started: true, turns: 20, target: { x: tx, y: ty } };
    },

    // ======================================================================
    // b —— 撞墙 / 撞树（*label_2737 → *label_2987，342624-342682）
    // ======================================================================
    /**
     * 【已确认】*label_2987 的顺序：
     *   1. 目标格有地面物品且 id=526（果树）：count-- ，掉落 f[26] 的果实；
     *      count<=0 时把该物品改成 592（枯树）（342625-342661）。
     *   2. 目标格有地面物品且 id=578（树）：数量 -1 并掉落 id=54（木材）（342664-342682）。
     *   3. 目标格有角色 → 攻击（走 *label_3006）。
     * 【推断】关着的门：原版由 *label_2991 的开锁/破坏分支处理，本实现直接调用
     *   MapFeat.openDoor（其内部已含开锁判定）。
     */
    bash(g, dir) {
      if (this.onWorldMap(g)) { g.log('在世界地图上无法这么做。'); return { ok: false }; }
      if (this.busy(g)) return { ok: false };
      const p = g.player;
      const d = dir ? (DIRS[dir] || [0, 1]) : [this.frontCell(g).dx, this.frontCell(g).dy];
      const tx = p.x + d[0], ty = p.y + d[1];
      if (!g.map.inBounds(tx, ty)) { g.log('那里什么也没有。'); return { ok: false }; }

      // 1) 目标格的角色 → 直接攻击
      const chk = g.map.check(tx, ty);
      if (chk.charaIndex >= 0) {
        const target = g.charas[chk.charaIndex];
        if (target && target !== p) {
          g.log(`你向 ${target.name} 撞了过去。`);
          g.attackTarget(target);
          return { ok: true, action: 'attack' };
        }
      }

      // 2) 果树 / 树（342625-342682）
      const ground = g.groundItems.filter((it) => it && (it.f[0] | 0) > 0 && it.f[5] === tx && it.f[6] === ty);
      const tree = ground.find((it) => it.id === 526);
      if (tree) {
        g.log(`你撞向了 ${Elona.ItemDB.name(tree.id, 'en')}。`);
        if ((tree.f[25] | 0) <= 0) { g.log('树上似乎已经没有果实了。'); g.endTurn(); return { ok: true }; }
        tree.f[25] = (tree.f[25] | 0) - 1;
        if ((tree.f[25] | 0) <= 0) {
          tree.id = 592;                                   // 342646：变成枯树
          g.refreshGroundCell(tx, ty);
        }
        const fruit = Elona.ItemDB.createItem(tree.f[26] | 0, 1);
        if (fruit) {
          // 342649-342652：若下方格可通行，果实落在下方一格
          let fy = ty;
          if (g.map.inBounds(tx, ty + 1) && g.map.walkable(tx, ty + 1)) fy = ty + 1;
          fruit.f[5] = tx; fruit.f[6] = fy;
          fruit.f[21] = -1;
          g.groundItems.push(fruit);
          g.refreshGroundCell(fruit.f[5], fruit.f[6]);
          g.log(`${Elona.ItemDB.name(fruit.id, 'en')} 掉了下来。`);
        }
        g.endTurn();
        return { ok: true, action: 'tree' };
      }
      const tree2 = ground.find((it) => it.id === 578);
      if (tree2) {
        const n = tree2.f[25] | 0;
        g.log(`你撞向了 ${Elona.ItemDB.name(tree2.id, 'en')}。`);
        tree2.f[0] = (tree2.f[0] | 0) - 1;
        tree2.f[25] = Math.max(0, n - 1);
        const wood = Elona.ItemDB.createItem(54, Math.max(1, n));
        if (wood) {
          wood.f[5] = p.x; wood.f[6] = p.y; wood.f[21] = -1;
          g.groundItems.push(wood);
          g.refreshGroundCell(p.x, p.y);
          g.log(`${Elona.ItemDB.name(wood.id, 'en')} 掉了下来。`);
        }
        if ((tree2.f[0] | 0) <= 0) g.removeGroundItem(tree2);
        g.endTurn();
        return { ok: true, action: 'tree' };
      }

      // 3) 门
      const M = Elona.MapFeat;
      if (M) {
        const f = M.read(g, tx, ty);
        if (f.type === M.TYPE.DOOR_CLOSED) {
          const r = M.openDoor(g, p, tx, ty);
          g.log(r.ok ? (r.locked ? '你硬撞开了门。' : '你撞开了门。') : '门纹丝不动。');
          g.endTurn();
          return { ok: !!r.ok, action: 'door' };
        }
      }
      g.log('你撞了个空。');
      g.endTurn();
      return { ok: false, reason: 'nothing' };
    },

    // ======================================================================
    // R —— 休息（*label_2843 → var_691=50 → *label_2936，312363-312424）
    // ======================================================================
    /**
     * 【已确认】起始（312364-312373）：var_58(140)=4、var_58(141)=50、"You lie down to rest."
     * 【已确认】每回合（312375-312394）对**所有活跃角色**：
     *   - 睡意 var_58(60)：>0 时 -2；减到 100 或 99 时归 0；
     *   - `var_58(141) \ 2 == 0`（剩余回合为偶数）→ healsp 1；
     *   - `var_58(141) \ 3 == 0`（剩余回合为 3 的倍数）→ healhp 1 + healmp 1。
     * 【已确认】结束（312418-312423）："You finished taking a rest."
     * 【推断】中断：原版在怪物靠近时由主循环打断 rowact，这里在敌人 3 格内时中断。
     */
    rest(g) {
      if (this.onWorldMap(g)) { g.log('在世界地图上无法休息。'); return { ok: false }; }
      if (this.busy(g)) return { ok: false };
      const p = g.player;
      p.set(F_ROWACT, 4);
      p.set(F_ROWLEFT, 50);
      g.log('你躺下开始休息。');
      g.endTurn();
      return { ok: true, started: true, turns: 50 };
    },

    /** 每回合推进 rowact（由 Game.endTurn 调用） */
    /**
     * 0-GC：非玩家角色的持续行动推进。
     *   源码 604690-604760 的分派是对 `var_243` 逐个跑的，NPC 也有自己的
     *   `var_58(140/141)`；本项目把 19-23 / 30 / 31 / 33 / 16 / 18 交给
     *   `core/social.js`，其余类型 NPC 不参与，直接返回 null。
     * @returns {object|null} 本回合结果
     */
    tickChara(g, c) {
      if (!c || (c.get(0) | 0) !== 1) return null;
      const type = c.get(140) | 0;
      if (!type) return null;
      // 0-GD：脱衣 / 行為 —— NPC 侧同样逐回合推进，完成段双方一起收尾
      if (Elona.Intimacy && Elona.Intimacy.manages(type)) {
        const left = c.get(141) | 0;
        if (left <= 0) {
          const r = Elona.Intimacy.finishFor(g, c, type);
          return { type, intimacy: r, finished: true };
        }
        const r = Elona.Intimacy.tickFor(g, c, type, left);
        c.set(141, Math.max(0, left - 1));
        return { type, left: left - 1, intimacy: r };
      }
      if (!Elona.Social || !Elona.Social.manages(type)) return null;
      const left = c.get(141) | 0;
      if (left <= 0) {
        const payload = c.rowActPayload || null;
        c.set(140, 0); c.set(141, 0); c.set(142, 0);
        c.rowActPayload = null;
        return Elona.Social.finishFor(g, c, type, payload);
      }
      const r = Elona.Social.tickFor(g, c, type, left);
      c.set(141, Math.max(0, left - 1));
      return { type, left: left - 1, social: r };
    },

    tickRowAct(g) {
      const p = g.player;
      if (!p || (p.hp | 0) <= 0) return null;
      const type = p.get(F_ROWACT) | 0;
      // 6 = 演奏（604779-604781 → *label_2912），逻辑全在 core/perform.js
      if (type === 6 && Elona.Perform && Elona.Perform.tick) {
        const r = Elona.Perform.tick(g);
        if (r) for (const m of (r.messages || [])) g.log(m);
        return r;
      }
      // 7 = 钓鱼（604655-604657 → *label_2940），逻辑全在 core/fishing.js
      if (type === 7 && Elona.Fishing && Elona.Fishing.tick) {
        const r = Elona.Fishing.tick(g);
        if (r) for (const m of (r.messages || [])) g.log(m);
        return r;
      }
      // 10 = 偷窃（604751-604776 → *label_2932 var_65(91)==105，0-CP）
      //   0-FY：同一个 10 号也用于 101 建设 / 104 训练（*label_2932 的其它分支）。
      //   这类 payload 带 campMode，跳过偷窃逻辑、落到下面的通用倒计时。
      if (type === 10 && !(g.rowActPayload && g.rowActPayload.campMode) && g.tickSteal) {
        const r = g.tickSteal();
        if (r && r.message) g.log(r.message);
        return r;
      }
      // 13 = 充填（604692-604696 → *label_2917，0-EI）：剩余回合先 -1（604684），再判定蓄力完成
      if (type === 13 && Elona.BuffAct) {
        p.set(F_ROWLEFT, Math.max(0, (p.get(F_ROWLEFT) | 0) - 1));
        const r = Elona.BuffAct.chargeTick(g, p);
        if (r) return r;
      }
      // 15 = 説法（604783-604786 → *label_2916，0-EA）：逻辑在 core/preach.js
      if (type === 15 && Elona.Preach && Elona.Preach.tick) {
        const r = Elona.Preach.tick(g);
        if (r) return r;
      }
      // 17 = 舞蹈（604791-604794 → *label_2914，0-ED）：逻辑在 core/perform.js
      if (type === 17 && Elona.Perform && Elona.Perform.danceTick) {
        const r = Elona.Perform.danceTick(g);
        if (r) return r;
      }
      // 25 = 写作（350119 → *label_2913，0-DN）：逻辑在 core/writing.js
      if (type === 25 && Elona.Writing && Elona.Writing.writeTick) {
        const r = Elona.Writing.writeTick(g);
        if (r) {
          if (r.finished) g.log('你写完了。');
          else if (r.produced) g.log('你写好了一份稿件。');
        }
        return r;
      }
      // 107 / 108 = 收容所劳动（358394-358425 → *label_2932 var_65(91)==107/108，0-DB）
      if ((type === 107 || type === 108) && Elona.Camp && Elona.Camp.workTick) {
        const left = p.get(F_ROWLEFT) | 0;
        if (left <= 0) {
          // 311698-311706：结束时提示当前劳动能量
          const st = Elona.Camp.readState(g);
          g.log(`あなたは労働を終えた。[現在の労働エナジー：${st ? st.toilEnergy : 0}]`
            + `（你结束了劳动。当前劳动能量 ${st ? st.toilEnergy : 0}）`);
          p.set(F_ROWACT, 0); p.set(F_ROWLEFT, 0); p.set(F_ROWARG, 0);
          return { finished: true, type };
        }
        const r = Elona.Camp.workTick(g, type);
        p.set(F_ROWLEFT, left - 1);
        return { type, left: left - 1, toilEnergy: r ? r.toilEnergy : 0 };
      }
      // 0-GC：特技型持续行动（19-23 社交 / 33 応援 / 30·31 跳跃系 / 16·18 分食）
      //   源码 604709-604729 / 604745-604753 的 gosub 分派，逻辑在 core/social.js。
      if ((type >= 19 && type <= 23) || type === 33 || type === 30 || type === 31
        || type === 16 || type === 18) {
        if (Elona.Social) {
          const sr = Elona.Social.tick(g, type, g.rowActPayload);
          if (sr) {
            p.set(F_ROWLEFT, Math.max(0, (p.get(F_ROWLEFT) | 0) - 1));
            return { type, left: p.get(F_ROWLEFT) | 0, social: sr };
          }
        }
      }
      // 0-GD：脱衣 / 行為（*label_2929/2930/2931）—— 成对行动，完成段在
      //   core/intimacy.js 内部收尾（双方同时 rowactend），不走通用倒计时。
      if ((type === 11 || type === 24 || type === 32) && Elona.Intimacy) {
        const ir = Elona.Intimacy.tick(g, type, g.rowActPayload);
        if (ir && ir.done) return { finished: true, type, result: ir };
        if (ir) {
          p.set(F_ROWLEFT, Math.max(0, (p.get(F_ROWLEFT) | 0) - 1));
          return { type, left: p.get(F_ROWLEFT) | 0, intimacy: ir };
        }
      }
      // 0-FX：通用倒计时 —— 上表 owner='generic' 的活动（读书/采集/挖矿/调合/
      //   打工/乞讨/NPC 特技…）都走这里。left 减到 0 才把控制权交给
      //   Game.completeRowAct 做完成结算；中途被 interrupt() 清掉就不会到达。
      if (type !== 1 && type !== 3 && type !== 4 && type !== 9 && ROWACT_DEFS[type]) {
        const left = p.get(F_ROWLEFT) | 0;
        if (left <= 0) {
          const payload = g.rowActPayload || null;
          p.set(F_ROWACT, 0); p.set(F_ROWLEFT, 0); p.set(F_ROWARG, 0);
          g.rowActPayload = null;
          const done = g.completeRowAct ? g.completeRowAct(type, payload) : null;
          return { finished: true, type, result: done };
        }
        // 0-GB：打工 26-28 / 乞讨 29 的每回合判定（*label_2927 / *label_2915）。
        //   只有 left > 0 才会走到这里；Work.tick 返回 interrupted 时直接收尾，
        //   避免下面的通用倒计时把已经清掉的 var_58(141) 又写回去。
        if (type >= 26 && type <= 29 && Elona.Work && Elona.Work.tick) {
          const wr = Elona.Work.tick(g, type, g.rowActPayload);
          if (wr && wr.interrupted) {
            return { interrupted: true, type, reason: wr.reason || 'work' };
          }
        }
        // 0-FY：持续行动的每回合演出。
        //   313032-313045（*label_2942/2943）每 5 回合一次「*ざくっ*」，
        //   281760-281769（*label_2659）调合每回合 1/30「*こねこね*」。
        if ((type === 5 || type === 8) && left % 5 === 0 && g.log) {
          const fx = [' *ざくっ* ', ' *カキン* ', ' *ごつっ* ', ' *じゃり* ', ' *♪* '];
          g.log(fx[g.rng ? g.rng.rnd(fx.length) : 0]);
        }
        if (type === 12 && g.log && g.rng && g.rng.rnd(30) === 0) {
          g.log(g.rng.rnd(2) === 0 ? ' *こねこね* ' : ' *トントン* ');
        }
        // 0-FY：*label_2947 期间每回合都要走一次 *label_2217（313770-313813），
        //   掷失败则 rowactend + 消耗一页，本次阅读不做完成结算。
        if (type === 2 && g.tickReading) {
          const rr = g.tickReading(g.rowActPayload);
          if (rr && rr.failed) {
            p.set(F_ROWACT, 0); p.set(F_ROWLEFT, 0); p.set(F_ROWARG, 0);
            g.rowActPayload = null;
            return { interrupted: true, type, reason: rr.reason || 'reading-failed' };
          }
        }
        p.set(F_ROWLEFT, left - 1);
        return { type, left: left - 1 };
      }
      if (type !== 3 && type !== 4 && type !== 9) return null;   // 1=进食由 advanceEating 处理
      const left = (p.get(F_ROWLEFT) | 0);

      if (left <= 0) {
        if (type === 4) g.log('你结束了休息。');                 // 312421
        else if (type === 3) this.finishSleep(g);                // 311809 *label_2935
        else if (type === 9) this.finishDig(g, p);
        if (type !== 3) { p.set(F_ROWACT, 0); p.set(F_ROWLEFT, 0); p.set(F_ROWARG, 0); }
        return { finished: true, type };
      }

      if (type === 4) {
        // 敌人靠近时中断（推断）
        const near = this.visibleCharas(g, 3).find((t) => this.isHostile(t.chara));
        if (near) {
          p.set(F_ROWACT, 0); p.set(F_ROWLEFT, 0);
          g.log(`附近有 ${near.chara.name}，你中断了休息。`);
          return { interrupted: true };
        }
        for (const c of g.charas) {
          if (!c || (c.get(0) | 0) !== 1) continue;
          let s = c.get(60) | 0;
          if (s > 0) {
            s -= 2;
            if (s === 100 || s === 99) s = 0;
            c.set(60, s);
          }
          if (Elona.Status) {
            if (left % 2 === 0) Elona.Status.healsp(c, 1);        // var_58(141) \ 2 == 0
            if (left % 3 === 0) {                                // var_58(141) \ 3 == 0
              Elona.Status.healhp(c, 1);
              Elona.Status.healmp(c, 1);
            }
          }
        }
      } else if (type === 3) {
        // 睡眠（312425-312455 进入，311845-311884 起床结算）。
        // 每回合恢复 HP/MP/SP：与休息同构，但原版睡眠不会被附近的敌人打断。
        if (Elona.Status) {
          Elona.Status.healhp(p, 1);
          if (left % 2 === 0) Elona.Status.healmp(p, 1);
        }
      } else if (type === 9) {
        // 每 5 回合一次拟声（313028-313036）
        if (left % 5 === 0) g.log(['*咔嘧*', '*砰*', '*咔嚓*', '*沙沙*'][g.rng.rnd(4)]);
        const near = this.visibleCharas(g, 2).find((t) => this.isHostile(t.chara));
        if (near) {
          p.set(F_ROWACT, 0); p.set(F_ROWLEFT, 0);
          g.log(`附近有 ${near.chara.name}，你停下了挖掘。`);
          return { interrupted: true };
        }
      }
      p.set(F_ROWLEFT, left - 1);
      return { type, left: left - 1 };
    },

    /**
     * 躺下睡觉 —— *label_2937（312425-312455）。
     *   基础 20 回合；按天气修正（var_65(17)：1 晴 ×0.5 / 2 雨 ×2.2 / 3 雪 ×1.3 / 4 豪雨 ×1.6）。
     *   在海上（地图 47）且有船/载具时再 ×2（312441-312450）。
     */
    startSleep(g, bedItem) {
      const p = g.player;
      if (!p) return { ok: false, message: '现在不能睡。' };
      if ((p.get(F_ROWACT) | 0) !== 0) {
        return { ok: false, reason: 'busy', message: '你正在做别的事情。' };
      }
      if (Elona.Status && Elona.Status.isHostileVisible) {
        const near = this.visibleCharas(g, 2).find((t) => this.isHostile(t.chara));
        if (near) {
          g.log(`附近有 ${near.chara.name}，睡不着。`);
          return { ok: false, reason: 'enemy', message: '附近有敌人，睡不着。' };
        }
      }
      let t = 20;                                  // 312428
      const w = g.getV65(17) | 0;                  // var_65(17) 天候
      if (w === 3) t = idiv(t * 13, 10);           // 312429-312431
      if (w === 4) t = idiv(t * 16, 10);           // 312432-312434
      if (w === 2) t = idiv(t * 22, 10);           // 312435-312437（雨天/地表水体）
      if (w === 1) t = idiv(t * 5, 10);            // 312438-312440
      if ((g.getV65(20) | 0) === 47) t *= 2;       // 312441-312450 海上
      p.set(F_ROWACT, 3);
      p.set(F_ROWLEFT, Math.max(5, t));
      p.set(F_ROWARG, 0);
      g.log(`你躺在${bedItem ? Elona.ItemDB.name(bedItem.id, 'en') : '地上'}睡着了。`);
      return { ok: true, turns: Math.max(5, t) };
    },

    /**
     * 起床结算 —— *label_2935 的 311845-311895 段。
     *   全体：清状态（var_58(250..259)）、HP/MP/SP 回满、幸福度归零、healcon 12、healsan 10；
     *   玩家：行動力 var_58(433,0) = 10；
     *   然后推进 7 + rnd(4) 小时（持有寝具 1094 时为 8 小时）。
     */
    finishSleep(g) {
      const p = g.player;
      for (const c of (g.charas || [])) {
        if (!c || (c.get(0) | 0) === 0) continue;
        for (let i = 250; i <= 259; i++) c.set(i, 0);
        c.set(445, 0);
        c.hp = Math.max(1, c.hpMax | 0);
        c.mp = Math.max(0, c.mpMax | 0);
        c.set(55, c.get(56) | 0);
        c.set(52, c.get(53) | 0);
        if (Elona.Status) {
          if (Elona.Status.healcon) Elona.Status.healcon(c, 12, 7 + g.rng.rnd(7));
          if (Elona.Status.healsan) Elona.Status.healsan(c, 10);
          // 311866-311876：拒食症时呕吐计数 93 减 rnd(5)+1，否则减 rnd(2)+1；
          // 减到 <=0 时 cure_anorexia（清 cbit 986）并把计数归零。
          const sick = Elona.Status.cbit ? !!Elona.Status.cbit(c, 986) : false;
          const v93 = (c.get(93) | 0) - (sick ? (g.rng.rnd(5) + 1) : (g.rng.rnd(2) + 1));
          c.set(93, v93);
          if (v93 <= 0) {
            if (Elona.Status.cureAnorexia) Elona.Status.cureAnorexia(g, c);
            c.set(93, 0);
          }
        }
      }
      if (Elona.Companion && Elona.Companion.onWake) Elona.Companion.onWake(g);
      else if (p) p.set(433, 10);
      // 时间推进（311886-311896）—— var_2395 = 7 + rnd(4)；持有寝具（1094）时为 8
      let hours = 7 + g.rng.rnd(4);
      const hasBedding = !!(g.player && (g.player.inv || []).some((it) => it && (it.f[0] | 0) > 0 && (it.id | 0) === 1094));
      if (hasBedding) hours = 8;
      if (g.advanceHours) g.advanceHours(hours);
      else for (let i = 0; i < hours; i++) if (g.advanceClock) g.advanceClock();
      if (p) { p.set(F_ROWACT, 0); p.set(F_ROWLEFT, 0); p.set(F_ROWARG, 0); }
      g.log(`你睡了一觉（${hours} 小时），精神恢复了。`);
      return { ok: true, hours };
    },

    /**
     * 收容所劳动（358394-358425 → *label_2932 var_65(91)==107/108）。
     * 使用劳动器具（1294 奴隷グルグル / 1293 奴隷バタバタ）在收容所内积累劳动能量。
     * @param {number} itemId 1294 / 1293
     */
    startWork(g, itemId) {
      if (!Elona.Camp || !Elona.Camp.workWithTool) return { ok: false };
      const r = Elona.Camp.workWithTool(g, itemId);
      if (!r.ok) { if (r.message) g.log(r.message); return r; }
      const p = g.player;
      p.set(F_ROWACT, r.mode);
      p.set(F_ROWLEFT, r.turns);
      p.set(F_ROWARG, r.mode);
      g.log(r.message);
      g.endTurn();
      return { ok: true, started: true, mode: r.mode, turns: r.turns };
    },

    /** 挖掘完成结算（*label_2942 完成段 313039-313481） */
    finishDig(g, p) {
      const arg = p.get(F_ROWARG) | 0;
      const tx = arg % 1000, ty = idiv(arg, 1000);
      g.log('你结束了挖掘。');
      if (!g.map.inBounds(tx, ty)) return { ok: false };
      const cell = g.map.cell(tx, ty);
      if ((g.map.attr(cell[0], 7) & 4) === 0) return { ok: false };
      // 挖穿：改成地板图块（推断值 33，与 generateDungeon 的地板一致）
      cell[0] = 33;
      g.refreshGroundCell(tx, ty);
      g.log('你挖穿了墙壁。');
      // 挖掘技能经验（原版 *label_2909 的经验分配，此处按动作次数给固定值）
      if (Elona.Stats && Elona.Stats.skillExp) {
        Elona.Stats.skillExp(p, 157, p.index, 60, 9999, 0, g);   // 157 = 採掘
      }
      // 0-FB：313448-313481 —— 按地城类型（var_126(6)）分表的挖墙掉落
      let drop = null;
      if (Elona.DungeonFx && Elona.DungeonFx.digDrop) {
        try { drop = Elona.DungeonFx.digDrop(g, tx, ty); } catch (_) { drop = null; }
        if (drop && drop.item) g.log('从碎石堆里找到了什么东西。');
      }
      return { ok: true, x: tx, y: ty, drop };
    },

    // ======================================================================
    // h —— 跳跃（*label_2842，300577-3006xx）
    // ======================================================================
    /**
     * 【已确认】**只朝面朝方向跳 2 格**（300591-300606 按 var_58(83) 计算目标格）。
     * 【已确认】世界地图上不可用（300578）。
     * 【已确认】目标格用 cell_check 判定，受阻则失败（300609+）。
     */
    hijump(g) {
      if (this.onWorldMap(g)) { g.log('在世界地图上无法跳跃。'); return { ok: false }; }
      if (this.busy(g)) return { ok: false };
      const p = g.player;
      const FACE = [[0, -1], [1, 0], [-1, 0], [0, 1]];
      const d = FACE[g.facing | 0] || [0, 1];
      const tx = p.x + d[0] * 2, ty = p.y + d[1] * 2;
      if (!g.map.inBounds(tx, ty) || !g.map.walkable(tx, ty)) {
        g.log('那里跳不过去。');
        return { ok: false, reason: 'blocked' };
      }
      p.x = tx; p.y = ty;
      g.syncCharaCells();
      g.log('你轻巧地跳了过去。');
      g.onEnterCell(p, tx, ty);
      g.endTurn();
      return { ok: true, x: tx, y: ty };
    },

    // ======================================================================
    // C —— 关门（*label_3004）
    // ======================================================================
    /** 【已确认】label_3004 = MapFeat.closeDoor（足元/面前的开着门）。 */
    closeDoor(g, dx, dy) {
      const M = Elona.MapFeat;
      if (!M) return { ok: false };
      const p = g.player;
      // 0-EO：原版 345579「何を閉める？」→ `*label_2893` 选一格关门。
      //   给了方向就只关那一格；没给则沿用旧行为（脚下 → 面前）。
      if (typeof dx === 'number' && typeof dy === 'number') {
        const tx = p.x + (dx | 0), ty = p.y + (dy | 0);
        if (!g.map.inBounds(tx, ty)) { g.log('那里没有门。'); return { ok: false, reason: 'no-door' }; }
        const dd = M.read(g, tx, ty);
        if (dd.type !== M.TYPE.DOOR_OPEN) { g.log('那里没有开着的门。'); return { ok: false, reason: 'no-door' }; }
        const rr = M.closeDoor(g, p, tx, ty);
        g.log(rr.ok ? '你关上了门。' : '有什么挡住了，门关不上。');
        if (rr.ok) g.endTurn();
        return rr;
      }
      const here = M.read(g, p.x, p.y);
      if (here.type === M.TYPE.DOOR_OPEN) {
        const r = M.closeDoor(g, p, p.x, p.y);
        g.log(r.ok ? '你关上了门。' : '有什么挡住了，门关不上。');
        if (r.ok) g.endTurn();
        return r;
      }
      const f = this.frontCell(g);
      const ff = M.read(g, f.x, f.y);
      if (ff.type === M.TYPE.DOOR_OPEN) {
        const r = M.closeDoor(g, p, f.x, f.y);
        g.log(r.ok ? '你关上了门。' : '有什么挡住了，门关不上。');
        if (r.ok) g.endTurn();
        return r;
      }
      g.log('附近没有开着的门。');
      return { ok: false, reason: 'no-door' };
    },

    // ======================================================================
    // I —— 整理堆叠（*label_2747，289222-289261）
    // ======================================================================
    /**
     * 【已确认】原版先问 y/n，然后 `repeat` 遍历背包并调用 item_stack 0, cnt, 1。
     * 本实现直接执行（不弹确认框），返回合并次数。
     */
    itemStack(g) {
      const p = g.player;
      if (!Elona.ItemDB || !Elona.ItemDB.stack) return { ok: false };
      let merged = 0;
      for (let i = 0; i < p.inv.length; i++) {
        const it = p.inv[i];
        if (!it || (it.f[0] | 0) <= 0) continue;
        // item_stack 返回合并到的下标，-1 表示未合并（不能用真假判断！）
        if (Elona.ItemDB.stack(p, i) >= 0) merged++;
      }
      g.log(merged ? `你整理了物品，合并了 ${merged} 组。` : '没有可以合并的物品。');
      g.endTurn();
      return { ok: true, merged };
    },

    // ======================================================================
    // p —— 祈祷（*label_2976）
    // ======================================================================
    /**
     * *label_2976（341861-341870）：
     *   item_find 60002 → 找到且祭坛神 != 信仰 → *label_2609（画面，由 UI 打开）
     *   否则 → *label_2613（祈祷；**没有祭坛也可以祈祷**）
     */
    pray(g) {
      const F = Elona.Faith;
      const p = g.player;
      if (!F) {
        g.log('你向神祈祷。');
        g.endTurn();
        return { ok: false, reason: 'no-faith-module' };
      }
      const altar = F.altarAt ? F.altarAt(g, p.x, p.y) : null;
      const faith = p.get(F.F_GOD) | 0;
      if (altar && ((altar.f[25] | 0) !== faith)) {
        // 祭坛画面（*label_2609）由 UI 打开，这里只报告「需要选择」
        return {
          ok: true, needMenu: true, god: altar.f[25] | 0, faith,
          message: faith === 0
            ? `要信仰 ${F.name(altar.f[25] | 0)} 吗？`
            : `要改宗到 ${F.name(altar.f[25] | 0)} 吗？（现在的神会震怒）`,
        };
      }
      const r = F.pray(g, p);
      for (const m of (r.messages || [])) g.log(m);
      if (!r.ok && r.message) g.log(r.message);
      if (r.ok) g.endTurn();
      return r;
    },

    // ======================================================================
    // * —— 手动选择目标（*label_2670，var_2188=1）
    // ======================================================================
    /**
     * 【已确认】主循环在 key_target 分支设置 var_2188=1 后 gosub *label_2670
     *   （目标选择光标）。本实现改为「循环切换锁定目标」，并把结果写入
     *   g.manualTarget，供 f（射击）/ T（投掷）使用。
     */
    manualTarget(g) {
      const list = this.visibleCharas(g, 20).filter((t) => this.isHostile(t.chara));
      if (!list.length) {
        g.log('视野内没有可以锁定的目标。');
        return { ok: false, targets: [] };
      }
      const cur = g.manualTarget;
      let idx = cur ? list.findIndex((t) => t.chara === cur) : -1;
      idx = (idx + 1) % list.length;
      g.manualTarget = list[idx].chara;
      const t = g.manualTarget;
      g.log(`锁定目标：${t.name}（距离 ${list[idx].dist}，HP ${t.hp}/${t.hpMax}）。`);
      return { ok: true, target: t, index: idx, total: list.length };
    },

    /** 射击：优先使用手动锁定的目标（否则退回最近敌人） */
    fire(g) {
      const t = g.manualTarget;
      if (t && (t.get(0) | 0) === 1 && (t.hp | 0) > 0) {
        const d = Math.max(Math.abs(t.x - g.player.x), Math.abs(t.y - g.player.y));
        if (d > 20) { g.log(`${t.name} 已经不在射程内。`); g.manualTarget = null; return g.fireAtNearest(); }
        return g.fireAtTarget ? g.fireAtTarget(t) : g.fireAtNearest();
      }
      return g.fireAtNearest();
    },

    // ======================================================================
    // g —— 拾取（*label_2819，295890-296063）
    // ======================================================================
    /**
     * 【0-DF 修正】g 键**只拾取无主物品**，对有主物品只提示「那不是你的东西」。
     *
     * 源码 296070-296088：
     *   `if ( var_99(21, var_579) > 0 & var_99(21, var_579) < 3 | var_99(21, var_579) == 5 ) {`
     *     var_99(21) == 2 → 「それは持ち運べない。」（不能搬运）
     *     var_99(21) == 1 / 5 → 「それはあなたの物ではない。」/「盗むなんてとんでもない。」/
     *                           「それは拾えない。」（三选一的随机文案）
     *     `gosub *label_2104 : goto *label_4363` —— 取消行动，**不消耗回合**
     * 偷窃（rowact 10）在源码里只能由 a 键能力窗口的「盗む」发动（311077 起），
     * 0-CI 之前把它接在 g 上，导致踩到城镇预设物品按 g 就直接进入偷窃并卡住。
     */
    get(g) {
      const p = g.player;
      const here = ((g.groundItems || [])).filter((it) => it && (it.f[0] | 0) > 0
        && (it.f[5] | 0) === (p.x | 0) && (it.f[6] | 0) === (p.y | 0));
      const n = g.pickupAt(p);          // 只拿 townOwned 之外的（含作物等无主物）
      if (n > 0) {
        g.log(`拾取了 ${n} 件物品。`);
        g.endTurn();
        return { ok: true, count: n };
      }
      // 没拿到东西：若有主物品在脚下，给出原版的三种提示之一
      const owned = here.find((it) => it.townOwned || (it.f[21] | 0) !== 0);
      if (owned) {
        const LINES = ['那不是你的东西。', '怎么能偷呢。', '这东西不能捡。'];
        const pick = (g.rng && g.rng.rnd) ? g.rng.rnd(LINES.length) : 0;
        g.log(LINES[pick % LINES.length]);
        return { ok: false, reason: 'not-yours', item: owned.id | 0 };
      }
      g.log('脚下没有物品。');
      return { ok: false, count: 0 };
    },

    // 注：`o`（打开容器）已迁移到 core/container.js + Panels.openContainer。
    // 旧实现在这里按 refitem(id,5) ∈ {64000,62000} 过滤，与源码 296369 的
    // `refitem(id,9) == 72000` 不符，已删除以免两份实现分叉。
  };

  Elona.Actions = Actions;
})(window);
