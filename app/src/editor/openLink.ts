import {getIdFromSYProtocol, isLocalPath, isSYProtocol, pathPosix} from "../util/pathName";
/// #if !BROWSER
import {shell, ipcRenderer} from "electron";
/// #endif
import {getSearch} from "../util/functions";
import {Constants} from "../constants";
/// #if !MOBILE
import {openAsset, openBy, openFile, openFileById} from "./util";
/// #endif
import {showMessage} from "../dialog/message";
import {openByMobile} from "../protyle/util/compatibility";
import {App} from "../index";
import {fetchPost} from "../util/fetch";
import {checkFold} from "../util/noRelyPCFunction";
import {openMobileFileById} from "../mobile/editor";

export const processSYLink = (app: App, url: string) => {
    let urlObj: URL;
    try {
        urlObj = new URL(url);
        if (urlObj.protocol !== "siyuan:") {
            return false;
        }
    } catch (error) {
        return false;
    }
    if (urlObj && urlObj.hostname === "plugins") {
        const pluginNameType = urlObj.pathname.split("/")[1];
        if (!pluginNameType) {
            return false;
        }
        app.plugins.find(plugin => {
            if (pluginNameType.startsWith(plugin.name)) {
                // siyuan://plugins/plugin-name/foo?bar=baz
                plugin.eventBus.emit("open-siyuan-url-plugin", {url});

                /// #if !MOBILE
                // https://github.com/siyuan-note/siyuan/pull/9256
                if (pluginNameType.split("/")[0] !== plugin.name) {
                    // siyuan://plugins/plugin-samplecustom_tab?title=自定义页签&icon=iconFace&data={"text": "This is the custom plugin tab I opened via protocol."}
                    let data = urlObj.searchParams.get("data");
                    try {
                        data = JSON.parse(data || "{}");
                    } catch (e) {
                        console.log("Error open plugin tab with protocol:", e);
                    }
                    openFile({
                        app,
                        custom: {
                            title: urlObj.searchParams.get("title"),
                            icon: urlObj.searchParams.get("icon"),
                            data,
                            id: pluginNameType
                        },
                    });
                }
                /// #endif
                return true;
            }
        });
        return true;
    }
    if (urlObj && isSYProtocol(url)) {
        const id = getIdFromSYProtocol(url);
        const focus = urlObj.searchParams.get("focus") === "1";
        window.siyuan.editorIsFullscreen = urlObj.searchParams.get("fullscreen") === "1";
        fetchPost("/api/block/checkBlockExist", {id}, existResponse => {
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
                    url,
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
                openAsset(protyle.app, linkAddress, pdfParams, "right");
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
