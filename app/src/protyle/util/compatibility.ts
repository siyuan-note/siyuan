import {focusByRange} from "./selection";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {Constants} from "../../constants";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {getDefaultSubType, getDefaultType} from "../../search/getDefault";
import {hideMessage, showMessage} from "../../dialog/message";
import {isEncryptedBox, isSiYuanUriProtocol} from "../../util/pathName";
import {isBrowser} from "../../util/functions";
import type {App} from "../../index";
import {genUUID} from "../../util/genID";
import {buildBlockDOMClipboardData} from "./blockDOMClipboard";
import {buildWebClipboardHTML, getTextSiyuanFromTextHTML} from "./clipboardData";
import {prepareExternalClipboardHTML} from "./richClipboard";
import {isIOSPlatform, isIPadOSPlatform} from "./browserCompatibility";
import {canOpenExternalURL, getHostCapabilities} from "../../util/hostCapabilities";

export {encodeBase64, getTextSiyuanFromTextHTML} from "./clipboardData";

export type TSaveExportFileResult = {
    status: "success" | "canceled" | "error";
    name?: string;
    message?: string;
};

const mobileExportFileRequests = new Map<string, (result: TSaveExportFileResult) => void>();

window.handleSaveExportFileResult = (requestID: string, resultJSON: string) => {
    const resolve = mobileExportFileRequests.get(requestID);
    if (!resolve) {
        return;
    }
    mobileExportFileRequests.delete(requestID);
    try {
        const result = JSON.parse(resultJSON) as TSaveExportFileResult;
        if (["success", "canceled", "error"].includes(result.status)) {
            resolve(result);
            return;
        }
    } catch (e) {
        console.error("parse saveExportFile result failed:", e);
    }
    resolve({status: "error"});
};

const waitMobileExportFile = (callback: (requestID: string) => void) => {
    return new Promise<TSaveExportFileResult>((resolve) => {
        const requestID = genUUID();
        mobileExportFileRequests.set(requestID, resolve);
        try {
            callback(requestID);
        } catch (e) {
            mobileExportFileRequests.delete(requestID);
            console.error("saveExportFile failed:", e);
            resolve({status: "error", message: String(e)});
        }
    });
};

export const isPhablet = () => {
    return /Android|webOS|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent) || isIPhone() || isIPad();
};

