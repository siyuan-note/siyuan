import type {MountableSettingItem} from "../setting/item";
import {getTabGroupEntries} from "../setting/item";
import type {StringControl} from "../setting/control";
import {
    isSettingControl,
    type RowPart,
    type StackLeft,
    type StackLine,
    type StackRight,
    type SwitchQueryItem
} from "./parts";
import {escapeAttr} from "../../util/escape";
import {buildRangeValues} from "../setting/domIO";
import {genConfigItemMainHtml, genConfigItemName, genSwitchRow} from "./fragments";

export const genNumberInputHtml = (
    id: string,
    value: number,
    min?: number,
    max?: number,
    step?: string,
    unit?: string,
): string => {
    const fieldClass = unit ? "fn__flex-1" : "fn__flex-center fn__size200";
    const input = `<input class="b3-text-field ${fieldClass}" id="${id}" type="number" min="${min ?? ""}" max="${max ?? ""}" step="${step ?? ""}" value="${value}"/>`;
    if (unit) {
        return `<div class="fn__size200 fn__flex-center fn__flex">${input}<span class="fn__space"></span><span class="ft__on-surface fn__flex-center">${unit}</span></div>`;
    }
    return input;
};

const genSelectOptionsHtml = <T extends number | string>(
    id: string,
    options: {value: T; label?: string}[],
    current: T,
): string =>
    `<select class="b3-select fn__flex-center fn__size200" id="${id}">
    ${options
        .map((o) => `<option value="${o.value}" ${current === o.value ? "selected" : ""}>${o.label ?? String(o.value)}</option>`)
        .join("")}
</select>`;

const genRangeRow = (
    id: string,
    title: string,
    desc: string,
    min: number,
    max: number,
    step: number,
    value: number,
): string =>
    `<div class="fn__flex b3-label config-item config-wrap config-wrap--range">
    ${genConfigItemMainHtml(title, desc)}
    <span class="fn__space"></span>
    <div class="config-range__desktop b3-tooltips b3-tooltips__n fn__flex-center" aria-label="${value}">
        <input class="b3-slider fn__size200" id="${id}" max="${max}" min="${min}" step="${step}" type="range" value="${value}">
    </div>
    <select class="config-range__mobile b3-select fn__flex-center fn__size200" data-control-id="${id}">
    ${buildRangeValues(min, max, step)
        .map((v) => `<option value="${v}" ${value === v ? "selected" : ""}>${v}</option>`)
        .join("")}
    </select>
</div>`;

const genTextBlockFieldHtml = (
    id: string,
    mode: "input-text" | "input-password" | "textarea",
    value: string,
): string => {
    const spellcheck = window.siyuan.config.editor.spellcheck ? "true" : "false";
    if (mode === "textarea") {
        return `<textarea class="b3-text-field fn__block" id="${id}" spellcheck="${spellcheck}">${value}</textarea>`;
    }
    if (mode === "input-password") {
        return `<div class="b3-form__icona fn__block">
    <input id="${id}" type="password" class="b3-text-field b3-form__icona-input" value="${Lute.EscapeHTMLStr(value)}">
    <svg class="b3-form__icona-icon" data-action="togglePassword" style="user-select: none;"><use xlink:href="#iconEye"></use></svg>
</div>`;
    }
    return `<input class="b3-text-field fn__block" id="${id}" type="text" spellcheck="${spellcheck}" value="${Lute.EscapeHTMLStr(value)}"/>`;
};

const genSwitchQueryItemHtml = (item: SwitchQueryItem): string => {
    switch (item.kind) {
        case "switch": {
            const checked = item.readConfig() as boolean;
            return `<label class="fn__flex">
    <input class="b3-switch" id="${item.id}" type="checkbox"${checked ? " checked" : ""}/>
    <span class="fn__space"></span>
    ${item.icon ? `<svg class="svg"><use xlink:href="#${item.icon}"></use></svg><span class="fn__space"></span>` : ""}
    <div class="fn__flex-1">${item.label}</div>
</label>`;
        }
        case "number":
            return `<div class="fn__flex label fn__flex-1" style="overflow: visible;">
    <input class="b3-text-field" id="${item.id}" type="number" min="${item.min ?? ""}" max="${item.max ?? ""}" value="${item.readConfig()}"/>
    <span class="fn__space"></span>
    <div>${item.label}</div>
</div>`;
    }
};

