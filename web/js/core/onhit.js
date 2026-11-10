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
  // 〇、*label_2044 前半（199519-199712）：酸蚀装备 / 恐惧失禁 / 元素附加状态
  // =========================================================================

  function preTexts(T) { return (T && T.preTexts) ? T.preTexts : {}; }

  /** 199544 / 199560 / 199594 / 199602 都是「名字 + 固定句」的拼接 */
  function preLine(T, key, c, itemName, g) {
    const t = preTexts(T)[key];
    if (!t) return '';
    const nm = nameOf(c);
    if (key === 'acidDamage') return `${nm}的${itemName}因伤害而损坏了。`;
    if (key === 'acidMelted') return `${nm}的${itemName}崩碎散落了。`;
    if (key === 'fear') return `${nm}吓得动弹不得。`;
    if (key === 'urine') return `${nm}失禁了。`;
    if (key === 'relief') return '「……畅快！」';
    return '';
  }

  /**
   * 199520-199571：Abnormal 模式（`var_65(273)==1`）下，受到 >= 最大 HP/5 的伤害时
   * 随机腐蚀一件**装备中**的物品（耐久 -1，<-10 时崩碎并卸下）。
   */
  function acidErode(g, def, att, dmg, P, rnd, out) {
    const A = P.acid;
    if (V(g, 273) !== A.modeValue) return null;
    if (!att) return null;                                     // 199521：prm_987 >= 0
    const hpMax = Math.max(1, G(def, 51) || (def.hpMax | 0));
    if (!(dmg >= idiv(hpMax, A.hpDiv))) return null;           // 199522
    let idx = -1;
    for (let body = 0; body < A.scans; body++) {               // 199524-199537
      const v = G(def, body);
      if (idiv(v, 10000) === 0) break;
      const slot = (v % 10000) - 1;
      if (slot === -1) continue;
      if (rnd(A.pickDenom) === 0) { idx = slot; break; }
    }
    if (idx < 0) return null;
    const IT = Elona.ItemDB;
    const it = def.inv && def.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return null;
    it.f[A.durabilityField] = (it.f[A.durabilityField] | 0) - 1;
    out.messages.push(preLine(table(), 'acidDamage', def, IT ? IT.name(it.id, 'ch') : it.id, g));
    if ((it.f[A.durabilityField] | 0) < A.breakAt) {           // 199554-199567
      out.messages.push(preLine(table(), 'acidMelted', def, IT ? IT.name(it.id, 'ch') : it.id, g));
      it.f[0] = (it.f[0] | 0) - 1;
      const bodySlot = it.eqSlot | 0;
      if (bodySlot >= 0) {
        const raw = 100 + bodySlot;
        SET(def, raw, idiv(G(def, raw), 10000) * 10000);
        it.eqSlot = -1;
      }
      if (Elona.Stats && Elona.Stats.recalcStats) Elona.Stats.recalcStats(def, g);
    }
    out.keys.push('acid');
    return idx;
  }

  /**
   * 199573-199631：重伤（HP < 最大/5）的角色受击时有概率陷入恐惧；
   * 水分 > 12000 时同时失禁，在脚下留下 1115「ジョロジョロ」，水分回到 5000。
   */
  function fearCheck(g, def, dmg, P, rnd, out) {
    const F = P.fear;
    if ((def.index | 0) === F.meIndex) return false;           // 199574：prm_985 != 0
    const hpMax = Math.max(1, G(def, 51) || (def.hpMax | 0));
    if (!((def.hp | 0) < idiv(hpMax, F.hpDiv))) return false;  // 199573
    if (G(def, F.fearField) !== 0) return false;               // 199575
    if (cbit(def, F.immuneBit)) return false;                  // 199576
    // 199577 的 `var_58(25) >= 4` 会被 199580 的结果直接覆盖，源码上是死分支
    const chance = idiv(dmg * F.dmgScale, hpMax) + F.base;
    if (!(chance > rnd(F.denom))) return false;                // 199580
    SET(def, F.fearField, rnd(F.turnsBase) + F.turnsAdd);      // 199587
    out.messages.push(preLine(table(), 'fear', def, '', g));
    out.keys.push('fear');
    if (G(def, F.waterField) > F.waterMax) {                   // 199596
      out.messages.push(preLine(table(), 'urine', def, '', g));
      out.keys.push('urine');
      if (mapType(g) !== 1) {                                  // 199612-199623
        const IT = Elona.ItemDB;
        if (IT && IT.createItem) {
          const it = IT.createItem(F.urineItem, 1, g.rng);
          if (it) {
            it.f[5] = def.x | 0; it.f[6] = def.y | 0; it.f[21] = -1;
            if (g.groundItems) g.groundItems.push(it);
            if (g.refreshGroundCell) g.refreshGroundCell(def.x, def.y);
          }
        }
      }
      SET(def, F.waterField, F.waterReset);                    // 199624
      // 199604-199610：玩家还会自嘲一句
      if ((def.index | 0) === F.meIndex) out.messages.push(preLine(table(), 'relief', def, '', g));
    }
    return true;
  }

  /**
   * 199632-199696：按伤害属性附加状态（`dmgcon`）与道具破坏。
   *   - 50 火 / 51 冷：攻击者持有 941 / 1172 时免疫，否则 item_fire / item_cold
   *   - 63 酸：玩家或 1/3 概率 → item_acid
   *   - 62 精気：玩家 → modcorrupt
   */
  function elemental(g, def, att, dmg, elem, power, P, rnd, out) {
    const R2 = Elona.Resist;
    const tbl = g && g.dmgconTable;
    const attIdx = att ? (att.index | 0) : -1;
    const hpMax = Math.max(1, G(def, 51) || (def.hpMax | 0));
    for (const e of P.elements) {
      if ((e.elem | 0) !== (elem | 0)) continue;
      for (const c of e.conds) {
        if (!R2 || !tbl) break;
        const base = idiv(power, c.div) * c.mul;
        const pw = clamp(rnd(base + 1), 1, c.cap);
        try { R2.dmgcon(g, tbl, def, c.id, pw); } catch (err) { /* noop */ }
        out.keys.push('dmgcon' + c.id);
      }
    }
    for (const s of P.specials) {
      if ((s.elem | 0) !== (elem | 0)) continue;
      if (s.kind === 'cond') {
        if (R2 && tbl) {
          try { R2.dmgcon(g, tbl, def, s.id, rnd(power + 1)); } catch (err) { /* noop */ }
          out.keys.push('dmgcon' + s.id);
        }
      } else if (s.kind === 'corrupt') {
        if ((def.index | 0) === 0 && Elona.Weather && Elona.Weather.modCorrupt) {
          try { Elona.Weather.modCorrupt(g, rnd(power + 1)); } catch (err) { /* noop */ }
          out.keys.push('corrupt');
        }
      } else if (s.kind === 'itemAcid') {
        if (((def.index | 0) === 0 || rnd(3) === 0) && Elona.ItemDB && Elona.ItemDB.itemAcid) {
          const r = Elona.ItemDB.itemAcid(def, def.index | 0, -1, g);
          for (const m of (r.messages || [])) out.messages.push(m);
          if (r.ok) out.keys.push('itemAcid');
        }
      }
    }
    // 199644-199656：火 / 冰伤害破坏道具（攻击者持有吸收道具时免疫）
    const guard = P.guards[String(elem | 0)];
    if (guard && Elona.ItemDB) {
      const immune = attIdx >= 0 && (att.inv || []).some((x) => x && (x.f[0] | 0) > 0 && (x.id | 0) === guard.item);
      if (!immune) {
        const fn = Elona.ItemDB[guard.fn];
        if (typeof fn === 'function') {
          try { fn.call(Elona.ItemDB, def, def.index | 0, -1, g); } catch (err) { /* noop */ }
          out.keys.push(guard.fn);
        }
      }
    }
    // 199572：受击打断持续行动
    if (G(def, 140) !== 0 && G(def, 140) !== 3) SET(def, 143, 1);
    return out;
  }

  /** 前半段的统一入口（onDamage 开头调用） */
  function preDamage(g, def, att, dmg, elem, power) {
    const T = table();
    if (!T || !T.pre) return { keys: [], messages: [] };
    const P = T.pre;
    const rnd = R(g);
    const d = dmg | 0;
    const out = { keys: [], messages: [] };
    if (d <= 0) return out;
    acidErode(g, def, att, d, P, rnd, out);
    fearCheck(g, def, d, P, rnd, out);
    elemental(g, def, att, d, elem, power, P, rnd, out);
    return out;
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
  function onDamage(g, def, att, dmg, attr, power) {
    const T = table();
    if (!T) return { ok: false, reason: 'no-table' };
    if (!def || (dmg | 0) <= 0) return { ok: true, keys: [], messages: [], clones: 0, dying: false };
    const rnd = R(g);
    const d = dmg | 0, A = attr | 0;
    const attIdx = att ? (att.index | 0) : -1;
    const out = { ok: true, keys: [], messages: [], clones: 0, dying: false, fields: {} };

    // 0-GV / 199519-199712：*label_2044 前半（酸蚀装备、恐惧失禁、元素附加状态）
    const pw = (power === undefined || power === null) ? 100 : (power | 0);
    const pre = preDamage(g, def, att, d, A, pw);
    for (const k of pre.keys) out.keys.push(k);
    for (const m of pre.messages) out.messages.push(m);
    out.pre = pre;

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

  Elona.OnHit = { onDamage, preDamage, canSplit, copyChara, table };
  Elona.Bump = { onSwap, tryMountCharge, onBeforeMove, wantsDialogue, reactionKey, dateCode, table };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OnHit: Elona.OnHit, Bump: Elona.Bump };
  }
})(typeof window !== 'undefined' ? window : global);
