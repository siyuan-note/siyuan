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
const katexPath = "vditor/dist/js/katex/";
const highlightPath = "vditor/dist/js/highlight.js/";
const scripts = ["lute.min.js", "vditor/dist/js/highlight.js/highlight.min.js",
    katexPath + "katex.min.js", katexPath + "mhchem.min.js", "preview.js"];

const prepareQuickLookResources = async output => {
    fs.mkdirSync(output, {recursive: true});
    const assets = new Map(markdownAssetFiles().map(({name, source}) => [name, source]));
    assets.set("lute.min.js", path.join(appRoot, SHARED_LUTE_ASSET));
    const fonts = [...assets.keys()].filter(name => name.startsWith(katexPath + "fonts/") && name.endsWith(".woff2"));
    const files = [...scripts.slice(0, -1), ...fonts, ...[...assets.keys()].filter(name => name.includes("LICENSE") || name.endsWith("-NOTICE"))];
    const parserEntry = require.resolve("parse5");
    const parserRequire = createRequire(parserEntry);
    for (const [dependency, entry] of [["parse5", parserEntry], ["entities", parserRequire.resolve("entities")]]) {
        const license = dependency + "-LICENSE";
        assets.set(license, path.resolve(path.dirname(entry), "../../LICENSE"));
        files.push(license);
    }
    for (const name of files) {
        const destination = path.join(output, name);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.copyFileSync(assets.get(name), destination);
    }
    const esbuild = createRequire(require.resolve("esbuild-loader"))("esbuild");
    await esbuild.build({entryPoints: [path.join(appRoot, "src/quicklook/preview.ts")], outfile: path.join(output, "preview.js"),
        bundle: true, platform: "browser", format: "iife", target: "safari15", minify: true, legalComments: "none"});
    const css = name => fs.readFileSync(assets.get(name), "utf8");
    const katex = require("postcss").parse(css(katexPath + "katex.min.css"));
    const attachments = new Set();
    katex.walkAtRules("font-face", rule => rule.walkDecls("src", declaration => {
        const font = /url\(fonts\/([\w.-]+\.woff2)\)/.exec(declaration.value)?.[1];
        if (!font) { declaration.remove(); return; }
        if (!fonts.includes(katexPath + "fonts/" + font)) throw new Error(`Missing Quick Look font: ${font}`);
        attachments.add(font);
        declaration.value = `url("cid:${font}") format("woff2")`;
    }));
    const styles = [css("vditor/dist/index.css"), katex.toString(),
        css("appearance/themes/daylight/theme.css"), css(highlightPath + "styles/github.min.css"),
        `@media (prefers-color-scheme: dark) { ${css("appearance/themes/midnight/theme.css")} ${css(highlightPath + "styles/github-dark.min.css")} }`,
        require("sass").compile(path.join(appRoot, "src/assets/scss/quicklook.scss")).css];
    fs.writeFileSync(path.join(output, "preview.css"), styles.join("\n"));
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
    const fontFiles = Object.fromEntries([...attachments].map(name => [name, katexPath + "fonts/" + name]));
    fs.writeFileSync(path.join(output, "resources.json"), JSON.stringify({scripts, fonts: fontFiles}));
    return [...files, "preview.js", "preview.css", "languages.json", "resources.json"];
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
                "-framework", "Cocoa", "-framework", "QuickLookUI", "-framework", "JavaScriptCore", "-framework", "ImageIO",
                path.join(appRoot, "quicklook/PreviewFiles.swift"), path.join(appRoot, "quicklook/PreviewFonts.swift"),
                path.join(appRoot, "quicklook/PreviewProvider.swift"), path.join(appRoot, "quicklook/PreviewRenderer.swift"),
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
