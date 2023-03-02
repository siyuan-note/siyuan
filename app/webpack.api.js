const path = require("path");
const webpack = require("webpack");
const pkg = require("./package.json");
const {CleanWebpackPlugin} = require("clean-webpack-plugin");
// const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;
const { EsbuildPlugin } = require("esbuild-loader");

module.exports = (env, argv) => {
  return {
    mode: argv.mode || "development",
    watch: argv.mode !== "production",
    devtool: argv.mode !== "production" ? "eval" : false,
    output: {
      publicPath: "",
      filename: "[name].js",
      path: path.resolve(__dirname, "stage/build/api"),
      libraryTarget: "umd",
      library: "SiYuanAPI",
      libraryExport: "default",
    },
    entry: {
      "api": "./src/api.ts",
    },
    optimization: {
      minimize: true,
      minimizer: [
        new EsbuildPlugin(),
      ],
    },
    resolve: {
      fallback: {
        "path": require.resolve("path-browserify"),
      },
      extensions: [".ts", ".js", ".scss"],
    },
    module: {
      rules: [
        {
          test: /\.ts(x?)$/,
          include: [path.resolve(__dirname, "src")],
          use: [
            {
              loader: "esbuild-loader",
              options: {
                minify: false,
                keepNames: true,
              },
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
        }
      ],
    },
    plugins: [
      // new BundleAnalyzerPlugin(),
      new CleanWebpackPlugin({
        cleanOnceBeforeBuildPatterns: [
          path.join(__dirname, "stage/build/api")],
      }),
      new webpack.DefinePlugin({
        NODE_ENV: JSON.stringify(argv.mode),
        SIYUAN_VERSION: JSON.stringify(pkg.version),
      }),
    ],
  };
};
