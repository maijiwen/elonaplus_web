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
   * 施加异常状态 —— dmgcon
   * @param {object} condTable data/tables/dmgcon.json 的 conditions
   * @returns {number} 1 = 已施加, 0 = 被抗性完全免疫
   */
  function dmgcon(g, condTable, target, condId, power) {
    const entry = condTable[String(condId)];
    if (!entry) return 0;                       // 未提取到的条件：不做处理（不臆造）
    const resistSkill = entry.resistSkills[0];
    const r = resistCheck(g, target, resistSkill, power);
    if (r.immune) return 0;
    // 195925-195965：冥界（cond 21）特判 —— 与通用「直接写入」不同：
    //   首次（445==0）：445 = 强度/10，提示「は冥界の冷気に侵蝕された。」；
    //   已有侵蚀：445 += 强度/30 + 3（累加）。
    //   侵蚀会让后续所有 MP 损耗放大并在 MP 变负时触发魔力反噬（core/status.js dmgmp）。
    if ((condId | 0) === 21) {
      const v = idiv(r.power, 10);
      if (v > 0) {
        if ((target.get(445) | 0) === 0) {
          target.set(445, v);                   // 195946
        } else {
          target.set(445, (target.get(445) | 0) + idiv(v, 3) + 3);   // 195958
        }
      }
      return 1;
    }
    const div = entry.divisor || 1;
    let v = idiv(r.power, div);
    if (v > 0) {
      // 196073-196100：**新**受到恐惧（var_58(255) 原本为 0）且水分 > 12000 → 失禁
      const wasFear = ((condId | 0) === 6) ? (target.get(255) | 0) : 0;
      for (const f of entry.statusFields) target.set(f, v);
      if ((condId | 0) === 6 && wasFear === 0 && (target.get(446) | 0) > 12000
        && Elona.Potion && Elona.Potion.morasi) {
        const msgs = Elona.Potion.morasi(g, target);
        for (const m of msgs) { if (g && g.log) g.log(m); }
      }
    }
    return 1;
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
