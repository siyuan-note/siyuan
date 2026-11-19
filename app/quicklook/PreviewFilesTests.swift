import Foundation

@main
struct PreviewFilesTests {
    static func main() throws {
        let manager = FileManager.default
        let root = manager.temporaryDirectory.appendingPathComponent("siyuan-quicklook-\(UUID().uuidString)")
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        let document = root.appendingPathComponent("文档 space #.md")
        let text = "# 文档\n\n| A | B |\n| - | - |\n| 一 | 二 |"
        for data in [Data(text.utf8), Data([0xEF, 0xBB, 0xBF]) + Data(text.utf8),
                     Data([0xFF, 0xFE]) + text.data(using: .utf16LittleEndian)!,
                     Data([0xFE, 0xFF]) + text.data(using: .utf16BigEndian)!] {
            try data.write(to: document)
            let actual = try PreviewFiles.document(document)
            precondition(actual == text)
        }
        func rejected(_ action: () throws -> Void) {
            do { try action(); fatalError("Expected rejection") } catch {}
        }
        try Data([0xFF, 0x00]).write(to: document)
        rejected { _ = try PreviewFiles.document(document) }
        try Data(repeating: 65, count: PreviewFiles.documentLimit + 1).write(to: document)
        rejected { _ = try PreviewFiles.document(document) }
        try Data(text.utf8).write(to: document)
        let image = root.appendingPathComponent("image.png")
        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=")!
        try png.write(to: image)
        let rawImage = try PreviewFiles.image("image.png", document: document).0
        let escapedImage = try PreviewFiles.image("image%2epng", document: document).0
        precondition(rawImage == png && escapedImage == png)
        for reference in ["../image.png", "%2e%2e/image.png", "/image.png", "file:///image.png", "https://example.com/image.png",
                          "image.svg", "image.png?x", "image.png#x", "image%00.png", "x\\image.png", "missing.png"] {
            rejected { _ = try PreviewFiles.image(reference, document: document) }
        }
        try manager.createSymbolicLink(at: root.appendingPathComponent("link.png"), withDestinationURL: image)
        rejected { _ = try PreviewFiles.image("link.png", document: document) }
        try manager.createSymbolicLink(at: root.appendingPathComponent("nested"), withDestinationURL: root)
        rejected { _ = try PreviewFiles.image("nested/image.png", document: document) }
        let token = PreviewCancellation()
        token.cancel()
        rejected { _ = try PreviewFiles.document(document, cancellation: token) }
        rejected { _ = try PreviewFiles.image("image.png", document: document, cancellation: token) }
        let original = try Data(contentsOf: document)
        precondition(original == Data(text.utf8))
        print("Quick Look native file, encoding, scope, symlink and cancellation cases passed")
    }
}