export const genButtonHtml = (id: string, label: string, icon: string): string =>
    `<button class="b3-button b3-button--outline fn__flex-center fn__size200" id="${id}">
        <svg><use xlink:href="#${icon}"></use></svg>
        ${label}
    </button>`;

const genSwitchInputHtml = (id: string, checked: boolean): string =>
    `<input class="b3-switch" id="${id}" type="checkbox"${checked ? " checked" : ""}/>`;

/** 按钮行 */
export const genButtonRowHtml = (
    id: string,
    title: string,
    desc: string | undefined,
    label: string,
    icon: string,
): string =>
    `<div class="fn__flex b3-label config-item config-wrap">
    ${genConfigItemMainHtml(title, desc)}
    <span class="fn__space"></span>
    ${genButtonHtml(id, label, icon)}
</div>`;

/** 双文本框行 */
export const genTextPairHtml = (
    title: string,
    desc: string,
    left: StringControl,
    right: StringControl,
): string =>
    `<div class="fn__flex b3-label config-item config-wrap">
    ${genConfigItemMainHtml(title, desc)}
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size96" id="${left.id}" value="${Lute.EscapeHTMLStr(left.readConfig() as string)}">
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size96" id="${right.id}" value="${Lute.EscapeHTMLStr(right.readConfig() as string)}">
</div>`;

const genStackRight = (r: StackRight): string => {
    switch (r.kind) {
        case "button":
            return genButtonHtml(r.id, r.label, r.icon);
        case "select":
            return genSelectOptionsHtml(r.id, r.options, r.readConfig() as number | string);
        case "number":
            return genNumberInputHtml(r.id, r.readConfig() as number, r.min, r.max, undefined, undefined);
        case "switch":
            return genSwitchInputHtml(r.id, r.readConfig() as boolean);
    }
};

const genStackLeft = (left: StackLeft, hasRight: boolean): string => {
    if (left.kind === "textBlock") {
        return `<div class="${hasRight ? "fn__flex-1 " : ""}fn__block">${genTextBlockFieldHtml(left.id, left.mode, left.readConfig() as string)}</div>`;
    }
    if (!hasRight) {
        return left.kind === "title" ? genConfigItemName(left.text) : `<div class="b3-label__text">${left.text}</div>`;
    }
    return `<div class="fn__flex-center fn__flex-1${left.kind === "desc" ? " ft__on-surface" : " config-name"}">${left.text}</div>`;
};

/** 纵向堆叠行 */
export const genStackHtml = (lines: StackLine[]): string => {
    const parts: string[] = [];
    lines.forEach((line, index) => {
        const {left, right} = line;
        if (index > 0 && (right || left.kind !== "desc")) {
            parts.push('<div class="fn__hr--small"></div>');
        }
        if (!right) {
            parts.push(genStackLeft(left, false));
        } else {
            const tag = right.kind === "switch" ? "label" : "div";
            parts.push(`<${tag} class="fn__flex${right.kind === "switch" ? "" : " config-wrap"}">
    ${genStackLeft(left, true)}
    <span class="fn__space"></span>
    ${genStackRight(right)}
</${tag}>`);
        }
    });
    return `<div class="b3-label config-item">${parts.join("")}</div>`;
};

