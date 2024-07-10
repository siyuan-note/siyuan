import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {Protyle} from "../protyle";
import {Constants} from "../constants";
import {onGet} from "../protyle/util/onGet";
import {hasClosestByAttribute, hasClosestByClassName} from "../protyle/util/hasClosest";
import {hideElements} from "../protyle/ui/hideElements";
import {isPaidUser, needSubscribe} from "../util/needSubscribe";
import {fullscreen} from "../protyle/breadcrumb/action";
import {MenuItem} from "../menus/Menu";
import {escapeHtml} from "../util/escape";
/// #if !MOBILE
import {openFile} from "../editor/util";
/// #endif
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import * as dayjs from "dayjs";
import {getDisplayName, movePathTo} from "../util/pathName";
import {App} from "../index";
import {resize} from "../protyle/util/resize";
import {setStorageVal} from "../protyle/util/compatibility";
import {focusByRange} from "../protyle/util/selection";
import {updateCardHV} from "./util";
import {showMessage} from "../dialog/message";
import {Menu} from "../plugin/Menu";
import {transaction} from "../protyle/wysiwyg/transaction";

const genCardCount = (cardsData: ICardData, allIndex = 0) => {
    let newIndex = 0;
    let oldIndex = 0;
    cardsData.cards.forEach((item, index) => {
        if (index > allIndex) {
            return;
        }
        if (item.state === 0) {
            newIndex++;
        } else {
            oldIndex++;
        }
    });
    return `<span class="ariaLabel" aria-label="${window.siyuan.languages.flashcardNewCard}">
    <span class="ft__error">${newIndex}</span> /
    <span class="ariaLabel ft__primary" aria-label="${window.siyuan.languages.flashcardNewCard}">${cardsData.unreviewedNewCardCount}</span>
</span>
<span class="fn__space"></span>+<span class="fn__space"></span>
<span class="ariaLabel" aria-label="${window.siyuan.languages.flashcardReviewCard}">
    <span class="ft__error">${oldIndex}</span> /
    <span class="ft__success">${cardsData.unreviewedOldCardCount}</span>
</span>`;
};

