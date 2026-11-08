'use strict';
/**
 * 随机数模块 —— 等价实现 HSP 的 rnd() / randomize
 *
 * 【已确认】原版使用 HSP 内置 rnd(n)，语义为返回 [0, n-1] 区间的整数。
 *   - n <= 0 时 HSP 返回 0
 *   - 启动时: randomize -> rnd(2000) 作为种子 -> randomize 种子 (start.hsp 行 167-173)
 * 【未确认】HSP rnd 的底层 PRNG 算法。用户已确认「随机不必完全一致，只要概率分布一致」，
 *   因此此处使用等分布的 PRNG（xorshift128），并保留 randomize/seed 接口以便后续替换。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  class RNG {
    constructor(seed) {
      this.s0 = 0; this.s1 = 0;
      this.randomize(seed === undefined ? Date.now() : seed);
    }
    /** 对应 HSP 的 randomize */
    randomize(seed) {
      let s = (seed | 0) >>> 0;
      if (s === 0) s = 0x9e3779b9;
      // 用种子扩散出两个状态字
      this.s0 = s >>> 0;
      this.s1 = (s ^ 0x6d2b79f5) >>> 0;
      // 预热
      for (let i = 0; i < 8; i++) this.next();
    }
    /** 32 位 xorshift128 */
    next() {
      let x = this.s0, y = this.s1;
      this.s0 = y;
      x ^= (x << 23) >>> 0;
      this.s1 = (x ^ y ^ (x >>> 17) ^ (y >>> 26)) >>> 0;
      return (this.s1 + y) >>> 0;
    }
    /** 对应 HSP 的 rnd(n): 返回 0..n-1 */
    rnd(n) {
      n = n | 0;
      if (n <= 0) return 0;
      return this.next() % n;
    }
    /** 闭区间随机整数 [a, b]（原版多处使用 a + rnd(b-a+1)） */
    range(a, b) { return a + this.rnd(b - a + 1); }
    /** 0..1 浮点 */
    float() { return this.next() / 4294967296; }
    /** 存档用 */
    serialize() { return { s0: this.s0, s1: this.s1 }; }
    deserialize(o) { if (o) { this.s0 = o.s0 >>> 0; this.s1 = o.s1 >>> 0; } }
  }

  Elona.RNG = RNG;
  Elona.rng = new RNG();      // 全局随机数（与原版全局 rnd 对应）
})(window);
