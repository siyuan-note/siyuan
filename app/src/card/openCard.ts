import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {Protyle} from "../protyle";
import {Constants} from "../constants";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {hasClosestByAttribute, hasClosestByClassName} from "../protyle/util/hasClosest";
import {viewCards} from "./viewCards";
import {hideElements} from "../protyle/ui/hideElements";

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
            openCardByData(cardsResponse.data, `<select class="b3-select">${decksHTML}</select>`);
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
    <div class="card__block card__block--hide fn__flex-1${blocks.length === 0 ? " fn__none" : ""}" data-type="render"></div>
    <div class="card__empty${blocks.length === 0 ? "" : " fn__none"}" data-type="empty">
        <div>🔮</div>
        ${window.siyuan.languages.noDueCard}
    </div>
    <div class="fn__flex card__action${blocks.length === 0 ? " fn__none" : ""}">
        <button data-type="-1" class="b3-button fn__flex-1">${window.siyuan.languages.cardShowAnswer} (S)</button>
    </div>
    <div class="fn__flex card__action fn__none">
        <div>
            <span></span>
            <button data-type="0" aria-label="1 / j" class="b3-button b3-button--error b3-tooltips__s b3-tooltips">
                <div>🙈</div>
                ${window.siyuan.languages.cardRatingAgain} (1)
            </button>
        </div>
        <div>
            <span></span>
            <button data-type="1" aria-label="2 / k" class="b3-button b3-button--warning b3-tooltips__s b3-tooltips">
                <div>😬</div>
                ${window.siyuan.languages.cardRatingHard} (2)
            </button>
        </div>
        <div>
            <span></span>
            <button data-type="2" aria-label="3 / l" class="b3-button b3-button--info b3-tooltips__s b3-tooltips">
                <div>😊</div>
                ${window.siyuan.languages.cardRatingGood} (3)
            </button>
        </div>
        <div>
            <span></span>
            <button data-type="3" aria-label="4 / ;" class="b3-button b3-button--success b3-tooltips__s b3-tooltips">
                <div>🌈</div>
                ${window.siyuan.languages.cardRatingEasy} (4)
            </button>
        </div>
    </div>
</div>`,
        width: isMobile() ? "98vw" : "80vw",
        height: isMobile() ? "80vh" : "70vh",
    });
    (dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement).style.backgroundColor = "var(--b3-theme-background)";
    (dialog.element.querySelector(".b3-dialog__container") as HTMLElement).style.maxWidth = "1024px";
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
    if (window.siyuan.config.editor.readOnly) {
        disabledProtyle(editor.protyle);
    }
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
    const actionElements = dialog.element.querySelectorAll(".card__action");
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
            if (event.detail === "1" || event.detail === "j") {
                type = "0";
            } else if (event.detail === "2" || event.detail === "k") {
                type = "1";
            } else if (event.detail === "3" || event.detail === "l") {
                type = "2";
            } else if (event.detail === "4" || event.detail === ";") {
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
        hideElements(["toolbar", "hint", "util"], editor.protyle);
        if (type === "-1") {
            editor.protyle.element.classList.remove("card__block--hide");
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
                cardID: blocks[index].cardID,
                blockID: blocks[index].blockID,
                rating: parseInt(type)
            }, () => {
                index++;
                editor.protyle.element.classList.add("card__block--hide");
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
        return;
    }
    selectElement.addEventListener("change", () => {
        fetchPost("/api/riff/getRiffDueCards", {deckID: selectElement.value}, (cardsChangeResponse) => {
            blocks = cardsChangeResponse.data;
            index = 0;
            editor.protyle.element.classList.add("card__block--hide");
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
};
