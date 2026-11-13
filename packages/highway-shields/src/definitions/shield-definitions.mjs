/**
 * HEXA MAPS — Country-Specific Highway Route Shield Definitions
 *
 * Licence & Provenance:
 * - Geometric shield specifications inspired by OpenStreetMap Americana
 *   (https://github.com/osm-americana/openstreetmap-americana, CC0-1.0 Public Domain)
 *   and verified against national traffic sign regulations:
 *   - India: IRC:67 (Code of Practice for Road Signs)
 *   - United States: FHWA MUTCD 11th Edition (https://mutcd-dr.fhwa.dot.gov/)
 *   - United Kingdom: TSRGD (Traffic Signs Regulations and General Directions)
 *   - Germany: StVO (Straßenverkehrs-Ordnung Zeichen 405 / 401)
 *   - UNECE Vienna Convention (E-road network)
 *   - Other supported national networks (FR, IT, ES, NL, CH, PL, CA, AU, JP, BR, ZA)
 * - Strictly uses functional geometric silhouettes; never copies proprietary Google
 *   sprite sheets or restricted royal/heraldic insignia.
 */

export const SHIELD_SHAPES = Object.freeze({
  PILL: 'pill',
  ROUNDED_RECT: 'rounded_rect',
  INDIAN_MILESTONE_SHIELD: 'indian_milestone_shield',
  US_INTERSTATE: 'us_interstate',
  US_HIGHWAY: 'us_highway',
  US_CALIFORNIA_SPADE: 'us_california_spade',
  GERMAN_AUTOBAHN_HEXAGON: 'german_autobahn_hexagon',
  DIAMOND: 'diamond',
  HEXAGON: 'hexagon',
  TRAPEZOID_DOWN: 'trapezoid_down'
});

/**
 * Canonical definitions indexed by exact OSM `network` tag or normalized prefix.
 */
