import {Constants} from "../../../constants";
/// #if MOBILE
import {openMobileFileById} from "../../../mobile/editor";
import {Dialog} from "../../../dialog";
import {renderAVAttribute} from "./blockAttr";
/// #else
import {openFile, openFileById} from "../../../editor/util";
import {Editor} from "../../../editor";
import {getAllTabs} from "../../../layout/getAll";
import {zoomOut} from "../../../menus/protyle";
/// #endif

export interface IDatabaseRowOpenData {
    avID: string;
    databaseBlockID: string;
    notebookID: string;
    itemID: string;
    valueID: string;
    title: string;
    boundBlockID?: string;
    isDetached: boolean;
}

/// #if MOBILE
const closeMobileDatabaseRow = () => {
    for (let i = window.siyuan.dialogs.length - 1; i >= 0; i--) {
        if (window.siyuan.dialogs[i].element.querySelector(".protyle-db-row--mobile")) {
            window.siyuan.dialogs[i].destroy();
            break;
        }
    }
};

const openMobileDetachedDatabaseRow = (protyle: IProtyle, data: IDatabaseRowOpenData, title: string) => {
    closeMobileDatabaseRow();
    const dialog = new Dialog({
        content: `<div class="protyle-db-row protyle-db-row--mobile">
    <div class="protyle-db-row__title"><svg><use xlink:href="#iconDatabase"></use></svg><span></span></div>
    <div class="custom-attr protyle-db-row__body"></div>
</div>`,
        width: "100vw",
        height: "100dvh",
        containerClassName: "b3-dialog__container--database-row",
        disableAnimation: true,
    });
    const rowElement = dialog.element.querySelector<HTMLElement>(".protyle-db-row");
    rowElement.dataset.protyleId = protyle.id;
    rowElement.querySelector(".protyle-db-row__title span").textContent = title;
    renderAVAttribute(rowElement.querySelector<HTMLElement>(".protyle-db-row__body"), data.itemID, protyle, undefined, {
        avID: data.avID,
        itemID: data.itemID,
        valueID: data.valueID,
    });
};
/// #else
const showDatabaseRowPreview = (model: Editor, blockID: string) => {
    if (!model?.editor?.protyle) {
        return;
    }
    model.editor.protyle.element.dataset.databaseRowId = blockID;
    model.editor.protyle.databaseAttributePanel?.expand();
    model.editor.protyle.contentElement.scrollTop = 0;
};

const focusDatabaseRowPreview = (model: Editor, blockID: string) => {
    const editorProtyle = model?.editor?.protyle;
    if (!editorProtyle) {
        return;
    }
    if (editorProtyle.block.showAll && editorProtyle.block.id === blockID) {
        showDatabaseRowPreview(model, blockID);
        return;
    }
    zoomOut({
        protyle: editorProtyle,
        id: blockID,
        reload: true,
        callback: () => showDatabaseRowPreview(model, blockID),
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

export const openDatabaseRowByData = (protyle: IProtyle, data: IDatabaseRowOpenData) => {
    const title = data.title || window.siyuan.languages.untitled;
    /// #if MOBILE
    if (data.isDetached) {
        openMobileDetachedDatabaseRow(protyle, data, title);
        return;
    }
    if (!data.boundBlockID) {
        return;
    }
    closeMobileDatabaseRow();
    window.siyuan.menus.menu.remove();
    openMobileFileById(protyle.app, data.boundBlockID, [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS],
        undefined, undefined, (editorProtyle) => {
            editorProtyle.element.dataset.databaseRowId = data.boundBlockID;
            editorProtyle.databaseAttributePanel?.expand();
            editorProtyle.contentElement.scrollTop = 0;
        }, true);
    /// #else
    if (data.isDetached) {
        if (!data.databaseBlockID) {
            return;
        }
        openFile({
            app: protyle.app,
            position: "right",
            removeCurrentTab: false,
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
                },
            },
        });
        return;
    }

    if (!data.boundBlockID) {
        return;
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
            focusDatabaseRowPreview(openedModel, data.boundBlockID);
        }
        return;
    }
    openFileById({
        app: protyle.app,
        id: data.boundBlockID,
        position: "right",
        openNewTab: true,
        removeCurrentTab: false,
        zoomIn: true,
        afterOpen(model: Editor) {
            showDatabaseRowPreview(model, data.boundBlockID);
        },
    });
    /// #endif
};
