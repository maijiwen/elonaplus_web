'use strict';
/**
 * NPC 交互 —— 对话 / 训练 / 治疗 / 用餐 / 鉴定
 *
 * 【源码依据】
 *   *label_2749（289330+）  选择方向后对 NPC 打开操作菜单（Talk / Attack / Give …）
 *   *label_3031（365607+）  对话主入口：店主（角色 1000..1999 / 2003）先打开商店
 *   *label_3068 / *label_3067  对话选项与返回
 *   415343-425235           按角色 var_58(150) 追加服务选项与结算：
 *     - 1005 旅店主人：用餐 140 gold，营养设为 15000（415841-415862，calcmealvalue）
 *     - 5    鉴定屋：  鉴定 100 gold（calcidentifyvalue，214712-214741）
 *     - 7    训练师：  训练费用 limit(sorg/40+1, 2, 5) 白金币，modgrowth +100（425165-425235）
 *     - 12   治疗师：  治疗 500 gold（calcrestorecost，214775-214780），恢复队伍 HP/MP 与异常
 *
 * 【简化标注】原版还包含竞技场、贸易、雇用、情报、人肉/恋爱等大量分支，本项目只实现
 *   城镇常用服务；所有文本为中文简述，不复刻原版的语气/表情差分。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  /** var_65(n) 的安全读取（测试桩可能没有 var65 数组） */
  function v65(g, n) {
    try { return g && g.getV65 ? (g.getV65(n) | 0) : 0; } catch (e) { return 0; }
  }
  function setV65(g, n, v) {
    try { if (g && g.setV65) g.setV65(n, v); } catch (e) { /* 忽略 */ }
  }

  /** 角色名称（var_58(150)） */
  const ROLE_NAMES = {
    3: '市民', 4: '市民', 5: '鉴定屋', 6: '街长', 7: '训练师', 8: '情报屋', 9: '酒保',
    12: '治疗师', 14: '吟游诗人',
    1000: '武具店', 1001: '武具店', 1003: '面包店', 1004: '魔法店', 1005: '旅店',
    1006: '杂货店', 1007: '黑市', 1008: '万事屋', 1009: '家具店', 1010: '行商',
    1011: '交易店', 1012: '纪念品店', 1013: '电子巨蛋商人', 1014: '钓饵店',
    1015: '见世物屋（摩安）', 1016: '精灵球屋', 1017: '染料店', 1018: '杂货商',
    1019: '妹妹的店', 1020: '魔術士ギルド書店', 1021: '盗贼店', 1022: '祭典摊',
    1023: '宝具商', 1024: '小摊', 1026: '船商', 2003: '商人',
  };

  const SHOP_ROLES = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009,
    1010, 1011, 1012, 1013, 1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022,
    1023, 1024, 1026, 2003];

  let SKILL_NAMES = {};
  let SKILL_SHOP = null;       // skillshop.json（A181：*label_2777/2778 场景过滤表）

  async function loadTable() {
    const d = await Elona.Data.table('skills');
    SKILL_NAMES = (d && d.skillNames) || {};
    try {
      SKILL_SHOP = await Elona.Data.table('skillshop');
    } catch (e) { SKILL_SHOP = null; }   // 表缺失时退化为「全部未习得」旧行为
    return SKILL_NAMES;
  }
  function setSkillNames(names) { SKILL_NAMES = names || {}; }
  function setSkillShop(t) { SKILL_SHOP = t || null; }
  function skillName(id, lang) {
    const e = SKILL_NAMES[String(id)];
    if (!e) return 'skill ' + id;
    // 【B4】未指定语言时跟随 config 的 language（默认中文）
    const cur = lang || (Elona.Lang && Elona.Lang.current ? Elona.Lang.current() : 'ch');
    if (cur === 'jp') return e.jp || e.ch || e.en || ('skill ' + id);
    if (cur === 'en') return e.en || e.ch || e.jp || ('skill ' + id);
    return e.ch || e.jp || e.en || ('skill ' + id);
  }

  function roleOf(npc) { return npc ? (npc.get(150) | 0) : 0; }
  function roleName(role) { return ROLE_NAMES[role] || ''; }
  function isShop(role) { return SHOP_ROLES.indexOf(role) >= 0; }

  // ----------------------------------------------------------------------
  // 0-※：i 键「操作弹窗」的选项表
  //   源码 *label_2749（289551-289766）用 var_487 逐条追加，顺序与条件全部照搬。
  //   与下面的 services() 不同：这张表是「对这个人做什么」，
  //   选「交谈」之后才进入 services()/对话脚本（*label_3031）。
  // ----------------------------------------------------------------------
  /** cbit 的安全读取（测试桩可能没有状态模块） */
  function cbOf(c, n) {
    return (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, n) | 0) : 0;
  }

  /** var_58(80) 是用「第几回合」的日期比较気力回复，这里照 289584 算天数 */
  function gameDate(g) {
    const d = v65(g, 13) | 0, h = v65(g, 12) | 0, m = v65(g, 11) | 0, y = v65(g, 10) | 0;
    return d + h * 24 + m * 24 * 30 + y * 24 * 30 * 12;
  }

  /**
   * 0-Z27：兴趣 var_58(14) —— 对话菜单与左侧蓝条都用它
   *
   * 【原版依据】
   *   · 289585-289589：`if (现在小时数 >= var_58(15)) var_58(14) = 100`
   *     过了 var_58(15) 记下的时刻就回满。
   *   · 414150-414151：每闲聊一次 `var_58(14) -= rnd(20)`，并 `var_58(15) = 现在 + 12 小时`。
   *   · 415128：`var_58(14) > 0` 菜单里才有「話がしたい」。
   *   · 426639-426645：对话窗左侧蓝条按 `var_58(14) / 5 + 1` 条画。
   *   · var_58(15) 初值 0（219684 建立角色时只把 var_58(14) 设成 100），
   *     所以第一次对话前 `现在 >= 0` 恒成立，等于「一上来就是满的」。
   *
   * @returns {number} 当前兴趣（0..100），必要时已写回 100
   */
  function interestOf(npc, g) {
    if (!npc) return 0;
    // 0-Z27：Relation.refreshVigor 是同一件事的既有实现（A183），优先复用，
    //   避免出现两套「兴趣」模型。
    if (Elona.Relation && Elona.Relation.refreshVigor) {
      return Elona.Relation.refreshVigor(g, npc) | 0;
    }
    const v = npc.get(14) | 0;
    if (gameDate(g) >= (npc.get(15) | 0)) {
      if (v !== 100) npc.set(14, 100);
      return 100;
    }
    return v;
  }

  /**
   * 0-Z27：一次闲聊的好感 / 兴趣结算（414135-414153）
   *
   *   if ( var_58(14, var_244) > 0 ) {
   *     if ( var_58(9, var_244) != 10 ) {
   *       if ( var_244 >= 16 ) {
   *         if ( var_65(20) != 80 | var_65(22) != 70 ) {
   *           if ( rnd(3) == 0 ) {
   *             if ( var_58(17, var_244) < 100 ) {
   *               if ( rnd(var_82(17, 0) + 1) > 10 ) { modimp var_244, rnd(3) }
   *               else                              { modimp var_244, rnd(3) * (-1) }
   *   ...}}}}
   *     var_58(14, var_244) -= rnd(20)
   *     var_58(15, var_244) = 现在 + 12 小时
   *   }
   *
   * `var_82(17, 0)` 是主角的「魅力」（1767 行 `var_81(17) = "魅力"`），
   * 所以魅力越高越容易掷到加好感。
   * 这段在原版 `*label_3059` 里位于 `var_122 == ""` 的分支 —— 也就是**每次
   * 重建会话窗**都会跑一次：打开对话窗算一次，选一次「話がしたい」
   * （415806 `var_122 = ""` → `goto *label_3059`）再算一次。
   */
  function chatImp(g, npc) {
    if (!g || !npc) return;
    if (interestOf(npc, g) <= 0) return;              // 已经没兴趣了，不结算
    if ((npc.get(9) | 0) === 10) return;              // 同阵营 / 同伴
    const idx = npc.index | 0;
    const party = (idx < 16)
      || !!(Elona.Party && Elona.Party.isAlly && Elona.Party.isAlly(npc));
    if (party) return;                                // 原版只对 var_244 >= 16 的镇民生效
    const rng = g.rng || Elona.rng;
    // 事务所（地图 80 / 子图 70，见 docs 2896）里闲聊不掷好感
    const mapId = v65(g, 20) | 0, sub = v65(g, 22) | 0;
    if (!(mapId === 80 && sub === 70)) {
      if (rng.rnd(3) === 0 && (npc.get(17) | 0) < 100) {
        const cha = g.player ? (g.player.skill(17) | 0) : 0;
        if (rng.rnd(cha + 1) > 10) modImp(npc, rng.rnd(3), g);
        else modImp(npc, -rng.rnd(3), g);
      }
    }
    npc.set(14, Math.max(0, (npc.get(14) | 0) - rng.rnd(20)));
    npc.set(15, gameDate(g) + 12);
  }

  /**
   * @param {object} npc 操作对象（玩家自己时 index 为 0）
   * @param {object} g
   * @returns {Array<{act:number,id:string,label:string}>} 按源码顺序
   */
  function actionMenu(npc, g) {
    const out = [];
    if (!npc) return out;
    const idx = npc.index | 0;
    const f = (n) => (npc.get(n) | 0);
    const has = (n) => cbOf(npc, n) === 1;
    const push = (act, id, label) => out.push({ act, id, label });
    const mapId = v65(g, 20) | 0;
    const mapType = (() => {
      try { return (Elona.Sites && Elona.Sites.rawType) ? (Elona.Sites.rawType(mapId, g) | 0) : 0; } catch (e) { return 0; }
    })();
    const player = g && g.player;
    // 源码的 `var_244 < 16` = 队伍槽位（0..15）。本项目的同伴可能放在 57+ 的槽位，
    // 所以「是不是同伴」以 Party.isAlly 为准，玩家自己（0）也算队伍侧。
    const party = (idx < 16)
      || !!(Elona.Party && Elona.Party.isAlly && Elona.Party.isAlly(npc));
    // 289574：玩家处于混乱（var_58(254) > 0）时只剩「教说话 / 口吻 / 外观」这些
    const confused = player ? ((player.get(254) | 0) > 0) : false;
    // 289591 / 289604 / 289706 用到的「无法正常交涉」状态
    const noTalk = has(963) || has(971) || has(1040);

    if (idx !== 0) {
      // 289552-289573：卡片精灵（外观 1173）的花色变更
      if (f(7) === 1173 && f(58) === 0) {
        push(31, 'card-rank', '【变更等级】');
        if (f(27) !== 1127) push(32, 'card-spade', '[黑桃变更]');
        if (f(27) !== 1128) push(33, 'card-club', '[梅花变更]');
        if (f(27) !== 1129) push(34, 'card-diamond', '[方块变更]');
        if (f(27) !== 1130) push(35, 'card-heart', '[红心变更]');
      }
      // 289574-289583：交谈 / 攻击
      if (!confused) {
        push(0, 'talk', '交谈');
        if (!party) push(1, 'attack', '攻击');
      }
      // 289584-289590：兴趣（var_58(14)）冷却回满后 >= 80 才能表达心意
      if (interestOf(npc, g) >= 80) push(29, 'feelings', '表达心意');
      // 289591-289624：给予 / 带出 / 采集身体部位 / 攻击（同伴）
      if (!noTalk) {
        if (party || (has(960) && mapId === 67)) push(4, 'give-take', '交出/收下物品');
        else push(2, 'give', '交出物品');
        if (has(960)) push(5, 'bring-out', '带出去');
        let isWorker = false;
        try {
          const w = (Elona.Ranch && Elona.Ranch.getWorker) ? Elona.Ranch.getWorker(g, mapId) : null;
          isWorker = !!(w && (w.index | 0) === idx);
        } catch (e) { isWorker = false; }
        if ((has(960) || (isWorker && mapType === 31)) && f(50) === f(51)) {
          push(18, 'take-bone', '抽出骨头');
          push(19, 'take-heart', '取出心脏');
          push(20, 'take-eye', '挖出眼球');
          push(21, 'take-blood', '榨取体液');
          push(22, 'take-skin', '剥下皮');
        }
        if (party) push(1, 'attack', '攻击');
      }
      // 289625-289628：教说话 / 改变口吻
      push(7, 'teach-word', '教它说话');
      push(10, 'tone', '改变口吻');
      // 289629-289666：同伴专属的几个开关
      if (party) {
        if (f(23) !== 0) push(36, 'silence', has(965) ? '让它说话' : '让它闭嘴');
        push(37, 'precious', has(1053) ? '取消重要伙伴' : '指定为重要伙伴');
        push(38, 'endure', has(1032) ? '解除忍耐脚下物品' : '忍耐脚下物品');
        if (!has(963) && !has(971) && !has(992) && !has(960)) push(39, 'wait-town', '在城里待命');
      }
      // 289667-289680：解开绳子 / 从牢笼释放
      if (mapId !== 35 && has(985)) push(9, 'untie', '解开绳子');
      if (mapId !== 105 && f(34) <= -90 && has(1040)) push(30, 'release-cage', '从牢笼中释放');
    }

    // 289682-289693：换装 / 改变外形 / 站起来的样子 / 道具图像
    if (party) {
      push(8, 'appearance', '换装');
      push(14, 'shape', '改变外形');
    }
    push(27, 'tatie', '改变站姿');
    push(23, 'item-mark', '赋予道具图像');
    if (f(447) > 0) {
      push(26, 'item-mark-adjust', '调整道具图像');
      push(25, 'item-mark-move', '移动道具图像');
      push(24, 'item-mark-delete', '删除道具图像');
    }
    // 289706-289723：搭档编成 / 解散
    if (!noTalk) {
      if (party && (f(80) === 0 || idx === 0)) {
        // 源码 289711：编成只给 168==0（还没有搭档）的一侧
        if (f(168) === 0) push(16, 'tag', '编成搭档');
        // 0-Z1：解散按 0-Y0 的 tagEnd 口径放宽到任一侧 —— 从 289443 的
        //   「组队左側／右側」选择窗选中追随者（168==1）后也要能解散。
        //   搭档索引允许 0（玩家），所以用 tagPartnerIndex 而不是 f(167) > 0。
        const C = Elona.Companion;
        const pi = (C && C.tagPartnerIndex) ? C.tagPartnerIndex(npc) : f(167);
        if (pi >= 0) {
          const pt = g && g.charas ? g.charas[pi] : null;
          if (pt && (pt.get(0) | 0) === 1) push(17, 'tag-dissolve', '解散搭档');
        }
      }
    }
    // 289724-289733：起名 / 能力公开 / 信息
    push(3, 'name', '起名');
    if ((idx !== 0 && f(9) === 10) || (mapId === 67 && has(960)) || (idx !== 0 && f(31) === 100)) {
      push(28, 'ability-info', '能力公开');
    }
    if (v65(g, 828)) push(6, 'info', '信息');
    // 289734-289743：让神仆/特定角色回去
    if ([484, 482, 359, 306, 331, 338, 339, 342, 461, 462, 463, 487].indexOf(f(27)) >= 0) {
      if (!has(960) && !party) {
        let owner = -1;
        try {
          const who = (Elona.Ranch && Elona.Ranch.getWorker) ? Elona.Ranch.getWorker(g, mapId) : null;
          owner = who ? (who.index | 0) : -1;
        } catch (e) { owner = -1; }
        if (owner !== idx) push(11, 'remand', '让它回去');
      }
    }
    // 289744-289753：2 月（var_65(11) == 2）的巧克力事件
    //   289744 用 `var_65(250 + 255)`（= 505）与 `var_65(250 + 265)`（= 515）两个
    //   事件计数器，不是 255 / 265 本身。
    if (v65(g, 11) === 2 && f(17) >= 200 && idx !== 0 && v65(g, 505) === 1) {
      push(12, 'choco-beg', '讨要巧克力');
    }
    if (idx !== 0 && v65(g, 11) === 2 && v65(g, 515) !== 0) push(15, 'choco-gift', '把自己当作礼物');
    // 289754-289765：把不死者放回棺材
    if ([447, 21, 100, 150, 47, 578, 416, 579].indexOf(f(27)) >= 0) {
      if (!has(960) && !has(1035) && !party && has(992)) push(13, 'to-casket', '放回棺材');
    }
    return out;
  }


  /**
   * C-5 菜单 61「観察する」（421633-421708）：商队偷渡关所。
   *   主线阶段 < 200 → 队长只是闲聊（421685-421708）
   *   阶段 >= 200 且当前在 43/45 关所 → 搭商队货车去另一侧（421635-421683）
   *   决斗诅咒 var_65(250+306) > 0 → 拒绝（421657-421664）
   * 实际换图由 storywarp.caravanTravel 完成。
   */
  function caravanObserve(g, npc) {
    const stage = (g && g.getV65) ? (g.getV65(252) | 0) : 0;
    const at = (g && g.getV65) ? (g.getV65(20) | 0) : 0;
    if (stage < 200) {
      // 421685-421708：两页对话，项目用 messages 分页呈现
      return { ok: true, messages: [
        '（暇そうにしていたキャラバンの隊長は、あなたの視線に気が付いた。）\n'
          + '「おや？君、ひょっとしてこの国から出ていきたいのかな？それは無理だよ。今は国境が封鎖されていて、'
          + 'お偉いさんの一団くらいしか通れないんだ。」',
        '（封鎖が解除されたら交易商たちを運ばねばならず、隊長は毎日ここで待っているらしい。）',
      ] };
    }
    if (at !== 43 && at !== 45) return { ok: true, message: '' };   // var_400 保持 0 → 只有「やめる」
    const dest = at === 43 ? 45 : 43;
    if ((g.getV65(250 + 306) | 0) > 0) {                            // 421657
      return { ok: true, message: '「決闘の呪いからは逃げられない！」' };
    }
    const S = Elona.Sites;
    const destName = (S && S.nameOf) ? (S.nameOf(dest, 'jp') || S.nameOf(dest)) : ('map ' + dest);
    return { ok: true, action: 'caravan-go', dest, destName,
      message: `（キャラバンの隊長は忙しそうでこちらに気付いていない。荷物に紛れ込んで関所を突破できそうだ。行き先：${destName}）` };
  }

  /**
   * 419826-421600：キャラバン隊長（地图 80）的「仕事の話がしたい」（菜单 107）。
   * 本项目实现分支选择与全部状态效果（工作计数 / 关系 / 期限）；
   * 原版多层「投票」小剧场属纯台词分支，压缩为单段台词。
   */
  function caravanWorkTalk(g, npc) {
    const V = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    const R = (n) => (g && g.rng && g.rng.rnd ? g.rng.rnd(n) : 0);
    const hour = V(13);
    // 419827-419834：上班 / 下班时间标记 + 事件 56
    g.setV65(250 + 298, hour < 6 ? 7 : 6);
    if (g.events && g.events.add) g.events.add(56);

    const wA = V(250 + 436), wB = V(250 + 437), wC = V(250 + 438);
    let which = 0;
    if (wA <= 0 && wB <= 0 && wC <= 0) which = 1;
    if (wA <= 300 && hour >= 0 && hour <= 2) which = 2;
    if (wB <= 600 && hour >= 3 && hour <= 5) which = 3;
    if (wC <= 900 && hour >= 12 && hour <= 14) which = 4;
    if ((g.v2385 | 0) > 3) which = 5;
    if ((npc.get(17) | 0) === 0) which = 6;

    const modimp = (dv) => {
      if (Elona.Relation && Elona.Relation.modimp) Elona.Relation.modimp(npc, dv, g);
    };

    if (which === 1) {
      // 420390-420442：新入职 → 关系 +5、补齐三项工作、期限推进
      modimp(5);
      if ((npc.get(17) | 0) <= 0) npc.set(17, 5);
      g.setV65(250 + 436, 1000 + R(300));
      g.setV65(250 + 437, 2000 + R(400));
      g.setV65(250 + 438, 3000 + R(500));
      if (Math.abs(V(250 + 274)) % 10 === 3) g.setV65(250 + 274, V(250 + 274) + 2);
      return { ok: true, message: '「おう、来たか。今日からお前もここの一員だ。仕事は山ほどあるぞ。」' };
    }
    if (which === 2 || which === 3 || which === 4) {
      // 420453 / 420507 / 420561：追加工作量 501+rnd(100)
      const slot = 250 + (which === 2 ? 436 : (which === 3 ? 437 : 438));
      g.setV65(slot, V(slot) + 501 + R(100));
      const nm = which === 2 ? '仕事Ａ' : (which === 3 ? '仕事Ｂ' : '仕事Ｃ');
      return { ok: true, message: `「${nm}の割り当てだ。さっさと片付けろ。」` };
    }
    if (which === 5) {
      g.v2385 = 3;                                  // 420615
      modimp(-10);                                  // 420616
      return { ok: true, message: '「お前、働きすぎだ。少し休め。」' };
    }
    if (which === 6) {
      modimp(-5);                                   // 420684
      return { ok: true, message: '「お前、どこの誰だ？仕事の話なら他を当たれ。」' };
    }
    // which == 0：工作中 —— 显示剩余工作量（419866）
    return { ok: true, message: `お前の仕事の残り具合は…仕事Ａ：${wA}、仕事Ｂ：${wB}、仕事Ｃ：${wC}と言ったところだな。`
      + '\n「あ？そんなの当たり前だろうが。頑張るのは誰にでもできるんだよ！」' };
  }

  /**
   * 当前 NPC 可用的服务（0-BX：按原版对话菜单的选项集合与顺序）
   *
   * 【原版依据】start.hsp 415180-416700 的 NPC 对话菜单（var_484/var_485）：
   *   城镇商店类 NPC 的选项是「聊天 / 买东西 / 卖东西 / 想投资 / 让开 / 再见」
   *   （截图与汉化版一致）；角色专属服务（鉴定 / 训练 / 情报 / 治疗 / 用餐 / 酒）
   *   来自各 role 分支；委托项来自 415722-415780。
   *   菜单项由 var_446（a/b/c…）提供快捷键，见 panels 的 KEY_LETTERS。
   *
   * 说明：本项目扩展的「给予物品 / 查看状态」保留在最后（原版无此两项，登记 A189）。
   */
  function services(npc, g) {
    const r = roleOf(npc);
    const out = [];
    // 0-Z27 / 415128-415131：`if ( var_58(14, var_244) > 0 & var_506(1) == 0 )`
    //   兴趣耗尽后「来聊聊天吧」消失，等 var_58(15) 到点（+12 小时）由 interestOf 回满。
    if (interestOf(npc, g) > 0) {
      out.push({ id: 'talk', label: '来聊聊天吧' });
    }
    if (isShop(r)) {
      out.push({ id: 'shop-buy', label: '买东西' });
      out.push({ id: 'shop-sell', label: '卖东西' });
      out.push({ id: 'invest', label: '想投资' });
    }
    // 415538-415541：魔法店（var_58(150) == 1004）的「ポーションの栓を分けて欲しい」
    if (r === 1004) {
      out.push({ id: 'potion-plug', label: '希望分给药水塞' });       // 原版菜单 115
    }
    if (r === 1000 || r === 1001) {
      out.push({ id: 'reload', label: '矢弹充填' });                 // 原版 54
      out.push({ id: 'enhance', label: '武具强化（+1 ~ +10）' });    // 原版 63
      out.push({ id: 'lighten', label: '武具轻量化（0.1s / 12000 gold）' });  // 原版 64
      out.push({ id: 'heavify', label: '武具重量化（0.1s / 4000 gold）' });   // 原版 95
    }
    if (r === 1005) {
      out.push({ id: 'meal', label: '用餐（140 gold）' });
      out.push({ id: 'special-meal', label: '特别菜单（青铜币 1 枚）' });     // 原版 83
    }
    if (r === 9) {
      out.push({ id: 'drink', label: '点一杯饮料（70 gold）' });
      out.push({ id: 'special-drink', label: '特别饮品（青铜币 1 枚）' });   // 原版 112
      // 0-DG：调酒师的同伴服务（源码 var_506 == 33 / 34，417429-417525）
      out.push({ id: 'revive-ally', label: '唤回同伴（复活）' });
      out.push({ id: 'wait-ally', label: '让同伴在城里待命' });
    }
    if (r === 5) {
      out.push({ id: 'identify-one', label: '鉴定一件' });     // 原版 14
      out.push({ id: 'identify', label: '全部鉴定' });         // 原版 15
      out.push({ id: 'investigate', label: '调查（5000 gold）' });  // 原版 16
      out.push({ id: 'practice', label: '魔法实习（按库存计费 · 白金币）' });     // 原版 75
      out.push({ id: 'stock-exchange', label: '魔法库存交换' });        // 原版 158
      out.push({ id: 'stock-exchange-all', label: '全部库存交换' });    // 原版 159
    }
    if (r === 7) {
      out.push({ id: 'train', label: '训练' });
      out.push({ id: 'learn', label: '学新技能' });      // 原版菜单 30「新しいスキルを覚えたい」
    }
    if (r === 12) {
      out.push({ id: 'heal', label: '能力复原（500 gold）' });
      out.push({ id: 'uncurse', label: '装备解咒（按名声计费）' });  // 原版菜单 62
    }
    if (r === 8) {
      out.push({ id: 'intel', label: '冒险者的情报（100 gold）' });      // 原版 18
      out.push({ id: 'adventurer-message', label: '给冒险者传话（2000 gold）' }); // 原版 105
      out.push({ id: 'boss-info', label: 'Boss 情报（每次 300 gold）' }); // 原版 98
      out.push({ id: 'birthday', label: '告诉他生日' });                 // 原版 82
      out.push({ id: 'rumor', label: '打听传闻（2000 gold）' });
    }
    if (r === 1020) {
      out.push({ id: 'reserve-book', label: '魔法书预订（需解读经验）' });
      out.push({ id: 'reserve-list', label: '查看/取消魔法书预订' });  // 源码 *label_2712 予約リスト
    }
    // 0-Z48 / 源码 371623：铁匠盖洛克（role/species 208）的素材槌材质改造
    if (r === 208 && Elona.LivingWeapon) {
      out.push({ id: 'material-kit', label: '素材槌的材质变化' });
    }
    // 街长：街道管理一览 / 人气
    if (r === 6) {
      out.push({ id: 'town-info', label: '街道管理' });              // 原版 74
      out.push({ id: 'popularity', label: '管理代行者的人气' });      // 原版 141
    }
    // 竞技场（10：决斗/乱斗/成绩；11：宠物战/团队战/EX/成绩）
    if (r === 10) {
      out.push({ id: 'arena-duel', label: '参加比赛（决斗）' });      // 原版 21
      out.push({ id: 'arena-rumble', label: '参加比赛（乱斗）' });    // 原版 22
      out.push({ id: 'arena-score', label: '询问成绩' });            // 原版 23
    }
    if (r === 11) {
      out.push({ id: 'pet-duel', label: '宠物决斗' });                // 原版 40
      out.push({ id: 'pet-team', label: '团队战' });                  // 原版 41
      out.push({ id: 'pet-ex', label: 'EX 战' });                     // 原版 49
      out.push({ id: 'arena-score', label: '询问成绩' });            // 原版 42
    }
    // 商人：以物易物 / 护卫委托 / 邀请入伙
    // 0-HU（A201d）：护卫改成 421314-421331 的三档动态报价，菜单文字不再写死 2000 gold
    if (r === 13) {
      out.push({ id: 'barter', label: '以物易物' });                  // 原版 20
      out.push({ id: 'hire-guard', label: '雇佣护卫（3 / 7 / 30 天）' }); // 原版 50
      out.push({ id: 'recruit', label: '邀请入伙' });                  // 原版 51
    }
    // 奴隶商：买奴隶（36）；马屋：买马（57）
    // 0-HU（A201d）：改为 *label_3062 的「看目录 → 生成候选 → 按候选算价 → 付钱」
    if (r === 17) out.push({ id: 'buy-slave', label: '买奴隶（看目录议价）' });
    if (r === 22) out.push({ id: 'buy-horse', label: '买马（看目录议价）' });
    // 委托（掲示板 *label_2704 / 委托人对话 *label_3031 / 415663-415745）
    if (g && Elona.Quest) {
      for (const s of Elona.Quest.npcServices(g, npc)) out.push(s);
    }
    // C-5 / 415574-415584：キャラバン隊長（职业 23）的「観察する」（菜单 61）
    //   地图 80 是另一分支（菜单 107「仕事の話がしたい」，419826-421600）。
    if ((npc.get(150) | 0) === 23) {
      const at = (g && g.getV65) ? (g.getV65(20) | 0) : 0;
      if (at !== 80) out.push({ id: 'caravan-observe', label: '观察商队（观客）' });
      else out.push({ id: 'caravan-work-talk', label: '仕事の話がしたい' });
    }
    // 0-FC：剧情传送（主线 / 支线任务接取后传送到固定地图）。
    //   源码：386376-386380 / 389083-389094 / 408123-408134 / 409371-409378 / 421666-421682
    //   —— NPC 对话分支里直接写 `var_65(64) = <目标地图>` + `var_1777 = 2|4` 换图。
    if (g && Elona.StoryWarp) {
      for (const s of Elona.StoryWarp.services(g, npc)) out.push(s);
    }
    // 0-BV：说「気持ち」（原版对话动作 var_400 == 29 → txtselectkimoti0/1/2，11000-11186）
    // A183 / 0-HF：补回 289584-289590 的入口条件 —— 生成菜单时先按冷却把 var_58(14)
    // 気力回满 100，只有 >= 80 才追加「気持ちを伝える」。旧实现对所有可对话 NPC 都提供。
    if (g && Elona.Relation && Elona.Relation.canShowFeelings
      && Elona.Relation.canShowFeelings(g, npc)) {
      out.push({ id: 'feelings', label: '说点心里话' });
    }
    // 0-CM：いちゃつく（原版同伴互动选项 12 → lovemiracle2 + customtalk 110，290448-290470）。
    // 入口条件：同伴且关系阶段 >= 恋心（var_58(17) 的 implevel >= 5）
    if (Elona.Love && Elona.Party && Elona.Party.isAlly(npc)
      && Elona.Relation && ((Elona.Relation.implevel(npc.get(17) | 0) | 0) >= 5)) {
      out.push({ id: 'cuddle', label: 'いちゃつく' });
    }
    // 0-CM：万圣节 Trick-or-Treat（事件 1025，366745-366930）—— 10/25 且未应付过
    if (Elona.Festival && Elona.Festival.isTrickTime(g) && ((npc.get(150) | 0) !== 2002)) {
      out.push({ id: 'trick-or-treat', label: '不给糖就捣蛋？' });
    }
    // 0-CQ：力の覚醒（AP 天赋菜单，410000-411925）。
    // 原版入口是「冒険ゼミ」的講師，且进度标志 var_65(250+254) >= 4 才追加菜单项（410044-410048）。
    if (Elona.AP) {
      const nm = String(npc.name || '');
      const flag = (g && typeof g.getV65 === 'function') ? (g.getV65(504) | 0) : 0;
      if (/ゼミ講師|课堂讲师/.test(nm) && flag >= 4) out.push({ id: 'awaken', label: '力の覚醒（AP 天赋）' });
    }
    // 0-DA：收容所（当前地图是收容所）→ 可把敌对者关押（234101-234160）
    if (Elona.Camp && Elona.Camp.campOf && Elona.Camp.campOf(g)) {
      out.push({ id: 'imprison', label: '収容する' });
      // 0-DB：收容所的运营面板（劳动强度变更 / 劳动能量兑换 / 放出囚犯）
      out.push({ id: 'camp-manage', label: '収容所の管理（Camp management）' });
    }
    // 0-EA：自营店（当前地图是自家店）→ 任命 / 卸任店番（233737-233798）
    if (Elona.ShopSale && Elona.Property && Elona.Property.currentSite) {
      const site = Elona.Property.currentSite(g);
      if (site && (site.type | 0) === 102) {
        const w = Elona.ShopSale.workerOf(g, site.id);
        if (w === npc) out.push({ id: 'unassign-worker', label: '卸下店番（Stop being shopkeeper）' });
        else out.push({ id: 'assign-worker', label: '任命为店番（Take charge of the shop）' });
      }
    }
    // 0-DC：骑乘（319598-319810）—— 与当前坐骑互动 → 下马；否则可骑乘同伴
    if (Elona.Riding && Elona.Riding.isMount && Elona.Riding.isMount(g, npc)) {
      out.push({ id: 'dismount', label: '降りる（Dismount）' });
    } else if (Elona.Riding && Elona.Riding.canRide && Elona.Riding.canRide(g, npc).ok) {
      out.push({ id: 'ride', label: '乗る / 乗せる（Ride）' });
    }
    // 0-DG：同伴 → 同伴指示（待機/呼び出し/戦術指示；原版 i 干涉菜单的子集）
    if (Elona.Companion && Elona.Party && Elona.Party.isAlly(npc)) {
      out.push({ id: 'companion-menu', label: '同伴指示（待命 / 战术）' });
      // 0-W0：把操作弹窗的同伴系统项（289641-289660 的 37/38/39）也放进对话窗。
      //   用户提供的原版截图里这三项就在对话窗内（omake 衍生版把两边合并了），
      //   动作与 i 键操作弹窗共用 runActionAct 的 case 37/38/39。
      {
        const b1053 = (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(npc, 1053) | 0) : 0;
        const b1032 = (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(npc, 1032) | 0) : 0;
        out.push({ id: 'act-37', act: 37, label: b1053 ? '解除重要的伙伴' : '设为重要的伙伴' });
        out.push({ id: 'act-38', act: 38, label: b1032 ? '解除脚下道具限制' : '限制脚下道具' });
        out.push({ id: 'act-39', act: 39, label: '在城里等着' });
      }
      // 0-DH / 0-W0：evochat 三项按源码条件拆开（415238-415258）：
      //   77 【evochat】= 玩家興味 433(0)>0 且对方 433<10 且好感 >= 100
      //   109 【组合evochat】= 对方有搭档 167 且搭档 433<10 且好感 >= 100
      //   110 听听组合间的对话 = 对方有搭档 167（搭档编号非 0）
      {
        const pl = g && g.player;
        const myChat = pl ? (pl.get(433) | 0) : 0;
        const npcChat = npc.get(433) | 0;
        const fav = npc.get(17) | 0;
        const tagIdx = npc.get(167) | 0;
        let tagChara = null;
        if (tagIdx && g && Array.isArray(g.charas)) {
          tagChara = g.charas.find((c) => c && (c.index | 0) === tagIdx) || null;
        }
        if (myChat > 0 && npcChat < 10 && fav >= 100) {
          out.push({ id: 'evochat', label: '【evochat】' });
        }
        if (tagIdx && tagChara && (tagChara.get(433) | 0) < 10
          && (tagChara.get(17) | 0) >= 100 && myChat > 0) {
          out.push({ id: 'evochat-tag', label: '【组合evochat】' });
        }
        if (tagIdx && tagChara) {
          out.push({ id: 'evochat-watch', label: '听听组合间的对话' });
        }
      }
      // 0-DH：一緒に食事（动作 84，415103 的四个条件：
      //   var_58(22) 双方 <= 10000、好感 >= 100、双方都没有 cbit 986）
      const pl = g && g.player;
      if (pl && Elona.Status && !Elona.Status.cbit(npc, 986) && !Elona.Status.cbit(pl, 986)
        && (npc.get(22) | 0) <= 10000 && (pl.get(22) | 0) <= 10000
        && (npc.get(17) | 0) >= 100) {
        out.push({ id: 'share-meal', label: '一起吃饭（经验 200% / 满腹度减半）' });
      }
    }
    // 415555-415568：让开的出现条件（0-HX 按源码补齐）
    //   `var_58(25) != 6`（状态 6 = 睡眠/dormant）且 `var_58(9) == 0`（中立关系）
    //   且地图不是 35 且槽位 >= 16（1..15 是同伴槽，原版不给「让开」）。
    {
      const st25 = npc.get(25) | 0;
      const rel9 = npc.get(9) | 0;
      const mapId = (g && g.v65 && typeof g.getV65 === 'function') ? (g.getV65(20) | 0) : 0;
      if (st25 !== 6 && rel9 === 0 && mapId !== 35 && (npc.index | 0) >= 16) {
        out.push({ id: 'aside', label: '让开' });
      }
    }
    out.push({ id: 'give', label: '给予物品' });    // 本项目扩展（登记 A189）
    out.push({ id: 'info', label: '查看状态' });    // 本项目扩展（登记 A189）
    return out;
  }

  const GREET = {
    3: ['「你好，旅行者。」', '「今天天气不错。」', '「最近镇子上很热闹呢。」'],
    4: ['「要小心野外的怪物。」', '「听说地下城最近又变了。」'],
    5: ['「要鉴定什么吗？」', '「知识就是力量，当然要收费。」'],
    6: ['「欢迎来到维尔尼斯。」', '「有困难可以来找我。」'],
    7: ['「想变强就得多练。」', '「付白金币，我教你几招。」'],
    8: ['「想知道点什么？」', '「情报可是要花钱的。」'],
    9: ['「来一杯吗？」', '「今天想喝点什么？」'],
    12: ['「身体有损伤吗？我可以帮你复原。」', '「能力被吸走了？交给我吧。」'],
    14: ['「要听一首歌吗？」', '「旅途辛苦了。」'],
    1000: ['「欢迎光临，看看武器吧。」', '「好装备能救命。」'],
    1001: ['「欢迎光临，看看武器吧。」', '「好装备能救命。」'],
    1003: ['「刚出炉的面包，来一个？」', '「今天的面包很香哦。」'],
    1004: ['「魔法书和卷轴，应有尽有。」', '「需要些魔法用品吗？」'],
    1005: ['「要吃饭吗？管饱。」', '「旅店的饭虽然简单，但很顶饿。」'],
    1006: ['「杂货店什么都有。」', '「随便看看，别客气。」'],
    1007: ['「嘿，要买点特别的东西吗？」', '「这里的东西可不太方便见光。」'],
    1008: ['「什么都能卖，什么都能买。」', '「有需要尽管说。」'],
    1009: ['「家具店的货很齐全。」', '「要给家里添点东西吗？」'],
    1014: ['「鱼饵，什么鱼都吃。」', '「今天的饵很新鲜。」'],
    1015: ['「瞧一瞧看一看，稀罕玩意！」', '「错过可就没有喽。」'],
    1016: ['「精灵球，什么都能装。」', '「要抓什么怪物？」'],
    1017: ['「染料和颜料，应有尽有。」', '「要染什么颜色？」'],
    1018: ['「潜力药、成长卷轴，好东西不少。」', '「随便看，别客气。」'],
    1019: ['「欢迎来到妹妹的店～」', '「爱心便当要吗？」'],
    1020: ['「这里是魔術士ギルド的书店。」', '「解读过的魔法书都能预订。」'],
    1021: ['「开锁工具和易容道具，别声张。」', '「嘿嘿，要买点不方便见光的东西？」'],
    1022: ['「祭典摊子，来玩一把？」', '「今天可是好日子。」'],
    1023: ['「宝具商，只卖好东西。」', '「看中哪个了？」'],
    1024: ['「小摊子，随便挑。」', '「便宜卖啦。」'],
    1026: ['「要出海吗？」', '「船上的货，看看？」'],
  };

  /**
   * 0-Z27：会话窗正文 + 一次闲聊结算（`*label_3059` 的顺序）
   *
   * 原版 414098-414153 的顺序是：先 `gosub *label_0264` 取台词（其中
   * `if ( var_58(14) <= 0 ) var_400 = %BORED` 用的是**扣减前**的兴趣），
   * 然后才跑兴趣扣减 / 好感掷骰。所以这里先取文本，再结算。
   */
  function talk(g, npc) {
    // 每日任务「和人对话」（365854）
    if (Elona.DailyQuest && Elona.DailyQuest.checkDialogue) Elona.DailyQuest.checkDialogue(g);
    const text = talkText(g, npc);
    // 414135-414153：会话窗（var_122 == "" 的分支）重建一次就结算一次 ——
    //   「打开对话窗」与「点一次来聊聊天吧」各一次，两条路都过本函数，等价。
    chatImp(g, npc);
    return text;
  }

  function talkText(g, npc) {
    const r = roleOf(npc);
    // 0-Z25：窗口标题已显示「名字（头衔）」，正文不再拼前缀
    // 0-GN / 365740-365762：睡眠（var_58(256)>60）或眩晕（var_58(251)!=0）的角色，
    //   对话窗口第一项是「（XX 正睡得香甜……）」而非闲聊台词。
    if ((npc.get(251) | 0) !== 0 || (npc.get(256) | 0) > 60) {
      return `（${npc.name}正睡得香甜……）`;
    }
    // 情报屋的传话效果（246142-246150）：交谈时结算
    let extra = '';
    if ((npc.get(428) | 0) > 0) {
      const d = applyMessage(g, npc);
      if (d > 0) extra = `（${npc.name} 想起了你的传话，好感 +${d}）`;
      else if (d < 0) extra = `（${npc.name} 想起了你的传话，好感 ${d}）`;
    }
    // customtalk（192942-193157）：NPC 配了台词文件（cbit 989）时优先用它
    if (Elona.Talk) {
      const t = Elona.Talk.say(g, npc, 106);
      if (t && t.text) {
        const line = /^["「]/.test(t.text) ? t.text : `「${t.text}」`;
        // 0-Z25：去掉「名字（头衔）」前缀 —— 对话窗口标题已有名字（原版
        //   txtsetconv 只拼台词本身，名字由对话框上方的标题栏显示）。
        return line;
      }
    }
    // 0-GM / 414098-414105：原版先 gosub *label_0264 取 data\talk.txt 的随机闲聊，
    // 再 customtalk 106 覆盖；这里 customtalk 已在上面优先返回，
    // 因此把内置闲聊接在自定义台词之后、硬编码 GREET 之前（结果等价）。
    if (Elona.IdleTalk) {
      const idl = Elona.IdleTalk.idle(g, npc);
      if (idl && idl.text) {
        const body = /^[「"『]/.test(idl.text) ? idl.text : `「${idl.text}」`;
        return body + extra;   // 0-Z25：名字由窗口标题显示，正文不再拼前缀
      }
    }
    const lines = GREET[r] || GREET[3];
    const pick = lines[((g && g.rng) ? g.rng : Elona.rng).rnd(lines.length)];
    const base = pick;   // 0-Z25：同上，正文不带名字前缀
    return base + extra;
  }

  /** 用餐 —— 415841-415862：140 gold，营养设为 15000；过饱时拒绝 */
  function meal(g, npc, player) {
    const cost = 140;                                  // calcmealvalue
    if ((player.get(22) | 0) >= 15000) {
      return { ok: false, reason: 'full', message: '「你看起来并不饿。」' };
    }
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', message: '「金币不够哦。」' };
    }
    player.set(30, player.get(30) - cost);
    player.set(22, 15000);
    return { ok: true, cost, message: '你饱餐了一顿，营养补满了。' };
  }

  /** 饮料 —— 415931-415963：70 gold（calcmealvalued），水分 15000；口渴时拒绝 */
  function drink(g, npc, player) {
    const cost = 70;
    if ((player.get(446) | 0) >= 15000) {
      return { ok: false, reason: 'thirsty', message: '「你看起来并不渴。」' };
    }
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', message: '「金币不够哦。」' };
    }
    player.set(30, player.get(30) - cost);
    player.set(446, 15000);
    if ((player.get(22) | 0) < 14000) player.set(22, (player.get(22) | 0) + 1000);
    // 415943-415951：每日任务 1「喝些饮料」（摊主给的饮料）
    if (Elona.DailyQuest && Elona.DailyQuest.complete) {
      Elona.DailyQuest.complete(g, 'q1', 1);
    }
    return { ok: true, cost, message: '你喝了一杯，水分补满了。' };
  }

  /** 鉴定 —— 416812-416878 / calcidentifyvalue：100 gold 起，按未鉴定数量加价 */
  /**
   * calcidentifyvalue（214712-214737）：鉴定费用。
   *   kind 0 = 单件鉴定（14）：100
   *   kind 1 = 全部鉴定（15）：100 × Σ权重 × 7/100（权重：未鉴定 f[8]==1 计 1、否则 10；
   *                                        总和 < 10 时不打折，仍为 100）
   *   kind 2 = 调查（16）：5000
   *   最后统一 × (limit(var_58(34,0)/1000, 1, 100) + 100) / 200   —— var_58(34) = 名声
   */
  function calcIdentifyValue(player, kind) {
    let v = 100;
    if (kind === 2) v = 5000;
    if (kind === 1) {
      let weight = 0;
      for (const it of (player.inv || [])) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        if ((it.f[8] | 0) >= 3) continue;
        weight += (it.f[8] | 0) === 1 ? 1 : 10;
      }
      if (weight >= 10) v = idiv(v * weight * 7, 100);
    }
    const fame = player.get(34) | 0;
    v = idiv(v * (limit(idiv(fame, 1000), 1, 100) + 100), 200);
    // 214737-214740：战士公会成员鉴定费减半（var_65(264)）
    const g = Elona.game;
    if (Elona.Guild && g && Elona.Guild.isMember(g, Elona.Guild.FIGHTER)) v = idiv(v, 2);
    return Math.max(1, v);
  }

  /** 未鉴定的物品列表（f[8] < 3） */
  function unknownItems(player) {
    const out = [];
    for (const it of (player.inv || [])) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if ((it.f[8] | 0) < 3) out.push(it);
    }
    return out;
  }

  /**
   * 单件鉴定（14）/ 调查（16）—— 原版 416812-416879：
   *   扣 calcidentifyvalue(0|2) → 走鉴定效果（14 强度 250、16 强度 1000）
   *   → 强度 >= 物品的 var_99(29)（鉴定难度）时完全鉴定，否则无变化。
   * @param {number} roll 250（鉴定）或 1000（调查）
   */
  function identifyOne(g, npc, player, idx, roll) {
    const it = (player.inv || [])[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item', message: '没有这件物品。' };
    if ((it.f[8] | 0) >= 3) return { ok: false, reason: 'known', message: '这件物品已经完全鉴定过了。' };
    const kind = (roll | 0) >= 1000 ? 2 : 0;
    const cost = calcIdentifyValue(player, kind);
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    const lv = (Elona.ItemDB && Elona.ItemDB.identify)
      ? Elona.ItemDB.identify(it, -1, roll | 0) : 0;
    if (!lv) {
      return { ok: true, cost, level: 0,
        message: `支付 ${cost} gold，但知识还不够——还需要「调查」才能查明。` };
    }
    return { ok: true, cost, level: lv,
      message: `支付 ${cost} gold，物品完全鉴定了。` };
  }

  /** 调查（16）：强度 1000 的单件鉴定 */
  function investigate(g, npc, player, idx) {
    return identifyOne(g, npc, player, idx, 1000);
  }

  /** 全部鉴定（15）—— 原版 416830-416855 */
  function identifyAll(g, npc, player) {
    const unknown = unknownItems(player);
    if (!unknown.length) {
      return { ok: false, reason: 'nothing', message: '「你没有需要鉴定的东西。」' };
    }
    const cost = calcIdentifyValue(player, 1);
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `鉴定需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    let n = 0, full = 0;
    for (const it of unknown) {
      const lv = (Elona.ItemDB && Elona.ItemDB.identify)
        ? Elona.ItemDB.identify(it, -1, 250) : 0;
      n++;
      if (lv >= 3) full++;
      if (Elona.ItemDB && Elona.ItemDB.stack) Elona.ItemDB.stack(player, player.inv.indexOf(it));
    }
    return { ok: true, cost, count: n, full,
      message: `${n} 件未判明物品中，${full} 件完全判明了（支付 ${cost} gold）。` };
  }

  /** 兼容旧接口：identify = 全部鉴定 */
  function identify(g, npc, player) {
    return identifyAll(g, npc, player);
  }

  /**
   * 训练可选的技能（只列有潜力的技能）
   * 0-Z21：源码的列表按排序键 `var_83(0,id)+21000` 冒泡（label_2821），
   *   即组内按关联属性升序、同属性按 id 升序，而不是按潜力高低。
   */
  function trainableSkills(player) {
    const out = [];
    const seen = {};
    for (const key in SKILL_NAMES) {
      const id = parseInt(key, 10);
      if (!(id >= 10 && id <= 19) && !(id >= 100 && id <= 189)) continue;
      if (seen[id]) continue;
      seen[id] = 1;
      const pot = Elona.Stats && Elona.Stats.sorg ? Elona.Stats.sorg(player, id) : 0;
      const exp = Elona.Stats && Elona.Stats.sexp ? Elona.Stats.sexp(player, id) : 0;
      if (pot <= 0 && exp <= 0) continue;
      out.push({ id, name: skillName(id), potential: pot });
    }
    const attr = (SKILL_SHOP && SKILL_SHOP.attr) || {};
    out.sort((a, b) => ((attr[String(a.id)] | 0) - (attr[String(b.id)] | 0)) || (a.id - b.id));
    return out.slice(0, 40);
  }

  /** 训练费用 —— calctraincost（214742-214747）：limit(sorg/40+1, 2, 5) 白金币 */
  function trainCost(player, skillId, friend) {
    let cost = limit(idiv(Elona.Stats.sorg(player, skillId), 40) + 1, 2, 5);
    if (friend) cost = idiv(cost, 2);
    return Math.max(1, cost);
  }

  /** 训练 —— 425205-425230：扣白金币，modgrowth +100（朋友价 +120 未实现） */
  function train(g, player, skillId, npc) {
    if (!skillId) return { ok: false, reason: 'no-skill', message: '没有可训练的技能。' };
    const cost = trainCost(player, skillId, false);
    if ((player.get(31) | 0) < cost) {
      return { ok: false, reason: 'platinum', cost, message: `需要 ${cost} 枚白金币。` };
    }
    player.set(31, player.get(31) - cost);
    if (Elona.Stats && Elona.Stats.modGrowth) {
      Elona.Stats.modGrowth(player, skillId, player, 100, g);
    }
    return { ok: true, cost, skillId,
      message: `${skillName(skillId)} 的潜力提升了（-${cost} 白金币）。` };
  }

  /**
   * 训练师可教的「未习得」技能（原版菜单 30「新しいスキルを覚えたい」）。
   *
   * 【A181】*label_2777 / *label_2778（292183-292585）：
   *   - 武器熟练（100..111）不分场景，未习得且在库里就列出（293358-293368 mode-3 分支）；
   *   - 特殊能力（150..190、300/301）按**当前场景**过滤：恒定 159/173，
   *     再按 var_65(20)（地图 id）＋ var_65(22)（子图 id，仅 11/14/36 有分册）
   *     追加场景列表（数据由 tools/extract_skillshop.py 提取到 skillshop.json）；
   *   - 过滤条件与源码一致：未习得（sorg==0；项目侧同时看 sexp，见下）且
   *     var_83(0,id) != 0（在技能库 —— skillshop.json 的 attr 列）；
   *   - 显示顺序 = 源码菜单排序键 var_83(0,id)+31000（武器组）/ +21000（特殊组），
   *     即按关联主属性升序。
   *
   * 兼容：旧签名 learnableSkills(player)（无场景信息）仍可用 —— 只出武器组＋恒定组。
   */
  function learnableSkills(g, player) {
    if (player === undefined) { player = g; g = null; }   // 旧调用风格
    const shop = SKILL_SHOP;
    const isLearned = (id) => {
      const pot = Elona.Stats && Elona.Stats.sorg ? Elona.Stats.sorg(player, id) : 0;
      const exp = Elona.Stats && Elona.Stats.sexp ? Elona.Stats.sexp(player, id) : 0;
      // 源码只判 sorg(id)==0；项目把等级/经验拆在 potential 定点数的两段里，
      // exp>0（还没升上 1 级）同样视为已习得，避免刚学的技能立刻再出现。
      return pot > 0 || exp > 0;
    };

    // 表缺失（测试桩没注入 / 加载失败）→ 退化为旧行为：全部未习得的 100..199
    if (!shop || !shop.attr) {
      const out0 = [];
      const seen0 = {};
      for (const key in SKILL_NAMES) {
        const id = parseInt(key, 10);
        if (!(id >= 100 && id <= 199) || seen0[id]) continue;
        seen0[id] = 1;
        if (isLearned(id)) continue;
        out0.push({ id, name: skillName(id), key: 30000 + id });
      }
      out0.sort((a, b) => a.id - b.id);
      return out0.slice(0, 60);
    }

    const attr = shop.attr;
    const inDb = (id) => (attr[String(id)] | 0) !== 0;

    const out = [];
    // ◆ 武器熟练（293358-293368：repeat 100..149，mode 3 → 未习得且在库；
    //   var_83 只给 100..111 定义了关联属性，112..149 自然被滤掉）
    const weapon = [];
    for (let id = 100; id <= 149; id++) {
      if (!inDb(id) || isLearned(id)) continue;
      weapon.push({ id, name: skillName(id), key: 31000 + (attr[String(id)] | 0) });
    }
    weapon.sort((a, b) => (a.key - b.key) || (a.id - b.id));   // drawmenu 按键排序
    for (const e of weapon) out.push(e);
    // ◆ 特殊能力（菜单键 var_83(0,id) + 21000）
    const seen = {};
    const special = [];
    const collect = (ids) => {
      for (const id of ids) {
        if (seen[id]) continue;
        seen[id] = 1;
        if (!inDb(id) || isLearned(id)) continue;
        special.push({ id, name: skillName(id), key: 21000 + (attr[String(id)] | 0) });
      }
    };
    collect(shop.learn && shop.learn.default ? shop.learn.default : []);
    const mapId = g && g.getV65 ? (g.getV65(20) | 0) : 0;
    const subId = g && g.getV65 ? (g.getV65(22) | 0) : 0;
    if (mapId > 0 && shop.learn && Array.isArray(shop.learn.scenes)) {
      for (const sc of shop.learn.scenes) {
        if ((sc.map | 0) !== mapId) continue;
        if (sc.sub !== null && sc.sub !== undefined && (sc.sub | 0) !== subId) continue;
        collect(sc.ids || []);
      }
    }
    special.sort((a, b) => (a.key - b.key) || (a.id - b.id));
    for (const e of special) out.push(e);
    return out.slice(0, 60);
  }

  /**
   * 学习新技能（原版菜单 30）。
   * 费用 calclearncost（214748-214753）：**固定 5 白金币**（第三参数非 0 时才是 5*2/3=3）。
   *   0-HT 考证：原版并没有「按技能种类/等级算价」的公式，旧 A194 的描述有误；
   *   425194/425218 走两参数调用（prm_1060=0），本实现的 5 白金币与源码一致。
   */
  function learnSkill(g, player, skillId, npc) {
    if (!skillId) return { ok: false, reason: 'no-skill', message: '没有可以学的技能。' };
    const pot = Elona.Stats ? Elona.Stats.sorg(player, skillId) : 0;
    const exp = Elona.Stats ? Elona.Stats.sexp(player, skillId) : 0;
    if (pot > 0 || exp > 0) return { ok: false, reason: 'known', message: '你已经会这个技能了。' };
    const cost = 5;
    if ((player.get(31) | 0) < cost) {
      return { ok: false, reason: 'platinum', cost, message: `需要 ${cost} 枚白金币。` };
    }
    player.set(31, player.get(31) - cost);
    if (Elona.Stats && Elona.Stats.skillGain) {
      Elona.Stats.skillGain(player, player.index | 0, skillId, 1, 0, g);
    }
    return { ok: true, cost, skillId,
      message: `习得了 ${skillName(skillId)}（-${cost} 白金币）。` };
  }

  /**
   * 装备解咒（原版菜单 62「装備中のアイテム解呪」）—— 421726-421747。
   * 费用 calcrestorecostc（214781-214786）：limit((名声+1)/100*200, 300, 3000)，战士公会半价。
   *   0-HT：HSP 的整数除法是**先 (名声+1)/100 再 ×200**（阶梯式），不是 (名声+1)*200/100；
   *   旧实现把两步合成一步，fame=150 时会算出 302 而原版是 300，故按源码拆开。
   * 效果 *label_2960 的 412 分支（320622-320657）：强度 5000；
   *   诅咒 -1 需 rnd(200)+1、-2 需 rnd(1000)+1，强度 ≥ 需求即解咒。
   * 原版对**全队**成员的装备生效。
   */
  function uncurseEquip(g, npc, player) {
    const fame = player.get(34) | 0;
    let cost = limit(idiv(fame + 1, 100) * 200, 300, 3000);
    if (v65(g, 264)) cost = idiv(cost, 2);
    const cursed = [];
    for (const c of (g.charas || [])) {
      if (!c || c.get(0) !== 1 || c.index >= 16) continue;
      for (const it of (c.inv || [])) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        if (it.eqSlot === undefined || it.eqSlot < 0) continue;
        if ((it.f[17] | 0) < 0) cursed.push(it);
      }
    }
    if (!cursed.length) {
      return { ok: false, reason: 'nothing', cost, message: '「你的装备没有被诅咒。」' };
    }
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `解咒需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    const R = (n) => ((g && g.rng) ? g.rng : Elona.rng).rnd(n);
    let ok = 0, resist = 0;
    for (const it of cursed) {
      const need = (it.f[17] | 0) === -2 ? R(1000) + 1 : R(200) + 1;
      if (5000 >= need) { it.f[17] = 0; ok++; }
      else resist++;
    }
    return { ok: true, cost, count: ok, resisted: resist,
      message: ok
        ? `解除了 ${ok} 件装备的诅咒${resist ? `（${resist} 件抵抗了）` : ''}，支付 ${cost} gold。`
        : `「这次的诅咒太强了……」(${resist} 件抵抗，支付 ${cost} gold)` };
  }

  // ======================================================================
  // 0-CC：魔法库存交换（158/159）、魔法实习（75）、情报屋（98/105）、
  //       街长（74/141）、商人以物易物（20）
  // ======================================================================

  /**
   * 魔法库存交换（原版 158 单项 / 159 全部）—— 422475-422565：
   *   把不需要的魔法库存「减半」，按 stock/200 换成**充填用魔力 var_65(25)**（422500 / 422554）。
   *   特殊：spell 465 的换算 ×5、441 的换算 ×50。
   *   159 的扫描范围是 400..491（422515 `repeat 492-400`），减半时用 `<= 200` 跳过（422561）。
   * @param {number} [spellId] 指定魔法（159 全部时忽略）
   */
  function magicStockExchange(g, npc, player, spellId, all) {
    const st = player.spellStock;
    if (!st) return { ok: false, message: '你没有魔法库存。' };
    let gain = 0, n = 0;
    const v25 = (g && g.getV65) ? (g.getV65(25) | 0) : 0;
    if (all) {
      for (let i = 0; i <= 91; i++) {                    // 422515：400..491
        const stock = st[i] | 0;
        if (stock < 200) continue;
        let v = idiv(stock, 200);
        if (i + 400 === 465) v *= 5;
        if (i + 400 === 441) v *= 50;
        gain += v;
        n++;
      }
      if (gain < 10) {
        return { ok: false, message: '「再多攒一些库存再来吧。」' };
      }
      for (let i = 0; i <= 91; i++) {
        if ((st[i] | 0) <= 200) continue;                // 422561
        st[i] = idiv(st[i] | 0, 2);
      }
    } else {
      const i = (spellId | 0) - 400;
      if (i < 0 || i >= 200 || (st[i] | 0) <= 0) {
        return { ok: false, message: '没有这个魔法的库存。' };
      }
      if ((st[i] | 0) < 200) {
        return { ok: false, message: '「库存太少了，至少要 200。」' };
      }
      let v = idiv(st[i] | 0, 200);
      if (spellId === 465) v *= 5;
      if (spellId === 441) v *= 50;
      gain = v;
      st[i] = idiv(st[i] | 0, 2);                        // 422499
      n = 1;
    }
    if (g && g.setV65) g.setV65(25, v25 + gain);          // 422500 / 422554
    const pool = (g && g.getV65) ? (g.getV65(25) | 0) : (v25 + gain);
    return { ok: true, gain, pool, count: n,
      message: `用 ${n} 种魔法库存换来了 ${gain} 点充填魔力（当前 ${pool}）。` };
  }

  /**
   * 魔法实习（原版菜单 75，422572-422703）—— 0-HT 按源码逐行移植，替换旧的
   * 「900 gold + 魔力/咏唱潜力」近似（A198b）。
   *
   * 源码流程：
   *   ① 422572-422596 列出 6 种实习，选中结果存 var_2732；
   *   ② 422600-422635 扫 400..491，只处理**库存 > 0**（var_495(cnt-400)）且
   *      满足该实习筛选条件的法术，累计 var_2614 += var_82(cnt, 0)（玩家法术技能等级）；
   *   ③ 422636 `var_2614 = limit((var_2614+1)/150 + 3, 4, 10) / 2` —— 单位是**白金币**
   *      （var_58(31,0)），不是 gold；HSP 整数除法分两步，故 4..10 → 2..5 枚；
   *   ④ 422597 `var_65(175) = 11111111`（结束时 422702 清 0）—— 这个开关会关掉
   *      skillExp 里「玩家持天赋 428 时法术经验 ×3」的加成，必须一并复现；
   *   ⑤ 422648-422683 确认后对每个入围法术 `skillexp cnt, 0, 1000 + var_82(14,0)*2`；
   *   ⑥ 422684 扣白金币、422685 `snd 61`。
   *
   * 筛选条件里的 `&` / `|` 是 HSP 的 AND / OR（`&` 优先），逐条翻成布尔式：
   *   1 (攻击)      type ∈ {1, 2}
   *   2 (上位攻击)  (type == 3 或 id == 465) 且 id != 404
   *   3 (付与)      type/1000 == 1
   *   4 (回复)      type == 4 或 id ∈ {406,407,412,404,439,440,461}
   *   5 (特殊)      type == 7 或 id ∈ {454,456,455,437,472,436,413,435}
   *   6 (探索)      type ∈ {5, 0} 且 id 不在下面 K6 的排除表
   */
  // 0-Z23：魔法实习二级菜单文案中文化（源码 422572-422595 的六类实习）。
  const PRACTICE = [
    { id: 1, label: '咒术师实习（攻击魔法）' },
    { id: 2, label: '术士实习（上位攻击魔法）' },
    { id: 3, label: '附魔师实习（赋予魔法）' },
    { id: 4, label: '治愈师实习（回复魔法）' },
    { id: 5, label: '萨满实习（特殊魔法）' },
    { id: 6, label: '法师实习（探索魔法）' },
  ];
  const PRACTICE_K4 = [406, 407, 412, 404, 439, 440, 461];
  const PRACTICE_K5 = [454, 456, 455, 437, 472, 436, 413, 435];
  const PRACTICE_K6 = [464, 441, 406, 407, 412, 439, 440, 461, 465,
    454, 456, 455, 437, 472, 436, 413, 435];

  /** var_83(1, id) —— 法术动作类型码，来自 actions.json（core/spell.js 的 field） */
  function spellType(id) {
    return (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(id, 1) | 0) : 0;
  }
  function practiceMatch(kind, id) {
    const t = spellType(id);
    switch (kind | 0) {
      case 1: return t === 1 || t === 2;
      case 2: return (t === 3 || id === 465) && id !== 404;
      case 3: return idiv(t, 1000) === 1;
      case 4: return t === 4 || PRACTICE_K4.indexOf(id) >= 0;
      case 5: return t === 7 || PRACTICE_K5.indexOf(id) >= 0;
      case 6: return (t === 5 || t === 0) && PRACTICE_K6.indexOf(id) < 0;
      default: return false;
    }
  }
  /** 422600-422635：本实习覆盖的法术（库存 > 0 才算） */
  function practiceSpells(player, kind) {
    const out = [];
    if (!player || !player.spellStock) return out;
    for (let id = 400; id < 492; id++) {
      if ((player.spellStock[id - 400] | 0) <= 0) continue;
      if (practiceMatch(kind, id)) out.push(id);
    }
    return out;
  }
  /** 422636：费用 = limit((Σ技能+1)/150+3, 4, 10)/2（白金币） */
  function practiceCost(player, ids) {
    let sum = 0;
    for (const id of ids) sum += player.skill(id) | 0;
    return idiv(limit(idiv(sum + 1, 150) + 3, 4, 10), 2);
  }
  /** 给 UI 的报价（原版 422645 会先显示「这次实习要 N 枚白金币」再确认） */
  function practiceQuote(player, kind) {
    const ids = practiceSpells(player, kind);
    return { kind: kind | 0, spells: ids.slice(), cost: practiceCost(player, ids) };
  }
  function magicPractice(g, npc, player, kind) {
    const k = kind | 0;
    if (k < 1 || k > 6) return { ok: false, message: '没有这种实习。' };
    const ids = practiceSpells(player, k);
    const cost = practiceCost(player, ids);
    if ((player.get(31) | 0) < cost) {
      return { ok: false, reason: 'platinum', cost,
        message: `这次实习需要 ${cost} 枚白金币。` };
    }
    player.set(31, (player.get(31) | 0) - cost);
    const exp = 1000 + (player.skill(14) | 0) * 2;        // 422682
    let trained = 0;
    setV65(g, 175, 11111111);                              // 422597：关掉法术经验 ×3
    try {
      if (Elona.Stats && Elona.Stats.skillExp) {
        for (const id of ids) {
          Elona.Stats.skillExp(player, id, 0, exp, 0, 0, g);  // skillexp cnt, 0, exp
          trained++;
        }
      }
    } finally {
      setV65(g, 175, 0);                                  // 422702
    }
    const label = (PRACTICE.find((x) => x.id === k) || {}).label || '实习';
    return { ok: true, cost, kind: k, spells: ids.slice(), trained,
      sounds: [61],                                          // 422685 snd 61
      message: `接受了${label}（-${cost} 白金币，${trained} 种魔法得到练习）。` };
  }

  /**
   * 情报屋：Boss 情报（原版菜单 98，422767-424970，0-HY 改为跑源码脚本）
   *
   * 这一段在源码里是一串顺序 `if ( var_506 == N )` 的菜单处理器（410743-425316），
   * 已由 tools/extract_talk_scripts.py 的 EXTRA_RANGES 编进 talkscripts.json。
   * 原版进入方式就是「选完菜单项 → var_506 = 98 → 顺序落到对应 if」，
   * 所以这里用 `Dialogue.startAtLine(422767)` + `var506 = 98` 起跑，
   * 收费（`var_58(30,0) -= 300`）、`var_65(250+2)` 进度闸门、40 个情报分支
   * 与「（继续）」翻页全按源码执行，不再自己造一份文案。
   */
  function bossInfo(g, npc, player) {
    const D = Elona.Dialogue;
    if (!D || typeof D.startAtLine !== 'function') {
      return { ok: false, message: '（对话表还没准备好。）' };
    }
    const s = D.startAtLine(g, npc, 422767, { player, lang: 'jp', var506: 98 });
    if (!s) return { ok: false, message: '（找不到 422767 的脚本。）' };
    return { ok: true, action: 'boss-info', session: s };
  }

  /** 情报屋：传闻（原版 105「冒险者への伝言」，2000 gold）—— 单机实现为随机传闻 */
  function rumor(g, npc, player) {
    const cost = 2000;
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `传闻需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    const pool = [
      '「听说北边的洞窟深处有珍稀的矿石。」',
      '「最近镇上来了个可疑的商人，别被他骗了。」',
      '「地下城里越是深处，怪物越强，但宝物也越好。」',
      '「有空多跟镇上的人聊聊，好感高了会有好事。」',
      '「诅咒的装备最好找治疗师解咒，不然会拖累你。」',
      '「训练师那里可以用白金币提升技能潜力。」',
    ];
    const pickIdx = R(pool.length);
    return { ok: true, cost, message: `（支付 ${cost} gold）` + pool[pickIdx] };
  }

  /**
   * 街长：管理代行者的人气（原版动作 141，419633-419664）。
   *
   * 源码：`repeat 245` 求和 `var_58(17)`（好感/人气度），跳过
   *   cnt < 16、`var_58(150)==0`（空槽/无角色类型）、`cbit(992)`（已消失）、
   *   `var_58(150)==13`（商人）、`cbit(971)`（店主？）。
   * 【0-HX 更正】旧实现用「店铺投资 / 1000 + 名声 / 100」推算，属自拟；现在逐槽求和。
   */
  function popularity(g, npc, player) {
    const list = (g && g.charas) || [];
    const cb = (c, bit) => !!(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, bit));
    let pop = 0;
    for (let i = 16; i < 245; i++) {
      const c = list[i];
      if (!c) continue;
      if ((c.get(150) | 0) === 0) continue;
      if (cb(c, 992)) continue;
      if ((c.get(150) | 0) === 13) continue;
      if (cb(c, 971)) continue;
      pop += c.get(17) | 0;
    }
    return { ok: true, popularity: pop,
      message: `「现在的人气度大概是 ${pop} 的样子。只要做让大家高兴的事就会上升，`
        + '不过有时也得做讨人厌的事……」' };
  }

  /**
   * 街长：街道管理（原版菜单 74，422086-422500，0-HY 改为跑源码脚本）
   *
   * 源码这一段是完整的三级菜单：
   *   1 政策实施（选民追加投票权 发言力50 / 当地吉祥物 运营预算200 / 定期维持的停止·再开）
   *   2 法律整备（狼人防止法 发言力500 / 狼人共生法 750 / 准备中）
   *   3 周边设施的建设（开发中）
   * 效果全落在**地图头** `var_126(...)`（发言力 26 / 维持费 27·30 / 观光收入 25 / 运营预算 32），
   * 与 towns.js 的城镇参数同源。旧实现是自己凑的一页只读信息（投资/店铺/委托/日期），
   * 与源码无关，已删除。
   *
   * 仍缺（如实登记 A198d）：`var_126(22/23/24/28)` 的城镇初始值
   * （246254-246358 按 var_132(28) 分档）与「每日维护结算」（350954 每日 +200 …）——
   * 没有它们，政策能开关但收益/维护不随时间滚动。
   */
  function townManage(g, npc, player) {
    const D = Elona.Dialogue;
    if (!D || typeof D.startAtLine !== 'function') {
      return { ok: false, message: '（对话表还没准备好。）' };
    }
    const s = D.startAtLine(g, npc, 422086, { player, lang: 'jp', var506: 74 });
    if (!s) return { ok: false, message: '（找不到 422086 的脚本。）' };
    return { ok: true, action: 'town-manage', session: s };
  }

  /**
   * 商店 NPC：以物易物（原版 20「アイテム交換」，416925）
   * 简化：把玩家选中的一件物品交给商人，换回一件同类别的随机物品。
   */
  function barter(g, npc, player, idx) {
    const inv = player.inv || [];
    const it = inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, message: '没有这件物品。' };
    if (it.eqSlot >= 0) return { ok: false, message: '装备中的物品不能交换。' };
    const cat = Elona.ItemDB ? Elona.ItemDB.ref(it.id, 5) : 0;
    const name = Elona.ItemDB ? Elona.ItemDB.name(it) : ('item ' + it.id);
    // 优先拿商人背包里的物品交换；没有库存时才用 ItemDB.create 兜底
    let got = null;
    const kInv = npc.inv || [];
    for (let k = 0; k < kInv.length; k++) {
      const cand = kInv[k];
      if (!cand || (cand.f[0] | 0) <= 0 || cand.eqSlot >= 0) continue;
      got = cand;
      kInv[k] = null;
      break;
    }
    if (!got && Elona.ItemDB && Elona.ItemDB.create) {
      got = Elona.ItemDB.create(g, { level: Math.max(1, (player.level | 0) + 2), fix: 2 });
    }
    if (!got) {
      return { ok: false, message: '「抱歉，现在没有能和你交换的东西。」' };
    }
    it.f[0] = 0;                                  // 交出
    got.f[0] = 1; got.eqSlot = -1;
    const slot = inv.indexOf(it);
    if (slot >= 0) inv[slot] = got; else inv.push(got);
    if (Elona.ItemDB.stack) Elona.ItemDB.stack(player, slot >= 0 ? slot : inv.length - 1);
    const gotName = Elona.ItemDB.name(got);
    return { ok: true, gave: name, got: gotName, cat,
      message: `你用 ${name} 换到了 ${gotName}。` };
  }

  /**
   * 治疗师「能力の復元」（原版菜单 19，415428-415430 / 416899-416923）。
   *
   * 【源码】var_396 = 439（肉体復活）→ *label_2960，随后 var_400 = 10,11,12,17,18；
   *        var_396 = 440（精神復活）→ 同样处理后 var_400 = 14,13,16,15,19；
   *        两段共同执行 324939-324956：`var_58(240+属性-10)`（能力損傷）负值归零。
   * 费用 calcrestorecost()（214775-214780）：500 gold，战士公会（var_65(264)）半价。
   * 【更正】旧实现回满 HP/MP 并解除异常 —— 那不是治疗师的功能，已改为复原八维损伤。
   */
  function heal(g, player, npc) {
    let cost = 500;
    if (v65(g, 264)) cost = idiv(cost, 2);
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `能力复原需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    let n = 0, fixed = 0;
    for (const c of (g.charas || [])) {
      if (!c || c.get(0) !== 1) continue;
      if (c.index >= 16) continue;                     // 只处理队伍成员
      n++;
      for (let i = 0; i < 10; i++) {                   // 240..249 对应属性 10..19
        if ((c.get(240 + i) | 0) < 0) { c.set(240 + i, 0); fixed++; }
      }
    }
    // 324953-324955：圣化（var_2362 >= 1）会额外给 +sorg/10+5 —— 治疗师固定强度 100，不触发
    return { ok: true, cost, count: n, fixed,
      message: fixed
        ? `能力复原完成（${n} 人，恢复 ${fixed} 项损伤），支付 ${cost} gold。`
        : `「你们的身体并没有什么损伤。」（支付 ${cost} gold）` };
  }

  // ======================================================================
  // 武具店（角色 1000 / 1001）—— 415329-415341 的四个菜单项
  // ======================================================================

  /** 强化费用 —— 421754-421755：limit((f20+1)² × √(f20+1) × 300 + 1000, 1000, 500000) */
  function enhanceCost(it) {
    const n = (it.f[20] | 0) + 1;
    let v = Math.floor(n * n * Math.sqrt(n) * 300 + 1000);
    return limit(v, 1000, 500000);
  }
  /** 强化 —— 421748-421796：f20 > 9 拒绝；扣钱后 f20 += 1 */
  function enhance(g, player, idx) {
    const it = player.inv && player.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, message: '没有这件装备。' };
    if ((it.f[20] | 0) > 9) return { ok: false, message: '「这个已经没法再强化了。」' };
    const cost = enhanceCost(it);
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `强化需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    it.f[20] = (it.f[20] | 0) + 1;
    const name = Elona.ItemDB ? Elona.ItemDB.name(it) : ('item ' + it.id);
    return { ok: true, cost, level: it.f[20],
      message: `${name} 被强化了（+${it.f[20]}，-${cost} gold）。` };
  }

  /** 特殊弹容量 —— var_651(1, 0..5)（26255-26260） */
  const AMMO_MAX = [70, 20, 30, 40, 5, 10];
  const AMMO_NAMES = ['连射弹', '炸裂弹', '贯通弹', '魔弹', '时停弹', '爆发弹'];

  /** 列出一件弹药上的特殊弹槽（f[40+2n] = 9*10000+子类，f[41+2n] = 次数*1000+强度） */
  function ammoSlots(it) {
    const out = [];
    for (let n = 0; n < 15; n++) {
      const e0 = it.f[40 + n * 2] | 0;
      if (e0 === 0) break;
      if (idiv(e0, 10000) !== 9) continue;
      const sub = e0 % 10000;
      const e1 = it.f[40 + n * 2 + 1] | 0;
      const cur = idiv(e1, 1000);
      const str = e1 % 1000;
      const max = AMMO_MAX[sub] || 0;
      if (max <= 0) continue;
      out.push({ slot: n, sub, cur, max, str, name: AMMO_NAMES[sub] || ('弹' + sub) });
    }
    return out;
  }

  /** 队伍里所有持有弹药的成员（玩家 + 队伍成员） */
  function ammoOwners(g) {
    const out = [];
    if (g.player) out.push(g.player);
    for (let i = 1; i < 16; i++) {
      const c = g.charas && g.charas[i];
      if (c && c.get(0) === 1) out.push(c);
    }
    return out;
  }

  /**
   * 矢弹充填费用 —— calccostreload（214625-214693）。
   * 每缺 1 发计 `50 + 类型² × 10`（类型固定 9 → 860），最后 `/2 + 1`。
   */
  function reloadPlan(g) {
    const rows = [];
    let total = 0;
    for (const c of ammoOwners(g)) {
      for (const it of (c.inv || [])) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        if (Elona.ItemDB.ref(it.id, 5) !== 25000) continue;
        for (const s of ammoSlots(it)) {
          const need = Math.max(0, s.max - s.cur);
          if (!need) continue;
          rows.push({ owner: c, item: it, slot: s, need });
          total += need * (50 + 9 * 9 * 10);
        }
      }
    }
    const cost = total > 0 ? idiv(total, 2) + 1 : 0;
    return { rows, cost };
  }

  /**
   * 矢弹充填 —— 421461-421491。
   * 同一张地图只能充填一次（var_132(37, 地图) == 100）；离开地图后重置。
   */
  function reload(g, player) {
    const mapId = v65(g, 20);
    if (g.shopReloadMap === mapId) {
      return { ok: false, message: '「今天已经补充过了，明天再来吧。」（离开这张地图后才能再次充填）' };
    }
    const plan = reloadPlan(g);
    if (!plan.cost) return { ok: false, message: '「你没有什么需要补充的矢弹。」' };
    if ((player.get(30) | 0) < plan.cost) {
      return { ok: false, reason: 'money', cost: plan.cost, message: `充填需要 ${plan.cost} gold。` };
    }
    player.set(30, player.get(30) - plan.cost);
    let n = 0;
    for (const r of plan.rows) {
      r.item.f[40 + r.slot.slot * 2 + 1] = r.slot.max * 1000 + r.slot.str;
      n += r.need;
    }
    g.shopReloadMap = mapId;
    return { ok: true, cost: plan.cost, rounds: n,
      message: `补充了 ${n} 发特殊矢弹（-${plan.cost} gold）。` };
  }

  /** 轻量化 —— 421816-421883：0.1s = 12000 gold，f7 -= 100（下限 10） */
  function lighten(g, player, idx, units) {
    const it = player.inv && player.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, message: '没有这件装备。' };
    const u = limit(units | 0, 1, 10);
    const cost = 12000 * u;
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `轻量化需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    it.f[7] = Math.max(10, (it.f[7] | 0) - 100 * u);
    const name = Elona.ItemDB ? Elona.ItemDB.name(it) : ('item ' + it.id);
    return { ok: true, cost, weight: it.f[7],
      message: `${name} 变轻了 ${(u / 10).toFixed(1)}s（现在 ${((it.f[7] | 0) / 1000).toFixed(1)}s，-${cost} gold）。` };
  }

  /** 重量化 —— 421885-421955：0.1s = 4000 gold，f7 += 100（上限 100s） */
  function heavify(g, player, idx, units) {
    const it = player.inv && player.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, message: '没有这件装备。' };
    if ((it.f[7] | 0) > 100000) return { ok: false, message: '「这个已经没法再加重了。」' };
    const u = limit(units | 0, 1, 10);
    const cost = 4000 * u;
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `重量化需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    it.f[7] = (it.f[7] | 0) + 100 * u;
    const name = Elona.ItemDB ? Elona.ItemDB.name(it) : ('item ' + it.id);
    return { ok: true, cost, weight: it.f[7],
      message: `${name} 变重了 ${(u / 10).toFixed(1)}s（现在 ${((it.f[7] | 0) / 1000).toFixed(1)}s，-${cost} gold）。` };
  }

  // ======================================================================
  // 旅店 / 酒吧的「特别菜单」（83 / 112）—— 消耗青铜币（物品 1041）
  // ======================================================================
  function findItemSlot(c, id) {
    const inv = (c && c.inv) || [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (it && (it.f[0] | 0) > 0 && (it.id | 0) === (id | 0)) return i;
    }
    return -1;
  }
  function consumeItem(c, id, n) {
    let left = n | 0;
    const inv = c.inv || [];
    for (let i = 0; i < inv.length && left > 0; i++) {
      const it = inv[i];
      if (!it || (it.f[0] | 0) <= 0 || (it.id | 0) !== (id | 0)) continue;
      const take = Math.min(left, it.f[0] | 0);
      it.f[0] -= take;
      left -= take;
      if (it.f[0] <= 0) inv[i] = null;
    }
    return left === 0;
  }
  /** 可接受特别菜单的队伍成员（415896 / 416026 的条件） */
  function mealTargets(g) {
    const out = [];
    for (let i = 0; i < 16; i++) {
      const c = g.charas && g.charas[i];
      if (!c || c.get(0) !== 1) continue;
      if ((c.get(251) | 0) !== 0 || (c.get(256) | 0) >= 60) continue;
      if ((c.get(253) | 0) !== 0 || (c.get(252) | 0) !== 0) continue;
      if ((c.get(263) | 0) !== 0 || (c.get(269) | 0) !== 0) continue;
      out.push(c);
    }
    return out;
  }
  function applyGrowthBuff(g, c, id, power) {
    if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, c, id, power, 5000, c);
    if (Elona.BuffEffects) Elona.BuffEffects.apply(c, id, power);
  }
  /** 旅店「スペシャルメニュー」（415864-415926）：青铜币 1 枚，满腹度 < 15000 */
  function specialMeal(g, npc, player) {
    if (findItemSlot(player, 1041) < 0) {
      return { ok: false, reason: 'no-coin', message: '「需要一枚青铜币。」' };
    }
    if ((player.get(22) | 0) >= 15000) {
      return { ok: false, reason: 'full', message: '「你看起来并不饿。」' };
    }
    consumeItem(player, 1041, 1);
    const list = mealTargets(g);
    for (const c of list) {
      c.set(79, 603);                                   // 415902
      for (let id = 20; id <= 28; id++) applyGrowthBuff(g, c, id, 15);
      if ((c.get(22) | 0) < 15000) c.set(22, 15000);
      if (Elona.Vomit && Elona.Vomit.charaAnorexia) Elona.Vomit.charaAnorexia(c);
    }
    return { ok: true, count: list.length,
      message: `特别的料理！全队 ${list.length} 人获得了主属性成长率提升的加护（5000 回合）。` };
  }
  /** 酒吧「スペシャルメニュー」（415965-416066）：青铜币 1 枚，水分 < 15000 */
  function specialDrink(g, npc, player) {
    if (findItemSlot(player, 1041) < 0) {
      return { ok: false, reason: 'no-coin', message: '「需要一枚青铜币。」' };
    }
    if ((player.get(446) | 0) >= 15000) {
      return { ok: false, reason: 'thirsty', message: '「你看起来并不渴。」' };
    }
    consumeItem(player, 1041, 1);
    const list = mealTargets(g);
    for (const c of list) {
      c.set(79, 603);
      applyGrowthBuff(g, c, 67, 10);                    // 全技能成长率 +10%（calcbuff 644-657）
      c.set(446, 15000);
      if ((c.get(22) | 0) < 14000) c.set(22, (c.get(22) | 0) + 1000);
    }
    return { ok: true, count: list.length,
      message: `特别饮品！全队 ${list.length} 人的技能成长率提升了（5000 回合）。` };
  }

  // ======================================================================
  // 情报屋（角色 8）—— 生日（82）/ 冒险者情报（18）/ 传话（105）
  // ======================================================================

  /** 生日 —— 420776-420878：var_65(250+322)=月，250+323=日；设定后不可更改 */
  function birthday(g) {
    return { month: v65(g, 572), day: v65(g, 573) };
  }
  function setBirthday(g, month, day) {
    const b = birthday(g);
    if (b.month && b.day) {
      return { ok: false, message: `「你的生日是 ${b.month} 月 ${b.day} 日，我已经记下了。」` };
    }
    const m = limit(month | 0, 1, 12), d = limit(day | 0, 1, 31);
    setV65(g, 572, m);
    setV65(g, 573, d);
    return { ok: true, month: m, day: d,
      message: `你告诉了对方生日：${m} 月 ${d} 日。` };
  }

  /** 冒险者一览 —— *label_2720（287438-287620），按名声降序 */
  function adventurers(g) {
    const out = [];
    for (const c of (g.charas || [])) {
      if (!c || c.get(0) !== 1) continue;
      if ((c.index | 0) >= 57) continue;
      out.push(c);
    }
    out.sort((a, b) => (b.get(34) | 0) - (a.get(34) | 0));
    return out;
  }
  /** 冒险者情报（18）：100 gold 查看一位冒险者的详细 */
  function adventurerInfo(g, npc, player, index) {
    const target = g.charas && g.charas[index];
    if (!target) return { ok: false, message: '找不到这位冒险者。' };
    const cost = 100;
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `情报需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    const imp = target.get(17) | 0;
    const rel = Elona.Relation ? Elona.Relation.implevel(imp) : implevel(imp);
    const mapId = target.get(80) | 0;
    return { ok: true, cost, target: target.index, friendship: imp,
      message: `${target.name}（Lv ${target.level}）\n名声 ${target.get(34) | 0}　好感 ${imp}`
        + `\n所在地：${mapId === v65(g, 20) ? '这里' : ('地图 ' + mapId)}`
        + `（-${cost} gold）` };
  }

  const ADV_MESSAGES = [
    '取消讯息', '我想和你相处', '下次请来我家', '我喜欢你！请和我一起出去冒险！',
    '请尽力而为！我支持你', '你这家伙根本没有才能',
  ];
  /** 传话（105）：2000 gold，目标不能在当前地图（287566） */
  function sendMessage(g, npc, player, index, msgId) {
    const target = g.charas && g.charas[index];
    if (!target) return { ok: false, message: '找不到这位冒险者。' };
    const cur = v65(g, 20);
    if ((target.index | 0) < 16 || ((target.get(80) | 0) === cur && (target.get(0) | 0) !== 4)) {
      return { ok: false, message: '「本人就在眼前，直接跟他说吧。」' };
    }
    const id = limit(msgId | 0, 0, 5);
    if (id !== 0) {
      if ((player.get(30) | 0) < 2000) {
        return { ok: false, reason: 'money', cost: 2000, message: '传话需要 2000 gold。' };
      }
      player.set(30, player.get(30) - 2000);
    }
    target.set(428, id);
    return { ok: true, cost: id ? 2000 : 0, target: target.index, messageId: id,
      message: id ? `把「${ADV_MESSAGES[id]}」传给了 ${target.name}（-2000 gold）。` : '取消了讯息。' };
  }
  /** 传话效果：好感与敌对状态（246142-246150 / 事件 1135 的近似） */
  function applyMessage(g, npc) {
    const id = npc.get(428) | 0;
    if (!id) return 0;
    if (id === 1) {
      if ((npc.get(9) | 0) < 0) { npc.set(9, 0); npc.set(201, 0); }
      npc.set(428, 0);
      return modImp(npc, 10, g);
    }
    if (id === 3) {
      const delta = (npc.get(17) | 0) >= 150 ? 30 : -10;
      npc.set(428, 0);
      return modImp(npc, delta, g);
    }
    return 0;
  }

  /** 魔法书预订（415531-415536 / *label_2712）：只能预订已解读过的魔法 */
  function reserveBook(g, player, spellId) {
    const sid = spellId | 0;
    if (sid < 400 || sid >= 600) return { ok: false, message: '没有这个魔法。' };
    if (!player.spellStock || (player.spellStock[sid - 400] | 0) <= 0) {
      return { ok: false, message: '「这个魔法你还没有解读过。」' };
    }
    if (!g.reservedBooks) g.reservedBooks = [];
    if (g.reservedBooks.indexOf(sid) >= 0) {
      return { ok: false, message: '「这个已经预订过了。」' };
    }
    g.reservedBooks.push(sid);
    return { ok: true, spellId: sid,
      message: '预订了魔法书。下次店铺盘点时会进货。' };
  }

  /**
   * 预订列表 / 取消预订（源码 *label_2712 予約リスト，286929-287100）。
   * var_498(2, bookId)==1 显示「入荷なし」、>1 显示「入荷予定」，点击在 1/2 间切换；
   * web 用 g.reservedBooks 数组表示「>1 已预约」，取消即从数组移除（=回到 1 已解读未预约）。
   * @returns {{list:Array<{spellId:number,name:string}>, cancelled?:number, message:string}}
   */
  function reserveList(g, spellId) {
    if (!g.reservedBooks) g.reservedBooks = [];
    if (spellId !== undefined && spellId !== null) {
      const sid = spellId | 0;
      const i = g.reservedBooks.indexOf(sid);
      if (i >= 0) {
        g.reservedBooks.splice(i, 1);
        return { list: reserveList(g).list, cancelled: sid, message: '取消了这本魔法书的预订。' };
      }
    }
    const S = Elona.Spell;
    const list = g.reservedBooks.map((sid) => {
      const nm = S && S.actionName ? S.actionName(sid | 0) : null;
      return { spellId: sid | 0, name: (nm && (nm.ch || nm.jp)) || ('魔法 ' + sid) };
    });
    return { list, message: list.length ? ('已预订 ' + list.length + ' 本。') : '目前没有预订的魔法书。' };
  }


  /** 状态摘要（对话菜单的「查看状态」） */
  function infoText(npc) {
    const r = roleOf(npc);
    return `${npc.name}\nLv ${npc.level}  HP ${npc.hp}/${npc.hpMax}` +
      (roleName(r) ? `\n职业：${roleName(r)}` : '');
  }

  /** implevel（193285-193310） */
  function implevel(imp) {
    if (imp < 10) return 0;
    if (imp < 25) return 1;
    if (imp < 40) return 2;
    if (imp < 75) return 3;
    if (imp < 100) return 4;
    if (imp < 150) return 5;
    if (imp < 200) return 6;
    if (imp < 300) return 7;
    return 8;
  }

  /**
   * 0-W0：对话窗左侧信息栏的「好感 / 興味」标签（8729-8740 的 var_258..269）。
   *
   * 原版按关系类型 var_58(441) 选表：
   *   >= 0  → var_258（通用）        ；-1 战友 → var_259；-2 挚友 → var_260；
   *   -3 对手 → var_261；-4 恋人 → var_262；-5 弟子 → var_263；-6 师父 → var_264；
   *   -7 家人 → var_265；-11 契约 → var_267；-12 宠物 → var_268；-13 仆从 → var_269。
   * 好感行用 implevel(var_58(17))（9 档），興味行用 implevel2(var_58(169))（8 档，
   * var_266 通用表；441 = -11/-12/-13 时换 var_267/268/269）。
   * 索引与源码逐项对齐：243 → implevel 7 → var_260[7]「盟友」（用户截图 #1 的衍生版
   * 把 243 写成「魂之友」，按 start.hsp 那是 300+ 的档 8，本项目按源码，见 17 册 0-W0 S1）；
   * 125 → implevel2 3 → var_266[3]「素直」，中译「坦诚」。
   * 泛用 NPC（441 >= 0）走 var_258，同数值 243 显示「伙伴」，不是档位算错。
   */
  const IMP_LABELS = {
    imp: {
      0: ['深恶痛绝', '讨厌', '烦人', '普通', '友好', '信任', '信赖', '伙伴', '★伙伴★'],
      '-1': ['深恶痛绝', '讨厌', '烦人', '普通', '友好', '信赖', '伙伴', '战友', '战士之绊'],
      '-2': ['深恶痛绝', '讨厌', '烦人', '普通', '友好', '朋友', '挚友', '盟友', '魂之友'],
      '-3': ['深恶痛绝', '讨厌', '烦人', '普通', '友好', '竞争对手', '切磋琢磨', '劲敌', '宿命之敌'],
      '-4': ['深恶痛绝', '讨厌', '烦人', '普通', '友好', '恋心', '两情相悦', '热恋', '深爱'],
      '-5': ['深恶痛绝', '讨厌', '烦人', '普通', '友好', '学生', '继承人', '比肩者', '爱徒'],
      '-6': ['深恶痛绝', '讨厌', '烦人', '普通', '友好', '老师', '师父', '敬爱', '一生之师'],
      '-7': ['深恶痛绝', '讨厌', '烦人', '普通', '友好', '家人', '亲爱的', '疼爱', '深爱'],
    },
    it: {
      0: ['（猫）', '奔放', '对等', '坦诚', '★坦诚★', '顺从', '★顺从★', '遵守'],
      '-11': ['（猫）', '奔放', '对等', '坦诚', '契约者', '专属契约', '伙伴', '命运与共'],
      '-12': ['（猫）', '奔放', '对等', '坦诚', '顺从', '主人', '服从', '依赖'],
      '-13': ['（猫）', '奔放', '对等', '坦诚', '忠诚', '恭顺', '倾心', '忠义'],
    },
  };

  /** implevel2（193395-193417）：興味/主从关系等级 0..7 */
  function implevel2(v) {
    if (v < -100) return 0;
    if (v < 0) return 1;
    if (v < 100) return 2;
    if (v < 150) return 3;
    if (v < 200) return 4;
    if (v < 250) return 5;
    if (v < 300) return 6;
    return 7;
  }

  /**
   * 对话窗信息栏的两行标签（426553-426591）。
   * @returns {{imp:{v:number,label:string}, it:{v:number,label:string}}}
   */
  function impLabel(npc) {
    const rel = npc.get(441) | 0;
    const imp = npc.get(17) | 0;
    const it = npc.get(169) | 0;
    const tImp = IMP_LABELS.imp[String(rel)] || IMP_LABELS.imp[0];
    let tIt = IMP_LABELS.it[0];
    if (rel <= -11 && rel >= -13) tIt = IMP_LABELS.it[String(rel)] || tIt;
    return {
      imp: { v: imp, label: tImp[implevel(imp)] || tImp[tImp.length - 1] },
      it: { v: it, label: tIt[implevel2(it)] || tIt[tIt.length - 1] },
    };
  }

  /**
   * 0-W0：对话窗左栏的全部字段（426462-426647 的绘制段），按用户提供的原版截图重排。
   *
   * 源码逐项：
   *   426462-426500 标题 = var_63(0) 名字 + var_63(1) 称号 + var_63(8) 性别
   *                 （本项目无 var_63(1) 称号，故为「名字 性别」）
   *   426553-426561 好感行 "(var_58(17))" + var_258..265[implevel(var_58(17))]
   *   426580-426591 兴致行 "(var_58(169))" + var_266..269[implevel2(var_58(169))]
   *   426617-426638 var_58(433) 的红心（幸福度 / 行動力，不是兴趣）
   *   426639-426645 興趣条：repeat var_58(14) / 5 + 1 条竖线
   *                 （0-Z27 修正：此前误读成 var_58(433)，导致蓝条恒满）
   *   426593-426595 cbit 969 → cnvdate(var_58(84), 2)（記念日）
   *   426597-426610 否则 var_58(400)/var_58(401)（月/日），为 0 时用
   *                 var_65(11)/var_65(12)（当前月/日）初始化
   *
   * @returns {{title,face:{img,x,y},impLine,itLine,interest,anniversary}}
   */
  /**
   * 高清立绘的表情后缀（425627-425645）。
   *   源码按顺序判 `var_58(79) \ 100`，**后面的会覆盖前面的**，所以优先级是
   *   低血 / 26 > 17 > 6 > 21 > 18，最后落到默认 B。
   *   A 生气 / Q 悲伤 / F 高兴 / H 脸红 / E 受伤 / B 平常
   * @returns {'A'|'B'|'E'|'F'|'H'|'Q'}
   */
  function faceMood(npc) {
    const pose = Math.trunc((npc.get(79) | 0) / 100);
    const hp = npc.get(50) | 0, hpMax = npc.get(51) | 0;
    if (pose === 26 || (hpMax > 0 && hp < hpMax / 2)) return 'E';
    if (pose === 17) return 'H';
    if (pose === 6) return 'F';
    if (pose === 21) return 'Q';
    if (pose === 18 || (npc.get(264) | 0) > 0) return 'A';
    return 'B';
  }

  function dialogInfo(npc, g) {
    const sex = npc.get(8) | 0;
    const gender = (sex === 0) ? '男性' : '女性';
    const portrait = npc.get(13) | 0;
    const picNo = npc.get(431) | 0;          // var_58(431)：高清立绘编号（289363-289411）
    let face = (Elona.CharCreate && Elona.CharCreate.faceTileOf)
      ? Elona.CharCreate.faceTileOf(sex, portrait < 0 ? 0 : portrait)
      : { img: 'face1.bmp', x: 0, y: 0 };
    // 0-Z29：用户图像覆盖。原版 425517-425530 / 425536-425545 两条分支：
    //   · `var_58(431) > 0` → `user\graphic2\face<431>_<表情>.bmp`（高清立绘）
    //   · `var_58(13) < 0`  → `user\graphic\face<|portrait+1|>.bmp`（自定义脸）
    //     但源码里还套了一层 `if (var_58(13) != -1)`：-1 就是「用 graphic\face1.bmp
    //     的基础格」，不算自定义脸。所以只有 < -1 才去取文件。
    //   两者都只是「换一张图」，所以这里给 face 挂一个 customPath，
    //   由 view/ui.js 异步取 blob URL 之后覆盖 background-image。
    if (picNo > 0) {
      face = { img: face.img, x: face.x, y: face.y, highRes: true, picNo, mood: faceMood(npc) };
    } else if (portrait < -1) {
      face = { img: face.img, x: face.x, y: face.y, portrait, customPath: 'graphic/face' + Math.abs(portrait + 1) + '.bmp' };
    }
    const lab = impLabel(npc);
    // 0-Z27：兴趣取自 var_58(14)（426618 的蓝条画的就是它）
    const interest = Math.max(0, interestOf(npc, g));
    const monthOf = () => (g && typeof g.getV65 === 'function') ? (g.getV65(11) | 0) : 0;
    const dayOf = () => (g && typeof g.getV65 === 'function') ? (g.getV65(12) | 0) : 0;
    let anniversary;
    const st = Elona.Status;
    if (st && st.cbit && st.cbit(npc, 969) && Elona.ResidualTables
      && Elona.ResidualTables.formatDate) {
      anniversary = Elona.ResidualTables.formatDate(npc.get(84) | 0, 2, 'jp');
    } else {
      anniversary = `${(npc.get(400) | 0) || monthOf()}/${(npc.get(401) | 0) || dayOf()}`;
    }
    return {
      title: `${npc.name || ''} ${gender}`,
      face,
      impLine: `(${lab.imp.v})${lab.imp.label}`,
      itLine: `(${lab.it.v})${lab.it.label}`,
      interest,
      anniversary,
    };
  }

  /** modimp（193311-193348）：好感度 var_58(17)，按等级衰减，上限 400 */
  function modImp(npc, amount, g) {
    const lvl = implevel(npc.get(17) | 0);
    let delta;
    if (amount < 0) delta = amount;
    else {
      delta = idiv(amount * 100, 50 + lvl * lvl * lvl);
      if (delta === 0) {
        const r = ((g && g.rng) ? g.rng : Elona.rng).rnd(10);
        if (lvl < r) delta = 1;
      }
    }
    let imp = (npc.get(17) | 0) + delta;
    if (imp > 400) imp = 400;
    npc.set(17, imp);
    return delta;
  }

  /**
   * 给予物品 —— 297883-298250（var_486==10 的通用分支）。
   * 装备中/不可丢弃的物品不能给；成功时物品数量 -1，NPC 好感度提升。
   * 【简化】原版的「盗品/情人节/纪念日」等专例与 NPC 背包容量检查未移植。
   */
  function give(g, player, npc, idx) {
    const it = player.inv && player.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item', message: '没有可给予的物品。' };
    if (it.eqSlot >= 0 || (it.f[18] | 0)) return { ok: false, reason: 'equipped', message: '装备中的物品不能给予。' };
    // 0-CM：媚藥 / 媚藥性食物 —— ibit(6) 或物品 620（226676-226701 / 事件 1135：318645-318712）
    if (Elona.Love && Elona.Love.isAphrodisiac(it)) {
      const lp = Elona.Love.lovePotionGiven(g, npc, it);
      it.f[0] = (it.f[0] | 0) - 1;
      if ((it.f[0] | 0) <= 0) player.inv[idx] = null;
      return Object.assign({ ok: lp.ok, friendship: npc.get(17) | 0 }, lp);
    }
    if (Elona.ItemDB && Elona.ItemDB.ibit && Elona.ItemDB.ibit(13, it)) {
      return { ok: false, reason: 'no-drop', message: '那是你重要的东西，不能给予。' };
    }
    const imp = npc.get(17) | 0;
    const amount = imp >= 200 ? 50 : (imp >= 150 ? 40 : (imp >= 100 ? 30 : 5));
    modImp(npc, amount, g);
    it.f[0] = (it.f[0] | 0) - 1;
    if (it.f[0] <= 0) player.inv[idx] = null;
    const name = Elona.ItemDB ? Elona.ItemDB.name(it.id) : ('item ' + it.id);
    return { ok: true, item: name, friendship: npc.get(17) | 0,
      message: `你把 ${name} 交给了 ${npc.name}（好感度 ${npc.get(17) | 0}）。` };
  }

  /** 情报屋（角色 8）：200 gold 出售当前委托/地下城情报 */
  const RUMORS = [
    '「听说镇子中央的掲示板上贴了不少委托。」',
    '「地下城里越往下越危险，别忘了带够药水。」',
    '「守卫的装备不错，偷东西可要小心被看见。」',
    '「训练师能帮你提升技能潜力，不过要白金币。」',
  ];
  /**
   * 冒险者的情报（原版 18）—— 416884-416897 / *label_2720 的 var_1502 == 4。
   * 打开「冒险者一览」（按名声排序），选中一位时扣 100 gold 并显示详情。
   */
  function intel(g, npc, player) {
    const list = adventurers(g).filter((c) => (c.index | 0) !== 0);
    if (!list.length) {
      return { ok: true, message: '「现在没有其他冒险者在这个地方。」' };
    }
    return { ok: true, action: 'adventurer-info', list, message: '' };
  }

  /**
   * 「让开」（原版对话动作 106，419597-419630）。
   *
   * 源码：
   *   419598  `if (var_58(14, var_244) <= 0)` → `snd 27` +「<name>はやんわりと断った。」
   *   419609  `var_58(14, var_244) -= 20`（気力）
   *   419610  `var_58(15, var_244) = 絶対小时 + 12`（12 小时冷却）
   *   419621  `cell_swap 0, var_244` —— **玩家与 NPC 交换位置**（不是 NPC 自己挪开）
   *   419624  「<name>と入れ替わった。」/「You displace <name>.」
   *
   * 【0-HX 更正】旧实现把 NPC 挪到相邻空格（报告 A190 记为近似）；源码是换位。
   */
  function aside(g, npc) {
    const R = Elona.Relation;
    const has65 = !!(g && g.v65);
    const absHour = () => (has65
      ? ((g.getV65(13) | 0) + (g.getV65(12) | 0) * 24
        + (g.getV65(11) | 0) * 24 * 30 + (g.getV65(10) | 0) * 24 * 30 * 12)
      : 0);
    const now = (has65 && R && typeof R.nowHours === 'function') ? R.nowHours(g) : absHour();
    if (now >= (npc.get(15) | 0)) npc.set(14, 100);        // 気力回满（同 Relation.refreshVigor）
    const vigor = npc.get(14) | 0;
    if (vigor <= 0) {                                      // 419598-419606
      if (typeof g.playSnd === 'function') g.playSnd(27);
      return { ok: false, action: 'aside', reason: 'refuse',
        message: `${npc.name} 委婉地拒绝了。` };
    }
    npc.set(14, vigor - 20);                               // 419609
    npc.set(15, now + 12);                                 // 419610
    if (typeof g.swapWith === 'function') g.swapWith(npc);  // 419621 cell_swap 0, var_244
    return { ok: true, action: 'aside', message: '' };      // 提示由 swapWith 输出（419624）
  }

  // ======================================================================
  // 0-HU（A201d，用户裁定 b）：护卫 / 奴隶·马的报价与目录交互
  //   421311-421362  动作 50：calchireadv 三档、钱不够不显示
  //   424897-424975  *label_3062：A/B/C 目录、槽 56 生成候选、calcslavevalue 算价
  // ======================================================================

  /** 对话动作 50 的选项（只列付得起的档位，421316-421331） */
  function guardOptions(g, npc) {
    const P = Elona.Party;
    if (!P || !P.hireQuote) return { header: '雇佣护卫', entries: [], adv: 0 };
    const q = P.hireQuote(g, npc);
    const entries = q.options.map((o) => ({
      label: `雇佣 ${o.days} 天`, meta: `${o.cost} gold`, arg: { days: o.days },
    }));
    return { adv: q.adv, entries,
      header: `雇佣 ${npc ? npc.name : '这位冒险者'}（7 天报价 ${q.adv} gold）` };
  }

  /**
   * *label_3062 的「看货」：在临时槽 56 生成一只候选并算出价格。
   * 原版 `fltn "man" / "horse"` 是按标签随机选物种；本项目沿用既有的
   * 固定物种 id（奴隶 16 / 駄馬 267），并按目录档位给等级，此处如实登记为近似。
   */
  function slaveOffer(g, npc, tierArg) {
    const P = Elona.Party;
    if (!P) return { header: '目录', entries: [], ok: false };
    const role = roleOf(npc);
    const kind = role === 22 ? 'horse' : 'slave';
    const species = kind === 'horse' ? 267 : 16;
    const tier = tierArg === undefined || tierArg === null ? 0 : (tierArg | 0);
    const lv = P.slaveCatalogLevel(g, tier);
    const CF = Elona.CharaFactory;
    let cand = null;
    if (CF && CF.create) {
      // 424908-424920：repeat 10 直到 var_58(38,56) != 0；这里重试 10 次生成
      for (let i = 0; i < 10 && !cand; i++) {
        try {
          const c = CF.create(g, species, lv, -3, 0, { index: 56, var641: 2 });
          if (c && ((c.get(38) | 0) !== 0)) cand = c;
        } catch (e) { /* 生成失败则重试 */ }
      }
    }
    if (!cand) return { ok: false, header: '马厩里现在没有合适的货。', entries: [] };
    cand.set(9, 10);                                  // 待售对象不是敌人
    cand.set(69, 10);
    const cost = P.slaveValue(cand);
    const gold = (player30(g) | 0);
    g.slaveOffer = { npcIndex: npc ? (npc.index | 0) : -1, kind, tier, pet: cand, cost };
    const plv = (g.player.get(38) | 0);
    const catLabel = (t) => t === 2 ? `A（等级 ≤ ${P.slaveCatalogLevel(g, 2)}）`
      : (t === 1 ? `B（等级 ≤ ${P.slaveCatalogLevel(g, 1)}）` : 'C（等级 ≤ 5）');
    const entries = [];
    if (gold >= cost) entries.push({ label: `买下 ${cand.name}`, meta: `${cost} gold`, arg: { buy: true } });
    else entries.push({ label: `钱不够（需要 ${cost} gold）`, meta: '无法购买', arg: { buy: true } });
    // 424927-424936：玩家等级 >= 4 才给 A / B 目录
    if (plv >= 4) {
      if (tier !== 2) entries.push({ label: `看目录 ${catLabel(2)}`, arg: { tier: 2 } });
      if (tier !== 1) entries.push({ label: `看目录 ${catLabel(1)}`, arg: { tier: 1 } });
    }
    if (tier !== 0) entries.push({ label: `看目录 ${catLabel(0)}`, arg: { tier: 0 } });
    const header = `【${kind === 'horse' ? '马屋' : '奴隶商'}·目录 ${catLabel(tier)}】`
      + `${cand.name} Lv${cand.get(38) | 0} · ${cost} gold`;
    return { ok: true, tier, pet: cand, cost, header, entries };
  }

  function player30(g) { return (g && g.player) ? (g.player.get(30) | 0) : 0; }

  /**
   * 目录菜单的点选：换档 → 重新看货（reopenList 让 UI 重绘列表）；
   * 付钱 → 扣款、snd 12、把槽 56 的候选正式收入队伍（424948-424960）。
   */
  function slavePurchase(g, npc, arg) {
    const a = arg || {};
    if (a.tier !== undefined) {
      const o = slaveOffer(g, npc, a.tier | 0);
      return { ok: o.ok, reopenList: true, header: o.header, entries: o.entries,
        message: `翻到了目录 ${['C', 'B', 'A'][a.tier | 0] || 'C'}。` };
    }
    const offer = g.slaveOffer;
    if (!offer || !offer.pet) return { ok: false, message: '先看看目录里的货吧。' };
    if (offer.npcIndex >= 0 && npc && (npc.index | 0) !== offer.npcIndex) {
      return { ok: false, message: '请找刚才那位商人结账。' };
    }
    const cost = offer.cost | 0;
    if ((player30(g) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `需要 ${cost} gold。` };
    }
    const P = Elona.Party;
    if (!P || (P.members(g).length >= P.maxSize(g))) {
      return { ok: false, reason: 'full', message: '队伍已经满了。' };
    }
    g.player.set(30, (player30(g) | 0) - cost);
    const r = P.adoptOffer(g, offer.pet);
    if (!r.ok) {
      g.player.set(30, (player30(g) | 0) + cost);
      return r;
    }
    g.slaveOffer = null;
    return { ok: true, cost, slot: r.slot, sounds: [12],
      message: `买下了 ${offer.pet.name}（-${cost} gold）。${r.message}` };
  }

  /** 宠物竞技场标题（417137 / 417169） */
  const PET_KING_TEXT = '「欢迎你，宠物之王！为了和你的宠物对战，今天也有挑战者来了。」';
  const CHAMPION_TEXT = '「欢迎你，竞技场的冠军！为了和你对战，今天也有挑战者来了。」';

  /**
   * 0-HV：竞技场的一步交互。
   *   arg 为数字 = 「选好了出战宠物」→ 回到报价；
   *   arg 为 { confirm: true } = 玩家点了「Alright.」→ 真正开赛（`Elona.Arena.start`）；
   *   arg 为 { confirm: false } = 「I'll pass.」→ 416983 / 417083 的 `goto *label_3059`。
   * 返回 `reopenList` 时 UI 会保持列表打开（renderPickList）。
   */
  function arenaStep(g, npc, mode, arg) {
    const A = Elona.Arena;
    if (!A || !A.quote) return { ok: false, message: '竞技场尚未开放。' };
    const isObj = !!(arg && typeof arg === 'object');
    if (isObj && arg.confirm === false) {
      return { ok: true, cancel: true, message: '「改变主意的话随时来找我。」' };
    }
    if (isObj && arg.confirm === true) {
      const r = A.start(g, npc, mode, { petIndex: arg.petIndex, petCount: arg.petCount });
      if (!r || !r.ok) return r || { ok: false, message: '无法开赛。' };
      // 换到 arena_1 / arena_2（417103-417107 / 417226-417230）
      if (g.enterArenaMap) r.enterMap = r.arenaMap;
      return r;
    }
    const petIndex = isObj ? arg.petIndex : ((typeof arg === 'number') ? arg : undefined);
    const q = A.quote(g, npc, mode, { petIndex });
    if (!q.ok) return q;
    // 416977-417082：报价文本 —— 决斗报单个等级、乱斗报「複数」、团队战报人数
    let header;
    if (mode === 'pet-team' || mode === 'pet-ex') {
      header = q.count + ' 对 ' + q.count + ' 的团队战，对手是等级约 ' + q.level + ' 的多只宠物。要挑战吗？';
    } else if (mode === 'rumble') {
      header = '对手是等级约 ' + q.level + ' 的多名战士。要挑战吗？';
    } else {
      header = '今天的对手是等级约 ' + q.level + ' 的战士。要挑战吗？';
    }
    if (q.champion) header = (q.petMode ? PET_KING_TEXT : CHAMPION_TEXT) + header;
    // 源码 417079 `lang("やめる", "I'll pass.")` / 417191 `lang("挑戦する", "I'll send my pet.")`
    //   —— 日文原文「挑戦する / やめる」，中文版统一为「挑战 / 放弃」。
    const label = q.petMode ? '挑战' : '挑战';
    return {
      ok: true, reopenList: true, header,
      entries: [
        { label: label, meta: '胜利可获得 ' + q.fame + ' 名声',
          arg: { confirm: true, mode: mode, petIndex: q.petIndex, petCount: q.count } },
        { label: '放弃', meta: '算了', arg: { confirm: false, mode: mode } },
      ],
    };
  }

  /** 0-HT：把服务结算里的 `sounds`（snd N）交给 Game 的表现层统一回放 */
  function performDispatch(g, npc, id, arg) {
    const player = g.player;
    if (!npc || !player) return { ok: false, message: '没有可交互的对象。' };
    switch (id) {
      case 'talk': return { ok: true, message: talk(g, npc) };
      // 0-EU：「查看状态」改为打开完整的人物信息窗（与按 c 看自己同一套面板），
      //   原先只往消息栏打两行文本。
      case 'info': return { ok: true, action: 'chara-info', target: npc, message: '' };
      case 'shop': return { ok: true, action: 'shop', keeper: npc, message: '' };
      case 'shop-buy': return { ok: true, action: 'shop', shopMode: 'buy', keeper: npc, message: '' };
      case 'shop-sell': return { ok: true, action: 'shop', shopMode: 'sell', keeper: npc, message: '' };
      case 'invest': return { ok: true, action: 'shop', shopMode: 'invest', keeper: npc, message: '' };
      case 'potion-plug': {
        // 421798-421814：cbit(974) 为 0 → 「现在没有多余的」；
        //   否则给 `5 + limit(店等级,1,200)/10` 个瓶塞并清位
        if (!Elona.Potion || !Elona.Potion.requestPlugs) {
          return { ok: false, message: '药剂模块未加载。' };
        }
        const pr = Elona.Potion.requestPlugs(g, npc);
        return { ok: pr.ok, count: pr.count, total: pr.total,
          message: pr.messages.join('\n') };
      }
      case 'awaken': return { ok: true, action: 'awaken', message: '' };
      case 'imprison': return (Elona.Camp && Elona.Camp.imprison)
        ? Elona.Camp.imprison(g, npc)
        : { ok: false, message: 'ここには収容所がない。' };
      case 'assign-worker': {
        if (!Elona.ShopSale) return { ok: false, message: '店舗モジュールが未ロード。' };
        const site = Elona.Property && Elona.Property.currentSite
          ? Elona.Property.currentSite(g) : null;
        if (!site) return { ok: false, message: 'ここは店ではない。' };
        const res = Elona.ShopSale.assign(g, npc, site.id);
        return { ok: res.ok, action: 'assign-worker', message: res.message };
      }
      case 'unassign-worker': {
        if (!Elona.ShopSale) return { ok: false, message: '店舗モジュールが未ロード。' };
        const res = Elona.ShopSale.unassign(g, npc);
        return { ok: res.ok, action: 'unassign-worker', message: res.message };
      }
      case 'camp-manage': return { ok: true, action: 'camp-manage', message: '' };
      // C-5：菜单 61「観察する」（421633-421708）
      case 'caravan-observe': return caravanObserve(g, npc);
      // C-5：菜单 107「仕事の話がしたい」（419826-421600）
      case 'caravan-work-talk': return caravanWorkTalk(g, npc);
      // 0-DC：骑乘（319690-319810）—— 弹出 3 项菜单（乗る / 乗せる / 取消）
      case 'ride': return { ok: true, action: 'ride', target: npc, message: '' };
      // 0-DC：下马（319615-319685）
      case 'dismount': return (Elona.Riding && Elona.Riding.dismount)
        ? Elona.Riding.dismount(g)
        : { ok: false, message: '现在没有骑着任何东西。' };
      case 'aside': return aside(g, npc);
      case 'meal': return meal(g, npc, player);
      case 'drink': return drink(g, npc, player);
      case 'give': return give(g, player, npc, arg);
      case 'cuddle': return Elona.Love ? Elona.Love.cuddle(g, npc)
        : { ok: false, message: '恋爱模块未加载。' };
      case 'trick-or-treat': return Elona.Festival ? Elona.Festival.startTrick(g, npc)
        : { ok: false, message: '节日模块未加载。' };
      case 'trick-choice': return Elona.Festival ? Elona.Festival.resolveTrick(g, npc, arg)
        : { ok: false, message: '节日模块未加载。' };
      case 'intel': return intel(g, npc, player);
      case 'adventurer-info': return adventurerInfo(g, npc, player, arg);
      case 'adventurer-message': {
        const list = adventurers(g).filter((c) => (c.index | 0) !== 0);
        if (!list.length) return { ok: true, message: '「现在没有可以传话的对象。」' };
        return { ok: true, action: 'adventurer-message', list, message: '' };
      }
      case 'message-send': {
        const [idx, msg] = Array.isArray(arg) ? arg : [arg, 0];
        return sendMessage(g, npc, player, idx, msg);
      }
      case 'birthday': return { ok: true, action: 'birthday', message: '' };
      case 'birthday-set': {
        const [m, d] = Array.isArray(arg) ? arg : [arg, 0];
        return setBirthday(g, m, d);
      }
      case 'reload': return reload(g, player);
      case 'special-meal': return specialMeal(g, npc, player);
      case 'special-drink': return specialDrink(g, npc, player);
      case 'enhance': return enhance(g, player, arg);
      case 'lighten': {
        const [idx, units] = Array.isArray(arg) ? arg : [arg, 1];
        return lighten(g, player, idx, units);
      }
      case 'heavify': {
        const [idx, units] = Array.isArray(arg) ? arg : [arg, 1];
        return heavify(g, player, idx, units);
      }
      case 'reserve-book': return reserveBook(g, player, arg);
      case 'reserve-list': return reserveList(g, arg);
      case 'material-kit': {
        // 源码 371886：需素材槌 630 + *素材変化*卷轴 502 + 青铜币 1041；选当前时段可用材质
        const L = Elona.LivingWeapon;
        if (!L) return { ok: false, message: '（材质锤功能未就绪。）' };
        const opts = L.materialKitOptions(g);
        if (arg === undefined || arg === null) {
          return { ok: true, action: 'choice', title: '要变成哪种材质？',
            options: opts.map((o) => ({ label: o.name, value: o.id })), message: '' };
        }
        // 目标物品由 UI 选定后以 { material, itemIndex } 传入
        const a = (arg && typeof arg === 'object') ? arg : { material: arg };
        const inv = player.inv || [];
        const it = inv[a.itemIndex | 0];
        if (!it) return { ok: false, message: '请先选择要改造的装备。' };
        const r = L.applyMaterialKit(g, it, a.material);
        return { ok: r.ok, message: r.ok ? '材质改造完成。' : '这件物品无法用素材槌改造。' };
      }
      case 'identify': return identifyAll(g, npc, player);
      case 'identify-one': return identifyOne(g, npc, player, arg, 250);
      case 'investigate': return investigate(g, npc, player, arg);
      case 'train': return train(g, player, arg, npc);
      case 'learn': return learnSkill(g, player, arg, npc);
      case 'uncurse': return uncurseEquip(g, npc, player);
      case 'practice': return magicPractice(g, npc, player, arg);
      case 'stock-exchange': return magicStockExchange(g, npc, player, arg, false);
      case 'stock-exchange-all': return magicStockExchange(g, npc, player, 0, true);
      case 'boss-info': return bossInfo(g, npc, player);
      case 'rumor': return rumor(g, npc, player);
      case 'popularity': return popularity(g, npc, player);
      case 'town-info': return townManage(g, npc, player);
      case 'barter': return barter(g, npc, player, arg);
      // 0-HV：竞技场（416977-417082 / 417123-417231）—— 原版是**两步**：
      //   先 `var_122 = "相手はレベル N だ。挑むか？"`，再 `txt_select` 出
      //   「挑戦する / やめる」；选「やめる」→ `goto *label_3059` 什么都不做。
      case 'arena-duel':
      case 'arena-rumble':
        return arenaStep(g, npc, id === 'arena-rumble' ? 'rumble' : 'duel', arg);
      case 'arena-score':
        // 417237（人 var_506=23）/ 417233（宠物 var_506=42）—— 名次槽 120 / 121
        return { ok: true,
          message: Elona.Arena ? Elona.Arena.scoreText(g, roleOf(npc) === 11 ? 1 : 0) : '（无记录）' };
      case 'pet-duel':
      case 'pet-team':
      case 'pet-ex': {
        const mode = id === 'pet-team' ? 'pet-team' : (id === 'pet-ex' ? 'pet-ex' : 'pet-duel');
        return arenaStep(g, npc, mode, arg);
      }
      case 'recruit':
        return Elona.Party ? Elona.Party.recruit(g, npc) : { ok: false, message: '队伍系统尚未就绪。' };
      case 'hire-guard': {
        // 0-HU（A201d）：三档动态报价（421314-421331），不再写死「7 天 / 2000 gold」
        if (!Elona.Party) return { ok: false, message: '队伍系统尚未就绪。' };
        const days = (arg && typeof arg === 'object') ? (arg.days | 0) : (arg | 0);
        const q = Elona.Party.hireQuote(g, npc);
        const opt = q.all.find((o) => o.days === days);
        if (!opt) return { ok: false, message: '没有这种契约期限。' };
        if ((player.get(30) | 0) < opt.cost) {
          return { ok: false, reason: 'money', cost: opt.cost, message: `需要 ${opt.cost} gold。` };
        }
        return Elona.Party.hireGuard(g, npc, days, opt.cost);
      }
      // 0-HU（A201d）：目录 / 结算统一走 *label_3062 的候选报价流程
      case 'slave-offer': return slavePurchase(g, npc, arg);
      case 'buy-slave':
      case 'buy-horse': {
        const o = slaveOffer(g, npc, 0);
        return { ok: o.ok, reopenList: true, header: o.header, entries: o.entries,
          message: '「来看看马厩里的货吧。」' };
      }
      case 'heal': return heal(g, player, npc);
      case 'companion-menu': return { ok: true, action: 'companion-menu', target: npc, message: '' };
      // 0-DH / 0-Z28：evochat / 一緒に食事
      case 'evochat': return { ok: true, action: 'evochat', target: npc, message: '' };
      // 109 组合evochat（417990）：三人世界，进入 var_2697 == 1 的菜单
      case 'evochat-tag': return { ok: true, action: 'evochat-tag', target: npc, message: '' };
      // 110 听听组合间的对话（var_2696 == 110）：两拍台词后回主菜单
      case 'evochat-watch': return { ok: true, action: 'evochat-watch', target: npc, message: '' };
      case 'share-meal': return { ok: true, action: 'share-meal', target: npc, message: '' };
      // 0-DG：调酒师的同伴服务（417429-417525）
      case 'revive-ally': {
        const dead = (Elona.Companion ? Elona.Companion.deadAllies(g) : []);
        if (!dead.length) return { ok: true, message: '「没有需要叫回来的同伴。」' };
        return { ok: true, action: 'ally-revive', list: dead, message: '' };
      }
      case 'wait-ally': {
        const list = (Elona.Companion ? Elona.Companion.activeAllies(g) : []);
        if (!list.length) return { ok: true, message: '「你身边没有同伴。」' };
        return { ok: true, action: 'ally-wait', list, message: '' };
      }
      case 'quest-info': {
        const q = Elona.Quest.activeQuests(g).find((x) => x.id === arg);
        return { ok: true, quest: q,
          message: q ? `${Elona.Quest.describe(q)}（${Elona.Quest.progressText(g, q)}，${Elona.Quest.daysText(q)}）` : '没有这件委托。' };
      }
      case 'quest-deliver': return Elona.Quest.handOver(g, arg);
      case 'quest-collect': return Elona.Quest.collect(g, arg);
      case 'quest-harvest': return Elona.Quest.harvest(g, arg);
      case 'quest-party': return Elona.Quest.party(g, arg);
      case 'quest-enter': {
        const q = Elona.Quest.activeQuests(g).find((x) => x.id === arg);
        if (!q) return { ok: false, message: '没有这件委托。' };
        return { ok: true, enterMap: true, quest: q, message: '前往委托地点。' };
      }
      default: return { ok: false, message: '什么也没有发生。' };
    }
  }
  function perform(g, npc, id, arg) {
    const r = performDispatch(g, npc, id, arg);
    if (r && r.sounds && g && typeof g.playSndList === 'function') g.playSndList(r.sounds);
    return r;
  }

  Elona.NPC = {
    ROLE_NAMES, SHOP_ROLES, loadTable, setSkillNames, setSkillShop, skillName,
    roleOf, roleName, isShop, services, actionMenu, talk, meal, drink, identify,
    implevel, implevel2, impLabel, dialogInfo, faceMood, IMP_LABELS, modImp, give, intel,
    // 0-Z27：兴趣（var_58(14)）读取与闲聊结算（414135-414153）
    interestOf, chatImp,
    trainableSkills, trainCost, train, heal, infoText, perform, aside,
    calcIdentifyValue, unknownItems, identifyOne, identifyAll, investigate,
    magicStockExchange, magicPractice, PRACTICE, practiceQuote, practiceSpells, practiceCost,
    bossInfo, rumor, popularity,
    townManage, barter,
    learnableSkills, learnSkill, uncurseEquip,
    enhanceCost, enhance, ammoSlots, reloadPlan, reload, AMMO_MAX, AMMO_NAMES,
    lighten, heavify, specialMeal, specialDrink, mealTargets,
    birthday, setBirthday, adventurers, adventurerInfo, sendMessage, applyMessage,
    ADV_MESSAGES, reserveBook, reserveList, findItemSlot, consumeItem,
    // 0-HU / A201d：护卫动态报价与奴隶·马目录
    guardOptions, slaveOffer, slavePurchase,
    // 0-HV / A200：竞技场的「报价 → 确认」
    arenaStep,
  };
})(window);
