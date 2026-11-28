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

export const moveFlashcardReviewToTab = async (app: App, reviewSetID: string, name: string,
    options: IFlashcardV2ReviewSessionOptions, position: "tab" | "right" | "bottom",
    attach: (mount: IFlashcardSessionMount) => boolean) => {
    /// #if !MOBILE
    const transferID = genUUID();
    let moved = false;
    const release = registerFlashcardSurfaceTransfer(transferID, mount => moved = attach(mount));
    try {
        await openFile({app, position: position === "tab" ? undefined : position, openNewTab: true, removeCurrentTab: false,
            custom: {icon: "iconRiffCard", title: window.siyuan.languages.spaceRepetition, id: "siyuan-card",
                data: {...createFlashcardReviewTabData(reviewSetID, name, options), transferID}}});
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
