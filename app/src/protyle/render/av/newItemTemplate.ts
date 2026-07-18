import {Dialog} from "../../../dialog";
import {showMessage} from "../../../dialog/message";
import {Menu} from "../../../plugin/Menu";
import {MenuItem} from "../../../menus/Menu";
import {Constants} from "../../../constants";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchPost} from "../../../util/fetch";
import {transaction} from "../../wysiwyg/transaction";
import {avRender} from "./render";
import {getFieldsByData} from "./view";
import {getColIconByType} from "./col";
import {unicode2Emoji} from "../../../emoji";
import {upDownHint} from "../../../util/upDownHint";
import {hasClosestByClassName} from "../../util/hasClosest";
import * as dayjs from "dayjs";

interface ICreatePosition {
    previousID?: string;
    groupID?: string;
}

const cloneTemplates = (templates?: IAVNewItemTemplate[]) => JSON.parse(JSON.stringify(templates || [])) as IAVNewItemTemplate[];

const isLegacyBuiltInBlankTemplate = (itemTemplate: IAVNewItemTemplate, defaultTemplateID?: string) => {
    return itemTemplate.id === defaultTemplateID && itemTemplate.targetType === "detached" &&
        !itemTemplate.primaryKeyTemplate && !itemTemplate.contentTemplatePath &&
        !itemTemplate.saveLocation && !Object.keys(itemTemplate.fieldValues || {}).length;
};

const getCustomTemplateData = (data: IAV) => {
    const hasLegacyBuiltInBlank = data.newItemTemplates?.some(item => isLegacyBuiltInBlankTemplate(item, data.defaultTemplateID));
    return {
        ...data,
        newItemTemplates: cloneTemplates(data.newItemTemplates).filter(item => !isLegacyBuiltInBlankTemplate(item, data.defaultTemplateID)),
        defaultTemplateID: hasLegacyBuiltInBlank ? "" : data.defaultTemplateID || "",
    };
};

const getSelectedOptionNames = (element: HTMLElement) => {
    try {
        return JSON.parse(element.dataset.selected || "[]") as string[];
    } catch (e) {
        return [];
    }
};

const getSelectedOptionsHTML = (column: IAVColumn, selected: string[]) => {
    const selectedSet = new Set(selected);
    return (column.options || []).filter(item => selectedSet.has(item.name)).map(item => `<span class="b3-chip b3-chip--middle" style="background-color:var(--b3-font-background${escapeAttr(item.color)});color:var(--b3-font-color${escapeAttr(item.color)})">${escapeHtml(item.name)}</span>`).join("");
};

