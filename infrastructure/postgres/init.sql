-- HEXA MAPS — Horizontal Data Layer Separation (ODbL Compliance & Privacy Enforcement)
-- Layer 1: osm_derived (ODbL 1.0)
-- Layer 2: hexa_community (Explicit user reviews, incident reports, business claims)
-- Layer 3: hexa_traffic_public (Aggregated k >= 5 directed edge speeds keyed by graph_version_id)
-- Note: Zero raw GPS probe tables exist by design.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS osm_derived;
CREATE SCHEMA IF NOT EXISTS hexa_community;
CREATE SCHEMA IF NOT EXISTS hexa_traffic_public;

CREATE TABLE IF NOT EXISTS hexa_traffic_public.graph_versions (
    graph_version_id TEXT PRIMARY KEY,
    region_code TEXT NOT NULL,
    osm_extract_sha256 TEXT NOT NULL,
    valhalla_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS hexa_traffic_public.edge_speed_aggregates (
    graph_version_id TEXT NOT NULL REFERENCES hexa_traffic_public.graph_versions(graph_version_id),
    tile_level SMALLINT NOT NULL,
    tile_id BIGINT NOT NULL,
    directed_edge_index INTEGER NOT NULL,
    traffic_state TEXT NOT NULL CHECK (traffic_state IN ('LIVE', 'LIVE_LOW_CONFIDENCE', 'HISTORICAL', 'ESTIMATED', 'STALE', 'NO_DATA')),
    effective_speed_kph NUMERIC(5,1),
    free_flow_speed_kph NUMERIC(5,1) NOT NULL,
    contributor_count INTEGER NOT NULL CHECK (contributor_count >= 5 OR traffic_state NOT IN ('LIVE', 'LIVE_LOW_CONFIDENCE')),
    confidence_score NUMERIC(3,2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    geom GEOMETRY(LineString, 4326),
    PRIMARY KEY (graph_version_id, tile_level, tile_id, directed_edge_index)
);

CREATE INDEX IF NOT EXISTS idx_edge_speed_aggregates_geom
    ON hexa_traffic_public.edge_speed_aggregates USING GIST (geom);
