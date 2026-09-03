import {showMessage} from "../../dialog/message";
import {fetchPost} from "../../util/fetch";
import {confirmDialog} from "../../dialog/confirmDialog";
/// #if !BROWSER
import * as path from "path";
/// #endif
import {getFrontend, isMobile} from "../../util/functions";
import {setStorageVal, writeText} from "../../protyle/util/compatibility";
import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";
import {Plugin} from "../../plugin";
import type {App} from "../../index";
import {escapeHtml} from "../../util/escape";
import {setGlobalPluginsDisabled} from "../../plugin/globalState";
import {useShell} from "../../util/pathName";
import {previewImages} from "../../protyle/preview/image";
import {isBazaarPackageRatingEditable, sortBazaarPackages} from "../../util/bazaarPackage";
import {Constants} from "../../constants";
import {
    BAZAAR_PACKAGE_CONFIG,
    getBazaarTypeByMyType,
    getBazaarTypeByTab,
    isBazaarPackageType,
} from "./packageConfig";
import {openRatingDialog, refreshVisibleRatingUI, syncRatingUser} from "./rating";

type TBazaarController = typeof import("../bazaar").bazaar;
type TBazaarPackageSource = "downloaded" | "updated" | "bazaar";

interface IBazaarMountSnapshot {
    element: HTMLElement;
    generation: number;
    requestID?: number;
}

interface IBazaarClickContext {
    controller: TBazaarController;
    app: App;
    mount: IBazaarMountSnapshot;
    packageSource?: TBazaarPackageSource;
    packageName?: string;
    pkgType?: TBazaarType;
    pkgItem?: IBazaarItem;
    updatedItem?: IUpdatedBazaarItem;
    installedItem?: IBazaarItem;
    availableItem?: IBazaarItem;
}

interface IBazaarActionResult {
    handled: boolean;
    preventDefault?: boolean;
    stopPropagation?: boolean;
}

type TBazaarActionHandler = (context: IBazaarClickContext, target: HTMLElement) => IBazaarActionResult;

const CONTINUE: IBazaarActionResult = {handled: false};
const HANDLED: IBazaarActionResult = {handled: true, preventDefault: true, stopPropagation: true};
const HANDLED_NATIVE: IBazaarActionResult = {handled: true, stopPropagation: true};

const handleDownloadedTab: TBazaarActionHandler = (context, target) => {
    const {controller, app} = context;
    const type = target.getAttribute("data-type");
    const bazaarType = getBazaarTypeByMyType(type);
    if (!bazaarType && type !== "myUpdate") {
        return CONTINUE;
    }
    const downloadedLoading = controller.element.querySelector("#configBazaarDownloaded")
        .getAttribute("data-loading");
    if (target.classList.contains("b3-button--outline") && (type === "myUpdate" || !downloadedLoading)) {
        target.parentElement.querySelectorAll('.b3-button[data-type^="my"]').forEach((item: HTMLElement) => {
            item.classList.add("b3-button--outline");
        });
        target.classList.remove("b3-button--outline");
        if (type === "myUpdate") {
            controller._updateDownloadedToolbar("update");
            controller._renderUpdatePanel();
            controller._checkUpdate();
        } else if (bazaarType) {
            controller._genMyHTML(bazaarType, app);
        }
    }
    return HANDLED;
};

