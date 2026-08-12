import XCTest
import SwiftUI
@testable import ClipfireiOS

/// Tests for the server-side render handoff (PR: server-side stitch render flow).
///
/// `StitchManifestBuilder` produces the JSON payload the iOS client POSTs to
/// `/api/compositions/<id>/stitch-render`. The byte-shape of that payload has
/// to match `shared/lib/stitch/manifest.ts` exactly — the server validator on
/// the route is hand-rolled (no zod) and rejects unknown shapes.
final class StitchManifestBuilderTests: XCTestCase {

    // MARK: - Happy paths

    @MainActor
    func testFreeformBuildsExpectedJSON() throws {
        let clipA = StitchClip(
            id: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!,
            sourceURL: URL(fileURLWithPath: "/tmp/a.mp4"),
            durationS: 10.0,
            trimStartS: 1.0,
            trimEndS: 7.0,
            removeBackground: false
        )
        let clipB = StitchClip(
            id: UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!,
            sourceURL: URL(fileURLWithPath: "/tmp/b.mp4"),
            durationS: 5.0,
            trimStartS: 0,
            trimEndS: 5.0,
            removeBackground: true
        )
        let overlay = TextOverlay(
            clipId: clipA.id,
            text: "Hello",
            backgroundColor: Color.black.opacity(0.5),
            textColor: .white,
            fontSize: 48,
            position: CGPoint(x: 0.5, y: 0.25)
        )
        let snapshot = StitchTimelineSnapshot(
            clips: [clipA, clipB],
            textOverlays: [overlay],
            cutoutOverlay: nil,
            layout: .mobile,
            style: .freeform
        )
        let trackIdForClip: [UUID: String] = [
            clipA.id: "track-aaa",
            clipB.id: "track-bbb",
        ]

        let manifest = try StitchManifestBuilder.build(
            snapshot: snapshot,
            trackIdForClip: trackIdForClip,
            title: "My Stitch"
        )

        // Roundtrip-encode so we test the JSON shape the server will actually see.
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = try encoder.encode(manifest)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json["style"] as? String, "freeform")
        XCTAssertEqual(json["layout"] as? String, "mobile")
        XCTAssertEqual(json["title"] as? String, "My Stitch")

        let clips = try XCTUnwrap(json["clips"] as? [[String: Any]])
        XCTAssertEqual(clips.count, 2)
        XCTAssertEqual(clips[0]["trackId"] as? String, "track-aaa")
        XCTAssertEqual(clips[0]["trimStartS"] as? Double, 1.0)
        XCTAssertEqual(clips[0]["trimEndS"] as? Double, 7.0)
        XCTAssertEqual(clips[0]["removeBackground"] as? Bool, false)
        XCTAssertEqual(clips[1]["trackId"] as? String, "track-bbb")
        XCTAssertEqual(clips[1]["removeBackground"] as? Bool, true)

        let overlays = try XCTUnwrap(json["textOverlays"] as? [[String: Any]])
        XCTAssertEqual(overlays.count, 1)
        XCTAssertEqual(overlays[0]["text"] as? String, "Hello")
        XCTAssertEqual(overlays[0]["attachedToClipIndex"] as? Int, 0)
        XCTAssertEqual(overlays[0]["fontSize"] as? Double, 48)

        let position = try XCTUnwrap(overlays[0]["position"] as? [String: Any])
        XCTAssertEqual(position["x"] as? Double, 0.5)
        XCTAssertEqual(position["y"] as? Double, 0.25)

        let textColor = try XCTUnwrap(overlays[0]["textColor"] as? [String: Any])
        // .white in sRGB is (1,1,1,1) — we tolerate sub-pixel float drift.
        XCTAssertEqual(textColor["r"] as? Double ?? 0, 1.0, accuracy: 0.01)
        XCTAssertEqual(textColor["g"] as? Double ?? 0, 1.0, accuracy: 0.01)
        XCTAssertEqual(textColor["b"] as? Double ?? 0, 1.0, accuracy: 0.01)
        XCTAssertEqual(textColor["a"] as? Double ?? 0, 1.0, accuracy: 0.01)

