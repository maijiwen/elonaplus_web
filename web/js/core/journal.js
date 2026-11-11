'use strict';
/**
 * 冒险日记（ジャーナル）—— 原版 `*label_2700`（285929-286136）及其四个文本块。
 *
 * 原版把整本日记拼进一个 note 缓冲，再一次性画到 736×448 的窗口里：
 *
 *   - News -            285944  var_440 的最新消息（空则 "No news"）
 *   - Quest -           285955  主线（*label_0268）→ 每日（*label_0269）→ 子任务（*label_0270）
 *   - Quest Item -      285973  *label_0271
 *   - Title & Ranking - 285986  9 类位次 + 给料 + EX 竞技场
 *   - Income & Expense- 286011  给料合计 / 人件费 / 维持费 / 税金 / 预付 / 未付账单
 *   - Records of Adv. - 286046  var_2205 >= 1 时才出（本项目未接，见差异表）
 *   - Completed Quests- 286132  以 var_428 = 1 再跑一遍 *label_0270
 *
 * 四个文本块（合计 2,000 行）是「往缓冲追加行」的线性代码：
 *   *label_0268（19999-20202，204 行）主线四部曲
 *   *label_0269（20203-20311，109 行）每日委托
 *   *label_0270（20312-21883，1,572 行）56 个子任务
 *   *label_0271（21884-21963，80 行）Quest Item
 * 由
 * `tools/extract_journal.py` 编译成 op 列表存进 `journal.json`，本文件负责执行：
 *
 *   set/note/notev/blank/add/addv/stage/setslot/clearslot/setp58/ret
 *
 * 条件 AST 里的量：slot（var_65(n)）、loc（var_400）、p58（var_58(n,0)）、mode（var_428）。
 *
 * 【与原版的差异】
 *   · 正文取 `lang()` 的 **en** 分支（原版 jp/en 双语，本项目未做中译）。
 *   · 两栏对齐用的 `noteadd ""` 补白按原样保留（每段末尾的空白行），但不做
 *     半页分栏 —— 面板是纵向滚动，不是翻页书。
 *   · `talk_conv` 的逐字演出与 `snd` 音效不播。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  let TABLE = null;
  let BOARD = null;   // 委托文本表 *label_0272 查的就是它

  async function load() {
    if (TABLE) return TABLE;
    TABLE = await Elona.Data.table('journal');
    // 委托文本表（data/board.txt，由 extract_board.py 提取）
    BOARD = await Elona.Data.table('board').catch(() => null);
    return TABLE;
  }

  function ready() { return !!TABLE; }

  // ------------------------------------------------------------------
  // 求值
  // ------------------------------------------------------------------
  function slotOf(g, n) { return g.getV65 ? (g.getV65(n) | 0) : 0; }

  function evalAst(node, env) {
    if (!node) return 0;
    switch (node.k) {
      case 'num': return node.v;
      case 'slot': return env.slot(node.n);
      case 'p58': return env.p58(node.n);
      case 'loc': return env.vars.var_400 | 0;
      case 'mode': return env.mode | 0;
      case 'var': {
        const v = env.vars[node.name];
        return (v === undefined) ? 0 : v;
      }
      case 'strarr': {
        const t = TABLE.strs && TABLE.strs[node.name];
        if (!t) return '';
        const arr = (env.lang === 'jp') ? t.jp : t.en;
        const i = evalAst(node.i, env) | 0;
        return (arr && arr[i] !== undefined) ? arr[i] : '';
      }
      case 'refchara': {
        const id = evalAst(node.args && node.args[0], env) | 0;
        const rec = Elona.CharaFactory && Elona.CharaFactory.ref ? Elona.CharaFactory.ref(id) : null;
        return rec ? (rec.nameCh || rec.nameEn || rec.nameJp || ('#' + id)) : ('#' + id);
      }
      case 'call': return 0;                       // 未支持的外部函数
      case 'bin': {
        const a = evalAst(node.a, env), b = evalAst(node.b, env);
        if (node.op === '+') {
          if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);
          return (a | 0) + (b | 0);
        }
        const x = a | 0, y = b | 0;
        if (node.op === '-') return x - y;
        if (node.op === '*') return x * y;
        if (node.op === '\\') return idiv(x, y);
        return 0;
      }
      case 'cmp': {
        const a = num(evalAst(node.a, env)), b = num(evalAst(node.b, env));
        switch (node.op) {
          case '==': return a === b ? 1 : 0;
          case '!=': return a !== b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          case '<': return a < b ? 1 : 0;
          default: return 0;
        }
      }
      case 'and': return (evalAst(node.a, env) && evalAst(node.b, env)) ? 1 : 0;
      case 'or': return (evalAst(node.a, env) || evalAst(node.b, env)) ? 1 : 0;
      default: return 0;
    }
  }

  function num(v) {
    if (typeof v === 'number') return v | 0;
    const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }

  /** 拼接部件 → 字符串 */
  function render(parts, env) {
    if (!parts) return '';
    let s = '';
    for (const p of parts) {
      if (p.t !== undefined) s += p.t;
      else if (p.e !== undefined) s += String(evalAst(p.e, env));
      else if (p.x !== undefined) s += '';          // 提取时就没认出来的表达式
    }
    return s;
  }

  // ------------------------------------------------------------------
  // 执行一段 op 列表
  // ------------------------------------------------------------------
  /** 取 op 在当前语言下的文本 */
  function loc(op, env) {
    const t = op.text || {};
    // jp = 源码日文 / ch = 汉化 / en = 英文；缺哪个就退回日文
    return render(t[env.lang] || t.jp || t.en, env);
  }

  // `@QM[...]` / `@QD<...>` 这样的**整行**颜色标记：源码 *label_2701（286160-286195）
  //   只剥掉前 3 个字符（"@QM"），方括号/尖括号随文本一起显示。
  const HEAD = /^@Q([SMDLC])([\[<])([\s\S]*)([\]>])$/;
  const HEAD_CLS = { M: 'qm', D: 'qd', C: 'qc', S: 'qs', L: 'ql' };

  /** 行内的 `@QM<...>` / `@QD<...>` 是 HSP 的行内命令，去掉标记保留内容 */
  function stripInline(text) {
    return String(text).replace(/@Q[MSD]<([^>]*)>/g, '$1');
  }

  function classify(text) {
    const raw = String(text);
    const m = HEAD.exec(raw.trim());
    if (m) {
      // 保留源码里的括号（截图里也是 ［…］ / ＜…＞ 一起显示）
      return { cls: HEAD_CLS[m[1]] || 'qm', text: m[2] + m[3] + m[4] };
    }
    const s = stripInline(raw);
    if (s.startsWith('@BL')) return { cls: 'blue', text: s.slice(3).trim() };
    if (s.startsWith('@RE')) return { cls: 'red', text: s.slice(3).trim() };
    return { cls: 'body', text: s };
  }

  /**
   * @param {string} name  story | daily | quests | items
   * @param {object} env
   * @returns {Array<{cls:string,text:string}>}
   */
  function run(name, env) {
    const blk = TABLE && TABLE.blocks && TABLE.blocks[name];
    if (!blk) return [];
    const out = [];
    const vars = env.vars;
    const push = (text) => {
      if (text === '' || text === undefined) out.push({ cls: 'blank', text: '' });
      else out.push(classify(String(text)));
    };

    for (const op of blk.ops) {
      if (op.op === 'ret') break;
      if (op.c && !evalAst(op.c, env)) continue;
      switch (op.op) {
        case 'set':
          vars[op.var] = loc(op, env);
          if (op.slot) env.curSlot = op.slot;
          break;
        case 'setslot':
          env.curSlot = op.n;
          vars.var_400 = slotOf(env.g, op.n);
          break;
        case 'clearslot':
          env.curSlot = null;
          vars.var_400 = 0;
          break;
        case 'note': {
          let t = loc(op, env);
          if (op.appendVar) t += String(vars[op.appendVar] || '');
          push(t);
          break;
        }
        case 'notev':
          push(String(vars[op.var] || ''));
          break;
        case 'blank':
          out.push({ cls: 'blank', text: '' });
          break;
        case 'add':
          push(loc(op, env));
          break;
        case 'addv':
          push(String(vars[op.var] || ''));
          break;
        case 'stage': {
          const title = String(vars.var_121 || '');
          const body = String(vars.var_426 || '');
          push(title ? ('(' + title + ')\n' + body) : body);
          break;
        }
        case 'setp58':
          if (env.g.player && env.g.player.set) env.g.player.set(op.n, op.v);
          break;
        default:
          break;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // 各段
  // ------------------------------------------------------------------
  function newEnv(g, lang, mode) {
    return {
      // lang: 'jp' 源码日文 / 'ch' 汉化 / 'en' 英文（日记书本固定用 jp）
      g, lang: (lang === 'jp' || lang === 'ch') ? lang : 'en', mode: mode | 0,
      vars: {}, curSlot: null,
      slot: (n) => slotOf(g, n),
      p58: (n) => (g.player && g.player.get ? (g.player.get(n) | 0) : 0),
    };
  }

  /** - News - ：原版显示 var_440（最新一条消息），本项目未接消息池 */
  function news() {
    return [{ cls: 'body', text: 'No news' }];
  }

  /** - Quest - ：主线 + 每日 + 子任务（*label_0268 / 0269 / 0270） */
  function questSection(g, lang) {
    const out = [];
    const env = newEnv(g, lang, 0);
    out.push(...run('story', env));
    out.push(...run('daily', env));
    out.push(...run('quests', env));
    return out;
  }

  /** - Quest Item - （*label_0271） */
  function itemSection(g, lang) {
    return run('items', newEnv(g, lang, 0));
  }

  /** - Title & Ranking - （285986-286006） */
  function rankingSection(g, lang) {
    const jp = (lang === 'jp');
    const ch = (lang === 'ch');
    const out = [];
    const deep = slotOf(g, 189);
    out.push({
      cls: 'body',
      text: jp ? `最深攻略階層: ${deep}階相当`
        : (ch ? `最深攻略层数：${deep} 层相当` : `ClearDeep: ${deep} level`),
    });
    const ally = deep + 20;
    out.push({
      cls: 'body',
      text: jp ? `[レベル${ally}までの仲間が戦闘時に従う]`
        : (ch ? `[等级 ${ally} 以下的同伴会在战斗中跟随]`
          : `[Allies up to level ${ally} will follow in battle]`),
    });
    out.push({ cls: 'blank', text: '' });
    out.push({ cls: 'blank', text: '' });
    for (let cat = 0; cat < 9; cat++) {
      const score = slotOf(g, 120 + cat);
      if (score >= 10000) continue;
      const title = Elona.Rank && Elona.Rank.title ? Elona.Rank.title(g, cat, lang) : '';
      out.push({ cls: 'body', text: `${title} Rank.${idiv(score, 100)}` });
      const income = Elona.Economy && Elona.Economy.calcIncome ? Elona.Economy.calcIncome(g, cat) : 0;
      let pay = jp ? `給料: 約 ${income} gold  `
        : (ch ? `工资：约 ${income} gold  ` : `Pay: About ${income} gold pieces `);
      // 286000：3/4/5/8 号（竞技场、博物馆等）没有期限
      if (!(cat === 3 || cat === 4 || cat === 5 || cat === 8)) {
        pay += (jp ? 'ノルマ: ' : (ch ? '期限：' : '\nDeadline: '))
          + slotOf(g, 140 + cat) + (jp ? '日以内' : (ch ? ' 天内' : ' Days left'));
      }
      out.push({ cls: 'body', text: pay });
      out.push({ cls: 'blank', text: '' });
    }
    const wins = slotOf(g, 802), best = slotOf(g, 803);
    out.push({
      cls: 'body',
      text: jp ? `EXバトル: 勝利 ${wins}回 最高Lv${best}`
        : (ch ? `EX 竞技场：胜利 ${wins} 次　最高 Lv${best}`
          : `EX Arena Wins:${wins}  Highest Level:${ordinal(best, lang)}`),
    });
    return { lines: out, total: income_total(g, deep) };
  }

  function ordinal(n, lang) {
    if (Elona.Rank && Elona.Rank.ordinal) return Elona.Rank.ordinal(n, lang);
    return String(n);
  }

  /** var_2203 的初值：limit(var_58(34,0)/10,100,25000) + 超出部分/100（285980-285984） */
  function income_total(g, deep) {
    const fame = g.player && g.player.get ? (g.player.get(34) | 0) : 0;
    let v = limit(idiv(fame, 10), 100, 25000);
    if (fame >= 25000) v += idiv(fame - 25000, 100);
    for (let cat = 0; cat < 9; cat++) {
      if (slotOf(g, 120 + cat) >= 10000) continue;
      if (Elona.Economy && Elona.Economy.calcIncome) v += Elona.Economy.calcIncome(g, cat);
    }
    void deep;
    return v;
  }

  /** - Income & Expense - （286011-286041） */
  function incomeSection(g, lang) {
    const jp = (lang === 'jp');
    const ch = (lang === 'ch');
    const total = income_total(g, slotOf(g, 189));
    const labor = slotOf(g, 170);
    const build = Elona.Economy && Elona.Economy.calcBuilding ? Elona.Economy.calcBuilding(g) : 0;
    const tax = Elona.Economy && Elona.Economy.calcTax ? Elona.Economy.calcTax(g) : 0;
    const prepaid = Elona.Economy && Elona.Economy.prepaid ? Elona.Economy.prepaid(g) : 0;
    const unpaid = slotOf(g, 179);
    const out = [];
    if (jp) {
      out.push({ cls: 'body', text: '◆ 給料(毎月1日と15日に支給)' });
      out.push({ cls: 'blue', text: `合計　　 : 約 ${total} GP` });
      out.push({ cls: 'blank', text: '' });
      out.push({ cls: 'body', text: '◆ 請求書内訳(毎月1日に発行)' });
      out.push({ cls: 'red', text: `人件費  : 約 ${labor} GP` });
      out.push({ cls: 'red', text: `維持費  : 約 ${build} GP` });
      out.push({ cls: 'red', text: `税金    : 約 ${tax} GP` });
      out.push({ cls: 'red', text: `合計　  : 約 ${labor + build + tax} GP` });
      if (prepaid > 0) out.push({ cls: 'body', text: `現在先払いの残額は${prepaid} GP` });
      out.push({ cls: 'blank', text: '' });
      out.push({ cls: 'body', text: `現在未払いの請求書は${unpaid}枚` });
    } else if (ch) {
      out.push({ cls: 'body', text: '◆ 工资（每月 1 日与 15 日发放）' });
      out.push({ cls: 'blue', text: `合计　　 ：约 ${total} GP` });
      out.push({ cls: 'blank', text: '' });
      out.push({ cls: 'body', text: '◆ 账单明细（每月 1 日开出）' });
      out.push({ cls: 'red', text: `人工费　 ：约 ${labor} GP` });
      out.push({ cls: 'red', text: `维持费　 ：约 ${build} GP` });
      out.push({ cls: 'red', text: `税金　　 ：约 ${tax} GP` });
      out.push({ cls: 'red', text: `合计　　 ：约 ${labor + build + tax} GP` });
      if (prepaid > 0) out.push({ cls: 'body', text: `目前预付余额为 ${prepaid} GP` });
      out.push({ cls: 'blank', text: '' });
      out.push({ cls: 'body', text: `目前有 ${unpaid} 张未付账单` });
    } else {
      out.push({ cls: 'body', text: 'Salary (Paid every 1st and 15th day)' });
      out.push({ cls: 'blue', text: `Sum    : About ${total} GP` });
      out.push({ cls: 'blank', text: '' });
      out.push({ cls: 'body', text: 'Bills  (Issued every 1st day)' });
      out.push({ cls: 'red', text: `Labor  : About ${labor} GP` });
      out.push({ cls: 'red', text: `Maint. : About ${build} GP` });
      out.push({ cls: 'red', text: `Tax    : About ${tax} GP` });
      out.push({ cls: 'red', text: `Sum    : About ${labor + build + tax} GP` });
      if (prepaid > 0) out.push({ cls: 'body', text: `Prepaid Balance ${prepaid} GP` });
      out.push({ cls: 'blank', text: '' });
      out.push({ cls: 'body', text: `You have ${unpaid} unpaid bills.` });
    }
    return out;
  }

  /** - Completed Quests - ：var_428 = 1 再跑一遍 *label_0270 */
  function completedSection(g, lang) {
    return run('quests', newEnv(g, lang, 1));
  }

  /**
   * 「◆ これまでのあなた」统计段 —— 286050-286085（var_2205 == 2 时的后半段见 286086-286114）。
   *   所有计数都直接读 var_65(250+n) / var_65(2)；未接线的项显示 0（原版同样如此）。
   */
  function miscSection(g, lang) {
    const v = (n) => (g && typeof g.getV65 === 'function') ? (g.getV65(n) | 0) : 0;
    const V = (n) => v(250 + n);
    const ch = (lang === 'ch');
    const jp = (lang === 'jp');
    const out = [];
    const p = (t) => out.push({ cls: 'body', text: t });
    /** 行标签：中文 / 日文（原版）二选一 */
    const L = (zh, jpText) => (ch ? zh : jpText);
    out.push({ cls: 'head', text: L('◆ 至今为止的你', '◆ これまでのあなた') });
    out.push({ cls: 'blank', text: '' });
    p(`${L('　奈菲亚制霸数　　　：', '　ネフィア制覇数　　　:')} ${V(24)}`);
    p(`${L('　杀害数　　　　　　：', '　殺害数　　　　　　　:')} ${v(2)}`);          // 286053
    p(`${L('　决斗经验　　　　　：', '　決闘の経験　　　　　:')} ${V(59)}`);
    p(`${L('　委托达成数　　　　：', '　依頼達成数　　　　　:')} ${V(25)}`);
    out.push({ cls: 'blank', text: '' });
    p(`${L('　世界移动距离　　　：', '　世界移動距離　　　　:')} ${V(26)} ${jp ? 'マイル' : (ch ? '英里' : 'Miles')}`);   // 286057
    p(`${L('　生产数（炼金术）　：', '　生産数(錬金術)　　　:')} ${V(47)}`);
    p(`${L('　生产数（木工）　　：', '　生産数(大工)　　　　:')} ${V(48)}`);
    p(`${L('　生产数（宝石加工）：', '　生産数(宝石細工)　　:')} ${V(49)}`);
    p(`${L('　生产数（裁缝）　　：', '　生産数(裁縫)　　　　:')} ${V(50)}`);
    out.push({ cls: 'blank', text: '' });
    p(`${L('　最大普通伤害　　　：', '　最大通常ダメージ　　:')} ${V(27)}`);
    p(`${L('　挖坏的墙壁数　　　：', '　掘り壊した壁の数　　:')} ${V(46)}`);
    p(`${L('　总睡眠时间　　　　：', '　総睡眠時間　　　　　:')} ${V(39)} ${jp ? '時間' : (ch ? '小时' : 'Hours')}`);
    p(`${L('　经过天数　　　　　：', '　経過日　　　　　　　:')} ${v(7)} ${jp ? '日' : (ch ? '天' : 'Days')}`);          // 286066
    p(`${L('　许愿发生次数　　　：', '　願い発生回数　　　　:')} ${V(36)}`);
    out.push({ cls: 'blank', text: '' });
    p(`${L('　家中来访客人数　　：', '　わが家への訪問客　　:')} ${V(51)} ${jp ? '人' : (ch ? '人' : 'Guest')}`);
    p(`${L('　宝物发掘次数　　　：', '　宝発掘回数　　　　　:')} ${V(33)}`);
    p(`${L('　击溃的盗贼团数量　：', '　潰した盗賊団の数　　:')} ${V(40)}`);
    p(`${L('　竞技场总胜数　　　：', '　アリーナ総勝数　　　:')} ${V(57)}`);
    p(`${L('　宠物竞技场总胜数　：', '　Ｐアリーナ総勝数　　:')} ${V(58)}`);
    out.push({ cls: 'blank', text: '' });
    p(`${L('　白金币入手数　　　：', '　ﾌﾟﾗﾁﾅ硬貨入手数　　 :')} ${V(41)} ${jp ? '枚' : (ch ? '枚' : 'Plat')}`);
    p(`${L('　PC 技能加成入手数 ：', '　PCｽｷﾙﾎﾞｰﾅｽ入手数　　:')} ${V(60)}`);
    p(`${L('　法术加成入手数　　：', '　ｽﾍﾟﾙﾎﾞｰﾅｽ入手数　　 :')} ${V(61)}`);
    // 286080-286085：クイズ最高記録只在 var_65(250+2) >= 370 时显示
    if (V(2) >= 370) p(`${L('　猜谜最高记录　　　：', '　クイズ最高記録　　　:')} ${V(308)} ${jp ? '点' : (ch ? '分' : 'points')}`);
    return out;
  }

  /**
   * 整本日记。
   * @param {object} g
   * @param {object} [opts] {lang:'en'|'jp'}
   * @returns {Array<{title:string, lines:Array}>}
   */
  function sections(g, opts) {
    if (!ready()) return [];
    const lang = (opts && opts.lang) || 'en';
    const out = [];
    // 0-GL：`addnews`（590276 / 590290）写入 g.news，日志的 News 段读真实消息池
    out.push({ title: 'News', lines: (Elona.Adventurer && typeof Elona.Adventurer.news === 'function')
      ? Elona.Adventurer.news(g, lang) : news() });
    out.push({ title: 'Quest', lines: questSection(g, lang) });
    out.push({ title: 'Quest Item', lines: itemSection(g, lang) });
    out.push({ title: 'Title & Ranking', lines: rankingSection(g, lang).lines });
    out.push({ title: 'Income & Expense', lines: incomeSection(g, lang) });
    // 286050-286085：「◆ これまでのあなた」统计段
    out.push({ title: 'Records', lines: miscSection(g, lang) });
    out.push({ title: 'Completed Quests', lines: completedSection(g, lang) });
    return out;
  }

  // ------------------------------------------------------------------
  // 委托栏（*label_0273，21987-22184）—— 日记里「进行中的委托」
  // ------------------------------------------------------------------
  /** var_285：报酬物品的类别名（8795-8800） */
  const REWARD_CATS = { 1: 'equipment', 2: 'magical goods', 3: 'armor', 4: 'weapons', 5: 'ores', 6: 'furnitures' };

  /** 英文冠词（cnvarticle） */
  function article(s) {
    const t = String(s || '');
    if (!t) return t;
    return (/^[aeiou]/i.test(t) ? 'an ' : 'a ') + t;
  }

  /** 重量（cnvweight）：物品重量以克记，显示成 X.Xs */
  function weightText(w) {
    const g = (w | 0) / 1000;
    return (Math.round(g * 10) / 10).toFixed(1) + 's';
  }

  function itemName(id) {
    if (!id) return 'item';
    return Elona.ItemDB ? Elona.ItemDB.name(id | 0, 'en') : ('item ' + id);
  }

  function creatureOf(id) {
    const rec = Elona.CharaFactory && Elona.CharaFactory.ref ? Elona.CharaFactory.ref(id | 0) : null;
    return rec ? (rec.nameCh || rec.nameEn || rec.nameJp || ('#' + id)) : ('#' + id);
  }

  function mapNameOf(id) {
    if (Elona.Sites && Elona.Sites.nameOf) {
      const n = Elona.Sites.nameOf(id | 0, 'en');
      if (n) return n;
    }
    return '';
  }

  /**
   * `*label_0272`（21964-21986）：从 board.txt 里按 key + 语言抽一行，拆成 [名称, 正文]。
   * 原版用 `rnd(noteinfo(0) - 1) + 1` 抽行，这里等价为 0 基随机。
   */
  function boardLine(key, lang, g) {
    const t = BOARD && BOARD[key];
    if (!t) return null;
    const arr = (lang === 'jp') ? t.jp : t.en;
    if (!arr || !arr.length) return null;
    const n = arr.length;
    const i = (g && g.rng && g.rng.rnd) ? (g.rng.rnd(n) | 0) : 0;
    const line = arr[Math.min(Math.max(i, 0), n - 1)];
    const p = line.indexOf(':');
    if (p < 0) return { name: line, body: '' };
    return { name: line.slice(0, p), body: line.slice(p + 1) };
  }

  /** 这条委托查 board.txt 的哪个键（21987-22123 各分支里的 `var_121 = "%XXX,..."`） */
  function questKey(g, q) {
    const t = q.type | 0;
    const cat = (Elona.ItemDB && q.itemId) ? (Elona.ItemDB.ref(q.itemId, 5) | 0) : 0;
    const exact = {
      1001: 'HUNT', 1004: 'SUPPLY', 1006: 'HARVEST', 1008: 'CONQUER',
      1009: 'PARTY', 1010: 'HUNTEX', 1011: 'COLLECT',
      1002: 'DELIVER,' + cat,
      1003: 'COOK,' + ((q.subtype | 0) || (q.targetData | 0)),
      1007: 'ESCORT,' + (q.subtype | 0),
      1013: 'TRAP,' + (q.subtype | 0),
    }[t];
    if (exact && BOARD && BOARD[exact]) return exact;
    // 找不到精确键时退回同前缀的第一条（board.txt 的键集合固定，见 extract_board.py 输出）
    const base = String(exact || '').split(',')[0];
    if (BOARD) {
      const keys = Object.keys(BOARD);
      const hit = keys.find((k) => k === base) || keys.find((k) => k.split(',')[0] === base);
      if (hit) return hit;
    }
    return exact || '';
  }

  /**
   * var_121(4) / var_121(6)：这条委托要做什么（21988-22123 各分支）。
   * 原文里 1006/1009/1013 会在「当前正在这张委托地图里」时追加 `(現在N)`。
   */
  function objectiveText(g, q, lang) {
    const jp = (lang === 'jp');
    const now = (g.getV65 ? (g.getV65(72) | 0) : 0) === (q.id | 0);
    const cur = (v) => (jp ? '(現在' + v + ')' : ' (Now ' + v + ')');
    switch (q.type | 0) {
      case 1006: {                                     // HARVEST：缴纳作物（22017-22027）
        const w = weightText(q.targetData);
        let s = jp ? (w + 'の作物の納入') : ('Gather harvests weight ' + w + '.');
        if (now) s += cur(jp ? weightText(q.progress) : weightText(q.progress));
        return s;
      }
      case 1013: {                                     // TRAP（22028-22038）
        const n = q.targetData | 0;
        let s = jp ? (n + 'ポイントの罠の撤去') : ('Remove trap at ' + n + ' points.');
        if (now) s += cur(q.progress | 0);
        return s;
      }
      case 1009: {                                     // PARTY（22039-22049）
        const n = q.targetData | 0;
        let s = jp ? (n + 'ポイントの獲得') : ('Gather ' + n + '.');
        if (now) s += cur(q.progress | 0);
        return s;
      }
      case 1007: {                                     // ESCORT（22050-22056）
        const dest = mapNameOf(q.targetData) || q.targetMapName || 'somewhere';
        return jp ? ('クライアントを' + dest + 'まで護衛') : ('Escort the client to ' + dest + '.');
      }
      case 1001:                                       // HUNT（22057-22062）
        return jp ? '全ての敵の殲滅' : 'Eliminate monsters.';
      case 1004: {                                     // SUPPLY（22063-22068）
        const it = article(itemName(q.itemId));
        return jp ? (it + 'の納入') : ('Give ' + it + ' to the client.');
      }
      case 1002: {                                     // DELIVER（22069-22080）
        const it = article(itemName(q.itemId));
        const dest = mapNameOf(q.targetData || (q.mapId | 0)) || q.targetMapName || q.map || 'somewhere';
        const who = q.targetName || 'someone';
        return jp ? (dest + 'に住む' + who + 'に' + it + 'を配達')
          : ('Deliver ' + it + ' to ' + who + ' who lives in ' + dest + '.');
      }
      case 1003: {                                     // COOK（22081-22089）
        const food = article(itemName(q.itemId || (q.targetData | 0)));
        return jp ? (food + 'の納入') : ('Give ' + food + ' to the client.');
      }
      case 1008: {                                     // CONQUER（22090-22099）
        const mon = (q.targetCreature | 0) === 343 ? (jp ? '正体不明の存在' : 'unknown monster')
          : creatureOf(q.targetCreature);
        return jp ? (mon + 'の討伐') : ('Slay ' + mon + '.');
      }
      case 1010:                                       // HUNTEX（22100-22106）
        return jp ? '全ての敵の殲滅' : 'Eliminate monsters';
      case 1011: {                                     // COLLECT（22107-22123）
        const it = article(itemName(q.itemId));
        const place = mapNameOf(q.mapId) || q.map || 'the town';
        const who = q.targetName || (jp ? (place + 'に住む人物') : ('the target in ' + place));
        return jp ? ('依頼人のために' + who + 'から' + it + 'を調達')
          : ('Acquire ' + it + ' from ' + who + ' for the client.');
      }
      default:
        return '';
    }
  }

  /** var_121(5)：报酬（22001-22010） */
  function rewardText(g, q, lang) {
    const gold = q.rewardGold | 0;
    let s = (lang === 'jp') ? ('金貨' + gold + '枚') : (gold + ' gold pieces');
    const ri = q.rewardItem | 0;
    if (ri) {
      const extra = (ri >= 10000) ? itemName(ri) : (REWARD_CATS[ri] || 'items');
      s += (lang === 'jp' ? 'と' : ' and ') + extra;
    }
    return s;
  }

  /**
   * 日记里的委托条目（22132-22157，`var_428 == 2` 分支）。
   * @returns {Array<{cls:string,text:string}>}
   */
  function questDetail(g, q, lang) {
    if (!q) return [];
    const jp = (lang === 'jp');
    const key = questKey(g, q);
    const hit = boardLine(key, lang, g) || boardLine(key, 'en', g);
    const name = hit ? hit.name : (elonaQuestName(q));
    const out = [];
    if ((q.status | 0) === 3) out.push({ cls: 'done', text: (jp ? '依頼 完了 ' : 'Complete ') + name });
    else out.push({ cls: 'head', text: (jp ? '依頼 ' : 'Job ') + name });
    out.push({ cls: 'body', text: (jp ? '依頼: ' : 'Client  : ') + (q.clientName || '') });
    out.push({ cls: 'body', text: (jp ? '場所: ' : 'Location: ') + (mapNameOf(q.mapId) || q.map || 'somewhere') });
    const dl = (q.daysLeft < 0) ? (jp ? '即時' : '-') : (q.daysLeft | 0) + (jp ? '日' : 'd');
    out.push({ cls: 'body', text: (jp ? '期限: ' : 'Deadline: ') + (q.daysLeft < 0 ? '' : (jp ? '残り' : '')) + dl });
    out.push({ cls: 'body', text: (jp ? '報酬: ' : 'Reward  : ') + rewardText(g, q, lang) });
    const detail = ((q.status | 0) === 3)
      ? (jp ? '内容: あとは報告するだけだ。' : 'Detail  : Report to the client.')
      : (jp ? '内容: ' : 'Detail  : ') + objectiveText(g, q, lang);
    out.push({ cls: 'body', text: detail });
    return out;
  }

  /** 兜底：board.txt 缺失时用类型名 */
  function elonaQuestName(q) {
    const n = { 1001: 'Hunt', 1002: 'Delivery', 1003: 'Cooking', 1004: 'Supply', 1006: 'Harvest',
      1007: 'Escort', 1008: 'Conquer', 1009: 'Party', 1010: 'Hunt EX', 1011: 'Collect', 1013: 'Trap' };
    return n[q.type | 0] || 'Job';
  }

  Elona.Journal = {
    load, ready, sections, run,
    questDetail, objectiveText, rewardText, questKey, boardLine,
    news, questSection, itemSection, rankingSection, incomeSection, completedSection,
    _internals: { evalAst, render, newEnv },
    get table() { return TABLE; },
    get board() { return BOARD; },
  };
})(window);
