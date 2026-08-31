import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchPost} from "../../../util/fetch";
import {aiConfigApi} from "./aiRuntime";
import {setUserSkillEnabled} from "./aiSkillState";

interface IUserSkillInfo {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    shadowed: boolean;
}

const escapeAttribute = (value: string) => escapeAttr(escapeHtml(value));

export const getUserSkillsBlockKeywords = (): string[] => [
    window.siyuan.languages.agentUserSkills,
    window.siyuan.languages.agentUserSkillsTip,
    window.siyuan.languages.agentUserSkillsEmpty,
    window.siyuan.languages.agentUserSkillShadowed,
];

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
};

const showUserSkillsLoading = (root: HTMLElement) => {
    const view = ensureUserSkillsView(root);
    view.innerHTML = `<div class="b3-dialog__header fn__flex">
    <div class="block__logo fn__pointer fn__flex-1" data-action="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
        <span class="ft__breakword">${escapeHtml(window.siyuan.languages.agentUserSkills)}</span>
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

const renderUserSkills = (root: HTMLElement, skills: IUserSkillInfo[]) => {
    const list = root.querySelector<HTMLElement>("[data-type='agentUserSkillList']");
    if (!list) {
        return;
    }
    if (skills.length === 0) {
        list.innerHTML = `<div class="b3-label config-item"><div class="b3-label__text">${window.siyuan.languages.agentUserSkillsEmpty}</div></div>`;
        return;
    }
    list.innerHTML = `${skills.map((skill) => `<label class="fn__flex b3-label config-item" data-user-skill-id="${escapeAttribute(skill.id)}">
    <div class="fn__flex-1">
        <div class="config-name">${escapeHtml(skill.name)}</div>
        ${skill.description ? `<div class="b3-label__text">${escapeHtml(skill.description)}</div>` : ""}
        <div class="b3-label__text"><code>~/.agents/skills/${escapeHtml(skill.id)}</code>${skill.shadowed ? ` · ${window.siyuan.languages.agentUserSkillShadowed}` : ""}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch" data-type="toggleAgentUserSkill" type="checkbox" aria-label="${escapeAttribute(skill.name)}"${skill.enabled ? " checked" : ""}>
</label>`).join("")}`;
};

const openUserSkillsView = (settingRoot: HTMLElement, skills: IUserSkillInfo[]) => {
    const view = ensureUserSkillsView(settingRoot);
    view.innerHTML = `<div class="b3-dialog__header fn__flex">
    <div class="block__logo fn__pointer fn__flex-1" data-action="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
        <span class="ft__breakword">${escapeHtml(window.siyuan.languages.agentUserSkills)}</span>
    </div>
</div>
<div class="b3-dialog__body fn__flex-1">
        <div class="b3-dialog__content config-agent-user-skills__content">
            <section class="config-group">
                <div class="config-items">
                    <div class="b3-label config-item"><div class="b3-label__text">${window.siyuan.languages.agentUserSkillsTip}</div></div>
                </div>
            </section>
            <section class="config-group">
                <div class="config-items" data-type="agentUserSkillList"></div>
            </section>
        </div>
    </div>`;
    view.onchange = (event) => {
        const input = event.target as HTMLInputElement;
        if (input.dataset.type !== "toggleAgentUserSkill") {
            return;
        }
        const id = input.closest<HTMLElement>("[data-user-skill-id]")?.dataset.userSkillId;
        if (!id) {
            return;
        }
        const selected = window.siyuan.config.ai.agent.skills?.userEnabled || [];
        aiConfigApi.patch("agent.skills.userEnabled", setUserSkillEnabled(selected, id, input.checked), (data) => {
            const enabled = new Set(data.agent.skills.userEnabled.map((item) => item.toLowerCase()));
            skills.forEach((skill) => {
                skill.enabled = enabled.has(skill.id.toLowerCase());
            });
            renderUserSkills(view, skills);
        });
    };
    view.onclick = (event) => {
        if ((event.target as HTMLElement).closest<HTMLElement>("[data-action='back']")) {
            closeUserSkillsView(view);
        }
    };
    renderUserSkills(view, skills);
    view.classList.add("config__view--show");
};

const loadUserSkills = (callback: (skills: IUserSkillInfo[]) => void) => {
    fetchPost("/api/ai/agent/lsUserSkills", {}, (response) => {
        callback((response.data || []) as IUserSkillInfo[]);
    });
};

export const mountUserSkillsBlock = (root: HTMLElement) => {
    ensureUserSkillsView(root);
    root.querySelector("#aiUserSkills")?.addEventListener("click", () => {
        const view = showUserSkillsLoading(root);
        loadUserSkills((skills) => {
            if (view.classList.contains("config__view--show")) {
                openUserSkillsView(root, skills);
            }
        });
    });
};
