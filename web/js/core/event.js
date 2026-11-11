'use strict';
/**
 * 事件队列（evadd / evid / evfind）—— 对应 start.hsp 6462-6477、6447-6461、603050-603060。
 *
 * 【已确认 语义】
 *   evadd(id, a, b) ：把事件压入队列尾部；绘制/事件处理前插一条时（var_109）插到尾部前一位。
 *   evid()          ：返回队尾事件 id；空队列返回 -1。
 *   evfind(id)      ：队列中是否存在该 id。
 *   主循环 603050-603060：`if (var_106 != 0) { gosub *label_4376; var_106--; var_107(var_106)=0; }`
 *     —— 每回合处理**队尾一条**事件（LIFO）。
 *
 * 【已移植的事件】
 *   21：mef 类型 7 删除时的粒子动画（32265-32267 → *label_4376 209864-209928）。
 *       本项目用 `game.effects` 的粒子效果近似，不播放音效/不使用 anime16.bmp。
 *   17 个事件有手写 handler（12/21/22/38/45-49/52-54/56/57/63/68/79），
 *   其余 82 个由 0-GJ 的整表脚本解释器执行：
 *     `tools/extract_events.py` 把 606723-611941 的 99 个分支编译成
 *     `web/data/tables/events.json`，`Event.runScript` 按 op 表推进任务状态、
 *     生成角色/物品、进入对话、切 BGM 并播放台词；求不出的条件保守跳过。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const handlers = {
    /** 事件 21：粒子飞散（mef 类型 7 被删除时）。用 renderer 的效果层表现。 */
    21(g, a, b) {
      if (g && typeof g.addParticles === 'function') g.addParticles(a, b);
      return { handled: true, particles: true };
    },
    /**
     * 事件 12：ペットとの再会（608161-608200）
     *   选项 犬(165) / 猫(164) / クマ(108) / 少女(166)，等级 = limit(玩家等级×2/3+1, 1, 50)。
     *   触发：首次进入 Vernis（地图 5，var_65(250+7)==0 → 置 1 后 evadd 12，247786-247795）；
     *         许愿「仲間/friend/company/ally」（288090-288092）。
     */
    12(g) {
      if (Elona.Panels && Elona.Panels.openPetReunion) {
        Elona.Panels.openPetReunion(g, 'pet');
        return { handled: true, ui: 'pet-reunion' };
      }
      return { handled: false };
    },
    /**
     * 事件 38：「隠れていたもの」（608095-608158）—— 许愿「隠しキャラ/隐藏角色」时触发，
     *   选项 妹/お嬢様/姉/少女/少年/弟/執事/兄，对应生物 436/485/493/494/963/921/965/922。
     */
    38(g) {
      if (Elona.Panels && Elona.Panels.openPetReunion) {
        Elona.Panels.openPetReunion(g, 'family');
        return { handled: true, ui: 'family-reunion' };
      }
      return { handled: false };
    },
    /**
     * 0-GI：事件 57（608068-608083）—— 生成向导诺伦（物种 605）并立刻对话。
     *   608069 `characreate -1, 605, var_58(1,0), var_58(2,0)`（玩家脚下）
     *   608071 地图 70 → `var_131 = 116`（BGM 曲号，交给 `*label_0069`）
     *   608075 `gosub *label_3031`：说话方式 1/2（`var_58(188)`）+ 进入对话
     */
    57(g) {
      const p = g && g.player;
      if (!p) return { handled: false };
      const C = Elona.CharaFactory;
      const c = (C && C.create) ? C.create(g, 605, Math.max(1, p.level | 0), p.x | 0, p.y | 0) : null;
      if (g.setV65 && g.getV65 && (g.getV65(20) | 0) === 70) g.setV65(131, 116);
      if (!c) return { handled: false, reason: 'create-failed', species: 605 };
      // *label_3031 的头部：var_58(188) 未设定时按 var_58(8) 取 1 或 2
      if (!(c.get(188) | 0)) c.set(188, (c.get(8) | 0) === 0 ? 1 : 2);
      if (Elona.Dialogue && typeof Elona.Dialogue.start === 'function') {
        try {
          Elona.Dialogue.start(g, c);
          return { handled: true, ui: 'dialogue', chara: c, species: 605 };
        } catch (e) { /* 对话系统未就绪 → 只生成 */ }
      }
      return { handled: true, chara: c, species: 605 };
    },

    // ---- 0-GI：地图事件批次（警报 / 固定 NPC / 消失 / BGM） ----
    /**
     * 22（611877-611902）：警报 —— 除 606 号与任务目标外，全场 NPC 转为敌对。
     *   611879 事件参数 x == 0 时触发
     *   611884 `var_58(9) = -3`（敌对）、`var_58(29) = 0`、`var_58(201) = 250`（行动延迟）
     */
    22(g, a) {
      if (!g || (a | 0) !== 0) return { handled: false };
      if (g.log) g.log('刺耳的警报响彻四周！');
      let n = 0;
      for (const c of (g.charas || [])) {
        if (!c || (c.get(0) | 0) !== 1) continue;
        if ((c.get(27) | 0) === 606) continue;
        if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 992)) continue;
        c.set(9, -3); c.set(29, 0); c.set(201, 250);
        n++;
      }
      return { handled: true, hostiles: n };
    },
    /**
     * 68（610070-610078）：让角色从场上消失（`var_58(50)=0` → dmghp 10 → 清 150/0）。
     */
    68(g, a) {
      const c = g && g.charas ? g.charas[a | 0] : null;
      if (!c || (c.get(0) | 0) !== 1) return { handled: false };
      c.set(50, 0);
      if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(c, 10, g, null, 0, 0);
      else c.hp = 0;
      c.set(150, 0);
      if (Elona.Battle && Elona.Battle.onDeath) Elona.Battle.onDeath(g, c, null);
      else c.set((Elona.ATTR && Elona.ATTR.ACTIVE) || 0, 0);
      return { handled: true, vanished: true };
    },
    /**
     * 63（610983-611049）：按地图放置固定 NPC（角色 150=3 表示「固定居民」）。
     *   79 → 1024 @(20,8)；54 → 382 @(41,9) + 383 @(8,7)；其余地图见源码后续分支。
     */
    63(g) {
      if (!g || !g.getV65 || !Elona.CharaFactory) return { handled: false };
      const mapId = g.getV65(20) | 0;
      const TABLE = {
        79: [[1024, 20, 8, 3]],
        54: [[382, 41, 9, 3], [383, 8, 7, 3]],
      };
      const list = TABLE[mapId];
      if (!list) return { handled: false, mapId };
      for (const [sp, x, y, role] of list) {
        const c = Elona.CharaFactory.create(g, sp, 1, x, y);
        if (c) { c.set(150, role); if (c.set) c.set(202, 3); }
      }
      return { handled: true, spawned: list.length, mapId };
    },
    /**
     * 56（611050-611086）：按任务标记 `var_65(250+298)` 切 BGM（曲号写 `var_131`）。
     */
    56(g) {
      if (!g || !g.getV65) return { handled: false };
      const BGM = { 0: 138, 1: 62, 2: 79, 3: 111 };
      const v = g.getV65(298) | 0;
      const id = BGM[v];
      if (!id) return { handled: false, flag: v };
      if (g.setV65) g.setV65(131, id);
      return { handled: true, bgm: id, flag: v };
    },

    // ---- 0-GF：被击倒的怪物想成为同伴（608214-608490 / 200086-200160） ----
    45: (g, a, b, extra) => Event.recruit(g, 45, a, b, extra),
    46: (g, a, b, extra) => Event.recruit(g, 46, a, b, extra),
    47: (g, a, b, extra) => Event.recruit(g, 47, a, b, extra),
    48: (g, a, b, extra) => Event.recruit(g, 48, a, b, extra),
    49: (g, a, b, extra) => Event.recruit(g, 49, a, b, extra),
    52: (g, a, b, extra) => Event.recruit(g, 52, a, b, extra),
    53: (g, a, b, extra) => Event.recruit(g, 53, a, b, extra),
    54: (g, a, b, extra) => Event.recruit(g, 54, a, b, extra),
    79: (g, a, b, extra) => Event.recruit(g, 79, a, b, extra),
  };

  /**
   * 0-GF：「倒した○○が起き上がり仲間になりたそうにこちらを見ている」
   *   事件 52/53/45/54/46/47/48/79/49 共用一个流程（608214-608490）：
   *     txt_select 二选一（y = var_393 / n = var_394）→
   *     选 n：`「あなたは○○にトドメを刺した。」` 后 goto *label_4377；
   *     选 y：`flt` + `characreate -1, <物种>, var_110(玩家x), var_111(玩家y)` + `gosub *label_4274`（入队）。
   *   触发点 200086-200160：`var_58(27, 死者)` 命中下表、`死者 index > 16`、
   *   `get_freeally() != 0` 时 `evadd <事件>, x, y`。
   */
  const RECRUIT = {
    52: { sp: 25, name: '兽人', q: '被打倒的兽人站了起来，似乎想成为同伴。要收为同伴吗？', kill: '你给了兽人致命一击。' },
    53: { sp: 26, name: '科学家', q: '被打倒的科学家站了起来，似乎想成为同伴。要收为同伴吗？', kill: '你给了科学家致命一击。' },
    45: { sp: 27, name: '堕天使', q: '被打倒的堕天使站了起来，似乎想成为同伴。要收为同伴吗？', kill: '你给了堕天使致命一击。' },
    54: { sp: 32, name: '地下城清洁工', q: '被打倒的地下城清洁工站了起来，似乎想成为同伴。要收为同伴吗？', kill: '你给了地下城清洁工致命一击。' },
    46: { sp: 384, name: '白虎', q: '被打倒的白虎站了起来，似乎想成为同伴。要收为同伴吗？', kill: '你给了白虎致命一击。' },
    47: { sp: 385, name: '骑士', q: '被打倒的骑士站了起来，似乎想成为同伴。要收为同伴吗？', kill: '你给了骑士致命一击。' },
    48: { sp: 421, name: '蜗牛', q: '被打倒的蜗牛站了起来，似乎想成为同伴。要收为同伴吗？', kill: '你给了蜗牛致命一击。' },
    79: { sp: 938, name: '龙', q: '被打倒的龙站了起来，似乎想成为同伴。要收为同伴吗？', kill: '你给了龙致命一击。' },
    49: { sp: 492, name: '狗', q: '被打倒的狗站了起来，似乎想成为同伴。要收为同伴吗？', kill: '你给了狗致命一击。', yes: '今后也请多关照……' },
  };

  /** 物种 → 事件号（200093-200160 的 if 链；32 还要排除 var_58(150)==3） */
  const RECRUIT_BY_SPECIES = {
    25: 52, 26: 53, 27: 45, 32: 54, 384: 46, 385: 47, 421: 48, 492: 49, 938: 79,
  };

  // ==========================================================================
  // 0-GJ：`*label_4376` 事件脚本解释器（606723-611941）
  //
  //   99 个 `var_1302 == N | var_1303` 分支已由 tools/extract_events.py 编译成
  //   web/data/tables/events.json。手写 handler（上面 17 个）优先；没有 handhandler
  //   的事件由 runScript 按 op 表执行。
  //
  //   忠实性约定：
  //     · `var_65(250+2)` 是主任务状态，`var_65(20)` 是当前地图；
  //     · 条件表达式只求可判定的（任务/地图/角色下标/角色字段），
  //       含 rnd()、stat 或未知局部变量的求不出 → **保守跳过该 op**，绝不臆测；
  //     · `raw` op 只记录原语句，不执行；
  //     · `txt_select` 台词保留原版英文/日文，可用 `Elona.EventText[jp]` 覆盖为中文。
  // ==========================================================================

  /** 事件表：浏览器走预加载缓存，node 测试可直接注入 Elona.EventData */
  function eventsTable() {
    if (Elona.EventData && Elona.EventData.events) return Elona.EventData;
    if (Elona.Data && Elona.Data.tableSync) {
      const t = Elona.Data.tableSync('events');
      if (t && t.events) return t;
    }
    return null;
  }

  /** findchara：返回角色下标（0 = 没找到，与 HSP 一致） */
  function findChara(g, sp, mode) {
    if (!g || !g.charas || sp === undefined || sp === null) return 0;
    const list = g.charas;
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(27) | 0) === (sp | 0)) return i;
      // findunique / findcharawork 的项目近似：用角色 150（职务）与 7（图像）兜底
      if (mode === 'findunique' && (c.get(150) | 0) === (sp | 0)) return i;
      if (mode === 'findcharawork' && (c.get(7) | 0) === (sp | 0)) return i;
    }
    return 0;
  }

  /** op 里的引用目标 → 角色对象 */
  function charaOf(g, ctx, t) {
    if (t === undefined || t === null) return null;
    if (typeof t === 'number') return findChara(g, t) ? g.charas[findChara(g, t)] : null;
    const s = String(t);
    if (s === '0' || s === 'var_58(1, 0)') return g && g.player;
    if (s === 'var_244' || s === '244') {
      const i = ctx.v244 | 0;
      return (g && g.charas && i > 0) ? g.charas[i] : null;
    }
    if (s === 'var_581' || s === '581' || s === 'var_2853') return ctx.last;
    return null;
  }

  /** 数值操作数求值；解不出的表达式返回 0 并标记 unknown */
  function valueOf(g, ctx, v) {
    if (typeof v === 'number') return v;
    if (!v || typeof v !== 'object') return 0;
    if (v.ref === 'px') return (g && g.player && g.player.x) | 0;
    if (v.ref === 'py') return (g && g.player && g.player.y) | 0;
    if (v.v58 !== undefined) {
      const f = v.v58 | 0, t = String(v.t || '0');
      if (t === '0') {
        const p = g && g.player;
        if (f === 1) return (p && p.x) | 0;
        if (f === 2) return (p && p.y) | 0;
      }
      const c = charaOf(g, ctx, t === '0' ? '0' : t);
      return c ? (c.get(f) | 0) : 0;
    }
    if (v.expr !== undefined) {
      if (/^-?\d+$/.test(v.expr)) return parseInt(v.expr, 10);
      ctx.unknownValue++;
      return 0;
    }
    return 0;
  }

  const RE_C_V65 = /^var_65\((\d+)(?:\s*\+\s*(\d+))?\)\s*(==|!=|>=|<=|>|<)\s*(-?\d+)$/;
  const RE_C_FIND = /^findchara\((\d+)\)\s*(==|!=|>=|<=|>|<)\s*(-?\d+)$/;
  const RE_C_CF = /^var_58\((\d+),\s*(\w+)\)\s*(==|!=|>=|<=|>|<)\s*(-?\d+)$/;
  const RE_C_244 = /^var_244\s*(==|!=|>=|<=|>|<)\s*(-?\d+)$/;

  function compare(l, op, r) {
    switch (op) {
      case '==': return l === r;
      case '!=': return l !== r;
      case '>=': return l >= r;
      case '<=': return l <= r;
      case '>': return l > r;
      case '<': return l < r;
      default: return null;
    }
  }

  /** 条件求值：true / false / null（未知 → 调用方跳过） */
  function evalCond(g, ctx, expr) {
    let s = String(expr || '').trim();
    if (!s) return null;
    if (s.startsWith('not(') && s.endsWith(')')) {
      const v = evalCond(g, ctx, s.slice(4, -1));
      return v === null ? null : !v;
    }
    // `&` / `|` 复合条件：逐项求值，任一未知即未知
    for (const [sep, isAnd] of [['&', true], ['|', false]]) {
      if (s.indexOf(sep) >= 0) {
        const parts = s.split(sep).map((x) => x.trim());
        let acc = isAnd, unknown = false;
        for (const p of parts) {
          const v = evalCond(g, ctx, p);
          if (v === null) { unknown = true; break; }
          acc = isAnd ? (acc && v) : (acc || v);
        }
        if (unknown) return null;
        return acc;
      }
    }
    let m = RE_C_V65.exec(s);
    if (m) {
      const i = (m[1] | 0) + (m[2] | 0);
      const l = g && g.getV65 ? (g.getV65(i) | 0) : 0;
      return compare(l, m[3], parseInt(m[4], 10));
    }
    m = RE_C_FIND.exec(s);
    if (m) return compare(findChara(g, m[1] | 0), m[2], parseInt(m[3], 10));
    m = RE_C_244.exec(s);
    if (m) return compare(ctx.v244 | 0, m[1], parseInt(m[2], 10));
    m = RE_C_CF.exec(s);
    if (m) {
      const c = charaOf(g, ctx, m[2]);
      if (!c) return null;
      return compare(c.get(m[1] | 0) | 0, m[3], parseInt(m[4], 10));
    }
    // `var_65(N)` 单独作真值
    m = /^var_65\((\d+)(?:\s*\+\s*(\d+))?\)$/.exec(s);
    if (m) {
      const i = (m[1] | 0) + (m[2] | 0);
      return !!(g && g.getV65 ? (g.getV65(i) | 0) : 0);
    }
    return null;                                  // rnd()/stat/未知局部变量
  }

  /** 台词：中文覆盖表 → 原版英文 → 日文原文 */
  function textOf(op) {
    const zh = Elona.EventText && Elona.EventText[op.jp];
    if (zh) return zh;
    if (op.en && !/untranslated sentence/i.test(op.en)) return op.en;
    return op.jp || '';
  }

  /**
   * 执行一个事件的 op 脚本。
   * @returns {object|null} null 表示没有该事件的数据（交给调用方按未处理算）
   */
  function runScript(g, eid, a, b, extra) {
    const table = eventsTable();
    if (!table) return null;
    const ev = table.events.find((e) => e.id === (eid | 0));
    if (!ev) return null;

    const ctx = {
      v244: 0, last: null, bgm: 0, talkMode: 0,
      a: a | 0, b: b | 0, level: (extra && extra.level) | 0,
      unknownValue: 0,
    };
    const out = {
      handled: true, event: eid | 0, source: ev.line,
      ops: ev.ops.length, done: 0, skippedCond: 0, unknownCond: 0, raw: 0,
      lines: [], sounds: [], spawned: [], items: [], gosubs: [], cards: 0,
    };

    const V = (v) => valueOf(g, ctx, v);
    const I = (v) => (typeof v === 'number' ? v : (v && v.expr !== undefined ? 0 : V(v)));

    // HSP 的 `if (...) {` 只在进入块时判一次，块内状态变化不影响本块后续语句。
    // 因此按「条件栈路径」缓存求值：同一路径连续出现时复用，路径变化才重新判。
    const condCache = [];                 // [{expr, val}] 当前活跃 if 栈
    for (const op of ev.ops) {
      const conds = op.cond || [];
      let L = 0;
      while (L < condCache.length && L < conds.length && condCache[L].expr === conds[L]) L++;
      condCache.length = L;              // 退出已结束的块
      for (let i = L; i < conds.length; i++) {
        const r = evalCond(g, ctx, conds[i]);
        condCache.push({ expr: conds[i], val: r });
        if (r === null) out.unknownCond++;
        else if (!r) out.skippedCond++;
      }
      if (!condCache.every((x) => x.val === true)) continue;
      if (op.k === 'raw') { out.raw++; continue; }
      if (op.k === 'skip') { out.skip = (out.skip | 0) + 1; continue; }
      out.done++;
      switch (op.k) {
        case 'v65': if (g && g.setV65) g.setV65(op.i | 0, op.v | 0); break;
        case 'v65add':
          if (g && g.setV65 && g.getV65) g.setV65(op.i | 0, (g.getV65(op.i | 0) | 0) + (op.v | 0));
          break;
        case 'v65div':
          if (g && g.setV65 && g.getV65) g.setV65(op.i | 0, Math.floor((g.getV65(op.i | 0) | 0) / Math.max(1, op.v | 0)));
          break;
        case 'find':
          ctx.v244 = findChara(g, I(op.sp), op.mode);
          ctx.last = ctx.v244 ? g.charas[ctx.v244] : null;
          break;
        case 'set244':
          ctx.v244 = /^\d+$/.test(String(op.v)) ? (op.v | 0) : 0;
          break;
        case 'spawn': {
          const C = Elona.CharaFactory;
          if (!C || !C.create) break;
          const sp = I(op.sp);
          if (!sp) { ctx.unknownValue++; break; }
          const lv = Math.max(1, ctx.level || ((g && g.player && g.player.level) | 0) || 1);
          const c = C.create(g, sp, lv, V(op.x), V(op.y));
          if (c) {
            ctx.last = c;
            if (c.index !== undefined) ctx.v244 = c.index | 0;
            out.spawned.push(sp);
          }
          break;
        }
        case 'cf': {
          const c = charaOf(g, ctx, op.t);
          if (c && c.set) c.set(op.f | 0, V(op.v));
          break;
        }
        case 'vanquish': {
          const t = op.find ? findChara(g, op.t | 0) : op.t;
          const c = typeof t === 'number' ? ((g && g.charas && t > 0) ? g.charas[t] : null)
            : charaOf(g, ctx, t);
          if (c) { c.set(0, 0); c.set(50, 0); }
          if (g && g.syncCharaCells) g.syncCharaCells();
          break;
        }
        case 'talkMode': ctx.talkMode = op.v | 0; break;
        case 'talk': {
          const c = charaOf(g, ctx, 'var_244') || ctx.last;
          if (!c) break;
          if (ctx.talkMode && c.set) c.set(188, ctx.talkMode | 0);
          if (Elona.Dialogue && typeof Elona.Dialogue.start === 'function') {
            try { Elona.Dialogue.start(g, c); out.dialogue = true; } catch (e) { /* 未就绪 */ }
          }
          break;
        }
        case 'bgm':
          ctx.bgm = op.id | 0;
          if (g && g.setV65) g.setV65(131, op.id | 0);
          break;
        case 'playBgm':
          if (g && g.setV65) g.setV65(131, ctx.bgm | 0);
          out.bgm = ctx.bgm | 0;
          break;
        case 'snd': out.sounds.push(op.id | 0); break;
        case 'card': out.cards++; break;
        case 'gosub':
          out.gosubs.push(op.label | 0);
          // *label_4274：把刚生成的角色收为同伴（608242 / 608473 同一入口）
          if ((op.label | 0) === 4274 && ctx.last && Elona.Party && Elona.Party.joinChara) {
            try { Elona.Party.joinChara(g, ctx.last); out.joined = true; } catch (e) { /* noop */ }
          }
          // *label_4293（591368-591468）：地图达成 / 委托完成的统一结算（事件 8）
          if ((op.label | 0) === 4293 && Elona.QuestCheck && Elona.QuestCheck.onMapCleared) {
            try { out.cleared = Elona.QuestCheck.onMapCleared(g); } catch (e) { /* noop */ }
          }
          break;
        case 'skillexp': {
          const c = charaOf(g, ctx, op.t) || (g && g.player);
          if (c && Elona.Stats && typeof Elona.Stats.skillExp === 'function') {
            try { Elona.Stats.skillExp(c, op.skill | 0, c, op.v | 0, 1, 0, g); } catch (e) { /* noop */ }
          }
          break;
        }
        case 'item': {
          const L = Elona.Loot, DB = Elona.ItemDB;
          const x = V(op.x), y = V(op.y), n = Math.max(1, V(op.n) || 1);
          const id = I(op.id);
          if (id === 0 && L && L.spawnRandom) {
            const it = L.spawnRandom(g, x, y, 0);
            if (it) out.items.push(it.id | 0);
          } else if (id > 0 && L && L.spawnItem) {
            const it = L.spawnItem(g, id, x, y, { cnt: n });
            if (it) out.items.push(id);
          } else if (id > 0 && DB && DB.create) {
            const it = DB.create(g, { itemId: id });
            if (it) { it.f[5] = x; it.f[6] = y; (g.groundItems = g.groundItems || []).push(it); out.items.push(id); }
          }
          break;
        }
        case 'text': {
          const line = textOf(op);
          if (line) { out.lines.push(line); if (g && typeof g.log === 'function') g.log(line); }
          break;
        }
        case 'return': return out;
        default: break;
      }
    }
    out.unknownValue = ctx.unknownValue;
    return out;
  }

  const Event = {
    handlers,
    RECRUIT,
    RECRUIT_BY_SPECIES,
    runScript,
    eventsTable,
    evalCond,

    /**
     * 打开二选一（有 UI 时）。没有 UI 时返回 `needsChoice`，由调用方/测试
     * 用 `recruitResolve` 直接决定结果。
     */
    recruit(g, eid, x, y, extra) {
      const spec = RECRUIT[eid];
      if (!spec) return { handled: false };
      const P = Elona.Panels;
      if (P && typeof P.openConfirm === 'function') {
        P.openConfirm(spec.q, (yes) => { Event.recruitResolve(g, eid, yes, x, y, extra); },
          { title: '仲間にする？' });
        return { handled: true, ui: 'recruit', event: eid, species: spec.sp };
      }
      return { handled: false, needsChoice: true, event: eid, species: spec.sp, text: spec.q };
    },

    /**
     * 二选一的结果。
     *   608218 选 n → 「トドメを刺した」；
     *   608242 选 y → 在**玩家脚下**生成该物种（`var_110/111`）+ `*label_4274` 入队。
     * @param {boolean} yes
     * @param {object} [extra] { level } —— 由 queueRecruit 记下的死者等级
     */
    recruitResolve(g, eid, yes, x, y, extra) {
      const spec = RECRUIT[eid];
      if (!spec || !g) return { ok: false, reason: 'bad-event' };
      if (!yes) {
        if (typeof g.log === 'function') g.log(spec.kill);
        return { ok: true, killed: true, event: eid };
      }
      const px = (g.player && g.player.x !== undefined) ? g.player.x : x;
      const py = (g.player && g.player.y !== undefined) ? g.player.y : y;
      const lv = Math.max(1, (extra && (extra.level | 0)) || 1);
      const C = Elona.CharaFactory;
      const c = (C && C.create) ? C.create(g, spec.sp, lv, px, py) : null;
      if (!c) return { ok: false, reason: 'create-failed', event: eid, species: spec.sp };
      if (spec.yes && typeof g.log === 'function') g.log(spec.yes);
      const r = (Elona.Party && Elona.Party.joinChara)
        ? Elona.Party.joinChara(g, c) : { ok: false, reason: 'no-party' };
      if (typeof g.log === 'function' && r && r.message) g.log(r.message);
      return { ok: !!(r && r.ok), chara: c, join: r, event: eid, species: spec.sp };
    },
  };

  class EventQueue {
    constructor() {
      this.q = [];
      this.insertBeforeTail = false;   // var_109：绘制期间插入
    }

    /** evadd；`extra` 只在本进程内传递（存档不保留，事件一般当回合就处理掉） */
    add(id, a, b, extra) {
      const e = [id | 0, a === undefined ? 0 : (a | 0), b === undefined ? 0 : (b | 0)];
      if (extra !== undefined) e[3] = extra;
      if (this.insertBeforeTail && this.q.length > 0) this.q.splice(this.q.length - 1, 0, e);
      else this.q.push(e);
      return this.q.length;
    }

    /** evid */
    id() { return this.q.length ? this.q[this.q.length - 1][0] : -1; }

    /** evfind */
    find(id) { return this.q.some((e) => e[0] === id); }

    size() { return this.q.length; }

    /**
     * 每回合处理队尾一条（603050-603060）。
     * @returns {object|null} {id,a,b,handled,result}
     */
    process(g) {
      if (!this.q.length) return null;
      const e = this.q.pop();
      const fn = handlers[e[0]];
      let result = null;
      if (fn) result = fn(g, e[1], e[2], e[3]);
      else result = Event.runScript(g, e[0], e[1], e[2], e[3]);   // 0-GJ 整表脚本
      return { id: e[0], a: e[1], b: e[2], handled: !!(result && result.handled), result };
    }

    clear() { this.q.length = 0; }
    toJSON() { return { q: this.q }; }
    static fromJSON(o) {
      const q = new EventQueue();
      if (o && Array.isArray(o.q)) q.q = o.q.map((e) => [e[0] | 0, e[1] | 0, e[2] | 0]);
      return q;
    }
  }

  Elona.EventQueue = EventQueue;
  Elona.Event = Object.assign(Event, { add: null });
})(window);
