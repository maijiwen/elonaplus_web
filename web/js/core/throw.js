'use strict';
/**
 * 投掷（T 键 → var_486=26 → *label_2975 340795-341420）。
 *
 * 【已确认 流程】
 *   340796-340824  所有权 / 重量 / 不可丢弃(ibit 13) 检查
 *   340873-340888  命中判定：`dist*4 > rnd(投擲111+10) + 投擲111/4` 时落点 ±1 抖动；
 *                  抖动后的格必须是可通行、且不是门/告示板/投票箱/街告示板(21/23/31/33)
 *   340898-340913  消耗 1 个；可放置物品（60000/64000/80000/57000 与 685/906/984/1313/1098）
 *                  在地面生成 1 个副本，其余物品消失
 *   341347-341390  效果：392 → 酸雾(type3)；577 → 火(type5)+mapitem_fire；
 *                  1181 → 9 格烟幕(type9)；其余物品 → 液体(type6)
 *   341393-341419  1048（炸弹）→ 命中角色或火(type5)
 *
 * 【0-EY 追加】341605-341676：57000 类食物命中角色时由 core/foodleft.js 判定
 *   「特殊食物专属效果 / 瞬间进食（含 1/8 噎住）/ 无属性伤害」，
 *   瞬间进食走 Game.eatItemNow 复用 finishEating 的全部结算。
 *
 * 【0-GR 追加】341421-341860 的命中分派整段交 core/throwhit.js：
 *   按 id 的专例（906/1098/1313/984/1079/1080）、类别 57000/60000/64000/80000 的
 *   公共前段与 12 个专例 id（987/1008/1064/1059/1061/1133/1309/1307/1312/1306/
 *   1305/1304/988/989）、以及 578 貯金箱落地散落金币。
 *
 * 【0-HG 追加】340921-341010 的 685/699 捕获完整条件（含 var_244<57、
 *   var_65(250+306)、かばう替身、699 小妹妹捕获球）；341014-341154 / 341240-341346
 *   的火炎瓶油状态、喪蝉（畏缩/戦慄/音伤害/鱼饵）、雪打碎雪人、落地文案分 id。
 *
 * 【0-HH 追加】340904-340911 的 685「先消耗再复制到落点」（捕获信息写地面副本）；
 *   341321-341345 的 772/1072/1073/1081 落地销毁（DESTROY_ON_LAND）；
 *   341393-341419 的 1048 吸い殻两段（命中→按 1133 引爆 / 落地→火 mef + mapitem_fire）。
 *
 * 【0-HI 追加】341014-341237 命中角色的公共前段按源码顺序重排：
 *   命中播报 → 湿身 25（排除 577/392/587/772/1035/1036/1072/1073/1081/1181/1228）
 *   → rowact_check → 按 id 专例；52000 药剂改为**命中即施加**（`gosub *label_0598`）；
 *   772/1072/1073/1081 由本模块接管（原先经 ThrowHit 的 57000 路径会误加敌对与技能经验）；
 *   1228 补 `var_396 = 434`（轟音の波動）的法术结算；340889 錬金術士栗子台词；
 *   340870 瓶塞 +1（源码无斗志加成，更正旧注释）。
 *   var_1321「特殊弹药」经复核属**射击**系统（345713-345733，core/battle.js 已实现），
 *   投掷路径 340795-341860 从不读它，已从投掷缺口清单移除。
 *
 * 【仍未移植】全部音效与动画（纯表现层），以及自泼（`var_2518 = 100`，348763）——
 *   网页的「使用药水」直接结算效果，没有把药瓶扔在自己脚下的入口。
 *   详见 docs/16-throw-audit.md。
 *   本模块只返回结构化结果，由 game 输出日志。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const mod = (a, b) => (b === 0 ? 0 : (a % b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  function dist(x1, y1, x2, y2) {
    return Elona.Battle ? Elona.Battle.dist(x1, y1, x2, y2)
      : Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
  }
  function ref(id, f) { return Elona.ItemDB ? Elona.ItemDB.ref(id, f) : 0; }

  /** 341321-341334：这几样食物落地后源码 `var_99(0)--` 直接销毁，不留地面物品 */
  const DESTROY_ON_LAND = [772, 1072, 1073, 1081];

  /** 该格是否在玩家视野内（源码 `var_52`，只影响播报是否显示） */
  function inSight(g, x, y) {
    try {
      if (g && g.map && typeof g.map.isVisible === 'function') return !!g.map.isVisible(x, y);
    } catch (e) { /* noop */ }
    return true;
  }

  /** 该格能否作为投掷落点（340880） */
  function canLand(g, x, y) {
    if (!g.map || !g.map.inBounds(x, y)) return false;
    const cell = g.map.cell(x, y);
    if (g.map.attr(cell[0], 7) & 4) return false;
    if (Elona.MapFeat) {
      const f = Elona.MapFeat.read(g, x, y);
      if ([21, 23, 31, 33].includes(f.type)) return false;
    }
    return true;
  }

  /** 检查物品是否可投掷（340796-340824） */
  function canThrow(c, idx) {
    const it = c.inv && c.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item' };
    if (it.eqSlot >= 0) return { ok: false, reason: 'equipped' };
    if (it.f[18] | 0) return { ok: false, reason: 'equipped' };
    if (Elona.ItemDB && Elona.ItemDB.ibit && Elona.ItemDB.ibit(13, it)) {
      return { ok: false, reason: 'no-drop' };
    }
    // 296766-296769：已捕获生物的怪物球不能再投
    if (it.id === 685 && (it.f[23] | 0) !== 0) return { ok: false, reason: 'occupied' };
    const cat = ref(it.id, 5);
    if (cat === 60000 || cat === 64000 || cat === 80000) {
      if (limit(idiv(it.f[7] | 0, 1000), 0, 1000) > c.skill(153) + 5) {
        return { ok: false, reason: 'too-heavy' };
      }
    }
    return { ok: true };
  }

  /** (x,y) 上的活跃角色 */
  function charaAt(g, x, y) {
    for (const c of g.charas || []) {
      if (c && c.get(0) === 1 && c.x === x && c.y === y) return c;
    }
    return null;
  }

  /** chara_vanquish（341009）+ check_quest（341010）的网页等价 */
  function vanquish(g, c) {
    c.set(0, 0);
    if (g.map) {
      const cell = g.map.cell(c.x, c.y);
      if (cell) cell[1] = 0;
    }
    if (g.syncCharaCells) g.syncCharaCells();
    if (Elona.QuestCheck) Elona.QuestCheck.check(g);   // chara_vanquish 之后
  }

  /**
   * 685 怪物球捕获 —— 340944-340987（A202 / 0-HG 补齐）。
   * 源码是**确定性的条件判定，没有任何成功率 rnd()**：
   *   340945 var_244 < 57 / var_58(150)!=0 / var_58(25)==6 / cbit 976·992 /
   *          var_65(250+306)==目标 → 「その生物には無効だ。」
   *   340953 目标等级 > 球等级 var_99(26) → 等级不足
   *   340961 HP > 最大HP/10 → 需要削弱
   *   340969 地图 6/40/35 或 (30 且层数 1) → 场所禁止
   * 成功：var_99(23)=种族、var_99(27)=等级、var_99(7)=10000、var_99(1)=1000，
   *       然后 chara_vanquish + check_quest。
   */
  function capture(g, thrower, target, ball) {
    const cbit = (c, bit) => (Elona.Status ? Elona.Status.cbit(c, bit) : 0);
    // 340945：玩家与 0..56 号固定槽、以及当前特殊目标都不可捕获
    const special = g.getV65 ? (g.getV65(250 + 306) | 0) : 0;
    if ((target.index | 0) < 57 || special === (target.index | 0)) {
      return { ok: false, reason: 'immune' };
    }
    if (cbit(target, 976) || cbit(target, 992)) return { ok: false, reason: 'immune' };
    if ((target.get(150) | 0) !== 0) return { ok: false, reason: 'immune' };
    if ((target.get(25) | 0) === 6) return { ok: false, reason: 'immune' };
    const ballLv = ball.f[26] | 0;
    if (target.level > ballLv) return { ok: false, reason: 'ball-level', ballLv, level: target.level };
    if (target.hp > idiv(target.hpMax, 10)) return { ok: false, reason: 'too-strong' };
    const map = g.getV65 ? g.getV65(20) : 0;
    const floor = g.getV65 ? g.getV65(22) : 0;
    if (map === 6 || map === 40 || map === 35 || (map === 30 && floor === 1)) {
      return { ok: false, reason: 'area' };
    }
    ball.f[23] = target.get(27) | 0;       // creature id
    ball.f[27] = target.level | 0;         // captured level
    ball.f[7] = 10000;
    ball.f[1] = 1000;
    vanquish(g, target);
    return { ok: true, creatureId: ball.f[23], level: ball.f[27] };
  }

  /**
   * 699 リトル捕獲玉（340989-341008）—— 0-HG 新增，原网页完全没有投掷分支。
   * 与 685 的区别：目标必须是种族 319 且 index>=16；成功不是装进球，
   * 而是 gosub *label_4274（589937-589962）直接收成同伴，再 chara_vanquish 原角色。
   * 注意 340905 的可放置列表不含 699，球投出后即消失（网页 685 分支沿用「不消耗」的既有简化）。
   */
  function captureLittle(g, thrower, target) {
    const special = g.getV65 ? (g.getV65(250 + 306) | 0) : 0;
    if ((target.get(27) | 0) !== 319 || (target.index | 0) < 16
      || special === (target.index | 0)) {
      return { ok: false, reason: 'nothing',
        message: '何もおきない… / Nothing happens...' };
    }
    const map = g.getV65 ? (g.getV65(20) | 0) : 0;
    if (map === 6 || map === 40 || map === 35) {
      return { ok: false, reason: 'area',
        message: 'この場所では効果がない。 / This doesn\'t work in this area.' };
    }
    // 589938-589962：get_freeally() 无空位 → 不收人，也不移除原角色
    let pet = null;
    if (Elona.Party && Elona.Party.addPet) {
      pet = Elona.Party.addPet(g, 319, (target.get(38) | 0) || (target.level | 0), target.name);
    }
    if (!pet || pet.ok === false) {
      return { ok: false, reason: 'party-full',
        message: '仲間の最大数に達しているため、仲間にできなかった…。' };
    }
    vanquish(g, target);
    return { ok: true, creatureId: 319, little: true,
      level: (target.get(38) | 0) || (target.level | 0) };
  }

  /** 在落点生成一件地面物品（341142 / 341314 的 itemcreate -1, 617, x, y, 0） */
  function createGround(g, id, x, y, fields) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    let o = null;
    try { o = Elona.ItemDB.createItem(id | 0, 1); } catch (e) { return null; }
    if (!o) return null;
    o.f[5] = x | 0; o.f[6] = y | 0; o.f[21] = -1;
    if (fields) for (const k of Object.keys(fields)) o.f[k | 0] = fields[k];
    if (Array.isArray(g.groundItems)) g.groundItems.push(o);
    if (g.refreshGroundCell) g.refreshGroundCell(x, y);
    return o;
  }

  /** 341140-341145 / 341311-341318：喪蝉变成「蝉」鱼饵 617 */
  function cicadaBait(g, x, y) {
    return createGround(g, 617, x, y, { 25: 4, 2: 389, 1: 4 * 4 * 500 + 200 });
  }

  /** 341051：命中角色时**不**给目标湿身的物品 */
  const NO_WET = [577, 392, 587, 772, 1035, 1036, 1073, 1072, 1081, 1181, 1228];

  /** 341240 / 341387：投掷者带 buff 38（強力道具）时士气 +5（`modgauge var_243, 5`） */
  function moraleOf(g, c) {
    const P = Elona.Potion;
    if (P && P.moraleBonus) return !!P.moraleBonus(c);
    if (!Elona.Status || !Elona.Status.findbuff) return false;
    if (Elona.Status.findbuff(c, 38) === -1) return false;
    if (Elona.Morale && Elona.Morale.add) Elona.Morale.add(c, 5);
    return true;
  }

  /** 341227 的目标敌对化：`var_244 >= 16` 且 `cbit(960) != 1` */
  function hostileOf(g, c, t) {
    if ((t.index | 0) < 16) return false;
    if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(t, 960)) return false;
    const H = (Elona.Intimacy && Elona.Intimacy.hostileAction)
      || (Elona.Relation && Elona.Relation.hostileAction);
    if (H) { try { H(g, c, t); return true; } catch (e) { /* noop */ } }
    return false;
  }

  /**
   * 341014-341237 + 341393-341419：投掷物「命中角色」的专例（0-HI 按源码顺序重排）。
   *
   * 源码这一段排在 341421 的按 id 专例**之前**，且命中后一律 `goto *label_4358`
   * 结束整段投掷 —— 因此 handled / skipMef 为 true 时 throwItem 不再跑
   * ThrowHit.hit 与落地液体。顺序：
   *   341040-341047  命中播报（1181 在 341030 就被排除在角色处理之外）
   *   341051         wet 25（排除列表见 NO_WET）
   *   341053         rowact_check
   *   341055-341220  587/772/1228/1081/1073/1072/577 各自的 goto 分支
   *   341222-341237  其余物品 → var_59=15 / var_60=物品id → `gosub *label_0598`
   *                  （实际只对 52000 药剂有效果）+ 目标敌对化 + 投掷者士气
   */
  function specialHit(g, c, it, target, R, skill) {
    const id = it.id | 0;
    const cat = ref(id, 5);
    // 341015：601 空き瓶 跳过整段角色处理（不播命中、不湿身、不施药），
    //   但 341386 的落地液体照常生成 —— 因此返回 handled=false。
    if (id === 601) return { handled: false, skipMef: false, messages: [], effects: [] };
    const isPotion = cat === 52000;
    // 1048 吸い殻在源码 341393-341419 单独处理（命中角色 → 当作 1133 ボムタル 引爆）
    const specialIds = [772, 1073, 1072, 1081, 1181, 1228, 587, 577, 1048];
    if (!isPotion && specialIds.indexOf(id) < 0) return null;
    if (!target) return null;
    const out = { handled: false, skipMef: false, messages: [], effects: [] };
    const nm = target.name || '对方';

    // 341030-341299：1181 煙玉不处理角色命中，只播落地「炸裂」并照常生成烟幕
    if (id === 1181) {
      out.messages.push('それは地面に落ちて炸裂した。');
      return out;
    }

    // 341393-341419：1048 吸い殻命中角色 → 播报 + rowact_check + hostileaction
    //   → var_396 = 1133（ボムタル）、var_578 = 40、gosub *label_2960（引爆）
    //   这一段在源码里独立于 341014 的列表，因此不走下面的湿身 / 命中播报。
    if (id === 1048) {
      out.handled = true; out.skipMef = true;
      out.messages.push(`${nm}に見事に命中した！`);
      if (Elona.ThrowHit && Elona.ThrowHit.interrupt) Elona.ThrowHit.interrupt(g, target);
      if ((target.index | 0) >= 16 && Elona.Intimacy && Elona.Intimacy.hostileAction) {
        Elona.Intimacy.hostileAction(g, c, target);
      }
      if (Elona.Potion && Elona.Potion.apply) {
        const r = Elona.Potion.apply(g, c, target, 1133, 40, 0, { item: null });
        if (r && r.messages) out.messages.push.apply(out.messages, r.messages);
        out.effects.push('bomb');
      }
      return out;
    }

    // 341040-341047
    out.messages.push(`${nm}に狙いを過たず命中した！`);
    // 341051：湿身 25 回合
    if (NO_WET.indexOf(id) < 0 && Elona.Status && Elona.Status.wet) {
      Elona.Status.wet(target, 25);
      out.effects.push('wet');
    }
    // 341053
    if (Elona.ThrowHit && Elona.ThrowHit.interrupt) Elona.ThrowHit.interrupt(g, target);

    // 341055-341068：587 雪 —— 目标不是玩家时 6 选 1 台词，然后整段结束（不湿身、不敌对）
    if (id === 587) {
      out.handled = true; out.skipMef = true;
      if ((target.index | 0) !== 0) {
        const LINES = ['「いてー！」', '「やったな」', ' *クスクス* ',
          '「キャハハ」', '「こやつめ」', '「むむっ」'];
        out.messages.push(LINES[R(6)]);
      }
      return out;
    }

    // 341069-341093：772 トマト
    if (id === 772) {
      out.messages.push(' *ぷちゅ* ');
      if ((it.f[27] | 0) === -1) {
        out.messages.push(`${nm}は怒りに体を奮わせた！`);
        if ((target.get(264) | 0) === 0) target.set(264, R(10) + 5);
      }
      out.handled = true; out.skipMef = true; out.effects.push('tomato');
      return out;
    }

    // 341095-341154：1228 喪蝉
    if (id === 1228) {
      out.messages.push(' *必殺セミファイナル！* ');
      out.messages.push('「ジジジジジジジジッッッ！！！！！」');
      if ((target.get(175) | 0) < 5) target.set(175, 5);
      if ((target.get(267) | 0) < 2) target.set(267, 2);
      const lv = c.get(38) | 0;
      const pThrow = g.player ? (g.player.skill(111) | 0) : (c.skill(111) | 0);
      const n = (idiv(c.skill(13) | 0, 5) + 5) * (idiv(pThrow + 1, 5) + 5)
        + R(skill * 2 + 5)
        + (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000))
          * 4 * Math.sqrt(limit(lv, 1, 2000) * 3) + 30;
      if (Elona.Battle && Elona.Battle.applyDamage) {
        Elona.Battle.applyDamage(target, Math.max(0, n | 0), g, c, 57, 1000);
      } else {
        target.hp = Math.max(0, (target.hp | 0) - (n | 0));
      }
      out.effects.push('cicada');
      // 341134-341146：1/10 掉 617 蝉鱼饵（原物品同时被改成鱼饵外观，网页只额外掉落一份）
      if (R(10) === 0) { cicadaBait(g, target.x, target.y); out.effects.push('bait'); }
      // 341148-341153：var_2210 = 目标 → var_2422/var_578 = (投擲0+咏唱0+Lv0)*6+5
      //   → var_396 = 434（轟音の波動）→ gosub *label_2960。
      //   这里直接进 dispatchEffect 而不是 cast：cast 会先跑 precheck，
      //   把 3000 系（f[3]=3002）的目标改写成施法者自身，与「以命中目标为中心」不符。
      const p0 = g.player || c;
      const pw = (((p0.skill ? p0.skill(111) : 0) | 0)
        + ((p0.skill ? p0.skill(151) : 0) | 0) + (p0.get(38) | 0)) * 6 + 5;
      const SP = Elona.Spell;
      if (SP && SP.dispatchEffect) {
        try {
          if (g) g.var2422 = pw;
          out.cast = SP.dispatchEffect(g, c, 434, target, pw, 3);
          out.effects.push('howling');
        } catch (e) { /* noop */ }
      } else if (SP && SP.cast) {
        try { out.cast = SP.cast(g, c, 434, target); out.effects.push('howling'); }
        catch (e) { /* noop */ }
      }
      out.handled = true; out.skipMef = true;
      return out;
    }

    // 341156-341178：1081 納豆
    if (id === 1081) {
      out.messages.push(' *ねばー* ');
      out.messages.push(`${nm}は怒りに体を奮わせた！`);
      if ((target.get(264) | 0) === 0) target.set(264, 5 + (it.f[20] | 0));
      out.handled = true; out.skipMef = true; out.effects.push('natto');
      return out;
    }

    // 341180-341195：1073 バター
    if (id === 1073) {
      out.messages.push(`${nm}は香ばしいバターまみれになった。「べちゃべちゃする…」`);
      if ((target.get(177) | 0) <= 1) target.set(177, (target.get(177) | 0) + 1);
      target.set(412, (target.get(412) | 0) + 15);
      out.handled = true; out.skipMef = true; out.effects.push('butter');
      return out;
    }

    // 341197-341209：1072 ヨーグルト
    if (id === 1072) {
      out.messages.push(`${nm}は怒りに体を奮わせた！`);
      target.set(264, (target.get(264) | 0) + R(3) + 5);
      out.handled = true; out.skipMef = true; out.effects.push('yogurt');
      return out;
    }

    // 341211-341220：577 火炎瓶 —— 油 +5，然后落到 341227 的敌对化与 label_0598
    if (id === 577) {
      out.messages.push(`${nm}は、燃料まみれになった。`);
      target.set(412, (target.get(412) | 0) + 5);
      hostileOf(g, c, target);
      moraleOf(g, c);
      out.handled = true; out.skipMef = true; out.effects.push('oil');
      return out;
    }

    // 341222-341237：var_59 = 15 / var_60 = 物品 id → `gosub *label_0598`
    //   效果引擎按物品 id 分派，只有 52000 药剂类会命中具体效果。
    if (isPotion && Elona.Potion && Elona.Potion.apply) {
      hostileOf(g, c, target);
      const base = 50 + (skill | 0) * 10;                 // 341347 的 var_578
      // apply 内部已经按 thrown 档补「水分/饱腹」（314906-314915），不要在外面再调 after。
      let r = null;
      try {
        r = Elona.Potion.apply(g, c, target, id, base, it.f[17] | 0,
          { thrown: true, item: it });
      } catch (e) { r = null; }
      if (r && r.messages) out.messages.push.apply(out.messages, r.messages);
      if (r) out.potion = r;
      moraleOf(g, c);
      out.handled = true; out.skipMef = true; out.effects.push('potion');
      return out;
    }

    return out;
  }

  /**
   * 341240-341318：落到地面时的专例（0-HG 补齐）。只在没有命中角色时生效。
   */
  function specialGround(g, it, x, y, R, c) {
    const id = it.id | 0;
    const rnd = R || ((n) => (g.rng || Elona.rng).rnd(n));
    const out = { handled: false, skipMef: false, snow: false, destroy: false, messages: [], effects: [] };
    if (id === 587) {
      // 341241-341263：同格有 541 雪だるま → 打碎一个并结束整段
      const items = g.groundItems || [];
      for (let i = 0; i < items.length; i++) {
        const o = items[i];
        if (!o || (o.id | 0) !== 541 || (o.f[5] | 0) !== x || (o.f[6] | 0) !== y) continue;
        o.f[0] = (o.f[0] | 0) - 1;
        if ((o.f[0] | 0) <= 0) items.splice(i, 1);
        out.effects.push('snowman');
        out.messages.push('雪だるまは崩れた。');
        out.handled = true; out.skipMef = true;
        if (g.refreshGroundCell) g.refreshGroundCell(x, y);
        break;
      }
      // 341267：落在雪地（地形 4）上直接消失，不播「溶けた」
      if (!out.handled && g.map && g.map.cell) {
        const cell = g.map.cell(x, y);
        if (cell && (cell[0] | 0) === 4) { out.snow = true; out.skipMef = true; }
      }
    } else if (id === 1228) {
      // 341311-341318：喪蝉落地「絶命」→ 销毁本体、在原地生成 617 蝉鱼饵
      cicadaBait(g, x, y);
      out.handled = true; out.skipMef = true; out.destroy = true;
      out.effects.push('bait');
      out.messages.push('それは地面に落ちて絶命した。');
    } else if (id === 1048) {
      // 341415-341418：吸い殻落到空地上 → 火(type5)强度 24、持续 5+rnd(5)、威力 40，
      //   并引燃该格地面物品（mapitem_fire）；源码无文案，只有音效。
      if (g.mef && g.mef.add) {
        g.mef.add(g, x, y, 5, 24, 5 + rnd(5), 40, (c && c.index) | 0);
      }
      if (Elona.ItemDB && Elona.ItemDB.mapitemFire) {
        Elona.ItemDB.mapitemFire(g, x, y, c);
      }
      out.handled = true; out.skipMef = true; out.effects.push('fire');
    }
    return out;
  }

  /**
   * 投掷一件物品。
   * @param {object} g
   * @param {object} c      投掷者
   * @param {number} idx    背包下标
   * @param {number} tx,ty  目标格
   * @param {object} [opts] { selfPour } —— `var_2518 = 100`（倒在自己身上，348763）
   * @returns {object}
   */
  function throwItem(g, c, idx, tx, ty, opts) {
    const chk = canThrow(c, idx);
    if (!chk.ok) return chk;
    const selfPour = !!(opts && opts.selfPour);
    const it = c.inv[idx];
    const R = (n) => (g.rng || Elona.rng).rnd(n);
    const skill = c.skill(111);

    // ---- 340873-340888：命中/落点抖动 ----
    let lx = tx | 0, ly = ty | 0;
    const d = dist(c.x, c.y, lx, ly);
    let missed = false;
    if (d * 4 > R(skill + 10) + idiv(skill, 4)) {
      const nx = lx + R(2) - R(2), ny = ly + R(2) - R(2);
      if (canLand(g, nx, ny)) { lx = nx; ly = ny; }
      missed = true;
    }
    if (!canLand(g, lx, ly)) return { ok: false, reason: 'blocked' };

    const itemId = it.id;
    const cat = ref(itemId, 5);
    const count = it.f[0] | 0;

    // ---- 340921-341010：捕获玉命中角色（685 怪物球 / 699 小妹妹捕获球）----
    //   源码 340904 先 `removeitem`（球 -1），340905-340911 再把 685 复制到落点，
    //   之后捕获结果（种族/等级/重量/价值）写在这个**地面副本**上（var_579 = var_580）。
    //   699 不在 340905 的可放置列表里，投出即消失。
    if (itemId === 685 || itemId === 699) {
      const target = charaAt(g, lx, ly);
      if (target) {
        // 340926-340937：かばう（var_58(168)/var_58(167)）按双方 HP 骰决定是否换目标
        const guardOut = { messages: [] };
        const aimed = (Elona.ThrowHit && Elona.ThrowHit.guardTarget)
          ? Elona.ThrowHit.guardTarget(g, target, guardOut, R) : target;
        let ballCopy = null;
        // 340904：两种球都先在背包扣 1（699 不在 340905 的复制列表，扣完即消失）
        it.f[0] = count - 1;
        if (it.f[0] <= 0) c.inv[idx] = null;
        if (itemId === 685) {
          if (Elona.Item && Elona.Item.fromJSON) {
            ballCopy = Elona.Item.fromJSON(it.toJSON());
            ballCopy.f[0] = 1;
            ballCopy.f[5] = lx; ballCopy.f[6] = ly; ballCopy.f[21] = -1;
            ballCopy.eqSlot = -1;
            if (!Array.isArray(g.groundItems)) g.groundItems = [];
            g.groundItems.push(ballCopy);
            if (g.refreshGroundCell) g.refreshGroundCell(lx, ly);
          }
        }
        const cap = (itemId === 685)
          ? capture(g, c, aimed, ballCopy || it)
          : captureLittle(g, c, aimed);
        return { ok: true, missed, itemId, count, target: { x: lx, y: ly },
          placed: ballCopy, captured: cap, effect: [], messages: guardOut.messages };
      }
    }

    // ---- 340889-340897：职业「錬金術士」投栗子时的专属台词 ----
    //   源码条件是 `id == 906 & f[26] == 0 & var_63(6) == "錬金術士"`，且只在视野内播报。
    const preMessages = [];
    if (itemId === 906 && (it.f[26] | 0) === 0
      && (c.classDisplay || '') === '錬金術士' && inSight(g, lx, ly)) {
      preMessages.push('「うにーっ！」');
    }

    // ---- 340898-340913：消耗 1 个 ----
    it.f[0] = count - 1;
    if (it.f[0] <= 0) c.inv[idx] = null;
    // 340869-340871：玩家投出「贴图 354」的药水 → 瓶塞 +1（`var_65(250+439)++`）。
    //   源码这一步只加瓶塞；士气 +5 是「使用药剂」(342594-342598) 才有的。
    if ((c.index | 0) === 0 && Elona.Potion && Elona.Potion.addPlug) {
      Elona.Potion.addPlug(g, it, 1);
    }

    // 可放置类 → 地面副本
    const placeable = [685, 906, 984, 1313, 1098].includes(itemId)
      || [60000, 64000, 80000, 57000].includes(cat);
    let placed = null;
    if (placeable && Elona.Item) {
      const copy = Elona.Item.fromJSON(it.toJSON());
      copy.f[0] = 1;
      copy.f[5] = lx; copy.f[6] = ly; copy.f[21] = -1;
      copy.eqSlot = -1;
      g.groundItems.push(copy);
      if (g.refreshGroundCell) g.refreshGroundCell(lx, ly);
      placed = copy;
    }

    // ---- 0-GR：命中角色的效果分派（341421-341860，见 core/throwhit.js）----
    //   涵盖按 id 的专例（906/1098/1313/984/1079/1080）、类别 57000/60000/64000/80000
    //   的公共前段与 12 个专例 id；57000 食物的瞬间进食仍由 core/foodleft.js 承担。
    let food = null;
    let hit = null;
    const hitChara = charaAt(g, lx, ly);
    // 0-HG：341014-341154 命中专例、341240-341318 落地专例（都在 341421 之前判定）
    const spec = specialHit(g, c, placed || it, hitChara, R, skill);
    const groundSpec = !hitChara ? specialGround(g, placed || it, lx, ly, R, c) : null;
    if (hitChara && Elona.ThrowHit && !(spec && spec.handled)) {
      hit = Elona.ThrowHit.hit(g, c, hitChara, placed || it, { skill });
      if (hit && hit.food) food = hit.food;
      if (hit && hit.consumed && placed && (placed.f[0] | 0) <= 0) placed = null;
    }

    // ---- 341347-341390：落地效果 ----
    // 源码顺序：392 → 酸(type3)；577 → 火(type5)+mapitem_fire；1181 → 烟(type9)；
    //           其余 → 液体(type6)。
    // 注：1048（炸弹）的火效果在**使用**路径（341393-341419），不在投掷落地路径。
    const effect = [];
    // 食物被吃掉 / 触发专属效果时源码直接 goto *label_4358，不再生成地面液体效果；
    // 0-HG：喪蝉命中 / 落地、雪打碎雪人或落在雪地也直接结束，不生成液体。
    if (g.mef && !(food && (food.special || food.eaten))
      && !(spec && spec.skipMef) && !(groundSpec && groundSpec.skipMef)) {
      if (itemId === 392) {
        g.mef.add(g, lx, ly, 3, 19, R(15) + 5, 50 + skill * 10, c.index);
        effect.push('acid');
      } else if (itemId === 577) {
        g.mef.add(g, lx, ly, 5, 24, R(15) + 25, 50 + skill * 10, c.index);
        if (Elona.ItemDB && Elona.ItemDB.mapitemFire) Elona.ItemDB.mapitemFire(g, lx, ly, c);
        effect.push('fire');
      } else if (itemId === 1181) {
        for (let k = 0; k < 120; k++) {
          const nx = lx + R(3) - R(3), ny = ly + R(3) - R(3);
          if (dist(lx, ly, nx, ny) >= 3 || !canLand(g, nx, ny)) continue;
          g.mef.add(g, nx, ny, 9, 963, 30, 500);
        }
        effect.push('smoke');
      } else if (itemId !== 1048 && cat !== 60000 && cat !== 64000 && cat !== 80000) {
        g.mef.add(g, lx, ly, 6, 27, -1, 50 + skill * 10, c.index, itemId, it.f[17] | 0, 0);
        effect.push('liquid');
        // 341387-341388：生成水渍后，投掷者带 buff 38 则士气 +5
        moraleOf(g, c);
      }
    }

    // ---- 341846-341860：落到地面的收尾（578 貯金箱散落 f[25] 枚金币）----
    let ground = null;
    if (!hitChara && Elona.ThrowHit
      && !(groundSpec && (groundSpec.snow || groundSpec.handled))) {
      ground = Elona.ThrowHit.ground(g, placed || it, lx, ly);
    }
    const messages = preMessages.slice();
    if (spec) messages.push(...spec.messages);
    if (groundSpec) messages.push(...groundSpec.messages);
    if (hit && hit.messages) messages.push(...hit.messages);
    if (ground && ground.messages) messages.push(...ground.messages);

    // ---- 341321-341345 / 341311-341318：落地即销毁的地面副本 ----
    //   772 トマト / 1072 ヨーグルト / 1073 バター / 1081 納豆 落地后源码 `var_99(0)--`
    //   直接销毁（只播 ぷちゅ / べちゃ），1228 喪蝉落地则销毁并换成鱼饵。
    if (placed && (DESTROY_ON_LAND.indexOf(itemId) >= 0 || (groundSpec && groundSpec.destroy))) {
      const gi = Array.isArray(g.groundItems) ? g.groundItems.indexOf(placed) : -1;
      if (gi >= 0) g.groundItems.splice(gi, 1);
      if (g.refreshGroundCell) g.refreshGroundCell(lx, ly);
      placed = null;
    }

    return {
      ok: true, missed, itemId, count, target: { x: lx, y: ly },
      // 340846-340864：源码按 `var_2518` 播「X は Y を投げた」/「X は Y を浴びた」
      verb: selfPour ? 'pour' : 'throw',
      placed, effect, skill, food, hit, ground, special: spec,
      groundSpecial: groundSpec, messages,
    };
  }

  /** 自动寻找最近的敌对目标（*label_2841 的简化：距离最近 + 有视线） */
  function nearestEnemy(g, c, maxDist) {
    let best = null, bd = 1e9;
    for (const t of g.charas || []) {
      if (!t || t === c || t.get(0) !== 1) continue;
      if (t.get(9) >= 0) continue;                 // 非敌对
      const d = dist(c.x, c.y, t.x, t.y);
      if (d > (maxDist || 20) || d >= bd) continue;
      if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, c.x, c.y, t.x, t.y)) continue;
      best = t; bd = d;
    }
    return best;
  }

  Elona.Throw = { canThrow, canLand, throwItem, nearestEnemy,
    capture, captureLittle, vanquish, charaAt, dist,
    specialHit, specialGround, createGround, cicadaBait };
})(window);
