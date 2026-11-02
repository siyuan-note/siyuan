// 桌面端产物清单：构建脚本按它复制静态资源，打包内容测试按它校验，两处共用一个来源。
// 渲染脚本由各 HTML 通过 <script src> 直接加载，不能被主进程 bundle 合并。
const rendererScripts = ["window.js", "connectionEntry.js", "connections.js"];
// 静态资源按 HTML 与脚本中的相对路径引用，产物必须与 HTML 同目录；
// window-languages.json 与 window.js 同目录，两者一起原样复制。
const staticAssets = ["boot.html", "init.html", "error.html", "connections.html", "remote-auth.html",
    "workspace.html", "window.css", "connections.css", "icon.png", "window-languages.json"];
// 沙箱 preload 是独立入口，只能引用 Electron 提供的模块，不能混入主进程运行时。
const bundledEntries = {main: "./electron/main.ts", preload: "./electron/markdown/preload.ts"};
// Markdown 模块按 __dirname 加载 Windows 替换脚本，脚本必须与主进程产物同目录。
const markdownRuntimeAssets = ["replaceFile.ps1"];

module.exports = {rendererScripts, staticAssets, markdownRuntimeAssets, bundledEntries};
