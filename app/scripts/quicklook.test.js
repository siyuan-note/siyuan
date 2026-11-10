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
    const {markdownAssetFiles, SHARED_LUTE_ASSET} = require("./markdown-assets");
    for (const file of markdownAssetFiles()) assert.ok(manifest.includes(file.name), file.name);
    assert.deepEqual(fs.readFileSync(path.join(root, "lute.min.js")), fs.readFileSync(path.join(__dirname, "..", SHARED_LUTE_ASSET)));
    assert.ok(!manifest.some(file => file === "vditor/dist/js/lute/lute.min.js"));
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(manifest.includes(match[1]), match[1]);
    assert.match(html, /connect-src 'none'/);
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
    assert.ok(calls.some(([, args]) => args.includes("-verify_arch") && args.includes("x86_64") && args.includes("arm64")));
    const plist = fs.readFileSync(path.join(app, "Contents/PlugIns", extensionName, "Contents/Info.plist"), "utf8");
    assert.match(plist, /com\.apple\.quicklook\.preview/);
    assert.match(plist, /net\.daringfireball\.markdown/);
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

test("the native extension is signed with read-only sandbox entitlements before the enclosing app", async () => {
    const sign = require("./sign-darwin");
    const operations = [];
    const app = path.resolve("SiYuan.app");
    const extension = path.join(app, "Contents/PlugIns", extensionName);
    await sign({app, identity: "identity", optionsForFile: () => ({entitlements: "electron.plist"}), ignore: () => false}, null, {
        run: (command, args) => operations.push([command, args]),
        sign: async options => {
            operations.push(["parent"]);
            assert.equal(options.ignore(extension), true);
            assert.equal(options.ignore(path.join(extension, "Contents/MacOS/SiYuanQuickLook")), true);
            assert.equal(options.ignore(app), false);
            assert.equal(options.optionsForFile(extension).entitlements, extensionEntitlements);
            assert.equal(options.optionsForFile(app).entitlements, "electron.plist");
        },
    });
    assert.equal(operations[0][0], "codesign");
    assert.equal(operations[0][1].at(-1), extension);
    assert.equal(operations[2][0], "parent");
    assert.ok(operations.at(-1)[1].includes("--deep"));
    const entitlements = fs.readFileSync(extensionEntitlements, "utf8");
    assert.equal((entitlements.match(/<key>/g) || []).length, 2);
    assert.match(entitlements, /com.apple.security.app-sandbox/);
    assert.match(entitlements, /com.apple.security.files.user-selected.read-only/);
    await assert.rejects(() => sign({app}, null, {run() {}}), /identity/);
});
