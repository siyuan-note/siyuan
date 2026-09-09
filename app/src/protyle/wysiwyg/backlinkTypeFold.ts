import type {IViewFoldStateStore} from "../util/viewFold";

export const BACKLINK_BLOCK_TYPES = [
    ["NodeDocument", "doc"], ["NodeParagraph", "paragraph"], ["NodeHeading", "headings"],
    ["NodeList", "list1"], ["NodeListItem", "listItem"], ["NodeBlockquote", "quote"],
    ["NodeSuperBlock", "superBlock"], ["NodeCallout", "callout"],
    ["NodeTabs", "tabs"], ["NodeTabItem", "tabItem"], ["NodeAttributeView", "database"],
    ["NodeTable", "table"], ["NodeCodeBlock", "code"], ["NodeMathBlock", "math"],
    ["NodeBlockQueryEmbed", "embedBlock"], ["NodeVideo", "video"], ["NodeAudio", "audio"],
    ["NodeWidget", "widget"], ["NodeHTMLBlock", "HTML"], ["NodeIFrame", "IFrame"],
    ["NodeThematicBreak", "line"], ["NodeCustomBlock", "custom"],
];

export const normalizeBacklinkFoldTypes = (value: unknown): string[] => Array.isArray(value) ?
    BACKLINK_BLOCK_TYPES.map(([type]) => type).filter(type => value.includes(type)) : [];

const contexts = new WeakMap<IProtyle, {types: string[], store: IViewFoldStateStore}>();
const expandHandlers = new WeakMap<IProtyle, (id: string) => void>();

export const setBacklinkTypeFoldExpandHandler = (protyle: IProtyle, handler: (id: string) => void) => {
    expandHandlers.set(protyle, handler);
};

export const configureBacklinkTypeFold = (protyle: IProtyle, types: string[], store: IViewFoldStateStore) => {
    contexts.set(protyle, {types: normalizeBacklinkFoldTypes(types), store});
    updateBacklinkTypeFolds(protyle);
};

export const getBacklinkTypeFoldKey = (id: string, type: string, generation = 0) =>
    `type-fold:${encodeURIComponent(type)}:${generation}:${encodeURIComponent(id)}`;

export const updateBacklinkTypeFolds = (protyle: IProtyle) => {
    const context = contexts.get(protyle);
    if (!context) {
        return;
    }
    protyle.wysiwyg.element.querySelectorAll<HTMLElement>(".protyle-breadcrumb__bar[data-backlink-id]").forEach(anchor => {
        const type = anchor.dataset.backlinkType;
        const enabled = context.types.includes(type);
        const key = getBacklinkTypeFoldKey(anchor.dataset.backlinkId, type,
            context.store.get<number>(`type-fold-generation:${type}`) || 0);
        const collapsed = enabled && context.store.get<boolean>(key) !== false;
        let button = anchor.querySelector<HTMLButtonElement>(".backlinkTypeFold");
        if (!enabled) {
            button?.remove();
        } else {
            if (!button) {
                button = document.createElement("button");
                button.className = "backlinkTypeFold";
                button.type = "button";
                button.addEventListener("mousedown", event => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                anchor.prepend(button);
            }
            button.onclick = event => {
                event.preventDefault();
                event.stopPropagation();
                context.store.set(key, button.getAttribute("aria-expanded") === "true");
                updateBacklinkTypeFolds(protyle);
            };
            const labelKey = BACKLINK_BLOCK_TYPES.find(([nodeType]) => nodeType === type)?.[1];
            const label = window.siyuan.languages[labelKey] || labelKey;
            button.innerHTML = `<svg><use xlink:href="#${collapsed ? "iconRight" : "iconDown"}"></use></svg>`;
            button.appendChild(document.createTextNode(label));
            button.setAttribute("aria-expanded", String(!collapsed));
            button.setAttribute("aria-label", `${collapsed ? window.siyuan.languages.expand : window.siyuan.languages.collapse} ${label}`);
        }
        // 仅折叠当前反链条目的内容，保留分隔栏和原有块折叠状态。
        let next = anchor.nextElementSibling;
        let revealed = false;
        while (next && !next.classList.contains("protyle-breadcrumb__bar")) {
            revealed = revealed || (!collapsed && next.hasAttribute("data-backlink-type-folded"));
            next.toggleAttribute("data-backlink-type-folded", collapsed);
            next = next.nextElementSibling;
        }
        if (revealed) {
            expandHandlers.get(protyle)?.(anchor.dataset.backlinkId);
        }
    });
};
