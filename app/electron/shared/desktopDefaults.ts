// 跨层共用的桌面固定值：最小窗口尺寸、应用图标路径、桌面 UA 与本机页面 webPreferences。
import * as path from "node:path";
import {paths} from "./runtime";
import type {WebPreferences} from "electron";

/** 主窗口、独立文档窗口与设置窗口共用的最小尺寸。 */
const MIN_WINDOW_WIDTH = 493;
const MIN_WINDOW_HEIGHT = 376;

/** 应用图标；打包时 stage 位于资源根，开发时位于 app 目录。 */
const appIconPath = (): string => path.join(paths.appDir, "stage", "icon-large.png");

/** 内核与网页请求据此识别桌面端；base 为窗口原有的 UA。 */
const desktopUserAgent = (appVer: string, base: string): string =>
    "SiYuan/" + appVer + " https://b3log.org/siyuan Electron " + base;

/** 本机 HTML 页面（启动页、错误页、导出预览）整页信任本地脚本。 */
const LOCAL_PAGE_WEB_PREFERENCES: WebPreferences = {
    nodeIntegration: true,
    webviewTag: true,
    webSecurity: false,
    contextIsolation: false,
};

export {MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT, appIconPath, desktopUserAgent, LOCAL_PAGE_WEB_PREFERENCES};
