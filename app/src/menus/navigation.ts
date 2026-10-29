import {saveNotebookConf, saveNotebookConfSync} from "../config/util/resourceConfig";
import type {BlockQueryRequestInput} from "../types/api";
import {copySubMenu, exportMd, movePathToMenu, openFileAttr, renameMenu,} from "./commonMenuItem";
/// #if !BROWSER
import {FileFilter, ipcRenderer} from "electron";
import * as path from "path";
/// #endif
import {MenuItem} from "./Menu";
import {getDisplayName, getNotebookName, isEncryptedBox, pathPosix, useShell} from "../util/pathName";
import {pinnedDocIDs, updatePinnedDocs} from "../util/pinnedDocs";
import {showMessage} from "../dialog/message";
import {confirmDialog} from "../dialog/confirmDialog";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {ContractFormData} from "../util/contractFormData";
import {onGetnotebookconf} from "./onGetnotebookconf";
import {canCleanEncryptedNotebookAssets, openEncryptedAssetsCleanup} from "../config/encryptedAssets";
/// #if !MOBILE
import {openSearch} from "../search/spread";
/// #else
import {closePanel} from "../mobile/util/closePanel";
import {popSearch} from "../mobile/menu/search";
/// #endif
import {Constants} from "../constants";
import {newFileInTree} from "../util/newFile";
import {hasClosestByTag} from "../protyle/util/hasClosest";
import {deleteFile, deleteDocTreeItems, deleteNotebooks} from "../editor/deleteFile";
/// #if !MOBILE
import {openFileById} from "../editor/util";
/// #endif
import {getDockByType} from "../layout/tabUtil";
import {Files} from "../layout/dock/Files";
import {getDocTreeController} from "../layout/dock/docTree/DocTreeController";
import type {IDocTreeItem} from "../layout/dock/docTree/types";
import {openCardByData} from "../card/openCard";
import {viewCards} from "../card/viewCards";
import type {App} from "../index";
import {openDocHistory} from "../history/doc";
import {openEditorTab} from "./util";
import {makeCard} from "../card/makeCard";
import {transaction} from "../protyle/wysiwyg/transaction";
import {emitOpenMenu} from "../plugin/EventBus";
import {isPhablet, saveExportFile} from "../protyle/util/compatibility";
import {exportMarkdownZip} from "../protyle/export/exportMd";
import {addBlocksToDatabase} from "../protyle/render/av/addToDatabase";
import {getDocTreeActionItems, getDocTreeMenuItems, getDocTreeTopPaths} from "./navigationSelection";
import {
    FILE_TREE_CHILDREN_SORT_MODE,
    getConfiguredChildrenSortMode,
    isCustomFileTreeList
} from "../util/fileTreeSort";
import {getHostCapabilities} from "../util/hostCapabilities";
/// #if MOBILE
import {openEmojiPanel} from "../emoji";
import {openMobileFileById, openMobileFileByIdInNewTab} from "../mobile/editor";
/// #endif

const confirmEncryptedExport = (notebookId: string, callback: () => void) => {
    if (!isEncryptedBox(notebookId)) {
        callback();
        return;
    }
    confirmDialog(window.siyuan.languages.export, window.siyuan.languages.encryptedExportRiskTip, callback);
};

const openFileTreeSearch = async (app: App, notebookId: string, pathString: string, hasReplace: boolean) => {
    const searchPath = getDisplayName(pathString, false, true);
    /// #if MOBILE
    const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
        notebook: notebookId,
        path: searchPath + ".sy"
    });
    if (response.code !== 0 || typeof response.data !== "string") {
        return;
    }
    popSearch(app, {
        hasReplace,
        hPath: pathPosix().join(getNotebookName(notebookId), response.data),
        idPath: [pathPosix().join(notebookId, searchPath)],
        page: 1,
    });
    /// #else
    openSearch({
        app,
        hotkey: hasReplace ? Constants.DIALOG_REPLACE : Constants.DIALOG_SEARCH,
        notebookId,
        searchPath
    });
    /// #endif
};

type IDocTreeMenuItem = Pick<IDocTreeItem, "id" | "notebookId" | "path" | "kind" | "name" | "occurrenceKey"> & {sortMode?: number};

const getMenuSelection = (liElement: Element) => {
    const controller = getDocTreeController(liElement);
    const fileElement = hasClosestByTag(liElement, "DIV") || undefined;
    if (!fileElement && !controller) {
        return;
    }
    let selected: IDocTreeItem[];
    let items: IDocTreeMenuItem[];
    let elements: () => NodeListOf<HTMLElement>;
    if (controller) {
        const item = controller.getItemFromElement(liElement);
        if (!item) { return; }
        if (item && !controller.getSelectedItems().some(value => value.occurrenceKey === item.occurrenceKey)) {
            void controller.select(item.occurrenceKey);
        }
        selected = controller.getSelectedItems();
        items = selected.map(item => ({...item, sortMode: item.notebook?.sortMode}));
        elements = () => controller.getSelectionElements();
    } else {
        if (!liElement.classList.contains("b3-list-item--focus")) {
            fileElement.querySelectorAll(".b3-list-item--focus").forEach(item => {
                item.classList.remove("b3-list-item--focus");
                item.removeAttribute("select-end");
                item.removeAttribute("select-start");
            });
            liElement.classList.add("b3-list-item--focus");
        }
        const rows = fileElement.querySelectorAll<HTMLElement>(".b3-list-item--focus");
        items = Array.from(rows).flatMap(row => getDocTreeMenuItems([row]).map(item => ({...item,
            kind: row.getAttribute("data-type") === "navigation-root" ? "notebook" as const : "document" as const,
            name: row.querySelector(".b3-list-item__text")?.textContent || "",
            occurrenceKey: "",
            sortMode: parseInt(row.getAttribute("data-sortmode") || row.parentElement?.getAttribute("data-sortmode")),
        })));
        elements = () => rows;
    }
    return {controller, selected, items, elements, version: controller?.selectionVersion, target: liElement as HTMLElement};
};

