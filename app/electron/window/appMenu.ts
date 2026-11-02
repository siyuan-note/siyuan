import * as nodePath from "node:path";
import {errorMessage} from "../shared/errors";
import * as nodeProcess from "node:process";
import * as nodeFs from "node:fs";
import * as electron from "electron";
import {state, writeLog, getArg} from "../shared/runtime";
import {loadAppMenuLanguages, resolveAppLanguage} from "../shared/language";
import type {MenuLanguages} from "../shared/language";
import {getAppWindow} from "./windowLookup";
import {toggleMainWindow, showWindow} from "./windowVisibility";
import {getActiveWindow} from "./windowRegistry";
import {toggleDevTools} from "./devToolsDock";
import type {
    BrowserWindow as ElectronBrowserWindow,
    MenuItemConstructorOptions,
} from "electron";
import {Channel} from "../shared/channels";

type TrayMenuLabels = {officialWebsite?: string; openSource?: string};

type AppMenuSync = {
    lang: string;
    readonly?: boolean;
    hotkey: Record<string, string | undefined>;
};

// 平台与应用名只在构建模板时影响样式与文案，单独给出以便测试直接断言模板。
type MenuContext = {platform?: NodeJS.Platform; appName?: string};

const trayLabels = (languages: MenuLanguages): TrayMenuLabels | undefined =>
    (languages as unknown as {_trayMenu?: TrayMenuLabels})._trayMenu;

const APP_NAME = "SiYuan";

// 前端存的快捷键是人可读符号，注册前需转换成 Electron 加速键。
const hotKey2Electron = (key?: string): string | undefined => {
    if (!key) {
        return key;
    }
    let electronKey = "";
    if (key.indexOf("⌘") > -1) {
        electronKey += "CommandOrControl+";
    }
    if (key.indexOf("⌃") > -1) {
        electronKey += "Control+";
    }
    if (key.indexOf("⇧") > -1) {
        electronKey += "Shift+";
    }
    if (key.indexOf("⌥") > -1) {
        electronKey += "Alt+";
    }
    return electronKey + key.replace("⌘", "").replace("⇧", "").replace("⌥", "").replace("⌃", "")
        .replace("←", "Left").replace("→", "Right").replace("↑", "Up").replace("↓", "Down").replace(" ", "Space")
        .replace("+", "Plus").replace("⇥", "Tab").replace("⌫", "Backspace").replace("⌦", "Delete").replace("↩", "Return");
};

const getFeedbackUrl = (lang: string): string => "zh-CN" === lang
    ? "https://ld246.com/article/1649901726096"
    : "https://liuyun.io/article/1686530886208";

const withHotkey = (hotkey?: string,
    overrideRoleDefault = false): {accelerator?: string; registerAccelerator?: boolean} => {
    if (typeof hotkey !== "string" || !hotkey.length) {
        // 空快捷键：自定义项不注册加速键；role 项需显式覆盖系统默认加速键
        return overrideRoleDefault ? {accelerator: "", registerAccelerator: false} : {};
    }
    const acc = hotKey2Electron(hotkey);
    return acc ? {accelerator: acc} : (overrideRoleDefault ? {accelerator: "", registerAccelerator: false} : {});
};

// Windows 的菜单栏不可见，但菜单项快捷键仍然生效，这里改用自定义菜单项把开发者工具停在底部。
const getDevToolsMenuItem = (label: string, platform: NodeJS.Platform): MenuItemConstructorOptions => {
    if ("win32" !== platform) {
        return {role: "toggleDevTools", label};
    }
    return {
        label,
        accelerator: "Ctrl+Shift+I",
        click: () => {
            const win = electron.BrowserWindow.getFocusedWindow() || getAppWindow();
            if (win && !win.isDestroyed()) {
                toggleDevTools(win.webContents);
            }
        },
    };
};

