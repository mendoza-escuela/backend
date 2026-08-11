import { Injectable } from '@nestjs/common';
import { REPORT_THEME } from '../report-theme';

@Injectable()
export class RadarSvgService {
  create(dimensions: Array<{ title: string; score: number | null }>) {
    const width = 460;
    const height = 390;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 102;
    const labelRadius = 137;
    const values = dimensions.slice(0, 6);
    while (values.length < 6)
      values.push({ title: `Dimensión ${values.length + 1}`, score: null });
    const points = (scale: number) =>
      values
        .map((_, index) =>
          this.point(centerX, centerY, radius * scale, index, values.length),
        )
        .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(' ');
    const valuePoints = values
      .map(({ score }, index) =>
        this.point(
          centerX,
          centerY,
          (radius * Math.max(0, Math.min(100, score ?? 0))) / 100,
          index,
          values.length,
        ),
      )
      .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' ');
    const axes = values
      .map((_, index) =>
        this.point(centerX, centerY, radius, index, values.length),
      )
      .map(
        ({ x, y }) =>
          `<line x1="${centerX}" y1="${centerY}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${REPORT_THEME.grid}" stroke-width="1"/>`,
      )
      .join('');
    const labels = values
      .map(({ title, score }, index) => {
        const { x, y, cosine } = this.point(
          centerX,
          centerY,
          labelRadius,
          index,
          values.length,
        );
        const lines = this.wrap(title, 22);
        const anchor =
          Math.abs(cosine) < 0.25 ? 'middle' : cosine > 0 ? 'start' : 'end';
        const lineHeight = 11;
        const firstLineY = y - ((lines.length - 1) * lineHeight) / 2;
        const tspans = [
          ...lines.map(
            (line, lineIndex) =>
              `<tspan x="${x.toFixed(2)}" y="${(firstLineY + lineIndex * lineHeight).toFixed(2)}">${this.escape(line)}</tspan>`,
          ),
          `<tspan x="${x.toFixed(2)}" y="${(firstLineY + lines.length * lineHeight).toFixed(2)}" font-weight="bold">${score === null ? 's/d' : score.toFixed(1)}</tspan>`,
        ].join('');
        return `<text text-anchor="${anchor}" font-size="9" fill="${REPORT_THEME.text}">${tspans}</text>`;
      })
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="${REPORT_THEME.surface}"/>
      ${[0.25, 0.5, 0.75, 1].map((scale) => `<polygon points="${points(scale)}" fill="none" stroke="${REPORT_THEME.border}" stroke-width="1"/>`).join('')}
      ${axes}
      <polygon points="${valuePoints}" fill="${REPORT_THEME.secondary}" fill-opacity="0.28" stroke="${REPORT_THEME.primary}" stroke-width="2"/>
      ${labels}
    </svg>`;
  }

  private point(
    centerX: number,
    centerY: number,
    radius: number,
    index: number,
    total: number,
  ) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / total;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      cosine: Math.cos(angle),
    };
  }

  private wrap(value: string, maxLength: number) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    for (const word of words) {
      const current = lines.at(-1);
      if (!current || `${current} ${word}`.length > maxLength) lines.push(word);
      else lines[lines.length - 1] = `${current} ${word}`;
    }
    return lines.length ? lines : ['Sin título'];
  }

  private escape(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
