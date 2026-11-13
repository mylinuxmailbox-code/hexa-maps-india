#!/usr/bin/env bash
# HEXA MAPS — Planetiler Regional Vector Tile Build Script (`Gate 2`)
#
# Builds an OpenMapTiles-compatible `.pmtiles` vector tile archive from an
# OpenStreetMap `.osm.pbf` extract (default: Bengaluru / Karnataka, India),
# preserving `transportation_name` route relation attributes (`network`, `ref`,
# `ref_length`) required by `@hexa-maps/highway-shields`.
#
# Usage:
#   ./scripts/build-tiles.sh [region_id] [osm_pbf_path]

set -euo pipefail

REGION_ID="${1:-in-ka-bengaluru}"
OSM_PBF_PATH="${2:-data/osm/${REGION_ID}.osm.pbf}"
OUTPUT_DIR="${OUTPUT_DIR:-data/tiles}"
OUTPUT_PMTILES="${OUTPUT_DIR}/${REGION_ID}.pmtiles"

mkdir -p "${OUTPUT_DIR}"

echo "[HEXA Tiles] Region: ${REGION_ID}"
echo "[HEXA Tiles] Source PBF: ${OSM_PBF_PATH}"
echo "[HEXA Tiles] Output PMTiles: ${OUTPUT_PMTILES}"

if [[ ! -f "${OSM_PBF_PATH}" ]]; then
  echo "[HEXA Tiles] Note: '${OSM_PBF_PATH}' not present locally."
  echo "[HEXA Tiles] To build Bengaluru vector tiles, download an OSM extract (ODbL 1.0) and run:"
  echo "  java -Xmx4g -jar planetiler.jar \\"
  echo "    --osm-path=${OSM_PBF_PATH} \\"
  echo "    --output=${OUTPUT_PMTILES} \\"
  echo "    --transportation_name_network=true \\"
  echo "    --nodemap-type=sparsearray"
  exit 0
fi

java -Xmx4g -jar "${PLANETILER_JAR:-planetiler.jar}" \
  --osm-path="${OSM_PBF_PATH}" \
  --output="${OUTPUT_PMTILES}" \
  --force

SHA256_SUM="$(shasum -a 256 "${OUTPUT_PMTILES}" | awk '{print $1}')"
echo "[HEXA Tiles] Build complete. SHA-256: ${SHA256_SUM}"