export const saveExportFile = async (uri: string, msgId?: string): Promise<TSaveExportFileResult> => {
    if (!getHostCapabilities().importExport) {
        if (msgId) {
            hideMessage(msgId);
        }
        return {status: "error"};
    }
    if (!uri) {
        return {status: "error"};
    }
    /// #if !BROWSER
    let saveErrorMsgId: string | undefined;
    try {
        const resolved = new URL(uri, `${location.origin}/`);
        const pathSeg = resolved.pathname.substring(resolved.pathname.lastIndexOf("/") + 1);
        let fileName: string;
        try {
            fileName = decodeURIComponent(pathSeg);
        } catch {
            fileName = pathSeg;
        }
        if (!fileName) {
            fileName = "download";
        }
        let defaultPath = fileName;
        while (true) {
            const result = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "showSaveDialog",
                defaultPath,
                properties: ["showOverwriteConfirmation"],
            });
            if (result.canceled || !result.filePath) {
                if (msgId) {
                    hideMessage(msgId);
                }
                if (saveErrorMsgId) {
                    hideMessage(saveErrorMsgId);
                }
                return {status: "canceled"};
            }
            const copyResponse = await (await fetch("/api/export/copyExportFile", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    srcPath: resolved.pathname,
                    dest: result.filePath,
                }),
            })).json();
            if (copyResponse.code === 0) {
                break;
            }
            console.error("saveExportFile failed:", new Error(copyResponse.msg));
            if (saveErrorMsgId) {
                showMessage(window.siyuan.languages.exportFileSaveFailed, 0, "error", saveErrorMsgId);
            } else {
                saveErrorMsgId = showMessage(window.siyuan.languages.exportFileSaveFailed, 0, "error");
            }
            defaultPath = result.filePath;
        }
        if (msgId) {
            hideMessage(msgId);
        }
        if (saveErrorMsgId) {
            hideMessage(saveErrorMsgId);
        }
        showMessage(window.siyuan.languages.exported);
        return {status: "success", name: fileName};
    } catch (e) {
        if (msgId) {
            hideMessage(msgId);
        }
        console.error("saveExportFile failed:", e);
        if (saveErrorMsgId) {
            showMessage(window.siyuan.languages.exportFileSaveFailed, 0, "error", saveErrorMsgId);
        } else {
            showMessage(window.siyuan.languages.exportFileSaveFailed, 0, "error");
        }
        return {status: "error", message: String(e)};
    }
    /// #else
    try {
        let result: TSaveExportFileResult;
        let hasCompletionResult = false;
        if (isInAndroid()) {
            if (window.JSAndroid.saveExportFileV2) {
                result = await waitMobileExportFile((requestID) => {
                    window.JSAndroid.saveExportFileV2(uri, requestID);
                });
                hasCompletionResult = true;
            } else {
                window.JSAndroid.saveExportFile(uri);
                result = {status: "success"};
            }
        } else if (isInIOS()) {
            if (window.webkit.messageHandlers.saveExportFileV2) {
                result = await waitMobileExportFile((requestID) => {
                    window.webkit.messageHandlers.saveExportFileV2.postMessage({uri, requestID});
                });
                hasCompletionResult = true;
            } else {
                window.webkit.messageHandlers.saveExportFile.postMessage(uri);
                result = {status: "success"};
            }
        } else if (isInHarmony()) {
            if (window.JSHarmony.saveExportFileV2) {
                result = await waitMobileExportFile((requestID) => {
                    window.JSHarmony.saveExportFileV2(uri, requestID);
                });
                hasCompletionResult = true;
            } else {
                window.JSHarmony.saveExportFile(uri);
                result = {status: "success"};
            }
        } else {
            const openUrl = new URL(uri, `${location.origin}/`);
            openUrl.searchParams.set("download", "true");
            window.open(openUrl.href);
            result = {status: "success"};
        }
        if (msgId) {
            hideMessage(msgId);
        }
        if (hasCompletionResult && result.status === "success") {
            showMessage(window.siyuan.languages.exported);
        }
        return result;
    } catch (e) {
        if (msgId) {
            hideMessage(msgId);
        }
        showMessage("saveExportFile failed: " + e);
        return {status: "error", message: String(e)};
    }
    /// #endif
};

export const readText = () => {
    if (isInAndroid()) {
        return window.JSAndroid.readClipboard();
    } else if (isInHarmony()) {
        return window.JSHarmony.readClipboard();
    }
    if (typeof navigator.clipboard === "undefined") {
        alert(window.siyuan.languages.clipboardPermissionDenied);
        return "";
    }
    return navigator.clipboard.readText().catch(() => {
        alert(window.siyuan.languages.clipboardPermissionDenied);
    }) || "";
};

/// #if !BROWSER
export const getLocalFiles = async () => {
    // 不再支持 PC 浏览器 https://github.com/siyuan-note/siyuan/issues/7206
    let localFiles: ILocalFiles[] = [];
    if (!getHostCapabilities().localFileSystem) {
        return localFiles;
    }
    if ("darwin" === window.siyuan.config.system.os) {
        const filePaths: string[] = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
            cmd: "clipboardReadFiles",
        });
        if (Array.isArray(filePaths)) {
            localFiles = filePaths.map(path => ({path, size: null}));
        }
    } else {
        const xmlString = await fetchSyncPost("/api/clipboard/readFilePaths", {});
        if (xmlString.data.length > 0) {
            localFiles = xmlString.data;
        }
    }
    return localFiles;
};
/// #endif

