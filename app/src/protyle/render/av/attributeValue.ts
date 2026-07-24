import {escapeAriaLabel, escapeAttr, escapeHtml} from "../../../util/escape";
import * as dayjs from "dayjs";
import {unicode2Emoji} from "../../../emoji";
import {Constants} from "../../../constants";
import {getCompressURL} from "../../../util/image";

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

export const getAVTemplateHTML = (content: string) => {
    if (window.siyuan.config.editor.allowHTMLBLockScript) {
        return content;
    }
    // 默认过滤危险标签和事件属性，避免数据库模板字段中的代码直接执行
    return window.DOMPurify.sanitize(content);
};

const genAVRollupHTML = (value: IAVCellValue) => {
    let html = "";
    const dataValue: IAVCellDateValue = value[value.type as "date"];
    switch (value.type) {
        case "block":
            if (value?.isDetached) {
                html = `<span>${escapeHtml(value.block?.content || window.siyuan.languages.untitled)}</span>`;
            } else {
                html = `<span data-type="block-ref" data-id="${value.block.id}" data-subtype="s" class="av__celltext--ref">${escapeHtml(value.block?.content || window.siyuan.languages.untitled)}</span>`;
            }
            break;
        case "text":
            html = escapeHtml(value.text.content);
            break;
        case "number":
            html = value.number.formattedContent || value.number.content.toString();
            break;
        case "date":
        case "updated":
        case "created":
            if (dataValue.formattedContent) {
                html = dataValue.formattedContent;
            } else {
                if (dataValue && dataValue.isNotEmpty) {
                    html = dayjs(dataValue.content).format(dataValue.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
                }
                if (dataValue && dataValue.hasEndDate && dataValue.isNotEmpty && dataValue.isNotEmpty2) {
                    html = `<svg class="av__cellicon"><use xlink:href="#iconForward"></use></svg>${dayjs(dataValue.content2).format(dataValue.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm")}`;
                }
            }
            if (html) {
                html = `<span class="av__celltext">${html}</span>`;
            }
            break;
        case "url":
            html = value.url.content ? `<a class="fn__a" href="${escapeAttr(value.url.content)}" target="_blank">${escapeHtml(value.url.content)}</a>` : "";
            break;
        case "phone":
            html = value.phone.content ? `<a class="fn__a" href="tel:${escapeAttr(value.phone.content)}" target="_blank">${escapeHtml(value.phone.content)}</a>` : "";
            break;
        case "email":
            html = value.email.content ? `<a class="fn__a" href="mailto:${escapeAttr(value.email.content)}" target="_blank">${escapeHtml(value.email.content)}</a>` : "";
            break;
    }
    return html;
};

export const genAVValueHTML = (value: IAVCellValue) => {
    let html = "";
    switch (value.type) {
        case "block":
            html = `<input data-id="${value.block.id}" value="${escapeAttr(value.block.content)}" type="text" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">`;
            break;
        case "text":
            html = `<textarea style="resize: vertical" rows="${(value.text?.content || "").split("\n").length}" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">${escapeHtml(value.text?.content || "")}</textarea>`;
            break;
        case "number":
            html = `<input value="${value.number.isNotEmpty ? value.number.content : ""}" type="number" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">
<span class="fn__space"></span><span class="fn__flex-center ft__on-surface b3-tooltips__w b3-tooltips" aria-label="${window.siyuan.languages.format}">${value.number.formattedContent || ""}</span><span class="fn__space"></span>`;
            break;
        case "mSelect":
        case "select":
            value.mSelect?.forEach((item, index) => {
                if (value.type === "select" && index > 0) {
                    return;
                }
                html += `<span class="b3-chip b3-chip--middle" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${escapeHtml(item.content)}</span>`;
            });
            break;
        case "mAsset":
            value.mAsset?.forEach(item => {
                if (item.type === "image") {
                    html += `<img loading="lazy" class="av__cellassetimg ariaLabel" aria-label="${escapeAriaLabel(item.content)}" src="${getCompressURL(item.content)}">`;
                } else {
                    html += `<span class="b3-chip b3-chip--middle av__celltext--url ariaLabel" aria-label="${escapeAriaLabel(item.content)}" data-name="${escapeAttr(item.name)}" data-url="${escapeAttr(item.content)}">${escapeHtml(item.name || item.content)}</span>`;
                }
            });
            break;
        case "date":
            html = `<span class="av__celltext" data-value='${JSON.stringify(value[value.type])}' placeholder="${window.siyuan.languages.empty}">`;
            if (value[value.type] && value[value.type].isNotEmpty) {
                html += dayjs(value[value.type].content).format(value[value.type].isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
            }
            if (value[value.type] && value[value.type].hasEndDate && value[value.type].isNotEmpty && value[value.type].isNotEmpty2) {
                html += `<svg class="av__cellicon"><use xlink:href="#iconForward"></use></svg>${dayjs(value[value.type].content2).format(value[value.type].isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm")}`;
            }
            html += "</span>";
            break;
        case "created":
        case "updated":
            if (value[value.type].isNotEmpty) {
                html = `<span data-content="${value[value.type].content}">${dayjs(value[value.type].content).format("YYYY-MM-DD HH:mm")}</span>`;
            }
            break;
        case "url":
            html = `<input value="${escapeAttr(value.url.content)}" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">
<span class="fn__space"></span>
<a ${value.url.content ? `href="${escapeAttr(value.url.content)}"` : ""} target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconLink"></use></svg></a>`;
            break;
        case "phone":
            html = `<input value="${escapeAttr(value.phone.content)}" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">
<span class="fn__space"></span>
<a ${value.phone.content ? `href="tel:${escapeAttr(value.phone.content)}"` : ""} target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconPhone"></use></svg></a>`;
            break;
        case "checkbox":
            html = `<svg class="av__checkbox"><use xlink:href="#icon${value.checkbox.checked ? "Check" : "Uncheck"}"></use></svg>`;
            break;
        case "template":
            html = `<div class="fn__flex-1" placeholder="${window.siyuan.languages.empty}">${getAVTemplateHTML(value.template.content)}</div>`;
            break;
        case "email":
            html = `<input value="${escapeAttr(value.email.content)}" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">
<span class="fn__space"></span>
<a ${value.email.content ? `href="mailto:${escapeAttr(value.email.content)}"` : ""} target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconEmail"></use></svg></a>`;
            break;
        case "relation":
            value?.relation?.contents?.forEach((item, index) => {
                if (item && item.block) {
                    const rowID = value.relation.blockIDs[index];
                    if (item?.isDetached) {
                        html += `<span data-row-id="${rowID}" class="av__cell--relation"><span><svg style="height: 26px"><use xlink:href="#iconLine"></use></svg><span class="fn__space--5"></span></span><span class="av__celltext">${Lute.EscapeHTMLStr(item.block.content || window.siyuan.languages.untitled)}</span></span>`;
                    } else {
                        html += `<span data-row-id="${rowID}" class="av__cell--relation" data-block-id="${item.block.id}"><span class="b3-menu__avemoji" data-unicode="${item.block.icon || ""}">${unicode2Emoji(item.block.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file)}</span><span data-type="block-ref" data-id="${item.block.id}" data-subtype="s" class="av__celltext av__celltext--ref">${Lute.EscapeHTMLStr(item.block.content || window.siyuan.languages.untitled)}</span></span>`;
                    }
                }
            });
            if (html && html.endsWith(", ")) {
                html = html.substring(0, html.length - 2);
            }
            break;
        case "rollup":
            value?.rollup?.contents?.forEach((item) => {
                const rollupText = ["template", "select", "mSelect", "mAsset", "checkbox", "relation"].includes(item.type) ?
                    genAVValueHTML(item) : genAVRollupHTML(item);
                if (rollupText) {
                    html += rollupText.replace("fn__flex-1", "") + ",&nbsp;";
                }
            });
            if (html && html.endsWith(",&nbsp;")) {
                html = html.substring(0, html.length - 7);
            }
            break;
    }
    return html;
};

export const genAVAttributeRowHTML = (options: {
    nodeID: string,
    avID: string,
    keyID: string,
    type: TAVCol,
    name: string,
    desc?: string,
    icon?: string,
    typeIcon: string,
    selectOptions?: {
        name: string,
        color: string
    }[],
    value: IAVCellValue,
    empty: boolean,
}) => {
    const value = options.value;
    const textInputType = ["url", "text", "number", "email", "phone", "block"].includes(value.type);
    const hasOwnPlaceholder = ["text", "number", "date", "url", "phone", "template", "email"].includes(value.type);
    return `<div class="block__icons av__row" data-id="${options.nodeID}" data-col-id="${options.keyID}" data-empty="${options.empty}"${options.type === "block" ? ' data-primary="true"' : ""}>
    <div class="block__icon" draggable="true"><svg><use xlink:href="#iconDrag"></use></svg></div>
    <div class="block__logo block__logo--icon ariaLabel fn__pointer" data-type="editCol" data-position="parentW" aria-label="${escapeAriaLabel(options.name)}<div class='ft__on-surface'>${escapeAriaLabel(options.desc || "")}</div>">
        ${options.icon ? unicode2Emoji(options.icon, "block__logoicon", true) : `<svg class="block__logoicon"><use xlink:href="#${options.typeIcon}"></use></svg>`}
        <span>${escapeHtml(options.name)}</span>
    </div>
    <div data-av-id="${options.avID}" data-col-id="${value.keyID}" data-row-id="${value.blockID}"${value.id ? ` data-id="${value.id}"` : ""} data-cell-value="${encodeURIComponent(JSON.stringify(value))}" data-type="${value.type}"${value.isDetached ? ' data-detached="true"' : ""}
data-options="${options.selectOptions ? escapeAttr(JSON.stringify(options.selectOptions)) : "[]"}"
${hasOwnPlaceholder ? "" : `placeholder="${window.siyuan.languages.empty}"`}
class="fn__flex-1 fn__flex${textInputType ? "" : " custom-attr__avvalue"}${["created", "updated"].includes(value.type) ? " custom-attr__avvalue--readonly" : ""}">${genAVValueHTML(value)}</div>
</div>`;
};
