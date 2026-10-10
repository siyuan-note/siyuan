import {Constants} from "../../../constants";
/// #if MOBILE
import {openMobileFileById} from "../../../mobile/editor";
import {Dialog} from "../../../dialog";
import {renderAVAttribute} from "./blockAttr";
import {Protyle} from "../../index";
/// #else
import {newTab, openFile, openFileById, updatePanelByEditor} from "../../../editor/util";
import {Editor} from "../../../editor";
import {getAllTabs} from "../../../layout/getAll";
import {zoomOut} from "../../../menus/protyle";
import {Custom} from "../../../layout/dock/Custom";
import {fetchSyncPost} from "../../../util/fetch";
import {showMessage} from "../../../dialog/message";
import {switchDatabaseRow, whenDatabaseRowReady} from "../../../editor/databaseRow";
import {saveLayout} from "../../../layout/util";
/// #endif
import {searchMarkRender} from "../searchMarkRender";
import {registerDatabaseRowRefresh} from "./databaseRowRefresh";
import {focusDatabasePrimary} from "./primaryFocus";
import {preserveAVBindingRange} from "./binding";
import {inheritDatabaseRowReadonly} from "./rowReadonly";
import {getDatabaseRowNavigation, IDatabaseRowNavigation, mountDatabaseRowNavigation} from "./databaseRowNavigation";

export interface IDatabaseRowOpenData {
    avID: string;
    databaseBlockID: string;
    notebookID: string;
    itemID: string;
    valueID: string;
    title: string;
    boundBlockID?: string;
    isDetached: boolean;
    matchedValueID?: string;
    matchedKeyID?: string;
    keywords?: string[];
    focusPrimary?: boolean;
    bindPrimary?: boolean;
    navigation?: IDatabaseRowNavigation;
}

const highlightDatabaseRow = (protyle: IProtyle, rootElement: HTMLElement, data: IDatabaseRowOpenData) => {
    if (!data.keywords?.length) {
        return;
    }
    const matchedElement = data.matchedValueID ?
        rootElement.querySelector(`[data-av-id="${data.avID}"] [data-id="${data.matchedValueID}"]`) :
        rootElement.querySelector(`[data-av-id="${data.avID}"] [data-col-id="${data.matchedKeyID}"][data-row-id="${data.itemID}"]`);
    searchMarkRender(protyle, data.keywords, undefined, () => {
        matchedElement?.scrollIntoView({block: "center"});
    }, {
        rootElement,
        currentElement: matchedElement,
    });
};

/// #if MOBILE
const closeMobileDatabaseRow = () => {
    for (let i = window.siyuan.dialogs.length - 1; i >= 0; i--) {
        if (window.siyuan.dialogs[i].element.querySelector(".protyle-db-row--mobile")) {
            window.siyuan.dialogs[i].destroy();
            break;
        }
    }
};

