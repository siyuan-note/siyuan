import {isAVSelectType} from "./capabilities";
import {Menu} from "../../../plugin/Menu";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchPost} from "../../../util/fetch";
import {upDownHint} from "../../../util/upDownHint";
import * as dayjs from "dayjs";
import {getAVBlockRefSubtype} from "./cellValue";
import {getAVColorStyle} from "./color";
import {createAVPlainTextEditValue} from "./richTextValue";
import {getFileTreeIconHTML} from "../../../emoji/fileTreeIcon";
import {renderAVBlockIcon} from "./blockIcon";
import {formatDateValue} from "./dateFormat";
import {bindLunarDateEditor, getLunarDateHTML} from "./lunarDate";
import {createAVLocationReplacement, getAVLocationDisplayText} from "./locationValue";
import {openAVLocationEditor} from "./locationEditor";

export const getSelectedOptionNames = (element: HTMLElement) => {
    try {
        return JSON.parse(element.dataset.selected || "[]") as string[];
    } catch (e) {
        return [];
    }
};

export const getSelectedOptionsHTML = (column: IAVColumn, selected: string[]) => {
    return selected.map(name => (column.options || []).find(item => item.name === name)).filter(item => item).map(item => `<span class="b3-chip b3-chip--middle" style="max-width:100%;${getAVColorStyle(item)}"><span class="fn__ellipsis">${escapeHtml(item.name)}</span></span>`).join("");
};

const getFieldSelectMenuHTML = (column: IAVColumn, selected: string[], keyword = "") => {
    const selectedHTML = selected.map(name => (column.options || []).find(item => item.name === name)).filter(item => item).map(item => `<div class="b3-chip b3-chip--middle" data-name="${escapeAttr(item.name)}" style="white-space:nowrap;max-width:100%;${getAVColorStyle(item)}"><span class="fn__ellipsis">${escapeHtml(item.name)}</span><svg class="b3-chip__close" data-role="remove-field-option"><use xlink:href="#iconClose"></use></svg></div>`).join("");
    const normalizedKeyword = keyword.toLowerCase();
    const options = (column.options || []).filter(item => !normalizedKeyword ||
        item.name.toLowerCase().includes(normalizedKeyword) || normalizedKeyword.includes(item.name.toLowerCase()));
    const optionsHTML = options.map((option, index) => `<button class="b3-menu__item${index === 0 ? " b3-menu__item--current" : ""}" data-role="field-option" data-name="${escapeAttr(option.name)}">
    <div class="fn__flex-1">
        <span class="b3-chip" style="${getAVColorStyle(option)}"><span class="fn__ellipsis">${escapeHtml(option.name)}</span></span>
    </div>
    ${selected.includes(option.name) ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>' : ""}
</button>`).join("");
    return `<div class="b3-chips">${selectedHTML}<input spellcheck="false" value="${escapeAttr(keyword)}"></div><div data-role="field-options" style="flex:1;overflow:auto">${optionsHTML}</div>`;
};