const initMultiMenu = (selection: ReturnType<typeof getMenuSelection>, app: App) => {
    const selectedItems = getDocTreeActionItems(selection.items);
    const docCount = selection.items.filter(item => item.kind === "document").length;
    const type = docCount === selection.items.length ? "docs" : docCount === 0 ? "notebooks" : "items";
    const items = selection.items.map(({id, path, notebookId}) => ({id, path, notebookId}));
    if (type === "notebooks") {
        window.siyuan.menus.menu.element.setAttribute("data-from", Constants.MENU_FROM_DOC_TREE_MORE_NOTEBOOKS);
        const notebookIds = selectedItems.map((item) => item.id);
        const notebookNames = notebookIds.map((notebookId) => getNotebookName(notebookId)).join(" ");
        if (!window.siyuan.config.readonly) {
            const sortModes = selectedItems.map((item) => item.sortMode);
            const sortMode = sortModes.every((item) => item === sortModes[0]) ? sortModes[0] : -1;
            const subMenu = sortMenu("notebook", sortMode, async (sort) => {
                if (sort === null) {
                    return;
                }
                let files;
                /// #if MOBILE
                files = window.siyuan.mobile.docks.file;
                /// #else
                files = (getDockByType("file").data["file"] as Files);
                /// #endif
                for (const item of selectedItems) {
                    const notebookId = item.notebookId;
                    if (!notebookId) {
                        continue;
                    }
                    const response = await saveNotebookConfSync(notebookId, {sortMode: sort});
                    if (response.code !== 0) {
                        continue;
                    }
                    const notebook = window.siyuan.notebooks.find((notebookItem) => notebookItem.id === notebookId);
                    if (notebook) {
                        notebook.sortMode = sort;
                    }
                    files?.onDocSortModeChanged({
                        scope: "notebook",
                        box: notebookId,
                        id: "",
                        path: "/",
                        sortMode: sort,
                    });
                }
            });
            window.siyuan.menus.menu.append(new MenuItem({
                id: "sort",
                icon: "iconSort",
                label: window.siyuan.languages.sort,
                type: "submenu",
                submenu: subMenu,
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "search",
            label: window.siyuan.languages.search,
            accelerator: window.siyuan.config.keymap.general.search.custom,
            icon: "iconSearch",
            click() {
                /// #if MOBILE
                popSearch(app, {
                    hasReplace: false,
                    hPath: notebookNames,
                    idPath: notebookIds,
                    page: 1,
                });
                /// #else
                openSearch({
                    app,
                    hotkey: Constants.DIALOG_SEARCH,
                    notebookIds,
                });
                /// #endif
            }
        }).element);
        if (!window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "replace",
                label: window.siyuan.languages.replace,
                accelerator: window.siyuan.config.keymap.general.replace.custom,
                icon: "iconReplace",
                click() {
                    /// #if MOBILE
                    popSearch(app, {
                        hasReplace: true,
                        hPath: notebookNames,
                        idPath: notebookIds,
                        page: 1,
                    });
                    /// #else
                    openSearch({
                        app,
                        hotkey: Constants.DIALOG_REPLACE,
                        notebookIds,
                    });
                    /// #endif
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
            if (notebookIds.every((notebookId) => !Object.values(Constants.HELP_PATH).includes(notebookId))) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "close",
                    label: window.siyuan.languages.close,
                    icon: "iconClose",
                    click: async () => {
                        for (const notebook of notebookIds) {
                            await fetchPost("/api/notebook/closeNotebook", {notebook});
                        }
                    }
                }).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                id: "delete",
                icon: "iconTrashcan",
                label: window.siyuan.languages.delete,
                accelerator: "⌦",
                click: () => {
                    deleteNotebooks(notebookIds);
                }
            }).element);
        }
        if (getHostCapabilities().documentImportExport) {
            const ignoreExport = notebookIds.some((notebookId) => isEncryptedBox(notebookId));
            window.siyuan.menus.menu.append(new MenuItem({
                id: "separator_2",
                type: "separator",
                ignore: ignoreExport,
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "export",
                label: window.siyuan.languages.export,
                type: "submenu",
                icon: "iconDownload",
                ignore: ignoreExport,
                submenu: [{
                    id: "exportSiYuanZip",
                    label: "SiYuan .sy.zip",
                    icon: "iconSiYuan",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportNotebooksSY", {notebooks: notebookIds}, (response) => {
                            saveExportFile(response.data.zip, msgId);
                        });
                    }
                }, {
                    id: "exportMarkdown",
                    label: "Markdown .zip",
                    icon: "iconMarkdown",
                    click: () => exportMarkdownZip({notebooks: notebookIds}),
                }]
            }).element);
        }
        emitOpenMenu({
            type: "open-menu-doctree",
            detail: () => ({elements: selection.elements(), type: "notebooks", items}),
            separatorPosition: "top",
        });
        return window.siyuan.menus.menu;
    }
    if (type === "items") {
        window.siyuan.menus.menu.element.setAttribute("data-from", Constants.MENU_FROM_DOC_TREE_MORE_ITEMS);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "delete",
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            accelerator: "⌦",
            click: () => {
                deleteDocTreeItems(selectedItems);
            }
        }).element);
        emitOpenMenu({
            type: "open-menu-doctree",
            detail: () => ({elements: selection.elements(), type: "items", items}),
            separatorPosition: "top",
        });
        return window.siyuan.menus.menu;
    }
    window.siyuan.menus.menu.element.setAttribute("data-from", Constants.MENU_FROM_DOC_TREE_MORE_DOCS);
    const notebookId = selectedItems[0].notebookId;
    const blockIDs = Array.from(new Set(selectedItems.map(item => item.id)));

    if (blockIDs.length > 0) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copy",
            label: window.siyuan.languages.copy,
            type: "submenu",
            icon: "iconCopy",
            submenu: copySubMenu(blockIDs).concat([{
                id: "duplicate",
                iconHTML: "",
                label: window.siyuan.languages.duplicateCopy,
                accelerator: window.siyuan.config.keymap.editor.general.duplicate.custom,
                click() {
                    blockIDs.forEach((id) => {
                        fetchPost("/api/filetree/duplicateDoc", {
                            id
                        });
                    });
                }
            }])
        }).element);
    }

    window.siyuan.menus.menu.append(movePathToMenu(getDocTreeTopPaths(selectedItems), selectedItems.map(item => item.notebookId)));

    if (blockIDs.length > 0) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "addToDatabase",
            label: window.siyuan.languages.addToDatabase,
            accelerator: window.siyuan.config.keymap.general.addToDatabase.custom,
            icon: "iconDatabase",
            click: async () => {
                const controller = selection.controller;
                if (controller) {
                    const target = await controller.ensureRendered(selection.selected[0].occurrenceKey);
                    if (target && controller.validateSelection(selection.version, selection.selected)) {
                        addBlocksToDatabase(blockIDs, target);
                    }
                } else {
                    addBlocksToDatabase(blockIDs, selection.target);
                }
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "delete",
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        accelerator: "⌦",
        click: () => {
            deleteDocTreeItems(selectedItems);
        }
    }).element);

    if (blockIDs.length === 0) {
        return window.siyuan.menus.menu;
    }
    if (!window.siyuan.config.readonly) {
        const canPin = selectedItems.every(item => item.notebookId && !isEncryptedBox(item.notebookId));
        if (canPin) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "pinDoc",
                icon: "iconPin",
                label: window.siyuan.languages.pinDoc,
                click: () => { updatePinnedDocs(blockIDs, "pin"); },
            }).element);
        }
        if (blockIDs.some(id => pinnedDocIDs.has(id))) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "unpinDoc",
                icon: "iconUnpin",
                label: window.siyuan.languages.unpinDoc,
                click: () => { updatePinnedDocs(blockIDs, "unpin"); },
            }).element);
        }
    }
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
    if (!window.siyuan.config.readonly && !isEncryptedBox(notebookId)) {
        const riffCardMenu = [{
            id: "quickMakeCard",
            iconHTML: "",
            accelerator: window.siyuan.config.keymap.editor.general.quickMakeCard.custom,
            label: window.siyuan.languages.quickMakeCard,
            click: () => {
                transaction(undefined, [{
                    action: "addFlashcards",
                    deckID: Constants.QUICK_DECK_ID,
                    blockIDs,
                }]);
            }
        }, {
            id: "removeCard",
            iconHTML: "",
            label: window.siyuan.languages.removeCard,
            click: () => {
                transaction(undefined, [{
                    action: "removeFlashcards",
                    deckID: Constants.QUICK_DECK_ID,
                    blockIDs,
                }]);
            }
        }];
        if (window.siyuan.config.flashcard.deck) {
            riffCardMenu.push({
                id: "addToDeck",
                iconHTML: "",
                label: window.siyuan.languages.addToDeck,
                click: () => {
                    makeCard(app, blockIDs);
                }
            });
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "riffCard",
            label: window.siyuan.languages.riffCard,
            icon: "iconRiffCard",
            submenu: riffCardMenu,
        }).element);
        if (getHostCapabilities().documentImportExport) {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
        }
    }
    openEditorTab(app, blockIDs);
    if (getHostCapabilities().documentImportExport) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "export",
            label: window.siyuan.languages.export,
            type: "submenu",
            icon: "iconDownload",
            submenu: [{
                id: "exportSiYuanZip",
                label: "SiYuan .sy.zip",
                icon: "iconSiYuan",
                click: () => {
                    confirmEncryptedExport(notebookId, () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportSYs", {
                            ids: blockIDs,
                        }, response => {
                            saveExportFile(response.data.zip, msgId);
                        });
                    });
                }
            }, {
                id: "exportMarkdown",
                label: "Markdown .zip",
                icon: "iconMarkdown",
                click: () => {
                    confirmEncryptedExport(notebookId, () => exportMarkdownZip({ids: blockIDs}));
                }
            }]
        }).element);
    }
    emitOpenMenu({
        type: "open-menu-doctree",
        detail: () => ({
            elements: selection.elements(),
            type,
            items,
        }),
        separatorPosition: "top",
    });
    return window.siyuan.menus.menu;
};

