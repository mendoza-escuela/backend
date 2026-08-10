import { Injectable } from '@nestjs/common';
import { REPORT_THEME } from '../report-theme';

@Injectable()
export class RadarSvgService {
  create(dimensions: Array<{ title: string; score: number | null }>) {
    const size = 360;
    const center = size / 2;
    const radius = 112;
    const values = dimensions.slice(0, 6);
    while (values.length < 6)
      values.push({ title: `Dimensión ${values.length + 1}`, score: null });
    const points = (scale: number) =>
      values
        .map((_, index) =>
          this.point(center, radius * scale, index, values.length),
        )
        .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(' ');
    const valuePoints = values
      .map(({ score }, index) =>
        this.point(
          center,
          (radius * Math.max(0, Math.min(100, score ?? 0))) / 100,
          index,
          values.length,
        ),
      )
      .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' ');
    const axes = values
      .map((_, index) => this.point(center, radius, index, values.length))
      .map(
        ({ x, y }) =>
          `<line x1="${center}" y1="${center}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${REPORT_THEME.grid}" stroke-width="1"/>`,
      )
      .join('');
    const labels = values
      .map(({ title, score }, index) => {
        const { x, y } = this.point(center, radius + 32, index, values.length);
        return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="${REPORT_THEME.text}">${this.escape(title.slice(0, 28))} (${score === null ? 's/d' : score.toFixed(1)})</text>`;
      })
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="100%" height="100%" fill="${REPORT_THEME.surface}"/>
      ${[0.25, 0.5, 0.75, 1].map((scale) => `<polygon points="${points(scale)}" fill="none" stroke="${REPORT_THEME.border}" stroke-width="1"/>`).join('')}
      ${axes}
      <polygon points="${valuePoints}" fill="${REPORT_THEME.secondary}" fill-opacity="0.28" stroke="${REPORT_THEME.primary}" stroke-width="2"/>
      ${labels}
    </svg>`;
  }

  private point(center: number, radius: number, index: number, total: number) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / total;
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  }

  private escape(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
