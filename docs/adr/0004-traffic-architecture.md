# ADR-0004: HEXA Live Traffic Architecture

- **Status:** Accepted (Gate 1 Binary `traffic.tar` & Privacy Gate Verified)
- **Date:** 2026-11-13
- **Deciders:** HEXA Architecture Team

## Context

Live traffic intelligence is HEXA MAPS' primary differentiator. Valhalla can consume live speeds via `traffic.tar` and historical speeds via DCT profiles, but does not collect, validate, privacy-filter, or aggregate traffic probes.

## Key Architectural Decisions

1. **Streaming Backbone (`TrafficStreamProvider`):**
   - Use **NATS JetStream** (Apache-2.0) as the default lightweight, persistent message stream for local and single-region self-hosted deployments.
   - Abstract behind `TrafficStreamProvider` so multi-region operators can switch to Apache Kafka or Redpanda without changing ingestion or worker logic.
2. **Privacy-by-Design Probe Pipeline:**
   - **Opt-in only:** Separate foreground and background contribution toggles.
   - **Zero account linkage:** Probe ingestion endpoints reject user auth headers and strip IP addresses into rotating in-memory subnet rate-limiters.
   - **Spatial Trimming:** First 500m and last 500m (+ 100–300m random uniform jitter) of every trip are clipped before ingestion.
   - **Ephemeral Session Rotation:** Random session IDs rotate every 15 minutes / 10 km.
   - **$k$-Anonymity Gate ($k \ge 5$):** No edge publishes `LIVE` or `LIVE_LOW_CONFIDENCE` traffic unless at least 5 distinct ephemeral sessions traverse the directed edge within the active rolling window.
3. **Graph-Version Pinning (`graph_version_id`):**
   - Every Valhalla graph build emits an immutable `graph_version_id`.
   - Map-matching (`Valhalla Meili`), speed aggregation, and atomic `traffic.tar` generation are strictly keyed to `graph_version_id`. Publishing traffic to a mismatched graph version is blocked at the binary header level.
4. **Honest 6-State UI Contract:**
   - Every road segment reports one of `LIVE`, `LIVE_LOW_CONFIDENCE`, `HISTORICAL`, `ESTIMATED`, `STALE`, or `NO_DATA`. `NO_DATA` is never rendered as green free-flowing traffic.
