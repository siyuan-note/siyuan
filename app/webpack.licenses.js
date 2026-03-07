/**
 * 仅用于 pnpm gen:licenses：与正常 app 打包相同入口与依赖树，只额外产出 oss-licenses.json（供 merge-oss-licenses.js 合并为 credits.html）。
 * 不生成 index/window.html，仅用于扫描前端依赖。
 */
const path = require("path");
const webpack = require("webpack");
const pkg = require("./package.json");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const {CleanWebpackPlugin} = require("clean-webpack-plugin");
const {EsbuildPlugin} = require("esbuild-loader");
const LicensePlugin = require("webpack-license-plugin");

module.exports = (env, argv) => {
    const mode = argv.mode || "production";
    return {
        mode,
        devtool: false,
        target: "electron-renderer",
        output: {
            publicPath: "auto",
            filename: "[name].[chunkhash].js",
            path: path.resolve(__dirname, "stage/build/app"),
        },
        entry: {
            main: "./src/index.ts",
            window: "./src/window/index.ts",
        },
        resolve: {
            extensions: [".ts", ".js", ".tpl", ".scss", ".png", ".svg"],
        },
        optimization: {
            minimize: mode === "production",
            minimizer: [
                new EsbuildPlugin({
                    target: "es2021",
                    sourcemap: false,
                }),
            ],
        },
        module: {
            rules: [
                {
                    test: /\.tpl/,
                    include: [
                        path.resolve(__dirname, "src/assets/template/app/index.tpl"),
                        path.resolve(__dirname, "src/assets/template/app/window.tpl"),
                    ],
                    loader: "html-loader",
                    options: { sources: false },
                },
                {
                    test: /\.ts(x?)$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [
                        {
                            loader: "esbuild-loader",
                            options: { target: "es2021", sourcemap: false },
                        },
                        {
                            loader: "ifdef-loader",
                            options: { BROWSER: false, MOBILE: false },
                        },
                    ],
                },
                {
                    test: /\.scss$/,
                    include: [path.resolve(__dirname, "src/assets/scss")],
                    use: [
                        MiniCssExtractPlugin.loader,
                        { loader: "css-loader", options: { sourceMap: false } },
                        { loader: "sass-loader", options: { sourceMap: false } },
                    ],
                },
                {
                    test: /\.(png|svg)$/,
                    use: [
                        {
                            loader: "file-loader",
                            options: { name: "[name].[ext]", outputPath: "../../" },
                        },
                    ],
                },
            ],
        },
        plugins: [
            new CleanWebpackPlugin({
                cleanStaleWebpackAssets: false,
                cleanOnceBeforeBuildPatterns: [path.join(__dirname, "stage/build/app")],
            }),
            new webpack.DefinePlugin({
                SIYUAN_VERSION: JSON.stringify(pkg.version),
                NODE_ENV: JSON.stringify(mode),
            }),
            new MiniCssExtractPlugin({ filename: "base.[contenthash].css" }),
            new LicensePlugin({
                outputFilename: "oss-licenses.json",
                replenishDefaultLicenseTexts: true,
            }),
        ],
    };
};
