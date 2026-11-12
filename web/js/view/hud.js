'use strict';
/**
 * HUD 扩展层 —— 时钟 / 技能监视 / 法术状态 / 角色数据条 / 小地图 / 消息栏
 *
 * 【来源说明】
 *   本模块按用户提供的 ElonaPlus 1.85 界面说明复刻主界面的信息面板：
 *     · 视野左上角：模拟时钟 + 日期 + 天气 + 地城狂热
 *     · 视野左侧：技能监视（主属性 / 速度 / DV·PV 的数值与变动）
 *     · 视野左下角：异常状态列表
 *     · 视野右下角：法术状态（buff 图标 + 剩余回合）
 *     · 角色贴图底部：HP / MP / 斗志 三条数据条（默认只显示最后攻击对象；
 *       持有「聴診器」(物品 478) 时友好角色也会显示）
 *     · 消息栏左侧：小地图（粗略显示地形的可通行情况）
 *     · 消息栏：可展开到 5 倍高度；每条角色行动的第一条消息前显示分钟数
 *
 *   注意：2.33R 的 start.hsp 里**没有**时钟面、技能监视、buff 图标栏这些控件
 *   （界面只有 *label_2101 的 800×600 布局），它们是 1.85/附带 UI 扩展的表现层。
 *   因此本模块属于「按用户要求的界面增强」，只读游戏状态、不改任何规则；
 *   数据槽位（var_65(13/14/11/12)、var_58(280+3n) 等）全部沿用源码语义。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const UI_W = 800, UI_H = 600, UI_TOP = UI_H - 88;   // 512
  const FONT = (px) => px + 'px "Courier New", "MS Gothic", "Microsoft YaHei", monospace';

  const COL = {
    frame: 'rgba(14,12,9,0.86)',
    edge: 'rgba(206,190,140,0.85)',
    text: '#f4eeda',
    dim: '#b6ad96',
    head: '#ffe9a8',
    up: 'rgb(120,235,130)',
    down: 'rgb(245,120,120)',
    hp: 'rgb(196,32,32)',
    mp: 'rgb(48,96,208)',
    mor: 'rgb(224,176,48)',
    sp: 'rgb(120,200,120)',
  };

  /** 8 项主属性（var_82(10..17)） */
  const ATTRS = [10, 11, 12, 13, 14, 15, 16, 17];
  const ATTR_NAMES = ['筋力', '耐久', '器用', '感覚', '習得', '意志', '魔力', '魅力'];

  /** 12 项耐性（var_82(50..61)）：4 列 × 3 行 */
  const RESISTS = [
    [50, '火'], [51, '冷'], [52, '電'], [53, '闇'],
    [54, '幻'], [55, '毒'], [56, '獄'], [57, '音'],
    [58, '神'], [59, '混'], [60, '魔'], [61, '血'],
  ];

  /** 界面选项（可切换） */
  const opts = {
    skillMonitor: false,     // 技能监视面板（原版默认不显示，需在人物信息窗按「,」锁定）
    msgExpand: 0,            // 消息栏额外展开行数（0 / 4 / 8 / 12 / 16 = 最多 5 倍）
  };
  const MSG_BASE_LINES = 4;

  /**
   * 0-DF：左侧「监视」列表 —— 只有玩家在人物信息窗（c 键）里按「,」锁定的条目才显示。
   * 元素：{ kind: 'attr'|'skill'|'resist'|'spell', id, label }
   * 原版顺序 = 锁定顺序（后锁的排在后面）。
   */
  const watch = [];
  const WATCH_MAX = 24;

  function watchKey(kind, id) { return kind + ':' + (id | 0); }
  function isWatched(kind, id) {
    const k = watchKey(kind, id);
    return watch.some((w) => w.key === k);
  }
  /** 切换锁定，返回 true = 现在已锁定 */
  function toggleWatch(kind, id, label) {
    const k = watchKey(kind, id);
    const i = watch.findIndex((w) => w.key === k);
    if (i >= 0) { watch.splice(i, 1); return false; }
    if (watch.length >= WATCH_MAX) return false;
    watch.push({ key: k, kind, id: id | 0, label: label || String(id) });
    return true;
  }
  function clearWatch() { watch.length = 0; }

  let BUFF_NAMES = null;     // { id: {jp,en} }
  const prevSkill = {};      // 上一帧的技能值快照，用于显示 ▲▼ 变动
  const delta = {};          // key → { d, ttl }（ttl 按「回合」递减，不按帧）
  let lastTurn = -1;         // 上次递减 ttl 时的回合

  // ---------------------------------------------------------------- 数据
  async function loadNames() {
    if (BUFF_NAMES) return BUFF_NAMES;
    try { BUFF_NAMES = await Elona.Data.table('buffnames'); } catch (e) { BUFF_NAMES = {}; }
    return BUFF_NAMES;
  }
  function setNames(t) { BUFF_NAMES = t || {}; }
  function buffName(id) {
    const e = BUFF_NAMES && BUFF_NAMES[String(id)];
    return e ? e.jp : ('#' + id);
  }

  /** 活跃 buff 列表 var_58(280 + 3n) / +1 强度 / +2 剩余回合 */
  function activeBuffs(c) {
    const out = [];
    if (!c) return out;
    for (let i = 0; i < 16; i++) {
      const id = c.get(280 + i * 3) | 0;
      if (!id) continue;
      const p1 = c.get(280 + i * 3 + 1) | 0;
      const p2 = c.get(280 + i * 3 + 2) | 0;
      if (p2 <= 0) continue;
      out.push({ id, power: p1, turns: p2 });
    }
    return out;
  }

  /** 异常状态列表（status.json 的 conditions：field + jp） */
  function statusList(c) {
    const out = [];
    const T = Elona.Status && Elona.Status.table;
    if (!T || !c) return out;
    for (const k in T) {
      const e = T[k];
      const f = e.field | 0;
      if (!f) continue;
      const v = c.get(f) | 0;
      if (v === 0) continue;
      // 麻痺归零后置 -1 是「已解除」的标记
      if ((k | 0) === 3 && v < 0) continue;
      out.push({ id: k | 0, name: e.jp || e.en || ('#' + k), value: v });
    }
    // 强度高的排前面，便于注意
    out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return out;
  }

  // ---------------------------------------------------------------- 绘制工具
  function panel(ctx, x, y, w, h, radius) {
    const r = radius === undefined ? 4 : radius;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = COL.frame;
    ctx.fill();
    ctx.strokeStyle = COL.edge;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function line(ctx, x1, y1, x2, y2, color, w) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = w || 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- 时钟
  /**
   * 视野左上角的模拟时钟 + 日期 / 天气 / 地城狂热。
   *   小时 = var_65(13)，分钟 = var_65(14)，年 = var_65(10)，
   *   月 = var_65(11)，日 = var_65(12)。
   */
  function drawClock(rd, game) {
    const ctx = rd.ctx;
    const cx = 36, cy = 36, r = 28;
    const hour = game.getV65(13) | 0;
    const minute = game.getV65(14) | 0;

    ctx.save();
    // 底板（保证日期文字在任何地形上都清晰）
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(2, 2, 148, 62, 6); else ctx.rect(2, 2, 148, 62);
    ctx.fillStyle = 'rgba(14,12,9,0.72)';
    ctx.fill();
    // 表盘
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30,26,20,0.86)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COL.edge;
    ctx.stroke();
    // 12 个刻度（每 3 格加粗）
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const big = (i % 3) === 0;
      const r1 = r - (big ? 8 : 5), r2 = r - 2;
      line(ctx, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1,
        cx + Math.cos(a) * r2, cy + Math.sin(a) * r2,
        big ? 'rgba(240,228,186,0.95)' : 'rgba(220,208,170,0.6)', big ? 2 : 1);
    }
    // 时针 / 分针
    const ha = (((hour % 12) + minute / 60) / 12) * Math.PI * 2 - Math.PI / 2;
    const ma = (minute / 60) * Math.PI * 2 - Math.PI / 2;
    line(ctx, cx, cy, cx + Math.cos(ha) * (r - 12), cy + Math.sin(ha) * (r - 12), 'rgb(252,244,216)', 4);
    line(ctx, cx, cy, cx + Math.cos(ma) * (r - 5), cy + Math.sin(ma) * (r - 5), 'rgb(190,210,255)', 2);
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(250,244,214)';
    ctx.fill();
    ctx.restore();

    // 日期 / 天气 / 狂热
    const date = `${game.getV65(10) | 0}/${game.getV65(11) | 0}/${game.getV65(12) | 0}`;
    ctx.font = FONT(11);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const put = (s, y, color) => {
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillText(s, 69, y + 1);
      ctx.fillStyle = color;
      ctx.fillText(s, 68, y);
    };
    put(date, 6, COL.text);
    if (Elona.Weather && Elona.Weather.current) {
      const w = Elona.Weather.current(game) | 0;
      const nm = w !== 0 && Elona.Weather.name ? Elona.Weather.name(w) : '';
      // 天气颜色沿用源码的 var_272（淡色系），但在地图上要压一层描边才看得清
      if (nm) put(nm, 22, 'rgb(232,236,255)');
    }
    if (Elona.Daily && Elona.Daily.status) {
      const st = Elona.Daily.status(game);
      if (st && st.fever) put('地城狂熱', 38, 'rgb(240,140,90)');
    }
  }

  // ---------------------------------------------------------------- 监视列表
  /**
   * 视野左侧的「监视」列表（0-DF 重写）。
   *
   * 【原版行为】主属性 / 耐性 / 技能的数值**默认不显示**；玩家在人物信息窗
   *   （c 键）里把光标移到某项上按「,」锁定后，该项才会出现在视野左边缘。
   *   显示区没有底板/边框 —— 只有带 1px 黑描边的文字直接压在地图上，
   *   数值变动时右侧出现 ▲/▼。
   *
   * 【数据】kind：attr(10..17) / skill(100..399) / resist(50..61) / spell(法术库存下标)
   */
  function watchValue(game, w) {
    const p = game && game.player;
    if (!p) return null;
    if (w.kind === 'resist') {
      if (Elona.Resist && Elona.Resist.sorg) return Elona.Resist.sorg(p, w.id) | 0;
      return p.skill(w.id) | 0;
    }
    if (w.kind === 'spell') {
      const st = p.spellStock || [];
      return st[w.id] | 0;
    }
    return p.skill(w.id) | 0;
  }

  /** 带描边的文字（8 邻域黑边，保证在浅色地砖上也读得清；不加底板） */
  function strokeText(ctx, s, x, y, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        ctx.fillText(s, x + dx, y + dy);
      }
    }
    // 再压一层 1px 下方的实心黑边，低分辨率字体下更结实
    ctx.fillText(s, x, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  function drawWatch(rd, game) {
    if (!watch.length) return;
    const ctx = rd.ctx;
    const p = game.player;
    if (!p) return;
    const x = 6, y0 = 70, rowH = 15;
    ctx.save();
    ctx.font = FONT(12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const turn = game.turn | 0;
    const tick = (turn !== lastTurn);
    if (tick) lastTurn = turn;

    for (let i = 0; i < watch.length; i++) {
      const w = watch[i];
      const v = watchValue(game, w);
      if (v === null) continue;
      const key = w.key;
      const before = prevSkill[key];
      if (before !== undefined && before !== v) delta[key] = { d: v - before, ttl: 20 };
      prevSkill[key] = v;
      const ry = y0 + i * rowH;
      strokeText(ctx, w.label, x, ry, COL.text);
      const txt = String(v);
      ctx.textAlign = 'right';
      strokeText(ctx, txt, x + 106, ry, '#ffffff');
      ctx.textAlign = 'left';
      const d = delta[key];
      if (d && d.ttl > 0) {
        if (tick) d.ttl--;
        strokeText(ctx, d.d > 0 ? '▲' : '▼', x + 110, ry, d.d > 0 ? COL.up : COL.down);
      }
    }
    ctx.restore();
  }

  /** F2：临时显示全部主属性 + 速度 + DV/PV（调试用；默认关闭，锁定列表才是原版行为） */
  function drawSkillMonitor(rd, game) {
    if (!opts.skillMonitor) return;
    const ctx = rd.ctx;
    const p = game.player;
    if (!p) return;
    const x = 6, y0 = 70, rowH = 14;
    ctx.save();
    ctx.font = FONT(11);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const rowsList = [];
    for (let i = 0; i < 8; i++) rowsList.push([ATTR_NAMES[i], p.skill(ATTRS[i]) | 0]);
    rowsList.push(['速度', p.get(11) | 0]);
    const dvMul = (p.get(71) | 0) < 0 ? 100 : (p.get(77) | 0);
    const pvMul = (p.get(70) | 0) < 0 ? 100 : (p.get(76) | 0);
    rowsList.push(['DV', idiv((p.get(71) | 0) * dvMul, 100) + dvMul - 100]);
    rowsList.push(['PV', idiv(((p.get(70) | 0) + idiv(pvMul, 25)) * pvMul, 100)]);
    for (let i = 0; i < rowsList.length; i++) {
      const ry = y0 + i * rowH;
      strokeText(ctx, rowsList[i][0], x, ry, COL.dim);
      ctx.textAlign = 'right';
      strokeText(ctx, String(rowsList[i][1]), x + 108, ry, COL.text);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 法术状态
  /**
   * 视野右下角的「法术状态」——活跃 buff 的纵向列表，图标格 + 剩余回合。
   */
  /**
   * 法术状态（增益）—— 对应源码 203931-203952。
   *
   * 原版布局：从右下角起自下而上堆叠，每个 **32×32 图标**，
   *   起点 var_1268 = var_216 - 40（屏幕宽 - 40）、var_1269 = var_996 - 40（视野底 - 40）
   *   每格 var_1269 -= 32；剩余回合数画在图标内 (+2, +18)，白字 + 黑描边
   *   图标取自 item.bmp：id < 49 → (id*32, 1536)；id >= 49 → ((id-49)*32, 1568)
   *   最多 16 格（源码 repeat 8 + 8），遇到空槽即停。
   */
  const ICON_SIZE = 32;
  const ICON_ROW1_Y = 1536;
  const ICON_ROW2_Y = 1568;
  const ICON_PER_ROW = 49;

  function buffIconRect(id) {
    const i = id | 0;
    if (i <= 0) return null;
    if (i < ICON_PER_ROW) return { x: i * ICON_SIZE, y: ICON_ROW1_Y };
    return { x: (i - ICON_PER_ROW) * ICON_SIZE, y: ICON_ROW2_Y };
  }

  function drawBuffBox(rd, game) {
    const ctx = rd.ctx;
    const p = game && game.player;
    if (!p) return;
    const list = activeBuffs(p);
    if (!list.length) return;

    const sheet = rd.itemSheet;
    const x0 = UI_W - 40;
    let y0 = UI_TOP - 40;

    ctx.save();
    ctx.textBaseline = 'top';
    for (let i = 0; i < list.length && i < 16; i++) {
      const b = list[i];
      const r = buffIconRect(b.id);
      if (sheet && r && r.x + ICON_SIZE <= sheet.width && r.y + ICON_SIZE <= sheet.height) {
        ctx.drawImage(sheet, r.x, r.y, ICON_SIZE, ICON_SIZE, x0, y0, ICON_SIZE, ICON_SIZE);
      } else {
        // 图标缺失时的兜底：半透明格 + buff 编号
        ctx.fillStyle = 'rgba(30,28,22,0.85)';
        ctx.fillRect(x0, y0, ICON_SIZE, ICON_SIZE);
        ctx.strokeStyle = 'rgba(206,190,140,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, ICON_SIZE - 1, ICON_SIZE - 1);
        ctx.fillStyle = 'rgba(230,220,190,0.9)';
        ctx.font = FONT(10);
        ctx.textAlign = 'center';
        ctx.fillText(String(b.id), x0 + ICON_SIZE / 2, y0 + 10);
        ctx.textAlign = 'left';
      }
      // 剩余回合：源码 203945-203950（黑底 +1px，白字）
      const t = String(b.turns | 0);
      ctx.font = FONT(11);
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillText(t, x0 + 4, y0 + 20);
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillText(t, x0 + 3, y0 + 19);
      y0 -= ICON_SIZE;
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 异常状态
  /**
   * 异常状态文本行（视野左下角，自下而上）。
   * 与源码 203327+ 的顺序一致：饥饿 / 口渴 / 天气 / 以太病 之后追加各类状态异常。
   */
  function statusLines(game) {
    const p = game && game.player;
    const out = [];
    if (!p) return out;
    const FOOD = ['空腹', '空腹', '空腹', '空腹', '空腹', '', '', '', '', '', '満腹', '満腹', '満腹'];
    // 203395-203425 的 var_290 表（13 项：脱水 / 干燥 / 口渴 / 湿润 / 喝过头）
    const WATER = ['脱水症状', '干燥', '口渴！', '口渴', '口渴',
      '', '', '', '', '', '湿润', '湿润！', '喝过头'];
    const food = p.get(22) | 0;
    if (food >= 1000) {
      const t = FOOD[limit(idiv(food, 1000), 0, 12)];
      if (t) out.push({ text: t, color: food <= 4000 ? 'rgb(200,0,0)' : '#000' });
    } else out.push({ text: FOOD[0], color: 'rgb(250,0,0)' });
    const water = p.get(446) | 0;
    if (water >= 12000) {
      out.push({ text: WATER[12], color: 'rgb(0,0,90)' });        // 喝过头
    } else if (water >= 1000) {
      const t = WATER[limit(idiv(water, 1000), 0, 11)];
      if (t) out.push({ text: t, color: water <= 4000 ? 'rgb(200,0,0)' : 'rgb(0,0,90)' });
    } else out.push({ text: WATER[0], color: 'rgb(250,0,0)' });
    for (const s of statusList(p)) {
      out.push({ text: s.name, color: 'rgb(170,60,60)' });
    }
    return out;
  }

  // ---------------------------------------------------------------- 角色数据条
  /**
   * 角色贴图下方的 HP / MP / 斗志 三条。
   *   原版只显示「最后攻击过的对象」；持有「聴診器」(478) 时友好角色也可见。
   */
  function canInspect(game, c) {
    const idx = (c.index | 0);
    if (idx === 0) return true;
    if ((game.lastAttacked | 0) === idx) return true;
    const p = game.player;
    if (!p) return false;
    // 聴診器：var_657 == 59000 的器具类物品
    for (const it of (p.inv || [])) {
      if (!it || (it.id | 0) !== 478) continue;
      const rel = c.get(9) | 0;
      if (rel >= 0) return true;
    }
    return false;
  }

  function drawCharaBars(rd, game, startX, startY) {
    const ctx = rd.ctx;
    const TILE = 48;
    const list = [];
    for (const c of (game.charas || [])) {
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (!canInspect(game, c)) continue;
      // 视野外的角色不画血条（原版 var_58(6,c)=var_104，未看见则不进入绘制）
      if (game.map && game.map.isVisible && !game.map.isVisible(c.x, c.y)) continue;
      list.push(c);
    }
    for (const c of list) {
      const vx = (c.x - startX) * TILE;
      const vy = (c.y - startY) * TILE;
      if (vx < -TILE || vy < -TILE || vx > UI_W || vy > UI_TOP) continue;
      const hp = c.get(50) | 0, hpMax = Math.max(1, c.get(51) | 0);
      const mp = c.get(55) | 0, mpMax = Math.max(1, c.get(56) | 0);
      const w = 34;
      const bx = vx + (TILE - w) / 2;
      const by = vy + TILE - 9;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.66)';
      ctx.fillRect(bx - 1, by - 1, w + 2, 9);
      const bar = (yy, ratio, color) => {
        const ww = Math.round(limit(ratio, 0, 1) * w);
        if (ww <= 0) return;
        ctx.fillStyle = color;
        ctx.fillRect(bx, yy, ww, 2);
      };
      bar(by, hp / hpMax, COL.hp);
      bar(by + 3, mp / mpMax, COL.mp);
      // 斗志：var_58(182)，满值 100（変身/進化/高品质为 200）—— 203137-203151
      const mg = (Elona.Morale && Elona.Morale.get) ? Elona.Morale.get(c) : 0;
      const mgCap = (Elona.Morale && Elona.Morale.capOf) ? Elona.Morale.capOf(c) : 100;
      bar(by + 6, mg / Math.max(1, mgCap), COL.mor);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 小地图
  /**
   * 消息栏左侧的小地图：粗略显示可通行 / 不可通行，玩家用白点、NPC 用红点。
   */
  function drawMinimap(rd, game) {
    const ctx = rd.ctx;
    // 世界地图模式：用 ntyris 的地块（并标出城镇）
    const WM = Elona.WorldMap;
    const onWorld = !!(game && game.worldMap && WM && WM.cells);
    const map = onWorld ? null : (game && game.map);
    if (!onWorld && !map) return;
    const bx = 4, by = UI_TOP + 4, bw = 128, bh = 66;
    panel(ctx, bx, by, bw, bh, 3);
    const iw = bw - 6, ih = bh - 6;
    const ox = bx + 3, oy = by + 3;
    const cols = (onWorld ? WM.width : map.width) | 0;
    const rows = (onWorld ? WM.height : map.height) | 0;
    if (!cols || !rows) return;
    // 按块采样：把地图压到约 64×33 的网格再放大，避免逐格噪点
    const BW = Math.min(cols, 64), BH = Math.min(rows, 33);
    const cw = cols / BW, ch = rows / BH;
    const px = iw / BW, py = ih / BH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, iw, ih);
    ctx.clip();
    for (let by = 0; by < BH; by++) {
      for (let bx = 0; bx < BW; bx++) {
        let walkCnt = 0, tot = 0;
        const x0 = Math.floor(bx * cw), x1 = Math.min(cols, Math.ceil((bx + 1) * cw));
        const y0 = Math.floor(by * ch), y1 = Math.min(rows, Math.ceil((by + 1) * ch));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            tot++;
            if (onWorld) { if (WM.walkable(x, y)) walkCnt++; }
            else {
              // 0-DW：未探索的格子不进入小地图（与原版迷雾一致）
              if (map.isSeen && !map.isSeen(x, y)) { tot--; continue; }
              const cc = map.cell ? map.cell(x, y) : null;
              if (!cc) continue;
              let w = true;
              try { w = map.walkable ? !!map.walkable(x, y) : true; } catch (e) { w = true; }
              if (w) walkCnt++;
            }
          }
        }
        // 0-DW：整块都未探索 → 黑色迷雾
        if (!tot) {
          ctx.fillStyle = 'rgba(8,8,10,0.95)';
          ctx.fillRect(ox + bx * px, oy + by * py, Math.ceil(px), Math.ceil(py));
          continue;
        }
        const ratio = walkCnt / tot;
        ctx.fillStyle = ratio > 0.6 ? 'rgba(126,168,126,0.85)'
          : (ratio > 0.2 ? 'rgba(92,110,92,0.85)' : 'rgba(46,46,56,0.9)');
        ctx.fillRect(ox + bx * px, oy + by * py, Math.ceil(px), Math.ceil(py));
      }
    }
    const sx = iw / cols, sy = ih / rows;
    if (onWorld) {
      // 城镇点
      for (const t of ((Elona.Towns && Elona.Towns.LIST) || [])) {
        ctx.fillStyle = 'rgb(240,220,140)';
        ctx.fillRect(ox + t.wx * sx - 1, oy + t.wy * sy - 1, 2, 2);
      }
      // 0-FA：站点 / 随机地城入口（与 drawWorldMap 的标记同源）
      const ST = Elona.Sites;
      if (ST && ST.ready && ST.ready()) {
        const wid = (game.getV65 ? (game.getV65(850) | 0) : 0) || 4;
        for (const s of ST.ofWorld(wid, { placed: true }, game)) {
          if (!s || !s.fields) continue;
          const k = s.fields[0] | 0;
          const cleared = (s.fields[20] | 0) === -1;
          ctx.fillStyle = cleared ? 'rgb(110,110,115)'
            : (k >= 20 && k <= 27 ? (s.dyn ? 'rgb(255,150,60)' : 'rgb(140,190,255)')
              : 'rgb(120,200,120)');
          ctx.fillRect(ox + (s.fields[1] | 0) * sx - 1, oy + (s.fields[2] | 0) * sy - 1, 2, 2);
        }
      }
      const w = game.worldMap;
      ctx.fillStyle = '#ffffff';
      const pw = Math.max(2, Math.ceil(sx)), ph = Math.max(2, Math.ceil(sy));
      ctx.fillRect(ox + w.x * sx - pw / 2, oy + w.y * sy - ph / 2, pw, ph);
    } else {
      for (const c of (game.charas || [])) {
        if (!c || (c.get(0) | 0) !== 1) continue;
        // 0-DW：NPC 点只在本帧视野内时显示（玩家自己恒显示）
        if ((c.index | 0) !== 0 && map.isVisible && !map.isVisible(c.x, c.y)) continue;
        ctx.fillStyle = (c.index | 0) === 0 ? '#ffffff' : 'rgb(230,70,70)';
        ctx.fillRect(ox + c.x * sx, oy + c.y * sy, Math.max(2, Math.ceil(sx)), Math.max(2, Math.ceil(sy)));
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 开关
  function toggleSkillMonitor() {
    opts.skillMonitor = !opts.skillMonitor;
    return opts.skillMonitor;
  }
  /** 消息栏展开：每按一次 +4 行，4 次后回到 0（0 / 4 / 8 / 12 / 16） */
  function cycleMsgExpand() {
    opts.msgExpand = (opts.msgExpand + 4) % (MSG_BASE_LINES * 5);
    return opts.msgExpand;
  }
  function msgLines() { return MSG_BASE_LINES + opts.msgExpand; }

  Elona.Hud = {
    opts, ATTRS, ATTR_NAMES, MSG_BASE_LINES,
    loadNames, setNames, buffName, activeBuffs, statusList, statusLines,
    drawClock, drawSkillMonitor, drawWatch, drawBuffBox, drawCharaBars, drawMinimap,
    buffIconRect, ICON_SIZE,
    canInspect, toggleSkillMonitor, cycleMsgExpand, msgLines,
    // 0-DF：人物信息窗的「,」锁定
    watch, isWatched, toggleWatch, clearWatch, watchValue, strokeText,
  };
})(window);
