/// #if !MOBILE
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
import {Wnd} from "./Wnd";
/// #endif

export const getAllEditor = () => {
    const editors: Protyle[] = [];
    /// #if MOBILE
    if (window.siyuan.mobile.editor) {
        editors.push(window.siyuan.mobile.editor);
    }
    if (window.siyuan.mobile.popEditor) {
        editors.push(window.siyuan.mobile.popEditor);
    }
    /// #else
    const models = getAllModels();
    models.editor.forEach(item => {
        editors.push(item.editor);
    });
    models.search.forEach(item => {
        editors.push(item.editors.edit);
        editors.push(item.editors.unRefEdit);
    });
    models.custom.forEach(item => {
        item.editors?.forEach(eItem => {
            editors.push(eItem);
        });
    });
    models.backlink.forEach(item => {
        item.editors.forEach(editorItem => {
            editors.push(editorItem);
        });
    });
    window.siyuan.dialogs.forEach(item => {
        if (item.editors) {
            Object.keys(item.editors).forEach(key => {
                editors.push(item.editors[key]);
            });
        }
    });
    window.siyuan.blockPanels.forEach(item => {
        item.editors.forEach(editorItem => {
            editors.push(editorItem);
        });
    });
    /// #endif
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

export const getAllWnds = (layout: Layout, wnds: Wnd[]) => {
    for (let i = 0; i < layout.children.length; i++) {
        const item = layout.children[i];
        if (item instanceof Wnd) {
            wnds.push(item);
        } else if (item instanceof Layout) {
            getAllWnds(item, wnds);
        }
    }
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
    const docks: Config.IUILayoutDockTab[] = [];
    window.siyuan.config.uiLayout.left.data.forEach((item) => {
        item.forEach((dock) => {
            docks.push(dock);
        });
    });
    window.siyuan.config.uiLayout.right.data.forEach((item) => {
        item.forEach((dock) => {
            docks.push(dock);
        });
    });
    window.siyuan.config.uiLayout.bottom.data.forEach((item) => {
        item.forEach((dock) => {
            docks.push(dock);
        });
    });
    return docks;
};
