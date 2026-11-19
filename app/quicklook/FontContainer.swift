import Foundation
import MachO

@main
struct FontContainer {
    static func main() {
        let arguments = CommandLine.arguments
        guard arguments.count == 1 || (arguments.count == 2 && arguments[1] == "--publish") else { exit(1) }
        var length: UInt32 = 0
        _ = _NSGetExecutablePath(nil, &length)
        guard length > 0, length <= 16384 else { exit(1) }
        var executable = [CChar](repeating: 0, count: Int(length))
        guard _NSGetExecutablePath(&executable, &length) == 0 else { exit(1) }
        let bundleURL = URL(fileURLWithPath: String(cString: executable)).resolvingSymlinksInPath()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        guard let bundle = Bundle(url: bundleURL),
              let group = bundle.object(forInfoDictionaryKey: "SiYuanQuickLookAppGroup") as? String,
              group.range(of: "^[A-Z0-9]{10}\\.org\\.b3log\\.siyuan\\.quicklook$", options: .regularExpression) != nil,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { exit(1) }
        if arguments.count == 1 { print(container.path); return }
        do { try FontPublisher.publish(root: container, data: FontPublisher.readInput()) }
        catch { exit(1) }
    }
}
