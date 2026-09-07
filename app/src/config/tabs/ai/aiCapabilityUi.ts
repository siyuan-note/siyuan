import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchPost} from "../../../util/fetch";
import {listCapabilityManifests} from "../../../layout/dock/agent/frontendCapabilities";
import {
    AgentActionApprovalDecision,
    AgentApprovalDecision,
    getCapabilityActionApproval,
    resolveCapabilityApproval,
    updateCapabilityActionApproval,
    updateCapabilityApproval,
} from "./aiCapabilityPolicy";
import {aiConfigApi} from "./aiRuntime";

type CapabilityDecision = "allow" | "deny";
type CapabilityScope = "agent" | "mcp";

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
    agentOnly?: boolean;
    available: boolean;
    actions?: ICapabilityActionInfo[];
}

const getCapabilityPolicy = (scope: CapabilityScope): Config.ICapabilityPolicy => {
    if (scope === "mcp") {
        return window.siyuan.config.ai.mcp.exposurePolicy || {default: "allow", overrides: {}};
    }
    return window.siyuan.config.ai.agent.capabilityPolicy || {default: "allow", overrides: {}};
};

const getApprovalPolicy = (): Config.IAgent["approvalPolicy"] =>
    window.siyuan.config.ai.agent.approvalPolicy || {default: "risk", overrides: {}};

const isCapabilityAllowed = (id: string, scope: CapabilityScope, policy = getCapabilityPolicy(scope)) =>
    (policy.overrides[id] || policy.default) === "allow";

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

const getAllCapabilities = (backend: ICapabilityInfo[], scope: CapabilityScope): ICapabilityInfo[] => {
    if (scope === "mcp") {
        return backend.filter((capability) => !capability.agentOnly && capability.source !== "mcp" &&
            capability.runtime !== "mcp").sort((a, b) => {
            const group = getGroupLabel(a).localeCompare(getGroupLabel(b));
            return group || a.id.localeCompare(b.id);
        });
    }
    const frontend = listCapabilityManifests().map((capability): ICapabilityInfo => ({
        id: capability.id,
        name: capability.id.split("/").at(-1) || capability.id,
        title: capability.title,
        description: capability.description,
        source: capability.source,
        ownerId: capability.ownerId,
        ownerName: capability.ownerName,
        runtime: "browser",
        available: true,
        actions: getManifestActions(capability),
    }));
    return [...backend, ...frontend].sort((a, b) => {
        const group = getGroupLabel(a).localeCompare(getGroupLabel(b));
        return group || a.id.localeCompare(b.id);
    });
};

const addUnavailableCapabilities = (capabilities: ICapabilityInfo[], scope: CapabilityScope) => {
    const knownIDs = new Set(capabilities.map((capability) => capability.id));
    const configuredIDs = new Set(Object.keys(getCapabilityPolicy(scope).overrides));
    if (scope === "agent") {
        Object.keys(getApprovalPolicy().overrides).forEach((id) => configuredIDs.add(id));
    }
    configuredIDs.forEach((id) => {
        if (!knownIDs.has(id)) {
            capabilities.push({
                id,
                name: id,
                description: "",
                source: "native",
                runtime: "kernel",
                available: false,
                actions: [],
            });
        }
    });
};

const saveCapabilityPolicy = (scope: CapabilityScope, policy: Config.ICapabilityPolicy, onApplied: () => void) => {
    const path = scope === "agent" ? "agent.capabilityPolicy" : "mcp.exposurePolicy";
    aiConfigApi.patch(path, policy, onApplied);
};

const saveApprovalPolicy = (policy: Config.IAgent["approvalPolicy"], onApplied: () => void) => {
    aiConfigApi.patch("agent.approvalPolicy", policy, onApplied);
};

const setCapabilitiesDecision = (scope: CapabilityScope, ids: string[], decision: CapabilityDecision,
                                  onApplied: () => void) => {
    const policy = getCapabilityPolicy(scope);
    const overrides = {...policy.overrides};
    ids.forEach((id) => {
        if (decision === policy.default) {
            delete overrides[id];
        } else {
            overrides[id] = decision;
        }
    });
    saveCapabilityPolicy(scope, {...policy, overrides}, onApplied);
};

const setCapabilityApproval = (id: string, decision: AgentApprovalDecision, onApplied: () => void) => {
    const policy = getApprovalPolicy();
    saveApprovalPolicy(updateCapabilityApproval(policy, id, decision), onApplied);
};

