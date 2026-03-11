import Foundation

// MARK: - Version Check

public struct VersionCheckResponse: Codable {
    public let updateRequired: Bool
    public let minimumVersion: String
    public let latestVersion: String
    public let storeUrl: String
}

// MARK: - Brands

public struct Brand: Identifiable, Codable {
    public let id: String
    public let name: String
    public let imageUrl: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let _count: BrandCount?

    enum CodingKeys: String, CodingKey {
        case id, name, imageUrl, createdAt, updatedAt, _count
    }
}

public struct BrandCount: Codable {
    public let videoFeeds: Int
}

public struct CreateBrandRequest: Encodable {
    public let name: String
    public let imageUrl: String?

    public init(name: String, imageUrl: String? = nil) {
        self.name = name
        self.imageUrl = imageUrl
    }
}

public struct UpdateBrandRequest: Encodable {
    public let name: String?
    public let imageUrl: String?

    public init(name: String? = nil, imageUrl: String? = nil) {
        self.name = name
        self.imageUrl = imageUrl
    }
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
    public let youtubeChannelThumb: String?
    public let brandId: String?
    public let brand: Brand?

    enum CodingKeys: String, CodingKey {
        case id, name, sourceUrl, pollingInterval, sourceType, userId
        case autoGenerateClips, viralitySettings, createdAt, youtubeChannelThumb
        case brandId, brand
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        sourceUrl = try c.decode(String.self, forKey: .sourceUrl)
        pollingInterval = try c.decode(Int.self, forKey: .pollingInterval)
        sourceType = try c.decode(String.self, forKey: .sourceType)
        userId = try c.decode(String.self, forKey: .userId)
        autoGenerateClips = try c.decode(Bool.self, forKey: .autoGenerateClips)
        viralitySettings = try c.decodeIfPresent([String: AnyCodable].self, forKey: .viralitySettings)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        youtubeChannelThumb = try c.decodeIfPresent(String.self, forKey: .youtubeChannelThumb)
        brandId = try c.decodeIfPresent(String.self, forKey: .brandId)
        brand = try c.decodeIfPresent(Brand.self, forKey: .brand)
    }

    public init(id: String, name: String, sourceUrl: String, pollingInterval: Int,
                sourceType: String, userId: String, autoGenerateClips: Bool,
                viralitySettings: [String: AnyCodable]? = nil, createdAt: Date,
                youtubeChannelThumb: String? = nil, brandId: String? = nil, brand: Brand? = nil) {
        self.id = id
        self.name = name
        self.sourceUrl = sourceUrl
        self.pollingInterval = pollingInterval
        self.sourceType = sourceType
        self.userId = userId
        self.autoGenerateClips = autoGenerateClips
        self.viralitySettings = viralitySettings
        self.createdAt = createdAt
        self.youtubeChannelThumb = youtubeChannelThumb
        self.brandId = brandId
        self.brand = brand
    }
}

// MARK: - Feed Videos

public struct FeedVideo: Identifiable, Codable {
    public let id: String
    public let feedId: String
    public let videoId: String?
    public let title: String?
    public let thumbnailUrl: String?
    public let transcript: String?
    public let s3Url: String?
    public let createdAt: Date
    public let feed: VideoFeed?

    /// Returns the best available thumbnail URL.
    /// Prefers the stored `thumbnailUrl`, falls back to YouTube thumbnail if applicable.
    public var resolvedThumbnailUrl: URL? {
        if let stored = thumbnailUrl, let url = URL(string: stored) {
            return url
        }
        // Fall back to YouTube thumbnail
        if let ytId = youtubeVideoId {
            return URL(string: "https://img.youtube.com/vi/\(ytId)/hqdefault.jpg")
        }
        return nil
    }

    /// Extracts YouTube video ID from s3Url, thumbnailUrl, or videoId field.
    public var youtubeVideoId: String? {
        if let s3 = s3Url, let id = Self.extractYouTubeId(from: s3) {
            return id
        }
        if let thumb = thumbnailUrl, let id = Self.extractYouTubeIdFromThumbnail(thumb) {
            return id
        }
        if feed?.sourceType == "youtube", let vid = videoId, !vid.isEmpty {
            return vid
        }
        return nil
    }

    static func extractYouTubeId(from url: String) -> String? {
        let pattern = #"(?:youtube\.com\/watch\?[^#]*[?&]v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)),
              let range = Range(match.range(at: 1), in: url) else {
            return nil
        }
        return String(url[range])
    }