const buildMacAppMenuTemplate = (sync: AppMenuSync, languages: MenuLanguages,
    {platform = nodeProcess.platform, appName = APP_NAME}: MenuContext = {}): MenuItemConstructorOptions[] => [{
    role: "appMenu",
    label: appName,
    submenu: [
        {role: "about", label: languages.appMenuAbout || "About SiYuan"},
        ...(sync.readonly ? [] : [{
            label: languages.config || "Settings",
            click: () => {
                getAppWindow()?.webContents.send(Channel.SIYUAN_OPEN_SETTING);
            },
            ...withHotkey(sync.hotkey.config),
        }]),
        {type: "separator"},
        {role: "services", label: languages.appMenuServices || "Services"},
        {type: "separator"},
        {
            label: languages.toggleWin || "Hide/Show Window",
            click: () => {
                toggleMainWindow(getAppWindow());
            },
            ...withHotkey(sync.hotkey.toggleWin),
        },
        {role: "hide", label: languages.appMenuHide || "Hide SiYuan"},
        {role: "hideOthers", label: languages.appMenuHideOthers || "Hide Others"},
        {role: "unhide", label: languages.showAll || "Show All"},
        {type: "separator"},
        {role: "quit", label: languages.appMenuQuit || "Quit SiYuan"},
    ],
}, {
    role: "editMenu",
    label: languages.edit || "Edit",
    submenu: [
        {role: "undo", label: languages.undo || "Undo", ...withHotkey(sync.hotkey.undo, true)},
        {role: "redo", label: languages.redo || "Redo", ...withHotkey(sync.hotkey.redo, true)},
        {type: "separator"},
        {role: "cut", label: languages.cut || "Cut"},
        {role: "copy", label: languages.copy || "Copy"},
        {role: "paste", label: languages.paste || "Paste"},
        {role: "pasteAndMatchStyle", label: languages.pasteAsPlainText || "Paste and Match Style"},
        {type: "separator"},
        {role: "selectAll", label: languages.selectAll || "Select All"},
    ],
}, {
    role: "windowMenu",
    label: languages.appMenuWindow || "Window",
    submenu: [
        {role: "minimize", label: languages.appMenuMinimize || "Minimize"},
        {role: "zoom", label: languages.zoom || "Zoom"},
        {role: "togglefullscreen", label: languages.appMenuTogglefullscreen || "Toggle Full Screen"},
        {type: "separator"},
        {
            label: languages.appMenuBringAllToFront || "Bring All to Front",
            click: () => {
                const windows = electron.BrowserWindow.getAllWindows();
                windows.forEach((window: ElectronBrowserWindow) => showWindow(window));
                const latestActiveWindow = getActiveWindow() as ElectronBrowserWindow | undefined;
                const target = (latestActiveWindow && !latestActiveWindow.isDestroyed() && windows.includes(latestActiveWindow))
                    ? latestActiveWindow
                    : windows[0];
                target?.focus();
            },
        },
    ],
}, {
    role: "help",
    label: languages.help || "Help",
    submenu: [
        ...(sync.readonly ? [] : [{
            label: languages.userGuide || "User Guide",
            click: () => {
                getAppWindow()?.webContents.send(Channel.SIYUAN_OPEN_HELP);
            },
        }]),
        {
            label: languages.feedback || "Feedback",
            click: () => {
                electron.shell.openExternal(getFeedbackUrl(sync.lang));
            },
        },
        {
            label: trayLabels(languages)?.officialWebsite || "Visit official website",
            click: () => {
                electron.shell.openExternal("https://b3log.org/siyuan");
            },
        },
        {
            label: trayLabels(languages)?.openSource || "Visit project on GitHub",
            click: () => {
                electron.shell.openExternal("https://github.com/siyuan-note/siyuan");
            },
        },
        getDevToolsMenuItem(languages.debug || "Developer Tools", platform),
    ],
}];

