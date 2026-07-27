import {createEmptyAVValue} from "./attributeValue";
import {popTextCell, renderCell} from "./cell";
import {getAVData, getAVSelectedItemIDs} from "./virtualScroll";
import {getFieldsByData} from "./view";

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

const createEditProxy = (options: {
    data: IAV;
    field: IAVColumn;
    itemID: string;
}) => {
    const cell = getItemCell(options.data, options.itemID, options.field.id);
    const value = cell?.value ?
        JSON.parse(JSON.stringify(cell.value)) as IAVCellValue :
        createEmptyAVValue(options.field.id, options.field.type, options.itemID);
    value.id = value.id || cell?.id;
    value.keyID = options.field.id;
    value.blockID = options.itemID;

    const cellElement = document.createElement("div");
    cellElement.className = "custom-attr__avvalue";
    cellElement.dataset.avId = options.data.id;
    cellElement.dataset.colId = options.field.id;
    cellElement.dataset.rowId = options.itemID;
    cellElement.dataset.type = options.field.type;
    cellElement.dataset.dtype = options.field.type;
    cellElement.dataset.cellValue = encodeURIComponent(JSON.stringify(value));
    cellElement.dataset.options = JSON.stringify(options.field.options || []);
    if (value.id) {
        cellElement.dataset.id = value.id;
    }
    if (value.isDetached) {
        cellElement.dataset.detached = "true";
    }
    cellElement.style.cssText = "position:absolute;inset:0;";
    cellElement.innerHTML = renderCell(value, 0, options.data.view.showIcon, "table", options.field.options);
    return cellElement;
};

export const openAVFieldEditor = (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    field: IAVColumn;
    anchorElement: HTMLElement;
}) => {
    const data = getAVData(options.blockElement);
    const itemIDs = getAVSelectedItemIDs(options.blockElement);
    if (!data || itemIDs.length === 0) {
        return;
    }

    const anchorRect = options.anchorElement.getBoundingClientRect();
    const proxyElement = document.createElement("div");
    proxyElement.className = "custom-attr av__batch-edit-proxy";
    proxyElement.style.cssText = `position:fixed;left:${anchorRect.left}px;top:${anchorRect.top}px;` +
        `width:${Math.max(anchorRect.width, 25)}px;height:${Math.max(anchorRect.height, 25)}px;` +
        "opacity:0;pointer-events:none;";
    const cellElements = itemIDs.map((itemID) => createEditProxy({
        data,
        field: options.field,
        itemID,
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
            const value = JSON.parse(decodeURIComponent(cellElement.dataset.cellValue)) as IAVCellValue;
            cell.id = value.id || "";
            cell.value = value;
            cell.valueType = value.type;
        });
        proxyElement.remove();
    };
    popTextCell(options.protyle, cellElements, options.field.type, {
        scrollIntoView: false,
        data,
        destroyCallback: destroy,
    });
};
