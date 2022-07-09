import {Tab} from "../layout/Tab";
import {Editor} from "./index";
import {Wnd} from "../layout/Wnd";
import {getDockByType, getInstanceById, getWndByLayout} from "../layout/util";
import {getAllModels} from "../layout/getAll";
import {highlightById, scrollCenter} from "../util/highlightById";
import {getDisplayName, pathPosix} from "../util/pathName";
import {Constants} from "../constants";
import {setEditMode} from "../protyle/util/setEditMode";
import {Files} from "../layout/dock/Files";
import {setPadding} from "../protyle/ui/initUI";
import {fetchPost} from "../util/fetch";
import {showMessage} from "../dialog/message";
import {focusBlock, focusByRange} from "../protyle/util/selection";
import {onGet} from "../protyle/util/onGet";
/// #if !BROWSER
import {shell} from "electron";
/// #endif
import {pushBack} from "../util/backForward";
import {Asset} from "../asset";
import {Layout} from "../layout";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
} from "../protyle/util/hasClosest";
import {getPreviousHeading} from "../protyle/wysiwyg/getBlock";
import {lockFile, setTitle} from "../dialog/processSystem";
import {zoomOut} from "../menus/protyle";
import {countBlockWord, countSelectWord} from "../layout/status";

export const openFileById = (options: {
    id: string,
    position?: string,
    mode?: TEditorMode,
    hasContext?: boolean,
    action?: string[]
    keepCursor?: boolean
    zoomIn?: boolean
}) => {
    fetchPost("/api/block/getBlockInfo", {id: options.id}, (data) => {
        if (data.code === 2) {
            // 文件被锁定
            lockFile(data.data);
            return;
        }
        openFile({
            fileName: data.data.rootTitle,
            rootIcon: data.data.rootIcon,
            id: options.id,
            rootID: data.data.rootID,
            position: options.position,
            mode: options.mode,
            hasContext: options.hasContext,
            action: options.action,
            zoomIn: options.zoomIn,
            keepCursor: options.keepCursor
        });
    });
};

export const openAsset = (assetPath: string, page: number | string, position?: string) => {
    openFile({
        assetPath,
        page,
        position
    });
};

const openFile = (options: IOpenFileOptions) => {
    const allModels = getAllModels();
    // 文档已打开
    if (options.assetPath) {
        const asset = allModels.asset.find((item) => {
            if (item.path == options.assetPath) {
                item.parent.parent.switchTab(item.parent.headElement);
                item.parent.parent.showHeading();
                item.goToPage(options.page);
                return true;
            }
        });
        if (asset) {
            return;
        }
    } else if (!options.position) {
        let editor: Editor;
        let activeEditor: Editor;
        allModels.editor.find((item) => {
            if (item.editor.protyle.block.rootID === options.rootID) {
                if (hasClosestByClassName(item.element, "layout__wnd--active")) {
                    activeEditor = item;
                }
                editor = item;
            }
            if (activeEditor) {
                return true;
            }
        });
        if (activeEditor) {
            editor = activeEditor;
        }
        if (editor) {
            switchEditor(editor, options, allModels);
            return true;
        }
    }

    let wnd: Wnd = undefined;
    // 获取光标所在 tab
    const element = document.querySelector(".layout__wnd--active");
    if (element) {
        wnd = getInstanceById(element.getAttribute("data-id")) as Wnd;
    }
    if (!wnd) {
        // 中心 tab
        wnd = getWndByLayout(window.siyuan.layout.centerLayout);
    }
    if (wnd) {
        if ((options.position === "right" || options.position === "bottom") && wnd.children[0].model) {
            const direction = options.position === "right" ? "lr" : "tb";
            let targetWnd: Wnd;
            if (wnd.parent.children.length > 1 && wnd.parent instanceof Layout && wnd.parent.direction === direction) {
                wnd.parent.children.find((item, index) => {
                    if (item.id === wnd.id) {
                        let nextWnd = wnd.parent.children[index + 1];
                        while (nextWnd instanceof Layout) {
                            nextWnd = nextWnd.children[0];
                        }
                        targetWnd = nextWnd;
                        return true;
                    }
                });
            }
            if (targetWnd) {
                // 在右侧/下侧打开已有页签将进行页签切换 https://github.com/siyuan-note/siyuan/issues/5366
                const hasEditor = targetWnd.children.find(item => {
                    if (item.model && item.model instanceof Editor && item.model.editor.protyle.block.rootID === options.rootID) {
                        switchEditor(item.model, options, allModels);
                        return true;
                    }
                });
                if (!hasEditor) {
                    targetWnd.addTab(newTab(options));
                }
            } else {
                wnd.split(direction).addTab(newTab(options));
            }
        } else if (options.keepCursor && wnd.children[0].model) {
            const tab = newTab(options);
            tab.headElement.setAttribute("keep-cursor", options.id);
            wnd.addTab(tab, options.keepCursor);
        } else if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            let unUpdateTab: Tab;
            // 不能 reverse, 找到也不能提前退出循环，否则 https://github.com/siyuan-note/siyuan/issues/3271
            wnd.children.forEach((item) => {
                if (item.headElement && item.headElement.classList.contains("item--unupdate") && !item.headElement.classList.contains("item--pin")) {
                    unUpdateTab = item;
                }
            });
            wnd.addTab(newTab(options));
            if (unUpdateTab && !window.siyuan.ctrlIsPressed) {
                wnd.removeTab(unUpdateTab.id);
            }
        } else {
            wnd.addTab(newTab(options));
        }
        wnd.showHeading();
    }
};

