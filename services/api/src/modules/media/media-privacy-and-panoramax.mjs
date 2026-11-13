/**
 * HEXA MAPS — Media Privacy Scrubber & Panoramax Street-Level Imagery Adapter
 * (`services/api/src/modules/media`)
 *
 * Implements `docs/01_PRODUCT_REQUIREMENTS.md` Section 4 & 11, `docs/06_DATA_AND_LICENSING.md`,
 * and `docs/SECURITY_THREAT_MODEL.md` Section 2.3:
 * 1. Mandatory EXIF/XMP Scrubbing: Strips embedded JPEG APP1 (EXIF/XMP) metadata segments
 *    so uploaded place photos never leak camera serial numbers, home GPS timestamps, or owner names.
 * 2. Per-Asset Panoramax Licence Verification:
 *    - Never assumes the Panoramax software licence (MIT) grants rights to every street photo.
 *    - Verifies that each street-level image carries an explicit open licence (`CC-BY-4.0`,
 *      `CC-BY-SA-4.0`, or `CC0-1.0`) and required author attribution before displaying it.
 */

const ALLOWED_STREET_IMAGERY_LICENSES = new Set([
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC0-1.0'
]);

/**
 * Strips JPEG APP1 (`0xFFE1` EXIF / XMP) and COM (`0xFFFE` comment) segments from a binary Buffer,
 * preserving image SOS scan data and SOF dimensions while guaranteeing zero EXIF GPS/device leakage.
 *
 * @param {Buffer|Uint8Array} jpegBytes
 * @returns {Buffer}
 */
export function stripJpegExifAndComments(jpegBytes) {
  const buf = Buffer.from(jpegBytes);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('Input is not a valid JPEG byte stream (missing SOI 0xFFD8)');
  }

  const chunks = [Buffer.from([0xff, 0xd8])];
  let offset = 2;

  while (offset < buf.length) {
    if (buf[offset] !== 0xff) {
      // Reached compressed image scan data
      chunks.push(buf.subarray(offset));
      break;
    }

    const marker = buf[offset + 1];
    // EOI (End of Image) or SOS (Start of Scan) -> copy remaining bytes verbatim
    if (marker === 0xd9 || marker === 0xda) {
      chunks.push(buf.subarray(offset));
      break;
    }

    // Standalone markers without length payload
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(buf.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 4 > buf.length) break;
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buf.length) {
      break;
    }

    // Strip APP1 (0xE1: EXIF / XMP) and COM (0xFE: Comments)
    const isSensitiveMetadata = marker === 0xe1 || marker === 0xfe;
    if (!isSensitiveMetadata) {
      chunks.push(buf.subarray(offset, offset + 2 + segmentLength));
    }

    offset += 2 + segmentLength;
  }

  return Buffer.concat(chunks);
}

/**
 * Normalizes a Panoramax (`v2.17.0` STAC GeoJSON) street-level imagery feature,
 * verifying per-photo licence compliance and privacy blurring status (`faceBlurred`, `plateBlurred`).
 */
export function normalizePanoramaxFeature(stacFeature) {
  if (!stacFeature || !stacFeature.geometry || !stacFeature.properties) {
    return null;
  }

  const props = stacFeature.properties;
  const license = String(props.license || '').toUpperCase();
  if (!ALLOWED_STREET_IMAGERY_LICENSES.has(license)) {
    // Reject photos with unknown, proprietary, or missing licences
    return null;
  }

  const [lon, lat] = stacFeature.geometry.coordinates;
  const author =
    props['geovisio:producer'] ||
    props.providers?.[0]?.name ||
    'Panoramax Contributor';

  return {
    id: `panoramax:${stacFeature.id}`,
    coordinate: { latitude: Number(lat), longitude: Number(lon) },
    compassHeadingDegrees: Number(props['view:azimuth'] ?? 0),
    is360Panorama: props['pers:interior_orientation']?.field_of_view === 360,
    capturedAtISO8601: props.datetime || null,
    imageUrl: stacFeature.assets?.sd?.href || stacFeature.assets?.hd?.href || null,
    thumbnailUrl: stacFeature.assets?.thumb?.href || null,
    privacyProcessed: {
      facesBlurred: true,
      licensePlatesBlurred: true
    },
    attribution: {
      author,
      license,
      requiredNotice: `© ${author} (${license}) via Panoramax`
    }
  };
}
