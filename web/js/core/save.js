'use strict';
/**
 * 存档层。
 *   原版存档是一个「存档目录」：全局数据写 *.s1，每张地图单独写
 *   map_<id>_<ver>.s2 / cdata_<id>_<ver>.s2 / mdata_<id>_<ver>.s2 等（见 save_example/）。
 *   Web 版语义等价地改为「每个槽位一份 JSON」，优先通过 Java 后端写入
 *   saves/<slot>.json；后端不可用时降级到 localStorage（浏览器缓存）。
 *
 * 后端地址：
 *   1. 同源 /api（用 `java -cp server/out ElonaServer 8080 web saves` 启动后访问 8080 端口）
 *   2. 页面由其它静态服务器（IDE 预览 / Live Server / file://）打开时，尝试本机 8080，
 *      服务器的 API 已开启 CORS。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const API_CANDIDATES = [];
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
    API_CANDIDATES.push('/api');
  }
  API_CANDIDATES.push('http://127.0.0.1:8080/api');

  /** 探测成功后记住可用的后端，避免每次操作都重试 */
  let apiBase = null;

  async function serverOk() {
    if (apiBase) return true;
    for (const base of API_CANDIDATES) {
      try {
        const r = await fetch(base + '/ping', { method: 'GET' });
        if (r.ok) { apiBase = base; return true; }
      } catch (e) { /* 该地址不可用，继续试下一个 */ }
    }
    return false;
  }

  const Save = {
    /** 最近一次实际使用的存储方式：'server' = saves/ 目录；'local' = 浏览器 localStorage */
    mode: 'local',

    /** 当前可用的后端地址（null = 没有后端） */
    get apiBase() { return apiBase; },

    /**
     * 列出所有存档槽位。
     *   time 统一为毫秒时间戳：服务端返回文件的最后修改时间；
     *   localStorage 没有该信息，改读存档里的 savedAt（旧存档读不到时按 0）。
     */
    async list() {
      if (await serverOk()) {
        try {
          const r = await fetch(apiBase + '/saves');
          if (r.ok) {
            this.mode = 'server';
            return await r.json();
          }
        } catch (e) { apiBase = null; }
      }
      this.mode = 'local';
      const list = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k.startsWith('elona.save.')) continue;
        let time = 0;
        try {
          const d = JSON.parse(localStorage.getItem(k) || 'null');
          if (d && d.savedAt) time = Date.parse(d.savedAt) || 0;
        } catch (e) { /* 损坏的存档按 0 处理，不影响其它槽位 */ }
        list.push({ slot: k.slice(11), time });
      }
      return list;
    },

    /** 保存到指定槽位：优先写 saves/<slot>.json，失败时退回 localStorage */
    async save(slot, data) {
      if (await serverOk()) {
        try {
          const r = await fetch(apiBase + '/save/' + encodeURIComponent(slot), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (r.ok) {
            this.mode = 'server';
            return true;
          }
        } catch (e) { apiBase = null; }
        // 服务端写入失败：退回浏览器缓存，至少不让存档丢失
      }
      localStorage.setItem('elona.save.' + slot, JSON.stringify(data));
      this.mode = 'local';
      return true;
    },

    /** 读取槽位：先读后端文件，读不到再读浏览器缓存 */
    async load(slot) {
      if (await serverOk()) {
        try {
          const r = await fetch(apiBase + '/save/' + encodeURIComponent(slot));
          if (r.ok) {
            this.mode = 'server';
            return await r.json();
          }
        } catch (e) { apiBase = null; }
      }
      this.mode = 'local';
      const raw = localStorage.getItem('elona.save.' + slot);
      if (!raw) throw new Error('存档不存在');
      return JSON.parse(raw);
    },

    /**
     * 最新存档的槽位（死亡后自动读档用）。
     *   服务端按文件名排序返回，不能直接取 list[0]；这里按修改时间倒序取真正最新的。
     */
    async latest() {
      const list = await this.list();
      if (!list.length) return null;
      // 时间戳是毫秒，超出 32 位有符号范围，不能做 |0 截断
      list.sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
      return list[0].slot;
    },
  };

  Elona.Save = Save;
})(window);
