import {transaction} from "../../../wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {Menu} from "../../../../plugin/Menu";
import {MenuItem} from "../../../../menus/Menu";
import {isMobile} from "../../../../util/functions";
import {getMapSettings} from "./state";

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
        const previous = {locationKeyID: view.map?.locationKeyID || ""};
        if (previous.locationKeyID === locationKeyID) return;
        const next = {locationKeyID};
        const operation = {action: "setAttrViewMap" as const, avID: options.data.id,
            blockID: options.blockElement.getAttribute("data-node-id"), viewID: options.data.viewID};
        transaction(options.protyle, [{...operation, data: next}], [{...operation, data: previous}]);
        view.map = next;
        options.onChange?.();
    };
    controls.forEach(control => {
        const choices = getChoices(view);
        const items: IMenu[] = choices.map(choice => ({iconHTML: "", label: escapeHtml(choice.label),
            checked: getMapSettings(view).locationKeyID === choice.value, click: () => {
                if (item.element.isConnected) update(choice.value);
            }}));
        const label = choices.find(choice => choice.value === getMapSettings(view).locationKeyID).label;
        const item = new MenuItem({iconHTML: "", label: window.siyuan.languages.mapLocationField,
            accelerator: " ", submenu: items});
        item.element.dataset.mapSetting = "locationKeyID";
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
