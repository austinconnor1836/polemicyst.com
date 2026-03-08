import XCTest
@testable import ClipfireiOS

final class ClipfireiOSTests: XCTestCase {
    func testDecodeFeed() throws {
        let json = """
        {
          "id": "feed-1",
          "name": "Test",
          "sourceUrl": "https://youtube.com/@test",
          "pollingInterval": 60,
          "sourceType": "youtube",
          "userId": "user-1",
          "autoGenerateClips": false,
          "createdAt": "2024-01-01T00:00:00Z"
        }
        """
        let data = Data(json.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        _ = try decoder.decode(VideoFeed.self, from: data)
    }
}
