'use strict';
/**
 * 基因合成（能力複合機 / gene machine）—— core/genemachine.js
 *
 * 【源码依据】start.hsp 效果 32（`var_1302 == 32`）364537-364665 + 两个子过程：
 *
 *   364537-364545  提示「まずは素体となる仲間を選ぶ必要がある。」→ `var_1790 = 5` 选人
 *   364556-364565  提示「能力を取り出す仲間を選ぶ必要がある。この仲間は合成後、永久に失われる。」
 *   364563-364573  `cbit(1053)` = 大事な仲間 → 拒绝（仍出现在列表里，选完才拦）
 *   364585-364592  y/n 确认（var_487）
 *   364600         「XはYの能力を受けついだ！」
 *   364602-364606  `var_1117 = 20` 特效 + `*label_3019`（部位）
 *                     `var_58(stat) = var_444 * 10000` → `*label_2143`（部位数扣速度）
 *   364614-364625  `*label_3018`（技能，最多 2 个）+ `skillgain`
 *   364629-364648  供体等级 > 素体等级且种族 != 343 时：
 *                     `var_2281 = (Lv差)/2 + 1` 次 `*label_2145`（升级，var_1362=1 不报「成长了」）
 *                     再把供体最高的 3 项主能力按
 *                     `limit(差*500*10 / limit(var_2281,2,10), 1000, 10000)` 点 `skillmod`
 *                     —— 该值就是属性经验的千分位，1000 = +1 级，上限 10000 = +10
 *   364650-364655  `var_58(80)=0` → `chara_vanquish` → `skillexp 151,0,1200`
 *   364660         打开素体的人物卡（`*label_2784`，var_1502 = 4）
 *
 *   *label_3018 364792  技能：`randomize 种族id` 后 `rnd(41)+150` 抽 100 次 + `rnd(2)+300` 抽 10 次，
 *                       收集「素体没有（sorg==0）、供体有（sorg>0）」的 id；1/3 概率再带一个不同的
 *   *label_3019 364826  部位：`/man/` 种族 / 种族 343 / cbit 23,27,1011 → 不给；素体没有空槽 → 不给
 *                       供体部位（排除 4 胴体 / 10 遠隔 / 11 矢弾）里 `rnd` 抽 3 次：
 *                         命中「素体已有该类型」→ 跳出，转「供体该类型更多」分支（50 次 rnd(15)+1）
 *                         3 次都是素体没有的类型 → 直接长最后一个抽到的类型
 *                       新槽固定是**最后一个空槽**（`var_444(1)`），不是第一个
 *   284271-284280  选人列表标题列 `var_121(13) = 「獲得部位/技能」`（素体选定后出现）
 *   284440-284465  该列内容 = `*label_3019` + `*label_3018` 的结果（逐行预览）
 *   284488-284500  两道选择都要 `var_58(38) > var_82(151,0) + 5` → 拒绝（生化学不足）
 *   284033-284040  var_1790==5 的列表只列 `var_58(0)==1`（在场）的同伴，并跳过已选的素体
 *
 * 【为什么要 randomize 种族id】原版在抽技能/部位前 `randomize 种族id`、抽完 `randomize`（时间）。
 *   目的是让预览列与实际结果一致：同一份种族 + 同一份素体部位表 → 结果恒定。
 *   本项目照抄这套种子语义（HSP 的 `randomize p1` 即「以 p1 为种子」）。
 *
 * 【差异】原版的部位/技能都是按上述规则抽的；本项目提供 `preview()` 给面板显示，
 *   结果与 `synthesize()` 完全一致（因为种子固定），不再有「预览与实得不同」的问题。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const ITEM = 684;        // 能力複合機（181882）
  const SKILL = 151;       // 生化学（Gene engineer）
  const PART_SKIP = [4, 10, 11];
  /** var_257（8728） */
  const PART_NAME = ['', '头', '颈', '背', '躯体', '手', '指', '腕', '腰', '足', '远程', '弹药'];
  const ATTRS = [10, 11, 12, 13, 14, 15, 16, 17];
  /** 主能力名（skills.json 的 ch 列，10..17）——只用于消息，避免依赖 NPC 模块 */
  const ATTR_NAME = {
    10: '力量', 11: '耐久', 12: '灵巧', 13: '感知',
    14: '学习', 15: '意志', 16: '魔力', 17: '魅力',
  };

  function rngOf(g) {
    return (g && g.rng) ? g.rng : Elona.rng;
  }
  /** `randomize 种族id`（364840 / 364826）：让结果与种族绑定 */
  function seedOf(g, c) {
    const r = rngOf(g);
    if (r && r.randomize) r.randomize((c && (c.get(27) | 0)) || 0);
    return r;
  }
  /** `randomize`（无参）：恢复时间种子，避免后续全局随机被种族 id 钉死 */
  function reseed(g) {
    const r = rngOf(g);
    // 注意：Rng.randomize(undefined) 会把种子归 0 → 固定序列，必须显式给时间戳
    if (r && r.randomize) r.randomize(Date.now() >>> 0);
  }

  function cbitOf(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, bit) | 0) : 0;
  }
  /** sorg(id, chara) = var_82(id+600, chara)/1000000（5022） */
  function sorgOf(c, id) {
    if (!c) return 0;
    const hasSorg = !!(Elona.Stats && Elona.Stats.sorg);
    // 有潜力表就走 sorg；旧存档 / 测试夹具里可能只有同步过的技能值
    if (hasSorg && c.potential && c.potential[id] !== undefined) return Elona.Stats.sorg(c, id) | 0;
    const v = (c.skill ? c.skill(id) : 0) | 0;
    if (v !== 0) return v;
    return hasSorg ? (Elona.Stats.sorg(c, id) | 0) : 0;
  }
  function slot(c, n) { return c.get(100 + n) | 0; }
  function partType(c, n) { return idiv(slot(c, n), 10000); }

  /** 供体的部位类型清单（364853-364862：排除 4 / 10 / 11 与空槽） */
  function donorParts(donor) {
    const out = [];
    for (let n = 0; n < 30; n++) {
      const t = partType(donor, n);
      if (!t) continue;
      if (PART_SKIP.indexOf(t) >= 0) continue;
      out.push(t);
    }
    return out;
  }
  function countType(c, type) {
    let k = 0;
    for (let n = 0; n < 30; n++) if (partType(c, n) === type) k++;
    return k;
  }
  /** 364843-364850：最后一个空槽（原版写进这里，不是第一个） */
  function lastFreeSlot(c) {
    let last = -1;
    for (let n = 0; n < 30; n++) if (slot(c, n) === 0) last = n;
    return last;
  }

  /**
   * *label_3019（364826-364920）：决定要移植的部位。
   * @returns {{type:number, slot:number}} type = 0 表示不移植
   */
  function pickPartFull(g, recip, donor) {
    const none = { type: 0, slot: -1 };
    if (!recip || !donor) return none;
    const tag = (Elona.EnchFx && Elona.EnchFx.raceTag)
      ? Elona.EnchFx.raceTag(donor.get(27) | 0) : '';
    if (tag.indexOf('/man/') >= 0) return none;                     // 364829
    if ((donor.get(27) | 0) === 343) return none;                   // 364832
    if (cbitOf(donor, 23) || cbitOf(donor, 27) || cbitOf(donor, 1011)) return none;   // 364835

    const free = lastFreeSlot(recip);                               // 364841-364848
    if (free < 0) return none;

    const list = donorParts(donor);                                 // 364850-364860
    if (!list.length) return none;

    const rng = seedOf(g, donor);                                   // 364864
    const R = (n) => rng.rnd(n);
    // 364866-364879：抽 3 次；一旦抽到「素体已有」的类型就跳出，转「数量更多」分支
    let type = list[0], hit = 0;
    for (let i = 0; i < 3; i++) {
      type = list[R(list.length)];
      hit = countType(recip, type) > 0 ? 1 : 0;
      if (hit) break;
    }
    if (!hit) {                                                     // 364880-364884
      reseed(g);
      return { type, slot: free };
    }
    // 364885-364915：找「素体该类型数量 < 供体该类型数量」的类型，多长一个
    let found = false;
    for (let i = 0; i < 50; i++) {
      type = R(15) + 1;
      if (countType(recip, type) < countType(donor, type)) { found = true; break; }
    }
    reseed(g);
    return found ? { type, slot: free } : none;
  }

  /** @returns {number} 部位类型（0 = 不移植） */
  function pickPart(g, recip, donor) { return pickPartFull(g, recip, donor).type; }

  /**
   * *label_3018（364792-364824）：决定要移植的技能（0~2 个）。
   * @returns {number[]}
   */
  function pickSkills(g, recip, donor) {
    if (!recip || !donor) return [];
    if ((donor.get(27) | 0) === 343) return [];                     // 364793
    if (cbitOf(donor, 23) || cbitOf(donor, 27)) return [];          // 364797

    const rng = seedOf(g, donor);                                   // 364801
    const R = (n) => rng.rnd(n);
    const cand = [];
    for (let i = 0; i < 100; i++) {                                 // 364804-364812
      const id = R(41) + 150;
      if (sorgOf(recip, id) === 0 && sorgOf(donor, id) > 0) cand.push(id);
    }
    for (let i = 0; i < 10; i++) {                                  // 364814-364821
      const id = R(2) + 300;
      if (sorgOf(recip, id) === 0 && sorgOf(donor, id) > 0) cand.push(id);
    }
    const out = [];
    if (cand.length) out.push(cand[0]);                             // 364822
    if (cand.length >= 2 && R(3) === 0) {                           // 364823-364833
      for (let i = 1; i < cand.length; i++) {
        if (cand[i] !== cand[0]) { out.push(cand[i]); break; }
      }
    }
    reseed(g);
    return out;
  }

  /** 能否合成（284488 的生化学限制 + 364563 的大事な仲間） */
  function check(g, recip, donor) {
    if (!recip || !donor) return { ok: false, reason: 'no-target', message: '需要选择两名同伴。' };
    if (recip === donor) return { ok: false, reason: 'same', message: '不能和自身合成。' };
    if ((recip.index | 0) === 0) return { ok: false, reason: 'player', message: '不能对自己使用。' };
    if (cbitOf(donor, 1053)) {
      return { ok: false, reason: 'precious', message: `${donor.name}是你重要的同伴。` };
    }
    const gene = sorgOf(g.player, SKILL);
    if ((donor.get(38) | 0) > gene + 5) {                            // 284496
      return { ok: false, reason: 'skill', message: '生化学的技能不足。' };
    }
    if ((recip.get(38) | 0) > gene + 5) {                            // 284342
      return { ok: false, reason: 'skill', message: '生化学的技能不足。' };
    }
    return { ok: true, message: '' };
  }

  /** 名次最高 3 项主能力（364629-364641，稳定升序排序后取最后 3 个，同名时后位优先） */
  function topAttrs(donor) {
    const arr = ATTRS.map((id, i) => ({ id, v: sorgOf(donor, id), i }));
    arr.sort((a, b) => (a.v - b.v) || (a.i - b.i));
    return arr.slice(-3).reverse();      // 对应 var_400 = var_701 - cnt - 1 → 7,6,5
  }

  /**
   * 合成（364600-364665）。
   * @param {object} g
   * @param {object} recip 素体
   * @param {object} donor 供体（合成后消失）
   * @param {{part?:number, skills?:number[]}} [opts] 预抽好的结果（面板用来保证与预览一致）
   * @returns {{ok:boolean, message:string, messages:string[], part:number, skills:number[],
   *            levels:number, attrs:Array<{id:number,gain:number,exp:number}>}}
   */
  function synthesize(g, recip, donor, opts) {
    opts = opts || {};
    const pre = check(g, recip, donor);
    const out = {
      ok: false, message: pre.message, messages: [],
      part: 0, skills: [], levels: 0, attrs: [],
    };
    if (!pre.ok) return out;

    const E = Elona.Equipment;
    const skName = (id) => {
      if (ATTR_NAME[id]) return ATTR_NAME[id];
      const s = (Elona.NPC && Elona.NPC.skillName) ? Elona.NPC.skillName(id) : '';
      return (s && !/^skill \d+$/.test(s)) ? s : String(id);
    };
    out.messages.push(`${recip.name}继承了${donor.name}的能力！`);   // 364600

    // ---- 364602-364610：部位（*label_3019）----
    const part = (opts.part !== undefined) ? (opts.part | 0) : pickPart(g, recip, donor);
    if (part) {
      const n = (E && E.addPart) ? E.addPart(recip, part) : -1;
      if (n >= 0) {
        out.part = part;
        out.messages.push(`${recip.name}获得了新的${PART_NAME[part] || part}！`);
      }
    }

    // ---- 364614-364625：技能（*label_3018，最多 2 个）----
    const skills = (opts.skills !== undefined) ? (opts.skills || []) : pickSkills(g, recip, donor);
    for (const sid of skills) {
      if (Elona.Stats && Elona.Stats.skillGain) {
        Elona.Stats.skillGain(recip, recip.index | 0, sid, 1, 0, g);   // skillgain var_581,id,1
      }
      out.skills.push(sid);
      out.messages.push(`${recip.name}学会了「${skName(sid)}」！`);
    }

    // ---- 364629-364648：等级与主能力 ----
    const dlv = donor.get(38) | 0, rlv = recip.get(38) | 0;
    if (dlv > rlv && (donor.get(27) | 0) !== 343) {
      const reps = idiv(dlv - rlv, 2) + 1;                            // 364631
      for (let i = 0; i < reps; i++) {
        if (Elona.Stats && Elona.Stats.levelUp) Elona.Stats.levelUp(recip, g);   // *label_2145, var_1362=1
      }
      out.levels = reps;
      out.messages.push(`${recip.name}升到了 ${recip.get(38) | 0} 级！`);       // 364636

      // 364638-364647：最高 3 项主能力 → skillmod（属性经验，1000 = +1）
      for (const a of topAttrs(donor)) {
        const cur = sorgOf(recip, a.id);
        if (a.v <= cur) continue;
        let exp = (a.v - cur) * 500;
        exp = exp * 10 / limit(reps, 2, 10);                          // 整数除，与 HSP 一致
        exp = limit(Math.trunc(exp), 1000, 10000);
        if (Elona.Stats && Elona.Stats.skillMod) {
          Elona.Stats.skillMod(recip, a.id, recip.index | 0, exp, g);
        }
        const gain = Math.max(0, sorgOf(recip, a.id) - cur);
        out.attrs.push({ id: a.id, gain, exp });
        if (gain > 0) out.messages.push(`${recip.name}的「${skName(a.id)}」提升了 ${gain}！`);
      }
    }

    // ---- 364650-364655：供体消失 + 生化学经验 ----
    donor.set(80, 0);
    const idx = (Array.isArray(g.charas) && g.charas[donor.index | 0] === donor)
      ? (donor.index | 0)
      : ((Array.isArray(g.charas) ? g.charas.indexOf(donor) : -1) | 0);
    if (idx >= 0 && Elona.Chara && Elona.Chara.vanquish) {
      Elona.Chara.vanquish(g, idx);
    } else {
      donor.set(0, 0);
      donor.set(150, 0);
    }
    // 同伴表里摘掉（Party.removeFromParty 即源码里的「合成消耗」路径）
    if (Elona.Party && Elona.Party.removeFromParty) {
      Elona.Party.removeFromParty(g, donor);
    } else if (Array.isArray(g.party)) {
      const i = g.party.indexOf(donor);
      if (i >= 0) g.party.splice(i, 1);
    }
    if (g.syncCharaCells) { try { g.syncCharaCells(); } catch (e) { /* noop */ } }

    if (Elona.Stats && Elona.Stats.skillExp) {
      try { Elona.Stats.skillExp(g.player, SKILL, 0, 1200, 0, 0, g); } catch (e) { /* noop */ }
    }
    reseed(g);                                                        // 364656

    out.ok = true;
    out.message = out.messages[out.messages.length - 1] || '合成完成。';
    return out;
  }

  /** 预览（284440 的「獲得部位/技能」列）：与 synthesize 结果一致 */
  function preview(g, recip, donor) {
    return { part: pickPart(g, recip, donor), skills: pickSkills(g, recip, donor) };
  }

  Elona.GeneMachine = {
    ITEM, SKILL, PART_NAME, ATTR_NAME,
    pickPart, pickPartFull, pickSkills, check, synthesize, preview,
    donorParts, lastFreeSlot, topAttrs,
  };
})(window);
