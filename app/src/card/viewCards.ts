import {mobileConfirmDialog} from "../dialog/mobileConfirmDialog";
import {MobileDialog} from "../dialog/mobileDialog";
import {createMobileSecondaryEditorCloseGuard, registerMobileSecondaryEditor} from "../mobile/util/secondaryEditors";
import dayjs from "dayjs";
import {Protyle} from "../protyle";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {escapeAttr, escapeHtml} from "../util/escape";
import {getDisplayName, getNotebookName} from "../util/pathName";
import {getIconByType} from "../editor/getIcon";
import {unicode2Emoji} from "../emoji";
import {addLoading, removeLoading} from "../protyle/ui/initUI";
import {Constants} from "../constants";
import {onGet} from "../protyle/util/onGet";
import type {App} from "../index";
import {runCardAction} from "./pendingAction";
import {showMessage} from "../dialog/message";

export const viewCards = (app: App, deckID: string, title: string, deckType: "Tree" | "" | "Notebook", cb?: (response: IWebSocketData) => void) => {
    let pageIndex = 1;
    let pageCount = 1;
    let edit: Protyle;
    let pageController: AbortController | undefined;
    let isPageLoading = false;
    let isRemoving = false;
    let destroyed = false;
    fetchPost(`/api/riff/get${deckType}RiffCards`, {
        id: deckID,
        page: pageIndex
    }, (response) => {
        pageCount = Math.max(response.data.pageCount, 1);
        const dialog = new MobileDialog({
            mobileSheet: {mode: "expanded", beforeClose: createMobileSecondaryEditorCloseGuard(() => edit)},
            hideCloseIcon: true,
            positionId: Constants.DIALOG_VIEWCARDS,
            content: `<div class="fn__flex-column" style="height: 100%">
    <div class="block__icons" style="border-bottom: 1px solid var(--b3-border-color)">
        <span class="fn__flex-center resize__move">${escapeHtml(title)}</span>
        <span class="fn__space${(deckType === "" && deckID === "") ? " fn__none" : ""}"></span>
        <span data-type="resetAll" data-position="north" class="block__icon block__icon--show ariaLabel${(deckType === "" && deckID === "") ? " fn__none" : ""}" aria-label="${window.siyuan.languages.reset}"><svg><use xlink:href='#iconUndo'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="previous" data-position="north" class="block__icon block__icon--show ariaLabel" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="next" data-position="north" class="block__icon block__icon--show ariaLabel" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="page" class="fn__flex-center ft__on-surface">${pageIndex}/${pageCount}</span>
        <span class="fn__space"></span>
        <span class="counter">${response.data.total}</span>
    </div>
    <div class="${isMobile() ? "fn__flex-column" : "fn__flex"} fn__flex-1" style="min-height: auto">
        <ul class="fn__flex-1 b3-list b3-list--background" style="user-select: none;padding: 8px 0">
            ${renderViewItem(response.data.blocks, title, deckType)}
        </ul>
        <div id="cardPreview" style="border-bottom-right-radius:var(--b3-border-radius-b);" class="fn__flex-1 fn__none"></div>
        <div class="fn__flex-1 card__empty">${window.siyuan.languages.emptyContent}</div>
    </div>
</div>`,
            width: isMobile() ? "100vw" : "80vw",
            height: isMobile() ? "100dvh" : "70vh",
            destroyCallback() {
                destroyed = true;
                pageController?.abort();
                if (edit) {
                    edit.destroy();
                    if (window.siyuan.mobile) {
                        window.siyuan.mobile.popEditor = null;
                    }
                }
            },
            resizeCallback(type: string) {
                if (type !== "d" && type !== "t" && edit) {
                    edit.resize();
                }
            }
        });
        if (response.data.blocks.length > 0) {
            edit = new Protyle(app, dialog.element.querySelector("#cardPreview") as HTMLElement, {
                blockId: "",
                action: [Constants.CB_GET_ALL],
                render: {
                    gutter: true,
                    breadcrumbDocName: true,
                    title: true,
                    hideTitleOnZoom: true,
                },
                typewriterMode: false
            });
            if (isMobile()) registerMobileSecondaryEditor(edit, () => dialog.invalidate());
            if (window.siyuan.mobile) {
                window.siyuan.mobile.popEditor = edit;
            }
            dialog.editors = {
                card: edit
            };
            edit.resize();
            void getArticle(edit, dialog.element.querySelector(".b3-list-item--focus")?.getAttribute("data-id"))
                .catch(error => showMessage(error.message));
        }
        const previousElement = dialog.element.querySelector('[data-type="previous"]');
        const nextElement = dialog.element.querySelector('[data-type="next"]');
        const pageElement = dialog.element.querySelector('[data-type="page"]');
        const counterElement = dialog.element.querySelector(".counter");
        const listElement = dialog.element.querySelector(".b3-list--background");
        const updatePagination = () => {
            if (pageIndex <= 1) {
                previousElement.setAttribute("disabled", "disabled");
            } else {
                previousElement.removeAttribute("disabled");
            }
            if (pageIndex >= pageCount) {
                nextElement.setAttribute("disabled", "disabled");
            } else {
                nextElement.removeAttribute("disabled");
            }
            pageElement.textContent = `${pageIndex}/${pageCount}`;
        };
        const renderPage = async (cardsResponse: IWebSocketData, focusIndex = 0) => {
            pageCount = Math.max(cardsResponse.data.pageCount, 1);
            counterElement.textContent = cardsResponse.data.total.toString();
            listElement.innerHTML = renderViewItem(cardsResponse.data.blocks, title, deckType);
            listElement.scrollTop = 0;
            const itemElements = Array.from(listElement.querySelectorAll('[data-type="card-item"]')) as HTMLElement[];
            let focusElement = itemElements[Math.min(focusIndex, itemElements.length - 1)];
            if (focusElement && !focusElement.dataset.id) {
                focusElement = itemElements.find(item => item.dataset.id) || focusElement;
            }
            listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            focusElement?.classList.add("b3-list-item--focus");
            if (focusElement) {
                const focusRect = focusElement.getBoundingClientRect();
                const listRect = listElement.getBoundingClientRect();
                if (focusRect.top < listRect.top || focusRect.bottom > listRect.bottom) {
                    focusElement.scrollIntoView(focusRect.top < listRect.top);
                }
            }
            await getArticle(edit, focusElement?.dataset.id || "");
            updatePagination();
        };
        const loadPage = async (targetPage: number, focusIndex = 0) => {
            if (isPageLoading || destroyed) {
                return;
            }
            isPageLoading = true;
            const requestedPage = Math.max(targetPage, 1);
            pageController?.abort();
            const controller = new AbortController();
            pageController = controller;
            try {
                const cardsResponse = await fetchSyncPost(`/api/riff/get${deckType}RiffCards`, {
                    id: deckID, page: requestedPage,
                }, undefined, undefined, controller.signal);
                if (cardsResponse.code !== 0 || controller.signal.aborted || destroyed) return;
                const responsePageCount = Math.max(cardsResponse.data.pageCount, 1);
                if (requestedPage > responsePageCount) {
                    isPageLoading = false;
                    await loadPage(responsePageCount, focusIndex);
                    return;
                }
                pageIndex = requestedPage;
                await renderPage(cardsResponse, focusIndex);
            } finally {
                if (pageController === controller) {
                    pageController = undefined;
                    isPageLoading = false;
                }
            }
        };
        updatePagination();
        dialog.element.setAttribute("data-key", Constants.DIALOG_VIEWCARDS);
        const onClick = async (event: MouseEvent) => {
            if (typeof event.detail === "string") {
                let currentElement = listElement.querySelector(".b3-list-item--focus");
                if (currentElement) {
                    const previousElement = currentElement;
                    if (event.detail === "arrowup") {
                        currentElement = currentElement.previousElementSibling || currentElement.parentElement.lastElementChild;
                    } else if (event.detail === "arrowdown") {
                        currentElement = currentElement.nextElementSibling || currentElement.parentElement.firstElementChild;
                    } else if (event.detail === "home") {
                        currentElement = currentElement.parentElement.firstElementChild;
                    } else if (event.detail === "end") {
                        currentElement = currentElement.parentElement.lastElementChild;
                    }
                    const currentRect = currentElement.getBoundingClientRect();
                    const parentRect = currentElement.parentElement.getBoundingClientRect();
                    if (currentRect.top < parentRect.top || currentRect.bottom > parentRect.bottom) {
                        currentElement.scrollIntoView(currentRect.top < parentRect.top);
                    }
                    if (await getArticle(edit, currentElement.getAttribute("data-id"))) {
                        previousElement.classList.remove("b3-list-item--focus");
                        currentElement.classList.add("b3-list-item--focus");
                    }
                }
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            let target = event.target as HTMLElement;
            while (target && (dialog.element !== target)) {
                const type = target.getAttribute("data-type");
                if (type === "previous") {
                    if (isPageLoading || isRemoving || pageIndex <= 1) {
                        return;
                    }
                    await loadPage(pageIndex - 1);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "next") {
                    if (isPageLoading || isRemoving || pageIndex >= pageCount) {
                        return;
                    }
                    await loadPage(pageIndex + 1);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "reset") {
                    fetchPost("/api/riff/resetRiffCards", {
                        type: deckType === "" ? "deck" : deckType.toLowerCase(),
                        deckID: deckType === "" ? deckID : Constants.QUICK_DECK_ID,
                        id: deckID,
                        blockIDs: [target.getAttribute("data-id")],
                    }, () => {
                        target.parentElement.querySelector(".ariaLabel.b3-list-item__meta").textContent = dayjs().format("YYYY-MM-DD");
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "resetAll") {
                    mobileConfirmDialog(window.siyuan.languages.reset,
                        window.siyuan.languages.resetCardTip.replace("${x}", dialog.element.querySelector(".counter").textContent), () => {
                            fetchPost("/api/riff/resetRiffCards", {
                                type: deckType === "" ? "deck" : deckType.toLowerCase(),
                                deckID: deckType === "" ? deckID : Constants.QUICK_DECK_ID,
                                id: deckID,
                            }, () => {
                                dialog.element.querySelectorAll(".ariaLabel.b3-list-item__meta").forEach(item => {
                                    item.textContent = dayjs().format("YYYY-MM-DD");
                                });
                            });
                        });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "card-item") {
                    if (isRemoving || isPageLoading) {
                        return;
                    }
                    if (await getArticle(edit, target.getAttribute("data-id"))) {
                        listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                        target.classList.add("b3-list-item--focus");
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "remove") {
                    if (isRemoving || isPageLoading) {
                        return;
                    }
                    isRemoving = true;
                    target.setAttribute("disabled", "disabled");
                    const focusIndex = Array.from(listElement.children).indexOf(target.parentElement);
                    try {
                        const removeResponse = await fetchSyncPost("/api/riff/removeRiffCards", {
                            deckID: deckType === "" ? deckID : Constants.QUICK_DECK_ID,
                            blockIDs: [target.getAttribute("data-id")]
                        });
                        if (removeResponse.code !== 0) return;
                        if (!destroyed) {
                            isRemoving = false;
                            await loadPage(pageIndex, Math.max(focusIndex, 0));
                        }
                        if (cb) {
                            cb(removeResponse);
                        }
                    } finally {
                        if (isRemoving) {
                            isRemoving = false;
                            target.removeAttribute("disabled");
                        }
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        };
        dialog.element.addEventListener("click", event => {
            const type = (event.target as HTMLElement).closest("[data-type]")?.getAttribute("data-type");
            const key = typeof event.detail === "string" && ["arrowup", "arrowdown", "home", "end"].includes(event.detail);
            if (!key && !["previous", "next", "reset", "resetAll", "card-item", "remove"].includes(type)) return;
            event.stopPropagation();
            event.preventDefault();
            void runCardAction(dialog, edit, () => onClick(event)).catch(error => showMessage(error.message));
        });
    });
};


const renderViewItem = (blocks: IBlock[], title: string, deckType: string) => {
    let listHTML = "";
    let isFirst = true;
    const pathArray = title.split("/");
    pathArray.splice(0, 1);
    blocks.forEach((item: IBlock) => {
        if (item.type) {
            let hPath;
            if (deckType === "") {
                hPath = getNotebookName(item.box) + getDisplayName(Lute.UnEscapeHTMLStr(item.hPath), false);
            } else {
                hPath = getDisplayName(Lute.UnEscapeHTMLStr(item.hPath), false).replace("/" + pathArray.join("/"), "");
                if (hPath.startsWith("/")) {
                    hPath = hPath.substring(1);
                }
            }
            listHTML += `<div data-type="card-item" class="b3-list-item${isFirst ? " b3-list-item--focus" : ""}${isMobile() ? "" : " b3-list-item--hide-action"}" data-id="${item.id}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
${unicode2Emoji(item.ial.icon, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${escapeHtml(item.content || Constants.ZWSP)}</span>
<span class="${(isMobile() || !hPath) ? "fn__none " : ""}b3-list-item__meta b3-list-item__meta--ellipsis" title="${escapeAttr(hPath)}">${escapeHtml(hPath)}</span>
<span data-position="parentE" aria-label="${window.siyuan.languages.revisionCount}" class="ariaLabel counter${item.riffCard?.reps === 0 ? " fn__none" : ""}">${item.riffCard?.reps}</span>
<span data-position="parentE" aria-label="${window.siyuan.languages.nextDue}" class="ariaLabel b3-list-item__meta${!item.riffCard?.due ? " fn__none" : ""}">${dayjs(item.riffCard?.due).format("YYYY-MM-DD")}</span>
<span data-position="parentE" data-type="reset" data-id="${item.id}" class="b3-list-item__action ariaLabel" aria-label="${window.siyuan.languages.reset}">
    <svg><use xlink:href="#iconUndo"></use></svg>
</span>
<span data-position="parentE" data-type="remove" data-id="${item.id}" class="b3-list-item__action b3-list-item__action--warning ariaLabel" aria-label="${window.siyuan.languages.removeDeck}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>
</div>`;
            isFirst = false;
        } else {
            // 块被删除的情况
            listHTML += `<div data-type="card-item" class="b3-list-item${isMobile() ? "" : " b3-list-item--hide-action"}">
<span class="b3-list-item__text">${escapeHtml(item.content)}</span>
<span data-position="parentE" data-type="remove" data-id="${item.id}" class="b3-list-item__action b3-list-item__action--warning ariaLabel" aria-label="${window.siyuan.languages.removeDeck}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>
</div>`;
        }
    });
    if (blocks.length === 0) {
        listHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
    }
    return listHTML;
};


const getArticle = async (edit: Protyle, id: string): Promise<boolean> => {
    edit.protyle.element.dataset.loadingCardId = id || "";
    if (!id) {
        removeLoading(edit.protyle);
        edit.protyle.element.classList.add("fn__none");
        edit.protyle.element.nextElementSibling.classList.remove("fn__none");
        return true;
    }
    edit.protyle.element.classList.remove("fn__none");
    edit.protyle.element.nextElementSibling.classList.add("fn__none");
    edit.protyle.scroll.lastScrollTop = 0;
    addLoading(edit.protyle);
    const isCurrent = () => edit.protyle.element.isConnected && edit.protyle.element.classList.contains("protyle") &&
        edit.protyle.element.dataset.loadingCardId === id;
    try {
        const response = await fetchSyncPost("/api/block/getDocInfo", {id});
        if (response.code !== 0 || !isCurrent()) return false;
        const getResponse = await fetchSyncPost("/api/filetree/getDoc", {id, mode: 0, size: Constants.SIZE_GET_MAX});
        if (getResponse.code !== 0 || !isCurrent()) return false;
        return await new Promise<boolean>(resolve => onGet({
            updateReadonly: true,
            data: getResponse,
            protyle: edit.protyle,
            action: getResponse.data.rootID === getResponse.data.id ? [] : [Constants.CB_GET_ALL],
            isValid: isCurrent,
            beforeAVRender: () => edit.protyle.wysiwyg.renderCustom(response.data.ial),
            afterCB: () => resolve(true),
            onAVRenderError: () => resolve(false),
        }));
    } finally {
        if (isCurrent()) removeLoading(edit.protyle);
    }
};
