import struct
import tarfile
import io
import unittest

from traffic_tar_writer import (
    EdgeTrafficEvaluation,
    GraphVersionMismatchError,
    ProbeObservation,
    TrafficState,
    UNKNOWN_TRAFFIC_SPEED_RAW,
    build_valhalla_traffic_tile_bytes,
    decode_valhalla_traffic_speed,
    encode_valhalla_traffic_speed,
    evaluate_edge_traffic,
    write_valhalla_traffic_tar,
)


class TestValhallaTrafficSpike(unittest.TestCase):
    def test_bitfield_encoding_and_decoding_matches_valhalla_traffictile_spec(self):
        # 1. Free-flowing 60 km/h on a 60 km/h road (Bengaluru Outer Ring Road overnight)
        word_free = encode_valhalla_traffic_speed(60.0, free_flow_speed_kph=60.0)
        decoded_free = decode_valhalla_traffic_speed(word_free)
        self.assertEqual(decoded_free["overall_kph"], 60)
        self.assertEqual(decoded_free["congestion1"], 1)  # 1 = free-flow
        self.assertEqual(decoded_free["incidents_present"], 0)

        # 2. Severe Silk Board junction congestion: 8 km/h on a 60 km/h arterial with incident
        word_jam = encode_valhalla_traffic_speed(
            8.0, free_flow_speed_kph=60.0, incidents_present=True
        )
        decoded_jam = decode_valhalla_traffic_speed(word_jam)
        self.assertEqual(decoded_jam["overall_kph"], 8)
        self.assertGreaterEqual(decoded_jam["congestion1"], 50)
        self.assertEqual(decoded_jam["incidents_present"], 1)

        # 3. Unknown / No Data must encode 127 (UNKNOWN_TRAFFIC_SPEED_RAW)
        word_unknown = encode_valhalla_traffic_speed(None)
        decoded_unknown = decode_valhalla_traffic_speed(word_unknown)
        self.assertEqual(decoded_unknown["overall_raw"], UNKNOWN_TRAFFIC_SPEED_RAW)
        self.assertIsNone(decoded_unknown["overall_kph"])
        self.assertEqual(decoded_unknown["congestion1"], 0)

    def test_k_anonymity_privacy_gate_blocks_low_density_edges_from_publishing_live_traffic(self):
        now = 1794550000
        # Only 3 drivers on a quiet residential street in Indiranagar (< 5 threshold)
        sparse_probes = [
            ProbeObservation(f"sess-{i}", speed_kph=28.0, timestamp_epoch=now - 30)
            for i in range(3)
        ]

        # Without historical profile -> strictly NO_DATA, never green LIVE
        ev_no_hist = evaluate_edge_traffic(
            directed_edge_index=42,
            observations=sparse_probes,
            free_flow_speed_kph=40.0,
            historical_speed_kph=None,
            now_epoch=now,
        )
        self.assertEqual(ev_no_hist.state, TrafficState.NO_DATA)
        self.assertFalse(ev_no_hist.render_as_live_color)
        self.assertIsNone(ev_no_hist.effective_speed_kph)
        self.assertEqual(
            decode_valhalla_traffic_speed(ev_no_hist.valhalla_encoded_uint64)["overall_raw"],
            UNKNOWN_TRAFFIC_SPEED_RAW,
        )

        # With historical profile -> falls back to HISTORICAL, still never rendered as LIVE
        ev_with_hist = evaluate_edge_traffic(
            directed_edge_index=42,
            observations=sparse_probes,
            free_flow_speed_kph=40.0,
            historical_speed_kph=32.0,
            now_epoch=now,
        )
        self.assertEqual(ev_with_hist.state, TrafficState.HISTORICAL)
        self.assertFalse(ev_with_hist.render_as_live_color)
        self.assertEqual(ev_with_hist.effective_speed_kph, 32.0)

    def test_sybil_single_session_flood_does_not_bypass_k_anonymity(self):
        now = 1794550000
        # 20 probes all sent from the same ephemeral session ID
        flood_probes = [
            ProbeObservation("attacker-session-1", speed_kph=4.0, timestamp_epoch=now - i)
            for i in range(20)
        ]
        ev = evaluate_edge_traffic(
            directed_edge_index=7,
            observations=flood_probes,
            free_flow_speed_kph=60.0,
            now_epoch=now,
        )
        self.assertEqual(ev.contributor_count, 1)
        self.assertEqual(ev.state, TrafficState.NO_DATA)
        self.assertFalse(ev.render_as_live_color)

    def test_bengaluru_silk_board_congestion_triggers_live_traffic_and_reroute_eta_shift(self):
        now = 1794550000
        # 10 distinct vehicles stuck in Silk Board congestion (~10 km/h on a 60 km/h corridor)
        congestion_probes = [
            ProbeObservation(f"blr-driver-{i}", speed_kph=9.0 + (i % 3), timestamp_epoch=now - 20)
            for i in range(10)
        ]
        ev = evaluate_edge_traffic(
            directed_edge_index=10,
            observations=congestion_probes,
            free_flow_speed_kph=60.0,
            historical_speed_kph=45.0,
            now_epoch=now,
        )
        self.assertEqual(ev.state, TrafficState.LIVE)
        self.assertTrue(ev.render_as_live_color)
        self.assertGreaterEqual(ev.confidence_score, 0.90)
        self.assertAlmostEqual(ev.effective_speed_kph, 9.8, delta=0.5)

        # Verify dynamic ETA shift calculation for a 5 km corridor:
        # Baseline (60 km/h) = 300s (5 min); Live congested (~10 km/h) = ~1836s (~30.6 min)
        corridor_km = 5.0
        baseline_eta_sec = (corridor_km / 60.0) * 3600.0
        live_eta_sec = (corridor_km / ev.effective_speed_kph) * 3600.0
        self.assertGreater(live_eta_sec, baseline_eta_sec * 5.0)

    def test_traffic_tar_binary_structure_and_graph_version_guard(self):
        now = 1794550000
        probes = [
            ProbeObservation(f"sess-{i}", speed_kph=20.0, timestamp_epoch=now - 10)
            for i in range(8)
        ]
        ev = evaluate_edge_traffic(3, probes, free_flow_speed_kph=50.0, now_epoch=now)

        tile_bytes = build_valhalla_traffic_tile_bytes(
            tile_id=2401,
            directed_edge_count=10,
            edge_evaluations={3: ev},
            last_update_epoch=now,
        )
        # 32-byte TrafficTileHeader + 10 * 8-byte TrafficSpeed records = 112 bytes
        self.assertEqual(len(tile_bytes), 32 + 10 * 8)

        tile_id, last_update, edge_count, version, _, _ = struct.unpack(
            "<QQIIII", tile_bytes[:32]
        )
        self.assertEqual(tile_id, 2401)
        self.assertEqual(last_update, now)
        self.assertEqual(edge_count, 10)
        self.assertEqual(version, 3)

        # Graph version mismatch MUST raise GraphVersionMismatchError
        with self.assertRaises(GraphVersionMismatchError):
            write_valhalla_traffic_tar(
                expected_graph_version_id="blr-2026-11-13-sha256-aaa",
                target_graph_version_id="blr-2026-11-01-sha256-bbb",
                tiles={(1, 2401): tile_bytes},
            )

        # Matching graph version produces valid uncompressed tar archive
        tar_bytes = write_valhalla_traffic_tar(
            expected_graph_version_id="blr-2026-11-13-sha256-aaa",
            target_graph_version_id="blr-2026-11-13-sha256-aaa",
            tiles={(1, 2401): tile_bytes},
        )
        with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r") as tf:
            names = tf.getnames()
            self.assertEqual(names, ["1/002/401.gph"])


if __name__ == "__main__":
    unittest.main()
