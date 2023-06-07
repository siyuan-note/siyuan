import {MenuItem} from "../menus/Menu";
import {fetchPost} from "../util/fetch";
import {setLastNodeRange} from "../protyle/util/selection";
import {insertHTML} from "../protyle/util/insertHTML";
import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {blockRender} from "../protyle/render/blockRender";
import {processRender} from "../protyle/util/processCode";
import {highlightRender} from "../protyle/render/highlightRender";
import {Constants} from "../constants";
import {setStorageVal} from "../protyle/util/compatibility";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {escapeAttr, escapeHtml} from "../util/escape";

export const fillContent = (protyle: IProtyle, data: string, elements: Element[]) => {
    if (!data) {
        return;
    }
    setLastNodeRange(getContenteditableElement(elements[elements.length - 1]), protyle.toolbar.range);
    protyle.toolbar.range.collapse(true);
    insertHTML(data, protyle, true, true);
    blockRender(protyle, protyle.wysiwyg.element);
    processRender(protyle.wysiwyg.element);
    highlightRender(protyle.wysiwyg.element);
};

export const AIActions = (elements: Element[], protyle: IProtyle) => {
    const ids: string[] = [];
    elements.forEach(item => {
        ids.push(item.getAttribute("data-node-id"));
    });
    const customMenu: IMenu[] = [{
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.aiCustomAction,
        click() {
            const dialog = new Dialog({
                title: window.siyuan.languages.aiCustomAction,
                content: `<div class="b3-dialog__content"><textarea class="b3-text-field fn__block"></textarea></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                width: isMobile() ? "92vw" : "520px",
            });
            const inputElement = dialog.element.querySelector("textarea");
            const btnsElement = dialog.element.querySelectorAll(".b3-button");
            dialog.bindInput(inputElement, () => {
                (btnsElement[1] as HTMLButtonElement).click();
            });
            inputElement.focus();
            btnsElement[0].addEventListener("click", () => {
                dialog.destroy();
            });
            btnsElement[1].addEventListener("click", () => {
                fetchPost("/api/ai/chatGPTWithAction", {
                    ids,
                    action: inputElement.value,
                }, (response) => {
                    dialog.destroy();
                    fillContent(protyle, response.data, elements);
                });
            });
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: `${window.siyuan.languages.aiCustomAction} & ${window.siyuan.languages.save}`,
        click() {
            const dialog = new Dialog({
                title: window.siyuan.languages.save,
                content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" value="" placeholder="${window.siyuan.languages.memo}">
    <div class="fn__hr"></div>
    <textarea class="b3-text-field fn__block" placeholder="${window.siyuan.languages.aiCustomAction}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                width: isMobile() ? "92vw" : "520px",
            });
            const inputElement = dialog.element.querySelector("input");
            const btnsElement = dialog.element.querySelectorAll(".b3-button");
            dialog.bindInput(inputElement, () => {
                (btnsElement[1] as HTMLButtonElement).click();
            });
            inputElement.focus();
            btnsElement[0].addEventListener("click", () => {
                dialog.destroy();
            });
            btnsElement[1].addEventListener("click", () => {
                const memo = dialog.element.querySelector("textarea").value;
                window.siyuan.storage[Constants.LOCAL_AI].push({
                    name: inputElement.value,
                    memo
                });
                setStorageVal(Constants.LOCAL_AI, window.siyuan.storage[Constants.LOCAL_AI]);
                fetchPost("/api/ai/chatGPTWithAction", {
                    ids,
                    action: memo,
                }, (response) => {
                    dialog.destroy();
                    fillContent(protyle, response.data, elements);
                });
                dialog.destroy();
            });
        }
    }];
    window.siyuan.storage[Constants.LOCAL_AI].forEach((item: { name: string, memo: string }) => {
        customMenu.push({
            iconHTML: Constants.ZWSP,
            action: "iconCloseRound",
            label: `<div aria-label="${escapeAttr(item.memo)}" data-type="a">${escapeHtml(item.name)}</div>`,
            bind: (element) => {
                element.addEventListener("click", (event) => {
                    if (hasClosestByClassName(event.target as Element, "b3-menu__action")) {
                        window.siyuan.storage[Constants.LOCAL_AI].find((subItem: {
                            name: string,
                            memo: string
                        }, index: number) => {
                            if (element.querySelector(".b3-menu__label").textContent.trim() === subItem.name) {
                                window.siyuan.storage[Constants.LOCAL_AI].splice(index, 1);
                                setStorageVal(Constants.LOCAL_AI, window.siyuan.storage[Constants.LOCAL_AI]);
                                element.remove();
                                return true;
                            }
                        });
                    } else {
                        fetchPost("/api/ai/chatGPTWithAction", {
                            ids,
                            action: item.memo,
                        }, (response) => {
                            fillContent(protyle, response.data, elements);
                        });
                        window.siyuan.menus.menu.remove();
                    }
                    event.preventDefault();
                    event.stopPropagation();
                });
            }
        });
    });
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconSparkles",
        label: window.siyuan.languages.ai,
        type: "submenu",
        submenu: [{
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.aiContinueWrite,
            click() {
                fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Continue writing"}, (response) => {
                    fillContent(protyle, response.data, elements);
                });
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.aiTranslate,
            type: "submenu",
            submenu: [{
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.aiTranslate_zh_Hans,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {
                        ids,
                        action: "Translate as follows to [zh-Hans]"
                    }, (response) => {
                        fillContent(protyle, response.data, elements);
                    });
                }
            }, {
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.aiTranslate_zh_Hant,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {
                        ids,
                        action: "Translate as follows to [zh-Hant]"
                    }, (response) => {
                        fillContent(protyle, response.data, elements);
                    });
                }
            }, {
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.aiTranslate_ja_JP,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {
                        ids,
                        action: "Translate as follows to [ja-JP]"
                    }, (response) => {
                        fillContent(protyle, response.data, elements);
                    });
                }
            }, {
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.aiTranslate_ko_KR,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {
                        ids,
                        action: "Translate as follows to [ko-KR]"
                    }, (response) => {
                        fillContent(protyle, response.data, elements);
                    });
                }
            }, {
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.aiTranslate_en_US,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {
                        ids,
                        action: "Translate as follows to [en-US]"
                    }, (response) => {
                        fillContent(protyle, response.data, elements);
                    });
                }
            }, {
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.aiTranslate_es_ES,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {
                        ids,
                        action: "Translate as follows to [es-ES]"
                    }, (response) => {
                        fillContent(protyle, response.data, elements);
                    });
                }
            }, {
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.aiTranslate_fr_FR,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {
                        ids,
                        action: "Translate as follows to [fr-FR]"
                    }, (response) => {
                        fillContent(protyle, response.data, elements);
                    });
                }
            }, {
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.aiTranslate_de_DE,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {
                        ids,
                        action: "Translate as follows to [de-DE]"
                    }, (response) => {
                        fillContent(protyle, response.data, elements);
                    });
                }
            }]
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.aiExtractSummary,
            click() {
                fetchPost("/api/ai/chatGPTWithAction", {
                    ids,
                    action: window.siyuan.languages.aiExtractSummary
                }, (response) => {
                    fillContent(protyle, response.data, elements);
                });
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.aiBrainStorm,
            click() {
                fetchPost("/api/ai/chatGPTWithAction", {
                    ids,
                    action: window.siyuan.languages.aiBrainStorm
                }, (response) => {
                    fillContent(protyle, response.data, elements);
                });
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.aiFixGrammarSpell,
            click() {
                fetchPost("/api/ai/chatGPTWithAction", {
                    ids,
                    action: window.siyuan.languages.aiFixGrammarSpell
                }, (response) => {
                    fillContent(protyle, response.data, elements);
                });
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.custom,
            type: "submenu",
            submenu: customMenu
        }]
    }).element);
};
