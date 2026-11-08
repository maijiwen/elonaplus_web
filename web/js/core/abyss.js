'use strict';
/**
 * 深淵魔術（深渊魔法）—— 《深淵魔術書》(1249) + 深淵魔力资源。
 *
 * 【源码定位】
 *   菜单文本   txtsetabyss 10（11657-11751）—— 9 个法术 + 「急いで本を閉じる」
 *   执行分支   var_99(3, var_579) == 1249（314033-314481）
 *   深淵魔力   var_65(250 + 429) = 槽位 679，上限 100000
 *   解読获得   物品 687（313843-313863）：`+= (var_99(25)+1) * 100`
 *   SAN 消耗   dmgsan 0, N —— 狂気值 var_58(86)
 *
 * 【9 个法术（id / 名称 / SAN / 深淵魔力消耗 / 解锁门槛）】
 *   1 深淵へと続く糸     SAN10  /  0  /    —   地面物品全部沉入深渊（每件 +1 魔力）
 *   2 見えざる幽回刀     SAN50  / 50  /  500   范围魔法斩击 + 首狩り
 *   3 放逐すべき暗黒     SAN200 / 200 / 1000   抹杀所有召唤物
 *   4 光明見えぬ洞門     SAN500 / 500 / 2000   即时脱出到世界地图
 *   5 這い寄る魔神兵     SAN150 / 150 / 3000   召唤 1057/1058/1059 魔神兵
 *   6 素晴らしき深海     SAN300 / 300 / 4000   范围沉默窒息
 *   7 呻き立つ死者共     SAN450 / 450 / 5000   全体苏生
 *   8 慈悲無き大洪水     SAN600 / 600 / 6000   全域水属性无差别攻击
 *   9 狂気満ちる劇場     SAN400 / 400 / 6666   狂气状态 var_58(85)=5
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const POWER_SLOT = 679;      // var_65(250 + 429)
  const POWER_MAX = 100000;
  const BOOK_ID = 1249;
  const DECODE_ID = 687;

  /** txtsetabyss 10 的 9 项 + 关闭（11664-11749） */
  const MENU = [
    { id: 0, jp: '急いで本を閉じる', en: 'Hurry to close the book', san: 0, cost: 0, need: 0 },
    { id: 1, jp: '深淵へと続く糸', en: 'Abyss Leading', san: 10, cost: 0, need: 0 },
    { id: 2, jp: '見えざる幽回刀', en: 'Phantom Swords', san: 50, cost: 50, need: 500 },
    { id: 3, jp: '放逐すべき暗黒', en: 'Dark Expulsion', san: 200, cost: 200, need: 1000 },
    { id: 4, jp: '光明見えぬ洞門', en: 'Lightless Gate', san: 500, cost: 500, need: 2000 },
    { id: 5, jp: '這い寄る魔神兵', en: 'Evil Guardians', san: 150, cost: 150, need: 3000 },
    { id: 6, jp: '素晴らしき深海', en: 'Beckoning Seabed', san: 300, cost: 300, need: 4000 },
    { id: 7, jp: '呻き立つ死者共', en: 'Suffering Deads', san: 450, cost: 450, need: 5000 },
    { id: 8, jp: '慈悲無き大洪水', en: 'Merciless Flood', san: 600, cost: 600, need: 6000 },
    { id: 9, jp: '狂気満ちる劇場', en: 'Crazy Theater', san: 400, cost: 400, need: 6666 },
  ];

  // ---------------------------------------------------------------- 魔力
  function power(g) { return (g && g.getV65) ? (g.getV65(POWER_SLOT) | 0) : 0; }

  function addPower(g, n) {
    if (!g || !g.setV65) return 0;
    let v = power(g) + (n | 0);
    if (v > POWER_MAX) v = POWER_MAX;
    if (v < 0) v = 0;
    g.setV65(POWER_SLOT, v);
    return v;
  }

  function spendPower(g, n) {
    if (power(g) < (n | 0)) return false;
    g.setV65(POWER_SLOT, power(g) - (n | 0));
    return true;
  }

  function skillOf(g, id) {
    const p = g && g.player;
    if (!p) return 0;
    if (Elona.Stats && Elona.Stats.sorg) return (Elona.Stats.sorg(p, id) | 0);
    return typeof p.skill === 'function' ? (p.skill(id) | 0) : 0;
  }

  function cbitOf(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, bit) : 0;
  }

  // ---------------------------------------------------------------- 菜单
  /** 当前可用菜单（未达门槛的项显示为不可用） */
  function menu(g) {
    const p = power(g);
    return MENU.map((m) => Object.assign({}, m, {
      unlocked: p >= m.need,
      label: p >= m.need
        ? `${m.jp}　SAN${m.san}/深淵魔力${m.cost}`
        : `<深淵魔力${m.need}以上で解放>`,
    }));
  }

  // ---------------------------------------------------------------- 效果
  /** 314109：不可視の刃的伤害公式 */
  function phantomDamage(g) {
    const p = g.player;
    const lv = p.get(38) | 0;
    const mag = skillOf(g, 150);      // 魔力
    const mc = skillOf(g, 174);       // 魔术控制
    const R = (n) => (g.rng ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    return ((idiv(mc + 1, 5) + 5) * (idiv(mag + 1, 5) + 5)
      + R(mag * 2 + 5)
      + (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4
        * Math.sqrt(limit(lv, 1, 2000) * 3)
      + 30);
  }

  /** 314391：大洪水的伤害公式（比幽回刀多 ×3/2） */
  function floodDamage(g) {
    const p = g.player;
    const lv = p.get(38) | 0;
    const mag = skillOf(g, 150);
    const mc = skillOf(g, 174);
    const R = (n) => (g.rng ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    return idiv(((idiv(mc + 1, 5) + 5) * (idiv(mag + 1, 5) + 5)
      + R(mc * 2 + 5)
      + (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4
        * Math.sqrt(limit(lv, 1, 2000) * 3)
      + 30 + 1) * 3, 2);
  }

  /** 314082-314118 的目标筛选（敌对 + 距离 + 视线） */
  function hostileInSight(g, radius) {
    const p = g.player;
    const out = [];
    const list = g.charas || [];
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      // 314089-314098：判定基准是**施法者**（var_243 = 玩家 0）
      //   施法者是玩家 → 只打 var_58(9) == -3 的敌对
      //   施法者是 NPC → 排除同阵营（69 相同 / 9 相同 / 双方都 >= -1）
      if ((p.index | 0) < 16) {
        if ((c.get(9) | 0) !== -3) continue;
      } else {
        const same = (c.get(69) | 0) === (p.get(69) | 0)
          || (c.get(9) | 0) === (p.get(9) | 0)
          || ((c.get(9) | 0) >= -1 && (p.get(9) | 0) >= -1);
        if (same) continue;
      }
      const d = Math.max(Math.abs((c.x | 0) - (p.x | 0)), Math.abs((c.y | 0) - (p.y | 0)));
      if (d > (radius || 6)) continue;
      if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, p.x, p.y, c.x, c.y)) continue;
      out.push(c);
    }
    return out;
  }

  /** 选项 1：地面物品全部沉入深渊（314460-314473） */
  function abyssLeading(g) {
    let n = 0;
    const items = (g.groundItems || []).slice();
    for (const it of items) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if ((it.id | 0) === BOOK_ID) continue;
      const own = it.f[21] | 0;
      if (own === 1 || own === 5) continue;
      it.f[0] = 0;
      addPower(g, 1);
      n++;
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
    }
    g.groundItems = (g.groundItems || []).filter((x) => x && (x.f[0] | 0) > 0);
    return { ok: true, consumed: n,
      message: `落ちているアイテムの全てが深淵に呑み込まれた。（地面的 ${n} 件物品沉入深渊）` };
  }

  /** 选项 2：不可視の幽回刀（314066-314119） */
  function phantomSwords(g) {
    const p = g.player;
    const targets = hostileInSight(g, 6);
    const dmg = phantomDamage(g);
    let hit = 0;
    for (const t of targets) {
      if (Elona.Battle && Elona.Battle.applyDamage) {
        Elona.Battle.applyDamage(t, dmg, g, p, 60, 1000);      // 属性 60 = 魔法
      } else {
        t.hp = Math.max(0, (t.hp | 0) - dmg);
      }
      hit++;
      // 314110：dmgcon 9（斩首）
      if (Elona.Spell && Elona.Spell.dmgconOf) {
        Elona.Spell.dmgconOf(g, p, 9, skillOf(g, 174));
      }
    }
    return { ok: true, hit, damage: dmg,
      message: `${p.name}は不可視の刃を放った。（${hit} 个目标被斩击）` };
  }

  /** 选项 3：放逐すべき暗黒（314120-314167）—— 抹杀所有召唤物 */
  function darkExpulsion(g) {
    const list = g.charas || [];
    let killed = 0;
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(58) | 0) === 100) continue;
      if (!cbitOf(c, 964)) continue;            // 召唤物标记
      if (Elona.Battle && Elona.Battle.applyDamage) {
        Elona.Battle.applyDamage(c, c.get(51) | 0, g, null, 0, 0);
      }
      c.hp = 0;
      c.set(0, 0);
      killed++;
    }
    if (g.syncCharaCells) g.syncCharaCells();
    return { ok: true, killed,
      message: `周囲を深い闇が包んでいく…。（${killed} 个召唤物被放逐）` };
  }

  /** 选项 4：光明見えぬ洞門（314168-314202）—— 即时脱出 */
  function lightlessGate(g) {
    const mapId = (g.getV65 ? (g.getV65(20) | 0) : 0);
    const sub = (g.getV65 ? (g.getV65(22) | 0) : 0);
    if ((mapId === 49 && sub === 129) || (mapId === 76 && sub === 179)) {
      return { ok: false, reason: 'no-escape', message: 'この階層では脱出が出来ないようだ。' };
    }
    if ((g.getV65 ? (g.getV65(850) | 0) : 0) === 47) {
      return { ok: false, reason: 'no-escape', message: 'ここでは脱出ができない。' };
    }
    g.setV65(447, 0);                        // var_65(250 + 447) = 0
    if (g.enterWorldMap) g.enterWorldMap();
    return { ok: true,
      message: 'あなたは意を決し、おぞましい暗闇の中へ踏み込んだ…。（即时脱出）' };
  }

  /** 选项 5：這い寄る魔神兵（314203-314252） */
  function evilGuardians(g) {
    const p = g.player;
    let lv = skillOf(g, 150) + idiv(skillOf(g, 174) + 10, 2);
    const cap = idiv((g.getV65 ? (g.getV65(189) | 0) : 0) * 3, 2);
    if (lv > cap) lv = cap;
    const list = g.charas || [];
    const made = [];
    for (const species of [1059, 1058, 1057]) {
      if (list.some((c) => c && (c.get(27) | 0) === species)) continue;
      let slot = -1;
      for (let i = 16; i < 245; i++) {
        const c = list[i];
        if (!c || (c.get(0) | 0) !== 1) { slot = i; break; }
      }
      if (slot < 0) break;
      if (!Elona.CharaFactory || !Elona.CharaFactory.create) break;
      let c = null;
      try {
        c = Elona.CharaFactory.create(g, species, Math.max(1, lv), p.x, p.y,
          { index: slot, var1023: Math.max(1, lv), var641: 2 });
      } catch (e) { c = null; }
      if (!c) break;
      g.charas[slot] = c;
      c.index = slot;
      c.set(0, 1); c.set(9, 10); c.set(69, 10);
      if (Elona.Status && Elona.Status.cbitmod) {
        Elona.Status.cbitmod(c, 992, 1);
        Elona.Status.cbitmod(c, 1035, 1);
      }
      c.name = `${c.name} Lv${c.get(38) | 0}`;
      made.push(c);
    }
    if (g.syncCharaCells) g.syncCharaCells();
    return { ok: true, summoned: made.length, level: lv,
      message: `魔神兵 ${made.length} 体が降臨した。（${made.length} 名魔神兵降临）` };
  }

  /** 选项 6：素晴らしき深海（314253-314294）—— 范围沉默窒息 */
  function beckoningSeabed(g) {
    const p = g.player;
    const targets = hostileInSight(g, 6);
    const power = skillOf(g, 150) * 200;
    for (const t of targets) {
      if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, t, 2, power, 200);
      if ((t.get(263) | 0) < 15) t.set(263, 15);
    }
    return { ok: true, hit: targets.length,
      message: `深淵の海が-visibly吞下了周围。。（${targets.length} 个目标被沉默）` };
  }

  /** 选项 7：呻き立つ死者共（314295-314337）—— 全体苏生 */
  function sufferingDeads(g) {
    const list = g.charas || [];
    let revived = 0;
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (!c) continue;
      const state = c.get(0) | 0;
      if (state !== 6 && state !== 2) continue;      // 尸体 / 幽灵
      if (cbitOf(c, 971)) continue;
      if ((c.get(166) | 0) <= 0) continue;
      c.set(0, 1);
      c.hp = c.get(51) | 0;
      c.set(166, (c.get(166) | 0) - 1);
      revived++;
    }
    if (g.syncCharaCells) g.syncCharaCells();
    return { ok: true, revived,
      message: `呻き立つ死者共が蘇った。（${revived} 个对象被复活）` };
  }

  /** 选项 8：慈悲無き大洪水（314338-314420）—— 全域水属性伤害 */
  function mercilessFlood(g) {
    const p = g.player;
    const dmg = floodDamage(g);
    const list = g.charas || [];
    let hit = 0;
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (i === 0) continue;
      const rel = c.get(9) | 0;
      if (rel === 10) continue;                   // 同伴不受伤
      if (Elona.Battle && Elona.Battle.applyDamage) {
        Elona.Battle.applyDamage(c, dmg, g, p, 64, 1000);
      } else {
        c.hp = Math.max(0, (c.hp | 0) - dmg);
      }
      hit++;
    }
    return { ok: true, hit, damage: dmg,
      message: `慈悲無き大洪水が全てを飲んだ。（${hit} 个目标被水属性打击）` };
  }

  /** 选项 9：狂気満ちる劇場（314421-314435） */
  function crazyTheater(g) {
    const p = g.player;
    if ((p.get(85) | 0) >= 0) p.set(85, 5);
    return { ok: true,
      message: '狂気が劇場を満たした…。（狂气状态提升）' };
  }

  // ---------------------------------------------------------------- 发动
  /**
   * 发动一个深淵法术。
   * @param {number} choice 1..9
   */
  function cast(g, choice) {
    const p = g.player;
    const c = choice | 0;
    const item = MENU.find((m) => m.id === c);
    if (!item || c === 0) return { ok: false, reason: 'cancel' };
    if (power(g) < item.need) {
      return { ok: false, reason: 'need-power',
        message: `<深淵魔力${item.need}以上で解放>` };
    }
    // SAN 消耗（dmgsan）
    if (item.san > 0 && Elona.Status && Elona.Status.dmgsan) {
      Elona.Status.dmgsan(p, item.san, g);
    }
    if (!spendPower(g, item.cost)) {
      return { ok: false, reason: 'no-power', message: '深淵魔力が足りない。' };
    }
    let r = null;
    switch (c) {
      case 1: r = abyssLeading(g); break;
      case 2: r = phantomSwords(g); break;
      case 3: r = darkExpulsion(g); break;
      case 4: r = lightlessGate(g); break;
      case 5: r = evilGuardians(g); break;
      case 6: r = beckoningSeabed(g); break;
      case 7: r = sufferingDeads(g); break;
      case 8: r = mercilessFlood(g); break;
      case 9: r = crazyTheater(g); break;
      default: r = null;
    }
    if (r) r.power = power(g);
    return r || { ok: false, reason: 'unknown' };
  }

  /** 687 解読：把物品转成深淵魔力（313843-313863） */
  function decode(g, item) {
    if (!item || (item.id | 0) !== DECODE_ID) return { ok: false };
    const gain = ((item.f[25] | 0) + 1) * 100;
    const v = addPower(g, gain);
    item.f[26] = 1;
    item.f[9] = 1;
    if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(4, item, 0);
    return { ok: true, gain, power: v,
      message: `深淵魔力を${gain} 獲得した。[深淵魔力: ${v}]` };
  }

  Elona.Abyss = {
    POWER_SLOT, POWER_MAX, BOOK_ID, DECODE_ID, MENU,
    power, addPower, spendPower, menu, cast, decode,
    phantomDamage, floodDamage, hostileInSight,
  };
})(window);