const getFieldText = (value: IAVCellValue) => {
    switch (value?.type) {
        case "text":
            return value.text?.content || "";
        case "number":
            return value.number?.isNotEmpty ? value.number.content?.toString() || "0" : "";
        case "url":
            return value.url?.content || "";
        case "email":
            return value.email?.content || "";
        case "phone":
            return value.phone?.content || "";
        case "date":
            if (!value.date?.isNotEmpty) {
                return "";
            }
            return dayjs(value.date.content).format(value.date.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm");
        case "select":
        case "mSelect":
            return (value.mSelect || []).map(item => item.content).join(", ");
        case "mAsset":
            return (value.mAsset || []).map(item => item.content).join(", ");
        case "relation":
            return (value.relation?.blockIDs || []).join(", ");
        default:
            return "";
    }
};

const genFieldValue = (column: IAVColumn, input: HTMLElement): IAVCellValue => {
    const content = (input as HTMLInputElement).value?.trim() || "";
    switch (column.type) {
        case "number":
            return {type: column.type, number: {content: Number(content), isNotEmpty: content !== ""}};
        case "date":
            return {
                type: column.type,
                date: {
                    content: content ? dayjs(content).valueOf() : 0,
                    isNotEmpty: content !== "",
                    isNotTime: !column.date?.fillSpecificTime,
                },
            };
        case "select":
        case "mSelect": {
            const selectedNames = getSelectedOptionNames(input);
            const selected = (column.options || []).filter(option => selectedNames.includes(option.name)).map(option => ({
                content: option.name,
                color: option.color || "1",
            }));
            return {type: column.type, mSelect: selected};
        }
        case "url":
            return {type: column.type, url: {content}};
        case "email":
            return {type: column.type, email: {content}};
        case "phone":
            return {type: column.type, phone: {content}};
        case "mAsset":
            return {
                type: column.type,
                mAsset: content.split(",").map(item => item.trim()).filter(item => item).map(item => ({
                    content: item,
                    name: item.split("/").pop() || item,
                    type: "file",
                })),
            };
        case "relation":
            return {type: column.type, relation: {blockIDs: getSelectedOptionNames(input)}};
        case "checkbox":
            return {type: column.type, checkbox: {checked: input.getAttribute("aria-pressed") === "true"}};
        default:
            return {type: column.type, text: {content}};
    }
};

const getValueInputHTML = (column: IAVColumn, fieldValue?: IAVNewItemFieldValue) => {
    const value = fieldValue?.value;
    if (column.type === "checkbox") {
        const checked = value?.checkbox?.checked || false;
        return `<button class="fn__flex-center" data-role="field-value" data-value-type="checkbox" aria-pressed="${checked}" type="button" style="background:transparent;border:0;color:inherit;padding:0"><svg class="av__checkbox"><use xlink:href="#icon${checked ? "Check" : "Uncheck"}"></use></svg></button>`;
    }
    if (["select", "mSelect"].includes(column.type)) {
        const selected = value?.mSelect?.map(item => item.content) || [];
        return getSelectedOptionsHTML(column, selected);
    }
    if (column.type === "relation") {
        const selected = value?.relation?.blockIDs || [];
        return `<button class="fn__flex-1 fn__flex" data-role="field-value" data-value-type="relation" data-selected="${escapeAttr(JSON.stringify(selected))}" type="button" style="align-items:center;background:transparent;border:0;color:inherit;min-height:26px;padding:0;text-align:left"></button>`;
    }
    const inputType = column.type === "number" ? "number" :
        (column.type === "date" ? (column.date?.fillSpecificTime ? "datetime-local" : "date") : "text");
    if (column.type === "text") {
        return `<textarea class="b3-text-field b3-text-field--text fn__flex-1" data-role="field-value" rows="1" style="resize:vertical">${escapeHtml(getFieldText(value))}</textarea>`;
    }
    const hiddenClass = column.type === "date" && fieldValue?.mode === "currentTime" ? " fn__none" : "";
    const max = column.type === "date" ? ` max="${column.date?.fillSpecificTime ? "9999-12-31 23:59" : "9999-12-31"}"` : "";
    return `<input class="b3-text-field b3-text-field--text fn__flex-1${hiddenClass}" data-role="field-value" type="${inputType}"${max} value="${escapeAttr(getFieldText(value))}">`;
};

const getFieldsHTML = (fields: IAVColumn[], itemTemplate: IAVNewItemTemplate) => fields.map(column => {
    const fieldValue = itemTemplate.fieldValues?.[column.id];
    const icon = column.icon ? unicode2Emoji(column.icon, "block__logoicon", true) : `<svg class="block__logoicon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`;
    const selected = fieldValue?.value?.mSelect?.map(item => item.content) || [];
    const selectAttrs = ["select", "mSelect"].includes(column.type) ?
        ` data-role="field-value" data-value-type="${column.type}" data-selected="${escapeAttr(JSON.stringify(selected))}"` : "";
    return `<div class="block__icons av__row" data-field-id="${column.id}">
    <div class="block__logo block__logo--icon fn__pointer" title="${escapeAttr(column.name)}">${icon}<span>${escapeHtml(column.name)}</span></div>
    <div class="fn__flex-1 fn__flex custom-attr__avvalue" data-type="${column.type}"${selectAttrs} style="align-items:center">
        ${column.type === "date" ? `<select class="b3-select" data-role="field-mode"><option value="static"${fieldValue?.mode !== "currentTime" ? " selected" : ""}>${window.siyuan.languages.specificTime}</option><option value="currentTime"${fieldValue?.mode === "currentTime" ? " selected" : ""}>${window.siyuan.languages.current}</option></select><span class="fn__space"></span>` : ""}
        ${getValueInputHTML(column, fieldValue)}
    </div>
</div>`;
}).join("");

const getPrimaryKeyHTML = (primaryKey: IAVColumn | undefined, itemTemplate: IAVNewItemTemplate) => {
    const name = primaryKey?.name || window.siyuan.languages.copyKeyContent;
    const icon = primaryKey?.icon ? unicode2Emoji(primaryKey.icon, "block__logoicon", true) :
        '<svg class="block__logoicon"><use xlink:href="#iconKey"></use></svg>';
    return `<div class="block__icons av__row">
    <div class="block__logo block__logo--icon fn__pointer" title="${escapeAttr(name)}">${icon}<span>${escapeHtml(name)}</span></div>
    <div class="fn__flex-1 fn__flex custom-attr__avvalue" data-type="block" style="align-items:center">
        <input class="b3-text-field b3-text-field--text fn__flex-1" data-role="primary-key" value="${escapeAttr(itemTemplate.primaryKeyTemplate || "")}">
    </div>
</div>`;
};

const hasFieldValue = (column: IAVColumn, value: IAVCellValue) => {
    switch (column.type) {
        case "number":
            return value.number?.isNotEmpty;
        case "date":
            return value.date?.isNotEmpty;
        case "select":
        case "mSelect":
            return value.mSelect?.length > 0;
        case "url":
            return !!value.url?.content;
        case "email":
            return !!value.email?.content;
        case "phone":
            return !!value.phone?.content;
        case "mAsset":
            return value.mAsset?.length > 0;
        case "relation":
            return value.relation?.blockIDs?.length > 0;
        case "checkbox":
            return value.checkbox?.checked;
        default:
            return !!value.text?.content;
    }
};

const openFieldSelectMenu = (target: HTMLElement, column: IAVColumn) => {
    const selected = getSelectedOptionNames(target);
    const selectedSet = new Set(selected);
    const menu = new Menu("av-new-item-template-field-value");
    if (menu.isOpen) {
        return;
    }
    if (column.type === "select") {
        menu.addItem({
            label: window.siyuan.languages.empty,
            checked: selected.length === 0,
            click: () => {
                selected.splice(0, selected.length);
                target.dataset.selected = "[]";
                target.innerHTML = getSelectedOptionsHTML(column, selected);
            },
        });
        menu.addSeparator();
    }
    (column.options || []).forEach(option => menu.addItem({
        label: `<span class="b3-chip" style="background-color:var(--b3-font-background${escapeAttr(option.color)});color:var(--b3-font-color${escapeAttr(option.color)})">${escapeHtml(option.name)}</span>`,
        checked: selectedSet.has(option.name),
        click: (element) => {
            if (column.type === "select") {
                selected.splice(0, selected.length, option.name);
            } else if (selectedSet.has(option.name)) {
                selectedSet.delete(option.name);
                selected.splice(selected.indexOf(option.name), 1);
            } else {
                selectedSet.add(option.name);
                selected.push(option.name);
            }
            target.dataset.selected = JSON.stringify(selected);
            target.innerHTML = getSelectedOptionsHTML(column, selected);
            if (column.type === "mSelect") {
                element.querySelector(".b3-menu__checked")?.remove();
                if (selectedSet.has(option.name)) {
                    element.insertAdjacentHTML("beforeend", '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>');
                }
                return true;
            }
        },
    }));
    const rect = target.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width});
};

