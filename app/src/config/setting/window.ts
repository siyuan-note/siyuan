import "../../assets/scss/base.scss";
import {ipcRenderer, webFrame} from "electron";
import {Constants} from "../../constants";
import {Model} from "../../layout/Model";
import {Menus} from "../../menus";
import {genUUID} from "../../util/genID";
import {fetchSyncPost} from "../../util/fetch";
import {addBaseURL, redirectToCheckAuth, setNoteBook} from "../../util/pathName";
import {getLocalStorage, initNativeDialogOverride, initWindowOpenOverride} from "../../protyle/util/compatibility";
import {addScriptSync} from "../../protyle/util/addScript";
import {loadDesktopHostConnection, initDesktopHost} from "../../boot/onGetConfig";
import {loadLanguages} from "../../boot/loadLanguages";
import {systemConfig} from "../systemConfig";
import {loadAssets, setInlineStyle, initAssets, reloadInlineStyles, refreshThemeStyle} from "../../util/assets";
import {initMessage} from "../../dialog/message";
import {progressLoading, processSync, downloadProgress} from "../../dialog/processSystem";
import {setSettingsWindowHost, type ISettingsWindowHost} from "./windowContext";
import {refreshSettingConfig} from "./sync";
import {openSettingDialog} from "../index";
import {switchSettingTab} from "../search/dialog";
import {withMountedBazaar} from "../bazaarTab";
import {appearanceConfigApi, refreshAppearance} from "../tabs/appearanceRuntime";
import {Setting} from "../../plugin/Setting";
import {bindMenuKeydown} from "../../menus/Menu";
import {windowMouseMove} from "../../boot/globalEvent/mousemove";
import {hideTooltip} from "../../dialog/tooltip";
import {applyCloudUserState} from "../tabs/accountUi";
import {updateServerAddresses} from "../tabs/accessRuntime";
import {installPluginStorageFetchAppId} from "../../util/fetchAppId";
import type {Dialog} from "../../dialog";
import type {ISettingsCommand} from "./nativeWindow";
import {getSettingTabDefs} from "./tabs";
import {onWindowsMsg} from "../../window/onWindowsMsg";

