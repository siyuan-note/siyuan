import Cocoa
import QuickLookUI
import UniformTypeIdentifiers

private final class PreviewRequest: @unchecked Sendable {
    let cancellation = PreviewCancellation()
    private let lock = NSLock()
    private var continuation: CheckedContinuation<PreviewContent, Error>?
    private var result: Result<PreviewContent, Error>?

    func wait(_ continuation: CheckedContinuation<PreviewContent, Error>) {
        lock.lock()
        if let result = result {
            lock.unlock()
            continuation.resume(with: result)
        } else {
            self.continuation = continuation
            lock.unlock()
        }
    }

    func finish(_ result: Result<PreviewContent, Error>) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        let continuation = self.continuation
        self.continuation = nil
        self.result = result
        lock.unlock()
        continuation?.resume(with: result)
    }

    func cancel() {
        cancellation.cancel()
        finish(.failure(CancellationError()))
    }
}

@objc(PreviewProvider)
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    private static let rendererQueue = DispatchQueue(label: "org.b3log.siyuan.quicklook.preview", qos: .userInitiated)

    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        guard let root = Bundle(for: Self.self).resourceURL?.appendingPathComponent("Preview") else {
            throw PreviewFileError.unavailable
        }
        let renderer = PreviewRenderer(root: root, messages: Self.translations(root))
        let job = PreviewRequest()
        let url = request.fileURL
        let timeout = DispatchWorkItem {
            job.cancellation.cancel()
            job.finish(.success(Self.notice("timeout", renderer.messages)))
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 15, execute: timeout)
        defer { timeout.cancel() }
        Self.rendererQueue.async {
            let content: PreviewContent
            do {
                try job.cancellation.check()
                content = try renderer.render(url, cancellation: job.cancellation)
            } catch {
                guard (try? job.cancellation.check()) != nil else { return }
                let key: String
                switch error {
                case PreviewFileError.limit: key = "limit"
                case PreviewFileError.encoding: key = "encoding"
                case PreviewFileError.unavailable: key = "file"
                default: key = "failed"
                }
                content = Self.notice(key, renderer.messages)
            }
            job.finish(.success(content))
        }
        let content = try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { job.wait($0) }
        }, onCancel: { job.cancel() })
        try Task.checkCancellation()
        return QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 1040, height: 760)) { reply in
            reply.stringEncoding = .utf8
            reply.attachments = content.attachments.mapValues { data, mime in
                QLPreviewReplyAttachment(data: data, contentType: UTType(mimeType: mime) ?? .data)
            }
            return Data(content.html.utf8)
        }
    }

    private static func notice(_ key: String, _ messages: [String: String]) -> PreviewContent {
        let message = PreviewRenderer.escape(PreviewRenderer.message(key, messages))
        return PreviewContent(html: PreviewRenderer.page(body: "<p role=\"status\">\(message)</p>",
            styles: "html { color-scheme: light dark; } body { font: 16px system-ui; padding: 24px; }"), attachments: [:])
    }

    private static func translations(_ root: URL) -> [String: String] {
        guard let bytes = try? Data(contentsOf: root.appendingPathComponent("languages.json")),
              let translations = try? JSONDecoder().decode([String: [String: String]].self, from: bytes) else { return [:] }
        let languages = Bundle.preferredLocalizations(from: Array(translations.keys), forPreferences: Locale.preferredLanguages)
        return translations[languages.first ?? "en"] ?? translations["en"] ?? [:]
    }
}