const getFieldText = (value: IAVCellValue) => {
    switch (value?.type) {
        case "block":
            return value.block?.content || "";
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

export const genFieldValue = (column: IAVColumn, input: HTMLElement, previousValue?: IAVCellValue): IAVCellValue => {
    const inputContent = (input as HTMLInputElement).value || "";
    const content = inputContent.trim();
    switch (column.type) {
        case "block":
            return {type: "block", block: {content}};
        case "number":
            return {type: column.type, number: {content: Number(content), isNotEmpty: content !== ""}};
        case "date":
            if (column.dateFormat === "lunar") {
                return {type: "date", date: JSON.parse(input.dataset.lunarValue)};
            }
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
        case "location":
            return {type: "location", location: createAVLocationReplacement(JSON.parse(decodeURIComponent(input.dataset.location || "%7B%7D")))};
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
        case "text":
            return createAVPlainTextEditValue(previousValue?.type === "text" &&
                previousValue.text?.content === inputContent ? inputContent : content, previousValue);
        default:
            return {type: column.type, text: {content}};
    }
};

export const getValueInputHTML = (column: IAVColumn, fieldValue?: IAVNewItemFieldValue) => {
    const value = fieldValue?.value;
    if (column.type === "date" && column.dateFormat === "lunar") {
        const date = value?.date || {isNotEmpty: false, isNotTime: !column.date?.fillSpecificTime};
        return `<button type="button" class="b3-button b3-button--cancel${fieldValue?.mode === "currentTime" ? " fn__none" : ""}" data-role="field-value" data-value-type="lunarDate" data-lunar-value="${escapeAttr(JSON.stringify(date))}">${escapeHtml(formatDateValue(date, "lunar") || window.siyuan.languages.select)}</button>`;
    }
    if (column.type === "location") {
        const location = value ? value.location || {coordinateSystem: "unknown"} :
            {coordinateSystem: column.location?.defaultCoordinateSystem || "unknown"};
        return `<button type="button" class="b3-button b3-button--cancel fn__flex-1" data-role="field-value" data-value-type="location" data-location="${escapeAttr(encodeURIComponent(JSON.stringify(location)))}">${escapeHtml(getAVLocationDisplayText(location) || window.siyuan.languages.empty)}</button>`;
    }
    if (column.type === "checkbox") {
        const checked = value?.checkbox?.checked || false;
        return `<button class="fn__flex-center" data-role="field-value" data-value-type="checkbox" aria-label="${escapeAttr(column.name || window.siyuan.languages.checkbox)}" aria-pressed="${checked}" type="button" style="background:transparent;border:0;color:inherit;padding:0"><svg class="av__checkbox"><use xlink:href="#icon${checked ? "Check" : "Uncheck"}"></use></svg></button>`;
    }
    if (isAVSelectType(column.type)) {
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
    return `<input class="b3-text-field b3-text-field--text fn__flex-1${hiddenClass}" data-role="field-value" type="${inputType}"${column.type === "number" ? ' step="any"' : ""}${max} value="${escapeAttr(getFieldText(value))}">`;
};

export const bindFieldLunarDates = (host: HTMLElement) => {
    host.querySelectorAll<HTMLElement>('[data-value-type="lunarDate"]').forEach(target => target.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const value: IAVCellDateValue = JSON.parse(target.dataset.lunarValue);
        let submit: () => void;
        const menu = new Menu("av-field-lunar-date", () => submit?.(), true);
        menu.addItem({
            type: "empty",
            label: getLunarDateHTML(value),
            bind: element => {
                element.classList.add("b3-menu__custom");
                submit = bindLunarDateEditor({
                    value, menuElement: element, requireExplicitChange: true,
                    update: date => {
                        target.dataset.lunarValue = JSON.stringify(date);
                        target.textContent = formatDateValue(date, "lunar") || window.siyuan.languages.select;
                        target.dispatchEvent(new Event("change", {bubbles: true}));
                    },
                    close: () => menu.close(),
                });
            },
        });
        const rect = target.getBoundingClientRect();
        menu.open({x: rect.left, y: rect.bottom, h: rect.height, target});
    }));
};

export const openFieldLocationEditor = (target: HTMLElement) => {
    openAVLocationEditor({
        value: JSON.parse(decodeURIComponent(target.dataset.location || "%7B%7D")),
        ownerElement: target,
        avBlockID: target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId,
        onSave: value => {
            if (!target.isConnected) {
                return;
            }
            target.dataset.location = encodeURIComponent(JSON.stringify(value));
            target.textContent = getAVLocationDisplayText(value) || window.siyuan.languages.empty;
            target.dispatchEvent(new Event("change", {bubbles: true}));
        },
    });
};

export const openFieldSelectMenu = (target: HTMLElement, column: IAVColumn) => {
    const menu = new Menu("av-new-item-template-field-value");
    if (menu.isOpen) {
        return;
    }
    menu.addItem({
        type: "empty",
        label: `<div class="fn__flex fn__flex-column" style="max-height:calc(100vh - 60px)">${getFieldSelectMenuHTML(column, getSelectedOptionNames(target))}</div>`,
        bind: element => {
            element.classList.add("b3-menu__custom");
            const panelElement = element.firstElementChild as HTMLElement;
            const render = (keyword = "") => {
                panelElement.innerHTML = getFieldSelectMenuHTML(column, getSelectedOptionNames(target), keyword);
                const inputElement = panelElement.querySelector("input") as HTMLInputElement;
                inputElement.focus();
                inputElement.setSelectionRange(keyword.length, keyword.length);
                window.siyuan.menus.menu.resetPosition();
            };
            const updateSelected = (selected: string[]) => {
                target.dataset.selected = JSON.stringify(selected);
                target.innerHTML = getSelectedOptionsHTML(column, selected);
                target.dispatchEvent(new Event("change", {bubbles: true}));
            };
            element.addEventListener("click", event => {
                const removeElement = (event.target as HTMLElement).closest<HTMLElement>('[data-role="remove-field-option"]');
                const optionElement = (event.target as HTMLElement).closest<HTMLElement>('[data-role="field-option"]');
                if (!removeElement && !optionElement) {
                    return;
                }
                const selected = getSelectedOptionNames(target);
                const name = removeElement?.closest<HTMLElement>("[data-name]")?.dataset.name || optionElement?.dataset.name;
                const selectedIndex = selected.indexOf(name);
                if (selectedIndex > -1) {
                    selected.splice(selectedIndex, 1);
                    updateSelected(selected);
                    render((panelElement.querySelector("input") as HTMLInputElement)?.value || "");
                } else if (optionElement) {
                    if (column.type === "select") {
                        selected.splice(0, selected.length, name);
                    } else {
                        selected.push(name);
                    }
                    updateSelected(selected);
                    if (column.type === "select") {
                        menu.close();
                    } else {
                        render((panelElement.querySelector("input") as HTMLInputElement)?.value || "");
                    }
                }
                event.preventDefault();
                event.stopPropagation();
            });
            element.addEventListener("input", (event: InputEvent) => {
                if (!event.isComposing && (event.target as HTMLElement).matches("input")) {
                    render((event.target as HTMLInputElement).value);
                }
            });
            element.addEventListener("compositionend", event => {
                if ((event.target as HTMLElement).matches("input")) {
                    render((event.target as HTMLInputElement).value);
                }
            });
            element.addEventListener("keydown", event => {
                const inputElement = event.target as HTMLInputElement;
                if (event.isComposing || !inputElement.matches("input")) {
                    return;
                }
                const optionsElement = panelElement.querySelector('[data-role="field-options"]') as HTMLElement;
                const currentElement = upDownHint(optionsElement, event, "b3-menu__item--current", optionsElement.firstElementChild);
                if (event.key === "Enter") {
                    currentElement?.click();
                } else if (event.key === "Backspace" && !inputElement.value) {
                    (inputElement.previousElementSibling?.querySelector('[data-role="remove-field-option"]') as HTMLElement)?.click();
                }
            });
            setTimeout(() => (panelElement.querySelector("input") as HTMLInputElement)?.focus());
        },
    });
    const rect = target.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width});
};

