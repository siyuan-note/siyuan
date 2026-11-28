import type {App} from "../index";
import type {IFlashcardSessionMount, IFlashcardV2ReviewSessionOptions, IFlashcardV2SessionTransfer} from "./flashcardV2Session";
import type {IFlashcardTabData} from "./flashcardTab";
import {createFlashcardReviewTabData, resolveFlashcardOpenMode} from "./flashcardOpenMode";
import {isBrowser, isMobile} from "../util/functions";
import {genUUID} from "../util/genID";
import {registerFlashcardSurfaceTransfer} from "./flashcardV2SurfaceTransfer";
import {sendFlashcardReviewToWindow} from "./flashcardV2WindowTransfer";
/// #if !MOBILE
import {openFile} from "../editor/util";
import {getAllWnds} from "../layout/getAll";
import type {Wnd} from "../layout/Wnd";
/// #if !BROWSER
import {ipcRenderer} from "electron";
import {Constants} from "../constants";
import {appendRemoteQuery} from "../util/hostCapabilities";
/// #endif
/// #endif

const openReviewWindow = (data: IFlashcardTabData) => {
    /// #if !MOBILE
    /// #if !BROWSER
    const url = new URL("/stage/build/app/window.html", window.location.origin);
    url.searchParams.set("v", Constants.SIYUAN_VERSION);
    url.searchParams.set("json", JSON.stringify([{
        title: window.siyuan.languages.spaceRepetition,
        icon: "iconRiffCard",
        instance: "Tab",
        children: {instance: "Custom", customModelType: "siyuan-card", customModelData: data},
    }]));
    ipcRenderer.send(Constants.SIYUAN_OPEN_WINDOW, {url: appendRemoteQuery(url).href});
    /// #endif
    /// #endif
};

export const moveFlashcardReviewToWindow = (reviewSetID: string, name: string,
    options: IFlashcardV2ReviewSessionOptions, state: IFlashcardV2SessionTransfer,
    takeOwnership: () => (() => void) | undefined) => {
    if (isMobile() || isBrowser()) {
        return Promise.resolve(false);
    }
    const windowTransferID = genUUID();
    const data = {...createFlashcardReviewTabData(reviewSetID, name, options), windowTransferID};
    return sendFlashcardReviewToWindow(windowTransferID, state, () => openReviewWindow(data), takeOwnership);
};

/// #if !MOBILE
const findReviewRelocationAnchor = (source?: IFlashcardSessionMount) => {
    if (!source || source.signal.aborted) { return; }
    const sourceID = source.element.closest<HTMLElement>('[data-type="wnd"][data-id]')?.dataset.id;
    if (!sourceID) { return; }
    const layout = window.siyuan.layout.centerLayout || window.siyuan.layout.layout;
    if (!layout) { return; }
    const wnds: Wnd[] = [];
    getAllWnds(layout, wnds);
    const index = wnds.findIndex(wnd => wnd.id === sourceID);
    if (index < 0 || wnds[index].children.length !== 1) { return; }
    // 复习是源窗格的唯一页签时，在该窗格分屏会随源页签关闭而折叠。
    for (let distance = 1; distance < wnds.length; distance++) {
        const neighbor = [wnds[index - distance], wnds[index + distance]].find(wnd =>
            wnd?.element.isConnected && wnd.children[0]?.headElement);
        if (neighbor) { return neighbor; }
    }
};
/// #endif

export const moveFlashcardReviewToTab = async (app: App, reviewSetID: string, name: string,
    options: IFlashcardV2ReviewSessionOptions, position: "tab" | "right" | "bottom",
    attach: (mount: IFlashcardSessionMount) => boolean, source?: IFlashcardSessionMount) => {
    /// #if !MOBILE
    if (source?.signal.aborted) { return false; }
    const anchor = findReviewRelocationAnchor(source);
    const transferID = genUUID();
    let moved = false;
    const release = registerFlashcardSurfaceTransfer(transferID, mount => moved = attach(mount));
    try {
        await openFile({app, position: position === "tab" ? undefined : position, openNewTab: true, removeCurrentTab: false,
            custom: {icon: "iconRiffCard", title: window.siyuan.languages.spaceRepetition, id: "siyuan-card",
                data: {...createFlashcardReviewTabData(reviewSetID, name, options), transferID}}}, anchor);
        return moved;
    } finally {
        release();
    }
    /// #endif
    return false;
};

export const openFlashcardReviewTab = (app: App, reviewSetID: string, name: string,
                                      options: IFlashcardV2ReviewSessionOptions, onTabOpened?: () => void) => {
    const mode = resolveFlashcardOpenMode(window.siyuan.config.flashcard.openMode, isMobile(), isBrowser());
    if (mode === 0) {
        return false;
    }
    /// #if !MOBILE
    const data = createFlashcardReviewTabData(reviewSetID, name, options);
    const title = window.siyuan.languages.spaceRepetition;
    /// #if !BROWSER
    if (mode === 3) {
        openReviewWindow(data);
        return true;
    }
    /// #endif
    void openFile({
        app,
        position: mode === 2 ? "right" : undefined,
        custom: {icon: "iconRiffCard", title, data, id: "siyuan-card"},
    }).then((tab) => {
        if (tab?.headElement.classList.contains("item--focus") && tab.panelElement.isConnected &&
            !tab.panelElement.classList.contains("fn__none")) {
            onTabOpened?.();
        }
    }).catch(error => console.error("Flashcard review tab failed", error));
    return true;
    /// #endif
    return false;
};
