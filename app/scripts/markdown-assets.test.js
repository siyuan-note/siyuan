const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {test} = require("node:test");
const {markdownAssetFiles, prepareMarkdownAssets, MarkdownAssetsPlugin, REQUIRED_ASSETS} = require("./markdown-assets");

const temporary = t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-markdown-assets-"));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        fs.rmSync(root, {recursive: true, force: true});
    });
    return root;
};

test("offline Markdown assets include every enabled runtime and use the shared Lute build", t => {
    const output = temporary(t);
    const names = prepareMarkdownAssets(output);
    for (const name of REQUIRED_ASSETS) assert.ok(names.includes(name), name);
    assert.deepEqual(fs.readFileSync(path.join(output, "vditor/dist/js/lute/lute.min.js")),
        fs.readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js")));
    assert.ok(names.some(name => name.startsWith("vditor/dist/js/katex/fonts/")));
    assert.ok(!names.some(name => /\.(?:map|d\.ts)$/.test(name)));
    assert.ok(!names.some(name => /\/(?:mermaid|echarts|mathjax|plantuml)\//.test(name)));
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

test("Webpack emits the same offline manifest and watches the shared sources", () => {
    let compilationHook;
    let assetsHook;
    const emitted = new Map();
    const compilation = {fileDependencies: new Set(),
        hooks: {processAssets: {tap: (options, callback) => { assetsHook = callback; }}},
        emitAsset: (name, source) => emitted.set(name, source.data)};
    const compiler = {hooks: {thisCompilation: {tap: (name, callback) => { compilationHook = callback; }}},
        webpack: {Compilation: {PROCESS_ASSETS_STAGE_ADDITIONAL: 0}, sources: {RawSource: class {constructor(data) {this.data = data;}}}}};
    new MarkdownAssetsPlugin().apply(compiler);
    compilationHook(compilation);
    assetsHook();
    const files = markdownAssetFiles();
    assert.deepEqual([...emitted.keys()], files.map(file => file.name));
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
    assert.equal(pkg.devDependencies.vditor, "4.0.1");
    assert.match(pkg.scripts.dev, /--config webpack\.markdown\.js/);
    assert.match(pkg.scripts["build:markdown"], /webpack\.markdown\.js/);
    assert.match(pkg.scripts.build, /\/build:\.\*\//);
});
