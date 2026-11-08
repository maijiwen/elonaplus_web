'use strict';
/**
 * 演奏（演奏 / 楽器）系统 —— 使用乐器开始，回合制（rowact 6）。
 *
 * 源码依据（hsp/start.hsp）：
 *   306511-307062  *label_2912  演奏主循环（每回合一次，604779-604781 分派）
 *   319815-319866  var_1302 == 183：使用乐器的入口判定（技能/体力）
 *   330878-330931  var_1302 == 676：「アンサンブル」（合奏）→ var_1026
 *   604652-604657  主循环里 rowact != 0 时 `var_58(141)--`
 *
 * 状态字段（全部是 var_58，故随存档保存）：
 *   [140] = 6        演奏中
 *   [141]            剩余回合，起始 61（合奏 121）
 *   [142]            乐器在背包里的下标
 *   [144]            本场演奏的「出来」（初始 40），结束时据此给评语
 *   [145]            收到的おひねり累计（金币已直接进 var_58(30)）
 * 临时值：
 *   var_2369         演奏力 = 乐器字段 25（959 号特殊：limit((技能+1)/3, 5, 250)）
 *   var_1026         合奏加成 0..200
 *   var_2368         本场已扔出的礼物数（影响后续礼物概率）
 *
 * 听众筛选（306637-306734，每 20 回合一次）：
 *   同图、3 格以内、`var_58(14) > 0`（听演奏的気力）、不在睡眠/麻痹（cbit 992）、
 *   `var_58(251)==0`、`var_58(256) < 60`
 * 打赏（306758-306783）：1/3 概率，金额 = limit((出来*(100+演奏力)/100 + 合奏/5)*2, 0, 听众等级*5)，
 *   听众等级<16 时取 rnd(该值)+1；职业 1000..1999/2003 时 /10；cbit(23/27/964) 时 /5+1；
 *   上限为听众所持金；钱从听众 var_58(30) 转到演奏者。
 * 品质变化（306791-306806）：`rnd(技能+1)+合奏 > rnd(等级*2+1)` 时 1/2 加、1/6 减。
 * 嫌吵（306697-306734）：`技能+合奏/2 < 听众等级/2` 且听众是随机 NPC 时 1/3 挨打。
 * 礼物（306815-306913）：`rnd(技能+1)+合奏 > rnd(等级*5+1)` 且 1/3 称赞时，
 *   再 `rnd(2368*2+4)==0` 就往旁边格子扔一件礼物（类别取 var_1515）。
 *
 * 未移植（如实记录）：
 *   · 音效 snd 11 与 `make_sound`（本项目的 mef 有 type 5，但音源扩散未实现）
 *   · `var_58(251)`、`var_58(256)`、地图 1009（パーティ会場）的额外分支
 *   · 「アンサンブル」入口（330878）需要「合奏」道具 676 的使用例程，本轮只实现 var_1026 的算法
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const SKILL = 183;           // 演奏
  const ROWACT = 6;
  const ROWACT_DANCE = 17;     // *label_2914（307099）：舞蹈
  const TURNS = 61;            // 306515
  const TURNS_ENSEMBLE = 121;  // 306517
  const QUALITY0 = 40;         // 306522：var_58(144) 初始值
  const INSTRUMENT_FIELD = 16; // var_99(16) == 183 → 乐器
  const INSTRUMENT_MARK = 183;
  const MELODYUS = 959;        // 名器メロディウス（武器类别但可演奏）

  /** 乐器 id → 拟音组（306549-306597） */
  const SOUND_GROUPS = [
    { ids: [929, 928, 690], words: ['*Zip*', '*Zingo*', '*Yowl*'] },
    { ids: [927, 254], words: ['*Blare*', '*Howl*', '*Puff*'] },
    { ids: [692], words: ['*Twang*', '*Whizz*', '*Puff*', '*Twang*'] },
    { ids: [328, 761, 88], words: ['*Cha*', '*Dan*', '*Tiki*'] },
    { ids: [707], words: ['*Zip*', '*Plunk*', '*Ping*'] },
    { ids: [693, 691], words: ['*Tiki*', '*Plunk*', '*Ding*'] },
    { ids: [845], words: ['*Bam*', '*Rat-a-tat*', '*Bash*', '*Bump*'] },
  ];

  /** 结束评语（306924-307006），按 var_58(144) 从低到高匹配 */
  const RESULT_TIERS = [
    { below: 0, jp: '時間の無駄だった。', en: 'It is a waste of time.' },
    { below: 20, jp: 'ほとんど誰も相手にしてくれない。', en: 'Almost everyone ignores you.' },
    { below: 40, jp: 'もっと練習が必要だ。', en: 'You need to practice lot more.' },
    { exact: 40, jp: '演奏を終えた。', en: 'You finish your performance.' },   // 306952：恰好 40 的专用文案
    { below: 60, jp: 'まあまあだ。', en: 'Not good.' },
    { below: 80, jp: '聴衆は君の演奏が気に入ったようだ。', en: 'People seem to like your performance.' },
    { below: 100, jp: '演奏は成功した。', en: 'Your performance is successful.' },
    { below: 120, jp: '素晴らしい！', en: 'Wonderful!' },
    { below: 150, jp: '素晴らしい演奏だ。皆が君に喝采を送っている。', en: 'Great performance. Everyone cheers you.' },
    { below: Infinity, jp: '伝説のステージだ！', en: 'A legendary stage!' },
  ];

  /** 礼物类别（var_1515，222068） */
  const GIFT_CATS = [77000, 57000, 57000, 57000, 60000, 18000, 20000, 32000, 34000, 52000];

  const TEXT = {
    noSkill: '你不知道怎么演奏乐器。',        // 319844
    tired: '你太累了，失败了！',               // 319855
    start: '你开始演奏。',
    noInstrument: '你没有能演奏的乐器。',
    crowdNoisy: '听众嫌吵，动手打你！',        // 306703
    bored: '有人听腻了，走了。',               // 306738
    praise: '听众为你叫好。',                  // 306818
    gift: '有听众往地上扔了东西。',             // 306903 之后
    tip: '听众给了你一些小费。',                // 306915
    ensembleStart: 'あなたと仲間たちはアンサンブルを始めた。',  // 330929
    ensembleAlone: 'あなたはひとりぼっちだ…。',               // 330922
  };

  const Perform = {
    /** 每场的临时状态（var_1026 / var_2368），不写存档 */
    runs: new WeakMap(),

    // ------------------------------------------------------------------
    // 判定
    // ------------------------------------------------------------------
    /** 是否乐器：实例字段 16 == 183（items.json 的 create.v99_16）或 959 号 */
    isInstrument(it) {
      if (!it) return false;
      if ((it.id | 0) === MELODYUS) return true;
      return (it.f[INSTRUMENT_FIELD] | 0) === INSTRUMENT_MARK;
    },

    /** 背包里第一件乐器 */
    findInstrument(c) {
      if (!c || !c.inv) return -1;
      for (let i = 0; i < c.inv.length; i++) {
        if (this.isInstrument(c.inv[i]) && (c.inv[i].f[0] | 0) > 0) return i;
      }
      return -1;
    },

    /** 演奏力 var_2369（306534-306542） */
    power(g, p, it, ensemble) {
      if (ensemble > 0) return limit(100 + ensemble, 100, 300);   // 306535
      if (it && (it.id | 0) === MELODYUS) {                        // 306540-306542
        return limit(idiv((p.skill(SKILL) | 0) + 1, 3), 5, 250);
      }
      return it ? (it.f[25] | 0) : 0;
    },

    /** 现在的小时数（var_65(13)+日*24+月*24*30+年*24*30*12） */
    nowHour(g) {
      const V = (n) => g.getV65(n) | 0;
      return V(13) + V(12) * 24 + V(11) * 24 * 30 + V(10) * 24 * 30 * 12;
    },

    /**
     * 合奏加成 var_1026（330878-330931）。
     *   演奏者：玩家（槽 0）或同伴（槽 1..15）→ 只能与**槽 1..15 的同伴**合奏
     *   （源码 330894-330898：`if (var_243 < 16 | var_243 == 0) { if (cnt >= 16) continue }`）
     *   其他角色（槽 ≥16，即城镇 NPC）→ 只与同阵营（var_58(9) 相同）的角色合奏
     *   距离：欧氏距离 `dist(...)` > `var_83(3, 656) \ 1000 + 1` 则跳过（330907）
     *   视线：fov_los 为 0 则跳过（330910）
     *   加成：`limit(var_82(183, 对方), 3, 3 + var_82(183, 自己) / 5)`（330913）
     *   上限 200（330915）
     * @returns {number} 0..200
     */
    ensembleBonus(g, p) {
      let sum = 0;
      const actor = p.index | 0;
      const actorIsParty = actor === 0 || (actor >= 1 && actor <= 15);
      // 307046：reach = var_83(3, 656)\1000 + 1（技能 656 未在 skills.json 中 → 通常为 1）
      const reach = idiv(p.skill(656) | 0, 1000) + 1;
      for (const c of g.charas) {
        if (!c || (c.get(0) | 0) !== 1 || c === p) continue;
        const ci = c.index | 0;
        if (actorIsParty) {
          if (ci >= 16) continue;                       // 330894-330898
        } else {
          if ((c.get(9) | 0) !== (p.get(9) | 0)) continue;   // 330899-330903
        }
        // 欧氏距离（源码 dist）
        const dx = c.x - p.x, dy = c.y - p.y;
        const d = Math.trunc(Math.sqrt(dx * dx + dy * dy));
        if (d > Math.max(1, reach)) continue;            // 330907
        if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, p.x, p.y, c.x, c.y)) continue;
        sum += limit(c.skill(SKILL) | 0, 3, 3 + idiv(p.skill(SKILL) | 0, 5));   // 330913
      }
      return limit(sum, 0, 200);   // 330915
    },

    /**
     * 合奏（物品 676，330878-330931）。
     *   扫描附近可合奏的角色，累积 var_1026；
     *   为 0 → 「あなたはひとりぼっちだ…。」；否则开始合奏演奏（121 回合）。
     * @returns {{ok:boolean, action?:string, reason?:string, ensemble?:number, message?:string}}
     */
    ensemble(g) {
      const p = g.player;
      if (!p) return { ok: false, reason: 'no-player' };
      if (Elona.Actions && Elona.Actions.busy(g)) return { ok: false, reason: 'busy' };
      // 需要一件乐器（合奏也是演奏）
      const idx = this.findInstrument(p);
      if (idx < 0) { g.log(TEXT.noInstrument); return { ok: false, reason: 'no-instrument' }; }
      if ((p.skill(SKILL) | 0) === 0) { g.log(TEXT.noSkill); return { ok: false, reason: 'no-skill' }; }
      const v = this.ensembleBonus(g, p);
      if (v === 0) {                                  // 330918-330925
        g.log(TEXT.ensembleAlone);
        return { ok: false, reason: 'alone', message: TEXT.ensembleAlone };
      }
      g.log(TEXT.ensembleStart);                       // 330929
      this.start(g, p, idx, v);                        // var_396 = 183 → *label_2960
      return { ok: true, action: 'perform', ensemble: v };
    },

    // ------------------------------------------------------------------
    // 入口（319815-319866）
    // ------------------------------------------------------------------
    /**
     * 使用乐器。
     * @returns {{ok:boolean, action?:string, reason?:string}}
     */
    use(g, idx, opts) {
      const p = g.player;
      const o = opts || {};
      if (Elona.Actions && Elona.Actions.busy(g)) return { ok: false, reason: 'busy' };
      const it = p.inv[idx];
      if (!this.isInstrument(it)) {
        g.log(TEXT.noInstrument);
        return { ok: false, reason: 'no-instrument' };
      }
      if ((p.skill(SKILL) | 0) === 0) { g.log(TEXT.noSkill); return { ok: false, reason: 'no-skill' }; }   // 319839
      const sp = p.get(52) | 0;
      if (sp < 50 && sp < g.rng.rnd(75)) {          // 319850-319861
        g.log(TEXT.tired);
        if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(p, idiv(sp, 2) + 1);
        g.endTurn();
        return { ok: false, reason: 'tired' };
      }
      if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(p, idiv(sp, 2) + 1 + g.rng.rnd(idiv(sp, 2) + 1));

      // 合奏：显式指定 var_1026 时用传入值，否则按附近队友算（330913）
      let ensemble = 0;
      if (o.ensemble !== undefined && o.ensemble !== null) ensemble = limit(o.ensemble | 0, 0, 200);
      else if (o.tryEnsemble) ensemble = this.ensembleBonus(g, p);

      return this.start(g, p, idx, ensemble);
    },

    /** 建立 rowact 6（306513-306527） */
    start(g, p, idx, ensemble) {
      p.set(140, ROWACT);
      p.set(141, ensemble > 0 ? TURNS_ENSEMBLE : TURNS);
      p.set(142, idx);
      p.set(144, QUALITY0);
      p.set(145, 0);
      this.runs.set(p, { ensemble: ensemble | 0, gifts: 0, messages: [] });
      g.log(ensemble > 0 ? `你和同伴开始合奏（${ensemble} 点加成）。` : TEXT.start);
      g.endTurn();
      return { ok: true, started: true, turns: p.get(141), ensemble };
    },

    /**
     * calcpartyscore（216749-216787）：听众反应分数。
     *   repeat 245-57, 57 —— 遍历 NPC 槽 57..244：
     *     · 非活角色 / cbit(992) → 跳过
     *     · 好感 >= 53：特殊类别（cbit 23/27/964）给 limit((等级+1)/5+1, 1, 20)
     *                  否则给 等级 + 5
     *     · 好感 < 50 → 扣 20
     *   与「上次分数」比较，返回增减量（原版存 var_434(13, 地图)，本项目按地图名存）。
     */
    partyScore(g) {
      // 派对委托进行中 → 用 QuestMap 的权威实现（写入 var_434(13) = q.progress）
      if (Elona.QuestMap && Elona.QuestMap.partyScore) {
        const q = Elona.QuestMap.activeQuest(g);
        if (q && (q.type | 0) === 1009) return Elona.QuestMap.partyScore(g);
      }
      let score = 0;
      const ST = Elona.Status;
      for (let i = 16; i < 245; i++) {
        const c = g.charas[i];
        if (!c || (c.get(0) | 0) !== 1) continue;
        if (ST && ST.cbit && ST.cbit(c, 992) === 1) continue;
        const imp = c.get(17) | 0;
        const lv = (c.get(38) | 0) || (c.level | 0) || 0;
        if (imp >= 53) {
          const special = ST && ST.cbit
            && (ST.cbit(c, 23) === 1 || ST.cbit(c, 27) === 1 || ST.cbit(c, 964) === 1);
          score += special ? limit(idiv(lv + 1, 5) + 1, 1, 20) : (lv + 5);
        }
        if (imp < 50) score -= 20;
      }
      const key = (g.map && g.map.name) || '?';
      if (!g.concertScore) g.concertScore = {};
      const prev = g.concertScore[key] | 0;
      g.concertScore[key] = score;
      return { score, prev, delta: score - prev };
    },

    // ------------------------------------------------------------------
    // 每回合（*label_2912 的第二段，306543-306922）
    // ------------------------------------------------------------------
    /**
     * @returns {{type:number, messages:string[], tips:number, ended:boolean}|null}
     */
    tick(g) {
      const p = g.player;
      if ((p.get(140) | 0) !== ROWACT) return null;
      const out = { type: ROWACT, messages: [], tips: 0, ended: false, quality: p.get(144) | 0 };
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      let run = this.runs.get(p);
      if (!run) {   // 读档后状态丢失：按 var_1026=0 继续（合奏信息不保存）
        run = { ensemble: 0, gifts: 0, messages: [] };
        this.runs.set(p, run);
      }

      // 604654：var_58(141)--
      let left = (p.get(141) | 0) - 1;
      p.set(141, left);

      const idx = p.get(142) | 0;
      const inst = p.inv[idx];
      const ensemble = run.ensemble | 0;
      const power = this.power(g, p, inst, ensemble);

      // 306543：还有回合 → 本回合的演奏过程
      if (left > 0) {
        // 306545-306636：每 10 回合的拟音（只有玩家会听到）
        if (left % 10 === 0 && p.index === 0) {
          if (R(2) === 0) {
            const grp = SOUND_GROUPS.find((x) => inst && x.ids.indexOf(inst.id) >= 0);
            if (grp) out.messages.push(grp.words[R(grp.words.length)]);
            else out.messages.push('*♪*');
          }
        }
        // 306637：每 20 回合结算一次听众
        if (left % 20 === 0) {
          const wave = this.audienceWave(g, p, inst, power, ensemble, run);
          out.messages.push(...wave.messages);
          out.tips += wave.tips;
          // 0-CH：听众反应分数（calcpartyscore 216749）—— 有变化时给出 (+N)/(-N)
          const ps = this.partyScore(g);
          if (ps.delta > 0) out.messages.push(`听众的反应变好了 (+${ps.delta})。`);
          else if (ps.delta < 0) out.messages.push(`听众的反应变差了 (${ps.delta})。`);
          if (wave.dead) { out.ended = true; return out; }
        }
        out.quality = p.get(144) | 0;
        return out;
      }

      // 306924-307006：剩余 0 回合 → 收场
      const fin = this.finish(g, p, power, ensemble, run);
      out.messages.push(...fin.messages);
      out.ended = true;
      out.quality = fin.quality;
      return out;
    },

    // ------------------------------------------------------------------
    // 听众结算（306637-306921）
    // ------------------------------------------------------------------
    audienceWave(g, p, inst, power, ensemble, run) {
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      const res = { messages: [], tips: 0, dead: false };
      const skill = p.skill(SKILL) | 0;
      const isPlayer = (p.index | 0) === 0;
      const now = this.nowHour(g);
      let tipSum = 0;

      // 306639：音源（原版 make_sound；本项目只做 mef 落点，表现层可忽略）
      if (Elona.Mef && Elona.Mef.add) {
        try { Elona.Mef.add(g, p.x, p.y, 5, 0); } catch (e) { /* 音源可选 */ }
      }

      for (let i = 0; i < g.charas.length; i++) {
        const c = g.charas[i];
        if (!c || (c.get(0) | 0) !== 1) continue;          // 306641
        const d = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
        // 306644：过了期限 → 気力恢复
        if (now >= (c.get(15) | 0)) c.set(14, 100);
        // 306647-306656：同一张地图（本项目 charas 都在当前地图）+ 3 格以内
        if (d > 3) continue;
        if ((c.get(14) | 0) <= 0) continue;                // 306657
        if ((c.get(251) | 0) > 0) continue;                // 306660（251 未移植，恒 0）
        if ((c.get(256) | 0) >= 60) continue;              // 306663
        if (Elona.Status && Elona.Status.cbit(c, 992) === 1) continue;   // 306666
        if (c === p) continue;                             // 306675

        // 306678：关系 -3（家畜/中立动物）
        if ((c.get(9) | 0) === -3) {
          if ((c.get(201) | 0) === 0 && isPlayer) res.messages.push(`${this.nameOf(c)} 好奇地凑了过来。`);
          c.set(201, 30);
          continue;
        }
        // 306691-306695：玩家演奏时，随机 NPC 的気力消耗
        if (isPlayer && (c.index | 0) >= 16) {
          c.set(14, (c.get(14) | 0) - R(15));
          c.set(15, now + 12);
        }
        // 306697-306734：演奏太差 → 嫌吵，可能挨打
        if (skill + idiv(ensemble, 2) < idiv(c.get(38) | 0, 2)) {
          if ((p.get(27) | 0) !== 675 && (c.index | 0) >= 16 && R(3) === 0) {
            p.set(144, (p.get(144) | 0) - idiv(c.get(38) | 0, 2));
            res.messages.push(`${this.nameOf(c)}：${TEXT.crowdNoisy}`);
            let dmg = R((c.get(38) | 0) + 1) + 1;
            if ((c.get(27) | 0) === 29) dmg = (c.get(38) | 0) * 2 + R(100);   // 306723
            if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(p, dmg);
            else p.hp = Math.max(0, (p.hp | 0) - dmg);
            if ((p.get(0) | 0) === 0 || (p.hp | 0) <= 0) { res.dead = true; break; }
            continue;
          }
        }
        // 306735-306756：気力耗尽 → 听腻
        if ((c.get(14) | 0) <= 0) {
          c.set(14, 0);
          if (isPlayer) res.messages.push(`${this.nameOf(c)} 听腻了，不再理会。`);
          continue;
        }
        // 306758-306783：打赏
        if (R(3) === 0) {
          let amt = limit(Math.floor(((p.get(144) | 0) * (100 + power) / 100 + idiv(ensemble, 5)) * 2), 0, (c.get(38) | 0) * 5);
          if ((c.index | 0) < 16) amt = R(limit(amt, 1, 100)) + 1;
          const job = c.get(150) | 0;
          if ((job >= 1000 && job < 2000) || job === 2003) amt = Math.floor(amt / 10);
          if (this.hasAnyBit(c, [23, 27, 964])) amt = limit(Math.floor((amt + 1) / 5) + 1, 1, 3000);
          if (amt > (c.get(30) | 0)) amt = c.get(30) | 0;
          c.set(30, (c.get(30) | 0) - amt);      // 306773-306775
          p.set(30, (p.get(30) | 0) + amt);
          tipSum += amt;
          // 306776-306781：付钱后気力再 -20
          if (isPlayer && (c.index | 0) >= 16) {
            c.set(14, (c.get(14) | 0) - 20);
            c.set(15, now + 12);
          }
        }
        // 306784：等级太高的听众不给经验反馈
        if ((c.get(38) | 0) > skill + ensemble) continue;
        let expv = R((c.get(38) | 0) + 1) + 1;
        if (this.hasAnyBit(c, [23, 27, 964])) expv = limit(Math.floor((expv + 1) / 5) + 1, 1, 30);
        // 306791-306806：听众的反馈改变「出来」
        if (R(skill + 1) + ensemble > R((c.get(38) | 0) * 2 + 1)) {
          // 原版槽位 57..244 = 地图 NPC；本项目 NPC 从 16 号起
          if ((g.getV65(70) | 0) === 1009 && (c.index | 0) >= 16) {
            c.set(17, (c.get(17) | 0) + R(3));   // 306793-306796：パーティ成绩
          }
          if (R(2) === 0) p.set(144, (p.get(144) | 0) + expv);
          else if (R(6) === 0) p.set(144, (p.get(144) | 0) - expv);
        }
        // 306807-306811：乐器带「睡眠」附魔（60 号）→ 听众睡着
        if (this.encFindSpec(inst, 60) !== -1 && R(15) === 0) {
          if (Elona.Resist && g.dmgconTable) Elona.Resist.dmgcon(g, g.dmgconTable, c, 8, 500);
        }
        if (this.hasAnyBit(c, [23, 27, 964])) continue;
        // 306815-306912：称赞 + 扔礼物
        if (R(skill + 1) + ensemble > R((c.get(38) | 0) * 5 + 1)) {
          if (R(3) === 0) {
            res.messages.push(`${this.nameOf(c)} 为你叫好。`);
            if (isPlayer && (c.index | 0) >= 16 && R(run.gifts * 2 + 4) === 0) {
              const git = this.throwGift(g, p);
              if (git) { run.gifts++; res.messages.push(TEXT.gift); }
            }
          }
        }
      }

      if (tipSum !== 0) {
        p.set(145, (p.get(145) | 0) + tipSum);
        res.tips = tipSum;
        res.messages.push(`${TEXT.tip}（+${tipSum} gp）`);
      }
      return res;
    },

    nameOf(c) {
      if (!c) return '某人';
      if (typeof c.name === 'function') return c.name('en') || '某人';
      return c.name || '某人';
    },

    hasAnyBit(c, bits) {
      if (!Elona.Status || !Elona.Status.cbit) return false;
      for (const b of bits) if (Elona.Status.cbit(c, b) === 1) return true;
      return false;
    },

    /** encfindspec（29416-29427）：乐器是否带指定附魔 */
    encFindSpec(it, specId) {
      if (!it) return -1;
      for (let n = 0; n < 15; n++) {
        const id = it.f[40 + n * 2] | 0;
        if (id === 0) break;
        if (id === specId) return 1;
      }
      return -1;
    },

    /** 306836-306908：观众扔礼物到旁边的空地 */
    throwGift(g, p) {
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      // 306837-306842：在玩家周围 3×3 里挑一格
      let tx = -1, ty = -1;
      for (let k = 0; k < 12; k++) {
        const x = limit(p.x - 1 + R(3), 0, g.map.width - 1);
        const y = limit(p.y - 1 + R(3), 0, g.map.height - 1);
        const cell = g.map.cell(x, y);
        if (!cell) continue;
        if (x === p.x && y === p.y) continue;
        if ((g.map.attr(cell[0], 7) & 4) !== 0) continue;    // cell_check: 不可通行
        tx = x; ty = y; break;
      }
      if (tx < 0) return null;
      const q = p.get(144) | 0;
      const run0 = this.runs.get(p) || {};
      const ens = run0.ensemble | 0;
      // 306845-306860：礼物等级/品质按合奏值分三档，且乐器带附魔 49 时更好
      let lvArg, fixArg;
      if (ens > 50) {
        lvArg = idiv(q, 10) + idiv(ens, 5);
        fixArg = 3 + (R(3) === 0 ? 1 : 0);                    // 306847
      } else if (ens > 0) {
        lvArg = idiv(q, 10) + idiv(ens, 5);
        fixArg = 3 + (R(20) === 0 ? 1 : 0);                   // 306850
      } else if (this.encFindSpec(p.inv[p.get(142) | 0], 49) !== -1) {
        lvArg = idiv(q, 8);                                   // 306854：附魔 49 → 等级更高
        fixArg = 3 + (R(4) === 0 ? 1 : 0);
      } else {
        lvArg = idiv(q, 10);                                  // 306857
        fixArg = 3;
      }
      const level = Elona.ItemDB.calcObjLv(lvArg, g);
      const fix = Elona.ItemDB.calcFixLv(fixArg, g);
      const cat = GIFT_CATS[R(GIFT_CATS.length)];
      let it = null;
      try {
        it = Elona.ItemDB.create(g, { level, fix, t639: cat });
      } catch (e) { it = null; }
      if (!it) return null;
      it.f[5] = tx; it.f[6] = ty;
      const cell = g.map.cell(tx, ty);
      if (cell) cell[4] = 1;                                  // 物品通道
      g.groundItems.push(it);
      return it;
    },

    // ------------------------------------------------------------------
    // 收场（306924-307060）
    // ------------------------------------------------------------------
    finish(g, p, power, ensemble, run) {
      const out = { messages: [], quality: p.get(144) | 0 };
      let q = p.get(144) | 0;
      // 306925：NPC 演奏没有评语
      if ((p.index | 0) !== 0) {
        this.rowActEnd(p);
        return out;
      }
      // 306928-307005：评语（恰好 40 有专用文案，不能落到「<60」档）
      const tier = (q === QUALITY0)
        ? RESULT_TIERS.find((t) => t.exact === QUALITY0)
        : (RESULT_TIERS.find((t) => t.below !== undefined && q < t.below) || RESULT_TIERS[RESULT_TIERS.length - 1]);
      out.messages.push(tier.en);
      // 307007-307009：成功时按演奏力加成
      if (q > QUALITY0) {
        q = Math.floor(q * (100 + idiv(power, 5)) / 100);
        p.set(144, q);
      }
      // 307010-307018：おひねり合计
      if ((p.get(145) | 0) !== 0) {
        out.messages.push(`合计收到 ${p.get(145) | 0} gp 的小费。`);
      }
      // 307019-307023：演奏技能经验
      const exp = limit(q - (p.skill(SKILL) | 0) - ensemble + 20, 1, 800);
      if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, SKILL, p, exp, 0, 0, g);
      if ((p.get(27) | 0) === 326 || (p.get(27) | 0) === 675) {
        if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, SKILL, p, exp, 0, 0, g);
      }
      // 307024-307057：合奏时同伴也涨经验
      if (ensemble > 0) {
        const reachM = 1;
        for (const c of g.charas) {
          if (!c || (c.get(0) | 0) !== 1 || c === p) continue;
          const d = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
          if (d > reachM) continue;
          if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, p.x, p.y, c.x, c.y)) continue;
          const e2 = limit(q - (c.skill(SKILL) | 0) - ensemble + 20, 1, 800);
          if (e2 > 0 && Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(c, SKILL, c, e2, 0, 0, g);
        }
      }
      out.quality = q;
      this.rowActEnd(p);
      return out;
    },

    // ------------------------------------------------------------------
    // 舞蹈（*label_2914，307090-307247 → rowact 17）
    //   能力 767（由 feat 21「舞踏」觉醒）。在派对会场回合数是 41，其它地方 4。
    //   每 20 回合结算一次听众：兴奋度 +2+rnd(10)（原版槽位 57..244 → 本项目 ≥16），
    //   打赏沿用演奏的公式；收尾给 魅力 经验 limit(出来-魅力, 10, 100)。
    // ------------------------------------------------------------------
    inPartyRoom(g) {
      if (g.questMap && (g.questMap.type | 0) === 1009) return true;
      const n = (g.map && (g.map.name === 'Party Room' || g.map.name === '派对会场')) || false;
      return !!n;                                     // 307102：var_494(0) == "パーティー場"
    },

    /** 307091-307108：开始跳舞（rowact 17） */
    startDance(g, p) {
      p.set(140, ROWACT_DANCE);
      p.set(141, this.inPartyRoom(g) ? 41 : 4);       // 307100 / 307103
      p.set(144, 60);                                 // 307106：出来初始 60
      p.set(145, 0);                                  // 307107：打赏累计
      this.runs.set(p, { dance: true, ensemble: 0, gifts: 0, messages: [] });
      g.log('你开始跳舞。');                           // 307096
      g.endTurn();
      return { ok: true, started: true, turns: p.get(141) };
    },

    /** 307110-307247：舞蹈的每回合推进 */
    danceTick(g) {
      const p = g.player;
      if ((p.get(140) | 0) !== ROWACT_DANCE) return null;
      const out = { type: ROWACT_DANCE, messages: [], tips: 0, ended: false, quality: p.get(144) | 0 };
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      const left = (p.get(141) | 0);
      if (left > 0) {
        p.set(141, left - 1);
        // 307111：每 20 回合（剩余 40 / 20 时）结算听众
        if (left % 20 === 0) {
          const wave = this.danceWave(g, p, out);
          out.messages.push(...wave.messages);
          out.tips += wave.tips;
          const ps = this.partyScore(g);
          if (ps.delta > 0) out.messages.push(`听众的反应变好了 (+${ps.delta})。`);
          else if (ps.delta < 0) out.messages.push(`听众的反应变差了 (${ps.delta})。`);
          out.quality = p.get(144) | 0;
          return out;
        }
        out.quality = p.get(144) | 0;
        return out;
      }
      // 307249-307264：收尾
      const tips = p.get(145) | 0;
      if (tips !== 0) out.messages.push(`你一共收到了 ${tips} 枚金币的打赏。`);   // 307254
      const q = p.get(144) | 0;
      if (q !== 0) {
        const exp = limit(q - (p.skill(17) | 0), 10, 100);                        // 307259
        if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, 17, p, exp, 0, 0, g);
        out.messages.push(`你的魅力技能提升了（${exp}）。`);
      }
      this.rowActEnd(p);
      out.ended = true;
      out.quality = q;
      return out;
    },

    /** 307114-307247：舞蹈的听众结算（打赏 + 派对兴奋度） */
    danceWave(g, p, out) {
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      const res = { messages: [], tips: 0 };
      const charm = p.skill(17) | 0;                  // var_82(17) 魅力
      const now = this.nowHour(g);
      let tipSum = 0;
      for (let i = 16; i < g.charas.length && i < 245; i++) {
        const c = g.charas[i];
        if (!c || (c.get(0) | 0) !== 1 || c === p) continue;    // 307115 / 307152
        const d = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
        if (d > 3) continue;                                    // 307127
        if (now >= (c.get(15) | 0)) c.set(14, 100);             // 307118
        if ((c.get(14) | 0) <= 0) continue;                     // 307131
        if ((c.get(251) | 0) > 0) continue;                     // 307134
        if ((c.get(253) | 0) > 0) continue;                     // 307137（未移植，恒 0）
        if ((c.get(256) | 0) >= 60) continue;                   // 307140
        if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 992) === 1) continue;   // 307143
        // 307155-307159：気力消耗
        c.set(14, (c.get(14) | 0) - R(15));
        c.set(15, now + 12);
        // 307161-307172：关系 -3（中立动物）→ 只注意到你
        if ((c.get(9) | 0) === -3) {
          if ((c.get(201) | 0) === 0) res.messages.push(`${this.nameOf(c)} 注意到了你。`);
          c.set(201, 30);
          continue;
        }
        // 307174-307193：気力耗尽 → 听腻
        if ((c.get(14) | 0) <= 0) {
          c.set(14, 0);
          res.messages.push(`${this.nameOf(c)}：「看腻了。」`);
          continue;
        }
        // 307195-307219：打赏（1/3 概率）
        if (R(3) === 0 && (c.get(14) | 0) > 0) {
          let amt = limit((c.get(38) | 0) + 5 + R(idiv(c.get(38) | 0, 2) + 2), 0, (c.get(38) | 0) * 5);
          const job = c.get(150) | 0;
          if ((job >= 1000 && job < 2000) || job === 2003) amt = Math.max(1, idiv(amt, 100));
          if (this.hasAnyBit(c, [23, 27, 964])) amt = limit(idiv(amt + 1, 5) + 1, 1, 3000);
          if (amt > (c.get(30) | 0)) amt = c.get(30) | 0;
          c.set(30, (c.get(30) | 0) - amt);
          p.set(30, (p.get(30) | 0) + amt);
          tipSum += amt;
          if ((c.index | 0) >= 16) {                // 307213-307217
            c.set(14, (c.get(14) | 0) - 20);
            c.set(15, now + 12);
          }
        }
        // 307221-307238：太高档的客人不感兴趣；魅力掷骰成功 → 兴奋度上升
        if ((c.get(38) | 0) * 4 > charm) continue;
        let gain = R(idiv(c.get(38) | 0, 2) + 2) + (c.get(38) | 0) + 5;
        if (this.hasAnyBit(c, [23, 27, 964])) gain = limit(idiv(gain + 1, 5) + 1, 1, 30);
        if (R(charm + 1) > R((c.get(38) | 0) * 4 + 5)) {
          if ((g.getV65(70) | 0) === 1009 && (c.index | 0) >= 16 && (c.get(17) | 0) < 53) {
            c.set(17, (c.get(17) | 0) + 2 + R(10));              // 307232
            if (Elona.QuestMap && Elona.QuestMap.partyScore) Elona.QuestMap.partyScore(g);   // 307233
          }
          p.set(144, (p.get(144) | 0) + gain);                   // 307237：出来上升
        }
      }
      if (tipSum > 0) {                                          // 307240-307245
        p.set(145, (p.get(145) | 0) + tipSum);
        res.tips += tipSum;
      }
      return res;
    },

    rowActEnd(p) {
      p.set(140, 0); p.set(141, 0); p.set(142, 0);
      this.runs.delete(p);
    },
  };

  Elona.Perform = Perform;
  Elona.Perform.SKILL = SKILL;
  Elona.Perform.ROWACT = ROWACT;
  Elona.Perform.ROWACT_DANCE = ROWACT_DANCE;
  Elona.Perform.TEXT = TEXT;
  Elona.Perform.RESULT_TIERS = RESULT_TIERS;
})(window);