    static func extractYouTubeIdFromThumbnail(_ url: String) -> String? {
        // Matches https://img.youtube.com/vi/{videoId}/...
        let pattern = #"img\.youtube\.com\/vi\/([A-Za-z0-9_-]{6,})"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)),
              let range = Range(match.range(at: 1), in: url) else {
            return nil
        }
        return String(url[range])
    }

    public init(id: String, feedId: String, videoId: String? = nil, title: String? = nil,
                thumbnailUrl: String? = nil, transcript: String? = nil,
                s3Url: String? = nil, createdAt: Date, feed: VideoFeed? = nil) {
        self.id = id
        self.feedId = feedId
        self.videoId = videoId
        self.title = title
        self.thumbnailUrl = thumbnailUrl
        self.transcript = transcript
        self.s3Url = s3Url
        self.createdAt = createdAt
        self.feed = feed
    }
}

// MARK: - Feed Video Detail (clips endpoint)

public struct FeedVideoDetailResponse: Codable {
    public let feedVideo: FeedVideoDetail
    public let jobState: String?
    public let jobMeta: JobMeta?
    public let clips: [GeneratedClip]
}

public struct FeedVideoDetail: Codable {
    public let id: String
    public let userId: String
    public let videoId: String?
    public let title: String?
    public let s3Url: String?
    public let thumbnailUrl: String?
    public let createdAt: Date
    public let feed: FeedVideoDetailFeed?
    public let clipSourceVideoId: String?
    public let transcript: String?
    public let transcriptSource: String?
    public let clipSourceVideo: ClipSourceVideoDetail?

    /// Returns the best available thumbnail URL.
    public var resolvedThumbnailUrl: URL? {
        if let stored = thumbnailUrl, let url = URL(string: stored) {
            return url
        }
        if let ytId = youtubeVideoId {
            return URL(string: "https://img.youtube.com/vi/\(ytId)/hqdefault.jpg")
        }
        return nil
    }

    public var youtubeVideoId: String? {
        if let s3 = s3Url, let id = FeedVideo.extractYouTubeId(from: s3) {
            return id
        }
        if let thumb = thumbnailUrl, let id = FeedVideo.extractYouTubeIdFromThumbnail(thumb) {
            return id
        }
        if feed?.sourceType == "youtube", let vid = videoId, !vid.isEmpty {
            return vid
        }
        return nil
    }
}

public struct FeedVideoDetailFeed: Codable {
    public let id: String
    public let name: String
    public let sourceType: String
}

public struct ClipSourceVideoDetail: Codable {
    public let id: String
    public let videoTitle: String?
    public let s3Url: String?
    public let createdAt: Date
    public let generatedClips: [GeneratedClip]
}

public struct GeneratedClip: Identifiable, Codable {
    public let id: String
    public let videoTitle: String?
    public let sharedDescription: String?
    public let s3Url: String?
    public let s3Key: String?
    public let trimStartS: Double
    public let trimEndS: Double
    public let createdAt: Date

    public var duration: Double {
        trimEndS - trimStartS
    }
}

public struct JobMeta: Codable {
    public let enqueuedAt: Double?
    public let startedAt: Double?
    public let finishedAt: Double?
}

// MARK: - Clips

public struct ClipSourceVideo: Codable {
    public let id: String
    public let videoTitle: String?
    public let s3Url: String?

    public init(id: String, videoTitle: String? = nil, s3Url: String? = nil) {
        self.id = id
        self.videoTitle = videoTitle
        self.s3Url = s3Url
    }
}

public struct ClipVideo: Identifiable, Codable {
    public let id: String
    public let userId: String
    public let sourceVideoId: String?
    public let s3Key: String?
    public let s3Url: String?
    public let videoTitle: String?
    public let trimStartS: Double?
    public let trimEndS: Double?
    public let createdAt: Date
    public let sourceVideo: ClipSourceVideo?

    public var duration: Double? {
        guard let start = trimStartS, let end = trimEndS else { return nil }
        return end - start
    }

    public init(id: String, userId: String, sourceVideoId: String? = nil,
                s3Key: String? = nil, s3Url: String? = nil, videoTitle: String? = nil,
                trimStartS: Double? = nil, trimEndS: Double? = nil,
                createdAt: Date, sourceVideo: ClipSourceVideo? = nil) {
        self.id = id
        self.userId = userId
        self.sourceVideoId = sourceVideoId
        self.s3Key = s3Key
        self.s3Url = s3Url
        self.videoTitle = videoTitle
        self.trimStartS = trimStartS
        self.trimEndS = trimEndS
        self.createdAt = createdAt
        self.sourceVideo = sourceVideo
    }
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

// MARK: - Upload / Import

public struct ImportFromURLRequest: Codable {
    public let url: String
    public let filename: String?

