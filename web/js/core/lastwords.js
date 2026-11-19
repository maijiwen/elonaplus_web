'use strict';
/**
 * 遗言（core/lastwords.js）—— `user/lastwords.txt` / `user/lastwords-e.txt`
 *
 * 【源码】9707-9712 `txtsetlastword`：
 *   ```
 *   notesel var_122
 *   noteload user\lastwords.txt            （英文模式读 lastwords-e.txt）
 *   noteget var_398, rnd(noteinfo(0) + 1)   ← 注意 +1：有 1/N 的概率取到空行
 *   ```
 *   调用点 606550-606562：玩家死亡时先问「遺言は？」，
 *   输入为空才走 `txtsetlastword`，非空就用 `「输入内容」`；
 *   随后 606570 把「名字 遗言」写进 `save\bone.txt`（每 4 行一条、按分数排名、上限 80 条）。
 *
 * 【文件格式】一行一句，可带「」。原版文件是 CP932 + **CR 换行**（老 Mac 风格），
 *   所以分行要同时认 \r\n / \r / \n。
 *
 * 【差异】网页版没有「埋葬画面」，遗言在玩家倒下时写进消息栏，
 *   并对 `save` 目录写一条 bone.txt 记录（存档层已授权磁盘时才落盘）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let cache = null;          // 当前语言的句子数组
  let cacheLang = '';
  let loading = null;

  /** 任意换行风格 → 行数组 */
  function splitLines(text) {
    return String(text == null ? '' : text).split(/\r\n|\r|\n/);
  }

  function fileName(lang) {
    return (String(lang || '').toLowerCase() === 'en') ? 'lastwords-e.txt' : 'lastwords.txt';
  }

  const LastWords = {
    /**
     * 读文件（UserDir → 内置包）。`lang` 缺省用游戏当前语言。
     * @returns {Promise<string[]>}
     */
    async load(lang) {
      const lg = String(lang || (Elona.Lang && Elona.Lang.current ? Elona.Lang.current() : 'ch'));
      if (cache && cacheLang === lg) return cache;
      if (loading) return loading;
      loading = (async () => {
        let txt = null;
        if (Elona.UserDir && Elona.UserDir.readText) {
          try { txt = await Elona.UserDir.readText(fileName(lg)); } catch (e) { txt = null; }
        }
        const lines = txt ? splitLines(txt).map((s) => s.trim()).filter(Boolean) : [];
        cache = lines;
        cacheLang = lg;
        loading = null;
        return lines;
      })();
      return loading;
    },

    /** 启动时预载（死亡是同步流程，不能在那里 await） */
    async preload() {
      await this.load();
      return cache ? cache.length : 0;
    },

    /** 已缓存的句子（同步） */
    lines() { return (cache || []).slice(); },

    /**
     * 随机一句 —— 完全照 `rnd(noteinfo(0) + 1)`：有 1/(N+1) 的概率落在末尾空行，
     * 原版这时 `var_398` 是空串，遗言位置什么都不显示。这里保持同样的语义。
     * @param {object} [g] 需要 rng 时传
     * @returns {string}
     */
    pick(g) {
      const arr = cache || [];
      if (!arr.length) return '';
      const rnd = (g && g.rng && g.rng.rnd) ? g.rng.rnd.bind(g.rng) : (n) => Math.floor(Math.random() * n);
      const i = rnd(arr.length + 1);
      return arr[i] || '';
    },

    /**
     * 玩家死亡时的遗言 —— 对应 606547-606562。
     * @param {string} [typed] 玩家在「遺言は？」里输入的内容（空 = 随机）
     * @returns {string} 已带「」的遗言；空串表示这次没有
     */
    dying(typed, g) {
      const s = String(typed == null ? '' : typed).trim();
      if (s) return `「${s}」`;
      const pick = this.pick(g);
      return pick || '';
    },

    /** 清缓存（用户改了文件之后） */
    invalidate() { cache = null; cacheLang = ''; loading = null; },

    /** 工具 */
    splitLines,
  };

  Elona.LastWords = LastWords;
})(window);
