'use strict';
/**
 * 新年礼物袋 / 猫窝（core/giftpack.js）—— 0-GO
 *
 * 【源码依据 hsp/start.hsp】
 *   222106-222108  var_1552 / 1553 / 1554 三个随机产物池（20 / 10 / 6 项）
 *   344924-345091  *label_2998 的「打开有内容的物品」分派：
 *     var_99(25)==0 → 空；752 → gosub *label_3001；744 → gosub *label_3002；
 *     1105 → 白金币；784 → 卡包；其余 → *label_3000（core/dungeonfx.js）
 *   345293-345459  *label_3001 お年玉袋：按 var_99(27) 品质分三档
 *     <100  1/3 恶意怪物伏击（repeat 3+rnd(3)）/ 1/3 发火陷阱（repeat 6）
 *           / 否则 1114 呪いの言葉（var_578=1000 → gosub *label_2960）
 *     <200  1/4 铃铛 NPC(328+rnd2) / 1/5 妹妹(176) / 否则 var_1552 池
 *     否则  1/3 多个铃铛 NPC / 1/10 var_1554 稀有池 / 否则 var_1553 池
 *   345460-345507  *label_3002 猫窝：1/2 猫(164) / 否则 僵尸猫(447)
 *   603956-604166  回合循环与归航倒计时见 core/turncycle.js
 *
 * 【项目侧差异】原版用 var_99(25)（内容存档编号）判断「是否已开」；本项目
 *   容器内容直接挂在物品实例上，故第一次打开后置 `it.__giftOpened` 标记，
 *   同时仍按源码把 f[25] 清 0（见 docs/02）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let cached = null;
  function table() {
    if (!cached) {
      cached = (Elona.GiftPackData && Elona.GiftPackData.packs) ? Elona.GiftPackData : null;
      if (!cached && Elona.Data && Elona.Data.tableSync) {
        try { cached = Elona.Data.tableSync('giftpacks'); } catch (e) { cached = null; }
      }
    }
    return (cached && cached.packs) ? cached : null;
  }

  function R(g) {
    const o = (g && g.rng) ? g.rng : (Elona.rng || null);
    return (n) => (o && typeof o.rnd === 'function') ? o.rnd(Math.max(1, n | 0)) : 0;
  }
  function idiv(a, b) { return Math.trunc((a | 0) / (b || 1)); }
  function field(it, n) { return (it && it.f) ? (it.f[n] | 0) : 0; }

  function say(g, T, key, res, itemName) {
    const t = T.texts && T.texts[key];
    if (!t) return '';
    const lang = (g && g.lang === 'jp') ? 'jp' : 'en';
    let line = t[lang] || t.en || '';
    if (t.template) line = line.replace('{item}', itemName || '');
    res.messages.push(line);
    res.text = key;
    return line;
  }

  function matchCond(cond, rnd) {
    const m = /^rnd\((\d+)\)==0$/.exec(cond || '');
    if (m) return rnd(+m[1]) === 0;
    return cond === 'else';
  }

  function countOf(v, rnd) {
    if (Array.isArray(v)) return (v[0] | 0) + rnd(v[1] | 0);
    return v | 0;
  }

  function drop(g, id, x, y, res) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    const it = Elona.ItemDB.createItem(id | 0, 1);
    if (!it) return null;
    if (Elona.Loot && Elona.Loot.dropGround) Elona.Loot.dropGround(g, it, x, y);
    res.items.push(id | 0);
    res.spawned++;
    return it;
  }

  function spawnNpc(g, id, level, x, y, opt, res) {
    if (!Elona.CharaFactory || !Elona.CharaFactory.create) return null;
    let c = null;
    try { c = Elona.CharaFactory.create(g, id | 0, level | 0, x, y, opt || {}); }
    catch (e) { c = null; }
    if (c) { res.npcs.push(id | 0); res.spawned++; }
    return c;
  }

  /** 345321-345324：恶意怪物伏击的等级 = calcobjlv(玩家等级*3/2+3)、fixlv 2 */
  function ambushLevel(g, actor) {
    const lv = actor && typeof actor.get === 'function' ? (actor.get(38) | 0) : (g.player ? (g.player.level | 0) : 1);
    const raw = idiv(lv * 3, 2) + 3;
    return Elona.ItemDB && Elona.ItemDB.calcObjLv ? Elona.ItemDB.calcObjLv(raw, g) : raw;
  }

  function runEffect(g, actor, eff, res, rnd, itemName) {
    const px = actor ? (actor.x | 0) : 0;
    const py = actor ? (actor.y | 0) : 0;
    switch (eff.kind) {
      case 'monsters': {
        const n = countOf(eff.count, rnd);
        const lv = ambushLevel(g, actor);
        const fix = (Elona.ItemDB && Elona.ItemDB.calcFixLv)
          ? Elona.ItemDB.calcFixLv(eff.fix | 0, g) : (eff.fix | 0);
        for (let i = 0; i < n; i++) {
          // characreate -1, 0 → 随机怪物（flt calcobjlv / calcfixlv(2)）
          spawnNpc(g, 0, lv, px, py, { var641: fix }, res);
        }
        res.monsters = n;
        break;
      }
      case 'fire': {
        // 345337-345345：repeat 6，随机 ±rnd(3)，出界 continue；addmef 火 + mapitem_fire
        let fires = 0;
        for (let i = 0; i < (eff.repeat | 0); i++) {
          const x = px + rnd(3) - rnd(3);
          const y = py - rnd(3) + rnd(3);
          if (g && g.map && g.map.inBounds && !g.map.inBounds(x, y)) continue;
          if (Elona.Mef && Elona.Mef.add) Elona.Mef.add(g, x, y, 5, 24, rnd(15) + 20, 50, 0);
          if (Elona.ItemDB && Elona.ItemDB.mapitemFire) Elona.ItemDB.mapitemFire(g, x, y, null);
          fires++;
        }
        res.fires = fires;
        break;
      }
      case 'spell': {
        // 345355-345358：var_396=1114, var_578=1000, gosub *label_2960
        const target = actor || g.player;
        if (Elona.Spell && Elona.Spell.dispatchEffect) {
          try { res.spell = Elona.Spell.dispatchEffect(g, target, eff.id | 0, target, eff.power | 0); }
          catch (e) { res.spell = null; }
        }
        res.spells++;
        break;
      }
      case 'npc': {
        const n = countOf(eff.count, rnd);
        for (let i = 0; i < n; i++) {
          const id = (eff.id | 0) + (eff.rnd ? rnd(eff.rnd | 0) : 0);
          const lv = Math.max(1, (g.player && g.player.level) | 0);
          const c = spawnNpc(g, id, lv, px, py, {}, res);
          if (!c) continue;                                  // stat != 0
          if (eff.hostileFix && actor && typeof actor.get === 'function' && (actor.get(9) | 0) <= -3) {
            // 345376-345379 / 345424-345427：敌对状态下把新 NPC 拉回中立
            if (typeof c.set === 'function') { c.set(9, -1); c.set(69, -1); }
          }
          if (eff.f30 && typeof c.set === 'function') c.set(30, eff.f30 | 0);
        }
        break;
      }
      case 'pool': {
        const pool = table().pools[eff.pool];
        if (!pool || !pool.items.length) break;
        const id = pool.items[rnd(pool.items.length)];
        drop(g, id, px, py, res);
        res.pool = eff.pool;
        break;
      }
      default:
        break;
    }
  }

  /**
   * 打开 752 お年玉袋 / 744 猫窝（344936-344947 → label_3001 / label_3002）。
   * @param {object} g
   * @param {object} c 打开者（var_243，一般是玩家）
   * @param {object} it 物品实例
   * @returns {{ok:boolean, id:number, grade:string, branch:string, spawned:number,
   *            items:Array, npcs:Array, monsters:number, fires:number, messages:Array}}
   */
  function open(g, c, it) {
    const T = table();
    if (!T) return { ok: false, reason: 'no-table' };
    if (!it) return { ok: false, reason: 'no-item' };
    const id = it.id | 0;
    const pack = T.packs[String(id)];
    if (!pack) return { ok: false, reason: 'not-pack', id };
    // 已开过：原版 344924-344930 的「中身は空っぽだ。」
    //   本项目不能用 f[25]==0 判空（createItem 生成的 752/744 初始就是 0），
    //   改用实例标记，差异见 docs/02。
    if (it.__giftOpened) {
      return { ok: true, id, empty: true, already: true, spawned: 0, messages: [] };
    }
    if (!it.f) it.f = {};
    const actor = c || (g && g.player) || null;
    const rnd = R(g);
    const itemName = (Elona.ItemDB && Elona.ItemDB.name)
      ? Elona.ItemDB.name(id, 'en') : (pack.nameEn || '');
    const res = {
      ok: true, id, pack: pack.label, grade: '', branch: '', text: '',
      messages: [], items: [], npcs: [], monsters: 0, fires: 0, spells: 0,
      pool: '', spawned: 0,
    };

    // 345300 / 345467：打开提示；345307 / 345474：var_99(25) = 0
    say(g, T, pack.openText, res, itemName);
    it.f[25] = 0;
    it.__giftOpened = true;

    if (id === 752) {
      // 345310 / 345363：按 var_99(27) 的品质分档
      const grade = field(it, 27);
      let chosen = null;
      for (const gr of pack.grades) {
        if (gr.test === 'f27<100' && grade < 100) { chosen = gr; break; }
        if (gr.test === 'f27<200' && grade < 200) { chosen = gr; break; }
        if (gr.test === 'else') { chosen = gr; break; }
      }
      chosen = chosen || pack.grades[pack.grades.length - 1];
      res.grade = chosen.name;
      for (const b of chosen.branches) {
        if (!matchCond(b.cond, rnd)) continue;
        res.branch = b.src;
        res.text = b.text;
        say(g, T, b.text, res, itemName);
        runEffect(g, actor, b.effect, res, rnd, itemName);
        break;
      }
    } else {
      for (const b of pack.branches) {
        if (!matchCond(b.cond, rnd)) continue;
        res.branch = b.src;
        res.text = b.text;
        say(g, T, b.text, res, itemName);
        runEffect(g, actor, b.effect, res, rnd, itemName);
        break;
      }
    }
    // 统一写日志（res.messages 已经收集完，不再往里追加）
    if (g && typeof g.log === 'function') {
      for (const m of res.messages) g.log(m);
    }
    return res;
  }

  /** 是否属于本模块接管的「特殊内容物」物品 */
  function has(id) {
    const T = table();
    return !!(T && T.packs[String(id | 0)]);
  }

  Elona.GiftPack = { open, has, table, matchCond, countOf, ambushLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.GiftPack;
})(typeof window !== 'undefined' ? window : global);
