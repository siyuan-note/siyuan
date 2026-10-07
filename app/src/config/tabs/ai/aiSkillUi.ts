import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchPost} from "../../../util/fetch";
import {aiConfigApi} from "./aiRuntime";
import {setBuiltinSkillEnabled, setUserSkillEnabled} from "./aiSkillState";

interface IUserSkillInfo {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    shadowed?: boolean;
    version?: string;
    source?: string;
}

const escapeAttribute = (value: string) => escapeAttr(escapeHtml(value));

export const getUserSkillsBlockKeywords = (): string[] => [
    window.siyuan.languages.agentUserSkills,
    window.siyuan.languages.agentUserSkillsTip,
    window.siyuan.languages.agentUserSkillsEmpty,
    window.siyuan.languages.agentUserSkillShadowed,
];

export const getBuiltinSkillsBlockKeywords = (): string[] => [
    window.siyuan.languages.agentBuiltinSkills,
    window.siyuan.languages.agentBuiltinSkillsTip,
];

const skillViewTitle = (builtin: boolean) => builtin ? window.siyuan.languages.agentBuiltinSkills : window.siyuan.languages.agentUserSkills;

const ensureUserSkillsView = (root: HTMLElement) => {
    const host = root.closest<HTMLElement>(".config__panel") || root;
    const existing = Array.from(host.children).find((element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("config-agent-user-skills__view"));
    if (existing) {
        return existing;
    }
    const view = document.createElement("div");
    view.className = "config-agent-user-skills__view config__view";
    host.append(view);
    return view;
};

const closeUserSkillsView = (view: HTMLElement) => {
    view.classList.remove("config__view--show");
    delete view.dataset.skillViewRequest;
};

const showUserSkillsLoading = (root: HTMLElement, builtin: boolean) => {
    const view = ensureUserSkillsView(root);
    view.innerHTML = `<div class="b3-dialog__header fn__flex">
    <div class="block__logo fn__pointer fn__flex-1" data-action="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
        <span class="ft__breakword">${escapeHtml(skillViewTitle(builtin))}</span>
    </div>
</div>
<div class="b3-dialog__body fn__flex-1 fn__flex-center">
    <img src="/stage/loading-pure.svg" style="height:64px;width:64px;">
</div>`;
    view.onchange = null;
    view.onclick = (event) => {
        if ((event.target as HTMLElement).closest<HTMLElement>("[data-action='back']")) {
            closeUserSkillsView(view);
        }
    };
    view.classList.add("config__view--show");
    return view;
};

const renderUserSkills = (root: HTMLElement, skills: IUserSkillInfo[], builtin: boolean) => {
    const list = root.querySelector<HTMLElement>("[data-type='agentUserSkillList']");
    if (!list) {
        return;
    }
    if (skills.length === 0) {
        list.innerHTML = `<div class="b3-label config-item"><div class="b3-label__text">${builtin ? window.siyuan.languages.empty : window.siyuan.languages.agentUserSkillsEmpty}</div></div>`;
        return;
    }
    list.innerHTML = `${skills.map((skill) => {
        const description = builtin && skill.id === "builtin:siyuan-plugin-development" ?
            window.siyuan.languages.agentBuiltinPluginDevelopmentDescription || skill.description : skill.description;
        return `<label class="fn__flex b3-label config-item" data-user-skill-id="${escapeAttribute(skill.id)}">
    <div class="fn__flex-1">
        <div class="config-name">${escapeHtml(skill.name)}</div>
        ${description ? `<div class="b3-label__text">${escapeHtml(description)}</div>` : ""}
        <div class="b3-label__text"><code>${builtin ? `${escapeHtml(skill.id)} · ${escapeHtml(skill.version || "")}` : `~/.agents/skills/${escapeHtml(skill.id)}`}</code>${skill.shadowed ? ` · ${window.siyuan.languages.agentUserSkillShadowed}` : ""}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch" data-type="toggleAgentUserSkill" type="checkbox" aria-label="${escapeAttribute(skill.name)}"${skill.enabled ? " checked" : ""}>
</label>`;
    }).join("")}`;
};

const openUserSkillsView = (settingRoot: HTMLElement, skills: IUserSkillInfo[], builtin: boolean, request: string) => {
    const view = ensureUserSkillsView(settingRoot);
    view.innerHTML = `<div class="b3-dialog__header fn__flex">
    <div class="block__logo fn__pointer fn__flex-1" data-action="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
        <span class="ft__breakword">${escapeHtml(skillViewTitle(builtin))}</span>
    </div>
</div>
<div class="b3-dialog__body fn__flex-1">
        <div class="b3-dialog__content config-agent-user-skills__content">
            <section class="config-group">
                <div class="config-items">
                    <div class="b3-label config-item"><div class="b3-label__text">${builtin ? window.siyuan.languages.agentBuiltinSkillsTip : window.siyuan.languages.agentUserSkillsTip}</div></div>
                </div>
            </section>
            <section class="config-group">
                <div class="config-items" data-type="agentUserSkillList"></div>
            </section>
        </div>
    </div>`;
    view.onchange = (event) => {
        const input = event.target as HTMLInputElement;
        if (input.dataset.type !== "toggleAgentUserSkill" || input.disabled) {
            return;
        }
        const id = input.closest<HTMLElement>("[data-user-skill-id]")?.dataset.userSkillId;
        if (!id) {
            return;
        }
        view.querySelectorAll<HTMLInputElement>("input.b3-switch").forEach(item => item.disabled = true);
        const config = window.siyuan.config.ai.agent.skills;
        const selected = builtin ? (config?.builtinDisabled || []) : (config?.userEnabled || []);
        const next = builtin ? setBuiltinSkillEnabled(selected, id, input.checked) : setUserSkillEnabled(selected, id, input.checked);
        const refresh = () => {
            if (!view.isConnected || view.dataset.skillViewRequest !== request) {
                return;
            }
            const saved = window.siyuan.config.ai.agent.skills;
            const enabled = new Set((saved?.userEnabled || []).map(item => item.toLowerCase()));
            const disabled = new Set(saved?.builtinDisabled || []);
            skills.forEach((skill) => {
                skill.enabled = builtin ? !disabled.has(skill.id) : enabled.has(skill.id.toLowerCase());
            });
            renderUserSkills(view, skills, builtin);
        };
        aiConfigApi.patch(builtin ? "agent.skills.builtinDisabled" : "agent.skills.userEnabled", next).then(refresh, refresh);
    };
    view.onclick = (event) => {
        if ((event.target as HTMLElement).closest<HTMLElement>("[data-action='back']")) {
            closeUserSkillsView(view);
        }
    };
    renderUserSkills(view, skills, builtin);
    view.classList.add("config__view--show");
};

let skillViewRequest = 0;

const mountSkillsBlock = (root: HTMLElement, builtin: boolean) => {
    ensureUserSkillsView(root);
    root.querySelector(builtin ? "#aiBuiltinSkills" : "#aiUserSkills")?.addEventListener("click", () => {
        const view = showUserSkillsLoading(root, builtin);
        const request = String(++skillViewRequest);
        view.dataset.skillViewRequest = request;
        let completed = false;
        const loaded = (skills: IUserSkillInfo[]) => {
            completed = true;
            if (view.isConnected && view.classList.contains("config__view--show") && view.dataset.skillViewRequest === request) {
                openUserSkillsView(root, skills, builtin, request);
            }
        };
        const finished = () => {
            if (!completed && view.dataset.skillViewRequest === request) {
                closeUserSkillsView(view);
            }
        };
        if (builtin) {
            void fetchPost("/api/ai/agent/lsBuiltinSkills", {}, response => loaded(response.data || [])).finally(finished);
        } else {
            void fetchPost("/api/ai/agent/lsUserSkills", {}, response => loaded(response.data || [])).finally(finished);
        }
    });
};

export const mountUserSkillsBlock = (root: HTMLElement) => mountSkillsBlock(root, false);

export const mountBuiltinSkillsBlock = (root: HTMLElement) => mountSkillsBlock(root, true);