export const readClipboard = async () => {
    const text: IClipboardData = {textPlain: "", textHTML: "", siyuanHTML: ""};
    if (isInAndroid()) {
        text.textPlain = window.JSAndroid.readClipboard();
        text.textHTML = window.JSAndroid.readHTMLClipboard();
        const textObj = getTextSiyuanFromTextHTML(text.textHTML);
        text.textHTML = textObj.textHtml;
        text.siyuanHTML = textObj.textSiyuan;
        if (!text.siyuanHTML) {
            text.siyuanHTML = window.JSAndroid.readSiYuanHTMLClipboard();
        }
        return text;
    }
    if (isInHarmony()) {
        text.textPlain = window.JSHarmony.readClipboard();
        text.textHTML = window.JSHarmony.readHTMLClipboard();
        const textObj = getTextSiyuanFromTextHTML(text.textHTML);
        text.textHTML = textObj.textHtml;
        text.siyuanHTML = textObj.textSiyuan;
        if (!text.siyuanHTML) {
            text.siyuanHTML = window.JSHarmony.readSiYuanHTMLClipboard();
        }
        return text;
    }
    if (typeof navigator.clipboard === "undefined") {
        alert(window.siyuan.languages.clipboardPermissionDenied);
        return text;
    }
    try {
        const clipboardContents = await navigator.clipboard.read().catch(() => {
            alert(window.siyuan.languages.clipboardPermissionDenied);
        });
        if (!clipboardContents) {
            return text;
        }
        for (const item of clipboardContents) {
            if (item.types.includes("text/html")) {
                const blob = await item.getType("text/html");
                text.textHTML = await blob.text();
                const textObj = getTextSiyuanFromTextHTML(text.textHTML);
                text.textHTML = textObj.textHtml;
                text.siyuanHTML = textObj.textSiyuan;
            }
            if (item.types.includes("text/plain")) {
                const blob = await item.getType("text/plain");
                text.textPlain = await blob.text();
            }
            if (item.types.includes("image/png")) {
                const blob = await item.getType("image/png");
                text.files = [new File([blob], "image.png", {type: "image/png", lastModified: Date.now()})];
            }
        }
        /// #if !BROWSER
        if (!text.textHTML && !text.files) {
            text.localFiles = await getLocalFiles();
        }
        /// #endif
        return text;
    } catch (e) {
        return text;
    }
};

export const writeText = (text: string) => {
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0).cloneRange();
    }
    try {
        // navigator.clipboard.writeText 抛出异常不进入 catch，这里需要先处理移动端复制
        if (isInAndroid()) {
            window.JSAndroid.writeClipboard(text);
            return;
        }
        if (isInHarmony()) {
            window.JSHarmony.writeClipboard(text);
            return;
        }
        if (isInIOS()) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
            return;
        }
        navigator.clipboard.writeText(text);
    } catch (e) {
        if (isInIOS()) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
        } else if (isInAndroid()) {
            window.JSAndroid.writeClipboard(text);
        } else if (isInHarmony()) {
            window.JSHarmony.writeClipboard(text);
        } else {
            const textElement = document.createElement("textarea");
            textElement.value = text;
            textElement.style.position = "fixed";  //avoid scrolling to bottom
            document.body.appendChild(textElement);
            textElement.focus();
            textElement.select();
            document.execCommand("copy");
            document.body.removeChild(textElement);
            if (range) {
                focusByRange(range);
            }
        }
    }
};

const writePlainTextFallback = async (text: string) => {
    try {
        if (isInAndroid()) {
            window.JSAndroid.writeClipboard(text);
            return true;
        }
        if (isInHarmony()) {
            window.JSHarmony.writeClipboard(text);
            return true;
        }
        if (isInIOS()) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
            return true;
        }
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) {
        console.log("Write plain text clipboard error:", e);
    }

    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0).cloneRange();
    }
    const textElement = document.createElement("textarea");
    textElement.value = text;
    textElement.style.position = "fixed";
    document.body.appendChild(textElement);
    textElement.focus();
    textElement.select();
    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch (e) {
        console.log("Copy plain text clipboard error:", e);
    }
    document.body.removeChild(textElement);
    if (range) {
        focusByRange(range);
    }
    return copied;
};

export interface IClipboardWriteData {
    textPlain: string;
    textHTML?: string;
    textSiyuan?: string;
}

export type TClipboardWriteStatus = "rich" | "plain" | "failed";

export interface IClipboardWriteResult {
    status: TClipboardWriteStatus;
    error?: unknown;
}

export interface IClipboardWriteOptions {
    fallbackToPlainText?: boolean;
}

