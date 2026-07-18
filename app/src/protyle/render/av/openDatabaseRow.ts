import {openFile, openFileById} from "../../../editor/util";
import {Editor} from "../../../editor";
import {getAllTabs} from "../../../layout/getAll";

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

export const openDatabaseRowByData = (protyle: IProtyle, data: IDatabaseRowOpenData) => {
    const title = data.title || window.siyuan.languages.untitled;
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
};
