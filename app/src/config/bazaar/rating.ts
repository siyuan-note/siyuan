import {showMessage} from "../../dialog/message";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {isMobile} from "../../util/functions";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {
    applyBazaarPackageRatingToItem,
    beginBazaarRatingRequest,
    beginBazaarRatingSubmission,
    getBazaarRatingErrorLanguageKey,
    getBazaarRatingMutationVersion,
    getDisplayableBazaarRating,
    isBazaarPackageRatingLoaded,
    isBazaarRatingRemovalAvailable,
    isBazaarRatingMutationVersionCurrent,
    isLatestBazaarRatingRequest,
    normalizeBazaarPackageRatingResponse,
    normalizeBazaarPackageRatingsResponse,
    normalizeBazaarPackageUserRatingsResponse,
    normalizeBazaarUserRating,
    sortBazaarPackages,
} from "../../util/bazaarPackage";
import {Dialog} from "../../dialog";
import {BAZAAR_PACKAGE_CONFIG, BAZAAR_PACKAGE_TYPES, isBazaarPackageType} from "./packageConfig";

type TBazaarController = typeof import("../bazaar").bazaar;

export const getRatingKey = (bazaarType: TBazaarType, packageName: string) => {
    return `${bazaarType}:${packageName}`;
};

export const syncRatingUser = (controller: TBazaarController) => {
    const userID = window.siyuan.user ? `${window.siyuan.config.cloudRegion}:${window.siyuan.user.userId}` : "";
    if (controller._ratingUserID !== userID) {
        controller._ratingUserID = userID;
        controller._data.userRatings.clear();
        controller._data.userRatingKeys.clear();
        controller._data.userRatingLoadingKeys.clear();
        controller._data.userRatingSubmitRequestIDs.clear();
        controller._data.userRatingBatchRequestIDs.clear();
        return true;
    }
    return false;
};

export const refreshVisibleRatingUI = (controller: TBazaarController) => {
    const keys = new Set<string>();
    controller.element?.querySelectorAll<HTMLElement>("[data-package-type][data-name]").forEach((element) => {
        const bazaarType = element.dataset.packageType;
        const packageName = element.dataset.name;
        if (isBazaarPackageType(bazaarType) && packageName) {
            keys.add(getRatingKey(bazaarType, packageName));
        }
    });
    keys.forEach((key) => {
        const separator = key.indexOf(":");
        refreshRatingUI(controller, key.slice(0, separator) as TBazaarType, key.slice(separator + 1));
    });
    const sideElement = controller.element?.querySelector("#configBazaarReadme.config__view--show .item__side");
    const bazaarType = sideElement?.getAttribute("data-package-type") as TBazaarType;
    const packageName = sideElement?.getAttribute("data-name");
    const from = sideElement?.getAttribute("data-from") as "downloaded" | "updated" | "bazaar";
    if (bazaarType && packageName && from) {
        loadReadmeRating(controller, bazaarType, packageName, from);
    }
    if (window.siyuan.user) {
        if (controller._isUpdatePanelActive()) {
            loadUpdatedRatings(controller);
        } else if (controller._data.downloadedType) {
            loadDownloadedUserRatings(controller, controller._data.downloadedType, controller._data.downloadedDefault);
        }
    }
};

export const bindRatingUserChange = (controller: TBazaarController) => {
    if (controller._ratingUserChangeHandler) {
        window.removeEventListener("siyuan-login-success", controller._ratingUserChangeHandler);
    }
    const mount = controller._captureMount();
    controller._ratingUserChangeHandler = () => {
        if (!controller._isMountCurrent(mount)) {
            return;
        }
        syncRatingUser(controller);
        refreshVisibleRatingUI(controller);
    };
    window.addEventListener("siyuan-login-success", controller._ratingUserChangeHandler);
};

