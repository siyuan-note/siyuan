const assert = require("node:assert/strict");
const path = require("node:path");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const config = require("../webpack.map");

test("map asset plugin emits shared menu controls and watches their Sass dependencies", () => {
    const assets = new Map();
    const compilation = {
        fileDependencies: new Set(),
        emitAsset(name, source) { assets.set(name, source.source()); },
        hooks: {processAssets: {tap(_options, callback) { callback(); }}},
    };
    const compiler = {hooks: {thisCompilation: {tap(_name, callback) { callback(compilation); }}}};
    const options = config({}, {mode: "production"});
    options.plugins.forEach(plugin => plugin.apply(compiler));
    const controls = assets.get("unplaced-controls.css");
    assert.equal(typeof controls, "string");
    assert.match(controls, /\.b3-menu__item/);
    assert.match(controls, /\.b3-text-field/);
    assert.match(controls, /button,\s*input,\s*select,\s*textarea\s*\{[^}]*font-size: 100%/);
    assert.doesNotMatch(controls, /@import|https?:\/\//);
    for (const name of ["_menu.scss", "_text-field.scss"]) {
        assert.ok(compilation.fileDependencies.has(path.resolve(__dirname, "../src/assets/scss/component", name)), name);
    }
    assert.ok(compilation.fileDependencies.has(path.resolve(__dirname, "../src/assets/scss/util/_reset.scss")));
    assert.equal(options.output.path, path.resolve(__dirname, "../stage/build/map"));
    assert.ok(assets.has("maplibre-gl.js"));
});

test("all desktop packages include local trusted menu resources and generated controls", () => {
    for (const name of ["electron-builder.yml", "electron-builder-arm64.yml", "electron-builder-linux.yml",
        "electron-builder-linux-arm64.yml", "electron-builder-darwin.yml", "electron-builder-darwin-arm64.yml"]) {
        const source = readFileSync(path.resolve(__dirname, "..", name), "utf8");
        assert.match(source, /files:\s*\n\s*- "electron"/, name);
        assert.match(source, /from: "stage"\s*\n\s*to: "stage"/, name);
    }
});
