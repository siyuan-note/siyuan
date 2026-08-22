import {Constants} from "../../constants";
import {closeModel, closePanel} from "./closePanel";
import {getCurrentEditor, openMobileFileById} from "../editor";
import {openMobileOnboarding} from "../../onboarding";
import {validateName} from "../../editor/rename";
import {getEventName} from "../../protyle/util/compatibility";
import {fetchPost} from "../../util/fetch";
import {setInlineStyle} from "../../util/assets";
import {renderSnippet} from "../../config/util/snippets";
import {setEmpty} from "./setEmpty";
import {getOpenNotebookCount, parseUriInfo} from "../../util/pathName";
import {popMenu} from "../menu";
import {MobileFiles} from "../dock/MobileFiles";
import {MobileOutline} from "../dock/MobileOutline";
import {hasTopClosestByTag} from "../../protyle/util/hasClosest";
import {MobileBacklinks} from "../dock/MobileBacklinks";
import {MobileBookmarks} from "../dock/MobileBookmarks";
import {MobileTags} from "../dock/MobileTags";
import {activeBlur, initKeyboardToolbar} from "./keyboardToolbar";
import {syncGuide} from "../../sync/syncGuide";
import {Inbox} from "../../layout/dock/Inbox";
import type {App} from "../../index";
import {checkFold} from "../../util/noRelyPCFunction";
import {MobileCustom} from "../dock/MobileCustom";
import {Menu} from "../../plugin/Menu";
import {showMessage} from "../../dialog/message";
import {setTitle} from "../../util/processTitle";
import {activateQueuedAVLocate, queueAVLocateRequest} from "../../protyle/render/av/locate";
import {MobileTabs} from "../tabs/MobileTabs";
import {initMobileBottomBar} from "./mobileBottomBar";
import {initMobileBars} from "./mobileBars";
import {openDock} from "../dock/util";
import {
    MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT,
    type IMobileSidePanelConfig,
    type MobileSidePanelDockId,
} from "./mobileSidePanelConfig";
import {getMobileSidePanelConfig} from "./mobileSidePanelSetting";

let custom: MobileCustom;
const getDockTabElement = (type: MobileSidePanelDockId) => {
    return document.querySelector(`[data-type="sidebar-${type}-tab"]`) as HTMLElement;
};

const getDockContentElement = (type: MobileSidePanelDockId) => {
    return document.querySelector(`[data-type="sidebar-${type}"]`) as HTMLElement;
};

const getActiveDockId = (sidePanelElement: HTMLElement) => {
    const activeElement = sidePanelElement.firstElementChild.querySelector("[data-type$='-tab'].toolbar__icon--active");
    return activeElement?.getAttribute("data-type")?.replace("sidebar-", "").replace("-tab", "") as MobileSidePanelDockId;
};

export const renderMobileSidePanelLayout = (config: IMobileSidePanelConfig = getMobileSidePanelConfig()) => {
    const sidePanelElements = {
        left: document.getElementById("sidebar"),
        right: document.getElementById("sidebarRight"),
    } as const;
    const previousActive = {
        left: getActiveDockId(sidePanelElements.left),
        right: getActiveDockId(sidePanelElements.right),
    };
    const previouslyActive = new Set(Object.values(previousActive));

    (["left", "right"] as const).forEach(side => {
        const sidePanelElement = sidePanelElements[side];
        const toolbarScrollElement = sidePanelElement.firstElementChild.firstElementChild;
        const contentElement = sidePanelElement.lastElementChild;
        config[side].forEach(type => {
            toolbarScrollElement.append(getDockTabElement(type));
            contentElement.append(getDockContentElement(type));
        });

        const visibleDockIds = config[side].filter(type => !getDockTabElement(type).classList.contains("fn__none"));
        const activeDockId = visibleDockIds.includes(previousActive[side]) ? previousActive[side] :
            visibleDockIds.find(type => previouslyActive.has(type)) || visibleDockIds[0];
        config[side].forEach(type => {
            getDockTabElement(type).classList.toggle("toolbar__icon--active", type === activeDockId);
            getDockContentElement(type).classList.toggle("fn__none", type !== activeDockId);
        });
        if (!activeDockId) {
            sidePanelElement.style.transform = "";
        }
    });
};

