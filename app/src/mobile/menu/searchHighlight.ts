import {Constants} from "../../constants";
import {getSearchMarkRanges, isSupportCSSHL, searchMarkRender} from "../../protyle/render/searchMarkRender";
import {isInEmbedBlock} from "../../protyle/util/hasClosest";
import {restoreTableVirtualizationDOM} from "../../protyle/util/tableVirtualizationDOM";

let disposeHighlight: () => void;

export const clearMobileSearchHighlight = () => {
    disposeHighlight?.();
    disposeHighlight = undefined;
};

const scrollToMatch = (protyle: IProtyle, range: Range) => {
    // 先调整代码块、表格等内部滚动容器，再让命中文字进入编辑器视口。
    let element = range.startContainer.parentElement;
    while (element && protyle.contentElement.contains(element)) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const match = range.getBoundingClientRect();
        if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth) {
            element.scrollLeft += match.left - rect.left - element.clientWidth / 2;
        }
        if (element === protyle.contentElement ||
            /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight) {
            element.scrollTop += match.top - rect.top - element.clientHeight / 2 + match.height / 2;
        }
        if (element === protyle.contentElement) {
            break;
        }
        element = element.parentElement;
    }
};

export const highlightMobileSearchResult = (protyle: IProtyle, id: string, keywords: string[]) => {
    clearMobileSearchHighlight();
    if (keywords.length === 0) {
        return;
    }
    const target = Array.from(protyle.wysiwyg.element.querySelectorAll<HTMLElement>(`[data-node-id="${id}"]`))
        .find(element => !isInEmbedBlock(element)) ||
        (id === protyle.block.rootID ? protyle.title?.editElement : undefined);
    if (!target) {
        return;
    }
    restoreTableVirtualizationDOM(target);
    const rootID = protyle.block.rootID;
    let disposed = false;
    let version = 0;
    let timer: number;
    let selectionRange: Range;
    let currentRange: Range;
    const isCurrent = () => !disposed && target.isConnected &&
        window.siyuan.mobile.editor?.protyle === protyle && protyle.block.rootID === rootID;
    const scroll = () => {
        if (isCurrent() && currentRange?.toString()) {
            scrollToMatch(protyle, currentRange);
        }
    };
    const render = () => {
        const renderVersion = ++version;
        clearTimeout(timer);
        timer = window.setTimeout(() => {
            if (!isCurrent()) {
                return;
            }
            const ranges = getSearchMarkRanges(target, keywords,
                '.protyle-action, .protyle-attr, .protyle-icons, .hljs > [contenteditable="false"], ' +
                ".av__views, .av__selection-toolbar, .av__calendar-toolbar, .av__row--footer")
                .sort((a, b) => a.startIndex - b.startIndex)
                .map(match => match.range)
                .filter(range => Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0));
            currentRange = ranges[0];
            if (isSupportCSSHL()) {
                searchMarkRender(protyle, keywords, 0, scroll, {
                    rootElement: target,
                    ranges,
                    isValid: () => isCurrent() && renderVersion === version,
                });
            } else if (currentRange) {
                // 旧 WebView 使用原生选区标出当前命中，不向可编辑正文插入标记。
                const selection = getSelection();
                selection.removeAllRanges();
                selection.addRange(currentRange);
                selectionRange = currentRange;
                scroll();
            }
        });
    };
    // 代码高亮和异步内容渲染可能替换文本节点，短时间内重新计算范围和位置。
    const mutationObserver = new MutationObserver(render);
    mutationObserver.observe(target, {childList: true, characterData: true, subtree: true});
    const resizeObserver = new ResizeObserver(scroll);
    resizeObserver.observe(protyle.wysiwyg.element);
    const stopObserving = () => {
        mutationObserver.disconnect();
        resizeObserver.disconnect();
    };
    const observerTimer = window.setTimeout(stopObserving, Constants.TIMEOUT_COUNT);
    const events = ["pointerdown", "touchstart", "keydown", "beforeinput", "wheel"];
    const dispose = () => {
        disposed = true;
        clearTimeout(timer);
        clearTimeout(observerTimer);
        stopObserving();
        events.forEach(event => protyle.element.removeEventListener(event, clearMobileSearchHighlight, true));
        protyle.highlight.mark?.clear();
        protyle.highlight.markHL?.clear();
        protyle.highlight.ranges = [];
        protyle.highlight.rangeIndex = 0;
        const selection = getSelection();
        if (selectionRange && selection.rangeCount && selection.getRangeAt(0) === selectionRange) {
            selection.removeAllRanges();
        }
    };
    disposeHighlight = dispose;
    events.forEach(event => protyle.element.addEventListener(event, clearMobileSearchHighlight, {capture: true, passive: true}));
    render();
};
