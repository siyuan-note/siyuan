import {copySubMenu, exportMd, movePathToMenu, openFileAttr, renameMenu,} from "./commonMenuItem";
/// #if !BROWSER
import {FileFilter, ipcRenderer, shell} from "electron";
import * as path from "path";
/// #endif
import {MenuItem} from "./Menu";
import {getDisplayName, getNotebookName, getTopPaths, pathPosix} from "../util/pathName";
import {hideMessage, showMessage} from "../dialog/message";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {onGetnotebookconf} from "./onGetnotebookconf";
/// #if !MOBILE
import {openSearch} from "../search/spread";
/// #else
import {closePanel} from "../mobile/util/closePanel";
import {popSearch} from "../mobile/menu/search";
/// #endif
import {Constants} from "../constants";
import {newFile} from "../util/newFile";
import {hasClosestByTag, hasTopClosestByTag} from "../protyle/util/hasClosest";
import {deleteFiles} from "../editor/deleteFile";
import {getDockByType} from "../layout/tabUtil";
import {Files} from "../layout/dock/Files";
import {openCardByData} from "../card/openCard";
import {viewCards} from "../card/viewCards";
import {App} from "../index";
import {openDocHistory} from "../history/doc";
import {openEditorTab} from "./util";
import {makeCard} from "../card/makeCard";
import {transaction} from "../protyle/wysiwyg/transaction";
import {emitOpenMenu} from "../plugin/EventBus";
import {openByMobile} from "../protyle/util/compatibility";
import {addFilesToDatabase} from "../protyle/render/av/addToDatabase";

const initMultiMenu = (selectItemElements: NodeListOf<Element>, app: App) => {
    const fileItemElement = Array.from(selectItemElements).find(item => {
        if (item.getAttribute("data-type") === "navigation-file") {
            return true;
        }
    });
    if (!fileItemElement) {
        return window.siyuan.menus.menu;
    }
    window.siyuan.menus.menu.append(movePathToMenu(getTopPaths(
        Array.from(selectItemElements)
    )));
    const blockIDs: string[] = [];
    selectItemElements.forEach(item => {
        const id = item.getAttribute("data-node-id");
        if (id) {
            blockIDs.push(id);
        }
    });
    if (blockIDs.length > 0) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "addToDatabase",
            label: window.siyuan.languages.addToDatabase,
            accelerator: window.siyuan.config.keymap.general.addToDatabase.custom,
            icon: "iconDatabase",
            click: () => {
                addFilesToDatabase(Array.from(selectItemElements));
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        id: "delete",
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        accelerator: "⌦",
        click: () => {
            deleteFiles(Array.from(selectItemElements));
        }
    }).element);

    if (blockIDs.length === 0) {
        return window.siyuan.menus.menu;
    }
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
    if (!window.siyuan.config.readonly) {
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
                }], [{
                    action: "removeFlashcards",
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
                }], [{
                    action: "addFlashcards",
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
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
    }
    openEditorTab(app, blockIDs);
    if (app.plugins) {
        emitOpenMenu({
            plugins: app.plugins,
            type: "open-menu-doctree",
            detail: {
                elements: selectItemElements,
                type: "docs"
            },
            separatorPosition: "top",
        });
    }
    return window.siyuan.menus.menu;
};

