'use strict';
/**
 * 容器物品的存取（core/container.js）—— `o` 键背后的内容物系统
 *
 * 【源码依据】
 *   1. 哪些物品是容器：296368-296375
 *        if ( var_486 == 15 ) {        // 15 = 打开容器
 *            if ( var_657 != 72000 ) continue;     // var_657 = refitem(id,5)
 *            if ( var_99(25, cnt) == 0 ) continue; // f[25]（内容存档编号）必须非 0
 *        }
 *   2. 打开流程：298813-298818 → `goto *label_2998`
 *   3. label_2998（344751-344905）：
 *        var_1830 = var_99(9, var_579)              // 容器编号
 *        var_489 = "shop" + var_1830 + ".s2"        // 内容物存在独立存档文件里
 *        var_577 = 6 / var_486 = 22,2               // 进入「容器存取」物品窗口
 *        var_2536 = inv_weight(-1) + 2500           // 容量（仅 641 号物品）
 *   4. 世界地图上不能使用容器：297006-297015
 *
 * 【本实现的差异（见 docs/02-diff-report.md A51）】
 *   原版把内容物写在 `tmp/shop<f[9]>.s2` 这个**外部文件**里，而 `f[9]` 默认是 99999，
 *   于是多个同编号容器共用一份内容。本项目没有这套外部存档，改为
 *   **每件容器物品自带 `inv` 数组**（随物品一起进存档）——结果更符合直觉，
 *   但与原版「按容器编号共享」不同，已如实登记。
 *
 * 【不做容量上限】原版只有 641 号物品会把 `f[7]` 设成容量（inv_weight+2500），
 *   普通宝箱/金库的 `f[7]` 是重量 1，不是容量；因此这里不设上限。
 *
 * 【0-EY 追加】冰箱(579)/小冰箱(641) 存取 57000 类食物时做腐烂时间换算
 *   （342154-342180，由 core/foodleft.js 提供）：存入把绝对到期时刻改成剩余小时数，
 *   取出时加回当前时刻，因此箱内停留的时间不计入腐烂。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /**
   * 容器类物品的类别值。
   * 源码 296369 判的是 `var_657`（物品实例上的功能类别），它来自定义的 `refitem(id,5)`；
   * 对应的 `items.json` 字段是 `fields[5]`（宝箱/金库/皮箱/素材箱…共 22 种）。
   * 注意不是 `refitem(id,9)`——那是容器内容存档文件的编号（宝箱为 99999）。
   */
  const CONTAINER_CAT = 72000;

  /** 该物品 id 是否是容器（箱子/金库/皮箱/素材箱/扭蛋…共 22 种） */
  function isContainer(id) {
    if (!Elona.ItemDB) return false;
    return (Elona.ItemDB.ref(id, 5) | 0) === CONTAINER_CAT;
  }

  /**
   * 该物品实例是否可打开。
   *
   * 原版还要求 `var_99(25) != 0`（296372）—— f[25] 是**内容存档文件的编号**，
   * 用来定位 `tmp/shop<f[25]>.s2`。本项目把内容物直接挂在物品实例上，没有这个文件，
   * 而 `items.json` 里 22 种容器的定义也没有 field 25，因此这里只按类别判定。
   * （差异报告 A51）
   */
  function canOpen(it) {
    if (!it) return false;
    // 书架 / 书堆 / 药水架 / 面包架（`*label_3016` effect 74，356065-356088）
    // 原版同样是走 `*label_2998` 的容器流程，只是类别不是 72000。
    if ((it.f[19] | 0) === 74) return true;
    return isContainer(it.id);
  }

  /** 取内容物数组（懒创建） */
  function contents(it) {
    if (!it) return [];
    if (!Array.isArray(it.inv)) it.inv = [];
    return it.inv;
  }

  /** 内容物总重量（原版 inv_weight：Σ 重量×数量，item.js 第 17 行注释） */
  function weight(it) {
    let w = 0;
    for (const x of contents(it)) {
      if (!x || (x.f[0] | 0) <= 0) continue;
      w += (x.weight | 0) * (x.f[0] | 0);
    }
    return w;
  }

  /** 内容物件数（按堆叠数算） */
  function count(it) {
    let n = 0;
    for (const x of contents(it)) {
      if (!x || (x.f[0] | 0) <= 0) continue;
      n += x.f[0] | 0;
    }
    return n;
  }

  /** 容器摘要，给面板显示 */
  function summary(it) {
    const c = contents(it);
    return { kinds: c.filter((x) => x && (x.f[0] | 0) > 0).length, count: count(it), weight: weight(it) };
  }

  /** 世界地图上禁止使用容器（297006-297015） */
  function blockedOnWorldMap(g) {
    return !!(g && g.worldMap);
  }

  /**
   * 344752-344753：打开「商人のカバン」（361）时每次扣 10 善恶值。
   * 这是抢劫行商/船商的代价；从商人身上抢来的商品就在 bag.inv 里（见 loot.js）。
   */
  function beforeOpen(g, it) {
    if (!g || !it || (it.id | 0) !== 361) return { ok: true };
    if (typeof g.modkarma === 'function') g.modkarma(-10);
    else if (Elona.Karma && Elona.Karma.mod) Elona.Karma.mod(g, -10);
    else if (g.player) g.player.set(49, (g.player.get(49) | 0) - 10);
    const msg = '打开了商人的提包。你的善恶值下降了。';
    if (g.log) g.log(msg);
    return { ok: true, karma: -10, message: msg };
  }

  /**
   * 从容器取出第 idx 件 → 玩家背包。
   * @returns {{ok:boolean, message:string}}
   */
  function take(g, it, idx) {
    if (!g || !g.player) return { ok: false, message: '没有玩家。' };
    if (blockedOnWorldMap(g)) return { ok: false, message: '在世界地图上不能整理容器。' };
    const list = contents(it);
    const x = list[idx];
    if (!x || (x.f[0] | 0) <= 0) return { ok: false, message: '那一格是空的。' };

    const FL = Elona.FoodLeft;
    if (FL && FL.isFreezer(it) && FL.freezerConvert) FL.freezerConvert(g, x, 'out'); // 342161-342166
    list.splice(idx, 1);
    placeIntoInventory(g.player, x);
    return { ok: true, message: `取出了 ${Elona.ItemDB.name(x.id, 'en')} ×${x.f[0] | 0}。` };
  }

  /**
   * 把玩家背包第 idx 件放进容器。
   * @returns {{ok:boolean, message:string}}
   */
  function put(g, it, idx) {
    if (!g || !g.player) return { ok: false, message: '没有玩家。' };
    if (blockedOnWorldMap(g)) return { ok: false, message: '在世界地图上不能整理容器。' };
    const inv = g.player.inv || [];
    const x = inv[idx];
    if (!x || (x.f[0] | 0) <= 0) return { ok: false, message: '那一格是空的。' };
    if (x === it) return { ok: false, message: '不能把容器放进它自己。' };
    if (x.eqSlot >= 0) return { ok: false, message: '装备中的物品不能放进容器。' };

    const FL = Elona.FoodLeft;
    if (FL && FL.isFreezer(it) && FL.freezerConvert) FL.freezerConvert(g, x, 'in');  // 342177
    inv.splice(idx, 1);
    contents(it).push(x);
    return { ok: true, message: `放入了 ${Elona.ItemDB.name(x.id, 'en')} ×${x.f[0] | 0}。` };
  }

  /** 放进背包第一个空格，没有就追加（与 pickupAt / craft 一致） */
  function placeIntoInventory(p, item) {
    const inv = p.inv || (p.inv = []);
    for (let i = 0; i < inv.length; i++) {
      if (!inv[i] || (inv[i].f[0] | 0) <= 0) { inv[i] = item; return i; }
    }
    inv.push(item);
    return inv.length - 1;
  }

  /** 背包里所有可打开的容器（给面板用） */
  function listContainers(g) {
    const out = [];
    const inv = (g && g.player && g.player.inv) || [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (it && (it.f[0] | 0) > 0 && canOpen(it)) out.push({ idx: i, item: it });
    }
    // 297590-297608：`f[21] == 2` 的容器**搬不动**（行商/船商的 361 提包），
    //   只能站在上面按 o 就地打开。这里把脚下这类容器也列进同一个面板。
    const p = g && g.player;
    if (p && Array.isArray(g.groundItems)) {
      for (const it of g.groundItems) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        if (it.f[5] !== p.x || it.f[6] !== p.y) continue;
        if (!canOpen(it)) continue;
        if ((it.f[21] | 0) !== 2) continue;
        out.push({ idx: -1, item: it, ground: true });
      }
    }
    return out;
  }

  Elona.Container = {
    CONTAINER_CAT,
    isContainer, canOpen, contents, weight, count, summary,
    take, put, listContainers, blockedOnWorldMap, beforeOpen,
  };
})(window);
