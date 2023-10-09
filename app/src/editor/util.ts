import {Tab} from "../layout/Tab";
import {Editor} from "./index";
import {Wnd} from "../layout/Wnd";
import {getDockByType, getInstanceById, getWndByLayout, pdfIsLoading, setPanelFocus} from "../layout/util";
import {getAllModels, getAllTabs} from "../layout/getAll";
import {highlightById, scrollCenter} from "../util/highlightById";
import {getDisplayName, pathPosix, showFileInFolder} from "../util/pathName";
import {Constants} from "../constants";
import {setEditMode} from "../protyle/util/setEditMode";
import {Files} from "../layout/dock/Files";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {focusBlock, focusByRange} from "../protyle/util/selection";
import {onGet} from "../protyle/util/onGet";
/// #if !BROWSER
import {ipcRenderer, shell} from "electron";
import {newCardModel} from "../card/newCardTab";
/// #endif
import {pushBack} from "../util/backForward";
import {Asset} from "../asset";
import {Layout} from "../layout";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName,} from "../protyle/util/hasClosest";
import {setTitle} from "../dialog/processSystem";
import {zoomOut} from "../menus/protyle";
import {countBlockWord, countSelectWord} from "../layout/status";
import {showMessage} from "../dialog/message";
import {objEquals} from "../util/functions";
import {resize} from "../protyle/util/resize";
import {Search} from "../search";
import {App} from "../index";

export const openFileById = async (options: {
    app: App,
    id: string,
    position?: string,
    mode?: TEditorMode,
    action?: string[]
    keepCursor?: boolean
    zoomIn?: boolean
    removeCurrentTab?: boolean
    afterOpen?: () => void
}) => {
    const response = await fetchSyncPost("/api/block/getBlockInfo", {id: options.id});
    if (response.code === 3) {
        showMessage(response.msg);
        return;
    }
    return openFile({
        app: options.app,
        fileName: response.data.rootTitle,
        rootIcon: response.data.rootIcon,
        rootID: response.data.rootID,
        id: options.id,
        position: options.position,
        mode: options.mode,
        action: options.action,
        zoomIn: options.zoomIn,
        keepCursor: options.keepCursor,
        removeCurrentTab: options.removeCurrentTab,
        afterOpen: options.afterOpen
    });
};

export const openAsset = (app: App, assetPath: string, page: number | string, position?: string) => {
    const suffix = pathPosix().extname(assetPath.split("?page")[0]);
    if (!Constants.SIYUAN_ASSETS_EXTS.includes(suffix)) {
        return;
    }
    openFile({
        app,
        assetPath,
        page,
        position,
        removeCurrentTab: true
    });
};

