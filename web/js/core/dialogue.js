'use strict';
/**
 * 固定 NPC 对话脚本解释器（core/dialogue.js）
 *
 * 【源码依据】
 *   start.hsp 367818-410727 是整份源码里最长的一段连续脚本（42,910 行），
 *   结构是「按种族 id 分派」：
 *
 *     365732  var_506(1) = 0, 1
 *     365733  if ( var_58(25, var_244) == 6 ) {                     ; role/type == 6（固定居民）
 *     365734      if ( var_244 >= 16 | var_58(27, var_244) == 1034 ) {
 *     365735          var_506(1) = var_58(27, var_244), 0           ; var_506(1) = 种族 id
 *     367818  *label_3035   var_1302 = var_506(1)
 *     367824      if ( var_1302 == 2 | var_1303 ) { ... }           ; 172 个分支，按种族分派
 *     410728  *label_3039   「…（あなたの言葉を聞いていない）」
 *
 *   所以 `var_1302 == N` 里的 N 就是**种族 id**，一个分支 = 一个固定 NPC 的整段对话/任务。
 *
 * 【为什么用「指令表 + 解释器」而不是一个分支一个函数】
 *   172 个分支 42,904 行，手写既写不完也核不准。整段编译成扁平指令表后：
 *     - 与原版 goto/gosub 一一对应，每条指令带源码行号，可逐条回溯
 *     - `var_1303` 的「本分支没写台词 → 落到下一个分支」原样保留（原版就是靠它级联）
 *     - 分支之间的 `goto *label_3036 / 3037` 只是普通跳转
 *   指令表由 tools/extract_talk_scripts.py 从 start.hsp 生成到
 *   web/data/tables/talkscripts.json。
 *
 * 【对话原语 *label_3068】
 *   var_122         要显示的台词
 *   var_484(0, i)   第 i 个选项的**返回值**
 *   var_485(0, i)   第 i 个选项的**显示文本**
 *   var_701         选项计数
 *   var_2060        1 = 允许 Esc 关闭（返回 -1）
 *   var_506         选择结果（-1 = Esc）
 *   var_134         本次是「取消」而非「选择」
 *   var_2612        1 = 取消来自对话框内部（配合 var_134 结束整段对话）
 *
 * 【本模块的调用方式】
 *   const s = Elona.Dialogue.start(g, npc);      // 建立会话
 *   let ev = s.step();                          // 跑到需要 UI 为止
 *   ev = { kind:'say'|'menu'|'end'|'blocked', text, items, allowEsc, ... }
 *   s.answer(value) / s.cancel();               // 回答后继续 step()
 * 驱动方在 web/js/view/ui.js（openNpcTalk）。
 *
 * 【0-GN / 365737-365964 `*label_3031` 的开场特殊分支】
 *   365737-365742  evid 2 / 16 → 事件对话（EventQueue 与 Scene 播放）
 *   365743-365762  睡眠（var_58(256)>60）或眩晕（var_58(251)）→ npc.talk 的状态说明
 *   365763-365775  生日（var_2613）→ 日历字段见 gene.js，专用台词随场景链处理
 *   365776-365800  主线 NPC 1015/1018/1017（状态 850/860/870、地图 76）
 *                  → story.js 的场景推进与固定 NPC 分支
 *   365801-365870  NPC 886 / 1014 的剧情分支与 var_65(568/574) 条件
 *   365871-365964  对话菜单构造（var_484/485/701/2060）→ Session.menu / step()
 *   原版 goto *label_3053~3058 的剧情块由 talkscripts.json 的分支级联承载，
 *   逐条近似口径见 docs/02 A493。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 标准选项文本（源 9154-9168，这里只列对话里用得到的） */
  /**
   * 标准标签文本（源码里 `mes var_354` … `mes var_363` 这种「整条台词是一个变量」）
   * 汉化：补 `ch`，与 talkscripts 的 t 对象同一形状。
   */
  const STD_LABEL = {
    354: { jp: 'どうもありがとう！', en: 'Thank you very much!', ch: '非常感谢！' },
    355: { jp: '血の気が多すぎるよ。', en: "You're way too bloodthirsty.", ch: '你也太好斗了吧。' },
    356: { jp: 'さようなら。', en: 'Bye bye.', ch: '再见。' },
    357: { jp: 'さようなら。', en: 'Bye bye.', ch: '再见。' },
    358: { jp: 'また来てね…', en: 'I wish you were still here...', ch: '下次再来啊……' },
    359: { jp: 'は？？？', en: 'What???', ch: '哈？？？' },
    360: { jp: '!?!?!?', en: '!?!?!?', ch: '！？！？！？' },
    361: { jp: '宴会だ！', en: 'Party time!', ch: '开宴会啦！' },
    362: { jp: '（続ける）', en: '(More)', ch: '（继续）' },
    363: { jp: '（お金が足りない！）', en: "(You don't have enough money!)", ch: '（钱不够！）' },
  };

  /** 纯 UI 的子程序（原版是重画 / 立绘），解释器里当空操作 */
  const UI_GOSUB = { 2104: 1, 2131: 1, 2132: 1, 3068: 1, 3069: 1, 3070: 1, 3071: 1, 3072: 1 };

  /**
   * 已用原生 JS 实现的「外部子程序」—— 不再 blocked。
   *   4274  `var_581 = N : gosub *label_4274`  把临时角色收进队伍（589937）
   *   2683  选目标窗（284006）→ Elona.Select.charaList
   *   2824  选物品窗（296163）→ Elona.Select.itemList
   * 前两个会向 UI 抛 `pick_chara` / `pick_item` 事件，玩家选完再 `answer()` 续跑。
   */
  const NATIVE_GOSUB = {
    4274: 'join', 2683: 'chara', 2824: 'item', 2707: 'npc',
    2174: 'refresh', 2235: 'parts', 2143: 'partbonus', 2147: 'clampPot',
    2911: 'relocate', 2929: 'strip', 2612: 'faith', 4352: 'hour',
  };

  /**
   * 场景 / 绘制类子程序 —— 本项目没有对应渲染，直接跳过但**记账**
   * （`session.skipped` 可审计；与「静默吞掉」区分开）。
   *   2104 重画、2131/2132 立绘、2111 剧情演出（5,420 行，`var_1117` 分镜）、
   *   2130 闪屏、0069 BGM（`var_131` 曲号）、2892/2896 气泡与快捷栏、3030 表情图
   */
  const SCENE_GOSUB = {
    2104: 'redraw', 2111: 'cutscene', 2130: 'flash', 2131: 'face',
    2132: 'face', 69: 'bgm', 2892: 'balloon', 2896: 'hotbar', 3030: 'face',
  };
  /** 可以安全忽略的 map/演出指令（不影响对话结果） */
  const NOOP_OPS = {
    self: 1, buf: 1, txtef: 1, tagend: 1, invheader: 1, mreset: 0,
  };

  const MAX_STEPS = 20000;     // 死循环护栏

  let PROG = null;             // { entry, labels, instrs }
  let BRANCHES = null;         // [{ chain, species, line, pc, ... }]
  let BY_SPECIES = null;       // 种族 → 分支（`*label_3035` 话题链）
  let BY_SERVICE = null;       // 服务号 → 分支（`*label_3033` 服务链）
  const evCache = new Map();   // 表达式缓存

  function setTable(data) {
    if (!data) return false;
    PROG = (data.program || data);
    BRANCHES = data.branches || [];
    BY_SPECIES = new Map();
    BY_SERVICE = new Map();
    for (const b of BRANCHES) {
      if (b.chain === 'service') BY_SERVICE.set(b.species | 0, b);
      else BY_SPECIES.set(b.species | 0, b);
    }
    evCache.clear();
    return Array.isArray(PROG.instrs);
  }

  function hasScript(species) {
    return !!(BY_SPECIES && BY_SPECIES.has(species | 0));
  }

  function branchOf(species) {
    return BY_SPECIES ? (BY_SPECIES.get(species | 0) || null) : null;
  }

  /** `*label_3033` 服务链的分支（服务号 = `var_58(150)`） */
  function serviceBranchOf(svc) {
    return BY_SERVICE ? (BY_SERVICE.get(svc | 0) || null) : null;
  }

  /** 表达式求值：new Function 里是 sloppy 模式，所以可以用 with */
  function ev(js, S) {
    let fn = evCache.get(js);
    if (!fn) {
      try {
        fn = new Function('S', 'with (S) { return (' + js + '); }');
      } catch (e) {
        fn = () => 0;
      }
      evCache.set(js, fn);
    }
    try { return fn(S); } catch (e) { return 0; }
  }

  /**
   * 取双语文本 → 单语，并替换 `{i}` 占位符（占位符来自编译期的拼接表达式）。
   *
   * 汉化：talkscripts.json 的 `t` 对象里，`ch` 与 `jp`/`en` 同层级（`{jp, en, ch}`）。
   *   日文档（lang !== 'en'）读 `ch`，缺译回退 `jp` → `en`；
   *   英文档仍优先 `en`，缺译回退 `ch` → `jp`。
   * @param {object} [S] 求值作用域（缺失时占位符原样保留）
   */
  function pick(t, lang, S) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    let str = (lang === 'en') ? (t.en || t.ch || t.jp || '') : (t.ch || t.jp || t.en || '');
    // 整条台词就是一个变量名（`mes var_362`）→ 查标准标签表（var_354..var_363）
    const std = /^var_(\d+)$/.exec(str);
    if (std && STD_LABEL[std[1] | 0]) return pick(STD_LABEL[std[1] | 0], lang, S);
    if (t.a && t.a.length && S) {
      str = str.replace(/\{(\d+)\}/g, (m, k) => {
        const ex = t.a[k | 0];
        if (ex === undefined) return '';
        const v = ev(ex, S);
        return (v === undefined || v === null) ? '' : String(v);
      });
    }
    return str;
  }

  /** `calcobjlv`（26093-26116）：生成等级。0 → 取当前地图等级 `var_65(22)` */
  function calcObjLv(g, lv) {
    const rnd = (n) => ((g && g.rng && g.rng.rnd) ? (g.rng.rnd(n) | 0) : 0);
    let v = lv <= 0 ? ((g && g.getV65) ? (g.getV65(22) | 0) : 1) : lv;
    if (g && g.getV65 && (g.getV65(20) | 0) === 30) v = 1;      // 26100：特定地图恒为 1 级
    for (let cnt = 1; cnt <= 3; cnt++) {                       // 26103：repeat 3,1
      const r = rnd(30 + cnt * 5) % Math.max(1, 30 + cnt * 5);
      if (r === 0) { v += rnd(10 * cnt) % Math.max(1, 10 * cnt); continue; }
      break;
    }
    if (lv <= 3) {                                             // 26111
      const r = rnd(4) % 4;
      if (r !== 0) v = (rnd(3) % 3) + 1;
    }
    return v;
  }

  /** `calcfixlv`（26117-26147）：生成品质 1..5（0 → 基准 2） */
  function calcFixLv(g, q) {
    const rnd = (n) => ((g && g.rng && g.rng.rnd) ? (g.rng.rnd(n) | 0) : 0);
    let v = q === 0 ? 2 : q;
    for (let cnt = 1; cnt <= 3; cnt++) {                       // 26124：repeat 3,1
      const r = rnd(30 + cnt * 5) % Math.max(1, 30 + cnt * 5);
      if (r === 0) { v++; continue; }
      if (r < 3) { v--; continue; }
      break;
    }
    if (v === 2 && (rnd(6) % 6) === 0) v++;                    // 26136
    if (v < 1) v = 1;
    if (v > 5) v = 5;
    return v;
  }

  /** `var_726(0..8)` 的神名（源码 272105-272115） */
  const GOD_NAMES = [
    { jp: '無のエイス', en: 'Eyth of Infidel', ch: '无之艾斯' },
    { jp: '機械のマニ', en: 'Mani of Machine', ch: '机械之马尼' },
    { jp: '風のルルウィ', en: 'Lulwy of Wind', ch: '风之露露薇' },
    { jp: '元素のイツパロトル', en: 'Itzpalt of Element', ch: '元素之伊兹帕罗特尔' },
    { jp: '幸運のエヘカトル', en: 'Ehekatl of Luck', ch: '幸运之艾赫卡托尔' },
    { jp: '地のオパートス', en: 'Opatos of Earth', ch: '大地之奥帕托斯' },
    { jp: '癒しのジュア', en: 'Jure of Healing', ch: '治愈之茱亚' },
    { jp: '収穫のクミロミ', en: 'Kumiromi of Harvest', ch: '收获之库米罗米' },
    { jp: '富のヤカテクト', en: 'Yacatect of Wealth', ch: '财富之雅卡泰克特' },
  ];
  function godName(id, lang) {
    const g = GOD_NAMES[id | 0];
    if (!g) return 'g' + (id | 0);
    // 汉化：非英文档读 ch，缺译回退 jp
    return (lang === 'en') ? (g.en || g.ch || g.jp) : (g.ch || g.jp || g.en);
  }

  /**
   * `*label_2929`（309872-310xxx）的入口段：让两人进入「交尾中」状态。
   *   已在进行 → 只给一句台词并收尾；
   *   未开始 → `var_58(140)=11`、`var_58(141)=25+rnd(10)`、互相记 `var_58(152)`。
   * 后续的多回合演出与结算（rowact 推进）没有移植，见差异表 A361。
   */
  function stripStart(g, p, t) {
    if (!p || !t) return { ok: false, reason: 'no-target' };
    if ((p.get(140) | 0) === 0) {
      const dur = 25 + ((g && g.rng) ? (g.rng.rnd(10) | 0) : 0);
      p.set(140, 11);
      p.set(141, dur);
      p.set(152, t.index | 0);                       // 309876
      t.set(140, 11);
      t.set(141, dur * 2);                           // 309877
      t.set(152, (p.index | 0) + 10000);             // 309878
      return { ok: true, started: true, dur };
    }
    return { ok: false, reason: 'in-progress' };
  }

  /** 选项文本：可能是 lang()、标准标签的变量名、或 NPC 名字表达式 */
  function labelText(t, S, lang) {
    if (!t) return '';
    let s = pick(t, lang);
    let m = /^var_(\d+)$/.exec(s);
    if (m) {
      const std = STD_LABEL[m[1] | 0];
      return std ? pick(std, lang) : `(var_${m[1]})`;
    }
    m = /^var_63\(0,\s*var_244\)$/.exec(s);
    if (m) return S.nameOf();
    if (s.indexOf('var_') === 0) {
      // 其它表达式形态：尽力求值
      const v = ev(s, S);
      return (typeof v === 'string' && v) ? v : s;
    }
    return s;
  }

  // ======================================================================
  // 会话
  // ======================================================================
  class Session {
    constructor(g, npc, opts) {
      opts = opts || {};
      this.g = g;
      this.npc = npc;
      this.lang = opts.lang || 'en';
      this.player = opts.player || (g && g.player) || null;
      this.target = opts.target || null;      // var_581 / var_579 对应的「临时角色」「物品」
      this.chain = opts.chain === 'service' ? 'service' : 'topic';
      // 服务链从 `*label_3033` 进入（366000），由脚本自己把
      // `var_1302 = var_58(150, var_244)` 读出来再分派
      this.pc = PROG
        ? (this.chain === 'service'
          ? ((PROG.labels && PROG.labels['3033'] !== undefined) ? (PROG.labels['3033'] | 0) : PROG.entry)
          : PROG.entry)
        : 0;
      // 分派变量：话题链按种族（var_58(27)），服务链按服务号（var_58(150)）
      this.var1302 = npc
        ? ((this.chain === 'service' ? (npc.get(150) | 0) : (npc.get(27) | 0)))
        : 0;
      this.var1303 = 0;
      this.var506 = 0;
      this.var701 = 0;
      this.var134 = 0;
      this.var2612 = 0;
      this.var2060 = 0;
      this.var244 = npc;
      this.menu = [];
      this.text = { jp: '', en: '', ch: '' };
      this.loops = [];
      this.ret = [];             // call/ret 返回地址栈
      this.levels = [];      // flt 设定的下一件物品等级
      this.ended = false;
      this.blocked = null;
      this.pending = null;         // 等待玩家在 pick_chara / pick_item 里选
      this.lastJoin = null;        // 4274 的结果（测试用）
      this.startWorld = (g && g.getV65) ? (g.getV65(850) | 0) : 0;
      this.worldChanged = 0;       // A49：对话结束时 var_65(850) 相对开场的变化
      this.steps = 0;
      this.log = [];
      this.trace = opts.trace ? [] : null;   // 调试用：记录走过的 pc
      this.S = this.makeScope();
    }

    makeScope() {
      const self = this;
      const g = this.g;
      const VX = Object.create(null);
      const VXA = Object.create(null);
      // 0-HM：源码的常量槽 var_1606 / var_1607（上下楼梯的图块 id，227333-227334）。
      //   Vernis 的シーナ支线用 `featset 48, 5, VX(1606), 11, 4` 在城镇里开入口
      //   （talkscripts 368673），此前 VX 全为 0 → 写进格子的是空图块，入口看不见。
      VX[1606] = 231;
      VX[1607] = 232;
      const rnd = (n) => ((g && g.rng) ? g.rng.rnd(n) : Math.floor(Math.random() * Math.max(1, n | 0)));

      const scope = {
        // ---- 跨模块访问器 ----
        V: (n) => (g && g.getV65 ? (g.getV65(n | 0) | 0) : 0),
        F: (n) => (self.var244 ? (self.var244.get(n | 0) | 0) : 0),
        // 通用带下标访问：CF(下标, 字段) / CN(下标, 名字槽) / CI(背包槽, 字段)
        CF: (i, n) => {
          const c = (g && g.charas) ? g.charas[i | 0] : null;
          return (c && c.get) ? (c.get(n | 0) | 0) : 0;
        },
        CN: (i, n) => {
          const c = (g && g.charas) ? g.charas[i | 0] : null;
          if (!c) return '';
          return (n | 0) === 0 ? (c.name || '') : '';
        },
        CI: (i, n) => {
          const it = self.itemAt(i | 0);
          return it ? (it.f[n | 0] | 0) : 0;
        },
        F581: (n) => {
          const c = self.target || (self.g && self.g.charas && self._VX
            ? self.g.charas[self._VX[581] | 0] : null);
          return (c && c.get) ? (c.get(n | 0) | 0) : 0;
        },
        P: (n) => (self.player ? (self.player.get(n | 0) | 0) : 0),
        GP: (n) => {
          if (!self.player) return '';
          return (n | 0) === 0 ? (self.player.name || '') : '';
        },
        I: (n) => {
          const it = self.item;
          return it ? (it.f[n | 0] | 0) : 0;
        },
        G: (n) => {
          const c = self.var244;
          if (!c) return '';
          if ((n | 0) === 0) return c.name || '';
          return '';
        },
        CB: (n) => (self.var244 && Elona.Status && Elona.Status.cbit
          ? (Elona.Status.cbit(self.var244, n | 0) | 0) : 0),
        SK: (n) => (self.var244 && self.var244.get ? (self.var244.get(60 + (n | 0)) | 0) : 0),
        SKI: (a, n) => (self.var244 && self.var244.get ? (self.var244.get(60 + (n | 0)) | 0) : 0),
        VX: (n) => (VX[n | 0] | 0),
        VXA: (n, i) => (VXA[(n | 0) * 1000 + (i | 0)] | 0),
        // ---- 具名局部量 ----
        var1302: this.var1302,
        var1303: 0,
        var506: 0,
        var701: 0,
        var244: this.npc,
        var579: 0,
        var581: 0,
        var134: 0,
        var2612: 0,
        var2060: 0,
        stat: 0,
        cnt: 0,
        servant: 0,
        // ---- 常用函数 ----
        rnd,
        limit: (v, a, b) => Math.max(a, Math.min(b, v)),
        sqrt: (v) => Math.sqrt(v),
        int: (v) => Math.trunc(v),
        evid: () => (Elona.Event && Elona.Event.evid ? Elona.Event.evid(g) : 0),
        refchara: (id, f) => (Elona.ItemDB && Elona.ItemDB.ref ? (Elona.ItemDB.ref(id, f) | 0) : 0),
        refitem: (id, f) => (Elona.ItemDB && Elona.ItemDB.ref ? (Elona.ItemDB.ref(id, f) | 0) : 0),
        name: (i) => (self.var244 ? (self.var244.name || '') : ''),
        he: () => (self.var244 ? (self.var244.name || '') : ''),
        nameOf: () => (self.var244 ? (self.var244.name || '') : ''),
        flag: (n) => (g && g.getV65 ? (g.getV65(n | 0) | 0) : 0),
        cbit: (n) => scope.CB(n),
        ibit: (n) => (self.item && Elona.ItemDB && Elona.ItemDB.ibit
          ? (Elona.ItemDB.ibit(n | 0, self.item) | 0) : 0),
        findally: () => 0,
        get_freeally: () => 0,
        findallyguard: () => 0,
        findchara: () => 0,
        dist: (a, b) => 0,
        fov_los: () => 1,
        instr: (a, b) => 0,
        strmid: (s) => s,
        strlen: (s) => (typeof s === 'string' ? s.length : 0),
        calcinvestvalueg: () => 0,
        calcobjlv: () => 1,
        calcfixlv: () => 1,
        sorg: (n) => (self.var244 && self.var244.get ? (self.var244.get(60 + (n | 0)) | 0) : 0),
        lang: (jp, en) => (self.lang === 'jp' ? jp : en),
      };
      // 数组槽的写入走 setter
      Object.defineProperty(scope, '_setVX', {
        value: (n, v) => { VX[n | 0] = v | 0; }, enumerable: false,
      });
      this._VX = VX;
      this._VXA = VXA;
      this._scope = scope;

      // Proxy：未知标识符 → 0（并记录一次），避免一个生僻字段就整段崩掉
      this.missing = new Set();
      return new Proxy(scope, {
        has: () => true,
        get(t, p) {
          if (p in t) return t[p];
          if (p === Symbol.unscopables) return undefined;
          if (typeof p === 'string') {
            if (p in global) return global[p];
            if (!self.missing.has(p)) self.missing.add(p);
          }
          return 0;
        },
        set(t, p, v) { t[p] = v; return true; },
      });
    }

    get item() {
      if (this.var579Item) return this.var579Item;
      return this.itemAt(this._VX[579] | 0);
    }

    /** 背包第 i 格（i < 0 时返回 null） */
    itemAt(i) {
      const p = this.player;
      const inv = (p && p.inv) || [];
      return i >= 0 ? (inv[i | 0] || null) : null;
    }

    /** 同步局部量到 scope（进入每条指令前调用） */
    syncScope() {
      const s = this._scope;
      s.var1302 = this.var1302;
      s.var1303 = this.var1303;
      s.var506 = this.var506;
      s.var701 = this.var701;
      s.var244 = this.var244;
      s.var134 = this.var134;
      s.var2612 = this.var2612;
      s.var2060 = this.var2060;
      // 579 / 581 是「选中的物品 / 临时角色」—— 归一化到通用槽，读写都走 VX
      s.var579 = this._VX[579] | 0;
      s.var581 = this._VX[581] | 0;
      s.cnt = this.loops.length ? this.loops[this.loops.length - 1].i : 0;
    }

    /** 把 scope 上的局部量拉回会话（指令可能改了它们） */
    pullScope() {
      const s = this._scope;
      this.var1303 = s.var1303 | 0;
      this.var506 = s.var506 | 0;
      this.var701 = s.var701 | 0;
      this.var134 = s.var134 | 0;
      this.var2612 = s.var2612 | 0;
      this.var2060 = s.var2060 | 0;
      this._VX[579] = s.var579 | 0;
      this._VX[581] = s.var581 | 0;
      if (s.var244) this.var244 = s.var244;
    }

    /** 读 / 写通用槽 var_N */
    vx(n) { return this._VX[n | 0] | 0; }
    setVx(n, v) {
      this._VX[n | 0] = v | 0;
      if (n === 579) this._scope.var579 = v | 0;
      if (n === 581) this._scope.var581 = v | 0;
    }
    /** gosub 的返回值 —— 源码里的 `stat` */
    setStat(v) { this._scope.stat = v | 0; }

    /**
     * 三个「外部子程序」的原生实现。
     * @returns {null|object}  null = 已就地完成；否则返回给 UI 的事件（pick_chara / pick_item / blocked）
     */
    nativeGosub(L, d) {
      const g = this.g;
      const kind = NATIVE_GOSUB[L];
      const lang = this.lang;
      const CF = Elona.CharaFactory;

      // ---- 角色派生值刷新（*label_2174，213373-219675）----
      if (kind === 'refresh') {
        const idx = this.vx(691);
        const c = (g && g.charas) ? g.charas[idx] : null;
        if (c && CF && CF.refresh) { try { CF.refresh(g, c); } catch (e) { this.noteSkip(L); } }
        return null;
      }
      // ---- 部位清单写入（*label_2235，219133-219190）----
      if (kind === 'parts') {
        const idx = this.vx(581);
        const c = (g && g.charas) ? g.charas[idx] : null;
        // var_121(1) 是部位清单字符串（"頭|体|背|…"），由 buf 指令写入 this.buf1
        const txt = this.buf1 || '';
        if (c && Elona.CharaParts && Elona.CharaParts.apply) {
          this.partCount = Elona.CharaParts.apply(c, txt);
        }
        return null;
      }
      // ---- 部位数 → var_58(68)（*label_2143）----
      if (kind === 'partbonus') {
        const idx = this.vx(691);
        const c = (g && g.charas) ? g.charas[idx] : null;
        if (!c) return null;
        let n = 0;
        for (let i = 100; i < 130; i++) if ((c.get(i) | 0) !== 0) n++;
        c.set(68, n > 13 ? Math.max(0, Math.min(50, (n - 13) * 5)) : 0);
        return null;
      }
      // ---- 技能潜力上限（*label_2147）----
      if (kind === 'clampPot') {
        const idx = this.vx(691);
        const c = (g && g.charas) ? g.charas[idx] : null;
        if (!c) return null;
        c.potential = c.potential || {};
        const cap = (sk, hi) => {
          const v = c.potential[sk] | 0;
          if (v > hi) c.potential[sk] = Math.max(hi, Math.min(1000 * 1000000, Math.trunc(v / 2)));
        };
        for (let a = 10; a < 20; a++) cap(a, 1000 * (a === 18 ? 50000 : 20000));
        for (let a = 100; a < 112; a++) cap(a, 1000 * 20000);
        for (let a = 150; a < 191; a++) cap(a, 1000 * 20000);
        for (let a = 300; a < 302; a++) cap(a, 1000 * 20000);
        return null;
      }
      // ---- 角色落点搬移（*label_2911）----
      if (kind === 'relocate') {
        const idx = this.vx(243);
        const c = (g && g.charas) ? g.charas[idx] : null;
        if (!c) return null;
        const nx = c.get(3), ny = c.get(4);      // 306059-306060
        if (nx || ny) {
          c.x = nx | 0; c.y = ny | 0;
          c.set(1, nx); c.set(2, ny);
          if (idx === 0 && g.getV65 && (g.getV65(183) | 0)) {
            const f = g.charas[g.getV65(183) | 0];      // 306062-306066：跟随者同步
            if (f) { f.x = nx | 0; f.y = ny | 0; f.set(1, nx); f.set(2, ny); }
          }
          if (g.syncCharaCells) g.syncCharaCells();
        }
        return null;
      }
      // ---- 交尾状态机（*label_2929 / 309872 起）----
      if (kind === 'strip') {
        const p = this.player;
        const t = this.var244;
        this.stripResult = stripStart(g, p, t);
        return null;
      }
      // ---- 改宗（*label_2612，272612 起）----
      if (kind === 'faith') {
        const p = this.player;
        if (p && g && g.setV65) {
          g.setV65(282, (g.getV65(282) | 0) + 1);      // var_65(250+32)++
          p.set(62, 0);                                 // 272614
          p.set(63, 500);                               // 272615
          g.setV65(807, 0);
          g.setV65(549, 1);                             // var_65(250+299) = 1
        }
        const god = p ? (p.get(61) | 0) : 0;
        const name = godName(god, lang);
        this.pushLog(god === 0
          ? pick({ jp: 'あなたは今や無信仰者だ。', en: 'You are an unbeliever now.',
            ch: '你现在已成为无信仰者。' }, lang)
          : pick({ jp: 'あなたは今や' + name + 'の信者だ！', en: 'You become a follower of ' + name + '!',
            ch: '你现在已成为' + name + '的信徒！' }, lang));
        return null;
      }
      // ---- 时间推进（*label_4352 = Advance_hour）----
      if (kind === 'hour') {
        // 脚本自己已经写了 `var_65(13) += 2`；这里只跑整点结算（跨 24 点时自动进位）
        if (g && g.advanceHours) { try { g.advanceHours(0); } catch (e) { this.noteSkip(L); } }
        return null;
      }
      if (kind === 'join') {
        // 589937-590180：var_581 指向的角色入队；队伍满则该角色消失并提示
        const idx = this.vx(581);
        const c = (g && g.charas) ? g.charas[idx] : null;
        let r = null;
        if (Elona.Party && Elona.Party.joinChara) {
          try { r = Elona.Party.joinChara(g, c); } catch (e) { r = null; }
        }
        if (r && r.message) this.pushLog(r.message);
        this.lastJoin = r;
        this.setStat(r && r.ok ? 1 : 0);
        return null;
      }
      if (kind === 'chara') {
        // 284006：按 var_1790 组列表；var_581 / var_244 参与排除
        const mode = this.vx(1790);
        const list = (Elona.Select && Elona.Select.charaList)
          ? Elona.Select.charaList(g, mode, {
            npc: this.var244,
            var581: this.vx(581),
            roomKind: this.roomKindOf(g),
            var2193: this.vx(2193),
            mapId: (g && g.map) ? (g.map.id | 0) : 0,
          })
          : [];
        const prompt = (Elona.Select && Elona.Select.charaPrompt)
          ? pick(Elona.Select.charaPrompt(mode, {
            roomKind: this.roomKindOf(g), var2193: this.vx(2193),
            mapId: (g && g.map) ? (g.map.id | 0) : 0,
          }), lang)
          : 'Who?';
        this.pending = {
          kind: 'chara', label: L, list, mode,
          evt: {
            kind: 'pick_chara', mode, label: L, line: d && d.l,
            text: prompt, items: list.map((e) => ({ v: e.v, label: e.label })),
            empty: list.length === 0,
          },
        };
        return this.pending.evt;
      }
      if (kind === 'npc') {
        // 286511 起的「NPC 一覧 / 雇用」选择窗
        const mode = this.vx(1790);
        const list = (Elona.Select && Elona.Select.npcList)
          ? Elona.Select.npcList(g, mode, {
            var581: this.vx(581),
            mapId: (g && g.getV65) ? (g.getV65(20) | 0) : 0,
            player: this.player,
          })
          : [];
        const prompt = pick({ jp: 'どのNPCを選ぶ？', en: 'Select NPC?', ch: '要选择哪个NPC？' }, lang);
        this.pending = {
          kind: 'chara', label: L, list, mode,
          evt: {
            kind: 'pick_chara', mode, label: L, line: d && d.l, kindOf: 'npc',
            text: prompt, items: list.map((e) => ({ v: e.v, label: e.label })),
            empty: list.length === 0,
          },
        };
        return this.pending.evt;
      }
      // kind === 'item'
      const mode = this.vx(486);
      const sub = this._VXA[(486 * 1000) + 1] | 0;
      const list = (Elona.Select && Elona.Select.itemList)
        ? Elona.Select.itemList(g, mode, sub, { var1580: this.vx(1580) })
        : null;
      if (!list) {
        // 模式 22（临时背包）等没有对应实现 —— 如实报告，不拿玩家背包冒充
        const why = 'gosub-2824:mode-' + mode;
        this.blocked = why;
        return { kind: 'blocked', why, line: d && d.l, label: 2824 };
      }
      this.pending = {
        kind: 'item', label: L, list, mode, sub,
        evt: {
          kind: 'pick_item', mode, sub, label: L, line: d && d.l,
          text: pick(Elona.Select.itemPrompt(mode, sub), lang),
          items: list.map((e) => ({ v: e.v, label: e.label })),
          empty: list.length === 0,
        },
      };
      return this.pending.evt;
    }

    /** `var_132(16, var_65(20))`：当前所在设施的种类（用于 2683 的标题） */
    roomKindOf(g) {
      if (!g || !g.player) return 0;
      const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
      if (g.getV132) { try { return g.getV132(16, mapId) | 0; } catch (e) { return 0; } }
      const c = g.player;
      if (c && c.get && g.mapV132) { try { return g.mapV132(16, mapId) | 0; } catch (e) { /* noop */ } }
      return 0;
    }

    /**
     * 0-GB：三处「跳到主循环收尾」的 label 按源码语义接成结束事件，不再 blocked。
     *   · 4363（605329）→ 不消耗回合，直接回主循环（取消 / 收尾）
     *   · 4358（604861）→ 消耗一个回合后回主循环
     *   · 2459（236876）→ 剧情说完后的地图退出 / 场景切换（var_65(64)=var_65(850),1）
     * 其余未编进来的 label 仍如实 blocked。
     */
    missingJump(d) {
      const L = String(d.missing !== undefined ? d.missing : '?');
      if (L === '4363' || L === '4358' || L === '2459') {
        this.ended = true;
        const ev = { kind: 'end', via: L, unsupported: this.unsupported || [] };
        if (L === '4358') ev.endTurn = true;
        if (L === '2459') { ev.exitScene = true; ev.text = '（剧情结束，场景切换）'; }
        return ev;
      }
      const why = 'goto-' + L;
      this.blocked = why;
      return { kind: 'blocked', why, line: d.l, label: d.missing };
    }

    /** 记一次「本模块不渲染、直接跳过」的子程序调用（可审计，不静默） */
    noteSkip(L) {
      if (!this.skipped) this.skipped = {};
      this.skipped[L] = (this.skipped[L] | 0) + 1;
    }

    pushLog(msg) {
      if (!Array.isArray(this.log)) this.log = [];
      if (this.log.length < 200) this.log.push(msg);
    }

    // ------------------------------------------------------------------
    step() {
      if (this.ended) return { kind: 'end' };
      if (this.pending) return this.pending.evt;
      if (this.blocked) return { kind: 'blocked', why: this.blocked };
      if (!PROG) return { kind: 'blocked', why: 'no-table' };
      const ins = PROG.instrs;
      while (this.steps++ < MAX_STEPS) {
        if (this.pc < 0 || this.pc >= ins.length) return this.finish();
        const d = ins[this.pc];
        if (this.trace && this.trace.length < 20000) this.trace.push(this.pc);
        const S = this.S;
        switch (d.o) {
          case 'jf': {
            this.syncScope();
            const ok = ev(d.c, S);
            this.pullScope();
            if (!ok) {
              // 跳转目标没编进来（源码里在别的段）→ 如实报告，而不是跑到 pc = -1
              if ((d.to | 0) < 0) return this.missingJump(d);
              this.pc = d.to | 0;
            } else this.pc++;
            break;
          }
          case 'jmp':
            if ((d.to | 0) < 0) return this.missingJump(d);
            this.pc = d.to | 0;
            break;
          case 'end':
            return this.finish();
          case 'say':
            this.text = d.t;
            this.pc++;
            break;
          case 'sayok':
            this.text = d.t;
            this.pc++;
            return { kind: 'say', text: pick(d.t, this.lang, (this.syncScope(), this.S)) };
          case 'mreset':
            this.menu = [];
            this._scope.var701 = 0;
            this.var701 = 0;
            this.pc++;
            break;
          case 'minc':
            this.var701 = (this.var701 | 0) + 1;
            this._scope.var701 = this.var701;
            this.pc++;
            break;
          case 'mval': {
            const i = this.var701 | 0;
            this.syncScope();
            const v = ev(d.e, S) | 0;
            this.pullScope();
            if (!this.menu[i]) this.menu[i] = { v: 0, label: '' };
            this.menu[i].v = v;
            this.pc++;
            break;
          }
          case 'mlabel': {
            const i = this.var701 | 0;
            this.syncScope();
            const txt = labelText(d.t, S, this.lang);
            this.pullScope();
            if (!this.menu[i]) this.menu[i] = { v: 0, label: '' };
            this.menu[i].label = txt;
            this.pc++;
            break;
          }
          case 'show': {
            const items = this.menu.filter((x) => x && x.label);
            this.pc++;
            return {
              kind: 'menu',
              text: this.pickText(),
              items: items.map((x, i) => ({ i, v: x.v, label: x.label })),
              allowEsc: (this.var2060 | 0) === 1,
            };
          }
          case 'esc':
            this.var2060 = d.v | 0;
            this._scope.var2060 = this.var2060;
            this.pc++;
            break;
          case 'self':
          case 'buf':
            // `var_121(1) = "…"` —— 文本缓冲（部位清单 / 装备部位名列表都走它）
            // 汉化：同一层级的 ch 优先，缺译回退 jp / en
            this.buf1 = (d.v && (d.v.ch || d.v.jp || d.v.en)) || (typeof d.v === 'string' ? d.v : '');
            this.pc++;
            break;
          case 'txtef':
          case 'tagend':
          case 'invheader':
            this.pc++;
            break;
          case 'fclear':
            this.var1303 = 0;
            this._scope.var1303 = 0;
            this.pc++;
            break;
          case 'fset':
            this.var1303 = (this.var1303 | 0) + 1;
            this._scope.var1303 = this.var1303;
            this.pc++;
            break;
          case 'gset':
          case 'gadd':
          case 'ginc':
          case 'gdec': {
            if (!(this.g && this.g.setV65)) { this.pc++; break; }
            this.syncScope();
            const n = ev('(' + String(d.n) + ')', S) | 0;
            let v;
            if (d.o === 'gset') v = ev(d.e, S) | 0;
            else if (d.o === 'gadd') v = (this.g.getV65(n) | 0) + (ev(d.e, S) | 0);
            else if (d.o === 'ginc') v = (this.g.getV65(n) | 0) + 1;
            else v = (this.g.getV65(n) | 0) - 1;
            this.pullScope();
            // A49：世界移动脚本（389022-389094）通过 var_65(850) 切换世界地图。
            //   只在结束时与开场值不同才切换（脚本可能中途临时改写再还原）。
            this.g.setV65(n, v);
            if (n === 850) {
              this.worldChanged = ((v | 0) !== this.startWorld) ? (v | 0) : 0;
            }
            this.pc++;
            break;
          }
          case 'lset':
          case 'ladd':
          case 'linc':
          case 'ldec': {
            const n = d.n | 0;
            this.syncScope();
            if (d.o === 'lset') this._VX[n] = ev(d.e, S) | 0;
            else if (d.o === 'ladd') this._VX[n] = (this._VX[n] | 0) + (ev(d.e, S) | 0);
            else if (d.o === 'linc') this._VX[n] = (this._VX[n] | 0) + 1;
            else this._VX[n] = (this._VX[n] | 0) - 1;
            this.pullScope();
            this.pc++;
            break;
          }
          case 'lseta':
          case 'lsuba':
          case 'linca': {
            this.syncScope();
            const n = d.n | 0;
            const i = ev(d.i, S) | 0;
            const k = n * 1000 + i;
            if (d.o === 'lseta') this._VXA[k] = ev(d.e, S) | 0;
            else if (d.o === 'lsuba') this._VXA[k] = (this._VXA[k] | 0) - (ev(d.e, S) | 0);
            else this._VXA[k] = (this._VXA[k] | 0) + 1;
            this.pullScope();
            this.pc++;
            break;
          }
          case 'cset':
          case 'cadd':
          case 'csub': {
            const c = (d.tgt === 'player') ? this.player : this.var244;
            if (!c || !c.set) { this.pc++; break; }
            this.syncScope();
            const n = d.n | 0;
            const v = ev(d.e, S) | 0;
            this.pullScope();
            const old = c.get(n) | 0;
            c.set(n, d.o === 'cset' ? v : (d.o === 'cadd' ? old + v : old - v));
            if (n === 27 && d.o === 'cset') this.var1302 = v;
            this.pc++;
            break;
          }
          case 'gset0': {
            // var_63(n, 0) = ... —— 给玩家改名（本项目里只有 0 号有意义）
            if (!this.player || (d.n | 0) !== 0) { this.pc++; break; }
            this.syncScope();
            const v = ev(d.e, S);
            this.pullScope();
            if (typeof v === 'string' && v) this.player.name = v;
            this.pc++;
            break;
          }
          case 'iset':
          case 'isub': {
            // var_99(n, var_579) = 选中物；var_99(n, stat) = gosub 返回的物品槽
            const it = (d.tgt === 'stat') ? this.itemAt(this._scope.stat | 0) : this.item;
            if (!it) { this.pc++; break; }
            this.syncScope();
            const n = d.n | 0;
            const v = ev(d.e, S) | 0;
            this.pullScope();
            const old = (it.f[n] | 0);
            it.f[n] = d.o === 'iset' ? v : old - v;
            this.pc++;
            break;
          }
          case 'flt': {
            // `flt <等级>, <品质>` = 26150 的 #deffunc：
            //   var_636..639 = 0、var_514 = ""，然后
            //   var_640 = 等级（0 → calcobjlv(var_65(22))）、
            //   var_641 = 品质（0 → calcfixlv(2)）
            // ※ 不是 var_1023/1024 —— 那两个是 42/76 号地图的专用覆盖。
            this.syncScope();
            const a = d.a || [];
            const lv0 = a.length ? (ev(a[0], S) | 0) : 0;
            const q0 = a.length > 1 ? (ev(a[1], S) | 0) : 0;
            for (let i = 636; i <= 639; i++) this._VX[i] = 0;
            this.buf514 = '';
            this._VX[640] = lv0 === 0 ? calcObjLv(this.g, 0) : lv0;
            this._VX[641] = q0 === 0 ? calcFixLv(this.g, 2) : q0;
            this.pullScope();
            this.pc++;
            break;
          }
          case 'itemcreate': {
            this.doItemCreate(d);
            this.pc++;
            break;
          }
          case 'encadd': {
            this.doEncadd(d);
            this.pc++;
            break;
          }
          case 'itemfind': {
            this.doItemFind(d);
            this.pc++;
            break;
          }
          case 'snd':
            this.pc++;
            break;
          case 'repeat': {
            let n = -1;                    // -1 = 无限（源码里 `repeat` 不带参数）
            if (d.e) { this.syncScope(); n = ev(d.e, S) | 0; this.pullScope(); }
            this.loops.push({ i: 0, n, body: this.pc + 1 });
            this.pc++;
            break;
          }
          case 'loop': {
            const fr = this.loops[this.loops.length - 1];
            if (!fr) { this.pc++; break; }
            fr.i++;
            if (fr.n < 0 || fr.i < fr.n) {
              this._scope.cnt = fr.i;
              this.pc = fr.body;
            } else {
              this.loops.pop();
              this.pc++;
            }
            break;
          }
          case 'continue': {
            const fr = this.loops[this.loops.length - 1];
            if (fr) { this.pc = this.findLoop(fr.body); } else this.pc++;
            break;
          }
          case 'break': {
            const fr = this.loops[this.loops.length - 1];
            if (fr) { const lp = this.findLoop(fr.body); this.loops.pop(); this.pc = lp + 1; }
            else this.pc++;
            break;
          }
          case 'call': {
            const L = d.L;
            if (UI_GOSUB[L]) { this.pc++; break; }
            if (SCENE_GOSUB[L]) { this.noteSkip(L); this.pc++; break; }
            // 0-GD：脱衣 / 行為（gosub *label_2929/2930/2931）—— 玩家对当前
            //   对话 NPC 发起成对持续行动；发起方是玩家（源码对话分支的
            //   var_243=玩家 / var_244=NPC），随后脚本照常继续。
            if ((L === 2929 || L === 2930 || L === 2931) && Elona.Intimacy) {
              const type = (L === 2929) ? 11 : (L === 2930) ? 32 : 24;
              const npc = this.npc || (this.var244 || null);
              if (npc && this.g) Elona.Intimacy.beginPair(this.g, type, this.g.player, npc);
              this.pc++;
              break;
            }
            if (NATIVE_GOSUB[L]) {
              const ev0 = this.nativeGosub(L, d);
              if (ev0) return ev0;        // 需要玩家在列表里选 → 抛事件，等 answer()
              this.pc++;
              break;
            }
            // 编进同一张表的子程序（talkscripts 的 EXTRA_RANGES）→ 真 call/ret
            if (PROG.labels && PROG.labels[L] !== undefined && L !== undefined) {
              const t = PROG.labels[L] | 0;
              if (t >= 0 && t < ins.length && this.ret.length < 64) {
                this.ret.push(this.pc + 1);
                this.pc = t;
                break;
              }
            }
            // 外部子程序（本项目未移植）→ 如实报告，不假装成功
            this.blocked = 'gosub-' + L;
            return { kind: 'blocked', why: 'gosub-' + L, line: d.l, label: L };
          }
          case 'ret': {
            this.syncScope();
            if (d.e) this._scope.stat = ev(d.e, S) | 0;
            this.pullScope();
            const back = this.ret.pop();
            if (back === undefined) return this.finish();   // 主流程里的 return = 结束
            this.pc = back;
            break;
          }
          case 'characreate': {
            // `characreate <槽>, <物种|0=随机>, <x|-1/-3=自动>, <y>`（192863 的 #deffunc）
            // 走 CharaFactory（= *label_2238 + *label_2240 的移植），造完 var_581 = 槽号。
            const CF = Elona.CharaFactory;
            const a = d.a || [];
            this.syncScope();
            const slot = a[0] ? (ev(a[0], S) | 0) : 56;
            const idspec = a[1] ? (ev(a[1], S) | 0) : 0;
            const px = a[2] ? (ev(a[2], S) | 0) : -1;
            const py = a[3] ? (ev(a[3], S) | 0) : -1;
            this.pullScope();
            if (!CF || !CF.create) {
              // 没有 CharaFactory（例如纯脚本测试环境）→ 仍然如实拦住，不在 repeat 里空转
              this.blocked = 'characreate';
              return { kind: 'blocked', why: 'characreate', line: d.l, label: 'characreate' };
            }
            // 等级 / 品质来自 `flt`（var_640 / var_641）。没 flt 过就按 1 级、0 品质。
            const lv = (this._VX[640] | 0) > 0 ? (this._VX[640] | 0) : 1;
            const q = this._VX[641] | 0;
            const px2 = this.player ? (this.player.x | 0) : 0;
            const py2 = this.player ? (this.player.y | 0) : 0;
            let c = null;
            try {
              c = CF.create(this.g, idspec === 0 ? 0 : idspec, lv,
                px >= 0 ? px : px2, py >= 0 ? py : py2,
                { index: slot >= 0 ? slot : undefined, var641: q });
            } catch (e) { c = null; }
            this.setVx(581, c ? (c.index | 0) : slot);
            if (c) {
              c.set(25, q);                                // 219662：var_58(25) = var_641
              // prm_871 == -3 是「以敌对状态生成」的约定（源码里 -3 就是 var_58(9) 的敌对值，
              // 且 639 号分支生成后立刻断言 var_58(9)==-3）见差异表 A361
              if (px === -3) c.set(9, -3);
            } else {
              this.noteSkip('characreate-fail');
            }
            this.pc++;
            break;
          }
          // ---- 0-DT：原先直接跳过的常用语句 ----
          case 'cbitmod': {
            // `cbitmod <位号|变量>, <角色>, <0/1>`（280-287）
            const a = d.a || [];
            this.syncScope();
            const bit = a[0] ? (ev(a[0], S) | 0) : 0;
            // `cbitmod 974, var_244, 0` —— var_244 是**正在对话的 NPC 对象**，
            // 直接 | 0 会变成 0（= 玩家），这里单独取它的槽号
            const rawCi = a[1] ? String(a[1]) : '';
            let ci = a[1] ? (ev(a[1], S) | 0) : 0;
            if (/^var_?244$/.test(rawCi) && this.var244) ci = this.var244.index | 0;
            const on = a[2] ? (ev(a[2], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (c && Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit, on);
            this.pc++;
            break;
          }
          case 'modimp': {
            // `modimp <角色>, <增减>` / `modimp2 …`（193311 / 193418）
            const a = d.a || [];
            this.syncScope();
            const ci = a[0] ? (ev(a[0], S) | 0) : 0;
            const dv = a[1] ? (ev(a[1], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : (ci === 0 ? this.player : null);
            const R = Elona.Relation;
            if (c && R && (d.k === 2 ? R.modimp2 : R.modimp)) {
              try {
                const r = (d.k === 2) ? R.modimp2(c, dv, this.g) : R.modimp(c, dv, this.g);
                if (r && r.message) this.pushLog(r.message);
              } catch (e) { this.noteSkip('modimp'); }
            }
            this.pc++;
            break;
          }
          case 'modrank': {
            // `modrank <类别>, <增量>, [上限]`（31760）
            const a = d.a || [];
            this.syncScope();
            const cat = a[0] ? (ev(a[0], S) | 0) : 0;
            const dv = a[1] ? (ev(a[1], S) | 0) : 0;
            const cap = a[2] ? (ev(a[2], S) | 0) : 0;
            this.pullScope();
            if (Elona.Rank && Elona.Rank.modRank) {
              const r = Elona.Rank.modRank(this.g, cat, dv, cap);
              if (r && r.changed) this.pushLog(r.text);
            }
            this.pc++;
            break;
          }
          case 'skillexp': {
            // `skillexp <技能>, <角色>, <经验>, [除数], [教师]`（31926）
            const a = d.a || [];
            this.syncScope();
            const sk = a[0] ? (ev(a[0], S) | 0) : 0;
            const ci = a[1] ? (ev(a[1], S) | 0) : 0;
            const ex = a[2] ? (ev(a[2], S) | 0) : 0;
            const div = a[3] ? (ev(a[3], S) | 0) : 0;
            const tea = a[4] ? (ev(a[4], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (c && Elona.Stats && Elona.Stats.skillExp) {
              try { Elona.Stats.skillExp(c, sk, ci, ex, div, tea, this.g); }
              catch (e) { this.noteSkip('skillexp'); }
            }
            this.pc++;
            break;
          }
          case 'addbuff': {
            // `addbuff <角色>, <id>, <p1>, <p2>`（194682）
            const a = d.a || [];
            this.syncScope();
            const ci = a[0] ? (ev(a[0], S) | 0) : 0;
            const id = a[1] ? (ev(a[1], S) | 0) : 0;
            const p1 = a[2] ? (ev(a[2], S) | 0) : 0;
            const p2 = a[3] ? (ev(a[3], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (c && Elona.Status && Elona.Status.addbuff) {
              try { Elona.Status.addbuff(this.g, c, id, p1, p2); }
              catch (e) { this.noteSkip('addbuff'); }
            }
            this.pc++;
            break;
          }
          case 'matget': {
            // `matgetmain <材料>, <数量>, <原因>`（270325）
            const a = d.a || [];
            this.syncScope();
            const mid = a[0] ? (ev(a[0], S) | 0) : 0;
            const mn = a[1] ? (ev(a[1], S) | 0) : 1;
            const why = a[2] ? (ev(a[2], S) | 0) : 0;
            this.pullScope();
            if (Elona.Material && Elona.Material.add) {
              const r = Elona.Material.add(this.g, mid, mn, why);
              if (r && r.message) this.pushLog(r.message);
            }
            this.pc++;
            break;
          }
          case 'featset': {
            // `cell_featset <x>, <y>, <id>, <type>, <sub>, [arg]`（32311）
            const a = d.a || [];
            this.syncScope();
            const x = a[0] ? (ev(a[0], S) | 0) : 0;
            const y = a[1] ? (ev(a[1], S) | 0) : 0;
            const id = a[2] ? (ev(a[2], S) | 0) : 0;
            const ty = a[3] ? (ev(a[3], S) | 0) : 0;
            const sb = a[4] ? (ev(a[4], S) | 0) : 0;
            const ag = a[5] ? (ev(a[5], S) | 0) : -1;
            this.pullScope();
            if (Elona.MapFeat && Elona.MapFeat.write) {
              try { Elona.MapFeat.write(this.g, x, y, id, ty, sb, ag); }
              catch (e) { this.noteSkip('cell_featset'); }
            }
            this.pc++;
            break;
          }
          case 'movechara': {
            // `cell_movechara <角色>, <x>, <y>`
            const a = d.a || [];
            this.syncScope();
            const ci = a[0] ? (ev(a[0], S) | 0) : 0;
            const mx = a[1] ? (ev(a[1], S) | 0) : 0;
            const my = a[2] ? (ev(a[2], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (c) {
              c.x = mx; c.y = my;
              c.set(1, mx); c.set(2, my);
              if (this.g.syncCharaCells) this.g.syncCharaCells();
            }
            this.pc++;
            break;
          }
          case 'dmgcon': {
            // `dmgcon <角色>, <状态>, <强度>` —— 状态异常赋予
            const a = d.a || [];
            this.syncScope();
            const ci = a[0] ? (ev(a[0], S) | 0) : 0;
            const con = a[1] ? (ev(a[1], S) | 0) : 0;
            const pow = a[2] ? (ev(a[2], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (c && Elona.Resist && Elona.Resist.dmgcon && this.g.dmgconTable) {
              try { Elona.Resist.dmgcon(this.g, this.g.dmgconTable, c, con, pow); }
              catch (e) { this.noteSkip('dmgcon'); }
            }
            this.pc++;
            break;
          }
          case 'dmgsan': {
            // `dmgsan <角色>, <伤害>`（201480-201505）：以太/理智伤害 → var_58(86)
            const a = d.a || [];
            this.syncScope();
            const ci = a[0] ? (ev(a[0], S) | 0) : 0;
            const dmg = a[1] ? (ev(a[1], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            const rnd = (n) => ((this.g && this.g.rng) ? this.g.rng.rnd(Math.max(1, n | 0)) : 0);
            // 201481：san 满 100 且等级 >= 4 时免疫
            if (c && !((c.get(58) | 0) !== 100 && (c.get(25) | 0) >= 4)) {
              let per = Math.trunc((Elona.Stats && Elona.Stats.sorg ? Elona.Stats.sorg(c, 54) : 0) / 50);
              if (per <= 0) per = 1;
              let v = Math.trunc(dmg / per);
              if (ci < 16 && this.g && this.g.getV65 && this.g.getV65(166)) v = v - rnd(4) - 1;
              if ((c.get(257) | 0) > 0) v--;
              if (v > 0) c.set(86, (c.get(86) | 0) + v); else v = 1;
              if ((c.get(86) | 0) > 100) c.set(86, 100);
              if (rnd(10) === 0 || rnd(v + 1) > 5 || rnd((c.get(86) | 0) + 1) > 50) {
                if (Elona.Resist && Elona.Resist.dmgcon && this.g.dmgconTable) {
                  try { Elona.Resist.dmgcon(this.g, this.g.dmgconTable, c, 11, 100); }
                  catch (e) { this.noteSkip('dmgsan'); }
                }
              }
            }
            this.pc++;
            break;
          }
          case 'dmgspt': {
            // `dmgspt <角色>, <伤害>`（201451-201458）：SP 伤害，可为负（下限判定是 >=-50）
            const a = d.a || [];
            this.syncScope();
            const ci = a[0] ? (ev(a[0], S) | 0) : 0;
            const dmg = a[1] ? (ev(a[1], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (c && c.set) {
              // 201452：buff 70 期间免疫
              const guarded = Elona.Status && Elona.Status.findbuff
                && Elona.Status.findbuff(c, 70) !== -1;
              if (!guarded && (c.get(52) | 0) >= -50) c.set(52, (c.get(52) | 0) - dmg);
            }
            this.pc++;
            break;
          }
          case 'rowactend': {
            // `rowactend <角色>`（192931-192939）：清 140/141/142；角色 0 时连全局一起清
            this.syncScope();
            const ci = d.e ? (ev(d.e, S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (c && c.set) {
              c.set(140, 0); c.set(141, 0); c.set(142, 0);
              if (ci === 0) { this.rowactSkill = 0; this.rowactParam = 0; }
            }
            this.pc++;
            break;
          }
          case 'modkarma': {
            // `modkarma <角色>, <增减>` —— 只有玩家（角色 0）的业值有意义（var_58(49)）
            const a = d.a || [];
            this.syncScope();
            const ci = a[0] ? (ev(a[0], S) | 0) : 0;
            const dv = a[1] ? (ev(a[1], S) | 0) : 0;
            this.pullScope();
            if (ci === 0 && this.player && this.player.set) {
              this.player.set(49, (this.player.get(49) | 0) + dv);
            }
            this.pc++;
            break;
          }
          case 'rideend': {
            if (Elona.Riding && Elona.Riding.end) {
              try { Elona.Riding.end(this.g); } catch (e) { this.noteSkip('ride_end'); }
            }
            this.pc++;
            break;
          }
          case 'dmghp': {
            // `dmghp <角色>, <伤害>, [属性], [技能]` → Battle.applyDamage（197974 的移植）
            const a = d.a || [];
            this.syncScope();
            const ci = a[0] ? (ev(a[0], S) | 0) : 0;
            const dmg = a[1] ? (ev(a[1], S) | 0) : 0;
            const attr = a[2] ? (ev(a[2], S) | 0) : 0;
            this.pullScope();
            const t = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (t && Elona.Battle && Elona.Battle.applyDamage) {
              try {
                Elona.Battle.applyDamage(t, dmg, this.g, this.player, attr);
                if (this.g.syncCharaCells) this.g.syncCharaCells();
              } catch (e) { this.noteSkip('dmghp'); }
            } else this.noteSkip('dmghp');
            this.pc++;
            break;
          }
          case 'skillgain': {
            // `skillgain <角色>, <技能>, <等级加值>, <经验>`
            const a = d.a || [];
            this.syncScope();
            const ci = a[0] ? (ev(a[0], S) | 0) : 0;
            const sk = a[1] ? (ev(a[1], S) | 0) : 0;
            const lv = a[2] ? (ev(a[2], S) | 0) : 0;
            const ex = a[3] ? (ev(a[3], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (c && Elona.Stats && Elona.Stats.skillGain) {
              try { Elona.Stats.skillGain(c, ci, sk, lv, ex, this.g); } catch (e) { this.noteSkip('skillgain'); }
            }
            this.pc++;
            break;
          }
          case 'skillmod': {
            // `skillmod <技能>, <角色>, <经验>`
            const a = d.a || [];
            this.syncScope();
            const sk = a[0] ? (ev(a[0], S) | 0) : 0;
            const ci = a[1] ? (ev(a[1], S) | 0) : 0;
            const ex = a[2] ? (ev(a[2], S) | 0) : 0;
            this.pullScope();
            const c = (this.g && this.g.charas) ? this.g.charas[ci] : null;
            if (c && Elona.Stats && Elona.Stats.skillMod) {
              try { Elona.Stats.skillMod(c, sk, ci, ex, this.g); } catch (e) { this.noteSkip('skillmod'); }
            }
            this.pc++;
            break;
          }
          case 'vanquish': {
            this.syncScope();
            const idx = ev(d.e, S) | 0;
            this.pullScope();
            if (Elona.Chara && Elona.Chara.vanquish) { try { Elona.Chara.vanquish(this.g, idx); } catch (e) { /* noop */ } }
            this.pc++;
            break;
          }
          case 'invfind': {
            // `inv_find <id>, <mode>` —— 在背包里找指定物品，结果写 stat（找不到 -1）
            const a = d.a || [];
            this.syncScope();
            const id = a[0] ? (ev(a[0], S) | 0) : 0;
            this.pullScope();
            const inv = (this.player && this.player.inv) || [];
            let found = -1;
            for (let i = 0; i < inv.length; i++) {
              const it = inv[i];
              if (it && (it.f[3] | 0) === id && (it.f[0] | 0) > 0) { found = i; break; }
            }
            this._scope.stat = found;
            this.pc++;
            break;
          }
          case 'modgrowth':
          case 'cellfind':
          case 'cellchara':
          case 'cellmove':
          case 'evadd':
          case 'msg_halt':
          case 'raw':
          default:
            this.unsupported = this.unsupported || [];
            if (this.unsupported.length < 8) {
              this.unsupported.push({ l: d.l, o: d.o, src: d.s || '' });
            }
            this.pc++;
            break;
        }
      }
      this.blocked = 'step-limit';
      return { kind: 'blocked', why: 'step-limit' };
    }

    findLoop(from) {
      const ins = PROG.instrs;
      let depth = 0;
      for (let i = from; i < ins.length; i++) {
        if (ins[i].o === 'repeat') depth++;
        else if (ins[i].o === 'loop') {
          if (depth === 0) return i;
          depth--;
        }
      }
      return ins.length - 1;
    }

    doItemCreate(d) {
      const DB = Elona.ItemDB;
      if (!DB || !DB.createItem) return;
      this.syncScope();
      const a = (d.a || []).map((x) => ev(x, this.S) | 0);
      this.pullScope();
      // itemcreate id, x, y, ...（-1 = 放在背包/地面）
      const id = a[0] | 0;
      if (id <= 0) return;
      try {
        const it = DB.createItem(id, 1, this.g && this.g.rng);
        if (!it) return;
        if (Elona.ItemDB && Elona.ItemDB.identify) { /* 保持未鉴定，与原版一致 */ }
        if (this.g && this.g.giveItem) this.g.giveItem(it);
        else if (this.player && Array.isArray(this.player.inv)) this.player.inv.push(it);
      } catch (e) { /* noop */ }
    }

    doEncadd(d) {
      const DB = Elona.ItemDB;
      if (!DB || !DB.encadd) return;
      this.syncScope();
      const a = (d.a || []).map((x) => ev(x, this.S) | 0);
      this.pullScope();
      try { DB.encadd(this.g, this.player, a[0], a[1], a[2], a[3]); } catch (e) { /* noop */ }
    }

    doItemFind(d) {
      const DB = Elona.ItemDB;
      if (!DB || !DB.find) return;
      this.syncScope();
      const a = (d.a || []).map((x) => ev(x, this.S) | 0);
      this.pullScope();
      let idx = -1;
      try { idx = DB.find(this.player, a[0]) ; } catch (e) { idx = -1; }
      this._VX[400] = idx | 0;         // var_400 常用来接 item_find 的结果
    }

    finish() {
      this.ended = true;
      return { kind: 'end', unsupported: this.unsupported || [] };
    }

    /** 选择 */
    answer(v) {
      // 列表窗（2683 / 2824）：把选择写回 stat / var_579，然后继续跑
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        if (p.kind === 'chara') {
          this.setStat(v | 0);       // `return var_400`
          this.setVx(243, 0);
          this.setVx(761, 0);
        } else {
          this.setVx(579, v | 0);    // 选中物品槽号
          this._scope.var138 = 1;    // 非 Esc 键（372 处 `var_138 == var_150` 判定）
          this.setStat(1);
        }
        this.pc++;
        return this;
      }
      this.var506 = v | 0;
      this.var134 = 0;
      this.var2612 = 0;
      this._scope.var506 = this.var506;
      this._scope.var134 = 0;
      this._scope.var2612 = 0;
      return this;
    }

    /** Esc */
    cancel() {
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        if (p.kind === 'chara') {
          this.setStat(-1);          // 284573：`return -1`
        } else {
          this.setStat(0);
          this._scope.var138 = 0;
          this._scope.var150 = 0;    // 371658：var_138 == var_150 → 视为取消
        }
        this.pc++;
        return this;
      }
      this.var506 = -1;
      this.var134 = 1;
      this.var2612 = 1;
      this._scope.var506 = -1;
      this._scope.var134 = 1;
      this._scope.var2612 = 1;
      return this;
    }

    /** 当前台词（带占位符替换） */
    pickText() {
      this.syncScope();
      return pick(this.text, this.lang, this.S);
    }

    /** 当前说话者 */
    get speaker() { return this.var244 || this.npc; }
  }

  const Dialogue = {
    setTable, hasScript, branchOf, serviceBranchOf,
    STD_LABEL, UI_GOSUB, NATIVE_GOSUB,

    /** 是否该由脚本接管（原版：role/type 6 且 槽位 >= 16 或种族 1034） */
    canTalk(npc) {
      if (!npc) return false;
      return hasScript(npc.get ? (npc.get(27) | 0) : 0);
    },

    /**
     * 是否走服务对话链（`*label_3031` → `*label_3033`，条件是 `cbit 982`）。
     * 服务号在 `var_58(150)`，目前已编译 12 个（13 / 23 / 26 / 1025 / 2000-2008）。
     */
    canTalkService(npc) {
      if (!npc || !npc.get) return false;
      if (!(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(npc, 982))) return false;
      return !!serviceBranchOf(npc.get(150) | 0);
    },

    start(g, npc, opts) {
      if (!PROG) return null;
      if (!npc) return null;
      return new Session(g, npc, opts);
    },

    get ready() { return !!PROG; },
    get branchCount() { return BRANCHES ? BRANCHES.length : 0; },
  };

  Elona.Dialogue = Dialogue;
})(typeof window !== 'undefined' ? window : globalThis);
