import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {Protyle} from "../protyle";
import {Constants} from "../constants";
import {onGet} from "../protyle/util/onGet";
import {hasClosestByAttribute, hasClosestByClassName} from "../protyle/util/hasClosest";
import {viewCards} from "./viewCards";

export const openCard = () => {
    const exit = window.siyuan.dialogs.find(item => {
        if (item.element.getAttribute("data-key") === window.siyuan.config.keymap.general.riffCard.custom) {
            item.destroy();
            return true;
        }
    });
    if (exit) {
        return;
    }
    let decksHTML = '<option value="">All</option>';
    fetchPost("/api/riff/getRiffDecks", {}, (response) => {
        response.data.forEach((deck: { id: string, name: string }) => {
            decksHTML += `<option value="${deck.id}">${deck.name}</option>`;
        });
        fetchPost("/api/riff/getRiffDueCards", {deckID: ""}, (cardsResponse) => {
            openCardByData(cardsResponse.data, `<select class="b3-select">${decksHTML}</select>`)
        });
    });
};

export const openCardByData = (cardsData: ICard[], html = "") => {
    let blocks = cardsData;
    let index = 0;
    if (blocks.length > 0) {
        html += `<div class="fn__flex" style="align-items: center" data-type="count">
    <span class="fn__space"></span>
    <span data-type="view" class="block__icon block__icon--show b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.cardPreview}">
        <svg><use xlink:href="#iconEye"></use></svg>
    </span>
    <span class="fn__space"></span>
    <div class="ft__on-surface ft__smaller"><span>1</span>/<span>${blocks.length}</span></div>
</div>`;
    }
    const dialog = new Dialog({
        content: `<div class="fn__flex-column" style="box-sizing: border-box;max-height: 100%">
    <div class="fn__flex b3-form__space--small">
        <span class="fn__flex-1 fn__flex-center">${window.siyuan.languages.riffCard}</span>
        ${html}
    </div>
    <div class="b3-dialog__cardblock b3-dialog__cardblock--hide fn__flex-1${blocks.length === 0 ? " fn__none" : ""}" data-type="render"></div>
    <div class="b3-dialog__cardempty${blocks.length === 0 ? "" : " fn__none"}" data-type="empty">
        <div>🔮</div>
        ${window.siyuan.languages.noDueCard}
    </div>
    <div class="fn__flex b3-dialog__cardaction${blocks.length === 0 ? " fn__none" : ""}">
        <span class="fn__flex-1"></span>
        <button data-type="-1" class="b3-button">Show (S)</button>
        <span class="fn__flex-1"></span>
    </div>
    <div class="fn__flex b3-dialog__cardaction fn__none">
        <div>
            <span></span>
            <button data-type="0" class="b3-button b3-button--error">Again (A)</button>
        </div>
        <span class="fn__flex-1"></span>
        <div>
            <span></span>
            <button data-type="1" class="b3-button b3-button--warning">Hard (H)</button>
        </div>
        <span class="fn__flex-1"></span>
        <div>
            <span></span>
            <button data-type="2" class="b3-button b3-button--info">Good (G)</button>
        </div>
        <span class="fn__flex-1"></span>
        <div>
            <span></span>
            <button data-type="3" class="b3-button b3-button--success">Easy (E)</button>
        </div>
    </div>
</div>`,
        width: isMobile() ? "98vw" : "80vw",
        height: isMobile() ? "80vh" : "70vh",
    });
    (dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement).style.backgroundColor = "var(--b3-theme-background)";
    const editor = new Protyle(dialog.element.querySelector("[data-type='render']") as HTMLElement, {
        blockId: "",
        action: [Constants.CB_GET_ALL],
        render: {
            background: false,
            title: false,
            gutter: true,
            breadcrumbDocName: true,
        },
        typewriterMode: false
    });
    if (blocks.length > 0) {
        fetchPost("/api/filetree/getDoc", {
            id: blocks[index].blockID,
            mode: 0,
            size: Constants.SIZE_GET_MAX
        }, (response) => {
            onGet(response, editor.protyle, [Constants.CB_GET_ALL, Constants.CB_GET_HTML]);
        });
    }
    (dialog.element.firstElementChild as HTMLElement).style.zIndex = "200";
    dialog.element.setAttribute("data-key", window.siyuan.config.keymap.general.riffCard.custom);
    const countElement = dialog.element.querySelector('[data-type="count"]');
    const actionElements = dialog.element.querySelectorAll(".b3-dialog__cardaction");
    dialog.element.addEventListener("click", (event) => {
        const viewElement = hasClosestByAttribute(event.target as HTMLElement, "data-type", "view");
        if (viewElement) {
            if (selectElement) {
                viewCards(selectElement.value, selectElement.options[selectElement.selectedIndex].text, (removeResponse) => {
                    countElement.lastElementChild.lastElementChild.innerHTML = removeResponse.data.size.toString();
                });
            } else {
                viewCards(countElement.previousElementSibling.getAttribute("data-id"),
                    countElement.previousElementSibling.textContent, (removeResponse) => {
                        countElement.lastElementChild.lastElementChild.innerHTML = removeResponse.data.size.toString();
                    }, true);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        let type = "";
        if (typeof event.detail === "string") {
            if (event.detail === "a") {
                type = "0";
            } else if (event.detail === "h") {
                type = "1";
            } else if (event.detail === "g") {
                type = "2";
            } else if (event.detail === "e") {
                type = "3";
            } else if (event.detail === "s") {
                type = "-1";
            }
        }
        if (!type) {
            const buttonElement = hasClosestByClassName(event.target as HTMLElement, "b3-button");
            if (buttonElement) {
                type = buttonElement.getAttribute("data-type");
            }
        }
        if (!type || !blocks[index]) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (type === "-1") {
            editor.protyle.element.classList.remove("b3-dialog__cardblock--hide");
            actionElements[0].classList.add("fn__none");
            actionElements[1].querySelectorAll(".b3-button").forEach((element, btnIndex) => {
                element.previousElementSibling.textContent = blocks[index].nextDues[btnIndex];
            });
            actionElements[1].classList.remove("fn__none");
            return;
        }
        if (["0", "1", "2", "3"].includes(type)) {
            fetchPost("/api/riff/reviewRiffCard", {
                deckID: blocks[index].deckID,
                blockID: blocks[index].blockID,
                rating: parseInt(type)
            }, () => {
                index++;
                editor.protyle.element.classList.add("b3-dialog__cardblock--hide");
                if (index > blocks.length - 1) {
                    countElement.classList.add("fn__none");
                    editor.protyle.element.classList.add("fn__none");
                    editor.protyle.element.nextElementSibling.classList.remove("fn__none");
                    actionElements[0].classList.add("fn__none");
                    actionElements[1].classList.add("fn__none");
                    return;
                }
                actionElements[0].classList.remove("fn__none");
                actionElements[1].classList.add("fn__none");
                countElement.lastElementChild.firstElementChild.innerHTML = (index + 1).toString();
                fetchPost("/api/filetree/getDoc", {
                    id: blocks[index].blockID,
                    mode: 0,
                    size: Constants.SIZE_GET_MAX
                }, (response) => {
                    onGet(response, editor.protyle, [Constants.CB_GET_ALL, Constants.CB_GET_HTML]);
                });
            });
        }
    });
    const selectElement = dialog.element.querySelector("select");
    if (!selectElement) {
        return
    }
    selectElement.addEventListener("change", () => {
        fetchPost("/api/riff/getRiffDueCards", {deckID: selectElement.value}, (cardsChangeResponse) => {
            blocks = cardsChangeResponse.data;
            index = 0;
            editor.protyle.element.classList.add("b3-dialog__cardblock--hide");
            if (blocks.length > 0) {
                countElement.lastElementChild.innerHTML = `<span>1</span>/${blocks.length}`;
                countElement.classList.remove("fn__none");
                editor.protyle.element.classList.remove("fn__none");
                editor.protyle.element.nextElementSibling.classList.add("fn__none");
                actionElements[0].classList.remove("fn__none");
                actionElements[1].classList.add("fn__none");
                fetchPost("/api/filetree/getDoc", {
                    id: blocks[index].blockID,
                    mode: 0,
                    size: Constants.SIZE_GET_MAX
                }, (response) => {
                    onGet(response, editor.protyle, [Constants.CB_GET_ALL, Constants.CB_GET_HTML]);
                });
            } else {
                countElement.classList.add("fn__none");
                editor.protyle.element.classList.add("fn__none");
                editor.protyle.element.nextElementSibling.classList.remove("fn__none");
                actionElements[0].classList.add("fn__none");
                actionElements[1].classList.add("fn__none");
            }
        });
    });
}
