const path = require("path");
const webpack = require("webpack");
const pkg = require("./package.json");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const {CleanWebpackPlugin} = require("clean-webpack-plugin");
const {EsbuildPlugin} = require("esbuild-loader");

module.exports = (env, argv) => {
    return {
        mode: argv.mode || "development",
        watch: argv.mode !== "production",
        devtool: argv.mode !== "production" ? "eval-source-map" : false,
        target: "electron-renderer",
        output: {
            publicPath: "auto",
            filename: "[name].[chunkhash].js",
            path: path.resolve(__dirname, "stage/build/app"),
        },
        entry: {
            "main": "./src/index.ts",
            "window": "./src/window/index.ts",
        },
        resolve: {
            extensions: [".ts", ".js", ".tpl", ".scss", ".png", ".svg"],
        },
        optimization: {
            minimize: argv.mode === "production",
            minimizer: [
                new EsbuildPlugin({
                    target: "es2021",
                    sourcemap: argv.mode !== "production",
                }),
            ],
            // 把 webpack runtime 提到独立小文件，避免业务码变动连带改变 vendors/common 的 chunkhash
            runtimeChunk: "single",
            splitChunks: {
                chunks: "all",
                minSize: 20000,
                cacheGroups: {
                    // 第三方依赖统一进 vendors chunk（dayjs、iconv-lite、@tiptap/* 等）
                    vendors: {
                        test: /[\\/]node_modules[\\/]/,
                        name: "vendors",
                        chunks: "all",
                        priority: 10,
                    },
                    // main 与 window 两入口共享的业务码（constants / layout / protyle / editor / plugin ...），
                    // 提取到 common chunk 以消除两入口约 90% 的重复打包
                    common: {
                        name: "common",
                        chunks: "all",
                        minChunks: 2,
                        priority: 5,
                        reuseExistingChunk: true,
                    },
                },
            },
        },
        module: {
            rules: [
                {
                    test: /\.tpl/,
                    include: [
                        path.resolve(__dirname, "src/assets/template/app/index.tpl"),
                        path.resolve(__dirname, "src/assets/template/app/window.tpl")],
                    loader: "html-loader",
                    options: {
                        sources: false,
                    },
                },
                {
                    test: /\.ts(x?)$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [
                        {
                            loader: "esbuild-loader",
                            options: {
                                target: "es2021",
                                sourcemap: argv.mode !== "production",
                            },
                        },
                        {
                            loader: "ifdef-loader", options: {
                                BROWSER: false,
                                MOBILE: false,
                            },
                        },
                    ],
                },
                {
                    test: /\.scss$/,
                    include: [
                        path.resolve(__dirname, "src/assets/scss"),
                    ],
                    use: [
                        MiniCssExtractPlugin.loader,
                        {
                            loader: "css-loader", // translates CSS into CommonJS
                            options: {
                                sourceMap: argv.mode !== "production",
                            },
                        },
                        {
                            loader: "sass-loader", // compiles Sass to CSS
                            options: {
                                sourceMap: argv.mode !== "production",
                            },
                        },
                    ],
                },
                {
                    test: /\.(png|svg)$/,
                    use: [
                        {
                            loader: "file-loader",
                            options: {
                                name: "[name].[ext]",
                                outputPath: "../../",
                            },
                        },
                    ],
                },
            ],
        },
        plugins: [
            new CleanWebpackPlugin({
                cleanStaleWebpackAssets: false,
                cleanOnceBeforeBuildPatterns: [
                    path.join(__dirname, "stage/build/app")],
            }),
            new webpack.DefinePlugin({
                SIYUAN_VERSION: JSON.stringify(pkg.version),
                NODE_ENV: JSON.stringify(argv.mode),
            }),
            new MiniCssExtractPlugin({
                filename: "base.[contenthash].css",
            }),
            new HtmlWebpackPlugin({
                inject: "head",
                chunks: ["main"],
                filename: "index.html",
                template: "src/assets/template/app/index.tpl",
            }),
            new HtmlWebpackPlugin({
                inject: "head",
                chunks: ["window"],
                filename: "window.html",
                template: "src/assets/template/app/window.tpl",
            }),
        ],
    };
};
