'use strict';
/**
 * 整点作息与提示（core/hourly.js）—— 0-GS
 *
 * 【源码依据 hsp/start.hsp】 603444-603612（小时推进的尾部，紧随天气块）
 *
 *   603448-603477  var_65(90)「眠気」累加：
 *                    · 世界地图（var_126(6)==1）每 3 小时 +1；每 15 小时判定一次，
 *                      若已 >= 13 则「仮眠をとった。」-3（不低于 0），
 *                      否则「眠気を我慢した。」并消耗一次 var_65(250+384)
 *                    · 地图内：地图 30 不加；否则 +1，并在 var_97(228) 为真时
 *                      于 10..17 点、否则于 20..3 点额外 +1
 *   603496-603503  6 点「夜が明けた。」
 *   603504-603520  困意 >= 13 且未提示过 → 教程提示 %9（`*label_4317` → exhelp.txt）
 *   603521-603537  饱腹 < 5000 且未提示过 → 教程提示 %10
 *   603538-603545  正午（13==12）+ 地图类型 3 + var_126(33)==2 → 转 3 并走随机事件
 *   603546-603559  日记更新提示：var_65(250+312) 为偶数且日期已跨过存储日期 → ++ 并提示
 *   603560-603612  跨日：「一日が終わり、日付が変わった。」+ 心情重置 + 日记提示
 *
 * 【差异登记】
 *   A501  `var_97(228)`（未在其他地方出现的标志槽）按 0 处理，即走「深夜 / 清晨 +1」分支；
 *         若宿主注入 `g.v97(228)` 则用它。
 *   A502  `var_1086`（提示窗口的总开关）按「开启」处理；`var_577`（调试 / 自动化模式）
 *         与 `var_58(141, 0)`（正在睡觉）照抄为「不提示」。
 *   A503  `*label_4317` 的窗口绘制不移植，改为 `Elona.IdleTalk.guide(g, '9'/'10')`
 *         取 exhelp.txt 的对应段落，交给界面层显示；本模块只给出编号。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);
  const V = (g, n) => (g && typeof g.getV65 === 'function' ? (g.getV65(n) | 0) : 0);
  const S = (g, n, v) => { if (g && typeof g.setV65 === 'function') g.setV65(n, v | 0); };
  function rndOf(g) {
    const o = (g && g.rng) ? g.rng : (Elona.rng || null);
    return (n) => (o && typeof o.rnd === 'function') ? o.rnd(Math.max(1, n | 0)) : 0;
  }
  function isWorld(g) {
    if (g && typeof g.worldMap === 'boolean') return g.worldMap;
    if (Elona.Actions && Elona.Actions.onWorldMap) return !!Elona.Actions.onWorldMap(g);
    return !!(g && g.map && g.map.header && (g.map.header[6] | 0) === 1);
  }
  const SLEEPY = 90;            // var_65(90) 眠気
  const NAP = 250 + 384;        // var_65(250+384) 我慢できる回数
  const GUIDE_FLAG = (n) => 200 + n;   // var_65(200+n) 一次性提示位

  /** 603448-603495：整点的眠気累加与「仮眠 / 我慢」 */
  function sleepiness(g, opts) {
    const out = { delta: 0, messages: [], napped: false, endured: false };
    if (!g) return out;
    const R = rndOf(g);
    const add = (n) => { S(g, SLEEPY, V(g, SLEEPY) + n); out.delta += n; };
    if (isWorld(g)) {
      // 603449-603451：每 3 小时 +1
      if (R(3) === 0) add(1);
      // 603452-603476：每 15 小时一次判定
      if (R(15) === 0 && V(g, SLEEPY) >= 13 && V(g, 577) === 0) {
        if (V(g, NAP) <= 0) {
          out.messages.push('你打了个盹。');
          S(g, SLEEPY, Math.max(0, V(g, SLEEPY) - 3));
          out.napped = true;
        } else {
          out.messages.push('你忍住了睡意。');
          S(g, NAP, V(g, NAP) - 1);
          out.endured = true;
        }
      }
      return out;
    }
    // 603478-603495：地图内
    if (V(g, 20) === 30) return out;                       // 地图 30 不累加
    add(1);
    const hour = V(g, 13);
    const flag228 = (g.v97 && typeof g.v97 === 'function') ? (g.v97(228) | 0) : 0;
    if (flag228 !== 0) {
      if (hour >= 10 && hour <= 17) add(1);                // 白天犯困
    } else {
      if (hour >= 20) add(1);                              // 夜里
      if (hour <= 3) add(1);                               // 凌晨
    }
    return out;
  }

  /** 603496-603559：天亮 / 困意与饥饿的一次性提示 / 正午事件 / 日记提示 */
  function notices(g) {
    const out = { messages: [], guides: [] };
    if (!g) return out;
    const p = g.player;
    // 603496-603503：6 点天亮
    if (V(g, 13) === 6) out.messages.push('天亮了。');
    // 603504-603520：困意提示（%9）
    if (V(g, SLEEPY) >= 13 && V(g, GUIDE_FLAG(9)) === 0 && V(g, 577) === 0
        && G(p, 141) === 0) {
      S(g, GUIDE_FLAG(9), 1);
      S(g, 1087, 9);
      out.guides.push(9);
    }
    // 603521-603537：饥饿提示（%10）
    if (G(p, 22) < 5000 && V(g, GUIDE_FLAG(10)) === 0 && V(g, 577) === 0
        && G(p, 141) === 0) {
      S(g, GUIDE_FLAG(10), 1);
      S(g, 1087, 10);
      out.guides.push(10);
    }
    // 603538-603545：正午的地图类型 3 事件（var_126(33) 由 2 → 3，
    //   随后同一小时的 RandomEvent 依 273258-273262 选取事件 31）
    if (V(g, 13) === 12 && (g.map && g.map.header && (g.map.header[6] | 0) === 3)) {
      const RV = Elona.RandomEvent;
      if (RV && RV.mapVar && RV.setMapVar) {
        const slot = (RV.MAP_SLOT && RV.MAP_SLOT.RITUAL) || 33;
        if ((RV.mapVar(g, slot) | 0) === 2) { RV.setMapVar(g, slot, 3); out.noon = true; }
      }
    }
    // 603546-603559：日记更新提示
    if (V(g, 250 + 312) >= 1 && (V(g, 250 + 312) % 2) === 0 && journalStale(g)) {
      S(g, 250 + 312, V(g, 250 + 312) + 1);
      out.messages.push('日记更新了。');
    }
    return out;
  }

  /** 603548 的日期比较：距上次日记已过一天以上 */
  function journalStale(g) {
    const y = V(g, 10), m = V(g, 11), d = V(g, 12);
    const sy = V(g, 250 + 313), sd = V(g, 250 + 314), sm = V(g, 250 + 315);
    if (y > sy) return true;
    if (sm !== 12 && m === sm + 1) return true;
    if (sm === 12 && m === 1) return true;
    if (m === sm && d > sd) return true;
    return false;
  }

  /**
   * 603686-603751 / 603773-603911：每日与月/年切换的遗漏结算（A-R3-04）。
   * 逐条对应源码，已由 game.js 承担的部分（823++、505/514、月替公会）不重复。
   */
  function newDayExtra(g, opts) {
    const out = { messages: [] };
    if (!g) return out;
    const p = g.player;
    const R = rndOf(g);
    const mapId = V(g, 20), depth = V(g, 22);

    // 603560-603568：睡眠债 var_65(814)
    if (V(g, 814) < 0) S(g, 814, 0);
    if (V(g, 814) < 3 && R(8 + V(g, 814) * 5) === 0) S(g, 814, V(g, 814) + 1);

    // 603686-603697：每日旗标
    S(g, 250 + 295, R(10) === 0 ? 0 : 1);                    // 10% → 0，否则 1
    if (V(g, 250 + 326) === 200) S(g, 250 + 326, 100);
    if (mapId !== 87 || depth === 1) S(g, 250 + 330, 0);

    // 603698-603751：侦探事件（城镇 var_126(6)==3）
    detective(g, out, R);

    // 603773-603779：月切 —— var_65(816)=0，偶数月 var_65(250+10)++
    if (opts && opts.newMonth) {
      S(g, 816, 0);
      if ((V(g, 11) % 2) === 0) S(g, 250 + 10, V(g, 250 + 10) + 1);
    }
    // 603785-603796：年切 —— 825=0、95--、851-=50
    if (opts && opts.newYear) {
      S(g, 825, 0);
      S(g, 95, Math.max(0, Math.min(3, V(g, 95) - 1)));
      S(g, 851, Math.max(0, Math.min(99, V(g, 851) - 50)));
    }
    // 603787-603796：日期相关旗标
    const day = V(g, 12), month = V(g, 11);
    if (day === 10 || day === 20) S(g, 250 + 304, 100);
    if (month === 11 && day === 1) S(g, 250 + 299, 0);
    // 603801-603806：1/15 日整店补货（项目在进店时重生成库存，这里只保留旗标）
    if (day === 1 || day === 15) S(g, 250 + 307, -1);
    // 603807-603811：日记推进
    if ((V(g, 250 + 377) % 3) === 1 && day === 30) {
      S(g, 250 + 377, V(g, 250 + 377) + 1);
      out.messages.push('日记更新了。');
    }

    // 603812-603911：剧情事件
    storyEvents(g, out, R);

    // 246244-246245（A-R3-06）：真实生日的 evadd 69
    birthday(g, out);
    return out;
  }

  /** 603698-603751：城镇的侦探事件（NPC 696/697） */
  function detective(g, out, R) {
    if (!(g.map && g.map.header && (g.map.header[6] | 0) === 3)) return;
    let v2080 = 0, v2843 = 0;
    for (const c of (g.charas || [])) {
      if (!c || typeof c.get !== 'function') continue;
      const sp = c.get(27) | 0;
      const alive = (c.get(0) | 0) === 1 && (c.get(58) | 0) !== 100;
      if (sp === 666 || sp === 697) {
        if (alive && (c.get(69) | 0) === 0) v2080 = 10;
      }
      if (sp === 696 || sp === 697) {
        if (alive) { v2843++; c.set(151, 0); }
      }
      if (sp === 1125 || sp === 1126) {
        if (alive) {
          if (Elona.RandomEvent && Elona.RandomEvent.setMapVar) {
            Elona.RandomEvent.setMapVar(g, 34, 0);
          }
          v2080 = 0;
          break;
        }
      }
    }
    if (v2080 !== 10) return;
    if (v2843 < 2 && g.player && Elona.CharaFactory && Elona.CharaFactory.create) {
      out.messages.push('……你在意着某个人的身影。');
      const species = R(3) === 0 ? 697 : 696;
      const level = (Elona.ItemDB && Elona.ItemDB.calcObjLv)
        ? (Elona.ItemDB.calcObjLv(0, g) | 0) : Math.max(1, V(g, 22));
      const c = Elona.CharaFactory.create(g, species, level, g.player.x | 0, g.player.y | 0);
      if (c) c.set(86, R(15));
    }
    if (Elona.RandomEvent && Elona.RandomEvent.tickHour) Elona.RandomEvent.tickHour(g);
  }

  /** 603812-603911：ラシエル / ガルジエム / アムルダード / 日记 */
  function storyEvents(g, out, R) {
    const mapId = V(g, 20);
    const site16 = (Elona.Sites && Elona.Sites.field) ? (Elona.Sites.field(16, mapId, g) | 0) : 0;

    // 603812-603843：ラシエル（NPC 56）—— 原版生成临时 NPC 校验后记录 var_65(250+358)，
    //   这里直接取一只同等级怪物的物种编号作为「变身结果」。
    if (V(g, 250 + 357) !== 0) {
      const s358 = V(g, 250 + 358) !== 0;
      // HSP 的 `&` / `|` 不做短路，两个 rnd 都会被消耗
      const a = R(20) === 0, b = R(2) === 0;
      if ((s358 && a) || (!s358 && b)) {
        if (Elona.CharaFactory && Elona.CharaFactory.pick) {
          const sp = Elona.CharaFactory.pick(g, 170) | 0;
          if (sp) S(g, 250 + 358, sp);
        }
        out.messages.push('拉西尔的念头似乎改变了。');
      }
    }
    // 603845-603870：ガルジエム救援
    {
      const v = V(g, 250 + 274);
      if (v >= 10 && (v % 10) === 0 && site16 !== 80 && R(10) === 0) {
        let nv = v;
        if (nv >= 900) nv = 10;
        S(g, 250 + 274, nv + 1);
        out.messages.push('接到了来自加尔杰姆的救援请求。');
      }
    }
    // 603871-603896：アムルダード
    {
      const v = V(g, 250 + 440);
      if (v >= 10 && (v % 10) === 0 && mapId !== 74 && R(10) === 0) {
        let nv = v;
        if (nv < 100) nv = 10;
        if (nv >= 900) nv = 100;
        S(g, 250 + 440, nv + 1);
        out.messages.push('收到了来自涅赫尔塔德的委托电波。');
      }
    }
    // 603898-603911：var_65(250+203) 奇数时的日志推进
    {
      const v = V(g, 250 + 203);
      if ((v === 1 || v === 3 || v === 5 || v === 7 || v === 9)
          && site16 !== 33 && R(20) === 0) {
        S(g, 250 + 203, v + 1);
        out.messages.push('日记更新了。');
      }
    }
  }

  /**
   * 246244-246245：真实生日 → `evadd 69`。
   * 事件本体 607700-607778：在脚下的 var_58(1/2,0) 生成礼物 1059，
   * 播报「今天生日」与「有东西滚到脚边」，并把 var_65(250+327) 置为来年。
   */
  function birthday(g, out) {
    const d = new Date();
    const ry = d.getFullYear(), rm = d.getMonth() + 1, rd = d.getDate();
    const bm = V(g, 250 + 322), bd = V(g, 250 + 323), by = V(g, 250 + 327);
    if (bm !== rm || bd !== rd) return;
    if (by > ry) return;
    if (g.player && Elona.ItemDB && Elona.ItemDB.createItem && g.groundItems) {
      const it = Elona.ItemDB.createItem(1059, 1);       // 607748：礼物
      if (it) {
        it.f[5] = g.player.x | 0;
        it.f[6] = g.player.y | 0;
        it.f[21] = -1;
        g.groundItems.push(it);
        if (g.refreshGroundCell) g.refreshGroundCell(it.f[5], it.f[6]);
        out.messages.push('有什么东西滚到了脚边。');
      }
    }
    out.messages.push('「哎呀，今天是你生日啊？恭喜！」');
    S(g, 250 + 327, ry + 1);                             // 607775
  }

  /** 603560-603612：跨日 —— 心情重置与日记提示（其余结算由 Daily / Journal 承担） */
  function newDay(g, opts) {
    const out = { messages: ['一天结束了，日期变了。'], mood: 0 };
    if (!g) return out;
    const p = g.player;
    const R = rndOf(g);
    // 603575-603580：心情累积（var_58(191/190) >= 1000 时 var_58(194)++）
    if (G(p, 191) >= 1000) { p.set(194, G(p, 194) + 1); out.mood++; }
    if (G(p, 190) >= 1000) { p.set(194, G(p, 194) + 1); out.mood++; }
    out.messages.push('日记更新了。');
    // 603588-603603：重掷 var_58(191/190) 的档位（1..8，避开上月同值）
    for (let n = 0; n < 10; n++) {
      const v = R(8) + 1;
      if (v !== Math.trunc(G(p, 191) / 1000)) { p.set(191, v); break; }
    }
    for (let n = 0; n < 10; n++) {
      const v = R(8) + 1;
      if (v !== Math.trunc(G(p, 190) / 1000)) { p.set(190, v); break; }
    }
    // 603605-603611：阈值推进与重置
    if (G(p, 194) >= G(p, 195)) { p.set(195, G(p, 195) + 10); out.dream = true; }
    if (G(p, 195) <= 0 || G(p, 195) >= 1010) { p.set(195, 10); p.set(194, 0); }
    // A-R3-04：跨日主线/剧情/日历结算
    const extra = newDayExtra(g, opts);
    for (const m of extra.messages) out.messages.push(m);
    return out;
  }

  Elona.Hourly = { sleepiness, notices, newDay, newDayExtra, journalStale, SLEEPY, NAP, GUIDE_FLAG, isWorld };
})(window);
