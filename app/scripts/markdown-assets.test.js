const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {test} = require("node:test");
const vm = require("node:vm");
const {markdownAssetFiles, prepareMarkdownAssets, MarkdownAssetsPlugin, REQUIRED_ASSETS, SHARED_LUTE_ASSET, LEGACY_LUTE_ASSET} = require("./markdown-assets");

const temporary = t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-markdown-assets-"));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        fs.rmSync(root, {recursive: true, force: true});
    });
    return root;
};

test("offline Markdown assets include enabled renderers without duplicating the installed shared Lute", t => {
    const output = temporary(t);
    const names = prepareMarkdownAssets(output);
    for (const name of REQUIRED_ASSETS) assert.ok(names.includes(name), name);
    assert.equal(fs.existsSync(path.join(output, LEGACY_LUTE_ASSET)), false);
    assert.ok(names.some(name => name.startsWith("vditor/dist/js/katex/fonts/")));
    assert.ok(!names.some(name => /\.(?:map|d\.ts)$/.test(name)));
    assert.ok(!names.some(name => /\/(?:mermaid|echarts|mathjax|plantuml)\//.test(name)));
    assert.ok(!names.some(name => name.startsWith("vditor/dist/images/emoji/")), "nonportable image emoji are not bundled");
    const luteAssets = markdownAssetFiles().filter(file => file.name.endsWith("/lute.min.js"));
    assert.equal(luteAssets.length, 0, "native hosts serve the single installed Lute through an exact URL alias");
    for (const file of names.filter(name => name.endsWith(".css"))) {
        const css = fs.readFileSync(path.join(output, file), "utf8");
        for (const match of css.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)) {
            if (match[1].startsWith("data:")) continue;
            assert.ok(!/^(?:https?:)?\/\//.test(match[1]), `${file}: external CSS resource ${match[1]}`);
            const referenced = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1].split(/[?#]/)[0]));
            assert.ok(names.includes(referenced), `${file}: missing ${referenced}`);
        }
    }
});

test("asset preparation removes a legacy Lute copy without deleting unrelated output", t => {
    const root = temporary(t);
    const legacy = path.join(root, LEGACY_LUTE_ASSET);
    fs.mkdirSync(path.dirname(legacy), {recursive: true});
    fs.writeFileSync(legacy, "old copy");
    const emoji = path.join(root, "vditor/dist/images/emoji/doge.png");
    fs.mkdirSync(path.dirname(emoji), {recursive: true});
    fs.writeFileSync(emoji, "old emoji");
    fs.writeFileSync(path.join(root, "open-window.js"), "keep");
    prepareMarkdownAssets(root);
    assert.equal(fs.existsSync(legacy), false);
    assert.equal(fs.existsSync(emoji), false);
    assert.equal(fs.readFileSync(path.join(root, "open-window.js"), "utf8"), "keep");
});

test("legacy cleanup never follows an output directory link outside its root", {skip: process.platform === "win32"}, t => {
    const root = temporary(t);
    const outside = temporary(t);
    fs.mkdirSync(path.join(root, "vditor/dist/js"), {recursive: true});
    fs.writeFileSync(path.join(outside, "lute.min.js"), "private");
    fs.symlinkSync(outside, path.join(root, "vditor/dist/js/lute"), "dir");
    assert.throws(() => prepareMarkdownAssets(root), /Linked obsolete Markdown asset/);
    assert.equal(fs.readFileSync(path.join(outside, "lute.min.js"), "utf8"), "private");
});

test("offline preparation rejects a missing shared Lute before creating output", t => {
    const root = temporary(t);
    const output = path.join(root, "output");
    assert.throws(() => prepareMarkdownAssets(output, {lutePath: path.join(root, "missing-lute.js")}), /ENOENT/);
    assert.equal(fs.existsSync(output), false);
});

test("standalone asset CLI prepares a requested directory without Webpack", t => {
    const output = temporary(t);
    const result = spawnSync(process.execPath, [path.join(__dirname, "markdown-assets.js"), output], {encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(output, "vditor/LICENSE")));
    assert.ok(!fs.existsSync(path.join(output, "index.html")), "asset preparation must not pretend to build the page");
});

test("Webpack emits the same offline manifest and watches the shared sources", t => {
    let compilationHook;
    let assetsHook;
    let afterEmit;
    const emitted = new Map();
    const compilation = {fileDependencies: new Set(),
        hooks: {processAssets: {tap: (options, callback) => { assetsHook = callback; }}},
        emitAsset: (name, source) => emitted.set(name, source.data)};
    const compiler = {options: {output: {path: temporary(t)}}, hooks: {
        thisCompilation: {tap: (name, callback) => { compilationHook = callback; }},
        afterEmit: {tap: (name, callback) => {afterEmit = callback;}},
    }, webpack: {Compilation: {PROCESS_ASSETS_STAGE_ADDITIONAL: 0}, sources: {RawSource: class {constructor(data) {this.data = data;}}}}};
    new MarkdownAssetsPlugin().apply(compiler);
    compilationHook(compilation);
    assetsHook();
    const files = markdownAssetFiles();
    assert.deepEqual([...emitted.keys()], files.map(file => file.name));
    assert.ok(compilation.fileDependencies.has(path.resolve(__dirname, "..", SHARED_LUTE_ASSET)));
    afterEmit();
    for (const file of files) {
        assert.ok(compilation.fileDependencies.has(file.source));
        assert.deepEqual(emitted.get(file.name), fs.readFileSync(file.source));
    }
});

test("Markdown configuration is an independent web entry included by development and aggregate builds", () => {
    const makeConfig = require("../webpack.markdown");
    const config = makeConfig({}, {mode: "production"});
    assert.equal(config.target, "web");
    assert.deepEqual(config.entry, {main: "./src/markdown/index.ts"});
    assert.equal(config.output.publicPath, "./");
    assert.equal(config.output.path, path.resolve(__dirname, "../stage/build/markdown"));
    assert.equal(config.optimization.splitChunks, false);
    assert.equal(config.optimization.runtimeChunk, false);
    assert.equal(config.watch, false);
    assert.equal(makeConfig({}, {mode: "development"}).watch, true);
    const pkg = require("../package.json");
    assert.equal(pkg.devDependencies.vditor, "4.0.2-alpha.4");
    assert.match(pkg.scripts.dev, /--config webpack\.markdown\.js/);
    assert.match(pkg.scripts["build:markdown"], /webpack\.markdown\.js/);
    assert.match(pkg.scripts.build, /\/build:\.\*\//);
});

test("the real standalone Webpack dependency graph compiles in an isolated output directory", {timeout: 90000}, async t => {
    const config = require("../webpack.markdown")({}, {mode: "development"});
    config.context = path.resolve(__dirname, "..");
    config.watch = false;
    config.devtool = false;
    config.output = {...config.output, path: temporary(t)};
    const compiler = require("webpack")(config);
    try {
        const stats = await new Promise((resolve, reject) => compiler.run((error, value) => error ? reject(error) : resolve(value)));
        assert.equal(stats.hasErrors(), false, stats.toString({all: false, errors: true}));
        assert.ok(fs.existsSync(path.join(config.output.path, "index.html")));
        assert.equal(fs.existsSync(path.join(config.output.path, LEGACY_LUTE_ASSET)), false);
        const modules = stats.toJson({all: false, modules: true}).modules;
        for (const name of ["DocTreeModel.ts", "menuPosition.ts"]) assert.ok(modules.some(value => value.name?.includes(name)), name);
        // Simulate stale output from a previous build while watch preservation is active.
        const legacy = path.join(config.output.path, LEGACY_LUTE_ASSET);
        fs.mkdirSync(path.dirname(legacy), {recursive: true});
        fs.writeFileSync(legacy, "obsolete copy");
        const emoji = path.join(config.output.path, "vditor/dist/images/emoji/doge.png");
        fs.mkdirSync(path.dirname(emoji), {recursive: true});
        fs.writeFileSync(emoji, "obsolete image");
        fs.writeFileSync(path.join(config.output.path, "open-window.js"), "keep");
        const rebuilt = await new Promise((resolve, reject) => compiler.run((error, value) => error ? reject(error) : resolve(value)));
        assert.equal(rebuilt.hasErrors(), false, rebuilt.toString({all: false, errors: true}));
        assert.equal(fs.existsSync(legacy), false);
        assert.equal(fs.existsSync(emoji), false);
        assert.equal(fs.existsSync(path.join(config.output.path, "open-window.js")), true);
    } finally {await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));}
});

test("production Markdown assets preserve vendor globals and highlight JavaScript", {timeout: 90000}, async t => {
    const config = require("../webpack.markdown")({}, {mode: "production"});
    config.context = path.resolve(__dirname, "..");
    config.output = {...config.output, path: temporary(t)};
    const compiler = require("webpack")(config);
    try {
        const stats = await new Promise((resolve, reject) => compiler.run((error, value) => error ? reject(error) : resolve(value)));
        assert.equal(stats.hasErrors(), false, stats.toString({all: false, errors: true}));
        for (const file of markdownAssetFiles()) {
            assert.ok(fs.readFileSync(path.join(config.output.path, file.name)).equals(fs.readFileSync(file.source)),
                `production changed offline asset ${file.name}`);
        }
        const context = vm.createContext({});
        for (const filename of ["highlight.min.js", "third-languages.js"]) {
            vm.runInContext(fs.readFileSync(path.join(config.output.path, "vditor/dist/js/highlight.js", filename), "utf8"),
                context, {filename, timeout: 15000});
        }
        assert.equal(typeof context.hljs.highlight, "function");
        assert.ok(context.hljs.getLanguage("yul"), "third-party grammars register on the shared global");
        const html = context.hljs.highlight("document.body.insertAdjacentHTML('afterbegin', ``);", {language: "js"}).value;
        assert.match(html, /hljs-title function_/);
        assert.match(html, /hljs-string/);
    } finally {await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));}
});
