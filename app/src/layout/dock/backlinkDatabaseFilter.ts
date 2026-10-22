import {fetchSyncPost} from "../../util/fetch";
import {escapeHtml} from "../../util/escape";
import {openMenuPanel} from "../../protyle/render/av/openMenuPanel";
import type {BacklinkDatabase} from "../../types/api";
import type {IBacklinkSourceFilter} from "./backlinkSourceFilter";

export const getBacklinkDatabaseFilterData = (database: BacklinkDatabase, filters: IAVFilter[]): IAV => ({
    id: database.id,
    name: database.name,
    viewID: "",
    viewType: "table",
    views: [],
    view: {
        id: "",
        type: "table",
        filters: JSON.parse(JSON.stringify(filters.length ? filters : [{combination: "and", filters: []}])),
        sorts: [],
        columns: database.keys.map(key => ({...key, wrap: false, pin: false, width: "", hidden: false})),
        rows: [],
        rowCount: 0,
    },
});

export const loadBacklinkDatabaseFilterMenu = async (options: {
    id: string;
    notebook: string;
    keyword: string;
    filter: IBacklinkSourceFilter;
    target: HTMLElement;
    anchorRect: DOMRect;
    protyle?: IProtyle;
    isCurrent: () => boolean;
    getSelected: () => IBacklinkSourceFilter["database"];
    apply: (database?: IBacklinkSourceFilter["database"]) => void;
}): Promise<IMenu[]> => {
    const anchorRect = options.anchorRect;
    const response = await fetchSyncPost("/api/ref/getBacklinkDatabases", {
        id: options.id,
        notebook: options.notebook,
        keyword: options.keyword,
        containChildren: window.siyuan.config.editor.backlinkContainChildren,
        sourceFilter: options.filter,
    });
    if (!options.isCurrent() || response.code !== 0 || !response.data) {
        return [];
    }
    const candidates = response.data;
    const selected = options.getSelected();
    const items: IMenu[] = [{
        label: window.siyuan.languages.reset,
        icon: "iconUndo",
        checked: !selected,
        click: () => {
            if (options.isCurrent()) {
                options.apply();
            }
        },
    }, {type: "separator"}];
    candidates.forEach(database => items.push({
        label: escapeHtml(database.name),
        iconHTML: "",
        checked: selected?.avID === database.id,
        bind: element => { element.title = database.id; },
        click: () => {
            if (!options.isCurrent()) {
                return;
            }
            const current = options.getSelected();
            const filters = current?.avID === database.id ? current.filters : [];
            options.apply({avID: database.id, filters});
            openMenuPanel({
                protyle: options.protyle,
                blockElement: options.target,
                anchorElement: options.target,
                anchorRect,
                type: "filters",
                data: getBacklinkDatabaseFilterData(database, filters),
                filterOperation: {
                    save: filters => {
                        if (options.isCurrent() && options.getSelected()?.avID === database.id) {
                            options.apply({avID: database.id, filters});
                        }
                    },
                },
            });
        },
    }));
    if (selected && !candidates.some(item => item.id === selected.avID)) {
        items.push({type: "readonly", label: `${escapeHtml(selected.avID)} (${window.siyuan.languages.invalid})`});
    }
    if (candidates.length === 0) {
        items.push({type: "readonly", label: window.siyuan.languages.emptyContent});
    }
    return items;
};