export const openFile = async (options: IOpenFileOptions) => {
    if (typeof options.removeCurrentTab === "undefined") {
        options.removeCurrentTab = true;
    }
    const allModels = getAllModels();
    // 文档已打开
    if (options.assetPath) {
        const asset = allModels.asset.find((item) => {
            if (item.path == options.assetPath) {
                if (!pdfIsLoading(item.parent.parent.element)) {
                    item.parent.parent.switchTab(item.parent.headElement);
                    item.parent.parent.showHeading();
                    item.goToPage(options.page);
                }
                return true;
            }
        });
        if (asset) {
            if (options.afterOpen) {
                options.afterOpen();
            }
            return asset.parent;
        }
    } else if (options.custom) {
        const custom = allModels.custom.find((item) => {
            if (objEquals(item.data, options.custom.data) && (!options.custom.id || options.custom.id === item.type)) {
                if (!pdfIsLoading(item.parent.parent.element)) {
                    item.parent.parent.switchTab(item.parent.headElement);
                    item.parent.parent.showHeading();
                }
                return true;
            }
        });
        if (custom) {
            if (options.afterOpen) {
                options.afterOpen();
            }
            return custom.parent;
        }
        const hasModel = getUnInitTab(options);
        if (hasModel) {
            if (options.afterOpen) {
                options.afterOpen();
            }
            return hasModel;
        }
    } else if (options.searchData) {
        const search = allModels.search.find((item) => {
            if (objEquals(item.config, options.searchData)) {
                if (!pdfIsLoading(item.parent.parent.element)) {
                    item.parent.parent.switchTab(item.parent.headElement);
                    item.parent.parent.showHeading();
                }
                return true;
            }
        });
        if (search) {
            return search.parent;
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
            if (!pdfIsLoading(editor.parent.parent.element)) {
                switchEditor(editor, options, allModels);
            }
            if (options.afterOpen) {
                options.afterOpen();
            }
            return editor.parent;
        }
        // 没有初始化的页签无法检测到
        const hasEditor = getUnInitTab(options);
        if (hasEditor) {
            if (options.afterOpen) {
                options.afterOpen();
            }
            return hasEditor;
        }
    }

    /// #if !BROWSER
    // https://github.com/siyuan-note/siyuan/issues/7491
    let hasMatch = false;
    const optionsClone = Object.assign({}, options);
    delete optionsClone.app;
    delete optionsClone.afterOpen;
    hasMatch = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
        cmd: Constants.SIYUAN_OPEN_FILE,
        options: optionsClone,
    })
    if (hasMatch) {
        if (options.afterOpen) {
            options.afterOpen();
        }
        return;
    }
    /// #endif

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
        let createdTab: Tab;
        if ((options.position === "right" || options.position === "bottom") && wnd.children[0].headElement) {
            const direction = options.position === "right" ? "lr" : "tb";
            let targetWnd: Wnd;
            if (wnd.parent.children.length > 1 && wnd.parent instanceof Layout && wnd.parent.direction === direction) {
                wnd.parent.children.find((item, index) => {
                    if (item.id === wnd.id) {
                        let nextWnd = wnd.parent.children[index + 1];
                        if (!nextWnd) {
                            // wnd 为右侧时，应设置其为目标
                            nextWnd = wnd;
                        }
                        while (nextWnd instanceof Layout) {
                            nextWnd = nextWnd.children[0];
                        }
                        targetWnd = nextWnd;
                        return true;
                    }
                });
            }
            if (targetWnd) {
                if (pdfIsLoading(targetWnd.element)) {
                    if (options.afterOpen) {
                        options.afterOpen();
                    }
                    return;
                }
                // 在右侧/下侧打开已有页签将进行页签切换 https://github.com/siyuan-note/siyuan/issues/5366
                let hasEditor = targetWnd.children.find(item => {
                    if (item.model && item.model instanceof Editor && item.model.editor.protyle.block.rootID === options.rootID) {
                        switchEditor(item.model, options, allModels);
                        return true;
                    }
                });
                if (!hasEditor) {
                    hasEditor = getUnInitTab(options);
                    createdTab = hasEditor;
                }
                if (!hasEditor) {
                    createdTab = newTab(options);
                    targetWnd.addTab(createdTab);
                }
            } else {
                createdTab = newTab(options);
                wnd.split(direction).addTab(createdTab);
            }
            wnd.showHeading();
            if (options.afterOpen) {
                options.afterOpen();
            }
            return createdTab;
        }
        if (pdfIsLoading(wnd.element)) {
            if (options.afterOpen) {
                options.afterOpen();
            }
            return;
        }
        if (options.keepCursor && wnd.children[0].headElement) {
            createdTab = newTab(options);
            createdTab.headElement.setAttribute("keep-cursor", options.id);
            wnd.addTab(createdTab, options.keepCursor);
        } else if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            let unUpdateTab: Tab;
            // 不能 reverse, 找到也不能提前退出循环，否则 https://github.com/siyuan-note/siyuan/issues/3271
            wnd.children.find((item) => {
                if (item.headElement && item.headElement.classList.contains("item--unupdate") && !item.headElement.classList.contains("item--pin")) {
                    unUpdateTab = item;
                    if (item.headElement.classList.contains("item--focus")) {
                        // https://ld246.com/article/1658979494658
                        return true;
                    }
                }
            });
            createdTab = newTab(options);
            wnd.addTab(createdTab);
            if (unUpdateTab && options.removeCurrentTab) {
                wnd.removeTab(unUpdateTab.id, false, true, false);
            }
        } else {
            createdTab = newTab(options);
            wnd.addTab(createdTab);
        }
        wnd.showHeading();
        if (options.afterOpen) {
            options.afterOpen();
        }
        return createdTab;
    }
};