        // freeform must NOT emit a cutout block (server validator allows it
        // missing on freeform and required on freezeReveal).
        XCTAssertNil(json["cutout"], "freeform should not emit a cutout field")
    }

    @MainActor
    func testFreezeRevealEmitsCutout() throws {
        let ref = StitchClip(
            id: UUID(),
            sourceURL: URL(fileURLWithPath: "/tmp/ref.mp4"),
            durationS: 8.0,
            trimStartS: 0,
            trimEndS: 8.0,
            removeBackground: false
        )
        let creator = StitchClip(
            id: UUID(),
            sourceURL: URL(fileURLWithPath: "/tmp/creator.mp4"),
            durationS: 3.0,
            trimStartS: 0,
            trimEndS: 3.0,
            removeBackground: true
        )
        let cutout = CutoutOverlay(
            clipId: ref.id,
            sourceURL: URL(fileURLWithPath: "/tmp/creator.mp4"),
            sourceDurationS: 3.0,
            position: CGPoint(x: 0.5, y: 0.55),
            scale: 0.9
        )
        let snapshot = StitchTimelineSnapshot(
            clips: [ref, creator],
            textOverlays: [],
            cutoutOverlay: cutout,
            layout: .landscape,
            style: .freezeReveal
        )
        let trackIdForClip: [UUID: String] = [
            ref.id: "track-ref",
            creator.id: "track-creator",
        ]

        let manifest = try StitchManifestBuilder.build(
            snapshot: snapshot,
            trackIdForClip: trackIdForClip,
            title: nil
        )
        let data = try JSONEncoder().encode(manifest)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json["style"] as? String, "freezeReveal")
        XCTAssertEqual(json["layout"] as? String, "landscape")
        XCTAssertNil(json["title"], "nil title should be omitted from JSON")

        let cutoutJSON = try XCTUnwrap(json["cutout"] as? [String: Any])
        let pos = try XCTUnwrap(cutoutJSON["position"] as? [String: Any])
        XCTAssertEqual(pos["x"] as? Double, 0.5)
        XCTAssertEqual(pos["y"] as? Double ?? 0, 0.55, accuracy: 0.001)
        XCTAssertEqual(cutoutJSON["scale"] as? Double ?? 0, 0.9, accuracy: 0.001)

        let clips = try XCTUnwrap(json["clips"] as? [[String: Any]])
        XCTAssertEqual(clips[0]["trackId"] as? String, "track-ref")
        XCTAssertEqual(clips[1]["trackId"] as? String, "track-creator")
        XCTAssertEqual(clips[1]["removeBackground"] as? Bool, true)
    }

    // MARK: - Error paths

    @MainActor
    func testMissingTrackIdThrows() {
        let clip = StitchClip(
            id: UUID(),
            sourceURL: URL(fileURLWithPath: "/tmp/x.mp4"),
            durationS: 5.0
        )
        let snapshot = StitchTimelineSnapshot(
            clips: [clip],
            textOverlays: [],
            cutoutOverlay: nil,
            layout: .mobile,
            style: .freeform
        )
        // Intentionally empty map — no upload happened.
        let trackIdForClip: [UUID: String] = [:]

        XCTAssertThrowsError(try StitchManifestBuilder.build(
            snapshot: snapshot,
            trackIdForClip: trackIdForClip,
            title: nil
        )) { error in
            guard case StitchManifestBuilderError.missingTrackId(let id) = error else {
                XCTFail("Expected .missingTrackId, got \(error)")
                return
            }
            XCTAssertEqual(id, clip.id)
        }
    }

    @MainActor
    func testFreezeRevealWithoutExactlyTwoClipsThrows() {
        let onlyOne = StitchClip(
            id: UUID(),
            sourceURL: URL(fileURLWithPath: "/tmp/x.mp4"),
            durationS: 5.0
        )
        let snapshot = StitchTimelineSnapshot(
            clips: [onlyOne],
            textOverlays: [],
            cutoutOverlay: CutoutOverlay(
                clipId: onlyOne.id,
                sourceURL: URL(fileURLWithPath: "/tmp/y.mp4"),
                sourceDurationS: 3
            ),
            layout: .mobile,
            style: .freezeReveal
        )

        XCTAssertThrowsError(try StitchManifestBuilder.build(
            snapshot: snapshot,
            trackIdForClip: [onlyOne.id: "track-1"],
            title: nil
        )) { error in
            guard case StitchManifestBuilderError.freezeRevealNeedsTwoClips(let count) = error else {
                XCTFail("Expected .freezeRevealNeedsTwoClips, got \(error)")
                return
            }
            XCTAssertEqual(count, 1)
        }
    }

    @MainActor
    func testFreezeRevealMissingCutoutThrows() {
        let a = StitchClip(id: UUID(), sourceURL: URL(fileURLWithPath: "/tmp/a.mp4"), durationS: 5)
        let b = StitchClip(id: UUID(), sourceURL: URL(fileURLWithPath: "/tmp/b.mp4"), durationS: 3)
        let snapshot = StitchTimelineSnapshot(
            clips: [a, b],
            textOverlays: [],
            cutoutOverlay: nil,
            layout: .mobile,
            style: .freezeReveal
        )
        XCTAssertThrowsError(try StitchManifestBuilder.build(
            snapshot: snapshot,
            trackIdForClip: [a.id: "ta", b.id: "tb"],
            title: nil
        )) { error in
            guard case StitchManifestBuilderError.freezeRevealMissingCutout = error else {
                XCTFail("Expected .freezeRevealMissingCutout, got \(error)")
                return
            }
        }
    }
}

