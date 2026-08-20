import {Constants} from "../../../constants";
/// #if !MOBILE
import {openFileById} from "../../../editor/util";
/// #endif
import {openMobileFileById} from "../../../mobile/editor";
import {activateQueuedAVLocate, queueAVLocateRequest} from "./locate";

import type {App} from "../../../index";

export interface IDatabaseItemOpenData {
    databaseBlockID: string;
    notebookID?: string;
    viewID?: string;
    groupID?: string;
    itemID: string;
}

export const openDatabaseItem = async (app: App, data: IDatabaseItemOpenData, options?: {
    position?: string;
}) => {
    if (!data.databaseBlockID || !data.itemID) {
        return false;
    }
    queueAVLocateRequest(data.databaseBlockID, {
        itemID: data.itemID,
        viewID: data.viewID,
        groupID: data.groupID,
    });
    const action = [Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL] as TProtyleAction[];
    /// #if MOBILE
    openMobileFileById(app, data.databaseBlockID, action, undefined, data.notebookID,
        (protyle) => activateQueuedAVLocate(protyle, data.databaseBlockID));
    return true;
    /// #else
    const opened = await openFileById({
        app,
        id: data.databaseBlockID,
        notebookId: data.notebookID,
        position: options?.position,
        action,
        zoomIn: false,
        afterOpen(model) {
            const protyle = (model as { editor?: { protyle?: IProtyle } })?.editor?.protyle;
            if (protyle) {
                activateQueuedAVLocate(protyle, data.databaseBlockID);
            }
        },
    });
    return Boolean(opened);
    /// #endif
};