interface IRelationOption {
    id: string;
    blockID: string;
    content: string;
    icon: string;
    isDetached: boolean;
}

const getRelationOptions = (column: IAVColumn, callback: (options: IRelationOption[]) => void) => {
    if (!column.relation?.avID) {
        callback([]);
        return;
    }
    fetchPost("/api/av/getAttributeViewPrimaryKeyValues", {
        id: column.relation.avID,
        keyword: "",
    }, response => {
        const values = response.data?.rows?.values as IAVCellValue[] || [];
        callback(values.map(value => ({
            id: value.blockID || "",
            blockID: value.block?.id || "",
            content: value.block?.content || window.siyuan.languages.untitled,
            icon: value.block?.icon || "",
            isDetached: !!value.isDetached,
        })).filter(option => option.id));
    });
};

const renderRelationFieldValue = (target: HTMLElement, options: IRelationOption[]) => {
    const selected = new Set(getSelectedOptionNames(target));
    const html = options.filter(option => selected.has(option.id)).map(option => {
        if (option.isDetached) {
            return `<span class="av__cell--relation" data-row-id="${escapeAttr(option.id)}"><span><svg><use xlink:href="#iconLine"></use></svg><span class="fn__space--5"></span></span><span class="av__celltext">${escapeHtml(option.content)}</span></span>`;
        }
        const icon = unicode2Emoji(option.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file);
        return `<span class="av__cell--relation" data-row-id="${escapeAttr(option.id)}" data-block-id="${escapeAttr(option.blockID)}"><span class="b3-menu__avemoji" data-unicode="${escapeAttr(option.icon)}">${icon}</span><span data-type="block-ref" data-id="${escapeAttr(option.blockID)}" data-subtype="s" class="av__celltext av__celltext--ref">${escapeHtml(option.content)}</span></span>`;
    }).join("");
    target.innerHTML = html;
};

const openFieldRelationMenu = (target: HTMLElement, column: IAVColumn) => {
    getRelationOptions(column, options => {
        if (!target.isConnected) {
            return;
        }
        const selected = getSelectedOptionNames(target);
        const selectedSet = new Set(selected);
        const menu = new Menu("av-new-item-template-relation-value");
        if (menu.isOpen) {
            return;
        }
        options.forEach(option => menu.addItem({
            label: escapeHtml(option.content),
            checked: selectedSet.has(option.id),
            click: element => {
                if (selectedSet.has(option.id)) {
                    selectedSet.delete(option.id);
                    selected.splice(selected.indexOf(option.id), 1);
                    element.querySelector(".b3-menu__checked")?.remove();
                } else {
                    selectedSet.add(option.id);
                    selected.push(option.id);
                    element.insertAdjacentHTML("beforeend", '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>');
                }
                target.dataset.selected = JSON.stringify(selected);
                renderRelationFieldValue(target, options);
                return true;
            },
        }));
        if (!options.length) {
            menu.addItem({type: "readonly", label: window.siyuan.languages.emptyContent});
        }
        const rect = target.getBoundingClientRect();
        menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width});
    });
};

interface IContentTemplateSearchResult {
    path: string;
    relativePath?: string;
}

const getContentTemplateRelativePath = (item: IContentTemplateSearchResult) => {
    if (item.relativePath) {
        return item.relativePath;
    }
    const normalizedPath = (item.path || "").replaceAll("\\", "/");
    const templatesIndex = normalizedPath.lastIndexOf("/templates/");
    return templatesIndex > -1 ? normalizedPath.substring(templatesIndex + "/templates/".length) : "";
};

const setContentTemplateValue = (target: HTMLElement, path: string) => {
    target.dataset.value = path;
    const labelElement = target.querySelector("span");
    if (labelElement) {
        labelElement.textContent = path || window.siyuan.languages.empty;
        labelElement.classList.toggle("ft__on-surface", !path);
    }
};

const openContentTemplateMenu = (target: HTMLElement) => {
    const menu = new Menu("av-new-item-content-template");
    if (menu.isOpen) {
        return;
    }
    let searchRequest = 0;
    menu.addItem({
        type: "empty",
        label: `<div data-menu="true" style="padding:4px;width:360px">
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.search}">
    <div class="b3-list b3-list--background" style="margin-top:4px;max-height:240px;overflow:auto"></div>
</div>`,
        bind: menuElement => {
            const inputElement = menuElement.querySelector("input") as HTMLInputElement;
            const listElement = menuElement.querySelector(".b3-list") as HTMLElement;
            const selectItem = (item: HTMLElement) => {
                setContentTemplateValue(target, item.dataset.path || "");
                menu.close();
            };
            const search = () => {
                const request = ++searchRequest;
                fetchPost("/api/search/searchTemplate", {k: inputElement.value}, response => {
                    if (request !== searchRequest || !target.isConnected) {
                        return;
                    }
                    const templates = response.data?.templates as IContentTemplateSearchResult[] || [];
                    let html = `<div class="b3-list-item b3-list-item--narrow" data-path=""><span class="b3-list-item__text ft__on-surface">${window.siyuan.languages.empty}</span></div>`;
                    templates.forEach(item => {
                        const relativePath = getContentTemplateRelativePath(item);
                        if (relativePath) {
                            html += `<div class="b3-list-item b3-list-item--narrow" data-path="${escapeAttr(relativePath)}"><span class="b3-list-item__text">${escapeHtml(relativePath)}</span></div>`;
                        }
                    });
                    listElement.innerHTML = html;
                    const current = Array.from(listElement.querySelectorAll<HTMLElement>(".b3-list-item")).find(item => item.dataset.path === target.dataset.value);
                    const firstResult = listElement.querySelector<HTMLElement>('.b3-list-item[data-path]:not([data-path=""])');
                    (inputElement.value ? firstResult : current || firstResult || listElement.firstElementChild)?.classList.add("b3-list-item--focus");
                });
            };
            inputElement.addEventListener("keydown", event => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                upDownHint(listElement, event);
                if (event.key === "Enter") {
                    const current = listElement.querySelector(".b3-list-item--focus") as HTMLElement;
                    if (current) {
                        selectItem(current);
                    }
                } else if (event.key === "Escape") {
                    menu.close();
                }
            });
            inputElement.addEventListener("compositionend", search);
            inputElement.addEventListener("input", (event: InputEvent) => {
                event.stopPropagation();
                if (!event.isComposing) {
                    search();
                }
            });
            listElement.addEventListener("click", event => {
                const item = hasClosestByClassName(event.target as Element, "b3-list-item") as HTMLElement;
                if (item) {
                    selectItem(item);
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
            search();
            setTimeout(() => inputElement.focus());
        },
    });
    const rect = target.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: Math.max(rect.width, 368)});
};

