const path = require("node:path");
const webpack = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const {EsbuildPlugin} = require("esbuild-loader");
const PreserveWatchAssetsPlugin = require("./scripts/preserve-watch-assets");
const {MarkdownAssetsPlugin} = require("./scripts/markdown-assets");
const pkg = require("./package.json");

module.exports = (env, argv = {}) => {
    const production = argv.mode === "production";
    return {
        name: "markdown",
        target: "web",
        mode: argv.mode || "development",
        watch: !production,
        devtool: production ? false : "source-map",
        entry: {main: "./src/markdown/index.ts"},
        output: {
            clean: true,
            path: path.resolve(__dirname, "stage/build/markdown"),
            publicPath: "./",
            filename: "[name].[contenthash].js",
            uniqueName: "siyuan-markdown",
        },
        optimization: {
            splitChunks: false,
            runtimeChunk: false,
            minimize: production,
            minimizer: [new EsbuildPlugin({target: "es6", sourcemap: !production})],
        },
        resolve: {extensions: [".ts", ".js", ".scss", ".css"]},
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    include: path.resolve(__dirname, "src"),
                    loader: "esbuild-loader",
                    options: {target: "es6", sourcemap: !production},
                },
                {
                    test: /\.tpl$/,
                    include: path.resolve(__dirname, "src/assets/template/markdown"),
                    loader: "html-loader",
                    options: {sources: false},
                },
                {
                    test: /\.(scss|css)$/,
                    use: [MiniCssExtractPlugin.loader, {loader: "css-loader", options: {sourceMap: !production}},
                        {loader: "sass-loader", options: {sourceMap: !production}}],
                },
                {test: /\.(woff2?|ttf|eot|png|svg|gif|jpe?g)$/, type: "asset/resource",
                    generator: {filename: "assets/[name].[contenthash][ext]"}},
            ],
        },
        plugins: [
            new PreserveWatchAssetsPlugin(),
            new MarkdownAssetsPlugin(),
            new webpack.DefinePlugin({SIYUAN_VERSION: JSON.stringify(pkg.version), NODE_ENV: JSON.stringify(argv.mode)}),
            new MiniCssExtractPlugin({filename: "base.[contenthash].css"}),
            new HtmlWebpackPlugin({inject: "head", chunks: ["main"], filename: "index.html",
                template: "src/assets/template/markdown/index.tpl"}),
        ],
    };
};
