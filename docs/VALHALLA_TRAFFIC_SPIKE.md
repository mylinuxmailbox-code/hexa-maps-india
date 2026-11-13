# HEXA MAPS — Valhalla Live Traffic Feasibility & Spike Plan

**Related ADR:** [ADR-0002: Routing Engine](file:///Users/vihaang/.gemini/antigravity/scratch/hexa-maps/docs/adr/0002-routing-engine.md), [ADR-0004: Traffic Architecture](file:///Users/vihaang/.gemini/antigravity/scratch/hexa-maps/docs/adr/0004-traffic-architecture.md)
**Verified Valhalla Version:** `3.6.3` / `3.9.1` (2026)

---

## 1. How Valhalla Consumes Traffic (Verified Architecture)

Valhalla supports two distinct traffic mechanisms that work together during route costing (`AutoCost`):

### 1.1 Live Traffic (`traffic.tar`)
- **Configuration:** Specified in `valhalla.json` under `mjolnir.traffic_extract` (e.g., `/data/valhalla/traffic.tar`).
- **Memory-Mapped Runtime Structure:** Valhalla uses `baldr::GraphReader` to `mmap` an uncompressed `.tar` archive whose internal entries mirror the exact directory hierarchy and tile IDs of the routing graph (`0/000/123.gph`, `1/...`, `2/...`).
- **Binary Layout per Tile (`baldr/traffictile.h`):**
  - Each traffic tile starts with a `TrafficTileHeader`:
    - `tile_id` (`uint64_t` matching the routing tile's `GraphId`)
    - `last_update` (`uint64_t` Unix epoch seconds—Valhalla ignores live speeds older than a staleness threshold!)
    - `directed_edge_count` (`uint32_t`—**must strictly equal** the `directededgecount` in the corresponding base routing tile header)
    - `traffic_tile_version` (`uint32_t`)
  - Followed immediately by an array of `TrafficSpeed` (`uint64_t`, 8 bytes per directed edge) indexed identically to `DirectedEdge` indices ($0 \dots N-1$) within that tile:
    - `overall_encoded_speed` (7 bits: speed in $\text{km/h} \div 2$, supporting $0\text{–}254\text{ km/h}$, where `0` = road closed and `UNKNOWN_TRAFFIC_SPEED_RAW = 127` means "no live data, fall back to predicted/historical or base speed").
    - `encoded_speed1`, `encoded_speed2`, `encoded_speed3` (sub-segment speeds along the edge).
    - `breakpoint1`, `breakpoint2` (fractional positions along the edge in $1/255$ increments).
    - `congestion1`, `congestion2`, `congestion3` (6 bits each: `0` = unknown, `1` = low/free-flow, `63` = max severe congestion).
    - `incidents_present` (1 bit).

### 1.2 Historical / Predicted Traffic (`predicted_speeds`)
- Stored directly inside the base routing tiles via `valhalla_add_predicted_traffic`.
- Uses 2,016 five-minute buckets per week ($7 \times 24 \times 12 = 2016$), compressed via Discrete Cosine Transform (DCT) coefficients into 200 bytes per directed edge, plus `constrained_flow_speed` and `free_flow_speed` scalars.

---

## 2. Critical Engineering Trap: Why OSMLR Cannot Be Used Naively

The legacy OpenTraffic Reporter project attempted to use **OSMLR** (OpenStreetMap Linear Referencing) segments as stable intermediate IDs. In practice:
1. Valhalla's `traffic.tar` does **not** key records by OSMLR ID or OSM `way_id`—it indexes them strictly by positional offset (`0 .. directed_edge_count - 1`) inside each hierarchical Valhalla tile (`level / tile_id`).
2. Whenever `valhalla_build_tiles` runs on an updated `.osm.pbf`, edge splitting, node additions, or turn-restriction changes shift `edge_id` offsets within a tile.
3. **Solution (`HEXA Graph-Versioned Edge Registry`):**
   - Every time HEXA builds a Valhalla routing graph, a build step exports an immutable **Graph Edge Catalog** keyed by `graph_version_id` (SHA-256 of the built `valhalla_tiles.tar`).
   - When Valhalla Meili (`trace_attributes`) map-matches an incoming GPS probe trace against the active graph (`graph_version_id`), it returns the exact `edge.id` (`GraphId` containing `level`, `tile_id`, `id` offset) and `osm_way_id`.
   - The `traffic-publishing` worker aggregates speeds directly by `(graph_version_id, level, tile_id, edge_index)` and writes a byte-exact `traffic.tar` matching that exact `graph_version_id`.

---

## 3. Honest Traffic State Machine

HEXA MAPS never fabricates green "LIVE" lines when probe coverage is empty or sparse. Each directed edge maintains a computed state:

| State | Criteria | Valhalla `TrafficSpeed` Encoding | Map UI Rendering |
| :--- | :--- | :--- | :--- |
| `LIVE` | $\ge 5$ distinct ephemeral probe sessions ($k \ge 5$) in last 10 min AND low variance ($\sigma_v < 15\text{ km/h}$). | Encoded harmonic mean speed + congestion score; `last_update = now()`. | Solid traffic polyline (Green / Amber / Red / Dark Red) + "LIVE" badge. |
| `LIVE_LOW_CONFIDENCE` | $5 \le k < 8$ with high variance (e.g., signalized urban arterial with stop-and-go). | Blended speed ($0.6 \times v_{\text{live}} + 0.4 \times v_{\text{hist}}$); `last_update = now()`. | Dashed/muted traffic overlay + "Low confidence" tooltip. |
| `HISTORICAL` | $k < 5$ live probes, but valid historical weekly profile exists for this `(day_of_week, 5min_bucket)`. | `UNKNOWN_TRAFFIC_SPEED_RAW` in `traffic.tar` (Valhalla automatically uses DCT `predicted_speeds`). | Neutral road or optional "Typical traffic" view; explicitly labeled `Historical`. |
| `ESTIMATED` | $k < 5$ live probes and no historical profile; derived from OSM `maxspeed` / road class Constrained/Free-Flow heuristic. | `UNKNOWN_TRAFFIC_SPEED_RAW` in `traffic.tar` (Valhalla uses base costing). | No live traffic color; ETA labeled `Estimated (no live traffic)`. |
| `STALE` | Last valid $k \ge 5$ window was $10\text{–}30\text{ min}$ ago. | Decayed toward historical speed; marked stale after 15 min. | Greyed-out indicator with "Updated $X$ min ago". |
| `NO_DATA` | $k < 5$ and no historical profile. | `UNKNOWN_TRAFFIC_SPEED_RAW` (`127`). | **Never rendered as green.** Standard 2D road casing only. |

---

## 4. Gate 1 Spike Verification Plan

In Gate 1, before building the full streaming pipeline, we will build a self-contained **Valhalla Traffic Spike (`scripts/valhalla-traffic-spike/`)**:
1. Download a small clipped `.osm.pbf` of **Central Bengaluru** (MG Road / Silk Board / Indiranagar corridor).
2. Run `valhalla_build_tiles` to generate `valhalla_tiles` and compute `graph_version_id`.
3. Write a small, tested C++/Python utility (`hexa-traffic-tar-writer`) that reads the base tile headers (`directededgecount`), initializes an uncompressed `traffic.tar` with `UNKNOWN_TRAFFIC_SPEED_RAW`, and allows injecting live speeds for specific `GraphId` directed edges.
4. Query `/route` with `"costing": "auto", "costing_options": {"auto": {"use_living_streets": 0.5}}, "date_time": {"type": 0}` (current time):
   - **Assertion 1:** Baseline route between Silk Board and Indiranagar takes Primary Route A with ETA $T_1$.
   - **Assertion 2:** Inject severe congestion ($6\text{ km/h}$) into `traffic.tar` along Primary Route A's directed edges and update `TrafficTileHeader.last_update`.
   - **Assertion 3:** Re-query `/route` **without restarting Valhalla** and verify that ETA increases to $T_2 \gg T_1$ and Valhalla dynamically reroutes onto Alternative Route B.
   - **Assertion 4:** Pass a mismatched `graph_version_id` to `hexa-traffic-tar-writer` and verify it aborts with a hard safety error before touching `traffic.tar`.
