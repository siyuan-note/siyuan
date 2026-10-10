import {isInIOS} from "../protyle/util/compatibility";

export const focusSearchInput = (input: HTMLInputElement | HTMLTextAreaElement) => {
    const nativeComposition = isInIOS() && window.webkit?.messageHandlers.finishKeyboardComposition;
    if (nativeComposition) {
        const value = input.value;
        const inputEvents = ["beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"];
        const endEvents = ["keydown", "keyup", "pointerdown", "blur"];
        let ignoredInput = false;
        let finishing = false;
        let canceled = false;
        // iOS 可能把触发搜索的快捷键继续交给输入法，忽略下一次用户操作前的残留输入。
        const ignoreShortcutInput = (event: Event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            ignoredInput = true;
        };
        const removeListeners = () => {
            endEvents.forEach(type => input.removeEventListener(type, cleanup, true));
            inputEvents.forEach(type => input.removeEventListener(type, ignoreShortcutInput, true));
        };
        const cleanup = (event: Event) => {
            if (finishing) {
                // 原生输入会话结束时会发出 blur，但网页焦点仍在当前输入框。
                if (event.type === "blur" && document.activeElement === input) {
                    return;
                }
                if (event.type !== "keyup") {
                    canceled = true;
                    removeListeners();
                }
                return;
            }
            if (!ignoredInput || event.type !== "keyup") {
                removeListeners();
                return;
            }
            finishing = true;
            // 原生输入法结束组词后再恢复内容，避免旧候选混入下一次正常输入。
            void nativeComposition.postMessage("").then(() => {
                if (!canceled && input.isConnected && document.activeElement === input) {
                    input.value = value;
                    removeListeners();
                    input.blur();
                    input.select();
                    return nativeComposition.postMessage("restore");
                }
            }).catch(error => console.error("Unable to finish keyboard composition:", error)).finally(removeListeners);
        };
        inputEvents.forEach(type => input.addEventListener(type, ignoreShortcutInput, true));
        endEvents.forEach(type => input.addEventListener(type, cleanup, true));
    }
    input.select();
};