const openDockMenu = (app: App, element: HTMLElement) => {
    const menu = new Menu(Constants.MENU_DOCK_MOBILE);
    if (menu.isOpen) {
        return;
    }
    app.plugins.forEach((plugin) => {
        Object.keys(plugin.docks).forEach((dockId) => {
            menu.addItem({
                label: plugin.docks[dockId].config.title,
                icon: plugin.docks[dockId].config.icon,
                click() {
                    if (custom?.type === dockId) {
                        return;
                    } else {
                        if (custom) {
                            if (custom.destroy) {
                                custom.destroy();
                            }
                        }
                        custom = plugin.docks[dockId].mobileModel(element);
                        window.siyuan.mobile.docks[dockId] = custom;
                    }
                }
            });
        });
    });
    menu.fullscreen();
    if (menu.element.lastElementChild.innerHTML === "") {
        showMessage(window.siyuan.languages._kernel[122]);
    }
};

const updateDock = (app: App, type: MobileSidePanelDockId, element: HTMLElement, openPluginMenu = false) => {
    if (type === "outline") {
        if (!window.siyuan.mobile.docks.outline) {
            window.siyuan.mobile.docks.outline = new MobileOutline({
                app,
                blockId: window.siyuan.mobile.editor?.protyle.block.rootID,
                isPreview: window.siyuan.mobile.editor ?
                    !window.siyuan.mobile.editor.protyle.preview.element.classList.contains("fn__none") : false,
                element,
            });
        } else {
            window.siyuan.mobile.docks.outline.reload();
        }
    } else if (type === "backlink") {
        if (!window.siyuan.mobile.docks.backlink) {
            window.siyuan.mobile.docks.backlink = new MobileBacklinks(app, element);
        } else {
            window.siyuan.mobile.docks.backlink.update();
        }
    } else if (type === "bookmark") {
        if (!window.siyuan.mobile.docks.bookmark) {
            window.siyuan.mobile.docks.bookmark = new MobileBookmarks(app, element);
        } else {
            window.siyuan.mobile.docks.bookmark.update();
        }
    } else if (type === "tag") {
        if (!window.siyuan.mobile.docks.tag) {
            window.siyuan.mobile.docks.tag = new MobileTags(app, element);
        } else {
            window.siyuan.mobile.docks.tag.update();
        }
    } else if (type === "inbox" && !window.siyuan.mobile.docks.inbox) {
        window.siyuan.mobile.docks.inbox = new Inbox(app, element);
    } else if (type === "plugin") {
        if (!custom || openPluginMenu) {
            if (!custom) {
                element.innerHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
            }
            openDockMenu(app, element);
        } else if (custom.update) {
            custom.update();
        }
    }
};

const initSidePanelTabs = (app: App, sidePanelElement: HTMLElement) => {
    // 不能使用 getEventName，否则点击返回会展开右侧栏
    const toolbarElement = sidePanelElement.firstElementChild as HTMLElement;
    toolbarElement.addEventListener("click", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const isProgrammatic = typeof event.detail === "string";
        let svgElement: HTMLElement;
        if (isProgrammatic) {
            svgElement = toolbarElement.querySelector(`svg[data-type="sidebar-${event.detail}-tab"]`) as HTMLElement;
        } else {
            svgElement = hasTopClosestByTag(target, "svg") as HTMLElement;
        }
        if (!svgElement) {
            return;
        }
        const tabType = svgElement.getAttribute("data-type");
        if (!tabType) {
            closePanel();
            return;
        }
        const type = tabType.replace("sidebar-", "").replace("-tab", "") as MobileSidePanelDockId;
        if (svgElement.classList.contains("toolbar__icon--active")) {
            if (isProgrammatic) {
                updateDock(app, type, getDockContentElement(type));
            } else if (type === "plugin") {
                openDockMenu(app, getDockContentElement(type));
            }
            return;
        }

        updateDock(app, type, getDockContentElement(type));
        toolbarElement.querySelectorAll(".toolbar__icon[data-type]").forEach(item => {
            const itemType = item.getAttribute("data-type").replace("sidebar-", "").replace("-tab", "") as MobileSidePanelDockId;
            item.classList.toggle("toolbar__icon--active", itemType === type);
            getDockContentElement(itemType).classList.toggle("fn__none", itemType !== type);
        });
    });
};

