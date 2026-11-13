/**
 * HEXA MAPS — Country & Network Highway Shield Resolver
 *
 * Resolves OpenStreetMap / OpenMapTiles / Planetiler route attributes
 * (`network`, `ref`, `country`) into verified country-specific shield descriptors.
 *
 * Safety & Cartographic Rules:
 * 1. Never guess a country's shield from `highway=motorway` alone without a verified
 *    `network` or explicit regional network rule.
 * 2. Handle regional sub-networks cleanly (e.g., `IN:SH:KA`, `IN:SH:UP` -> `IN:SH`;
 *    `US:NY`, `US:TX` -> generic US state circular/rectangular shield unless custom state shield exists;
 *    `GB:national` + `M25` -> `GB:M`, `A1` -> `GB:A`, `B4009` -> `GB:B`).
 * 3. Support concurrent route memberships (`network=IN:NH;e-road`, `ref=NH 48;AH47`).
 * 4. Log unmapped `network` identifiers into a non-PII diagnostic registry so missing
 *    networks can be added systematically.
 */

import {
  EXACT_SHIELD_DEFINITIONS,
  GENERIC_FALLBACK_SHIELD,
  SHIELD_SHAPES
} from '../definitions/shield-definitions.mjs';

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
]);

export class HighwayShieldResolver {
  constructor() {
    /** @type {Map<string, number>} Non-PII counter of unknown networks encountered */
    this.unknownNetworkTelemetry = new Map();
  }

  /**
   * Resolves a single `(network, ref)` pair into a formatted shield specification.
   *
   * @param {Object} input
   * @param {string|null|undefined} input.network - OSM route network tag (e.g. "IN:NH", "IN:SH:KA", "US:I", "GB:national")
   * @param {string|null|undefined} input.ref - Route reference string (e.g. "NH 48", "I-95", "M25", "A7")
   * @param {string} [input.theme='light'] - 'light' or 'dark'
   * @returns {Object|null} Resolved shield descriptor, or null if `ref` is empty/missing.
   */
  resolve({ network, ref, theme = 'light' } = {}) {
    if (ref === null || ref === undefined) {
      return null;
    }
    const trimmedRef = String(ref).trim();
    if (!trimmedRef) {
      return null;
    }

    const normalizedNetwork = network ? String(network).trim() : '';
    const definition = this.#matchDefinition(normalizedNetwork, trimmedRef);

    if (definition.id === GENERIC_FALLBACK_SHIELD.id) {
      const key = normalizedNetwork || '<missing_network>';
      this.unknownNetworkTelemetry.set(key, (this.unknownNetworkTelemetry.get(key) || 0) + 1);
    }

    const cleanCoreRef = this.#extractCoreRef(trimmedRef, definition);
    const displayText = definition.formatTemplate.replace('{ref}', cleanCoreRef);
    const palette = theme === 'dark' ? definition.colors.dark : definition.colors.light;

    return {
      shieldId: definition.id,
      spriteKey: `${definition.id}:${theme}:${displayText}`,
      countryCode: definition.countryCode,
      network: normalizedNetwork || 'unknown',
      classification: definition.classification,
      shape: definition.shape,
      bannerText: definition.bannerText,
      rawRef: trimmedRef,
      coreRef: cleanCoreRef,
      displayText,
      refLength: displayText.length,
      colors: palette,
      minZoom: definition.minZoom,
      priority: definition.priority,
      isFallback: definition.id === GENERIC_FALLBACK_SHIELD.id,
      license: definition.license,
      sourceStandard: definition.sourceStandard
    };
  }

