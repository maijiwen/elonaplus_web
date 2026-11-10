'use strict';
/**
 * 「誰が使用する？」效果本体 —— core/itemfx_use.js
 *
 * 【原版的通用骨架】
 *   350569-359482 里 30 余个效果都是同一个结构：
 *
 *     var_242 = 0 ; var_246 = ... ; txt_select lang("誰に〜？")     ← 提示
 *     gosub *label_2104                                            ← 等按键
 *     gosub *label_2893                                            ← 邻格箭头（305110-305231）
 *       · 屏幕上在玩家周围画 8 个箭头，方向键直接把光标移到**玩家的一格邻格**
 *       · 回车 / 空格 → 光标仍在玩家格 → var_244 = 0（对自己）
 *       · 越界 / 非方向键 → stat = 0（没有选到目标）
 *     if (var_704(var_451, var_1166, 1) > 0) var_244 = var_704(...) - 1
 *     if (var_58(168, var_244) != 0) {                              ← 目标处于タッグ编成中
 *        txtselecttc 2 ; gosub *label_2896                          ← 二选一
 *        if (stat == 0) goto *label_4363                            ← 取消
 *        if (var_444 == 1) var_244 = var_58(167, var_244)           ← 换成搭档
 *     }
 *     … 效果本体 …
 *
 *   于是本项目把「邻格选人 + タッグ二选一」抽成通用前置步骤，本模块只写本体。
 *
 * 【收尾三档】（已逐个 dump 原始行号确认）
 *   *label_4363（605329）不消耗回合，直接回主循环           → END.NONE
 *   *label_4358（604861）消耗回合                          → END.TURN
 *   *label_3017（364789）gosub *label_2225（只重算玩家负重）→ goto *label_4358
 *                                                          → END.TURN_WEIGHT
 *
 * 【「没有选到目标」的两种写法】
 *   Type A：`gosub *label_2893` 之后立刻 `if (stat == 0) { "それは無理だ。" ; goto *label_4363 }`
 *           → 18 个：5 / 85 / 104 / 117 / 120 / 122 / 125 / 127 / 128 / 130 / 132 /
 *                     139 / 140 / 141 / 142 / 143 / 145 / 150
 *   特例  ：72 —— 没有 stat==0 分支，`if (stat != 0)` 之后直接落到 `goto *label_3017`，
 *           也就是说「没选到目标」**静默**消耗回合（无提示）
 *   Type B：`var_1442 = 0` + 末尾 `if (var_1442 == 0) { "それは無理だ。" }` → `goto *label_3017`
 *           → 12 个：23 / 45 / 59 / 60 / 62 / 66 / 73 / 77 / 80 / 81 / 95 / 146
 *           （125 虽然也有 var_1442 兜底，但兜底后面跟的是 `goto *label_4363`）
 *
 * 【世界地图上静默返回】（`var_126(6) == 1` → `goto *label_3017`，无提示）
 *   16 个：85 / 104 / 117 / 120 / 122 / 127 / 128 / 130 / 132 / 139 / 140 / 141 /
 *          142 / 143 / 145 / 150
 *
 * 【タッグ的三种处理】
 *   · 二选一（28 个）：5 / 23 / 59 / 60 / 66 / 72 / 73 / 77 / 80 / 81 / 85 / 95 /
 *                      104 / 117 / 120 / 122 / 125 / 127 / 128 / 130 / 132 / 139 /
 *                      140 / 141 / 142 / 143 / 145 / 150
 *   · 直接拒绝（2 个）：45「タッグは吊るせない。」(354224) / 146「タッグは閉じ込められない。」(354330)
 *   · 完全没有判定（1 个）：62（356373-356550 全区间没有 `var_58(168`）
 *
 * 【差异登记】
 *   A411  二选一原本是「タッグ左側 / タッグ右側」的位置语义，本项目改成
 *         「列出两名成员的名字，选谁就以谁为目标」；Esc 也可取消（原版 stat=0 → 4363）。
 *         var_444 == 1 时仍然等价于 `var_244 = var_58(167, var_244)`。
 *   A412  80 弹药箱的写回式 `var_99(41) = var_399(1)*1000 + var_399(1)` 疑似原件笔误
 *         （写回的是「当前发数」而不是低位），按「代码证据优先」原样照抄。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  // ======================================================================
  // 小工具
  // ======================================================================
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
  const R = (g, n) => ((g && g.rng) ? g.rng.rnd(Math.max(1, n | 0)) : 0);
  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);
  const S = (c, n) => (c && typeof c.skill === 'function' ? (c.skill(n) | 0) : 0);
  const nm = (c) => (c && (c.name || c.cname)) || '对方';

  /** 世界地图（var_126(6) == 1）—— 1 = 世界地图 */
  function onWorld(g) {
    if (!g) return false;
    if (g.worldMap) return true;
    const h = g.map && g.map.header;
    return !!(h && (h[6] | 0) === 1);
  }

  function cbit(c, bit) {
    const St = Elona.Status;
    return St && St.cbit ? (St.cbit(c, bit) | 0) : 0;
  }
  function cbitmod(c, bit, on) {
    const St = Elona.Status;
    if (St && St.cbitmod) St.cbitmod(c, bit, on);
  }

  /** var_99(0) -= 1 + cell_refresh */
  function consume(g, it) {
    if (!it || !it.f) return;
    if ((it.f[0] | 0) > 0) it.f[0] = (it.f[0] | 0) - 1;
    if (g && g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
  }

  /** 生成一件物品到指定格（`itemcreate -1, id, x, y, 0` 的最小等价） */
  function spawnAt(g, id, x, y) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    let it = null;
    try { it = Elona.ItemDB.createItem(id, 1, g.rng); } catch (e) { it = null; }
    if (!it) return null;
    it.f[0] = 1;
    it.f[5] = x | 0; it.f[6] = y | 0;
    const cell = g.map && g.map.cell ? g.map.cell(x | 0, y | 0) : null;
    if (cell) cell[4] = 1;
    g.groundItems.push(it);
    if (g.refreshGroundCell) g.refreshGroundCell(x | 0, y | 0);
    return it;
  }

  /** gosub *label_2225 —— 只重算玩家（index 0）的负重 */
  function weight(g) {
    if (Elona.Feat && Elona.Feat.applyWeight && g && g.player) {
      try { Elona.Feat.applyWeight(g.player, g); } catch (e) { /* 未就绪 */ }
    }
  }
  /** gosub *label_2174 —— 派生值重算 */
  function recalc(g, c) {
    if (Elona.Stats && Elona.Stats.recalcStats && c) {
      try { Elona.Stats.recalcStats(c, g); } catch (e) { /* 未就绪 */ }
    }
  }
  /** gosub *label_2143 —— 重数身体部位 → var_58(68) */
  function recountParts(c) {
    if (!c) return 0;
    let n = 0;
    for (let i = 100; i < 130; i++) if ((c.get(i) | 0) !== 0) n++;
    let v = 0;
    if (n > 13) v = limit((n - 13) * 5, 0, 50);
    c.set(68, v);
    return v;
  }

  /** itemcreate -1, id, x, y, 0 —— 在地面放一件物品 */
  function spawnAt(g, id, x, y) {
    if (!g || !Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    let it = null;
    try { it = Elona.ItemDB.createItem(id, 1); } catch (e) { it = null; }
    if (!it) return null;
    it.f[5] = x | 0;
    it.f[6] = y | 0;
    it.f[21] = -1;
    if (!Array.isArray(g.groundItems)) g.groundItems = [];
    g.groundItems.push(it);
    if (g.refreshGroundCell) g.refreshGroundCell(x | 0, y | 0);
    return it;
  }

  /** 性格名（var_278，8775 / 8778） */
  const PERSONALITY = [
    '未设定', '开朗', '慎重', '献身', '豪爽', '自信', '谦虚', '沉默', '勤勉', '纯真',
    '纤细', '温厚', '热情', '坏心眼', '好色', '刻薄', '冷酷', '好战', '腹黑', '偏执',
    '顽固', '守财奴', '懒惰', '糊涂', '乐天', '情绪化', '卑鄙', '傲慢', '胆小', '阴郁',
    '猎奇', '爱开玩笑', '内向', '神经质', '下流', '天邪鬼', '刚强',
  ];
  function personalityOf(id) {
    const n = id | 0;
    return PERSONALITY[n] || PERSONALITY[0];
  }

  /** txtseteyes 12（11326-11370） */
  const EYES = ['无', '火焰', '寒气', '雷电', '黑暗', '精神', '毒', '地狱', '声音', '神经', '混沌', '魔法'];
  /** txtplusbody 10（11779-11817）—— 0 = 取消 */
  const BODY = ['取消', '头', '颈', '背', '躯体', '手', '指', '臂', '腰', '腿'];

  /** 802 星光笔的特殊生物所需等级（356387-356303） */
  const PEN_SPECIES_LEVEL = {
    878: 150, 877: 140, 876: 130, 875: 120, 579: 107, 416: 65,
    578: 40, 47: 20, 150: 12, 100: 14, 21: 8, 447: 4,
  };

  /** 60 空白名片的职业键名表（358303-358338） */
  const CLASS_KEYS = {
    '戦士': 'warrior', '战士': 'warrior', 'warrior': 'warrior',
    '遺跡荒らし': 'thief', '遗迹破坏者': 'thief', '盗贼': 'thief', 'thief': 'thief',
    '魔法使い': 'wizard', '魔法师': 'wizard', 'wizard': 'wizard',
    '農民': 'farmer', '农民': 'farmer', 'farmer': 'farmer',
    'プレデター': 'predator', '掠食者': 'predator', 'predator': 'predator',
    '狩人': 'archer', '猎人': 'archer', 'archer': 'archer',
    '魔法戦士': 'warmage', '魔法战士': 'warmage', 'warmage': 'warmage',
    '観光客': 'tourist', '观光客': 'tourist', 'tourist': 'tourist',
    'ピアニスト': 'pianist', '钢琴家': 'pianist', 'pianist': 'pianist',
    '機工兵': 'gunner', '机工兵': 'gunner', 'gunner': 'gunner',
    'プリースト': 'priest', '祭司': 'priest', 'priest': 'priest',
    'クレイモア': 'claymore', '双刃剑士': 'claymore', 'claymore': 'claymore',
  };

  // ======================================================================
  // 效果本体
  // ======================================================================

  /** 5 听诊器（353981-354106）—— 不消耗物品 */
  function eff5(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    // 354034：目标是自己
    if ((c.index | 0) === 0) {
      g.log(' *ドクン ドクン* ');
      g.setV65(94, 0);
      return { end: 'turn' };
    }
    // 354041：同伴 1..15 —— cbit 966 是「正在监视」的标志
    if ((c.index | 0) < 16) {
      g.setV65(94, 0);
      if (cbit(c, 966) === 1) {
        cbitmod(c, 966, false);
        c.__hpbar = false;
        g.log(`你从${nm(c)}身上取下了听诊器。`);
        return { end: 'turn' };
      }
      g.log(`你把听诊器贴在了${nm(c)}身上。`);
      if (G(c, 8) === 1) {
        g.log(`${nm(c)}的脸红了。`);
        g.log('「呀——！」');
      }
      cbitmod(c, 966, true);
      c.__hpbar = true;
      return { end: 'turn' };
    }
    // 354070：敌人 —— 记录监视目标
    if (G(c, 0) === 1) {
      g.setV65(94, c.index | 0);
      g.log(`你把听诊器贴在了${nm(c)}身上。`);
      if (G(c, 8) === 1) {
        g.log(`${nm(c)}的脸红了。`);
        g.log('「变态！」');
      }
      return { end: 'turn' };
    }
    g.log('那是办不到的。');
    return { end: 'none' };
  }

  /** 23 绳扣（354107-354200）—— 只在「被抵抗扯断」时消耗 */
  function eff23(g, st) {
    const c = st.target;
    if (!c) return { end: 'turnWeight' };
    if ((c.index | 0) === 0) {
      // 354137：对自己用 —— 原版先出一句，再被 var_1442==0 的兜底补一句
      g.log('你试着把自己用绳子捆了起来……');
      g.log('那是办不到的。');
      return { end: 'turnWeight' };
    }
    if (cbit(c, 968) === 0) {
      // 354122-354125：目标 >= 16 时有 1/5 概率挣脱
      if ((c.index | 0) >= 16 && R(g, 5) === 0) {
        g.log(`${nm(c)}激烈挣扎，绳子断了。`);
        consume(g, st.it);
        weight(g);
        return { end: 'turnWeight' };
      }
      cbitmod(c, 968, true);
      c.__leash = true;
      g.log(`你用绳子把${nm(c)}捆住了。`);
      g.log(`${nm(c)}发出了呻吟。「嗯啊……♪」`);
    } else {
      cbitmod(c, 968, false);
      c.__leash = false;
      g.log(`你解开了捆在${nm(c)}身上的绳子。`);
      g.log(`${nm(c)}发出了呻吟。「呼……哈……」`);
    }
    return { end: 'turnWeight' };
  }

  /** 45 沙袋（354201-354298）—— タッグ直接拒绝 */
  function eff45(g, st) {
    const c = st.target;
    if (!c) return { end: 'turnWeight' };
    // 354232：必须先削弱
    if (G(c, 50) >= idiv(G(c, 51), 5)) {
      g.log('不让它再虚弱一点就吊不上去。');
      return { end: 'none' };
    }
    // 354242：同伴
    if ((c.index | 0) !== 0 && (c.index | 0) < 16) {
      g.log('把同伴吊起来什么的，太可怕了！');
      return { end: 'none' };
    }
    // 354252：已经吊着
    if (cbit(c, 985)) {
      g.log('它已经被吊起来了。');
      return { end: 'none' };
    }
    if ((c.index | 0) === 0) {
      g.log('你想把自己吊起来，却又放弃了……');
      return { end: 'turnWeight' };
    }
    cbitmod(c, 985, true);
    g.log(`你把${nm(c)}吊了起来。`);
    g.log(`${nm(c)}发出了呻吟。「嗯啊……♪」`);
    cbitmod(c, 1049, false);
    consume(g, st.it);
    weight(g);
    return { end: 'turnWeight' };
  }

  /** 59 哲学家面具（356551-356631）—— 改 var_63(7) 种族显示名 */
  function eff59(g, st) {
    const c = st.target;
    if (!c) return { end: 'turnWeight' };
    if ((c.index | 0) >= 16) {
      g.log('那是办不到的。');
      return { end: 'none' };
    }
    return {
      ok: false, effect: 59, action: 'race-input', request: 'race-input',
      target: c, title: '新的种族是？', hint: 'Enter 确定 · Esc 取消',
    };
  }
  function eff59res(g, st, text) {
    const c = st.target;
    const t = String(text || '').trim();
    if (!t) {
      g.log('还是算了。');
      return { end: 'turnWeight' };
    }
    c.raceDisplay = t;
    g.log(`${nm(c)}「${t}」重生了。`);
    consume(g, st.it);
    return { end: 'turnWeight' };
  }

  /** 60 空白名片（358234-358358）—— 改 var_63(6)/(3) 职业 */
  function eff60(g, st) {
    const c = st.target;
    if (!c) return { end: 'turnWeight' };
    if ((c.index | 0) >= 16) {
      g.log('那是办不到的。');
      return { end: 'none' };
    }
    if (cbit(c, 1034) === 1) {
      g.log('小孩子就让他继续做梦吧。');
      return { end: 'none' };
    }
    return {
      ok: false, effect: 60, action: 'class-input', request: 'class-input',
      target: c, title: '新的职业是？', hint: 'Enter 确定 · Esc 取消',
    };
  }
  function eff60res(g, st, text) {
    const c = st.target;
    const t = String(text || '').trim();
    if (!t) {
      g.log('还是算了。');
      return { end: 'turnWeight' };
    }
    const key = CLASS_KEYS[t];
    if (key) c.className = key;
    c.classDisplay = t;
    g.log(`${nm(c)}「${t}」上任了。`);
    consume(g, st.it);
    return { end: 'turnWeight' };
  }

  /** 62 星光笔（356373-356550）—— 分裂出一个同种族的同伴；无タッグ判定 */
  function eff62(g, st) {
    const c = st.target;
    if (!c) return { end: 'turnWeight' };
    const spec = cbit(c, 992) === 1;
    let need = 150;
    if (spec) {
      need = (PEN_SPECIES_LEVEL[G(c, 27)] !== undefined) ? PEN_SPECIES_LEVEL[G(c, 27)] : 150;
      if (G(g.player, 38) < idiv(need, 2)) {
        g.log('等级不足。');
        return { end: 'none' };
      }
    } else if (G(g.player, 38) < idiv(G(c, 38), 2)) {
      g.log('等级不足。');
      return { end: 'none' };
    }
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    if (mapId === 35) {
      g.log('这里不能用。');
      return { end: 'none' };
    }
    const v132_16 = (g.v132 && g.v132[String(mapId)] !== undefined) ? (g.v132[String(mapId)] | 0) : 0;
    if ((c.index | 0) < 16
        || (cbit(c, 960) === 1 && (mapId === 67 || v132_16 === 100))) {
      g.log('对那个对象不能用。');
      return { end: 'none' };
    }
    if (G(c, 25) < 4 && G(c, 150) === 0 && !spec) {
      g.log('对那个对象不能用。');
      return { end: 'none' };
    }
    if (G(c, 17) < 200) {
      g.log(`被${nm(c)}拒绝了。`);
      return { end: 'none' };
    }
    let ink = limit(idiv(G(c, 38), 10), 1, 200);
    if (spec) ink = limit(idiv(need, 10), 1, 200);
    const have = (Elona.Material && Elona.Material.get) ? Elona.Material.get(g, 36) : 0;
    if (have < ink) {
      g.log(`魔法墨水不够。需要 ${ink} 个。`);
      return { end: 'none' };
    }
    return {
      ok: false, effect: 62, action: 'confirm', request: 'confirm',
      target: c, ink: (st.ink = ink),
      title: `发动需要消耗 ${ink} 个魔法墨水。要发动吗？`,
      hint: 'y / Enter = 发动　n / Esc = 取消',
      tag: 'miranet',
    };
  }
  function eff62res(g, st, yes) {
    const c = st.target;
    if (!yes) return { end: 'none' };
    const ink = st.ink | 0;
    if (Elona.Material && Elona.Material.remove) Elona.Material.remove(g, 36, ink);
    consume(g, st.it);
    g.log(`${nm(c)}的存在分裂了！`);
    const CF = Elona.CharaFactory;
    let clone = null;
    if (CF && CF.create) {
      try {
        clone = CF.create(g, G(c, 27), G(c, 38), c.x | 0, c.y | 0, {});
      } catch (e) { clone = null; }
    }
    if (clone) {
      clone.set(8, G(c, 8));
      clone.set(7, G(c, 7));
      clone.set(435, G(c, 435));
      clone.set(13, G(c, 13));
      clone.set(25, G(c, 25));
      clone.set(17, G(c, 17));
      clone.set(19, G(c, 19));
      clone.set(20, G(c, 20));
      clone.set(21, G(c, 21));
      clone.set(61, G(c, 61));
      // 356367-356370：去掉名字尾部的「 LvN」
      let name = String(c.name || '');
      const suffix = ' Lv' + G(c, 38);
      if (name.length >= suffix.length
          && name.slice(name.length - suffix.length) === suffix) {
        name = name.slice(0, name.length - suffix.length);
      }
      clone.name = name;
      clone.cname = name;
      if (Elona.Party && Elona.Party.joinChara) {
        const jr = Elona.Party.joinChara(g, clone);
        if (jr && jr.message) g.log(jr.message);
      }
    }
    return { end: 'turnWeight' };
  }

  /** 66 灵魂纺锤（354420-354574）—— 第一次结线 / 第二次重逢 */
  function eff66(g, st) {
    const c = st.target;
    const it = st.it;
    if (!c) return { end: 'turnWeight' };
    if ((c.index | 0) === 0) {
      g.log('那是办不到的。');
      return { end: 'none' };
    }
    // 第一次（var_99(25) == 0）：在两人之间结下命运之线
    if ((it.f[25] | 0) === 0) {
      if ((c.index | 0) >= 16) {
        g.log('那是办不到的。');
        return { end: 'turnWeight' };
      }
      if (G(c, 17) < 200) {
        g.log(`${nm(c)}婉言拒绝了。`);
        return { end: 'turnWeight' };
      }
      g.log(`在${nm(c)}与你之间，命运之线结成了。`);
      consume(g, it);
      const x = G(g.player, 1), y = G(g.player, 2);
      const fresh = spawnAt(g, 930, x, y);
      if (fresh) {
        fresh.f[23] = G(c, 27);
        fresh.f[17] = 0;
        fresh.f[25] = 100 + R(g, 10000) + R(g, 500) + R(g, 2000);
        fresh.f[26] = 10000 + R(g, 10000) + R(g, 4000) + R(g, 5000);
        c.set(189, fresh.f[25] | 0);
        c.set(190, fresh.f[26] | 0);
        if ((g.getV65(198) | 0) === 0) {
          g.setV65(198, (fresh.f[26] | 0) + (fresh.f[25] | 0) + R(g, 10));
        }
        fresh.f[27] = g.getV65(198) | 0;
      }
      return { end: 'turnWeight' };
    }
    // 第二次：必须在展示厅（地图 35）重逢
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    if (mapId !== 35) {
      g.log('那东西只能在展示厅里用了。');
      return { end: 'turnWeight' };
    }
    if (G(c, 189) !== (it.f[25] | 0) || G(c, 190) !== (it.f[26] | 0)) {
      g.log('组合好像不对。');
      return { end: 'turnWeight' };
    }
    if ((it.f[27] | 0) === (g.getV65(198) | 0)) {
      g.log('还不是重逢的时候。');
      return { end: 'turnWeight' };
    }
    if (Elona.Party && Elona.Party.freeAlly && !Elona.Party.freeAlly(g)) {
      g.log('同伴人数已达上限，无法成为同伴。');
      return { end: 'turnWeight' };
    }
    g.log('超越一切，命运之线再次将两人系在一起……！');
    if (Elona.Party && Elona.Party.joinChara) {
      const jr = Elona.Party.joinChara(g, c);
      if (jr && jr.message) g.log(jr.message);
    }
    c.set(428, 0);
    g.log('灵魂的重逢在此达成了。');
    return { end: 'turnWeight' };
  }

  /** 72 洞察透镜（356967-357023）—— 无目标时静默消耗回合 */
  function eff72PreTarget(g, t, st) {
    // 356981-356985：目标是自己、且使用者是玩家时，自动换成坐骑（在タッグ判定之前）
    const mount = g.getV65 ? (g.getV65(183) | 0) : 0;
    if (t && (t.index | 0) === 0 && g.player && (g.player.index | 0) === 0 && mount !== 0) {
      const m = g.charas && g.charas[mount];
      if (m) return m;
    }
    return t;
  }
  function eff72(g, st) {
    const c = st.target;
    consume(g, st.it);
    if (c && G(c, 9) === -3) {
      g.log(`也分析出了${nm(c)}的动作。`);
      c.set(31, 100);
    }
    return { end: 'turnWeight', action: 'chara-info', target: c };
  }

  /**
   * 73 异形身体（356677-356893）—— 原版门槛 `var_65(250+302) == 140`。
   *
   * 源码里这个标志**只**由存档迁移设置（246617-246627：旧版本把 120..122 号多余部位
   * 清空后补发一件 990，并置 140），新游戏里它永远是 0，也就是这件物品在原版
   * 正常流程中拿不到、也用不了。
   *
   * 本项目按「长出新肢体要能在游戏里用」的目标放行（差异登记 A463），
   * 其余流程（选目标 → 选部位 → 写第一个空槽 → *label_2143 重算）逐字照抄。
   */
  function eff73PreCheck() {
    return null;
  }
  function eff73(g, st) {
    const c = st.target;
    if (!c) return { end: 'turnWeight' };
    if ((c.index | 0) >= 16) {
      g.log('那是办不到的。');
      return { end: 'none' };
    }
    return {
      ok: false, effect: 73, action: 'body-pick', request: 'body-pick',
      target: c, title: '要获得的部位是？', options: BODY.slice(),
    };
  }
  function eff73res(g, st, sel) {
    const c = st.target;
    const v = sel | 0;
    if (v <= 0 || v > 9) return { end: 'none' };
    let slot = -1;
    for (let i = 100; i < 130; i++) {
      if ((c.get(i) | 0) === 0) { slot = i; break; }
    }
    if (slot < 0) return { end: 'none' };
    c.set(slot, v * 10000);
    g.log(`${nm(c)}获得了新的${BODY[v]}！`);
    recountParts(c);
    consume(g, st.it);
    return { end: 'turnWeight' };
  }

  /** 77 形态核心（354915-355125）—— 不消耗物品 */
  function eff77(g, st) {
    const c = st.target;
    const it = st.it;
    if (!c) return { end: 'turnWeight' };
    if ((c.index | 0) >= 16) {
      g.log('那是办不到的。');
      return { end: 'turnWeight' };
    }
    if (G(c, 182) < 50) {
      g.log('那是办不到的。');
      return { end: 'turnWeight' };
    }
    const lv = G(c, 38);
    const root = Math.sqrt(lv + 1);
    const buffs = [
      [5, Math.trunc(lv * root) + 10],
      [7, Math.trunc(lv * 5 * root) + 10],
      [55, Math.trunc(lv * 5 * root) + 10],
      [43, Math.trunc(lv * 5 * root) + 10],
      [12, Math.trunc(lv * 5 * root) + 10],
    ];
    const addb = (id, p1, p2) => {
      if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, c, id, p1, p2);
    };
    if ((it.id | 0) >= 1000) for (const b of buffs) addb(b[0], b[1], 200);
    if ((it.id | 0) === 999) for (const b of buffs) addb(b[0], b[1], 150);

    // 354963：已经变形 → 先清掉 44..48 号 buff
    if (G(c, 409) > 0) {
      for (let cnt = 0; cnt < 16; cnt++) {
        const id = G(c, 280 + cnt * 3);
        if (id === 0) break;
        if (id >= 44 && id <= 48 && Elona.Status && Elona.Status.delbuff) {
          Elona.Status.delbuff(c, cnt);
        }
      }
      recalc(g, c);
    }
    // 354992：形态互换
    if (G(c, 409) === 0) {
      const swapV = (a, b) => { const t = c.get(a); c.set(a, c.get(b)); c.set(b, t); };
      let t = c.name; c.name = c.altName || ''; c.altName = t;
      if (!c.name) c.name = (c.altName || '') + '／转变体';
      if (c.cname === t) c.cname = c.name;
      swapV(13, 427);
      swapV(431, 432);
      if (Elona.PCC && Elona.PCC.ensure) { try { Elona.PCC.ensure(c, g.rng); } catch (e) { /* noop */ } }
      if (!c.pcc) c.pcc = new Array(25).fill(0);
      const swapPcc = (pi, vi) => {
        const a = c.pcc[pi] | 0;
        c.pcc[pi] = G(c, vi);
        c.set(vi, a);
      };
      swapPcc(1, 411); swapPcc(10, 420); swapPcc(15, 425); swapPcc(9, 419);
      swapPcc(7, 417); swapPcc(11, 421); swapPcc(12, 422); swapPcc(13, 423);
      swapPcc(14, 424); swapPcc(16, 426);
      if ((c.pcc[15] | 0) === 0) c.pcc[15] = 1;
      swapV(7, 410);
    }
    if ((c.index | 0) === 0) g.setV65(175, 7777);
    // 355075：按物品 id 追加 44..48 号 buff
    const id = it.id | 0;
    if (id === 1003) addb(44, 200, 200);
    if (id === 1002) addb(45, 200, 200);
    if (id === 1001) addb(46, 200, 200);
    if (id === 1000) addb(47, 200, 200);
    if (id === 999) addb(48, 150, 150);
    if ((c.index | 0) === 0) g.setV65(175, 0);
    return { end: 'turnWeight' };
  }

  /** 80 弹药箱（354816-354914） */
  function eff80(g, st) {
    const c = st.target;
    const box = st.it;
    if (!c) return { end: 'turnWeight' };
    if ((c.index | 0) >= 16) {
      g.log('那是办不到的。');
      return { end: 'turnWeight' };
    }
    let gain = 0;
    const inv = Array.isArray(c.inv) ? c.inv : [];
    for (const ammo of inv) {
      if (!ammo || (ammo.f[0] | 0) <= 0) continue;
      if (Elona.ItemDB.ref(ammo.id, 5) !== 25000) continue;
      for (let n = 0; n < 15; n++) {
        const e0 = ammo.f[40 + n * 2] | 0;
        if (e0 === 0) break;
        let v = e0;
        const hi = idiv(v, 10000);
        if (hi === 0) continue;
        v = v % 10000;                       // var_1591 = 子类型
        if (hi !== 9) continue;
        // var_399 = var_99(41) \ 1000, var_99(41) / 1000  （HSP 多重赋值）
        const e1 = ammo.f[40 + n * 2 + 1] | 0;
        const low = e1 % 1000;               // var_399(0)
        const cur = idiv(e1, 1000);          // var_399(1)
        // 354875：源码判断的是 `var_99(40+…)\10000 == 4`，而此时 hi 已确定为 9，
        //   因此该 continue 在原版里是**死分支**，这里照抄同一条件。
        if (hi === 4) continue;
        gain += (cur - low) * (50 + v * v * 10);
        // A412：原件写回的是 var_399(1)*1000 + var_399(1)，原样照抄
        ammo.f[40 + n * 2 + 1] = cur * 1000 + cur;
      }
    }
    if (gain === 0) {
      g.log('没有可以补充的弹矢。');
      return { end: 'turnWeight' };
    }
    g.log('弹矢补充完毕！');
    consume(g, box);
    return { end: 'turnWeight', ammo: gain };
  }

  /** 81 急救包（354678-354746） */
  function eff81(g, st) {
    const c = st.target;
    if (!c) return { end: 'turnWeight' };
    const p = g.player;
    const v = idiv(S(p, 151) + S(p, 12), 4) * idiv(S(p, 151) + S(p, 12), 10) + 10;
    g.log(`${nm(p)}用急救包做了应急处理。`);
    if (Elona.Status && Elona.Status.healhp) Elona.Status.healhp(c, v);
    for (const f of [250, 253, 252, 257, 258]) {
      if (G(c, f) !== 0) c.set(f, idiv(G(c, f), 8) + 1);
    }
    consume(g, st.it);
    return { end: 'turnWeight' };
  }

  /** 85 元素之眼（352467-352676）—— 不消耗物品 */
  function eff85(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    g.log('《你们所求的元素，喊出来吧》');
    return {
      ok: false, effect: 85, action: 'element-pick', request: 'element-pick',
      target: c, title: '要喊出哪个元素？', options: EYES.slice(),
    };
  }
  function eff85res(g, st, sel) {
    const c = st.target;
    const v = sel | 0;
    if (v < 0 || v > 11) return { end: 'turnWeight' };
    if (v === 0) {
      g.log('《原来如此……》');
      c.set(414, 0);
      return { end: 'turnWeight' };
    }
    c.set(414, v);
    c.set(174, v - 1);
    g.log(`《 ${EYES[v]} 》`);
    g.log(`${nm(c)}的属性改变了。`);
    return { end: 'turnWeight' };
  }

  /** 95 生物打印机（358145-358233） */
  function eff95(g, st) {
    const c = st.target;
    if (!c) {
      g.log('那是办不到的。');
      return { end: 'turnWeight' };
    }
    g.log('「正在复制对象……」');
    consume(g, st.it);
    g.log('「未连接到生物网络。已中止内部构成」');
    g.log('有什么东西滚到了脚边。');
    let variant = G(c, 435);
    const body = G(c, 7);
    if (body >= 694 && body <= 724) variant = 0;
    const x = G(g.player, 1), y = G(g.player, 2);
    const figurine = spawnAt(g, 503, x, y);
    if (figurine) {
      figurine.f[22] = (body % 1000) + variant * 1000;   // var_58(7) \ 1000
      figurine.f[23] = G(c, 27);
    }
    const corpse = spawnAt(g, 204, x, y);
    if (corpse) corpse.f[31] = 1;
    return { end: 'turnWeight' };
  }

  /** 104 固定锚（352363-352466）—— 不消耗物品 */
  function eff104(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    if ((c.index | 0) >= 16) {
      g.log('那是办不到的。');
      return { end: 'none' };
    }
    const slot = (Elona.Status && Elona.Status.findbuff) ? Elona.Status.findbuff(c, 59) : -1;
    if (slot !== -1) {
      if (Elona.Status && Elona.Status.delbuff) Elona.Status.delbuff(c, slot);
      c.set(268, G(c, 268) - 25);
      if (G(c, 268) < 1) {
        c.set(268, 0);
        g.log(`${nm(c)}从束缚中解放了。`);
      }
      recalc(g, c);
    } else {
      if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, c, 59, 25, 25);
      c.set(268, G(c, 268) + 25);
    }
    return { end: 'turnWeight' };
  }

  /** 117 G指（350819-350949）—— 把目标变成黄金像（不消耗物品） */
  function eff117(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    const snd27 = () => g.log('（什么也没有发生。）');
    g.setV65(250 + 372, 0);
    if (G(c, 50) > idiv(G(c, 51), 10)) { snd27(); return { end: 'turnWeight' }; }
    if ((c.index | 0) < 16 || G(c, 9) === 10 || G(c, 58) !== 0) { snd27(); return { end: 'turnWeight' }; }
    if (cbit(c, 985)) { snd27(); return { end: 'turnWeight' }; }
    if (mapId === 33) {
      const sp = G(c, 27);
      if (sp === 185 || sp === 204) { snd27(); return { end: 'turnWeight' }; }
    }
    if (cbit(c, 969)) { snd27(); return { end: 'turnWeight' }; }
    if (cbit(c, 23) || (cbit(c, 27) && cbit(c, 964))) { snd27(); return { end: 'turnWeight' }; }
    if (cbit(c, 964)) { snd27(); return { end: 'turnWeight' }; }
    if (cbit(c, 1015)) { snd27(); return { end: 'turnWeight' }; }
    if (mapId === 35) { snd27(); return { end: 'turnWeight' }; }

    g.setV65(250 + 372, 1000);
    if ((c.index | 0) >= 16) {
      g.log(`${nm(g.player)}把${nm(c)}变成了黄金，实质上……`);
    } else {
      g.log(`${nm(g.player)}夺走了${nm(c)}的自由，把它变成了黄金。`);
    }
    const doll = spawnAt(g, 1214, c.x | 0, c.y | 0);
    if (doll) {
      doll.f[2] = 1206;
      const v132_16 = (g.v132 && g.v132[String(mapId)] !== undefined) ? (g.v132[String(mapId)] | 0) : 0;
      if (v132_16 === 74) doll.f[31] = 1;
      doll.f[22] = (G(c, 7) % 1000) + G(c, 435) * 1000;
      doll.f[23] = G(c, 27);
    }
    // dmghp var_244, var_58(51), var_243, 658 —— 致死
    if (Elona.Battle && Elona.Battle.applyDamage) {
      try { Elona.Battle.applyDamage(c, G(c, 51), g, g.player, 658, 0); } catch (e) {
        c.hp = 0;
        if (Elona.Battle.onDeath) Elona.Battle.onDeath(g, c, g.player);
      }
    } else {
      c.hp = 0;
      if (Elona.Battle && Elona.Battle.onDeath) Elona.Battle.onDeath(g, c, g.player);
    }
    g.setV65(250 + 372, 0);
    return { end: 'turnWeight' };
  }

  /** 120 重婚许可（351009-351122）—— 不消耗物品；成功走 4358 */
  function eff120PreCheck(g) {
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    if (mapId === 35) {
      g.log('在这个地方没有效果。');
      return { end: 'turnWeight' };
    }
    return null;
  }
  function eff120(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    if (cbit(c, 961) === 0) {
      g.log('你出示了特殊重婚许可证。');
      if (G(c, 27) === 359) {
        for (let i = 0; i < 245; i++) {
          const o = g.charas && g.charas[i];
          if (!o || G(o, 0) !== 1) continue;
          if (G(o, 27) === 665) g.log(`${nm(o)}「唔奴奴……」`);
        }
      }
      if (G(c, 17) < 200) {
        g.log(`……${nm(c)}斩钉截铁地拒绝了。`);
        return { end: 'turn' };
      }
      cbitmod(c, 961, true);
      g.log('「真拿你没办法……」');
      g.setV65(250 + 31, (g.getV65(250 + 31) | 0) + 1);
      c.set(400, g.getV65(11) | 0);
      c.set(401, g.getV65(12) | 0);
      c.set(402, g.getV65(10) | 0);
      c.set(79, 17 + 100 * 3);
      if (g.events && g.events.add) g.events.add(13, c.index | 0);
      return { end: 'turn' };
    }
    g.log('什么也没有发生……');
    return { end: 'turnWeight' };
  }

  /** 122 蕾西玛斯碎片（351131-351237）—— 不消耗物品 */
  function eff122(g, st) {
    const c = st.target;
    const it = st.it;
    if (!c) return { end: 'none' };
    if ((c.index | 0) >= 16) {
      g.log('那是办不到的。');
      return { end: 'none' };
    }
    if (!c.potential) c.potential = {};
    const id = it.id | 0;
    const target = id === 1210 ? 1000 * 50000 : (id === 1211 ? 1000 * 100000 : (id === 1212 ? 1000 * 150000 : 0));
    let changed = 0;
    if (target) {
      for (let cnt = 10; cnt < 20; cnt++) {
        if (cnt >= 18) continue;
        if ((c.potential[cnt] | 0) < target) {
          c.potential[cnt] = target + 400;
          c.setSkill(cnt, idiv(target, 1000000));
          changed = 1;
        }
      }
    }
    g.log(changed ? `${nm(c)}的力量增强了。` : '什么也没有发生……');
    recalc(g, c);
    weight(g);
    return { end: 'turnWeight' };
  }

  /** 125 袜子（350621-350774）—— 不消耗物品 */
  const SOCK_LINES = [
    [2, 4, '「总觉得能努力下去了」'],
    [5, 7, '「我也喜欢这种东西」'],
    [8, 10, '「不错！有品位」'],
    [11, 13, '「这种刺激让人感到活着的实感」'],
    [14, 16, '「哦，你还真懂行」'],
    [17, 19, '「好像渗进脑子里了！」'],
    [20, 22, '「就是这个就是这个！」'],
    [23, 25, '「感觉想一直闻下去！」'],
    [26, 28, '「噗哈——！真有效！」'],
    [29, 99, '「哦哦，你很懂嘛～」'],
  ];
  function eff125(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    const q = st.it.f[22] | 0;
    g.log(`你把袜子按在了${nm(c)}的脸上。`);
    if (G(c, 256) < 3) c.set(256, 3);
    if (G(c, 27) !== 684) {
      g.log('「好臭」');
    } else {
      let line = '「哦哦，你很懂嘛～」';
      if (q <= 1) line = SOCK_LINES[SOCK_LINES.length - 1][2];
      else for (const s of SOCK_LINES) if (q >= s[0] && q <= s[1]) { line = s[2]; break; }
      g.log(line);
      if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, c, 17, 20, 3);
    }
    return { end: 'turnWeight' };
  }

  /** 127 安宁剂（351482-351544） */
  function eff127(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    const amt = idiv(G(g.player, 193) + 13, 13) * 10;
    if (Elona.Status && Elona.Status.healmp) Elona.Status.healmp(c, amt);
    consume(g, st.it);
    recalc(g, c);
    weight(g);
    return { end: 'turnWeight' };
  }

  /** 128 药烟管（352677-352795） */
  function eff128(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    if ((c.index | 0) !== 0 && G(c, 443) < 100 && G(c, 169) < 200) {
      g.log('「不行。绝对不行」');
      return { end: 'turnWeight' };
    }
    g.log(`${nm(c)}叼住了${Elona.ItemDB.name(st.it.id, 'jp')}。`);
    // 移除 57 号 buff
    for (let cnt = 0; cnt < 16; cnt++) {
      const id = G(c, 280 + cnt * 3);
      if (id === 0) break;
      if (id === 57 && Elona.Status && Elona.Status.delbuff) Elona.Status.delbuff(c, cnt);
    }
    g.log(G(c, 443) <= 0 ? ' *咳、咳* ' : ' *呼——* ');
    c.set(182, G(c, 182) + 100);
    if (G(c, 182) > 100) {
      if (G(c, 409) <= 0 && (G(c, 214) <= 0 || (c.index | 0) === 0)
          && (G(c, 25) < 4 || (c.index | 0) <= 16)) {
        c.set(182, 100);
      }
    }
    if (G(c, 182) > 200) c.set(182, 200);
    c.set(443, G(c, 443) + 30);
    const dep = limit(idiv(G(c, 443), 3), 1, 100);
    g.log(`${nm(c)}对麻药有 ${dep}% 的依赖。`);
    // modkarma 0, -10
    const p = g.player;
    p.set(49, (p.get(49) | 0) - 10);
    if (G(c, 443) > 300) c.set(443, 300);
    if (G(c, 443) < 0) c.set(443, 0);
    consume(g, st.it);
    weight(g);
    return { end: 'turnWeight' };
  }

  /** 130 灵质（351376-351481）—— 不消耗物品 */
  function eff130(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    if ((c.index | 0) >= 16) {
      g.log(`${nm(c)}抵抗了。`);
      return { end: 'none' };
    }
    const p = st.it.f[25] | 0;
    const line = `${nm(c)}意识到了自己「${personalityOf(p)}」的一面！`;
    if (G(c, 151) === 0) {
      c.set(151, p);
      g.log(line);
      return { end: 'turnWeight' };
    }
    if (G(c, 154) === 0) {
      if (G(c, 151) === p) {
        g.log(`${nm(c)}已经是那种性格了。`);
        return { end: 'none' };
      }
      c.set(154, p);
      g.log(line);
      return { end: 'turnWeight' };
    }
    if (G(c, 151) === p) {
      g.log(`${nm(c)}已经是那种性格了。`);
      return { end: 'none' };
    }
    c.set(154, G(c, 151));
    c.set(151, p);
    g.log(line);
    return { end: 'turnWeight' };
  }

  /** 注射系的抵抗判定（132 / 139 / 140 / 141 共用，351309-351318） */
  function resistInject(g, c, base) {
    if ((c.index | 0) === 0) return false;
    let v = base;
    if (G(c, 251) > 0 || G(c, 256) >= 60 || G(c, 50) < idiv(G(c, 51), 8)) v = idiv(v, 2);
    const p = S(g.player, 12);
    return v >= G(c, 17) + G(c, 169) + R(g, Math.max(1, p));
  }

  /** 132 生存力扩张液（351260-351375） */
  function eff132(g, st) {
    const c = st.target;
    const it = st.it;
    if (!c) return { end: 'none' };
    if (G(c, 42) <= -2000000) {
      g.log('对第二阶段使用也没有意义。');
      return { end: 'none' };
    }
    if (resistInject(g, c, S(c, 10) + 100)) {
      g.log(`${nm(c)}以惊人的力量抵抗了。「我讨厌打针！」`);
      return { end: 'none' };
    }
    g.log(`${nm(c)}「好痛！」`);
    const id = it.id | 0;
    if (id === 1254) c.set(213, limit(G(c, 213) + 1, 1, 9));
    if (id === 1253) c.set(187, limit(G(c, 187) + 1, 1, 9));
    if (G(c, 42) > -1000000) c.set(42, -1000000);
    if (cbit(c, 978)) {
      cbitmod(c, 978, false);
      g.log(`${nm(c)}体内的异物被转化成了养分。`);
    }
    if ((c.index | 0) !== 0) c.set(430, G(c, 27));
    consume(g, it);
    weight(g);
    g.log(`${nm(c)}体内生成了新的生命核心。需要给予${nm(c)}以外的遗传因子。在第二阶段期间也可以追加注射。`);
    return { end: 'turnWeight' };
  }

  /** 139 抗性上限（357850-357950） */
  function eff139(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    const Res = Elona.Resist;
    const sg = (id) => (Res && Res.sorg ? (Res.sorg(c, id) | 0) : 0);
    // 357900：sorg(50)>=300 | (sorg(50)<100 & 其余全部 (>=300|<100))
    const cap0 = sg(50) >= 300;
    let allOut = sg(50) < 100;
    if (allOut) {
      for (let id = 51; id <= 60; id++) {
        const v = sg(id);
        if (!(v >= 300 || v < 100)) { allOut = false; break; }
      }
    }
    if (cap0 || allOut) {
      g.log('再用下去也不会有更多效果了。');
      return { end: 'none' };
    }
    if (resistInject(g, c, S(c, 10) + 50)) {
      g.log(`${nm(c)}以惊人的力量抵抗了。「我讨厌打针！」`);
      return { end: 'none' };
    }
    g.log(`${nm(c)}「好痛！」`);
    for (let id = 50; id <= 60; id++) {
      if (Res && Res.resistMod) Res.resistMod(c, id, 50);
    }
    consume(g, st.it);
    weight(g);
    return { end: 'turnWeight' };
  }

  /** 140 DV 修正 / 141 PV 修正（357951-358144） */
  function eff140(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    if (G(c, 77) >= 200) {
      g.log('对 DV 修正 200 以上使用也没有效果。');
      return { end: 'none' };
    }
    if (resistInject(g, c, S(c, 10) + 50)) {
      g.log(`${nm(c)}以惊人的力量抵抗了。「我讨厌打针！」`);
      return { end: 'none' };
    }
    g.log(`${nm(c)}「好痛！」`);
    c.set(77, G(c, 77) + 10);
    g.log(`${nm(c)}的 DV 修正上升到了 ${G(c, 77)}。`);
    consume(g, st.it);
    weight(g);
    return { end: 'turnWeight' };
  }
  function eff141(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    if (G(c, 76) >= 200) {
      g.log('对 PV 修正 200 以上使用也没有效果。');
      return { end: 'none' };
    }
    if (resistInject(g, c, S(c, 10) + 50)) {
      g.log(`${nm(c)}以惊人的力量抵抗了。「我讨厌打针！」`);
      return { end: 'none' };
    }
    g.log(`${nm(c)}「好痛！」`);
    c.set(76, G(c, 76) + 10);
    g.log(`${nm(c)}的 PV 修正上升到了 ${G(c, 76)}。`);
    consume(g, st.it);
    weight(g);
    return { end: 'turnWeight' };
  }

  /** 142 魔力结晶石（351709-351775） */
  function eff142(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    g.log(`${nm(c)}的魔力循环变好了。`);
    if (Elona.Status && Elona.Status.healmp) Elona.Status.healmp(c, idiv(G(c, 56), 10) + 1);
    if (Elona.Stats && Elona.Stats.skillExp) {
      try { Elona.Stats.skillExp(c, 16, g.player, (st.it.f[26] | 0) * 3 + 50, 0, 0, g); } catch (e) { /* noop */ }
    }
    consume(g, st.it);
    recalc(g, c);
    weight(g);
    return { end: 'turnWeight' };
  }

  /** 143 战斗结晶石（351776-351842） */
  function eff143(g, st) {
    const c = st.target;
    if (!c) return { end: 'none' };
    g.log(`${nm(c)}觉得好像能努力下去了。`);
    if (Elona.Status && Elona.Status.healsp) Elona.Status.healsp(c, idiv(G(c, 53), 10) + 1);
    if (Elona.Stats && Elona.Stats.skillExp) {
      try { Elona.Stats.skillExp(c, 11, g.player, (st.it.f[26] | 0) * 3 + 50, 0, 0, g); } catch (e) { /* noop */ }
    }
    consume(g, st.it);
    recalc(g, c);
    weight(g);
    return { end: 'turnWeight' };
  }

  /** 145 清醒结晶石（351578-351708） */
  function eff145(g, st) {
    const c = st.target;
    const it = st.it;
    if (!c) return { end: 'none' };
    if (G(c, 173) > 2000) {
      g.log(`${nm(c)}已经无法再储存更多 AP 了。`);
      return { end: 'turnWeight' };
    }
    let got = false;
    if (G(c, 173) < 2000) {
      const v2562 = G(c, 199);
      const f26 = it.f[26] | 0, f27 = it.f[27] | 0, f31 = it.f[31] | 0;
      if (f26 + f27 >= 1000) {
        if (f26 + f31 > G(c, 198) + G(c, 160) + v2562 + idiv(G(c, 159) + 1, 5)) {
          const bump = (ap, base) => {
            c.set(173, G(c, 173) + ap);
            c.set(159, G(c, 159) + base);
            if ((c.index | 0) !== 0) {
              c.set(173, G(c, 173) + ap);
              c.set(159, G(c, 159) + base);
            }
          };
          if (f31 > v2562 * 5) bump(5, 5);
          if (f31 > v2562 * 4) bump(10, 10);
          if (f31 > v2562 * 3) bump(10, 10);
          if (f31 > v2562 * 2) bump(10, 10);
          if (f31 > v2562) { got = true; bump(5, 5); }
          if (G(c, 173) > 2000) {
            c.set(159, G(c, 159) - (G(c, 173) - 2000));
            c.set(173, 2000);
          }
          if (G(c, 159) < 0) c.set(159, 2000);
        }
      }
    }
    if (!got) {
      g.log(`${nm(c)}似乎得不到什么经验……`);
      return { end: 'turnWeight' };
    }
    consume(g, it);
    weight(g);
    return { end: 'turnWeight' };
  }

  /** 146 浮空笼（354299-354419）—— タッグ直接拒绝 */
  function eff146PreCheck(g, it) {
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    const sub = g.getV65 ? (g.getV65(22) | 0) : 0;
    const v132_32 = (g.v132 && g.v132[String(mapId)] !== undefined) ? (g.v132[String(mapId)] | 0) : 0;
    if (mapId === 6 || mapId === 40 || mapId === 76 || mapId === 42
        || v132_32 !== 0 || (mapId === 30 && sub === 1)) {
      g.log('这个区域里无法使用。');
      return { end: 'none' };
    }
    return null;
  }
  function eff146(g, st) {
    const c = st.target;
    const it = st.it;
    if (!c) return { end: 'turnWeight' };
    if (cbit(c, 985)) {
      g.log('沙袋碍事了。');
      return { end: 'none' };
    }
    if (G(c, 50) >= idiv(G(c, 51), 4) && G(c, 181) >= 0) {
      g.log('不把它再削弱一点就关不进去。');
      return { end: 'none' };
    }
    if ((c.index | 0) !== 0 && (c.index | 0) < 16) {
      g.log('把同伴关起来什么的，太可怕了！');
      return { end: 'none' };
    }
    if (cbit(c, 1040)) {
      g.log('它已经被关起来了。');
      return { end: 'none' };
    }
    const sp = G(c, 27);
    if (G(c, 9) === 10 || cbit(c, 992) === 1 || G(c, 25) >= 4 || G(c, 150) !== 0
        || cbit(c, 976) === 1 || G(c, 197) === 10 || cbit(c, 963) === 1
        || (g.getV65(250 + 306) | 0) === (c.index | 0)) {
      g.log('对那个生物无效。');
      return { end: 'none' };
    }
    if ((c.index | 0) === 0) {
      g.log('你想钻进笼子里，却又放弃了……');
      return { end: 'turnWeight' };
    }
    consume(g, it);
    weight(g);
    cbitmod(c, 1040, true);
    g.log(`你把${nm(c)}关了进去。`);
    g.log(`${nm(c)}发出了呻吟。「放我出去——！」`);
    // 354395-354396：modimp var_244, -50 / modimp2 var_244, -50
    const Rel = Elona.Relation;
    if (Rel && Rel.modimp) { try { Rel.modimp(c, -50, g); } catch (e) { /* noop */ } }
    if (Rel && Rel.modimp2) { try { Rel.modimp2(c, -50, g); } catch (e) { /* noop */ } }
    if (Elona.Party && Elona.Party.joinChara) {
      const jr = Elona.Party.joinChara(g, c);
      if (jr && jr.message) g.log(jr.message);
    }
    return { end: 'turnWeight' };
  }

  /** 150 拟态镜（352023-352134）—— 先选镜子物品，再选目标；不消耗物品 */
  function eff150Pre(g, st) {
    return {
      ok: false, effect: 150, action: 'mirror-pick', request: 'mirror-pick',
      title: '要使用哪面镜子？', hint: '↑↓ 选择　Esc 取消',
    };
  }
  function eff150OnPre(g, st, mirror) {
    if (!mirror) { st.cancelled = true; return; }
    st.mirror = mirror;
  }
  function eff150(g, st) {
    const c = st.target;
    const m = st.mirror;
    if (!c) return { end: 'none' };
    const sub = m ? (m.f[22] | 0) : 0;
    const v2563 = sub + 12 * 1000;
    const v2564 = sub >= 1000 ? 1 : 0;
    if ((c.index | 0) !== 0 && G(c, 9) !== 10) {
      if (G(c, 50) > idiv(G(c, 51), 4)) {
        g.log(`${nm(c)}避开了镜子放出的光。需要让它更虚弱。`);
        return { end: 'turn' };
      }
    }
    if (G(c, 429) === 0) {
      g.log('拟态镜变换！');
      c.set(429, G(c, 7));
      c.set(437, G(c, 435));
      c.set(7, v2563);
      c.set(435, v2564);
    } else {
      g.log(`${nm(c)}恢复了原来的样子。`);
      c.set(7, G(c, 429));
      c.set(435, G(c, 437));
      c.set(429, 0);
      c.set(437, 0);
    }
    return { end: 'turnWeight' };
  }

  // ======================================================================
  // 规格表
  //   tag     : 'pick' 二选一 / 'reject' 直接拒绝 / null 无判定
  //   empty   : 没选到目标时的收尾（'none' 打印「それは無理だ。」+4363
  //             / 'turnWeight' 打印 + 3017 / 'silent' 静默 3017）
  //   success : 成功时的默认收尾
  //   world   : 世界地图上静默 3017
  //   preCheck: 目标选择**之前**的门槛检查
  //   pre     : 目标选择之前还要一次 UI（150 选镜子）
  //   preTarget: 目标取得后、タッグ判定**之前**的替换（72 坐骑）
  // ======================================================================
  // ======================================================================
  // 0-FV：补未注册效果的批次一（源码行号逐条标注）
  //   这些效果在源码里是独立的 `var_1302 == N` 分支，不经「谁使用？」选目标，
  //   所以注册时带 noTarget（advance 会直接以玩家为目标）。
  // ======================================================================

  /** 13 火把（353931-353954）：var_65(37) 0↔1 —— 点火 / 熄火 */
  function eff13(g, st) {
    const on = (g.getV65 ? (g.getV65(37) | 0) : 0) !== 0;
    g.setV65(37, on ? 0 : 1);
    g.log(on ? '你熄灭了火把。' : '你点燃了火把。');
    // 353949 `gosub *label_2174` 是重算光照；本项目暂无视野遮罩（A474），
    // 状态存 var_65(37) 供后续渲染/事件读取。
    return { end: 'turnWeight' };
  }

  /** 39 哨子（364733-364745）：`make_sound(x, y, 10, 1, 1, 自己)` */
  function eff39(g, st) {
    const p = g.player;
    g.log(' *哔————* ');
    if (Elona.Status && Elona.Status.makeSound) {
      const msgs = Elona.Status.makeSound(g, p.x | 0, p.y | 0, 10, 1, 1, p.index | 0);
      for (const m of (msgs || [])) g.log(m);
    }
    return { end: 'turnWeight' };
  }

  /**
   * 11 小猫存钱罐（358476-358503）。
   * `var_1560` = 7 档面额，`f[26]` 是面额索引；`f[25]` 已存金额（上限 10 亿）；
   * 每存一次罐子价值 f[7] += 100。
   */
  const BANK_AMOUNTS = [500, 2000, 10000, 50000, 500000, 5000000, 100000000];
  function eff11(g, st) {
    const it = st.it, p = g.player;
    if (!it || !it.f) return { end: 'none' };
    const idx = limit(it.f[26] | 0, 0, BANK_AMOUNTS.length - 1);
    const amount = BANK_AMOUNTS[idx];
    if (amount > G(p, 30)) { g.log('金币不够……'); return { end: 'none' }; }
    if ((it.f[25] | 0) >= 1000000000) { g.log('存钱罐已经满了。'); return { end: 'none' }; }
    p.set(30, G(p, 30) - amount);
    it.f[25] = (it.f[25] | 0) + amount;
    it.f[7] = (it.f[7] | 0) + 100;
    g.log(`你把 ${amount} 金币放进了存钱罐。`);
    return { end: 'turnWeight' };
  }

  /** 14 雪（353904-353930）：自己用消耗 5 个雪 → 脚下生成雪人（541） */
  function eff14(g, st) {
    const it = st.it, p = g.player;
    const t = st.target || p;
    const self = !t || (t.index | 0) === 0;
    if (self) {
      // 注意：G() 只接受角色（内部走 c.get），物品数量必须直接读 f[0]
      if ((it.f[0] | 0) < 5) { g.log('雪不够……'); return { end: 'none' }; }
      it.f[0] = (it.f[0] | 0) - 5;
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
    }
    spawnAt(g, 541, p.x | 0, p.y | 0);
    if (!self) g.log(`${nm(t)}做了一个雪人！`);
    return { end: 'turnWeight' };
  }

  /**
   * 24 地雷（349966-349998）。
   * 世界地图（var_126(6)==1）不能用；格子已有特性拒绝；
   * 数量 -1 后写 `cell_featset x,y, 0, 14, 22, owner`（type 14 陷阱 / sub 22 炸弹）。
   */
  function eff24(g, st) {
    const it = st.it, p = g.player;
    if (onWorld(g)) { g.log('这里不能使用。'); return { end: 'none' }; }
    const f = (Elona.MapFeat && Elona.MapFeat.read) ? Elona.MapFeat.read(g, p.x, p.y) : null;
    if (f && (f.raw | 0) !== 0) { g.log('这里放不下。'); return { end: 'none' }; }
    consume(g, it);
    if (Elona.MapFeat && Elona.MapFeat.write) {
      Elona.MapFeat.write(g, p.x, p.y, 0, 14, 22, p.index | 0);
    }
    g.log('你设置了地雷。');
    return { end: 'turnWeight' };
  }

  /**
   * 29 秘宝（360639-360660）：`var_97(f[25]) = 1` 获得专长。
   * 162 / 169 互斥（源码显式把另一个清零）。
   */
  function eff29(g, st) {
    const it = st.it, p = g.player;
    const featId = it.f[25] | 0;
    if (Elona.Feat && Elona.Feat.set) {
      Elona.Feat.set(p, featId, 1);
      if (featId === 169) Elona.Feat.set(p, 162, 0);
      if (featId === 162) Elona.Feat.set(p, 169, 0);
    }
    consume(g, it);
    g.log('你获得了新的专长！');
    return { end: 'turnWeight' };
  }

  /** 31 库米罗妮宝玉（364492-364534）—— 本体在 core/farm.js 的 reviveOrGrow */
  function eff31(g, st) {
    if (Elona.Farm && Elona.Farm.reviveOrGrow) {
      Elona.Farm.reviveOrGrow(g, undefined, undefined, st.it);
    } else {
      g.log('脚下没有作物。');
    }
    // 源码三条出口都 `goto *label_3017`（消耗回合、不消耗物品）
    return { end: 'turnWeight' };
  }

  /**
   * 33 怪物球（364249-364291）：放出球里存的怪物成为同伴。
   *   · 地图 35 / 76-179 → 「这里不能使用」
   *   · `f[23] == 0`（空球）→ 「怪物球是空的」
   *   · 队伍无空位 → 「同伴不能再增加了」
   *   · 成功：消耗 1 个，`characreate 56, f[23], -3, 0` + gosub *label_4274
   */
  function eff33(g, st) {
    const it = st.it, p = g.player;
    // 340880-341000：**对相邻怪物使用**怪物球 = 捕获（不走效果 33）。
    //   0-CF 的捕获分支在 game.js 里排在 ItemFx 分派之后，现在被这个效果接管，
    //   所以在这里先试捕获；`no-target` 才落到「放出球里的怪物」。
    if (Elona.Party && Elona.Party.capture) {
      const cap = Elona.Party.capture(g, it);
      if (cap && cap.reason !== 'no-target') {
        if (cap.message) g.log(cap.message);
        if ((it.f[0] | 0) > 0) it.f[0] = (it.f[0] | 0) - 1;   // 成功与失败都消耗一颗
        if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
        return { end: 'turnWeight' };
      }
    }
    const mt = (g.map && g.map.header && (g.map.header[6] | 0)) | 0;
    const sub = g.getV65 ? (g.getV65(22) | 0) : 0;
    if (mt === 35 || (mt === 76 && sub === 179)) { g.log('这里不能使用。'); return { end: 'turnWeight' }; }
    const species = it.f[23] | 0;
    if (species === 0) { g.log('怪物球是空的。'); return { end: 'turnWeight' }; }
    if (!Elona.Party || !Elona.Party.freeSlot || !Elona.Party.freeSlot(g)) {
      g.log('同伴不能再增加了。');
      return { end: 'turnWeight' };
    }
    consume(g, it);
    let c = null;
    if (Elona.Monster && Elona.Monster.create) {
      try { c = Elona.Monster.create(g, species, p.level | 0, p.x | 0, p.y | 0, {}); } catch (e) { c = null; }
    }
    if (!c) { g.log('……什么也没有出现。'); return { end: 'turnWeight' }; }
    const r = Elona.Party.joinChara(g, c);
    if (r && r.message) g.log(r.message);
    return { end: 'turnWeight' };
  }

  // ======================================================================
  // 0-FW：通用「启动内建效果」+ 易容 / 狂气治愈 / 原子弹
  //   这一组在源码里都是「把物品字段里的效果号塞进 var_396 再 gosub *label_2960」，
  //   而本项目 label_2960 的等价物是 core/spell.js 的 dispatchEffect ——
  //   所以不必逐个重写演出，直接把效果号交过去即可。
  // ======================================================================

  /**
   * `var_396 = var_99(25, var_579)` / `var_578 = var_99(26, var_579)` → `gosub *label_2960`
   * @returns {object|null} dispatchEffect 的结果（null = 没有可放的效果）
   */
  function launchStored(g, it, target, powerOverride) {
    const id = it.f[25] | 0;
    if (!id) return null;
    const power = (powerOverride === undefined) ? (it.f[26] | 0) : (powerOverride | 0);
    if (!Elona.Spell || !Elona.Spell.dispatchEffect) return null;
    try {
      return Elona.Spell.dispatchEffect(g, target || g.player, id, target || g.player, power);
    } catch (e) {
      return null;
    }
  }

  /** 直接放一个写死在源码里的效果号（20 的 458 / 25 的 637） */
  function castEffect(g, id, power, target) {
    if (!Elona.Spell || !Elona.Spell.dispatchEffect) return null;
    try {
      return Elona.Spell.dispatchEffect(g, target || g.player, id | 0, target || g.player, power | 0);
    } catch (e) {
      return null;
    }
  }

  /** 30 神速 / 圣雨 / 再构造 / 心（364084-364098）—— 源码不扣数量（可重复启动） */
  function eff30(g, st) {
    const p = g.player;
    const iname = Elona.ItemDB ? Elona.ItemDB.name(st.it, 'jp') : '道具';
    g.log(`你启动了${iname}。`);
    const r = launchStored(g, st.it, p);
    if (!r || r.implemented === false) g.log('什么也没有发生。');
    return { end: 'turnWeight' };
  }

  /**
   * 20 易容道具（358664-358671）：`var_396 = 458` / `var_578 = 400`。
   * 458 = インコグニート（abilities 表 f[1] = 1015 → buff 15），
   * label_2960 的 458 分支在 buff 之前还调 `incognitobegin`（194576-194608）：
   * 把「敌对（var_58(9) <= -2）」的关系值重置回原值，追兵一时认不出你。
   */
  function eff20(g, st) {
    const p = g.player;
    g.log('你换上了易容道具。');
    const r = castEffect(g, 458, 400, p);
    let n = 0;
    for (const c of (g.charas || [])) {
      if (!c || c === p || (c.get(0) | 0) !== 1) continue;
      if ((c.get(9) | 0) > -2) continue;          // 不是敌对
      if ((c.get(69) | 0) < -2) continue;         // 本来就恨你，变装没用
      c.set(201, 0);                              // 清亲密度
      c.set(9, c.get(69) | 0);                    // 关系回到原值
      c.set(79, 221);
      n++;
    }
    if (n > 0) g.log('周围的敌人一时没有认出你。');
    if (!r || r.implemented === false) g.log('总觉得有点不自在。');
    return { end: 'turnWeight' };
  }

  /** 25 独角兽的角（358793-358807）：`var_396 = 637`（狂気治癒の雨）/ `var_578 = 500`，消耗 1 */
  function eff25(g, st) {
    const p = g.player;
    g.log('你高高举起了独角兽的角。');
    const r = castEffect(g, 637, 500, p);
    consume(g, st.it);
    if (!r || r.implemented === false) {
      // 637 的收尾是 healsan(var_578/10) —— 演算不可用时直接降狂气
      if (Elona.Status && Elona.Status.healsan) Elona.Status.healsan(p, 50);
      g.log('你的心绪平静了下来。');
    }
    return { end: 'turnWeight' };
  }

  /** 28 原子弹（360579-360619）：普通地图才能设置，消耗 1，`addmef x,y,7,632,10,100,owner` */
  function eff28(g, st) {
    const p = g.player, it = st.it;
    if (onWorld(g)) { g.log('这里不能使用。'); return { end: 'none' }; }
    consume(g, it);
    g.log('你设置了原子弹。快逃啊——！');
    if (g.mef && g.mef.add) {
      try { g.mef.add(g, p.x | 0, p.y | 0, 7, 632, 10, 100, p.index | 0); } catch (_) { /* 槽满忽略 */ }
    }
    return { end: 'turnWeight' };
  }

  // ======================================================================
  // 0-FY：补齐 0-FW.6 里「依赖 rowact 子系统 / 既有模块」的四个效果
  //   7 避难所、9 训练机、21 素材工具、32 能力複合機。
  // ======================================================================

  /**
   * 开始一个 var_65(91) = mode 的 rowact 10（*label_2932，311077-311185）。
   *   101 建设 25 回合（311111-311117）；104 训练 50 回合（311166-311249）。
   *   payload.campMode 让 Actions.tickRowAct 跳过偷窃分派、走通用倒计时，
   *   完成后由 Game.completeRowAct(10) 结算。
   */
  function beginCampRowAct(g, mode, turns, extra) {
    const A = Elona.Actions;
    if (!A) return { ok: false, message: '动作层未加载。' };
    const pl = Object.assign({ campMode: mode | 0 }, extra || {});
    const r = A.begin(g, 10, turns | 0, pl);
    if (r.ok && g.setV65) g.setV65(91, mode | 0);
    return r;
  }

  /** 21 素材工具（358773-358789）：挥动 → 消耗 1 → var_396=21 / var_578=500 → label_2960 */
  function eff21(g, st) {
    const it = st.it, p = g.player;
    if ((g.getV65 ? (g.getV65(20) | 0) : 0) === 35) return { end: 'silent' };
    const iname = Elona.ItemDB ? Elona.ItemDB.name(it.id, 'jp') : '道具';
    g.log(`你挥动了${iname}。`);
    consume(g, it);
    castEffect(g, 21, 500, p);
    return { end: 'turnWeight' };
  }

  /**
   * 32 能力複合機（364535-364670）。
   * 项目早就把「选素体 → 选供体 → y/n 确认 → 合成」实现在
   * Panels.openGeneMachine 里，只是没有 itemfx 入口（死代码）。这里补上接线。
   */
  function eff32(g, st) {
    const P = Elona.Panels;
    if (!P || !P.openGeneMachine || !Elona.GeneMachine) {
      g.log('这里不能使用能力复合机。');
      return { end: 'turn' };
    }
    P.openGeneMachine(g, st.it);
    return { end: 'none' };   // 面板内部在合成成功时自行 endTurn
  }

  /** 9 训练机 / 学习书（353955-353966 → *label_2849 300965-300983） */
  function eff9(g, st) {
    const r = beginCampRowAct(g, 104, 50, {
      itemId: st.it.id | 0, skill: st.it.f[25] | 0,
    });
    if (!r.ok) { g.log(r.message || '现在不能训练。'); return { end: 'none' }; }
    g.log('你开始训练。（50 回合，移动会中断）');
    g.endTurn();
    return { end: 'none' };
  }

  /**
   * 7 避难所（358426-358770）。
   *   var_99(21) != 3（未建成）→ 只能在世界地图，var_65(91)=101 建设 25 回合；
   *   var_99(21) == 3（已建成）→ 放弃当前委托 / 从野外撤离到安全地带。
   */
  function eff7(g, st) {
    const it = st.it;
    const built = (it.f[21] | 0) === 3;
    if (!built) {
      if (!onWorld(g)) {
        g.log('这里不能建造，应该到世界地图上去建。');
        return { end: 'none' };
      }
      const r = beginCampRowAct(g, 101, 25, { itemId: it.id | 0, kind: 'shelter' });
      if (!r.ok) { g.log(r.message || '现在不能建造。'); return { end: 'none' }; }
      g.log('你开始建造避难所。（25 回合）');
      g.endTurn();
      return { end: 'none' };
    }
    g.log('你躲进了避难所。');
    if (g.questMap && g.leaveQuestMap) g.leaveQuestMap();
    else if (g.returnToTown) g.returnToTown();
    return { end: 'turn' };
  }

  // ======================================================================
  // 0-FZ：label_3016 剩余效果批次（349962-364788）
  //
  // 这一批都是「不经 *label_2893 选目标、对自己/脚下直接生效」的分支，
  // 因此统一注册为 noTarget。逐个注明源码行号；源码本身就是空分支的
  // （只有 var_1303++）按「什么也没有发生」实现，不额外发明效果。
  // ======================================================================

  /** var_126(n) —— 项目里是 g.v126（见 core/randomevent.js 的 mapVar） */
  function v126(g, n) { return (g && g.v126 && (g.v126[n] | 0)) || 0; }
  function setV126(g, n, v) { if (!g) return; if (!g.v126) g.v126 = {}; g.v126[n] = v | 0; }

  /** 86 / 87 / 88 / 89 / 123 / 124 / 131：源码只有 var_1303++ 的空分支 */
  function effNoop(g, st) {
    g.log('什么也没有发生……');
    return { end: 'turnWeight' };
  }

  /** 6 光盘（358370-358385）：var_131 = f[25]+51，上限 138-1 → var_126(13) */
  function eff6(g, st) {
    const it = st.it;
    const track = Math.min(137, (it.f[25] | 0) + 51);
    setV126(g, 13, track);
    const nm2 = Elona.ItemDB ? Elona.ItemDB.name(it.id, 'jp') : '光盘';
    g.log(`你播放了${nm2}。（曲目 ${track}）`);
    return { end: 'turnWeight', track };
  }

  /** 10 光盘停止（358386-358393）：goto *label_4342 关闭播放并刷新画面 */
  function eff10(g, st) {
    setV126(g, 13, 0);
    g.log('你停止了播放。');
    return { end: 'turnWeight' };
  }

  /** 68 选曲（358359-358369 → *label_2716 的「再生リスト」：曲目 50..138） */
  function eff68(g, st) {
    let t = v126(g, 13) + 1;
    if (t < 50 || t > 138) t = 50;
    setV126(g, 13, t);
    g.log(`你选好了要播放的曲目。（${t}）`);
    return { end: 'turnWeight', track: t };
  }

  /** 35 / 36 铁处女 / 断头台（364671-364732）：dmghp 0,9999,-18 / -19 */
  function effTorture(g, st, guillotine) {
    const p = g.player;
    g.log(guillotine ? '你把头伸进了断头台。' : '你走进了铁处女。');
    g.log('「好兴奋♪」');
    g.log(guillotine ? '突然有人放下了断头台的刀刃。' : '突然有人关上了盖子。');
    g.log('「嘿嘿」');
    if (Elona.Battle && Elona.Battle.applyDamage) {
      Elona.Battle.applyDamage(p, 9999, g, null, 0, 0);
    } else {
      p.hp = 0;
    }
    return { end: 'turnWeight', torture: guillotine ? 36 : 35 };
  }

  /** 42（364129-364140）：不祥的预感 */
  function eff42(g, st) { g.log('总觉得有种不祥的预感……'); return { end: 'turnWeight' }; }

  /** 65 施肥（364292-364335）：接 Farm.fertilize，成功才消耗 */
  function eff65(g, st) {
    const F = Elona.Farm, p = g.player;
    if (!F || !F.fertilize) { g.log('这里没有可以施肥的作物。'); return { end: 'turnWeight' }; }
    const r = F.fertilize(g, p.x, p.y);
    if (r && r.ok) consume(g, st.it);
    return { end: 'turnWeight', fertilized: !!(r && r.ok) };
  }

  /** 70 犬笛（359921-359960）：犬族听得到，周围犬类 NPC 被动作为 121 */
  function isDogChara(c) {
    if (!c) return false;
    const id = c.get(27) | 0;
    if (id === 363 || id === 538) return true;
    const r = String(c.race || c.raceId || c.raceName || c.get(2) || '').toLowerCase();
    return r === 'dog' || r === 'doggod' || r.indexOf('犬') >= 0;
  }
  function eff70(g, st) {
    const p = g.player;
    const heard = isDogChara(p);
    g.log(heard ? ' *哔————* ' : '什么也听不见。');
    for (const c of (g.charas || [])) {
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) > 5) continue;
      if (isDogChara(c) && R(g, 10) >= 1) c.set(79, 121);   // var_58(79) = 21 + 100
    }
    return { end: 'turnWeight', heard };
  }

  /** 76（358672-358689）：世界地图禁用；否则 var_65(194)=104 + 效果 463/650 */
  function eff76(g, st) {
    if (onWorld(g)) { g.log('这里不能使用。'); return { end: 'none' }; }
    if (g.setV65) g.setV65(194, 104);
    castEffect(g, 463, 650, g.player);
    return { end: 'turnWeight' };
  }

  /** 92（352984-352993）：音效 + var_1117=29 的演出，网页版折算成提示 */
  function eff92(g, st) { g.log(' *轰隆隆——* '); return { end: 'turnWeight' }; }

  /** 103（360189-360213）：补充深渊魔力与充填用魔力 */
  function eff103(g, st) {
    const it = st.it, n = limit((it.f[26] | 0) + 1, 1, 30);
    const abyss = 20 * n, charge = 10 * n;
    consume(g, it);
    if (g.setV65) {
      g.setV65(679, Math.min(100000, (g.getV65(679) | 0) + abyss));   // var_65(250+429)
      g.setV65(25, (g.getV65(25) | 0) + charge);                     // var_65(25)
    }
    g.log(`获得 ${abyss} 点深渊魔力、${charge} 点充填用魔力。`);
    return { end: 'turnWeight', abyss, charge };
  }

  /** 105 生火（353828-353843）：消耗 1 → 脚下生成 255 号篝火 */
  function eff105(g, st) {
    consume(g, st.it);
    g.log('你生起了火。');
    const fire = spawnAt(g, 255, g.player.x, g.player.y);
    return { end: 'turnWeight', made: !!fire };
  }

  /** 109 / 151 / 152 制服·发型变化（354747-354815）：改 var_99(2) 贴图号 */
  function graphicChange(g, it, next, msg) {
    it.f[2] = next;
    g.log(msg);
    if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
    return { end: 'turnWeight', graphic: next };
  }
  function eff109(g, st) {
    const f = st.it.f; let v = f[2] | 0;
    if (v >= 1161) v = 1134;
    else if (v === 1122) v = 1155;
    else if (v <= 1134) v--;
    else if (v >= 1155) v++;
    return graphicChange(g, st.it, v, '制服变化了！');
  }
  function eff151(g, st) {
    const v = st.it.f[2] | 0;
    return graphicChange(g, st.it, v < 1378 ? v + 1 : 1353, '发型变化了！');
  }
  function eff152(g, st) {
    const v = st.it.f[2] | 0;
    return graphicChange(g, st.it, v < 1341 ? v + 1 : 1320, '发型变化了！');
  }

  /** 118（350950-350973）：竞技场/展会类地图给发言力，其余给名声 var_58(34) */
  function eff118(g, st) {
    const t = v126(g, 6);
    if (v126(g, 26) !== 0 && (t === 3 || t === 2)) {
      setV126(g, 26, v126(g, 26) + 200);
      g.log('你获得了 200 点发言力。');
      return { end: 'turnWeight', kind: 'praise' };
    }
    const p = g.player;
    p.set(34, (p.get(34) | 0) + 200);
    g.log('你获得了 200 点名声。');
    return { end: 'turnWeight', kind: 'fame' };
  }

  /** 119（350975-351008）：觉悟 → addbuff 37 / 士气 -25 / 效果 619 */
  function eff119(g, st) {
    const p = g.player;
    if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, p, 37, 50, 50);
    p.set(182, (p.get(182) | 0) - 25);
    castEffect(g, 619, 100, p);
    g.log('你下定了决心！');
    return { end: 'turnWeight' };
  }

  /** 126（360214-360246）：*哔* → 视野内角色 var_58(60) -= 5 */
  function eff126(g, st) {
    const p = g.player;
    g.log(' *哔* ');
    for (const c of (g.charas || [])) {
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(60) | 0) >= 100) continue;
      if (Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) > 5) continue;
      c.set(60, Math.max(0, (c.get(60) | 0) - 5));
    }
    return { end: 'turnWeight' };
  }

  /** 144（351545-351577）：5 点深渊魔力在脚下设陷阱 */
  function eff144(g, st) {
    const p = g.player, M = Elona.MapFeat;
    const power = g.getV65 ? (g.getV65(679) | 0) : 0;
    if (power < 5) { g.log(`需要 5 点深渊魔力。（当前 ${power}）`); return { end: 'turnWeight' }; }
    if (onWorld(g)) return { end: 'turnWeight' };                  // 源码静默 goto 3017
    if (M && M.read) {
      const f = M.read(g, p.x, p.y);
      if (f && (f.id | 0) !== 0) { g.log('什么也没有发生……'); return { end: 'turnWeight' }; }
    }
    if (g.setV65) g.setV65(679, power - 5);
    if (M && M.write) M.write(g, p.x, p.y, 0, 14, (st.it.f[25] | 0) + 23, p.index | 0);
    g.log('你消耗 5 点深渊魔力，设下了陷阱。');
    return { end: 'turnWeight', trap: true };
  }

  /** 147 / 148 收容所蓄能（358394-358425）：var_65(91)=107/108 → *label_2932 */
  function effCampEnergy(g, st, mode) {
    const C = Elona.Camp, A = Elona.Actions;
    if (!C || !C.campOf || !C.campOf(g)) {
      g.log('只有在收容所才能蓄积能量。');
      return { end: 'none' };                                       // 源码 goto 4363
    }
    if (!A) return { end: 'turnWeight' };
    const turns = mode === 107 ? 21 : 61;
    const r = A.begin(g, mode, turns, { campMode: mode });
    if (!r.ok) { g.log(r.message || '现在不能蓄积能量。'); return { end: 'none' }; }
    g.log(`你开始蓄积能量。（${turns} 回合）`);
    g.endTurn();
    return { end: 'none' };
  }

  /** 22 符文（358719-358755）：城镇限定 → 消耗 → *label_2667 的存档门 */
  function eff22(g, st) {
    const t = v126(g, 6);
    if (t !== 3 && t !== 2) { g.log('那只能在城镇里使用。'); return { end: 'turnWeight' }; }
    if (g.getV65 && (g.getV65(556) | 0) > 0) { g.log('现在正在决斗中！'); return { end: 'turnWeight' }; }
    consume(g, st.it);
    g.log('突然，你的面前出现了一道通往异次元的门。（冒险已记录）');
    // *label_2667 的 var_1234=2 是「存档」；网页版直接落盘，失败不影响游戏
    try {
      if (Elona.Save && Elona.Save.save && g.serialize) {
        Promise.resolve(Elona.Save.save('slot1', g.serialize())).catch(() => {});
      }
    } catch (e) { /* 无存档后端时只保留日志 */ }
    return { end: 'turnWeight', gate: true };
  }

  /** 46 切腹（364165-364248）：y/n 确认 → HP/8 + 结束决斗 + 周围关系复位 */
  function eff46(g, st) {
    const p = g.player;
    const doIt = () => {
      g.log('你为了平息这场骚乱切腹了！');
      p.hp = idiv(p.hp | 0, 8);                                     // var_58(50,0) /= 8
      if (g.getV65 && (g.getV65(556) | 0) > 0) {
        g.setV65(556, 0);
        g.log('＊决斗结束＊');
      }
      for (const c of (g.charas || [])) {
        if (!c || c === p || (c.get(0) | 0) !== 1) continue;
        if (Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) > 5) continue;
        if ((c.get(69) | 0) >= -2 && (c.get(9) | 0) <= -2) c.set(9, c.get(69) | 0);
        c.set(201, 0);
      }
      if (g.endTurn) g.endTurn();
    };
    const P = Elona.Panels;
    if (P && P.openConfirm) {
      P.openConfirm('真的要切腹吗？', (yes) => { if (yes) doIt(); }, { title: '切腹' });
      return { end: 'none' };
    }
    doIt();
    return { end: 'none' };
  }

  // ======================================================================
  // 0-FZ.2：再来 19 个 —— 神像启动 / 自建地图道具 / 信仰显示 / 净水筒等
  // ======================================================================

  /**
   * 神像启动系列（358808-359016）：统一「你启动了○○」+ 神谕台词 + 各自副作用。
   *   26 オパートス → var_65(262)=1 / var_65(561)=1（地变前兆）
   *   27 ルルウィ   → 以太风(天气1)时拒绝，否则重 roll 天气 0/3/4/2
   *   34 ジュア     → 效果 637 / 威力 5000
   *   43 エヘカトル → 只有台词
   *   50 クミロミ   → var_65(642)++，掉 420 号种子；每 3 次加 419/418，每 5 次加 421/417
   *   51 マニ       → 只有台词（超级模式）
   *   55 ヤカテクト → var_65(641)++，掉 54 金货 5000+rnd(5000)；每 12 次 55、每 30 次 622
   *   56 イツパロトル → 范围内角色 addbuff(4, 2400, 100)
   */
  function effStatue(g, st, id) {
    const p = g.player, it = st.it;
    const name = Elona.ItemDB ? Elona.ItemDB.name(it.id, 'jp') : '神像';
    g.log(`你启动了${name}。`);
    switch (id) {
      case 26:
        if (g.setV65) { g.setV65(262, 1); g.setV65(561, 1); }
        g.log('奥帕特斯「哈哈哈！这片大地很快就要变动了吧！」');
        break;
      case 27: {
        if ((g.getV65(17) | 0) === 1) {
          g.log('露露薇「浅薄呢。你以为我会替你停下以太风吗？」');
          break;
        }
        if (g.setV65) g.setV65(17, [0, 3, 4, 2][R(g, 4)]);
        g.log('露露薇「哎呀呀，一介凡人竟敢如此央求？……这回就特别通融一次吧」');
        g.log('天气变了。');
        break;
      }
      case 34:
        g.log('朱亚「才、才不是为了你才做的呢！笨蛋！」');
        castEffect(g, 637, 5000, p);
        break;
      case 43:
        g.log('埃赫卡特尔「叫我了？叫我了？」');
        break;
      case 50: {
        g.log('库米罗妮「种…出来了…」');
        const n = (g.getV65(642) | 0) + 1;
        if (g.setV65) g.setV65(642, n);
        spawnAt(g, 420, p.x, p.y);
        if (n % 3 === 0) { spawnAt(g, 419, p.x, p.y); spawnAt(g, 418, p.x, p.y); }
        if (n % 5 === 0) { spawnAt(g, 421, p.x, p.y); spawnAt(g, 417, p.x, p.y); }
        g.log('石像的裙子里滚出了什么东西。');
        break;
      }
      case 51:
        g.log('玛尼「来吧，让我看看你的超级模式！」');
        break;
      case 55: {
        g.log('雅卡泰克特「喏，今天的零花钱！1 gold 都别浪费哦？」');
        const n = (g.getV65(641) | 0) + 1;
        if (g.setV65) g.setV65(641, n);
        let drop = 54, qty = 5000 + R(g, 5000);
        if (n % 12 === 0) { drop = 55; qty = 1; }
        if (n % 30 === 0) { drop = 622; qty = 1; }
        const made = spawnAt(g, drop, p.x, p.y);
        if (made) made.f[0] = qty;
        g.log('天上掉下来东西了！');
        break;
      }
      case 56:
        g.log('伊兹帕洛特尔「炎啊、冷气啊、还有雷啊，回应吾命，化作遮断属性之壁吧」');
        if (Elona.Status && Elona.Status.addbuff) {
          for (const c of (g.charas || [])) {
            if (!c || (c.get(0) | 0) !== 1) continue;
            if (Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) > 5) continue;
            Elona.Status.addbuff(g, c, 4, 2400, 100);
          }
        }
        break;
      default: break;
    }
    return { end: 'turnWeight', statue: id };
  }

  /** 47 领域水晶（358690-358718）：自建地图 + f[21]==5 → *label_2755 记录领域 */
  function eff47(g, st) {
    if ((g.getV65(20) | 0) !== 35) { g.log('它暗暗地发着光。'); return { end: 'turnWeight' }; }
    if ((st.it.f[21] | 0) !== 5) {
      g.log('水晶里没有这片领域的记忆，需要去找这片土地主人放置的水晶。');
      return { end: 'turnWeight' };
    }
    consume(g, st.it);
    g.log('领域的记忆被记录下来了。');
    return { end: 'turnWeight', memory: true };
  }

  /** 48 石像（360620-360638）：自建地图里才让人想往它扔东西 */
  function eff48(g, st) {
    if ((g.getV65(20) | 0) !== 35 || !g.userMapOwner) {
      g.log('它在这里看起来寒酸极了。');
      return { end: 'turnWeight' };
    }
    g.log('盯着这座石像，突然很想朝它扔点什么！');
    return { end: 'turnWeight' };
  }

  /** 49（358756-358772）：自建地图静默，否则挥动并放出效果 49 / 100 */
  function eff49(g, st) {
    if ((g.getV65(20) | 0) === 35) return { end: 'silent' };
    const name = Elona.ItemDB ? Elona.ItemDB.name(st.it.id, 'jp') : '道具';
    g.log(`你挥动了${name}。`);
    castEffect(g, 49, 100, g.player);
    return { end: 'turnWeight' };
  }

  /** 69（357024-357035）：显示信仰深度与祈祷充能 */
  function eff69(g, st) {
    const p = g.player;
    const faith = p.get(62) | 0;
    const max = (p.skill ? (p.skill(181) | 0) : 0) * 100;
    const charge = limit(idiv((p.get(63) | 0) + 1, 10), 0, 100);
    g.log(`信仰深度：${faith}/${max}，祈祷充能：${charge}%`);
    return { end: 'turnWeight', faith, charge };
  }

  /** 97（359832-359884）：世界地图上让附近据点震动（选单简化为提示） */
  function eff97(g, st) {
    if (v126(g, 6) !== 1 && !onWorld(g)) {
      g.log('应该在世界地图上使用。');
      return { end: 'turnWeight' };
    }
    g.log('周围的据点震动了。');
    return { end: 'turnWeight' };
  }

  /** 113（360179-360188）：源码写着「開発中。」 */
  function effDev(g, st) { g.log('开发中。'); return { end: 'turnWeight' }; }

  /** 107（353968-353980）：与效果 9 同走 *label_2849 的训练 rowact 104 */
  function eff107(g, st) {
    const r = beginCampRowAct(g, 104, 50, { itemId: st.it.id | 0, skill: st.it.f[25] | 0 });
    if (!r.ok) { g.log(r.message || '现在不能训练。'); return { end: 'none' }; }
    g.log('你开始训练。（50 回合）');
    g.endTurn();
    return { end: 'none' };
  }

  /** 121 净水筒（350775-350818）：水边装满 / 平时喝水 */
  function eff121(g, st) {
    const p = g.player, it = st.it;
    const attr = (g.map && g.map.attr) ? (g.map.attr(p.x, p.y) | 0) : 0;
    if (attr === 3) {
      it.f[26] = 5;
      g.log('你把净水筒装满了水。');
      return { end: 'turnWeight', filled: true };
    }
    if ((it.f[26] | 0) > 0 && (p.get(446) | 0) > 10000 && (g.getV65(273) | 0) !== 5) {
      g.log('再也喝不下了……');
      return { end: 'turnWeight' };
    }
    if ((it.f[26] | 0) > 0) {
      it.f[26] = (it.f[26] | 0) - 1;
      p.set(446, (p.get(446) | 0) + 2000);
      p.set(22, (p.get(22) | 0) + 150);
      g.log('你喝了一口水。');
    } else {
      g.log('净水筒是空的。');
    }
    return { end: 'turnWeight' };
  }

  // ======================================================================
  // 0-GA：label_3016 最后一批效果号（349962-364788）
  //
  // 0-FZ 后剩余 28 个效果号；其中 3 个已由其它模块接管，注册反而会抢先拦截：
  //   · 16/17 源码只是 `var_396 = 185/183 ; gosub *label_2960`，项目由
  //     cookUse / Perform.use / Fishing.useRod（game.js 2864/2870）接手；
  //   · 99 存钱箱由 core/economy.js 按物品 id 1097 实现完整银行窗口（game.js 2791）。
  // 因此这里补的是其余 25 个，SPECS 96 → 121。
  //
  // 新增两种 UI 请求（view/ui.js 里各加一个分支）：
  //   choice    ← 源码 *label_2896 / txtselecttc 的通用选项菜单
  //   item-pick ← 源码 *label_2824 的「选一件道具」窗口
  // ======================================================================

  /** *label_2896：选项菜单请求；value 回来时由 spec.resolve 处理 */
  function gaChoice(st, title, options, tag) {
    st.gaTag = tag || 'main';
    return {
      ok: false, effect: st.eff, action: 'choice', request: 'choice',
      title, options: options.slice(), gaTag: st.gaTag,
    };
  }

  /** *label_2824：选一件背包道具；filter 可为 null（全部） */
  function gaItem(st, title, filter, tag) {
    st.gaTag = tag || 'main';
    return {
      ok: false, effect: st.eff, action: 'item-pick', request: 'item-pick',
      title, filter: filter || null, gaTag: st.gaTag,
    };
  }

  /** *label_2893 的八方向 + 自己格；用菜单表达，索引即原版小键盘 1..9 */
  const GA_DIRS = [[-1, 1], [0, 1], [1, 1], [-1, 0], [0, 0],
    [1, 0], [-1, -1], [0, -1], [1, -1]];
  function gaDirChoice(st, title, tag) {
    return gaChoice(st, title,
      ['左下', '下', '右下', '左', '脚下', '右', '左上', '上', '右上'], tag);
  }
  function gaDir(g, v) {
    const p = g.player, d = GA_DIRS[limit(v | 0, 0, 8)] || GA_DIRS[4];
    return { x: (p.x | 0) + d[0], y: (p.y | 0) + d[1] };
  }
  /** var_704(x,y,1) - 1：格子上的角色（0 = 没人） */
  function gaCharaAt(g, x, y) {
    for (const c of (g.charas || [])) {
      if (c && G(c, 0) === 1 && (c.x | 0) === (x | 0) && (c.y | 0) === (y | 0)) return c;
    }
    return null;
  }
  /** 6 格内最近的敌对角色（源码 label_2836 / label_2838 的近似） */
  function gaFoe(g, maxDist) {
    const p = g.player, md = maxDist | 0 || 6;
    let best = null, bd = 1e9;
    for (const c of (g.charas || [])) {
      if (!c || c === p || G(c, 0) !== 1 || G(c, 9) >= 0) continue;
      const d = Math.max(Math.abs((c.x | 0) - (p.x | 0)), Math.abs((c.y | 0) - (p.y | 0)));
      if (d <= md && d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function gaDamage(g, c, dmg, attr, att) {
    if (!c) return 0;
    const d = Math.max(0, dmg | 0);
    if (Elona.Battle && Elona.Battle.applyDamage) {
      try { return Elona.Battle.applyDamage(c, d, g, att || g.player, attr | 0, 1000); }
      catch (e) { /* 退回直接扣血 */ }
    }
    c.hp = Math.max(0, (c.hp | 0) - d);
    return d;
  }
  function gaExp(g, c, skill, amount) {
    if (!Elona.Stats || !Elona.Stats.skillExp) return;
    try { Elona.Stats.skillExp(c, skill | 0, c, amount | 0, 0, 0, g); } catch (e) { /* 未就绪 */ }
  }
  /** 353636 / 353568 / 353485 等共通的 dmg 公式 */
  function gaGunPower(g, p, skill) {
    const s1 = S(p, skill), s2 = S(p, 189), lv = Math.max(1, G(p, 38));
    return Math.floor((s1 / 5 + 5) * ((s2 + 1) / 5 + 5)
      + R(g, s2 * 2 + 5)
      + (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4
        * Math.sqrt(limit(lv, 1, 2000) * 3) + 30);
  }
  function gaItemName(it) {
    if (!it) return '道具';
    try { return Elona.ItemDB.name(it.id, 'jp') || `道具${it.id | 0}`; }
    catch (e) { return `道具${it.id | 0}`; }
  }
  /** 生成物品并设置数量（itemcreate -1,id,x,y,n） */
  function gaSpawn(g, id, x, y, n) {
    const it = spawnAt(g, id, x, y);
    if (it && n !== undefined) it.f[0] = n | 0;
    return it;
  }
  /** 生成一只怪物并加入队伍（characreate 56 + *label_4274） */
  function gaSummonAlly(g, species, level) {
    if (!Elona.Monster || !Elona.Monster.create || !Elona.Party) return null;
    if (Elona.Party.freeSlot && !Elona.Party.freeSlot(g)) return null;
    const p = g.player;
    let c = null;
    try {
      c = Elona.Monster.create(g, species | 0, level | 0 || Math.max(1, G(p, 38)),
        p.x, p.y, {});
    } catch (e) { c = null; }
    if (!c) return null;
    try { Elona.Party.joinChara(g, c); } catch (e) { return null; }
    return c;
  }

  /** 37 收起牌组（364746-364765）：var_65(197) = 1 → 0 + label_2468/2102 刷新 */
  function eff37(g, st) {
    if (g.setV65) g.setV65(197, 0);
    g.log('你把牌组收了起来。');
    return { end: 'turnWeight', deckClosed: true };
  }

  /** 38 把卡加入牌组（364766-364788）：var_515(0, f[23])++，消耗这张卡 */
  function eff38(g, st) {
    const it = st.it, id = it.f[23] | 0;
    if (id <= 0) { g.log('你没有牌组。'); return { end: 'turnWeight', added: false }; }
    if (!g.cardDeck) g.cardDeck = {};
    g.cardDeck[id] = (g.cardDeck[id] | 0) + 1;
    const nm2 = gaItemName(it);
    consume(g, it);
    g.log(`你把${nm2}加进了牌组。`);
    return { end: 'turnWeight', added: true, card: id };
  }

  /** 53 每月零花钱（359068-359210）：var_65(816) 计数，换月重置 */
  const GA_POCKET_TAUNTS = [
    '「我说啊…这个月不是已经给过了吗？」', '「喂，忍到下个月啦」',
    '「所以说！这个月的零花钱已经没了呀！」', '「…你再怎么催我也很为难啊」',
    '「看看隔壁的信徒？人家拿那份零花钱可老实了」',
    '「又来了…该不会是在等吐槽吧？」', '「该、该不会是失忆了吧…不行，我担心起来了」',
    '「…连担心都觉得蠢起来了」', '「吵死了笨蛋…」',
    '「啊啊啊啊啊！！！够了！！差不多够了吧笨蛋——！！…呼、呼」',
    '「…上次是有点过火了，抱歉。不过这真是一个月一次哦，懂吧」',
  ];
  function eff53(g, st) {
    const month = g.getV65 ? (g.getV65(11) | 0) : 0;
    // 源码由月更新例程清 var_65(816)；这里借 v65(817) 记「上次领取月」
    const last = g.getV65 ? (g.getV65(817) | 0) : month;
    if (last !== month) { g.setV65(816, 0); g.setV65(817, month); }
    const n = g.getV65 ? (g.getV65(816) | 0) : 0;
    if (n > 0 && n <= 11) {
      g.log(GA_POCKET_TAUNTS[n - 1] || '下个月再来吧。');
      g.setV65(816, n + 1);
      return { end: 'turnWeight', taunt: n };
    }
    if (n > 11) {
      g.log('铂金币以惊人的势头从天而降，砸在地上粉身碎骨。');
      return { end: 'turnWeight', shattered: true };
    }
    const amt = limit(idiv(S(g.player, 181), 6), 10, 25);
    const p = g.player;
    const coin = gaSpawn(g, 55, p.x, p.y, amt);
    g.log('有什么东西滚到了脚边。');
    g.log('「来来，这个月的零花钱！…乱花的话我可不饶你哦」');
    if (g.setV65) { g.setV65(816, 1); g.setV65(817, month); }
    return { end: 'turnWeight', pocket: amt, coin: !!coin };
  }

  /** 54 卫星炮（360513-360578）：全屏荷电粒子炮 */
  function eff54(g, st) {
    g.log('从卫星轨道上发射了荷电粒子炮！');
    if (g.setV65) { g.setV65(194, 777); g.setV65(194, 0); }
    const p = g.player, dmg = 300 + gaGunPower(g, p, 13);
    let hits = 0;
    for (const c of (g.charas || [])) {
      if (!c || c === p || G(c, 0) !== 1) continue;
      g.log(`荷电粒子命中了${nm(c)}。`);
      gaDamage(g, c, dmg, 0, p);
      hits++;
    }
    return { end: 'turnWeight', fired: true, hits, damage: dmg };
  }

  /** 57 指挥旗（360299-360512）：给全体同伴下战术指令 */
  function eff57(g, st) {
    return gaChoice(st, '要给同伴下达什么指示？',
      ['突击态势', '防御态势', '迎击态势', '交涉态势'], 'main');
  }
  function eff57res(g, st, v) {
    const m = v | 0;
    if (m < 0 || m > 3) return { end: 'none' };
    const r = (Elona.Companion && Elona.Companion.setModeAll)
      ? Elona.Companion.setModeAll(g, m) : null;
    if (!r || !r.ok) g.log('附近没有同伴。');
    return { end: 'turnWeight', mode: m, count: r ? (r.count | 0) : 0 };
  }

  /** 63 亡灵之棺（355947-356064）：按 f[25] 3..9 生成亡灵同伴 */
  function eff63(g, st) {
    if ((g.getV65 ? (g.getV65(20) | 0) : 0) === 6 || onWorld(g)) {
      g.log('什么也没有发生……');
      return { end: 'turnWeight', summoned: false };
    }
    let minions = 0;
    for (const c of (g.charas || [])) if (c && G(c, 0) === 1 && G(c, 9) === 10) minions++;
    if (minions > 15) { g.log('不能再同时使役更多怪物了。'); return { end: 'turnWeight', summoned: false }; }
    const it = st.it;
    const tier = limit(it.f[25] | 0, 3, 9);
    const species = (it.f[26] | 0) || (300 + tier);
    const c = gaSummonAlly(g, species, Math.max(1, G(g.player, 38)));
    if (!c) { g.log('……但是什么也没有出现。'); return { end: 'turnWeight', summoned: false }; }
    consume(g, it);
    g.log('棺材里爬出了不死者。');
    return { end: 'turnWeight', summoned: true, tier };
  }

  /** 64 情人节巧克力（357036-357234）：2 月限定 + 两段菜单 */
  function eff64(g, st) {
    if ((g.getV65 ? (g.getV65(11) | 0) : 0) !== 2
        || (g.getV65 ? (g.getV65(250 + 264) | 0) : 0) >= 10) {
      g.log('等下一个 2 月吧。');
      return { end: 'turnWeight', made: false, reason: 'not-february' };
    }
    return gaChoice(st, '来做美味的巧克力吧！首先怎么做？',
      ['随便做做', '讲究一点', '还是算了'], 'first');
  }
  function eff64res(g, st, v) {
    const p = g.player, it = st.it, sel = v | 0;
    if (st.gaTag === 'first') {
      if (sel === 2) { g.log('光想想就觉得麻烦，不做了。'); return { end: 'turnWeight', made: false }; }
      if (sel === 0) {
        consume(g, it);
        p.set(22, (G(p, 22) + 750) | 0);
        g.log('味道还行。');
        return { end: 'turnWeight', made: true, simple: true };
      }
      return gaChoice(st, '切好巧克力、边调温边隔水加热！接下来呢？',
        ['再加热一会儿', '直接尝一口', '全部倒掉'], 'second');
    }
    if (st.gaTag === 'second') {
      consume(g, it);
      g.log('好烫！');
      gaDamage(g, p, idiv(G(p, 51), 10), -23, p);
      if (sel === 1) { g.log('…又甜又好吃！'); p.set(22, (G(p, 22) + 750) | 0); }
      else g.log('你弄得浑身都是巧克力。');
      if (g.setV65) g.setV65(13, (g.getV65(13) | 0) + 1);
      return { end: 'turnWeight', made: true, burnt: true };
    }
    return { end: 'turnWeight', made: false };
  }

  /** 78 制作道具（353844-353873）：*label_2824 选一件道具并改写成 1005/1009 */
  function eff78(g, st) { return gaItem(st, '要改造哪件道具？', null, 'main'); }
  function eff78res(g, st, it) {
    if (!it || !it.f) return { end: 'none', made: false };
    it.f[23] = it.f[3] | 0;
    it.f[26] = 0; it.f[3] = 1005; it.f[20] = 0; it.f[17] = 0;
    it.f[2] = 1009; it.f[7] = 100; it.f[24] = 0; it.f[27] = 0;
    g.log(`做好了${gaItemName(it)}。`);
    return { end: 'turnWeight', made: true };
  }

  /** 79 号令旗（360247-360298）：视野内友方 NPC var_58(182) += 5 */
  function eff79(g, st) {
    const p = g.player;
    let n = 0;
    for (const c of (g.charas || [])) {
      if (!c || c === p || G(c, 0) !== 1 || G(c, 9) !== 10) continue;
      if (G(c, 269) > 0 || G(c, 253) > 0) continue;
      const d = Math.max(Math.abs((c.x | 0) - (p.x | 0)), Math.abs((c.y | 0) - (p.y | 0)));
      if (d > 7) continue;
      // 360277-360292：>100 时按「无护盾 / 无骑乘 / 低属性」夹回 100，再统一夹 200
      let v = G(c, 182) + 5;
      if (v > 100 && G(c, 409) <= 0 && (G(c, 214) <= 0 || (g.player.index | 0) === 0)
          && (G(c, 25) < 4 || (g.player.index | 0) < 16)) v = 100;
      if (v > 200) v = 200;
      c.set(182, v);
      n++;
    }
    return { end: 'turnWeight', cheered: n };
  }

  /** 82/83/133/154 魔力蓄积枪（353334-353827） */
  function effGun(g, st, kind) {
    const it = st.it, p = g.player;
    it.f[9] = (it.f[9] | 0) + 1;
    // NPC 使用者：弹尽时从 var_65(25) 扣 10 补弹（353342-353351 等共通段）
    if (st.gaNpc && (it.f[9] | 0) <= 0) {
      const stock = g.getV65 ? (g.getV65(25) | 0) : 0;
      if (stock < 10) { g.log('魔力积蓄不足……'); return { end: 'turnWeight', recharged: false }; }
      g.setV65(25, stock - 10);
      it.f[9] = kind === 154 ? 3 : 1;
      g.log(`${nm(p)}消耗了 10 点魔力积蓄（剩余 ${stock - 10}）。`);
      return { end: 'turnWeight', recharged: true };
    }
    const t = gaFoe(g, 6);
    if (!t) { g.log('范围内没有目标。'); return { end: 'turnWeight', fired: false }; }
    it.f[9] = Math.max(0, (it.f[9] | 0) - 1);
    const power = gaGunPower(g, p, kind === 133 ? 12 : 13);
    if (kind === 82) {
      gaDamage(g, t, power, 64, p);
      t.set(179, 3);
      gaExp(g, p, 13, 80); gaExp(g, p, 189, 80);
      g.log(`${nm(t)}被魔力弹击中。`);
    } else if (kind === 83) {
      let n = 0;
      for (const c of (g.charas || [])) {
        if (!c || c === p || G(c, 0) !== 1 || G(c, 9) >= 0) continue;
        const d = Math.max(Math.abs((c.x | 0) - (t.x | 0)), Math.abs((c.y | 0) - (t.y | 0)));
        if (d > 2) continue;
        gaDamage(g, c, power, -9, p);
        c.set(170, 0);
        n++;
      }
      gaExp(g, p, 11, 80); gaExp(g, p, 189, 80);
      g.log(`${nm(t)}被火焰包围了。`);
      return { end: 'turnWeight', fired: true, kind, hits: n };
    } else if (kind === 133) {
      if (G(t, 60) < 100) t.set(60, Math.min(99, G(t, 60) + 20));
      gaDamage(g, t, power, 64, p);
      gaExp(g, p, 12, 80); gaExp(g, p, 189, 80);
      g.log(`麻醉针刺入了${nm(t)}。`);
    } else {
      // 154 体重调整针（353334-353498）：按体重给 15/30，否则「過剰投与！」
      const w = G(t, 20);
      if (w >= 500 && w < 1000) { t.set(181, 15); g.log('适正体重！'); }
      else if (w >= 1000) { t.set(181, 30); g.log('适正体重！'); }
      else {
        g.log('过量投药！');
        gaDamage(g, t, idiv(power * 2, 3), 58, p);
      }
    }
    return { end: 'turnWeight', fired: true, kind, target: t.index | 0 };
  }

  /** 84 狙击（353244-353333）：选位置 → 直线大伤害 + var_65(250+29)++ */
  function eff84(g, st) {
    const t = gaFoe(g, 12);
    if (!t) { g.log('看不见那个地方。'); return { end: 'turnWeight', fired: false }; }
    const p = g.player;
    const dmg = 1000 + gaGunPower(g, p, 176);
    gaDamage(g, t, dmg, 64, p);
    if (g.setV65) g.setV65(250 + 29, (g.getV65(250 + 29) | 0) + 1);
    g.log(`子弹命中了${nm(t)}。`);
    return { end: 'turnWeight', fired: true, damage: dmg };
  }

  /** 94 变化道具（356632-356676）：*label_0354 重掷附魔，保留 f[7]/f[22] */
  function eff94(g, st) { return gaItem(st, '要变化哪件道具？', null, 'main'); }
  function gaMorphRes(g, st, it, kind) {
    if (!it || !it.f) return { end: 'none', ok: false };
    const f = it.f;
    if (kind === 94) {
      const ench = [11, 12, 13, 14, 15].filter((k) => (f[k] | 0) !== 0);
      if (!ench.length) { g.log('什么也没有发生……'); return { end: 'turnWeight', ok: false }; }
      const value = f[7] | 0, count = f[22] | 0, quality = f[24] | 0;
      const k = ench[R(g, ench.length)];
      f[k] = (f[k] | 0) + 1;                 // label_0354 的随机附魔重掷
      f[7] = value; f[22] = count; f[24] = quality;
      g.log(`${gaItemName(it)}发生了变化。`);
      consume(g, st.it);
      return { end: 'turnWeight', ok: true, changed: k };
    }
    if (kind === 96) {
      if ((f[20] | 0) < 15) {
        g.log(`${gaItemName(it)}被蓝光包围了。`);
        f[20] = (f[20] | 0) + 1;
        g.log(`${gaItemName(it)}抵抗了。`);
      }
      consume(g, st.it);
      return { end: 'turnWeight', ok: true, enchant: f[20] | 0 };
    }
    if (kind === 129) {
      f[26] = (f[26] | 0) + 75;
      const need = 100 * ((f[25] | 0) + 1);   // calcexpalive 近似
      if ((f[26] | 0) >= need) g.log(`${gaItemName(it)}可以升级了！`);
      g.log(`${gaItemName(it)}吸收了强化星维，稍微成长了一点！`);
      consume(g, st.it);
      return { end: 'turnWeight', ok: true, exp: f[26] | 0 };
    }
    return { end: 'turnWeight', ok: false };
  }

  /** 136 粘菌分隔（357439-357559）：按 f[32] 的位数分成若干 1265 号容器 */
  function eff136(g, st) { return gaItem(st, '要分装哪件道具？', null, 'main'); }
  function eff136res(g, st, it) {
    if (!it || !it.f) return { end: 'none', split: 0 };
    const p = g.player;
    const amt = it.f[32] | 0;
    const divisors = [10, 100, 1000, 10000, 100000];
    const cuts = [8, 20, 15, 8, 20];
    let n = 0;
    for (let i = 0; i < divisors.length; i++) {
      if (idiv(amt, divisors[i]) < Math.pow(10, i === 0 ? 0 : i - 1)) continue;
      const v = gaSpawn(g, 1265, p.x, p.y);
      if (!v) continue;
      v.f[7] = idiv(it.f[7] | 0, cuts[i]);
      v.f[23] = it.f[23] | 0;
      v.f[32] = i + 1;
      v.f[17] = 0;
      n++;
    }
    if (!n) g.log('什么也没有发生……');
    else g.log(`你把${gaItemName(it)}分装进了粘菌容器。`);
    consume(g, st.it);
    return { end: 'turnWeight', split: n };
  }

  // 99 存钱箱（358512-358663）**不在本模块实现**：项目的 `core/economy.js`
  //   早已按物品 id 1097（ヤカテクトの預金箱）实现了完整的银行窗口
  //   （Economy.bankTrade / balance + 面板），game.js 2791 在 ItemFx.dispatch
  //   之后按 id 分派。若在这里注册 99 会抢先拦截、让 `action:'bank'` 消失，
  //   所以与 16/17 一样归为「已由其它模块接管」。

  /** 101 撒饵（356089-356278）：方向 → 水面 → 引鱼 */
  function eff101(g, st) { return gaDirChoice(st, '要把饵撒在哪里？', 'main'); }
  function gaIsWater(g, x, y) {
    try {
      if (g.map && typeof g.map.attr === 'function') return (g.map.attr(x, y) | 0) === 3;
      if (g.map && typeof g.map.cell === 'function') {
        const c = g.map.cell(x, y);
        return !!c && (c[0] | 0) === 3;
      }
    } catch (e) { /* 无地形信息 */ }
    return false;
  }
  function eff101res(g, st, v) {
    const d = gaDir(g, v), p = g.player, it = st.it;
    if (!gaIsWater(g, d.x, d.y)) { g.log('要撒在水里。'); return { end: 'turnWeight', baited: false }; }
    consume(g, it);
    g.log(`${gaItemName(it)}正悠闲地吃着饵…`);
    const fish = gaSpawn(g, 618, d.x, d.y);
    if (fish) {
      fish.f[20] = ((fish.f[20] | 0) + 1) | 0;
      g.log('有鱼上钩了！');
    }
    return { end: 'turnWeight', baited: true, x: d.x, y: d.y };
  }

  /** 106 栽培管理（364336-364491）：接 Farm.tend 的 5 种照料 */
  function eff106(g, st) {
    return gaChoice(st, '要怎么照料作物？',
      ['放防虫剂', '修补伤口', '立支柱', '松土', '培土'], 'main');
  }
  function eff106res(g, st, v) {
    const ch = (v | 0) + 1;
    if (ch < 1 || ch > 5) { g.log('还是算了。'); return { end: 'none' }; }
    const p = g.player;
    if (G(p, 52) < 0) { g.log('想稍微休息一下…'); return { end: 'turnWeight', tended: false }; }
    const F = Elona.Farm;
    if (!F || !F.tend) { g.log('这里没有可以照料的作物。'); return { end: 'turnWeight', tended: false }; }
    const r = F.tend(g, p.x, p.y, ch);
    return { end: 'turnWeight', tended: !!(r && r.ok), care: r ? (r.care | 0) : 0 };
  }

  /** 110 守护者知识（352292-352362）：全队获得技能 / 技能经验， sanity -5 */
  function eff110(g, st) {
    if (onWorld(g)) return { end: 'turnWeight', taught: 0 };
    const it = st.it;
    const skill = (it.f[25] | 0) || 165;
    const power = (it.f[26] | 0) || 1;
    let learned = 0, trained = 0;
    for (let i = 0; i < 16 && i < (g.charas || []).length; i++) {
      const c = g.charas[i];
      if (!c || G(c, 0) !== 1) continue;
      g.log(`曾是守护者的知识流进了${nm(c)}的脑海…`);
      if (S(c, skill) === 0 && Elona.Stats && Elona.Stats.skillGain) {
        try { Elona.Stats.skillGain(c, i, skill, 1); } catch (e) { /* 未就绪 */ }
        g.log(`${nm(c)}习得了技能 ${skill}！`);
        learned++;
      } else {
        const exp = 200 + Math.floor(Math.sqrt(power * 2000)
          + limit(idiv(S(c, 165), 2), 0, 500)) * 2;
        gaExp(g, c, skill, exp);
        gaExp(g, c, 165, 200 + Math.floor(Math.sqrt(power * 1000)) * 2);
        trained++;
      }
      if (Elona.Status && Elona.Status.dmgsan) {
        try { Elona.Status.dmgsan(c, 5, g); } catch (e) { /* 未就绪 */ }
      }
    }
    consume(g, it);
    recalc(g, g.player);
    return { end: 'turnWeight', taught: learned + trained, learned, trained, skill };
  }

  /** 134 获得能力（359961-360170）：一次性 flag + 伙伴形态推进（近似） */
  /** 821 魅了之香（336762-336801）：核心逻辑在 core/intimacy.js 的 applyAphrodisiac */
  function eff821(g, st) {
    const r = Elona.Intimacy
      ? Elona.Intimacy.applyAphrodisiac(g, g.player)
      : { ok: false, hit: 0, resisted: 0 };
    consume(g, st.it);
    return { end: 'turnWeight', hit: r.hit | 0, resisted: r.resisted | 0 };
  }

  function eff134(g, st) {
    if (!g.learnedAbilities) g.learnedAbilities = {};
    const first = !g.learnedAbilities[868];
    if (first) {
      g.learnedAbilities[868] = 1;
      g.log('你获得了「异形之友」的能力。');
    } else {
      g.log('你早已掌握了这个能力。');
    }
    consume(g, st.it);
    return { end: 'turnWeight', learned: first, ability: 868 };
  }

  /** 149 生成装置（355126-355214）：能量槽 100% 时生成两只 1124 */
  function eff149(g, st) {
    const p = g.player;
    if (G(p, 182) < 100) { g.log('需要 100% 的能量槽。'); return { end: 'turnWeight', spawned: 0 }; }
    if (p.abilities && !p.abilities[10]) {
      g.log('不知道该如何使用…'); return { end: 'turnWeight', spawned: 0 };
    }
    let n = 0;
    for (const dx of [-1, 1]) {
      const lv = Math.max(1, G(p, 38));
      const c = gaSummonAlly(g, 1124, lv);
      if (c) { c.x = (p.x | 0) + dx; c.y = p.y | 0; n++; }
    }
    p.set(182, G(p, 182) - 100);
    g.log(n ? '两台小型装置启动了。' : '……但是什么也没有出现。');
    return { end: 'turnWeight', spawned: n };
  }

  /** 153 佯攻 / 播种（351909-352022）：方向 → 有人则 -5 能量，空地则种下 */
  function eff153(g, st) { return gaDirChoice(st, '要往哪个方向使用？', 'main'); }
  function eff153res(g, st, v) {
    const d = gaDir(g, v), it = st.it;
    const c = gaCharaAt(g, d.x, d.y);
    if (c && c !== g.player) {
      c.set(182, Math.max(0, G(c, 182) - 5));
      consume(g, it);
      g.log(`你对${nm(c)}使了个假动作。`);
      return { end: 'turnWeight', feint: true };
    }
    if (onWorld(g)) { g.log('这里不能种。'); return { end: 'turnWeight', planted: false }; }
    if (Elona.MapFeat && Elona.MapFeat.write) {
      Elona.MapFeat.write(g, d.x, d.y, 9 + 1611, 35, it.f[24] | 0, 0);
      consume(g, it);
      g.log(`你种下了${gaItemName(it)}。`);
      return { end: 'turnWeight', planted: true, x: d.x, y: d.y };
    }
    g.log('这里不能种。');
    return { end: 'turnWeight', planted: false };
  }

  /** 155 眼镜收集（351843-351908）：消耗 1332 号道具，每枚 +11 能量 */
  function eff155(g, st) {
    const p = g.player;
    if (G(p, 182) !== 0) { g.log('什么也没有发生……'); return { end: 'turnWeight', megane: 0 }; }
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const it = (p.inv || []).find((x) => x && (x.id | 0) === 1332 && (x.f[0] | 0) >= 1);
      if (!it) break;
      it.f[0] = (it.f[0] | 0) - 1;
      p.set(182, G(p, 182) + 11);
      n++;
      g.log(['1 眼镜!', '2 眼镜!!', '3 眼镜!!!', '4 眼镜!!!!', '5 眼镜!!!!!'][n - 1]);
    }
    recalc(g, p);
    return { end: 'turnWeight', megane: n, gauge: G(p, 182) };
  }

  const SPECS = {
    5: { name: '听诊器', tag: 'pick', empty: 'none', success: 'turn', run: eff5 },
    // 0-GA：label_3016 最后 25 个可落地效果号（16/17/99 已由其它模块接管）
    37: { name: '收起牌组', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff37 },
    38: { name: '加入牌组', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff38 },
    53: { name: '每月零花钱', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff53 },
    54: { name: '卫星炮', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff54 },
    57: { name: '指挥旗', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff57, resolve: eff57res },
    63: { name: '亡灵之棺', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff63 },
    64: { name: '情人节巧克力', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff64, resolve: eff64res },
    78: { name: '道具改造', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff78, resolve: eff78res },
    79: { name: '号令旗', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff79 },
    82: { name: '魔力枪·炎', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effGun(g, st, 82) },
    83: { name: '魔力枪·范围', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effGun(g, st, 83) },
    84: { name: '狙击枪', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff84 },
    94: { name: '变化道具', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff94, resolve: (g, st, it) => gaMorphRes(g, st, it, 94) },
    96: { name: '强化道具', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => gaItem(st, '要强化哪件道具？', null, 'main'), resolve: (g, st, it) => gaMorphRes(g, st, it, 96) },
    101: { name: '撒饵', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff101, resolve: eff101res },
    106: { name: '栽培管理', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff106, resolve: eff106res },
    110: { name: '守护者知识', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff110 },
    129: { name: '强化星维', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => gaItem(st, '要强化哪件道具？', null, 'main'), resolve: (g, st, it) => gaMorphRes(g, st, it, 129) },
    133: { name: '麻醉枪', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effGun(g, st, 133) },
    134: { name: '异形之友', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff134 },
    136: { name: '粘菌分隔', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff136, resolve: eff136res },
    149: { name: '小型装置', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff149 },
    153: { name: '佯攻 / 播种', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff153, resolve: eff153res },
    154: { name: '体重调整针', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effGun(g, st, 154) },
    155: { name: '眼镜收集', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff155 },
    // 0-GD：魅了系道具（336762-336801）—— 范围内的目标替使用者发起行為 24
    821: { name: '魅了之香', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff821 },
    // 0-FZ.2：19 个神像 / 自建地图 / 显示 / 净水筒效果
    26: { name: '奥帕特斯神像', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effStatue(g, st, 26) },
    27: { name: '露露薇神像', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effStatue(g, st, 27) },
    34: { name: '朱亚神像', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effStatue(g, st, 34) },
    43: { name: '埃赫卡特尔神像', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effStatue(g, st, 43) },
    47: { name: '领域水晶', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff47 },
    48: { name: '奇怪的石像', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff48 },
    49: { name: '挥动道具', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff49 },
    50: { name: '库米罗妮神像', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effStatue(g, st, 50) },
    51: { name: '玛尼神像', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effStatue(g, st, 51) },
    55: { name: '雅卡泰克特神像', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effStatue(g, st, 55) },
    56: { name: '伊兹帕洛特尔神像', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effStatue(g, st, 56) },
    69: { name: '信仰计', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff69 },
    97: { name: '据点震动装置', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff97 },
    98: { name: '源码空分支 98', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    107: { name: '训练机（第二型）', tag: null, noTarget: true, empty: 'none', success: 'none', run: eff107 },
    111: { name: '源码空分支 111', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    112: { name: '源码空分支 112', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    113: { name: '开发中道具', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effDev },
    121: { name: '净水筒', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff121 },
    // 0-FZ：30 个「无需选目标」的剩余效果（源码行号见各 eff 函数注释）
    6: { name: '光盘（播放）', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff6 },
    10: { name: '光盘（停止）', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff10 },
    22: { name: '异次元之门符文', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff22 },
    35: { name: '铁处女', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effTorture(g, st, false) },
    36: { name: '断头台', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: (g, st) => effTorture(g, st, true) },
    42: { name: '不祥的预感', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff42 },
    46: { name: '切腹', tag: null, noTarget: true, empty: 'none', success: 'none', run: eff46 },
    65: { name: '肥料', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff65 },
    68: { name: '选曲列表', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff68 },
    70: { name: '犬笛', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff70 },
    76: { name: '发信机', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff76 },
    86: { name: '源码空分支 86', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    87: { name: '源码空分支 87', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    88: { name: '源码空分支 88', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    89: { name: '源码空分支 89', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    92: { name: '轰鸣演出', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff92 },
    103: { name: '深渊魔力结晶', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff103 },
    105: { name: '火种', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff105 },
    109: { name: '制服变换', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff109 },
    118: { name: '名声/发言力奖章', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff118 },
    119: { name: '觉悟之证', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff119 },
    123: { name: '源码空分支 123', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    124: { name: '源码空分支 124', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    126: { name: '遥控器', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff126 },
    131: { name: '源码空分支 131', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: effNoop },
    144: { name: '深渊陷阱设置器', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff144 },
    147: { name: '收容所蓄能器（小）', tag: null, noTarget: true, empty: 'none', success: 'none', run: (g, st) => effCampEnergy(g, st, 107) },
    148: { name: '收容所蓄能器（大）', tag: null, noTarget: true, empty: 'none', success: 'none', run: (g, st) => effCampEnergy(g, st, 108) },
    151: { name: '发型变换 A', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff151 },
    152: { name: '发型变换 B', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff152 },
    7: { name: '避难所', tag: null, noTarget: true, empty: 'none', success: 'none', run: eff7 },
    9: { name: '训练机', tag: null, noTarget: true, empty: 'none', success: 'none', run: eff9 },
    21: { name: '素材工具', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff21 },
    32: { name: '能力复合机', tag: null, noTarget: true, empty: 'none', success: 'none', run: eff32 },
    11: { name: '小猫存钱罐', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff11 },
    13: { name: '火把', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff13 },
    14: { name: '雪', tag: 'pick', empty: 'none', success: 'turnWeight', run: eff14 },
    24: { name: '地雷', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff24 },
    29: { name: '秘宝', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff29 },
    31: { name: '库米罗妮宝玉', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff31 },
    33: { name: '怪物球', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff33 },
    39: { name: '哨子', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff39 },
    20: { name: '易容道具', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff20 },
    25: { name: '独角兽的角', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff25 },
    28: { name: '原子弹', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff28 },
    30: { name: '启动道具', tag: null, noTarget: true, empty: 'none', success: 'turnWeight', run: eff30 },
    23: { name: '绳扣', tag: 'pick', empty: 'turnWeight', success: 'turnWeight', run: eff23 },
    45: {
      name: '沙袋', tag: 'reject', tagReject: '搭档是吊不起来的。',
      empty: 'turnWeight', success: 'turnWeight', preCheck: eff45Pre, run: eff45,
    },
    59: { name: '哲学家面具', tag: 'pick', empty: 'turnWeight', success: 'turnWeight', run: eff59, resolve: eff59res },
    60: { name: '空白名片', tag: 'pick', empty: 'turnWeight', success: 'turnWeight', run: eff60, resolve: eff60res },
    62: { name: '星光笔', tag: null, empty: 'turnWeight', success: 'turnWeight', run: eff62, resolve: eff62res },
    66: { name: '灵魂纺锤', tag: 'pick', empty: 'turnWeight', success: 'turnWeight', run: eff66 },
    72: { name: '洞察透镜', tag: 'pick', empty: 'silent', success: 'turnWeight', preTarget: eff72PreTarget, run: eff72 },
    73: { name: '异形身体', tag: 'pick', empty: 'turnWeight', success: 'turnWeight', preCheck: eff73PreCheck, run: eff73, resolve: eff73res },
    77: { name: '形态核心', tag: 'pick', empty: 'turnWeight', success: 'turnWeight', run: eff77 },
    80: { name: '弹药箱', tag: 'pick', empty: 'turnWeight', success: 'turnWeight', run: eff80 },
    81: { name: '急救包', tag: 'pick', empty: 'turnWeight', success: 'turnWeight', run: eff81 },
    85: { name: '元素之眼', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff85, resolve: eff85res },
    95: { name: '生物打印机', tag: 'pick', empty: 'turnWeight', success: 'turnWeight', run: eff95 },
    104: { name: '固定锚', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff104 },
    117: { name: 'G指', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff117 },
    120: { name: '重婚许可证', tag: 'pick', empty: 'none', success: 'turn', world: true, preCheck: eff120PreCheck, run: eff120 },
    122: { name: '蕾西玛斯碎片', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff122 },
    125: { name: '袜子', tag: 'pick', empty: 'none', success: 'turnWeight', run: eff125 },
    127: { name: '安宁剂', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff127 },
    128: { name: '药烟管', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff128 },
    130: { name: '灵质', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff130 },
    132: { name: '生存力扩张液', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff132 },
    139: { name: '抗性上限', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff139 },
    140: { name: 'DV 修正剂', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff140 },
    141: { name: 'PV 修正剂', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff141 },
    142: { name: '魔力结晶石', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff142 },
    143: { name: '战斗结晶石', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff143 },
    145: { name: '清醒结晶石', tag: 'pick', empty: 'none', success: 'turnWeight', world: true, run: eff145 },
    146: {
      name: '浮空笼', tag: 'reject', tagReject: '搭档是关不进笼子的。',
      empty: 'turnWeight', success: 'turnWeight', preCheck: eff146PreCheck, run: eff146,
    },
    150: {
      name: '拟态镜', tag: 'pick', empty: 'none', success: 'turnWeight', world: true,
      pre: eff150Pre, onPre: eff150OnPre, run: eff150,
    },
  };

  /** 45 的区域门槛（354203：var_65(20) == 35） */
  function eff45Pre(g) {
    if ((g.getV65 ? (g.getV65(20) | 0) : 0) === 35) {
      g.log('这个区域里无法使用。');
      return { end: 'none' };
    }
    return null;
  }

  // ======================================================================
  // 状态机
  // ======================================================================
  /** 当前使用会话（对应原版的 var_579 / var_244 / var_1442 这组全局量） */
  let SESSION = null;

  function newSession(it, eff) {
    return {
      eff, it, target: undefined, mirror: null, cancelled: false,
      preDone: false, tagPicked: false, phase: 'target', ink: 0,
    };
  }

  function endTurn(g) { if (g && g.endTurn) g.endTurn(); }

  /** 收尾：END.NONE / END.TURN / END.TURN_WEIGHT（`silent` = 无提示的 END.TURN_WEIGHT） */
  function done(g, st, r) {
    const res = r || {};
    const end = res.end || 'turnWeight';
    if (end === 'turnWeight' || end === 'silent') { weight(g); endTurn(g); }
    else if (end === 'turn') { endTurn(g); }
    SESSION = null;
    const out = Object.assign({ ok: end !== 'none', effect: st.eff, end }, res);
    return out;
  }

  /** 推进到下一个需要动作的阶段 */
  function advance(g, st) {
    const spec = SPECS[st.eff];
    if (!spec) { SESSION = null; return { ok: false, reason: 'unknown-effect' }; }

    // 0) 世界地图静默返回
    if (spec.world && onWorld(g)) return done(g, st, { end: 'silent' });

    // 1) 前置门槛
    if (spec.preCheck) {
      const r0 = spec.preCheck(g, st.it, st);
      if (r0) return done(g, st, r0);
    }

    // 2) 前置 UI（150 选镜子）
    if (spec.pre && !st.preDone) {
      st.preDone = true;
      const r1 = spec.pre(g, st);
      if (r1 && r1.request) { st.phase = 'pre'; return r1; }
    }

    // 3) 目标选择（邻格箭头）
    //    noTarget：对使用者自己直接生效的效果（13 火把 / 39 哨子 / 11 存钱罐 /
    //    24 地雷…），源码里这些分支前没有「谁使用？」的选人步骤。
    if (spec.noTarget && st.target === undefined) st.target = g.player;
    if (st.target === undefined) {
      return {
        ok: false, effect: st.eff, reason: 'need-direction', neighbor: true,
        allowSelf: true, prompt: (spec.name || ''),
      };
    }

    // 4) 目标替换（72：坐骑）
    if (spec.preTarget) {
      const t2 = spec.preTarget(g, st.target, st);
      if (t2 !== undefined) st.target = t2;
    }

    // 5) タッグ
    if (spec.tag === 'reject' && st.target && G(st.target, 168) !== 0) {
      g.log(spec.tagReject || 'タッグ不能作为对象。');
      return done(g, st, { end: 'none' });
    }
    if (spec.tag === 'pick' && st.target && G(st.target, 168) !== 0 && !st.tagPicked) {
      const partner = (Elona.Companion && Elona.Companion.tagPartner)
        ? Elona.Companion.tagPartner(st.target) : null;
      return {
        ok: false, effect: st.eff, reason: 'tag-pick',
        options: [
          { label: nm(st.target), chara: st.target },
          { label: partner ? nm(partner) : '（没有搭档）', chara: partner || st.target },
        ],
      };
    }

    // 6) 没选到目标
    if (!st.target) {
      if (spec.empty === 'silent') return done(g, st, { end: 'turnWeight' });
      g.log('那是办不到的。');
      return done(g, st, { end: spec.empty === 'none' ? 'none' : 'turnWeight' });
    }

    // 7) 本体
    const r = spec.run(g, st) || {};
    if (r.request) { st.phase = 'body'; return r; }
    if (r.end === undefined) r.end = spec.success || 'turnWeight';
    return done(g, st, r);
  }

  const ItemFxUse = {
    SPECS,
    /** 该效果是否由本模块处理 */
    handles(eff) { return !!SPECS[eff | 0]; },
    ids() { return Object.keys(SPECS).map(Number); },

    /**
     * 入口 —— 与 `Elona.ItemFx.dispatch` 同签名。
     * @param {object} g 游戏
     * @param {object} it 物品实例
     * @param {object} [opts] { target: undefined 未选 / null 邻格没人 / Chara 目标 }
     */
    dispatch(g, it, opts) {
      const eff = (it && it.f) ? (it.f[19] | 0) : 0;
      const spec = SPECS[eff];
      if (!spec) return null;
      const o = opts || {};
      // 会话复用规则：
      //   · 同一次「使用」的后续调用都带 `target`（DirSel 结算）或 `resume`
      //     → 复用会话（保留 150 已选的镜子、已确定的 tagPicked 等）
      //   · 从背包/地面重新使用（既没有 target 也没有 resume）→ 一律开新会话，
      //     这样上一次中途取消留下的残状态不会污染这次。
      const cont = (o.target !== undefined) || !!o.resume;
      if (!SESSION || SESSION.it !== it || SESSION.eff !== eff || !cont) {
        SESSION = newSession(it, eff);
      }
      if (o.target !== undefined) SESSION.target = o.target;
      return advance(g, SESSION);
    },

    /** タッグ二选一的回调 */
    resolveTag(g, chara) {
      const st = SESSION;
      if (!st) return { ok: false, reason: 'no-pending' };
      st.target = chara || null;
      st.tagPicked = true;
      return advance(g, st);
    },

    /** UI 请求（输入文本 / 确认 / 选部位 / 选元素 / 选镜子）的回调 */
    resolve(g, value) {
      const st = SESSION;
      if (!st) return { ok: false, reason: 'no-pending' };
      const spec = SPECS[st.eff];
      if (!spec) { SESSION = null; return { ok: false, reason: 'unknown-effect' }; }
      if (st.phase === 'pre') {
        if (spec.onPre) spec.onPre(g, st, value);
        if (st.cancelled) {
          g.log('还是算了。');
          return done(g, st, { end: 'turnWeight' });
        }
        st.phase = 'target';
        return advance(g, st);
      }
      const r = spec.resolve ? (spec.resolve(g, st, value) || {}) : { end: 'turnWeight' };
      if (r.request) { st.phase = 'body'; return r; }
      if (r.end === undefined) r.end = spec.success || 'turnWeight';
      return done(g, st, r);
    },

    /** 取消时清掉会话 */
    abort() { SESSION = null; },
    /** 当前会话（测试 / 调试用） */
    session() { return SESSION; },

    /** 供 UI 取「这个效果的提示语」 */
    promptOf(eff) {
      const s = SPECS[eff | 0];
      return s ? `${s.name}：对谁使用？` : '对谁使用？';
    },
  };

  Elona.ItemFxUse = ItemFxUse;
})(typeof window !== 'undefined' ? window : globalThis);
