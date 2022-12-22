import {focusByRange, getEditorRange} from "../protyle/util/selection";
import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {hideMessage, showMessage} from "../dialog/message";

const genCardItem = (item: { id: string, name: string }) => {
    return `<li style="margin: 0 !important;" data-id="${item.id}" class="b3-list-item${isMobile() ? "" : " b3-list-item--hide-action"}">
<span class="b3-list-item__text">${item.name}</span>
<span data-type="add" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.addDeck}">
    <svg><use xlink:href="#iconAdd"></use></svg>
</span>
<span data-type="remove" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.removeDeck}">
    <svg><use xlink:href="#iconMin"></use></svg>
</span>
</li>`
}

export const makeCard = (nodeElement: Element[]) => {
    const range = getEditorRange(nodeElement[0]);
    fetchPost("/api/riff/getRiffDecks", {}, (response) => {
        let html = ''
        const ids: string[] = []
        nodeElement.forEach(item => {
            ids.push(item.getAttribute("data-node-id"))
        })
        response.data.forEach((item: { id: string, name: string }) => {
            html += genCardItem(item)
        })
        const dialog = new Dialog({
            width: isMobile() ? "80vw" : "50vw",
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
        dialog.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isSameNode(dialog.element)) {
                const type = target.getAttribute("data-type");
                if (type === "create") {
                    let msgId = ""
                    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
                    if (inputElement.value) {
                        if (msgId) {
                            hideMessage(msgId);
                        }
                        fetchPost("/api/riff/createRiffDeck", {name: inputElement.value}, (response) => {
                            dialog.element.querySelector(".b3-list").insertAdjacentHTML("afterbegin", genCardItem(response.data))
                            inputElement.value = '';
                        })
                    } else {
                        msgId = showMessage(window.siyuan.languages._kernel[142])
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "add") {
                    fetchPost("/api/riff/addRiffCards", {
                        deckID: target.parentElement.getAttribute("data-id"),
                        blockIDs: ids
                    }, () => {
                        showMessage(window.siyuan.languages.addDeck)
                    })
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "remove") {
                    fetchPost("/api/riff/removeRiffCards", {
                        deckID: target.parentElement.getAttribute("data-id"),
                        blockIDs: ids
                    }, () => {
                        showMessage(window.siyuan.languages.removeDeck)
                    })
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        })
    })
};