export const writeClipboardData = async (data: IClipboardWriteData, options: IClipboardWriteOptions = {}): Promise<IClipboardWriteResult> => {
    const textPlain = data.textPlain || "";
    const textHTML = data.textHTML || "";
    const textSiyuan = data.textSiyuan || "";
    const fallbackToPlainText = options.fallbackToPlainText !== false;
    try {
        if (isInAndroid()) {
            if (textSiyuan) {
                window.JSAndroid.writeSiYuanHTMLClipboard(textPlain, textHTML, textSiyuan);
                return {status: "rich"};
            }
            if (textHTML) {
                window.JSAndroid.writeHTMLClipboard(textPlain, textHTML);
                return {status: "rich"};
            }
            window.JSAndroid.writeClipboard(textPlain);
            return {status: "plain"};
        }
        if (isInHarmony()) {
            if (textSiyuan) {
                window.JSHarmony.writeSiYuanHTMLClipboard(textPlain, textHTML, textSiyuan);
                return {status: "rich"};
            }
            if (textHTML) {
                window.JSHarmony.writeHTMLClipboard(textPlain, textHTML);
                return {status: "rich"};
            }
            window.JSHarmony.writeClipboard(textPlain);
            return {status: "plain"};
        }
        if (isInIOS()) {
            window.webkit.messageHandlers.setClipboard.postMessage(textPlain || textHTML);
            return {status: "plain"};
        }
        if (textHTML && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
            const clipboardItem: Record<string, Blob> = {};
            if (textPlain) {
                clipboardItem["text/plain"] = new Blob([textPlain], {type: "text/plain"});
            }
            const webHTML = buildWebClipboardHTML(textHTML, textSiyuan);
            clipboardItem["text/html"] = new Blob([webHTML], {type: "text/html"});
            await navigator.clipboard.write([new ClipboardItem(clipboardItem)]);
            return {status: "rich"};
        }
        if (!textHTML && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(textPlain);
            return {status: "plain"};
        }
    } catch (error) {
        if (fallbackToPlainText && await writePlainTextFallback(textPlain || textHTML)) {
            return {status: "plain", error};
        }
        return {status: "failed", error};
    }
    if (fallbackToPlainText && await writePlainTextFallback(textPlain || textHTML)) {
        return {status: "plain"};
    }
    return {status: "failed"};
};

export const writeBlockDOMClipboard = async (lute: Lute, blockDOM: string) => {
    const {textPlain, textHTML, textSiyuan} = buildBlockDOMClipboardData(lute, blockDOM);
    const result = await writeClipboardData({
        textPlain,
        textHTML: prepareExternalClipboardHTML(textHTML),
        textSiyuan,
    });
    if (result.error) {
        console.log("Write block DOM clipboard error:", result.error);
    }
    if (result.status === "failed") {
        showMessage(window.siyuan.languages.clipboardPermissionDenied, 7000, "error");
        return false;
    }
    return true;
};

export const copyPlainText = (text: string) => {
    text = text.replace(new RegExp(Constants.ZWSP, "g"), ""); // `复制纯文本` 时移除所有零宽空格 https://github.com/siyuan-note/siyuan/issues/6674
    writeText(text);
};

// 用户 iPhone 点击延迟/需要双击的处理
export const getEventName = () => {
    if (isIPhone()) {
        return "touchstart";
    } else {
        return "click";
    }
};

export const isOnlyMeta = (event: KeyboardEvent | MouseEvent) => {
    if (isMac()) {
        // mac
        if (event.metaKey && !event.ctrlKey) {
            return true;
        }
        return false;
    } else {
        if (!event.metaKey && event.ctrlKey) {
            return true;
        }
        return false;
    }
};

export const isNotCtrl = (event: KeyboardEvent | MouseEvent) => {
    if (!event.metaKey && !event.ctrlKey) {
        return true;
    }
    return false;
};

export const isHuawei = () => {
    return window.siyuan.config.system.osPlatform.toLowerCase().indexOf("huawei") > -1;
};

export const isDisabledFeature = (feature: string): boolean => {
    return window.siyuan.config.system.disabledFeatures?.indexOf(feature) > -1;
};

export const isIPhone = () => {
    return navigator.userAgent.indexOf("iPhone") > -1;
};

export const isIOSDevice = () => {
    return isIOSPlatform(navigator);
};

export const isSafari = () => {
    const userAgent = navigator.userAgent;
    return userAgent.includes("Safari") && !userAgent.includes("Chrome") && !userAgent.includes("Chromium");
};

export const isIPad = () => {
    return isIPadOSPlatform(navigator);
};

export const isMac = () => {
    return navigator.platform.toUpperCase().indexOf("MAC") > -1;
};

export const isWin11 = async () => {
    if (!(navigator as any).userAgentData || !(navigator as any).userAgentData.getHighEntropyValues) {
        return false;
    }
    const ua = await (navigator as any).userAgentData.getHighEntropyValues(["platformVersion"]);
    if ((navigator as any).userAgentData.platform === "Windows") {
        if (parseInt(ua.platformVersion.split(".")[0]) >= 13) {
            return true;
        }
    }
    return false;
};

