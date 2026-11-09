import {clearBlockDirection, renderBlockDirection, syncBlockDirection} from "./blockDirection";

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
        if (element.dir !== "auto") {
            element.dir = "auto";
        }
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
    renderBlockDirection(root);
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
    const getExplicitDirection = (element: HTMLElement, cache: Map<HTMLElement, string>) => {
        const ancestors: HTMLElement[] = [];
        let direction = "auto";
        for (let current = element; current; current = current.parentElement) {
            if (cache.has(current)) {
                direction = cache.get(current);
                break;
            }
            ancestors.push(current);
            if (current.style.direction) {
                direction = getComputedStyle(current).direction;
                break;
            }
            if (current.dir !== current.getAttribute(directionAttribute) &&
                (current.dir === "ltr" || current.dir === "rtl")) {
                direction = current.dir;
                break;
            }
            if (current === root) {
                break;
            }
        }
        ancestors.forEach(ancestor => cache.set(ancestor, direction));
        return direction;
    };
    const update = (scopes: Set<HTMLElement>) => {
        const topScopes = Array.from(scopes).filter(scope => {
            if (!root.contains(scope)) return false;
            if (scope === root) return true;
            for (let parent = scope.parentElement; parent; parent = parent.parentElement) {
                if (scopes.has(parent)) return false;
                if (parent === root) break;
            }
            return true;
        });
        if (!enabled) {
            topScopes.forEach(scope => {
                scope.querySelectorAll<HTMLElement>(`[${directionAttribute}]`).forEach(clearDirection);
                clearDirection(scope);
            });
            return;
        }
        const elements = new Set<HTMLElement>();
        const items = new Set<HTMLElement>();
        topScopes.forEach(scope => {
            scope.querySelectorAll<HTMLElement>(textSelector).forEach(element => elements.add(element));
            if (scope.matches(textSelector)) elements.add(scope);
            scope.querySelectorAll<HTMLElement>(listSelector).forEach(item => items.add(item));
            const owner = scope.closest<HTMLElement>(listSelector);
            if (owner) items.add(owner);
        });
        const textDirections = new Map<HTMLElement, string>();
        const textCache = new Map<HTMLElement, string>();
        const cleanup: (() => void)[] = [];
        elements.forEach(element => {
            if (element.closest(excludedSelector)) {
                cleanup.push(() => {
                    clearDirection(element);
                    managed.delete(element);
                });
            } else if (!element.dir || element.dir === "auto" ||
                element.dir === element.getAttribute(directionAttribute)) {
                textDirections.set(element, getExplicitDirection(element, textCache));
            } else {
                cleanup.push(() => {
                    element.removeAttribute(directionAttribute);
                    managed.delete(element);
                });
            }
        });
        cleanup.forEach(clear => clear());
        // 正文方向统一写入后再读取列表布局，避免每个列表项都触发一次样式重算。
        textDirections.forEach((direction, element) => applyDirection(element, direction));
        const automaticItems = Array.from(items).filter(item => {
            if (item.closest(excludedSelector)) {
                clearDirection(item);
                managed.delete(item);
                return false;
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
                return false;
            }
            return true;
        });
        const listCache = new Map<HTMLElement, string>();
        const listDirections = automaticItems.map(item => {
            let direction = getExplicitDirection(item, listCache);
            if (direction === "auto") {
                // 只读取本项的首个正文区域，避免子列表文字或任务图标决定父项方向。
                const content = Array.from(item.children).find(child =>
                    !child.matches('.protyle-action, .protyle-attr, [data-type="NodeList"], ul, ol, input'));
                const text = content?.matches(textSelector) ? content : content?.querySelector<HTMLElement>(textSelector);
                if (text && text.closest(listSelector) === item) {
                    direction = getComputedStyle(text).direction;
                }
            }
            return {item, direction};
        });
        listDirections.forEach(({item, direction}) => applyDirection(item, direction));
        // 无正文的原生列表项依赖子项的 dir 排除规则，统一写入后再读取浏览器的判定。
        const layouts = listDirections.map(({item, direction}) => ({item,
            direction: direction === "auto" ? getComputedStyle(item).direction : direction}));
        layouts.forEach(({item, direction}) => {
            if (item.getAttribute(listDirectionAttribute) !== direction) {
                item.setAttribute(listDirectionAttribute, direction);
            }
        });
    };
    update(new Set([root]));
    // 浏览器判定文字方向，内容变化时只同步受影响列表项的布局。
    const observer = new MutationObserver(records => {
        const scopes = new Set<HTMLElement>();
        records.forEach(record => {
            if (record.type === "characterData") {
                if (record.target.parentElement?.closest(listSelector)) {
                    scopes.add(record.target.parentElement);
                }
            } else if (record.type === "attributes") {
                const element = record.target as HTMLElement;
                syncBlockDirection(element);
                if (enabled) {
                    scopes.add(element);
                }
            } else {
                if ((record.target as HTMLElement).closest(listSelector)) {
                    scopes.add(record.target as HTMLElement);
                }
                record.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        renderBlockDirection(node as Element);
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
        update(scopes);
    });
    observer.observe(root, {
        subtree: true, childList: true, attributes: true, characterData: enabled,
        attributeFilter: ["style", "data-node-id", "data-table-cell-node",
            ...(enabled ? ["dir", "contenteditable", "data-type"] : [])],
    });
    disposers.set(root, () => {
        observer.disconnect();
        managed.forEach(clearDirection);
        clearBlockDirection(root);
    });
};
