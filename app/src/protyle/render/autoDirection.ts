const textSelector = '[data-type="NodeParagraph"] > div[contenteditable]:not(.protyle-attr), ' +
    '[data-type="NodeHeading"] > div[contenteditable]:not(.protyle-attr), p, h1, h2, h3, h4, h5, h6';
const excludedSelector = 'pre, code, .render-node, [data-type="NodeCodeBlock"], ' +
    '[data-type="NodeMathBlock"], [data-type="NodeHTMLBlock"], [data-type="NodeAttributeView"], protyle-html';
const disposers = new WeakMap<HTMLElement, () => void>();
const directionAttribute = "data-auto-direction";

const clearDirection = (element: HTMLElement) => {
    if (element.dir === element.getAttribute(directionAttribute)) {
        element.removeAttribute("dir");
    }
    element.removeAttribute(directionAttribute);
};

export const destroyAutoDirection = (root: HTMLElement) => {
    disposers.get(root)?.();
    disposers.delete(root);
};

/** 自动方向只作用于正文，不改变容器布局或持久化手动方向。 */
export const setAutoDirection = (root: HTMLElement, enabled: boolean) => {
    destroyAutoDirection(root);
    const managed = new Set<HTMLElement>();
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
                managed.add(element);
                const direction = getExplicitDirection(element);
                if (element.getAttribute(directionAttribute) !== direction) {
                    element.setAttribute(directionAttribute, direction);
                }
                if (element.dir !== direction) {
                    element.dir = direction;
                }
            } else {
                element.removeAttribute(directionAttribute);
                managed.delete(element);
            }
        });
    };
    update(root);
    // 浏览器负责随正文变化重新判定方向，只监听结构和手动样式变化。
    const observer = new MutationObserver(records => {
        const scopes = new Set<HTMLElement>();
        records.forEach(record => {
            if (record.type === "attributes") {
                scopes.add(record.target as HTMLElement);
            } else {
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
        attributes: true, attributeFilter: ["style", "dir", "contenteditable", "data-type"],
    } : {})});
    disposers.set(root, () => {
        observer.disconnect();
        managed.forEach(clearDirection);
    });
};
