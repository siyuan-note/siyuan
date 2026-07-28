import {createEmptyAVValue} from "./attributeValue";
import {popTextCell, renderCell, updateCellsValue} from "./cell";
import {getAVData, getAVSelectedItemIDs} from "./virtualScroll";
import {getFieldsByData} from "./view";
import {TAVBatchEditMode} from "./batchValue";

const EDITABLE_FIELD_TYPES: TAVCol[] = [
    "block",
    "text",
    "number",
    "select",
    "mSelect",
    "date",
    "checkbox",
    "url",
    "email",
    "phone",
    "mAsset",
    "relation",
];

export const getEditableAVFields = (blockElement: HTMLElement) => {
    const data = getAVData(blockElement);
    if (!data) {
        return [];
    }
    return getFieldsByData(data).filter((field) => EDITABLE_FIELD_TYPES.includes(field.type));
};

const findItemCell = (view: IAVView, viewType: TAVView, itemID: string, fieldIndex: number): IAVCell | undefined => {
    if (view.groups?.length > 0) {
        for (const group of view.groups) {
            const cell = findItemCell(group, viewType, itemID, fieldIndex);
            if (cell) {
                return cell;
            }
        }
        return;
    }
    const isTable = viewType === "table";
    if (isTable) {
        const item = (view as IAVTable).rows?.find((currentItem) => currentItem.id === itemID);
        return item?.cells[fieldIndex];
    }
    const item = (view as IAVGallery).cards?.find((currentItem) => currentItem.id === itemID);
    return item?.values[fieldIndex];
};

const getItemCell = (data: IAV, itemID: string, fieldID: string) => {
    const fieldIndex = getFieldsByData(data).findIndex((field) => field.id === fieldID);
    if (fieldIndex < 0) {
        return;
    }
    return findItemCell(data.view, data.viewType, itemID, fieldIndex);
};

const cloneValue = <T>(value: T) => JSON.parse(JSON.stringify(value)) as T;

const getCollectionDisplayValue = (field: IAVColumn, values: IAVCellValue[], mode: TAVBatchEditMode) => {
    const displayValue = cloneValue(values[0]);
    if (mode === "replace") {
        return displayValue;
    }
    if (field.type === "mSelect") {
        displayValue.mSelect = [];
        if (mode === "remove") {
            const options = new Map<string, IAVCellSelectValue>();
            values.forEach(value => value.mSelect?.forEach(item => options.set(item.content, item)));
            displayValue.mSelect = Array.from(options.values()).map(item => ({...item}));
        }
    } else if (field.type === "mAsset") {
        displayValue.mAsset = [];
        if (mode === "remove") {
            const assets = new Map<string, IAVCellAssetValue>();
            values.forEach(value => value.mAsset?.forEach(item => {
                assets.set(`${item.type}:${item.content}:${item.name}`, item);
            }));
            displayValue.mAsset = Array.from(assets.values()).map(item => ({...item}));
        }
    } else if (field.type === "relation") {
        displayValue.relation = {blockIDs: [], contents: []};
        if (mode === "remove") {
            const relations = new Map<string, IAVCellValue>();
            values.forEach(value => value.relation?.blockIDs?.forEach((itemID, index) => {
                relations.set(itemID, value.relation.contents[index]);
            }));
            relations.forEach((content, itemID) => {
                displayValue.relation.blockIDs.push(itemID);
                displayValue.relation.contents.push(cloneValue(content));
            });
        }
    }
    return displayValue;
};