const collectTemplate = (root: HTMLElement, itemTemplate: IAVNewItemTemplate, fields: IAVColumn[]) => {
    itemTemplate.name = (root.querySelector('[data-role="template-name"]') as HTMLInputElement).value.trim();
    itemTemplate.targetType = (root.querySelector('[data-role="target-type"]') as HTMLSelectElement).value as TAVNewItemTarget;
    itemTemplate.primaryKeyTemplate = (root.querySelector('[data-role="primary-key"]') as HTMLInputElement).value;
    itemTemplate.contentTemplatePath = (root.querySelector('[data-role="content-template"]') as HTMLElement).dataset.value || "";
    const boxID = (root.querySelector('[data-role="box-id"]') as HTMLSelectElement).value;
    itemTemplate.saveLocation = boxID === "__default__" ? undefined : {
        boxID,
        pathTemplate: (root.querySelector('[data-role="path-template"]') as HTMLInputElement).value,
    };
    const fieldValues: Record<string, IAVNewItemFieldValue> = {};
    root.querySelectorAll<HTMLElement>("[data-field-id]").forEach(element => {
        const column = fields.find(item => item.id === element.dataset.fieldId);
        const mode = (element.querySelector('[data-role="field-mode"]') as HTMLSelectElement)?.value as TAVNewItemFieldValueMode || "static";
        const value = mode === "static" ? genFieldValue(column, element.querySelector('[data-role="field-value"]')) : undefined;
        if (mode === "static" && !hasFieldValue(column, value)) {
            return;
        }
        fieldValues[column.id] = {
            mode,
            value,
        };
    });
    itemTemplate.fieldValues = fieldValues;
};

