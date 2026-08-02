import {ICalendarFieldMapping, getCellByFieldID, getTextFromCell} from "./model";

const getMappedFieldID = (calendarData: IAVCalendar, fieldID: string | undefined, allowedTypes: TAVCol[]) => {
    if (!fieldID) {
        return undefined;
    }
    return calendarData.fields.some(field => field.id === fieldID && allowedTypes.includes(field.type)) ? fieldID : undefined;
};

const findTextFieldByName = (calendarData: IAVCalendar, names: string[], used: Set<string>) => {
    const normalise = (value: string) => value.trim().toLocaleLowerCase();
    return calendarData.fields.find(field =>
        field.type === "text" && !used.has(field.id) && names.includes(normalise(field.name))
    )?.id;
};

const recurrenceFieldNames = new Set(["repeat", "recurrence", "recurring", "wiederholen", "wiederholung", "__calendar_recurrence", "__calendar_recurrence_exceptions"]);

export const isCalendarRecurrenceStorageField = (field: IAVColumn) =>
    field.type === "text" && recurrenceFieldNames.has(field.name.trim().toLocaleLowerCase());

export const getCalendarFieldMapping = (calendarData: IAVCalendar): ICalendarFieldMapping => {
    const persistedDateFieldID = calendarData.dateFieldID || "";
    const persisted = calendarData.fieldMapping || {};
    const hasDateField = !!persistedDateFieldID && calendarData.fields.some(field => field.id === persistedDateFieldID && field.type === "date");
    const used = new Set<string>();
    const takeTextField = (persistedID: string | undefined, names: string[]) => {
        const mapped = getMappedFieldID(calendarData, persistedID, ["text"]);
        if (mapped) {
            used.add(mapped);
            return mapped;
        }
        const inferred = findTextFieldByName(calendarData, names, used);
        if (inferred) {
            used.add(inferred);
        }
        return inferred;
    };
    const recurrenceFieldID = takeTextField(persisted.recurrenceFieldID, ["repeat", "recurrence", "recurring", "wiederholen", "wiederholung", "__calendar_recurrence"]);
    const exceptionFieldID = takeTextField(persisted.exceptionFieldID, ["exception", "ausnahme"]);
    const locationFieldID = takeTextField(persisted.locationFieldID, ["place", "location", "ort"]);
    const descriptionFieldID = takeTextField(persisted.descriptionFieldID, ["description", "beschreibung"]);
    return {
        // A stale or wrong-typed persisted date field must not satisfy the
        // write-path guards, so only expose it when it is actually usable.
        dateFieldID: hasDateField ? persistedDateFieldID : "",
        recurrenceFieldID,
        exceptionFieldID,
        locationFieldID,
        descriptionFieldID,
        colorFieldID: getMappedFieldID(calendarData, persisted.colorFieldID, ["select", "mSelect"]),
        hasDateField,
    };
};

const getSelectColor = (cell?: IAVCell) => {
    const item = cell?.value?.mSelect?.[0];
    if (!item) {
        return {};
    }
    return {
        color: item.color,
        colorContent: item.content,
    };
};

export const getMappedMetadata = (card: IAVGalleryItem, mapping: ICalendarFieldMapping) => {
    const color = getSelectColor(getCellByFieldID(card, mapping.colorFieldID));
    return {
        recurrence: getTextFromCell(getCellByFieldID(card, mapping.recurrenceFieldID)),
        recurrenceException: getTextFromCell(getCellByFieldID(card, mapping.exceptionFieldID)),
        location: getTextFromCell(getCellByFieldID(card, mapping.locationFieldID)),
        description: getTextFromCell(getCellByFieldID(card, mapping.descriptionFieldID)),
        color: color.color,
        colorContent: color.colorContent,
    };
};

