'use strict';
/**
 * 表现层 —— HUD / 消息窗口 / 界面切换
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  // 0-BW：菜单快捷键字母（原版 var_446，start.hsp 597716："a","b",…,"s" 共 19 个；
  //       绘制由 display_key(36940) 完成，按键匹配见 272555-272560）
  const KEY_LETTERS = 'abcdefghijklmnopqrs';

  const UI = {
    el(id) { return document.getElementById(id); },

    show(screenId) {
      for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
      this.el(screenId).classList.add('active');
    },

    setLoading(on) {
      this.el('loading').classList.toggle('hidden', !on);
    },

    /** 消息历史（由 renderer.drawMessages 折行后绘制，原版保留 31 行缓冲） */
    messages: [],
    msgVersion: 0,

    pushMessage(text) {
      this.messages.push(String(text));
      if (this.messages.length > 31) this.messages.splice(0, this.messages.length - 31);
      this.msgVersion++;
    },

    clearMessages() {
      this.messages.length = 0;
      this.msgVersion++;
    },

    rebuildMessages(msgs) {
      this.messages = (msgs || []).slice(-31).map(String);
      this.msgVersion++;
    },

    // ---------- 背包 / 物品选择（Canvas 绘制，见 renderer.drawInventory） ----------
    invOpen: false,
    invMode: 'bag',   // bag | book | identify | throw | offer | equip | equip-pick | use | spell
    invSel: 0,
    /** 道具的知识窗（*label_2833）：正在看的物品 = var_579；null = 没开 */
    invInfo: null,
    invInfoPage: 0,
    /** 情報切替（var_2251）：列表右栏改为显示各元素耐性 */
    invInfoCols: false,
    /** 装备窗（装備品）当前行；equipSlotN = 正在挑选物品的槽（*label_2815 的 var_1090） */
    equipSel: 0,
    equipSlotN: -1,
    useMode: 0,
    identifyPower: 0,

    toggleInventory(game, mode) {
      const want = mode || 'bag';
      if (this.invOpen && this.invMode === want) { this.closeInventory(); return false; }
      this.openInventory(game, want);
      return true;
    },

    openInventory(game, mode) {
      // 0-DG：同一时间只允许一个窗口 —— 打开物品窗口前关掉信息面板与其它弹窗
      if (Elona.Panels && Elona.Panels.isOpen && Elona.Panels.isOpen()) Elona.Panels.close();
      for (const id of ['npc', 'shop', 'quest']) {
        const el = this.el(id);
        if (el) el.classList.add('hidden');
      }
      this.invMode = mode;
      this.invSel = 0;
      this.invOpen = true;
      this.invalidateInventory();
    },

    /**
     * 0-DG：关掉所有其它窗口（信息面板 / NPC / 商店 / 委托板），保证「一次只开一个窗口」。
     * 物品窗口（Canvas 绘制）由调用方另行 closeInventory()。
     */
    closeOtherWindows() {
      if (Elona.Panels && Elona.Panels.isOpen && Elona.Panels.isOpen()) Elona.Panels.close();
      for (const id of ['npc', 'shop', 'quest']) {
        const el = this.el(id);
        if (el) el.classList.add('hidden');
      }
    },

    /** 魔法/能力选择（v 键） */
    openSpells(game) { this.openInventory(game, 'spell'); },
    /**
     * 装备窗（w → *label_2815，「装備品」）。行 = 身体部位（种族 var_121(1) 决定），
     * 回车在空部位上打开该部位可穿的物品列表（var_486 = 6 Wear）。
     */
    openEquip(game) {
      if (Elona.Equipment) Elona.Equipment.ensureSlots(game.player);
      this.equipSlotN = -1;
      this.openInventory(game, 'equip');
      this.equipSel = 0;
    },

    /** 装备窗的行（*label_2815 的 var_484 表） */
    equipmentRows(game) {
      if (!game || !game.player || !Elona.Equipment) return [];
      return Elona.Equipment.slots(game.player);
    },
    /** 使用选择（t/r/q → var_486=14/7/8） */
    openUse(game, modeHint) {
      this.useMode = modeHint || 0;
      // 0-GU：把 useMode 反查成 var_486，供窗口标题 / 命令条使用
      const cmd = { 14: 5, 13: 7, 15: 8 }[this.useMode | 0] || 14;
      if (Elona.ItemCmd) Elona.ItemCmd.setCurrent(game, cmd);
      this.openInventory(game, 'use');
    },

    /**
     * 0-GU / 299322-299344：Tab 切换物品命令。
     *   原版在整组（var_553(0,var_399)）内环绕；本项目只在窗口内直接支持的
     *   4 条（吃 / 读 / 喝 / 使用）之间切换，其余命令仍由各自按键进入（A509）。
     */
    cycleItemCmd(game, delta) {
      const IC = Elona.ItemCmd;
      if (!IC) return null;
      if (!IC.current(game)) {
        const cmd = { 14: 5, 13: 7, 15: 8 }[this.useMode | 0] || 14;
        IC.setCurrent(game, cmd);
      }
      const r = IC.cycle(game, delta, IC.IN_WINDOW);
      if (r.ok) {
        const f = IC.useFilter(r.id);
        if (f >= 0) this.useMode = f;
        this.invalidateInventory();
      }
      return r;
    },

    openThrow(game) { this.openInventory(game, 'throw'); },
    openOffer(game) { this.openInventory(game, 'offer'); },
    openIdentify(game, power) {
      this.identifyPower = power | 0;
      this.openInventory(game, 'identify');
    },

    closeInventory() {
      this.invOpen = false;
      this.invMode = 'bag';
      this.equipSlotN = -1;
      this.invInfo = null;
      this.invInfoPage = 0;
      this._invRows = null;
    },

    // ---------- 道具的知识窗（*label_2833 300264-300330） ----------
    /**
     * 打开道具的知识窗。原版入口有三处：
     *   物品列表里按 x（或 var_486 == 1 的 Examine 模式按回车，297350 `gosub *label_2832`）、
     *   装备窗里按 x（295825 的 `var_138 == var_169`）。
     * @param {object} game
     * @param {object} it 物品实例（装备窗里传槽上的物品）
     */
    openInvInfo(game, it) {
      if (!it) { this.pushMessage('那里没有道具。'); return false; }
      this.invInfo = it;
      this.invInfoPage = 0;
      return true;
    },
    closeInvInfo() { this.invInfo = null; this.invInfoPage = 0; },
    turnInvInfoPage(delta) {
      const n = (this.invInfoPage | 0) + (delta | 0);
      this.invInfoPage = n < 0 ? 0 : n;
    },
    /** 情報切替（var_2251）：z 键切换列表右栏 */
    toggleInvInfoCols() {
      this.invInfoCols = !this.invInfoCols;
      return this.invInfoCols;
    },
    /** 装备窗按 x：取当前槽上的物品 */
    openEquipInfo(game) {
      const eq = this.equipmentRows(game);
      const row = eq[this.equipSel | 0];
      if (!row || !row.item) { this.pushMessage('那里没有装备。'); return false; }
      return this.openInvInfo(game, row.item);
    },
    /** 装备窗按 * ：保持指定（与物品列表同一个 ibit 13） */
    toggleKeep(game) {
      const row = this.inventoryRows(game)[this.invSel | 0];
      if (!row || typeof row !== 'object' || !Elona.ItemDB) return;
      const on = !(Elona.ItemDB.ibit(13, row) | 0);
      Elona.ItemDB.ibitmod(13, row, on);
      this.pushMessage(on ? '指定为「重要物品」（不会误丢/误卖）。' : '解除了「重要物品」的指定。');
    },

    invalidateInventory() { this._invRows = null; },

    /** 构建当前模式下的可见行（缓存，供 renderer.drawInventory 使用） */
    inventoryRows(game) {
      if (this._invRows) return this._invRows;
      const rows = [];
      if (this.invMode === 'bag') {
        for (const it of game.player.inv) {
          if (it && it.f[0] > 0) rows.push(it);
        }
      } else if (this.invMode === 'identify') {
        for (const it of game.player.inv) {
          if (it && it.f[0] > 0 && (it.f[8] | 0) < 3) rows.push(it);
        }
      } else if (this.invMode === 'throw') {
        for (const it of game.player.inv) {
          if (!it || it.f[0] <= 0) continue;
          if (Elona.Throw && Elona.Throw.canThrow(game.player, game.player.inv.indexOf(it)).ok) rows.push(it);
        }
      } else if (this.invMode === 'offer') {
        for (const it of game.player.inv) {
          if (it && it.f[0] > 0) rows.push(it);
        }
      } else if (this.invMode === 'equip') {
        // 装备窗本身画的是部位表（renderer.drawEquipWindow），不是物品列表
      } else if (this.invMode === 'equip-pick') {
        // 296344：Wear 模式只列「能穿进这个部位」的物品（手↔遠隔 可互换）
        const p = game.player;
        const row = this.equipmentRows(game).find((r) => r.n === (this.equipSlotN | 0));
        const type = row ? row.type : 0;
        if (type && Elona.Equipment) {
          for (const it of Elona.Equipment.candidates(p, type)) rows.push(it);
        }
      } else if (this.invMode === 'use') {
        // 0-DF：脚下的物品优先列出（源码 296199 的 `repeat 2`：cnt=0 = 地图物品，
        //   cnt=1 = 背包）。原版站在床 / 料理器具 / 工具上按 t 时会先出现这些。
        // 0-DG：收录条件改为源码 296364 的判定（usableInList），纯装饰家具不再出现。
        // 0-FF：阅读窗（var_486 == 7）按源码 296304 过滤 —— `refitem(id, 2) != 0` 才是可读物；
        //   站在世界地图上时源码 296253 再收紧为「`refitem(id, 9) == 53100` 或 621」，
        //   产权书（542 畑 / 572 牧場 / 543 倉庫 …）正是 53100 这一档，所以它们只在
        //   世界地图的阅读窗里出现。
        const pp = game.player;
        const readMode = (this.useMode | 0) === 13;
        const worldRead = readMode && !!game.worldMap;
        const readable = (it) => {
          if (!Elona.ItemDB || !Elona.ItemDB.ref) return false;
          if (!(Elona.ItemDB.ref(it.id, 2) | 0)) return false;
          if (worldRead) {
            return (Elona.ItemDB.ref(it.id, 9) | 0) === 53100 || (it.id | 0) === 621;
          }
          return true;
        };
        const useFilter = (it) => {
          if (readMode) return readable(it);
          if (this.useMode && !Elona.ItemUse.entryOf(it.id, this.useMode)
            && !(Elona.ItemDB.produceKitType(it.id) > 0)) return false;
          if (!this.useMode && !this.usableInList(it)) return false;
          return true;
        };
        for (const it of (game.groundItems || [])) {
          if (!it || (it.f[0] | 0) <= 0) continue;
          if ((it.f[5] | 0) !== (pp.x | 0) || (it.f[6] | 0) !== (pp.y | 0)) continue;
          if (!useFilter(it)) continue;
          it._onGround = true;
          rows.push(it);
        }
        for (const it of game.player.inv) {
          if (!it || it.f[0] <= 0 || it.eqSlot >= 0) continue;
          if (!useFilter(it)) continue;
          it._onGround = false;
          rows.push(it);
        }
      } else if (this.invMode === 'spell') {
        const st = game.player.spellStock || [];
        for (let i = 0; i < 200; i++) if ((st[i] | 0) > 0) rows.push(400 + i);
      } else {
        // 图鉴：按 id 升序展示全部物品（使用名称表数据，不创建实例）
        const ids = Object.keys(Elona.ItemDB.data).map(Number).sort((a, b) => a - b);
        for (const id of ids) rows.push(id);
      }
      this._invRows = rows;
      return rows;
    },

    inventoryPageCount(game) {
      return Math.max(1, Math.ceil(this.inventoryRows(game).length / 16));
    },

    moveSelection(game, delta) {
      if (this.invMode === 'equip') {
        const eq = this.equipmentRows(game);
        if (!eq.length) { this.equipSel = 0; return; }
        let i = (this.equipSel | 0) + delta;
        if (i < 0) i = 0;
        if (i >= eq.length) i = eq.length - 1;
        this.equipSel = i;
        return;
      }
      const rows = this.inventoryRows(game);
      if (!rows.length) { this.invSel = 0; return; }
      let i = (this.invSel | 0) + delta;
      if (i < 0) i = 0;
      if (i >= rows.length) i = rows.length - 1;
      this.invSel = i;
    },

    /** 装备窗里直接按 a..n 跳到第 i 行（原版 display_key + var_138 匹配，i 是当前页内的行号） */
    selectEquipRow(game, i) {
      const eq = this.equipmentRows(game);
      const page = Math.floor((this.equipSel | 0) / 14);       // var_893 = 14
      const n = page * 14 + (i | 0);
      if (n >= 0 && n < eq.length) this.equipSel = n;
    },

    activateSelected(game) {
      if (this.invMode === 'equip') { this.activateEquipSlot(game); return; }
      const rows = this.inventoryRows(game);
      const row = rows[this.invSel | 0];
      if (row === undefined) return;
      this.activateInventoryRow(game, row);
    },

    /**
     * 装备窗的回车（295760-295820）：
     *   有装备 → 卸下；空部位 → 打开该部位的物品列表（var_486 = 6）。
     */
    activateEquipSlot(game) {
      const E = Elona.Equipment;
      if (!E) return;
      const eq = this.equipmentRows(game);
      const row = eq[this.equipSel | 0];
      if (!row) return;
      if (row.itemIdx >= 0) {
        const r = E.unequip(game, row.n);
        if (r.message) this.pushMessage(r.message);
        this.invalidateInventory();
        if (r.ok) this.afterEquipChange(game);
        return;
      }
      const cand = E.candidates(game.player, row.type);
      if (!cand.length) {
        this.pushMessage(`${E.typeName(row.type)}没有可以装备的物品。`);
        return;
      }
      this.equipSlotN = row.n;
      this.invMode = 'equip-pick';
      this.invSel = 0;
      this._invRows = null;
    },

    /** 装备变化后的数值重算（*label_2174 / label_2225） */
    afterEquipChange(game) {
      if (Elona.Stats) {
        Elona.Stats.applyEquipment(game.player, game);
        Elona.Stats.applySkillCorrections(game.player, game);
        Elona.Stats.refreshSpeed(game.player, game);
      }
      if (Elona.Feat && Elona.Feat.applyWeight) Elona.Feat.applyWeight(game.player, game);
      if (game.endTurn) game.endTurn();
    },

    /** 执行选中行（对应原版 cs_list 的确定动作） */
    activateInventoryRow(game, row) {
      if (!row) return;
      if (this.invMode === 'spell') {
        const r = game.castPlayerSpell(row);
        // 【A115】方向系（`var_938 == 8000`）法术：源码 315663-315707 先
        //   「どの方向？」（*label_2893 八方向箭头）再取该格角色，邻格没人
        //   则 `var_2421 = 1` 对地发动。此前是自动索敌，现在统一走瞄准。
        if (r && r.reason === 'need-direction' && Elona.DirSel) {
          this.closeInventory();
          const range = Elona.DirSel.rangeOf(row);
          Elona.DirSel.startSpellTarget(game, row, range);
          this.pushMessage('朝哪个方向咏唱？（方向键 / 小键盘 1-9，Esc 取消）');
          return;
        }
        // 类别 7000（造墙/造门/酸/火墙…）：原版走 `*label_2670` 的**全屏光标**
        //   （315731 `gosub *label_2670`），可以在射程内任意移动光标，不是八方向一格。
        if (r && r.reason === 'need-tile' && Elona.Aim && Elona.Panels) {
          const f3 = Elona.Spell ? Elona.Spell.field(row, 3) : 0;
          this.closeInventory();
          Elona.Panels.pendingSpell = row | 0;
          Elona.Panels.pendingSpellRange = (f3 % 1000) + 1;
          Elona.Panels.openAimFree(game);
          this.pushMessage('要指定哪一格？（方向键移动光标，回车确认，Esc 取消）');
          return;
        }
        if (r && r.request && Elona.consumeSpellRequest) Elona.consumeSpellRequest(r);
        this.closeInventory();
        return;
      }
      if (this.invMode === 'identify') { this.doIdentify(game, row); return; }
      if (this.invMode === 'throw') {
        const idx = game.player.inv.indexOf(row);
        const r = game.beginThrow(idx);
        if (r && r.ok) {
          this.closeInventory();
          // 0-EP：原版投掷是「用 `*label_2670` 的准星选目标 → 抛物线」，不是点地图格。
          //   这里改成 `*` 键式的自由光标：方向键移动、回车锁定、Esc 取消。
          if (Elona.Panels && Elona.Panels.openAimFree && Elona.Aim) {
            Elona.Panels.pendingThrow = idx;
            Elona.Panels.openAimFree(game);
            this.pushMessage('投到哪里？（方向键移动光标，回车锁定，Esc 取消）');
          } else {
            this.pushMessage('请点击地图选择投掷目标（Esc 取消）。');
          }
        } else {
          this.pushMessage(r && r.reason === 'too-heavy' ? '太重了，无法投掷。' : '无法投掷该物品。');
        }
        return;
      }
      if (this.invMode === 'equip-pick') {
        const idx = game.player.inv.indexOf(row);
        const n = this.equipSlotN | 0;
        const r = Elona.Equipment ? Elona.Equipment.equip(game, n, idx) : null;
        if (r && r.message) this.pushMessage(r.message);
        if (r && r.ok) this.afterEquipChange(game);
        // 297855：装好后回到装备窗，光标停在刚才的槽上
        this.invMode = 'equip';
        this.invSel = 0;
        this.equipSlotN = -1;
        this.invalidateInventory();
        const eq = this.equipmentRows(game);
        this.equipSel = Math.max(0, eq.findIndex((x) => x.n === n));
        return;
      }
      if (this.invMode === 'use') {
        // 0-DF：地面物品 → useGroundItem（使用后未消耗则放回原格）
        const onGround = !!row._onGround && (game.groundItems || []).indexOf(row) >= 0;
        const idx = game.player.inv.indexOf(row);
        let r = onGround ? game.useGroundItem(row) : game.useItem(idx, this.useMode || 0);
        // effect 115 药水栓发射器：对非敌对目标原版会弹 y/n（*label_2838）。
        // 背包里「选中并使用」本身就是一次明确操作，这里直接当作确认（差异表 A363）。
        if (r && r.effect === 115 && r.reason === 'confirm') {
          r = game.useItem(idx, this.useMode || 0, { confirm: true });
        }
        // 0-EP：31 个「誰が使用する？」效果 —— 原版**无条件**先 `gosub *label_2893`
        //   （在玩家周围画 8 个箭头，方向键选一格邻格，回车 = 自己，越界/空邻格 = 没有目标）。
        //   `passEmpty` 让「邻格没人」以 `target: null` 传到效果本体（它自己打印提示）。
        if (r && r.reason === 'need-direction' && r.neighbor && Elona.DirSel
            && (idx >= 0 || onGround)) {
          this.closeInventory();
          Elona.DirSel.startItem(game, idx, 1, onGround ? row : null, {
            allowSelf: true,
            passEmpty: true,
          });
          this.pushMessage('对谁使用？（方向键选邻格，回车 = 自己，Esc 取消）');
          return;
        }
        // 0-EP：效果本体在做完前置判断后，可能要一次 UI（输入 / 确认 / 选部位 / 选元素 / 选镜子）
        if (r && Elona.ItemFxUse && Elona.ItemFxUse.handles(r.effect)
            && (r.reason === 'tag-pick' || r.action)) {
          this.closeInventory();
          this._itemFxFollow(game, r, { idx, onGround, row });
          return;
        }
        // 0-EN/0-EO：原版先用 `*label_2893` 选方向再结算的用法 ——
        //   进化道具 58（360664）、调味料 93（354575）、梳妆台 19（350569）等
        //   「誰に使用する？」效果，以及魔杖的「どの方向に振る？」（315827）。
        //   这里关掉物品窗交给 core/dirsel.js 的 item 档（八方向箭头，按即结算）。
        if (r && r.reason === 'need-direction' && Elona.DirSel
            && (idx >= 0 || onGround)) {
          this.closeInventory();
          Elona.DirSel.startItem(game, idx, 1, onGround ? row : null, {
            allowSelf: !!r.allowSelf,
            allowEmpty: !!r.allowEmpty,
          });
          this.pushMessage(r.allowSelf
            ? '对谁使用？（方向键 / 小键盘 1-9 选人，回车 = 自己，Esc 取消）'
            : '按哪个方向使用？（方向键 / 小键盘 1-9，Esc 取消）');
          return;
        }
        // 0-EN：目标正在骑乘 → 骑乘者 / 坐骑 二选一（360681-360703）
        if (r && r.reason === 'riding' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openEvolveRiding(game, onGround ? row : idx, r.target, r.mount);
          return;
        }
        // 0-EL：X框架 → 选瓶塞发射器 + 选机能（effect 138，357364-357430）
        if (r && r.action === 'xframe' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openXFrame(game, r.item || row, r);
          return;
        }
        // 书架 → 容器窗口（*label_3016 effect 74，356065-356088）
        if (r && r.action === 'container' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openContainerPanel(game, r.item);
          return;
        }
        // 坐具 → 坐下菜单（*label_3016 effect 44，349999-350071）
        if (r && r.action === 'sit' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openSitMenu(game, r.item);
          return;
        }
        // 0-DN：梳妆台 → 隐藏部位面板（*label_2809，295248；itemfx effect 19）
        if (r && r.action === 'dressup' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openDressPanel(game, r.target);
          return;
        }
        // 0-DN：写作台 → 菜单（350092-350099；itemfx effect 114）
        if (r && r.action === 'writing-desk' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openDeskMenu(game, r.item);
          return;
        }
        // 0-FS：自宅的房屋告示板（233240-233300）→ 装修 / 家の情報 / 滞在 / 雇人 …
        if (r && r.action === 'home-board' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openHomeBoard(game, r);
          return;
        }
        // 0-DN：留言板 / 家产清单（232969-233030；itemfx effect 8）
        if (r && r.action === 'board' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openBoard(game, r.lines || []);
          return;
        }
        // 0-FP：店铺里的收款机 562 → 自营店收款机面板（233240-233265）
        if (r && r.action === 'shop-register' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openShopRegister(game, r.siteId);
          return;
        }
        // 0-DO：ヤカテクト积分卡 → 兑换菜单（359211-359469，itemfx 108）
        if (r && r.action === 'yaca' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openYaca(game);
          return;
        }
        // 0-FK：能力複合機 → 基因合成（效果 32）
        if (r && r.action === 'gene-machine' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openGeneMachine(game, r.item);
          return;
        }
        // 0-DO：如意耳かき → 三项菜单（359534-359570，itemfx 116）
        if (r && r.action === 'mimikaki' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openMimikaki(game, r.item, r.target, r.options);
          return;
        }
        // 0-DO：邪成鎌ネクロマンティス → 融合配方（355215-355537，itemfx 91）
        if (r && r.action === 'necro-fuse' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openNecroFuse(game);
          return;
        }
        // 0-DQ：烹饪器具 → 选食材（319873-319892；itemfx effect 15）
        if (r && r.action === 'cook' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openCook(game, r.tool);
          return;
        }
        // 生产工具 → 打开生产窗口（348854-348859）
        if (r && r.action === 'produce' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openProduce(game, r.kit);
          return;
        }
        // 存钱箱 → 银行窗口
        if (r && r.action === 'bank' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openBank(game, r.idx);
          return;
        }
        // 【A120】徵税士の納税箱（616）→ 纳付窗口（`var_486 = 24, 2`）
        if (r && r.action === 'taxbox' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openTaxBox(game);
          return;
        }
        // 0-CX：深淵魔術書 → 打开深淵法术菜单
        if (r && r.action === 'abyss-book' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openAbyssMenu(game);
          return;
        }
        // 0-DB：操作面板（1199）→ 收容所运营面板
        if (r && r.action === 'camp-manage' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openCamp(game);
          return;
        }
        // 钓竿 → 先问「钓几小时」（320007-320014）
        if (r && r.action === 'fish-hours' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openFishHours(game, r.rodIdx, r.spPaid);
          return;
        }
        // 0-DH：調教鞭 → 选择同伴 → 管教菜单
        if (r && r.action === 'tamer-whip' && Elona.Panels) {
          this.closeInventory();
          const list = Elona.Companion.activeAllies(game);
          if (list.length === 1) Elona.Panels.openTamerWhip(game, list[0]);
          else Elona.Panels.openAllySelect(game, '谁需要管教？', list, (c) => {
            Elona.Panels.openTamerWhip(game, c);
          }, 'a~p 选择　Esc 关闭');
          return;
        }
        // 0-DG：指挥旗 → 战术指示（全体同伴的战斗模式）
        if (r && r.action === 'tactical' && Elona.Panels) {
          this.closeInventory();
          Elona.Panels.openTactical(game);
          return;
        }
        // 使用效果若是 UI 请求（如鉴定卷轴 → 411），交给 main.js 消费
        if (r && r.result && r.result.request && Elona.consumeSpellRequest) {
          Elona.consumeSpellRequest(r.result);
        }
        // effect 115：装填与射击都算一次行动（源码统一 goto *label_3017）
        if (r && r.effect === 115 && r.ok) {
          this.closeInventory();
          if (game.endTurn) game.endTurn();
          return;
        }
        this.closeInventory();
        return;
      }
      if (this.invMode === 'offer') {
        const idx = game.player.inv.indexOf(row);
        const r = Elona.MapFeat.offer(game, game.player, idx);
        if (r && r.ok) {
          if (r.contested) this.pushMessage(`${r.name} 守护住了祭坛。`);
          else if (r.takenOver) this.pushMessage(`你夺取了祭坛，${r.name} 的虔诚提升了。`);
          else this.pushMessage(`你把 ${Elona.ItemDB.name(row.id, 'en')} 献给了 ${r.name}。`);
          game.endTurn();
        } else if (r && r.reason === 'no-faith') {
          this.pushMessage('你没有信仰任何神。');
        } else {
          this.pushMessage('献祭失败。');
        }
        this.closeInventory();
        return;
      }
      // bag / book：查看说明（原版 var_486=1 Examine）
      //   297350：Examine 模式按回车 → `gosub *label_2832` → 道具的知识窗（300264）
      if (this.invMode === 'bag' && typeof row === 'object') {
        this.openInvInfo(game, row);
        return;
      }
      const id = (typeof row === 'number') ? row : row.id;
      const desc = Elona.ItemDB.desc(id, 'en');
      this.pushMessage(`${Elona.ItemDB.name(id, 'en')}${desc ? ' — ' + desc : ''}`);
    },

    /**
     * 0-EP：`core/itemfx_use.js` 的后续步骤分派。
     *
     * 一次「使用」可能分成好几段：邻格选人 → タッグ二选一 → 输入文本 / 确认 / 选部位 …
     * 每个中间结果都回到这里，用 `Elona.ItemFxUse.resolve` / `resolveTag` 续接。
     *
     * @param {object} game
     * @param {object} r    ItemFxUse 返回的结果
     * @param {object} [ctx] { idx, onGround, row } —— 只有「选完镜子还要选人」时需要
     */
    _itemFxFollow(game, r, ctx) {
      if (!r) return;
      if (r.message) this.pushMessage(r.message);
      for (const m of (r.messages || [])) this.pushMessage(m);
      const P = Elona.Panels;
      const U = Elona.ItemFxUse;
      if (!r.ok && !r.reason && !r.action) return;

      // 还需要一次邻格选择（效果 150 选完镜子之后）
      if (r.reason === 'need-direction' && r.neighbor) {
        if (Elona.DirSel && ctx && (ctx.idx >= 0 || ctx.onGround)) {
          Elona.DirSel.startItem(game, ctx.idx, 1, ctx.onGround ? ctx.row : null, {
            allowSelf: true, passEmpty: true,
          });
          this.pushMessage('对谁使用？（方向键选邻格，回车 = 自己，Esc 取消）');
        }
        return;
      }
      // 搭档二选一
      if (r.reason === 'tag-pick' && P) {
        P.openTagPick(game, r.options, (chara) => {
          this._itemFxFollow(game, U.resolveTag(game, chara), ctx);
        });
        return;
      }
      // 文本输入（种族 59 / 职业 60）
      if ((r.action === 'race-input' || r.action === 'class-input') && P) {
        P.openTextInput(r.title || '输入', '', (text) => {
          this._itemFxFollow(game, U.resolve(game, text), ctx);
        }, { note: r.action === 'race-input' ? '输入新的种族名（留空 = 放弃）。' : '输入新的职业名（留空 = 放弃）。' });
        return;
      }
      // y/n 确认（星光笔 62）
      if (r.action === 'confirm' && P) {
        P.openConfirm(r.title || '发动吗？', (yes) => {
          this._itemFxFollow(game, U.resolve(game, yes), ctx);
        });
        return;
      }
      // 部位 / 元素选择（73 / 85）
      if ((r.action === 'body-pick' || r.action === 'element-pick') && P) {
        // 注意：`chooseRow` 的 onPick 会先 close() 再回调，所以这里不能挂
        // `onClose → abort`（否则回调前就把会话清掉了）。中途取消留下的残状态
        // 由 `ItemFxUse.dispatch` 的「没有 target/resume 就开新会话」规则兜住。
        P.chooseRow(r.title || '选择', r.options || [], (i) => {
          this._itemFxFollow(game, U.resolve(game, i), ctx);
        });
        return;
      }
      // 0-GA：通用选项菜单（*label_2896 / txtselecttc，指挥旗 57 / 存钱箱 99 /
      //   巧克力 64 / 栽培 106 / 佯攻 153 / 撒饵 101）
      if (r.action === 'choice' && P) {
        P.chooseRow(r.title || '选择', r.options || [], (i) => {
          this._itemFxFollow(game, U.resolve(game, i), ctx);
        });
        return;
      }
      // 0-GA：选一件背包道具（*label_2824，78 / 94 / 96 / 129 / 136）
      if (r.action === 'item-pick' && P) {
        P.openItemPicker(game, {
          title: r.title || '选择道具',
          filter: r.filter || null,
          onPick: (ii, it) => {
            this._itemFxFollow(game, U.resolve(game, it), ctx);
          },
          onCancel: () => {
            this._itemFxFollow(game, U.resolve(game, null), ctx);
          },
        });
        return;
      }
      // 镜子选择（150，`var_486 = 23, 33` → 只列 504 号「卡片」）
      if (r.action === 'mirror-pick' && P) {
        P.openItemPicker(game, {
          title: r.title || '要使用哪面镜子？',
          hint: '↑↓ 选择　Esc 取消',
          filter: (it) => (it.id | 0) === 504,
          onPick: (ii, it) => {
            this._itemFxFollow(game, U.resolve(game, it), ctx);
          },
          onCancel: () => {
            this._itemFxFollow(game, U.resolve(game, null), ctx);
          },
        });
        return;
      }
      // 人物信息窗（洞察透镜 72，`gosub *label_2784`）
      if (r.action === 'chara-info' && P) {
        P.openCharaInfo(game, r.target);
        return;
      }
    },

    /** 执行一次鉴定（item_identify(item, -1, var_578)） */
    doIdentify(game, it) {
      if (!it) return;
      const lv = Elona.ItemDB.identify(it, -1, this.identifyPower || 0);
      if (!lv) {
        this.pushMessage('鉴定失败：需要更高的鉴定等级。');
        return;
      }
      this.pushMessage(`鉴定成功：${Elona.ItemDB.name(it.id, 'en')}（等级 ${lv}）。`);
      this.invalidateInventory();
      // 鉴定是一次行动
      if (game.endTurn) game.endTurn();
    },

    /**
     * 「使用」列表（t 键，var_486 == 14）的收录条件 —— 忠实实现源码 296363-296366：
     *
     *   条件是「全真才 continue」，即满足任一条件才留在列表里：
     *     var_99(19) != 0        物品实例的使用类型（床/料理器具等放置物）
     *     refitem(id,11) != 0    物品定义的可使用标志（原文 167 种：床/缝纫工具/听诊器…）
     *     ibit(10) / ibit(15)    物品实例位标记
     *     refitem(id,5) == 52000 药水类（52000 是「ポーション」而不是家具，见 A322）
     *
     * 0-DG：0-DF 曾把 60000（家具）当成乐器、把 59000（工具）当成钓竿而一律收录，
     *   导致树/花/雕像/长椅等纯装饰家具出现在使用列表里，选中后「什么也没有发生」。
     */
    usableInList(it) {
      if (!it) return false;
      const id = it.id | 0;
      const DB = Elona.ItemDB;
      if (!DB || !DB.data) return false;
      // 源码条件（顺序与 296364 一致）
      if ((it.f[19] | 0) !== 0) return true;
      if ((DB.ref(id, 11) | 0) !== 0) return true;
      if (DB.ibit && (DB.ibit(10, it) || DB.ibit(15, it))) return true;
      if ((DB.ref(id, 5) | 0) === 52000) return true;
      // 本项目已实现、但定义里没有 var_657 标志的专例（源码走 2947/2948/3080 等专用例程）
      if (this.SPECIAL_USE.has(id)) return true;
      return false;
    },

    /** 有专用使用例程的物品 id（与 Game.useItem 的分派一一对应） */
    SPECIAL_USE: new Set([
      615,    // 請求書（缴税）
      685, 699,   // モンスターボール / リトルボール
      687,    // 解読用石（深淵魔力）
      903,    // 暗之棺
      959,    // <Melodyus> 乐器
      1097,   // ヤカテクトの預金箱
      1174,   // 作物管理セット
      920,    // 有機肥料（効果 65 → Farm.fertilize）
      682,    // クミロミの活性化の宝玉（効果 31 → Farm.reviveOrGrow）
      1199,   // 操作面板（收容所）
      1249,   // 深淵魔術書
      521, 1296, 522, 542, 543, 572, 712, 909,   // 产权书（就地建造）
      344, 897,                                  // 0-FS：家の権利書 / 引越しの権利書
    ]),

    /** 原有的宽松判定（保留给其它入口，不用于 t 键列表） */
    hasAnyUse(id) {
      if (Elona.ItemDB) {
        const cat = Elona.ItemDB.ref(id, 5);
        if (cat === 57000 || cat === 91000 || Elona.ItemDB.ref(id, 24) === 35) return true;
        if (Elona.ItemDB.produceKitType(id) > 0) return true;   // 生产工具
        if (cat === 56000) return true;                         // 魔杖（342598 的 *label_2986）
        if (cat === 59000) return true;                         // 工具类（钓竿等）
        if (cat === 60000 || id === 959) return true;           // 乐器
        if (Elona.Farm && Elona.Farm.isSeed({ id, f: [] })) return true;   // 种子（*label_3020）
        if (id === 1174) return true;                           // 作物管理セット
        if (id === 1097) return true;                           // ヤカテクトの預金箱
        if (id === 615) return true;                            // 請求書（缴税）
      }
      if (!Elona.ItemUse) return false;
      return !!(Elona.ItemUse.entryOf(id, 13) || Elona.ItemUse.entryOf(id, 14) || Elona.ItemUse.entryOf(id, 15));
    },

    /** 装备槽位名称（顺序来自种族数据 var_121: 頭|首|体|背|手|手|指|指|腕|腰|足） */
    SLOT_NAMES: ['', 'head', 'neck', 'body', 'back', 'hand', 'hand2', 'finger', 'arm', 'finger2', 'waist', 'leg'],
    equipLocName(loc) { return loc ? (this.SLOT_NAMES[loc] || ('slot' + loc)) : ''; },

    esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },

    // ---------- 商店 ----------
    shopMode: 'buy',
    shopSel: -1,
    /** 0-EU：每页 8 行（原版 `*label_2978` 的列表窗口一屏也是 8 行） */
    SHOP_PAGE_SIZE: 8,
    /** 当前页码（0 起） */
    shopPage: 0,
    /** 光标在**本页**内的行号 */
    shopCursor: 0,
    /** 当前模式的完整行（`idx` 是容器下标：购买=店主背包 / 出售=玩家背包） */
    shopRows: [],

    /**
     * 打开商店窗口。
     * @param {string} [mode] 'buy'（默认）/ 'sell' / 'invest'（0-BX：从 NPC 菜单进入）
     */
    openShop(game, keeper, mode) {
      if (!Elona.Shop) return;
      const s = Elona.Shop.open(game, keeper);
      if (!s) return;
      this.shopMode = (mode === 'sell') ? 'sell' : 'buy';
      this.shopSel = -1;
      this.shopPage = 0;
      this.shopCursor = 0;
      this.el('shop-tab-buy').classList.add('on');
      this.el('shop-tab-sell').classList.remove('on');
      if (mode === 'invest') this.pushMessage('在下方选择投资金额。');
      this.el('shop').classList.remove('hidden');
      this.wireShop(game);
      this.renderShop(game);
    },

    /** 绑定商店按钮（只绑定一次） */
    wireShop(game) {
      if (this.shopWired) return;
      this.shopWired = true;
      const el = (id) => this.el(id);
      el('shop-tab-buy').onclick = () => {
        this.shopMode = 'buy';
        el('shop-tab-buy').classList.add('on'); el('shop-tab-sell').classList.remove('on');
        this.renderShop(game);
      };
      el('shop-tab-sell').onclick = () => {
        this.shopMode = 'sell';
        el('shop-tab-sell').classList.add('on'); el('shop-tab-buy').classList.remove('on');
        this.renderShop(game);
      };
      el('shop-buy1').onclick = () => this.shopAct(game, 'buy', 1);
      el('shop-buy5').onclick = () => this.shopAct(game, 'buy', 5);
      el('shop-sell1').onclick = () => this.shopAct(game, 'sell', 1);
      el('shop-sell5').onclick = () => this.shopAct(game, 'sell', 5);
      el('shop-invest1').onclick = () => {
        const s = game.shopSession;
        if (!s) return;
        const r = Elona.Shop.invest(game, s.keeper, game.player, 1);
        this.pushMessage(r.ok ? `投资了 ${r.cost} gp，店等级提升到 ${r.rank}。`
          : (r.reason === 'money' ? '金币不足。' : '投资失败。'));
        this.renderShop(game);
      };
      el('shop-invest50').onclick = () => {
        const s = game.shopSession;
        if (!s) return;
        const r = Elona.Shop.invest(game, s.keeper, game.player, 2);
        this.pushMessage(r.ok ? `投资了 ${r.cost} gp，店等级提升到 ${r.rank}。`
          : (r.reason === 'money' ? '金币不足。' : '投资失败。'));
        this.renderShop(game);
      };
      el('shop-steal').onclick = () => this.shopSteal(game);
    },

    closeShop(game) {
      this.el('shop').classList.add('hidden');
      if (Elona.Shop) Elona.Shop.close(game);
    },

    renderShop(game) {
      const s = game.shopSession;
      if (!s) return;
      const keeper = s.keeper;
      this.el('shop-title').textContent =
        `${Elona.Shop.roleName(s.role)}（店主金币 ${keeper.get(30)}）`;
      this.el('shop-money').textContent =
        `你的金币：${game.player.get(30)}　店等级：${keeper.get(151)}`;
      const buy = this.shopMode === 'buy';
      const rows = [];
      if (buy) {
        for (let i = 0; i < keeper.inv.length; i++) {
          const it = keeper.inv[i];
          if (it && it.f[0] > 0) rows.push({ it, idx: i });
        }
      } else {
        for (let i = 0; i < game.player.inv.length; i++) {
          const it = game.player.inv[i];
          if (it && it.f[0] > 0 && it.eqSlot < 0) rows.push({ it, idx: i });
        }
      }
      this.shopRows = rows;
      const per = this.SHOP_PAGE_SIZE;
      const pages = Math.max(1, Math.ceil(rows.length / per));
      this.shopPage = Math.max(0, Math.min(pages - 1, this.shopPage | 0));
      const from = this.shopPage * per;
      const slice = rows.slice(from, from + per);
      if (!slice.length) this.shopCursor = 0;
      else this.shopCursor = Math.max(0, Math.min(slice.length - 1, this.shopCursor | 0));

      const lang = 'en';
      const list = this.el('shop-list');
      list.innerHTML = slice.length ? slice.map((r, i) => {
        const it = r.it;
        // 图标表按 2/3 缩放（CSS background-size: 1056px），坐标同步缩放
        const pos = Elona.ItemDB.iconPos(it.id);
        const k = 2 / 3;
        const price = Elona.Shop.unitPrice(game, it, buy ? 0 : 1);
        return `<div class="inv-row${i === this.shopCursor ? ' sel' : ''}" data-i="${i}">
          <span class="inv-icon" style="background-position:-${pos.x * k}px -${pos.y * k}px"></span>
          <span class="inv-name">${this.esc(Elona.ItemDB.name(it.id, lang))}</span>
          <span class="inv-meta">${it.f[0]} 个 / ${price} gp</span>
        </div>`;
      }).join('') : '<div id="shop-empty">没有可以交易的物品。</div>';

      list.onclick = (ev) => {
        const row = ev.target.closest('.inv-row');
        if (!row) return;
        this.selectShopRow(game, parseInt(row.dataset.i, 10) | 0);
      };

      // 分页信息
      const pg = this.el('shop-page-text');
      if (pg) {
        pg.textContent = pages > 1
          ? `第 ${this.shopPage + 1} / ${pages} 页（${rows.length} 种）`
          : `共 ${rows.length} 种`;
      }

      this.el('shop-buy1').disabled = !buy || !slice.length;
      this.el('shop-buy5').disabled = !buy || !slice.length;
      this.el('shop-sell1').disabled = buy || !slice.length;
      this.el('shop-sell5').disabled = buy || !slice.length;
      this.el('shop-steal').disabled = !buy || !slice.length;
      // 投资按钮：显示实时价格
      if (Elona.Shop && Elona.Shop.investValue) {
        const c1 = Elona.Shop.investValue(game, keeper, game.player, 1);
        const c50 = Elona.Shop.investValue(game, keeper, game.player, 20);
        this.el('shop-invest1').textContent = `投资(${c1})`;
        this.el('shop-invest50').textContent = `投资50(${c50})`;
        this.el('shop-invest1').disabled = (game.player.get(30) | 0) < c1;
        this.el('shop-invest50').disabled = (game.player.get(30) | 0) < c50;
      }
      // 光标落在第一行（有货时）
      if (slice.length) this.selectShopRow(game, this.shopCursor);
      else { this.shopSel = -1; this.el('shop-detail').textContent = '选择一件物品。'; }
    },

    /** 当前页的行（rows 的切片） */
    shopPageRows() {
      const per = this.SHOP_PAGE_SIZE;
      const from = (this.shopPage | 0) * per;
      return (this.shopRows || []).slice(from, from + per);
    },

    /**
     * 把光标移到本页第 i 行：同步高亮、`shopSel`（容器下标）与详情栏。
     * 鼠标点击与键盘↑↓共用。
     */
    selectShopRow(game, i) {
      const slice = this.shopPageRows();
      const list = this.el('shop-list');
      if (!slice.length || !list) { this.shopSel = -1; return; }
      const n = slice.length;
      this.shopCursor = ((i | 0) % n + n) % n;
      const nodes = list.querySelectorAll('.inv-row');
      nodes.forEach((node, k) => node.classList.toggle('sel', k === this.shopCursor));
      const node = nodes[this.shopCursor];
      if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
      const row = slice[this.shopCursor];
      this.shopSel = row.idx;
      const buy = this.shopMode === 'buy';
      const keeper = game.shopSession && game.shopSession.keeper;
      const it = buy ? (keeper ? keeper.inv[this.shopSel] : null) : game.player.inv[this.shopSel];
      if (!it) { this.el('shop-detail').textContent = '选择一件物品。'; this.shopSel = -1; return; }
      const price = Elona.Shop.unitPrice(game, it, buy ? 0 : 1);
      this.el('shop-detail').innerHTML =
        `<b>${this.esc(Elona.ItemDB.name(it.id, 'en'))}</b>　单价 ${price} gp<br>` +
        this.esc(Elona.ItemDB.desc(it.id, 'en'));
    },

    /** 键盘 ↑↓：页内移动，越过两端自动翻页（原版列表也是这样） */
    moveShopSel(game, d) {
      const slice = this.shopPageRows();
      if (!slice.length) return;
      const next = (this.shopCursor | 0) + (d | 0);
      if (next < 0) {
        if (this.shopPage > 0) {
          this.shopPage--;
          const prev = this.shopPageRows();
          this.renderShop(game);
          this.selectShopRow(game, Math.max(0, prev.length - 1));
        } else {
          this.selectShopRow(game, slice.length - 1);
        }
        return;
      }
      if (next >= slice.length) {
        const pages = Math.max(1, Math.ceil((this.shopRows || []).length / this.SHOP_PAGE_SIZE));
        if (this.shopPage < pages - 1) {
          this.shopPage++;
          this.renderShop(game);
          this.selectShopRow(game, 0);
        } else {
          this.selectShopRow(game, 0);
        }
        return;
      }
      this.selectShopRow(game, next);
    },

    /** 键盘 ←→：翻页（光标保持在首行） */
    changeShopPage(game, d) {
      const pages = Math.max(1, Math.ceil((this.shopRows || []).length / this.SHOP_PAGE_SIZE));
      const next = (this.shopPage | 0) + (d | 0);
      if (next < 0 || next >= pages) return;
      this.shopPage = next;
      this.shopCursor = 0;
      this.renderShop(game);
    },

    /** 键盘 Tab：在购买 / 出售之间切换 */
    toggleShopMode(game) {
      this.shopMode = this.shopMode === 'buy' ? 'sell' : 'buy';
      this.el('shop-tab-buy').classList.toggle('on', this.shopMode === 'buy');
      this.el('shop-tab-sell').classList.toggle('on', this.shopMode === 'sell');
      this.shopPage = 0;
      this.shopCursor = 0;
      this.renderShop(game);
    },

    shopAct(game, kind, count) {
      if (!game.shopSession || this.shopSel < 0) { this.pushMessage('请先选择一件物品。'); return; }
      const r = kind === 'buy'
        ? Elona.Shop.buy(game, this.shopSel, count)
        : Elona.Shop.sell(game, this.shopSel, count);
      if (!r.ok) {
        const msg = {
          money: '金币不足。', 'shop-money': '店主没有足够的金币。',
          equipped: '装备中的物品不能出售。', 'no-item': '物品不存在。',
        }[r.reason] || '交易失败。';
        this.pushMessage(msg);
      } else {
        this.pushMessage(kind === 'buy'
          ? `买入 ${Elona.ItemDB.name(r.item.id, 'en')} ×${r.item.f[0]}（${r.price} gp）。`
          : `卖出 ${Elona.ItemDB.name(r.item.id, 'en')} ×${r.item.f[0]}（${r.price} gp）。`);
      }
      this.renderShop(game);
    },

    /** 偷窃：拿走选中的商品，目击者会转为敌对 */
    shopSteal(game) {
      if (!game.shopSession || this.shopSel < 0 || this.shopMode !== 'buy') {
        this.pushMessage('请先在购买列表中选择一件商品。');
        return;
      }
      const r = Elona.Shop.steal(game, this.shopSel);
      if (!r.ok) {
        this.pushMessage({ 'no-shop': '没有打开商店。', 'no-item': '商品不存在。' }[r.reason] || '偷窃失败。');
        return;
      }
      const name = Elona.ItemDB ? Elona.ItemDB.name(r.item.id, 'en') : ('item ' + r.item.id);
      this.pushMessage(`你偷走了 ${name}。`);
      if (r.witnesses && r.witnesses.length) {
        this.pushMessage(`有人看到了你的偷窃行为！(${r.witnesses.join('、')})`);
      } else {
        this.pushMessage('似乎没有人注意到。');
      }
      this.shopSel = -1;
      this.renderShop(game);
    },

    // ---------- NPC 交互（*label_2749 / *label_3031 / 415343+） ----------
    npcOpen: false,
    npcTarget: null,
    npcText: '',
    /** 菜单光标（原版 `*label_2896` 的选择行）；方向键 ↑/↓ 移动，回车确定 */
    npcSel: 0,
    /** 自身互动菜单（`var_244 == 0`，289682-289733） */
    npcSelf: false,
    /* 固定 NPC 对话脚本会话（core/dialogue.js，源 367818-410727） */
    npcSession: null,
    npcDialog: null,

    openNPC(game, npc) {
      if (!Elona.NPC || !npc) return;
      // A404：道场（地图 67）的师范（物种 519）→ 387244-387738 的入門/特訓菜单
      if (Elona.School && Elona.School.isTeacher && Elona.School.isTeacher(game, npc)
        && Elona.Panels && Elona.Panels.openSchool) {
        Elona.Panels.openSchool(game);
        return;
      }
      // A404：寄放在道场/廃モンスター牧場的同伴（cbit 960）→ 收回队伍窗口
      if (Elona.School && Elona.School.isStayerAt && Elona.School.isStayerAt(game, npc)
        && Elona.Panels && Elona.Panels.openStayer) {
        Elona.Panels.openStayer(game, npc);
        return;
      }
      // 0-FO：牧场里的家畜（cbit 960）走 289600-289616 的干涉菜单，
      // 不是普通 NPC 对话；梳理/榨奶/挖残骸/带出来/献祭都在那个窗口里。
      if (Elona.Ranch && Elona.Ranch.isRanch && Elona.Ranch.isRanch(game)
        && Elona.Status && Elona.Status.cbit && Elona.Status.cbit(npc, 960) === 1
        && Elona.Panels && Elona.Panels.openLivestockMenu) {
        Elona.Panels.openLivestockMenu(game, npc);
        return;
      }
      // 0-ES：第一次对话时给 NPC 定信仰（365651 → *label_2605）
      if (Elona.Faith && Elona.Faith.assignNpcFaith) Elona.Faith.assignNpcFaith(game, npc);
      this.npcTarget = npc;
      this.npcGame = game;          // 0-BW：快捷键触发时需要 game 上下文
      this.npcSelf = false;
      this.npcSel = 0;
      // 固定 NPC（种族在 talkscripts 表里）→ 走原版脚本，而不是通用问候
      // 0-DT：NPC 有一次性服务对话（`cbit 982` + `var_58(150)`）时走服务链 *label_3033
      const svc = !!(Elona.Dialogue && Elona.Dialogue.ready
        && Elona.Dialogue.canTalkService && Elona.Dialogue.canTalkService(npc));
      if (Elona.Dialogue && Elona.Dialogue.ready && (svc || Elona.Dialogue.canTalk(npc))) {
        const s = Elona.Dialogue.start(game, npc, {
          // 汉化：talkscripts.json 的台词在 `ch` 字段，日文档（lang !== 'en'）读它；
          // 传 'jp' 即「中文显示」，英文档（'en'）仍读 en。
          player: game.player, lang: 'jp', chain: svc ? 'service' : 'topic',
        });
        if (s) {
          this.npcSession = s;
          this.npcText = '';
          this.npcDialog = null;
          this.npcOpen = true;
          this.el('npc').classList.remove('hidden');
          this.el('npc-train').classList.add('hidden');
          this.el('npc-give').classList.add('hidden');
          this.el('npc-feelings').classList.add('hidden');
          this.wireNPC(game);
          this.advanceTalk(game);
          return;
        }
      }
      this.npcSession = null;
      this.npcDialog = null;
      this.npcText = Elona.NPC.talk(game, npc);
      this.npcOpen = true;
      this.el('npc').classList.remove('hidden');
      this.el('npc-train').classList.add('hidden');
      this.el('npc-give').classList.add('hidden');
      this.el('npc-feelings').classList.add('hidden');
      this.wireNPC(game);
      this.renderNPC(game);
    },

    /**
     * 推进对话脚本一步（*label_3068 的「说一句 + 等选择」）
     *  - say  ：只显示台词，继续跑
     *  - menu ：显示台词 + 选项，等玩家点
     *  - end  ：会话结束，回到通用服务菜单
     *  - blocked：脚本里出现了尚未移植的外部子程序，如实告知
     */
    advanceTalk(game) {
      const s = this.npcSession;
      if (!s) return;
      let ev = s.step();
      let guard = 0;
      while (ev.kind === 'say' && guard++ < 40) {
        this.pushMessage(ev.text);
        this.npcText = ev.text;
        ev = s.step();
      }
      if (ev.kind === 'menu') {
        this.npcText = ev.text;
        this.npcDialog = { items: ev.items, allowEsc: ev.allowEsc };
        this.renderNPC(game);
        return;
      }
      // 0-DS：选目标 / 选物品（gosub *label_2683 / *label_2824 的原生替代）
      if (ev.kind === 'pick_chara' || ev.kind === 'pick_item') {
        this.npcText = ev.text || '';
        this.npcDialog = {
          items: ev.items || [], allowEsc: true, pick: ev.kind === 'pick_chara' ? 'chara' : 'item',
        };
        this.renderNPC(game);
        return;
      }
      if (ev.kind === 'blocked') {
        this.npcDialog = null;
        this.npcText = `${ev.text || ''}（这段对话还没移植：gosub *label_${ev.label || ev.why}）`;
        this.npcSession = null;
        this.renderNPC(game);
        return;
      }
      // end：本 NPC 的脚本走完了 —— 若还有通用服务，接着显示
      // 0-GB：*label_4358 的收尾要消耗一个回合；*label_2459 是剧情场景切换
      if (ev.endTurn && game && game.endTurn) game.endTurn();
      if (ev.exitScene) this.pushMessage('（剧情推进：场景切换）');
      // A49：诺恩等剧情 NPC 通过改写 var_65(850) 切换世界地图
      const destWorld = s.worldChanged | 0;
      this.npcDialog = null;
      this.npcSession = null;
      if (destWorld && game && game.travelToWorld) {
        game.travelToWorld(destWorld).catch(() => { });
        this.closeNPC();
        return;
      }
      if (!this.npcText || !this.npcText.trim()) {
        this.npcText = Elona.NPC.talk(game, this.npcTarget);
      }
      this.renderNPC(game);
    },

    /** 选择某个对话选项 */
    answerTalk(game, item) {
      const s = this.npcSession;
      if (!s) return;
      s.answer(item.v);
      this.advanceTalk(game);
    },

    /** 对话中按「再见」= Esc（var_134 / var_2612） */
    cancelTalk(game) {
      const s = this.npcSession;
      if (!s) { this.closeNPC(); return; }
      s.cancel();
      this.advanceTalk(game);
    },

    closeNPC() {
      this.npcOpen = false;
      this.npcTarget = null;
      this.npcGame = null;
      this.npcActions = null;
      this.npcSelf = false;
      this.npcSel = 0;
      this.npcSession = null;
      this.npcDialog = null;
      this.el('npc').classList.add('hidden');
      this.el('npc-train').classList.add('hidden');
      this.el('npc-give').classList.add('hidden');
      this.el('npc-feelings').classList.add('hidden');
    },

    wireNPC(game) {
      if (this.npcWired) return;
      this.npcWired = true;
      this.el('npc-train-ok').onclick = () => {
        const sel = this.el('npc-skill');
        const skillId = parseInt(sel.value, 10);
        const mode = this.npcTrainMode === 'learn' ? 'learn' : 'train';
        const r = Elona.NPC.perform(game, this.npcTarget, mode, skillId);
        this.pushMessage(r.message);
        this.npcText = r.message;
        this.el('npc-train').classList.add('hidden');
        this.renderNPC(game);
      };
      // 0-BV：说「気持ち」（原版对话动作 var_400 == 29 → 心情菜单 11000-11186）
      this.el('npc-feeling-ok').onclick = () => {
        const npc = this.npcTarget;
        if (!npc || !Elona.Relation) return;
        const choice = parseInt(this.el('npc-feeling').value, 10) | 0;
        const r = Elona.Relation.talk(game, npc, choice);
        const msgs = (r && r.messages) || [];
        if (!r || !r.ok) {
          const why = r && r.reason === 'cooldown' ? `对方还需要 ${r.wait} 小时才愿意再听你说话。`
            : (r && r.reason === 'vigor' ? '你已经没有力气说话了。' : '现在说不出口。');
          this.pushMessage(why);
          this.npcText = why;
        } else {
          for (const m of msgs) this.pushMessage(m);
          this.npcText = msgs.length ? msgs[msgs.length - 1] : this.npcText;
        }
        this.el('npc-feelings').classList.add('hidden');
        this.renderNPC(game);
      };
    },

    renderNPC(game) {
      const npc = this.npcTarget;
      if (!npc) return;
      if (this.npcSelf) {
        // 原版自身菜单没有标题栏文字，这里用「角色名（自己）」代替
        this.el('npc-title').textContent = `${npc.name}（自己）`;
      } else {
        const role = Elona.NPC.roleOf(npc);
        const title = Elona.NPC.roleName(role);
        this.el('npc-title').textContent = title ? `${npc.name} — ${title}` : npc.name;
      }
      this.el('npc-text').textContent = this.npcText || '';
      if (this.npcDialog) { this.renderTalkActions(game); return; }
      const wrap = this.el('npc-actions');
      wrap.innerHTML = '';
      // 0-BW：原版样式 —— 竖排菜单项，左侧为快捷键字母（display_key 绘制）
      const services = this.npcSelf ? this.selfServices(game) : Elona.NPC.services(npc, game);
      this.npcActions = services;
      // 光标范围：最后一项「再见」也算一行
      this.npcCloseRow = true;
      const total = services.length + 1;
      if (!(this.npcSel >= 0 && this.npcSel < total)) this.npcSel = 0;
      services.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'npc-action' + (i === this.npcSel ? ' sel' : '');
        const key = KEY_LETTERS[i] || '';
        row.innerHTML = `<span class="npc-key">${key}</span><span class="npc-label"></span>`;
        row.querySelector('.npc-label').textContent = s.label;
        row.onclick = () => { this.npcSel = i; this.runNPCAction(game, s); };
        wrap.appendChild(row);
      });
      const close = document.createElement('div');
      close.className = 'npc-action npc-close' + (this.npcSel === services.length ? ' sel' : '');
      const closeKey = KEY_LETTERS[services.length] || '';
      close.innerHTML = `<span class="npc-key">${closeKey}</span><span class="npc-label">再见</span>`;
      close.onclick = () => this.closeNPC();
      wrap.appendChild(close);
    },

    /**
     * 自身互动菜单（原版 `var_244 == 0` 的分支，289682-289733）。
     * 源码里玩家自己能用的项按顺序为：
     *   289690 立ち姿を変える（27） / 289692 アイテム画像の付与（23）
     *   289711 タッグ編成（16） / 289627 口調を変える（10）
     *   289724 名前をつける（3） / 289731 情報（6）
     */
    selfServices() {
      return [
        { id: 'self-tatie', label: '改变站姿' },       // 27
        { id: 'self-itemimg', label: '赋予道具图像' },  // 23
        { id: 'self-tag', label: '编成搭档' },          // 16
        { id: 'self-tone', label: '改变口吻' },         // 10
        { id: 'self-name', label: '起名' },             // 3
        { id: 'self-info', label: '信息' },             // 6
      ];
    },

    /** 打开自身互动菜单（Interact.confirm → 这里） */
    openSelfMenu(game) {
      const p = game && game.player;
      if (!p) return;
      this.npcTarget = p;
      this.npcGame = game;
      this.npcSelf = true;
      this.npcSession = null;
      this.npcDialog = null;
      this.npcText = '';
      this.npcSel = 0;
      this.npcOpen = true;
      this.el('npc').classList.remove('hidden');
      this.el('npc-train').classList.add('hidden');
      this.el('npc-give').classList.add('hidden');
      this.el('npc-feelings').classList.add('hidden');
      this.wireNPC(game);
      this.renderNPC(game);
    },

    /** 方向键移动菜单光标（原版 `*label_2896` 的选择行） */
    moveNPCSel(d) {
      // 0-FT：末尾的「再见」行不一定存在（对话脚本自带再见时不再补）
      const n = (this.npcActions ? this.npcActions.length : 0) + (this.npcCloseRow ? 1 : 0);
      if (n <= 0) return;
      this.npcSel = ((this.npcSel | 0) + (d | 0) + n) % n;
      this.renderNPC(this.npcGame);
    },

    /** 回车确定光标所在项 */
    activateNPCSel() {
      const list = this.npcActions || [];
      const i = this.npcSel | 0;
      if (i === list.length && this.npcCloseRow) {          // 「再见」
        if (this.npcDialog) this.cancelTalk(this.npcGame);
        else this.closeNPC();
        return;
      }
      if (i < 0 || i >= list.length) return;
      this.runNPCAction(this.npcGame, list[i]);
    },

    /**
     * 0-BW：执行 NPC 互动菜单的某一项（点击与快捷键共用）
     */
    /** 对话脚本的选项列表（*label_3068 的 var_484/var_485） */
    renderTalkActions(game) {
      const wrap = this.el('npc-actions');
      wrap.innerHTML = '';
      const items = (this.npcDialog && this.npcDialog.items) || [];
      this.npcActions = items.map((it) => ({ id: 'dlg', label: it.label, v: it.v, dlg: it }));
      const allowEsc = !!(this.npcDialog && this.npcDialog.allowEsc);
      // 0-FT：脚本自己已经给了「再见」（356/357 `さようなら。`）时不再补那一行，
      //   否则菜单尾部会出现两个「再见」（截图反馈的问题）。Esc 依旧可以取消
      //   （标题栏右侧一直提示「Esc 关闭」），所以不会卡住。
      const hasFarewell = items.some((it) => /^(\u518d\u89c1|\u3055\u3088\u3046\u306a\u3089|Bye)/.test((it && it.label) || ''));
      const showClose = allowEsc && !hasFarewell;
      this.npcCloseRow = showClose;
      const total = items.length + (showClose ? 1 : 0);
      if (!(this.npcSel >= 0 && this.npcSel < total)) this.npcSel = 0;
      items.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'npc-action' + (i === this.npcSel ? ' sel' : '');
        const key = KEY_LETTERS[i] || '';
        row.innerHTML = `<span class="npc-key">${key}</span><span class="npc-label"></span>`;
        row.querySelector('.npc-label').textContent = it.label;
        row.onclick = () => { this.npcSel = i; this.answerTalk(game, it); };
        wrap.appendChild(row);
      });
      if (showClose) {
        const close = document.createElement('div');
        close.className = 'npc-action npc-close' + (this.npcSel === items.length ? ' sel' : '');
        const key = KEY_LETTERS[items.length] || '';
        close.innerHTML = `<span class="npc-key">${key}</span><span class="npc-label">再见</span>`;
        close.onclick = () => this.cancelTalk(game);
        wrap.appendChild(close);
      }
    },

    async runNPCAction(game, s) {
      const npc = this.npcTarget;
      if (!npc || !s) return;
      if (selfAction(this, game, s)) return;
      // 对话脚本的选项（*label_3068 的 var_484/var_485）：字母键与回车都走这里
      if (s.id === 'dlg') { this.answerTalk(game, s.dlg || s); return; }
      {
          if (s.id === 'quest-accept' || s.id === 'quest-report') {
            const qr = s.id === 'quest-accept'
              ? Elona.Quest.accept(game, s.questId)
              : Elona.Quest.report(game, s.questId);
            this.pushMessage(qr.message);
            this.npcText = qr.message;
            if (qr.ok && qr.enterMap && game.enterQuestMap) {
              this.closeNPC();
              game.enterQuestMap(qr.quest).catch(() => { });
              return;
            }
            this.renderNPC(game);
            return;
          }
          // 0-FC：剧情传送（主线 / 支线任务接取后传送到固定地图）
          if (s.id === 'story-warp') {
            if (!Elona.StoryWarp) return;
            const ok = await Elona.StoryWarp.warp(game, s);
            if (ok) { this.closeNPC(); return; }
            this.renderNPC(game);
            return;
          }
          if (s.id === 'feelings') {
            const npc = this.npcTarget;
            if (!npc || !Elona.Relation) return;
            const sel = this.el('npc-feeling');
            sel.innerHTML = Elona.Relation.menu(npc, game).map((m) =>
              `<option value="${m.id}">${this.esc(m.jp || m.en)}</option>`).join('');
            this.el('npc-feelings').classList.remove('hidden');
            this.el('npc-train').classList.add('hidden');
            this.el('npc-give').classList.add('hidden');
            return;
          }
          if (s.id === 'train') {
            const list = Elona.NPC.trainableSkills(game.player);
            if (!list.length) { this.pushMessage('没有可以训练的技能。'); return; }
            const sel = this.el('npc-skill');
            this.npcTrainMode = 'train';
            sel.innerHTML = list.map((k) =>
              `<option value="${k.id}">${this.esc(k.name)}（潜力 ${k.potential}）</option>`).join('');
            this.el('npc-train').classList.remove('hidden');
            this.el('npc-give').classList.add('hidden');
            return;
          }
          // 0-CA：学新技能（原版菜单 30「新しいスキルを覚えたい」）
          if (s.id === 'learn') {
            const list = Elona.NPC.learnableSkills(game, game.player);
            if (!list.length) { this.pushMessage('已经没有可以学的技能了。'); return; }
            const sel = this.el('npc-skill');
            this.npcTrainMode = 'learn';
            sel.innerHTML = list.map((k) =>
              `<option value="${k.id}">${this.esc(k.name)}（5 白金币）</option>`).join('');
            this.el('npc-train').classList.remove('hidden');
            this.el('npc-give').classList.add('hidden');
            return;
          }
          // 0-CA：装备解咒（原版菜单 62）
          if (s.id === 'uncurse') {
            const r2 = Elona.NPC.perform(game, npc, 'uncurse');
            this.pushMessage(r2.message);
            this.npcText = r2.message;
            this.renderNPC(game);
            return;
          }
          // 0-DI：武具店（1000/1001）—— 强化 / 充填 / 轻量化 / 重量化（415329-415341）
          if (s.id === 'enhance' || s.id === 'lighten' || s.id === 'heavify') {
            this.renderEquipList(game, s.id);
            return;
          }
          if (s.id === 'reload') {
            const r = Elona.NPC.perform(game, npc, 'reload');
            this.pushMessage(r.message);
            this.npcText = r.message;
            this.renderNPC(game);
            return;
          }
          if (s.id === 'special-meal' || s.id === 'special-drink') {
            const r = Elona.NPC.perform(game, npc, s.id);
            this.pushMessage(r.message);
            this.npcText = r.message;
            this.renderNPC(game);
            return;
          }
          // 0-DI：情报屋（8）—— 冒险者一览 / 传话 / 生日
          if (s.id === 'intel') {
            const r = Elona.NPC.perform(game, npc, 'intel');
            if (r.action === 'adventurer-info' && r.list && r.list.length) {
              this.renderAdventurerList(game, 'intel', r.list);
            } else {
              this.pushMessage(r.message || '…');
              this.npcText = r.message || this.npcText;
            }
            return;
          }
          if (s.id === 'adventurer-message') {
            const r = Elona.NPC.perform(game, npc, 'adventurer-message');
            if (r.action && r.list) this.renderAdventurerList(game, 'message', r.list);
            else { this.pushMessage(r.message || '…'); }
            return;
          }
          if (s.id === 'birthday') {
            if (Elona.Panels) Elona.Panels.openBirthday(game, () => this.renderNPC(game));
            return;
          }
          if (s.id === 'reserve-book') {
            const st = game.player.spellStock || [];
            const entries = [];
            const nameOf = (Elona.Spell && Elona.Spell.actionName) ? Elona.Spell.actionName : null;
            for (let i = 0; i < st.length; i++) {
              if ((st[i] | 0) <= 0) continue;
              const sid = 400 + i;
              const nm = nameOf ? nameOf(sid) : null;
              const label = nm ? (typeof nm === 'string' ? nm : (nm.jp || nm.en || ('spell ' + sid))) : ('spell ' + sid);
              entries.push({ label, meta: `库存 ${st[i] | 0}`, arg: sid });
            }
            if (!entries.length) { this.pushMessage('你还没有解读过任何魔法书。'); return; }
            this.renderPickList(game, 'reserve-book', '预订哪本魔法书（下次盘点进货）', entries);
            return;
          }
          if (s.id === 'give') { this.renderGiveList(game); return; }
          // 0-CM：万圣节 Trick-or-Treat —— 先弹菜单（事件 1025）
          if (s.id === 'trick-or-treat') {
            const tr = Elona.NPC.perform(game, npc, 'trick-or-treat');
            if (tr.ok && tr.action === 'trick-or-treat') {
              this.renderPickList(game, 'trick-choice', tr.title, tr.options);
            } else {
              this.pushMessage(tr.message || '…');
            }
            return;
          }
          // 0-CB：鉴定一件（14）/ 调查（16）—— 先选物品
          if (s.id === 'identify-one' || s.id === 'investigate') {
            this.renderIdentifyList(game, s.id);
            return;
          }
          // 0-CC：需要先选目标的三项
          if (s.id === 'practice') {
            this.renderPickList(game, 'practice', '选择实习种类（900 gold）',
              Elona.NPC.PRACTICE.map((x) => ({ label: x.label, arg: x.id })));
            return;
          }
          if (s.id === 'stock-exchange') {
            const st = game.player.spellStock || [];
            const nameOf = (Elona.Spell && Elona.Spell.actionName) ? Elona.Spell.actionName : null;
            const entries = [];
            for (let i = 0; i < st.length; i++) {
              if ((st[i] | 0) < 200) continue;
              const sid = 400 + i;
              const nm = nameOf ? nameOf(sid) : null;
              const label = nm ? (typeof nm === 'string' ? nm : (nm.jp || nm.en || ('spell ' + sid))) : ('spell ' + sid);
              entries.push({ label, meta: `库存 ${st[i] | 0}`, arg: sid });
            }
            if (!entries.length) { this.pushMessage('没有可交换的魔法库存（至少 200）。'); return; }
            this.renderPickList(game, 'stock-exchange', '选择要交换的魔法（库存减半换魔力）', entries);
            return;
          }
          if (s.id === 'barter') { this.renderBarterList(game); return; }
          // 0-CD：宠物战 —— 先选出战宠物
          if (s.id === 'pet-duel' || s.id === 'pet-team' || s.id === 'pet-ex') {
            const pets = (Elona.Party && Elona.Party.pets) ? Elona.Party.pets(game) : [];
            if (!pets.length) {
              this.pushMessage('你还没有可以出战的宠物（可向奴隶商/马屋购买，或用捕获玉收服）。');
              return;
            }
            this.renderPickList(game, s.id, '选择出战的宠物',
              pets.map((c) => ({
                label: c.name,
                meta: `Lv${c.get(38) | 0}　战力 ${Elona.Party.petPower(c)}`,
                arg: c.index,
              })));
            return;
          }
          const r = Elona.NPC.perform(game, npc, s.id, s.questId);
          if (r.enterMap && game.enterQuestMap) {
            this.closeNPC();
            game.enterQuestMap(r.quest).catch(() => { });
            return;
          }
          if (r.action === 'shop') {
            this.closeNPC();
            this.openShop(game, r.keeper, r.shopMode);
            return;
          }
          if (r.action === 'aside') {                 // 0-BX：「让开」
            this.pushMessage(r.message);
            this.npcText = r.message;
            this.closeNPC();
            return;
          }
          if (r.action === 'awaken') {                 // 0-CQ：「力の覚醒」
            this.closeNPC();
            if (Elona.Panels) Elona.Panels.openAwaken(game, 0);
            return;
          }
          if (r.action === 'camp-manage') {            // 0-DB：收容所运营面板
            this.closeNPC();
            if (Elona.Panels) Elona.Panels.openCamp(game);
            return;
          }
          // 0-DH：evochat（同伴互动：心情 / 心の開錠 / じゃれあう）
          if (r.action === 'evochat') {
            this.closeNPC();
            if (Elona.Panels) Elona.Panels.openEvochat(game, r.target);
            return;
          }
          // 0-DH：一緒に食事（先选食物，再两人分食）
          if (r.action === 'share-meal') {
            this.closeNPC();
            if (Elona.Panels) Elona.Panels.openMealSelect(game, r.target);
            return;
          }
          // 0-DG：同伴指示
          if (r.action === 'companion-menu') {
            this.closeNPC();
            if (Elona.Panels) Elona.Panels.openCompanionMenu(game, r.target);
            return;
          }
          // 0-DG：调酒师的同伴服务
          if (r.action === 'ally-revive') {
            this.closeNPC();
            if (Elona.Panels && r.list) {
              Elona.Panels.openAllySelect(game, '誰を呼び戻す？', r.list, (c) => {
                const cost = Elona.Companion.reviveCost(c);
                // 417457-417465：先报费用，钱够才给「呼び戻す / やめる」二选一（*label_3068）。
                // 项目里用已有的 y/n 确认窗承载这个二选一，保持「先确认再扣钱」的顺序。
                const gold = game.player.get(30) | 0;
                if (gold < cost) {
                  this.pushMessage(`「要把它叫回来的话需要 ${cost} gold。」（你只有 ${gold} gold）`);
                  return;
                }
                Elona.Panels.openConfirm(
                  `「そいつを呼び戻すには、${cost} gold 必要だ。」\n要支付 ${cost} gold 叫回 ${c.name} 吗？`,
                  (yes) => {
                    if (!yes) { this.pushMessage('「冷やかし？」'); return; }   // 417476
                    const rr = Elona.Companion.revive(game, c);
                    this.pushMessage(rr.message || '');
                  },
                  { title: '調酒師', yes: `呼び戻す（${cost} gold）`, no: 'やめる' });
              }, 'a~p 选择　Esc 关闭',
              // 284372-284374 / 286767-286770：额度用尽时人物窗标注「切换地图前无法复活」
              (c) => ((c.get(Elona.Companion.REVIVE_FLAG) | 0) <= 0
                ? '(マップ切替えるまで復活不能)' : ''));
            }
            return;
          }
          if (r.action === 'ally-wait') {
            this.closeNPC();
            if (Elona.Panels && r.list) {
              Elona.Panels.openAllySelect(game, '谁在这里待命？', r.list, (c) => {
                const rr = Elona.Companion.wait(game, c);
                this.pushMessage(rr.message || '');
              }, 'a~p 选择　Esc 关闭');
            }
            return;
          }
          if (r.action === 'ride') {                   // 0-DC：骑乘面板（乗る / 乗せる）
            this.closeNPC();
            if (Elona.Panels) Elona.Panels.openRide(game, r.target);
            return;
          }
          // 0-EU：查看状态 → 完整人物信息窗（对 NPC 也能看技能/耐性/魔法）
          if (r.action === 'chara-info') {
            this.closeNPC();
            if (Elona.Panels && Elona.Panels.openCharaInfo) {
              Elona.Panels.openCharaInfo(game, r.target || npc);
            }
            return;
          }
          if (r.message) {
            this.pushMessage(r.message);
            this.npcText = r.message;
          }
          this.renderNPC(game);
      }
    },

    /**
     * 0-BW：快捷键触发（第 index 项 = 菜单顺序，对应原版 var_446 的字母）
     * @returns {boolean} 是否命中
     */
    triggerNPCAction(index) {
      const services = this.npcActions || [];
      if (index < 0 || index >= services.length) return false;
      this.runNPCAction(this.npcGame, services[index]);
      return true;
    },

    /** 给予物品：列出背包物品，点击交给 NPC */
    renderGiveList(game) {
      const box = this.el('npc-give');
      this.el('npc-train').classList.add('hidden');
      box.classList.remove('hidden');
      box.innerHTML = '';
      const inv = game.player.inv || [];
      let n = 0;
      for (let i = 0; i < inv.length; i++) {
        const it = inv[i];
        if (!it || (it.f[0] | 0) <= 0) continue;
        const name = Elona.ItemDB ? Elona.ItemDB.name(it.id, 'en') : ('item ' + it.id);
        const row = document.createElement('div');
        row.className = 'inv-row';
        const disabled = it.eqSlot >= 0;
        row.innerHTML = `<span class="inv-name">${this.esc(name)}</span>` +
          `<span class="inv-meta">×${it.f[0] | 0}${disabled ? '（装备中）' : ''}</span>`;
        if (!disabled) {
          row.onclick = () => {
            const r = Elona.NPC.perform(game, this.npcTarget, 'give', i);
            this.pushMessage(r.message);
            this.npcText = r.message;
            box.classList.add('hidden');
            this.renderNPC(game);
          };
        } else {
          row.style.opacity = 0.5;
        }
        box.appendChild(row);
        n++;
      }
      if (!n) {
        box.innerHTML = '<div class="inv-row"><span class="inv-name">背包里没有可以给予的物品。</span></div>';
      }
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      cancel.style.marginTop = '6px';
      cancel.onclick = () => box.classList.add('hidden');
      box.appendChild(cancel);
    },

    /**
     * 0-CC：通用「选一项然后执行」列表（复用 npc-give 容器）
     */
    renderPickList(game, action, header, entries) {
      const box = this.el('npc-give');
      this.el('npc-train').classList.add('hidden');
      box.classList.remove('hidden');
      box.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'inv-row';
      head.innerHTML = `<span class="inv-name">${this.esc(header)}</span>`;
      box.appendChild(head);
      for (const e of entries) {
        const row = document.createElement('div');
        row.className = 'inv-row';
        row.innerHTML = `<span class="inv-name">${this.esc(e.label)}</span>`
          + (e.meta ? `<span class="inv-meta">${this.esc(e.meta)}</span>` : '');
        row.onclick = () => {
          const r = Elona.NPC.perform(game, this.npcTarget, action, e.arg);
          this.pushMessage(r.message);
          this.npcText = r.message;
          box.classList.add('hidden');
          this.renderNPC(game);
        };
        box.appendChild(row);
      }
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      cancel.style.marginTop = '6px';
      cancel.onclick = () => box.classList.add('hidden');
      box.appendChild(cancel);
    },

    /**
     * 0-DI：武具店的装备选择（原版 var_486 = 23，296430 的过滤：
     *   类别 < 50000 或 = 60000 的物品才算「装备」）。
     * @param {string} action 'enhance' | 'lighten' | 'heavify'
     */
    renderEquipList(game, action) {
      const box = this.el('npc-give');
      this.el('npc-train').classList.add('hidden');
      box.classList.remove('hidden');
      box.innerHTML = '';
      const p = game.player;
      const entries = [];
      const inv = p.inv || [];
      for (let i = 0; i < inv.length; i++) {
        const it = inv[i];
        if (!it || (it.f[0] | 0) <= 0) continue;
        const cat = Elona.ItemDB.ref(it.id, 5);
        if (!(cat < 50000 || cat === 60000)) continue;
        entries.push({ it, idx: i });
      }
      const head = document.createElement('div');
      head.className = 'inv-row';
      head.innerHTML = `<span class="inv-name">${action === 'enhance' ? '强化哪件装备？'
        : (action === 'lighten' ? '轻量化哪件装备？' : '重量化哪件装备？')}</span>`;
      box.appendChild(head);
      if (!entries.length) {
        const row = document.createElement('div');
        row.className = 'inv-row';
        row.innerHTML = '<span class="inv-name">没有可以处理的装备。</span>';
        box.appendChild(row);
      }
      for (const { it, idx } of entries) {
        const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : ('item ' + it.id);
        const wt = ((it.f[7] | 0) / 1000).toFixed(1);
        if (action === 'enhance') {
          const cost = Elona.NPC.enhanceCost(it);
          const row = document.createElement('div');
          row.className = 'inv-row';
          row.innerHTML = `<span class="inv-name">${this.esc(name)} +${it.f[20] | 0}</span>`
            + `<span class="inv-meta">强化费 ${cost} gold</span>`;
          row.onclick = () => {
            const r = Elona.NPC.perform(game, this.npcTarget, 'enhance', idx);
            this.pushMessage(r.message);
            this.npcText = r.message;
            box.classList.add('hidden');
            this.renderNPC(game);
          };
          box.appendChild(row);
        } else {
          const unit = action === 'lighten' ? 12000 : 4000;
          for (const [u, label] of [[1, '0.1s'], [10, '1.0s']]) {
            const row = document.createElement('div');
            row.className = 'inv-row';
            row.innerHTML = `<span class="inv-name">${this.esc(name)}（${wt}s）</span>`
              + `<span class="inv-meta">${label} / ${unit * u} gold</span>`;
            row.onclick = () => {
              const r = Elona.NPC.perform(game, this.npcTarget, action, [idx, u]);
              this.pushMessage(r.message);
              this.npcText = r.message;
              box.classList.add('hidden');
              this.renderNPC(game);
            };
            box.appendChild(row);
          }
        }
      }
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      cancel.style.marginTop = '6px';
      cancel.onclick = () => box.classList.add('hidden');
      box.appendChild(cancel);
    },

    /**
     * 0-DI：冒险者一览（*label_2720）。mode = 'intel'（100 gold 看详情）或
     * 'message'（2000 gold 传话，选中后进入讯息选择）。
     */
    renderAdventurerList(game, mode, list) {
      const box = this.el('npc-give');
      this.el('npc-train').classList.add('hidden');
      box.classList.remove('hidden');
      box.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'inv-row';
      head.innerHTML = `<span class="inv-name">${mode === 'intel'
        ? '冒险者的情报（每位 100 gold）' : '给谁传话？（2000 gold）'}</span>`;
      box.appendChild(head);
      for (const c of list) {
        const imp = c.get(17) | 0;
        const row = document.createElement('div');
        row.className = 'inv-row';
        row.innerHTML = `<span class="inv-name">${this.esc(c.name)} Lv${c.level}</span>`
          + `<span class="inv-meta">名声 ${c.get(34) | 0}　好感 ${imp}</span>`;
        row.onclick = () => {
          if (mode === 'intel') {
            const r = Elona.NPC.perform(game, this.npcTarget, 'adventurer-info', c.index);
            this.pushMessage(r.message);
            this.npcText = r.message;
            box.classList.add('hidden');
            this.renderNPC(game);
          } else {
            const msgs = Elona.NPC.ADV_MESSAGES.map((label, i) => ({ label, arg: [c.index, i] }));
            this.renderPickList(game, 'message-send', `对 ${c.name} 说什么？`, msgs);
          }
        };
        box.appendChild(row);
      }
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      cancel.style.marginTop = '6px';
      cancel.onclick = () => box.classList.add('hidden');
      box.appendChild(cancel);
    },

    /** 0-CC：以物易物 —— 列出背包中非装备物品 */
    renderBarterList(game) {
      const inv = game.player.inv || [];
      const entries = [];
      for (let i = 0; i < inv.length; i++) {
        const it = inv[i];
        if (!it || (it.f[0] | 0) <= 0) continue;
        if (it.eqSlot >= 0) continue;
        const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : ('item ' + it.id);
        entries.push({ label: name, meta: `×${it.f[0] | 0}`, arg: i });
      }
      if (!entries.length) { this.pushMessage('背包里没有可以交换的物品。'); return; }
      this.renderPickList(game, 'barter', '选择要交出的物品（换回一件随机物品）', entries);
    },

    /**
     * 0-CB：鉴定屋的「鉴定一件 / 调查」物品选择（复用 npc-give 列表容器）
     * @param {string} action 'identify-one'（强度 250）或 'investigate'（强度 1000）
     */
    renderIdentifyList(game, action) {
      const box = this.el('npc-give');
      this.el('npc-train').classList.add('hidden');
      box.classList.remove('hidden');
      box.innerHTML = '';
      const p = game.player;
      const unknown = (Elona.NPC.unknownItems ? Elona.NPC.unknownItems(p) : [])
        .map((it) => ({ it, idx: (p.inv || []).indexOf(it) }));
      const kind = action === 'investigate' ? 2 : 0;
      const cost = Elona.NPC.calcIdentifyValue ? Elona.NPC.calcIdentifyValue(p, kind) : 0;
      const head = document.createElement('div');
      head.className = 'inv-row';
      head.innerHTML = `<span class="inv-name">${action === 'investigate' ? '调查' : '鉴定'}`
        + `（每件 ${cost} gold）</span>`;
      box.appendChild(head);
      if (!unknown.length) {
        const row = document.createElement('div');
        row.className = 'inv-row';
        row.innerHTML = '<span class="inv-name">没有未鉴定的物品。</span>';
        box.appendChild(row);
      }
      for (const { it, idx } of unknown) {
        const name = Elona.ItemDB ? Elona.ItemDB.name(it.id, 'en') : ('item ' + it.id);
        const row = document.createElement('div');
        row.className = 'inv-row';
        row.innerHTML = `<span class="inv-name">${this.esc(name)}</span>`
          + `<span class="inv-meta">×${it.f[0] | 0}　难度 ${it.f[29] | 0}</span>`;
        row.onclick = () => {
          const r = Elona.NPC.perform(game, this.npcTarget, action, idx);
          this.pushMessage(r.message);
          this.npcText = r.message;
          box.classList.add('hidden');
          this.renderNPC(game);
        };
        box.appendChild(row);
      }
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      cancel.style.marginTop = '6px';
      cancel.onclick = () => box.classList.add('hidden');
      box.appendChild(cancel);
    },

    // ---------- 掲示板 / 委托（*label_2704） ----------
    questOpen: false,
    questPage: 0,

    openQuestBoard(game) {
      if (!Elona.Quest) return;
      Elona.Quest.ensure(game);
      this.questOpen = true;
      this.el('quest').classList.remove('hidden');
      this.renderQuestBoard(game);
    },

    closeQuestBoard() {
      this.questOpen = false;
      this.el('quest').classList.add('hidden');
    },

    /** 掲示板翻页（原版 var_341 / var_342） */
    changeQuestPage(game, delta) {
      this.questPage = (this.questPage | 0) + delta;
      this.renderQuestBoard(game);
    },

    renderQuestBoard(game) {
      const Q = Elona.Quest;
      if (!Q) return;
      Q.ensure(game);

      // 进行中的委托（原版不在掲示板上报告，必须与委托人对话）
      const abox = this.el('quest-active');
      abox.innerHTML = '';
      const actives = Q.activeQuests(game);
      if (actives.length) {
        const head = document.createElement('div');
        head.innerHTML = `<b>进行中（${actives.length}/${Q.MAX_ACTIVE}）</b>`;
        abox.appendChild(head);
        for (const a of actives) {
          const div = document.createElement('div');
          div.className = 'quest-active-row';
          div.textContent = `${a.clientName}：${Q.describe(a)}　${Q.progressText(game, a)}` +
            `　期限 ${Q.daysText(a)}` + (Q.isComplete(game, a) ? '　★ 可以报告' : '');
          if (a.status === 1 && Q.QUEST_MAP_TYPES.indexOf(a.type) >= 0 && game.enterQuestMap) {
            const b = document.createElement('button');
            b.textContent = '前往委托地';
            b.style.marginLeft = '8px';
            b.onclick = () => {
              this.closeQuestBoard();
              game.enterQuestMap(a).catch(() => { });
            };
            div.appendChild(b);
          }
          abox.appendChild(div);
        }
      }

      // 可接取列表：4 条/页，Page N/M（286339-286443）
      const all = Q.available(game);
      const pageSize = Q.PAGE_SIZE;
      const pages = Math.max(1, Math.ceil(all.length / pageSize));
      this.questPage = Math.max(0, Math.min(this.questPage | 0, pages - 1));
      const start = this.questPage * pageSize;
      const rows = all.slice(start, start + pageSize);

      const list = this.el('quest-list');
      list.innerHTML = '';
      if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'q-sub';
        empty.textContent = all.length ? '本页没有委托。' : '新的委托还没有张贴出来。';
        list.appendChild(empty);
      }
      for (const q of rows) {
        const row = document.createElement('div');
        row.className = 'quest-row';
        const main = document.createElement('div');
        main.className = 'q-main';
        const title = document.createElement('div');
        title.className = 'q-title';
        title.innerHTML = `${this.esc(Q.describe(q))}` +
          `<span class="q-stars">${Q.stars(q)}</span>` +
          `${Q.rewardText(q)}`;
        const sub = document.createElement('div');
        sub.className = 'q-sub';
        sub.textContent = `委托人：${q.clientName}　期限：${Q.daysText(q)}` +
          `　类型：${Q.TYPE_NAMES[q.type] || ''}`;
        main.appendChild(title);
        main.appendChild(sub);
        row.appendChild(main);
        const btn = document.createElement('button');
        const full = actives.length >= Q.MAX_ACTIVE;
        btn.textContent = full ? '委托已满' : '接受';
        btn.disabled = full;
        btn.onclick = () => {
          const r = Q.accept(game, q.id);
          this.pushMessage(r.message);
          if (r.ok && r.enterMap && game.enterQuestMap) {
            this.closeQuestBoard();
            game.enterQuestMap(r.quest).catch(() => { });
            return;
          }
          this.renderQuestBoard(game);
        };
        row.appendChild(btn);
        list.appendChild(row);
      }

      const info = this.el('quest-page-info');
      if (info) info.textContent = `Page ${this.questPage + 1}/${pages}`;
      const prev = this.el('quest-prev');
      const next = this.el('quest-next');
      if (prev) {
        prev.disabled = this.questPage <= 0;
        prev.onclick = () => this.changeQuestPage(game, -1);
      }
      if (next) {
        next.disabled = this.questPage >= pages - 1;
        next.onclick = () => this.changeQuestPage(game, 1);
      }
    },

    // ---------- 世界地图 ----------
    openWorldMap(game) {
      const town = Elona.Towns && game.map ? Elona.Towns.byName(game.map.name) : null;
      this.el('wm-info').textContent =
        `当前位置：${town ? (Elona.Towns.labelOf ? Elona.Towns.labelOf(town) : town.label) : (game.map ? game.map.name : '未知')}　回合 ${game.turn}`;
      const box = this.el('wm-dest');
      if (box) {
        box.innerHTML = '';
        if (game.dungeonDepth > 0 || game.questMap) {
          const tip = document.createElement('div');
          tip.className = 'q-sub';
          tip.textContent = '只能在地表的城镇之间移动。';
          box.appendChild(tip);
        } else if (Elona.Towns) {
          for (const t of Elona.Towns.LIST) {
            const b = document.createElement('button');
            b.textContent = Elona.Towns.labelOf ? Elona.Towns.labelOf(t) : t.label;
            b.disabled = town && town.name === t.name;
            b.onclick = () => {
              this.closeWorldMap();
              if (game.travelToTown) game.travelToTown(t.name).catch(() => { });
            };
            box.appendChild(b);
          }
        }
        // 0-DB：丢弃陆上载具、改为徒步（422722-422745，源码里是队商对话的选项）
        if (Elona.Vehicle && Elona.Vehicle.landLevel(game) > 0) {
          const b = document.createElement('button');
          b.textContent = '乗り物を破棄して徒歩に戻る（Discard vehicle and walk）';
          b.onclick = () => {
            const r = Elona.Vehicle.discardLand(game);
            if (r && r.message) this.pushMessage(r.message);
            this.closeWorldMap();
          };
          box.appendChild(b);
        }
      }
      this.el('worldmap').classList.remove('hidden');
    },

    closeWorldMap() { this.el('worldmap').classList.add('hidden'); },

    /** 世界地图步行模式的调试直达栏（城镇按钮列表） */
    showWorldDebug(game) {
      const box = this.el('wm-walk');
      const dest = this.el('wm-walk-dest');
      if (!box || !dest || !Elona.Towns) return;
      box.classList.remove('hidden');
      dest.innerHTML = '';
      const cur = game.map ? game.map.name : null;
      for (const t of Elona.Towns.LIST) {
        const b = document.createElement('button');
        b.textContent = Elona.Towns.labelOf ? Elona.Towns.labelOf(t) : t.label;
        b.disabled = cur === t.name;
        b.onclick = () => {
          game.leaveWorldMap();
          this.hideWorldDebug();
          if (t.name !== cur && game.travelToTown) game.travelToTown(t.name).catch(() => { });
        };
        dest.appendChild(b);
      }
    },

    hideWorldDebug() {
      const box = this.el('wm-walk');
      if (box) box.classList.add('hidden');
    },
  };

  /**
   * 自身互动菜单的六个动作（`var_244 == 0`，289682-289733）。
   * 返回 true 表示已消费。
   */
  function selfAction(ui, game, s) {
    const id = s && s.id ? s.id : '';
    if (id.indexOf('self-') !== 0) return false;
    const p = game && game.player;
    if (!p) return true;
    switch (id) {
      case 'self-info':
        ui.closeNPC();
        if (Elona.Panels && Elona.Panels.openCharaInfo) Elona.Panels.openCharaInfo(game);
        return true;
      case 'self-name':
        if (Elona.Panels && Elona.Panels.openRename) {
          Elona.Panels.openRename(game, p, (r) => {
            // Panels.open 会先把 #npc 关掉，改完名要把自身菜单开回来
            ui.openSelfMenu(game);
            ui.npcText = (r && r.ok) ? (r.message || '改好了名字。') : '';
            ui.renderNPC(game);
          });
        }
        return true;
      case 'self-tag':
        selfTag(ui, game, p);
        return true;
      case 'self-tatie':
        ui.npcText = '「站姿」对应原版的站立立绘（user/graphic 的 tatie 图）。'
          + '本项目的对话窗口不显示立绘，选好站姿也没有可显示的地方。';
        ui.renderNPC(game);
        return true;
      case 'self-itemimg':
        ui.npcText = '「赋予道具图像」要在角色脚下追加一个道具图标（原版 var_58(447)）。'
          + '本项目的地图渲染没有这层附加图标，做出选择也看不到效果。';
        ui.renderNPC(game);
        return true;
      case 'self-tone':
        ui.npcText = '「改变口吻」影响的是原版固定 NPC 台词库的措辞；'
          + '本项目的中文台词是逐句写死的，没有可以替换的口吻表。';
        ui.renderNPC(game);
        return true;
      default:
        return false;
    }
  }

  /** 编成搭档（タッグ編成，290690-290757）：选一个在场同伴做追随者 */
  function selfTag(ui, game, p) {
    const C = Elona.Companion;
    if (!C || !C.tagCandidates) { ui.npcText = '搭档功能没有加载。'; ui.renderNPC(game); return; }
    const cand = C.tagCandidates(game, p).filter((c) => c !== p);
    if (!cand.length) {
      ui.npcText = '现在没有可以编成搭档的同伴（要在场、且双方都还没有搭档）。';
      ui.renderNPC(game);
      return;
    }
    const rows = cand.map((c) => ({
      c,
      label: `${c.name}（Lv ${c.get(38) | 0}）`,
      pick: () => {
        const r = C.tagBegin(game, p, c);
        ui.openSelfMenu(game);          // 选择窗关掉了 #npc，这里开回来
        ui.npcText = r.message;
        ui.renderNPC(game);
      },
    }));
    if (!Elona.Panels || !Elona.Panels.chooseRow) { ui.npcText = '选择窗口不可用。'; ui.renderNPC(game); return; }
    Elona.Panels.chooseRow('選擇搭檔 / Tag', rows.map((r) => r.label), (i) => {
      if (rows[i]) rows[i].pick();
    });
  }

  Elona.UI = UI;
})(window);