const openMobileDatabaseRow = (protyle: Pick<IProtyle, "app">, data: IDatabaseRowOpenData, title: string) => {
    closeMobileDatabaseRow();
    const context: { ghostProtyle?: Protyle } = {};
    let unregisterRefresh: () => void;
    let renderVersion = 0;
    let destroyed = false;
    let contextProtyle: IProtyle;
    let pendingRow: {data: IDatabaseRowOpenData, resolve: (opened: boolean) => void};
    const dialog = new Dialog({
        content: `<div class="protyle-db-row protyle-db-row--mobile protyle-content">
    <div class="protyle-db-row__title"><svg><use xlink:href="#iconDatabase"></use></svg><span></span></div>
    <div class="custom-attr protyle-db-row__body"></div>
</div>`,
        width: "100vw",
        height: "100dvh",
        containerClassName: "b3-dialog__container--database-row",
        disableAnimation: true,
        destroyCallback() {
            destroyed = true;
            renderVersion++;
            pendingRow?.resolve(false);
            pendingRow = undefined;
            unregisterRefresh?.();
            context.ghostProtyle?.destroy();
        },
    });
    const rowElement = dialog.element.querySelector<HTMLElement>(".protyle-db-row");
    const mountNavigation = () => mountDatabaseRowNavigation(rowElement, data, next => {
        if (!next.isDetached && window.siyuan.config.editor.databaseAttrShow) {
            return openDatabaseRowByData(protyle, next);
        }
        if (!contextProtyle || !rowElement.isConnected) {
            return Promise.resolve(false);
        }
        pendingRow?.resolve(false);
        return new Promise<boolean>(resolve => {
            pendingRow = {data: next, resolve};
            render(contextProtyle);
        });
    });
    mountNavigation();
    rowElement.querySelector(".protyle-db-row__title span").textContent = title;
    const render = (contextProtyle: IProtyle) => {
        const previousBodyElement = rowElement.querySelector<HTMLElement>(".protyle-db-row__body");
        if (!previousBodyElement) {
            return;
        }
        const currentRenderVersion = ++renderVersion;
        const switching = pendingRow;
        const renderData = switching?.data || data;
        const bodyElement = document.createElement("div");
        bodyElement.className = "custom-attr protyle-db-row__body";
        renderAVAttribute(bodyElement, renderData.itemID, contextProtyle, (element) => {
            if (currentRenderVersion !== renderVersion || !previousBodyElement.isConnected) {
                return;
            }
            if (!element.querySelector(`[data-av-id="${renderData.avID}"]`)) {
                if (switching) {
                    pendingRow = undefined;
                    switching.resolve(false);
                    return;
                }
                dialog.destroy();
                return;
            }
            // 保留当前内容，待属性和反链加载完成后一次替换，避免刷新期间出现空白。
            const restoreBindingRange = switching ? undefined : preserveAVBindingRange(contextProtyle, previousBodyElement);
            previousBodyElement.replaceWith(element);
            restoreBindingRange?.(element);
            if (switching) {
                data = renderData;
                pendingRow = undefined;
                rowElement.scrollTop = 0;
                rowElement.querySelector(".protyle-db-row__title span").textContent = data.title || window.siyuan.languages.untitled;
                mountNavigation();
                switching.resolve(true);
            }
            const primaryElement = element.querySelector<HTMLElement>('[data-primary="true"] [data-cell-value]');
            if (primaryElement?.dataset.cellValue) {
                const value = JSON.parse(decodeURIComponent(primaryElement.dataset.cellValue)) as IAVCellValue;
                const currentTitle = value.block?.content || window.siyuan.languages.untitled;
                data.title = currentTitle;
                rowElement.querySelector(".protyle-db-row__title span").textContent = currentTitle;
            }
            highlightDatabaseRow(contextProtyle, rowElement, data);
            focusDatabasePrimary(rowElement, contextProtyle, data);
        }, {
            avID: renderData.avID,
            itemID: renderData.itemID,
            valueID: renderData.valueID,
            databaseBlockID: renderData.databaseBlockID,
        });
    };
    context.ghostProtyle = new Protyle(protyle.app, document.createElement("div"), {
        blockId: data.databaseBlockID,
        notebookId: data.notebookID,
        after(editor) {
            if (destroyed) {
                return;
            }
            contextProtyle = editor.protyle;
            inheritDatabaseRowReadonly(contextProtyle, protyle);
            rowElement.dataset.protyleId = contextProtyle.id;
            unregisterRefresh = registerDatabaseRowRefresh(contextProtyle.id, {
                getAVID: () => data.avID,
                refresh: () => render(contextProtyle),
            });
            rowElement.append(contextProtyle.highlight.styleElement, contextProtyle.hint.element);
            render(contextProtyle);
        },
    });
};
/// #else
export const showDatabaseRowPreview = (model: Editor, data: IDatabaseRowOpenData, source: Partial<IProtyle>) => {
    if (!model?.editor?.protyle) {
        return;
    }
    const editorProtyle = model.editor.protyle;
    model.databaseRow = {
        avID: data.avID, databaseBlockID: data.databaseBlockID, notebookID: data.notebookID,
        itemID: data.itemID, valueID: data.valueID, boundBlockID: data.boundBlockID,
        title: "", isDetached: data.isDetached, navigation: data.navigation,
    };
    inheritDatabaseRowReadonly(editorProtyle, source);
    editorProtyle.element.dataset.databaseRowId = data.boundBlockID || "";
    mountDesktopDatabaseRowNavigation(model, data, source);
    editorProtyle.databaseAttributePanel?.expand(data.avID);
    editorProtyle.contentElement.scrollTop = 0;
    editorProtyle.databaseAttributePanel?.afterRender(() => {
        highlightDatabaseRow(editorProtyle, editorProtyle.contentElement, data);
        focusDatabasePrimary(editorProtyle.contentElement, editorProtyle, data);
    });
    saveLayout();
};

const focusDatabaseRowPreview = (model: Editor, data: IDatabaseRowOpenData, source: Partial<IProtyle>) => {
    const editorProtyle = model?.editor?.protyle;
    if (!editorProtyle || !data.boundBlockID) {
        return;
    }
    if (editorProtyle.block.showAll && editorProtyle.block.id === data.boundBlockID) {
        showDatabaseRowPreview(model, data, source);
        return;
    }
    zoomOut({
        protyle: editorProtyle,
        id: data.boundBlockID,
        reload: true,
        callback: () => showDatabaseRowPreview(model, data, source),
    });
};

