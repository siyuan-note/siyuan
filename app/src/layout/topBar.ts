import {getWorkspaceName} from "../util/noRelyPCFunction";
import {setStorageVal, updateHotkeyTip} from "../protyle/util/compatibility";
import {processSync} from "../dialog/processSystem";
import {goBack, goForward} from "../util/backForward";
import {syncGuide} from "../sync/syncGuide";
import {workspaceMenu} from "../menus/workspace";
import {editor} from "../config/editor";
import {MenuItem} from "../menus/Menu";
import {setMode} from "../util/assets";
import {openSetting} from "../config";
import {openSearch} from "../search/spread";
import {App} from "../index";
/// #if !BROWSER
import {webFrame} from "electron";
/// #endif
import {Constants} from "../constants";
import {isBrowser, isWindow} from "../util/functions";
import {Menu} from "../plugin/Menu";
import {fetchPost} from "../util/fetch";
import {needSubscribe} from "../util/needSubscribe";
import * as dayjs from "dayjs";
import {commandPanel} from "../plugin/commandPanel";

export const updateEditModeElement = () => {
    const target = document.querySelector("#barReadonly");
    if (window.siyuan.config.editor.readOnly) {
        target.classList.add("toolbar__item--active");
        target.setAttribute("aria-label", `${window.siyuan.languages.use} ${window.siyuan.languages.editMode} ${updateHotkeyTip(window.siyuan.config.keymap.general.editMode.custom)}`);
        target.querySelector("use").setAttribute("xlink:href", "#iconPreview");
    } else {
        target.classList.remove("toolbar__item--active");
        target.setAttribute("aria-label", `${window.siyuan.languages.use} ${window.siyuan.languages.editReadonly} ${updateHotkeyTip(window.siyuan.config.keymap.general.editMode.custom)}`);
        target.querySelector("use").setAttribute("xlink:href", "#iconEdit");
    }
};

