'use strict';
/**
 * 天气 + 以太病 —— 原版 var_65(17) 天气 / var_65(18) 变化倒计时 / var_65(85) 以太病累积
 *
 * 【已确认】天气取值（603162-603385 的赋值与文本一一对应）：
 *   0 = 晴　1 = 以太风　2 = 雪　3 = 雨　4 = 暴雨
 *
 * 【已确认】每小时推进（*label_4352 → 603256-603443）：
 *   var_65(18)--；<=0 时 var_65(18) = rnd(22)+2 并重roll 天气；
 *   重roll 时 var_400 = 旧天气，按旧天气分支决定新天气（每个分支用 break 保证只命中一个）。
 *
 * 【已确认】以太风判定（603262-603278）：
 *   月份 `var_65(11) \ 3 == 0`（3/6/9/12 月）且 日 `var_65(12)` 在 1..10、
 *   `rnd(15 + var_65(823)) < var_65(12) + 5`、且本月尚未刮过（var_65(806) != 月）。
 *   持续时长 `var_65(18) = rnd(12) + limit(12 - var_65(823)*2, 1, 12)`。
 *
 * 【已确认】以太病累积（604172-604199）：
 *   天气=以太风 且 室外（var_126(14)==2）时，rnd(2)==0 → modcorrupt(5 + limit(var_65(4)/20000,0,15))；
 *   在避难所（var_65(29)!=0）则只有 rnd(10)==0 才 +5。非以太风天气下 rnd(1500)==0 → +10。
 *
 * 【已确认】modcorrupt（195479-195600）：
 *   var_1083 = 旧值/1000（已发病次数）；累积量受 feat 168（以太耐性）+ var_65(800) 影响；
 *   跨过新的 1000 整数倍 → "以太病发作"；每次发作抽一个病征 feat（200..228，最多 20 个），
 *   记录在 var_65(700+n)。
 *
 * 【推断/近似，已在 docs/02-diff-report.md 登记】
 *   - var_65(5)/(6) 的语义未确认（603163/603293 用来判断"会不会下雪"），
 *     本实现改为「地图是否寒冷」判断。
 *   - var_65(29)（避难所）在原版由特定地图/道具设置，本实现近似为「在室内/城镇」。
 *   - 病征的 `var_97(id)--` 符号语义未确认，这里以 -1 标记「已获得该病征」。
 *   - 雨/雪/以太风的画面表现（原版有落雨/落雪图层）本实现只做整体色调，见 renderer。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // var_65 字段
  const V_WEATHER = 17;      // 天气
  const V_TIMER = 18;        // 距下次天气变化的小时数
  const V_ETHER = 85;        // 以太病累积（千分制）
  const V_LASTETHER = 806;   // 上次以太风所在月份
  const V_ETHERFREQ = 823;   // 以太风频率修正（本项目未移植，恒 0）
  const V_SHELTER = 29;      // 避难所标记
  const V_ETHERBONUS = 800;  // 以太病累积加成
  const V_FEAT168 = 168;     // var_97(168) = 以太耐性（feat）

  const W = {
    CLEAR: 0, ETHER: 1, SNOW: 2, RAIN: 3, STORM: 4,
  };

  const NAMES = {
    0: '晴朗', 1: '以太风', 2: '下雪', 3: '下雨', 4: '暴雨',
  };
  const COLORS = {
    0: '#000', 1: 'rgb(120,0,140)', 2: 'rgb(0,80,140)', 3: 'rgb(0,60,130)', 4: 'rgb(0,30,90)',
  };

  /** 病征 id 范围：200..228（源码 `rnd(229 - 200) + 200`） */
  const MUT_MIN = 200, MUT_MAX = 228;
  const MAX_SYMPTOM = 20;    // 195516：最多 20 个

  const Weather = {
    W, NAMES, V_WEATHER, V_TIMER, V_ETHER,

    name(id) { return NAMES[id | 0] || '晴朗'; },
    color(id) { return COLORS[id | 0] || '#000'; },
    current(g) { return g ? (g.getV65(V_WEATHER) | 0) : 0; },

    /** 世界地图（var_126(6)==1）上没有天气表现 */
    onWorldMap(g) {
      return !!(g && g.map && g.map.header && (g.map.header[6] | 0) === 1);
    },

    /**
     * 室外判定 —— 原版 `var_126(14) == 2`（地图头第 14 项）。
     * 【推断】本项目的地图 json 已带 header，若缺该字段则按"非地下城即室外"近似。
     */
    isOutside(g) {
      if (!g || !g.map) return false;
      const h = g.map.header || [];
      if (h[14] !== undefined && h[14] !== 0) return (h[14] | 0) === 2;
      return !(g.dungeonDepth > 0);
    },

    /** 【推断】寒冷地图：原版用 var_65(5)/(6) 判断（语义未确认），这里用地名近似 */
    isColdMap(g) {
      const n = (g && g.map && g.map.name) ? String(g.map.name).toLowerCase() : '';
      return /snow|ice|frozen|north/.test(n);
    },

    /** 避难所（var_65(29)）：本实现近似为「在室内」 */
    inShelter(g) {
      if (g.getV65(V_SHELTER) !== 0) return true;
      return !this.isOutside(g) && !this.onWorldMap(g);
    },

    /** 新游戏 / 旧存档补字段 */
    init(g) {
      if (!g) return;
      if (g.getV65(V_TIMER) <= 0) g.setV65(V_TIMER, g.rng.rnd(22) + 2);
      if (g.getV65(V_WEATHER) < 0 || g.getV65(V_WEATHER) > 4) g.setV65(V_WEATHER, W.CLEAR);
    },

    /**
     * 每小时推进 —— 603256-603443。
     * @returns {{changed:boolean, from:number, to:number, message?:string}}
     */
    tickHour(g) {
      if (!g) return { changed: false, from: 0, to: 0 };
      // 原版：小时推进时若在地图上才走天气（603205 `if (var_126(6) == 1)` 是另一支）
      let timer = (g.getV65(V_TIMER) | 0) - 1;
      g.setV65(V_TIMER, timer);
      if (timer >= 0) return { changed: false, from: this.current(g), to: this.current(g) };

      g.setV65(V_TIMER, g.rng.rnd(22) + 2);          // 603259
      const from = this.current(g);
      const r = this.roll(g, from);
      if (r.to !== from) {
        g.setV65(V_WEATHER, r.to);
        if (r.message) g.log(r.message);
        return { changed: true, from, to: r.to, message: r.message };
      }
      return { changed: false, from, to: from };
    },

    /**
     * 天气重 roll —— 603258-603385。
     * 顺序严格照源码：先以太风，再按旧天气分支；每个分支命中即 return（源码用 break）。
     */
    roll(g, prev) {
      const rnd = (n) => g.rng.rnd(n);
      const month = g.getV65(11) | 0;
      const day = g.getV65(12) | 0;
      const freq = g.getV65(V_ETHERFREQ) | 0;

      // ---- 以太风（603262-603278）----
      if (month % 3 === 0 && day >= 1 && day <= 10) {
        if (rnd(15 + freq) < day + 5) {
          if ((g.getV65(V_LASTETHER) | 0) !== month) {
            g.setV65(V_LASTETHER, month);
            g.setV65(V_TIMER, rnd(12) + limit(12 - freq * 2, 1, 12));
            return { to: W.ETHER, message: '以太风开始刮起，得赶快找地方躲避。' };
          }
        }
      }

      // ---- 晴天转雨/雪（603280-603332）----
      if (prev === W.CLEAR) {
        // feat 209（祈雨/吸引雨云）
        const p = g.player;
        if (p && Elona.Feat && Elona.Feat.get(p, 209) && rnd(4) === 0) {
          return { to: W.RAIN, message: '你引来了雨云。' };
        }
        if (this.isColdMap(g) && rnd(2) === 0) return { to: W.SNOW, message: '开始下雪了。' };
        if (rnd(10) === 0) return { to: W.RAIN, message: '开始下雨了。' };
        if (rnd(40) === 0) return { to: W.STORM, message: '突然下起了倾盆大雨。' };
        if (rnd(60) === 0) return { to: W.SNOW, message: '开始下雪了。' };
        return { to: prev };
      }
      // ---- 雨 → 晴 / 暴雨（603334-603352）----
      if (prev === W.RAIN) {
        if (rnd(4) === 0) return { to: W.CLEAR, message: '雨停了。' };
        if (rnd(15) === 0) return { to: W.STORM, message: '雨下得更大了。' };
        return { to: prev };
      }
      // ---- 暴雨 → 雨（603354-603363）----
      if (prev === W.STORM) {
        if (rnd(3) === 0) return { to: W.RAIN, message: '雨势变小了。' };
        return { to: prev };
      }
      // ---- 以太风 → 晴（603365-603374）：rnd(4)!=0 才停 ----
      if (prev === W.ETHER) {
        if (rnd(4) !== 0) return { to: W.CLEAR, message: '以太风停了。' };
        return { to: prev };
      }
      // ---- 雪 → 晴（603376-603385）----
      if (prev === W.SNOW) {
        if (rnd(3) === 0) return { to: W.CLEAR, message: '雪停了。' };
        return { to: prev };
      }
      return { to: prev };
    },

    /**
     * 每回合（玩家行动后）的以太病累积 —— 604172-604199。
     * 只在非世界地图上执行（该段位于地图行动分支内）。
     */
    tickTurn(g) {
      if (!g || !g.player || this.onWorldMap(g)) return null;
      const rnd = (n) => g.rng.rnd(n);
      const weather = this.current(g);
      if (weather === W.ETHER) {
        if (!this.isOutside(g)) return null;              // var_126(14)==2
        if (g.player.get(140) !== 0) return null;         // 行acted 中不累积（源码在行动结算处）
        if (rnd(2) === 0) {
          if (!this.inShelter(g)) {
            // var_65(4)/20000 作为强度项；本项目未移植 var_65(4)，缺省 0
            const bonus = limit(idiv(g.getV65(4) | 0, 20000), 0, 15);
            return this.modCorrupt(g, 5 + bonus);
          }
          if (rnd(10) === 0) return this.modCorrupt(g, 5);
        }
        return null;
      }
      // 非以太风：极低概率自然累积（rnd(1500)==0 → +10），地图 7/30 免疫
      if (rnd(1500) === 0) {
        const mapId = g.getV65(20) | 0;
        if (mapId !== 7 && mapId !== 30) return this.modCorrupt(g, 10);
      }
      return null;
    },

    /**
     * 以太病累积与发病 —— modcorrupt（195479-195600）。
     * @param {object} g
     * @param {number} amount 千分制增量（1000 = 一次发病）
     */
    modCorrupt(g, amount) {
      const before = idiv(g.getV65(V_ETHER) | 0, 1000);
      let add = amount + (amount > 0 ? (g.getV65(V_ETHERBONUS) | 0) : 0);
      const p = g.player;
      // var_97(168)：以太耐性，正累积时 ×100/150（-1/3）
      if (p && Elona.Feat && Elona.Feat.get(p, V_FEAT168) && amount > 0) {
        add = idiv(add * 100, 150);
      }
      let cur = (g.getV65(V_ETHER) | 0) + add;
      if (cur < 0) cur = 0;
      g.setV65(V_ETHER, cur);
      const after = idiv(cur, 1000);
      const gained = after - before;
      const out = { before, after, gained, symptoms: [], amount: add };
      if (gained <= 0) return out;

      // ---- 发病（195498）----
      g.log('以太病的症状开始显现了。');

      // ---- 抽病征（195516-195600）：最多 20 个 ----
      let count = gained;
      if (before + gained >= MAX_SYMPTOM) count = Math.max(0, MAX_SYMPTOM - before);
      const feats = (Elona.Feat && Elona.Feat.table && Elona.Feat.table()) || null;
      for (let i = 0; i < count; i++) {
        let id = 0;
        for (let t = 0; t < 40; t++) {
          const cand = MUT_MIN + g.rng.rnd(MUT_MAX - MUT_MIN + 1);
          if (!feats || !feats.feats || !feats.feats[String(cand)]) continue;   // 200 缺数据
          if (Elona.Feat.get(p, cand)) continue;                                // 已有则跳过
          id = cand;
          break;
        }
        if (!id) break;
        // var_97(id)--：本实现以 -1 表示"已获得该病征"
        Elona.Feat.set(p, id, -1);
        g.setV65(700 + before + i, id);
        out.symptoms.push(id);
        const nm = Elona.Feat.name ? Elona.Feat.name(id) : '';
        g.log(`你的以太病恶化了${nm ? '：' + nm : ''}。`);
        if (Elona.Status && Elona.Status.healsan) Elona.Status.healsan(p, 2);
      }
      // 应用病征效果（*label_0043 的 feat 效果）
      if (out.symptoms.length && Elona.Feat && Elona.Feat.apply) {
        try { Elona.Feat.apply(p, g); } catch (e) { /* 单条 feat 失败不影响整体 */ }
      }
      return out;
    },

    /** 以太病进度（0..1，按 Mod 1000 计算） */
    etherRatio(g) { return ((g.getV65(V_ETHER) | 0) % 1000) / 1000; },

    /** 已发病次数（= 已获得的病征上限） */
    etherLevel(g) { return idiv(g.getV65(V_ETHER) | 0, 1000); },

    /** 已记录的病征 id 列表（var_65(700+n)） */
    symptoms(g) {
      const out = [];
      for (let i = 0; i < MAX_SYMPTOM; i++) {
        const v = g.getV65(700 + i) | 0;
        if (v) out.push(v);
      }
      return out;
    },

    /**
     * 睡眠质量修正（312429-312438）—— 用于「床/睡觉」的时长倍率。
     * 本项目尚未实现睡觉（label_2937），此函数保留给后续接线。
     * @returns {number} 以 10 为分母的倍率（13 = ×1.3）
     */
    sleepMod(g) {
      const w = this.current(g);
      if (w === W.RAIN) return 13;     // 3 → ×13/10
      if (w === W.STORM) return 16;    // 4 → ×16/10
      if (w === W.SNOW) return 22;     // 2 → ×22/10
      if (w === W.ETHER) return 5;     // 1 → ×5/10
      return 10;
    },
  };

  Elona.Weather = Weather;
})(window);
