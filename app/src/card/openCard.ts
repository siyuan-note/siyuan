import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {Protyle} from "../protyle";
import {Constants} from "../constants";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {hasClosestByClassName} from "../protyle/util/hasClosest";

export const openCard = () => {
    let decksHTML = '<option value="">All</option>';
    fetchPost("/api/riff/getRiffDecks", {}, (response) => {
        response.data.forEach((deck: { id: string, name: string }) => {
            decksHTML += `<option value="${deck.id}">${deck.name}</option>`;
        });
        fetchPost("/api/riff/getRiffDueCards", {deckID: ""}, (cardsResponse) => {
            let blocks = cardsResponse.data;
            let countHTML = "";
            let index = 0;
            if (blocks.length > 0) {
                countHTML = `<span>1</span>/${blocks.length}`;
            }
            const dialog = new Dialog({
                title: window.siyuan.languages.riffCard,
                content: `<div class="fn__flex-column b3-dialog__content" style="box-sizing: border-box;max-height: 100%">
    <div class="fn__flex">
        <select class="b3-select fn__flex-1">${decksHTML}</select>
        <div style="margin-left: 8px" class="ft__on-surface ft__smaller fn__flex-center${blocks.length === 0 ? " fn__none" : ""}" data-type="count">${countHTML}</div>
    </div>
    <div class="fn__hr"><input style="opacity: 0;height: 1px;box-sizing: border-box"></div>
    <div class="b3-dialog__cardblock b3-dialog__cardblock--show fn__flex-1${blocks.length === 0 ? " fn__none" : ""}" data-type="render"></div>
    <div class="b3-dialog__cardempty${blocks.length === 0 ? "" : " fn__none"}" data-type="empty">${window.siyuan.languages.noDueCard}</div>
    <div class="fn__flex b3-dialog__cardaction${blocks.length === 0 ? " fn__none" : ""}" style="flex-wrap: wrap" data-type="action">
        <button data-type="-1" class="b3-button">Show (S)</button>
        <span class="${isMobile() ? "fn__space" : "fn__flex-1"}"></span>
        <button data-type="0" class="b3-button b3-button--error">Again (A)</button>
        <span class="${isMobile() ? "fn__space" : "fn__flex-1"}"></span>
        <button data-type="1" class="b3-button b3-button--warning">Hard (H)</button>
        <span class="${isMobile() ? "fn__space" : "fn__flex-1"}"></span>
        <button data-type="2" class="b3-button b3-button--info">Good (G)</button>
        <span class="${isMobile() ? "fn__space" : "fn__flex-1"}"></span>
        <button data-type="3" class="b3-button b3-button--success">Easy (E)</button>
    </div>
</div>`,
                width: isMobile() ? "80vw" : "50vw",
                height: "70vh",
            });
            dialog.element.querySelector("input").focus();
            const editor = new Protyle(dialog.element.querySelector("[data-type='render']") as HTMLElement, {
                blockId: "",
                action: [Constants.CB_GET_HISTORY],
                render: {
                    background: false,
                    title: false,
                    gutter: false,
                    breadcrumb: false,
                    breadcrumbDocName: false,
                    breadcrumbContext: false,
                },
                typewriterMode: false
            });
            disabledProtyle(editor.protyle);
            if (blocks.length > 0) {
                fetchPost("/api/riff/renderRiffCard", {blockID: blocks[index].blockID}, (response) => {
                    onGet(response, editor.protyle, [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML]);
                });
            }
            dialog.element.setAttribute("data-key", window.siyuan.config.keymap.general.riffCard.custom);
            const countElement = dialog.element.querySelector('[data-type="count"]');
            const actionElement = dialog.element.querySelector('[data-type="action"]');
            const selectElement = dialog.element.querySelector("select");
            selectElement.addEventListener("change", () => {
                fetchPost("/api/riff/getRiffDueCards", {deckID: selectElement.value}, (cardsChangeResponse) => {
                    blocks = cardsChangeResponse.data;
                    index = 0;
                    if (blocks.length > 0) {
                        countElement.innerHTML = `<span>1</span>/${blocks.length}`;
                        countElement.classList.remove("fn__none");
                        editor.protyle.element.classList.remove("fn__none");
                        editor.protyle.element.nextElementSibling.classList.add("fn__none");
                        actionElement.classList.remove("fn__none");
                        fetchPost("/api/riff/renderRiffCard", {blockID: blocks[index].blockID}, (response) => {
                            onGet(response, editor.protyle, [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML]);
                        });
                    } else {
                        countElement.classList.add("fn__none");
                        editor.protyle.element.classList.add("fn__none");
                        editor.protyle.element.nextElementSibling.classList.remove("fn__none");
                        actionElement.classList.add("fn__none");
                    }
                });
            });
            dialog.element.addEventListener("click", (event) => {
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
                    editor.protyle.element.classList.toggle("b3-dialog__cardblock--show");
                    return;
                }
                if (["0", "1", "2", "3"].includes(type)) {
                    fetchPost("/api/riff/reviewRiffCard", {
                        deckID: blocks[index].deckID,
                        blockID: blocks[index].blockID,
                        rating: parseInt(type)
                    }, () => {
                        index++;
                        if (index > blocks.length - 1) {
                            countElement.classList.add("fn__none");
                            editor.protyle.element.classList.add("fn__none");
                            editor.protyle.element.nextElementSibling.classList.remove("fn__none");
                            actionElement.classList.add("fn__none");
                            return;
                        }
                        countElement.firstElementChild.innerHTML = (index + 1).toString();
                        fetchPost("/api/riff/renderRiffCard", {blockID: blocks[index].blockID}, (response) => {
                            onGet(response, editor.protyle, [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML]);
                        });
                    });
                }
            });
        });
    });
};
