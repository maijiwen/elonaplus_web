'use strict';
/**
 * 剧情脚本模块（core/scene.js）—— 数据与播放序列
 *
 * 【源码依据】start.hsp 591627-592112（播放器 *label_4295 … *label_4300）
 *
 * 剧本文件 scene1.hsp（日）/ scene2.hsp（英）由 tools/extract_scene.py 提取为
 * web/data/scene/scene*.json。本模块只做「区块 → 可播放序列」的纯逻辑转换，
 * 不依赖任何显示层，便于单独测试。
 *
 * 标签语义（逐条对应播放器）：
 *   {txt}        旁白页（多行居中，592048-592071）
 *   {chat_N}     第 N 号角色的台词页（角色由 {actor_N} 定义，592001-592003）
 *   {actor_N}    角色定义 "名字,pic"
 *   {pic}        背景图 graphic/<arg>.bmp（592019）
 *   {mc}         音乐（映射表 591735-591985）
 *   {se}         音效 sound/<arg>（591993-591997）
 *   {fade}       黑场（591698）
 *   {fadein}     淡入（591706）
 *   {wait}       等待 1000ms（591718-592046）
 *   {end}        结束（591723）
 *
 * 【记录进度】var_65(36) = 已播放过的最大区块号（591630-591632），随存档持久化。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 已播放到的最远区块（源码 var_65(36)） */
  const V_LAST_SCENE = 36;

  /** 语言 → 剧本文件（源码 lang("scene1.hsp","scene2.hsp")，591644） */
  const FILE_OF = { jp: 'data/scene/scene1.json', en: 'data/scene/scene2.json' };

  const sets = {};            // 已加载的剧本集
  const pending = {};         // 正在加载的 Promise（避免重复请求）
  let trans = null;           // 译文表（web/data/scene/strings.json）
  let lang = 'jp';

  /** 加载某个语言的剧本集 */
  async function load(which) {
    const key = which || lang;
    if (sets[key]) return sets[key];
    if (pending[key]) return pending[key];
    pending[key] = (async () => {
      let data;
      try {
        data = await Elona.Data.fetchJson(FILE_OF[key]);
      } catch (e) {
        // 英文剧本可能不存在（原版英文只翻译了开场）
        data = { order: [], blocks: {} };
      }
      sets[key] = data;
      return data;
    })();
    return pending[key];
  }

  /**
   * 加载译文表：{ "sc1_2_0": "译文" } 的形式挂在 entries 下。
   * 汉化：运行期只读同一层级的中文字段 `zh`（`jp` 是提取时的日文原文，仅作对照）。
   */
  async function loadTrans() {
    if (trans) return trans;
    try {
      const d = await Elona.Data.fetchJson('data/scene/strings.json');
      const map = {};
      const es = (d && d.entries) || {};
      for (const k of Object.keys(es)) {
        const v = es[k];
        if (v && typeof v.zh === 'string' && v.zh.trim()) map[k] = v.zh;
      }
      trans = map;
    } catch (e) {
      trans = {};
    }
    return trans;
  }

  /** 设置/读取当前剧本语言（原版 config 的 language 项） */
  function setLang(v) { if (v === 'jp' || v === 'en') lang = v; return lang; }
  function getLang() { return lang; }

  /** 取区块（同步，需先 await load） */
  function block(id, which) {
    const s = sets[which || lang];
    if (!s) return null;
    return s.blocks[String(id)] || null;
  }

  /** 已有区块号列表 */
  function blockIds(which) {
    const s = sets[which || lang];
    if (!s) return [];
    return (s.order || []).slice();
  }

  /** 文本的译文键：sc<语言><区块>_<指令序>_<行序> */
  function textKey(setKey, blockId, cmdIdx, lineIdx) {
    return 'sc' + (setKey === 'en' ? '2' : '1') + '_' + blockId + '_' + cmdIdx + '_' + lineIdx;
  }

  /** 取一条文本的实际显示内容（有译文用译文，否则用原文） */
  function text(key, raw) {
    if (trans && trans[key]) return trans[key];
    return raw;
  }

  /**
   * 把区块展开成按源码顺序的指令序列。
   *
   * 返回 [{ t:'pic'|'mc'|'se'|'fade'|'fadein'|'wait'|'end' }, { t:'page', kind, lines, keys, speaker, actor }]
   * 其中 page.keys 与 lines 一一对应，供取译文用。
   */
  function sequence(id, which) {
    const key = which || lang;
    const b = block(id, key);
    if (!b) return [];
    const out = [];
    const actors = b.actors || {};
    b.commands.forEach((c, ci) => {
      if (c.op === 'txt' || c.op === 'say') {
        const lines = (c.lines || []).slice();
        out.push({
          t: 'page',
          kind: c.op === 'say' ? 'say' : 'txt',
          lines,
          keys: lines.map((_, li) => textKey(key, id, ci, li)),
          speaker: c.op === 'say' ? (c.speaker | 0) : 0,
          actor: c.op === 'say' ? (actors[c.speaker | 0] || null) : null,
          line: c.line,
        });
      } else if (c.op === 'unknown') {
        // 不认识的标签一律忽略（提取器会原样保留，便于以后发现遗漏）
      } else {
        out.push({ t: c.op, arg: c.arg || '', line: c.line });
      }
    });
    return out;
  }

  /** 区块里定义过的角色（{actor_N}） */
  function actorsOf(id, which) {
    const b = block(id, which);
    return (b && b.actors) || {};
  }

  /** 记录「已播放到该区块」（591630-591632：只增不减） */
  function markPlayed(g, id) {
    if (!g || typeof g.getV65 !== 'function') return;
    const v = g.getV65(V_LAST_SCENE) | 0;
    if (v < (id | 0)) g.setV65(V_LAST_SCENE, id | 0);
  }

  /** 已播放到的最远区块（原版「回放场景」菜单用它列出可回放项，602125） */
  function playedTo(g) {
    if (!g || typeof g.getV65 !== 'function') return 0;
    return g.getV65(V_LAST_SCENE) | 0;
  }

  /** 该区块是否已解锁（可用于回放列表） */
  function unlocked(g, id) {
    return (id | 0) <= playedTo(g);
  }

  Elona.Scene = {
    V_LAST_SCENE,
    load, loadTrans, setLang, getLang,
    block, blockIds, sequence, actorsOf,
    textKey, text, markPlayed, playedTo, unlocked,
    /** 测试用：清掉缓存 */
    _reset() { for (const k of Object.keys(sets)) delete sets[k];
               for (const k of Object.keys(pending)) delete pending[k];
               trans = null; },
  };
})(window);
