export const AGENT_SKILL_SELECTOR = '[data-type~="text"][custom-agent-skill="true"]';

export const normalizeAgentSkills = (element: ParentNode) => {
    // 渲染、撤销和草稿恢复后继续将技能视为整体，兼容已有的技能标记。
    element.querySelectorAll<HTMLElement>(AGENT_SKILL_SELECTOR).forEach(skill => {
        skill.contentEditable = "false";
    });
};

export const expandAgentSkillSelection = (range: Range) => {
    const getSkill = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)
        ?.closest(AGENT_SKILL_SELECTOR);
    const start = getSkill(range.startContainer);
    const end = getSkill(range.endContainer);
    if (range.collapsed) {
        if (start) {
            range.setStartAfter(start);
            range.collapse(true);
        }
        return;
    }
    // 触摸选区或全选可能落在不可编辑元素内部，替换、剪切时将边界扩展至整个技能。
    if (start) {
        range.setStartBefore(start);
    }
    if (end) {
        range.setEndAfter(end);
    }
};
