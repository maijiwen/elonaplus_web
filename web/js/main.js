'use strict';
/**
 * 入口 —— 界面流程与输入处理
 *
 * 输入分派顺序（与原版主循环 605500-607200 的结构一致）：
 *   1. 已打开的面板 / 弹窗优先消费按键（对应原版各窗口内部的 key 循环）
 *   2. 世界地图步行模式（var_126(6)==1）
 *   3. 移动（数字小键盘 1-9 / 方向键；5 = 原地等待）
 *   4. 其余按键交给 core/keys.js 的绑定表 → 动作 id → 具体实现
 *
 * 键位一律取自 original/config.txt（见 core/keys.js 的 ACTIONS 表），
 * 按键到原版分派标签的对照见 docs/03-keymap.md。
 */
(function (global) {
  const Elona = global.Elona;
  const A = Elona.ATTR;
  const STATE = Elona.Game.STATE;

  const game = new Elona.Game();
  const renderer = new Elona.Renderer(document.getElementById('screen'));
  const UI = Elona.UI;
  let animationHandle = null;
  let titleScreen = null;

  // ---------- 渲染循环 ----------
  function startLoop() {
    if (animationHandle) return;
    const tick = () => {
      if (game.state === STATE.PLAY && game.map) {
        game.updateEffects(performance.now());
        renderer.clear();
        if (game.worldMap) renderer.drawWorldMap(game);
        else renderer.drawMap(game);   // 地图 + HUD + 消息窗
      }
      animationHandle = requestAnimationFrame(tick);
    };
    animationHandle = requestAnimationFrame(tick);
  }

  // ---------- 键盘 ----------
  const KEYMAP = {
    // 小键盘 / 主键盘方向
    'Numpad1': 1, 'Numpad2': 2, 'Numpad3': 3, 'Numpad4': 4, 'Numpad5': 5,
    'Numpad6': 6, 'Numpad7': 7, 'Numpad8': 8, 'Numpad9': 9,
    'ArrowLeft': 4, 'ArrowRight': 6, 'ArrowUp': 8, 'ArrowDown': 2,
  };
  // 原版 config 的移动键只有数字（key_north..key_wait）与小键盘。
  // 这里不再把 hjkl 等字母当移动键，否则会占用 key_look/key_journal 等功能键。
  const CHARMAP = {
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  };

  const panelOpen = (id) => {
    const el = document.getElementById(id);
    return !!(el && !el.classList.contains('hidden'));
  };

  /**
   * 是否有阻塞式窗口正开着。
   *   原版的窗口都是阻塞循环（`*label_2896` 等），模态期间按键只属于窗口；
   *   网页版把窗口拆成了 DOM/Canvas 两种，这里统一判定，供「按键不得穿透到地图」用。
   */
  const modalOpen = () => (
    (Elona.Panels && Elona.Panels.isOpen && Elona.Panels.isOpen())
    || !!UI.invOpen
    || panelOpen('npc') || panelOpen('shop') || panelOpen('quest') || panelOpen('worldmap')
    || !!game.throwState
    || (Elona.SceneView && Elona.SceneView.isActive && Elona.SceneView.isActive())
  );

  /** 进入 world.bmp 世界地图步行模式（调试按钮由 UI.showWorldDebug 显示） */
  async function startWorldMap() {
    if (!game.enterWorldMap) return;
    const ok = await game.enterWorldMap();
    if (ok) UI.showWorldDebug(game);
  }

  /**
   * 处理 spell.js type 0 的 request（428 Return / 411 Identify / 1162 World map）。
   * @returns {boolean} 是否已消费
   */
  function consumeSpellRequest(r) {
    if (!r || !r.request) return false;
    if (r.request === 'worldmap') { startWorldMap(); return true; }
    if (r.request === 'identify') { UI.openIdentify(game, r.power | 0); return true; }
    if (r.request === 'wish') {
      if (r.noPower) { UI.pushMessage('願いの女神の力も、ここに届かないようだ…。'); return true; }
      Elona.Panels.openWish(game);
      return true;
    }
    if (r.request === 'return') {
      if (r.blocked) { UI.pushMessage('不可思议的力量阻止了归还。'); return true; }
      if (r.travel) game.returnToTown();
      return true;
    }
    // 454 自己の変容：改别名（*label_2725 的输入窗，320265-320271）
    if (r.request === 'alias') {
      if (Elona.Panels && Elona.Panels.openAlias && game.player) {
        Elona.Panels.openAlias(game, game.player);
      }
      return true;
    }
    // 463 四次元ポケット：打开临时口袋（340393-340428）
    if (r.request === 'pocket') {
      if (Elona.Panels && Elona.Panels.openPocket) Elona.Panels.openPocket(game);
      return true;
    }
    // 炼成雨（751）/ 液体操纵弹（826）：打开「只列可用药水」的选择窗（var_486=23,11）
    if (r.request === 'potion-pick') {
      if (Elona.Panels && Elona.Panels.openPotionPick) {
        Elona.Panels.openPotionPick(game, r.kind || 'rain');
      }
      return true;
    }
    // 0-GB：事务所打工登记簿（350459-350568 的 txtsetwork 8）
    if (r.request === 'work-menu' && Elona.Panels && Elona.Work) {
      Elona.Panels.chooseRow('要选择哪项工作？', r.options || Elona.Work.menu(), (i) => {
        const rr = Elona.Work.begin(game, i);
        if (rr && rr.message) UI.pushMessage(rr.message);
        if (rr && rr.ok && rr.turns) UI.pushMessage(`开始工作（${rr.turns} 回合）。`);
      });
      return true;
    }
    // 0-DG：呼び寄せ／待機（能力 684）—— 打开同伴列表（原版 gosub *label_2683）
    if (r.request === 'ally-select' && Elona.Panels && Elona.Companion) {
      const list = Elona.Companion.allies(game).filter((c) => c.index !== 0 && (c.get(0) | 0) !== 6);
      Elona.Panels.openAllySelect(game, '誰を呼び戻す？', list, (c) => {
        const rr = Elona.Ability.use(game, 684, { target: c });
        if (rr && rr.message) UI.pushMessage(rr.message);
      });
      return true;
    }
    return false;
  }
  Elona.consumeSpellRequest = consumeSpellRequest;

  // 0-EW：超量施法确认（314562-314582「マナが足りないが、それでも詠唱を試みる？」）。
  // castPlayerSpell 在 MP 不足时回调本钩子；选「是」→ 带 overcast 标记重放施法
  //（MP 扣成负值 → 触发魔力反噬）。核心不直接依赖视图层，走这个注入点。
  Elona.overcastConfirm = (g, spellId, done) => {
    const nm = (Elona.Spell && Elona.Spell.actionName) ? Elona.Spell.actionName(spellId) : null;
    const label = nm ? (nm.ch || nm.en || nm.jp || ('#' + spellId)) : ('#' + spellId);
    if (Elona.Panels && Elona.Panels.openConfirm) {
      Elona.Panels.openConfirm(`MP 不足，仍要尝试咏唱 ${label} 吗？`, done);
    } else done(false);
  };

  // 0-FY：*label_2844（300691-300700）——「読書を中断したほうがいいだろうか？」。
  //   核心层 core/actions.js 只发请求，这里接到 y/n 面板；选「否」等于继续当前行动。
  Elona.rowactInterruptConfirm = (g, name, done) => {
    if (Elona.Panels && Elona.Panels.openConfirm) {
      Elona.Panels.openConfirm(`要中断「${name}」吗？`, done, {
        title: '中断行动', yes: '是，中断', no: '继续行动',
      });
    } else done(true);
  };

  /** 移动后消费 game.pendingInteraction（撞 NPC / 掲示板） */
  function consumePending() {
    const pi = game.pendingInteraction;
    if (!pi) return;
    game.pendingInteraction = null;
    if (pi.action === 'npc') UI.openNPC(game, pi.npc);
    else if (pi.action === 'shop') UI.openShop(game, pi.keeper);
    else if (pi.action === 'questBoard') UI.openQuestBoard(game);
  }

  /** 楼梯（< / > 与 Enter 共用 game.useStairs） */
  function doStairs(up) {
    const r = game.useStairs(up);
    if (r && r.ok && Elona.Audio) Elona.Audio.play('door');
    return r;
  }

  /** Enter / Space / i 的地形交互（原版 label_2749 / label_4364） */
  function doInteract() {
    const r = game.interact();
    if (!r) return r;
    if (r.action === 'shop') UI.openShop(game, r.keeper);
    else if (r.action === 'npc') UI.openNPC(game, r.npc);
    else if (r.action === 'questBoard') UI.openQuestBoard(game);
    else if (r.action === 'offer') UI.openOffer(game);
    // 0-FU：井水喝出了愿望（*label_2954 → 效果 441）
    else if (r.action === 'wish' && Elona.Panels) Elona.Panels.openWish(game);
    return r;
  }

  /**
   * i 键 —— 原版 `*label_2749`：先问「操作する対象の方向は？」，
   * 玩家周围 8 格出现方向箭头，方向键选定目标格的角色，回车 = 自身互动菜单。
   * （Enter 的地形交互仍走 doInteract。）
   */
  function doInteractDir() {
    if (!Elona.Interact) { doInteract(); return null; }
    const r = Elona.Interact.start(game);
    renderer.lastMove = performance.now();
    UI.pushMessage(r.prompt);
    return r;
  }

  /**
   * 动作分派 —— 键位表见 core/keys.js，具体实现在 core/actions.js 与 view/panels.js。
   * 返回 true 表示已处理。
   */
  /**
   * 瞄准模式的按键（`*label_2672` 的 `key_check` 段）。
   *   方向键 / 小键盘 → 移动光标（283644-283693）
   *   PageUp / PageDown（`var_341` / `var_342`）→ 自由模式下跳到上一个/下一个角色，
   *                                             角色模式下翻页（283713 / 283934）
   *   `+` / `-` 同 PageUp / PageDown（原版 `cursor_check` 的滚轮同源）
   *   回车（`var_144`）→ 确认（283738）
   *   Esc（`var_150`）/ Shift（`var_144` 的另一种绑定）→ 取消（283802）
   * @returns {boolean} 是否消费了这个按键
   */
  /**
   * 0-EP：能力方向选择结算后的后续动作。
   *   626 精神分析：`*label_2893` 选完邻格之后
   *     · 目标在タッグ编成中 → 318832 的 `txtselecttc 2` 二选一
   *     · 否则 → `gosub *label_2688`（分析窗）
   */
  function afterDirSelAbility(r) {
    if (!r) return;
    if (r.reason === 'tag-pick' && Elona.Panels) {
      Elona.Panels.openTagPick(game, r.options, (chara) => {
        const r2 = game.useAbility(r.aid, { target: chara, resume: true, tagPicked: true });
        if (r2 && r2.request === 'analyze' && Elona.Panels) {
          Elona.Panels.openAnalyze(game, r2.target);
          return;
        }
        if (r2 && r2.message) UI.pushMessage(r2.message);
        for (const m of ((r2 && r2.messages) || [])) UI.pushMessage(m);
      });
      return;
    }
    if (r.request === 'analyze' && r.target && Elona.Panels) {
      Elona.Panels.openAnalyze(game, r.target);
    }
  }

  function handleAimKey(e) {
    const Aim = Elona.Aim;
    const k = e.key;
    let mud = false;

    const step = KEYMAP[e.code] || CHARMAP[k];
    if (step) {
      const dir = { 1: [-1, 1], 2: [0, 1], 3: [1, 1], 4: [-1, 0], 5: [0, 0],
        6: [1, 0], 7: [-1, -1], 8: [0, -1], 9: [1, -1] }[step];
      if (dir) mud = Aim.move(dir[0], dir[1]);
    } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      const dx = k === 'ArrowLeft' ? -1 : (k === 'ArrowRight' ? 1 : 0);
      const dy = k === 'ArrowUp' ? -1 : (k === 'ArrowDown' ? 1 : 0);
      mud = Aim.move(dx, dy);
    } else if (k === 'PageUp' || k === '+') {
      mud = Aim.nextChara(-1);
    } else if (k === 'PageDown' || k === '-') {
      mud = Aim.nextChara(1);
    } else if (k === 'Enter' || k === ' ' || k === '5') {
      const r = Aim.confirm(game);
      if (r.needPick && Elona.Panels && Elona.Panels.openRidePickTarget) {
        Elona.Panels.openRidePickTarget(game, r);
      } else {
        if (Elona.Panels) Elona.Panels.close();
        if (r.message) UI.pushMessage(r.message);          // 283774 / 283784
        // 从能力窗口进来时（Aim.openAim 前记下了 id），确认后接着发动
        const pend = (Elona.Panels && Elona.Panels.pendingAbility) | 0;
        if (r.ok && pend) {
          Elona.Panels.pendingAbility = 0;
          const res = game.useAbility(pend);
          if (res && res.message) UI.pushMessage(res.message);
          for (const m of ((res && res.messages) || [])) UI.pushMessage(m);
        }
        // 0-EO：地面指定法术（类别 7000）—— 光标确认后按该格咏唱
        const pendSpell = (Elona.Panels && Elona.Panels.pendingSpell) | 0;
        if (r.ok && pendSpell) {
          Elona.Panels.pendingSpell = 0;
          const tile = r.tile || (r.kind === 'ground' ? { x: r.x, y: r.y } : null);
          const res2 = game.castPlayerSpell(pendSpell, tile ? { tile } : {});
          if (res2 && res2.message) UI.pushMessage(res2.message);
          for (const m of ((res2 && res2.messages) || [])) UI.pushMessage(m);
        }
        // 0-EP：投掷 —— 光标锁定后按该格投出（原版「选目标 → 抛物线」）
        const pendThrow = (Elona.Panels && Elona.Panels.pendingThrow) | 0;
        if (r.ok && pendThrow >= 0) {
          Elona.Panels.pendingThrow = -1;
          const tile = r.tile || (r.kind === 'ground' ? { x: r.x, y: r.y } : null);
          if (tile && game.map && game.map.inBounds(tile.x, tile.y)) {
            const res3 = game.throwAt(tile.x, tile.y);
            if (res3 && res3.message) UI.pushMessage(res3.message);
            for (const m of ((res3 && res3.messages) || [])) UI.pushMessage(m);
          } else {
            game.throwState = null;
            UI.pushMessage('那里无法投掷。');
          }
        }
      }
      renderer.lastMove = performance.now();
      return true;
    } else if (k === 'Escape') {
      const r = Aim.cancel();
      if (Elona.Panels) {
        // 0-EP：取消投掷时把「待投掷物品」与 throwState 一起清掉
        if (Elona.Panels.pendingThrow >= 0) {
          Elona.Panels.pendingThrow = -1;
          game.throwState = null;
        }
        Elona.Panels.close();
      }
      if (r.message) UI.pushMessage(r.message);
      return true;
    } else if (k === 'Shift') {
      shiftPending = !!Elona.Keys.shiftAsEsc;
      return true;
    } else {
      // 其它键在瞄准中一律忽略（原版只认上面的几个）
      return true;
    }

    if (mud && Elona.Panels && Elona.Panels.aimRefresh) Elona.Panels.aimRefresh(game);
    return true;
  }

  function dispatchAction(action) {
    const Act = Elona.Actions;
    const P = Elona.Panels;
    switch (action) {
      // ---- 探索 / 地形 ----
      case 'look': P.openLook(game); return true;
      case 'search': Act.search(game); return true;
      // 0-EO：原版「どの方向を掘る？」（*label_2736 → *label_2893）
      case 'dig':
        if (Elona.DirSel) { Elona.DirSel.startCmd(game, '挖掘', (gg, dx, dy) => Act.dig(gg, Elona.DirSel.keyOf(dx, dy))); UI.pushMessage('挖哪个方向？（方向键 / 小键盘 1-9，Esc 取消）'); return true; }
        Act.dig(game, 0); return true;
      // 0-EO：原版「どの方向に体当たりする？」（*label_2737）
      case 'bash':
        if (Elona.DirSel) { Elona.DirSel.startCmd(game, '撞', (gg, dx, dy) => Act.bash(gg, Elona.DirSel.keyOf(dx, dy))); UI.pushMessage('撞哪个方向？（方向键 / 小键盘 1-9，Esc 取消）'); return true; }
        Act.bash(game, 0); return true;
      case 'rest': Act.rest(game); return true;
      case 'hijump': Act.hijump(game); return true;
      // 0-EO：原版「何を閉める？」（*label_3004）
      case 'close':
        if (Elona.DirSel) { Elona.DirSel.startCmd(game, '关门', (gg, dx, dy) => Act.closeDoor(gg, dx, dy)); UI.pushMessage('关哪个方向的门？（方向键 / 小键盘 1-9，Esc 取消）'); return true; }
        Act.closeDoor(game); return true;
      case 'goUp': doStairs(true); return true;
      case 'goDown': doStairs(false); return true;
      case 'interact': doInteractDir(); return true;
      // Space / Enter（key_enter）—— 原版这两个键同样走地形交互（label_4364）
      case 'enter': doInteract(); return true;
      case 'target': P.openAim ? P.openAim(game) : Act.manualTarget(game); return true;
      // `[`（key_alter）在原版不是独立动作：它是**瞄准时的光标修饰键**
      // （7613 `if (var_160(cnt) == var_161) var_155 = 1` → 之后方向键移动光标而不是角色）。
      // 本项目的目标选择是自动/列表式的，用不到这个修饰键，故只给提示。
      case 'alter': UI.pushMessage('[ 在原版是瞄准时的光标修饰键；本项目目标选择为自动/列表式，无需使用。'); return true;
      case 'material': P.openMaterials(game); return true;

      // ---- 物品 ----
      case 'get': Act.get(game); return true;
      case 'drop': P.openDrop(game); return true;
      case 'inventory': UI.toggleInventory(game, 'bag'); return true;
      case 'quickinv': UI.toggleInventory(game, 'bag'); return true;
      case 'eat': UI.openUse(game, 14); return true;      // var_486=5 → 食物
      case 'read': UI.openUse(game, 13); return true;     // var_486=7 → 卷轴/书
      case 'drink': UI.openUse(game, 15); return true;    // var_486=8 → 药水
      case 'use': UI.openUse(game, 0); return true;       // var_486=14 → 全部
      case 'zap': P.openZap(game); return true;           // var_486=9
      case 'open': P.openContainer(game); return true;    // var_486=15
      case 'dip': P.openDip(game); return true;           // var_486=17
      case 'offer': P.openOfferAtAltar(game); return true; // var_486=19
      case 'throw': UI.openThrow(game); return true;      // var_486=26
      case 'wear': UI.openEquip(game); return true;
      case 'wipe': P.openSkills(game, 2); return true;    // label_2743（技能第 3 页）
      case 'itemstack': Act.itemStack(game); return true;
      // 0-EO：原版「どの方向に？」（*label_2748）选一个相邻的人
      case 'give':
        if (Elona.DirSel) { Elona.DirSel.startCmd(game, '给东西', (gg, dx, dy) => P.openGive(gg, Elona.DirSel.keyOf(dx, dy))); UI.pushMessage('给哪个方向的人？（方向键 / 小键盘 1-9，Esc 取消）'); return true; }
        P.openGive(game); return true;
      case 'pray': P.openAltar(game); return true;   // label_2976：祭坛前祈祷/改宗

      // ---- 战斗 / 技能 ----
      case 'fire': Act.fire(game); return true;
      case 'cast': UI.openSpells(game); return true;
      // 0-CL：a 键 = key_apply → 能力の発動（原版 *label_2739 的 ability 段）
      case 'skill': P.openAbilities(game); return true;
      case 'quickslot': P.openQuickSlots(game); return true;
      case 'ammo': game.cycleAmmo(); return true;

      // ---- 信息面板 ----
      case 'charainfo': P.openCharaInfo(game); return true;
      case 'journal': P.openJournal(game); return true;
      case 'trait': P.openTraits(game); return true;
      case 'msglog': P.openMsgLog(game); return true;
      case 'help': P.openHelp(); return true;

      // ---- 系统 ----
      case 'save': P.openSaveSlots(); return true;
      case 'esc': P.openMenu(); return true;
      case 'cancel': P.close(); return true;
      default: return false;
    }
  }

  // key_sCancel：只有「单独按下并松开 Shift」才当 Esc（Shift+',' 仍能输入 '<'）
  let shiftPending = false;
  window.addEventListener('keyup', (e) => {
    if (e.key !== 'Shift') return;
    if (!shiftPending) return;
    shiftPending = false;
    if (game.state !== STATE.PLAY) return;
    if (Elona.Aim && Elona.Aim.active) {
      const r = Elona.Aim.cancel();
      if (Elona.Panels) Elona.Panels.close();
      if (r.message) UI.pushMessage(r.message);
      return;
    }
    if (Elona.Keys.shiftAsEsc) dispatchAction('esc');
  });

  window.addEventListener('keydown', (e) => {
    if (game.state !== STATE.PLAY) return;

    if (e.key === 'Shift') { shiftPending = !!Elona.Keys.shiftAsEsc; return; }
    shiftPending = false;

    // ---------- 0) 瞄准 / 锁定（*label_2670，283536-283808）----------
    //    原版是阻塞式循环，这里逐键驱动 Elona.Aim 的状态机。
    if (Elona.Aim && Elona.Aim.active) {
      if (handleAimKey(e)) { e.preventDefault(); return; }
    }

    // ---------- 0.5) 近距离能力的方向选择（315670「どの方向？」）----------
    //    按方向键 / 小键盘 1..9 立即发动；Esc 取消。
    if (Elona.DirSel && Elona.DirSel.active) {
      e.preventDefault();
      if (e.key === 'Escape') {
        Elona.DirSel.cancel();
        // 0-EP：清掉「誰が使用する？」的会话，避免下次使用时还带着上一次的镜子/目标
        if (Elona.ItemFxUse) Elona.ItemFxUse.abort();
        UI.pushMessage('发动中止。');
        return;
      }
      // 0-EO：道具档按回车 / 5 = 对自己（原版准星按 Esc 时 var_244 保持 0 的语义）
      if ((e.key === 'Enter' || e.key === ' ' || e.key === '5') && Elona.DirSel.allowSelf) {
        const r0 = Elona.DirSel.commitSelf(game);
        if (r0 && r0.message) UI.pushMessage(r0.message);
        for (const m of ((r0 && r0.messages) || [])) UI.pushMessage(m);
        // 0-EP：效果本体可能还要一次 UI（タッグ二选一 / 输入 / 确认 …）
        if (r0 && Elona.ItemFxUse && Elona.ItemFxUse.handles(r0.effect)
            && (r0.reason === 'tag-pick' || r0.action)) {
          UI._itemFxFollow(game, r0, null);
        } else {
          afterDirSelAbility(r0);
        }
        renderer.lastMove = performance.now();
        return;
      }
      if (Elona.DirSel.dirOfKey(e.key)) {
        // 0-EN：道具档要先记住「用的是哪一件」（pick 之后 itemIdx / groundItem 会被清）
        const useIdx = Elona.DirSel.itemIdx;
        const useGround = Elona.DirSel.groundItem;
        const r = Elona.DirSel.pick(game, e.key);
        // 目标正在骑乘 → 骑乘者 / 坐骑 二选一（360681-360703，紧跟准星之后）
        if (r && r.reason === 'riding' && Elona.Panels) {
          Elona.Panels.openEvolveRiding(game, useGround || useIdx, r.target, r.mount);
        }
        if (r && r.message) UI.pushMessage(r.message);
        for (const m of ((r && r.messages) || [])) UI.pushMessage(m);
        // 0-EP：タッグ二选一 / 后续 UI 请求
        if (r && Elona.ItemFxUse && Elona.ItemFxUse.handles(r.effect)
            && (r.reason === 'tag-pick' || r.action)) {
          UI._itemFxFollow(game, r, null);
        } else {
          afterDirSelAbility(r);
        }
        renderer.lastMove = performance.now();
      }
      return;
    }

    // ---------- 0.6) 对目标方向的操作（*label_2749，289330-289357）----------
    //    i → 周围 8 格出现方向箭头；方向键选定目标格的角色，回车 = 自身互动窗口。
    if (Elona.Interact && Elona.Interact.active) {
      e.preventDefault();
      if (e.key === 'Escape') {
        Elona.Interact.cancel();
        UI.pushMessage('取消了方向选择。');
        return;
      }
      if (e.key === 'Enter' || e.key === ' ' || e.key === '5') {
        Elona.Interact.confirm(game);
        UI.openSelfMenu(game);
        return;
      }
      if (Elona.Interact.dirOfKey(e.key)) {
        const r = Elona.Interact.pick(game, e.key);
        if (r && r.ok && r.npc) {
          UI.openNPC(game, r.npc);
          renderer.lastMove = performance.now();
        } else if (r && r.message) {
          UI.pushMessage(r.message);
        }
        return;
      }
      return;
    }

    // ---------- 1) 信息面板优先 ----------
    if (Elona.Panels && Elona.Panels.handleKey(e)) { e.preventDefault(); return; }

    // ---------- 1.5) 0-FS：自宅的装修模式（*label_2444 / *label_2670） ----------
    //   方向键 = 移动光标 / 回车 = 铺当前地砖 / T = 打开地砖一览 / Esc = 结束
    if (Elona.Home && Elona.Home.design && Elona.Home.design.active) {
      const D = Elona.Home.design;
      if (e.key === 'Escape') {
        e.preventDefault();
        D.cancel();
        UI.pushMessage('结束了装修。');
        renderer.lastMove = performance.now();
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        Elona.Panels.openTilePalette(game, D.page | 0);
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        D.pick(game);
        UI.pushMessage(`取到了地砖 ${D.tile}。`);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ' || e.key === '5') {
        e.preventDefault();
        const r = D.paint(game);
        if (r.ok) renderer.lastMove = performance.now();
        return;
      }
      const ddir = KEYMAP[e.code] || CHARMAP[e.key];
      if (ddir) {
        e.preventDefault();
        const d = (Elona.Game && Elona.Game.DIRS) ? Elona.Game.DIRS[ddir] : null;
        if (d) D.move(d[0], d[1]);
        renderer.lastMove = performance.now();
        return;
      }
      e.preventDefault();
      return;
    }

    // ---------- 2) 世界地图步行模式 ----------
    //   0-FF：有模态窗口（背包 / 阅读窗 / NPC 菜单…）时**不**进这一段，
    //     否则在世界地图上打开背包后，方向键会被当成移动光标。
    if (game.worldMap && !modalOpen()) {
      let wdir = KEYMAP[e.code];
      if (!wdir) wdir = CHARMAP[e.key];
      // 0-FT：`*` 切换「查看模式」——镜头跟着光标跑，玩家原地不动（不改坐标、不走时间）
      if (e.key === '*' || e.key === '＊') {
        e.preventDefault();
        const on = game.worldLookToggle();
        UI.pushMessage(on ? '查看模式：方向键移动光标，* 或 Esc 退出。'
          : '退出查看模式。');
        renderer.lastMove = performance.now();
        return;
      }
      if (game.worldLook) {
        if (wdir) {
          e.preventDefault();
          game.worldLookMove(wdir);
          renderer.lastMove = performance.now();
          return;
        }
        if (e.key === 'Enter' || e.key === ' ' || e.key === '5' || e.key === 'Escape') {
          e.preventDefault();
          game.worldLookToggle();
          UI.pushMessage('退出查看模式。');
          renderer.lastMove = performance.now();
          return;
        }
        if (e.key === 'M' || e.key === 'm') {
          e.preventDefault();
          game.leaveWorldMap();
          UI.hideWorldDebug();
          return;
        }
        e.preventDefault();
        return;
      }
      if (wdir) {
        e.preventDefault();
        game.worldMoveDir(wdir);
        if (!game.worldMap) UI.hideWorldDebug();
        return;
      }
      // 0-DG：站在 site 入口格上按回车进入（原版确认键 var_577 == 6）
      if (e.key === 'Enter' || e.key === ' ' || e.key === '5') {
        e.preventDefault();
        if (game.worldEnter && game.worldEnter()) { UI.hideWorldDebug(); }
        if (!game.worldMap) UI.hideWorldDebug();
        return;
      }
      if (e.key === 'M' || e.key === 'm' || e.key === 'Escape') {
        e.preventDefault();
        game.leaveWorldMap();
        UI.hideWorldDebug();
        return;
      }
      // 0-FF：世界地图上仍要能打开背包(x/X)与阅读窗(r) —— 产权书正是
      //   「站在世界地图的空格上按 r 读」（232703 的「只能在世界地图使用」）。
      //   其余按键照旧吞掉，避免误触地图上的其它动作。
      if (!(e.key === 'x' || e.key === 'X' || e.key === 'r' || e.key === 'R')) return;
    }

    // ---------- 3) 其它弹窗 ----------
    if (panelOpen('npc')) {
      if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') {
        e.preventDefault(); UI.closeNPC();
        return;
      }
      // 方向键上下移动光标，回车确定（原版 `*label_2896` 的菜单光标）
      if (e.key === 'ArrowUp' || e.key === '8') {
        e.preventDefault(); UI.moveNPCSel(-1);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === '2') {
        e.preventDefault(); UI.moveNPCSel(1);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ' || e.key === '5') {
        e.preventDefault(); UI.activateNPCSel();
        return;
      }
      // 0-BW：菜单快捷键（原版 var_446 = "a".."s"，按键匹配见 272555-272560）
      if (e.key.length === 1 && /[a-s]/.test(e.key)) {
        const idx = 'abcdefghijklmnopqrs'.indexOf(e.key);
        if (idx >= 0 && UI.triggerNPCAction(idx)) { e.preventDefault(); return; }
      }
      return;
    }
    if (panelOpen('quest')) {
      if (e.key === 'Escape') {
        e.preventDefault(); UI.closeQuestBoard();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); UI.changeQuestPage(game, -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault(); UI.changeQuestPage(game, 1);
      }
      return;
    }
    if (panelOpen('shop')) {
      // 0-EU：商店列表支持键盘操作（此前只有鼠标点击）
      //   ↑↓ 选择　←→ 翻页　Tab 切换买卖　Enter/空格 = 买/卖 1 个　T/Esc 关闭
      e.preventDefault();
      if (e.key === 'Escape' || e.key === 't' || e.key === 'T') { UI.closeShop(game); return; }
      if (e.key === 'ArrowUp' || e.key === '8') { UI.moveShopSel(game, -1); return; }
      if (e.key === 'ArrowDown' || e.key === '2') { UI.moveShopSel(game, 1); return; }
      if (e.key === 'ArrowLeft' || e.key === '4' || e.key === 'PageUp' || e.key === '+') {
        UI.changeShopPage(game, -1); return;
      }
      if (e.key === 'ArrowRight' || e.key === '6' || e.key === 'PageDown' || e.key === '-') {
        UI.changeShopPage(game, 1); return;
      }
      if (e.key === 'Tab') { UI.toggleShopMode(game); return; }
      if (e.key === 'Enter' || e.key === ' ' || e.key === '5') {
        UI.shopAct(game, UI.shopMode === 'buy' ? 'buy' : 'sell', 1);
        return;
      }
      return;
    }
    if (panelOpen('worldmap')) {
      if (e.key === 'Escape' || e.key === 'M' || e.key === 'm') {
        e.preventDefault(); UI.closeWorldMap();
      }
      return;
    }
    // 背包 / 装备 / 图鉴 / 鉴定 / 投掷选择 / 献祭（canvas 物品窗口）
    if (UI.invOpen) {
      const mode = UI.invMode;
      const nav = { ArrowUp: -1, '8': -1, k: -1, ArrowDown: 1, '2': 1, j: 1 };
      // ---- 道具的知识窗（*label_2833）：只有翻页与关闭 ----
      if (UI.invInfo) {
        if (e.key === 'Escape' || e.key === 'X' || e.key === 'x' || e.key === 'Shift'
          || e.key === 'Enter' || e.key === ' ' || e.key === '5') {
          e.preventDefault(); UI.closeInvInfo(); return;
        }
        if (e.key === '+' || e.key === 'PageDown' || e.key === 'ArrowDown' || e.key === '2') {
          e.preventDefault(); UI.turnInvInfoPage(1); return;
        }
        if (e.key === '-' || e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === '8') {
          e.preventDefault(); UI.turnInvInfoPage(-1); return;
        }
        e.preventDefault();
        return;
      }
      if (mode === 'equip-pick') {
        // 296430：物品列表按 Esc 退回装备窗（不关窗）
        if (e.key === 'Escape' || e.key === 'w' || e.key === 'X') {
          e.preventDefault();
          UI.invMode = 'equip';
          UI.invSel = 0;
          UI.equipSlotN = -1;
          UI.invalidateInventory();
          return;
        }
      }
      if (e.key === 'Escape' || (e.key === 'X')
        || (mode === 'throw' && (e.key === 'T'))
        || (mode === 'equip' && (e.key === 'w'))
        || (mode === 'equip-pick' && (e.key === 'w'))
        || (mode === 'spell' && (e.key === 'v'))) {
        e.preventDefault(); UI.closeInventory();
      } else if (e.key === 'x') {
        // 295825 / 297350：x = 既知の情報（原版所有物品列表模式都能用）
        e.preventDefault();
        if (mode === 'equip') UI.openEquipInfo(game);
        else {
          const rows = UI.inventoryRows(game);
          const row = rows[UI.invSel | 0];
          if (row && typeof row === 'object' && row.f) UI.openInvInfo(game, row);
        }
      } else if (e.key === 'z') {
        // 295829 / 299389：z = 情報切替（var_2251）
        e.preventDefault();
        UI.toggleInvInfoCols();
      } else if (e.key === '*' && mode === 'bag') {
        // 2971xx：* = 保持指定（ibit 13）
        e.preventDefault();
        UI.toggleKeep(game);
      } else if (mode === 'equip' && /^[a-n]$/i.test(e.key)) {
        // display_key（295760-295790）：按 a..n 等同「把光标移过去 + 按下确定」
        e.preventDefault();
        UI.selectEquipRow(game, e.key.toLowerCase().charCodeAt(0) - 97);
        UI.activateSelected(game);
      } else if (e.key === 'g' || e.key === 'G' || e.key === 'i') {
        // 背包内按 g / i 视为取消（原版 g=拾取、i=交互，物品窗口内均退回地图）
        e.preventDefault(); UI.closeInventory();
      } else if (nav[e.key] !== undefined) {
        e.preventDefault(); UI.moveSelection(game, nav[e.key]);
      } else if (e.key === 'PageUp' || e.key === '+') {
        e.preventDefault(); UI.moveSelection(game, -16);
      } else if (e.key === 'PageDown' || e.key === '-') {
        e.preventDefault(); UI.moveSelection(game, 16);
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === '5') {
        e.preventDefault(); UI.activateSelected(game);
      }
      return;
    }
    // 投掷目标选择：等待地图点击
    if (game.throwState) {
      if (e.key === 'Escape' || e.key === 'T' || e.key === 't') {
        e.preventDefault();
        game.throwState = null;
        UI.pushMessage('取消了投掷。');
      }
      return;
    }

    // ---------- 3.5) HUD 开关（F2 / F3，不影响原版键位） ----------
    if (e.key === 'F2') {
      e.preventDefault();
      if (Elona.Hud) {
        const on = Elona.Hud.toggleSkillMonitor();
        UI.pushMessage(on ? '技能監視：表示' : '技能監視：非表示');
      }
      return;
    }
    if (e.key === 'F3') {
      e.preventDefault();
      if (Elona.Hud) {
        const n = Elona.Hud.cycleMsgExpand();
        UI.pushMessage(`消息栏高度：${Elona.Hud.MSG_BASE_LINES + n} 行`);
      }
      return;
    }

    // ---------- 3.9) 窗口打开时按键不得穿透到地图 ----------
    //   `Panels.handleKey` 只吃掉窗口真正用到的键（↑/↓/回车…），←/→ 与空列表时的
    //   ↑/↓ 会漏到下面；不在这里拦住，角色就会在弹窗背后走掉。
    if (modalOpen()) { e.preventDefault(); return; }

    // ---------- 4) 移动 ----------
    let dir = KEYMAP[e.code];
    if (!dir) dir = CHARMAP[e.key];
    if (dir) {
      e.preventDefault();
      if (game.movePlayer(dir)) {
        renderer.lastMove = performance.now();
        consumePending();
      }
      return;
    }

    // ---------- 5) 动作分派 ----------
    // M：世界地图（原版由 428 归返/道具进入，网页版保留 M 作为直达入口）
    if (e.key === 'M') { e.preventDefault(); startWorldMap(); return; }

    const action = Elona.Keys.actionFor(e);
    if (!action) return;
    e.preventDefault();
    dispatchAction(action);
  });

  // 画布点击：物品窗口行选择 / 投掷目标格
  document.getElementById('screen').addEventListener('click', (ev) => {
    const canvas = ev.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (ev.clientY - rect.top) * (canvas.height / rect.height);

    // 0-FS：装修模式 —— 左键铺砖
    //   0-FT：镜头在装修时跟随光标（光标居中），所以格子换算必须走
    //   renderer.screenToCell()，不能再假设「玩家在正中」。
    if (Elona.Home && Elona.Home.design && Elona.Home.design.active) {
      const D = Elona.Home.design;
      const c = renderer.screenToCell(game, sx, sy);
      if (game.map && game.map.inBounds(c.x, c.y)) {
        D.x = c.x; D.y = c.y;
        const r = D.paint(game);
        if (r.ok) renderer.lastMove = performance.now();
      }
      return;
    }

    if (UI.invOpen) {
      // 道具的知识窗：点窗口外/内都关闭（cursor_check 的「左键=确定」）
      if (UI.invInfo) { UI.closeInvInfo(); return; }
      // 装备窗：点行 = 选中 + 确认（cs_list 的鼠标分支）
      if (UI.invMode === 'equip') {
        const eq = UI.equipmentRows(game);
        const EX = 80, EY = 84, EH = 19, EN = 14;
        if (sx >= EX + 26 && sx <= EX + 618
          && sy >= EY + 60 && sy < EY + 60 + EN * EH) {
          const i = Math.floor((sy - (EY + 60)) / EH);
          const page = Math.floor((UI.equipSel | 0) / EN);
          const idx = page * EN + i;
          if (idx >= 0 && idx < eq.length) {
            UI.equipSel = idx;
            UI.activateSelected(game);
          }
        }
        return;
      }
      const rows = UI.inventoryRows(game);
      const INV_X = 80, INV_Y = 84, ROW_H = 19, ROWS = 16;
      const pages = Math.max(1, Math.ceil(rows.length / ROWS));
      const page = Math.min(pages - 1, Math.floor((UI.invSel | 0) / ROWS));
      if (sx >= INV_X + 70 && sx <= INV_X + 710
        && sy >= INV_Y + 60 && sy <= INV_Y + 60 + ROWS * ROW_H) {
        const i = Math.floor((sy - (INV_Y + 60)) / ROW_H);
        const idx = page * ROWS + i;
        if (idx >= 0 && idx < rows.length) {
          UI.invSel = idx;
          UI.activateSelected(game);
        }
      }
      return;
    }

    // 瞄准中：点击地图 = 把光标挪到那一格（原版 `cursor_check` 的鼠标分支，283642）
    if (Elona.Aim && Elona.Aim.active) {
      const c = renderer.screenToCell(game, sx, sy);
      if (Elona.Aim.moveTo(c.x, c.y) && Elona.Panels) Elona.Panels.aimRefresh(game);
      return;
    }

    if (game.state !== STATE.PLAY || !game.throwState) return;
    const tc = renderer.screenToCell(game, sx, sy);
    if (game.map && game.map.inBounds(tc.x, tc.y)) game.throwAt(tc.x, tc.y);
  });

  // 0-FS：装修模式下的右键 = 取光标处的地砖（*label_2670「右クリックでタイルの取得」）
  document.getElementById('screen').addEventListener('contextmenu', (ev) => {
    if (!(Elona.Home && Elona.Home.design && Elona.Home.design.active)) return;
    ev.preventDefault();
    const canvas = ev.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const D = Elona.Home.design;
    const c = renderer.screenToCell(game, sx, sy);
    if (game.map && game.map.inBounds(c.x, c.y)) {
      D.x = c.x; D.y = c.y;
      D.pick(game);
      UI.pushMessage(`取到了地砖 ${D.tile}。`);
    }
  });

  // 物品窗口滚轮翻页
  document.getElementById('screen').addEventListener('wheel', (ev) => {
    if (!UI.invOpen) return;
    ev.preventDefault();
    UI.moveSelection(game, ev.deltaY > 0 ? 16 : -16);
  }, { passive: false });

  // ---------- 存档 ----------
  async function doSave(slot) {
    try {
      await Elona.Save.save(slot || 'slot1', game.serialize());
      UI.pushMessage(`已保存到存档槽 ${slot || 'slot1'}。`);
    } catch (err) {
      UI.pushMessage('保存失败: ' + err.message);
    }
  }

  async function doLoad(slot) {
    if (titleScreen) titleScreen.stop();
    UI.setLoading(true);
    try {
      const data = await Elona.Save.load(slot || 'slot1');
      await game.deserialize(data);
      await renderer.loadSheet(game.map.tileset);
      await renderer.loadCharacterSheet();
      UI.clearMessages();
      UI.rebuildMessages(game.messages);
      UI.show('game');
      startLoop();
    } catch (err) {
      alert('读档失败: ' + err.message);
    } finally {
      UI.setLoading(false);
    }
  }
  Elona.loadGame = doLoad;

  // ---------- 界面流程 ----------
  function toMenu() {
    game.state = STATE.MENU;
    UI.closeInventory();
    if (Elona.Panels) Elona.Panels.close();
    if (Elona.Audio) Elona.Audio.stopBgm();
    UI.show('menu');
    if (titleScreen) titleScreen.start();
  }
  Elona.toTitle = toMenu;

  let raceClassData = null;
  let profileData = null;
  let skillNames = {};
  let featTable = null;
  let createState = null;      // 0-FG：由 view/charcreate.js 持有，通过 bindState 回传

  function rollProfile() {
    return Array.from({ length: 5 }, () => 1 + game.rng.rnd(45));
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** 0-FG：8 步向导用的"薄适配层"——只做数据读写，UI 全在 view/charcreate.js */
  /** 0-FH：经历改为中文短句（profiletext.js），未收录时回退英文原句 */
  function profileText(profile) {
    if (Elona.ProfileText) return Elona.ProfileText.lines(profile, profileData);
    return (profile || []).map((v, i) => (profileData.groups[i] || [])[v] || '—');
  }
  /** 角色 → 中文经历（c 键人物信息窗用） */
  function profileOf(c) {
    if (Elona.ProfileText) return Elona.ProfileText.of(c, profileData);
    return [];
  }
  function raceName(k, lang) {
    const jp = (raceClassData.races[k] || {}).jpName;
    if (lang === 'jp') return jp || k;
    if (lang === 'ch') return (Elona.RaceName ? Elona.RaceName.zh(k) : jp) || k;
    return k;
  }
  function classNameOf(k, lang) {
    const jp = (raceClassData.classes[k] || {}).jpName;
    if (lang === 'jp') return jp || k;
    if (lang === 'ch') return (Elona.RaceName ? Elona.RaceName.classZh(k) : jp) || k;
    return k;
  }
  /**
   * 0-FH：天赋的多级名称 / 中文说明。
   * feats.json 的 `levels[lv-1].ch` 是每一级的名字（幸运者 → 罕见幸运 → 幸运女神的宠爱），
   * `nameCh` 是一级名，`ranks[0].ch` 是取得时的说明——全部取中文字段，不显示日文。
   */
  function featName(id, lv) {
    const f = featTable && featTable.feats[String(id)];
    if (!f) return '天赋 ' + id;
    const n = Math.max(0, ((lv | 0) || 1) - 1);
    const byLevel = f.levels && f.levels[n] && f.levels[n].ch;
    return byLevel || f.nameCh || (f.ranks && f.ranks[0] && f.ranks[0].ch)
      || f.name || ('天赋 ' + id);
  }
  function featDesc(id) {
    const f = featTable && featTable.feats[String(id)];
    if (!f) return '';
    const r = (f.ranks && f.ranks[0]) || {};
    return r.ch || f.nameCh || r.jp || f.name || '';
  }
  /** var_92(2)：该天赋的最高等级（285809「これ以上取得できない」） */
  function featMax(id) {
    if (Elona.Feat && Elona.Feat.maxLevelOf) return Elona.Feat.maxLevelOf(id) | 0;
    const f = featTable && featTable.feats[String(id)];
    return f ? ((f.maxLevel | 0) || 1) : 1;
  }
  /** skills.json 的 skillNames[id].ch（0-FH：创建流程统一中文） */
  function skillName(id) {
    const r = skillNames[String(id)] || {};
    return r.ch || r.jp || ('技能 ' + id);
  }

  /** 进入角色创建页：载入数据，启动 8 步向导 */
  async function initCreate() {
    raceClassData = await Elona.Data.table('race_class');
    profileData = await Elona.Data.table('profile');
    if (Elona.Feat) await Elona.Feat.loadTable();
    const st = await Elona.Data.table('skills');
    skillNames = (st && st.skillNames) || {};
    try { featTable = await Elona.Data.table('feats'); } catch (_) { featTable = null; }
    await Elona.CharCreate.start({
      root: document.getElementById('cc-root'),
      data: { raceClass: raceClassData, profile: profileData, skills: st, feats: featTable },
      api: {
        /**
         * 0-FI：*label_3103 被调用两次（var_428=0 普通 / var_428=1 额外），
         * 所以候选顺序是「11 个普通种族 → 65 个隐藏种族」，隐藏项加 (extra) 标记。
         */
        races: () => {
          const l = raceClassData.raceList;
          return l.filter(r => r[1] === 0).map(r => r[0])
            .concat(l.filter(r => r[1] !== 0).map(r => r[0]));
        },
        isHiddenRace: (k) => {
          const row = raceClassData.raceList.find(r => r[0] === k);
          return !!(row && row[1] !== 0);
        },
        classes: () => raceClassData.classList.map(c => c[0]),
        raceName, className: classNameOf,
        /** 0-FH/0-FI：说明取中文；隐藏种族按初始技能生成中文说明 */
        descText: (raceKey, classKey, withClass) => {
          if (!Elona.RaceName) return '';
          if (withClass) return Elona.RaceName.classDesc(classKey);
          const t = Elona.RaceName.trait(raceKey);
          if (t) return t;
          const rec = raceClassData.races[raceKey] || {};
          const ids = Object.keys(rec.skills || {}).map(Number)
            .filter(id => id >= 100 && (rec.skills[String(id)] | 0) !== 0)
            .slice(0, 8);
          const nms = ids.map(id => (skillNames[String(id)] || {}).ch).filter(Boolean);
          return `隐藏种族「${Elona.RaceName.zh(raceKey)}」。`
            + (nms.length ? `初始习得：${nms.join('、')}。` : '')
            + '装备部位与成长方向与普通种族不同，请谨慎选择。';
        },
        /** 0-FI：中文别名 / 游戏模式 */
        // 用独立 RNG，避免 16 个别名的随机消耗扰动 game.rng（后续世界地图/掉落序列）
        rollAliases: () => (Elona.TitleText
          ? Elona.TitleText.list(new Elona.RNG((Date.now() ^ (Math.random() * 1e9)) | 0), 16)
          : ['流浪者', '无名氏']),
        modes: () => (Elona.GameMode ? Elona.GameMode.MODES : []),
        modeByValue: (v) => (Elona.GameMode
          ? Elona.GameMode.byValue(v) : { zh: '本质', key: 'Essential', value: 0 }),
        profileText, profileOf, rollProfile,
        rng: () => game.rng,
        bindState: (s) => { createState = s; },
        build: async (state, reroll) => { await rebuildPreview(state, reroll); return state.player; },
        featCandidates,
        featName, featDesc, featMax, skillName,
        preview: drawPreview,
        ensurePcc: (p) => { if (Elona.PCC) Elona.PCC.ensure(p, game.rng); },
        refreshPcc: (p) => { if (Elona.PCC) Elona.PCC.preload(p).catch(() => {}); },
        randomLook: (state) => {
          const p = state.player;
          if (!p || !Elona.PCC) return;
          p.pcc = null;
          Elona.PCC.ensure(p, game.rng);
          Elona.PCC.preload(p).catch(() => {});
        },
        done: doCreate,
        cancel: () => { UI.show('menu'); if (titleScreen) titleScreen.start(); },
      },
    });
  }

  /**
   * 重建预览角色（*label_3103 / *label_3104 的种族+职业应用）。
   * reroll=true 时按原版 221282-221287 对未锁定的 8 项属性做随机下调。
   */
  async function rebuildPreview(state, reroll) {
    const name = state.name || 'Elona';
    const raceKey = state.race, classKey = state.class;
    const gender = state.gender | 0;
    const prev = state.player;
    const p = await game.buildPlayer(name, raceKey, classKey,
      { gender, profile: state.profile });
    if (prev && prev.pcc) p.pcc = prev.pcc.slice();

    if (reroll && prev) {
      for (let id = 10; id <= 17; id++) {
        const base = p.potential[id] | 0;
        if (state.locked.has(id)) {
          const v = prev.skill(id);
          p.potential[id] = v * 1000000 + (base % 1000000);
          p.setSkill(id, v);
        } else {
          const red = game.rng.rnd(Math.floor(base / 2000000) + 1) * 1000000;
          p.potential[id] = Math.max(1000000, base - red);
          p.setSkill(id, Math.floor(p.potential[id] / 1000000));
        }
      }
    }

    if (Elona.PCC) {
      try { await Elona.PCC.loadPalette(); } catch (_) { /* 无图时跳过 */ }
      if (!p.pcc) Elona.PCC.ensure(p, game.rng);
      Elona.PCC.preload(p).catch(() => {});
    }
    const st = Elona.Stats.calcMaxStats(p, { creatureId: 0 });
    p.hpMax = st.hpMax; p.mpMax = st.mpMax; p.spMax = st.spMax;
    p.hp = p.hpMax; p.mp = p.mpMax; p.sp = p.spMax;
    p.set(13, state.portrait | 0);
    state.player = p;
    return p;
  }

  /** 把 PCC 合成帧画到任意尺寸的 canvas（兼容旧 #pc-preview 与向导里的预览框） */
  function drawPreview(p, cv, opts) {
    if (!p || !cv || !Elona.PCC) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (opts && opts.portrait) return;
    const fr = Elona.PCC.frame(p, 0);
    if (fr) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(fr, 0, 0, 32, 48, 0, 0, cv.width, cv.height);
    }
  }

  /**
   * 天赋候选（*label_2697 → `gosub *label_0043` 的说明模式）：
   *   `Feat.available` 已按 `catOf(id) === 0` 与 `textStat === 1` 过滤。
   * 0-FH：源码**不**按等级过滤，因为已满级 / 已取得的天赋仍在「可取得」段里，
   *   玩家可反复选同一项升到下一级（285802-285837）。等级上限由向导按 maxLevel 判定。
   */
  function featCandidates(p) {
    if (!Elona.Feat || !p) return [];
    return Elona.Feat.available(p, game) || [];
  }

  async function doCreate(state) {
    const cs = state || createState;
    if (!cs || !cs.player) return;
    const p = cs.player;
    p.name = cs.name || 'Elona';
    p.set(13, cs.portrait | 0);
    // 0-FI：220533-220610 的别名（var_63(1)）与 221624-221644 的模式（var_65(273)）
    p.alias = cs.alias || '';
    p.title = cs.alias || '';
    p.cname = cs.alias ? `${p.name}「${cs.alias}」` : p.name;
    if (Elona.GameMode) Elona.GameMode.set(game, cs.mode | 0, false);
    UI.setLoading(true);
    try {
      await game.startGame(p, p.className, {
        feats: (cs.feats || []).slice(),
        skill: cs.skill | 0,
      });
      await renderer.loadSheet(game.map.tileset);
      await renderer.loadCharacterSheet();
      UI.clearMessages();
      for (const m of game.messages) UI.pushMessage(m);
      UI.show('game');
      startLoop();
      if (Elona.Audio) Elona.Audio.bgm('town');
      // 开场剧情：源码 602926-602928（新游戏 var_577==5 → var_1877=0 → gosub *label_4295）
      if (Elona.SceneView) {
        await Elona.SceneView.play(game, 0, {
          auto: !!(Elona.Options && Elona.Options.values.sceneAuto),
        }).catch(() => { /* 剧本缺失时不阻塞进入游戏 */ });
      }
      // 开场之后紧接着跑一次触发链：vernis（地图 5）在主任务状态 <9 时播区块 1
      if (Elona.Story) {
        await Elona.Story.onMapEnter(game, {
          auto: !!(Elona.Options && Elona.Options.values.sceneAuto),
        }).catch(() => {});
      }
    } catch (err) {
      alert('创建失败: ' + err.message);
    } finally {
      UI.setLoading(false);
    }
  }

  // ---------- 启动 ----------
  async function boot() {
    // 舞台缩放（0-FR）：画布保持 800×600 分辨率，只放大显示到 1.25 倍；
    // 窗口装不下时自动收小，避免被裁掉边框/消息窗。
    fitStage();
    // 窗口底色（原版 interface.bmp 的 144×96 纹理）先准备好：
    //   NPC/商店/掲示板这些 DOM 面板也用它，不能等到第一次开 Panels 才设 --pui-tile。
    if (Elona.Panels && Elona.Panels.paperTile) Elona.Panels.paperTile();
    // ---------- 启动预加载 ----------
    // 原来每个数据表都是「第一次用到才读」，首次进商店/施法/打开调合会卡一下。
    // 这里按 data/index/manifest.json 一次性读进内存（Data.fetchJson 自带缓存）。
    const bootEl = document.getElementById('boot-loading');
    if (Elona.Data && Elona.Data.preload) {
      try {
        const r = await Elona.Data.preload((d, t) => {
          if (bootEl) bootEl.textContent = `载入数据 ${d} / ${t} …`;
        });
        console.log(`[启动] 预加载 ${r.count} 个数据文件（约 ${(r.bytes / 1024).toFixed(0)} KB）`);
        if (r.failed.length) console.warn('[启动] 预加载失败:', r.failed);
      } catch (e) {
        // 清单缺失时不阻塞启动，退回原来的懒加载
        console.warn('[启动] 预加载跳过:', e.message);
      }
    }
    // 世界地图 site 表（var_132）：fish 的专属鱼池、牧场/农场判定都用它
    if (Elona.Sites) {
      await Elona.Sites.load();
      if (Elona.Towns && Elona.Towns.syncCoords) Elona.Towns.syncCoords();
      const st = Elona.Sites.stats();
      if (st) console.log(`[启动] site 表 ${st.count} 条 / ${st.worlds.length} 个世界地图 / ${st.names} 个名称`);
    }
    // 剧情推进表（check_quest 的 15 条规则）
    if (Elona.QuestCheck) {
      await Elona.QuestCheck.load();
      const qp = Elona.QuestCheck.table;
      if (qp) console.log(`[启动] 剧情推进规则 ${qp.count} 条`);
    }
    // 魔杖效果表（`*label_1934` 的 var_59 == 14 分支）
    if (Elona.Wand) {
      await Elona.Wand.load();
      const wt = Elona.Wand.table;
      if (wt) console.log(`[启动] 魔杖表 ${wt.count} 条`);
    }
    // 文本变量表（{player} / {ある} / {seOk} …）：`*label_0258` 的替换数据
    if (Elona.TextVar) {
      try {
        await Elona.TextVar.load();
        const vt = Elona.TextVar.data;
        console.log(`[启动] 文本变量表 ${vt.meta.funcCount} 个语气函数 / ${vt.meta.phraseCount} 条短语 / ${Object.keys(vt.se).length} 个音效标记`);
      } catch (e) {
        console.warn('[启动] 文本变量表加载失败:', e.message);
      }
    }
    // 物品使用效果表（*label_3016 的 147 个 effect 分支）
    if (Elona.ItemFx) {
      try {
        await Elona.ItemFx.load();
        const fx = Elona.ItemFx.stats();
        if (fx) console.log(`[启动] 物品使用效果 ${fx.total} 种 / ${fx.lines} 行；已实现 ${fx.done} 种`);
      } catch (e) {
        console.warn('[启动] 物品效果表加载失败:', e.message);
      }
    }
    // 同伴进化规则表（effect 58，360661-364083 的 167 条匹配规则）
    if (Elona.Evolution) {
      try {
        await Elona.Evolution.load();
        console.log(`[启动] 进化规则 ${Elona.Evolution.count()} 条`);
      } catch (e) {
        console.warn('[启动] 进化规则表加载失败:', e.message);
      }
    }
    // NPC 自定义对话（user/talk/*.txt → data/talk/*.json）
    if (Elona.Talk) {
      const tk = await Elona.Talk.preloadAll();
      if (tk.count) console.log(`[启动] 自定义对话 ${tk.count} 份：${tk.files.join(', ')}`);
    }
    // 固定 NPC 对话脚本（*label_3035..3038，172 个种族分支）
    // 表有 2.8MB，不参与启动等待 —— 后台下载，首次搭话前大概率已就绪；
    // 没就绪时 openNPC 会退回通用问候。
    if (Elona.Dialogue) {
      Elona.Data.table('talkscripts').then((t) => {
        if (Elona.Dialogue.setTable(t)) {
          const bs = t.branches || [];
          const run = bs.filter((b) => b.runnable).length;
          console.log(`[启动] 固定 NPC 对话 ${bs.length} 个分支 / ${t.meta.instrCount} 条指令；`
            + `可直接运行 ${run} 个，依赖未移植子程序 ${bs.length - run} 个`);
        }
      }).catch((e) => console.warn('[启动] 固定 NPC 对话表加载失败:', e.message));
    }
    if (bootEl) bootEl.remove();

    titleScreen = new Elona.TitleScreen(document.getElementById('title-canvas'), {
      hasSave: async () => !!(await Elona.Save.latest()),
      onNew: async () => {
        titleScreen.stop();
        UI.show('create');
        try {
          await initCreate();
        } catch (e) {
          alert('角色创建数据加载失败: ' + e.message);
          UI.show('menu');
          titleScreen.start();
        }
      },
      onLoad: async () => {
        const slot = await Elona.Save.latest();
        if (slot) doLoad(slot);
      },
    });
    titleScreen.start();

    // 消息 → 消息窗（game.log 的回调）
    game.onMessage = (text) => UI.pushMessage(text);
    // 地图切换后重载图块表 + 切换环境音
    game.onMapChange = (map) => {
      renderer.loadSheet(map.tileset).catch(() => { });
      if (Elona.Audio) {
        if (game.dungeonDepth > 0) Elona.Audio.bgm('field');
        else Elona.Audio.bgm('town');
      }
    };
    // 选项应用（音量/音效开关等）
    if (Elona.Options) Elona.Options.apply();

    Elona.game = game;
    Elona.renderer = renderer;
    // 0-FS：告示板的「タイルグループ変更」换图块组后要重新载入 map<N>.bmp
    Elona.reloadTilesetSheet = (n) => {
      const p = renderer.loadSheet(n | 0);
      if (p && p.then) p.then(() => { renderer.lastMove = performance.now(); }).catch(() => { });
      return p;
    };
  }

  /**
   * 0-FR：舞台缩放。原版窗口固定 800×600，这里不改画布分辨率，
   * 只用 CSS transform 放大到 `--stage-scale`（默认 1.25 倍），
   * 同时把「面板 / 物品窗 / 消息栏」一起放大（它们都在 .stage 里）。
   * 若浏览器窗口小于放大后的尺寸，则按可用空间收小，避免画面被裁。
   */
  const STAGE_BASE = 1.25;
  function fitStage() {
    const w = (typeof window !== 'undefined' && window.innerWidth) || 0;
    const h = (typeof window !== 'undefined' && window.innerHeight) || 0;
    let s = STAGE_BASE;
    if (w > 0 && h > 0) s = Math.min(STAGE_BASE, w / 800, h / 600);
    s = Math.max(0.5, Math.min(STAGE_BASE, s));
    if (typeof document !== 'undefined' && document.documentElement
      && document.documentElement.style && document.documentElement.style.setProperty) {
      document.documentElement.style.setProperty('--stage-scale', String(s));
    }
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', fitStage);
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window);