const getEditorHTML = (itemTemplate: IAVNewItemTemplate, primaryKey: IAVColumn | undefined, fields: IAVColumn[], currentNotebookID: string) => {
    const currentNotebook = window.siyuan.notebooks?.find(item => item.id === currentNotebookID);
    const forceCurrentNotebook = !!currentNotebook?.encrypted;
    const currentNotebookSelected = forceCurrentNotebook || !!itemTemplate.saveLocation &&
        (!itemTemplate.saveLocation.boxID || itemTemplate.saveLocation.boxID === currentNotebookID);
    const notebookOptions = (forceCurrentNotebook ? "" :
        `<option value="__default__"${itemTemplate.saveLocation ? "" : " selected"}>${window.siyuan.languages.default}</option>`) +
        `<option value=""${currentNotebookSelected ? " selected" : ""}>${window.siyuan.languages.currentNotebook}</option>` +
        (forceCurrentNotebook ? "" : (window.siyuan.notebooks || []).filter(item => !item.closed && item.id !== currentNotebookID)
            .map(item => `<option value="${item.id}"${item.id === itemTemplate.saveLocation?.boxID ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join(""));
    const isDocument = itemTemplate.targetType === "document";
    return `<div data-role="template-editor" style="padding:16px;overflow:auto;flex:1">
    <div class="custom-attr">
        <div class="block__icons av__row">
            <div class="block__logo block__logo--icon fn__pointer"><svg class="block__logoicon"><use xlink:href="#iconEdit"></use></svg><span>${window.siyuan.languages.title}</span></div>
            <div class="fn__flex-1 fn__flex custom-attr__avvalue" style="align-items:center"><input class="b3-text-field b3-text-field--text fn__flex-1" data-role="template-name" value="${escapeAttr(itemTemplate.name)}"><span class="fn__space"></span><button class="block__icon block__icon--warning" data-role="delete-template" type="button" aria-label="${window.siyuan.languages.delete}"><svg><use xlink:href="#iconTrashcan"></use></svg></button></div>
        </div>
        <div class="block__icons av__row">
            <div class="block__logo block__logo--icon fn__pointer"><svg class="block__logoicon"><use xlink:href="#iconAdd"></use></svg><span>${window.siyuan.languages.type}</span></div>
            <div class="fn__flex-1 fn__flex custom-attr__avvalue" style="align-items:center"><select class="b3-select fn__flex-1" data-role="target-type"><option value="detached"${isDocument ? "" : " selected"}>${window.siyuan.languages.createDetachedBlock}</option><option value="document"${isDocument ? " selected" : ""}>${window.siyuan.languages.createBoundBlock}</option></select></div>
        </div>
    </div>
    <div data-role="document-options" class="${isDocument ? "" : "fn__none"}">
        <div class="fn__hr"></div>
        <div class="custom-attr">
            <div class="block__icons av__row">
                <div class="block__logo block__logo--icon fn__pointer ariaLabel" data-position="parentE" aria-label="${escapeAttr(`${window.siyuan.languages.fileTree14}<br>${window.siyuan.languages.fileTree13}`)}"><svg class="block__logoicon"><use xlink:href="#iconFolder"></use></svg><span>${window.siyuan.languages.savePath}</span></div>
                <div class="fn__flex-1 fn__flex custom-attr__avvalue" style="align-items:center"><select class="b3-select" data-role="box-id" style="width:160px">${notebookOptions}</select><span class="fn__space${itemTemplate.saveLocation || forceCurrentNotebook ? "" : " fn__none"}" data-role="path-space"></span><input class="b3-text-field fn__flex-1${itemTemplate.saveLocation || forceCurrentNotebook ? "" : " fn__none"}" data-role="path-template" value="${escapeAttr(itemTemplate.saveLocation?.pathTemplate || "")}"${itemTemplate.saveLocation || forceCurrentNotebook ? "" : " disabled"}></div>
            </div>
            <div class="block__icons av__row">
                <div class="block__logo block__logo--icon fn__pointer"><svg class="block__logoicon"><use xlink:href="#iconFile"></use></svg><span>${window.siyuan.languages.contentTemplate}</span></div>
                <div class="fn__flex-1 fn__flex custom-attr__avvalue" style="align-items:center"><button class="b3-text-field b3-text-field--text fn__flex-1 fn__flex" data-role="content-template" data-value="${escapeAttr(itemTemplate.contentTemplatePath || "")}" type="button" style="align-items:center;text-align:left"><span class="fn__flex-1 fn__ellipsis${itemTemplate.contentTemplatePath ? "" : " ft__on-surface"}">${escapeHtml(itemTemplate.contentTemplatePath || window.siyuan.languages.empty)}</span><svg style="height:14px;width:14px"><use xlink:href="#iconDown"></use></svg></button></div>
            </div>
        </div>
    </div>
    <div class="fn__hr"></div>
    <div class="custom-attr">${getPrimaryKeyHTML(primaryKey, itemTemplate)}${getFieldsHTML(fields, itemTemplate)}</div>
</div>`;
};

export const openNewItemTemplateDialog = (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    data: IAV;
    undoData?: IAV;
    selectedTemplateID?: string;
    createNew?: boolean;
}) => {
    const allFields = getFieldsByData(options.data);
    const primaryKey = allFields.find(item => item.type === "block");
    const fields = allFields.filter(item => ["text", "number", "date", "select", "mSelect", "url", "email", "phone", "mAsset", "checkbox", "relation"].includes(item.type));
    const templates = cloneTemplates(options.data.newItemTemplates);
    const fieldsByID = new Map(fields.map(item => [item.id, item]));
    templates.forEach(itemTemplate => {
        Object.entries(itemTemplate.fieldValues || {}).forEach(([keyID, fieldValue]) => {
            const field = fieldsByID.get(keyID);
            if (!field || (fieldValue.mode === "currentTime" && field.type !== "date") ||
                (fieldValue.mode === "static" && fieldValue.value?.type !== field.type)) {
                delete itemTemplate.fieldValues[keyID];
            }
        });
    });
    if (options.createNew) {
        templates.push({id: Lute.NewNodeID(), name: window.siyuan.languages.template, targetType: "detached"});
    }
    let selectedIndex = options.selectedTemplateID ? templates.findIndex(item => item.id === options.selectedTemplateID) :
        (templates.length ? templates.length - 1 : -1);
    if (-1 === selectedIndex && templates.length) {
        selectedIndex = 0;
    }
    let defaultTemplateID = options.data.defaultTemplateID || "";
    const dialog = new Dialog({
        title: `${window.siyuan.languages.newRow} ${window.siyuan.languages.template}`,
        width: "820px",
        height: "70vh",
        content: `<div class="fn__flex fn__flex-column" style="height:100%">
    <div class="fn__flex fn__flex-1" style="min-height:0">
        <div data-role="template-list" style="width:200px;padding:8px;border-right:1px solid var(--b3-border-color);overflow:auto"></div>
        <div data-role="editor-host" class="fn__flex-1 fn__flex"></div>
    </div>
    <div class="b3-dialog__action"><button class="b3-button b3-button--cancel" data-role="cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text" data-role="confirm">${window.siyuan.languages.confirm}</button></div>
</div>`,
    });
    const root = dialog.element;
    const listElement = root.querySelector('[data-role="template-list"]') as HTMLElement;
    const hostElement = root.querySelector('[data-role="editor-host"]') as HTMLElement;

    const collectCurrent = () => {
        const editor = root.querySelector('[data-role="template-editor"]') as HTMLElement;
        if (!editor || selectedIndex < 0) {
            return;
        }
        collectTemplate(editor, templates[selectedIndex], fields);
    };

    const render = () => {
        listElement.innerHTML = `<button class="b3-menu__item" data-role="add-template"><svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg><span class="b3-menu__label">${window.siyuan.languages.newRow} ${window.siyuan.languages.template}</span></button><button class="b3-menu__separator"></button>` +
            templates.map((item, index) => `<button class="b3-menu__item${index === selectedIndex ? " b3-menu__item--current" : ""}" data-index="${index}" draggable="true"><svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg><span class="b3-menu__label fn__ellipsis">${escapeHtml(item.name)}</span></button>`).join("");
        hostElement.innerHTML = selectedIndex < 0 ? "" : getEditorHTML(templates[selectedIndex], primaryKey, fields, options.protyle.notebookId);
        const target = hostElement.querySelector('[data-role="target-type"]') as HTMLSelectElement;
        target?.addEventListener("change", () => hostElement.querySelector('[data-role="document-options"]')?.classList.toggle("fn__none", target.value !== "document"));
        const boxIDElement = hostElement.querySelector('[data-role="box-id"]') as HTMLSelectElement;
        boxIDElement?.addEventListener("change", () => {
            const pathElement = hostElement.querySelector('[data-role="path-template"]') as HTMLInputElement;
            const useDefaultPath = boxIDElement.value === "__default__";
            pathElement.disabled = useDefaultPath;
            pathElement.classList.toggle("fn__none", useDefaultPath);
            hostElement.querySelector('[data-role="path-space"]')?.classList.toggle("fn__none", useDefaultPath);
        });
        hostElement.querySelector<HTMLElement>('[data-role="content-template"]')?.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            openContentTemplateMenu(event.currentTarget as HTMLElement);
        });
        hostElement.querySelectorAll<HTMLSelectElement>('[data-role="field-mode"]').forEach(modeElement => {
            modeElement.addEventListener("change", () => {
                const valueElement = modeElement.parentElement.querySelector<HTMLInputElement>('[data-role="field-value"]');
                const useCurrentTime = modeElement.value === "currentTime";
                valueElement.classList.toggle("fn__none", useCurrentTime);
                if (!useCurrentTime) {
                    valueElement.focus();
                    try {
                        (valueElement as HTMLInputElement & {showPicker?: () => void}).showPicker?.();
                    } catch {
                        // 浏览器会在当前事件不具备用户激活状态时拒绝打开选择器，输入框仍可正常点击选择。
                    }
                }
            });
        });
        hostElement.querySelectorAll<HTMLElement>('[data-role="field-value"][data-value-type]').forEach(item => item.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (item.dataset.valueType === "checkbox") {
                const checked = item.getAttribute("aria-pressed") !== "true";
                item.setAttribute("aria-pressed", checked.toString());
                item.querySelector("use")?.setAttribute("xlink:href", `#icon${checked ? "Check" : "Uncheck"}`);
                return;
            }
            const column = fields.find(field => field.id === item.closest<HTMLElement>("[data-field-id]")?.dataset.fieldId);
            if (column) {
                if (column.type === "relation") {
                    openFieldRelationMenu(item, column);
                } else {
                    openFieldSelectMenu(item, column);
                }
            }
        }));
        hostElement.querySelectorAll<HTMLElement>('[data-role="field-value"][data-value-type="relation"]').forEach(item => {
            const column = fields.find(field => field.id === item.closest<HTMLElement>("[data-field-id]")?.dataset.fieldId);
            if (column) {
                getRelationOptions(column, relationOptions => renderRelationFieldValue(item, relationOptions));
            }
        });
        hostElement.querySelector('[data-role="delete-template"]')?.addEventListener("click", (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const deletedID = templates[selectedIndex].id;
            templates.splice(selectedIndex, 1);
            if (defaultTemplateID === deletedID) {
                defaultTemplateID = "";
            }
            selectedIndex = Math.min(selectedIndex, templates.length - 1);
            render();
        });
    };

    let draggingIndex = -1;
    const clearDragStyles = () => {
        listElement.querySelectorAll<HTMLElement>("[data-index]").forEach(item => {
            item.style.borderTop = "";
            item.style.borderBottom = "";
            item.style.opacity = "";
        });
    };
    listElement.addEventListener("dragstart", (event: DragEvent) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
        if (!target) {
            return;
        }
        draggingIndex = parseInt(target.dataset.index);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", target.dataset.index);
        target.style.opacity = ".38";
    });
    listElement.addEventListener("dragover", (event: DragEvent) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
        if (!target || draggingIndex < 0) {
            return;
        }
        event.preventDefault();
        clearDragStyles();
        const before = event.clientY < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
        target.style[before ? "borderTop" : "borderBottom"] = "2px solid var(--b3-theme-primary-lighter)";
    });
    listElement.addEventListener("drop", (event: DragEvent) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
        if (!target || draggingIndex < 0) {
            return;
        }
        event.preventDefault();
        const targetIndex = parseInt(target.dataset.index);
        const before = event.clientY < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
        let insertIndex = targetIndex + (before ? 0 : 1);
        const oldIndex = draggingIndex;
        if (oldIndex < insertIndex) {
            insertIndex--;
        }
        if (oldIndex !== insertIndex) {
            collectCurrent();
            const [movedTemplate] = templates.splice(oldIndex, 1);
            templates.splice(insertIndex, 0, movedTemplate);
            if (selectedIndex === oldIndex) {
                selectedIndex = insertIndex;
            } else if (oldIndex < selectedIndex && selectedIndex <= insertIndex) {
                selectedIndex--;
            } else if (insertIndex <= selectedIndex && selectedIndex < oldIndex) {
                selectedIndex++;
            }
            render();
        }
        draggingIndex = -1;
        clearDragStyles();
    });
    listElement.addEventListener("dragend", () => {
        draggingIndex = -1;
        clearDragStyles();
    });
    listElement.addEventListener("click", (event: MouseEvent) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-index], [data-role]");
        if (!target) {
            return;
        }
        if (target.dataset.role === "add-template") {
            collectCurrent();
            templates.push({id: Lute.NewNodeID(), name: window.siyuan.languages.template, targetType: "detached"});
            selectedIndex = templates.length - 1;
            render();
        } else if (target.dataset.index) {
            collectCurrent();
            selectedIndex = parseInt(target.dataset.index);
            render();
        }
    });
    root.querySelector('[data-role="cancel"]').addEventListener("click", () => dialog.destroy());
    root.querySelector('[data-role="confirm"]').addEventListener("click", () => {
        collectCurrent();
        if (templates.some(item => !item.name)) {
            showMessage(window.siyuan.languages.nameEmpty, 6000, "error");
            return;
        }
        const undoData = options.undoData || options.data;
        transaction(options.protyle, [{
            action: "setAttrViewNewItemTemplates",
            avID: options.data.id,
            blockID: options.blockElement.dataset.nodeId,
            data: {templates, defaultTemplateID},
        }], [{
            action: "setAttrViewNewItemTemplates",
            avID: options.data.id,
            blockID: options.blockElement.dataset.nodeId,
            data: {templates: undoData.newItemTemplates || [], defaultTemplateID: undoData.defaultTemplateID || ""},
        }], {
            callback: () => {
                dialog.destroy();
                options.blockElement.removeAttribute("data-render");
                avRender(options.blockElement, options.protyle);
            },
        });
    });
    render();
};

