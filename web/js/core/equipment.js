'use strict';
/**
 * 装备品窗口（装備品）与穿戴动作。
 *
 * 原版锚点：
 *   *label_2815 295513-295670  装备窗：扫描 var_58(100..129) 生成行、按天赋屏蔽部位、
 *                              标记「利手」（第一个「手」槽），顶部「部位/装備品名称」「重さ」
 *   *label_2824 296163-296400  物品窗的 Wear 模式（var_486 = 6）按 `iequiploc == 槽类型` 过滤，
 *                              并允许「手(5) ↔ 遠隔(10)」互换
 *   *label_2980 342486         穿戴：写 `var_58(n) = 槽类型*10000 + 背包下标+1`、`var_99(18) = n`
 *   *label_2981 342503         卸下：清掉低 16 位、`var_99(18) = 0`
 *   297762-297860              Wear 的前置判定（妖精太重 / 混乱 / 反則值）
 *   295766-295800              卸下的前置判定（诅咒 -1/-2 不能脱）
 *
 * 槽值编码（*label_2235 219133-219190）与 item.js 一致：
 *   0                          = 槽位表结束
 *   槽类型 * 10000             = 槽存在但为空
 *   槽类型 * 10000 + (下标+1)  = 已装备（背包下标 = 低 16 位 - 1）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** var_257（8728）：1..11 的身体部位名 */
  const TYPE_JP = ['', '頭', '首', '背中', '胴体', '手', '指', '腕', '腰', '足', '遠隔', '矢弾'];
  const TYPE_CH = ['', '头部', '颈部', '背部', '身体', '手', '手指', '手腕', '腰部', '足部', '远程', '弹药'];
  /** var_257 的英文（同 9172 的表） */
  const TYPE_EN = ['', 'Head', 'Neck', 'Back', 'Body', 'Hand', 'Ring', 'Arm', 'Waist', 'Leg', 'Shoot', 'Ammo'];

  /**
   * 295530-295570：某些天赋会让对应部位「不可装备」，该行直接从装备窗消失。
   *   217 兽耳→头部 / 206 粗脖→颈部 / 205 翅膀→背部 / 218 骨突→身体
   *   223 手刀→手 / 221 大蹼→手指 / 222 粗臂→手腕 / 219 尾巴→腰部 / 203 蹄→足部
   */
  const TYPE_FEAT = { 1: 217, 2: 206, 3: 205, 4: 218, 5: 223, 6: 221, 7: 222, 8: 219, 9: 203 };

  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

  function typeName(type, lang) {
    const t = type | 0;
    if (lang === 'jp') return TYPE_JP[t] || '';
    if (lang === 'en') return TYPE_EN[t] || '';
    return TYPE_CH[t] || '';
  }

  /** 槽值（var_58(100+n)） */
  function slotValue(c, n) { return c.get(100 + (n | 0)) | 0; }
  /** 槽类型（var_58 \ 10000 的整数部分） */
  function slotType(c, n) { const v = slotValue(c, n); return v === 0 ? 0 : idiv(v, 10000); }
  /** 槽内物品的背包下标（低 16 位 - 1）；空槽返回 -1 */
  function slotItemIdx(c, n) {
    const r = slotValue(c, n) % 10000;
    return r === 0 ? -1 : r - 1;
  }

  /**
   * *label_2815 295513-295590：装备窗的行。
   * 行顺序 = var_58(100..129) 的顺序（种族 var_121(1) 决定），
   * 被天赋屏蔽的部位跳过；第一个「手」槽标为「利手」(var_2250)。
   */
  function slots(c) {
    const out = [];
    for (let n = 0; n < 30; n++) {
      const v = slotValue(c, n);
      // 295523：原版是 `if ( var_58(cnt) != 0 ) { … }`（跳过 0，**不** break）。
      //   基因合成/变异把新肢体写在「最后一个空槽」（*label_3019），中间会留空洞，
      //   所以这里必须跳过 0 继续扫，否则新长出来的部位看不见。
      if (v === 0) continue;
      const type = idiv(v, 10000);
      if (!type) continue;
      const fid = TYPE_FEAT[type];
      if (fid && Elona.Feat && (Elona.Feat.get(c, fid) | 0) !== 0) continue;   // 295533-295570
      const r = v % 10000;
      const itemIdx = r === 0 ? -1 : r - 1;
      out.push({
        n, type,
        itemIdx,
        item: itemIdx >= 0 ? (c.inv && c.inv[itemIdx]) || null : null,
      });
    }
    let dom = -1;
    for (const s of out) if (s.type === 5) { dom = s.n; break; }               // 295575-295580
    for (const s of out) s.dominant = (s.n === dom);
    return out;
  }

  /** 该角色是否有可用的装备槽（旧存档 / 未初始化时为空） */
  function hasSlots(c) { return !!c && (c.get(100) | 0) !== 0; }

  // ------------------------------------------------------------------------
  // 肢体增减 —— *label_2143 / *label_2144 / *label_3019
  // ------------------------------------------------------------------------

  /**
   * 最后一个空槽（*label_3019 299…：`repeat 30,100 { if (var_58(cnt)==0) var_444(1)=cnt }`，
   * 没有 break —— 原版取的就是**最后一个**空槽）。槽表因此会有空洞，`slots()` 跳过 0。
   * @returns {number} 100..129 的槽序号（0 起 = 相对 100 的下标）；没有空位返回 -1
   */
  function freeSlot(c, last) {
    let pick = -1;
    for (let n = 0; n < 30; n++) {
      if (slotValue(c, n) === 0) { pick = n; if (!last) break; }
    }
    return pick;
  }

  /**
   * 长出一个新肢体（*label_2144 356758 附近的 `var_58(cnt) = type*10000`）。
   * @param {object} c
   * @param {number} type 1..11（var_257 的部位编号）
   * @returns {number} 写入的槽下标（0 起），失败 -1
   */
  function addPart(c, type) {
    const t = type | 0;
    if (t < 1 || t > 11) return -1;
    const n = freeSlot(c, true);          // 原版取最后一个空槽
    if (n < 0) return -1;
    c.set(100 + n, t * 10000);
    updateComplex(c);
    return n;
  }

  /** 已占用的部位数（var_58(68) 的计算前提） */
  function partCount(c) {
    let k = 0;
    for (let n = 0; n < 30; n++) if (slotValue(c, n) !== 0) k++;
    return k;
  }

  /**
   * *label_2143（211719）：超过 13 个部位后每个 -5% 速度，最多 -50%。
   * 结果写回 var_58(68)（Stats 的速度计算会读它，见 stats.js 677）。
   */
  function updateComplex(c) {
    const n = partCount(c);
    c.set(68, n > 13 ? limit((n - 13) * 5, 0, 50) : 0);
    return c.get(68) | 0;
  }

  /**
   * 旧存档兜底：没有槽位时按种族 body1 重新写入（*label_2235）。
   * @returns {boolean} 是否做了修补
   */
  function ensureSlots(c) {
    if (!c || hasSlots(c) || !Elona.ItemDB || !Elona.ItemDB.initSlots) return false;
    let body = c.bodySlots || '';
    if (!body) {
      const rc = Elona.Data && Elona.Data.tableSync ? Elona.Data.tableSync('race_class') : null;
      const rec = rc && rc.races ? rc.races[c.raceName] : null;
      body = (rec && rec.init && rec.init.body1) || '頭|首|体|背|手|手|指|指|腕|腰|足|';
    }
    if (!body) return false;
    Elona.ItemDB.initSlots(c, body);
    return true;
  }

  /**
   * 296344：Wear 模式的候选过滤。
   *   `iequiploc(item) == 槽类型`，另外「手(5)」与「遠隔(10)」可以互换。
   */
  function canEquipTo(c, it, type) {
    if (!it || (it.f[0] | 0) <= 0) return false;
    if ((it.eqSlot | 0) >= 0) return false;
    if (!Elona.ItemDB) return false;
    const loc = Elona.ItemDB.equipLocById(it.id) | 0;
    if (!loc) return false;
    if (loc === type) return true;
    if (loc === 5 && type === 10) return true;
    if (loc === 10 && type === 5) return true;
    return false;
  }

  /** 该部位可穿的背包物品（返回实例数组，顺序 = 背包顺序） */
  function candidates(c, type) {
    const out = [];
    if (!c || !c.inv) return out;
    for (let i = 0; i < c.inv.length; i++) {
      const it = c.inv[i];
      if (canEquipTo(c, it, type)) out.push(it);
    }
    return out;
  }

  /** 该物品能穿到哪些部位（用于「装备」一览的提示） */
  function locsOf(it) {
    if (!it || !Elona.ItemDB) return [];
    const loc = Elona.ItemDB.equipLocById(it.id) | 0;
    if (!loc) return [];
    if (loc === 5) return [5, 10];
    if (loc === 10) return [10, 5];
    return [loc];
  }

  /** 装备总重量（var_58(64)）：所有已装备物品的重量，按数量计 */
  function totalWeight(c) {
    let w = 0;
    for (const s of slots(c)) {
      const it = s.item;
      if (!it) continue;
      w += (it.f[7] | 0) * Math.max(1, it.f[0] | 0);
    }
    return w;
  }

  /** 装备重量档（cnveqweight）：原版 0 = 軽装備 / 1 = 中装備 / 2 = 重装備 */
  function weightClass(g, w) {
    // 295645-295655：轻 = 重量 < 上限/3；重 = 超过上限/2；其余中
    const cap = (g && g.player ? (g.player.get(43) | 0) : 0) || 80000;
    if (w * 3 < cap) return 0;
    if (w * 2 > cap) return 2;
    return 1;
  }
  const WEIGHT_TEXT = ['轻装备', '中装备', '重装备'];

  /** DV / PV（295636-295648） */
  function dvPv(c) {
    const dvMul = (c.get(77) | 0) || 100;
    const pvMul = (c.get(76) | 0) || 100;
    const dv = idiv((c.get(71) | 0) * dvMul, 100) + dvMul - 100;
    const pv = idiv(((c.get(70) | 0) + idiv(pvMul, 25)) * pvMul, 100);
    if ((c.get(60) | 0) >= 100) return { dv: 0, pv: 0 };        // 295648：破防
    return { dv, pv };
  }

  /**
   * 穿戴到指定槽（*label_2980 + 297762 的前置判定）。
   * @param {object} g game
   * @param {number} n 槽序号（0 起，对应 var_58(100+n)）
   * @param {number} idx 背包下标
   * @returns {{ok:boolean, reason?:string, message:string}}
   */
  function equip(g, n, idx) {
    const c = (g && g.player) || null;
    if (!c) return { ok: false, reason: 'no-player', message: '' };
    const it = c.inv && c.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item', message: '没有这件物品。' };
    const v = slotValue(c, n);
    if (v === 0) return { ok: false, reason: 'no-slot', message: '没有这个装备槽。' };
    const type = idiv(v, 10000);
    if ((v % 10000) !== 0) return { ok: false, reason: 'occupied', message: '那个部位已经装备了东西。' };
    if (!canEquipTo(c, it, type)) {
      return { ok: false, reason: 'wrong-slot', message: `这件物品不能装备在${typeName(type)}。` };
    }
    // 297763-297772：妖精（feat 161）拿不动 2s 以上的东西
    if (Elona.Feat && (Elona.Feat.get(c, 161) | 0) !== 0 && (it.f[7] | 0) > 2000) {
      return { ok: false, reason: 'too-heavy', message: '那太重了，装备不了。' };
    }
    // 297773-297784：混乱（var_58(269)）不能换装
    if ((c.get(269) | 0) !== 0) {
      return { ok: false, reason: 'confused', message: '头脑模糊，无法更换装备……' };
    }
    // 297785-297806：反則值太高
    if (((it.f[15] | 0) + (it.f[14] | 0)) >= 180) {
      return { ok: false, reason: 'unfair', message: '那件装备太违规了，穿不上。' };
    }
    if (((it.f[13] | 0) + (it.f[12] | 0)) >= 80 && (it.id | 0) !== 240) {
      return { ok: false, reason: 'unfair', message: '那件装备太违规了，穿不上。' };
    }
    if (c.index === 0 && Elona.ItemDB.identify) Elona.ItemDB.identify(it, 2);   // 342497
    c.set(100 + (n | 0), type * 10000 + (idx | 0) + 1);
    it.eqSlot = n | 0;
    if (g && g.setV65) g.setV65(808, 1);                                         // 297845
    const nm = Elona.ItemDB.name(it) || '物品';
    return { ok: true, message: `装备了${nm}。` };
  }

  /**
   * 卸下指定槽（*label_2981 + 295766 的判定）。
   * @returns {{ok:boolean, reason?:string, message:string}}
   */
  function unequip(g, n) {
    const c = (g && g.player) || null;
    if (!c) return { ok: false, reason: 'no-player', message: '' };
    const v = slotValue(c, n);
    const type = idiv(v, 10000);
    if (!type) return { ok: false, reason: 'no-slot', message: '没有这个装备槽。' };
    const r = v % 10000;
    if (!r) return { ok: false, reason: 'empty', message: '那个部位没有装备。' };
    const idx = r - 1;
    const it = c.inv && c.inv[idx];
    if (!it) { c.set(100 + (n | 0), type * 10000); return { ok: false, reason: 'no-item', message: '' }; }
    // 295770：诅咒装备（-1 / -2）脱不下来
    const curse = it.f[17] | 0;
    if (curse === -1 || curse === -2) {
      return { ok: false, reason: 'cursed', message: `${Elona.ItemDB.name(it)}脱不下来。` };
    }
    if ((c.get(269) | 0) !== 0) {
      return { ok: false, reason: 'confused', message: '头脑模糊，无法更换装备……' };
    }
    c.set(100 + (n | 0), type * 10000);
    it.eqSlot = -1;
    const nm = Elona.ItemDB.name(it) || '物品';
    return { ok: true, message: `卸下了${nm}。` };
  }

  Elona.Equipment = {
    TYPE_JP, TYPE_CH, TYPE_EN, TYPE_FEAT, WEIGHT_TEXT,
    typeName, slotValue, slotType, slotItemIdx,
    slots, hasSlots, ensureSlots, canEquipTo, candidates, locsOf,
    freeSlot, addPart, partCount, updateComplex,
    totalWeight, weightClass, dvPv, equip, unequip,
    _internals: { idiv, limit },
  };
})(window);
