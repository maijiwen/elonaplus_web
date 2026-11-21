'use strict';
/**
 * 活武器（生きている武器 / living weapon）—— start.hsp 逐段移植
 *
 * 【存储口径】var_99(字段, 物品实例) → web 的 Item.f[字段]
 *   ibit(10, it)  活武器标志（28193 ibitmod 10）
 *   f[25]         活武器等级 Lv（0..15；28194 = 1 起步）
 *   f[26]         已吸血经验 Exp（calcexpalive(lv) = lv*100，211716）
 *   f[11]         武器骰面（附魔轮换 X 的一项）
 *   f[20]         强化值 Bonus（+4 选项）
 *   f[23]         随机数种子（升级时 randomize）
 *   f[40+n*2..]   附魔槽（encadd 写入）
 *
 * 【源码依据】
 *   211716-211717  calcexpalive(lv) = lv*100
 *   28184-28194    生成：fix 4/5（神器/奇迹）且材质=10000/24000 时 1/20 概率变活武器，Lv=1
 *   299808-299827  「調査」显示 "It is alive. [Lv:x Exp:y%]"
 *   347505-347530  击杀加经验：rnd(死者等级/(Lv+削减系数)+1)；削减系数 50（分裂/召唤/死灵/守卫等）
 *   357248-357266  强化星维（item 1252）：f[26] += 75
 *   348992-349960  按 T 使用升级：Lv>=15 满级；Exp 不足拒绝；9 类附魔选项 + Bonus+4；
 *                  X = 骰面(f11)+强化(f20)+月份(var_65(11))，按各类表长取模；
 *                  Lv>=10 时附加「吸取使用者鲜血」encadd(45,50)，失败清最后一条；
 *                  升级后 f[26]=0、f[25]++。
 *
 * 本模块只提供纯逻辑与状态读写；升级的 UI 选项由调用方（useItem）消费 upgradeOptions()。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const V = (g, n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);
  const idiv = (a, b) => Math.trunc((a | 0) / (b | 0));
  const limit = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
  const rnd = (g, n) => ((g && g.rng && g.rng.rnd) ? (g.rng.rnd(n) | 0) : 0);

  const BIT = 10;
  const MAX_LEVEL = 15;

  /** calcexpalive（211716）：升下一级所需经验 = 当前等级 × 100 */
  function expNeeded(level) { return (level | 0) * 100; }

  function isAlive(it) {
    return !!(it && it.f && Elona.ItemDB && Elona.ItemDB.ibit && Elona.ItemDB.ibit(BIT, it) === 1);
  }

  function setAlive(it, on) {
    if (!it || !it.f || !Elona.ItemDB || !Elona.ItemDB.ibitmod) return false;
    Elona.ItemDB.ibitmod(BIT, it, on ? 1 : 0);
    return true;
  }

  function level(it) { return isAlive(it) ? (it.f[25] | 0) : 0; }
  function exp(it) { return isAlive(it) ? (it.f[26] | 0) : 0; }

  /** 检查窗文案（299810）：「它是活的 [Lv:x Exp:y%]」 */
  function inspectText(it, lang) {
    if (!isAlive(it)) return '';
    const lv = level(it);
    const need = expNeeded(lv);
    const pct = need > 0 ? limit(idiv((exp(it) | 0) * 100, need), 0, 100) : 0;
    return (lang === 'en')
      ? `It is alive. [Lv:${lv} Exp:${pct}%]`
      : `它是活的。[等级:${lv} 经验:${pct}%]`;
  }

  /**
   * 生成时转正（28184-28194）：fix 4/5 的神器/奇迹、物品类别 var_657=10000/24000、
   * 1/20 概率 → ibit 10、Lv=1，并加**一条**随机附魔后立即 return。
   * var_657 对应 web 的 it.field657；返回 true 时调用方须跳过后续所有随机附魔。
   * @returns {boolean} 是否转正成功
   */
  function tryMakeAlive(g, it, fix) {
    if (!it || !it.f) return false;
    const f = (fix | 0);
    if (f !== 4 && f !== 5) return false;
    const cat = it.field657 | 0;                 // 源码 var_657
    if (cat !== 10000 && cat !== 24000) return false;
    if (isAlive(it)) return false;
    if (rnd(g, 20) !== 0) return false;
    setAlive(it, true);
    it.f[25] = 1;
    it.f[26] = 0;
    // 28193/28196：转正时只加一条随机附魔，强度按 fix 5/4 分别为 (p+1)/2+200 / (p+1)/3+150
    if (Elona.ItemDB && Elona.ItemDB.randomenc) {
      const rid = Elona.ItemDB.randomenc(99, g, cat);
      const p = Elona.ItemDB.randomencp ? Elona.ItemDB.randomencp(0, g) : 0;
      const power = f === 5 ? (idiv(p + 1, 2) + 200) : (idiv(p + 1, 3) + 150);
      Elona.ItemDB.encadd(it, rid, power, g);
    }
    return true;
  }

  /**
   * 击杀加经验（347505-347530）：装备在身上的活武器按死者等级吸血。
   * @param {object} g
   * @param {object} target 死者（get(38)=等级）
   * @param {number} reduce 削减系数（50 = 分裂/召唤/死灵/守卫/护送单位）
   * @returns {number[]} 本次涨经验的武器所在背包槽号
   */
  function onKill(g, target, reduce) {
    if (!g || !target || !g.player || !g.player.inv) return [];
    const tLv = target.get ? (target.get(38) | 0) : 0;
    if (tLv <= 0) return [];
    const red = reduce | 0;
    const grew = [];
    const inv = g.player.inv;
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (!isAlive(it)) continue;
      const lv = level(it);
      if (lv >= MAX_LEVEL) continue;
      if (exp(it) >= expNeeded(lv)) continue;
      const denom = Math.max(1, lv + red);
      const gain = rnd(g, idiv(tLv, denom) + 1);
      it.f[26] = (it.f[26] | 0) + gain;
      if (exp(it) >= expNeeded(lv)) grew.push(i);
    }
    return grew;
  }

  /** 强化星维喂养（357248-357266）：f[26] += 75，返回是否可升级 */
  function feedStarfiber(g, it) {
    if (!isAlive(it)) return { ok: false, reason: 'not-alive' };
    const lv = level(it);
    if (lv >= MAX_LEVEL) return { ok: false, reason: 'max-level' };
    it.f[26] = (it.f[26] | 0) + 75;
    return { ok: true, canLevel: exp(it) >= expNeeded(lv), exp: exp(it) };
  }

  // ---------------- 附魔轮换表（源码 349010-349950，wiki 同表） ----------------
  // 每个类别按 X % 表长取余数。id 是 encadd 的附魔号，power 是强度。
  const RESIST = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60];        // 火/冷/雷/暗/幻/毒/地狱/音/神经/混沌/魔法(100)
  const ELEMDMG = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60];       // 属性追伤，强度 200（魔法 200）
  const STAT = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];              // 主属性 +500
  const SKILL1 = [186, 172, 166, 167, 152, 189, 154, 155, 174, 188];  // 心眼/咏唱/二刀/双手/战术/射击/治愈/冥想/魔道具/魔力控制
  const SKILL2 = [153, 57, 163, 176, 177, 179, 180, 184, 158];        // 盾/回避/拆陷阱/重装备/中装备/轻装备/隐蔽/看穿/魔力极限
  const SKILL3 = [161, 300, 190, 163, 153, 180, 179, 185, 184, 161, 185, 178]; // 采掘/工作/裁缝/宝石/栽培/料理/解剖/钓鱼/炼金/开锁/探知/自然鉴定
  const SKILL4 = [153, 176, 177, 179, 180, 184, 161, 185, 178, 158, 159, 162]; // 举重/偷窃/游泳/读书/生化/暗记/信仰/交涉/投资/演奏/骑马/旅行
  const SPECIAL = [61, 58, 57, 76, 84, 44, 34, 68, 39];               // 对神/不死/龙/空/金属/暴击/魔威力/吐息/贯通

  const CAT = {
    BONUS: -1, RESIST: -2, ELEMDMG: -3, STAT: -4, SKILL1: -5,
    SKILL4: -6, SPECIAL: -7, SKILL3: -8, SKILL2: -9,
  };

  /** X = 骰面 + 强化值 + 月份（源码 349012 var_2556） */
  function factorX(g, it) {
    return (it.f[11] | 0) + (it.f[20] | 0) + V(g, 11);
  }

  const TABLES = [
    { cat: CAT.RESIST, tbl: RESIST, power: 200, label: '抗性' },
    { cat: CAT.ELEMDMG, tbl: ELEMDMG, power: 200, label: '属性追伤' },
    { cat: CAT.STAT, tbl: STAT, power: 500, label: '属性' },
    { cat: CAT.SKILL1, tbl: SKILL1, power: 450, label: '技能①' },
    { cat: CAT.SKILL2, tbl: SKILL2, power: 450, label: '技能②' },
    { cat: CAT.SKILL3, tbl: SKILL3, power: 450, label: '技能③' },
    { cat: CAT.SKILL4, tbl: SKILL4, power: 450, label: '技能④' },
    { cat: CAT.SPECIAL, tbl: SPECIAL, power: 130, label: '特殊附魔' },
  ];

  /**
   * 升级选项（源码 349010-349620）：固定 Bonus+4 + 8 类附魔，共 9 项。
   * 每项 { value, label, encId, power }；value 是选项返回值（对应源码 var_484 的负数）。
   */
  function upgradeOptions(g, it) {
    if (!isAlive(it)) return [];
    const X = factorX(g, it);
    const out = [{ value: CAT.BONUS, label: '强化等级 +4', encId: 0, power: 0 }];
    for (const t of TABLES) {
      const n = X % t.tbl.length;
      let encId = t.tbl[n];
      let power = t.power;
      // 抗性表最后一项（魔法抗性）强度 100（源码 encadd ... +60,100）
      if (t.cat === CAT.RESIST && n === 10) power = 100;
      // 特殊附魔按源码各自强度：80/130/130/80/130/130/80/130/80
      if (t.cat === CAT.SPECIAL) power = [80, 130, 130, 80, 130, 130, 80, 130, 80][n];
      out.push({ value: t.cat, label: t.label + '（' + encId + '）', encId, power });
    }
    return out;
  }

  /** 附魔类别 → encadd 的 id 前缀（源码 349640-349850） */
  function encIdFor(cat, selected, X) {
    if (cat === CAT.BONUS) return null;
    const row = TABLES.find((t) => t.cat === cat);
    if (!row) return null;
    const n = X % row.tbl.length;
    const base = row.tbl[n];
    if (cat === CAT.RESIST) return 2 * 10000 + 50 + n;    // encadd 20050..20060
    if (cat === CAT.ELEMDMG) return 7 * 10000 + 50 + n;   // encadd 70050..70060
    if (cat === CAT.STAT) return 1 * 10000 + 10 + n;      // encadd 10010..10019
    if (cat === CAT.SKILL1) return 3 * 10000 + selected.encId; // encadd 3xxxx + 技能id
    if (cat === CAT.SKILL2) return 3 * 10000 + selected.encId;
    if (cat === CAT.SKILL3) return 3 * 10000 + selected.encId;
    if (cat === CAT.SKILL4) return 3 * 10000 + selected.encId;
    if (cat === CAT.SPECIAL) return base;                  // 61/58/57/... 裸 id
    return null;
  }

  /**
   * 执行一次升级（源码 349620-349960）。
   * @param {object} g
   * @param {object} it 活武器实例
   * @param {number} optionValue upgradeOptions() 里的 value
   * @returns {{ok:boolean, reason?:string, level?:number, messages:string[]}}
   */
  function levelUp(g, it, optionValue) {
    if (!isAlive(it)) return { ok: false, reason: 'not-alive', messages: [] };
    const lv = level(it);
    if (lv >= MAX_LEVEL) return { ok: false, reason: 'max-level', messages: ['这把武器已经成长到极限了。'] };
    if (exp(it) < expNeeded(lv)) return { ok: false, reason: 'need-exp', messages: ['它吸的血还不够。'] };
    const msgs = [];
    const X = factorX(g, it);
    const v = optionValue | 0;
    if (v === CAT.BONUS) {
      it.f[20] = (it.f[20] | 0) + 4;
    } else {
      const opt = upgradeOptions(g, it).find((o) => o.value === v);
      if (opt) {
        const encId = encIdFor(v, opt, X);
        if (encId && Elona.ItemDB && Elona.ItemDB.encadd) {
          Elona.ItemDB.encadd(it, encId, opt.power, g, { noFilter: true });
        }
      }
    }
    msgs.push(g && g.lang === 'en' ? 'It vibrates as if she is pleased.' : '它高兴地颤动着。');

    // Lv>=10：附加「吸取使用者鲜血」encadd(45,50)，失败则清最后一条附魔再试（349920-349950）
    if ((it.f[25] | 0) >= 10) {
      if (g && g.log) g.log(g.lang === 'en' ? 'Its power is becoming a threat.' : '它的力量逐渐变成了威胁。');
      const addBlood = () => (Elona.ItemDB && Elona.ItemDB.encadd)
        ? Elona.ItemDB.encadd(it, 45, 50, g, { noFilter: true }) : 0;
      if (!addBlood()) {
        clearLastEnchant(it);   // var_99(40+(15-1)*2)=0
        addBlood();
        if (!addBlood()) clearLastEnchant(it);   // var_99(40+(15-2)*2)=0
      }
    }

    it.f[26] = 0;
    it.f[25] = (it.f[25] | 0) + 1;
    return { ok: true, level: it.f[25] | 0, messages: msgs };
  }

  // ---------------- 材质锤改造（371886-372070，NPC 208 盖洛克工坊） ----------------
  // 源码按 (hour + 5) \ 5 的值分 5 组可选材质；wiki 说是「日期/5」，实测以源码的**小时**为准。
  // 每组内是 var_484 选项值 = 材质索引，活武器（神器）只能用素材槌，普通材质卷轴无效。
  const MATERIAL_KIT_GROUPS = {
    0: [16, 44, 28, 22, 12, 19, 30, 31],       // 纸/竹/鹫鳞/珍珠/青铜/铁链/铬/精金
    1: [1, 17, 4, 5, 7, 25, 24],                // 革/宵晒/鳞/玻璃/秘银/银/龙鳞
    2: [2, 27, 35, 11, 10, 26, 13],             // 丝绸/扎伊隆/生鲜/水晶/铁/白银/钻石
    3: [3, 43, 18, 23, 9, 32, 34, 8],           // 布/木/骨/翡翠/钢/黄金/铅/以太
    4: [14, 33, 21, 20, 29, 15, 45],            // 灵布/珊瑚/云母/黑曜石/钛/红宝石/纳米机械
  };

  /** 当前小时对应的材质锤可选材质组（源码 (var_65(12)+5)\5） */
  function materialKitGroup(g) {
    const hour = V(g, 12);
    return idiv(hour + 5, 5) % 5;
  }

  /** 材质锤可选材质索引列表 + 名称 */
  function materialKitOptions(g) {
    const grp = materialKitGroup(g);
    const ids = MATERIAL_KIT_GROUPS[grp] || [];
    const NM = Elona.ItemMaterial;
    return ids.map((id) => ({ id, name: NM && NM.nameOf ? NM.nameOf(id, 'ch') : ('材质 ' + id) }));
  }

  /**
   * 应用材质锤改造（消耗素材槌 630 + *素材変化*卷轴 502 + 青铜币 1041）。
   * 活武器/神器的材质只能用素材槌改，此接口即为那条路径。
   * @returns {{ok:boolean, reason?:string, material?:number}}
   */
  function applyMaterialKit(g, it, materialId) {
    if (!isAlive(it)) return { ok: false, reason: 'not-alive' };
    const allowed = materialKitOptions(g).map((o) => o.id);
    if (allowed.indexOf(materialId | 0) < 0) return { ok: false, reason: 'not-available-this-hour' };
    it.f[24] = materialId | 0;                   // var_99(24)：物品材质
    return { ok: true, material: materialId | 0 };
  }

  /** 清除最后一条附魔（源码 var_99(40+(15-1)*2) = 0） */
  function clearLastEnchant(it) {
    if (!it || !it.f) return;
    let last = -1;
    for (let n = 0; n < 15; n++) if ((it.f[40 + n * 2] | 0) !== 0) last = n;
    if (last >= 0) { it.f[40 + last * 2] = 0; it.f[40 + last * 2 + 1] = 0; }
  }

  Elona.LivingWeapon = {
    BIT, MAX_LEVEL, expNeeded, isAlive, setAlive, level, exp, inspectText,
    tryMakeAlive, onKill, feedStarfiber, factorX, upgradeOptions, encIdFor, levelUp,
    MATERIAL_KIT_GROUPS, materialKitGroup, materialKitOptions, applyMaterialKit,
    RESIST, ELEMDMG, STAT, SKILL1, SKILL2, SKILL3, SKILL4, SPECIAL, CAT, TABLES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
