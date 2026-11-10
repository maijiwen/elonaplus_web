'use strict';
/**
 * C 组：NPC 服务 / 菜单结算 / 事件收口规则（core/residual_npc.js）
 * 数据源 web/data/tables/residual_npc.json，由 tools/extract_residual_npc.py
 * 对 hsp/start.hsp（cp932）逐行校验后生成。
 *
 * 【源码区间逐条登记：每段均编译为 JSON 规则并提供可调用 API】
 *  590235-590401：label_4277 var_58(84) 店铺 / 仓库槽扫描 → shopSlotScan()
 *  590181-590234：label_4275/4276 随机生成物品 → randomItemGen()
 *  590190-590234：label_4276 flt 0,4 与 var_1023 等级公式 → randomItemGen()
 *  590402-590412：label_4278 装备位校验 → equipSlotCheck()
 *  590413-590456：label_4279 角色物品扫描 → characterItemScan()
 *  590457-590657：label_4280..4283 装备位遍历与取样 → equipmentScan()
 *  591142-591175：label_4289 仓库扫描 → warehouseScan()
 *  307377-307622：label_2915 乞讨本体 830 完整回合流程 → begFlow()
 *  300986-301181：label_2850 自定义菜单 var_444 分支 → prankEvent()
 *  283252-283321：label_2667 音效与文件列表分支 → prankSound()
 *  220463-220509：label_2246 调试标记与存档槽 → prankMark()
 *  300770-300915：label_2847 归航确认对话 → confirmDialogue()
 *  300758-300769：label_2846 任务归还检查 → questReturnCheck()
 *  295513-295599：label_2815 com_wear 同伴自动装备 → companionAutoEquip()
 *  295443-295512：label_2814 repeat 30 装备重量扫描 → equipWeightScan()
 *  299398-299476：label_2828 savecycle 与快捷栏结算 → seasonCycle()
 *  294372-294449：label_2789 var_444 雇佣 / 收养菜单 → hireResolve()
 *  289262-289329：label_2748 広域能力确认播报 → wideAbility()
 *  291069-291096：label_2750 命名确认播报 → namingPrompt()
 *  292143-292182：label_2776 能力门槛与威力文案 → abilityThreshold()
 *  292183-292600：label_2777/2778 var_472 物种候选清单 → npcSiteCandidates()
 *  304259-304410：label_2874..2878 一览构建与保存 → listPreprocess()
 *  304259-304297：label_2874 sdim 1024 缓冲与 var_541 20/22 → listPreprocess()
 *  304361-304410：label_2878 gosub 2873 一览前处理 → listPreprocess()
 *  300916-300964：label_2848 神託 413/414 道具检查 → oracleItemCheck()
 *  300412-300457：label_2839 射击选择结算 → selectionResolve()
 *  300383-300411：label_2838 战术指示 678 → tacticalOrder()
 *  300334-300382：label_2837 锁定目标有效性 → validateTarget()
 *  279353-279422：label_2625 shoptmp.s2 店铺临时数据 → shopData()
 *  302533-302561：label_2857 shop3.s2 数据结算 → shop3Settlement()
 *  308171-308242：label_2919 潜地一次性动作 → burrowFlow()
 *  308243-308426：label_2920 応援收尾与斗志溢出 → cheerFlow()
 *  220394-220436：label_2244 cbitmod 980 + rowactend 清场 → rowActEnd()
 *  285005-285049：label_2692 角色信息展示 → characterInfo()
 *  194576-194612：incognitobegin 变装 → incognitoBegin()
 *  29294-29312  ：fix_find 装备部位查找 → fixFind()
 *  32260-32261  ：calcshopreform 店铺改造计价 → shopReformCost()
 *  220358-220394：label_2242/2243 复活清场 → startupConstants()
 *  220510-220560：label_2247..2250 通名选择 → startupConstants()
 *  220619-220660：label_2251/2252 经历再抽选 → startupConstants()
 *  220812-220835：label_2256 页号环绕 → startupConstants()
 *  220984-221000：label_2261/2262 性别选择 → startupConstants()
 *  221656-221745：label_2275/2276 满意确认与角色写入 → startupConstants()
 *
 * 【数据加载】测试环境注入 Elona.ResidualNpcData 优先；浏览器环境走
 *  Elona.Data.tableSync('residual_npc')，另提供 load() 走 Elona.Data.table()。
 *
 * 【state 契约】流式 API 接收一个状态适配器，makeState() 生成默认实现：
 *  getV58(field, idx) / setV58(field, idx, v) 读取角色二维数组
 *  getV65(i) / setV65(i, v)                  读取全局一维数组
 *  rnd(n)                                   0..n-1 的随机源，可用队列驱动
 *  snd(id) / news(type, idx) / log(text)    音效 / 新闻 / 文本出口
 *  cbit(id, idx) / cbitmod(id, idx, v)      位标志
 *  itemField(idx, field) / setItemField(...) 物品字段
 *  map132(field, mapId)                     地图数据表
 *  notes                                    新闻缓冲（供 195 条裁剪）
 */
