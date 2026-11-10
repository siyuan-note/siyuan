// 桌面端 pre-boot 窗口（init.html / workspace.html / connections.html）共享脚本
// 由各 HTML 通过 <script src="window.js"></script> 引入，依赖 nodeIntegration: true
// 简体中文用 ld246.com，其他语言用 liuyun.io
//
// 文案来源共三处，互不覆盖，改动时必须分清：
//   1. window-languages.json：启动期窗口的文案，与本脚本同目录。这些窗口要在内核可用之前
//      渲染，拿不到内核提供的语言包，所以文案单独维护并由下面直接 require。
//   2. shared/staticMessages.ts：同样在语言包可用前弹出，自带中英双语。
//   3. appearance/langs/*.json：界面启动后的文案来源，键名与上面两处完全不同。
// 新增语言包时，还要在 window-languages.json 里补齐与现有语言相同的全部键，
// scripts/check-lang-keys.py 会校验两边语言集合一致、每个语言的键完整。
"use strict";

// 解析 URL query 参数
const getSearch = (key) => {
    if (window.location.search.indexOf("?") === -1) {
        return "";
    }
    let value = "";
    const data = window.location.search.split("?")[1].split("&");
    data.find(item => {
        const keyValue = item.split("=");
        if (keyValue[0] === key) {
            value = keyValue[1];
            return true;
        }
    });
    return value;
};

// 启动期窗口文案，与 window.js 同目录，构建时原样复制。
const I18N_BASE = require("./window-languages.json");
// 当前界面语言，由各 HTML 设置
let currentLang = decodeURIComponent(getSearch("lang"));

// 应用指定语言文案到 DOM 并返回当前语言的文案对象
const applyLang = (lang) => {
    const langData = I18N_BASE[lang] || I18N_BASE["en"];
    document.title = `${langData.title} v${getSearch("v")}`;
    document.querySelectorAll("[data-i18n]").forEach(item => {
        const key = item.getAttribute("data-i18n");
        if (langData[key]) {
            item.textContent = langData[key];
        }
    });
    // 含 HTML 标签（如 <kbd>）的文案用 innerHTML
    document.querySelectorAll("[data-i18n-html]").forEach(item => {
        const key = item.getAttribute("data-i18n-html");
        if (langData[key]) {
            item.innerHTML = langData[key];
        }
    });
    document.querySelectorAll("[data-i18n-href]").forEach(item => {
        const key = item.getAttribute("data-i18n-href");
        if (langData[key]) {
            item.href = langData[key];
        }
    });
    currentLang = lang;
    return langData;
};

// 工作空间路径校验函数
const isPartitionRootPath = (absPath) => {
    const path = require("path");
    return path.parse(absPath).root === absPath;
};

const isEmptyDir = (absPath) => {
    const fs = require("fs");
    let files;
    try {
        files = fs.readdirSync(absPath).filter(file => file !== ".DS_Store");
    } catch (err) {
        return false;
    }
    return 0 === files.length;
};

const isWorkspaceDir = (absPath) => {
    const path = require("path");
    const fs = require("fs");
    const conf = path.join(absPath, "conf", "conf.json");
    let data;
    try {
        data = fs.readFileSync(conf, "utf8");
    } catch (err) {
        return false;
    }
    return data.includes("kernelVersion");
};

const isCloudDrivePath = (absPath) => {
    const absPathLower = absPath.toLowerCase();
    return -1 < absPathLower.indexOf("onedrive") || -1 < absPathLower.indexOf("dropbox") ||
        -1 < absPathLower.indexOf("google drive") || -1 < absPathLower.indexOf("pcloud") ||
        -1 < absPathLower.indexOf("坚果云") || -1 < absPathLower.indexOf("nutstore") ||
        -1 < absPathLower.indexOf("百度网盘") || -1 < absPathLower.indexOf("baidunetdisk") ||
        -1 < absPathLower.indexOf("腾讯微云") || -1 < absPathLower.indexOf("weiyun");
};

// macOS 端对工作空间放置在 iCloud 路径下做检查 https://github.com/siyuan-note/siyuan/issues/7747
const isICloudPath = (absPath) => {
    const os = require("os");
    if ("darwin" !== os.platform()) {
        return false;
    }
    const path = require("path");
    const homePath = decodeURIComponent(getSearch("home"));
    const absPathLower = absPath.toLowerCase();
    const iCloudRoot = path.join(homePath, "Library", "Mobile Documents");
    if (!simpleCheckIcloudPath(absPath, homePath)) {
        // 简单判断无法通过则复杂验证
        const allFiles = walk(iCloudRoot);
        for (const file of allFiles) {
            if (-1 < absPathLower.indexOf(file.toLowerCase())) {
                return true;
            }
        }
    }
    return false;
};

