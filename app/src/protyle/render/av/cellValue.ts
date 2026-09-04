import type {IAVSelectedCell} from "./selectionState";

export const getAVBlockRefSubtype = (value?: IAVCellValue): "s" | "d" => value?.block?.refSubtype === "d" ? "d" : "s";

export const createEmptyAVValue = (keyID: string, type: TAVCol, blockID?: string) => ({
    type,
    keyID,
    blockID,
    block: {id: "", content: ""},
    text: {content: ""},
    number: {content: 0, isNotEmpty: false, formattedContent: ""},
    url: {content: ""},
    phone: {content: ""},
    email: {content: ""},
    template: {content: ""},
    date: {isNotEmpty: false, isNotEmpty2: false},
    created: {isNotEmpty: false},
    updated: {isNotEmpty: false},
    checkbox: {checked: false},
    mSelect: [],
    mAsset: [],
    relation: {blockIDs: [], contents: []},
    rollup: {contents: []},
} as IAVCellValue);

export const hasAVRenderTemplateResult = (value: IAVCellValue, renderTemplate?: string) =>
    value.type !== "template" &&
    (typeof value.renderedContent === "string" || Boolean(renderTemplate?.trim()));

export const cellValueIsEmpty = (value: IAVCellValue, useRenderedContent = false, renderTemplate?: string) => {
    if (useRenderedContent && hasAVRenderTemplateResult(value, renderTemplate)) {
        return !value.renderedContent;
    }
    if (value.type === "checkbox") {
        return false;
    }
    if (["text", "block", "url", "phone", "email", "template"].includes(value.type)) {
        return !value[value.type as "text"]?.content;
    }
    if (value.type === "number") {
        return value.number ? !value.number.isNotEmpty : true;
    }
    if (["mSelect", "mAsset", "select"].includes(value.type)) {
        if (value[(value.type === "select" ? "mSelect" : value.type) as "mSelect"]?.length > 0) {
            return false;
        }
        return true;
    }
    if (["date", "created", "updated"].includes(value.type)) {
        return !value[value.type as "date"]?.isNotEmpty &&
            !value[value.type as "date"]?.isNotEmpty2;
    }
    if (value.type === "relation") {
        if (value.relation?.blockIDs && value.relation.blockIDs.length > 0) {
            return false;
        }
        return true;
    }
    if (value.type === "rollup") {
        if (value.rollup?.contents && value.rollup.contents.length > 0) {
            return false;
        }
        return true;
    }
};

export const genEmptyAVCellValue = (colType: TAVCol): IAVCellValue => {
    const cellValue: IAVCellValue = {
        type: colType,
    };
    if (colType === "number") {
        cellValue.number = {
            content: 0,
            isNotEmpty: false,
        };
    } else if (["text", "block", "url", "phone", "email", "template"].includes(colType)) {
        cellValue[colType as "text"] = {
            content: "",
        };
    } else if (colType === "mSelect" || colType === "select") {
        cellValue.mSelect = [];
    } else if (colType === "mAsset") {
        cellValue.mAsset = [];
    } else if (["date", "created", "updated"].includes(colType)) {
        cellValue[colType as "date"] = {
            content: null,
            isNotEmpty: false,
            content2: null,
            isNotEmpty2: false,
            hasEndDate: false,
            isNotTime: true,
        };
    } else if (colType === "checkbox") {
        cellValue.checkbox = {
            checked: false,
        };
    } else if (colType === "relation") {
        cellValue.relation = {
            blockIDs: [],
            contents: [],
        };
    } else if (colType === "rollup") {
        cellValue.rollup = {
            contents: [],
        };
    }
    if (colType === "block") {
        cellValue.isDetached = true;
    }
    return cellValue;
};

export const cloneAVCellValueSnapshot = (value: IAVCellValue): IAVCellValue => {
    const snapshot = JSON.parse(JSON.stringify(value, (key, item) => key === "renderedContent" ? undefined : item)) as IAVCellValue;
    if ((snapshot.type === "mSelect" || snapshot.type === "select") && !snapshot.mSelect) {
        snapshot.mSelect = [];
    } else if (snapshot.type === "mAsset" && !snapshot.mAsset) {
        snapshot.mAsset = [];
    }
    return snapshot;
};

export const createAVStableTextCell = (options: {
    groupID?: string;
    rowID?: string;
    colID?: string;
    rowIndex?: number;
    colIndex?: number;
    cellID?: string;
    value: IAVCellValue;
}): IAVSelectedCell | undefined => {
    const rowID = options.rowID || "";
    const colID = options.colID || "";
    if (!rowID || !colID) {
        return;
    }
    const value = cloneAVCellValueSnapshot(options.value);
    return {
        groupID: options.groupID || "",
        rowID,
        colID,
        rowIndex: options.rowIndex ?? 0,
        colIndex: options.colIndex ?? -1,
        cell: {
            id: value.id || options.cellID || "",
            color: "",
            bgColor: "",
            value,
            valueType: "text",
        },
        column: {
            id: colID,
            type: "text",
        } as IAVColumn,
    };
};

export const createAVCellUpdateOperation = (options: {
    valueID?: string;
    avID?: string;
    keyID: string;
    rowID: string;
    data: IAVCellValue;
}): IOperation => ({
    action: "updateAttrViewCell",
    id: options.valueID || "",
    avID: options.avID,
    keyID: options.keyID,
    rowID: options.rowID,
    data: options.data,
});

export const getConvertedEmptyAVCellValue = (colType: TAVCol, value: IAVCellValue) => {
    if (colType === value.type || !cellValueIsEmpty(value)) {
        return;
    }
    return genEmptyAVCellValue(colType);
};

export const genRelationAVCellValue = (value: IAVCellValue): IAVCellValue => {
    if (value.type === "block" && value.blockID) {
        return {
            type: "relation",
            relation: {
                blockIDs: [value.blockID],
                contents: [value],
            },
        };
    }
    return genEmptyAVCellValue("relation");
};
