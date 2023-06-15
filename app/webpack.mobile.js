const path = require("path");
const webpack = require("webpack");
const pkg = require("./package.json");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const {CleanWebpackPlugin} = require("clean-webpack-plugin");
// const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;
const {EsbuildPlugin} = require("esbuild-loader");

module.exports = (env, argv) => {
    return {
        mode: argv.mode || "development",
        watch: argv.mode !== "production",
        devtool: argv.mode !== "production" ? "eval" : false,
        output: {
            // 不能使用 auto，否则 ios 导出图片获取不到 css。 https://github.com/siyuan-note/siyuan/issues/8532
            publicPath: "/stage/build/mobile/",
            filename: "[name].[chunkhash].js",
            path: path.resolve(__dirname, "stage/build/mobile"),
        },
        entry: {
            "main": "./src/mobile/index.ts",
        },
        optimization: {
            minimize: true,
            minimizer: [
                new EsbuildPlugin({target: "es6"}),
            ],
        },
        resolve: {
            fallback: {
                "path": require.resolve("path-browserify"),
            },
            extensions: [".ts", ".js", ".tpl", ".scss"],
        },
        module: {
            rules: [
                {
                    test: /\.tpl/,
                    include: [
                        path.resolve(__dirname, "src/assets/template/mobile/index.tpl")],
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
                                target: "es6",
                            }
                        },
                        {
                            loader: "ifdef-loader",
                            options: {
                                "ifdef-verbose": false,
                                BROWSER: true,
                                MOBILE: true,
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
                        },
                        {
                            loader: "sass-loader", // compiles Sass to CSS
                        },
                    ],
                },
                {
                    test: /\.woff$/,
                    type: "asset/resource",
                    generator: {
                        filename: "../fonts/JetBrainsMono-Regular.woff",
                    },
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
            // new BundleAnalyzerPlugin(),
            new CleanWebpackPlugin({
                cleanStaleWebpackAssets: false,
                cleanOnceBeforeBuildPatterns: [
                    path.join(__dirname, "stage/build/mobile")],
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
                template: "src/assets/template/mobile/index.tpl",
            }),
        ],
    };
};
