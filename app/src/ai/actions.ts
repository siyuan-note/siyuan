import {MenuItem} from "../menus/Menu";
import {fetchPost} from "../util/fetch";
import {focusByRange} from "../protyle/util/selection";
import {insertHTML} from "../protyle/util/insertHTML";
import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";

export const AIActions = (elements: Element[], protyle: IProtyle) => {
    const ids: string[] = [];
    elements.forEach(item => {
        ids.push(item.getAttribute("data-node-id"));
    });
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconSparkles",
        label: window.siyuan.languages.ai,
        type: "submenu",
        submenu: [{
            label: window.siyuan.languages.aiContinueWrite,
            click() {
                fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Continue writing"}, (response) => {
                    focusByRange(protyle.toolbar.range);
                    insertHTML(response.data, protyle, true);
                });
            }
        }, {
            label: window.siyuan.languages.aiTranslate,
            type: "submenu",
            submenu: [{
                label: window.siyuan.languages.aiTranslate_zh_CN,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate as follows to [zh_CN]"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_ja_JP,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate as follows to [ja_JP]"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_ko_KR,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate as follows to [ko_KR]"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_en_US,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate as follows to [en_US]"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_es_ES,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate as follows to [es_ES]"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_fr_FR,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate as follows to [fr_FR]"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_de_DE,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate as follows to [de_DE]"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }]
        }, {
            label: window.siyuan.languages.aiExtractSummary,
            click() {
                fetchPost("/api/ai/chatGPTWithAction", {ids, action: window.siyuan.languages.aiExtractSummary}, (response) => {
                    focusByRange(protyle.toolbar.range);
                    insertHTML(response.data, protyle, true);
                });
            }
        }, {
            label: window.siyuan.languages.aiBrainStorm,
            click() {
                fetchPost("/api/ai/chatGPTWithAction", {ids, action: window.siyuan.languages.aiBrainStorm}, (response) => {
                    focusByRange(protyle.toolbar.range);
                    insertHTML(response.data, protyle, true);
                });
            }
        }, {
            label: window.siyuan.languages.aiFixGrammarSpell,
            click() {
                fetchPost("/api/ai/chatGPTWithAction", {ids, action: window.siyuan.languages.aiFixGrammarSpell}, (response) => {
                    focusByRange(protyle.toolbar.range);
                    insertHTML(response.data, protyle, true);
                });
            }
        },{
            label: window.siyuan.languages.aiCustomAction,
            click() {
                const dialog = new Dialog({
                    title: window.siyuan.languages.aiCustomAction,
                    content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value=""></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                    width: isMobile() ? "80vw" : "520px",
                });
                const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
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
                        focusByRange(protyle.toolbar.range);
                        let respContent = "";
                        if (response.data && "" !== response.data) {
                            respContent = "\n\n" + response.data;
                        }
                        insertHTML(`${inputElement.value}${respContent}`, protyle, true);
                    });
                });
            }
        }]
    }).element);
};