    public init(url: String, filename: String? = nil) {
        self.url = url
        self.filename = filename
    }
}

public struct PresignedUploadRequest: Codable {
    public let filename: String
    public let contentType: String

    public init(filename: String, contentType: String = "video/mp4") {
        self.filename = filename
        self.contentType = contentType
    }
}

public struct PresignedUploadResponse: Codable {
    public let url: String
    public let key: String
}

public struct CompleteUploadRequest: Codable {
    public let key: String
    public let filename: String

    public init(key: String, filename: String) {
        self.key = key
        self.filename = filename
    }
}

// MARK: - Subscription / Billing

public struct SubscriptionResponse: Codable {
    public let plan: PlanInfo
    public let usage: UsageInfo
    public let hasStripeCustomer: Bool

    public init(plan: PlanInfo, usage: UsageInfo, hasStripeCustomer: Bool) {
        self.plan = plan
        self.usage = usage
        self.hasStripeCustomer = hasStripeCustomer
    }
}

public struct PlanInfo: Codable {
    public let id: String
    public let name: String
    public let limits: PlanLimits
    public let features: [String]

    public init(id: String, name: String, limits: PlanLimits, features: [String]) {
        self.id = id
        self.name = name
        self.limits = limits
        self.features = features
    }
}

public struct PlanLimits: Codable {
    public let maxConnectedAccounts: Int
    public let maxClipsPerMonth: Int
    public let maxStorageGb: Int
    public let llmProviders: [String]
    public let autoGenerateClips: Bool

    public init(maxConnectedAccounts: Int, maxClipsPerMonth: Int, maxStorageGb: Int,
                llmProviders: [String], autoGenerateClips: Bool) {
        self.maxConnectedAccounts = maxConnectedAccounts
        self.maxClipsPerMonth = maxClipsPerMonth
        self.maxStorageGb = maxStorageGb
        self.llmProviders = llmProviders
        self.autoGenerateClips = autoGenerateClips
    }
}

public struct UsageInfo: Codable {
    public let feeds: Int
    public let clipsThisMonth: Int
    public let costThisMonth: CostSummary

    public init(feeds: Int, clipsThisMonth: Int, costThisMonth: CostSummary) {
        self.feeds = feeds
        self.clipsThisMonth = clipsThisMonth
        self.costThisMonth = costThisMonth
    }
}

public struct CostSummary: Codable {
    public let totalUsd: Double
    public let eventCount: Int

    public init(totalUsd: Double, eventCount: Int) {
        self.totalUsd = totalUsd
        self.eventCount = eventCount
    }
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

// MARK: - YouTube Channel

public struct YouTubeChannel: Identifiable, Codable {
    public let id: String
    public let title: String
    public let thumbnail: String
    public let subscriberCount: String?
}

public struct CreateFromYouTubeRequest: Encodable {
    public let channelId: String
    public let channelTitle: String
    public let channelThumbnail: String?
    public let pollingInterval: Int
    public let autoGenerateClips: Bool
    public let viralitySettings: [String: AnyCodable]?

    public init(channelId: String, channelTitle: String, channelThumbnail: String? = nil,
                pollingInterval: Int = 60, autoGenerateClips: Bool = false,
                viralitySettings: [String: AnyCodable]? = nil) {
        self.channelId = channelId
        self.channelTitle = channelTitle
        self.channelThumbnail = channelThumbnail
        self.pollingInterval = pollingInterval
        self.autoGenerateClips = autoGenerateClips
        self.viralitySettings = viralitySettings
    }
}

// MARK: - Automation Settings

public struct AutomationSettings: Codable {
    public var enabled: Bool
    public var autoGenerateClips: Bool
    public var viralitySettings: ViralitySettings
    public var captionsEnabled: Bool
    public var captionStyle: String
    public var aspectRatio: String
    public var autoPublish: Bool
    public var publishPlatforms: [String]

    public init(
        enabled: Bool = false,
        autoGenerateClips: Bool = true,
        viralitySettings: ViralitySettings = ViralitySettings(),
        captionsEnabled: Bool = true,
        captionStyle: String = "default",
        aspectRatio: String = "9:16",
        autoPublish: Bool = false,
        publishPlatforms: [String] = []
    ) {
        self.enabled = enabled
        self.autoGenerateClips = autoGenerateClips
        self.viralitySettings = viralitySettings
        self.captionsEnabled = captionsEnabled
        self.captionStyle = captionStyle
        self.aspectRatio = aspectRatio
        self.autoPublish = autoPublish
        self.publishPlatforms = publishPlatforms
    }

