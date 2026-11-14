/**
 * 剧情推进 / 委托地图完成判定 —— `check_quest`（193527-193822）
 *
 * 这个函数在源码里名字像「委托检查」，但**前半段是主线剧情的 Journal 推进**：
 *   进入某张地图的某个场景、把该场景的目标角色全部清除后，把 `var_65(250+n)` 提到下一阶段。
 *
 * ## 前半段：15 条进度规则（工具 `tools/extract_quest_progress.py` 提取）
 *
 *   193528-193761：
 *     if ( var_65(20) == <地图> ) {
 *         if ( var_65(22) == <场景> ) {
 *             if ( exist_questtarget() == 0 ) {
 *                 if ( var_65(250 + <n>) < <阶段> ) {
 *                     var_65(250 + <n>) = <阶段>
 *                     snd 44 / txtef 2 / "ジャーナルが更新された。"
 *                 }
 *             }
 *         }
 *     }
 *
 * ## 后半段：委托地图的完成判定（193762-193822）
 *
 *   193762-193764  var_65(70) == 0 → 不在委托地图，直接返回
 *   193765         var_65(73) == 3 → 已完成，不再判
 *   193766-193804  var_65(71) == 1：统计「原本敌对（var_58(69) == -3）、存活、
 *                  未被魅惑（cbit 964）、未被驯服（cbit 992）」的角色，为 0 → 完成
 *   193805-193821  var_65(70) == 1008：`findcharaaz(var_434(12, var_65(72))) == 0` → 完成
 *   完成 = `var_65(801) = 0`、`var_65(250+413) = 0`、`var_65(73) = 3`、`evadd 8`
 *
 * ## 触发时机
 *
 * `check_quest` 的 5 个调用点全部在**角色被击杀/消灭之后**：
 *   194147（角色死亡）／201171（杀死 NPC）／325627、341010、416143（chara_vanquish）
 * 本项目挂在 `ai.js` 的死亡清理与 `throw.js`/`game.js` 的即死处理之后。
 *
 * `put_questtarget`（193509-193516）有 21 个调用点，全在剧情脚本区（238469-245501），
 * 作用是「把 57..244 号存活角色全部标成目标（cbit 970）并设为敌对（var_58(9) = -3）」。
 * 0-HU：网页把「目标标记」与「生成时写 var_58(69) = -3」（231123 / 197510 /
 * 418902）合并到 putTarget 一处，使 193769 只判 69 即可（A161 用户裁定 a）。
 */