export const initNavigationMenu = (app: App, liElement: HTMLElement) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_DOC_TREE_MORE);
    const selection = getMenuSelection(liElement);
    if (!selection) {
        return window.siyuan.menus.menu;
    }
    if (selection.items.length > 1) {
        return initMultiMenu(selection, app);
    }
    window.siyuan.menus.menu.element.setAttribute("data-from", Constants.MENU_FROM_DOC_TREE_MORE_NOTEBOOK);
    const notebookId = liElement.getAttribute("data-notebook-id") || liElement.parentElement.getAttribute("data-url");
    const name = getNotebookName(notebookId);
    const boxDocID = liElement.getAttribute("data-node-id");
    if (boxDocID && window.siyuan.config.fileTree.parentDocTitleClickMode !== 0 &&
        Number(liElement.getAttribute("data-count")) > 0) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "openDocument",
            label: window.siyuan.languages.openDocument,
            icon: "iconOpen",
            click: () => {
                /// #if MOBILE
                openMobileFileById(app, boxDocID, [Constants.CB_GET_SCROLL], undefined, notebookId);
                /// #else
                openFileById({
                    app,
                    id: boxDocID,
                    action: isPhablet() ? [Constants.CB_GET_SCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                });
                /// #endif
            }
        }).element);
    }
    if (!window.siyuan.config.readonly) {
        /// #if MOBILE
        window.siyuan.menus.menu.append(new MenuItem({
            id: "changeIcon",
            label: window.siyuan.languages.changeIcon,
            icon: "iconEmoji",
            click: () => {
                const iconElement = liElement.querySelector<HTMLElement>(".b3-list-item__icon");
                if (!iconElement) {
                    return;
                }
                const rect = iconElement.getBoundingClientRect();
                openEmojiPanel(notebookId, "notebook", {
                    x: rect.left,
                    y: rect.bottom,
                    h: rect.height,
                    w: rect.width,
                }, undefined, iconElement.querySelector<HTMLElement>("img"));
            }
        }).element);
        /// #endif
        window.siyuan.menus.menu.append(renameMenu({
            path: "/",
            notebookId,
            name,
            type: "notebook"
        }));
        window.siyuan.menus.menu.append(new MenuItem({
            id: "config",
            label: window.siyuan.languages.config,
            icon: "iconSettings",
            click: () => {
                fetchPost("/api/notebook/getNotebookConf", {
                    notebook: notebookId
                }, (data) => {
                    onGetnotebookconf(data.data);
                });
            }
        }).element);
        if (window.siyuan.config.fileTree.boxDocEnabled && liElement.getAttribute("data-node-id") &&
            !isEncryptedBox(notebookId)) {
            const pinned = pinnedDocIDs.has(notebookId);
            window.siyuan.menus.menu.append(new MenuItem({
                id: pinned ? "unpinDoc" : "pinDoc",
                icon: pinned ? "iconUnpin" : "iconPin",
                label: pinned ? window.siyuan.languages.unpinDoc : window.siyuan.languages.pinDoc,
                click: () => { updatePinnedDocs([notebookId], pinned ? "unpin" : "pin"); },
            }).element);
        }
        const subMenu = sortMenu("notebook", parseInt(liElement.getAttribute("data-sortmode") ||
            liElement.parentElement.getAttribute("data-sortmode")), (sort) => {
            if (sort === null) {
                return;
            }
            saveNotebookConf(notebookId, {
                sortMode: sort
            }, (response) => {
                if (response.code !== 0) {
                    return;
                }
                liElement.setAttribute("data-sortmode", sort.toString());
                let files;
                /// #if MOBILE
                files = window.siyuan.mobile.docks.file;
                /// #else
                files = (getDockByType("file").data["file"] as Files);
                /// #endif
                const notebook = window.siyuan.notebooks.find((item) => item.id === notebookId);
                if (notebook) {
                    notebook.sortMode = sort;
                }
                files?.onDocSortModeChanged({
                    scope: "notebook",
                    box: notebookId,
                    id: "",
                    path: "/",
                    sortMode: sort,
                });
            });
            return true;
        });
        window.siyuan.menus.menu.append(new MenuItem({
            id: "sort",
            icon: "iconSort",
            label: window.siyuan.languages.sort,
            type: "submenu",
            submenu: subMenu,
        }).element);
    }
    if (!window.siyuan.config.readonly && !isEncryptedBox(notebookId)) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "riffCard",
            label: window.siyuan.languages.riffCard,
            type: "submenu",
            icon: "iconRiffCard",
            submenu: [{
                id: "spaceRepetition",
                iconHTML: "",
                label: window.siyuan.languages.spaceRepetition,
                accelerator: window.siyuan.config.keymap.editor.general.spaceRepetition.custom,
                click: () => {
                    fetchPost("/api/riff/getNotebookRiffDueCards", {notebook: notebookId}, (response) => {
                        openCardByData(app, response.data, "notebook", notebookId, name);
                    });
                    /// #if MOBILE
                    closePanel();
                    /// #endif
                }
            }, {
                id: "manage",
                iconHTML: "",
                label: window.siyuan.languages.manage,
                click: () => {
                    viewCards(app, notebookId, name, "Notebook");
                    /// #if MOBILE
                    closePanel();
                    /// #endif
                }
            }],
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "search",
        label: window.siyuan.languages.search,
        accelerator: window.siyuan.config.keymap.general.search.custom,
        icon: "iconSearch",
        click() {
            /// #if MOBILE
            popSearch(app, {
                hasReplace: false,
                hPath: getNotebookName(notebookId),
                idPath: [notebookId],
                page: 1,
            });
            /// #else
            openSearch({
                app,
                hotkey: Constants.DIALOG_SEARCH,
                notebookId,
            });
            /// #endif
        }
    }).element);
    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "replace",
            label: window.siyuan.languages.replace,
            accelerator: window.siyuan.config.keymap.general.replace.custom,
            icon: "iconReplace",
            click() {
                /// #if MOBILE
                popSearch(app, {
                    hasReplace: true,
                    hPath: getNotebookName(notebookId),
                    idPath: [notebookId],
                    page: 1,
                });
                /// #else
                openSearch({
                    app,
                    hotkey: Constants.DIALOG_REPLACE,
                    notebookId,
                });
                /// #endif
            }
        }).element);
    }
    if (!window.siyuan.config.readonly) {
        if (isEncryptedBox(notebookId) && canCleanEncryptedNotebookAssets(notebookId)) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "cleanUnusedAssets",
                label: window.siyuan.languages.cleanUnusedAssets,
                icon: "iconTrashcan",
                click: () => {
                    openEncryptedAssetsCleanup(notebookId);
                    /// #if MOBILE
                    closePanel();
                    /// #endif
                },
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
        if (!Object.values(Constants.HELP_PATH).includes(notebookId)) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "close",
                label: window.siyuan.languages.close,
                icon: "iconClose",
                click: () => {
                    fetchPost("/api/notebook/closeNotebook", {
                        notebook: notebookId
                    });
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "delete",
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            accelerator: "⌦",
            click: () => {
                deleteDocTreeItems(selection.items);
            }
        }).element);
    }
    if (getHostCapabilities().localFileSystem || getHostCapabilities().documentImportExport) {
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
    }
    /// #if !BROWSER
    if (getHostCapabilities().localFileSystem) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "showInFolder",
            icon: "iconFolder",
            label: window.siyuan.languages.showInFolder,
            click: () => {
                useShell("openPath", path.join(window.siyuan.config.system.dataDir, notebookId));
            }
        }).element);
    }
    /// #endif
    genImportMenu(notebookId, "/");

    if (getHostCapabilities().documentImportExport) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "export",
            label: window.siyuan.languages.export,
            type: "submenu",
            icon: "iconDownload",
            submenu: [{
                id: "exportSiYuanZip",
                label: "SiYuan .sy.zip",
                icon: "iconSiYuan",
                click: () => {
                    confirmEncryptedExport(notebookId, () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportNotebookSY", {
                            id: notebookId,
                        }, response => {
                            saveExportFile(response.data.zip, msgId);
                        });
                    });
                }
            }, {
                id: "exportMarkdown",
                label: "Markdown .zip",
                icon: "iconMarkdown",
                click: () => {
                    confirmEncryptedExport(notebookId, () => exportMarkdownZip({notebook: notebookId}));
                }
            }]
        }).element);
    }
    emitOpenMenu({
        type: "open-menu-doctree",
        detail: () => ({
            elements: selection.elements(),
            type: "notebook",
            items: [{id: notebookId, path: "/", notebookId}],
        }),
        separatorPosition: "top",
    });
    return window.siyuan.menus.menu;
};

