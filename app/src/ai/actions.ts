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
import {escapeAriaLabel, escapeHtml} from "../util/escape";
import {showMessage} from "../dialog/message";

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
                content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" value="" placeholder="${window.siyuan.languages.memo}">
    <div class="fn__hr"></div>
    <textarea class="b3-text-field fn__block" placeholder="${window.siyuan.languages.aiCustomAction}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.use}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.save}</button>
</div>`,
                width: isMobile() ? "92vw" : "520px",
            });
            const nameElement = dialog.element.querySelector("input");
            const customElement = dialog.element.querySelector("textarea");
            const btnsElement = dialog.element.querySelectorAll(".b3-button");
            dialog.bindInput(customElement, () => {
                (btnsElement[1] as HTMLButtonElement).click();
            });
            btnsElement[0].addEventListener("click", () => {
                dialog.destroy();
            });
            btnsElement[1].addEventListener("click", () => {
                if (!customElement.value) {
                    showMessage(window.siyuan.languages["_kernel"][142]);
                    return;
                }
                fetchPost("/api/ai/chatGPTWithAction", {
                    ids,
                    action: customElement.value,
                }, (response) => {
                    dialog.destroy();
                    fillContent(protyle, response.data, elements);
                });
            });
            btnsElement[2].addEventListener("click", () => {
                if (!nameElement.value && !customElement.value) {
                    showMessage(window.siyuan.languages["_kernel"][142]);
                    return;
                }
                window.siyuan.storage[Constants.LOCAL_AI].push({
                    name: nameElement.value,
                    memo: customElement.value
                });
                setStorageVal(Constants.LOCAL_AI, window.siyuan.storage[Constants.LOCAL_AI]);
                dialog.destroy();
            });
            nameElement.focus();
        }
    }];
    if (window.siyuan.storage[Constants.LOCAL_AI].length > 0) {
        customMenu.push({type: "separator"});
    }
    window.siyuan.storage[Constants.LOCAL_AI].forEach((item: { name: string, memo: string }) => {
        customMenu.push({
            iconHTML: Constants.ZWSP,
            action: "iconEdit",
            label: `<div aria-label="${escapeAriaLabel(item.memo)}" data-type="a">${escapeHtml(item.name)}</div>`,
            bind: (element) => {
                element.addEventListener("click", (event) => {
                    if (hasClosestByClassName(event.target as Element, "b3-menu__action")) {
                        const dialog = new Dialog({
                            title: window.siyuan.languages.update,
                            content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.memo}">
    <div class="fn__hr"></div>
    <textarea class="b3-text-field fn__block" placeholder="${window.siyuan.languages.aiCustomAction}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--error">${window.siyuan.languages.delete}</button>
</div>`,
                            width: isMobile() ? "92vw" : "520px",
                        });
                        const nameElement = dialog.element.querySelector("input");
                        nameElement.value = item.name;
                        const customElement = dialog.element.querySelector("textarea");
                        const btnsElement = dialog.element.querySelectorAll(".b3-button");
                        dialog.bindInput(customElement, () => {
                            (btnsElement[1] as HTMLButtonElement).click();
                        });
                        customElement.value = item.memo;
                        btnsElement[0].addEventListener("click", () => {
                            dialog.destroy();
                        });
                        btnsElement[1].addEventListener("click", () => {
                            window.siyuan.storage[Constants.LOCAL_AI].find((subItem: {
                                name: string,
                                memo: string
                            }) => {
                                if (item.name === subItem.name && item.memo === subItem.memo) {
                                    item.name = nameElement.value;
                                    item.memo = customElement.value;
                                    setStorageVal(Constants.LOCAL_AI, window.siyuan.storage[Constants.LOCAL_AI]);
                                    return true;
                                }
                            });
                            dialog.destroy();
                        });
                        btnsElement[2].addEventListener("click", () => {
                            window.siyuan.storage[Constants.LOCAL_AI].find((subItem: {
                                name: string,
                                memo: string
                            }, index: number) => {
                                if (item.name === subItem.name && item.memo === subItem.memo) {
                                    window.siyuan.storage[Constants.LOCAL_AI].splice(index, 1);
                                    setStorageVal(Constants.LOCAL_AI, window.siyuan.storage[Constants.LOCAL_AI]);
                                    return true;
                                }
                            });
                            dialog.destroy();
                        });
                        nameElement.focus();
                    } else {
                        fetchPost("/api/ai/chatGPTWithAction", {
                            ids,
                            action: item.memo,
                        }, (response) => {
                            fillContent(protyle, response.data, elements);
                        });
                    }
                    window.siyuan.menus.menu.remove();
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
