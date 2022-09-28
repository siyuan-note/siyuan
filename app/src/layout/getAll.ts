import {Layout} from "./index";
import {Tab} from "./Tab";
import {Editor} from "../editor";
import {Graph} from "./dock/Graph";
import {Outline} from "./dock/Outline";
import {Backlink} from "./dock/Backlink";
import {Asset} from "../asset";
import {Search} from "../search";

export const getAllModels = () => {
    const models: IModels = {
        editor: [],
        graph: [],
        asset: [],
        outline: [],
        backlink: [],
        search: []
    };
    const getTabs = (layout: Layout) => {
        for (let i = 0; i < layout.children.length; i++) {
            const item = layout.children[i];
            if (item instanceof Tab) {
                const model = item.model;
                if (model instanceof Editor) {
                    models.editor.push(model);
                } else if (model instanceof Graph) {
                    models.graph.push(model);
                } else if (model instanceof Outline) {
                    models.outline.push(model);
                } else if (model instanceof Backlink) {
                    models.backlink.push(model);
                } else if (model instanceof Asset) {
                    models.asset.push(model);
                } else if (model instanceof Search) {
                    models.search.push(model);
                }
            } else {
                getTabs(item as Layout);
            }
        }
    };

    if (window.siyuan.layout.layout) {
        getTabs(window.siyuan.layout.layout);
    }
    return models;
};

export const getAllTabs = () => {
    const models: Tab[] = [];
    const getTabs = (layout: Layout) => {
        for (let i = 0; i < layout.children.length; i++) {
            const item = layout.children[i];
            if (item instanceof Tab) {
                models.push(item);
            } else {
                getTabs(item as Layout);
            }
        }
    };

    if (window.siyuan.layout.centerLayout) {
        getTabs(window.siyuan.layout.centerLayout);
    }
    return models;
};

export const getAllDocks = () => {
    const docks: IDockTab[] = [];
    window.siyuan.config.uiLayout.left.forEach((item: IDockTab[]) => {
        item.forEach((dock: IDockTab) => {
            docks.push(dock);
        });
    });
    window.siyuan.config.uiLayout.right.forEach((item: IDockTab[]) => {
        item.forEach((dock: IDockTab) => {
            docks.push(dock);
        });
    });
    window.siyuan.config.uiLayout.top.forEach((item: IDockTab[]) => {
        item.forEach((dock: IDockTab) => {
            docks.push(dock);
        });
    });
    window.siyuan.config.uiLayout.bottom.forEach((item: IDockTab[]) => {
        item.forEach((dock: IDockTab) => {
            docks.push(dock);
        });
    });
    return docks;
};
