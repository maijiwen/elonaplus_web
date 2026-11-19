'use strict';
/**
 * 自定义物品（core/itemplan.js）—— `user/item/planN.txt`（N = 1..33）
 *
 * 【原版语义】物品的 `var_99(28)`（本项目 `it.f[28]`）是「plan 编号」，0 表示普通物品。
 *   1..33 对应 `user/item/planN.txt`，玩家改这个 txt 就能改物品的**名字 / 鉴定描述 / flavor**。
 *   台面上 33 个模板是原版随附的（`elonaplus2.33R/user/item/plan*.txt`）。
 *
 * 【文件格式】（`%标签,JP` / `%标签,EN`，段内是台词行，直到下一个 `%`）
 *   ```
 *   					/            ← 第 0 行，原版没用（strmid 的起点无关紧要）
 *   %txtName,JP
 *   サンプル1
 *   %txtName,EN
 *                                              no name
 *   %txtDescript0,JP
 *   なんということでしょう。どこにでもある普通のアイテムが…
 *   %txtDescript1,JP
 *   〜アイテム鑑定レポート〜
 *   %txtDescript2,JP
 *   「またつまらぬものを作ってしまった」
 *   %txtDescript3,JP
 *   〜伝説の職人『ガロク』の言葉〜
 *   %txtFlavor,JP
 *   姿形と名前を変更したアイテムだ。
 *   %endTxt
 *   ```
 *
 * 【源码】
 *   30655-30870  物品名：`var_99(8) != 0 & var_99(28) != 0 & id != 342 & id != 729`
 *                → `noteload user\item\planN.txt`，取 `%txtName,JP` 段的**最后一行**，直接当名字
 *                （不再走品质包装，所以不会加 ★☆）
 *   299740-299762 物品详细窗口最下面那行：同样的取法，标签 `%txtFlavor`
 *   300090-300160 鉴定报告：标签 `%txtDescript0..3`，取段内最后一行后 `trimdesc(...,2)`
 *
 * 【截取规则】源码是
 *   `var_738 = instr(text, 0, "%txtName,JP")`
 *   `text = strmid(text, var_738, instr(text, 1, var_738, "%"))`   —— 截到下一个 `%`
 *   `if (noteinfo(0) > 1) noteget 最后一行`
 * 网页版等价实现：从标签行开始，取到下一个 `%` 开头的行之前，返回其中**最后一个非空行**。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const PLAN_MAX = 33;
  /** 原版排除的两个 id：342（?）/ 729（?），30655 的 `var_99(3) != 342 & != 729` */
  const EXCLUDE_IDS = new Set([342, 729]);

  const cache = new Map();       // n → { name:{jp,en}, descript:[{jp,en}×4], flavor:{jp,en} } | null
  const pending = new Map();     // n → Promise

  /** 取一段（`%tag,JP` → 下一个 `%`）的最后一行非空文本 */
  function segment(text, tag, lang) {
    const body = String(text || '').replace(/\r\n?/g, '\n');
    const head = '%' + tag + ',' + lang;
    const i = body.indexOf(head);
    if (i < 0) return '';
    // 跳过标签行本身
    let j = body.indexOf('\n', i);
    if (j < 0) return '';
    j += 1;
    const out = [];
    let p = j;
    while (p <= body.length) {
      const nl = body.indexOf('\n', p);
      const line = nl < 0 ? body.slice(p) : body.slice(p, nl);
      const s = line.replace(/\t/g, '').trim();
      if (s.startsWith('%')) break;          // 193118 / 300100 的「截到下一个 %」
      if (s) out.push(s);
      if (nl < 0) break;
      p = nl + 1;
    }
    return out.length ? out[out.length - 1] : '';   // noteget noteinfo(0)-1
  }

  /** 解析一份 plan txt */
  function parse(text) {
    const out = { name: {}, descript: [], flavor: {} };
    for (const lg of ['JP', 'EN']) {
      const L = lg.toLowerCase();
      const n = segment(text, 'txtName', lg);
      if (n) out.name[L] = n;
      const f = segment(text, 'txtFlavor', lg);
      if (f) out.flavor[L] = f;
      for (let k = 0; k < 4; k++) {
        out.descript[k] = out.descript[k] || {};
        const d = segment(text, 'txtDescript' + k, lg);
        if (d) out.descript[k][L] = d;
      }
    }
    const has = Object.keys(out.name).length || Object.keys(out.flavor).length
      || out.descript.some((d) => Object.keys(d).length);
    return has ? out : null;
  }

  const ItemPlan = {
    PLAN_MAX, EXCLUDE_IDS,

    /** plan 编号（`it.f[28]`），0 表示没有 */
    planOf(it) {
      if (!it || !it.f) return 0;
      const n = it.f[28] | 0;
      return (n > 0 && n <= PLAN_MAX) ? n : 0;
    },

    /** 是否该用自定义名字（30655 的三个条件） */
    appliesTo(it) {
      if (!it) return false;
      if ((it.f[8] | 0) === 0) return false;          // 未鉴定 → 走别名
      const n = this.planOf(it);
      if (!n) return false;
      return !EXCLUDE_IDS.has(it.id | 0);
    },

    /** 异步加载 plan N 的文本（UserDir → 内置包） */
    async load(n) {
      const k = n | 0;
      if (k <= 0 || k > PLAN_MAX) return null;
      if (cache.has(k)) return cache.get(k);
      if (pending.has(k)) return pending.get(k);
      const p = (async () => {
        let txt = null;
        if (Elona.UserDir && Elona.UserDir.readText) {
          try { txt = await Elona.UserDir.readText('item/plan' + k + '.txt'); } catch (e) { txt = null; }
        }
        const rec = txt ? parse(txt) : null;
        cache.set(k, rec);
        pending.delete(k);
        return rec;
      })();
      pending.set(k, p);
      return p;
    },

    /** 同步取（已加载的） */
    cached(n) { return cache.get(n | 0) || null; },

    /** 清缓存（用户改了 txt 之后调用） */
    invalidate() { cache.clear(); pending.clear(); },

    /** 启动时把 33 份都读进来（内置包很便宜，授权目录也就 33 次读） */
    async preloadAll() {
      let count = 0;
      for (let n = 1; n <= PLAN_MAX; n++) {
        const r = await this.load(n);
        if (r) count++;
      }
      return count;
    },

    /** 按语言取字段，缺 ch 就退 jp（内置包只有 jp/en） */
    pick(map, lang) {
      if (!map) return '';
      const L = String(lang || 'ch');
      if (L === 'en') return map.en || map.jp || '';
      if (L === 'jp') return map.jp || map.en || '';
      return map.jp || map.en || '';
    },

    /**
     * 物品名（30655-30870）。返回 null 表示「不该覆盖」，调用方走正常名。
     * 注意：源码这里是**整名替换**，不拼品质 ★☆、也不拼材质前缀。
     */
    nameOf(it, lang) {
      if (!this.appliesTo(it)) return null;
      const rec = this.cached(this.planOf(it));
      if (!rec) return null;                       // 还没加载完 → 先给正常名
      const nm = this.pick(rec.name, lang);
      return nm || null;
    },

    /** flavor 文本（299747） */
    flavorOf(it, lang) {
      const n = this.planOf(it);
      if (!n) return null;
      const rec = this.cached(n);
      if (!rec) return null;
      return this.pick(rec.flavor, lang) || null;
    },

    /** 鉴定描述的 4 行（300100；空串表示该行没有） */
    descriptOf(it, lang) {
      const n = this.planOf(it);
      if (!n) return null;
      const rec = this.cached(n);
      if (!rec) return null;
      const out = [];
      for (let k = 0; k < 4; k++) out.push(this.pick(rec.descript[k], lang) || '');
      return out.some((s) => s) ? out : null;
    },

    /** 解析器（测试 / 工具用） */
    parse, segment,
  };

  Elona.ItemPlan = ItemPlan;
})(window);
