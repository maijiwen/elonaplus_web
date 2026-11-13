'use strict';
/**
 * 恋爱 / 婚姻 / 生育（core/relation.js）
 *
 * 【源码依据】
 *   8729-8742     关系阶段名表（var_258..var_269，12 组；var_262 是恋爱组）
 *   11000-11186   心情菜单 txtselectkimoti0/1/2（11 项，第 10 项按已婚与否切换）
 *   290141-290359 说「気持ち」的结算：表白 / 轻浮 / 侮辱 / 求婚 / 生子
 *   290179-290180 每次消耗気力 -80、冷却 12 小时
 *   290345-290358 求婚成功：cbit 961、结婚次数 var_65(250+31)++、登记年份、evadd 13
 *   290247-290303 生子：已婚 + var_65(90) >= 13 + 地图非 30 → cbit 962
 *
 * 【字段】
 *   var_58(17, c)  好感度（impression，求婚需要 >= 200）
 *   var_58(14, c)  気力（每次 -80）
 *   var_58(15, c)  下次可说的时刻（+12 小时）
 *   var_58(58, c)  可婚标志（0 = 拒绝求婚）
 *   var_58(400..402, c) 结婚的年/月/日
 *   cbit 961       已婚
 *   cbit 962       怀孕
 *   var_65(90)     世界经过天数（>= 13 才能生子）
 *   var_65(250+31) 结婚次数
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const IMPRESSION = 17;
  const MASTER_RELATION = 169;   // var_58(169)：主从关系（193418 modimp2）
  const REL_TYPE = 441;          // var_58(441)：关系类型（-1..-13）
  const VIGOR = 14;
  const NEXT_TALK = 15;
  // A128（0-HG）：var_58(58) 是「所属阵营」，不是独立的「可婚标志」。
  //   0   = 野生 / 未加入我方 → 290335 求婚时被婉拒
  //   100 = 玩家阵营的居民或队友（301962 旧存档迁移写入）
  const MARRY_FLAG = 58;
  const MARRY_DAY = [400, 401, 402];   // 年 / 月 / 日

  const CBIT_MARRIED = 961;
  const CBIT_PREGNANT = 962;

  // 290179-290180
  const TALK_VIGOR_COST = 80;
  const TALK_COOLDOWN_HOURS = 12;
  // 289584-289590：冷却到期时気力回满 100；「気持ちを伝える」要求 >= 80（A183）
  const VIGOR_FULL = 100;
  const FEELINGS_MIN_VIGOR = 80;
  // 290325 / 290182
  const NEED_PROPOSE = 200;
  const NEED_AFFECTION = 150;

  /**
   * 心情菜单（11000-11186）。
   * choice → 结算分支（290181-290246）：
   *   1..3  表白（好感 >= 150 → +12；>= 75 → 敷衍；< 75 → -5）
   *   4..6  轻浮（+7）
   *   7..9  侮辱（好感 >= 150 → 愤怒 dmgcon 5；否则耸肩）
   *   10    求婚 / 生子
   */
  const MENU = [
    { id: 0, en: 'After all nothing.', jp: 'やっぱりなんでもない' },
    { id: 1, en: 'I love you.', jp: '愛している', group: 'love' },
    { id: 2, en: 'You are so cute I could eat you up.', jp: '食べちゃいたい', group: 'love' },
    { id: 3, en: 'I like you very much.', jp: '大好き', group: 'love' },
    { id: 4, en: 'I rely on you.', jp: '頼りにしている', group: 'flirt' },
    { id: 5, en: 'I look forward to your future.', jp: 'これからが楽しみ', group: 'flirt' },
    { id: 6, en: 'I do not hate you.', jp: '嫌いじゃない', group: 'flirt' },
    { id: 7, en: 'You are useless.', jp: '役立たず', group: 'insult' },
    { id: 8, en: 'I am you uncomfortable.', jp: 'キモい', group: 'insult' },
    { id: 9, en: 'I hate you.', jp: '大嫌い', group: 'insult' },
    { id: 10, en: 'May I ask for your hand?', jp: '【結婚してほしい】', group: 'marry' },
  ];
  const MENU_MARRIED = 'Let\'s make a gene.';   // 11182

  /**
   * 【A134 / A149】心情菜单的三套文案（数据：web/data/tables/kimoti.json）。
   *
   * 源码 290141-290149：`var_65(12) \ 3`（HSP 的 `\` 是取余）按当前日期选
   * txtselectkimoti0 / 1 / 2；三套都由 11140-11280 定义，各 11 项，
   * 第 10 项在 cbit 961（已婚）时换成「遺伝子を残したい」（三套共用）。
   *
   * 选项只是文案不同：290181-290246 的结算按 choice 分组（1-3 表白 / 4-6 轻浮 /
   * 7-9 侮辱 / 10 求婚），与套别无关，因此 talk() 不需要改动。
   * 表未加载（例如纯 Node 单测）时回退到第 0 套，保持旧行为。
   */
  let KIMOTI = null;
  function setKimoti(t) { KIMOTI = t; }
  function kimotiTable() {
    if (KIMOTI) return KIMOTI;
    if (Elona.Data && Elona.Data.tableSync) {
      try { KIMOTI = Elona.Data.tableSync('kimoti'); } catch (e) { KIMOTI = null; }
    }
    return KIMOTI;
  }
  /** 当前日期对 3 取余（290142 / 290145 / 290148）；负值也回绕到 0..2 */
  function kimotiSetIndex(g) {
    const day = (g && typeof g.getV65 === 'function') ? (g.getV65(12) | 0) : 0;
    return ((day % 3) + 3) % 3;
  }

  function idiv(a, b) { return Math.trunc((a | 0) / (b | 0)); }
  function limit(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ======================================================================
  // modimp / modimp2（start.hsp 193311-193505）—— 好感度与主从关系的增减
  //
  // 【已确认 1】implevel(v)（193285-193310）：好感等级 0..8
  //   <10→0, <25→1, <40→2, <75→3, <100→4, <150→5, <200→6, <300→7, else 8
  // 【已确认 2】implevel2(v)（193395-193417）：主从关系等级 0..7
  //   <-100→0, <0→1, <100→2, <150→3, <200→4, <250→5, <300→6, else 7
  // 【已确认 3】modimp(cc, delta)（193311-193392）
  //   var_1035 = implevel(var_58(17, cc))
  //   delta<0 → 直接用；否则 delta*100/(50 + level³)（**好感越高越难加**）
  //     结果为 0 时：level < rnd(10) → 记 1（小概率仍生效）
  //   var_58(441) ∈ [-9,-1]（敌对种族/立场）且 delta>0 → delta*3/2
  //   var_97(44)（特质「優しい笑顔」等级）非 0 → delta++
  //   写回 var_58(17, cc)；上限：441>=0 → 400，
  //     否则 400 + limit((sorg(158,0)+sorg(158,cc)+10)/5, 0, 599)（开锁技能 158 影响上限）
  //   delta>0 时 var_58(17, 0)++（玩家自身计数，上限 999）
  //   等级变化时输出「…との関係が<词>になった…/！」
  // 【已确认 4】modimp2(cc, delta)（193418-193505）= 主从关系（var_58(169)）
  //   同构，改用 implevel2；敌对条件为 var_58(441) <= -11；上限 300 / 300+…(0..699)；
  //   下限 -300；消息「…との主従関係が<词>になった。」
  // ======================================================================

  /** 好感等级（implevel，193285） */
  function implevel(v) {
    v = v | 0;
    if (v < 10) return 0;
    if (v < 25) return 1;
    if (v < 40) return 2;          // 原式 50 - 10
    if (v < 75) return 3;
    if (v < 100) return 4;
    if (v < 150) return 5;
    if (v < 200) return 6;
    if (v < 300) return 7;
    return 8;
  }

  /** 主从关系等级（implevel2，193395） */
  function implevel2(v) {
    v = v | 0;
    if (v < -100) return 0;
    if (v < 0) return 1;
    if (v < 100) return 2;
    if (v < 150) return 3;
    if (v < 200) return 4;
    if (v < 250) return 5;
    if (v < 300) return 6;
    return 7;
  }

  /** 特质「優しい笑顔」(id 44) 等级 —— var_97(44) */
  function smileLevel(c) {
    if (!c || !Elona.Feat || !Elona.Feat.get) return 0;
    const v = Elona.Feat.get(c, 44);
    return v | 0;
  }

  /** 关系词（relation_words.json：impression / master 两套） */
  let WORDS = null;
  function setWords(t) { WORDS = t; }
  async function loadWords() {
    if (WORDS) return WORDS;
    if (Elona.Data && Elona.Data.table) {
      WORDS = await Elona.Data.table('relation_words');
    }
    return WORDS;
  }
  function relationWord(kind, relType, level) {
    if (!WORDS) return null;
    const group = (WORDS[kind] || {})[kind === 'master' ? 'general' : 'general'];
    let g = group;
    // 按 var_58(441) 选专用词表
    for (const key in (WORDS[kind] || {})) {
      if ((WORDS[kind][key].relType | 0) === (relType | 0)) { g = WORDS[kind][key]; break; }
    }
    const w = g && g.words && g.words[level];
    return w ? w.ja : null;
  }
  function relationWordEn(kind, relType, level) {
    if (!WORDS) return null;
    let g = (WORDS[kind] || {}).general;
    for (const key in (WORDS[kind] || {})) {
      if ((WORDS[kind][key].relType | 0) === (relType | 0)) { g = WORDS[kind][key]; break; }
    }
    const w = g && g.words && g.words[level];
    return w ? w.en : null;
  }


  const Relation = {
    IMPRESSION, MASTER_RELATION, REL_TYPE, VIGOR, NEXT_TALK, MARRY_FLAG,
    implevel, implevel2, setWords, loadWords, relationWord, relationWordEn,
    CBIT_MARRIED, CBIT_PREGNANT, MENU,
    setKimoti, kimotiTable, kimotiSetIndex,
    TALK_VIGOR_COST, TALK_COOLDOWN_HOURS, NEED_PROPOSE, NEED_AFFECTION,
    VIGOR_FULL, FEELINGS_MIN_VIGOR,

    // ---------------- 状态 ----------------
    impression(c) { return c ? (c.get(IMPRESSION) | 0) : 0; },
    setImpression(c, v) { if (c) c.set(IMPRESSION, v | 0); },
    /** 主从关系（var_58(169)） */
    masterRelation(c) { return c ? (c.get(MASTER_RELATION) | 0) : 0; },
    /** 关系类型（var_58(441)）：-1 战友 / -2 朋友 / -3 对手 / -4 恋人 / -5 弟子 / -6 师匠 / -7 家族 / -11 契约者 / -12 饲主 / -13 忠诚 */
    relType(c) { return c ? (c.get(REL_TYPE) | 0) : 0; },
    /** modimp（290183 / 290219 / 290201 → 193311）：改好感 */
    addImpression(c, n) {
      if (!c) return 0;
      c.set(IMPRESSION, (c.get(IMPRESSION) | 0) + (n | 0));
      return this.impression(c);
    },

    // ---------------- modimp / modimp2（193311-193505）-----------------
    /**
     * modimp(cc, delta) —— 好感度增减（完整语义）
     * @param {object} c     目标角色（cc）
     * @param {number} delta 增减量（正 = 提升）
     * @param {object} [g]   游戏对象（提供 rng / player）
     * @returns {object} { value, delta, levelBefore, levelAfter, word, message, changed }
     */
    modimp(c, delta, g) {
      if (!c) return { value: 0, delta: 0, levelBefore: 0, levelAfter: 0, word: null, message: null, changed: false };
      const rng = (g && g.rng) ? g.rng : { rnd: (n) => 0 };
      const cur = c.get(IMPRESSION) | 0;
      const lvBefore = implevel(cur);
      let d = delta | 0;
      if (d >= 0) {
        d = idiv(d * 100, 50 + lvBefore * lvBefore * lvBefore);   // 193317
        if (d === 0) {
          if (lvBefore < rng.rnd(10)) d = 1;                        // 193319-193321
        }
      }
      const rel = c.get(REL_TYPE) | 0;
      if (rel <= -1 && rel >= -9 && d > 0) d = idiv(d * 3, 2);     // 193324-193328
      if (smileLevel(c) !== 0) d++;                                 // 193329-193331
      let v = cur + d;
      if (rel >= 0) {
        if (v > 400) v = 400;                                       // 193333-193337
      } else {
        const p0 = (g && g.player) ? g.player : null;
        const s158 = (p0 && Elona.Stats) ? Elona.Stats.sorg(p0, 158) : 0;
        const s158c = (Elona.Stats) ? Elona.Stats.sorg(c, 158) : 0;
        const cap = 400 + limit(idiv(s158 + s158c + 10, 5), 0, 599);
        if (v > cap) v = cap;                                       // 193338-193342
      }
      c.set(IMPRESSION, v);
      if (d > 0 && g && g.player) {                                 // 193343-193348
        const self = g.player.get(IMPRESSION) | 0;
        g.player.set(IMPRESSION, self >= 999 ? 999 : self + 1);
      }
      const lvAfter = implevel(v);
      const word = relationWord('impression', rel, lvAfter);
      let message = null;
      if (lvBefore > lvAfter) {
        message = `与${this.nameOf(c)}的关系变成了<${word || lvAfter}>…`;
      } else if (lvAfter > lvBefore) {
        if ((c.get(9) | 0) !== -3) {
          message = `与${this.nameOf(c)}的关系变成了<${word || lvAfter}>！`;
        }
      }
      return { value: v, delta: d, levelBefore: lvBefore, levelAfter: lvAfter, word, message,
        changed: lvBefore !== lvAfter };
    },

    /**
     * modimp2(cc, delta) —— 主从关系（var_58(169)）增减（193418-193505）
     * @returns {object} { value, delta, levelBefore, levelAfter, word, message, changed }
     */
    modimp2(c, delta, g) {
      if (!c) return { value: 0, delta: 0, levelBefore: 0, levelAfter: 0, word: null, message: null, changed: false };
      const rng = (g && g.rng) ? g.rng : { rnd: (n) => 0 };
      const cur = c.get(MASTER_RELATION) | 0;
      const lvBefore = implevel2(cur);
      let d = delta | 0;
      if (d >= 0) {
        d = idiv(d * 100, 50 + lvBefore * lvBefore * lvBefore);   // 193424
        if (d === 0) {
          if (lvBefore < rng.rnd(10)) d = 1;                        // 193426-193428
        }
      }
      const rel = c.get(REL_TYPE) | 0;
      if (rel <= -11 && d > 0) d = idiv(d * 3, 2);                  // 193431-193435
      if (smileLevel(c) !== 0) d++;                                 // 193436-193438
      let v = cur + d;
      if (rel >= 0) {
        if (v > 300) v = 300;                                       // 193440-193444
      } else {
        const p0 = (g && g.player) ? g.player : null;
        const s158 = (p0 && Elona.Stats) ? Elona.Stats.sorg(p0, 158) : 0;
        const s158c = (Elona.Stats) ? Elona.Stats.sorg(c, 158) : 0;
        const cap = 300 + limit(idiv(s158 + s158c + 10, 5), 0, 699);
        if (v > cap) v = cap;                                       // 193445-193449
      }
      if (v < -300) v = -300;                                       // 193450-193452
      c.set(MASTER_RELATION, v);
      if (d > 0 && g && g.player) {                                 // 193481-193484
        const self = g.player.get(MASTER_RELATION) | 0;
        g.player.set(MASTER_RELATION, self >= 999 ? 999 : self + 1);
      }
      const lvAfter = implevel2(v);
      const word = relationWord('master', rel, lvAfter);
      let message = null;
      if (lvBefore > lvAfter) {
        message = `与${this.nameOf(c)}的主从关系变成了<${word || lvAfter}>。`;
      } else if (lvAfter > lvBefore) {
        if ((c.get(9) | 0) !== -3) {
          message = `与${this.nameOf(c)}的主从关系变成了<${word || lvAfter}>！`;
        }
      }
      return { value: v, delta: d, levelBefore: lvBefore, levelAfter: lvAfter, word, message,
        changed: lvBefore !== lvAfter };
    },
    isMarried(c) {
      if (!c || !Elona.Status || !Elona.Status.cbit) return false;
      return Elona.Status.cbit(c, CBIT_MARRIED) === 1;
    },
    isPregnant(c) {
      if (!c || !Elona.Status || !Elona.Status.cbit) return false;
      return Elona.Status.cbit(c, CBIT_PREGNANT) === 1;
    },
    marryCount(g) { return g.getV65(631) | 0; },     // 250+31

    /** 当前绝对小时（与银行同一公式） */
    nowHours(g) {
      return (g.getV65(13) | 0) + (g.getV65(12) | 0) * 24
        + (g.getV65(11) | 0) * 720 + (g.getV65(10) | 0) * 8640;
    },

    /**
     * A183 / 289584-289586：生成 NPC 对话菜单时，若已过冷却（now >= var_58(15)），
     * 把 var_58(14) 気力回满 100。原版在追加任何菜单项之前无条件执行。
     * @returns {number} 刷新后的気力
     */
    refreshVigor(g, c) {
      if (!c) return 0;
      if (g && typeof g.getV65 === 'function') {
        if (this.nowHours(g) >= (c.get(NEXT_TALK) | 0)) c.set(VIGOR, VIGOR_FULL);
      }
      return c.get(VIGOR) | 0;
    },

    /** A183 / 289587-289590：var_58(14) >= 80 才追加「気持ちを伝える」 */
    canShowFeelings(g, c) {
      if (!c || (c.get(0) | 0) !== 1) return false;
      return this.refreshVigor(g, c) >= FEELINGS_MIN_VIGOR;
    },

    /** 290169-290177 / 290179-290180：说话的基础消耗与冷却 */
    canTalk(g, c) {
      if (!c) return { ok: false, reason: 'no-target' };
      if ((c.get(0) | 0) !== 1) return { ok: false, reason: 'not-chara' };
      const now = this.nowHours(g);
      if ((c.get(NEXT_TALK) | 0) > now) {
        return { ok: false, reason: 'cooldown', wait: (c.get(NEXT_TALK) | 0) - now };
      }
      return { ok: true };
    },

    /**
     * 心情菜单（11000-11280）。
     * 【A134 / A149】按 `var_65(12) \ 3` 选三套文案之一（290141-290149），
     * 已婚时第 10 项替换为「遺伝子を残したい」；数据缺位时回退第 0 套。
     * @param {object} c 对象 NPC
     * @param {object} [g] Game 实例（提供 var_65(12) 日期；不传时按第 0 套）
     */
    menu(c, g) {
      const married = this.isMarried(c);
      const t = kimotiTable();
      const set = t && t.sets ? t.sets[kimotiSetIndex(g)] : null;
      const rows = (set && set.length === 11) ? set : MENU;
      const marriedText = (t && t.married)
        || { en: MENU_MARRIED, jp: '【遺伝子を残したい】' };
      return rows.map((m) => {
        const row = Object.assign({}, m);
        if ((m.id | 0) === 10 && married) {
          row.en = marriedText.en || row.en;
          row.jp = marriedText.jp || row.jp;
        }
        return row;
      });
    },

    /**
     * 说「気持ち」（290141-290359）。
     * @param {object} g
     * @param {object} c 对象 NPC
     * @param {number} choice 0..10
     * @returns {object} { ok, spent, messages, married, pregnant, impression, ... }
     */
    talk(g, c, choice) {
      const can = this.canTalk(g, c);
      if (!can.ok) return { ok: false, reason: can.reason, wait: can.wait };
      const ch = choice | 0;
      if (ch < 0 || ch > 10) return { ok: false, reason: 'bad-choice' };

      const res = { ok: true, messages: [], impression: this.impression(c), leveled: null };
      const p = g.player;

      // 290179-290180：気力 -80（源码 `var_58(14) -= 80` 无条件递减）、冷却 12 小时
      c.set(VIGOR, (c.get(VIGOR) | 0) - TALK_VIGOR_COST);
      c.set(NEXT_TALK, this.nowHours(g) + TALK_COOLDOWN_HOURS);

      // 290161-290168：选了「やっぱりなんでもない」只是取消
      if (ch === 0) {
        res.messages.push('你什么也没说出口。');
        res.cancelled = true;
        return this.finish(res, c);
      }

      // 290169-290177：マスター说明（var_58(191,0) == 5）—— 只影响日志，不参与判定
      if ((p.get(191) | 0) === 5) {
        p.set(191, (p.get(191) | 0) + 1000);
        res.messages.push('ジャーナルが更新された。');
      }

      const imp = this.impression(c);

      // 290181-290210：表白 1..3
      if (ch >= 1 && ch <= 3) {
        if (imp >= NEED_AFFECTION) {
          const r = this.modimp(c, 12, g);          // 290183：modimp var_244, 12
          if (r.message) res.messages.push(r.message);
          res.leveled = 'happy';
          res.messages.push(`${this.nameOf(c)} looks happy.`);
        } else if (imp >= 75) {
          res.leveled = 'awkward';
          res.messages.push(`${this.nameOf(c)} seemed to think it was an exaggerated joke.`);
        } else {
          const r = this.modimp(c, -5, g);          // 290201：modimp var_244, -5
          if (r.message) res.messages.push(r.message);
          res.leveled = 'creepy';
          res.messages.push(`${this.nameOf(c)} felt you creepy.`);
        }
        return this.finish(res, c);
      }

      // 290211-290221：轻浮 4..6
      if (ch >= 4 && ch <= 6) {
        const r = this.modimp(c, 7, g);            // 290219：modimp var_244, 7
        if (r.message) res.messages.push(r.message);
        res.leveled = 'flattered';
        res.messages.push(`${this.nameOf(c)} felt it wasn't too bad.`);
        return this.finish(res, c);
      }

      // 290222-290246：侮辱 7..9
      if (ch >= 7 && ch <= 9) {
        if (imp >= NEED_AFFECTION) {
          res.leveled = 'angry';
          res.messages.push(`${this.nameOf(c)} can't believe the ear...`);
          // 290224：dmgcon(5, 1000) —— 愤怒状态
          if (Elona.Battle && Elona.Battle.dmgcon) Elona.Battle.dmgcon(c, 5, 1000);
          else c.set(201, 5);
        } else if (imp >= 75) {
          res.leveled = 'pity';
          res.messages.push(`${this.nameOf(c)} looked at you with merciful eyes.`);
        } else {
          res.leveled = 'shrug';
          res.messages.push(`${this.nameOf(c)} shrugged.`);
        }
        return this.finish(res, c);
      }

      // 290247-290359：choice 10 —— 求婚 / 生子
      if (this.isMarried(c)) return this.makeGene(g, c, res);
      return this.propose(g, c, res);
    },

    finish(res, c) {
      res.impression = this.impression(c);
      return res;
    },

    nameOf(c) {
      if (!c) return '?';
      try { return (c.name && c.name !== '') ? c.name : (c.nameEn || '对方'); } catch (e) { return '对方'; }
    },

    /**
     * 求婚（290306-290359）。
     * 条件：未结婚 + 好感 >= 200 + var_58(58) != 0
     */
    propose(g, c, res) {
      const out = res || { ok: true, messages: [] };
      const imp = this.impression(c);

      // 290308-290324：已有配偶的 NPC（var_58(27) == 359 且存在 665）会阻止
      if ((c.get(27) | 0) === 359) {
        const guard = (g.charas || []).find((x) => x && (x.get(0) | 0) === 1 && (x.get(27) | 0) === 665);
        if (guard) {
          out.messages.push(`${this.nameOf(guard)}「私が許しませんよ！」`);
          out.blocked = 'guardian';
          return this.finish(out, c);
        }
      }

      if (imp < NEED_PROPOSE) {
        out.messages.push(`…${this.nameOf(c)} gently refuses your proposal.`);
        out.refused = 'impression';
        return this.finish(out, c);
      }
      if ((c.get(MARRY_FLAG) | 0) === 0) {
        // 290335-290343：源码台词是「嬉しいが、俺の立場も考えてくれ」/
        // "...X sadly refuses your proposal."，不是单纯摇头。
        out.messages.push(`…${this.nameOf(c)} sadly refuses your proposal.`
          + '「嬉しいが、俺の立場も考えてくれ」');
        out.refused = 'unavailable';
        return this.finish(out, c);
      }

      // 290345-290358：结婚成立
      if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, CBIT_MARRIED, true);
      c.set(27, c.get(27) | 0);
      g.setV65(631, this.marryCount(g) + 1);
      c.set(MARRY_DAY[0], g.getV65(11) | 0);
      c.set(MARRY_DAY[1], g.getV65(12) | 0);
      c.set(MARRY_DAY[2], g.getV65(10) | 0);
      g.setV65(98, g.player.index | 0);          // 290301：var_65(98) = 配偶下标
      out.married = true;
      out.messages.push(`…${this.nameOf(c)} blushed and nodded!`);
      out.messages.push('（结婚次数 +1）');
      if (Elona.Event && Elona.Event.add) {
        try { Elona.Event.add(g, 13); } catch (e) { /* 事件表缺失不阻断 */ }
      }
      return this.finish(out, c);
    },

    /**
     * 生子（290247-290303）。
     * 条件：已婚 + var_65(90) >= 13 + 地图类型非 30
     */
    makeGene(g, c, res) {
      const out = res || { ok: true, messages: [] };
      const mode = g.getV65(629) | 0;      // 250+23：游戏模式
      if (mode === 2 || mode === 5) {
        out.messages.push('このゲームモードでは遺伝子を残せない。');
        out.blocked = 'mode';
        return this.finish(out, c);
      }
      if ((g.getV65(90) | 0) < 13) {
        out.messages.push(`「まだ眠くない」`);
        out.blocked = 'too-early';
        return this.finish(out, c);
      }
      if ((g.getV65(20) | 0) === 30) {
        out.messages.push(`「こんな場所では嫌」`);
        out.blocked = 'wrong-map';
        return this.finish(out, c);
      }
      if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, CBIT_PREGNANT, true);
      out.pregnant = true;
      out.messages.push('「いやん、あなたったら…」');
      out.messages.push('（对方似乎怀上了孩子）');
      return this.finish(out, c);
    },

    /**
     * 关系阶段名（【0-BV】按原版 implevel（193285）分级 + var_262 恋爱组词表）
     *   0 大嫌い / 1 嫌い / 2 うざい / 3 普通 / 4 好意的 / 5 恋心 / 6 相思相愛 / 7 熱愛 / 8 Love
     *   （此前为自拟分段，与源码不一致，本轮按源码修正）
     */
    romanceStage(imp) {
      const lv = implevel(imp);
      const jp = relationWord('impression', -4, lv);
      const en = relationWordEn('impression', -4, lv);
      return { id: lv, jp: jp || '', en: en || '' };
    },
  };

  Elona.Relation = Relation;
  if (typeof module !== 'undefined' && module.exports) module.exports = Relation;
})(typeof window !== 'undefined' ? window : global);
