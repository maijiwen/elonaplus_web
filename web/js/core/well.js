'use strict';
/**
 * 井水 / 马桶 / 圣井的「喝水」—— 对应 start.hsp *label_2954（314963-315260）。
 *
 * 【源码依据】喝水是许愿的三大来源之一（wiki「许愿」页），完整事件表如下
 *   （var_400 = rnd(100) 主骰；var_2432 = 100 表示背包里有「幸运女神的马克杯」1013）：
 *
 *   前置   314966  f[25] < -5 | f[27] >= 20 | (602 且 var_65(260) <= 0) → 干涸
 *   314981 var_2432：item_find 1013 且数量 ≥ 1 → 杯子护体（坏事件改为「清凉」）
 *   315020 602（圣井水）1/2 → 效果 1113
 *   315081 >70   30%：杯子 → 无事；否则 sub = rnd(5) → 效果 1112/1110/1111/1109/1108
 *                （1112 甜液=睡眠 2 / 1110 麻痹=麻痹 3 / 1111 墨汁=目盲 4 /
 *                  1109 头痛=混乱 5 / 1108 毒=中毒 1，全部 dmgcon 强度 100）
 *   315096 >55   16%：水里摸到金币 = rnd(技能159/2*50+100)+1
 *   315114 >45   11%：杯子 → 无事；技能 rnd(8)+10 → skillmod ±1000（3/5 加 2/5 减）
 *   315128 >40    6%：杯子 → 无事；等级 ≥ 5 → 「吞下了不好的东西」→ 寄生 *label_2336
 *   315148 >35    6%：「井里冒出了什么东西！」→ 1+rnd(3) 只随机怪
 *                     （characreate -1, 0，生成等级 calcobjlv(等级*3/2+3)）
 *   315167 >33    3%：效果 1113（圣水：祝福时全属性潜力 +100）
 *   315175 >20   14%：杯子 → 无事；效果 1152 = 无事（源码空分支）
 *   315190 许愿块（var_65(250+347) == 100；0-FR 已把 347 门整体移除 → 恒 100）：
 *          karma > 0 且 var_400 > 20 - karma/10，或 var_400 == 0：
 *            rnd(var_65(95)+1) 非 0 → 「好像交到了好运…」（此轮不愿望）
 *            否则 → 非 (地图76/179) 时 var_65(95)++ → 效果 441 = 许愿
 *   315213 兜底 「この水は清涼だ」（仅玩家）
 *   收尾   315241：饱腹 var_58(22) +500（NPC +4000）、水分 var_58(446) +2000；
 *          602 → var_65(260)--；其余 f[25] -= rnd(3)、f[27] += rnd(3)，
 *          f[27] ≥ 20 → 「完全干涸」、f[25] < -5 → 「干涸了」
 *
 * 【本项目差异】
 *   · 只实现玩家饮用（原版 NPC 也会被 AI 喂水，此处不做）。
 *   · 602 圣井的 1113 只实现祝福档（潜力 +100）；诅咒/普通档源码另有处理，
 *     圣井水在 2.33R 里只能由祝福的井打出，这里按祝福档处理。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));

  const WELL = 109;        // 井戸
  const HOLY = 602;        // 聖なる井戸（物品）
  const TOILET = 650;      // トイレ
  const CUP = 1013;        // 幸運の女神のマグカップ
  const WELL_IDS = [WELL, HOLY, TOILET];

  const R = (g, n) => ((g && g.rng) ? g.rng.rnd(n) : Math.floor(Math.random() * n));

  function isWellItem(id) { return WELL_IDS.indexOf(id | 0) !== -1; }

  /** 在玩家背包里找马克杯 1013（314981：item_find 1013, 3, 1 且数量 ≥ 1） */
  function hasCup(g) {
    const inv = (g.player && g.player.inv) || [];
    for (const it of inv) {
      if (it && (it.f[0] | 0) >= 1 && (it.f[3] | 0) === CUP) return true;
    }
    return false;
  }

  /** 效果 1113（321130）：祝福的水 → 全属性潜力 +100 */
  function blessPotential(g, p, out) {
    const ST = Elona.Stats;
    let n = 0;
    if (ST && ST.modGrowth) {
      for (let id = 10; id <= 17; id++) {
        ST.modGrowth(p, id, p.index | 0, 100, g);
        n++;
      }
    }
    out.messages.push('全身的潜在能力都提升了！');
    out.effects.potential = n;
  }

  /**
   * 喝一口井水。
   * @param {object} g
   * @param {object} item 井（109）/ 圣井（602）/ 马桶（650）的实例（地面或背包）
   * @returns {{ok:boolean, messages:string[], requestWish:boolean, dried:boolean}}
   */
  function drink(g, item) {
    const out = { ok: true, messages: [], items: [], effects: {}, requestWish: false, dried: false };
    const p = g.player;
    if (!p || !item) { out.ok = false; return out; }
    const f = item.f;
    const id = item.id | 0;

    // 314966：干涸判定
    if ((f[25] | 0) < -5 || (f[27] | 0) >= 20
      || (id === HOLY && (g.getV65 ? (g.getV65(260) | 0) : 0) <= 0)) {
      out.ok = false;
      out.messages.push(`${nameOf(g, item)}已经干涸了。`);
      return out;
    }

    const cup = hasCup(g);                       // var_2432 = 100
    let roll = R(g, 100);                        // var_400 = rnd(100)
    const dmgcon = (cond, msg) => {
      out.messages.push(msg);
      try {
        if (Elona.Resist && Elona.Resist.dmgcon && g.dmgconTable) {
          Elona.Resist.dmgcon(g, g.dmgconTable, p, cond, 100);
        }
      } catch (e) { /* 抗性完全免疫时不追加提示（与源码一致静默） */ }
    };

    // 315020：圣井水 1/2 → 效果 1113
    if (id === HOLY && R(g, 2) === 0) {
      if ((f[17] | 0) >= 1) blessPotential(g, p, out);
      else out.messages.push('这水十分清凉。');
      return tail(g, item, out, id);
    }

    // ---- 事件表（从高 roll 到低，命中即 break）----
    if (roll > 70) {                             // 30%
      if (!cup) {
        const sub = R(g, 5);                     // 315081：rnd(5) → 1112/1110/1111/1109/1108
        if (sub === 0) dmgcon(2, '甜得发腻的液体呛进了鼻子！');
        else if (sub === 1) dmgcon(3, '身体发麻了！');
        else if (sub === 2) dmgcon(4, '墨汁喷了你一脸！');
        else if (sub === 3) dmgcon(5, '一阵剧烈的头痛袭来！');
        else dmgcon(1, '你中了毒！');
        return tail(g, item, out, id);
      }
      out.messages.push('这水十分清凉。');
      return tail(g, item, out, id);
    }
    if (roll > 55) {                             // 16%：水里摸到金币（315096）
      const sk = (p.skill ? (p.skill(159) | 0) : 0);
      const n = R(g, idiv(sk, 2) * 50 + 100) + 1;
      if (Elona.ItemDB) {
        const gold = Elona.ItemDB.createItem(54, 1, g.rng);
        if (gold) {
          gold.f[0] = n; gold.f[5] = p.x; gold.f[6] = p.y;
          const cell = g.map && g.map.cell ? g.map.cell(p.x, p.y) : null;
          if (cell) cell[4] = 1;
          g.groundItems.push(gold);
        }
      }
      out.messages.push(`你在水里发现了 ${n} 枚金币！`);
      out.effects.gold = n;
      return tail(g, item, out, id);
    }
    if (roll > 45) {                             // 11%：技能 ±（315114）
      if (cup) { out.messages.push('这水十分清凉。'); return tail(g, item, out, id); }
      const sk = R(g, 8) + 10;                   // 属性 10..17
      const up = R(g, 5) > 2;                    // 3/5 加、2/5 减
      if (Elona.Stats && Elona.Stats.skillMod) {
        Elona.Stats.skillMod(p, sk, p.index | 0, up ? 1000 : -1000, g);
      }
      out.messages.push(up ? '感觉身体的机能更顺畅了。' : '感觉身体的机能变得迟钝了……');
      out.effects.skillmod = { id: sk, up };
      return tail(g, item, out, id);
    }
    if (roll > 40) {                             // 6%：寄生（315128）
      if (cup) { out.messages.push('这水十分清凉。'); return tail(g, item, out, id); }
      if ((p.level | 0) < 5) return tail(g, item, out, id);
      out.messages.push('你吞下了什么不好的东西……');
      if (Elona.Parasite && Elona.Parasite.body) {
        const pr = Elona.Parasite.body(g, p);
        if (pr && pr.message) out.messages.push(pr.message);
      }
      out.effects.parasite = true;
      return tail(g, item, out, id);
    }
    if (roll > 35) {                             // 6%：井里冒出怪物（315148）
      out.messages.push('井里冒出了什么东西！');
      const fac = Elona.CharaFactory;
      const n = 1 + R(g, 3);
      let made = 0;
      if (fac && fac.create) {
        for (let i = 0; i < n; i++) {
          const lv = Elona.ItemDB && Elona.ItemDB.calcObjLv
            ? Math.max(1, Elona.ItemDB.calcObjLv(idiv((p.level | 0) * 3, 2) + 3, g))
            : Math.max(1, p.level | 0);
          try {
            const m = fac.create(g, 0, lv, p.x, p.y, {});
            if (m) made++;
          } catch (e) { /* 槽位不足等，跳过 */ }
        }
      }
      if (made) out.effects.monsters = made;
      return tail(g, item, out, id);
    }
    if (roll > 33) {                             // 3%：效果 1113（315167）
      if ((f[17] | 0) >= 1) blessPotential(g, p, out);
      else out.messages.push('这水十分清凉。');
      return tail(g, item, out, id);
    }
    if (roll > 20) {                             // 14%：效果 1152 = 无事（315175）
      if (cup) { out.messages.push('这水十分清凉。'); return tail(g, item, out, id); }
      return tail(g, item, out, id);
    }

    // ---- 315190：许愿块（var_65(250+347) == 100；0-FR 已移除 347 门 → 恒 100）----
    const gate = (g.getV65 ? (g.getV65(597) | 0) : 0);
    if (gate === 100 || gate === 0) {            // 0-FR：347 门已移除，两种读法都放行
      const karma = p.get(49) | 0;
      let hit = false;
      if (karma > 0 && roll > 20 - idiv(karma, 10)) hit = true;
      if (roll === 0) hit = true;
      if (hit) {
        if (R(g, (g.getV65 ? (g.getV65(95) | 0) : 0) + 1)) {
          out.messages.push('好像有不得了的好运降临了……但似乎是错觉。');
          return tail(g, item, out, id);
        }
        // 非 (地图 76 / 179) 时计数（315206）
        const mid = (g.getV65 ? (g.getV65(20) | 0) : 0);
        const dgr = (g.getV65 ? (g.getV65(22) | 0) : 0);
        if (!(mid === 76 && dgr === 179)) {
          g.setV65(95, (g.getV65(95) | 0) + 1);
        }
        out.messages.push('咕嘟……喝下水的瞬间，脑海中浮现了一个愿望。');
        out.requestWish = true;                  // → 效果 441
        return tail(g, item, out, id);
      }
    }

    out.messages.push('这水十分清凉。');          // 315213 兜底
    return tail(g, item, out, id);
  }

  /** 315241 收尾：水分 / 干涸记账 */
  function tail(g, item, out, id) {
    const f = item.f;
    const p = g.player;
    if (p) {
      p.set(22, (p.get(22) | 0) + 500);          // 饱腹（玩家 +500；NPC +4000 不做）
      p.set(446, (p.get(446) | 0) + 2000);       // 水分
    }
    if (id === 602) {
      if (g.setV65) g.setV65(260, (g.getV65(260) | 0) - 1);
    } else {
      f[25] = (f[25] | 0) - R(g, 3);
      f[27] = (f[27] | 0) + R(g, 3);
      if ((f[27] | 0) >= 20) {
        out.messages.push(`${nameOf(g, item)}完全干涸了。`);
        f[0] = 0;                                // 设备消失（源码 return 后由 item_delete 处理）
        out.dried = true;
      } else if ((f[25] | 0) < -5) {
        out.messages.push(`${nameOf(g, item)}干涸了。`);
        out.dried = true;
      }
    }
    return out;
  }

  function nameOf(g, item) {
    if (!item) return '井';
    const d = Elona.ItemDB && Elona.ItemDB.data;
    const row = d && d[String(item.id | 0)];
    return row ? (row.nameCh || row.nameJp || row.nameEn || '井') : '井';
  }

  /** 地图上某格是否有一口可以喝的井（脚下 / 面前格共用） */
  function wellAt(g, x, y) {
    if (!g || !g.groundItems) return null;
    for (const it of g.groundItems) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if ((it.f[5] | 0) === (x | 0) && (it.f[6] | 0) === (y | 0) && isWellItem(it.id | 0)) {
        return it;
      }
    }
    return null;
  }

  Elona.Well = { WELL, HOLY, TOILET, CUP, WELL_IDS, isWellItem, hasCup, drink, wellAt };
})(typeof window !== 'undefined' ? window : globalThis);