export const initBar = (app: App) => {
    const toolbarElement = document.getElementById("toolbar");
    toolbarElement.innerHTML = `
<div id="barWorkspace" class="toolbar__item toolbar__item--active">
    <span class="toolbar__text">${getWorkspaceName()}</span>
    <svg class="toolbar__svg"><use xlink:href="#iconDown"></use></svg>
</div>
<div id="barSync" data-position="top" data-type="a" class="toolbar__item${window.siyuan.config.readonly ? " fn__none" : ""}">
    <svg><use xlink:href="#iconCloudSucc"></use></svg>
</div>
<button id="barBack" data-type="a" class="toolbar__item toolbar__item--disabled" aria-label="${window.siyuan.languages.goBack} ${updateHotkeyTip(window.siyuan.config.keymap.general.goBack.custom)}">
    <svg><use xlink:href="#iconBack"></use></svg>
</button>
<button id="barForward" data-type="a" class="toolbar__item toolbar__item--disabled" aria-label="${window.siyuan.languages.goForward} ${updateHotkeyTip(window.siyuan.config.keymap.general.goForward.custom)}">
    <svg><use xlink:href="#iconForward"></use></svg>
</button>
<div class="fn__flex-1 fn__ellipsis" id="drag"><span class="fn__none">开发版，使用前请进行备份 Development version, please backup before use</span></div>
<div id="toolbarVIP" class="fn__flex${window.siyuan.config.readonly ? " fn__none" : ""}"></div>
<div id="barPlugins" class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.plugin}">
    <svg><use xlink:href="#iconPlugin"></use></svg>
</div>
<div id="barSearch" class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.globalSearch} ${updateHotkeyTip(window.siyuan.config.keymap.general.globalSearch.custom)}">
    <svg><use xlink:href="#iconSearch"></use></svg>
</div>
<div id="barZoom" class="toolbar__item b3-tooltips b3-tooltips__sw${(window.siyuan.storage[Constants.LOCAL_ZOOM] === 1 || isBrowser()) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.zoom}">
    <svg><use xlink:href="#iconZoom${window.siyuan.storage[Constants.LOCAL_ZOOM] > 1 ? "In" : "Out"}"></use></svg>
</div>
<div id="barReadonly" class="toolbar__item b3-tooltips b3-tooltips__sw${window.siyuan.config.readonly ? " fn__none" : ""}${window.siyuan.config.editor.readOnly ? " toolbar__item--active" : ""}" aria-label="${window.siyuan.languages.use} ${window.siyuan.config.editor.readOnly ? window.siyuan.languages.editMode : window.siyuan.languages.editReadonly} ${updateHotkeyTip(window.siyuan.config.keymap.general.editMode.custom)}">
    <svg><use xlink:href="#icon${window.siyuan.config.editor.readOnly ? "Preview" : "Edit"}"></use></svg>
</div>
<div id="barMode" class="toolbar__item b3-tooltips b3-tooltips__sw${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.appearanceMode}">
    <svg><use xlink:href="#icon${window.siyuan.config.appearance.modeOS ? "Mode" : (window.siyuan.config.appearance.mode === 0 ? "Light" : "Dark")}"></use></svg>
</div>
<div id="barMore" class="toolbar__item">
    <svg><use xlink:href="#iconMore"></use></svg>
</div>
<div class="fn__flex" id="windowControls"></div>`;
    processSync();
    toolbarElement.addEventListener("click", (event: MouseEvent) => {
        let target = event.target as HTMLElement;
        if (typeof event.detail === "string") {
            target = toolbarElement.querySelector("#" + event.detail);
        }
        while (!target.classList.contains("toolbar")) {
            const targetId = typeof event.detail === "string" ? event.detail : target.id;
            if (targetId === "barBack") {
                goBack(app);
                event.stopPropagation();
                break;
            } else if (targetId === "barMore") {
                if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
                    window.siyuan.menus.menu.element.getAttribute("data-name") === "barmore") {
                    window.siyuan.menus.menu.remove();
                    return;
                }
                window.siyuan.menus.menu.remove();
                window.siyuan.menus.menu.element.setAttribute("data-name", "barmore");
                (target.getAttribute("data-hideids") || "").split(",").forEach((itemId) => {
                    const hideElement = toolbarElement.querySelector("#" + itemId);
                    const useElement = hideElement.querySelector("use");
                    const menuOptions: IMenu = {
                        label: itemId === "toolbarVIP" ? window.siyuan.languages.account : hideElement.getAttribute("aria-label"),
                        icon: itemId === "toolbarVIP" ? "iconAccount" : (useElement ? useElement.getAttribute("xlink:href").substring(1) : undefined),
                        click: () => {
                            if (itemId.startsWith("plugin")) {
                                hideElement.dispatchEvent(new CustomEvent("click"));
                            } else {
                                toolbarElement.dispatchEvent(new CustomEvent("click", {detail: itemId}));
                            }
                        }
                    };
                    if (!useElement) {
                        const svgElement = hideElement.querySelector("svg").cloneNode(true) as HTMLElement;
                        svgElement.classList.add("b3-menu__icon");
                        menuOptions.iconHTML = svgElement.outerHTML;
                    }
                    window.siyuan.menus.menu.append(new MenuItem(menuOptions).element);
                });
                const rect = target.getBoundingClientRect();
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom}, true);
                event.stopPropagation();
                break;
            } else if (targetId === "barForward") {
                goForward(app);
                event.stopPropagation();
                break;
            } else if (targetId === "barSync") {
                syncGuide(app);
                event.stopPropagation();
                break;
            } else if (targetId === "barWorkspace") {
                workspaceMenu(app, target.getBoundingClientRect());
                event.stopPropagation();
                break;
            } else if (targetId === "barReadonly") {
                editor.setReadonly();
                event.stopPropagation();
                break;
            } else if (targetId === "barMode") {
                if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
                    window.siyuan.menus.menu.element.getAttribute("data-name") === "barmode") {
                    window.siyuan.menus.menu.remove();
                    return;
                }
                window.siyuan.menus.menu.remove();
                window.siyuan.menus.menu.element.setAttribute("data-name", "barmode");
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.themeLight,
                    icon: "iconLight",
                    current: window.siyuan.config.appearance.mode === 0 && !window.siyuan.config.appearance.modeOS,
                    click: () => {
                        setMode(0);
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.themeDark,
                    current: window.siyuan.config.appearance.mode === 1 && !window.siyuan.config.appearance.modeOS,
                    icon: "iconDark",
                    click: () => {
                        setMode(1);
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.themeOS,
                    current: window.siyuan.config.appearance.modeOS,
                    icon: "iconMode",
                    click: () => {
                        setMode(2);
                    }
                }).element);
                let rect = target.getBoundingClientRect();
                if (rect.width === 0) {
                    rect = toolbarElement.querySelector("#barMore").getBoundingClientRect();
                }
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom}, true);
                event.stopPropagation();
                break;
            } else if (targetId === "toolbarVIP") {
                if (!window.siyuan.config.readonly) {
                    const dialogSetting = openSetting(app);
                    dialogSetting.element.querySelector('.b3-tab-bar [data-name="account"]').dispatchEvent(new CustomEvent("click"));
                }
                event.stopPropagation();
                break;
            } else if (targetId === "barSearch") {
                openSearch({
                    app,
                    hotkey: window.siyuan.config.keymap.general.globalSearch.custom
                });
                event.stopPropagation();
                break;
            } else if (targetId === "barPlugins") {
                openPlugin(app, target);
                event.stopPropagation();
                break;
            } else if (targetId === "barZoom") {
                if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
                    window.siyuan.menus.menu.element.getAttribute("data-name") === "barZoom") {
                    window.siyuan.menus.menu.remove();
                    return;
                }
                window.siyuan.menus.menu.remove();
                window.siyuan.menus.menu.element.setAttribute("data-name", "barZoom");
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.zoomIn,
                    icon: "iconZoomIn",
                    accelerator: "⌘=",
                    click: () => {
                        setZoom("zoomIn");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.zoomOut,
                    accelerator: "⌘-",
                    icon: "iconZoomOut",
                    click: () => {
                        setZoom("zoomOut");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.reset,
                    accelerator: "⌘0",
                    click: () => {
                        setZoom("restore");
                    }
                }).element);
                let rect = target.getBoundingClientRect();
                if (rect.width === 0) {
                    rect = toolbarElement.querySelector("#barMore").getBoundingClientRect();
                }
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom}, true);
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
    const barSyncElement = toolbarElement.querySelector("#barSync");
    barSyncElement.addEventListener("mouseenter", (event) => {
        event.stopPropagation();
        event.preventDefault();
        fetchPost("/api/sync/getSyncInfo", {}, (response) => {
            let html = "";
            if (!window.siyuan.config.sync.enabled || (0 === window.siyuan.config.sync.provider && needSubscribe(""))) {
                html = response.data.stat;
            } else {
                html = window.siyuan.languages._kernel[82].replace("%s", dayjs(response.data.synced).format("YYYY-MM-DD HH:mm")) + "<br>";
                html += "  " + response.data.stat;
                if (response.data.kernels.length > 0) {
                    html += "<br>";
                    html += window.siyuan.languages.currentKernel + "<br>";
                    html += "  " + response.data.kernel + "/" + window.siyuan.config.system.kernelVersion + " (" + window.siyuan.config.system.os + "/" + window.siyuan.config.system.name + ")<br>";
                    html += window.siyuan.languages.otherOnlineKernels + "<br>";
                    response.data.kernels.forEach((item: {
                        os: string;
                        ver: string;
                        hostname: string;
                        id: string;
                    }) => {
                        html += `  ${item.id}/${item.ver} (${item.os}/${item.hostname}) <br>`;
                    });
                }
            }
            barSyncElement.setAttribute("aria-label", html);
        });
    });
    barSyncElement.setAttribute("aria-label", window.siyuan.config.sync.stat || (window.siyuan.languages.syncNow + " " + updateHotkeyTip(window.siyuan.config.keymap.general.syncNow.custom)));
};

