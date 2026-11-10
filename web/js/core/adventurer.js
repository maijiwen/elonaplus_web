'use strict';
/**
 * 冒险者 NPC 系统 —— start.hsp 590181-590556（0-GL）
 *
 *   *label_4275 (590181-590189)  批量生成：`var_41 == 1` 时跳过，
 *                                `repeat 40-1, 16` 对槽 16..39 调 *label_4276。
 *   *label_4276 (590190-590234)  生成单个冒险者：随机种族 75/41/160、
 *                                等级 clamp(rnd(60+玩家等级)+1, 1, 200)、
 *                                随机名字/称号、职业 13、五个技能、归属地图、赏金。
 *   *label_4277 (590235-590401)  定期刷新：契约到期、离场/回归（addnews 3/5）、
 *                                低概率换地图；时间戳是 var_65(10..13) 的绝对小时。
 *   *label_4278 (590402-590412)  设置手持物品 var_58(12)。
 *   *label_4279 (590413-590456)  背包里挑一件可丢弃物品。
 *   *label_4280 (590457-590472)  inv_getfreeid / 抢占物品槽。
 *   *label_4281 (590473-590482)  遍历背包自动装备。
 *   *label_4282 (590483-590556)  装备评价与换装。
 *
 * 【字段约定】原版 `var_58(0)` 是多元存在状态（0/1/3/4/5…），而本项目把
 * `get(0)===1` 当作「角色活跃」布尔。为避免破坏 AI / 战斗 / 死亡判定，
 * 冒险者的原版状态保存在 `chara.adventurer.state`，`get(0)` 只按「是否在
 * 当前归属地图」置 1 / 0。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const ADV_FIRST = 16;
  const ADV_LAST = 39;                      // 源码 `repeat 40 - 1, 16`
  const SPECIES = [75, 41, 160];           // 590194 var_400 = 75, 41, 160
  const JOB_ADVENTURER = 13;               // 590205 var_58(150) = 13
  const TITLE = ['流浪的', '无名的', '年轻的', '老练的', '沉默的', '快活的'];

  /** 绝对小时：var_65(13) + 日×24 + 月×24×30 + 年×24×30×12（590240） */
  function absHours(g) {
    const v = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    return v(13) + v(12) * 24 + v(11) * 24 * 30 + v(10) * 24 * 30 * 12;
  }

  function R(g, n) {
    if (g && g.rng && typeof g.rng.rnd === 'function') return g.rng.rnd(n) | 0;
    if (Elona.rng && typeof Elona.rng.rnd === 'function') return Elona.rng.rnd(n) | 0;
    return Math.floor(Math.random() * n) | 0;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));

  /** 随机可站立坐标（characreate 的 -1,-1 由宿主决定落点） */
  function freeXY(g) {
    const m = g && g.map;
    if (!m || !m.inBounds || !m.walkable) return { x: 1, y: 1 };
    for (let i = 0; i < 30; i++) {
      const x = R(g, m.width || 80) | 0, y = R(g, m.height || 40) | 0;
      if (m.inBounds(x, y) && m.walkable(x, y)) return { x, y };
    }
    return { x: 1, y: 1 };
  }

  /** 590214-590231：随机归属地图（var_58(80)） */
  function pickHomeMap(g) {
    let id = R(g, 450);
    const state = g && g.getV65 ? (g.getV65(252) | 0) : 0;
    // 590215-590223：var_132(16/0)==7 的地图不可用；主线未到 200/400 时
    // 屏蔽 44 / 70 号地图（项目用地图 id 直接近似 var_132 表）。
    if (id === 7 || id === 9) id = 4;
    if (id === 44 && state < 200) id = 4;
    if (id === 70 && state < 400) id = 44;
    if (R(g, 4) === 0) id = 5;             // 590224
    if (R(g, 4) === 0) id = 11;            // 590227
    if (R(g, 6) === 0) id = 12;            // 590230
    return id;
  }

  function randName(g) {
    if (Elona.RandName && typeof Elona.RandName.randname === 'function') {
      try { return Elona.RandName.randname(g && g.rng); } catch (e) { /* 忽略 */ }
    }
    return '旅行者';
  }

  /**
   * *label_4276：在指定槽生成一个冒险者。
   * @returns {object|null} 角色对象
   */
  function spawnOne(g, slot, opt) {
    if (!g || !Elona.CharaFactory || !Elona.CharaFactory.create) return null;
    const o = opt || {};
    const p = g.player;
    const lv = o.level !== undefined ? (o.level | 0)
      : clamp(R(g, 60 + ((p && p.level) | 0)) + 1, 1, 200);   // 590192
    const sp = SPECIES[R(g, 3)];                               // 590195
    const xy = freeXY(g);
    const c = Elona.CharaFactory.create(g, sp, lv, xy.x, xy.y, { index: slot | 0 });
    if (!c) return null;

    c.set(9, 0);                                   // 590196 关系：中立
    c.set(69, 0);                                  // 590197
    c.set(156, 100);                               // 590198
    c.set(7, R(g, 33) * 2 + 1 + (c.get(8) | 0));  // 590200 图像
    c.set(150, JOB_ADVENTURER);                    // 590205 职业
    for (let f = 161; f <= 165; f++) c.set(f, R(g, 45) + 1);  // 590206-590210
    const homeMap = o.homeMap !== undefined ? (o.homeMap | 0) : pickHomeMap(g);
    const bounty = Math.floor(lv * Math.sqrt(lv + 1) * 30)
      + R(g, lv * 200 + 100) + R(g, 500);         // 590234
    c.set(34, bounty);
    c.name = o.name || randName(g);                // var_63(0, var_581)
    c.adventurer = {
      state: 3,                                   // var_58(0)=3 在场
      homeMap,
      title: o.title || TITLE[R(g, TITLE.length)],
      contractUntil: 0,                          // var_58(84)
      bounty,
      born: absHours(g),
    };
    // 只有归属地图等于当前地图的冒险者才出现在场上
    const here = g.getV65 ? (g.getV65(20) | 0) === homeMap : true;
    c.set(0, here ? 1 : 0);
    return c;
  }

  /** *label_4275：槽 16..39 全量生成（var_41 == 1 时跳过） */
  function spawnAll(g) {
    if (!g) return 0;
    if ((g.getV65 && (g.getV65(41) | 0)) === 1) return 0;   // 590182
    let n = 0;
    for (let i = ADV_FIRST; i <= ADV_LAST; i++) {
      if (g.charas && g.charas[i] && (g.charas[i].get(0) | 0) === 1) continue;
      if (spawnOne(g, i)) n++;
    }
    return n;
  }

  /** addnews（590276 / 590290）：写入 g.news，供 Journal.news() 读取 */
  function pushNews(g, type, c) {
    if (!g) return null;
    const a = c && c.adventurer;
    const who = (a && a.title ? a.title : '') + (c ? (c.name || '') : '');
    const text = type === 5
      ? `${who}回到了镇上。`
      : type === 3
        ? `${who}踏上了旅程。`
        : `${who}的近况传开了。`;
    const item = { type: type | 0, text, hour: absHours(g), name: c ? c.name : '' };
    g.news = g.news || [];
    g.news.unshift(item);
    if (g.news.length > 20) g.news.length = 20;
    return item;
  }

  /** Journal 的 - News - 段（285944 var_440） */
  function news(g) {
    const list = (g && g.news) || [];
    if (!list.length) return [{ cls: 'body', text: 'No news' }];
    return list.slice(0, 5).map((n) => ({ cls: 'body', text: n.text }));
  }

  /**
   * *label_4277 的核心刷新。源码每次地图更新调用一次；本项目按「跨日」聚合，
   * `opts.hours` 用来把 rnd(60) 的概率按实际流逝小时数折算。
   */
  function refresh(g, opts) {
    const out = { checked: 0, expired: 0, left: 0, returned: 0, moved: 0, messages: [] };
    if (!g || !g.charas) return out;
    const o = opts || {};
    const now = absHours(g);
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    const chances = Math.max(1, (o.hours | 0) || 1);
    for (let i = ADV_FIRST; i <= ADV_LAST; i++) {
      const c = g.charas[i];
      if (!c || !c.adventurer) continue;
      out.checked++;
      const a = c.adventurer;

      // 590239-590249：契约到期 → 清 cbit 969、关系归零、提示
      if (a.contractUntil && a.contractUntil < now) {
        a.contractUntil = 0;
        if (Elona.Status && Elona.Status.cbitmod) {
          try { Elona.Status.cbitmod(c, 969, false); } catch (e) { /* noop */ }
        }
        c.set(9, 0);
        out.expired++;
        out.messages.push(`${c.name} 的契约期已经结束了。`);
      }
      if (a.homeMap === mapId) continue;                 // 590253

      // 590256-590258：状态 5（已删除）→ 重新生成
      if (a.state === 5) {
        const nc = spawnOne(g, i, { homeMap: a.homeMap });
        if (nc) out.returned++;
        continue;
      }
      // 590260-590290：状态 4（离场）到期 → 回归(addnews 5) 或继续离家(addnews 3)
      if (a.state === 4 && now >= (a.awayUntil | 0)) {
        if (R(g, 3) === 0) {
          pushNews(g, 5, c);
          a.state = 5;
          spawnOne(g, i, { homeMap: a.homeMap });
          out.returned++;
        } else {
          pushNews(g, 3, c);
          a.state = 3;
          out.left++;
        }
        continue;
      }
      // 590291-590401：低概率换地图（源码 rnd(60)==0 每次地图更新）
      for (let k = 0; k < chances; k++) {
        if (R(g, 60) === 0) {
          a.homeMap = pickHomeMap(g);
          a.state = 4;
          a.awayUntil = now + 24 * 3;
          c.set(0, 0);
          out.moved++;
          break;
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------------
  // *label_4278 ~ *label_4282：背包 / 装备辅助
  // ------------------------------------------------------------------------
  /** 4278 / 590402-590412：设置手持物品（var_58(12)） */
  function setHeld(c, itemIndex) { if (c) c.set(12, itemIndex | 0); }

  /** 4279 / 590413-590456：在背包里挑一件可丢弃物品（var_99(18)==0 且非装备中） */
  function pickDiscardable(g, c) {
    const inv = (c && c.inv) || (g && g.inv) || [];
    const start = R(g, Math.max(1, inv.length));
    for (let k = 0; k < inv.length; k++) {
      const it = inv[(start + k) % inv.length];
      if (!it || (it.f && (it.f[0] | 0) === 0)) return (start + k) % inv.length;
      if (it.f && (it.f[18] | 0) !== 0) return (start + k) % inv.length;
    }
    return -1;
  }

  /** 4280 / 590457-590472：inv_getfreeid，满了就抢占一个可丢弃槽 */
  function freeItemSlot(g, c) {
    const inv = (c && c.inv) || (g && g.inv);
    if (!inv) return -1;
    for (let i = 0; i < inv.length; i++) if (!inv[i]) return i;
    return pickDiscardable(g, c);
  }

  /** 4281/4282 / 590473-590556：遍历背包，对可装备物品尝试装备 */
  function autoEquip(g, c) {
    if (!c || !Elona.ItemDB || !Elona.ItemDB.equipSlot) return 0;
    const inv = c.inv || [];
    let n = 0;
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (!it || (it.f && (it.f[18] | 0) !== 0)) continue;
      try { if (Elona.ItemDB.equipSlot(c, it)) n++; } catch (e) { /* noop */ }
    }
    return n;
  }

  Elona.Adventurer = {
    ADV_FIRST, ADV_LAST, SPECIES, JOB_ADVENTURER,
    absHours, pickHomeMap, spawnOne, spawnAll, refresh,
    pushNews, news, setHeld, pickDiscardable, freeItemSlot, autoEquip,
  };
})(typeof window !== 'undefined' ? window : globalThis);