export const getRatingSummaryText = (rating?: IBazaarRating) => {
    const normalized = getDisplayableBazaarRating(rating);
    if (!normalized) {
        return window.siyuan.languages.bazaarNoRatings;
    }
    return window.siyuan.languages.bazaarRatingSummary
        .replace("${average}", normalized.average.toLocaleString(undefined, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
        }))
        .replace("${count}", normalized.count.toLocaleString());
};

export const genRatingStarsHTML = (value: number) => {
    const activePercentage = Math.max(0, Math.min(100, value / 5 * 100));
    const inactiveStars = Array.from({length: 5}, () => '<svg class="config-bazaar__rating-star config-bazaar__rating-star--outline"><use xlink:href="#iconStar"></use></svg>').join("");
    const activeStars = Array.from({length: 5}, () => '<svg class="config-bazaar__rating-star"><use xlink:href="#iconStar"></use></svg>').join("");
    return `<span class="config-bazaar__rating-stars" aria-hidden="true">
${inactiveStars}
<span class="config-bazaar__rating-stars--active" style="width: ${activePercentage}%">${activeStars}</span>
</span>`;
};

export const genCardRatingHTML = (item: Pick<IBazaarItem, "rating">, loaded = true) => {
    const rating = getDisplayableBazaarRating(item.rating);
    const hidden = !loaded || !rating;
    const summary = getRatingSummaryText(rating);
    const average = rating?.average.toLocaleString(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });
    return `<span data-rating-card-slot data-position="north" class="ariaLabel block__icon block__icon--show block__icon--text${hidden ? " fn__none" : ""}" aria-label="${escapeAttr(summary)}">
<svg aria-hidden="true"><use xlink:href="#iconStar"></use></svg>
<span class="fn__space--small"></span>
<span>${escapeHtml(average || "")}</span>
</span>`;
};

export const genRatePackageActionHTML = (loaded: boolean, rating?: unknown) => {
    const userRating = normalizeBazaarUserRating(rating);
    const rated = userRating !== undefined && userRating > 0;
    const ariaLabel = rated ? window.siyuan.languages.bazaarYourRatingValue.replace("${rating}", userRating.toString()) :
        window.siyuan.languages.bazaarRatePackage;
    return `<span data-rating-card-slot data-position="north" data-type="rate-package"${rated ? ` data-user-rating="${userRating}"` : ""} class="ariaLabel block__icon block__icon--show${loaded ? "" : " fn__none"}" aria-label="${escapeAttr(ariaLabel)}">
<svg aria-hidden="true"><use xlink:href="#iconStar"></use></svg>
</span>`;
};

export const genRatingDistributionHTML = (rating?: IBazaarRating) => {
    const normalized = getDisplayableBazaarRating(rating);
    return [5, 4, 3, 2, 1].map((star) => {
        const count = normalized?.distribution[star - 1] || 0;
        const ratio = normalized ? Math.min(1, count / normalized.count) : 0;
        const percentage = ratio * 100;
        const percentageText = new Intl.NumberFormat(undefined, {
            style: "percent",
            maximumFractionDigits: 0,
        }).format(ratio);
        const label = window.siyuan.languages.bazaarRatingDistributionLabel
            .replace("${star}", star.toString())
            .replace("${count}", count.toLocaleString());
        return `<div class="config-bazaar__rating-row" aria-label="${escapeAttr(`${label} ${percentageText}`)}">
<span>${star}</span>
<svg class="config-bazaar__rating-star" aria-hidden="true"><use xlink:href="#iconStar"></use></svg>
<span class="config-bazaar__rating-track" aria-hidden="true"><span style="width: ${percentage}%"></span></span>
<span>${escapeHtml(percentageText)}</span>
<span>${count.toLocaleString()}</span>
</div>`;
    }).join("");
};

