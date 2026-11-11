const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {execFileSync} = require("node:child_process");
const {createRequire} = require("node:module");
const {markdownAssetFiles, SHARED_LUTE_ASSET} = require("./markdown-assets");

const appRoot = path.resolve(__dirname, "..");
const extensionName = "SiYuanQuickLook.appex";
const extensionEntitlements = path.join(appRoot, "quicklook/entitlements.plist");
const minimumVersion = "12.0";
const architectures = ["x86_64", "arm64"];

const prepareQuickLookResources = async output => {
    fs.mkdirSync(output, {recursive: true});
    const files = markdownAssetFiles();
    files.push({name: "vditor/dist/method.min.js", source: path.join(path.dirname(require.resolve("vditor/package.json")), "dist/method.min.js")});
    files.push({name: "lute.min.js", source: path.join(appRoot, SHARED_LUTE_ASSET)});
    files.push({name: "index.html", source: path.join(appRoot, "src/quicklook/index.html")});
    for (const file of files) {
        const destination = path.join(output, file.name);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.copyFileSync(file.source, destination);
    }
    const esbuild = createRequire(require.resolve("esbuild-loader"))("esbuild");
    await esbuild.build({entryPoints: [path.join(appRoot, "src/quicklook/index.ts")], outfile: path.join(output, "preview.js"),
        bundle: true, platform: "browser", format: "iife", target: "safari15", minify: true, legalComments: "none"});
    fs.writeFileSync(path.join(output, "preview.css"), require("sass").compile(path.join(appRoot, "src/assets/scss/quicklook.scss")).css);
    const names = ["limit", "encoding", "timeout", "failed", "file", "resource"];
    const keys = ["quickLookLimit", "quickLookEncoding", "quickLookTimeout", "markdownLoadError", "markdownFileUnavailable", "markdownResourceUnavailable"];
    const languages = {};
    for (const file of fs.readdirSync(path.join(appRoot, "appearance/langs"))) {
        if (!file.endsWith(".json")) { continue; }
        const strings = JSON.parse(fs.readFileSync(path.join(appRoot, "appearance/langs", file), "utf8"));
        languages[file.slice(0, -5)] = Object.fromEntries(names.map((name, index) => {
            if (!strings[keys[index]]) { throw new Error(`Missing Quick Look language ${file}: ${keys[index]}`); }
            return [name, strings[keys[index]]];
        }));
    }
    fs.writeFileSync(path.join(output, "languages.json"), JSON.stringify(languages));
    const manifest = [...files.map(file => file.name), "preview.js", "preview.css", "languages.json"];
    fs.writeFileSync(path.join(output, "resources.json"), JSON.stringify(manifest));
    return manifest;
};

const compileQuickLook = async (appPath, version, run = execFileSync) => {
    if (process.platform !== "darwin" && run === execFileSync) { throw new Error("Quick Look requires the macOS SDK"); }
    if (!/^\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/.test(version)) { throw new Error("Invalid Quick Look version"); }
    const contents = path.join(appPath, "Contents/PlugIns", extensionName, "Contents");
    fs.mkdirSync(path.join(contents, "MacOS"), {recursive: true});
    fs.writeFileSync(path.join(contents, "Info.plist"), fs.readFileSync(path.join(appRoot, "quicklook/Info.plist"), "utf8").replaceAll("__VERSION__", version));
    await prepareQuickLookResources(path.join(contents, "Resources/Preview"));
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-quicklook-"));
    if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir())) { throw new Error("Invalid Quick Look temporary path"); }
    try {
        const sdk = String(run("xcrun", ["--sdk", "macosx", "--show-sdk-path"], {encoding: "utf8"})).trim();
        const binaries = architectures.map(arch => {
            const binary = path.join(temporary, arch);
            run("xcrun", ["swiftc", "-parse-as-library", "-application-extension", "-module-name", "SiYuanQuickLook",
                "-sdk", sdk, "-target", `${arch}-apple-macosx${minimumVersion}`, "-O",
                "-Xlinker", "-e", "-Xlinker", "_NSExtensionMain", "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks",
                "-framework", "Cocoa", "-framework", "QuickLookUI", "-framework", "WebKit", "-framework", "ImageIO",
                path.join(appRoot, "quicklook/PreviewFiles.swift"), path.join(appRoot, "quicklook/PreviewFonts.swift"),
                path.join(appRoot, "quicklook/PreviewViewController.swift"),
                "-o", binary], {stdio: "inherit"});
            return binary;
        });
        const executable = path.join(contents, "MacOS/SiYuanQuickLook");
        run("xcrun", ["lipo", "-create", ...binaries, "-output", executable], {stdio: "inherit"});
        const helpers = architectures.map(arch => {
            const binary = path.join(temporary, `fonts-${arch}`);
            run("xcrun", ["swiftc", "-parse-as-library", "-sdk", sdk, "-target", `${arch}-apple-macosx${minimumVersion}`, "-O",
                "-framework", "ImageIO", path.join(appRoot, "quicklook/PreviewFiles.swift"),
                path.join(appRoot, "quicklook/PreviewFonts.swift"), path.join(appRoot, "quicklook/FontPublisher.swift"),
                path.join(appRoot, "quicklook/FontContainer.swift"), "-o", binary], {stdio: "inherit"});
            return binary;
        });
        const helper = path.join(appPath, "Contents/MacOS/SiYuanQuickLookFonts");
        fs.mkdirSync(path.dirname(helper), {recursive: true});
        run("xcrun", ["lipo", "-create", ...helpers, "-output", helper], {stdio: "inherit"});
        for (const binary of [executable, helper]) {
            for (const arch of architectures) {
                run("xcrun", ["lipo", binary, "-verify_arch", arch], {stdio: "inherit"});
            }
        }
        run("plutil", ["-lint", path.join(contents, "Info.plist"), extensionEntitlements], {stdio: "inherit"});
    } finally {
        fs.rmSync(temporary, {recursive: true, force: true});
    }
};

module.exports = {prepareQuickLookResources, compileQuickLook, extensionName, extensionEntitlements};
