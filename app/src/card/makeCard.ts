import {focusByRange, getEditorRange} from "../protyle/util/selection";
import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {hideMessage, showMessage} from "../dialog/message";
import {confirmDialog} from "../dialog/confirmDialog";
import {hideElements} from "../protyle/ui/hideElements";
import {viewCards} from "./viewCards";
import {Constants} from "../constants";

export const genCardItem = (item: ICardPackage) => {
    return `<li data-id="${item.id}" data-name="${item.name}" class="b3-list-item b3-list-item--narrow${isMobile() ? "" : " b3-list-item--hide-action"}">
<span class="b3-list-item__text">
    <span>${item.name}</span>
    <span class="b3-list-item__meta">${item.size}</span>
</span>
<span data-type="rename" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.rename}">
    <svg><use xlink:href="#iconEdit"></use></svg>
</span>
<span data-type="delete" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>
<span data-type="view" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.cardPreview}">
    <svg><use xlink:href="#iconEye"></use></svg>
</span>
<span data-type="remove" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.removeDeck}">
    <svg><use xlink:href="#iconMin"></use></svg>
</span>
<span data-type="add" style="display: block" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.addDeck}">
    <svg><use xlink:href="#iconAdd"></use></svg>
</span>
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
        response.data.forEach((item: ICardPackage) => {
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
        dialog.element.style.zIndex = "200";
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
                        inputElement.focus();
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
                    confirmDialog(window.siyuan.languages.confirm, `${window.siyuan.languages.confirmDelete} <b>${target.parentElement.getAttribute("data-name")}</b>?`, () => {
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
                    viewCards(target.parentElement.getAttribute("data-id"), target.parentElement.getAttribute("data-name"), (removeResponse) => {
                        target.parentElement.outerHTML = genCardItem(removeResponse.data);
                    });
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
                    inputElement.value = target.parentElement.getAttribute("data-name");
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
                            target.parentElement.querySelector(".b3-list-item__text span").textContent = inputElement.value;
                            target.parentElement.setAttribute("data-name", inputElement.value);
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

export const quickMakeCard = (nodeElement: Element[]) => {
    let isRemove = true;
    const ids: string[] = [];
    nodeElement.forEach(item => {
        if (item.getAttribute("data-type") === "NodeThematicBreak") {
            return;
        }
        item.classList.remove("protyle-wysiwyg--select");
        ids.push(item.getAttribute("data-node-id"));
        if ((item.getAttribute("custom-riff-decks") || "").indexOf(Constants.QUICK_DECK_ID) === -1) {
            isRemove = false;
        }
    });
    if (isRemove) {
        fetchPost("/api/riff/removeRiffCards", {
            deckID: Constants.QUICK_DECK_ID,
            blockIDs: ids
        });
    } else {
        fetchPost("/api/riff/addRiffCards", {
            deckID: Constants.QUICK_DECK_ID,
            blockIDs: ids
        });
    }
};