export const genReadmeRatingHTML = (controller: TBazaarController, bazaarType: TBazaarType, item: IBazaarItem, loaded: boolean) => {
    if (!loaded) {
        return "";
    }
    syncRatingUser(controller);
    const rating = getDisplayableBazaarRating(item.rating);
    const userRating = controller._data.userRatings.get(getRatingKey(bazaarType, item.name)) || 0;
    let action = "";
    if (item.installed) {
        if (window.siyuan.user) {
            const actionText = userRating ? window.siyuan.languages.bazaarYourRatingValue.replace("${rating}", userRating.toString()) :
                window.siyuan.languages.bazaarRatePackage;
            action = `<button type="button" class="config-bazaar__rating-action" data-type="rate-package" aria-label="${escapeAttr(actionText)}">
${genRatingStarsHTML(userRating)}
<span>${escapeHtml(actionText)}</span>
</button>`;
        } else {
            action = `<div class="config-bazaar__rating-tip">${window.siyuan.languages.bazaarRatingLoginTip}</div>`;
        }
    } else {
        action = `<div class="config-bazaar__rating-tip">${window.siyuan.languages.bazaarRatingInstallTip}</div>`;
    }
    const summary = rating ? getRatingSummaryText(rating) : "";
    const aggregate = rating ? `<div class="config-bazaar__rating-summary" aria-label="${escapeAttr(summary)}">
    ${genRatingStarsHTML(rating.average)}
    <span>${escapeHtml(summary)}</span>
</div>
<div class="config-bazaar__rating-distribution">${genRatingDistributionHTML(rating)}</div>` : "";
    return `<section class="item__meta-section config-bazaar__rating-detail">
<div class="item__meta-title">${window.siyuan.languages.bazaarRating}</div>
${aggregate}
${action}
</section>`;
};

export const applyPackageRating = (controller: TBazaarController, bazaarType: TBazaarType, packageName: string, rating?: IBazaarRating, refreshUI = true) => {
    const key = getRatingKey(bazaarType, packageName);
    if (rating) {
        controller._data.ratings.set(key, rating);
    } else {
        controller._data.ratings.delete(key);
    }
    const updateItem = (item?: IBazaarItem) => {
        applyBazaarPackageRatingToItem(item, packageName, rating);
    };
    controller._data[bazaarType].forEach(updateItem);
    if (controller._data.downloadedType === bazaarType) {
        controller._data.downloadedDefault.forEach(updateItem);
        controller._data.downloaded.forEach(updateItem);
    }
    controller._data.update[bazaarType].forEach((item) => {
        updateItem(item.installed);
        updateItem(item.available);
    });
    const detail = controller._getPackageDetail(bazaarType, packageName);
    updateItem(detail?.installed);
    updateItem(detail?.available);
    if (refreshUI) {
        refreshRatingUI(controller, bazaarType, packageName);
    }
};

export const applyPackageRatingResponse = (controller: TBazaarController, bazaarType: TBazaarType, packageName: string, data: {
        ratingAvailable?: unknown;
        rating?: Partial<IBazaarRating> | null;
    }, refreshUI = true) => {
    const key = getRatingKey(bazaarType, packageName);
    const publicRating = normalizeBazaarPackageRatingResponse(data);
    if (publicRating.loaded) {
        controller._data.downloadedRatingKeys.add(key);
        applyPackageRating(controller, bazaarType, packageName, publicRating.rating, refreshUI);
    } else {
        controller._data.downloadedRatingKeys.delete(key);
        if (refreshUI) {
            refreshRatingUI(controller, bazaarType, packageName);
        }
    }
    return publicRating.loaded;
};

export const getRatingItem = (controller: TBazaarController, bazaarType: TBazaarType, packageName: string, from: "downloaded" | "updated" | "bazaar") => {
    const detail = controller._getPackageDetail(bazaarType, packageName);
    if (from === "downloaded") {
        return detail?.installed || (controller._data.downloadedType === bazaarType ?
            controller._data.downloaded.find((item) => item.name === packageName) : undefined);
    }
    if (from === "updated") {
        return detail?.available || controller._getUpdatedItem(bazaarType, packageName)?.available;
    }
    return detail?.available || controller._data[bazaarType].find((item) => item.name === packageName);
};

