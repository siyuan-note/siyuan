import {Constants} from "../constants";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {openDataMigration} from "../menus/dataMigration";
import {mountHelp} from "../util/mount";
import {syncGuide} from "../sync/syncGuide";
import {openSetting} from "../config";
import {isPaidUser} from "../util/needSubscribe";
import {parseUriInfo, setNoteBook} from "../util/pathName";
import type {App} from "../index";
import {getHostCapabilities} from "../util/hostCapabilities";
/// #if MOBILE
import {AdaptiveDialog} from "../dialog/adaptiveDialog";
import {openMobileFileById} from "../mobile/editor";
import {openMobileSetting} from "../mobile/menu";
import {closeModel} from "../mobile/util/closePanel";
/// #else
import {openFileById} from "../editor/util";
import {getAllTabs} from "../layout/getAll";
/// #endif

export const ensureOnboarding = async () => {
    const onboarding = window.siyuan.config.onboarding;
    if (!onboarding?.newUser || onboarding.dismissed || window.siyuan.config.readonly || window.siyuan.isPublish) {
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
/// #if MOBILE
let mobileOnboardingDialog: AdaptiveDialog | undefined;
let mobileOnboardingInSettings = false;
/// #endif
let openingOnboardingDocument = false;

const dismissOnboarding = () => {
    if (window.siyuan.config.onboarding.dismissed) return;
    window.siyuan.config.onboarding.dismissed = true;
    if (pendingLoginHandler) {
        window.removeEventListener("siyuan-login-success", pendingLoginHandler);
        pendingLoginHandler = undefined;
    }
    if (pendingSyncHandler) {
        window.removeEventListener("siyuan-sync-success", pendingSyncHandler);
        pendingSyncHandler = undefined;
    }
    /// #if MOBILE
    mobileOnboardingInSettings = false;
    mobileOnboardingDialog?.destroy();
    /// #else
    const onboardingElement = document.querySelector(".onboarding");
    onboardingElement?.parentElement?.classList.remove("onboarding-container");
    onboardingElement?.remove();
    /// #endif
    fetchPost("/api/system/dismissOnboarding", {});
};

const syncAndDismissOnSuccess = (app: App, openSyncSettings?: () => void) => {
    if (pendingSyncHandler) {
        window.removeEventListener("siyuan-sync-success", pendingSyncHandler);
    }
    pendingSyncHandler = () => {
        pendingSyncHandler = undefined;
        dismissOnboarding();
    };
    window.addEventListener("siyuan-sync-success", pendingSyncHandler, {once: true});
    syncGuide(app, openSyncSettings);
};

const loginAndSync = (app: App, openSyncSettings?: () => void) => {
    if (window.siyuan.user) {
        if (isPaidUser()) {
            syncAndDismissOnSuccess(app, openSyncSettings);
        } else {
            syncGuide(app, openSyncSettings);
        }
        return;
    }
    if (pendingLoginHandler) {
        window.removeEventListener("siyuan-login-success", pendingLoginHandler);
    }
    pendingLoginHandler = () => {
        pendingLoginHandler = undefined;
        if (isPaidUser()) {
            syncAndDismissOnSuccess(app, openSyncSettings);
        }
    };
    window.addEventListener("siyuan-login-success", pendingLoginHandler, {once: true});
    if (openSyncSettings) {
        openSyncSettings();
    } else {
        openSetting(app, "sync");
    }
};

const onboardingTitle = () => `&#x1F389; ${window.siyuan.languages.onboardingWelcome}`;

const onboardingActions = (mobile = false) => {
    const buttonClass = `b3-button b3-button--outline fn__block${mobile ? " b3-button--touch b3-button--wrap" : ""}`;
    return `${getHostCapabilities().documentImportExport ? `<button type="button" class="${buttonClass}" data-type="import">
    <svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.importExistingData}
</button>` : ""}
<button type="button" class="${buttonClass}" data-type="sync">
    <svg><use xlink:href="#iconCloud"></use></svg>${window.siyuan.languages.loginAndSync}
</button>
<button type="button" class="${buttonClass}" data-type="guide">
    <svg><use xlink:href="#iconHelp"></use></svg>${window.siyuan.languages.userGuide}
</button>`;
};

const bindOnboardingActions = (app: App, element: HTMLElement, openSyncSettings?: () => void) => {
    element.addEventListener("click", (event) => {
        const target = (event.target as Element).closest<HTMLButtonElement>("button[data-type]");
        if (!target || element.dataset.dialogClosing === "true") {
            return;
        }
        switch (target.dataset.type) {
            case "close":
                dismissOnboarding();
                break;
            case "import":
                if (getHostCapabilities().documentImportExport) {
                    openDataMigration({
                        mode: "onboarding",
                        notebookID: window.siyuan.config.onboarding.notebookID,
                        onContentImportComplete: dismissOnboarding,
                    });
                }
                break;
            case "sync":
                loginAndSync(app, openSyncSettings);
                break;
            case "guide":
                mountHelp();
                dismissOnboarding();
                break;
        }
    });
};

/// #if !MOBILE
const renderDesktopOnboarding = (app: App) => {
    if (!shouldShowOnboarding() || document.querySelector(".onboarding")) {
        return;
    }
    const element = document.createElement("section");
    element.className = "onboarding";
    element.innerHTML = `<button type="button" class="onboarding__close" data-type="close" aria-label="${window.siyuan.languages.close}">
    <svg><use xlink:href="#iconCloseRound"></use></svg>
</button>
<div class="onboarding__title">${onboardingTitle()}</div>
<div class="onboarding__desc">${window.siyuan.languages.onboardingDescription}</div>
${onboardingActions()}`;
    bindOnboardingActions(app, element);
    let containerElement = document.body;
    const editorContainerElement = document.querySelector(".layout__center") as HTMLElement;
    if (editorContainerElement) {
        containerElement = editorContainerElement;
        containerElement.classList.add("onboarding-container");
        element.classList.add("onboarding--editor");
    }
    containerElement.append(element);
};

export const openDesktopOnboarding = (app: App) => {
    if (!shouldShowOnboarding()) {
        return;
    }
    window.setTimeout(() => {
        if (!shouldShowOnboarding()) {
            return;
        }
        renderDesktopOnboarding(app);
        if (getAllTabs("Editor").length > 0 || parseUriInfo().id || openingOnboardingDocument) {
            return;
        }
        openingOnboardingDocument = true;
        void openFileById({
            app,
            id: window.siyuan.config.onboarding.documentID,
            action: [Constants.CB_GET_FOCUSFIRST],
        }).finally(() => {
            openingOnboardingDocument = false;
        }).catch((error) => {
            console.warn("open onboarding document failed", error);
        });
    });
};
/// #endif

/// #if MOBILE
const renderMobileOnboarding = (app: App) => {
    if (!shouldShowOnboarding() || mobileOnboardingDialog || mobileOnboardingInSettings) return;
    const dialog = new AdaptiveDialog({
        title: onboardingTitle(),
        content: `<div class="b3-dialog__content onboarding-sheet__content">
    <p>${window.siyuan.languages.onboardingDescription}</p>
    ${onboardingActions(true)}
</div>
<div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-type="close">${window.siyuan.languages.close}</button>
</div>`,
        destroyCallback: options => {
            mobileOnboardingDialog = undefined;
            if (!options?.openSyncSettings) {
                dismissOnboarding();
                return;
            }
            if (shouldShowOnboarding()) {
                openMobileSetting(app, "sync", () => {
                    closeModel();
                    mobileOnboardingInSettings = false;
                    renderMobileOnboarding(app);
                });
            }
        },
    });
    mobileOnboardingDialog = dialog;
    bindOnboardingActions(app, dialog.element, () => {
        const current = mobileOnboardingDialog;
        if (!current || current.element.dataset.dialogClosing === "true") return;
        // 设置面板显示期间，让系统返回由设置自身接管。
        mobileOnboardingInSettings = true;
        void current.requestClose("programmatic", {openSyncSettings: true});
    });
};

export const openMobileOnboarding = (app: App) => {
    if (!shouldShowOnboarding()) {
        return false;
    }
    if (!openingOnboardingDocument && !mobileOnboardingDialog && !mobileOnboardingInSettings) {
        openingOnboardingDocument = true;
        void openMobileFileById(app, window.siyuan.config.onboarding.documentID, [Constants.CB_GET_CONTEXT]).catch(error => {
            console.warn("open onboarding document failed", error);
        }).finally(() => {
            openingOnboardingDocument = false;
            renderMobileOnboarding(app);
        });
    }
    return true;
};
/// #endif

export const activateOnboarding = async (app: App, onboarding: Config.IConf["onboarding"]) => {
    window.siyuan.config.onboarding = onboarding;
    await ensureOnboarding();
    setNoteBook(() => {
        /// #if MOBILE
        openMobileOnboarding(app);
        /// #else
        openDesktopOnboarding(app);
        /// #endif
    });
};
