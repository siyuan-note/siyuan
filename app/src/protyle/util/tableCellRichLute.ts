import {getTaskListMarker} from "../wysiwyg/taskListMarker";

// 新建代码块的光标位于开围栏中，闭围栏由插入操作补齐；只放开这一段的结构换行。
const getCodeFenceStart = (marker: Element, editable: Element): Text | undefined => {
    if (!editable || marker.parentElement !== editable ||
        editable.parentElement?.getAttribute("data-type") !== "NodeParagraph" ||
        marker.previousSibling?.nodeType !== Node.TEXT_NODE) {
        return;
    }
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.setEndBefore(marker);
    const before = document.createElement("div");
    before.appendChild(range.cloneContents());
    const opening = before.innerHTML.trimStart().match(/(?:^|\n)(`{3,})[^`\n<]*$/);
    range.selectNodeContents(editable);
    range.setStartAfter(marker);
    const after = document.createElement("div");
    after.appendChild(range.cloneContents());
    if (opening && new RegExp("\\n`{" + opening[1].length + ",}[ \\t]*$").test(after.innerHTML.trimEnd())) {
        return marker.previousSibling as Text;
    }
};

// 保留单元格内的软换行，并允许光标所在的新行触发块级语法。
export const getTableCellEditorLute = (lute: Lute, enableFullWidthTaskList = false): Lute => new Proxy(lute, {
    get(target, property) {
        if (property !== "SpinBlockDOM") {
            return Reflect.get(target, property);
        }
        return (html: string) => {
            const template = document.createElement("template");
            template.innerHTML = html;
            let token = "SYTABLECELLSOFTBREAK";
            while (html.includes(token)) {
                token += "X";
            }
            let marker = template.content.querySelector("wbr");
            if (!marker && html.includes(Lute.Caret) && html.includes("```")) {
                // 斜杠菜单使用文本光标，统一为 DOM 光标后再识别围栏和软换行边界。
                const carets = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
                while (carets.nextNode()) {
                    const text = carets.currentNode as Text;
                    const offset = text.data.indexOf(Lute.Caret);
                    if (offset >= 0) {
                        const tail = text.splitText(offset);
                        tail.deleteData(0, Lute.Caret.length);
                        marker = document.createElement("wbr");
                        tail.before(marker);
                        break;
                    }
                }
            }
            const editable = marker?.closest('[contenteditable="true"]');
            const codeStart = getCodeFenceStart(marker, editable);
            let inCodeFence = false;
            const getBlockPath = (element: Element) => {
                const types: string[] = [];
                while (element) {
                    const type = element.getAttribute("data-type");
                    if (type?.startsWith("Node")) {
                        types.push(type);
                    }
                    element = element.parentElement;
                }
                return types.join("/");
            };
            const blockPath = getBlockPath(marker);
            let boundary: Node;
            const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
            let node: Node;
            while ((node = walker.nextNode())) {
                const element = node.parentElement;
                if (element?.closest('[contenteditable="true"]') &&
                    !element.closest('[data-type="NodeCodeBlock"], [data-type="NodeMathBlock"], .img')) {
                    if (node === codeStart) {
                        const offset = Math.max(0, node.textContent.lastIndexOf("\n"));
                        node.textContent = node.textContent.substring(0, offset).replace(/\n/g, token) +
                            node.textContent.substring(offset);
                        inCodeFence = true;
                        continue;
                    }
                    if (inCodeFence && editable.contains(node)) {
                        continue;
                    }
                    if (!codeStart && editable?.contains(node) && node.textContent.includes("\n") &&
                        (node.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING)) {
                        boundary = node;
                    }
                    node.textContent = node.textContent.replace(/\n/g, token);
                }
            }
            const protectedHTML = template.innerHTML;
            if (boundary) {
                // 只尝试解析光标前最后一处换行，其他空行和软换行仍由占位符保护。
                const protectedText = boundary.textContent;
                const offset = protectedText.lastIndexOf(token);
                boundary.textContent = protectedText.substring(0, offset) + "\n" +
                    protectedText.substring(offset + token.length);
                // 将当前行的快捷待办标记转为解析器语法，保留前文和标记后的行内内容。
                const lineRange = document.createRange();
                lineRange.setStart(boundary, offset + 1);
                lineRange.setEnd(editable, editable.childNodes.length);
                const line = document.createElement("div");
                line.appendChild(lineRange.cloneContents());
                const taskMarker = getTaskListMarker(line.innerHTML, enableFullWidthTaskList);
                if (taskMarker) {
                    line.innerHTML = line.innerHTML.substring(taskMarker.contentStartIndex);
                    line.prepend(document.createTextNode(`- [${taskMarker.marker}] `));
                    const content = document.createDocumentFragment();
                    content.append(...Array.from(line.childNodes));
                    lineRange.deleteContents();
                    lineRange.insertNode(content);
                }
                const candidate = target.SpinBlockDOM(template.innerHTML);
                const parsed = document.createElement("template");
                parsed.innerHTML = candidate;
                const parsedMarker = parsed.content.querySelector("wbr");
                if (parsedMarker && getBlockPath(parsedMarker) !== blockPath) {
                    return candidate.split(token).join("&#10;");
                }
            }
            return target.SpinBlockDOM(protectedHTML).split(token).join("&#10;");
        };
    },
});