/** `config-query` 成组开关 / 数字框 */
export const genSwitchQueryHtml = (title: string, items: SwitchQueryItem[], footer?: string): string =>
    `<div class="b3-label config-item">
    ${genConfigItemName(title)}
    <div class="config-query">
        ${items.map(genSwitchQueryItemHtml).join("")}
    </div>
    ${footer ? `<div class="fn__hr"></div><div class="fn__flex-1"><div class="b3-label__text">${footer}</div></div>` : ""}
</div>`;
const pickMeta = (parts: RowPart[]) => {
    const title = parts.find((p) => p.kind === "title");
    const desc = parts.find((p) => p.kind === "desc");
    return {
        title: title?.kind === "title" ? title.text : "",
        desc: desc?.kind === "desc" ? desc.text : undefined,
    };
};

const renderControlParts = (parts: RowPart[]): string => {
    const {title, desc} = pickMeta(parts);
    const control = parts.find(isSettingControl);
    if (!control) {
        return "";
    }
    switch (control.kind) {
        case "switch":
            return genSwitchRow(control.id, title, desc, control.readConfig() as boolean);
        case "number":
            return `<div class="fn__flex b3-label config-item config-wrap">
    ${genConfigItemMainHtml(title, desc)}
    <span class="fn__space"></span>
    ${genNumberInputHtml(control.id, control.readConfig() as number, control.min, control.max, control.step, control.unit)}
</div>`;
        case "range": {
            const num = control.readConfig() as number;
            return genRangeRow(control.id, title, desc ?? "", control.min, control.max, control.step, num);
        }
        case "select":
            return `<div class="fn__flex b3-label config-item config-wrap">
    ${genConfigItemMainHtml(title, desc)}
    <span class="fn__space"></span>
    ${genSelectOptionsHtml(control.id, control.options, control.readConfig() as number | string)}
</div>`;
        case "text":
            return `<div class="fn__flex b3-label config-item config-wrap">
    ${genConfigItemMainHtml(title, desc ?? "")}
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="${control.id}" value="${Lute.EscapeHTMLStr(control.readConfig() as string)}"/>
</div>`;
        case "textBlock": {
            return `<div class="b3-label config-item">
    <div class="fn__block">
        ${genConfigItemName(title)}
        <div class="b3-label__text">${desc ?? ""}</div>
        <div class="fn__hr--small"></div>
        ${genTextBlockFieldHtml(control.id, control.mode, control.readConfig() as string)}
    </div>
</div>`;
        }
    }
};
const tagConfigItemRoot = (html: string, itemId: string): string => {
    if (!html.trim()) {
        return html;
    }
    if (html.includes("data-config-item-id")) {
        return html;
    }
    const tagStart = html.indexOf("<");
    if (tagStart === -1) {
        return html;
    }
    const tagEnd = html.indexOf(">", tagStart);
    if (tagEnd === -1) {
        return html;
    }
    return html.slice(0, tagEnd) + ` data-config-item-id="${escapeAttr(itemId)}"` + html.slice(tagEnd);
};

const renderItemHtml = (item: MountableSettingItem): string => {
    const html = item.kind === "render" ? item.html() : renderControlParts(item.rowParts);
    return tagConfigItemRoot(html, item.id);
};

export const genConfigGroup = (itemsHtml: string, title?: string, attrs?: Record<string, string>): string => {
    const attrsHtml = attrs
        ? Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join("")
        : "";
    return `<div class="config-group"${attrsHtml}>${title ? `<div class="config-title">${title}</div>` : ""}<div class="config-items">${itemsHtml}</div></div>`;
};

type GroupedItemsView = {
    html: string;
    /** 与 html 中 DOM 顺序一致 */
    items: MountableSettingItem[];
};

/** 按分组构建 HTML 与条目列表（mount 单次遍历共用） */
export const buildGroupedItemsView = (tabId: string): GroupedItemsView => {
    const parts: string[] = [];
    const items: MountableSettingItem[] = [];
    for (const {group, items: groupItems} of getTabGroupEntries(tabId)) {
        items.push(...groupItems);
        const itemsHtml = groupItems.map((item) => renderItemHtml(item)).join("");
        const title = group.title || undefined;
        parts.push(genConfigGroup(itemsHtml, title, {"data-config-group-id": group.id}));
    }
    return {html: parts.join(""), items};
};
