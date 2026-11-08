'use strict';
/**
 * 宠物／角色「进化」 —— ElonaPlus 2.33R
 *
 * 源码依据：start.hsp 226245-226275（吃尸体分支内的进化段）
 *
 *    if ( var_99(3, var_579) == 204 ) {            ; 物品 = 死体(corpse)
 *        if ( var_99(23, var_579) == 319 ) {       ; 死者种族 = 319『リトルシスター』
 *            if ( var_99(31, var_579) != 1 ) {     ; f[31]==1 标记「不可用于进化的尸体」
 *                "◯◯は進化した。"
 *                var_65(250 + 394)++               ; 全局进化计数 var_65(644)
 *                if 计数 \ 3 == 0 → skillmod 3, 角色, 1000     ; 耐久(Con) 经验 +1000
 *                if 计数 \ 6 == 0 → skillmod 2, 角色, 1000     ; 力量(Str) 经验 +1000
 *                repeat 400 - 100, 100             ; 技能 100..399
 *                    if var_83(0,cnt)==0 或 sorg(cnt)==0 → continue   ; 未习得的跳过
 *                    modgrowth 角色, cnt, rnd(10)+1                   ; 潜力 +1..10
 *            }
 *        }
 *    }
 *
 * 【语义补充】
 *   - 尸体的 f[23] 在 222925 由 `var_99(23, var_579) = var_58(27, var_581)` 写入，
 *     即「死者种别」。319 = 『リトルシスター』。
 *   - f[31]==1 由 «黄金像»(350935) 与 «バイオネットワーク»(358216) 产出的尸体设置，
 *     表示该尸体已用于其他用途、不触发进化。
 *   - 「进化」对玩家和宠物同样生效（var_243 是吃的人）。
 *   - 相关道具「進化の導石」(869, evolution heart) 是**同伴进化**用的道具，
 *     不在这里：见 `core/evolution.js`（effect 58，167 条规则）与 `core/dirsel.js`
 *     的 item 档（使用时的八方向箭头）。本文件只处理「吃リトルシスター的尸体」。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => Math.trunc(a / b);

  const EVOLVE_SPECIES = 319;      // リトルシスター
  const CORPSE_ID = 204;

  function isEvolveCorpse(item) {
    if (!item || (item.id | 0) !== CORPSE_ID) return false;
    if ((item.f[23] | 0) !== EVOLVE_SPECIES) return false;
    if ((item.f[31] | 0) === 1) return false;
    return true;
  }

  /**
   * 让 chara 进化一次。
   * @returns {{ok:boolean, count:number, con:boolean, str:boolean, growth:number, message:string}}
   */
  function evolve(g, chara) {
    if (!chara) return { ok: false, count: 0, message: 'それは無理だ。' };
    const V = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    const progress = V(644) + 1;
    if (g && g.setV65) g.setV65(644, progress);

    const con = (progress % 3) === 0;
    const str = (progress % 6) === 0;
    if (con && Elona.Stats && Elona.Stats.skillMod) Elona.Stats.skillMod(chara, 3, chara.index | 0, 1000, g);
    if (str && Elona.Stats && Elona.Stats.skillMod) Elona.Stats.skillMod(chara, 2, chara.index | 0, 1000, g);

    let grown = 0;
    const rnd = (n) => (g && g.rng ? g.rng.rnd(n) : Math.floor(Math.random() * n));
    for (let id = 100; id < 400; id++) {
      // var_83(0,id)==0 → 该 id 不是有效技能；sorg==0 → 角色未习得
      const lv = (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(chara, id) | 0)
        : (chara.skill ? chara.skill(id) : 0);
      if (lv === 0) continue;
      if (Elona.Stats && Elona.Stats.modGrowth) {
        Elona.Stats.modGrowth(chara, id, chara.index | 0, rnd(10) + 1, g);
      }
      grown++;
    }
    const name = chara.name || '相手';
    return {
      ok: true, count: progress, con, str, growth: grown,
      message: `${name}は進化した。（进化次数 ${progress}${con ? ' / 耐久+1' : ''}${str ? ' / 力量+1' : ''}${grown ? ` / 潜力提升 ${grown} 项` : ''}）`,
    };
  }

  Elona.Evolve = { isEvolveCorpse, evolve, EVOLVE_SPECIES, CORPSE_ID };
})(typeof window !== 'undefined' ? window : global);
