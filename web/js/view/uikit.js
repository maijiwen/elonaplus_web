'use strict';
/**
 * 表现层公共绘制工具 —— 复刻 HSP 的 window / display_topic / cnvweight 等。
 *
 * window (start.hsp 37077-37138) 用 interface.bmp 的 (0,48) 起 9 宫格拼出羊皮纸窗口：
 *   左上/左下 64×48、中间 8×48、右上/右下 56×48；中部 64×8 / 8×8 / 56×8。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  // config.txt 的 font2（英文）= Courier New
  const FONT = (px) => px + 'px "Courier New", "MS Gothic", "ＭＳ ゴシック", "Microsoft YaHei", monospace';

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function text(ctx, s, x, y, color, font) {
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  /** bmes：带黑色描边（左下偏移 1px）的文字 */
  function btext(ctx, s, x, y, color, font) {
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    ctx.fillText(s, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  /** cnvweight：克 → "1.5s"（19957-19959） */
  function cnvweight(g) {
    const a = Math.abs(g | 0);
    return ((a / 1000) | 0) + '.' + (((a % 1000) / 100) | 0) + 's';
  }

  /** HSP window：用 interface.bmp 拼出窗口边框与内部纹理（w/h 建议为 8 的倍数） */
  function drawWindow(ctx, img, x, y, w, h) {
    if (!img) return;
    const copy = (sx, sy, sw, sh, dx, dy) => {
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
    };
    const rightX = x + w - (w % 8) - 64;
    let bottomY = y + h - (h % 8) - 64;
    if (bottomY < y + 14) bottomY = y + 14;
    const cols = (w / 8) | 0;
    const rows = ((h / 8) | 0) - 14;

    // 上下边框
    for (let c = 0; c < cols; c++) {
      if (c === 0) {
        copy(0, 48, 64, 48, x, y);
        copy(0, 192, 64, 48, x, bottomY);
      } else if (c < cols - 8) {
        const sx = ((c - 8) % 18) * 8 + 36;
        copy(sx, 48, 8, 48, c * 8 + x, y);
        copy(sx + 18, 192, 8, 48, c * 8 + x, bottomY);
      } else {
        copy(208, 48, 56, 48, rightX, y);
        copy(208, 192, 56, 48, rightX, bottomY);
        break;
      }
    }
    // 内部纹理
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c === 0) {
          copy(0, (r % 12) * 8 + 96, 64, 8, x, r * 8 + y + 48);
        } else if (c < cols - 15) {
          copy(64 + (c % 18) * 8, (r % 12) * 8 + 96, 8, 8, c * 8 + x + 56, r * 8 + y + 48);
        } else {
          copy(208, (r % 12) * 8 + 96, 56, 8, rightX, r * 8 + y + 48);
          break;
        }
      }
    }
  }

  Elona.UiKit = { FONT, loadImage, text, btext, cnvweight, drawWindow };
})(window);
