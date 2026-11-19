import Foundation
import Darwin
import CryptoKit

struct PreviewFont: Codable {
    let family: String
    let weight: Int
}

struct PreviewFontGroups: Codable {
    let global: [PreviewFont]
    let editor: [PreviewFont]
    let code: [PreviewFont]
}

struct CachedPreviewFont: Codable {
    let family: String
    let weight: Int
    let file: String
    let sha256: String
    let size: Int
}

struct PreviewFontManifest: Codable {
    let version: Int
    let fonts: PreviewFontGroups
    let customFonts: [CachedPreviewFont]
}

struct PreviewFontSnapshot {
    var css = ""
    var resources: [String: (Data, String)] = [:]
}

enum PreviewFonts {
    static let fileLimit = 64 * 1024 * 1024
    static let totalLimit = 128 * 1024 * 1024

    static func lock(_ directory: Int32, operation: Int32, cancellation: PreviewCancellation = PreviewCancellation()) throws {
        for _ in 0..<300 {
            try cancellation.check()
            if flock(directory, operation | LOCK_NB) == 0 { return }
            guard errno == EWOULDBLOCK || errno == EINTR else { throw PreviewFileError.unavailable }
            usleep(10000)
        }
        throw PreviewFileError.unavailable
    }

    static func validate(_ manifest: PreviewFontManifest) throws {
        func valid(_ font: PreviewFont) -> Bool {
            !font.family.isEmpty && font.family.utf8.count <= 1024 &&
            !font.family.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) &&
            (1...1000).contains(font.weight)
        }
        guard manifest.version == 1, manifest.customFonts.count <= 96,
              [manifest.fonts.global, manifest.fonts.editor, manifest.fonts.code].allSatisfy({ $0.count <= 32 && $0.allSatisfy(valid) }) else {
            throw PreviewFileError.unavailable
        }
        let selected = manifest.fonts.global + manifest.fonts.editor + manifest.fonts.code
        var sizes: [String: Int] = [:]
        var total = 0
        for font in manifest.customFonts {
            guard valid(PreviewFont(family: font.family, weight: font.weight)),
                  font.sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
                  font.family == "SiYuanCustomFont-" + font.sha256,
                  selected.contains(where: { $0.family == font.family && $0.weight == font.weight }),
                  font.file == font.sha256 + ".ttf" || font.file == font.sha256 + ".otf",
                  font.size >= 4, font.size <= fileLimit else { throw PreviewFileError.unavailable }
            if let size = sizes[font.file] {
                guard size == font.size else { throw PreviewFileError.unavailable }
            } else {
                guard total <= totalLimit - font.size else { throw PreviewFileError.limit }
                total += font.size
                sizes[font.file] = font.size
            }
        }
    }

    static func validate(_ bytes: Data, font: CachedPreviewFont) throws {
        guard bytes.count == font.size,
              SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == font.sha256,
              (font.file.hasSuffix(".ttf") && (bytes.starts(with: [0, 1, 0, 0]) || bytes.starts(with: [0x74, 0x72, 0x75, 0x65]))) ||
              (font.file.hasSuffix(".otf") && bytes.starts(with: [0x4f, 0x54, 0x54, 0x4f])) else { throw PreviewFileError.unavailable }
    }

    static func container() -> URL? {
        guard let group = Bundle(for: PreviewCancellation.self).object(forInfoDictionaryKey: "SiYuanQuickLookAppGroup") as? String,
              group.range(of: "^[A-Z0-9]{10}\\.org\\.b3log\\.siyuan\\.quicklook$", options: .regularExpression) != nil else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    }

    static func load(cancellation: PreviewCancellation) -> PreviewFontSnapshot {
        guard let root = container() else { return PreviewFontSnapshot() }
        return (try? read(root: root, cancellation: cancellation)) ?? PreviewFontSnapshot()
    }

    private static func cssString(_ value: String) -> String {
        "\"" + value.unicodeScalars.map { scalar in
            switch scalar {
            case "\"", "\\", "<", ">": return "\\\(String(scalar.value, radix: 16)) "
            default: return String(scalar)
            }
        }.joined() + "\""
    }

    private static func fontCSS(_ fonts: PreviewFontGroups) -> String {
        let groups = [
            ("global", fonts.global, "--b3-font-family", 400),
            ("editor", fonts.editor, fonts.global.isEmpty ? "--b3-font-family-protyle" : "--markdown-global-font-family",
             fonts.global.first?.weight ?? 400),
            ("code", fonts.code, "--b3-font-family-code", 400),
        ]
        let declarations = groups.map { name, selected, fallback, weight in
            let families = selected.isEmpty ? "" : "var(--b3-font-family-emoji-reset), " + selected.map { cssString($0.family) }.joined(separator: ", ") + ", "
            return "--markdown-\(name)-font-family:\(families)var(\(fallback));--markdown-\(name)-font-weight:\(selected.first?.weight ?? weight);"
        }
        return "body {\(declarations.joined())}"
    }

    static func read(root: URL, cancellation: PreviewCancellation = PreviewCancellation()) throws -> PreviewFontSnapshot {
        let container = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard container >= 0 else { throw PreviewFileError.unavailable }
        defer { close(container) }
        let directory = openat(container, "QuickLookFonts", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw PreviewFileError.unavailable }
        defer { close(directory) }
        guard flock(directory, LOCK_SH | LOCK_NB) == 0 else { throw PreviewFileError.unavailable }
        defer { _ = flock(directory, LOCK_UN) }
        let manifestFD = openat(directory, "current.json", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard manifestFD >= 0 else { throw PreviewFileError.unavailable }
        defer { close(manifestFD) }
        let data = try PreviewFiles.read(manifestFD, limit: 128 * 1024, cancellation: cancellation)
        let manifest = try JSONDecoder().decode(PreviewFontManifest.self, from: data)
        try validate(manifest)
        var snapshot = PreviewFontSnapshot(css: fontCSS(manifest.fonts))
        if manifest.customFonts.isEmpty { return snapshot }
        let fonts = openat(directory, "fonts", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fonts >= 0 else { throw PreviewFileError.unavailable }
        defer { close(fonts) }
        for font in manifest.customFonts {
            try cancellation.check()
            let id = "workspace-font-" + font.file
            if snapshot.resources[id] == nil {
                let fd = openat(fonts, font.file, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
                guard fd >= 0 else { throw PreviewFileError.unavailable }
                defer { close(fd) }
                let bytes = try PreviewFiles.read(fd, limit: fileLimit, cancellation: cancellation)
                try validate(bytes, font: font)
                snapshot.resources[id] = (bytes, font.file.hasSuffix(".ttf") ? "font/ttf" : "font/otf")
            }
            snapshot.css += "@font-face{font-family:\(cssString(font.family));font-weight:\(font.weight);src:url(\"cid:\(id)\");}"
        }
        return snapshot
    }
}
