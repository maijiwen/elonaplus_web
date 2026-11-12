'use strict';
/**
 * 0-GX：吃尸体（item 204）时的物种特殊效果 —— 还原 start.hsp 的 `var_59 = 12` 分支。
 *
 * 证据：
 *   226061-226065  if (var_99(3,var_579) == 204 & var_99(31,var_579) != 1)
 *                     var_59 = 12; var_60 = var_99(23,var_579); gosub *label_3105
 *                 即：只有「非腐烂的尸体」才会触发物种被吃效果。
 *   226800-227330  *label_2305 .. *label_2336 各种效果（难度、毒素、狂气、寄生……）
 *   对应的物种→效果表由 tools/extract_eat_effects.py 从源码机械抓取，
 *   tools/normalize_eat.py 规范化为 data/tables/eat_effects_norm.json。
 *
 * 说明：原版 var_98(n) 只是 UI 标记（角色窗的寄生图标），本实现依赖 cbit 状态，故不写。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const EatFX = {};

  let DATA = null;
  let loading = null;

  /** 读取规范化后的效果表（只读一次） */
  EatFX.load = function () {
    if (DATA) return Promise.resolve(DATA);
    if (loading) return loading;
    loading = Elona.Data.table('eat_effects_norm').then(function (d) {
      DATA = d;
      return d;
    });
    return loading;
  };

  EatFX.ready = function () { return !!DATA; };

  /** 角色显示名（与 Game.finishEating 的取名规则一致） */
  function nameOf(c) {
    if (!c) return '某人';
    if ((c.index | 0) === 0) return '你';
    if (typeof c.name === 'function') return c.name('zh') || c.name('en') || '某人';
    return c.name || '某人';
  }

  /** 设置 cbit（原版 cbitmod），失败时静默 */
  function cbitmod(c, bit, on) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit, on);
  }
  function cbit(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, bit) : 0;
  }
  function hasBuff(c, id) {
    return (Elona.Status && Elona.Status.findbuff) ? Elona.Status.findbuff(c, id) !== -1 : false;
  }

  /**
   * 执行一条规范化行动。
   * @param {object} g 游戏实例
   * @param {object} c 进食者
   * @param {object} a 行动对象
   * @param {object} ctx { messages, nutrition }
   */
  function runEffect(g, c, a, ctx, depth) {
    if (!a || depth > 4) return;
    switch (a.k) {
      case 'dmgcon':
        if (Elona.Resist && g.dmgconTable) Elona.Resist.dmgcon(g, g.dmgconTable, c, a.elem, a.pow);
        break;
      case 'dmgsan':
        if (Elona.Status && Elona.Status.dmgsan) Elona.Status.dmgsan(c, a.n, g);
        break;
      case 'healsan':
        if (Elona.Status && Elona.Status.healsan) Elona.Status.healsan(c, a.n);
        break;
      case 'healcon':
        if (Elona.Status && Elona.Status.healcon) Elona.Status.healcon(c, a.kind, a.pow);
        break;
      case 'resistmodh':
      case 'resistmod':
        if (Elona.Resist) {
          const fn = a.k === 'resistmodh' ? Elona.Resist.resistModH : Elona.Resist.resistMod;
          const out = fn ? fn(c, a.elem, a.val) : null;
          if (out && out.message) ctx.messages.push(out.message);
        }
        break;
      case 'skillexp':
        if (Elona.Stats && Elona.Stats.skillExp) {
          Elona.Stats.skillExp(c, a.skill, c, a.exp, 1, 0, g);
        }
        break;
      case 'skillexp2':
        if (Elona.Stats && Elona.Stats.skillExp) {
          const exp = (c.index | 0) === 0 ? a.expP : a.expN;   // 2332：玩家 2000 / NPC 8000
          Elona.Stats.skillExp(c, a.skill, c, exp, 1, 0, g);
        }
        break;
      case 'karma':
        // modkarma：只有玩家（角色 0）有意义（var_58(49)）
        if ((c.index | 0) === 0 && typeof g.modkarma === 'function') g.modkarma(a.n);
        break;
      case 'corrupt':
        if ((c.index | 0) === 0 && Elona.Weather && Elona.Weather.modCorrupt) {
          try { Elona.Weather.modCorrupt(g, a.n); } catch (e) { /* 忽略未初始化 */ }
        }
        break;
      case 'nutrition':
        ctx.nutrition = a.value;                              // label_2302：营养固定 1000
        break;
      case 'set430':
        c.set(430, a.value);                                  // var_58(430)
        break;
      case 'label':
        runLabel(g, c, a.name, ctx, depth + 1);
        break;
      default:
        break;
    }
  }

  /** 执行 *label_NNNN（对应表里的 labels 条目） */
  function runLabel(g, c, name, ctx, depth) {
    if (!DATA || depth > 4) return;
    const L = DATA.labels[name];
    if (!L) return;
    if (L.playerOnly && (c.index | 0) !== 0) return;           // `if (var_243 != 0) return`
    if (L.msg) ctx.messages.push(L.msg.replace(/\{name\}/g, nameOf(c)));
    for (const a of (L.effects || [])) runEffect(g, c, a, ctx, depth);
    if (L.special === 'brain_parasite') brainParasite(g, c, ctx);
    if (L.special === 'abdomen_parasite') abdomenParasite(g, c, ctx);
  }

  /** *label_2333 → *label_2334：脑髓寄生 */
  function brainParasite(g, c, ctx) {
    const T = (DATA && DATA.text) || {};
    if ((c.get(42) | 0) <= -1000000) {                        // 227194：无法寄生（腹中状态）
      ctx.messages.push(T['2334_decomposed'] || '但是立刻就分解了。');
      return;
    }
    if ((c.index | 0) === 0 && Elona.Feat && Elona.Feat.get && (Elona.Feat.get(c, 220) | 0) !== 0) {
      ctx.messages.push(T['2334_flower'] || '但是立刻被花吸收了。');
      return;
    }
    if (hasBuff(c, 48)) {                                     // 227216：encfind(48) 寄生 buff
      ctx.messages.push(T['2334_pushed'] || '但是立刻被弹了出来。');
      return;
    }
    if (cbit(c, 1045) === 0) {                                // 227226
      ctx.messages.push((DATA.labels.label_2334.msg || '{name}的脑髓被寄生了。').replace(/\{name\}/g, nameOf(c)));
      cbitmod(c, 1045, true);
      // 原版这里还写 var_98(265)=1（UI 寄生图标），本项目由 cbit 推导，无需重复。
    }
  }

  /** *label_2335 → *label_2336：腹部寄生 */
  function abdomenParasite(g, c, ctx) {
    const T = (DATA && DATA.text) || {};
    if ((c.get(42) | 0) <= -1000000) {
      ctx.messages.push(T['2336_decomposed'] || '但是立刻就分解了。');
      return;
    }
    if ((c.index | 0) === 0 && Elona.Feat && Elona.Feat.get && (Elona.Feat.get(c, 220) | 0) !== 0) {
      ctx.messages.push(T['2336_flower'] || '但是立刻被花吸收了。');
      return;
    }
    if (hasBuff(c, 48)) {
      ctx.messages.push(T['2336_puked'] || '但是立刻吐了出来。');
      return;
    }
    if (cbit(c, 978) === 0) {                                 // 227289
      ctx.messages.push((DATA.labels.label_2336.msg || '{name}被寄生了。').replace(/\{name\}/g, nameOf(c)));
      c.set(430, 0);                                          // var_58(430) = 0（var_1596 为空时）
      cbitmod(c, 978, true);
    }
  }

  /**
   * 吃下非腐烂尸体后的物种特殊效果。
   * @param {object} g 游戏实例
   * @param {object} c 进食者（原版 var_243）
   * @param {number} species 尸体物种 id（原版 var_99(23, var_579)）
   * @returns {{messages:string[], nutrition:number|null}|null}
   */
  EatFX.apply = function (g, c, species) {
    if (!DATA || !c) return null;
    const acts = DATA.species[String(species | 0)];
    if (!acts || !acts.length) return null;
    const ctx = { messages: [], nutrition: null };
    for (const a of acts) runEffect(g, c, a, ctx, 0);
    return ctx;
  };

  Elona.EatFX = EatFX;
})(window);
