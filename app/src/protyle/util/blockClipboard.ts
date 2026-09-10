import {isIOSPlatform} from "./browserCompatibility";

export const copyBlockSelection = (element: Element, copy: () => void = () => document.execCommand("copy")) => {
    if (!isIOSPlatform(navigator)) {
        copy();
        return;
    }
    const selection = window.getSelection();
    const savedRanges = Array.from({length: selection.rangeCount}, (_, index) =>
        selection.getRangeAt(index).cloneRange());
    const editable = element.matches('[contenteditable="true"]') ? element as HTMLElement :
        element.querySelector<HTMLElement>('[contenteditable="true"]');
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
