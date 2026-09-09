import type {App} from "../index";
import type {IFlashcardV2ReviewSessionOptions} from "./flashcardV2Session";
import {createFlashcardReviewTabData, resolveFlashcardOpenMode} from "./flashcardOpenMode";
import {isBrowser, isMobile} from "../util/functions";
/// #if !MOBILE
import {openFile} from "../editor/util";
/// #if !BROWSER
import {ipcRenderer} from "electron";
import {Constants} from "../constants";
import {appendRemoteQuery} from "../util/hostCapabilities";
/// #endif
/// #endif

export const openFlashcardReviewTab = (app: App, reviewSetID: string, name: string,
                                      options: IFlashcardV2ReviewSessionOptions) => {
    const mode = resolveFlashcardOpenMode(window.siyuan.config.flashcard.openMode, isMobile(), isBrowser());
    if (mode === 0) {
        return false;
    }
    /// #if !MOBILE
    const data = createFlashcardReviewTabData(reviewSetID, name, options);
    const title = window.siyuan.languages.spaceRepetition;
    /// #if !BROWSER
    if (mode === 3) {
        const url = new URL("/stage/build/app/window.html", window.location.origin);
        url.searchParams.set("v", Constants.SIYUAN_VERSION);
        url.searchParams.set("json", JSON.stringify([{
            title,
            icon: "iconRiffCard",
            instance: "Tab",
            children: {
                instance: "Custom",
                customModelType: "siyuan-card",
                customModelData: data,
            },
        }]));
        ipcRenderer.send(Constants.SIYUAN_OPEN_WINDOW, {url: appendRemoteQuery(url).href});
        return true;
    }
    /// #endif
    openFile({
        app,
        position: mode === 2 ? "right" : undefined,
        custom: {icon: "iconRiffCard", title, data, id: "siyuan-card"},
    });
    return true;
    /// #endif
    return false;
};
