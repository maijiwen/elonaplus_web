'use strict';
/**
 * 技能快捷栏 —— var_65(40 + n)，n = 0..19（原版 20 个槽）
 *
 * 【已确认】槽值语义（label_2735，288617-288700）：
 *   `var_65(40+n) == 0`      → 该键未分配（288619-288627）
 *   `>= 10000`               → 物品：`模式 = 值 % 10000`、`var_486 = 值 / 10000`（288629-288632）
 *                              （例：602823 `789 + 14*10000` = 物品 789、模式 14）
 *   `300 <= v < 400`         → 技能/能力（label_2738）
 *   `400 <= v < 600`         → 法术（var_495 库存，400+i）
 *   `>= 600`                 → 能力：需 `var_98(v-600) != 0`（已解锁），否则提示不可用（288650-288660）
 *
 * 【已确认】绑定（288884-288893 / 297274 / 292040-292049）：
 *   把当前选中项写入 `var_65(40 + 槽号)`，并先把其它槽中同一项清空（同项只占一个槽）。
 *
 * 【已确认】新游戏预置（602315-602317 / 602823-602824）：
 *   `var_65(41)=424`、`var_65(42)=300`、`var_65(43)=631`、`var_65(41)=789+14*10000` …
 *   0-HB 起新游戏（startGame）预置 41/42/43 = 424/300/631。
 *
 * 【推断/简化，见差异报告】
 *   - 原版绑定入口在技能/物品菜单内（按专用键把当前项存入 var_186 指向的槽）；
 *     本实现改为在快捷栏面板内发起绑定（选槽 → 选技能/物品），功能等价、交互不同。
 *   - 300-399 与 600+ 的「技能/能力」施放入口（label_2738）依赖未完全移植的能力系统，
 *     当前按「已解锁则尝试施放，否则提示」处理。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const V_BASE = 40;        // var_65(40 + n)
  let NAMES = null;         // skills.json 的 skillNames（懒加载）
  const COUNT = 20;         // 20 个槽
  const ITEM_BASE = 10000;  // 物品槽 = 模式*10000 + 物品 id

  /** 读槽值 */
  function get(g, i) { return g.getV65(V_BASE + (i | 0)) | 0; }
  /** 写槽值 */
  function set(g, i, v) { g.setV65(V_BASE + (i | 0), v | 0); }

  /** 槽值 → 类型 */
  function kindOf(v) {
    if (!v) return 'empty';
    if (v >= ITEM_BASE) return 'item';
    if (v >= 600) return 'ability';
    if (v >= 400) return 'spell';
    if (v >= 300) return 'skill';
    return 'unknown';
  }

  /** 懒加载技能名表（面板打开前 await 一次） */
  async function loadNames() {
    if (!NAMES) {
      try {
        const t = await Elona.Data.table('skills');
        NAMES = (t && t.skillNames) || {};
      } catch (e) { NAMES = {}; }
    }
    return NAMES;
  }

  /** 槽值 → 显示名 */
  function labelOf(v) {
    if (!v) return '（空）';
    const kind = kindOf(v);
    if (kind === 'item') {
      const mode = Math.floor(v / ITEM_BASE);
      const id = v % ITEM_BASE;
      const nm = Elona.ItemDB ? Elona.ItemDB.name(id, 'en') : ('item ' + id);
      return `${nm}（模式 ${mode}）`;
    }
    const id = v;
    const e = NAMES && NAMES[String(id)];
    // 汉化：同一层级的 ch 优先（skills.json 的 skillNames 为 {jp, en, ch}）
    if (e) return e.ch || e.jp || e.en || String(id);
    return `${kind} ${id}`;
  }

  const QuickSlot = {
    COUNT, ITEM_BASE, V_BASE,
    get, set, kindOf, labelOf, loadNames,

    /** 全部槽位（含空槽），供面板渲染 */
    all(g) {
      const out = [];
      for (let i = 0; i < COUNT; i++) {
        const v = get(g, i);
        out.push({ index: i, value: v, kind: kindOf(v), label: labelOf(v) });
      }
      return out;
    },

    /**
     * 绑定 —— 先把其它槽里的同一个值清空（288889-288891：同项只保留一个槽）。
     * @returns {{ok:boolean, cleared:number[]}}
     */
    bind(g, index, value) {
      if (index < 0 || index >= COUNT) return { ok: false, cleared: [] };
      const cleared = [];
      for (let i = 0; i < COUNT; i++) {
        if (i === index) continue;
        if (get(g, i) === (value | 0)) { set(g, i, 0); cleared.push(i); }
      }
      set(g, index, value);
      return { ok: true, cleared };
    },

    /** 绑定法术（400..599） */
    bindSpell(g, index, spellId) {
      if (!(spellId >= 400 && spellId < 600)) return { ok: false, reason: 'not-spell' };
      return this.bind(g, index, spellId);
    },

    /** 绑定物品（模式*10000 + 物品 id） */
    bindItem(g, index, itemId, mode) {
      const m = mode | 0 || 14;
      return this.bind(g, index, m * ITEM_BASE + (itemId | 0));
    },

    clear(g, index) {
      if (index < 0 || index >= COUNT) return false;
      set(g, index, 0);
      return true;
    },

    /**
     * 使用槽位 —— label_2735（288617-288700）。
     * @returns {{ok:boolean, kind?:string, message?:string, request?:object}}
     */
    use(g, index) {
      const v = get(g, index);
      if (!v) return { ok: false, kind: 'empty', message: '该键没有分配快捷项。' };   // 288624

      const kind = kindOf(v);
      if (kind === 'item') {
        // 288629-288632：物品模式 → 打开对应模式的物品选择
        const mode = Math.floor(v / ITEM_BASE);
        const itemId = v % ITEM_BASE;
        return {
          ok: true, kind, mode, itemId,
          message: `打开「${labelOf(v)}」的物品选择。`,
          action: 'item-mode',
        };
      }
      if (kind === 'spell') {
        const r = g.castPlayerSpell ? g.castPlayerSpell(v) : null;
        if (r && r.request && Elona.consumeSpellRequest) Elona.consumeSpellRequest(r);
        return { ok: true, kind, message: `施放 ${labelOf(v)}。`, result: r };
      }
      if (kind === 'ability' || kind === 'skill') {
        // 288650-288660：能力需要 var_98(v-600) != 0（已解锁）
        if (kind === 'ability' && Elona.Feat && Elona.Feat.flag) {
          const unlocked = Elona.Feat.flag(g.player, v - 600) !== 0;
          if (!unlocked) {
            return { ok: false, kind, message: '这个快捷项已经不能使用了。' };   // 288655
          }
        }
        // 能力/技能发动（*label_2958）
        if (g.useAbility) {
          const r = g.useAbility(v);
          if (r && r.request && Elona.consumeSpellRequest) Elona.consumeSpellRequest(r);
          return {
            ok: !!(r && r.ok), kind, result: r,
            message: r && r.ok ? `发动了「${labelOf(v)}」。` : `「${labelOf(v)}」发动失败。`,
          };
        }
        return { ok: false, kind, message: `「${labelOf(v)}」无法发动。` };
      }
      return { ok: false, kind, message: '未知的快捷项。' };
    },
  };

  Elona.QuickSlot = QuickSlot;
})(window);