export const refreshRatingUI = (controller: TBazaarController, bazaarType: TBazaarType, packageName: string) => {
    syncRatingUser(controller);
    controller.element?.querySelectorAll(`.b3-card[data-package-type="${bazaarType}"]`).forEach((card) => {
        if (card.getAttribute("data-name") !== packageName) {
            return;
        }
        const source = card.getAttribute("data-package-source") as "downloaded" | "updated" | "bazaar";
        const item = getRatingItem(controller, bazaarType, packageName, source);
        const slot = card.querySelector<HTMLElement>("[data-rating-card-slot]");
        if (item && slot) {
            const key = getRatingKey(bazaarType, packageName);
            const loaded = isBazaarPackageRatingLoaded(source, controller._data.downloadedRatingKeys.has(key),
                item.ratingAvailable);
            if (source === "bazaar") {
                const rating = loaded ? getDisplayableBazaarRating(item.rating) : undefined;
                slot.classList.toggle("fn__none", !rating);
                if (rating) {
                    slot.setAttribute("aria-label", getRatingSummaryText(rating));
                    const averageElement = slot.lastElementChild;
                    if (averageElement) {
                        averageElement.textContent = rating.average.toLocaleString(undefined, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                        });
                    }
                }
            } else {
                slot.classList.toggle("fn__none", !loaded);
                const userRating = controller._data.userRatingKeys.has(key) ?
                    normalizeBazaarUserRating(controller._data.userRatings.get(key)) : undefined;
                if (userRating !== undefined && userRating > 0) {
                    slot.dataset.userRating = userRating.toString();
                    slot.setAttribute("aria-label", window.siyuan.languages.bazaarYourRatingValue
                        .replace("${rating}", userRating.toString()));
                } else {
                    slot.removeAttribute("data-user-rating");
                    slot.setAttribute("aria-label", window.siyuan.languages.bazaarRatePackage);
                }
            }
        }
    });
    const sideElement = controller.element?.querySelector("#configBazaarReadme.config__view--show .item__side");
    if (sideElement?.getAttribute("data-package-type") !== bazaarType ||
        sideElement.getAttribute("data-name") !== packageName) {
        return;
    }
    const from = sideElement.getAttribute("data-from") as "downloaded" | "updated" | "bazaar";
    const item = getRatingItem(controller, bazaarType, packageName, from);
    const slot = sideElement.querySelector('[data-type="rating-detail-slot"]');
    if (item && slot) {
        const key = getRatingKey(bazaarType, packageName);
        const loaded = isBazaarPackageRatingLoaded(from, controller._data.downloadedRatingKeys.has(key),
            item.ratingAvailable);
        const displayItem = from === "bazaar" ? item : {...item, rating: controller._data.ratings.get(key)};
        slot.innerHTML = genReadmeRatingHTML(controller, bazaarType, displayItem, loaded);
    }
};

export const loadDownloadedRatings = (controller: TBazaarController, bazaarType: TBazaarType, packages: IBazaarItem[]) => {
    const packageNames = packages.filter((item) => !item.invalidReason).map((item) => item.name);
    if (packageNames.length === 0) {
        return;
    }
    const requestID = (controller._data.ratingBatchRequestIDs.get(bazaarType) || 0) + 1;
    controller._data.ratingBatchRequestIDs.set(bazaarType, requestID);
    const mutationVersions = new Map(packageNames.map((packageName) => {
        const key = getRatingKey(bazaarType, packageName);
        return [packageName, getBazaarRatingMutationVersion(controller._data.ratingMutationVersions, key)];
    }));
    const mount = controller._captureMount();
    fetchPost("/api/bazaar/getBazaarPackageRatings", {
        packageType: bazaarType,
        packageNames,
    }, response => {
        if (response.code !== 0 || controller._data.ratingBatchRequestIDs.get(bazaarType) !== requestID ||
            !controller._isMountCurrent(mount) || !controller.element?.isConnected) {
            return;
        }
        const ratings = normalizeBazaarPackageRatingsResponse(packageNames, response.data);
        if (!ratings) {
            return;
        }
        ratings.forEach((ratingResponse, packageName) => {
            const key = getRatingKey(bazaarType, packageName);
            if (isBazaarRatingMutationVersionCurrent(controller._data.ratingMutationVersions, key,
                mutationVersions.get(packageName) || 0)) {
                applyPackageRatingResponse(controller, bazaarType, packageName, ratingResponse);
            }
        });
    });
};