const ACTION_HANDLERS = {
    "rate-package": ((context) => {
        const {controller, packageSource, packageName, pkgType, installedItem, pkgItem} = context;
        const packageInstalled = Boolean(installedItem) ||
            (packageSource === "bazaar" && pkgItem?.installed === true);
        if (!pkgType || !packageName || !isBazaarPackageRatingEditable(packageSource, packageInstalled)) {
            return CONTINUE;
        }
        openRatingDialog(controller, pkgType, packageName);
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    "copy-funding": ((context, target) => {
        const funding = target.getAttribute("data-funding");
        if (funding) {
            writeText(funding);
            showMessage(window.siyuan.languages.copied);
        }
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    "keywords-expand": ((context, target) => {
        target.parentElement?.querySelectorAll("[data-keyword-hidden]").forEach((item) => {
            item.classList.remove("fn__none");
        });
        target.remove();
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    "bazaar-alternative": ((context, target) => {
        const alternativeType = target.getAttribute("data-package-type");
        const alternativeName = target.getAttribute("data-package-name");
        if (isBazaarPackageType(alternativeType) && alternativeName) {
            context.controller._openBazaarAlternative(alternativeType, alternativeName);
        }
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    open: ((context) => {
        const {installedItem, pkgItem, pkgType} = context;
        if ((!installedItem && !pkgItem) || !pkgType) {
            return CONTINUE;
        }
        const item = installedItem || pkgItem;
        /// #if !BROWSER
        if (["icons", "themes"].includes(pkgType)) {
            useShell("openPath", path.join(window.siyuan.config.system.confDir, "appearance", pkgType, item.name));
        } else {
            useShell("openPath", path.join(window.siyuan.config.system.dataDir, pkgType, item.name));
        }
        /// #endif
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    "retry-update": ((context) => {
        context.controller._checkUpdate(true);
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    goBack: ((context) => {
        context.controller.element.querySelector("#configBazaarReadme").classList.remove("config__view--show");
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    install: ((context, target) => {
        const {controller, app, mount, availableItem, pkgItem, pkgType} = context;
        const installItem = availableItem || pkgItem;
        if (target.classList.contains("b3-button--progress") || target.hasAttribute("disabled") ||
            !installItem || !pkgType) {
            return HANDLED;
        }
        const themeAppearanceMode = pkgType === "themes" ? controller._resolveThemeAppearanceMode(installItem) : {};
        const request = controller._beginBazaarRequest(pkgType, mount);
        const config = BAZAAR_PACKAGE_CONFIG[pkgType];
        fetchPost(config.api.install, {
            keyword: (mount.element.querySelector(`.config-bazaar__panel[data-type="${config.tabType}"] .b3-text-field`) as HTMLInputElement).value,
            repoURL: installItem.repoURL,
            packageName: installItem.name,
            repoHash: installItem.repoHash,
            repoRef: installItem.repoRef || "",
            ...themeAppearanceMode,
            frontend: getFrontend()
        }, response => {
            controller._onBazaar(response, pkgType, request);
            if (response.code !== 0) {
                if (controller._isBazaarRequestCurrent(pkgType, request)) {
                    controller._refreshReadmeDetail(pkgType, installItem.name);
                }
                return;
            }
            if (controller._isMountCurrent(mount)) {
                controller._genMyHTML(pkgType, app, false);
                controller._refreshReadmeDetail(pkgType, installItem.name);
            }
            if (pkgType === "plugins") {
                if (window.siyuan.config.bazaar.petalDisabled) {
                    confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.enablePluginTip2);
                } else {
                    confirmDialog("💡 " + window.siyuan.languages.enablePlugin, window.siyuan.languages.enablePluginTip, () => {
                        controller._setPluginEnabled(app, installItem, true, () => {
                            if (controller._isMountCurrent(mount)) {
                                controller._genMyHTML(pkgType, app, false);
                                controller._refreshReadmeDetail(pkgType, installItem.name);
                            }
                        });
                    });
                }
            }
        });
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    "install-all": ((context) => {
        const {controller, mount} = context;
        confirmDialog("⬆️ " + window.siyuan.languages.updateAll, window.siyuan.languages.confirmUpdateAll, () => {
            fetchPost("/api/bazaar/batchUpdatePackage", {frontend: getFrontend()}, (response) => {
                if (response.code !== 0) {
                    showMessage(response.msg);
                    return;
                }
                if (controller._isMountCurrent(mount)) {
                    mount.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                    controller._checkUpdate(true);
                }
            });
        });
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    feedback: (() => HANDLED) satisfies TBazaarActionHandler,
    "install-t": ((context, target) => {
        const {controller, app, mount, updatedItem, pkgItem, pkgType} = context;
        const packageName = updatedItem?.installed.name || pkgItem?.name;
        if (!target.classList.contains("b3-button--progress") && !target.hasAttribute("disabled") &&
            packageName && pkgType) {
            confirmDialog("⬆️ " + window.siyuan.languages.update, window.siyuan.languages.confirmUpdate, () => {
                if (!target.classList.contains("b3-button")) {
                    target.parentElement.insertAdjacentHTML("afterend", '<img data-type="img-loading" style="position: absolute;top: 0;left: 0;height: 100%;width: 100%;padding: 16px;box-sizing: border-box;" src="/stage/loading-pure.svg">');
                }
                const request = controller._beginBazaarRequest(pkgType, mount);
                fetchPost("/api/bazaar/updateBazaarPackage", {
                    packageType: pkgType,
                    packageName,
                    frontend: getFrontend()
                }, response => {
                    if (response.code !== 0) {
                        showMessage(response.msg);
                        target.parentElement.parentElement.querySelector("img[data-type='img-loading']")?.remove();
                        return;
                    }
                    controller._onBazaar(response, pkgType, request);
                    if (controller._isMountCurrent(mount)) {
                        mount.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                        controller._genMyHTML(pkgType, app);
                        controller._checkUpdate(true);
                    }
                });
            });
        }
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    uninstall: ((context) => {
        const {controller, app, mount, installedItem, pkgType} = context;
        if (!installedItem || !pkgType) {
            return CONTINUE;
        }
        const uninstallName = installedItem.name;
        const config = BAZAAR_PACKAGE_CONFIG[pkgType];
        const keyword = (mount.element.querySelector(`.config-bazaar__panel[data-type="${config.tabType}"] .b3-text-field`) as HTMLInputElement).value;
        confirmDialog("⚠️ " + window.siyuan.languages.uninstall,
            window.siyuan.languages.confirmUninstall.replace("${name}", escapeHtml(uninstallName)), () => {
                const request = controller._beginBazaarRequest(pkgType, mount);
                fetchPost(config.api.uninstall, {
                    packageName: uninstallName,
                    keyword,
                    frontend: getFrontend()
                }, response => {
                    if (response.code !== 0) {
                        showMessage(response.msg);
                        return;
                    }
                    controller._data.details.delete(controller._getDetailKey(pkgType, uninstallName));
                    controller._onBazaar(response, pkgType, request);
                    if (controller._isMountCurrent(mount)) {
                        mount.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                        controller._genMyHTML(pkgType, app);
                        controller._checkUpdate(true);
                    }
                });
            });
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    switch: ((context, target) => {
        const {controller, app, mount, installedItem, pkgItem, pkgType} = context;
        if ((!installedItem && !pkgItem) || !pkgType || !["icons", "themes"].includes(pkgType)) {
            return CONTINUE;
        }
        if (!target.hasAttribute("disabled")) {
            const appearanceItem = installedItem || pkgItem;
            target.setAttribute("disabled", "disabled");
            controller._setAppearancePackage(pkgType as "themes" | "icons", appearanceItem, true, () => {
                if (controller._isMountCurrent(mount)) {
                    controller._refreshPackageUI(pkgType, appearanceItem.name, app);
                }
            });
        }
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    "package-enable": ((context, target) => handlePackageEnabled(context, target, true)) satisfies TBazaarActionHandler,
    "package-disable": ((context, target) => handlePackageEnabled(context, target, false)) satisfies TBazaarActionHandler,
    setting: ((context) => {
        const {app, pkgItem} = context;
        if (!pkgItem) {
            return CONTINUE;
        }
        if (!window.siyuan.config.bazaar.petalDisabled) {
            app.plugins.find((item: Plugin) => {
                if (item.name === pkgItem.name) {
                    item.openSetting();
                    return true;
                }
            });
        }
        return HANDLED;
    }) satisfies TBazaarActionHandler,
    "plugins-enable": ((context, target) => {
        const {controller, app} = context;
        if (!target.getAttribute("disabled")) {
            const requestID = ++controller._pluginGlobalRequestID;
            controller._pluginGlobalRequestPending = true;
            controller._syncPluginGlobalSwitch();
            void setGlobalPluginsDisabled(app, !(target as HTMLInputElement).checked).catch((error) => {
                console.error(error);
            }).finally(() => {
                if (requestID !== controller._pluginGlobalRequestID) {
                    return;
                }
                controller._pluginGlobalRequestPending = false;
                controller._syncPluginGlobalSwitch();
            });
        }
        return HANDLED_NATIVE;
    }) satisfies TBazaarActionHandler,
    "plugin-publish-enable-label": (() => HANDLED_NATIVE) satisfies TBazaarActionHandler,
    "plugin-publish-enable": ((context, target) => {
        const {controller, app, mount, installedItem} = context;
        if (!installedItem) {
            return CONTINUE;
        }
        if (!target.hasAttribute("disabled")) {
            target.setAttribute("disabled", "disabled");
            const enabled = (target as HTMLInputElement).checked;
            controller._setPluginPublishEnabled(installedItem, enabled, () => {
                if (controller._isMountCurrent(mount)) {
                    target.removeAttribute("disabled");
                    controller._genMyHTML("plugins", app, true);
                }
            });
        }
        return HANDLED_NATIVE;
    }) satisfies TBazaarActionHandler,
    "plugin-enable": ((context, target) => {
        const {controller, app, mount, installedItem, pkgItem} = context;
        if (!installedItem && !pkgItem) {
            return CONTINUE;
        }
        if (!target.hasAttribute("disabled")) {
            target.setAttribute("disabled", "disabled");
            const enabled = (target as HTMLInputElement).checked;
            const pluginItem = installedItem || pkgItem;
            controller._setPluginEnabled(app, pluginItem, enabled, () => {
                if (controller._isMountCurrent(mount)) {
                    target.removeAttribute("disabled");
                    controller._genMyHTML("plugins", app, true);
                }
            });
        }
        return HANDLED_NATIVE;
    }) satisfies TBazaarActionHandler,
} as const;

function handlePackageEnabled(context: IBazaarClickContext, target: HTMLElement, enabled: boolean) {
    const {controller, app, mount, installedItem, pkgItem, pkgType} = context;
    if ((!installedItem && !pkgItem) || !pkgType) {
        return CONTINUE;
    }
    if (target.hasAttribute("disabled")) {
        return HANDLED;
    }
    const actionItem = installedItem || pkgItem;
    target.setAttribute("disabled", "disabled");
    if (pkgType === "plugins" && installedItem) {
        controller._setPluginEnabled(app, installedItem, enabled, () => {
            if (controller._isMountCurrent(mount)) {
                controller._refreshPackageUI(pkgType, installedItem.name, app);
            }
        });
    } else if (["icons", "themes"].includes(pkgType)) {
        controller._setAppearancePackage(pkgType as "themes" | "icons", actionItem, enabled, () => {
            if (controller._isMountCurrent(mount)) {
                controller._refreshPackageUI(pkgType, actionItem.name, app);
            }
        });
    }
    return HANDLED;
}

const applyActionResult = (event: MouseEvent, result: IBazaarActionResult) => {
    if (result.preventDefault) {
        event.preventDefault();
    }
    if (result.stopPropagation) {
        event.stopPropagation();
    }
};

const resolveClickContext = (
    controller: TBazaarController,
    app: App,
    mount: IBazaarMountSnapshot,
    target: HTMLElement,
): IBazaarClickContext => {
    const packageElement = hasClosestByAttribute(target, "data-name", null);
    let pkgType: TBazaarType | undefined;
    let pkgItem: IBazaarItem | undefined;
    let updatedItem: IUpdatedBazaarItem | undefined;
    let packageSource: TBazaarPackageSource | undefined;
    let packageName: string | undefined;
    if (packageElement) {
        packageName = packageElement.getAttribute("data-name") || undefined;
        const packageType = packageElement.getAttribute("data-package-type");
        pkgType = isBazaarPackageType(packageType) ? packageType : undefined;
        packageSource = (packageElement.getAttribute("data-package-source") ||
            packageElement.getAttribute("data-from")) as TBazaarPackageSource;
        if (packageName && pkgType && packageSource === "downloaded") {
            pkgItem = controller._data.downloaded.find((item) => item.name === packageName);
        } else if (packageName && pkgType && packageSource === "updated") {
            updatedItem = controller._getUpdatedItem(pkgType, packageName);
            pkgItem = updatedItem?.available;
        } else if (packageName && pkgType && packageSource === "bazaar") {
            pkgItem = controller._data[pkgType]?.find((item) => item.name === packageName);
        }
    }
    const packageDetail = packageName && pkgType ? controller._getPackageDetail(pkgType, packageName) : undefined;
    return {
        controller,
        app,
        mount,
        packageSource,
        packageName,
        pkgType,
        pkgItem,
        updatedItem,
        installedItem: packageDetail?.installed || updatedItem?.installed ||
            (packageSource === "downloaded" ? pkgItem : undefined),
        availableItem: packageDetail?.available || updatedItem?.available ||
            (packageSource === "bazaar" ? pkgItem : undefined),
    };
};

const handleCardClick = (context: IBazaarClickContext, eventTarget: HTMLElement) => {
    const {controller, pkgItem, pkgType, packageSource} = context;
    if (!hasClosestByClassName(eventTarget, "b3-card__actions--right") && pkgItem && !pkgItem.invalidReason &&
        pkgType && packageSource) {
        controller._renderReadme(pkgType, packageSource, pkgItem);
    }
    return HANDLED;
};

const handleLayoutTabClick = (context: IBazaarClickContext, target: HTMLElement) => {
    const {controller} = context;
    const type = target.getAttribute("data-type");
    controller.element.querySelector(".layout-tab-bar .item--focus").classList.remove("item--focus");
    target.classList.add("item--focus");
    controller.element.querySelectorAll(".config-bazaar__panel").forEach((item) => {
        if (type === item.getAttribute("data-type")) {
            item.classList.remove("fn__none");
            if (type !== "downloaded") {
                const bazaarType = getBazaarTypeByTab(type);
                if (bazaarType) {
                    controller._initBazaarPanel(bazaarType, item as HTMLElement);
                }
            }
        } else {
            item.classList.add("fn__none");
        }
    });
    return HANDLED;
};

const handlePreviewClick = (target: HTMLElement) => {
    if (isMobile()) {
        const previewURL = target.dataset.previewUrl;
        if (previewURL) {
            previewImages([previewURL], previewURL);
        }
    } else {
        target.classList.toggle("item__preview--fullscreen");
    }
    return HANDLED;
};

const bindBazaarClickEvent = (
    controller: TBazaarController,
    app: App,
    mount: IBazaarMountSnapshot,
) => {
    controller.element.firstElementChild.addEventListener("click", (event: MouseEvent) => {
        if (syncRatingUser(controller)) {
            refreshVisibleRatingUI(controller);
        }
        const eventTarget = event.target as HTMLElement;
        const context = resolveClickContext(controller, app, mount, eventTarget);
        let target = eventTarget;
        while (target && !target.isEqualNode(controller.element)) {
            if (target.tagName === "A") {
                return;
            }
            const downloadedTabResult = handleDownloadedTab(context, target);
            if (downloadedTabResult.handled) {
                applyActionResult(event, downloadedTabResult);
                return;
            }
            const type = target.getAttribute("data-type");
            const handler = type && Object.prototype.hasOwnProperty.call(ACTION_HANDLERS, type) ?
                ACTION_HANDLERS[type as keyof typeof ACTION_HANDLERS] : undefined;
            const result = handler?.(context, target);
            if (result?.handled) {
                applyActionResult(event, result);
                return;
            }
            let fallbackResult: IBazaarActionResult | undefined;
            if (target.classList.contains("b3-card")) {
                fallbackResult = handleCardClick(context, eventTarget);
            } else if (target.classList.contains("item") && !target.classList.contains("item--focus")) {
                fallbackResult = handleLayoutTabClick(context, target);
            } else if (target.classList.contains("item__preview")) {
                fallbackResult = handlePreviewClick(target);
            }
            if (fallbackResult?.handled) {
                applyActionResult(event, fallbackResult);
                return;
            }
            target = target.parentElement;
        }
    });
};

const bindBazaarSearchEvents = (
    controller: TBazaarController,
    app: App,
    mount: IBazaarMountSnapshot,
) => {
    controller.element.querySelectorAll(".config-bazaar__panel .b3-text-field")
        .forEach((inputElement: HTMLInputElement) => {
            inputElement.addEventListener("keydown", (event) => {
                if (event.isComposing || event.key !== "Enter") {
                    return;
                }
                const keyword = inputElement.value.trim();
                const type = (hasClosestByClassName(inputElement, "config-bazaar__panel") as HTMLElement)
                    .getAttribute("data-type");
                const bazaarType = getBazaarTypeByTab(type);
                if (bazaarType) {
                    const config = BAZAAR_PACKAGE_CONFIG[bazaarType];
                    const request = controller._beginBazaarRequest(bazaarType, mount);
                    fetchPost(config.api.bazaar, {
                        ...(config.bazaarRequestUsesFrontend ? {frontend: getFrontend()} : {}),
                        keyword,
                    }, response => {
                        controller._onBazaar(response, bazaarType, request);
                    });
                } else if (type === "downloaded") {
                    const activeType = inputElement.closest(".config-bazaar__title")
                        ?.querySelector('.b3-button[data-type^="my"]:not(.b3-button--outline)')
                        ?.getAttribute("data-type");
                    const selectedType = getBazaarTypeByMyType(activeType);
                    if (selectedType) {
                        controller._genMyHTML(selectedType, app);
                    }
                }
                event.preventDefault();
            });
        });
};

const bindBazaarSelectEvents = (controller: TBazaarController) => {
    controller.element.querySelectorAll(".b3-select").forEach((selectElement: HTMLSelectElement) => {
        selectElement.addEventListener("change", () => {
            if (selectElement.getAttribute("data-type") === "downloaded-sort") {
                const activeBtn = controller.element.querySelector("#configBazaarDownloaded")?.previousElementSibling
                    ?.querySelector('.b3-button[data-type^="my"]:not(.b3-button--outline)') as HTMLElement;
                if (activeBtn?.getAttribute("data-type") === "myUpdate") {
                    return;
                }
                const bazaarType = getBazaarTypeByMyType(activeBtn?.getAttribute("data-type"));
                if (!bazaarType) {
                    return;
                }
                window.siyuan.storage[Constants.LOCAL_BAZAAR][BAZAAR_PACKAGE_CONFIG[bazaarType].downloadedSortKey] =
                    selectElement.value;
                setStorageVal(Constants.LOCAL_BAZAAR, window.siyuan.storage[Constants.LOCAL_BAZAAR]);
                controller._reorderDownloadedCards(controller._sortDownloadedPackages(
                    controller._data.downloadedDefault, selectElement.value));
            } else if (selectElement.id === "bazaarSelect") {
                controller._renderBazaarCards(
                    controller.element.querySelector("#configBazaarTheme"),
                    controller._data.themes,
                    "themes",
                    selectElement.value
                );
            } else {
                const panelElement = selectElement.parentElement.parentElement;
                const panelType = panelElement.getAttribute("data-type");
                const bazaarType = getBazaarTypeByTab(panelType);
                if (!bazaarType) {
                    return;
                }
                controller._renderBazaarCards(
                    panelElement.querySelector(".config-bazaar__content"),
                    sortBazaarPackages(controller._data[bazaarType], selectElement.value),
                    bazaarType,
                    bazaarType === "themes" ?
                        (controller.element.querySelector("#bazaarSelect") as HTMLSelectElement).value : undefined
                );
                window.siyuan.storage[Constants.LOCAL_BAZAAR][BAZAAR_PACKAGE_CONFIG[bazaarType].tabType] =
                    selectElement.value;
                setStorageVal(Constants.LOCAL_BAZAAR, window.siyuan.storage[Constants.LOCAL_BAZAAR]);
            }
        });
    });
};

export const bindBazaarEvents = (
    controller: TBazaarController,
    app: App,
    mount: IBazaarMountSnapshot,
) => {
    bindBazaarClickEvent(controller, app, mount);
    bindBazaarSearchEvents(controller, app, mount);
    bindBazaarSelectEvents(controller);
};
