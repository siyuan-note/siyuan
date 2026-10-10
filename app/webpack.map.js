const fs = require("fs");
const path = require("path");
const {fileURLToPath} = require("url");
const webpack = require("webpack");
const {EsbuildPlugin} = require("esbuild-loader");
const postcss = require("postcss");

// 只打包共享控件引用的内置主题变量，不加载用户 CSS、远程资源或可执行内容。
const menuTheme = (mode, controls, compilation) => {
    const themePath = path.resolve(__dirname, "appearance/themes", mode === "dark" ? "midnight" : "daylight", "theme.css");
    compilation.fileDependencies.add(themePath);
    const variables = new Map();
    postcss.parse(fs.readFileSync(themePath, "utf8")).walkRules(":root", rule => {
        rule.walkDecls(declaration => variables.set(declaration.prop, declaration.value));
    });
    const names = new Set(Array.from(controls.matchAll(/var\((--[\w-]+)/g), match => match[1]));
    const declarations = [];
    for (const name of names) {
        const value = variables.get(name);
        if (!value) continue;
        if (!/^[\w\s#.,%()"'/-]+$/.test(value) || /(?:url|expression|image|paint)\s*\(/i.test(value)) {
            throw new Error("Unsafe built-in menu theme variable: " + name);
        }
        for (const dependency of value.matchAll(/var\((--[\w-]+)/g)) names.add(dependency[1]);
        declarations.push(name + ": " + value + ";");
    }
    return ':root[data-theme="' + mode + '"] {\n' + declarations.join("\n") + "\n}\n";
};

// 地图代码独立使用 web 目标，不共享 electron-renderer 的运行时或依赖包。
class MapLibreAssetsPlugin {
    apply(compiler) {
        compiler.hooks.thisCompilation.tap("MapLibreAssetsPlugin", (compilation) => {
            compilation.hooks.processAssets.tap({name: "MapLibreAssetsPlugin",
                stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL}, () => {
                const files = {
                    "maplibre-gl.js": "maplibre-gl/dist/maplibre-gl-csp.js",
                    "maplibre-gl-csp-worker.js": "maplibre-gl/dist/maplibre-gl-csp-worker.js",
                    "maplibre-gl.css": "maplibre-gl/dist/maplibre-gl.css",
                    "maplibre-LICENSE.txt": "maplibre-gl/dist/LICENSE.txt",
                };
                for (const [name, source] of Object.entries(files)) {
                    const resolved = require.resolve(source);
                    compilation.fileDependencies.add(resolved);
                    compilation.emitAsset(name, new webpack.sources.RawSource(fs.readFileSync(resolved)));
                }
                // 可信菜单复用共享控件，运行时不加载 Sass 或远程样式。
                const sass = require("sass");
                const controls = sass.compileString('@use "../util/reset"; @use "../util/mixin"; @use "../business/block"; ' +
                    '@use "menu"; @use "text-field"; @use "button"; @use "counter"; @use "record-inbox"; ' +
                    '@include record-inbox.content("av-records-panel", 360px); ' +
                    ".av-records-panel-item .b3-menu__label { @include mixin.text-clamp(1); display: block; }", {
                    loadPaths: [path.resolve(__dirname, "src/assets/scss/component")],
                    logger: sass.Logger.silent,
                });
                for (const url of controls.loadedUrls) {
                    if (url.protocol === "file:") compilation.fileDependencies.add(fileURLToPath(url));
                }
                const menuCSSPath = path.resolve(__dirname, "electron/mapUnplaced/menu.css");
                compilation.fileDependencies.add(menuCSSPath);
                const references = controls.css + fs.readFileSync(menuCSSPath, "utf8");
                const themes = ["light", "dark"].map(mode => menuTheme(mode, references, compilation)).join("");
                compilation.emitAsset("unplaced-controls.css", new webpack.sources.RawSource(themes + controls.css));
            });
        });
    }
}

module.exports = (_env, argv = {}) => ({
    name: "map-host",
    mode: argv.mode || "development",
    watch: argv.mode !== "production",
    target: "web",
    devtool: false,
    entry: {host: "./src/protyle/render/av/map/hostEntry.ts", wrapper: "./src/protyle/render/av/map/wrapperEntry.ts"},
    output: {
        path: path.resolve(__dirname, "stage/build/map"),
        filename: "[name].js",
        publicPath: "/stage/build/map/",
        globalObject: "globalThis",
        clean: true,
    },
    resolve: {extensions: [".ts", ".js"]},
    module: {rules: [{test: /\.ts$/, include: path.resolve(__dirname, "src/protyle/render/av/map"),
        loader: "esbuild-loader", options: {target: "es2021"}}]},
    optimization: {
        minimize: argv.mode === "production",
        minimizer: [new EsbuildPlugin({target: "es2021"})],
        splitChunks: false,
        runtimeChunk: false,
    },
    plugins: [new MapLibreAssetsPlugin()],
});