export const initFramework = async (app: App, isStart: boolean) => {
    setInlineStyle();
    const snippetReady = renderSnippet(Constants.TIMEOUT_SNIPPET_LOAD);
    initKeyboardToolbar();
    initMobileBottomBar(app);
    initMobileBars();
    const sidebarElement = document.getElementById("sidebar");
    const sidebarRightElement = document.getElementById("sidebarRight");
    renderMobileSidePanelLayout();
    initSidePanelTabs(app, sidebarElement);
    initSidePanelTabs(app, sidebarRightElement);
    window.addEventListener(MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT, () => {
        renderMobileSidePanelLayout();
        [sidebarElement, sidebarRightElement].forEach(sidePanelElement => {
            if (sidePanelElement.style.transform !== "translateX(0px)") {
                return;
            }
            const activeDockId = getActiveDockId(sidePanelElement);
            if (activeDockId) {
                updateDock(app, activeDockId, getDockContentElement(activeDockId));
            }
        });
    });
    await snippetReady;
    window.siyuan.mobile.docks.file = new MobileFiles(app, getDockContentElement("file"));
    document.getElementById("toolbarFile").addEventListener("click", () => {
        if (getCurrentEditor()?.protyle.toolbar.isMultiSelectMode()) {
            return;
        }
        openDock("file");
    });
    // 用 touchstart 会导致键盘不收起
    document.getElementById("toolbarMore").addEventListener("click", () => {
        popMenu();
    });
    document.getElementById("toolbarSync").addEventListener(getEventName(), () => {
        syncGuide(app);
    });
    document.getElementById("toolbarSync").setAttribute("aria-label", window.siyuan.languages.accountSync);
    document.getElementById("modelClose").addEventListener("click", () => {
        closeModel();
    });
    window.siyuan.mobile.tabs = new MobileTabs(app);
    const toolbarTabsElement = document.getElementById("toolbarTabs");
    toolbarTabsElement.setAttribute("aria-label", window.siyuan.languages.mobileTabs);
    toolbarTabsElement.addEventListener("click", () => {
        if (getCurrentEditor()?.protyle.toolbar.isMultiSelectMode()) {
            return;
        }
        activeBlur();
        window.siyuan.mobile.tabs.openOverview();
    });
    initEditorName();
    if (isStart && window.siyuan.config.fileTree.tabStartupMode === 2) {
        window.siyuan.mobile.tabs.closeAll();
    } else {
        await window.siyuan.mobile.tabs.removeMissingTabs();
    }
    if (getOpenNotebookCount() > 0) {
        if (window.JSAndroid && window.openFileByURL(window.JSAndroid.getBlockURL())) {
            return;
        }
        const info = parseUriInfo();
        if (info.id) {
            if (info.avItemID) {
                queueAVLocateRequest(info.id, {
                    itemID: info.avItemID,
                    viewID: info.avViewID,
                    groupID: info.avGroupID,
                });
            }
            openMobileFileById(app, info.id, info.avItemID ? [Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL] :
                (info.focus ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]),
            undefined, undefined, info.avItemID ? (protyle) => activateQueuedAVLocate(protyle, info.id) : undefined);
            return;
        }
        if (openMobileOnboarding(app)) {
            return;
        }
        if (isStart && window.siyuan.config.fileTree.tabStartupMode === 1) {
            window.siyuan.mobile.tabs.activateStartupBlank();
            return;
        }
        if (isStart && window.siyuan.config.fileTree.tabStartupMode === 2) {
            return;
        }
        if (await window.siyuan.mobile.tabs.restore()) {
            return;
        }
        const localDoc = window.siyuan.storage[Constants.LOCAL_DOCINFO];
        fetchPost("/api/block/checkBlockExist", {id: localDoc?.id}, existResponse => {
            if (existResponse.data) {
                openMobileFileById(app, localDoc.id, [Constants.CB_GET_SCROLL]);
            } else {
                fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                    if (response.data.length !== 0) {
                        checkFold(response.data[0].id, (zoomIn) => {
                            openMobileFileById(app, response.data[0].id, zoomIn ? [Constants.CB_GET_ALL] : [Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
                        });
                    } else {
                        setEmpty(app);
                    }
                });
            }
        });
        return;
    }
    if (isStart && window.siyuan.config.fileTree.tabStartupMode === 1) {
        window.siyuan.mobile.tabs.activateStartupBlank();
    } else {
        setEmpty(app);
    }
};

const initEditorName = () => {
    const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
    inputElement.setAttribute("placeholder", window.siyuan.languages._kernel[16]);
    inputElement.addEventListener("blur", () => {
        if (inputElement.getAttribute("readonly") === "readonly") {
            return;
        }
        if (!validateName(inputElement.value)) {
            inputElement.value = inputElement.value.substring(0, Constants.SIZE_TITLE);
            return false;
        }

        fetchPost("/api/filetree/renameDoc", {
            notebook: window.siyuan.mobile.editor.protyle.notebookId,
            path: window.siyuan.mobile.editor.protyle.path,
            title: inputElement.value,
        });
        setTitle(inputElement.value);
    });
};
