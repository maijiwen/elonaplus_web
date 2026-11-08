'use strict';
/**
 * 角色创建 —— 8 步向导（ElonaPlus 2.16 观感）
 *
 * 【源码】start.hsp 220783-221500（*label_2255 … *label_2274）
 *   1 種族の選択  220783 / 221224  *label_2255   ← 11 个官方种族
 *   2 性別の選択  220973          *label_2261   ← 6 个候选
 *   3 職業の選択  221068          *label_2264   ← 12 个职业
 *   4 特筆すべき才能 221224        *label_2267   ← *label_2784 的技能清单
 *   5 能力のロール 221264          *label_2269   ← 2 次锁定 + 再抽選
 *   6 特徴と体質  221399          *label_2695   ← var_65(93)=3，最多 3 个天赋
 *   7 肖像の変更  221424          *label_2803/2805 ← PCC 部件 + 肖像(face1/2)
 *   8 情報総覧    （截图的最终确认页）
 *
 * 【数据】race_class.json / skills.json / feats.json / profile.json / palette.json
 *   能力ボーナス的分级词、颜色与阈值取自 221893-221930；
 *   習得技能的说明取自 var_84(150..190)（见 SKILL_DESC）。
 *
 * 【与旧 UI 的关系】#cc-legacy 里保留了旧创建页的 DOM 元素（隐藏），本模块在每次渲染时
 *   把状态同步过去，使 tools/browser_check.js 等既有回归脚本仍能按原选择器操作。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  // ---------------------------------------------------------------- 常量
  // 0-FI：按 start.hsp 220533-221660 补齐别名 / 经历 / 模式，共 11 步
  const STEPS = ['alias', 'profile', 'race', 'gender', 'class', 'skill',
    'attr', 'feat', 'look', 'mode', 'summary'];
  const IDX = {}; STEPS.forEach((n, i) => { IDX[n] = i; });
  const isStep = (n) => S && S.step === IDX[n];
  const TIPS = [
    ['先告诉我你的通称吧。', 'まずは君の通り名を教えてくれるかい。'],
    ['能说说你的经历吗？保密也没关系。', '君の経歴を教えてくれるかな。内緒にしてもいいけれど。'],
    ['有些种族会限制装备部位，要多加留意。', '種族によっては装備箇所に制限があったりするから注意だよ。'],
    ['性别不会造成能力差异。', '性別による能力の違いはない。'],
    ['职业与种族不仅影响初始能力，也影响成长方向。', '職業や種族は、初期の能力だけでなく、成長の方向性に影響するんだ。'],
    ['选一项你最擅长的才能。带 ＊ 的表示与种族／职业重复。', '君の特筆すべき才能を1つ、教えてほしいな。＊がついているのは種族・職業と被っているものだね。'],
    ['不想死的话，还是需要一定能力的。', '死にたくないなら、ある程度の能力は必要だね。'],
    ['天赋是你拥有的有益特征，共有 3 点。同一项可以反复选来升级。', 'フィートとは、君の持っている有益な特徴だ。3つまで選べるよ。'],
    ['想先知道你的长相。不过之后随时都能改。', '君の見た目を知っておきたいな。まあ、後からいつでも変えられるけどね。'],
    ['偏偏要走艰险的道路，也是你的自由。', 'あえて険しい道を行くのも君の自由だ。'],
    ['按确定键可以重新抽取年龄与体格。', '決定キーを押すことで、年齢・体格をリロールできる。'],
  ];
  const TITLES = ['别名选择', '经历抽取', '种族选择', '性别选择', '职业选择', '',
    '能力掷点', '天赋与体质', '外观调整', '模式选择', ''];
  const WIN_CLASS = [
    'cc-win-alias', 'cc-win-profile', 'cc-win-wide', 'cc-win-small', 'cc-win-wide',
    'cc-win-wide', 'cc-win-roll', 'cc-win-wide', 'cc-win-look', 'cc-win-wide', 'cc-win-wide',
  ];

  const LETTERS = 'abcdefghijklmnopqrs';

  /** var_81(10..17)：8 项基本能力（颜色对照截图的属性图标） */
  const ATTRS = [
    { id: 10, jp: '筋力', ch: '力量', icon: '⚔', color: '#1b3f8f' },
    { id: 11, jp: '耐久', ch: '耐久', icon: '✚', color: '#1b3f8f' },
    { id: 12, jp: '器用', ch: '灵巧', icon: '✋', color: '#4a7a2a' },
    { id: 13, jp: '感覚', ch: '感知', icon: '👁', color: '#4a7a2a' },
    { id: 14, jp: '習得', ch: '学习', icon: '▤', color: '#2b5fa8' },
    { id: 15, jp: '意志', ch: '意志', icon: '✦', color: '#8e8a1e' },
    { id: 16, jp: '魔力', ch: '魔力', icon: '◎', color: '#128ca0' },
    { id: 17, jp: '魅力', ch: '魅力', icon: '♥', color: '#bb2020' },
  ];
  /** 221893：`"皆無","最高","理想的","高い","やや高い","普通","少し","微々"` → 中文八档 */
  const BONUS = ['无', '极高', '理想', '高', '较高', '普通', '较低', '极低'];
  const BONUS_COLOR = ['#888', '#0000c8', '#0000c8', '#000096', '#000096', '#000', '#960000', '#c80000'];

  /** var_84(150..190) —— 技能的效果说明（221970-221995 用var_84(cnt) 显示） */
  const SKILL_DESC = {
    150: '能够解读难懂的书籍', 151: '提高复合能力的知识',
    152: '提升近战攻击威力', 153: '能够搬运沉重的行李',
    154: '让伤口自然愈合', 155: '回复消耗的魔力',
    156: '让交涉与商谈更有利', 157: '不被周围察觉地行动',
    158: '打开锁', 159: '发现隐藏的场所与陷阱',
    160: '有效地进行投资', 161: '更容易留下尸体等物',
    162: '感知物品种类与敌人的攻击模式', 163: '提高挖掘墙壁的效率',
    164: '从自身或法杖中引出更多魔力', 165: '记忆书籍与攻击的分析结果／强化卷轴',
    166: '同时操使多种武器的技术', 167: '双手持武器战斗的技术',
    168: '使用盾牌的技术', 169: '使用重型装备的技术',
    170: '使用普通装备的技术', 171: '使用轻装备的技术',
    172: '提高魔法咏唱成功率与强度', 173: '回避攻击',
    174: '有效使用魔法道具／强化魔杖', 175: '强化陷阱的设置与拆除能力',
    176: '加工物品、制作道具', 177: '用皮革与藤蔓制作道具',
    178: '调合各种材料／强化药水', 179: '加工宝石、制作道具',
    180: '培育并采集植物', 181: '拉近与神的距离／抵抗诅咒',
    182: '加快旅行速度、加深经验', 183: '完成高水准的演奏',
    184: '提升厨艺', 185: '能够钓鱼',
    186: '提高会心一击的威力', 187: '确实躲开不准确的攻击',
    188: '减轻魔法对同伴的波及', 189: '提升射击威力',
    190: '潮湿状态下也能迅速行动／适应水中',
    300: '偷盗贵重的物品', 301: '令你能骑乘生物',
  };

  /** *label_2778（292507-292590）：特筆すべき才能固定 150..190 + 300 + 301，共 43 项 */
  const BIRTH_SKILLS = (() => {
    const out = [];
    for (let id = 150; id <= 190; id++) out.push(id);
    out.push(300, 301);
    return out;
  })();

  /** *label_2261 的 6 个性别候选；前两个写 var_58(8)，其余带称谓 */
  const GENDERS = [
    { jp: '男性', zh: '男性', sex: 0, label: '' },
    { jp: '女性', zh: '女性', sex: 1, label: '' },
    { jp: '自称男性', zh: '自称男性', sex: 1, label: '自称男性' },
    { jp: '自称女性', zh: '自称女性', sex: 0, label: '自称女性' },
    { jp: '両性具有', zh: '两性具有', sex: 1, label: '两性具有' },
    { jp: '性別不明', zh: '性别不明', sex: 0, label: '性别不明' },
  ];

  /** PCC 部件文件数量（web/assets/graphic/PCCs/ 实测），源码用 exist 判断边界 */
  const PART_MAX = { hair: 18, subhair: 18, cloth: 17, pants: 7, body: 6, eye: 13, etc: 43, ride: 4, hairbk: 4 };
  const COLOR_MAX = 31;   // var_508/1000，221895 `31 - 1`
  /** *label_2789 的 var_444 映射：第一页 9 项 / 第二页 8 项 */
  const LOOK_PAGES = [
    [
      { jp: '确定', key: 'done' },
      { jp: '肖像', key: 'portrait' },
      { jp: '发型', idx: 1, layer: 'hair' },
      { jp: '副发型', idx: 10, layer: 'subhair' },
      { jp: '发色', idx: 1, color: true },
      { jp: '身体', idx: 15, layer: 'body' },
      { jp: '衣服', idx: 9, layer: 'cloth' },
      { jp: '裤子', idx: 7, layer: 'pants' },
      { jp: '详细设置', key: 'page1' },
    ],
    [
      { jp: '肤色', idx: 15, color: true },
      { jp: '衣服颜色', idx: 9, color: true },
      { jp: '裤子颜色', idx: 7, color: true },
      { jp: '饰品 1', idx: 11, layer: 'etc' },
      { jp: '饰品 2', idx: 12, layer: 'etc' },
      { jp: '饰品 3', idx: 13, layer: 'etc' },
      { jp: '眼睛', idx: 14, layer: 'eye' },
      { jp: '基本设置', key: 'page0' },
    ],
  ];

  // ---------------------------------------------------------------- 状态
  let cfg = null;
  let S = null;
  let root = null;
  let helpOpen = false;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  function attrIcon(a, size) {
    return `<span class="cc-attr-icon" style="color:${a.color}${size ? ';font-size:' + size : ''}">${a.icon}</span>`;
  }

  /** 能力加成（221893-221930 的 sorg 阈值） */
  function bonusOf(raceKey, classKey, withClass) {
    const rc = cfg.data.raceClass;
    const r = rc.races[raceKey] || {}, c = rc.classes[classKey] || {};
    return ATTRS.map((a, i) => {
      let v = ((r.skills || {})[String(a.id)] | 0);
      if (withClass) v += ((c.attrs || {})[String(i)] | 0);
      let k = 0;
      if (v > 13) k = 1; else if (v > 11) k = 2; else if (v > 9) k = 3;
      else if (v > 7) k = 4; else if (v > 5) k = 5; else if (v > 3) k = 6;
      else if (v > 0) k = 7;
      return k;
    });
  }

  function bonusHtml(raceKey, classKey, withClass) {
    const ks = bonusOf(raceKey, classKey, withClass);
    const cells = [];
    // 截图是 3×3 网格，顺序：筋力/耐久/器用、感覚/習得/意志、魔力/魅力
    const order = [0, 1, 2, 3, 4, 5, 6, 7];
    for (const i of order) {
      const a = ATTRS[i], k = ks[i];
      cells.push(`<div class="cc-bonus">${attrIcon(a, '13px')}`
        + `<span style="color:${a.color}">${a.ch}</span>: `
        + `<span style="color:${BONUS_COLOR[k]}">${BONUS[k]}</span></div>`);
    }
    return `<div class="cc-bonus-grid">${cells.join('')}</div>`;
  }

  /** 221970-222000：武器専門合并一行，其余按 var_84 列效果（0-FH：中文） */
  function trainedHtml(skills) {
    const names = cfg.data.skills.skillNames || {};
    const nmOf = (id) => (names[String(id)] || {}).ch || (names[String(id)] || {}).jp || ('技能' + id);
    const weapons = [];
    const rows = [];
    for (const k of Object.keys(skills || {})) {
      const id = parseInt(k, 10);
      const v = skills[k] | 0;
      if (!v || id < 100 || id >= 600) continue;
      if (id >= 100 && id < 150) { weapons.push(nmOf(id)); continue; }
      const ds = SKILL_DESC[id] || '';
      rows.push(`<div class="cc-skill-line"><span class="nm">${esc(nmOf(id))}</span><span class="ds">${esc(ds)}</span></div>`);
    }
    let head = '';
    if (weapons.length) {
      head = `<div class="cc-skill-line"><span class="nm">${attrIcon(ATTRS[0], '13px')} 武器专精</span>`
        + `<span class="ds">${esc(weapons.slice(0, 12).join('、'))}</span></div>`;
    }
    return `<div class="cc-skill-list" data-act="none">${head}${rows.slice(0, 11).join('')}</div>`;
  }

  function descHtml(raceKey, classKey, withClass) {
    // 0-FH：race_class.json 只有 jp/en 说明，中文取自 racename.js 的 trait / classDesc
    // （已覆盖全部 11 种族与 12 职业），避免创建页残留日文长段。
    const txt = cfg.api.descText(raceKey, classKey, withClass);
    const raceName = withClass ? `种族：${esc(cfg.api.raceName(raceKey, 'ch'))}` : '';
    return `<div class="cc-detail">`
      + `<div class="cc-race-tag">${raceName}</div>`
      + `<div class="cc-desc-jp">${esc(txt)}</div></div>`;
  }

  // ---------------------------------------------------------------- 装饰
  function deco() {
    const leaf = `<svg viewBox="0 0 92 56" width="92" height="56" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 52 Q18 38 30 20 Q40 6 62 4" fill="none" stroke="#7c8ea0" stroke-width="2"/>
      <path d="M22 30 Q14 18 4 16 Q10 30 22 30Z" fill="#8ea6a0" stroke="#5c7570" stroke-width="1"/>
      <path d="M34 18 Q30 6 20 2 Q22 14 34 18Z" fill="#9fb4ae" stroke="#5c7570" stroke-width="1"/>
      <path d="M50 8 Q58 2 72 4 Q64 14 50 8Z" fill="#8ea6a0" stroke="#5c7570" stroke-width="1"/>
      <circle cx="62" cy="5" r="5" fill="#cfdbe4" stroke="#55708e" stroke-width="1.5"/>
      <circle cx="62" cy="5" r="2" fill="#4d78a8"/>
    </svg>`;
    const branch = `<svg viewBox="0 0 92 56" width="92" height="56" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4 Q18 24 44 34 Q66 42 88 40" fill="none" stroke="#6b6144" stroke-width="2"/>
      <ellipse cx="28" cy="22" rx="9" ry="4" transform="rotate(28 28 22)" fill="#5f7a45" opacity=".85"/>
      <ellipse cx="58" cy="38" rx="9" ry="4" transform="rotate(-16 58 38)" fill="#5f7a45" opacity=".85"/>
      <ellipse cx="78" cy="40" rx="8" ry="4" transform="rotate(12 78 40)" fill="#6d8a4c" opacity=".85"/>
    </svg>`;
    return `<div class="cc-deco-corner cc-deco-tl">${leaf}</div>`
      + `<div class="cc-deco-corner cc-deco-br">${branch}</div>`;
  }

  // ---------------------------------------------------------------- 各步内容
  function keyHtml(i) { return `<span class="cc-key">${LETTERS[i] || '?'}</span>`; }

  function listHtml(items, sel, act, extra) {
    return items.map((label, i) => `<div class="cc-row${i === sel ? ' on' : ''}" data-act="${act}" data-i="${i}">`
      + keyHtml(i) + `<span>${label}</span>${i === sel ? '' : ''}</div>`).join('');
  }

  /** 0-FI：異名の選択（220533-220610）—— 17 行，第 1 行是「重新抽取」 */
  function stepAlias() {
    const items = ['重新抽取'].concat(S.aliasList || []);
    return `<div class="cc-topic" style="position:absolute;left:28px;top:52px">别名候选</div>`
      + `<div class="cc-list cc-alias-list" style="left:28px;top:82px;width:330px">`
      + `${listHtml(items, S.sel, 'aliasrow')}</div>`;
  }

  /** 0-FI：経歴のロール（220635-220765）—— 5 个操作 + 5 行中文经历 */
  function stepProfile() {
    const items = ['确定', '保密', '全部重新抽取', '前半重新抽取', '后半重新抽取'];
    const lines = cfg.api.profileText(S.profile);
    return `<div class="cc-topic" style="position:absolute;left:28px;top:52px">经历</div>`
      + `<div class="cc-list" style="left:28px;top:82px;width:290px">`
      + `${listHtml(items, S.sel, 'profilerow')}</div>`
      + `<div class="cc-profile-lines">${lines.length ? lines.map(esc).join('<br>') : '（保密）'}</div>`;
  }

  /** 0-FI：モードの選択（221452-221655）—— 6 个模式 + 右侧中文说明 */
  function stepMode() {
    const modes = cfg.api.modes();
    const items = modes.map(m => m.key);
    const m = modes[Math.min(S.sel | 0, modes.length - 1)] || modes[0];
    return `<div class="cc-topic" style="position:absolute;left:28px;top:52px">模式候选</div>`
      + `<div class="cc-topic" style="position:absolute;left:240px;top:52px">各模式说明</div>`
      + `<div class="cc-list" style="left:28px;top:82px;width:200px">`
      + `${listHtml(items, S.sel, 'moderow')}</div>`
      + `<div class="cc-mode-desc"><b>★ ${esc(m.zh)}模式</b><br>`
      + `${(m.desc || []).map(esc).join('<br>')}</div>`;
  }

  /** 0-FI：*label_3103 的 76 个种族，按 16 项一页；光标项决定右栏内容 */
  function racePageItems() {
    const all = cfg.api.races();
    const per = 16;
    const pages = Math.max(1, Math.ceil(all.length / per));
    S.racePages = pages;
    if (S.page >= pages) S.page = pages - 1;
    return all.slice(S.page * per, S.page * per + per);
  }

  function stepRace() {
    const items = racePageItems();
    const labels = items.map(k => (cfg.api.isHiddenRace(k) ? '(额外) ' : '') + esc(cfg.api.raceName(k, 'ch')));
    const rk = items[Math.min(S.sel | 0, items.length - 1)] || items[0];
    // 220824-220840：右栏用当前光标项重算（gosub *label_3103 → *label_2281）
    return `<div class="cc-topic" style="position:absolute;left:28px;top:52px">可选择的种族</div>`
      + `<div class="cc-topic" style="position:absolute;left:268px;top:52px">种族说明</div>`
      + `<div class="cc-list" style="left:28px;top:82px;width:216px">${listHtml(labels, S.sel, 'racerow')}</div>`
      + `<div style="position:absolute;left:268px;top:82px;width:520px">`
      + descHtml(rk, S.class, false)
      + `<div class="cc-topic cc-flow-topic">能力加成</div>`
      + bonusHtml(rk, S.class, false)
      + `<div class="cc-topic cc-flow-topic">习得技能</div>`
      + trainedHtml((cfg.data.raceClass.races[rk] || {}).skills)
      + `</div>`;
  }

  function stepGender() {
    const items = GENDERS.map(g => esc(g.zh));
    return `<div class="cc-topic" style="position:absolute;left:28px;top:52px">性别候选</div>`
      + `<div class="cc-list" style="left:28px;top:82px;width:300px">${listHtml(items, S.sel, 'pick')}</div>`;
  }

  function stepClass() {
    const classes = cfg.api.classes();
    const items = classes.map(k => esc(cfg.api.className(k, 'ch')));
    const ck = classes[Math.min(S.sel | 0, classes.length - 1)] || classes[0];
    // 221100-221130：右栏同样按当前光标项（*label_3104 var_59=11 的说明）
    return `<div class="cc-topic" style="position:absolute;left:28px;top:52px">可选择的职业</div>`
      + `<div class="cc-topic" style="position:absolute;left:268px;top:52px">职业说明</div>`
      + `<div class="cc-list" style="left:28px;top:82px;width:216px">${listHtml(items, S.sel, 'pick')}</div>`
      + `<div style="position:absolute;left:268px;top:82px;width:520px">`
      + descHtml(S.race, ck, true)
      + `<div class="cc-topic cc-flow-topic">能力加成</div>`
      + bonusHtml(S.race, ck, true)
      + `<div class="cc-topic cc-flow-topic">习得技能</div>`
      + trainedHtml((cfg.data.raceClass.classes[ck] || {}).skills)
      + `</div>`;
  }

  /** step4 技能候选（100..399），与 fillSkillOptions 同口径，按分类分页 */
  function skillIds() {
    // *label_2778：候选是写死的 150..190 + 300/301，不再从角色 potential 里筛
    S.skillPages = Math.max(1, Math.ceil(BIRTH_SKILLS.length / 15));
    return BIRTH_SKILLS.slice();
  }

  function stepSkill() {
    const all = skillIds();
    const per = 15;
    const pages = Math.max(1, Math.ceil(all.length / per));
    S.skillPages = pages;
    if (S.page >= pages) S.page = pages - 1;
    const ids = all.slice(S.page * per, S.page * per + per);
    const names = cfg.data.skills.skillNames || {};
    const owned = Object.assign({},
      (cfg.data.raceClass.races[S.race] || {}).skills || {},
      (cfg.data.raceClass.classes[S.class] || {}).skills || {});
    const nmOf = (id) => (names[String(id)] || {}).ch || (names[String(id)] || {}).jp || ('技能 ' + id);
    const rows = ids.map((id, i) => {
      const nm = nmOf(id);
      const star = owned[String(id)] ? '＊' : '';
      return `<div class="cc-skill-line2${i === S.sel ? ' on' : ''}" data-act="skillrow" data-i="${i}">`
        + `<span>${keyHtml(i)}</span>`
        + `<span class="st">${star}</span>`
        + `<span>${esc(nm)}</span>`
        + `<span class="st">${attrIcon(ATTRS[i % 8], '13px')}</span>`
        + `<span class="ef">${esc(SKILL_DESC[id] || (id >= 100 && id < 150 ? nmOf(id) + '相关技术' : '—'))}</span></div>`;
    }).join('');
    return `<div class="cc-topic" style="position:absolute;left:100px;top:54px">能力名称</div>`
      + `<div class="cc-topic" style="position:absolute;left:500px;top:54px">效果</div>`
      + `<div class="cc-cat-static" style="position:absolute;left:160px;top:88px">◆ 特笔技能（共 43 项）</div>`
      + `<div class="cc-skill-table">${rows}</div>`;
  }

  function stepAttr() {
    const p = S.player;
    const locked = S.locked;
    const items = ['确定', '重新抽取'].concat(ATTRS.map(a => a.ch));
    const left = 2 - locked.size;
    return `<div class="cc-topic" style="position:absolute;left:28px;top:52px">能力</div>`
      + `<div class="cc-roll-note">已锁定的能力<br>不会变化</div>`
      + `<div class="cc-roll-lock">剩余锁定：${left}</div>`
      + `<div class="cc-list" style="left:28px;top:82px;width:172px">${listHtml(items, S.sel, 'attrrow')}</div>`
      + `<div class="cc-roll-vals">${ATTRS.map((a, i) => {
        const v = p ? (p.skill(a.id) | 0) : 0;
        const lk = locked.has(a.id);
        return `<div class="r">${attrIcon(a, '15px')}<span>${v}</span>${lk ? '<span class="lk">已锁定</span>' : ''}</div>`;
      }).join('')}</div>`;
  }

  // ---------------------------------------------------------------- 天赋（0-FH 多级）
  /**
   * var_97(id)：同一 id 在 S.feats 里出现的次数 = 该天赋的等级。
   * `game.applyBirthFeats` 已按「同一 id 再出现一次就升一级（受 maxLevelOf 限制）」结算，
   * 所以这里保持数组可重复，不需要在预览角色上提前 apply。
   */
  function featLevel(id) {
    let n = 0;
    for (const x of (S.feats || [])) if ((x | 0) === (id | 0)) n++;
    return n;
  }
  function featMaxOf(id) {
    return (cfg.api.featMax ? (cfg.api.featMax(id) | 0) : 1) || 1;
  }
  /** 已选 id（去重，按首次选中的顺序） */
  function featPickedIds() {
    const seen = Object.create(null), out = [];
    for (const x of (S.feats || [])) {
      const id = x | 0;
      if (!seen[id]) { seen[id] = 1; out.push(id); }
    }
    return out;
  }
  function featPointsLeft() { return Math.max(0, 3 - (S.feats || []).length); }

  /**
   * 285802-285837「取得一个フィート」：点数 -1、等级 +1。
   * 285809 `var_92(2) <= var_97(id)` →「これ以上取得できない」。
   */
  function takeFeat(id) {
    id = id | 0;
    const lv = featLevel(id), max = featMaxOf(id);
    if (featPointsLeft() <= 0) { S.notice = '天赋点数已用尽。'; return false; }
    if (lv >= max) { S.notice = '这项天赋已达最高等级。'; return false; }
    S.feats.push(id);
    S.notice = '';
    return true;
  }
  /** 点已选列表 → 退掉一级，返还 1 点 */
  function dropFeatLevel(id) {
    const k = (S.feats || []).lastIndexOf(id | 0);
    if (k >= 0) S.feats.splice(k, 1);
    S.notice = '';
  }

  function stepFeat() {
    const p = S.player;
    const ids = cfg.api.featCandidates(p) || [];
    const per = 5;
    const pages = Math.max(1, Math.ceil(ids.length / per));
    S.featPages = pages;
    if (S.page >= pages) S.page = pages - 1;
    const slice = ids.slice(S.page * per, S.page * per + per);
    const rows = slice.map((id, i) => {
      const lv = featLevel(id), max = featMaxOf(id);
      const full = lv >= max;
      // 源码 *label_0043 用 var_97(id)+1 取名字：显示「再选一次会得到的等级」
      const nm = cfg.api.featName(id, Math.min(lv + 1, max));
      const ds = cfg.api.featDesc(id);
      const lvl = max > 1 ? `<span class="cc-feat-lv${full ? ' max' : ''}">Lv.${lv}/${max}</span>` : '';
      return `<div class="cc-row${i === S.sel ? ' on' : ''}${full ? ' cc-feat-full' : ''}" data-act="featrow" data-i="${i}" style="width:760px;height:28px">`
        + `<span class="cc-attr-icon" style="color:#c8a52a">✦</span>${keyHtml(i)}`
        + `<span style="width:170px">${esc(nm)}</span><span style="font-size:14px;flex:1">${esc(ds)}</span>${lvl}</div>`;
    }).join('');
    const picked = featPickedIds().map(id => {
      const lv = featLevel(id), max = featMaxOf(id);
      const tag = max > 1 ? `<span class="cc-feat-lv on">Lv.${lv}/${max}</span>` : '';
      return `<div class="pick" data-act="featdrop" data-id="${id}" title="点击退掉一级">`
        + `<span class="ico">✦</span>${esc(cfg.api.featName(id, lv))}${tag}</div>`;
    }).join('');
    const left = featPointsLeft();
    return `<div class="cc-topic" style="position:absolute;left:28px;top:52px">天赋名称</div>`
      + `<div class="cc-topic" style="position:absolute;left:340px;top:52px">天赋效果</div>`
      + `<div class="cc-list" style="left:28px;top:84px;width:780px">${rows}</div>`
      + `<div class="cc-feat-picked"><div class="lab">◆ 天赋与体质（点击可退一级）</div>`
      + `${picked || '<div class="pick" style="color:#666">（尚未选择）</div>'}</div>`
      + `<div class="cc-feat-notice" style="position:absolute;left:0;right:0;bottom:44px;text-align:center;font-weight:bold;font-size:14px">`
      + `${S.notice ? `<span style="color:#a02020">${esc(S.notice)}　</span>` : ''}`
      + `还可获得 ${left} 点天赋${maxHint()}</div>`;
  }

  /** 底部给一句多级提示，避免玩家以为只能选 3 个不同的 */
  function maxHint() {
    return '<span style="font-weight:normal;font-size:11.5px;color:#5a4a30">（同一项可反复选来升级）</span>';
  }


  function lookValue(item) {
    const p = S.player;
    if (!p) return 0;
    if (item.key === 'portrait') return S.portrait | 0;
    if (item.idx === undefined) return 0;
    if (!p.pcc) return 0;
    const v = p.pcc[item.idx] | 0;
    return item.color ? idiv(v, 1000) : (v % 1000);
  }
  function stepLook() {
    const items = LOOK_PAGES[S.lookPage | 0];
    if (S.sel >= items.length) S.sel = 0;
    const rows = items.map((it, i) => `<div class="cc-look-row${i === S.sel ? ' on' : ''}" data-act="lookrow" data-i="${i}">`
      + `<span class="cc-arrow" data-act="val" data-i="${i}" data-d="-1">≪</span>`
      + `<span style="padding-left:8px">${esc(it.jp)}</span>`
      + `<span class="val">${(it.key === 'done' || it.key === 'page0' || it.key === 'page1') ? '' : lookValue(it)}</span>`
      + `<span class="cc-arrow" data-act="val" data-i="${i}" data-d="1">≫</span></div>`).join('');
    return `<div class="cc-topic" style="position:absolute;left:34px;top:52px">项目</div>`
      + `<div class="cc-list" style="left:30px;top:86px;width:220px">${rows}</div>`
      + `<div class="cc-look-preview"><div class="cc-face-tile" id="cc-face"></div>`
      + `<canvas id="cc-pcc" width="96" height="144"></canvas></div>`
      + `<div class="cc-look-sprite"><canvas id="cc-pcc-small" width="92" height="108"></canvas></div>`;
  }

  /**
   * 294985-295090：face1.bmp / face2.bmp 每格 48×72、16 列，本项目按 2 倍绘制。
   * 索引 = sex * 80 + portrait（>=80 用 face2）。导出给 c 键人物信息窗复用。
   */
  function faceTileOf(sex, portrait) {
    const n = Math.max(0, Math.min(159, portrait | 0));
    const img = n < 80 ? 'face1.bmp' : 'face2.bmp';
    const idx = (sex | 0) * 80 + (n < 80 ? n : n - 80);
    return { img, x: (idx % 16) * 96, y: idiv(idx, 16) * 144 };
  }
  function faceTileHtml() { return faceTileOf(S.gender, S.portrait); }

  /**
   * 0-FI：总览的共享渲染。创建向导第 11 步与游戏内 c 键人物信息第 1 页
   * 都调用它，保证两个窗口「一样」。
   *
   * @param {object} d {
   *   face:{img,x,y}, name:string, nameInput:boolean,
   *   head:[[cls,[[k,v],...]],...]   顶部三组键值
   *   attrs:[{icon,color,ch,value,rank}]  8 项能力
   *   misc:[string] 其它信息（每行）
   *   modeName:string, essential:[string], profile:[string]
   *   bless:number, fix:[[string],[string]]
   * }
   */
  function summaryHtml(d) {
    const topic = (t) => `<div class="cc-topic cc-topic-light cc-sum-topic">${esc(t)}</div>`;
    const kv = (k, v) => `<span class="k">${esc(k)}</span><span class="v">${v}</span>`;
    const group = (cls, pairs) => `<div class="cc-sum-kv ${cls}">${pairs.map(([k, v]) => kv(k, v)).join('')}</div>`;
    const attrRows = d.attrs.map(a =>
      `<div class="r"><span class="cc-attr-icon" style="color:${a.color};font-size:13px">${a.icon}</span>`
      + `<span>${esc(a.ch)}</span><span>${a.value} (${a.value})</span>`
      + `<span class="pot">${esc(a.rank)}</span></div>`).join('');
    const face = d.face || { img: 'face1.bmp', x: 0, y: 0 };
    const nameCell = d.nameInput
      ? `<input id="cc-pc-name" class="cc-name-input" value="${esc(d.name)}" maxlength="12" />`
      : esc(d.name);
    const head = d.head.map(([cls, pairs], i) => {
      if (i === 0) pairs = pairs.map(([k, v], j) => (j === 0 ? [k, nameCell] : [k, v]));
      return group(cls, pairs);
    }).join('');
    return `<div class="cc-summary">`
      + `<div class="cc-sum-head">${head}</div>`
      + `<div class="cc-sum-portrait"><div class="cc-face-tile" id="cc-face"`
      + ` style="background-image:url('assets/graphic/${face.img}');`
      + `background-position:-${face.x}px -${face.y}px"></div></div>`
      + `<div class="cc-sum-lower">`
      + `<div class="cc-sum-lcol">`
      + topic('能力（初始值）– 潜在能力')
      + `<div class="cc-sum-attrs">${attrRows}</div>`
      + topic('其它信息')
      + `<div class="cc-sum-misc">${d.misc.map(esc).join('<br>')}</div></div>`
      + `<div class="cc-sum-mcol">`
      + topic(d.modeName + '模式')
      + `<div class="cc-sum-misc">${d.essential.map(esc).join('<br>')}</div>`
      + topic('经历')
      + `<div class="cc-sum-profile">${d.profile.map(esc).join('<br>')}</div></div>`
      + `<div class="cc-sum-rcol">`
      + topic('祝福与诅咒')
      + `<div class="cc-bless-grid">${'<i></i>'.repeat(d.bless || 15)}</div>`
      + topic('各种修正')
      + `<div class="cc-sum-fix">`
      + `<div>${d.fix[0].map(esc).join('<br>')}</div>`
      + `<div>${d.fix[1].map(esc).join('<br>')}</div>`
      + `</div></div>`
      + `</div></div>`;
  }

  function stepSummary() {
    const p = S.player;
    const rn = cfg.api.raceName(S.race, 'ch');
    const cn = cfg.api.className(S.class, 'ch');
    const gd = GENDERS[S.genderIndex | 0] || GENDERS[0];
    const pot = p ? (p.potential || {}) : {};
    const mode = cfg.api.modeByValue(S.mode);
    const attrRows = ATTRS.map(a => {
      const v = p ? (p.skill(a.id) | 0) : 0;
      const pv = pot[String(a.id)] | 0;
      const rank = pv > 40000000 ? 'Superb' : (pv > 25000000 ? 'Great' : 'Good');
      return { icon: a.icon, color: a.color, ch: a.ch, value: v, rank };
    });
    return summaryHtml({
      face: faceTileHtml(), name: S.name, nameInput: true,
      head: [
        ['cc-sum-c1', [['姓名', ''], ['别名', esc(S.alias || '无')],
          ['种族', esc(rn)], ['性别', esc(gd.zh)], ['职业', esc(cn)]]],
        ['cc-sum-c2', [['年龄', `${S.age | 0} 岁`], ['身高', `${S.height | 0} cm`],
          ['体重', `${S.weight | 0} kg`], ['INIT', '230/120'], ['AP', '0(0)']]],
        ['cc-sum-c3', [['等级', '1'], ['经验', '0'],
          ['所需经验', `${p ? (p.get(36) | 0) : 3024}`],
          ['信仰', '无之艾斯'], ['所属', '无']]],
      ],
      attrs: attrRows,
      misc: ['荷车重量 16.0s / 上限 80.0s', '装备重量 4.0s（轻装备）',
        '回合 0 / 总时间 0月5分17秒', '证明：无持续效果'],
      modeName: mode.zh,
      essential: [
        `HP/MP　${p ? p.hpMax : 0}/${p ? p.mpMax : 0}`,
        `生命力　${p ? p.hpMax : 0}(${p ? p.hpMax : 0})`, '魔力　130(130)',
        '疯狂度　0%', `速度　${S.speed | 0}(120)`, '名声　0', '业力　0', '战力评价　0阶相当',
      ],
      profile: cfg.api.profileText(S.profile).length
        ? cfg.api.profileText(S.profile) : ['（保密）'],
      bless: 15,
      fix: [['格斗　2d11+0 x1.0', '射击　1d12+1 x0.9', '减轻　5% +1d3'],
        ['魔法威力　100%', '命中　95%', '命中　56%', '回避　1004%']],
    });
  }


  // ---------------------------------------------------------------- 框架
  function bodyOf(step) {
    switch (STEPS[step]) {
      case 'alias': return stepAlias();
      case 'profile': return stepProfile();
      case 'race': return stepRace();
      case 'gender': return stepGender();
      case 'class': return stepClass();
      case 'skill': return stepSkill();
      case 'attr': return stepAttr();
      case 'feat': return stepFeat();
      case 'look': return stepLook();
      case 'mode': return stepMode();
      case 'summary': return stepSummary();
      default: return '';
    }
  }

  function pageOf(step) {
    if (step === IDX.race) return `Page.${(S.page | 0) + 1}/${S.racePages || 1}`;
    if (step === IDX.skill) return `Page.${(S.page | 0) + 1}/${S.skillPages || 1}`;
    if (step === IDX.feat) return `Page.${(S.page | 0) + 1}/${S.featPages || 1}`;
    if (step === IDX.alias || step === IDX.profile || step === IDX.summary) return 'Page.1/1';
    return '';
  }

  function footOf(step) {
    const back = `<span class="cc-back-icon"></span>`;
    if (step === IDX.skill || step === IDX.race) {
      return `<div class="cc-foot">${back}<span>Shift、Esc [返回]</span>`
        + `<span class="cc-foot-spacer"></span>`
        + `<span class="cc-foot-hint">← → [翻页]</span></div>`;
    }
    if (step === IDX.feat) {
      // 0-FI：原版点数用尽自动进入下一步，没有「确定」按钮
      return `<div class="cc-foot">${back}<span>Shift、Esc [返回]</span>`
        + `<span class="cc-foot-spacer"></span>`
        + `<span class="cc-foot-hint">+ - [翻页]　选满 3 点自动继续</span></div>`;
    }
    if (step === IDX.look) {
      return `<div class="cc-foot">${back}<span>左右键 [调整]　取消 [关闭]</span>`
        + `<span class="cc-foot-spacer"></span>`
        + `<button data-act="next">确定</button></div>`;
    }
    if (step === IDX.summary) {
      return `<div class="cc-foot">${back}<span>确定键 [重新抽取]　p [更换立绘]　Shift、Esc [最终确认]</span>`
        + `<span class="cc-foot-spacer"></span>`
        + `<button data-act="finish">开始冒险</button></div>`;
    }
    return `<div class="cc-foot" data-act="prev" style="cursor:pointer">${back}<span>Shift、Esc [返回]</span>`
      + `<span class="cc-foot-spacer"></span><span class="cc-foot-hint">Enter [确定]</span></div>`;
  }

  function titleOf(step) {
    const t = TITLES[step];
    if (!t) return '';
    const small = (step === IDX.alias || step === IDX.profile || step === IDX.gender
      || step === IDX.attr || step === IDX.look);
    return `<div class="cc-title${small ? ' cc-title-small' : ''}${step === IDX.feat ? ' cc-title-center' : ''}">`
      + (step === IDX.feat ? '<span style="color:#e8992f;margin-right:10px">♟</span>' : '') + esc(t) + '</div>';
  }

  function render() {
    if (!root || !S) return;
    const step = S.step | 0;
    const tip = TIPS[step] || TIPS[0];   // [0] 中文显示 / [1] 源码日文原文
    // TIPS[1] 是源码日文原句，仅保留在常量里供对照，不出现在界面上
    root.innerHTML = `<div class="cc-hint-bar">${esc(tip[0])}</div>`
      + `<div class="cc-window ${WIN_CLASS[step]}">`
      + deco() + titleOf(step) + bodyOf(step)
      + (pageOf(step) ? `<div class="cc-page">${pageOf(step)}</div>` : '')
      + footOf(step)
      + `</div>`
      + `<div class="cc-f1">Press F1 to show help.</div>`
      + (helpOpen ? helpHtml() : '');
    fitStage();
    paint();
    syncLegacy();
    if (cfg.onChange) cfg.onChange(S);
  }

  function helpHtml() {
    return `<div class="cc-help"><h3>角色创建 / 操作说明</h3>`
      + `↑↓ / j k：移动光标　　a〜l：直接选择<br>`
      + `Enter / 空格 / z：决定　　← →：翻页 / 调整数值<br>`
      + `Esc / Shift：返回上一步　　F1：开关本说明<br>`
      + `共 8 步：种族 → 性别 → 职业 → 技能 → 属性 → 天赋 → 外观 → 总览。<br>`
      + `天赋共 3 点：同一项可以反复选来提升等级（如「幸运者」最高 3 级），`
      + `点下方已选列表可退掉一级。`
      + `<div class="cc-help-close"><button data-act="help">关闭</button></div></div>`;
  }

  function fitStage() {
    const st = root.classList.contains('cc-stage') ? root : root.querySelector('.cc-stage');
    if (!st) return;
    const sc = Math.min(global.innerWidth / 1000, global.innerHeight / 720, 1.35);
    st.style.setProperty('--cc-scale', String(Math.max(0.45, sc)));
  }

  /** 画布 / 立绘背景的实际绘制（innerHTML 重建后必须重画） */
  function paint() {
    const face = faceTileHtml();
    const f = root.querySelector('#cc-face');
    if (f) {
      f.style.backgroundImage = `url(assets/graphic/${face.img})`;
      f.style.backgroundPosition = `-${face.x}px -${face.y}px`;
    }
    // 源码 295060-295090：光标停在「肖像」行时显示立绘，其余行显示 PCC 角色
    const showFace = isStep('summary') || (isStep('look') && (S.lookSel | 0) === 1);
    if (f) f.style.display = showFace ? 'block' : 'none';
    const cv = root.querySelector('#cc-pcc');
    if (cv) {
      cv.style.display = showFace ? 'none' : 'block';
      if (!showFace && cfg.api.preview) cfg.api.preview(S.player, cv, {});
    }
    const cs = root.querySelector('#cc-pcc-small');
    if (cs && cfg.api.preview) cfg.api.preview(S.player, cs, {});
  }

  // ---------------------------------------------------------------- 导航
  function itemsOf(step) {
    switch (STEPS[step]) {
      case 'alias': return ['重新抽取'].concat(S.aliasList || []);
      case 'profile': return ['确定', '保密', '全部重新抽取', '前半重新抽取', '后半重新抽取'];
      case 'race': return racePageItems();
      case 'gender': return GENDERS;
      case 'class': return cfg.api.classes();
      case 'skill': return skillIds().slice((S.page | 0) * 15, (S.page | 0) * 15 + 15);
      case 'attr': return ['确定', '重新抽取'].concat(ATTRS.map(a => a.ch));
      case 'feat': return (cfg.api.featCandidates(S.player) || []).slice((S.page | 0) * 5, (S.page | 0) * 5 + 5);
      case 'look': return LOOK_PAGES[S.lookPage | 0];
      case 'mode': return cfg.api.modes();
      default: return [];
    }
  }

  function move(d) {
    const n = itemsOf(S.step).length;
    if (!n) return;
    S.sel = (S.sel + d + n) % n;
    if (isStep('look')) S.lookSel = S.sel;
    render();
  }

  function setStep(step) {
    S.step = Math.max(0, Math.min(STEPS.length - 1, step | 0));
    S.sel = 0; S.page = 0; S.notice = '';
    if (S.step === IDX.attr) {                   // 进入属性页先掷一次（221264-221290）
      S.busy = true;
      cfg.api.build(S, true)
        .then(() => { S.busy = false; render(); })
        .catch(() => { S.busy = false; render(); });
      return;
    }
    if (S.step === IDX.look) S.lookSel = 0;
    if (S.step === IDX.summary && S.player) S.player.set(13, S.portrait | 0);
    render();
  }

  function prevStep() {
    if (S.step === 0) { cfg.api.cancel(); return; }
    setStep(S.step - 1);
  }


  /** 当前步的确认动作 */
  function confirm(sel) {
    if (S.busy) return;
    const step = S.step;
    const items = itemsOf(step);
    const i = sel === undefined ? S.sel : sel;
    switch (STEPS[step]) {
      case 'alias': {
        if (i === 0) {                                   // 220585「再抽選」
          S.aliasList = cfg.api.rollAliases();
          S.sel = 0; render();
          return;
        }
        S.alias = items[i] || items[1] || '';
        setStep(IDX.profile);
        return;
      }
      case 'profile': {
        // 220720-220760：0 决定 / 1 保密 / 2 全重抽 / 3 前半(0,1) / 4 后半(2,3,4)
        if (i === 0) { setStep(IDX.race); return; }
        if (i === 1) { S.profile = [0, 0, 0, 0, 0]; setStep(IDX.race); return; }
        const rng = cfg.api.rng();
        const roll = () => 1 + rng.rnd(45);
        const from = i === 3 ? 0 : 2, to = i === 3 ? 2 : 5;
        for (let k = from; k < to; k++) S.profile[k] = roll();
        S.sel = 0; render();
        return;
      }
      case 'race': {
        S.race = items[i] || items[0];
        S.sel = i;
        S.busy = true;
        cfg.api.build(S, false)
          .then(() => { S.busy = false; setStep(IDX.gender); })
          .catch(() => { S.busy = false; setStep(IDX.gender); });
        return;
      }
      case 'gender': {
        S.genderIndex = i;
        const g = GENDERS[i] || GENDERS[0];
        S.gender = g.sex; S.genderLabel = g.label;
        S.busy = true;
        cfg.api.build(S, false)
          .then(() => { S.busy = false; setStep(IDX.class); })
          .catch(() => { S.busy = false; setStep(IDX.class); });
        return;
      }
      case 'class': {
        S.class = items[i] || items[0];
        S.sel = i;
        S.busy = true;
        cfg.api.build(S, false)
          .then(() => { S.busy = false; setStep(IDX.skill); })
          .catch(() => { S.busy = false; setStep(IDX.skill); });
        return;
      }
      case 'skill': {
        if (items[i] !== undefined) S.skill = items[i] | 0;
        setStep(IDX.attr);
        return;
      }
      case 'attr': {
        if (i === 0) { setStep(IDX.feat); return; }
        if (i === 1) {
          cfg.api.build(S, true).then(() => render()).catch(() => render());
          return;
        }
        const a = ATTRS[i - 2];
        if (!a) return;
        if (S.locked.has(a.id)) S.locked.delete(a.id);
        else if (S.locked.size < 2) S.locked.add(a.id);
        S.sel = i; render();
        return;
      }
      case 'feat': {
        const id = items[i];
        if (id === undefined) return;
        const okPick = takeFeat(id);
        S.sel = i;
        // 0-FI：3 点用尽自动进入下一步（原版没有「确定」按钮）
        if (okPick && featPointsLeft() === 0) { setStep(IDX.look); return; }
        render();
        return;
      }
      case 'look': {
        const it = LOOK_PAGES[S.lookPage | 0][i];
        if (!it) return;
        if (it.key === 'done') { setStep(IDX.mode); return; }
        if (it.key === 'page0') { S.lookPage = 0; S.sel = 0; render(); return; }
        if (it.key === 'page1') { S.lookPage = 1; S.sel = 0; render(); return; }
        adjustLook(i, 1);
        return;
      }
      case 'mode': {
        const m = items[i];
        if (m) S.mode = m.value;
        setStep(IDX.summary);
        return;
      }
      case 'summary': {
        rollBody();
        render();
        return;
      }
      default: return;
    }
  }


  function rollBody() {
    const rng = cfg.api.rng();
    S.age = 16 + rng.rnd(20);
    S.height = 140 + rng.rnd(45);
    S.weight = 38 + rng.rnd(42);
    S.speed = 100 + rng.rnd(25);
  }

  /** 外观某项 ±1（源码 295175-295235：先 exist 判断部件文件，颜色上限 30） */
  function adjustLook(i, d) {
    const it = LOOK_PAGES[S.lookPage | 0][i];
    if (!it || !S.player) return;
    const p = S.player;
    if (!p.pcc) cfg.api.ensurePcc(p);
    if (!p.pcc) return;
    if (it.key === 'portrait') {
      S.portrait = Math.max(0, Math.min(159, (S.portrait | 0) + d));
      p.set(13, S.portrait | 0);
    } else if (it.idx !== undefined) {
      const cur = p.pcc[it.idx] | 0;
      const pal = idiv(cur, 1000), part = cur % 1000;
      if (it.color) {
        const np = Math.max(0, Math.min(COLOR_MAX - 1, pal + d));
        p.pcc[it.idx] = np * 1000 + part;
      } else {
        const max = PART_MAX[it.layer] || 1;
        const nv = Math.max(1, Math.min(max, part + d));
        p.pcc[it.idx] = pal * 1000 + nv;
      }
      p.__pccCache = null;
      p.__pccFrames = null;
    }
    S.sel = i; S.lookSel = i;
    syncLegacy();
    render();
    // 0-FI：PCC.preload 是异步的，必须等新部件图加载完再合成，
    // 否则 compose() 遇到缺图会返回 null，预览画布被清空（看起来「没变化」）。
    Promise.resolve(cfg.api.refreshPcc(p)).then(() => {
      paint();
      global.setTimeout(paint, 60);
    }).catch(() => paint());
    paint();
  }

  // ---------------------------------------------------------------- 事件
  function onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const act = el.dataset.act;
    const i = parseInt(el.dataset.i, 10) | 0;
    switch (act) {
      case 'pick': case 'racerow': case 'aliasrow': case 'profilerow':
      case 'moderow': case 'attrrow': case 'skillrow': case 'lookrow': {
        // 220860-220880：cs_list 点中候补即等于按下对应字母键，直接进入下一步
        confirm(i);
        return;
      }
      case 'featrow': {
        // 天赋有 3 点、可重复选同一项升级；点数用尽自动进入下一步
        S.sel = i;
        confirm(i);
        return;
      }
      case 'val': {
        ev.stopPropagation();
        adjustLook(i, parseInt(el.dataset.d, 10) | 0);
        return;
      }
      case 'featdrop': {
        dropFeatLevel(parseInt(el.dataset.id, 10));
        render();
        return;
      }
      case 'prev': prevStep(); return;
      case 'next': setStep(S.step + 1); return;
      case 'finish': finish(); return;
      case 'help': helpOpen = false; render(); return;
      default: return;
    }
  }

  function onInput(ev) {
    if (ev.target && ev.target.id === 'cc-pc-name') S.name = ev.target.value;
  }

  function onKey(ev) {
    if (!root || !root.closest('.screen.active')) return;
    // 名字输入框里不劫持按键
    if (ev.target && ev.target.tagName === 'INPUT') {
      if (ev.key === 'Enter') { ev.target.blur(); ev.preventDefault(); }
      return;
    }
    const k = ev.key;
    if (k === 'F1') { ev.preventDefault(); helpOpen = !helpOpen; render(); return; }
    if (k === 'Escape' || k === 'Shift') { ev.preventDefault(); prevStep(); return; }
    if (k === 'ArrowUp' || k === 'k' || k === 'K') { ev.preventDefault(); move(-1); return; }
    if (k === 'ArrowDown' || k === 'j' || k === 'J') { ev.preventDefault(); move(1); return; }
    if (k === 'ArrowLeft' || k === 'h' || k === '-') {
      ev.preventDefault();
      if (isStep('look')) adjustLook(S.sel, -1);
      else if (S.page > 0) { S.page--; S.sel = 0; render(); }
      return;
    }
    if (k === 'ArrowRight' || k === 'l' || k === '+') {
      ev.preventDefault();
      if (isStep('look')) adjustLook(S.sel, 1);
      else {
        const pages = isStep('skill') ? (S.skillPages || 1)
          : (isStep('feat') ? (S.featPages || 1) : (S.racePages || 1));
        if (S.page < pages - 1) { S.page++; S.sel = 0; render(); }
      }
      return;
    }
    if (k === 'Enter' || k === ' ' || k === 'z' || k === 'Z') {
      ev.preventDefault();
      if (isStep('summary')) { const nm = root.querySelector('#cc-pc-name'); if (nm) S.name = nm.value.trim() || 'Elona'; }
      confirm();
      return;
    }
    if (k === 'p' && isStep('summary')) { ev.preventDefault(); setStep(IDX.look); return; }
    if (k.length === 1 && /[a-s]/.test(k)) {
      const n = LETTERS.indexOf(k);
      if (n >= 0 && n < itemsOf(S.step).length) { ev.preventDefault(); S.sel = n; confirm(n); }
      return;
    }
  }

  function finish() {
    const nm = root.querySelector('#cc-pc-name');
    if (nm) S.name = nm.value.trim() || 'Elona';
    if (S.player) {
      S.player.name = S.name;
      S.player.set(13, S.portrait | 0);
    }
    cfg.api.done(S);
  }

  // ---------------------------------------------------------------- 旧 DOM 兼容桥
  /**
   * 把向导状态镜像到 #cc-legacy 的旧表单。tools/browser_check.js 等回归脚本
   * 仍按 #pc-race / #pc-feats / #btn-create-ok 等选择器操作，这里保证语义不变。
   */
  function syncLegacy() {
    const q = (id) => document.getElementById(id);
    const nm = q('pc-name');
    if (nm) nm.value = S.name || 'Elona';
    const rs = q('pc-race'), cs = q('pc-class'), gs = q('pc-gender'), sk = q('pc-skill');
    if (!rs) return;
    const rc = cfg.data.raceClass;
    const races = cfg.api.races(), classes = cfg.api.classes();
    const rOpts = races.map(k => `<option value="${k}">${esc(cfg.api.raceName(k, 'ch'))}</option>`).join('');
    if (rs.innerHTML !== rOpts) rs.innerHTML = rOpts;
    const cOpts = classes.map(k => `<option value="${k}">${esc(cfg.api.className(k, 'ch'))}</option>`).join('');
    if (cs.innerHTML !== cOpts) cs.innerHTML = cOpts;
    rs.value = S.race; cs.value = S.class;
    if (gs) { gs.innerHTML = '<option value="0">Female</option><option value="1">Male</option>'; gs.value = String(S.gender); }
    if (sk) {
      const ids = BIRTH_SKILLS.slice();
      const names = cfg.data.skills.skillNames || {};
      const opts = ids.map(id => `<option value="${id}">${esc((names[String(id)] || {}).ch || ('技能' + id))}</option>`).join('');
      if (sk.innerHTML !== opts) sk.innerHTML = opts;
      if (ids.indexOf(S.skill | 0) >= 0) sk.value = String(S.skill | 0);
      else if (ids.length) { sk.value = String(ids[0]); S.skill = ids[0]; }
    }
    const pts = q('pc-feat-points');
    if (pts) pts.textContent = String(featPointsLeft());
    const fb = q('pc-feats');
    if (fb) {
      // 0-FH：同一 id 可反复选升级，DOM 行仍按 id 去重（保持旧回归脚本的 snapshot 有效）
      const picked = featPickedIds();
      const ids = cfg.api.featCandidates(S.player) || [];
      const rows = picked.concat(ids.filter(id => picked.indexOf(id) < 0));
      const sig = rows.join(',');
      // 只有候选集合变化时才重建节点：旧回归脚本会先取一批 .pc-feat 元素再逐个 click，
      // 若每次点击都重建 DOM，快照里的节点会脱离文档导致后续点击丢失。
      if (fb.dataset.sig !== sig) {
        fb.innerHTML = rows.map(id =>
          `<div class="pc-feat" data-id="${id}"><span>${esc(cfg.api.featName(id, 1))}</span>`
          + `<span class="lv"></span></div>`).join('');
        fb.dataset.sig = sig;
      }
      fb.querySelectorAll('.pc-feat[data-id]').forEach((el) => {
        const id = parseInt(el.dataset.id, 10);
        const lv = featLevel(id), max = featMaxOf(id);
        el.classList.toggle('on', lv > 0);
        const lab = el.querySelector('.lv');
        if (lab) lab.textContent = lv > 0 ? (max > 1 ? ` Lv.${lv}/${max}` : ' ✓') : '';
      });
    }
    const attrs = q('pc-attrs');
    if (attrs) {
      const asig = ATTRS.map(a => `${a.id}:${S.player ? S.player.skill(a.id) : 0}`).join(',');
      if (attrs.dataset.sig !== asig) {
        attrs.innerHTML = ATTRS.map(a =>
          `<div class="attr-row" data-id="${a.id}"><span>${a.ch}</span>`
          + `<span class="av">${S.player ? S.player.skill(a.id) : 0}</span></div>`).join('');
        attrs.dataset.sig = asig;
      }
      attrs.querySelectorAll('.attr-row[data-id]').forEach((el) => {
        const id = parseInt(el.dataset.id, 10);
        const on = S.locked.has(id);
        el.classList.toggle('locked', on);
        const v = el.querySelector('.av');
        if (v) v.textContent = `${S.player ? S.player.skill(id) : 0}${on ? ' [L]' : ''}`;
      });
    }
    const prof = q('pc-profile');
    if (prof) prof.innerHTML = cfg.api.profileText(S.profile).map(t => `<div>${esc(t)}</div>`).join('');
    const info = q('pc-info');
    if (info) {
      const p = S.player;
      const RES = [[50, '火'], [51, '冷'], [52, '电'], [53, '暗'], [54, '幻'], [55, '毒'],
        [56, '狱'], [57, '音'], [58, '神'], [59, '混'], [60, '魔']];
      const resTxt = p ? (RES.map(([id, n]) => { const v = p.skill(id) | 0; return v ? `${n}${v}` : ''; })
        .filter(Boolean).join(' ') || '无') : '无';
      info.innerHTML = `HP ${p ? p.hpMax : 0}　MP ${p ? p.mpMax : 0}　SP ${p ? p.spMax : 0}<br><br>`
        + `<b>${esc(cfg.api.raceName(S.race, 'ch'))}</b><br>`
        + `<span class="dim">${esc((rc.races[S.race] || {}).desc ? ((rc.races[S.race].desc.jp || '').slice(0, 60)) : '')}</span><br>`
        + `<span class="dim">耐性：${esc(resTxt)}</span><br><br>`
        + `<b>${esc(cfg.api.className(S.class, 'ch'))}</b>`;
    }
    const cv = q('pc-preview');
    if (cv && cfg.api.preview) cfg.api.preview(S.player, cv, { portrait: false });
    bindLegacy();
  }

  let legacyBound = false;
  function bindLegacy() {
    if (legacyBound) return;
    const q = (id) => document.getElementById(id);
    const rs = q('pc-race'), cs = q('pc-class'), gs = q('pc-gender'), sk = q('pc-skill');
    if (!rs) return;
    legacyBound = true;
    rs.onchange = () => {
      S.race = rs.value; S.locked.clear();
      cfg.api.build(S, false).then(() => render()).catch(() => render());
    };
    cs.onchange = () => {
      S.class = cs.value; S.locked.clear();
      cfg.api.build(S, false).then(() => render()).catch(() => render());
    };
    if (gs) gs.onchange = () => {
      S.gender = parseInt(gs.value, 10) | 0;
      S.genderIndex = S.gender === 1 ? 1 : 0;
      cfg.api.build(S, false).then(() => render()).catch(() => render());
    };
    if (sk) sk.onchange = () => { S.skill = parseInt(sk.value, 10) | 0; };
    const fb = q('pc-feats');
    if (fb) fb.onclick = (ev) => {
      const el = ev.target.closest('.pc-feat[data-id]');
      if (!el) return;
      takeFeat(parseInt(el.dataset.id, 10));
      render();
    };
    const ar = q('pc-attrs');
    if (ar) ar.onclick = (ev) => {
      const el = ev.target.closest('.attr-row[data-id]');
      if (!el) return;
      const id = parseInt(el.dataset.id, 10);
      if (S.locked.has(id)) S.locked.delete(id);
      else if (S.locked.size < 2) S.locked.add(id);
      render();
    };
    const bindBtn = (id, fn) => { const b = q(id); if (b) b.onclick = fn; };
    bindBtn('btn-clear-feats', () => { S.feats = []; S.notice = ''; render(); });
    bindBtn('btn-reroll-attrs', () => cfg.api.build(S, true).then(() => render()).catch(() => render()));
    bindBtn('btn-reroll-profile', () => { S.profile = cfg.api.rollProfile(); render(); });
    bindBtn('btn-reroll-look', () => { cfg.api.randomLook(S); render(); });
    bindBtn('btn-create-ok', () => finish());
    bindBtn('btn-create-back', () => cfg.api.cancel());
  }

  // ---------------------------------------------------------------- 启动
  function start(options) {
    cfg = options;
    root = options.root;
    root.classList.add('cc-stage');
    S = {
      step: 0, sel: 0, page: 0, racePages: 1, skillPages: 1, featPages: 1,
      name: 'Elona', alias: '', aliasList: options.api.rollAliases(),
      race: options.api.races()[0], class: options.api.classes()[0],
      gender: 0, genderIndex: 0, genderLabel: '',
      skill: 150, skillCat: 0,
      locked: new Set(), feats: [],
      profile: options.api.rollProfile(),
      mode: 0,
      portrait: 0, lookPage: 0, lookSel: 0,
      player: null, busy: false, notice: '',
      age: 17, height: 165, weight: 55, speed: 110,
    };
    cfg.api.bindState(S);
    global.removeEventListener('keydown', onKey);
    global.addEventListener('keydown', onKey);
    root.removeEventListener('click', onClick);
    root.addEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    root.addEventListener('input', onInput);
    global.removeEventListener('resize', fitStage);
    global.addEventListener('resize', fitStage);
    return cfg.api.build(S, false).then(() => { render(); return S; }).catch(() => { render(); return S; });
  }

  Elona.CharCreate = {
    start, render, setStep, confirm, finish,
    featLevel, featMaxOf, featPointsLeft, takeFeat, dropFeatLevel, faceTileOf,
    summaryHtml, IDX, BIRTH_SKILLS, ATTRS,
    get state() { return S; },
    STEPS, TIPS, ATTRS, BONUS, SKILL_DESC, GENDERS, LOOK_PAGES,
  };
})(window);
