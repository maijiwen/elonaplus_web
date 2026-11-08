'use strict';
/**
 * 选择窗（core/select.js）—— *label_2683「选目标」与 *label_2824「选物品」
 *
 * 【为什么单独做一个模块】
 *   对话脚本（start.hsp 367818-410727）里有 12 处 `gosub *label_2683`、
 *   8 处 `gosub *label_2824`。这两个子程序在原版里是**带滚动条的可视化列表窗**，
 *   不把它们的「候选集构造」抽出来，那 20 个分支就只能停在 blocked。
 *
 * 【调用契约（与源码一致）】
 *   *label_2683（284006-284577）
 *     入：var_1790 = 模式（1 卖同伴 / 3 觉醒·指导对象 / 7 全体同伴 …）
 *         var_581  = 要排除的角色（模式 5）
 *         var_244  = 当前交谈对象（模式 8 要排除）
 *     出：`return var_400` —— 选中的角色槽号；`return -1` —— Esc 取消
 *     同时 var_243 = 0、var_761 = 0（原版滚动位置，这里不用）
 *
 *   *label_2824（296163-296956）
 *     入：var_486 = 模式（23 = 分类过滤，var_486(1) = 子模式）
 *     出：选中 → 1，且 var_579 = 物品槽号；取消 → 0（调用方再看 var_138==var_150）
 *
 * 【实现范围（差异表 A360）】
 *   · 2683：模式 0/1/3/4/5/6/7/8/9/10 的筛选条件逐条照抄；模式 2（竞技场出场
 *     名单的多选开关 `var_1635`）只做成单选 —— 竞技场本体（*label_4352）未移植，
 *     该模式的调用方本来就走不通。
 *   · 2824：只做模式 23 的 34 个子模式（0..33）在**玩家背包**上的筛选。
 *     模式 22（临时背包：宝箱/落し物）没有对应实现 —— 本项目没有 tempinv，
 *     遇到时如实 blocked，不拿玩家背包冒充。
 *   · 原版窗口的排版（每页 16 行、`var_894` 翻页、`var_451` 第二列）换成
 *     普通的竖排列表，翻页由 UI 自己滚动。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = Math.trunc;

  function ref(id, f) {
    return (Elona.ItemDB && Elona.ItemDB.ref) ? (Elona.ItemDB.ref(id, f) | 0) : 0;
  }
  function ibit(bit, it) {
    return (Elona.ItemDB && Elona.ItemDB.ibit) ? (Elona.ItemDB.ibit(bit | 0, it) | 0) : 0;
  }
  function cbit(c, bit) {
    return (c && Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, bit | 0) | 0) : 0;
  }
  function gv(c, n) { return (c && c.get) ? (c.get(n | 0) | 0) : 0; }
  function fv(it, n) { return (it && it.f) ? (it.f[n | 0] | 0) : 0; }

  // ====================================================================
  // *label_2683 —— 选目标
  // ====================================================================

  /** 各模式的标题（284137-284272）。返回 {jp, en}，用法同其它双语文本。 */
  function charaPrompt(mode, opt) {
    opt = opt || {};
    const room = opt.roomKind | 0;      // var_132(16, var_65(20))：当前设施种类
    const action = opt.var2193 | 0;
    switch (mode | 0) {
      case 9: return { jp: '誰を収容する？', en: 'Place who?' };
      case 0:
      case 10: return { jp: '誰を呼び戻す？', en: 'call who?' };
      case 1: return { jp: '誰を売り飛ばす？', en: 'Sell who?' };
      case 2: return { jp: '試合の規定人数: ', en: 'Participant: ' };
      case 3:
        if (action === 1000) return { jp: '誰の部位を増やす？', en: 'Whose parts do you want to increase?' };
        if (action === 100) return { jp: '誰に手伝わせる？', en: 'Who takes the role of breeder?' };
        if (action === 10) return { jp: '誰の話？', en: 'Who are you talking about?' };
        if (room === 67) return { jp: '誰を入門させる？', en: 'Who train here?' };
        if (room === 100) return { jp: '誰を放牧する？', en: 'Who put here?' };
        if (room === 102) return { jp: '誰を店長にする？', en: 'Who takes the role of shopkeeper?' };
        if (room === 31) return { jp: '誰をブリーダーにする？', en: 'Who takes the role of breeder?' };
        if ((opt.mapId | 0) === 7) return { jp: '誰を滞在させる？', en: 'Who stays in your home?' };
        return { jp: '誰の力を覚醒させる？', en: 'Whose power do you awaken?' };
      case 4:
      case 5:
      case 6:
      case 7:
      case 8: return { jp: '対象にする仲間は？', en: 'Who is the subject?' };
      default: return { jp: '誰を選ぶ？', en: 'Select who?' };
    }
  }

  /**
   * 候选角色列表（284018-284104 的筛选条件逐条照抄）。
   * @returns {Array<{v:number,label:string,level:number}>}  v = 角色槽号
   */
  function charaList(g, mode, opt) {
    opt = opt || {};
    mode = mode | 0;
    const chars = (g && g.charas) || [];
    const var244 = opt.npc || null;          // 当前交谈对象
    const var581 = opt.var581 | 0;           // 要排除的角色槽
    const out = [];
    for (let cnt = 0; cnt < 16; cnt++) {
      const c = chars[cnt];
      const type = gv(c, 0);
      if (type === 0) continue;              // 284019：空槽
      if (mode === 1 && (type === 6 || cbit(c, 1053))) continue;      // 284023
      if (mode === 7 && cbit(c, 1053)) continue;                      // 284028
      if ((mode === 3 || mode === 5 || mode === 6) && type !== 1) continue;  // 284033
      if (mode === 5 && cnt === var581) continue;                     // 284038
      if (mode === 2 && gv(c, 168) !== 0) continue;                   // 284043
      if (gv(c, 80) !== 0 && (mode === 1 || mode === 2)) continue;    // 284047
      if (mode !== 9 && mode !== 10) {                                // 284052
        if (mode !== 1 && cbit(c, 963) === 1) continue;
        if (mode > 1 && cbit(c, 1040) === 1) continue;
        if (mode !== 6 && cbit(c, 971) === 1) continue;
        if (mode !== 6 && cbit(c, 975)) continue;
      }
      if (mode === 8) {                                               // 284074
        if (cnt === (var244 && var244.index)) continue;
        if (gv(c, 168) !== 0) continue;
        if (type !== 1) continue;
        if (gv(c, 80) !== 0) continue;
      }
      if (mode === 9) {                                               // 284088
        if (cbit(c, 1040) !== 1) continue;
        if (type !== 1) continue;
        if (gv(c, 80) !== 0) continue;
      }
      if (cnt === 0) continue;                                        // 284099：玩家不入列
      const label = charaLabel(c, cnt);
      out.push({ v: cnt, label, level: gv(c, 38) });
    }
    // 284102：var_484(0,i) = cnt, -var_58(38,cnt) —— 第二列是排序键（等级降序）
    out.sort((a, b) => b.level - a.level || a.v - b.v);
    return out;
  }

  /** 284328-284346：`var_63(1) + " " + var_63(0)` + 所在场景 +（乗馬） */
  function charaLabel(c, cnt) {
    let s = c.name || ('#' + cnt);
    const map = gv(c, 80);
    if (map !== 0 && Elona.World && Elona.World.mapName) {
      try { s += '(' + Elona.World.mapName(map) + ')'; } catch (e) { /* noop */ }
    }
    if (cbit(c, 975)) s += '(乗馬)';
    return s;
  }

  // ====================================================================
  // *label_2707 —— 第二个选目标窗（NPC 一覧 / 雇用）
  // ====================================================================
  /**
   * 286511-286594 的筛选。与 2683 的区别是它按「角色类型」分：
   *   0 已婚 NPC（给我打工）/ 1、7 未雇用的候补 / 2 尸体 / 3、4、5、6 特殊用途
   * @returns {Array<{v:number,label:string,level:number}>}
   */
  function npcList(g, mode, opt) {
    opt = opt || {};
    mode = mode | 0;
    const chars = (g && g.charas) || [];
    const mapId = opt.mapId | 0;
    const var581 = opt.var581 | 0;
    const px = (g && g.player) ? (g.player.x | 0) : 0;
    const py = (g && g.player) ? (g.player.y | 0) : 0;
    const out = [];
    for (let cnt = 0; cnt < 245; cnt++) {
      const c = chars[cnt];
      const type = gv(c, 0);
      if (!c) continue;
      if (type === 0) continue;
      if (mode === 2 && !(type === 6 || type === 2)) continue;          // 286522
      if ((mode === 1 || mode === 7) && type !== 10) continue;          // 286526
      if (mode === 0) {                                                 // 286531
        if (type !== 1 || cnt < 16) continue;
        if (gv(c, 80) !== mapId) continue;
      }
      if (mode === 3) {                                                 // 286541
        if (type !== 1 || cnt < 16) continue;
        const id150 = gv(c, 150);
        if (id150 >= 5 && id150 < 2000) continue;
      }
      if (mode === 4) {                                                 // 286552
        if (type !== 1) continue;
        if (gv(c, 9) !== 10 && cnt >= 16) continue;
      }
      if (mode === 5) {                                                 // 286560
        if (type !== 1 || cnt === var581) continue;
        const d = Math.abs((c.x | 0) - px) + Math.abs((c.y | 0) - py);
        if (d > 1) continue;
      }
      if (mode === 6) {                                                 // 286571
        if (type !== 1 || cbit(c, 992) !== 1) continue;
        const sp = gv(c, 27);
        if ([1127, 1128, 1129, 1130].indexOf(sp) < 0) continue;
        if (gv(c, 7) === 1173) continue;
      }
      if (mode !== 5 && cnt === 0) continue;                            // 286585
      if (cbit(c, 971) === 1) continue;                                 // 286590
      out.push({ v: cnt, label: charaLabel(c, cnt), level: gv(c, 38) });
    }
    out.sort((a, b) => b.level - a.level || a.v - b.v);
    return out;
  }

  // ====================================================================
  // *label_2824 —— 选物品
  // ====================================================================

  /** 各模式的标题。目前只有 23 会被对话脚本用到。 */
  function itemPrompt(mode, sub) {
    mode = mode | 0; sub = sub | 0;
    if (mode === 23) {
      if (sub === 0) return { jp: 'どの品を選ぶ？', en: 'Which?' };
    }
    return { jp: 'どの品を選ぶ？', en: 'Which item?' };
  }

  /**
   * 玩家背包的筛选（296235-296702 的通用门 + 模式 23 的 34 个子模式）。
   * @returns {null|Array<{v:number,label:string}>}  null = 该模式没实现（调用方应 blocked）
   */
  function itemList(g, mode, sub, opt) {
    mode = mode | 0; sub = sub | 0;
    opt = opt || {};
    if (mode !== 23) return null;            // 22 临时背包 / 其它模式未实现
    const p = (g && g.player) || null;
    const inv = (p && p.inv) || [];
    const out = [];
    // 模式 9 用：正在改造的ポーショマン（var_1580 是物品槽号，296487 要读它身上底座的类别）
    const base = inv[opt.var1580 | 0];
    const baseCat = base ? ref(fv(base, 3), 5) : 0;
    for (let cnt = 0; cnt < inv.length; cnt++) {
      const it = inv[cnt];
      if (!it) continue;
      if (fv(it, 0) <= 0) continue;                        // 296236
      const id = fv(it, 3);
      if (id >= 1499 || id < 0) continue;                  // 296246
      const cat = ref(id, 5);                              // var_657
      if (!itemFilter23(sub, it, cat, baseCat)) continue;
      out.push({ v: cnt, label: itemLabel(it, cnt) });
    }
    return out;
  }

  /** 模式 23 的子模式筛选：296430-296702 逐条对照 */
  function itemFilter23(sub, it, cat, baseCat) {
    switch (sub) {
      case 0:  // 296431：非装备类（类别 < 50000 或 60000）
        return !(cat >= 50000 && cat !== 60000);
      case 1:  // 296436：武器 / 防具 / 盾
        return cat === 10000 || cat === 24000 || cat === 25000;
      case 2: { // 296441：可装备（12000..24000 / 30000..50000）
        const a = (cat >= 12000 && cat < 24000);
        const b = (cat >= 30000 && cat < 50000);
        return a || b;
      }
      case 3:  // 296448：ibit(4)（随机附加值物品）
        return ibit(4, it) !== 0;
      case 4:  // 296453：未装备
        return fv(it, 18) === 0;
      case 5:  // 296458：食物类 56000
        return cat === 56000;
      case 6:  // 296463：可食用（f[7] > 0 且不是 641 号）
        return !(fv(it, 7) <= 0 || fv(it, 3) === 641);
      case 7:  // 296468：低阶装备（f[4] < 4 且类别 < 50000）
        return !(fv(it, 4) >= 4 || cat >= 50000);
      case 8:  // 296473：高阶装备（f[4] >= 4、类别 < 50000、排除 25000..25030）
        if (fv(it, 4) < 4 || cat >= 50000) return false;
        return !(cat >= 25000 && cat <= 25030);
      case 9: { // 296481：ポーショマン（833..843 / 968..970）
        const id = fv(it, 3);
        if (id < 833 || (id > 843 && (id < 968 || id > 970))) return false;
        if (id === 970) {
          const q = fv(it, 25);
          const ok = (q > 25 || q === 10 || q === 11 || q === 16 || q === 19 || q === 23);
          // 296487：品质不够时，只有底座是「宠物笼（10000/24000）」才允许
          if (!ok && baseCat !== 10000 && baseCat !== 24000) return false;
        }
        return true;
      }
      case 10: { // 296493：可改造/可变化之物（排除 342/729/21 在 1..5/555）
        const id = fv(it, 3);
        if (id === 342 || id === 729 || id === 555) return false;
        const t = fv(it, 21);
        return !(t >= 1 && t <= 5);
      }
      case 11: { // 296498：卷轴类 52000，排除指定 id
        if (cat !== 52000) return false;
        return [847, 799, 771, 706, 626, 601, 587, 577, 287, 1005, 574].indexOf(fv(it, 3)) < 0;
      }
      case 12: // 296506：杖 54000，排除 783
        return cat === 54000 && fv(it, 3) !== 783;
      case 13: { // 296514：药水 56000，只列指定 id
        if (cat !== 56000) return false;
        return [1032, 1027, 1026, 901, 887, 570, 565, 175, 123, 122, 120].indexOf(fv(it, 3)) >= 0;
      }
      case 14: // 296522：72000 类别，只列 734/240/241
        return cat === 72000 && [734, 240, 241].indexOf(fv(it, 3)) >= 0;
      case 15: // 296530：装备类且 f[4] < 6
        return !(cat < 10000 || cat > 50000 || fv(it, 4) >= 6);
      case 16: // 296538：装备类且 f[4] >= 4
        return !(cat < 10000 || cat > 50000 || fv(it, 4) < 4);
      case 17: { // 296546：食物 57000 的进阶筛选
        if (cat !== 57000) return false;
        if (fv(it, 24) === 35 && fv(it, 27) < 0) return false;
        if (fv(it, 17) <= -1) return false;
        if (ibit(14, it) === 1) return false;
        if (ibit(20, it) === 1) return false;
        if (fv(it, 26) < 5) return false;
        const q = idiv(fv(it, 25), 1000);
        return q >= 1 && q <= 8;
      }
      case 18: // 296571：装备类
        return !(cat < 10000 || cat > 50000);
      case 19: // 296576：食物 57000
        return cat === 57000;
      case 20: // 296581：宠物笼（10000/24000 且 ibit(10)）
        return (cat === 10000 || cat === 24000) && ibit(10, it) === 1;
      case 21: // 296589：1197 号
        return fv(it, 3) === 1197;
      case 22: // 296594：ポーショマン本体（1200..1203 且 f[27]==0）
        return [1203, 1202, 1201, 1200].indexOf(fv(it, 3)) >= 0 && fv(it, 27) === 0;
      case 23: // 296602：木材 53000 且数量 >= 10
        return cat === 53000 && fv(it, 0) >= 10;
      case 24: // 296610：木材 53000 且数量 >= 20
        return cat === 53000 && fv(it, 0) >= 20;
      case 25: // 296618：未被占用的可赠与之物
        return !(fv(it, 7) <= 0 || fv(it, 18) !== 0 || ibit(13, it) || ibit(5, it));
      case 26: // 296632：可培养的宠物（ibit(10)、等级 < 15、经验未满）
        return ibit(10, it) === 1 && fv(it, 25) < 15
          && fv(it, 26) < calcExpAlive(fv(it, 25));
      case 27: // 296643：204 号且 f[32]!=0 且 f[26]==0
        return fv(it, 3) === 204 && fv(it, 32) !== 0 && fv(it, 26) === 0;
      case 28: // 296654：ポーショマン且 f[31]!=0
        return [1203, 1202, 1201, 1200].indexOf(fv(it, 3)) >= 0 && fv(it, 31) !== 0;
      case 29: // 296662：ポーショマン、f[27]!=0 且 f[31]==0
        return [1203, 1202, 1201, 1200].indexOf(fv(it, 3)) >= 0
          && fv(it, 27) !== 0 && fv(it, 31) === 0;
      case 30: // 296673：ポーショマン（已改造过一部）
        return [1203, 1202, 1201, 1200].indexOf(fv(it, 3)) >= 0 && fv(it, 27) !== 0;
      case 31: // 296681：食物 57000 且非 ibit(20)
        return ibit(20, it) !== 1 && cat === 57000;
      case 32: // 296689：杖 54000，排除 783/687/289
        return cat === 54000 && [783, 687, 289].indexOf(fv(it, 3)) < 0;
      case 33: // 296697：504 号
        return fv(it, 3) === 504;
      default:
        return true;
    }
  }

  /** 296635：calcexpalive(level) —— 宠物升级所需经验 */
  function calcExpAlive(lv) {
    lv = lv | 0;
    if (Elona.Chara && Elona.Chara.expToNext) {
      try { return Elona.Chara.expToNext(lv) | 0; } catch (e) { /* noop */ }
    }
    return 10 + lv * 10;
  }

  function itemLabel(it, cnt) {
    const id = fv(it, 3);
    let name = (it.name && typeof it.name === 'function') ? (it.name('en') || '')
      : ((Elona.ItemDB && Elona.ItemDB.name) ? Elona.ItemDB.name(id, 'en') : ('#' + id));
    const n = fv(it, 0);
    if (n > 1) name += ' x' + n;
    if (fv(it, 18) !== 0) name += ' (装備中)';
    return name || ('#' + cnt);
  }

  const Select = {
    charaPrompt, charaList, charaLabel, npcList,
    itemPrompt, itemList,
    // 供测试直接用
    _itemFilter23: itemFilter23,
  };
  Elona.Select = Select;
})(typeof window !== 'undefined' ? window : globalThis);
