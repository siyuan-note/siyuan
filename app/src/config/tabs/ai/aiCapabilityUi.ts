import {Dialog} from "../../../dialog";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchPost} from "../../../util/fetch";
import {isMobile} from "../../../util/functions";
import {listCapabilityManifests} from "../../../layout/dock/agent/frontendCapabilities";
import {aiConfigApi} from "./aiRuntime";

type CapabilityDecision = "allow" | "deny";
type ApprovalDecision = "allow" | "confirm";

const escapeAttribute = (value: string) => escapeAttr(escapeHtml(value));

interface ICapabilityActionInfo {
    name: string;
    effects?: {
        localRead?: boolean;
        localWrite?: boolean;
        dataEgress?: boolean;
        externalCost?: boolean;
    };
}

interface ICapabilityInfo {
    id: string;
    name: string;
    title?: string;
    description: string;
    source: "native" | "plugin" | "mcp";
    ownerId?: string;
    ownerName?: string;
    runtime: "kernel" | "plugin-worker" | "mcp" | "browser";
    enabled: boolean;
    available: boolean;
    actions?: ICapabilityActionInfo[];
}

const getCapabilityPolicy = (): Config.IAgent["capabilityPolicy"] =>
    window.siyuan.config.ai.agent.capabilityPolicy || {default: "allow", overrides: {}};

const getApprovalPolicy = (): Config.IAgent["approvalPolicy"] =>
    window.siyuan.config.ai.agent.approvalPolicy || {default: "confirm", overrides: {}};

const isCapabilityAllowed = (id: string, policy = getCapabilityPolicy()) =>
    (policy.overrides[id] || policy.default) === "allow";

const isCapabilityAutoApproved = (id: string, action = "", policy = getApprovalPolicy()) => {
    const override = policy.overrides[id];
    return (override?.actions[action] || override?.default || policy.default) === "allow";
};

const getGroupLabel = (capability: ICapabilityInfo) => {
    const runtime = capability.runtime === "browser"
        ? window.siyuan.languages.agentCapabilitiesFrontend
        : window.siyuan.languages.agentCapabilitiesBackend;
    let source = window.siyuan.languages.agentCapabilitiesBuiltin;
    if (capability.source === "plugin") {
        source = window.siyuan.languages.agentCapabilitiesPlugins;
    } else if (capability.source === "mcp") {
        source = window.siyuan.languages.agentCapabilitiesMcp;
    }
    const owner = capability.ownerName || capability.ownerId;
    return owner ? `${runtime} · ${source} · ${owner}` : `${runtime} · ${source}`;
};

const getManifestActions = (capability: ReturnType<typeof listCapabilityManifests>[number]): ICapabilityActionInfo[] => {
    const names = new Set(Object.keys(capability.actionEffects || {}));
    const properties = capability.inputSchema.properties as Record<string, unknown> | undefined;
    const action = properties?.action as {enum?: unknown[]} | undefined;
    action?.enum?.forEach((value) => {
        if (typeof value === "string" && value) {
            names.add(value);
        }
    });
    return Array.from(names).sort().map((name) => ({name, effects: capability.actionEffects?.[name] || capability.effects}));
};

const getAllCapabilities = (backend: ICapabilityInfo[]): ICapabilityInfo[] => {
    const frontend = listCapabilityManifests().map((capability): ICapabilityInfo => ({
        id: capability.id,
        name: capability.id.split("/").at(-1) || capability.id,
        title: capability.title,
        description: capability.description,
        source: capability.source,
        ownerId: capability.ownerId,
        ownerName: capability.ownerName,
        runtime: "browser",
        enabled: isCapabilityAllowed(capability.id),
        available: true,
        actions: getManifestActions(capability),
    }));
    return [...backend, ...frontend].sort((a, b) => {
        const group = getGroupLabel(a).localeCompare(getGroupLabel(b));
        return group || a.id.localeCompare(b.id);
    });
};

const addUnavailableCapabilities = (capabilities: ICapabilityInfo[]) => {
    const knownIDs = new Set(capabilities.map((capability) => capability.id));
    const configuredIDs = new Set([
        ...Object.keys(getCapabilityPolicy().overrides),
        ...Object.keys(getApprovalPolicy().overrides),
    ]);
    configuredIDs.forEach((id) => {
        if (!knownIDs.has(id)) {
            capabilities.push({
                id,
                name: id,
                description: "",
                source: "native",
                runtime: "kernel",
                enabled: isCapabilityAllowed(id),
                available: false,
                actions: [],
            });
        }
    });
};

