import {Constants} from "../../constants";
import {isInEmbedBlock} from "../util/hasClosest";

export const searchMarkRender = (protyle: IProtyle, keys: string[], hlId?: string | number, cb?: () => void) => {
    if (!isSupportCSSHL()) {
        return;
    }
    setTimeout(() => {
        protyle.highlight.markHL.clear();
        protyle.highlight.mark.clear();
        protyle.highlight.ranges = [];
        let isSetHL = false;
        let hlBlockElement: Element;
        if (typeof hlId === "string") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id='${hlId}']`)).find(item => {
                if (!isInEmbedBlock(item)) {
                    hlBlockElement = item;
                    return true;
                }
            });
        }


        // 准备一个数组来保存所有文本节点
        const textNodes: Node[] = [];
        const textNodesSize: number[] = [];
        let currentSize = 0;

        const treeWalker = document.createTreeWalker(protyle.wysiwyg.element, NodeFilter.SHOW_TEXT);
        let currentNode = treeWalker.nextNode();
        while (currentNode) {
            textNodes.push(currentNode);
            currentSize += currentNode.textContent.length;
            textNodesSize.push(currentSize);
            currentNode = treeWalker.nextNode();
        }

        const text = protyle.wysiwyg.element.textContent;
        const rangeIndexes: { range: Range, startIndex: number, isCurrent: boolean }[] = [];

        keys.forEach(key => {
            if (!key) {
                return;
            }
            let startIndex = 0;
            let endIndex = 0;
            let currentNodeIndex = 0;
            while ((startIndex = text.indexOf(key, startIndex)) !== -1) {
                const range = new Range();
                endIndex = startIndex + key.length;
                try {
                    while (currentNodeIndex < textNodes.length && textNodesSize[currentNodeIndex] <= startIndex) {
                        currentNodeIndex++;
                    }
                    let currentTextNode = textNodes[currentNodeIndex];
                    range.setStart(currentTextNode, startIndex - (currentNodeIndex ? textNodesSize[currentNodeIndex - 1] : 0));

                    while (currentNodeIndex < textNodes.length && textNodesSize[currentNodeIndex] < endIndex) {
                        currentNodeIndex++;
                    }
                    currentTextNode = textNodes[currentNodeIndex];
                    range.setEnd(currentTextNode, endIndex - (currentNodeIndex ? textNodesSize[currentNodeIndex - 1] : 0));

                    let isCurrent = false;
                    if (!isSetHL && hlBlockElement && hlBlockElement.contains(currentTextNode)) {
                        isSetHL = true;
                        isCurrent = true;
                    }

                    rangeIndexes.push({range, startIndex, isCurrent});
                } catch (e) {
                    console.error("searchMarkRender error:", e);
                }
                startIndex = endIndex;
            }
        });

        rangeIndexes.sort((b, a) => {
            if (a.startIndex > b.startIndex) {
                return -1;
            } else {
                return 0;
            }
        }).forEach((item, index) => {
            if ((typeof hlId === "string" && item.isCurrent) || (typeof hlId === "number" && hlId === index)) {
                protyle.highlight.rangeIndex = index;
                protyle.highlight.markHL.add(item.range);
            } else {
                protyle.highlight.mark.add(item.range);
            }
            protyle.highlight.ranges.push(item.range);
        });
        CSS.highlights.set("search-mark-" + protyle.highlight.styleElement.dataset.uuid, protyle.highlight.mark);
        if (typeof hlId !== "undefined") {
            CSS.highlights.set("search-mark-hl-" + protyle.highlight.styleElement.dataset.uuid, protyle.highlight.markHL);
        }
        if (cb) {
            cb();
        }
    }, protyle.wysiwyg.element.querySelector(".hljs") ? Constants.TIMEOUT_TRANSITION : 0);
};

export const isSupportCSSHL = () => {
    return !!(CSS && CSS.highlights);
};
