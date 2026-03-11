import SwiftUI

public struct NewArticleView: View {
    @State private var title = ""
    @State private var isCreating = false
    @State private var errorMessage: String?
    @State private var showErrorAlert = false
    @Environment(\.dismiss) private var dismiss

    private let publicationId: String
    private let api: APIClient
    private let onCreated: (() -> Void)?

    public init(publicationId: String, api: APIClient, onCreated: (() -> Void)? = nil) {
        self.publicationId = publicationId
        self.api = api
        self.onCreated = onCreated
    }

    public var body: some View {
        Form {
            Section {
                TextField("Working Title", text: $title)
            } footer: {
                Text("You can change this later. AI generation can also suggest a better title.")
                    .font(.caption)
            }

            Section {
                Button {
                    Task { await create() }
                } label: {
                    HStack {
                        if isCreating {
                            ProgressView()
                                .tint(DesignTokens.textPrimary)
                        }
                        Text(isCreating ? "Creating..." : "Create Article")
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
            }
        }
        .scrollContentBackground(.hidden)
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("New Article")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: errorMessage) { showErrorAlert = $1 != nil }
        .alert("Error", isPresented: $showErrorAlert) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func create() async {
        isCreating = true
        defer { isCreating = false }
        do {
            _ = try await api.createArticle(
                CreateArticleRequest(
                    publicationId: publicationId,
                    title: title.trimmingCharacters(in: .whitespaces)
                )
            )
            onCreated?()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
