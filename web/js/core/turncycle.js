'use strict';
/**
 * 回合循环分派（core/turncycle.js）—— 0-GO
 *
 * 【源码依据 hsp/start.hsp】603956-604166（*label_4354 / *label_4355）
 *   docs/08 的第 0 节曾把 603956-604166 记为 211 行的最大连续无记录段，
 *   本模块逐段对应：回合开始 603956-603960、周期成长 603961-604020、
 *   归航倒计时 604021-604166；升级子程 604840-604860 由 game.js 承担。
 *
 *   603956-603960  *label_4354 开头：var_58(37,idx) = var_58(39,idx)（速度修正复位）、
 *                  var_58(26,idx)++（该角色回合计数）、gosub *label_4357
 *   604840-604860  *label_4357：var_58(79) -= 100（经验残留）、以太病地图下
 *                  var_58(259)=25、经验够则 gosub *label_2145 升级
 *   603961-604020  玩家（var_124==0）的周期成长：
 *                  var_400 = var_58(26,0) \ 10  →  1 / 2 / 3 三档，
 *                  分别调 *label_2159 / 2160 / 2164 / 2165 / 2162 / 2163，
 *                  末尾再对全体做每 4 回合的 healsp 2
 *   211959-212171  *label_2159..2165 的技能经验规则（HP/MP/负重/饥饿/骑乘）
 *   604021-604166  *label_4355：var_65(63) 归航 / 船出倒计时，逐条阻止判定，
 *                  成功则 gosub *label_2104 → var_1777=2 → goto *label_2459 进图
 *
 * 【项目侧近似】
 *   · 升级（*label_2145）已由 Game.endTurn 的 Stats.checkLevelUp 承担，这里只登记
 *     不重复调用；var_58(79) 的经验残留按 status 字段递减。
 *   · *label_2846 的犯罪检查读项目侧 g.crimeFlags（原版读 var_434 的城镇事件表），
 *     缺省 0，见 docs/02。
 *   · 归航成功不直接 goto *label_2459，而是返回 {travel:true, destination} 由
 *     Game.endTurn 调用 loadMap，避免重入 endTurn。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const idiv = (a, b) => Math.trunc((a | 0) / (b || 1));
  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);
  const SET = (c, n, v) => { if (c && typeof c.set === 'function') c.set(n, v | 0); };
  const V = (g, n) => (g && typeof g.getV65 === 'function' ? (g.getV65(n) | 0) : 0);
  const S = (g, n, v) => { if (g && typeof g.setV65 === 'function') g.setV65(n, v | 0); };

  function rnd(g) {
    const o = (g && g.rng) ? g.rng : (Elona.rng || null);
    return (n) => (o && typeof o.rnd === 'function') ? o.rnd(Math.max(1, n | 0)) : 0;
  }
  function active(c) { return !!c && G(c, 0) === 1; }
  function mapType(g) {
    try { return (g.map && g.map.header) ? (g.map.header[6] | 0) : 0; } catch (e) { return 0; }
  }
  function healsp(g, c, n) {
    if (Elona.Status && Elona.Status.healsp) { Elona.Status.healsp(c, n | 0); return; }
    const max = G(c, 53) || (c && c.spMax) || 0;
    c.sp = Math.min(((c && c.sp) | 0) + (n | 0), max);
  }
  function skillexp(g, c, id, exp, div, teacher) {
    if (!Elona.Stats || !Elona.Stats.skillExp) return 0;
    try { return Elona.Stats.skillExp(c, id, c, exp, div || 0, teacher || 0, g) | 0; }
    catch (e) { return 0; }
  }
  function findbuff(g, c, id) {
    if (Elona.Status && Elona.Status.findbuff) {
      try { return Elona.Status.findbuff(c, id | 0); } catch (e) { return -1; }
    }
    return -1;
  }
  function cbit(g, c, bit) {
    if (Elona.Status && Elona.Status.cbit) {
      try { return Elona.Status.cbit(c, bit | 0) | 0; } catch (e) { return 0; }
    }
    return 0;
  }
  /** 原版 var_82(技能, 角色)：项目用角色技能值作近似 */
  function sk(g, c, id) {
    if (c && typeof c.skill === 'function') return c.skill(id | 0) | 0;
    return 0;
  }

  // =========================================================================
  // 一、*label_2159..2165 的技能经验规则（211959-212171）
  // =========================================================================
  const WORLD_RARE = (g, denom) => mapType(g) !== 1 || rnd(g)(denom) === 0;

  const GROWTH = {
    // 212088-212099：HP / MP 未满时练 154 / 155，上限分别是 var_82(11) / var_82(16)
    2159(g, c, out) {
      if (G(c, 50) !== G(c, 51) && sk(g, c, 154) < sk(g, c, 11)) {
        skillexp(g, c, 154, 5 + sk(g, c, 154), 1000, 0);
        out.skills.push(154);
      }
      if (G(c, 55) !== G(c, 56) && sk(g, c, 155) < sk(g, c, 16)) {
        skillexp(g, c, 155, 5 + sk(g, c, 155), 1000, 0);
        out.skills.push(155);
      }
    },
    // 212100-212107：世界地图上 1/20 才生效，练 157（魔道具 / 探索）
    2160(g, c, out) {
      if (!WORLD_RARE(g, 20)) return;
      skillexp(g, c, 157, 2, 0, 1000);
      out.skills.push(157);
    },
    // 212113-212123：负重档非 0 时练 153（负重）
    2162(g, c, out) {
      if (G(g.player, 45) === 0) return;
      if (!WORLD_RARE(g, 20)) return;
      skillexp(g, c, 153, 4, 0, 1000);
      out.skills.push(153);
    },
    // 212124-212137：以太病进度 1..30 时练 190
    2163(g, c, out) {
      const v = G(c, 259);
      if (v === 0 || v > 30) return;
      if (!WORLD_RARE(g, 10)) return;
      skillexp(g, c, 190, 4, 0, 1000);
      out.skills.push(190);
    },
    // 212138-212153：按 var_58(64)（饱腹度）分三档练 169 / 170 / 171
    2164(g, c, out) {
      if (!WORLD_RARE(g, 20)) return;
      const v = G(c, 64);
      const id = v >= 35000 ? 169 : (v >= 15000 ? 170 : 171);
      skillexp(g, c, id, 20, 0, 1000);
      out.skills.push(id);
    },
    // 212154-212171：坐骑 / 被骑乘时练 301（骑乘）
    2165(g, c, out) {
      if (!WORLD_RARE(g, 20)) return;
      const rider = V(g, 183);
      if (rider !== 0 && (c.index | 0) === 0) {
        skillexp(g, c, 301, 4, 0, 1000); out.skills.push(301);
      }
      if ((c.index | 0) === rider) {
        skillexp(g, c, 301, 4, 0, 1000); out.skills.push(301);
        if (G(c, 196) === 1) { skillexp(g, c, 301, 4, 0, 1000); out.skills.push(301); }
      }
    },
  };

  // =========================================================================
  // 二、*label_4354 的回合开始（603956-603960 + 604840-604860）
  // =========================================================================
  function beginAction(g, idx) {
    const i = idx | 0;
    const c = (g && g.charas) ? g.charas[i] : ((i === 0 && g) ? g.player : null);
    if (!active(c)) return { ok: false, reason: 'inactive', idx: i };
    SET(c, 37, G(c, 39));                          // 603958 速度修正复位
    SET(c, 26, G(c, 26) + 1);                     // 603959 回合计数
    // 604841-604844：var_58(79) 每回合 -100，下限 0
    SET(c, 79, Math.max(0, G(c, 79) - 100));
    // 604845-604849：以太风地图且以太等级 >=3 → var_58(259)=25
    if (mapType(g) === 2 && V(g, 17) >= 3) SET(c, 259, 25);
    return { ok: true, idx: i, turns: G(c, 26), speedMod: G(c, 37), expLeft: G(c, 79) };
  }

  // =========================================================================
  // 三、玩家每 10 回合的周期成长（603961-604020）
  // =========================================================================
  function playerPeriodic(g) {
    const p = g && g.player;
    const out = { ok: true, phase: 0, skills: [], healed: [], counts: { p1: 0, p2: 0, p3: 0, p4: 0 } };
    if (!active(p)) return out;
    const list = (g.charas && g.charas.length) ? g.charas : [p];
    const phase = idiv(G(p, 26), 10);
    out.phase = phase;
    const each = (max, fn) => {
      const n = Math.min(max, list.length);
      for (let i = 0; i < n; i++) if (active(list[i])) fn(list[i], i);
    };
    if (phase === 1) {
      // 603966-603977：前 16 号练 2159；var_58(446)>=10000 额外 healsp 5
      each(16, (c) => {
        GROWTH[2159](g, c, out);
        if (G(c, 446) >= 10000) { healsp(g, c, 5); out.healed.push([c.index | 0, 5]); }
        out.counts.p1++;
      });
    } else if (phase === 2) {
      // 603978-603999：全体 245，buff 3 时 healsp 4；前 16 号练 2160/2164/2165
      each(245, (c, i) => {
        if (findbuff(g, c, 3) !== -1 && G(c, 140) === 0) {
          healsp(g, c, 4); out.healed.push([c.index | 0, 4]);
        }
        if (i < 16) {
          GROWTH[2160](g, c, out);
          GROWTH[2164](g, c, out);
          if (V(g, 183) !== 0) GROWTH[2165](g, c, out);
        }
        out.counts.p2++;
      });
    } else if (phase === 3) {
      // 604000-604010：前 16 号练 2162 / 2163
      each(16, (c) => {
        GROWTH[2162](g, c, out);
        GROWTH[2163](g, c, out);
        out.counts.p3++;
      });
    }
    // 604011-604020：全体每 4 回合、不在持续动作中 → healsp 2。
    //   源码字面是 `var_58(26,cnt) \ 4 == 0`（整除为 0），与 603965 的
    //   `\ 10` 分档口径一致但只在计数 <4 时成立，项目按「每 4 回合」取模近似。
    each(245, (c) => {
      if (G(c, 26) % 4 === 0 && G(c, 140) === 0) {
        healsp(g, c, 2); out.healed.push([c.index | 0, 2]);
      }
      out.counts.p4++;
    });
    return out;
  }

  // =========================================================================
  // 四、*label_4355 归航 / 船出倒计时（604021-604166）
  // =========================================================================
  const MSG = {
    blockReturn: { jp: '不思議な力が帰還を阻止した。', en: 'Strange power prevents you from returning.' },
    blockSail: { jp: '不思議な力が船出を阻止した。', en: 'Strange power prevents you from sailing.' },
    allyReturn: { jp: '今は帰還できない仲間を連れている。', en: 'One of your allies prevents you from returning.' },
    allySail: { jp: '今は船出できない仲間を連れている。', en: 'One of your allies prevents you from sailing.' },
    overweight: { jp: 'どこからか声が聞こえた。「悪いが重量オーバーだ」', en: 'Someone shouts, "Sorry, overweight."' },
    nothing: { jp: '何もおきない…', en: 'Nothing happens...' },
    crime: { jp: 'あなたは法を犯した。', en: 'You commit a crime.' },
    door: { jp: 'あなたは次元の扉を開けた。', en: 'A dimensional door opens in front of you.' },
    ship: { jp: 'あなたの船が到着した。', en: 'Your ship has arrived.' },
    duel: { jp: 'だが決闘の呪いからは逃げられない！', en: 'You can not run away from the duel!' },
    cargoReturn: { jp: 'だが荷車が重すぎて帰還できなかった。', en: 'Return can not be too heavy Cargo.' },
    cargoSail: { jp: 'だが荷車が重すぎて乗船できなかった。', en: 'Sailing can not be too heavy Cargo.' },
    time: { jp: '気まぐれな時の管理者により次元は歪められた！', en: 'The capricious controller of time has changed your destination!' },
  };
  function msg(g, key) {
    const m = MSG[key] || { jp: '', en: '' };
    const line = (g && g.lang === 'jp') ? m.jp : m.en;
    if (g && typeof g.log === 'function') g.log(line);
    return line;
  }
  function blocked(g, reason, key) {
    const r = { ok: true, ticked: true, blocked: true, reason, travel: false, message: msg(g, key) };
    S(g, 63, 0);                                     // 604028：倒计时归零
    return r;
  }

  function worldReturn(g) {
    if (!g || typeof g.getV65 !== 'function') return { ok: false, reason: 'no-game' };
    let left = V(g, 63);
    if (left === 0) return { ok: true, idle: true, ticked: false, blocked: false, travel: false };
    left -= 1;                                      // 604026
    S(g, 63, left);
    const onShip = V(g, 697) !== 0;                 // var_65(250+447)
    const map = V(g, 20), depth = V(g, 22);
    // 604027-604045：特定地图禁止归航 / 船出
    if (mapType(g) === 7 || map === 30 || map === 41 || (map === 74 && depth >= 10)) {
      const r = blocked(g, 'strange-power', onShip ? 'blockSail' : 'blockReturn');
      r.map = map;
      return r;
    }
    if (left > 0 || (g.var106 | 0) !== 0) {
      return { ok: true, ticked: true, blocked: false, travel: false, left };
    }
    // 604046-604057：携带 cbit(971) 且非 817 的同伴时无法离开
    const list = g.charas || [];
    let ally = 0;
    for (let i = 1; i < Math.min(16, list.length); i++) {
      const c = list[i];
      if (!active(c)) continue;
      if (cbit(g, c, 971) === 1 && G(c, 27) !== 817) { ally = 1; break; }
    }
    if (ally) return blocked(g, 'ally', onShip ? 'allySail' : 'allyReturn');
    // 604076-604083：超重
    const p = g.player;
    if ((g.var17 | 0) === 0 && G(p, 45) >= 4) return blocked(g, 'overweight', 'overweight');
    // 604084-604093：目的地就是当前地图 → 什么也不发生
    if (V(g, 64) === V(g, 850) && map === V(g, 850)) return blocked(g, 'same-map', 'nothing');
    const out = { ok: true, ticked: true, blocked: false, travel: true, karma: 0, messages: [] };
    // 604094-604103：*label_2846 的犯罪检查 → 业值 -10
    const crime = (g.crimeFlags | 0) || (Elona.Crime && Elona.Crime.pending
      ? (Elona.Crime.pending(g) | 0) : 0);
    if (crime) {
      out.messages.push(msg(g, 'crime'));
      if (typeof g.modkarma === 'function') g.modkarma(-10);
      else if (p && typeof p.set === 'function') p.set(49, G(p, 49) - 10);
      out.karma = -10;
      out.crime = true;
    }
    // 604104-604119：开门 / 船到
    out.messages.push(msg(g, onShip ? 'ship' : 'door'));
    // 604120-604127：决斗诅咒
    if (V(g, 556) > 0) return blocked(g, 'duel', 'duel');
    // 604129-604146：货物超重
    if (V(g, 80) > V(g, 82)) return blocked(g, 'cargo', onShip ? 'cargoSail' : 'cargoReturn');
    // 604147-604153：目的地 41 的时空歪曲
    if (V(g, 64) === 41) out.messages.push(msg(g, 'time'));
    // 604154-604158：船到 → 目的地改 47
    if (onShip) {
      g.var1856 = V(g, 850);
      S(g, 850, 47);
      g.var1832 = 1;
    }
    // 604159-604162：msg_halt → *label_2104 → var_1777=2 → *label_2459
    g.var1777 = 2;
    out.destination = g.returnMap || 'vernis';
    out.left = 0;
    return out;
  }

  /** 启动归航 / 船出倒计时（项目侧入口，供归还卷轴 / 世界地图调用） */
  function startReturn(g, turns, destination) {
    const t = Math.max(1, (turns === undefined ? 3 : turns) | 0);
    S(g, 63, t);
    if (destination !== undefined) S(g, 64, destination | 0);
    return { ok: true, turns: t, destination: V(g, 64) };
  }

  Elona.TurnCycle = {
    GROWTH, MSG, beginAction, playerPeriodic, worldReturn, startReturn,
    mapType, healsp, skillexp,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.TurnCycle;
})(typeof window !== 'undefined' ? window : global);
