import {focusByRange} from "./selection";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";

export const openByMobile = (uri: string) => {
    if (!uri) {
        return;
    }
    if (window.siyuan.config.system.container === "ios") {
        window.location.href = uri;
    } else if (window.siyuan.config.system.container === "android" && window.JSAndroid) {
        window.JSAndroid.openExternal(uri);
    } else {
        window.open(uri);
    }
};

export const readText = () => {
    if ("android" === window.siyuan.config.system.container && window.JSAndroid) {
        return window.JSAndroid.readClipboard();
    }
    return navigator.clipboard.readText();
};

export const writeText = (text: string) => {
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0).cloneRange();
    }
    try {
        // navigator.clipboard.writeText 抛出异常不进入 catch，这里需要先处理移动端复制
        if ("android" === window.siyuan.config.system.container && window.JSAndroid) {
            window.JSAndroid.writeClipboard(text);
            return;
        }
        if ("ios" === window.siyuan.config.system.container && window.webkit?.messageHandlers) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
            return;
        }
        navigator.clipboard.writeText(text);
    } catch (e) {
        if (window.siyuan.config.system.container === "ios" && window.webkit?.messageHandlers) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
        } else if (window.siyuan.config.system.container === "android" && window.JSAndroid) {
            window.JSAndroid.writeClipboard(text);
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

export const copyPlainText = async (text: string) => {
    text = text.replace(new RegExp(Constants.ZWSP, "g"), ""); // `复制纯文本` 时移除所有零宽空格 https://github.com/siyuan-note/siyuan/issues/6674
    await writeText(text);
};

// 用户 iPhone 点击延迟/需要双击的处理
export const getEventName = () => {
    if (navigator.userAgent.indexOf("iPhone") > -1) {
        return "touchstart";
    } else {
        return "click";
    }
};

// 区别 mac 上的 ctrl 和 meta
export const isCtrl = (event: KeyboardEvent | MouseEvent) => {
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

export const isMac = () => {
    return navigator.platform.toUpperCase().indexOf("MAC") > -1;
};

// Mac，Windows 快捷键展示
export const updateHotkeyTip = (hotkey: string) => {
    if (/Mac/.test(navigator.platform) || navigator.platform === "iPhone") {
        return hotkey;
    }

    const KEY_MAP = new Map(Object.entries({
        "⌘": "Ctrl",
        "⌃": "Ctrl",
        "⇧": "Shift",
        "⌥": "Alt",
        "⇥": "Tab",
        "⌫": "Backspace",
        "⌦": "Delete",
        "↩": "Enter",
    }));

    const keys = [];

    if (hotkey.indexOf("⌘") > -1) keys.push(KEY_MAP.get("⌘"));
    if (hotkey.indexOf("⇧") > -1) keys.push(KEY_MAP.get("⇧"));
    if (hotkey.indexOf("⌥") > -1) keys.push(KEY_MAP.get("⌥"));

    // 不能去最后一个，需匹配 F2
    const lastKey = hotkey.replace(/⌘|⇧|⌥/g, "");
    if (lastKey) {
        keys.push(KEY_MAP.get(lastKey) || lastKey);
    }

    return keys.join("+");
};

export const hotKey2Electron = (key: string) => {
    let electronKey = "";
    if (key.indexOf("⌘") > -1) {
        electronKey += "CommandOrControl+";
    }
    if (key.indexOf("⇧") > -1) {
        electronKey += "Shift+";
    }
    if (key.indexOf("⌥") > -1) {
        electronKey += "Alt+";
    }
    return electronKey + key.substr(key.length - 1);
};

export const getLocalStorage = (cb: () => void) => {
    fetchPost("/api/storage/getLocalStorage", undefined, (response) => {
        window.siyuan.storage = response.data;
        // 历史数据迁移
        const defaultStorage: any = {};
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
        defaultStorage[Constants.LOCAL_LAYOUTS] = [];   // {name: "", layout:{}}
        defaultStorage[Constants.LOCAL_AI] = [];   // {name: "", memo: ""}
        defaultStorage[Constants.LOCAL_PLUGINTOPUNPIN] = [];
        defaultStorage[Constants.LOCAL_BAZAAR] = {
            theme: "0",
            template: "0",
            icon: "0",
            widget: "0",
        };
        defaultStorage[Constants.LOCAL_EXPORTWORD] = {removeAssets: false, mergeSubdocs: false};
        defaultStorage[Constants.LOCAL_EXPORTPDF] = {
            landscape: false,
            marginType: "0",
            scale: 1,
            pageSize: "A4",
            removeAssets: true,
            keepFold: false,
            mergeSubdocs: false,
        };
        defaultStorage[Constants.LOCAL_EXPORTIMG] = {
            keepFold: false,
        };
        defaultStorage[Constants.LOCAL_DOCINFO] = {
            id: "",
        };
        defaultStorage[Constants.LOCAL_FONTSTYLES] = [];
        defaultStorage[Constants.LOCAL_SEARCHDATA] = {
            page: 1,
            sort: 0,
            group: 0,
            hasReplace: false,
            method: 0,
            hPath: "",
            idPath: [],
            k: "",
            r: "",
            types: {
                document: window.siyuan.config.search.document,
                heading: window.siyuan.config.search.heading,
                list: window.siyuan.config.search.list,
                listItem: window.siyuan.config.search.listItem,
                codeBlock: window.siyuan.config.search.codeBlock,
                htmlBlock: window.siyuan.config.search.htmlBlock,
                mathBlock: window.siyuan.config.search.mathBlock,
                table: window.siyuan.config.search.table,
                blockquote: window.siyuan.config.search.blockquote,
                superBlock: window.siyuan.config.search.superBlock,
                paragraph: window.siyuan.config.search.paragraph,
                embedBlock: window.siyuan.config.search.embedBlock,
            }
        };
        defaultStorage[Constants.LOCAL_ZOOM] = 1;

        [Constants.LOCAL_EXPORTIMG, Constants.LOCAL_SEARCHKEYS, Constants.LOCAL_PDFTHEME, Constants.LOCAL_BAZAAR, Constants.LOCAL_EXPORTWORD,
            Constants.LOCAL_EXPORTPDF, Constants.LOCAL_DOCINFO, Constants.LOCAL_FONTSTYLES, Constants.LOCAL_SEARCHDATA,
            Constants.LOCAL_ZOOM, Constants.LOCAL_LAYOUTS, Constants.LOCAL_AI, Constants.LOCAL_PLUGINTOPUNPIN].forEach((key) => {
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
        cb();

        // 数据兼容，移除历史数据，3.8.4 移除
        fetchPost("/api/storage/removeLocalStorageVals", {
            app: Constants.SIYUAN_APPID,
            keys: ["leftColumn", "local-searchkey", "local-searchedata", "local-searchekeys", "local-searchetabdata", "rightColumn", "topBar"]
        });
    });
};

export const setStorageVal = (key: string, val: any) => {
    fetchPost("/api/storage/setLocalStorageVal", {
        app: Constants.SIYUAN_APPID,
        key,
        val,
    });
};