// 没有初始化的页签无法检测到
const getUnInitTab = (options: IOpenFileOptions) => {
    return getAllTabs().find(item => {
        const initData = item.headElement?.getAttribute("data-initdata");
        if (initData) {
            const initObj = JSON.parse(initData);
            if (initObj.instance === "Editor" &&
                (initObj.rootId === options.rootID || initObj.blockId === options.rootID)) {
                initObj.blockId = options.id;
                initObj.mode = options.mode;
                if (options.zoomIn) {
                    initObj.action = [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS];
                } else {
                    initObj.action = options.action;
                }
                delete initObj.scrollAttr;
                item.headElement.setAttribute("data-initdata", JSON.stringify(initObj));
                item.parent.switchTab(item.headElement);
                return true;
            } else if (initObj.instance === "Custom" && options.custom && objEquals(initObj.customModelData, options.custom.data)) {
                item.parent.switchTab(item.headElement);
                return true;
            }
        }
    });
};

const switchEditor = (editor: Editor, options: IOpenFileOptions, allModels: IModels) => {
    allModels.editor.forEach((item) => {
        if (!item.element.isSameNode(editor.element) && window.siyuan.editorIsFullscreen && item.element.classList.contains("fullscreen")) {
            item.element.classList.remove("fullscreen");
            resize(item.editor.protyle);
        }
    });
    if (window.siyuan.editorIsFullscreen) {
        editor.element.classList.add("fullscreen");
        resize(editor.editor.protyle);
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
        zoomOut({protyle: editor.editor.protyle, id: options.id});
        return true;
    }
    let nodeElement: Element;
    Array.from(editor.editor.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${options.id}"]`)).find(item => {
        if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
            nodeElement = item;
            return true;
        }
    });
    if ((!nodeElement || nodeElement?.clientHeight === 0) && options.id !== options.rootID) {
        fetchPost("/api/filetree/getDoc", {
            id: options.id,
            mode: (options.action && options.action.includes(Constants.CB_GET_CONTEXT)) ? 3 : 0,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet({data: getResponse, protyle: editor.editor.protyle, action: options.action});
            // 大纲点击折叠标题下的内容时，需更新反链面板
            updateBacklinkGraph(allModels, editor.editor.protyle);
        });
    } else {
        if (options.action?.includes(Constants.CB_GET_HL)) {
            highlightById(editor.editor.protyle, options.id, true);
        } else if (options.action?.includes(Constants.CB_GET_FOCUS)) {
            if (nodeElement) {
                const newRange = focusBlock(nodeElement);
                if (newRange) {
                    // 需要更新 range，否则文档大纲点击导致切换页签时因为 resize 中 `保持光标位置不变` 会导致光标跳动
                    editor.editor.protyle.toolbar.range = newRange;
                }
                scrollCenter(editor.editor.protyle, nodeElement, true);
            } else if (editor.editor.protyle.block.rootID === options.id) {
                // 由于 https://github.com/siyuan-note/siyuan/issues/5420，移除定位
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
                    tab.addModel(new Asset({
                        app: options.app,
                        tab,
                        path: options.assetPath,
                        page: options.page,
                    }));
                    setPanelFocus(tab.panelElement.parentElement.parentElement);
                }
            });
        }
    } else if (options.custom) {
        tab = new Tab({
            icon: options.custom.icon,
            title: options.custom.title,
            callback(tab) {
                if (options.custom.id) {
                    if (options.custom.id === "siyuan-card") {
                        tab.addModel(newCardModel({
                            app: options.app,
                            tab,
                            data: options.custom.data
                        }));
                    } else {
                        options.app.plugins.find(p => {
                            if (p.models[options.custom.id]) {
                                tab.addModel(p.models[options.custom.id]({
                                    tab,
                                    data: options.custom.data
                                }));
                                return true;
                            }
                        });
                    }
                } else {
                    // plugin 0.8.3 历史兼容
                    console.warn("0.8.3 将移除 custom.fn 参数，请参照 https://github.com/siyuan-note/plugin-sample/blob/91a716358941791b4269241f21db25fd22ae5ff5/src/index.ts 将其修改为 custom.id");
                    tab.addModel(options.custom.fn({
                        tab,
                        data: options.custom.data
                    }));
                }
                setPanelFocus(tab.panelElement.parentElement.parentElement);
            }
        });
    } else if (options.searchData) {
        tab = new Tab({
            icon: "iconSearch",
            title: window.siyuan.languages.search,
            callback(tab) {
                tab.addModel(new Search({
                    app: options.app,
                    tab,
                    config: options.searchData
                }));
                setPanelFocus(tab.panelElement.parentElement.parentElement);
            }
        });
    } else {
        tab = new Tab({
            title: getDisplayName(options.fileName, true, true),
            docIcon: options.rootIcon,
            callback(tab) {
                let editor;
                if (options.zoomIn) {
                    editor = new Editor({
                        app: options.app,
                        tab,
                        blockId: options.id,
                        action: [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS],
                    });
                } else {
                    editor = new Editor({
                        app: options.app,
                        tab,
                        blockId: options.id,
                        mode: options.mode,
                        action: options.action,
                    });
                }
                tab.addModel(editor);
            }
        });
    }
    return tab;
};