// 简单判断 iCloud 同步目录
// 不允许放在桌面、文档或 iCloud 文件夹中，也不允许是软链接
const simpleCheckIcloudPath = (absPath, homePath) => {
    const fs = require("fs");
    const path = require("path");
    const stat = fs.lstatSync(absPath);
    if (stat.isSymbolicLink()) {
        return false;
    }
    const absPathLower = absPath.toLowerCase();
    const iCloudRoot = path.join(homePath, "Library", "Mobile Documents");
    if (absPathLower.startsWith(iCloudRoot.toLowerCase())) {
        return false;
    }
    const documentsRoot = path.join(homePath, "Documents");
    if (absPathLower.startsWith(documentsRoot.toLowerCase())) {
        return false;
    }
    const desktopRoot = path.join(homePath, "Desktop");
    if (absPathLower.startsWith(desktopRoot.toLowerCase())) {
        return false;
    }
    return true;
};

const walk = (dir, files = []) => {
    const fs = require("fs");
    const path = require("path");
    let dirFiles;
    try {
        if (!fs.existsSync(dir)) {
            console.log("dir [" + dir + "] not exists");
            return files;
        }
        dirFiles = fs.readdirSync(dir);
    } catch (e) {
        console.error("read dir [" + dir + "] failed: ", e);
        return files;
    }
    for (const f of dirFiles) {
        const stat = fs.lstatSync(dir + path.sep + f);
        if (stat.isSymbolicLink()) {
            files.push(fs.readlinkSync(dir + path.sep + f));
            continue;
        }
        if (stat.isDirectory()) {
            // 已在列表中则跳过，避免重复遍历
            if (files.includes(dir + path.sep + f)) {
                continue;
            }
            files.push(dir + path.sep + f);
            walk(dir + path.sep + f, files);
        }
    }
    return files;
};

// 选择工作空间目录并做路径校验，返回选中的路径；取消或校验失败返回 null
const chooseWorkspacePath = async (langData) => {
    const path = require("path");
    const fs = require("fs");
    const {ipcRenderer} = require("electron");

    let defaultWorkspace = path.join(decodeURIComponent(getSearch("home")), "SiYuan");
    if ("darwin" === process.platform) {
        // macOS 默认工作空间位于 ~/Library/Application Support/SiYuan
        // https://github.com/siyuan-note/siyuan/issues/17095
        defaultWorkspace = path.join(decodeURIComponent(getSearch("home")), "Library", "Application Support", "SiYuan");
    }
    if (!fs.existsSync(defaultWorkspace)) {
        fs.mkdirSync(defaultWorkspace, {mode: 0o755, recursive: true});
    }

    const result = await ipcRenderer.invoke("siyuan-get", {
        cmd: "showOpenDialog",
        defaultPath: defaultWorkspace,
        properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled) {
        return null;
    }
    const initPath = result.filePaths[0];

    if (isPartitionRootPath(initPath)) {
        alert(langData.msgPartitionRoot);
        return null;
    }
    if (!isWorkspaceDir(initPath) && !isEmptyDir(initPath)) {
        alert(langData.msgNotEmpty);
        return null;
    }
    if (isICloudPath(initPath)) {
        alert(langData.msgICloud);
        return null;
    }
    if (isCloudDrivePath(initPath)) {
        alert(langData.msgCloudDrive);
        return null;
    }
    if (!confirm(langData.msgConfirm)) {
        return null;
    }
    if (!fs.existsSync(initPath)) {
        fs.mkdirSync(initPath, {mode: 0o755, recursive: true});
    }
    return initPath;
};

// 窗口通用初始化：macOS body class、关闭/最小化按钮 IPC
const initWindowChrome = (options = {}) => {
    const {ipcRenderer} = require("electron");
    if ("darwin" === process.platform) {
        document.body.classList.add("darwin");
    }
    document.getElementById("close").addEventListener("click", () => {
        if (options.close) {
            options.close();
        } else {
            ipcRenderer.send("siyuan-first-quit");
        }
    });
    document.getElementById("min").addEventListener("click", () => {
        if (options.minimize) {
            options.minimize();
        } else {
            ipcRenderer.send("siyuan-cmd", "minimize");
        }
    });
};

window.getSearch = getSearch;
window.I18N_BASE = I18N_BASE;
window.applyLang = applyLang;
window.currentLang = currentLang;
window.isPartitionRootPath = isPartitionRootPath;
window.isEmptyDir = isEmptyDir;
window.isWorkspaceDir = isWorkspaceDir;
window.isCloudDrivePath = isCloudDrivePath;
window.isICloudPath = isICloudPath;
window.simpleCheckIcloudPath = simpleCheckIcloudPath;
window.walk = walk;
window.chooseWorkspacePath = chooseWorkspacePath;
window.initWindowChrome = initWindowChrome;
