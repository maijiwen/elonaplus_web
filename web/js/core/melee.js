'use strict';
/**
 * 近接系特殊能力（0-EH）—— `*label_2965` 里 var_1302 分支的实际效果。
 *
 * 这些 id 在 `*label_2960` 的效果分派里没有分支：原版是把它们写在
 * 「能力发动总控」`*label_2965`（318379-325280）里，靠 `var_1302 == id`
 * 逐个分派，动作本体则复用近接例程 `*label_3006`（345830+，= 本项目
 * `Battle.attackSeq`）。本模块按源码逐条落地：
 *
 *   631 群击        327081-327134  对范围内每个敌对目标各来一次完整近接攻击
 *   685 爆裂拳      330936-330948 → 347137-347149  普攻 + 655 手榴弹爆风
 *   742 腹部重击    330986-330998 → 347170-347189  追加固定伤害 + 呕吐/失禁
 *   745 击晕攻击    330998-331030 → 199891/212518 伤害减半、不会致死、低血 KO
 *   769 钢弦利刃    338316-338390  神经伤害 + 出血 + 低血斩首(812)
 *   831 挠痒地狱    334879-334957  削减 SP、呼吸困难 +3、斗志 -10、狂气
 *   710 紧抱        334957-335420  束缚 268 + 体质伤害（柔术分支另算）
 *
 * 统一入口 `Elona.Melee.run(g, caster, id, target)`，由 `spell.js` 的分派表调用。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));

  /** 屬性字段（var_82(10..18)） */
  const A_STR = 10, A_CON = 11, A_DEX = 12, A_PER = 13;
  const SK_MARTIAL = 106;      // 格闘
  const SK_WIRE = 152;         // 钢丝
  const F_REL = 9, F_LOCK = 29;

  function R(g, n) {
    const rng = (g && g.rng) ? g.rng : null;
    return rng ? rng.rnd(Math.max(1, n | 0)) : 0;
  }
  function sk(c, id) { return (c && typeof c.skill === 'function') ? (c.skill(id) | 0) : 0; }
  function cbit(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, bit) : 0;
  }
  function findbuff(c, id) {
    return (Elona.Status && Elona.Status.findbuff) ? Elona.Status.findbuff(c, id) : -1;
  }
  function dist(a, b) { return Elona.Battle.dist(a.x, a.y, b.x, b.y); }
  function los(g, a, b) { return Elona.Spell.fovLos(g, a.x, a.y, b.x, b.y); }
  function log(g, s) { if (g && g.log) g.log(s); }
  function field(id, n) { return Elona.Spell.field(id, n); }

  /** 等级补正：((limit(lv-50,1,2000)+limit(lv-100,1,2000))*4*sqrt(limit(lv,1,2000)*3)+30+1) */
  function levelBonus(c) {
    const lv = limit(c.get(38) | 0, 1, 2000);
    return (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4 * Math.sqrt(lv * 3) + 30 + 1;
  }
  function limit(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** 普通近接攻击（= *label_3006 → Battle.attackSeq） */
  function melee(g, caster, tg) {
    if (!tg || (tg.get(0) | 0) !== 1) return null;
    if (Elona.Battle && Elona.Battle.attackSeq) return Elona.Battle.attackSeq(g, caster, tg);
    return null;
  }

  /** 631 群击（327081-327134） */
  function swarm(g, caster) {
    log(g, '群击！');
    const range = idiv(field(631, 3), 1000) + 1;
    const berserk = findbuff(caster, 40) !== -1;             // 暴走 buff 40
    const dragon = (caster.get(27) | 0) === 599;             // 599 无视敌我
    let hits = 0;
    for (const t of (g.charas || [])) {
      if (!t || (t.get(0) | 0) !== 1 || t === caster) continue;
      if (!berserk && !dragon) {
        if ((caster.index | 0) < 16) {
          if ((t.get(F_REL) | 0) !== -3) continue;           // 玩家侧只打敌对
        } else if ((t.get(69) | 0) === (caster.get(69) | 0)
          || (t.get(F_REL) | 0) === (caster.get(F_REL) | 0)
          || ((caster.get(F_REL) | 0) >= -1 && (t.get(F_REL) | 0) >= -1)) {
          continue;
        }
      }
      if (dist(caster, t) > range) continue;                 // var_83(3,631)\1000+1
      if (!los(g, caster, t)) continue;
      melee(g, caster, t);
      hits++;
    }
    return { ok: true, type: 0, implemented: true, swarm: hits };
  }

  /** 685 爆裂拳（330936-330948 + 347137-347149） */
  function burstFist(g, caster, tg) {
    if (!tg) return { ok: true, type: 0, implemented: true, noTarget: true };
    // 330941 的台词由 Ability.use 的统一「发动」日志覆盖，这里不重复
    // var_578 = limit(力量 + 格闘*10 + 500, 800, 30000)，以 655（手榴弾，3×3 音属性）结算
    const power = limit(sk(caster, A_STR) + sk(caster, SK_MARTIAL) * 10 + 500, 800, 30000);
    let blast = null;
    if (Elona.Spell && Elona.Spell.dispatchEffect) {
      blast = Elona.Spell.dispatchEffect(g, caster, 655, tg, power, 3);
    }
    // 爆风之后照常打一次武技
    const atk = melee(g, caster, tg);
    return { ok: true, type: 0, implemented: true, blast, attack: atk };
  }

  /** 742 腹部重击（330986-330998 + 347170-347189） */
  function bodyBlow(g, caster, tg) {
    if (!tg || (tg.get(0) | 0) !== 1) {
      return { ok: true, type: 0, implemented: true, noTarget: true };
    }
    log(g, '你狠狠地打出一记腹部重击。');
    // dmghp var_244, var_82(10,var_243)/10 * (var_82(106,var_243)+1)/10 + 5
    const dmg = idiv(idiv(sk(caster, A_STR), 10) * (sk(caster, SK_MARTIAL) + 1), 10) + 5;
    const applied = (Elona.Battle && Elona.Battle.applyDamage)
      ? Elona.Battle.applyDamage(tg, dmg, g, caster, 0, 0) : dmg;
    // raw = 公式值，dmg = 经抗性/减伤结算后的实际值（测试对比用 raw）
    const out = { ok: true, type: 0, implemented: true, raw: dmg, dmg: applied, vomited: false };
    if ((tg.get(50) | 0) >= 0) {                             // 347183：还活着才呕吐
      if (Elona.Vomit && Elona.Vomit.vomit) {
        const v = Elona.Vomit.vomit(g, tg);
        out.vomited = !!(v && v.ok !== false);
      }
      // 347185-347187：var_58(446) > 12000 → chara_morasi（失禁）
      //   失禁本体在 core/potion.js 的 morasi()（水分归 5000 + 脚下生成尿液）
      out.incontinent = (tg.get(446) | 0) > 12000;
      if (out.incontinent && Elona.Potion && Elona.Potion.morasi) {
        out.morasi = Elona.Potion.morasi(g, tg);
      }
    }
    return out;
  }

  /** 745 击晕攻击（330998-331030；伤害减半/不会致死见 212518、199891） */
  function stunAttack(g, caster, tg) {
    if (!tg) return { ok: true, type: 0, implemented: true, noTarget: true };
    if (tg === caster) {
      log(g, '那是做不到的。');
      return { ok: false, reason: 'self' };
    }
    if ((tg.get(50) | 0) < idiv(tg.get(51) | 0, 20) || (tg.get(50) | 0) === 0) {
      log(g, '再打下去对方会死的……。');
      return { ok: false, reason: 'too-weak' };
    }
    const set65 = (n, v) => { if (g && typeof g.setV65 === 'function') g.setV65(n, v); };
    set65(193, 888);                                        // 331024：var_65(193) = 888
    const hpBefore = tg.get(50) | 0;
    const r = melee(g, caster, tg);
    set65(193, 0);                                          // 331027
    // 199891：HP 掉到 max/20 以下 → var_58(256) = 100（ノックアウト）
    const out = { ok: true, type: 0, implemented: true, attack: r, knockout: false };
    if ((tg.get(50) | 0) <= idiv(tg.get(51) | 0, 20) && (tg.get(256) | 0) < 100) {
      tg.set(256, 100);
      out.knockout = true;
      log(g, '＊击倒＊');
    }
    // 不会致死：888 期间 198599 会把溢出伤害清零并留 1 HP
    if ((tg.get(50) | 0) <= 0) {
      tg.set(50, 1);
      out.lethalClamped = (hpBefore > 0);
    }
    return out;
  }

  /** 769 钢弦利刃（338316-338390） */
  function steelWire(g, caster, tg) {
    if (!tg) return { ok: true, type: 0, implemented: true, noTarget: true };
    log(g, `你用钢丝切向${tg.name}。`);
    const dex = sk(caster, A_DEX);
    const wire = sk(caster, SK_WIRE);
    const dmg = (idiv(dex, 5) + 5) * (idiv(wire + 1, 5) + 5)
      + R(g, wire * 2 + 5) + idiv(levelBonus(caster), 2);
    const applied = (Elona.Battle && Elona.Battle.applyDamage)
      ? Elona.Battle.applyDamage(tg, dmg, g, caster, 64, 1000) : dmg;
    const out = { ok: true, type: 0, implemented: true, raw: dmg, dmg: applied, bleeding: 0, beheaded: false };
    // 338347-338349：目标处于束缚（268）→ dmgcon 9（出血）强度 (钢丝+1)/2+1
    if ((tg.get(268) | 0) > 0 && Elona.Resist && Elona.Resist.dmgcon) {
      Elona.Resist.dmgcon(g, g.dmgconTable, tg, 9, idiv(wire + 1, 2) + 1);
      out.bleeding = idiv(wire + 1, 2) + 1;
    }
    // 338351-338355：低血（< max/9）→ 812 斩首
    if ((tg.get(50) | 0) >= 0 && (tg.get(50) | 0) < idiv(tg.get(51) | 0, 9)) {
      if (Elona.Spell && Elona.Spell.dispatchEffect) {
        Elona.Spell.dispatchEffect(g, caster, 812, tg, power0(g, caster), 0);
        out.beheaded = true;
      }
    }
    // 338357-338360：技能经验（钢丝 152）
    if (Elona.Stats && Elona.Stats.skillExp && !cbit(tg, 23) && !cbit(tg, 27)
      && !cbit(tg, 964) && !cbit(tg, 960) && !cbit(tg, 992) && !cbit(tg, 985)
      && (tg.index | 0) !== 0) {
      Elona.Stats.skillExp(caster, SK_WIRE, caster, 40, 0, 0, g);
    }
    return out;
  }
  function power0(g, caster) {
    return (Elona.Spell && Elona.Spell.calcSpellPower)
      ? Elona.Spell.calcSpellPower(812, caster) : 100;
  }

  /** 831 挠痒地狱（334879-334957） */
  function tickle(g, caster, tg) {
    if (!tg) return { ok: true, type: 0, implemented: true, noTarget: true };
    log(g, `${caster.name}封住了${tg.name}的动作，全力挠痒！`);
    if ((caster.index | 0) < 16) {                          // 334888：会招致敌意
      const HA = (Elona.Intimacy && Elona.Intimacy.hostileAction)
        || (Elona.Relation && Elona.Relation.hostileAction);
      if (HA) HA(g, caster, tg);
      else if ((tg.get(F_REL) | 0) > -3) tg.set(F_REL, -3);
    }
    if ((tg.get(268) | 0) <= 0) tg.set(268, 1);             // 334897：束缚
    // var_1588 = sqrt(灵巧*100/目标体质 + 16) + 5
    const con = Math.max(1, sk(tg, A_CON));
    const sp = Math.trunc(Math.sqrt(sk(caster, A_DEX) * 100 / con + 16)) + 5;
    if (tg.index === 0) { if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(tg, sp); }
    else if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(tg, sp);
    // 334906：呼吸困难 +3
    if ((tg.get(263) | 0) === 0) tg.set(263, (tg.get(263) | 0) + 3);
    const out = { ok: true, type: 0, implemented: true, sp, morales: 0, madness: 0 };
    // 334910：感知 > 体质 → 斗志 -10 + 台词
    if (sk(tg, A_PER) > con) {
      tg.set(182, Math.max(0, (tg.get(182) | 0) - 10));
      out.morales = -10;
      log(g, `${tg.name}笑得蜷成一团！`);
    }
    // 334935：SP 低于一半 → 狂气
    if ((tg.get(52) | 0) < idiv(tg.get(53) | 0, 2)) {
      const san = R(g, R(g, 1 + idiv(sk(caster, A_DEX), 20)) * 10 + 2) + 1;
      if (Elona.Status && Elona.Status.dmgsan) Elona.Status.dmgsan(tg, san, g);
      out.madness = san;
    }
    return out;
  }

  /** 710 紧抱（334957-335420） */
  function embrace(g, caster, tg) {
    if (!tg) return { ok: true, type: 0, implemented: true, noTarget: true };
    if ((caster.index | 0) === 0 && tg.index === 0) {
      log(g, '痛！');
      return { ok: false, reason: 'self' };
    }
    const cha = sk(tg, 17);
    if (cha < 100) log(g, `${caster.name}紧紧箍住了${tg.name}。`);
    else if ((caster.index | 0) === 0) log(g, `${caster.name}紧紧抱住了${tg.name}。`);
    if ((tg.get(268) | 0) === 0) tg.set(268, 1);            // 335271：束缚
    const jutsu = (Elona.Status && Elona.Status.findbuff && findbuff(caster, 60) !== -1);
    let dmg;
    if (jutsu) {                                            // 柔术分支（335238-335246）
      dmg = (idiv(sk(caster, A_DEX), 5) + 5) * (idiv(sk(caster, SK_MARTIAL) + 1, 5) + 5)
        + R(g, sk(caster, A_DEX) * 2 + 5) + idiv(levelBonus(caster), 4);
      if ((tg.get(268) | 0) === 1) tg.set(268, 2);
      if ((caster.get(268) | 0) < 2) caster.set(268, 2);
      // 335255：柔术状态反噬自身（不超过目标剩余 HP）
      const self = Math.max(1, Math.min(idiv(caster.get(51) | 0, 10),
        Math.max(1, (tg.get(51) | 0) - (tg.get(50) | 0))));
      if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(caster, self, g, null, 68, 1000);
    } else {                                                // 普通抱摔（335237）
      dmg = (idiv(sk(caster, A_STR), 5) + 5) * (idiv(sk(caster, A_STR) + 1, 5) + 5)
        + R(g, sk(caster, A_STR) * 2 + 5) + idiv(levelBonus(caster), 2);
    }
    const applied = (Elona.Battle && Elona.Battle.applyDamage)
      ? Elona.Battle.applyDamage(tg, dmg, g, caster, 68, 1000) : dmg;
    return { ok: true, type: 0, implemented: true, raw: dmg, dmg: applied, jutsu };
  }

  const HANDLERS = {
    631: (g, c, tg) => swarm(g, c),
    685: burstFist,
    710: embrace,
    742: bodyBlow,
    745: stunAttack,
    769: steelWire,
    831: tickle,
  };

  const Melee = {
    ids: Object.keys(HANDLERS).map(Number),
    has(id) { return !!HANDLERS[id | 0]; },
    run(g, caster, id, target) {
      const h = HANDLERS[id | 0];
      if (!h) return { ok: false, reason: 'no-handler' };
      return h(g, caster, target);
    },
    // 便于单测
    _internals: { swarm, burstFist, bodyBlow, stunAttack, steelWire, tickle, embrace, levelBonus },
  };

  Elona.Melee = Melee;
})(window);
