/**
 * 采集（採取）系统 —— 站在「採集ポイント」上采集材料。
 *
 * 源码依据（hsp/start.hsp）：
 *   228777-228842  map_randsite    随机地图放置采集点（概率抽 24..28 号特性）
 *   305786-305988  *label_2909     采集主逻辑（12 次判定、成功给 3 个材料、耗尽后移除）
 *   305876-305961  每类采集的技能、成功判定与消息
 *
 * 采集点类型（var_503(1)，即 cell_featset 的 type）：
 *   25 MINE    矿脉 → 分类 14（矿石） 技能 163 採掘
 *   26 SPRING  泉   → 分类 13（水）   技能 185 釣り
 *   27 REMAINS 残骸 → 分类 16（遗传） 技能 151 生化学
 *   28 PLANT   植物 → 分类 15（草）   技能 180 栽培
 *   24 GATHER  采集点 → 分类由**地图 header[6]** 决定（var_126(6) 20..27）
 *
 * 材料本身见 core/material.js。
 */
(function (global) {
  'use strict';
  const Elona = global.Elona = global.Elona || {};

  /** 采集点类型 → 固定分类（305864-305875） */
  const FEAT_CAT = { 25: 14, 26: 13, 27: 16, 28: 15 };

  /**
   * 地图 kind（var_126(6)，即 header[6]）→ 分类（305795-305818，仅 24 号采集点会用到）。
   * 注意：源码判断的是地图 header[6]（ネフィア地形主题 20..27），
   *   不是脚下地块 cell[0]。此前按 cell[0] 查表，地下城地面统一为 33 时落到 11 号
   *   「无产出」分类，导致 A71 的 24 号采集点永远采不到东西。
   */
  const KIND_CAT = {
    20: 9, 21: 12, 22: 10, 23: 12, 24: 16, 25: 10, 26: 14, 27: 13,
  };

  /**
   * 分类 → 判定用技能 + 消息（305877-305961）
   *   test  : var_82(skill,0)*2+5 > rnd(level+1) | rnd(10) == 0
   *   reason: matgetmain 的第三个参数（1 掘 / 2 釣 / 3 採取 / 4 回収 / 5 発見）
   */
  const CAT_ACT = {
    14: { skill: 163, reason: 1, fail: '採掘に失敗した。', failEn: 'Your mining attempt fails.' },
    13: { skill: 185, reason: 2, fail: '釣りに失敗した。', failEn: 'Your fishing attempt fails.' },
    15: { skill: 180, reason: 3, fail: '採取に失敗した。', failEn: 'Your searching attempt fails.' },
    16: { skill: 151, reason: 4, fail: '回収に失敗した。', failEn: 'Your searching attempt fails.' },
    9: { skill: 159, reason: 5, fail: '探索に失敗した。', failEn: 'Your searching attempt fails.' },
    10: { skill: 159, reason: 5, fail: '探索に失敗した。', failEn: 'Your searching attempt fails.' },
    12: { skill: 159, reason: 5, fail: '探索に失敗した。', failEn: 'Your searching attempt fails.' },
  };

  /** 每次交互的判定次数（305876 repeat 12） */
  const ATTEMPTS = 12;

  /** 采集点类型集合（305790：var_503(1) 落在 24..28） */
  function isSpotType(type) {
    return type >= 24 && type <= 28;
  }

  /** 脚下是否有采集点 */
  function spotAt(g, x, y) {
    const M = Elona.MapFeat;
    if (!M) return null;
    const f = M.read(g, x, y);
    if (!isSpotType(f.type)) return null;
    return f;
  }

  /**
   * 该采集点的材料分类（var_2049）。
   * 先按地块编号给一个默认值，被 25..28 号特性的固定分类覆盖。
   */
  function categoryOf(g, feat, x, y) {
    let cat = FEAT_CAT[feat.type] || 0;
    if (cat) return cat;
    // 24 号采集点：分类由地图 header[6] 决定（305795-305818）
    const kind = (g.map && g.map.header) ? (g.map.header[6] | 0) : 0;
    return KIND_CAT[kind] || 11;
  }

  /**
   * 材料等级（var_2070）= 当前子地图编号 var_65(22)。
   * 地上世界（地块 1）另有公式，本项目不生成世界采集点，故只取子地图。
   */
  function matLevel(g) {
    const sub = g.getV65 ? (g.getV65(22) | 0) : 0;
    if (sub > 0) return sub;
    return Math.max(1, g.dungeonDepth | 0);
  }

  /** 采集耗尽后的消息（305964-305973） */
  function exhaustText(feat) {
    if (feat.type === 26) return { jp: '泉は干上がった。', en: 'The spring dries up.' };
    if (feat.type === 25) return { jp: '鉱石を掘りつくした。', en: "There's no more ore around." };
    if (feat.type === 28) return { jp: 'もう目ぼしい植物は見当たらない。', en: "There's no more plant around." };
    return { jp: 'もう何もない。', en: "You can't find anything anymore." };
  }

  /**
   * 执行一次采集 —— *label_2909（305786-305988）。
   *
   * @returns {{ok:boolean, cat:number, attempts:number, gained:{id:number,n:number}[],
   *            exhausted:boolean, messages:string[], cleared:boolean}}
   */
  function gather(g) {
    const p = g.player;
    const M = Elona.MapFeat;
    const Mat = Elona.Material;
    const out = { ok: false, cat: 0, attempts: 0, gained: [], exhausted: false, messages: [], cleared: false };
    if (!p || !M || !Mat) return out;

    const feat = spotAt(g, p.x, p.y);
    if (!feat) { out.messages.push('这里没有可以采集的东西。'); return out; }

    const cat = categoryOf(g, feat, p.x, p.y);
    const lv = matLevel(g);
    out.cat = cat;
    out.ok = true;

    const act = CAT_ACT[cat];
    if (!act) {
      // 分类 11（默认值）在原版没有对应分支 → 什么都不会发生（源码如此）
      out.messages.push('这里似乎没什么可采集的。');
      return out;
    }

    const r = (n) => g.rng.rnd(Math.max(1, n | 0));
    const S = Elona.Stats;
    const en = !!(Elona.Options && Elona.Options.values && Elona.Options.values.lang === 'en');

    for (let i = 0; i < ATTEMPTS; i++) {
      out.attempts++;
      const skill = p.skill(act.skill) | 0;

      // 305879 / 305897 / 305914 / 305931 / 305948
      const success = (skill * 2 + 5 > r(lv + 1)) || r(10) === 0;
      if (success) {
        // matgetmain random_material(var_2070, 0), 1, reason —— 每次 1 个，连给 3 次
        for (let k = 0; k < 3; k++) {
          const id = Mat.random(lv, 0, cat, r);
          const got = Mat.add(g, id, 1, act.reason);
          out.gained.push({ id, n: 1 });
          if (got.message) out.messages.push(got.message);
        }
      } else {
        out.messages.push(en ? act.failEn : act.fail);
      }

      // skillexp <skill>, 0, 50 —— 失败也给经验（305891 等）
      if (S && S.skillExp) S.skillExp(p, act.skill, p, 50, 1, 0, g);
      // var_65(190)++ 采集计数
      g.setV65(190, (g.getV65(190) | 0) + 1);

      // 305963：rnd(5 + var_97(159)*2) + 4 < var_65(190) → 采尽
      //   注意是 **feat 159**（地精/朱伊安的「采集更多素材」），不是技能 159。
      const det = Elona.Feat ? (Elona.Feat.get(p, 159) | 0) : 0;
      if (r(5 + det * 2) + 4 < (g.getV65(190) | 0)) {
        const t = exhaustText(feat);
        out.messages.push(en ? t.en : t.jp);
        out.exhausted = true;
        g.setV65(190, 0);
        // 305981：楼梯（10/11）以外的采集点直接消失
        if (feat.type !== 10 && feat.type !== 11) {
          // var_704(x, y, 6) = 0 —— 整格清空，不能只把 id 归零
          if (M.clear) M.clear(g, p.x, p.y); else M.write(g, p.x, p.y, 0);
          out.cleared = true;
        }
        break;
      }
    }

    return out;
  }

  /** 采集点的说明文字（供 look / 交互提示用） */
  const SPOT_TEXT = {
    24: '可以采集。', 25: '可以采掘。', 26: '泉水。', 27: '残骸。', 28: '生长着各种植物。',
  };

  // ---------------------------------------------------------------- 地图生成
  /**
   * 随机地图的采集点放置 —— map_randsite（228777-228842）。
   *
   * 只在「地块 20..27 且 var_126(7) != 0（室外标志）」的格子上放置，
   * 概率依次为 rnd(10)==0 的四连判定，最后兜底放 24 号采集点。
   *
   * @returns {null|{id:number, type:number}} 放下的特性；null 表示这格不放
   */
  function rollSite(rnd) {
    if (rnd(10) === 0) return { id: 243, type: 27 };   // 残骸
    if (rnd(10) === 0) return { id: 244, type: 25 };   // 矿脉
    if (rnd(10) === 0) return { id: 245, type: 26 };   // 泉
    if (rnd(10) === 0) return { id: 246, type: 28 };   // 植物
    return { id: 238 + rnd(3), type: 24 };             // var_1610 = 238
  }

  /**
   * ネフィア热狂时的采集点放置 —— map_fever（228946-228980）。
   *
   * 与 map_randsite 的区别：
   *   · 四种固定采集点各按 rnd(4)==0（25%）判定
   *   · 兜底同样是 24 号采集点（var_1610 + rnd(3) = 238..240）
   *   · 另外有 1% 概率直接放一个仪式用祭坛（item 172）
   * 这里只返回「特性 / 物品」描述，具体落格由调用方决定。
   *
   * @returns {null|{kind?:'item', id:number, type?:number, featId?:number}}
   */
  function rollFever(rnd) {
    // 228947-228954：var_126(3)==0（新生成的地图）时 1% 放祭坛 172
    if (rnd(100) === 0) return { kind: 'item', id: 172 };
    if (rnd(4) === 0) return { id: 243, type: 27, featId: 243 };   // 残骸
    if (rnd(4) === 0) return { id: 244, type: 25, featId: 244 };   // 矿脉
    if (rnd(4) === 0) return { id: 245, type: 26, featId: 245 };   // 泉
    if (rnd(4) === 0) return { id: 246, type: 28, featId: 246 };   // 植物
    const fid = 238 + rnd(3);                                  // var_1610 = 238
    return { id: fid, type: 24, featId: fid };
  }

  Elona.Gather = {
    FEAT_CAT, KIND_CAT, CAT_ACT, ATTEMPTS, SPOT_TEXT,
    isSpotType, spotAt, categoryOf, matLevel, gather, rollSite, rollFever,
  };
})(typeof window !== 'undefined' ? window : globalThis);
