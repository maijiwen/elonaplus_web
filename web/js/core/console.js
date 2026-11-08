'use strict';
/**
 * 调试控制台 —— 命令引擎（core/console.js）
 *
 * 【定位】只负责「解析一行命令 → 调用游戏接口 → 返回文本」，
 * 不碰 DOM。界面在 view/consoleview.js，这样命令逻辑可以单独测试。
 *
 * 【打开方式】游戏内按 ` 键（反引号，config.txt 里没有占用）。
 *
 * 【设计原则】
 *   · 每个命令都是 register(name, {help, usage, run}) 注册的，新增命令不用改引擎
 *   · 命令只能调用已有的游戏接口，不绕过任何游戏规则（等价于玩家操作）
 *   · 所有会改状态的命令都会写清楚「改了什么」，方便对照原版
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const COMMANDS = {};

  /** 注册一个命令 */
  function register(name, def) {
    COMMANDS[name] = Object.assign({ name }, def);
  }

  /** 按空格切参数，支持双引号包住带空格的参数 */
  function splitArgs(line) {
    const out = [];
    let buf = '';
    let quote = false;
    for (const ch of line) {
      if (ch === '"') { quote = !quote; continue; }
      if (!quote && /\s/.test(ch)) {
        if (buf) { out.push(buf); buf = ''; }
        continue;
      }
      buf += ch;
    }
    if (buf) out.push(buf);
    return out;
  }

  /** 把物品放进背包第一个空格（与 pickupAt / craft 一致） */
  function giveItem(g, id, n) {
    // 越界 id 会被 createItem 造成「未知物品」，这里先校验定义是否存在
    if (!Elona.ItemDB.eq(id)) return null;
    const it = Elona.ItemDB.createItem(id, n);
    if (!it) return null;
    it.f[0] = n;
    it.f[5] = g.player.x; it.f[6] = g.player.y; it.f[21] = -1;
    const inv = g.player.inv;
    for (let i = 0; i < inv.length; i++) {
      if (!inv[i] || (inv[i].f[0] | 0) <= 0) { inv[i] = it; return it; }
    }
    inv.push(it);
    return it;
  }

  // ---------------------------------------------------------------- 指令
  register('help', {
    usage: 'help [命令]',
    help: '列出所有命令，或显示某条命令的详细用法',
    run(g, args) {
      if (args.length) {
        const c = COMMANDS[args[0].toLowerCase()];
        if (!c) return ['没有这条命令: ' + args[0]];
        return [c.usage, '  ' + c.help];
      }
      const names = Object.keys(COMMANDS).sort();
      const lines = ['可用命令（' + names.length + ' 条）：'];
      for (const n of names) lines.push('  ' + (COMMANDS[n].usage || n).padEnd(24) + COMMANDS[n].help);
      return lines;
    },
  });

  register('map', {
    usage: 'map',
    help: '显示当前地图信息（名称 / 原版 id / 子地图 / 坐标 / 回合）',
    run(g) {
      if (!g.map) return ['当前没有地图。'];
      return [
        `地图 ${g.map.name}（${g.map.width}×${g.map.height}）`,
        `  原版 id=${g.getV65(20)}  子地图=${g.getV65(22)}  地下层=${g.dungeonDepth || 0}`,
        `  玩家 (${g.player.x},${g.player.y})  回合 ${g.turn}  世界地图=${g.worldMap ? '是' : '否'}`,
      ];
    },
  });

  // ---------------------------------------------------------------------------
  // 0-CJ：randnameinit / randname（589862-589913）与 map_digtoentrance1（228367）
  // ---------------------------------------------------------------------------
  register('randname', {
    usage: 'randname [数量]',
    help: '生成随机名字（原版 randnameinit + randname，例如「戦士を狩る魔術師」）',
    run(g, args) {
      if (!Elona.RandName) return ['随机名字模块未加载。'];
      const n = Math.max(1, Math.min(40, parseInt(args[0], 10) || 8));
      const list = Elona.RandName.sample(n, g.rng);
      return [`随机名字 ${n} 个：`].concat(list.map((s, i) => `  ${i + 1}. ${s}`));
    },
  });

  register('digto', {
    usage: 'digto <目标x> <目标y> [ambush 0-200]',
    help: '从玩家位置挖通道到目标附近（原版 map_digtoentrance1），返回是否挖通',
    run(g, args) {
      if (!Elona.MapDig) return ['地图挖掘模块未加载。'];
      const tx = parseInt(args[0], 10), ty = parseInt(args[1], 10);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return ['用法：digto <x> <y> [ambush]'];
      const ambush = parseInt(args[2], 10) || 0;
      const p = g.player;
      const r = Elona.MapDig.digToEntrance1(g, p.x, p.y, tx, ty, 1, { ambush });
      return [`从 (${p.x},${p.y}) 挖向 (${tx},${ty})：${r ? '已挖通' : '未抵达'}（2000 步内）`];
    },
  });

  register('catname', {
    usage: 'catname <类别id>',
    help: '物品类别名（原版 fltname 19960：52000=ポーション、57000=食べ物…）',
    run(g, args) {
      if (!Elona.SmallFns) return ['小函数模块未加载。'];
      const cat = parseInt(args[0], 10);
      if (!Number.isFinite(cat)) return ['用法：catname <类别id>'];
      return [`${cat} → ${Elona.SmallFns.categoryName(cat, 'jp')} / ${Elona.SmallFns.categoryName(cat, 'en')}`];
    },
  });

  // ---------------------------------------------------------------------------
  // 0-CQ：AP 系统 / 宠物进化（410400-411925 / 226245-226275）
  // ---------------------------------------------------------------------------
  register('ap', {
    usage: 'ap [点数]',
    help: '查看或设置自己的 AP（覚醒点，上限 2000）',
    run(g, args) {
      if (!Elona.AP) return ['AP 模块未加载。'];
      const p = g.player;
      const v = parseInt(args[0], 10);
      if (Number.isFinite(v)) p.set(173, Math.max(0, Math.min(Elona.AP.AP_MAX, v)));
      const talents = Elona.AP.talentList(p).map((x) => x.label);
      return [
        `AP：${p.get(173) | 0} / ${Elona.AP.AP_MAX}　累计 ${p.get(159) | 0}`,
        `覚醒天赋：${talents.length ? talents.join('、') : '（无）'}`,
      ];
    },
  });

  register('evolve', {
    usage: 'evolve [角色索引]',
    help: '让指定角色（默认自己）进化一次（吃 319 尸体的效果）',
    run(g, args) {
      if (!Elona.Evolve) return ['进化模块未加载。'];
      const idx = parseInt(args[0], 10);
      const c = Number.isFinite(idx) ? g.charas[idx] : g.player;
      if (!c) return ['找不到该角色。'];
      const r = Elona.Evolve.evolve(g, c);
      return [r.message, `（进化计数 var_65(644) = ${g.getV65(644) | 0}）`];
    },
  });

  register('corpse', {
    usage: 'corpse [种族id]',
    help: '在脚下生成一具尸体（默认 319『リトルシスター』= 可用于进化的尸体）',
    run(g, args) {
      if (!Elona.ItemDB) return ['物品模块未加载。'];
      const sp = parseInt(args[0], 10);
      const species = Number.isFinite(sp) ? sp : 319;
      const it = Elona.ItemDB.createItem(204, 1);
      if (!it) return ['无法生成尸体。'];
      it.f[5] = g.player.x; it.f[6] = g.player.y;
      it.f[23] = species;
      it.f[0] = 1;
      g.groundItems.push(it);
      if (g.refreshGroundCell) g.refreshGroundCell(g.player.x, g.player.y);
      const evo = Elona.Evolve && Elona.Evolve.isEvolveCorpse(it);
      return [`已在脚下生成尸体（种族 ${species}，物品 204）${evo ? '——可用于进化' : ''}`];
    },
  });

  register('v65', {
    usage: 'v65 <下标> [值]',
    help: '读写 var_65 全局表的任意槽位（不带值 = 读取）',
    run(g, args) {
      const i = parseInt(args[0], 10);
      if (Number.isNaN(i)) return ['用法: v65 <下标> [值]'];
      if (args.length < 2) return [`var_65(${i}) = ${g.getV65(i) | 0}`];
      const v = parseInt(args[1], 10) || 0;
      g.setV65(i, v);
      return [`var_65(${i}) ← ${v}`];
    },
  });

  register('state', {
    usage: 'state [值]',
    help: '查看/设置主任务状态（var_65(250+2) = 252）',
    run(g, args) {
      const V = Elona.Story ? Elona.Story.V_STATE : 252;
      if (args.length) {
        const v = parseInt(args[0], 10) || 0;
        g.setV65(V, v);
        return [`主任务状态 ← ${v}（下次进图会重跑触发链）`];
      }
      const d = Elona.Story ? Elona.Story.diagnose(g) : null;
      const out = [`主任务状态 = ${g.getV65(V) | 0}`];
      if (d) {
        out.push(`  触发表 ${d.total} 条：成立 ${d.yes.length} / 不成立 ${d.no} / 未知 ${d.unknown.length}`);
        if (d.yes.length) out.push('  当前成立: ' + d.yes.map((r) => `区块${r.block}`).join(', '));
      }
      return out;
    },
  });

  register('story', {
    usage: 'story [区块号]',
    help: '播放指定剧情区块（不带参数 = 列出已解锁的区块）',
    async run(g, args) {
      if (!Elona.Scene || !Elona.SceneView) return ['剧情模块未加载。'];
      if (!args.length) {
        await Elona.Scene.load();
        const ids = Elona.Scene.blockIds();
        const played = Elona.Scene.playedTo(g);
        return [`共 ${ids.length} 个区块，已播放到 ${played}：${ids.join(' ').slice(0, 300)}`];
      }
      const id = parseInt(args[0], 10);
      if (Number.isNaN(id)) return ['用法: story <区块号>'];
      const ok = await Elona.SceneView.play(g, id);
      return [ok ? `已播放区块 ${id}` : `区块 ${id} 不存在或没有内容`];
    },
  });

  register('diag', {
    usage: 'diag',
    help: '剧情诊断：当前地图/任务状态下每条触发规则的成立情况',
    run(g) {
      if (!Elona.Story) return ['剧情模块未加载。'];
      const d = Elona.Story.diagnose(g);
      const yes = d.yes.map((r) => `区块${r.block}(行${r.line})`).join(', ') || '无';
      const unk = d.unknown.slice(0, 6).map((r) => `区块${r.block}`).join(', ') || '无';
      return [
        `规则总数 ${d.total}　成立 ${d.yes.length}　不成立 ${d.no}　未知 ${d.unknown.length}`,
        '  成立: ' + yes,
        '  未知: ' + unk,
      ];
    },
  });

  register('give', {
    usage: 'give <物品id> [数量]',
    help: '把物品放进背包（例: give 240 1 = 宝箱）',
    run(g, args) {
      const id = parseInt(args[0], 10);
      if (Number.isNaN(id)) return ['用法: give <物品id> [数量]'];
      const n = Math.max(1, parseInt(args[1], 10) || 1);
      const it = giveItem(g, id, n);
      if (!it) return [`物品 ${id} 不存在。`];
      return [`获得 ${Elona.ItemDB.name(id, 'en')} ×${n}`];
    },
  });

  register('find', {
    usage: 'find <关键字>',
    help: '按中文/日文/英文名搜索物品 id（最多 12 条）',
    async run(g, args) {
      if (!args.length) return ['用法: find <关键字>'];
      await Elona.ItemDB.load();
      const kw = args.join(' ').toLowerCase();
      const hits = [];
      const data = Elona.ItemDB.data || {};
      for (const k of Object.keys(data)) {
        const e = data[k];
        const jp = (e.nameJp || '').toLowerCase();
        const cn = (e.nameCh || '').toLowerCase();
        const en = (e.nameEn || '').toLowerCase();
        if (jp.includes(kw) || en.includes(kw) || cn.includes(kw)) {
          hits.push({ id: parseInt(k, 10), name: e.nameCh || e.nameJp, en: e.nameEn });
          if (hits.length >= 12) break;
        }
      }
      if (!hits.length) return [`没有匹配「${kw}」的物品。`];
      return hits.map((h) => `  ${String(h.id).padStart(4)}  ${h.name} / ${h.en}`);
    },
  });

  register('mat', {
    usage: 'mat [add <材料id> [数量] | list | cat]',
    help: '查看/增加材料（var_497）。不给参数=列出持有材料',
    async run(g, args) {
      const Mat = Elona.Material;
      if (!Mat) return ['材料模块未加载。'];
      await Mat.load();
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'add') {
        const id = parseInt(args[1], 10);
        if (Number.isNaN(id)) return ['用法: mat add <材料id> [数量]'];
        const n = Math.max(1, parseInt(args[2], 10) || 1);
        const r = Mat.add(g, id, n, 0);
        return [`${Mat.name(id, 'en')} ×${n}（现在 ${Mat.get(g, id)}）`];
      }
      if (sub === 'cat') {
        await Mat.load();
        const lines = ['分类编号:'];
        for (const k of Object.keys(Mat.CAT)) lines.push(`  ${String(Mat.CAT[k]).padStart(2)}  ${k}  ${Mat.catName(Mat.CAT[k])}`);
        return lines;
      }
      const held = Mat.list(g);
      if (!held.length) return ['（没有材料）', '用 mat add <id> 添加，或用 gather 在地下城采集'];
      const lines = [`持有材料 ${held.length} 种:`];
      for (const h of held.slice(0, 30)) {
        const d = Mat.def(h.id);
        const cat = d && d.cats && d.cats[0] ? Mat.catName(d.cats[0]) : '';
        lines.push(`  ${String(h.id).padStart(3)}  ${Mat.name(h.id, 'en').padEnd(22)} ×${h.count}  ${cat}`);
      }
      if (held.length > 30) lines.push(`  …共 ${held.length} 种`);
      return lines;
    },
  });

  register('gather', {
    usage: 'gather',
    help: '在当前格采集一次（需要有采集点；没有就现场放一个矿脉）',
    async run(g, args) {
      if (!Elona.Gather) return ['采集模块未加载。'];
      await Elona.Material.load();
      const p = g.player;
      if (!Elona.Gather.spotAt(g, p.x, p.y)) {
        const site = Elona.Gather.rollSite((n) => g.rng.rnd(n));
        Elona.MapFeat.write(g, p.x, p.y, site.id, site.type, 0, 0);
      }
      const r = Elona.Gather.gather(g);
      const lines = [`分类 ${r.cat}，判定 ${r.attempts} 次，采到 ${r.gained.length} 个${r.exhausted ? '（已采尽）' : ''}`];
      for (const msg of r.messages.slice(-4)) lines.push('  ' + msg);
      return lines;
    },
  });

  register('prod', {
    usage: 'prod <技能id> [产物id]',
    help: '列出/执行生产配方（176 工作 / 177 裁縫 / 178 錬金 / 179 宝石細工）',
    async run(g, args) {
      const Pr = Elona.Produce;
      if (!Pr) return ['生产模块未加载。'];
      await Pr.load();
      await Elona.Material.load();
      const skill = parseInt(args[0], 10);
      if (Number.isNaN(skill)) {
        return ['用法: prod <技能id> [产物id]', '  176 工作 / 177 裁縫 / 178 錬金術 / 179 宝石細工'];
      }
      const kit = Object.keys(Pr.KIT_SKILL).find((k) => Pr.KIT_SKILL[k] === skill);
      if (!kit) return [`技能 ${skill} 不是生产技能。`];
      const rows = Pr.list(g, parseInt(kit, 10));
      const pid = parseInt(args[1], 10);
      if (Number.isNaN(pid)) {
        const lines = [`技能 ${skill} 可做 ${rows.length} 种（等级 ${g.player.skill(skill) | 0}）:`];
        for (const r of rows.slice(0, 15)) {
          const mats = r.mats.map((m) => `${Elona.Material.name(m[0], 'en')} ${Elona.Material.get(g, m[0])}/${m[1]}`).join(', ');
          lines.push(`  ${String(r.id).padStart(4)}  ${r.name.padEnd(20)} Lv${r.req}  ${r.ok ? 'OK' : '缺'}  ${mats}`);
        }
        if (rows.length > 15) lines.push(`  …共 ${rows.length} 种`);
        return lines;
      }
      const res = Pr.produce(g, pid);
      return [res.message, res.ok ? `  品质 ${res.fix}、等级 ${res.level}、消耗材料 ${res.used}` : `  原因: ${res.reason}`];
    },
  });

  register('fish', {
    usage: 'fish [小时数]',
    help: '钓鱼 —— 没有钓竿就发一根（带 20 个饵）、技能为 0 就设成 1、身边没水就挖一格水，然后开始',
    async run(g, args) {
      const F = Elona.Fishing;
      if (!F) return ['钓鱼模块未加载。'];
      await F.load();
      const p = g.player;
      const notes = [];

      let rodIdx = F.findRod(p);
      if (rodIdx < 0) {
        const rod = Elona.ItemDB.createItem(342, 1);   // 342 = 釣竿
        rod.f[9] = 20;
        p.inv.push(rod);
        rodIdx = p.inv.length - 1;
        notes.push('发了一根钓竿（饵 20）。');
      }
      if ((p.skill(185) | 0) === 0) {
        p.skillVals[185] = 1;
        notes.push('把釣り技能设为 1。');
      }
      if (!F.waterTarget(g)) {
        let water = 0;
        for (let t = 1; t < 400; t++) if (g.map.attr(t, 0) === 3) { water = t; break; }
        if (!water) return notes.concat(['当前地图没有水图块，无法钓鱼。']);
        const wx = p.x, wy = p.y - 1;
        if (!g.map.inBounds(wx, wy)) return notes.concat(['北面越界，无法挖水。']);
        g.map.cells[wy][wx][0] = water;
        notes.push('在北面挖了一格水。');
      }
      if ((p.get(52) | 0) < 50) {                 // 体力不足会被 319986 拦下
        p.set(52, Math.max(60, (p.get(53) | 0) || 100));
        notes.push('把体力补到 60。');
      }
      const hours = parseInt(args[0], 10);
      const r = F.start(g, rodIdx, Number.isNaN(hours) ? 1 : hours);
      notes.push(r.ok ? (r.immediate ? '机械假饵立刻上钩。' : `开始钓鱼（${r.hours} 小时）。`) : `开始失败：${r.reason}`);
      notes.push(`rowact=${p.get(140)} 预算=${p.get(141)} 饵=${p.inv[rodIdx] ? p.inv[rodIdx].f[9] : '-'}`);
      return notes;
    },
  });

  register('play', {
    usage: 'play [乐器id]',
    help: '演奏 —— 没有乐器就发一把鲁特琴（691），演奏技能为 0 就设成 5，然后开始演奏',
    async run(g, args) {
      const P = Elona.Perform;
      if (!P) return ['演奏模块未加载。'];
      const p = g.player;
      const notes = [];
      const want = parseInt(args[0], 10);
      let idx = Number.isNaN(want) ? P.findInstrument(p) : p.inv.findIndex((it) => it && it.id === want);
      if (idx < 0) {
        const id = Number.isNaN(want) ? 691 : want;
        const it = Elona.ItemDB.createItem(id, 1);
        p.inv.push(it);
        idx = p.inv.length - 1;
        notes.push(`发了一件乐器：${Elona.ItemDB.name(it, 'en')}。`);
      }
      if ((p.skill(183) | 0) === 0) {
        p.skillVals[183] = 5;
        notes.push('把演奏技能设为 5。');
      }
      if ((p.get(52) | 0) < 50) {
        p.set(52, Math.max(60, (p.get(53) | 0) || 100));
        notes.push('把体力补到 60。');
      }
      const r = P.use(g, idx);
      notes.push(r.ok ? `开始演奏（${p.get(141)} 回合）。` : `开始失败：${r.reason}`);
      notes.push(`rowact=${p.get(140)} 出来=${p.get(144)} 乐器=${idx}`);
      return notes;
    },
  });

  register('home', {
    usage: 'home [status | go [层] | rank N | board | design | value | move X Y]',
    help: '自宅 —— 等级 / 进出 / 告示板菜单 / 装修模式 / 家の価値 / 搬到世界地图某格',
    async run(g, args) {
      const H = Elona.Home;
      if (!H) return ['自宅模块未加载。'];
      const sub = (args[0] || 'status').toLowerCase();
      const A = args.slice(1);
      if (sub === 'status') {
        const info = H.homeInfo(g);
        const s = H.site(g);
        return [
          `地图 ${g.map ? g.map.name : '-'}（var_65(20)=${g.getV65(20)} / 层=${H.floor(g)}）`,
          `等级 ${info.rank}（${info.rankName}）容量 ${info.cap} 文件 ${info.file}`,
          `据点 site7 = (${s ? s.x : '-'}, ${s ? s.y : '-'}) 世界 ${s ? s.world : '-'} 外装 ${s ? s.fields[15] : '-'}`,
          `価値 基本 ${info.base} / 家具 ${info.furn} / 家宝 ${info.heir} → 位次评分 ${info.score}`,
          `滞在者 ${info.stayers}/${info.maxStayers}`,
        ];
      }
      if (sub === 'go') {
        const f = Math.max(1, parseInt(A[0], 10) || 1);
        const ok = await H.enter(g, f);
        return [ok ? `进入自宅第 ${H.floor(g)} 层。` : '进入失败（地图未提取？）'];
      }
      if (sub === 'rank') {
        const r = H.setRank(g, parseInt(A[0], 10) || 0);
        H.ensureSite(g);
        return [`家的等级设为 ${r}（容量 ${H.def(g).cap}）。重新 home go 后生效。`];
      }
      if (sub === 'board') {
        if (!H.inHome(g)) return ['只能在自宅里打开告示板。'];
        const head = H.inventoryHead(g);
        return [head].concat(H.menu(g).map((m) => `  ${m.key} — ${m.label}`));
      }
      if (sub === 'design') {
        if (!H.inHome(g)) return ['只能在自宅里装修。'];
        H.design.start(g);
        return ['装修模式已开始：方向键移动 / 回车铺砖 / T 地砖一览 / 右键取砖 / Esc 结束。'];
      }
      if (sub === 'value') {
        const v = H.recalcValue(g);
        return [`基本 ${v.base} / 家具 ${v.furn} / 家宝 ${v.heir} → 评分 ${v.score}（越小越好）`];
      }
      if (sub === 'move') {
        const x = parseInt(A[0], 10), y = parseInt(A[1], 10);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return ['用法：home move X Y'];
        H.placeSite(g, x, y, g.getV65(850) || 4);
        return [`自宅据点移到 (${x}, ${y})。`];
      }
      return ['用法：home [status | go [层] | rank N | board | design | value | move X Y]'];
    },
  });

  register('ranch', {
    usage: 'ranch [status | worker | breed [天数] | off | menu | <照料命令> [参数]]',
    help: '牧场 —— 繁殖 / 产出 / 梳理 / 榨奶 / 饲料 / 消毒 / 献祭 / 挖残骸 / 收款机',
    async run(g, args) {
      const R = Elona.Ranch;
      if (!R) return ['牧场模块未加载。'];
      await R.load();
      const p = g.player;
      const sub = (args[0] || '').toLowerCase();
      const msg = (r) => [r && r.message ? r.message : (r && r.reason ? `失败：${r.reason}` : '完成。')];
      /** 第一只活着的家畜（控制台用；UI 走干涉菜单指定目标） */
      const firstHerd = () => (g.charas || []).find(
        (c) => c && (c.get(0) | 0) === 1
          && Elona.Status && Elona.Status.cbit && Elona.Status.cbit(c, 960) === 1);
      const target = () => firstHerd() || R.getWorker(g);

      if (sub === 'worker') {
        const c = g.charas.find((x) => x && x !== p && (x.get(0) | 0) === 1);
        if (!c) return ['附近没有可指定的角色。'];
        const r = R.assignBreeder(g, c);
        return [`${r.message}（var_58(80)=${R.workerKey(g)}）`];
      }
      if (sub === 'off') {
        R.removeBreeder(g);
        delete g.map.mapType;
        return ['已取消本图的牧场标记并撤换种畜。'];
      }
      if (sub === 'breed') {
        const n = parseInt(args[1], 10);
        const r = R.breedRound(g, R.getWorker(g), Number.isNaN(n) ? 1 : n);
        if (!r.ok) return ['没有牧场主/种畜，先执行 ranch worker。'];
        const prod = R.produceRound(g);
        const lines = [`判定 ${r.attempts} 次，出生 ${r.born.length} 只，家畜共 ${r.herd} 只`
          + (r.prevented ? '（繁殖防止代码生效）' : '')];
        if (prod && prod.produced.length) {
          const cnt = {};
          for (const it of prod.produced) cnt[it.id] = (cnt[it.id] || 0) + 1;
          const names = Object.keys(cnt).map((id) => `${Elona.ItemDB.name(Number(id), 'en')}×${cnt[id]}`).join('，');
          lines.push(`  产出：${names}`);
        }
        for (const m of r.messages.slice(0, 6)) lines.push('  ' + m);
        return lines;
      }
      if (sub === 'menu') {
        return R.registerMenu(g).map((m) => `  ${m.id}. ${m.label}`)
          .concat(['用法：ranch scatter / disinfect / cb on|off / cp on|off']);
      }
      if (sub === 'scatter') return msg(R.runRegister(g, 17));
      if (sub === 'disinfect' || sub === 'clean') return msg(R.runRegister(g, 18));
      if (sub === 'cb') { const r = R.runRegister(g, args[1] === 'on' ? 19 : 21); return [`繁殖防止代码：${r.value ? '开启' : '关闭'}`]; }
      if (sub === 'cp') { const r = R.runRegister(g, args[1] === 'on' ? 20 : 22); return [`生产防止代码：${r.value ? '开启' : '关闭'}`]; }
      if (sub === 'brush') return msg(R.brush(g, p, target()));
      if (sub === 'milk') return msg(R.milk(g, p, target(), { force: args[1] === 'force' }));
      if (sub === 'feed') return msg(R.giveItem(g, firstHerd(),
        (p.inv || []).find((x) => x && (x.f[0] | 0) > 0 && (x.f[3] | 0) === 1071)));
      if (sub === 'milkfeed') return msg(R.giveItem(g, firstHerd(),
        (p.inv || []).find((x) => x && (x.f[0] | 0) > 0 && (x.f[3] | 0) === 574)));
      if (sub === 'sacrifice') return msg(R.sacrifice(g, firstHerd()));
      if (sub === 'act') return msg(R.actingTraining(g, firstHerd()));
      if (sub === 'out') return msg(R.bringOut(g, firstHerd()));
      if (sub === 'dig') {
        const k = parseInt(args[1], 10);
        return msg(R.excavate(g, p, target(), k, args[2] === 'force'));
      }

      // 无参数 / status：状态摘要
      const s = R.status(g);
      const w = R.getWorker(g);
      return [
        `地图 ${g.map.name}，类型 ${R.mapType(g)}（31 = 牧場），是否牧场：${s.ranch}`,
        `种畜：${w ? R.nameOf(w) : '未指定'}　繁殖系数 cbreeder：${s.breederRate}`,
        `家畜 ${s.herd} 只（生病 ${s.sick} 只），肮脏度 ${s.dirtiness}`,
        `繁殖防止 ${s.flags.breeding ? '开' : '关'}　生产防止 ${s.flags.production ? '开' : '关'}`,
        '用法：worker / breed [天数] / menu / brush / milk [force] / feed / milkfeed',
        '      scatter / disinfect / cb|cp on|off / dig <18..22> [force]',
        '      sacrifice / act / out / off',
      ];
    },
  });

  register('farm', {
    usage: 'farm [status | plant [种子id] | tend <1-5> | harvest | fertilize]',
    help: '栽培 —— 在脚下播种/照料/收获（种子 417 蔬菜 418 水果 419 草药 420 不明 421 神器 553 宝石 554 魔法）',
    async run(g, args) {
      const F = Elona.Farm;
      if (!F) return ['栽培模块未加载。'];
      await F.load();
      const p = g.player;
      const sub = (args[0] || 'status').toLowerCase();
      if (sub === 'plant') {
        const id = parseInt(args[1], 10);
        const it = Elona.ItemDB.createItem(Number.isNaN(id) ? 417 : id, 1);
        p.inv.push(it);
        const idx = p.inv.length - 1;
        const r = F.plant(g, idx);
        if (!r.ok) return [`播种失败：${r.reason}`];
        return [`种下了 ${Elona.ItemDB.name(it, 'en')}（特性 ${r.feat.id} / 种类 ${r.species} / care ${r.care}）`];
      }
      if (sub === 'tend') {
        const n = parseInt(args[1], 10);
        const r = F.tend(g, p.x, p.y, Number.isNaN(n) ? 1 : n);
        return [r.ok ? `照料完成（种类 ${r.species} / care ${r.care}）` : `照料失败：${r.reason}`];
      }
      if (sub === 'harvest') {
        const r = F.harvest(g, p.x, p.y);
        if (!r.ok) return [`收获失败：${r.reason}`];
        return [`收获了 ${r.qty} 个（产物 ${r.productId || '按类别随机'}）`];
      }
      if (sub === 'fertilize') {
        const r = F.fertilize(g, p.x, p.y);
        return [r.ok ? '已施肥（特性 253）。' : `施肥失败：${r.reason}`];
      }
      // status
      const f = F.plantAt(g, p.x, p.y);
      return [
        `地图 ${g.map.name}　地图类型 ${F.mapType(g)}（103 = 自家农场）`,
        f ? `脚下：${F.stageName(f)}　种类 ${f.sub | 0}　care ${f.arg3 | 0}　田：${F.isField(g, p.x, p.y) ? '是' : '否'}`
          : '脚下没有作物。',
        `栽培技能 ${p.skill(180) | 0}　季节 ${F.seasonOf(g.getV65(11) | 0)}`,
      ];
    },
  });

  register('ability', {
    usage: 'ability [list | <id>]',
    help: '能力发动（*label_2958）—— 不带参数列出已觉醒能力；带 id 直接发动（600..879）',
    async run(g, args) {
      const p = g.player;
      const S = Elona.Spell;
      if (!S) return ['法术引擎未加载。'];
      const sub = (args[0] || 'list').toLowerCase();
      if (sub === 'list') {
        if (Elona.Feat && Elona.Feat.unlockAbilities) Elona.Feat.unlockAbilities(p, g);
        const ids = [];
        for (let i = 0; i < 280; i++) {
          if (Elona.Feat.flag(p, i) !== 0) ids.push(600 + i);
        }
        const lines = [`已觉醒能力 ${ids.length} 个：`];
        for (const id of ids.slice(0, 15)) {
          const nm = S.actionName(id);
          const cost = S.field(id, 2) | 0;
          lines.push(`  ${String(id).padStart(3)}  ${(nm && (nm.ch || nm.en || nm.jp) || '').slice(0, 20).padEnd(20)} ${cost} SP`);
        }
        if (ids.length > 15) lines.push(`  …共 ${ids.length} 个`);
        return lines;
      }
      const id = parseInt(sub, 10);
      if (Number.isNaN(id)) return ['用法: ability [list | <id>]'];
      const r = g.useAbility(id);
      return [r && r.ok ? `发动成功（类型 ${r.type}）` : `发动失败：${(r && r.reason) || 'unknown'}`];
    },
  });

  register('spawn', {
    usage: 'spawn <种族键> [等级]',
    help: '在玩家身边生成一只怪物（种族键见 race_class.json）',
    async run(g, args) {
      if (!args.length) {
        const rc = await Elona.Data.table('race_class');
        const keys = Object.keys(rc.races || {}).slice(0, 16);
        return ['用法: spawn <种族键> [等级]', '  常见种族键: ' + keys.join(', ')];
      }
      const lv = Math.max(1, parseInt(args[1], 10) || 1);
      const x = g.player.x + 1, y = g.player.y;
      const c = await g.spawnMonster(args[0], x, y, lv);
      if (!c) return [`生成失败：种族键 ${args[0]} 不存在？`];
      return [`生成 ${c.name}（Lv${c.level}）于 (${x},${y})`];
    },
  });

  register('tp', {
    usage: 'tp <地图名>',
    help: '传送到指定地图（地图名见 data/maps/*.json，如 vernis / lesimas_1）',
    async run(g, args) {
      if (!args.length) return ['用法: tp <地图名>'];
      try {
        await g.loadMap(args[0]);
        return [`已切换到 ${g.map.name}（id=${g.getV65(20)} / 子地图=${g.getV65(22)}）`];
      } catch (e) {
        return [`切换失败: ${e.message}`];
      }
    },
  });

  register('site', {
    usage: 'site [list [世界id] | info <id> | goto <id>]',
    help: '世界地图 site（var_132）—— list 列出地点，info 看详情，goto 直接进入',
    async run(g, args) {
      const S = Elona.Sites;
      if (!S) return ['site 模块未加载。'];
      await S.load();
      await S.mapNames();
      const sub = (args[0] || 'list').toLowerCase();

      if (sub === 'info') {
        const id = parseInt(args[1], 10);
        const s = S.get(id);
        if (!s) return [`没有 site ${args[1]}`];
        const f = s.fields;
        return [
          `#${id} ${s.nameEn} / ${s.nameJp}`,
          `  类型 ${f[16]}（${S.kindName(id)}）　所属世界 ${f[30]}　坐标 (${f[1]}, ${f[2]}) ${f[3]}×${f[4]}`,
          `  地图文件 ${s.mapFile}　入口危险度 ${f[17]}　最大层 ${f[10]}`,
          `  地图名 ${S.nameOf(id)}　世界地图文件 ${S.worldMapFile(f[30])}`,
          `  字段 ${JSON.stringify(f)}`,
        ];
      }

      if (sub === 'goto') {
        const id = parseInt(args[1], 10);
        const s = S.get(id);
        if (!s) return [`没有 site ${args[1]}`];
        const ok = await g.enterSite(s);
        return [ok ? `已进入 ${s.nameEn}` : `${s.nameEn} 暂时无法进入（见日志）`];
      }

      const world = args[1] ? parseInt(args[1], 10) : ((g.getV65(850) | 0) || 4);
      const list = S.ofWorld(world, { placed: true });
      const lines = [`世界 ${world}（${S.worldMapFile(world)}）共 ${list.length} 个可进入的地点：`];
      for (const s of list) {
        const f = s.fields;
        lines.push(`  ${String(s.id).padStart(3)} ${(s.nameEn || '').slice(0, 22).padEnd(24)}`
          + `(${f[1]},${f[2]})  ${S.kindName(s.id).padEnd(8)} Lv${f[17]}`);
      }
      lines.push('用法: site info <id> / site goto <id> / site list <世界id>');
      return lines;
    },
  });

  register('bank', {
    usage: 'bank [balance | in <金额档 2|3|4|5> | out]',
    help: '银行 —— 没有存钱箱就发一个（1097）；in 后面 2=10万 3=100万 4=1000万 5=1亿',
    async run(g, args) {
      const E = Elona.Economy;
      if (!E) return ['经济模块未加载。'];
      let box = E.findBankBox(g.player);
      if (!box) {
        box = Elona.ItemDB.createItem(E.BANK_ITEM, 1);
        g.player.inv.push(box);
        return ['发了一个存钱箱（1097），再执行一次 bank。'];
      }
      const sub = (args[0] || 'balance').toLowerCase();
      if (sub === 'in') {
        const act = parseInt(args[1], 10) || 2;
        const r = E.bankTrade(g, box, act);
        if (!r.ok) return [`存款失败：${r.reason}${r.message ? '（' + r.message + '）' : ''}`];
        return [`存入 ${r.stored} gold，余额 ${r.balance}（含 10% 利息）`];
      }
      if (sub === 'out') {
        const r = E.bankTrade(g, box, 1);
        if (!r.ok) return [`取款失败：${r.reason}`];
        return [`取出 ${r.taken} gold`];
      }
      return [
        `存款箱余额：${E.balance(box)} gold　持有：${g.player.get(30) | 0} gold`,
        `上次交易时刻：${E.stamp(box)}（当前 ${E.nowHours(g)}）`,
      ];
    },
  });

  register('tax', {
    usage: 'tax [pay | month]',
    help: '税金 —— 查看所得税/建筑税/滞纳；pay 用预付或现金缴纳；month 强制跑一次月度结算',
    async run(g, args) {
      const E = Elona.Economy;
      if (!E) return ['经济模块未加载。'];
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'month') {
        const r = E.monthly(g);
        return ['月度结算：'].concat(r.messages, [`滞纳 ${r.arrears} 月，账单 ${r.bill} gold`]);
      }
      if (sub === 'pay') {
        const need = E.monthlyBill(g);
        const gold = g.player.get(30) | 0;
        if (gold < need) return [`金貨が足りない（需要 ${need}，持有 ${gold}）`];
        g.player.set(30, gold - need);
        g.setV65(179, 0);
        return [`缴纳 ${need} gold，滞纳清零`];
      }
      return [
        `所得税：${E.calcTax(g)}　建筑维持费：${E.calcBuilding(g)}　雇工费：${g.getV65(170) | 0}`,
        `月度合计：${E.monthlyBill(g)} gold　滞纳：${E.arrears(g)} 月　预付：${E.prepaid(g)}`,
        `税率系数：${E.taxModifier(g.player)}%（karma ${g.player.get(49) | 0}，会計专长 ${(Elona.Feat && Elona.Feat.flag(g.player, 38)) | 0}）`,
      ];
    },
  });

  register('shop', {
    usage: 'shop [invest <槽> <金额> | collect]',
    help: '自营店 —— 9 个槽位（投资 <10000 视为开店）；collect 立刻结算今天的收入',
    async run(g, args) {
      const E = Elona.Economy;
      if (!E) return ['经济模块未加载。'];
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'invest') {
        const slot = parseInt(args[1], 10) || 0;
        const amt = parseInt(args[2], 10);
        if (Number.isNaN(amt)) return ['用法: shop invest <0-8> <投资额，10000=未开店>'];
        g.setV65(120 + slot, amt);
        return [`店铺 ${slot} 的投资额设为 ${amt}（日收入约 ${E.calcIncome(g, slot)}）`];
      }
      if (sub === 'collect') {
        const r = E.dailyIncome(g);
        const lines = [`今日收入合计 ${r.gold} gold（${r.shops.length} 家店）`];
        for (const s of r.shops) lines.push(`  槽 ${s.slot}：${s.gold} gold（投资 ${s.invest}）`);
        if (r.goods.length) lines.push(`  进货 ${r.goods.length} 件`);
        return lines;
      }
      const lines = ['店铺槽（投资额 / 日收入）：'];
      for (let i = 0; i < 9; i++) {
        const inv = g.getV65(120 + i) | 0;
        lines.push(`  ${i}: ${inv >= 10000 ? '未开店' : inv}　→ ${E.calcIncome(g, i)} gold`);
      }
      return lines;
    },
  });

  register('shopreg', {
    usage: 'shopreg [status | type <0-6> | train | feat <1-5> | limit <0-2> | samples | clear | remove | money | ui] [地产槽]',
    help: '自营店收款机 —— 改店类型 / 训练店番 / 营业天赋 / 日销售限制 / 样本柜台',
    async run(g, args) {
      const M = Elona.ShopManage;
      if (!M) return ['收款机模块未加载。'];
      const sub = (args[0] || 'status').toLowerCase();
      const val = parseInt(args[1], 10);
      const slot = parseInt(args[2], 10);
      const cur = (Elona.Property && Elona.Property.currentSite)
        ? Elona.Property.currentSite(g) : null;
      const id = Number.isNaN(slot) ? (cur ? (cur.id | 0) : 0) : slot;
      if (!id) return ['不在自家店里；可以追加地产槽（300-449）作为最后一个参数。'];
      const show = (r) => {
        if (!r) return ['没有结果。'];
        if (!r.ok) return [`失败：${r.reason}${r.need !== undefined ? '（需要业绩 ' + r.need + '，当前 ' + r.have + '）' : ''}`];
        return [r.message || '完成。'];
      };
      if (sub === 'ui') {
        if (Elona.Panels && Elona.Panels.openShopRegister) Elona.Panels.openShopRegister(g, id);
        return ['已打开收款机面板。'];
      }
      if (sub === 'type') return show(M.changeType(g, id, val));
      if (sub === 'train') return show(M.train(g, id));
      if (sub === 'feat') return show(M.grantFeat(g, id, val));
      if (sub === 'limit') return show(M.setSalesLimit(g, id, val));
      if (sub === 'samples') return show(M.markSamples(g));
      if (sub === 'clear' || sub === 'remove') {
        const w = Elona.ShopSale ? Elona.ShopSale.workerOf(g, id) : null;
        return show(M.removeFeats(g, w));
      }
      if (sub === 'money') {
        let n = 0;
        for (const c of (g.charas || [])) {
          if (c && (c.get(0) | 0) === 1 && Elona.Shop && Elona.Shop.isShopkeeper(c)) {
            Elona.Shop.generateMoney(g, c); n++;
          }
        }
        return [`已检查 ${n} 位店主的持金。`];
      }
      const st = M.status(g, id);
      if (!st.ok) return [`地产槽 ${id} 不是店铺。`];
      return [
        `地产槽 ${id}　经营种类 ${st.genreName}　类型${st.changeReady ? '可更改' : ('需等到 ' + st.changeUntil + ' 时')}`,
        `店番 ${st.worker || '未任命'}　营业实绩 ${st.sales}　天赋 ${st.feats}/2（下个门槛 ${st.featGate === null ? '已满' : st.featGate}）`,
        `训练费用 ${st.trainingCost >= 1000000 ? '不可训练（无交渉技能）' : st.trainingCost + ' 枚青铜币'}`,
        `日销售限制 ${st.salesLimitName}　已获天赋：${st.ownedFeats.join('、') || '无'}`,
      ];
    },
  });

  register('casino', {
    usage: 'casino [bet <1|5|10|20> | hit | stay | cheat | out | prize | status]',
    help: '赌场 21 点 —— 没有筹码会先送 10 枚；bet 开局，hit/stay/cheat/out 是行动',
    async run(g, args) {
      const Gm = Elona.Gamble;
      if (!Gm) return ['赌场模块未加载。'];
      const sub = (args[0] || 'status').toLowerCase();
      const show = (v) => [
        `你的手牌 ${v.player.join(' ')} = ${v.playerScore}`,
        `庄家手牌 ${v.dealer.join(' ')} = ${v.dealerScore}`,
        `筹码 ${v.chips}　赌注 ${v.bet}`,
      ];
      if (sub === 'bet') {
        const bet = parseInt(args[1], 10) || 1;
        if (Gm.chips(g) <= 0) Gm.welcome(g);
        const r = Gm.start(g, bet);
        if (!r.ok) return [`开局失败：${r.reason}（筹码 ${Gm.chips(g)}）`];
        return [`下注 ${r.bet}，发牌完毕`].concat(show(Gm.view(g)));
      }
      if (sub === 'hit') {
        const r = Gm.hit(g);
        if (!r.ok) return [`要牌失败：${r.reason}`];
        return [`补了一张 ${r.card}`].concat(show(r.view));
      }
      if (sub === 'stay') {
        const r = Gm.stay(g);
        if (!r.ok) return [`停牌失败：${r.reason}`];
        const txt = r.result === 1 ? '你赢了' : r.result === 0 ? '你输了' : '平局';
        return [`${txt}（${r.playerScore} vs ${r.dealerScore}）`].concat(show(r.view));
      }
      if (sub === 'cheat') {
        const r = Gm.cheat(g);
        if (!r.ok) return [`作弊失败：${r.reason}`];
        return r.caught
          ? ['イカサマが見つかってしまった…（karma -5）'].concat(show(r.view))
          : [`换牌成功（警戒 Lv ${r.alertLv}）`].concat(show(r.view));
      }
      if (sub === 'out') {
        const r = Gm.out(g);
        if (!r.ok) return [`认输失败：${r.reason}`];
        return [`认输，退回 ${r.refund} 枚（净损失 ${r.view.bet}）`];
      }
      if (sub === 'prize') {
        const items = Gm.prize(g);
        return [`获得 ${items.length} 件景品（景品 Lv ${Gm.rewardsLevel(g)}）`]
          .concat(items.slice(0, 8).map((it) => '  ' + Elona.ItemDB.name(it.id, 'en')));
      }
      const v = Gm.view(g);
      if (!v) return [`还没有开局。筹码 ${Gm.chips(g)} 枚。用法: casino bet 1`];
      return show(v);
    },
  });

  register('journal', {
    usage: 'journal [status | rules | mark | check]',
    help: '剧情推进（check_quest）—— status 看当前地图的进度规则与剩余目标；mark 把角色标成目标；check 立即判定',
    async run(g, args) {
      const Q = Elona.QuestCheck;
      if (!Q) return ['剧情推进模块未加载。'];
      await Q.load();
      const sub = (args[0] || 'status').toLowerCase();
      const p = g.player;

      if (sub === 'rules') {
        const lines = [`全部 ${Q.rules().length} 条推进规则（check_quest 193528-193761）：`];
        for (const r of Q.rules()) {
          lines.push(`  地图 ${String(r.mapId).padStart(3)} / 场景 ${String(r.subId).padStart(3)}`
            + ` → var_65(${r.varSlot}) = ${r.stage}　(start.hsp:${r.srcLine})`);
        }
        return lines;
      }

      if (sub === 'mark') {
        const n = Q.putTarget(g);
        return [`已把 ${n} 个角色标为剧情目标（cbit 970 + 关系 -3）。`];
      }

      if (sub === 'check') {
        const r = Q.check(g);
        const lines = [];
        if (r.journal.length) {
          for (const j of r.journal) {
            lines.push(`推进：地图 ${j.mapId}/${j.subId} → var_65(${j.varSlot}) = ${j.stage}`);
          }
        } else {
          lines.push('本次没有推进（地图/场景不匹配，或还有目标没清完）。');
        }
        if (r.questMap) {
          lines.push(`委托地图：类型 ${r.questMap.type}`
            + (r.questMap.completed ? '　已完成' : `　剩余 ${r.questMap.left === undefined ? '?' : r.questMap.left} 个敌人`));
        }
        return lines;
      }

      // status
      const mapId = g.getV65(20) | 0;
      const subId = g.getV65(22) | 0;
      const hit = Q.rulesAt(g);
      const lines = [
        `当前地图 ${g.map ? g.map.name : '?'}　var_65(20)=${mapId}　var_65(22)=${subId}`,
        `剧情目标剩余：${Q.existTarget(g)} 个（cbit 970）`,
      ];
      if (hit.length) {
        for (const r of hit) {
          lines.push(`  规则：var_65(${r.varSlot}) ${g.getV65(r.varSlot) | 0} → ${r.stage}`);
        }
      } else {
        lines.push('  这张地图没有推进规则。');
      }
      const qType = g.getV65(70) | 0;
      if (qType) {
        lines.push(`委托地图：类型 ${qType}　状态 ${g.getV65(73) | 0}　清敌人 ${g.getV65(71) | 0}`);
      }
      lines.push('用法: journal rules / journal mark / journal check');
      return lines;
    },
  });

  register('wand', {
    usage: 'wand [list | info <id> | give <id> | zap <id>]',
    help: '魔杖 —— list 看 32 种杖与对应法术；give 发一根；zap 直接挥（身边有敌人会自动瞄准）',
    async run(g, args) {
      const W = Elona.Wand;
      if (!W) return ['魔杖模块未加载。'];
      await W.load();
      const p = g.player;
      const sub = (args[0] || 'list').toLowerCase();
      const nm = (eid) => {
        const n = Elona.Spell ? Elona.Spell.actionName(eid) : null;
        return n ? ((n.ch || n.en || n.jp) || ('#' + eid)) : ('#' + eid);
      };

      if (sub === 'info') {
        const id = parseInt(args[1], 10);
        const e = W.entry(Number.isNaN(id) ? 120 : id);
        if (!e) return ['表里没有这根杖。'];
        return [
          `${Elona.ItemDB.name(e.itemId, 'en')}（${Elona.ItemDB.name(e.itemId, 'jp')}）`,
          `  效果 ${e.effectId} = ${nm(e.effectId)}　威力基数 ${e.power}`,
          `  充能 ${e.chargesExpr}　子类别 ${e.subcat}　图标 ${e.graphic}`,
          `  说明：${(e.descJp || '').split('\\n')[0]}`,
          `  源码 var_59 == 14 分支在 start.hsp:${e.srcLine}`,
        ];
      }

      if (sub === 'give') {
        const id = parseInt(args[1], 10);
        const wid = Number.isNaN(id) ? 120 : id;
        if (!W.entry(wid)) return [`${wid} 不是魔杖。`];
        const it = Elona.ItemDB.createItem(wid, 1, g.rng);
        it.identified = true;
        p.inv.push(it);
        return [`发了一根 ${Elona.ItemDB.name(it.id, 'en')}（充能 ${W.chargesOf(it)}）`];
      }

      if (sub === 'zap') {
        const id = parseInt(args[1], 10);
        let idx = Number.isNaN(id)
          ? p.inv.findIndex((it) => it && W.isWand(it) && W.chargesOf(it) > 0)
          : p.inv.findIndex((it) => it && it.id === id);
        if (idx < 0) {
          const wid = Number.isNaN(id) ? 119 : id;
          const it = Elona.ItemDB.createItem(wid, 1, g.rng);
          it.identified = true;
          p.inv.push(it);
          idx = p.inv.length - 1;
        }
        const it = p.inv[idx];
        // 以杖自身法术的类别决定「要不要目标」，交给 Wand.use 判断
        const r = W.use(g, idx, { target: args[2] === 'self' ? p : undefined });
        const cur = W.chargesOf(it);
        if (!r.ok) return [`挥动失败：${r.reason}（充能 ${cur}）`];
        return [
          `挥动 ${Elona.ItemDB.name(it.id, 'en')} → 效果 ${r.effectId} = ${nm(r.effectId)}`,
          `  威力 ${r.power}　剩余充能 ${cur}`,
        ];
      }

      // list
      const rows = W.list();
      const lines = [`可提取的魔杖 ${rows.length} 根（效果来自 var_59 == 14 分支）：`];
      for (const e of rows) {
        lines.push(`  ${String(e.itemId).padStart(4)}  ${Elona.ItemDB.name(e.itemId, 'en').padEnd(26)}`
          + ` → ${String(e.effectId).padStart(4)} ${nm(e.effectId)}`);
      }
      lines.push('用法: wand info <id> / wand give <id> / wand zap <id>');
      return lines;
    },
  });

  register('talk', {
    usage: 'talk [list | bind [key] | unbind | say <类型>]',
    help: 'NPC 自定义对话（customtalk）—— list 看可用台词文件；bind 给身边 NPC 绑定；say 让它说一句',
    async run(g, args) {
      const T = Elona.Talk;
      if (!T) return ['对话模块未加载。'];
      const p = g.player;
      const near = (g.charas || []).filter((c) => c && c !== p && (c.get(0) | 0) === 1
        && Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) <= 1);
      const sub = (args[0] || 'list').toLowerCase();

      if (sub === 'bind') {
        if (!near.length) return ['身边没有人。'];
        const key = args[1] || 'sample';
        await T.load(key);
        if (!T.cached(key)) return [`找不到台词文件 ${key}（data/talk/${key}.json）`];
        T.bind(near[0], key);
        return [`已给 ${near[0].name} 绑定 ${key}（cbit 989 已置位）`];
      }
      if (sub === 'unbind') {
        if (!near.length) return ['身边没有人。'];
        T.bind(near[0], '');
        return [`已解除 ${near[0].name} 的自定义对话`];
      }
      if (sub === 'say') {
        if (!near.length) return ['身边没有人。'];
        const type = parseInt(args[1], 10) || 106;
        const r = T.say(g, near[0], type, { lang: 'en' });
        if (!r) return [`${near[0].name} 没有可用的 ${type} 台词（${T.TYPES[type] || '?'}）`];
        return [`[${r.tag}${r.quiet ? '·静' : '·喊'}] ${r.text}`];
      }

      // list
      let idx = null;
      try { idx = await Elona.Data.fetchJson('data/talk/index.json'); } catch (e) { idx = null; }
      const files = (idx && idx.files) || [];
      if (!files.length) return ['data/talk/ 下没有台词文件。'];
      const lines = ['可用台词文件：'];
      for (const f of files) lines.push(`  ${f.key}：${f.tags} 段（JP ${f.jp} 行 / EN ${f.en} 行）`);
      lines.push('用法: talk bind [key] / talk say <100..151> / talk unbind');
      return lines;
    },
  });

  register('love', {
    usage: 'love [list | say <0-10>]',
    help: '恋爱 —— list 看身边可说话的人与好感；say 选心情菜单（10 = 求婚/遗伝子）',
    async run(g, args) {
      const R = Elona.Relation;
      if (!R) return ['恋爱模块未加载。'];
      const p = g.player;
      const near = (g.charas || []).filter((c) => c && c !== p && (c.get(0) | 0) === 1
        && Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) <= 1);
      const sub = (args[0] || 'list').toLowerCase();
      if (sub === 'say') {
        const c = near[0];
        if (!c) return ['身边没有人。'];
        const ch = parseInt(args[1], 10);
        const r = R.talk(g, c, Number.isNaN(ch) ? 0 : ch);
        if (!r.ok) return [`无法说话：${r.reason}`];
        return r.messages.concat([`好感 ${r.impression}（${R.romanceStage(r.impression).en}）`,
          r.married ? '结婚成立' : '', r.pregnant ? '怀孕' : ''].filter(Boolean));
      }
      if (!near.length) return ['身边没有人。'];
      const lines = ['身边的人：'];
      for (const c of near) {
        lines.push(`  ${R.nameOf(c)}　好感 ${R.impression(c)}（${R.romanceStage(R.impression(c)).en}）`
          + `${R.isMarried(c) ? '　已婚' : ''}${R.isPregnant(c) ? '　怀孕' : ''}`);
      }
      lines.push(`婚姻次数 ${R.marryCount(g)}　用法: love say <0-10>`);
      return lines;
    },
  });

  register('gene', {
    usage: 'gene [list | save [槽] | load <槽> | clear]',
    help: '遗伝子 —— 把当前角色存成基因（含技能/背包/能力），load 可继承到新角色',
    async run(g, args) {
      const GE = Elona.Gene;
      if (!GE) return ['基因模块未加载。'];
      const sub = (args[0] || 'list').toLowerCase();
      if (sub === 'save') {
        const slot = parseInt(args[1], 10);
        const r = GE.save(g, Number.isNaN(slot) ? 0 : slot);
        return r.ok ? [`已保存基因到槽 ${r.slot}（${r.header.name} Lv${r.header.level}）`] : [`保存失败：${r.reason}`];
      }
      if (sub === 'load') {
        const slot = parseInt(args[1], 10) || 0;
        const gene = GE.load(slot);
        if (!gene) return [`槽 ${slot} 是空的。`];
        const r = GE.apply(g, gene);
        return [`继承完成（属性点 ${r.bonus.attr} / 技能点 ${r.bonus.skill}）`];
      }
      if (sub === 'clear') {
        GE.clearAll();
        return ['已清空全部基因槽。'];
      }
      const list = GE.list();
      if (!list.length) return ['还没有保存过基因。'];
      return list.map((x) => (x
        ? `槽 ${x.slot}：${x.header.name} Lv${x.header.level}（属性点 ${x.bonus.attr} / 技能点 ${x.bonus.skill}）`
        : `槽 ${x.slot}：空`));
    },
  });

  register('town', {
    usage: 'town <城镇名>',
    help: '按城镇名旅行（vernis / palmia / kapul …）',
    async run(g, args) {
      if (!args.length) {
        return ['用法: town <城镇名>', '  可选: ' + Elona.Towns.names().join(', ')];
      }
      if (!Elona.Towns.byName(args[0])) return ['没有这个城镇: ' + args[0]];
      await g.travelToTown(args[0]);
      return [`已抵达 ${args[0]}`];
    },
  });

  register('dungeon', {
    usage: 'dungeon [层数]',
    help: '进入随机迷宫指定层（默认第 1 层）',
    async run(g, args) {
      if (!g.enterDungeon) return ['当前版本没有迷宫入口。'];
      const d = Math.max(1, parseInt(args[0], 10) || 1);
      await g.enterDungeon(d);
      return [`已进入迷宫第 ${d} 层`];
    },
  });

  register('heal', {
    usage: 'heal',
    help: 'HP/MP/SP 回满',
    run(g) {
      const p = g.player;
      p.hp = p.hpMax; p.mp = p.mpMax; p.sp = p.spMax;
      return [`回复：HP ${p.hp}/${p.hpMax}  MP ${p.mp}/${p.mpMax}  SP ${p.sp}/${p.spMax}`];
    },
  });

  register('lv', {
    usage: 'lv <等级>',
    help: '临时设置等级（仅调试用，不改技能值）',
    run(g, args) {
      const n = parseInt(args[0], 10);
      if (Number.isNaN(n)) return ['用法: lv <等级>'];
      g.player.set(38, n);
      g.player.level = n;
      return [`等级 ← ${n}`];
    },
  });

  register('gold', {
    usage: 'gold <数量>',
    help: '设置金币（var_58(30)）',
    run(g, args) {
      const n = parseInt(args[0], 10);
      if (Number.isNaN(n)) return ['用法: gold <数量>'];
      g.player.set(30, n);
      return [`金币 ← ${n}`];
    },
  });

  register('turn', {
    usage: 'turn [次数]',
    help: '推进若干回合（默认 1），用于观察天气/任务/状态变化',
    run(g, args) {
      const n = Math.max(1, parseInt(args[0], 10) || 1);
      for (let i = 0; i < n; i++) g.endTurn();
      return [`推进 ${n} 回合 → 当前 ${g.turn}`];
    },
  });

  register('cache', {
    usage: 'cache',
    help: '显示已预加载到内存的数据文件数量',
    run() {
      const n = Elona.Data && Elona.Data.cached ? Elona.Data.cached() : -1;
      return [`内存中已缓存 ${n} 个数据文件`];
    },
  });

  register('save', {
    usage: 'save [槽位]',
    help: '保存到指定槽位（默认 slot1）',
    async run(g, args) {
      const slot = args[0] || 'slot1';
      await Elona.Save.save(slot, g.serialize());
      return [`已保存到 ${slot}`];
    },
  });

  register('load', {
    usage: 'load [槽位]',
    help: '读取指定槽位（默认 slot1）',
    async run(g, args) {
      const slot = args[0] || 'slot1';
      const data = await Elona.Save.load(slot);
      if (!data) return [`槽位 ${slot} 没有存档。`];
      await g.deserialize(data);
      return [`已读取 ${slot}`];
    },
  });

  register('clear', {
    usage: 'clear',
    help: '清空控制台输出',
    run(g, args, out) { out.clear = true; return []; },
  });

  register('close', {
    usage: 'close',
    help: '关闭控制台',
    run(g, args, out) { out.close = true; return []; },
  });

  /**
   * 执行一行命令。
   * @returns {Promise<{ok:boolean, lines:string[], clear:boolean, close:boolean}>}
   */
  async function exec(g, line) {
    const out = { ok: true, lines: [], clear: false, close: false };
    const text = (line || '').trim();
    if (!text) return out;
    const parts = splitArgs(text);
    const name = parts.shift().toLowerCase();
    const cmd = COMMANDS[name];
    if (!cmd) {
      out.ok = false;
      out.lines.push(`未知指令: ${name}（输入 help 查看全部）`);
      return out;
    }
    try {
      const r = await cmd.run(g, parts, out);
      if (r) out.lines.push(...[].concat(r));
    } catch (e) {
      out.ok = false;
      out.lines.push('执行出错: ' + (e && e.message ? e.message : String(e)));
    }
    return out;
  }

  Elona.Console = {
    register, exec, splitArgs,
    commands() { return Object.keys(COMMANDS).sort(); },
    command(name) { return COMMANDS[name]; },
  };
})(window);