  /**
   * Resolves semicolon-delimited concurrent route networks and refs on the same road way
   * (e.g., `network="US:I;US:US"`, `ref="I 80;US 30"`), deduplicating and sorting by priority.
   *
   * @param {Object} input
   * @param {string} [input.network]
   * @param {string} [input.ref]
   * @param {string} [input.theme='light']
   * @returns {Array<Object>}
   */
  resolveConcurrent({ network, ref, theme = 'light' } = {}) {
    if (!ref || !String(ref).trim()) {
      return [];
    }

    const refs = String(ref).split(';').map((s) => s.trim()).filter(Boolean);
    const networks = network ? String(network).split(';').map((s) => s.trim()) : [];

    const results = [];
    const seenKeys = new Set();

    for (let i = 0; i < refs.length; i++) {
      const netForIndex = networks[i] ?? networks[0] ?? '';
      const resolved = this.resolve({
        network: netForIndex,
        ref: refs[i],
        theme
      });
      if (resolved && !seenKeys.has(resolved.spriteKey)) {
        seenKeys.add(resolved.spriteKey);
        results.push(resolved);
      }
    }

    return results.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Returns a snapshot of unknown network tags encountered for telemetry/coverage expansion.
   */
  getUnknownNetworkReport() {
    return Object.fromEntries(this.unknownNetworkTelemetry.entries());
  }

  #matchDefinition(network, rawRef) {
    if (!network) {
      return GENERIC_FALLBACK_SHIELD;
    }

    // 1. Direct match in canonical dictionary
    if (Object.prototype.hasOwnProperty.call(EXACT_SHIELD_DEFINITIONS, network)) {
      return EXACT_SHIELD_DEFINITIONS[network];
    }

    // 2. India State Highways with state suffix (e.g., IN:SH:KA, IN:SH:UP, IN:SH:MH)
    if (/^IN:SH(?::[A-Z]{2})?$/i.test(network)) {
      return EXACT_SHIELD_DEFINITIONS['IN:SH'];
    }
    if (/^IN:NH(?::[A-Z]{2})?$/i.test(network)) {
      return EXACT_SHIELD_DEFINITIONS['IN:NH'];
    }
    if (/^IN:MDR(?::[A-Z]{2})?$/i.test(network)) {
      return EXACT_SHIELD_DEFINITIONS['IN:MDR'];
    }

    // 3. United Kingdom `GB:national` or `UK:national` disambiguated by route prefix (M, A, B)
    if (/^(?:GB|UK):(?:national|M|A|B)$/i.test(network)) {
      if (/^M\d+[A-Z]?$/i.test(rawRef) || /\(M\)$/i.test(rawRef)) {
        return EXACT_SHIELD_DEFINITIONS['GB:M'];
      }
      if (/^A\d+[A-Z]?$/i.test(rawRef)) {
        return EXACT_SHIELD_DEFINITIONS['GB:A'];
      }
      if (/^B\d+[A-Z]?$/i.test(rawRef)) {
        return EXACT_SHIELD_DEFINITIONS['GB:B'];
      }
    }

    // 4. US State Highways (`US:NY`, `US:TX`, `US:WA`, etc.)
    const usStateMatch = /^US:([A-Z]{2})$/.exec(network);
    if (usStateMatch && US_STATE_CODES.has(usStateMatch[1])) {
      const stateCode = usStateMatch[1];
      return {
        id: `us-state-${stateCode.toLowerCase()}`,
        countryCode: 'US',
        network: `US:${stateCode}`,
        classification: 'state_highway',
        shape: SHIELD_SHAPES.ROUNDED_RECT,
        bannerText: stateCode,
        stripPrefixRegex: new RegExp(`^(?:${stateCode}|SR|SH|State\\s+Route)[\\s-]*`, 'i'),
        formatTemplate: '{ref}',
        colors: {
          light: { background: '#FFFFFF', bannerBackground: '#18181B', border: '#18181B', text: '#18181B', bannerText: '#FFFFFF' },
          dark:  { background: '#F4F4F5', bannerBackground: '#09090B', border: '#09090B', text: '#09090B', bannerText: '#FFFFFF' }
        },
        minZoom: 6,
        priority: 75,
        license: 'CC0-1.0',
        sourceStandard: `MUTCD M1-5 State Route Sign (${stateCode})`
      };
    }

    // 5. Germany / Poland / Netherlands / France normalized aliases
    if (/^DE:(?:autobahn|A)$/i.test(network)) {
      return EXACT_SHIELD_DEFINITIONS['DE:A'];
    }
    if (/^DE:(?:bundesstrasse|B)$/i.test(network)) {
      return EXACT_SHIELD_DEFINITIONS['DE:B'];
    }
    if (/^PL:national$/i.test(network) && /^A\s*\d+/i.test(rawRef)) {
      return EXACT_SHIELD_DEFINITIONS['PL:motorways'];
    }

    // 6. Unknown network -> neutral fallback (never guess another country's shield)
    return GENERIC_FALLBACK_SHIELD;
  }

  #extractCoreRef(rawRef, definition) {
    if (!definition.stripPrefixRegex) {
      return rawRef.replace(/\s+/g, ' ').trim();
    }
    const stripped = rawRef.replace(definition.stripPrefixRegex, '').trim();
    return stripped || rawRef;
  }
}