const switchEditor = (editor: Editor, options: IOpenFileOptions, allModels: IModels) => {
    allModels.editor.forEach((item) => {
        if (!item.element.isSameNode(editor.element) && window.siyuan.editorIsFullscreen && item.element.classList.contains("fullscreen")) {
            item.element.classList.remove("fullscreen");
            setPadding(item.editor.protyle);
        }
    });
    if (window.siyuan.editorIsFullscreen) {
        editor.element.classList.add("fullscreen");
        setPadding(editor.editor.protyle);
    }
    if (options.keepCursor) {
        editor.parent.headElement.setAttribute("keep-cursor", options.id);
        return true;
    }
    editor.parent.parent.switchTab(editor.parent.headElement);
    editor.parent.parent.showHeading();
    if (options.mode !== "preview" && !editor.editor.protyle.preview.element.classList.contains("fn__none")) {
        // TODO https://github.com/siyuan-note/siyuan/issues/3059
        return true;
    }
    if (options.zoomIn) {
        zoomOut(editor.editor.protyle, options.id);
        return true;
    }
    let nodeElement = editor.editor.protyle.wysiwyg.element.querySelector(`[data-node-id="${options.id}"]`);
    if ((!nodeElement || nodeElement?.clientHeight === 0) && options.id !== options.rootID) {
        fetchPost("/api/filetree/getDoc", {
            id: options.id,
            mode: options.hasContext ? 3 : 0,
            size: Constants.SIZE_GET,
        }, getResponse => {
            onGet(getResponse, editor.editor.protyle, options.action);
        });
    } else {
        if (options.action.includes(Constants.CB_GET_HL)) {
            highlightById(editor.editor.protyle, options.id, true);
        } else if (options.action.includes(Constants.CB_GET_FOCUS)) {
            if (nodeElement) {
                focusBlock(nodeElement);
                scrollCenter(editor.editor.protyle, nodeElement, true);
            } else if (editor.editor.protyle.block.rootID === options.id) {
                if (editor.editor.protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-index") === "0") {
                    focusBlock(editor.editor.protyle.wysiwyg.element.firstElementChild);
                    editor.editor.protyle.contentElement.scrollTop = 0;
                } else {
                    // 动态加载
                    fetchPost("/api/filetree/getDoc", {
                        id: options.id,
                        mode: 3,
                        size: Constants.SIZE_GET,
                    }, getResponse => {
                        onGet(getResponse, editor.editor.protyle, options.action);
                    });
                }
            } else if (editor.editor.protyle.toolbar.range) {
                nodeElement = hasClosestBlock(editor.editor.protyle.toolbar.range.startContainer) as Element;
                focusByRange(editor.editor.protyle.toolbar.range);
                if (nodeElement) {
                    scrollCenter(editor.editor.protyle, nodeElement);
                }
            }
        }
        pushBack(editor.editor.protyle, undefined, nodeElement || editor.editor.protyle.wysiwyg.element.firstElementChild);
    }
    if (options.mode) {
        setEditMode(editor.editor.protyle, options.mode);
    }
};