const saveCapabilityPolicy = (policy: Config.IAgent["capabilityPolicy"], onApplied: () => void) => {
    aiConfigApi.patch("agent.capabilityPolicy", policy, onApplied);
};

const saveApprovalPolicy = (policy: Config.IAgent["approvalPolicy"], onApplied: () => void) => {
    aiConfigApi.patch("agent.approvalPolicy", policy, onApplied);
};

const setCapabilitiesDecision = (ids: string[], decision: CapabilityDecision, onApplied: () => void) => {
    const policy = getCapabilityPolicy();
    const overrides = {...policy.overrides};
    ids.forEach((id) => {
        if (decision === policy.default) {
            delete overrides[id];
        } else {
            overrides[id] = decision;
        }
    });
    saveCapabilityPolicy({...policy, overrides}, onApplied);
};

const setCapabilityApproval = (id: string, decision: ApprovalDecision, onApplied: () => void) => {
    const policy = getApprovalPolicy();
    const overrides = {...policy.overrides};
    if (decision === policy.default) {
        delete overrides[id];
    } else {
        overrides[id] = {default: decision, actions: {}};
    }
    saveApprovalPolicy({...policy, overrides}, onApplied);
};

const setCapabilityActionApproval = (id: string, action: string, decision: ApprovalDecision,
                                     onApplied: () => void) => {
    const policy = getApprovalPolicy();
    const overrides = {...policy.overrides};
    const current = overrides[id];
    const capabilityDefault = current?.default || policy.default;
    const actions = {...current?.actions};
    if (decision === capabilityDefault) {
        delete actions[action];
    } else {
        actions[action] = decision;
    }
    if (!current?.default && Object.keys(actions).length === 0) {
        delete overrides[id];
    } else {
        overrides[id] = {default: current?.default || "", actions};
    }
    saveApprovalPolicy({...policy, overrides}, onApplied);
};

const capabilityMatches = (capability: ICapabilityInfo, query: string) => {
    if (!query) {
        return true;
    }
    return [
        capability.title,
        capability.name,
        capability.id,
        capability.description,
        getGroupLabel(capability),
        ...(capability.actions || []).map((action) => action.name),
    ].some((value) => value?.toLocaleLowerCase().includes(query));
};

