import {transaction} from "../../../wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {Menu} from "../../../../plugin/Menu";
import {openViewSettingMenu} from "../viewSettingMenu";
import {getMapSettings} from "./state";
import type {AVMapProvider} from "./protocol";

export interface IMapServiceChoice {
    id: string;
    name: string;
    provider: AVMapProvider;
    configured: boolean;
}

export const canEditMapSettings = (protyle: IProtyle) => !protyle.disabled && !window.siyuan.isPublish &&
    !protyle.options.history?.created && !protyle.options.history?.snapshot;

export const loadMapServices = async (): Promise<IMapServiceChoice[]> => {
    const response = await fetchSyncPost("/api/map/getConf", {});
    if (response.code !== 0) {
        throw new Error("Map configuration is unavailable");
    }
    return response.data.services;
};

const getItems = (view: IAVTable, services?: IMapServiceChoice[]) => {
    const settings = getMapSettings(view);
    const fields = view.columns.filter(column => column.type === "location");
    const items: Array<{key: "serviceID" | "locationKeyID"; label: string;
        choices: Array<{value: string; label: string}>}> = [{
        key: "serviceID", label: window.siyuan.languages.mapService,
        choices: [{value: "", label: window.siyuan.languages.mapSelectService},
            ...(services || []).map(service => ({value: service.id, label: service.name}))],
    }, {
        key: "locationKeyID", label: window.siyuan.languages.mapLocationField,
        choices: [{value: "", label: window.siyuan.languages.mapSelectLocationField},
            ...fields.map(column => ({value: column.id, label: column.name}))],
    }];
    items.forEach(item => {
        const saved = settings[item.key];
        if (saved && !item.choices.some(choice => choice.value === saved)) {
            item.choices.push({value: saved, label: item.key === "serviceID" ?
                services ? window.siyuan.languages.mapMissingService : window.siyuan.languages.loading :
                window.siyuan.languages.mapMissingLocationField});
        }
    });
    return items;
};

export const getMapSettingsHTML = (view: IAVTable, services?: IMapServiceChoice[]) => {
    const settings = getMapSettings(view);
    return getItems(view, services).map(item => {
        const value = settings[item.key];
        const label = item.choices.find(choice => choice.value === value).label;
        return `<button class="b3-menu__item" data-map-setting="${item.key}">
    <span class="fn__flex-center">${item.label}</span><span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator fn__ellipsis av__map-setting-value" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
    }).join("");
};

export const bindMapSettings = (options: {
    protyle: IProtyle;
    blockElement: Element;
    data: IAV;
    menuElement: Element;
    services?: IMapServiceChoice[];
    onChange?: () => void;
}) => {
    const controls = options.menuElement.querySelectorAll<HTMLButtonElement>("[data-map-setting]");
    const view = options.data.view as IAVTable;
    const services = options.services ? Promise.resolve(options.services) : window.siyuan.isPublish ||
        options.protyle.options.history?.created || options.protyle.options.history?.snapshot ?
        Promise.resolve([] as IMapServiceChoice[]) : loadMapServices();
    const updateLabels = (choices: IMapServiceChoice[]) => {
        const items = getItems(view, choices);
        controls.forEach(control => {
            if (!control.isConnected) {
                return;
            }
            const item = items.find(item => item.key === control.dataset.mapSetting);
            const label = item.choices.find(choice => choice.value === getMapSettings(view)[item.key]).label;
            const valueElement = control.querySelector<HTMLElement>(".av__map-setting-value");
            valueElement.textContent = label;
            valueElement.title = label;
        });
    };
    void services.then(updateLabels).catch(() => {
        controls.forEach(control => {
            if (control.isConnected && control.dataset.mapSetting === "serviceID") {
                const valueElement = control.querySelector<HTMLElement>(".av__map-setting-value");
                valueElement.textContent = window.siyuan.languages.mapSelectService;
                valueElement.title = window.siyuan.languages.mapSelectService;
            }
        });
    });
    if (!canEditMapSettings(options.protyle)) {
        controls.forEach(control => { control.disabled = true; });
        return;
    }
    const update = (key: "serviceID" | "locationKeyID", value: string) => {
        if (!canEditMapSettings(options.protyle)) {
            return;
        }
        const previous = getMapSettings(view);
        if (previous[key] === value) {
            return;
        }
        const next = {...previous, [key]: value};
        const operation = {action: "setAttrViewMap" as const, avID: options.data.id,
            blockID: options.blockElement.getAttribute("data-node-id"), viewID: options.data.viewID};
        transaction(options.protyle, [{...operation, data: next}], [{...operation, data: previous}]);
        view.map = next;
        options.onChange?.();
    };
    controls.forEach(control => {
        const key = control.dataset.mapSetting as "serviceID" | "locationKeyID";
        control.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            const choices = await services.catch(() => [] as IMapServiceChoice[]);
            if (!control.isConnected) {
                return;
            }
            const item = getItems(view, choices).find(item => item.key === key);
            const menu = new Menu();
            item.choices.forEach(choice => menu.addItem({iconHTML: "", label: escapeHtml(choice.label),
                checked: getMapSettings(view)[key] === choice.value, click: () => update(key, choice.value)}));
            openViewSettingMenu(menu, control);
        });
    });
};
