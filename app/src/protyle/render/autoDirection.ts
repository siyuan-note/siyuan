const textSelector = '[data-type="NodeParagraph"] > div[contenteditable]:not(.protyle-attr), ' +
    '[data-type="NodeHeading"] > div[contenteditable]:not(.protyle-attr), p, h1, h2, h3, h4, h5, h6';
const excludedSelector = 'pre, code, .render-node, [data-type="NodeCodeBlock"], ' +
    '[data-type="NodeMathBlock"], [data-type="NodeHTMLBlock"], [data-type="NodeAttributeView"], protyle-html';
const disposers = new WeakMap<HTMLElement, () => void>();
const directionAttribute = "data-auto-direction";
const listDirectionAttribute = "data-auto-list-direction";
const listSelector = '[data-type="NodeListItem"], li';

/** 列表控件按当前项的方向定位，不继承全局开关对其他列表项的判断。 */
export const getAutoListDirection = (element: Element) => {
    const item = element.closest<HTMLElement>(listSelector);
    return item?.hasAttribute(directionAttribute) ? getComputedStyle(item).direction : undefined;
};

/** 文档标题使用浏览器的实时方向判定，保留显式指定的方向。 */
export const setTitleAutoDirection = (element: HTMLElement, enabled: boolean) => {
    if (!element || element.hasAttribute("dir") && element.dir !== "auto") {
        return;
    }
    if (enabled) {
        element.dir = "auto";
    } else {
        element.removeAttribute("dir");
    }
};

const clearDirection = (element: HTMLElement) => {
    if (element.dir === element.getAttribute(directionAttribute)) {
        element.removeAttribute("dir");
    }
    element.removeAttribute(directionAttribute);
    element.removeAttribute(listDirectionAttribute);
};

export const destroyAutoDirection = (root: HTMLElement) => {
    disposers.get(root)?.();
    disposers.delete(root);
};

/** 自动方向用于正文和各列表项的布局，不持久化推导出的方向。 */
export const setAutoDirection = (root: HTMLElement, enabled: boolean) => {
    destroyAutoDirection(root);
    const managed = new Set<HTMLElement>();
    const applyDirection = (element: HTMLElement, direction: string) => {
        managed.add(element);
        if (element.getAttribute(directionAttribute) !== direction) {
            element.setAttribute(directionAttribute, direction);
        }
        if (element.dir !== direction) {
            element.dir = direction;
        }
    };
    const getExplicitDirection = (element: HTMLElement) => {
        for (let current = element; current; current = current.parentElement) {
            if (current.style.direction) {
                return getComputedStyle(current).direction;
            }
            if (current.dir !== current.getAttribute(directionAttribute) &&
                (current.dir === "ltr" || current.dir === "rtl")) {
                return current.dir;
            }
            if (current === root) {
                break;
            }
        }
        return "auto";
    };
    const updateList = (item: HTMLElement) => {
        if (!root.contains(item)) {
            return;
        }
        if (item.closest(excludedSelector)) {
            clearDirection(item);
            managed.delete(item);
            return;
        }
        if (item.tagName === "LI" && item.parentElement?.matches("ul, ol")) {
            const list = item.parentElement;
            managed.add(list);
            if (list.getAttribute(directionAttribute) !== "list") {
                list.setAttribute(directionAttribute, "list");
            }
        }
        if (item.dir && item.dir !== "auto" && item.dir !== item.getAttribute(directionAttribute)) {
            item.removeAttribute(directionAttribute);
            item.removeAttribute(listDirectionAttribute);
            managed.delete(item);
            return;
        }
        let direction = getExplicitDirection(item);
        if (direction === "auto") {
            // 只读取本项的首个正文区域，避免子列表文字或任务图标决定父项方向。
            const content = Array.from(item.children).find(child =>
                !child.matches('.protyle-action, .protyle-attr, [data-type="NodeList"], ul, ol, input'));
            const text = content?.matches(textSelector) ? content : content?.querySelector<HTMLElement>(textSelector);
            if (text && text.closest(listSelector) === item) {
                direction = getComputedStyle(text).direction;
            }
        }
        applyDirection(item, direction);
        const layoutDirection = direction === "auto" ? getComputedStyle(item).direction : direction;
        if (item.getAttribute(listDirectionAttribute) !== layoutDirection) {
            item.setAttribute(listDirectionAttribute, layoutDirection);
        }
    };
    const update = (scope: HTMLElement) => {
        if (!enabled) {
            scope.querySelectorAll<HTMLElement>(`[${directionAttribute}]`).forEach(clearDirection);
            clearDirection(scope);
            return;
        }
        const elements = Array.from(scope.querySelectorAll<HTMLElement>(textSelector));
        if (scope.matches(textSelector)) {
            elements.push(scope);
        }
        elements.forEach(element => {
            if (!root.contains(element)) {
                return;
            }
            if (element.closest(excludedSelector)) {
                clearDirection(element);
                managed.delete(element);
            } else if (!element.dir || element.dir === "auto" ||
                element.dir === element.getAttribute(directionAttribute)) {
                const direction = getExplicitDirection(element);
                applyDirection(element, direction);
            } else {
                element.removeAttribute(directionAttribute);
                managed.delete(element);
            }
        });
        // 先更新子项，原生 HTML 列表的自动判定即可跳过具有独立方向的子列表项。
        const items = Array.from(scope.querySelectorAll<HTMLElement>(listSelector)).reverse();
        const owner = scope.closest<HTMLElement>(listSelector);
        if (owner) {
            items.push(owner);
        }
        items.forEach(updateList);
    };
    update(root);
    // 浏览器判定文字方向，内容变化时只同步受影响列表项的布局。
    const observer = new MutationObserver(records => {
        const scopes = new Set<HTMLElement>();
        records.forEach(record => {
            if (record.type === "characterData") {
                if (record.target.parentElement?.closest(listSelector)) {
                    scopes.add(record.target.parentElement);
                }
            } else if (record.type === "attributes") {
                scopes.add(record.target as HTMLElement);
            } else {
                if ((record.target as HTMLElement).closest(listSelector)) {
                    scopes.add(record.target as HTMLElement);
                }
                record.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        scopes.add(node as HTMLElement);
                    }
                });
                record.removedNodes.forEach(node => {
                    if (node.nodeType !== 1 || root.contains(node)) {
                        return;
                    }
                    const element = node as HTMLElement;
                    clearDirection(element);
                    managed.delete(element);
                    element.querySelectorAll<HTMLElement>(`[${directionAttribute}]`).forEach(child => {
                        clearDirection(child);
                        managed.delete(child);
                    });
                });
            }
        });
        scopes.forEach(update);
    });
    observer.observe(root, {subtree: true, childList: true, ...(enabled ? {
        characterData: true, attributes: true, attributeFilter: ["style", "dir", "contenteditable", "data-type"],
    } : {})});
    disposers.set(root, () => {
        observer.disconnect();
        managed.forEach(clearDirection);
    });
};
