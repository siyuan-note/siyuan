const LONG_TEXT_SELECTOR = 'span[data-inline-wrap="token"]';
const TEXT_CONTAINER_SELECTOR = "[contenteditable], [data-table-cell-content]";
const EXCLUDED_SELECTOR = 'pre, script, style, svg, textarea, [data-type="NodeCodeBlock"], ' +
    '[data-type="NodeHTMLBlock"], [data-type="NodeMathBlock"], [data-type~="inline-math"], ' +
    '[data-type~="img"], .protyle-attr, .protyle-action';

// 仅为至少 32 个连续字母、数字或下划线提供字符间断行，空格和中文两侧的普通单词保持完整。
export const getLongTextRanges = (text: string) => {
    const ranges: {start: number, end: number}[] = [];
    for (const token of text.matchAll(/(?:[^\s\u200b]|\ufeff)+/gu)) {
        const prefix = token[0].match(/^[\u2060\ufeff]+/u)?.[0].length || 0;
        const content = token[0].substring(prefix);
        // 用户在连续文本内设置的禁止断行字符优先于自动折行。
        if (/[\u2060\ufeff]/u.test(content)) {
            continue;
        }
        for (const match of content.matchAll(/[a-zA-Z0-9_]{32,}/g)) {
            const start = token.index + prefix + match.index;
            ranges.push({start, end: start + match[0].length});
        }
    }
    return ranges;
};

export const unwrapLongTextRuns = (root: ParentNode) => {
    const parents = new Set<Node>();
    const elements = Array.from(root.querySelectorAll<HTMLElement>(LONG_TEXT_SELECTOR));
    if (root instanceof HTMLElement && root.matches(LONG_TEXT_SELECTOR)) {
        elements.unshift(root);
    }
    elements.forEach(element => {
        element.removeAttribute("data-inline-wrap");
        // 格式操作可能把真实样式附加到显示节点，清理时保留这些用户设置。
        if (!element.hasAttribute("data-type") && !element.hasAttribute("style")) {
            if (element.parentNode) {
                parents.add(element.parentNode);
            }
            element.replaceWith(...Array.from(element.childNodes));
        }
    });
    parents.forEach(parent => parent.normalize());
};

const isDisplayWrapper = (node: Node) => node?.nodeType === Node.ELEMENT_NODE &&
    (node as Element).matches(LONG_TEXT_SELECTOR) &&
    !(node as Element).hasAttribute("data-type") && !(node as Element).hasAttribute("style");

const preserveSelection = (root: Element, update: () => void, retainedRange?: Range) => {
    const selection = root.ownerDocument.getSelection();
    const capture = (node: Node, offset: number) => {
        if (!node || !root.contains(node)) {
            return {node, offset};
        }
        let parent = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
        let container = parent;
        while (isDisplayWrapper(container)) {
            container = container.parentElement;
        }
        // 以不会被替换的父元素和前一个结构节点定位，保留空块、软换行及行内格式边界。
        let previous = node.nodeType === Node.ELEMENT_NODE ? node.childNodes[offset - 1] : node.previousSibling;
        while (parent) {
            while (previous) {
                if (isDisplayWrapper(previous)) {
                    parent = previous as Element;
                    previous = previous.lastChild;
                } else if (previous.nodeType === Node.TEXT_NODE) {
                    previous = previous.previousSibling;
                } else {
                    break;
                }
            }
            if (previous || parent === container) {
                break;
            }
            previous = parent.previousSibling;
            parent = parent.parentElement;
        }
        const range = root.ownerDocument.createRange();
        if (previous) {
            range.setStartAfter(previous);
        } else {
            range.setStart(container, 0);
        }
        range.setEnd(node, offset);
        return {node, offset, container, previous, textOffset: range.toString().length};
    };
    const anchor = selection?.rangeCount ? capture(selection.anchorNode, selection.anchorOffset) : undefined;
    const focus = selection?.rangeCount ? capture(selection.focusNode, selection.focusOffset) : undefined;
    const ranges = new Set<Range>();
    if (selection?.rangeCount) {
        ranges.add(selection.getRangeAt(0));
    }
    if (retainedRange) {
        ranges.add(retainedRange);
    }
    const positions = Array.from(ranges, range => ({
        range,
        start: capture(range.startContainer, range.startOffset),
        end: capture(range.endContainer, range.endOffset),
    }));
    update();
    const resolve = (position: ReturnType<typeof capture>) => {
        if (position.textOffset === undefined) {
            return position;
        }
        let offset = position.textOffset;
        const {container, previous} = position;
        const walker = root.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_ALL);
        walker.currentNode = previous || container;
        let node = previous ? walker.nextSibling() : walker.firstChild();
        while (node) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (offset <= node.textContent.length) {
                    return {node, offset};
                }
                offset -= node.textContent.length;
            } else if (!isDisplayWrapper(node)) {
                break;
            }
            node = walker.nextNode();
        }
        const range = root.ownerDocument.createRange();
        if (previous) {
            range.setStartAfter(previous);
        } else {
            range.setStart(container, 0);
        }
        return {node: range.startContainer, offset: range.startOffset};
    };
    // 延迟输入处理持有原 Range 对象，更新显示节点时同步恢复其边界。
    positions.forEach(({range, start, end}) => {
        if (start.textOffset === undefined && end.textOffset === undefined) {
            return;
        }
        const from = resolve(start);
        const to = resolve(end);
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
    });
    if (!anchor || !focus || (anchor.textOffset === undefined && focus.textOffset === undefined)) {
        return;
    }
    const start = resolve(anchor);
    const end = resolve(focus);
    selection.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
};

