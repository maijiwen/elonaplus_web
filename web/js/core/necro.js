'use strict';
/**
 * 死灵术（ネクロマンシー）—— 暗之棺 / 使役死灵 / 死灵能力。
 *
 * 【源码定位】
 *   配方 229 ネクロマンシー（280227-280230）→ 产物 903 暗之棺，需 解剖学(161) 10 + 炼金术(178) 10
 *   配方 230 ネクロチューニング（280233-280236）→ 材料 903 + 503(剥製)，同调改造
 *   使用暗之棺 var_1302 == 63（355947-356064）
 *   地图载入自动召唤（227980-228107）—— 持有 991 異界墓地の鍵 时最多 15 具
 *   送还「棺に戻す」var_400 == 13（290483-290560）
 *   能力 743 ネクロフォース（332786-333076）—— 5 个选项
 *   能力 854 アクセルネクロ（331553-331594）
 *   死者融合 91（355215-355537）—— 需要《邪成鎌ネクロマンティス》1049
 *   死灵 AI（592579 / 593183 / 594078）—— 跟随玩家、只攻击锁定目标
 *
 * 【暗之棺的数据编码】（var_99 = item.f）
 *   f[25] 死灵类型 2..9（对应 8 种死灵，见 COFFIN_TYPES）
 *   f[26] 材质来源种族（var_58(410)，用于「-欺繕」等特殊标记）
 *   f[34] var_58(435) 备份（融合死灵标记）
 *   f[9]  可再次使用的时间戳（年*360*24 + 月*30*24 + 日*24 + 时）
 *   f[27] 冷却小时数（打包进棺的剩余冷却）
 *   f[7]  += 类型 * 1000（棺木重量）
 *   f[8]  = 10（鉴定后品质）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const COFFIN_ID = 903;      // 闇の棺
  const KEY_ID = 991;         // 異界墓地の鍵
  const SICKLE_ID = 1049;     // 邪成鎌ネクロマンティス
  const MAX_ACTIVE = 15;      // 355966：同时使役上限
  const COOL_RETURN = 1;      // 主动送还的冷却（小时）
  const COOL_DEATH = 24;      // 战死变回棺的冷却（小时）
  const CG_HOST = 992;        // cbit：使役死灵

  /** 355974-355995 / 290484-290507：类型 → 物种 */
  const COFFIN_TYPES = {
    2: { species: 447, jp: '猫ゾンビ', en: 'cat' },
    3: { species: 21, jp: 'ゾンビ', en: 'zombie' },
    4: { species: 100, jp: 'マミー', en: 'mummy' },
    5: { species: 150, jp: '骸骨戦士', en: 'skeleton' },
    6: { species: 47, jp: 'リッチ', en: 'lich' },
    7: { species: 578, jp: 'ネクロドール', en: 'doll' },
    8: { species: 416, jp: 'ドラゴンゾンビ', en: 'dragon' },
    9: { species: 579, jp: 'デッドアイズ', en: 'dead-eyes' },
  };
  const SPECIES_TO_TYPE = {};
  for (const k of Object.keys(COFFIN_TYPES)) SPECIES_TO_TYPE[COFFIN_TYPES[k].species] = Number(k);

  /** 355173 / 227173：神经系的 5 个选项（txtsetnecro 6，索引 0 = 取消） */
  const FORCE_MENU = [
    { id: 0, jp: 'キャンセル', en: 'Cancel' },
    { id: 1, jp: '使役アンデッド全回収', en: 'Undead return' },
    { id: 2, jp: 'MP消費/アンデッド強化', en: 'Undead strengthen' },
    { id: 3, jp: 'HP消費/アンデッド回復', en: 'Undead restore' },
    { id: 4, jp: '防御肉薄＆自爆命令', en: 'Undead bomb' },
    { id: 5, jp: '使役アンデッド招集', en: 'Undead call' },
  ];

  // ---------------------------------------------------------------- 时间
  /** 原版时间戳：年*360*24 + 月*30*24 + 日*24 + 时（var_65(10..13)） */
  function nowHour(g) {
    if (!g || !g.getV65) return 0;
    return (g.getV65(13) | 0) + (g.getV65(12) | 0) * 24
      + (g.getV65(11) | 0) * 24 * 30 + (g.getV65(10) | 0) * 24 * 30 * 12;
  }

  // ---------------------------------------------------------------- 基础
  function skillOf(g, id) {
    const p = g && g.player;
    if (!p) return 0;
    // 技能等级 = var_82(id+600)/1000000（Elona.Stats.sorg）；
    // c.skill(id) 是 var_82(id)（未编码的潜力槽），不是等级。
    if (Elona.Stats && Elona.Stats.sorg) return (Elona.Stats.sorg(p, id) | 0);
    return typeof p.skill === 'function' ? (p.skill(id) | 0) : 0;
  }

  function isCoffin(item) { return !!item && (item.id | 0) === COFFIN_ID; }

  /** f[25] 死灵类型，非法值一律按 2（猫ゾンビ） */
  function typeOf(item) {
    const t = (item && item.f && item.f[25]) | 0;
    return COFFIN_TYPES[t] ? t : 2;
  }

  /** 355996-356002：等级 = (解剖 + 炼金) * (type + 5) / 14，上限 最深深度*3/2，有原种族 +5 */
  function coffinLevel(g, item, type) {
    const t = type || typeOf(item);
    const anat = skillOf(g, 161);
    const alch = skillOf(g, 178);
    let lv = idiv((anat + alch) * (t + 5), 14);
    const depth = (g && g.getV65) ? (g.getV65(189) | 0) : 0;
    if (depth > 0) {
      const cap = idiv(depth * 3, 2);
      if (lv > cap) lv = cap;
    }
    if (((item && item.f && item.f[26]) | 0) !== 0) lv += 5;
    return Math.max(1, lv);
  }

  /** 冷却还剩几小时（>0 表示还不能用） */
  function cooldownLeft(g, item) {
    if (!item || !item.f) return 0;
    const at = item.f[9] | 0;
    if (at <= 0) return 0;
    return Math.max(0, at - nowHour(g));
  }

  function canUse(g, item) {
    if (!isCoffin(item)) return { ok: false, reason: 'not-coffin' };
    if ((item.f[0] | 0) <= 0) return { ok: false, reason: 'empty' };
    const left = cooldownLeft(g, item);
    if (left > 0) {
      return { ok: false, reason: 'cooldown',
        message: `棺の中の死霊はまだ眠っている……（あと ${left} 時間）` };
    }
    return { ok: true };
  }

  /** 现在使役中的死灵数（355957-355965：统计 var_58(9)==10） */
  function activeCount(g) {
    let n = 0;
    const list = (g && g.charas) || [];
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (c && (c.get(0) | 0) === 1 && (c.get(9) | 0) === 10) n++;
    }
    return n;
  }

  /** 16..244 的空槽（死灵占 NPC 槽，不能占 1..15 的队伍槽） */
  function freeNpcSlot(g) {
    const list = (g && g.charas) || [];
    for (let i = 16; i < 245; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) return i;
    }
    return -1;
  }

  /** 玩家周围 1 格内的空地 */
  function nearSpot(g, x, y) {
    const cand = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [dx, dy] of cand) {
      const nx = x + dx, ny = y + dy;
      if (!g.map || !g.map.inBounds || !g.map.inBounds(nx, ny)) continue;
      const chk = g.map.check ? g.map.check(nx, ny) : null;
      if (chk && !chk.walkable) continue;
      return { x: nx, y: ny };
    }
    return { x, y };
  }

  function cbitOf(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, bit) : 0;
  }
  function setCbit(c, bit, v) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit, v);
  }

  // ---------------------------------------------------------------- 召唤
  /**
   * 使用暗之棺召唤死灵（355947-356064）。
   * @returns {{ok:boolean, chara?:object, message:string}}
   */
  function summon(g, item, opt) {
    const o = opt || {};
    const chk = canUse(g, item);
    if (!chk.ok) {
      if (chk.reason === 'cooldown') return { ok: false, reason: 'cooldown', message: chk.message };
      return { ok: false, reason: chk.reason || 'invalid', message: 'それは使えない。' };
    }
    // 355949：世界地图 / 禁止地图
    const mapId = (g.getV65 ? (g.getV65(20) | 0) : 0);
    if (mapId === 6) return { ok: false, reason: 'worldmap', message: 'ここでは死霊を呼び出せない。' };
    // 355966：同时使役上限
    if (activeCount(g) >= MAX_ACTIVE) {
      return { ok: false, reason: 'limit',
        message: 'これ以上は同時に使役できない。（已达上限 15 具）' };
    }
    const p = g.player;
    const type = typeOf(item);
    const species = COFFIN_TYPES[type].species;
    const lv = coffinLevel(g, item, type);
    const slot = (o.slot !== undefined) ? o.slot : freeNpcSlot(g);
    if (slot < 0) return { ok: false, reason: 'no-slot', message: '使役できる余裕がない。' };
    if (!Elona.CharaFactory || !Elona.CharaFactory.create) {
      return { ok: false, reason: 'no-factory', message: '现在无法召唤。' };
    }
    const spot = o.at || nearSpot(g, p.x, p.y);
    let c = null;
    try {
      // 356017-356021：var_1023 = 目标等级、var_1475 = 1、var_641 = 2
      c = Elona.CharaFactory.create(g, species, lv, spot.x, spot.y,
        { index: slot, var1023: lv, var641: 2 });
    } catch (e) { c = null; }
    if (!c) return { ok: false, reason: 'create-failed', message: '死霊は現れなかった……' };

    g.charas[slot] = c;
    c.index = slot;
    c.__necro = true;
    c.set(0, 1);
    c.set(9, 10);                 // 356022：var_58(9) = 10（非敌对、非队伍）
    c.set(69, 10);
    setCbit(c, CG_HOST, 1);       // 356024：cbit 992
    c.set(410, item.f[26] | 0);   // 356025：保存材质来源种族
    c.name = `${c.name} Lv${c.get(38) | 0}`;

    // 356027-356044：var_1441（原种族）派生出的名字后缀 / 标记
    const orig = item.f[26] | 0;
    const fuseFlag = (item.f[34] | 0) === 1;
    if (!fuseFlag) {
      if (orig >= 1800) c.set(7, orig);
      if (orig >= 12000 && orig < 18000) c.set(7, orig - 12000);
    } else {
      if (orig >= 2800) { c.set(7, orig); c.set(435, 1); }
      if (orig > 13000 && orig < 19000) { c.set(7, orig - 13000); c.set(435, 1); }
    }

    // 356015：消耗 1 具
    item.f[0] = (item.f[0] | 0) - 1;
    if (g.syncCharaCells) g.syncCharaCells();
    if (g.refreshGroundCell) g.refreshGroundCell(item.f[5] | 0, item.f[6] | 0);

    // 356052-356059：首次召唤习得能力 743
    let learned = false;
    if (Elona.Feat && Elona.Feat.setFlag && (Elona.Feat.flag(p, 143) | 0) === 0) {
      // 356052-356053：var_98(743-600) = var_98(143) = 1
      Elona.Feat.setFlag(p, 143, 1);
      learned = true;
    }
    return {
      ok: true, chara: c, learned, level: lv, type,
      message: '闇と共に棺からアンデッドが這いずり出てきた。（死灵从棺中爬了出来。）'
        + (learned ? `\nあなたは「ネクロフォース」の能力を得た。` : ''),
    };
  }

  /**
   * 地图载入时自动召唤（227980-228107）：
   *   持有 991 異界墓地の鍵 时，把背包里最多 15 个暗之棺依次放出。
   */
  function summonOnLoad(g) {
    const p = g && g.player;
    if (!p || !p.inv) return { ok: false, summoned: [] };
    const hasKey = p.inv.some((it) => it && (it.id | 0) === KEY_ID && (it.f[0] | 0) > 0);
    if (!hasKey) return { ok: false, reason: 'no-key', summoned: [] };
    const mapId = (g.getV65 ? (g.getV65(20) | 0) : 0);
    if (mapId === 40 || mapId === 6) return { ok: false, reason: 'map', summoned: [] };
    const out = [];
    for (let k = 0; k < MAX_ACTIVE; k++) {
      const it = p.inv.find((x) => isCoffin(x) && (x.f[0] | 0) >= 1
        && cooldownLeft(g, x) <= 0);
      if (!it) break;
      const r = summon(g, it, {});
      if (r.ok) out.push(r.chara);
      else break;
    }
    return { ok: out.length > 0, summoned: out };
  }

  // ---------------------------------------------------------------- 送还
  /**
   * 把死灵变回暗之棺（290483-290560 / 332925-332953）。
   * @param {number} hours 冷却小时数
   */
  function recall(g, chara, hours) {
    if (!chara || !chara.__necro) return { ok: false, message: '那不是你的死灵。' };
    const type = SPECIES_TO_TYPE[chara.get(27) | 0];
    if (!type) return { ok: false, message: 'その死霊は棺に戻せない。' };
    const cool = (hours === undefined) ? COOL_RETURN : (hours | 0);
    const p = g.player;
    const it = Elona.ItemDB.createItem(COFFIN_ID, 1);
    if (!it) return { ok: false, message: '棺を用意できなかった。' };
    it.f[25] = type;
    it.f[26] = chara.get(410) | 0;
    it.f[7] = (it.f[7] | 0) + type * 1000;
    it.f[9] = nowHour(g) + cool;
    it.f[27] = cool;
    it.f[17] = 0;
    it.f[8] = 10;
    it.f[34] = chara.get(435) | 0;
    // 341/340/339/338/337（里神）与 >=18000 的材质归零（290523-290545）
    if ([341, 340, 339, 338, 337].indexOf(it.f[26] | 0) >= 0) it.f[26] = 0;
    if ((it.f[26] | 0) >= 18000) it.f[26] = 0;

    // 落在地上（角色脚下）
    const x = chara.x | 0, y = chara.y | 0;
    it.f[5] = x; it.f[6] = y;
    if (g.groundItems) g.groundItems.push(it);

    // 从地图移除
    const cell = (g.map && g.map.cell) ? g.map.cell(x, y) : null;
    if (cell) cell[1] = 0;
    chara.set(0, 0);
    setCbit(chara, CG_HOST, 0);
    chara.__necro = false;
    if (g.syncCharaCells) g.syncCharaCells();
    if (g.refreshGroundCell) g.refreshGroundCell(x, y);
    return {
      ok: true, item: it, cooldown: cool,
      message: `${chara.name}を棺に戻した。（${chara.name} 回到了棺中，冷却 ${cool} 小时。）`,
    };
  }

  /** 视野内的死灵（355284-355296：距离 limit(65536/1000,1)=... → 约 5 格 + 视线） */
  function necrosInSight(g, radius) {
    const p = g.player;
    const r = radius || 6;
    const out = [];
    const list = g.charas || [];
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (!cbitOf(c, CG_HOST)) continue;
      const d = Math.max(Math.abs((c.x | 0) - (p.x | 0)), Math.abs((c.y | 0) - (p.y | 0)));
      if (d > r) continue;
      if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, p.x, p.y, c.x, c.y)) continue;
      out.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------- 能力 743
  /**
   * ネクロフォース（332786-333076）玩家分支。
   * @param {number} choice 1..5（0 = 取消）
   */
  function necroForce(g, choice) {
    const p = g.player;
    const R = (n) => ((g.rng ? g.rng.rnd(n) : Math.floor(Math.random() * n)));
    const c = (choice | 0);
    const target = necrosInSight(g, 6);
    const msgs = [];
    if (c === 0) return { ok: true, cancelled: true, messages: ['キャンセル。'] };
    if (c === 1) {
      // 全回收（332925-332953）
      let n = 0;
      for (const nc of target) {
        const r = recall(g, nc, COOL_RETURN);
        if (r.ok) { n++; msgs.push(r.message); }
      }
      if (!n) return { ok: false, reason: 'none', message: '視界内に使役アンデッドはいない。' };
      return { ok: true, recalled: n, messages: msgs };
    }
    if (c === 2) {
      // MP 强化（332955-332958）：addbuff 68，强度 (魔力控制188+意志16)/4+1，100 回合
      const mc = skillOf(g, 188), wil = skillOf(g, 16);
      const lv = idiv(mc + wil, 4) + 1;
      let done = 0, cost = 0;
      for (const nc of target) {
        const need = (nc.get(38) | 0) + idiv(p.get(56) | 0, 33) + 1;
        if ((p.get(55) | 0) < need) break;
        p.set(55, (p.get(55) | 0) - need);
        cost += need;
        if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, nc, 68, lv, 100);
        done++;
        msgs.push(`${nc.name} に「操魔の鎖」をかけた。`);
      }
      if (!done) return { ok: false, reason: 'no-mp', message: 'MPが足りない。' };
      if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, 188, p.index | 0, 100, 0, 0, g);
      return { ok: true, affected: done, mp: cost, power: lv, messages: msgs };
    }
    if (c === 3) {
      // HP 回复（332960-332963）：addbuff 69
      const mc = skillOf(g, 188), con = skillOf(g, 16);
      const lv = idiv(mc + con, 4) + 1;
      let done = 0, cost = 0;
      for (const nc of target) {
        const need = (nc.get(38) | 0) + idiv(p.get(51) | 0, 33) + 1;
        if ((p.get(50) | 0) <= need) break;
        p.set(50, (p.get(50) | 0) - need);
        cost += need;
        if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, nc, 69, lv, 100);
        done++;
        msgs.push(`${nc.name} に「偽命の灯」を燈した。`);
      }
      if (!done) return { ok: false, reason: 'no-hp', message: 'HPが足りない。' };
      if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, 188, p.index | 0, 100, 0, 0, g);
      return { ok: true, affected: done, hp: cost, power: lv, messages: msgs };
    }
    if (c === 4) {
      // 自爆命令（332965-332984）：var_58(146)=10、var_58(29)=玩家目标、var_58(201)=30
      let done = 0;
      for (const nc of target) {
        if ((nc.get(146) | 0) === 10) {
          nc.set(146, 0);
          msgs.push(`${nc.name} の眼が元に戻った。`);
          continue;
        }
        nc.set(146, 10);
        nc.set(29, p.get(29) | 0);      // 跟随玩家锁定的目标
        nc.set(201, 30);
        done++;
        msgs.push(`${nc.name} の眼が不気味に光り出した。`);
      }
      if (!done && !msgs.length) {
        return { ok: false, reason: 'none', message: '視界内に使役アンデッドはいない。' };
      }
      return { ok: true, armed: done, messages: msgs };
    }
    if (c === 5) {
      // 招集（332848-332864）：把视野内（不限距离）的死灵传送到玩家身边
      const all = [];
      const list = g.charas || [];
      for (let i = 1; i < list.length; i++) {
        const nc = list[i];
        if (!nc || (nc.get(0) | 0) !== 1) continue;
        if (!cbitOf(nc, CG_HOST)) continue;
        all.push(nc);
      }
      if (!all.length) return { ok: false, reason: 'none', message: '使役アンデッドはいない。' };
      let n = 0;
      for (const nc of all) {
        const spot = nearSpot(g, p.x, p.y);
        const cell = (g.map && g.map.cell) ? g.map.cell(nc.x | 0, nc.y | 0) : null;
        if (cell) cell[1] = 0;
        nc.x = spot.x; nc.y = spot.y;
        n++;
        msgs.push(`${nc.name} が駆けつけた。`);
      }
      if (g.syncCharaCells) g.syncCharaCells();
      return { ok: true, called: n, messages: msgs };
    }
    return { ok: false, reason: 'bad-choice' };
  }

  // ---------------------------------------------------------------- 能力 854
  /** アクセルネクロ（331553-331594）：SP 换死灵加速/咏唱/回避 buff */
  function accelNecro(g) {
    const p = g.player;
    const target = necrosInSight(g, 6);
    if (!target.length) return { ok: false, reason: 'none', message: '視界内に使役アンデッドはいない。' };
    const mc = skillOf(g, 188), spd = skillOf(g, 15);
    const a = idiv(mc + spd, 4) + 1;
    const b = idiv(mc + spd, 2) + 1;
    const per = idiv(p.get(53) | 0, 20) + 1;      // var_58(53)=SP，每具消耗 SP/20+1
    let done = 0, cost = 0;
    const msgs = [];
    for (const nc of target) {
      if ((p.get(53) | 0) < cost + per) break;
      cost += per;
      if (Elona.Status && Elona.Status.addbuff) {
        Elona.Status.addbuff(g, nc, 52, a, 50);
        Elona.Status.addbuff(g, nc, 5, b, 50);
        Elona.Status.addbuff(g, nc, 17, 20, 50);
      }
      done++;
      msgs.push(`${nc.name} が加速した。`);
    }
    if (!done) return { ok: false, reason: 'no-sp', message: 'SPが足りない。' };
    p.set(53, (p.get(53) | 0) - cost);
    if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, 188, p.index | 0, 100, 0, 0, g);
    return { ok: true, affected: done, sp: cost, messages: msgs };
  }

  // ---------------------------------------------------------------- 融合（91）
  /** 355215-355537：需要《邪成鎌ネクロマンティス》(1049)，消耗 25% 斗志（var_58(182)） */
  /**
   * 4 个固定配方（`txtsetnecrom 5` 的 0..3，菜单文本见 10856-10870）。
   * 配对以源码的两处检查为准：
   *   355309-355328  `var_444 == N` 时找**第一只素材**（0→21 / 1→447 / 2→150 / 3→47）
   *   355361-355379  `var_444 == N` 时找**第二只素材**（0→416 / 1→100 / 2→579 / 3→578）
   *   355504-355515  `var_444 == N` 决定**产物**（0→878 / 1→877 / 2→876 / 3→875）
   * 名字以 `creature.json` 为准：
   *   878 ユナイデッド・キング / 877 クイーン / 876 ジャック / 875 ジョーカー
   * ※ 0-DS 修正：此前 `a/b` 把 0 号与 2 号的第二只素材（416 与 579）互换了，
   *   导致「骸骨戦士＋ドラゴンゾンビ」这种源码里不存在的组合能融合，
   *   而源码里的「骸骨戦士＋デッドアイズ」反而不行。
   */
  const FUSE_PAIRS = [
    { a: 21, b: 416, out: 878, jp: 'キング', menu: '僵尸 ＋ 龙僵尸' },
    { a: 447, b: 100, out: 877, jp: 'クイーン', menu: '猫僵尸 ＋ 木乃伊' },
    { a: 150, b: 579, out: 876, jp: 'ジャック', menu: '骸骨战士 ＋ 死眼' },
    { a: 47, b: 578, out: 875, jp: 'ジョーカー', menu: '巫妖 ＋ 死灵娃娃' },
  ];

  function hasSickle(g) {
    const p = g && g.player;
    if (!p || !p.inv) return false;
    return p.inv.some((it) => it && (it.id | 0) === SICKLE_ID && (it.f[0] | 0) > 0);
  }

  function fuse(g, a, b) {
    const p = g.player;
    if (!hasSickle(g)) return { ok: false, reason: 'no-sickle', message: '《邪成鎌ネクロマンティス》が必要だ。' };
    if ((p.get(182) | 0) < 25) return { ok: false, reason: 'no-power', message: 'パワーゲージが25％必要だ。' };
    const ta = (a.get(27) | 0), tb = (b.get(27) | 0);
    const pair = FUSE_PAIRS.find((x) => (x.a === ta && x.b === tb) || (x.a === tb && x.b === ta));
    if (!pair) return { ok: false, reason: 'bad-pair', message: 'その組み合わせでは融合できない。' };
    const lv = skillOf(g, 161) + skillOf(g, 178);       // 355516：(解剖161 + 炼金178)
    const slot = freeNpcSlot(g);
    if (slot < 0) return { ok: false, reason: 'no-slot' };
    const spot = nearSpot(g, p.x, p.y);
    let c = null;
    try {
      c = Elona.CharaFactory.create(g, pair.out, Math.max(1, lv), spot.x, spot.y,
        { index: slot, var1023: Math.max(1, lv), var641: 2 });
    } catch (e) { c = null; }
    if (!c) return { ok: false, reason: 'create-failed' };
    g.charas[slot] = c;
    c.index = slot;
    c.__necro = true;
    c.set(0, 1); c.set(9, 10); c.set(69, 10);
    setCbit(c, CG_HOST, 1);
    setCbit(c, 1035, 1);          // 355528：融合死灵带 cbit 1035（不能被收纳/唯一）
    c.name = `${c.name} Lv${c.get(38) | 0}`;
    // 两个素材回棺（冷却 24 小时）
    recall(g, a, COOL_DEATH);
    recall(g, b, COOL_DEATH);
    p.set(182, (p.get(182) | 0) - 25);
    if (g.syncCharaCells) g.syncCharaCells();
    return {
      ok: true, chara: c, kind: pair.jp, level: lv,
      message: `*死者融合*　融合亡灵兵器・${pair.jp} が現れた！`,
    };
  }

  // ---------------------------------------------------------------- 融合前端（itemfx 91）
  /**
   * `txtsetnecrom 5`（10918-10940）的 4 个配方 + 取消。
   * @returns {Array<{value:number,label:string}>}
   */
  function fuseMenu() {
    const out = FUSE_PAIRS.map((p, i) => ({ value: i, label: p.menu }));
    out.push({ value: 4, label: '取消' });
    return out;
  }

  /**
   * 355220-355400：菜单选中后的完整前端。
   *   · 355240-355280  场上已有该融合产物（cbit 992 的死灵里 var_58(27) == out）→ 「只能使役一只」
   *   · 355283-355400  在视野内（距离 ≤ 视界、有 LOS、带 cbit 992、不带 cbit 1035）找两只素材
   * 真正的生成与回棺在 `fuse()`（355516-355537）。
   */
  function fuseStart(g, choice) {
    const idx = choice | 0;
    if (idx === 4) return { ok: true, cancelled: true };
    const pair = FUSE_PAIRS[idx];
    if (!pair) return { ok: false, reason: 'bad-choice', message: 'その組み合わせはない。' };
    const p = g && g.player;
    if (!p) return { ok: false, reason: 'no-player' };
    if (!hasSickle(g)) {
      return { ok: false, reason: 'no-sickle', message: '《邪成鎌ネクロマンティス》が必要だ。' };
    }
    if ((p.get(182) | 0) < 25) {
      return { ok: false, reason: 'no-power', message: 'パワーゲージが25％必要だ。' };
    }
    const inSight = (c) => {
      if (!c || (c.get(0) | 0) !== 1) return false;
      if ((c.index | 0) < 16) return false;
      if (cbitOf(c, CG_HOST) !== 1) return false;       // 355296 只认死灵
      const d = Math.max(Math.abs((c.x | 0) - (p.x | 0)), Math.abs((c.y | 0) - (p.y | 0)));
      return d <= 20;                                   // var_83(3,656)/1000 + 1 的近似
    };
    const alive = [];
    for (let i = 0; i < 245; i++) {
      const c = g.charas[i];
      if (c && inSight(c)) alive.push(c);
    }
    // 355240-355280：同一产物只能有一只
    if (alive.some((c) => (c.get(27) | 0) === pair.out)) {
      return { ok: false, reason: 'one-only', message: '那种只能使役一只。' };
    }
    // 第一只素材（不带 cbit 1035，即未融合过的）
    const a = alive.find((c) => (c.get(27) | 0) === pair.a && cbitOf(c, 1035) !== 1);
    if (!a) return { ok: false, reason: 'no-material', message: '视野内没有素材。' };
    const b = alive.find((c) => c !== a && (c.get(27) | 0) === pair.b && cbitOf(c, 1035) !== 1);
    if (!b) return { ok: false, reason: 'no-material', message: '视野内没有素材。' };
    return fuse(g, a, b);
  }

  // ---------------------------------------------------------------- 战死
  /** 死灵战死 → 变回暗之棺（冷却 24 小时），落在死亡地点 */
  function onNecroDeath(g, chara) {
    if (!chara || !chara.__necro) return null;
    const type = SPECIES_TO_TYPE[chara.get(27) | 0];
    if (!type) return null;
    const it = Elona.ItemDB.createItem(COFFIN_ID, 1);
    if (!it) return null;
    it.f[25] = type;
    it.f[26] = chara.get(410) | 0;
    it.f[7] = (it.f[7] | 0) + type * 1000;
    it.f[9] = nowHour(g) + COOL_DEATH;
    it.f[27] = COOL_DEATH;
    it.f[17] = 0;
    it.f[8] = 10;
    it.f[34] = chara.get(435) | 0;
    if ([341, 340, 339, 338, 337].indexOf(it.f[26] | 0) >= 0) it.f[26] = 0;
    if ((it.f[26] | 0) >= 18000) it.f[26] = 0;
    it.f[5] = chara.x | 0;
    it.f[6] = chara.y | 0;
    if (g.groundItems) g.groundItems.push(it);
    chara.__necro = false;
    return { item: it,
      message: `${chara.name} は棺に戻った。（死灵战败，变回暗之棺，冷却 24 小时。）` };
  }

  // ---------------------------------------------------------------- 名称
  /** 物品名后缀（31085-31131）：暗の棺 (猫ゾンビ) 之类 */
  function coffinName(item, lang) {
    if (!isCoffin(item)) return null;
    const t = typeOf(item);
    const tp = COFFIN_TYPES[t];
    let s = (lang === 'en') ? `(${tp.en})` : `(${tp.jp})`;
    const orig = item.f[26] | 0;
    if (orig >= 12000 && orig < 18000) s += (lang === 'en') ? '-Deceive' : '-欺繕';
    const left = (item.f[9] | 0);
    return { suffix: s, species: tp.species, type: t, readyAt: left };
  }

  /** 暗之棺一览（用于背包/状态面板） */
  function list(g) {
    const p = g && g.player;
    if (!p || !p.inv) return [];
    return p.inv.filter(isCoffin).map((it) => ({
      item: it,
      type: typeOf(it),
      name: COFFIN_TYPES[typeOf(it)].jp,
      level: coffinLevel(g, it),
      cooldown: cooldownLeft(g, it),
    }));
  }

  Elona.Necro = {
    COFFIN_ID, KEY_ID, SICKLE_ID, MAX_ACTIVE, COOL_RETURN, COOL_DEATH, CG_HOST,
    COFFIN_TYPES, SPECIES_TO_TYPE, FORCE_MENU, FUSE_PAIRS,
    isCoffin, typeOf, coffinLevel, cooldownLeft, canUse, activeCount,
    summon, summonOnLoad, recall, necrosInSight, necroForce, accelNecro,
    hasSickle, fuse, fuseMenu, fuseStart, onNecroDeath, coffinName, list,
    nowHour, freeNpcSlot, nearSpot,
  };
})(window);
