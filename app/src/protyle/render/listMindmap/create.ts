// 隐藏列表正文前交接选区，后续按键交由脑图处理。
export const focusListMindmap = (list: HTMLElement, host: HTMLElement): Range | undefined => {
    const selection = window.getSelection();
    const active = document.activeElement;
    if (!selection?.anchorNode || !list.contains(selection.anchorNode) || host.contains(selection.anchorNode) ||
        (active !== document.body && !list.contains(active) && active !== list.closest(".protyle-wysiwyg"))) {
        return;
    }
    host.focus({preventScroll: true});
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
};

// 先生成列表结构，再将分支和节点改为独立类型，保持空段落转换时的块 ID。
export const spinListMindmapDOM = (lute: Lute, html: string) => {
    const template = document.createElement("template");
    template.innerHTML = lute.SpinBlockDOM(html);
    const list = template.content.firstElementChild;
    if (list?.getAttribute("data-type") === "NodeList") {
        retagMindmapBranch(list, true);
    }
    return template.innerHTML;
};
import {retagMindmapBranch} from "./model";
