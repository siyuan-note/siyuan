import {transaction} from "../../wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {
    createContextFilter,
    getContextFilterFields,
    getContextFilterKeyID,
} from "./contextFilterState";
import {unicode2Emoji} from "../../../emoji";

export const getContextFilterHTML = (data: IAV) => {
    const selectedKeyID = getContextFilterKeyID(data.contextFilter);
    const fields = getContextFilterFields(data.contextFilterFields);
    const optionsHTML = fields.map((field) => `<button class="b3-menu__item" data-type="contextFilterField" data-id="${escapeAttr(field.id)}">
    ${field.icon ? unicode2Emoji(field.icon, "b3-menu__icon", true) : "<svg class=\"b3-menu__icon\"><use xlink:href=\"#iconRef\"></use></svg>"}
    <span class="b3-menu__label"><span class="fn__block fn__ellipsis">${escapeHtml(field.name || window.siyuan.languages.untitled)}</span><span class="b3-label__text fn__block" title="${escapeAttr(window.siyuan.languages.filterCurrentDocumentTip)}">${window.siyuan.languages.filterOperatorContainsAnyItem} - ${window.siyuan.languages.filterCurrentDocument}</span></span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#${field.id === selectedKeyID ? "iconCheck" : "iconUncheck"}"></use></svg>
</button>`).join("");

    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-config">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.contextFilter}</span>
</button>
<button class="b3-menu__separator"></button>
<div class="b3-menu__item b3-menu__item--readonly">
    <span class="b3-menu__label ft__on-surface">${window.siyuan.languages.contextFilterTip}</span>
</div>
${optionsHTML || `<div class="b3-menu__item b3-menu__item--readonly"><span class="b3-menu__label ft__on-surface">${window.siyuan.languages.contextFilterNoRelation}</span></div>`}
<button class="b3-menu__separator${selectedKeyID ? "" : " fn__none"}"></button>
<button class="b3-menu__item b3-menu__item--warning${selectedKeyID ? "" : " fn__none"}" data-type="disableContextFilter">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.disable}</span>
</button>
</div>`;
};

export const bindContextFilterEvent = (options: {
    protyle: IProtyle,
    menuElement: HTMLElement,
    data: IAV,
    avID: string,
    blockID: string,
}) => {
    options.menuElement.addEventListener("click", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const fieldElement = target.closest('[data-type="contextFilterField"]') as HTMLElement;
        const disableElement = target.closest('[data-type="disableContextFilter"]') as HTMLElement;
        if (!fieldElement && !disableElement) {
            return;
        }
        const oldKeyID = getContextFilterKeyID(options.data.contextFilter);
        const keyID = disableElement ? "" : fieldElement.dataset.id || "";
        if (keyID === oldKeyID) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const operation = (operationKeyID: string): IOperation => ({
            action: "setAttrViewContextFilter",
            avID: options.avID,
            blockID: options.blockID,
            keyID: operationKeyID,
        });
        transaction(options.protyle, [operation(keyID)], [operation(oldKeyID)]);
        options.data.contextFilter = createContextFilter(keyID);
        options.menuElement.innerHTML = getContextFilterHTML(options.data);
        event.preventDefault();
        event.stopPropagation();
    });
};
