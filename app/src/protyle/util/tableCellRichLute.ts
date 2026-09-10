import {getTaskListMarker} from "../wysiwyg/taskListMarker";

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
            const marker = template.content.querySelector("wbr");
            const editable = marker?.closest('[contenteditable="true"]');
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
                    if (editable?.contains(node) && node.textContent.includes("\n") &&
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
