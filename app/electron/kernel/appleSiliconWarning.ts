import * as fs from "node:fs";
import * as path from "node:path";
import * as electron from "electron";
import {paths, writeLog} from "../shared/runtime";
import {resolveAppLanguage} from "../shared/language";

const prereleasePattern = /-(?:alpha|beta|rc)(?:[.-]|\d|$)/i;

/** 预发布版本只发布在 GitHub，正式版本走下载镜像。 */
const getAppleSiliconDownloadURL = (version: string): string => {
    const packageName = `siyuan-${version}-mac-arm64.dmg`;
    if (prereleasePattern.test(version)) {
        return `https://github.com/siyuan-note/siyuan/releases/download/v${version}/${packageName}`;
    }
    return `https://release.liuyun.io/siyuan/${packageName}`;
};

/** 弹窗只有一个功能按钮，取消按钮排在它之后。 */
const shouldDownloadAppleSilicon = (response: number): boolean => response === 0;

const shouldShowAppleSiliconWarning = ({
    isDevelopment,
    isPackaged,
    platform,
    runningUnderARM64Translation,
    simulateRosetta,
}: {
    isDevelopment: boolean;
    isPackaged: boolean;
    platform: NodeJS.Platform;
    runningUnderARM64Translation: boolean;
    simulateRosetta: boolean;
}): boolean => {
    if (!isPackaged && isDevelopment && simulateRosetta) {
        return true;
    }
    return isPackaged && platform === "darwin" && runningUnderARM64Translation;
};

// 每个进程最多提示一次，避免多个启动分支重复弹窗。
let warningShown = false;

// 托盘菜单与警告弹窗共用 appearance/langs 下的同一份文案。
const loadAppleSiliconWarningLanguages = (requestedLanguage: string | undefined): Record<string, string> => {
    const language = resolveAppLanguage(requestedLanguage ? [requestedLanguage] :
        electron.app.getPreferredSystemLanguages());
    const languageDir = path.join(paths.appDir, "appearance", "langs");
    try {
        const languageData = JSON.parse(fs.readFileSync(path.join(languageDir, `${language}.json`), "utf8"));
        const languages = languageData._trayMenu;
        if (languages && typeof languages.arm64TranslationTitle === "string" &&
            typeof languages.arm64TranslationMessage === "string" &&
            typeof languages.downloadAppleSilicon === "string") {
            return languages;
        }
    } catch (error) {
        writeLog("load Apple silicon warning languages failed: " + error);
    }
    return {
        arm64TranslationTitle: "Install the Apple silicon version",
        arm64TranslationMessage: "SiYuan is running the Intel version through Rosetta. This may significantly " +
            "reduce performance. Please use the Apple silicon version",
        downloadAppleSilicon: "Download the Apple silicon version",
    };
};

// 返回 false 表示不继续本次启动（需要改用 Apple silicon 版），调用方应关闭启动窗口并退出。
const showAppleSiliconWarning = async (lang?: string): Promise<boolean> => {
    if (!shouldShowAppleSiliconWarning({
        isDevelopment: paths.isDevEnv,
        isPackaged: electron.app.isPackaged,
        platform: process.platform,
        runningUnderARM64Translation: electron.app.runningUnderARM64Translation,
        simulateRosetta: paths.simulateRosetta,
    })) {
        return true;
    }
    if (warningShown) {
        return false;
    }

    warningShown = true;
    const languages = loadAppleSiliconWarningLanguages(lang);
    try {
        const {response} = await electron.dialog.showMessageBox({
            type: "warning",
            title: languages.arm64TranslationTitle,
            message: languages.arm64TranslationTitle,
            detail: languages.arm64TranslationMessage,
            buttons: [languages.downloadAppleSilicon],
            defaultId: 0,
            // 使用按钮数组之外的取消 ID，以区分关闭弹窗和点击下载。
            cancelId: 1,
            noLink: true,
        });
        if (shouldDownloadAppleSilicon(response)) {
            await electron.shell.openExternal(getAppleSiliconDownloadURL(paths.appVer));
        }
    } catch (error) {
        writeLog("show Apple silicon warning or open package download failed: " + error);
    }
    return false;
};

export {
    getAppleSiliconDownloadURL, shouldDownloadAppleSilicon, shouldShowAppleSiliconWarning, showAppleSiliconWarning,
};