export const loadDownloadedUserRatings = (controller: TBazaarController, bazaarType: TBazaarType, packages: IBazaarItem[]) => {
    syncRatingUser(controller);
    if (!window.siyuan.user) {
        return;
    }
    const requestedUserID = controller._ratingUserID;
    const packageNames = Array.from(new Set(packages.filter((item) => !item.invalidReason).map((item) => item.name)))
        .filter((packageName) => {
            const key = getRatingKey(bazaarType, packageName);
            return !controller._data.userRatingKeys.has(key) &&
                !controller._data.userRatingLoadingKeys.has(`${requestedUserID}|${key}`);
        });
    if (packageNames.length === 0) {
        return;
    }
    const requestKey = `${requestedUserID}|${bazaarType}|${JSON.stringify(packageNames)}`;
    const requestID = (controller._data.userRatingBatchRequestIDs.get(requestKey) || 0) + 1;
    controller._data.userRatingBatchRequestIDs.set(requestKey, requestID);
    const loadingKeys = packageNames.map((packageName) => {
        const loadingKey = `${requestedUserID}|${getRatingKey(bazaarType, packageName)}`;
        controller._data.userRatingLoadingKeys.add(loadingKey);
        return loadingKey;
    });
    const mutationVersions = new Map(packageNames.map((packageName) => {
        const key = getRatingKey(bazaarType, packageName);
        return [packageName, getBazaarRatingMutationVersion(controller._data.ratingMutationVersions, key)];
    }));
    const mount = controller._captureMount();
    fetchPost("/api/bazaar/getBazaarPackageUserRatings", {
        packageType: bazaarType,
        packageNames,
    }, response => {
        syncRatingUser(controller);
        if (response.code !== 0 || requestedUserID !== controller._ratingUserID ||
            controller._data.userRatingBatchRequestIDs.get(requestKey) !== requestID ||
            !controller._isMountCurrent(mount) || !controller.element?.isConnected) {
            return;
        }
        const userRatings = normalizeBazaarPackageUserRatingsResponse(packageNames, response.data);
        if (!userRatings) {
            return;
        }
        userRatings.forEach((userRating, packageName) => {
            const key = getRatingKey(bazaarType, packageName);
            if (isBazaarRatingMutationVersionCurrent(controller._data.ratingMutationVersions, key,
                mutationVersions.get(packageName) || 0)) {
                controller._data.userRatings.set(key, userRating);
                controller._data.userRatingKeys.add(key);
                refreshRatingUI(controller, bazaarType, packageName);
            }
        });
    }).finally(() => {
        loadingKeys.forEach((loadingKey) => controller._data.userRatingLoadingKeys.delete(loadingKey));
        if (controller._data.userRatingBatchRequestIDs.get(requestKey) === requestID) {
            controller._data.userRatingBatchRequestIDs.delete(requestKey);
        }
    });
};

export const loadUpdatedRatings = (controller: TBazaarController) => {
    BAZAAR_PACKAGE_TYPES.forEach((bazaarType) => {
        const items = controller._data.update[bazaarType];
        const installed = items.map((item) => item.installed);
        if (items.length && !items.every((item) => controller._data.downloadedRatingKeys.has(
            getRatingKey(bazaarType, item.installed.name)))) {
            loadDownloadedRatings(controller, bazaarType, installed);
        }
        if (items.length && window.siyuan.user) {
            loadDownloadedUserRatings(controller, bazaarType, installed);
        }
    });
};

