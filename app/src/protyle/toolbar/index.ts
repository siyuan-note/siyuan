import {Divider} from "./Divider";
import {Font, hasSameTextStyle, setFontStyle} from "./Font";
import {ToolbarItem} from "./ToolbarItem";
import {
    fixTableRange, focusBlock,
    focusByRange,
    focusByWbr,
    getEditorRange,
    getSelectionPosition,
    setFirstNodeRange,
    setLastNodeRange
} from "../util/selection";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../util/hasClosest";
import {Link} from "./Link";
import {setPosition} from "../../util/setPosition";
import {updateTransaction} from "../wysiwyg/transaction";
import {Constants} from "../../constants";
import {getEventName, openByMobile, setStorageVal} from "../util/compatibility";
import {upDownHint} from "../../util/upDownHint";
import {highlightRender} from "../markdown/highlightRender";
import {getContenteditableElement, hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";
import {processRender} from "../util/processCode";
import {BlockRef} from "./BlockRef";
import {hintRenderAssets, hintRenderTemplate, hintRenderWidget} from "../hint/extend";
import {blockRender} from "../markdown/blockRender";
/// #if !BROWSER
import {openBy} from "../../editor/util";
/// #endif
import {fetchPost} from "../../util/fetch";
import {isArrayEqual, isMobile} from "../../util/functions";
import * as dayjs from "dayjs";
import {insertEmptyBlock} from "../../block/util";
import {matchHotKey} from "../util/hotKey";
import {hideElements} from "../ui/hideElements";
import {renderAssetsPreview} from "../../asset/renderAssets";
import {electronUndo} from "../undo";
import {previewTemplate} from "./util";
import {hideMessage, showMessage} from "../../dialog/message";
import {InlineMath} from "./InlineMath";
import {InlineMemo} from "./InlineMemo";
import {mathRender} from "../markdown/mathRender";
import {linkMenu} from "../../menus/protyle";
import {addScript} from "../util/addScript";
import {confirmDialog} from "../../dialog/confirmDialog";

export class Toolbar {
    public element: HTMLElement;
    public subElement: HTMLElement;
    public subElementCloseCB: () => void;
    public range: Range;
    private toolbarHeight: number;

    constructor(protyle: IProtyle) {
        const options = protyle.options;

        const element = document.createElement("div");
        element.className = "protyle-toolbar fn__none";
        this.element = element;
        this.subElement = document.createElement("div");
        /// #if MOBILE
        this.subElement.className = "protyle-util fn__none protyle-util--mobile";
        /// #else
        this.subElement.className = "protyle-util fn__none";
        /// #endif
        this.toolbarHeight = 29;

        options.toolbar.forEach((menuItem: IMenuItem) => {
            const itemElement = this.genItem(protyle, menuItem);
            this.element.appendChild(itemElement);
        });
    }

    public render(protyle: IProtyle, range: Range, event?: KeyboardEvent) {
        this.range = range;
        let nodeElement = hasClosestBlock(range.startContainer);
        if (isMobile() || !nodeElement || protyle.disabled) {
            this.element.classList.add("fn__none");
            return;
        }
        // https://github.com/siyuan-note/siyuan/issues/5157
        let hasImg = true;
        let noText = true;
        Array.from(range.cloneContents().childNodes).find(item => {
            if (item.nodeType !== 1) {
                if (item.textContent.length > 0) {
                    noText = false;
                    return true;
                }
            } else if (!(item as HTMLElement).classList.contains("img")) {
                hasImg = false;
                return true;
            }
        });
        if ((hasImg && noText) ||
            // 拖拽图片到最右侧
            (range.commonAncestorContainer.nodeType !== 3 && (range.commonAncestorContainer as HTMLElement).classList.contains("img"))) {
            this.element.classList.add("fn__none");
            return;
        }
        // shift+方向键或三击选中，不同的块 https://github.com/siyuan-note/siyuan/issues/3891
        const startElement = hasClosestBlock(range.startContainer);
        const endElement = hasClosestBlock(range.endContainer);
        if (startElement && endElement && !startElement.isSameNode(endElement)) {
            if (event) { // 在 keyup 中使用 shift+方向键选中
                if (event.key === "ArrowLeft") {
                    this.range = setLastNodeRange(getContenteditableElement(startElement), range, false);
                } else if (event.key === "ArrowRight") {
                    this.range = setFirstNodeRange(getContenteditableElement(endElement), range);
                    this.range.collapse(false);
                } else if (event.key === "ArrowUp") {
                    this.range = setFirstNodeRange(getContenteditableElement(endElement), range);
                    nodeElement = hasClosestBlock(endElement);
                    if (!nodeElement) {
                        return;
                    }
                } else if (event.key === "ArrowDown") {
                    this.range = setLastNodeRange(getContenteditableElement(startElement), range, false);
                }
            } else {
                this.range = setLastNodeRange(getContenteditableElement(nodeElement), range, false);
            }
            focusByRange(this.range);
            if (this.range.toString() === "") {
                this.element.classList.add("fn__none");
                return;
            }
        }
        // 需放在 range 修改之后，否则 https://github.com/siyuan-note/siyuan/issues/4726
        if (nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
            this.element.classList.add("fn__none");
            return;
        }
        const rangePosition = getSelectionPosition(nodeElement, range);
        this.element.classList.remove("fn__none");
        const y = rangePosition.top - this.toolbarHeight - 4;
        this.element.setAttribute("data-inity", y + Constants.ZWSP + protyle.contentElement.scrollTop.toString());
        setPosition(this.element, rangePosition.left - 52, y);
        this.element.querySelectorAll(".protyle-toolbar__item--current").forEach(item => {
            item.classList.remove("protyle-toolbar__item--current");
        });
        const types = this.getCurrentType();
        types.forEach(item => {
            if (["search-mark", "a", "block-ref", "virtual-block-ref", "text", "file-annotation-ref", "inline-math",
                "inline-memo", "", "backslash"].includes(item)) {
                return;
            }
            const itemElement = this.element.querySelector(`[data-type="${item}"]`);
            if (itemElement) {
                itemElement.classList.add("protyle-toolbar__item--current");
            }
        });
    }

    public getCurrentType(range = this.range) {
        let types: string[] = [];
        let startElement = range.startContainer as HTMLElement;
        if (startElement.nodeType === 3) {
            startElement = startElement.parentElement;
        } else if (startElement.childElementCount > 0 && startElement.childNodes[range.startOffset]?.nodeType !== 3) {
            startElement = startElement.childNodes[range.startOffset] as HTMLElement;
        }
        if (!startElement || startElement.nodeType === 3) {
            return [];
        }
        if (!["DIV", "TD", "TH", "TR"].includes(startElement.tagName)) {
            types = (startElement.getAttribute("data-type") || "").split(" ");
        }
        let endElement = range.endContainer as HTMLElement;
        if (endElement.nodeType === 3) {
            endElement = endElement.parentElement;
        } else if (endElement.childElementCount > 0 && endElement.childNodes[range.endOffset]?.nodeType !== 3) {
            endElement = endElement.childNodes[range.endOffset] as HTMLElement;
        }
        if (!endElement || endElement.nodeType === 3) {
            return [];
        }
        if (!["DIV", "TD", "TH", "TR"].includes(endElement.tagName) && !startElement.isSameNode(endElement)) {
            types = types.concat((endElement.getAttribute("data-type") || "").split(" "));
        }
        range.cloneContents().childNodes.forEach((item: HTMLElement) => {
            if (item.nodeType !== 3) {
                types = types.concat((item.getAttribute("data-type") || "").split(" "));
            }
        });
        types = [...new Set(types)];
        types.find((item, index) => {
            if (item === "") {
                types.splice(index, 1);
                return true;
            }
        });
        return types;
    }

    private genItem(protyle: IProtyle, menuItem: IMenuItem) {
        let menuItemObj;
        switch (menuItem.name) {
            case "strong":
            case "em":
            case "s":
            case "code":
            case "mark":
            case "tag":
            case "u":
            case "sup":
            case "clear":
            case "sub":
            case "kbd":
                menuItemObj = new ToolbarItem(protyle, menuItem);
                break;
            case "block-ref":
                menuItemObj = new BlockRef(protyle, menuItem);
                break;
            case "inline-math":
                menuItemObj = new InlineMath(protyle, menuItem);
                break;
            case "inline-memo":
                menuItemObj = new InlineMemo(protyle, menuItem);
                break;
            case "|":
                menuItemObj = new Divider();
                break;
            case "text":
                menuItemObj = new Font(protyle, menuItem);
                break;
            case "a":
                menuItemObj = new Link(protyle, menuItem);
                break;
        }
        if (!menuItemObj) {
            return;
        }
        return menuItemObj.element;
    }

    // 合并多个 text 为一个 text
    private mergeNode(nodes: NodeListOf<ChildNode>) {
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType !== 3 && (nodes[i] as HTMLElement).tagName === "WBR") {
                nodes[i].remove();
                i--;
            }
        }
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType === 3) {
                if (nodes[i].textContent === "") {
                    nodes[i].remove();
                    i--;
                } else if (nodes[i + 1] && nodes[i + 1].nodeType === 3) {
                    nodes[i].textContent = nodes[i].textContent + nodes[i + 1].textContent;
                    nodes[i + 1].remove();
                    i--;
                }
            }
        }
    }

    public setInlineMark(protyle: IProtyle, type: string, action: "range" | "toolbar", textObj?: ITextOption) {
        const nodeElement = hasClosestBlock(this.range.startContainer);
        if (!nodeElement) {
            return;
        }
        const endElement = hasClosestBlock(this.range.endContainer);
        if (!endElement) {
            return;
        }
        // 三击后还没有重新纠正 range 时使用快捷键标记会导致异常 https://github.com/siyuan-note/siyuan/issues/7068
        if (!nodeElement.isSameNode(endElement)) {
            this.range = setLastNodeRange(getContenteditableElement(nodeElement), this.range, false);
        }
        const rangeTypes = this.getCurrentType(this.range);
        const selectText = this.range.toString();
        fixTableRange(this.range);
        let previousElement: HTMLElement;
        let nextElement: HTMLElement;
        let previousIndex: number;
        let nextIndex: number;
        const previousSibling = hasPreviousSibling(this.range.startContainer);
        if (!["DIV", "TD", "TH", "TR"].includes(this.range.startContainer.parentElement.tagName)) {
            if (this.range.startOffset === 0 && !previousSibling) {
                previousElement = this.range.startContainer.parentElement.previousSibling as HTMLElement;
                this.range.setStartBefore(this.range.startContainer.parentElement);
            } else {
                previousElement = this.range.startContainer.parentElement;
            }
        } else if (previousSibling && previousSibling.nodeType !== 3 && this.range.startOffset === 0) {
            // **aaa**bbb 选中 bbb 加粗
            previousElement = previousSibling as HTMLElement;
        }
        let isEndSpan = false;
        const nextSibling = hasNextSibling(this.range.endContainer);
        if (!["DIV", "TD", "TH", "TR"].includes(this.range.endContainer.parentElement.tagName)) {
            if (this.range.endOffset === this.range.endContainer.textContent.length && !nextSibling) {
                nextElement = this.range.endContainer.parentElement.nextSibling as HTMLElement;
                this.range.setEndAfter(this.range.endContainer.parentElement);
                if (selectText === "") {
                    isEndSpan = true;
                    this.range.collapse(false);
                }
            } else {
                nextElement = this.range.endContainer.parentElement;
            }
        } else if (nextSibling && nextSibling.nodeType !== 3 && this.range.endOffset === this.range.endContainer.textContent.length) {
            // aaa**bbb** 选中 aaa 加粗
            nextElement = nextSibling as HTMLElement;
        }
        this.range.insertNode(document.createElement("wbr"));
        const html = nodeElement.outerHTML;
        const contents = this.range.extractContents();
        this.mergeNode(contents.childNodes);
        // 选择 span 中的一部分需进行包裹
        if (previousElement && nextElement && previousElement.isSameNode(nextElement) && contents.firstChild?.nodeType === 3) {
            const attributes = previousElement.attributes;
            contents.childNodes.forEach(item => {
                const spanElement = document.createElement("span");
                for (let i = 0; i < attributes.length; i++) {
                    spanElement.setAttribute(attributes[i].name, attributes[i].value);
                }
                spanElement.innerHTML = item.textContent;
                item.replaceWith(spanElement);
            });
        }
        const toolbarElement = isMobile() ? document.querySelector("#keyboardToolbar .keyboard__dynamic").nextElementSibling : this.element;
        const actionBtn = action === "toolbar" ? toolbarElement.querySelector(`[data-type="${type}"]`) : undefined;
        const newNodes: Node[] = [];

        if (type === "clear" || actionBtn?.classList.contains("protyle-toolbar__item--current") || (
            action === "range" && rangeTypes.length > 0 && rangeTypes.includes(type) && !textObj
        )) {
            // 移除
            if (type === "clear") {
                toolbarElement.querySelectorAll('[data-type="em"],[data-type="u"],[data-type="s"],[data-type="mark"],[data-type="sup"],[data-type="sub"],[data-type="strong"]').forEach(item => {
                    item.classList.remove("protyle-toolbar__item--current");
                });
            } else if (actionBtn) {
                actionBtn.classList.remove("protyle-toolbar__item--current");
            }
            if (contents.childNodes.length === 0) {
                rangeTypes.find((itemType, index) => {
                    if (type === itemType) {
                        rangeTypes.splice(index, 1);
                        return true;
                    }
                });
                if (rangeTypes.length === 0) {
                    newNodes.push(document.createTextNode(Constants.ZWSP));
                } else {
                    // 遇到以下类型结尾不应继承 https://github.com/siyuan-note/siyuan/issues/7200
                    let removeIndex = 0;
                    while (removeIndex < rangeTypes.length) {
                        if (["inline-memo", "text", "block-ref", "file-annotation-ref", "a"].includes(rangeTypes[removeIndex])) {
                            rangeTypes.splice(removeIndex, 1);
                        } else {
                            ++removeIndex;
                        }
                    }
                    const inlineElement = document.createElement("span");
                    inlineElement.setAttribute("data-type", rangeTypes.join(" "));
                    inlineElement.textContent = Constants.ZWSP;
                    newNodes.push(inlineElement);
                }
            }
            contents.childNodes.forEach((item: HTMLElement, index) => {
                if (item.nodeType !== 3 && item.tagName !== "BR") {
                    const types = item.getAttribute("data-type").split(" ");
                    if (type === "clear") {
                        for (let i = 0; i < types.length; i++) {
                            if (textObj && textObj.type === "text") {
                                if ("text" === types[i]) {
                                    types.splice(i, 1);
                                    i--;
                                }
                            } else {
                                if (["kbd", "text", "strong", "em", "u", "s", "mark", "sup", "sub", "code"].includes(types[i])) {
                                    types.splice(i, 1);
                                    i--;
                                }
                            }
                        }
                    } else {
                        types.find((itemType, typeIndex) => {
                            if (type === itemType) {
                                types.splice(typeIndex, 1);
                                return true;
                            }
                        });
                    }
                    if (types.length === 0) {
                        if (item.textContent === "") {
                            item.textContent = Constants.ZWSP;
                        }
                        newNodes.push(document.createTextNode(item.textContent));
                    } else {
                        if (type === "clear") {
                            item.style.color = "";
                            item.style.webkitTextFillColor = "";
                            item.style.webkitTextStroke = "";
                            item.style.textShadow = "";
                            item.style.backgroundColor = "";
                            item.style.fontSize = "";
                        }
                        if (index === 0 && previousElement && previousElement.nodeType !== 3 &&
                            isArrayEqual(types, (previousElement.getAttribute("data-type") || "").split(" ")) &&
                            hasSameTextStyle(item, previousElement, textObj)) {
                            previousIndex = previousElement.textContent.length;
                            previousElement.innerHTML = previousElement.innerHTML + item.innerHTML;
                        } else if (index === contents.childNodes.length - 1 && nextElement && nextElement.nodeType !== 3 &&
                            isArrayEqual(types, (nextElement.getAttribute("data-type") || "").split(" ")) &&
                            hasSameTextStyle(item, nextElement, textObj)) {
                            nextIndex = item.textContent.length;
                            nextElement.innerHTML = item.innerHTML + nextElement.innerHTML;
                        } else {
                            item.setAttribute("data-type", types.join(" "));
                            newNodes.push(item);
                        }
                    }
                } else {
                    newNodes.push(item);
                }
            });
        } else {
            // 添加
            if (!this.element.classList.contains("fn__none") && type !== "text" && actionBtn) {
                actionBtn.classList.add("protyle-toolbar__item--current");
            }
            if (selectText === "") {
                const inlineElement = document.createElement("span");
                rangeTypes.push(type);

                // 遇到以下类型结尾不应继承 https://github.com/siyuan-note/siyuan/issues/7200
                if (isEndSpan) {
                    let removeIndex = 0;
                    while (removeIndex < rangeTypes.length) {
                        if (["inline-memo", "text", "block-ref", "file-annotation-ref", "a"].includes(rangeTypes[removeIndex])) {
                            rangeTypes.splice(removeIndex, 1);
                        } else {
                            ++removeIndex;
                        }
                    }
                }
                inlineElement.setAttribute("data-type", [...new Set(rangeTypes)].join(" "));
                inlineElement.textContent = Constants.ZWSP;
                setFontStyle(inlineElement, textObj);
                newNodes.push(inlineElement);
            } else {
                //  https://github.com/siyuan-note/siyuan/issues/7477
                if (type === "block-ref") {
                    contents.childNodes.forEach((item: HTMLElement, index) => {
                        if (index !== 0) {
                            item.remove();
                        }
                    });
                }
                contents.childNodes.forEach((item: HTMLElement, index) => {
                    if (item.nodeType === 3) {
                        if (index === 0 && previousElement && previousElement.nodeType !== 3 &&
                            type === previousElement.getAttribute("data-type") &&
                            hasSameTextStyle(item, previousElement, textObj)) {
                            previousIndex = previousElement.textContent.length;
                            previousElement.innerHTML = previousElement.innerHTML + item.textContent;
                        } else if (index === contents.childNodes.length - 1 && nextElement && nextElement.nodeType !== 3 &&
                            type === nextElement.getAttribute("data-type") &&
                            hasSameTextStyle(item, nextElement, textObj)) {
                            nextIndex = item.textContent.length;
                            nextElement.innerHTML = item.textContent + nextElement.innerHTML;
                        } else {
                            const inlineElement = document.createElement("span");
                            inlineElement.setAttribute("data-type", type);
                            inlineElement.textContent = item.textContent;
                            setFontStyle(inlineElement, textObj);
                            newNodes.push(inlineElement);
                        }
                    } else {
                        let types = (item.getAttribute("data-type") || "").split(" ");
                        for (let i = 0; i < types.length; i++) {
                            // "backslash", "virtual-block-ref", "search-mark" 只能单独存在
                            if (["backslash", "virtual-block-ref", "search-mark"].includes(types[i])) {
                                types.splice(i, 1);
                                i--;
                            }
                        }
                        types.push(type);
                        // 上标和下标不能同时存在 https://github.com/siyuan-note/insider/issues/1049
                        if (type === "sub" && types.includes("sup")) {
                            types.find((item, index) => {
                                if (item === "sup") {
                                    types.splice(index, 1);
                                    toolbarElement.querySelector('[data-type="sup"]').classList.remove("protyle-toolbar__item--current");
                                    return true;
                                }
                            });
                        } else if (type === "sup" && types.includes("sub")) {
                            types.find((item, index) => {
                                if (item === "sub") {
                                    types.splice(index, 1);
                                    toolbarElement.querySelector('[data-type="sub"]').classList.remove("protyle-toolbar__item--current");
                                    return true;
                                }
                            });
                        } else if (type === "block-ref" && types.includes("a")) {
                            // 虚拟引用和链接不能同时存在
                            types.find((item, index) => {
                                if (item === "a") {
                                    types.splice(index, 1);
                                    return true;
                                }
                            });
                        } else if (type === "a" && types.includes("block-ref")) {
                            // 链接和引用不能同时存在
                            types.find((item, index) => {
                                if (item === "block-ref") {
                                    types.splice(index, 1);
                                    return true;
                                }
                            });
                        } else if (type === "inline-memo" && types.includes("inline-math")) {
                            // 数学公式和备注不能同时存在
                            types.find((item, index) => {
                                if (item === "inline-math") {
                                    types.splice(index, 1);
                                    return true;
                                }
                            });
                            item.textContent = item.getAttribute("data-content");
                        } else if (type === "inline-math" && types.includes("inline-memo")) {
                            // 数学公式和备注不能同时存在
                            types.find((item, index) => {
                                if (item === "inline-memo") {
                                    types.splice(index, 1);
                                    return true;
                                }
                            });
                        }
                        types = [...new Set(types)];
                        if (index === 0 && previousElement && previousElement.nodeType !== 3 &&
                            isArrayEqual(types, (previousElement.getAttribute("data-type") || "").split(" ")) &&
                            hasSameTextStyle(item, previousElement, textObj)) {
                            previousIndex = previousElement.textContent.length;
                            previousElement.innerHTML = previousElement.innerHTML + item.innerHTML;
                        } else if (index === contents.childNodes.length - 1 && nextElement && nextElement.nodeType !== 3 &&
                            isArrayEqual(types, (nextElement.getAttribute("data-type") || "").split(" ")) &&
                            hasSameTextStyle(item, nextElement, textObj)) {
                            nextIndex = item.textContent.length;
                            nextElement.innerHTML = item.innerHTML + nextElement.innerHTML;
                        } else if (item.tagName !== "BR") {
                            if (item.getAttribute("data-type")?.indexOf("backslash") > -1 &&
                                item.firstChild?.textContent === "\\") {
                                item.firstChild.remove();
                            }
                            item.setAttribute("data-type", types.join(" "));
                            setFontStyle(item, textObj);
                            newNodes.push(item);
                        } else {
                            newNodes.push(item);
                        }
                    }
                });
            }
        }
        if (this.range.startContainer.nodeType !== 3 && (this.range.startContainer as HTMLElement).tagName === "SPAN" &&
            this.range.startContainer.isSameNode(this.range.endContainer) && !isEndSpan) {
            // 切割元素
            const startContainer = this.range.startContainer as HTMLElement;
            const afterElement = document.createElement("span");
            const attributes = startContainer.attributes;
            for (let i = 0; i < attributes.length; i++) {
                afterElement.setAttribute(attributes[i].name, attributes[i].value);
            }
            this.range.setEnd(startContainer.lastChild, startContainer.lastChild.textContent.length);
            afterElement.append(this.range.extractContents());
            startContainer.after(afterElement);
            this.range.setStartBefore(afterElement);
            this.range.collapse(true);
        }
        for (let i = 0; i < newNodes.length; i++) {
            const currentNewNode = newNodes[i] as HTMLElement;
            const nextNewNode = newNodes[i + 1] as HTMLElement;
            if (currentNewNode.nodeType !== 3 && nextNewNode && nextNewNode.nodeType !== 3 &&
                nextNewNode.tagName === currentNewNode.tagName &&
                isArrayEqual((nextNewNode.getAttribute("data-type") || "").split(" "), (currentNewNode.getAttribute("data-type") || "").split(" ")) &&
                currentNewNode.getAttribute("data-id") === nextNewNode.getAttribute("data-id") &&
                currentNewNode.getAttribute("data-subtype") === nextNewNode.getAttribute("data-subtype") &&
                currentNewNode.style.color === nextNewNode.style.color &&
                currentNewNode.style.webkitTextFillColor === nextNewNode.style.webkitTextFillColor &&
                currentNewNode.style.webkitTextStroke === nextNewNode.style.webkitTextStroke &&
                currentNewNode.style.textShadow === nextNewNode.style.textShadow &&
                currentNewNode.style.fontSize === nextNewNode.style.fontSize &&
                currentNewNode.style.backgroundColor === nextNewNode.style.backgroundColor) {
                // 合并相同的 node
                const currentType = currentNewNode.getAttribute("data-type");
                if (currentType.indexOf("inline-math") > -1) {
                    // 数学公式合并 data-content https://github.com/siyuan-note/siyuan/issues/6028
                    nextNewNode.setAttribute("data-content", currentNewNode.getAttribute("data-content") + nextNewNode.getAttribute("data-content"));
                } else {
                    // 测试不存在 https://ld246.com/article/1664454663564 情况，故移除引用合并限制
                    // 搜索结果引用被高亮隔断需进行合并 https://github.com/siyuan-note/siyuan/issues/7588
                    nextNewNode.innerHTML = currentNewNode.innerHTML + nextNewNode.innerHTML;
                    // 如果为备注时，合并备注内容
                    if (currentType.indexOf("inline-memo") > -1) {
                        nextNewNode.setAttribute("data-inline-memo-content", (currentNewNode.getAttribute("data-inline-memo-content") || "") +
                            (nextNewNode.getAttribute("data-inline-memo-content") || ""));
                    }
                }
                newNodes.splice(i, 1);
                i--;
            } else {
                this.range.insertNode(currentNewNode);
                // https://github.com/siyuan-note/siyuan/issues/6155
                if (currentNewNode.nodeType !== 3 && ["code", "tag", "kbd"].includes(type)) {
                    const previousSibling = hasPreviousSibling(currentNewNode);
                    if (!previousSibling || previousSibling.textContent.endsWith("\n")) {
                        currentNewNode.before(document.createTextNode(Constants.ZWSP));
                    }
                    if (!currentNewNode.textContent.startsWith(Constants.ZWSP)) {
                        currentNewNode.textContent = Constants.ZWSP + currentNewNode.textContent;
                    }
                    const currentNextSibling = hasNextSibling(currentNewNode);
                    if (!currentNextSibling ||
                        (currentNextSibling && (
                                currentNextSibling.nodeType !== 3 ||
                                (currentNextSibling.nodeType === 3 && !currentNextSibling.textContent.startsWith(Constants.ZWSP)))
                        )
                    ) {
                        currentNewNode.after(document.createTextNode(Constants.ZWSP));
                    }
                }
                this.range.collapse(false);
            }
        }
        if (previousElement) {
            if (previousElement.nodeType !== 3 && previousElement.textContent === Constants.ZWSP) {
                // https://github.com/siyuan-note/siyuan/issues/7548
                previousElement.remove();
            } else {
                this.mergeNode(previousElement.childNodes);
            }
        }
        if (nextElement) {
            this.mergeNode(nextElement.childNodes);
        }
        if (previousIndex) {
            this.range.setStart(previousElement.firstChild, previousIndex);
        } else if (newNodes.length > 0) {
            if (newNodes[0].nodeType !== 3 && (newNodes[0] as HTMLElement).getAttribute("data-type") === "inline-math") {
                // 数学公式后面处理
            } else {
                if (newNodes[0].firstChild) {
                    if (newNodes[0].firstChild.textContent === Constants.ZWSP) {
                        // 新建元素时光标消失 https://github.com/siyuan-note/siyuan/issues/6481
                        // 新建元素粘贴后元素消失 https://ld246.com/article/1665556907936
                        this.range.setStart(newNodes[0].firstChild, 1);
                    } else {
                        this.range.setStart(newNodes[0].firstChild, 0);
                    }
                } else if (newNodes[0].nodeType === 3) {
                    this.range.setStart(newNodes[0], 0);
                } else {
                    this.range.setStartBefore(newNodes[0]);
                }
            }
        } else if (nextElement) {
            // aaa**bbb** 选中 aaa 加粗
            this.range.setStart(nextElement.firstChild, 0);
        }
        if (nextIndex) {
            this.range.setEnd(nextElement.lastChild, nextIndex);
        } else if (newNodes.length > 0) {
            const lastNewNode = newNodes[newNodes.length - 1];
            if (lastNewNode.nodeType !== 3 && (lastNewNode as HTMLElement).getAttribute("data-type").indexOf("inline-math") > -1) {
                const mathPreviousSibling = hasPreviousSibling(lastNewNode);
                if (mathPreviousSibling && mathPreviousSibling.nodeType === 3) {
                    this.range.setStart(mathPreviousSibling, mathPreviousSibling.textContent.length);
                } else {
                    this.range.setStartBefore(lastNewNode);
                }
                const mathNextSibling = hasNextSibling(lastNewNode);
                if (mathNextSibling && mathNextSibling.nodeType === 3) { // https://github.com/siyuan-note/siyuan/issues/6065
                    this.range.setEnd(mathNextSibling, 0);
                } else {
                    this.range.setEndAfter(lastNewNode);
                }
            } else {
                if (lastNewNode.lastChild) {
                    if (lastNewNode.lastChild.textContent === Constants.ZWSP) {
                        // 新建元素时光标消失 https://github.com/siyuan-note/siyuan/issues/6481
                        // 新建元素粘贴后元素消失 https://ld246.com/article/1665556907936
                        this.range.collapse(true);
                    } else {
                        this.range.setEnd(lastNewNode.lastChild, lastNewNode.lastChild.textContent.length);
                    }
                } else if (lastNewNode.nodeType === 3) {
                    this.range.setEnd(lastNewNode, lastNewNode.textContent.length);
                    if (lastNewNode.textContent === Constants.ZWSP) {
                        // 粗体后取消粗体光标不存在 https://github.com/siyuan-note/insider/issues/1056
                        this.range.collapse(false);
                    }
                } else {
                    // eg: 表格中有3行时，选中第二行三级，多次加粗会增加换行
                    this.range.setEndAfter(lastNewNode);
                }
            }
        } else if (previousElement) {
            // **aaa**bbb 选中 bbb 加粗
            // 需进行 mergeNode ，否用 alt+x 为相同颜色 aaabbb 中的 bbb 再次赋值后无法选中
            this.range.setEnd(previousElement.firstChild, previousElement.firstChild.textContent.length);
        }
        let needFocus = true;
        if (type === "inline-math") {
            mathRender(nodeElement);
            if (selectText === "") {
                protyle.toolbar.showRender(protyle, newNodes[0] as HTMLElement, undefined, html);
                return;
            }
        } else if (type === "inline-memo") {
            protyle.toolbar.showRender(protyle, newNodes[0] as HTMLElement, newNodes as Element[], html);
            return;
        } else if (type === "block-ref") {
            this.range.collapse(false);
        } else if (type === "a") {
            const aElement = newNodes[0] as HTMLElement;
            if (aElement.textContent.replace(Constants.ZWSP, "") === "" || !aElement.getAttribute("data-href")) {
                needFocus = false;
                linkMenu(protyle, aElement, aElement.getAttribute("data-href") ? true : false);
            } else {
                this.range.collapse(false);
            }
        }
        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
        const wbrElement = nodeElement.querySelector("wbr");
        if (wbrElement) {
            wbrElement.remove();
        }
        if (needFocus) {
            focusByRange(this.range);
        }
    }

    public showFileAnnotationRef(protyle: IProtyle, refElement: HTMLElement) {
        const nodeElement = hasClosestBlock(refElement);
        if (!nodeElement) {
            return;
        }
        hideElements(["hint"], protyle);
        window.siyuan.menus.menu.remove();
        const id = nodeElement.getAttribute("data-node-id");
        const html = nodeElement.outerHTML;
        this.subElement.style.padding = "";
        this.subElement.innerHTML = `<div class="b3-form__space--small">
<label class="fn__flex">
    <span class="ft__on-surface fn__flex-center" style="width: 64px">ID</span>
    <div class="fn__space"></div>
    <input data-type="id" value="${refElement.getAttribute("data-id") || ""}" class="b3-text-field fn__block" readonly />
</label>
<div class="fn__hr"></div>
<label class="fn__flex">
    <span class="ft__on-surface fn__flex-center" style="width: 64px">${window.siyuan.languages.anchor}</span>
    <div class="fn__space"></div>
    <input data-type="anchor" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.anchor}" />
</label>
<div class="fn__hr"></div>
<div class="fn__hr"></div>
<div class="fn__flex"><span class="fn__flex-1"></span>
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.remove}</button>
</div></div>`;
        this.subElement.querySelector(".b3-button--cancel").addEventListener(getEventName(), () => {
            refElement.outerHTML = refElement.textContent + "<wbr>";
            hideElements(["util"], protyle);
        });
        const anchorElement = this.subElement.querySelector('[data-type="anchor"]') as HTMLInputElement;
        anchorElement.value = refElement.textContent;
        anchorElement.addEventListener("input", (event) => {
            if (anchorElement.value) {
                refElement.innerHTML = Lute.EscapeHTMLStr(anchorElement.value);
            } else {
                refElement.innerHTML = "*";
            }
            event.stopPropagation();
        });
        anchorElement.addEventListener("keydown", (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            if (event.key === "Enter" || event.key === "Escape") {
                hideElements(["util"], protyle);
                event.preventDefault();
                event.stopPropagation();
            }
        });
        this.subElement.classList.remove("fn__none");
        this.subElementCloseCB = () => {
            if (refElement.parentElement) {
                if (anchorElement.value) {
                    refElement.innerHTML = Lute.EscapeHTMLStr(anchorElement.value);
                } else {
                    refElement.innerHTML = "*";
                }
                this.range.setStartAfter(refElement);
                focusByRange(this.range);
            } else {
                focusByWbr(nodeElement, this.range);
            }
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
        };
        /// #if !MOBILE
        this.subElement.style.width = Math.min(480, window.innerWidth) + "px";
        const nodeRect = refElement.getBoundingClientRect();
        setPosition(this.subElement, nodeRect.left, nodeRect.bottom, nodeRect.height + 4);
        /// #endif
        this.element.classList.add("fn__none");
        anchorElement.select();
    }

    public showRender(protyle: IProtyle, renderElement: Element, updateElements?: Element[], oldHTML?: string) {
        const nodeElement = hasClosestBlock(renderElement);
        if (!nodeElement) {
            return;
        }
        hideElements(["hint"], protyle);
        window.siyuan.menus.menu.remove();
        const id = nodeElement.getAttribute("data-node-id");
        const types = (renderElement.getAttribute("data-type") || "").split(" ");
        const html = oldHTML || protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
        let title = "HTML";
        let placeholder = "";
        const isInlineMemo = types.includes("inline-memo");
        switch (renderElement.getAttribute("data-subtype")) {
            case "abc":
                title = window.siyuan.languages.staff;
                break;
            case "echarts":
                title = window.siyuan.languages.chart;
                break;
            case "flowchart":
                title = "Flow Chart";
                break;
            case "graphviz":
                title = "Graphviz";
                break;
            case "mermaid":
                title = "Mermaid";
                break;
            case "mindmap":
                placeholder = `- foo
  - bar
- baz`;
                title = window.siyuan.languages.mindmap;
                break;
            case "plantuml":
                title = "UML";
                break;
            case "math":
                if (types.includes("NodeMathBlock")) {
                    title = window.siyuan.languages.math;
                } else {
                    title = window.siyuan.languages["inline-math"];
                }
                break;
        }
        if (types.includes("NodeBlockQueryEmbed")) {
            title = window.siyuan.languages.blockEmbed;
        } else if (isInlineMemo) {
            title = window.siyuan.languages.memo;
        }
        const isPin = this.subElement.querySelector('[data-type="pin"]')?.classList.contains("block__icon--active");
        const pinData: IObject = {};
        if (isPin) {
            const textElement = this.subElement.querySelector(".b3-text-field") as HTMLTextAreaElement;
            pinData.styleH = textElement.style.height;
            pinData.styleW = textElement.style.width;
        } else {
            this.subElement.style.width = "";
            this.subElement.style.padding = "0";
        }
        this.subElement.innerHTML = `<div ${(isPin && this.subElement.firstElementChild.getAttribute("data-drag") === "true") ? 'data-drag="true"' : ""} class="block__popover--move"><div class="block__icons block__icons--border fn__flex">
    ${title}
    <span class="fn__flex-1"></span>
    <button data-type="refresh" class="block__icon b3-tooltips b3-tooltips__nw${(isPin && !this.subElement.querySelector('[data-type="refresh"]').classList.contains("block__icon--active")) ? "" : " block__icon--active"}${types.includes("NodeBlockQueryEmbed") ? " fn__none" : ""}" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href="#iconRefresh"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="before" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages["insert-before"]}"><svg><use xlink:href="#iconBefore"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="after" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages["insert-after"]}"><svg><use xlink:href="#iconAfter"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="export" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.export} ${window.siyuan.languages.image}"><svg><use xlink:href="#iconImage"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="pin" class="block__icon b3-tooltips b3-tooltips__nw${isPin ? " block__icon--active" : ""}" aria-label="${window.siyuan.languages.pin}"><svg><use xlink:href="#iconPin"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="close" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.close}"><svg style="width: 10px"><use xlink:href="#iconClose"></use></svg></button>
</div>
<textarea spellcheck="false" class="b3-text-field b3-text-field--text fn__block" placeholder="${placeholder}" style="${isMobile() ? "" : "width:" + Math.max(480, renderElement.clientWidth * 0.7) + "px"};max-height:50vh"></textarea></div>`;
        const autoHeight = () => {
            textElement.style.height = textElement.scrollHeight + "px";
            if (isMobile()) {
                return;
            }
            if (this.subElement.firstElementChild.getAttribute("data-drag") === "true") {
                if (textElement.getBoundingClientRect().bottom > window.innerHeight) {
                    this.subElement.style.top = window.innerHeight - this.subElement.clientHeight + "px";
                }
                return;
            }
            const bottom = nodeRect.bottom === nodeRect.top ? nodeRect.bottom + 26 : nodeRect.bottom;
            if (this.subElement.clientHeight <= window.innerHeight - bottom || this.subElement.clientHeight <= nodeRect.top) {
                if (types.includes("inline-math") || isInlineMemo) {
                    setPosition(this.subElement, nodeRect.left, bottom, nodeRect.height || 26);
                } else {
                    setPosition(this.subElement, nodeRect.left + (nodeRect.width - this.subElement.clientWidth) / 2, bottom, nodeRect.height || 26);
                }
            } else {
                setPosition(this.subElement, nodeRect.right, bottom);
            }
        };
        const headerElement = this.subElement.querySelector(".block__icons");
        headerElement.addEventListener("click", (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const btnElement = hasClosestByClassName(target, "b3-tooltips");
            if (!btnElement) {
                if (event.detail === 2) {
                    const pingElement = headerElement.querySelector('[data-type="pin"]');
                    if (pingElement.classList.contains("block__icon--active")) {
                        pingElement.classList.remove("block__icon--active");
                        pingElement.setAttribute("aria-label", window.siyuan.languages.pin);
                    } else {
                        pingElement.classList.add("block__icon--active");
                        pingElement.setAttribute("aria-label", window.siyuan.languages.unpin);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }
            event.stopPropagation();
            switch (btnElement.getAttribute("data-type")) {
                case "close":
                    this.subElement.querySelector('[data-type="pin"]').classList.remove("block__icon--active");
                    hideElements(["util"], protyle);
                    break;
                case "pin":
                    if (btnElement.classList.contains("block__icon--active")) {
                        btnElement.classList.remove("block__icon--active");
                        btnElement.setAttribute("aria-label", window.siyuan.languages.pin);
                    } else {
                        btnElement.classList.add("block__icon--active");
                        btnElement.setAttribute("aria-label", window.siyuan.languages.unpin);
                    }
                    break;
                case "refresh":
                    btnElement.classList.toggle("block__icon--active");
                    break;
                case "before":
                    insertEmptyBlock(protyle, "beforebegin", id);
                    hideElements(["util"], protyle);
                    break;
                case "after":
                    insertEmptyBlock(protyle, "afterend", id);
                    hideElements(["util"], protyle);
                    break;
                case "export":
                    exportImg();
                    break;
            }
        });
        const exportImg = () => {
            const msgId = showMessage(window.siyuan.languages.exporting, 0);
            if (renderElement.getAttribute("data-subtype") === "plantuml") {
                fetch(renderElement.querySelector("img").getAttribute("src")).then(function (response) {
                    return response.blob();
                }).then(function (blob) {
                    const formData = new FormData();
                    formData.append("file", blob);
                    formData.append("type", "image/png");
                    fetchPost("/api/export/exportAsFile", formData, (response) => {
                        openByMobile(response.data.file);
                        hideMessage(msgId);
                    });
                });
                return;
            }
            setTimeout(() => {
                addScript("stage/protyle/js/html2canvas.min.js?v=1.4.1", "protyleHtml2canvas").then(() => {
                    window.html2canvas(renderElement).then((canvas) => {
                        canvas.toBlob((blob: Blob) => {
                            const formData = new FormData();
                            formData.append("file", blob);
                            formData.append("type", "image/png");
                            fetchPost("/api/export/exportAsFile", formData, (response) => {
                                openByMobile(response.data.file);
                                hideMessage(msgId);
                            });
                        });
                    });
                });
            }, Constants.TIMEOUT_TRANSITION);
        };
        headerElement.addEventListener("mousedown", (event: MouseEvent) => {
            if (hasClosestByClassName(event.target as HTMLElement, "block__icon")) {
                return;
            }
            event.stopPropagation();
            const documentSelf = document;
            this.subElement.style.userSelect = "none";
            const x = event.clientX - parseInt(this.subElement.style.left);
            const y = event.clientY - parseInt(this.subElement.style.top);
            documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                let positionX = moveEvent.clientX - x;
                let positionY = moveEvent.clientY - y;
                if (positionX > window.innerWidth - this.subElement.clientWidth) {
                    positionX = window.innerWidth - this.subElement.clientWidth;
                }
                if (positionY > window.innerHeight - this.subElement.clientHeight) {
                    positionY = window.innerHeight - this.subElement.clientHeight;
                }
                this.subElement.style.left = Math.max(positionX, 0) + "px";
                this.subElement.style.top = Math.max(positionY, Constants.SIZE_TOOLBAR_HEIGHT) + "px";
                this.subElement.firstElementChild.setAttribute("data-drag", "true");
            };
            documentSelf.onmouseup = () => {
                const pinElement = headerElement.querySelector('[data-type="pin"]');
                pinElement.classList.add("block__icon--active");
                pinElement.setAttribute("aria-label", window.siyuan.languages.unpin);
                this.subElement.style.userSelect = "auto";
                documentSelf.onmousemove = null;
                documentSelf.onmouseup = null;
                documentSelf.ondragstart = null;
                documentSelf.onselectstart = null;
                documentSelf.onselect = null;
            };
            return;
        });
        const textElement = this.subElement.querySelector(".b3-text-field") as HTMLTextAreaElement;
        if (types.includes("NodeHTMLBlock")) {
            textElement.value = Lute.UnEscapeHTMLStr(renderElement.querySelector("protyle-html").getAttribute("data-content") || "");
        } else if (isInlineMemo) {
            textElement.value = Lute.UnEscapeHTMLStr(renderElement.getAttribute("data-inline-memo-content") || "");
        } else {
            textElement.value = Lute.UnEscapeHTMLStr(renderElement.getAttribute("data-content") || "");
        }

        textElement.addEventListener("input", (event) => {
            if (!renderElement.parentElement) {
                return;
            }
            if (textElement.clientHeight !== textElement.scrollHeight) {
                autoHeight();
            }
            if (!this.subElement.querySelector('[data-type="refresh"]').classList.contains("block__icon--active")) {
                return;
            }
            if (types.includes("NodeHTMLBlock")) {
                renderElement.querySelector("protyle-html").setAttribute("data-content", Lute.EscapeHTMLStr(textElement.value));
            } else if (isInlineMemo) {
                let inlineMemoElements;
                if (updateElements) {
                    inlineMemoElements = updateElements;
                } else {
                    inlineMemoElements = [renderElement];
                }
                inlineMemoElements.forEach((item) => {
                    item.setAttribute("data-inline-memo-content", Lute.EscapeHTMLStr(textElement.value));
                });
            } else {
                renderElement.setAttribute("data-content", Lute.EscapeHTMLStr(textElement.value));
                renderElement.removeAttribute("data-render");
            }
            if (!types.includes("NodeBlockQueryEmbed") || !types.includes("NodeHTMLBlock") || !isInlineMemo) {
                processRender(renderElement);
            }
            event.stopPropagation();
        });
        textElement.addEventListener("keydown", (event: KeyboardEvent) => {
            event.stopPropagation();
            // 阻止 ctrl+m 缩小窗口 https://github.com/siyuan-note/siyuan/issues/5541
            if (matchHotKey(window.siyuan.config.keymap.editor.insert["inline-math"].custom, event)) {
                event.preventDefault();
                return;
            }
            if (event.isComposing) {
                return;
            }
            if (event.key === "Escape" || matchHotKey("⌘↩", event)) {
                this.subElement.querySelector('[data-type="pin"]').classList.remove("block__icon--active");
                hideElements(["util"], protyle);
            } else if (event.key === "Tab") {
                // https://github.com/siyuan-note/siyuan/issues/5270
                document.execCommand("insertText", false, "\t");
                event.preventDefault();
            } else if (electronUndo(event)) {
                return;
            }
        });
        this.subElementCloseCB = () => {
            if (!renderElement.parentElement) {
                return;
            }
            let inlineLastNode: Element;
            if (types.includes("NodeHTMLBlock")) {
                let html = textElement.value;
                if (html) {
                    // 需移除首尾的空白字符与连续的换行 (空行) https://github.com/siyuan-note/siyuan/issues/7921
                    html = html.trim().replace(/\n+/g, "\n");
                    // 需一对 div 标签包裹，否则行内元素会解析错误 https://github.com/siyuan-note/siyuan/issues/6764
                    if (!(html.startsWith("<div>") && html.endsWith("</div>"))) {
                        html = `<div>\n${html}\n</div>`;
                    }
                }
                renderElement.querySelector("protyle-html").setAttribute("data-content", Lute.EscapeHTMLStr(html));
            } else if (isInlineMemo) {
                let inlineMemoElements;
                if (updateElements) {
                    inlineMemoElements = updateElements;
                } else {
                    inlineMemoElements = [renderElement];
                }
                inlineMemoElements.forEach((item, index) => {
                    if (!textElement.value) {
                        // https://github.com/siyuan-note/insider/issues/1046
                        const currentTypes = item.getAttribute("data-type").split(" ");
                        if (currentTypes.length === 1 && currentTypes[0] === "inline-memo") {
                            item.outerHTML = item.innerHTML + (index === inlineMemoElements.length - 1 ? "<wbr>" : "");
                        } else {
                            currentTypes.find((typeItem, index) => {
                                if (typeItem === "inline-memo") {
                                    currentTypes.splice(index, 1);
                                    return true;
                                }
                            });
                            item.setAttribute("data-type", currentTypes.join(" "));
                            item.removeAttribute("data-inline-memo-content");
                        }
                        if (index === inlineMemoElements.length - 1) {
                            inlineLastNode = item;
                        }
                    } else {
                        // 行级备注自动移除换行  https://ld246.com/article/1664205917326
                        item.setAttribute("data-inline-memo-content", Lute.EscapeHTMLStr(textElement.value.replace(/\n/g, " ")));
                    }
                });
            } else if (types.includes("inline-math")) {
                // 行内数学公式不允许换行 https://github.com/siyuan-note/siyuan/issues/2187
                if (textElement.value) {
                    renderElement.setAttribute("data-content", Lute.EscapeHTMLStr(textElement.value.replace(/\n/g, "")));
                    renderElement.removeAttribute("data-render");
                    processRender(renderElement);
                } else {
                    inlineLastNode = renderElement;
                    // esc 后需要 focus range，但点击空白处不能 focus range，否则光标无法留在点击位置
                    renderElement.outerHTML = "<wbr>";
                }
            } else {
                renderElement.setAttribute("data-content", Lute.EscapeHTMLStr(textElement.value));
                renderElement.removeAttribute("data-render");
                if (types.includes("NodeBlockQueryEmbed")) {
                    blockRender(protyle, renderElement);
                } else {
                    processRender(renderElement);
                }
            }

            // 光标定位
            if (getSelection().rangeCount === 0) {  // https://ld246.com/article/1665306093005
                if (renderElement.tagName === "SPAN") {
                    if (inlineLastNode) {
                        if (inlineLastNode.parentElement) {
                            this.range.setStartAfter(inlineLastNode);
                            this.range.collapse(true);
                            focusByRange(this.range);
                        } else {
                            focusByWbr(nodeElement, this.range);
                        }
                    } else if (renderElement.parentElement) {
                        this.range.setStartAfter(renderElement);
                        this.range.collapse(true);
                        focusByRange(this.range);
                    }
                } else {
                    focusBlock(renderElement);
                    renderElement.classList.add("protyle-wysiwyg--select");
                }
            } else {
                // ctrl+M 后点击空白会留下 wbr
                nodeElement.querySelector("wbr")?.remove();
            }

            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            const newHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
            // HTML 块中包含多个 <pre> 时只能保存第一个 https://github.com/siyuan-note/siyuan/issues/5732
            if (types.includes("NodeHTMLBlock")) {
                const tempElement = document.createElement("template");
                tempElement.innerHTML = newHTML;
                if (tempElement.content.childElementCount > 1) {
                    showMessage(window.siyuan.languages.htmlBlockTip);
                }
            }
            updateTransaction(protyle, id, newHTML, html);
        };
        this.subElement.classList.remove("fn__none");
        const nodeRect = renderElement.getBoundingClientRect();
        this.element.classList.add("fn__none");
        if (isPin) {
            textElement.style.width = pinData.styleW;
            textElement.style.height = pinData.styleH;
        } else {
            autoHeight();
        }
        textElement.select();
    }

    public showCodeLanguage(protyle: IProtyle, languageElement: HTMLElement) {
        const nodeElement = hasClosestBlock(languageElement);
        if (!nodeElement) {
            return;
        }
        hideElements(["hint"], protyle);
        window.siyuan.menus.menu.remove();
        this.range = getEditorRange(nodeElement);
        const id = nodeElement.getAttribute("data-node-id");
        let oldHtml = nodeElement.outerHTML;
        let html = `<div class="b3-list-item b3-list-item--focus">${window.siyuan.languages.clear}</div>`;
        Constants.CODE_LANGUAGES.forEach((item) => {
            html += `<div class="b3-list-item">${item}</div>`;
        });
        this.subElement.style.width = "";
        this.subElement.style.padding = "";
        this.subElement.innerHTML = `<div class="fn__flex-column" style="max-height:50vh"><input placeholder="${window.siyuan.languages.search}" style="margin: 4px 8px 8px 8px" class="b3-text-field"/>
<div class="b3-list fn__flex-1 b3-list--background" style="position: relative">${html}</div>
</div>`;

        const inputElement = this.subElement.querySelector("input");
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            upDownHint(this.subElement.lastElementChild.lastElementChild as HTMLElement, event);
            if (event.key === "Enter") {
                const activeText = this.subElement.querySelector(".b3-list-item--focus").textContent;
                languageElement.textContent = activeText === window.siyuan.languages.clear ? "" : activeText;
                window.siyuan.storage[Constants.LOCAL_CODELANG] = languageElement.textContent;
                setStorageVal(Constants.LOCAL_CODELANG, window.siyuan.storage[Constants.LOCAL_CODELANG]);
                const editElement = getContenteditableElement(nodeElement);
                const lineNumber = nodeElement.getAttribute("linenumber");
                if (lineNumber === "true" || (lineNumber !== "false" && window.siyuan.config.editor.codeSyntaxHighlightLineNum)) {
                    editElement.classList.add("protyle-linenumber");
                } else {
                    editElement.classList.remove("protyle-linenumber");
                }
                (editElement as HTMLElement).textContent = editElement.textContent;
                editElement.removeAttribute("data-render");
                highlightRender(nodeElement);
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHtml);
                oldHtml = nodeElement.outerHTML;
                event.preventDefault();
                event.stopPropagation();
            }
            if (event.key === "Escape" || event.key === "Enter") {
                this.subElement.classList.add("fn__none");
                focusByRange(this.range);
            }
        });
        inputElement.addEventListener("input", (event) => {
            const matchLanguages: string[] = [];
            Constants.CODE_LANGUAGES.forEach((item) => {
                if (item.indexOf(inputElement.value.toLowerCase()) > -1) {
                    matchLanguages.push(item);

                }
            });
            let html = "";
            // sort
            let matchInput = false;
            matchLanguages.sort((a, b) => {
                if (a.startsWith(inputElement.value.toLowerCase()) && b.startsWith(inputElement.value.toLowerCase())) {
                    if (a.length < b.length) {
                        return -1;
                    } else if (a.length === b.length) {
                        return 0;
                    } else {
                        return 1;
                    }
                } else if (a.startsWith(inputElement.value.toLowerCase())) {
                    return -1;
                } else if (b.startsWith(inputElement.value.toLowerCase())) {
                    return 1;
                } else {
                    return 0;
                }
            }).forEach((item) => {
                if (inputElement.value === item) {
                    matchInput = true;
                }
                html += `<div class="b3-list-item">${item.replace(inputElement.value.toLowerCase(), "<b>" + inputElement.value.toLowerCase() + "</b>")}</div>`;
            });
            if (inputElement.value.trim() && !matchInput) {
                html = `<div class="b3-list-item"><b>${inputElement.value.replace(/`| /g, "_")}</b></div>${html}`;
            }
            this.subElement.firstElementChild.lastElementChild.innerHTML = html;
            if (html) {
                this.subElement.firstElementChild.lastElementChild.firstElementChild.classList.add("b3-list-item--focus");
            }
            event.stopPropagation();
        });
        this.subElement.lastElementChild.lastElementChild.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            const listElement = hasClosestByClassName(target, "b3-list-item");
            if (!listElement) {
                return;
            }
            languageElement.textContent = listElement.textContent === window.siyuan.languages.clear ? "" : listElement.textContent;
            window.siyuan.storage[Constants.LOCAL_CODELANG] = languageElement.textContent;
            setStorageVal(Constants.LOCAL_CODELANG, window.siyuan.storage[Constants.LOCAL_CODELANG]);
            const nodeElement = hasClosestBlock(languageElement);
            if (nodeElement) {
                const editElement = getContenteditableElement(nodeElement);
                const lineNumber = nodeElement.getAttribute("linenumber");
                if (lineNumber === "true" || (lineNumber !== "false" && window.siyuan.config.editor.codeSyntaxHighlightLineNum)) {
                    editElement.classList.add("protyle-linenumber");
                } else {
                    editElement.classList.remove("protyle-linenumber");
                }
                (editElement as HTMLElement).textContent = editElement.textContent;
                editElement.removeAttribute("data-render");
                highlightRender(nodeElement);
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHtml);
                oldHtml = nodeElement.outerHTML;
                this.subElement.classList.add("fn__none");
                focusByRange(this.range);
            }
        });
        this.subElement.classList.remove("fn__none");
        this.subElementCloseCB = undefined;
        /// #if !MOBILE
        const nodeRect = languageElement.getBoundingClientRect();
        setPosition(this.subElement, nodeRect.left, nodeRect.bottom, nodeRect.height);
        /// #endif
        this.element.classList.add("fn__none");
        inputElement.select();
    }

    public showTpl(protyle: IProtyle, nodeElement: HTMLElement, range: Range) {
        this.range = range;
        hideElements(["hint"], protyle);
        window.siyuan.menus.menu.remove();
        this.subElement.style.width = "";
        this.subElement.style.padding = "";
        this.subElement.innerHTML = `<div style="max-height:50vh" class="fn__flex">
<div class="fn__flex-column" style="${isMobile() ? "width: 100%" : "min-width: 260px;max-width:50vw"}">
    <div class="fn__flex" style="margin: 4px 8px 8px 8px">
        <input class="b3-text-field fn__flex-1"/>
        <span class="fn__space"></span>
        <span data-type="previous" class="block__icon block__icon--show"><svg><use xlink:href="#iconLeft"></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="next" class="block__icon block__icon--show"><svg><use xlink:href="#iconRight"></use></svg></span>
    </div>
    <div class="b3-list fn__flex-1 b3-list--background" style="position: relative"><img style="margin: 0 auto;display: block;width: 64px;height: 64px" src="/stage/loading-pure.svg"></div>
</div>
<div style="width: 520px;${isMobile() || window.outerWidth < window.outerWidth / 2 + 520 ? "display:none" : ""};overflow: auto;"></div>
</div>`;
        const listElement = this.subElement.querySelector(".b3-list");
        const previewElement = this.subElement.firstElementChild.lastElementChild;
        let previewPath = listElement.firstElementChild.getAttribute("data-value");
        previewTemplate(previewPath, previewElement, protyle.block.parentID);
        listElement.addEventListener("mouseover", (event) => {
            const target = event.target as HTMLElement;
            const hoverItemElement = hasClosestByClassName(target, "b3-list-item");
            if (!hoverItemElement) {
                return;
            }
            const currentPath = hoverItemElement.getAttribute("data-value");
            if (previewPath === currentPath) {
                return;
            }
            previewPath = currentPath;
            previewTemplate(previewPath, previewElement, protyle.block.parentID);
        });
        const inputElement = this.subElement.querySelector("input");
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            const isEmpty = !this.subElement.querySelector(".b3-list-item");
            if (!isEmpty) {
                const currentElement = upDownHint(listElement, event);
                if (currentElement) {
                    const currentPath = currentElement.getAttribute("data-value");
                    if (previewPath === currentPath) {
                        return;
                    }
                    previewPath = currentPath;
                    previewTemplate(previewPath, previewElement, protyle.block.parentID);
                }
            }
            if (event.key === "Enter") {
                if (!isEmpty) {
                    hintRenderTemplate(decodeURIComponent(this.subElement.querySelector(".b3-list-item--focus").getAttribute("data-value")), protyle, nodeElement);
                } else {
                    focusByRange(this.range);
                }
                this.subElement.classList.add("fn__none");
                event.preventDefault();
            } else if (event.key === "Escape") {
                this.subElement.classList.add("fn__none");
                focusByRange(this.range);
            }
        });
        inputElement.addEventListener("input", (event) => {
            event.stopPropagation();
            fetchPost("/api/search/searchTemplate", {
                k: inputElement.value,
            }, (response) => {
                let searchHTML = "";
                response.data.blocks.forEach((item: { path: string, content: string }, index: number) => {
                    searchHTML += `<div data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.content}</div>`;
                });
                listElement.innerHTML = searchHTML || `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
                const currentPath = response.data.blocks[0]?.path;
                if (previewPath === currentPath) {
                    return;
                }
                previewPath = currentPath;
                previewTemplate(previewPath, previewElement, protyle.block.parentID);
            });
        });
        this.subElement.lastElementChild.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains("b3-list--empty")) {
                this.subElement.classList.add("fn__none");
                focusByRange(this.range);
                event.stopPropagation();
                return;
            }
            const iconElement = hasClosestByClassName(target, "b3-list-item__action");
            /// #if !BROWSER
            if (iconElement && iconElement.getAttribute("data-type") === "open") {
                openBy(iconElement.parentElement.getAttribute("data-value"), "folder");
                event.stopPropagation();
                return;
            }
            /// #endif
            if (iconElement && iconElement.getAttribute("data-type") === "remove") {
                confirmDialog(window.siyuan.languages.remove, window.siyuan.languages.confirmDelete + "?", () => {
                    fetchPost("/api/search/removeTemplate", {path: iconElement.parentElement.getAttribute("data-value")}, () => {
                        if (iconElement.parentElement.parentElement.childElementCount === 1) {
                            iconElement.parentElement.parentElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
                            previewTemplate("", previewElement, protyle.block.parentID);
                        } else {
                            if (iconElement.parentElement.classList.contains("b3-list-item--focus")) {
                                const sideElement = iconElement.parentElement.previousElementSibling || iconElement.parentElement.nextElementSibling;
                                sideElement.classList.add("b3-list-item--focus");
                                const currentPath = sideElement.getAttribute("data-value");
                                if (previewPath === currentPath) {
                                    return;
                                }
                                previewPath = currentPath;
                                previewTemplate(previewPath, previewElement, protyle.block.parentID);
                            }
                            iconElement.parentElement.remove();
                        }
                    });
                });
                event.stopPropagation();
                return;
            }
            const previousElement = hasClosestByAttribute(target, "data-type", "previous");
            if (previousElement) {
                inputElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowUp"}));
                event.stopPropagation();
                return;
            }
            const nextElement = hasClosestByAttribute(target, "data-type", "next");
            if (nextElement) {
                inputElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown"}));
                event.stopPropagation();
                return;
            }
            const listElement = hasClosestByClassName(target, "b3-list-item");
            if (listElement) {
                hintRenderTemplate(decodeURIComponent(listElement.getAttribute("data-value")), protyle, nodeElement);
                event.stopPropagation();
            }
        });
        this.subElement.classList.remove("fn__none");
        this.subElementCloseCB = undefined;
        /// #if !MOBILE
        const rangePosition = getSelectionPosition(nodeElement, range);
        setPosition(this.subElement, rangePosition.left, rangePosition.top + 18, Constants.SIZE_TOOLBAR_HEIGHT);
        (this.subElement.firstElementChild as HTMLElement).style.maxHeight = Math.min(window.innerHeight * 0.8, window.innerHeight - this.subElement.getBoundingClientRect().top) - 16 + "px";
        /// #endif
        this.element.classList.add("fn__none");
        inputElement.select();
        fetchPost("/api/search/searchTemplate", {
            k: "",
        }, (response) => {
            let html = "";
            response.data.blocks.forEach((item: { path: string, content: string }, index: number) => {
                html += `<div data-value="${item.path}" class="b3-list-item--hide-action b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">
<span class="b3-list-item__text">${item.content}</span>`;
                /// #if !BROWSER
                html += `<span data-type="open" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.showInFolder}">
    <svg><use xlink:href="#iconFolder"></use></svg>
</span>`;
                /// #endif
                html += `<span data-type="remove" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span></div>`;
            });
            if (html === "") {
                html = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
            }
            this.subElement.querySelector(".b3-list--background").innerHTML = html;
        });
    }

    public showWidget(protyle: IProtyle, nodeElement: HTMLElement, range: Range) {
        this.range = range;
        hideElements(["hint"], protyle);
        window.siyuan.menus.menu.remove();
        this.subElement.style.width = "";
        this.subElement.style.padding = "";
        this.subElement.innerHTML = `<div class="fn__flex-column" style="max-height:50vh"><input style="margin: 4px 8px 8px 8px" class="b3-text-field"/>
<div class="b3-list fn__flex-1 b3-list--background" style="position: relative"><img style="margin: 0 auto;display: block;width: 64px;height:64px" src="/stage/loading-pure.svg"></div>
</div>`;

        const inputElement = this.subElement.querySelector("input");
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            upDownHint(this.subElement.lastElementChild.lastElementChild as HTMLElement, event);
            if (event.key === "Enter") {
                hintRenderWidget(this.subElement.querySelector(".b3-list-item--focus").textContent, protyle);
                this.subElement.classList.add("fn__none");
                event.preventDefault();
            } else if (event.key === "Escape") {
                this.subElement.classList.add("fn__none");
                focusByRange(this.range);
            }
        });
        inputElement.addEventListener("input", (event) => {
            event.stopPropagation();
            fetchPost("/api/search/searchWidget", {
                k: inputElement.value,
            }, (response) => {
                let searchHTML = "";
                response.data.blocks.forEach((item: { path: string, content: string }, index: number) => {
                    searchHTML += `<div data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.content}</div>`;
                });
                this.subElement.firstElementChild.lastElementChild.innerHTML = searchHTML;
            });
        });
        this.subElement.lastElementChild.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            const listElement = hasClosestByClassName(target, "b3-list-item");
            if (!listElement) {
                return;
            }
            hintRenderWidget(listElement.textContent, protyle);
        });
        this.subElement.classList.remove("fn__none");
        this.subElementCloseCB = undefined;
        /// #if !MOBILE
        const rangePosition = getSelectionPosition(nodeElement, range);
        setPosition(this.subElement, rangePosition.left, rangePosition.top + 18, Constants.SIZE_TOOLBAR_HEIGHT);
        /// #endif
        this.element.classList.add("fn__none");
        inputElement.select();
        fetchPost("/api/search/searchWidget", {
            k: "",
        }, (response) => {
            let html = "";
            response.data.blocks.forEach((item: { content: string }, index: number) => {
                html += `<div class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.content}</div>`;
            });
            this.subElement.querySelector(".b3-list--background").innerHTML = html;
        });
    }

    public showAssets(protyle: IProtyle, nodeElement: HTMLElement, range: Range) {
        this.range = range;
        hideElements(["hint"], protyle);
        window.siyuan.menus.menu.remove();
        this.subElement.style.width = "";
        this.subElement.style.padding = "";
        this.subElement.innerHTML = `<div style="max-height:50vh" class="fn__flex">
<div class="fn__flex-column" style="${isMobile() ? "width:100%" : "min-width: 260px;max-width:50vw"}">
    <div class="fn__flex" style="margin: 4px 8px 8px 8px">
        <input class="b3-text-field fn__flex-1"/>
        <span class="fn__space"></span>
        <span data-type="previous" class="block__icon block__icon--show"><svg><use xlink:href="#iconLeft"></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="next" class="block__icon block__icon--show"><svg><use xlink:href="#iconRight"></use></svg></span>
    </div>
    <div class="b3-list fn__flex-1 b3-list--background" style="position: relative"><img style="margin: 0 auto;display: block;width: 64px;height: 64px" src="/stage/loading-pure.svg"></div>
</div>
<div style="width: 260px;display: ${isMobile() || window.outerWidth < window.outerWidth / 2 + 260 ? "none" : "flex"};padding: 8px;overflow: auto;justify-content: center;align-items: center;"></div>
</div>`;
        const listElement = this.subElement.querySelector(".b3-list");
        listElement.addEventListener("mouseover", (event) => {
            const target = event.target as HTMLElement;
            const hoverItemElement = hasClosestByClassName(target, "b3-list-item");
            if (!hoverItemElement) {
                return;
            }
            previewElement.innerHTML = renderAssetsPreview(hoverItemElement.getAttribute("data-value"));
        });
        const previewElement = this.subElement.firstElementChild.lastElementChild;
        previewElement.innerHTML = renderAssetsPreview(listElement.firstElementChild.getAttribute("data-value"));
        const inputElement = this.subElement.querySelector("input");
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            const isEmpty = !this.subElement.querySelector(".b3-list-item");
            if (!isEmpty) {
                const currentElement = upDownHint(listElement, event);
                if (currentElement) {
                    previewElement.innerHTML = renderAssetsPreview(currentElement.getAttribute("data-value"));
                }
            }

            if (event.key === "Enter") {
                if (!isEmpty) {
                    hintRenderAssets(this.subElement.querySelector(".b3-list-item--focus").getAttribute("data-value"), protyle);
                } else {
                    focusByRange(this.range);
                }
                this.subElement.classList.add("fn__none");
                // 空行处插入 mp3 会多一个空的 mp3 块
                event.preventDefault();
            } else if (event.key === "Escape") {
                this.subElement.classList.add("fn__none");
                focusByRange(this.range);
            }
        });
        inputElement.addEventListener("input", (event) => {
            event.stopPropagation();
            fetchPost("/api/search/searchAsset", {
                k: inputElement.value,
            }, (response) => {
                let searchHTML = "";
                response.data.forEach((item: { path: string, hName: string }, index: number) => {
                    searchHTML += `<div data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.hName}</div>`;
                });
                listElement.innerHTML = searchHTML || `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
                previewElement.innerHTML = renderAssetsPreview(listElement.firstElementChild.getAttribute("data-value"));
            });
        });
        this.subElement.lastElementChild.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            const previousElement = hasClosestByAttribute(target, "data-type", "previous");
            if (previousElement) {
                inputElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowUp"}));
                event.stopPropagation();
                return;
            }
            const nextElement = hasClosestByAttribute(target, "data-type", "next");
            if (nextElement) {
                inputElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown"}));
                event.stopPropagation();
                return;
            }
            if (target.classList.contains("b3-list--empty")) {
                this.subElement.classList.add("fn__none");
                focusByRange(this.range);
                event.stopPropagation();
                return;
            }
            const listItemElement = hasClosestByClassName(target, "b3-list-item");
            if (listItemElement) {
                event.stopPropagation();
                hintRenderAssets(listItemElement.getAttribute("data-value"), protyle);
            }
        });
        this.subElement.classList.remove("fn__none");
        this.subElementCloseCB = undefined;
        /// #if !MOBILE
        const rangePosition = getSelectionPosition(nodeElement, range);
        setPosition(this.subElement, rangePosition.left, rangePosition.top + 18, Constants.SIZE_TOOLBAR_HEIGHT);
        /// #endif
        this.element.classList.add("fn__none");
        inputElement.select();
        fetchPost("/api/search/searchAsset", {
            k: "",
        }, (response) => {
            let html = "";
            response.data.forEach((item: { hName: string, path: string }, index: number) => {
                html += `<div data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}"><div class="b3-list-item__text">${item.hName}</div></div>`;
            });
            if (html === "") {
                html = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
            }
            this.subElement.querySelector(".b3-list--background").innerHTML = html;
        });
    }
}
