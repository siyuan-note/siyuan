import {MenuItem} from "../menus/Menu";
import {fetchPost} from "../util/fetch";
import {focusByRange} from "../protyle/util/selection";
import {insertHTML} from "../protyle/util/insertHTML";

export const AIActions = (elements: Element[], protyle: IProtyle) => {
    const ids: string[] = []
    elements.forEach(item => {
        ids.push(item.getAttribute("data-node-id"))
    })
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconRefresh",
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
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_ja_JP,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_ko_KR,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_en_US,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_es_ES,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_fr_FR,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }, {
                label: window.siyuan.languages.aiTranslate_de_DE,
                click() {
                    fetchPost("/api/ai/chatGPTWithAction", {ids, action: "Translate"}, (response) => {
                        focusByRange(protyle.toolbar.range);
                        insertHTML(response.data, protyle, true);
                    });
                }
            }]
        }]
    }).element);
}
