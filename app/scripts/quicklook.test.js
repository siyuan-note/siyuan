const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {prepareQuickLookResources, compileQuickLook, extensionName, extensionEntitlements} = require("./quicklook");

const temporary = t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-quicklook-test-"));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        fs.rmSync(root, {recursive: true, force: true, maxRetries: 5});
    });
    return root;
};

test("Quick Look builds a self-contained resource manifest with the installed Lute and no editor session", async t => {
    const root = temporary(t);
    const manifest = await prepareQuickLookResources(root);
    for (const file of manifest) assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
    const {SHARED_LUTE_ASSET} = require("./markdown-assets");
    assert.deepEqual(fs.readFileSync(path.join(root, "lute.min.js")), fs.readFileSync(path.join(__dirname, "..", SHARED_LUTE_ASSET)));
    assert.ok(!manifest.some(file => file === "vditor/dist/js/lute/lute.min.js"));
    const resources = JSON.parse(fs.readFileSync(path.join(root, "resources.json"), "utf8"));
    for (const file of [...resources.scripts, ...Object.values(resources.fonts)]) assert.ok(manifest.includes(file), file);
    assert.ok(manifest.includes("parse5-LICENSE") && manifest.includes("entities-LICENSE"));
    const styles = fs.readFileSync(path.join(root, "preview.css"), "utf8");
    assert.match(styles, /prefers-color-scheme: dark/);
    assert.ok(Object.keys(resources.fonts).length > 0);
    for (const name of Object.keys(resources.fonts)) assert.ok(styles.includes("cid:" + name));
    const bundle = fs.readFileSync(path.join(root, "preview.js"), "utf8");
    assert.ok(!bundle.includes("/api/"));
    assert.ok(!bundle.includes("ipcRenderer"));
    const languages = JSON.parse(fs.readFileSync(path.join(root, "languages.json"), "utf8"));
    assert.equal(Object.keys(languages).length, 22);
    for (const text of Object.values(languages)) assert.ok(text.limit && text.encoding && text.timeout && text.resource);
});

test("both Darwin packages embed the universal extension before signing, preserving Pandoc extraction", async t => {
    const root = temporary(t);
    const app = path.join(root, "SiYuan.app");
    const calls = [];
    await compileQuickLook(app, "3.8.11", (command, args) => {
        calls.push([command, args]);
        return command === "xcrun" && args[0] === "--sdk" ? "/SDK" : "";
    });
    for (const arch of ["x86_64", "arm64"]) assert.ok(calls.some(([, args]) => args.includes(`${arch}-apple-macosx12.0`)));
    const extension = path.join(app, "Contents/PlugIns", extensionName, "Contents/MacOS/SiYuanQuickLook");
    const helper = path.join(app, "Contents/MacOS/SiYuanQuickLookFonts");
    assert.deepEqual(calls.filter(([, args]) => args.includes("-verify_arch")), [
        ["xcrun", ["lipo", extension, "-verify_arch", "x86_64"]],
        ["xcrun", ["lipo", extension, "-verify_arch", "arm64"]],
        ["xcrun", ["lipo", helper, "-verify_arch", "x86_64"]],
        ["xcrun", ["lipo", helper, "-verify_arch", "arm64"]],
    ]);
    assert.equal(calls.filter(([, args]) => args.some(arg => arg.endsWith("PreviewFonts.swift"))).length, 4);
    for (const source of ["FontPublisher.swift", "FontContainer.swift"]) {
        assert.equal(calls.filter(([, args]) => args.some(arg => arg.endsWith(source))).length, 2);
    }
    const plist = fs.readFileSync(path.join(app, "Contents/PlugIns", extensionName, "Contents/Info.plist"), "utf8");
    assert.match(plist, /com\.apple\.quicklook\.preview/);
    assert.match(plist, /net\.daringfireball\.markdown/);
    assert.match(plist, /<key>QLIsDataBasedPreview<\/key><true\/>/);
    assert.ok(!plist.includes("__VERSION__"));
    for (const name of ["electron-builder-darwin.yml", "electron-builder-darwin-arm64.yml"]) {
        const config = fs.readFileSync(path.join(__dirname, "..", name), "utf8");
        assert.match(config, /afterPack: "\.\/scripts\/afterPack.js"/);
        assert.match(config, /sign: "\.\/scripts\/sign-darwin.js"/);
        assert.match(config, /minimumSystemVersion: "12.0.0"/);
    }
    const afterPack = fs.readFileSync(path.join(__dirname, "afterPack.js"), "utf8");
    assert.ok(afterPack.indexOf("await extractPackagedPandoc") < afterPack.indexOf(".compileQuickLook"));
});

test("native consumers use the signing team's shared group without Electron JIT entitlements", async t => {
    const sign = require("./sign-darwin");
    const operations = [];
    const root = temporary(t);
    const app = path.join(root, "SiYuan.app");
    const helper = path.join(app, "Contents/MacOS/SiYuanQuickLookFonts");
    fs.mkdirSync(path.dirname(helper), {recursive: true});
    fs.writeFileSync(helper, "test native binary");
    const electron = path.join(root, "electron.plist");
    fs.writeFileSync(electron, '<plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');
    const extension = path.join(app, "Contents/PlugIns", extensionName);
    await sign({app, identity: "identity", optionsForFile: () => ({entitlements: electron}),
        ignore: ["custom-string", /custom-regex/, file => file.includes("custom-function")]}, null, {
        run: (command, args) => operations.push([command, args]),
        display: () => ({status: 0, stderr: "TeamIdentifier=ABCDEFGHIJ\n"}),
        sign: async options => {
            operations.push(["parent"]);
            assert.equal(options.ignore(extension), true);
            assert.equal(options.ignore(path.join(extension, "Contents/MacOS/SiYuanQuickLook")), true);
            assert.equal(options.ignore(app), false);
            for (const file of ["custom-string", "custom-regex", "custom-function"]) assert.equal(options.ignore(file), true);
            assert.equal(options.ignore(helper), true);
            for (const target of [helper, extension, app]) {
                const entitlements = fs.readFileSync(options.optionsForFile(target).entitlements, "utf8");
                assert.match(entitlements, /ABCDEFGHIJ\.org\.b3log\.siyuan\.quicklook/);
                assert.equal(entitlements.includes("allow-jit"), target === app);
                assert.equal(entitlements.includes("app-sandbox"), target === extension);
            }
            assert.equal(options.optionsForFile(path.join(app, "Contents/Frameworks/Helper.app")).entitlements, electron);
        },
    });
    assert.equal(operations[0][0], "codesign");
    assert.equal(operations.filter(([command, args]) => command === "codesign" && args.includes("--sign")).length, 3);
    assert.ok(operations.findIndex(([command]) => command === "parent") > operations.findIndex(([, args]) => args?.at(-1) === extension));
    assert.equal(operations.filter(([command, args]) => command === "plutil" && args.includes("SiYuanQuickLookAppGroup")).length, 2);
    assert.ok(operations.at(-1)[1].includes("--deep"));
    const entitlements = fs.readFileSync(extensionEntitlements, "utf8");
    assert.equal((entitlements.match(/<key>/g) || []).length, 2);
    assert.match(entitlements, /com.apple.security.app-sandbox/);
    assert.match(entitlements, /com.apple.security.files.user-selected.read-only/);
    await assert.rejects(() => sign({app}, null, {run() {}}), /identity/);
    await assert.rejects(() => sign({app, identity: "identity"}, null, {
        run() {}, display: () => ({status: 0, stderr: "TeamIdentifier=not set\n"}),
    }), /TeamIdentifier/);
});
