// SiYuan - From thought to insight, with agents
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
import type {SearchOpenOptions} from "../../../search/openOptions";
import {isDisabledFeature} from "../../../protyle/util/compatibility";

// 浏览器能力只在当前应用实例中执行，内核持有声明和本轮不可变的调用映射。

export interface IAgentCapabilityEffects {
    localRead?: boolean;
    localWrite?: boolean;
    dataEgress?: boolean;
    externalCost?: boolean;
}

export interface IAgentCapability {
    id: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    effects?: IAgentCapabilityEffects;
    actionEffects?: Record<string, IAgentCapabilityEffects>;
    source: "native" | "plugin";
    ownerId?: string;
    ownerName?: string;
    generation?: number;
    handler: (args: Record<string, unknown>, app: App) => Promise<{
        result?: string;
        structuredContent?: unknown;
        error?: string;
    }>;
}

export type IAgentCapabilityManifest = Omit<IAgentCapability, "handler"> & {generation: number};

const capabilityRegistry = new Map<string, IAgentCapabilityManifest & Pick<IAgentCapability, "handler">>();
let capabilityGeneration = 0;

export const registerCapability = (capability: IAgentCapability) => {
    capabilityGeneration++;
    capabilityRegistry.set(capability.id, {...capability, generation: capabilityGeneration});
    return capabilityGeneration;
};

export const lookupCapability = (id: string, generation?: number): IAgentCapability | undefined => {
    const capability = capabilityRegistry.get(id);
    if (!capability || generation !== undefined && capability.generation !== generation) {
        return undefined;
    }
    return capability;
};

export const isCapabilityEnabled = (id: string): boolean => {
    const policy = window.siyuan.config.ai.agent.capabilityPolicy;
    if (!policy) {
        return true;
    }
    return (policy.overrides[id] || policy.default) === "allow";
};

export const listCapabilityManifests = (): IAgentCapabilityManifest[] => Array.from(capabilityRegistry.values()).map((capability) => ({
    id: capability.id,
    title: capability.title,
    description: capability.description,
    inputSchema: capability.inputSchema,
    outputSchema: capability.outputSchema,
    effects: capability.effects,
    actionEffects: capability.actionEffects,
    source: capability.source,
    ownerId: capability.ownerId,
    ownerName: capability.ownerName,
    generation: capability.generation,
}));

export const unregisterCapability = (id: string, generation?: number) => {
    if (generation !== undefined && capabilityRegistry.get(id)?.generation !== generation) {
        return;
    }
    capabilityRegistry.delete(id);
};

let mobileFrontend = false;
/// #if MOBILE
mobileFrontend = true;
/// #endif

registerCapability({
    id: "native/frontend/open_setting",
    title: "Open settings",
    description: mobileFrontend ? "Open SiYuan settings and optionally provide a search query." :
        "Open SiYuan settings and optionally filter settings by a search query.",
    inputSchema: {type: "object", properties: {query: {type: "string"}}, additionalProperties: false},
    source: "native",
    handler: async (args, app) => {
        const query = (args.query as string | undefined)?.trim();
        /// #if !MOBILE
        const {openSetting} = await import("../../../config");
        // 已有设置对话框时复用该实例，避免销毁现有实例后返回待销毁的对象。
        const existing = window.siyuan.dialogs.find(d => d.element.querySelector(".config__tab-container"));
        const dialog = existing || openSetting(app);
        if (query) {
            const input = dialog.element.querySelector(".config__side .b3-text-field") as HTMLInputElement;
            if (input) {
                input.value = query;
                input.dispatchEvent(new Event("input", {bubbles: true}));
            }
            return {result: `Opened the settings panel and filtered by "${query}".`};
        }
        return {result: "Opened the settings panel."};
        /// #else
        const [{hideMobileAgent, reopenMobileAgent}, {openMobileSetting}] = await Promise.all([
            import("../../../mobile/agent/MobileAgentChat"),
            import("../../../mobile/menu"),
        ]);
        hideMobileAgent();
        openMobileSetting(app, undefined, reopenMobileAgent);
        return {result: query ? `Opened mobile settings for "${query}".` : "Opened mobile settings."};
        /// #endif
    },
});

