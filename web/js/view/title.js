'use strict';
/**
 * 标题画面 —— 复刻 *label_2881（304477-304634）
 *
 * 布局：
 *   背景 title.bmp（800×600）
 *   版权文字 (20,2) / (20,20) / (20,38)，font2 11px
 *   display_window(80, winposy(320)=140, 320, 320)
 *   菜单项 x=120（按键图标）/160（文本），y=190+35n，6 项 a..f
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const K = Elona.UiKit;
  const F = K.FONT;

  const WIN_X = 80, WIN_Y = 140, WIN_W = 320, WIN_H = 320;
  const ROW_X_KEY = 120, ROW_X_TEXT = 160, ROW_Y = 190, ROW_H = 35;

  const ITEMS = [
    { key: 'a', label: 'Restore an Adventurer', action: 'load' },
    { key: 'b', label: 'Generate an Adventurer', action: 'new' },
    { key: 'c', label: 'Incarnate an Adventurer', action: 'incarnate' },
    { key: 'd', label: 'View the Homepage', action: 'home' },
    { key: 'e', label: 'Options', action: 'options' },
    { key: 'f', label: 'Exit', action: 'exit' },
  ];

  const HINTS = {
    incarnate: 'Web 版暂不支持冒险者引继。',
    home: '本家 Elona 主页：http://homepage3.nifty.com/rfish/index.html',
    options: 'Web 版暂未提供设置画面。',
    exit: '请直接关闭浏览器标签页。',
  };

  class TitleScreen {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
      this.opts = opts || {};
      this.sel = 0;
      this.active = false;
      this.hint = '';
      this.hasSave = false;
      this.title = null;
      this.ui = null;
      this._load();
      this.canvas.addEventListener('click', (e) => this.onClick(e));
      this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
      this._onKey = (e) => this.onKey(e);
    }

    async _load() {
      const [title, ui] = await Promise.all([
        K.loadImage('assets/graphic/title.bmp'),
        K.loadImage('assets/graphic/interface.bmp'),
      ]);
      this.title = title;
      this.ui = ui;
      await this.refreshSave();
      this.draw();
    }

    async refreshSave() {
      try {
        this.hasSave = !!(this.opts.hasSave && await this.opts.hasSave());
      } catch (_) { this.hasSave = false; }
    }

    start() {
      if (!this.active) window.addEventListener('keydown', this._onKey);
      this.active = true;
      this.refreshSave().then(() => this.draw());
      this.draw();
    }

    stop() {
      this.active = false;
      window.removeEventListener('keydown', this._onKey);
    }

    setHint(text) {
      this.hint = text || '';
      this.draw();
    }

    /** 屏幕坐标 → 菜单项下标（-1 表示未命中） */
    hit(sx, sy) {
      if (sx < ROW_X_KEY - 6 || sx > WIN_X + WIN_W - 20) return -1;
      const i = Math.floor((sy - (ROW_Y - 6)) / ROW_H);
      if (i < 0 || i >= ITEMS.length) return -1;
      const rowY = ROW_Y + i * ROW_H;
      if (sy < rowY - 6 || sy > rowY + 22) return -1;
      return i;
    }

    toCanvas(e) {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (this.canvas.width / r.width),
        y: (e.clientY - r.top) * (this.canvas.height / r.height),
      };
    }

    onClick(e) {
      if (!this.active) return;
      const p = this.toCanvas(e);
      const i = this.hit(p.x, p.y);
      if (i >= 0) this.choose(i);
    }

    onMove(e) {
      if (!this.active) return;
      const p = this.toCanvas(e);
      const i = this.hit(p.x, p.y);
      if (i >= 0 && i !== this.sel) { this.sel = i; this.draw(); }
    }

    onKey(e) {
      if (!this.active) return;
      if (e.key === 'ArrowUp' || e.key === '8') {
        e.preventDefault(); this.sel = (this.sel + ITEMS.length - 1) % ITEMS.length; this.draw();
      } else if (e.key === 'ArrowDown' || e.key === '2') {
        e.preventDefault(); this.sel = (this.sel + 1) % ITEMS.length; this.draw();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); this.choose(this.sel);
      } else {
        const i = ITEMS.findIndex((it) => it.key === e.key.toLowerCase());
        if (i >= 0) { e.preventDefault(); this.sel = i; this.choose(i); }
      }
    }

    choose(i) {
      const it = ITEMS[i];
      if (!it) return;
      // 选项画面：交由 view/panels.js 的选项面板处理（对应 config.txt 的 (Screen)/(Sound) 段）
      if (it.action === 'options' && Elona.Panels) {
        this.active = false;
        Elona.Panels.openOptions(null, () => { this.active = true; this.setHint(''); });
        return;
      }
      if (it.action === 'load') {
        if (!this.hasSave) { this.setHint('没有找到存档。'); return; }
        if (this.opts.onLoad) this.opts.onLoad();
      } else if (it.action === 'new') {
        if (this.opts.onNew) this.opts.onNew();
      } else {
        this.setHint(HINTS[it.action] || '');
      }
    }

    draw() {
      const c = this.ctx;
      c.fillStyle = '#000';
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.title) c.drawImage(this.title, 0, 0, 800, 600);

      // 版权文字（304505-304517）
      const f11 = F(11);
      K.text(c, 'Elona  Developed by Noa', 20, 2, '#fff', f11);
      K.text(c, 'ElonaPlus  Developed by Ano', 20, 20, '#fff', f11);
      K.text(c, 'Contributor f1r3fly, Sunstrike, Schmidt, Elvenspirit / View the credits for more',
        20, 38, '#fff', f11);

      // 主窗口
      K.drawWindow(c, this.ui, WIN_X, WIN_Y, WIN_W, WIN_H);

      // 标题页签（display_window：window2 + 标题）
      c.fillStyle = '#cfc3b2';
      c.fillRect(WIN_X + 34, WIN_Y - 4, 144, 32);
      c.strokeStyle = '#6b5d49';
      c.lineWidth = 1;
      c.strokeRect(WIN_X + 34.5, WIN_Y - 3.5, 143, 31);
      K.btext(c, 'Starting Menu', WIN_X + 106 - 45, WIN_Y + 2, '#fff', F(13));

      // 菜单项
      for (let i = 0; i < ITEMS.length; i++) {
        const it = ITEMS[i];
        const y = ROW_Y + i * ROW_H;
        const disabled = it.action === 'load' && !this.hasSave;
        if (i === this.sel) {
          c.font = F(12);
          const tw = Math.min(c.measureText(it.label).width + 28, 240);
          c.fillStyle = 'rgba(40,18,4,0.82)';
          c.fillRect(ROW_X_TEXT - 5, y - 3, tw, 20);
          c.strokeStyle = '#6a4a28';
          c.strokeRect(ROW_X_TEXT - 4.5, y - 2.5, tw - 1, 19);
          if (this.ui) c.drawImage(this.ui, 48, 360, 16, 16,
            ROW_X_TEXT + tw - 22, y, 16, 16);
        }
        // 按键图标（display_customkey）
        if (this.ui) c.drawImage(this.ui, 0, 30, 24, 18, ROW_X_KEY, y, 24, 18);
        K.btext(c, it.key, ROW_X_KEY + 6, y + 1, '#faf0e6', F(12));
        K.text(c, it.label, ROW_X_TEXT, y + 2,
          disabled ? '#8a8478' : (i === this.sel ? '#fdf6e3' : '#12100c'), F(12));
      }

      if (this.hint) {
        K.text(c, this.hint, 20, 578, '#d6c58e', F(10));
      }
    }
  }

  Elona.TitleScreen = TitleScreen;
})(window);
