import {isIOSPlatform} from "./browserCompatibility";

export const copyBlockSelection = (element: Element, copy: () => void = () => document.execCommand("copy")) => {
    const avCursor = element.matches('[data-type="NodeAttributeView"]') ?
        element.querySelector<HTMLElement>(".av__cursor") : null;
    if (!isIOSPlatform(navigator) && !avCursor) {
        copy();
        return;
    }
    const selection = window.getSelection();
    const savedRanges = Array.from({length: selection.rangeCount}, (_, index) =>
        selection.getRangeAt(index).cloneRange());
    // 数据库使用专用光标区域，避免隐藏标题使复制事件落在编辑器外。
    const editable = avCursor || (element.matches('[contenteditable="true"]') ? element as HTMLElement :
        element.querySelector<HTMLElement>('[contenteditable="true"]'));
    const range = document.createRange();
    // iOS 需要真实的非折叠选区才会触发复制事件，实际复制的块仍由编辑器的块选择状态决定。
    range.selectNodeContents(editable || element);
    editable?.focus({preventScroll: true});
    selection.removeAllRanges();
    selection.addRange(range);
    try {
        copy();
    } finally {
        // 复制完成后恢复光标，避免临时文字选区改变块选择模式。
        selection.removeAllRanges();
        savedRanges.forEach(savedRange => {
            if (savedRange.startContainer.isConnected && savedRange.endContainer.isConnected) {
                selection.addRange(savedRange);
            }
        });
    }
};
