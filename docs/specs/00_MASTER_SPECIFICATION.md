# HEXA MAPS — Master Specification Reference

This file indexes the foundational requirements provided at project inception:
1. **Mission & Release Order:** Phase 1 macOS → Phase 2 iOS → Phase 3 Android → Phase 4 Self-hostable Web.
2. **Absolute Constraints:** Open-source dependencies, 2D-First (no 3D globe/buildings/models), full self-hosting, provider independence (`provider-registry`), and strict privacy (opt-in telemetry, $k \ge 5$ traffic aggregation, no raw coordinates in logs).
3. **Initial Pilot:** Bengaluru, India (OSM roads, NH/SH shields, BMTC/BMRCL transit, community traffic pilot).
4. **Cartographic Requirement:** Country-specific highway route shields (`packages/highway-shields`) using OSM `network` and `ref` relations across all platforms.

See the Gate 0 deliverables in `/docs/` for the complete dependency audit, data provenance register, threat model, architecture proposal, and spike plans.
