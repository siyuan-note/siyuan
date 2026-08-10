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

/// #if !MOBILE
registerCapability({
    id: "native/frontend/open_setting",
    title: "Open settings",
    description: "Open SiYuan settings and optionally filter settings by a search query.",
    inputSchema: {type: "object", properties: {query: {type: "string"}}, additionalProperties: false},
    source: "native",
    handler: async (args, app) => {
        const query = (args.query as string | undefined)?.trim();
        const {openSetting} = await import("../../../config");
        // 已有设置对话框时复用该实例，避免 openSetting() 销毁现有实例后返回待销毁的对象。
        const existing = window.siyuan.dialogs.find(d => d.element.querySelector(".config__tab-container"));
        let dialog = existing;
        if (!dialog) {
            dialog = openSetting(app);
        }
        if (query) {
            // 填充设置面板的内置搜索框并触发实时筛选。
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

registerCapability({
    id: "native/frontend/focus_block",
    title: "Focus block",
    description: "Scroll a block already loaded in an editor into view and highlight it.",
    inputSchema: {type: "object", properties: {id: {type: "string"}}, required: ["id"], additionalProperties: false},
    source: "native",
    handler: async (args) => {
        const id = args.id as string | undefined;
        if (!id) {
            return {error: "missing required argument: id"};
        }
        const {getAllEditor} = await import("../../getAll");
        // 找到包含目标块的编辑器并滚动到该块。
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
        // 短暂高亮目标块以便用户定位。
        blockEl.classList.add("protyle-wysiwyg--hl");
        setTimeout(() => blockEl?.classList.remove("protyle-wysiwyg--hl"), 2000);
        return {result: `Focused block ${id} in the active editor.`};
    },
});

registerCapability({
    id: "native/frontend/open_document",
    title: "Open document",
    description: "Open a SiYuan document by its block ID in the current app.",
    inputSchema: {type: "object", properties: {id: {type: "string"}}, required: ["id"], additionalProperties: false},
    source: "native",
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

registerCapability({
    id: "native/frontend/open_search",
    title: "Open search",
    description: "Open the SiYuan search interface and optionally fill in a query.",
    inputSchema: {type: "object", properties: {query: {type: "string"}}, additionalProperties: false},
    source: "native",
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
/// #else
registerCapability({
    id: "native/frontend/open_setting",
    title: "Open settings",
    description: "Open SiYuan settings and optionally provide a search query.",
    inputSchema: {type: "object", properties: {query: {type: "string"}}, additionalProperties: false},
    source: "native",
    handler: async (args, app) => {
        const query = (args.query as string | undefined)?.trim();
        const [{hideMobileAgent, reopenMobileAgent}, {openMobileSetting}] = await Promise.all([
            import("../../../mobile/agent/MobileAgentChat"),
            import("../../../mobile/menu"),
        ]);
        hideMobileAgent();
        openMobileSetting(app, undefined, reopenMobileAgent);
        return {result: query ? `Opened mobile settings for "${query}".` : "Opened mobile settings."};
    },
});

registerCapability({
    id: "native/frontend/focus_block",
    title: "Focus block",
    description: "Scroll a block already loaded in the current editor into view and highlight it.",
    inputSchema: {type: "object", properties: {id: {type: "string"}}, required: ["id"], additionalProperties: false},
    source: "native",
    handler: async (args) => {
        const id = args.id as string | undefined;
        if (!id) {
            return {error: "missing required argument: id"};
        }
        const [{getCurrentEditor}, {hideMobileAgent}] = await Promise.all([
            import("../../../mobile/editor"),
            import("../../../mobile/agent/MobileAgentChat"),
        ]);
        const editor = getCurrentEditor();
        const block = editor?.protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
        if (!block) {
            return {error: `Block ${id} is not loaded in the current editor. Use open_document to open it first.`};
        }
        hideMobileAgent();
        block.scrollIntoView({behavior: "smooth", block: "center"});
        block.classList.add("protyle-wysiwyg--hl");
        setTimeout(() => block.classList.remove("protyle-wysiwyg--hl"), 2000);
        return {result: `Focused block ${id} in the active editor.`};
    },
});

registerCapability({
    id: "native/frontend/open_document",
    title: "Open document",
    description: "Open a SiYuan document by its block ID in the mobile app.",
    inputSchema: {type: "object", properties: {id: {type: "string"}}, required: ["id"], additionalProperties: false},
    source: "native",
    handler: async (args, app) => {
        const id = args.id as string | undefined;
        if (!id) {
            return {error: "missing required argument: id"};
        }
        try {
            const [{openMobileFileById}, {hideMobileAgent}, {Constants}] = await Promise.all([
                import("../../../mobile/editor"),
                import("../../../mobile/agent/MobileAgentChat"),
                import("../../../constants"),
            ]);
            hideMobileAgent();
            openMobileFileById(app, id, [Constants.CB_GET_FOCUS]);
            return {result: `Opened document ${id}.`};
        } catch (e) {
            return {error: `Failed to open document ${id}: ${(e as Error).message}`};
        }
    },
});

registerCapability({
    id: "native/frontend/open_search",
    title: "Open search",
    description: "Open the SiYuan mobile search interface and optionally fill in a query.",
    inputSchema: {type: "object", properties: {query: {type: "string"}}, additionalProperties: false},
    source: "native",
    handler: async (args, app) => {
        const query = (args.query as string | undefined)?.trim();
        const [{popSearch}, {hideMobileAgent}] = await Promise.all([
            import("../../../mobile/menu/search"),
            import("../../../mobile/agent/MobileAgentChat"),
        ]);
        hideMobileAgent();
        popSearch(app);
        if (query) {
            const input = document.getElementById("toolbarSearch") as HTMLInputElement | null;
            if (input) {
                input.value = query;
                input.dispatchEvent(new InputEvent("input", {bubbles: true}));
            }
        }
        return {result: query ? `Opened mobile search with query "${query}".` : "Opened mobile search."};
    },
});
/// #endif