export const initNavigationMenu = (app: App, liElement: HTMLElement) => {
    window.siyuan.menus.menu.remove();
    const fileElement = hasClosestByTag(liElement, "DIV");
    if (!fileElement) {
        return window.siyuan.menus.menu;
    }
    if (!liElement.classList.contains("b3-list-item--focus")) {
        fileElement.querySelectorAll(".b3-list-item--focus").forEach(item => {
            item.classList.remove("b3-list-item--focus");
            item.removeAttribute("select-end");
            item.removeAttribute("select-start");
        });
        liElement.classList.add("b3-list-item--focus");
    }
    const selectItemElements = fileElement.querySelectorAll(".b3-list-item--focus");
    if (selectItemElements.length > 1) {
        return initMultiMenu(selectItemElements, app);
    }
    const notebookId = liElement.parentElement.getAttribute("data-url");
    const name = getNotebookName(notebookId);
    if (!window.siyuan.config.readonly) {
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
        const subMenu = sortMenu("notebook", parseInt(liElement.parentElement.getAttribute("data-sortmode")), (sort) => {
            fetchPost("/api/notebook/setNotebookConf", {
                notebook: notebookId,
                conf: {
                    sortMode: sort
                }
            }, () => {
                liElement.parentElement.setAttribute("data-sortmode", sort.toString());
                let files;
                /// #if MOBILE
                files = window.siyuan.mobile.files;
                /// #else
                files = (getDockByType("file").data["file"] as Files);
                /// #endif
                const toggleElement = liElement.querySelector(".b3-list-item__arrow--open");
                if (toggleElement) {
                    toggleElement.classList.remove("b3-list-item__arrow--open");
                    liElement.nextElementSibling?.remove();
                    files.getLeaf(liElement, notebookId);
                }
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
    if (!window.siyuan.config.readonly) {
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
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
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
        window.siyuan.menus.menu.append(new MenuItem({
            id: "delete",
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            accelerator: "⌦",
            click: () => {
                deleteFiles(Array.from(fileElement.querySelectorAll(".b3-list-item--focus")));
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
    /// #if !BROWSER
    window.siyuan.menus.menu.append(new MenuItem({
        id: "showInFolder",
        icon: "iconFolder",
        label: window.siyuan.languages.showInFolder,
        click: () => {
            shell.openPath(path.join(window.siyuan.config.system.dataDir, notebookId));
        }
    }).element);
    /// #endif
    genImportMenu(notebookId, "/");

    window.siyuan.menus.menu.append(new MenuItem({
        id: "export",
        label: window.siyuan.languages.export,
        type: "submenu",
        icon: "iconUpload",
        submenu: [{
            id: "exportMarkdown",
            label: "Markdown",
            icon: "iconMarkdown",
            click: () => {
                const msgId = showMessage(window.siyuan.languages.exporting, -1);
                fetchPost("/api/export/batchExportMd", {
                    notebook: notebookId,
                    path: "/"
                }, response => {
                    hideMessage(msgId);
                    openByMobile(response.data.zip);
                });
            }
        }, {
            id: "exportSiYuanZip",
            label: "SiYuan .sy.zip",
            icon: "iconSiYuan",
            click: () => {
                const msgId = showMessage(window.siyuan.languages.exporting, -1);
                fetchPost("/api/export/exportNotebookSY", {
                    id: notebookId,
                }, response => {
                    hideMessage(msgId);
                    openByMobile(response.data.zip);
                });
            }
        }]
    }).element);
    if (app.plugins) {
        emitOpenMenu({
            plugins: app.plugins,
            type: "open-menu-doctree",
            detail: {
                elements: selectItemElements,
                type: "notebook"
            },
            separatorPosition: "top",
        });
    }
    return window.siyuan.menus.menu;
};

export const initFileMenu = (app: App, notebookId: string, pathString: string, liElement: Element) => {
    window.siyuan.menus.menu.remove();
    const fileElement = hasClosestByTag(liElement, "DIV");
    if (!fileElement) {
        return window.siyuan.menus.menu;
    }
    if (!liElement.classList.contains("b3-list-item--focus")) {
        fileElement.querySelectorAll(".b3-list-item--focus").forEach(item => {
            item.classList.remove("b3-list-item--focus");
            item.removeAttribute("select-end");
            item.removeAttribute("select-start");
        });
        liElement.classList.add("b3-list-item--focus");
    }
    const selectItemElements = fileElement.querySelectorAll(".b3-list-item--focus");
    if (selectItemElements.length > 1) {
        return initMultiMenu(selectItemElements, app);
    }
    const id = liElement.getAttribute("data-node-id");
    let name = liElement.getAttribute("data-name");
    name = getDisplayName(name, false, true);
    if (!window.siyuan.config.readonly) {
        const topElement = hasTopClosestByTag(liElement, "UL");
        if (window.siyuan.config.fileTree.sort === 6 || (topElement && topElement.dataset.sortmode === "6")) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "newDocAbove",
                icon: "iconBefore",
                label: window.siyuan.languages.newDocAbove,
                click: () => {
                    const paths: string[] = [];
                    Array.from(liElement.parentElement.children).forEach((item) => {
                        if (item.tagName === "LI") {
                            if (item.isSameNode(liElement)) {
                                paths.push(undefined);
                            }
                            paths.push(item.getAttribute("data-path"));
                        }
                    });
                    newFile({
                        app,
                        notebookId,
                        currentPath: pathPosix().dirname(pathString),
                        paths,
                        useSavePath: false
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "newDocBelow",
                icon: "iconAfter",
                label: window.siyuan.languages.newDocBelow,
                click: () => {
                    const paths: string[] = [];
                    Array.from(liElement.parentElement.children).forEach((item) => {
                        if (item.tagName === "LI") {
                            paths.push(item.getAttribute("data-path"));
                            if (item.isSameNode(liElement)) {
                                paths.push(undefined);
                            }
                        }
                    });
                    newFile({
                        app,
                        notebookId,
                        currentPath: pathPosix().dirname(pathString),
                        paths,
                        useSavePath: false
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copy",
            label: window.siyuan.languages.copy,
            type: "submenu",
            icon: "iconCopy",
            submenu: (copySubMenu(id, false) as IMenu[]).concat([{
                id: "duplicate",
                iconHTML: "",
                label: window.siyuan.languages.duplicate,
                accelerator: window.siyuan.config.keymap.editor.general.duplicate.custom,
                click() {
                    fetchPost("/api/filetree/duplicateDoc", {
                        id
                    });
                }
            }])
        }).element);
        window.siyuan.menus.menu.append(movePathToMenu(getTopPaths(
            Array.from(fileElement.querySelectorAll(".b3-list-item--focus"))
        )));
        window.siyuan.menus.menu.append(new MenuItem({
            id: "addToDatabase",
            label: window.siyuan.languages.addToDatabase,
            accelerator: window.siyuan.config.keymap.general.addToDatabase.custom,
            icon: "iconDatabase",
            click: () => {
                addFilesToDatabase([liElement]);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "delete",
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            accelerator: "⌦",
            click: () => {
                deleteFiles(Array.from(fileElement.querySelectorAll(".b3-list-item--focus")));
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
        window.siyuan.menus.menu.append(renameMenu({
            path: pathString,
            notebookId,
            name,
            type: "file"
        }));
        window.siyuan.menus.menu.append(new MenuItem({
            id: "attr",
            label: window.siyuan.languages.attr,
            icon: "iconAttr",
            click() {
                fetchPost("/api/block/getDocInfo", {
                    id
                }, (response) => {
                    openFileAttr(response.data.ial);
                });
            }
        }).element);
        if (!window.siyuan.config.readonly) {
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
                    }], [{
                        action: "removeFlashcards",
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
                    }], [{
                        action: "addFlashcards",
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
            async click() {
                const searchPath = getDisplayName(pathString, false, true);
                /// #if MOBILE
                const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                    notebook: notebookId,
                    path: searchPath + ".sy"
                });
                popSearch(app, {
                    hasReplace: false,
                    hPath: pathPosix().join(getNotebookName(notebookId), response.data),
                    idPath: [pathPosix().join(notebookId, searchPath)],
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
        window.siyuan.menus.menu.append(new MenuItem({
            id: "replace",
            label: window.siyuan.languages.replace,
            accelerator: window.siyuan.config.keymap.general.replace.custom,
            icon: "iconReplace",
            async click() {
                const searchPath = getDisplayName(pathString, false, true);
                /// #if MOBILE
                const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                    notebook: notebookId,
                    path: searchPath + ".sy"
                });
                popSearch(app, {
                    hasReplace: true,
                    hPath: pathPosix().join(getNotebookName(notebookId), response.data),
                    idPath: [pathPosix().join(notebookId, searchPath)],
                    page: 1,
                });
                /// #else
                openSearch({
                    app,
                    hotkey: Constants.DIALOG_REPLACE,
                    notebookId,
                    searchPath
                });
                /// #endif
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_3", type: "separator"}).element);
    }
    openEditorTab(app, [id], notebookId, pathString);
    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "fileHistory",
            label: window.siyuan.languages.fileHistory,
            icon: "iconHistory",
            click() {
                openDocHistory({app, id, notebookId, pathString: name});
            }
        }).element);
    }
    genImportMenu(notebookId, pathString);
    window.siyuan.menus.menu.append(exportMd(id));
    if (app.plugins) {
        emitOpenMenu({
            plugins: app.plugins,
            type: "open-menu-doctree",
            detail: {
                elements: selectItemElements,
                type: "doc"
            },
            separatorPosition: "top",
        });
    }
    return window.siyuan.menus.menu;
};

export const genImportMenu = (notebookId: string, pathString: string) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    const reloadDocTree = () => {
        let files;
        /// #if MOBILE
        files = window.siyuan.mobile.files;
        /// #else
        files = (getDockByType("file").data["file"] as Files);
        /// #endif
        const liElement = files.element.querySelector(`[data-path="${pathString}"]`);
        const toggleElement = liElement.querySelector(".b3-list-item__arrow--open");
        if (toggleElement) {
            toggleElement.classList.remove("b3-list-item__arrow--open");
            liElement.nextElementSibling?.remove();
        }
        files.getLeaf(liElement, notebookId);
        window.siyuan.menus.menu.remove();
    };
    /// #if !BROWSER
    const importstdmd = (label: string, isDoc?: boolean) => {
        return {
            id: isDoc ? "importMarkdownDoc" : "importMarkdownFolder",
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
        icon: "iconDownload",
        label: window.siyuan.languages.import,
        submenu: [{
            id: "importSiYuanZip",
            icon: "iconSiYuan",
            label: 'SiYuan .sy.zip<input class="b3-form__upload" type="file" accept="application/zip">',
            bind: (element) => {
                element.querySelector(".b3-form__upload").addEventListener("change", (event: InputEvent & {
                    target: HTMLInputElement
                }) => {
                    const formData = new FormData();
                    formData.append("file", event.target.files[0]);
                    formData.append("notebook", notebookId);
                    formData.append("toPath", pathString);
                    fetchPost("/api/import/importSY", formData, () => {
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

export const sortMenu = (type: "notebooks" | "notebook", sortMode: number, clickEvent: (sort: number) => void) => {
    const sortMenu: IMenu[] = [{
        id: "fileNameASC",
        icon: sortMode === 0 ? "iconSelect" : undefined,
        label: window.siyuan.languages.fileNameASC,
        click: () => {
            clickEvent(0);
        }
    }, {
        id: "fileNameDESC",
        icon: sortMode === 1 ? "iconSelect" : undefined,
        label: window.siyuan.languages.fileNameDESC,
        click: () => {
            clickEvent(1);
        }
    }, {
        id: "fileNameNatASC",
        icon: sortMode === 4 ? "iconSelect" : undefined,
        label: window.siyuan.languages.fileNameNatASC,
        click: () => {
            clickEvent(4);
        }
    }, {
        id: "fileNameNatDESC",
        icon: sortMode === 5 ? "iconSelect" : undefined,
        label: window.siyuan.languages.fileNameNatDESC,
        click: () => {
            clickEvent(5);
        }
    }, {id: "separator_1", type: "separator"}, {
        id: "createdASC",
        icon: sortMode === 9 ? "iconSelect" : undefined,
        label: window.siyuan.languages.createdASC,
        click: () => {
            clickEvent(9);
        }
    }, {
        id: "createdDESC",
        icon: sortMode === 10 ? "iconSelect" : undefined,
        label: window.siyuan.languages.createdDESC,
        click: () => {
            clickEvent(10);
        }
    }, {
        id: "modifiedASC",
        icon: sortMode === 2 ? "iconSelect" : undefined,
        label: window.siyuan.languages.modifiedASC,
        click: () => {
            clickEvent(2);
        }
    }, {
        id: "modifiedDESC",
        icon: sortMode === 3 ? "iconSelect" : undefined,
        label: window.siyuan.languages.modifiedDESC,
        click: () => {
            clickEvent(3);
        }
    }, {id: "separator_2", type: "separator"}, {
        id: "refCountASC",
        icon: sortMode === 7 ? "iconSelect" : undefined,
        label: window.siyuan.languages.refCountASC,
        click: () => {
            clickEvent(7);
        }
    }, {
        id: "refCountDESC",
        icon: sortMode === 8 ? "iconSelect" : undefined,
        label: window.siyuan.languages.refCountDESC,
        click: () => {
            clickEvent(8);
        }
    }, {id: "separator_3", type: "separator"}, {
        id: "docSizeASC",
        icon: sortMode === 11 ? "iconSelect" : undefined,
        label: window.siyuan.languages.docSizeASC,
        click: () => {
            clickEvent(11);
        }
    }, {
        id: "docSizeDESC",
        icon: sortMode === 12 ? "iconSelect" : undefined,
        label: window.siyuan.languages.docSizeDESC,
        click: () => {
            clickEvent(12);
        }
    }, {id: "separator_4", type: "separator"}, {
        id: "subDocCountASC",
        icon: sortMode === 13 ? "iconSelect" : undefined,
        label: window.siyuan.languages.subDocCountASC,
        click: () => {
            clickEvent(13);
        }
    }, {
        id: "subDocCountDESC",
        icon: sortMode === 14 ? "iconSelect" : undefined,
        label: window.siyuan.languages.subDocCountDESC,
        click: () => {
            clickEvent(14);
        }
    }, {id: "separator_5", type: "separator"}, {
        id: "customSort",
        icon: sortMode === 6 ? "iconSelect" : undefined,
        label: window.siyuan.languages.customSort,
        click: () => {
            clickEvent(6);
        }
    }];
    if (type === "notebook") {
        sortMenu.push({
            id: "sortByFiletree",
            icon: sortMode === 15 ? "iconSelect" : undefined,
            label: window.siyuan.languages.sortByFiletree,
            click: () => {
                clickEvent(15);
            }
        });
    }
    return sortMenu;
};