    enum CodingKeys: String, CodingKey {
        case enabled, autoGenerateClips, viralitySettings, captionsEnabled
        case captionStyle, aspectRatio, autoPublish, publishPlatforms
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try c.decode(Bool.self, forKey: .enabled)
        autoGenerateClips = try c.decode(Bool.self, forKey: .autoGenerateClips)
        captionsEnabled = try c.decode(Bool.self, forKey: .captionsEnabled)
        captionStyle = try c.decode(String.self, forKey: .captionStyle)
        aspectRatio = try c.decode(String.self, forKey: .aspectRatio)
        autoPublish = try c.decode(Bool.self, forKey: .autoPublish)
        publishPlatforms = (try? c.decode([String].self, forKey: .publishPlatforms)) ?? []

        // Decode viralitySettings from [String: AnyCodable] dictionary
        if let dict = try? c.decode([String: AnyCodable].self, forKey: .viralitySettings) {
            viralitySettings = ViralitySettings(
                scoringMode: (dict["scoringMode"]?.value as? String) ?? "heuristic",
                targetPlatform: (dict["targetPlatform"]?.value as? String) ?? "all",
                contentStyle: (dict["contentStyle"]?.value as? String) ?? "auto",
                saferClips: (dict["saferClips"]?.value as? Bool) ?? false,
                includeAudio: (dict["includeAudio"]?.value as? Bool) ?? false,
                llmProvider: (dict["llmProvider"]?.value as? String) ?? "ollama"
            )
        } else {
            viralitySettings = ViralitySettings()
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(enabled, forKey: .enabled)
        try c.encode(autoGenerateClips, forKey: .autoGenerateClips)
        try c.encode(captionsEnabled, forKey: .captionsEnabled)
        try c.encode(captionStyle, forKey: .captionStyle)
        try c.encode(aspectRatio, forKey: .aspectRatio)
        try c.encode(autoPublish, forKey: .autoPublish)
        try c.encode(publishPlatforms, forKey: .publishPlatforms)
        try c.encode(viralitySettings.toDictionary(), forKey: .viralitySettings)
    }
}

// MARK: - Truth Analysis

public struct TruthAnalysisRequest: Encodable {
    public let clipId: String?
    public let provider: String

    public init(clipId: String? = nil, provider: String = "gemini") {
        self.clipId = clipId
        self.provider = provider
    }
}

public struct TruthAnalysisResponse: Codable {
    public let ok: Bool?
    public let status: String?
    public let result: TruthAnalysisResult?
    // GET returns flat fields
    public let id: String?
    public let feedVideoId: String?
    public let error: String?
}

public struct TruthAnalysisResult: Codable {
    public let summary: String
    public let assertions: [TruthAssertion]
    public let fallacies: [TruthFallacy]
    public let biases: [TruthBias]
    public let overallCredibility: Double
    public let overallBiasLevel: String
    public let keyAssumptions: [String]
    public let recommendedFactChecks: [String]
}

public struct TruthAssertion: Identifiable, Codable {
    public let id: Int
    public let text: String
    public let category: String
    public let confidence: Double
    public let factCheckNeeded: Bool
    public let factCheckReason: String?
}

public struct TruthFallacy: Identifiable, Codable {
    public let id: Int
    public let name: String
    public let description: String
    public let assertionIds: [Int]
    public let severity: String
    public let confidence: Double
}

public struct TruthBias: Identifiable, Codable {
    public let id: Int
    public let type: String
    public let description: String
    public let direction: String?
    public let evidence: String
    public let confidence: Double
}

// MARK: - Analysis Chat

public struct AnalysisChatResponse: Codable {
    public let chat: AnalysisChatData?
    public let analysis: TruthAnalysisResult?
}

public struct AnalysisChatData: Codable {
    public let id: String
    public let messages: [AnalysisChatMessage]
}

public struct AnalysisChatMessage: Identifiable, Codable {
    public let id: String
    public let role: String
    public let content: String
    public let createdAt: Date?
}

public struct AnalysisChatSendRequest: Encodable {
    public let message: String
    public let clipId: String?

    public init(message: String, clipId: String? = nil) {
        self.message = message
        self.clipId = clipId
    }
}

public struct AnalysisChatSendResponse: Codable {
    public let ok: Bool
    public let message: AnalysisChatSendMessage
}

public struct AnalysisChatSendMessage: Codable {
    public let role: String
    public let content: String
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
