import type {DocInfo} from "../../types/api";
import type {App} from "../../index";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {MenuItem} from "../../menus/Menu";
import {copySubMenu, exportMd, movePathToMenu, openFileAttr, openFileWechatNotify,} from "../../menus/commonMenuItem";
import {deleteFile} from "../../editor/deleteFile";
import {updateHotkeyTip, writeClipboardData} from "../util/compatibility";
/// #if !MOBILE
import {openBacklink, openGraph, openOutline} from "../../layout/dock/util";
import * as path from "path";
/// #else
import {openMobileFileById} from "../../mobile/editor";
/// #endif
import {Constants} from "../../constants";
import {openCardByData} from "../../card/openCard";
import {viewCards} from "../../card/viewCards";
import {getDisplayName, getNotebookName, isEncryptedBox, pathPosix, useShell} from "../../util/pathName";
import {makeCard, quickMakeCard} from "../../card/makeCard";
import {emitOpenMenu} from "../../plugin/EventBus";
import * as dayjs from "dayjs";
import {popSearch} from "../../mobile/menu/search";
import {openSearch} from "../../search/spread";
import {openDocHistory} from "../../history/doc";
import {openNewWindowById} from "../../window/openNewWindow";
import {transferBlockRef} from "../../menus/block";
import {addBlocksToDatabase, addEditorToDatabase} from "../render/av/addToDatabase";
import {openFileById} from "../../editor/util";
import {hasTopClosestByClassName} from "../util/hasClosest";
import {showMessage} from "../../dialog/message";
import {buildBlockDOMClipboardRichData} from "../util/blockDOMClipboard";
import {buildWebClipboardHTML} from "../util/clipboardData";
import {exportImage} from "../export/util";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {getLute} from "../render/setLute";
import {transaction} from "../wysiwyg/transaction";

