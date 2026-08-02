import {Constants} from "../../../../constants";
import {fetchSyncPost} from "../../../../util/fetch";
import {ICalendarFieldMapping} from "./model";

export const ensureCalendarRecurrenceStorage = async (options: {
    protyle: IProtyle;
    calendarData: IAVCalendar;
    mapping: ICalendarFieldMapping;
    avID: string;
    blockID: string;
    viewID: string;
    storageRequired?: boolean;
}) => {
    if (!options.storageRequired || (options.mapping.recurrenceFieldID && options.mapping.exceptionFieldID)) {
        return options.mapping;
    }
    const recurrenceFieldID = options.mapping.recurrenceFieldID || Lute.NewNodeID();
    const exceptionFieldID = options.mapping.exceptionFieldID || Lute.NewNodeID();
    const previousID = options.calendarData.fields.at(-1)?.id || "";
    const doOperations: IOperation[] = [];
    if (!options.mapping.recurrenceFieldID) {
        doOperations.push({
            action: "addAttrViewCol", avID: options.avID, id: recurrenceFieldID, previousID,
            name: "__calendar_recurrence", type: "text",
        }, {
            action: "setAttrViewColHidden", avID: options.avID, blockID: options.blockID, viewID: options.viewID, id: recurrenceFieldID, data: true,
        });
    }
    if (!options.mapping.exceptionFieldID) {
        doOperations.push({
            action: "addAttrViewCol", avID: options.avID, id: exceptionFieldID, previousID: recurrenceFieldID,
            name: "__calendar_recurrence_exceptions", type: "text",
        }, {
            action: "setAttrViewColHidden", avID: options.avID, blockID: options.blockID, viewID: options.viewID, id: exceptionFieldID, data: true,
        });
    }
    doOperations.push({
        action: "setAttrViewCalendarFieldMapping", avID: options.avID, blockID: options.blockID, viewID: options.viewID,
        data: {recurrenceFieldID, exceptionFieldID},
    });
    const response = await fetchSyncPost("/api/transactions", {
        app: Constants.SIYUAN_APPID,
        session: options.protyle?.id || Constants.SIYUAN_APPID,
        reqId: Date.now(),
        transactions: [{doOperations, undoOperations: []}],
    });
    if (response?.code !== 0) {
        return options.mapping;
    }
    const rendered = await fetchSyncPost("/api/av/renderAttributeView", {
        id: options.avID,
        viewID: options.viewID,
        pageSize: -1,
    });
    const persistedCalendar = rendered?.data?.view as IAVCalendar | undefined;
    const recurrencePersisted = persistedCalendar?.fields?.some(field => field.id === recurrenceFieldID && field.type === "text");
    const exceptionPersisted = persistedCalendar?.fields?.some(field => field.id === exceptionFieldID && field.type === "text");
    if (rendered?.code !== 0 || !recurrencePersisted || !exceptionPersisted ||
        persistedCalendar?.fieldMapping?.recurrenceFieldID !== recurrenceFieldID ||
        persistedCalendar?.fieldMapping?.exceptionFieldID !== exceptionFieldID) {
        return options.mapping;
    }
    const hiddenField = (id: string, name: string): IAVColumn => ({
        id, name, type: "text", hidden: true, icon: "", wrap: false, desc: "",
        calc: undefined, numberFormat: "", template: "", pin: false, width: "", align: "",
    });
    if (!options.mapping.recurrenceFieldID) {
        options.calendarData.fields.push(hiddenField(recurrenceFieldID, "__calendar_recurrence"));
    }
    if (!options.mapping.exceptionFieldID) {
        options.calendarData.fields.push(hiddenField(exceptionFieldID, "__calendar_recurrence_exceptions"));
    }
    options.calendarData.fieldMapping = {...options.calendarData.fieldMapping, recurrenceFieldID, exceptionFieldID};
    return {...options.mapping, recurrenceFieldID, exceptionFieldID};
};
