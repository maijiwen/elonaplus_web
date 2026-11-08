'use strict';
/**
 * 事件队列（evadd / evid / evfind）—— 对应 start.hsp 6462-6477、6447-6461、603050-603060。
 *
 * 【已确认 语义】
 *   evadd(id, a, b) ：把事件压入队列尾部；绘制/事件处理前插一条时（var_109）插到尾部前一位。
 *   evid()          ：返回队尾事件 id；空队列返回 -1。
 *   evfind(id)      ：队列中是否存在该 id。
 *   主循环 603050-603060：`if (var_106 != 0) { gosub *label_4376; var_106--; var_107(var_106)=0; }`
 *     —— 每回合处理**队尾一条**事件（LIFO）。
 *
 * 【已移植的事件】
 *   21：mef 类型 7 删除时的粒子动画（32265-32267 → *label_4376 209864-209928）。
 *       本项目用 `game.effects` 的粒子效果近似，不播放音效/不使用 anime16.bmp。
 *   其余事件 id：原版为剧情/任务专用（需要 quest 状态机），本模块只保留队列，
 *   由宿主通过 `Elona.Event.handlers[id]` 注册；未注册时返回 `{ handled:false }`，不改动世界状态。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const handlers = {
    /** 事件 21：粒子飞散（mef 类型 7 被删除时）。用 renderer 的效果层表现。 */
    21(g, a, b) {
      if (g && typeof g.addParticles === 'function') g.addParticles(a, b);
      return { handled: true, particles: true };
    },
    /**
     * 事件 12：ペットとの再会（608161-608200）
     *   选项 犬(165) / 猫(164) / クマ(108) / 少女(166)，等级 = limit(玩家等级×2/3+1, 1, 50)。
     *   触发：首次进入 Vernis（地图 5，var_65(250+7)==0 → 置 1 后 evadd 12，247786-247795）；
     *         许愿「仲間/friend/company/ally」（288090-288092）。
     */
    12(g) {
      if (Elona.Panels && Elona.Panels.openPetReunion) {
        Elona.Panels.openPetReunion(g, 'pet');
        return { handled: true, ui: 'pet-reunion' };
      }
      return { handled: false };
    },
    /**
     * 事件 38：「隠れていたもの」（608095-608158）—— 许愿「隠しキャラ/隐藏角色」时触发，
     *   选项 妹/お嬢様/姉/少女/少年/弟/執事/兄，对应生物 436/485/493/494/963/921/965/922。
     */
    38(g) {
      if (Elona.Panels && Elona.Panels.openPetReunion) {
        Elona.Panels.openPetReunion(g, 'family');
        return { handled: true, ui: 'family-reunion' };
      }
      return { handled: false };
    },
  };

  class EventQueue {
    constructor() {
      this.q = [];
      this.insertBeforeTail = false;   // var_109：绘制期间插入
    }

    /** evadd */
    add(id, a, b) {
      const e = [id | 0, a === undefined ? 0 : (a | 0), b === undefined ? 0 : (b | 0)];
      if (this.insertBeforeTail && this.q.length > 0) this.q.splice(this.q.length - 1, 0, e);
      else this.q.push(e);
      return this.q.length;
    }

    /** evid */
    id() { return this.q.length ? this.q[this.q.length - 1][0] : -1; }

    /** evfind */
    find(id) { return this.q.some((e) => e[0] === id); }

    size() { return this.q.length; }

    /**
     * 每回合处理队尾一条（603050-603060）。
     * @returns {object|null} {id,a,b,handled,result}
     */
    process(g) {
      if (!this.q.length) return null;
      const e = this.q.pop();
      const fn = handlers[e[0]];
      let result = null;
      if (fn) result = fn(g, e[1], e[2]);
      return { id: e[0], a: e[1], b: e[2], handled: !!(result && result.handled), result };
    }

    clear() { this.q.length = 0; }
    toJSON() { return { q: this.q }; }
    static fromJSON(o) {
      const q = new EventQueue();
      if (o && Array.isArray(o.q)) q.q = o.q.map((e) => [e[0] | 0, e[1] | 0, e[2] | 0]);
      return q;
    }
  }

  Elona.EventQueue = EventQueue;
  Elona.Event = { add: null, handlers };
})(window);