export const getScreenWidth = () => {
    if (isInAndroid()) {
        return window.JSAndroid.getScreenWidthPx();
    } else if (isInHarmony()) {
        return window.JSHarmony.getScreenWidthPx();
    }
    return window.outerWidth;
};

export const isWindows = () => {
    return navigator.platform.toUpperCase().indexOf("WIN") > -1;
};

export const isInAndroid = () => {
    return window.siyuan.config.system.container === "android" && window.JSAndroid;
};

export const isInIOS = () => {
    return window.siyuan.config.system.container === "ios" && window.webkit?.messageHandlers;
};

export const isInMobileApp = () => {
    if (isInAndroid() || isInHarmony() || isInIOS()) {
        return true;
    }
    return false;
};

export const isInHarmony = () => {
    return window.siyuan.config.system.container === "harmony" && window.JSHarmony;
};

export const isInEdge = () => {
    const ua = navigator.userAgent;
    return ua.indexOf("EdgA/") > -1 || ua.indexOf("Edge/") > -1;
};

export function isChromeBrowser(): boolean {
    const nav = window.navigator as Navigator & {
        userAgentData: {
            brands: {
                brand: string;
                version: string;
            }[]
        }
    };
    if (nav.userAgentData && Array.isArray(nav.userAgentData.brands)) {
        const brands = nav.userAgentData.brands.map((b) => b.brand);
        // Edge、Opera 等 Chromium 内核浏览器 brands 中同样包含 Chromium，需与 userAgent 回退逻辑一致排除
        if (brands.some((brand) => /Edge|Opera|OPR/i.test(brand))) {
            return false;
        }
        return brands.some((brand) => /Chrome|Chromium/i.test(brand));
    }
    // 回退到 userAgent
    const ua = nav.userAgent || "";
    const isChromium = /\bChrome\/\d+/i.test(ua) || /\bChromium\/\d+/i.test(ua);
    const isEdge = /\bEdg(e|A|iOS)?\/\d+/i.test(ua); // Edge Chromium
    const isOpera = /\b(OPR|Opera)\/\d+/i.test(ua);

    return isChromium && !isEdge && !isOpera;
}

export const updateHotkeyAfterTip = (hotkey: string, split = " ") => {
    if (hotkey) {
        return split + updateHotkeyTip(hotkey);
    }
    return "";
};

// Mac，Windows 快捷键展示
export const updateHotkeyTip = (hotkey: string) => {
    if (!hotkey) {
        return hotkey;
    }
    if (isMac()) {
        // 为 Return 字符指定文本呈现，避免 macOS 使用彩色 emoji 字形。
        return hotkey.replace(/↩(?!\uFE0E)/g, "↩\uFE0E");
    }
    const keys = [];
    if ((hotkey.indexOf("⌘") > -1 || hotkey.indexOf("⌃") > -1)) keys.push("Ctrl");
    if (hotkey.indexOf("⇧") > -1) keys.push("Shift");
    if (hotkey.indexOf("⌥") > -1) keys.push("Alt");

    // 不能去最后一个，需匹配 F2
    const lastKey = hotkey.replace(/[⌘⇧⌥⌃]/g, "");
    if (lastKey) {
        keys.push({
            "⇥": "Tab",
            "⌫": "Backspace",
            "⌦": "Delete",
            "↩": "Enter"
        }[lastKey] || lastKey);
    }
    return keys.join("+");
};