// 启动阶段还没有工作空间配置，只能给出不含快捷键的通用菜单。
const buildStartupMenuTemplate = (languages: MenuLanguages,
    {platform = nodeProcess.platform}: MenuContext = {}): MenuItemConstructorOptions[] => [{
    role: "appMenu",
    label: APP_NAME,
    submenu: [
        {role: "about", label: languages.appMenuAbout},
        {type: "separator"},
        {role: "services", label: languages.appMenuServices},
        {type: "separator"},
        {role: "hide", label: languages.appMenuHide},
        {role: "hideOthers", label: languages.appMenuHideOthers},
        {role: "unhide", label: languages.showAll},
        {type: "separator"},
        {role: "quit", label: languages.appMenuQuit},
    ],
}, {
    role: "editMenu",
    label: languages.edit,
    submenu: [
        ...["undo", "redo"].map((role: string) => ({role: role as MenuItemConstructorOptions["role"], label: languages[role]})),
        {type: "separator"},
        ...["cut", "copy", "paste"].map((role: string) => ({role: role as MenuItemConstructorOptions["role"], label: languages[role]})),
        {role: "pasteAndMatchStyle", label: languages.pasteAsPlainText},
        {type: "separator"},
        {role: "selectAll", label: languages.selectAll},
    ],
}, {
    role: "windowMenu",
    label: languages.appMenuWindow,
    submenu: [
        {role: "minimize", label: languages.appMenuMinimize},
        {role: "zoom", label: languages.zoom},
        {role: "togglefullscreen", label: languages.appMenuTogglefullscreen},
        {type: "separator"},
        getDevToolsMenuItem(languages.debug as string, platform),
        {type: "separator"},
        {role: "front", label: languages.appMenuBringAllToFront},
    ],
}];

// 命令行优先于工作空间配置；远端内核不读取本地工作空间配置。
const resolveStartupMenuLanguage = ({argLang, workspaceDir, isRemote, systemLanguages,
    readConfig = (file: string) => nodeFs.readFileSync(file, "utf8")}: {
        argLang?: string;
        workspaceDir?: string;
        isRemote: boolean;
        systemLanguages: string[];
        readConfig?: (file: string) => string;
    }): string => {
    let requestedLanguage = argLang;
    if (!requestedLanguage && !isRemote && workspaceDir) {
        try {
            const config = JSON.parse(readConfig(nodePath.join(workspaceDir, "conf", "conf.json")));
            requestedLanguage = config.appearance?.lang || config.lang;
        } catch (error) {
            writeLog("load startup menu workspace language failed: " + errorMessage(error));
        }
    }
    return resolveAppLanguage(typeof requestedLanguage === "string" && requestedLanguage
        ? [requestedLanguage] : systemLanguages);
};

const setStartupApplicationMenu = (): void => {
    const language = resolveStartupMenuLanguage({
        argLang: getArg("--lang"),
        workspaceDir: getArg("--workspace") || state.startup.lastWorkspacePath,
        isRemote: !!state.startup.remoteKernelTarget,
        systemLanguages: electron.app.getPreferredSystemLanguages(),
    });
    electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(
        buildStartupMenuTemplate(loadAppMenuLanguages(language))));
};

// 工作空间就绪后由前端同步语言与快捷键。
const applyMacAppMenu = (sync: AppMenuSync | undefined): void => {
    const platform = nodeProcess.platform;
    if ("darwin" !== platform || !sync || typeof sync.lang !== "string" ||
        !sync.hotkey || typeof sync.hotkey !== "object") {
        return;
    }
    electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(
        buildMacAppMenuTemplate(sync, loadAppMenuLanguages(sync.lang), {platform, appName: electron.app.name})));
};

export {
    hotKey2Electron,
    buildMacAppMenuTemplate,
    buildStartupMenuTemplate,
    resolveStartupMenuLanguage,
    setStartupApplicationMenu,
    applyMacAppMenu,
};
