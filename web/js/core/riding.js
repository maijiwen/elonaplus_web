'use strict';
/**
 * 骑乘 —— 乘马 / 载人（ride_begin / ride_end，194073-194125）。
 *
 * 【源码定位】
 *   var_65(183)      当前坐骑的角色索引（0 = 无）
 *   var_58(196, x)   骑乘方式：0 = 你骑它；1 = 它骑你（载人）
 *   cbit 975         骑乘中标志（挂在坐骑身上）
 *   var_82(301, x)   乗馬 技能
 *   var_82(10, x)    筋力 / var_82(18, x) 敏捷
 *   var_58(11, x)    当前速度
 *
 *   ride_begin（194073-194117）
 *     · 提示「〜に騎乗した(〜の速度: N→」/「〜を乗せた」
 *     · cbitmod 975, 1；清掉坐骑所在格的占用（var_704(x,y,1) = 0）
 *     · var_65(183) = 坐骑索引；create_pcpic（刷新玩家贴图）；rowactend；refreshspeed
 *     · cbit 22（适合骑乘）→ 「この生物は乗馬用にちょうどいい！」
 *     · cbit 25（驮不动）  → 「この生物はあなたを乗せるには非力すぎる。」
 *   ride_end（194118-194125）
 *     · cbitmod 975, 0；rowactend；var_65(183) = 0；refreshspeed
 *   chara_vanquish（194136-194138）：坐骑阵亡 → ride_end
 *
 *   速度公式（refreshspeed 193952-193973）
 *     方式 0（你骑它）：
 *       speed(你) = SPD(坐骑) * 100
 *                   / limit(100 + SPD(坐骑) - STR(坐骑)*3/2
 *                           - 乗馬(坐骑)/2 - 乗馬(你)*2
 *                           - (cbit22(坐骑) ? 50 : 0), 100, 1000000)
 *       cbit 25 → 再 /= 10
 *       speed(坐骑) = limit(STR(你) + 乗馬(你), 10, SPD(坐骑))
 *     方式 1（它骑你）：
 *       speed(你) = limit(STR(你) + 乗馬(坐骑), 10, SPD(你))
 *       speed(坐骑) = SPD(你) * 100
 *                     / limit(100 + SPD(你) - STR(你)*3/2
 *                             - 乗馬(你)/2 - 乗馬(坐骑)*2, 100, 1000000)
 *       上限 = SPD(坐骑) * 3
 *
 *   骑乘的前置判定（319690-319760）
 *     · 必须是同伴（否则「仲間にしか騎乗できない。」）
 *     · cbit 963 / 971（护送对象 / 不可放出）→ 「護衛対象には騎乗できない。」
 *     · 不能骑自己 → 「〜は自分に乗ろうとした。」
 *     · 对方不在场（var_58(80) != 0）→ 「その仲間はこの場所に滞在中だ。」
 *     · 已经骑着别的 → 「現在〜は〜に騎乗している。」
 *     · 否则弹出 3 项菜单（txtsetride 11104-11121）：キャンセル / 乗る / 乗せる
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const MOUNT_SLOT = 183;      // var_65(183)
  const MODE_FIELD = 196;      // var_58(196)
  const CG_RIDING = 975;       // cbit 975
  const SKILL_RIDE = 301;      // var_82(301) 乗馬
  const ATTR_STR = 10;
  const ATTR_SPD = 18;
  const CG_GOOD_RIDER = 22;    // cbit 22：适合骑乘
  const CG_TOO_WEAK = 25;      // cbit 25：驮不动
  const CG_ESCORT = 963;
  const CG_PROTECTED = 971;

  const TEXT = {
    rideOn: (n, sp) => `你骑上了${n}（${n}的速度：${sp}→`,
    giveRide: (n, sp) => `你让${n}骑在了你身上（${n}的速度：${sp}→`,
    goodRider: '这个生物正好适合骑乘！',
    tooWeak: '这个生物驮不动你。',
    onlyAlly: '只能骑乘同伴。',
    noEscort: '不能骑乘护送对象。',
    selfRide: '你想骑自己。',
    notHere: '那个同伴目前待在这个地方。',
    tag: '需要先解散タッグ（骑乘组合）。',
    alreadyRiding: (a, b) => `现在${a}正骑着${b}。`,
    alreadyCarrying: (a, b) => `现在${b}正骑着${a}。`,
    cancel: '取消',
    optRide: '乗る（Ride on）',
    optCarry: '乗せる（Give a ride）',
  };

  function cbitOf(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, bit) : 0;
  }
  function setCbit(c, bit, on) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit, on);
  }

  /** 当前坐骑的角色索引（var_65(183)） */
  function mountOf(g) {
    if (!g || !g.getV65) return 0;
    return g.getV65(MOUNT_SLOT) | 0;
  }

  /** 坐骑对象（不存在时返回 null） */
  function mountObj(g) {
    const i = mountOf(g);
    if (!i) return null;
    return (g && g.charas) ? (g.charas[i] || null) : null;
  }

  /** 骑乘方式（var_58(196, x)）：0 = 你骑它，1 = 它骑你 */
  function modeOf(g, c) {
    return c ? (c.get(MODE_FIELD) | 0) : 0;
  }

  /**
   * 骑乘的前置判定（319688-319747）。
   *   · 对方正在载人（var_58(168) != 0）→「タッグを解散する必要がある。」
   *   · 对方槽位 >= 16（非同伴）→「仲間にしか騎乗できない。」
   *   · cbit 963 / 971（护送对象）→「護衛対象には騎乗できない。」
   *   · 不能骑自己 → 「〜は自分に乗ろうとした。」
   *   · 对方不在场（var_58(80) != 0）→「その仲間はこの場所に滞在中だ。」
   *   · 已经骑着别的 → 「現在〜は〜に騎乗している。」
   * @returns {{ok:boolean, reason?:string, message?:string}}
   */
  function canRide(g, target) {
    const p = g && g.player;
    if (!p || !target) return { ok: false, reason: 'no-target' };
    if (target === p) {
      return { ok: false, reason: 'self', message: TEXT.selfRide.replace('〜', p.name || '') };
    }
    // 319688：对方正在载人 → 需要先解散タッグ
    if ((target.get(168) | 0) !== 0) {
      return { ok: false, reason: 'tag', message: TEXT.tag };
    }
    // 319698：槽位 >= 16 → 不是同伴
    if ((target.index | 0) >= 16) {
      return { ok: false, reason: 'not-ally', message: TEXT.onlyAlly };
    }
    if (cbitOf(target, CG_ESCORT) === 1 || cbitOf(target, CG_PROTECTED) === 1) {
      return { ok: false, reason: 'escort', message: TEXT.noEscort };
    }
    // 319724：对方不在场
    if ((target.get(80) | 0) !== 0) {
      return { ok: false, reason: 'not-here', message: TEXT.notHere };
    }
    // 319732-319747：已经在骑乘
    const cur = mountOf(g);
    if (cur) {
      const m = g.charas ? g.charas[cur] : null;
      if (modeOf(g, m) === 0) {
        return { ok: false, reason: 'already-riding', message: TEXT.alreadyRiding(p.name || '', (m && m.name) || '') };
      }
      return { ok: false, reason: 'already-carrying', message: TEXT.alreadyCarrying(p.name || '', (m && m.name) || '') };
    }
    return { ok: true };
  }

  /**
   * 可骑乘的同伴列表（槽 1..15，且在场）。
   * @returns {object[]}
   */
  function candidates(g) {
    const out = [];
    const list = (g && g.charas) || [];
    for (let i = 1; i <= 15 && i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(80) | 0) !== 0) continue;
      out.push(c);
    }
    return out;
  }

  /**
   * 下马（319615-319685）：与当前坐骑互动时触发。
   * @returns {{ok:boolean, message?:string}}
   */
  function dismount(g) {
    const idx = mountOf(g);
    if (!idx) return { ok: false, reason: 'no-mount' };
    const m = (g.charas && g.charas[idx]) || null;
    const mode = modeOf(g, m);
    const name = (m && m.name) || '';
    const msg = (mode === 0)
      ? `你从${name}上下来了。`
      : `${name}从你身上下来了。`;
    end(g);
    return { ok: true, message: msg };
  }

  /** 目标是不是当前坐骑 */
  function isMount(g, target) {
    if (!target) return false;
    return mountOf(g) === (target.index | 0);
  }

  /**
   * 开始骑乘（ride_begin，194073-194117）。
   * @param {object} g
   * @param {object} mount 坐骑（同伴）
   * @param {number} mode 0 = 你骑它；1 = 它骑你
   * @returns {{ok:boolean, message?:string, reason?:string}}
   */
  function begin(g, mount, mode) {
    if (!g || !mount) return { ok: false, reason: 'no-mount' };
    const p = g.player;
    const m = mode | 0;
    mount.set(MODE_FIELD, m);
    setCbit(mount, CG_RIDING, 1);
    // 194089：坐骑所在格不再占用（骑上后与骑手同格）
    if (g.map && g.map.inBounds(mount.x, mount.y)) {
      const cell = g.map.cell(mount.x, mount.y);
      if (cell) cell[1] = 0;
    }
    g.setV65(MOUNT_SLOT, mount.index | 0);
    // 194091-194093：刷新玩家贴图 / 结束坐骑的 rowact / 重算速度
    //   0-DD：骑乘贴图需要 pcc_ridebk / pcc_ride 两层，提前预载
    if (Elona.PCC && Elona.PCC.preload) {
      if (Elona.PCC.ready && !Elona.PCC.ready(p, g)) Elona.PCC.preload(p, g).catch(() => { });
      else Elona.PCC.preload(p, g).catch(() => { });
    }
    if (mount.set) mount.set(141, 0);
    if (Elona.Stats && Elona.Stats.refreshSpeed) {
      Elona.Stats.refreshSpeed(p, g);
      Elona.Stats.refreshSpeed(mount, g);
    }
    const sp = mount.get(11) | 0;
    const msg = (m === 0)
      ? TEXT.rideOn(mount.name || '', sp)
      : TEXT.giveRide(mount.name || '', sp);
    const extra = [];
    if (m === 0 && cbitOf(mount, CG_GOOD_RIDER) === 1) extra.push(TEXT.goodRider);
    if (m === 0 && cbitOf(mount, CG_TOO_WEAK) === 1) extra.push(TEXT.tooWeak);
    return { ok: true, message: msg, extra, mode: m, mount: mount.index | 0 };
  }

  /**
   * 结束骑乘（ride_end，194118-194125）。
   */
  function end(g) {
    const idx = mountOf(g);
    if (!idx) return { ok: false, reason: 'no-mount' };
    const m = (g.charas && g.charas[idx]) || null;
    if (m) {
      setCbit(m, CG_RIDING, 0);
      if (m.set) m.set(141, 0);
      if (Elona.Stats && Elona.Stats.refreshSpeed) Elona.Stats.refreshSpeed(m, g);
    }
    g.setV65(MOUNT_SLOT, 0);
    const p = g.player;
    if (p && Elona.Stats && Elona.Stats.refreshSpeed) Elona.Stats.refreshSpeed(p, g);
    return { ok: true };
  }

  /**
   * 坐骑专用速度公式（193952-193973）。
   * 只在 c 为坐骑（或与坐骑相关）时改写速度。
   * @param {object} g
   * @param {object} c 正在重算速度的角色
   * @returns {boolean} 是否改写了速度
   */
  function applySpeed(g, c) {
    const idx = mountOf(g);
    if (!idx) return false;
    const p = g.player;
    const mount = (g.charas && g.charas[idx]) || null;
    if (!mount || !p) return false;
    const spd = (x) => x.skill(ATTR_SPD) | 0;
    const str = (x) => x.skill(ATTR_STR) | 0;
    const ride = (x) => x.skill(SKILL_RIDE) | 0;
    const mode = modeOf(g, mount);

    if (mode === 0) {
      // 玩家骑坐骑
      if (c === p) {
        const den = limit(100 + spd(mount) - str(mount) * 3 / 2
          - ride(mount) / 2 - ride(p) * 2
          - (cbitOf(mount, CG_GOOD_RIDER) === 1 ? 50 : 0), 100, 1000000);
        let v = idiv(spd(mount) * 100, den);
        if (cbitOf(mount, CG_TOO_WEAK) === 1) v = idiv(v, 10);
        p.set(11, v | 0);
        return true;
      }
      if (c === mount) {
        mount.set(11, limit(str(p) + ride(p), 10, spd(mount)) | 0);
        return true;
      }
      return false;
    }
    // 方式 1：坐骑骑玩家
    if (c === p) {
      p.set(11, limit(str(p) + ride(mount), 10, spd(p)) | 0);
      return true;
    }
    if (c === mount) {
      const den = limit(100 + spd(p) - str(p) * 3 / 2
        - ride(p) / 2 - ride(mount) * 2, 100, 1000000);
      let v = idiv(spd(p) * 100, den);
      const cap = spd(mount) * 3;
      if (v > cap) v = cap;
      mount.set(11, v | 0);
      return true;
    }
    return false;
  }

  /**
   * 骑乘菜单的 3 项（txtsetride，11104-11121）。
   * @returns {{label:string, mode:number}[]}
   */
  function menu() {
    return [
      { label: TEXT.cancel, mode: -1 },
      { label: TEXT.optRide, mode: 0 },
      { label: TEXT.optCarry, mode: 1 },
    ];
  }

  Elona.Riding = {
    MOUNT_SLOT, MODE_FIELD, CG_RIDING, SKILL_RIDE,
    mountOf, mountObj, modeOf, canRide, candidates, dismount, isMount,
    begin, end, applySpeed, menu,
    TEXT,
  };
})(window);
