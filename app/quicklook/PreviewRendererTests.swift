import Foundation

@main
struct PreviewRendererTests {
    static func main() throws {
        let manager = FileManager.default
        let resources = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let directory = manager.temporaryDirectory.appendingPathComponent("siyuan-preview-\(UUID())")
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: directory) }
        let document = directory.appendingPathComponent("Markdown # 中文.md")
        let text = """
        # 中文

        $E=mc^2$

        ```js
        const value = 1;
        ```

        ![included](image.png)

        ![remote](https://example.invalid/remote.png)
        """
        try Data(text.utf8).write(to: document)
        let image = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkX0AAAAASUVORK5CYII=")!
        try image.write(to: directory.appendingPathComponent("image.png"))
        let renderer = PreviewRenderer(root: resources, messages: ["resource": "Image unavailable", "limit": "Limit"])
        let preview = try renderer.render(document, cancellation: PreviewCancellation())
        precondition(preview.html.contains("<h1>中文</h1>"))
        precondition(preview.html.contains("class=\"katex\""))
        precondition(preview.html.contains("class=\"hljs\""))
        precondition(preview.html.contains("cid:image-1"))
        precondition(preview.html.contains("Image unavailable"))
        precondition(preview.html.contains("img-src cid:; font-src cid:"))
        precondition(!preview.html.contains("example.invalid") && !preview.html.contains("<script"))
        precondition(preview.attachments["image-1"]?.0 == image)
        precondition(preview.attachments["KaTeX_Main-Regular.woff2"]?.1 == "font/woff2")
        print("Quick Look JavaScriptCore rendering, HTML restrictions and attachments passed")
    }
}
