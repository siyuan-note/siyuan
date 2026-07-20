/// #if MOBILE
import {openMobileFileById} from "../../../mobile/editor";
import {Dialog} from "../../../dialog";
import {renderAVAttribute} from "./blockAttr";
import {Constants} from "../../../constants";
/// #else
import {openFile, openFileById} from "../../../editor/util";
import {Editor} from "../../../editor";
import {getAllTabs} from "../../../layout/getAll";
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
        openedTab.parent.switchTab(openedTab.headElement);
        openedTab.parent.showHeading();
        if (openedTab.model instanceof Editor) {
            showDatabaseRowPreview(openedTab.model, data.boundBlockID);
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
