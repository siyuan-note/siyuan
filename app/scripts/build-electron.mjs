// 构建桌面端打包输入 electron-dist：主进程打成单文件，渲染脚本与静态资源原样复制。
// 源码与测试保留在 electron/，electron-builder 只读取 electron-dist，测试不会进入安装包。
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import webpack from "webpack";
import config from "../webpack.electron.js";
import packageContent from "./electronPackageContent.js";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceDir = path.join(appRoot, "electron");
const staticSourceDir = path.join(sourceDir, "static");
const markdownSourceDir = path.join(sourceDir, "markdown");
const outputDir = path.join(appRoot, "electron-dist");
const staticOutputDir = path.join(outputDir, "static");
const {rendererScripts, staticAssets, markdownRuntimeAssets} = packageContent;

const copyAssets = () => {
    fs.mkdirSync(staticOutputDir, {recursive: true});
    for (const name of [...rendererScripts, ...staticAssets]) {
        fs.copyFileSync(path.join(staticSourceDir, name), path.join(staticOutputDir, name));
    }
    // Markdown 模块按 __dirname 加载这两份运行期文件，合并后 __dirname 就是产物目录。
    for (const name of markdownRuntimeAssets) {
        fs.copyFileSync(path.join(markdownSourceDir, name), path.join(outputDir, name));
    }
};

// 构建失败时设置退出码并保留已输出内容，便于定位是哪一个入口出错。
const report = (error, stats) => {
    if (error) {
        console.error(error);
        process.exitCode = 1;
        return;
    }
    if (stats.hasErrors()) {
        console.error(stats.toString({all: false, errors: true}));
        process.exitCode = 1;
        return;
    }
    // watch 模式下静态资源可能被单独修改，每次重建后重新复制。
    copyAssets();
    console.log(stats.toString({all: false, assets: true, timings: true}));
};

const watch = process.argv.includes("--watch");
if (!watch) {
    fs.rmSync(outputDir, {recursive: true, force: true});
}
copyAssets();
const compiler = webpack(config);
// 复制资源不参与模块导入，需显式登记才能触发监听重建。
compiler.hooks.afterCompile.tap("ElectronRuntimeAssets", compilation => {
    for (const name of [...rendererScripts, ...staticAssets]) {
        compilation.fileDependencies.add(path.join(staticSourceDir, name));
    }
    for (const name of markdownRuntimeAssets) {
        compilation.fileDependencies.add(path.join(markdownSourceDir, name));
    }
});
if (watch) {
    compiler.watch({}, report);
} else {
    compiler.run((error, stats) => {
        report(error, stats);
        compiler.close(() => {});
    });
}
