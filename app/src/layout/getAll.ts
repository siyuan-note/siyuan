import {Layout} from "./index";
import {Tab} from "./Tab";
import {Editor} from "../editor";
import {Graph} from "./dock/Graph";
import {Outline} from "./dock/Outline";
import {Backlink} from "./dock/Backlink";
import {Asset} from "../asset";
import {Search} from "../search";
import {Files} from "./dock/Files";
import {Bookmark} from "./dock/Bookmark";
import {Tag} from "./dock/Tag";
import {Custom} from "./dock/Custom";
import {Protyle} from "../protyle";

export const getAllEditor = () => {
    const models = getAllModels();
    const editors: Protyle[] = [];
    models.editor.forEach(item => {
        editors.push(item.editor);
    });
    models.search.forEach(item => {
        editors.push(item.edit);
    });
    models.custom.forEach(item => {
        if (item.data?.editor instanceof Protyle) {
            editors.push(item.data.editor);
        }
    });
    models.backlink.forEach(item => {
        item.editors.forEach(editorItem => {
            editors.push(editorItem);
        });
    });
    window.siyuan.dialogs.forEach(item => {
        if (item.editor) {
            editors.push(item.editor);
        }
    });
    window.siyuan.blockPanels.forEach(item => {
        item.editors.forEach(editorItem => {
            editors.push(editorItem);
        });
    });
    return editors;
};

export const getAllModels = () => {
    const models: IModels = {
        editor: [],
        graph: [],
        asset: [],
        outline: [],
        backlink: [],
        search: [],
        inbox: [],
        files: [],
        bookmark: [],
        tag: [],
        custom: [],
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
                } else if (model instanceof Files) {
                    models.files.push(model);
                } else if (model instanceof Bookmark) {
                    models.bookmark.push(model);
                } else if (model instanceof Tag) {
                    models.tag.push(model);
                } else if (model instanceof Custom) {
                    models.custom.push(model);
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
    const tabs: Tab[] = [];
    const getTabs = (layout: Layout) => {
        for (let i = 0; i < layout.children.length; i++) {
            const item = layout.children[i];
            if (item instanceof Tab) {
                tabs.push(item);
            } else {
                getTabs(item as Layout);
            }
        }
    };

    if (window.siyuan.layout.centerLayout) {
        getTabs(window.siyuan.layout.centerLayout);
    }
    return tabs;
};

export const getAllDocks = () => {
    const docks: IDockTab[] = [];
    window.siyuan.config.uiLayout.left.data.forEach((item: IDockTab[]) => {
        item.forEach((dock: IDockTab) => {
            docks.push(dock);
        });
    });
    window.siyuan.config.uiLayout.right.data.forEach((item: IDockTab[]) => {
        item.forEach((dock: IDockTab) => {
            docks.push(dock);
        });
    });
    window.siyuan.config.uiLayout.bottom.data.forEach((item: IDockTab[]) => {
        item.forEach((dock: IDockTab) => {
            docks.push(dock);
        });
    });
    return docks;
};
