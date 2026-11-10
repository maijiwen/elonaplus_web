'use strict';
/**
 * 受击副作用与移动碰撞后续（core/onhit.js）—— 0-GP
 *
 * 【源码依据 hsp/start.hsp】
 *   199713-199920  *label_2044 后半（dmghp 扣血后的副作用）：
 *     199714-199726 睡眠妨害（var_58(251) / 技能 58）
 *     199727-199731 hostileaction + var_65(94)
 *     199732-199743 玩家濒死音效
 *     199744-199759 cbit 18「*カチッ*」→ cbit 972
 *     199760-199795 cbit 23 分身 / 199796-199835 cbit 27 分裂
 *     199836-199852 cbit 32 怒气（var_58(264)）
 *     199853-199889 仇恨目标（var_58(29) / 201 / 79）
 *     199891-199904 剧情击晕（var_65(193)==888 → var_58(256)=100）
 *     199905-199955 濒死：以太耐性 +1、附近同伴斗志 +5（后者由 morale.js 承担）
 *   342924-343053  *label_2989 前半：摇晃、坐骑 / 搭档演出反应、超重与荷车
 *   343081-343285  *label_2989 后半：
 *     343081-343097 撞到 271 号种族时被偷钱（var_58(30) 转移）
 *     343098-343227 演出中 NPC 与搭档的五档好感度反应、害羞分支 +20 主从
 *     343228-343229 落脚处理 *label_2992（MapFeat / onEnterCell 已承担）
 *     343232-343275 坐骑冲撞敌对 NPC：换格、伤害、畏缩、技能 301 经验
 *     343276-343285 var_183 / cbit 1049 的对话分派
 *
 * 【差异】`copy_chara` 用「按种族重新生成 + 复制关键字段」近似（见 itemfx_use.js
 *   的同族分身实现）；坐骑冲撞伤害式尾部在源码行内被截断，按可见部分 + 等级项
 *   近似；`var_58(3/4)` 的摇晃偏移由项目一次一格输入替代，不改写目标格。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let cached = null;
  function table() {
    if (!cached) {
      cached = (Elona.OnHitData && Elona.OnHitData.hit) ? Elona.OnHitData : null;
      if (!cached && Elona.Data && Elona.Data.tableSync) {
        try { cached = Elona.Data.tableSync('onhit'); } catch (e) { cached = null; }
      }
    }
    return (cached && cached.hit) ? cached : null;
  }

  const idiv = (a, b) => Math.trunc((a | 0) / (b || 1));
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);
  const SET = (c, n, v) => { if (c && typeof c.set === 'function') c.set(n, v | 0); };
  const V = (g, n) => (g && typeof g.getV65 === 'function' ? (g.getV65(n) | 0) : 0);
  const S = (g, n, v) => { if (g && typeof g.setV65 === 'function') g.setV65(n, v | 0); };
  function R(g) {
    const o = (g && g.rng) ? g.rng : (Elona.rng || null);
    return (n) => (o && typeof o.rnd === 'function') ? o.rnd(Math.max(1, n | 0)) : 0;
  }
  function sk(c, id) { return (c && typeof c.skill === 'function') ? (c.skill(id) | 0) : 0; }
  function cbit(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, bit | 0) | 0) : 0;
  }
  function cbitmod(c, bit, on) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit | 0, on | 0);
  }
  function findbuff(c, id) {
    if (Elona.Status && Elona.Status.findbuff) {
      try { return Elona.Status.findbuff(c, id | 0) | 0; } catch (e) { return -1; }
    }
    return -1;
  }
  function mapType(g) {
    try { return (g.map && g.map.header) ? (g.map.header[6] | 0) : 0; } catch (e) { return 0; }
  }
  function nameOf(c) { return (c && c.name) ? c.name : '???'; }
  function text(T, key, c, g) {
    const t = (T.texts && T.texts[key]) || null;
    if (!t) return '';
    const jp = (g && g.lang === 'jp');
    let s = jp ? t.jp : t.en;
    if (key === 'sleep') return nameOf(c) + (jp ? 'は眠りを妨げられた。' : ' 的睡眠被打扰了。');
    if (key === 'runOver') return jp ? (nameOf(c) + 'を轢いた。') : ('You blew ' + nameOf(c) + '.');
    if (key === 'glare' || key === 'dissatisfied' || key === 'disappointed'
      || key === 'nod' || key === 'stepBack' || key === 'stare' || key === 'falter'
      || key === 'splitMan' || key === 'splitCell' || key === 'fury') {
      return jp ? (nameOf(c) + s) : (nameOf(c) + ' ' + s);
    }
    return s;
  }
  function say(out, T, key, c, g) {
    const s = text(T, key, c, g);
    if (s) out.messages.push(s);
    return s;
  }

  // =========================================================================
  // 一、*label_2044：受击副作用（199713-199920）
  // =========================================================================

  /** 分身 / 分裂：copy_chara 的项目近似（同族重新生成 + 复制关键字段） */
  function copyChara(g, src, out) {
    if (!Elona.CharaFactory || !Elona.CharaFactory.create) return null;
    let c = null;
    try {
      c = Elona.CharaFactory.create(g, G(src, 27), Math.max(1, G(src, 38)), src.x | 0, src.y | 0, {});
    } catch (e) { c = null; }
    if (!c) return null;
    for (const f of [8, 7, 435, 13, 25, 17, 19, 20, 21, 61]) SET(c, f, G(src, f));
    c.name = src.name;
    out.clones++;
    return c;
  }

  /** 分身 / 分裂的条件链（199760-199795 / 199796-199835 共用） */
  function canSplit(g, def, dmg, rule, rnd) {
    if (G(def, 150) === 3) return false;
    if (G(def, 58) !== 0) return false;
    if (V(g, 809) === 1) return false;
    if (rule.key === 'split27') {
      if (rnd(3) !== 0) return false;
      for (const f of [254, 256, 250, 252, 253]) if (G(def, f) !== 0) return false;
    }
    const hpMax = Math.max(1, G(def, 51) || (def.hpMax | 0));
    if (!(dmg > idiv(hpMax, 10))) return false;
    if (!(G(def, 50) > idiv(hpMax, 3))) return false;
    if (!(G(def, 25) < 4 || dmg > idiv(hpMax, 6))) return false;
    if (V(g, 193) !== 0) return false;
    if (mapType(g) === 1) return false;
    return true;
  }

  /**
   * 由 Battle.applyDamage 在扣血之后调用。
   * @returns {{ok:boolean, keys:Array, messages:Array, clones:number, dying:boolean}}
   */
  function onDamage(g, def, att, dmg, attr) {
    const T = table();
    if (!T) return { ok: false, reason: 'no-table' };
    if (!def || (dmg | 0) <= 0) return { ok: true, keys: [], messages: [], clones: 0, dying: false };
    const rnd = R(g);
    const d = dmg | 0, A = attr | 0;
    const attIdx = att ? (att.index | 0) : -1;
    const out = { ok: true, keys: [], messages: [], clones: 0, dying: false, fields: {} };

    for (const rule of T.hit.rules) {
      switch (rule.key) {
        case 'sleep': {
          if (G(def, rule.field) <= 0) break;
          if (rule.excludeAttr.indexOf(A) >= 0) break;
          const left = rnd(clamp(sk(def, rule.skill), 5, 1000));
          const right = rnd(clamp(G(def, rule.field), 5, 1000) + 1000);
          if (left >= right) {
            SET(def, rule.field, 0);
            say(out, T, 'sleep', def, g);
            out.keys.push('sleep');
          }
          break;
        }
        case 'hostile': {
          if (attIdx !== rule.attacker) break;
          S(g, rule.v65, def.index | 0);
          if (Elona.Relation && Elona.Relation.hostileAction) {
            try { Elona.Relation.hostileAction(g, att, def); } catch (e) { /* noop */ }
          }
          out.fields.anger = rule.anger;
          out.keys.push('hostile');
          break;
        }
        case 'nearDeathSound': {
          if ((def.index | 0) !== rule.target) break;
          const hpMax = Math.max(1, G(def, 51) || (def.hpMax | 0));
          if (idiv(hpMax, rule.hpDiv) > (def.hp | 0)) {
            out.fields.sound = rule.snd;
            out.keys.push('nearDeathSound');
          }
          break;
        }
        case 'camera': {
          if (!cbit(def, rule.bit)) break;
          if (rnd(rule.denom) !== 0) break;
          if (G(def, rule.etherField) !== 0) break;
          if (G(def, rule.stunField) >= rule.stunMax) break;
          cbitmod(def, rule.setBit, 1);
          say(out, T, rule.text, def, g);
          out.keys.push('camera');
          break;
        }
        case 'split23':
        case 'split27': {
          if (!cbit(def, rule.bit)) break;
          if (!canSplit(g, def, d, rule, rnd)) break;
          const clone = copyChara(g, def, out);
          if (!clone) break;
          const race = G(def, 27);
          let tag = '';
          if (Elona.EnchantFX && Elona.EnchantFX.raceTag) {
            try { tag = Elona.EnchantFX.raceTag(race) || ''; } catch (e) { tag = ''; }
          }
          const isMan = tag.indexOf('/man/') >= 0 || race === 429 || race === 479;
          say(out, T, isMan ? rule.textMan : rule.textCell, def, g);
          out.keys.push(rule.key);
          break;
        }
        case 'fury': {
          if (!cbit(def, rule.bit)) break;
          if (V(g, 809) === 1) break;
          if (G(def, 264) !== 0) break;
          if (rnd(rule.denom) !== 0) break;
          say(out, T, rule.text, def, g);
          SET(def, rule.field, G(def, rule.field) + rnd(rule.add[0]) + rule.add[1]);
          out.keys.push('fury');
          break;
        }
        case 'hate': {
          if (attIdx < 0) break;
          if (G(def, 29) === 0 && G(def, 201) === 0) {
            const rel = G(def, 9), arel = G(att, 69);
            if (rel === -3 && arel > -3) SET(def, 29, attIdx);
            if (rel > -3 && arel === -3) SET(def, 29, attIdx);
            if (rel > -3 && arel > -3 && rel !== 10 && (def.index | 0) !== 0) {
              if (G(att, 29) === (def.index | 0)) SET(def, 29, attIdx);
              else SET(def, 201, -2);
            }
          }
          if ((def.index | 0) !== 0) {
            if (G(def, 201) === 0) { SET(def, 79, 218); SET(def, 201, 20); }
            else SET(def, 201, G(def, 201) + 2);
          }
          out.keys.push('hate');
          break;
        }
        case 'knockout': {
          if (V(g, 193) !== rule.v193) break;
          const hpMax = Math.max(1, G(def, 51) || (def.hpMax | 0));
          if ((def.hp | 0) > idiv(hpMax, rule.hpDiv) && (def.hp | 0) !== 0) break;
          if (G(def, rule.field) >= 100) break;
          SET(def, rule.field, rule.value);
          say(out, T, rule.text, def, g);
          out.fields.sound = 122;
          out.keys.push('knockout');
          break;
        }
        case 'dying': {
          if ((def.hp | 0) > 0) break;
          SET(def, rule.etherField, Math.min(100, G(def, rule.etherField) + rnd(3) + 1));
          // 199945-199952 的附近同伴斗志 +5 由 Morale.onKill 承担，这里不重复累加。
          out.dying = true;
          out.keys.push('dying');
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  // =========================================================================
  // 二、*label_2989：移动碰撞后续（343081-343285）
  // =========================================================================

  function dateCode(g) {
    return V(g, 10) * 10000 + V(g, 11) * 100 + V(g, 12);
  }

  /** 按 var_58(17)+var_58(169) 五档取反应文案（343142-343176 / 343187-343221） */
  function reactionKey(T, c) {
    const sum = G(c, 17) + G(c, 169);
    const th = T.bump.reaction.thresholds;
    let i = 0;
    while (i < th.length && sum >= th[i]) i++;
    return T.bump.reaction.texts[i];
  }

  /** 单个角色的演出反应（343098-343181 / 343182-343227） */
  function reactOne(g, T, c, out) {
    const r = T.bump.reaction;
    if (G(c, r.rowact) !== 1 || G(c, r.rowleft) <= 0) return false;
    const shy = cbit(c, r.shyBit) === 1;
    const shyDone = shy && G(c, r.rowarg) >= r.shyTurn;
    if (shy) {
      if (shyDone) {
        say(out, T, r.shyText, c, g);
        SET(c, r.rowact, 0); SET(c, r.rowleft, 0);
      }
      const date = dateCode(g);
      if (G(c, r.dateField) < date) {
        if (Elona.Relation && Elona.Relation.modimp2) {
          try { Elona.Relation.modimp2(c, r.impDelta, g); } catch (e) { /* noop */ }
        }
        SET(c, r.dateField, date);
        out.imp.push(c.index | 0);
      }
    } else {
      say(out, T, reactionKey(T, c), c, g);
      SET(c, r.rowact, 0); SET(c, r.rowleft, 0);
      out.reactions.push({ idx: c.index | 0, sum: G(c, 17) + G(c, 169) });
    }
    return true;
  }

  /**
   * 交换位置后的后续（343081-343227）。
   * @returns {{ok:boolean, stolen:number, reactions:Array, imp:Array, messages:Array}}
   */
  function onSwap(g, p, target) {
    const T = table();
    if (!T) return { ok: false, reason: 'no-table' };
    const rnd = R(g);
    const out = { ok: true, stolen: 0, reactions: [], imp: [], messages: [] };
    const st = T.bump.steal;
    if (G(target, 27) === st.race && rnd(st.denom) === 0 && G(target, st.sleepField) === 0) {
      let amount = rnd(clamp(G(p, st.goldField), 0, st.maxGold) + 1);
      if (cbit(p, st.blockBit)) amount = 0;
      if (amount !== 0) {
        SET(p, st.goldField, G(p, st.goldField) - amount);
        SET(target, st.goldField, G(target, st.goldField) + amount);
        out.stolen = amount;
        say(out, T, st.text, target, g);
      }
    }
    reactOne(g, T, target, out);
    if (G(target, T.bump.reaction.partnerFlag) !== 0) {
      const idx = G(target, T.bump.reaction.partnerIdx);
      const partner = g.charas && g.charas[idx];
      if (partner) reactOne(g, T, partner, out);
    }
    return out;
  }

  /**
   * 坐骑冲撞敌对 NPC（343232-343275）。
   * 成功后由调用方统一 endTurn；返回 ok:false 时调用方应退回普通攻击。
   */
  function tryMountCharge(g, p, target) {
    const T = table();
    if (!T) return { ok: false };
    const c = T.bump.charge;
    if (V(g, c.mountV65) === 0) return { ok: false, reason: 'no-mount' };
    if (G(target, c.relationField) >= c.relationMax) return { ok: false, reason: 'not-hostile' };
    if (findbuff(p, c.buff) === -1) return { ok: false, reason: 'no-buff' };
    if (G(target, 140) === 30 || G(target, 140) === 31) return { ok: false, reason: 'rowact' };
    const rnd = R(g);
    const out = { ok: true, charge: true, messages: [], damage: 0, falter: false, skill: false };

    SET(p, c.targetField, target.index | 0);
    if (cbit(target, 6) === 1 && cbit(p, 7) === 0 && G(target, 259) === 0) {
      SET(p, c.targetField, 0);
    }
    // cell_swap var_243, var_244（不复用 swapWith：它会额外 endTurn）
    const px = p.x | 0, py = p.y | 0;
    p.x = target.x | 0; p.y = target.y | 0;
    target.x = px; target.y = py;
    if (g && typeof g.syncCharaCells === 'function') g.syncCharaCells();
    say(out, T, c.text, target, g);
    out.fields = { sound: 73 };

    // 343257：伤害式（源码尾部被行宽截断，按可见部分 + 等级项近似）
    const dmg = (idiv(sk(p, 15), 5) + 5)
      * (idiv(sk(p, c.skill) + 1, 5) + 5)
      + rnd(sk(p, 18) + 5)
      + clamp(G(p, 38) - 50, 1, 2000);
    if (Elona.Battle && Elona.Battle.applyDamage) {
      out.damage = Elona.Battle.applyDamage(target, dmg, g, p, 64, 1000);
    } else {
      target.hp = Math.max(0, (target.hp | 0) - dmg);
      out.damage = dmg;
    }
    if (G(target, c.falterField) <= 0) {
      SET(target, c.falterField, c.falterValue);
      say(out, T, c.falterText, target, g);
      out.falter = true;
    }
    const skipBits = [23, 27, 964, 960, 992, 985];
    const skip = skipBits.some((b) => cbit(target, b) === 1) || (target.index | 0) === 0;
    if (!skip && Elona.Stats && Elona.Stats.skillExp) {
      Elona.Stats.skillExp(p, c.skill, p, c.skillExpPc, 0, 0, g);
      const mount = g.charas && g.charas[V(g, c.mountV65)];
      if (mount) Elona.Stats.skillExp(mount, c.skill, mount, c.skillExpMount, 0, 0, g);
      out.skill = true;
    }
    return out;
  }

  /**
   * 移动前的摇晃 / 坐骑与搭档的演出反应（342926-343027）。
   * 摇晃导致的 var_58(3/4) 偏移由一次一格输入替代，只记录不改写目标格。
   */
  function onBeforeMove(g, p) {
    const T = table();
    if (!T) return { ok: false, reason: 'no-table' };
    const rnd = R(g);
    const f = T.bump.front;
    const out = { ok: true, staggered: false, offsetX: 0, offsetY: 0, messages: [], reactions: [] };
    let flag = 0;
    if (G(p, f.staggerField) !== 0 && rnd(5 + G(p, f.staggerMod)) === 0) {
      say(out, T, 'stagger', p, g);
      flag = 1;
      out.staggered = true;
    }
    if (G(p, f.stunFields[0]) !== 0 || G(p, f.stunFields[1]) !== 0 || flag) {
      out.offsetX = rnd(3) - 1;
      out.offsetY = rnd(3) - 1;
    }
    // 坐骑 / 搭档演出中的五档反应（342942-343027）
    const r = T.bump.reaction;
    const ids = [V(g, f.mountV65 || 183), G(p, T.bump.tag.partnerIdx)];
    for (const idx of ids) {
      if (!idx || !g.charas || !g.charas[idx]) continue;
      const c = g.charas[idx];
      if (G(c, r.rowact) === 0 || G(c, r.rowleft) <= 0) continue;
      const key = reactionKey(T, c);
      const s = text(T, key, c, g);
      if (s) out.messages.push(s);
      SET(c, r.rowact, 0); SET(c, r.rowleft, 0);
      out.reactions.push(idx | 0);
    }
    return out;
  }

  /** 343281-343285：cbit 1049 的角色撞上去走对话窗口 */
  function wantsDialogue(target) { return cbit(target, 1049) === 1; }

  Elona.OnHit = { onDamage, canSplit, copyChara, table };
  Elona.Bump = { onSwap, tryMountCharge, onBeforeMove, wantsDialogue, reactionKey, dateCode, table };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OnHit: Elona.OnHit, Bump: Elona.Bump };
  }
})(typeof window !== 'undefined' ? window : global);
