'use strict';
/**
 * 收容所（収容所 / Camp）—— 关押、放出、劳动产出与劳动能量兑换。
 *
 * 【源码定位】
 *   收容所判定  var_132(16, mapId) == 105（233005 / 214556）
 *   关押流程    var_1302 == 24（234101-234160）
 *     · 收容上限 30（234109-234117）
 *     · 拒绝护送对象（cbit 963 / cbit 971，234126-234134）
 *     · cbitmod 1040, 0（解除拘束）+ cbitmod 1041, 1（标记收容中）
 *     · 在其位置生成物品 1295（收容凭据），f[17] = 0
 *     · cbit 967（伪装）→ 恢复原貌（234146-234155）
 *     · var_58(80) = 当前地图 id；relocate_chara(-1) 移出地图
 *     · var_58(9) = -1、var_58(69) = -1（脱离所有阵营）
 *   收容所状态  收容者数 = cbit(1041) 的数量（233007-233016）
 *               var_132(37) = 劳动能量、var_132(38) = 劳动强度（233021）
 *   放出        「檻から出して収容」（233293 → NPC 菜单 133 / 353499）
 *   劳动强度    var_132(38) = 0..3（234183-234193，txtsetwlevel 5）
 *     · 0 収容者の自主性に任せる / 1 時々休ませながら労働 / 2 ほとんど休ませずに労働 / 3 使い潰す
 *   劳动能量    var_132(37)，上限 100000（234215-234217）
 *   能量兑换    var_1302 == 26（234197-234433，txtsetwpoint 11）
 *     · 11 项 = 取消 + 10 种商品（200/300/600/1000/1500/2000/2500/3000/4000/10000）
 *   每日产出    248971-249017（renew_major，每 120 小时 = 5 天一次）
 *     · var_1886 = var_132(38)^3（劳动强度三次方）
 *     · 每名囚犯贡献 var_1886 * 2 能量
 *     · cbit 1042（疲劳保护，来自物品 1180）→ 免除疲劳并提示
 *     · 否则 sorg(2) <= var_1886（意志不足）→ evadd 68（死亡事件）
 *       否则 skillmod 2（意志） -var_1886 * 1000（经验减少）
 *     · var_58(169) > 0（好感度）→ 额外 + var_58(169)/10 + 1
 *   自行劳动    var_65(91) == 107 / 108（358394-358425）
 *     · 使用物品 1294（奴隷グルグル）→ 107：21 回合，每回合 -5 SP、+3 能量
 *     · 使用物品 1293（奴隷バタバタ）→ 108：61 回合，每回合 -2 SP、+1 能量
 *     · 311143-311165 / 311249-311261
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const CAMP_TYPE = 105;
  const CG_CAPTIVE = 1041;   // 收容中
  const CG_BOUND = 1040;     // 拘束
  const CG_ESCORT = 963;     // 护送对象
  const CG_PROTECTED = 971;  // 不可放出
  const CG_DISGUISE = 967;   // 伪装
  const CG_FATIGUE = 1042;   // 疲劳保护（一次）
  const CERT_ITEM = 1295;    // 收容凭据
  const MAX_CAPTIVE = 30;

  const ENERGY_MAX = 100000; // 234215-234217

  /** 劳动强度档位（234183-234193 + txtsetwlevel 5 的文案 11579-11602） */
  const TOIL_LEVELS = [
    { lv: 0, jp: '強度０：収容者の自主性に任せる', en: "<Level 0> each individual's autonomy" },
    { lv: 1, jp: '強度１：時々休ませながら労働させる', en: '<Level 1> work with occasional breaks' },
    { lv: 2, jp: '強度２：ほとんど休ませずに労働させる', en: '<Level 2> work with almost no rest' },
    { lv: 3, jp: '強度３：使い潰すつもりで労働させる', en: "<Level 3> work like they're dying" },
  ];

  /**
   * 劳动能量兑换表（234197-234433 + txtsetwpoint 11 的文案 11537-11577）。
   * 源码以 var_444（1..10）分派，这里按同样顺序整理：
   *   1 浮遊檻3個 200 / 2 奴隷グルグル＆奴隷バタバタ 300 / 3 染料10種 600
   *   4 音楽ディスク10種 1000 / 5 スピリチウム10種 1500 / 6 Suエクステンダー2種 2000
   *   7 立派な鎖3個 2500 / 8 水2服 3000 / 9 労働エナジードリンク10服 4000
   *   10 カジノチップ10枚 10000
   * cost = 需要的劳动能量；items = 产出（id / 个数）。
   */
  const EXCHANGE_ITEMS = [
    { idx: 1, cost: 200, jp: '浮遊檻３個', en: '3 float cage',
      items: [{ id: 1295, count: 3 }] },
    { idx: 2, cost: 300, jp: '奴隷グルグル＆奴隷バタバタ', en: 'slave spinner and wheel',
      items: [{ id: 1294, count: 1 }, { id: 1293, count: 1 }] },
    { idx: 3, cost: 600, jp: '染料１０種', en: '10types dye',
      items: [{ id: 519, count: 10 }] },
    { idx: 4, cost: 1000, jp: '音楽ディスク１０種', en: '10types musicdisc',
      items: [{ id: 544, count: 10 }] },
    { idx: 5, cost: 1500, jp: 'スピリチウム１０種', en: '10types spiritium',
      items: [{ id: 1255, count: 10 }] },
    { idx: 6, cost: 2000, jp: 'Suエクステンダー２種', en: 'SurvivabilityEXtenderXandY',
      items: [{ id: 1254, count: 1 }, { id: 1253, count: 1 }] },
    { idx: 7, cost: 2500, jp: '立派な鎖３個', en: '3 splendid chain',
      items: [{ id: 1297, count: 3 }] },
    { idx: 8, cost: 3000, jp: '水２服', en: '2 water',
      items: [{ id: 516, count: 2 }] },
    { idx: 9, cost: 4000, jp: '労働エナジードリンク１０服', en: '10 toil-energy drink',
      items: [{ id: 1298, count: 10 }] },
    { idx: 10, cost: 10000, jp: 'カジノチップ１０枚', en: '10 Casino chips',
      items: [{ id: 54, count: 10 }] },
  ];

  /** 劳动器具（358394-358425 / 311143-311165） */
  const WORK_TOOLS = {
    1294: { id: 1294, mode: 107, turns: 21, sp: 5, energy: 3,
      jp: '奴隷グルグル', en: 'slave spinner' },
    1293: { id: 1293, mode: 108, turns: 61, sp: 2, energy: 1,
      jp: '奴隷バタバタ', en: 'slave wheel' },
  };

  function cbitOf(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, bit) : 0;
  }
  function setCbit(c, bit, on) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit, on);
  }

  /** 当前地图是不是收容所；返回 { mapId, runtime, site } 或 null */
  function campOf(g, mapId) {
    if (!g) return null;
    const id = (mapId === undefined) ? (g.getV65 ? (g.getV65(20) | 0) : 0) : (mapId | 0);
    // 玩家自建的收容所（0-CY 的运行时 site）
    if (Elona.Property && Elona.Property.list) {
      const own = Elona.Property.list(g).filter((x) => x.type === CAMP_TYPE);
      if (own.length) {
        const s = Elona.Property.siteOf(g, own[0].id);
        if (s && s.mapId === undefined) s.mapId = own[0].map;
        return { mapId: id, runtime: s, site: own[0] };
      }
    }
    // 静态 site
    if (Elona.Sites && Elona.Sites.typeOf) {
      if (Elona.Sites.typeOf(id, {}, g) === CAMP_TYPE) return { mapId: id, runtime: null };
    }
    return null;
  }

  /** 收容中的角色数（cbit 1041） */
  function captiveCount(g) {
    const list = (g && g.charas) || [];
    let n = 0;
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (c && cbitOf(c, CG_CAPTIVE)) n++;
    }
    if (g && g.propertySites) {
      for (const k of Object.keys(g.propertySites)) {
        const s = g.propertySites[k];
        if (s && s.inmates) n += s.inmates.length;
      }
    }
    return n;
  }

  // ---------------------------------------------------------------- 状态读写
  /**
   * 取收容所的 var_132(37)（劳动能量）与 var_132(38)（劳动强度）。
   * 运行时 site 用 fields[37]/fields[38]，静态 site 用表中的同名字段。
   * （运行时 site 上遗留的 toilLv / toilEnergy 直写属性也作为回退读取。）
   */
  function readState(g, mapId) {
    const camp = campOf(g, mapId);
    if (!camp) return null;
    let toilLv = 0, toilEnergy = 0;
    if (camp.runtime) {
      const f = camp.runtime.fields || {};
      toilLv = f[38] !== undefined ? (f[38] | 0)
        : (camp.runtime.toilLv === undefined ? 0 : (camp.runtime.toilLv | 0));
      toilEnergy = f[37] !== undefined ? (f[37] | 0)
        : (camp.runtime.toilEnergy === undefined ? 0 : (camp.runtime.toilEnergy | 0));
    } else {
      const s = Elona.Sites ? Elona.Sites.get(camp.mapId) : null;
      if (s && s.fields) {
        toilLv = parseInt(s.fields[38], 10) || 0;
        toilEnergy = parseInt(s.fields[37], 10) || 0;
      }
    }
    return {
      mapId: camp.mapId,
      runtime: camp.runtime,
      site: camp.site,
      count: captiveCount(g),
      max: MAX_CAPTIVE,
      toilLv, toilEnergy,
    };
  }

  /** 写回劳动能量（var_132(37)），上限 100000 */
  function writeEnergy(g, mapId, v) {
    const camp = campOf(g, mapId);
    if (!camp) return { ok: false, reason: 'not-camp' };
    const n = Math.max(0, Math.min(ENERGY_MAX, v | 0));
    if (camp.runtime) {
      const f = camp.runtime.fields || (camp.runtime.fields = {});
      f[37] = n;
      camp.runtime.toilEnergy = n;
    } else {
      const s = Elona.Sites ? Elona.Sites.get(camp.mapId) : null;
      if (s && s.fields) s.fields[37] = n;
    }
    return { ok: true, toilEnergy: n };
  }

  /** 写回劳动强度（var_132(38) = 0..3） */
  function writeToilLv(g, mapId, lv) {
    const camp = campOf(g, mapId);
    if (!camp) return { ok: false, reason: 'not-camp' };
    const n = Math.max(0, Math.min(3, lv | 0));
    if (camp.runtime) {
      const f = camp.runtime.fields || (camp.runtime.fields = {});
      f[38] = n;
      camp.runtime.toilLv = n;
    } else {
      const s = Elona.Sites ? Elona.Sites.get(camp.mapId) : null;
      if (s && s.fields) s.fields[38] = n;
    }
    return { ok: true, toilLv: n };
  }

  /** 收容所状态（面板用） */
  function status(g, mapId) {
    const st = readState(g, mapId);
    if (!st) return null;
    return {
      mapId: st.mapId,
      count: st.count,
      max: MAX_CAPTIVE,
      toilLv: st.toilLv,
      toilEnergy: st.toilEnergy,
      energyMax: ENERGY_MAX,
    };
  }

  // ---------------------------------------------------------------- 关押 / 放出
  /**
   * 关押（234101-234160）。
   * @param {object} g
   * @param {object} chara 目标角色
   */
  function imprison(g, chara) {
    if (!g || !chara) return { ok: false, message: '対象がいない。' };
    const camp = campOf(g);
    if (!camp) return { ok: false, reason: 'not-camp', message: 'ここには収容所がない。' };
    if (captiveCount(g) >= MAX_CAPTIVE) {
      return { ok: false, reason: 'full', message: '30体までしか収容できない。' };
    }
    if (cbitOf(chara, CG_ESCORT) || cbitOf(chara, CG_PROTECTED)) {
      return { ok: false, reason: 'escort', message: '護衛対象は放せない。' };
    }
    // 234124-234125：记录当前位置
    chara.set(171, chara.x | 0);
    chara.set(172, chara.y | 0);
    setCbit(chara, CG_BOUND, 0);
    setCbit(chara, CG_CAPTIVE, 1);
    // 234138-234139：在其位置生成收容凭据
    if (Elona.ItemDB && Elona.ItemDB.createItem) {
      const cert = Elona.ItemDB.createItem(CERT_ITEM, 1);
      if (cert) {
        cert.f[0] = 1;
        cert.f[17] = 0;
        cert.f[5] = chara.x | 0;
        cert.f[6] = chara.y | 0;
        if (g.groundItems) g.groundItems.push(cert);
      }
    }
    // 234146-234155：伪装恢复原貌
    if (cbitOf(chara, CG_DISGUISE)) setCbit(chara, CG_DISGUISE, 0);
    chara.set(80, camp.mapId);
    // 234157-234159：移出地图，脱离阵营
    const idx = chara.index | 0;
    if (idx > 0 && g.charas) g.charas[idx] = null;
    chara.set(9, -1);
    chara.set(69, -1);
    if (camp.runtime) {
      if (!camp.runtime.inmates) camp.runtime.inmates = [];
      camp.runtime.inmates.push(chara);
    }
    if (g.syncCharaCells) g.syncCharaCells();
    return {
      ok: true,
      message: `${chara.name}を収容した。（${chara.name} 被关押进收容所）`,
    };
  }

  /**
   * 放出（233293「檻から出して収容」→ NPC 菜单 133 → 353499-353527）。
   */
  function release(g, chara) {
    if (!g || !chara) return { ok: false, message: '対象がいない。' };
    if (!cbitOf(chara, CG_CAPTIVE)) {
      return { ok: false, reason: 'not-captive', message: 'その囚人はここにいない。' };
    }
    setCbit(chara, CG_CAPTIVE, 0);
    // 从收容所名单里移除
    if (g.propertySites) {
      for (const k of Object.keys(g.propertySites)) {
        const s = g.propertySites[k];
        if (!s || !s.inmates) continue;
        const i = s.inmates.indexOf(chara);
        if (i >= 0) s.inmates.splice(i, 1);
      }
    }
    // 放回地图：找一个空槽
    let slot = -1;
    for (let i = 16; i < 245; i++) {
      if (!g.charas[i] || (g.charas[i].get(0) | 0) !== 1) { slot = i; break; }
    }
    if (slot < 0) return { ok: false, reason: 'no-slot', message: '外に出せる場所がない。' };
    const p = g.player;
    chara.x = (p.x | 0) + 1;
    chara.y = p.y | 0;
    chara.set(9, 0);
    chara.set(69, 0);
    chara.set(0, 1);
    g.charas[slot] = chara;
    chara.index = slot;
    if (g.syncCharaCells) g.syncCharaCells();
    return { ok: true, slot, message: `${chara.name}を檻から出した。（${chara.name} 被放出）` };
  }

  /** 劳动能量累积（收容所的劳动力蓄积） */
  function addEnergy(g, mapId, n) {
    const st = readState(g, mapId);
    if (!st) return { ok: false, reason: 'not-camp' };
    const r = writeEnergy(g, mapId, (st.toilEnergy | 0) + (n | 0));
    if (!r.ok) return r;
    return { ok: true, toilEnergy: r.toilEnergy };
  }

  // ---------------------------------------------------------------- 劳动强度
  /**
   * 变更劳动强度（234164-234195）。
   * @param {number} lv 0..3
   */
  function setToilLevel(g, lv, mapId) {
    const st = readState(g, mapId);
    if (!st) return { ok: false, reason: 'not-camp', message: 'ここには収容所がない。' };
    const r = writeToilLv(g, mapId, lv);
    if (!r.ok) return r;
    const d = TOIL_LEVELS[r.toilLv];
    return {
      ok: true, toilLv: r.toilLv,
      message: `労働強度を変更した。（劳动强度变更为 ${r.toilLv}：${d ? d.jp : ''}）`,
    };
  }

  // ---------------------------------------------------------------- 能量兑换
  /**
   * 劳动能量兑换（234197-234433）。
   * @param {number} idx 1..10（对应 EXCHANGE_ITEMS）
   */
  function exchangeEnergy(g, idx, mapId) {
    const st = readState(g, mapId);
    if (!st) return { ok: false, reason: 'not-camp', message: 'ここには収容所がない。' };
    const entry = EXCHANGE_ITEMS.filter((x) => x.idx === (idx | 0))[0];
    if (!entry) return { ok: false, reason: 'bad-index', message: '交換できない。' };
    if ((st.toilEnergy | 0) < entry.cost) {
      return { ok: false, reason: 'not-enough',
        message: '労働エナジーが足りない…（劳动能量不足）' };
    }
    // 234215-234217：上限 100000
    const after = writeEnergy(g, mapId, (st.toilEnergy | 0) - entry.cost);
    if (!after.ok) return after;
    // 234237-234431：物品掉落在玩家脚下
    const p = g.player;
    const dropped = [];
    for (const spec of entry.items) {
      if (!Elona.ItemDB || !Elona.ItemDB.createItem) continue;
      if (spec.id === 54) {
        // カジノチップ 10 枚 → var_497(1) += 10（源码 234424）
        if (g.setV65) g.setV65(497, (g.getV65 ? (g.getV65(497) | 0) : 0) + (spec.count | 0));
        dropped.push({ id: 54, count: spec.count });
        continue;
      }
      const it = Elona.ItemDB.createItem(spec.id, spec.count);
      if (!it) continue;
      it.f[0] = spec.count;
      it.f[17] = 0;
      it.f[5] = p.x | 0;
      it.f[6] = p.y | 0;
      if (g.groundItems) g.groundItems.push(it);
      dropped.push({ id: spec.id, count: spec.count });
    }
    if (g.refreshGroundCell) g.refreshGroundCell(p.x | 0, p.y | 0);
    return {
      ok: true,
      cost: entry.cost,
      toilEnergy: after.toilEnergy,
      dropped,
      message: `労働エナジー${entry.cost}を消費して、${entry.jp}を手に入れた。`
        + `（消耗 ${entry.cost} 劳动能量，获得 ${entry.jp}）`,
    };
  }

  // ---------------------------------------------------------------- 每日产出
  /**
   * 每日劳动产出（248971-249017）。
   * 源码位于 renew_major（每 120 小时 = 5 天一次，249201-249203 收容所专用间隔）。
   * @returns {{produced:number, messages:string[]}}
   */
  function produceDaily(g, mapId) {
    const st = readState(g, mapId);
    if (!st) return { produced: 0, messages: [] };
    const messages = [];
    // 248973：var_1886 = var_132(38)^3
    const lv = st.toilLv | 0;
    const cube = lv * lv * lv;
    let produced = 0;
    const inmates = [];
    const list = (g && g.charas) || [];
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (c && cbitOf(c, CG_CAPTIVE)) inmates.push(c);
    }
    if (g && g.propertySites) {
      for (const k of Object.keys(g.propertySites)) {
        const s = g.propertySites[k];
        if (s && s.inmates) for (const c of s.inmates) inmates.push(c);
      }
    }
    for (const c of inmates) {
      if ((c.get(0) | 0) !== 1) continue;                 // 248975：存活
      if (cube > 0) {
        produced += cube * 2;                              // 248982
        if (cbitOf(c, CG_FATIGUE)) {                        // 248983-248992
          messages.push(`${c.name}は労働エナジーで疲労をこらえたようだ。`
            + `（${c.name} 似乎凭借劳动能量忍受住了疲劳）`);
          setCbit(c, CG_FATIGUE, 0);
        } else {
          const will = Elona.Stats ? Elona.Stats.sorg(c, 2) : 0;  // 248994：sorg(2) = 意志
          if (will <= cube) {
            // 248995：evadd 68 → 610070-610078：意志归零 + 受伤 + 阵营清除 + 死亡
            c.set(50, 0);
            c.set(150, 0);
            c.set(0, 0);
            messages.push(`${c.name}は労働の疲れで倒れた。`
              + `（${c.name} 因劳动的疲劳而倒下）`);
          } else if (Elona.Stats && Elona.Stats.skillMod) {
            // 248998：skillmod 2（意志） -var_1886 * 1000
            Elona.Stats.skillMod(c, 2, c, -cube * 1000, g);
          }
        }
      }
      // 249002-249004：好感度加成
      const rel = c.get(169) | 0;
      if (rel > 0) produced += ((rel / 10) | 0) + 1;
    }
    if (produced > 0) {
      const after = writeEnergy(g, mapId, (st.toilEnergy | 0) + produced);
      if (after.ok) {
        messages.push(`労働エナジーが${produced}生産されたようだ。`
          + `[現在の労働エナジー：${after.toilEnergy}]`
          + `（产生了 ${produced} 劳动能量，当前 ${after.toilEnergy}）`);
      }
    }
    return { produced, messages, toilEnergy: readState(g, mapId).toilEnergy };
  }

  // ---------------------------------------------------------------- 自行劳动
  /**
   * 收容所的周期性产出（248946-249017 的 renew_major 分支）。
   * 源码里收容所地图的 renew_major 间隔是 120 小时（= 5 天，249201-249203），
   * 且只在**玩家身处收容所地图**时才结算。
   * 源码的 var_126(3) 初始为 0（237958），即第一次检查就会触发一次 renew_major。
   * @returns {{produced:number, messages:string[]}|null}
   */
  function producePeriodically(g) {
    const camp = campOf(g);
    if (!camp) return null;
    // 必须在收容所地图上（源码是按 var_65(20) 的地图类型判定）
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    if (mapId !== camp.mapId) return null;
    const now = g.nowHours ? g.nowHours() : 0;
    const host = camp.runtime
      ? camp.runtime
      : (Elona.Sites ? Elona.Sites.get(camp.mapId) : null);
    if (!host) return null;
    if (host.lastProduce === undefined) {
      // 源码 var_126(3) 初始为 0 → 第一次检查即触发
      host.lastProduce = now - 120;
    }
    if (now - host.lastProduce < 120) return null;
    host.lastProduce = now;
    return produceDaily(g, camp.mapId);
  }

  /**
   * 使用劳动器具（358394-358425 → var_65(91) = 107/108）。
   * 只能在收容所内使用（358396-358404）。
   * @returns {{ok:boolean, turns:number, sp:number, energy:number, message:string}}
   */
  function workWithTool(g, itemId) {
    const tool = WORK_TOOLS[itemId | 0];
    if (!tool) return { ok: false, reason: 'not-tool', message: 'これは労働用の道具ではない。' };
    const camp = campOf(g);
    if (!camp) {
      return { ok: false, reason: 'not-camp',
        message: '収容所以外ではエナジーを蓄積できない。（在收容所外无法积累能量）' };
    }
    return {
      ok: true,
      mode: tool.mode,
      turns: tool.turns,
      sp: tool.sp,
      energy: tool.energy,
      message: `あなたは${tool.jp}で労働を始めた。（你开始使用${tool.jp}劳动）`,
    };
  }

  /**
   * 自行劳动的每回合结算（311249-311261）。
   * @param {number} mode 107 / 108
   */
  function workTick(g, mode, mapId) {
    const tool = mode === 107 ? WORK_TOOLS[1294] : (mode === 108 ? WORK_TOOLS[1293] : null);
    if (!tool) return { ok: false };
    // 311250-311254：dmgsp 0,5（疲劳）+ var_132(37) += 3
    if (g.player) {
      const p = g.player;
      if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(p, tool.sp);
      else p.set(52, (p.get(52) | 0) - tool.sp);
    }
    const r = addEnergy(g, mapId, tool.energy);
    return { ok: true, energy: tool.energy, toilEnergy: r.toilEnergy };
  }

  Elona.Camp = {
    CAMP_TYPE, CG_CAPTIVE, CG_BOUND, CG_ESCORT, CG_PROTECTED, CG_DISGUISE, CG_FATIGUE,
    CERT_ITEM, MAX_CAPTIVE, ENERGY_MAX,
    TOIL_LEVELS, EXCHANGE_ITEMS, WORK_TOOLS,
    campOf, captiveCount, status, readState, writeEnergy, writeToilLv,
    imprison, release, addEnergy,
    setToilLevel, exchangeEnergy, produceDaily, producePeriodically,
    workWithTool, workTick,
  };
})(window);
