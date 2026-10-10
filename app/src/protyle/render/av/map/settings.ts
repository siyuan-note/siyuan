import {transaction} from "../../../wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {Menu} from "../../../../plugin/Menu";
import {MenuItem} from "../../../../menus/Menu";
import {isMobile} from "../../../../util/functions";
import {AV_MAP_HEIGHTS, getMapSettings} from "./state";

export const canEditMapSettings = (protyle: IProtyle) => !protyle.disabled && !window.siyuan.isPublish &&
    !protyle.options.history?.created && !protyle.options.history?.snapshot;

const getChoices = (view: IAVTable) => {
    const choices = view.columns.filter(column => column.type === "location").map(column => ({value: column.id, label: column.name}));
    if (choices.length === 0) {
        choices.push({value: "", label: window.siyuan.languages.mapSelectLocationField});
    }
    const saved = getMapSettings(view).locationKeyID;
    if (saved && !choices.some(choice => choice.value === saved)) {
        choices.push({value: saved, label: window.siyuan.languages.mapMissingLocationField});
    }
    return choices;
};

type MapSetting = "locationKeyID" | "height";

const getSettingChoices = (view: IAVTable, key: MapSetting): Array<{value: string | IAVMapSettings["height"]; label: string}> =>
    key === "locationKeyID" ? getChoices(view) : AV_MAP_HEIGHTS.map((value, index) => ({value,
        label: window.siyuan.languages[(["small", "medium", "large", "extraLarge"] as const)[index]]}));

const getSettingLabel = (key: MapSetting) => key === "height" ? window.siyuan.languages.height : window.siyuan.languages.mapLocationField;

export const getMapSettingsHTML = (view: IAVTable) => (["locationKeyID", "height"] as const).map(key => {
    const value = getMapSettings(view)[key];
    const label = getSettingChoices(view, key).find(choice => choice.value === value).label;
    return `<button class="b3-menu__item" data-map-setting="${key}">
    <span class="fn__flex-center">${getSettingLabel(key)}</span><span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator fn__ellipsis av__map-setting-value" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
}).join("");

export const bindMapSettings = (options: {
    protyle: IProtyle;
    blockElement: Element;
    data: IAV;
    menuElement: Element;
    onChange?: () => void;
}) => {
    const controls = options.menuElement.querySelectorAll<HTMLButtonElement>("[data-map-setting]");
    const view = options.data.view as IAVTable;
    if (!canEditMapSettings(options.protyle)) {
        controls.forEach(control => { control.disabled = true; });
        return;
    }
    const update = (key: MapSetting, value: string | IAVMapSettings["height"]) => {
        if (!canEditMapSettings(options.protyle)) return;
        const previous: IAVMapSettings = {locationKeyID: "", ...view.map};
        if (previous[key] === value) return;
        const next: IAVMapSettings = {...previous, [key]: value};
        const operation = {action: "setAttrViewMap" as const, avID: options.data.id,
            blockID: options.blockElement.getAttribute("data-node-id"), viewID: options.data.viewID};
        transaction(options.protyle, [{...operation, data: next}], [{...operation, data: previous}]);
        view.map = next;
        options.onChange?.();
    };
    controls.forEach(control => {
        const key = control.dataset.mapSetting as MapSetting;
        const choices = getSettingChoices(view, key);
        const items: IMenu[] = choices.map(choice => ({iconHTML: "", label: escapeHtml(choice.label),
            checked: getMapSettings(view)[key] === choice.value, click: () => {
                if (item.element.isConnected) update(key, choice.value);
            }}));
        const label = choices.find(choice => choice.value === getMapSettings(view)[key]).label;
        const item = new MenuItem({iconHTML: "", label: getSettingLabel(key),
            accelerator: " ", submenu: items});
        item.element.dataset.mapSetting = key;
        const valueElement = item.element.querySelector(".b3-menu__accelerator");
        valueElement.textContent = label;
        valueElement.classList.add("fn__ellipsis", "av__map-setting-value");
        valueElement.setAttribute("title", label);
        control.replaceWith(item.element);
        const submenu = item.element.querySelector<HTMLElement>(".b3-menu__submenu");
        const show = () => {
            if (!item.element.isConnected || !canEditMapSettings(options.protyle)) return;
            item.element.classList.add("b3-menu__item--show");
            window.siyuan.menus.menu.showSubMenu(submenu);
        };
        if (!isMobile()) {
            item.element.addEventListener("mouseenter", show);
            options.menuElement.addEventListener("mouseover", event => {
                const hovered = (event.target as Element).closest(".b3-menu__item");
                if (hovered && !item.element.contains(hovered)) item.element.classList.remove("b3-menu__item--show");
            });
            item.element.addEventListener("keydown", event => {
                if (!item.element.isConnected || !canEditMapSettings(options.protyle)) return;
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    event.stopPropagation();
                    show();
                    submenu.querySelector<HTMLButtonElement>(".b3-menu__item").focus();
                } else if (event.key === "ArrowLeft" || event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    item.element.classList.remove("b3-menu__item--show");
                    item.element.focus();
                }
            });
        }
        item.element.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            if (!item.element.isConnected || !canEditMapSettings(options.protyle)) return;
            if (isMobile()) {
                const menu = new Menu(undefined, undefined, true);
                items.forEach(choice => menu.addItem(choice));
                const rect = item.element.getBoundingClientRect();
                menu.open({x: rect.left, y: rect.bottom, h: rect.height, target: item.element});
            } else {
                show();
            }
        });
    });
};
