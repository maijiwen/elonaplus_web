'use strict';
/**
 * 物品模块 —— 对应原版 refitem / iequiploc / itemcreate / cnvitemname
 *
 * 【已确认】物品数据分两张表（均由 tools/extract_items.py 从 start.hsp 提取）：
 *   1) 名称表 *label_1936 (行 172273)：var_54(id)=名称, var_55(id)=英文前缀,
 *      var_53(id)=别名, var_438(id)=基础价值, var_1015(id)=外观图号, var_705(id)=分类值
 *   2) 数据表 *label_1934 (行 81187)：按 var_59 分模式
 *        2 = 名称/鉴定相关, 3/10 = 创建默认值, 16 = 按 var_61 字段查询, 17 = 说明文本
 *
 * 【已确认】物品实例数组 var_99(字段, 物品索引)：
 *   [0] 数量/存在   [2] 外观图号   [3] 物品ID   [7] 重量   [16] 图块/外观
 *   [19]/[25]/[26] 食物相关(见 foodname 调用)  [21] 所有者/所在地
 *   [29] 附加数值   [40+2n]/[40+2n+1] 附魔列表(见 equipinfo)
 *   其余【未确认】，保留原值。
 *
 * 【已确认】var_99(7) = 重量（inv_weight 29738 用 `var_99(7)*var_99(0)` 求和；
 *   applyEquipment 213587 用 `(var_99(7)+1)/5000` 作防具 DV 加成）。
 *   物品价值由 calcitemvalue(214124) 从 var_99(1) 与名称表 var_438 计算，不是字段 7。
 *
 * 【已确认】装备位置 iequiploc (行 6357)：由 refitem(id, 5) 的装备类别映射到槽位 1..11。
 * 身体槽顺序来自种族数据 var_121：頭|首|体|背|手|手|指|指|腕|腰|足
 *
 * 【未确认】字段 7/8/9/18/19/20 的精确含义（仅 5=装备类别、19=保存期限相关可确认）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const TILE = 48, COLS = 33;   // item.bmp 为 33 列 × 48px 的图标表
  // 0-DF：大件图标的 graphic 集合（高度 96），由 data/tables/item_icons.json 注入
  let ICON_TALL = null;
  let ICON_TALL_H = 96;
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));   // HSP 整除（向零截断）
  const mod = (a, b) => (b === 0 ? 0 : (a % b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  // 附魔静态表（tools/extract_enchant.py → enchant.json）
  let ENCHANT = null;

  // 装备类别 -> 槽位（逐字对应 iequiploc 行 6357-6395）
  const EQUIP_LOC = {
    12000: 1, 34000: 2, 20000: 3, 16000: 4, 10000: 5, 14000: 5,
    32000: 6, 22000: 7, 18000: 9, 24000: 10, 25000: 11, 19000: 8,
  };

  /**
   * 进化道具（869）的种类名 —— 222119 的 `var_722 = …` 表，索引 = `var_99(25)`。
   *   0..10 = 残りカス（未定义的档位），11..16 依次为六种「秘宝」心。
   *   原版 `var_719 += lang("" + var_722(n), " <" + var_722(n) + ">")`：
   *   物品本体名（`var_54(869) = ""`）为空，所以**显示名就是这张表**。
   */
  const HEART_NAMES = {
    0: ['残渣', 'remnant'],
    11: ['王之器', 'king heart'],
    12: ['机械之魂', 'machine heart'],
    13: ['约洛特奥托尔', 'god heart'],
    14: ['进化侧枝', 'another heart'],
    15: ['进化导石', 'evolution heart'],
    16: ['魔族角饰', 'magic heart'],
  };

  const ItemDB = {
    data: null,

    async load() {
      if (this.data) return this.data;
      this.data = (await Elona.Data.table('items')).items;
      return this.data;
    },

    eq(id) { return this.data ? this.data[String(id)] : null; },

    /** 对应 refitem(id, field)：按字段号查询，缺省 0 */
    ref(id, field) {
      const e = this.eq(id);
      if (!e) return 0;
      const v = e.fields[String(field)];
      return v === undefined ? 0 : v;
    },

    /** 对应 iequiploc(物品索引)：按物品实例的 id 得到装备槽位，0 = 不可装备 */
    equipLocById(id) { return EQUIP_LOC[this.ref(id, 5)] || 0; },

    /**
     * 物品名（cnvitemname）。
     * 第一个参数可传**物品实例**或物品 id：实例才可能带「钓鱼表下标」这类个体信息。
     */
    name(idOrItem, lang) {
      if (idOrItem && typeof idOrItem === 'object') return this.instanceName(idOrItem, lang);
      const e = this.eq(idOrItem);
      if (!e) return '(未知物品)';
      if (lang === 'jp') return e.nameCh || e.nameJp || e.nameEn || '';
      if (e.prefixEn) return e.prefixEn + ' of ' + (e.nameCh || e.nameEn || '');
      return e.nameCh || e.nameEn || e.nameJp || '';
    },

    /**
     * 实例名 —— 原版 itemname 30189-30196：
     *   `var_99(3)==618 | 619` 且字段 23 在 0..120 内时，名称取钓鱼表 var_693(字段 23)，
     *   而不是物品名表里的名字（618/619 是「鱼」「垃圾」的通用物品）。
     */
    instanceName(it, lang) {
      if (!it) return '';
      // 字段 23 >= 10000 时是「エゴ / 品质前缀」（*label_0348/0349），前缀 + 基础名
      const f23 = (it.f && it.f[23]) | 0;
      const pre = (Elona.Ego && f23 >= 10000 && Elona.Ego.prefixOf) ? Elona.Ego.prefixOf(it, lang) : '';
      let body = this._instanceBody(it, lang);
      // 0-GK / 30540-30565：`var_99(24)` 材质 → 「<材质>細工の / <material>work / <材质>制」
      //   1061（野花）且材质 35、以及 630 的 1000/1001 档由 ItemMaterial 内部排除。
      if (Elona.ItemMaterial && Elona.ItemMaterial.workPrefix) {
        const wp = Elona.ItemMaterial.workPrefix(it, lang);
        if (wp) body = wp + body;
      }
      // 0-GN / 29922-30168 `*label_0405`：型号 / 书名 / 饮品等特殊名称片段。
      //   源码在 30534-30536 先于材质前缀累加，因此这里也放在最外层。
      if (Elona.ItemNameExtra && Elona.ItemNameExtra.prefix) {
        const ex = Elona.ItemNameExtra.prefix(it, lang);
        if (ex) body = ex + body;
      }
      // 0-GT / *label_0407（30951-31190）：强化值 / LV / 充能 / 装弹数 / 变体名 / 骰子等后缀
      if (Elona.ItemNameExtra && Elona.ItemNameExtra.suffix) {
        const sfx = Elona.ItemNameExtra.suffix(it, lang);
        if (sfx) body += sfx;
      }
      // 31217-31221：92000 货物带仕入值 → 后缀「(仕入れ値 Xg)」
      let cat = it.field657 | 0;
      if (!cat) {
        // 只装了部分物品表的调用方（部分测试桩）可能查不到 id，退回 0 而不是抛错
        try { cat = this.ref(it.id | 0, 5) | 0; } catch (e) { cat = 0; }
      }
      if (cat === 92000 && (it.f[26] | 0) !== 0) {
        body += lang === 'jp'
          ? `(仕入れ値 ${it.f[26] | 0}g)`
          : ` (Buying price: ${it.f[26] | 0}g)`;
      }
      // 30458-30465：样柜台（ibit 21）→ 前缀「見本用の / sample 」
      if (this.ibit(21, it) === 1) {
        body = lang === 'jp' ? ('見本用の' + body) : ('sample ' + body);
      }
      if (!pre) return body;
      return lang === 'jp' ? pre + body : `${body} ${pre}`;
    },

    /** 去掉 ego/品质前缀后的本体名（原 instanceName 的逻辑） */
    _instanceBody(it, lang) {
      if (!it) return '';
      // 卵(573)/乳(574)/フン(575)：名称 = 「<生物名>の<物品名>」（itemname 30198-30224）
      if ((it.id | 0) === 573 || (it.id | 0) === 574 || (it.id | 0) === 575) {
        const cid = it.f[23] | 0;
        const base = this.name(it.id, lang);
        if (cid > 0 && Elona.CharaFactory && Elona.CharaFactory.ref) {
          const rec = Elona.CharaFactory.ref(cid);
          const nm = rec ? ((rec.nameCh || '') || (lang === 'jp' ? (rec.nameJp || '') : (rec.nameEn || ''))) : '';
          if (nm) return lang === 'jp' ? `${nm}の${base}` : `${base} of ${nm.toLowerCase()}`;
        }
        return base;
      }
      // 暗の棺 (903)：名称后缀显示死灵种类（31085-31131）
      //   「闇の棺(猫ゾンビ)」；材质 12000..18000 时追加「-欺繕」
      if ((it.id | 0) === 903 && Elona.Necro && Elona.Necro.coffinName) {
        const cn = Elona.Necro.coffinName(it, lang);
        if (cn) {
          const base = this.name(it.id, lang);
          return lang === 'jp' ? `${base}${cn.suffix}` : `${base} ${cn.suffix}`;
        }
      }
      // 进化道具（869）：物品本体名为空，显示名 = `var_722(f[25])`（29929-29931）。
      //   种类表取自 222119：0..10「残りカス」/ 11 王の器 / 12 マシンソウル /
      //   13 ヨロテオトル / 14 進化の側枝 / 15 進化の導石 / 16 魔族の角飾り。
      //   原版 jp 是「" + var_722(n)」（无空格、无前缀），en 是「" <name>"」。
      if ((it.id | 0) === 869) {
        const e = HEART_NAMES[it.f[25] | 0] || HEART_NAMES[0];
        return lang === 'en' ? e[1] : e[0];
      }
      if ((it.id | 0) === 618 || (it.id | 0) === 619) {
        const idx = it.f[23] | 0;
        const F = Elona.Fishing;
        const list = (F && F.entries) ? F.entries() : null;
        if (list && idx >= 0 && idx < list.length) {
          const e = list[idx];
          return lang === 'jp' ? (e.nameJp || e.nameEn || '') : (e.nameEn || e.nameJp || '');
        }
        return '(钓获物)';
      }
      // 0-EZ / 源码 itemname 30169-30172：已烹饪的食材（f[26]>0）按
      //   foodname(f[25]/1000, 基础名, f[26], f[23]) 显示料理名。
      //   项目此前整段未接线，只显示食材原名；现在按 wiki 中文表替换。
      //   放在特殊命名分支之后，避免覆盖 573/574/575「<生物名>の…」与钓获物名。
      if (it.f && (it.f[26] | 0) > 0 && Elona.FoodName) {
        const cat = Math.trunc((it.f[25] | 0) / 1000);
        const dish = Elona.FoodName.of(cat, it.f[26] | 0, this.name(it.id, lang), lang);
        if (dish) return dish;
      }
      return this.name(it.id, lang);
    },

    desc(id, lang) {
      const e = this.eq(id);
      if (!e) return '';
      const d = e.desc || {};
      // 汉化：desc 的 ch0..ch3 优先（items.json 汉化版），缺条目回退 jp/en
      return lang === 'jp'
        ? ((d.ch3 || d.jp3 || d.en3) || '')
        : ((d.ch3 || d.en3 || d.jp3) || '');
    },

    /** 基础价值 var_438 */
    value(id) { const e = this.eq(id); return e ? (e.value || 0) : 0; },

    /**
     * 物品实际价值 —— 逐字移植 calcitemvalue (214124-214372)。
     *
     * @param {object} c   用于交渉技能 var_82(156) 与队伍加成
     * @param {object} it  物品实例
     * @param {number} mode prm_1043：0=买入价 1=卖出价 2=偷窃价 3=鉴定/其它
     * @param {object} [g] 需要 getV65 / charas
     * @param {object} [opt] { index=背包下标, var577=商店类型, var548=家具价格百分比 }
     * @returns {number} var_1411
     */
    calcValue(c, it, mode, g, opt) {
      opt = opt || {};
      const f = (n) => it.f[n] || 0;
      const id = f(3);
      const cat = this.ref(id, 5);                      // var_1410
      const v65 = (n) => (g && g.getV65) ? g.getV65(n) : 0;
      let r;                                            // var_1411

      // 214125-214149：基础价值
      if (f(8) === 0) {
        if (mode === 2) r = idiv(f(1) * 4, 10);
        else r = (v65(8) + (opt.index || 0) * 31) % 10 + 10;
      } else if (cat >= 50000) {
        r = f(1);
      } else if (f(8) === 1) {
        r = idiv(f(1) * 2, 10);
      } else if (f(8) === 2) {
        r = idiv(f(1) * 5, 10);
      } else {
        r = f(1);
      }

      // 214150-214154：未鉴定特殊道具
      if ((id === 1005 || id === 934 || id === 1069) && this.ibit(1, it) === 1) r = f(1) * 2;

      // 214155-214163：食物（类别 57000）
      if (cat === 57000) {
        r += f(20) * 300;
        if (f(26) > 0) r = idiv(f(26) * r, 10) * f(26);
        if (f(31) === 1) r = 1;
      }
      // 214164-214168：装备附魔等级
      if (cat >= 10000 && cat < 50000 && f(20) > 0) {
        r += limit(f(20) * f(20) * 200 * 3, 0, 60000);
      }
      // 214169-214219：特定道具的附加值
      if (id === 934 || id === 1069 || id === 1070) {
        if (f(20) > 0) r += (f(20) + 5) * (f(20) + 5) * 50;
      }
      if (id === 574 && f(20) > 0) r += (f(20) + 5) * (f(20) + 5) * 60;
      if (id === 337 && f(20) > 0) r += (f(20) + 5) * (f(20) + 5) * 100;
      if (id === 1061 && f(20) > 0) r += (f(20) + 5) * (f(20) + 5) * 100;
      if (id === 1124 && f(26) > 0) r += f(26) * 450;
      if (id === 1191 && f(26) > 0) r += f(26) * 30;
      if (id === 1272 && f(26) > 0) r += f(26) * 30;
      if (id === 1273 && f(26) > 0) r += f(26) * 60;
      if (id === 1130 && f(26) > 0) r *= limit(f(26) + 1, 1, 30);
      if (id === 1274) r += (f(26) + f(27) + f(31)) * 5;
      if (id === 1300) r += f(26) * 90;

      // 214220-214230：品质（祝福 / 诅咒 / 堕落）
      if (f(8) >= 3) {
        if (f(17) === 1) r = idiv(r * 6, 5);
        if (f(17) === -1) r = idiv(r, 2);
        if (f(17) === -2) r = idiv(r, 5);
      }
      // 214231-214235
      if (id === 333) {
        if (mode === 0) r += limit(idiv(c.get(34), 40) + idiv(r * idiv(c.get(34), 80), 100), 0, 800);
      }
      // 214236-214249：负重量（货币类）+ 商店类型 6 的家具浮动价（var_548 默认 100）
      if (f(7) < 0) {
        if ((opt.var577 | 0) === 6 && cat === 92000) {
          const pct = opt.var548 === undefined ? 100 : opt.var548;
          r = idiv(r * pct, 100);
          if (mode === 1) r = idiv(r * 75, 100);
          return r;
        }
      }
      // 214250-214265：ibit(4) 的随机价值
      if (this.ibit(4, it) === 1) {
        if (f(9) < 0) {
          r = idiv(r, 10);
        } else {
          const v1008 = opt.var1008 === undefined ? this.itemMode2(id, 1008) : opt.var1008;
          if (cat === 54000) r = idiv(r, 5) + idiv(r * f(9), v1008 * 2 + 1);
          else r = idiv(r, 2) + idiv(r * f(9), v1008 * 3 + 1);
        }
      }
      // 214266-214270
      if (cat === 72000 && f(25) === 0) r = idiv(r, 100) + 1;
      // 214271-214276
      if (r >= 2000000) r = 2000000;
      if (r === 0) r = 1;

      // 214277-214285：队伍中 cbit(1023) 成员的交渉加成（var_1412）
      let r1412 = 0;
      const charas = (g && g.charas) || [];
      for (let cnt = 1; cnt < 16; cnt++) {
        const o = charas[cnt];
        if (!o || o.get(0) !== 1) continue;
        if (Elona.Status && Elona.Status.cbit(o, 1023)) {
          r1412 = idiv(o.skill(156) + 1, 2);
          break;
        }
      }

      if (mode === 0) {                                  // 214288-214302
        const floor = idiv(r, 2);                        // var_1413
        r = idiv(r * 100, 100 + c.skill(156) + r1412);
        if (v65(263) !== 0 && cat === 54000) r = idiv(r * 80, 100);
        if (r <= floor) r = floor;
        if (id === 430) r = 3500000;
      }
      if (mode === 1) {                                  // 214303-214323
        let cap = (c.skill(156) + r1412) * 250 + 5000;
        if (idiv(r, 3) < cap) cap = idiv(r, 3);
        r = idiv(idiv(r, 20) * (20 + c.skill(156) + r1412), 10);
        if (cat < 50000) r = idiv(r, 20);
        if (this.ibit(9, it)) {
          if (v65(265) === 0) r = idiv(r, 10);
          else r = idiv(r, 3) * 2;
        }
        if (r >= cap) r = cap;
      }
      if (mode === 2) {                                  // 214324-214333
        r = idiv(r, 6);
        if (r > 300000) r = 300000;
        if (this.ibit(9, it)) r = 1;
      }
      if (mode === 3) {                                  // 214334-214364
        let cap = idiv(((c.skill(156) + r1412) * 250 + 5000) * 4, 5);
        if (idiv(r * 4, 15) < cap) cap = idiv(r * 4, 15);
        r = idiv(idiv(idiv(r, 20) * (20 + c.skill(156) + r1412), 10) * 4, 5);
        if (cat < 50000) r = idiv(r, 20);
        if (this.ibit(9, it)) {
          if (v65(265) === 0) r = idiv(r, 10);
          else r = idiv(r, 3) * 2;
        }
        if (cat === 57000 && f(24) === 35 && f(27) < 0) r = 1;
        if (this.ibit(5, it) === 1 || f(4) === 6) r = 1;
        if (r >= cap) r = cap;
      }
      if (r < -50000) r = 2000000;                       // 214365-214370
      if (r <= 0) r = 1;
      return r;
    },

    /** 读取 items.json 的 mode2 字段（var_59==2 的 var_1934 查询） */
    itemMode2(id, field) {
      const e = this.eq(id);
      if (!e || !e.mode2) return 0;
      const v = e.mode2['var_' + field];
      if (v === undefined) return 0;
      const n = evalExpr(v);
      return n === null ? 0 : n;
    },

    // ======================================================================
    // 附魔生成 —— randomenc / randomenclv / randomencp / encflt / encadd
    // （start.hsp 26194-26363 / 27709-27800 / 27825-27998 / 28095-28255）
    // ======================================================================
    setEnchant(t) { ENCHANT = t; },
    async loadEnchant() {
      if (!ENCHANT) ENCHANT = await Elona.Data.table('enchant');
      return ENCHANT;
    },

    /** encflt(cat, f)：类别过滤。f 为 0 表示无此条件 */
    encflt(cat, f) {
      if (f === 2) return (cat >= 12000 && cat < 24000) ? 1 : 0;
      if (f === 1) return (cat >= 30000 && cat < 50000) ? 1 : 0;
      if (f === 3) return ((cat >= 12000 && cat < 24000) || cat === 10000) ? 1 : 0;
      return cat === f ? 1 : 0;
    },

    /** randomele：按 var_83(4, id) 的权重在元素 50..60 中选一个 */
    randomele(g) {
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      let best = R(11) + 50;
      if (best !== 1) {
        const w = (id) => (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(id, 4) || 0) : 0;
        const reps = w(best);
        for (let i = 0; i < reps; i++) {
          const cand = R(11) + 50;
          if (w(cand) < w(best) && R(2) === 0) best = cand;
        }
      }
      return best;
    },

    /** randomenc(prm_542)：按等级/类别加权轮盘选附魔 id；返回 0 = 无候选 */
    randomenc(level, g, cat) {
      const T = ENCHANT && ENCHANT.enchants;
      if (!T) return 0;
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      let cum = 0;
      const cand = [];
      for (let id = 0; id < 86; id++) {
        const e = T[String(id)];
        if (!e) continue;
        if (e[0] > level) continue;
        if (level >= 0 && e[0] < 0) continue;
        const f3 = e[3] || 0, f4 = e[4] || 0, f5 = e[5] || 0;
        if (f3) {
          if (!this.encflt(cat, f3)) {
            if (!f4) continue;
            if (!this.encflt(cat, f4)) {
              if (!f5) continue;
              if (!this.encflt(cat, f5)) continue;
            }
          }
        }
        cum += (e[2] || 0);
        cand.push({ id, w: cum });
      }
      if (!cand.length) return 0;
      const r = R(cum);
      for (const c of cand) if (r < c.w) return c.id;
      return cand[cand.length - 1].id;
    },

    /** randomenclv(prm_543) */
    randomenclv(level, g) {
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      return R(limit(level, 0, 4) + 1);
    },

    /** randomencp(prm_544, feat163) */
    randomencp(mult, g, feat163) {
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      let v = R(R(500) + 1) + 1;
      if (!feat163) { if (R(5) === 0) v += R(51); }
      else v += R(51);
      if (mult) v = idiv(v * mult, 100) | 0;
      return v;
    },

    /** sortenc(prm_545)：附魔按 id 降序冒泡排序（27774-27800） */
    sortenc(it) {
      for (let guard = 0; guard < 20; guard++) {
        let moved = 0;
        for (let n = 0; n < 14; n++) {
          const a = 40 + n * 2, b = 40 + (n + 1) * 2;
          if (it.f[a] < it.f[b]) {
            const id = it.f[a], pw = it.f[a + 1];
            it.f[a] = it.f[b]; it.f[b] = id;
            it.f[a + 1] = it.f[b + 1]; it.f[b + 1] = pw;
            moved = 1;
          }
        }
        if (!moved) break;
      }
    },

    /** encadd(it, id, power, g, opt)：逐字移植 27825-27998 */
    encadd(it, id, power, g, opt) {
      opt = opt || {};
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      if (!id) return 0;
      const cat = it.field657 || 0;
      const T = ENCHANT && ENCHANT.enchants;
      const typeOf = (x) => (x >= 10000 ? idiv(x, 10000) : x);
      let def = T ? T[String(typeOf(id))] : null;
      // 27835-27862：类别过滤（prm_555 == 0）
      if (!opt.noFilter) {
        const f3 = def ? (def[3] || 0) : 0, f4 = def ? (def[4] || 0) : 0, f5 = def ? (def[5] || 0) : 0;
        if (f3) {
          if (!this.encflt(cat, f3)) {
            if (!f4) return 0;
            if (!this.encflt(cat, f4)) {
              if (!f5) return 0;
              if (!this.encflt(cat, f5)) return 0;
            }
          }
        } else if (cat === 25000) {
          if (!opt.prm553) return 0;
        }
      }
      let eid = id, pw = power | 0;
      // 27865-27952：类型 < 20 的随机化
      if (eid < 20) {
        if (eid === 1) {
          eid = R(10) + 10 + 10000;
          if (opt.p552 && R(100) < opt.p552) pw = -(power | 0);
        } else if (eid === 10) {
          eid = R(10) + 10 + 100000;
          if (opt.p552 && R(100) < opt.p552) pw = -(power | 0);
        } else if (eid === 2) {
          eid = this.randomele(g) + 20000;
          if (opt.p552 && R(100) < opt.p552) pw = -(power | 0);
        } else if (eid === 3) {
          eid = R(41) + 150 + 30000;
          if (opt.p552 && R(100) < opt.p552) pw = -(power | 0);
        } else if (eid === 6) {
          eid = R(10) + 10 + 60000;
        } else if (eid === 7) {
          eid = this.randomele(g) + 70000;
        } else if (eid === 8) {
          const S = ENCHANT && ENCHANT.specials;
          if (!S) return 0;
          let cum = 0; const cand = [];
          for (let i = 0; i < 28; i++) {
            const e = S[String(i)];
            if (!e) continue;
            const f3 = e[3] || 0, f4 = e[4] || 0;
            if (f3) {
              if (!this.encflt(cat, f3)) {
                if (!f4) continue;
                if (!this.encflt(cat, f4)) continue;
              }
            }
            cum += (e[2] || 0);
            cand.push({ id: i, w: cum });
          }
          if (!cand.length) return 0;
          const r = R(cum);
          let pick = cand[cand.length - 1].id;
          for (const c of cand) if (r < c.w) { pick = c.id; break; }
          eid = 80000 + pick;
        } else if (eid === 9) {
          const A = ENCHANT && ENCHANT.ammo;
          let k = R(R(6) + 1);
          if (R(10) === 0) k = 5;
          const a = (A && A[String(k)]) || [0, 0, 0];
          pw = idiv(limit(pw, 0, 500) * (a[1] || 0), 500) + (a[0] || 0);
          eid += 90000;
          pw += pw * 1000;
        }
      }
      // 27953-27979：槽位（同 id 合并 / 空槽）
      let slot = -1;
      for (let n = 0; n < 15; n++) {
        if (it.f[40 + n * 2] === eid) { slot = n; continue; }
        if (slot === -1 && it.f[40 + n * 2] === 0) slot = n;
      }
      if (slot === -1) return 0;
      if (it.f[40 + slot * 2] === eid) {
        if (cat === 25000) return 0;
        if (!opt.prm553) {
          if (it.f[40 + slot * 2 + 1] > 300 || this.ibit(5, it) === 1) pw = idiv(pw, 2);
        }
      }
      if (opt.prm554) { opt.out = [eid, pw]; return 0; }      // var_444
      if (it.f[40 + slot * 2] === eid) pw += it.f[40 + slot * 2 + 1];
      it.f[40 + slot * 2] = eid;
      it.f[40 + slot * 2 + 1] = pw;
      // 27988-27996：价值倍率
      const t = typeOf(id);
      const d2 = T ? T[String(t)] : null;
      const pct = d2 ? (d2[1] || 100) : 100;
      if (idiv((it.f[1] || 0) * pct, 100) > 0) it.f[1] = idiv((it.f[1] || 0) * pct, 100);
      this.sortenc(it);
      return 1;
    },

    /**
     * 负面附魔的每 25 回合结算 —— `*label_2294`（start.hsp 224094-224183）。
     * 由 604638-604651 在 `var_58(26) % 25 == 0` 时调用。
     *
     * 逐件装备（槽 100..129）逐条附魔：
     *   21 会导致随机的传送：rnd(25) < limit(|pw|/50,1,25) → 施放 408（传送自己）
     *   45 会吸取使用者的鲜血：1/4 → var_58(258) += |pw|/25 + 3（出血回合）
     *   72 会吸取使用者的MP：1/5 → var_58(445) += |pw|/50 + 3（魔漏回合）
     *   46 会妨碍使用者的成长：1/20 → var_58(35) -= var_58(36)/(300-limit(|pw|/2,0,50)) + rnd(100)
     *   47 会召唤魔物：rnd(50) < limit(|pw|/50,1,50) → 1+rnd(3) 只，等级 PC*3/2+3、品质 2
     * （21/47 在世界地图不触发：var_126(6)==1；47 在家/女仆馆也不触发：==5）
     *
     * @returns {Array<{kind:string}>}
     */
    negativeEnchant(g, c) {
      const out = [];
      if (!c || !c.f && !c.get) return out;
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      const inWorld = !!(g && g.worldMap);
      const isHome = !!(g && g.map && /home|servant/i.test(g.map.name || ''));
      for (let cnt = 100; cnt < 130; cnt++) {
        const v = c.get(cnt) | 0;
        if (idiv(v, 10000) === 0) continue;
        const idx = (v % 10000) - 1;
        const it = c.inv && c.inv[idx];
        if (!it || !it.f) continue;
        for (let n = 0; n < 15; n++) {
          const e = it.f[40 + n * 2] | 0;
          if (!e) break;
          const pw = Math.abs(it.f[40 + n * 2 + 1] | 0);
          if (e === 21) {
            if (!inWorld && R(25) < limit(idiv(pw, 50), 1, 25)) {
              if (Elona.Spell && Elona.Spell.cast) Elona.Spell.cast(g, c, 408, c);
              out.push({ kind: 'teleport' });
            }
          } else if (e === 45) {
            if (R(4) === 0) {
              c.set(258, (c.get(258) | 0) + idiv(pw, 25) + 3);
              out.push({ kind: 'bleed' });
            }
          } else if (e === 72) {
            if (R(5) === 0) {
              c.set(445, (c.get(445) | 0) + idiv(pw, 50) + 3);
              out.push({ kind: 'manaleak' });
            }
          } else if (e === 46) {
            if (R(20) === 0) {
              const div = 300 - limit(idiv(pw, 2), 0, 50);
              const d = idiv(c.get(36) | 0, div) + R(100);
              c.set(35, Math.max(0, (c.get(35) | 0) - d));
              out.push({ kind: 'exp-drain' });
            }
          } else if (e === 47) {
            if (!inWorld && !isHome && R(50) < limit(idiv(pw, 50), 1, 50)) {
              const fac = Elona.CharaFactory;
              const count = 1 + R(3);
              const lv = idiv((g.player ? (g.player.level | 0) : 1) * 3, 2) + 3;
              for (let k = 0; k < count; k++) {
                if (fac && fac.create) {
                  // calcobjlv(PC*3/2+3) + calcfixlv(2)
                  const m = fac.create(g, 0, lv, c.x, c.y, { var641: 2 });
                  if (m && Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(m, 964, 1);
                }
              }
              out.push({ kind: 'summon', count });
            }
          }
        }
      }
      return out;
    },

    /** encfind(c, id)：已装备物品中该附魔的最大强度 */
    encfind(c, id) {
      let best = -1;
      for (let cnt = 100; cnt < 130; cnt++) {
        const v = c.get(cnt);
        if (mod(v, 10000) === 0) continue;
        const idx = mod(v, 10000) - 1;
        const it = c.inv && c.inv[idx];
        if (!it) continue;
        for (let n = 0; n < 15; n++) {
          if (!it.f[40 + n * 2]) break;
          if (it.f[40 + n * 2] === id && it.f[40 + n * 2 + 1] > best) { best = it.f[40 + n * 2 + 1]; break; }
        }
      }
      return best;
    },

    /**
     * encfindpower(c, id) —— 29399-29415：**所有**装备上该附魔的强度**累加**（起始 -1）。
     * 与 encfind 的差别：encfind 取最大值，encfindpower 求和（复合咏唱 73/74/75/85 用它）。
     */
    encfindpower(c, id) {
      let total = -1;
      for (let cnt = 100; cnt < 130; cnt++) {
        const v = c.get(cnt);
        if (mod(v, 10000) === 0) continue;
        const idx = mod(v, 10000) - 1;
        const it = c.inv && c.inv[idx];
        if (!it) continue;
        for (let n = 0; n < 15; n++) {
          if (!it.f[40 + n * 2]) break;
          if (it.f[40 + n * 2] === id) total += it.f[40 + n * 2 + 1];
        }
      }
      return total;
    },

    /**
     * encfindspec(item, id) —— 29416-29427：单件物品上是否有该附魔（返回 1 / -1）。
     * 演奏附魔（49 召唤同伴品质、60 观众昏睡）用它判断乐器本身。
     */
    encfindspec(it, id) {
      if (!it || !it.f) return -1;
      for (let n = 0; n < 15; n++) {
        if (!it.f[40 + n * 2]) break;
        if (it.f[40 + n * 2] === id) return 1;
      }
      return -1;
    },

    /** *label_0350（28128-28255）：按品质生成随机附魔 */
    applyRandomEnchants(it, g, opt) {
      opt = opt || {};
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      const cat = it.field657 || 0;
      const sub = it.field677 || 0;
      const level = it.genLevel || 0;
      const fix = it.genFix || 0;
      const feat163 = (Elona.Feat && g && g.charas && g.charas[0])
        ? Elona.Feat.get(g.charas[0], 163) : 0;
      if (cat === 25000) it.f[9] = -1;
      if (fix <= 2) return;
      let spec;
      if (fix === 6) {
        spec = 4;
      } else {
        spec = R(limit(R(idiv(level, 10) + 3), 0, 4) + 1);
        it.f[1] = (it.f[1] || 0) * 3;
        it.f[29] = 50 + R(Math.abs(fix - 2) * 100 + 100);
      }
      if (sub === 10006 && fix !== 6) {
        if (R(10) === 0) this.encadd(it, 69, 100, g);
        if (R(10) === 0) this.encadd(it, 34, this.randomencp(0, g, feat163), g);
        if (R(10) === 0) this.encadd(it, 1 * 10000 + 16, this.randomencp(0, g, feat163), g);
        if (R(10) === 0) this.encadd(it, 3 * 10000 + 172, this.randomencp(0, g, feat163), g);
        else if (R(10) === 0) this.encadd(it, 1 * 10000 + 3, this.randomencp(0, g, feat163), g);
        else if (R(10) === 0) this.encadd(it, 3 * 10000 + 164, this.randomencp(0, g, feat163), g);
      }
      if ((it.f[3] === 60 || it.f[3] === 230) && R(10) === 0) this.encadd(it, 70, 300, g);
      if (fix < 4) {
        // 28175-28186：一半概率加「品质前缀」（*label_0348），一半加 ego 前缀（*label_0349）
        // 两者都写 var_99(23)（10000+egoId / 20000+idx），物品名里体现
        if (Elona.Ego && Elona.Ego.ready && Elona.Ego.ready()) {
          if (R(2)) Elona.Ego.applyRandomQuality(it, g);
          else {
            const ego = Elona.Ego.pick(g, spec, cat);
            if (ego) Elona.Ego.apply(it, ego.id, g);
          }
        }
        this.encadd(it, this.randomenc(this.randomenclv(spec, g), g, cat),
          this.randomencp(0, g, feat163), g, { p552: 10 });
        if (R(20) === 0) this.encadd(it, this.randomenc(99, g, cat), this.randomencp(0, g, feat163), g);
      }
      if (fix === 4 || fix === 5) {
        it.f[23] = 40000 + R(30000);
        if (fix === 5 || (fix === 4 && R(10) === 0)) {
          this.encadd(it, this.randomenc(99, g, cat), this.randomencp(0, g, feat163), g);
        }
        let n = fix === 4 ? R(R(R(10) + 1) + 3) + 3 : R(R(R(10) + 1) + 3) + 6;
        if (n > 11 && (cat === 10000 || cat === 24000) && (R(10) === 0 || opt.var678 === 2)) {
          this.ibitmod(15, it, 1);
          this.encadd(it, this.randomenc(99, g, cat), this.randomencp(0, g, feat163), g);
          it.f[17] = 1;
        }
        const ib15 = this.ibit(15, it) === 1;
        for (let i = 0; i < n; i++) {
          this.encadd(it, this.randomenc(this.randomenclv(spec, g), g, cat),
            this.randomencp(0, g, feat163) + (fix === 5 ? 200 : 0) + (ib15 ? 100 : 0), g,
            { p552: 20 - (fix === 5 ? 10 : 0) - (ib15 ? 20 : 0) });
        }
      }
      if (fix === 4) this.encadd(it, 2, idiv(this.randomencp(0, g, feat163) * 2, 3) + 151, g);
      if (fix === 5) {
        const reps = R(2) + 2;
        for (let i = 0; i < reps; i++) {
          this.encadd(it, 2, idiv(this.randomencp(0, g, feat163) * 2, 3) + 151, g);
        }
      }
      if ((it.f[17] || 0) <= -1) {                            // 28241-28254：诅咒/堕落品的补偿附魔
        this.encadd(it, this.randomenc(this.randomenclv(spec, g), g, cat),
          idiv(limit(this.randomencp(0, g, feat163), 250, 10000)
            * (125 + (it.f[17] === -2 ? 25 : 0)), 100), g);
        const reps = 1 + (it.f[17] === -2 ? 1 : 0) + R(2);
        for (let i = 0; i < reps; i++) {
          if (R(3) === 0) { this.encadd(it, 2, idiv(this.randomencp(0, g, feat163) * 3, 2), g, { p552: 100 }); continue; }
          if (R(3) === 0) { this.encadd(it, 1, idiv(this.randomencp(0, g, feat163) * 5, 2), g, { p552: 100 }); continue; }
          this.encadd(it, this.randomenc(-1, g, cat), this.randomencp(0, g, feat163), g);
        }
      }
    },

    /** 外观图号 var_1015（item.bmp 中的图块序号） */
    graphic(id) { const e = this.eq(id); return e ? (e.graphic || 0) : 0; },

    /** 图标在 item.bmp 中的像素位置 */
    iconPos(id) {
      const g = this.graphic(id);
      return { x: (g % COLS) * TILE, y: Math.floor(g / COLS) * TILE };
    },

    /**
     * 0-DF：图标高度（48 或 96）。
     *
     * item.bmp 里有 58 个大件图标（宠物屋 / 床 / 壁炉 / 摊位 / 神像 / 树 …）实际画成
     * 48×96 —— 它们占用 48 网格的**两行**，下一行同列的索引不被任何物品使用。
     * 0-DE 统一按 48×48 绘制会把这些图标拦腰截断。
     * 检测脚本与本表：data/tables/item_icons.json（tools/gen_item_icons.py）。
     */
    setIconTable(t) {
      ICON_TALL = new Set(((t && t.tall) || []).map((x) => x | 0));
      ICON_TALL_H = (t && (t.tallHeight | 0)) || 96;
    },
    async loadIconTable() {
      if (ICON_TALL) return ICON_TALL;
      try { this.setIconTable(await Elona.Data.table('item_icons')); } catch (e) { this.setIconTable(null); }
      return ICON_TALL;
    },
    /** 该 graphic 在 item.bmp 中的像素高度 */
    iconHeight(gid) {
      const g = gid | 0;
      if (ICON_TALL && ICON_TALL.has(g)) return ICON_TALL_H;
      return TILE;
    },

    /**
     * 对应 itemcreate 的模式 3 + 模式 10 默认值初始化。
     * 原始数据里数值可能带表达式（如 "3 * 10000 + 152, 250, 0"），此处做最小求值。
     */
    /**
     * 该物品是否是生产工具（`var_99(19)` = 1..4，348854）。
     * 工具：1 工具(161) / 2 錬金術の道具(127) / 3 宝石加工ツール(393) / 4 裁縫セット(160)。
     * 这里按**定义**判断（不需要实例），供「使用」列表过滤。
     */
    produceKitType(id) {
      const e = this.eq(id);
      const v = e && e.create ? e.create.v99_19 : undefined;
      if (v === undefined || v === null) return 0;
      const n = parseInt(v, 10);
      return n >= 1 && n <= 4 ? n : 0;
    },

    createItem(id, count, rng) {
      const e = this.eq(id);
      const it = new Item(id);
      if (!e) return it;
      const c = e.create || {};
      let quality = null;      // var_641 → var_99(4)（品质档，6 = 神器）
      const bits = [];         // ibit_N → 物品位标志（5 = 唯一物品）
      for (const k in c) {
        if (k.startsWith('v99_')) {
          const f = parseInt(k.slice(4), 10);
          const v = evalExpr(c[k], rng);
          if (v !== null) it.f[f] = v;
          continue;
        }
        // 224438-224439：`var_99(4, 新物品) = var_641`
        //   神器的品质固定为 6（var_641 = 6），神託（413）的黑星清单也按 var_99(4) == 6 记录
        if (k === 'var_641') {
          const q = evalExpr(c[k], rng);
          if (q !== null) quality = q | 0;
          continue;
        }
        // 固定神器在定义里 `ibitmod 5`（如 81205）：唯一物品位，丢弃/出售时按 ibit 5 判定
        const m = /^ibit_(\d+)$/.exec(k);
        if (m) {
          const v = evalExpr(c[k], rng);
          if (v) bits.push(parseInt(m[1], 10));
        }
      }
      // 与源码同序：先 v99_*，再写品质（品质覆盖 v99_4）
      // 224591-224593：新生成的进化道具（869）一律是「進化の導石」（f[25] = 15）。
      //   没有这一句，商店/节日买到的 869 全是 f[25] = 0（残りカス），任何规则都匹配不到。
      //   合成の壺的「進化の側枝」在 craftprod 里把 f[25] 改写为 14（281879），顺序一致。
      if ((id | 0) === 869 && !(it.f[25] | 0)) it.f[25] = 15;
      if (quality !== null) it.f[4] = quality;
      for (const b of bits) this.ibitmod(b, it, 1);
      // var_657 / var_677 = 类别/子类别（原版写入全局 var_657/var_677）
      it.field657 = evalExpr(c.var_657) || 0;
      it.field677 = evalExpr(c.var_677) || 0;
      // var_470 = 可附魔属性表（形如 "a, b, c, ..."）
      it.enchantTable = (c.var_470 && c.var_470 !== '0')
        ? String(c.var_470).split(',').map((s) => evalExpr(s)).filter((v) => v !== null)
        : [];
      it.f[0] = count || it.f[0] || 1;
      // 0-FX：224806-224823 —— 食物生成时 items.json 的 v99_27 是「还能放几小时」
      //   （桑葚 72 / 苹果 16 / 尸体 4 …），而 Status.rotTick（223820-223946）把 f[27]
      //   当作**绝对到期时刻**与 clockHours(g) 比较。itemcreate 的末尾会把两者对齐：
      //       if (var_657 == 57000 && var_99(25) != 0 && var_99(24) == 35)
      //           var_99(27) += 当前绝对小时
      //   少了这一步，游戏开局 now≈446 万小时，任何新食物在下一次小时推进时立刻烂掉。
      if ((it.f[24] | 0) === 35 && (it.f[25] | 0) !== 0 && (it.f[27] | 0) > 0
          && this.ref && (this.ref(id, 5) | 0) === 57000) {
        const gg = (typeof Elona !== 'undefined' && Elona.game) || null;
        let now = (Elona.Status && Elona.Status.clockHours)
          ? (Elona.Status.clockHours(gg) | 0) : 0;
        // 尚未 boot / 单元测试里没有 game 时，按 602271 的开局时钟
        //   var_65(10..14) = 517,10,12,16,10（年/月/日/时/分）计算绝对小时
        if (now <= 0) now = 16 + 12 * 24 + 10 * 24 * 30 + 517 * 24 * 30 * 12;
        it.f[27] = (it.f[27] | 0) + now;
      }
      // 神託（413）要列出「已生成的黑星物品」——原版用一个 note 缓冲 var_535 记录，
      // 这里挂在 ItemDB 上：唯一物品（var_99(4) == 6 且 refitem(id,5) < 50000）生成时记一笔。
      if ((it.f[4] | 0) === 6 && (!this.ref || this.ref(id, 5) < 50000)) this.noteArtifact(it);
      return it;
    },

    /** 413 神託用的「已生成黑星」记录（按物品 id 去重） */
    artifactLog: [],
    noteArtifact(it) {
      if (!it) return;
      const log = this.artifactLog;
      if (log.some((x) => x.id === it.id)) return;
      log.push({ id: it.id, name: this.name(it, 'jp') || ('item ' + it.id) });
      if (log.length > 200) log.splice(0, log.length - 200);
    },

    // ==========================================================================
    // 装备槽读写 —— 对应原版 var_58(100+n, 角色) 的编码（已确认）：
    //     0                              = 该角色没有这个槽位（列表终止，*label_2235 之后为 0）
    //     slotType*10000                 = 槽位存在但为空（*label_2235 219141-219188 写入）
    //     slotType*10000 + (背包下标+1)  = 已装备（*label_3006 345999 读 itemIdx = 值\10000-1）
    //   证据：224909 `iequiploc(cnt) == var_58(var_1090)/10000`（槽类型）
    //         295379 `var_1368 = var_58(var_1090)\10000 - 1`（物品实例下标）
    //         3000xxx `var_58(...) = var_58(...)/10000*10000`（卸下时清掉下标）
    // 【未移植】真正的装备动作 *label_2980（诅咒/属性加成/自动替换旧装备）→ 这里只写槽值。
    // ==========================================================================
    slotTypeOf(c, n) { return idiv(c.get(100 + n), 10000); },
    slotItemIndex(c, n) {
      const r = c.get(100 + n) % 10000;
      return r === 0 ? -1 : r - 1;
    },
    /** 把背包第 idx 件物品装入第一个匹配的空槽；返回槽序号（0 起）或 -1 */
    equipSlot(c, idx) {
      const item = c.inv[idx];
      if (!item) return -1;
      const L = this.equipLocById(item.id);
      if (!L) return -1;
      if (item.eqSlot >= 0) return -1;                     // 已装备
      for (let n = 0; n < 30; n++) {
        const v = c.get(100 + n);
        if (v === 0) break;                                   // 槽位列表结束
        if (idiv(v, 10000) === L && (v % 10000) === 0) {
          if (c.index === 0) this.identify(item, 2);       // *label_2980 342497-342499
          item.eqSlot = n;                                 // var_99(18) = var_1090 - 100
          c.set(100 + n, L * 10000 + idx + 1);
          return n;
        }
      }
      return -1;
    },
    /** 卸下第 n 个槽（保留槽类型，清掉物品下标） */
    unequipSlot(c, n) {
      const v = c.get(100 + n);
      if (v) c.set(100 + n, idiv(v, 10000) * 10000);
    },
    /**
     * 依 var_121(1) 的槽位串写入 var_58(100..) —— 逐字对应 *label_2235（219133-219190）。
     * 串形如 "頭|体|背|手|手|指|指|腕|腰|足|"，末尾固定追加 10*10000 / 11*10000。
     */
    initSlots(c, str) {
      if (!str) return 0;
      const CODE = { '頭': 1, '首': 2, '背': 3, '体': 4, '手': 5, '指': 6, '腕': 7, '腰': 8, '足': 9 };
      // 0-FJ：重新初始化前先清空 100..129 —— 否则换成肢体更少的种族（阿修罗/丧尸）时，
      //   旧槽会残留在表尾，装备窗会多出已经不存在的部位。
      for (let i = 100; i < 130; i++) if (c.get(i) !== 0) c.set(i, 0);
      let n = 100, count = 0;
      for (const tok of String(str).split('|')) {
        if (!tok) continue;
        if (CODE[tok] === undefined) continue;
        if (n >= 130) break;
        c.set(n, CODE[tok] * 10000); n++; count++;
      }
      c.set(n, 10 * 10000); n++;
      c.set(n, 11 * 10000);
      return count;
    },

    // ==========================================================================
    // 物品生成链（物品候选轮盘 *label_0598 + calcobjlv/calcfixlv + itemcreate）
    //   calcobjlv  26093-26116   生成等级抖动
    //   calcfixlv  26117-26147   品质(fix)抖动 1..5
    //   *label_0598 38479-81186  候选轮盘（同 *label_3105 结构）
    //     权重：var_1006 += NUM / (1000 + abs(var_640 - THR) * 10) + 1
    //     过滤：THR → var_637 → var_638 → var_639 → var_636(instr(var_542(K)))
    //   *label_2297 224287-224887 itemcreate 主体（见 create()）
    // ==========================================================================
    cand: null,
    async loadCand() {
      if (!this.cand) this.cand = await Elona.Data.table('itemcand');
      return this.cand;
    },

    /** 物品生成等级抖动 —— calcobjlv (26093-26116) */
    calcObjLv(prm, g) {
      const V65 = (n) => (g && typeof g.getV65 === 'function') ? g.getV65(n) : 0;
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      let v = prm <= 0 ? V65(22) : prm;
      if (V65(20) === 30) v = 1;
      for (let cnt = 1; cnt <= 3; cnt++) {
        if (R(30 + cnt * 5) === 0) { v += R(10 * cnt); continue; }
        break;
      }
      if (prm <= 3) { if (R(4) !== 0) v = R(3) + 1; }
      return v;
    },

    /** 品质(fix)抖动 —— calcfixlv (26117-26147)，返回 1..5 */
    calcFixLv(prm, g) {
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      let v = prm === 0 ? 2 : prm;
      for (let cnt = 1; cnt <= 3; cnt++) {
        const d = R(30 + cnt * 5);
        if (d === 0) { v++; continue; }
        if (d < 3) { v--; continue; }
        break;
      }
      if (v === 2) { if (R(6) === 0) v++; }
      if (v < 1) v = 1;
      if (v > 5) v = 5;
      return v;
    },

    /**
     * 物品候选轮盘 —— 逐字复现 *label_0598（var_59==1）。
     * 过滤语义（与 *label_3105 相同）：
     *   `if (var_637 != A) goto`        → 需 ctx637 === A
     *   `if (var_638 != 0) { if (var_638 != B) goto }` → 允许条件 (ctx638==0 || ctx638==B)
     *   var_639 同 var_638；var_636 需 ctx636!=0 时判定 instr(var_542(K))
     * @returns {number} item id（无可选时 0）
     */
    pickCand(g, level, opt) {
      opt = opt || {};
      const ctx637 = opt.t637 === undefined ? 0 : opt.t637;
      const ctx638 = opt.t638 === undefined ? 0 : opt.t638;
      const ctx639 = opt.t639 === undefined ? 0 : opt.t639;
      let cum = 0;
      const cand = [];
      for (const e of (this.cand || [])) {
        if (e.thr > level) continue;
        if (e.t637 !== null && ctx637 !== e.t637) continue;
        if (e.t638 !== null && !(ctx638 === 0 || ctx638 === e.t638)) continue;
        if (e.t639 !== null && !(ctx639 === 0 || ctx639 === e.t639)) continue;
        if (e.tagIdx !== null && opt.t636) {
          const seq = opt.tags || [];
          const hay = (opt.tagsByK && opt.tagsByK[e.tagIdx]) || '';
          if (seq.some((s) => hay.indexOf(s) === -1)) continue;
        }
        cum += idiv(e.num, 1000 + Math.abs(level - e.thr) * 10) + 1;
        cand.push({ id: e.id, w: cum });
      }
      if (!cand.length) return 0;
      const r = ((g && g.rng) || Elona.rng).rnd(cum);
      for (const c of cand) if (r < c.w) return c.id;
      return cand[cand.length - 1].id;
    },

    /**
     * 生成一件物品 —— itemcreate（29234-29254）+ *label_2297 主体（224287-224887）的子集。
     *
     * 已忠实：
     *   · var_428 = 容器/坐标（-1 = 地面）；var_577/var_637/var_639 等生成上下文
     *   · var_641 品质抖动：`var_82(19,0) > rnd(5000)` 时 var_641++（上限 5）……
     *   · 随机 id 时 `var_59 = 1 ; gosub *label_0598` 轮盘选 id（224369-224378）
     *   · 依 items.json 的 create 字段生成实例（ItemDB.createItem）
     * 【未移植】inv_getfreeid/地图落点(item_delete/cell_refresh)、var_657 品质强化(*label_2298)、
     *   鉴定/附魔/数量堆叠(item_stack)、`var_608` 系特殊物品分支。
     * @param {object} g  {rng, getV65, ...}
     * @param {object} opt { t637, t638, t639, level, prm, fix, itemId }
     * @returns {Item|null}
     */
    create(g, opt) {
      opt = opt || {};
      let id = opt.itemId === undefined ? -1 : opt.itemId;
      const level = opt.level === undefined ? this.calcObjLv(opt.prm || 0, g) : opt.level;
      const fix = opt.fix === undefined ? this.calcFixLv(2, g) : opt.fix;
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      // 224288-224301：品质自增
      let fix2 = fix;
      if ((opt.container === 0 || opt.container === -1)) {
        const s19 = (g && g.charas && g.charas[0]) ? g.charas[0].skill(19) : 0;
        if (s19 > R(5000)) { if (fix2 < 5) fix2++; }
      }
      if (id === -1 || id === 0) {
        let t637 = opt.t637 === undefined ? 0 : opt.t637;
        if (t637 === 0) {                                   // 224355-224368
          if (fix2 === 3 && R(1000) === 0) t637 = 2;
          if (fix2 === 4 && R(100) === 0) t637 = 2;
        }
        id = this.pickCand(g, level, { t637, t638: opt.t638 || 0, t639: opt.t639 || 0 });
        if (id === 0) return null;
      }
      const it = this.createItem(id, 1, (g && g.rng) || (opt && opt.rng));
      it.f[0] = 1;
      it.genLevel = level;                                 // 生成等级（var_640）
      it.genFix = fix2;                                    // 品质（var_641）
      // 0-FB：224785-224806 —— 容器（宝箱/金库/钱包…）的内容编号 f[25]、锁等级 f[26]、随机种子 f[27]
      if (Elona.DungeonFx && Elona.DungeonFx.genContainerFields) {
        const dep = g && g.getV65 ? (g.getV65(22) | 0) : 0;
        Elona.DungeonFx.genContainerFields(g, it, dep);
      }
      // 224572-224576：怪物球的捕获等级 var_99(26)
      if (it.id === 685) {
        const v189 = (g && g.getV65) ? g.getV65(189) : 0;
        it.f[26] = R(level + 2) + 1;
        if (it.f[26] >= v189 + 10) it.f[26] = R(v189 + 2) + 10;
      }
      // 224270-224277：var_470 固定附魔（prm_555=1 → 跳过类别过滤）
      const et = it.enchantTable || [];
      for (let n = 0; n + 1 < et.length && n < 20; n += 2) {
        if (!et[n]) break;
        this.encadd(it, et[n], et[n + 1] || 0, g, { noFilter: true });
      }
      // 224278-224279：类别 < 52000 → *label_0350 随机附魔
      if ((it.field657 || 0) < 52000) this.applyRandomEnchants(it, g, opt);
      return it;
    },

    /**
     * 鉴定 —— item_identify（29865-29886）。
     * var_99(8) = 鉴定等级（0 未鉴定 / 1 已知 / 3 完全鉴定）。
     * @returns {number} 新等级（0 = 无变化）
     */
    identify(it, level, roll) {
      if (!it) return 0;
      let lv = level;
      if (roll) {
        if (roll >= (it.f[29] || 0)) lv = 3;               // 29867-29871
      }
      if (lv >= 2 && this.ref(it.id, 5) >= 50000) lv = 3;   // 29872-29876
      if (lv === -1 || (it.f[8] || 0) >= lv) return 0;      // 29877-29880
      it.f[8] = lv;
      if (lv >= 1) {
        if (!this.known) this.known = {};
        this.known[it.id] = 1;                              // var_498(0, id) = 1
      }
      return lv;
    },
    /** item_checkknown（29889-29898）：已知物品自动鉴定为 1 级 */
    checkKnown(it) {
      if (!it) return;
      if ((it.f[8] || 0) >= 3) it.f[8] = 3;
      if (this.known && this.known[it.id] && (it.f[8] || 0) === 0) this.identify(it, 1);
    },

    /**
     * item_exchange（29641-29647）：交换两个物品槽的全部 70 个字段。
     *
     * 【源码依据】start.hsp 29641-29647：
     *   repeat 70
     *     var_710 = var_99(cnt, prm_600)
     *     var_99(cnt, prm_600) = var_99(cnt, prm_599)
     *     var_99(cnt, prm_599) = var_710
     *   loop
     * 调用点：298884 的「交換」菜单（把玩家物品与 NPC 手持物品对调，
     *   `var_580 = var_2262` → `gosub *label_2977`），随后 `convertartifact` 重新判定唯一物品。
     *
     * 本项目里槽位就是 `Item` 实例：保留对象身份、交换字段数组与伴随状态，
     * 等价于「槽内容互换」——外部持有的引用不会失效。
     * @returns {boolean} 是否实际交换（同一对象 / 空参数时返回 false）
     */
    exchange(a, b) {
      if (!a || !b || a === b) return false;
      const f = a.f; a.f = b.f; b.f = f;
      const eq = a.eqSlot; a.eqSlot = b.eqSlot; b.eqSlot = eq;
      const f657 = a.field657; a.field657 = b.field657; b.field657 = f657;
      const f677 = a.field677; a.field677 = b.field677; b.field677 = f677;
      const et = a.enchantTable; a.enchantTable = b.enchantTable; b.enchantTable = et;
      const inv = a.inv; a.inv = b.inv; b.inv = inv;
      return true;
    },

    /**
     * convertartifact（222003-222063）：**唯一物品**重复时转化为 stardust。
     *
     * 【源码依据】start.hsp 222003-222063：
     *   if ( refitem(var_99(3, item), 5) >= 50000 ) { return }   ; 消耗品/材料类不转换
     *   if ( var_99(4, item) != 6 ) { return }                  ; var_99(4)==6 = 唯一物品
     *   if ( var_99(18, item) != 0 ) { return }                 ; 已有神器编号的不转换
     *   ; 遍历背包：若已存在同 id（var_99(3)）的另一件 → 触发转换
     *   var_99(0, item) = 0
     *   itemcreate owner, 1066, x, y, 0                        ; 生成 stardust
     *   「<name>はスターダストに形を変えた。」
     *
     * @returns {null|{name:string, dust:object}} 转换成功时返回新生成的星尘实例
     */
    convertArtifact(c, idx) {
      const it = c.inv[idx];
      if (!it || (it.f[0] | 0) <= 0) return null;
      if (this.ref(it.id, 5) >= 50000) return null;        // 222004：消耗品/材料类
      if ((it.f[4] | 0) !== 6) return null;                // 222007：必须是唯一物品
      if ((it.f[18] | 0) !== 0) return null;               // 222010：已有神器编号
      let dup = -1;
      for (let k = 0; k < c.inv.length; k++) {
        if (k === idx) continue;
        const o = c.inv[k];
        if (!o || (o.f[0] | 0) <= 0) continue;
        if ((o.f[3] | 0) === (it.f[3] | 0)) { dup = k; break; }   // 222029-222035
      }
      if (dup < 0) return null;
      const name = this.name(it, 'jp');
      it.f[0] = 0;                                        // 222046：清空原物品
      const dust = this.createItem(1066, 1, null);          // 222047：生成 stardust
      dust.f[5] = it.f[5]; dust.f[6] = it.f[6]; dust.f[21] = it.f[21];
      c.inv[idx] = dust;                                   // 222047：替换到同一位置
      return { name, dust };
    },

    /**
     * item_stack（31322-31400）：把 c.inv[idx] 合并进同类的第一件物品。
     * 可堆叠判据（已确认）：
     *   · 物品类别 var_99(4) == 6 且 refitem(id,5) < 50000 → 不可堆叠
     *   · 同 id（622 钓点还需坐标相同）
     *   · 逐字段比较 1..69，跳过 4(类别)/30/5/6(坐标)/1/27(名称与显示)
     * @returns {number} 合并到的下标，-1 = 未合并
     */
    stack(c, idx) {
      const it = c.inv[idx];
      if (!it) return -1;
      if (it.f[4] === 6 && this.ref(it.id, 5) < 50000) return -1;
      for (let k = 0; k < c.inv.length; k++) {
        if (k === idx) continue;
        const o = c.inv[k];
        if (!o || !o.f[0]) continue;
        if (o.f[3] !== it.f[3]) continue;
        if (it.f[3] === 622 && (o.f[5] !== it.f[5] || o.f[6] !== it.f[6])) continue;
        let diff = false;
        for (let fld = 1; fld < 70; fld++) {
          if (fld === 1 || fld === 4 || fld === 5 || fld === 6 || fld === 27 || fld === 30) continue;
          if ((o.f[fld] || 0) !== (it.f[fld] || 0)) { diff = true; break; }
        }
        if (diff) continue;
        o.f[0] = (o.f[0] || 0) + (it.f[0] || 0);
        it.f[0] = 0;
        return k;
      }
      return -1;
    },

    /** item_separate（29773-29811）：从一堆中拆出 1 个到背包末尾 */
    separate(c, idx) {
      const it = c.inv[idx];
      if (!it || (it.f[0] || 0) <= 1) return idx;
      const copy = Item.fromJSON(it.toJSON());
      copy.f[0] = (it.f[0] || 0) - 1;
      it.f[0] = 1;
      c.inv.push(copy);
      return c.inv.length - 1;
    },

    /** chara_unequip（29851-29862）：卸下物品并把槽值恢复为「空槽」 */
    unequipItem(c, itemIdx) {
      const it = c.inv[itemIdx];
      if (!it || it.eqSlot < 0) return 0;
      const raw = 100 + it.eqSlot;
      c.set(raw, idiv(c.get(raw), 10000) * 10000);
      it.eqSlot = -1;
      return 1;
    },

    // ==========================================================================
    // 物品位标志 —— ibit / ibitmod（6336-6345）
    //   HMMBITCHECK var_99(35 + bit/32), bit%32
    // ==========================================================================
    ibit(bit, it) {
      if (!it) return 0;
      const w = it.f[35 + idiv(bit, 32)] || 0;
      return (w >>> (bit % 32)) & 1;
    },
    ibitmod(bit, it, on) {
      if (!it) return;
      const idx = 35 + idiv(bit, 32);
      const mask = 1 << (bit % 32);
      it.f[idx] = on ? ((it.f[idx] | mask) >>> 0) : ((it.f[idx] & ~mask) >>> 0);
    },

    /**
     * **物品定义**（不是实例）的 ibit —— 对应原版 `ibit(bit, 物品id - 1)`。
     * 原版在 `*label_2688`（284912）里就是用定义 id 判「装备是否耐酸」：
     *   `var_400 = var_58(cnt) \ 10000 - 1` → `ibit(1, var_400)`
     * 这里的定义里带 `ibit_N` 键（见 createItem 的解析），值是 '1' / '0' 之类的表达式。
     */
    ibitDef(bit, itemId) {
      const e = this.eq(itemId);
      if (!e || !e.create) return 0;
      const raw = e.create['ibit_' + (bit | 0)];
      if (raw === undefined || raw === null) return 0;
      if (typeof raw === 'number') return raw | 0;
      const s = String(raw).trim();
      if (s === '1') return 1;
      if (s === '0' || s === '') return 0;
      const v = evalExpr(s, null);
      return (v === null || v === undefined) ? 0 : (v | 0);
    },

    /**
     * 冷气破坏道具 —— item_cold（197341-197436）。
     * @param {Elona.Chara} c     受影响角色（prm_976 的角色）
     * @param {number} charaIdx   角色下标（用于 var_58(25)/(58) 判定）
     * @param {number} [onlyIdx]  只处理该下标物品（prm_977；-1 = 全背包）
     * @returns {number} 1 = 有物品被破坏
     */
    itemCold(c, charaIdx, onlyIdx, g) {
      const list = [];
      let protect = -1;
      if (onlyIdx !== undefined && onlyIdx !== -1) list.push(onlyIdx);
      if (charaIdx !== -1) {
        if (idiv(c.skill(51), 50) >= 6 || (c.get(25) >= 4 && c.get(58) === 0)) return 0;
        for (let k = 0; k < c.inv.length; k++) {
          const it = c.inv[k];
          if (!it || !it.f[0]) continue;
          if (it.f[3] === 568) {                            // 保温/防冷道具
            if (protect === -1) protect = k;
            continue;
          }
          if (onlyIdx === undefined || onlyIdx === -1) list.push(k);
        }
      }
      if (!list.length) return 0;
      const rng = (g && g.rng) || Elona.rng;
      const R = (n) => rng.rnd(n);
      let destroyed = 0;
      for (let n = 0; n < 2; n++) {
        const idx = list[R(list.length)];
        const it = c.inv[idx];
        if (!it || (it.f[0] || 0) <= 0) continue;
        if (this.ibit(3, it) !== 0 || this.ibit(5, it) !== 0) continue;
        const cat = this.ref(it.id, 5);
        if (cat === 72000 || cat === 59000 || cat === 68000) continue;
        if (it.f[4] >= 4 || it.eqSlot >= 0) continue;
        if (cat !== 52000 && R(30) !== 0) continue;
        if (protect !== -1) {                                // 197401-197422
          const p = c.inv[protect];
          if (p && p.f[0] > 0) {
            if ((p.f[9] || 0) > 0) p.f[9] = p.f[9] - 1;
            else { p.f[0] = p.f[0] - 1; break; }
            continue;
          }
        }
        const dmg = idiv(R(it.f[0]), 2) + 1;                 // 197423-197431
        it.f[0] -= dmg;
        destroyed = 1;
      }
      return destroyed;
    },

    /**
     * 炎破坏道具 —— item_fire（197110-197313）。
     * 与 itemCold 结构相同，差异：
     *   · 免疫按 var_82(50)（火抗）/50 >= 6
     *   · 保护道具 id 567；判定 3 次
     *   · 食物（类别 57000）先被「烤熟」（make_dish，未移植 → 记入 unimpl）
     *   · 装备中的物品有 1/2 概率被跳过；非耐热类别另有 rnd(4) 跳过
     * @returns {{destroyed:number, cooked:number, unimpl:string[]}}
     */
    itemFire(c, charaIdx, onlyIdx, g) {
      const list = [];
      let protect = -1;
      const unimpl = [];
      if (onlyIdx !== undefined && onlyIdx !== -1) list.push(onlyIdx);
      if (charaIdx !== -1) {
        if (idiv(c.skill(50), 50) >= 6 || (c.get(25) >= 4 && c.get(58) === 0)) return { destroyed: 0, cooked: 0, unimpl };
        for (let k = 0; k < c.inv.length; k++) {
          const it = c.inv[k];
          if (!it || !it.f[0]) continue;
          if (it.f[3] === 567) { if (protect === -1) protect = k; continue; }
          if (onlyIdx === undefined || onlyIdx === -1) list.push(k);
        }
      }
      if (!list.length) return { destroyed: 0, cooked: 0, unimpl };
      const rng = (g && g.rng) || Elona.rng;
      const R = (n) => rng.rnd(n);
      let destroyed = 0, cooked = 0;
      for (let n = 0; n < 3; n++) {
        const idx = list[R(list.length)];
        const it = c.inv[idx];
        if (!it || (it.f[0] || 0) <= 0) continue;
        if (this.ibit(2, it) !== 0 || this.ibit(5, it) !== 0) continue;
        const cat = this.ref(it.id, 5);
        if (cat === 57000 && !it.f[26]) {                                                  // 197152-197177：烤熟
          // make_dish it, rnd(5) + 1 —— 明火烤制，品质 1..5
          if (Elona.Cook && Elona.Cook.makeDish) Elona.Cook.makeDish(g, it, R(5) + 1);
          else unimpl.push('make_dish');
          cooked++; continue;
        }
        if (cat === 72000 || cat === 59000 || cat === 68000 || it.f[4] >= 4) continue;      // 197179-197181
        if (it.id === 1133 && Elona.Status && Elona.Status.cbit(c, 1043)) continue;         // 197182-197186
        if (it.eqSlot >= 0 && R(2) !== 0) continue;                                        // 197187-197191
        const heatproof = [56000, 80000, 55000, 53000, 54000].indexOf(cat) >= 0 || it.id === 1133;
        if (!heatproof) {
          if (R(4) !== 0) continue;                                                        // 197194-197196
          if (charaIdx !== -1 && R(4) !== 0) continue;                                     // 197197-197201
        }
        if (protect !== -1) {                                                              // 197204-197228
          const p = c.inv[protect];
          if (p && p.f[0] > 0) {
            if ((p.f[9] || 0) > 0) p.f[9] = p.f[9] - 1;
            else { p.f[0] = p.f[0] - 1; break; }
            continue;
          }
        }
        const dmg = idiv(R(it.f[0]), 2) + 1;                                               // 197230
        it.f[0] -= dmg;
        destroyed = 1;
      }
      return { destroyed, cooked, unimpl };
    },

    /**
     * 酸腐蚀装备 —— item_acid（197034-197109）。
     *
     * 与 item_fire / item_cold 不同：**只扫装备栏**（`var_58(0..29)` 的
     * `类型*10000 + 物品下标+1` 编码），削的是耐久 `var_99(20)`，不是数量。
     *   197040-197061  扫 30 个部位：
     *     第一次 `rnd(30)==0` 且**Abnormal 模式**（`var_65(273)==1`）→ 直接选中
     *     第二次 `rnd(30)==0` 且耐久 > -4 → 选中
     *   197066         类别 >= 50000（武器/防具）才继续
     *   197070-197077  `ibit(1)`（耐酸）为 0 → 「は酸で傷ついた。」耐久 -1
     *   197079-197084  Abnormal 模式下耐久恰好 -10 → 音效 + 动画
     *   197085-197100  Abnormal 模式下耐久 < -10 → 「はドロドロに溶けてしまった。」数量 -1、
     *                  清空部位槽、`*label_2174` 重算属性
     *   197102-197107  耐酸 → 「は酸では傷つかない。」
     *
     * @param {object} c 角色
     * @param {number} charaIdx 角色下标（-1 = 不扫装备，只处理 onlyIdx）
     * @param {number} [onlyIdx] 指定物品下标（-1 = 随机）
     * @returns {{ok:boolean, idx:number, action:string, messages:string[]}}
     */
    itemAcid(c, charaIdx, onlyIdx, g) {
      const out = { ok: false, idx: -1, action: 'none', messages: [] };
      if (!c || !c.inv) return out;
      const rng = (g && g.rng) || Elona.rng;
      const R = (n) => rng.rnd(n);
      const mode = (g && g.getV65) ? (g.getV65(273) | 0) : 0;
      let idx = -1;
      if (onlyIdx !== undefined && onlyIdx !== -1) {
        idx = onlyIdx | 0;
      } else if (charaIdx !== -1) {
        for (let body = 0; body < 30; body++) {                       // 197040
          const v = c.get(body) | 0;
          if (idiv(v, 10000) === 0) break;                             // 197042
          const slot = (v % 10000) - 1;                                // 197045
          if (slot === -1) continue;                                   // 197046
          if (R(30) === 0 && mode === 1) { idx = slot; break; }        // 197049-197054
          if (R(30) === 0) {                                           // 197055-197060
            const it0 = c.inv[slot];
            if (it0 && (it0.f[20] | 0) > -4) { idx = slot; break; }
          }
        }
      }
      if (idx < 0) return out;                                         // 197063
      const it = c.inv[idx];
      if (!it || (it.f[0] | 0) <= 0) return out;
      if (this.ref(it.id, 5) >= 50000) return out;                      // 197066
      out.ok = true; out.idx = idx;
      const nm = (c && c.name) ? c.name : '???';
      const itemName = this.name(it.id, 'ch') || this.name(it.id, 'jp');
      const base = `${nm}的${itemName}`;
      if (this.ibit(1, it) === 0) {                                     // 197070
        it.f[20] = (it.f[20] | 0) - 1;
        out.action = 'hurt';
        out.messages.push(`${base}被酸腐蚀了。`);
        if (mode === 1 && (it.f[20] | 0) < -10) {                        // 197085-197100
          out.action = 'melted';
          out.messages.push(`${base}被酸溶得面目全非。`);
          it.f[0] = (it.f[0] | 0) - 1;
          const bodySlot = it.eqSlot | 0;
          if (bodySlot >= 0) {
            const raw = 100 + bodySlot;
            if (typeof c.set === 'function') {
              c.set(raw, idiv(c.get(raw) | 0, 10000) * 10000);
            }
            it.eqSlot = -1;
          }
          if (Elona.Stats && Elona.Stats.recalcStats && g) Elona.Stats.recalcStats(c, g);
        }
      } else {
        out.action = 'immune';
        out.messages.push(`${base}不怕酸。`);
      }
      return out;
    },

    /**
     * 地面物品的火焰破坏 —— mapitem_fire（197314-197340）。
     * 找到 (x,y) 上的第一件地面物品 → item_fire(-1, item)；若被烧毁且格上无 mef
     * → addmef(x,y,5,24,rnd(10)+5,100,attacker)。
     * @returns {number} 1 = 有物品被烧毁
     */
    mapitemFire(g, x, y, attacker) {
      if (!g || !g.groundItemAt) return 0;
      const it = g.groundItemAt(x, y);
      if (!it) return 0;
      const fake = { inv: [it], skill: () => 0, get: () => 0 };
      const r = this.itemFire(fake, -1, 0, g);
      if (!r.destroyed) return 0;
      if ((it.f[0] | 0) <= 0) g.removeGroundItem(it);
      const cell = g.map && g.map.cell(x, y);
      if (g.mef && cell && cell[8] === 0) {
        const R = (n) => ((g.rng) || Elona.rng).rnd(n);
        g.mef.add(g, x, y, 5, 24, R(10) + 5, 100, attacker ? attacker.index : 0);
      }
      return 1;
    },

    /**
     * 地面物品的冷气破坏 —— mapitem_cold（197437-197458）。
     * @returns {number} 1 = 有物品被破坏
     */
    mapitemCold(g, x, y) {
      if (!g || !g.groundItemAt) return 0;
      const it = g.groundItemAt(x, y);
      if (!it) return 0;
      const fake = { inv: [it], skill: () => 0, get: () => 0 };
      const r = this.itemCold(fake, -1, 0, g);
      if (!r) return 0;
      if ((it.f[0] | 0) <= 0) g.removeGroundItem(it);
      return 1;
    },
  };

  /**
   * 整数表达式求值（数字与 + - * / ( ) 以及 HSP 的 rnd(n)）。
   *
   * `items.json` 的 create 字段里有 131 处形如 `8 + rnd(8) - rnd(8)`（125 处是 v99_9 充能/鱼饵），
   * 之前这里只认纯数字，含 rnd 的一律返回 null → 那些字段全部没被写入（杖的充能恒 0）。
   * 现在先把 `rnd(n)` 就地替换成具体数字，再对纯数字表达式求值，避免把字母带进 eval。
   *
   * @param {string|number} s   表达式
   * @param {object} [rng]      有 rnd(n) 的 RNG（默认 Elona.rng）
   */
  function evalExpr(s, rng) {
    if (s === undefined || s === null) return null;
    let str = String(s).trim();
    if (str === '') return null;
    if (/rnd\s*\(/i.test(str)) {
      const R = (rng && typeof rng.rnd === 'function') ? rng.rnd.bind(rng)
        : (Elona.rng && typeof Elona.rng.rnd === 'function') ? Elona.rng.rnd.bind(Elona.rng)
          : null;
      if (!R) return null;
      let guard = 0;
      while (/rnd\s*\(/i.test(str) && guard++ < 16) {
        const before = str;
        str = str.replace(/rnd\s*\(([^()]*)\)/i, (m, arg) => {
          const a = arg.trim();
          let n = 0;
          if (a !== '') {
            if (!/^[-0-9+*/() ]+$/.test(a)) return m;      // 参数本身还含 rnd，交给下一轮
            try { n = Math.trunc(eval(a)); } catch (e) { n = 0; }
          }
          return String(R(Math.max(1, n)));
        });
        if (str === before) return null;                   // 无法继续替换 → 放弃
      }
    }
    if (!/^[-0-9+*/() ]+$/.test(str)) return null;
    try { return Math.trunc(eval(str)); } catch (e) { return null; }
  }

  /**
   * 物品实例 —— 对应原版 var_99(字段, 索引)
   */
  class Item {
    constructor(id) {
      this.f = new Array(72).fill(0);   // var_99 的字段（item_stack 会比较到第 70 项）
      this.f[3] = id;                   // 物品ID
      this.eqSlot = -1;                 // var_99(18)：所在装备槽序号（-1 = 未装备）
      this.field657 = 0;
      this.field677 = 0;
      this.enchantTable = [];
    }
    get id() { return this.f[3]; }
    get count() { return this.f[0]; }
    set count(v) { this.f[0] = v; }
    get weight() { return this.f[7]; }
    get graphic() { return this.f[2]; }
    get isEquipable() { return ItemDB.equipLocById(this.id) !== 0; }
    get equipLoc() { return ItemDB.equipLocById(this.id); }
    name(lang) { return ItemDB.name(this.id, lang); }

    toJSON() {
      const o = { f: this.f, eqSlot: this.eqSlot, field657: this.field657, field677: this.field677, enchantTable: this.enchantTable };
      // 容器内容物（core/container.js）：只在非空时写入，避免存档膨胀
      if (Array.isArray(this.inv) && this.inv.length) o.inv = this.inv.map((x) => x.toJSON());
      return o;
    }
    static fromJSON(o) {
      const it = new Item(0);
      it.f = o.f.slice();
      it.eqSlot = o.eqSlot === undefined ? -1 : o.eqSlot;
      it.field657 = o.field657; it.field677 = o.field677;
      it.enchantTable = o.enchantTable || [];
      // 容器内容物可能嵌套（箱子里还有箱子），递归还原
      if (Array.isArray(o.inv) && o.inv.length) it.inv = o.inv.map((x) => Item.fromJSON(x));
      return it;
    }
  }

  /**
   * 道具使用效果引擎（原版 `*label_0598` 按 var_59 分派 → `*label_1934` 的 1334 条物品定义里的使用效果）
   *
   * 【已确认】使用效果在物品定义里写作（样例 83477-83530）：
   *     if ( var_59 == 15 ) { var_396 = <spellId>; var_578 = <power>; gosub *label_2953; return -1 }
   *   mode 13 = 使用/读（var_59==13）、14 = 吃、15 = 饮；效果本体 = `gosub *label_2960`（已在 spell.js 实现）。
   *   数据由 tools/extract_itemuse.py 机械提取到 web/data/tables/itemuse.json（281 条）。
   *
   * 【未移植】2947/2948 等「无 spell 映射」的专例例程（如卷轴召唤/特殊效果），以及 2953/2955 前段的
   *   物品消耗(item_separate)/技能成长/失手率随机流程；本实现只做「消耗 1 个 + 施放映射的 spell」。
   */
  const ItemUse = {
    TABLE: null,
    setTable(t) { ItemUse.TABLE = t; },
    async loadTable() {
      if (ItemUse.TABLE) return ItemUse.TABLE;
      ItemUse.TABLE = await Elona.Data.table('itemuse');
      return ItemUse.TABLE;
    },
    /** 查某物品在某模式下的使用效果条目 */
    entryOf(itemId, mode) {
      const t = ItemUse.TABLE;
      if (!t || !t[String(itemId)]) return null;
      return t[String(itemId)][String(mode)] || null;
    },
    /**
     * 使用一件道具。
     * @param {number} mode 12=吃（0-BS 确认 *label_4269 等效果区的 12 模式同为吃/饮效果）、
     *                      13=使用/读 14=吃 15=饮
     * @param {object} [target] 效果目标（缺省为使用者自身）
     * @returns {Object} { implemented, spell?, resist?, result? , reason? }
     */
    use(g, chara, item, mode, target) {
      const entry = ItemUse.entryOf(item.f[3], mode);
      if (!entry) {
        return { implemented: false, mode, itemId: item.f[3],
          reason: '该物品该模式无 spell 映射（或属 2947/2948 专例，未移植）' };
      }
      // 专例例程（书物 2948 / 法术书 2947 / 城镇书 3080 等）：
      // 魔法书的 spell 字段表示「习得的法术 id」而不是「施放的法术」，
      // 因此必须交由专用流程处理，不能直接 dispatchEffect。
      if ((entry.calls || []).some((n) => n === 2947 || n === 2948 || n === 3080)) {
        return { implemented: false, special: entry.calls || [], teach: entry.spell, mode, itemId: item.f[3],
          reason: '该物品使用专用例程（2947/2948/3080）' };
      }
      // 0-BS：resistmod / resistmodh 耐性效果（start.hsp 195109/195294，
      // 调用点由 tools/extract_itemuse.py 第二遍机械提取到 entry.resist，58 处）
      const resistOut = [];
      if (entry.resist && entry.resist.length && Elona.Resist) {
        for (const r of entry.resist) {
          const tgt = r.tgt === 'target' ? (target || chara) : chara;
          // 已知偏差 A173：cond 原文（如 417 的 var_99(31)!=1「食物未腐坏」）
          // 本项目未实现腐坏系统，视为恒成立
          const delta = ItemUse.evalNum(r.delta);
          if (delta === null) {
            resistOut.push({ ele: r.ele, applied: false, reason: `无法求值 delta: ${r.delta}` });
            continue;
          }
          const fn = r.kind === 'resistmodh' ? Elona.Resist.resistModH : Elona.Resist.resistMod;
          const rr = fn(tgt, r.ele, delta);
          resistOut.push({ ele: r.ele, applied: rr.changed, value: rr.value, message: rr.message });
        }
      }
      const hasResistOnly = !entry.spell && entry.spell !== 0 && (entry.resist || []).length > 0;
      if (entry.spell === null || entry.spell === undefined) {
        if (!hasResistOnly) {
          return { implemented: false, special: entry.calls || [], mode, itemId: item.f[3],
            reason: '该物品没有 spell 映射' };
        }
        // 只有 resist 效果的条目（如 937 料理）：消耗 1 个并应用
        if (item.f[0] > 0) item.f[0]--;
        return { implemented: true, mode, itemId: item.f[3], resist: resistOut };
      }
      let power;
      if (entry.power !== null && entry.power !== undefined && /^\d+$/.test(String(entry.power))) {
        power = Number(entry.power);                              // var_578 = <power>
      }
      // 消耗 1 个（原版在 2953/2955 前段做 item_separate，此处近似）
      if (item.f[0] > 0) item.f[0]--;
      // 0-ES：信仰の巻物（1107，320932-320995）—— 充能/恩惠/信仰经验三件事，
      // 不属于通用效果表，交给 core/faith.js 的 useScroll。
      if (entry.spell === 1107 && Elona.Faith && Elona.Faith.useScroll) {
        const fr = Elona.Faith.useScroll(g, chara, item);
        return { implemented: true, mode, itemId: item.f[3], spell: entry.spell,
          faith: fr, messages: fr.messages };
      }
      // 药水（mode 15）—— `*label_2953` 314833-314962：
      //   强度 = 炼金术×4 + limit(等级×8,0,8000) + 基础强度，再乘魔法威力/魔装；
      //   效果之后结算水分(+2000)/饱腹(+150)/呕吐/失禁，并给炼金术 +50 经验。
      if (mode === 15 && Elona.Potion && Elona.Potion.apply) {
        const pr = Elona.Potion.apply(g, chara, target || chara, item.f[3] | 0,
          (power === undefined ? 0 : power), Elona.Potion.curseOf(item), { item });
        if (pr) {
          // 342594：玩家喝下贴图 354 的药水时瓶塞 +1（诅咒/普通都算）
          let plug = 0;
          if ((chara.index | 0) === 0) plug = Elona.Potion.addPlug(g, item, 1);
          return { implemented: true, mode, itemId: item.f[3], spell: pr.spell,
            power: pr.power, potion: pr, resist: resistOut, messages: pr.messages,
            plug };
        }
      }
      // 0-BT：药水专例优先（原版效果引擎内 var_1302 分支先于通用效果，
      // 处理完 goto *label_2970 直接结束；var_2362 = 物品 f[17] 诅咒等级，314859）
      if (Elona.Potion) {
        const pr = Elona.Potion.dispatch(g, entry.spell, target || chara, power || 0,
          { curse: Elona.Potion.curseOf(item), caster: chara, item });
        if (pr) {
          return { implemented: true, mode, itemId: item.f[3], spell: entry.spell,
            potion: pr, resist: resistOut, messages: pr.messages };
        }
      }
      const r = Elona.Spell
        ? Elona.Spell.dispatchEffect(g, chara, entry.spell, target || chara, power)
        : { implemented: false };
      return { implemented: !!(r && r.implemented), mode, itemId: item.f[3], spell: entry.spell, resist: resistOut, result: r };
    },

    /**
     * 安全求值数字表达式（resist delta：'50' / '50 * 10' 等，extract_itemuse.py 提取自源码字面量）
     */
    evalNum(expr) {
      const s = String(expr).trim();
      if (/^\d+$/.test(s)) return Number(s);
      if (/^\d+\s*\*\s*\d+$/.test(s)) {
        const [a, b] = s.split('*').map((x) => Number(x.trim()));
        return a * b;
      }
      return null;
    },
  };

  Elona.ItemUse = ItemUse;
  Elona.ItemDB = ItemDB;
  Elona.Item = Item;
  Elona.ITEM_TILE = TILE;
  Elona.ITEM_COLS = COLS;
})(window);
