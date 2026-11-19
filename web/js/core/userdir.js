'use strict';
/**
 * 用户自定义目录（core/userdir.js）—— 原版 `user\` 目录的网页实现
 *
 * 【原版语义】`elonaplus2.33R/user/` 是官方留给玩家的覆盖目录。游戏运行时优先读这里，
 *   读不到才回退到 `original/` 或 `graphic/`、`sound/` 等自带资源：
 *
 *   | 路径              | 作用                                          | 源码 |
 *   | ----------------- | --------------------------------------------- | ---- |
 *   | `talk/*.txt`      | 同伴口調（customtalk 台词库）                  | 192947-192955, 291110-291121 |
 *   | `item/planN.txt`  | 物品 N 的名字 / 鉴定描述 / flavor              | 30655, 299747, 300100 |
 *   | `item/planN.bmp`  | 物品 N 的图标（图集第 890+N 格）               | 303003-303013 |
 *   | `music/musiclist.txt` | BGM 编号 → 文件名映射（`文件名<TAB>曲名`）  | 6870-6884, 7430-7444 |
 *   | `sound/seN.wav`   | 音效槽 188-287（se0..se99）                    | 6767-6870 |
 *   | `graphic/faceN.bmp` | 玩家自定义脸（portrait < 0 时用）            | 425517-425530, 293431 |
 *   | `graphic/Pic_N.bmp` | 立绘覆盖（图集 692+N 格）                    | 294784, 302992 |
 *   | `graphic/chara_N.bmp` | 角色图覆盖（图集第 N 格）                  | 302981-302990 |
 *   | `graphic/item_N.bmp` | 物品图覆盖（图集第 N 格）                    | 303014-303022 |
 *   | `graphic2/faceN_X.bmp` | 高清立绘（`var_58(431)` 选 A/B/E/F/H/Q）  | 289363-289411, 294683-294697 |
 *   | `graphic2/cutinN.bmp` | 事件过场立绘                                | 210336 |
 *   | `graphic2/animeEX.bmp` | 动画素材                                  | 210268 |
 *   | `backup/`         | 存档备份                                    | 302658-303182 |
 *   | `export.txt`      | Show Room 导出设置                           | 23264, 301179 |
 *   | `lastwords.txt`   | 遗言                                        | 9709, 23268 |
 *   | `*.npc`           | 自定义 NPC（zip 容器：npc1.t/npc2.t/npc3.t）  | 302826-303182 |
 *   | `help.txt`        | 游戏内帮助                                  | 425517-425640 |
 *
 * 【网页为什么需要这一层】浏览器没有文件系统。三条取数路径，按优先级：
 *   1. **File System Access API**：用户授权 `user/` 目录，可读可写 —— 和原版一样，
 *      改完 txt 重进游戏就生效；backup/export/.npc 也能真的落盘。
 *   2. **`<input webkitdirectory>`**：只能读一次快照（Firefox/Safari 走这条）。
 *   3. **内置数据包** `data/user/index.json`：原版随附的默认文本
 *      （talk/sample.txt、item/plan1-33.txt、music/musiclist.txt、help*.txt），
 *      由 `tools/gen_userdata.js` 从 `elonaplus2.33R/user/` 抽出并转成 UTF-8。
 *      只覆盖**文本**；图片 / 音频体积太大（graphic2 里单张 2.4MB）不打进包。
 *
 * 【编码】原版 txt 是 CP932（Shift-JIS 的超集）。读文本时先试 UTF-8 严格解码，
 *   失败再回退 `shift_jis`（Chromium 的 shift_jis 解码器 = Windows-31J，能解 CP932 常用字）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const DB_NAME = 'elona_userdir';
  const DB_VER = 1;
  const ST_KV = 'kv';
  const DIR_KEY = 'userDir';
  const BUILTIN_URL = 'data/user/index.json';
  /** 构建期打包进 web/assets/user/ 的素材清单（图片/音频为主，文本也有） */
  const ASSETS_INDEX_URL = 'data/user/assets.json';
  const ASSETS_BASE = 'assets/user/';

  let dbPromise = null;
  let dirHandle = null;         // FileSystemDirectoryHandle
  let snapshot = null;          // Map<string, File>（webkitdirectory 兜底）
  let snapshotName = null;
  let builtin = null;           // { files: { 'talk/sample.txt': '...' } }
  let builtinPromise = null;
  let assetsIndex = null;       // Set<string>（小写路径）
  let assetsPromise = null;
  const textCache = new Map();  // path → string
  const urlCache = new Map();   // path → blob: URL

  const listeners = [];

  // ---------------------------------------------------------------- IndexedDB
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      // 隐私模式 / 老浏览器没有 indexedDB
      if (!global.indexedDB) { resolve(null); return; }
      let req;
      try { req = global.indexedDB.open(DB_NAME, DB_VER); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ST_KV)) db.createObjectStore(ST_KV, { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  async function kvGet(k) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(ST_KV, 'readonly');
        const rq = tx.objectStore(ST_KV).get(k);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  async function kvPut(rec) {
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(ST_KV, 'readwrite');
        tx.objectStore(ST_KV).put(rec);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }

  // ---------------------------------------------------------------- 编码
  /**
   * 字节 → 字符串。原版 txt 是 CP932，玩家也可能存成 UTF-8。
   * @param {ArrayBuffer|Uint8Array} raw
   */
  function decodeBytes(raw) {
    const buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (!buf.length) return '';
    // UTF-8 BOM
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(buf.subarray(3));
    }
    // UTF-16 BOM（记事本另存为 Unicode 时会这样）
    if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.subarray(2));
    if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.subarray(2));
    // 先严格按 UTF-8 试；ASCII 与真 UTF-8 都能过
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) { /* 不是合法 UTF-8，按 CP932 处理 */ }
    try { return new TextDecoder('shift_jis').decode(buf); } catch (e) { /* 继续退 */ }
    return new TextDecoder('utf-8').decode(buf);
  }

  /** 文本 → 字节（写回时统一 CP932，与原版一致；解不了的字符用 UTF-8 兜底） */
  function encodeText(text) {
    // 浏览器没有 CP932 编码器（只有解码器），所以写回统一 UTF-8。
    // 原版读 txt 时不区分编码（HSP `noteload` 走系统代码页），
    // 网页端自己的解码器会先试 UTF-8，因此回写 UTF-8 是自洽的。
    return new TextEncoder().encode(String(text == null ? '' : text));
  }

  // ---------------------------------------------------------------- 内置包
  function loadBuiltin() {
    if (builtinPromise) return builtinPromise;
    builtinPromise = (async () => {
      try {
        const res = await fetch(BUILTIN_URL);
        if (!res.ok) return null;
        builtin = await res.json();
        return builtin;
      } catch (e) { return null; }
    })();
    return builtinPromise;
  }

  /**
   * 构建期打包的素材清单 `data/user/assets.json`（web/assets/user/ 下的真实文件）。
   * 这一层比内置文本包更宽：图片、音频都在这里（内置包只收文本）。
   */
  function loadAssetsIndex() {
    if (assetsPromise) return assetsPromise;
    assetsPromise = (async () => {
      try {
        const res = await fetch(ASSETS_INDEX_URL);
        if (!res.ok) return null;
        const j = await res.json();
        assetsIndex = new Set((j.files || []).map((s) => String(s).toLowerCase()));
        return assetsIndex;
      } catch (e) { return null; }
    })();
    return assetsPromise;
  }

  /** 该路径是否在构建期素材包里 */
  function inAssets(path) {
    if (!assetsIndex) return false;
    return assetsIndex.has(String(path).toLowerCase());
  }

  // ---------------------------------------------------------------- 路径
  /** 归一化：'\\' → '/'，去掉开头的 './' 与 'user/' 前缀 */
  function norm(path) {
    let p = String(path == null ? '' : path).replace(/\\/g, '/').trim();
    p = p.replace(/^\.\//, '').replace(/^\/+/, '');
    p = p.replace(/^user\//i, '');
    return p;
  }

  function splitPath(path) {
    const p = norm(path);
    const i = p.lastIndexOf('/');
    return i < 0 ? ['', p] : [p.slice(0, i), p.slice(i + 1)];
  }

  /** 通配符（`*.txt`）→ RegExp */
  function globToRe(pattern) {
    const p = String(pattern || '*');
    const esc = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + esc + '$', 'i');
  }

  // ---------------------------------------------------------------- 目录访问
  async function getDir(allowPrompt) {
    if (!global.showDirectoryPicker) return null;
    if (!dirHandle) {
      const rec = await kvGet(DIR_KEY);
      if (rec && rec.handle) dirHandle = rec.handle;
    }
    if (!dirHandle) return null;
    let perm = 'granted';
    try {
      if (dirHandle.queryPermission) perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    } catch (e) { /* 旧实现没有 queryPermission，按已授权处理 */ }
    if (perm === 'granted') return dirHandle;
    if (!allowPrompt) return null;
    try {
      if (dirHandle.requestPermission) perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    } catch (e) { return null; }
    return perm === 'granted' ? dirHandle : null;
  }

  /** 逐级取子目录句柄（'talk' / 'graphic2' …） */
  async function subdir(h, dir, create) {
    if (!dir) return h;
    let cur = h;
    for (const part of dir.split('/')) {
      if (!part) continue;
      cur = await cur.getDirectoryHandle(part, { create: !!create });
    }
    return cur;
  }

  // ---------------------------------------------------------------- 状态
  function fire(evt) {
    for (const fn of listeners) { try { fn(evt); } catch (e) { /* 忽略监听器异常 */ } }
  }

  const UserDir = {
    /** File System Access API 是否可用（Chromium 系才有） */
    get supported() { return !!global.showDirectoryPicker; },

    /** 'dir'（已授权目录）| 'snapshot'（webkitdirectory 快照）| 'builtin'（内置默认） */
    get state() {
      if (dirHandle) return 'dir';
      if (snapshot) return 'snapshot';
      return 'builtin';
    },
    get dirName() { return dirHandle ? (dirHandle.name || 'user') : snapshotName; },
    /** 能否写回磁盘（只有真目录才行） */
    get writable() { return !!dirHandle; },
    get ready() { return !!(dirHandle || snapshot); },

    /** 订阅变更（attach / detach / invalidate） */
    onChange(fn) { if (typeof fn === 'function') listeners.push(fn); return () => {
      const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
    }; },

    /** 不弹窗地恢复上次授权的目录（页面加载时调用） */
    async restore() {
      const h = await getDir(false);
      if (h) { await loadBuiltin(); fire({ type: 'restore', state: this.state }); return true; }
      return false;
    },

    /**
     * 让用户选 `user/` 目录（必须处在用户点击的调用栈里）。
     * @returns {Promise<boolean>}
     */
    async attach() {
      if (!global.showDirectoryPicker) return false;
      let h;
      try {
        h = await global.showDirectoryPicker({ id: 'elona-user', mode: 'readwrite' });
      } catch (e) { return false; }       // 用户取消
      dirHandle = h;
      snapshot = null;
      snapshotName = null;
      this.invalidate();
      await kvPut({ k: DIR_KEY, handle: h, name: h.name || 'user' });
      fire({ type: 'attach', state: this.state, name: this.dirName });
      return true;
    },

    /** 断开授权（保留内置包） */
    async detach() {
      dirHandle = null;
      snapshot = null;
      snapshotName = null;
      this.invalidate();
      await kvPut({ k: DIR_KEY, handle: null });
      fire({ type: 'detach', state: this.state });
    },

    /**
     * 用 `<input type="file" webkitdirectory>` 的结果建一份只读快照。
     * @param {FileList|File[]} files
     * @param {string} [rootName] 用户选的目录名（webkitRelativePath 的第一段）
     */
    attachFromInput(files, rootName) {
      const list = Array.from(files || []);
      if (!list.length) return false;
      const map = new Map();
      let root = rootName || '';
      for (const f of list) {
        const rel = f.webkitRelativePath || f.name;
        const parts = rel.split('/');
        if (!root && parts.length > 1) root = parts[0];
        // 去掉第一段（目录名）
        const p = norm(parts.length > 1 ? parts.slice(1).join('/') : rel);
        if (p) map.set(p.toLowerCase(), f);
      }
      // 若用户选的正好是 user/ 目录本身，上面去掉了 'user'，是对的；
      // 若选的是父目录，第一段可能是 'user'，也要去掉。
      if (root && /^user$/i.test(root)) { /* 已去掉 */ }
      snapshot = map;
      snapshotName = root || 'user';
      dirHandle = null;
      this.invalidate();
      fire({ type: 'attach', state: this.state, name: this.dirName });
      return true;
    },

    /** 清空读取缓存（用户改了文件后调用） */
    invalidate() {
      textCache.clear();
      for (const u of urlCache.values()) { try { global.URL.revokeObjectURL(u); } catch (e) { /* 忽略 */ } }
      urlCache.clear();
      fire({ type: 'invalidate' });
    },

    /** 是否能从某个来源拿到文件 */
    async has(path) {
      const p = norm(path);
      if (!p) return false;
      if (dirHandle) {
        try {
          const [dir, name] = splitPath(p);
          const h = await subdir(dirHandle, dir, false);
          await h.getFileHandle(name);
          return true;
        } catch (e) { /* 继续查下一层 */ }
      }
      if (snapshot && snapshot.has(p.toLowerCase())) return true;
      await loadAssetsIndex();
      return inAssets(p);
    },

    /** 取 File 对象（目录 / 快照） */
    async file(path) {
      const p = norm(path);
      if (!p) return null;
      if (dirHandle) {
        try {
          const [dir, name] = splitPath(p);
          const h = await subdir(dirHandle, dir, false);
          const fh = await h.getFileHandle(name);
          return await fh.getFile();
        } catch (e) { return null; }
      }
      if (snapshot) return snapshot.get(p.toLowerCase()) || null;
      return null;
    },

    /**
     * 读文本。来源顺序：授权目录 → 快照 → 内置包。
     * @returns {Promise<string|null>}
     */
    async readText(path) {
      const p = norm(path);
      if (!p) return null;
      const key = p.toLowerCase();
      if (textCache.has(key)) return textCache.get(key);
      const f = await this.file(p);
      if (f) {
        let txt = '';
        try { txt = decodeBytes(await f.arrayBuffer()); } catch (e) { txt = ''; }
        textCache.set(key, txt);
        return txt;
      }
      const b = await loadBuiltin();
      if (b && b.files) {
        // 内置包键名统一小写
        const v = b.files[key];
        if (v !== undefined) { textCache.set(key, v); return v; }
      }
      // 构建期素材包里的文本（例如 assets/user/music/musiclist.txt）
      await loadAssetsIndex();
      if (inAssets(p)) {
        try {
          const res = await fetch(ASSETS_BASE + p);
          if (res.ok) {
            const txt = decodeBytes(await res.arrayBuffer());
            textCache.set(key, txt);
            return txt;
          }
        } catch (e) { /* 忽略 */ }
      }
      return null;
    },

    /** 读字节 */
    async readBytes(path) {
      const p = norm(path);
      const f = await this.file(p);
      if (f) {
        try { return new Uint8Array(await f.arrayBuffer()); } catch (e) { return null; }
      }
      await loadAssetsIndex();
      if (inAssets(p)) {
        try {
          const res = await fetch(ASSETS_BASE + p);
          if (res.ok) return new Uint8Array(await res.arrayBuffer());
        } catch (e) { /* 忽略 */ }
      }
      return null;
    },

    /** 取可直接放进 <img src> / <audio src> 的 URL */
    async url(path) {
      const p = norm(path);
      if (!p) return null;
      const key = p.toLowerCase();
      if (urlCache.has(key)) return urlCache.get(key);
      const f = await this.file(p);
      if (f) {
        let u = null;
        try { u = global.URL.createObjectURL(f); } catch (e) { return null; }
        urlCache.set(key, u);
        return u;
      }
      await loadAssetsIndex();
      if (inAssets(p)) {
        const u = ASSETS_BASE + p;
        urlCache.set(key, u);
        return u;
      }
      return null;
    },

    /**
     * 列出目录下的文件名（支持 `*.txt` 通配）。
     * 目录优先级同 readText：授权目录 → 快照 → 内置包里的同目录条目。
     * @returns {Promise<string[]>} 只返回文件名，按字典序
     */
    async list(dir, pattern) {
      const d = norm(dir).replace(/\/+$/, '');
      const re = globToRe(pattern || '*');
      const out = new Set();

      if (dirHandle) {
        try {
          const h = await subdir(dirHandle, d, false);
          for await (const [name, entry] of h.entries()) {
            if (entry.kind !== 'file') continue;
            if (re.test(name)) out.add(name);
          }
        } catch (e) { /* 目录不存在 */ }
      }
      if (!out.size && snapshot) {
        const prefix = d ? (d.toLowerCase() + '/') : '';
        for (const k of snapshot.keys()) {
          if (!k.startsWith(prefix)) continue;
          const name = k.slice(prefix.length);
          if (name.includes('/')) continue;
          if (re.test(name)) out.add(name);
        }
      }
      if (!out.size) {
        const b = await loadBuiltin();
        if (b && b.files) {
          const prefix = d ? (d.toLowerCase() + '/') : '';
          for (const k of Object.keys(b.files)) {
            if (!k.startsWith(prefix)) continue;
            const name = k.slice(prefix.length);
            if (name.includes('/')) continue;
            if (re.test(name)) out.add(name);
          }
        }
      }
      // 构建期素材包（web/assets/user/）—— 图片/音频只在这一层。
      //   只在前面几层都没结果时使用，避免把内置素材混进用户的目录列表。
      if (!out.size) {
        await loadAssetsIndex();
        if (assetsIndex) {
          const prefix = d ? (d.toLowerCase() + '/') : '';
          for (const k of assetsIndex) {
            if (!k.startsWith(prefix)) continue;
            const name = k.slice(prefix.length);
            if (name.includes('/')) continue;
            if (re.test(name)) out.add(name);
          }
        }
      }
      return Array.from(out).sort((a, b) => a.localeCompare(b, 'en'));
    },

    /**
     * 写文件（只有授权目录能写；快照 / 内置包返回 false）。
     * @param {string} path
     * @param {string|Uint8Array|ArrayBuffer} data
     */
    async write(path, data) {
      const h = await getDir(true);
      if (!h) return false;
      const p = norm(path);
      if (!p) return false;
      const [dir, name] = splitPath(p);
      try {
        const dh = await subdir(h, dir, true);
        const fh = await dh.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(typeof data === 'string' ? encodeText(data) : data);
        await w.close();
        textCache.delete(p.toLowerCase());
        return true;
      } catch (e) { return false; }
    },

    /** 删除文件（仅授权目录） */
    async remove(path) {
      const h = await getDir(true);
      if (!h) return false;
      const p = norm(path);
      const [dir, name] = splitPath(p);
      try {
        const dh = await subdir(h, dir, false);
        await dh.removeEntry(name);
        textCache.delete(p.toLowerCase());
        return true;
      } catch (e) { return false; }
    },

    /** 编码工具（供其它模块复用） */
    decodeBytes, encodeText, norm, globToRe, loadBuiltin,
    /** 当前目录句柄（backup 之类需要遍历整棵子树的模块用） */
    async handle(allowPrompt) { return getDir(allowPrompt); },
    /** 内置包原文（调试用） */
    async builtinFiles() { const b = await loadBuiltin(); return b ? Object.keys(b.files || {}) : []; },
  };

  Elona.UserDir = UserDir;
})(window);