export const createAttributeViewItem = (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    templateID?: string;
    position?: ICreatePosition;
}) => {
    fetchPost("/api/av/createAttributeViewItem", {
        avID: options.blockElement.dataset.avId,
        blockID: options.blockElement.dataset.nodeId,
        viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
        templateID: options.templateID || "",
        previousID: options.position?.previousID || "",
        groupID: options.position?.groupID || "",
        app: options.protyle.app.appId,
        session: options.protyle.id,
    }, response => {
        const warnings = (response.data?.warnings || []) as string[];
        if (warnings.length) {
            showMessage(warnings.join("<br>"));
        }
        options.blockElement.removeAttribute("data-render");
        avRender(options.blockElement, options.protyle);
    });
};

const saveNewItemTemplateConfig = (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    data: IAV;
    templates: IAVNewItemTemplate[];
    defaultTemplateID: string;
}) => {
    transaction(options.protyle, [{
        action: "setAttrViewNewItemTemplates",
        avID: options.data.id,
        blockID: options.blockElement.dataset.nodeId,
        data: {templates: options.templates, defaultTemplateID: options.defaultTemplateID},
    }], [{
        action: "setAttrViewNewItemTemplates",
        avID: options.data.id,
        blockID: options.blockElement.dataset.nodeId,
        data: {
            templates: options.data.newItemTemplates || [],
            defaultTemplateID: options.data.defaultTemplateID || "",
        },
    }], {
        callback: () => {
            options.blockElement.removeAttribute("data-render");
            avRender(options.blockElement, options.protyle);
        },
    });
};

