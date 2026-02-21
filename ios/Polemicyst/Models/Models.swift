import Foundation

struct VideoFeed: Identifiable, Codable {
    let id: String
    let name: String
    let sourceUrl: String
    let pollingInterval: Int
    let sourceType: String
    let userId: String
    let autoGenerateClips: Bool
    let viralitySettings: [String: AnyCodable]?
    let createdAt: Date
}

struct FeedVideo: Identifiable, Codable {
    let id: String
    let feedId: String
    let title: String?
    let transcript: String?
    let s3Url: String?
    let createdAt: Date
    let feed: VideoFeed?
}

struct ClipSourceVideo: Codable {
    let id: String
    let videoTitle: String?
    let s3Url: String?
}

struct ClipVideo: Identifiable, Codable {
    let id: String
    let userId: String
    let sourceVideoId: String?
    let s3Key: String?
    let s3Url: String?
    let videoTitle: String?
    let createdAt: Date
    let sourceVideo: ClipSourceVideo?
}

struct ClipJobResponse: Codable {
    let message: String
    let jobId: String
}

struct CreateFeedRequest: Codable {
    let name: String
    let sourceUrl: String
    let pollingInterval: Int
    let autoGenerateClips: Bool?
    let viralitySettings: [String: AnyCodable]?
}

struct TriggerClipRequest: Codable {
    let feedVideoId: String
    let userId: String
    let aspectRatio: String?
    let scoringMode: String?
    let includeAudio: Bool?
    let saferClips: Bool?
    let targetPlatform: String?
    let contentStyle: String?
    let minCandidates: Int?
    let maxCandidates: Int?
    let minScore: Double?
    let percentile: Double?
    let maxGeminiCandidates: Int?
    let llmProvider: String?
}

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else {
            value = ()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let bool as Bool:
            try container.encode(bool)
        case let string as String:
            try container.encode(string)
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}
