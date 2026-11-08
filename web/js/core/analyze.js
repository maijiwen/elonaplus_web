'use strict';
/**
 * 精神分析 —— `*label_2688`（hsp/start.hsp 284578-284960）
 *
 * 【原版行为】
 *   能力 626「精神分析」（318819-318866）：
 *     1. `txt_select "誰を対象にする？"` → `gosub *label_2893`（**邻格箭头**，八方向）
 *     2. `stat == 0`（Esc）或那一格没人 → 「それは無理だ。」
 *     3. 目标在**タッグ**里（`var_58(168) != 0`）→ `txtselecttc 2` 二选一
 *        （「タッグ左側」/「タッグ右側」），选 1 → 换成 `var_58(167)`（搭档）
 *     4. 「あなたはXの心を覗いた。」→ `gosub *label_2688`（本模块）
 *
 *   `*label_2688` 的面板分两节：
 *     ◆ 思考状態 —— 一句「此刻在想什么」，按优先级依次覆盖
 *     ◆ 苦手なもの —— 弱点清单（物理 / 10 种属性 / 6 种状态 / 酸 / 出血 / 陷阱 /
 *                      透明 / 寄生 / 4 个物种弱点）
 *
 * 【字段对应】
 *   var_58(22)   満腹度（≤10000 = 饿）      → c.get(22)
 *   var_58(446)  水分（≤10000 = 渴）        → c.get(446)
 *   var_58(433)  幸福度（0..10）             → c.get(433)
 *   var_58(201)  攻击欲（>0 = 有战意）        → c.get(201)
 *   var_58(18)   攻击风格（0..6）            → c.get(18)
 *   var_58(52/53) SP / SPMAX                → c.get(52) / c.get(53)
 *   var_58(50/51) HP / HPMAX                → c.get(50) / c.get(51)
 *   var_58(186)  痛感（±5 触发濒死台词）      → c.get(186)
 *   var_58(250..269) 异常状态计时             → c.get(250 + n)
 *   var_58(70/71) 防御力 / 追加防御           → c.get(70) / c.get(71)
 *   var_58(27)   物种 id                     → c.get(27)
 *   var_63(2)    种族键名                    → c.raceName
 *   var_65(189)  当前楼层                    → g.getV65(189)
 *   var_82(50..60) 元素抗性潜力              → c.skill(50..60)
 *   cbit(5/7/8/9/10/11/12/13/29)             → Elona.Status.cbit
 *   ibit(1, 装备id-1) 装备的耐酸标记          → Elona.ItemDB.ibit
 *   encfind(c, 48) 寄生 buff                 → Elona.Status.findbuff(c, 48)
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /** 随机数：优先用游戏的 rng（可复现），否则退到 Math.random */
  function R(g, n) {
    const k = Math.max(1, n | 0);
    if (g && g.rng && g.rng.rnd) return g.rng.rnd(k) | 0;
    return Math.floor(Math.random() * k);
  }

  /** 基础念头（284591-284657）：`var_2197 = rnd(17)`，0 = 什么都没想 */
  const THOUGHTS = [
    '什么都没在想。',                 // 0
    '想要更多的刺激。',               // 1
    '在回忆过去的事。',               // 2
    '怀疑自己这样是不是就好。',       // 3
    '什么都不想！——我正在想着这个！', // 4
    '我知道你在窥探我的心！',         // 5
    '希望你能更了解我一些。',         // 6
    '在担心天气。',                   // 7
    '担心家人。',                     // 8
    '无聊得受不了。',                 // 9
    '好像忘了什么……',                // 10
    '眼睛有点痒。',                   // 11
    '为什么差距永远消不掉呢。',       // 12
    '在思考活着的意义。',             // 13
    '无论如何都想要那个……',         // 14
    '想感受爱。',                     // 15
    '刚才那个梦到底是什么呢。',       // 16
  ];

  /** 饥饿（284659-284673） */
  const HUNGRY = [
    '肚子饿得没力气。',
    '不管什么都想塞进嘴里。',
    '想吃一顿饱的。',
    '想吃甜的。',
    '想吃美味的手工料理。',
  ];
  /** 口渴（284675-284686） */
  const THIRSTY = [
    '快渴死了。',
    '想喝点什么。',
    '水分不足，头有点晕。',
    '水……水……',
  ];
  /** 心情好（284688-284696） */
  const HAPPY = [
    '今天也能努力一把。',
    '高兴得不得了。',
    '这样的生活也不坏。',
  ];
  /** 非常幸福（284698-284706） */
  const VERY_HAPPY = [
    '想跟谁炫耀一下。',
    '太幸福了！',
    '活到现在真是太好了。',
  ];
  /** 战意（284708-284726）：按 var_58(18) 的攻击风格 */
  const FIGHT = [
    '绝对不会输。',
    '敌人只要打败就行。',
    '和平时一样做就好。',
    '有点担心打不过。',
    '不可能输。',
    '来堂堂正正地较量吧！',
    '肯定会有办法的。',
  ];
  /** 疲劳（284728-284741） */
  const TIRED = [
    '想休息了。',
    '已经什么都无所谓了。',
    '还有必要再努力下去吗？',
    '所以我才讨厌这样。',
  ];
  /** 濒死（284743-284760） */
  const DYING = [
    '自己可能会死掉。',
    '还不能就这样倒下。',
    '不打算死在这里。',
  ];
  /** 恐惧症（284780-284796） */
  const PHOBIA = [
    '被强迫症缠住了。',
    '恐惧让脑子一片混乱。',
    '正受着过去的创伤折磨。',
    '看见自己被眼前的人杀掉的幻觉。',
    '被自杀的冲动拉扯着。',
  ];

  /** 异常状态计时 → 念头（284762-284779 的覆盖顺序，逐条照抄） */
  const STATUS_THOUGHT = [
    [253, '什么也看不见，心里发慌。'],
    [257, '不知为何挺开心的♪'],
    [268, '得想办法逃出去！'],
    [252, '动不了，好不甘心。'],
    [264, '怒气消不下去！'],
    [254, '脑子里乱成一团。'],
    [256, '好像脑子里蒙了一层雾。'],
    [269, '正在执行命令。'],
    [250, '心情很糟。'],
    [261, '身体不适，难受得很。'],
    [255, '得逃跑了得逃跑了得逃跑了。'],
    [263, '喘不上气！好难受……'],
    [251, '在梦里和羊群玩耍。'],
  ];

  /** 元素抗性技能 id → 弱点名（284830-284878） */
  const ELEM_WEAK = [
    [50, '火焰属性的攻击'],
    [51, '冰霜属性的攻击'],
    [52, '雷电属性的攻击'],
    [53, '黑暗属性的攻击'],
    [54, '精神属性的攻击'],
    [55, '毒素属性的攻击'],
    [56, '地狱属性的攻击'],
    [57, '音波属性的攻击'],
    [58, '神经属性的攻击'],
    [59, '混沌属性的攻击'],
    [60, '魔法属性的攻击'],
  ];

  /** 状态免疫位 → 弱点名（284880-284905） */
  const CBIT_WEAK = [
    [8, '混乱状态'],
    [9, '失明状态'],
    [10, '恐惧状态'],
    [11, '睡眠状态'],
    [12, '麻痹状态'],
    [13, '中毒状态'],
  ];

  /** 物种 → 弱点名（284938-284956） */
  const SPECIES_WEAK = {
    476: '蓬松面包',
    224: '尖叫兽',
    227: '猫',
    786: '鲨鱼',
  };

  const Analyze = {
    /**
     * 「思考状態」—— 一句台词。
     * 覆盖顺序与源码一致（后面的判断覆盖前面的）。
     * @param {object} g 游戏
     * @param {object} c 目标角色
     * @returns {string}
     */
    mentalState(g, c) {
      if (!c) return '';
      let s = THOUGHTS[R(g, 17)] || THOUGHTS[0];

      // 284659：饿
      if ((c.get(22) | 0) <= 10000) {
        const i = R(g, 5);
        s = HUNGRY[i] || HUNGRY[0];
      }
      // 284675：渴
      if ((c.get(446) | 0) <= 10000) {
        const i = R(g, 4);
        s = THIRSTY[i] || THIRSTY[0];
      }
      // 284688：心情好
      if ((c.get(433) | 0) > 0) {
        const i = R(g, 3);
        s = HAPPY[i] || HAPPY[0];
      }
      // 284698：非常幸福
      if ((c.get(433) | 0) === 10) {
        const i = R(g, 3);
        s = VERY_HAPPY[i] || VERY_HAPPY[0];
      }
      // 284708：有战意 → 按攻击风格
      if ((c.get(201) | 0) > 0) {
        const st = c.get(18) | 0;
        if (st >= 0 && st < FIGHT.length) s = FIGHT[st];
      }
      // 284728：疲劳
      if ((c.get(52) | 0) < idiv(c.get(53) | 0, 4)) {
        const i = R(g, 4);
        s = TIRED[i] || TIRED[0];
      }
      // 284743：濒死
      if ((c.get(50) | 0) < idiv(c.get(51) | 0, 4)) {
        const i = R(g, 3);
        s = DYING[i] || DYING[0];
        const pain = c.get(186) | 0;
        if (pain >= 5) s = '好痛好痛，我不想死……';
        else if (pain <= -5) s = '总觉得浑身发麻……';
      }
      // 284762-284779：异常状态计时逐条覆盖
      for (const [field, text] of STATUS_THOUGHT) {
        if ((c.get(field) | 0) > 0) s = text;
      }
      // 284759：恐惧症（多选一）
      if ((c.get(260) | 0) > 0) {
        const i = R(g, 5);
        s = PHOBIA[i] || PHOBIA[0];
      }
      // 284797：看自己的心
      if ((c.index | 0) === 0) s = '窥视自己的心，总觉得怪怪的。';
      return s;
    },

    /**
     * 「苦手なもの」—— 弱点清单。
     * @param {object} g 游戏
     * @param {object} c 目标角色
     * @returns {string[]}
     */
    weakPoints(g, c) {
      const out = [];
      if (!c) return out;

      // 284809：物理攻击 —— 防御力低于当前楼层的基准值
      const floor = g && g.getV65 ? (g.getV65(189) | 0) : 0;
      const base = limit(Math.trunc((floor + 1) * Math.sqrt(floor + 1) / 3) + 20, 1, 1000);
      if (((c.get(70) | 0) + (c.get(71) | 0)) < base) out.push('物理攻击');

      // 284820-284878：10 种元素抗性（var_82(50..60) / 50 < 6）
      for (const [sid, label] of ELEM_WEAK) {
        const v = c.skill ? (c.skill(sid) | 0) : 0;
        if (idiv(v, 50) < 6) out.push(label);
      }

      // 284880-284905：状态免疫位（cbit == 0 = 不免疫 = 弱点）
      const S = Elona.Status;
      for (const [bit, label] of CBIT_WEAK) {
        if (!S || !S.cbit || S.cbit(c, bit) === 0) out.push(label);
      }

      // 284907-284921：身上有酸不耐的装备 → 弱点「酸」
      if (this._hasAcidWeakness(c)) out.push('酸');

      // 284923：出血
      if (!S || !S.cbit || S.cbit(c, 29) !== 1) out.push('出血状态');
      // 284925：陷阱
      if (!S || !S.cbit || S.cbit(c, 5) === 0) out.push('陷阱');
      // 284927：透明
      if (!S || !S.cbit || S.cbit(c, 7) === 0) out.push('隐形敌人');

      // 284929：寄生生物（buff 48）
      const hasParasite = S && S.findbuff ? (S.findbuff(c, 48) >= 0) : false;
      if (!hasParasite) out.push('寄生生物');

      // 284938-284956：物种弱点
      const sp = c.get(27) | 0;
      if (SPECIES_WEAK[sp]) out.push(SPECIES_WEAK[sp]);
      if ((c.raceName || '') === 'snail') out.push('盐');
      return out;
    },

    /**
     * 身上有没有「不耐酸」的装备（284907-284921）。
     * `var_58(100..129)` 是装备槽：`/10000` = 部位类型，`\10000` = 装备 id；
     * `ibit(1, 装备id - 1)` 为 1 表示耐酸。
     */
    _hasAcidWeakness(c) {
      const DB = Elona.ItemDB;
      for (let n = 0; n < 30; n++) {
        const v = c.get(100 + n) | 0;
        if (v === 0) continue;
        const part = idiv(v, 10000);
        if (part === 0) continue;
        const itemId = v % 10000;
        if (itemId <= 0) continue;
        if (!DB || !DB.ibitDef) continue;
        try {
          if ((DB.ibitDef(1, itemId) | 0) === 1) continue;   // 耐酸
        } catch (e) { /* 物品表未加载 */ }
        return true;
      }
      return false;
    },

    /**
     * 组装整个分析面板。
     * @param {object} g 游戏
     * @param {object} c 目标角色
     * @returns {{title:string, mental:string, weak:string[], text:string}}
     */
    panel(g, c) {
      const mental = this.mentalState(g, c);
      const weak = this.weakPoints(g, c);
      const name = (c && c.name) || '对方';
      const lines = ['◆ 思考状态', mental, '', '◆ 弱点'];
      if (!weak.length) lines.push('（没有发现明显的弱点）');
      else for (const w of weak) lines.push('・' + w);
      return {
        title: '精神分析',
        target: c,
        name,
        mental,
        weak,
        text: lines.join('\n'),
      };
    },
  };

  Elona.Analyze = Analyze;
})(window);