const setCapabilityActionApproval = (id: string, action: string, decision: AgentActionApprovalDecision,
                                     onApplied: () => void) => {
    const policy = getApprovalPolicy();
    saveApprovalPolicy(updateCapabilityActionApproval(policy, id, action, decision), onApplied);
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
    root.closest<HTMLElement>(".config__panel") || root;

const ensureAgentCapabilityView = (root: HTMLElement) => {
    const host = getCapabilityViewHost(root);
    const existing = Array.from(host.children).find((element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("config-agent-capability__view"));
    if (existing) {
        return existing;
    }
    const view = document.createElement("div");
    view.className = "config-agent-capability__view config__view";
    host.append(view);
    return view;
};

const closeAgentCapabilityView = (view: HTMLElement) => {
    view.classList.remove("config__view--show");
};

const showAgentCapabilityLoading = (root: HTMLElement) => {
    const view = ensureAgentCapabilityView(root);
    view.innerHTML = `<div class="b3-dialog__header fn__flex">
    <div class="block__logo fn__pointer fn__flex-1" data-action="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
        <span class="ft__breakword">${escapeHtml(window.siyuan.languages.agentCapabilities)}</span>
    </div>
</div>
<div class="b3-dialog__body fn__flex-1 fn__flex-center">
    <img src="/stage/loading-pure.svg" style="height:64px;width:64px;">
</div>`;
    view.onchange = null;
    view.onclick = (event) => {
        if ((event.target as HTMLElement).closest<HTMLElement>("[data-action='back']")) {
            closeAgentCapabilityView(view);
        }
    };
    view.classList.add("config__view--show");
    return view;
};

const openAgentCapabilityView = (settingRoot: HTMLElement, backendCapabilities: ICapabilityInfo[]) => {
    const expanded = new Set<string>();
    let query = "";
    let onlySelected = false;
    let scope: CapabilityScope = "agent";
    const view = ensureAgentCapabilityView(settingRoot);
    view.innerHTML = `<div class="b3-dialog__header fn__flex">
    <div class="block__logo fn__pointer fn__flex-1" data-action="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
        <span class="ft__breakword">${escapeHtml(window.siyuan.languages.agentCapabilities)}</span>
    </div>
</div>
<div class="b3-dialog__body fn__flex-1" style="overflow:hidden;">
<div class="layout-tab-bar fn__flex">
    <div class="item item--full item--focus" data-capability-scope="agent"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.agentCapabilitiesScopeAgent}</span><span class="fn__flex-1"></span></div>
    <div class="item item--full" data-capability-scope="mcp"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.agentCapabilitiesScopeMcp}</span><span class="fn__flex-1"></span></div>
</div>
<div class="b3-dialog__content config-agent-capability__content">
    <div class="config-group config-agent-capability__controls">
        <div class="config-items">
            <div class="b3-label config-item">
                <div class="b3-label__text" data-type="agentCapabilityDialogTip"></div>
                <div class="fn__hr--small"></div>
                <div class="b3-form__icon">
                    <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
                    <input class="b3-text-field b3-form__icon-input fn__block" data-type="searchAgentCapabilities" placeholder="${escapeAttribute(window.siyuan.languages.agentCapabilitiesSearch)}">
                </div>
            </div>
            <label class="fn__flex b3-label config-item">
                <div class="fn__flex-1">
                    <div class="config-name">${window.siyuan.languages.agentCapabilitiesOnlySelected}</div>
                    <div class="b3-label__text" data-type="agentCapabilitySelectedCount"></div>
                </div>
                <span class="fn__space"></span>
                <input class="b3-switch" data-type="onlySelectedAgentCapabilities" type="checkbox">
            </label>
        </div>
    </div>
    <div class="config-agent-capability__list" data-type="agentCapabilityList"></div>
</div>
</div>`;
    view.classList.add("config__view--show");

    const render = () => {
        const capabilities = getAllCapabilities(backendCapabilities, scope);
        const approvalPolicy = getApprovalPolicy();
        addUnavailableCapabilities(capabilities, scope);
        const list = view.querySelector<HTMLElement>("[data-type='agentCapabilityList']");
        const count = view.querySelector<HTMLElement>("[data-type='agentCapabilitySelectedCount']");
        const tip = view.querySelector<HTMLElement>("[data-type='agentCapabilityDialogTip']");
        if (!list || !count || !tip) {
            return;
        }
        tip.textContent = scope === "agent"
            ? window.siyuan.languages.agentCapabilitiesDialogTip
            : window.siyuan.languages.agentCapabilitiesMcpExposureTip;
        view.querySelectorAll<HTMLElement>("[data-capability-scope]").forEach((item) => {
            item.classList.toggle("item--focus", item.dataset.capabilityScope === scope);
        });
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const visible = capabilities.filter((capability) =>
            (!onlySelected || isCapabilityAllowed(capability.id, scope)) && capabilityMatches(capability, normalizedQuery));
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
            const groupEnabled = items.every((capability) => isCapabilityAllowed(capability.id, scope));
            return `<section class="config-group" data-capability-group="${groupIndex}">
    <div class="config-title config-title--action">
        <span>${escapeHtml(label)}</span>
        <span class="fn__space--small"></span>
        <span class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${escapeAttribute(window.siyuan.languages.total)}">${items.length}</span>
        <span class="fn__flex-1"></span>
        <button class="b3-button b3-button--outline" data-type="toggleAgentCapabilityGroup" data-group-index="${groupIndex}">${groupEnabled ? window.siyuan.languages.agentCapabilitiesDisableAll : window.siyuan.languages.agentCapabilitiesEnableAll}</button>
    </div>
    <div class="config-items">
        ${items.map((capability) => {
            const actions = capability.actions || [];
            const opened = scope === "agent" && expanded.has(capability.id);
            return `<div class="b3-label config-item" data-capability-id="${escapeAttribute(capability.id)}">
    <div class="fn__flex">
        ${scope === "agent" ? `<button class="block__icon block__icon--show config-agent-capability__expand" data-type="toggleAgentCapabilityActions" aria-label="${escapeAttribute(window.siyuan.languages.config)}"><svg style="transform:rotate(${opened ? "90deg" : "0"});"><use xlink:href="#iconRight"></use></svg></button>` : ""}
        <div class="fn__flex-1 config-agent-capability__main">
            <div class="config-name">${escapeHtml(capability.title || capability.name)}</div>
            ${capability.description ? `<div class="b3-label__text config-agent-capability__description" title="${escapeAttribute(capability.description)}">${escapeHtml(capability.description)}</div>` : ""}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch" data-type="toggleAgentCapability" type="checkbox" aria-label="${escapeAttribute(capability.title || capability.name)}"${isCapabilityAllowed(capability.id, scope) ? " checked" : ""}>
    </div>
    ${opened ? `<div class="config-agent-capability__details">
        <div class="fn__hr"></div>
        <div class="b3-label b3-label--inner">
            <div class="b3-label__text"><code>${escapeHtml(capability.id)}</code></div>
        </div>
        <label class="fn__flex b3-label b3-label--inner">
            <span class="fn__flex-1">${window.siyuan.languages.agentCapabilitiesCapabilityApprovalMode}</span>
            <span class="fn__space"></span>
            <select class="b3-select" data-type="toggleAgentCapabilityApproval">
                <option value="risk"${resolveCapabilityApproval(approvalPolicy, capability.id) === "risk" ? " selected" : ""}>${window.siyuan.languages.agentCapabilitiesRiskConfirm}</option>
                <option value="confirm"${resolveCapabilityApproval(approvalPolicy, capability.id) === "confirm" ? " selected" : ""}>${window.siyuan.languages.agentPermissionConfirm}</option>
                <option value="allow"${resolveCapabilityApproval(approvalPolicy, capability.id) === "allow" ? " selected" : ""}>${window.siyuan.languages.agentCapabilitiesAutoApprove}</option>
            </select>
        </label>
        ${actions.length > 0 ? `<div class="b3-label b3-label--inner config-name fn__flex">
            <span class="fn__flex-1">${window.siyuan.languages.agentCapabilitiesActionApprovalMode}</span>
        </div>
        ${actions.map((action) => `<label class="fn__flex b3-label b3-label--inner">
        <code class="fn__flex-1">${escapeHtml(action.name)}</code>
        <span class="fn__space"></span>
        <select class="b3-select" data-type="toggleAgentCapabilityActionApproval" data-capability-action="${escapeAttribute(action.name)}">
            <option value=""${getCapabilityActionApproval(approvalPolicy, capability.id, action.name) === "" ? " selected" : ""}>${window.siyuan.languages.agentCapabilitiesFollowCapability}</option>
            <option value="risk"${getCapabilityActionApproval(approvalPolicy, capability.id, action.name) === "risk" ? " selected" : ""}>${window.siyuan.languages.agentCapabilitiesRiskConfirm}</option>
            <option value="confirm"${getCapabilityActionApproval(approvalPolicy, capability.id, action.name) === "confirm" ? " selected" : ""}>${window.siyuan.languages.agentPermissionConfirm}</option>
            <option value="allow"${getCapabilityActionApproval(approvalPolicy, capability.id, action.name) === "allow" ? " selected" : ""}>${window.siyuan.languages.agentCapabilitiesAutoApprove}</option>
        </select>
    </label>`).join("")}` : ""}
    </div>` : ""}
</div>`;
        }).join("")}
    </div>
</section>`;
        }).join("");
        const selected = capabilities.filter((capability) => isCapabilityAllowed(capability.id, scope)).length;
        count.textContent = window.siyuan.languages.agentCapabilitiesSelected
            .replace("${selected}", String(selected)).replace("${total}", String(capabilities.length));

        const groupEntries = Array.from(groups.values());
        list.querySelectorAll<HTMLElement>("[data-type='toggleAgentCapabilityGroup']").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const items = groupEntries[Number(button.dataset.groupIndex)] || [];
                const decision = items.every((capability) => isCapabilityAllowed(capability.id, scope)) ? "deny" : "allow";
                setCapabilitiesDecision(scope, items.map((capability) => capability.id), decision, onPolicyApplied);
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
    view.onchange = (event) => {
        const input = event.target as HTMLInputElement;
        const type = input.dataset.type;
        const id = input.closest<HTMLElement>("[data-capability-id]")?.dataset.capabilityId;
        if (!id) {
            return;
        }
        if (type === "toggleAgentCapability") {
            setCapabilitiesDecision(scope, [id], input.checked ? "allow" : "deny", onPolicyApplied);
        } else if (scope === "agent" && type === "toggleAgentCapabilityApproval") {
            setCapabilityApproval(id, input.value as AgentApprovalDecision, onPolicyApplied);
        } else if (scope === "agent" && type === "toggleAgentCapabilityActionApproval") {
            const action = input.dataset.capabilityAction;
            if (action !== undefined) {
                setCapabilityActionApproval(id, action, input.value as AgentActionApprovalDecision, onPolicyApplied);
            }
        }
    };
    view.onclick = (event) => {
        const scopeTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-capability-scope]");
        const nextScope = scopeTarget?.dataset.capabilityScope as CapabilityScope | undefined;
        if (nextScope && nextScope !== scope) {
            scope = nextScope;
            expanded.clear();
            render();
            return;
        }
        const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (action?.dataset.action === "back") {
            closeAgentCapabilityView(view);
            return;
        }
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-type]");
        if (!target) {
            return;
        }
        if (target.dataset.type === "toggleAgentCapabilityActions") {
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
    };
    render();
};

