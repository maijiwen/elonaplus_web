'use strict';
/**
 * 种族 / 职业的显示名（中文）与一句话特性说明。
 *
 * 【为什么单独一张表】
 *   race_class.json 是 tools/*.py 从 start.hsp 机械提取的，只有 `jpName`（日文）
 *   与 `csvName`（英文键名）。中文名属于本地化层，放进数据表会被下次重提取覆盖，
 *   所以放在这里，只在显示时使用——`c.raceName` 仍然保存英文键名，
 *   `core/feat.js`、`core/battle.js` 等按 `raceName === 'mutant'` 判定的逻辑不受影响。
 *
 * 【来源】
 *   种族中文名与特性取自中文 wiki「种族」页（elona.huijiwiki.com/wiki/种族）。
 *   特性说明只保留 wiki 中的要点，实际数值以 `race_class.json` 的 ops 为准。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 种族键名（= var_63(2) / csvName）→ 中文名 */
  const RACE = {
    kobolt: '狗头人',
    orc: '兽人',
    largeanimal: '巨兽',
    lizardman: '蜥蜴人',
    minotaur: '牛头人',
    yerles: '耶鲁士人',
    norland: '北地之民',
    eulderna: '艾沃达纳人',
    fairy: '妖精',
    asura: '阿修罗',
    slime: '史莱姆',
    doggod: '犬神',
    dwarf: '丘陵人',
    juere: '朱伊安人',
    zombie: '僵尸',
    elea: '艾莱亚人',
    rabbit: '兔子',
    sheep: '羊',
    frog: '蛙',
    worm: '蠕虫',
    snail: '蜗牛',
    mandrake: '曼德拉草',
    beetle: '昆虫',
    mushroom: '蘑菇',
    bat: '蝙蝠',
    ent: '树人',
    lich: '巫妖',
    bacteria: '菌',
    ghost: '幽灵',
    spirit: '精灵',
    eye: '眼',
    mazin: '魔人',
    wasp: '胡蜂',
    giant: '巨人',
    imp: '恶魔',
    hand: '手',
    snake: '蛇',
    drake: '亚龙',
    goblin: '地精',
    bear: '熊',
    armor: '铠',
    medusa: '美杜莎',
    cupid: '丘比特',
    karune: '卡鲁恩',
    harpy: '哈比女妖',
    dragon: '龙',
    dinosaur: '恐龙',
    beast: '幻兽',
    spider: '蜘蛛',
    golem: '魔像',
    rock: '矿物',
    zanan: '泽纳恩',
    skeleton: '骸骨',
    piece: '棋子',
    cat: '猫',
    dog: '狗',
    roran: '罗兰',
    rat: '老鼠',
    shell: '寄居蟹',
    catgod: '猫神',
    machinegod: '机械神',
    undeadgod: '死灵神',
    machine: '机械',
    wisp: '鬼火',
    bird: '鸟',
    seamonster: '海魔',
    catsister: '人外',
    mutant: '变异人',
    yeek: '小鬼',
    yith: '异星主',
    servant: '神的化身',
    horse: '马',
    god: '神',
    quickling: '快可灵',
    metal: '金属',
    vehicle: '摩托车',
  };

  /** 职业键名（= var_63(3)）→ 中文名 */
  const CLASS = {
    warrior: '战士',
    thief: '盗墓者',
    wizard: '魔法师',
    farmer: '农夫',
    predator: '掠夺者',
    archer: '猎人',
    warmage: '魔法战士',
    tourist: '观光客',
    pianist: '钢琴家',
    gunner: '机工兵',
    priest: '牧师',
    claymore: '大剑士',
  };

  /** 职业一句话说明（创建界面用；原版 desc.en 是一大段英文，太长） */
  const CLASS_DESC = {
    warrior: '精通各类武器与防具，擅长正面作战。',
    thief: '擅长开锁、偷窃与潜行。',
    wizard: '以咏唱与魔力为核心的施法者。',
    farmer: '擅长栽培与料理，体力充沛。',
    predator: '猎杀弱者的战斗专家。',
    archer: '弓术与野外生存的行家。',
    warmage: '兼顾魔法与近战。',
    tourist: '什么都不擅长，但运气不错。',
    pianist: '以演奏为生，感知敏锐。',
    gunner: '精通枪械与机械。',
    priest: '侍奉神明，擅长治愈。',
    claymore: '以双手重剑为主的重装战士。',
  };

  /**
   * 一句话特性（中文 wiki 的要点）。
   * 只用于角色创建界面的说明文字；真正的数值在 race_class.json 的 ops 里。
   */
  const TRAIT = {
    yerles: '升级时额外获得 1 点技能奖励。',
    eulderna: '具有魔法耐性。',
    fairy: '各类耐性出众、闪避高；无法装备重量超过 2s 的物品。',
    dwarf: '具有毒耐性与暗黑耐性。',
    juere: '饱腹度下降更慢；采集点能采集更多素材。',
    elea: '以太病进展更慢；魔力反噬伤害减半。',
    snail: '只有背、远程、弹药三个部位；碰到盐会受到极大伤害。',
    lich: '具有冷气、毒、暗黑耐性；弱火。',
    goblin: '具有暗黑耐性；采集点能采集更多素材。',
    golem: '具有强力毒耐性；不会陷入朦胧状态。',
    mutant: '身体时刻在变化：每 3 级长出一个随机部位。',
  };

  function zh(key) {
    const k = String(key == null ? '' : key);
    return RACE[k] || k;
  }
  function classZh(key) {
    const k = String(key == null ? '' : key);
    return CLASS[k] || k;
  }
  /** 角色 → 中文种族名（没有 raceName 时退回「人」） */
  function of(c) {
    if (!c) return '';
    return RACE[c.raceName] || c.raceName || '人';
  }
  /** 角色 → 中文职业名 */
  function classOf(c) {
    if (!c) return '';
    return CLASS[c.className] || c.className || '';
  }
  function trait(key) { return TRAIT[String(key || '')] || ''; }
  function classDesc(key) { return CLASS_DESC[String(key || '')] || ''; }

  Elona.RaceName = {
    zh, of, trait, classZh, classOf, classDesc,
    RACES: RACE, CLASSES: CLASS, TRAITS: TRAIT,
  };
})(window);
