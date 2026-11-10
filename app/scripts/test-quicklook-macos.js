const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {execFileSync} = require("node:child_process");

if (process.platform !== "darwin") {
    throw new Error("Native Quick Look tests require macOS and the macOS SDK");
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-quicklook-native-test-"));
if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir())) { throw new Error("Invalid test temporary directory"); }
try {
    const executable = path.join(temporary, "PreviewFilesTests");
    execFileSync("xcrun", ["swiftc", "-parse-as-library", "-framework", "ImageIO",
        path.join(__dirname, "../quicklook/PreviewFiles.swift"), path.join(__dirname, "../quicklook/PreviewFilesTests.swift"),
        "-o", executable], {stdio: "inherit"});
    execFileSync(executable, [], {stdio: "inherit"});
} finally {
    fs.rmSync(temporary, {recursive: true, force: true});
}
