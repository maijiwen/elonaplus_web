'use strict';
/**
 * 道场（学校 / Doujyou）与「寄放」系统 —— A404。
 *
 * 源码依据（hsp/start.hsp）：
 *   245601-245609  地图 67 的 map_init：`characreate -1, 519, 12, 11` 生成师范（物种 519）
 *   387244-387738  物种 519 的对话分支：
 *                    · 386xxx 附近用 var_65(821)（门生数）/ var_65(822)（寄放的神仆数）
 *                    · 入門：10000gp、门生上限 150、var_65(821)++、神仆再 var_65(822)++、
 *                      cbit 960=1、var_58(80)=当前地图、relocate_chara -1、
 *                      var_58(9)=-1 / var_58(69)=-1 / var_58(150)=3
 *                    · 特別訓練：费用 = Σ min(筋力*8+耐久*10+意志*8, 20000) * 5，
 *                      成长率 10..17 +90、已有技能(100..111/150..190/300..301) +120，随后重算属性
 *                    · 魔法スタイル（var_58(65) 0..9）/ 格闘スタイル（var_58(33) 0..12）各 200gp
 *   248849-248898  跨日：仅当 var_65(20)==67 且 var_65(188)>=100 且 821!=0，
 *                   对全部 cbit 960 且 var_58(58)!=0 的门生做每日修行（每项技能经验
 *                   limit(rnd(188) + 188*3 + 技能14/4 + 200, 0, 200000)），然后 var_65(188)=0
 *   312702-312704  每回合：821!=0 时 var_65(188)（上限 100000）±1
 *   233803-233868  廃モンスター牧場（地图类型 100）「ペットを放す」：
 *                    cbit 960 合计 150 上限、cbit 963/971 护卫不可、神仆 var_65(822)++、
 *                    var_58(80)=当前地图、var_126(18) 归位 400
 *   589966-589990  从学校/牧场把寄放者收回队伍时：地图 67 → 821--，神仆 822 --；
 *                    地图类型 100 → 神仆 822 --（822 下限 0）
 *   272734-272749  神仆上限 = 信仰技能/10，var_65(822) 也计入（faith.js 已使用该值）
 *
 * 与原版的差异（如实记录）：
 *   · 原版寄放者被 relocate 到 57..244 槽；本项目同样搬出 1..15（以释放队伍槽），
 *     但为了跨地图保存/显示，仍保留在 `g.party` 列表里（Party.restore 负责显隐）。
 *   · 角色池（g.charas）本身尚未纳入存档序列化，寄放者随现有存档限制一起丢失。
 *   · 每日修行只处理「在场」的门生（原版扫全表）；与 Party.restore 的显隐规则一致。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const SCHOOL_MAP = 67;        // 道场（var_65(20)）
  const MONSTER_RANCH = 100;    // 廃モンスター牧場（var_132(16)）
  const TEACHER_SPECIES = 519;  // ナズナ
  const F_STAY_MAP = 80;        // var_58(80)：寄放地图
  const F_TALK = 150;           // var_58(150)：3 = 寄放/门生
  const F_SAVED_X = 171;        // 原版寄放时保存的坐标
  const F_SAVED_Y = 172;
  const F_MARRIED = 58;         // var_58(58)：0 = 野生，非 0 = 我方
  const F_GOLD = 30;            // 所持金
  const F_LEARN = 14;           // 技能 14（学習）—— 每日修行加成
  const F_STYLE_MELEE = 33;     // 格闘スタイル
  const F_STYLE_CAST = 65;      // 魔法スタイル
  const CB_STAY = 960;          // 寄放/门生
  const CB_ESCORT = 963;        // 护卫
  const CB_ESCORT2 = 971;       // 护卫（另一种）
  const CB_COSTUME = 967;       // 门生服装
  const V_PUPILS = 821;         // 门生数
  const V_SERVANTS = 822;       // 寄放的神仆数
  const V_TRAIN = 188;          // 道场修行计数器
  const MAX_PUPILS = 150;
  const MAX_SLOT = 244;         // 原版角色池上限

  const MELEE_STYLES = [
    '殴打', '引っ掻き', '蹴り', '噛みつき', '睨み', '刺突', '接触',
    '胞子', '枝', '投げ', '体当たり', 'ハサミ', '殴打と蹴りの混合',
  ];
  const CAST_STYLES = [
    '手', '体液', '触手', '視線', '胞子', '振動', '魔法陣', '粉', '思念',
  ];

  function cbit(c, n) {
    return (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, n) | 0) : 0;
  }
  function cbitmod(c, n, v) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, n, !!v);
  }
  function getV(g, n) {
    return (g && typeof g.getV65 === 'function') ? (g.getV65(n) | 0) : 0;
  }
  function setV(g, n, v) {
    if (g && typeof g.setV65 === 'function') g.setV65(n, v | 0);
  }
  function logMsg(g, s) {
    if (!g || !s) return;
    if (typeof g.log === 'function') g.log(s);
    else if (Array.isArray(g.messages)) g.messages.push(s);
  }
  function isServant(c) {
    return !!c && (c.raceName === 'servant' || c.alias === 'servant');
  }
  function skillsOf(c) {
    return Math.max(1, (c && typeof c.skill === 'function' ? (c.skill(F_LEARN) | 0) : 0));
  }
  /** 系统地图类型：优先地图实例 -> 世界站点 -> 地图名（2nouti = 廃モンスター牧場） */
  function mapTypeOf(g) {
    if (!g || !g.map) return 0;
    if ((g.map.mapType | 0) !== 0) return g.map.mapType | 0;
    const S = Elona.Sites;
    if (S && typeof S.ready === 'function' && S.ready()) {
      try {
        const t = S.typeOf(getV(g, 20), { mapName: g.map.name }, g);
        if (t) return t | 0;
      } catch (e) { /* 站点表未就绪 */ }
    }
    if (/^2nouti/i.test(g.map.name || '')) return MONSTER_RANCH;
    return 0;
  }

  const School = {
    SCHOOL_MAP, MONSTER_RANCH, MAX_PUPILS, MELEE_STYLES, CAST_STYLES,

    /** 是否在道场（地图 67） */
    isSchool(g) {
      if (!g || !g.map) return false;
      return (getV(g, 20) | 0) === SCHOOL_MAP || g.map.name === 'doujyou';
    },

    /** 是否在廃モンスター牧場（地图类型 100） */
    isMonsterRanch(g) {
      return mapTypeOf(g) === MONSTER_RANCH;
    },

    /** 师范（物种 519，仅限道场内） */
    isTeacher(g, c) {
      if (!School.isSchool(g)) return false;
      return !!c && (c.get(27) | 0) === TEACHER_SPECIES && !School.isStayer(c);
    },

    /** 寄放在某处的角色（cbit 960 + 有归属地图） */
    isStayer(c) {
      return !!c && cbit(c, CB_STAY) === 1 && (c.get(F_STAY_MAP) | 0) !== 0;
    },

    /** 当前地图上的寄放者 */
    isStayerAt(g, c) {
      return School.isStayer(c) && (c.get(F_STAY_MAP) | 0) === (getV(g, 20) | 0);
    },

    /** 计数（同时把原版的 821<0 → 1 修正带进来） */
    counters(g) {
      const pupils = getV(g, V_PUPILS);
      return {
        pupils: pupils < 0 ? 1 : pupils,
        servants: Math.max(0, getV(g, V_SERVANTS)),
        train: getV(g, V_TRAIN),
      };
    },

    /**
     * 师范菜单（387265-387290）。
     *   入門     ：钱 > 10000 且门生 < 150
     *   特別訓練 ：门生 > 0
     *   风格变更 ：钱 > 200
     */
    menu(g) {
      if (!School.isSchool(g)) return [{ key: 'none', label: '没什么事。' }];
      const out = [{ key: 'none', label: '没什么事。' }];
      const money = g.player ? (g.player.get(F_GOLD) | 0) : 0;
      const pupils = School.counters(g).pupils;
      if (money > 10000 && pupils < MAX_PUPILS) {
        out.push({ key: 'enroll', label: '让同伴入门（10000gp）' });
      }
      if (pupils > 0) out.push({ key: 'train', label: '特别训练' });
      if (money > 200) {
        out.push({ key: 'cast', label: '变更魔法风格（200gp）' });
        out.push({ key: 'melee', label: '变更格斗风格（200gp）' });
      }
      return out;
    },

    /** 特別訓練费用（387602-387616） */
    trainCost(g) {
      let cost = 0;
      for (const c of (g.charas || [])) {
        if (!c || (c.index | 0) === 0) continue;
        if ((c.get(0) | 0) !== 1) continue;
        if (cbit(c, CB_STAY) !== 1) continue;
        cost += Math.min((c.get(198) | 0) * 8 + (c.get(199) | 0) * 10 + (c.get(160) | 0) * 8, 20000);
      }
      return cost * 5;
    },

    /**
     * 入門（387306-387392）：把一名同伴寄放在道场。
     * @returns {{ok:boolean, message:string, messages?:string[]}}
     */
    enroll(g, c) {
      const p = g && g.player;
      if (!p || !c || c === p) return { ok: false, message: '没有可以入门的同伴。' };
      if (!(g.party || []).includes(c)) {
        return { ok: false, message: '只能让队伍里的同伴入门。' };
      }
      if (cbit(c, CB_ESCORT) === 1 || cbit(c, CB_ESCORT2) === 1) {
        return { ok: false, message: `「この者は護衛対象だ。預かることはできん。」（${c.name}是护卫对象，不能寄放。）` };
      }
      if (School.counters(g).pupils >= MAX_PUPILS) {
        return { ok: false, message: `「門下生はこれ以上預かれん。」（门生已达 ${MAX_PUPILS} 人上限。）` };
      }
      if ((p.get(F_GOLD) | 0) <= 10000) {
        return { ok: false, message: '「金が足りんな。」（需要超过 10000gp。）' };
      }
      const messages = [`「しかたあるまい。鍛えてやろう。」`];
      // 387338-387346：门生要换成道服
      if (cbit(c, CB_COSTUME) === 1) {
        cbitmod(c, CB_COSTUME, 0);
        messages.push('「修行に私服は不要！さぁ、着替えろ！」');
      }
      c.set(F_SAVED_X, c.x | 0);
      c.set(F_SAVED_Y, c.y | 0);
      // 387364-387368：先计门生，再专门计神仆
      setV(g, V_PUPILS, School.counters(g).pupils + 1);
      if ((c.get(0) | 0) !== 0 && isServant(c)) {
        setV(g, V_SERVANTS, School.counters(g).servants + 1);
      }
      c.set(F_STAY_MAP, getV(g, 20) | 0);
      // 必须先打 cbit 960：relocate 对 960 角色不做技能归一化（game.relocateChara）
      cbitmod(c, CB_STAY, 1);
      if (typeof g.relocateChara === 'function') {
        try { g.relocateChara(c.index | 0, -1, 0); } catch (e) { /* 槽位表未就绪 */ }
      }
      c.set(9, -1);
      c.set(69, -1);
      c.set(F_TALK, 3);
      // 387390：最后一刻才扣钱（原版允许扣成负数）
      p.set(F_GOLD, (p.get(F_GOLD) | 0) - 10000);
      messages.push(`${c.name}成了门生。（門下生 ${School.counters(g).pupils} 人）`);
      return { ok: true, message: messages.join('\n'), messages };
    },

    /**
     * 特別訓練（387626-387712）：教练直接对全部门生做成长修正。
     * @returns {{ok:boolean, message:string, cost:number}}
     */
    specialTrain(g) {
      const p = g && g.player;
      if (!p) return { ok: false, message: '现在无法训练。', cost: 0 };
      const pupils = School.counters(g).pupils;
      if (pupils <= 0) return { ok: false, message: '「門下生がおらんぞ。」（没有门生。）', cost: 0 };
      const cost = School.trainCost(g);
      if ((p.get(F_GOLD) | 0) < cost) {
        return { ok: false, message: `「金が足りんな。」（训练费 ${cost}gp。）`, cost };
      }
      p.set(F_GOLD, (p.get(F_GOLD) | 0) - cost);
      const S = Elona.Stats;
      if (S) {
        for (const c of (g.charas || [])) {
          if (!c || (c.index | 0) === 0) continue;
          if ((c.get(0) | 0) !== 1 || cbit(c, CB_STAY) !== 1) continue;
          for (let sk = 10; sk <= 17; sk++) {
            if (S.modGrowth) S.modGrowth(c, sk, c, 90, g);
          }
          const ranges = [[100, 111], [150, 190], [300, 301]];
          for (const [a, b] of ranges) {
            for (let sk = a; sk <= b; sk++) {
              const has = S.sorg ? (S.sorg(c, sk) | 0) : 0;
              if (!has) continue;
              if (S.modGrowth) S.modGrowth(c, sk, c, 120, g);
            }
          }
          if (S.recalcStats) S.recalcStats(c, g);
        }
      }
      return { ok: true, message: `「うむ、これでよし！」（花費 ${cost}gp，全部门生获得特别训练。）`, cost };
    },

    /**
     * 变更风格（387471-387487 魔法 / 387597-387598 格斗），各 200gp。
     * @param {string} kind 'cast' | 'melee'
     */
    changeStyle(g, c, kind, value) {
      const p = g && g.player;
      const target = c || p;
      if (!p || !target) return { ok: false, message: '现在无法变更。' };
      const list = (kind === 'cast') ? CAST_STYLES : MELEE_STYLES;
      const v = value | 0;
      if (v < 0 || v >= list.length) return { ok: false, message: '没有选择风格。' };
      if ((p.get(F_GOLD) | 0) < 200) return { ok: false, message: '「金が足りんな。」（需要 200gp。）' };
      if (target.get(0) === 0) return { ok: false, message: '没有可以指导的对象。' };
      // 魔法风格 0..9；格斗风格 0..12（数组长度即上限）
      target.set(kind === 'cast' ? F_STYLE_CAST : F_STYLE_MELEE, v);
      p.set(F_GOLD, (p.get(F_GOLD) | 0) - 200);
      return { ok: true, message: `风格变成了「${list[v]}」。（-200gp）` };
    },

    /**
     * 每回合：var_65(188) 累积（312702-312704）。
     * 只在有门生时增加，上限 100000。
     */
    tickTurn(g) {
      if (!g || !g.player) return;
      if (School.counters(g).pupils === 0) return;
      const t = getV(g, V_TRAIN);
      if (t < 100000) setV(g, V_TRAIN, t + 1);
    },

    /**
     * 跨日：道场每日修行（248849-248898）。
     * @returns {{messages:string[]}|null}
     */
    tickDay(g) {
      if (!g || !g.player) return null;
      if (!School.isSchool(g)) return null;
      const pupils = School.counters(g).pupils;
      if (pupils === 0) return null;
      const train = getV(g, V_TRAIN);
      if (train < 100) return null;
      const rnd = (n) => (g.rng && typeof g.rng.rnd === 'function')
        ? (g.rng.rnd(Math.max(1, n | 0)) | 0) : 0;
      const S = Elona.Stats;
      let grew = false;
      for (const c of (g.charas || [])) {
        if (!c || (c.index | 0) === 0) continue;
        if (cbit(c, CB_STAY) !== 1) continue;
        if ((c.get(F_MARRIED) | 0) === 0) continue;   // 只训练我方（非野生）
        if (!S || !S.skillExp) continue;
        const learn = Math.floor(skillsOf(c) / 4);
        const apply = (sk) => {
          const exp = limit(rnd(train) + train * 3 + learn + 200, 0, 200000);
          try { S.skillExp(c, sk, c.index | 0, exp, 0, 0, g); } catch (e) { /* 无技能表 */ }
          grew = true;
        };
        for (let sk = 10; sk <= 17; sk++) apply(sk);
        const ranges = [[100, 111], [150, 190], [300, 301]];
        for (const [a, b] of ranges) {
          for (let sk = a; sk <= b; sk++) {
            if (!(S.sorg ? (S.sorg(c, sk) | 0) : 0)) continue;
            apply(sk);
          }
        }
      }
      setV(g, V_TRAIN, 0);   // 248897：无论是否成长都归零
      if (!grew) return null;
      return { messages: ['门生们在道场里勤奋修行，似乎有所成长。'] };
    },

    /**
     * 收回寄放者（589966-589990 的计数 + Party.joinChara）。
     * 队伍满时拒绝（原版会 vanquish，但寄放者不应因此消失）。
     * @returns {{ok:boolean, message:string}}
     */
    recruit(g, c) {
      if (!c || !School.isStayerAt(g, c)) return { ok: false, message: '这个人没有寄放在这里。' };
      const P = Elona.Party;
      if (!P || !P.joinChara || !P.freeAlly) return { ok: false, message: '现在无法收为同伴。' };
      if (!P.freeAlly(g)) return { ok: false, message: '「队伍人数已达上限。」（没有空的队伍槽位。）' };
      // 589974-589990：先把寄放计数退掉
      if (School.isSchool(g)) {
        setV(g, V_PUPILS, School.counters(g).pupils - 1);
        if (isServant(c)) setV(g, V_SERVANTS, Math.max(0, School.counters(g).servants - 1));
      } else if (School.isMonsterRanch(g)) {
        if (isServant(c)) setV(g, V_SERVANTS, Math.max(0, School.counters(g).servants - 1));
      }
      cbitmod(c, CB_STAY, 0);
      const spot = (P.nearSpot ? P.nearSpot(g, g.player.x | 0, g.player.y | 0) : null)
        || { x: g.player.x | 0, y: g.player.y | 0 };
      c.x = spot.x; c.y = spot.y;
      const r = P.joinChara(g, c);
      if (!r.ok) return { ok: false, message: r.message || '无法收为同伴。' };
      return { ok: true, message: r.message || `${c.name}回到了队伍。` };
    },

    /**
     * 廃モンスター牧場：放走同伴（233803-233868）。
     * 与道场入門不同：不计入 var_65(821)，但神仆计入 var_65(822)。
     * @returns {{ok:boolean, message:string}}
     */
    releasePet(g, c) {
      const p = g && g.player;
      if (!p || !c || c === p) return { ok: false, message: '没有可以放走的同伴。' };
      if (!(g.party || []).includes(c)) return { ok: false, message: '只能放走队伍里的同伴。' };
      if (cbit(c, CB_ESCORT) === 1 || cbit(c, CB_ESCORT2) === 1) {
        return { ok: false, message: `「この者は護衛対象だ。」（${c.name}是护卫对象。）` };
      }
      if (School.countStayers(g) >= MAX_PUPILS) {
        return { ok: false, message: `「これ以上は預かれん。」（寄放上限 ${MAX_PUPILS} 体。）` };
      }
      c.set(F_SAVED_X, c.x | 0);
      c.set(F_SAVED_Y, c.y | 0);
      if (cbit(c, CB_STAY) !== 1) cbitmod(c, CB_STAY, 1);
      if ((c.get(0) | 0) !== 0 && isServant(c)) {
        setV(g, V_SERVANTS, School.counters(g).servants + 1);
      }
      c.set(F_STAY_MAP, getV(g, 20) | 0);
      if (typeof g.relocateChara === 'function') {
        try { g.relocateChara(c.index | 0, -1, 0); } catch (e) { /* 槽位表未就绪 */ }
      }
      c.set(9, -1);
      c.set(69, -1);
      c.set(F_TALK, 3);
      // 233857-233859：var_126(18) <= 80 时归位 400
      if (g.map && Array.isArray(g.map.header) && (g.map.header[18] | 0) <= 80) {
        g.map.header[18] = 400;
      }
      return { ok: true, message: `${c.name}留在了牧场。（寄放 ${School.countStayers(g)} 体）` };
    },

    /** 全图 cbit 960 计数（233807 的 repeat 245） */
    countStayers(g) {
      let n = 0;
      for (const c of (g && g.charas ? g.charas : [])) {
        if (c && cbit(c, CB_STAY) === 1) n++;
      }
      return n;
    },

    /**
     * 加入队伍前的计数回收（589974-589990）。
     * 由 Party.joinChara 在清空 var_58(80)/cbit960 之前调用。
     */
    onJoin(g, c) {
      if (!c || cbit(c, CB_STAY) !== 1) return;
      const map = c.get(F_STAY_MAP) | 0;
      if (!map) return;
      if ((getV(g, 20) | 0) === SCHOOL_MAP) {
        setV(g, V_PUPILS, getV(g, V_PUPILS) - 1);
        if (isServant(c)) setV(g, V_SERVANTS, Math.max(0, getV(g, V_SERVANTS) - 1));
      } else if (mapTypeOf(g) === MONSTER_RANCH) {
        if (isServant(c)) setV(g, V_SERVANTS, Math.max(0, getV(g, V_SERVANTS) - 1));
      }
      cbitmod(c, CB_STAY, 0);
    },

    /**
     * 进入地图后：道场生成师范（245601-245609）。
     * 寄放者的显隐由 Party.restore 负责（var_58(80)）。
     */
    onMapEnter(g) {
      if (!g || !g.map || !School.isSchool(g)) return;
      const alive = (g.charas || []).some((c) => c && (c.get(27) | 0) === TEACHER_SPECIES && (c.get(0) | 0) === 1);
      if (alive) return;
      if (!Elona.CharaFactory || typeof Elona.CharaFactory.create !== 'function') return;
      let slot = 0;
      for (let i = 57; i <= MAX_SLOT; i++) {
        const c = g.charas[i];
        // 只占用真正空着的槽：寄放者即使处于 var_58(0)=9（别的地图）也不能被覆盖
        if (!c || ((c.get(0) | 0) === 0 && (c.get(F_STAY_MAP) | 0) === 0)) { slot = i; break; }
      }
      if (!slot) return;
      try {
        const teacher = Elona.CharaFactory.create(g, TEACHER_SPECIES,
          Math.max(1, g.player ? (g.player.get(38) | 0) : 1), 12, 11, { index: slot });
        if (teacher) {
          teacher.set(F_TALK, 3);
          teacher.set(9, 0);
        }
        if (g.syncCharaCells) g.syncCharaCells();
      } catch (e) { /* 生物表未就绪 */ }
    },
  };

  Elona.School = School;
})(window);