export const getLocalStorage = (cb: () => void) => {
    fetchPost("/api/storage/getLocalStorage", undefined, (response) => {
        window.siyuan.storage = response.data;
        // 历史数据迁移
        const defaultStorage: any = {};
        defaultStorage[Constants.LOCAL_SEARCHASSET] = {
            keys: [],
            col: "",
            row: "",
            layout: 0,
            method: 0,
            types: {},
            sort: 0,
            k: "",
        };
        defaultStorage[Constants.LOCAL_SEARCHUNREF] = {
            col: "",
            row: "",
            layout: 0,
        };
        Constants.SIYUAN_ASSETS_SEARCH.forEach(type => {
            defaultStorage[Constants.LOCAL_SEARCHASSET].types[type] = true;
        });
        defaultStorage[Constants.LOCAL_SEARCHKEYS] = {
            keys: [],
            replaceKeys: [],
            col: "",
            row: "",
            layout: 0,
            colTab: "",
            rowTab: "",
            layoutTab: 0
        };
        defaultStorage[Constants.LOCAL_PDFTHEME] = {
            light: "light",
            dark: "dark",
            annoColor: "var(--b3-pdf-background1)"
        };
        defaultStorage[Constants.LOCAL_LAYOUTS] = [];   // {name: "", layout:{}, time: number, filespaths: IFilesPath[]}
        defaultStorage[Constants.LOCAL_PLUGIN_DOCKS] = {};  // { pluginName: {dockId: IPluginDockTab}}
        defaultStorage[Constants.LOCAL_PLUGINTOPUNPIN] = [];
        defaultStorage[Constants.LOCAL_OUTLINE] = {
            keepCurrentExpand: false,
            expandLevel: 6
        };
        defaultStorage[Constants.LOCAL_FILEPOSITION] = {}; // {id: IScrollAttr}
        defaultStorage[Constants.LOCAL_DIALOGPOSITION] = {}; // {id: IPosition}
        defaultStorage[Constants.LOCAL_HISTORY] = {
            notebookId: "%",
            type: 0,
            operation: "all",
            sideWidth: "256px",
            sideDocWidth: "256px",
            sideDiffWidth: "256px",
        };
        defaultStorage[Constants.LOCAL_FLASHCARD] = {
            fullscreen: false
        };
        defaultStorage[Constants.LOCAL_BAZAAR] = {
            theme: "0",
            template: "0",
            icon: "0",
            widget: "0",
            downloadedPlugin: "0",
            downloadedTheme: "0",
            downloadedIcon: "0",
            downloadedTemplate: "0",
            downloadedWidget: "0",
        };
        defaultStorage[Constants.LOCAL_EXPORTWORD] = {
            removeAssets: false,
            mergeSubdocs: false,
            mergeDocHeadingMode: "flat",
            mergeContentHeadingMode: "preserve",
        };
        defaultStorage[Constants.LOCAL_EXPORTPDF] = {
            landscape: false,
            marginType: "0",
            scale: 1,
            pageSize: "A4",
            removeAssets: true,
            keepFold: false,
            mergeSubdocs: false,
            mergeDocHeadingMode: "flat",
            mergeContentHeadingMode: "preserve",
            watermark: false,
            paged: true
        };
        defaultStorage[Constants.LOCAL_EXPORTIMG] = {
            keepFold: false,
            watermark: false
        };
        defaultStorage[Constants.LOCAL_DOCINFO] = {
            id: "",
        };
        defaultStorage[Constants.LOCAL_MOBILE_TABS] = {
            version: 1,
            tabs: [],
        };
        defaultStorage[Constants.LOCAL_MOBILE_BOTTOM_BAR] = {
            version: 1,
            actions: ["documents", "search", "newDoc", "tabs"],
        };
        defaultStorage[Constants.LOCAL_MOBILE_SIDE_PANEL] = {
            version: 1,
            left: ["file", "bookmark", "tag", "inbox", "plugin"],
            right: ["outline", "backlink", "agent"],
        };
        defaultStorage[Constants.LOCAL_IMAGES] = {
            file: "1f4c4",
            note: "1f5c3",
            folder: "1f4d1"
        };
        defaultStorage[Constants.LOCAL_EMOJIS] = {
            currentTab: "emoji"
        };
        defaultStorage[Constants.LOCAL_FONTSTYLES] = [];
        defaultStorage[Constants.LOCAL_CLOSED_TABS] = [];
        defaultStorage[Constants.LOCAL_FILESPATHS] = [];    // IFilesPath[]
        defaultStorage[Constants.LOCAL_SEARCHDATA] = {
            removed: true,
            page: 1,
            sort: 0,
            group: 0,
            hasReplace: false,
            method: 0,
            hPath: "",
            idPath: [],
            k: "",
            r: "",
            types: getDefaultType(),
            subTypes: getDefaultSubType(),
            replaceTypes: Object.assign({}, Constants.SIYUAN_DEFAULT_REPLACETYPES),
        };
        defaultStorage[Constants.LOCAL_ZOOM] = 1;
        defaultStorage[Constants.LOCAL_MOVE_PATH] = {keys: [], k: ""};
        defaultStorage[Constants.LOCAL_RECENT_DOCS] = {type: "viewedAt"};   // TRecentDocsSort

        [Constants.LOCAL_EXPORTIMG, Constants.LOCAL_SEARCHKEYS, Constants.LOCAL_PDFTHEME, Constants.LOCAL_BAZAAR,
            Constants.LOCAL_EXPORTWORD, Constants.LOCAL_EXPORTPDF, Constants.LOCAL_DOCINFO, Constants.LOCAL_MOBILE_TABS,
            Constants.LOCAL_MOBILE_BOTTOM_BAR, Constants.LOCAL_MOBILE_SIDE_PANEL,
            Constants.LOCAL_FONTSTYLES,
            Constants.LOCAL_SEARCHDATA, Constants.LOCAL_ZOOM, Constants.LOCAL_LAYOUTS,
            Constants.LOCAL_PLUGINTOPUNPIN, Constants.LOCAL_SEARCHASSET, Constants.LOCAL_FLASHCARD,
            Constants.LOCAL_DIALOGPOSITION, Constants.LOCAL_SEARCHUNREF, Constants.LOCAL_HISTORY,
            Constants.LOCAL_OUTLINE, Constants.LOCAL_FILEPOSITION, Constants.LOCAL_FILESPATHS, Constants.LOCAL_IMAGES,
            Constants.LOCAL_PLUGIN_DOCKS, Constants.LOCAL_EMOJIS, Constants.LOCAL_MOVE_PATH, Constants.LOCAL_RECENT_DOCS,
            Constants.LOCAL_CLOSED_TABS].forEach((key) => {
            if (typeof response.data[key] === "string") {
                try {
                    const parseData = JSON.parse(response.data[key]);
                    if (typeof parseData === "number") {
                        // https://github.com/siyuan-note/siyuan/issues/8852 Object.assign 会导致 number to Number
                        window.siyuan.storage[key] = parseData;
                    } else {
                        window.siyuan.storage[key] = Object.assign(defaultStorage[key], parseData);
                    }
                } catch (e) {
                    window.siyuan.storage[key] = defaultStorage[key];
                }
            } else if (typeof response.data[key] === "undefined") {
                window.siyuan.storage[key] = defaultStorage[key];
            }
        });
        // 搜索数据添加 replaceTypes 兼容
        if (!window.siyuan.storage[Constants.LOCAL_SEARCHDATA].replaceTypes ||
            Object.keys(window.siyuan.storage[Constants.LOCAL_SEARCHDATA].replaceTypes).length === 0) {
            window.siyuan.storage[Constants.LOCAL_SEARCHDATA].replaceTypes = Object.assign({}, Constants.SIYUAN_DEFAULT_REPLACETYPES);
        }
        // Migrate stored search data to include subTypes when absent
        if (!window.siyuan.storage[Constants.LOCAL_SEARCHDATA].subTypes ||
            Object.keys(window.siyuan.storage[Constants.LOCAL_SEARCHDATA].subTypes).length === 0) {
            window.siyuan.storage[Constants.LOCAL_SEARCHDATA].subTypes = getDefaultSubType();
        }
        const closedTabs = window.siyuan.storage[Constants.LOCAL_CLOSED_TABS];
        const sanitizedClosedTabs = sanitizeClosedTabs(closedTabs);
        if (sanitizedClosedTabs.length !== closedTabs.length) {
            window.siyuan.storage[Constants.LOCAL_CLOSED_TABS] = sanitizedClosedTabs;
            setStorageVal(Constants.LOCAL_CLOSED_TABS, sanitizedClosedTabs);
        }
        cb();
    });
};

