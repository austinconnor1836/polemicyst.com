import SwiftUI

@MainActor
public final class SubscriptionViewModel: ObservableObject {
    @Published public private(set) var subscription: SubscriptionResponse?
    @Published public var isLoading = false
    @Published public var errorMessage: String?

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            subscription = try await api.fetchSubscription()
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to load subscription"
        }
    }
}

public struct SubscriptionView: View {
    @StateObject private var viewModel: SubscriptionViewModel

    public init(viewModel: SubscriptionViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                if viewModel.isLoading && viewModel.subscription == nil {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let sub = viewModel.subscription {
                    VStack(spacing: DesignTokens.largeSpacing) {
                        planCard(sub.plan)
                        usageCard(sub)
                        featuresCard(sub.plan)
                    }
                    .padding()
                } else if let error = viewModel.errorMessage {
                    VStack(spacing: DesignTokens.spacing) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundStyle(DesignTokens.muted)
                        Text(error)
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Subscription")
            .task { await viewModel.load() }
            .refreshable { await viewModel.load() }
        }
    }

    @ViewBuilder
    private func planCard(_ plan: PlanInfo) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Current Plan")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textSecondary)
                    Text(plan.name)
                        .font(.title).bold()
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                Spacer()
                Image(systemName: planIcon(plan.id))
                    .font(.title)
                    .foregroundStyle(DesignTokens.accent)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private func usageCard(_ sub: SubscriptionResponse) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Usage This Month")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            QuotaBar(
                label: "Feeds",
                current: sub.usage.feeds,
                maximum: sub.plan.limits.maxFeeds
            )

            QuotaBar(
                label: "Clips",
                current: sub.usage.clipsThisMonth,
                maximum: sub.plan.limits.maxClipsPerMonth
            )

            HStack {
                Text("Cost this month")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
                Spacer()
                Text(String(format: "$%.4f", sub.usage.costThisMonth.totalUsd))
                    .font(.caption).bold()
                    .foregroundStyle(DesignTokens.textPrimary)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private func featuresCard(_ plan: PlanInfo) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Plan Features")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            ForEach(plan.features, id: \.self) { feature in
                HStack(spacing: DesignTokens.smallSpacing) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(DesignTokens.accent)
                        .font(.caption)
                    Text(feature)
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }

            if plan.id == "free" || plan.id == "pro" {
                Text("Upgrade to unlock more features")
                    .font(.footnote)
                    .foregroundStyle(DesignTokens.muted)
                    .padding(.top, DesignTokens.smallSpacing)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private func planIcon(_ planId: String) -> String {
        switch planId {
        case "pro": return "star.fill"
        case "business": return "briefcase.fill"
        default: return "person.fill"
        }
    }
}
