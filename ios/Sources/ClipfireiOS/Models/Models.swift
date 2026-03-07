import Foundation

// MARK: - Version Check

public struct VersionCheckResponse: Codable {
    public let updateRequired: Bool
    public let minimumVersion: String
    public let latestVersion: String
    public let storeUrl: String
}

// MARK: - Feeds

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

// MARK: - Feed Videos

public struct FeedVideo: Identifiable, Codable {
    public let id: String
    public let feedId: String
    public let title: String?
    public let transcript: String?
    public let s3Url: String?
    public let createdAt: Date
    public let feed: VideoFeed?
}

// MARK: - Clips

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

// MARK: - Requests

public struct CreateFeedRequest: Codable {
    public let name: String
    public let sourceUrl: String
    public let pollingInterval: Int
    public let autoGenerateClips: Bool?
    public let viralitySettings: [String: AnyCodable]?

    public init(name: String, sourceUrl: String, pollingInterval: Int,
                autoGenerateClips: Bool? = nil, viralitySettings: [String: AnyCodable]? = nil) {
        self.name = name
        self.sourceUrl = sourceUrl
        self.pollingInterval = pollingInterval
        self.autoGenerateClips = autoGenerateClips
        self.viralitySettings = viralitySettings
    }
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

    public init(feedVideoId: String, userId: String, aspectRatio: String? = nil,
                scoringMode: String? = nil, includeAudio: Bool? = nil,
                saferClips: Bool? = nil, targetPlatform: String? = nil,
                contentStyle: String? = nil, minCandidates: Int? = nil,
                maxCandidates: Int? = nil, minScore: Double? = nil,
                percentile: Double? = nil, maxGeminiCandidates: Int? = nil,
                llmProvider: String? = nil) {
        self.feedVideoId = feedVideoId
        self.userId = userId
        self.aspectRatio = aspectRatio
        self.scoringMode = scoringMode
        self.includeAudio = includeAudio
        self.saferClips = saferClips
        self.targetPlatform = targetPlatform
        self.contentStyle = contentStyle
        self.minCandidates = minCandidates
        self.maxCandidates = maxCandidates
        self.minScore = minScore
        self.percentile = percentile
        self.maxGeminiCandidates = maxGeminiCandidates
        self.llmProvider = llmProvider
    }
}

// MARK: - Subscription / Billing

public struct SubscriptionResponse: Codable {
    public let plan: PlanInfo
    public let usage: UsageInfo
    public let hasStripeCustomer: Bool
}

public struct PlanInfo: Codable {
    public let id: String
    public let name: String
    public let limits: PlanLimits
    public let features: [String]
}

public struct PlanLimits: Codable {
    public let maxFeeds: Int
    public let maxClipsPerMonth: Int
    public let maxStorageGb: Int
    public let llmProviders: [String]
    public let autoGenerateClips: Bool
}

public struct UsageInfo: Codable {
    public let feeds: Int
    public let clipsThisMonth: Int
    public let costThisMonth: CostSummary
}

public struct CostSummary: Codable {
    public let totalUsd: Double
    public let eventCount: Int
}

// MARK: - LLM Provider

public struct LLMProviderResponse: Codable {
    public let llmProvider: String
}

public struct UpdateLLMProviderRequest: Codable {
    public let llmProvider: String

    public init(llmProvider: String) {
        self.llmProvider = llmProvider
    }
}

// MARK: - Pause Removal

public struct PauseRemovalRequest: Codable {
    public let estimatedPauseCount: Int

    public init(estimatedPauseCount: Int) {
        self.estimatedPauseCount = estimatedPauseCount
    }
}

public struct PauseRemovalTriggerResponse: Codable {
    public let ok: Bool
    public let jobId: String
}

public struct DetectedPause: Codable {
    public let start: Double
    public let end: Double
    public let duration: Double
    public let confidence: Double
}

public struct PauseRemovalJob: Identifiable, Codable {
    public let id: String
    public let status: String
    public let estimatedPauseCount: Int
    public let detectedPauses: [DetectedPause]?
    public let removedPauses: [DetectedPause]?
    public let resultS3Url: String?
    public let totalRemovedSeconds: Double?
    public let originalDurationS: Double?
    public let resultDurationS: Double?
    public let error: String?
    public let createdAt: String
}

public struct PauseRemovalJobsResponse: Codable {
    public let jobs: [PauseRemovalJob]
}

// MARK: - API Error

public struct APIErrorResponse: Codable {
    public let error: String
    public let code: String?
    public let limit: Int?
    public let usage: Int?
    public let allowedProviders: [String]?
}

// MARK: - Virality Settings (typed)

public struct ViralitySettings: Equatable {
    public var scoringMode: String
    public var targetPlatform: String
    public var contentStyle: String
    public var saferClips: Bool
    public var includeAudio: Bool
    public var llmProvider: String

    public init(scoringMode: String = "heuristic", targetPlatform: String = "all",
                contentStyle: String = "auto", saferClips: Bool = false,
                includeAudio: Bool = false, llmProvider: String = "ollama") {
        self.scoringMode = scoringMode
        self.targetPlatform = targetPlatform
        self.contentStyle = contentStyle
        self.saferClips = saferClips
        self.includeAudio = includeAudio
        self.llmProvider = llmProvider
    }

    public func toDictionary() -> [String: AnyCodable] {
        [
            "scoringMode": AnyCodable(scoringMode),
            "targetPlatform": AnyCodable(targetPlatform),
            "contentStyle": AnyCodable(contentStyle),
            "saferClips": AnyCodable(saferClips),
            "includeAudio": AnyCodable(includeAudio),
            "llmProvider": AnyCodable(llmProvider),
        ]
    }
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