const createEditProxy = (options: {
    data: IAV;
    field: IAVColumn;
    itemID: string;
    value: IAVCellValue;
    displayValue: IAVCellValue;
    mode: TAVBatchEditMode;
}) => {
    const cell = getItemCell(options.data, options.itemID, options.field.id);
    const value = cloneValue(options.value);
    value.id = value.id || cell?.id;
    value.keyID = options.field.id;
    value.blockID = options.itemID;
    const displayValue = cloneValue(options.displayValue);
    displayValue.id = value.id;
    displayValue.keyID = options.field.id;
    displayValue.blockID = options.itemID;

    const cellElement = document.createElement("div");
    cellElement.className = "custom-attr__avvalue";
    cellElement.dataset.avId = options.data.id;
    cellElement.dataset.colId = options.field.id;
    cellElement.dataset.rowId = options.itemID;
    cellElement.dataset.type = options.field.type;
    cellElement.dataset.dtype = options.field.type;
    cellElement.dataset.cellValue = encodeURIComponent(JSON.stringify(displayValue));
    cellElement.dataset.avBatchMode = options.mode;
    cellElement.dataset.avBatchOriginalValue = encodeURIComponent(JSON.stringify(value));
    cellElement.dataset.avBatchDisplayValue = encodeURIComponent(JSON.stringify(displayValue));
    cellElement.dataset.options = JSON.stringify(options.field.options || []);
    if (value.id) {
        cellElement.dataset.id = value.id;
    }
    if (value.isDetached) {
        cellElement.dataset.detached = "true";
    }
    cellElement.dataset.dateFormat = options.field.dateFormat || "";
    cellElement.style.cssText = "position:absolute;inset:0;";
    cellElement.innerHTML = renderCell(displayValue, 0, options.data.view.showIcon, "table", options.field.options,
        options.field.dateFormat);
    return cellElement;
};

const createBatchEditContext = (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    field: IAVColumn;
    anchorElement: HTMLElement;
    mode?: TAVBatchEditMode;
}) => {
    const data = getAVData(options.blockElement);
    const itemIDs = getAVSelectedItemIDs(options.blockElement);
    if (!data || itemIDs.length === 0) {
        return;
    }
    const mode = options.mode || "replace";
    const values = itemIDs.map(itemID => {
        const cell = getItemCell(data, itemID, options.field.id);
        const value = cell?.value ?
            cloneValue(cell.value) :
            createEmptyAVValue(options.field.id, options.field.type, itemID);
        value.id = value.id || cell?.id;
        value.keyID = options.field.id;
        value.blockID = itemID;
        return value;
    });
    const displayValue = getCollectionDisplayValue(options.field, values, mode);

    const anchorRect = options.anchorElement.getBoundingClientRect();
    const proxyElement = document.createElement("div");
    proxyElement.className = "custom-attr av__batch-edit-proxy";
    proxyElement.style.cssText = `position:fixed;left:${anchorRect.left}px;top:${anchorRect.top}px;` +
        `width:${Math.max(anchorRect.width, 25)}px;height:${Math.max(anchorRect.height, 25)}px;` +
        "opacity:0;pointer-events:none;";
    const cellElements = itemIDs.map((itemID, index) => createEditProxy({
        data,
        field: options.field,
        itemID,
        value: values[index],
        displayValue: mode === "replace" ? values[index] : displayValue,
        mode,
    }));
    cellElements.forEach((cellElement) => proxyElement.append(cellElement));
    options.blockElement.append(proxyElement);

    let destroyed = false;
    const destroy = () => {
        if (destroyed) {
            return;
        }
        destroyed = true;
        cellElements.forEach((cellElement, index) => {
            const cell = getItemCell(data, itemIDs[index], options.field.id);
            if (!cell || !cellElement.dataset.cellValue) {
                return;
            }
            const encodedValue = cellElement.dataset.avBatchChanged === "true" ?
                cellElement.dataset.cellValue :
                cellElement.dataset.avBatchOriginalValue;
            const value = JSON.parse(decodeURIComponent(encodedValue)) as IAVCellValue;
            cell.id = value.id || "";
            cell.value = value;
            cell.valueType = value.type;
        });
        proxyElement.remove();
    };
    return {data, cellElements, destroy};
};

export const updateAVFieldValue = async (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    field: IAVColumn;
    anchorElement: HTMLElement;
    value: unknown;
}) => {
    const context = createBatchEditContext(options);
    if (!context) {
        return;
    }
    await updateCellsValue(options.protyle, options.blockElement, options.value, context.cellElements,
        getFieldsByData(context.data));
    context.destroy();
};

export const openAVFieldEditor = (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    field: IAVColumn;
    anchorElement: HTMLElement;
    mode?: TAVBatchEditMode;
}) => {
    const context = createBatchEditContext(options);
    if (!context) {
        return;
    }
    popTextCell(options.protyle, context.cellElements, options.field.type, {
        scrollIntoView: false,
        data: context.data,
        destroyCallback: context.destroy,
        keepMenuOpen: true,
        positionByMenu: true,
        requireExplicitChange: true,
    });
};
