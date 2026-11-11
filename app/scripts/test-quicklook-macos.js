const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {execFileSync} = require("node:child_process");
const {compileQuickLook} = require("./quicklook");

if (process.platform !== "darwin") {
    throw new Error("Native Quick Look tests require macOS and the macOS SDK");
}
const run = async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-quicklook-native-test-"));
    if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir())) { throw new Error("Invalid test temporary directory"); }
    try {
        await compileQuickLook(path.join(temporary, "SiYuan.app"), require("../package.json").version);
        const executable = path.join(temporary, "PreviewFilesTests");
        execFileSync("xcrun", ["swiftc", "-parse-as-library", "-framework", "ImageIO",
            path.join(__dirname, "../quicklook/PreviewFiles.swift"), path.join(__dirname, "../quicklook/PreviewFilesTests.swift"),
            "-o", executable], {stdio: "inherit"});
        execFileSync(executable, [], {stdio: "inherit"});
        const fontsExecutable = path.join(temporary, "PreviewFontsTests");
        execFileSync("xcrun", ["swiftc", "-parse-as-library", "-framework", "ImageIO",
            path.join(__dirname, "../quicklook/PreviewFiles.swift"), path.join(__dirname, "../quicklook/PreviewFonts.swift"),
            path.join(__dirname, "../quicklook/FontPublisher.swift"),
            path.join(__dirname, "../quicklook/PreviewFontsTests.swift"), "-o", fontsExecutable], {stdio: "inherit"});
        execFileSync(fontsExecutable, [], {stdio: "inherit"});
        const rendererExecutable = path.join(temporary, "PreviewRendererTests");
        const source = path.join(__dirname, "../quicklook");
        execFileSync("xcrun", ["swiftc", "-parse-as-library", "-framework", "ImageIO", "-framework", "JavaScriptCore",
            ...["PreviewFiles.swift", "PreviewFonts.swift", "PreviewRenderer.swift", "PreviewRendererTests.swift"].map(file => path.join(source, file)),
            "-o", rendererExecutable], {stdio: "inherit"});
        execFileSync(rendererExecutable, [path.join(temporary, "SiYuan.app/Contents/PlugIns/SiYuanQuickLook.appex/Contents/Resources/Preview")], {stdio: "inherit"});
    } finally {
        fs.rmSync(temporary, {recursive: true, force: true});
    }
};

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
