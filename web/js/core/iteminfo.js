'use strict';
/**
 * 道具的知识窗（アイテムの知識）—— core/iteminfo.js
 *
 * 【源码依据】
 *   300264       窗口标题 lang("アイテムの知識", "Known Information") + var_345 + var_343
 *   300266-300286 display_window (var_216-600)/2, winposy(408), 600, 408
 *                 display_topic itemname(var_579) → 15 行 × 18px，每行 `var_484` 图标 + `var_485` 文本
 *   299523-299960 *label_2833 的情报组装：
 *     · var_99(8) >= 3（完全鉴定）→ 风味文本（var_488(3) / 自定义 planN.txt 的 %txtFlavor）
 *     · var_99(8) >= 2 → 材质、抗酸/抗火/抗冷、贵重、祝福、赃物、活着[Lv/Exp]、
 *                        展示厅、手工、武器 (XdY 贯通 N%)、轻/重、命中·伤害修正、DV/PV
 *     · var_99(8) <  2 → 「このアイテムに関する知識を得るには、鑑定する必要がある。」
 *     · var_99(8) >= 3 → 15 条附魔 + ibit(15)「相手は死ぬ」+ 4 行鉴定报告
 *     · 一条都没有 → 「特に情報はない」
 *   300205-300250 长行按 66 全角字符折行；最后一行 var_484 = -2 → 右对齐（风味出处）
 *   300296-300320 行图标 `gcopy 3, 72 + type*24, 336, 24, 24`；颜色表：
 *                 type 1 (0,100,0) 2 (0,0,100) 3 (80,100,0) 4 (80,50,0)
 *                 8 (0,100,100) 9 (180,0,0) 其余 (0,0,0)
 *
 * 【本项目】
 *   `build(g, it)` 只产出**未折行**的逻辑行（{icon, text, align}），
 *   折行与分页交给 renderer（需要 canvas 的 measureText 才能按中文字宽算）。
 *   附魔文本移植自 `*label_0336`（26365-28000），见 `enchantText()`。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));

  /** var_81(50..60)：元素名（下标 = 元素 id - 50） */
  const ELEM = ['火焰', '冷气', '电击', '暗黑', '幻惑', '毒', '地狱', '音', '神经', '混沌', '魔法'];
  const elemName = (id) => ELEM[(id | 0) - 50] || '';

  /** putenclv(26208)：abs(n)+1 颗星，超过 5 颗改用 "+" */
  function stars(power) {
    const n = Math.abs(power | 0);
    let s = '';
    for (let i = 0; i < n + 1; i++) {
      if (i > 4) { s += '+'; break; }
      s += '*';
    }
    return s;
  }

  /** 名字查询：元素 50..60 → ELEM；法术/能力 → actions.json；技能 → skills.json */
  let SKILL_NAMES = null;
  function skillName(id) {
    if (Elona.NPC && Elona.NPC.skillName) {
      const s = Elona.NPC.skillName(id);
      // npc.skillName 对未知 id 会返回占位串 "skill N"，这里不能当名字用
      if (s && !/^skill \d+$/.test(s)) return s;
    }
    if (!SKILL_NAMES && Elona.Data && Elona.Data.tableSync) {
      try {
        const t = Elona.Data.tableSync('skills');
        SKILL_NAMES = (t && t.skillNames) || {};
      } catch (e) { SKILL_NAMES = {}; }
    }
    const e = SKILL_NAMES && SKILL_NAMES[String(id | 0)];
    return e ? (e.ch || e.jp || e.en || '') : '';
  }
  function nameOf(id) {
    const n = id | 0;
    if (n >= 50 && n <= 60) return elemName(n);
    if (n >= 400) {
      const a = Elona.Spell && Elona.Spell.actionName ? Elona.Spell.actionName(n) : null;
      if (a) return a.ch || a.en || a.jp || String(n);
    }
    const s = skillName(n);
    if (s) return s;
    return String(n);
  }

  let MATERIALS = null;
  function materialName(id) {
    const m = id | 0;
    if (Elona.Material && Elona.Material.def) {
      const d = Elona.Material.def(m);
      if (d) return d.nameJp || d.nameEn || '';
    }
    if (!MATERIALS && Elona.Data && Elona.Data.tableSync) {
      try { MATERIALS = Elona.Data.tableSync('materials').materials || {}; }
      catch (e) { MATERIALS = {}; }
    }
    const d2 = MATERIALS && MATERIALS[String(m)];
    return d2 ? (d2.nameJp || d2.nameEn || '') : '';
  }

  const ibit = (it, bit) => (Elona.ItemDB && Elona.ItemDB.ibit ? Elona.ItemDB.ibit(bit, it) : 0);

  /**
   * 单条附魔 → { icon, text }（`*label_0336` 26365-28000 的移植）
   *   id 编码：`类型*10000 + 序号`；类型 0 = 特殊附魔（只有序号）
   *   icon：1 技能 / 2 属性 / 3 耐性 / 4 特殊·发动 / 8 守护 / 9 负面
   */
  function enchantText(it, encId, power) {
    const id = encId | 0;
    const pw = power | 0;
    const cat = (it && it.field657) || 0;
    const food = (cat === 57000 || cat === 64000);
    const type = idiv(id, 10000);
    const sub = id % 10000;

    if (type) {
      if (type === 1 || type === 10) {
        // 主能力：power/50+1 点
        const n = idiv(pw, 50) + 1;
        if (n < 0) {
          const t = food
            ? `含有使「${nameOf(sub)}」衰减的毒素`
            : `降低「${nameOf(sub)}」${-n}`;
          return { icon: 9, text: t + ' [' + stars(idiv(pw, 50)) + ']' };
        }
        const t = food
          ? `含有增强「${nameOf(sub)}」的营养`
          : `提升「${nameOf(sub)}」${n}`;
        return { icon: 2, text: t + ' [' + stars(idiv(pw, 50)) + ']' };
      }
      if (type === 2) {
        const lv = idiv(idiv(pw, 2), 50);
        if (idiv(pw, 2) < 0) {
          return { icon: 9, text: `削弱对「${nameOf(sub)}」的耐性 [${stars(lv)}]` };
        }
        return { icon: 3, text: `授予对「${nameOf(sub)}」的耐性 [${stars(lv)}]` };
      }
      if (type === 3) {
        const n = idiv(pw, 50) + 1;
        if (n < 0) {
          return { icon: 9, text: `降低「${nameOf(sub)}」技能 [${stars(idiv(n, 5))}]` };
        }
        return { icon: 1, text: `提升「${nameOf(sub)}」技能 [${stars(idiv(n, 5))}]` };
      }
      if (type === 6) {
        if (food) {
          return { icon: 8, text: `含有帮助锻炼「${nameOf(sub)}」的营养 [${stars(idiv(pw, 50))}]` };
        }
        return { icon: 8, text: `守护「${nameOf(sub)}」免于弱化` };
      }
      if (type === 7) {
        return { icon: 4, text: `给予「${elemName(sub) || nameOf(sub)}」属性的追加伤害 [${stars(idiv(idiv(pw, 2), 50))}]` };
      }
      if (type === 8) {
        return { icon: 4, text: `发动「${nameOf(sub)}」 [${stars(idiv(pw, 50))}]` };
      }
      if (type === 9) {
        const nm = Elona.ItemDB ? Elona.ItemDB.name(sub, 'jp') : String(sub);
        return { icon: 4, text: `可以装填「${nm}」 [最大${idiv(pw, 1000)}发]` };
      }
      return { icon: 4, text: `神秘的效果（${id}）` };
    }

    // ---- 特殊附魔（只有序号）----
    const SPECIAL = {
      0: () => '?????',
      21: () => `引起随机传送 [${stars(idiv(pw, 50))}]`,
      22: () => `减轻来自魔法的伤害 [${stars(idiv(pw, 50))}]`,
      23: () => `减轻来自火炎的伤害 [${stars(idiv(pw, 50))}]`,
      24: () => `减轻来自冷气的伤害 [${stars(idiv(pw, 50))}]`,
      25: () => `减轻来自电击的伤害 [${stars(idiv(pw, 50))}]`,
      26: () => `减轻来自黑暗的伤害 [${stars(idiv(pw, 50))}]`,
      27: () => `减轻来自幻惑的伤害 [${stars(idiv(pw, 50))}]`,
      28: () => `减轻来自毒性的伤害 [${stars(idiv(pw, 50))}]`,
      29: () => `减轻来自地狱的伤害 [${stars(idiv(pw, 50))}]`,
      30: () => `减轻来自音波的伤害 [${stars(idiv(pw, 50))}]`,
      31: () => `减轻来自神经的伤害 [${stars(idiv(pw, 50))}]`,
      32: () => `减轻来自混沌的伤害 [${stars(idiv(pw, 50))}]`,
      33: () => `减轻来自物理的伤害 [${stars(idiv(pw, 50))}]`,
      34: () => `减轻来自魔法的伤害 [${stars(idiv(pw, 50))}]`,
      35: () => '让你能看见隐形的东西',
      36: () => `吸收攻击对象的体力 [${stars(idiv(pw, 50))}]`,
      37: () => '让你漂浮起来',
      38: () => `吸收攻击对象的魔力 [${stars(idiv(pw, 50))}]`,
      39: () => '使你免于被寄生',
      40: () => '使你绝对不会迷路',
      41: () => `让你不会被雨淋湿 [${stars(idiv(pw, 50))}]`,
      42: () => `使你不容易感到饥饿 [${stars(idiv(pw, 50))}]`,
      43: () => '使你不会被催眠',
      44: () => `使你不容易入睡 [${stars(idiv(pw, 50))}]`,
      45: () => `吸取使用者的鲜血 [${stars(idiv(pw, 50))}]`,
      46: () => `妨碍你的成长 [${stars(idiv(pw, 50))}]`,
      47: () => `吸引魔物 [${stars(idiv(pw, 50))}]`,
      48: () => `减轻来自浑浊的伤害 [${stars(idiv(pw, 50))}]`,
      49: () => '使你免受变异的侵袭',
      50: () => `使你的生命力难以被夺走 [${stars(idiv(pw, 50))}]`,
      51: () => `使你的魔力难以被夺走 [${stars(idiv(pw, 50))}]`,
      52: () => `减轻来自毒·地狱·混沌的伤害 [${stars(idiv(pw, 50))}]`,
      53: () => `减轻来自火·冷气·电击的伤害 [${stars(idiv(pw, 50))}]`,
      54: () => `减轻来自黑暗·幻惑·神经的伤害 [${stars(idiv(pw, 50))}]`,
      55: () => `减轻来自音·魔法·浑浊的伤害 [${stars(idiv(pw, 50))}]`,
      56: () => `让你能看见远方的地图`,
      57: () => `让你能看见陷阱`,
      58: () => `使你的速度上升 [${stars(idiv(pw, 50))}]`,
      59: () => `使你的咏唱更难以被打断 [${stars(idiv(pw, 50))}]`,
      60: () => `使你的咏唱速度加快 [${stars(idiv(pw, 50))}]`,
      61: () => `使你的攻击更难以被回避 [${stars(idiv(pw, 50))}]`,
      62: () => `使你的攻击更容易命中 [${stars(idiv(pw, 50))}]`,
      63: () => `使你的必杀一击更容易出现 [${stars(idiv(pw, 50))}]`,
      64: () => `提升你使用魔道具的能力 [${stars(idiv(pw, 50))}]`,
      65: () => `使你的射击更准确 [${stars(idiv(pw, 50))}]`,
      66: () => `使你的演奏更动听 [${stars(idiv(pw, 50))}]`,
      67: () => `使你的举重能力上升 [${stars(idiv(pw, 50))}]`,
      68: () => `使你的回避能力上升 [${stars(idiv(pw, 50))}]`,
      69: () => `使你的防御能力上升 [${stars(idiv(pw, 50))}]`,
      70: () => `使你的魔力上升 [${stars(idiv(pw, 50))}]`,
      71: () => `使你的体力上升 [${stars(idiv(pw, 50))}]`,
      72: () => `吸取使用者的魔力 [${stars(idiv(pw, 50))}]`,
      73: () => `让你能看见怪物的弱点`,
      74: () => `使你更容易被魔物盯上 [${stars(idiv(pw, 50))}]`,
      75: () => `使你更容易发现道具`,
      76: () => `使你不会被偷盗`,
      77: () => `使你的经验值更容易增加 [${stars(idiv(pw, 50))}]`,
      84: () => `使你不容易积累疲劳 [${stars(idiv(pw, 50))}]`,
      85: () => `使你的信仰心不易动摇 [${stars(idiv(pw, 50))}]`,
    };
    const f = SPECIAL[id];
    if (f) return { icon: 4, text: f() };
    return { icon: 4, text: `蕴含着未知的力量 [${stars(idiv(pw, 50))}]` };
  }

  /** 风味文本 → 行（末行 `#～…～` 右对齐，300232-300250） */
  function flavorLines(it) {
    const e = Elona.ItemDB ? Elona.ItemDB.eq(it.id) : null;
    const d = (e && e.desc) || {};
    let txt = d.ch0 || d.jp0 || d.en0 || '';
    if (!txt) return [];
    txt = String(txt).replace(/\\n/g, '\n');
    // 汉化 desc 用 <i>…</i> 包住「出处」，原版是换行 + 以 # 开头的右对齐行
    const m = /<i>([\s\S]*?)<\/i>/.exec(txt);
    if (m) txt = txt.replace(m[0], '\n#' + m[1]);
    txt = txt.replace(/<\/?i>/g, '');
    const out = [];
    const segs = txt.split('\n');
    for (let i = 0; i < segs.length; i++) {
      let s = segs[i].replace(/\t/g, '');
      if (!s) continue;
      const hash = s.charAt(0) === '#';
      if (hash) s = s.slice(1);
      out.push({ icon: 7, text: s, align: hash ? 'right' : 'left' });
    }
    return out;
  }

  /**
   * 组装情报行。
   * @param {object} g
   * @param {object} it 物品实例
   * @returns {{name:string, lines:Array<{icon:number,text:string,align?:string}>}}
   */
  function build(g, it) {
    const out = { name: '', lines: [] };
    if (!it) return out;
    const D = Elona.ItemDB;
    const ident = it.f[8] | 0;
    out.name = D ? D.instanceName(it, 'jp') : '';
    if ((it.f[0] | 0) > 1) out.name = `${it.f[0] | 0} ${out.name}`;

    // ---- 1) 完全鉴定：风味文本（var_99(8) >= 3）----
    if (ident >= 3) out.lines.push(...flavorLines(it));

    // ---- 2) 部分鉴定以的上基础情报（var_99(8) >= 2）----
    if (ident >= 2) {
      const mat = it.f[24] | 0;
      if (mat) {
        const mn = materialName(mat);
        if (mn) out.lines.push({ icon: 7, text: `它是用「${mn}」制成的` });
        if (mat === 8) out.lines.push({ icon: 7, text: '装备期间会加速以太病的进展' });
      }
      if (ibit(it, 1) && (it.field657 | 0) !== 52000) out.lines.push({ icon: 7, text: '它不会被酸腐蚀' });
      if (ibit(it, 2)) out.lines.push({ icon: 7, text: '它不会被火焰烧毁' });
      if (ibit(it, 3)) out.lines.push({ icon: 7, text: '它不会被冷气冻碎' });
      if (ibit(it, 5)) out.lines.push({ icon: 7, text: '它是贵重的物品' });
      if (ibit(it, 8)) out.lines.push({ icon: 7, text: '它受到了艾赫卡托尔的祝福' });
      if (ibit(it, 9)) out.lines.push({ icon: 7, text: '它是赃物' });
      if (ibit(it, 10)) {
        const lv = it.f[25] | 0, ex = it.f[26] | 0;
        let pct = 0;
        if (Elona.ItemDB && Elona.ItemDB.calcExpAlive) {
          const need = Elona.ItemDB.calcExpAlive(lv) || 1;
          pct = Math.max(0, Math.min(100, idiv(ex * 100, need)));
        }
        out.lines.push({ icon: 7, text: `它是活着的 [Lv:${lv} Exp:${pct}%]` });
      }
      if (ibit(it, 16)) out.lines.push({ icon: 7, text: '它只能在展示厅里使用' });
      if (ibit(it, 17)) out.lines.push({ icon: 7, text: '它是充满心意的手工制品' });

      const dx = it.f[10] | 0, dy = it.f[11] | 0;
      if (dx) {
        // 贯通率：var_1016（calcweaponfix 之后的复合值）。本项目没有该全局量时按 0 显示。
        const pierce = (it.pierce | 0);
        out.lines.push({ icon: 5, text: `它可以作为武器使用（${dx}d${dy} 贯通 ${pierce}%）` });
        const cat = it.field657 | 0;
        if (cat === 10000) {
          if ((it.f[7] | 0) <= 1500) out.lines.push({ icon: 5, text: '它很轻，单手也很容易使用' });
          if ((it.f[7] | 0) >= 4000) out.lines.push({ icon: 5, text: '它很适合双手持握' });
        }
      }
      const hit = it.f[13] | 0, dmg = it.f[12] | 0;
      if ((hit !== 0 || dmg !== 0) && (it.id | 0) !== 240) {
        out.lines.push({ icon: 5, text: `它使命中修正增加 ${hit}，使伤害增加 ${dmg}` });
      }
      const dv = it.f[14] | 0, pv = it.f[15] | 0;
      if (dv !== 0 || pv !== 0) {
        out.lines.push({ icon: 6, text: `它使 DV 上升 ${dv}，使 PV 上升 ${pv}` });
      }
    }

    // ---- 3) 未鉴定（var_99(8) < 2）----
    if (ident < 2) {
      out.lines.push({ icon: 0, text: '要获得关于这件道具的知识，必须先鉴定它。' });
    }

    // ---- 4) 完全鉴定：附魔与鉴定报告（var_99(8) >= 3）----
    if (ident >= 3) {
      for (let n = 0; n < 15; n++) {
        const eid = it.f[40 + n * 2] | 0;
        if (eid === 0) break;
        const t = enchantText(it, eid, it.f[41 + n * 2]);
        out.lines.push({ icon: t.icon, text: `它${t.text}` });
      }
      if (ibit(it, 15)) out.lines.push({ icon: 4, text: '对手会死' });
      // 4 行「鉴定报告」（var_488(0..3) → desc.ch3）
      const e = D ? D.eq(it.id) : null;
      const d = (e && e.desc) || {};
      const rep = d.ch3 || d.jp3 || d.en3 || '';
      if (rep) {
        for (const seg of String(rep).replace(/\\n/g, '\n').split('\n')) {
          const s = seg.replace(/\t/g, '').replace(/^#/, '');
          if (s) out.lines.push({ icon: 7, text: s, align: /^#/.test(seg) ? 'right' : 'left' });
        }
      }
    }

    if (!out.lines.length) out.lines.push({ icon: 0, text: '没有特别的情报' });
    return out;
  }

  Elona.ItemInfo = { build, enchantText, flavorLines, stars, ELEM, elemName, nameOf, materialName };
})(window);