const initialize = async () => {
    addBaseURL();
    const token = new URLSearchParams(location.search).get("token");
    if (!token || !window.opener || window.opener.location.origin !== location.origin) {
        window.close();
        return;
    }
    const host = await new Promise<ISettingsWindowHost>(resolve => {
        window.opener.dispatchEvent(new CustomEvent("siyuan-settings-host-" + token, {detail: resolve}));
    });
    setSettingsWindowHost(host);
    let dialog: Dialog;
    let command: ISettingsCommand;
    const applyCommand = async () => {
        if (!dialog || !command || host.plugin) return;
        const next = command;
        command = undefined;
        if (next.tab) {
            switchSettingTab(dialog.element, host.app, next.tab);
            const url = new URL(location.href);
            url.searchParams.set("tab", next.tab);
            history.replaceState(null, "", url);
        }
        if (next.readme) {
            const {type, from, resource} = next.readme;
            await withMountedBazaar(({bazaar, renderReadme}) => {
                bazaar.switchBazaarTab(host.app, type, from);
                renderReadme(type, from, resource);
            });
        }
    };
    ipcRenderer.on("siyuan-settings-command", (_event, next: ISettingsCommand) => {
        command = next;
        void applyCommand();
    });
    const ws = new Model({app: host.app});
    window.siyuan = {
        zIndex: 10, isReady: false, notebooks: [], reqIds: {}, backStack: [], layout: {}, dialogs: [],
        blockPanels: [], closedTabs: [], ctrlIsPressed: false, altIsPressed: false, ws,
    };
    ws.connect({id: genUUID(), type: "main", msgCallback: data => {
        if (!data) return;
        switch (data.cmd) {
            case "logoutAuth": redirectToCheckAuth(); break;
            case "settingChanged": void refreshSettingConfig(data.data.namespace); break;
            case "setConf": void refreshSettingConfig(); break;
            case "setAppearance": appearanceConfigApi.apply(data.data); break;
            case "refreshAppearance": void refreshAppearance(data.data); break;
            case "reloadInlineStyles": void reloadInlineStyles(); break;
            case "refreshtheme": refreshThemeStyle(data.data.theme); break;
            case "reloadPlugin": void refreshSettingConfig("bazaar"); break;
            case "readonly": window.siyuan.config.editor.readOnly = data.data; break;
            case "progress": progressLoading(data); break;
            case "downloadProgress": downloadProgress(data.data); break;
            case "syncing": processSync(data); break;
            case "setCloudUser": applyCloudUserState(data.data.user, data.data.userName); break;
            case "setServerAddrs": updateServerAddresses(data.data); break;
            case "setLocalStorageVal": window.siyuan.storage[data.data.key] = data.data.val; break;
            case "setLocalStorageVals": Object.assign(window.siyuan.storage, data.data.keyVals); break;
            case "removeLocalStorageVal": delete window.siyuan.storage[data.data.key]; break;
            case "removeLocalStorageVals": data.data.keys.forEach((key: string) => delete window.siyuan.storage[key]); break;
        }
    }});
    const response = await fetchSyncPost("/api/system/getConf", {});
    if (response.code !== 0) {
        window.close();
        return;
    }
    window.siyuan.config = systemConfig(response.data.conf);
    window.siyuan.isPublish = response.data.isPublish;
    await loadDesktopHostConnection();
    await Promise.all([
        setNoteBook(),
        new Promise<void>(resolve => getLocalStorage(resolve)),
        addScriptSync(`${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`, "protyleLuteScript"),
    ]);
    await addScriptSync(`${Constants.PROTYLE_CDN}/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}`, "protyleWcHtmlScript");
    await new Promise<void>(resolve => {
        void loadLanguages(window.siyuan.config.appearance.lang, Constants.SIYUAN_VERSION, languages => {
            window.siyuan.languages = languages;
            resolve();
        });
    });
    window.siyuan.menus = new Menus(host.app);
    await initDesktopHost();
    ipcRenderer.on(Constants.SIYUAN_SEND_WINDOWS, (_event, data: IWebSocketData) => onWindowsMsg(data));
    webFrame.setZoomFactor(window.siyuan.storage[Constants.LOCAL_ZOOM]);
    const user = await fetchSyncPost("/api/setting/getCloudUser", {cached: true});
    window.siyuan.user = user.data && "userId" in user.data ? user.data : null;
    const emoji = await fetchSyncPost("/api/system/getEmojiConf", {});
    if (Array.isArray(emoji.data)) {
        window.siyuan.emojis = emoji.data;
    }
    await loadAssets(window.siyuan.config.appearance);
    await setInlineStyle();
    initAssets();
    initMessage();
    initNativeDialogOverride();
    initWindowOpenOverride(host.app);
    document.title = host.plugin?.name || window.siyuan.languages.config;
    if (host.plugin) {
        host.plugin.mount(options => {
            const setting = new Setting(options);
            options.items.forEach(item => setting.addItem(item));
            setting.open(host.plugin.name);
            return setting.dialog;
        });
    } else {
        const tab = getSettingTabDefs().find(def => def.id === new URLSearchParams(location.search).get("tab"))?.id;
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
        if (!window.siyuan.menus.menu.element.classList.contains("fn__none") && bindMenuKeydown(event)) return;
        if (event.key === "Escape" && !event.isComposing && !event.repeat) {
            window.siyuan.dialogs[window.siyuan.dialogs.length - 1]?.destroy();
            event.preventDefault();
        }
    });
    window.addEventListener("mousemove", windowMouseMove);
    window.addEventListener("blur", hideTooltip);
    window.addEventListener("resize", () => window.siyuan.menus.menu.resetPosition());
    window.addEventListener("unload", () => {
        ws.ws.onclose = null;
        ws.ws.close();
        host.plugin?.closed();
    });
    window.siyuan.isReady = true;
    ws.flushMainMessages();
    await applyCommand();
};

installPluginStorageFetchAppId(window, Constants.SIYUAN_APPID, window.location.href);
void initialize().catch(error => console.error("Could not initialize the settings window", error));
