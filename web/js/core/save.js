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
  const DB_VER = 2;
  const ST_SAVES = 'saves';
  const ST_FLOORS = 'floors';
  const ST_KV = 'kv';
  const DIR_KEY = 'savesDir';
  const LS_PREFIX = 'elona.save.';
  const LS_FLOOR_PREFIX = 'elona.floor.';
  const META_SUFFIX = '.meta.json';
  const CORE_FILE = 'core.json';
  const META_FILE = 'meta.json';
  const FLOORS_DIR = 'floors';

  let dbPromise = null;

  function floorFileName(floorKey) {
    return 'floor_' + String(floorKey || '').replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
  }

  function floorDbKey(slot, floorKey) {
    return String(slot || '') + '::' + String(floorKey || '');
  }

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
        if (!db.objectStoreNames.contains(ST_FLOORS)) {
          const st = db.createObjectStore(ST_FLOORS, { keyPath: 'k' });
          st.createIndex('slot', 'slot', { unique: false });
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

  function txP(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
  }

  /**
   * 0-Z40：浏览器缓存只保留**一个最新槽位**的存档。
   * 这里仍然按 slot 取记录（兼容读档 / 迁移），但 save() 在写新槽位前
   * 会先把旧缓存档落盘并清掉缓存，避免 IndexedDB / localStorage 里堆积所有槽位。
   */
  async function cacheGet(slot) {
    const db = await openDb();
    if (!db) return null;
    try {
      const tx = db.transaction(ST_SAVES, 'readonly');
      return await reqP(tx.objectStore(ST_SAVES).get(slot));
    } catch (e) { return null; }
  }

  async function cacheDelete(slot) {
    const db = await openDb();
    if (!db) return false;
    try {
      const tx = db.transaction(ST_SAVES, 'readwrite');
      tx.objectStore(ST_SAVES).delete(slot);
      await txP(tx);
      return true;
    } catch (e) { return false; }
  }

  async function cacheClearFloors(slot) {
    const db = await openDb();
    if (!db || !db.objectStoreNames.contains(ST_FLOORS)) return false;
    try {
      const recs = await cacheListFloors(slot);
      if (!recs.length) return true;
      const tx = db.transaction(ST_FLOORS, 'readwrite');
      for (const rec of recs) tx.objectStore(ST_FLOORS).delete(floorDbKey(slot, rec.floorKey));
      await txP(tx);
      return true;
    } catch (e) { return false; }
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
      await txP(tx);
      return true;
    } catch (e) { return false; }
  }

  async function cacheGetFloor(slot, floorKey) {
    const db = await openDb();
    if (!db || !db.objectStoreNames.contains(ST_FLOORS)) return null;
    try {
      const tx = db.transaction(ST_FLOORS, 'readonly');
      const rec = await reqP(tx.objectStore(ST_FLOORS).get(floorDbKey(slot, floorKey)));
      return rec ? rec.data : null;
    } catch (e) { return null; }
  }

  async function cacheListFloors(slot) {
    const db = await openDb();
    if (!db || !db.objectStoreNames.contains(ST_FLOORS)) return [];
    try {
      const tx = db.transaction(ST_FLOORS, 'readonly');
      const st = tx.objectStore(ST_FLOORS);
      const idx = st.index('slot');
      const recs = await reqP(idx.getAll(slot));
      return Array.isArray(recs) ? recs : [];
    } catch (e) { return []; }
  }

  async function cacheSyncFloors(slot, dirtyFloors, deletedFloors, copyFromSlot) {
    const db = await openDb();
    if (!db || !db.objectStoreNames.contains(ST_FLOORS)) return false;
    let copyRecs = [];
    if (copyFromSlot && copyFromSlot !== slot) {
      copyRecs = await cacheListFloors(copyFromSlot);
    }
    try {
      const tx = db.transaction(ST_FLOORS, 'readwrite');
      const st = tx.objectStore(ST_FLOORS);
      const delSet = new Set(deletedFloors || []);
      const dirtyKeys = Object.keys(dirtyFloors || {});
      const dirtySet = new Set(dirtyKeys);
      for (const rec of copyRecs) {
        if (!rec || !rec.floorKey) continue;
        if (delSet.has(rec.floorKey) || dirtySet.has(rec.floorKey)) continue;
        st.put({
          k: floorDbKey(slot, rec.floorKey),
          slot,
          floorKey: rec.floorKey,
          data: rec.data,
        });
      }
      for (const fk of dirtyKeys) {
        st.put({
          k: floorDbKey(slot, fk),
          slot,
          floorKey: fk,
          data: dirtyFloors[fk],
        });
      }
      for (const fk of delSet) {
        st.delete(floorDbKey(slot, fk));
      }
      await txP(tx);
      return true;
    } catch (e) { return false; }
  }

  async function cacheDeleteFloor(slot, floorKey) {
    const db = await openDb();
    if (!db || !db.objectStoreNames.contains(ST_FLOORS)) return false;
    try {
      const tx = db.transaction(ST_FLOORS, 'readwrite');
      tx.objectStore(ST_FLOORS).delete(floorDbKey(slot, floorKey));
      await txP(tx);
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

  async function readJsonFile(h, name) {
    const fh = await h.getFileHandle(name);
    const f = await fh.getFile();
    return JSON.parse(await f.text());
  }

  async function diskSave(h, slot, data, time, floorSync) {
    const slotDir = await h.getDirectoryHandle(slot, { create: true });
    await writeFile(slotDir, CORE_FILE, JSON.stringify(data));
    await writeFile(slotDir, META_FILE, JSON.stringify({ time, meta: metaOf(data) }));
    if (!floorSync) return;
    const dirtyFloors = floorSync.dirtyFloors || {};
    const dirtyKeys = Object.keys(dirtyFloors);
    const deletedFloors = floorSync.deletedFloors || [];
    const copyFromSlot = floorSync.copyFromSlot || null;
    if (!dirtyKeys.length && !deletedFloors.length && (!copyFromSlot || copyFromSlot === slot)) return;

    const floorsDir = await slotDir.getDirectoryHandle(FLOORS_DIR, { create: true });
    const delSet = new Set(deletedFloors);
    const dirtySet = new Set(dirtyKeys);

    // 另存为到新槽位时，把源槽位已落盘的楼层文件一并复制到新槽位目录
    if (copyFromSlot && copyFromSlot !== slot) {
      try {
        const srcSlotDir = await h.getDirectoryHandle(copyFromSlot);
        const srcFloorsDir = await srcSlotDir.getDirectoryHandle(FLOORS_DIR);
        if (srcFloorsDir && srcFloorsDir.entries) {
          for await (const [fname, entry] of srcFloorsDir.entries()) {
            if (entry.kind !== 'file' || !fname.endsWith('.json')) continue;
            try {
              const f = await entry.getFile();
              const obj = JSON.parse(await f.text());
              const fk = obj && obj.floorKey;
              if (fk && (delSet.has(fk) || dirtySet.has(fk))) continue;
              await writeFile(floorsDir, fname, await f.text());
            } catch (e) { /* 跳过损坏的楼层文件 */ }
          }
        }
      } catch (e) { /* 源槽位没有 floors/ 目录则忽略 */ }
    }

    for (const fk of dirtyKeys) {
      await writeFile(floorsDir, floorFileName(fk), JSON.stringify(dirtyFloors[fk]));
    }
    for (const fk of delSet) {
      try {
        if (floorsDir.removeEntry) await floorsDir.removeEntry(floorFileName(fk));
      } catch (e) { /* 不存在则忽略 */ }
    }
  }

  /** 指定槽位是否已落盘（用于判断缓存里的旧档是否只在缓存中） */
  async function diskSlotInfo(slot) {
    const h = await getDir(false);
    if (!h) return null;
    try {
      const slotDir = await h.getDirectoryHandle(slot);
      try {
        const m = await readJsonFile(slotDir, META_FILE);
        return { exists: true, time: Number(m.time) || 0, source: 'disk' };
      } catch (e) {
        const core = await readJsonFile(slotDir, CORE_FILE);
        return { exists: true, time: Date.parse(core.savedAt) || 0, source: 'disk' };
      }
    } catch (e) { /* 不是分目录存档 */ }
    try {
      const rec = await readJsonFile(h, slot + '.json');
      return { exists: true, time: Date.parse(rec.savedAt) || 0, source: 'disk' };
    } catch (e) { return null; }
  }

  /** 把缓存里的楼层数据补写到磁盘（迁移旧缓存档时用） */
  async function diskWriteCachedFloors(h, slot, floorRecs) {
    if (!floorRecs || !floorRecs.length) return 0;
    const floorsDir = await h.getDirectoryHandle(FLOORS_DIR, { create: true });
    let n = 0;
    for (const rec of floorRecs) {
      if (!rec || !rec.floorKey || !rec.data) continue;
      try {
        await writeFile(floorsDir, floorFileName(rec.floorKey), JSON.stringify(rec.data));
        n++;
      } catch (e) { /* 单个楼层失败不影响主档迁移 */ }
    }
    return n;
  }

  async function diskList() {
    const h = await getDir(false);
    if (!h || !h.entries) return { list: [], name: null };
    const out = [];
    const bySlot = new Map();
    const pushItem = (item) => {
      const cur = bySlot.get(item.slot);
      if (!cur) {
        out.push(item);
        bySlot.set(item.slot, item);
      } else if ((Number(item.time) || 0) > (Number(cur.time) || 0)) {
        cur.time = item.time;
        cur.meta = item.meta || cur.meta;
      }
    };
    try {
      for await (const [name, entry] of h.entries()) {
        // 新版分目录存档：<slot>/meta.json（或 <slot>/core.json）
        if (entry.kind === 'directory') {
          try {
            const m = await readJsonFile(entry, META_FILE);
            pushItem({
              slot: name, time: Number(m.time) || 0,
              meta: m.meta || null, source: 'disk',
            });
            continue;
          } catch (e) { /* 没有 meta.json 时尝试读取 core.json */ }
          try {
            const core = await readJsonFile(entry, CORE_FILE);
            pushItem({
              slot: name, time: Date.parse(core.savedAt) || 0,
              meta: metaOf(core), source: 'disk',
            });
          } catch (e) { /* 非存档子目录忽略 */ }
          continue;
        }
        if (entry.kind === 'file' && name.endsWith(META_SUFFIX)) {
          const slot = name.slice(0, -META_SUFFIX.length);
          try {
            const f = await entry.getFile();
            const m = JSON.parse(await f.text());
            pushItem({
              slot, time: Number(m.time) || f.lastModified || 0,
              meta: m.meta || null, source: 'disk',
            });
          } catch (e) { /* 跳过损坏的 meta */ }
        }
      }
      // 兼容旧版单文件存档：<slot>.json
      for await (const [name, entry] of h.entries()) {
        if (entry.kind !== 'file' || !name.endsWith('.json') || name.endsWith(META_SUFFIX)) continue;
        const slot = name.slice(0, -'.json'.length);
        if (bySlot.has(slot)) continue;
        try {
          const f = await entry.getFile();
          const data = JSON.parse(await f.text());
          pushItem({
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
    // 优先读取新版分目录存档 <slot>/core.json
    try {
      const slotDir = await h.getDirectoryHandle(slot);
      return await readJsonFile(slotDir, CORE_FILE);
    } catch (e) {
      // 回退兼容旧版单文件 <slot>.json
      return await readJsonFile(h, slot + '.json');
    }
  }

  async function diskLoadFloor(slot, floorKey, allowPrompt) {
    const h = await getDir(!!allowPrompt);
    if (!h) return null;
    try {
      const slotDir = await h.getDirectoryHandle(slot);
      const floorsDir = await slotDir.getDirectoryHandle(FLOORS_DIR);
      return await readJsonFile(floorsDir, floorFileName(floorKey));
    } catch (e) { return null; }
  }

  async function diskDeleteFloor(slot, floorKey) {
    const h = await getDir(false);
    if (!h) return false;
    try {
      const slotDir = await h.getDirectoryHandle(slot);
      const floorsDir = await slotDir.getDirectoryHandle(FLOORS_DIR);
      if (floorsDir.removeEntry) await floorsDir.removeEntry(floorFileName(floorKey));
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- localStorage（旧存档 / 无 IDB 回退）
  function localFloorStorageKey(slot, floorKey) {
    return LS_FLOOR_PREFIX + String(slot || '') + '.' + String(floorKey || '');
  }

  function localListFloors(slot) {
    const out = [];
    const ls = global.localStorage;
    if (!ls) return out;
    const prefix = LS_FLOOR_PREFIX + String(slot || '') + '.';
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      try { out.push({ floorKey: k.slice(prefix.length), data: JSON.parse(ls.getItem(k) || 'null') }); }
      catch (e) { /* ignore */ }
    }
    return out;
  }

  function localClearFloors(slot) {
    const ls = global.localStorage;
    if (!ls) return;
    const prefix = LS_FLOOR_PREFIX + String(slot || '') + '.';
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k && k.startsWith(prefix)) { try { ls.removeItem(k); } catch (e) {} }
    }
  }

  function localSyncFloors(slot, dirtyFloors, deletedFloors, copyFromSlot) {
    const ls = global.localStorage;
    if (!ls) return;
    const delSet = new Set(deletedFloors || []);
    const dirtyKeys = Object.keys(dirtyFloors || {});
    const dirtySet = new Set(dirtyKeys);
    if (copyFromSlot && copyFromSlot !== slot) {
      const prefix = LS_FLOOR_PREFIX + String(copyFromSlot) + '.';
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        const fk = k.slice(prefix.length);
        if (delSet.has(fk) || dirtySet.has(fk)) continue;
        try { ls.setItem(localFloorStorageKey(slot, fk), ls.getItem(k)); } catch (e) {}
      }
    }
    for (const fk of dirtyKeys) {
      try { ls.setItem(localFloorStorageKey(slot, fk), JSON.stringify(dirtyFloors[fk])); } catch (e) {}
    }
    for (const fk of delSet) {
      try { ls.removeItem(localFloorStorageKey(slot, fk)); } catch (e) {}
    }
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

  function attachLoadedSlot(data, slot) {
    if (data && typeof data === 'object') {
      try {
        Object.defineProperty(data, '_loadedSlot', {
          value: slot, enumerable: false, configurable: true, writable: true,
        });
      } catch (e) { /* 冻结对象忽略 */ }
    }
    return data;
  }

  function stripFloorSync(data) {
    if (!data || typeof data !== 'object') return { coreData: data, floorSync: null };
    const floorSync = data._floorSync || null;
    if (!Object.prototype.propertyIsEnumerable.call(data, '_floorSync')) {
      return { coreData: data, floorSync };
    }
    const coreData = Object.assign({}, data);
    delete coreData._floorSync;
    return { coreData, floorSync };
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

    /**
     * 0-Z40：缓存里当前存档记录（IndexedDB 优先，localStorage 回退）。
     * @returns {null|{slot,time,meta,data,source}}
     */
    async cachedLatest() {
      let best = null;
      for (const rec of await cacheAll().catch(() => [])) {
        if (!rec || !rec.slot || !rec.data) continue;
        const item = {
          slot: rec.slot,
          time: Number(rec.time) || Date.parse((rec.data || {}).savedAt) || 0,
          meta: rec.meta || null, data: rec.data, source: 'cache',
        };
        if (!best || item.time > best.time) best = item;
      }
      for (const s of localList()) {
        let data = null;
        try { data = JSON.parse(global.localStorage.getItem(LS_PREFIX + s.slot) || 'null'); }
        catch (e) { data = null; }
        if (!data) continue;
        if (!best || s.time > best.time) {
          best = { slot: s.slot, time: s.time, meta: s.meta || null, data, source: 'cache' };
        }
      }
      return best;
    },

    /** 缓存中所有槽位（含时间与数据，按时间倒序） */
    async cachedLatestSlots() {
      const out = [];
      for (const rec of await cacheAll().catch(() => [])) {
        if (!rec || !rec.slot || !rec.data) continue;
        out.push({
          slot: rec.slot,
          time: Number(rec.time) || Date.parse((rec.data || {}).savedAt) || 0,
          meta: rec.meta || null, data: rec.data, source: 'cache',
        });
      }
      for (const s of localList()) {
        let data = null;
        try { data = JSON.parse(global.localStorage.getItem(LS_PREFIX + s.slot) || 'null'); }
        catch (e) { data = null; }
        if (data) out.push({ slot: s.slot, time: s.time, meta: s.meta || null, data, source: 'cache' });
      }
      return out.sort((a, b) => Number(b.time) - Number(a.time));
    },

    /** 强制取得可写目录；无权限时按 opts 回调让玩家手动选择，仍失败抛 NEED_FOLDER */
    async requireDisk(opts) {
      const o = opts || {};
      let h = await getDir(false);
      if (!h) {
        if (typeof o.onNeedFolder === 'function') {
          try { o.onNeedFolder(); } catch (e) { /* 提示失败不阻断 */ }
        }
        try {
          if (typeof o.promptFolder === 'function') await o.promptFolder();
          else if (global.showDirectoryPicker) await this.connectFolder();
        } catch (e) { /* 下面统一抛 NEED_FOLDER */ }
        h = await getDir(false);
      }
      if (!h) {
        const err = new Error('需要先连接本地存档文件夹，才能保存到另一个存档槽');
        err.code = 'NEED_FOLDER';
        throw err;
      }
      return h;
    },

    /**
     * 把缓存里的某个槽位落盘并清掉缓存（缓存单槽位机制的核心迁移）。
     * 若磁盘已有同槽且时间不早于缓存，只清缓存，不覆盖磁盘。
     */
    async evictCachedSlot(slot, opts) {
      const rec = await cacheGet(slot);
      let raw = null;
      if (!rec) {
        try { raw = global.localStorage ? global.localStorage.getItem(LS_PREFIX + slot) : null; }
        catch (e) { raw = null; }
      }
      const data = rec ? rec.data : (raw ? JSON.parse(raw) : null);
      if (!data) {
        await cacheClearFloors(slot);
        localClearFloors(slot);
        return { evicted: false, wroteDisk: false };
      }
      const cacheTime = Number(rec ? rec.time : (Date.parse(data.savedAt) || 0)) || Date.parse(data.savedAt) || 0;
      const disk = await diskSlotInfo(slot);
      const shouldWrite = !disk || cacheTime > (Number(disk.time) || 0);
      if (shouldWrite) {
        const h = await this.requireDisk(opts);
        await diskSave(h, slot, data, cacheTime, null);
        const floorRecs = await cacheListFloors(slot);
        const localFloors = localListFloors(slot);
        const merged = new Map();
        for (const f of floorRecs) if (f && f.floorKey) merged.set(f.floorKey, f.data);
        for (const f of localFloors) if (f && f.floorKey && !merged.has(f.floorKey)) merged.set(f.floorKey, f.data);
        await diskWriteCachedFloors(h, slot, Array.from(merged, ([floorKey, d]) => ({ floorKey, data: d })));
      }
      await cacheDelete(slot);
      await cacheClearFloors(slot);
      try { if (global.localStorage) global.localStorage.removeItem(LS_PREFIX + slot); } catch (e) {}
      localClearFloors(slot);
      return { evicted: true, wroteDisk: shouldWrite };
    },

    /**
     * 保存到指定槽位。
     * 0-Z40：缓存全局只保留**一个**最新存档。异槽保存时先把旧缓存档落盘、再清缓存；
     * 同槽保存直接覆盖。磁盘目录始终按槽位分文件保存全部存档。
     */
    async save(slot, data, opts) {
      const now = Date.now();
      const { coreData, floorSync } = stripFloorSync(data);
      const meta = metaOf(coreData);
      const previous = await this.cachedLatest();
      if (previous && previous.slot !== slot) {
        // 异槽保存：旧档必须已有磁盘副本，或此处先把缓存副本写进磁盘；
        // 没有权限就抛 NEED_FOLDER，绝不丢掉旧档、也不允许另存。
        await this.evictCachedSlot(previous.slot, opts);
      }
      let cached = await cachePut({ slot, time: now, meta, data: coreData });
      if (cached && floorSync) {
        await cacheSyncFloors(
          slot,
          floorSync.dirtyFloors,
          floorSync.deletedFloors,
          floorSync.copyFromSlot
        );
      }
      if (!cached) {
        try {
          global.localStorage.setItem(LS_PREFIX + slot, JSON.stringify(coreData));
          if (floorSync) {
            localSyncFloors(
              slot,
              floorSync.dirtyFloors,
              floorSync.deletedFloors,
              floorSync.copyFromSlot
            );
          }
          cached = true;
        } catch (e) { /* localStorage 也写不了时只能依赖磁盘 */ }
      }
      let disk = false;
      try {
        const h = await getDir(false);
        if (h) {
          await diskSave(h, slot, coreData, now, floorSync);
          disk = true;
          this.folderName = h.name || null;
        }
      } catch (e) { /* 磁盘写失败不影响浏览器缓存里的存档 */ }
      // 历史遗留的多槽缓存：把非当前槽位逐个迁移落盘后清掉，最终缓存只剩 a。
      // 同槽保存时做 best-effort（没有权限就不动旧缓存，避免阻断普通保存）；
      // 异槽保存时前面已经要求过权限，这里可以彻底清理。
      const allCached = await this.cachedLatestSlots();
      for (const s of allCached) {
        if (s === slot) continue;
        try {
          await this.evictCachedSlot(s, previous && previous.slot !== slot ? opts : {});
        } catch (e) { /* 同槽保存时保留无法迁移的旧缓存，不影响本次保存 */ }
      }
      this.mode = disk ? 'both' : 'cache';
      const ok = cached || disk;
      if (ok && floorSync && typeof floorSync.onSaved === 'function') {
        try { floorSync.onSaved(slot); } catch (e) { /* ignore */ }
      }
      return ok;
    },

    /** 读取槽位：先浏览器缓存，没有再去磁盘目录 */
    async load(slot) {
      const rec = await cacheGet(slot);
      if (rec && rec.data) { this.mode = 'cache'; return attachLoadedSlot(rec.data, slot); }
      let raw = null;
      try {
        raw = global.localStorage ? global.localStorage.getItem(LS_PREFIX + slot) : null;
      } catch (e) { raw = null; }
      if (raw) { this.mode = 'cache'; return attachLoadedSlot(JSON.parse(raw), slot); }
      const data = await diskLoad(slot);
      this.mode = 'disk';
      return attachLoadedSlot(data, slot);
    },

    /** 按需读取单个地城楼层 JSON（先浏览器缓存，没有再去磁盘 <slot>/floors/） */
    async loadFloor(slot, floorKey) {
      if (!slot || !floorKey) return null;
      const fromIdb = await cacheGetFloor(slot, floorKey);
      if (fromIdb) return fromIdb;
      try {
        const raw = global.localStorage ? global.localStorage.getItem(localFloorStorageKey(slot, floorKey)) : null;
        if (raw) return JSON.parse(raw);
      } catch (e) { /* ignore */ }
      return await diskLoadFloor(slot, floorKey, false);
    },

    /** 删除指定槽位的单个楼层文件（缓存 + 磁盘） */
    async deleteFloor(slot, floorKey) {
      if (!slot || !floorKey) return false;
      const a = await cacheDeleteFloor(slot, floorKey);
      try {
        if (global.localStorage) global.localStorage.removeItem(localFloorStorageKey(slot, floorKey));
      } catch (e) { /* ignore */ }
      const b = await diskDeleteFloor(slot, floorKey);
      return a || b;
    },

    /** 列出指定槽位在缓存中的楼层键（调试/校验用） */
    async listFloors(slot) {
      if (!slot) return [];
      const recs = await cacheListFloors(slot);
      return recs.map((r) => r.floorKey).filter(Boolean);
    },

    /** 最新存档的槽位（死亡后自动读档用） */
    async latest() {
      const list = await this.list();
      if (!list.length) return null;
      return list[0].slot;
    },
  };

  Elona.Save = Save;
  if (typeof module !== 'undefined' && module.exports) module.exports = Save;
})(typeof window !== 'undefined' ? window : global);
