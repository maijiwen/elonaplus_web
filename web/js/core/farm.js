'use strict';
/**
 * 栽培（農業 / 栽培）系统 —— 在地图上「种下 → 照料 → 成长 → 收获」。
 *
 * 源码依据（hsp/start.hsp）：
 *   364910-364957  *label_3020  播种：`cell_featset(x, y, 247, 29, 种子字段24, care)`
 *   364958-364972  *label_3021  每日成长：care--，`care \ 50 == 0` 时枯死或晋级
 *   364973-365008  *label_3022  care 重算 + 栽培技能判定（失败 → care += 50）
 *   364492-364490  var_1302==31 手入れ（5 种照料方式）
 *   364292-364334  var_1302==65 施肥（248 → 253）
 *   365009-365522  *label_3023/3025  收获（判定 + 按组/季节选产物）
 *   249264-249294  地图刷新时按「经过天数」推进成长
 *
 * 特性编码（地图特性 type 29 = 植物）：
 *   id    247 刚种下 / 248 成长中 / 249 成熟 / 250 枯死 / 253 已施肥
 *   sub   作物种类（种子的 `var_99(24)`；照料时 `+= 选择*10`，可升到 40 段以上）
 *   arg3  care（照料余力，`4+rnd(5)` 起，失败 +50 → 枯死）
 *
 * 种子 = `refitem(id, 9) == 58500`（417 蔬菜 / 418 水果 / 419 草药 / 420 不明 /
 *        421 神器 / 553 宝石 / 554 魔法），字段 24 = 作物种类（36..42）。
 *
 * 未移植（如实记录）：
 *   · 收获只在**地图类型 103（自家农场）**成立（365043），本项目用地图名 `farm*`/`ranch*`
 *     或显式 `map.mapType` 近似；其它地图上收获会让植株消失（与源码一致）
 *   · `var_2602`（神器种子的类别表）未找到静态定义，走 `var_1522` 的缺省类别
 *   · `var_132(16)==103` 的温室/天候细分分支、`var_65(17)` 天气值的来源见 weather.js
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const TYPE_PLANT = 29;      // 植物特性的 type
  const ST = { PLANTED: 247, GROWING: 248, RIPE: 249, WITHERED: 250, FERTILIZED: 253 };
  const SEED_CAT = 58500;     // refitem(id, 9)：种子
  const SKILL = 180;          // 栽培
  const MAP_TYPE_FARM = 103;  // var_132(16)：自家农场
  const FERTILIZER = 920;     // 有機肥料（效果 65）
  const JEWEL = 682;          // クミロミの活性化の宝玉（效果 31）
  const KUMIROMI_PLUSHIE = 1099;  // くみろみぐるみ（610945 `allitemfind(1099)`）
  const ARTIFACT_SEED = 421;      // アーティファクトの種（610947 `itemcreate 421`）

  /** 610949-610976：带くみろみぐるみ时，被击倒的那只野兽的 4 句嘟囔（var_1454 = rnd(4)） */
  const BEAST_LINES = [
    '「害獣…許さない」（くみろみぐるみ的嘟囔）',
    '「悪い虫は…殺さなきゃ…」（くみろみぐるみ的嘟囔）',
    '「早く…駆除…しないと…」（くみろみぐるみ的嘟囔）',
    '「ずっと…見守ってあげるからね…？」（くみろみぐるみ的嘟囔）',
  ];

  const TEXT = {
    notSeed: '这不是种子。',
    inDungeon: '这里不能种植。',           // 364912-364918
    occupied: '这里已经有什么东西了。',     // 364922-364928
    planted: '你种下了',                   // 364945
    noPlant: '这里没有作物。',              // 364501
    grownFull: '这个作物已经完全长成了。',   // 364509
    revived: '枯萎的植物恢复了生机。',       // 364519
    tend: ['你松了松土。', '你拔掉了杂草。', '你剪掉了多余的叶子。', '你盖上薄膜保温。', '你摘掉了侧芽。'],  // 364424-364461
    tendMagic: '你注入了魔力。',
    noMore: '看起来不需要再照料了。',        // 364481
    fertilized: '你施了肥。',               // 364325
    noFertilize: '这里只能给成长中的作物施肥。',
    harvested: '你收获了',
    harvestFail: '收获失败了，植株枯萎了。',
    withered: '作物枯萎了。',
  };

  const Farm = {
    data: null,
    async load() {
      if (this.data) return this.data;
      this.data = await Elona.Data.table('farm');
      return this.data;
    },
    table() {
      if (!this.data && Elona.Data && Elona.Data.tableSync) {
        const t = Elona.Data.tableSync('farm');
        if (t) this.data = t;
      }
      return this.data;
    },

    // ------------------------------------------------------------------
    // 判定与工具
    // ------------------------------------------------------------------
    isSeed(it) {
      if (!it || !Elona.ItemDB) return false;
      return Elona.ItemDB.ref(it.id, 9) === SEED_CAT;
    },

    /** 作物种类（种子字段 24） */
    speciesOf(it) { return it ? (it.f[24] | 0) : 0; },

    /** 地块是否是「畑」（var_593(0, tile) == 2） */
    isField(g, x, y) {
      const cell = g.map && g.map.cell(x, y);
      if (!cell) return false;
      return (g.map.attr(cell[0], 0) | 0) === 2;
    },

    /** 地图类型：自家农场（var_132(16) == 103，见 core/sites.js） */
    mapType(g) {
      if (!g || !g.map) return 0;
      if (g.map.mapType) return g.map.mapType | 0;             // 显式指定（控制台/测试）
      const S = Elona.Sites;
      if (S && typeof S.ready === 'function' && S.ready()) {
        const t = S.typeOf(g.getV65 ? (g.getV65(20) | 0) : 0, { mapName: g.map.name }, g);
        if (t) return t;
      }
      // 表未加载时的兜底：crop_1 / farm_* 是畑（ranch 是牧场，不能算）
      return /^(crop|farm)/i.test(g.map.name || '') ? MAP_TYPE_FARM : 0;
    },

    /** 该格的植物特性（没有则 null） */
    plantAt(g, x, y) {
      if (!Elona.MapFeat || !Elona.MapFeat.read) return null;
      const f = Elona.MapFeat.read(g, x, y);
      if (!f || (f.type | 0) !== TYPE_PLANT) return null;
      return f;
    },

    /** 阶段名（供 UI 显示） */
    stageName(f) {
      if (!f) return '';
      const id = f.id | 0;
      if (id === ST.PLANTED) return '刚种下';
      if (id === ST.GROWING) return '成长中';
      if (id === ST.RIPE) return '已成熟';
      if (id === ST.WITHERED) return '已枯萎';
      if (id === ST.FERTILIZED) return '已成熟（施过肥）';
      return '未知';
    },

    // ------------------------------------------------------------------
    // 播种（*label_3020）
    // ------------------------------------------------------------------
    canPlant(g, x, y, idx) {
      const it = g.player.inv[idx];
      if (!this.isSeed(it)) return { ok: false, reason: 'not-seed', message: TEXT.notSeed };
      if (g.map.header && ((g.map.header[6] | 0) === 1 || (g.map.header[6] | 0) === 2 || (g.map.header[6] | 0) === 3)) {
        return { ok: false, reason: 'dungeon', message: TEXT.inDungeon };
      }
      const f = Elona.MapFeat.read(g, x, y);
      if (f && (f.type | 0) !== 0) return { ok: false, reason: 'occupied', message: TEXT.occupied };
      return { ok: true };
    },

    /**
     * 播种。玩家脚边/指定的格子种下 1 颗种子（消耗 1 个）。
     * @returns {{ok:boolean, feat?:object, message?:string}}
     */
    plant(g, idx, x, y) {
      const p = g.player;
      const it = p.inv[idx];
      const px = x === undefined ? p.x : x;
      const py = y === undefined ? p.y : y;
      const chk = this.canPlant(g, px, py, idx);
      if (!chk.ok) { g.log(chk.message); return { ok: false, reason: chk.reason }; }

      const species = this.speciesOf(it);
      const field = this.isField(g, px, py);
      const st = { id: field ? ST.GROWING : ST.PLANTED, isField: field, species, care: 0 };
      this.careCheck(g, p, st);                          // gosub *label_3022（内部设 care = 4+rnd(5)）
      Elona.MapFeat.write(g, px, py, st.id, TYPE_PLANT, species, st.care);

      it.f[0] = (it.f[0] | 0) - 1;                       // 364952 removeitem
      if ((it.f[0] | 0) <= 0 && Elona.ItemDB && Elona.ItemDB.stack) {
        // 数量归零的物品由调用方清理
      }
      const nm = Elona.ItemDB.name(it, 'en');
      g.log(field ? `你把 ${nm} 种在了田里。` : `你埋下了 ${nm}。`);   // 364945
      return { ok: true, feat: { id: st.id, type: TYPE_PLANT, sub: species, arg3: st.care }, species, care: st.care };
    },

    // ------------------------------------------------------------------
    // care 重算（*label_3022，364973-365008）
    // ------------------------------------------------------------------
    /**
     * @param {object} g
     * @param {object} c 播种者（玩家）
     * @param {object} st { id, species, isField, care }
     */
    careCheck(g, c, st) {
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      st.care = 4 + R(5);                                // 364977：care = 4 + rnd(5)
      const grp = idiv(st.species | 0, 10);
      let diff = 10;                                     // 365010 起：基础难度
      if (grp === 1) diff = 15;
      if (grp === 2) diff = 25;
      if (grp === 8) diff = 30;
      if (grp === 9) diff = 25;
      if (grp === 0) diff = 40;
      if (!st.isField) diff = idiv(diff * 3, 2);         // 364994-364996
      else diff = idiv(diff, 2);                          // 364997-364999
      if ((st.id | 0) === ST.PLANTED && (g.getV65(17) | 0) < 3) diff *= 2;   // 365000-365003 天气差
      const skill = c.skill(SKILL) | 0;
      const fail = (skill < R(diff + 1)) || (R(20) === 0);   // 365005
      if (fail) st.care = (st.care | 0) + 50;
      return st;
    },

    // ------------------------------------------------------------------
    // 每日成长（*label_3021，364958-364972）
    // ------------------------------------------------------------------
    growTick(g, x, y) {
      const f = this.plantAt(g, x, y);
      if (!f) return null;
      const st = { id: f.id | 0, species: f.sub | 0, isField: this.isField(g, x, y), care: f.arg3 | 0 };
      if (st.id === ST.FERTILIZED) return { skipped: 'fertilized' };    // 364959-364961
      st.care -= 1;                                                     // 364962
      if (idiv(st.care, 50) === 0) {                                    // 364963 `var_503(3) \ 50 == 0`
        if (st.care >= 50) {
          st.id = ST.WITHERED;                                          // 364964-364966
        } else {
          st.id += 1;                                                   // 364968
          this.careCheck(g, g.player, st);                               // 364969
        }
      }
      Elona.MapFeat.write(g, x, y, st.id, TYPE_PLANT, st.species, st.care);
      return { id: st.id, care: st.care, withered: st.id === ST.WITHERED };
    },

    /** 地图刷新：整张地图的植物按经过天数成长（249264-249294） */
    tickDay(g, days) {
      const n = Math.max(1, days | 0);
      const res = { grown: 0, withered: 0, messages: [] };
      const W = g.map.width, H = g.map.height;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const f = this.plantAt(g, x, y);
          if (!f) continue;
          for (let k = 0; k < n; k++) {
            if ((this.plantAt(g, x, y).id | 0) >= ST.RIPE) break;        // 249278-249280
            const r = this.growTick(g, x, y);
            if (r && r.withered) { res.withered++; res.messages.push(`(${x},${y}) 的作物枯萎了。`); }
          }
          res.grown++;
        }
      }
      return res;
    },

    // ------------------------------------------------------------------
    // 照料（364492-364490，5 种方式）
    // ------------------------------------------------------------------
    /**
     * @param {number} choice 1..5（松土/除草/剪叶/覆膜/摘芽）；>=6 时用魔力（txtsetplantr 分支）
     */
    tend(g, x, y, choice) {
      const p = g.player;
      const px = x === undefined ? p.x : x;
      const py = y === undefined ? p.y : y;
      const f = this.plantAt(g, px, py);
      if (!f) { g.log(TEXT.noPlant); return { ok: false, reason: 'no-plant' }; }
      const st = { id: f.id | 0, species: f.sub | 0, isField: this.isField(g, px, py), care: f.arg3 | 0 };

      // 364505-364511：已成熟 → 拒绝
      if (st.id === ST.RIPE) { g.log(TEXT.grownFull); return { ok: false, reason: 'ripe' }; }
      // 364513-364521：枯萎 → 复活到「成长中」
      if (st.id === ST.WITHERED) {
        st.id = ST.GROWING;
        this.careCheck(g, p, st);
        Elona.MapFeat.write(g, px, py, st.id, TYPE_PLANT, st.species, st.care);
        g.log(TEXT.revived);
        return { ok: true, revived: true };
      }
      // 源码只排除「已成熟」（364505），247/248/253 都能照料
      if (st.id !== ST.PLANTED && st.id !== ST.GROWING && st.id !== ST.FERTILIZED) {
        g.log(TEXT.noPlant);
        return { ok: false, reason: 'not-growing' };
      }
      if ((p.get(52) | 0) < 0) { g.log('你太累了，动弹不得。'); return { ok: false, reason: 'tired' }; }

      const ch = limit(choice | 0, 1, 5);
      if (Elona.Status && Elona.Status.dmgsp) Elona.Status.dmgsp(p, 10);   // 364396
      g.log(ch <= 5 ? TEXT.tend[ch - 1] : TEXT.tendMagic);                 // 364398-364470

      if ((st.care | 0) >= 50) st.care = 50;                              // 364472-364474
      st.care = idiv(st.care, 2);                                          // 364475
      if (st.care <= 1) { st.care = 1; g.log(TEXT.noMore); }               // 364476-364483
      // 364484-364487：种类 < 45 时按照料方式升种 + 栽培经验
      if ((st.species | 0) <= 45) {
        st.species = (st.species | 0) + ch * 10;
        if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, SKILL, p, 300, 0, 0, g);
      }
      Elona.MapFeat.write(g, px, py, st.id, TYPE_PLANT, st.species, st.care);
      return { ok: true, species: st.species, care: st.care };
    },

    // ------------------------------------------------------------------
    // 施肥（364292-364334）
    // ------------------------------------------------------------------
    fertilize(g, x, y) {
      const p = g.player;
      const px = x === undefined ? p.x : x;
      const py = y === undefined ? p.y : y;
      const f = this.plantAt(g, px, py);
      if (!f) { g.log(TEXT.noPlant); return { ok: false, reason: 'no-plant' }; }
      if (!this.isField(g, px, py)) { g.log('田以外不能施肥。'); return { ok: false, reason: 'not-field' }; }
      if ((f.id | 0) !== ST.GROWING) { g.log(TEXT.noFertilize); return { ok: false, reason: 'not-growing' }; }
      Elona.MapFeat.write(g, px, py, ST.FERTILIZED, TYPE_PLANT, f.sub | 0, f.arg3 | 0);   // 364324
      g.log(TEXT.fertilized);
      return { ok: true };
    },

    // ------------------------------------------------------------------
    // 库米罗妮宝玉（var_1302 == 31，364492-364534）
    // ------------------------------------------------------------------
    /**
     * 站在作物上使用「クミロミの活性化の宝玉」（682，效果 31）：
     *   成熟（249 / 253）→ 拒绝（364505-364511）
     *   枯萎（250）→ 复苏到成长期 248（364513-364521）
     *   其余 → 成长一级（247→248→249，364523）
     * 使用后 72 小时内不能再用的冷却写在宝玉的 `f[27]`（小时时间戳）。
     * @returns {{ok:boolean, id?:number, reason?:string}}
     */
    reviveOrGrow(g, x, y, item) {
      const p = g.player;
      const px = x === undefined ? p.x : x;
      const py = y === undefined ? p.y : y;
      const f = this.plantAt(g, px, py);
      if (!f) { g.log('脚下没有作物。'); return { ok: false, reason: 'no-plant' }; }
      const id = f.id | 0;
      if (id === ST.RIPE || id === ST.FERTILIZED) {
        g.log('这个作物已经完全长成了。');           // 364509
        return { ok: false, reason: 'ripe' };
      }
      const now = g.nowHours ? (g.nowHours() | 0) : 0;
      if (item) {
        const until = item.f[27] | 0;
        if (until > now) {
          g.log(`宝玉还需要 ${until - now} 小时才能再次使用。`);
          return { ok: false, reason: 'cooldown' };
        }
        item.f[27] = now + 72;
      }
      const st = { id, species: f.sub | 0, isField: this.isField(g, px, py), care: f.arg3 | 0 };
      if (id === ST.WITHERED) {                       // 364513-364519
        st.id = ST.GROWING;
        this.careCheck(g, p, st);
        g.log('枯萎的植物恢复了生机。');
      } else {
        st.id = id + 1;                               // 364523-364527
        g.log('植物成长了。');
      }
      Elona.MapFeat.write(g, px, py, st.id, TYPE_PLANT, st.species, st.care);
      return { ok: true, id: st.id };
    },

    // ------------------------------------------------------------------
    // 堆肥箱（249018-249042）
    // ------------------------------------------------------------------
    /**
     * 进入农田时把堆肥箱上的可堆肥物品变成有机肥料（920）。
     *   堆肥箱 = 图块属性 `var_593(0) == 11`；
     *   可转化 = 食材材质（f[24]==35）或指定的食物/垃圾类物品 id；
     *   每次地图更新**只转化一个**（249029-249037 的 `break`）。
     * @returns {{converted:number, x?:number, y?:number}}
     */
    compostTick(g) {
      if (!g || !g.map || this.mapType(g) !== MAP_TYPE_FARM) return { converted: 0 };
      const TRASH = [43, 45, 51, 52, 220, 221, 222, 301, 330, 575, 704, 1115];
      const list = g.groundItems || [];
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (!it || (it.f[0] | 0) <= 0) continue;
        const x = it.f[5] | 0, y = it.f[6] | 0;
        const cell = g.map.cell(x, y);
        if (!cell) continue;
        if ((g.map.attr(cell[0], 0) | 0) !== 11) continue;                 // 不是堆肥箱
        const ok = (it.f[24] | 0) === 35 || TRASH.indexOf(it.id | 0) >= 0;
        if (!ok) continue;
        it.f[0] = (it.f[0] | 0) - 1;                                        // 249032
        let fert = null;
        try { fert = Elona.ItemDB.createItem(FERTILIZER, 1); } catch (_) { fert = null; }
        if (fert) {
          fert.f[5] = x; fert.f[6] = y;
          list.push(fert);                                                  // 249034
        }
        if (it.f[0] <= 0) {
          const k = list.indexOf(it);
          if (k >= 0) list.splice(k, 1);
        }
        if (g.refreshGroundCell) g.refreshGroundCell(x, y);
        g.log(`堆肥箱里积起了肥料。`);
        return { converted: 1, x, y };                                      // 只转化一个
      }
      return { converted: 0 };
    },

    // ------------------------------------------------------------------
    // 野兽灾害（`var_1302 == 44` 的 `var_132(16, var_65(20)) == 103` 分支）
    // ------------------------------------------------------------------
    /**
     * 触发判定 —— 250 号段 249058（日付更新里）：
     *   `if ( rnd(var_82(180,0)+1) > 20 + var_82(180,0)/2 ) evadd 44`
     *   概率随栽培等级上升（作物多 → 引来野兽），栽培 0 时几乎不会发生。
     */
    raidChance(g) {
      const skill = (g && g.player && g.player.skill) ? (g.player.skill(SKILL) | 0) : 0;
      return g.rng.rnd(skill + 1) > 20 + idiv(skill, 2);
    },

    /**
     * 野兽灾害本体 —— **事件 44 的 103 分支，610933-610980**。
     *
     *   610933 `if ( var_132(16, var_65(20)) == 103 )`
     *   610934   `var_400 = limit(rnd((var_82(180,0)+1)/20+1), 1, 5)`      ← 只数 1..5
     *   610936   `flt calcobjlv((var_82(180,0)+1)/3+1), 2`                ← 等级 (栽培+1)/3+1
     *   610939   `fltn "wild"`                                            ← 只取 wild 标签
     *   610940   `characreate -1, var_60, -3, 0`                          ← 随机落点
     *   610941   `cbitmod 964`                                            ← 标记「灾害生成」
     *   610945 `if ( allitemfind(1099) != (-1) )`                          ← 带着くみろみぐるみ
     *   610947   `itemcreate -1, 421, …`                                  ← 最后一只脚下掉「アーティファクトの種」
     *   610949-610976 随机 4 句呢喃（「害獣…許さない」等）
     *   610977   `if ( var_581 > 16 ) dmghp var_581, 99999, -11`          ← 非队伍成员随即被击倒
     *
     * @returns {{count:number, monsters:Array<object>, seed:object|null, line:string|null}}
     */
    beastRaid(g) {
      const out = { count: 0, monsters: [], seed: null, line: null };
      if (!g || !g.player || !g.map || !Elona.CharaFactory) return out;
      const skill = g.player.skill ? (g.player.skill(SKILL) | 0) : 0;
      const n = limit(g.rng.rnd(idiv(skill + 1, 20) + 1), 1, 5);      // 610934
      const lv = idiv(skill + 1, 3) + 1;                              // 610936 calcobjlv
      for (let i = 0; i < n; i++) {
        let id = 0;
        try { id = Elona.CharaFactory.pick(g, lv, { tagName: 'wild' }); } catch (_) { id = 0; }
        if (!id) { try { id = Elona.CharaFactory.pick(g, lv, {}); } catch (_) { id = 0; } }
        if (!id) continue;
        let x = g.player.x, y = g.player.y;
        if (Elona.Encounter && Elona.Encounter.freeTile) {
          const spot = Elona.Encounter.freeTile(g);
          x = spot.x; y = spot.y;
        }
        try {
          const c = Elona.CharaFactory.create(g, id, lv, x, y);
          if (!c) continue;
          c.set(9, -3);                       // 灾害生成标记（249037 的 `var_58(9) == -3` 清理用）
          c.set(201, 30);
          if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, 964, 1);
          out.monsters.push(c);
          out.count++;
        } catch (_) { /* 单只失败不影响 */ }
      }
      if (out.count) g.log('田地被野兽糟蹋了！');
      // 610945-610979：带着「くみろみぐるみ」(1099) 时，最后一只会掉落神器之种
      if (out.count && this.holdingPlushie(g)) {
        const last = out.monsters[out.monsters.length - 1];
        let seed = null;
        try { seed = Elona.ItemDB.createItem(ARTIFACT_SEED, 1); } catch (_) { seed = null; }
        if (seed) {
          seed.f[5] = last.x | 0;
          seed.f[6] = last.y | 0;
          if (g.groundItems) g.groundItems.push(seed);
          if (g.map && g.map.cell) {
            const cell = g.map.cell(seed.f[5], seed.f[6]);
            if (cell) cell[4] = 1;
          }
          out.seed = seed;
        }
        out.line = BEAST_LINES[g.rng.rnd(BEAST_LINES.length)] || null;
        if (out.line) g.log(out.line);
        if ((last.index | 0) > 16) {
          // 610977：非队伍成员（索引 > 16）随即被抹去
          last.hp = 0;
          last.set(0, 0);
          const cells = g.map && g.map.cells;
          if (cells && cells[last.y] && cells[last.y][last.x]) cells[last.y][last.x][1] = 0;
          out.count--;
        }
      }
      return out;
    },

    /** `allitemfind(1099)`：背包或脚下是否有くみろみぐるみ */
    holdingPlushie(g) {
      const has = (it) => it && (it.id | 0) === KUMIROMI_PLUSHIE && (it.f[0] | 0) > 0;
      if (g.player && g.player.inv && g.player.inv.some(has)) return true;
      if (g.groundItems && g.groundItems.some((it) => has(it)
        && (it.f[5] | 0) === (g.player.x | 0) && (it.f[6] | 0) === (g.player.y | 0))) return true;
      return false;
    },

    /** 绝对小时数（年 12 月 × 30 日 × 24 时），用于 renew 间隔判定 */
    absHour(g) {
      const V = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
      return (((V(10) * 12 + (V(11) || 1) - 1) * 30) + ((V(12) || 1) - 1)) * 24 + V(13);
    },

    /**
     * `renew_major`（*label_2467）的间隔闸门。
     *   249265-249267：`var_132(16) == 31 | 103 | 105` 时 `var_126(3) = now + 120`，
     *   即牧场 / 农田 / 收容所每 120 小时（5 天）刷新一次。
     * @param {string} key 地图标识（同一张农田各自计时）
     * @returns {boolean} 本次是否该刷新
     */
    renewDue(g, key, hours) {
      if (!g) return false;
      const span = hours === undefined ? 120 : (hours | 0);
      const now = this.absHour(g);
      if (!g.farmRenew) g.farmRenew = {};
      const last = g.farmRenew[key] | 0;
      // 首次进入（last == 0）也要刷新一次 —— 源码 var_126(3) 初值 0（237958）
      if (last && now - last < span) return false;
      g.farmRenew[key] = now || 1;
      return true;
    },

    // ------------------------------------------------------------------
    // 收获（*label_3023 / *label_3025）
    // ------------------------------------------------------------------
    /**
     * @returns {{ok:boolean, items?:Array, message?:string, removed?:boolean}}
     */
    harvest(g, x, y) {
      const p = g.player;
      const px = x === undefined ? p.x : x;
      const py = y === undefined ? p.y : y;
      const f = this.plantAt(g, px, py);
      if (!f) { g.log(TEXT.noPlant); return { ok: false, reason: 'no-plant' }; }
      if ((f.id | 0) < ST.RIPE) { g.log('还没有成熟。'); return { ok: false, reason: 'not-ripe' }; }

      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      const species = f.sub | 0;
      const grp = idiv(species, 10);
      const field = this.isField(g, px, py);

      // 【注记】365009-365046 的难度判定属于**再生**（*label_3023），
      //   源码调用顺序是 `gosub *label_3025`（产物）→ `gosub *label_3023`（再生/枯死），
      //   所以产物先生成、再判定植株是否消失（神器种也照样出产）。
      const skill = p.skill(SKILL) | 0;

      // 365090-365496：按 组 × 季节 选产物（*label_3025，先于再生判定）
      const tbl = this.table() || {};
      const base = (tbl.groupBase && tbl.groupBase[String(grp)]) || 0;
      const month = g.getV65(11) | 0;
      const season = this.seasonOf(month);
      const gd = tbl.groups && tbl.groups[String(grp)];
      const sd = gd && gd.seasons && gd.seasons[season];
      let prodId = 0;
      let category = 0;
      let quality = 0;
      if (gd) {
        // 覆盖表：`var_503(2) == X + 组基` → X = 种类 - 组基（作物管理的 5 种手法 = +10..+50）
        const over = Object.assign({}, gd.over || {}, (sd && sd.over) || {});
        const key = String(species - base);
        if (over[key] !== undefined) prodId = over[key];
        else if (sd && sd.list && tbl.lists && tbl.lists[sd.list]) {
          const list = tbl.lists[sd.list];
          prodId = list[R(list.length)];
        }
        if (sd && sd.rare && R(sd.rare.chance) === 0) prodId = sd.rare.id;
        if (sd && sd.category) category = sd.category;
        if (gd.category) category = gd.category;
        if (gd.quality) quality = gd.quality;
      }

      const items = [];
      let it = null;
      try {
        if (prodId) {
          it = Elona.ItemDB.createItem(prodId, 1);
          it.genLevel = idiv(skill + 1, 2) + 15;                    // 365095 flt
        } else {
          // 产物 id 为 0 → 按类别随机（原版 itemcreate 用 var_639 / var_638 类别）
          it = Elona.ItemDB.create(g, { t639: category, level: idiv(skill + 1, 2) + 15, fix: 2 });
        }
      } catch (e) { it = null; }

      // 365498-365510：**作物加值**（写 f[20]，不是数量）
      //   管理过（种类 > 45）→ +3；栽培等级 → +0..7；施过有机肥料（253）→ +5（合计上限 +15）
      let value = 0;
      if (it) {
        if (quality) it.genFix = quality;
        if ((species | 0) > 45) value += 3;
        value += limit(R(idiv(skill + 1, 20) + 2), 0, 7);
        if ((f.id | 0) === ST.FERTILIZED) value += 5;
        it.f[20] = (it.f[20] | 0) + value;
        if (Elona.ItemDB && Elona.ItemDB.stack) {
          p.inv.push(it);
          Elona.ItemDB.stack(p, p.inv.length - 1);
        }
        items.push(it);
        const nm = Elona.ItemDB.instanceName(it, 'en');
        g.log(`${TEXT.harvested} ${nm}${value ? `（加值 +${value}）` : ''}。`);   // 365087
      }
      // 365092：收获经验
      if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, SKILL, p, 300, 0, 0, g);

      // 365009-365078：再生判定（*label_3023）—— 成功则原地重新种下新芽
      const rg = this.regrowCheck(g, px, py, { species, field });
      return { ok: true, items, value, regrown: !!rg.regrown, productId: prodId, category };
    },

    /**
     * 收获后的再生判定（*label_3023，365009-365078）。
     *   var_400 = 15 /（组 1：25、2：30、8：40、9：35）
     *   非农田 ×4、农田 ÷2、天气差（var_65(17) < 3）×4/3
     *   持「轮回剪」1012 → 随机失败线 -100
     *   失败（技能 < rnd(diff+1) 或 rnd(200) < diff - bonus）或神器种（组 0）→ 植株消失
     *   成功 → 种类回到组基、状态回到「刚种下」、重算 care
     * @returns {{regrown:boolean, cleared?:boolean, care?:number}}
     */
    regrowCheck(g, x, y, st) {
      const R = (n) => g.rng.rnd(Math.max(1, n | 0));
      const p = g.player;
      const species = st.species | 0;
      const grp = idiv(species, 10);
      const field = st.field === undefined ? this.isField(g, x, y) : !!st.field;
      let diff = 15;                                     // 365010-365022
      if (grp === 1) diff = 25;
      if (grp === 2) diff = 30;
      if (grp === 8) diff = 40;
      if (grp === 9) diff = 35;
      if (!field) diff *= 4;                             // 365023-365028
      else diff = idiv(diff, 2);
      if ((g.getV65(17) | 0) < 3) diff = idiv(diff * 4, 3);
      let cut = 0;                                       // 365032-365038：轮回剪 1012
      if (p.inv && p.inv.some((it) => it && (it.f[0] | 0) > 0 && (it.id | 0) === 1012)) cut = 100;
      const skill = p.skill(SKILL) | 0;
      const fail = (skill < R(diff + 1)) || (R(200) < diff - cut) || grp === 0;   // 365039
      if (fail || this.mapType(g) !== MAP_TYPE_FARM) {   // 365040-365046
        if (Elona.MapFeat.clear) Elona.MapFeat.clear(g, x, y);
        else Elona.MapFeat.write(g, x, y, 0, 0, 0, 0);
        return { regrown: false, cleared: true };
      }
      // 365047-365071
      const tbl = this.table() || {};
      const base = (tbl.groupBase && tbl.groupBase[String(grp)]) || 0;
      const nt = { id: ST.PLANTED, species: base, isField: field, care: 0 };
      this.careCheck(g, p, nt);
      Elona.MapFeat.write(g, x, y, nt.id, TYPE_PLANT, nt.species, nt.care);
      g.log('新芽冒了出来！');                            // 365076
      return { regrown: true, care: nt.care, species: base };
    },

    /** 月份 → 季节（365103-365148 / 365292 等） */
    seasonOf(month) {
      if (month >= 3 && month <= 5) return 'spring';
      if (month >= 6 && month <= 8) return 'summer';
      if (month >= 9 && month <= 11) return 'autumn';
      return 'winter';           // 12 月与 1..2 月
    },
  };

  Elona.Farm = Farm;
  Elona.Farm.TYPE_PLANT = TYPE_PLANT;
  Elona.Farm.STAGES = ST;
  Elona.Farm.FERTILIZER = FERTILIZER;
  Elona.Farm.JEWEL = JEWEL;
  Elona.Farm.KUMIROMI_PLUSHIE = KUMIROMI_PLUSHIE;
  Elona.Farm.ARTIFACT_SEED = ARTIFACT_SEED;
  Elona.Farm.BEAST_LINES = BEAST_LINES;
  Elona.Farm.TEXT = TEXT;
})(window);