(function (global) {
  'use strict';

  const Elona = global.Elona = global.Elona || {};

  const idiv = (a, b) => Math.floor((a | 0) / (b || 1));
  const CBIT_QUEST_TARGET = 970;      // put_questtarget 打的标记
  const RANGE_FROM = 57;
  const RANGE_TO = 244;               // repeat 245 - 57, 57 → 57..244
  const REL_HOSTILE = -3;

  let table = null;

  async function load() {
    if (table) return table;
    table = await Elona.Data.table('quest_progress');
    return table;
  }

  function ready() { return !!table; }

  function rules() {
    return (table && table.rules) || [];
  }

  function bit(c, n) {
    if (!Elona.Status || !Elona.Status.cbit) return 0;
    return Elona.Status.cbit(c, n) | 0;
  }

  function setBit(c, n, on) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, n, !!on);
  }

  /** 角色是否「还活着且能行动」（JS 侧死亡后 `get(0)` 要等 AI 清理才变 0，所以补 hp 判定） */
  function isAlive(c) {
    if (!c) return false;
    if ((c.get(0) | 0) !== 1) return false;
    if ((c.hp | 0) <= 0) return false;
    return true;
  }

  /**
   * put_questtarget（193509-193516）—— 把剧情地图里的角色全部标成目标。
   *
   * 0-HU（A161，用户裁定 a）：原版这里只写 `var_58(9) = -3`；而 193769 判的
   * `var_58(69) == -3`（原始关系）是由**敌人生成点**写的（231123 / 197510 /
   * 418902 等处 `var_58(9)=-3; var_58(69)=-3`）。网页把这些标记路径合并在
   * 本函数里，因此一并写 69，让 193769 只按 69 判定即可，不再回退到 9。
   * @returns {number} 被标记的数量
   */
  function putTarget(g) {
    if (!g || !g.charas) return 0;
    let n = 0;
    for (let i = RANGE_FROM; i <= RANGE_TO; i++) {
      const c = g.charas[i];
      if (!isAlive(c)) continue;
      setBit(c, CBIT_QUEST_TARGET, true);
      c.set(9, REL_HOSTILE);            // var_58(9) = -3（当前关系）
      c.set(69, REL_HOSTILE);           // var_58(69) = -3（原始关系）
      n++;
    }
    return n;
  }

  /** 把「委托地图里生成的敌人」按 231123 / 197510 写成天生敌对（9 与 69 都置 -3） */
  function markQuestEnemy(c) {
    if (!c) return false;
    c.set(9, REL_HOSTILE);
    c.set(69, REL_HOSTILE);
    return true;
  }

  /**
   * exist_questtarget（193517-193526）—— 还剩多少个目标。
   * 源码只判 `var_58(0) == 1`；这里补 `hp > 0`（见文件头说明）。
   */
  function existTarget(g) {
    if (!g || !g.charas) return 0;
    let n = 0;
    for (let i = RANGE_FROM; i <= RANGE_TO; i++) {
      const c = g.charas[i];
      if (!isAlive(c)) continue;
      if (bit(c, CBIT_QUEST_TARGET) === 1) n++;
    }
    return n;
  }

  /**
   * 该角色算不算「委托地图里还要清掉的敌人」（193769-193774）。
   * 0-HU（A161）：删掉「当前关系 9 也为 -3」的回退，严格只判 `var_58(69) == -3`；
   * 所有委托目标生成点已统一写 69（见 putTarget / markQuestEnemy）。
   */
  function isQuestEnemy(c) {
    if (!isAlive(c)) return false;
    if ((c.get(69) | 0) !== REL_HOSTILE) return false;   // 193769 只判原始关系
    if (bit(c, 964) === 1) return false;      // 被魅惑的不算
    if (bit(c, 992) === 1) return false;      // 被驯服的不算
    return true;
  }

  /**
   * findcharaaz（193209-193224，A162）—— 找「该种族是否还有活着的对象」。
   * 原版：`repeat 245 - 57, 57`，只接受 `var_58(0)` 为 1 或 2 的槽位，
   * 排除 cbit 964（魅惑）/ cbit 992（驯服），第一个 `var_58(27) == 种族` 即为结果；
   * 找不到返回 0。注意 193806 只关心 0 / 非 0，不是「统计数量」。
   */
  function findcharaaz(g, race) {
    const charas = (g && g.charas) || [];
    for (let i = RANGE_FROM; i <= RANGE_TO; i++) {
      const c = charas[i];
      if (!c) continue;
      const state = c.get(0) | 0;
      if (state !== 1 && state !== 2) continue;        // 193211-193215
      if (bit(c, 964) === 1) continue;                 // 193216-193218
      if (bit(c, 992) === 1) continue;                 // 193219-193221
      if ((c.get(27) | 0) === (race | 0)) return i;    // 193222-193224
    }
    return 0;
  }

  /**
   * 前半段：剧情进度推进（193528-193761）。
   * @returns {Array} 本次推进了的规则
   */
  function checkProgress(g) {
    const done = [];
    if (!g || !g.getV65) return done;
    const mapId = g.getV65(20) | 0;
    const subId = g.getV65(22) | 0;
    const hit = rules().filter((r) => (r.mapId | 0) === mapId && (r.subId | 0) === subId);
    if (!hit.length) return done;                      // 这张地图没有进度规则，不必扫角色
    for (const r of hit) {
      if (existTarget(g) !== 0) break;                 // 还有目标没清完
      const cur = g.getV65(r.varSlot) | 0;
      if (cur >= (r.stage | 0)) continue;              // 只增不减
      g.setV65(r.varSlot, r.stage | 0);
      if (g.log) g.log('Your journal has been updated.');
      done.push(r);
    }
    return done;
  }

  /** 委托地图完成时的收尾（193780-193793 / 193807-193819） */
  function completeQuestMap(g) {
    if ((g.getV65(801) | 0) > 0) g.setV65(801, 0);
    if ((g.getV65(250 + 413) | 0) > 0) g.setV65(250 + 413, 0);
    g.setV65(73, 3);
    if (Elona.Event && g.events && g.events.add) g.events.add(8);
    else if (Elona.Event && g.evadd) g.evadd(8);
    if (g.log) g.log('委托的目标已经全部达成。');
    return true;
  }

  /**
   * `*label_4293`（591368-591468）：地图达成 / 委托完成时的统一结算（事件 8 的 handler）。
   *   591369-591372  `var_65(73) = 3`
   *   591373-591431  `var_65(70) == 1`（竞技场）：胜负与名声由 Arena.onKill 结算，这里不重复
   *   591432-591440  1001 / 1010 → 「エリアを制圧した！」
   *   591441-591448  1007 → 同上
   *   591449-591457  1012 → 「盗賊団を返り討ちにした！」+ `var_65(250+40)++`
   *   591458-591467  1008 → `var_65(84) = 0` + 「討伐に成功した！」
   *   另把当前委托置为完成（`var_434(8, var_65(72)) = 3`）。
   * @returns {{type:number, messages:string[]}}
   */
  function onMapCleared(g) {
    const type = (g && g.getV65) ? (g.getV65(70) | 0) : 0;
    const messages = [];
    if (g && g.setV65) g.setV65(73, 3);
    if (type === 1001 || type === 1010 || type === 1007) {
      messages.push('区域已压制！');
    } else if (type === 1012) {
      messages.push('击退了盗贼团！');
      if (g.setV65) g.setV65(250 + 40, (g.getV65(250 + 40) | 0) + 1);
    } else if (type === 1008) {
      if (g.setV65) g.setV65(84, 0);
      messages.push('讨伐成功！');
    }
    // var_434(8, var_65(72)) = 3：把当前地图上的委托标记为完成。
    // 0-HU（A200）：源码 591432/591450/591459 只在 1001 / 1010 / 1008 三种
    //   委托地图里写这一句；竞技场 var_65(70)=1（417075）也会触发事件 8，
    //   若不收窄会把玩家身上所有进行中的委托误标为完成。
    const markable = (type === 1001 || type === 1010 || type === 1008);
    if (markable && Elona.Quest && Elona.Quest.activeQuests && Elona.Quest.markComplete) {
      try {
        for (const q of Elona.Quest.activeQuests(g)) {
          if (q && (q.status | 0) === 1) Elona.Quest.markComplete(q);
        }
      } catch (e) { /* 委托表未就绪 */ }
    }
    for (const m of messages) if (g && typeof g.log === 'function') g.log(m);
    return { type, messages };
  }

  /**
   * 后半段：委托地图的完成判定（193762-193822）。
   * @returns {object|null} { type, completed, left? }；不在委托地图时返回 null
   */
  function checkQuestMap(g) {
    if (!g || !g.getV65) return null;
    const type = g.getV65(70) | 0;
    if (type === 0) return null;                       // 193762-193764
    if ((g.getV65(73) | 0) === 3) return null;         // 已完成

    if ((g.getV65(71) | 0) === 1) {
      let left = 0;
      const charas = g.charas || [];
      for (let i = RANGE_FROM; i <= RANGE_TO; i++) {
        if (charas[i] && isQuestEnemy(charas[i])) left++;
      }
      if (left === 0) {
        completeQuestMap(g);
        return { type, completed: true, left: 0 };
      }
      if (g.log) g.log(`还有 ${left} 个敌人需要清除。`);
      return { type, completed: false, left };
    }

    if (type === 1008) {
      // findcharaaz(var_434(12, var_65(72))) == 0：目标怪物已经不存在
      // A164（0-HG）：var_65(72) 是 var_434(字段, 槽位) 的**槽位下标**（22023 / 22093），
      //   var_434(12, slot) 在 type 1008 里是目标种族 id（22093 用 refchara 显示）。
      //   网页 g.quests 才是全槽位表；g.activeQuests 是按 status 过滤后的压缩数组，
      //   拿它按 slot 取会错位，因此只从 g.quests[slot] 取，且不再用 targetData 兜底。
      const slot = g.getV65(72) | 0;
      const q = (g.quests && g.quests[slot]) || null;
      const race = q ? (q.targetCreature | 0) : 0;
      // A162（0-HU）：改调 193209 的 findcharaaz 原语义（范围 57..244 /
      //   状态 1 或 2 / 排除 964·992），不再遍历整张 charas 表按 hp 近似。
      const found = findcharaaz(g, race);
      if (found === 0) {
        completeQuestMap(g);
        return { type, completed: true, race };
      }
      return { type, completed: false, race, found };
    }

    return { type, completed: false };
  }

  /**
   * `check_quest` 本体：前半段 + 后半段。
   * @returns {object} { journal: [...], questMap: ... }
   */
  function check(g) {
    if (!ready()) return { journal: [], questMap: null };
    const journal = checkProgress(g);
    const questMap = checkQuestMap(g);
    return { journal, questMap };
  }

  /** 当前地图/场景命中的规则（用于控制台与测试查看，不改状态） */
  function rulesAt(g, mapId, subId) {
    const m = (mapId === undefined) ? (g.getV65(20) | 0) : (mapId | 0);
    const s = (subId === undefined) ? (g.getV65(22) | 0) : (subId | 0);
    return rules().filter((r) => (r.mapId | 0) === m && (r.subId | 0) === s);
  }

  Elona.QuestCheck = {
    CBIT_QUEST_TARGET, RANGE_FROM, RANGE_TO, REL_HOSTILE,
    load, ready, rules, rulesAt,
    putTarget, markQuestEnemy, existTarget, isQuestEnemy, findcharaaz,
    checkProgress, checkQuestMap, check, completeQuestMap, onMapCleared,
    get table() { return table; },
  };
})(window);
