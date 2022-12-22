import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {Protyle} from "../protyle";
import {Constants} from "../constants";
import {disabledProtyle, onGet} from "../protyle/util/onGet";

export const openCard = () => {
    let decksHTML = '<option value="">All</option>';
    fetchPost("/api/riff/getRiffDecks", {}, (response) => {
        response.data.forEach((deck: { id: string, name: string }) => {
            decksHTML += `<option value="${deck.id}">${deck.name}</option>`;
        })
        fetchPost("/api/riff/getRiffDueCards", {deckID: ""}, (cardsResponse) => {
            let blocks = cardsResponse.data;
            let countHTML = ''
            let index = 0
            if (blocks.length > 0) {
                countHTML = `<span>1</span>/${blocks.length}`
            } else {
                countHTML = window.siyuan.languages.noDueCard
            }
            const dialog = new Dialog({
                title: window.siyuan.languages.riffCard,
                content: `<div class="fn__flex-column b3-dialog__content" style="box-sizing: border-box">
    <div class="fn__flex">
        <select class="b3-select fn__flex-1">${decksHTML}</select>
        <span class="fn__space"></span>
        <div class="ft__on-surface ft__smaller fn__flex-center" data-type="count">
            ${countHTML}
        </div>
    </div>
    <div class="fn__flex-1" data-type="render"></div>
    <div class="fn__flex">
        <button data-type="0" class="b3-button b3-button--white">Again Rating (A)</button>
        <span class="fn__flex-1"></span>
        <button data-type="1" class="b3-button b3-button--outline">Hard (H)</button>
        <span class="fn__flex-1"></span>
        <button data-type="2" class="b3-button b3-button--cancel">Good (G)</button>
        <span class="fn__flex-1"></span>
        <button data-type="3" class="b3-button">Easy (E)</button>
    </div>
</div>`,
                width: isMobile() ? "80vw" : "50vw",
                height: "70vh",
            })
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
            fetchPost("/api/riff/renderRiffCard", {id: blocks[index]}, (response) => {
                onGet(response, editor.protyle, [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML]);
            });
            dialog.element.setAttribute("data-key", window.siyuan.config.keymap.general.riffCard.custom)
            const countElement = dialog.element.querySelector('[data-type="count"]')
            const selectElement = dialog.element.querySelector("select")
            selectElement.addEventListener("change", (event) => {
                fetchPost("/api/riff/getRiffDueCards", {deckID: selectElement.value}, (cardsChangeResponse) => {
                    blocks = cardsChangeResponse.data;
                    index = 0
                    let countHTML = ''
                    if (blocks.length > 0) {
                        countHTML = `<span>1</span>/${blocks.length}`
                    } else {
                        countHTML = window.siyuan.languages.noDueCard
                    }
                    countElement.innerHTML = countHTML;
                    fetchPost("/api/riff/renderRiffCard", {id: blocks[index]}, (response) => {
                        onGet(response, editor.protyle, [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML]);
                    });
                })
            })
            dialog.element.addEventListener("click", (event) => {
                let target = event.target as HTMLElement;
                while (target && !target.isSameNode(dialog.element)) {
                    const type = target.getAttribute("data-type");
                    if (["0", "1", "2", "3"].includes(type)) {
                        fetchPost("/api/riff/reviewRiffCard", {
                            deckID: selectElement.value,
                            blockID: blocks[index],
                            rating: parseInt(type)
                        }, (response) => {
                            index++
                            if (index > blocks.length - 1) {
                                countElement.innerHTML = window.siyuan.languages.noDueCard
                                editor.protyle.element.classList.add("fn__none")
                                return;
                            }
                            countElement.firstElementChild.innerHTML = index.toString()
                            fetchPost("/api/riff/renderRiffCard", {id: blocks[index]}, (response) => {
                                onGet(response, editor.protyle, [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML]);
                            });
                        })
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    }
                    target = target.parentElement;
                }
            })
        })
    })
}

export const matchCardKey = (event: KeyboardEvent) => {

}
