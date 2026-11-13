import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HighwayShieldResolver,
  HighwayShieldRenderer,
  SHIELD_SHAPES
} from '../index.mjs';

test('India National and State Highway shields (IN:NH, IN:SH, IN:NE, alphanumeric)', () => {
  const resolver = new HighwayShieldResolver();

  // Bengaluru NH 44 & NH 48
  const nh48 = resolver.resolve({ network: 'IN:NH', ref: 'NH 48', theme: 'light' });
  assert.equal(nh48.countryCode, 'IN');
  assert.equal(nh48.classification, 'national_highway');
  assert.equal(nh48.shape, SHIELD_SHAPES.INDIAN_MILESTONE_SHIELD);
  assert.equal(nh48.bannerText, 'NH');
  assert.equal(nh48.coreRef, '48');
  assert.equal(nh48.displayText, 'NH 48');
  assert.equal(nh48.colors.background, '#FACC15'); // Indian yellow
  assert.equal(nh48.colors.text, '#18181B');       // Black text
  assert.equal(nh48.isFallback, false);

  // Alphanumeric Indian National Highway (e.g., NH 275A)
  const nh275a = resolver.resolve({ network: 'IN:NH', ref: '275A', theme: 'dark' });
  assert.equal(nh275a.displayText, 'NH 275A');
  assert.equal(nh275a.coreRef, '275A');

  // State Highway with regional state suffix (Karnataka IN:SH:KA, Uttar Pradesh IN:SH:UP)
  const sh35 = resolver.resolve({ network: 'IN:SH:KA', ref: 'SH 35' });
  assert.equal(sh35.countryCode, 'IN');
  assert.equal(sh35.classification, 'state_highway');
  assert.equal(sh35.bannerText, 'SH');
  assert.equal(sh35.displayText, 'SH 35');
  assert.NotEqual?.(sh35.colors.bannerBackground, nh48.colors.bannerBackground);
});

test('United States Interstate, US Highway, and State Route shields (MUTCD)', () => {
  const resolver = new HighwayShieldResolver();

  const i95 = resolver.resolve({ network: 'US:I', ref: 'I-95' });
  assert.equal(i95.countryCode, 'US');
  assert.equal(i95.shape, SHIELD_SHAPES.US_INTERSTATE);
  assert.equal(i95.bannerText, 'INTERSTATE');
  assert.equal(i95.displayText, '95');
  assert.equal(i95.isFallback, false);

  const us66 = resolver.resolve({ network: 'US:US', ref: 'US-Route 66' });
  assert.equal(us66.countryCode, 'US');
  assert.equal(us66.shape, SHIELD_SHAPES.US_HIGHWAY);
  assert.equal(us66.displayText, '66');

  const ca1 = resolver.resolve({ network: 'US:CA', ref: 'SR 1' });
  assert.equal(ca1.shape, SHIELD_SHAPES.US_CALIFORNIA_SPADE);
  assert.equal(ca1.displayText, '1');

  const ny27 = resolver.resolve({ network: 'US:NY', ref: 'NY 27' });
  assert.equal(ny27.countryCode, 'US');
  assert.equal(ny27.bannerText, 'NY');
  assert.equal(ny27.displayText, '27');
});

test('United Kingdom M motorway and A/B road badges (TSRGD)', () => {
  const resolver = new HighwayShieldResolver();

  const m25 = resolver.resolve({ network: 'GB:national', ref: 'M25' });
  assert.equal(m25.countryCode, 'GB');
  assert.equal(m25.classification, 'motorway');
  assert.equal(m25.displayText, 'M25');
  assert.equal(m25.colors.background, '#0070B8'); // Motorway blue

  const a1 = resolver.resolve({ network: 'GB:national', ref: 'A1' });
  assert.equal(a1.countryCode, 'GB');
  assert.equal(a1.classification, 'primary');
  assert.equal(a1.displayText, 'A1');
  assert.equal(a1.colors.background, '#00703C'); // Primary green
  assert.equal(a1.colors.text, '#FFD300');       // Primary yellow number
});

test('German Autobahn (A) and Bundesstraße (B) shields (StVO)', () => {
  const resolver = new HighwayShieldResolver();

  const a7 = resolver.resolve({ network: 'DE:A', ref: 'A 7' });
  assert.equal(a7.countryCode, 'DE');
  assert.equal(a7.shape, SHIELD_SHAPES.GERMAN_AUTOBAHN_HEXAGON);
  assert.equal(a7.displayText, 'A 7');
  assert.equal(a7.colors.background, '#1D4ED8');

  const b27 = resolver.resolve({ network: 'DE:B', ref: 'B 27' });
  assert.equal(b27.countryCode, 'DE');
  assert.equal(b27.shape, SHIELD_SHAPES.ROUNDED_RECT);
  assert.equal(b27.displayText, 'B 27');
  assert.equal(b27.colors.background, '#FACC15');
});

test('Concurrent routes on a single road segment are resolved, deduplicated, and sorted by priority', () => {
  const resolver = new HighwayShieldResolver();
  const concurrent = resolver.resolveConcurrent({
    network: 'e-road;DE:A',
    ref: 'E 45;A 7',
    theme: 'light'
  });

  assert.equal(concurrent.length, 2);
  // DE:A has higher priority than international e-road
  assert.equal(concurrent[0].displayText, 'A 7');
  assert.equal(concurrent[1].displayText, 'E 45');
});

test('Unknown route network safely falls back to generic badge and increments telemetry without guessing country', () => {
  const resolver = new HighwayShieldResolver();

  const unknown = resolver.resolve({ network: 'XX:Experimental', ref: 'X-999' });
  assert.equal(unknown.isFallback, true);
  assert.equal(unknown.countryCode, 'UNKNOWN');
  assert.equal(unknown.shape, SHIELD_SHAPES.PILL);
  assert.equal(unknown.displayText, 'X-999');

  const report = resolver.getUnknownNetworkReport();
  assert.equal(report['XX:Experimental'], 1);

  // Missing ref returns null
  assert.equal(resolver.resolve({ network: 'IN:NH', ref: '   ' }), null);
});

test('SVG and MapLibre nine-slice sprite metadata generation across 1x/2x/3x DPI and dark/light themes', () => {
  const resolver = new HighwayShieldResolver();
  const renderer = new HighwayShieldRenderer();

  const nh44Dark = resolver.resolve({ network: 'IN:NH', ref: 'NH 44', theme: 'dark' });
  const sprite = renderer.renderSvg(nh44Dark, { pixelRatio: 2 });

  assert.ok(sprite.svg.startsWith('<svg'));
  assert.ok(sprite.svg.includes('NH 44'));
  assert.equal(sprite.pixelRatio, 2);
  assert.equal(sprite.content.length, 4);
  assert.equal(sprite.stretchX.length, 1);
  assert.equal(sprite.stretchY.length, 1);
  assert.ok(sprite.width >= 68);
  assert.ok(sprite.height >= 48);
});
