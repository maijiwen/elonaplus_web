'use strict';
/**
 * 存档层（纯 Web，无后端）。
 *
 * 存储分两处，互为主备：
 *   1. 浏览器缓存：IndexedDB（不可用时退回 localStorage）—— 换浏览器看不到；
 *   2. 磁盘目录：用户授权一次 saves/ 文件夹（File System Access API），
 *      每个槽位写 <slot>.json（完整存档）+ <slot>.meta.json（列表用元数据）——
 *      任意浏览器授权同一目录后都能读到。
 *
 * 读取顺序按用户要求：先看浏览器缓存，没有再去磁盘目录找。
 * 保存时两边都写；磁盘目录未授权时只写缓存，并在消息窗提示。
 *
 * 注意：File System Access API 目前只有 Chromium 系（Edge / Chrome）支持；
 * Firefox / Safari 只能使用浏览器缓存（换浏览器时请用导出/导入，或改用 Edge）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const DB_NAME = 'elona_saves';
  const DB_VER = 1;
  const ST_SAVES = 'saves';
  const ST_KV = 'kv';
  const DIR_KEY = 'savesDir';
  const LS_PREFIX = 'elona.save.';
  const META_SUFFIX = '.meta.json';

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      const idb = global.indexedDB;
      if (!idb) { resolve(null); return; }
      let req;
      try { req = idb.open(DB_NAME, DB_VER); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ST_SAVES)) {
          db.createObjectStore(ST_SAVES, { keyPath: 'slot' });
        }
        if (!db.objectStoreNames.contains(ST_KV)) {
          db.createObjectStore(ST_KV, { keyPath: 'k' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return dbPromise;
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function cacheGet(slot) {
    const db = await openDb();
    if (!db) return null;
    try {
      const tx = db.transaction(ST_SAVES, 'readonly');
      return await reqP(tx.objectStore(ST_SAVES).get(slot));
    } catch (e) { return null; }
  }

  async function cacheAll() {
    const db = await openDb();
    if (!db) return [];
    try {
      const tx = db.transaction(ST_SAVES, 'readonly');
      return (await reqP(tx.objectStore(ST_SAVES).getAll())) || [];
    } catch (e) { return []; }
  }

  async function cachePut(rec) {
    const db = await openDb();
    if (!db) return false;
    try {
      const tx = db.transaction(ST_SAVES, 'readwrite');
      tx.objectStore(ST_SAVES).put(rec);
      return true;
    } catch (e) { return false; }
  }

  async function kvGet(k) {
    const db = await openDb();
    if (!db) return null;
    try {
      const tx = db.transaction(ST_KV, 'readonly');
      return await reqP(tx.objectStore(ST_KV).get(k));
    } catch (e) { return null; }
  }

  async function kvPut(rec) {
    const db = await openDb();
    if (!db) return false;
    try {
      const tx = db.transaction(ST_KV, 'readwrite');
      tx.objectStore(ST_KV).put(rec);
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- 磁盘目录
  let dirHandle = null;

  /**
   * 取得已授权的存档目录。
   * @param {boolean} allowPrompt true = 允许弹权限框（必须处在用户点击的调用栈里）
   */
  async function getDir(allowPrompt) {
    if (!global.showDirectoryPicker) return null;
    if (!dirHandle) {
      const rec = await kvGet(DIR_KEY);
      if (rec && rec.handle) dirHandle = rec.handle;
    }
    if (!dirHandle) return null;
    let perm = 'granted';
    try {
      if (dirHandle.queryPermission) {
        perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      }
    } catch (e) { /* 旧实现没有 queryPermission，按已授权处理 */ }
    if (perm === 'granted') return dirHandle;
    if (!allowPrompt) return null;
    try {
      if (dirHandle.requestPermission) {
        perm = await dirHandle.requestPermission({ mode: 'readwrite' });
      }
    } catch (e) { return null; }
    return perm === 'granted' ? dirHandle : null;
  }

  function metaOf(data) {
    return (data && data.meta) ? data.meta : null;
  }

  async function writeFile(h, name, text) {
    const fh = await h.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  async function diskSave(h, slot, data, time) {
    await writeFile(h, slot + '.json', JSON.stringify(data));
    await writeFile(h, slot + META_SUFFIX, JSON.stringify({ time, meta: metaOf(data) }));
  }

  async function diskList() {
    const h = await getDir(false);
    if (!h || !h.entries) return { list: [], name: null };
    const out = [];
    const seen = new Set();
    try {
      for await (const [name, entry] of h.entries()) {
        if (entry.kind !== 'file' || !name.endsWith(META_SUFFIX)) continue;
        const slot = name.slice(0, -META_SUFFIX.length);
        try {
          const f = await entry.getFile();
          const m = JSON.parse(await f.text());
          out.push({
            slot, time: Number(m.time) || f.lastModified || 0,
            meta: m.meta || null, source: 'disk',
          });
          seen.add(slot);
        } catch (e) { /* 跳过损坏的 meta */ }
      }
      // 兼容旧版（Java 后端）留下的 <slot>.json：没有 meta 时解析一次补上
      for await (const [name, entry] of h.entries()) {
        if (entry.kind !== 'file' || !name.endsWith('.json') || name.endsWith(META_SUFFIX)) continue;
        const slot = name.slice(0, -'.json'.length);
        if (seen.has(slot)) continue;
        try {
          const f = await entry.getFile();
          const data = JSON.parse(await f.text());
          out.push({
            slot, time: Date.parse(data.savedAt) || f.lastModified || 0,
            meta: metaOf(data), source: 'disk',
          });
        } catch (e) { /* 跳过损坏的存档 */ }
      }
    } catch (e) { /* 目录读取失败按没有磁盘存档处理 */ }
    return { list: out, name: h.name || null };
  }

  async function diskLoad(slot) {
    const h = await getDir(true);
    if (!h) throw new Error('未连接磁盘存档文件夹');
    const fh = await h.getFileHandle(slot + '.json');
    const f = await fh.getFile();
    return JSON.parse(await f.text());
  }

  // ---------------------------------------------------------------- localStorage（旧存档）
  function localList() {
    const list = [];
    const ls = global.localStorage;
    if (!ls) return list;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      let time = 0;
      let meta = null;
      try {
        const d = JSON.parse(ls.getItem(k) || 'null');
        if (d) {
          time = Date.parse(d.savedAt) || 0;
          meta = metaOf(d);
        }
      } catch (e) { /* 损坏的旧存档按 0 处理 */ }
      list.push({ slot: k.slice(LS_PREFIX.length), time, meta, source: 'cache' });
    }
    return list;
  }

  const Save = {
    /** 最近一次 save() 的落点：'both' = 缓存 + 磁盘；'cache' = 只有浏览器缓存 */
    mode: 'cache',
    /** 已连接的磁盘存档目录名（未连接为 null） */
    folderName: null,

    /** 让用户选择 saves/ 文件夹并持久化授权（必须在点击事件里调用） */
    async connectFolder() {
      if (!global.showDirectoryPicker) {
        throw new Error('当前浏览器不支持写入磁盘文件夹，请使用 Edge / Chrome');
      }
      const h = await global.showDirectoryPicker({ id: 'elona-saves', mode: 'readwrite' });
      dirHandle = h;
      await kvPut({ k: DIR_KEY, handle: h });
      this.folderName = h.name || null;
      return this.folderName;
    },

    /** 是否已连接且可写（不弹权限框） */
    async hasFolder() {
      return !!(await getDir(false));
    },

    /**
     * 列出所有存档：浏览器缓存 + 磁盘目录按槽位合并。
     *   同一槽位两边都有时取时间较新的一份，并标记 source='both'。
     */
    async list() {
      const out = [];
      const bySlot = new Map();
      for (const rec of await cacheAll().catch(() => [])) {
        if (!rec || !rec.slot) continue;
        const item = {
          slot: rec.slot,
          time: Number(rec.time) || Date.parse((rec.data || {}).savedAt) || 0,
          meta: rec.meta || null, source: 'cache',
        };
        out.push(item);
        bySlot.set(item.slot, item);
      }
      for (const s of localList()) {
        const cur = bySlot.get(s.slot);
        if (!cur) { out.push(s); bySlot.set(s.slot, s); continue; }
        if ((Number(s.time) || 0) > (Number(cur.time) || 0)) {
          cur.time = s.time;
          cur.meta = s.meta || cur.meta;
        }
      }
      const disk = await diskList().catch(() => ({ list: [], name: null }));
      this.folderName = disk.name;
      for (const s of disk.list) {
        const cur = bySlot.get(s.slot);
        if (!cur) { out.push(s); bySlot.set(s.slot, s); continue; }
        cur.source = 'both';
        cur.inCache = true;
        cur.inDisk = true;
        if ((Number(s.time) || 0) > (Number(cur.time) || 0)) {
          cur.time = s.time;
          cur.meta = s.meta || cur.meta;
        }
      }
      // 时间戳是毫秒，超出 32 位有符号范围，不能做 |0 截断
      out.sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
      return out;
    },

    /** 保存到指定槽位：浏览器缓存 + 磁盘目录（已授权时）各写一份 */
    async save(slot, data) {
      const now = Date.now();
      const meta = metaOf(data);
      let cached = await cachePut({ slot, time: now, meta, data });
      if (!cached) {
        try {
          global.localStorage.setItem(LS_PREFIX + slot, JSON.stringify(data));
          cached = true;
        } catch (e) { /* localStorage 也写不了时只能依赖磁盘 */ }
      }
      let disk = false;
      try {
        const h = await getDir(false);
        if (h) {
          await diskSave(h, slot, data, now);
          disk = true;
          this.folderName = h.name || null;
        }
      } catch (e) { /* 磁盘写失败不影响浏览器缓存里的存档 */ }
      this.mode = disk ? 'both' : 'cache';
      return cached || disk;
    },

    /** 读取槽位：先浏览器缓存，没有再去磁盘目录 */
    async load(slot) {
      const rec = await cacheGet(slot);
      if (rec && rec.data) { this.mode = 'cache'; return rec.data; }
      let raw = null;
      try {
        raw = global.localStorage ? global.localStorage.getItem(LS_PREFIX + slot) : null;
      } catch (e) { raw = null; }
      if (raw) { this.mode = 'cache'; return JSON.parse(raw); }
      const data = await diskLoad(slot);
      this.mode = 'disk';
      return data;
    },

    /** 最新存档的槽位（死亡后自动读档用） */
    async latest() {
      const list = await this.list();
      if (!list.length) return null;
      return list[0].slot;
    },
  };

  Elona.Save = Save;
})(window);
