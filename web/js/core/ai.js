'use strict';
/**
 * NPC 行为模块
 *
 * 【重要更正 / 结构说明】
 *   原版 `#deffunc ai_check`（start.hsp 592113-592171）**只有 58 行**，它并不是主 AI，
 *   而是一个「沿朝向扫描相邻格、发现敌对角色就记录为其目标」的辅助函数：
 *
 *       repeat 3
 *           ; 依 var_471（朝向：0 下 / 1 左 / 2 右 / 3 上）与 var_400（侧序标志），
 *           ; 用 var_505(cnt, var_400) 求侧向偏移，构造待检查格 (var_58(3), var_58(4))
 *           cell_check var_58(3, var_243), var_58(4, var_243)   ; 写回 var_787/788/789
 *           if var_787==1: break                                 ; 该格被阻挡
 *           if var_788!=-1:                                      ; 该格有角色
 *               if 我是同伴(9==10) 且 对方敌对(9==-3): var_58(29,我)=对方
 *               if 我是敌对(9==-3) 且 对方是同伴(9==10): var_58(29,我)=对方
 *       loop
 *       return 1 / 0
 *
 *   紧随其后的 592172-600573 是一个由全局标签组成的「子程序池」。经结构分析
 *   （`docs/ai_action_labels.txt` / `ai_action_skeleton.txt`）确认：
 *     - **NPC AI 主体 = `*label_4302..4312`（592172-596816）**；
 *       `*label_4302`(592172)=每回合动作入口（604836 `goto *label_4302` 进入）、
 *       `*label_4303`(592969)=远程/道具/能力分派、`*label_4304`(593113)=装备道具分派、
 *       `*label_4305`(593147)=交战决策、`*label_4306`(593420)=接近/移动、
 *       `*label_4307`(593464)=随机游走、`*label_4308`(593529)=宠物/队友、
 *       `*label_4309`(593869)=攻击结算/走位、`*label_4310/4311`=单轴步进、
 *       `*label_4312`(594434)=特殊生物行为大分支（入口 593351 / 594156）。
 *     - **`4313-4336`（596817-600573）不是 AI**，而是帮助/笔记 UI、config.txt 读写、
 *       房间/网络配置等解析器（已排除，不在移植范围）。
 *
 * 【本模块的移植范围】
 *   - adjacentCheck()：忠实实现上面的 ai_check 相邻扫描（var_505 表未从数据中提取，
 *     改用 8 邻域等价语义——即「找出相邻的敌对角色」，已标注为近似）。
 *   - mercyCheck()：忠实实现 *label_4302 开头的**求饶/怜悯**（592173-196）。
 *   - mountSync()：忠实实现 *label_4302 的**坐骑坐标同步**（592289-291）。
 *   - npcTurn()：*label_4302 的**通用决策子集**：
 *       求饶/怜悯 → 坐骑同步 → 目标获取（var_58(29) → 否则最近敌对）
 *       → 相邻则攻击 → 否则朝目标移动。
 *   - combatStatusSkip()：*label_4305 交战决策开头的**盲目 / 混乱阻断**
 *       （593152-593162 / 593326-593329，两级盲目合计 90%、混乱 60%）。
 *   - 闲时 AI（0-Z9）：tamerIdle() 承接 wiki「通用闲时 AI」12 项（調教鞭 var_58(202)，
 *       593693-593872）；idleGate / drunkCatIdle / nightSleepIdle / pocketSupplyIdle /
 *       snowPlayIdle / allyEatIdle 承接 wiki「专属闲时 AI」与通用入口（593420-593690）。
 *   - 【未实现，不得视为原版行为】：施法、使用道具、**远程攻击**、群体/召唤、
 *     神罚、剧情特例，以及 `var_58(27)` **特殊生物分支（共 338 个 id / 414 处 ==）**。
 *     —— 这些依赖区间外、尚未移植的叶子例程
 *        （2950 / 2958 / 2983-2986 / 3016 / 2960 / 2975 / 2978 / 2174 / 2111 / 0258 / 4358）
 *        与外部数据表（`var_58(211)`/`var_58(202)` 动作 id、物品 type 码、`var_1017` 距离表）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));   // HSP 整数除法（向零截断）

  // 八方向偏移（先直向再斜向）
  const DIRS8 = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

  // var_471 朝向语义（由 ai_check 的坐标分支反推）
  const DIR = { S: 0, W: 1, E: 2, N: 3 };

  /** 敌对判定：var_58(9) == -3（gohostile 行 31654）；非敌对为 >= -1 */
  function isHostile(c) { return c.get(9) === -3; }

  /** 两者是否敌对：一方 -3、另一方 >= -1（对应 212492 的敌意判定） */
  function hostileTowards(a, b) {
    if (!a || !b) return false;
    const ra = a.get(9), rb = b.get(9);
    if (ra === -3 && rb >= -1) return true;
    if (rb === -3 && ra >= -1) return true;
    return false;
  }

  /**
   * 忠实实现 ai_check —— 沿朝向 dir 扫描 3 个候选格，找相邻敌对目标。
   * 命中时写入 c.set(29, 目标索引) 并返回目标索引，否则返回 -1。
   *
   * 【近似】原版侧向偏移取自 var_505(cnt, var_400)（未从数据中提取），
   * 这里用 {-1,0,+1} 的侧向偏移等价表达「沿该朝向的 3 个相邻格」。
   * 【对应源码】592114-592171（var_787/788/789 由 cell_check 写回）。
   */
  function adjacentCheck(g, c, dir, side) {
    const list = side ? [1, 0, -1] : [-1, 0, 1];
    for (const o of list) {
      let tx, ty;
      if (dir === DIR.E) { tx = c.x + 1; ty = c.y + o; }
      else if (dir === DIR.W) { tx = c.x - 1; ty = c.y + o; }
      else if (dir === DIR.N) { ty = c.y - 1; tx = c.x + o; }
      else { ty = c.y + 1; tx = c.x + o; }

      if (!g.map.inBounds(tx, ty)) continue;          // var_787 越界 → 阻挡
      const chk = g.map.check(tx, ty);
      if (!chk.walkable && chk.charaIndex < 0) continue;   // 阻挡且无角色
      const ci = chk.charaIndex;                      // var_788
      if (ci >= 0 && ci !== c.index) {
        const other = g.charas[ci];
        if (other && hostileTowards(c, other)) { c.set(29, ci); return ci; }
      }
    }
    c.set(29, -1);
    return -1;
  }

  /** 在 8 邻域中寻找最近的敌对角色（原版由 *label_4310/4311 + ai_check 组合完成） */
  function findNearestHostile(g, c) {
    let best = -1, bestD = 1e9;
    for (const other of g.charas) {
      if (!other || other.index === c.index) continue;
      if (other.get(0) !== 1) continue;
      if (!hostileTowards(c, other)) continue;
      const d = Elona.Battle.dist(c.x, c.y, other.x, other.y);
      if (d < bestD) { bestD = d; best = other.index; }
    }
    return best;
  }

  /** 0-EU：把 `findNearestHostile` 的下标换成角色对象（没有则 null） */
  function nearestHostileOf(g, c) {
    const idx = findNearestHostile(g, c);
    if (idx < 0) return null;
    return g.charas[idx] || (g.charas.find((x) => x && x.index === idx) || null);
  }

  /**
   * 过回合闲聊 —— 忠实实现 *label_4302 的两段（592841-592912）。
   *
   * 【第一段：教说话独白】592841-592855
   *   `var_63(4) != ""`（玩家教过它一句话，cbit 989 == 0 表示不是口吻文件）且 `rnd(30)==0`
   *   → 直接把这句独白显示到消息栏（`txt_select var_63(4)`），然后 `goto *label_4303`。
   *
   * 【第二段：台词闲聊】592871-592912
   *   门控：`var_58(23)!=0`（能说话）或 `cbit(989)`（有自定义口吻）；`cbit(965)==0`（未静音）；
   *         `var_58(26) \ 5 == 0`（每 5 回合）；`rnd(4)==0`；玩家在 ±10 格；玩家 var_140!=6。
   *   类型：`cbit(1049)==0`（未求饶）时，按 `var_201>0`（有戒心）+ 无 buff40 → 101，否则 100；
   *         `cbit(1049)!=0`（求饶过）→ 149（txtClementia）。
   *   台词来源：自定义口吻文件 / 种族固有台词（label_4269，见 talk.js 第 5 层）。
   *
   * @returns {string|null} 'talk'（教说话独白）或 talkType（数字）或 null
   */
  function greetTalk(g, c) {
    const p = g && g.player;
    if (!p || !Elona.Talk || !Elona.Talk.speak) return null;
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    const cb = (n) => (Elona.Status && Elona.Status.cbit ? (Elona.Status.cbit(c, n) | 0) : 0);

    // ---- 第一段：教说话独白（592841-592855）----
    const talkText = c.talkText || '';
    if (talkText && cb(989) === 0 && R(30) === 0) {
      if (g.log) g.log(`${c.name}「${talkText}」`);
      return 'talk';
    }

    // ---- 第二段：台词闲聊（592871-592912）----
    if ((c.get(23) | 0) === 0 && cb(989) === 0) return null;       // 592871
    if (cb(965) !== 0) return null;                                // 592872 静音
    if (((c.get(26) | 0) % 5) !== 0) return null;                  // 592874 每5回合
    if (R(4) !== 0) return null;                                   // 592875
    if (Math.abs((c.x | 0) - (p.x | 0)) > 10) return null;         // 592876-877
    if (Math.abs((c.y | 0) - (p.y | 0)) > 10) return null;
    if ((p.get(140) | 0) === 6) return null;                       // 592879 玩家行动中

    let type = null;
    if (cb(1049) === 0) {                                          // 未求饶
      const guard = (Elona.Status && Elona.Status.findbuff)
        ? (Elona.Status.findbuff(c, 40) >= 0) : false;             // findbuff 40
      if ((c.get(201) | 0) > 0) type = guard ? null : 101;         // 有戒心 → Aggro
      else type = 100;                                             // Calm
    } else {
      type = 149;                                                  // 求饶过 → Clementia
    }
    if (type === null) return null;
    try { Elona.Talk.speak(g, c, type); } catch (e) { /* 无台词表静默 */ }
    return type;
  }

  /**
   * 求饶/怜悯 —— 忠实实现 *label_4302 开头（592173-196）
   *
   *   若 `var_58(50) <= var_58(51)/20`（HP <= 最大HP/20）且 `rnd(5)==0`（每回合 20%），
   *   则「命乞い」：置恐惧状态 `var_58(255) = rnd(20)+50`，并置 `cbit(1049)` 以免重复。
   *   下列情况抑制（592178-180）：`var_65(20)==40` / 与玩家同阵营(9==10) / `var_243<16`
   *   / `cbit(992)` / `var_58(25)>=4` / `var_58(150)!=0` / `cbit(976)` / `var_58(197)==10`
   *   / `cbit(963)` / `var_65(250+306)==var_243`。若 `cbit(985)==1` 也抑制（592182）。
   *
   * 【未确认】`var_65(20)`、`var_65(250+306)` 的含义 → 分别以 g.var65_20 / g.masterIndex 注入，
   *   缺省视为「不抑制」。
   * 【未移植】原版用 txt_select 弹出「話を聞いてやろうか？」交互提示，本实现仅记日志。
   * @returns {boolean} 本回合是否触发求饶
   */
  function mercyCheck(g, c) {
    if (!Elona.Status) return false;                          // 依赖 cbit/cbitmod
    if (c.hp > idiv(c.hpMax, 20)) return false;               // 592173
    if (g.rng.rnd(5) !== 0) return false;                     // 592174
    if (Elona.Status.cbit(c, 1049) !== 0) return false;       // 592175 已求饶
    const suppressed =
      (g.var65_20 === 40) ||                                  // var_65(20)==40（未确认）
      c.get(9) === 10 ||                                      // 同伴
      c.index < 16 ||                                         // 低索引角色不参与
      Elona.Status.cbit(c, 992) === 1 ||
      c.get(25) >= 4 ||                                       // 高阶生物
      c.get(150) !== 0 ||
      Elona.Status.cbit(c, 976) === 1 ||
      c.get(197) === 10 ||
      Elona.Status.cbit(c, 963) === 1 ||
      (g.masterIndex !== undefined && g.masterIndex === c.index);   // var_65(250+306)==var_243（未确认）
    if (suppressed) return false;                             // 592178-180
    if (Elona.Status.cbit(c, 985) === 1) return false;        // 592182
    c.set(255, g.rng.rnd(20) + 50);                           // 592183 恐惧
    Elona.Status.cbitmod(c, 1049, true);                      // 592191
    if (g.log) g.log(`${c.name} 因恐惧开始求饶（命乞い）。`);
    return true;
  }

  /**
   * 坐骑坐标同步 —— 忠实实现 *label_4302（592289-291）
   *   `var_58(168)==1` 时：`var_58(1)=var_58(1, var_58(167))`、`var_58(2)=var_58(2, var_58(167))`。
   * 【不臆测语义】原版只做单向同步（把本角色坐标写成 var_58(167) 所指角色坐标），
   *   本实现照抄该方向，不对「谁骑谁」做解释。
   * @returns {boolean} 是否发生同步
   */
  /**
   * 592289-592291：**タッグの追随側**（var_58(168,c) == 1）每回合把自己的坐标设成
   * ベース（var_58(167,c)）的坐标 —— 原版「ベースが移動権を握り、追随側は移動を省略して
   * 攻撃に専念する」(403518)。骑乘的坐标同步在 riding.js，不在这里。
   */
  function mountSync(g, c) {
    if (c.get(168) !== 1) return false;
    const m = g.charas[c.get(167)];
    if (!m) return false;
    c.x = m.x; c.y = m.y;
    return true;
  }

  /**
   * 远程/施法/能力分支 —— *label_4303（592969-593034）逐字移植。
   *   条件：HP < 最大HP/4（592970）且 `var_58(211)!=0`（593005）且 `cbit(1049)==0`（593007）
   *        且 `var_58(55)>0 | rnd(5)==0`（593008，有 MP 或有 20% 概率硬放）。
   *   id = `var_58(211)`：
   *     - id∈{619,714,23,760}：超程或视线不通 → 走位（`*label_4309`，此处仅返回 reposition）
   *     - id∈[400,492)：`gosub *label_2950`（通用施法）
   *     - id>=600：`gosub *label_2958`（怪物能力）
   * 【未实现】`*label_4309` 的走位求值、2950/2952 的玩家 MP/失败率流程。
   * 【部分实现】2960 效果分派目前仅含 buff 系与 type 2（见 spell.js）。
   */
  function castBranch(g, c) {
    if (!Elona.Spell) return { cast: false };
    if (!(c.hp < idiv(c.hpMax, 4))) return { cast: false };                 // 592970
    const id = c.get(211);
    if (id === 0) return { cast: false };                                   // 593005
    if (Elona.Status && Elona.Status.cbit(c, 1049) !== 0) return { cast: false };  // 593007
    // 0-CQ：觉醒天赋「魔法封印」(cbit 1046) —— 411789 的 toggle
    if (Elona.Status && Elona.Status.cbit(c, 1046) !== 0) return { cast: false };
    if (!(c.get(55) > 0 || g.rng.rnd(5) === 0)) return { cast: false };     // 593008

    let tIdx = c.get(29);
    if (!(tIdx >= 0) || !g.charas[tIdx]) tIdx = findNearestHostile(g, c);
    if (tIdx < 0) return { cast: false };
    const target = g.charas[tIdx];

    // id∈{619,714,23,760}：超程或不可见则走位（593010-593014 → *label_4309）
    if (id === 619 || id === 714 || id === 23 || id === 760) {
      // 射程 = `var_83(3, 656) \ 1000 + 1`（0-Q0 / Q-N1 取余：3006 → 7 格）
      const r656 = sightRange();
      const d = Elona.Battle.dist(c.x, c.y, target.x, target.y);
      if (d > r656 || Elona.Spell.fovLos(g, c.x, c.y, target.x, target.y) === 0) {
        return { cast: false, reposition: true, target };
      }
    }

    let r = null;
    if (id >= 400 && id < 492) {
      r = Elona.Spell.cast(g, c, id, target);                               // gosub *label_2950
      // 593018 → label_2950 → label_2157：成功咏唱后练「咏唱」172
      if (r && r.ok !== false && Elona.Spell.grantCastExp) {
        Elona.Spell.grantCastExp(g, c, id, target);
      }
    } else if (id >= 600) r = Elona.Spell.cast(g, c, id, target);          // gosub *label_2958
    else return { cast: false };

    if (r.ok && r.implemented) {
      if (g.log) {
        const nm = Elona.Spell.actionName(id);
        g.log(`${c.name} 使用了「${nm ? (nm.ch || nm.jp) : id}」。`);
      }
      return { cast: true, result: r, target };
    }
    if (r.ok && r.nothing) return { cast: true, nothing: true, target };
    return { cast: false, result: r, target };
  }

  /**
   * 0-DH / 0-Z36：同伴的拾食 / 捡拾（593180-593330 的 AI 分支）。
   *
   * 源码（593180-593330）里同伴**只对两类东西动手**：
   *   ① 食物（`refitem(id,5) == 57000`）且不饱 → 当场吃掉（`*label_2984`，营养 +1250）；
   *   ② **金币 / 矿石 / 宝石**（`refitem(id,5) == 68000 | 77000`，且 `id <= 208`、
   *      `var_99(21) <= 0`（无主）、`ibit(5) == 0`、`var_126(6) != 5`（不在自己家））
   *      → `gosub *label_2978` 收进背包（金币走 label_2978 的 54/55 分支记到 var_58(30/31)）。
   * 其它物品一律不碰 —— 之前本项目「脚下所有无主物品都捡」，同伴会把地城里的
   * 装备/垃圾全搬空。开关仍是调教鞭的 cbit 1033（拾い食い）/ 1032（アイテム拾い）。
   *
   * @returns {{used:boolean, kind?:string}}
   */
  function tryPetPickup(g, c) {
    if (!(Elona.Party && Elona.Party.isAlly && Elona.Party.isAlly(c))) return { used: false };
    if (!g.groundItems || !g.groundItems.length) return { used: false };
    const CB = (n) => (Elona.Status && Elona.Status.cbit ? Elona.Status.cbit(c, n) : 0);
    const here = [];
    for (const it of g.groundItems) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if ((it.f[5] | 0) !== (c.x | 0) || (it.f[6] | 0) !== (c.y | 0)) continue;
      if (g.isOwnedItem ? g.isOwnedItem(it) : !!it.townOwned) continue;   // 有主的不动
      here.push(it);
    }
    if (!here.length) return { used: false };
    const ref = (id, f) => ((Elona.ItemDB && Elona.ItemDB.ref) ? (Elona.ItemDB.ref(id, f) | 0) : 0);
    const ibit = (b, it) => ((Elona.ItemDB && Elona.ItemDB.ibit) ? (Elona.ItemDB.ibit(b, it) | 0) : 0);
    const nmOf = (it) => ((Elona.ItemDB && Elona.ItemDB.name)
      ? Elona.ItemDB.name(it.id, 'jp') : ('item ' + it.id));
    const mt = (g.map && g.map.header) ? (g.map.header[6] | 0) : 0;

    // ① 拾い食い（593193-593260 的食物分支，末尾 goto *label_2984）
    for (const it of here) {
      const cat = ref(it.id, 5);
      if (cat !== 57000) continue;
      if ((c.get(22) | 0) > 10000) continue;          // 不饱（var_58(22) <= 10000）
      if (CB(1033) !== 0) continue;                    // 拾い食い被禁止
      it.f[0] = (it.f[0] | 0) - 1;
      if (it.f[0] <= 0) g.groundItems.splice(g.groundItems.indexOf(it), 1);
      c.set(22, (c.get(22) | 0) + 1250);
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
      if (g.log) g.log(`${c.name}捡起地上的${nmOf(it)}吃掉了。`);
      return { used: true, kind: 'eat-ground' };
    }

    // ② アイテム拾い（593280-593300：68000 金币 / 77000 矿石宝石，id <= 208）
    for (const it of here) {
      const cat = ref(it.id, 5);
      if (cat !== 68000 && cat !== 77000) continue;
      if ((it.id | 0) > 208) continue;
      if ((it.f[21] | 0) > 0) continue;                 // var_99(21) <= 0
      if (ibit(5, it) !== 0) continue;                  // 不可拾标记
      if (mt === 5) continue;                           // var_126(6) != 5（自己家）
      if (CB(1032) !== 0) continue;                     // アイテム拾い被禁止
      const nm = nmOf(it);
      // 341874-341935：金币(54)/白金币(55) 不进背包，累加到 var_58(30/31)；
      //   白金币另计 var_65(291)，持有 >=100 时不再拾取。
      const iid = it.f[3] | 0;
      if (iid === 54 || iid === 55) {
        const n = it.f[0] | 0;
        if (iid === 55 && (c.get(31) | 0) >= 100
          && (g.getV65 ? (g.getV65(273) | 0) : 0) !== 2
          && (g.getV65 ? (g.getV65(273) | 0) : 0) !== 5) continue;
        it.f[0] = 0;
        if (iid === 54) c.set(30, (c.get(30) | 0) + n);
        else {
          c.set(31, (c.get(31) | 0) + n);
          if (g.setV65) g.setV65(291, ((g.getV65 ? g.getV65(291) : 0) | 0) + n);
        }
        g.groundItems.splice(g.groundItems.indexOf(it), 1);
        if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
        if (g.log) g.log(`${c.name}捡起了${nm}。`);
        return { used: true, kind: 'pick-ground' };
      }
      // 矿石 / 宝石：整堆放进同伴背包（342355-342365 的 _s 分支）
      if (!c.inv) c.inv = [];
      let slot = -1;
      for (let k = 0; k < c.inv.length; k++) {
        if (!c.inv[k] || (c.inv[k].f[0] | 0) <= 0) { slot = k; break; }
      }
      if (slot < 0 && c.inv.length >= 60) return { used: false };
      const copy = (Elona.Item && Elona.Item.fromJSON)
        ? Elona.Item.fromJSON(it.toJSON()) : { id: it.id, f: it.f.slice() };
      copy.f[21] = 0;
      if (slot < 0) c.inv.push(copy); else c.inv[slot] = copy;
      g.groundItems.splice(g.groundItems.indexOf(it), 1);
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
      if (g.log) g.log(`${c.name}捡起了${nm}。`);
      return { used: true, kind: 'pick-ground' };
    }
    return { used: false };
  }

  /**
   * 0-N0 / A328：PC 视野半径 —— 源码 594073 / 594080 / 594539 的
   * `var_83(3, 656) \ 1000 + 1`（656 = 鼓舞，f3 = 3006）。
   *
   * HSP 的 `\` 是**取余**而非整数除，铁证：
   *   6896  `var_65(12) \ 2 == 0`      判「日」为偶数
   *   21636 `var_65(250+274) \ 10 == 0` 取个位
   *   605016 `(var_123 + 1) \ 4`       日志环形缓冲下标 0..3
   * 故 3006 \ 1000 + 1 = 7 格。
   *
   * 【0-Q0 / Q-N1 全局纠正】0-N0 只在 `sightRange()` 按源码取余，其余模块仍按
   *   `floor(f3/1000)+1` 实现成 4 格。本批已把 `dirsel / aim / spell / buffact /
   *   gauge / melee / potion / social / teach` 等全部改为取余，并同步
   *   `verify_spell_range.js` 等验证基准；`f3 / 1000 * 1000`（整除）的**类别判定**不变。
   */
  function sightRange() {
    const f3 = (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(656, 3) | 0) : 0;
    const base = f3 || 3006;                       // 表未加载时用源码值兜底
    return (base % 1000) + 1;
  }

  /**
   * 交渉態勢の話術選択（596609-596630）：
   *   以 意志(15) 为基准，依次比较 感覚(13)/器用(12)/筋力(10)/魔力(16)/魅力(17)，
   *   取最高的一项决定招式（816 全力説得 / 817 渾身のギャグ / 818 少しの大嘘 /
   *   819 脅迫地獄 / 820 魔唱 / 875 響く声援）。
   */
  function talkAbilityId(c) {
    const s = (id) => (c.skill(id) | 0);
    let best = s(15), id = 816;
    if (s(13) > best) { best = s(13); id = 817; }
    if (s(12) > best) { best = s(12); id = 818; }
    if (s(10) > best) { best = s(10); id = 819; }
    if (s(16) > best) { best = s(16); id = 820; }
    if (s(17) > best) { best = s(17); id = 875; }
    return id;
  }

  /** 在角色背包中按物品 id 查找（等价原版 inv_find） */
  function findInvItem(c, id) {
    for (const it of (c.inv || [])) if (it.f[3] === id) return it;
    return null;
  }

  /**
   * *label_4303 592970-593004：HP < max/4 时喝「治疗药」(inv_find 1023) —— 逐字移植。
   * 回复量 = ((skill151+skill12)/4 * (skill151+skill12))/10 + 10；并把 毒/盲目/麻痺/酔/出血 各减为 /8+1。
   */
  function tryHealPotion(g, c) {
    if (!(c.hp < idiv(c.hpMax, 4))) return { used: false };              // 592970
    const it = findInvItem(c, 1023);                                     // 592971 inv_find 1023
    if (!it || it.f[0] <= 0) return { used: false };
    it.f[0]--;                                                           // 592981
    const sk = c.skill(151) + c.skill(12);
    if (Elona.Status) Elona.Status.healhp(c, idiv(idiv(sk, 4) * sk, 10) + 10);   // 592985
    for (const f of [250, 253, 252, 257, 258]) {                         // 592986-593000
      if (c.get(f) !== 0) c.set(f, idiv(c.get(f), 8) + 1);
    }
    if (g.log) g.log(`${c.name} 喝下了治疗药。`);
    return { used: true, kind: 'heal_potion' };
  }

  /**
   * *label_4303 593035-593072：var_58(58)==100（居民/队友）偶尔偷懒。
   * 4 选 1，其中只有「犯困」有状态副作用（var_58(251) += 20）；文本分支省略。
   */
  function tryIdle(g, c) {
    if (c.get(58) !== 100) return { used: false };                       // 593035
    if (!((g.var65_189 || 0) + 20 <= g.rng.rnd(c.level))) return { used: false };   // 593036
    if (!(c.get(169) + 500 <= g.rng.rnd(2000))) return { used: false };  // 593037
    const r = g.rng.rnd(4);                                              // 593038 var_1454
    if (r === 3) c.set(251, c.get(251) + 20);                            // 593062-593066
    return { used: true, kind: 'idle', roll: r };
  }

  /**
   * *label_4303 593073-593112：var_58(12) > 0 → 使用被指定的道具。
   * 按 refitem 类别分派到 2983(读/使用 mode13)、2984(吃 mode14)、2985(饮 mode15)。
   * 【近似】var_58(12) 在本项目视为「背包下标」（原版是 var_99 槽号）。
   */
  function tryUseItem(g, c) {
    if (c.get(12) <= 0) return { used: false };                          // 593073
    const item = (c.inv || [])[c.get(12)];                                // 593076 var_579
    if (!item || item.f[0] === 0) { c.set(12, 0); return { used: false }; }   // 593077-593079
    // 瓶塞发射器（effect 115）：宠物有 1/2 几率使用；
    // 弹药为 0 时 `bottleUse` 会自己花 4 个瓶塞装填（353000-353022）
    if (((item.f[19] | 0) === 115) && Elona.ItemFx) {
      c.set(12, 0);
      if (g.rng.rnd(2) !== 0) return { used: false };                     // wiki：1/2 几率
      const bt = Elona.Throw ? Elona.Throw.nearestEnemy(g, c, 6) : null;  // 射程 6
      if (!bt) return { used: false };
      const br = Elona.ItemFx.dispatch(g, item, { user: c, target: bt, confirm: true });
      return { used: !!(br && br.ok), kind: 'bottle', result: br };
    }
    const cat = Elona.ItemDB ? Elona.ItemDB.ref(item.f[3], 5) : 0;        // 593081 var_1245
    let mode = null;
    if (cat === 57000 || (Elona.Status.cbit(c, 1050) === 1 && item.f[24] === 35)) mode = 14;   // 593082-593103 → 2984
    else if (cat === 52000) mode = 15;                                   // 593104-593105 → 2985
    else if (cat === 53000 && Elona.ItemDB.ref(item.f[3], 9) !== 53100) mode = 13;             // 593107-593110 → 2983
    c.set(12, 0);                                                        // 593112
    if (mode === null) return { used: false };
    const r = Elona.ItemUse ? Elona.ItemUse.use(g, c, item, mode, c) : { implemented: false };
    if (g.log && r.implemented) g.log(`${c.name} 使用了道具。`);
    return { used: true, kind: 'item', mode, result: r };
  }

  /**
   * 单个 NPC 的回合 —— *label_4302 的通用决策子集。
   * 顺序：①求饶/怜悯 → ②坐骑同步 → ③*label_4303（喝水→施法→偷懒→用道具）→
   *       ④沿 8 朝向用 adjacentCheck 尝试锁定相邻目标 → ⑤相邻则攻击 → ⑥否则朝目标走一步。
   * @returns {Object} { acted, attacked, moved, cast, target, mercy, mounted }
   */
  /**
   * 使役死灵（cbit 992）的回合 —— 592576-592591 / 594078 的等价实现。
   *
   * 原版行为（wiki + 源码）：
   *   - 死灵几乎不主动索敌，**只攻击主人锁定的目标**（var_58(29)）；
   *   - 无目标时跟在主人身边（594078-594085：把移动目标设为 var_58(1,0)/var_58(2,0)）；
   *   - 与主人失联（synccheck==0）时，1/2 概率直接传送到主人身旁（592579-592591 的 619）。
   *
   * @returns {object|null} null 表示「有目标，交回通用战斗流程」
   */
  function necroTurn(g, c) {
    const p = g.player;
    if (!p) return { acted: false };
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    const dx = (c.x | 0) - (p.x | 0), dy = (c.y | 0) - (p.y | 0);
    const distP = Math.max(Math.abs(dx), Math.abs(dy));

    // 592579-592591：失联（距离过远）→ 1/2 概率传送回主人身边
    if (distP > 12 && R(2) === 0) {
      const spot = Elona.Necro ? Elona.Necro.nearSpot(g, p.x, p.y) : { x: p.x, y: p.y };
      const cell = (g.map && g.map.cell) ? g.map.cell(c.x | 0, c.y | 0) : null;
      if (cell) cell[1] = 0;
      c.x = spot.x; c.y = spot.y;
      if (g.syncCharaCells) g.syncCharaCells();
      if (g.log) g.log(`${c.name} が主人の傍らに現れた。`);
      return { acted: true, moved: true, teleported: true };
    }

    // 目标：自己锁定的，否则继承主人的
    let tIdx = c.get(29) | 0;
    let target = (tIdx > 0 && tIdx < g.charas.length) ? g.charas[tIdx] : null;
    if (!target || (target.get(0) | 0) !== 1 || (target.hp | 0) <= 0) target = null;
    if (!target) {
      const pt = p.get(29) | 0;
      const cand = (pt > 0 && pt < g.charas.length) ? g.charas[pt] : null;
      if (cand && (cand.get(0) | 0) === 1 && (cand.hp | 0) > 0 && cand.index !== 0) {
        target = cand;
        c.set(29, target.index);
      }
    }
    // 592592-592591：无目标 → 回到主人身边待命
    if (!target) {
      c.set(29, 0);
      if (distP > 1) {
        const step = stepToward(g, c, { x: p.x, y: p.y });
        if (step) return { acted: true, moved: true, follow: true };
      }
      return { acted: false, idle: true };
    }
    // 有目标 → 相邻攻击 / 否则接近
    const d = Elona.Battle.dist(c.x, c.y, target.x, target.y);
    if (d === 1) {
      const r = attackTarget(g, c, target);
      return { acted: true, attacked: true, target, result: r };
    }
    const step = stepToward(g, c, target);
    if (step) return { acted: true, moved: true, target };
    return { acted: false, target };
  }

  /**
   * 593152-593162 / 593326-593329：盲目 / 混乱对交战决策的阻断。
   *
   * 源码 *label_4305（交战决策）开头，在 `if (var_58(201)>0 | var_58(9)==10)`
   * 分支内：
   *   if ( var_58(253,var_243) != 0 ) { if ( rnd(10) > 2 ) goto *label_4306 }  // 盲目第一级 70%
   *   if ( var_58(254,var_243) != 0 ) { if ( rnd(10) > 3 ) goto *label_4306 }  // 混乱 60%
   * 同块 593326-593329（仍在上述分支内）还有第二级盲目：
   *   if ( var_58(253,var_243) != 0 ) { if ( rnd(3) ) goto *label_4306 }       // 约 66.7%
   *
   * 两级盲目录计命中率 = 0.7 + 0.3*(2/3) = 0.9（90%），与 wiki「失明 90% 跳过战时 AI」
   * 一致；wiki 的「混乱 60%」与源码 60% 一致。goto *label_4306 表示跳过整段交战决策
   * （含交涉/防御/攻击/走位的选招），转入 *label_4306 的接近 / 闲时 / 待机分支。
   *
   * 【wiki 与源码差异】wiki 把「失明 90%」写成单次判定；源码实为 70% 与 66.7% 两级串联，
   *   本实现按源码两级判定，不采用 wiki 的单次 90%。
   * 【恐惧】wiki 称恐惧会逃跑；但 AI 主体 592172-596816 没有任何以 var_58(255) 为条件的
   *   逃跑分支，343465（*label_2990 移动例程）仅有 `255>0 → end turn` 的阻断，故本项目
   *   不移植「恐惧逃跑」，只按源码在攻击 / 移动结算处阻断。
   *
   * @returns {string|null} 'blind' / 'confusion' / null（null = 不阻断）
   */
  function combatStatusSkip(g, c) {
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    const blind = (c.get(253) | 0) !== 0;
    const confused = (c.get(254) | 0) !== 0;
    // 源码判定顺序：593152 盲目一级 → 593156 混乱 → 593326 盲目二级。
    if (blind) {
      if (R(10) > 2) return 'blind';      // 593152-593154 70%
    }
    if (confused) {
      if (R(10) > 3) return 'confusion';  // 593156-593162 60%
    }
    if (blind) {
      if (R(3) !== 0) return 'blind';     // 593326-593329 约 66.7%
    }
    return null;
  }

  /* ================================================================
   * 闲时 AI（*label_4306 / 4307 / 4308，593420-593690）
   * wiki 的「通用闲时 AI」12 项由 tamerIdle() 承接（調教鞭 var_58(202)）；
   * 以下补上 wiki「专属闲时 AI」与通用入口在源码中的真实分支。
   * ================================================================ */

  /** 593421-593423：防御態勢（mode==1）跳过闲时 AI —— npcTurn 的 mode 分派已拦截。 */
  function idleModeBlocked(g, c) { return (c.get(266) | 0) === 1; }

  /**
   * 593420-593454：*label_4306 闲时入口。
   *   593429-593435：202==4「跟着我」或牧畜（cbit1012==0 & 177!=0 & cbit960==1）
   *                  → goto *label_4309 接近玩家。
   *   593452-593454：index>=16（非宠物）`rnd(5)!=0` → 80% 直接发呆。
   */
  function idleGate(g, c) {
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    const cbit = (b) => (Elona.Status && Elona.Status.cbit ? (Elona.Status.cbit(c, b) | 0) : 0);
    const follow = (c.get(202) | 0) === 4
      || (cbit(1012) === 0 && (c.get(177) | 0) !== 0 && cbit(960) === 1);
    if (follow) {
      const p = g.player;
      if (!p) return { follow: true, idle: true };
      const moved = !!stepToward(g, c, { x: p.x, y: p.y });
      return { acted: moved, moved, follow: true };
    }
    // 593452-593454
    if ((c.index | 0) >= 16 && R(5) !== 0) return { blocked: true };
    return null;
  }

  /**
   * 593455-593517：醉酒猫族（var_58(257)）加深醉意并唱歌。
   *   源码 593457-593462：`257<5 → +=40`（加深醉酒）；
   *   593464-593517 为 1/3 + 1/4 + 1/4 + 1/4 四段歌曲与兜底，文本层统一为一条日志。
   */
  function drunkCatIdle(g, c) {
    if ((c.get(257) | 0) === 0) return null;
    if (c.raceName !== 'cat') return null;
    if ((c.get(257) | 0) < 5) c.set(257, (c.get(257) | 0) + 40);
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    // 消费与源码同序列的随机数（rnd(3) → rnd(4) → rnd(4) → rnd(4)）。
    R(3); R(4); R(4); R(4);
    if (g.log) g.log(`${c.name} 唱起了酒歌。`);
    return { acted: true, drunkSing: true };
  }

  /**
   * 593529-593545：城镇居民夜间入睡。
   *   条件：index>=16、非死灵(cbit992)、地图!=94、mapType 3 或 2、
   *         小时 >=22 或 <7、var_58(140)==0、rnd(100)==0；
   *   效果 `dmgcon var_243, 2, 4000`（睡眠）。
   */
  function nightSleepIdle(g, c) {
    if ((c.index | 0) < 16) return null;
    const cbit = (b) => (Elona.Status && Elona.Status.cbit ? (Elona.Status.cbit(c, b) | 0) : 0);
    if (cbit(992)) return null;
    const gv = (i) => (g.getV65 ? (g.getV65(i) | 0) : 0);
    if (gv(20) === 94) return null;
    const mt = (g.map && g.map.header) ? (g.map.header[6] | 0) : 0;
    if (mt !== 3 && mt !== 2) return null;
    const hour = gv(13);
    if (!(hour >= 22 || hour < 7)) return null;
    if ((c.get(140) | 0) !== 0) return null;
    if ((g.rng ? g.rng.rnd(100) : 0) !== 0) return null;
    if (Elona.Resist && Elona.Resist.dmgcon && g.dmgconTable) {
      Elona.Resist.dmgcon(g, g.dmgconTable, c, 2, 4000);
    } else {
      c.set(251, (c.get(251) | 0) + 1);
    }
    if (g.log) g.log(`${c.name} 睡着了。`);
    return { acted: true, sleep: true };
  }

  /**
   * 593546-593565 / 593646-593690：没有持用道具时从「四次元袋」掏食物 / 药剂吃喝。
   *   593546：地图 13 且 var_65(70)==1009 且 rnd(30)==0 → 生成食物或药水写成持用(f[12])；
   *   593646：饥饿(var_58(22)<=10000) 时，4/5 直接增减饱食/水分，1/5 真生成物品。
   */
  function pocketSupplyIdle(g, c) {
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    const gv = (i) => (g.getV65 ? (g.getV65(i) | 0) : 0);
    const cbit = (b) => (Elona.Status && Elona.Status.cbit ? (Elona.Status.cbit(c, b) | 0) : 0);
    const make = (cls) => (Elona.Item && Elona.Item.create)
      ? Elona.Item.create(g, { t638: cls, level: 20 }) : null;
    const carry = (it) => {
      if (!it) return;
      c.inv = c.inv || [];
      c.inv.push(it);
      c.set(12, c.inv.length - 1);
    };
    // 593546：`if ( var_58(12)==0 ) { if ( var_58(9)!=10 ) { ... } }`
    // 两次元袋与饥饿吃喝都只对非同伴生效（同伴由 allyEatIdle 在 label_4305 处理）。
    if ((c.get(9) | 0) === 10) return null;
    if ((c.get(12) | 0) === 0 && gv(20) === 13 && gv(70) === 1009 && R(30) === 0) {
      const it = make(R(4) === 0 ? 57000 : 52000);
      carry(it);
      return { acted: true, pocket: true, item: it };
    }
    if ((c.get(22) | 0) <= 10000) {
      const depressed = cbit(986);
      if ((c.get(6) | 0) !== (g.var104 | 0) || R(5) !== 0) {
        c.set(22, (c.get(22) | 0) + (depressed ? -3000 : 5000));
        if ((c.get(446) | 0) <= 10000) c.set(446, (c.get(446) | 0) + 5000);
        return { acted: true, pocketEat: true };
      }
      const r = R(4);
      const cls = (r === 0 || depressed) ? 57000 : (r === 1 ? 52000 : 52002);
      const it = make(cls);
      carry(it);
      c.set(22, (c.get(22) | 0) + (depressed ? -3000 : 5000));
      if ((c.get(446) | 0) <= 10000) c.set(446, (c.get(446) | 0) + 5000);
      return { acted: true, pocketItem: true, item: it };
    }
    return null;
  }

  /**
   * 593567-593645：诺耶尔 / 妹之馆的大小姐与城里的小孩（种族 35 / 211）玩雪。
   *   地图 33 / 29、雪地地形（源码 var_593(0,cell)==4，这里按地图 id 近似）；
   *   1/4 向视野内目标扔雪球(587)、1/12 找地面物、1/10 堆雪人(541)、1/12 再扔。
   */
  function snowPlayIdle(g, c) {
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    if (mapId !== 33 && mapId !== 29) return null;
    const race = c.get(27) | 0;
    if (race !== 35 && race !== 211) return null;
    const make = (id) => (Elona.Item && Elona.Item.create)
      ? Elona.Item.create(g, { itemId: id, level: 1 }) : null;
    if (R(4) === 0) {
      const tgt = (Elona.Throw && Elona.Throw.nearestEnemy)
        ? Elona.Throw.nearestEnemy(g, c, 6) : null;
      if (tgt) return { acted: true, snowball: true, target: tgt, item: make(587) };
    }
    if (R(12) === 0) return { acted: true, snowball: true, item: make(587) };
    if (R(10) === 0 && !(g.groundItems || []).some((it) => it && (it.f[0] | 0) > 0 && it.f[5] === c.x && it.f[6] === c.y)) {
      const man = make(541);
      if (man && g.groundItems) { man.f[5] = c.x; man.f[6] = c.y; g.groundItems.push(man); }
      return { acted: true, snowman: true, item: man };
    }
    if (R(12) === 0) return { acted: true, snowball: true, item: make(587) };
    return null;
  }

  /**
   * 593181-593316：非死灵同伴（9==10、cbit992==0）尝试食用脚下的食物或饮用井 / 马桶。
   *   食物 57000 / 偏好食物(cbit1050 & f[24]==35)、井水 60001（排除圣井 602）。
   */
  function allyEatIdle(g, c) {
    if ((c.get(9) | 0) !== 10) return null;
    const cbit = (b) => (Elona.Status && Elona.Status.cbit ? (Elona.Status.cbit(c, b) | 0) : 0);
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    if (cbit(992)) return null;
    const here = (g.groundItems || []).filter((it) => it && (it.f[0] | 0) > 0
      && it.f[5] === c.x && it.f[6] === c.y);
    if (!here.length) return null;
    const it = here[here.length - 1];
    const cat = (Elona.ItemDB && Elona.ItemDB.ref) ? (Elona.ItemDB.ref(it.f[3], 5) | 0) : 0;
    if ((c.get(22) | 0) <= 10000 && (cat === 57000 || (cbit(1050) && (it.f[24] | 0) === 35))) {
      if ((it.f[21] | 0) <= 0) {
        if (cbit(1033)) {
          if (R(5) === 0 && g.log) g.log(`${c.name} 眼巴巴地看着食物……`);
          return { acted: false, watched: true };
        }
        if (!cbit(1032) || (c.get(169) | 0) <= 0) {
          if (g.eatItemNow) { try { g.eatItemNow(c, it); } catch (e) { /* 表现层可选 */ } }
          const idx = (g.groundItems || []).indexOf(it);
          if (idx >= 0) g.groundItems.splice(idx, 1);
          return { acted: true, ate: true, item: it };
        }
      }
    }
    if (cat === 60001 && cbit(1033) === 0 && (!cbit(1032) || (c.get(169) | 0) <= 0)) {
      if ((it.f[21] | 0) <= 1 && (it.f[25] | 0) >= -5 && (it.f[27] | 0) < 20 && (it.f[3] | 0) !== 602) {
        if (g.eatItemNow) { try { g.eatItemNow(c, it); } catch (e) { /* 表现层可选 */ } }
        return { acted: true, drank: true, item: it };
      }
    }
    return null;
  }

  /** 593455-593690 专属闲时行为的源码顺序汇合。 */
  function specialIdle(g, c) {
    return allyEatIdle(g, c)
      || drunkCatIdle(g, c)
      || nightSleepIdle(g, c)
      || pocketSupplyIdle(g, c)
      || snowPlayIdle(g, c)
      || null;
  }

  /**
   * 0-Z14：孩子（cbit1034 / 成长阶段 var_58(59)<0）的行动前特殊行为。
   * 源码 *label_4358 594466-594520：孩子按成长阶段掷 rnd(100) 走神，命中则
   *   「玩耍/东张西望/沉思/烦恼」后 `goto label_4358` 结束本回合（放弃正常行动）。
   * 其中 -1（思春期）用叛逆公式 limit(var_58(169),1,150)/10+80 <= rnd(100)。
   * 嗜睡（wiki）：幼儿/幼童每回合 5%、幼少期夜间 5%、成长期夜间 2% 入睡，
   *   时长 rnd(301)+100 / rnd(151)+50（项目用 var_58(251) 作睡眠回合数）。
   * 叛逆拒绝道具/指令（298308 / 340605）属交互层响应，不在 AI 自主决策里触发；
   *   思春期的「拒绝指令」概率已并入 distractionRate 的叛逆公式。
   * @returns {{acted:boolean}|null} 命中返回 acted（本回合结束），否则 null
   */
  function childAiPre(g, c) {
    const B = Elona.Birth;
    if (!B || !B.stageOf || B.stageOf(c) === null) return null;
    // 睡眠中的孩子本回合不行动（嗜睡是在清醒时判定入睡，之后由 251 持续）
    if ((c.get(251) | 0) !== 0) return { acted: true, childAsleep: true };
    const rnd = (n) => (g.rng ? g.rng.rnd(n) : 0);
    // 嗜睡判定（清醒时）
    if (typeof B.sleepiness === 'function' && typeof g.getV65 === 'function') {
      const hour = g.getV65(13) | 0;
      const sl = B.sleepiness(g, c, hour);
      if (sl && sl.sleep) {
        c.set(251, Math.max(1, sl.turns | 0));
        if (g.log) g.log(`${c.name} 睡着了。`);
        return { acted: true, childSleep: true, turns: sl.turns | 0 };
      }
    }
    // 走神判定（按成长阶段；叛逆期公式已含顺从度）
    if (typeof B.distractionRate === 'function' && typeof B.isDistracted === 'function') {
      if (B.isDistracted(g, c)) {
        const st = B.stageOf(c);
        const lines = { '-5': '正开心地打滚玩耍！', '-4': '蹦蹦跳跳地玩着！',
          '-3': '好奇地东张西望！', '-2': '一本正经地思考着！', '-1': '对自己的存在方式感到烦恼！' };
        if (g.log) g.log(`${c.name} ${lines[String(st)] || '发起了呆。'}`);
        return { acted: true, childDistracted: true, stage: st };
      }
    }
    return null;
  }

  function npcTurn(g, c) {
    if (!c || c.get(0) !== 1 || c.index === 0) return { acted: false };

    // 0-Z14：孩子行动前的走神/嗜睡判定（源码 594466-594520 的孩子分支）
    const childR = childAiPre(g, c);
    if (childR) return childR;

    // 592204-592205：NPC 行动开始时清零「同回合连续被击次数」（dmghp 的防连击减伤）
    if (c.get(444) !== 0) c.set(444, 0);

    // ① 求饶/怜悯（*label_4302 592173-196）—— 副作用，不终止本回合
    const mercy = mercyCheck(g, c);
    // ①-a A148 / 592858-592900：靠近玩家时的喊话（100 calm / 101 aggro / 149 clementia）
    const greet = greetTalk(g, c);
    // 记一份最近喊话类型，供 verify 断言（不影响存档/逻辑）
    if (greet !== null) c.__lastGreet = greet;
    // ② 坐骑坐标同步（592289-291）
    const mounted = mountSync(g, c);
    // ②-a 0-DH：同伴的拾い食い / アイテム拾い（调教鞭 746 的 cbit 1032 / 1033 门控）
    const pickR = tryPetPickup(g, c);
    if (pickR.used) return { acted: true, used: pickR.kind, merit: true, mercy, mounted };
    // ②-b 0-CW：使役死灵（cbit 992）—— 跟随主人 / 只攻击主人锁定的目标（592579 / 594078）
    if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 992)
      && (c.get(9) | 0) === 10) {
      const nr = necroTurn(g, c);
      if (nr && (nr.acted || nr.attacked)) {
        return Object.assign({}, nr, { mercy, mounted });
      }
    }
    // ②-c 0-J0 / 0-K0：被绳索拴住（cbit 968）—— 源码 592583-592625。
    //   逐行前置（592583-592591）：
    //     synccheck(var_243,-1) == 0    ← 角色与主角「不同步」（不在主角所在地图）
    //     var_58(253,0) == 0           ← 玩家未在特殊状态
    //     rnd(4) == 0                  ← 每回合 1/4 才挣扎
    //     var_126(6) != 1              ← 非世界地图
    //     cbit(968, var_243)           ← 被绳索拴住
    //     var_65(20) != 40             ← 非竞技场
    //   `synccheck` 的定义在 6432-6443：`var_58(6,c) == var_104 | c == var_65(183)`，
    //   项目里「与主角同侧」由 BuffEffects.syncCheck 等价给出；源码要求「不同步」，
    //   故此处取反。HSP 的 AI 循环遍历全部 245 个角色槽（含不在本地图者），
    //   这条分支本来就是给离队/异地图随从用的；项目 charas 只含本地图角色，
    //   对非同伴（syncCheck 为假）仍会照常挣扎。
    //   挣扎命中后：同伴（index<16）或 cbit 960 → 清行动/目标；其它角色
    //   1/2 出声抗议 + hostileaction(0, var_243)，再 1/4 自行解开绳索。
    //   分支末尾固定 `var_244=0; var_396=619; gosub *label_2960`（待机动作）
    //   并 `goto *label_4358` 结束本回合。
    const leashOutOfSync = !(Elona.BuffEffects && Elona.BuffEffects.syncCheck
      && Elona.BuffEffects.syncCheck(g, c));
    if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 968)
      && leashOutOfSync
      && (g.getV65(20) | 0) !== 40
      && (!g.player || (g.player.get(253) | 0) === 0)
      && (!g.map || !g.map.header || (g.map.header[6] | 0) !== 1)) {
      const rnd = (n) => (g.rng ? g.rng.rnd(n) : 0);
      if (rnd(4) === 0) {
        if ((c.index | 0) < 16 || Elona.Status.cbit(c, 960)) {
          c.set(201, 0);
          c.set(29, 0);
        } else {
          if (rnd(2)) {
            if (g.log) g.log(`${c.name}「住手！」`);
            // 592602 `hostileaction 0, var_243`：prm_912=玩家(0)、prm_913=该 NPC。
            // 0-J0 曾把两参数传反（NPC, 玩家），会撞上 194440 的 `prm_912>=16`
            // 直接 return，敌对反应完全没生效 —— 0-K0 按源码改正。
            if (Elona.Intimacy && Elona.Intimacy.hostileAction) {
              Elona.Intimacy.hostileAction(g, g.player, c);
            }
          }
          if (rnd(4) === 0) {
            Elona.Status.cbitmod(c, 968, false);
            if (g.log) g.log(`${c.name}解开了绳索。`);
          }
        }
        // 592616-592618：固定以 619（待机）收尾并结束回合。
        return { acted: true, leashed: true, ability: 619, mercy, mounted };
      }
    }
    // ③-a 治疗药（*label_4303 592970-593004）
    const healR = tryHealPotion(g, c);
    if (healR.used) return { acted: true, used: healR.kind, mercy, mounted };
    // ③-b 远程/施法/能力（*label_4303 593005-593034）
    const castR = castBranch(g, c);
    if (castR.cast) return { acted: true, cast: true, target: castR.target, result: castR.result, mercy, mounted };
    // ③-c 偷懒（*label_4303 593035-593072）
    const idleR = tryIdle(g, c);
    if (idleR.used) return { acted: true, used: idleR.kind, mercy, mounted };
    // ③-d 使用道具（*label_4303 593073-593112）
    const itemR = tryUseItem(g, c);
    if (itemR.used) return { acted: true, used: itemR.kind, result: itemR.result, mercy, mounted };

    // ③-e 593152-593162 / 593326-593329：盲目 / 混乱阻断交战决策。
    //   源码在 *label_4305 一开头判定，goto *label_4306 跳过整段交涉/防御/攻击/走位选招，
    //   转入接近 / 闲时 / 待机。本项目把「无目标」路径集中在 tamerIdle，故此处直接落到它。
    //   注：源本的 mode 3/1 分派位于 *label_4312（596606 起），在交战决策之后、被 skip 绕过，
    //   因此这里也要放在 mode 分派之前。
    const skipCause = combatStatusSkip(g, c);
    if (skipCause) {
      const idleR = tamerIdle(g, c, { mercy, mounted });
      if (idleR) return Object.assign(idleR, { combatBlocked: skipCause });
      return { acted: false, mercy, mounted, combatBlocked: skipCause };
    }

    // 0-DH：战斗模式（var_58(266)）的完整行为 —— 源码 596606-596672。
    const mode = c.get(266) | 0;
    // 交渉態勢（596606-596657）：不攻击，改用「話術」能力（816/817/818/819/820/875），
    //   按 意志15 / 感覚13 / 器用12 / 筋力10 / 魔力16 / 魅力17 中最高的那项选招式。
    if (mode === 3) {
      if ((c.get(140) | 0) === 0 && Elona.Spell) {
        const t = nearestHostileOf(g, c);
        if (t) {
          c.set(29, t.index);
          const id = talkAbilityId(c);
          const r = Elona.Spell.cast(g, c, id, t);
          if (r && r.ok && r.implemented) {
            const nm = Elona.Spell.actionName(id);
            if (g.log) g.log(`${c.name} 使用了「${nm ? (nm.ch || nm.jp) : id}」。`);
            return { acted: true, cast: true, talk: true, ability: id, target: t, result: r, mercy, mounted };
          }
        }
      }
      return { acted: false, mercy, mounted };
    }
    // 防御態勢（596659-596672）：不攻击；只有双方斗志(var_58(182))都 >= 2 时才用「撹乱」(711)，
    //   其余情况直接结束回合（`if (var_2773 != 711) goto *label_4358`）。
    if (mode === 1) {
      if ((c.get(140) | 0) === 0 && (c.get(182) | 0) >= 2 && Elona.Spell) {
        // 0-EU：`findNearestHostile` 返回的是**下标**（-1 = 没有），不是角色对象。
        //   旧代码直接把下标当角色用（`t.get(182)`），一旦有角色进入防御态势就会抛
        //   `t.get is not a function`，让整回合中断 —— 这里换回角色对象。
        const t = nearestHostileOf(g, c);
        if (t && (t.get(182) | 0) >= 2) {
          c.set(29, t.index);
          const r = Elona.Spell.cast(g, c, 711, t);
          if (r && r.ok && r.implemented) {
            if (g.log) g.log(`${c.name} 使用了「撹乱」。`);
            return { acted: true, cast: true, ability: 711, target: t, result: r, mercy, mounted };
          }
        }
      }
      return { acted: false, mercy, mounted };
    }

    // ④ 尝试相邻扫描（等价于原版 label_4310/4311 调用 ai_check）
    let tIdx = -1;
    for (const dir of [DIR.S, DIR.W, DIR.E, DIR.N]) {
      tIdx = adjacentCheck(g, c, dir, 0);
      if (tIdx >= 0) break;
    }
    // ④ 扫描失败则退化为「最近敌对」
    if (tIdx < 0) tIdx = findNearestHostile(g, c);
    if (tIdx < 0) {
      // 0-L0 / A342：没有敌对目标 = 原版 *label_4306 的「别行动时」路径，
      // 此时才由調教鞭写入的 f[202] 决定同伴是跟随、待机、游走还是发动本职动作。
      // 0-Z9：先按源码顺序走 *label_4306 入口（跟随/80%跳过）与 *label_4307/4308
      // 专属闲时（醉猫 / 夜间入睡），最后才落到 202 指令消费。
      const gate = idleGate(g, c);
      if (gate) {
        if (gate.blocked) return { acted: false, mercy, mounted, idleBlocked: true };
        return Object.assign(gate, { mercy, mounted });
      }
      const sp = specialIdle(g, c);
      if (sp) return Object.assign(sp, { mercy, mounted });
      const idleR = tamerIdle(g, c, { mercy, mounted });
      if (idleR) return idleR;
      return { acted: false, mercy, mounted };
    }

    c.set(29, tIdx);
    const target = g.charas[tIdx];
    const d = Elona.Battle.dist(c.x, c.y, target.x, target.y);

    // 0-N0 / A328：迎撃態勢（var_58(266) == 2）—— 源码 594073-594085 / 594539-594541。
    //   `var_243 < 16`（同伴）且满足
    //     `var_58(29, 我) == 0 | (mode == 2 | mode == 3 & dist(目标, PC) > sightRange)`
    //   时，594073-594085 把 `var_58(205/206)`（移动目标）改写成 PC 坐标；
    //   594539 同样条件则 `goto *label_4309`，跳过本次攻击结算、转为跟随移动。
    //   语义：迎撃的同伴只拦截进入 PC 视野的敌人，不追出视野；自己已跑出视野的折返。
    //   交渉（mode 3）有独立分支（596606-596657，见上），此处不重复处理。
    //   此前项目完全没有 mode==2 分支，迎撃等同突撃（会一路追到地图另一端）。
    if (mode === 2 && (c.index | 0) < 16 && g.player) {
      const pc = g.player;
      const R = sightRange();
      const farTarget = Elona.Battle.dist(target.x, target.y, pc.x, pc.y) > R;
      const farSelf = Elona.Battle.dist(c.x, c.y, pc.x, pc.y) > R;
      if (farTarget || farSelf) {
        const step = stepToward(g, c, pc);
        return { acted: !!step, moved: !!step, intercept: true, target, mercy, mounted };
      }
    }

    // 0-DC：远程射击决策（596733-596758）
    //   cbit 1001（遠隔好）→ var_2773 = -2
    //     两者都有（cbit 1000 近接好 + cbit 1001 遠隔好）时 rnd(10) > 4 → 以近接为主（-1）
    //   var_2773 == -2（遠隔好）且 var_58(266) 不是 1/3 时：
    //     距离 < 6 且有视线 → 直接远程攻击（*label_2840 选武器 + *label_3005），
    //     即「主动保持距离射击」而不是先贴脸。
    if (c.get(266) !== 1 && c.get(266) !== 3
      && Elona.Status && Elona.Status.cbit
      && Elona.Status.cbit(c, 1001)) {
      let rangedPref = true;
      if (Elona.Status.cbit(c, 1000) && g.rng.rnd(10) > 4) rangedPref = false;  // 596739-596744
      if (rangedPref && d < 6 && hasLos(g, c, target)) {
        const r = attackTarget(g, c, target);
        return { acted: true, attacked: true, ranged: true, target, result: r, mercy, mounted };
      }
    }
    // 595060-595064：附魔 63「可以远程打击」→ 能力 734（远距离打击）。
    const v57 = c.get(57) | 0;
    const remoteRoll = g.rng ? g.rng.rnd(600) : 0;
    if (v57 !== 0 && Math.min(Math.max(v57, 1), 540) >= remoteRoll && hasLos(g, c, target)) {
      const prev175 = (g.getV65 ? (g.getV65(175) | 0) : 0);
      if (g.setV65) g.setV65(175, 200);
      let r;
      try { r = attackTarget(g, c, target); }
      finally { if (g.setV65) g.setV65(175, prev175); }
      return { acted: true, attacked: true, remoteBlow: true, target, result: r, mercy, mounted };
    }
    if (d === 1) {
      // 相邻 → 攻击（原版 gosub *label_2111）
      const r = attackTarget(g, c, target);
      return { acted: true, attacked: true, target, result: r, mercy, mounted };
    }
    const step = combatMove(g, c, target);
    if (step) return { acted: true, moved: true, moveKind: step, target, mercy, mounted };
    return { acted: false, target, mercy, mounted };
  }

  /** 视线判定（fov_los） */
  function hasLos(g, c, target) {
    if (Elona.Spell && Elona.Spell.fovLos) {
      return Elona.Spell.fovLos(g, c.x, c.y, target.x, target.y) !== 0;
    }
    return true;
  }

  /**
   * NPC 攻击目标 —— 走 *label_3006/3007（装备槽遍历 + 单次攻击结算），
   * 与原版玩家攻击共用同一套命中/伤害/附魔/连续攻击逻辑。
   */
  function attackTarget(g, npc, target) {
    const r = Elona.Battle.attackSeq(g, npc, target);
    const t = target.index === 0 ? '你' : target.name;
    if (r.magic) {
      g.log(`${npc.name} 的特殊攻击（法术 ${r.spell}）。`);
      return r;
    }
    for (const a of (r.attacks || [])) {
      if (!a) continue;
      if (!a.hit) {
        g.log(`${npc.name} 的攻击没有命中${t}（命中${a.hitPower} vs 回避${a.evaPower}）。`);
        continue;
      }
      const crit = a.critical ? '（会心一击！）' : '';
      g.log(`${npc.name} 攻击${t}${crit} —— 受到 ${a.dmg} 点伤害，剩余 HP ${target.hp}`);
      if (a.killed) g.log(`${t}被击倒了…`);
    }
    return r;
  }

  /**
   * 0-CQ：战斗模式（ElonaPlus 的「戦闘スタイル」）—— 由 AP 天赋菜单调整的 AI 参数：
   *   cbit 1000 近接好        → 期望距离固定 1（无视適正距離）
   *   cbit 1001 遠隔好        → 期望距离 max(適正距離, 5)
   *   cbit 1016 矢系魔法好    → 同上（攻击由 attackSeq 的 1016 分支走法术）
   *   var_58(208) 適正距離    → 默认期望距离（characreate 第 9 字段 / AP 菜单 ±1）
   *   var_58(207) 移動確率    → 已在期望距离上时的随机移动概率（%）
   */
  function preferredDistance(c) {
    if (Elona.Status && Elona.Status.cbit) {
      if (Elona.Status.cbit(c, 1000)) return 1;
      if (Elona.Status.cbit(c, 1001) || Elona.Status.cbit(c, 1016)) {
        return Math.max(5, c.get(208) | 0);
      }
    }
    return Math.max(1, c.get(208) | 0);
  }

  /** 随机走一格（原版 *label_4307 的随机移动） */
  function randomStep(g, c) {
    const order = DIRS8.slice();
    if (g.rng) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = g.rng.rnd(i + 1);
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
    }
    for (const [ox, oy] of order) {
      const nx = c.x + ox, ny = c.y + oy;
      if (!g.map.walkable(nx, ny)) continue;
      c.x = nx; c.y = ny;
      g.syncCharaCells();
      if (typeof g.onEnterCell === 'function') g.onEnterCell(c, nx, ny);
      return true;
    }
    return false;
  }

  /** 远离目标一步 */
  function stepAway(g, c, target) {
    let best = null, bestD = -1;
    for (const [ox, oy] of DIRS8) {
      const nx = c.x + ox, ny = c.y + oy;
      if (!g.map.walkable(nx, ny)) continue;
      const d = Elona.Battle.dist(nx, ny, target.x, target.y);
      if (d > bestD) { bestD = d; best = [nx, ny]; }
    }
    if (!best || bestD <= Elona.Battle.dist(c.x, c.y, target.x, target.y)) return false;
    c.x = best[0]; c.y = best[1];
    g.syncCharaCells();
    if (typeof g.onEnterCell === 'function') g.onEnterCell(c, c.x, c.y);
    return true;
  }

  /**
   * 按战斗模式走位。返回 'toward' / 'away' / 'random' / null。
   */
  function combatMove(g, c, target) {
    const d = Elona.Battle.dist(c.x, c.y, target.x, target.y);
    const pref = preferredDistance(c);
    if (d > pref) return stepToward(g, c, target) ? 'toward' : null;
    if (d < pref) return stepAway(g, c, target) ? 'away' : null;
    const rate = c.get(207) | 0;
    const roll = g.rng ? g.rng.rnd(100) : 0;
    if (roll < rate) return randomStep(g, c) ? 'random' : null;
    return null;
  }

  /** 贪心朝目标走一步 */
  function stepToward(g, c, target) {
    const dx = Math.sign(target.x - c.x), dy = Math.sign(target.y - c.y);
    const order = [];
    if (dx && dy) order.push([dx, dy]);
    if (Math.abs(target.x - c.x) >= Math.abs(target.y - c.y)) {
      if (dx) order.push([dx, 0]);
      if (dy) order.push([0, dy]);
    } else {
      if (dy) order.push([0, dy]);
      if (dx) order.push([dx, 0]);
    }
    for (const [ox, oy] of DIRS8) order.push([ox, oy]);

    for (const [ox, oy] of order) {
      if (!ox && !oy) continue;
      const nx = c.x + ox, ny = c.y + oy;
      if (!g.map.walkable(nx, ny)) continue;
      c.x = nx; c.y = ny;
      g.syncCharaCells();
      // 进入格子的地形特性 / 陷阱（*label_2911）
      if (typeof g.onEnterCell === 'function') g.onEnterCell(c, nx, ny);
      return true;
    }
    return false;
  }

  /**
   * 0-L0 / A342：調教鞭的「别行动时」12 项指令（var_58(202)）。
   *
   * 源码 355640 `var_58(202, var_244) = var_444 - 4`（菜单第 5..16 项 → 1..12），
   * 消费在 *label_4306（593433 / 593693-593871）：
   *   4 → 以玩家为目标走 *label_4309（593433）
   *   5 → 按种族改成本职：326/675→6、320/280→9、335/352→10、9→12（593693-593705）
   *   6/7/8/12 → 1/10 概率分别发动 183 / 713 / 767 / 830（593709-593736）
   *   9 → 视野内找 snail（普通 4 格、种族 320/280 是 8 格）→ 攻击（593737-593787）
   *   10 → 40..56 槽位里 6 格内、有视线、rnd(2) 命中的角色 → 接近（593788-593845）
   *   11 → 「不在城里训练」：跳过随机游走（593708 / 593953 的 `!= 11`）
   *   5..12（除 11）→ 随机走一格 rnd(3)-1（593848-593852）
   *   1 → 随机走一格（593846-593853）；2 → var_126(8)==1 且离 (171,172)>2 时朝该点走，
   *       否则随机走（593854-593867）；3 → 源码没有任何分支 = 原地待机。
   *
   * 项目里 183/713/767/830 由 Perform / Preach / Work 以**玩家**为主体实现，
   * 把玩家状态机套到 NPC 身上会污染玩家状态，故这里按源码登记动作 id
   * （与 cbit 968 分支返回 `ability: 619` 同一惯例），宿主可用 `g.__npcAbility`
   * 注入实际表现；10 的另一半已由 Intimacy.aiTry 在 runAll 开头承接。
   */
  const TAMER_ABILITY = { 6: 183, 7: 713, 8: 767, 12: 830 };
  const TAMER_SPECIES = { 326: 6, 675: 6, 320: 9, 280: 9, 335: 10, 352: 10, 9: 12 };

  function tamerIdle(g, c, base) {
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    // 0-Z9：源码 593693-593872 的 202 指令消费位于 *label_4306，对**所有** NPC
    // 生效（非宠物经 593452 的 20% 通过率进入），不再限定 isAlly。
    let v = c.get(202) | 0;
    if (v === 0) return null;                           // 0 = 默认战斗行为，交回主流程
    const out = { acted: false, mercy: base && base.mercy, mounted: base && base.mounted };

    // 593693-593705：做本职工作 → 按 var_58(27) 种族 id 改成本职指令（写回，与本一致）
    if (v === 5) {
      const nv = TAMER_SPECIES[c.get(27) | 0] | 0;
      if (nv) { c.set(202, nv); v = nv; }
    }
    out.tamer = v;

    // 593433：4「跟着我」
    if (v === 4) {
      const p = g.player;
      if (!p) return Object.assign(out, { idle: true, follow: true });
      if (Elona.Battle.dist(c.x, c.y, p.x, p.y) > 1) {
        const moved = !!stepToward(g, c, { x: p.x, y: p.y });
        return Object.assign(out, { acted: moved, moved, follow: true });
      }
      return Object.assign(out, { idle: true, follow: true });
    }

    // 593709-593736：本职动作 1/10
    if (v >= 5 && v <= 12 && v !== 11) {
      const ab = TAMER_ABILITY[v] | 0;
      if (ab && R(10) === 0) {
        if (typeof g.__npcAbility === 'function') {
          try { g.__npcAbility(g, c, ab); } catch (e) { /* 表现层可选 */ }
        }
        return Object.assign(out, { acted: true, ability: ab });
      }
    }

    // 593737-593787：9「驱除蜗牛」
    if (v === 9) {
      const race = c.get(27) | 0;
      const reach = (race === 320 || race === 280) ? 8 : 4;
      let snail = null;
      for (const o of g.charas) {
        if (!o || o.index === c.index || (o.get(0) | 0) !== 1) continue;
        if (o.raceName !== 'snail' && (o.get(27) | 0) !== 382) continue;
        if ((c.get(58) | 0) === 100 && (o.index | 0) < 16) continue;
        if (Elona.Battle.dist(c.x, c.y, o.x, o.y) > reach) continue;
        if (!hasLos(g, c, o)) continue;
        if (R(2) === 0) continue;
        snail = o;
      }
      if (snail) {
        c.set(29, snail.index);
        if (Elona.Battle.dist(c.x, c.y, snail.x, snail.y) === 1) {
          const r = attackTarget(g, c, snail);
          return Object.assign(out, { acted: true, attacked: true, target: snail, result: r });
        }
        const moved = !!stepToward(g, c, snail);
        return Object.assign(out, { acted: moved, moved, target: snail });
      }
    }

    // 593788-593845：10「行为」——Intimacy.aiTry 未接住时的接近兜底
    if (v === 10) {
      let tgt = null;
      for (let i = 40; i <= 56; i++) {
        const o = g.charas[i];
        if (!o || (o.get(0) | 0) !== 1 || o.index === c.index) continue;
        if (R(2) === 0) continue;
        if (Elona.Battle.dist(c.x, c.y, o.x, o.y) >= 6) continue;
        if (!hasLos(g, c, o)) continue;
        tgt = o; break;
      }
      if (tgt) {
        c.set(29, tgt.index);
        if (Elona.Battle.dist(c.x, c.y, tgt.x, tgt.y) === 1) {
          const r = attackTarget(g, c, tgt);
          return Object.assign(out, { acted: true, attacked: true, target: tgt, result: r });
        }
        const moved = !!stepToward(g, c, tgt);
        return Object.assign(out, { acted: moved, moved, target: tgt });
      }
    }

    // 3「原地待机」/ 11「不在城里训练」：不随机游走
    if (v === 3 || v === 11) return Object.assign(out, { idle: true });

    // 593854-593867：2 的归位判定（var_126(8) 存于 map.header[8]）
    if (v === 2 && g.map && g.map.header && (g.map.header[8] | 0) === 1) {
      const hx = c.get(171) | 0, hy = c.get(172) | 0;
      // 源码 593855 的 dist() 是欧氏距离；这里同时用切比雪夫半径 2 兜底，
      // 保证城镇 NPC 不会斜着一步步漂出出生点周围 3×3 的街区。
      const far = (x, y) => Elona.Battle.dist(x, y, hx, hy) > 2
        || Math.max(Math.abs(x - hx), Math.abs(y - hy)) > 2;
      if (far(c.x, c.y)) {
        const moved = !!stepToward(g, c, { x: hx, y: hy });
        return Object.assign(out, { acted: moved, moved, homing: true });
      }
      // 593861-593864：在家附近时以当前格为中心各轴 rnd(3)-1（可原地待着），
      // 不允许像 1/5..12 那样洗牌八方向跑远。
      const dx = R(3) - 1, dy = R(3) - 1;
      if (dx || dy) {
        const nx = c.x + dx, ny = c.y + dy;
        if (!far(nx, ny) && g.map.walkable(nx, ny)) {
          c.x = nx; c.y = ny;
          if (g.syncCharaCells) g.syncCharaCells();
          if (typeof g.onEnterCell === 'function') g.onEnterCell(c, nx, ny);
          return Object.assign(out, { acted: true, moved: true, roam: true });
        }
      }
      return Object.assign(out, { idle: true });
    }

    // 593846-593852：1 与 5..12（除 11）随机走一格
    const moved = !!randomStep(g, c);
    return Object.assign(out, { acted: moved, moved, roam: true });
  }

  /**
   * 推进所有 NPC 的一个回合：先做异常状态结算（对应每角色回合开始的 label_2224），
   * 再执行行动。
   */
  function runAll(g, budgets) {
    let acted = 0;
    let deaths = 0;
    for (const c of g.charas) {
      if (!c || c.index === 0 || c.get(0) !== 1) continue;
      if (Elona.Status) Elona.Status.statusTick(g, c);
      if (g.mef && c.hp > 0) g.mef.tick(g, c);     // 地面魔法效果（604202-604340）
      if (c.hp <= 0) {                                      // 状态/地面效果致死
        // 0-GH：与近战 / 远程 / 法术共用同一套死亡结算
        if (Elona.Battle && Elona.Battle.onDeath) Elona.Battle.onDeath(g, c, null);
        else {
          // 兜底（Battle 未加载时）
          if (!(Elona.Companion && Elona.Companion.onDeath(g, c))) {
            if (Elona.Loot) Elona.Loot.onDeath(g, c, null);
            c.set(0, 0);
          }
        }
        deaths++; continue;
      }
      // 0-GC：NPC 侧的持续行动 —— 推进点在下面的行动计循环里（604660-604760
      //   的分派在每个角色的**每次行动**里跑，受行动计影响：快的角色倒计时
      //   也走得快；攒不够行动计的角色这一回合一次都不推进）。
      // 0-FY：*label_4353（603943-603955）。攒够行动计的角色一次玩家回合里
      //   可以连动数次；攒不够的一次也不动。未提供 budgets 时沿用旧的「各一次」。
      let n = 1;
      if (budgets && Object.prototype.hasOwnProperty.call(budgets, c.index)) {
        n = budgets[c.index] | 0;
      }
      if (n < 0) n = 0;
      let didAct = false;
      for (let k = 0; k < n; k++) {
        if (c.hp <= 0 || g.player.hp <= 0) break;
        // 604（label_4354）`var_58(26, var_243)++`：角色每次取得行动时递增「经过回合数」。
        //   greetTalk 的 `var_58(26)\5==0` 门依赖它（每 5 次行动闲聊一次）。
        c.set(26, (c.get(26) | 0) + 1);
        // 0-FY：验证/调试用的可选观察钩子（生产环境不设置，零开销）；
        //   返回 false 可跳过本次行动，便于测试只统计行动次数。
        if (g.__aiTurnSpy && g.__aiTurnSpy(c.index | 0, k) === false) continue;
        // 0-GC/GD：忙着持续行动的角色这一行动只推进自己的倒计时
        if ((c.get(140) | 0) !== 0) {
          if (Elona.Actions && Elona.Actions.tickChara) Elona.Actions.tickChara(g, c);
          didAct = true;
          if (c.hp > 0 && g.player.hp <= 0) break;
          continue;
        }
        // 0-GD：脱衣 / 行為 的 NPC 诱惑入口（593443 cbit(1048) / 593795 202==10）
        if (Elona.Intimacy && Elona.Intimacy.aiTry(g, c)) { didAct = true; continue; }
        const r = npcTurn(g, c);
        if (r && r.acted) didAct = true;
      }
      if (didAct) acted++;
      // 604850-604858：经验足够则升级（*label_2145）
      if (c.hp > 0 && Elona.Stats && Elona.Stats.checkLevelUp) Elona.Stats.checkLevelUp(c, g);
      if (g.player.hp <= 0) break;
    }
    // 有人死了 → check_quest（原著 5 个调用点全在角色被击杀/消灭之后）
    if (deaths > 0 && Elona.QuestCheck) Elona.QuestCheck.check(g);
    return acted;
  }

  Elona.AI = {
    adjacentCheck, npcTurn, runAll, childAiPre, findNearestHostile, castBranch,
    tryHealPotion, tryIdle, tryUseItem, findInvItem, sightRange, tryPetPickup,
    mercyCheck, mountSync, greetTalk, tamerIdle, TAMER_ABILITY, TAMER_SPECIES,
    isHostile, hostileTowards, stepToward, stepAway, randomStep, combatMove,
    preferredDistance, combatStatusSkip, idleModeBlocked, idleGate, drunkCatIdle,
    nightSleepIdle, pocketSupplyIdle, snowPlayIdle, allyEatIdle, specialIdle,
    DIRS8, DIR,
  };
})(window);
