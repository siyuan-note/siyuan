const assert = require("node:assert/strict");
const path = require("node:path");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const config = require("../webpack.map");
const sass = require("sass");
const postcss = require("postcss");

const emitAssets = () => {
    const assets = new Map();
    const compilation = {
        fileDependencies: new Set(),
        emitAsset(name, source) { assets.set(name, source.source()); },
        hooks: {processAssets: {tap(_options, callback) { callback(); }}},
    };
    const compiler = {hooks: {thisCompilation: {tap(_name, callback) { callback(compilation); }}}};
    const options = config({}, {mode: "production"});
    options.plugins.forEach(plugin => plugin.apply(compiler));
    return {assets, compilation, options};
};

test("map asset plugin emits shared menu controls and watches their Sass and built-in theme dependencies", () => {
    const {assets, compilation, options} = emitAssets();
    const controls = assets.get("unplaced-controls.css");
    assert.equal(typeof controls, "string");
    assert.match(controls, /\.b3-menu__item/);
    assert.match(controls, /\.b3-text-field/);
    assert.match(controls, /button,\s*input,\s*select,\s*textarea\s*\{[^}]*font-size: 100%/);
    assert.doesNotMatch(controls, /@import|https?:\/\//);
    for (const name of ["_menu.scss", "_text-field.scss", "_button.scss", "_counter.scss", "_record-inbox.scss"]) {
        assert.ok(compilation.fileDependencies.has(path.resolve(__dirname, "../src/assets/scss/component", name)), name);
    }
    assert.ok(compilation.fileDependencies.has(path.resolve(__dirname, "../src/assets/scss/util/_reset.scss")));
    for (const name of ["daylight", "midnight"]) {
        assert.ok(compilation.fileDependencies.has(path.resolve(__dirname, "../appearance/themes", name, "theme.css")), name);
    }
    assert.ok(compilation.fileDependencies.has(path.resolve(__dirname, "../electron/mapUnplaced/menu.css")));
    assert.equal(options.output.path, path.resolve(__dirname, "../stage/build/map"));
    assert.ok(assets.has("maplibre-gl.js"));
});

test("trusted menu shares calendar content geometry and built-in theme values without remote resource styles", () => {
    const {assets} = emitAssets();
    const controls = postcss.parse(assets.get("unplaced-controls.css"));
    const calendar = postcss.parse(sass.compile(path.resolve(__dirname, "../src/assets/scss/business/_av-calendar.scss"),
        {logger: sass.Logger.silent}).css);
    const declarations = (root, selector) => {
        const result = {};
        root.walkRules(rule => {
            if (rule.selectors.includes(selector)) rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
        });
        return result;
    };
    for (const suffix of ["-head", "-head .b3-menu__label", "-search", "-search .b3-text-field", "-empty", "-more"]) {
        const expected = declarations(calendar, "#commonMenu .av__calendar-undated" + suffix);
        assert.ok(Object.keys(expected).length, suffix);
        assert.deepEqual(declarations(controls, ".av-records-panel" + suffix), expected, suffix);
    }
    assert.equal(declarations(controls, ".av-records-panel-list")["min-height"], "36px");
    assert.equal(declarations(controls, ".av-records-panel-list")["max-height"], "360px");
    assert.equal(declarations(controls, ".b3-menu__item")["line-height"], "28px");
    assert.equal(declarations(controls, ".counter")["height"], "22px");
    assert.equal(declarations(controls, ".counter--bg")["background-color"], "var(--b3-theme-surface)");
    assert.equal(declarations(controls, ".av-records-panel-item .b3-menu__label")["text-overflow"], "ellipsis");
    for (const [mode, theme] of [["light", "daylight"], ["dark", "midnight"]]) {
        const source = postcss.parse(readFileSync(path.resolve(__dirname, "../appearance/themes", theme, "theme.css"), "utf8"));
        const expected = declarations(source, ":root");
        const actual = declarations(controls, ':root[data-theme="' + mode + '"]');
        for (const name of ["--b3-font-size", "--b3-font-family", "--b3-menu-background", "--b3-menu-icon-color",
            "--b3-theme-background", "--b3-theme-surface-lighter", "--b3-border-radius", "--b3-border-radius-b", "--b3-dialog-shadow"]) {
            assert.equal(actual[name], expected[name], mode + " " + name);
        }
        for (const value of Object.values(actual)) {
            for (const reference of value.matchAll(/var\((--[\w-]+)/g)) assert.ok(actual[reference[1]], reference[1]);
        }
    }
    assert.doesNotMatch(assets.get("unplaced-controls.css"), /url\s*\(|@import|https?:\/\//i);
    assert.doesNotMatch(readFileSync(path.resolve(__dirname, "../electron/mapUnplaced/menu.css"), "utf8"),
        /--b3-(?:theme-|menu-|border-|dialog-)|font-family\s*:/);
});

test("trusted menu embeds only the fixed repository file and open symbols", () => {
    const template = readFileSync(path.resolve(__dirname, "../electron/mapUnplaced/menu.html"), "utf8");
    const source = readFileSync(path.resolve(__dirname, "../appearance/icons/litheness/icon.js"), "utf8");
    for (const name of ["iconFile", "iconOpen"]) {
        const symbol = new RegExp('<symbol id="' + name + '"[^>]*>[\\s\\S]*?<\\/symbol>');
        assert.equal(template.match(symbol)?.[0].replace(/\s+/g, " "), source.match(symbol)?.[0].replace(/\s+/g, " "), name);
    }
    assert.equal((template.match(/<symbol /g) || []).length, 2);
    assert.doesNotMatch(template, /<svg[^>]*(?:on\w+=)|<(?:iframe|image)|href="(?:https?:)?\/\//i);
});

test("all desktop packages include local trusted menu resources and generated controls", () => {
    for (const name of ["electron-builder.yml", "electron-builder-arm64.yml", "electron-builder-linux.yml",
        "electron-builder-linux-arm64.yml", "electron-builder-darwin.yml", "electron-builder-darwin-arm64.yml"]) {
        const source = readFileSync(path.resolve(__dirname, "..", name), "utf8");
        assert.match(source, /files:\s*\n\s*- "electron"/, name);
        assert.match(source, /from: "stage"\s*\n\s*to: "stage"/, name);
    }
});