const getDatabaseRowPreviewTab = (blockID: string) => {
    return getAllTabs().find((tab) => {
        if (tab.model instanceof Editor) {
            return tab.model.editor.protyle.element.dataset.databaseRowId === blockID;
        }
        const initData = tab.headElement?.getAttribute("data-initdata");
        if (!initData) {
            return false;
        }
        try {
            const initObj = JSON.parse(initData) as ILayoutJSON;
            return initObj.instance === "Editor" && initObj.databaseRowId === blockID;
        } catch (e) {
            console.warn("Failed to parse database row tab init data:", e);
            return false;
        }
    });
};

const getCustomRowData = (data: IDatabaseRowOpenData) => ({
    ...data, blockID: data.databaseBlockID, notebookId: data.notebookID,
});

export const mountDesktopDatabaseRowNavigation = (model: Editor | Custom, data: IDatabaseRowOpenData,
                                            source: Partial<IProtyle>) => {
    const container = model instanceof Custom ? model.element.querySelector(".protyle-db-row") : model.editor.protyle.element;
    mountDatabaseRowNavigation(container, data, async next => {
        const tab = model.parent;
        const wnd = tab.parent;
        const options: IOpenFileOptions = {app: model.app};
        if (next.isDetached || !window.siyuan.config.editor.databaseAttrShow) {
            if (model instanceof Custom) {
                const opened = await switchDatabaseRow(model, getCustomRowData(next));
                if (opened) {
                    mountDesktopDatabaseRowNavigation(model, next, source);
                }
                return opened;
            }
            options.custom = {id: "siyuan-database-row", icon: "iconDatabase",
                title: next.title || window.siyuan.languages.untitled, data: getCustomRowData(next)};
        } else {
            const response = await fetchSyncPost("/api/block/getBlockInfo", {id: next.boundBlockID});
            if (response.code !== 0) {
                return false;
            }
            Object.assign(options, {id: next.boundBlockID, rootID: response.data.rootID,
                fileName: response.data.rootTitle, rootTitleEmpty: response.data.rootTitleEmpty,
                rootIcon: response.data.rootIcon, zoomIn: next.boundBlockID !== response.data.rootID});
        }
        if (!tab.panelElement.isConnected || tab.model !== model) {
            return false;
        }
        if (model instanceof Editor && model.editor.protyle.upload.isUploading) {
            showMessage(window.siyuan.languages.uploading);
            return false;
        }
        let documentLoaded: () => void;
        const loaded = new Promise<void>(resolve => { documentLoaded = resolve; });
        const opened = newTab({...options, keepCursor: true}, () => documentLoaded());
        opened.parent = wnd;
        opened.panelElement.classList.add("fn__none");
        document.body.append(opened.panelElement);
        let preparing = true;
        let cancel: () => void;
        const cancelled = new Promise<boolean>(resolve => { cancel = () => resolve(false); });
        const observer = new MutationObserver(() => {
            if (!tab.panelElement.isConnected || tab.model !== model || tab.parent !== wnd) {
                cancel();
            }
        });
        observer.observe(document.body, {childList: true, subtree: true});
        const timeout = window.setTimeout(cancel, 60000);
        let ready = false;
        try {
            // 在布局之外加载目标预览，正文和属性就绪前保留当前页签及其内容。
            opened.callback(opened);
            opened.callback = undefined;
            ready = await Promise.race([cancelled, (async () => {
                if (opened.model instanceof Custom) {
                    opened.model.element.dispatchEvent(new CustomEvent("database-row-readonly", {detail: source}));
                    opened.model.update();
                    return whenDatabaseRowReady(opened.model);
                }
                await loaded;
                if (!preparing || !(opened.model instanceof Editor)) {
                    return false;
                }
                const protyle = opened.model.editor.protyle;
                inheritDatabaseRowReadonly(protyle, source);
                protyle.databaseAttributePanel?.expand(next.avID);
                return new Promise<boolean>(resolve => {
                    if (!protyle.databaseAttributePanel) {
                        resolve(false);
                        return;
                    }
                    protyle.databaseAttributePanel.afterRender(element => {
                        resolve(!!element.querySelector(`[data-av-id="${next.avID}"]`));
                    });
                });
            })()]);
            ready = ready && tab.panelElement.isConnected && tab.model === model && tab.parent === wnd;
            if (model instanceof Editor && model.editor.protyle.upload.isUploading) {
                ready = false;
                showMessage(window.siyuan.languages.uploading);
            }
        } finally {
            preparing = false;
            observer.disconnect();
            window.clearTimeout(timeout);
            if (!ready) {
                opened.model?.destroy();
                opened.model?.send("closews", {});
                opened.panelElement.remove();
            }
        }
        if (!ready) {
            return false;
        }
        opened.panelElement.classList.remove("fn__none");
        // 复用来源预览所在的分屏，不依赖异步请求完成时用户正激活哪个分屏。
        wnd.addTab(opened, false, true, undefined, tab.id);
        if (opened.model instanceof Custom) {
            opened.model.resize();
            mountDesktopDatabaseRowNavigation(opened.model, next, source);
        } else if (opened.model instanceof Editor) {
            opened.model.editor.resize();
            showDatabaseRowPreview(opened.model, next, source);
            updatePanelByEditor({protyle: opened.model.editor.protyle,
                focus: false, pushBackStack: false, reload: false, resize: false});
        }
        return true;
    }, model instanceof Custom ? undefined : model.editor.protyle.breadcrumb?.element.parentElement);
};
/// #endif

