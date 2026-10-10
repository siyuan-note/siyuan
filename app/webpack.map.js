const fs = require("fs");
const path = require("path");
const webpack = require("webpack");
const {EsbuildPlugin} = require("esbuild-loader");

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