const normalizedContent = new WeakMap<Element, string>();

const wrapContainer = (root: Element) => {
    if (root.closest(EXCLUDED_SELECTOR) ||
        (!root.querySelector(LONG_TEXT_SELECTOR) && !/[a-zA-Z0-9_]{32}/.test(root.textContent || ""))) {
        return;
    }
    if (normalizedContent.get(root) === root.innerHTML) {
        return;
    }
    preserveSelection(root, () => {
        unwrapLongTextRuns(root);
        root.normalize();
        const nodes: {node: Text, start: number}[] = [];
        let text = "";
        const visit = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                nodes.push({node: node as Text, start: text.length});
                text += node.textContent;
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
            const element = node as Element;
            if (element !== root && (element.matches(EXCLUDED_SELECTOR) ||
                element.matches('[data-inline-wrap]:not([data-inline-wrap="token"])'))) {
                text += "\n";
                return;
            }
            const boundary = /^(BR|DIV|P|TD|TH)$/u.test(element.tagName);
            if (boundary) {
                text += "\n";
            }
            Array.from(element.childNodes).forEach(visit);
            if (boundary) {
                text += "\n";
            }
        };
        visit(root);
        const ranges = getLongTextRanges(text);
        nodes.forEach(({node, start}) => {
            const matches = ranges.filter(range => range.start < start + node.length && range.end > start);
            if (matches.length === 0) {
                return;
            }
            const fragment = root.ownerDocument.createDocumentFragment();
            let offset = 0;
            matches.forEach(range => {
                const from = Math.max(0, range.start - start);
                const to = Math.min(node.length, range.end - start);
                if (from > offset) {
                    fragment.append(node.data.substring(offset, from));
                }
                const span = root.ownerDocument.createElement("span");
                span.setAttribute("data-inline-wrap", "token");
                span.textContent = node.data.substring(from, to);
                fragment.append(span);
                offset = to;
            });
            if (offset < node.length) {
                fragment.append(node.data.substring(offset));
            }
            node.replaceWith(fragment);
        });
    });
    normalizedContent.set(root, root.innerHTML);
};

export const normalizeLongTextRuns = (root: ParentNode) => {
    const containers = Array.from(root.querySelectorAll(TEXT_CONTAINER_SELECTOR));
    if (root instanceof Element && (root.matches(TEXT_CONTAINER_SELECTOR) || root.closest(TEXT_CONTAINER_SELECTOR))) {
        containers.unshift(root);
    }
    // 外层可编辑区域已经包含其子区域，避免对同一段文字重复处理。
    const owners = new Set(containers);
    containers.filter(element => {
        let parent = element.parentElement;
        while (parent) {
            if (owners.has(parent)) {
                return false;
            }
            parent = parent.parentElement;
        }
        return true;
    })
        .forEach(wrapContainer);
};

const configuredEditors = new WeakSet<Element>();
const composingEditors = new WeakSet<Element>();
const inputDepth = new WeakMap<Element, number>();

export const suspendLongTextRuns = (editor: Element, block: Element, range: Range) => {
    inputDepth.set(editor, (inputDepth.get(editor) || 0) + 1);
    if (block.querySelector(LONG_TEXT_SELECTOR)) {
        preserveSelection(block, () => unwrapLongTextRuns(block), range);
    }
    return () => {
        inputDepth.set(editor, inputDepth.get(editor) - 1);
        renderLongTextRuns(editor);
    };
};

export const renderLongTextRuns = (root: Element) => {
    const editor = root.closest(".protyle-wysiwyg");
    if (!editor) {
        normalizeLongTextRuns(root);
        return;
    }
    if (!configuredEditors.has(editor)) {
        configuredEditors.add(editor);
        const unwrapAtInput = (event: Event) => {
            const target = event.target instanceof Element ? event.target.closest(TEXT_CONTAINER_SELECTOR) : null;
            if (target?.querySelector(LONG_TEXT_SELECTOR)) {
                preserveSelection(target, () => unwrapLongTextRuns(target));
            }
        };
        // 输入期间使用原始文本节点，浏览器完成编辑后再更新显示节点，避免影响输入法和编辑器解析。
        editor.addEventListener("beforeinput", unwrapAtInput, true);
        editor.addEventListener("compositionstart", event => {
            composingEditors.add(editor);
            unwrapAtInput(event);
        }, true);
        editor.addEventListener("compositionend", () => {
            composingEditors.delete(editor);
        });
    }
    if (!composingEditors.has(editor) && !inputDepth.get(editor)) {
        normalizeLongTextRuns(root);
    }
};
