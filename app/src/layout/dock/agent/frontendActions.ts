// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import type {App} from "../../../index";

export interface IAction {
    name: string;
    description?: string;
    handler: (args: Record<string, unknown>, app: App) => Promise<{result?: string; error?: string}>;
}

// Centralized action registry. Data structure is a registry so that plugins can register their
// own frontend actions in a future version (via Plugin.addAction() -> registerAction). The first
// version only loads built-in actions, but the lookup layer is already registry-shaped, so adding
// plugin support later requires zero changes to the dispatch path.
//
// IMPORTANT: this module must NOT have any top-level value imports beyond the registry itself.
// The built-in actions below pull in config/editor/search modules that participate in import
// cycles with the layout/plugin graph, so they are loaded lazily via dynamic import() inside the
// handlers (which are async). This keeps `import {lookupAction}` cycle-free.
const actionRegistry = new Map<string, IAction>();

export const registerAction = (a: IAction) => {
    actionRegistry.set(a.name, a);
};

export const lookupAction = (name: string): IAction | undefined => actionRegistry.get(name);

export const listActions = (): IAction[] => Array.from(actionRegistry.values());

export const unregisterAction = (name: string) => {
    actionRegistry.delete(name);
};

/// #if !MOBILE
registerAction({
    name: "open_setting",
    handler: async (args, app) => {
        const query = (args.query as string | undefined)?.trim();
        const {openSetting} = await import("../../../config");
        // openSetting() has a quirk: if a settings dialog already exists, it DESTROYS it and
        // returns the destroyed dialog (the splice from window.siyuan.dialogs is deferred via
        // setTimeout, so it can't be detected synchronously). To guarantee the panel is visible
        // after this call, check first: if one is already open, reuse it; otherwise open fresh.
        const existing = window.siyuan.dialogs.find(d => d.element.querySelector(".config__tab-container"));
        let dialog = existing;
        if (!dialog) {
            dialog = openSetting(app);
        }
        if (query) {
            // The settings panel has a built-in search box (wired by initConfigSearch in
            // config/index.ts). Fill it and dispatch an "input" event to trigger live filtering,
            // which surfaces matching config items.
            const input = dialog.element.querySelector(".config__side .b3-text-field") as HTMLInputElement;
            if (input) {
                input.value = query;
                input.dispatchEvent(new Event("input", {bubbles: true}));
            }
            return {result: `Opened the settings panel and filtered by "${query}".`};
        }
        return {result: "Opened the settings panel."};
    },
});

registerAction({
    name: "focus_block",
    handler: async (args) => {
        const id = args.id as string | undefined;
        if (!id) {
            return {error: "missing required argument: id"};
        }
        const {getAllEditor} = await import("../../getAll");
        // Find the editor whose document contains this block, then scroll it into view.
        let blockEl: HTMLElement | null = null;
        for (const editor of getAllEditor()) {
            const el = editor.protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
            if (el) {
                blockEl = el;
                break;
            }
        }
        if (!blockEl) {
            return {error: `Block ${id} is not loaded in any open editor. Use open_document to open it first.`};
        }
        blockEl.scrollIntoView({behavior: "smooth", block: "center"});
        // Briefly highlight the block so the user can spot it.
        blockEl.classList.add("protyle-wysiwyg--hl");
        setTimeout(() => blockEl?.classList.remove("protyle-wysiwyg--hl"), 2000);
        return {result: `Focused block ${id} in the active editor.`};
    },
});

registerAction({
    name: "open_document",
    handler: async (args, app) => {
        const id = args.id as string | undefined;
        if (!id) {
            return {error: "missing required argument: id"};
        }
        try {
            const [{openFileById}, {Constants}] = await Promise.all([
                import("../../../editor/util"),
                import("../../../constants"),
            ]);
            await openFileById({app, id, action: [Constants.CB_GET_FOCUS]});
            return {result: `Opened document ${id}.`};
        } catch (e) {
            return {error: `Failed to open document ${id}: ${(e as Error).message}`};
        }
    },
});

registerAction({
    name: "open_search",
    handler: async (args, app) => {
        const query = (args.query as string | undefined)?.trim();
        const [{openSearch}, {Constants}] = await Promise.all([
            import("../../../search/spread"),
            import("../../../constants"),
        ]);
        await openSearch({app, hotkey: Constants.DIALOG_GLOBALSEARCH, key: query});
        return {result: query ? `Opened search dialog with query "${query}".` : "Opened search dialog."};
    },
});
/// #endif