const openNewItemTemplateActionMenu = (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    data: IAV;
    undoData: IAV;
    itemTemplate: IAVNewItemTemplate;
    element: HTMLElement;
    menu: Menu;
}) => {
    const opened = options.element.classList.contains("b3-menu__item--show");
    options.menu.element.querySelectorAll(".b3-menu__item--show").forEach(item => item.classList.remove("b3-menu__item--show"));
    if (opened) {
        return;
    }
    let subMenuElement = options.element.querySelector(":scope > .b3-menu__submenu") as HTMLElement;
    if (!subMenuElement) {
        subMenuElement = document.createElement("div");
        subMenuElement.classList.add("b3-menu__submenu");
        subMenuElement.dataset.anchor = "action";
        const itemsElement = document.createElement("div");
        itemsElement.classList.add("b3-menu__items");
        subMenuElement.append(itemsElement);
        const items: IMenu[] = [{
            icon: "iconEdit",
            label: window.siyuan.languages.edit,
            click: () => openNewItemTemplateDialog({
                protyle: options.protyle,
                blockElement: options.blockElement,
                data: options.data,
                undoData: options.undoData,
                selectedTemplateID: options.itemTemplate.id,
            }),
        }, {
            icon: "iconSelect",
            label: window.siyuan.languages.setAsDefault,
            disabled: options.itemTemplate.id === options.data.defaultTemplateID,
            click: () => saveNewItemTemplateConfig({
                protyle: options.protyle,
                blockElement: options.blockElement,
                data: options.undoData,
                templates: cloneTemplates(options.data.newItemTemplates),
                defaultTemplateID: options.itemTemplate.id,
            }),
        }, {
            type: "separator",
        }, {
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            warning: true,
            click: () => saveNewItemTemplateConfig({
                protyle: options.protyle,
                blockElement: options.blockElement,
                data: options.undoData,
                templates: cloneTemplates(options.data.newItemTemplates).filter(item => item.id !== options.itemTemplate.id),
                defaultTemplateID: options.itemTemplate.id === options.data.defaultTemplateID ? "" : options.data.defaultTemplateID || "",
            }),
        }];
        items.forEach(item => itemsElement.append(new MenuItem(item).element));
        options.element.append(subMenuElement);
    }
    options.element.classList.add("b3-menu__item--show");
    options.menu.showSubMenu(subMenuElement);
};

const openBlankTemplateActionMenu = (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    data: IAV;
    undoData: IAV;
    element: HTMLElement;
    menu: Menu;
}) => {
    const opened = options.element.classList.contains("b3-menu__item--show");
    options.menu.element.querySelectorAll(".b3-menu__item--show").forEach(item => item.classList.remove("b3-menu__item--show"));
    if (opened) {
        return;
    }
    let subMenuElement = options.element.querySelector(":scope > .b3-menu__submenu") as HTMLElement;
    if (!subMenuElement) {
        subMenuElement = document.createElement("div");
        subMenuElement.classList.add("b3-menu__submenu");
        subMenuElement.dataset.anchor = "action";
        const itemsElement = document.createElement("div");
        itemsElement.classList.add("b3-menu__items");
        subMenuElement.append(itemsElement);
        itemsElement.append(new MenuItem({
            icon: "iconSelect",
            label: window.siyuan.languages.setAsDefault,
            disabled: !options.data.defaultTemplateID,
            click: () => saveNewItemTemplateConfig({
                protyle: options.protyle,
                blockElement: options.blockElement,
                data: options.undoData,
                templates: cloneTemplates(options.data.newItemTemplates),
                defaultTemplateID: "",
            }),
        }).element);
        options.element.append(subMenuElement);
    }
    options.element.classList.add("b3-menu__item--show");
    options.menu.showSubMenu(subMenuElement);
};

