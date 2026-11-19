'use strict';
/**
 * 自定义 NPC（core/customnpc.js）—— `user/*.npc`
 *
 * 【原版语义】玩家按 `user/npc_template.txt` 的格式写一份文本 + 选一张 bmp，
 *   游戏打包成 `<名字>.npc` 放进 `user/`。之后就能在游戏里召唤这些 NPC。
 *
 * 【.npc 容器格式】（自造，未压缩；`zipinit2/zipadd2/zipend2` 302700-302734，
 *   `unzip2` 302716-302734）
 *   连续记录，每条 =
 *     [ 文件名 40 字节（NUL 填充）]
 *     [ 整条长度 10 字节（ASCII 十进制，NUL 填充）]   ← 长度 = 50 + 文件内容字节数
 *     [ 文件内容 N 字节 ]
 *   三条记录依次是 `npc1.t` / `npc2.t` / `npc3.t`。
 *
 *   · `npc1.t` = 70 个 int32（280 字节）
 *       (0) = npc2.t 的字节数
 *       (1) = npc3.t 的字节数
 *       (2..69) = 属性兜底值（会被 npc3.t 的文本属性覆盖）
 *   · `npc2.t` = bmp 字节（角色图，30KB 上限；`label_2872` 302962）
 *   · `npc3.t` = 文本，`%Elona Custom Npc` 开头，`key."值"` 属性 + `%txtXXX,JP/EN` 台词段
 *
 * 【属性文本】（`getnpctxt` 302735-302744：找 `key` 后的第一个 `"…"`，最长 70 字）
 *   ```
 *   author.   作者        name.     "显示名,真名"     race.  种族（默认 slime）
 *   class.    职业        filter.   过滤标签          resist. "属性,值,属性,值…"
 *   level.    等级        relation. 关系 -3..10       sex.    -1 随机 / 0 男 / 1 女
 *   fixLv.    固定等级    rare.     稀有度            spawnType.
 *   aiCalm.   冷静度      aiMove.   移动率            aiDist. 距离
 *   aiHeal.   治疗          aiAct.    5 个主动行动     aiActSub. 5 个附加行动
 *   aiActSubFreq. 附加频率  meleeElem. "属性,强度"     bitOn.  "位,位…"
 *   ```
 *
 * 【生成流程】`characreate -1, 343, x, y` → `*label_2870`（302756-302818）逐条套用：
 *   种族 = 343、等级 = level（上限 `var_65(189)*2`）、肖像 = -1、
 *   `var_58(212)=55`、`var_58(209)=aiActSubFreq`、215..219 = aiAct、220..224 = aiActSub、
 *   resist → `var_82(属性) += 值*50`、`var_58(23)=1`、`var_58(40)=-10000`、
 *   名字 = name 的第二段、`var_63(5)` = 第一段、关系/aiCalm/aiMove/aiDist/meleeElem、
 *   种族与职业按名字查表、性别、fixLv → `var_641`、最后 `fixaiact` + `setunid`。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const NAME_LEN = 40;      // 容器里文件名固定 40 字节
  const SIZE_LEN = 10;      // 长度字段固定 10 字节
  const HEADER = NAME_LEN + SIZE_LEN;   // 50
  const MAX_NPC = 240;      // 302828：`if (var_102 >= 240) var_102 = 240`
  const MAX_BMP = 30000;    // 302962：bmp 上限 30KB

  let listCache = null;     // [{file, name, alias, def, bmp}]
  let loading = null;

  // ---------------------------------------------------------------- 容器
  /**
   * 容器内的文本解码：原版 txt 走系统代码页（日文 Windows 上是 CP932），
   * 但也可能是 UTF-8（玩家手工改过 / 非日文环境）。
   * 顺序与 `UserDir.decodeBytes` 一致：严格 UTF-8 → shift_jis 回退。
   */
  function decodeText(bytes) {
    if (!bytes || !bytes.length) return '';
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* 不是 UTF-8 */ }
    try { return new TextDecoder('shift_jis').decode(bytes); } catch (e) { /* 继续退 */ }
    return new TextDecoder('utf-8').decode(bytes);
  }

  /**
   * 解析 .npc 容器（`unzip2`）。
   * @param {Uint8Array} bytes
   * @returns {{npc1:Uint8Array|null, npc2:Uint8Array|null, npc3:string|null, entries:Array}}
   */
  function parseContainer(bytes) {
    const out = { npc1: null, npc2: null, npc3: null, entries: [] };
    if (!bytes || !bytes.length) return out;
    let p = 0;
    for (let guard = 0; guard < 64 && p + HEADER <= bytes.length; guard++) {
      const nameBuf = bytes.subarray(p, p + NAME_LEN);
      const sizeBuf = bytes.subarray(p + NAME_LEN, p + HEADER);
      // 文件名与长度字段固定 ASCII
      const rawName = decodeText(nameBuf).replace(/\0+$/, '').trim();
      const rawSize = decodeText(sizeBuf).replace(/\0+$/, '').trim();
      const total = parseInt(rawSize, 10);
      if (!rawName || !(total > HEADER) || p + total > bytes.length) break;
      const body = bytes.subarray(p + HEADER, p + total);
      out.entries.push({ name: rawName, size: total, body });
      const lower = rawName.toLowerCase();
      if (lower === 'npc1.t') out.npc1 = body;
      else if (lower === 'npc2.t') out.npc2 = body;
      else if (lower === 'npc3.t') out.npc3 = decodeText(body);
      p += total;
    }
    return out;
  }

  /** 把三条记录打包回 .npc（导出用，与 `zipadd2` 一致） */
  function buildContainer(npc1, npc2, npc3) {
    const enc = new TextEncoder();
    const rows = [
      ['npc1.t', npc1 instanceof Uint8Array ? npc1 : new Uint8Array(npc1 || [])],
      ['npc2.t', npc2 instanceof Uint8Array ? npc2 : new Uint8Array(npc2 || [])],
      ['npc3.t', typeof npc3 === 'string' ? enc.encode(npc3) : (npc3 || new Uint8Array())],
    ];
    let total = 0;
    for (const [, body] of rows) total += HEADER + body.length;
    const buf = new Uint8Array(total);
    const dec = new TextEncoder();
    let p = 0;
    for (const [name, body] of rows) {
      const len = HEADER + body.length;
      buf.set(dec.encode(name).subarray(0, NAME_LEN), p);
      buf.set(dec.encode(String(len)).subarray(0, SIZE_LEN), p + NAME_LEN);
      buf.set(body, p + HEADER);
      p += len;
    }
    return buf;
  }

  // ---------------------------------------------------------------- 属性文本
  /** `getnpctxt`：找 `key` 之后的第一个 `"…"` */
  function getNpcTxt(text, key, dflt) {
    const s = String(text || '');
    const i = s.indexOf(key);
    if (i < 0) return dflt;
    const q1 = s.indexOf('"', i);
    if (q1 < 0) return dflt;
    let q2 = s.indexOf('"', q1 + 1);
    if (q2 < 0) q2 = s.length;
    const v = s.slice(q1 + 1, Math.min(q2, q1 + 1 + 70));
    return v === '' ? dflt : v;
  }

  function num(text, key, dflt) {
    const v = parseInt(getNpcTxt(text, key, String(dflt)), 10);
    return Number.isFinite(v) ? v : dflt;
  }

  function csv(s) {
    return String(s || '').split(',').map((x) => x.trim());
  }

  /**
   * 解析 npc3.t 文本 → 定义对象（对应 `label_2871` 302860-302930 的读取）。
   * @param {string} text
   * @param {Uint8Array} [npc1] 属性兜底
   */
  function parseDef(text, npc1) {
    const t = String(text || '');
    if (t.indexOf('%Elona Custom Npc') < 0) return null;
    const i32 = new Int32Array(70);
    if (npc1 && npc1.length >= 280) {
      const dv = new DataView(npc1.buffer, npc1.byteOffset, npc1.byteLength);
      for (let k = 0; k < 70; k++) i32[k] = dv.getInt32(k * 4, true);
    }
    const names = csv(getNpcTxt(t, 'name.', 'unknown,unknown'));
    const def = {
      raw: t,
      author: getNpcTxt(t, 'author.', ''),
      // name."显示名,真名"：var_103(0)=第一段（真名）、var_103(1)=第二段（显示名）
      name: (names[1] || names[0] || 'unknown').trim(),
      alias: (names[0] || 'unknown').trim(),
      race: getNpcTxt(t, 'race.', 'slime'),
      klass: getNpcTxt(t, 'class.', 'tourist'),
      filter: getNpcTxt(t, 'filter.', ''),
      resist: getNpcTxt(t, 'resist.', ''),
      meleeElem: getNpcTxt(t, 'meleeElem.', '0,0'),
      bitOn: getNpcTxt(t, 'bitOn.', '0,0'),
      aiAct: csv(getNpcTxt(t, 'aiAct.', '0,0,0,0,0')),
      aiActSub: csv(getNpcTxt(t, 'aiActSub.', '0,0,0,0,0')),
      select: num(t, 'select.', i32[12] || 0),
      level: num(t, 'level.', i32[2] || 1),
      sex: num(t, 'sex.', i32[3] === undefined ? -1 : i32[3]),
      relation: num(t, 'relation.', i32[4] === undefined ? -1 : i32[4]),
      fixLv: num(t, 'fixLv.', i32[5] || 0),
      rare: num(t, 'rare.', i32[6] || 0),
      aiCalm: num(t, 'aiCalm.', i32[7] || 1),
      aiMove: num(t, 'aiMove.', i32[8] === undefined ? 50 : i32[8]),
      aiDist: num(t, 'aiDist.', i32[9] || 1),
      aiHeal: num(t, 'aiHeal.', i32[10] || 0),
      aiActSubFreq: num(t, 'aiActSubFreq.', 0),
      spawnType: num(t, 'spawnType.', 0),
    };
    return def;
  }

  /** 台词段 → `Talk` 需要的数据结构 */
  function parseTalk(text) {
    const Talk = Elona.Talk;
    if (Talk && Talk.parse) {
      const tags = Talk.parse(text, null);
      return Object.keys(tags).length ? { tags } : null;
    }
    return null;
  }

  // ---------------------------------------------------------------- 列表
  /** 扫描 `user/*.npc`（302826-303182） */
  async function loadAll() {
    if (listCache) return listCache;
    if (loading) return loading;
    loading = (async () => {
      const out = [];
      const U = Elona.UserDir;
      if (!U || !U.list) { listCache = out; loading = null; return out; }
      let files = [];
      try { files = await U.list('', '*.npc'); } catch (e) { files = []; }
      if (files.length > MAX_NPC) files = files.slice(0, MAX_NPC);
      const seen = new Set();
      for (const f of files) {
        const bytes = await U.readBytes(f);
        if (!bytes) continue;
        const c = parseContainer(bytes);
        if (!c.npc3 && !c.npc1) continue;
        const def = parseDef(c.npc3, c.npc1);
        if (!def) continue;
        // 同名 NPC 只认第一个（源码用 var_2328 去重）
        if (seen.has(def.name)) continue;
        seen.add(def.name);
        out.push({
          file: f,
          name: def.name,
          alias: def.alias,
          def,
          talk: parseTalk(c.npc3),
          bmp: c.npc2 || null,
          tmp: /_tmp_/i.test(f),
        });
      }
      listCache = out;
      loading = null;
      return out;
    })();
    return loading;
  }

  /** 可召唤的（排除 `_tmp_`，对应 291180 的过滤） */
  async function summonable() {
    const all = await loadAll();
    return all.filter((e) => !e.tmp);
  }

  function invalidate() { listCache = null; loading = null; }

  // ---------------------------------------------------------------- 生成
  /**
   * 按定义生成一个角色（`characreate -1, 343` + `*label_2870`）。
   * @param {object} g
   * @param {object} entry loadAll() 的一项
   * @param {number} x
   * @param {number} y
   * @param {object} [opt] { index }
   * @returns {object|null} 角色
   */
  function create(g, entry, x, y, opt) {
    if (!g || !entry || !Elona.CharaFactory || !Elona.CharaFactory.create) return null;
    const d = entry.def;
    let c = null;
    try {
      c = Elona.CharaFactory.create(g, 343, d.level, x, y, opt || {});
    } catch (e) { return null; }
    if (!c) return null;

    // 302762-302815：逐条套用（顺序与源码一致，后面的会覆盖前面的）
    c.set(38, Math.max(1, Math.min(350, d.level | 0)));       // 等级
    if (g.getV65) {                                            // 上限 var_65(189)*2
      const cap = (g.getV65(189) | 0) * 2;
      if (cap > 0 && (c.get(38) | 0) > cap) c.set(38, Math.max(1, Math.min(350, cap)));
    }
    c.set(13, -1);                                             // 肖像 → 自定义脸
    c.set(212, 55);
    c.set(209, d.aiActSubFreq | 0);
    for (let k = 0; k < 5; k++) {
      c.set(215 + k, parseInt(d.aiAct[k], 10) || 0);
      c.set(220 + k, parseInt(d.aiActSub[k], 10) || 0);
    }
    // resist."属性,值,属性,值…" → var_82(属性) += 值*50
    const rs = csv(d.resist).filter((s) => s !== '');
    for (let k = 0; k + 1 < rs.length && k < 32; k += 2) {
      const skill = parseInt(rs[k], 10);
      const val = parseInt(rs[k + 1], 10);
      if (!Number.isFinite(skill) || !Number.isFinite(val)) continue;
      if (c.skill && c.setSkill) c.setSkill(skill, (c.skill(skill) | 0) + val * 50);
    }
    c.set(23, 1);
    c.set(40, -10000);
    c.name = d.name;                                           // var_63(0) = 显示名
    c.aliasName = d.alias;                                     // var_63(5) = 真名（别名槽）
    c.set(9, Math.max(-3, Math.min(10, d.relation | 0)));      // 关系
    c.set(202, Math.max(1, Math.min(4, d.aiCalm | 0)));
    c.set(207, Math.max(0, Math.min(100, d.aiMove | 0)));
    c.set(208, Math.max(1, Math.min(100, d.aiDist | 0)));
    const me = csv(d.meleeElem).map((s) => parseInt(s, 10) || 0);
    if (me[0]) {
      const v = me[0] * 100000 + (me[1] | 0);
      c.set(230, Math.max(50 * 100000, Math.min(69 * 100000, v)));
    }
    c.set(211, d.aiHeal | 0);
    // 性别：-1 随机（源码 `rnd(2)`）
    let sex = d.sex | 0;
    if (sex !== 0 && sex !== 1) sex = ((g.rng ? g.rng.rnd(2) : Math.floor(Math.random() * 2)) | 0);
    c.set(8, sex);
    if (d.fixLv) c.fixLv = Math.max(0, Math.min(6, d.fixLv | 0));
    c.set(69, c.get(9) | 0);
    c.customNpc = true;

    // 绑定台词（cbit 989 + var_63(4) 的等价物：给 NPC 挂 talkData）
    if (entry.talk && Elona.Talk && Elona.Talk.bind) {
      Elona.Talk.bind(c, entry.alias || entry.name, entry.talk);
    }
    if (g.syncCharaCells) g.syncCharaCells();
    return c;
  }

  const CustomNpc = {
    NAME_LEN, SIZE_LEN, HEADER, MAX_NPC, MAX_BMP,
    parseContainer, buildContainer, parseDef, parseTalk,
    getNpcTxt, decodeText,
    loadAll, summonable, invalidate, create,
    /** 已加载的列表（同步） */
    entries() { return (listCache || []).slice(); },
  };

  Elona.CustomNpc = CustomNpc;
})(window);
