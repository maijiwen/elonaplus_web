'use strict';
/**
 * 城镇剧情 NPC 的生成条件（core/townnpc.js）—— 0-FZ / C3
 *
 * 【源码依据】map_init_main 的 16 处 `if (var_65(250+N) ...)` 条件：
 *   239083 palmia 475 / 239115 palmia 246 / 239490 yowyn 499 /
 *   239495 yowyn 213 / 239632 noyel 654（含 findchara 654）/ 239662 noyel 222 /
 *   239962 vernis 225 / 244618 melkawn1 576 / 244763 kurualm 478 /
 *   244768 kurualm 495 / 244913 valm 575 / 244917·244922 valm 382/383 /
 *   245091 melugas 664 / 245096 melugas 791 / 245196 arcbelc 577
 *
 *   tools/extract_town_npcs.py 把这些条件逐条登记到 town_npcs.json 的
 *   `when` / `src` 字段；此前项目对 cond=true 的条目一律跳过不生成。
 *
 * `when` 是 AND 数组，元素可以是：
 *   {v, op, n}      —— var_65(v) 与 n 比较（v 已换算掉 250+ 前缀）
 *   {any:[...]}     —— 源码的 `|`（OR）
 *   {notChara:id}   —— 源码 `findchara(id) == 0`
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  function one(g, c) {
    if (c.any) return c.any.some((x) => one(g, x));
    if (c.notChara !== undefined) {
      return !(g.charas || []).some((m) => m && (m.get(0) | 0) === 1
        && (m.get(27) | 0) === (c.notChara | 0));
    }
    const v = g.getV65(c.v) | 0, n = c.n | 0;
    switch (c.op) {
      case '!=': return v !== n;
      case '==': return v === n;
      case '>=': return v >= n;
      case '<=': return v <= n;
      case '>': return v > n;
      case '<': return v < n;
      default: return false;
    }
  }

  /** 该条固定 NPC 现在是否应该生成 */
  function passes(g, e) {
    if (!e || !e.cond) return true;          // 无条件 NPC 恒生成
    if (!Array.isArray(e.when)) return false; // 未登记条件的剧情 NPC 保持旧行为
    return e.when.every((c) => one(g, c));
  }

  Elona.TownNpc = { passes, one };
})(typeof window !== 'undefined' ? window : global);