registerCapability({
    id: "native/frontend/focus_block",
    title: "Focus block",
    description: mobileFrontend ? "Scroll a block already loaded in the current editor into view and highlight it." :
        "Scroll a block already loaded in an editor into view and highlight it.",
    inputSchema: {type: "object", properties: {id: {type: "string"}}, required: ["id"], additionalProperties: false},
    source: "native",
    handler: async (args) => {
        const id = args.id as string | undefined;
        if (!id) {
            return {error: "missing required argument: id"};
        }
        let blockEl: HTMLElement | null = null;
        let editorScope = "any open editor";
        /// #if !MOBILE
        const {getAllEditor} = await import("../../getAll");
        for (const editor of getAllEditor()) {
            blockEl = editor.protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
            if (blockEl) {
                break;
            }
        }
        /// #else
        const [{getCurrentEditor}, {hideMobileAgent}] = await Promise.all([
            import("../../../mobile/editor"),
            import("../../../mobile/agent/MobileAgentChat"),
        ]);
        const editor = getCurrentEditor();
        blockEl = editor?.protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`) || null;
        editorScope = "the current editor";
        if (blockEl) {
            hideMobileAgent();
        }
        /// #endif
        if (!blockEl) {
            return {error: `Block ${id} is not loaded in ${editorScope}. Use open_document to open it first.`};
        }
        blockEl.scrollIntoView({behavior: "smooth", block: "center"});
        blockEl.classList.add("protyle-wysiwyg--hl");
        setTimeout(() => blockEl?.classList.remove("protyle-wysiwyg--hl"), 2000);
        return {result: `Focused block ${id} in the active editor.`};
    },
});

registerCapability({
    id: "native/frontend/open_document",
    title: "Open document",
    description: mobileFrontend ? "Open a SiYuan document by its block ID in the mobile app." :
        "Open a SiYuan document by its block ID in the current app.",
    inputSchema: {type: "object", properties: {id: {type: "string"}}, required: ["id"], additionalProperties: false},
    source: "native",
    handler: async (args, app) => {
        const id = args.id as string | undefined;
        if (!id) {
            return {error: "missing required argument: id"};
        }
        try {
            /// #if !MOBILE
            const [{openFileById}, {Constants}] = await Promise.all([
                import("../../../editor/util"),
                import("../../../constants"),
            ]);
            await openFileById({app, id, action: [Constants.CB_GET_FOCUS]});
            /// #else
            const [{openMobileFileById}, {hideMobileAgent}, {Constants: mobileConstants}] = await Promise.all([
                import("../../../mobile/editor"),
                import("../../../mobile/agent/MobileAgentChat"),
                import("../../../constants"),
            ]);
            hideMobileAgent();
            openMobileFileById(app, id, [mobileConstants.CB_GET_FOCUS]);
            /// #endif
            return {result: `Opened document ${id}.`};
        } catch (e) {
            return {error: `Failed to open document ${id}: ${(e as Error).message}`};
        }
    },
});

registerCapability({
    id: "native/frontend/open_search",
    title: "Open search",
    description: `Open the SiYuan ${mobileFrontend ? "mobile search interface" : "search interface"} and optionally set a query and method. Omitted values preserve the current search settings. For SQL (method=2), return complete block rows with SELECT b.* FROM blocks b, rather than projections or aggregates; express filters and LIMIT/OFFSET in SQL. Use sql.query for statistics and arbitrary columns, and sql.schema for structural search guidance. Newlines and SQL comments are preserved.`,
    inputSchema: {type: "object", properties: {
        query: {type: "string"},
        method: {type: "integer", enum: [0, 1, 2, 3, 4],
            description: "0 keyword, 1 query syntax, 2 SQL, 3 regex, 4 semantic (requires enabled embeddings)"},
    }, additionalProperties: false},
    source: "native",
    handler: async (args, app) => {
        if (args.query !== undefined && typeof args.query !== "string") {
            return {error: "query must be a string"};
        }
        if (args.method !== undefined && (!Number.isInteger(args.method) ||
            (args.method as number) < 0 || (args.method as number) > 4)) {
            return {error: "method must be an integer from 0 to 4"};
        }
        const query = (args.query as string | undefined)?.trim();
        const method = args.method as SearchOpenOptions["method"];
        if (method === 4 && (isDisabledFeature("ai") || !window.siyuan.config.ai.embedding.enabled)) {
            return {error: "Semantic search requires enabled AI and embeddings"};
        }
        /// #if !MOBILE
        const [{openSearch}, {Constants}] = await Promise.all([
            import("../../../search/spread"),
            import("../../../constants"),
        ]);
        await openSearch({app, hotkey: Constants.DIALOG_GLOBALSEARCH, key: query, method});
        return {result: query ? `Opened search dialog with query "${query}".` : "Opened search dialog."};
        /// #else
        const [{popSearch}, {hideMobileAgent}] = await Promise.all([
            import("../../../mobile/menu/search"),
            import("../../../mobile/agent/MobileAgentChat"),
        ]);
        hideMobileAgent();
        popSearch(app, undefined, false, {key: query, method});
        return {result: query ? `Opened mobile search with query "${query}".` : "Opened mobile search."};
        /// #endif
    },
});
