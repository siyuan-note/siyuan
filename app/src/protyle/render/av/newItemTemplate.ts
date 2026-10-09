import {isAVNewItemTemplateType, isAVSelectType} from "./capabilities";
import {bindFieldLunarDates, genFieldValue, getValueInputHTML, openFieldSelectMenu, getRelationOptions, renderRelationFieldValue, openFieldRelationMenu} from "./fieldValueEditor";
import {getCalendarCreationDate} from "./calendar/state";
import {Constants} from "../../../constants";
import {Dialog} from "../../../dialog";
import {showMessage} from "../../../dialog/message";
import {Menu} from "../../../plugin/Menu";
import {MenuItem} from "../../../menus/Menu";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchPost} from "../../../util/fetch";
import {transaction} from "../../wysiwyg/transaction";
import {avRender} from "./render";
import {getFieldsByData} from "./view";
import {getColIconByType} from "./col";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";
import {getAVBlockIconHTML} from "./blockIcon";
import {upDownHint} from "../../../util/upDownHint";
import {hasClosestByClassName} from "../../util/hasClosest";
import {isMobile} from "../../../util/functions";
import {openDatabaseRowByData} from "./openDatabaseRow";
/// #if MOBILE
import {activeBlur} from "../../../mobile/util/keyboardToolbar";
import {bindBottomSheetDialog} from "../../../mobile/util/bindBottomSheetDialog";
/// #endif

interface ICreatePosition {
    calendarDate?: number;
    previousID?: string;
    groupID?: string;
}

const SAVE_LOCATION_DEFAULT = "__default__";
const SAVE_LOCATION_SUB_DOC = "__subdoc__";

const cloneTemplates = (templates?: IAVNewItemTemplate[]) => JSON.parse(JSON.stringify(templates || [])) as IAVNewItemTemplate[];

const getCustomTemplateData = (data: IAV) => {
    return {
        ...data,
        newItemTemplates: cloneTemplates(data.newItemTemplates),
        defaultTemplateID: data.defaultTemplateID || "",
    };
};

