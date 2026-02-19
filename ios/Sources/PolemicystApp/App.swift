import SwiftUI
import PolemicystiOS

@main
struct PolemicystApp: App {
    private let apiClient = APIClient(baseURL: URL(string: "http://127.0.0.1:3000")!)
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
