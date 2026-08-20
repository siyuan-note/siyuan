export const LARGE_LIST_CONTENT_BLOCK_THRESHOLD = 192;

const LIST_VIRTUALIZATION_SCOPE_ATTRIBUTE = "data-list-virtualization-scope";
const EXCLUDED_CONTAINER_TYPES = new Set([
    "NodeList",
    "NodeBlockquote",
    "NodeSuperBlock",
    "NodeCallout",
]);

export interface IListVirtualizationNodeState<T> {
    id?: string;
    type?: string;
    folded?: boolean;
    ignoreSubtree?: boolean;
    children: ArrayLike<T>;
}

export interface IListVirtualizationPlan {
    listID: string;
    excludedItemIDs: string[];
}

// 一次后序遍历同时统计内容块并识别嵌套列表，避免对每个列表重复扫描后代。
export const getListVirtualizationPlans = <T>(
    root: T,
    getState: (node: T) => IListVirtualizationNodeState<T>,
    threshold = LARGE_LIST_CONTENT_BLOCK_THRESHOLD,
) => {
    const plans: IListVirtualizationPlan[] = [];
    const maxCount = threshold + 1;
    const scan = (node: T, state = getState(node)): { count: number, containsList: boolean } => {
        if (state.ignoreSubtree) {
            return {count: 0, containsList: false};
        }

        const counted = state.type?.startsWith("Node") && !EXCLUDED_CONTAINER_TYPES.has(state.type);
        let count = counted ? 1 : 0;
        if (counted && state.folded) {
            return {count, containsList: false};
        }

        let containsList = state.type === "NodeList";
        const excludedItemIDs: string[] = [];
        let hasUnaddressableNestedItem = false;
        for (let i = 0; i < state.children.length; i++) {
            const child = state.children[i];
            const childState = getState(child);
            const childResult = scan(child, childState);
            count = Math.min(maxCount, count + childResult.count);
            containsList ||= childResult.containsList;
            if (state.type === "NodeList" && childState.type === "NodeListItem" && childResult.containsList) {
                if (childState.id) {
                    excludedItemIDs.push(childState.id);
                } else {
                    hasUnaddressableNestedItem = true;
                }
            }
        }
        if (state.type === "NodeList" && state.id && count > threshold && !hasUnaddressableNestedItem) {
            plans.push({
                listID: state.id,
                excludedItemIDs,
            });
        }
        return {count, containsList};
    };
    scan(root);
    return plans;
};

const getElementState = (element: Element): IListVirtualizationNodeState<Element> => ({
    id: element.getAttribute("data-node-id") || undefined,
    type: element.hasAttribute("data-node-id") ? element.getAttribute("data-type") : undefined,
    folded: element.getAttribute("fold") === "1",
    ignoreSubtree: element.classList.contains("protyle-wysiwyg__embed"),
    children: element.children,
});

const escapeCSSAttributeValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// 样式放在块 DOM 之外，保证序列化、事务和插件读取到的仍是完整内容。
export const buildLargeListVirtualizationStyle = (scope: string, plans: Iterable<IListVirtualizationPlan>) => {
    const escapedScope = escapeCSSAttributeValue(scope);
    const selectorPrefix = `[${LIST_VIRTUALIZATION_SCOPE_ATTRIBUTE}="${escapedScope}"] > ` +
        ".protyle-content > .protyle-wysiwyg";
    const normalizedPlans = new Map<string, Set<string>>();
    for (const plan of plans) {
        const excludedItemIDs = normalizedPlans.get(plan.listID) || new Set<string>();
        plan.excludedItemIDs.forEach((id) => excludedItemIDs.add(id));
        normalizedPlans.set(plan.listID, excludedItemIDs);
    }
    const autoSelectors: string[] = [];
    const visibleSelectors: string[] = [];
    Array.from(normalizedPlans).sort(([idA], [idB]) => idA.localeCompare(idB)).forEach(([listID, excludedItemIDs]) => {
        const escapedListID = escapeCSSAttributeValue(listID);
        const listSelector = `[data-type="NodeList"][data-node-id="${escapedListID}"]`;
        autoSelectors.push(`${selectorPrefix} ${listSelector} > [data-type="NodeListItem"]`);
        visibleSelectors.push(`${selectorPrefix} .protyle-wysiwyg__embed ${listSelector} > [data-type="NodeListItem"]`);
        Array.from(excludedItemIDs).sort().forEach((itemID) => {
            const escapedItemID = escapeCSSAttributeValue(itemID);
            visibleSelectors.push(`${selectorPrefix} ${listSelector} > ` +
                `[data-type="NodeListItem"][data-node-id="${escapedItemID}"]`);
        });
    });
    if (autoSelectors.length === 0) {
        return "";
    }
    return `@supports (content-visibility: auto) and (contain-intrinsic-block-size: auto 1px) {
@media screen {
${autoSelectors.join(",\n")} {
    content-visibility: auto;
    contain-intrinsic-block-size: auto calc(1.625em + 8px);
}
${visibleSelectors.join(",\n")} {
    content-visibility: visible;
    contain-intrinsic-block-size: none;
}
}
}`;
};

export class LargeListVirtualizer {
    private readonly rootElement: HTMLElement;
    private readonly wysiwygElement: HTMLElement;
    private readonly scope: string;
    private readonly styleElement: HTMLStyleElement;
    private readonly observer: MutationObserver;
    private virtualizedPlans: IListVirtualizationPlan[] = [];
    private refreshFrame = 0;

    constructor(rootElement: HTMLElement, wysiwygElement: HTMLElement, scope: string) {
        this.rootElement = rootElement;
        this.wysiwygElement = wysiwygElement;
        this.scope = scope;
        this.rootElement.setAttribute(LIST_VIRTUALIZATION_SCOPE_ATTRIBUTE, scope);
        this.styleElement = document.createElement("style");
        this.styleElement.dataset.listVirtualization = scope;
        this.rootElement.appendChild(this.styleElement);

        this.observer = new MutationObserver((records) => {
            if (records.length > 0) {
                // 同一帧内的编辑变更只触发一次完整扫描。
                this.scheduleRefresh();
            }
        });
        this.observer.observe(this.wysiwygElement, {
            attributes: true,
            attributeFilter: ["data-node-id", "data-type", "fold"],
            childList: true,
            subtree: true,
        });
        this.refresh(this.wysiwygElement, true);
    }

    public prepare(contentElement: Element, replace: boolean) {
        this.refresh(contentElement, replace);
    }

    public destroy() {
        this.observer.disconnect();
        if (this.refreshFrame) {
            cancelAnimationFrame(this.refreshFrame);
            this.refreshFrame = 0;
        }
        this.styleElement.remove();
        if (this.rootElement.getAttribute(LIST_VIRTUALIZATION_SCOPE_ATTRIBUTE) === this.scope) {
            this.rootElement.removeAttribute(LIST_VIRTUALIZATION_SCOPE_ATTRIBUTE);
        }
        this.virtualizedPlans = [];
    }

    private scheduleRefresh() {
        if (this.refreshFrame) {
            return;
        }
        this.refreshFrame = requestAnimationFrame(() => {
            this.refreshFrame = 0;
            this.refresh(this.wysiwygElement, true);
        });
    }

    private refresh(contentElement: Element, replace: boolean) {
        const nextPlans = getListVirtualizationPlans(contentElement, getElementState);
        if (!replace) {
            nextPlans.push(...this.virtualizedPlans);
        }
        const nextStyle = buildLargeListVirtualizationStyle(this.scope, nextPlans);
        if (nextStyle === this.styleElement.textContent) {
            return;
        }
        this.virtualizedPlans = nextPlans;
        this.styleElement.textContent = nextStyle;
    }
}