export const fetchPackageRating = (controller: TBazaarController, bazaarType: TBazaarType, packageName: string, callback?: () => void, silent = true) => {
    syncRatingUser(controller);
    const requestedUserID = controller._ratingUserID;
    const key = getRatingKey(bazaarType, packageName);
    const loadingKey = `${requestedUserID}|${key}`;
    controller._data.userRatingLoadingKeys.add(loadingKey);
    const mount = controller._captureMount();
    let handled = false;
    fetchPost("/api/bazaar/getBazaarPackageRating", {
        packageType: bazaarType,
        packageName,
    }, response => {
        handled = true;
        syncRatingUser(controller);
        if (requestedUserID !== controller._ratingUserID || !controller._isMountCurrent(mount)) {
            return;
        }
        if (response.code !== 0 || !response.data) {
            if (!silent) {
                const languageKey = getBazaarRatingErrorLanguageKey(response.data);
                showMessage(languageKey ? window.siyuan.languages[languageKey] :
                    response.msg || window.siyuan.languages.bazaarRatingFailed);
            }
            return;
        }
        const userRating = response.data.userRating;
        controller._data.userRatings.set(key, normalizeBazaarUserRating(userRating) || 0);
        controller._data.userRatingKeys.add(key);
        if (!applyPackageRatingResponse(controller, bazaarType, packageName, response.data)) {
            if (!silent) {
                showMessage(window.siyuan.languages.bazaarRatingFailed);
            }
            return;
        }
        callback?.();
    }).finally(() => {
        controller._data.userRatingLoadingKeys.delete(loadingKey);
        if (!handled && !silent && requestedUserID === controller._ratingUserID) {
            showMessage(window.siyuan.languages.bazaarRatingFailed);
        }
    });
};

export const loadReadmeRating = (controller: TBazaarController, bazaarType: TBazaarType, packageName: string, from: "downloaded" | "updated" | "bazaar") => {
    syncRatingUser(controller);
    const key = getRatingKey(bazaarType, packageName);
    const loadingKey = `${controller._ratingUserID}|${key}`;
    if (getRatingItem(controller, bazaarType, packageName, from)?.installed && window.siyuan.user &&
        !controller._data.userRatingKeys.has(key) &&
        !controller._data.userRatingLoadingKeys.has(loadingKey)) {
        fetchPackageRating(controller, bazaarType, packageName);
    }
};

export const submitPackageRating = (controller: TBazaarController, bazaarType: TBazaarType, packageName: string, rating: number, callback: (success: boolean) => void) => {
    syncRatingUser(controller);
    const mount = controller._captureMount();
    const removing = rating === 0;
    const failureMessage = removing ? window.siyuan.languages.bazaarRemoveRatingFailed :
        window.siyuan.languages.bazaarRatingFailed;
    if (normalizeBazaarUserRating(rating) === undefined) {
        showMessage(failureMessage);
        callback(false);
        return;
    }
    const requestedUserID = controller._ratingUserID;
    const key = getRatingKey(bazaarType, packageName);
    const requestKey = `${requestedUserID}|${key}`;
    if (!beginBazaarRatingSubmission(controller._data.userRatingSubmittingKeys, requestKey)) {
        showMessage(window.siyuan.languages.loading);
        callback(false);
        return;
    }
    const requestID = beginBazaarRatingRequest(controller._data.userRatingSubmitRequestIDs, requestKey);
    let handled = false;
    let settled = false;
    const isLatestRequest = () => requestedUserID === controller._ratingUserID &&
        isLatestBazaarRatingRequest(controller._data.userRatingSubmitRequestIDs, requestKey, requestID);
    const settle = (success: boolean) => {
        if (!settled) {
            settled = true;
            callback(success);
        }
    };
    fetchPost("/api/bazaar/setBazaarPackageRating", {
        packageType: bazaarType,
        packageName,
        rating,
    }, response => {
        handled = true;
        syncRatingUser(controller);
        if (!isLatestRequest()) {
            settle(false);
            return;
        }
        if (response.code !== 0 || !response.data) {
            const languageKey = getBazaarRatingErrorLanguageKey(response.data);
            showMessage(languageKey ? window.siyuan.languages[languageKey] :
                response.msg || failureMessage);
            settle(false);
            return;
        }
        const userRating = response.data.userRating;
        controller._data.userRatings.set(key, normalizeBazaarUserRating(userRating) ?? rating);
        controller._data.userRatingKeys.add(key);
        beginBazaarRatingRequest(controller._data.ratingMutationVersions, key);
        const refreshUI = controller._isMountCurrent(mount);
        applyPackageRatingResponse(controller, bazaarType, packageName, response.data, refreshUI);
        const sortValue = window.siyuan.storage[Constants.LOCAL_BAZAAR][BAZAAR_PACKAGE_CONFIG[bazaarType].tabType];
        if (refreshUI && ["4", "5"].includes(sortValue)) {
            controller._renderBazaarCards(
                controller.element.querySelector(`#${BAZAAR_PACKAGE_CONFIG[bazaarType].panelID}`),
                sortBazaarPackages(controller._data[bazaarType], sortValue),
                bazaarType,
                bazaarType === "themes" ? (controller.element.querySelector("#bazaarSelect") as HTMLSelectElement)?.value : undefined,
            );
        }
        showMessage(removing ? window.siyuan.languages.bazaarRatingRemoved :
            window.siyuan.languages.bazaarRatingSubmitted);
        settle(true);
    }).finally(() => {
        controller._data.userRatingSubmittingKeys.delete(requestKey);
        if (settled) {
            return;
        }
        syncRatingUser(controller);
        if (!handled && isLatestRequest()) {
            showMessage(failureMessage);
        }
        settle(false);
    });
};

