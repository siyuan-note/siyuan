import {Protyle} from "../protyle";
import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {escapeAttr, escapeHtml} from "../util/escape";
import {getDisplayName, getNotebookName} from "../util/pathName";
import {getIconByType} from "../editor/getIcon";
import {unicode2Emoji} from "../emoji";
import {addLoading} from "../protyle/ui/initUI";
import {Constants} from "../constants";
import {onGet} from "../protyle/util/onGet";
import {App} from "../index";

export const viewCards = (app: App, deckID: string, title: string, deckType: "Tree" | "" | "Notebook", cb?: (response: IWebSocketData) => void) => {
    let pageIndex = 1;
    let edit: Protyle;
    fetchPost(`/api/riff/get${deckType}RiffCards`, {
        id: deckID,
        page: pageIndex
    }, (response) => {
        const dialog = new Dialog({
            content: `<div class="fn__flex-column" style="height: 100%">
    <div class="block__icons">
        <span class="fn__flex-1 fn__flex-center resize__move">${escapeHtml(title)}</span>
        <span class="fn__space"></span>
        <span data-type="previous" class="block__icon block__icon--show b3-tooltips b3-tooltips__w" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="next" class="block__icon block__icon--show b3-tooltips b3-tooltips__w" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
        <span class="fn__space"></span>
        <span class="fn__flex-center ft__on-surface">${pageIndex}/${response.data.pageCount || 1}</span>
        <span class="fn__space"></span>
        <span class="counter">${response.data.total}</span>
        ${isMobile() ? `<span class="fn__space"></span>
<div data-type="close" class="block__icon block__icon--show">
    <svg><use xlink:href="#iconCloseRound"></use></svg>
</div>` : ""}
    </div>
    <div class="${isMobile() ? "fn__flex-column" : "fn__flex"} fn__flex-1" style="min-height: auto">
        <ul class="fn__flex-1 b3-list b3-list--background" style="user-select: none">
            ${renderViewItem(response.data.blocks, title, deckType)}
        </ul>
        <div id="cardPreview" style="border-bottom-right-radius:var(--b3-border-radius-b);" class="fn__flex-1 fn__none"></div>
        <div class="fn__flex-1 card__empty">${window.siyuan.languages.emptyContent}</div>
    </div>
</div>`,
            width: isMobile() ? "100vw" : "80vw",
            height: isMobile() ? "100vh" : "70vh",
            destroyCallback() {
                if (edit) {
                    edit.destroy();
                    if (window.siyuan.mobile) {
                        window.siyuan.mobile.popEditor = null;
                    }
                }
            }
        });
        if (response.data.blocks.length > 0) {
            edit = new Protyle(app, dialog.element.querySelector("#cardPreview") as HTMLElement, {
                blockId: "",
                render: {
                    gutter: true,
                    breadcrumbDocName: true
                },
            });
            if (window.siyuan.mobile) {
                window.siyuan.mobile.popEditor = edit;
            }
            dialog.editor = edit;
            getArticle(edit, dialog.element.querySelector(".b3-list-item--focus")?.getAttribute("data-id"));
        }
        const previousElement = dialog.element.querySelector('[data-type="previous"]');
        const nextElement = dialog.element.querySelector('[data-type="next"]');
        const listElement = dialog.element.querySelector(".b3-list--background");
        if (response.data.pageCount > 1) {
            nextElement.removeAttribute("disabled");
        }
        dialog.element.setAttribute("data-key", "viewCards");
        dialog.element.addEventListener("click", (event) => {
            if (typeof event.detail === "string") {
                let currentElement = listElement.querySelector(".b3-list-item--focus");
                if (currentElement) {
                    currentElement.classList.remove("b3-list-item--focus");
                    if (event.detail === "arrowup") {
                        currentElement = currentElement.previousElementSibling || currentElement.parentElement.lastElementChild;
                    } else if (event.detail === "arrowdown") {
                        currentElement = currentElement.nextElementSibling || currentElement.parentElement.firstElementChild;
                    }
                    const currentRect = currentElement.getBoundingClientRect();
                    const parentRect = currentElement.parentElement.getBoundingClientRect();
                    if (currentRect.top < parentRect.top || currentRect.bottom > parentRect.bottom) {
                        currentElement.scrollIntoView(currentRect.top < parentRect.top);
                    }
                    getArticle(edit, currentElement.getAttribute("data-id"));
                    currentElement.classList.add("b3-list-item--focus");
                }
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            let target = event.target as HTMLElement;
            while (target && !dialog.element.isSameNode(target)) {
                const type = target.getAttribute("data-type");
                if (type === "close") {
                    dialog.destroy();
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "previous") {
                    if (pageIndex <= 1) {
                        return;
                    }
                    pageIndex--;
                    if (pageIndex <= 1) {
                        previousElement.setAttribute("disabled", "disabled");
                    }
                    fetchPost(`/api/riff/get${deckType}RiffCards`, {id: deckID, page: pageIndex}, (cardsResponse) => {
                        if (pageIndex === cardsResponse.data.pageCount) {
                            nextElement.setAttribute("disabled", "disabled");
                        } else if (cardsResponse.data.pageCount > 1) {
                            nextElement.removeAttribute("disabled");
                        }
                        nextElement.nextElementSibling.nextElementSibling.textContent = `${pageIndex}/${cardsResponse.data.pageCount || 1}`;
                        listElement.innerHTML = renderViewItem(cardsResponse.data.blocks, title, deckType);
                        listElement.scrollTop = 0;
                        getArticle(edit, dialog.element.querySelector(".b3-list-item--focus")?.getAttribute("data-id"));
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "next") {
                    if (pageIndex >= response.data.pageCount) {
                        return;
                    }
                    pageIndex++;
                    previousElement.removeAttribute("disabled");
                    fetchPost(`/api/riff/get${deckType}RiffCards`, {id: deckID, page: pageIndex}, (cardsResponse) => {
                        if (pageIndex === cardsResponse.data.pageCount) {
                            nextElement.setAttribute("disabled", "disabled");
                        } else if (cardsResponse.data.pageCount > 1) {
                            nextElement.removeAttribute("disabled");
                        }
                        nextElement.nextElementSibling.nextElementSibling.textContent = `${pageIndex}/${cardsResponse.data.pageCount || 1}`;
                        listElement.innerHTML = renderViewItem(cardsResponse.data.blocks, title, deckType);
                        listElement.scrollTop = 0;
                        getArticle(edit, dialog.element.querySelector(".b3-list-item--focus")?.getAttribute("data-id"));
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "card-item") {
                    getArticle(edit, target.getAttribute("data-id"));
                    listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                    target.classList.add("b3-list-item--focus");
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "remove") {
                    fetchPost("/api/riff/removeRiffCards", {
                        deckID: deckType === "" ? deckID : Constants.QUICK_DECK_ID,
                        blockIDs: [target.getAttribute("data-id")]
                    }, (removeResponse) => {
                        let nextElment = target.parentElement.nextElementSibling;
                        if (!nextElment) {
                            nextElment = target.parentElement.previousElementSibling;
                        }
                        if (!nextElment && target.parentElement.parentElement.childElementCount > 1) {
                            nextElment = target.parentElement.parentElement.firstElementChild;
                        }

                        if (!nextElment) {
                            getArticle(edit, "");
                            listElement.innerHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
                        } else {
                            getArticle(edit, nextElment.getAttribute("data-id"));
                            listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                            nextElment.classList.add("b3-list-item--focus");
                            target.parentElement.remove();
                        }

                        dialog.element.querySelector(".counter").textContent = (parseInt(dialog.element.querySelector(".counter").textContent) - 1).toString();
                        if (cb) {
                            cb(removeResponse);
                        }
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
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
<span class="b3-list-item__text">${item.content || Constants.ZWSP}</span>
<span data-type="remove" data-id="${item.id}" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.removeDeck}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>
<span class="${(isMobile() || !hPath) ? "fn__none " : ""}b3-list-item__meta b3-list-item__meta--ellipsis" title="${escapeAttr(hPath)}">${escapeHtml(hPath)}</span>
<span aria-label="${window.siyuan.languages.revisionCount}" class="b3-tooltips b3-tooltips__w counter${item.riffCardReps === 0 ? " fn__none" : ""}">${item.riffCardReps}</span>
</div>`;
            isFirst = false;
        } else {
            // 块被删除的情况
            listHTML += `<div data-type="card-item" class="b3-list-item${isMobile() ? "" : " b3-list-item--hide-action"}">
<span class="b3-list-item__text">${item.content}</span>
<span data-type="remove" data-id="${item.id}" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.removeDeck}">
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


const getArticle = (edit: Protyle, id: string) => {
    if (!id) {
        edit.protyle.element.classList.add("fn__none");
        edit.protyle.element.nextElementSibling.classList.remove("fn__none");
        return;
    }
    edit.protyle.element.classList.remove("fn__none");
    edit.protyle.element.nextElementSibling.classList.add("fn__none");
    edit.protyle.scroll.lastScrollTop = 0;
    addLoading(edit.protyle);
    fetchPost("/api/filetree/getDoc", {
        id,
        mode: 0,
        size: Constants.SIZE_GET_MAX,
    }, getResponse => {
        onGet({
            data: getResponse, protyle: edit.protyle, action: [Constants.CB_GET_ALL, Constants.CB_GET_HTML]
        });
    });
};
