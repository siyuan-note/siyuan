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

const isURL = (value: string) => {
    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (e) {
        return false;
    }
};

export const getAVPasteCellValue = (content: string, links: Array<{content: string, href: string}>,
                                    unlinkedContent = ""): string | IAVCellValue => {
    if (links.length === 0 || /[^\s\u200B-\u200D\uFEFF,，、;；|/]/u.test(unlinkedContent) ||
        links.some(link => !isURL(link.href))) {
        return content;
    }
    const assets: IAVCellAssetValue[] = [];
    links.forEach(link => {
        const href = link.href.trim();
        const name = link.content.replace(/[\u200B-\u200D\uFEFF]/g, "");
        const asset = assets.find(item => item.content === href);
        if (asset) {
            asset.name += name;
        } else {
            assets.push({
                type: "file",
                content: href,
                name,
            });
        }
    });
    assets.forEach(asset => {
        asset.name = asset.name.trim() || asset.content;
    });
    return {
        type: "mAsset",
        mAsset: assets,
    };
};

export const getAVPasteValueForType = (value: string | IAVCellValue, type: TAVCol) => {
    if (typeof value === "string" || value.type !== "mAsset" || type === "mAsset") {
        return value;
    }
    if (type === "url" && value.mAsset?.length === 1) {
        return value.mAsset[0].content;
    }
    return (value.mAsset || []).map(item => item.name || item.content).join(", ");
};

const isSingleSelect = (values: string[]) => {
    if (values.length < 4 || values.some(value => value.length > 64 || /[\r\n]/.test(value))) {
        return false;
    }
    const optionCount = new Set(values).size;
    return optionCount > 1 && optionCount <= 20 && optionCount / values.length <= 0.5;
};

export const inferAVPasteColumnType = (values: Array<string | IAVCellValue>): TAVCol => {
    const nonEmptyValues = values.filter(value => typeof value !== "string" || value.trim());
    if (nonEmptyValues.length === 0) {
        return "text";
    }
    const hasAssetValue = nonEmptyValues.some(value => typeof value !== "string" && value.type === "mAsset");
    if (hasAssetValue && nonEmptyValues.every(value => typeof value === "string" ? isURL(value) : value.type === "mAsset")) {
        return "mAsset";
    }
    if (nonEmptyValues.some(value => typeof value !== "string")) {
        return "text";
    }
    const stringValues = nonEmptyValues as string[];
    if (stringValues.every(isStrictNumber)) {
        return "number";
    }
    if (stringValues.every(isFullDate)) {
        return "date";
    }
    if (stringValues.every(isURL)) {
        return "url";
    }
    if (isSingleSelect(stringValues)) {
        return "select";
    }
    return "text";
};

export const getAVPasteMatrixWidth = (rows: unknown[][], header?: string[]) => {
    return Math.max(header?.length || 0, ...rows.map(row => row.length), 0);
};

export const shouldShowAVPasteSkeleton = (rows: unknown[][]) => {
    return rows.reduce((count, row) => count + row.length, 0) >= 100;
};

export const compactAVCellOperations = (operations: IOperation[]) => {
    const cellOperations = operations.filter(operation => operation.action === "updateAttrViewCell");
    if (cellOperations.length < 2) {
        return operations;
    }
    const otherOperations = operations.filter(operation => operation.action !== "updateAttrViewCell");
    const operationsByAV = new Map<string, IOperation[]>();
    cellOperations.forEach(operation => {
        const avID = operation.avID || "";
        const groupedOperations = operationsByAV.get(avID) || [];
        groupedOperations.push(operation);
        operationsByAV.set(avID, groupedOperations);
    });
    operationsByAV.forEach((groupedOperations, avID) => {
        if (!avID || groupedOperations.length === 1) {
            otherOperations.push(...groupedOperations);
            return;
        }
        otherOperations.push({
            action: "updateAttrViewCells",
            avID,
            cellUpdates: groupedOperations.map(operation => ({
                keyID: operation.keyID,
                rowID: operation.rowID,
                data: operation.data,
            })),
        });
    });
    return otherOperations;
};

export const showAVPasteSkeleton = (blockElement: HTMLElement, columnCount: number) => {
    if (blockElement.querySelector(".av__paste-skeleton")) {
        return false;
    }
    const skeletonElement = document.createElement("div");
    skeletonElement.className = "av__paste-skeleton";
    skeletonElement.setAttribute("role", "status");
    skeletonElement.setAttribute("aria-label", window.siyuan.languages.loading);
    const visibleColumnCount = Math.min(Math.max(columnCount, 2), 6);
    let html = "";
    for (let rowIndex = 0; rowIndex < 5; rowIndex++) {
        html += '<div class="av__row"><div style="width: 24px;flex-shrink: 0"></div>';
        for (let columnIndex = 0; columnIndex < visibleColumnCount; columnIndex++) {
            const pulseWidth = 45 + (rowIndex * 17 + columnIndex * 13) % 45;
            html += `<div class="av__cell" style="width: 200px"><span class="av__pulse" style="width: ${pulseWidth}%"></span></div>`;
        }
        html += "</div>";
    }
    skeletonElement.innerHTML = html;
    blockElement.classList.add("av--paste-loading");
    blockElement.setAttribute("aria-busy", "true");
    blockElement.append(skeletonElement);
    return true;
};

export const removeAVPasteSkeleton = (blockElement: HTMLElement) => {
    blockElement.querySelector(".av__paste-skeleton")?.remove();
    blockElement.classList.remove("av--paste-loading");
    blockElement.removeAttribute("aria-busy");
};

export const isAVPasteHeaderCandidate = (rows: unknown[][], hasSemanticHeader: boolean) => {
    return hasSemanticHeader || (rows.length > 1 && getAVPasteMatrixWidth(rows) > 1);
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
