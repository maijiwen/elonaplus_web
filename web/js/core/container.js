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
 * 【容量上限（0-FZ 补齐）】原版只有 641 号物品（小冰箱）会算容量：
 *   `var_2536 = inv_weight(-1) + 2500`，并在打开窗口时把容量写回 f[7]。
 *   本项目在 `put()` 里按同一公式拒绝超重放入，但不改写 f[7]
 *   （项目 f[7] 是容器自身重量，改写会让背包负重暴涨）。普通容器仍无上限。
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

  /**
   * 0-FZ：小冰箱 641 的容量上限（344804 / 344893-344903）。
   *   源码 `var_2536 = inv_weight(-1) + 2500` —— inv_weight(-1) 是**当前地图地面
   *   所有物品的正重量合计**（29738-29756），只在 641 号容器上生效，其它容器
   *   var_2536 = 0（无上限）。
   *   源码随后还把容量写回 `var_99(7, 容器)`；本项目 f[7] 是容器自身重量，
   *   写回会让背包负重暴涨，故只保留「容量判定」这一玩法语义，不改写 f[7]。
   * @returns {number} 0 表示无上限
   */
  function capacityOf(g, it) {
    if (!g || !it || (it.id | 0) !== 641) return 0;
    let w = 0;
    for (const o of ((g && g.groundItems) || [])) {
      if (!o || (o.f[0] | 0) <= 0) continue;
      const iw = o.f[7] | 0;
      if (iw >= 0) w += iw * (o.f[0] | 0);
    }
    return w + 2500;
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
    // 0-Z16 / 297569：形見のカバン 510（f[9]==3）——无继承权则打不开（只读也不行）
    if (it && (it.id | 0) === 510 && (it.f[9] | 0) === 3 && Elona.Heirloom) {
      const r = Elona.Heirloom.openTrunk(g, it);
      if (!r.ok) {
        const msg = r.reason === 'no-right' ? '你没有遗产的继承权。'
          : (r.reason === 'no-legacy' ? '这个提包里没有遗产。' : '打不开这个提包。');
        if (g && g.log) g.log(msg);
        return { ok: false, reason: r.reason, message: msg };
      }
      // 遗产物品存在全局记录（源码 shop3.s2）；打开时同步到本提包的 inv 供面板显示。
      // 取出的物品不计入 here inv 的永久状态——由 take() 里的 Heirloom.take 负责扣继承权并回写。
      const H = Elona.Heirloom;
      const rec = H.load();
      if (rec && Array.isArray(rec.items)) {
        const inv = [];
        for (const row of rec.items) {
          let o = null;
          if (Elona.ItemDB && typeof Elona.ItemDB.createItem === 'function') {
            try { o = Elona.ItemDB.createItem(row.id, row.n || 1, null); } catch (e) { o = null; }
          }
          if (o) {
            if (row.f) for (let k = 0; k < row.f.length; k++) o.f[k] = row.f[k] | 0;
            if (row.name) o.name = row.name;
            inv.push(o);
          }
        }
        it.inv = inv;
        it._heirloomIndices = rec.items.map((_, i) => i); // 面板 idx → 遗产记录 idx 映射
      }
      return { ok: true, heirloom: true, rights: r.rights, items: r.items };
    }
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

    // 0-Z16 / 297717：形見のカバン 510（f[9]==3）取物 → 继承权 var_65(97)-- 并回写遗产记录
    if ((it.id | 0) === 510 && (it.f[9] | 0) === 3 && Elona.Heirloom) {
      const hIdx = (it._heirloomIndices && it._heirloomIndices[idx] !== undefined)
        ? (it._heirloomIndices[idx] | 0) : idx;
      const r = Elona.Heirloom.take(g, hIdx);
      if (!r.ok) {
        const msg = r.reason === 'no-right' ? '继承权不足，不能再取了。' : '取不出这件遗产。';
        if (g.log) g.log(msg);
        return { ok: false, message: msg };
      }
      list.splice(idx, 1);
      if (it._heirloomIndices) it._heirloomIndices.splice(idx, 1);
      const got = r.item || x;
      placeIntoInventory(g.player, got);
      return { ok: true, message: `取出了遗产 ${Elona.ItemDB.name(got.id)} ×${got.f[0] | 0}。剩余继承权 ${r.rights}。` };
    }

    const FL = Elona.FoodLeft;
    if (FL && FL.isFreezer(it) && FL.freezerConvert) FL.freezerConvert(g, x, 'out'); // 342161-342166
    list.splice(idx, 1);
    placeIntoInventory(g.player, x);
    return { ok: true, message: `取出了 ${Elona.ItemDB.name(x.id)} ×${x.f[0] | 0}。` };
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
    // 0-FZ / 344804+344893-344903：641 小冰箱的容量 = 地面物品总重量 + 2500
    const cap = capacityOf(g, it);
    if (cap > 0) {
      const add = Math.max(0, (x.f[7] | 0) * (x.f[0] | 0));
      if (weight(it) + add > cap) return { ok: false, message: '已经装不下了。' };
    }

    const FL = Elona.FoodLeft;
    if (FL && FL.isFreezer(it) && FL.freezerConvert) FL.freezerConvert(g, x, 'in');  // 342177
    inv.splice(idx, 1);
    contents(it).push(x);
    return { ok: true, message: `放入了 ${Elona.ItemDB.name(x.id)} ×${x.f[0] | 0}。` };
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
    //   只能站在上面按 o 就地打开；普通容器（宝箱/冰箱/给料箱…）也一样能就地打开
    //   （原版家庭内的 579 冷蔵庫 / 547 給料箱 都是摆在地上直接用的）。
    //   因此这里把**脚下格子**的所有可开容器都列进同一个面板。
    const p = g && g.player;
    if (p && Array.isArray(g.groundItems)) {
      for (const it of g.groundItems) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        if (it.f[5] !== p.x || it.f[6] !== p.y) continue;
        if (!canOpen(it)) continue;
        out.push({ idx: -1, item: it, ground: true });
      }
    }
    return out;
  }

  Elona.Container = {
    CONTAINER_CAT,
    isContainer, canOpen, contents, weight, count, summary, capacityOf,
    take, put, listContainers, blockedOnWorldMap, beforeOpen,
  };
})(window);
