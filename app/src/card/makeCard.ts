import {focusByRange, getEditorRange} from "../protyle/util/selection";
import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {hideMessage, showMessage} from "../dialog/message";
import {confirmDialog} from "../dialog/confirmDialog";
import {Protyle} from "../protyle";
import {getIconByType} from "../editor/getIcon";
import {unicode2Emoji} from "../emoji";
import {Constants} from "../constants";
import {onGet} from "../protyle/util/onGet";
import {addLoading} from "../protyle/ui/initUI";
import {escapeHtml} from "../util/escape";
import {getDisplayName, getNotebookName} from "../util/pathName";
import {hideElements} from "../protyle/ui/hideElements";

const genCardItem = (item: ICard) => {
    return `<li data-id="${item.id}" class="b3-list-item b3-list-item--narrow${isMobile() ? "" : " b3-list-item--hide-action"}">
<span class="b3-list-item__text">${item.name}</span>
<span class="counter b3-tooltips b3-tooltips__w${isMobile() ? "" : " fn__none"}" aria-label="${window.siyuan.languages.riffCard}">${item.size}</span>
<span data-type="add" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.addDeck}">
    <svg><use xlink:href="#iconAdd"></use></svg>
</span>
<span data-type="remove" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.removeDeck}">
    <svg><use xlink:href="#iconMin"></use></svg>
</span>
<span data-type="rename" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.rename}">
    <svg><use xlink:href="#iconEdit"></use></svg>
</span>
<span data-type="delete" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>
<span data-type="view" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.riffCard}">
    <svg><use xlink:href="#iconEye"></use></svg>
</span>
<span class="counter b3-tooltips b3-tooltips__w${isMobile() ? " fn__none" : ""}" aria-label="${window.siyuan.languages.riffCard}">${item.size}</span>
<span class="b3-list-item__meta${isMobile() ? " fn__none" : ""}">${item.updated}</span>
</li>`;
};

