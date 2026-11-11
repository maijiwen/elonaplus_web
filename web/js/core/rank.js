'use strict';
/**
 * 称号 / 排名（ranktitle）—— var_66 称号表与位次计算。
 *
 * 【源码定位】
 *   ranktitle（319-333）
 *     var_64 = var_65(prm_273 + 120) / 100      ← 位次 = 该类别评分 / 100
 *     == 1        → var_66(0, cat)   第 1 名
 *     <= 5        → var_66(1, cat)
 *     <= 10       → var_66(2, cat)
 *     <= 80       → var_66(var_64 / 15 + 3, cat)
 *     否则        → var_66(9, cat)
 *   var_66 称号表（336-356）：`sdim var_66, 30, 11, 9`
 *     每类 11 项：0..9 = 十档称号，10 = 类别总称
 *     类别：0 アリーナ / 1 ペット / 2 ネフィア / 3 博物館 / 4 ホーム /
 *           5 店 / 6 コミュニティ / 8 ギルド
 *   cnvrank（215-234）：英文序数后缀（1st / 2nd / 3rd / th）
 *   博物馆的位次变动提示（235738-235750）：「ランク変動(… 12位 → 15位)《…》」
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  /** 类别 id → var_65(类别 + 120) 的评分槽 */
  const CAT_SLOT = { 0: 120, 1: 121, 2: 122, 3: 123, 4: 124, 5: 125, 6: 126, 8: 128 };

  /** 类别 id → 名称 */
  const CAT_NAME = {
    0: { jp: 'アリーナ', en: 'Arena', ch: '竞技场' },
    1: { jp: 'ペットアリーナ', en: 'Pet Arena', ch: '宠物竞技场' },
    2: { jp: 'クローラー', en: 'Crawler', ch: '探索者' },
    3: { jp: '博物館', en: 'Museum', ch: '博物馆' },
    4: { jp: 'ホーム', en: 'Home', ch: '家' },
    5: { jp: '店', en: 'Shop', ch: '店' },
    6: { jp: 'コミュニティ', en: 'Community', ch: '社区' },
    8: { jp: 'ギルド', en: 'Guild', ch: '公会' },
  };

  /** var_66 称号表：类别 → 10 档 + 类别名（0..9 档，第 10 项为类别名） */
  const TITLES = {
    0: {
      jp: ['アリーナのチャンピオン', 'アリーナの超エリート闘士', 'アリーナのスター闘士', 'アリーナのエリート闘士',
        'アリーナの熟練闘士', 'アリーナの中堅闘士', 'アリーナの期待の星', 'アリーナのダークホース',
        'アリーナの下級闘士', 'アリーナの無名の闘士', 'アリーナ'],
      en: ['Arena champion', 'Super elite gladiator', 'Star gladiator', 'Elite gladiator',
        'Veteran gladiator', 'Popular gladiator', 'New hope', 'Darkhorse',
        'Low class fighter', 'Unknown fighter', 'Arena'],
      ch: ['竞技场冠军', '竞技场超精英斗士', '竞技场明星斗士', '竞技场精英斗士', '竞技场熟练斗士', '竞技场中坚斗士', '竞技场希望之星', '竞技场黑马', '竞技场下级斗士', '竞技场无名斗士', '竞技场'],
    },
    1: {
      jp: ['全てのペットの王', '超エリートペット使い', 'ペットの王子', 'ペットの憧れの的', 'ペット使いのエリート',
        '名の知れたペット使い', 'ペットの母', 'なかなかのペット使い', '駆け出しのペット使い', '無名のペット使い', 'ペットアリーナ'],
      en: ['King of tamer', 'Super elite tamer', 'Prince of animals', 'Chief of animals', 'Elite tamer',
        'Notorious tamer', 'New hope', 'Average tamer', 'Petty tamer', 'Unknown tamer', 'Pet Arena'],
      ch: ['所有宠物之王', '超精英驯宠师', '宠物王子', '宠物憧憬的对象', '驯宠师中的精英', '知名的驯宠师', '宠物之母', '相当不错的驯宠师', '初出茅庐的驯宠师', '无名的驯宠师', '宠物竞技场'],
    },
    2: {
      jp: ['ネフィアを統べる者', '迷宮の覇者', 'ダンジョンの主', '高名な探検者', '子供達の憧れの的',
        'ダンジョン案内人', '名の知れた遺跡荒らし', '探検者', 'ちんけな遺跡荒らし', '観光客', 'クローラー'],
      en: ['King of Nefia', 'Champion of labyrinth', 'Dungeon master', 'Famous adventurer', "Children's star",
        'Guide of Nefia', 'Notorious tomb robber', 'Tomb robber', 'Famous tourist', 'Tourist', 'Crawler'],
      ch: ['统御奈菲亚者', '迷宫霸者', '地城之主', '著名探险者', '孩子们的憧憬', '迷宫向导', '知名的遗迹掠夺者', '探险者', '蹩脚的遗迹掠夺者', '观光客', '探索者'],
    },
    3: {
      jp: ['ティリス最大の博物館', '超有名な博物館', '大人気の博物館', '有名な博物館', '来客の絶えない博物館',
        'ちょっと人気のある博物館', '名の知れた博物館', 'まあまあの博物館', '来客の少ない博物館', '無名の博物館', '博物館'],
      en: ["Tyris' greatest museum", 'Royal museum', 'Great museum', 'Top museum', 'Great museum',
        'Good museum', 'Average museum', 'Small museum', 'Unknown museum', 'Unknown Ruin', 'Museum'],
      ch: ['泰利斯最大的博物馆', '超有名的博物馆', '大人气的博物馆', '有名的博物馆', '来客不断的博物馆', '小有人气的博物馆', '知名的博物馆', '还算可以的博物馆', '来客稀少的博物馆', '无名的博物馆', '博物馆'],
    },
    4: {
      jp: ['イルヴァの楽園', '超セレブな家', '世界有数の家', 'とても住みたくなる家', '主婦の憧れの家',
        'ちょっと人目をひく家', 'まあまあの家', '少しみすぼらしい家', '貧困にあえぐ家', '乞食の家', 'ホーム'],
      en: ['Heaven of Tyris', 'Royal mansion', 'Celebrity mansion', 'Dream mansion', 'Cozy mansion',
        'Attractive house', 'Average house', 'Poor house', "Peasant's shack", "Beggar's shack", 'Home'],
      ch: ['伊尔瓦的乐园', '超名流的家', '世界屈指可数的家', '让人非常想住的家', '主妇憧憬的家', '有点引人注目的家', '还算可以的家', '略显寒酸的家', '在贫困中挣扎的家', '乞丐的家', '家'],
    },
    5: {
      jp: ['イルヴァ最大の店', '王様が来る店', '大繁盛している店', 'セレブが来る店', '来客の絶えない店',
        'マダムの来る店', 'リピーターのいる店', '人が増えてきた売店', 'ほとんど売れない売店', '無名の売店', '店'],
      en: ["Tyris' greatest mall", 'Royal mall', 'Prosperous mall', 'Celebrity shop', 'Prosperous shop',
        'Popular shop', 'Average shop', 'Small shop', 'Souvenir shop ', 'Unknown shop', 'Shop'],
      ch: ['伊尔瓦最大的店', '国王会光顾的店', '大繁盛的店', '名流会光顾的店', '来客不断的店', '贵妇会光顾的店', '有回头客的店', '人渐渐多起来的摊位', '几乎卖不动的摊位', '无名的摊位', '店'],
    },
    6: {
      jp: ['ボス', '王様のアドバイザー', 'エリートコンサルター', 'ご意見番', '有権者の鑑',
        'マダム好みの有権者', '名の知れた有権者', '普通の有権者', '無関心な有権者', 'ぎりぎり有権者', 'コミュニティ'],
      en: ['Boss', "King's advisor", 'Elite consultant', 'Famous consultant', 'Model voter',
        'Nice voter', 'Infamous voter', 'Average voter', 'Indifferent voter', 'Almost voter', 'Community'],
      ch: ['老大', '国王的顾问', '精英顾问', '意见领袖', '选民的榜样', '贵妇中意的选民', '知名的选民', '普通的选民', '漠不关心的选民', '勉强的选民', '社区'],
    },
    8: {
      jp: ['次代ギルドマスター', 'ギルドマスターの右腕', 'ギルドの重役', 'ギルドの重役候補', 'アダプト',
        'エキスパート', 'ジャーニーマン', 'ギルドの正式メンバー', 'ギルドのメンバー候補', '見習い', 'ギルド'],
      en: ['Next master', 'Master', 'Adept', 'Expert', 'Journeyman', 'Senior', 'Apprentice',
        'Official member', 'Candidate', 'Thug', 'Guild'],
      ch: ['下任公会大师', '公会大师的左右手', '公会要职', '公会要职候补', '熟练者', '专家', '熟练工', '公会正式成员', '公会成员候补', '见习', '公会'],
    },
  };

  /** 位次（var_64 = 评分 / 100） */
  function position(g, cat) {
    const slot = CAT_SLOT[cat];
    if (slot === undefined || !g || !g.getV65) return 0;
    return idiv(g.getV65(slot) | 0, 100);
  }

  /**
   * 称号 —— ranktitle（319-333）。
   * @param {object} g
   * @param {number} cat 类别 id
   * @param {string} [lang] 'jp' | 'en'
   */
  function title(g, cat, lang) {
    const t = TITLES[cat];
    if (!t) return '';
    const list = (lang === 'en') ? t.en : ((lang === 'ch' && t.ch) ? t.ch : t.jp);
    const pos = position(g, cat);
    let idx;
    if (pos === 1) idx = 0;
    else if (pos <= 5) idx = 1;
    else if (pos <= 10) idx = 2;
    else if (pos <= 80) idx = idiv(pos, 15) + 3;
    else idx = 9;
    if (idx > 9) idx = 9;
    return list[idx] || '';
  }

  /** 类别总称（var_66(10, cat)） */
  function categoryName(cat, lang) {
    const c = CAT_NAME[cat];
    if (!c) return '';
    return (lang === 'en') ? c.en : ((lang === 'ch' && c.ch) ? c.ch : c.jp);
  }

  /** cnvrank（215-234）：英文序数 */
  function ordinal(n, lang) {
    if (lang === 'jp') return String(n);
    const v = n | 0;
    if (v % 10 === 1 && v !== 11) return v + 'st';
    if (v % 10 === 2 && v !== 12) return v + 'nd';
    if (v % 10 === 3 && v !== 13) return v + 'rd';
    return v + 'th';
  }

  /**
   * 位次变动提示（235738-235750）。
   * @param {number} before 变动前评分
   * @param {number} after 变动后评分
   */
  function changeText(before, after, cat, lang) {
    const p0 = idiv(before | 0, 100);
    const p1 = idiv(after | 0, 100);
    const t = title({ getV65: () => (after | 0) }, cat, lang);
    const name = categoryName(cat, lang);
    if (lang === 'en') {
      return `Museum Rank:${ordinal(p0, 'en')}->${ordinal(p1, 'en')} Your museum is now known as <${t}>.`;
    }
    return `ランク変動(${name} ${p0}位 → ${p1}位 )《${t}》`;
  }

  /** 每类排名的「上榜有效天数」常量（var_67，357-362） */
  const RANK_DAYS = { 0: 20, 1: 60, 2: 45, 6: 30 };

  /**
   * `modrank`（31760-31810）—— 排名评分增减。
   *
   * 评分越低位次越前（100 = 第 1 名，10000 = 第 100 名）。正向增量会按
   * `(位次 + 20)² / 2500` 放大（越靠前越难涨），并受 `cap` 限制（单位：位次）。
   *
   * @param {object} g
   * @param {number} cat    类别（0 アリーナ / 1 ペット / 2 ネフィア / 3 博物館 / 4 ホーム / 5 店 / 6 コミュニティ / 8 ギルド）
   * @param {number} delta  正 = 提升排名（评分减少），负 = 下降
   * @param {number} [cap]  单次提升的位次上限（0/省略 = 不限）
   * @returns {{before:number, after:number, delta:number, changed:boolean, text:string}}
   */
  function modRank(g, cat, delta, cap) {
    const slot = CAT_SLOT[cat | 0];
    const empty = { before: 0, after: 0, delta: 0, changed: false, text: '' };
    if (slot === undefined || !g || !g.getV65 || !g.setV65) return empty;

    const before = g.getV65(slot) | 0;
    let d = delta | 0;
    if (d > 0) {
      const lv = idiv(before, 100);                       // 当前位次
      d = idiv(d * (lv + 20) * (lv + 20), 2500);          // 31766
      // 31767：记下上榜有效天数
      const days = RANK_DAYS[cat | 0];
      if (days !== undefined) g.setV65(140 + (cat | 0), days);
      if (before === 100) {                               // 31768：已是第一名
        return { before, after: before, delta: 0, changed: false, text: '' };
      }
      if (cap && idiv(d, 100) > (cap | 0)) d = (cap | 0) * 100;   // 31771-31775
    }
    let after = before - d;                               // 31777
    if (after >= 10000) after = 10000;                    // 31778
    if (after < 100) after = 100;                         // 31781
    g.setV65(slot, after);

    const changed = idiv(before, 100) !== idiv(after, 100);
    return {
      before, after, delta: after - before, changed,
      text: changed ? changeText(before, after, cat | 0, 'jp') : '',
    };
  }

  Elona.Rank = {
    CAT_SLOT, CAT_NAME, TITLES, RANK_DAYS,
    position, title, categoryName, ordinal, changeText, modRank,
  };
})(window);
