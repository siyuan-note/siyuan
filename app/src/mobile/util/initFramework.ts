import {Constants} from "../../constants";
import {closeModel, closePanel} from "./closePanel";
import {getCurrentEditor, openMobileFileById} from "../editor";
import {openMobileOnboarding} from "../../onboarding";
import {validateName} from "../../editor/rename";
import {getEventName, isDisabledFeature, isInMobileApp} from "../../protyle/util/compatibility";
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
import {setTitle} from "../../util/processTitle";
import {activateQueuedAVLocate, queueAVLocateRequest} from "../../protyle/render/av/locate";
import {MobileTabs} from "../tabs/MobileTabs";
import {initMobileBottomBar} from "./mobileBottomBar";
import {initMobileBars} from "./mobileBars";
import {openDock} from "../dock/util";
import {
    MOBILE_SIDE_PANEL_DOCK_IDS,
    MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT,
    normalizeMobileSidePanelConfig,
    type IMobileSidePanelConfig,
} from "./mobileSidePanelConfig";
import {getMobileSidePanelConfig} from "./mobileSidePanelSetting";
import {
    getMobilePluginDock,
    getMobilePluginDockEntries,
    getMobilePluginDockLayouts,
    getMobilePluginDockSide,
    MOBILE_PLUGIN_DOCKS_CHANGE_EVENT,
    openMobilePluginDock,
    removeMobilePluginDock,
    type IMobilePluginDockEntry,
} from "../dock/pluginDockState";
import {exitSiYuan} from "../../dialog/processSystem";
import {enterDocumentFromTitle} from "../../protyle/header/titleEnter";

const getDockTabElement = (type: string) => {
    return document.querySelector(`[data-type="${CSS.escape(`sidebar-${type}-tab`)}"]`) as HTMLElement;
};

const getDockContentElement = (type: string) => {
    return document.querySelector(`[data-type="${CSS.escape(`sidebar-${type}`)}"]`) as HTMLElement;
};

const getDockIdFromTabElement = (element: HTMLElement) => {
    return element.dataset.mobilePluginDockTab ||
        element.getAttribute("data-type")?.replace(/^sidebar-/, "").replace(/-tab$/, "");
};

const getActiveDockId = (sidePanelElement: HTMLElement) => {
    const activeElement = sidePanelElement.firstElementChild.querySelector<HTMLElement>(
        "[data-type$='-tab'].toolbar__icon--active");
    return activeElement ? getDockIdFromTabElement(activeElement) : undefined;
};

const syncMobilePluginDockElements = (
    entries: readonly IMobilePluginDockEntry[],
    sidePanelElements: Record<"left" | "right", HTMLElement>,
) => {
    const entryTypes = new Set(entries.map(item => item.type));
    const tabElements = new Map<string, SVGElement>();
    const contentElements = new Map<string, HTMLElement>();
    document.querySelectorAll<SVGElement>("[data-mobile-plugin-dock-tab]").forEach((element) => {
        const type = element.dataset.mobilePluginDockTab;
        if (type) {
            tabElements.set(type, element);
        }
    });
    document.querySelectorAll<HTMLElement>("[data-mobile-plugin-dock-content]").forEach((element) => {
        const type = element.dataset.mobilePluginDockContent;
        if (type) {
            contentElements.set(type, element);
        }
    });
    tabElements.forEach((element, type) => {
        if (!entryTypes.has(type)) {
            element.remove();
            contentElements.get(type)?.remove();
            removeMobilePluginDock(type);
        }
    });

    entries.forEach((entry) => {
        const side = getMobilePluginDockSide(entry.config.position);
        const sidePanelElement = sidePanelElements[side];
        const toolbarScrollElement = sidePanelElement.firstElementChild.firstElementChild;
        const contentContainerElement = sidePanelElement.lastElementChild;
        let tabElement = tabElements.get(entry.type);
        if (!tabElement) {
            tabElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            tabElement.classList.add("toolbar__icon");
            tabElement.dataset.type = `sidebar-${entry.type}-tab`;
            tabElement.dataset.mobilePluginDockTab = entry.type;
            tabElement.append(document.createElementNS("http://www.w3.org/2000/svg", "use"));
        }
        tabElement.setAttribute("aria-label", entry.config.title);
        tabElement.setAttribute("title", entry.config.title);
        const useElement = tabElement.firstElementChild;
        useElement.setAttribute("href", `#${entry.config.icon}`);
        useElement.setAttribute("xlink:href", `#${entry.config.icon}`);
        toolbarScrollElement.append(tabElement);

        let contentElement = contentElements.get(entry.type);
        if (!contentElement) {
            contentElement = document.createElement("div");
            contentElement.className = "fn__flex-column fn__none";
            contentElement.dataset.type = `sidebar-${entry.type}`;
            contentElement.dataset.mobilePluginDockContent = entry.type;
        }
        contentContainerElement.append(contentElement);
    });
};

