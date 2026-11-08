'use strict';
/**
 * 许愿（願い / Wish）—— 对应 start.hsp 的 *label_2729 主流程（287733-288616）。
 *
 * 【已确认流程】
 *   287624 *label_2724  文本清洗：删 `,` ` ` `　` 与 "アイテム"/"item"/"スキル"/"skill"
 *   287793-287798       "中の神" → 彩蛋
 *   287801-287807       "中の人" → 彩蛋
 *   287809-287907       9 位神名 → 直接召唤该神（characreate -1, 物种, 玩家x, 玩家y）
 *   287898-287907       "q"/"Q" → 量子物理生命体（物种 415）
 *   287909-287919       若さ/若返り/年/美貌 → 年龄 +20（不超过「今年 - 12」）
 *   287921-287954       通り名/異名 → 改名（需要二次输入）
 *   287956-288018       転職/職 → 转职（需要二次输入）
 *   288020-288046       転生/種族 → 转生（需要二次输入）
 *   288048-288062       性転換/性/異性/sex → 变性
 *   288064-288079       贖罪 → 若 karma<0 则 karma 减半归零侧（`modkarma 0, karma/2*(-1)`）
 *   288081-288088       死 → 99999 伤害
 *   288090-288092       仲間 → evadd 12（宠物重逢事件）
 *   288094-288103       金/金貨/富/財産 → 金币 `(等级/3+1)*10000`
 *   288105-288114       メダル → 小奖章 `3+rnd(3)`
 *   288116-288125       プラチナ → 白金币 5
 *   288127-288135       あの犬 → 犬笛(876)
 *   288137-288145       新年问候 → 小奖章 `3+rnd(3)`
 *   288147-288153       圣诞 → 只台词
 *   288155-288166       情人节 → 手作りチョコ(889)，f[25]=3 f[27]=6 f[17]=0
 *   288168-288178       隠しキャラ → 需 var_65(250+233)>=1000，evadd 38
 *   288180-288262       送還 → 清除 355-360/336/481/483 的里神
 *   288264-288274       スキルチケット → 物品 1093
 *   288276-288277       "スキル"/"skill" → 技能/属性许愿
 *   288279-288280       "アイテム"/"item" → 物品许愿
 *   288282-288283       "カード"/"card" → 角色卡片
 *   288285-288286       剥製/はく製/figure → 标本
 *   288288-288480       物品匹配（label_2730）
 *   288481-288555       技能匹配（label_2731）
 *   288556-288587       卡片/标本（label_2732/2733）
 *
 * 【匹配算法（物品，288316-288320）】
 *   repeat strlen(愿望):
 *     if (instr(物品名, strmid(愿望, 0, cnt+1)) != -1) score += 50*(cnt+1) + rnd(15)
 *   完全同名 → 直接 10000。取分最高者。
 *
 * 【匹配算法（技能，288504-288508）】
 *   逐字符：命中 +50+rnd(15)；完全同名 → 10000。
 *   命中后：未习得 → skillgain(+1)；已习得 → skillmod(+1) + modgrowth(+25 潜力)。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // 287809-287907：神名 → 物种 id
  const GODS = [
    { keys: ['エヘカトル', 'ehekatl'], species: 331, line: '「うみみゅみゅぁ！」' },
    { keys: ['ルルウィ', 'lulwy'], species: 306, line: '「アタシを呼びつけるとは生意気ね」' },
    { keys: ['オパートス', 'opatos'], species: 338, line: '「フゥハハハハハハー！来てやったぞ」' },
    { keys: ['クミロミ', 'kumiromi'], species: 339, line: '「君が僕を呼んでくれるなんて…嬉しい…」' },
    { keys: ['マニ', 'mani'], species: 342, line: '「よくぞ呼んだ。私を崇め称える権利をやろう」' },
    { keys: ['イツパロトル', 'itzpalt'], species: 484, line: '「その魂に刻め、これも元素の紡ぐ運命なり」' },
    { keys: ['ヤカテクト', 'yacatect'], species: 482, line: '「お呼びとあらば即参上！なんや？商談やろか？」' },
    { keys: ['ジュア', 'jure'], species: 359, line: '「べ、別に来たくて来たわけじゃないんだからね！」' },
  ];
  const Q_KEYS = ['q', 'Q'];
  const Q_SPECIES = 415;

  const T = {
    nothing: '何もおきない…',
    noPower: '願いの女神の力も、ここには届かないようだ…。',
    drop: (n) => `足元に${n}が転がってきた。`,
  };

  const MESSAGES = {
    insideGod: '中の神も大変…あ…中の神なんているわけじゃないじゃない！…ねえ、聞かなかったことにしてね。',
    insideMan: '中の人も大変ね。',
    youth: 'ふぅん…そんな願いでいいんだ。',
    aliasDeny: 'だめよ。',
    aliasAsk: '新しい異名は？',
    classAsk: 'なりたい職業は？',
    raceAsk: '生まれ変わりたい種族は？',
    sexChange: (sex) => `なった！ …もう後戻りはできないわよ。`,
    noSin: '…罪なんて犯してないじゃない。',
    redeem: 'あら…都合のいいことを言うのね。',
    death: 'それがお望みなら…',
    gold: '金貨が降ってきた！',
    medal: '小さなメダルが降ってきた！',
    platinum: 'プラチナ硬貨が降ってきた！',
    dog: '∪・ω・Ｕ 「ニャーン！」',
    newYear: 'めでたいわね。',
    christmas: 'え？今年もクリスマスは中止でしょ？',
    valentine: 'まったく、しょうがないわね…。',
    secretDenied: 'そ、そんなのいるわけないじゃない！',
    sendBack: 'ほーら、どうどう。',
    skillLearn: (n) => `${n}の技術を会得した！`,
    skillUp: (n) => `${n}の技術が上達した！`,
    ticket: (n) => `足元に${n}が転がってきた。`,
    generic: '「…！！」',
  };

  /** 287624：文本清洗 */
  function sanitize(text) {
    let s = String(text === undefined || text === null ? '' : text);
    s = s.replace(/,/g, '').replace(/ /g, '').replace(/\u3000/g, '');
    s = s.replace(/アイテム|item/gi, '');
    s = s.replace(/スキル|skill/gi, '');
    return s;
  }
  /** label_2734 / fix_wish：卡片/标本许愿时去掉修饰词 */
  function fixWish(s) {
    return String(s || '')
      .replace(/の剥製|剥製|のはく製|はく製/g, '')
      .replace(/のカード|カード|card |figure |card|figure/gi, '');
  }

  // ---------- 名称表 ----------
  let ITEM_ROWS = null;      // [{ id, jp, en, ch }]
  let SKILL_ROWS = null;     // [{ id, jp, en, ch }]
  let SPECIES_ROWS = null;   // [{ id, jp, en, ch }]

  function buildItemRows() {
    if (ITEM_ROWS) return ITEM_ROWS;
    const data = Elona.ItemDB && Elona.ItemDB.data;
    if (!data) return (ITEM_ROWS = []);
    ITEM_ROWS = [];
    for (const k in data) {
      const id = parseInt(k, 10);
      const it = data[k];
      ITEM_ROWS.push({ id, jp: it.nameJp || '', en: it.nameEn || '', ch: it.nameCh || '' });
    }
    return ITEM_ROWS;
  }
  function buildSkillRows() {
    if (SKILL_ROWS) return SKILL_ROWS;
    const names = (Elona.Spell && Elona.Spell.field) ? null : null;
    const tbl = Elona.Skills && Elona.Skills.names ? Elona.Skills.names : null;
    const src = tbl || (Elona.Data && Elona.Data.tableSync ? Elona.Data.tableSync('skills') : null);
    const map = src && (src.skillNames || src) ? (src.skillNames || src) : {};
    SKILL_ROWS = [];
    for (const k in map) {
      const id = parseInt(k, 10);
      // 288486-288493：只允许 10..19（属性）与 100..399（技能）
      if (!((id >= 10 && id < 20) || (id >= 100 && id < 400))) continue;
      // 汉化：ch 与 jp/en 同权重参与匹配
      SKILL_ROWS.push({ id, jp: map[k].jp || '', en: map[k].en || '', ch: map[k].ch || '' });
    }
    return SKILL_ROWS;
  }
  function buildSpeciesRows() {
    if (SPECIES_ROWS) return SPECIES_ROWS;
    const src = (Elona.Data && Elona.Data.tableSync) ? Elona.Data.tableSync('creature') : null;
    SPECIES_ROWS = [];
    if (src) {
      for (const k in src) {
        SPECIES_ROWS.push({ id: parseInt(k, 10), jp: src[k].nameJp || '', en: src[k].nameEn || '', ch: src[k].nameCh || '' });
      }
    }
    return SPECIES_ROWS;
  }

  /** 物品匹配（288288-288325） */
  function matchItem(g, text) {
    const R = (n) => ((g && g.rng) ? g.rng.rnd(n) : Math.floor(Math.random() * n));
    let best = null;
    const rows = buildItemRows();
    for (const row of rows) {
      if (row.id === 0 || row.id === 23 || row.id === 289 || row.id === 290 || row.id === 361) continue;
      let score = 0;
      const nm = row.en || row.jp;
      // 汉化：ch（nameCh）与 jp/en 同权重参与匹配，中文许愿输入也能命中
      if (row.jp === text || row.ch === text || nm === text) score = 10000;
      for (let n = 1; n <= text.length; n++) {
        const pre = text.slice(0, n);
        if ((row.jp && row.jp.indexOf(pre) !== -1) || (row.ch && row.ch.indexOf(pre) !== -1)
          || (nm && nm.indexOf(pre) !== -1)) {
          score += 50 * (n + 1) + R(15);
        }
      }
      if (score > 0 && (!best || score > best.score)) best = { id: row.id, score, name: row.ch || row.jp || nm };
    }
    return best;
  }

  /** 技能匹配（288481-288513） */
  function matchSkill(g, text) {
    const R = (n) => ((g && g.rng) ? g.rng.rnd(n) : Math.floor(Math.random() * n));
    let best = null;
    for (const row of buildSkillRows()) {
      let score = 0;
      // 汉化：ch（技能中文名）与 jp/en 同权重参与匹配，中文许愿输入也能命中
      if (row.jp === text || row.ch === text || row.en === text) score = 10000;
      for (let n = 0; n < text.length; n++) {
        const ch = text.charAt(n);
        if ((row.jp && row.jp.indexOf(ch) !== -1) || (row.ch && row.ch.indexOf(ch) !== -1)
          || (row.en && row.en.indexOf(ch) !== -1)) {
          score += 50 + R(15);
        }
      }
      if (score > 0 && (!best || score > best.score)) best = { id: row.id, score, name: row.ch || row.jp || row.en };
    }
    return best;
  }

  /** 物种匹配（288588-288616）：包含匹配，分 = 1000 - 长度差*10 */
  function matchSpecies(g, text) {
    let best = null;
    for (const row of buildSpeciesRows()) {
      const nm = row.ch || row.jp || row.en;
      if (!nm) continue;
      const hit = (row.ch && row.ch.indexOf(text) !== -1)
        || (row.jp && row.jp.indexOf(text) !== -1)
        || (row.en && row.en.indexOf(text) !== -1);
      if (hit) {
        const score = 1000 - (nm.length - text.length) * 10;
        if (!best || score > best.score) best = { id: row.id, score, name: nm };
      }
    }
    return best;
  }

  // ---------- 辅助 ----------
  function playerLevel(g) { return (g && g.player) ? (g.player.level | 0) : 1; }

  /** 在地面生成物品（itemcreate -1, id, x, y, count） */
  function spawnGround(g, id, count) {
    if (!Elona.ItemDB) return null;
    const p = g.player;
    let it = null;
    try {
      it = Elona.ItemDB.createItem(id, 1, g.rng);
    } catch (e) { it = null; }
    if (!it) return null;
    it.f[0] = Math.max(1, count | 0);
    it.f[5] = p.x; it.f[6] = p.y;
    const cell = g.map && g.map.cell ? g.map.cell(p.x, p.y) : null;
    if (cell) cell[4] = 1;
    g.groundItems.push(it);
    return it;
  }

  /** 生成怪物（characreate -1, species, x, y） */
  function spawnChara(g, species) {
    const p = g.player;
    const fac = Elona.CharaFactory;
    if (!fac || !fac.create) return null;
    const lv = Math.max(1, p.level | 0);
    try {
      const m = fac.create(g, species, lv, p.x, p.y, {});
      if (m && g.log) g.log(`${m.name || '何か'}が現れた！`);
      return m;
    } catch (e) { return null; }
  }

  function itemName(id) {
    const d = Elona.ItemDB && Elona.ItemDB.data;
    const it = d && d[String(id)];
    return it ? (it.nameCh || it.nameJp || it.nameEn || String(id)) : String(id);
  }

  // ---------- 主入口 ----------
  /**
   * 执行一次许愿。
   * @param {object} g
   * @param {string} raw 玩家输入的愿望文本
   * @param {object} [opt] { askAlias, askClass, askRace } 需要二次输入时的回调（返回字符串）
   * @returns {{ok:boolean, messages:string[], items:Array, effects:object}}
   */
  function run(g, raw, opt) {
    opt = opt || {};
    const out = { ok: true, messages: [], items: [], effects: {} };
    const p = g.player;
    const R = (n) => ((g && g.rng) ? g.rng.rnd(n) : Math.floor(Math.random() * n));
    if (!p) { out.ok = false; return out; }

    let text = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!text) { out.messages.push(T.nothing); return out; }

    // 287734-287752：特定地图女神之力不及（var_65(20)==76 且 var_65(22)==179）
    const mapId = (g.getV65 ? (g.getV65(20) | 0) : 0);
    const danger = (g.getV65 ? (g.getV65(22) | 0) : 0);
    if (mapId === 76 && danger === 179) {
      if ((g.getV65(2) | 0) < 845) { out.messages.push(T.noPower); return out; }
      out.messages.push('願いの女神も、今は神力に余裕がないようだ…。');
      return out;
    }

    // 287781：先去逗号与空白（源码 var_52 分支），关键字判断在完整清洗之前
    text = text.replace(/,/g, '').replace(/ /g, '').replace(/\u3000/g, '');

    // --- 彩蛋 ---
    if (text.indexOf('中の神') !== -1 || text.indexOf('god inside') !== -1) {
      out.messages.push(MESSAGES.insideGod); return out;
    }
    if (text.indexOf('中の人') !== -1 || text.indexOf('man inside') !== -1) {
      out.messages.push(MESSAGES.insideMan); return out;
    }

    // --- 神名召唤 ---
    for (const god of GODS) {
      if (god.keys.indexOf(text) === -1) continue;
      out.messages.push(god.line);
      out.effects.summon = spawnChara(g, god.species);
      return out;
    }
    if (Q_KEYS.indexOf(text) !== -1) {
      out.messages.push('「きゅー♪」');
      out.effects.summon = spawnChara(g, Q_SPECIES);
      return out;
    }

    // --- 年龄 ---
    if (['若さ', '若返り', '年', '美貌', 'youth', 'age', 'beauty'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.youth);
      const age = (p.get(21) | 0) + 20;
      const year = (g.getV65 ? (g.getV65(10) | 0) : 0);
      p.set(21, (age + 12 > year) ? year - 12 : age);
      return out;
    }

    // --- 异名 ---
    if (['通り名', '異名', 'aka', 'title', 'name', 'alias'].indexOf(text) !== -1) {
      if (g.getV65 && (g.getV65(828) | 0)) { out.messages.push(MESSAGES.aliasDeny); return out; }
      const alias = opt.askAlias ? opt.askAlias(MESSAGES.aliasAsk) : '';
      if (!alias) { out.messages.push('あら、そのままでいいの？'); return out; }
      p.name = alias;
      out.effects.alias = alias;
      out.messages.push(`あなたの新しい異名は「${alias}」。`);
      return out;
    }

    // --- 转职 ---
    if (['転職', '職', 'class', 'job'].indexOf(text) !== -1) {
      const cls = opt.askClass ? opt.askClass(MESSAGES.classAsk) : '';
      if (!cls) { out.messages.push('やっぱりやめた。'); return out; }
      p.className = cls;
      out.effects.class = cls;
      out.messages.push(`あなたの新しい職業は「${cls}」だ。`);
      return out;
    }

    // --- 转生 ---
    if (['転生', '種族', 'race'].indexOf(text) !== -1) {
      const race = opt.askRace ? opt.askRace(MESSAGES.raceAsk) : '';
      if (!race) { out.messages.push('やっぱりやめた。'); return out; }
      p.raceName = race;
      out.effects.race = race;
      out.messages.push(`あなたは「${race}」に生まれ変わった。`);
      return out;
    }

    // --- 变性 ---
    if (['性転換', '性', '異性', 'sex'].indexOf(text) !== -1) {
      const sex = (p.get(8) | 0) === 0 ? 1 : 0;
      p.set(8, sex);
      out.effects.sex = sex;
      out.messages.push(MESSAGES.sexChange(sex));
      return out;
    }

    // --- 赎罪 ---
    if (['贖罪', 'redemption', 'atonement'].indexOf(text) !== -1) {
      const karma = p.get(49) | 0;
      if (karma >= 0) { out.messages.push(MESSAGES.noSin); return out; }
      p.set(49, karma + idiv(karma, 2) * -1);
      out.messages.push(MESSAGES.redeem);
      return out;
    }

    // --- 死 ---
    if (['死', 'death'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.death);
      if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(p, 99999, g, null, 0, 0);
      else p.hp = 0;
      return out;
    }

    // --- 同伴（evadd 12） ---
    if (['仲間', 'friend', 'company', 'ally'].indexOf(text) !== -1) {
      if (g.events && g.events.add) g.events.add(12);
      else if (Elona.Event && Elona.Event.add) Elona.Event.add(g, 12);
      out.effects.evadd = 12;
      out.messages.push('…また、あの子に会えるといいわね。');
      return out;
    }

    // --- 金币 ---
    if (['金', '金貨', '富', '財産', 'money', 'gold', 'wealth', 'fortune'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.gold);
      const n = (idiv(playerLevel(g), 3) + 1) * 10000;
      const it = spawnGround(g, 54, n);
      if (it) out.items.push({ id: 54, count: n });
      return out;
    }
    // --- 小奖章 ---
    if (['メダル', '小さなメダル', 'ちいさなメダル', 'coin', 'medal', 'small coin', 'small medal'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.medal);
      const n = 3 + R(3);
      spawnGround(g, 622, n);
      out.items.push({ id: 622, count: n });
      return out;
    }
    // --- 白金币 ---
    if (['プラチナ', 'プラチナ硬貨', 'platina', 'platinum'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.platinum);
      spawnGround(g, 55, 5);
      out.items.push({ id: 55, count: 5 });
      return out;
    }
    // --- 那条狗 ---
    if (['あの犬', 'Ano犬'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.dog);
      spawnGround(g, 876, 1);
      out.items.push({ id: 876, count: 1 });
      return out;
    }
    // --- 新年 ---
    if (['あけましておめでとう！', 'あけましておめでとう', 'あけおめ', 'おめでとう', 'Happy New Year'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.newYear);
      const n = 3 + R(3);
      spawnGround(g, 622, n);
      out.items.push({ id: 622, count: n });
      return out;
    }
    // --- 圣诞 ---
    if (['メリークリスマス！', 'メリークリスマス', 'クリスマス中止', 'クリスマスの中止', 'Merry Christmas'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.christmas);
      return out;
    }
    // --- 情人节 ---
    if (['バレンタインの中止', 'バレンタイン中止', 'チョコ', 'バレンタインチョコ', 'チョコレート', '手作りチョコ', 'chocolate'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.valentine);
      const it = spawnGround(g, 889, 1);
      if (it) { it.f[25] = 3; it.f[27] = 6; it.f[17] = 0; }
      out.items.push({ id: 889, count: 1 });
      return out;
    }

    // --- 隐藏角色 ---
    if (['隠しキャラ', 'secretchar', 'secretcharacter'].indexOf(text) !== -1) {
      // 288169：var_65(250+233) < 1000 → 拒绝
      if ((g.getV65 ? (g.getV65(233) | 0) : 0) < 1000) {
        out.messages.push(MESSAGES.secretDenied); return out;
      }
      if (g.events && g.events.add) g.events.add(38);
      else if (Elona.Event && Elona.Event.add) Elona.Event.add(g, 38);
      out.effects.evadd = 38;
      out.messages.push('…ふふ、呼んでみる？');
      return out;
    }

    // --- 送还（清除里神） ---
    if (['送還', 'repatriation'].indexOf(text) !== -1) {
      out.messages.push(MESSAGES.sendBack);
      const targets = [355, 356, 357, 358, 359, 360, 336, 481, 483];
      for (const c of (g.charas || [])) {
        if (!c || (c.get(0) | 0) !== 1) continue;
        if ((c.get(58) | 0) === 100) continue;
        if (targets.indexOf(c.get(27) | 0) === -1) continue;
        c.set(0, 0);
        out.effects.vanquished = (out.effects.vanquished || 0) + 1;
      }
      if (g.syncCharaCells) g.syncCharaCells();
      return out;
    }

    // --- 技能券 ---
    if (text.indexOf('スキルチケット') !== -1 || text.indexOf('skill ticket') !== -1) {
      spawnGround(g, 1093, 1);
      out.items.push({ id: 1093, count: 1 });
      out.messages.push(T.drop(itemName(1093)));
      return out;
    }

    // --- 技能 / 物品 / 卡片 / 标本（288276-288286，在 label_2724 清洗之前判断）---
    if (text.indexOf('スキル') !== -1 || /skill/i.test(text)) return wishSkill(g, text, out);
    if (text.indexOf('アイテム') !== -1 || /item/i.test(text)) return wishItem(g, text, out);
    if (text.indexOf('カード') !== -1 || /card/i.test(text)) return wishFigure(g, text, out, 504);
    if (text.indexOf('剥製') !== -1 || text.indexOf('はく製') !== -1 || /figure/i.test(text)) {
      return wishFigure(g, text, out, 503);
    }

    // 默认：按物品匹配（源码 label_2730 是 fall-through）
    return wishItem(g, text, out);
  }

  /** 288288-288480：物品许愿 */
  function wishItem(g, textIn, out) {
    const text = sanitize(textIn);           // 288289 gosub *label_2724
    const R = (n) => ((g && g.rng) ? g.rng.rnd(n) : Math.floor(Math.random() * n));
    // 尝试若干次：黑星/禁止物品丢弃后换下一个候选
    let cur = matchItem(g, text);
    let guard = 0;
    while (cur && guard++ < 40) {
      const it = Elona.ItemDB && Elona.ItemDB.create
        ? Elona.ItemDB.create(g, { itemId: cur.id, level: playerLevel(g) + 10, fix: 4 })
        : null;
      if (!it) { cur = null; break; }
      // 288351-288359：黑星（ibit 5）或品质 6 → 丢弃重试
      const blackStar = Elona.ItemDB.ibit ? (Elona.ItemDB.ibit(5, it) | 0) === 1 : false;
      if (blackStar || (it.f[4] | 0) === 6) {
        cur = matchItem(g, text);   // 简化：重新匹配（原版取次高分）
        continue;
      }
      // 288360-288466：各类特例
      let qty = 1;
      if (cur.id === 54) { qty = playerLevel(g) * playerLevel(g) * 50 + 20000; it.f[0] = qty; }
      else if (cur.id === 55) { qty = 8 + R(5); it.f[0] = qty; }
      else if (cur.id === 970) {
        // 神雫石 → 库存切れ，改给奈菲亚之核(969)
        spawnGround(g, 969, 1);
        out.messages.push('うーん。ちょっと今は出ないから、これで我慢して。');
        out.items.push({ id: 969, count: 1 });
        return out;
      } else if (cur.id === 990) {
        spawnGround(g, 244, 3);
        out.messages.push('あ、それ在庫切れ。');
        out.items.push({ id: 244, count: 3 });
        return out;
      } else if (cur.id === 1189 || cur.id === 1190) {
        spawnGround(g, 1187, 1);
        out.messages.push('あ、それ在庫切れ。');
        out.items.push({ id: 1187, count: 1 });
        return out;
      } else if (cur.id >= 1276 && cur.id <= 1279) {
        spawnGround(g, 1280, 1);
        out.messages.push('あ、それ在庫切れ。');
        out.items.push({ id: 1280, count: 1 });
        return out;
      } else if (cur.id === 1024) {
        spawnGround(g, 24, 1);
        out.items.push({ id: 24, count: 1 });
        return out;
      } else if (cur.id === 602) {
        const w = spawnGround(g, 516, 1);
        if (w) { w.f[4] = 3; w.f[17] = 1; }
        out.messages.push('あ、それ在庫切れ。');
        out.items.push({ id: 516, count: 1 });
        return out;
      } else if (cur.id === 1191) {
        const b = spawnGround(g, 563, 1);
        if (b) b.f[17] = 1;
        out.messages.push('あ、それ在庫切れ。');
        out.items.push({ id: 563, count: 1 });
        return out;
      } else {
        // 288440-288465：药水/卷轴类 3+rnd(2)，珍贵品限 1-2
        const row = Elona.ItemDB.data ? Elona.ItemDB.data[String(cur.id)] : null;
        const f5 = row && row.fields ? row.fields[5] : null;
        const cat = Elona.ItemDB.refitem ? (Elona.ItemDB.refitem(cur.id, 5) | 0)
          : (parseInt(f5, 10) || 0);
        if (cat === 52000 || cat === 53000) {
          qty = 3 + R(2);
          if (cur.id === 559) qty = 2 + R(2);
          if (cur.id === 502) qty = 2;
          if (cur.id === 243) qty = 1;
          if (cur.id === 621) qty = 1;
          if (cur.id === 706) qty = 1;
          const value = it.f[1] | 0;
          if (value >= 5000) qty = 3;
          if (value >= 10000) qty = 2;
          if (value >= 20000) qty = 1;
          it.f[0] = qty;
        }
      }
      it.f[5] = g.player.x; it.f[6] = g.player.y;
      const cell = g.map && g.map.cell ? g.map.cell(g.player.x, g.player.y) : null;
      if (cell) cell[4] = 1;
      g.groundItems.push(it);
      if (Elona.ItemDB.identify) Elona.ItemDB.identify(it, 3);
      out.items.push({ id: cur.id, count: it.f[0] | 0 });
      out.messages.push(T.drop(itemName(cur.id)));
      return out;
    }
    out.messages.push(T.nothing);
    return out;
  }

  /** 288481-288555：技能/属性许愿 */
  function wishSkill(g, textIn, out) {
    const text = sanitize(textIn);           // 288482 gosub *label_2724
    const p = g.player;
    const cur = matchSkill(g, text);
    if (!cur) { out.messages.push(T.nothing); return out; }
    const name = cur.name;
    const have = (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(p, cur.id) | 0) : 0;
    if (have === 0) {
      // skillgain 角色, 技能, 等级（31832）
      if (Elona.Stats && Elona.Stats.skillGain) Elona.Stats.skillGain(p, p.index | 0, cur.id, 1, 0, g);
      out.effects.skillLearned = cur.id;
      out.messages.push(MESSAGES.skillLearn(name));
    } else {
      if (Elona.Stats && Elona.Stats.skillMod) Elona.Stats.skillMod(p, cur.id, p.index | 0, 1000, g);
      if (Elona.Stats && Elona.Stats.modGrowth) Elona.Stats.modGrowth(p, cur.id, p.index | 0, 25, g);
      out.effects.skillUp = cur.id;
      out.messages.push(MESSAGES.skillUp(name));
    }
    return out;
  }

  /** 288556-288587：角色卡片(504) / 标本(503) */
  function wishFigure(g, text, out, itemId) {
    const key = fixWish(sanitize(text));     // 288590-288591
    const sp = matchSpecies(g, key);
    const species = sp ? sp.id : 37;             // 288613-288615：找不到用 37
    const it = spawnGround(g, itemId, 1);
    if (it) {
      it.f[23] = species;                        // var_99(23) = var_58(27, 56)
      it.f[22] = 1;                              // var_99(22) 的品质/等级（简化）
    }
    out.items.push({ id: itemId, count: 1, species });
    out.messages.push(T.drop(itemName(itemId)));
    return out;
  }

  Elona.Wish = {
    run, sanitize, fixWish,
    matchItem, matchSkill, matchSpecies,
    MESSAGES, GODS, Q_SPECIES,
    itemName, spawnGround, spawnChara,
  };
})(window);
