import Foundation

public struct VideoFeed: Identifiable, Codable {
    public let id: String
    public let name: String
    public let sourceUrl: String
    public let pollingInterval: Int
    public let sourceType: String
    public let userId: String
    public let autoGenerateClips: Bool
    public let viralitySettings: [String: AnyCodable]?
    public let createdAt: Date
}

public struct FeedVideo: Identifiable, Codable {
    public let id: String
    public let feedId: String
    public let title: String?
    public let transcript: String?
    public let s3Url: String?
    public let createdAt: Date
    public let feed: VideoFeed?
}

public struct ClipSourceVideo: Codable {
    public let id: String
    public let videoTitle: String?
    public let s3Url: String?
}

public struct ClipVideo: Identifiable, Codable {
    public let id: String
    public let userId: String
    public let sourceVideoId: String?
    public let s3Key: String?
    public let s3Url: String?
    public let videoTitle: String?
    public let createdAt: Date
    public let sourceVideo: ClipSourceVideo?
}

public struct ClipJobResponse: Codable {
    public let message: String
    public let jobId: String
}

public struct CreateFeedRequest: Codable {
    public let name: String
    public let sourceUrl: String
    public let pollingInterval: Int
    public let autoGenerateClips: Bool?
    public let viralitySettings: [String: AnyCodable]?
}

public struct TriggerClipRequest: Codable {
    public let feedVideoId: String
    public let userId: String
    public let aspectRatio: String?
    public let scoringMode: String?
    public let includeAudio: Bool?
    public let saferClips: Bool?
    public let targetPlatform: String?
    public let contentStyle: String?
    public let minCandidates: Int?
    public let maxCandidates: Int?
    public let minScore: Double?
    public let percentile: Double?
    public let maxGeminiCandidates: Int?
    public let llmProvider: String?
}

public struct AnyCodable: Codable {
    public let value: Any

    public init(_ value: Any) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
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

    public func encode(to encoder: Encoder) throws {
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
