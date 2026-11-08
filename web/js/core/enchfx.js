'use strict';
/**
 * 附魔特效发动 —— `*label_3008`（start.hsp 347816-348054）
 *
 * 【为什么需要这个模块】
 *   `stats.js` 的 applyEquipment 只把附魔「换算成角色字段」（67 暴击 / 90 物减 / 88 追打 …），
 *   真正让这些字段在**每次普攻命中后**产生效果的，是 attackOne 里 347240 的
 *   `gosub *label_3008`。此前这一行没有移植，导致「吸血/吸魔/时停/终结/特攻/属性追伤/
 *   特效发动」全部哑火。本模块补齐这一段。
 *
 * 【源码结构】
 *   347817  var_1321 == 5（散弹）→ 直接 return（散弹不触发附魔）
 *   347820  var_65(193)/(194) >= 100（剧情锁定）→ return
 *   347825  repeat 15：遍历当前武器 var_2455 的附魔槽 var_99(40+cnt*2)
 *     · 36 吸血：sp = rnd(pw/50+1)+1；普通攻击时 /2；下限 2
 *                对方 sp>0 时自己 healsp(rnd(2)+1)；对方 dmgsp(sp/2)（玩家会被扣两次，原版如此）
 *     · 38 吸魔：A = (rnd(pw/100+1)+20) * limit(dmg/500,1,50) - 对方PV；/2（普通攻击）
 *                自己 healmp(A/5+1)；对方 dmgmp(A)
 *     · 37 终结：1/66 → evadd 18（末日降临）
 *     · 40 时停：1/25，var_65(801) = limit(pw/100+2, 2, 6)
 *     · 77 劫波之针：1/30 → var_65(801) = 4
 *     · 57/58/61 龙/不死/神特攻：种族 tag 含 /dragon/ /undead/ /god/
 *                dmg2 = dmg/30 * ((rnd(20) + limit(pw,1,2000)) / 50) + 1
 *     · 76 对空：cbit(5) 漂浮 → dmg/120 * ((rnd(10)+pw)/50) + 1
 *     · 84 对金属：cbit(28) 金属 → dmg/25 * ((rnd(100)+pw)/50) + 100
 *     · type 7 属性追伤：dmg/10 * (rnd(100)+pw)/100 + 1，属性 = id%10000，强度 = pw/2+100
 *     · type 8 特效发动：var_653 表（enchant_fx.json）→ rnd(100) < chance 时
 *                power = pw + 武器技能*10，对敌/对己（judge==3000）施法
 *   348026  特殊弹后处理：4 时停 / 3 魔弹追加 / 1 爆裂
 *
 * 【数据】
 *   web/data/tables/enchant_fx.json —— var_653 28 项（26336-26363）
 *   web/data/tables/race_tags.json  —— refchara(id,8,1) 种族标签（472605+）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => Math.trunc(a / b);
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  let FX = null;
  let TAGS = null;

  function fxTable() {
    if (FX) return FX;
    if (Elona.Data && Elona.Data.tableSync) {
      try { FX = Elona.Data.tableSync('enchant_fx'); } catch (e) { FX = null; }
    }
    return FX;
  }
  function tagTable() {
    if (TAGS) return TAGS;
    if (Elona.Data && Elona.Data.tableSync) {
      try { TAGS = Elona.Data.tableSync('race_tags'); } catch (e) { TAGS = null; }
    }
    return TAGS;
  }

  async function load() {
    if (!FX) { try { FX = await Elona.Data.table('enchant_fx'); } catch (e) { FX = null; } }
    if (!TAGS) { try { TAGS = await Elona.Data.table('race_tags'); } catch (e) { TAGS = null; } }
    return { fx: FX, tags: TAGS };
  }

  /** refchara(species, 8, 1)：种族标签串，如 "/dragon/nefia3/" */
  function raceTag(species) {
    const t = tagTable();
    if (!t || !t.tags) return '';
    return t.tags[String(species | 0)] || '';
  }
  function hasRaceTag(c, tag) {
    if (!c) return false;
    const sp = (c.get(27) | 0);
    return raceTag(sp).indexOf(tag) >= 0;
  }

  /**
   * 攻击命中后触发武器附魔（*label_3008）。
   *
   * @param {object} g
   * @param {object} att 攻击者
   * @param {object} def 目标
   * @param {{item:object, dmg:number, ammoType?:number, skillId?:number}} opts
   * @returns {Array<{kind:string}>} 触发记录（供日志/测试）
   */
  function apply(g, att, def, opts) {
    opts = opts || {};
    const it = opts.item;
    const out = [];
    if (!it || !it.f) return out;
    if (!att || !def) return out;
    const ammo = opts.ammoType | 0;
    if (ammo === 5) return out;                       // 347817 散弹不触发
    const V = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    const SV = (n, v) => { if (g && g.setV65) g.setV65(n, v); };
    if (V(193) >= 100 || V(194) >= 100) return out;   // 347820
    const rng = (g && g.rng) ? g.rng : { rnd: (n) => Math.floor(Math.random() * n) };
    const R = (n) => rng.rnd(n);
    const st = Elona.Status;
    const dmg = opts.dmg | 0;
    const skillId = opts.skillId === undefined ? 106 : (opts.skillId | 0);
    // 【近似】原版 dmghp 会带属性 id 与属性强度走抗性链（A168 已登记 dmghp 抗性链未移植），
    // 这里只做扣血；属性 id 记在 out 里供日志/后续扩展。
    const hurt = (target, amount) => {
      if (Elona.Battle && Elona.Battle.applyDamage) return Elona.Battle.applyDamage(target, amount, g, att);
      target.hp = Math.max(0, (target.hp | 0) - amount);
      return amount;
    };

    for (let n = 0; n < 15; n++) {
      const eid = it.f[40 + n * 2] | 0;
      if (!eid) break;                                // 347829
      const pw = it.f[40 + n * 2 + 1] | 0;

      // ---------------- 36 吸血 ----------------
      if (eid === 36) {
        let a = R(idiv(pw, 50) + 1) + 1;
        if (a <= 0) a = 1;
        if (ammo === 0) a = idiv(a, 2);
        if (a <= 1) a = 2;
        if ((def.sp | 0) > 0 && st && st.healsp) st.healsp(att, R(2) + 1);
        if ((def.index | 0) === 0) { if (st && st.dmgsp) st.dmgsp(def, idiv(a, 2)); }
        if (st && st.dmgsp) st.dmgsp(def, idiv(a, 2));
        if (Elona.Stats && Elona.Stats.refreshSpeed) Elona.Stats.refreshSpeed(def, g);
        out.push({ kind: 'sp-drain', amount: a });
        continue;
      }

      // ---------------- 38 吸魔 ----------------
      if (eid === 38) {
        let a = (R(idiv(pw, 100) + 1) + 20) * limit(idiv(dmg, 500), 1, 50) - (def.get(70) | 0);
        if (a <= 0) a = 1;
        if (ammo === 0) a = idiv(a, 2);
        if (a <= 0) a = 1;
        if (st && st.healmp) st.healmp(att, idiv(a, 5) + 1);
        if ((def.get(0) | 0) !== 1) continue;
        if (st && st.dmgmp) st.dmgmp(def, a, g);
        out.push({ kind: 'mp-drain', amount: a });
        continue;
      }

      // ---------------- 37 终结 ----------------
      if (eid === 37) {
        if (R(66) === 0) {
          if (Elona.Event) Elona.Event.add(18, att.index | 0, 0);
          out.push({ kind: 'apocalypse' });
        }
        continue;
      }

      // ---------------- 40 时停 ----------------
      if (eid === 40) {
        if (V(801) === 0 && V(413) === 0 && R(25) === 0) {
          SV(801, limit(idiv(pw, 100) + 1 + 1, 2, 6));
          out.push({ kind: 'time-stop', turns: V(801) });
        }
        continue;
      }

      // ---------------- 77 劫波之针 ----------------
      if (eid === 77) {
        if (V(801) === 0 && V(413) === 0 && R(30) === 0) {
          SV(801, 4);
          out.push({ kind: 'time-stop', turns: 4 });
        }
        continue;
      }

      // ---------------- 57 / 58 / 61 种族特攻 ----------------
      if (eid === 57 || eid === 58 || eid === 61) {
        const tag = eid === 57 ? '/dragon/' : (eid === 58 ? '/undead/' : '/god/');
        if (hasRaceTag(def, tag)) {
          SV(809, 1);
          const d = idiv(dmg, 30) * idiv(R(20) + limit(pw, 1, 2000), 50) + 1;
          hurt(def, d, 0, 0);
          out.push({ kind: 'slay', tag, dmg: d });
        }
        continue;
      }

      // ---------------- 76 对空 ----------------
      if (eid === 76) {
        if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(def, 5)) {
          SV(809, 1);
          const d = idiv(dmg, 120) * idiv(R(10) + limit(pw, 1, 2000), 50) + 1;
          hurt(def, d, 0, 0);
          out.push({ kind: 'slay-air', dmg: d });
        }
        continue;
      }

      // ---------------- 84 对金属 ----------------
      if (eid === 84) {
        if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(def, 28)) {
          SV(809, 1);
          const d = idiv(dmg, 25) * idiv(R(100) + limit(pw, 1, 2000), 50) + 100;
          hurt(def, d, 0, 0);
          out.push({ kind: 'slay-metal', dmg: d });
        }
        continue;
      }

      const type = idiv(eid, 10000);
      const sub = eid % 10000;

      // ---------------- type 7：属性追伤 ----------------
      if (type === 7) {
        if (dmg <= 1) continue;
        if ((def.get(0) | 0) !== 1) continue;
        SV(809, 1);
        const d = idiv(dmg, 10) * idiv(R(100) + pw, 100) + 1;
        hurt(def, d, sub, idiv(pw, 2) + 100);
        out.push({ kind: 'element-attack', element: sub, dmg: d });
        continue;
      }

      // ---------------- type 8：特效发动 ----------------
      if (type === 8) {
        if ((def.get(0) | 0) !== 1) continue;
        if (sub >= 28) continue;
        const fx = fxTable();
        const e = fx && fx.fx ? fx.fx[String(sub)] : null;
        if (!e) continue;
        let chance = e.chance | 0;
        let target = def;
        if (e.judge === 3000 || e.judge === 10000) target = att;   // 348022 对己
        const spell = e.spell | 0;
        // 348024-348028：ダーツ系特殊处理（武器 866/714/1171 且非 103 技能时概率 90）
        if (spell === 655 && ((it.id | 0) === 866 || (it.id | 0) === 714 || (it.id | 0) === 1171)
          && skillId !== 103) {
          chance = 90;
        }
        if (R(100) < chance) {
          SV(172, 100);
          const power = pw + (Elona.Stats ? Elona.Stats.sorg(att, skillId) : 0) * 10;
          if (Elona.Spell && Elona.Spell.dispatchEffect) {
            Elona.Spell.dispatchEffect(g, att, spell, target, power);
          }
          out.push({ kind: 'enchant-spell', spell, power, self: target === att });
        }
        SV(172, 0);
        continue;
      }
      // 其余（1/2/3/6/10 等）是装备加成或食物效果，不在这里处理
    }

    // ---------------- 348026-348050：特殊弹后处理 ----------------
    if (ammo === 4) {
      if (V(801) === 0 && V(413) === 0) {
        SV(801, 4);
        out.push({ kind: 'time-stop', turns: 4, source: 'ammo' });
      }
    }
    if (ammo === 3) {
      if ((def.get(0) | 0) === 1) {
        SV(809, 1);
        const elem = 50 + R(11);
        const d = dmg;
        hurt(def, d, elem, (Elona.Stats ? Elona.Stats.sorg(att, skillId) : 0) * 10 + 100);
        out.push({ kind: 'magic-ammo', element: elem, dmg: d });
      }
    }
    if (ammo === 1) {
      // 460 = 爆裂（魔力风暴），强度 = 武器技能*8 + 10
      if (Elona.Spell && Elona.Spell.dispatchEffect) {
        const power = (Elona.Stats ? Elona.Stats.sorg(att, skillId) : 0) * 8 + 10;
        Elona.Spell.dispatchEffect(g, att, 460, def, power);
        out.push({ kind: 'burst-ammo', power });
      }
    }
    return out;
  }

  /**
   * 食物附魔的**食用**效果 —— start.hsp 226709-226804。
   *
   * 与武器附魔（*label_3008）是同一张附魔表，但吃下时的算法不同：
   *   36 会吸收体力  → healsp(c, (pw/40+1) * maxSP/100)
   *   38 会吸收魔力  → healmp(c, (pw/20+1) * maxMP/100 + 1)
   *   37 令一切终结  → evadd 18（必然，无 1/66 判定）
   *   40 令时间停止  → var_65(801) = pw/100 + 2（食用无上限）
   *   type 1（主属性）/ type 3（技能）→ skillexp(skill, (pw/50+1) * 100 * (1 + NPC*5))
   *   type 10（潜力回复）→ modgrowth(skill, limit((pw/50+1)*5, -50, 50))
   *   type 6（属性维持，除 19 幸运）→ addbuff(20 + (skill-10), (pw/50+1)*5*(1 + NPC*2), 2000)
   *
   * @returns {Array<{kind:string}>}
   */
  function applyFood(g, c, item) {
    const out = [];
    if (!c || !item || !item.f) return out;
    const V = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    const SV = (n, v) => { if (g && g.setV65) g.setV65(n, v); };
    const st = Elona.Status;
    const stt = Elona.Stats;
    const isNpc = (c.index | 0) !== 0 ? 1 : 0;

    for (let n = 0; n < 15; n++) {
      let eid = item.f[40 + n * 2] | 0;
      if (!eid) break;
      const pw = item.f[40 + n * 2 + 1] | 0;

      if (eid === 36) {
        const a = idiv(pw, 40) + 1;
        if (st && st.healsp) st.healsp(c, idiv(a * (c.get(53) | 0), 100));
        out.push({ kind: 'sp' });
        continue;
      }
      if (eid === 38) {
        const a = idiv(pw, 20) + 1;
        if (st && st.healmp) st.healmp(c, idiv(a * (c.get(56) | 0), 100) + 1);
        out.push({ kind: 'mp' });
        continue;
      }
      if (eid === 37) {
        if (Elona.Event) Elona.Event.add(18, c.index | 0, 0);
        out.push({ kind: 'apocalypse' });
        continue;
      }
      if (eid === 40) {
        if (V(801) === 0 && V(413) === 0) {
          SV(801, idiv(pw, 100) + 1 + 1);
          out.push({ kind: 'time-stop', turns: V(801) });
          continue;
        }
      }

      const type = idiv(eid, 10000);
      if (!type) continue;
      const skill = eid % 10000;
      if (type === 1 || type === 3) {
        const exp = (idiv(pw, 50) + 1) * 100 * (1 + isNpc * 5);
        if (stt && stt.skillExp) stt.skillExp(c, skill, c.index | 0, exp, 0, 0, g);
        out.push({ kind: type === 1 ? 'attr-exp' : 'skill-exp', skill, exp });
        continue;
      }
      if (type === 10) {
        const d = limit((idiv(pw, 50) + 1) * 5, -50, 50);
        if (stt && stt.modGrowth) stt.modGrowth(c, skill, c.index | 0, d, g);
        out.push({ kind: 'potential', skill, delta: d });
        continue;
      }
      if (type === 6 && skill !== 19) {
        const power = limit((idiv(pw, 50) + 1), -1000, 1000) * 5 * (1 + isNpc * 2);
        if (st && st.addbuff) st.addbuff(g, c, 20 + (skill - 10), power, 2000);
        out.push({ kind: 'growth-buff', skill });
        continue;
      }
    }
    return out;
  }

  /** 测试/外部注入种族标签表（{tags:{id:'/man/'}}） */
  function setTags(t) { TAGS = t; }

  Elona.EnchantFX = { apply, applyFood, load, raceTag, hasRaceTag, fxTable, tagTable, setTags };
})(typeof window !== 'undefined' ? window : global);