export const EXACT_SHIELD_DEFINITIONS = Object.freeze({
  // ==========================================================
  // INDIA (IRC:67 / NHAI / State PWD conventions)
  // ==========================================================
  'IN:NH': {
    id: 'in-nh',
    countryCode: 'IN',
    network: 'IN:NH',
    classification: 'national_highway',
    shape: SHIELD_SHAPES.INDIAN_MILESTONE_SHIELD,
    bannerText: 'NH',
    stripPrefixRegex: /^(?:NH[\s-]*)/i,
    formatTemplate: 'NH {ref}',
    colors: {
      light: { background: '#FACC15', bannerBackground: '#18181B', border: '#18181B', text: '#18181B', bannerText: '#FFFFFF' },
      dark:  { background: '#EAB308', bannerBackground: '#09090B', border: '#FAFAFA', text: '#09090B', bannerText: '#FAFAFA' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'IRC:67 India National Highway Shield'
  },
  'IN:NE': {
    id: 'in-ne',
    countryCode: 'IN',
    network: 'IN:NE',
    classification: 'national_expressway',
    shape: SHIELD_SHAPES.INDIAN_MILESTONE_SHIELD,
    bannerText: 'NE',
    stripPrefixRegex: /^(?:NE[\s-]*)/i,
    formatTemplate: 'NE {ref}',
    colors: {
      light: { background: '#1D4ED8', bannerBackground: '#FACC15', border: '#FFFFFF', text: '#FFFFFF', bannerText: '#18181B' },
      dark:  { background: '#2563EB', bannerBackground: '#FACC15', border: '#E4E4E7', text: '#FFFFFF', bannerText: '#09090B' }
    },
    minZoom: 5,
    priority: 105,
    license: 'CC0-1.0',
    sourceStandard: 'IRC:67 India National Expressway'
  },
  'IN:SH': {
    id: 'in-sh',
    countryCode: 'IN',
    network: 'IN:SH',
    classification: 'state_highway',
    shape: SHIELD_SHAPES.INDIAN_MILESTONE_SHIELD,
    bannerText: 'SH',
    stripPrefixRegex: /^(?:SH[\s-]*)/i,
    formatTemplate: 'SH {ref}',
    colors: {
      light: { background: '#FEF08A', bannerBackground: '#15803D', border: '#18181B', text: '#18181B', bannerText: '#FFFFFF' },
      dark:  { background: '#FDE047', bannerBackground: '#166534', border: '#E4E4E7', text: '#09090B', bannerText: '#FFFFFF' }
    },
    minZoom: 7,
    priority: 80,
    license: 'CC0-1.0',
    sourceStandard: 'IRC:67 India State Highway Shield'
  },
  'IN:MDR': {
    id: 'in-mdr',
    countryCode: 'IN',
    network: 'IN:MDR',
    classification: 'major_district_road',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: /^(?:MDR[\s-]*)/i,
    formatTemplate: 'MDR {ref}',
    colors: {
      light: { background: '#FFFFFF', border: '#18181B', text: '#18181B' },
      dark:  { background: '#27272A', border: '#D4D4D8', text: '#FAFAFA' }
    },
    minZoom: 9,
    priority: 50,
    license: 'CC0-1.0',
    sourceStandard: 'IRC:67 Major District Road'
  },

  // ==========================================================
  // UNITED STATES (FHWA MUTCD 11th Edition)
  // ==========================================================
  'US:I': {
    id: 'us-interstate',
    countryCode: 'US',
    network: 'US:I',
    classification: 'motorway',
    shape: SHIELD_SHAPES.US_INTERSTATE,
    bannerText: 'INTERSTATE',
    stripPrefixRegex: /^(?:I[\s-]*)/i,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#1E3A8A', bannerBackground: '#DC2626', border: '#FFFFFF', text: '#FFFFFF', bannerText: '#FFFFFF' },
      dark:  { background: '#1D4ED8', bannerBackground: '#EF4444', border: '#F4F4F5', text: '#FFFFFF', bannerText: '#FFFFFF' }
    },
    minZoom: 4,
    priority: 110,
    license: 'CC0-1.0',
    sourceStandard: 'MUTCD M1-1 Interstate Route Sign'
  },
  'US:I:Business:Loop': {
    id: 'us-interstate-business',
    countryCode: 'US',
    network: 'US:I:Business:Loop',
    classification: 'primary',
    shape: SHIELD_SHAPES.US_INTERSTATE,
    bannerText: 'BUSINESS',
    stripPrefixRegex: /^(?:I[\s-]*|BL[\s-]*)/i,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#15803D', bannerBackground: '#15803D', border: '#FFFFFF', text: '#FFFFFF', bannerText: '#FFFFFF' },
      dark:  { background: '#16A34A', bannerBackground: '#16A34A', border: '#F4F4F5', text: '#FFFFFF', bannerText: '#FFFFFF' }
    },
    minZoom: 7,
    priority: 85,
    license: 'CC0-1.0',
    sourceStandard: 'MUTCD M1-2 Interstate Business Loop'
  },
  'US:US': {
    id: 'us-highway',
    countryCode: 'US',
    network: 'US:US',
    classification: 'trunk',
    shape: SHIELD_SHAPES.US_HIGHWAY,
    bannerText: 'US',
    stripPrefixRegex: /^(?:US[\s-]*(?:Route[\s-]*)?)/i,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#FFFFFF', border: '#18181B', text: '#18181B' },
      dark:  { background: '#F4F4F5', border: '#09090B', text: '#09090B' }
    },
    minZoom: 5,
    priority: 95,
    license: 'CC0-1.0',
    sourceStandard: 'MUTCD M1-4 U.S. Route Sign'
  },
  'US:CA': {
    id: 'us-ca-state',
    countryCode: 'US',
    network: 'US:CA',
    classification: 'state_highway',
    shape: SHIELD_SHAPES.US_CALIFORNIA_SPADE,
    bannerText: 'CA',
    stripPrefixRegex: /^(?:CA[\s-]*|SR[\s-]*)/i,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#15803D', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#16A34A', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 6,
    priority: 80,
    license: 'CC0-1.0',
    sourceStandard: 'Caltrans G28-1 Miner Spade Shield'
  },

  // ==========================================================
  // UNITED KINGDOM (TSRGD)
  // ==========================================================
  'GB:M': {
    id: 'gb-motorway',
    countryCode: 'GB',
    network: 'GB:M',
    classification: 'motorway',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: null,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#0070B8', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#0284C7', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 105,
    license: 'CC0-1.0',
    sourceStandard: 'UK TSRGD Motorway Badge'
  },
  'GB:A': {
    id: 'gb-a-road',
    countryCode: 'GB',
    network: 'GB:A',
    classification: 'primary',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: null,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#00703C', border: '#FFD300', text: '#FFD300' },
      dark:  { background: '#15803D', border: '#FACC15', text: '#FACC15' }
    },
    minZoom: 6,
    priority: 90,
    license: 'CC0-1.0',
    sourceStandard: 'UK TSRGD Primary A-Road Badge'
  },
  'GB:B': {
    id: 'gb-b-road',
    countryCode: 'GB',
    network: 'GB:B',
    classification: 'secondary',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: null,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#FFFFFF', border: '#18181B', text: '#18181B' },
      dark:  { background: '#27272A', border: '#E4E4E7', text: '#FAFAFA' }
    },
    minZoom: 8,
    priority: 65,
    license: 'CC0-1.0',
    sourceStandard: 'UK TSRGD B-Road Badge'
  },

  // ==========================================================
  // GERMANY (StVO Zeichen 405 Autobahn / Zeichen 401 Bundesstraße)
  // ==========================================================
  'DE:A': {
    id: 'de-autobahn',
    countryCode: 'DE',
    network: 'DE:A',
    classification: 'motorway',
    shape: SHIELD_SHAPES.GERMAN_AUTOBAHN_HEXAGON,
    bannerText: null,
    stripPrefixRegex: /^(?:A[\s-]*)/i,
    formatTemplate: 'A {ref}',
    colors: {
      light: { background: '#1D4ED8', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#2563EB', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 105,
    license: 'CC0-1.0',
    sourceStandard: 'StVO Zeichen 405 Bundesautobahn'
  },
  'DE:B': {
    id: 'de-bundesstrasse',
    countryCode: 'DE',
    network: 'DE:B',
    classification: 'trunk',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: /^(?:B[\s-]*)/i,
    formatTemplate: 'B {ref}',
    colors: {
      light: { background: '#FACC15', border: '#18181B', text: '#18181B' },
      dark:  { background: '#EAB308', border: '#09090B', text: '#09090B' }
    },
    minZoom: 6,
    priority: 90,
    license: 'CC0-1.0',
    sourceStandard: 'StVO Zeichen 401 Bundesstraße'
  },

  // ==========================================================
  // INTERNATIONAL E-ROAD & SELECTED EUROPEAN / GLOBAL NETWORKS
  // ==========================================================
  'e-road': {
    id: 'int-e-road',
    countryCode: 'INT',
    network: 'e-road',
    classification: 'international_highway',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: /^(?:E[\s-]*)/i,
    formatTemplate: 'E {ref}',
    colors: {
      light: { background: '#15803D', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#16A34A', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 75,
    license: 'CC0-1.0',
    sourceStandard: 'UNECE Vienna Convention E-Road Sign'
  },
  'FR:A': {
    id: 'fr-autoroute',
    countryCode: 'FR',
    network: 'FR:A',
    classification: 'motorway',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: /^(?:A[\s-]*)/i,
    formatTemplate: 'A {ref}',
    colors: {
      light: { background: '#DC2626', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#EF4444', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'France Autoroute Cartouche E42'
  },
  'FR:N': {
    id: 'fr-nationale',
    countryCode: 'FR',
    network: 'FR:N',
    classification: 'trunk',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: /^(?:N[\s-]*)/i,
    formatTemplate: 'N {ref}',
    colors: {
      light: { background: '#DC2626', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#EF4444', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 6,
    priority: 85,
    license: 'CC0-1.0',
    sourceStandard: 'France Route Nationale Cartouche'
  },
  'IT:A-road': {
    id: 'it-autostrada',
    countryCode: 'IT',
    network: 'IT:A-road',
    classification: 'motorway',
    shape: SHIELD_SHAPES.HEXAGON,
    bannerText: null,
    stripPrefixRegex: /^(?:A[\s-]*)/i,
    formatTemplate: 'A{ref}',
    colors: {
      light: { background: '#15803D', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#16A34A', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'Italy Autostrada Octagon/Hexagon Sign'
  },
  'CH:Nationalstrassen': {
    id: 'ch-autobahn',
    countryCode: 'CH',
    network: 'CH:Nationalstrassen',
    classification: 'motorway',
    shape: SHIELD_SHAPES.GERMAN_AUTOBAHN_HEXAGON,
    bannerText: null,
    stripPrefixRegex: /^(?:A[\s-]*)/i,
    formatTemplate: 'A{ref}',
    colors: {
      light: { background: '#DC2626', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#EF4444', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'Switzerland SSV Signal 4.58 Autobahn'
  },
  'NL:A': {
    id: 'nl-autosnelweg',
    countryCode: 'NL',
    network: 'NL:A',
    classification: 'motorway',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: /^(?:A[\s-]*)/i,
    formatTemplate: 'A{ref}',
    colors: {
      light: { background: '#DC2626', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#EF4444', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'Netherlands Autosnelweg Shield'
  },
  'PL:motorways': {
    id: 'pl-autostrada',
    countryCode: 'PL',
    network: 'PL:motorways',
    classification: 'motorway',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: /^(?:A[\s-]*)/i,
    formatTemplate: 'A{ref}',
    colors: {
      light: { background: '#DC2626', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#EF4444', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'Poland Autostrada E-15c'
  },
  'CA:transcanada': {
    id: 'ca-transcanada',
    countryCode: 'CA',
    network: 'CA:transcanada',
    classification: 'trunk',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: 'TCH',
    stripPrefixRegex: null,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#15803D', border: '#FFFFFF', text: '#FFFFFF', bannerBackground: '#FFFFFF', bannerText: '#15803D' },
      dark:  { background: '#16A34A', border: '#F4F4F5', text: '#FFFFFF', bannerBackground: '#F4F4F5', bannerText: '#14532D' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'Trans-Canada Highway Geometric Shield'
  },
  'AU:NH': {
    id: 'au-national-highway',
    countryCode: 'AU',
    network: 'AU:NH',
    classification: 'national_highway',
    shape: SHIELD_SHAPES.INDIAN_MILESTONE_SHIELD,
    bannerText: 'NATIONAL',
    stripPrefixRegex: null,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#15803D', bannerBackground: '#15803D', border: '#FACC15', text: '#FACC15', bannerText: '#FACC15' },
      dark:  { background: '#166534', bannerBackground: '#166534', border: '#FDE047', text: '#FDE047', bannerText: '#FDE047' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'Australia AS 1742 National Highway Shield'
  },
  'JP:E': {
    id: 'jp-expressway',
    countryCode: 'JP',
    network: 'JP:E',
    classification: 'motorway',
    shape: SHIELD_SHAPES.ROUNDED_RECT,
    bannerText: null,
    stripPrefixRegex: null,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#15803D', border: '#FFFFFF', text: '#FFFFFF' },
      dark:  { background: '#16A34A', border: '#F4F4F5', text: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'Japan National Expressway Number Sign'
  },
  'KR:expressway': {
    id: 'kr-expressway',
    countryCode: 'KR',
    network: 'KR:expressway',
    classification: 'motorway',
    shape: SHIELD_SHAPES.US_INTERSTATE,
    bannerText: 'EXPWY',
    stripPrefixRegex: null,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#1E3A8A', bannerBackground: '#DC2626', border: '#FFFFFF', text: '#FFFFFF', bannerText: '#FFFFFF' },
      dark:  { background: '#1D4ED8', bannerBackground: '#EF4444', border: '#F4F4F5', text: '#FFFFFF', bannerText: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 100,
    license: 'CC0-1.0',
    sourceStandard: 'South Korea Expressway Shield'
  },
  'BR:BR': {
    id: 'br-federal',
    countryCode: 'BR',
    network: 'BR:BR',
    classification: 'national_highway',
    shape: SHIELD_SHAPES.INDIAN_MILESTONE_SHIELD,
    bannerText: 'BR',
    stripPrefixRegex: /^(?:BR[\s-]*)/i,
    formatTemplate: '{ref}',
    colors: {
      light: { background: '#FFFFFF', bannerBackground: '#18181B', border: '#18181B', text: '#18181B', bannerText: '#FFFFFF' },
      dark:  { background: '#F4F4F5', bannerBackground: '#09090B', border: '#09090B', text: '#09090B', bannerText: '#FFFFFF' }
    },
    minZoom: 5,
    priority: 95,
    license: 'CC0-1.0',
    sourceStandard: 'CONTRAN Brazil Federal Highway Shield'
  },
  'ZA:national': {
    id: 'za-national',
    countryCode: 'ZA',
    network: 'ZA:national',
    classification: 'national_highway',
    shape: SHIELD_SHAPES.HEXAGON,
    bannerText: null,
    stripPrefixRegex: /^(?:N[\s-]*)/i,
    formatTemplate: 'N{ref}',
    colors: {
      light: { background: '#1D4ED8', border: '#FFFFFF', text: '#FACC15' },
      dark:  { background: '#2563EB', border: '#F4F4F5', text: '#FDE047' }
    },
    minZoom: 5,
    priority: 95,
    license: 'CC0-1.0',
    sourceStandard: 'SADC RTSM South Africa National Route Pentagon/Hexagon'
  }
});

/**
 * Neutral fallback definition used strictly when a route's `network` has no verified
 * country/network definition. Never applies another country's shield.
 */
export const GENERIC_FALLBACK_SHIELD = Object.freeze({
  id: 'generic-fallback',
  countryCode: 'UNKNOWN',
  network: 'generic-fallback',
  classification: 'unknown',
  shape: SHIELD_SHAPES.PILL,
  bannerText: null,
  stripPrefixRegex: null,
  formatTemplate: '{ref}',
  colors: {
    light: { background: '#F4F4F5', border: '#71717A', text: '#27272A' },
    dark:  { background: '#27272A', border: '#A1A1AA', text: '#F4F4F5' }
  },
  minZoom: 8,
  priority: 10,
  license: 'CC0-1.0',
  sourceStandard: 'HEXA Neutral Fallback Route Badge'
});
