import "../../assets/scss/base.scss";
import {ipcRenderer} from "electron";
import {Constants} from "../../constants";
import {Model} from "../../layout/Model";
import {Menus} from "../../menus";
import {genUUID} from "../../util/genID";
import {fetchSyncPost} from "../../util/fetch";
import {addBaseURL, redirectToCheckAuth} from "../../util/pathName";
import {getLocalStorage, initNativeDialogOverride, initWindowOpenOverride, isMac, isWindows} from "../../protyle/util/compatibility";
import {addScriptSync} from "../../protyle/util/addScript";
import {ensureLute} from "../../protyle/util/lute";
import {loadDesktopHostConnection, initDesktopHost} from "../../boot/onGetConfig";
import {loadLanguages} from "../../boot/loadLanguages";
import {systemConfig} from "../systemConfig";
import {loadAssets, setInlineStyle, initAssets, reloadInlineStyles, refreshThemeStyle} from "../../util/assets";
import {initMessage} from "../../dialog/message";
import {progressLoading, processSync, downloadProgress} from "../../dialog/processSystem";
import {setSettingsWindowHost} from "./windowContext";
import {refreshSettingConfig} from "./sync";
import {openSettingDialog} from "../index";
import {switchSettingTab} from "../search/dialog";
import {withMountedBazaar} from "../bazaarTab";
import {appearanceConfigApi, refreshAppearance} from "../tabs/appearanceRuntime";
import {Setting} from "../../plugin/Setting";
import {bindMenuKeydown} from "../../menus/Menu";
import {globalClickHideMenu} from "../../menus/menuClick";
import {isAbove} from "../../util/zIndex";
import {windowMouseMove} from "../../boot/globalEvent/mousemove";
import {hideTooltip, initTooltips} from "../../dialog/tooltip";
import {applyCloudUserState} from "../tabs/accountUi";
import {updateServerAddresses} from "../tabs/accessRuntime";
import {installPluginStorageFetchAppId} from "../../util/fetchAppId";
import {createSettingsPluginApp} from "../../plugin/settingsApp";
import {afterLayoutReady, disposePlugins, loadPlugins, refreshPlugins} from "../../plugin/loader";
import {applyPluginReload} from "../../plugin/globalState";
import {emitToPlugins} from "../../plugin/EventBusCore";
import type {Dialog} from "../../dialog";
import type {ISettingsCommand} from "./nativeWindow";
import {getSettingTabDefs} from "./tabs";
import {onWindowsMsg} from "../../window/onWindowsMsg";
import {applyWindowState} from "../../boot/windowControls";
import {waitForSettingsWindowPaint} from "./windowPaint";
import {createSettingsWindowRuntime, resolveSettingsWindowHost, startSettingsWindow} from "./windowRuntime";

let disposeSettingsWindow = () => {};

