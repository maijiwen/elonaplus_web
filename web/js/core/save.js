'use strict';
/**
 * 存档层 —— 与原版一致：存档为「按槽位保存的 JSON 数据」。
 * 原版存档是 zip 打包的多个 .s1 二进制文件（见 start.hsp 的 label_2873 / savecycle）；
 * Web 版改为等价语义的 JSON 存档，通过 Java 后端持久化到本地文件，
 * 后端不可用时自动降级到 localStorage。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const API = '/api';

  async function serverOk() {
    try {
      const r = await fetch(API + '/ping', { method: 'GET' });
      return r.ok;
    } catch (e) { return false; }
  }

  const Save = {
    /** 列出所有存档槽位 */
    async list() {
      if (await serverOk()) {
        const r = await fetch(API + '/saves');
        return r.ok ? await r.json() : [];
      }
      const list = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('elona.save.')) list.push({ slot: k.slice(11), time: '' });
      }
      return list;
    },

    /** 保存到指定槽位 */
    async save(slot, data) {
      if (await serverOk()) {
        const r = await fetch(API + '/save/' + encodeURIComponent(slot), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!r.ok) throw new Error('服务端保存失败');
        return true;
      }
      localStorage.setItem('elona.save.' + slot, JSON.stringify(data));
      return true;
    },

    /** 读取槽位 */
    async load(slot) {
      if (await serverOk()) {
        const r = await fetch(API + '/save/' + encodeURIComponent(slot));
        if (!r.ok) throw new Error('存档不存在');
        return await r.json();
      }
      const raw = localStorage.getItem('elona.save.' + slot);
      if (!raw) throw new Error('存档不存在');
      return JSON.parse(raw);
    },

    async latest() {
      const list = await this.list();
      if (!list.length) return null;
      return list[0].slot;
    },
  };

  Elona.Save = Save;
})(window);
