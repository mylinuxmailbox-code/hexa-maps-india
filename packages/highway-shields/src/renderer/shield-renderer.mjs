/**
 * HEXA MAPS — Cross-Platform SVG & MapLibre Nine-Slice Sprite Renderer
 *
 * Generates:
 * 1. Crisp, scalable vector SVG badges for any resolved country highway shield.
 * 2. MapLibre Style Specification sprite metadata (`width`, `height`, `pixelRatio`,
 *    `content` text bounding box, and `stretchX` / `stretchY` nine-slice zones)
 *    so macOS, iOS, Android, and Web render identical shields at 1x/2x/3x DPI.
 */

import { SHIELD_SHAPES } from '../definitions/shield-definitions.mjs';

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class HighwayShieldRenderer {
  /**
   * Renders a resolved shield descriptor into an SVG string and MapLibre sprite metadata.
   *
   * @param {Object} shield - Output from `HighwayShieldResolver.resolve()`
   * @param {Object} [options]
   * @param {number} [options.pixelRatio=2] - 1, 2, or 3
   * @returns {{ svg: string, width: number, height: number, pixelRatio: number, content: [number, number, number, number], stretchX: Array<[number, number]>, stretchY: Array<[number, number]> }}
   */
  renderSvg(shield, { pixelRatio = 2 } = {}) {
    if (!shield || !shield.displayText) {
      throw new Error('Cannot render null or empty shield descriptor');
    }

    const hasBanner = Boolean(shield.bannerText);
    const charCount = Math.max(2, shield.displayText.length);
    const baseWidth = Math.max(34, 16 + charCount * 8.5);
    const baseHeight = hasBanner ? 32 : 24;

    const width = Math.round(baseWidth * pixelRatio);
    const height = Math.round(baseHeight * pixelRatio);
    const c = shield.colors;

    const shapeMarkup = this.#buildShapePath(shield.shape, baseWidth, baseHeight, c, hasBanner, shield.bannerText);
    const textY = hasBanner ? baseHeight * 0.68 : baseHeight * 0.54;
    const fontSize = charCount > 6 ? 9.5 : 11;

    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${baseWidth} ${baseHeight}" role="img" aria-label="${escapeXml(shield.displayText)}">`,
      shapeMarkup,
      `<text x="${(baseWidth / 2).toFixed(1)}" y="${textY.toFixed(1)}" fill="${c.text}" font-family="-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif" font-weight="700" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(shield.displayText)}</text>`,
      `</svg>`
    ].join('');

    const padX = Math.round(6 * pixelRatio);
    const padTop = Math.round((hasBanner ? 11 : 4) * pixelRatio);
    const padBottom = Math.round(4 * pixelRatio);

    return {
      svg,
      width,
      height,
      pixelRatio,
      content: [padX, padTop, width - padX, height - padBottom],
      stretchX: [[padX, width - padX]],
      stretchY: [[padTop, height - padBottom]]
    };
  }

  #buildShapePath(shape, w, h, colors, hasBanner, bannerText) {
    const strokeWidth = 1.5;
    switch (shape) {
      case SHIELD_SHAPES.INDIAN_MILESTONE_SHIELD: {
        // Classic Indian NH/SH shield: domed top crown + rectangular body + pointed lower tip
        const bannerH = 10;
        return [
          `<path d="M 2,${bannerH} Q 2,2 ${w / 2},2 Q ${w - 2},2 ${w - 2},${bannerH} L ${w - 2},${h - 6} L ${w / 2},${h - 1.5} L 2,${h - 6} Z" fill="${colors.background}" stroke="${colors.border}" stroke-width="${strokeWidth}"/>`,
          `<path d="M 2.5,${bannerH + 1} Q 2.5,2.5 ${w / 2},2.5 Q ${w - 2.5},2.5 ${w - 2.5},${bannerH + 1} Z" fill="${colors.bannerBackground || colors.border}"/>`,
          bannerText
            ? `<text x="${(w / 2).toFixed(1)}" y="${(bannerH * 0.62).toFixed(1)}" fill="${colors.bannerText || '#FFFFFF'}" font-family="-apple-system, sans-serif" font-weight="800" font-size="6.5" text-anchor="middle" dominant-baseline="central">${escapeXml(bannerText)}</text>`
            : ''
        ].join('');
      }

      case SHIELD_SHAPES.US_INTERSTATE: {
        const bannerH = 9.5;
        return [
          `<path d="M 2,4 C ${w * 0.25},1.5 ${w * 0.38},1.5 ${w / 2},3.5 C ${w * 0.62},1.5 ${w * 0.75},1.5 ${w - 2},4 C ${w - 1.5},${h * 0.55} ${w * 0.78},${h - 4} ${w / 2},${h - 1.5} C ${w * 0.22},${h - 4} 1.5,${h * 0.55} 2,4 Z" fill="${colors.background}" stroke="${colors.border}" stroke-width="${strokeWidth}"/>`,
          `<path d="M 2.8,4.2 C ${w * 0.25},2 ${w * 0.38},2 ${w / 2},3.8 C ${w * 0.62},2 ${w * 0.75},2 ${w - 2.8},4.2 L ${w - 2.8},${bannerH} L 2.8,${bannerH} Z" fill="${colors.bannerBackground || '#DC2626'}"/>`,
          bannerText
            ? `<text x="${(w / 2).toFixed(1)}" y="${(bannerH * 0.64).toFixed(1)}" fill="${colors.bannerText || '#FFFFFF'}" font-family="-apple-system, sans-serif" font-weight="700" font-size="5" letter-spacing="0.3" text-anchor="middle" dominant-baseline="central">${escapeXml(bannerText)}</text>`
            : ''
        ].join('');
      }

      case SHIELD_SHAPES.US_HIGHWAY: {
        return `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="4" fill="${colors.background}" stroke="${colors.border}" stroke-width="1.8"/>`;
      }

      case SHIELD_SHAPES.US_CALIFORNIA_SPADE: {
        return `<path d="M ${w / 2},2 C ${w - 2},6 ${w - 1},${h * 0.6} ${w / 2},${h - 2} C 1,${h * 0.6} 2,6 ${w / 2},2 Z" fill="${colors.background}" stroke="${colors.border}" stroke-width="${strokeWidth}"/>`;
      }

      case SHIELD_SHAPES.GERMAN_AUTOBAHN_HEXAGON: {
        const inset = 5;
        return `<polygon points="${inset},2 ${w - inset},2 ${w - 1.5},${h / 2} ${w - inset},${h - 2} ${inset},${h - 2} 1.5,${h / 2}" fill="${colors.background}" stroke="${colors.border}" stroke-width="${strokeWidth}"/>`;
      }

      case SHIELD_SHAPES.HEXAGON: {
        const inset = 4.5;
        return `<polygon points="${inset},1.5 ${w - inset},1.5 ${w - 1.5},${h / 2} ${w - inset},${h - 1.5} ${inset},${h - 1.5} 1.5,${h / 2}" fill="${colors.background}" stroke="${colors.border}" stroke-width="${strokeWidth}"/>`;
      }

      case SHIELD_SHAPES.PILL: {
        const r = (h - 3) / 2;
        return `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${r.toFixed(1)}" fill="${colors.background}" stroke="${colors.border}" stroke-width="${strokeWidth}"/>`;
      }

      case SHIELD_SHAPES.ROUNDED_RECT:
      default: {
        return `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="3.5" fill="${colors.background}" stroke="${colors.border}" stroke-width="${strokeWidth}"/>`;
      }
    }
  }
}
