import { BadRequestException } from '@nestjs/common';
import { mendozaDayEnd, mendozaDayStart } from './mendoza-date.util';

describe('Mendoza campaign dates', () => {
  it('stores the civil start and end using ART (UTC-3)', () => {
    expect(mendozaDayStart('2026-08-01').toISOString()).toBe(
      '2026-08-01T03:00:00.000Z',
    );
    expect(mendozaDayEnd('2026-08-01').toISOString()).toBe(
      '2026-08-02T02:59:59.999Z',
    );
  });

  it('rejects impossible dates instead of normalizing them silently', () => {
    expect(() => mendozaDayEnd('2026-02-30')).toThrow(BadRequestException);
  });
});
