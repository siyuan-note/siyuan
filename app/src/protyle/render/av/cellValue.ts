export const getAVBlockRefSubtype = (value?: IAVCellValue): "s" | "d" => value?.block?.refSubtype === "d" ? "d" : "s";

export const cellValueIsEmpty = (value: IAVCellValue) => {
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
    const snapshot = JSON.parse(JSON.stringify(value)) as IAVCellValue;
    if ((snapshot.type === "mSelect" || snapshot.type === "select") && !snapshot.mSelect) {
        snapshot.mSelect = [];
    } else if (snapshot.type === "mAsset" && !snapshot.mAsset) {
        snapshot.mAsset = [];
    }
    return snapshot;
};

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