// MARK: - LocalStitch backward-compat

/// `LocalStitch` is the persisted-on-disk row that drives `MyStitchesView`. Adding
/// the `outputS3Url` field and changing the `ProcessingState` enum shape needed
/// to be backward-compatible with rows written by the previous app version so
/// upgrade users don't lose their library.
final class LocalStitchDecodingTests: XCTestCase {

    /// Old persisted JSON without the new `outputS3Url` field should decode and
    /// land with `outputS3Url == nil`.
    func testOldJSONWithoutOutputS3UrlDecodes() throws {
        let json = """
        {
          "id": "11111111-1111-1111-1111-111111111111",
          "title": "Old stitch",
          "layoutKey": "mobile",
          "durationS": 12.5,
          "localFilename": "11111111-1111-1111-1111-111111111111.mp4",
          "createdAt": "2026-06-01T00:00:00Z",
          "serverCompositionId": "comp-old-1",
          "processingState": { "type": "ready" }
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let stitch = try decoder.decode(LocalStitch.self, from: Data(json.utf8))
        XCTAssertEqual(stitch.title, "Old stitch")
        XCTAssertEqual(stitch.serverCompositionId, "comp-old-1")
        XCTAssertNil(stitch.outputS3Url, "outputS3Url should default to nil when missing")
        XCTAssertTrue(stitch.processingState.isReady)
    }

    /// Rows persisted by the previous build had `processingState.type == "uploadingFinal"`
    /// (or `awaitingTranscripts` / `generatingMeta` / `rendering`). Now that the
    /// pipeline ships rendered MP4s from the server, those local rows have either:
    ///   - a `serverCompositionId` set — the file made it to S3, mark `.ready`
    ///   - no `serverCompositionId` — it's lost, mark `.failed`
    func testLegacyUploadingFinalWithCompositionIdUpgradesToReady() throws {
        let json = """
        {
          "id": "22222222-2222-2222-2222-222222222222",
          "title": "Legacy",
          "layoutKey": "mobile",
          "durationS": 8,
          "localFilename": "x.mp4",
          "createdAt": "2026-06-01T00:00:00Z",
          "serverCompositionId": "comp-legacy",
          "processingState": { "type": "uploadingFinal" }
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let stitch = try decoder.decode(LocalStitch.self, from: Data(json.utf8))
        XCTAssertTrue(stitch.processingState.isReady,
                      "Legacy uploadingFinal + serverCompositionId should map to .ready")
    }

    func testLegacyRenderingWithoutCompositionIdMapsToFailed() throws {
        let json = """
        {
          "id": "33333333-3333-3333-3333-333333333333",
          "title": "Legacy fail",
          "layoutKey": "mobile",
          "durationS": 8,
          "localFilename": "x.mp4",
          "createdAt": "2026-06-01T00:00:00Z",
          "processingState": { "type": "rendering", "progress": 0.5 }
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let stitch = try decoder.decode(LocalStitch.self, from: Data(json.utf8))
        XCTAssertNotNil(stitch.processingState.failureMessage,
                        "Legacy in-progress render without composition id should map to .failed")
    }

    /// New state cases roundtrip through the codec correctly.
    func testNewStateCasesRoundtrip() throws {
        let cases: [ProcessingState] = [
            .uploadingClips(progress: 0.42),
            .queued,
            .renderingOnServer(progress: nil),
            .renderingOnServer(progress: 0.7),
            .ready,
            .failed("Something blew up"),
        ]
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        for state in cases {
            let data = try encoder.encode(state)
            let decoded = try decoder.decode(ProcessingState.self, from: data)
            XCTAssertEqual(decoded, state, "ProcessingState should roundtrip exactly")
        }
    }
}
