'use strict';
/**
 * 文本换行规整 —— `*label_0536`（37314-37431）。
 *
 * 【源码依据 hsp/start.hsp】
 *   37314-37328  #defcfunc id_crlf(s)：判断换行风格
 *                  含 LF → 0（Unix）/ 只含 CR → 1（旧 Mac）/ 都不含 → 100
 *                  （源码第三段再判 LF 得 2，但 LF 已在第一步返回，是死分支）
 *   37329-37413  #defunc conv_crlf(s, mode)：把 s 的换行统一成 mode
 *                  mode 0 = LF / 1 = CR / 2 = LF（与日文原版一致）
 *                  没有换行时直接返回（不擅自追加）
 *   37414-37431  #defunc rm_crlf(s)：删掉 CR 与 LF 字符
 *
 * 【用途】原版读写 `data/board.txt`、日志与存档文本时统一换行；
 *   本项目的数据是 JSON，运行时只在解析外部文本时用得到
 *   （`core/talk.js` 的定制台词解析即是）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 37314：0 = LF / 1 = CR / 100 = 无换行（2 在源码里不可达，保留常量） */
  function idCrlf(s) {
    const t = String(s == null ? '' : s);
    if (t.indexOf('\n') >= 0) return 0;
    if (t.indexOf('\r') >= 0) return 1;
    return 100;
  }

  /** 37329：把换行统一成 mode 的风格；没有换行或 mode 非法时原样返回 */
  function convCrlf(s, mode) {
    const t = String(s == null ? '' : s);
    if (!t.length) return t;
    const m = mode | 0;
    if (m > 2 || m < 0) return t;
    const d = idCrlf(t);
    if (d === 100) return t;                       // 37337-37339
    if (d === m) return t;                         // 37340-37356
    const oldSep = (d === 0) ? '\n' : '\r';        // var_917
    const newSep = (m === 0) ? '\n' : (m === 1 ? '\r' : '\n');   // var_918
    return t.split(oldSep).join(newSep);
  }

  /** 37414：删掉所有 CR / LF（源码对 13 / 10 两种字符各扫一遍） */
  function rmCrlf(s) {
    return String(s == null ? '' : s).replace(/[\r\n]/g, '');
  }

  const TextUtil = {
    idCrlf, convCrlf, rmCrlf,
    /**
     * 实用入口：把 CRLF / CR 一律并成 LF。
     * 注意 `convCrlf(s, 0)` 对 CRLF 文本会原样返回 —— 因为 `id_crlf` 先命中 LF
     * 就判成 0（源码 37316），所以原版处理 CRLF 要先 `rm_crlf` 再规整。
     * 这里把两步合起来，供运行时解析文本用。
     */
    toLf(s) {
      return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    },
    /** 统一成 CRLF（原版 Windows 文本用；mode 1/2 只是单个 CR / LF，故在此另做） */
    toCrlf(s) { return convCrlf(s, 1).split('\r').join('\r\n'); },
    /** 按行切分（顺带把 CRLF 规整成 LF） */
    lines(s) { return TextUtil.toLf(s).split('\n'); },
  };

  Elona.TextUtil = TextUtil;
})(typeof window !== 'undefined' ? window : globalThis);