const openAgentCapabilityDialog = (settingRoot: HTMLElement, capabilities: ICapabilityInfo[]) => {
    const expanded = new Set<string>();
    let query = "";
    let onlySelected = false;
    const dialog = new Dialog({
        title: window.siyuan.languages.agentCapabilities,
        width: isMobile() ? "96vw" : "min(900px, 90vw)",
        height: isMobile() ? "90vh" : "min(820px, 86vh)",
        content: `<div class="b3-dialog__content" style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;">
    <div class="b3-label b3-label--inner" style="flex-shrink:0;">${window.siyuan.languages.agentCapabilitiesDialogTip}</div>
    <div class="fn__hr"></div>
    <div class="fn__flex" style="flex-shrink:0;align-items:center;">
        <div class="fn__flex-1" style="position:relative;">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <input class="b3-text-field b3-form__icon-input fn__block" data-type="searchAgentCapabilities" placeholder="${escapeAttribute(window.siyuan.languages.agentCapabilitiesSearch)}">
        </div>
        <span class="fn__space"></span>
        <label class="fn__flex-center"><input class="b3-switch" data-type="onlySelectedAgentCapabilities" type="checkbox"><span class="fn__space--small"></span>${window.siyuan.languages.agentCapabilitiesOnlySelected}</label>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex" style="flex-shrink:0;">
        <button class="b3-button b3-button--outline" data-type="enableAllAgentCapabilities">${window.siyuan.languages.agentCapabilitiesEnableAll}</button>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline" data-type="disableAllAgentCapabilities">${window.siyuan.languages.agentCapabilitiesDisableAll}</button>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex-1" data-type="agentCapabilityList" style="min-height:0;overflow:auto;"></div>
    <div class="fn__hr"></div>
    <div class="fn__flex b3-label__text" style="flex-shrink:0;align-items:center;">
        <span class="fn__flex-1">${window.siyuan.languages.agentCapabilitiesAutoApproveTip}</span>
        <span data-type="agentCapabilitySelectedCount"></span>
    </div>
</div>`,
    });

    const render = () => {
        const list = dialog.element.querySelector<HTMLElement>("[data-type='agentCapabilityList']");
        const count = dialog.element.querySelector<HTMLElement>("[data-type='agentCapabilitySelectedCount']");
        if (!list || !count) {
            return;
        }
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const visible = capabilities.filter((capability) =>
            (!onlySelected || isCapabilityAllowed(capability.id)) && capabilityMatches(capability, normalizedQuery));
        const groups = new Map<string, ICapabilityInfo[]>();
        visible.forEach((capability) => {
            const label = capability.available
                ? getGroupLabel(capability)
                : window.siyuan.languages.agentCapabilitiesUnavailable;
            const items = groups.get(label) || [];
            items.push(capability);
            groups.set(label, items);
        });
        list.innerHTML = Array.from(groups.entries()).map(([label, items], groupIndex) => {
            const groupEnabled = items.every((capability) => isCapabilityAllowed(capability.id));
            return `<details open data-capability-group="${groupIndex}">
    <summary class="fn__flex" style="cursor:pointer;padding:8px 4px;align-items:center;">
        <span class="fn__flex-1">${escapeHtml(label)} (${items.length})</span>
        <button class="b3-button b3-button--outline" data-type="toggleAgentCapabilityGroup" data-group-index="${groupIndex}">${groupEnabled ? window.siyuan.languages.agentCapabilitiesDisableAll : window.siyuan.languages.selectAll}</button>
    </summary>
    <div class="b3-list b3-list--border b3-list--background">
        ${items.map((capability) => {
            const actions = capability.actions || [];
            const opened = expanded.has(capability.id);
            const actionSummary = actions.length > 0
                ? `<span class="b3-label__text" style="display:block;">${window.siyuan.languages.agentCapabilitiesActions}: ${escapeHtml(actions.map((action) => action.name).join(", "))}</span>`
                : "";
            return `<div data-capability-id="${escapeAttribute(capability.id)}">
    <div class="b3-list-item b3-list-item--narrow" style="height:auto;align-items:flex-start;padding-top:10px;padding-bottom:10px;">
        <input data-type="toggleAgentCapability" type="checkbox"${isCapabilityAllowed(capability.id) ? " checked" : ""}>
        <span class="fn__space"></span>
        <span class="fn__flex-1" style="min-width:0;">
            <span class="b3-list-item__text" style="display:block;">${escapeHtml(capability.title || capability.name)}</span>
            ${capability.description ? `<span class="b3-label__text" style="display:block;">${escapeHtml(capability.description)}</span>` : ""}
            ${actionSummary}
            <span class="b3-list-item__meta" style="display:block;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(capability.id)}</span>
        </span>
        <span class="fn__space"></span>
        <label class="fn__flex-center"><input class="b3-switch" data-type="toggleAgentCapabilityApproval" type="checkbox"${isCapabilityAutoApproved(capability.id) ? " checked" : ""}><span class="fn__space--small"></span>${window.siyuan.languages.agentCapabilitiesAutoApprove}</label>
        ${actions.length > 0 ? `<button class="b3-list-item__action" data-type="toggleAgentCapabilityActions" aria-label="${escapeAttribute(window.siyuan.languages.agentCapabilitiesActions)}"><svg style="transform:rotate(${opened ? "90deg" : "0"});"><use xlink:href="#iconRight"></use></svg></button>` : ""}
    </div>
    ${actions.length > 0 && opened ? `<div style="padding:0 12px 8px 42px;">${actions.map((action) => `<label class="fn__flex b3-label__text" style="padding:5px 0;align-items:center;">
        <span class="fn__flex-1"><code>${escapeHtml(action.name)}</code></span>
        <input class="b3-switch" data-type="toggleAgentCapabilityActionApproval" data-capability-action="${escapeAttribute(action.name)}" type="checkbox"${isCapabilityAutoApproved(capability.id, action.name) ? " checked" : ""}>
    </label>`).join("")}</div>` : ""}
</div>`;
        }).join("")}
    </div>
</details>`;
        }).join("");
        const selected = capabilities.filter((capability) => isCapabilityAllowed(capability.id)).length;
        count.textContent = window.siyuan.languages.agentCapabilitiesSelected
            .replace("${selected}", String(selected)).replace("${total}", String(capabilities.length));

        const groupEntries = Array.from(groups.values());
        list.querySelectorAll<HTMLElement>("[data-type='toggleAgentCapabilityGroup']").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const items = groupEntries[Number(button.dataset.groupIndex)] || [];
                const decision = items.every((capability) => isCapabilityAllowed(capability.id)) ? "deny" : "allow";
                setCapabilitiesDecision(items.map((capability) => capability.id), decision, onPolicyApplied);
            });
        });
    };

    const onPolicyApplied = () => {
        render();
        refreshCapabilitySummary(settingRoot, capabilities);
    };

    dialog.element.querySelector<HTMLInputElement>("[data-type='searchAgentCapabilities']")?.addEventListener("input", (event) => {
        query = (event.target as HTMLInputElement).value;
        render();
    });
    dialog.element.querySelector<HTMLInputElement>("[data-type='onlySelectedAgentCapabilities']")?.addEventListener("change", (event) => {
        onlySelected = (event.target as HTMLInputElement).checked;
        render();
    });
    dialog.element.addEventListener("change", (event) => {
        const input = event.target as HTMLInputElement;
        const type = input.dataset.type;
        const id = input.closest<HTMLElement>("[data-capability-id]")?.dataset.capabilityId;
        if (!id) {
            return;
        }
        if (type === "toggleAgentCapability") {
            setCapabilitiesDecision([id], input.checked ? "allow" : "deny", onPolicyApplied);
        } else if (type === "toggleAgentCapabilityApproval") {
            setCapabilityApproval(id, input.checked ? "allow" : "confirm", onPolicyApplied);
        } else if (type === "toggleAgentCapabilityActionApproval") {
            const action = input.dataset.capabilityAction;
            if (action !== undefined) {
                setCapabilityActionApproval(id, action, input.checked ? "allow" : "confirm", onPolicyApplied);
            }
        }
    });
    dialog.element.addEventListener("click", (event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-type]");
        if (!target) {
            return;
        }
        if (target.dataset.type === "enableAllAgentCapabilities") {
            saveCapabilityPolicy({default: "allow", overrides: {}}, onPolicyApplied);
        } else if (target.dataset.type === "disableAllAgentCapabilities") {
            saveCapabilityPolicy({default: "deny", overrides: {}}, onPolicyApplied);
        } else if (target.dataset.type === "toggleAgentCapabilityActions") {
            const id = target.closest<HTMLElement>("[data-capability-id]")?.dataset.capabilityId;
            if (id) {
                if (expanded.has(id)) {
                    expanded.delete(id);
                } else {
                    expanded.add(id);
                }
                render();
            }
        }
    });
    render();
    dialog.element.querySelector<HTMLInputElement>("[data-type='searchAgentCapabilities']")?.focus();
    refreshCapabilitySummary(settingRoot, capabilities);
};

