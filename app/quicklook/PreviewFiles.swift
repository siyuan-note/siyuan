import Foundation
import Darwin
import ImageIO

enum PreviewFileError: Error {
    case unavailable, limit, encoding
}

final class PreviewCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    func check() throws {
        lock.lock(); let value = cancelled; lock.unlock()
        if value { throw PreviewFileError.unavailable }
    }
}

enum PreviewFiles {
    static let documentLimit = 256 * 1024
    static let imageLimit = 8 * 1024 * 1024
    static let imageTotalLimit = 32 * 1024 * 1024

    static func read(_ fd: Int32, limit: Int, cancellation: PreviewCancellation) throws -> Data {
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else { throw PreviewFileError.unavailable }
        guard info.st_size >= 0, info.st_size <= Int64(limit) else { throw PreviewFileError.limit }
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 65536)
        while result.count <= limit {
            try cancellation.check()
            let count = Darwin.read(fd, &buffer, min(buffer.count, limit + 1 - result.count))
            if count < 0 {
                if errno == EINTR { continue }
                throw PreviewFileError.unavailable
            }
            if count == 0 { return result }
            result.append(contentsOf: buffer.prefix(count))
        }
        throw PreviewFileError.limit
    }

    static func document(_ url: URL, cancellation: PreviewCancellation = PreviewCancellation()) throws -> String {
        guard url.isFileURL, ["md", "markdown"].contains(url.pathExtension.lowercased()) else {
            throw PreviewFileError.unavailable
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard fd >= 0 else { throw PreviewFileError.unavailable }
        defer { close(fd) }
        let data = try read(fd, limit: documentLimit, cancellation: cancellation)
        let encoding: String.Encoding
        let skip: Int
        if data.starts(with: [0xFF, 0xFE]) { encoding = .utf16LittleEndian; skip = 2 }
        else if data.starts(with: [0xFE, 0xFF]) { encoding = .utf16BigEndian; skip = 2 }
        else { encoding = .utf8; skip = data.starts(with: [0xEF, 0xBB, 0xBF]) ? 3 : 0 }
        guard let text = String(data: data.dropFirst(skip), encoding: encoding), !text.contains("\0") else {
            throw PreviewFileError.encoding
        }
        guard text.utf8.count <= documentLimit else { throw PreviewFileError.limit }
        return text
    }

    static func image(_ reference: String, document: URL, cancellation: PreviewCancellation = PreviewCancellation()) throws -> (Data, String) {
        guard !reference.isEmpty, reference.utf8.count <= 2048,
              !reference.contains("\\"), !reference.contains(":"), !reference.hasPrefix("/"),
              !reference.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
              let decoded = reference.removingPercentEncoding, !decoded.contains("\0"),
              !decoded.contains("\\"), !decoded.contains(":"), !decoded.hasPrefix("/"),
              !decoded.contains("?"), !decoded.contains("#") else { throw PreviewFileError.unavailable }
        let parts = decoded.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard parts.count <= 32, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw PreviewFileError.unavailable
        }
        let types = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"]
        guard let mime = types[URL(fileURLWithPath: decoded).pathExtension.lowercased()] else {
            throw PreviewFileError.unavailable
        }
        let scoped = document.startAccessingSecurityScopedResource()
        defer { if scoped { document.stopAccessingSecurityScopedResource() } }
        var directory = open(document.deletingLastPathComponent().resolvingSymlinksInPath().path,
                             O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw PreviewFileError.unavailable }
        defer { close(directory) }
        for part in parts.dropLast() {
            let next = openat(directory, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard next >= 0 else { throw PreviewFileError.unavailable }
            close(directory)
            directory = next
        }
        let fd = openat(directory, parts.last!, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard fd >= 0 else { throw PreviewFileError.unavailable }
        defer { close(fd) }
        let data = try read(fd, limit: imageLimit, cancellation: cancellation)
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 20000, height <= 20000, width * height <= 40000000 else {
            throw PreviewFileError.unavailable
        }
        return (data, mime)
    }
}