export const renderMobileSidePanelLayout = (
    app: App,
    config?: IMobileSidePanelConfig,
) => {
    const pluginDockEntries = getMobilePluginDockEntries(app);
    const pluginDockLayouts = getMobilePluginDockLayouts(pluginDockEntries);
    const resolvedConfig = normalizeMobileSidePanelConfig(
        config || getMobileSidePanelConfig(pluginDockLayouts), pluginDockLayouts);
    getDockTabElement("agent").classList.toggle("fn__none",
        window.siyuan.config.readonly || window.siyuan.isPublish || isDisabledFeature("ai"));
    const sidePanelElements = {
        left: document.getElementById("sidebar"),
        right: document.getElementById("sidebarRight"),
    } as const;
    const previousActive = {
        left: getActiveDockId(sidePanelElements.left),
        right: getActiveDockId(sidePanelElements.right),
    };
    const previouslyActive = new Set(Object.values(previousActive));
    syncMobilePluginDockElements(pluginDockEntries, sidePanelElements);
    const availableDockIds = new Set([
        ...MOBILE_SIDE_PANEL_DOCK_IDS,
        ...pluginDockEntries.map(item => item.type),
    ]);
    const sideDockIds: Record<"left" | "right", string[]> = {left: [], right: []};

    (["left", "right"] as const).forEach(side => {
        const sidePanelElement = sidePanelElements[side];
        const toolbarScrollElement = sidePanelElement.firstElementChild.firstElementChild;
        const contentElement = sidePanelElement.lastElementChild;
        resolvedConfig[side].forEach(type => {
            if (!availableDockIds.has(type)) {
                return;
            }
            const tabElement = getDockTabElement(type);
            const dockContentElement = getDockContentElement(type);
            if (!tabElement || !dockContentElement) {
                return;
            }
            toolbarScrollElement.append(tabElement);
            contentElement.append(dockContentElement);
            sideDockIds[side].push(type);
        });
    });

    (["left", "right"] as const).forEach(side => {
        const sidePanelElement = sidePanelElements[side];
        const visibleDockIds = sideDockIds[side].filter(type =>
            !getDockTabElement(type).classList.contains("fn__none"));
        const activeDockId = previousActive[side] && visibleDockIds.includes(previousActive[side]) ? previousActive[side] :
            visibleDockIds.find(type => previouslyActive.has(type)) || visibleDockIds[0];
        sideDockIds[side].forEach(type => {
            getDockTabElement(type).classList.toggle("toolbar__icon--active", type === activeDockId);
            getDockContentElement(type).classList.toggle("fn__none", type !== activeDockId);
        });
        if (!activeDockId) {
            sidePanelElement.style.transform = "";
        }
    });
};

const updateDock = (app: App, type: string, element: HTMLElement) => {
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
    } else if (type === "agent") {
        void import("../agent/MobileAgentChat").then(({activateMobileAgent}) => {
            activateMobileAgent(app, element);
        });
    } else {
        const pluginDock = getMobilePluginDockEntries(app).find(item => item.type === type);
        if (!pluginDock) {
            return;
        }
        const custom = getMobilePluginDock(type);
        if (custom?.update) {
            custom.update();
        } else if (!custom) {
            openMobilePluginDock(type, () => pluginDock.mobileModel(element));
        }
    }
};

const updateOpenSidePanelDocks = (app: App, sidePanelElements: HTMLElement[]) => {
    sidePanelElements.forEach(sidePanelElement => {
        if (sidePanelElement.style.transform !== "translateX(0px)") {
            return;
        }
        const activeDockId = getActiveDockId(sidePanelElement);
        if (activeDockId) {
            updateDock(app, activeDockId, getDockContentElement(activeDockId));
        }
    });
};

