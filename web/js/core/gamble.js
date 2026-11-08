'use strict';
/**
 * 赌场 21 点（core/gamble.js）—— カジノ《フォーチュンクッキー》的ブラックジャック
 *
 * 【源码依据】
 *   25510-25813  var_605 牌表初始化（标准 52 张）、cpscore / cpcardnum / lastcard / pileremain
 *   271573-271620 赌场入口、首次赠送 10 枚チップ（271582-271589）
 *   271610-271660 规则说明与下注（1 / 5 / 10 / 20 枚）
 *   271688-271705 发牌（各 2 张，庄家第 2 张盖着）与庄家补牌
 *   271706-271728 胜负判定（平 / 输 / 赢）
 *   271730-271780 警戒 Lv / 景品 Lv / 玩家选项（停 / 要 / 作弊 / 认输）
 *   271786-271805 要牌时的「坏牌预感」（cpscore >= 22 时按器用重抽）
 *   271807-271860 作弊：换牌 + 警戒判定 + karma -5
 *   271856-271960 景品（按 Rewards-Lv 分档给实物）
 *
 * 【牌表】25529：`var_605(0, cnt) = cnt\13 + 1, cnt/13` —— 即
 *   点数 = cnt % 13 + 1（1=A, 11=J, 12=Q, 13=K），花色 = cnt / 13（0..3）
 *
 * 【筹码】`var_497(1)` = 素材 1「カジノチップ」，走 Material 系统
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const CHIP_MAT = 1;          // カジノチップ
  const BETS = [1, 5, 10, 20]; // 271629-271648
  const HAND_MAX = 5;          // 271696：cpcardnum(0) >= 5 不再补

  // 景品表（271869-271960）
  const SPECIAL_PRIZES = [
    { lv: 5, items: [729] },
    { lv: 9, items: [559] },
    { lv: 11, items: [640] },
    { lv: 13, items: [878] },
    { lv: 15, items: [431] },
    { lv: 17, items: [1078] },
    { lv: 19, items: [1215] },
    { lv: 23, items: [287] },
    { lv: 25, items: [1254, 1253] },
    { lv: 27, items: [1259, 1258, 1257, 1256] },   // 首次到 27（var_65(250+6)==1）
    { lv: 27, items: [880] },                       // 之后
    { lv: 29, items: [1252] },
  ];

  function idiv(a, b) { return Math.trunc((a | 0) / (b | 0)); }

  const Gamble = {
    CHIP_MAT, BETS, HAND_MAX, SPECIAL_PRIZES,

    // ---------------- 筹码 ----------------
    chips(g) {
      if (!Elona.Material) return 0;
      return Elona.Material.get(g, CHIP_MAT) | 0;
    },

    addChips(g, n) {
      if (!Elona.Material) return 0;
      const next = Math.max(0, this.chips(g) + (n | 0));
      Elona.Material.set(g, CHIP_MAT, next);
      return next;
    },

    /** 271582-271589：首次进店送 10 枚 */
    welcome(g) {
      if ((g.getV65(606) | 0) === 0) {     // var_65(250+6)
        g.setV65(606, 1);
        this.addChips(g, 10);
        return { ok: true, granted: 10, chips: this.chips(g) };
      }
      return { ok: false, chips: this.chips(g) };
    },

    // ---------------- 牌 ----------------
    /** 25529：0..51 → 点数 1..13 */
    cardValue(card) { return ((card | 0) % 13) + 1; },
    cardSuit(card) { return idiv(card | 0, 13); },

    /** 牌面显示（A/2..10/J/Q/K + 花色） */
    cardName(card) {
      const v = this.cardValue(card);
      const rank = v === 1 ? 'A' : v === 11 ? 'J' : v === 12 ? 'Q' : v === 13 ? 'K' : String(v);
      const suits = ['♠', '♥', '♦', '♣'];
      return suits[this.cardSuit(card)] + rank;
    },

    /** 洗牌（Fisher-Yates，用游戏的 rng 保证可复现） */
    newDeck(rng) {
      const deck = [];
      for (let i = 0; i < 52; i++) deck.push(i);
      for (let i = 51; i > 0; i--) {
        const j = rng.rnd(i + 1);
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
      return deck;
    },

    /** cpscore（25756-25779）：A 记 11，爆点后每个 A 减 10 */
    score(hand) {
      let sum = 0, aces = 0;
      for (const c of hand) {
        let v = this.cardValue(c);
        if (v >= 10) v = 10;
        if (v === 1) { aces++; v = 11; }
        sum += v;
      }
      for (let i = 0; i < aces; i++) if (sum > 21) sum -= 10;
      return sum;
    },

    // ---------------- 开局 ----------------
    /**
     * 下注开局（271656-271705）。
     * @param {object} g
     * @param {number} bet 1 / 5 / 10 / 20 枚
     */
    start(g, bet) {
      const b = bet | 0;
      if (BETS.indexOf(b) < 0) return { ok: false, reason: 'bad-bet' };
      const have = this.chips(g);
      if (have < b) return { ok: false, reason: 'no-chip', chips: have };

      this.addChips(g, -b);              // 271665
      const st = {
        bet: b, player: [], dealer: [], deck: this.newDeck(g.rng),
        hidden: true, over: false, result: null, cheatCount: 0,
        alertLv: g.rng.rnd(39) + 1,      // 271730：rnd(39)+1+作弊次数²*5
        winStreak: 0,
      };
      // 271688-271694：各发 2 张（第 3 张 = 庄家第 2 张，先不亮）
      for (let i = 0; i < 4; i++) {
        const c = st.deck.pop();
        if (i % 2 === 0) st.player.push(c);
        else st.dealer.push(c);
      }
      g.casino = st;
      return {
        ok: true, bet: b, chips: this.chips(g),
        player: st.player.map((c) => this.cardName(c)),
        dealer: [this.cardName(st.dealer[0]), '??'],
        playerScore: this.score(st.player),
        canHit: st.player.length < HAND_MAX,
      };
    },

    /** 当前状态快照 */
    view(g) {
      const st = g.casino;
      if (!st) return null;
      return {
        bet: st.bet, chips: this.chips(g),
        player: st.player.map((c) => this.cardName(c)),
        dealer: st.dealer.map((c, i) => (st.hidden && i === 1) ? '??' : this.cardName(c)),
        playerScore: this.score(st.player),
        dealerScore: st.hidden ? this.score([st.dealer[0]]) : this.score(st.dealer),
        hidden: st.hidden, over: st.over, result: st.result,
      };
    },

    /**
     * 要牌（271786-271805）。
     * 原版在 cpscore >= 22 时会按器用判定「弃掉重抽」，这里保留。
     */
    hit(g) {
      const st = g.casino;
      if (!st || st.over) return { ok: false, reason: 'not-playing' };
      if (st.player.length >= HAND_MAX) return { ok: false, reason: 'hand-full' };
      if (!st.deck.length) return { ok: false, reason: 'deck-empty' };

      let card = st.deck.pop();
      // 271790-271804：坏牌预感（最多重抽 3 次）
      const dex = (g.player.skill(12) | 0) || 1;
      for (let i = 0; i < 3; i++) {
        const test = this.score(st.player.concat([card]));
        if (test < 22) break;
        if (st.deck.length <= 10) break;
        if (g.rng.rnd(dex) > 40) {
          card = st.deck.pop();
        }
      }
      st.player.push(card);
      const sc = this.score(st.player);
      if (sc > 21) {
        st.over = true;
        st.hidden = false;
        st.result = 0;                     // 爆点即负
        return { ok: true, card: this.cardName(card), score: sc, bust: true, result: 0, view: this.view(g) };
      }
      return { ok: true, card: this.cardName(card), score: sc, view: this.view(g) };
    },

    /** 停牌 → 庄家补牌 → 判定（271695-271728） */
    stay(g) {
      const st = g.casino;
      if (!st || st.over) return { ok: false, reason: 'not-playing' };
      st.hidden = false;
      const ps = this.score(st.player);

      // 271695-271705：庄家补牌
      let guard = 0;
      while (guard++ < 10) {
        if (st.dealer.length >= HAND_MAX) break;
        const ds = this.score(st.dealer);
        if (!(ds < ps || ds - g.rng.rnd(5) <= 11)) break;
        if (!st.deck.length) break;
        st.dealer.push(st.deck.pop());
      }

      const ds = this.score(st.dealer);
      let r = -1;
      if (ds <= 21 && (ps > 21 || ds > ps)) r = 0;      // 271710-271714
      if (ps <= 21 && (ds > 21 || ps > ds)) r = 1;      // 271715-271719
      st.result = r;
      st.over = true;
      if (r === 1) st.winStreak++;
      else if (r === 0) st.winStreak = 0;
      return { ok: true, result: r, playerScore: ps, dealerScore: ds, view: this.view(g) };
    },

    /** 认输（271771-271775）：赌注 -1 枚（原版直接结束本轮） */
    out(g) {
      const st = g.casino;
      if (!st || st.over) return { ok: false, reason: 'not-playing' };
      if (st.bet < 2) return { ok: false, reason: 'bet-too-low' };
      this.addChips(g, 1);               // 退回 1 枚（净损失 bet-1）
      st.bet -= 1;
      st.over = true;
      st.result = 0;
      st.hidden = false;
      return { ok: true, refund: 1, chips: this.chips(g), view: this.view(g) };
    },

    /**
     * 作弊（271807-271860）：换掉最后一张牌。
     * 警戒 Lv = rnd(39) + 1 + 作弊次数² × 5；被抓 → karma -5、连胜清零。
     */
    cheat(g) {
      const st = g.casino;
      if (!st || st.over) return { ok: false, reason: 'not-playing' };
      if (!st.deck.length) return { ok: false, reason: 'deck-empty' };
      const p = g.player;
      const dex = (p.skill(12) | 0) || 1;

      // 弃掉玩家最后一张，重抽
      st.player.pop();
      st.player.push(st.deck.pop());
      st.cheatCount++;
      const alertLv = g.rng.rnd(39) + 1 + st.cheatCount * st.cheatCount * 5;
      st.alertLv = alertLv;

      const caught = g.rng.rnd(dex) < g.rng.rnd(alertLv);
      if (caught) {
        st.over = true;
        st.hidden = false;
        st.result = 0;
        st.winStreak = 0;
        if (typeof g.modkarma === 'function') g.modkarma(-5);
        else p.set(49, (p.get(49) | 0) - 5);
        return { ok: true, caught: true, karma: p.get(49) | 0, view: this.view(g) };
      }
      return {
        ok: true, caught: false, alertLv,
        playerScore: this.score(st.player), view: this.view(g),
      };
    },

    /** 景品等级（271731）：赌注 + 连胜 × 2 */
    rewardsLevel(g) {
      const st = g.casino;
      if (!st) return 1;
      return Math.max(1, (st.bet | 0) + (st.winStreak | 0) * 2);
    },

    /**
     * 发放景品（271856-271960）。
     * @returns {Array} 生成的物品
     */
    prize(g, opts) {
      const o = opts || {};
      const st = g.casino;
      const lv = o.level !== undefined ? (o.level | 0) : this.rewardsLevel(g);
      const items = [];
      const push = (it) => { if (it) { it.f[5] = g.player.x; it.f[6] = g.player.y; if (g.groundItems) g.groundItems.push(it); items.push(it); } };

      // 271860-271866：按 lv 生成随机物品（calcobjlv(rnd(lv+1)+lv)）
      try {
        const it = Elona.ItemDB.create(g, { level: g.rng.rnd(lv + 1) + lv, fix: lv >= 28 ? 5 : 0 });
        push(it);
      } catch (e) { /* 生成失败不阻断 */ }

      // 271869-271960：特定等级追加（var_65(250+347) == 100 才给）
      if ((g.getV65(697) | 0) === 100) {
        const first27 = (g.getV65(606) | 0) === 1;
        for (const row of SPECIAL_PRIZES) {
          if (lv < row.lv) continue;
          if (row.lv === 27 && !first27) continue;      // 27 档的两组互斥
          for (const id of row.items) {
            try { const it = Elona.ItemDB.createItem(id, 1); push(it); } catch (e) { /* skip */ }
          }
        }
        if (lv >= 27 && first27) g.setV65(606, 2);
      }
      return items;
    },

    /** 控制台/面板用的简要说明 */
    ruleText() {
      return 'ブラックジャック：手牌合计尽量接近 21（超过即负）。J/Q/K 记 10，A 记 1 或 11。';
    },
  };

  Elona.Gamble = Gamble;
  if (typeof module !== 'undefined' && module.exports) module.exports = Gamble;
})(typeof window !== 'undefined' ? window : global);
