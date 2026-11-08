'use strict';
/**
 * 变异（変容）系统 —— 对应 start.hsp 的 *label_2966（320319-320399）与
 * *label_0043 的 var_92 表（5036-6294）。
 *
 * 【已确认的语义】
 *   var_97(id)  feat 等级：正 = 特性/变异，0 = 无，负 = 缺陷
 *   var_92(0)   类别：1 = 固定特性（不参与随机变异），其余可参与
 *   var_92(1)   该 feat 的下限
 *   var_92(2)   该 feat 的上限
 *   var_95      随机抽到的 feat id（`rnd(51)` → 0..50）
 *   var_96      0 = 只要文本/表，1 = 应用效果（本实现只做等级增减）
 *
 * 【流程（320319-320388）】
 *   var_400 = 1；若 var_396 == 1144 → `2 + rnd(3)`
 *   repeat var_400:
 *     repeat 100:
 *       var_95 = rnd(51)
 *       取该 feat 的 var_92；stat==0 或 var_92(0)==1 → 重抽
 *       var_400 = (rnd(2) ? 1 : -1)
 *       var_97(id) >= 上限 → 只能减；<= 下限 → 只能加
 *       var_396 == 1144 时，负面一律跳过（该效果只产生正面变异）
 *       var_97(id) += var_400；台词「あなたは変容した！」
 *
 * 【附魔 33「protects you from mutation」（320309-320318）】
 *   `encfind(33) != -1` 时，`rnd(5)` 非 0（即 4/5 概率）→ 「あなたは変異を受け付けなかった。」
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const MUT_MAX = 51;                    // 320327：rnd(51) → feat id 0..50
  const PROTECT_ENCHANT = 33;            // 320309：encfind(var_244, 33)

  let TABLE = null;                      // { [id]: { type, min, max, name } }
  const MESSAGES = {
    resist: 'あなたは変異を受け付けなかった。',
    mutate: 'あなたは変容した！',
    nothing: '何もおきない…',
  };

  function load(data) {
    if (data) { TABLE = data.mutations || data; return TABLE; }
    if (TABLE) return TABLE;
    if (Elona.Data && Elona.Data.tableSync) {
      const d = Elona.Data.tableSync('feats_mutation');
      if (d) TABLE = d.mutations || d;
    }
    return TABLE;
  }
  function setTable(d) { TABLE = (d && d.mutations) ? d.mutations : d; return TABLE; }
  function info(id) {
    if (!TABLE) load();
    return TABLE ? TABLE[String(id)] : null;
  }

  const featGet = (c, id) => (Elona.Feat ? (Elona.Feat.get(c, id) | 0) : 0);
  const featSet = (c, id, v) => { if (Elona.Feat) Elona.Feat.set(c, id, v); };

  /**
   * 320397-320398：变异后 `var_691 = 0 ; gosub *label_2174`（能力/装备重算）。
   * web 端对应 Stats.applyEquipment（213461 起），无 g 时静默跳过。
   */
  function refresh(c, g) {
    try {
      if (Elona.Stats && Elona.Stats.applyEquipment) Elona.Stats.applyEquipment(c, g);
    } catch (e) { /* 测试环境可能没有完整 g */ }
  }

  /**
   * 是否被附魔 33 保护（4/5 概率）。
   * @returns {boolean} true = 抵抗成功（不发生变异）
   */
  function resistedByEnchant(g, c) {
    if (!c || !Elona.ItemDB || !Elona.ItemDB.encfind) return false;
    if (Elona.ItemDB.encfind(c, PROTECT_ENCHANT) === -1) return false;
    const rng = (g && g.rng) ? g.rng : null;
    const roll = rng ? rng.rnd(5) : Math.floor(Math.random() * 5);
    return roll !== 0;
  }

  /**
   * 产生变异。
   * @param {object} g
   * @param {object} c 目标
   * @param {object} [opt]
   *   opt.count        变异次数（默认 1；效果 1144 由调用方传 `2 + rnd(3)`）
   *   opt.positiveOnly 是否只允许正面（效果 1144 = true）
   *   opt.ignoreProtect 跳过附魔 33 判定
   * @returns {{ok:boolean, resisted:boolean, mutated:number, messages:string[], feats:Array}}
   */
  function mutate(g, c, opt) {
    opt = opt || {};
    const out = { ok: true, resisted: false, mutated: 0, messages: [], feats: [] };
    if (!c) { out.ok = false; return out; }
    const rng = (g && g.rng) ? g.rng : { rnd: (n) => Math.floor(Math.random() * Math.max(1, n)) };
    const R = (n) => rng.rnd(Math.max(1, n | 0));

    // 320309-320318：附魔 33 的抵抗判定
    if (!opt.ignoreProtect && resistedByEnchant(g, c)) {
      out.resisted = true;
      out.messages.push(MESSAGES.resist);
      return out;
    }

    let times = (opt.count === undefined) ? 1 : (opt.count | 0);   // 320321 var_400
    const positiveOnly = !!opt.positiveOnly;                       // var_396 == 1144

    for (let n = 0; n < times; n++) {
      let done = false;
      for (let t = 0; t < 100; t++) {                              // 320326 repeat 100
        const id = R(MUT_MAX);                                     // 320327
        const mi = info(id);
        if (!mi) continue;                                         // stat == 0
        if ((mi.type | 0) === 1) continue;                         // var_92(0) == 1：固定特性
        const cur = featGet(c, id);
        let dir = R(2) ? 1 : -1;                                   // 320333-320338
        if (cur >= (mi.max | 0)) dir = -1;                          // 320339
        if (cur <= (mi.min | 0)) dir = 1;                           // 320342
        if (positiveOnly && dir === -1) continue;                   // 320357-320359
        featSet(c, id, cur + dir);                                  // 320362
        out.mutated++;
        out.feats.push({ id, name: mi.name, level: cur + dir, dir });
        out.messages.push(`${MESSAGES.mutate} [${mi.name}${dir > 0 ? '+' : '-'}]`);
        done = true;
        break;
      }
      if (!done) break;
    }
    // 320389-320396：全 100 次都没抽到 → 何もおきない
    if (out.mutated === 0 && !out.resisted) out.messages.push(MESSAGES.nothing);
    if (out.mutated > 0) refresh(c, g);
    return out;
  }

  /**
   * 治疗变异（效果 1121，320402-320465）：`repeat 1 + (var_2362>=1) + (var_2362>=0) + rnd(2)`
   * 每次从已获得的变异里随机取一个清掉。
   */
  function cure(g, c, opt) {
    opt = opt || {};
    const out = { ok: true, cured: 0, messages: [], feats: [] };
    if (!c) { out.ok = false; return out; }
    const rng = (g && g.rng) ? g.rng : { rnd: (n) => Math.floor(Math.random() * Math.max(1, n)) };
    const R = (n) => rng.rnd(Math.max(1, n | 0));
    const var2362 = opt.var2362 | 0;
    const times = opt.count !== undefined ? (opt.count | 0)
      : 1 + (var2362 >= 1 ? 1 : 0) + (var2362 >= 0 ? 1 : 0) + R(2);   // 320423
    for (let n = 0; n < times; n++) {
      let done = false;
      for (let t = 0; t < 100; t++) {                                  // 320424
        const id = R(229);                                             // 320425
        const lv = featGet(c, id);
        if (lv === 0) continue;                                        // 320431
        featSet(c, id, 0);                                             // 320440
        out.cured++;
        out.feats.push({ id, oldLevel: lv });
        out.messages.push('あなたは元の自分に近づいた気がした。');
        done = true;
        break;
      }
      if (!done) break;
    }
    if (out.cured === 0) out.messages.push('何もおきない…');
    else refresh(c, g);
    return out;
  }

  /** 当前已获得的变异列表（供人物窗/调试用） */
  function list(c) {
    const out = [];
    if (!c || !Elona.Feat) return out;
    for (let id = 0; id < MUT_MAX; id++) {
      const lv = featGet(c, id);
      if (lv === 0) continue;
      const mi = info(id);
      out.push({ id, level: lv, name: mi ? mi.name : String(id) });
    }
    return out;
  }

  Elona.Mutation = {
    load, setTable, mutate, cure, list, info, resistedByEnchant,
    MUT_MAX, MESSAGES,
    get table() { return TABLE || load(); },
  };
})(window);
