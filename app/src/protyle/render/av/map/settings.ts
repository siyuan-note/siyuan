import {transaction} from "../../../wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {Menu} from "../../../../plugin/Menu";
import {openMapSettings} from "../../../../config";
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

const getItems = (view: IAVTable, services: IMapServiceChoice[]) => {
    const settings = getMapSettings(view);
    const fields = view.columns.filter(column => column.type === "location");
    const items: Array<{key: "serviceID" | "locationKeyID"; label: string;
        choices: Array<{value: string; label: string}>}> = [{
        key: "serviceID", label: window.siyuan.languages.mapService,
        choices: [{value: "", label: window.siyuan.languages.mapSelectService},
            ...services.map(service => ({value: service.id, label: service.name}))],
    }, {
        key: "locationKeyID", label: window.siyuan.languages.mapLocationField,
        choices: [{value: "", label: window.siyuan.languages.mapSelectLocationField},
            ...fields.map(column => ({value: column.id, label: column.name}))],
    }];
    items.forEach(item => {
        const saved = settings[item.key];
        if (saved && !item.choices.some(choice => choice.value === saved)) {
            item.choices.push({value: saved, label: saved});
        }
    });
    return items;
};

export const getMapSettingsHTML = (view: IAVTable, asMenu = false, services: IMapServiceChoice[] = []) => {
    const settings = getMapSettings(view);
    return getItems(view, services).map(item => {
        const value = settings[item.key];
        const label = item.choices.find(choice => choice.value === value)?.label || value;
        if (asMenu) {
            return `<button class="b3-menu__item" data-map-setting="${item.key}">
    <span class="fn__flex-center">${item.label}</span><span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${escapeHtml(label)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
        }
        return `<label class="av__map-setting"><span>${item.label}</span>
    <select class="b3-select" data-map-setting="${item.key}" aria-label="${escapeAttr(item.label)}">
        ${item.choices.map(choice => `<option value="${escapeAttr(choice.value)}"${choice.value === value ? " selected" : ""}>${escapeHtml(choice.label)}</option>`).join("")}
    </select></label>`;
    }).join("") + `<label class="${asMenu ? "b3-menu__item" : "av__map-setting"}">
    <span class="fn__flex-center">${window.siyuan.languages.mapShowRecordList}</span>
    ${asMenu ? '<span class="fn__space fn__flex-1"></span>' : ""}
    <input data-map-setting="showRecordList" type="checkbox" class="b3-switch${asMenu ? " b3-switch--menu" : ""}"${settings.showRecordList ? " checked" : ""}>
</label>
<button type="button" class="${asMenu ? "b3-menu__item" : "b3-button b3-button--outline"}" data-map-configure>${window.siyuan.languages.mapConfigureServices}</button>`;
};

export const bindMapSettings = (options: {
    protyle: IProtyle;
    blockElement: Element;
    data: IAV;
    menuElement: Element;
    services?: IMapServiceChoice[];
    onChange?: () => void;
}) => {
    const controls = options.menuElement.querySelectorAll<HTMLSelectElement | HTMLButtonElement | HTMLInputElement>("[data-map-setting], [data-map-configure]");
    if (!canEditMapSettings(options.protyle)) {
        controls.forEach(control => { control.disabled = true; });
        return;
    }
    const view = options.data.view as IAVTable;
    const update = (key: keyof IAVMapSettings, value: string | boolean) => {
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
        if (control.hasAttribute("data-map-configure")) {
            control.addEventListener("click", async () => {
                const services = options.services || await loadMapServices().catch((): IMapServiceChoice[] => undefined);
                if (!control.isConnected) {
                    return;
                }
                const saved = getMapSettings(view).serviceID;
                const missing = saved && services && !services.some(service => service.id === saved) ? saved : undefined;
                openMapSettings(options.protyle.app, missing);
            });
            return;
        }
        const key = control.dataset.mapSetting as keyof IAVMapSettings;
        if (control.tagName === "BUTTON") {
            control.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();
                const services = options.services || await loadMapServices().catch(() => [] as IMapServiceChoice[]);
                if (!control.isConnected) {
                    return;
                }
                const item = getItems(view, services).find(item => item.key === key);
                const menu = new Menu();
                item.choices.forEach(choice => menu.addItem({iconHTML: "", label: escapeHtml(choice.label),
                    checked: getMapSettings(view)[key] === choice.value, click: () => update(key, choice.value)}));
                openViewSettingMenu(menu, control);
            });
        } else {
            control.addEventListener("change", () => update(key, key === "showRecordList" ?
                (control as HTMLInputElement).checked : control.value));
        }
    });
};
