import {transaction, updateTransaction} from "./transaction";
import {focusByWbr} from "../util/selection";
import * as dayjs from "dayjs";

export const turnIntoTaskList = (protyle: IProtyle, type: string, blockElement: HTMLElement, editElement: HTMLElement) => {
    if (type !== "NodeCodeBlock" &&
        blockElement.parentElement.getAttribute("data-subtype") !== "t" &&
        (
            ["[ ]", "[x]", "[X]", "【 】", "【x】", "【X】"].includes(editElement.innerHTML.substring(0, 3)) ||
            ["[]", "【】"].includes(editElement.innerHTML.substring(0, 2))
        )
    ) {
        const contextStartIndex = (editElement.innerHTML.indexOf("]") + 1) || (editElement.innerHTML.indexOf("】") + 1);
        const isDone = editElement.innerHTML.substring(1, 2).toLowerCase() === "x";
        if (blockElement.parentElement.classList.contains("li") &&
            blockElement.parentElement.childElementCount === 3  // https://ld246.com/article/1659315815506
        ) {
            // 仅有一项的列表才可转换
            if (!blockElement.parentElement.parentElement.classList.contains("protyle-wysiwyg") && // https://ld246.com/article/1659315815506
                blockElement.parentElement.parentElement.childElementCount === 2) {
                const liElement = blockElement.parentElement.parentElement;
                const oldHTML = liElement.outerHTML;
                liElement.setAttribute("data-subtype", "t");
                liElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                blockElement.parentElement.setAttribute("data-subtype", "t");
                if (isDone) {
                    blockElement.parentElement.classList.add("protyle-task--done");
                }
                blockElement.previousElementSibling.outerHTML = `<div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#icon${isDone ? "C" : "Unc"}heck"></use></svg></div>`
                editElement.innerHTML = editElement.innerHTML.substring(contextStartIndex);
                updateTransaction(protyle, liElement.getAttribute("data-node-id"), liElement.outerHTML, oldHTML);
                return true;
            }
            return false;
        } else {
            const id = blockElement.getAttribute("data-node-id")
            const newId = Lute.NewNodeID();
            const emptyId = Lute.NewNodeID();
            const liItemId = Lute.NewNodeID();
            const oldHTML = blockElement.outerHTML;
            editElement.innerHTML = editElement.innerHTML.substring(contextStartIndex);
            transaction(protyle, [{
                action: "update",
                id,
                data: blockElement.outerHTML,
            }, {
                action: "insert",
                id: newId,
                data: `<div data-subtype="t" data-node-id="${newId}" data-type="NodeList" class="list"><div data-marker="*" data-subtype="t" data-node-id="${liItemId}" data-type="NodeListItem" class="li${isDone ? " protyle-task--done" : ""}"><div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#icon${isDone ? "C" : "Unc"}heck"></use></svg></div><div data-node-id="${emptyId}" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}"></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`,
                previousID: id,
            }, {
                action: "move",
                id,
                previousID: emptyId,
            }, {
                action: "delete",
                id: emptyId
            }], [{
                action: "update",
                id,
                data: oldHTML,
            }, {
                action: "move",
                id,
                previousID: newId,
            }, {
                action: "delete",
                id: newId
            }]);
            blockElement.outerHTML = `<div data-subtype="t" data-node-id="${newId}" data-type="NodeList" class="list"><div data-marker="*" data-subtype="t" data-node-id="${liItemId}" data-type="NodeListItem" class="li${isDone ? " protyle-task--done" : ""}"><div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#icon${isDone ? "C" : "Unc"}heck"></use></svg></div>${blockElement.outerHTML}<div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`
            focusByWbr(protyle.wysiwyg.element, getSelection().getRangeAt(0))
            return true;
        }
    }
    return false
}

export const headingTurnIntoList = (protyle: IProtyle, type: string, blockElement: HTMLElement, editElement: HTMLElement) => {
    if (type !== "NodeHeading" && ["* ", "- "].includes(editElement.innerHTML.substring(0, 2))) {
        const id = blockElement.getAttribute("data-node-id")
        const newId = Lute.NewNodeID();
        const emptyId = Lute.NewNodeID();
        const liItemId = Lute.NewNodeID();
        const oldHTML = blockElement.outerHTML;
        editElement.innerHTML = editElement.innerHTML.substring(2);
        transaction(protyle, [{
            action: "update",
            id,
            data: blockElement.outerHTML,
        }, {
            action: "insert",
            id: newId,
            data: `<div data-subtype="t" data-node-id="${newId}" data-type="NodeList" class="list"><div data-marker="*" data-subtype="t" data-node-id="${liItemId}" data-type="NodeListItem" class="li${isDone ? " protyle-task--done" : ""}"><div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#icon${isDone ? "C" : "Unc"}heck"></use></svg></div><div data-node-id="${emptyId}" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}"></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`,
            previousID: id,
        }, {
            action: "move",
            id,
            previousID: emptyId,
        }, {
            action: "delete",
            id: emptyId
        }], [{
            action: "update",
            id,
            data: oldHTML,
        }, {
            action: "move",
            id,
            previousID: newId,
        }, {
            action: "delete",
            id: newId
        }]);
        blockElement.outerHTML = `<div data-subtype="t" data-node-id="${newId}" data-type="NodeList" class="list"><div data-marker="*" data-subtype="t" data-node-id="${liItemId}" data-type="NodeListItem" class="li${isDone ? " protyle-task--done" : ""}"><div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#icon${isDone ? "C" : "Unc"}heck"></use></svg></div>${blockElement.outerHTML}<div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`
        focusByWbr(protyle.wysiwyg.element, getSelection().getRangeAt(0))
        return true;
    }
    return false
}
