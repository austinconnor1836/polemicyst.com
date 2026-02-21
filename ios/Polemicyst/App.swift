import SwiftUI

@main
struct PolemicystApp: App {
    private let apiClient: APIClient = {
        #if DEBUG
        APIClient(baseURL: URL(string: "http://127.0.0.1:3000")!)
        #else
        APIClient(baseURL: URL(string: "https://polemicyst.com")!)
        #endif
    }()

    @State private var tabSelection = 0

    var body: some Scene {
        WindowGroup {
            TabView(selection: $tabSelection) {
                HomeView(selection: $tabSelection)
                    .tabItem {
                        Label("Home", systemImage: "house.fill")
                    }
                    .tag(0)

                FeedVideosView(viewModel: FeedVideosViewModel(api: apiClient))
                    .tabItem {
                        Label("Feed Videos", systemImage: "list.bullet")
                    }
                    .tag(1)
            }
        }
    }
}