export const genCardHTML = (options: {
    id: string,
    cardType: TCardType,
    cardsData: ICardData,
    isTab: boolean
}) => {
    let iconsHTML: string;
    /// #if MOBILE
    iconsHTML = `<div class="toolbar toolbar--border">
    <svg class="toolbar__icon"><use xlink:href="#iconRiffCard"></use></svg>
    <span class="fn__flex-1 fn__flex-center toolbar__text">${window.siyuan.languages.riffCard}</span>
    <div data-type="count" class="${options.cardsData.cards.length === 0 ? "fn__none" : "fn__flex"}">${genCardCount(options.cardsData)}</span></div>
    <svg class="toolbar__icon" data-id="${options.id || ""}" data-cardtype="${options.cardType}" data-type="filter"><use xlink:href="#iconFilter"></use></svg>
    <svg class="toolbar__icon" data-type="more"><use xlink:href="#iconMore"></use></svg>
    <svg class="toolbar__icon" data-type="close"><use xlink:href="#iconCloseRound"></use></svg>
</div>`;
    /// #else
    iconsHTML = `<div class="block__icons">
        ${options.isTab ? '<div class="fn__flex-1"></div>' : `<div class="block__logo">
            <svg class="block__logoicon"><use xlink:href="#iconRiffCard"></use></svg>${window.siyuan.languages.riffCard}
        </div>`}
        <span class="fn__flex-1 resize__move" style="min-height: 100%"></span>
        <div data-type="count" class="ft__on-surface ft__smaller fn__flex-center${options.cardsData.cards.length === 0 ? " fn__none" : " fn__flex"}">${genCardCount(options.cardsData)}</span></div>
        <div class="fn__space"></div>
        <button data-id="${options.id || ""}" data-cardtype="${options.cardType}" data-type="filter" class="block__icon block__icon--show">
            <svg><use xlink:href="#iconFilter"></use></svg>
        </button>
        <div class="fn__space"></div>
        <div data-type="fullscreen" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show" aria-label="${window.siyuan.languages.fullscreen}">
            <svg><use xlink:href="#iconFullscreen"></use></svg>
        </div>
        <div class="fn__space"></div>
        <div data-type="more" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show" aria-label="${window.siyuan.languages.more}">
            <svg><use xlink:href="#iconMore"></use></svg>
        </div>
        <div class="fn__space${options.isTab ? " fn__none" : ""}"></div>
        <div data-type="sticktab" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show${options.isTab ? " fn__none" : ""}" aria-label="${window.siyuan.languages.openBy}">
            <svg><use xlink:href="#iconOpen"></use></svg>
        </div>
    </div>`;
    /// #endif
    return `<div class="card__main">
    ${iconsHTML}
    <div class="card__block fn__flex-1 ${options.cardsData.cards.length === 0 ? "fn__none" : ""} 
${window.siyuan.config.flashcard.mark ? "card__block--hidemark" : ""} 
${window.siyuan.config.flashcard.superBlock ? "card__block--hidesb" : ""} 
${window.siyuan.config.flashcard.heading ? "card__block--hideh" : ""} 
${window.siyuan.config.flashcard.list ? "card__block--hideli" : ""}" data-type="render"></div>
    <div class="card__empty card__empty--space${options.cardsData.cards.length === 0 ? "" : " fn__none"}" data-type="empty">
        <div>🔮</div>
        ${window.siyuan.languages.noDueCard}
    </div>
    <div class="fn__flex card__action${options.cardsData.cards.length === 0 ? " fn__none" : ""}">
        <button class="b3-button b3-button--cancel" disabled="disabled" data-type="-2" style="width: 25%;min-width: 86px;display: flex">
            <svg><use xlink:href="#iconLeft"></use></svg>
            (p / q)
        </button>
        <span class="fn__space"></span>
        <button data-type="-1" class="b3-button fn__flex-1">${window.siyuan.languages.cardShowAnswer} (${window.siyuan.languages.space} / ${window.siyuan.languages.enterKey})</button>
    </div>
    <div class="fn__flex card__action fn__none">
        <div>
            <span>${window.siyuan.languages.nextRound}</span>
            <button data-type="-3" aria-label="0 / x" class="b3-button b3-button--cancel b3-tooltips__n b3-tooltips">
                <div class="card__icon">💤</div>
                ${window.siyuan.languages.skip} (0)
            </button>
        </div>
        <div>
            <span></span>
            <button data-type="1" aria-label="1 / j / a" class="b3-button b3-button--error b3-tooltips__n b3-tooltips">
                <div class="card__icon">🙈</div>
                ${window.siyuan.languages.cardRatingAgain} (1)
            </button>
        </div>
        <div>
            <span></span>
            <button data-type="2" aria-label="2 / k / s" class="b3-button b3-button--warning b3-tooltips__n b3-tooltips">
                <div class="card__icon">😬</div>
                ${window.siyuan.languages.cardRatingHard} (2)
            </button>
        </div>
        <div>
            <span></span>
            <button data-type="3" aria-label="3 / l / d / ${window.siyuan.languages.space} / ${window.siyuan.languages.enterKey}" class="b3-button b3-button--info b3-tooltips__n b3-tooltips">
                <div class="card__icon">😊</div>
                ${window.siyuan.languages.cardRatingGood} (3)
            </button>
        </div>
        <div>
            <span></span>
            <button data-type="4" aria-label="4 / ; / f" class="b3-button b3-button--success b3-tooltips__n b3-tooltips">
                <div class="card__icon">🌈</div>
                ${window.siyuan.languages.cardRatingEasy} (4)
            </button>
        </div>
    </div>
</div>`;
};

