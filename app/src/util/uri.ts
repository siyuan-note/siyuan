import {isSiYuanUriProtocol, parseSiYuanUriInfo} from "./pathName";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {Constants} from "../constants";
/// #if !MOBILE
import {openFile, openFileById} from "../editor/util";
/// #endif
import {fetchPost} from "./fetch";
import {checkFold} from "./noRelyPCFunction";
import {openMobileFileById} from "../mobile/editor";
import {isValidBazaarPackageName} from "./bazaarPackage";

import type {App} from "../index";
import {activateQueuedAVLocate, queueAVLocateRequest} from "../protyle/render/av/locate";

const processSiYuanUriBlocks = (app: App, uriObj: URL): boolean => {
    const blockInfo = parseSiYuanUriInfo(uriObj);
    if (blockInfo != null) {
        const {id, focus} = blockInfo;
        if (blockInfo.avItemID) {
            queueAVLocateRequest(id, {
                itemID: blockInfo.avItemID,
                viewID: blockInfo.avViewID,
                groupID: blockInfo.avGroupID,
            });
        }
        window.siyuan.editorIsFullscreen = blockInfo.fullscreen;
        fetchPost("/api/block/checkBlockExist", { id }, existResponse => {
            if (existResponse.data) {
                checkFold(id, (zoomIn) => {
                    /// #if !MOBILE
                    openFileById({
                        app,
                        id,
                        action: blockInfo.avItemID ? [Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL] :
                            ((zoomIn || focus) ? [Constants.CB_GET_FOCUS, Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]),
                        zoomIn: blockInfo.avItemID ? false : zoomIn || focus,
                        afterOpen: (model) => {
                            const protyle = (model as { editor?: { protyle?: IProtyle } })?.editor?.protyle;
                            if (protyle) {
                                activateQueuedAVLocate(protyle, id);
                            }
                        },
                    });
                    /// #else
                    openMobileFileById(app, id, blockInfo.avItemID ? [Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL] :
                        ((zoomIn || focus) ? [Constants.CB_GET_FOCUS, Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]),
                    undefined, undefined, blockInfo.avItemID ? (protyle) => activateQueuedAVLocate(protyle, id) : undefined);
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

const processSiYuanUriPlugins = (app: App, uriObj: URL): boolean => {
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
        if (!app.plugins.some(item => item.models[pluginNameOrTabType])) {
            return false;
        }
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
        let icon = uriObj.searchParams.get("icon");
        if (icon && !/^[a-zA-Z0-9]+$/.test(icon)) {
            icon = null; // 拒绝非法 icon 值，使用默认图标
        }
        openFile({
            app,
            custom: {
                title: uriObj.searchParams.get("title") ?? pluginNameOrTabType,
                icon: icon ?? "iconPlugin",
                data,
                id: pluginNameOrTabType
            },
        });
        /// #endif
    }
    return true;
};

const processSiYuanUriBazaar = (app: App, uriObj: URL): boolean => {
    /// #if !MOBILE
    const [, _type, _name, target] = uriObj.pathname.split("/");
    if (!_type || !_name) return false;
    const resourceType = _type as TBazaarType;
    let resourceName: string;
    try {
        resourceName = decodeURIComponent(_name);
    } catch {
        return false;
    }
    if (!isValidBazaarPackageName(resourceName)) {
        return false;
    }
    switch (target) {
        case "readme":
        case "readme-installed": {
            // siyuan://bazaar/plugins/plugin-sample/readme
            // siyuan://bazaar/plugins/plugin-sample/readme-installed
            const from = target === "readme-installed" ? "downloaded" : "bazaar";
            (async () => {
                const {openBazaarReadme} = await import("../config");
                openBazaarReadme(app, resourceType, resourceName, from);
            })();
            return true;
        }
        default:
            break;
    }
    /// #endif
    return false;
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
        case "bazaar":
            return processSiYuanUriBazaar(app, uriObj);
        default:
            break;
    }
    return false;
};