export const initFileMenu = (app: App, notebookId: string, pathString: string, liElement: Element) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_DOC_TREE_MORE);
    const selection = getMenuSelection(liElement);
    if (!selection) {
        return window.siyuan.menus.menu;
    }
    if (selection.items.length > 1) {
        return initMultiMenu(selection, app);
    }
    return initDocumentMenu(app, {
        id: liElement.getAttribute("data-node-id"),
        notebookId,
        path: pathString,
        name: getDisplayName(liElement.getAttribute("data-name"), false, true),
        subFileCount: Number(liElement.getAttribute("data-count")),
        childrenSortMode: getConfiguredChildrenSortMode(liElement),
        customSort: selection.controller ? selection.controller.getItemFromElement(liElement)?.effectiveSortMode === 6 :
            isCustomFileTreeList(liElement.getAttribute("data-pin-root") === "true" ? liElement : liElement.parentElement),
        target: liElement as HTMLElement,
        elements: selection.elements,
        treeElement: liElement,
    });
};

export const initDocumentMenu = (app: App, options: {
    id: string,
    notebookId: string,
    path: string,
    name: string,
    subFileCount: number,
    childrenSortMode: number | null,
    customSort: boolean,
    target: HTMLElement,
    elements: NodeListOf<HTMLElement> | (() => NodeListOf<HTMLElement>),
    treeElement?: Element,
    position?: IPosition,
    readonlyHistory?: boolean,
}) => {
    const {id, notebookId, path: pathString, name, subFileCount} = options;
    const isBoxDoc = id === notebookId;
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_DOC_TREE_MORE);
    /// #if MOBILE
    window.siyuan.menus.menu.append(new MenuItem({
        id: "openInNewTab",
        label: window.siyuan.languages.openInNewTab,
        icon: "iconAdd",
        click: () => {
            openMobileFileByIdInNewTab(app, id, [Constants.CB_GET_SCROLL], undefined, notebookId);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_open", type: "separator"}).element);
    /// #endif
    if (window.siyuan.config.fileTree.parentDocTitleClickMode !== 0 && subFileCount > 0) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "openDocument",
            label: window.siyuan.languages.openDocument,
            icon: "iconOpen",
            click: () => {
                /// #if MOBILE
                openMobileFileById(app, id, [Constants.CB_GET_SCROLL], undefined, notebookId);
                /// #else
                openFileById({
                    app,
                    id,
                    action: isPhablet() ? [Constants.CB_GET_SCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                });
                /// #endif
            }
        }).element);
    }
    if (!window.siyuan.config.readonly) {
        if (!isBoxDoc && options.customSort) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "newDocAbove",
                icon: "iconBefore",
                label: window.siyuan.languages.newDocAbove,
                click: () => {
                    newFileInTree(app, notebookId, pathPosix().dirname(pathString), {
                        targetID: id,
                        position: "before",
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "newDocBelow",
                icon: "iconAfter",
                label: window.siyuan.languages.newDocBelow,
                click: () => {
                    newFileInTree(app, notebookId, pathPosix().dirname(pathString), {
                        targetID: id,
                        position: "after",
                    });
                }
            }).element);
        } else if (!isBoxDoc) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "newSiblingDoc",
                icon: "iconAddDoc",
                label: window.siyuan.languages.newSiblingDoc,
                click: () => {
                    newFileInTree(app, notebookId, pathPosix().dirname(pathString));
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copy",
            label: window.siyuan.languages.copy,
            type: "submenu",
            icon: "iconCopy",
            submenu: (copySubMenu([id]) as IMenu[]).concat([{
                id: "duplicate",
                ignore: isBoxDoc,
                iconHTML: "",
                label: window.siyuan.languages.duplicateCopy,
                accelerator: window.siyuan.config.keymap.editor.general.duplicate.custom,
                click() {
                    fetchPost("/api/filetree/duplicateDoc", {
                        id
                    });
                }
            }, {
                id: "duplicateTree",
                iconHTML: "",
                label: window.siyuan.languages.duplicateDocTree,
                ignore: isBoxDoc || !(subFileCount > 0),
                click() {
                    fetchPost("/api/filetree/duplicateDocTree", {id});
                }
            }])
        }).element);
        if (!isBoxDoc) {
            window.siyuan.menus.menu.append(movePathToMenu([pathString], [notebookId]));
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "addToDatabase",
            label: window.siyuan.languages.addToDatabase,
            accelerator: window.siyuan.config.keymap.general.addToDatabase.custom,
            icon: "iconDatabase",
            click: () => {
                addBlocksToDatabase([id], options.target, options.position);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "delete",
            ignore: isBoxDoc,
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            accelerator: "⌦",
            click: () => {
                deleteFile(notebookId, pathString);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
        if (!isBoxDoc) {
            window.siyuan.menus.menu.append(renameMenu({
                path: pathString,
                notebookId,
                name,
                type: "file",
                docId: id,
            }));
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "attr",
            label: window.siyuan.languages.attr,
            icon: "iconAttr",
            click() {
                const docInfoParam: BlockQueryRequestInput = {
                    id
                };
                if (isEncryptedBox(notebookId)) {
                    docInfoParam.notebook = notebookId;
                }
                fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
                    openFileAttr(response.data.ial);
                });
            }
        }).element);
        if (!isEncryptedBox(notebookId)) {
            const pinned = pinnedDocIDs.has(id);
            window.siyuan.menus.menu.append(new MenuItem({
                id: pinned ? "unpinDoc" : "pinDoc",
                icon: pinned ? "iconUnpin" : "iconPin",
                label: pinned ? window.siyuan.languages.unpinDoc : window.siyuan.languages.pinDoc,
                click: () => { updatePinnedDocs([id], pinned ? "unpin" : "pin"); },
            }).element);
        }
        const configuredSortMode = options.childrenSortMode;
        const sortSubMenu = sortMenu("document", configuredSortMode, (sortMode) => {
            fetchPost("/api/filetree/setDocSortMode", {
                id,
                sortMode,
            }, (response) => {
                if (response.code !== 0) {
                    return;
                }
                options.treeElement?.setAttribute(FILE_TREE_CHILDREN_SORT_MODE, sortMode?.toString() || "");
                let files;
                /// #if MOBILE
                files = window.siyuan.mobile.docks.file;
                /// #else
                files = (getDockByType("file")?.data["file"] as Files);
                /// #endif
                files?.onDocSortModeChanged({
                    scope: "document",
                    box: notebookId,
                    id,
                    path: pathString,
                    sortMode,
                });
            });
        });
        window.siyuan.menus.menu.append(new MenuItem({
            id: "sort",
            ignore: isBoxDoc,
            icon: "iconSort",
            label: window.siyuan.languages.sort,
            type: "submenu",
            submenu: sortSubMenu,
        }).element);
        if (!window.siyuan.config.readonly && !isEncryptedBox(notebookId)) {
            const riffCardMenu = [{
                id: "spaceRepetition",
                iconHTML: "",
                label: window.siyuan.languages.spaceRepetition,
                accelerator: window.siyuan.config.keymap.editor.general.spaceRepetition.custom,
                click: () => {
                    fetchPost("/api/riff/getTreeRiffDueCards", {rootID: id}, (response) => {
                        openCardByData(app, response.data, "doc", id, name);
                    });
                    /// #if MOBILE
                    closePanel();
                    /// #endif
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
                    /// #if MOBILE
                    closePanel();
                    /// #endif
                }
            }, {
                id: "quickMakeCard",
                iconHTML: "",
                accelerator: window.siyuan.config.keymap.editor.general.quickMakeCard.custom,
                label: window.siyuan.languages.quickMakeCard,
                click: () => {
                    transaction(undefined, [{
                        action: "addFlashcards",
                        deckID: Constants.QUICK_DECK_ID,
                        blockIDs: [id]
                    }]);
                }
            }, {
                id: "removeCard",
                iconHTML: "",
                label: window.siyuan.languages.removeCard,
                click: () => {
                    transaction(undefined, [{
                        action: "removeFlashcards",
                        deckID: Constants.QUICK_DECK_ID,
                        blockIDs: [id]
                    }]);
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
        window.siyuan.menus.menu.append(new MenuItem({
            id: "search",
            label: window.siyuan.languages.search,
            icon: "iconSearch",
            accelerator: window.siyuan.config.keymap.general.search.custom,
            click: () => openFileTreeSearch(app, notebookId, pathString, false)
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "replace",
            label: window.siyuan.languages.replace,
            accelerator: window.siyuan.config.keymap.general.replace.custom,
            icon: "iconReplace",
            click: () => openFileTreeSearch(app, notebookId, pathString, true)
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_3", type: "separator"}).element);
    }
    openEditorTab(app, [id], notebookId, pathString);
    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "fileHistory",
            label: window.siyuan.languages.dataHistory,
            icon: "iconHistory",
            click() {
                openDocHistory({app, id, notebookId, pathString: name, readonly: options.readonlyHistory});
            }
        }).element);
    }
    genImportMenu(notebookId, isBoxDoc ? "/" : pathString);
    window.siyuan.menus.menu.append(exportMd(id));
    emitOpenMenu({
        type: "open-menu-doctree",
        detail: () => ({
            elements: typeof options.elements === "function" ? options.elements() : options.elements,
            type: "doc",
            items: [{id, path: pathString, notebookId}],
        }),
        separatorPosition: "top",
    });
    window.siyuan.menus.menu.element.setAttribute("data-from", Constants.MENU_FROM_DOC_TREE_MORE_DOC);
    return window.siyuan.menus.menu;
};

export const genImportMenu = (notebookId: string, pathString: string) => {
    if (window.siyuan.config.readonly || !getHostCapabilities().documentImportExport) {
        return;
    }
    const reloadDocTree = () => {
        let files;
        /// #if MOBILE
        files = window.siyuan.mobile.docks.file;
        /// #else
        files = (getDockByType("file")?.data["file"] as Files);
        /// #endif
        files?.onDocsImported({notebook: notebookId, parentPath: pathString, rootIDs: []});
        window.siyuan.menus.menu.remove();
    };
    /// #if !BROWSER
    const importstdmd = (label: string, isDoc?: boolean) => {
        return {
            id: isDoc ? "importMarkdownDoc" : "importMarkdownFolder",
            ignore: !getHostCapabilities().localFileSystem,
            icon: isDoc ? "iconMarkdown" : "iconFolder",
            label,
            click: async () => {
                let filters: FileFilter[] = [];
                if (isDoc) {
                    filters = [{name: "Markdown", extensions: ["md", "markdown"]}];
                }
                const localPath = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                    cmd: "showOpenDialog",
                    defaultPath: window.siyuan.config.system.homeDir,
                    filters,
                    properties: [isDoc ? "openFile" : "openDirectory"],
                });
                if (localPath.filePaths.length === 0) {
                    return;
                }
                fetchPost("/api/import/importStdMd", {
                    notebook: notebookId,
                    localPath: localPath.filePaths[0],
                    toPath: pathString,
                }, () => {
                    reloadDocTree();
                });
            }
        };
    };
    /// #endif
    window.siyuan.menus.menu.append(new MenuItem({
        id: "import",
        icon: "iconUpload",
        label: window.siyuan.languages.import,
        submenu: [
            {
                id: "importSiYuanZip",
                icon: "iconSiYuan",
                label: 'SiYuan .sy.zip<input class="b3-form__upload" type="file" accept="application/zip">',
                bind: (element) => {
                    element.querySelector(".b3-form__upload").addEventListener("change", (event: InputEvent & {
                        target: HTMLInputElement
                    }) => {
                        const formData = new ContractFormData({file: event.target.files[0], notebook: notebookId, toPath: pathString});
                        fetchPost("/api/import/importSY", formData, () => {
                            reloadDocTree();
                        });
                    });
                }
            },
            {
                id: "importMarkdownZip",
                icon: "iconMarkdown",
                label: 'Markdown .zip<input class="b3-form__upload" type="file" accept="application/zip">',
                bind: (element) => {
                    element.querySelector(".b3-form__upload").addEventListener("change", (event: InputEvent & {
                        target: HTMLInputElement
                    }) => {
                        const formData = new ContractFormData({file: event.target.files[0], notebook: notebookId, toPath: pathString});
                        fetchPost("/api/import/importZipMd", formData, () => {
                            reloadDocTree();
                        });
                    });
                }
            },
            /// #if !BROWSER
            importstdmd("Markdown " + window.siyuan.languages.doc, true),
            importstdmd("Markdown " + window.siyuan.languages.folder)
            /// #endif
        ],
    }).element);
};

