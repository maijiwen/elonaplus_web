'use strict';
/**
 * 游戏模式（start.hsp 221452-221655 `*label_2274`「モードの選択」）。
 *
 * 【源码】选择结果写 `var_65(250+23)` = `var_65(273)`，注意**显示顺序与取值不同**：
 *   a Essential → 0 / b Loss → 3 / c Overdose → 2
 *   d Natural → 4 / e Abnormal → 1 / f Purge → 5
 * 【已移植】经验倍率（stats.js 937/939/962、32059）、Purge 能力（gauge.js）、
 *   Abnormal 惩罚（itemfx.js 1537）都在读 v65(273)，本模块负责把它设进去并补齐
 *   创建时的初始金钱（221786-221801）、死亡 / 读档限制等尚未接线的部分。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const MODES = [
    {
      key: 'Essential', value: 0, name: 'Essential', zh: '本质',
      desc: [
        '★本质模式是这部作品的核心模式，其他所有游戏模式都以它为基础。',
        '系统上的漏洞会持续被填补、同格要素的差距会被不断缩小，因此平衡变动较多；',
        '推荐给想兼顾角色扮演与一定实益、或者想认真培养角色的人。',
      ],
    },
    {
      key: 'Loss', value: 3, name: 'Loss', zh: '失落',
      desc: [
        '★失落模式是数据丢失风险极高的模式。',
        '一旦死亡便无法东山再起，游戏就此结束，该存档也无法再次读取。',
        '此外，若不按 Esc 或 S 保存后退出，读档时会受到惩罚。',
        '除硬核 Roguelike 玩家外一律不推荐。',
      ],
    },
    {
      key: 'Overdose', value: 2, name: 'Overdose', zh: '过量',
      desc: [
        '★过量模式在本质模式的基础上，大幅提高能力经验、技能经验与魔法经验，',
        '是超低难度模式。默认倍率为 3 倍，在特定地点最高可调整到 30 倍。',
        '适合不想慢慢品味、只想快速通关的人；但容易腻，也无法留下遗传子。',
        '习惯了这个成长速度，恐怕就再也满足不了其他模式了，通关分数为 0。',
      ],
    },
    {
      key: 'Natural', value: 4, name: 'Natural', zh: '自然',
      desc: [
        '★自然模式基本与本质模式相同，',
        '但若不用 Esc 或 S 保存后退出，读档时会受到惩罚。',
        '除此以外与本质模式没有任何区别。',
        '推荐给能坦然接受坏结果、不重来的人，以及想要适度难度的人。',
      ],
    },
    {
      key: 'Abnormal', value: 1, name: 'Abnormal', zh: '异常',
      desc: [
        '★异常模式会加重死亡惩罚、限制存读档，并增加各种危险要素。',
        '推荐给享受踏实积累与谨慎游玩的人，或者连失去珍贵物品的刺激与打击',
        '都能乐在其中的人。没有什么特别的好处，但通关分数为 20 倍。',
        '若不按 Esc 或 S 保存后退出，读档时同样有惩罚。',
      ],
    },
    {
      key: 'Purge', value: 5, name: 'Purge', zh: '肃清',
      desc: [
        '★肃清模式是脱离了平衡调整的游戏模式，无法留下遗传子，分数为 0。',
        '认为「反复重刷直到出好结果才叫有趣」「游戏就该轻松到挂机自动满级」的人，',
        '认为「平衡破坏者让其他要素变成垃圾也不该修」「强敌死斗毫无乐趣，',
        '零压力碾压才是至高」的人，请务必选择这个模式；',
        '想享受游戏平衡的人，请不要选它。',
      ],
    },
  ];

  function byValue(v) { return MODES.find(m => m.value === (v | 0)) || MODES[0]; }
  function byIndex(i) { return MODES[Math.max(0, Math.min(MODES.length - 1, i | 0))]; }
  function get(g) {
    return (g && g.getV65) ? byValue(g.getV65(273) | 0) : MODES[0];
  }
  function set(g, indexOrValue, byIdx) {
    if (!g || !g.setV65) return MODES[0];
    const m = byIdx === false ? byValue(indexOrValue) : byIndex(indexOrValue);
    g.setV65(273, m.value);
    return m;
  }

  /** 221786-221801：新游戏初始金币（var_58(30)），按模式取值 */
  function startingGold(g) {
    const m = get(g), rng = (g && g.rng) || Elona.rng;
    switch (m.value) {
      case 1: return 100;                       // Abnormal
      case 2: return 20000;                    // Overdose
      case 3: return 400 + rng.rnd(201);       // Loss
      case 5: return 20000;                    // Purge
      default: return 3000 + rng.rnd(501);     // Essential / Natural
    }
  }

  /** 221801-221820：Purge 额外给 10000 技能点与能力点 */
  function applyStart(g, p) {
    if (!g || !p) return null;
    const m = get(g);
    // 金币已由 game.giveStartingItems 按 startingGold() 设置，这里只补 Purge 的点数
    if (m.value === 5) {
      if (p.set) { p.set(41, 10000); p.set(42, 10000); }
      if (g.setV65) {
        g.setV65(660, 10000);   // 250 + 410
        g.setV65(310, 10000);   // 250 + 60
        g.setV65(311, 10000);   // 250 + 61
      }
    }
    return m;
  }

  /** 201186：Loss 模式玩家死亡 → 存档作废（var_65(196)=4） */
  function onPlayerDeath(g) {
    if (!g || !g.setV65) return null;
    if (get(g).value !== 3) return null;
    g.setV65(196, 4);      // *label_2879 里据此删除存档
    return { mode: 'Loss', deleteSave: true };
  }

  /** 读档惩罚（Loss / Natural / Abnormal）：未正常保存退出时触发 */
  function loadPenalty(g, savedProperly) {
    if (!g || savedProperly) return null;
    const m = get(g);
    if (m.value !== 3 && m.value !== 4 && m.value !== 1) return null;
    return { mode: m.key, penalty: true };
  }

  Elona.GameMode = {
    MODES, byValue, byIndex, get, set, startingGold, applyStart,
    onPlayerDeath, loadPenalty,
    V_MODE: 273,
  };
})(window);