(function(global){
  const Elona = global.Elona = global.Elona || {};

  let DATA = null;

  function setData(t) { DATA = t || null; return DATA; }

  function tableSync() {
    if (DATA) return DATA;
    if (Elona.ResidualNpcData) {
      DATA = Elona.ResidualNpcData;
    } else if (Elona.Data && Elona.Data.tableSync) {
      try { DATA = Elona.Data.tableSync('residual_npc'); } catch (e) { DATA = null; }
    }
    return DATA;
  }

  async function load() {
    if (DATA) return DATA;
    if (Elona.ResidualNpcData) {
      DATA = Elona.ResidualNpcData;
    } else if (Elona.Data && Elona.Data.table) {
      try { DATA = await Elona.Data.table('residual_npc'); } catch (e) { DATA = null; }
    }
    return DATA;
  }

  function T() { return tableSync() || {}; }

  // ---------------------------------------------------------------- 基础工具
  function idiv(a, b) { return b === 0 ? 0 : Math.trunc(a / b); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lang(s) { return (s && s.lang === 'jp') ? 'jp' : 'en'; }

  function fmt(t, vars) {
    if (typeof t !== 'string') return t;
    return t.replace(/\{(\w+)\}/g, (m, k) =>
      (vars && vars[k] !== undefined) ? String(vars[k]) : m);
  }

  /** 取 TEXT 里的 [日, 英] 文案 */
  function textOf(key, L, vars) {
    const t = (T().text || {})[key];
    if (!t) return '';
    if (Array.isArray(t)) return fmt(t[L === 'jp' ? 0 : (t.length > 1 ? 1 : 0)], vars);
    return fmt(t, vars);
  }

  /** 取 TEXT 里的多候选文案数组 */
  function textList(key) {
    const t = (T().text || {})[key];
    return Array.isArray(t) ? t.slice() : (t ? [t] : []);
  }

  function gv(s, f, i) { return s && s.getV58 ? (s.getV58(f, i) | 0) : 0; }
  function sv(s, f, i, v) { if (s && s.setV58) s.setV58(f, i, v); }
  function v65(s, i) { return s && s.getV65 ? (s.getV65(i) | 0) : 0; }
  function s65(s, i, v) { if (s && s.setV65) s.setV65(i, v); }
  function rnd(s, n) { return s && s.rnd ? (s.rnd(n) | 0) : 0; }
  function snd(s, id) { if (s && s.snd) s.snd(id); }
  function news(s, type, idx) { if (s && s.news) s.news(type, idx); }
  function log(s, t) { if (s && s.log) s.log(t); }
  function cbitmod(s, id, idx, v) { if (s && s.cbitmod) s.cbitmod(id, idx, v); }
  function cbit(s, id, idx) { return s && s.cbit ? (s.cbit(id, idx) | 0) : 0; }
  function map132(s, field, mapId) {
    return s && s.map132 ? (s.map132(field, mapId) | 0) : 0;
  }
  function sync(s, idx) { return s && s.sync ? !!s.sync(idx) : true; }

  /** 默认内存状态适配器，供流式 API 与测试直接调用 */
  function makeState(init) {
    const v58 = new Map(), v65m = new Map(), items = new Map(), cbits = new Map();
    const key = (f, i) => f + ':' + i;
    const st = {
      lang: 'en',
      logs: [], sounds: [], newsLog: [], notes: [], delbuffs: [], rowactends: [],
      _queue: [],
      getV58(f, i) { return v58.get(key(f, i)) | 0; },
      setV58(f, i, v) { v58.set(key(f, i), v | 0); },
      getV65(i) { return v65m.get(i) | 0; },
      setV65(i, v) { v65m.set(i, v | 0); },
      itemField(i, f) { return (items.get(key(f, i)) | 0); },
      setItemField(i, f, v) { items.set(key(f, i), v | 0); },
      cbit(id, i) { return cbits.get(key(id, i)) | 0; },
      cbitmod(id, i, v) { cbits.set(key(id, i), v | 0); },
      rnd(n) {
        const q = this._queue;
        if (q && q.length) return (q.shift() | 0) % Math.max(1, n | 0);
        return 0;
      },
      snd(id) { this.sounds.push(id); },
      news(type, idx) { this.newsLog.push([type, idx]); },
      addnews2(t) { this.logs.push(t); },
      log(t) { this.logs.push(t); },
      delbuff(i, n) { this.delbuffs.push([i, n]); },
      rowactend(i) { this.rowactends.push(i); },
      map132() { return 0; },
      sync() { return true; },
      decfame(i, v) { this.newsLog.push(['fame', i, v]); return v; },
      skillexp(skill, i, v) { this.newsLog.push(['skillexp', skill, i, v]); },
      healsp(i, v) { this.newsLog.push(['healsp', i, v]); },
    };
    return Object.assign(st, init || {});
  }

  // ---------------------------------------------------------------- 段与区间
  function segments() { return (T().segments || []).slice(); }
  function src() { return T().src || {}; }
  function srcOf(k) { return (T().src || {})[k] || ''; }
  function constants() { return T().constants || {}; }
  function text() { return T().text || {}; }

  /** 590240 / 307402 / 301166 的绝对时间公式：时 + 日*24 + 月*720 + 年*8640 */
  function absoluteTime(hour, day, month, year) {
    const C = constants().absTime || { coeffs: [1, 24, 720, 8640] };
    const c = C.coeffs;
    return (hour | 0) * c[0] + (day | 0) * c[1] + (month | 0) * c[2] + (year | 0) * c[3];
  }
  function absTime(s) {
    const C = constants().absTime || { vars: [13, 12, 11, 10], coeffs: [1, 24, 720, 8640] };
    let t = 0;
    for (let i = 0; i < C.vars.length; i++) t += v65(s, C.vars[i]) * C.coeffs[i];
    return t;
  }

  // ---------------------------------------------------------------- 规则读取
  const rules = (k) => T()[k] || {};
  function shopSlotRules() { return rules('shopSlot'); }
  function itemGenRules() { return rules('itemGen'); }
  function begRules() { return rules('beg'); }
  function prankRules() { return rules('prank'); }
  function confirmRules() { return rules('confirm'); }
  function hireRules() { return rules('hire'); }
  function seasonRules() { return rules('season'); }
  function comWearRules() { return rules('comWear'); }
  function equipWeightRules() { return rules('equipWeight'); }
  function wideAbilityRules() { return rules('wideAbility'); }
  function abilityThresholdRules() { return rules('abilityThreshold'); }
  function speciesRules() { return rules('species'); }
  function listPreRules() { return rules('listPre'); }
  function oracleRules() { return rules('oracle'); }
  function selectionRules() { return rules('selection'); }
  function targetLockRules() { return rules('targetLock'); }
  function shopDataRules() { return rules('shopData'); }
  function rowActRules() { return rules('rowAct'); }
  function charInfoRules() { return rules('charInfo'); }
  function incognitoRules() { return rules('incognito'); }
  function startupRules() { return rules('startup'); }
  function fixFindRules() { return rules('fixFind'); }
  function shopReformRules() { return rules('shopReform'); }

  // 590235-590401：随机站点 id 选取（repeat 10 / rnd(4)==0 → 450..499 / 类型门限）
  function pickMap(s, R) {
    let picked = R.forceValue;
    for (let cnt = 0; cnt < R.repeat; cnt++) {
      let id = (rnd(s, R.hiChance) === 0)
        ? R.hiRange[0] + rnd(s, R.hiRange[1] - R.hiRange[0])
        : R.loRange[0] + rnd(s, R.loRange[1] - R.loRange[0]);
      const force = R.forceIds.indexOf(id) >= 0 || map132(s, 16, id) === 0
        || map132(s, 0, id) === 7;
      if (force) id = R.forceValue;
      for (const g of R.gates) {
        if (map132(s, g.typeField, id) === g.type && v65(s, g.fameVar) < g.lt) id = g.set;
      }
      picked = id;
      if (cnt < R.firstN && map132(s, R.typeField, id) !== R.firstNType) continue;
      break;
    }
    return picked;
  }

  // 590181-590234：flt 0,4 / 等级 limit(rnd(60+lv)+1,1,200) / characreate 候选
  function randomItemGen(s, idx) {
    const R = itemGenRules();
    if (v65(s, R.guard.var) === R.guard.value) return { skipped: true, idx };
    const level = clamp(rnd(s, R.level.base + gv(s, 38, 0)) + 1,
      R.level.clamp[0], R.level.clamp[1]);
    const cid = R.characreateIds[rnd(s, 3) % R.characreateIds.length];
    for (const k in R.initFields) sv(s, parseInt(k, 10), idx, R.initFields[k]);
    for (const k in R.rndFields) sv(s, parseInt(k, 10), idx, 0);
    let map = rnd(s, 450);
    if (map132(s, 16, map) === 0 || map132(s, 0, map) === 7) map = R.mapPick.forceValue;
    for (const g of R.mapPick.gates) {
      if (map132(s, 30, map) === g.type && v65(s, g.fameVar) < g.lt) map = g.set;
    }
    for (const e of R.mapPick.extras) if (rnd(s, e.chance) === 0) map = e.set;
    sv(s, R.mapPick.assign.field, idx, map);
    sv(s, R.mapPick.assign.flagField, idx, R.mapPick.assign.flag);
    sv(s, R.goldField.field, idx,
      Math.trunc(level * Math.sqrt(level + 1) * 30)
      + rnd(s, level * 200 + 100) + rnd(s, 500));
    return { idx, level, creatureId: cid, map, goldField: R.goldField.field };
  }

  /** 590181-590189：label_4275 的 var_41 入口与 repeat 39,16 */
  function itemGenGuard(s) {
    const R = itemGenRules();
    return { guarded: v65(s, R.guard.var) === R.guard.value, loop: R.loop };
  }

  // 590402-590412：refitem 的 57000/52000/53000 与 cbit(1050)
  function equipSlotCheck(s, idx, itemIdx, refId) {
    const R = itemGenRules().equipSlotCheck;
    let hit = R.refIds.indexOf(refId) >= 0;
    if (cbit(s, R.cbit, idx) === 1 && s.itemField
      && s.itemField(itemIdx, R.cbitItemField) === R.cbitItemValue) hit = true;
    if (hit && s.setV58) sv(s, R.setField, idx, itemIdx);
    return { hit, setField: R.setField, itemIdx };
  }

  // 590413-590456：inv_getheader + repeat 10 的物品扫描
  function characterItemScan(s, idx) {
    const R = itemGenRules().itemScan;
    let found = -1;
    for (let k = 0; k < R.repeat; k++) {
      const slot = (s.itemBase | 0) + rnd(s, Math.max(1, s.itemCount | 0));
      if (!s.itemField || s.itemField(slot, 0) === 0) { found = slot; break; }
      if (s.itemField(slot, 18) !== 0) continue;
      if (s.setItemField) s.setItemField(slot, 0, 0);
      found = slot; break;
    }
    if (found < 0) return { idx, found: false };
    if (s.setItemField) {
      s.setItemField(found, R.setField, R.setValue);
      s.setItemField(found, 0, 1);
    }
    const quality = s.itemField ? s.itemField(found, R.qualityField) : 0;
    if (quality >= R.qualityMin) news(s, R.news, idx);
    return { idx, found: true, slot: found, quality, poolChance: R.poolChance };
  }

  // 590483-590657：iequiploc / repeat 30,100 / 装备类别 → var_638 值
  function equipmentScan(s, owner, itemIdx) {
    const R = itemGenRules().equipScan, C = itemGenRules().randomEquip.category;
    const bodyParts = R.bodyParts.slice();
    const candidates = [];
    const loc = s.itemField ? s.itemField(itemIdx, 8) : 0;
    for (let i = 0; i < R.count; i++) {
      const slot = R.start + i;
      const v = gv(s, slot, owner);
      if (v === 0) continue;
      const body = idiv(v, R.divisor);
      if (bodyParts.indexOf(body) >= 0 || body === 5) candidates.push({ slot, body });
    }
    return { owner, itemIdx, loc, bodyParts, candidates, category: C };
  }

  /** 590605-590631：装备类别 → var_638 / var_639 常量 */
  function equipCategoryCode(body) {
    const C = itemGenRules().randomEquip.category;
    return C[String(body)] !== undefined ? C[String(body)] : 0;
  }

  // 591142-591175：var_65(70)==1006 仓库扫描与护送复位
  function warehouseScan(s) {
    const R = itemGenRules().warehouse;
    if (v65(s, R.triggerVar) === R.triggerValue) {
      let cleared = 0;
      if (s.itemField && s.setItemField) {
        const n = s.itemCount | 0;
        for (let i = 0; i < n; i++) {
          if (s.itemField(i, R.clearItemField) === R.clearItemValue) {
            s.setItemField(i, 0, 0); cleared++;
          }
        }
      }
      return { phase: 'warehouse', cleared };
    }
    if (v65(s, R.skipVar) !== R.skipValue) {
      const esc = s.escortCheck ? (s.escortCheck() | 0) : 1;
      if (v65(s, R.escortVar) === R.escortValue && esc === 0) {
        for (let i = 0; i < R.reset.length; i++) s65(s, R.escortVar + i, R.reset[i]);
        return { phase: 'escort-abandon', text: R.leftClient[1] };
      }
    }
    return { phase: 'none' };
  }

  // ---------------------------------------------------------------- 590235-590401 槽扫描
  function shopSlotScan(s) {
    const R = shopSlotRules(), L = lang(s);
    const out = {
      start: R.loop.start, count: R.loop.count, expired: [], skipped: [],
      regenerated: [], news: [], relocated: [], growth: [], levelUps: [],
      trimmed: 0,
    };
    for (let i = 0; i < R.loop.count; i++) {
      const idx = R.loop.start + i;
      const t = absTime(s);
      const contract = gv(s, R.contract.field, idx);
      if (contract !== 0 && contract < t) {
        for (const f of R.contract.resetFields) sv(s, f, idx, 0);
        cbitmod(s, R.contract.cbit, idx, 0);
        out.expired.push(idx);
        log(s, textOf(R.contract.textKey, L, { name: 'NPC' + idx }));
      }
      if (gv(s, R.skipCurrentMap.field, idx) === v65(s, R.skipCurrentMap.equalsVar)) {
        out.skipped.push(idx); continue;
      }
      const state = gv(s, 0, idx);
      if (state === R.state5.state) {
        randomItemGen(s, idx); out.regenerated.push(idx); continue;
      }
      if (state === R.state4.state && t >= gv(s, R.state4.deadlineField, idx)) {
        const flag = gv(s, R.state4.flagField, idx);
        const hit = rnd(s, 3) === 0 || flag === R.state4.flagRecall;
        if (hit) {
          if (flag === R.state4.flagRecall) {
            sv(s, R.state4.flagField, idx, 0);
            log(s, textOf(R.state4.textKey, L, { name: 'NPC' + idx }));
          }
          news(s, R.state4.newsRecall, idx); out.news.push(R.state4.newsRecall);
          sv(s, 0, idx, 0); randomItemGen(s, idx);
        } else {
          if (flag === R.state4.flagQuiet) {
            sv(s, R.state4.flagField, idx, 0);
            log(s, textOf(R.state4.textKey, L, { name: 'NPC' + idx }));
          }
          news(s, R.state4.newsQuiet, idx); out.news.push(R.state4.newsQuiet);
          sv(s, 0, idx, R.state4.resultState);
        }
        continue;
      }
      if (rnd(s, R.mapPick.chance) === 0
        || gv(s, 80, idx) === R.mapPick.rerunWhen) {
        const map = pickMap(s, R.mapPick);
        sv(s, R.mapPick.assign.field, idx, map);
        sv(s, R.mapPick.assign.flagField, idx, R.mapPick.assign.flag);
        out.relocated.push({ idx, map });
      }
      if (rnd(s, R.itemScan.chance) === 0
        && map132(s, R.itemScan.typeField, gv(s, 80, idx)) !== R.itemScan.excludeType) {
        characterItemScan(s, idx);
      }
      if (gv(s, R.clampNegative.field, idx) < 0) sv(s, R.clampNegative.field, idx, 0);
      const level = clamp(gv(s, 38, idx), 1, 3000);
      if (rnd(s, 10) === 0) {
        const d = level * level * 2;
        sv(s, 35, idx, gv(s, 35, idx) + d);
        out.growth.push({ idx, kind: 'lv2x2', value: d });
      }
      if (rnd(s, 20) === 0) {
        const a = Math.trunc(level * Math.sqrt(level + 1) / 40 + 5);
        const b = Math.trunc(level * Math.sqrt(level + 1) / 50 + 5);
        const d = clamp(rnd(s, a) - rnd(s, b), 2, 999);
        sv(s, 34, idx, gv(s, 34, idx) + d);
        out.growth.push({ idx, kind: 'sqrt', value: d });
      }
      if (rnd(s, 2000) === 0) {
        const d = level * level * 10;
        const bonus = rnd(s, Math.trunc(level * Math.sqrt(level + 1) / 10 + 10));
        sv(s, 35, idx, gv(s, 35, idx) + d);
        sv(s, 34, idx, gv(s, 34, idx) + bonus);
        news(s, 4, idx); out.news.push(4);
        characterItemScan(s, idx);
        out.growth.push({ idx, kind: 'lv2x10', value: d, bonus });
      }
      if (gv(s, 35, idx) >= gv(s, 36, idx)) out.levelUps.push(idx);
    }
    const notes = s.notes || [];
    if (notes.length > constants().notesMax) {
      out.trimmed = notes.length - constants().notesMax;
      for (let k = 0; k < out.trimmed; k++) notes.shift();
    }
    return out;
  }

  // ---------------------------------------------------------------- 307377-307622 乞讨
  /** 307505-307517：施舍额公式（等级*2+5 / 商人 / 上限夹取） */
  function begGold(level, goldOwned, ctx) {
    const G = begRules().collect.gold, c = ctx || {};
    let amt = (level | 0) * 2 + 5;
    if (c.npcIndex !== undefined && (c.npcIndex | 0) < G.townNpcUnder) amt = G.townNpcValue;
    const role = c.role | 0;
    if ((role >= G.shopRoleRange[0] && role < G.shopRoleRange[1])
      || role === G.shopRoleExact) amt = idiv(amt, G.shopRoleDiv);
    if (c.merchant) amt = clamp(idiv(amt + 1, 5) + 1, 1, 300);
    if (amt > (goldOwned | 0)) amt = goldOwned | 0;
    return amt < 0 ? 0 : amt;
  }

  function begFameLoss() { return begRules().end.fameLoss; }

  function begFlow(s, actor) {
    const R = begRules(), C = R.collect, L = lang(s);
    const state = gv(s, R.stateField, actor);
    if (state === 0) {
      if (sync(s, actor)) log(s, textOf(R.start.textKey, L, { name: 'NPC' + actor }));
      sv(s, R.stateField, actor, R.start.state);
      sv(s, R.counterField, actor, R.start.counter);
      sv(s, R.totalField, actor, R.start.total);
      if (actor === 0 && s.setVar) s.setVar('var_2368', 0);
      return { phase: 'start', state: R.start.state, counter: R.start.counter,
        total: R.start.total, makeSound: R.start.makeSound };
    }
    const counter = gv(s, R.counterField, actor);
    if (counter > 0) {
      const res = { phase: 'collect', interval: C.interval, gained: 0, donated: [],
        drops: [], refused: [], snd: 0 };
      if (counter % C.interval === 0) {
        const list = s.charas || Array.from({ length: C.scanRepeat }, (_, i) => i);
        const t = absTime(s);
        for (const idx of list) {
          if (idx === actor) continue;
          if (gv(s, 0, idx) !== C.aliveState) continue;
          if (t >= gv(s, C.timeField, idx)) sv(s, C.impressionField, idx, C.impressionReset);
          if (!sync(s, idx)) {
            if (s.dist && s.dist(actor, idx) > C.distLimit) continue;
          }
          if (gv(s, C.impressionField, idx) <= 0) continue;
          if (gv(s, 251, idx) > 0 || gv(s, 256, idx) >= 60) continue;
          if (cbit(s, C.skipCbit, idx) === 1) continue;
          if (actor === 0 && idx >= 16) {
            sv(s, C.impressionField, idx, gv(s, C.impressionField, idx) - rnd(s, 15));
            sv(s, C.timeField, idx, t + C.timeOffset);
          }
          if (gv(s, 9, idx) === C.noticeState) {
            sv(s, C.noticeField, idx, C.noticeValue);
            res.refused.push({ idx, kind: 'notice' }); continue;
          }
          if (gv(s, C.impressionField, idx) <= 0) {
            log(s, textList(L === 'jp' ? C.refuseTextJp : C.refuseTextEn)[0]);
            sv(s, C.impressionField, idx, 0);
            res.refused.push({ idx, kind: 'refuse' }); continue;
          }
          if (gv(s, 30, actor) > gv(s, 30, idx) && idx >= 16) {
            res.refused.push({ idx, kind: 'rich' }); continue;
          }
          if (rnd(s, C.giveChance) === 0) {
            const amt = begGold(gv(s, 38, idx), gv(s, 30, idx), {
              npcIndex: idx, role: gv(s, 150, idx),
              merchant: cbit(s, 23, idx) === 1 || cbit(s, 27, idx) === 1
                || cbit(s, 964, idx) === 1,
            });
            if (amt > 0) {
              sv(s, 30, idx, gv(s, 30, idx) - amt);
              sv(s, 30, actor, gv(s, 30, actor) + amt);
              res.gained += amt; res.donated.push({ idx, amt });
              if (actor === 0 && idx >= 16) {
                sv(s, C.impressionField, idx, gv(s, C.impressionField, idx) - 20);
                sv(s, C.timeField, idx, t + C.timeOffset);
              }
            }
          }
          if (actor === 0 && idx >= 16 && rnd(s, 2 * (s.var_2368 | 0) + 4) === 0) {
            const item = begDropItem(s, C.drop);
            if (item) res.drops.push({ idx, itemId: item });
          }
        }
        if (res.gained > 0) {
          sv(s, R.totalField, actor, gv(s, R.totalField, actor) + res.gained);
          snd(s, C.snd); res.snd = C.snd;
        }
      }
      return res;
    }
    if (gv(s, R.totalField, actor) !== 0) {
      log(s, textOf(R.end.textKey, L,
        { name: 'NPC' + actor, gold: gv(s, R.totalField, actor), unit: ' ' }));
      const lost = s.decfame ? s.decfame(actor, R.end.fameLoss) : R.end.fameLoss;
      log(s, textOf(R.end.fameTextKey, L, { name: 'NPC' + actor, fame: lost }));
      if (s.rowactend) s.rowactend(actor);
      return { phase: 'end', total: gv(s, R.totalField, actor), fameLoss: lost,
        txtef: R.end.txtef, rowactend: true };
    }
    if (s.rowactend) s.rowactend(actor);
    return { phase: 'end-empty', rowactend: true };
  }

  /** 307556-307567：rnd(5/10/20/30) → 187/258/812/571 */
  function begDropItem(s, D) {
    let id = 0;
    for (const d of D.items) if (rnd(s, d.rnd) === 0) id = d.item;
    return id;
  }

  // ---------------------------------------------------------------- 300986-301181 自定义菜单
  function prankDisabledMap(s) {
    const R = prankRules();
    return { wizard: !!v65(s, R.wizardVar),
      mapBlocked: R.disabledMaps.indexOf(v65(s, 20)) >= 0,
      maps: R.disabledMaps.slice(), snd: R.snd };
  }

  /** 301022-301034：a..f 菜单（wizard 模式隐藏 e/f） */
  function prankMenu(s) {
    const R = prankRules(), L = lang(s);
    const wizardFree = v65(s, R.wizardVar) === 0;
    return R.menu
      .filter((m) => wizardFree || R.wizardOnlyKeys.indexOf(m.key) < 0)
      .map((m) => ({ key: m.key, label: L === 'jp' ? m.jp : m.en, jp: m.jp, en: m.en }));
  }

  /** 301040-301180：var_444 0..5 的分支结算 */
  function prankResolve(s, choice) {
    const R = prankRules();
    const b = R.branches.find((x) => x.choice === (choice | 0));
    if (!b) return { choice, action: 'none' };
    if (b.choice === 4) {
      const blocked = v65(s, 20) === b.noArea;
      const levelLow = gv(s, 38, 0) < b.levelMin;
      const cooling = v65(s, b.cooldownVar) > absTime(s);
      return { choice, action: 'upload', blocked, levelLow, cooling,
        levelMin: b.levelMin, gosub: b.gosub };
    }
    return { choice, action: 'branch', file: b.file || null, gosub: b.gosub || null,
      param: b.param, exec: b.exec || null };
  }

  function prankEvent(s) {
    const R = prankRules(), L = lang(s);
    const guard = prankDisabledMap(s);
    if (guard.wizard) {
      snd(s, R.snd);
      return { blocked: 'wizard', snd: R.snd, text: R.wizardText[L === 'jp' ? 0 : 1], menu: [] };
    }
    if (guard.mapBlocked) {
      snd(s, R.snd);
      return { blocked: 'map', snd: R.snd, text: R.mapText[L === 'jp' ? 0 : 1], menu: [] };
    }
    return { blocked: null, title: R.title[L === 'jp' ? 0 : 1],
      selectWidth: R.selectWidth, menu: prankMenu(s),
      teamName: R.teamName, branches: R.branches };
  }

  // 283252-283321：音效 / 文件模式 / 临时文件名集合
  function prankSound(s) {
    const S = prankRules().sound;
    const pattern = S.patterns[String(s.roomMode | 0)] || S.patterns['0'];
    if (s.snd) s.snd(S.saveSnd);
    if (s.snd) s.snd(S.openSnd);
    return { saveSnd: S.saveSnd, openSnd: S.openSnd, buffer: S.buffer,
      page: S.page, pattern, tempNames: S.tempNames.slice(),
      savingText: S.savingText, roomText: S.roomText, teamText: S.teamText };
  }

  // 220463-220509：var_1480 → var_65(828)=1；调试身份与存档槽
  function prankMark(s) {
    const M = prankRules().mark;
    if (s.var_1480) s65(s, M.wizardVar, 1);
    if (v65(s, M.devFlag) === 1) {
      return { wizard: true, dev: M.dev, saveSlotMax: M.saveSlotMax };
    }
    return { wizard: !!s.var_1480, dev: null, saveSlotMax: M.saveSlotMax,
      fullText: M.fullText };
  }

  // ---------------------------------------------------------------- 300770-300915 归航对话
  function questReturnCheck(s) {
    const Q = confirmRules().questCheck;
    let hit = 0;
    for (let i = 0; i < Q.repeat; i++) {
      const id = v65(s, Q.questVar + i);
      if (s.questFlag && s.questFlag(id, Q.flagField) === Q.flagValue
        && Q.types.indexOf(s.questType && s.questType(id)) >= 0) { hit = 1; break; }
    }
    return { hit, text: confirmRules().questText, yes: ['y', '0'], no: ['n', '1'] };
  }

  function confirmGates(s) {
    const R = confirmRules();
    const fame = v65(s, 252), map = v65(s, 20), depth = v65(s, 22);
    return R.bossGates.filter((g) => fame >= g.lo && fame < g.hi
      && map === g.map && depth === g.depth);
  }

  /** 300819-300875：repeat 500 的归航地点清单 */
  function confirmMapList(s) {
    const R = confirmRules(), fame = v65(s, R.fameVar);
    const curMap = v65(s, 20), curDepth = v65(s, 22), out = [];
    const firstCond = (curMap !== 43 && curMap !== 33 && curMap !== 73)
      || curDepth !== R.excludeDepth;
    if (firstCond && map132(s, 30, R.firstMap) === fame) {
      out.push({ map: R.firstMap, depth: 1 });
    }
    for (let k = 0; k < R.scanRepeat; k++) {
      const id = R.scanRepeat - (k + 1);
      const type = map132(s, R.typeField, id);
      if ((curMap === 43 || curMap === 33) && curDepth === R.excludeDepth) continue;
      if (type === 0 || map132(s, 30, id) !== fame) continue;
      if (type === R.excludedType || map132(s, 6, id) === 0) continue;
      const ok = R.resetTypes.indexOf(type) >= 0 || R.allowedTypes.indexOf(type) >= 0;
      if (!ok) continue;
      const depth = R.resetTypes.indexOf(type) >= 0
        ? map132(s, 17, id) : map132(s, 6, id);
      out.push({ map: id, depth, rank: depth - map132(s, 17, id) + 1 });
    }
    return out;
  }

  function confirmDialogue(s) {
    const R = confirmRules(), L = lang(s);
    const gates = confirmGates(s);
    if (gates.length) {
      snd(s, gates[0].snd);
      return { blocked: true, snd: gates[0].snd,
        text: gates[0].text[L === 'jp' ? 0 : 1] };
    }
    const quest = questReturnCheck(s);
    const maps = confirmMapList(s);
    if (!maps.length) return { noPlace: true, quest: quest.hit,
      text: R.noPlaceText[L === 'jp' ? 0 : 1], maps: [] };
    return { quest: quest.hit, maps, ask: R.askText[L === 'jp' ? 0 : 1],
      air: R.airText[L === 'jp' ? 0 : 1], dungeon: R.dungeonText,
      selectWidth: R.selectWidth, setVars: R.setVars };
  }

  // ---------------------------------------------------------------- 294372-294449 雇佣菜单
  function resolveHireValue(v, ctx) {
    if (typeof v === 'number') return v;
    const c = ctx || {};
    let m = /^var_58\((\d+),var_243\)$/.exec(v);
    if (m) return (c.v58 && c.v58[+m[1]]) | 0;
    m = /^cbit\((\d+),var_243\)$/.exec(v);
    if (m) return (c.cbits && c.cbits[+m[1]]) | 0;
    m = /^var_508\((\d+),var_243\)([\\/])1000$/.exec(v);
    if (m) {
      const raw = (c.p508 && c.p508[+m[1]]) | 0;
      return m[2] === '\\' ? (raw % 1000) : idiv(raw, 1000);
    }
    return v;
  }

  function hireResolve(s, mode, choice, ctx) {
    const R = hireRules();
    const m = R.modes[(mode | 0) === 1 ? 1 : 0];
    const c = m.choices.find((x) => x.choice === (choice | 0));
    if (!c) return { choice, value: [R.default], key: '' };
    let raw = c.value, key = c.key || '';
    if (c.elseValue && ctx && ctx.player) { raw = c.elseValue; key = c.elseKey || ''; }
    return { choice, value: raw.map((v) => resolveHireValue(v, ctx)), key, raw };
  }

  // ---------------------------------------------------------------- 299398-299476 savecycle
  function leaveItemsConfirm(s) {
    const R = seasonRules().leaveItems, L = lang(s);
    const needed = (v65(s, R.itemCountVar) > 0) && (s.var_486_1 === R.subCmd);
    return { needed, cmd: R.cmd, text: textOf(R.textKey, L),
      yes: R.yes, no: R.no, width: R.width };
  }

  /** 299458-299468：快捷栏 id = 物品 id + 命令*10000，槽位 40+var_186 */
  function seasonShortcut(s, cmd, itemId, keyIndex) {
    const R = seasonRules().shortcut;
    if (R.cmds.indexOf(cmd | 0) < 0) return { ok: false, reason: 'cmd' };
    const slot = R.slotBase + (keyIndex | 0);
    const id = (itemId | 0) + (cmd | 0) * R.multiplier;
    if (v65(s, slot) === id) {
      s65(s, slot, 0);
      return { ok: true, cleared: true, id, slot };
    }
    for (let i = 0; i < R.repeat; i++) {
      if (v65(s, R.slotBase + i) === id) s65(s, R.slotBase + i, 0);
    }
    s65(s, slot, id);
    snd(s, R.assignSnd);
    return { ok: true, cleared: false, id, slot, snd: R.assignSnd };
  }

  function seasonCycle(s) {
    const R = seasonRules();
    return { savecycle: R.savecycle, leaveItems: leaveItemsConfirm(s),
      reset: R.reset, shortcutCmds: R.shortcut.cmds.slice(),
      tag: R.shortcut.tag, cargoSnd: R.shortcut.cargoSnd,
      assignSnd: R.shortcut.assignSnd, repeat: R.shortcut.repeat };
  }

  // ---------------------------------------------------------------- 295513-295599 com_wear
  function comWearList(s, ctx) {
    const R = comWearRules(), c = ctx || {}, out = [];
    const filter = R.var97Filter;
    for (let i = 0; i < R.repeat.count; i++) {
      const slot = R.repeat.start + i;
      const raw = gv(s, slot, c.actor || 0);
      if (raw === 0) continue;
      const body = idiv(raw, R.divisor);
      let skip = false;
      for (const k in filter) {
        if (c.var97 && c.var97[k] && filter[k] === body) { skip = true; break; }
      }
      if (skip) continue;
      out.push({ slot, body, raw });
    }
    return out;
  }

  function companionAutoEquip(s, ctx) {
    const R = comWearRules();
    return { label: R.label, page: R.page, counterExpr: R.counterExpr,
      repeat: R.repeat, list: comWearList(s, ctx), firstBodyPart: R.firstBodyPart,
      window: R.window, snd: R.snd, sndCondition: R.sndCondition };
  }

  // ---------------------------------------------------------------- 295443-295512 装备重量
  function equipWeightVerdict(weight, mask, count, buffFound, skillValue) {
    const R = equipWeightRules(), out = [];
    const weak = buffFound === -1 || (skillValue | 0) < R.skillThreshold;
    if ((mask | 0) & R.twoHand.flagMask) {
      out.push((weight | 0) >= R.twoHand.heavy ? 'twoHandFit' : 'twoHandLight');
    }
    if ((mask | 0) & R.dualWield.flagMask) {
      if ((count | 0) === 1) {
        if ((weight | 0) >= R.dualWield.singleHeavy && weak) out.push('dualSingleHeavy');
      } else if ((weight | 0) > R.dualWield.otherHeavy && weak) {
        out.push('dualOtherHeavy');
      }
    }
    return out;
  }

  function equipWeightScan(s, ctx) {
    const R = equipWeightRules(), c = ctx || {};
    const out = { repeat: R.repeat, bodyPart: R.bodyPart, items: [] };
    let count = 0;
    for (let i = 0; i < R.repeat.count; i++) {
      const slot = R.repeat.start + i;
      const raw = gv(s, slot, c.actor || 0);
      if (raw === 0 || idiv(raw, R.divisor) !== R.bodyPart) continue;
      const itemIdx = (raw % R.divisor) - 1;
      if (itemIdx < 0) continue;
      count++;
      const weight = s.itemField ? s.itemField(itemIdx, R.weightField) : 0;
      const verdicts = equipWeightVerdict(weight, c.mask | 0, count,
        c.buffFound === undefined ? -1 : c.buffFound, c.skillValue | 0);
      out.items.push({ slot, itemIdx, weight, verdicts });
    }
    if (v65(s, R.ridingVar) !== 0 && out.items.length) {
      const w = out.items[out.items.length - 1].weight;
      if (w >= R.weightHeavy && (c.buffFound === -1 || (c.skillValue | 0) < R.skillThreshold)) {
        out.items[out.items.length - 1].verdicts.push('ridingHeavy');
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 289262-289329 / 291069-291096
  function wideAbility(s) {
    const R = wideAbilityRules();
    return { directionText: R.directionText, targetExpr: R.targetExpr,
      switch: R.switch, width: R.switch.width, cmd: R.switch.cmd, snd: R.switch.snd };
  }

  function namingPrompt(s, name) {
    const R = wideAbilityRules().naming, L = lang(s);
    if (!name) return { named: false, text: textOf(R.stopKey, L), cbitmod: R.cbitmod };
    if (s.setV63) s.setV63(0, s.targetIndex || 0, name);
    if (s.cbitmod) s.cbitmod(R.cbitmod, s.targetIndex || 0, 1);
    return { named: true, name, text: textOf(R.doneKey, L,
      { name, him: 'them' }), cbitmod: R.cbitmod, width: R.width };
  }

  // ---------------------------------------------------------------- 292143-292182 能力门槛
  function abilityPowerText(ctx) {
    const R = abilityThresholdRules(), c = ctx || {};
    if (c.buffFlag) return { kind: 'buff', divisor: R.buffDivisor };
    if ((c.dice | 0) !== 0) {
      return { kind: 'dice', expr: `${c.dice}d${c.sides | 0}`, bonus: c.bonus | 0 };
    }
    if ((c.spellId | 0) === R.spellId) {
      return { kind: 'percent', value: clamp(c.power | 0, R.spellLimit[0], R.spellLimit[1]) };
    }
    return { kind: 'power', value: c.power | 0 };
  }

  function abilityThreshold(s, ctx) {
    const R = abilityThresholdRules(), c = ctx || {};
    let sides = c.sides | 0;
    if ((c.player | 0) === 0 && c.feat && R.featIds.indexOf(c.featId | 0) >= 0) {
      sides = idiv(sides * R.featMultiplier[0], R.featMultiplier[1]);
    }
    return { rule: R.buffVar, featIds: R.featIds.slice(),
      sides, text: abilityPowerText(Object.assign({}, c, { sides })) };
  }

  // ---------------------------------------------------------------- 292183-292600 物种候选
  function npcSiteCandidates(s, mapId, depthMode) {
    const R = speciesRules();
    const map = mapId === undefined ? v65(s, 20) : (mapId | 0);
    const mode = depthMode === undefined ? v65(s, 22) : (depthMode | 0);
    const ids = R.base.slice();
    for (const g of R.groups) {
      if (g.map !== map) continue;
      if (g.mode !== null && g.mode !== undefined && g.mode !== mode) continue;
      for (const id of g.ids) ids.push(id);
    }
    return { map, mode, ids, offset: R.offset, filter: R.filter,
      entries: ids.map((id) => ({ id, value: id + R.offset })) };
  }

  function allCandidates() {
    const R = speciesRules();
    return { ids: R.all.slice(), offset: R.offset,
      entries: R.all.map((id) => ({ id, value: id + R.offset })) };
  }

  // ---------------------------------------------------------------- 304259-304410 一览前处理
  function listPreprocess(s) {
    const R = listPreRules(), L = lang(s);
    const debug = v65(s, R.debugVar) === 1;
    let pcpic = 0;
    for (let i = 0; i < R.pcpicRepeat; i++) {
      if (cbit(s, R.pcpicCbit, i) === 1 || i === 0) pcpic++;
    }
    return { buffer: R.buffer, headerTag: R.headerTag, serial: R.serial,
      var541: R.var541.slice(), scanRepeat: R.scanRepeat,
      scanSkip: R.scanSkip, scanKeep: R.scanKeep,
      saveExpr: R.saveExpr, cleanup: R.cleanup,
      pcpic, debug, debugTitle: debug ? R.debugTitle : '',
      diary: R.diary };
  }

  // ---------------------------------------------------------------- 300916-300964 神託
  function oracleResult(s, itemId, stock) {
    const R = oracleRules();
    const idx = R.items[String(itemId)];
    if (idx === undefined) return { ok: false, itemId };
    const has = (stock | 0) > 0;
    const resultId = itemId === 413 ? R.result['413'] : R.result.else;
    return { ok: true, itemId, materialIndex: idx, has,
      resultId, paySnd: R.paySnd, dropText: textOf(R.dropTextKey, lang(s)),
      lackText: textOf(R.lackTextKey, lang(s), { mat: 'MAT' + idx }),
      setItemField: R.setItemField, setItemValue: R.setItemValue };
  }

  function oracleItemCheck(s, itemId, stock) {
    const R = oracleRules(), L = lang(s);
    const idx = R.items[String(itemId)] || 0;
    return { ask: textOf(R.askTextKey, L, { mat: 'MAT' + idx }),
      yes: R.yes, no: R.no, width: R.width,
      result: oracleResult(s, itemId, stock) };
  }

  // ---------------------------------------------------------------- 300412-300457 / 300383-300411
  function tacticalOrder(s, stat) {
    const R = selectionRules();
    if (v65(s, R.tacticalVar) === R.tacticalValue) return { tactical: true, ret: R.tacticalReturn };
    return { tactical: false, ret: (stat | 0) === 0 ? 1 : 0,
      attackText: R.attackText, yes: R.yes, no: R.no, width: R.width };
  }

  function selectionResolve(s, stat, targetRelation) {
    const R = selectionRules(), L = lang(s);
    const err = R.errors[String(stat)];
    if (err) return { ok: false, stat, text: err[L === 'jp' ? 0 : 1],
      targetExpr: R.targetExpr, gosub: R.gosub };
    const confirm = (targetRelation | 0) >= R.impressionMin;
    return { ok: true, stat, confirm, gosub: R.gosub,
      attackText: confirm ? R.attackText : null };
  }

  // 300334-300382：锁定目标有效性
  function validateTarget(s, actor, targets) {
    const R = targetLockRules();
    const cur = gv(s, 29, actor);
    let valid = cur !== 0 && gv(s, 0, cur) === R.aliveState;
    if (valid && sync(s, cur) === false) valid = false;
    if (valid) return { ok: true, target: cur, priority: null };
    const list = targets || [];
    const priority = (actor === 0) ? R.priorityPlayer : R.priorityNpc;
    let chosen = 0;
    for (const p of priority) {
      for (const t of list) {
        if (gv(s, 9, t) <= p) { chosen = t; break; }
      }
      if (chosen) break;
    }
    if (!chosen || gv(s, 253, actor) !== 0) {
      return { ok: false, target: 0, text: textOf(R.textKey, lang(s)) };
    }
    sv(s, 29, actor, chosen);
    return { ok: true, target: chosen, priority };
  }

  // ---------------------------------------------------------------- 279353-279422 / 302533-302561
  function shopSalaryItem(s) {
    const R = shopDataRules(), L = lang(s);
    const mod = idiv(gv(s, 195, 0), 10) % 7;
    const item = R.itemByMod[String(mod)] || 0;
    snd(s, R.snd);
    return { tmpFile: R.tmpFile, shopFile: R.shopFile, shopId: R.shopId,
      var541: R.var541.slice(), mode: R.mode, mod, item,
      snd: R.snd, text: textOf(R.textKey, L) };
  }

  function clampSettlement(v, K) { return clamp(idiv((v | 0) - K.base, K.div), K.lo, K.hi); }

  function shop3Settlement(s, goldVar) {
    const R = shopDataRules().shop3;
    const fame = clampSettlement(v65(s, 2295), R.fame);
    const karma = clampSettlement(v65(s, 2296), R.karma);
    sv(s, 30, 0, gv(s, 30, 0) + (goldVar | 0));
    sv(s, R.fame.target, 0, gv(s, R.fame.target, 0) + fame);
    sv(s, R.karma.target, 0, gv(s, R.karma.target, 0) + karma);
    return { file: R.file, fame, karma, gold: goldVar | 0,
      repeat: R.repeat, stockDiv: R.stockDiv };
  }

  function shopData(s) {
    return { salary: shopSalaryItem(s), shop3: shopDataRules().shop3 };
  }

  // ---------------------------------------------------------------- 308171-308242 潜地
  function burrowFlow(s, actor) {
    const R = rowActRules().burrow, L = lang(s);
    if (gv(s, 0, actor) !== 1) {
      if (s.rowactend) s.rowactend(actor);
      return { phase: 'inactive', rowactend: true };
    }
    if (gv(s, 140, actor) === 0) {
      sv(s, 140, actor, R.state); sv(s, 141, actor, R.counter);
      if (sync(s, actor)) log(s, textOf(R.textStartKey, L, { name: 'NPC' + actor }));
      return { phase: 'start', state: R.state, counter: R.counter,
        interval: R.interval };
    }
    const counter = gv(s, 141, actor);
    if (counter > 0) {
      if (counter % R.interval === 0 && sync(s, actor)) {
        log(s, textOf(R.textStayKey, L, { name: 'NPC' + actor }));
      }
      return { phase: 'underground', counter, interval: R.interval };
    }
    snd(s, R.snd);
    return { phase: 'ambush', snd: R.snd, targetField: R.targetField,
      skipState: R.skipState, tryRepeat: R.tryRepeat,
      jumpText: textOf(R.jumpTextKey, L, { name: 'NPC' + actor }),
      missText: textOf(R.missTextKey, L), dist: R.dist,
      animeload: R.animeload, gosub: R.gosub };
  }

  // ---------------------------------------------------------------- 308243-308426 応援
  function cheerGate(s, actor, ctx) {
    const G = rowActRules().cheer.gate, c = ctx || {};
    let v = 0;
    if (v65(s, G.fameVar) < G.fameLo) { if (gv(s, 38, actor) >= G.levelLo) v = 100; }
    if (v65(s, G.fameVar) >= G.fameLo) { if (gv(s, 38, actor) >= G.levelHi) v = 100; }
    if (actor < 16 || c.v58_58 === G.forceValue || actor === 0) v = 100;
    if (v65(s, G.flagVar) === G.flagValue) v = 100;
    if (actor >= 16 && (c.v25 | 0) > 3
      && (c.v50 | 0) > idiv(c.v51 | 0, 2) && (c.morale | 0) < G.moraleLo) {
      if (c.v1636 !== 100) v = 0;
    }
    if (v65(s, G.debugVar) === G.debugValue) v = 0;
    if (c.ai === -1) { if ((c.v185 | 0) !== 0) v = 0; }
    if (c.ai === 1 || c.ai === 2) v = 0;
    return v;
  }

  /** 308386-308411：斗志 +2 / 封顶 100 与 200 / 技能 17 档位 */
  function cheerApply(s, actor, target, ctx) {
    const L = rowActRules().cheer.loop, c = ctx || {};
    let fatigue = gv(s, L.fatigueField, target);
    if (fatigue > L.fatigueCap) fatigue = L.fatigueSet;
    sv(s, L.fatigueField, target, fatigue);
    sv(s, L.clearField, target, 0);
    let morale = gv(s, 182, target) + L.moraleAdd;
    if (morale > L.moraleCapA) {
      if (c.allowCap !== false) morale = L.moraleCapA;
    }
    if (morale > L.moraleCapB) morale = L.moraleCapB;
    sv(s, 182, target, morale);
    const hit = rnd(s, (c.cheerSkill | 0) + (c.bonus | 0))
      > rnd(s, c.targetSkill | 0);
    let tier = 1;
    const skill = gv(s, 17, actor);
    for (let i = 0; i < L.skillTiers.length; i++) {
      if (skill >= L.skillTiers[i]) tier = L.healTiers[i + 1];
    }
    sv(s, L.emoField, target, hit ? L.emoHit : L.emoMiss);
    if (hit && s.healsp) s.healsp(target, tier);
    return { target, fatigue, morale, hit, tier, emo: hit ? L.emoHit : L.emoMiss };
  }

  function cheerFlow(s, actor, ctx) {
    const C = rowActRules().cheer, L = lang(s), c = ctx || {};
    const gate = cheerGate(s, actor, c);
    if (gate !== 100) return { phase: 'idle', gate };
    if (gv(s, 182, actor) >= C.gate.overflow.morale) {
      if (s.setVar) s.setVar('var_396', C.gate.overflow.var396);
      return { phase: 'overflow', gate, var396: C.gate.overflow.var396,
        gosub: C.gate.overflow.gosub };
    }
    sv(s, 140, actor, C.state); sv(s, 141, actor, C.counter);
    const cheerers = [];
    const list = s.charas || Array.from({ length: C.scanRepeat }, (_, i) => i);
    let bonus = 0;
    for (const idx of list) {
      if (idx === actor || gv(s, 0, idx) !== 1) continue;
      if (gv(s, C.cheerRoleField, idx) === C.cheerRole
        && c.buffFound && c.buffFound(idx, C.cheerBuff)) {
        cheerers.push(idx);
        bonus += idiv((c.skill162 ? c.skill162(idx) : 0) + 10, 5);
      }
    }
    if (v65(s, C.startVar) === C.startValue) {
      log(s, textOf(C.startTextKey, L, { name: 'NPC' + actor }));
    }
    if (cheerers.length === 1) {
      log(s, textOf(C.joinTextKey, L, { name: 'NPC' + cheerers[0] }));
    }
    return { phase: 'start', gate, state: C.state, counter: C.counter,
      cheerers, bonus, customtalk: C.customtalk,
      text: textOf(C.startTextKey, L, { name: 'NPC' + actor }),
      loopGate: C.loop.gate, skillExp: C.loop.skillExp,
      breakText: textOf(C.breakTextKey, L, { name: 'NPC' + actor }) };
  }

  // ---------------------------------------------------------------- 220394-220436 rowactend 清场
  function rowActEnd(s, idx) {
    const R = rowActRules().clear;
    cbitmod(s, R.cbitmod, idx, 0);
    if (s.rowactend) s.rowactend(idx);
    for (const f of R.fields) sv(s, f, idx, 0);
    for (let i = 0; i < R.extraRepeat.count; i++) {
      sv(s, R.extraRepeat.start + i, idx, 0);
    }
    let buffs = 0;
    if (gv(s, R.buffRepeat.start, idx) !== 0) {
      for (let i = 0; i < R.buffRepeat.count; i++) {
        const f = R.buffRepeat.start + i * R.buffRepeat.stride;
        const v = gv(s, f, idx);
        if (v === 0) break;
        if (v === R.buffRepeat.skipValue) continue;
        if (s.delbuff) s.delbuff(idx, i);
        sv(s, f, idx, 0); buffs++;
      }
    }
    return { idx, cleared: R.fields.length, extra: R.extraRepeat.count,
      buffs, cbitmod: R.cbitmod, gosub: R.gosub };
  }

  // ---------------------------------------------------------------- 285005-285049 角色信息
  function characterInfo(s, target) {
    const R = charInfoRules(), L = lang(s);
    return { tempChara: R.tempChara, snd: R.snd, page: R.page,
      repeat: R.repeat, divisor: R.divisor,
      titles: R.title.map((t) => (L === 'jp' ? t : t)),
      buffRepeat: R.buffRepeat, buffStride: R.buffStride,
      gosub: R.gosub, noteVar: R.noteVar, target: target | 0 };
  }

  // ---------------------------------------------------------------- 194576-194612 变装
  function incognitoBegin(s) {
    const R = incognitoRules(), L = lang(s);
    if (v65(s, R.duelVar) > 0) {
      snd(s, R.snd);
      return { blocked: true, snd: R.snd, text: textOf(R.textKey, L) };
    }
    const changed = [];
    for (let i = 0; i < R.loop.count; i++) {
      const idx = R.loop.start + i;
      if (gv(s, 0, idx) !== 1) continue;
      if (R.skip.role.indexOf(gv(s, 150, idx)) >= 0) continue;
      if (gv(s, 27, idx) === R.skip.race) continue;
      const sp = R.skip.special;
      if (gv(s, sp.field, idx) === sp.value && gv(s, 27, idx) !== sp.race) continue;
      if (gv(s, R.condition.originalField, idx) >= R.condition.originalMin
        && gv(s, R.condition.relationField, idx) <= R.condition.relationMax) {
        sv(s, 201, idx, 0);
        sv(s, 9, idx, gv(s, 69, idx));
        sv(s, 79, idx, R.apply['79']);
        changed.push(idx);
      }
    }
    return { blocked: false, changed, apply: R.apply, loop: R.loop };
  }

  // ---------------------------------------------------------------- 29294-29312 fix_find
  function fixFind(s, itemId, slot) {
    const R = fixFindRules();
    if ((itemId | 0) !== R.itemId) return { hit: false };
    if (!s.itemField || s.itemField(slot, R.flagField) !== R.flagValue) return { hit: false };
    for (const k in R.reset) {
      if (s.setItemField) s.setItemField(slot, parseInt(k, 10), R.reset[k]);
    }
    snd(s, R.snd);
    return { hit: true, snd: R.snd, reset: R.reset };
  }

  // ---------------------------------------------------------------- 32260-32261 店铺改造计价
  function shopReformCost(base) {
    const R = shopReformRules();
    return (base | 0) * R.multiplier + R.base;
  }

  // ---------------------------------------------------------------- 220358-221745 小段常量
  function startupConstants() {
    const R = startupRules();
    return { cbitmodIds: R.cbitmodIds.slice(), reviveFields: R.reviveFields,
      snd: R.snd, aliasText: R.aliasText, historyText: R.historyText,
      historyRerolls: R.historyRerolls, historyRnd: R.historyRnd,
      historyMenu: R.historyMenu, gender: R.gender, genderEn: R.genderEn,
      finalQuestion: R.finalQuestion, satisfied: R.satisfied,
      satisfiedMenu: R.satisfiedMenu, gene: R.gene, geneRepeat: R.geneRepeat,
      fields161to165: R.fields161to165, level: R.level,
      namePlaceholder: R.namePlaceholder, help: R.help };
  }

  Elona.ResidualNpc = {
    setData, tableSync, load, table: tableSync,
    segments, src, srcOf, constants, text, textOf, textList, makeState,
    absoluteTime, absTime,
    shopSlotRules, itemGenRules, begRules, prankRules, confirmRules, hireRules,
    seasonRules, comWearRules, equipWeightRules, wideAbilityRules,
    abilityThresholdRules, speciesRules, listPreRules, oracleRules,
    selectionRules, targetLockRules, shopDataRules, rowActRules,
    charInfoRules, incognitoRules, startupRules, fixFindRules, shopReformRules,
    pickMap, randomItemGen, itemGenGuard, equipSlotCheck, characterItemScan,
    equipmentScan, equipCategoryCode, warehouseScan,
    shopSlotScan, begGold, begFameLoss, begDropItem, begFlow,
    prankDisabledMap, prankMenu, prankResolve, prankEvent, prankSound, prankMark,
    questReturnCheck, confirmGates, confirmMapList, confirmDialogue,
    resolveHireValue, hireResolve,
    leaveItemsConfirm, seasonShortcut, seasonCycle,
    comWearList, companionAutoEquip, equipWeightVerdict, equipWeightScan,
    wideAbility, namingPrompt, abilityPowerText, abilityThreshold,
    npcSiteCandidates, allCandidates, listPreprocess,
    oracleResult, oracleItemCheck, tacticalOrder, selectionResolve, validateTarget,
    shopSalaryItem, clampSettlement, shop3Settlement, shopData,
    burrowFlow, cheerGate, cheerApply, cheerFlow, rowActEnd,
    characterInfo, incognitoBegin, fixFind, shopReformCost, startupConstants,
  };
})(window);
