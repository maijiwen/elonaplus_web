'use strict';
/**
 * 死亡原因与尸体清理（core/deathmsg.js）—— 0-GQ
 *
 * 【源码依据 hsp/start.hsp】
 *   200036           普通击杀：`var_1165 = "<攻击者>に殺された。"`
 *   200039-200328    按 `prm_987` 的负值来源设置 `var_1165`（死因）与
 *                    `txt_select`（死亡播报）：陷阱 / 毒 / 饿死 / 诅咒 /
 *                    楼梯 / 听众 / 烧死 / 食中毒 / 以太病 / 溶解 / 属性残滓 /
 *                    自杀 / 核爆 / 铁处女 / 断头台 / 绞首 / 窒息 / 压死 等 25 条
 *   200330-200348    尸体清理：`cell_removechara`、`cbit(983)` 的血迹 / 碎片、
 *                    `spillblood` / `spillfrag`；
 *                    `prm_987` 为 -30 / -31 时跳过血迹
 *   200349-200455    经验 / 掉落 / 盗窃（killreward.js / loot.js / battle.js 已覆盖）
 *
 * 【差异】血痕与碎片记入 `g.bloodStains`（渲染层数据，上限 256），
 *   不占用 `mef` 的 32 个战斗槽；`animeblood` 的粒子动画由 Canvas 层按需表现。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let cached = null;
  function table() {
    if (!cached) {
      cached = (Elona.DeathTextData && Elona.DeathTextData.causes) ? Elona.DeathTextData : null;
      if (!cached && Elona.Data && Elona.Data.tableSync) {
        try { cached = Elona.Data.tableSync('deathtexts'); } catch (e) { cached = null; }
      }
    }
    return (cached && cached.causes) ? cached : null;
  }

  const MAX_STAINS = 256;
  function nameOf(c) { return (c && c.name) ? c.name : '???'; }
  function langOf(g) { return (g && g.lang === 'jp') ? 'jp' : 'en'; }
  function fill(s, ctx) {
    return String(s || '')
      .replace(/\{name\}/g, ctx.name)
      .replace(/\{item\}/g, ctx.item)
      .replace(/\{attacker\}/g, ctx.attacker)
      .replace(/\{is\}/g, ctx.is)
      .replace(/\{his\}/g, ctx.his);
  }

  /** prm_987 的来源：攻击者 index；无攻击者时 -1（陷阱 / 环境） */
  function sourceOf(att, opts) {
    if (opts && opts.source !== undefined && opts.source !== null) return opts.source | 0;
    if (att && att.index !== undefined) return att.index | 0;
    return -1;
  }

  /**
   * 死因短句（var_1165）。
   * @param {object} g
   * @param {object} def 死者
   * @param {number} source prm_987
   * @param {{attacker?:string,item?:string}} [ctx]
   * @returns {string}
   */
  function text(g, def, source, ctx) {
    const T = table();
    if (!T) return '';
    const lang = langOf(g);
    const c = Object.assign({
      name: nameOf(def),
      attacker: (ctx && ctx.attacker) || 'someone',
      item: (ctx && ctx.item) || 'backpack',
      is: 'is', his: 'his',
    }, ctx || {});
    const key = String(source | 0);
    if (causesHas(T, key)) return fill(T.causes[key][lang] || T.causes[key].en, c);
    if ((source | 0) >= 0) return fill(T.killedBy[lang] || T.killedBy.en, c);
    return '';
  }

  function causesHas(T, key) {
    return Object.prototype.hasOwnProperty.call(T.causes, key);
  }

  /** 死亡播报（txt_select） */
  function message(g, def, source, ctx) {
    const T = table();
    if (!T) return '';
    const lang = langOf(g);
    const key = String(source | 0);
    const m = T.messages[key];
    if (!m) return '';
    return fill(m[lang] || m.en, Object.assign({
      name: nameOf(def), item: 'backpack', attacker: 'someone', is: 'is', his: 'his',
    }, ctx || {}));
  }

  /**
   * 记录死因并写日志。
   * @returns {{ok:boolean, cause:string, message:string}}
   */
  function log(g, def, source, ctx) {
    const T = table();
    if (!T) return { ok: false, cause: '', message: '' };
    const cause = text(g, def, source, ctx);
    const msg = message(g, def, source, ctx);
    if (def) {
      def.__deathCause = cause;
      def.__deathSource = source | 0;
    }
    if (g) {
      g.lastDeathCause = cause;
      g.lastDeathSource = source | 0;
      if (typeof g.log === 'function') {
        if (msg) g.log(msg);
        else if (cause) g.log(`${nameOf(def)}：${cause}`);
      }
    }
    return { ok: true, cause, message: msg };
  }

  /**
   * 尸体清理（200330-200348）：移除占格 + 血痕 / 碎片。
   * @returns {{ok:boolean, removed:boolean, stains:number, frag:boolean}}
   */
  function cleanup(g, def, source) {
    const T = table();
    if (!T) return { ok: false, removed: false, stains: 0, frag: false };
    const out = { ok: true, removed: false, stains: 0, frag: false };
    // 200330-200332：cell_removechara（不在骑乘状态时清占格）
    if (g && typeof g.syncCharaCells === 'function') {
      g.syncCharaCells();
      out.removed = true;
    }
    const skip = (T.cleanup.skipSource || []).indexOf(source | 0) >= 0;
    if (skip || !def) return out;
    const x = def.x | 0, y = def.y | 0;
    const frag = (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(def, T.cleanup.fragBit) | 0) === 1 : false;
    out.frag = frag;
    const n = frag ? T.cleanup.fragCount : T.cleanup.bloodCount;
    if (g) {
      if (!Array.isArray(g.bloodStains)) g.bloodStains = [];
      if (g.bloodStains.length < MAX_STAINS) {
        g.bloodStains.push({ x, y, frag, n });
        out.stains = 1;
      }
    }
    return out;
  }

  Elona.DeathMsg = { table, text, message, log, cleanup, sourceOf, MAX_STAINS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.DeathMsg;
})(typeof window !== 'undefined' ? window : global);
