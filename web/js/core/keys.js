'use strict';
/**
 * 键位配置层 —— 严格对齐原版 `original/config.txt` 的 (keyboard) 段。
 *
 * 【数据来源】elonaplus2.33R/original/config.txt 的键名与默认键；
 *   并已用 tools/extract_keymap.py 从 start.hsp 提取「键名 → 主循环分派标签」链路，
 *   交叉验证每个键在原版中真正触发的动作（见 docs/03-keymap.md）。
 *
 * 【HSP key_set】config.txt 的 `key_set.,a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u`
 *   定义了菜单选择键（原版把 a..u 当作菜单项热键）。本实现把菜单热键限定在
 *   面板打开时生效，避免与地图移动/动作键冲突。
 *
 * 【语义差异说明】
 *   - HSP 里按键比较是字符串比较（"S" 与 "s" 不同）。本模块用 e.key 原样比较，
 *     同样区分大小写，因此 key_save="S" 与 key_search="s" 可以并存。
 *   - key_sCancel 在原版把 Shift 当 ESC 用（config.txt: key_sCancel=1）。
 *   - 原版允许一个动作绑定多个键（`key_look. "l" ,"6"`）。这里用数组表示。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /**
   * 动作定义表。
   *   id      : 内部动作名
   *   label   : 中文说明（用于选项界面与帮助）
   *   keys    : 默认键（来自 config.txt；数组表示原版 `,` 分隔的备用键）
   *   origin  : config.txt 中的键名
   *   label_  : start.hsp 中该键的分派目标（来自 tools/extract_keymap.py）
   *   verified: 动作语义是否已从源码确认
   */
  const ACTIONS = [
    // ---- 移动（config.txt: key_north..key_wait）----
    { id: 'move', label: '移动 / 等待（八方向 + 5 等待）', keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], origin: 'key_north..key_wait', special: 'move' },

    // ---- 探索 / 地形 ----
    { id: 'look', label: '查看（视野内目标一览）', keys: ['l'], origin: 'key_look', label_: 'label_2675' },
    { id: 'search', label: '搜索（陷阱/暗门/矿脉）', keys: ['s'], origin: 'key_search', label_: 'label_3009' },
    { id: 'dig', label: '挖掘', keys: ['D'], origin: 'key_dig', label_: 'label_2736' },
    { id: 'bash', label: '撞墙/撞树', keys: ['b'], origin: 'key_bash', label_: 'label_2737' },
    { id: 'rest', label: '休息', keys: ['R'], origin: 'key_rest', label_: 'label_2843' },
    { id: 'hijump', label: '跳跃', keys: ['h'], origin: 'key_hijump', label_: 'label_2842' },
    { id: 'close', label: '关门', keys: ['C'], origin: 'key_close', label_: 'label_3004' },
    { id: 'goUp', label: '上楼梯', keys: ['<'], origin: 'key_goUp', label_: 'label_4364' },
    { id: 'goDown', label: '下楼梯', keys: ['>'], origin: 'key_goDown', label_: 'label_4364' },
    { id: 'interact', label: '交互（足元/面前）', keys: ['i'], origin: 'key_interact', label_: 'label_2749' },
    { id: 'target', label: '手动选择目标', keys: ['*'], origin: 'key_target', label_: 'label_2670' },
    { id: 'alter', label: '改造/操作（alter）', keys: ['['], origin: 'key_alter', verified: false },
    { id: 'material', label: '素材/材料', keys: ['m'], origin: 'key_material', label_: 'label_2582' },

    // ---- 物品 ----
    { id: 'get', label: '拾取', keys: ['g', '0'], origin: 'key_get / key_get2', label_: 'label_2819' },
    { id: 'drop', label: '丢弃（选择式）', keys: ['d'], origin: 'key_drop', label_: 'var_486=2' },
    { id: 'inventory', label: '背包', keys: ['X'], origin: 'key_inventory', label_: 'var_486=1' },
    { id: 'quickinv', label: '快速背包', keys: ['x'], origin: 'key_quickinv', label_: 'var_486=var_557' },
    { id: 'eat', label: '进食', keys: ['e'], origin: 'key_eat', label_: 'var_486=5' },
    { id: 'read', label: '阅读', keys: ['r'], origin: 'key_read', label_: 'var_486=7' },
    { id: 'drink', label: '饮用', keys: ['q'], origin: 'key_drink', label_: 'var_486=8' },
    { id: 'zap', label: '使用魔杖/杖', keys: ['Z'], origin: 'key_zap', label_: 'var_486=9' },
    { id: 'use', label: '使用道具', keys: ['t'], origin: 'key_use', label_: 'var_486=14' },
    { id: 'open', label: '打开容器', keys: ['o'], origin: 'key_open', label_: 'var_486=15' },
    { id: 'dip', label: '浸泡（dip）', keys: ['B'], origin: 'key_dip', label_: 'var_486=17' },
    { id: 'offer', label: '献祭', keys: ['O'], origin: 'key_offer', label_: 'var_486=19' },
    { id: 'throw', label: '投掷', keys: ['T'], origin: 'key_throw', label_: 'var_486=26' },
    { id: 'wear', label: '装备/卸下', keys: ['w'], origin: 'key_wear', label_: 'label_2815' },
    { id: 'wipe', label: '擦拭 / 技能第 3 页', keys: ['W'], origin: 'key_wipe', label_: 'label_2743' },
    { id: 'itemstack', label: '整理堆叠', keys: ['I'], origin: 'key_itemstack', label_: 'label_2747' },
    { id: 'give', label: '给予物品', keys: ['G'], origin: 'key_give', label_: 'label_2748' },
    { id: 'pray', label: '祈祷', keys: ['p'], origin: 'key_pray', label_: 'label_2976' },

    // ---- 战斗 / 技能 ----
    { id: 'fire', label: '射击', keys: ['f'], origin: 'key_fire', label_: 'label_2839' },
    { id: 'cast', label: '咏唱魔法', keys: ['v'], origin: 'key_cast', label_: 'label_2772' },
    { id: 'skill', label: '使用技能', keys: ['a'], origin: 'key_skill / key_apply', label_: 'label_2739' },
    { id: 'ammo', label: '切换弹药', keys: ['A'], origin: 'key_ammo', label_: 'label_2852' },

    // ---- 信息面板 ----
    { id: 'charainfo', label: '角色信息', keys: ['c'], origin: 'key_charainfo', label_: 'label_2784' },
    { id: 'journal', label: '冒险日记', keys: ['j'], origin: 'key_journal', label_: 'label_2700' },
    { id: 'trait', label: '特性（feat）', keys: ['F'], origin: 'key_trait', label_: 'label_2695' },
    { id: 'msglog', label: '消息记录', keys: ['/'], origin: 'key_msglog', label_: 'label_4325' },
    { id: 'help', label: '帮助', keys: ['?'], origin: 'key_help', label_: 'label_4319' },
    { id: 'pageup', label: '翻页 上', keys: ['+'], origin: 'key_pageup' },
    { id: 'pagedown', label: '翻页 下', keys: ['-'], origin: 'key_pagedown' },

    // ---- 系统 ----
    { id: 'save', label: '保存', keys: ['S'], origin: 'key_save', label_: 'label_2845' },
    { id: 'cancel', label: '取消', keys: ['"', '0'], origin: 'key_cancel', label_: 'label_4367' },
    { id: 'esc', label: '游戏内菜单', keys: ['Escape'], origin: 'key_esc', label_: 'label_4367' },
    { id: 'enter', label: '确定', keys: [' ', 'Enter'], origin: 'key_enter', label_: 'label_4364' },
    { id: 'quickslot', label: '快捷栏（技能/物品）', keys: ['z'], origin: 'key_mode / key_quick', label_: 'label_2735' },
  ];

  const STORAGE = 'elona.keybindings.v1';

  /** 默认绑定：action -> [keys] */
  function defaults() {
    const m = {};
    for (const a of ACTIONS) if (a.keys) m[a.id] = a.keys.slice();
    return m;
  }

  /** 读取用户自定义绑定（合并默认；未保存过则用默认） */
  function loadBindings() {
    const d = defaults();
    try {
      const raw = localStorage.getItem(STORAGE);
      if (!raw) return d;
      const saved = JSON.parse(raw);
      for (const k in saved) {
        if (!(k in d)) continue;                 // 忽略已删除的动作
        if (Array.isArray(saved[k]) && saved[k].length) d[k] = saved[k].map(String);
      }
    } catch (e) { /* 解析失败用默认 */ }
    return d;
  }

  const Keys = {
    ACTIONS,
    bindings: loadBindings(),
    /** shift 当 Esc（config.txt: key_sCancel=1） */
    shiftAsEsc: true,

    save() {
      try { localStorage.setItem(STORAGE, JSON.stringify(this.bindings)); } catch (e) { /* ignore */ }
    },

    reset() {
      this.bindings = defaults();
      this.save();
    },

    actionById(id) { return ACTIONS.find((a) => a.id === id) || null; },

    /** 某按键被哪些动作占用（用于冲突提示） */
    ownersOf(key) {
      const out = [];
      for (const id in this.bindings) {
        if (this.bindings[id].indexOf(key) >= 0) out.push(id);
      }
      return out;
    },

    /**
     * 绑定一个键（会从其它动作中移除该键，保证唯一）。
     * @returns {{ok:boolean, removed?:string[]}}
     */
    bind(actionId, key) {
      if (!key) return { ok: false };
      if (!this.bindings[actionId]) this.bindings[actionId] = [];
      const removed = [];
      for (const id in this.bindings) {
        if (id === actionId) continue;
        const arr = this.bindings[id];
        const i = arr.indexOf(key);
        if (i >= 0) {
          // 该动作必须至少保留一个键
          if (arr.length > 1) { arr.splice(i, 1); removed.push(id); }
          else { return { ok: false, conflict: id }; }
        }
      }
      if (this.bindings[actionId].indexOf(key) < 0) this.bindings[actionId].push(key);
      this.save();
      return { ok: true, removed };
    },

    /** 移除某动作的某个键（至少保留一个） */
    unbind(actionId, key) {
      const arr = this.bindings[actionId] || [];
      if (arr.length <= 1) return false;
      const i = arr.indexOf(key);
      if (i < 0) return false;
      arr.splice(i, 1);
      this.save();
      return true;
    },

    /** 事件 → 规范化键名（字母区分大小写，与 HSP 字符串比较一致） */
    keyName(e) {
      if (!e) return '';
      if (e.key === ' ') return ' ';
      return e.key;
    },

    /**
     * Shift 当 Esc（config: key_sCancel=1）**不在这里映射**：
     * 因为 Shift+',' 是原版的 '<'，若把 Shift 的 keydown 直接当 Esc，会误开菜单。
     * 由 main.js 用「单独按下并松开 Shift」判定。
     */

    /** 事件 → 动作 id（未命中返回 null） */
    actionFor(e) {
      const k = this.keyName(e);
      if (!k) return null;
      for (const id in this.bindings) {
        if (this.bindings[id].indexOf(k) >= 0) return id;
      }
      return null;
    },

    /** 该动作的键位文本（用于帮助/面板提示） */
    text(actionId) {
      const b = this.bindings[actionId] || [];
      return b.map((k) => (k === ' ' ? 'Space' : k)).join(' / ');
    },
  };

  Elona.Keys = Keys;
})(window);
