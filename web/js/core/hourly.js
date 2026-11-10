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
    // 603538-603545：正午的地图类型 3 事件
    if (V(g, 13) === 12 && (g.map && g.map.header && (g.map.header[6] | 0) === 3)) {
      if (V(g, 126 + 33) === 2) { S(g, 126 + 33, 3); out.noon = true; }
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

  /** 603560-603612：跨日 —— 心情重置与日记提示（其余结算由 Daily / Journal 承担） */
  function newDay(g) {
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
    return out;
  }

  Elona.Hourly = { sleepiness, notices, newDay, journalStale, SLEEPY, NAP, GUIDE_FLAG, isWorld };
})(window);
