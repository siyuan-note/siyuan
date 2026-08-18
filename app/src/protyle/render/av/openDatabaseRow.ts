import {Constants} from "../../../constants";
/// #if MOBILE
import {openMobileFileById} from "../../../mobile/editor";
import {Dialog} from "../../../dialog";
import {renderAVAttribute} from "./blockAttr";
import {Protyle} from "../../index";
/// #else
import {openFile, openFileById} from "../../../editor/util";
import {Editor} from "../../../editor";
import {getAllTabs} from "../../../layout/getAll";
import {zoomOut} from "../../../menus/protyle";
import {Custom} from "../../../layout/dock/Custom";
/// #endif
import {searchMarkRender} from "../searchMarkRender";

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

const openMobileDatabaseRow = (protyle: IProtyle, data: IDatabaseRowOpenData, title: string) => {
    closeMobileDatabaseRow();
    const context: { ghostProtyle?: Protyle } = {};
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
            context.ghostProtyle?.destroy();
        },
    });
    const rowElement = dialog.element.querySelector<HTMLElement>(".protyle-db-row");
    rowElement.dataset.protyleId = protyle.id;
    rowElement.querySelector(".protyle-db-row__title span").textContent = title;
    context.ghostProtyle = new Protyle(protyle.app, document.createElement("div"), {
        blockId: data.databaseBlockID,
        notebookId: data.notebookID,
        after(editor) {
            const contextProtyle = editor.protyle;
            rowElement.dataset.protyleId = contextProtyle.id;
            rowElement.append(contextProtyle.highlight.styleElement);
            renderAVAttribute(rowElement.querySelector<HTMLElement>(".protyle-db-row__body"), data.itemID, contextProtyle, () => {
                highlightDatabaseRow(contextProtyle, rowElement, data);
            }, {
                avID: data.avID,
                itemID: data.itemID,
                valueID: data.valueID,
            });
        },
    });
};
/// #else
const showDatabaseRowPreview = (model: Editor, data: IDatabaseRowOpenData) => {
    if (!model?.editor?.protyle) {
        return;
    }
    const editorProtyle = model.editor.protyle;
    editorProtyle.element.dataset.databaseRowId = data.boundBlockID || "";
    editorProtyle.databaseAttributePanel?.expand(data.avID);
    editorProtyle.contentElement.scrollTop = 0;
    editorProtyle.databaseAttributePanel?.afterRender(() => {
        highlightDatabaseRow(editorProtyle, editorProtyle.contentElement, data);
    });
};

const focusDatabaseRowPreview = (model: Editor, data: IDatabaseRowOpenData) => {
    const editorProtyle = model?.editor?.protyle;
    if (!editorProtyle || !data.boundBlockID) {
        return;
    }
    if (editorProtyle.block.showAll && editorProtyle.block.id === data.boundBlockID) {
        showDatabaseRowPreview(model, data);
        return;
    }
    zoomOut({
        protyle: editorProtyle,
        id: data.boundBlockID,
        reload: true,
        callback: () => showDatabaseRowPreview(model, data),
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
/// #endif

export const openDatabaseRowByData = async (protyle: IProtyle, data: IDatabaseRowOpenData, options?: {
    position?: string,
    keepAVPanel?: boolean,
}) => {
    const title = data.title || window.siyuan.languages.untitled;
    const openStandalone = data.isDetached || !window.siyuan.config.editor.databaseAttrShow;
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
            editorProtyle.element.dataset.databaseRowId = data.boundBlockID;
            editorProtyle.databaseAttributePanel?.expand(data.avID);
            editorProtyle.contentElement.scrollTop = 0;
            editorProtyle.databaseAttributePanel?.afterRender(() => {
                highlightDatabaseRow(editorProtyle, editorProtyle.contentElement, data);
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
                data: {
                    avID: data.avID,
                    blockID: data.databaseBlockID,
                    notebookId: data.notebookID,
                    itemID: data.itemID,
                    valueID: data.valueID,
                    title,
                    matchedValueID: data.matchedValueID,
                    matchedKeyID: data.matchedKeyID,
                    keywords: data.keywords,
                },
            },
            afterOpen(model) {
                if (model instanceof Custom) {
                    Object.assign(model.data, data, {blockID: data.databaseBlockID, notebookId: data.notebookID});
                    model.update();
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
                focusDatabaseRowPreview(model, data);
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
            focusDatabaseRowPreview(openedModel as Editor, data);
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
            showDatabaseRowPreview(model, data);
        },
    });
    return Boolean(opened);
    /// #endif
};
