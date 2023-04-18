import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {Protyle} from "../protyle";
import {Constants} from "../constants";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {hasClosestByAttribute, hasClosestByClassName} from "../protyle/util/hasClosest";
import {hideElements} from "../protyle/ui/hideElements";
import {needSubscribe} from "../util/needSubscribe";
import {fullscreen} from "../protyle/breadcrumb/action";
import {MenuItem} from "../menus/Menu";
import {escapeHtml} from "../util/escape";
import {getDisplayName, movePathTo} from "../util/pathName";

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
    fetchPost("/api/riff/getRiffDueCards", {deckID: ""}, (cardsResponse) => {
        openCardByData(cardsResponse.data, "all");
    });
};

export const openCardByData = (cardsData: {
    cards: ICard[],
    unreviewedCount: number
}, cardType: "doc" | "notebook" | "all", id?: string, title?: string) => {
    let blocks = cardsData.cards;
    let index = 0;
    const dialog = new Dialog({
        content: `<div class="card__main">
    <div class="card__header">
        <span class="fn__flex-1 fn__flex-center">${window.siyuan.languages.riffCard}</span>
        <span class="fn__space"></span>
        <div data-type="count" class="ft__on-surface ft__smaller fn__flex-center${blocks.length === 0 ? " fn__none" : ""}">1/${blocks.length}</span></div>
        <div class="fn__space"></div>
        <div data-id="${id || ""}" data-cardtype="${cardType}" data-type="filter" class="block__icon block__icon--show">
            <svg><use xlink:href="#iconFilter"></use></svg>
        </div>
        <div class="fn__space"></div>
        ${isMobile() ? `<div data-type="close" class="block__icon block__icon--show">
            <svg><use xlink:href="#iconCloseRound"></use></svg>
        </div>` : `<div data-type="fullscreen" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show" aria-label="${window.siyuan.languages.fullscreen}">
            <svg><use xlink:href="#iconFullscreen"></use></svg>
        </div>`}
    </div>
    <div class="card__block fn__flex-1${blocks.length === 0 ? " fn__none" : ""}${window.siyuan.config.flashcard.mark ? " card__block--hidemark" : ""}${window.siyuan.config.flashcard.superBlock ? " card__block--hidesb" : ""}${window.siyuan.config.flashcard.list ? " card__block--hideli" : ""}" data-type="render"></div>
    <div class="card__empty card__empty--space${blocks.length === 0 ? "" : " fn__none"}" data-type="empty">
        <div>🔮</div>
        ${window.siyuan.languages.noDueCard}
    </div>
    <div class="fn__flex card__action${blocks.length === 0 ? " fn__none" : ""}">
        <button class="b3-button b3-button--cancel" disabled="disabled" data-type="-2" style="width: 25%;min-width: 86px;display: flex">
            <svg><use xlink:href="#iconLeft"></use></svg>
            (p)
        </button>
        <span class="fn__space"></span>
        <button data-type="-1" class="b3-button fn__flex-1">${window.siyuan.languages.cardShowAnswer} (${window.siyuan.languages.space})</button>
    </div>
    <div class="fn__flex card__action fn__none">
        <div>
            <span>${window.siyuan.languages.nextRound}</span>
            <button data-type="-3" aria-label="0" class="b3-button b3-button--cancel b3-tooltips__s b3-tooltips">
                <div>💤</div>
                ${window.siyuan.languages.skip} (0)
            </button>
        </div>
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
        width: isMobile() ? "100vw" : "80vw",
        height: isMobile() ? "100vh" : "70vh",
        destroyCallback() {
            if (editor) {
                editor.destroy();
                if (window.siyuan.mobile) {
                    window.siyuan.mobile.popEditor = null;
                }
            }
        }
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
    if (window.siyuan.mobile) {
        window.siyuan.mobile.popEditor = editor;
    }
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
    const filterElement = dialog.element.querySelector('[data-type="filter"]');
    const fetchNewRound = () => {
        const currentCardType = filterElement.getAttribute("data-cardtype");
        fetchPost(currentCardType === "all" ? "/api/riff/getRiffDueCards" :
            (currentCardType === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
            rootID: filterElement.getAttribute("data-id"),
            deckID: filterElement.getAttribute("data-id"),
            notebook: filterElement.getAttribute("data-id"),
        }, (treeCards) => {
            index = 0;
            blocks = treeCards.data.cards;
            if (blocks.length > 0) {
                nextCard({
                    countElement,
                    editor,
                    actionElements,
                    index,
                    blocks
                });
            } else {
                allDone(countElement, editor, actionElements);
            }
        });
    };

    dialog.element.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
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
            } else if (event.detail === " ") {
                type = "-1";
            } else if (event.detail === "p") {
                type = "-2";
            } else if (event.detail === "0") {
                type = "-3";
            }
        } else {
            const fullscreenElement = hasClosestByAttribute(target, "data-type", "fullscreen");
            if (fullscreenElement) {
                fullscreen(dialog.element.querySelector(".card__main"),
                    dialog.element.querySelector('[data-type="fullscreen"]'));
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const closeElement = hasClosestByAttribute(target, "data-type", "close");
            if (closeElement) {
                dialog.destroy();
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const filterTempElement = hasClosestByAttribute(target, "data-type", "filter");
            if (filterTempElement) {
                fetchPost("/api/riff/getRiffDecks", {}, (response) => {
                    window.siyuan.menus.menu.remove();
                    window.siyuan.menus.menu.append(new MenuItem({
                        iconHTML: Constants.ZWSP,
                        label: window.siyuan.languages.all,
                        click() {
                            filterElement.setAttribute("data-id", "");
                            filterElement.setAttribute("data-cardtype", "all");
                            fetchNewRound();
                        },
                    }).element);
                    window.siyuan.menus.menu.append(new MenuItem({
                        iconHTML: Constants.ZWSP,
                        label: window.siyuan.languages.fileTree,
                        click() {
                            movePathTo((toPath, toNotebook) => {
                                filterElement.setAttribute("data-id", toPath[0] === "/" ? toNotebook[0] : getDisplayName(toPath[0], true, true));
                                filterElement.setAttribute("data-cardtype", toPath[0] === "/" ? "notebook" : "doc");
                                fetchNewRound();
                            }, [], undefined, window.siyuan.languages.specifyPath, true);
                        }
                    }).element);
                    if (title || response.data.length > 0) {
                        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                    }
                    if (title) {
                        window.siyuan.menus.menu.append(new MenuItem({
                            iconHTML: Constants.ZWSP,
                            label: escapeHtml(title),
                            click() {
                                filterElement.setAttribute("data-id", id);
                                filterElement.setAttribute("data-cardtype", cardType);
                                fetchNewRound();
                            },
                        }).element);
                        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                    }
                    response.data.forEach((deck: { id: string, name: string }) => {
                        window.siyuan.menus.menu.append(new MenuItem({
                            iconHTML: Constants.ZWSP,
                            label: escapeHtml(deck.name),
                            click() {
                                filterElement.setAttribute("data-id", deck.id);
                                filterElement.setAttribute("data-cardtype", "all");
                                fetchNewRound();
                            },
                        }).element);
                    });
                    const filterRect = filterTempElement.getBoundingClientRect();
                    window.siyuan.menus.menu.popup({x: filterRect.left, y: filterRect.bottom});
                });
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            const newroundElement = hasClosestByAttribute(target, "data-type", "newround");
            if (newroundElement) {
                fetchNewRound();
                event.stopPropagation();
                event.preventDefault();
                return;
            }
        }
        if (!type) {
            const buttonElement = hasClosestByClassName(target, "b3-button");
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
        if (type === "-1") {    // 显示答案
            if (actionElements[0].classList.contains("fn__none")) {
                return;
            }
            editor.protyle.element.classList.remove("card__block--hidemark", "card__block--hideli", "card__block--hidesb");
            actionElements[0].classList.add("fn__none");
            actionElements[1].querySelectorAll(".b3-button").forEach((element, btnIndex) => {
                if (btnIndex !== 0) {
                    element.previousElementSibling.textContent = blocks[index].nextDues[btnIndex - 1];
                }
            });
            actionElements[1].classList.remove("fn__none");
            return;
        }
        if (type === "-2") {    // 上一步
            if (actionElements[0].classList.contains("fn__none")) {
                return;
            }
            if (index > 0) {
                index--;
                nextCard({
                    countElement,
                    editor,
                    actionElements,
                    index,
                    blocks
                });
            }
            return;
        }
        if (["0", "1", "2", "3", "-3"].includes(type) && actionElements[0].classList.contains("fn__none")) {
            fetchPost(type === "-3" ? "/api/riff/skipReviewRiffCard" : "/api/riff/reviewRiffCard", {
                deckID: blocks[index].deckID,
                cardID: blocks[index].cardID,
                rating: parseInt(type),
                reviewedCards: blocks
            }, () => {
                /// #if MOBILE
                if (type !== "-3" &&
                    (0 !== window.siyuan.config.sync.provider || (0 === window.siyuan.config.sync.provider && !needSubscribe(""))) &&
                    window.siyuan.config.repo.key && window.siyuan.config.sync.enabled) {
                    document.getElementById("toolbarSync").classList.remove("fn__none");
                }
                /// #endif
                index++;
                if (index > blocks.length - 1) {
                    const currentCardType = filterElement.getAttribute("data-cardtype");
                    fetchPost(currentCardType === "all" ? "/api/riff/getRiffDueCards" :
                        (currentCardType === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
                        rootID: filterElement.getAttribute("data-id"),
                        deckID: filterElement.getAttribute("data-id"),
                        notebook: filterElement.getAttribute("data-id"),
                        reviewedCards: blocks
                    }, (result) => {
                        index = 0;
                        blocks = result.data.cards;
                        if (blocks.length === 0) {
                            if (result.data.unreviewedCount > 0) {
                                newRound(countElement, editor, actionElements, result.data.unreviewedCount);
                            } else {
                                allDone(countElement, editor, actionElements);
                            }
                        } else {
                            nextCard({
                                countElement,
                                editor,
                                actionElements,
                                index,
                                blocks
                            });
                        }
                    });
                    return;
                }
                nextCard({
                    countElement,
                    editor,
                    actionElements,
                    index,
                    blocks
                });
            });
        }
    });
};

const nextCard = (options: {
    countElement: Element, editor: Protyle, actionElements: NodeListOf<Element>, index: number, blocks: ICard[]
}) => {
    options.editor.protyle.element.classList.add("card__block--hide");
    if (window.siyuan.config.flashcard.superBlock) {
        options.editor.protyle.element.classList.add("card__block--hidesb");
    }
    if (window.siyuan.config.flashcard.list) {
        options.editor.protyle.element.classList.add("card__block--hideli");
    }
    if (window.siyuan.config.flashcard.mark) {
        options.editor.protyle.element.classList.add("card__block--hidemark");
    }
    options.actionElements[0].classList.remove("fn__none");
    options.actionElements[1].classList.add("fn__none");
    options.editor.protyle.element.classList.remove("fn__none");
    options.editor.protyle.element.nextElementSibling.classList.add("fn__none");
    options.countElement.innerHTML = `${options.index + 1}/${options.blocks.length}`;
    options.countElement.classList.remove("fn__none");
    if (options.index === 0) {
        options.actionElements[0].firstElementChild.setAttribute("disabled", "disabled");
    } else {
        options.actionElements[0].firstElementChild.removeAttribute("disabled");
    }
    fetchPost("/api/filetree/getDoc", {
        id: options.blocks[options.index].blockID,
        mode: 0,
        size: Constants.SIZE_GET_MAX
    }, (response) => {
        onGet(response, options.editor.protyle, [Constants.CB_GET_ALL, Constants.CB_GET_HTML]);
    });
};

const allDone = (countElement: Element, editor: Protyle, actionElements: NodeListOf<Element>) => {
    countElement.classList.add("fn__none");
    editor.protyle.element.classList.add("fn__none");
    const emptyElement = editor.protyle.element.nextElementSibling;
    emptyElement.innerHTML = `<div>🔮</div>${window.siyuan.languages.noDueCard}`;
    emptyElement.classList.remove("fn__none");
    actionElements[0].classList.add("fn__none");
    actionElements[1].classList.add("fn__none");
};

const newRound = (countElement: Element, editor: Protyle, actionElements: NodeListOf<Element>, unreviewedCount: number) => {
    countElement.classList.add("fn__none");
    editor.protyle.element.classList.add("fn__none");
    const emptyElement = editor.protyle.element.nextElementSibling;
    emptyElement.innerHTML = `<div>♻️ </div>
<span>${window.siyuan.languages.continueReview2.replace("${count}", unreviewedCount)}</span>
<div class="fn__hr"></div>
<button data-type="newround" class="b3-button fn__size200">${window.siyuan.languages.continueReview1}</button>`;
    emptyElement.classList.remove("fn__none");
    actionElements[0].classList.add("fn__none");
    actionElements[1].classList.add("fn__none");
};
