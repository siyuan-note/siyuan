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
];

export const genUserSkillsBlockHtml = (): string => `<div class="b3-label config-item" id="aiUserSkillsBlock">
    <div class="config-name">${window.siyuan.languages.agentUserSkills}</div>
    <div class="b3-label__text">${window.siyuan.languages.agentUserSkillsTip}</div>
    <div class="fn__hr--small"></div>
    <div id="aiUserSkillsList" class="fn__loading"><img width="64px" src="/stage/loading-pure.svg"></div>
</div>`;

const renderUserSkills = (root: HTMLElement, skills: IUserSkillInfo[]) => {
    const list = root.querySelector<HTMLElement>("#aiUserSkillsList");
    if (!list) {
        return;
    }
    list.classList.remove("fn__loading");
    if (skills.length === 0) {
        list.innerHTML = `<div class="b3-label__text">${window.siyuan.languages.agentUserSkillsEmpty}</div>`;
        return;
    }
    list.innerHTML = `<div class="config-items">${skills.map((skill) => `<label class="fn__flex b3-label b3-label--inner config-wrap" data-user-skill-id="${escapeAttribute(skill.id)}">
    <div class="fn__flex-1">
        <div class="config-name">${escapeHtml(skill.name)}</div>
        ${skill.description ? `<div class="b3-label__text">${escapeHtml(skill.description)}</div>` : ""}
        <div class="b3-label__text"><code>~/.agents/skills/${escapeHtml(skill.id)}</code>${skill.shadowed ? ` · ${window.siyuan.languages.agentUserSkillShadowed}` : ""}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch" data-type="toggleAgentUserSkill" type="checkbox" aria-label="${escapeAttribute(skill.name)}"${skill.enabled ? " checked" : ""}>
</label>`).join("")}</div>`;
};

const loadUserSkills = (root: HTMLElement) => {
    fetchPost("/api/ai/agent/lsUserSkills", {}, (response) => {
        renderUserSkills(root, (response.data || []) as IUserSkillInfo[]);
    });
};

export const mountUserSkillsBlock = (root: HTMLElement) => {
    const block = root.querySelector<HTMLElement>("#aiUserSkillsBlock");
    if (!block) {
        return;
    }
    block.addEventListener("change", (event) => {
        const input = event.target as HTMLInputElement;
        if (input.dataset.type !== "toggleAgentUserSkill") {
            return;
        }
        const id = input.closest<HTMLElement>("[data-user-skill-id]")?.dataset.userSkillId;
        if (!id) {
            return;
        }
        const selected = window.siyuan.config.ai.agent.skills?.userEnabled || [];
        aiConfigApi.patch("agent.skills.userEnabled", setUserSkillEnabled(selected, id, input.checked), () => {
            loadUserSkills(root);
        });
    });
    loadUserSkills(root);
};
