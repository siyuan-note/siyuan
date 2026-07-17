import {Constants} from "../constants";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {openImportData} from "../menus/importData";
import {mountHelp} from "../util/mount";
import {syncGuide} from "../sync/syncGuide";
import {openSetting} from "../config";
import {isPaidUser} from "../util/needSubscribe";
import type {App} from "../index";
/// #if MOBILE
import {openMobileFileById} from "../mobile/editor";
/// #else
import {openFileById} from "../editor/util";
/// #endif

export const ensureOnboarding = async () => {
    const onboarding = window.siyuan.config.onboarding;
    if (!onboarding?.newUser || onboarding.state === "completed" || window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    try {
        const response = await fetchSyncPost("/api/system/ensureOnboarding", {});
        if (response.code === 0) {
            window.siyuan.config.onboarding = response.data;
        }
    } catch (error) {
        console.warn("ensure onboarding failed", error);
    }
};

const shouldShowOnboarding = () => {
    return window.siyuan.config.onboarding?.newUser &&
        window.siyuan.config.onboarding.state === "completed" &&
        window.siyuan.config.onboarding.documentID &&
        !window.siyuan.config.onboarding.dismissed;
};

let pendingLoginHandler: (() => void) | undefined;
let pendingSyncHandler: (() => void) | undefined;
let mobileKeyboardHandler: EventListener | undefined;

const dismissOnboarding = () => {
    if (pendingLoginHandler) {
        window.removeEventListener("siyuan-login-success", pendingLoginHandler);
        pendingLoginHandler = undefined;
    }
    if (pendingSyncHandler) {
        window.removeEventListener("siyuan-sync-success", pendingSyncHandler);
        pendingSyncHandler = undefined;
    }
    if (mobileKeyboardHandler) {
        window.removeEventListener("siyuan-mobile-keyboard-change", mobileKeyboardHandler);
        mobileKeyboardHandler = undefined;
    }
    document.querySelector(".onboarding")?.remove();
    window.siyuan.config.onboarding.dismissed = true;
    fetchPost("/api/system/dismissOnboarding", {});
};

const syncAndDismissOnSuccess = (app: App) => {
    if (pendingSyncHandler) {
        window.removeEventListener("siyuan-sync-success", pendingSyncHandler);
    }
    pendingSyncHandler = () => {
        pendingSyncHandler = undefined;
        dismissOnboarding();
    };
    window.addEventListener("siyuan-sync-success", pendingSyncHandler, {once: true});
    syncGuide(app);
};

const loginAndSync = (app: App) => {
    if (window.siyuan.user) {
        if (isPaidUser()) {
            syncAndDismissOnSuccess(app);
        } else {
            syncGuide(app);
        }
        return;
    }
    if (pendingLoginHandler) {
        window.removeEventListener("siyuan-login-success", pendingLoginHandler);
    }
    pendingLoginHandler = () => {
        pendingLoginHandler = undefined;
        if (isPaidUser()) {
            syncAndDismissOnSuccess(app);
        }
    };
    window.addEventListener("siyuan-login-success", pendingLoginHandler, {once: true});
    openSetting(app, "sync");
};

const renderOnboarding = (app: App) => {
    if (!shouldShowOnboarding() || document.querySelector(".onboarding")) {
        return;
    }
    const element = document.createElement("section");
    element.className = "onboarding";
    element.innerHTML = `<button class="onboarding__close" data-type="close" aria-label="${window.siyuan.languages.close}">
    <svg><use xlink:href="#iconCloseRound"></use></svg>
</button>
<div class="onboarding__title">&#x1F389; ${window.siyuan.languages.onboardingWelcome}</div>
<div class="onboarding__desc">${window.siyuan.languages.onboardingDescription}</div>
<button class="b3-button b3-button--outline fn__block" data-type="import">
    <svg><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.importExistingData}
</button>
<button class="b3-button b3-button--outline fn__block" data-type="sync">
    <svg><use xlink:href="#iconCloud"></use></svg>${window.siyuan.languages.loginAndSync}
</button>
<button class="b3-button b3-button--outline fn__block" data-type="guide">
    <svg><use xlink:href="#iconHelp"></use></svg>${window.siyuan.languages.userGuide}
</button>`;
    element.addEventListener("click", (event) => {
        const target = (event.target as HTMLElement).closest("[data-type]") as HTMLElement;
        if (!target) {
            return;
        }
        switch (target.dataset.type) {
            case "close":
                dismissOnboarding();
                break;
            case "import":
                openImportData({
                    notebookID: window.siyuan.config.onboarding.notebookID,
                    onComplete: dismissOnboarding,
                });
                break;
            case "sync":
                loginAndSync(app);
                break;
            case "guide":
                mountHelp();
                dismissOnboarding();
                break;
        }
    });
    let containerElement = document.body;
    /// #if !MOBILE
    const editorContainerElement = (document.querySelector(".layout__center .layout__wnd--active .layout-tab-container") ||
        document.querySelector(".layout__center .layout-tab-container")) as HTMLElement;
    if (editorContainerElement) {
        containerElement = editorContainerElement;
        element.classList.add("onboarding--editor");
    }
    /// #endif
    containerElement.append(element);
    /// #if MOBILE
    mobileKeyboardHandler = (event: Event) => {
        element.classList.toggle("fn__none", (event as CustomEvent<boolean>).detail);
    };
    window.addEventListener("siyuan-mobile-keyboard-change", mobileKeyboardHandler);
    /// #endif
};

/// #if !MOBILE
export const openDesktopOnboarding = (app: App) => {
    if (!shouldShowOnboarding()) {
        return;
    }
    window.setTimeout(() => {
        openFileById({
            app,
            id: window.siyuan.config.onboarding.documentID,
            action: [Constants.CB_GET_FOCUSFIRST],
        });
        renderOnboarding(app);
    });
};
/// #endif

/// #if MOBILE
export const openMobileOnboarding = (app: App) => {
    if (!shouldShowOnboarding()) {
        return false;
    }
    openMobileFileById(app, window.siyuan.config.onboarding.documentID, [Constants.CB_GET_CONTEXT]);
    renderOnboarding(app);
    return true;
};
/// #endif