export const isSensitiveSearchConfig = (config?: Config.IUILayoutTabSearchConfig) => {
    if (!config) {
        return false;
    }
    if (config.sensitive) {
        return true;
    }
    return config.idPath?.some((item) => {
        const boxID = item.split("/")[0];
        return window.siyuan.notebooks?.some((notebook) => notebook.id === boxID && notebook.encrypted);
    }) || false;
};

export const isSensitiveLayoutData = (data?: {
    instance?: string,
    type?: string,
    notebookId?: string,
    config?: Config.IUILayoutTabSearchConfig,
}) => {
    if (!data) {
        return false;
    }
    if (data.instance === "Editor") {
        return isEncryptedBox(data.notebookId);
    }
    if (data.instance === "Search") {
        return isSensitiveSearchConfig(data.config);
    }
    if (data.type === "local" && ["Backlink", "Graph", "Outline"].includes(data.instance)) {
        return !data.notebookId || isEncryptedBox(data.notebookId);
    }
    return false;
};

export const sanitizeClosedTabs = (tabs: Array<{children?: Parameters<typeof isSensitiveLayoutData>[0]}>) => {
    if (!Array.isArray(tabs)) {
        return [];
    }
    return tabs.filter((tab) => !isSensitiveLayoutData(tab.children));
};

