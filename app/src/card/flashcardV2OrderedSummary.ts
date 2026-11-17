export type OrderedSummaryBlock = {text: string, marks: Map<string, string>};
export type OrderedSummaryStep = {id: string, displayOrder: number, occlusionIDs: string[]};
export type OrderedSummaryReference = {entityType: string, entityID: string, role: string};

// 仅解析惰性模板，绝不挂载正文节点或执行正文中的资源。
export const readOrderedSummaryBlock = (html: string, owner: Document = document): OrderedSummaryBlock => {
    const template = owner.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("script,style,iframe,object,embed,audio,video,input,button,textarea,select,.protyle-attr,.protyle-action")
        .forEach(element => element.remove());
    const readable = (node: Node): string => {
        if (node.nodeType === 3) { return node.textContent || ""; }
        if (node.nodeType !== 1 && node.nodeType !== 11) { return ""; }
        if (node.nodeType === 1) {
            const element = node as Element;
            if (element.tagName === "IMG") { return element.getAttribute("alt") || ""; }
            if ((element.getAttribute("data-type") || "").split(/\s+/).some(type =>
                type === "inline-math" || type === "math" || type === "NodeMathBlock") || element.getAttribute("data-subtype") === "math") {
                return element.getAttribute("data-content") || element.querySelector("[data-content]")?.getAttribute("data-content") || "";
            }
            if (element.tagName === "BR") { return " "; }
        }
        const text = Array.from(node.childNodes).map(readable).join("");
        return node.nodeType === 1 && /^(DIV|P|LI|UL|OL|BLOCKQUOTE|H[1-6]|TR|TD|TH)$/.test((node as Element).tagName) ? ` ${text} ` : text;
    };
    const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
    const marks = new Map<string, string>();
    template.content.querySelectorAll("span[data-occlusion-id]").forEach(element => {
        if (!(element.getAttribute("data-type") || "").split(/\s+/).includes("mark")) { return; }
        const id = element.getAttribute("data-occlusion-id");
        if (!id) { return; }
        let ancestor = element.parentElement;
        while (ancestor) {
            if (ancestor.getAttribute("data-occlusion-id") === id &&
                (ancestor.getAttribute("data-type") || "").split(/\s+/).includes("mark")) { return; }
            ancestor = ancestor.parentElement;
        }
        marks.set(id, (marks.get(id) || "") + readable(element));
    });
    marks.forEach((text, id) => marks.set(id, normalize(text)));
    return {text: normalize(readable(template.content)), marks};
};

// 无法唯一辨认步骤时拒绝排序，不用编号或猜测的内容替代。
export const resolveOrderedSummaries = (steps: OrderedSummaryStep[], references: OrderedSummaryReference[],
    blocks: Map<string, OrderedSummaryBlock>): Array<{id: string, text: string}> | undefined => {
    if (!steps.length || steps.length > 1000 || new Set(steps.map(step => step.id)).size !== steps.length ||
        references.some(ref => ref.entityType !== "block" || !blocks.has(ref.entityID))) { return; }
    const ids = [...new Set(references.map(ref => ref.entityID))];
    const result: Array<{id: string, text: string}> = [];
    for (const step of [...steps].sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))) {
        if (!step.id || !Number.isFinite(step.displayOrder) || !step.occlusionIDs.length ||
            new Set(step.occlusionIDs).size !== step.occlusionIDs.length) { return; }
        const texts: string[] = [];
        for (const occlusion of step.occlusionIDs) {
            const matching = [...new Set(references.filter(ref => ref.role === `occlusion:${occlusion}`).map(ref => ref.entityID))];
            const inline = ids.filter(id => blocks.get(id).marks.has(occlusion));
            if (matching.length > 1 || (matching.length && inline.length) || (!matching.length && inline.length !== 1)) { return; }
            const text = matching.length ? blocks.get(matching[0]).text : blocks.get(inline[0]).marks.get(occlusion);
            if (!text?.trim()) { return; }
            texts.push(text);
        }
        result.push({id: step.id, text: texts.join(" / ")});
    }
    return result;
};
