import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchPost} from "../../../util/fetch";
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

const getCapabilityViewHost = (root: HTMLElement) =>
    root.closest<HTMLElement>(".config__tab-container") || root;

const removeAgentCapabilityView = (root: HTMLElement, view?: HTMLElement) => {
    const host = getCapabilityViewHost(root);
    const views = view ? [view] : Array.from(host.children).filter((element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("config-agent-capability__view"));
    views.forEach((item) => {
        item.classList.remove("config__view--show");
        item.addEventListener("transitionend", (event) => {
            if (event.propertyName === "opacity") {
                item.remove();
            }
        });
        window.setTimeout(() => item.remove(), 300);
    });
};

const openAgentCapabilityView = (settingRoot: HTMLElement, capabilities: ICapabilityInfo[]) => {
    const expanded = new Set<string>();
    let query = "";
    let onlySelected = false;
    removeAgentCapabilityView(settingRoot);
    const view = document.createElement("div");
    view.className = "config-agent-capability__view config__view";
    view.innerHTML = `<div class="b3-dialog__header fn__flex">
    <div class="block__logo fn__pointer fn__flex-1" data-action="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
        <span class="ft__breakword">${escapeHtml(window.siyuan.languages.agentCapabilities)}</span>
    </div>
</div>
<div class="b3-dialog__body fn__flex-1" style="overflow:hidden;">
<div class="b3-dialog__content config-agent-capability__content">
    <div class="config-group config-agent-capability__controls">
        <div class="config-items">
            <div class="b3-label config-item">
                <div class="b3-label__text">${window.siyuan.languages.agentCapabilitiesDialogTip}</div>
                <div class="fn__hr--small"></div>
                <div class="b3-form__icon">
                    <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
                    <input class="b3-text-field b3-form__icon-input fn__block" data-type="searchAgentCapabilities" placeholder="${escapeAttribute(window.siyuan.languages.agentCapabilitiesSearch)}">
                </div>
            </div>
            <label class="fn__flex b3-label config-item config-wrap">
                <div class="fn__flex-1">
                    <div class="config-name">${window.siyuan.languages.agentCapabilitiesOnlySelected}</div>
                    <div class="b3-label__text" data-type="agentCapabilitySelectedCount"></div>
                </div>
                <span class="fn__space"></span>
                <input class="b3-switch" data-type="onlySelectedAgentCapabilities" type="checkbox">
            </label>
            <div class="fn__flex b3-label config-item config-wrap">
                <div class="b3-label__text fn__flex-1">${window.siyuan.languages.agentCapabilitiesAutoApproveTip}</div>
                <span class="fn__space"></span>
                <button class="b3-button b3-button--outline" data-type="enableAllAgentCapabilities">${window.siyuan.languages.agentCapabilitiesEnableAll}</button>
                <span class="fn__space"></span>
                <button class="b3-button b3-button--outline" data-type="disableAllAgentCapabilities">${window.siyuan.languages.agentCapabilitiesDisableAll}</button>
            </div>
        </div>
    </div>
    <div class="config-agent-capability__list" data-type="agentCapabilityList"></div>
</div>
</div>`;
    getCapabilityViewHost(settingRoot).append(view);
    view.getBoundingClientRect();
    view.classList.add("config__view--show");

    const render = () => {
        const list = view.querySelector<HTMLElement>("[data-type='agentCapabilityList']");
        const count = view.querySelector<HTMLElement>("[data-type='agentCapabilitySelectedCount']");
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
            return `<section class="config-group" data-capability-group="${groupIndex}">
    <div class="config-title config-title--action">
        <span>${escapeHtml(label)} (${items.length})</span>
        <span class="fn__flex-1"></span>
        <button class="b3-button b3-button--outline" data-type="toggleAgentCapabilityGroup" data-group-index="${groupIndex}">${groupEnabled ? window.siyuan.languages.agentCapabilitiesDisableAll : window.siyuan.languages.selectAll}</button>
    </div>
    <div class="config-items">
        ${items.map((capability) => {
            const actions = capability.actions || [];
            const opened = expanded.has(capability.id);
            return `<div class="b3-label config-item" data-capability-id="${escapeAttribute(capability.id)}">
    <div class="fn__flex config-wrap">
        <div class="fn__flex-1 config-agent-capability__main">
            <div class="config-name">${escapeHtml(capability.title || capability.name)}</div>
            ${capability.description ? `<div class="b3-label__text config-agent-capability__description" title="${escapeAttribute(capability.description)}">${escapeHtml(capability.description)}</div>` : ""}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch" data-type="toggleAgentCapability" type="checkbox" aria-label="${escapeAttribute(capability.title || capability.name)}"${isCapabilityAllowed(capability.id) ? " checked" : ""}>
        <button class="block__icon block__icon--show config-agent-capability__expand" data-type="toggleAgentCapabilityActions" aria-label="${escapeAttribute(window.siyuan.languages.agentCapabilitiesActions)}"><svg style="transform:rotate(${opened ? "90deg" : "0"});"><use xlink:href="#iconRight"></use></svg></button>
    </div>
    ${opened ? `<div class="config-agent-capability__details">
        <div class="fn__hr"></div>
        <div class="b3-label b3-label--inner">
            <div class="b3-label__text"><code>${escapeHtml(capability.id)}</code></div>
        </div>
        <label class="fn__flex b3-label b3-label--inner config-wrap">
            <div class="fn__flex-1">
                <div class="config-name">${window.siyuan.languages.agentCapabilitiesAutoApprove}</div>
                <div class="b3-label__text">${window.siyuan.languages.agentCapabilitiesAutoApproveTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" data-type="toggleAgentCapabilityApproval" type="checkbox"${isCapabilityAutoApproved(capability.id) ? " checked" : ""}>
        </label>
        ${actions.length > 0 ? `<div class="b3-label b3-label--inner config-name">${window.siyuan.languages.agentCapabilitiesActions}</div>
        ${actions.map((action) => `<label class="fn__flex b3-label b3-label--inner config-wrap">
        <code class="fn__flex-1">${escapeHtml(action.name)}</code>
        <span class="fn__space"></span>
        <input class="b3-switch" data-type="toggleAgentCapabilityActionApproval" data-capability-action="${escapeAttribute(action.name)}" type="checkbox"${isCapabilityAutoApproved(capability.id, action.name) ? " checked" : ""}>
    </label>`).join("")}` : ""}
    </div>` : ""}
</div>`;
        }).join("")}
    </div>
</section>`;
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
    };

    view.querySelector<HTMLInputElement>("[data-type='searchAgentCapabilities']")?.addEventListener("input", (event) => {
        query = (event.target as HTMLInputElement).value;
        render();
    });
    view.querySelector<HTMLInputElement>("[data-type='onlySelectedAgentCapabilities']")?.addEventListener("change", (event) => {
        onlySelected = (event.target as HTMLInputElement).checked;
        render();
    });
    view.addEventListener("change", (event) => {
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
    view.addEventListener("click", (event) => {
        const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (action?.dataset.action === "back") {
            removeAgentCapabilityView(settingRoot, view);
            return;
        }
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
    view.querySelector<HTMLInputElement>("[data-type='searchAgentCapabilities']")?.focus();
};

const loadCapabilities = (callback: (capabilities: ICapabilityInfo[]) => void) => {
    fetchPost("/api/ai/agent/lsCapabilities", {}, (response) => {
        const capabilities = getAllCapabilities((response.data || []) as ICapabilityInfo[]);
        addUnavailableCapabilities(capabilities);
        callback(capabilities);
    });
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

export const mountAgentCapabilityBlock = (root: HTMLElement) => {
    root.querySelector("#aiAgentCapabilities")?.addEventListener("click", () => {
        loadCapabilities((capabilities) => openAgentCapabilityView(root, capabilities));
    });
};
