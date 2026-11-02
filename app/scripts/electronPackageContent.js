// 桌面端产物清单：构建脚本按它复制静态资源，打包内容测试按它校验，两处共用一个来源。
// 渲染脚本由各 HTML 通过 <script src> 直接加载，不能被主进程 bundle 合并。
const rendererScripts = ["window.js", "connectionEntry.js", "connections.js"];
// 静态资源按 HTML 与脚本中的相对路径引用，产物必须与 HTML 同目录；
// window-languages.json 与 window.js 同目录，两者一起原样复制。
const staticAssets = ["boot.html", "init.html", "error.html", "connections.html", "remote-auth.html",
    "workspace.html", "window.css", "connections.css", "icon.png", "window-languages.json"];
// Markdown 模块随主进程一起打进单产物，但它按 __dirname 加载沙箱 preload 与 Windows 替换脚本，
// 因此这两个文件必须在运行期与 main.js 同目录。
const markdownRuntimeAssets = ["preload.js", "replaceFile.ps1"];

module.exports = {rendererScripts, staticAssets, markdownRuntimeAssets};
