import SwiftUI

struct CompositionLayoutSection: View {
    @Binding var selectedLayouts: Set<String>

    private let allLayouts: [(id: String, label: String, icon: String)] = [
        ("mobile", "Mobile (9:16)", "rectangle.portrait"),
        ("landscape", "Landscape (16:9)", "rectangle"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Render Layouts")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            ForEach(allLayouts, id: \.id) { layout in
                Button {
                    toggleLayout(layout.id)
                } label: {
                    HStack {
                        Image(systemName: layout.icon)
                            .font(.subheadline)
                            .frame(width: 24)

                        Text(layout.label)
                            .font(.subheadline)

                        Spacer()

                        Image(systemName: selectedLayouts.contains(layout.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selectedLayouts.contains(layout.id) ? DesignTokens.accent : DesignTokens.muted)
                    }
                    .padding(.vertical, 6)
                    .foregroundStyle(DesignTokens.textPrimary)
                }
            }

            if selectedLayouts.isEmpty {
                Text("Select at least one layout to render")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private func toggleLayout(_ id: String) {
        if selectedLayouts.contains(id) {
            if selectedLayouts.count > 1 { selectedLayouts.remove(id) }
        } else {
            selectedLayouts.insert(id)
        }
    }
}