export const openDocumentMenu = (options: {
    app: App,
    id: string,
    notebookId: string,
    path: string,
    docInfo: DocInfo,
    target: HTMLElement,
    position: IPosition,
    from: string,
    disabled: boolean,
    protyle?: IProtyle,
    blockId?: string,
    showAll?: boolean,
    restoreKeyboard?: () => void,
}) => {
    const {app, id, notebookId, path: pathString, docInfo, target, position, from, disabled,
        protyle, blockId = id, showAll = false, restoreKeyboard} = options;
    const contentID = showAll ? blockId : id;
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_TITLE);
    const isBoxDoc = notebookId === id;
    const popoverElement = hasTopClosestByClassName(target, "block__popover", true);
    window.siyuan.menus.menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover-" + from : "app-" + from);
    const submenu = copySubMenu([id], true, undefined, contentID);
    submenu.push({
        id: "copyAsPNG",
        iconHTML: "",
        label: window.siyuan.languages.copyAsPNG,
        ignore: !getHostCapabilities().documentImportExport,
        click() {
            exportImage(contentID, true);
        }
    });
    submenu.push({
        id: "copyDoc",
        iconHTML: "",
        label: window.siyuan.languages.copyDoc,
        accelerator: undefined,
        click: async () => {
            const [responseHTML, responseText] = await Promise.all([
                fetchSyncPost("/api/block/getBlockDOM", {
                    id,
                    notebook: notebookId,
                }),
                fetchSyncPost("/api/export/exportMdContent", {
                    id,
                    refMode: 3,
                    embedMode: 1,
                    yfm: false,
                    fillCSSVar: false,
                    adjustHeadingLevel: false
                })
            ]);

            if (responseHTML.code !== 0 || responseText.code !== 0) {
                return;
            }
            const lute = protyle?.lute || getLute({
                emojis: {}, emojiSite: "/emojis", headingAnchor: false,
                sanitize: true, listStyle: false, paragraphBeginningSpace: false,
            });
            const {textHTML, textSiyuan} = buildBlockDOMClipboardRichData(lute, responseHTML.data.dom);
            const result = await writeClipboardData({
                textPlain: responseText.data.content,
                textHTML: buildWebClipboardHTML(textHTML, textSiyuan),
            });
            if (result.error) {
                console.log("Write document clipboard error:", result.error);
            }
            if (result.status === "failed") {
                showMessage(window.siyuan.languages.clipboardPermissionDenied, 7000, "error");
                return;
            }

            showMessage(window.siyuan.languages.copied);
        }
    });
    window.siyuan.menus.menu.append(new MenuItem({
        id: "copy",
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        type: "submenu",
        submenu,
    }).element);
    if (!disabled) {
        if (!isBoxDoc) {
            window.siyuan.menus.menu.append(movePathToMenu([pathString], [notebookId]));
        }
        const range = getSelection().rangeCount > 0 ? getSelection().getRangeAt(0) : undefined;
        window.siyuan.menus.menu.append(new MenuItem({
            id: "addToDatabase",
            label: window.siyuan.languages.addToDatabase,
            accelerator: window.siyuan.config.keymap.general.addToDatabase.custom,
            icon: "iconDatabase",
            click: () => {
                if (protyle) {
                    addEditorToDatabase(protyle, range, "title");
                } else {
                    addBlocksToDatabase([id], target, position);
                }
            }
        }).element);
        if (!isBoxDoc) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "delete",
                icon: "iconTrashcan",
                label: window.siyuan.languages.delete,
                click: () => {
                    deleteFile(notebookId, pathString);
                }
            }).element);
        }
    }
    /// #if !MOBILE
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "outline",
        icon: "iconOutline",
        label: window.siyuan.languages.outline,
        accelerator: window.siyuan.config.keymap.editor.general.outline.custom,
        click: () => {
            openOutline({
                app,
                rootId: id,
                notebookId,
                title: protyle ? (protyle.options.render.title ?
                    (protyle.title.editElement.textContent || window.siyuan.languages.untitled) : "") : docInfo.name,
                isPreview: protyle ? !protyle.preview.element.classList.contains("fn__none") : false,
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "backlinks",
        icon: "iconLink",
        label: window.siyuan.languages.backlinks,
        accelerator: window.siyuan.config.keymap.editor.general.backlinks.custom,
        click: () => {
            openBacklink({
                app,
                blockId,
                rootId: id,
                notebookId,
                useBlockId: showAll,
                title: protyle ? (protyle.title ?
                    (protyle.title.editElement.textContent || window.siyuan.languages.untitled) : null) : docInfo.name,
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "graphView",
        icon: "iconGraph",
        label: window.siyuan.languages.graphView,
        accelerator: window.siyuan.config.keymap.editor.general.graphView.custom,
        click: () => {
            openGraph({
                app,
                blockId,
                rootId: id,
                notebookId,
                useBlockId: showAll,
                title: protyle ? (protyle.title ?
                    (protyle.title.editElement.textContent || window.siyuan.languages.untitled) : null) : docInfo.name,
            });
        }
    }).element);
    /// #endif
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "attr",
        label: window.siyuan.languages.attr,
        icon: "iconAttr",
        accelerator: window.siyuan.config.keymap.editor.general.attr.custom + "/" + updateHotkeyTip("⇧" + window.siyuan.languages.click),
        click() {
            openFileAttr(docInfo.ial, "bookmark", protyle);
        }
    }).element);
    if (!window.siyuan.config.readonly) {
        if (window.siyuan.config.cloudRegion === 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "wechatReminder",
                label: window.siyuan.languages.wechatReminder,
                icon: "iconMp",
                click() {
                    openFileWechatNotify(id, notebookId);
                }
            }).element);
        }
        const isCardMade = !!docInfo.ial[Constants.CUSTOM_RIFF_DECKS];
        if (!isEncryptedBox(notebookId)) {
            const riffCardMenu: IMenu[] = [{
                id: "spaceRepetition",
                iconHTML: "",
                label: window.siyuan.languages.spaceRepetition,
                accelerator: window.siyuan.config.keymap.editor.general.spaceRepetition.custom,
                click: () => {
                    fetchPost("/api/riff/getTreeRiffDueCards", {rootID: id}, (response) => {
                        openCardByData(app, response.data, "doc", id);
                    });
                }
            }, {
                id: "manage",
                iconHTML: "",
                label: window.siyuan.languages.manage,
                click: () => {
                    fetchPost("/api/filetree/getHPathByID", {
                        id
                    }, (response) => {
                        viewCards(app, id, pathPosix().join(getNotebookName(notebookId), response.data), "Tree");
                    });
                }
            }, {
                id: isCardMade ? "removeCard" : "quickMakeCard",
                iconHTML: "",
                label: isCardMade ? window.siyuan.languages.removeCard : window.siyuan.languages.quickMakeCard,
                accelerator: window.siyuan.config.keymap.editor.general.quickMakeCard.custom,
                click: () => {
                    if (!protyle) {
                        const remove = (docInfo.ial[Constants.CUSTOM_RIFF_DECKS] || "").includes(Constants.QUICK_DECK_ID);
                        transaction(undefined, [{
                            action: remove ? "removeFlashcards" : "addFlashcards",
                            deckID: Constants.QUICK_DECK_ID,
                            blockIDs: [id],
                        }], [{
                            action: remove ? "addFlashcards" : "removeFlashcards",
                            deckID: Constants.QUICK_DECK_ID,
                            blockIDs: [id],
                        }]);
                        return;
                    }
                    let titleElement = protyle.title?.element;
                    if (!titleElement) {
                        titleElement = document.createElement("div");
                        titleElement.setAttribute("data-node-id", id);
                        titleElement.setAttribute(Constants.CUSTOM_RIFF_DECKS, docInfo.ial[Constants.CUSTOM_RIFF_DECKS]);
                    }
                    quickMakeCard(protyle, [titleElement]);
                }
            }];
            if (window.siyuan.config.flashcard.deck) {
                riffCardMenu.push({
                    id: "addToDeck",
                    iconHTML: "",
                    label: window.siyuan.languages.addToDeck,
                    click: () => {
                        makeCard(app, [id]);
                    }
                });
            }
            window.siyuan.menus.menu.append(new MenuItem({
                id: "riffCard",
                label: window.siyuan.languages.riffCard,
                type: "submenu",
                icon: "iconRiffCard",
                submenu: riffCardMenu,
            }).element);
        }
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "search",
        label: window.siyuan.languages.search,
        icon: "iconSearch",
        accelerator: window.siyuan.config.keymap.general.search.custom,
        async click() {
            const searchPath = isBoxDoc ? "" : getDisplayName(pathString, false, true);
            /// #if MOBILE
            let hPath = getNotebookName(notebookId);
            if (!isBoxDoc) {
                const pathResponse = await fetchSyncPost("/api/filetree/getHPathByPath", {
                    notebook: notebookId,
                    path: searchPath + ".sy"
                });
                if (pathResponse.code !== 0) {
                    return;
                }
                hPath = pathPosix().join(hPath, pathResponse.data);
            }
            popSearch(app, {
                hasReplace: false,
                hPath,
                idPath: [isBoxDoc ? notebookId : pathPosix().join(notebookId, searchPath)],
                page: 1,
            });
            /// #else
            openSearch({
                app,
                hotkey: Constants.DIALOG_SEARCH,
                notebookId,
                searchPath
            });
            /// #endif
        }
    }).element);
    if (!disabled) {
        transferBlockRef(id);
    }
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_3", type: "separator"}).element);
    if (!protyle?.model) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "openBy",
            label: window.siyuan.languages.openBy,
            icon: "iconOpen",
            click() {
                /// #if !MOBILE
                openFileById({
                    app,
                    id: blockId,
                    action: id !== blockId ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_CONTEXT],
                });
                /// #else
                openMobileFileById(app, blockId, id !== blockId ? [Constants.CB_GET_ALL] : [Constants.CB_GET_CONTEXT]);
                /// #endif
            }
        }).element);
    }
    /// #if !BROWSER
    window.siyuan.menus.menu.append(new MenuItem({
        id: "openByNewWindow",
        label: window.siyuan.languages.openByNewWindow,
        icon: "iconOpenWindow",
        click() {
            openNewWindowById(id);
        }
    }).element);
    if (getHostCapabilities().localFileSystem) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "showInFolder",
            icon: "iconFolder",
            label: window.siyuan.languages.showInFolder,
            click: () => {
                useShell("showItemInFolder", path.join(window.siyuan.config.system.dataDir, notebookId, pathString));
            }
        }).element);
    }
    /// #endif
    if (!window.siyuan.config.readonly && !window.siyuan.isPublish &&
        !protyle?.options.history?.created && !protyle?.options.history?.snapshot &&
        target.getAttribute("disabled-forever") !== "true") {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "fileHistory",
            label: window.siyuan.languages.dataHistory,
            icon: "iconHistory",
            click() {
                openDocHistory({
                    app,
                    id,
                    notebookId,
                    pathString: docInfo.name,
                    readonly: disabled,
                });
            }
        }).element);
    }
    window.siyuan.menus.menu.append(exportMd(contentID));

    window.siyuan.menus.menu.append(new MenuItem({id: "separator_4", type: "separator"}).element);
    if (protyle) {
        emitOpenMenu({
            type: "click-editortitleicon",
            detail: {
                protyle,
                data: docInfo,
            },
            separatorPosition: "bottom",
        });
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "updateAndCreatedAt",
        iconHTML: "",
        type: "readonly",
        // 不能换行，否则移动端间距过大
        label: `${window.siyuan.languages.modifiedAt} ${dayjs(docInfo.ial.updated).format("YYYY-MM-DD HH:mm:ss")}<br>${window.siyuan.languages.createdAt} ${dayjs(docInfo.ial.id.substr(0, 14)).format("YYYY-MM-DD HH:mm:ss")}`
    }).element);
    /// #if MOBILE
    window.siyuan.menus.menu.fullscreen("all", restoreKeyboard);
    /// #else
    window.siyuan.menus.menu.popup(position);
    /// #endif
};