const loadCapabilities = (callback: (capabilities: ICapabilityInfo[]) => void) => {
    fetchPost("/api/ai/agent/lsCapabilities", {}, (response) => {
        const capabilities = getAllCapabilities((response.data || []) as ICapabilityInfo[]);
        addUnavailableCapabilities(capabilities);
        callback(capabilities);
    });
};

const refreshCapabilitySummary = (root: HTMLElement, loaded?: ICapabilityInfo[]) => {
    const update = (capabilities: ICapabilityInfo[]) => {
        const summary = root.querySelector<HTMLElement>("[data-type='agentCapabilitySummary']");
        if (!summary) {
            return;
        }
        const selected = capabilities.filter((capability) => isCapabilityAllowed(capability.id)).length;
        summary.textContent = window.siyuan.languages.agentCapabilitiesSelected
            .replace("${selected}", String(selected)).replace("${total}", String(capabilities.length));
    };
    if (loaded) {
        update(loaded);
    } else {
        loadCapabilities(update);
    }
};

export const getAgentCapabilityKeywords = (): string[] => [
    window.siyuan.languages.agentCapabilities,
    window.siyuan.languages.agentCapabilitiesTip,
    window.siyuan.languages.agentCapabilitiesBackend,
    window.siyuan.languages.agentCapabilitiesFrontend,
    window.siyuan.languages.agentCapabilitiesPlugins,
    window.siyuan.languages.agentCapabilitiesMcp,
    window.siyuan.languages.agentCapabilitiesAutoApprove,
];

export const genAgentCapabilityHtml = (): string => `<div class="b3-label config-item" id="aiAgentCapabilities">
    <div class="fn__flex">
        <div class="fn__flex-1">
            <div class="config-name">${window.siyuan.languages.agentCapabilities}</div>
            <div class="b3-label__text">${window.siyuan.languages.agentCapabilitiesTip}</div>
            <div class="b3-label__text" data-type="agentCapabilitySummary"></div>
        </div>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline fn__flex-center" data-type="configureAgentCapabilities">${window.siyuan.languages.config}</button>
    </div>
</div>`;

export const mountAgentCapabilityBlock = (root: HTMLElement) => {
    const block = root.querySelector<HTMLElement>("#aiAgentCapabilities");
    if (!block) {
        return;
    }
    refreshCapabilitySummary(root);
    block.querySelector("[data-type='configureAgentCapabilities']")?.addEventListener("click", () => {
        loadCapabilities((capabilities) => openAgentCapabilityDialog(root, capabilities));
    });
};
