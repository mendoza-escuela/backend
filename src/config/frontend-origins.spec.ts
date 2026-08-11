import { parseFrontendOrigin } from './frontend-origins';

describe('parseFrontendOrigin', () => {
  it('normaliza el slash final del origen', () => {
    expect(parseFrontendOrigin('https://app.example.com/')).toBe(
      'https://app.example.com',
    );
  });

  it.each([
    'javascript:alert(1)',
    'https://app.example.com/path',
    'https://user:password@app.example.com',
    'https://app.example.com?preview=true',
  ])('rechaza un FRONTEND_URL que no sea un origen HTTP(S): %s', (value) => {
    expect(() => parseFrontendOrigin(value)).toThrow();
  });
});
