import Foundation
import JavaScriptCore

struct PreviewContent: Sendable {
    let html: String
    let attachments: [String: (Data, String)]
}

struct PreviewRenderer: Sendable {
    private enum RenderingError: Error { case unavailable }

    struct Resources: Decodable {
        let scripts: [String]
        let fonts: [String: String]
    }

    private static let bootstrap = """
    var window = globalThis;
    var console = {log() {}, warn() {}, error() {}};
    var performance = {now: () => Date.now()};
    var setTimeout = () => 0;
    var clearTimeout = () => {};
    class TextEncoder {
        encode(value) { return Uint8Array.from(unescape(encodeURIComponent(value)), c => c.charCodeAt(0)); }
    }
    class TextDecoder {
        decode(bytes) { return decodeURIComponent(escape(Array.from(bytes, c => String.fromCharCode(c)).join(""))); }
    }
    """
    let root: URL
    let messages: [String: String]

    static func message(_ key: String, _ messages: [String: String]) -> String {
        messages[key] ?? messages["failed"] ?? "Markdown preview unavailable"
    }

    static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    static func page(body: String, styles: String = "") -> String {
        """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src cid:; font-src cid:; base-uri 'none'; form-action 'none'">
        <style>\(styles)</style></head><body>\(body)</body></html>
        """
    }

    func render(_ url: URL, cancellation: PreviewCancellation) throws -> PreviewContent {
        let markdown = try PreviewFiles.document(url, cancellation: cancellation)
        let resources = try JSONDecoder().decode(Resources.self, from: Data(contentsOf: root.appendingPathComponent("resources.json")))
        guard let context = JSContext() else { throw RenderingError.unavailable }
        context.evaluateScript(Self.bootstrap)
        for script in resources.scripts {
            try cancellation.check()
            let file = root.appendingPathComponent(script)
            context.evaluateScript(try String(contentsOf: file, encoding: .utf8), withSourceURL: file)
            guard context.exception == nil else { throw RenderingError.unavailable }
        }

        var images: [String: (Data, String)] = [:]
        var imageBytes = 0
        let readImage: @convention(block) (String) -> String? = { reference in
            guard imageBytes < PreviewFiles.imageTotalLimit,
                  let image = try? PreviewFiles.image(reference, document: url, cancellation: cancellation),
                  image.0.count <= PreviewFiles.imageTotalLimit - imageBytes else { return nil }
            let id = "image-\(images.count + 1)"
            images[id] = image
            imageBytes += image.0.count
            return id
        }
        let active: @convention(block) () -> Bool = { (try? cancellation.check()) != nil }
        let render = context.objectForKeyedSubscript("quickLookRender")
        let result = render?.call(withArguments: [markdown, messages, readImage, active])
        try cancellation.check()
        if result?.forProperty("error")?.toString() == "limit" { throw PreviewFileError.limit }
        guard context.exception == nil, let result = result, result.isObject,
              let body = result.forProperty("html"), body.isString, let html = body.toString(),
              let warning = result.forProperty("warning"), warning.isString, let warningText = warning.toString() else {
            throw RenderingError.unavailable
        }

        let snapshot = PreviewFonts.load(cancellation: cancellation)
        try cancellation.check()
        let styles = try String(contentsOf: root.appendingPathComponent("preview.css"), encoding: .utf8)
        var attachments = images
        if html.contains("class=\"katex") {
            for (name, path) in resources.fonts {
                try cancellation.check()
                attachments[name] = (try Data(contentsOf: root.appendingPathComponent(path)), "font/woff2")
            }
        }
        attachments.merge(snapshot.resources) { original, _ in original }
        let article = "<div class=\"markdown-editor\"><article class=\"vditor-reset\">\(html)</article></div>"
        let notice = "<p class=\"quicklook-warning\" role=\"status\">\(warningText)</p>"
        return PreviewContent(html: Self.page(body: article + notice, styles: styles + snapshot.css), attachments: attachments)
    }
}