const sanitizeSearchConfig = (config: Config.IUILayoutTabSearchConfig) => {
    if (!isSensitiveSearchConfig(config)) {
        return config;
    }
    const sanitized = JSON.parse(JSON.stringify(config)) as Config.IUILayoutTabSearchConfig;
    sanitized.k = "";
    sanitized.r = "";
    sanitized.query = "";
    sanitized.hPath = "";
    sanitized.idPath = [];
    sanitized.sensitive = false;
    return sanitized;
};

const sanitizeFilesPaths = (filesPaths: IFilesPath[]) => {
    if (!Array.isArray(filesPaths)) {
        return [];
    }
    return filesPaths.filter((item) => !isEncryptedBox(item.notebookId));
};

export const setStorageVal = (key: string, val: any, cb?: () => void) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    let storageVal = val;
    if (key === Constants.LOCAL_SEARCHDATA) {
        storageVal = sanitizeSearchConfig(val);
    } else if (key === Constants.LOCAL_FILESPATHS) {
        storageVal = sanitizeFilesPaths(val);
    } else if (key === Constants.LOCAL_CLOSED_TABS) {
        storageVal = sanitizeClosedTabs(val);
    }
    if ([Constants.LOCAL_SEARCHDATA, Constants.LOCAL_FILESPATHS, Constants.LOCAL_CLOSED_TABS].includes(key)) {
        window.siyuan.storage[key] = storageVal;
    }
    fetchPost("/api/storage/setLocalStorageVal", {
        app: Constants.SIYUAN_APPID,
        key,
        val: storageVal,
    }, () => {
        if (cb) {
            cb();
        }
    });
};

export const initWindowOpenOverride = (app: App, openExternal?: (url: string) => void) => {
    const originalOpen = window.open;
    window.open = function (url?: string | URL, target?: string, features?: string): WindowProxy | null {
        const urlStr = typeof url === "string" ? url : (url ? String(url) : "");
        if (isSiYuanUriProtocol(urlStr) && (!isBrowser() || isInMobileApp() || target !== "_blank")) {
            void import("../../util/uri").then(({processSiYuanUri}) => processSiYuanUri(app, urlStr));
            return null;
        }
        if (!canOpenExternalURL(urlStr)) {
            return null;
        }
        if (isInMobileApp() && urlStr && openExternal) {
            openExternal(urlStr);
            return null;
        }
        // 浏览器可通过 window.open("siyuan://blocks/20221031001313-rk7sd0e", "_blank") 打开本地客户端
        return originalOpen.call(window, url, target, features);
    };
};

/// #if !BROWSER
export const initNativeDialogOverride = () => {
    const originalAlert = window.alert;
    const originalConfirm = window.confirm;

    window.alert = function (message: string) {
        try {
            ipcRenderer.sendSync(Constants.SIYUAN_ALERT_DIALOG, {
                title: window.siyuan.languages.siyuanNote,
                message,
                buttons: [window.siyuan.languages.confirm],
                noLink: true,
            });
            return undefined;
        } catch (error) {
            return originalAlert.call(this, message);
        }
    };

    window.confirm = function (message: string): boolean {
        try {
            const buttonIndex = ipcRenderer.sendSync(Constants.SIYUAN_CONFIRM_DIALOG, {
                title: window.siyuan?.languages?.siyuanNote || "SiYuan",
                message,
                buttons: [window.siyuan?.languages?.cancel || "Cancel", window.siyuan?.languages?.confirm || "OK"],
                cancelId: 0,
                defaultId: 1,
                noLink: true,
            });
            return buttonIndex === 1;
        } catch (error) {
            return originalConfirm.call(this, message);
        }
    };
};
/// #endif
