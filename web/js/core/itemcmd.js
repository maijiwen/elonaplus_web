'use strict';
/**
 * 物品窗口的「命令条」—— `*label_0281` 的初始化表（23491-23617）与
 * `*label_2824` / `*label_2826` 的组切换（296163-299344）。
 *
 * 【源码依据 hsp/start.hsp】
 *   9143 / 9171        var_365：33 条命令名（日 / 英），下标 = var_486
 *   23597-23601        var_553：5 组命令
 *                        0 = 通常 [1,2,5,7,8,9,14,15,17,26]
 *                        1 = 野外 [1,5,7,8,14]（var_126(6)==1 时）
 *                        2 = 购买 [10,25]
 *                        3 = 出售 [22,24]
 *                        4 = 连续放置 [2]
 *   23602              var_555：各组的末下标
 *   23607-23608        var_559：命令的副标签（原版塞的是 config 键位变量 var_560..569）
 *   23609              var_558：命令 → 分类图标号（-1 = 无）
 *   296171-296186      野外时当前命令不在第 1 组 → 回到该组首项
 *   297041-297057      组号 var_399 的优先级：连续放置 > 购买 > 出售 > 野外 > 通常
 *   299322-299344      左右切换命令的环绕（`var_555` 兜底，`snd 100`）
 *
 * 【本项目的落地方式】
 *   命令 id 存在 `g.itemCmd`（原版 var_486）。窗口只在本项目支持的 4 条命令
 *   （5 吃 / 7 读 / 8 喝 / 14 使用）之间切换，其余命令在项目里是独立窗口，
 *   仍由各自的按键进入（记为 A509 的近似）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** var_560..569 与项目键位动作的对应（docs/03-keymap.md） */
  const KEY_ACTION = {
    560: 'inventory', 561: 'drop', 562: 'eat', 563: 'read', 564: 'drink',
    565: 'zap', 566: 'use', 567: 'open', 568: 'dip', 569: 'throw',
  };

  /** 本项目物品窗里可直接切换的命令（其余走独立窗口） */
  const IN_WINDOW = [5, 7, 8, 14];

  /** 命令 → UI.openUse 的筛选模式（var_486 → useMode） */
  const USE_FILTER = { 5: 14, 7: 13, 8: 15, 14: 0 };

  let cached = null;

  function table() {
    if (cached) return cached;
    const D = Elona.Data;
    if (D && typeof D.tableSync === 'function') {
      const t = D.tableSync('itemcmd');
      if (t && t.names) cached = t;
    }
    return cached;
  }

  function ready(data) {
    cached = (data && data.names) ? data : null;
    return ItemCmd;
  }

  function lang() {
    return (Elona.i18n && Elona.i18n.lang) ? Elona.i18n.lang : 'ch';
  }

  // ------------------------------------------------------------------
  // 名字 / 图标 / 副标签
  // ------------------------------------------------------------------
  /** var_365(id)：命令名。lang = jp / en / ch（中文缺失时退回日文） */
  function name(id, l) {
    const t = table();
    if (!t) return '';
    const e = t.names[id | 0];
    if (!e) return '';
    const L = l || lang();
    if (L === 'en') return e[1] || e[0];
    if (L === 'ch') return e[2] || e[0];
    return e[0];
  }

  /** var_558(id)：分类图标号（3 号画面 288 + n*48），-1 = 无 */
  function icon(id) {
    const t = table();
    if (!t || !t.icons) return -1;
    const v = t.icons[id | 0];
    return v === undefined ? -1 : (v | 0);
  }

  /** var_559(id)：副标签，原版是 config 里该命令的按键 */
  function keyHint(id) {
    const t = table();
    if (!t || !t.subKeys) return '';
    const slot = t.subKeys[String(id | 0)];
    if (!slot) return '';
    const act = KEY_ACTION[slot];
    const K = Elona.Keys;
    if (!act || !K) return '';
    const keys = (K.bindings && K.bindings[act]) || [];
    return keys.length ? String(keys[0]) : '';
  }

  /** 296794：窗口标题 = 命令名 + 「アイテムの選択」/ 仅命令名（英文） */
  function pickTitle(id, l) {
    const L = l || lang();
    const n = name(id, L === 'en' ? 'en' : L);
    if (L === 'en') return n || 'Items';
    if (L === 'ch') return n ? `${n}：选择道具` : '选择道具';
    return n ? n + 'アイテムの選択' : 'アイテムの選択';
  }

  // ------------------------------------------------------------------
  // 组与模式（297041-297057 / 296171-296186）
  // ------------------------------------------------------------------
  /**
   * var_399（组号）：
   *   连续放置（var_2263）→ 4；购买（var_2255）→ 2；出售（var_2256）→ 3；
   *   野外（var_126(6)==1）→ 1；否则 0。
   * 本项目把三者挂在 `g.multiDrop` / `g.shopBuy` / `g.shopSell` 上，
   * 地图种类读 `g.mapType()` 或 `var_126(6)` 的既有实现。
   */
  function group(g) {
    const T = (g && g.map && g.map.header) ? (g.map.header[6] | 0) : 0;
    if (g && g.multiDrop) return 4;
    if (g && g.shopBuy) return 2;
    if (g && g.shopSell) return 3;
    if (T === 1) return 1;
    return 0;
  }

  /** var_553(0..var_399)：该组的命令 id 列表 */
  function commands(grp) {
    const t = table();
    if (!t || !t.groups) return [];
    const gi = (grp === undefined) ? 0 : (grp | 0);
    return (t.groups[gi] || []).slice();
  }

  /** 当前组的命令列表 */
  function list(g) {
    return commands(group(g));
  }

  function current(g) {
    return (g && g.itemCmd) | 0;
  }

  function setCurrent(g, id) {
    if (g) g.itemCmd = id | 0;
    return current(g);
  }

  /**
   * 296171-296186：野外（var_126(6)==1）时若当前命令不在第 1 组，
   * 回到该组首项；否则不动。
   */
  function wildFallback(g) {
    const grp = group(g);
    if (grp !== 1) return { changed: false, id: current(g) };
    const cmds = commands(1);
    const cur = current(g);
    if (cmds.indexOf(cur) >= 0) return { changed: false, id: cur };
    const id = cmds.length ? cmds[0] : cur;
    setCurrent(g, id);
    return { changed: true, id };
  }

  /**
   * 299322-299344：在当前组内左右移动。
   *   +1：下标 +1，越过末项回到 0
   *   -1：下标 -1，小于 0 时取 var_555(var_399)（该组末下标）
   * @returns {{ok:boolean, id:number, prev:number, index:number}}
   */
  function cycle(g, delta, allow) {
    const grp = group(g);
    const t = table();
    let cmds = commands(grp);
    const cur = current(g);
    // 只在本项目支持的子集里循环时，先把允许集合过滤出来（A509 的近似）
    if (allow && allow.length) {
      const sub = cmds.filter((id) => allow.indexOf(id) >= 0);
      if (sub.length) cmds = sub;
    }
    if (!cmds.length) return { ok: false, id: cur, prev: cur, index: -1 };
    let idx = cmds.indexOf(cur);
    if (idx < 0) {
      // 当前命令不在本组：回到组首项（296171-296186 的同款兜底）
      setCurrent(g, cmds[0]);
      return { ok: true, id: cmds[0], prev: cur, index: 0 };
    }
    const d = (delta | 0) < 0 ? -1 : 1;
    idx += d;
    if (idx >= cmds.length) idx = 0;
    if (idx < 0) {
      const last = (t && t.groupLast && grp < t.groupLast.length) ? t.groupLast[grp] : cmds.length - 1;
      idx = Math.min(last, cmds.length - 1);
    }
    const id = cmds[idx];
    setCurrent(g, id);
    return { ok: true, id, prev: cur, index: idx };
  }

  /** 该命令是否由物品窗内部处理（其余走独立窗口） */
  function inWindow(id) {
    return IN_WINDOW.indexOf(id | 0) >= 0;
  }

  /** 命令 → UI.openUse 的筛选模式；不支持的返回 -1 */
  function useFilter(id) {
    const v = USE_FILTER[id | 0];
    return v === undefined ? -1 : v;
  }

  const ItemCmd = {
    KEY_ACTION, IN_WINDOW, USE_FILTER,
    table, ready, name, icon, keyHint, pickTitle,
    group, commands, list, current, setCurrent, wildFallback, cycle,
    inWindow, useFilter,
    count() { const t = table(); return t ? t.names.length : 0; },
  };

  Elona.ItemCmd = ItemCmd;
})(typeof window !== 'undefined' ? window : globalThis);
