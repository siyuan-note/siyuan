import Foundation
import CryptoKit
import Darwin

@main
struct PreviewFontsTests {
    static func main() throws {
        let manager = FileManager.default
        let root = manager.temporaryDirectory.appendingPathComponent("siyuan-fonts-\(UUID().uuidString)")
        let directory = root.appendingPathComponent("QuickLookFonts")
        let fonts = directory.appendingPathComponent("fonts")
        try manager.createDirectory(at: fonts, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        let bytes = Data([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])
        let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let fontURL = fonts.appendingPathComponent(hash + ".ttf")
        try bytes.write(to: fontURL)
        let font: [String: Any] = ["family": "SiYuanCustomFont-" + hash, "weight": 400,
                                   "file": hash + ".ttf", "sha256": hash, "size": bytes.count]
        let groups: [String: Any] = ["global": [["family": "Helvetica", "weight": 400]],
                                   "editor": [["family": "SiYuanCustomFont-" + hash, "weight": 400]], "code": []]
        let manifest: [String: Any] = ["version": 1, "fonts": groups, "customFonts": [font]]
        let current = directory.appendingPathComponent("current.json")
        func write(_ value: [String: Any]) throws {
            try JSONSerialization.data(withJSONObject: value).write(to: current, options: .atomic)
        }
        func rejected(_ action: () throws -> Void) {
            do { try action(); fatalError("Expected rejection") } catch {}
        }
        try write(manifest)
        let first = try PreviewFonts.read(root: root)
        precondition(first.resources.count == 1 && first.resources.values.first!.0 == bytes)
        precondition(first.css.contains("cid:workspace-font-" + hash + ".ttf"))
        precondition(first.css.contains("\"Helvetica\""))
        var escaped = manifest
        escaped["fonts"] = ["global": [["family": "</style><script>", "weight": 500]], "editor": [], "code": []]
        escaped["customFonts"] = []
        try write(escaped)
        let escapedSnapshot = try PreviewFonts.read(root: root)
        precondition(!escapedSnapshot.css.contains("<") && escapedSnapshot.css.contains("--markdown-editor-font-weight:500"))
        var bold = font; bold["weight"] = 700
        var multiple = manifest
        multiple["fonts"] = ["global": [["family": "SiYuanCustomFont-" + hash, "weight": 400]],
                             "editor": [["family": "SiYuanCustomFont-" + hash, "weight": 700]], "code": []]
        multiple["customFonts"] = [font, bold]
        try write(multiple)
        let multipleSnapshot = try PreviewFonts.read(root: root)
        precondition(multipleSnapshot.resources.count == 1)
        precondition(multipleSnapshot.css.components(separatedBy: "@font-face").count == 3)
        var unselected = manifest
        unselected["fonts"] = ["global": [], "editor": [], "code": []]
        try write(unselected)
        rejected { _ = try PreviewFonts.read(root: root) }
        let trueBytes = Data([0x74, 0x72, 0x75, 0x65])
        let trueHash = SHA256.hash(data: trueBytes).map { String(format: "%02x", $0) }.joined()
        try trueBytes.write(to: fonts.appendingPathComponent(trueHash + ".ttf"))
        let trueFont: [String: Any] = ["family": "SiYuanCustomFont-" + trueHash, "weight": 400,
                                       "file": trueHash + ".ttf", "sha256": trueHash, "size": trueBytes.count]
        let trueManifest: [String: Any] = ["version": 1,
            "fonts": ["global": [], "editor": [["family": "SiYuanCustomFont-" + trueHash, "weight": 400]], "code": []],
            "customFonts": [trueFont]]
        try write(trueManifest)
        let trueSnapshot = try PreviewFonts.read(root: root)
        precondition(trueSnapshot.resources.values.first!.0 == trueBytes)
        for (key, value) in [("file", "../outside.ttf" as Any), ("file", "/outside.ttf" as Any),
                             ("sha256", String(repeating: "a", count: 64) as Any), ("size", bytes.count + 1 as Any),
                             ("size", PreviewFonts.fileLimit + 1 as Any), ("weight", 0 as Any),
                             ("family", "bad\nname" as Any)] {
            var changed = font; changed[key] = value
            var invalid = manifest; invalid["customFonts"] = [changed]
            try write(invalid)
            rejected { _ = try PreviewFonts.read(root: root) }
        }
        var invalid = manifest; invalid["version"] = 2
        try write(invalid)
        rejected { _ = try PreviewFonts.read(root: root) }
        try Data(repeating: 32, count: 128 * 1024 + 1).write(to: current)
        rejected { _ = try PreviewFonts.read(root: root) }
        try write(manifest)
        try manager.removeItem(at: fontURL)
        let outside = root.appendingPathComponent("outside.ttf")
        try bytes.write(to: outside)
        try manager.createSymbolicLink(at: fontURL, withDestinationURL: outside)
        rejected { _ = try PreviewFonts.read(root: root) }
        try manager.removeItem(at: fontURL)
        try Data(repeating: 0, count: bytes.count).write(to: fontURL)
        rejected { _ = try PreviewFonts.read(root: root) }
        try bytes.write(to: fontURL)
        let saved = directory.appendingPathComponent("saved.json")
        try manager.moveItem(at: current, to: saved)
        try manager.createSymbolicLink(at: current, withDestinationURL: saved)
        rejected { _ = try PreviewFonts.read(root: root) }
        try manager.removeItem(at: current)
        try write(manifest)
        let savedFonts = directory.appendingPathComponent("saved-fonts")
        try manager.moveItem(at: fonts, to: savedFonts)
        try manager.createSymbolicLink(at: fonts, withDestinationURL: savedFonts)
        rejected { _ = try PreviewFonts.read(root: root) }
        let token = PreviewCancellation(); token.cancel()
        rejected { _ = try PreviewFonts.read(root: root, cancellation: token) }
        precondition(first.resources.values.first!.0 == bytes)
        try publisherTests(root: root.appendingPathComponent("publisher"))
        print("Quick Look font snapshots, CSS, attachment reuse, bounds, hashes, symlinks and cancellation passed")
    }

    static func publisherTests(root: URL) throws {
        let manager = FileManager.default
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        func payload(_ suffix: UInt8) throws -> (Data, String) {
            let bytes = Data([0, 1, 0, 0, suffix])
            let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            let family = "SiYuanCustomFont-" + hash
            let file = hash + ".ttf"
            let value: [String: Any] = ["version": 1,
                "fonts": ["global": [], "editor": [["family": family, "weight": 400]], "code": []],
                "customFonts": [["family": family, "weight": 400, "file": file, "sha256": hash, "size": bytes.count]],
                "files": [["file": file, "data": bytes.base64EncodedString()]]]
            return (try JSONSerialization.data(withJSONObject: value), file)
        }
        func rejected(_ action: () throws -> Void) {
            do { try action(); fatalError("Expected rejection") } catch {}
        }
        let a = try payload(1), b = try payload(2), c = try payload(3)
        try FontPublisher.publish(root: root, data: a.0)
        let first = try PreviewFonts.read(root: root)
        precondition(first.resources.count == 1)
        let directory = root.appendingPathComponent("QuickLookFonts")
        let fonts = directory.appendingPathComponent("fonts")
        let current = directory.appendingPathComponent("current.json")
        let before = try Data(contentsOf: current)
        let locked = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        precondition(locked >= 0 && flock(locked, LOCK_EX | LOCK_NB) == 0)
        let start = Date.timeIntervalSinceReferenceDate
        rejected { _ = try PreviewFonts.read(root: root) }
        precondition(Date.timeIntervalSinceReferenceDate - start < 1)
        _ = flock(locked, LOCK_UN)
        close(locked)
        var invalid = try JSONSerialization.jsonObject(with: a.0) as! [String: Any]
        invalid["files"] = [["file": "../../outside.ttf", "data": Data([0, 1, 0, 0]).base64EncodedString()]]
        rejected { try FontPublisher.publish(root: root, data: JSONSerialization.data(withJSONObject: invalid)) }
        let after = try Data(contentsOf: current)
        precondition(after == before)
        let temporary = fonts.appendingPathComponent(".snapshot-" + UUID().uuidString.lowercased())
        try Data([1]).write(to: temporary)
        try FontPublisher.publish(root: root, data: b.0)
        precondition(!manager.fileExists(atPath: temporary.path))
        precondition(manager.fileExists(atPath: fonts.appendingPathComponent(a.1).path))
        try FontPublisher.publish(root: root, data: c.0)
        precondition(!manager.fileExists(atPath: fonts.appendingPathComponent(a.1).path))
        precondition(manager.fileExists(atPath: fonts.appendingPathComponent(b.1).path))
        let savedFonts = directory.appendingPathComponent("saved-fonts")
        try manager.moveItem(at: fonts, to: savedFonts)
        try manager.createSymbolicLink(at: fonts, withDestinationURL: savedFonts)
        rejected { try FontPublisher.publish(root: root, data: a.0) }
        try manager.removeItem(at: fonts)
        try manager.moveItem(at: savedFonts, to: fonts)
        let outside = root.appendingPathComponent("outside")
        try manager.createDirectory(at: outside.appendingPathComponent("fonts"), withIntermediateDirectories: true)
        let sentinel = Data("outside must remain unchanged".utf8)
        try sentinel.write(to: outside.appendingPathComponent("current.json"))
        try sentinel.write(to: outside.appendingPathComponent("fonts").appendingPathComponent(a.1))
        let detached = root.appendingPathComponent("detached")
        try FontPublisher.publish(root: root, data: a.0, afterOpen: {
            try manager.moveItem(at: directory, to: detached)
            try manager.createSymbolicLink(at: directory, withDestinationURL: outside)
        })
        let outsideManifest = try Data(contentsOf: outside.appendingPathComponent("current.json"))
        let outsideFont = try Data(contentsOf: outside.appendingPathComponent("fonts").appendingPathComponent(a.1))
        precondition(outsideManifest == sentinel && outsideFont == sentinel)
        precondition(manager.fileExists(atPath: detached.appendingPathComponent("fonts").appendingPathComponent(a.1).path))
        rejected { try FontPublisher.publish(root: root, data: b.0) }
    }
}
