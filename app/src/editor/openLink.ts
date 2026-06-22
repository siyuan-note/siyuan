import {isLocalPath, isSiYuanUriProtocol, parseSiYuanUriBlockInfo, pathPosix} from "../util/pathName";
/// #if !BROWSER
import {shell, ipcRenderer} from "electron";
/// #endif
import {getSearch} from "../util/functions";
import {Constants} from "../constants";
/// #if !MOBILE
import {openAsset, openBy, openFile, openFileById} from "./util";
/// #endif
import {showMessage} from "../dialog/message";
import {isInIOS, isInAndroid, isInHarmony} from "../protyle/util/compatibility";
import {fetchPost} from "../util/fetch";
import {checkFold} from "../util/noRelyPCFunction";
import {openMobileFileById} from "../mobile/editor";

import type {App} from "../index";

export const processSiYuanUriBlocks = (app: App, uriObj: URL): boolean => {
    const blockInfo = parseSiYuanUriBlockInfo(uriObj);
    if (blockInfo != null) {
        const {id, focus} = blockInfo;
        window.siyuan.editorIsFullscreen = blockInfo.fullscreen;
        fetchPost("/api/block/checkBlockExist", { id }, existResponse => {
            if (existResponse.data) {
                checkFold(id, (zoomIn) => {
                    /// #if !MOBILE
                    openFileById({
                        app,
                        id,
                        action: (zoomIn || focus) ? [Constants.CB_GET_FOCUS, Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                        zoomIn: zoomIn || focus
                    });
                    /// #else
                    openMobileFileById(app, id, (zoomIn || focus) ? [Constants.CB_GET_FOCUS, Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
                    /// #endif
                });
                /// #if !BROWSER
                ipcRenderer.send(Constants.SIYUAN_CMD, "show");
                /// #endif
            }
            app.plugins.forEach(plugin => {
                plugin.eventBus.emit("open-siyuan-url-block", {
                    url: uriObj.href,
                    id,
                    focus,
                    exist: existResponse.data,
                });
            });
        });
        return true;
    }
    return false;
};

export const processSiYuanUriPlugins = (app: App, uriObj: URL): boolean => {
    const pluginNameOrTabType: string | null = (() => {
        const name = uriObj.pathname.split("/")[1];
        if (!name) {
            return null;
        }
        try {
            return decodeURIComponent(name);
        } catch (error) {
            return null;
        }
    })();

    if (!pluginNameOrTabType) {
        return false;
    }

    const plugin = app.plugins.find(plugin => pluginNameOrTabType === plugin.name);
    if (plugin) {
        // siyuan://plugins/plugin-name/foo?bar=baz
        plugin.eventBus.emit("open-siyuan-url-plugin", { url: uriObj.href });
    } else {
        // siyuan://plugins/plugin-samplecustom_tab?title=自定义页签&icon=iconFace&data={"text": "This is the custom plugin tab I opened via protocol."}
        /// #if !MOBILE
        // https://github.com/siyuan-note/siyuan/pull/9256
        const data = (() => {
            try {
                return JSON.parse(uriObj.searchParams.get("data") || "{}");
            } catch (e) {
                console.log("Error open plugin tab with protocol:", e);
                return undefined;
            }
        })();
        // id 不存在时无副作用
        openFile({
            app,
            custom: {
                title: uriObj.searchParams.get("title") ?? pluginNameOrTabType,
                icon: uriObj.searchParams.get("icon") ?? "iconPlugin",
                data,
                id: pluginNameOrTabType
            },
        });
        /// #endif
    }
    return true;
};

export const processSiYuanUri = (app: App, uri: string) => {
    let uriObj: URL;
    try {
        uriObj = new URL(uri);
        if (!isSiYuanUriProtocol(uriObj)) {
            return false;
        }
    } catch (error) {
        return false;
    }
    switch (uriObj.hostname) {
        case "blocks":
            return processSiYuanUriBlocks(app, uriObj);
        case "plugins":
            return processSiYuanUriPlugins(app, uriObj);
        default:
            break;
    }
    return false;
};

export const openLink = (protyle: IProtyle, aLink: string, event?: MouseEvent, ctrlIsPressed = false) => {
    let linkAddress = Lute.UnEscapeHTMLStr(aLink);
    let pdfParams;
    if (isLocalPath(linkAddress) && !linkAddress.startsWith("file://") && linkAddress.indexOf(".pdf") > -1) {
        const pdfAddress = linkAddress.split("/");
        if (pdfAddress.length === 3 && pdfAddress[0] === "assets" && pdfAddress[1].endsWith(".pdf") && /\d{14}-\w{7}/.test(pdfAddress[2])) {
            linkAddress = `assets/${pdfAddress[1]}`;
            pdfParams = pdfAddress[2];
        } else {
            pdfParams = parseInt(getSearch("page", linkAddress));
            linkAddress = linkAddress.split("?page")[0];
        }
    }
    /// #if MOBILE
    openByMobile(linkAddress);
    /// #else
    if (isLocalPath(linkAddress)) {
        if (Constants.SIYUAN_ASSETS_EXTS.includes(pathPosix().extname(linkAddress)) &&
            (
                !linkAddress.endsWith(".pdf") ||
                // 本地 pdf 仅 assets/ 开头的才使用 siyuan 打开
                (linkAddress.endsWith(".pdf") && linkAddress.startsWith("assets/"))
            )
        ) {
            if (event && event.altKey) {
                openAsset(protyle.app, linkAddress, pdfParams);
            } else if (event && event.shiftKey) {
                /// #if !BROWSER
                openBy(linkAddress, "app");
                /// #else
                openByMobile(linkAddress);
                /// #endif
            } else if (ctrlIsPressed) {
                /// #if !BROWSER
                openBy(linkAddress, "folder");
                /// #else
                openByMobile(linkAddress);
                /// #endif
            } else {
                openAsset(protyle.app, linkAddress, pdfParams, !window.siyuan.config.fileTree.noSplitScreenWhenOpenTab ? "right" : null);
            }
        } else {
            /// #if !BROWSER
            if (ctrlIsPressed) {
                openBy(linkAddress, "folder");
            } else {
                openBy(linkAddress, "app");
            }
            /// #else
            openByMobile(linkAddress);
            /// #endif
        }
    } else if (linkAddress) {
        if (0 > linkAddress.indexOf(":")) {
            // 使用 : 判断，不使用 :// 判断 Open external application protocol invalid https://github.com/siyuan-note/siyuan/issues/10075
            // Support click to open hyperlinks like `www.foo.com` https://github.com/siyuan-note/siyuan/issues/9986
            linkAddress = `https://${linkAddress}`;
        }
        /// #if !BROWSER
        shell.openExternal(linkAddress).catch((e) => {
            showMessage(e);
        });
        /// #else
        openByMobile(linkAddress);
        /// #endif
    }
    /// #endif
};

export const openByMobile = (uri: string) => {
    if (!uri) {
        return;
    }
    /// #if MOBILE
    if (processSiYuanUri(window.siyuan.ws.app, uri)) {
        return;
    }
    /// #endif
    if (isInIOS()) {
        if (uri.startsWith("assets/")) {
            // iOS 16.7 之前的版本，uri 需要 encodeURIComponent
            window.webkit.messageHandlers.openLink.postMessage(location.origin + "/assets/" + encodeURIComponent(uri.replace("assets/", "")));
        } else if (uri.startsWith("/")) {
            // 导出 zip 返回的是已经 encode 过的，因此不能再 encode
            window.webkit.messageHandlers.openLink.postMessage(location.origin + uri);
        } else {
            try {
                new URL(uri);
                window.webkit.messageHandlers.openLink.postMessage(uri);
            } catch (e) {
                window.webkit.messageHandlers.openLink.postMessage("https://" + uri);
            }
        }
    } else if (isInAndroid()) {
        window.JSAndroid.openExternal(uri);
    } else if (isInHarmony()) {
        window.JSHarmony.openExternal(uri);
    } else {
        window.open(uri);
    }
};