const initialize = async () => {
    addBaseURL();
    const host = resolveSettingsWindowHost();
    if (!host) {
        window.close();
        return;
    }
    setSettingsWindowHost(host);
    let disposed = false;
    const app = createSettingsPluginApp(Constants.SIYUAN_APPID);
    const ws = new Model({app});
    const listeners: {channel: string; listener: Parameters<typeof ipcRenderer.on>[1]}[] = [];
    disposeSettingsWindow = () => {
        if (disposed) return;
        disposed = true;
        if (window.siyuan) window.siyuan.isReady = false;
        disposePlugins(app);
        ws.destroy();
        listeners.forEach(({channel, listener}) => ipcRenderer.removeListener(channel, listener));
        setSettingsWindowHost(undefined);
        try {
            host.dispose();
        } catch (error) {
            console.warn("Could not release the settings window owner", error);
        }
    };
    window.addEventListener("unload", disposeSettingsWindow, {once: true});
    const isActive = () => {
        if (disposed) return false;
        try {
            if (host.isActive()) return true;
        } catch (error) {
            console.warn("Could not reach the settings window owner", error);
        }
        disposeSettingsWindow();
        window.close();
        return false;
    };
    const listen = (channel: string, callback: Parameters<typeof ipcRenderer.on>[1]) => {
        const listener: Parameters<typeof ipcRenderer.on>[1] = (event, ...args) => {
            if (isActive()) callback(event, ...args);
        };
        listeners.push({channel, listener});
        ipcRenderer.on(channel, listener);
    };
    const runtime = createSettingsWindowRuntime(isActive, true);
    listen("siyuan-settings-shown", () => {
        void runtime.enableSnippetScripts();
    });
    let dialog: Dialog;
    let command: ISettingsCommand;
    const applyCommand = async () => {
        if (!isActive() || !dialog || !command || host.plugin) return;
        const next = command;
        command = undefined;
        if (next.tab) {
            const mounted = switchSettingTab(dialog.element, host.app, next.tab);
            const url = new URL(location.href);
            url.searchParams.set("tab", next.tab);
            history.replaceState(null, "", url);
            if (next.tab === "assets") {
                await mounted;
                if (!isActive()) return;
            }
        }
        if (next.readme) {
            const {type, from, resource} = next.readme;
            await withMountedBazaar(({bazaar, renderReadme}) => {
                if (!isActive()) return;
                bazaar.switchBazaarTab(host.app, type, from);
                renderReadme(type, from, resource);
            });
        }
    };
    listen("siyuan-settings-command", (_event, next: ISettingsCommand) => {
        command = next;
        void applyCommand().catch(error => console.error("Could not apply settings window command", error));
    });
    window.siyuan = {
        zIndex: 10, isReady: false, notebooks: [], reqIds: {}, backStack: [], layout: {}, dialogs: [],
        blockPanels: [], closedTabs: [], ctrlIsPressed: false, altIsPressed: false, ws,
    };
    ws.connect({id: genUUID(), type: "main", callback: () => {
        if (isActive() && window.siyuan.isReady) {
            void runtime.reconnect().catch(error => console.error("Could not reconnect settings runtime", error));
            void refreshPlugins(app).catch(error => console.error("Could not reconnect settings plugins", error));
        }
    }, msgCallback: data => {
        if (!isActive() || !data) return;
        emitToPlugins("ws-main", data);
        if (runtime.handleMessage(data)) return;
        switch (data.cmd) {
            case "logoutAuth": redirectToCheckAuth(); break;
            case "settingChanged": void refreshSettingConfig(data.data.namespace); break;
            case "setConf":
                void refreshSettingConfig();
                void runtime.refreshSnippets(true);
                break;
            case "setAppearance": appearanceConfigApi.apply(data.data); break;
            case "refreshAppearance": void refreshAppearance(data.data); break;
            case "reloadInlineStyles": void reloadInlineStyles(); break;
            case "refreshtheme": refreshThemeStyle(data.data.theme); break;
            case "reloadPlugin":
                void refreshSettingConfig("bazaar");
                void applyPluginReload(app, data.data).catch(error => console.error("Could not update settings plugins", error));
                break;
            case "readonly": window.siyuan.config.editor.readOnly = data.data; break;
            case "progress": progressLoading(data); break;
            case "downloadProgress": downloadProgress(data.data); break;
            case "syncing": processSync(data); break;
            case "setCloudUser": applyCloudUserState(data.data.user, data.data.userName); break;
            case "setServerAddrs": updateServerAddresses(data.data); break;
        }
    }});
    const response = await fetchSyncPost("/api/system/getConf", {});
    if (!isActive()) return;
    if (response.code !== 0) {
        disposeSettingsWindow();
        window.close();
        return;
    }
    window.siyuan.config = systemConfig(response.data.conf);
    window.siyuan.isPublish = response.data.isPublish;
    await loadDesktopHostConnection();
    if (!isActive()) return;
    const [user, emoji] = await Promise.all([
        fetchSyncPost("/api/setting/getCloudUser", {cached: true}),
        fetchSyncPost("/api/system/getEmojiConf", {}),
        runtime.refreshNotebooks(),
        new Promise<void>(resolve => getLocalStorage(resolve)),
        addScriptSync(`${Constants.PROTYLE_CDN}/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}`, "protyleWcHtmlScript"),
        loadLanguages(window.siyuan.config.appearance.lang, Constants.SIYUAN_VERSION, languages => {
            if (isActive()) window.siyuan.languages = languages;
        }),
        host.plugin ? ensureLute({reloadOnFailure: false}) : Promise.resolve(),
    ]);
    if (!isActive()) return;
    if (!window.siyuan.languages || !window.DOMPurify) {
        throw new Error("Could not load settings window dependencies");
    }
    window.siyuan.user = user.data && "userId" in user.data ? user.data : null;
    if (Array.isArray(emoji.data)) {
        window.siyuan.emojis = emoji.data;
    }
    window.siyuan.menus = new Menus(host.app);
    await initDesktopHost();
    if (!isActive()) return;
    listen(Constants.SIYUAN_SEND_WINDOWS, (_event, data: IWebSocketData) => onWindowsMsg(data));
    runtime.applyZoom();
    document.body.classList.toggle("body--windows", isWindows());
    document.body.classList.toggle("body--win32", !isMac());
    listen(Constants.SIYUAN_EVENT, (_event, command: string) => applyWindowState(command));
    ipcRenderer.send(Constants.SIYUAN_EVENT);
    const [fullscreen, maximized] = await Promise.all([
        ipcRenderer.invoke(Constants.SIYUAN_GET, {cmd: "isFullScreen"}),
        ipcRenderer.invoke(Constants.SIYUAN_GET, {cmd: "isMaximized"}),
    ]);
    if (!isActive()) return;
    applyWindowState(fullscreen ? "enter-full-screen" : "leave-full-screen");
    applyWindowState(maximized ? "maximize" : "unmaximize");
    await waitForSettingsWindowPaint(async () => {
        await loadAssets(window.siyuan.config.appearance);
        if (!isActive()) return;
        await setInlineStyle();
        if (!isActive()) return;
        initAssets();
        runtime.applyZoom();
        initMessage();
        initNativeDialogOverride();
        initWindowOpenOverride(host.app);
        document.title = host.title;
        if (host.plugin) {
            host.plugin.mount(options => {
                const setting = new Setting(options);
                options.items.forEach(item => setting.addItem(item));
                setting.open(host.plugin.name);
                return setting.dialog;
            });
        } else {
            const tab = getSettingTabDefs().find(def => def.id === new URLSearchParams(location.search).get("tab"))?.id;
            if (tab === "assets") {
                await ensureLute({reloadOnFailure: false});
                if (!isActive()) return;
            }
            dialog = openSettingDialog(host.app, tab);
            dialog.element.querySelectorAll(".config__side .b3-list-item").forEach(item => {
                item.addEventListener("click", () => {
                    const url = new URL(location.href);
                    url.searchParams.set("tab", item.getAttribute("data-name"));
                    history.replaceState(null, "", url);
                });
            });
        }
        document.addEventListener("keydown", event => {
            const menu = window.siyuan.menus.menu;
            const dialog = window.siyuan.dialogs[window.siyuan.dialogs.length - 1];
            const menuIsAbove = !menu.element.classList.contains("fn__none") &&
                (!dialog || isAbove(menu.element, dialog.element.querySelector(".b3-dialog")));
            if (menuIsAbove && bindMenuKeydown(event)) {
                event.preventDefault();
                return;
            }
            if (event.key === "Escape" && !event.isComposing && !event.repeat) {
                if (menuIsAbove) {
                    menu.remove(true);
                } else {
                    dialog?.destroy();
                }
                event.preventDefault();
            }
        });
        window.addEventListener("click", event => globalClickHideMenu(event.target as HTMLElement));
        initTooltips();
        window.addEventListener("mousemove", windowMouseMove);
        window.addEventListener("blur", hideTooltip);
        window.addEventListener("focus", () => {
            void runtime.refreshNotebooks().catch(error => console.error("Could not refresh settings notebooks", error));
        });
        window.addEventListener("resize", () => window.siyuan.menus.menu.resetPosition());
        await runtime.refreshSnippets();
        if (!isActive()) return;
        try {
            await loadPlugins(app);
            if (!isActive()) return;
            void afterLayoutReady(app);
        } catch (error) {
            console.error("Could not load settings plugins", error);
        }
        if (!isActive()) return;
        window.siyuan.isReady = true;
        ws.flushMainMessages();
        await applyCommand();
    });
    if (isActive()) ipcRenderer.send("siyuan-settings-ready");
};

installPluginStorageFetchAppId(window, Constants.SIYUAN_APPID, document.baseURI, location.origin);
void startSettingsWindow(initialize, error => {
    console.error("Could not initialize the settings window", error);
    disposeSettingsWindow();
    window.close();
});