export const sortMenu = (type: "notebooks" | "notebook" | "document", sortMode: number | null,
                         clickEvent: (sort: number | null) => void) => {
    const sortMenu: IMenu[] = [{
        id: "fileNameASC",
        checked: sortMode === 0,
        iconHTML: "",
        label: window.siyuan.languages.fileNameASC,
        click: () => {
            clickEvent(0);
        }
    }, {
        id: "fileNameDESC",
        checked: sortMode === 1,
        iconHTML: "",
        label: window.siyuan.languages.fileNameDESC,
        click: () => {
            clickEvent(1);
        }
    }, {
        id: "fileNameNatASC",
        checked: sortMode === 4,
        iconHTML: "",
        label: window.siyuan.languages.fileNameNatASC,
        click: () => {
            clickEvent(4);
        }
    }, {
        id: "fileNameNatDESC",
        checked: sortMode === 5,
        iconHTML: "",
        label: window.siyuan.languages.fileNameNatDESC,
        click: () => {
            clickEvent(5);
        }
    }, {id: "separator_1", type: "separator"}, {
        id: "createdASC",
        checked: sortMode === 9,
        iconHTML: "",
        label: window.siyuan.languages.createdASC,
        click: () => {
            clickEvent(9);
        }
    }, {
        id: "createdDESC",
        checked: sortMode === 10,
        iconHTML: "",
        label: window.siyuan.languages.createdDESC,
        click: () => {
            clickEvent(10);
        }
    }, {
        id: "modifiedASC",
        checked: sortMode === 2,
        iconHTML: "",
        label: window.siyuan.languages.modifiedASC,
        click: () => {
            clickEvent(2);
        }
    }, {
        id: "modifiedDESC",
        checked: sortMode === 3,
        iconHTML: "",
        label: window.siyuan.languages.modifiedDESC,
        click: () => {
            clickEvent(3);
        }
    }, {id: "separator_2", type: "separator"}, {
        id: "refCountASC",
        checked: sortMode === 7,
        iconHTML: "",
        label: window.siyuan.languages.refCountASC,
        click: () => {
            clickEvent(7);
        }
    }, {
        id: "refCountDESC",
        checked: sortMode === 8,
        iconHTML: "",
        label: window.siyuan.languages.refCountDESC,
        click: () => {
            clickEvent(8);
        }
    }, {id: "separator_3", type: "separator"}, {
        id: "docSizeASC",
        checked: sortMode === 11,
        iconHTML: "",
        label: window.siyuan.languages.docSizeASC,
        click: () => {
            clickEvent(11);
        }
    }, {
        id: "docSizeDESC",
        checked: sortMode === 12,
        iconHTML: "",
        label: window.siyuan.languages.docSizeDESC,
        click: () => {
            clickEvent(12);
        }
    }, {id: "separator_4", type: "separator"}, {
        id: "subDocCountASC",
        checked: sortMode === 13,
        iconHTML: "",
        label: window.siyuan.languages.subDocCountASC,
        click: () => {
            clickEvent(13);
        }
    }, {
        id: "subDocCountDESC",
        checked: sortMode === 14,
        iconHTML: "",
        label: window.siyuan.languages.subDocCountDESC,
        click: () => {
            clickEvent(14);
        }
    }, {id: "separator_5", type: "separator"}, {
        id: "customSort",
        checked: sortMode === 6,
        iconHTML: "",
        label: window.siyuan.languages.customSort,
        click: () => {
            clickEvent(6);
        }
    }];
    if (type === "notebook") {
        sortMenu.push({
            id: "sortByFiletree",
            checked: sortMode === 15,
            iconHTML: "",
            label: window.siyuan.languages.sortByFiletree,
            click: () => {
                clickEvent(15);
            }
        });
    } else if (type === "document") {
        sortMenu.push({
            id: "sortByParent",
            checked: sortMode === null,
            iconHTML: "",
            label: window.siyuan.languages.sortByParent,
            click: () => {
                clickEvent(null);
            }
        });
    }
    return sortMenu;
};