export const bindCardEvent = async (options: {
    app: App,
    element: Element,
    title?: string,
    cardsData: ICardData
    cardType: TCardType,
    id?: string,
    dialog?: Dialog,
    index?: number
}) => {
    if (window.siyuan.storage[Constants.LOCAL_FLASHCARD].fullscreen) {
        fullscreen(options.element.querySelector(".card__main"),
            options.element.querySelector('[data-type="fullscreen"]'));
    }
    let index = 0;
    if (typeof options.index === "number") {
        index = options.index;
    }
    const editor = new Protyle(options.app, options.element.querySelector("[data-type='render']") as HTMLElement, {
        blockId: "",
        action: [Constants.CB_GET_ALL],
        render: {
            background: false,
            gutter: true,
            breadcrumbDocName: true,
        },
        typewriterMode: false
    });
    if (window.siyuan.mobile) {
        window.siyuan.mobile.popEditor = editor;
    }
    if (options.cardsData.cards.length > 0) {
        fetchPost("/api/block/getDocInfo", {
            id: options.cardsData.cards[index].blockID,
        }, (response) => {
            editor.protyle.wysiwyg.renderCustom(response.data.ial);
            fetchPost("/api/filetree/getDoc", {
                id: options.cardsData.cards[index].blockID,
                mode: 0,
                size: Constants.SIZE_GET_MAX
            }, (response) => {
                onGet({
                    updateReadonly: true,
                    data: response,
                    protyle: editor.protyle,
                    action: response.data.rootID === response.data.id ? [Constants.CB_GET_HTML] : [Constants.CB_GET_ALL, Constants.CB_GET_HTML],
                });
            });
        });
    }
    options.element.setAttribute("data-key", Constants.DIALOG_OPENCARD);
    const actionElements = options.element.querySelectorAll(".card__action");
    if (options.index === 0) {
        actionElements[0].firstElementChild.setAttribute("disabled", "disabled");
    } else {
        actionElements[0].firstElementChild.removeAttribute("disabled");
    }
    const countElement = options.element.querySelector('[data-type="count"]');
    const filterElement = options.element.querySelector('[data-type="filter"]');
    const fetchNewRound = () => {
        const currentCardType = filterElement.getAttribute("data-cardtype");
        const docId = filterElement.getAttribute("data-id");
        fetchPost(currentCardType === "all" ? "/api/riff/getRiffDueCards" :
            (currentCardType === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
            rootID: docId,
            deckID: docId,
            notebook: docId,
        }, async (treeCards) => {
            index = 0;
            options.cardsData = treeCards.data;
            for (let i = 0; i < options.app.plugins.length; i++) {
                options.cardsData = await options.app.plugins[i].updateCards(options.cardsData);
            }
            if (options.cardsData.cards.length > 0) {
                nextCard({
                    countElement,
                    editor,
                    actionElements,
                    index,
                    cardsData: options.cardsData
                });
            } else {
                allDone(countElement, editor, actionElements);
            }
        });
    };

    countElement.innerHTML = genCardCount(options.cardsData, index);
    options.element.addEventListener("click", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        let type = "";
        const currentCard = options.cardsData.cards[index];
        const docId = filterElement.getAttribute("data-id");
        if (typeof event.detail === "string") {
            if (["1", "j", "a"].includes(event.detail)) {
                type = "1";
            } else if (["2", "k", "s"].includes(event.detail)) {
                type = "2";
            } else if (["3", "l", "d"].includes(event.detail)) {
                type = "3";
            } else if (["4", ";", "f"].includes(event.detail)) {
                type = "4";
            } else if ([" ", "enter"].includes(event.detail)) {
                type = "-1";
            } else if (["p", "q"].includes(event.detail)) {
                type = "-2";
            } else if (["0", "x"].includes(event.detail)) {
                type = "-3";
            }
        } else {
            const fullscreenElement = hasClosestByAttribute(target, "data-type", "fullscreen");
            if (fullscreenElement) {
                fullscreen(options.element.querySelector(".card__main"),
                    options.element.querySelector('[data-type="fullscreen"]'));
                resize(editor.protyle);
                window.siyuan.storage[Constants.LOCAL_FLASHCARD].fullscreen = !window.siyuan.storage[Constants.LOCAL_FLASHCARD].fullscreen;
                setStorageVal(Constants.LOCAL_FLASHCARD, window.siyuan.storage[Constants.LOCAL_FLASHCARD]);
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const moreElement = hasClosestByAttribute(target, "data-type", "more");
            if (moreElement) {
                event.stopPropagation();
                event.preventDefault();
                if (filterElement.getAttribute("data-cardtype") === "all" && filterElement.getAttribute("data-id")) {
                    showMessage(window.siyuan.languages.noSupportTip);
                    return;
                }
                const menu = new Menu();
                menu.addItem({
                    icon: "iconClock",
                    label: window.siyuan.languages.setDueTime,
                    click() {
                        const timedialog = new Dialog({
                            title: window.siyuan.languages.setDueTime,
                            content: `<div class="b3-dialog__content">
    <div class="b3-label__text">${window.siyuan.languages.showCardDay}</div>
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" value="1" type="number" step="1" min="1">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                            width: isMobile() ? "92vw" : "520px",
                        });
                        const inputElement = timedialog.element.querySelector("input") as HTMLInputElement;
                        const btnsElement = timedialog.element.querySelectorAll(".b3-button");
                        timedialog.bindInput(inputElement, () => {
                            (btnsElement[1] as HTMLButtonElement).click();
                        });
                        inputElement.focus();
                        inputElement.select();
                        btnsElement[0].addEventListener("click", () => {
                            timedialog.destroy();
                        });
                        btnsElement[1].addEventListener("click", () => {
                            fetchPost("/api/riff/batchSetRiffCardsDueTime", {
                                cardDues: [{
                                    id: currentCard.cardID,
                                    due: dayjs().day(parseInt(inputElement.value)).format("YYYYMMDDHHmmss")
                                }]
                            }, () => {
                                actionElements[0].classList.add("fn__none");
                                actionElements[1].classList.remove("fn__none");
                                if (currentCard.state === 0) {
                                    options.cardsData.unreviewedNewCardCount--;
                                } else {
                                    options.cardsData.unreviewedOldCardCount--;
                                }
                                options.element.dispatchEvent(new CustomEvent("click", {detail: "0"}));
                                options.cardsData.cards.splice(index, 1);
                                index--;
                                timedialog.destroy();
                            });
                        });
                    }
                });
                if (currentCard.state !== 0) {
                    menu.addItem({
                        icon: "iconRefresh",
                        label: window.siyuan.languages.reset,
                        click() {
                            fetchPost("/api/riff/resetRiffCards", {
                                type: filterElement.getAttribute("data-cardtype"),
                                id: docId,
                                deckID: Constants.QUICK_DECK_ID,
                                blockIDs: [currentCard.blockID],
                            }, () => {
                                const minLang = window.siyuan.languages._time["1m"].replace("%s", "");
                                currentCard.lapses = 0;
                                currentCard.lastReview = -62135596800000;
                                currentCard.reps = 0;
                                currentCard.state = 0;
                                currentCard.nextDues = {
                                    1: minLang,
                                    2: minLang.replace("1", "5"),
                                    3: minLang.replace("1", "10"),
                                    4: window.siyuan.languages._time["1d"].replace("%s", "").replace("1", "6")
                                };
                                actionElements[1].querySelectorAll(".b3-button").forEach((element, btnIndex) => {
                                    element.previousElementSibling.textContent = currentCard.nextDues[btnIndex];
                                });
                                options.cardsData.unreviewedOldCardCount--;
                                options.cardsData.unreviewedNewCardCount++;
                                countElement.innerHTML = genCardCount(options.cardsData, index);
                            });
                        }
                    });
                }
                menu.addItem({
                    icon: "iconTrashcan",
                    label: `${window.siyuan.languages.remove} <b>${window.siyuan.languages.riffCard}</b>`,
                    click() {
                        actionElements[0].classList.add("fn__none");
                        actionElements[1].classList.remove("fn__none");
                        if (currentCard.state === 0) {
                            options.cardsData.unreviewedNewCardCount--;
                        } else {
                            options.cardsData.unreviewedOldCardCount--;
                        }
                        options.element.dispatchEvent(new CustomEvent("click", {detail: "0"}));
                        transaction(undefined, [{
                            action: "removeFlashcards",
                            deckID: Constants.QUICK_DECK_ID,
                            blockIDs: [currentCard.blockID]
                        }]);
                        options.cardsData.cards.splice(index, 1);
                        index--;
                    }
                });
                menu.addSeparator();
                menu.addItem({
                    iconHTML: "",
                    type: "readonly",
                    label: `<div class="fn__flex">
    <div class="fn__flex-1 ft__breakword">${window.siyuan.languages.forgetCount}</div>
    <div class="fn__space"></div>
    <div>${currentCard.lapses}</div>
</div><div class="fn__flex">
    <div class="fn__flex-1 ft__breakword">${window.siyuan.languages.revisionCount}</div>
    <div class="fn__space"></div>
    <div>${currentCard.reps}</div>
</div><div class="fn__flex">
    <div class="fn__flex-1 ft__breakword">${window.siyuan.languages.cardStatus}</div>
    <div class="fn__space"></div>
    <div class="${currentCard.state === 0 ? "ft__primary" : "ft__success"}">${currentCard.state === 0 ? window.siyuan.languages.flashcardNewCard : window.siyuan.languages.flashcardReviewCard}</div>
</div><div class="fn__flex${currentCard.lastReview > 0 ? "" : " fn__none"}">
    <div class="fn__flex-1 ft__breakword" style="width: 170px;">${window.siyuan.languages.lastReviewTime}</div>
    <div class="fn__space"></div>
    <div>${dayjs(currentCard.lastReview).format("YYYY-MM-DD")}</div>
</div>`,
                });
                /// #if MOBILE
                menu.fullscreen();
                /// #else
                const rect = moreElement.getBoundingClientRect();
                menu.open({
                    x: rect.left,
                    y: rect.bottom
                });
                /// #endif
                return;
            }
            /// #if !MOBILE
            const sticktabElement = hasClosestByAttribute(target, "data-type", "sticktab");
            if (sticktabElement) {
                const stickMenu = new Menu();
                stickMenu.addItem({
                    icon: "iconLayoutRight",
                    label: window.siyuan.languages.insertRight,
                    click() {
                        openFile({
                            app: options.app,
                            position: "right",
                            custom: {
                                icon: "iconRiffCard",
                                title: window.siyuan.languages.spaceRepetition,
                                data: {
                                    cardsData: options.cardsData,
                                    index,
                                    cardType: filterElement.getAttribute("data-cardtype") as TCardType,
                                    id: docId,
                                    title: options.title
                                },
                                id: "siyuan-card"
                            },
                        });
                        options.dialog.destroy();
                    }
                });
                /// #if !BROWSER
                stickMenu.addItem({
                    icon: "iconOpenWindow",
                    label: window.siyuan.languages.openByNewWindow,
                    click() {
                        const json = {
                            "title": window.siyuan.languages.spaceRepetition,
                            "icon": "iconRiffCard",
                            "instance": "Tab",
                            "children": {
                                "instance": "Custom",
                                "customModelType": "siyuan-card",
                                "customModelData": {
                                    "cardType": filterElement.getAttribute("data-cardtype"),
                                    "id": docId,
                                    "title": options.title
                                }
                            }
                        };
                        ipcRenderer.send(Constants.SIYUAN_OPEN_WINDOW, {
                            // 需要 encode， 否则 https://github.com/siyuan-note/siyuan/issues/9343
                            url: `${window.location.protocol}//${window.location.host}/stage/build/app/window.html?v=${Constants.SIYUAN_VERSION}&json=${encodeURIComponent(JSON.stringify(json))}`
                        });
                        options.dialog.destroy();
                    }
                });
                /// #endif
                const rect = sticktabElement.getBoundingClientRect();
                stickMenu.open({
                    x: rect.left,
                    y: rect.bottom
                });
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            /// #endif
            const closeElement = hasClosestByAttribute(target, "data-type", "close");
            if (closeElement) {
                if (options.dialog) {
                    options.dialog.destroy();
                }
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const filterTempElement = hasClosestByAttribute(target, "data-type", "filter");
            if (filterTempElement) {
                fetchPost("/api/riff/getRiffDecks", {}, (response) => {
                    window.siyuan.menus.menu.remove();
                    window.siyuan.menus.menu.append(new MenuItem({
                        iconHTML: "",
                        label: window.siyuan.languages.all,
                        click() {
                            filterElement.setAttribute("data-id", "");
                            filterElement.setAttribute("data-cardtype", "all");
                            fetchNewRound();
                        },
                    }).element);
                    window.siyuan.menus.menu.append(new MenuItem({
                        iconHTML: "",
                        label: window.siyuan.languages.fileTree,
                        click() {
                            movePathTo((toPath, toNotebook) => {
                                filterElement.setAttribute("data-id", toPath[0] === "/" ? toNotebook[0] : getDisplayName(toPath[0], true, true));
                                filterElement.setAttribute("data-cardtype", toPath[0] === "/" ? "notebook" : "doc");
                                fetchNewRound();
                            }, [], undefined, window.siyuan.languages.specifyPath, true);
                        }
                    }).element);
                    if (options.title || response.data.length > 0) {
                        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                    }
                    if (options.title) {
                        window.siyuan.menus.menu.append(new MenuItem({
                            iconHTML: "",
                            label: escapeHtml(options.title),
                            click() {
                                filterElement.setAttribute("data-id", options.id);
                                filterElement.setAttribute("data-cardtype", options.cardType);
                                fetchNewRound();
                            },
                        }).element);
                        if (response.data.length > 0) {
                            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                        }
                    }
                    response.data.forEach((deck: { id: string, name: string }) => {
                        window.siyuan.menus.menu.append(new MenuItem({
                            iconHTML: "",
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
        if (!type || !currentCard) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        hideElements(["toolbar", "hint", "util", "gutter"], editor.protyle);
        if (type === "-1") {    // 显示答案
            if (actionElements[0].classList.contains("fn__none")) {
                type = "3";
            } else {
                editor.protyle.element.classList.remove("card__block--hidemark", "card__block--hideli", "card__block--hidesb", "card__block--hideh");
                actionElements[0].classList.add("fn__none");
                actionElements[1].querySelectorAll(".b3-button").forEach((element, btnIndex) => {
                    element.previousElementSibling.textContent = currentCard.nextDues[btnIndex];
                });
                actionElements[1].classList.remove("fn__none");
                emitEvent(options.app, currentCard, type);
                return;
            }
        } else if (type === "-2") {    // 上一步
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
                    cardsData: options.cardsData
                });
                emitEvent(options.app, options.cardsData.cards[index + 1], type);
            }
            return;
        }
        if (["1", "2", "3", "4", "-3"].includes(type) && actionElements[0].classList.contains("fn__none")) {
            fetchPost(type === "-3" ? "/api/riff/skipReviewRiffCard" : "/api/riff/reviewRiffCard", {
                deckID: currentCard.deckID,
                cardID: currentCard.cardID,
                rating: parseInt(type),
                reviewedCards: options.cardsData.cards
            }, () => {
                /// #if MOBILE
                if (type !== "-3" &&
                    ((0 !== window.siyuan.config.sync.provider && isPaidUser()) ||
                        (0 === window.siyuan.config.sync.provider && !needSubscribe(""))) &&
                    window.siyuan.config.repo.key && window.siyuan.config.sync.enabled) {
                    document.getElementById("toolbarSync").classList.remove("fn__none");
                }
                /// #endif
                index++;
                if (index > options.cardsData.cards.length - 1) {
                    const currentCardType = filterElement.getAttribute("data-cardtype");
                    fetchPost(currentCardType === "all" ? "/api/riff/getRiffDueCards" :
                        (currentCardType === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
                        rootID: docId,
                        deckID: docId,
                        notebook: docId,
                        reviewedCards: options.cardsData.cards
                    }, async (result) => {
                        emitEvent(options.app, options.cardsData.cards[index - 1], type);
                        index = 0;
                        options.cardsData = result.data;
                        for (let i = 0; i < options.app.plugins.length; i++) {
                            options.cardsData = await options.app.plugins[i].updateCards(options.cardsData);
                        }
                        if (options.cardsData.cards.length === 0) {
                            if (options.cardsData.unreviewedCount > 0) {
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
                                cardsData: options.cardsData
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
                    cardsData: options.cardsData
                });
                emitEvent(options.app, options.cardsData.cards[index - 1], type);
            });
        }
    });
    return editor;
};

const emitEvent = (app: App, card: ICard, type: string) => {
    app.plugins.forEach(item => {
        item.eventBus.emit("click-flashcard-action", {
            type,
            card
        });
    });
};

export const openCard = (app: App) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    fetchPost("/api/riff/getRiffDueCards", {deckID: ""}, (cardsResponse) => {
        openCardByData(app, cardsResponse.data, "all");
    });
};

export const openCardByData = async (app: App, cardsData: ICardData, cardType: TCardType, id?: string, title?: string) => {
    const exit = window.siyuan.dialogs.find(item => {
        if (item.element.getAttribute("data-key") === Constants.DIALOG_OPENCARD) {
            item.destroy();
            return true;
        }
    });
    if (exit) {
        return;
    }
    let lastRange: Range;
    if (getSelection().rangeCount > 0) {
        lastRange = getSelection().getRangeAt(0);
    }
    for (let i = 0; i < app.plugins.length; i++) {
        cardsData = await app.plugins[i].updateCards(cardsData);
    }
    const dialog = new Dialog({
        positionId: Constants.DIALOG_OPENCARD,
        content: genCardHTML({id, cardType, cardsData, isTab: false}),
        width: isMobile() ? "100vw" : "80vw",
        height: isMobile() ? "100vh" : "70vh",
        destroyCallback() {
            if (editor) {
                editor.destroy();
                if (window.siyuan.mobile) {
                    window.siyuan.mobile.popEditor = null;
                }
            }
            if (lastRange) {
                focusByRange(lastRange);
            }
        },
        resizeCallback(type: string) {
            if (type !== "d" && type !== "t" && editor) {
                editor.resize();
            }
        }
    });
    (dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement).style.backgroundColor = "var(--b3-theme-background)";
    (dialog.element.querySelector(".b3-dialog__container") as HTMLElement).style.maxWidth = "1024px";
    const editor = await bindCardEvent({
        app,
        element: dialog.element,
        cardsData,
        title,
        id,
        cardType,
        dialog
    });
    editor.resize();
    dialog.editors = {
        card: editor
    };
    /// #if !MOBILE
    const focusElement = dialog.element.querySelector(".block__icons button.block__icon") as HTMLElement;
    focusElement.focus();
    const range = document.createRange();
    range.selectNodeContents(focusElement);
    range.collapse();
    focusByRange(range);
    /// #endif
    updateCardHV();
};

const nextCard = (options: {
    countElement: Element,
    editor: Protyle,
    actionElements: NodeListOf<Element>,
    index: number,
    cardsData: ICardData
}) => {
    options.editor.protyle.element.classList.add("card__block--hide");
    if (window.siyuan.config.flashcard.superBlock) {
        options.editor.protyle.element.classList.add("card__block--hidesb");
    }
    if (window.siyuan.config.flashcard.heading) {
        options.editor.protyle.element.classList.add("card__block--hideh");
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
    options.countElement.innerHTML = genCardCount(options.cardsData, options.index);
    options.countElement.classList.remove("fn__none");
    if (options.index === 0) {
        options.actionElements[0].firstElementChild.setAttribute("disabled", "disabled");
    } else {
        options.actionElements[0].firstElementChild.removeAttribute("disabled");
    }
    fetchPost("/api/block/getDocInfo", {
        id: options.cardsData.cards[options.index].blockID,
    }, (response) => {
        options.editor.protyle.wysiwyg.renderCustom(response.data.ial);
        fetchPost("/api/filetree/getDoc", {
            id: options.cardsData.cards[options.index].blockID,
            mode: 0,
            size: Constants.SIZE_GET_MAX
        }, (response) => {
            onGet({
                updateReadonly: true,
                data: response,
                protyle: options.editor.protyle,
                action: response.data.rootID === response.data.id ? [Constants.CB_GET_HTML] : [Constants.CB_GET_ALL, Constants.CB_GET_HTML],
            });
        });
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