export const updatePanelByEditor = (options: {
    protyle?: IProtyle,
    focus: boolean,
    pushBackStack: boolean,
    reload: boolean,
    resize: boolean
}) => {
    let title = window.siyuan.languages.siyuanNote;
    if (options.protyle && options.protyle.path) {
        // https://ld246.com/article/1637636106054/comment/1641485541929#comments
        if (options.protyle.element.classList.contains("fn__none") ||
            (!hasClosestByClassName(options.protyle.element, "layout__wnd--active") &&
                document.querySelector(".layout__wnd--active")  // https://github.com/siyuan-note/siyuan/issues/4414
            )
        ) {
            return;
        }
        if (options.protyle.title) {
            title = options.protyle.title.editElement.textContent;
        }
        if (options.resize) {
            resize(options.protyle);
        }
        if (options.focus) {
            if (options.protyle.toolbar.range) {
                focusByRange(options.protyle.toolbar.range);
                countSelectWord(options.protyle.toolbar.range, options.protyle.block.rootID);
                if (options.pushBackStack && options.protyle.preview.element.classList.contains("fn__none")) {
                    pushBack(options.protyle, options.protyle.toolbar.range);
                }
            } else {
                focusBlock(options.protyle.wysiwyg.element.firstElementChild);
                if (options.pushBackStack && options.protyle.preview.element.classList.contains("fn__none")) {
                    pushBack(options.protyle, undefined, options.protyle.wysiwyg.element.firstElementChild);
                }
                countBlockWord([], options.protyle.block.rootID);
            }
        }
        if (window.siyuan.config.fileTree.alwaysSelectOpenedFile && options.protyle) {
            const fileModel = getDockByType("file")?.data.file;
            if (fileModel instanceof Files) {
                const target = fileModel.element.querySelector(`li[data-path="${options.protyle.path}"]`);
                if (!target || (target && !target.classList.contains("b3-list-item--focus"))) {
                    fileModel.selectItem(options.protyle.notebookId, options.protyle.path);
                }
            }
        }
    }
    // 切换页签或关闭所有页签时，需更新对应的面板
    const models = getAllModels();
    updateOutline(models, options.protyle, options.reload);
    updateBacklinkGraph(models, options.protyle);
    setTitle(title);
};

