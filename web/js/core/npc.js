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

  async function loadTable() {
    const d = await Elona.Data.table('skills');
    SKILL_NAMES = (d && d.skillNames) || {};
    return SKILL_NAMES;
  }
  function setSkillNames(names) { SKILL_NAMES = names || {}; }
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
    const out = [{ id: 'talk', label: '来聊聊聊天吧' }];
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
      out.push({ id: 'practice', label: '魔法实习（900 gold）' });     // 原版 75
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
      out.push({ id: 'quest-guide', label: '委托攻略（300 gold）' });     // 原版 98
      out.push({ id: 'birthday', label: '告诉他生日' });                 // 原版 82
      out.push({ id: 'rumor', label: '打听传闻（2000 gold）' });
    }
    if (r === 1020) out.push({ id: 'reserve-book', label: '魔法书预订（需解读经验）' });
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
    if (r === 13) {
      out.push({ id: 'barter', label: '以物易物' });                  // 原版 20
      out.push({ id: 'hire-guard', label: '雇佣护卫（7 天 / 2000 gold）' });  // 原版 50
      out.push({ id: 'recruit', label: '邀请入伙' });                  // 原版 51
    }
    // 奴隶商：买奴隶（36）；马屋：买马（57）
    if (r === 17) out.push({ id: 'buy-slave', label: '买奴隶（3000 gold）' });
    if (r === 22) out.push({ id: 'buy-horse', label: '买马（5000 gold）' });
    // 委托（掲示板 *label_2704 / 委托人对话 *label_3031 / 415663-415745）
    if (g && Elona.Quest) {
      for (const s of Elona.Quest.npcServices(g, npc)) out.push(s);
    }
    // 0-FC：剧情传送（主线 / 支线任务接取后传送到固定地图）。
    //   源码：386376-386380 / 389083-389094 / 408123-408134 / 409371-409378 / 421666-421682
    //   —— NPC 对话分支里直接写 `var_65(64) = <目标地图>` + `var_1777 = 2|4` 换图。
    if (g && Elona.StoryWarp) {
      for (const s of Elona.StoryWarp.services(g, npc)) out.push(s);
    }
    // 0-BV：说「気持ち」（原版对话动作 var_400 == 29 → txtselectkimoti0/1/2，11000-11186）
    // 入口条件（原版按场景/关系限定）未逐条移植，此处对所有可对话 NPC 提供（登记 A183）
    if (Elona.Relation && Elona.Relation.menu) {
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
      out.push({ id: 'trick-or-treat', label: 'Trick or Treat?' });
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
      // 0-DH：evochat（原版 var_1294 == 1 的同伴对话菜单，415000-415035）
      out.push({ id: 'evochat', label: '说说话（心情 / 心の開錠）' });
      // 0-DH：一緒に食事（动作 84，415103 的四个条件：
      //   var_58(22) 双方 <= 10000、好感 >= 100、双方都没有 cbit 986）
      const pl = g && g.player;
      if (pl && Elona.Status && !Elona.Status.cbit(npc, 986) && !Elona.Status.cbit(pl, 986)
        && (npc.get(22) | 0) <= 10000 && (pl.get(22) | 0) <= 10000
        && (npc.get(17) | 0) >= 100) {
        out.push({ id: 'share-meal', label: '一起吃饭（经验 200% / 满腹度减半）' });
      }
    }
    out.push({ id: 'aside', label: '让开' });        // 原版：让 NPC 挪开（0-BX）
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

  function talk(g, npc) {
    const r = roleOf(npc);
    const title = roleName(r);
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
      const t = Elona.Talk.say(g, npc, 106, { lang: 'en' });
      if (t && t.text) {
        const line = /^["「]/.test(t.text) ? t.text : `「${t.text}」`;
        return title ? `${npc.name}（${title}）${line}` : `${npc.name}${line}`;
      }
    }
    // 0-GM / 414098-414105：原版先 gosub *label_0264 取 data\talk.txt 的随机闲聊，
    // 再 customtalk 106 覆盖；这里 customtalk 已在上面优先返回，
    // 因此把内置闲聊接在自定义台词之后、硬编码 GREET 之前（结果等价）。
    if (Elona.IdleTalk) {
      const idl = Elona.IdleTalk.idle(g, npc, { lang: 'en' });
      if (idl && idl.text) {
        const body = /^[「"『]/.test(idl.text) ? idl.text : `「${idl.text}」`;
        return (title ? `${npc.name}（${title}）` : npc.name) + body + extra;
      }
    }
    const lines = GREET[r] || GREET[3];
    const pick = lines[((g && g.rng) ? g.rng : Elona.rng).rnd(lines.length)];
    const base = title ? `${npc.name}（${title}）${pick}` : `${npc.name}${pick}`;
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

  /** 训练可选的技能（只列有潜力的技能，按潜力降序） */
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
    out.sort((a, b) => b.potential - a.potential);
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

  /** 训练师可教的「未习得」技能（原版菜单 30「新しいスキルを覚えたい」） */
  function learnableSkills(player) {
    const out = [];
    const seen = {};
    for (const key in SKILL_NAMES) {
      const id = parseInt(key, 10);
      // 属性 10..19 不能「学」；只列技艺/武器/生活技能
      if (!(id >= 100 && id <= 199)) continue;
      if (seen[id]) continue;
      seen[id] = 1;
      const pot = Elona.Stats && Elona.Stats.sorg ? Elona.Stats.sorg(player, id) : 0;
      const exp = Elona.Stats && Elona.Stats.sexp ? Elona.Stats.sexp(player, id) : 0;
      if (pot > 0 || exp > 0) continue;                  // 已习得
      out.push({ id, name: skillName(id) });
    }
    out.sort((a, b) => a.id - b.id);
    return out.slice(0, 60);
  }

  /**
   * 学习新技能（原版菜单 30）。
   * 费用：固定 5 枚白金币（原版按技能种类/等级算价的公式未逐行考证，登记 A194）。
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
   * 费用 calcrestorecostc（214781-214786）：limit((名声+1)/100×200, 300, 3000)，战士公会半价。
   * 效果 *label_2960 的 412 分支（320622-320657）：强度 5000；
   *   诅咒 -1 需 rnd(200)+1、-2 需 rnd(1000)+1，强度 ≥ 需求即解咒。
   * 原版对**全队**成员的装备生效。
   */
  function uncurseEquip(g, npc, player) {
    const fame = player.get(34) | 0;
    let cost = limit(idiv((fame + 1) * 200, 100), 300, 3000);
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
   * 魔法实习（原版 75，422572-422640）：6 种实习，花金币提升对应魔法方向的潜力。
   *   1 攻击 / 2 上位攻击 / 3 付与 / 4 回复 / 5 特殊 / 6 探索
   * 本实现：900 gold → 魔力(16) 与咏唱(172) 的潜力提升；具体分系加成未逐条移植（A198）。
   */
  const PRACTICE = [
    { id: 1, label: 'ソーサラー実習（攻击魔法）' },
    { id: 2, label: 'ウォーロック実習（上位攻击魔法）' },
    { id: 3, label: 'エンチャンター実習（付与魔法）' },
    { id: 4, label: 'ヒーラー実習（回复魔法）' },
    { id: 5, label: 'シャーマン実習（特殊魔法）' },
    { id: 6, label: 'メイジ実習（探索魔法）' },
  ];
  function magicPractice(g, npc, player, kind) {
    const k = kind | 0;
    if (k < 1 || k > 6) return { ok: false, message: '没有这种实习。' };
    const cost = 900;
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `实习需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    if (Elona.Stats && Elona.Stats.modGrowth) {
      Elona.Stats.modGrowth(player, 16, player, 120, g);    // 魔力
      Elona.Stats.modGrowth(player, 172, player, 60, g);    // 咏唱
    }
    const label = (PRACTICE.find((x) => x.id === k) || {}).label || '实习';
    return { ok: true, cost, kind: k,
      message: `接受了${label}，魔力与咏唱的潜力提升了（-${cost} gold）。` };
  }

  /** 情报屋：委托攻略（原版 98，422767）—— 300 gold 查看进行中委托的详细攻略 */
  function questGuide(g, npc, player) {
    const cost = 300;
    const list = (Elona.Quest && Elona.Quest.activeQuests) ? Elona.Quest.activeQuests(g) : [];
    if (!list.length) {
      return { ok: false, message: '「你现在没有进行中的委托。」' };
    }
    if ((player.get(30) | 0) < cost) {
      return { ok: false, reason: 'money', cost, message: `情报需要 ${cost} gold。` };
    }
    player.set(30, player.get(30) - cost);
    const lines = list.slice(0, 3).map((q) =>
      `${Elona.Quest.describe(q)}（${Elona.Quest.progressText(g, q)}，${Elona.Quest.daysText(q)}）`);
    return { ok: true, cost,
      message: `（支付 ${cost} gold）\n` + lines.join('\n') };
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

  /** 街长：管理代行者的人气（原版 141，419633）—— 用店铺投资总额推算 */
  function popularity(g, npc, player) {
    let invest = 0, shops = 0;
    for (let i = 0; i < 8; i++) {
      const v = g.getV65(120 + i) | 0;
      if (v > 0 && v < 10000) { invest += v; shops++; }
    }
    const fame = player.get(34) | 0;
    const pop = idiv(invest, 1000) + idiv(fame, 100);
    return { ok: true, popularity: pop, shops, invest,
      message: `「你在本镇的店铺投资 ${invest} gold（${shops} 家），名声 ${fame}——综合评价：人气 ${pop}。」` };
  }

  /** 街长：街道管理一览（原版 74，422086）—— 本实现为只读信息页（A198） */
  function townInfo(g, npc, player) {
    const town = (g.map && g.map.name) || '?';
    let invest = 0, shops = 0;
    for (let i = 0; i < 8; i++) {
      const v = g.getV65(120 + i) | 0;
      if (v > 0 && v < 10000) { invest += v; shops++; }
    }
    const qn = (Elona.Quest && Elona.Quest.activeQuests)
      ? Elona.Quest.activeQuests(g).length : 0;
    const day = Elona.Arena ? Elona.Arena.curDay(g) : 0;
    return { ok: true,
      message: `「${town}」\n店铺投资：${invest} gold（${shops} 家营业中）\n进行中的委托：${qn} 件\n第 ${day} 日` };
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
    const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : ('item ' + it.id);
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
    const gotName = Elona.ItemDB.name(got, 'en');
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
    const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : ('item ' + it.id);
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
    const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : ('item ' + it.id);
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
    const name = Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : ('item ' + it.id);
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
    if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, c, id, power, 5000);
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
    const name = Elona.ItemDB ? Elona.ItemDB.name(it.id, 'en') : ('item ' + it.id);
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
   * 执行一个服务。
   * @returns {{ok:boolean, message:string, action?:string, keeper?:object}}
   */
  /**
   * 「让开」（原版对话菜单项，截图里的 e）：让 NPC 挪到旁边的空位。
   * 原版是 NPC 主动移开（cell_findspace 一类）；本实现把 NPC 挪到相邻可通行格。
   */
  function aside(g, npc) {
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [dx, dy] of dirs) {
      const nx = npc.x + dx, ny = npc.y + dy;
      if (!g.map || !g.map.inBounds(nx, ny)) continue;
      const cell = g.map.check(nx, ny);
      if (!cell.walkable) continue;
      const old = g.map.cell(npc.x, npc.y);
      if (old) old[1] = 0;
      npc.x = nx; npc.y = ny;
      const nc = g.map.cell(nx, ny);
      if (nc) nc[1] = npc.index + 1;
      if (g.syncCharaCells) g.syncCharaCells();
      return { ok: true, action: 'aside', message: `${npc.name} 让开了路。` };
    }
    return { ok: false, message: '周围没有能站的空位。' };
  }

  function perform(g, npc, id, arg) {
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
      case 'identify': return identifyAll(g, npc, player);
      case 'identify-one': return identifyOne(g, npc, player, arg, 250);
      case 'investigate': return investigate(g, npc, player, arg);
      case 'train': return train(g, player, arg, npc);
      case 'learn': return learnSkill(g, player, arg, npc);
      case 'uncurse': return uncurseEquip(g, npc, player);
      case 'practice': return magicPractice(g, npc, player, arg);
      case 'stock-exchange': return magicStockExchange(g, npc, player, arg, false);
      case 'stock-exchange-all': return magicStockExchange(g, npc, player, 0, true);
      case 'quest-guide': return questGuide(g, npc, player);
      case 'rumor': return rumor(g, npc, player);
      case 'popularity': return popularity(g, npc, player);
      case 'town-info': return townInfo(g, npc, player);
      case 'barter': return barter(g, npc, player, arg);
      case 'arena-duel':
      case 'arena-rumble': {
        if (!Elona.Arena) return { ok: false, message: '竞技场尚未开放。' };
        const mode = id === 'arena-rumble' ? 'rumble' : 'duel';
        return Elona.Arena.start(g, npc, mode);
      }
      case 'arena-score': return { ok: true, message: Elona.Arena ? Elona.Arena.scoreText(g) : '（无记录）' };
      case 'pet-duel':
      case 'pet-team':
      case 'pet-ex': {
        if (!Elona.Arena) return { ok: false, message: '竞技场尚未就绪。' };
        const mode = id === 'pet-team' ? 'pet-team' : (id === 'pet-ex' ? 'pet-ex' : 'pet-duel');
        // 0-CF：宠物战进入地图实打（对手按出战宠物等级生成）
        return Elona.Arena.start(g, npc, mode, { petIndex: arg });
      }
      case 'recruit':
        return Elona.Party ? Elona.Party.recruit(g, npc) : { ok: false, message: '队伍系统尚未就绪。' };
      case 'hire-guard':
        return Elona.Party ? Elona.Party.hireGuard(g, npc, 7, 2000) : { ok: false, message: '队伍系统尚未就绪。' };
      case 'buy-slave': {
        if (!Elona.Party) return { ok: false, message: '队伍系统尚未就绪。' };
        const costS = 3000;
        if ((player.get(30) | 0) < costS) return { ok: false, reason: 'money', message: `需要 ${costS} gold。` };
        player.set(30, player.get(30) - costS);
        const rS = Elona.Party.addPet(g, 16, Math.max(1, player.level | 0), '奴隶');
        if (!rS.ok) { player.set(30, player.get(30) + costS); return rS; }
        return { ok: true, message: `买下了奴隶（-${costS} gold）。${rS.message}` };
      }
      case 'buy-horse': {
        if (!Elona.Party) return { ok: false, message: '队伍系统尚未就绪。' };
        const costH = 5000;
        if ((player.get(30) | 0) < costH) return { ok: false, reason: 'money', message: `需要 ${costH} gold。` };
        player.set(30, player.get(30) - costH);
        const rH = Elona.Party.addPet(g, 267, Math.max(1, player.level | 0), '駄馬');
        if (!rH.ok) { player.set(30, player.get(30) + costH); return rH; }
        return { ok: true, message: `买下了一匹马（-${costH} gold）。${rH.message}` };
      }
      case 'heal': return heal(g, player, npc);
      case 'companion-menu': return { ok: true, action: 'companion-menu', target: npc, message: '' };
      // 0-DH：evochat / 一緒に食事
      case 'evochat': return { ok: true, action: 'evochat', target: npc, message: '' };
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

  Elona.NPC = {
    ROLE_NAMES, SHOP_ROLES, loadTable, setSkillNames, skillName,
    roleOf, roleName, isShop, services, talk, meal, drink, identify,
    implevel, modImp, give, intel,
    trainableSkills, trainCost, train, heal, infoText, perform, aside,
    calcIdentifyValue, unknownItems, identifyOne, identifyAll, investigate,
    magicStockExchange, magicPractice, PRACTICE, questGuide, rumor, popularity,
    townInfo, barter,
    learnableSkills, learnSkill, uncurseEquip,
    enhanceCost, enhance, ammoSlots, reloadPlan, reload, AMMO_MAX, AMMO_NAMES,
    lighten, heavify, specialMeal, specialDrink, mealTargets,
    birthday, setBirthday, adventurers, adventurerInfo, sendMessage, applyMessage,
    ADV_MESSAGES, reserveBook, findItemSlot, consumeItem,
  };
})(window);
