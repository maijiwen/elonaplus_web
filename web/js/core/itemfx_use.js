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
        if ((e0 % 10000) === 4) continue;
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
      try { Elona.Battle.applyDamage(c, G(c, 51), g, g.player, 658, 0); } catch (e) { c.hp = 0; }
    } else {
      c.hp = 0;
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
  const SPECS = {
    5: { name: '听诊器', tag: 'pick', empty: 'none', success: 'turn', run: eff5 },
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
