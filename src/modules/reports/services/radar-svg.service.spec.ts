import { RadarSvgService } from './radar-svg.service';

describe('RadarSvgService', () => {
  const dimensions = [
    'Compromiso Institucional y Planificación Estratégica',
    'Articulación con los Equipos de Salud',
    'Entorno Alimentario Seguro y Saludable',
    'Actividad Física y Entorno Favorecedor',
    'Espacios 100% Libres de Humo de Tabaco',
    'Salud Mental y Bienestar Emocional',
  ].map((title, index) => ({ title, score: 50 + index }));

  it('conserva los títulos completos, los envuelve y ancla por cuadrante', () => {
    const svg = new RadarSvgService().create(dimensions);

    for (const { title } of dimensions)
      for (const word of title.split(/\s+/)) expect(svg).toContain(word);
    expect(svg).toContain('<tspan');
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('viewBox="0 0 460 390"');
  });

  it('escapa caracteres reservados sin truncar el texto', () => {
    const svg = new RadarSvgService().create([
      { title: 'Salud & bienestar <integral>', score: null },
    ]);

    expect(svg).toContain('Salud &amp; bienestar');
    expect(svg).toContain('&lt;integral&gt;');
    expect(svg).toContain('>s/d</tspan>');
  });
});
