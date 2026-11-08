'use strict';
/**
 * 数据层 —— 负责加载 JSON 数据（地图 / 表 / 文本）
 * 所有游戏静态数据都放在 web/data 下，按类别分文件存放。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const cache = {};

  async function fetchJson(path) {
    if (cache[path]) return cache[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error('加载失败: ' + path + ' (' + res.status + ')');
    const data = await res.json();
    cache[path] = data;
    return data;
  }

  /**
   * 启动预加载：按 data/index/manifest.json 把所有常用表一次读进内存。
   *
   * 【为什么】原来每个表都是「第一次用到才 fetch」（懒加载），
   * 于是第一次进商店/施法/打开调合都会卡一下。预加载后这些访问全走 cache。
   * 地图（181 张）与译文表（8.8 MB）不进清单，仍按需加载。
   *
   * @param {(done:number,total:number)=>void} [onProgress]
   * @returns {Promise<{count:number, bytes:number, failed:string[]}>}
   */
  async function preload(onProgress) {
    const manifest = await fetchJson('data/index/manifest.json');
    const paths = [];
    for (const [key, dir] of [['index', 'data/index'], ['tables', 'data/tables'], ['scene', 'data/scene']]) {
      for (const f of (manifest[key] || [])) {
        if (f === 'manifest.json') continue;
        paths.push(dir + '/' + f);
      }
    }
    const total = paths.length;
    let done = 0, bytes = 0;
    const failed = [];
    // 限并发 6：浏览器对同域 HTTP/1.1 一般只开 6 个连接
    const CONCURRENCY = 6;
    let cursor = 0;
    async function worker() {
      while (cursor < paths.length) {
        const path = paths[cursor++];
        try {
          const d = await fetchJson(path);
          bytes += JSON.stringify(d).length;
        } catch (e) {
          failed.push(path);
        }
        done++;
        if (onProgress) { try { onProgress(done, total); } catch (e) { /* 忽略回调异常 */ } }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    return { count: total - failed.length, bytes, failed };
  }

  const Data = {
    preload,
    /** 已缓存的文件数（调试用） */
    cached() { return Object.keys(cache).length; },
    /** 地图目录索引（由 tools/extract_maps.py 生成） */
    async mapIndex() { return fetchJson('data/index/maps.json'); },
    /** 单张地图 */
    async map(name) { return fetchJson('data/maps/' + name + '.json'); },
    /** 图块属性表 */
    async tileAttributes() { return fetchJson('data/tables/tile_attributes.json'); },
    /** 通用表 */
    async table(name) { return fetchJson('data/tables/' + name + '.json'); },
    /**
     * 同步取表 —— 只对**启动时已预加载**（manifest）的表有效，未命中返回 null。
     * 给回合内的同步逻辑用（例如钓鱼抽鱼，不能在回合途中 await）。
     */
    tableSync(name) {
      const v = cache['data/tables/' + name + '.json'];
      return v === undefined ? null : v;
    },
    /** 文本数据 */
    async text(name) { return fetchJson('data/text/' + name + '.json'); },
    fetchJson,
  };

  Elona.Data = Data;
})(window);
