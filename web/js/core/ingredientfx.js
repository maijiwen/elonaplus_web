'use strict';
/**
 * 食材/食品固有食用效果 —— 还原 start.hsp *label_2304（226178-226708）。
 * 
 * 源码依据：
 *   - 226178: 1082 油炸豆腐（狐系角色食用反应）
 *   - 226216: 1136 以太饼干（modcorrupt -1000 减轻以太病）
 *   - 226228: 1071 乾面包（无水时体重增加）
 *   - 226272: 889  手制巧克力（f[27] 各分支：媚药、爆炸、异物、怪味）
 *   - 226400: 755  年糕（魅力经验 +3000）
 *   - 226408: 1107/1108 月见团子（魅力经验 +2000）
 *   - 226411: 702  肉包（魅力经验 +1000）
 *   - 226414: 639  （魅力经验 +20000）
 *   - 226417: 655  （力量经验 +3000）
 *   - 226420: 662  （体质经验 +3000）
 *   - 226423: 867  迷幻菇（精神耐性+50、混乱80、SAN-50~59）
 *   - 226436: 932  毒蘑菇（SAN-1~10）
 *   - 226468: 667  甜点（SAN回复 +30）
 *   - 226477: 952  魔法料理（buff 30与3、回复HP、var_58(259)+50）
 *   - 226490: 848  衰老草（年龄老化）
 *   - 226512: 849  返老草（年龄年轻化）
 *   - 226543: 1040 幼体料理（缩小身躯：身高体重减半折算）
 *   - 226561: 852  阴阳料理（祝福性转 / 诅咒性取向变动）
 *   - 226702: 260/258/787/633 料理任务/成就计数累加
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const IngredientFX = {};

  const idiv = (a, b) => Math.trunc(a / b);
  const limit = (v, min, max) => Math.max(min, Math.min(max, v));

  /**
   * 获取角色显示名称
   */
  function nameOf(c) {
    if (!c) return '某人';
    if ((c.index | 0) === 0) return '你';
    if (typeof c.name === 'function') return c.name('zh') || c.name('en') || '某人';
    return c.name || '某人';
  }

  /**
   * 检查背包中是否有特定物品 id
   */
  function hasItemInInv(c, itemId) {
    if (!c || !c.inv) return false;
    for (let i = 0; i < c.inv.length; i++) {
      const it = c.inv[i];
      if (it && (it.f[0] | 0) > 0 && it.id === itemId) return true;
    }
    return false;
  }

  /**
   * 应用食材/食品特殊效果
   * @param {object} g 游戏主实例
   * @param {object} c 食用者角色
   * @param {object} it 料理/食品物品实例
   * @returns {object} 执行结果与日志
   */
  IngredientFX.apply = function (g, c, it) {
    if (!g || !c || !it) return { ok: false, messages: [] };

    const messages = [];
    const id = it.id | 0;
    const f17 = it.f[17] | 0; // 祝福/诅咒状态: 1 祝福, 0 普通, -1 诅咒
    const f20 = it.f[20] | 0; // 料理等级/加值
    const f26 = it.f[26] | 0; // 味道
    const f27 = it.f[27] | 0; // 特殊参数
    const who = nameOf(c);
    const isPlayer = (c.index | 0) === 0;

    // 辅助日志
    const log = (msg) => { if (msg) messages.push(msg); };

    // 1082: 油炸豆腐（狐系生物特有台词与好感/状态加成）
    if (id === 1082) {
      const race = c.get(27) | 0;
      if (race === 921 || race === 673 || race === 538 || race === 1125) {
        const r = g.rng ? g.rng.rnd(4) : 0;
        if (r === 0) log(`${who}嘟囔着：“油……油炸豆腐……！”`);
        else if (r === 1) log(`${who}嘟囔着：“还想再吃！！”`);
        else if (r === 2) log(`${who}嘟囔着：“油炸豆腐天下第一……！”`);
        else log(`${who}露出了让人安心的幸福表情……`);
        c.set(79, 17 + 100 * 3);
        if ((c.get(433) | 0) < 5) c.set(433, (c.get(433) | 0) + 5);
      }
    }

    // 1136: 以太饼干（减轻以太病侵蚀值）
    if (id === 1136 && isPlayer) {
      if (g.playSnd) g.playSnd(64);
      log('以太之根开始从你的体内消融……（以太病侵蚀度减轻）');
      if (Elona.Weather && Elona.Weather.modCorrupt) {
        Elona.Weather.modCorrupt(g, -1000);
      } else {
        const cur = g.getV65 ? g.getV65(85) | 0 : 0;
        if (g.setV65) g.setV65(85, Math.max(0, cur - 1000));
      }
    }

    // 1071: 乾面包（口渴无水时变胖增重）
    if (id === 1071) {
      if (!hasItemInInv(c, 1114)) { // 1114 为水壶/饮料
        if (!isPlayer) {
          log(`${who}：“太干了！！”`);
        }
        const curWeight = limit(c.get(20) | 0, 1, 100000000);
        const addWeight = idiv(curWeight * (f20 + 1), 100) + f20 + 1;
        c.set(20, curWeight + addWeight);
        log(`${who}变胖了（体重：${c.get(20)}kg）。`);
      }
    }

    // 889: 手制巧克力
    if (id === 889) {
      if (f27 === 2) {
        // 媚药巧克力
        if (!isPlayer) {
          if (g.playSnd) g.playSnd(117);
          if (Elona.Resist && g.dmgconTable) Elona.Resist.dmgcon(g, g.dmgconTable, c, 12, 200);
        }
      } else {
        if (g.playSnd) g.playSnd(113);
      }
      if (f27 === 5) {
        // 激辛/爆炸巧克力
        const maxHp = c.get(51) | 0;
        const dmg = limit(idiv(maxHp * 10, 100), 1, 999);
        if (Elona.Battle && Elona.Battle.applyDamage) {
          Elona.Battle.applyDamage(c, dmg, g);
        } else {
          c.set(50, Math.max(0, (c.get(50) | 0) - dmg));
        }
        log(isPlayer ? '哇啊啊啊啊啊！！！（巧克力的辛辣引发了冲击）' : '简直是恶魔的炸药包！！');
      }
      if (f27 === 1) {
        // 异物巧克力（毛发、指甲）
        log('巧克力里混杂着毛发和指甲……');
        if (Elona.Resist && g.dmgconTable) {
          Elona.Resist.dmgcon(g, g.dmgconTable, c, 11, 200); // 混乱
          if (g.rng && g.rng.rnd(5) === 0) {
            Elona.Resist.dmgcon(g, g.dmgconTable, c, 9, 200); // 恐惧/狂乱
          }
        }
      }
      if (f27 === 3 && !isPlayer) {
        log(`味道有些微妙，${who}不由自主地咀嚼着。`);
      }
    }

    // 755: 年糕（縁起物，魅力经验 +3000）
    if (id === 755) {
      log('这食物感觉很吉利！');
      if (Elona.Stats && Elona.Stats.skillMod) {
        Elona.Stats.skillMod(c, 19, c.index | 0, 3000, g);
      }
    }

    // 1107, 1108: 团子 / 月见团子（魅力经验 +2000）
    if (id === 1107 || id === 1108) {
      if (Elona.Stats && Elona.Stats.skillMod) {
        Elona.Stats.skillMod(c, 19, c.index | 0, 2000, g);
      }
    }

    // 702: 肉包（魅力经验 +1000）
    if (id === 702) {
      if (Elona.Stats && Elona.Stats.skillMod) {
        Elona.Stats.skillMod(c, 19, c.index | 0, 1000, g);
      }
    }

    // 639: 魅力大增食材（魅力经验 +20000）
    if (id === 639) {
      if (Elona.Stats && Elona.Stats.skillMod) {
        Elona.Stats.skillMod(c, 19, c.index | 0, 20000, g);
      }
    }

    // 655: 筋力食材（力量经验 +3000）
    if (id === 655) {
      if (Elona.Stats && Elona.Stats.skillMod) {
        Elona.Stats.skillMod(c, 2, c.index | 0, 3000, g);
      }
    }

    // 662: 耐久食材（体质经验 +3000）
    if (id === 662) {
      if (Elona.Stats && Elona.Stats.skillMod) {
        Elona.Stats.skillMod(c, 3, c.index | 0, 3000, g);
      }
    }

    // 867: 迷幻菇（ハルシノキノコ）—— 精神耐性+50、混乱80、狂气降低
    if (id === 867) {
      log(`${who}目光呆滞。`);
      if (Elona.Resist && Elona.Resist.resistModH) {
        const res = Elona.Resist.resistModH(c, 54, 50);
        if (res && res.message) log(res.message);
      }
      if (Elona.Resist && g.dmgconTable) {
        Elona.Resist.dmgcon(g, g.dmgconTable, c, 11, 80);
      }
      const sanDmg = (g.rng ? g.rng.rnd(10) : 5) + 50;
      if (Elona.Status && Elona.Status.dmgsan) {
        Elona.Status.dmgsan(c, sanDmg, g);
      }
    }

    // 932: 毒蘑菇 —— 精神受挫
    if (id === 932) {
      log(`${who}感到头晕目眩。`);
      const sanDmg = (g.rng ? g.rng.rnd(10) : 2) + 1;
      if (Elona.Status && Elona.Status.dmgsan) {
        Elona.Status.dmgsan(c, sanDmg, g);
      }
    }

    // 667: 甜点心 —— 治愈心灵
    if (id === 667) {
      log(`${who}的心灵被治愈了。`);
      if (Elona.Status && Elona.Status.healsan) {
        Elona.Status.healsan(c, 30);
      }
    }

    // 952: 魔法料理 —— 圣佑、加速、回血
    if (id === 952) {
      log(`温柔的魔力包裹了${who}的身体。`);
      if (g.playSnd) g.playSnd(88);
      if (Elona.Status && Elona.Status.addbuff) {
        Elona.Status.addbuff(g, c, 30, 2500, 15, c);
        Elona.Status.addbuff(g, c, 3, 500, 15, c);
      }
      const maxHp = c.get(51) | 0;
      const curHp = c.get(50) | 0;
      c.set(50, Math.min(maxHp, curHp + idiv(maxHp, 8) + 1));
      c.set(259, (c.get(259) | 0) + 50);
    }

    // 848: 衰老草 —— 年龄老化
    if (id === 848) {
      let ageDelta = 0;
      if (f17 <= -1) {
        ageDelta = (g.rng ? g.rng.rnd(20) : 10) + 10;
      } else if (f17 === 0) {
        ageDelta = (g.rng ? g.rng.rnd(200) : 100) + 100;
      } else {
        ageDelta = (g.rng ? g.rng.rnd(2000) : 1000) + 1000;
      }
      c.set(21, (c.get(21) | 0) - ageDelta); // HSP 中 var_58(21) 为出生年份，减少等于年龄增加
      log(`${who}一下子衰老了。`);
    }

    // 849: 返老草 —— 年龄年轻化
    if (id === 849) {
      const curYear = g.getV65 ? (g.getV65(10) | 0) : 517;
      let minAge = 0;
      if (f17 <= -1) minAge = 10;
      else if (f17 === 0) minAge = 6;
      else minAge = 0;

      // 增加出生年等于年轻化，但不可小于 minAge
      let newBirthYear = (c.get(21) | 0) + 9999999;
      if (newBirthYear + minAge > curYear) {
        newBirthYear = curYear - minAge;
      }
      c.set(21, newBirthYear);
      log(`${who}变年轻了。`);
    }

    // 1040: 幼体料理 —— 身高体重缩小
    if (id === 1040) {
      if (!hasItemInInv(c, 1114)) {
        const curHeight = c.get(19) | 0;
        const curWeight = c.get(20) | 0;
        c.set(19, idiv(curHeight + 150, 2));
        c.set(20, idiv(curWeight + 40, 2));
        log(`吃完的瞬间，${who}的身体仿佛一下子缩小了。`);
      }
    }

    // 852: 性转料理 —— 祝福性转
    if (id === 852) {
      if (f17 === 1) { // 祝福时性转
        let curSex = c.get(8) | 0; // 0 男, 1 女
        let newSex = curSex === 0 ? 1 : 0;
        c.set(8, newSex);
        if (c.sex !== undefined) c.sex = newSex;
        log(`${who}性转了！`);
      }
    }

    // 料理成就计数（玩家有效）：260, 258, 787, 633
    if (isPlayer) {
      if ((id === 260 && f26 > 0) || id === 258 || id === 787) {
        if (g.setV65) g.setV65(292, (g.getV65(292) | 0) + 1); // var_65(250 + 42)
      }
      if (id === 633) {
        if (g.setV65) g.setV65(293, (g.getV65(293) | 0) + 1); // var_65(250 + 43)
      }
    }

    return { ok: true, messages };
  };

  /**
   * 判断是否属于特殊食材/料理（具有食用固有效果）
   */
  IngredientFX.hasSpecialEffect = function (itemId) {
    const s = [1082, 1136, 1071, 889, 755, 1107, 1108, 702, 639, 655, 662, 867, 932, 667, 952, 848, 849, 1040, 852, 260, 258, 787, 633];
    return s.indexOf(itemId | 0) >= 0;
  };

  Elona.IngredientFX = IngredientFX;

})(typeof window !== 'undefined' ? window : global);
