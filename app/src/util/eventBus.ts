import {parseSYProtocolBlockInfo} from "./pathName";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {Constants} from "../constants";
/// #if !MOBILE
import {openFile, openFileById} from "../editor/util";
/// #endif
import {App} from "../index";
import {fetchPost} from "./fetch";
import {checkFold} from "./noRelyPCFunction";
import {openMobileFileById} from "../mobile/editor";
import {isSiYuanUriProtocol} from "./uri";
import {openBazaarReadme} from "../config";

export const initAppEventBus = (app: import("../index").App) => {
    app.eventBus.addEventListener(Constants.SIYUAN_APP_EVENT_OPEN_SIYUAN_URI, (event: Event) => {
        const {uri} = (event as CustomEvent<IOpenSiYuanUriDetails>).detail;
        if (!isSiYuanUriProtocol(uri)) {
            return;
        }

        switch (uri.hostname) {
            case "blocks":
                processSiYuanUriBlocks(app, uri);
                break;
            case "plugins":
                processSiYuanUriPlugins(app, uri);
                break;
            case "bazaar":
                processSiYuanUriBazaar(app, uri);
                break;
            default:
                break;
        }
    });
};

export const processSiYuanUriBlocks = async (app: App, uriObj: URL): Promise<void> => {
    const blockInfo = parseSYProtocolBlockInfo(uriObj);
    if (blockInfo != null) {
        const {id, focus} = blockInfo;
        window.siyuan.editorIsFullscreen = blockInfo.fullscreen;
        fetchPost("/api/block/checkBlockExist", { id }, existResponse => {
            if (existResponse.data) {
                checkFold(id, async (zoomIn) => {
                    /// #if !MOBILE
                    await openFileById({
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
    }
};

export const processSiYuanUriPlugins = async (app: App, uriObj: URL): Promise<void> => {
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
        return;
    }

    const plugin = app.plugins.find(plugin => pluginNameOrTabType === plugin.name);
    if (plugin) {
        // siyuan://plugins/plugin-name/foo?bar=baz
        plugin.eventBus.emit("open-siyuan-url-plugin", {url: uriObj.href});
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
    return;
};

export const processSiYuanUriBazaar = async (app: App, uri: URL): Promise<void> => {
    /// #if !MOBILE
    try {
        const [, _type, _name, target] = uri.pathname.split("/");
        if (!_type || !_name) return;
        const resourceType = _type as TBazaarType;
        const resourceName = decodeURIComponent(_name);
        switch (target) {
            case "readme":
                // siyuan://bazaar/plugins/plugin-sample/readme
                await openBazaarReadme(app, resourceType, resourceName);
                break;
            default:
                break;
        }
    } catch (error) {
        return;
    }
    /// #endif
};