const getFieldsHTML = (fields: IAVColumn[], itemTemplate: IAVNewItemTemplate) => fields.map(column => {
    const fieldValue = itemTemplate.fieldValues?.[column.id];
    const icon = column.icon ? unicode2Emoji(column.icon, "block__logoicon", true) : `<svg class="block__logoicon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`;
    const selected = fieldValue?.value?.mSelect?.map(item => item.content) || [];
    const selectAttrs = isAVSelectType(column.type) ?
        ` data-role="field-value" data-value-type="${column.type}" data-selected="${escapeAttr(JSON.stringify(selected))}"` : "";
    return `<div class="block__icons av__row" data-field-id="${column.id}">
    <div class="block__logo block__logo--icon" title="${escapeAttr(column.name)}">${icon}<span>${escapeHtml(column.name)}</span></div>
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
    <div class="block__logo block__logo--icon" title="${escapeAttr(name)}">${icon}<span>${escapeHtml(name)}</span></div>
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
        case "text":
            return !!value.text?.content || !!value.text?.rich;
        default:
            return !!value.text?.content;
    }
};

interface IContentTemplateSearchResult {
    path: string;
    relativePath?: string;
}

const getContentTemplateRelativePath = (item: IContentTemplateSearchResult) => {
    if (item.relativePath) {
        return item.relativePath;
    }
    const normalizedPath = (item.path || "").replace(/\\/g, "/");
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
        label: `<div data-menu="true" style="padding:4px;width:360px;max-width:100%;box-sizing:border-box">
    <input spellcheck="false" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.searchPlaceholder}">
    <div class="b3-list b3-list--background" style="margin-top:4px;max-height:240px;overflow:auto"></div>
</div>`,
        bind: menuElement => {
            menuElement.classList.add("b3-menu__custom");
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
    itemTemplate.icon = (root.querySelector('[data-role="template-icon"]') as HTMLElement).dataset.value || "";
    itemTemplate.primaryKeyTemplate = (root.querySelector('[data-role="primary-key"]') as HTMLInputElement).value;
    itemTemplate.contentTemplatePath = (root.querySelector('[data-role="content-template"]') as HTMLElement).dataset.value || "";
    const boxID = (root.querySelector('[data-role="box-id"]') as HTMLSelectElement).value;
    if (boxID === SAVE_LOCATION_DEFAULT) {
        itemTemplate.saveLocation = undefined;
    } else if (boxID === SAVE_LOCATION_SUB_DOC) {
        itemTemplate.saveLocation = {pathTemplate: ""};
    } else {
        itemTemplate.saveLocation = {
            boxID,
            pathTemplate: (root.querySelector('[data-role="path-template"]') as HTMLInputElement).value,
        };
    }
    itemTemplate.hideInFileTree = itemTemplate.targetType === "document" &&
        (root.querySelector('[data-role="hide-in-file-tree"]') as HTMLInputElement).checked;
    const fieldValues: Record<string, IAVNewItemFieldValue> = {};
    root.querySelectorAll<HTMLElement>("[data-field-id]").forEach(element => {
        const column = fields.find(item => item.id === element.dataset.fieldId);
        const mode = (element.querySelector('[data-role="field-mode"]') as HTMLSelectElement)?.value as TAVNewItemFieldValueMode || "static";
        const previousValue = itemTemplate.fieldValues?.[column.id]?.value;
        const value = mode === "static" ?
            genFieldValue(column, element.querySelector('[data-role="field-value"]'), previousValue) : undefined;
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
    const isDocument = itemTemplate.targetType === "document";
    const savedNotebook = window.siyuan.notebooks?.find(item => item.id === itemTemplate.saveLocation?.boxID);
    const unavailableNotebookID = !forceCurrentNotebook && itemTemplate.saveLocation?.boxID &&
        (!savedNotebook || savedNotebook.closed) ? itemTemplate.saveLocation.boxID : "";
    const unavailableNotebookOption = unavailableNotebookID ?
        `<option value="${escapeAttr(unavailableNotebookID)}" data-unavailable="true" selected disabled>${escapeHtml(savedNotebook?.name || unavailableNotebookID)}</option>` : "";
    const isDefault = !forceCurrentNotebook && !itemTemplate.saveLocation;
    const isSubDoc = !!itemTemplate.saveLocation && !itemTemplate.saveLocation.boxID && !itemTemplate.saveLocation.pathTemplate;
    const currentNotebookSelected = !isSubDoc && (forceCurrentNotebook || !!itemTemplate.saveLocation &&
        (!itemTemplate.saveLocation.boxID || itemTemplate.saveLocation.boxID === currentNotebookID));
    const showPath = !isSubDoc && (forceCurrentNotebook || !!itemTemplate.saveLocation);
    const notebookOptions = (forceCurrentNotebook ? "" :
        `<option value="${SAVE_LOCATION_DEFAULT}"${itemTemplate.saveLocation ? "" : " selected"}>${window.siyuan.languages.default}</option>`) +
        `<option value="${SAVE_LOCATION_SUB_DOC}"${isSubDoc ? " selected" : ""}>${window.siyuan.languages.newItemTemplateSubDoc}</option>` +
        `<option value=""${currentNotebookSelected ? " selected" : ""}>${window.siyuan.languages.currentNotebook}</option>` +
        unavailableNotebookOption +
        (forceCurrentNotebook ? "" : (window.siyuan.notebooks || []).filter(item => !item.closed && item.id !== currentNotebookID)
            .map(item => `<option value="${item.id}"${item.id === itemTemplate.saveLocation?.boxID ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join(""));
    return `<div class="av__template-editor" data-role="template-editor" style="padding:16px;overflow:auto;flex:1">
    <div class="custom-attr">
        <div class="block__icons av__row">
            <div class="block__logo block__logo--icon"><svg class="block__logoicon"><use xlink:href="#iconEdit"></use></svg><span>${window.siyuan.languages.title}</span></div>
            <div class="fn__flex-1 fn__flex custom-attr__avvalue" style="align-items:center"><input class="b3-text-field b3-text-field--text fn__flex-1" data-role="template-name" value="${escapeAttr(itemTemplate.name)}"></div>
        </div>
        <div class="block__icons av__row">
            <div class="block__logo block__logo--icon"><svg class="block__logoicon"><use xlink:href="#iconAdd"></use></svg><span>${window.siyuan.languages.type}</span></div>
            <div class="fn__flex-1 fn__flex custom-attr__avvalue" style="align-items:center"><select class="b3-select fn__flex-1" data-role="target-type"><option value="detached"${isDocument ? "" : " selected"}>${window.siyuan.languages.createDetachedBlock}</option><option value="document"${isDocument ? " selected" : ""}>${window.siyuan.languages.createBoundBlock}</option></select></div>
        </div>
        <div class="block__icons av__row">
            <div class="block__logo block__logo--icon"><svg class="block__logoicon"><use xlink:href="#iconEmoji"></use></svg><span>${window.siyuan.languages.icon}</span></div>
            <div class="fn__flex-1 fn__flex custom-attr__avvalue" style="align-items:center"><button class="b3-text-field b3-text-field--text fn__flex-1 fn__flex" data-role="template-icon" data-value="${escapeAttr(itemTemplate.icon || "")}" type="button" style="align-items:center;text-align:left"><span class="b3-menu__avemoji">${getAVBlockIconHTML({isDetached: !isDocument, block: {content: "", icon: itemTemplate.icon}})}</span></button></div>
        </div>
    </div>
    <div data-role="document-options" class="${isDocument ? "" : "fn__none"}">
        <div class="fn__hr"></div>
        <div class="custom-attr">
            <div class="block__icons av__row">
                <div class="block__logo block__logo--icon ariaLabel" data-position="parentE" aria-label="${escapeAttr(`${window.siyuan.languages.fileTree14}<br>${window.siyuan.languages.fileTree13}`)}"><svg class="block__logoicon"><use xlink:href="#iconFolder"></use></svg><span>${window.siyuan.languages.savePath}</span></div>
                <div class="fn__flex-1 custom-attr__avvalue"><div class="fn__flex" style="align-items:center"><select class="b3-select" data-role="box-id" style="width:${showPath ? "160px" : "100%"}">${notebookOptions}</select><span class="fn__space${showPath ? "" : " fn__none"}" data-role="path-space"></span><input spellcheck="false" class="b3-text-field fn__flex-1${showPath ? "" : " fn__none"}" data-role="path-template" value="${escapeAttr(itemTemplate.saveLocation?.pathTemplate || "")}"${showPath ? "" : " disabled"}></div><div class="b3-label__text${isDefault ? "" : " fn__none"}" data-role="default-tip" style="margin-top:4px">${window.siyuan.languages.newItemTemplateDefaultTip}</div><div class="b3-label__text${isSubDoc ? "" : " fn__none"}" data-role="subdoc-tip" style="margin-top:4px">${window.siyuan.languages.newItemTemplateSubDocTip}</div></div>
            </div>
            <div class="block__icons av__row">
                <div class="block__logo block__logo--icon"><svg class="block__logoicon"><use xlink:href="#iconEyeoff"></use></svg><span>${window.siyuan.languages.hideInFileTree}</span></div>
                <div class="fn__flex custom-attr__avvalue av__template-switch" style="align-items:center;justify-content:flex-end"><input class="b3-switch" data-role="hide-in-file-tree" type="checkbox"${itemTemplate.hideInFileTree ? " checked" : ""}></div>
            </div>
            <div class="block__icons av__row">
                <div class="block__logo block__logo--icon"><svg class="block__logoicon"><use xlink:href="#iconFile"></use></svg><span>${window.siyuan.languages.contentTemplate}</span></div>
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
    const fields = allFields.filter(item => isAVNewItemTemplateType(item.type));
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
        title: isMobile() ? undefined : window.siyuan.languages.itemTemplate,
        width: isMobile() ? "100vw" : "820px",
        height: isMobile() ? "60vh" : "70vh",
        containerClassName: "b3-dialog__container--theme",
        hideCloseIcon: isMobile(),
        content: `<div class="fn__flex fn__flex-column" style="height:100%">
    <div class="av__template-panels fn__flex fn__flex-1" style="min-height:0">
        <ul class="av__template-list b3-list b3-list--background" data-role="template-list"></ul>
        <div data-role="editor-host" class="fn__flex-1 fn__flex"></div>
    </div>
    <div class="b3-dialog__action"><button class="b3-button b3-button--cancel" data-role="cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text" data-role="confirm">${window.siyuan.languages.confirm}</button></div>
</div>`,
        destroyCallback: () => {
            /// #if MOBILE
            disposeSheet();
            /// #endif
        },
    });
    /// #if MOBILE
    const destroyDialog = dialog.destroy.bind(dialog);
    dialog.destroy = (destroyOptions?: IObject) => {
        if (dialog.element.contains(document.activeElement)) {
            activeBlur(true);
        }
        destroyDialog(destroyOptions);
    };
    const disposeSheet = bindBottomSheetDialog(dialog, async () => dialog.destroy());
    /// #endif
    const root = dialog.element;
    const listElement = root.querySelector('[data-role="template-list"]') as HTMLElement;
    const hostElement = root.querySelector('[data-role="editor-host"]') as HTMLElement;
    const warnedUnavailableNotebooks = new Set<string>();

    const collectCurrent = () => {
        const editor = root.querySelector('[data-role="template-editor"]') as HTMLElement;
        if (!editor || selectedIndex < 0) {
            return;
        }
        collectTemplate(editor, templates[selectedIndex], fields);
    };

    const render = () => {
        listElement.innerHTML = `<li class="b3-list-item" data-role="add-template"><svg class="b3-list-item__graphic"><use xlink:href="#iconAdd"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.newTemplate}</span></li><li class="b3-menu__separator"></li>` +
            templates.map((item, index) => `<li class="b3-list-item b3-list-item--hide-action${index === selectedIndex ? " b3-list-item--focus" : ""}" data-index="${index}" draggable="true"><svg class="b3-list-item__graphic fn__grab"><use xlink:href="#iconDrag"></use></svg><span class="b3-list-item__text">${escapeHtml(item.name)}</span>${item.id === defaultTemplateID ? `<span class="b3-list-item__meta">${window.siyuan.languages.default}</span>` : ""}<span class="b3-list-item__action ariaLabel" data-menu="true" data-position="4west" data-role="template-action" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></span></li>`).join("");
        hostElement.innerHTML = selectedIndex < 0 ? "" : getEditorHTML(templates[selectedIndex], primaryKey, fields, options.protyle.notebookId);
        const target = hostElement.querySelector('[data-role="target-type"]') as HTMLSelectElement;
        target?.addEventListener("change", () => {
            hostElement.querySelector('[data-role="document-options"]')?.classList.toggle("fn__none", target.value !== "document");
            const iconElement = hostElement.querySelector<HTMLElement>('[data-role="template-icon"]');
            iconElement.querySelector(".b3-menu__avemoji").innerHTML = getAVBlockIconHTML({
                isDetached: target.value !== "document", block: {content: "", icon: iconElement.dataset.value},
            });
        });
        const boxIDElement = hostElement.querySelector('[data-role="box-id"]') as HTMLSelectElement;
        const unavailableOption = boxIDElement?.selectedOptions[0]?.dataset.unavailable === "true";
        if (target?.value === "document" && unavailableOption && !warnedUnavailableNotebooks.has(templates[selectedIndex].id)) {
            warnedUnavailableNotebooks.add(templates[selectedIndex].id);
            showMessage(window.siyuan.languages.newItemTemplateUnavailableNotebookTip, 6000, "error");
        }
        boxIDElement?.addEventListener("change", () => {
            const pathElement = hostElement.querySelector('[data-role="path-template"]') as HTMLInputElement;
            const showPath = boxIDElement.value !== SAVE_LOCATION_DEFAULT && boxIDElement.value !== SAVE_LOCATION_SUB_DOC;
            pathElement.disabled = !showPath;
            pathElement.classList.toggle("fn__none", !showPath);
            boxIDElement.style.width = showPath ? "160px" : "100%";
            hostElement.querySelector('[data-role="path-space"]')?.classList.toggle("fn__none", !showPath);
            hostElement.querySelector('[data-role="default-tip"]')?.classList.toggle("fn__none", boxIDElement.value !== SAVE_LOCATION_DEFAULT);
            hostElement.querySelector('[data-role="subdoc-tip"]')?.classList.toggle("fn__none", boxIDElement.value !== SAVE_LOCATION_SUB_DOC);
        });
        hostElement.querySelector<HTMLElement>('[data-role="content-template"]')?.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            openContentTemplateMenu(event.currentTarget as HTMLElement);
        });
        hostElement.querySelector<HTMLElement>('[data-role="template-icon"]')?.addEventListener("click", event => {
            const iconElement = event.currentTarget as HTMLElement;
            const emojiElement = iconElement.querySelector(".b3-menu__avemoji") as HTMLElement;
            const rect = emojiElement.getBoundingClientRect();
            openEmojiPanel("", "av", {
                x: rect.left,
                y: rect.bottom + 4,
                h: rect.height,
                w: rect.width,
            }, unicode => {
                iconElement.dataset.value = unicode;
                emojiElement.innerHTML = getAVBlockIconHTML({
                    isDetached: target.value !== "document", block: {content: "", icon: unicode},
                });
            }, emojiElement.querySelector("img"), {
                ownerElement: options.protyle.element,
                targetID: options.protyle.block.rootID,
            });
            event.preventDefault();
            event.stopPropagation();
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
        bindFieldLunarDates(hostElement);
        hostElement.querySelectorAll<HTMLElement>('[data-role="field-value"][data-value-type]:not([data-value-type="lunarDate"])').forEach(item => item.addEventListener("click", (event) => {
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
    };

    const openTemplateActionMenu = (target: HTMLElement, itemTemplate: IAVNewItemTemplate) => {
        const menu = new Menu(`av-new-item-template-dialog-${itemTemplate.id}`);
        menu.addItem({
            icon: "iconEdit",
            label: window.siyuan.languages.edit,
            click: () => {
                collectCurrent();
                selectedIndex = templates.findIndex(item => item.id === itemTemplate.id);
                render();
            },
        });
        menu.addItem({
            icon: "iconSelect",
            label: window.siyuan.languages.setAsDefault,
            disabled: itemTemplate.id === defaultTemplateID,
            click: () => {
                collectCurrent();
                defaultTemplateID = itemTemplate.id;
                render();
            },
        });
        menu.addItem({type: "separator"});
        menu.addItem({
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            warning: true,
            click: () => {
                collectCurrent();
                const deletedIndex = templates.findIndex(item => item.id === itemTemplate.id);
                if (deletedIndex < 0) {
                    return;
                }
                templates.splice(deletedIndex, 1);
                if (defaultTemplateID === itemTemplate.id) {
                    defaultTemplateID = "";
                }
                if (selectedIndex === deletedIndex) {
                    selectedIndex = Math.min(deletedIndex, templates.length - 1);
                } else if (deletedIndex < selectedIndex) {
                    selectedIndex--;
                }
                render();
            },
        });
        const rect = target.getBoundingClientRect();
        menu.open({x: rect.right, y: rect.bottom, h: rect.height});
    };

    let draggingIndex = -1;
    const clearDragover = () => {
        listElement.querySelectorAll<HTMLElement>("[data-index]").forEach(item => {
            item.classList.remove("dragover__top", "dragover__bottom");
        });
    };
    const clearDragStyles = () => {
        clearDragover();
        listElement.querySelectorAll<HTMLElement>("[data-index]").forEach(item => {
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
        clearDragover();
        const before = event.clientY < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
        target.classList.add(before ? "dragover__top" : "dragover__bottom");
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
        const target = event.target as HTMLElement;
        const roleElement = target.closest<HTMLElement>("[data-role]");
        const itemElement = target.closest<HTMLElement>("[data-index]");
        if (!roleElement && !itemElement) {
            return;
        }
        if (roleElement?.dataset.role === "add-template") {
            collectCurrent();
            templates.push({id: Lute.NewNodeID(), name: window.siyuan.languages.template, targetType: "detached"});
            selectedIndex = templates.length - 1;
            render();
        } else if (roleElement?.dataset.role === "template-action" && itemElement) {
            const itemTemplate = templates[parseInt(itemElement.dataset.index)];
            if (itemTemplate) {
                openTemplateActionMenu(roleElement, itemTemplate);
            }
        } else if (itemElement) {
            collectCurrent();
            selectedIndex = parseInt(itemElement.dataset.index);
            render();
        }
    });
    root.querySelector('[data-role="cancel"]').addEventListener("click", () => dialog.destroy());
    root.querySelector('[data-role="confirm"]').addEventListener("click", () => {
        const boxIDElement = hostElement.querySelector('[data-role="box-id"]') as HTMLSelectElement;
        const target = hostElement.querySelector('[data-role="target-type"]') as HTMLSelectElement;
        if (target?.value === "document" && boxIDElement?.selectedOptions[0]?.dataset.unavailable === "true") {
            showMessage(window.siyuan.languages.newItemTemplateUnavailableNotebookTip, 6000, "error");
            return;
        }
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
        calendarDate: options.position?.calendarDate ?? getCalendarCreationDate(options.blockElement),
        viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
        avID: options.blockElement.dataset.avId,
        blockID: options.blockElement.dataset.nodeId,
        templateID: options.templateID || "",
        previousID: options.position?.previousID || "",
        groupID: options.position?.groupID || "",
        app: options.protyle.app.appId,
        session: options.protyle.id,
    }, response => {
        if (response.code === 1 && response.data && "unavailableNotebook" in response.data && response.data.unavailableNotebook) {
            showMessage(window.siyuan.languages.newItemTemplateUnavailableNotebookTip, 6000, "error");
            return;
        }
        const warnings = response.data && "warnings" in response.data ? response.data.warnings || [] : [];
        if (warnings.length) {
            showMessage(warnings.map(item => escapeHtml(item)).join("<br>"));
        }
        options.blockElement.removeAttribute("data-render");
        avRender(options.blockElement, options.protyle);
        if (options.blockElement.dataset.avType === "calendar" && response.code === 0 &&
            response.data && "itemID" in response.data) {
            void openDatabaseRowByData(options.protyle, {
                avID: options.blockElement.dataset.avId, databaseBlockID: options.blockElement.dataset.nodeId,
                notebookID: options.protyle.notebookId, itemID: response.data.itemID, valueID: "",
                title: response.data.content || window.siyuan.languages.untitled,
                boundBlockID: response.data.blockID, isDetached: response.data.isDetached,
                focusPrimary: true,
            });
        }
    });
};

export const createAttributeViewItemDocs = (options: {
    protyle: IProtyle;
    blockElement: HTMLElement;
    itemIDs: string[];
    saveMode: "subDoc" | "template";
}) => {
    if (options.blockElement.dataset.createDocAndBind === "true") {
        return;
    }
    options.blockElement.dataset.createDocAndBind = "true";
    fetchPost("/api/av/createAttributeViewItemDocs", {
        avID: options.blockElement.dataset.avId,
        blockID: options.blockElement.dataset.nodeId,
        itemIDs: options.itemIDs,
        saveMode: options.saveMode,
        app: options.protyle.app.appId,
        session: options.protyle.id,
    }, response => {
        if (response.code === 1 && response.data && "unavailableNotebook" in response.data && response.data.unavailableNotebook) {
            showMessage(window.siyuan.languages.newItemTemplateUnavailableNotebookTip, 6000, "error");
            return;
        }
        const warnings = response.data && "warnings" in response.data ? response.data.warnings || [] : [];
        if (warnings.length) {
            showMessage(warnings.map(item => escapeHtml(item)).join("<br>"));
        }
        options.blockElement.removeAttribute("data-render");
        avRender(options.blockElement, options.protyle);
    }).finally(() => {
        delete options.blockElement.dataset.createDocAndBind;
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
        blockID: options.blockElement.dataset.nodeId,
        ignoreRows: true,
    }, response => {
        const data = response.data as IAV;
        const menuData = getCustomTemplateData(data);
        const menu = new Menu("av-new-item-template");
        menu.addItem({
            iconHTML: "",
            label: window.siyuan.languages.newItemWithTemplate,
            type: "readonly",
        });
        menu.addItem({
            iconHTML: '<svg class="b3-menu__icon fn__hidden"><use xlink:href="#iconDrag"></use></svg>',
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
        let resetDraggedTemplateMovedTimer = 0;
        const resetDraggedTemplateMoved = () => {
            window.clearTimeout(resetDraggedTemplateMovedTimer);
            resetDraggedTemplateMovedTimer = window.setTimeout(() => {
                draggedTemplateMoved = false;
            });
        };
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
        const clearTemplateDragover = () => {
            menu.element.querySelectorAll<HTMLElement>("[data-template-id]").forEach(element => {
                element.classList.remove("dragover__top", "dragover__bottom");
            });
        };
        const clearTemplateDragStyles = () => {
            clearTemplateDragover();
            menu.element.querySelectorAll<HTMLElement>("[data-template-id]").forEach(element => {
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
            window.clearTimeout(resetDraggedTemplateMovedTimer);
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
            clearTemplateDragover();
            const rect = target.getBoundingClientRect();
            target.classList.add(event.clientY < rect.top + rect.height / 2 ? "dragover__top" : "dragover__bottom");
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
                resetDraggedTemplateMoved();
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
            resetDraggedTemplateMoved();
        };
        menu.element.ondragend = () => {
            draggedTemplateID = "";
            clearTemplateDragStyles();
            resetDraggedTemplateMoved();
        };
        menu.addItem({type: "separator"});
        menu.addItem({
            iconHTML: "",
            label: window.siyuan.languages.newTemplate,
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