export const setZoom = (type: "zoomIn" | "zoomOut" | "restore") => {
    /// #if !BROWSER
    const isTabWindow = isWindow();
    let zoom = 1;
    if (type === "zoomIn") {
        Constants.SIZE_ZOOM.find((item, index) => {
            if (item === window.siyuan.storage[Constants.LOCAL_ZOOM]) {
                zoom = Constants.SIZE_ZOOM[index + 1] || 3;
                return true;
            }
        });
    } else if (type === "zoomOut") {
        Constants.SIZE_ZOOM.find((item, index) => {
            if (item === window.siyuan.storage[Constants.LOCAL_ZOOM]) {
                zoom = Constants.SIZE_ZOOM[index - 1] || 0.25;
                return true;
            }
        });
    }

    webFrame.setZoomFactor(zoom);
    window.siyuan.storage[Constants.LOCAL_ZOOM] = zoom;
    if (!isTabWindow) {
        setStorageVal(Constants.LOCAL_ZOOM, zoom);
    }
    const barZoomElement = document.getElementById("barZoom");
    if (zoom === 1) {
        barZoomElement.classList.add("fn__none");
    } else {
        if (zoom > 1) {
            barZoomElement.querySelector("use").setAttribute("xlink:href", "#iconZoomIn");
        } else {
            barZoomElement.querySelector("use").setAttribute("xlink:href", "#iconZoomOut");
        }
        barZoomElement.classList.remove("fn__none");
    }
    /// #endif
};

