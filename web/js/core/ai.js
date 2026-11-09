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
      // 射程 = `var_83(3, 656) \ 1000 + 1`（656 = 3006 → 4 格；与 core/aim.js 一致）
      const r656 = (((Elona.Spell.field(656, 3) | 0) / 1000) | 0) + 1;
      const d = Elona.Battle.dist(c.x, c.y, target.x, target.y);
      if (d > r656 || Elona.Spell.fovLos(g, c.x, c.y, target.x, target.y) === 0) {
        return { cast: false, reposition: true, target };
      }
    }

    let r = null;
    if (id >= 400 && id < 492) r = Elona.Spell.cast(g, c, id, target);      // gosub *label_2950
    else if (id >= 600) r = Elona.Spell.cast(g, c, id, target);            // gosub *label_2958
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
   * 0-DH：同伴的拾食 / 捡拾（调教鞭菜单的 cbit 1033 / 1032，355783-355798 的开关）。
   *   · cbit(1033) == 0 时允许「拾い食い」：脚下是食物且不饱 → 吃掉（营养 +2500）
   *   · cbit(1032) == 0 时允许「アイテム拾い」：脚下的无主物品收进同伴背包
   *   有主物品（townOwned）不碰，避免同伴把城镇布置搬走。
   */
  function tryPetPickup(g, c) {
    if (!(Elona.Party && Elona.Party.isAlly && Elona.Party.isAlly(c))) return { used: false };
    if (!g.groundItems || !g.groundItems.length) return { used: false };
    const CB = (n) => (Elona.Status && Elona.Status.cbit ? Elona.Status.cbit(c, n) : 0);
    const idx = g.groundItems.findIndex((it) => it && (it.f[0] | 0) > 0
      && (it.f[5] | 0) === (c.x | 0) && (it.f[6] | 0) === (c.y | 0) && !it.townOwned);
    if (idx < 0) return { used: false };
    const it = g.groundItems[idx];
    const cat = (Elona.ItemDB && Elona.ItemDB.ref) ? Elona.ItemDB.ref(it.id, 5) : 0;
    const nm = (Elona.ItemDB && Elona.ItemDB.name) ? Elona.ItemDB.name(it.id, 'jp') : ('item ' + it.id);
    // 拾い食い
    if (cat === 57000 && CB(1033) === 0 && (c.get(22) | 0) <= 10000) {
      it.f[0] = (it.f[0] | 0) - 1;
      if (it.f[0] <= 0) g.groundItems.splice(idx, 1);
      c.set(22, (c.get(22) | 0) + 1250);
      if (g.log) g.log(`${c.name}捡起地上的${nm}吃掉了。`);
      return { used: true, kind: 'eat-ground' };
    }
    // アイテム拾い
    if (CB(1032) === 0 && it.f[0] > 0) {
      if (!c.inv) c.inv = [];
      if (c.inv.length >= 60) return { used: false };
      const copy = { id: it.id, f: it.f.slice() };
      c.inv.push(copy);
      g.groundItems.splice(idx, 1);
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
      if (g.log) g.log(`${c.name}捡起了${nm}。`);
      return { used: true, kind: 'pick-ground' };
    }
    return { used: false };
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

  function npcTurn(g, c) {
    if (!c || c.get(0) !== 1 || c.index === 0) return { acted: false };

    // 592204-592205：NPC 行动开始时清零「同回合连续被击次数」（dmghp 的防连击减伤）
    if (c.get(444) !== 0) c.set(444, 0);

    // ① 求饶/怜悯（*label_4302 592173-196）—— 副作用，不终止本回合
    const mercy = mercyCheck(g, c);
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
    if (tIdx < 0) return { acted: false, mercy, mounted };

    c.set(29, tIdx);
    const target = g.charas[tIdx];
    const d = Elona.Battle.dist(c.x, c.y, target.x, target.y);

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
        // 0-DG：同伴 → var_58(0)=6（等调酒师复活），其他角色照旧 vanquish
        if (!(Elona.Companion && Elona.Companion.onDeath(g, c))) {
          // 0-EE：死亡掉落（*label_2287；状态/地面效果致死的 killer 传 null）
          if (Elona.Loot) Elona.Loot.onDeath(g, c, null);
          c.set(0, 0);
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
    adjacentCheck, npcTurn, runAll, findNearestHostile, castBranch,
    tryHealPotion, tryIdle, tryUseItem, findInvItem,
    mercyCheck, mountSync,
    isHostile, hostileTowards, stepToward, stepAway, randomStep, combatMove,
    preferredDistance, DIRS8, DIR,
  };
})(window);