export const openDatabaseRowByData = async (protyle: Pick<IProtyle, "app">, data: IDatabaseRowOpenData, options?: {
    position?: string,
    keepAVPanel?: boolean,
    standalone?: boolean,
}) => {
    data = {...data, navigation: data.navigation || getDatabaseRowNavigation(protyle, data)};
    const title = data.title || window.siyuan.languages.untitled;
    const openStandalone = options?.standalone || data.isDetached || !window.siyuan.config.editor.databaseAttrShow;
    /// #if MOBILE
    if (openStandalone) {
        openMobileDatabaseRow(protyle, data, title);
        return true;
    }
    if (!data.boundBlockID) {
        return false;
    }
    closeMobileDatabaseRow();
    window.siyuan.menus.menu.remove();
    openMobileFileById(protyle.app, data.boundBlockID, [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS],
        undefined, undefined, (editorProtyle) => {
            inheritDatabaseRowReadonly(editorProtyle, protyle);
            editorProtyle.element.dataset.databaseRowId = data.boundBlockID;
            mountDatabaseRowNavigation(editorProtyle.element, data, next => openDatabaseRowByData(protyle, next));
            editorProtyle.databaseAttributePanel?.expand(data.avID);
            editorProtyle.contentElement.scrollTop = 0;
            editorProtyle.databaseAttributePanel?.afterRender(() => {
                highlightDatabaseRow(editorProtyle, editorProtyle.contentElement, data);
                focusDatabasePrimary(editorProtyle.contentElement, editorProtyle, data);
            });
        }, true);
    return true;
    /// #else
    if (openStandalone) {
        if (!data.databaseBlockID) {
            return false;
        }
        const opened = await openFile({
            app: protyle.app,
            position: options?.position || "right",
            removeCurrentTab: options && !options.keepAVPanel ? undefined : false,
            openNewTab: options ? options.keepAVPanel ? false : undefined : true,
            keepAVPanel: options?.keepAVPanel,
            custom: {
                id: "siyuan-database-row",
                icon: "iconDatabase",
                title,
                data: getCustomRowData(data),
            },
            afterOpen(model) {
                if (model instanceof Custom) {
                    Object.assign(model.data, data, {blockID: data.databaseBlockID, notebookId: data.notebookID});
                    model.element.dispatchEvent(new CustomEvent("database-row-readonly", {detail: protyle}));
                    model.update();
                    mountDesktopDatabaseRowNavigation(model, data, protyle);
                    saveLayout();
                }
            },
        });
        return Boolean(opened);
    }

    if (!data.boundBlockID) {
        return false;
    }
    if (options && !options.keepAVPanel) {
        const opened = await openFileById({
            app: protyle.app,
            id: data.boundBlockID,
            position: options.position,
            zoomIn: true,
            afterOpen(model: Editor) {
                focusDatabaseRowPreview(model, data, protyle);
            },
        });
        return Boolean(opened);
    }
    const openedTab = getDatabaseRowPreviewTab(data.boundBlockID);
    if (openedTab) {
        const openedModel = openedTab.model;
        if (!(openedModel instanceof Editor)) {
            const initData = openedTab.headElement?.getAttribute("data-initdata");
            if (initData) {
                try {
                    const initObj = JSON.parse(initData) as ILayoutJSON;
                    initObj.blockId = data.boundBlockID;
                    initObj.action = Constants.CB_GET_ALL;
                    openedTab.headElement.setAttribute("data-initdata", JSON.stringify(initObj));
                } catch (e) {
                    console.warn("Failed to update database row tab init data:", e);
                }
            }
        }
        openedTab.parent.switchTab(openedTab.headElement);
        openedTab.parent.showHeading();
        if (openedModel instanceof Editor) {
            focusDatabaseRowPreview(openedModel as Editor, data, protyle);
        }
        return true;
    }
    const opened = await openFileById({
        app: protyle.app,
        id: data.boundBlockID,
        position: "right",
        openNewTab: true,
        removeCurrentTab: false,
        keepAVPanel: options?.keepAVPanel,
        zoomIn: true,
        afterOpen(model: Editor) {
            showDatabaseRowPreview(model, data, protyle);
        },
    });
    return Boolean(opened);
    /// #endif
};
