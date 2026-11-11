import Foundation
import Darwin

private struct PublishedFontFile: Decodable {
    let file: String
    let data: Data
}

private struct PublishedFontFiles: Decodable {
    let files: [PublishedFontFile]
}

enum FontPublisher {
    static let inputLimit = 180 * 1024 * 1024

    static func readInput() throws -> Data {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 65536)
        while data.count <= inputLimit {
            let count = Darwin.read(STDIN_FILENO, &buffer, min(buffer.count, inputLimit + 1 - data.count))
            if count < 0 {
                if errno == EINTR { continue }
                throw PreviewFileError.unavailable
            }
            if count == 0 { return data }
            data.append(contentsOf: buffer.prefix(count))
        }
        throw PreviewFileError.limit
    }

    static func publish(root: URL, data: Data, afterOpen: (() throws -> Void)? = nil) throws {
        guard data.count <= inputLimit else { throw PreviewFileError.limit }
        let manifest = try JSONDecoder().decode(PreviewFontManifest.self, from: data)
        try PreviewFonts.validate(manifest)
        let serialized = try JSONEncoder().encode(manifest)
        guard serialized.count <= 128 * 1024 else { throw PreviewFileError.limit }
        let incoming = try JSONDecoder().decode(PublishedFontFiles.self, from: data).files
        guard incoming.count <= 96 else { throw PreviewFileError.limit }
        var files: [String: Data] = [:]
        var total = 0
        for file in incoming {
            guard files[file.file] == nil, let font = manifest.customFonts.first(where: { $0.file == file.file }),
                  total <= PreviewFonts.totalLimit - file.data.count else { throw PreviewFileError.unavailable }
            try PreviewFonts.validate(file.data, font: font)
            files[file.file] = file.data
            total += file.data.count
        }
        guard Set(files.keys) == Set(manifest.customFonts.map { $0.file }) else { throw PreviewFileError.unavailable }
        let container = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard container >= 0 else { throw PreviewFileError.unavailable }
        defer { close(container) }
        let directory = try childDirectory(container, "QuickLookFonts")
        defer { close(directory) }
        try PreviewFonts.lock(directory, operation: LOCK_EX)
        defer { _ = flock(directory, LOCK_UN) }
        let fonts = try childDirectory(directory, "fonts")
        defer { close(fonts) }
        try afterOpen?()
        cleanup(directory, keep: [], temporaryOnly: true)
        cleanup(fonts, keep: [], temporaryOnly: true)
        var keep = Set(files.keys)
        let previous = openat(directory, "current.json", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        if previous >= 0 {
            defer { close(previous) }
            if let bytes = try? PreviewFiles.read(previous, limit: 128 * 1024, cancellation: PreviewCancellation()),
               let old = try? JSONDecoder().decode(PreviewFontManifest.self, from: bytes),
               (try? PreviewFonts.validate(old)) != nil {
                keep.formUnion(old.customFonts.map { $0.file })
            }
        }
        cleanup(fonts, keep: keep)
        for (name, bytes) in files { try replace(fonts, name, bytes) }
        guard fsync(fonts) == 0 else { throw PreviewFileError.unavailable }
        try replace(directory, "current.json", serialized)
        guard fsync(directory) == 0 else { throw PreviewFileError.unavailable }
        cleanup(fonts, keep: keep)
    }

    private static func childDirectory(_ parent: Int32, _ name: String) throws -> Int32 {
        if mkdirat(parent, name, 0o700) != 0 && errno != EEXIST { throw PreviewFileError.unavailable }
        let fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw PreviewFileError.unavailable }
        return fd
    }

    private static func replace(_ directory: Int32, _ name: String, _ bytes: Data) throws {
        let temporary = ".snapshot-" + UUID().uuidString.lowercased()
        let fd = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw PreviewFileError.unavailable }
        defer { close(fd); _ = unlinkat(directory, temporary, 0) }
        try bytes.withUnsafeBytes { buffer in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw PreviewFileError.unavailable }
                offset += count
            }
        }
        guard fsync(fd) == 0, renameat(directory, temporary, directory, name) == 0 else { throw PreviewFileError.unavailable }
    }

    private static func cleanup(_ directory: Int32, keep: Set<String>, temporaryOnly: Bool = false) {
        let duplicate = openat(directory, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard duplicate >= 0 else { return }
        guard let stream = fdopendir(duplicate) else { close(duplicate); return }
        defer { closedir(stream) }
        while let entry = readdir(stream) {
            let name = withUnsafePointer(to: &entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(NAME_MAX) + 1) { String(cString: $0) }
            }
            let pattern = temporaryOnly ? "^\\.snapshot-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" : "^[0-9a-f]{64}\\.(ttf|otf)$"
            guard !keep.contains(name), name.range(of: pattern, options: .regularExpression) != nil else { continue }
            var info = stat()
            if fstatat(directory, name, &info, AT_SYMLINK_NOFOLLOW) == 0,
               info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) {
                _ = unlinkat(directory, name, 0)
            }
        }
    }
}