const initSidePanelTabs = (app: App, sidePanelElement: HTMLElement) => {
    // 不能使用 getEventName，否则点击返回会展开右侧栏
    const toolbarElement = sidePanelElement.firstElementChild as HTMLElement;
    toolbarElement.addEventListener("click", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const isProgrammatic = typeof event.detail === "string";
        let svgElement: HTMLElement;
        if (isProgrammatic) {
            svgElement = getDockTabElement(event.detail);
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
        const type = getDockIdFromTabElement(svgElement);
        if (!type) {
            return;
        }
        if (svgElement.classList.contains("toolbar__icon--active")) {
            if (isProgrammatic) {
                updateDock(app, type, getDockContentElement(type));
            }
            return;
        }

        updateDock(app, type, getDockContentElement(type));
        toolbarElement.querySelectorAll(".toolbar__icon[data-type]").forEach(item => {
            const itemType = getDockIdFromTabElement(item as HTMLElement);
            if (!itemType) {
                return;
            }
            item.classList.toggle("toolbar__icon--active", itemType === type);
            getDockContentElement(itemType).classList.toggle("fn__none", itemType !== type);
        });
    });
};

export const initFramework = async (app: App, isStart: boolean) => {
    const inlineStyleReady = setInlineStyle();
    const snippetReady = renderSnippet(Constants.TIMEOUT_SNIPPET_LOAD);
    initKeyboardToolbar();
    initMobileBottomBar(app);
    initMobileBars();
    const sidebarElement = document.getElementById("sidebar");
    const sidebarRightElement = document.getElementById("sidebarRight");
    renderMobileSidePanelLayout(app);
    initSidePanelTabs(app, sidebarElement);
    initSidePanelTabs(app, sidebarRightElement);
    const sidebarRightExitElement = document.getElementById("sidebarRightExit");
    if (isInMobileApp() && sidebarRightExitElement) {
        sidebarRightExitElement.classList.remove("fn__none");
        sidebarRightExitElement.setAttribute("aria-label", window.siyuan.languages.safeQuit);
        sidebarRightExitElement.addEventListener("click", (event) => {
            event.stopPropagation();
            void exitSiYuan();
        });
    }
    window.addEventListener(MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT, () => {
        renderMobileSidePanelLayout(app);
        updateOpenSidePanelDocks(app, [sidebarElement, sidebarRightElement]);
    });
    window.addEventListener(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT, () => {
        renderMobileSidePanelLayout(app);
        updateOpenSidePanelDocks(app, [sidebarElement, sidebarRightElement]);
    });
    await Promise.all([inlineStyleReady, snippetReady]);
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
    let titleSavePromise: Promise<unknown> = Promise.resolve();
    const saveTitle = () => {
        if (inputElement.getAttribute("readonly") === "readonly") {
            return titleSavePromise;
        }
        if (!validateName(inputElement.value)) {
            inputElement.value = inputElement.value.substring(0, Constants.SIZE_TITLE);
            return titleSavePromise;
        }

        titleSavePromise = fetchPost("/api/filetree/renameDoc", {
            notebook: window.siyuan.mobile.editor.protyle.notebookId,
            path: window.siyuan.mobile.editor.protyle.path,
            title: inputElement.value,
        });
        setTitle(inputElement.value);
        return titleSavePromise;
    };
    inputElement.setAttribute("placeholder", window.siyuan.languages._kernel[16]);
    inputElement.addEventListener("blur", () => {
        void saveTitle();
    });
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing || event.key !== "Enter") {
            return;
        }
        const protyle = window.siyuan.mobile.editor?.protyle;
        if (!protyle || protyle.disabled || inputElement.readOnly) {
            return;
        }
        const rootID = protyle.block.rootID;
        event.preventDefault();
        event.stopPropagation();
        inputElement.blur();
        enterDocumentFromTitle(protyle, {
            beforeLoad: titleSavePromise,
            isValid: () => window.siyuan.mobile.editor?.protyle === protyle && protyle.block.rootID === rootID,
        });
    });
};