export const openRatingDialog = (controller: TBazaarController, bazaarType: TBazaarType, packageName: string) => {
    syncRatingUser(controller);
    if (!window.siyuan.user) {
        showMessage(window.siyuan.languages.bazaarRatingLoginTip);
        return;
    }
    const key = getRatingKey(bazaarType, packageName);
    const submitKey = `${controller._ratingUserID}|${key}`;
    if (controller._data.userRatingSubmittingKeys.has(submitKey)) {
        showMessage(window.siyuan.languages.loading);
        return;
    }
    if (!controller._data.userRatingKeys.has(key)) {
        const loadingKey = `${controller._ratingUserID}|${key}`;
        if (controller._data.userRatingLoadingKeys.has(loadingKey)) {
            showMessage(window.siyuan.languages.loading);
            return;
        }
        fetchPackageRating(controller, bazaarType, packageName, () => {
            openRatingDialog(controller, bazaarType, packageName);
        }, false);
        return;
    }
    const previousActiveElement = document.activeElement as HTMLElement;
    let selectedRating = controller._data.userRatings.get(key) || 0;
    const canRemoveRating = isBazaarRatingRemovalAvailable(selectedRating);
    const buttons = [1, 2, 3, 4, 5].map((rating) => {
        const label = window.siyuan.languages.bazaarRatingStarLabel.replace("${star}", rating.toString());
        return `<button type="button" role="radio" data-rating-value="${rating}" aria-checked="${selectedRating === rating}" aria-label="${escapeAttr(label)}" tabindex="${selectedRating === rating || (!selectedRating && rating === 1) ? "0" : "-1"}">
<svg class="config-bazaar__rating-star config-bazaar__rating-star--outline" aria-hidden="true"><use xlink:href="#iconStar"></use></svg>
</button>`;
    }).join("");
    const dialog = new Dialog({
        title: window.siyuan.languages.bazaarRatePackage,
        content: `<div class="b3-dialog__content">
<div class="config-bazaar__rating-picker" role="radiogroup" aria-label="${escapeAttr(window.siyuan.languages.bazaarYourRating)}">${buttons}</div>
</div>
<div class="b3-dialog__action">
${canRemoveRating ? `<button type="button" class="b3-button b3-button--remove" data-type="rating-remove">${window.siyuan.languages.bazaarRemoveRating}</button><div class="fn__space"></div>` : ""}
<button type="button" class="b3-button b3-button--cancel" data-type="rating-cancel">${window.siyuan.languages.cancel}</button>
<div class="fn__space"></div>
<button type="button" class="b3-button b3-button--text" data-type="rating-confirm"${selectedRating ? "" : " disabled"}>${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "360px",
        destroyCallback: () => {
            if (previousActiveElement?.isConnected) {
                previousActiveElement.focus({preventScroll: true});
            }
        },
    });
    const picker = dialog.element.querySelector(".config-bazaar__rating-picker") as HTMLElement;
    const cancelButton = dialog.element.querySelector('[data-type="rating-cancel"]') as HTMLButtonElement;
    const confirmButton = dialog.element.querySelector('[data-type="rating-confirm"]') as HTMLButtonElement;
    const removeButton = dialog.element.querySelector('[data-type="rating-remove"]') as HTMLButtonElement | null;
    let submitting = false;
    const setSubmitting = (value: boolean) => {
        submitting = value;
        picker.querySelectorAll<HTMLButtonElement>("[data-rating-value]").forEach((button) => {
            button.disabled = value;
        });
        if (removeButton) {
            removeButton.disabled = value;
        }
        cancelButton.disabled = value;
        confirmButton.disabled = value || !selectedRating;
    };
    const highlightRating = (rating: number) => {
        picker.querySelectorAll<HTMLButtonElement>("[data-rating-value]").forEach((button) => {
            button.classList.toggle("config-bazaar__rating-picker--active", Number(button.dataset.ratingValue) <= rating);
        });
    };
    const selectRating = (rating: number, focus = false) => {
        if (submitting) {
            return;
        }
        selectedRating = rating;
        highlightRating(rating);
        picker.querySelectorAll<HTMLButtonElement>("[data-rating-value]").forEach((button) => {
            const value = Number(button.dataset.ratingValue);
            button.setAttribute("aria-checked", (value === rating).toString());
            button.tabIndex = value === rating ? 0 : -1;
            if (focus && value === rating) {
                button.focus();
            }
        });
        confirmButton.disabled = false;
    };
    if (selectedRating) {
        selectRating(selectedRating);
    }
    picker.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rating-value]");
        if (button) {
            selectRating(Number(button.dataset.ratingValue));
        }
    });
    picker.addEventListener("mouseover", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rating-value]");
        if (button) {
            highlightRating(Number(button.dataset.ratingValue));
        }
    });
    picker.addEventListener("mouseleave", () => highlightRating(selectedRating));
    picker.addEventListener("keydown", (event: KeyboardEvent) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            return;
        }
        let next = selectedRating || Number((event.target as HTMLElement).closest<HTMLElement>("[data-rating-value]")?.dataset.ratingValue) || 1;
        if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
            next = next === 1 ? 5 : next - 1;
        } else if (["ArrowRight", "ArrowDown"].includes(event.key)) {
            next = next === 5 ? 1 : next + 1;
        } else {
            next = event.key === "Home" ? 1 : 5;
        }
        selectRating(next, true);
        event.preventDefault();
    });
    cancelButton.addEventListener("click", () => {
        if (!submitting) {
            dialog.destroy();
        }
    });
    removeButton?.addEventListener("click", () => {
        if (submitting) {
            return;
        }
        setSubmitting(true);
        submitPackageRating(controller, bazaarType, packageName, 0, (success) => {
            if (success) {
                dialog.destroy();
            } else {
                setSubmitting(false);
            }
        });
    });
    confirmButton.addEventListener("click", () => {
        if (!selectedRating || submitting) {
            return;
        }
        setSubmitting(true);
        submitPackageRating(controller, bazaarType, packageName, selectedRating, (success) => {
            if (success) {
                dialog.destroy();
            } else {
                setSubmitting(false);
            }
        });
    });
    (picker.querySelector('[tabindex="0"]') as HTMLButtonElement)?.focus({preventScroll: true});
};
