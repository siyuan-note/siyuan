import {transaction} from "../../../wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {Menu} from "../../../../plugin/Menu";
import {openViewSettingMenu} from "../viewSettingMenu";
import {getMapSettings} from "./state";

export const canEditMapSettings = (protyle: IProtyle) => !protyle.disabled && !window.siyuan.isPublish &&
    !protyle.options.history?.created && !protyle.options.history?.snapshot;

const getChoices = (view: IAVTable) => {
    const choices = [{value: "", label: window.siyuan.languages.mapSelectLocationField},
        ...view.columns.filter(column => column.type === "location").map(column => ({value: column.id, label: column.name}))];
    const saved = getMapSettings(view).locationKeyID;
    if (saved && !choices.some(choice => choice.value === saved)) {
        choices.push({value: saved, label: window.siyuan.languages.mapMissingLocationField});
    }
    return choices;
};

export const getMapSettingsHTML = (view: IAVTable) => {
    const value = getMapSettings(view).locationKeyID;
    const label = getChoices(view).find(choice => choice.value === value).label;
    return `<button class="b3-menu__item" data-map-setting="locationKeyID">
    <span class="fn__flex-center">${window.siyuan.languages.mapLocationField}</span><span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator fn__ellipsis av__map-setting-value" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
};

export const bindMapSettings = (options: {
    protyle: IProtyle;
    blockElement: Element;
    data: IAV;
    menuElement: Element;
    onChange?: () => void;
}) => {
    const controls = options.menuElement.querySelectorAll<HTMLButtonElement>('[data-map-setting="locationKeyID"]');
    const view = options.data.view as IAVTable;
    if (!canEditMapSettings(options.protyle)) {
        controls.forEach(control => { control.disabled = true; });
        return;
    }
    const update = (locationKeyID: string) => {
        if (!canEditMapSettings(options.protyle)) return;
        const previous = getMapSettings(view);
        if (previous.locationKeyID === locationKeyID) return;
        const next = {locationKeyID};
        const operation = {action: "setAttrViewMap" as const, avID: options.data.id,
            blockID: options.blockElement.getAttribute("data-node-id"), viewID: options.data.viewID};
        transaction(options.protyle, [{...operation, data: next}], [{...operation, data: previous}]);
        view.map = next;
        options.onChange?.();
    };
    controls.forEach(control => {
        control.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            if (!control.isConnected || !canEditMapSettings(options.protyle)) return;
            const menu = new Menu();
            getChoices(view).forEach(choice => menu.addItem({iconHTML: "", label: escapeHtml(choice.label),
                checked: getMapSettings(view).locationKeyID === choice.value, click: () => update(choice.value)}));
            openViewSettingMenu(menu, control);
        });
    });
};