export const isCurrentEditor = (blockId: string) => {
    const activeElement = document.querySelector(".layout__wnd--active > .fn__flex > .layout-tab-bar > .item--focus");
    if (activeElement) {
        const tab = getInstanceById(activeElement.getAttribute("data-id"));
        if (tab instanceof Tab && tab.model instanceof Editor) {
            if (tab.model.editor.protyle.block.rootID !== blockId &&
                tab.model.editor.protyle.block.parentID !== blockId &&  // updateBacklinkGraph 时会传入 parentID
                tab.model.editor.protyle.block.id !== blockId) {
                return false;
            }
        }
    }
    return true;
};

export const updateOutline = (models: IModels, protyle: IProtyle, reload = false) => {
    models.outline.find(item => {
        if (reload || (item.type === "pin" && (!protyle || item.blockId !== protyle.block?.rootID))) {
            let blockId = "";
            if (protyle && protyle.block) {
                blockId = protyle.block.rootID;
            }
            if (blockId === item.blockId && !reload) {
                return;
            }
            if (protyle && !protyle.preview.element.classList.contains("fn__none")) {
                protyle.preview.render(protyle);
                return;
            }
            fetchPost("/api/outline/getDocOutline", {
                id: blockId,
            }, response => {
                if (!reload && (!isCurrentEditor(blockId) || item.blockId === blockId)) {
                    return;
                }
                item.isPreview = false;
                item.update(response, blockId);
                if (protyle) {
                    item.updateDocTitle(protyle.background.ial);
                    if (getSelection().rangeCount > 0) {
                        const startContainer = getSelection().getRangeAt(0).startContainer;
                        if (protyle.wysiwyg.element.contains(startContainer)) {
                            const currentElement = hasClosestByAttribute(startContainer, "data-node-id", null);
                            if (currentElement) {
                                item.setCurrent(currentElement);
                            }
                        }
                    }
                } else {
                    item.updateDocTitle();
                }
            });
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
            item.searchGraph(true, blockId);
        }
    });
    models.backlink.forEach(item => {
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
        fetchPost("/api/ref/getBacklink2", {
            sort: item.status[blockId] ? item.status[blockId].sort : "3",
            mSort: item.status[blockId] ? item.status[blockId].mSort : "3",
            id: blockId || "",
            k: item.inputsElement[0].value,
            mk: item.inputsElement[1].value,
        }, response => {
            if (!isCurrentEditor(blockId) || item.blockId === blockId) {
                item.element.querySelector('.block__icon[data-type="refresh"] svg').classList.remove("fn__rotate");
                return;
            }
            item.saveStatus();
            item.blockId = blockId;
            item.render(response.data);
        });
    });
};

export const openBy = (url: string, type: "folder" | "app") => {
    /// #if !BROWSER
    if (url.startsWith("assets/")) {
        fetchPost("/api/asset/resolveAssetPath", {path: url.replace(/\.pdf\?page=\d{1,}$/, ".pdf")}, (response) => {
            if (type === "app") {
                shell.openPath(response.data);
            } else if (type === "folder") {
                showFileInFolder(response.data);
            }
        });
        return;
    }
    let address = "";
    if ("windows" === window.siyuan.config.system.os) {
        // `file://` 协议兼容 Window 平台使用 `/` 作为目录分割线 https://github.com/siyuan-note/siyuan/issues/5681
        address = url.replace("file:///", "").replace("file://\\", "").replace("file://", "").replace(/\//g, "\\");
    } else {
        address = url.replace("file://", "");
    }
    // 拖入文件名包含 `)` 、`(` 的文件以 `file://` 插入后链接解析错误 https://github.com/siyuan-note/siyuan/issues/5786
    address = address.replace(/\\\)/g, ")").replace(/\\\(/g, "(");
    if (type === "app") {
        shell.openPath(address);
    } else if (type === "folder") {
        if ("windows" === window.siyuan.config.system.os) {
            if (!address.startsWith("\\\\")) { // \\ 开头的路径是 Windows 网络共享路径 https://github.com/siyuan-note/siyuan/issues/5980
                // Windows 端打开本地文件所在位置失效 https://github.com/siyuan-note/siyuan/issues/5808
                address = address.replace(/\\\\/g, "\\");
            }
        }
        showFileInFolder(address);
    }
    /// #endif
};