const newTab = (options: IOpenFileOptions) => {
    let tab: Tab;
    if (options.assetPath) {
        const suffix = pathPosix().extname(options.assetPath.split("?page")[0]);
        if (Constants.SIYUAN_ASSETS_EXTS.includes(suffix)) {
            let icon = "iconPDF";
            if (Constants.SIYUAN_ASSETS_IMAGE.includes(suffix)) {
                icon = "iconImage";
            } else if (Constants.SIYUAN_ASSETS_AUDIO.includes(suffix)) {
                icon = "iconRecord";
            } else if (Constants.SIYUAN_ASSETS_VIDEO.includes(suffix)) {
                icon = "iconVideo";
            }
            tab = new Tab({
                icon,
                title: getDisplayName(options.assetPath),
                callback(tab) {
                    const asset = new Asset({
                        tab,
                        path: options.assetPath,
                        page: options.page,
                    });
                    tab.addModel(asset);
                }
            });
        }
    } else {
        tab = new Tab({
            title: getDisplayName(options.fileName, true, true),
            docIcon: options.rootIcon,
            callback(tab) {
                let editor;
                if (options.zoomIn) {
                    editor = new Editor({
                        tab,
                        blockId: options.id,
                        action: [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS],
                    });
                } else {
                    editor = new Editor({
                        tab,
                        blockId: options.id,
                        mode: options.mode,
                        hasContext: options.hasContext,
                        action: options.action,
                    });
                }
                tab.addModel(editor);
            }
        });
    }
    return tab;
};

export const updatePanelByEditor = (protyle?: IProtyle, focus = true, pushBackStack = false, reload = false) => {
    let title = window.siyuan.languages.siyuanNote;
    if (protyle && protyle.path) {
        // https://ld246.com/article/1637636106054/comment/1641485541929#comments
        if (protyle.element.classList.contains("fn__none") ||
            (!hasClosestByClassName(protyle.element, "layout__wnd--active") &&
                document.querySelector(".layout__wnd--active")  // https://github.com/siyuan-note/siyuan/issues/4414
            )
        ) {
            return;
        }
        title = protyle.title.editElement.textContent;
        setPadding(protyle);
        if (focus) {
            if (protyle.toolbar.range) {
                focusByRange(protyle.toolbar.range);
                countSelectWord(protyle.toolbar.range);
                if (pushBackStack && protyle.preview.element.classList.contains("fn__none")) {
                    pushBack(protyle, protyle.toolbar.range);
                }
            } else {
                focusBlock(protyle.wysiwyg.element.firstElementChild);
                if (pushBackStack && protyle.preview.element.classList.contains("fn__none")) {
                    pushBack(protyle, undefined, protyle.wysiwyg.element.firstElementChild);
                }
                // 用于清空状态栏字数统计
                countBlockWord([]);
            }
        }
        if (window.siyuan.config.fileTree.alwaysSelectOpenedFile && protyle) {
            const fileModel = getDockByType("file")?.data.file;
            if (fileModel instanceof Files) {
                fileModel.selectItem(protyle.notebookId, protyle.path);
            }
        }
        const models = getAllModels();
        updateOutline(models, protyle, reload);
        updateBacklinkGraph(models, protyle);
    } else {
        // 关闭所有页签时，需更新对应的面板
        const models = getAllModels();
        updateOutline(models, protyle, reload);
        updateBacklinkGraph(models, protyle);
    }
    setTitle(title);
};

