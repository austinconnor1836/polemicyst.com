import Foundation

public enum MockData {

    // MARK: - Feeds (Connected Accounts)

    public static let feeds: [VideoFeed] = [
        VideoFeed(
            id: "feed-1",
            name: "CNN Politics",
            sourceUrl: "https://www.youtube.com/@CNNPolitics",
            pollingInterval: 60,
            sourceType: "youtube",
            userId: "user-1",
            autoGenerateClips: true,
            createdAt: Date().addingTimeInterval(-86400 * 3),
            youtubeChannelThumb: "https://yt3.googleusercontent.com/example1"
        ),
        VideoFeed(
            id: "feed-2",
            name: "C-SPAN",
            sourceUrl: "https://www.youtube.com/@cspan",
            pollingInterval: 120,
            sourceType: "cspan",
            userId: "user-1",
            autoGenerateClips: false,
            createdAt: Date().addingTimeInterval(-86400 * 7)
        ),
        VideoFeed(
            id: "feed-3",
            name: "TED Talks",
            sourceUrl: "https://www.youtube.com/@TED",
            pollingInterval: 60,
            sourceType: "youtube",
            userId: "user-1",
            autoGenerateClips: true,
            createdAt: Date().addingTimeInterval(-86400 * 14),
            youtubeChannelThumb: "https://yt3.googleusercontent.com/example3"
        ),
    ]

    // MARK: - Subscription

    public static let subscription = SubscriptionResponse(
        plan: PlanInfo(
            id: "pro",
            name: "Pro",
            limits: PlanLimits(
                maxConnectedAccounts: 10,
                maxClipsPerMonth: 100,
                maxStorageGb: 50,
                llmProviders: ["ollama", "gemini"],
                autoGenerateClips: true
            ),
            features: ["Unlimited feeds", "Gemini scoring", "Auto-generate clips"]
        ),
        usage: UsageInfo(
            feeds: 3,
            clipsThisMonth: 27,
            costThisMonth: CostSummary(totalUsd: 1.42, eventCount: 54)
        ),
        hasStripeCustomer: true
    )

    // MARK: - Feed Videos

    public static let feedVideos: [FeedVideo] = [
        FeedVideo(
            id: "fv-1",
            feedId: "feed-1",
            videoId: "dQw4w9WgXcQ",
            title: "Breaking: Senate Passes Infrastructure Bill in Late-Night Vote",
            transcript: "The Senate voted 68-29 to pass a sweeping infrastructure package that includes funding for roads, bridges, broadband internet, and electric vehicle charging stations...",
            s3Url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            createdAt: Date().addingTimeInterval(-3600),
            feed: feeds[0]
        ),
        FeedVideo(
            id: "fv-2",
            feedId: "feed-2",
            videoId: "abc123def45",
            title: "House Judiciary Committee Hearing on AI Regulation",
            transcript: "Today we examine the rapid advancement of artificial intelligence and its implications for American workers, national security, and civil liberties...",
            s3Url: "https://www.youtube.com/watch?v=abc123def45",
            createdAt: Date().addingTimeInterval(-7200),
            feed: feeds[1]
        ),
        FeedVideo(
            id: "fv-3",
            feedId: "feed-3",
            videoId: "xyz789ghi01",
            title: "The Future of Renewable Energy — TED Talk",
            transcript: "What if I told you that by 2035, 90% of the world's electricity could come from renewable sources? The technology exists today...",
            s3Url: "https://www.youtube.com/watch?v=xyz789ghi01",
            createdAt: Date().addingTimeInterval(-86400),
            feed: feeds[2]
        ),
        FeedVideo(
            id: "fv-4",
            feedId: "feed-1",
            videoId: "qrs456tuv78",
            title: "White House Press Briefing — Economic Policy Update",
            transcript: "Good afternoon everyone. Today I'd like to start with an update on the economic indicators we've been tracking...",
            s3Url: "https://www.youtube.com/watch?v=qrs456tuv78",
            createdAt: Date().addingTimeInterval(-86400 * 2),
            feed: feeds[0]
        ),
    ]

    // MARK: - Clips

    public static let clips: [ClipVideo] = [
        ClipVideo(
            id: "clip-1",
            userId: "user-1",
            sourceVideoId: "fv-1",
            s3Key: "clips/clip-1.mp4",
            s3Url: "https://example.com/clips/clip-1.mp4",
            videoTitle: "Senate Infrastructure Bill — Key Moment",
            createdAt: Date().addingTimeInterval(-1800),
            sourceVideo: ClipSourceVideo(id: "fv-1", videoTitle: "Senate Passes Infrastructure Bill")
        ),
        ClipVideo(
            id: "clip-2",
            userId: "user-1",
            sourceVideoId: "fv-2",
            s3Key: "clips/clip-2.mp4",
            s3Url: "https://example.com/clips/clip-2.mp4",
            videoTitle: "AI Regulation Hearing — Opening Statement",
            createdAt: Date().addingTimeInterval(-3600 * 2),
            sourceVideo: ClipSourceVideo(id: "fv-2", videoTitle: "House Judiciary AI Hearing")
        ),
        ClipVideo(
            id: "clip-3",
            userId: "user-1",
            sourceVideoId: "fv-3",
            s3Key: "clips/clip-3.mp4",
            s3Url: "https://example.com/clips/clip-3.mp4",
            videoTitle: "Renewable Energy — The 2035 Prediction",
            createdAt: Date().addingTimeInterval(-86400),
            sourceVideo: ClipSourceVideo(id: "fv-3", videoTitle: "The Future of Renewable Energy")
        ),
        ClipVideo(
            id: "clip-4",
            userId: "user-1",
            sourceVideoId: "fv-4",
            s3Key: "clips/clip-4.mp4",
            s3Url: "https://example.com/clips/clip-4.mp4",
            videoTitle: "Economic Policy — Key Takeaway",
            createdAt: Date().addingTimeInterval(-86400 * 2),
            sourceVideo: ClipSourceVideo(id: "fv-4", videoTitle: "White House Press Briefing")
        ),
        ClipVideo(
            id: "clip-5",
            userId: "user-1",
            sourceVideoId: "fv-1",
            s3Key: "clips/clip-5.mp4",
            s3Url: "https://example.com/clips/clip-5.mp4",
            videoTitle: "Infrastructure Vote — The Decisive Moment",
            createdAt: Date().addingTimeInterval(-86400 * 3),
            sourceVideo: ClipSourceVideo(id: "fv-1", videoTitle: "Senate Passes Infrastructure Bill")
        ),
    ]

    // MARK: - Publications

    public static let publications: [Publication] = [
        Publication(
            id: "pub-1",
            name: "Capitol Dispatch",
            tagline: "Daily political analysis",
            configMarkdown: "# Capitol Dispatch\nA daily newsletter covering U.S. politics.",
            isDefault: true,
            substackUrl: nil,
            substackConnected: false,
            createdAt: Date().addingTimeInterval(-86400 * 30),
            updatedAt: Date().addingTimeInterval(-86400),
            _count: PublicationCount(articles: 12)
        ),
        Publication(
            id: "pub-2",
            name: "Tech & Policy",
            tagline: "Where technology meets regulation",
            configMarkdown: "# Tech & Policy\nExploring the intersection of technology and government.",
            isDefault: false,
            substackUrl: nil,
            substackConnected: false,
            createdAt: Date().addingTimeInterval(-86400 * 14),
            updatedAt: Date().addingTimeInterval(-86400 * 2),
            _count: PublicationCount(articles: 5)
        ),
    ]
}