const openPlugin = (app: App, target: Element) => {
    const menu = new Menu("topBarPlugin");
    menu.addItem({
        icon: "iconSettings",
        label: window.siyuan.languages.config,
        click() {
            openSetting(app).element.querySelector('.b3-tab-bar [data-name="bazaar"]').dispatchEvent(new CustomEvent("click"));
        }
    });
    menu.addItem({
        icon: "iconLayoutBottom",
        accelerator: window.siyuan.config.keymap.general.commandPanel.custom,
        label: window.siyuan.languages.commandPanel,
        click() {
            commandPanel(app);
        }
    });
    menu.addSeparator();
    let hasPlugin = false;
    app.plugins.forEach((plugin) => {
        // @ts-ignore
        const hasSetting = plugin.setting || plugin.__proto__.hasOwnProperty("openSetting");
        let hasTopBar = false;
        plugin.topBarIcons.forEach(item => {
            const hasUnpin = window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(item.id);
            const submenu = [{
                icon: "iconPin",
                label: hasUnpin ? window.siyuan.languages.pin : window.siyuan.languages.unpin,
                click() {
                    if (hasUnpin) {
                        window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].splice(window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].indexOf(item.id), 1);
                        item.classList.remove("fn__none");
                    } else {
                        window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].push(item.id);
                        window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN] = Array.from(new Set(window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN]));
                        item.classList.add("fn__none");
                    }
                    setStorageVal(Constants.LOCAL_PLUGINTOPUNPIN, window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN]);
                }
            }];
            if (hasSetting) {
                submenu.push({
                    icon: "iconSettings",
                    label: window.siyuan.languages.config,
                    click() {
                        plugin.openSetting();
                    },
                });
            }
            const menuOption: IMenu = {
                icon: "iconInfo",
                label: item.getAttribute("aria-label"),
                click() {
                    item.dispatchEvent(new CustomEvent("click"));
                },
                type: "submenu",
                submenu
            };
            if (item.querySelector("use")) {
                menuOption.icon = item.querySelector("use").getAttribute("xlink:href").replace("#", "");
            } else {
                const svgElement = item.querySelector("svg").cloneNode(true) as HTMLElement;
                svgElement.classList.add("b3-menu__icon");
                menuOption.iconHTML = svgElement.outerHTML;
            }
            menu.addItem(menuOption);
            hasPlugin = true;
            hasTopBar = true;
        });
        if (!hasTopBar && hasSetting) {
            hasPlugin = true;
            menu.addItem({
                icon: "iconSettings",
                label: plugin.displayName,
                click() {
                    plugin.openSetting();
                }
            });
        }
    });
    if (!hasPlugin) {
        window.siyuan.menus.menu.element.querySelector(".b3-menu__separator").remove();
    }
    let rect = target.getBoundingClientRect();
    if (rect.width === 0) {
        rect = document.querySelector("#barMore").getBoundingClientRect();
    }
    menu.open({x: rect.right, y: rect.bottom, isLeft: true});
};