const updateOutline = (models: IModels, protyle: IProtyle, reload = false) => {
    models.outline.find(item => {
        if (reload || (item.type === "pin" && (!protyle || item.blockId !== protyle.block?.rootID))) {
            let blockId = "";
            if (protyle && protyle.block) {
                blockId = protyle.block.rootID;
            }
            if (blockId === item.blockId && !reload) {
                return;
            }
            fetchPost("/api/outline/getDocOutline", {
                id: blockId,
            }, response => {
                item.update(response, blockId);
                if (protyle) {
                    item.updateDocTitle(protyle.background.ial);
                    if (getSelection().rangeCount > 0) {
                        const startContainer = getSelection().getRangeAt(0).startContainer;
                        if (protyle.wysiwyg.element.contains(startContainer)) {
                            const currentElement = hasClosestByAttribute(startContainer, "data-node-id", null);
                            if (currentElement) {
                                if (currentElement.getAttribute("data-type") === "NodeHeading") {
                                    item.setCurrent(currentElement.getAttribute("data-node-id"));
                                } else {
                                    const headingElement = getPreviousHeading(currentElement);
                                    if (headingElement) {
                                        item.setCurrent(headingElement.getAttribute("data-node-id"));
                                    }
                                }
                            }
                        }
                    }
                } else {
                    item.updateDocTitle();
                }
            });
            return;
        }
    });
};

export const updateBacklinkGraph = (models: IModels, protyle: IProtyle) => {
    // https://ld246.com/article/1637636106054/comment/1641485541929#comments
    if (protyle && protyle.element.classList.contains("fn__none") ||
        (protyle && !hasClosestByClassName(protyle.element, "layout__wnd--active") &&
            document.querySelector(".layout__wnd--active")  // https://github.com/siyuan-note/siyuan/issues/4414
        )
    ) {
        return;
    }
    models.graph.forEach(item => {
        if (item.type !== "global" && (!protyle || item.blockId !== protyle.block?.id)) {
            if (item.type === "local" && item.rootId !== protyle?.block?.rootID) {
                return;
            }
            let blockId = "";
            if (protyle && protyle.block) {
                blockId = protyle.block.showAll ? protyle.block.id : protyle.block.parentID;
            }
            if (blockId === item.blockId) {
                return;
            }
            item.blockId = blockId;
            item.searchGraph(true);
        }
    });
    models.backlinks.forEach(item => {
        if (item.type === "local" && item.rootId !== protyle?.block?.rootID) {
            return;
        }
        let blockId = "";
        if (protyle && protyle.block) {
            blockId = protyle.block.showAll ? protyle.block.id : protyle.block.parentID;
        }
        if (blockId === item.blockId) {
            return;
        }
        item.element.querySelector('.block__icon[data-type="refresh"] svg').classList.add("fn__rotate");
        fetchPost("/api/ref/getBacklink", {
            id: blockId || "",
            beforeLen: item.element.querySelector('.block__icon[data-type="more"]').classList.contains("ft__primary") ? item.beforeLen * 20 : item.beforeLen,
            k: item.inputsElement[0].value,
            mk: item.inputsElement[1].value,
        }, response => {
            item.blockId = blockId;
            item.render(response.data);
        });
    });
};

export const openBy = (url: string, type: "folder" | "app") => {
    /// #if !BROWSER
    let address;
    if (url.startsWith("assets/")) {
        fetchPost("/api/asset/resolveAssetPath", {path: url.replace(/\.pdf\?page=\d{1,}$/, ".pdf")}, (response) => {
            if (type === "app") {
                shell.openPath(response.data);
            } else if (type === "folder") {
                shell.showItemInFolder(response.data);
            }
        });
        return;
    } else {
        address = url.replace("file://", "");
    }

    if (type === "app") {
        shell.openPath(address);
    } else if (type === "folder") {
        shell.showItemInFolder(address);
    }
    /// #endif
};
