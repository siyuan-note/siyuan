import Cocoa
import QuickLookUI
import WebKit

private final class PreviewMessageHandler: NSObject, WKScriptMessageHandler {
    weak var owner: PreviewViewController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receive(message)
    }
}

private final class PreviewResourceHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    let files: Set<String>
    var id = ""
    var images: [String: (Data, String)] = [:]
    private var jobs: [ObjectIdentifier: UUID] = [:]

    init(root: URL) throws {
        self.root = root
        files = Set(try JSONDecoder().decode([String].self, from: Data(contentsOf: root.appendingPathComponent("resources.json"))))
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.scheme == "siyuan-preview", url.query == nil,
              url.fragment == nil, url.user == nil, url.password == nil, url.port == nil else {
            task.didFailWithError(PreviewFileError.unavailable); return
        }
        let token = UUID()
        let key = ObjectIdentifier(task)
        jobs[key] = token
        let requestID = id
        let cachedImages = images
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let result = Result { () throws -> (Data, String) in
                let data: Data
                let mime: String
                if url.host == "image", url.pathComponents.count == 3, url.pathComponents[1] == requestID,
                   let image = cachedImages[url.pathComponents[2]] {
                    (data, mime) = image
                } else if url.host == "bundle" {
                    let name = String(url.path.dropFirst())
                    let alias = name == "vditor/dist/js/lute/lute.min.js" ? "lute.min.js" : name
                    guard files.contains(alias) else { throw PreviewFileError.unavailable }
                    let file = root.appendingPathComponent(alias).resolvingSymlinksInPath()
                    guard file.path.hasPrefix(root.resolvingSymlinksInPath().path + "/") else { throw PreviewFileError.unavailable }
                    data = try Data(contentsOf: file)
                    mime = ["html": "text/html", "js": "text/javascript", "css": "text/css", "woff": "font/woff",
                            "woff2": "font/woff2", "ttf": "font/ttf"][file.pathExtension] ?? "application/octet-stream"
                } else { throw PreviewFileError.unavailable }
                return (data, mime)
            }
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.jobs[key] == token else { return }
                self.jobs.removeValue(forKey: key)
                switch result {
                case .success(let (data, mime)):
                    task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
                    task.didReceive(data)
                    task.didFinish()
                case .failure(let error): task.didFailWithError(error)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { jobs.removeValue(forKey: ObjectIdentifier(task)) }
    func cancel() { jobs.removeAll(); images.removeAll() }
}

@objc(PreviewViewController)
final class PreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate, WKUIDelegate {
    private var web: WKWebView?
    private var resources: PreviewResourceHandler?
    private var request = ""
    private var documentURL: URL?
    private var markdown: String?
    private var ready = false
    private var sent = false
    private var imageRequest = false
    private var completion: ((Error?) -> Void)?
    private var timeout: DispatchWorkItem?
    private var work: DispatchWorkItem?
    private var cancellation = PreviewCancellation()
    private var strings: [String: String] = [:]

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        _ = view
        cancel()
        cancellation = PreviewCancellation()
        request = UUID().uuidString.lowercased()
        documentURL = url
        completion = handler
        preferredContentSize = NSSize(width: 800, height: 600)
        let id = request
        do {
            let root = Bundle(for: PreviewViewController.self).resourceURL!.appendingPathComponent("Preview")
            let translations = try JSONDecoder().decode([String: [String: String]].self,
                from: Data(contentsOf: root.appendingPathComponent("languages.json")))
            let languages = Bundle.preferredLocalizations(from: Array(translations.keys()), forPreferences: Locale.preferredLanguages)
            strings = translations[languages.first ?? "en"] ?? translations["en"] ?? [:]
            let resourceHandler = try PreviewResourceHandler(root: root)
            resourceHandler.id = id
            resources = resourceHandler
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .nonPersistent()
            configuration.setURLSchemeHandler(resourceHandler, forURLScheme: "siyuan-preview")
            let messages = PreviewMessageHandler()
            messages.owner = self
            configuration.userContentController.add(messages, name: "preview")
            let browser = WKWebView(frame: view.bounds, configuration: configuration)
            browser.autoresizingMask = [.width, .height]
            browser.navigationDelegate = self
            browser.uiDelegate = self
            browser.allowsBackForwardNavigationGestures = false
            web = browser
            view.subviews.forEach { $0.removeFromSuperview() }
            view.addSubview(browser)
            let deadline = DispatchWorkItem { [weak self] in
                guard self?.request == id else { return }
                self?.fail("timeout")
            }
            timeout = deadline
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: deadline)
            let cancellation = self.cancellation
            let read = DispatchWorkItem { [weak self] in
                let result = Result { try PreviewFiles.document(url, cancellation: cancellation) }
                DispatchQueue.main.async { [weak self] in
                    guard let self = self, self.request == id else { return }
                    switch result {
                    case .success(let text): self.markdown = text; self.sendDocument()
                    case .failure(let error):
                        switch error {
                        case PreviewFileError.limit: self.fail("limit")
                        case PreviewFileError.encoding: self.fail("encoding")
                        default: self.fail("file")
                        }
                    }
                }
            }
            work = read
            DispatchQueue.global(qos: .userInitiated).async(execute: read)
            browser.load(URLRequest(url: URL(string: "siyuan-preview://bundle/index.html")!))
        } catch { fail("failed") }
    }

    fileprivate func receive(_ message: WKScriptMessage) {
        guard message.webView === web, message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.absoluteString == "siyuan-preview://bundle/index.html",
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "ready" { ready = true; sendDocument(); return }
        guard body["id"] as? String == request, !request.isEmpty else { return }
        switch type {
        case "rendered": finish()
        case "failed": fail("failed")
        case "images":
            guard sent, !imageRequest, let references = body["references"] as? [String], references.count <= 256,
                  references.allSatisfy({ $0.utf8.count <= 2048 }), let url = documentURL else { fail("failed"); return }
            imageRequest = true
            let id = request
            let cancellation = self.cancellation
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                var values: [String: (Data, String)] = [:]
                var urls: [Any] = []
                var bytes = 0
                for reference in references {
                    guard (try? cancellation.check()) != nil else { return }
                    if bytes >= PreviewFiles.imageTotalLimit { urls.append(NSNull()); continue }
                    guard let image = try? PreviewFiles.image(reference, document: url, cancellation: cancellation),
                          bytes + image.0.count <= PreviewFiles.imageTotalLimit else { urls.append(NSNull()); continue }
                    bytes += image.0.count
                    let token = UUID().uuidString.lowercased()
                    values[token] = image
                    urls.append("siyuan-preview://image/\(id)/\(token)")
                }
                DispatchQueue.main.async { [weak self] in
                    guard let self = self, self.request == id else { return }
                    self.resources?.images = values
                    self.evaluate("window.preview.images(id, urls)", ["id": id, "urls": urls])
                }
            }
        default: break
        }
    }

    private func sendDocument() {
        guard ready, !sent, let text = markdown else { return }
        sent = true
        markdown = nil
        evaluate("window.preview.render(id, markdown, messages)",
                 ["id": request, "markdown": text, "messages": ["limit": strings["limit"] ?? "", "resource": strings["resource"] ?? ""]])
    }

    private func evaluate(_ script: String, _ arguments: [String: Any]) {
        let id = request
        web?.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { [weak self] result in
            guard self?.request == id else { return }
            if case .failure = result { self?.fail("failed") }
        }
    }

    private func finish() {
        timeout?.cancel(); timeout = nil
        let handler = completion
        completion = nil
        handler?(nil)
    }

    private func fail(_ key: String) {
        let text = strings[key] ?? strings["failed"] ?? "Markdown preview unavailable"
        cancelWork()
        request = ""
        let label = NSTextField(wrappingLabelWithString: text)
        label.frame = view.bounds.insetBy(dx: 24, dy: 24)
        label.autoresizingMask = [.width, .height]
        view.subviews.forEach { $0.removeFromSuperview() }
        view.addSubview(label)
        finish()
    }

    private func cancelWork() {
        cancellation.cancel()
        work?.cancel(); work = nil
        timeout?.cancel(); timeout = nil
        let browser = web
        web = nil
        browser?.navigationDelegate = nil
        browser?.uiDelegate = nil
        browser?.configuration.userContentController.removeScriptMessageHandler(forName: "preview")
        browser?.stopLoading()
        browser?.removeFromSuperview()
        resources?.cancel()
        resources = nil
        markdown = nil
    }

    private func cancel() {
        cancelWork()
        request = ""
        documentURL = nil
        ready = false; sent = false; imageRequest = false
        let handler = completion
        completion = nil
        handler?(NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }

    override func viewWillDisappear() { super.viewWillDisappear(); cancel() }

    deinit {
        cancellation.cancel(); work?.cancel(); timeout?.cancel()
        completion?(NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if webView === web { fail("failed") } }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView === web { fail("failed") }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === web { fail("failed") }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.navigationType == .other && action.request.url?.absoluteString == "siyuan-preview://bundle/index.html" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
}
