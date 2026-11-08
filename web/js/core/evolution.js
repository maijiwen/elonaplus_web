'use strict';
/**
 * 同伴进化系统（core/evolution.js）—— effect 58（360661-364083，3423 行）
 *
 * 【源码结构】
 *   360661-361957  匹配段：按「种族 var_58(27) + 宝石编号 var_99(25, 物品)
 *                  + 同伴等级 var_58(214) [+ 性别]」生成 `var_2598 = 1..167`。
 *                  等级条件多为等值（==0/1/2），只有 101 号用区间（>=1 且 <3）。
 *   361958-364050  执行段：`if ( var_2598 == N )` 里写
 *                  · `var_1880` 新名前缀、`var_1881` 旧名前缀
 *                  · `var_58(7)` 贴图（`S + P * 1000`，P 是调色板）
 *                  · `var_58(435)` 调色板位（只有 6 处显式写）
 *                  · `var_58(214)` 直接改写等级（4 处：10 / 10 / 10 / 3）
 *                  · `skillmod` / `cbitmod` / `resistmod` / `var_58(19/20)` 身高体重
 *   364050-364060  收尾（所有分支共用）：
 *                  · `var_58(182)` 斗志下限 200
 *                  · 改名：名字以旧前缀开头时，换成新前缀 + 剩余部分
 *                  · `var_99(0, 物品)--` 消耗 1 个
 *                  · `var_58(214) += 1` 等级 +1
 *
 * 【两条容易读错的地方】
 *   ① **进化只改贴图（var_58(7)），不改种族（var_58(27)）。**
 *      整个 3423 行里 `var_58(27, var_244)` 只出现在匹配条件里，没有一次赋值。
 *      所以进化后的同伴在战斗判定上仍是原种族（种族特攻、龙/不死减伤等照旧），
 *      变的只是外观、技能潜力、名字和等级。本实现照此办理。
 *   ② **`var_58(214)` 是「同伴等级 / rank」，不是「进化次数」。**
 *      它同时用于：匹配条件、收尾 `+= 1`、以及战斗里 `rnd(100) < rank * 5` 的
 *      命中判定（spell.js 640）。少数分支直接把它改成 10 / 3（跳级），
 *      之后收尾还会再 +1。
 *
 * 【贴图编码】本项目 `renderer.charaSpriteIndex` 用 `(7 % 1000) + 435 * 1000`
 *   取贴图格号。源码写的是 `S + P * 1000`（S = 基础贴图、P = 调色板）。
 *   本项目没有调色板，所以这里把 **基础贴图 S 写进 7**，并把 `S >= 1000` 的进位
 *   写进 435（此时 `(S % 1000) + 1 * 1000 == S`）。这样渲染出的就是 S。
 *
 * 【数据】web/data/tables/evolution.json（167 条，tools/extract_evolution.py 生成）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let TABLE = null;

  async function load() {
    if (TABLE) return TABLE;
    TABLE = await Elona.Data.table('evolution');
    return TABLE;
  }
  function setTable(t) { TABLE = t; }

  /** 匹配：种族 + 宝石编号 + 等级条件（等值或区间）+ 性别 */
  function matchRule(species, f25, rank, sex) {
    if (!TABLE) return null;
    for (const r of TABLE) {
      if (r.f25 === null || r.f25 === undefined) continue;
      if ((r.f25 | 0) !== (f25 | 0)) continue;
      if (!r.species || r.species.indexOf(species | 0) < 0) continue;
      if (r.rankEq !== null && r.rankEq !== undefined && (r.rankEq | 0) !== (rank | 0)) continue;
      if (r.rankMin !== null && r.rankMin !== undefined && (rank | 0) < (r.rankMin | 0)) continue;
      if (r.rankMax !== null && r.rankMax !== undefined && (rank | 0) >= (r.rankMax | 0)) continue;
      // 性别：`var_58(8)`（0 = 男 / 1 = 女，见 core/aim.js 的同一判定）。原版另有按
      // 「性别名」`var_63(8)` 判断的兄弟分支（361931-361950 等），本项目没有该字符串，
      // 已折叠到编码匹配（见 tools/extract_evolution.py）。
      if (r.sexCode !== null && r.sexCode !== undefined
          && (sex | 0) !== (r.sexCode | 0)) continue;
      return r;
    }
    return null;
  }

  /** 旧接口名（早期测试用） */
  const findRule = matchRule;

  /** 取当前等级对应的子分支（只有 101 号有） */
  function pickVariant(rule, rank) {
    if (!rule.variants || !rule.variants.length) return null;
    for (const v of rule.variants) if ((v.rank | 0) === (rank | 0)) return v;
    return null;
  }

  /**
   * 尝试进化。
   * @param {object} g
   * @param {object} item   进化宝石（f[25] = 宝石编号）
   * @param {object} target 同伴
   */
  function evolve(g, item, target) {
    const c = target;
    if (!c) return { ok: false, reason: 'no-target', message: '只能对同伴使用。' };
    // 361955：`if ( var_244 > 0 & var_244 < 16 )` —— 玩家自己（0）与野怪（>=16）都不行
    if ((c.index | 0) <= 0 || (c.index | 0) >= 16 || (c.get(0) | 0) !== 1) {
      return { ok: false, reason: 'not-ally', message: '只能对同伴使用。' };
    }
    const species = c.get(27) | 0;
    const f25 = item.f[25] | 0;
    const rank = c.get(214) | 0;
    const rule = matchRule(species, f25, rank, c.get(8) | 0);
    if (!rule) {
      return { ok: false, reason: 'no-match', message: '组合好像不对。' };
    }
    // 364003 附近：好感 < 150 → 拒绝（`var_58(17) < 150`）
    if ((c.get(17) | 0) < 150) {
      return { ok: false, reason: 'low-friendship', message: `${c.name}拒绝了进化。` };
    }
    // 364009 附近：变异壳使用中（`var_58(409) > 0`）→ 拒绝
    if ((c.get(409) | 0) > 0) {
      return { ok: false, reason: 'form-shift', message: '变异壳使用中无法进化。' };
    }
    return applyEvolution(g, item, c, rule);
  }

  /** 执行进化（`var_2598 > 0` 分支 + 收尾） */
  function applyEvolution(g, item, c, rule) {
    const oldName = c.name || '';
    const rank = c.get(214) | 0;
    const v = pickVariant(rule, rank);
    const rnd = (n) => (g && g.rng ? g.rng.rnd(n) : Math.floor(Math.random() * n));

    // 361982：「おや？Xの様子が…！？」—— 变化前的一句
    if (g && g.log) g.log(`咦？${oldName}的样子有点奇怪…！？`);

    // ---- 贴图：基础贴图写进 7，>= 1000 的进位写进 435 ----
    const base = v && v.spriteBase ? v.spriteBase : rule.spriteBase;
    if (base) {
      c.set(7, base | 0);
      c.set(435, (base | 0) >= 1000 ? 1 : 0);
    }

    // ---- 技能潜力 / cbit / 抗性 ----
    const skills = (rule.skills || []).concat((v && v.skills) || []);
    if (skills.length && Elona.Stats && Elona.Stats.skillMod) {
      for (const [sk, exp] of skills) {
        Elona.Stats.skillMod(c, sk | 0, c.index | 0, exp | 0, g);
      }
    }
    if (rule.cbits && rule.cbits.length && Elona.Status && Elona.Status.cbitmod) {
      for (const [bit, val] of rule.cbits) Elona.Status.cbitmod(c, bit | 0, val | 0);
    }
    if (rule.resist && rule.resist.length && Elona.Resist && Elona.Resist.resistMod) {
      for (const [sk, delta] of rule.resist) Elona.Resist.resistMod(c, sk | 0, (delta | 0) * 10);
    }

    // ---- 身高 / 体重 ----
    const dh = (v && v.dheight) || rule.dheight;
    const dw = (v && v.dweight) || rule.dweight;
    if (dh) c.set(19, (c.get(19) | 0) + rnd(dh[0]) + dh[1]);
    if (dw) c.set(20, (c.get(20) | 0) + rnd(dw[0]) + dw[1]);

    // ---- 等级直接改写（少数分支） ----
    if (rule.rank !== null && rule.rank !== undefined) c.set(214, rule.rank | 0);

    // ---- 收尾：斗志下限 200 ----
    if ((c.get(182) | 0) < 200) c.set(182, 200);

    // ---- 收尾：改名（名字以旧前缀开头 → 新前缀 + 剩余） ----
    const oldPrefix = (v && v.old) || rule.old || '';
    if (oldPrefix && oldName.indexOf(oldPrefix) === 0) {
      c.name = (rule.name || '') + oldName.slice(oldPrefix.length);
    }

    // ---- 收尾：消耗物品 + 等级 +1 ----
    item.f[0] = (item.f[0] | 0) - 1;
    if (g.refreshGroundCell && (item.f[21] | 0) === -1) {
      g.refreshGroundCell(item.f[5] | 0, item.f[6] | 0);
    }
    c.set(214, (c.get(214) | 0) + 1);

    const msg = `恭喜！${oldName}进化成了${rule.name}！`;
    if (g.log) g.log(msg);
    return { ok: true, evolved: true, rule, rank: c.get(214) | 0, message: msg };
  }

  /** 列出某角色当前可用的进化（调试 / 面板用） */
  function listAvailable(g, c, items) {
    if (!TABLE) return [];
    const species = c.get(27) | 0;
    const rank = c.get(214) | 0;
    const sex = c.get(8) | 0;
    const out = [];
    for (const it of (items || [])) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      const r = matchRule(species, it.f[25] | 0, rank, sex);
      if (r) out.push({ item: it, rule: r });
    }
    return out;
  }

  Elona.Evolution = {
    load, setTable,
    matchRule, findRule, evolve, listAvailable,
    count: () => (TABLE ? TABLE.length : 0),
  };
})(typeof window !== 'undefined' ? window : globalThis);
