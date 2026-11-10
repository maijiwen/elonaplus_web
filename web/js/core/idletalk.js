'use strict';
/**
 * 内置随机台词（core/idletalk.js）—— *label_0260 / 0261 / 0262 / 0263 / 0264
 *
 * 【源码依据】
 *   19670-19956   *label_0260~0264，data\talk.txt 与 guide\guide.txt 的读取与类别选择
 *   16243-17992   *label_0258：把台词里的 {aka} / {ある} / {Angry} 等展开
 *   17993         *label_0259：教程文本的变量展开
 *   203900-203915 gosub *label_0262（首次提示窗口读 guide.txt）
 *   226445-226465 gosub *label_0263（运势饼干按 %COOKIE1 / %COOKIE2 取词）
 *   414085-414105 gosub *label_0264（NPC 对话开场：内置闲聊 → customtalk 106 覆盖）
 *
 * 【原版流程】
 *   notesel + noteload 把整个文本文件读进 note 缓冲区；
 *   instr(var_122, 0, "%TAG,...,JP") 找类别头，strmid 截到 %END；
 *   若块内不足 2 行（noteinfo(0) <= 1）就回退 %DEFAULT；
 *   notedel 0 删掉类别标记行，rnd(noteinfo(0)) 随机取一行（19674-19681）；
 *   最后 gosub *label_0258 做文本变量替换。
 *
 * 【数据】tools/extract_talktxt.py 从 web/assets/data/talk.txt（cp932，178 个类别 /
 *   1137 行台词）与 exhelp.txt（36 个教程类别 / 319 行）生成
 *   web/data/tables/talktxt.json。原版 guide\guide.txt 在发行包里只有 dummy.txt，
 *   教程正文放在 exhelp.txt，这里按该文件还原。
 *
 * 【语言】原版 lang("JP","EN") 二选一；本项目默认英文原文（'en'），
 *   日文用 'jp'。talk.txt 没有中文版本，中文界面仍显示英文原句，不臆造译文。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let cached = null;

  /** 表：浏览器走 Elona.Data.tableSync；node 测试可注入 Elona.TalkTxtData */
  function table() {
    if (!cached) {
      cached = (Elona.TalkTxtData && Elona.TalkTxtData.categories) ? Elona.TalkTxtData : null;
      if (!cached && Elona.Data && Elona.Data.tableSync) {
        try { cached = Elona.Data.tableSync('talktxt'); } catch (e) { cached = null; }
      }
    }
    return (cached && cached.categories) ? cached : null;
  }

  function langCode(lang) {
    return String(lang || 'en').toLowerCase() === 'jp' ? 'JP' : 'EN';
  }

  function rndOf(g) {
    return (g && g.rng && g.rng.rnd) ? g.rng.rnd.bind(g.rng)
      : (n) => Math.floor(Math.random() * (n | 0 || 1));
  }

  function v65(g, n) {
    return (g && typeof g.getV65 === 'function') ? (g.getV65(n) | 0) : 0;
  }

  function fld(c, n) {
    return (c && typeof c.get === 'function') ? (c.get(n) | 0) : 0;
  }

  function cbit(c, n) {
    if (Elona.Status && typeof Elona.Status.cbit === 'function') {
      return Elona.Status.cbit(c, n) | 0;
    }
    if (c && c.cbits) return c.cbits[n] | 0;
    return 0;
  }

  /** var_132(16|29, map) 的近似：项目没有该表，允许宿主注入 mapAttrs */
  function attr(g, col) {
    const m = (g && g.mapAttrs) || null;
    return m ? (m[col] | 0) : 0;
  }

  /** 把 `%TAG,...` / `TAG,...` 归一化为 JSON 里的 key（不含语言后缀） */
  function normKey(key) {
    return String(key || '').trim().replace(/^%/, '').replace(/,(JP|EN)$/i, '');
  }

  /** *label_0258 / 0259：展开台词里的 {…} 变量 */
  function expand(g, text, npc, lang) {
    const s = String(text == null ? '' : text);
    if (Elona.TextVar && Elona.TextVar.loaded) {
      return Elona.TextVar.expand(s, {
        player: (g && g.player) || null,
        npc: npc || null,
        lang,
        punct: 3,
        rnd: rndOf(g),
      });
    }
    // 数据未加载时只去掉标记（含 {ある} 这类日文转换键），保持可读文本
    return s.replace(/\{[^}]*\}/g, '');
  }

  /**
   * *label_0260：按类别从 talk.txt 随机取一行。
   * 类别不存在 / 块内没有台词时回退 `%DEFAULT`（19672-19675 / 19706-19708）。
   * @returns {{text:string, raw:string, key:string, fallback:boolean}|null}
   */
  function line(g, key, opts) {
    const t = table();
    if (!t) return null;
    const o = opts || {};
    const LC = langCode(o.lang);
    const want = normKey(key);
    let cat = t.categories[want + ',' + LC];
    let fallback = false;
    if (!cat || !cat.lines || !cat.lines.length) {
      cat = t.categories['DEFAULT,' + LC];      // 19673-19674
      fallback = true;
    }
    if (!cat || !cat.lines || !cat.lines.length) {
      cat = t.categories['DEFAULT,EN'];
      fallback = true;
    }
    if (!cat || !cat.lines || !cat.lines.length) return null;
    const lines = cat.lines.filter((s) => !!s);   // notedel 0 / 跳过分页空行
    if (!lines.length) return null;
    const raw = o.index === undefined
      ? lines[rndOf(g)(lines.length) % lines.length]
      : lines[((o.index | 0) % lines.length + lines.length) % lines.length];
    return {
      text: expand(g, raw, o.npc || null, String(o.lang || 'en').toLowerCase()),
      raw,
      key: cat.key,
      fallback,
    };
  }

  /** *label_0263（19703-19709）：先设 var_424，再走 0260 */
  function category(g, key, opts) {
    return line(g, key, opts);
  }

  /**
   * *label_0261 / 0262（19683-19702）：guide.txt 教程文本。
   * var_421 记录类别头位置；块内为空时回退 `%DEFAULT,<LANG>`。
   */
  function guide(g, key, opts) {
    const t = table();
    if (!t || !t.guides) return null;
    const o = opts || {};
    const LC = langCode(o.lang);
    const want = normKey(key);
    let cat = t.guides[want + ',' + LC];
    if (!cat || !cat.lines || !cat.lines.length) {
      cat = t.guides[want + ',EN'];
    }
    if (!cat || !cat.lines || !cat.lines.length) {
      // 19687-19690：noteinfo(0) <= 1 → 回退 %DEFAULT
      const fb = line(g, 'DEFAULT', o);
      if (fb) fb.fallback = true;
      return fb;
    }
    const text = cat.lines.join('\n');
    return {
      text: expand(g, text, o.npc || null, String(o.lang || 'en').toLowerCase()),
      raw: text,
      key: cat.key,
      fallback: false,
    };
  }

  // ---------------------------------------------------------------------------
  // *label_0264（19710-19955）：按 NPC / 地图 / 任务状态挑台词类别。
  // 规则顺序与源码完全一致；`repeat 1 ... break` 等价于「第一条命中即用」。
  // HSP 的 `if (rnd(n))` = rnd(n) != 0（(n-1)/n 概率），不是「等于 0」。
  // ---------------------------------------------------------------------------
  const IDLE_RULES = [
    // 19714-19730：投降 / 女仆 / 无聊 / 同伴 / 修女
    { src: '19714-19717', tag: 'INOTIGOI', test: (x) => cbit(x.c, 1049) === 1 },
    { src: '19718-19725', tag: 'MAID', test: (x) => fld(x.c, 150) === 18 && x.v(814) > 0 },
    { src: '19726-19729', tag: 'BORED', test: (x) => fld(x.c, 14) <= 0 },
    { src: '19730-19733', tag: 'ALLY_DEFAULT', test: (x) => (x.c.index | 0) < 16 || cbit(x.c, 960) === 1 },
    { src: '19734-19742', tag: (x) => x.v(11) === 4 ? 'ASISTER' : 'SISTER', test: (x) => fld(x.c, 27) === 249 },
    // 19743-19755：特殊种族
    { src: '19743-19748', tag: 'CROW', test: (x) => fld(x.c, 27) === 620 && x.attr(16) !== 102 },
    { src: '19749-19752', tag: 'PIGEON', test: (x) => fld(x.c, 27) === 1157 },
    { src: '19753-19756', tag: 'OBLIVION', test: (x) => fld(x.c, 27) === 824 },
    { src: '19757-19760', tag: 'DETECTIVE', test: (x) => fld(x.c, 27) === 696 || fld(x.c, 27) === 697 },
    { src: '19761-19768', tag: 'YOUKO', test: (x) => fld(x.c, 27) === 673 && fld(x.c, 58) === 0 && fld(x.c, 7) === 764 },
    // 19769-19788：囚犯 / 岗哨 / 祈祷 / 婊子
    { src: '19769-19773', tag: 'INMATE', test: (x) => cbit(x.c, 1041) === 1 && x.v(20) !== 35 && fld(x.c, 169) < 100 },
    { src: '19774-19777', tag: 'SENTI', test: (x) => x.v(20) === 86 },
    { src: '19778-19781', tag: 'PRAY', test: (x) => fld(x.c, 27) === 181 || fld(x.c, 27) === 180 },
    { src: '19782-19785', tag: 'BITCH', test: (x) => fld(x.c, 27) === 335 },
    // 19786-19810：剧情 NPC（按 var_65(11)==4 选 A 前缀）
    { src: '19786-19794', tag: (x) => x.v(11) === 4 ? 'AMOYER' : 'MOYER', test: (x) => fld(x.c, 150) === 1015 },
    { src: '19795-19803', tag: (x) => x.v(11) === 4 ? 'AAILE' : 'AILE', test: (x) => fld(x.c, 27) === 534 },
    { src: '19804-19812', tag: (x) => x.v(11) === 4 ? 'ASLAVEKEEPER' : 'SLAVEKEEPER', test: (x) => fld(x.c, 150) === 17 },
    { src: '19813-19816', tag: 'ZAILE', test: (x) => x.v(20) === 92 },
    { src: '19817-19824', tag: 'DAIN', test: (x) => x.v(520) > 9 && x.v(252) >= 394 && x.rnd(40) === 0 },
    // 19825-19858：地图专属台词
    { src: '19825-19828', tag: 'DEFEND', test: (x) => x.v(20) === 79 },
    { src: '19829-19832', tag: 'SUMMON', test: (x) => x.v(20) === 71 },
    { src: '19833-19836', tag: 'DRAN', test: (x) => x.v(20) === 81 },
    { src: '19837-19844', tag: 'BSHIP7R', test: (x) => x.v(20) === 80 && x.v(22) === 70 && fld(x.c, 27) === 669 },
    { src: '19845-19850', tag: 'BSHIP7', test: (x) => x.v(20) === 80 && x.v(22) === 70 },
    { src: '19851-19854', tag: 'BSHIP', test: (x) => x.v(20) === 80 },
    { src: '19855-19858', tag: 'MADOU', test: (x) => x.v(20) === 73 },
    { src: '19859-19862', tag: 'SAZIN', test: (x) => x.v(20) === 75 },
    { src: '19863-19866', tag: 'CAVE', test: (x) => x.v(20) === 77 },
    // 19867-19900：职业 / 传闻 / 节日 / 地区
    { src: '19867-19875', tag: (x) => x.v(11) === 4 ? 'ASKILLTRAINER' : 'SKILLTRAINER', test: (x) => fld(x.c, 150) === 7 },
    { src: '19876-19886', tag: (x) => x.v(11) === 4 ? 'ASHOPKEEPER' : 'SHOPKEEPER',
      test: (x) => ((fld(x.c, 150) >= 1000 && fld(x.c, 150) < 2000) || fld(x.c, 150) === 2003) && x.rnd(3) !== 0 },
    { src: '19887-19896', tag: (x) => x.v(11) === 4 ? 'ARUMOR,LOOT' : 'RUMOR,LOOT',
      test: (x) => fld(x.c, 17) >= 100 && x.rnd(3) === 0 },
    { src: '19897-19904', tag: (x) => 'FEST,' + x.v(20), test: (x) => !!x.attr(29) && x.v(20) === 33 && x.rnd(3) !== 0 },
    { src: '19905-19912', tag: (x) => 'FEST,' + x.v(20), test: (x) => !!x.attr(29) && x.v(20) === 57 && x.rnd(3) !== 0 },
    { src: '19913-19922', tag: (x) => (x.v(11) === 4 ? 'AAREA,' : 'AREA,') + x.v(20), test: (x) => x.rnd(3) !== 0 },
    { src: '19923-19926', tag: 'HEAVEN', test: (x) => x.v(850) === 70 },
    { src: '19927-19936', tag: (x) => (x.v(11) === 4 ? 'APERSONALITY,' : 'PERSONALITY,') + fld(x.c, 16),
      test: (x) => x.rnd(2) !== 0 },
  ];

  /** 兜底（19938-19945）：var_400 == -1 时选 %ADEFAULT / %DEFAULT */
  function defaultTag(g) {
    return v65(g, 11) === 4 ? 'ADEFAULT' : 'DEFAULT';
  }

  /**
   * 选出类别（不取词），便于测试与宿主自定义。
   * @returns {{tag:string, src:string, fallback:boolean}}
   */
  function pickTag(g, npc) {
    const x = {
      c: npc, g,
      v: (n) => v65(g, n),
      rnd: rndOf(g),
      attr: (col) => attr(g, col),
      fld: (n) => fld(npc, n),
    };
    for (const r of IDLE_RULES) {
      if (!r.test(x)) continue;
      return { tag: (typeof r.tag === 'function' ? r.tag(x) : r.tag), src: r.src, fallback: false };
    }
    return { tag: defaultTag(g), src: '19938-19945', fallback: true };
  }

  /**
   * *label_0264 → gosub *label_0260：NPC 开场闲聊台词。
   * 414098 之后还会执行 `customtalk var_244, 106`，有自定义台词的 NPC 会覆盖这句。
   */
  function idle(g, npc, opts) {
    const t = table();
    if (!t) return null;
    const o = opts || {};
    const p = (o.tag !== undefined && o.tag !== null)
      ? { tag: o.tag, src: 'caller', fallback: false }
      : pickTag(g, npc);
    const r = line(g, p.tag, { lang: o.lang, npc, index: o.index });
    if (!r) return null;
    r.tag = p.tag;
    r.rule = p.src;
    r.fallback = p.fallback || r.fallback;
    return r;
  }

  /** 226455-226462：运势饼干的两段签文 */
  function cookie(g, which, opts) {
    return line(g, which === 2 ? 'COOKIE2' : 'COOKIE1', opts);
  }

  const IdleTalk = {
    IDLE_RULES,
    table, line, category, guide, idle, cookie, pickTag, defaultTag,
    /** 注入表（node 测试 / 无 Data 层时用） */
    ready(data) { cached = data && data.categories ? data : null; return this; },
    /** 类别总数 */
    count() { const t = table(); return t ? Object.keys(t.categories).length : 0; },
    /** guide 总数 */
    guideCount() { const t = table(); return t && t.guides ? Object.keys(t.guides).length : 0; },
  };

  Elona.IdleTalk = IdleTalk;
  if (typeof module !== 'undefined' && module.exports) module.exports = IdleTalk;
})(typeof window !== 'undefined' ? window : global);