export const openNewItemTemplateMenu = (options: {protyle: IProtyle, blockElement: HTMLElement, target: HTMLElement}) => {
    fetchPost("/api/av/renderAttributeView", {
        id: options.blockElement.dataset.avId,
        viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
        ignoreRows: true,
    }, response => {
        const data = response.data as IAV;
        const menuData = getCustomTemplateData(data);
        const menu = new Menu("av-new-item-template");
        menu.addItem({
            iconHTML: "",
            label: window.siyuan.languages.useTemplate.replace("${x}", escapeHtml(data.name || "")),
            type: "readonly",
        });
        menu.addItem({
            iconHTML: "",
            label: window.siyuan.languages.empty,
            accelerator: menuData.defaultTemplateID ? "" : window.siyuan.languages.default,
            action: "iconMore",
            click: () => createAttributeViewItem({
                protyle: options.protyle,
                blockElement: options.blockElement,
            }),
            bind: element => {
                const actionElement = element.querySelector(".b3-menu__action") as HTMLElement;
                actionElement.classList.add("ariaLabel");
                actionElement.setAttribute("data-position", "4west");
                actionElement.setAttribute("aria-label", window.siyuan.languages.more);
                actionElement.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    openBlankTemplateActionMenu({
                        protyle: options.protyle,
                        blockElement: options.blockElement,
                        data: menuData,
                        undoData: data,
                        element,
                        menu,
                    });
                });
            },
        });
        let draggedTemplateID = "";
        let draggedTemplateMoved = false;
        (menuData.newItemTemplates || []).forEach(item => menu.addItem({
            iconHTML: "",
            label: escapeHtml(item.name),
            accelerator: item.id === menuData.defaultTemplateID ? window.siyuan.languages.default : "",
            action: "iconMore",
            click: () => {
                if (draggedTemplateMoved) {
                    draggedTemplateMoved = false;
                    return;
                }
                createAttributeViewItem({
                    protyle: options.protyle,
                    blockElement: options.blockElement,
                    templateID: item.id,
                });
            },
            bind: element => {
                element.dataset.templateId = item.id;
                element.draggable = true;
                element.querySelector(".b3-menu__label")?.insertAdjacentHTML("beforebegin", '<svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>');
                const actionElement = element.querySelector(".b3-menu__action") as HTMLElement;
                actionElement.classList.add("ariaLabel");
                actionElement.setAttribute("data-position", "4west");
                actionElement.setAttribute("aria-label", window.siyuan.languages.more);
                actionElement.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    openNewItemTemplateActionMenu({
                        protyle: options.protyle,
                        blockElement: options.blockElement,
                        data: menuData,
                        undoData: data,
                        itemTemplate: item,
                        element,
                        menu,
                    });
                });
            },
        }));
        const clearTemplateDragStyles = () => {
            menu.element.querySelectorAll<HTMLElement>("[data-template-id]").forEach(element => {
                element.style.borderTop = "";
                element.style.borderBottom = "";
                element.style.opacity = "";
            });
        };
        menu.element.ondragstart = (event: DragEvent) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>("[data-template-id]");
            if (!target) {
                return;
            }
            draggedTemplateID = target.dataset.templateId;
            draggedTemplateMoved = false;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedTemplateID);
            target.style.opacity = ".38";
        };
        menu.element.ondragover = (event: DragEvent) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>("[data-template-id]");
            if (!target || !draggedTemplateID) {
                return;
            }
            event.preventDefault();
            draggedTemplateMoved = true;
            clearTemplateDragStyles();
            const rect = target.getBoundingClientRect();
            target.style[event.clientY < rect.top + rect.height / 2 ? "borderTop" : "borderBottom"] = "2px solid var(--b3-theme-primary-lighter)";
        };
        menu.element.ondrop = (event: DragEvent) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>("[data-template-id]");
            if (!target || !draggedTemplateID) {
                return;
            }
            event.preventDefault();
            const templates = menuData.newItemTemplates || [];
            const oldIndex = templates.findIndex(item => item.id === draggedTemplateID);
            const targetIndex = templates.findIndex(item => item.id === target.dataset.templateId);
            if (oldIndex < 0 || targetIndex < 0 || oldIndex === targetIndex) {
                draggedTemplateID = "";
                clearTemplateDragStyles();
                return;
            }
            const rect = target.getBoundingClientRect();
            let insertIndex = targetIndex + (event.clientY < rect.top + rect.height / 2 ? 0 : 1);
            if (oldIndex < insertIndex) {
                insertIndex--;
            }
            const oldTemplates = cloneTemplates(templates);
            const draggedElement = menu.element.querySelector<HTMLElement>(`[data-template-id="${CSS.escape(draggedTemplateID)}"]`);
            if (draggedElement) {
                if (event.clientY < rect.top + rect.height / 2) {
                    target.before(draggedElement);
                } else {
                    target.after(draggedElement);
                }
            }
            const [movedTemplate] = templates.splice(oldIndex, 1);
            templates.splice(insertIndex, 0, movedTemplate);
            saveNewItemTemplateConfig({
                protyle: options.protyle,
                blockElement: options.blockElement,
                data: {...menuData, newItemTemplates: oldTemplates},
                templates: cloneTemplates(templates),
                defaultTemplateID: menuData.defaultTemplateID || "",
            });
            draggedTemplateID = "";
            clearTemplateDragStyles();
        };
        menu.element.ondragend = () => {
            draggedTemplateID = "";
            clearTemplateDragStyles();
        };
        menu.addItem({type: "separator"});
        menu.addItem({
            iconHTML: "",
            label: `${window.siyuan.languages.new} ${window.siyuan.languages.template}`,
            click: () => openNewItemTemplateDialog({
                protyle: options.protyle,
                blockElement: options.blockElement,
                data: menuData,
                undoData: data,
                createNew: true,
            }),
        });
        const rect = options.target.getBoundingClientRect();
        menu.open({x: rect.left, y: rect.bottom, h: rect.height});
    });
};