interface IRelationOption {
    id: string;
    blockID: string;
    content: string;
    icon: string;
    isDetached: boolean;
    refSubtype: "s" | "d";
}

export const getRelationOptions = (column: IAVColumn, callback: (options: IRelationOption[]) => void) => {
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
            refSubtype: getAVBlockRefSubtype(value),
        })).filter(option => option.id));
    });
};

export const renderRelationFieldValue = (target: HTMLElement, options: IRelationOption[]) => {
    const selected = new Set(getSelectedOptionNames(target));
    const html = options.filter(option => selected.has(option.id)).map(option => {
        if (option.isDetached) {
            return `<span class="av__cell--relation" data-row-id="${escapeAttr(option.id)}">${renderAVBlockIcon({isDetached: true, block: {content: option.content, icon: option.icon}})}<span class="av__celltext">${escapeHtml(option.content)}</span></span>`;
        }
        const icon = getFileTreeIconHTML(option.icon, "file");
        return `<span class="av__cell--relation" data-row-id="${escapeAttr(option.id)}" data-block-id="${escapeAttr(option.blockID)}"><span class="b3-menu__avemoji" data-unicode="${escapeAttr(option.icon)}">${icon}</span><span data-type="block-ref" data-id="${escapeAttr(option.blockID)}" data-subtype="${option.refSubtype}" class="av__celltext av__celltext--ref">${escapeHtml(option.content)}</span></span>`;
    }).join("");
    target.innerHTML = html;
};

export const openFieldRelationMenu = (target: HTMLElement, column: IAVColumn) => {
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
                target.dispatchEvent(new Event("change", {bubbles: true}));
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
