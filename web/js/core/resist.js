'use strict';
/**
 * 抗性与状态（异常状态）模块
 *
 * 【已确认 1】抗性判定 *label_2019 (start.hsp 行 196266-196275)：
 *   var_1094 = rnd(power/2 + 1) + power/2            ; 基础强度 = 一半固定 + 一半随机
 *   var_1096 = var_82(resistSkill, target) / 50      ; 抗性值 / 50
 *   var_1094 = var_1094 * 100 / (50 + var_1096 * 50) ; 抗性削减
 *   if (var_1096 >= 3 && var_1094 < 40) → 完全免疫
 *
 * 【已确认 2】resistmod(chara, skillId, delta) (行 195109 起)：
 *   修改抗性「潜力」：var_1081 = sorg(skillId, chara) + delta
 *   若 (sorg >= 300 且 delta >= 25) 或 sorg < 100 → 不生效（只显示"什么也没发生"）
 *   否则 clamp 到 [50, 300]，写回 var_82(skillId+600)
 *   注意：delta >= 50 / <= -50 的分支**只有提示文本**，不改变数值（已逐行确认）
 *
 * 【已确认 3】dmgcon(target, condId, power) (行 195725 起)：
 *   按 condId 分派 → 取抗性技能 var_1093 → gosub *label_2019 → 写入状态字段
 *   条件表由 tools/extract_dmgcon.py 机械提取到 data/tables/dmgcon.json（15 项）
 *
 * 【HSP 语义】`/` 为整数除法（向零截断）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /** 对应 sorg(id, chara)：潜力 = var_82(id+600) / 1000000 */
  function sorg(c, id) {
    const p = (c.potential && c.potential[id]) || 0;
    return idiv(p, 1000000);
  }
  /** 写回潜力，保留低位的经验/成长部分 */
  function setSorg(c, id, pot) {
    if (!c.potential) c.potential = {};
    const old = c.potential[id] || 0;
    c.potential[id] = pot * 1000000 + (old % 1000000);
    c.setSkill(id, pot);
  }

  /**
   * 抗性判定 —— *label_2019
   * @returns {Object} { power, immune }
   */
  function resistCheck(g, target, resistSkillId, power) {
    const rng = g.rng;
    let p = rng.rnd(idiv(power, 2) + 1) + idiv(power, 2);
    const r = idiv(target.skill(resistSkillId), 50);
    p = idiv(p * 100, 50 + r * 50);
    if (r >= 3 && p < 40) return { power: p, immune: true };
    return { power: p, immune: false };
  }

  /**
   * 修改抗性 —— resistmod（start.hsp 195109-195293）
   *
   * 逐行确认的差异（对照 resistmodh 195294-195478）：
   *   |              | resistmod        | resistmodh       |
   *   |--------------|------------------|------------------|
   *   | 无效条件      | (sorg>=300 && delta>=25) || sorg<100（相同）|
   *   | clamp        | v<50→50; v>=300→300 | v<50→50; v>=100→300 |
   *   | 成长消息阈值  | delta>=50（txtef 2） | delta>=25         |
   *   | 衰退消息阈值  | delta<=-50（txtef 8）| 相同              |
   *   消息分支**只有提示文本**，不改变数值（已逐行确认）。
   *   写回：var_82(ele+600) = limit(v,0,2000)*1000000 + sexp*1000 + sgrowth
   *   其后：snd 107 → 若 var_1082==0 animeload 15 → gosub *label_2174（刷新角色，
   *   由调用方 UI 层处理；本函数只返回结果）。
   *
   * 【已知偏差 A172】resistmodh 的 `v>=100 → 300` clamp 按反编译源码照抄；
   *   该写法使耐性食物一次跃升 3 级，与常规游戏体验不符，疑似反编译失真，
   *   但按「代码证据优先」原则仍照抄实现并在文档登记。
   *
   * @returns {Object} { changed, value, message }
   */
  function resistCore(c, skillId, delta, isH) {
    const cur = sorg(c, skillId);
    if ((cur >= 300 && delta >= 25) || cur < 100) {
      return { changed: false, value: cur, message: msgNone() };
    }
    // resistmodh（195294-195470）与 resistmod（195109）的差异：
    //   195295 `var_1081 = sorg(...)` —— **原版没有把 prm_942 加上去**（resistmod 是 `sorg + prm_939`）；
    //   随后 195307-195309 是 `if (var_1081 >= 100) var_1081 = 300;`，195470 直接写回 `var_1081`。
    //   因此照抄源码时：走完 195296 的放行条件后，成功分支一律把耐性写成 300，衰退（负 delta）也不生效。
    if (isH) {
      let v = cur;
      if (v < 50) v = 50;                       // 195304-195306
      if (v >= 100) v = 300;                    // 195307-195309
      setSorg(c, skillId, limit(v, 0, 2000));
      const dir = delta >= 25 ? 'up' : (delta <= -50 ? 'down' : null);
      return { changed: true, value: v, message: dir ? msgElem(skillId, dir, c) : null };
    }
    let v = cur + delta;
    if (v < 50) v = 50;
    if (v >= 300) v = 300;
    setSorg(c, skillId, limit(v, 0, 2000));
    const upAt = 50;
    const dir = delta >= upAt ? 'up' : (delta <= -50 ? 'down' : null);
    return { changed: true, value: v, message: dir ? msgElem(skillId, dir, c) : null };
  }

  function resistMod(c, skillId, delta) {
    return resistCore(c, skillId, delta, false);
  }

  /**
   * 修改抗性（食物/药水变体）—— resistmodh（start.hsp 195294-195478）
   * 与 resistmod 的差异见 resistCore 注释。
   */
  function resistModH(c, skillId, delta) {
    return resistCore(c, skillId, delta, true);
  }

  /**
   * 施加异常状态 —— dmgcon（start.hsp 195725-196265）
   *
   * 逐条件照抄。每个条件有自己的：
   *   · 前置完全免疫（cbit / findbuff / 精英(quality>3)或种族534 的等级抵抗 / 种族名）
   *   · 抗性技能（label_2019）与除数
   *   · 写入规则（仅在字段为 0 时写；毒/侵蚀/流血/醉酒/发狂/生病会累加）
   * 注意：前置判定为真时，源码仍会调用 label_2019 消耗随机数，之后才 return 0。
   *
   * @param {object} condTable data/tables/dmgcon.json（保留参数以兼容调用方）
   * @returns {number} 1 = 已施加, 0 = 被完全免疫/未生效
   */
  function dmgcon(g, condTable, target, condId, power) {
    if (!target || !target.get) return 0;
    const id = condId | 0;
    const pw = power | 0;
    const rnd = (n) => ((g && g.rng) ? g.rng.rnd(n) : 0);
    const V = (n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);
    const f = (n) => target.get(n) | 0;
    const st = (n, v) => target.set(n, v | 0);
    const cbit = (b) => ((Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(target, b) | 0) : 0);
    const hasBuff = (b) => ((Elona.Status && Elona.Status.findbuff)
      ? ((Elona.Status.findbuff(target, b) | 0) !== -1) : false);
    const log = (s) => { if (g && g.log) g.log(s); };
    const lv = () => (f(38) | 0);
    const elite = () => (f(25) > 3 || f(27) === 534);

    // 195726-195734：强度为 0 无效；剧情期（250+387）玩家免疫
    if (pw < 1) return 0;
    if (V(250 + 387) > 0 && (target.index | 0) === 0) return 0;

    /** 精英/创造物的等级抵抗；arg 为 2 / 4 / 0.25（38/4） */
    const eliteRoll = (arg) => {
      if (!elite()) return false;
      const n = (arg === 0.25) ? (idiv(lv(), 4) + 1) : (lv() * arg + 1);
      return rnd(n) !== 0;
    };
    /** *label_2019：返回削减后的强度（0 = 抗性完全免疫） */
    const roll = (skill) => {
      let p = rnd(idiv(pw, 2) + 1) + idiv(pw, 2);
      const r = idiv(target.skill ? (target.skill(skill) | 0) : 0, 50);
      p = idiv(p * 100, 50 + r * 50);
      return (r >= 3 && p < 40) ? 0 : p;
    };

    // ---- 4 盲目（195735-195768）----
    if (id === 4) {
      let bad = false;
      if (cbit(9)) bad = true;
      if (hasBuff(55)) bad = true;
      if (eliteRoll(2)) bad = true;
      const p = roll(53);
      if (bad || p === 0) return 0;
      const v = idiv(p, 10);
      if (v > 0 && f(253) === 0) st(253, v);
      return 1;
    }
    // ---- 22 怯懦（195770-195801）----
    if (id === 22) {
      let bad = false;
      if (hasBuff(10)) bad = true;
      if (eliteRoll(0.25)) bad = true;
      const p = roll(50);
      if (bad || p === 0) return 0;
      const v = idiv(p, 6);
      if (v > 0 && f(175) === 0) st(175, v);
      return 1;
    }
    // ---- 23 颤抖（195802-195833）----
    if (id === 23) {
      let bad = false;
      if (hasBuff(3)) bad = true;
      if (eliteRoll(0.25)) bad = true;
      const p = roll(51);
      if (bad || p === 0) return 0;
      const v = idiv(p, 6);
      if (v > 0 && f(176) === 0) st(176, v);
      return 1;
    }
    // ---- 20 転倒（195834-195852）：无前置、无抗性 ----
    if (id === 20) {
      if (rnd(idiv(pw, 2) + 1) + 1 > 0 && f(434) === 0) st(434, 2);
      return 1;
    }
    // ---- 5 混乱（195853-195893）----
    if (id === 5) {
      let bad = false;
      if (cbit(8)) bad = true;
      if (hasBuff(7)) bad = true;
      if (hasBuff(43)) bad = true;
      if (hasBuff(40)) bad = true;
      if (eliteRoll(2)) bad = true;
      const p = roll(59);
      if (bad || p === 0) return 0;
      const v = idiv(p, 7);
      if (v > 0 && f(254) === 0) st(254, v);
      return 1;
    }
    // ---- 3 麻痺（195894-195928）----
    if (id === 3) {
      let bad = false;
      if (cbit(12)) bad = true;
      if (hasBuff(55)) bad = true;
      if (eliteRoll(2)) bad = true;
      const p = roll(52);
      if (bad || p === 0) return 0;
      const v = idiv(p, 10);
      if (v > 0 && f(252) === 0) st(252, v);
      return 1;
    }
    // ---- 21 冥界侵蚀（195929-195963）----
    if (id === 21) {
      let bad = false;
      if (eliteRoll(0.25)) bad = true;
      if (hasBuff(10)) bad = true;
      const p = roll(56);
      if (bad || p === 0) return 0;
      const v = idiv(p, 5);
      if (v > 0) {
        if (f(445) === 0) st(445, v);
        else st(445, f(445) + idiv(v, 3) + 3);
      }
      return 1;
    }
    // ---- 1 毒（195964-196001）----
    if (id === 1) {
      let bad = false;
      if (cbit(13)) bad = true;
      if (eliteRoll(0.25)) bad = true;
      if (hasBuff(60)) bad = true;
      const p = roll(55);
      if (bad || p === 0) return 0;
      const v = idiv(p, 5);
      if (v > 0) {
        if (f(250) === 0) st(250, v);
        else st(250, f(250) + idiv(v, 3) + 3);
      }
      return 1;
    }
    // ---- 2 睡眠（196002-196036）----
    if (id === 2) {
      let bad = false;
      if (cbit(11)) bad = true;
      if (hasBuff(43)) bad = true;
      if (eliteRoll(4)) bad = true;
      const p = roll(58);
      if (bad || p === 0) return 0;
      const v = idiv(p, 4);
      if (v > 0 && f(251) === 0) st(251, v);
      return 1;
    }
    // ---- 6 恐惧（196037-196105）----
    if (id === 6) {
      let bad = false;
      if (cbit(10)) bad = true;
      if (hasBuff(1)) bad = true;
      if (hasBuff(7)) bad = true;
      if (hasBuff(64)) bad = true;
      if (eliteRoll(4)) bad = true;
      const p = roll(54);
      if (bad || p === 0) return 0;
      const v = idiv(p, 7);
      if (v > 0) {
        if (f(255) === 0) st(255, v);
        if (f(446) > 12000) {                       // 196073
          if ((target.index | 0) === 0) log('你失禁了。');
          if (((g && g.map && g.map.header) ? (g.map.header[6] | 0) : 0) !== 1) {
            if (Elona.ItemDB && Elona.ItemDB.createItem && g.groundItems) {
              const it = Elona.ItemDB.createItem(1115, 1);
              if (it) {
                it.f[5] = target.x | 0;
                it.f[6] = target.y | 0;
                it.f[21] = -1;
                it.f[23] = f(27);                   // 196095：var_99(23) = 种族
                g.groundItems.push(it);
                if (g.refreshGroundCell) g.refreshGroundCell(it.f[5], it.f[6]);
              }
            }
          }
          st(446, 5000);                            // 196101
        }
      }
      return 1;
    }
    // ---- 7 朦朧（196106-196146）----
    if (id === 7) {
      let bad = false;
      if (hasBuff(35)) bad = true;
      if (eliteRoll(2)) bad = true;
      if ((target.raceName || '') === 'golem') bad = true;
      const p = roll(57);
      if (bad || p === 0) return 0;
      let v = rnd(idiv(p, 16) + 1);
      if (v > 0) {
        if (f(256) === 0) st(256, limit(v, 1, 63));
        else if (v > f(256)) st(256, limit(v, 1, 63));
      }
      return 1;
    }
    // ---- 9 出血（196147-196171）：无抗性判定 ----
    if (id === 9) {
      let v = idiv(pw, 25);
      if (elite()) v = idiv(v, 5);
      if (v > 0) {
        if (f(258) === 0) st(258, v);
        else st(258, f(258) + v);
      }
      return 1;
    }
    // ---- 8 醉酒（196172-196192）：无抗性判定，404 每回合累加 ----
    if (id === 8) {
      const v = idiv(pw, 10);
      st(404, f(404) + 1);                          // 196174
      if (v > 0) {
        if (f(257) === 0) st(257, v);
        else st(257, f(257) + v);
      }
      return 1;
    }
    // ---- 11 发狂（196193-196226）----
    if (id === 11) {
      if (f(86) > 100) st(86, 100);                 // 196194
      let v = idiv(pw, 8) + f(86);
      if (f(257) > 0) v = idiv(v, 4);
      if (elite()) v = idiv(v, 8);
      if (hasBuff(41)) v = idiv(v, 2);
      if (v > 0) {
        if (f(260) === 0) st(260, v);
        else st(260, f(260) + idiv(v, 3) + 1);
      }
      return 1;
    }
    // ---- 12 生病（196227-196264）----
    if (id === 12) {
      const v = idiv(pw, 10);
      if (v > 0) {
        if (f(261) === 0) {
          st(261, v);
          if ((target.index | 0) === 0) {           // 196241：玩家的健康护符
            const has = (target.inv || []).some((it) => it
              && (it.id | 0) === 1018 && (it.f && (it.f[0] | 0) >= 1));
            if (has && rnd(64) >= 1) {              // 196245
              st(261, 0);
              log('但是健康护符发出了光芒，疾病瞬间痊愈了。');
            }
          }
        } else {
          st(261, f(261) + idiv(v, 10) + 1);
        }
      }
      return 1;
    }
    return 0;                                       // 未定义的条件：不处理
  }

  // ---------------------------------------------------------------------------
  // 提示文本（tools/extract_resist_msgs.py → data/tables/resist_msgs.json，
  // start.hsp 195109-195478 机械提取，日文原文不翻译）
  // ---------------------------------------------------------------------------
  let MSGS = null;                              // { none: {ja,en}, elements: {ele: {up_ja,...}} }

  function setMsgs(t) { MSGS = t; }
  async function loadTable() {
    if (MSGS) return MSGS;
    if (Elona.Data && Elona.Data.table) {
      MSGS = await Elona.Data.table('resist_msgs');
    }
    return MSGS;
  }

  /** 模板渲染：{name} → 角色名；其余占位符删除（日文模板只用 {name}） */
  function renderMsg(tpl, c) {
    if (!tpl) return null;
    return tpl.replace(/\{(\w+)\}/g, (_, k) => (k === 'name' ? (c && c.name) || '它' : ''));
  }

  function msgNone() {
    return (MSGS && MSGS.none && MSGS.none.ja) || '何もおきない…';
  }
  function msgElem(skillId, dir, c) {
    // 本模块约定 skillId = 元素 id（50..60），与 sorg(c, skillId) 一致
    const e = MSGS && MSGS.elements && MSGS.elements[String(skillId)];
    if (!e) return null;
    return renderMsg(e[dir + '_ja'], c);
  }

  Elona.Resist = { sorg, setSorg, resistCheck, resistMod, resistModH, dmgcon, setMsgs, loadTable, idiv, limit };
})(window);
