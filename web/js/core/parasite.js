'use strict';
/**
 * 寄生（体内异物）—— start.hsp `*label_2334` / `*label_2335` / `*label_2336` / `*label_2292` / `*label_2293`
 *
 * 两种寄生：
 *   脑寄生 cbit 1045（`*label_2334` 227193-227241）—— 每 25 回合让思考错乱
 *   体内寄生 cbit 978（`*label_2336` 227253-227322）—— 每 25 回合有概率产出寄生生物
 *
 * 共同的前置拒绝（都按顺序判定）：
 *   ① `var_58(42) <= -1000000`（基因/妊娠值）→ 「すぐに分解された」
 *   ② 玩家且 feat 220（花之加护）→ 「花の養分に変えられた」
 *   ③ **`encfind(48) != -1`（附魔「防止异物侵入体内」）→ 弹开 / 吐出**（本批补上的第 10 项）
 *   ④ 已寄生 → 什么都不做
 *
 * 每 25 回合的效果（由 604638-604651 分派）：
 *   `*label_2293`（体内）：1/15 台词；非世界地图 1/3 → 出血 +15，并生成 1 只寄生生物
 *       （种族 var_58(430)，0 时默认 330，等级 `HP_max/2+1`，带召唤特性 cbit 964）
 *   `*label_2292`（脑）：1/10 台词；非世界地图 1/5 → 混乱/狂气/朦胧 三个字段各 +15
 *
 * 字段：430 = 寄生种族，258 = 出血，254 = 混乱（dmgcon 5），269 = 精神（语义未确认）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => Math.trunc(a / b);
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const FIELD_SPECIES = 430;
  const FIELD_BLEED = 258;
  const FIELD_CONFUSE = 254;
  const FIELD_MIND = 269;

  function nm(c) { return (c && c.name) || '相手'; }

  /** ①②③④ 的共同拒绝判定 → 返回 reason 或 null */
  function reject(g, target) {
    if (!target) return 'no-target';
    if ((target.get(42) | 0) <= -1000000) return 'dissolved';
    if ((target.index | 0) === 0 && Elona.Feat && Elona.Feat.get
      && Elona.Feat.get(target, 220) !== 0) return 'flower';
    if (Elona.ItemDB && Elona.ItemDB.encfind && Elona.ItemDB.encfind(target, 48) !== -1) {
      return 'repelled';
    }
    return null;
  }

  /**
   * 体内寄生 —— `*label_2336`（227253-227322）
   * @param {object} g
   * @param {object} target
   * @param {number} [species] var_1596（寄生源种族；674/520/422/400 有特殊映射）
   */
  function body(g, target, species) {
    const rj = reject(g, target);
    if (rj) {
      const msg = {
        dissolved: 'しかしすぐに分解された。',
        flower: 'しかしすぐに花の養分に変えられた。',
        repelled: `しかし${nm(target)}はすぐに吐き出した。`,
      }[rj] || '';
      return { ok: false, reason: rj, message: msg };
    }
    if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(target, 978)) {
      return { ok: false, reason: 'already' };
    }
    // 227299-227315：寄生种族映射
    let sp = 0;
    const s = species | 0;
    if (s === 674) sp = 674;
    else if (s === 520) sp = 93;
    else if (s === 422) sp = 798;
    else if (s === 400) sp = 400;
    target.set(FIELD_SPECIES, sp);
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(target, 978, 1);
    return { ok: true, species: sp, message: `${nm(target)}は寄生された。` };
  }

  /** 脑寄生 —— `*label_2334`（227193-227241） */
  function brain(g, target) {
    const rj = reject(g, target);
    if (rj) {
      const msg = {
        dissolved: 'しかしすぐに分解された。',
        flower: 'しかしすぐに花の養分に変えられた。',
        repelled: `しかし${nm(target)}はすぐに弾き出した。`,
      }[rj] || '';
      return { ok: false, reason: rj, message: msg };
    }
    if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(target, 1045)) {
      return { ok: false, reason: 'already' };
    }
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(target, 1045, 1);
    return { ok: true, message: `${nm(target)}は脳髄に寄生された。` };
  }

  /** 体内寄生的每 25 回合结算 —— `*label_2293`（224042-224093） */
  function tickBody(g, c) {
    const out = [];
    if (!g || !c) return out;
    const R = (n) => ((g.rng) || Elona.rng).rnd(n);
    if (R(15) === 0) out.push({ kind: 'msg', text: `${nm(c)}は不安げに腹を押さえた。` });
    if (g.worldMap) return out;                       // var_126(6) != 1
    if (R(3) !== 0) return out;
    c.set(FIELD_BLEED, (c.get(FIELD_BLEED) | 0) + 15);
    let sp = c.get(FIELD_SPECIES) | 0;
    if (sp === 0) sp = 330;
    const lv = limit(idiv(c.hpMax | 0, 2) + 1, 1, 200);
    let born = null;
    const fac = Elona.CharaFactory;
    if (fac && fac.create) {
      born = fac.create(g, sp, lv, c.x, c.y, { var1023: lv });
      if (born) {
        born.set(21, g.getV65 ? (g.getV65(10) | 0) : 0);
        if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(born, 964, 1);
        born.set(197, 10);
        const base = c.name || '';
        if (!base || base.length > 10 || /の子供|child/.test(base)) born.name = '寄生生物の子供';
        else born.name = `${base}の子供`;
      }
    }
    out.push({ kind: 'birth', species: sp, level: lv, born });
    return out;
  }

  /** 脑寄生的每 25 回合结算 —— `*label_2292`（223992-224041） */
  function tickBrain(g, c) {
    const out = [];
    if (!g || !c) return out;
    const R = (n) => ((g.rng) || Elona.rng).rnd(n);
    if (R(10) === 0) {
      const odd = ((g.getV65 ? (g.getV65(14) | 0) : 0) % 2) === 1;
      out.push({ kind: 'msg', text: odd ? `${nm(c)}は必死に自我を保とうとしている。`
        : `${nm(c)}は不安げに頭を押さえた。` });
    }
    if (g.worldMap) return out;
    if (R(5) !== 0) return out;
    c.set(FIELD_MIND, (c.get(FIELD_MIND) | 0) + 15);
    c.set(FIELD_CONFUSE, (c.get(FIELD_CONFUSE) | 0) + 15);
    c.set(256, (c.get(256) | 0) + 15);
    out.push({ kind: 'madness', text: `${nm(c)}は脳髄を寄生虫に侵され思考がおかしくなっている！` });
    return out;
  }

  Elona.Parasite = { body, brain, tickBody, tickBrain, reject, FIELD_SPECIES, FIELD_BLEED };
})(typeof window !== 'undefined' ? window : global);
