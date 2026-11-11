'use strict';
/**
 * 语言层（config.txt 的 `language`）—— 差异报告 B4。
 *
 * 【原版】`language` 0 = 日本語 / 1 = English，决定 `lang()` 里取哪一份字符串：
 *   源码里几乎每句台词都写成 `lang("日本語", "English")`，由这个开关选一边。
 *
 * 【本项目】文本表（items / skills / world_sites / talktxt …）已经把
 *   `jp` / `en` / `ch` 三份都提取出来了，所以「切换语言」可以实现成
 *   **读取同一份表的不同字段**：
 *     'ch'（默认，汉化） · 'jp'（日文原版） · 'en'（英文）
 *
 * 【边界】只覆盖**数据驱动的名称**（物品名 / 技能名 / 地点名）。
 *   代码里硬编码的中文短句（战斗播报、UI 标签）不随此开关变化——
 *   原版这些句子同样写死在脚本里，但没有三语对照，翻译工作另计。
 *   这一点在 docs/02-diff-report.md 的 B4 行里标为「部分还原」。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** config.txt 的 language 取值 → 本项目的语言键 */
  const LANGS = ['jp', 'en', 'ch'];
  const LABELS = { jp: '日本語', en: 'English', ch: '中文' };

  const Lang = {
    LANGS,
    LABELS,

    /** 当前语言键（'jp' | 'en' | 'ch'） */
    current() {
      const o = Elona.Options;
      const v = o && o.values ? (o.values.language | 0) : 2;
      return LANGS[v] || 'ch';
    },

    /** config 数值（0 日 / 1 英 / 2 中） */
    index() {
      const o = Elona.Options;
      return o && o.values ? (o.values.language | 0) : 2;
    },

    /** 三语取值：`pick(jp, en, ch)` —— 缺项时回退到中文 */
    pick(jp, en, ch) {
      const cur = this.current();
      if (cur === 'jp') return jp || ch || en || '';
      if (cur === 'en') return en || ch || jp || '';
      return ch || jp || en || '';
    },

    /** 从 {jp, en, ch} 记录里取当前语言（表里的字段名就是这三种） */
    of(rec) {
      if (!rec) return '';
      const cur = this.current();
      if (cur === 'jp') return rec.jp || rec.ch || rec.en || '';
      if (cur === 'en') return rec.en || rec.ch || rec.jp || '';
      return rec.ch || rec.jp || rec.en || '';
    },

    /** 循环切换（选项面板用） */
    cycle() {
      const o = Elona.Options;
      if (!o) return 'ch';
      const next = (this.index() + 1) % LANGS.length;
      o.values.language = next;
      o.save();
      return LANGS[next];
    },

    label() {
      return LABELS[this.current()] || '中文';
    },
  };

  Elona.Lang = Lang;
})(typeof window !== 'undefined' ? window : global);
