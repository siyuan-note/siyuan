const path = require("path");
const {bundledEntries} = require("./scripts/electronPackageContent");

// 桌面端主进程源码位于 electron/，与测试同目录；打包只读取 electron-dist/，测试因此不会进入安装包。
// 产物目录与 electron/ 同层，运行时 __dirname 的 ../ 语义保持不变。
module.exports = {
    mode: "production",
    target: "node",
    entry: bundledEntries,
    output: {
        path: path.resolve(__dirname, "electron-dist"),
        filename: "[name].js",
    },
    // 保留运行时的 __dirname 与 __filename，不替换成打包期的固定值。
    node: {
        __dirname: false,
        __filename: false,
    },
    // 主进程只依赖 electron 与 Node 内置模块，裸模块说明符一律保持外部依赖。
    externals: ({request}, callback) => {
        if (!request || request.startsWith(".") || path.isAbsolute(request)) {
            return callback();
        }
        return callback(null, "commonjs " + request);
    },
    resolve: {
        extensions: [".ts", ".js"],
    },
    module: {
        rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            use: [{loader: "esbuild-loader", options: {target: "node20"}}],
        }],
    },
    optimization: {
        minimize: false,
        // 保留运行时的 process.env.NODE_ENV 判断，开发环境标记不能被构建期常量替换。
        nodeEnv: false,
    },
    devtool: false,
    performance: {hints: false},
};