const loadCapabilities = (callback: (capabilities: ICapabilityInfo[]) => void) => {
    fetchPost("/api/ai/lsCapabilities", {}, (response) => {
        callback((response.data || []) as ICapabilityInfo[]);
    });
};

export const getAgentCapabilityKeywords = (): string[] => [
    window.siyuan.languages.agentCapabilities,
    window.siyuan.languages.agentCapabilitiesTip,
    window.siyuan.languages.agentCapabilitiesBackend,
    window.siyuan.languages.agentCapabilitiesFrontend,
    window.siyuan.languages.agentCapabilitiesPlugins,
    window.siyuan.languages.agentCapabilitiesMcp,
    window.siyuan.languages.agentCapabilitiesScopeAgent,
    window.siyuan.languages.agentCapabilitiesScopeMcp,
    window.siyuan.languages.agentCapabilitiesMcpExposureTip,
    window.siyuan.languages.agentCapabilitiesCapabilityApprovalMode,
    window.siyuan.languages.agentCapabilitiesActionApprovalMode,
    window.siyuan.languages.agentCapabilitiesFollowCapability,
    window.siyuan.languages.agentCapabilitiesRiskConfirm,
    window.siyuan.languages.agentCapabilitiesAutoApprove,
];

export const mountAgentCapabilityBlock = (root: HTMLElement) => {
    ensureAgentCapabilityView(root);
    root.querySelector("#aiAgentCapabilities")?.addEventListener("click", () => {
        const view = showAgentCapabilityLoading(root);
        loadCapabilities((capabilities) => {
            if (view.classList.contains("config__view--show")) {
                openAgentCapabilityView(root, capabilities);
            }
        });
    });
};
