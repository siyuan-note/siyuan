import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {MenuItem} from "../../menus/Menu";
import {
    copySubMenu,
    exportMd,
    movePathToMenu,
    openFileAttr,
    openFileWechatNotify,
} from "../../menus/commonMenuItem";
import {deleteFile} from "../../editor/deleteFile";
import {updateHotkeyTip} from "../util/compatibility";
/// #if !MOBILE
import {openBacklink, openGraph, openOutline} from "../../layout/dock/util";
import * as path from "path";
/// #endif
import {Constants} from "../../constants";
import {openCardByData} from "../../card/openCard";
import {viewCards} from "../../card/viewCards";
import {getDisplayName, getNotebookName, pathPosix, showFileInFolder} from "../../util/pathName";
import {makeCard, quickMakeCard} from "../../card/makeCard";
import {emitOpenMenu} from "../../plugin/EventBus";
import * as dayjs from "dayjs";
import {hideTooltip} from "../../dialog/tooltip";
import {popSearch} from "../../mobile/menu/search";
import {openSearch} from "../../search/spread";
import {openDocHistory} from "../../history/doc";
import {openNewWindowById} from "../../window/openNewWindow";
import {genImportMenu} from "../../menus/navigation";

export const openTitleMenu = (protyle: IProtyle, position: {
    x: number
    y: number
    isLeft?: boolean
}) => {
    hideTooltip();
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "titleMenu") {
        window.siyuan.menus.menu.remove();
        return;
    }
    fetchPost("/api/block/getDocInfo", {
        id: protyle.block.rootID
    }, (response) => {
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.element.setAttribute("data-name", "titleMenu");
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: copySubMenu(protyle.block.rootID)
        }).element);
        if (!protyle.disabled) {
            window.siyuan.menus.menu.append(movePathToMenu([protyle.path]));
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconTrashcan",
                label: window.siyuan.languages.delete,
                click: () => {
                    deleteFile(protyle.notebookId, protyle.path);
                }
            }).element);
        }
        /// #if !MOBILE
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconAlignCenter",
            label: window.siyuan.languages.outline,
            accelerator: window.siyuan.config.keymap.editor.general.outline.custom,
            click: () => {
                openOutline(protyle);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconLink",
            label: window.siyuan.languages.backlinks,
            accelerator: window.siyuan.config.keymap.editor.general.backlinks.custom,
            click: () => {
                openBacklink(protyle);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconGraph",
            label: window.siyuan.languages.graphView,
            accelerator: window.siyuan.config.keymap.editor.general.graphView.custom,
            click: () => {
                openGraph(protyle);
            }
        }).element);
        /// #endif
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.attr,
            icon: "iconAttr",
            accelerator: window.siyuan.config.keymap.editor.general.attr.custom + "/" + updateHotkeyTip("⇧Click"),
            click() {
                openFileAttr(response.data.ial);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.wechatReminder,
            icon: "iconMp",
            click() {
                openFileWechatNotify(protyle);
            }
        }).element);
        const riffCardMenu = [{
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.spaceRepetition,
            accelerator: window.siyuan.config.keymap.editor.general.spaceRepetition.custom,
            click: () => {
                fetchPost("/api/riff/getTreeRiffDueCards", {rootID: protyle.block.rootID}, (response) => {
                    openCardByData(protyle.app, response.data, "doc", protyle.block.rootID, response.data.name);
                });
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.manage,
            click: () => {
                fetchPost("/api/filetree/getHPathByID", {
                    id: protyle.block.rootID
                }, (response) => {
                    viewCards(protyle.app, protyle.block.rootID, pathPosix().join(getNotebookName(protyle.notebookId), (response.data)), "Tree");
                });
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.quickMakeCard,
            accelerator: window.siyuan.config.keymap.editor.general.quickMakeCard.custom,
            click: () => {
                let titleElement = protyle.title?.element;
                if (!titleElement) {
                    titleElement = document.createElement("div");
                    titleElement.setAttribute("data-node-id", protyle.block.rootID);
                    titleElement.setAttribute(Constants.CUSTOM_RIFF_DECKS, response.data.ial[Constants.CUSTOM_RIFF_DECKS]);
                }
                quickMakeCard(protyle, [titleElement]);
            }
        }];
        if (window.siyuan.config.flashcard.deck) {
            riffCardMenu.push({
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.addToDeck,
                click: () => {
                    makeCard(protyle.app, [protyle.block.rootID]);
                }
            });
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.riffCard,
            type: "submenu",
            icon: "iconRiffCard",
            submenu: riffCardMenu,
        }).element);

        if (protyle?.app?.plugins) {
            emitOpenMenu({
                plugins: protyle.app.plugins,
                type: "click-editortitleicon",
                detail: {
                    protyle,
                    data: response.data,
                },
                separatorPosition: "top",
            });
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.search,
            icon: "iconSearch",
            accelerator: window.siyuan.config.keymap.general.search.custom,
            async click() {
                const searchPath = getDisplayName(protyle.path, false, true);
                /// #if MOBILE
                const pathResponse = await fetchSyncPost("/api/filetree/getHPathByPath", {
                    notebook: protyle.notebookId,
                    path: searchPath + ".sy"
                });
                const localData = window.siyuan.storage[Constants.LOCAL_SEARCHDATA];
                popSearch(protyle.app, {
                    removed: localData.removed,
                    sort: localData.sort,
                    group: localData.group,
                    hasReplace: false,
                    method: localData.method,
                    hPath: pathPosix().join(getNotebookName(protyle.notebookId), pathResponse.data),
                    idPath: [pathPosix().join(protyle.notebookId, searchPath)],
                    k: localData.k,
                    r: localData.r,
                    page: 1,
                    types: Object.assign({}, localData.types)
                });
                /// #else
                openSearch({
                    app: protyle.app,
                    hotkey: window.siyuan.config.keymap.general.search.custom,
                    notebookId: protyle.notebookId,
                    searchPath
                });
                /// #endif
            }
        }).element);
        if (!protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.replace,
                accelerator: window.siyuan.config.keymap.general.replace.custom,
                icon: "iconReplace",
                async click() {
                    const searchPath = getDisplayName(protyle.path, false, true);
                    /// #if MOBILE
                    const pathResponse = await fetchSyncPost("/api/filetree/getHPathByPath", {
                        notebook: protyle.notebookId,
                        path: searchPath + ".sy"
                    });
                    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHDATA];
                    popSearch(protyle.app, {
                        removed: localData.removed,
                        sort: localData.sort,
                        group: localData.group,
                        hasReplace: true,
                        method: localData.method,
                        hPath: pathPosix().join(getNotebookName(protyle.notebookId), pathResponse.data),
                        idPath: [pathPosix().join(protyle.notebookId, searchPath)],
                        k: localData.k,
                        r: localData.r,
                        page: 1,
                        types: Object.assign({}, localData.types)
                    });
                    /// #else
                    openSearch({
                        app: protyle.app,
                        hotkey: window.siyuan.config.keymap.general.replace.custom,
                        notebookId: protyle.notebookId,
                        searchPath
                    });
                    /// #endif
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        /// #if !BROWSER
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.openByNewWindow,
            icon: "iconOpenWindow",
            click() {
                openNewWindowById(protyle.block.rootID);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.showInFolder,
            click: () => {
                showFileInFolder(path.join(window.siyuan.config.system.dataDir, protyle.notebookId, protyle.path));
            }
        }).element);
        /// #endif
        if (!protyle.disabled) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.fileHistory,
                icon: "iconHistory",
                click() {
                    openDocHistory({app: protyle.app, id: protyle.block.rootID, notebookId: protyle.notebookId, pathString: response.data.name});
                }
            }).element);
        }
        genImportMenu(protyle.notebookId, protyle.path);
        window.siyuan.menus.menu.append(exportMd(protyle.block.showAll ? protyle.block.id : protyle.block.rootID));
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            iconHTML: Constants.ZWSP,
            type: "readonly",
            label: `${window.siyuan.languages.modifiedAt} ${dayjs(response.data.ial.updated).format("YYYY-MM-DD HH:mm:ss")}<br>
${window.siyuan.languages.createdAt} ${dayjs(response.data.ial.id.substr(0, 14)).format("YYYY-MM-DD HH:mm:ss")}`
        }).element);
        /// #if MOBILE
        window.siyuan.menus.menu.fullscreen();
        /// #else
        window.siyuan.menus.menu.popup(position, position.isLeft);
        /// #endif
    });
};
