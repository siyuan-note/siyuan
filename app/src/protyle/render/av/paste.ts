export const AV_PASTE_READONLY_TYPES = new Set<TAVCol>([
    "created",
    "updated",
    "template",
    "rollup",
    "lineNumber",
]);

const isStrictNumber = (value: string) => {
    const trimmed = value.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
        return false;
    }
    const unsigned = trimmed.replace(/^[+-]/, "").split(/[eE]/)[0];
    const integer = unsigned.split(".")[0];
    return !(integer.length > 1 && integer.startsWith("0"));
};

const isFullDate = (value: string) => {
    const match = value.trim().match(
        /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/,
    );
    if (!match) {
        return false;
    }
    const year = parseInt(match[1]);
    const month = parseInt(match[3]);
    const day = parseInt(match[4]);
    const hour = typeof match[5] === "string" ? parseInt(match[5]) : 0;
    const minute = typeof match[6] === "string" ? parseInt(match[6]) : 0;
    const second = typeof match[7] === "string" ? parseInt(match[7]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
        return false;
    }
    return hour < 24 && minute < 60 && second < 60;
};

export const inferAVPasteColumnType = (values: string[]): TAVCol => {
    const nonEmptyValues = values.map(value => value.trim()).filter(Boolean);
    if (nonEmptyValues.length === 0) {
        return "text";
    }
    if (nonEmptyValues.every(isStrictNumber)) {
        return "number";
    }
    if (nonEmptyValues.every(isFullDate)) {
        return "date";
    }
    return "text";
};

export const getAVPasteMatrixWidth = (rows: string[][], header?: string[]) => {
    return Math.max(header?.length || 0, ...rows.map(row => row.length), 0);
};

export const getUniqueAVPasteColumnName = (baseName: string, usedNames: Set<string>) => {
    if (!usedNames.has(baseName)) {
        return baseName;
    }
    let index = 2;
    while (usedNames.has(`${baseName} ${index}`)) {
        index++;
    }
    return `${baseName} ${index}`;
};
