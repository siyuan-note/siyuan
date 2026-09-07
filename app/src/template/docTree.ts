import {escapeHtml} from "../util/escape";

export interface ITemplateDocTreePlan {
    id: string;
    count: number;
    nodes: Array<{
        id: string;
        title: string;
        parentID: string;
        hPath: string;
        depth: number;
    }>;
}

export const genTemplateDocTreePlanHTML = (plan: ITemplateDocTreePlan, label: string) => {
    const itemsHTML = plan.nodes.map((item) => {
        const depth = Number.isFinite(item.depth) ? Math.min(32, Math.max(0, Math.trunc(item.depth))) : 0;
        return `<li class="b3-list-item" style="padding-left: ${depth * 18 + 4}px">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
    <span class="b3-list-item__text">${escapeHtml(item.title)}</span>
</li>`;
    }).join("");
    const count = Number.isFinite(plan.count) ? Math.max(0, Math.trunc(plan.count)) : plan.nodes.length;
    return `<div class="fn__flex">
    <span class="fn__flex-1">${escapeHtml(label)}</span>
    <span class="counter">${count}</span>
</div>
<ul class="b3-list b3-list--background" style="max-height: 50vh; overflow: auto">${itemsHTML}</ul>`;
};
