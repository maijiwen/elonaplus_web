'use strict';
/**
 * AP（Awakening Points / 覚醒点）系统 —— ElonaPlus 2.33R 追加系统
 *
 * 源码依据：
 *   - 获得：start.hsp 196722-196800（dmghp 击杀结算里 `repeat 16` 的 AP 段）
 *   - 天赋表/花费：410400-411925（NPC「力の覚醒」菜单 + *label_3047 结算）
 *   - 觉醒天赋的战斗效果：212192(暴击抗性) / 213083(意地回避) / 199004(底力) / 199071(障壁) / 347265(魅惑)
 *
 * 角色字段（var_58）：
 *   25  品质（1..4，4 = 《名前》精英）
 *   41  技能点（skill bonus，上限 100 可通过 AP 兑换）
 *   159 AP 累计获得量（用于难度惩罚递增）
 *   160 初始战力快照 = limit(Str,50,200)*2 + limit(Con,50,200)/2
 *   173 当前 AP（上限 2000）
 *   198 八维和快照
 *   199 初始速度快照
 *   207 移动確率（0..100，AI 每回合移动概率）
 *   208 適正距離（1..10，AI 保持的距离）
 *
 * 觉醒天赋用 cbit 表示（status.js 的位标志，字段 450+）：
 *   993  罵倒   994 魔力の集積  995 タクティカルヒール  996 空間歪曲
 *   997  タクティカルアタック  998 タクティカルアーツ  999 チャージ
 *   1000 近接好  1001 遠隔好  1016 矢系魔法好
 *   1002 魅惑  1003 意地  1004 底力  1005 障壁
 *   1006 挑発  1007 タクティカルカース  1008 可変放射  1009 範囲魔法可変術式
 *   1013 零の間撃  1014 タクティカルスロー
 *   1046 魔法封印  1047 技能封印
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => Math.trunc(a / b);
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const AP_MAX = 2000;

  /** 八维和（sorg 10..17） */
  function attrSum(c) {
    let s = 0;
    for (let i = 10; i <= 17; i++) s += sorg(c, i);
    return s;
  }
  function sorg(c, id) {
    if (Elona.Stats && Elona.Stats.sorg) return Elona.Stats.sorg(c, id) | 0;
    if (c && typeof c.skill === 'function') return c.skill(id) | 0;
    return 0;
  }
  function speedOf(c) { return sorg(c, 18); }

  /** 懒快照（196727-196742）：198/199/160 为 0 时按当前值写入 */
  function snapshot(c) {
    if ((c.get(198) | 0) === 0) c.set(198, attrSum(c));
    if ((c.get(199) | 0) === 0) c.set(199, speedOf(c));
    if ((c.get(160) | 0) === 0) {
      c.set(160, limit(sorg(c, 2), 50, 200) * 2 + idiv(limit(sorg(c, 3), 50, 200), 2));
    }
  }
  function ensureInit(c) {
    if ((c.get(207) | 0) === 0 && (c.get(208) | 0) === 0) {
      // 302797-302798 的默认：移动率 50、适正距离 1（此处与 AI 一致）
      c.set(207, 50);
      c.set(208, 1);
    }
    if ((c.get(208) | 0) < 1) c.set(208, 1);
  }

  // ---------------------------------------------------------------- 获得
  // 【已确认】AP 的击杀获得逻辑早在 0 阶段就随 check_talk 一起移植到
  // core/killreward.js 的 checkTalk()（196722-196800 段），此处不再重复实现。
  // 需要触发时请调用 Elona.KillReward.checkTalk(g, killer, victim)。

  // ---------------------------------------------------------------- 天赋表

  /**
   * 「魔法や技能の会得」13 项（410530-410570 → 4116xx 的 var_1799 映射）
   * cost 来自菜单文本，cbit 来自 *label_3047 的 var_2676 → var_1799 表。
   */
  const LEARN = [
    { key: 'insult', cbit: 993, cost: 100, jp: '罵倒', en: 'Insult', desc: '口汚く罵り敵を動揺させる' },
    { key: 'crystal', cbit: 994, cost: 600, jp: '魔力の集積', en: 'Crystal Spear', desc: '魔力を結晶化して撃ち出す' },
    { key: 'dimension', cbit: 996, cost: 100, jp: '空間歪曲', en: 'Dimensional Move', desc: '空間を歪めて移動する' },
    { key: 'provoke', cbit: 1006, cost: 200, jp: '挑発', en: 'Provoke', desc: '敵を挑発し標的を自分に向けさせる' },
    { key: 'charge', cbit: 999, cost: 1000, jp: 'チャージ', en: 'Charge Attack', desc: '力を溜めて突進する' },
    { key: 'tac_arts', cbit: 998, cost: 600, jp: 'タクティカルアーツ', en: 'Tactical Martial Arts', desc: '戦術的な連撃' },
    { key: 'tac_attack', cbit: 997, cost: 400, jp: 'タクティカルアタック', en: 'Tactical Attack', desc: '戦術的な一撃' },
    { key: 'tac_heal', cbit: 995, cost: 500, jp: 'タクティカルヒール', en: 'Tactical Heal', desc: '戦術的な回復' },
    { key: 'tac_curse', cbit: 1007, cost: 500, jp: 'タクティカルカース', en: 'Tactical Curse', desc: '戦術的な呪い' },
    { key: 'tac_throw', cbit: 1014, cost: 500, jp: 'タクティカルスロー', en: 'Tactical Throw', desc: '戦術的な投擲' },
    { key: 'zero_shoot', cbit: 1013, cost: 500, jp: '零の間撃', en: 'Zero shoot', desc: '間隙を撃ち抜く' },
    { key: 'var_breath', cbit: 1008, cost: 400, jp: '可変放射', en: 'Variable Breath', desc: '属性を変えて放射する' },
    { key: 'var_storm', cbit: 1009, cost: 800, jp: '範囲魔法可変術式', en: 'Variable Storm', desc: '範囲魔法の術式を組み替える' },
  ];

  /**
   * 「フィート取得」4 项（410490-410505 → 4117xx）
   * 上限：同时最多 2 个（4118xx 的 var_2293 >= 2 分支）
   */
  const FEATS = [
    { key: 'charm', cbit: 1002, cost: 1500, jp: '魅惑', en: 'Charm', desc: '直接攻撃してきた敵が朦朧' },
    { key: 'guts', cbit: 1003, cost: 1800, jp: '意地', en: 'Obstinate', desc: 'HP減るほど回避・軽減率上昇' },
    { key: 'brave', cbit: 1004, cost: 1500, jp: '底力', en: 'Brave', desc: 'HP減るほど最終与ダメージ上昇' },
    { key: 'barrier', cbit: 1005, cost: 2000, jp: '障壁', en: 'Barrier', desc: 'ダメージ分MP消費し攻撃無効化' },
  ];
  const FEAT_LIMIT = 2;

  /** 「戦闘スタイル変更・品質上昇」9 项（410625-410712 → 411711-411790） */
  const STYLES = [
    { key: 'melee_freq', op: 'cbit', bit: 1000, cost: 30, jp: '近接攻撃頻度増加', en: 'Increased frequency of melee attack' },
    { key: 'ranged_freq', op: 'cbit', bit: 1001, cost: 30, jp: '遠隔攻撃頻度増加', en: 'Increased frequency of ranged attack' },
    { key: 'dart_spell', op: 'cbit', bit: 1016, cost: 200, jp: '物理攻撃矢魔法化', en: 'Use dart spell instead of regular attack' },
    { key: 'dist_up', op: 'dist+', cost: 10, jp: '適正距離＋1', en: 'Preferred distance +1' },
    { key: 'dist_down', op: 'dist-', cost: 10, jp: '適正距離−1', en: 'Preferred distance -1' },
    { key: 'move_up', op: 'move+', cost: 5, jp: '移動確率＋10％', en: 'Movement probability +10%' },
    { key: 'move_down', op: 'move-', cost: 5, jp: '移動確率−10％', en: 'Movement probability -10%' },
    { key: 'spell_seal', op: 'cbit', bit: 1046, cost: 20, jp: '魔法の使用封印/解除', en: 'Allow/disallow spell usage' },
    { key: 'ability_seal', op: 'cbit', bit: 1047, cost: 20, jp: '技能の使用封印/解除', en: 'Allow/disallow ability usage' },
    { key: 'quality', op: 'quality', cost: 1000, jp: 'キャラ品質上昇', en: 'Increase character quality' },
  ];

  // ---------------------------------------------------------------- 花费计算

  /** 速度上昇的花费（411515-411517）：初始速度 + 100 */
  function speedCost(c) { ensureInit(c); return (c.get(199) | 0) + 100; }
  /** 生命力上昇的花费（411518-411529）：初始战力 + 300（+ 体型/种族加成） */
  function lifeCost(c) {
    ensureInit(c);
    let v = (c.get(160) | 0) + 300;
    if (Elona.Status && Elona.Status.cbit) {
      if (Elona.Status.cbit(c, 33)) v += 300;
      if (Elona.Status.cbit(c, 26)) v += 500;
      if (Elona.Status.cbit(c, 28)) v += 800;
    }
    return v;
  }
  const SKILL_BONUS_COST = 500;      // → var_58(41) += 100
  const SKILL_BONUS_GAIN = 100;

  /** 上限检查（411576 / 411648）：速度 500（难度<350）/ 800；生命力 sorg(2) < 300 */
  function speedCapped(g, c) {
    const diff = g && g.getV65 ? (g.getV65(2) | 0) : 0;      // var_65(250+2) 难度/进度
    const sp = speedOf(c);
    if (sp > 500 && diff < 350) return true;
    if (sp > 800 && diff >= 350 && diff < 1000) return true;
    return false;
  }
  function lifeCapped(c) { return sorg(c, 2) >= 300; }

  // ---------------------------------------------------------------- 列表 / 学习

  function has(c, bit) {
    return !!(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, bit));
  }
  function featsOwned(c) { return FEATS.filter((f) => has(c, f.cbit)).length; }

  /**
   * 生成「力の覚醒」菜单数据。
   * @param {object} g
   * @param {object} c 目标角色
   * @returns {{ap:number, groups:Array}}
   */
  function menu(g, c) {
    ensureInit(c);
    snapshot(c);
    const ap = c.get(173) | 0;
    const groups = [];

    groups.push({
      id: 'grow', title: '能力を伸ばす', items: [
        { key: 'speed', kind: 'speed', label: '速度上昇', cost: speedCost(c), ap,
          note: `速度 +30（現在 ${speedOf(c)}）`,
          disabled: ap < speedCost(c) || speedCapped(g, c),
          reason: speedCapped(g, c) ? 'これ以上は上がらない' : (ap < speedCost(c) ? 'AP不足' : '') },
        { key: 'life', kind: 'life', label: '生命力上昇', cost: lifeCost(c), ap,
          note: `生命力 +10（現在 ${sorg(c, 2)}）`,
          disabled: ap < lifeCost(c) || lifeCapped(c),
          reason: lifeCapped(c) ? 'これ以上は上がらない' : (ap < lifeCost(c) ? 'AP不足' : '') },
        { key: 'bonus', kind: 'bonus', label: 'スキルボーナスの獲得', cost: SKILL_BONUS_COST, ap,
          note: `スキルボーナス +${SKILL_BONUS_GAIN}（現在 ${c.get(41) | 0}）`,
          disabled: ap < SKILL_BONUS_COST || (c.get(41) | 0) >= 100,
          reason: (c.get(41) | 0) >= 100 ? 'ボーナスが100以上のため獲得できない' : (ap < SKILL_BONUS_COST ? 'AP不足' : '') },
      ],
    });

    groups.push({
      id: 'feat', title: 'フィート取得', items: FEATS.map((f) => ({
        key: f.key, kind: 'cbit', bit: f.cbit, cost: f.cost, ap,
        label: f.jp, en: f.en, note: f.desc,
        owned: has(c, f.cbit),
        disabled: !has(c, f.cbit) && (ap < f.cost || featsOwned(c) >= FEAT_LIMIT),
        reason: has(c, f.cbit) ? '習得済み（選択でAPに還元）'
          : (featsOwned(c) >= FEAT_LIMIT ? 'これ以上取得できない（要還元）'
            : (ap < f.cost ? 'AP不足' : '')),
      })),
    });

    groups.push({
      id: 'learn', title: '魔法や技能の会得', items: LEARN.map((s) => ({
        key: s.key, kind: 'cbit', bit: s.cbit, cost: s.cost, ap,
        label: s.jp, en: s.en, note: s.desc, owned: has(c, s.cbit),
        disabled: !has(c, s.cbit) && ap < s.cost,
        reason: has(c, s.cbit) ? '習得済み（選択でAPに還元）' : (ap < s.cost ? 'AP不足' : ''),
      })),
    });

    groups.push({
      id: 'style', title: '戦闘スタイル／品質', items: STYLES.map((s) => {
        const it = { key: s.key, kind: s.op === 'cbit' ? 'cbit' : s.op, cost: s.cost, ap,
          label: s.jp, en: s.en };
        if (s.op === 'cbit') {
          it.bit = s.bit;
          it.owned = has(c, s.bit);
          it.note = s.bit === 1046 ? '魔法の使用を封じる／解除する'
            : (s.bit === 1047 ? '技能の使用を封じる／解除する'
              : (it.owned ? '現在: 有効' : '現在: 無効'));
        } else if (s.op === 'dist+') { it.note = `適正距離 ${c.get(208) | 0} → ${limit((c.get(208) | 0) + 1, 1, 10)}`; }
        else if (s.op === 'dist-') { it.note = `適正距離 ${c.get(208) | 0} → ${limit((c.get(208) | 0) - 1, 1, 10)}`; }
        else if (s.op === 'move+') { it.note = `移動確率 ${c.get(207) | 0}% → ${limit((c.get(207) | 0) + 10, 0, 100)}%`; }
        else if (s.op === 'move-') { it.note = `移動確率 ${c.get(207) | 0}% → ${limit((c.get(207) | 0) - 10, 0, 100)}%`; }
        else if (s.op === 'quality') { it.note = `品質 ${c.get(25) | 0}${(c.get(25) | 0) >= 4 ? '（上限）' : ' → 4'}`; }
        it.disabled = ap < s.cost || (s.op === 'quality' && (c.get(25) | 0) >= 4);
        it.reason = (s.op === 'quality' && (c.get(25) | 0) >= 4) ? '品質は既に最大' : (ap < s.cost ? 'AP不足' : '');
        return it;
      }),
    });

    return { ap, groups };
  }

  /**
   * 执行一次消费。对应 *label_3047。
   * @param {object} g
   * @param {object} c 目标
   * @param {{kind:string, bit?:number, cost:number}} item menu() 返回的条目
   * @returns {{ok:boolean, message:string, refund?:number}}
   */
  function spend(g, c, item) {
    if (!c || !item) return { ok: false, message: 'それは無理だ。' };
    ensureInit(c);
    snapshot(c);
    const ap = c.get(173) | 0;
    const cost = item.cost | 0;

    // ---- cbit 类：已拥有 → 退还（4116xx / 4118xx）----
    if (item.kind === 'cbit') {
      const bit = item.bit | 0;
      if (has(c, bit)) {
        if (Elona.Status) Elona.Status.cbitmod(c, bit, 0);
        c.set(173, ap + cost);
        return { ok: true, refund: cost, message: `${nameOf(c)}は力の使い方を忘れた。（AP +${cost}）` };
      }
      // フィート上限检查
      if (FEATS.some((f) => f.cbit === bit) && featsOwned(c) >= FEAT_LIMIT) {
        return { ok: false, message: 'これ以上のフィートの獲得は不可能だ。既に身についているフィートを選んでAPに還元しろ。' };
      }
      if (ap < cost) return { ok: false, message: 'APが足りない。' };
      if (Elona.Status) Elona.Status.cbitmod(c, bit, 1);
      c.set(173, ap - cost);
      const isFeat = FEATS.some((f) => f.cbit === bit);
      return { ok: true, message: isFeat ? `${nameOf(c)}は新たなフィートを取得した。`
        : `${nameOf(c)}は新たな力に目覚めた。` };
    }

    // ---- 速度 ----
    if (item.kind === 'speed') {
      if (speedCapped(g, c)) return { ok: false, message: 'これ以上は上がらない。' };
      if (ap < cost) return { ok: false, message: 'APが足りない。' };
      c.set(173, ap - cost);
      if (Elona.Stats && Elona.Stats.skillMod) Elona.Stats.skillMod(c, 18, c.index | 0, 30000, g);
      else c.setSkill(18, sorg(c, 18) + 30);
      return { ok: true, message: 'そらよ！（速度 +30）' };
    }

    // ---- 生命力 ----
    if (item.kind === 'life') {
      if (lifeCapped(c)) return { ok: false, message: 'これ以上は上がらない。' };
      if (ap < cost) return { ok: false, message: 'APが足りない。' };
      c.set(173, ap - cost);
      if (Elona.Stats && Elona.Stats.skillMod) Elona.Stats.skillMod(c, 2, c.index | 0, 10000, g);
      else c.setSkill(2, sorg(c, 2) + 10);
      return { ok: true, message: 'そらよ！（生命力 +10）' };
    }

    // ---- 技能点 ----
    if (item.kind === 'bonus') {
      if ((c.get(41) | 0) >= 100) return { ok: false, message: 'スキルボーナスが100以上あると新たに獲得できない。' };
      if (ap < cost) return { ok: false, message: 'APが足りない。' };
      c.set(173, ap - cost);
      c.set(41, (c.get(41) | 0) + SKILL_BONUS_GAIN);
      return { ok: true, message: `そらよ！（スキルボーナス +${SKILL_BONUS_GAIN}）` };
    }

    // ---- 战斗风格 ----
    if (ap < cost) return { ok: false, message: 'APが足りない。' };
    if (item.kind === 'dist+') {
      c.set(208, limit((c.get(208) | 0) + 1, 1, 10));
      c.set(173, ap - cost);
      return { ok: true, message: `${nameOf(c)}の適正距離が${c.get(208) | 0}になった。` };
    }
    if (item.kind === 'dist-') {
      c.set(208, limit((c.get(208) | 0) - 1, 1, 10));
      c.set(173, ap - cost);
      return { ok: true, message: `${nameOf(c)}の適正距離が${c.get(208) | 0}になった。` };
    }
    if (item.kind === 'move+') {
      c.set(207, limit((c.get(207) | 0) + 10, 0, 100));
      c.set(173, ap - cost);
      return { ok: true, message: `${nameOf(c)}の移動確率が${c.get(207) | 0}になった。` };
    }
    if (item.kind === 'move-') {
      c.set(207, limit((c.get(207) | 0) - 10, 0, 100));
      c.set(173, ap - cost);
      return { ok: true, message: `${nameOf(c)}の移動確率が${c.get(207) | 0}になった。` };
    }
    if (item.kind === 'quality') {
      if ((c.get(25) | 0) >= 4) {
        c.set(173, ap + cost);           // 4118xx：无变化时退还
        return { ok: false, message: '何もおきない…' };
      }
      c.set(25, 4);
      c.set(173, ap - cost);
      return { ok: true, message: `${nameOf(c)}はランクアップした！` };
    }
    return { ok: false, message: 'それは無理だ。' };
  }

  function nameOf(c) {
    if (c && c.name) return c.name;
    if (Elona.Chara && Elona.Chara.nameOf) return Elona.Chara.nameOf(c);
    return '相手';
  }

  /** 觉醒天赋的显示名（供人物窗 / feat 列表用） */
  function talentList(c) {
    const out = [];
    for (const f of FEATS) if (has(c, f.cbit)) out.push({ cbit: f.cbit, label: f.jp, en: f.en });
    for (const s of LEARN) if (has(c, s.cbit)) out.push({ cbit: s.cbit, label: s.jp, en: s.en });
    for (const s of STYLES) {
      if (s.op === 'cbit' && has(c, s.bit)) out.push({ cbit: s.bit, label: s.jp, en: s.en });
    }
    return out;
  }

  Elona.AP = {
    menu, spend, talentList,
    speedCost, lifeCost, speedCapped, lifeCapped, attrSum, snapshot, ensureInit,
    has, featsOwned,
    LEARN, FEATS, STYLES, AP_MAX, FEAT_LIMIT, SKILL_BONUS_COST,
  };
})(typeof window !== 'undefined' ? window : global);
