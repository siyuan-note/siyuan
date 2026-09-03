import type {App} from "../index";
import {Constants} from "../constants";
import {isMobile} from "../util/functions";
import {addEditorToDatabase, addFilesToDatabase} from "../protyle/render/av/addToDatabase";
import {hasClosestBlock, hasTopClosestByTag} from "../protyle/util/hasClosest";
import {getDisplayName, getNotebookName, getTopPaths, movePathTo, moveToPath, pathPosix} from "../util/pathName";
import {hintMoveBlock} from "../protyle/hint/extend";
import {fetchSyncPost} from "../util/fetch";
import {globalCommand} from "../boot/globalEvent/command/global";
import {onlyProtyleCommand} from "../boot/globalEvent/command/protyle";
import type {ICommandContextSnapshot} from "./types";
/// #if MOBILE
import {popSearch} from "../mobile/menu/search";
/// #else
import {openSearch} from "../search/spread";
/// #endif

export const executeLegacyNativeCommand = async (command: string, context: ICommandContextSnapshot) => {
    const app = context.app as App;
    if (globalCommand(command, app, context.range)) {
        return;
    }

    const isFileFocus = context.focus === "fileTree";
    const protyle = context.protyle;
    const range = context.range;
    const fileLiElements = context.fileTree?.elements;

    if (!isFileFocus && protyle && onlyProtyleCommand({
        command,
        previousRange: range,
        protyle,
    })) {
        return;
    }

    // 全局命令，在没有编辑器上下文或文档树没有选中项时执行。
    if ((!protyle && !isFileFocus) ||
        (isFileFocus && (!fileLiElements || fileLiElements.length === 0)) ||
        (isMobile() && !document.getElementById("empty")?.classList.contains("fn__none"))) {
        if (command === "replace") {
            /// #if MOBILE
            popSearch(app, {hasReplace: true, page: 1});
            /// #else
            openSearch({
                app,
                hotkey: Constants.DIALOG_REPLACE,
                key: range?.toString() || "",
            });
            /// #endif
        } else if (command === "search") {
            /// #if MOBILE
            popSearch(app, {hasReplace: false, page: 1});
            /// #else
            openSearch({
                app,
                hotkey: Constants.DIALOG_SEARCH,
                key: range?.toString() || "",
            });
            /// #endif
        }
        return;
    }

    switch (command) {
        case "replace":
            if (!isFileFocus) {
                /// #if MOBILE
                const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                    notebook: protyle.notebookId,
                    path: protyle.path.endsWith(".sy") ? protyle.path : protyle.path + ".sy",
                });
                if (response.code !== 0 || typeof response.data !== "string") {
                    return;
                }
                popSearch(app, {
                    page: 1,
                    hasReplace: true,
                    hPath: pathPosix().join(getNotebookName(protyle.notebookId), response.data),
                    idPath: [pathPosix().join(protyle.notebookId, protyle.path)],
                });
                /// #else
                openSearch({
                    app,
                    hotkey: Constants.DIALOG_REPLACE,
                    key: range?.toString() || "",
                    notebookId: protyle.notebookId,
                    searchPath: protyle.path,
                });
                /// #endif
            } else {
                /// #if !MOBILE
                const topULElement = hasTopClosestByTag(fileLiElements[0], "UL");
                if (!topULElement) {
                    return false;
                }
                const notebookId = topULElement.getAttribute("data-url");
                const pathString = fileLiElements[0].getAttribute("data-path");
                const isFile = fileLiElements[0].getAttribute("data-type") === "navigation-file";
                if (isFile) {
                    openSearch({
                        app,
                        hotkey: Constants.DIALOG_REPLACE,
                        notebookId,
                        searchPath: getDisplayName(pathString, false, true),
                    });
                } else {
                    openSearch({
                        app,
                        hotkey: Constants.DIALOG_REPLACE,
                        notebookId,
                    });
                }
                /// #endif
            }
            break;
        case "search":
            if (!isFileFocus) {
                /// #if MOBILE
                const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                    notebook: protyle.notebookId,
                    path: protyle.path.endsWith(".sy") ? protyle.path : protyle.path + ".sy",
                });
                if (response.code !== 0 || typeof response.data !== "string") {
                    return;
                }
                popSearch(app, {
                    page: 1,
                    hasReplace: false,
                    hPath: pathPosix().join(getNotebookName(protyle.notebookId), response.data),
                    idPath: [pathPosix().join(protyle.notebookId, protyle.path)],
                });
                /// #else
                openSearch({
                    app,
                    hotkey: Constants.DIALOG_SEARCH,
                    key: range?.toString() || "",
                    notebookId: protyle.notebookId,
                    searchPath: protyle.path,
                });
                /// #endif
            } else {
                /// #if !MOBILE
                const topULElement = hasTopClosestByTag(fileLiElements[0], "UL");
                if (!topULElement) {
                    return false;
                }
                const notebookId = topULElement.getAttribute("data-url");
                const pathString = fileLiElements[0].getAttribute("data-path");
                const isFile = fileLiElements[0].getAttribute("data-type") === "navigation-file";
                if (isFile) {
                    openSearch({
                        app,
                        hotkey: Constants.DIALOG_SEARCH,
                        notebookId,
                        searchPath: getDisplayName(pathString, false, true),
                    });
                } else {
                    openSearch({
                        app,
                        hotkey: Constants.DIALOG_SEARCH,
                        notebookId,
                    });
                }
                /// #endif
            }
            break;
        case "addToDatabase":
            if (!isFileFocus && range) {
                addEditorToDatabase(protyle, range);
            } else if (fileLiElements) {
                addFilesToDatabase(fileLiElements);
            }
            break;
        case "move":
            if (!isFileFocus && range) {
                const nodeElement = hasClosestBlock(range.startContainer);
                if (protyle.title?.editElement.contains(range.startContainer) || !nodeElement ||
                    window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_TITLE) {
                    movePathTo({
                        cb: (toPath, toNotebook) => {
                            moveToPath([protyle.path], toNotebook[0], toPath[0]);
                        },
                        paths: [protyle.path],
                        range,
                        flashcard: false,
                        rootIDs: [protyle.block.rootID],
                        sourceNotebookIds: [protyle.notebookId],
                    });
                } else if (protyle.element.contains(range.startContainer)) {
                    let selectElements = Array.from(
                        protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"),
                    );
                    if (selectElements.length === 0) {
                        selectElements = [nodeElement];
                    }
                    movePathTo({
                        cb: (toPath) => {
                            void hintMoveBlock(toPath[0], selectElements, protyle);
                        },
                        flashcard: false,
                        rootIDs: [protyle.block.rootID],
                        sourceNotebookIds: [protyle.notebookId],
                    });
                }
            } else if (fileLiElements) {
                const paths = getTopPaths(fileLiElements);
                const sourceNotebookIds = fileLiElements.map(item =>
                    item.getAttribute("data-notebook-id") ||
                    item.closest("ul[data-url]")?.getAttribute("data-url") || "");
                const rootIDs = fileLiElements.map(item => item.getAttribute("data-node-id"));
                movePathTo({
                    cb: (toPath, toNotebook) => {
                        moveToPath(paths, toNotebook[0], toPath[0]);
                    },
                    paths,
                    rootIDs,
                    flashcard: false,
                    sourceNotebookIds,
                });
            }
            break;
    }
};