export const makeCard = (nodeElement: Element[]) => {
    window.siyuan.dialogs.find(item => {
        if (item.element.getAttribute("data-key") === "makeCard") {
            hideElements(["dialog"]);
            return true;
        }
    });
    const range = getEditorRange(nodeElement[0]);
    fetchPost("/api/riff/getRiffDecks", {}, (response) => {
        let html = "";
        const ids: string[] = [];
        nodeElement.forEach(item => {
            if (item.getAttribute("data-type") === "NodeThematicBreak") {
                return;
            }
            ids.push(item.getAttribute("data-node-id"));
        });
        response.data.forEach((item: ICard) => {
            html += genCardItem(item);
        });
        const dialog = new Dialog({
            width: isMobile() ? "90vw" : "50vw",
            height: "70vh",
            title: window.siyuan.languages.riffCard,
            content: `<div class="b3-dialog__content fn__flex-column" style="box-sizing: border-box;height: 100%">
    <div class="fn__flex">
        <input class="b3-text-field fn__flex-1">
        <span class="fn__space"></span>
        <button data-type="create" class="b3-button b3-button--outline" style="width: 100px">
            <svg><use xlink:href="#iconAdd"></use></svg>
            ${window.siyuan.languages.createDeck}
        </button>
    </div>
    <div class="fn__hr"></div>
    <ul class="b3-list b3-list--background fn__flex-1">${html}</ul>
</div>`,
            destroyCallback() {
                focusByRange(range);
            }
        });
        dialog.element.setAttribute("data-key", "makeCard");
        dialog.element.style.zIndex = "199";
        dialog.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isSameNode(dialog.element)) {
                const type = target.getAttribute("data-type");
                if (type === "create") {
                    let msgId = "";
                    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
                    if (inputElement.value) {
                        if (msgId) {
                            hideMessage(msgId);
                        }
                        fetchPost("/api/riff/createRiffDeck", {name: inputElement.value}, (response) => {
                            dialog.element.querySelector(".b3-list").insertAdjacentHTML("afterbegin", genCardItem(response.data));
                            inputElement.value = "";
                        });
                    } else {
                        msgId = showMessage(window.siyuan.languages._kernel[142]);
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "add") {
                    fetchPost("/api/riff/addRiffCards", {
                        deckID: target.parentElement.getAttribute("data-id"),
                        blockIDs: ids
                    }, (addResponse) => {
                        target.parentElement.outerHTML = genCardItem(addResponse.data);
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "remove") {
                    fetchPost("/api/riff/removeRiffCards", {
                        deckID: target.parentElement.getAttribute("data-id"),
                        blockIDs: ids
                    }, (removeResponse) => {
                        target.parentElement.outerHTML = genCardItem(removeResponse.data);
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "delete") {
                    confirmDialog(window.siyuan.languages.confirm, `${window.siyuan.languages.confirmDelete} <b>${target.parentElement.querySelector(".b3-list-item__text").textContent}</b>?`, () => {
                        fetchPost("/api/riff/removeRiffDeck", {
                            deckID: target.parentElement.getAttribute("data-id"),
                        }, () => {
                            target.parentElement.remove();
                        });
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "view") {
                    viewCards(target.parentElement.getAttribute("data-id"), target.parentElement.querySelector(".b3-list-item__text").textContent, target.parentElement);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "rename") {
                    const renameDialog = new Dialog({
                        title: window.siyuan.languages.rename,
                        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value=""></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                        width: isMobile() ? "80vw" : "520px",
                    });
                    const inputElement = renameDialog.element.querySelector("input") as HTMLInputElement;
                    const btnsElement = renameDialog.element.querySelectorAll(".b3-button");
                    renameDialog.bindInput(inputElement, () => {
                        (btnsElement[1] as HTMLButtonElement).click();
                    });
                    inputElement.value = target.parentElement.querySelector(".b3-list-item__text").textContent;
                    inputElement.focus();
                    inputElement.select();
                    btnsElement[0].addEventListener("click", () => {
                        renameDialog.destroy();
                    });
                    btnsElement[1].addEventListener("click", () => {
                        fetchPost("/api/riff/renameRiffDeck", {
                            name: inputElement.value,
                            deckID: target.parentElement.getAttribute("data-id"),
                        }, () => {
                            target.parentElement.querySelector(".b3-list-item__text").textContent = inputElement.value;
                        });
                        renameDialog.destroy();
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

const viewCards = (deckID: string, title: string, sourceElement: HTMLElement) => {
    let pageIndex = 1;
    let edit:Protyle;
    fetchPost("/api/riff/getRiffCards", {deckID, page: pageIndex}, (response) => {
        const dialog = new Dialog({
            title,
            content: `<div class="fn__flex-column" style="height: 100%">
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <span class="fn__space"></span>
        <span data-type="previous" class="block__icon block__icon--show b3-tooltips b3-tooltips__ne" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="next" class="block__icon block__icon--show b3-tooltips b3-tooltips__ne" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
        <span class="fn__space"></span>
        <span class="fn__flex-center ft__on-surface">${pageIndex}/${response.data.pageCount || 1}</span>
        <div class="fn__flex-1"></div>
    </div>
    <div class="fn__hr"></div>
    <div class="${isMobile() ? "fn__flex-column" : "fn__flex"} fn__flex-1">
        <ul class="fn__flex-1 b3-list b3-list--background" style="user-select: none">
            ${renderViewItem(response.data.blocks)}
        </ul>
        <div id="cardPreview" class="fn__flex-1 fn__none"></div>
        <div class="fn__flex-1 b3-dialog__cardempty">${window.siyuan.languages.emptyContent}</div>
    </div>
</div>`,
            width: isMobile() ? "90vw" : "80vw",
            height: "80vh",
            destroyCallback() {
                if (edit) {
                    edit.destroy();
                }
            }
        });
        if (response.data.blocks.length === 0) {
            return;
        }
        edit = new Protyle(dialog.element.querySelector("#cardPreview") as HTMLElement, {
            blockId: "",
            render: {
                gutter: true,
                breadcrumbDocName: true
            },
        });
        getArticle(edit, dialog.element.querySelector(".b3-list-item--focus")?.getAttribute("data-id"));
        const previousElement = dialog.element.querySelector('[data-type="previous"]');
        const nextElement = dialog.element.querySelector('[data-type="next"]');
        const listElement = dialog.element.querySelector(".b3-list--background");
        if (response.data.pageCount > 1) {
            nextElement.removeAttribute("disabled");
        }
        dialog.element.style.zIndex = "200";
        dialog.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !dialog.element.isSameNode(target)) {
                const type = target.getAttribute("data-type");
                if (type === "previous") {
                    if (pageIndex <= 1) {
                        return;
                    }
                    pageIndex--;
                    if (pageIndex <= 1) {
                        previousElement.setAttribute("disabled", "disabled");
                    }
                    fetchPost("/api/riff/getRiffCards", {deckID, page: pageIndex}, (cardsResponse) => {
                        if (pageIndex === cardsResponse.data.pageCount) {
                            nextElement.setAttribute("disabled", "disabled");
                        } else if (cardsResponse.data.pageCount > 1) {
                            nextElement.removeAttribute("disabled");
                        }
                        nextElement.nextElementSibling.nextElementSibling.textContent = `${pageIndex}/${cardsResponse.data.pageCount || 1}`;
                        listElement.innerHTML = renderViewItem(cardsResponse.data.blocks);
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
                    fetchPost("/api/riff/getRiffCards", {deckID, page: pageIndex}, (cardsResponse) => {
                        if (pageIndex === cardsResponse.data.pageCount) {
                            nextElement.setAttribute("disabled", "disabled");
                        } else if (cardsResponse.data.pageCount > 1) {
                            nextElement.removeAttribute("disabled");
                        }
                        nextElement.nextElementSibling.nextElementSibling.textContent = `${pageIndex}/${cardsResponse.data.pageCount || 1}`;
                        listElement.innerHTML = renderViewItem(cardsResponse.data.blocks);
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
                        deckID,
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
                        } else {
                            getArticle(edit, nextElment.getAttribute("data-id"));
                            listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                            nextElment.classList.add("b3-list-item--focus");
                        }
                        target.parentElement.remove();
                        sourceElement.outerHTML = genCardItem(removeResponse.data);
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
        onGet(getResponse, edit.protyle, [Constants.CB_GET_ALL, Constants.CB_GET_HTML]);
    });
};

const renderViewItem = (blocks: IBlock[]) => {
    let listHTML = "";
    let isFirst = true;
    blocks.forEach((item: IBlock) => {
        if (item.type) {
            const hPath = escapeHtml(getNotebookName(item.box)) + getDisplayName(item.hPath, false);
            listHTML += `<div data-type="card-item" class="b3-list-item${isFirst ? " b3-list-item--focus" : ""}${isMobile() ? "" : " b3-list-item--hide-action"}" data-id="${item.id}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
${unicode2Emoji(item.ial.icon, false, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${item.content}</span>
<span data-type="remove" data-id="${item.id}" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.removeDeck}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>
<span class="${isMobile() ? "fn__none " : ""}b3-list-item__meta b3-list-item__meta--ellipsis" title="${hPath}">${hPath}</span>
</div>`;
            isFirst = false;
        } else {
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
