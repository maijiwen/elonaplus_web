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
 *     · 角色贴图底部：HP 条（默认不显示；敌对目标受伤后、或被听诊器 (物品 478)
 *       监视的角色才显示红色 HP 条，玩家自己不画）
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

  // ---------------------------------------------------------------- 状态指示
  /**
   * 视野左下角的「指示性状态 + 异常状态」文本行，自下而上堆叠。
   *
   * 【0-Z7】此前的实现只画了饱食 / 水分 + status.json 里 15 项异常状态，
   *   漏掉了源码 203326-203885 中另外二十多条指示状态，而且饱食/水分的
   *   文案表也不是源码字面量（源码 0..4 为「餓死中/飢餓/空腹×3」，
   *   11 为「満腹」、12 为「食過ぎ/飲過ぎ」，10 为空串）。
   *   这里按源码逐条重排，字符串数组与 8820-9065 的字面量逐字一致。
   *
   * 源码颜色一律 `color r,g,b` → 此处 `rgb(r,g,b)`。
   */
  const FOOD_TEXT = ['餓死中', '飢　餓', '空　腹', '空　腹', '空　腹',
    '', '', '', '', '', '', '満　腹', '食過ぎ'];                       // var_289 8820-8824
  const WATER_TEXT = ['脱水症', '渇　き', '乾　燥', '乾　燥', '乾　燥',
    '', '', '', '', '', '', '湿　潤', '飲過ぎ'];                       // var_290 8826-8830
  const ANOREXIA_TEXT = ['拒食Lv0', '拒食Lv1', '拒食Lv2', '拒食Lv3', '拒食Lv4',
    '拒食Lv5', '拒食Lv6', '拒食Lv7', '拒食Lv8', '拒食Lv9', '拒食Lv??'];  // var_291 8832-8836
  const BURDEN_TEXT = ['', '重　荷', '圧　迫', '超　過', '潰れ中'];      // var_292 8838-8842
  const SLEEPY_TEXT = ['睡眠可', '要睡眠', '要睡眠'];                    // var_293 8844-8848
  const SICK_TEXT = ['病気Lv0', '病気Lv1', '病気Lv2', '病気Lv3', '病気Lv4',
    '病気Lv5', '病気Lv6', '病気Lv7', '病気Lv8', '病気Lv9', '病気Lv??'];  // var_294 8850-8854
  const POISON_TEXT = ['　毒', '猛　毒'];                                 // var_295 8856-8860
  const DIM_TEXT = ['朦　朧', '混　濁', '気　絶'];                        // var_297 8868-8872
  const FURY_TEXT = ['激　怒', '狂　乱'];                                 // var_298 8874-8878
  const BLEED_TEXT = ['出　血', '出　血', '大出血'];                      // var_313 8960-8964
  const INSANE_TEXT = ['不安定', '狂　気', '崩　壊'];                     // var_314 8966-8970
  const BIND_TEXT = ['束　縛', '不　動'];                                 // var_328 9042-9046
  const SLEEP_TEXT = ['睡　眠', '爆　睡'];                                // var_321 9006-9010

  // 源码字面量（逐字）
  const STATUS_TEXT = {
    dyspnea: ['呼吸困難', '窒　息'],                                      // var_324 9018-9022
    tired: ['軽疲労', '疲　労', '過　労'],                                // var_331 9076-9080
    parasite: '寄　生', brainParasite: '脳髄寄生',                         // var_300/301
    erosion: '侵　蝕', metal: 'メタル', labor: '労　働',                   // var_296/302/299
    dupli: '杖複製', muteki: '無　敵', jiu: '柔　術',                     // var_303/304/305
    advCast: '高度詠唱', crest: '刻死紋', magS: 'Ｓ極状態', magN: 'Ｎ極状態', // var_306/307/308/309
    brainwash: '洗　脳', wince: '怯　み', chills: '震　え',                // var_310/311/312
    drunk: '酔払い', incapable: '行動不能', wet: '濡　れ', oil: 'オイル',  // var_315/316/317/318
    invert: '転　倒', gravity: '重　力', ash: '灰　化', overGods: '神智超越', // var_319/320/329/330
    blind: '盲　目', paralysis: '麻　痺', confusion: '混　乱', fear: '恐　怖', // var_322/323/325/326
    atrophy: '畏　縮',                                                    // var_327
  };
  const rgb = (r, g, b) => 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';

  function statusLines(game) {
    const p = game && game.player;
    const out = [];
    if (!p) return out;
    const G = (f) => (p.get(f) | 0);
    const V65 = (n) => ((game && game.getV65) ? (game.getV65(n) | 0) : 0);
    const cb = (bit) => ((Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(p, bit) | 0) : 0);
    const put = (text, color) => { if (text) out.push({ text: text, color: color }); };
    const T = STATUS_TEXT;

    // 203326-203358：饱食 var_58(22) —— 先判 12000（食過ぎ），再 1000..
    const food = G(22);
    if (food >= 12000) {
      put(FOOD_TEXT[12], rgb(0, 0, 0));
    } else if (food >= 1000) {
      const t = FOOD_TEXT[limit(idiv(food, 1000), 0, 12)];
      put(t, food <= 4000 ? rgb(200, 0, 0) : rgb(0, 0, 0));
    } else put(FOOD_TEXT[0], rgb(250, 0, 0));

    // 203361-203369 / 203371-203378：寄生虫 / 脑髓寄生
    if (cb(978)) put(T.parasite, rgb(20, 100, 50));
    if (cb(1045)) put(T.brainParasite, rgb(20, 50, 100));
    // 203380-203396：拒食症（强度存 var_58(93)）
    if (cb(986)) {
      const lv = G(93) > 0 ? limit(idiv(G(93), 3), 0, 10) : 0;
      put(ANOREXIA_TEXT[lv], rgb(200, 100, 50));
    }

    // 203398-203430：水分 var_58(446)
    const water = G(446);
    if (water >= 12000) {
      put(WATER_TEXT[12], rgb(0, 0, 80));
    } else if (water >= 1000) {
      const t = WATER_TEXT[limit(idiv(water, 1000), 0, 11)];
      put(t, water <= 4000 ? rgb(200, 0, 0) : rgb(0, 0, 80));
    } else put(WATER_TEXT[0], rgb(250, 0, 0));

    // 203432-203440：磁极 / 203442-203458：病気 / 毒 / 侵蝕 / 睡眠 / 盲目 / 麻痺 / 呼吸困难
    if (cb(1029)) put(T.magS, rgb(0, 0, 100));                        // 源码 cbit(1029,0)
    if (cb(1030)) put(T.magN, rgb(100, 0, 0));                        // 源码 cbit(1030,0)
    if (G(261) !== 0) {
      put(G(261) > 0 ? SICK_TEXT[limit(idiv(G(261), 3), 0, 10)] : '', rgb(80, 120, 0));
    }
    if (G(250) !== 0) put(POISON_TEXT[G(250) >= 30 ? 1 : 0], rgb(0, 150, 0));
    if (G(445) !== 0) put(T.erosion, rgb(0, 0, 100));
    if (G(251) > 0) put(SLEEP_TEXT[G(251) >= 30 ? 1 : 0], rgb(0, 50, 50));
    if (G(253) !== 0) put(T.blind, rgb(100, 100, 0));
    if (G(252) > 0) put(T.paralysis, rgb(0, 100, 100));
    if (G(263) !== 0) put(STATUS_TEXT.dyspnea[G(263) >= 15 ? 1 : 0], rgb(0, 100, 100));

    // 203547-203570：混乱 / 恐怖 / 朦朧 / 激怒 / 金属 / 労働
    if (G(254) !== 0) put(T.confusion, rgb(100, 0, 100));
    if (G(255) !== 0) put(T.fear, rgb(100, 0, 100));
    if (G(256) !== 0) {
      put(DIM_TEXT[G(256) >= 60 ? 2 : (G(256) >= 30 ? 1 : 0)], rgb(0, 100, 100));
    }
    if (G(264) !== 0) put(FURY_TEXT[G(264) >= 30 ? 1 : 0], rgb(150, 0, 0));
    if (G(265) !== 0) put(T.metal, rgb(0, 0, 160));
    if (cb(1042)) put(T.labor, rgb(100, 100, 0));

    // 203591-203630：出血 / 不安定 / 酔 / 畏縮 / 洗脳 / 杖複製 / 無敵 / 柔術
    if (G(258) !== 0) put(BLEED_TEXT[G(258) >= 20 ? 2 : (G(258) >= 10 ? 1 : 0)], rgb(150, 0, 0));
    if (G(260) !== 0) put(INSANE_TEXT[G(260) >= 50 ? 2 : (G(260) >= 25 ? 1 : 0)], rgb(150, 100, 0));
    if (G(257) !== 0) put(T.drunk, rgb(100, 0, 100));
    if (G(267) !== 0) put(T.atrophy, rgb(100, 0, 100));
    if (G(269) !== 0) put(T.brainwash, rgb(100, 0, 100));
    if (V65(250 + 310) !== 0) put(T.dupli, rgb(0, 0, 160));
    if (V65(250 + 387) !== 0) put(T.muteki, rgb(100, 80, 0));
    if (cb(1028)) put(T.jiu, rgb(10, 10, 10));

    // 203680-203716：剧情状态灰化 / 神智超越 / 刻死紋 / 高度詠唱 / 怯み / 震え / 束縛
    const story = V65(250 + 2);
    if (story >= 875 && story < 900) put(T.ash, rgb(120, 120, 120));
    if (story >= 900 && story < 1000) put(T.overGods, rgb(160, 160, 0));
    if (G(428) !== 0) put(T.crest, rgb(0, 0, 200));
    if (cb(1036)) put(T.advCast, rgb(220, 0, 0));
    if (G(175) !== 0) put(T.wince, rgb(160, 0, 0));
    if (G(176) !== 0) put(T.chills, rgb(0, 0, 160));
    if (G(268) !== 0) put(BIND_TEXT[G(268) >= 20 ? 1 : 0], rgb(0, 150, 0));

    // 203758-203812：油 / 転倒 / 行動不能 / 濡れ / 重力
    if (G(412) !== 0) put(T.oil, rgb(160, 0, 0));
    if (G(434) !== 0) put(T.invert, rgb(80, 30, 30));
    if (G(181) < 0) put(T.incapable, rgb(100, 0, 0));
    if (G(259) !== 0) put(T.wet, rgb(0, 0, 160));
    if (G(262) !== 0) put(T.gravity, rgb(0, 80, 80));

    // 203814-203840：困意（var_65(90)）
    const sleepy = V65(90);
    if (sleepy >= 50) put(SLEEPY_TEXT[2], rgb(255, 0, 0));
    else if (sleepy >= 30) put(SLEEPY_TEXT[1], rgb(100, 100, 0));
    else if (sleepy >= 13) put(SLEEPY_TEXT[0], rgb(0, 0, 0));

    // 203842-203866：SP 疲劳（var_58(52)）
    const sp = G(52);
    if (sp < 50) {
      if (sp < 0) put(T.tired[2], rgb(120, 120, 0));
      else if (sp < 25) put(T.tired[1], rgb(80, 80, 0));
      else put(T.tired[0], rgb(60, 60, 0));
    }
    // 203872-203879：负重档（var_58(45)）
    const burden = G(45);
    if (burden !== 0) put(BURDEN_TEXT[limit(burden, 0, 4)], rgb(0, burden * 40, burden * 40));
    return out;
  }

  // ---------------------------------------------------------------- 角色数据条
  /**
   * 角色贴图下方的 HP 条 —— 原版 34609 / 35456：
   *   `if ( cbit(966,c)==1 | var_65(94)==c | … )`
   *   即只有「被听诊器监视的角色」才会在贴图下画条。
   * 本项目按用户要求再补一条：敌对目标受伤后（relation < 0 且 HP < 上限）也显示 HP 条。
   *   玩家自己不画（底部 HUD 已有 HP/MP）；同伴听诊器条由 renderer.drawAllyBars 负责。
   */
  function canInspect(game, c) {
    const idx = (c.index | 0);
    if (idx === 0) return false;                 // 玩家：HUD 已有，不在贴图下重复
    if (c.__hpbar) return false;                 // 听诊器同伴：交给 drawAllyBars
    // 听诊器对敌人使用：var_65(94) 记录监视目标（354074）
    if (game.getV65 && (game.getV65(94) | 0) === idx) return true;
    // 敌对目标受伤后才显示 HP 条
    const rel = c.get(9) | 0;
    if (rel < 0 && (c.get(50) | 0) < (c.get(51) | 0)) return true;
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
      const w = 34;
      const bx = vx + (TILE - w) / 2;
      const by = vy + TILE - 6;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.66)';
      ctx.fillRect(bx - 1, by - 1, w + 2, 5);
      const ww = Math.round(limit(hp / hpMax, 0, 1) * w);
      if (ww > 0) {
        ctx.fillStyle = COL.hp;
        ctx.fillRect(bx, by, ww, 3);
      }
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
  /**
   * 0-Z36 / 0-Z37：`/` 键的消息栏展开开关（用户口径：按 / 把下方消息区加高、显示更多行，
   * 再按 / 或 Esc 复原）。
   *
   * 原版 *label_4325（597465-）是在**地图视口上**覆盖一个大窗口：
   *   左 var_219 = var_204-2；宽 var_910 = var_216-var_204+6（宽度与消息区相同、不遮左侧状态栏）
   *   顶 var_221 = var_208-(var_227-3)*var_207-1；高 var_911 = (var_227-3)*var_207
   *   var_227 = (var_208-100)/var_207+3 = (512-100)/15+3 = 30 → 展开 27 行 × 15 = 405px
   * 窗口从 y≈106 到 y=511，左侧 HP/MP 等状态栏仍在框外；消息贴窗口底部绘制。
   */
  // var_227 - 3 = 27 行总高，减去基础 4 行 = 额外 23 行
  const MSG_EXPAND_MAX = 23;
  function isMsgExpanded() { return (opts.msgExpand | 0) > 0; }
  function setMsgExpanded(on) {
    opts.msgExpand = on ? MSG_EXPAND_MAX : 0;
    return opts.msgExpand;
  }
  function toggleMsgExpand() {
    setMsgExpanded(!isMsgExpanded());
    return opts.msgExpand;
  }
  function msgLines() { return MSG_BASE_LINES + opts.msgExpand; }

  Elona.Hud = {
    opts, ATTRS, ATTR_NAMES, MSG_BASE_LINES,
    MSG_EXPAND_TOTAL_LINES: MSG_BASE_LINES + 23,
    loadNames, setNames, buffName, activeBuffs, statusList, statusLines,
    drawClock, drawSkillMonitor, drawWatch, drawBuffBox, drawCharaBars, drawMinimap,
    buffIconRect, ICON_SIZE,
    canInspect, toggleSkillMonitor, cycleMsgExpand, msgLines,
    isMsgExpanded, setMsgExpanded, toggleMsgExpand, MSG_EXPAND_MAX,
    // 0-DF：人物信息窗的「,」锁定
    watch, isWatched, toggleWatch, clearWatch, watchValue, strokeText,
  };
})(window);
