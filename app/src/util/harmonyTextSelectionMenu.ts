const INPUT_SELECTOR = "input, textarea, select, .b3-text-field";

export const initHarmonyTextSelectionMenu = () => {
    if (!window.JSHarmony?.setNativeTextSelectionMenuDisabled) {
        return;
    }

    let disabled: boolean | undefined;
    const update = (target: EventTarget | Node | null) => {
        let element: Element | null;
        if (target instanceof Element) {
            element = target;
        } else if (target instanceof Node) {
            element = target.parentElement;
        } else {
            element = null;
        }
        const nextDisabled = Boolean(element?.closest(".protyle-wysiwyg") && !element.closest(INPUT_SELECTOR));
        if (disabled === nextDisabled) {
            return;
        }
        disabled = nextDisabled;
        window.JSHarmony.setNativeTextSelectionMenuDisabled(nextDisabled);
    };

    document.addEventListener("pointerdown", (event) => {
        update(event.target);
    }, true);
    document.addEventListener("touchstart", (event) => {
        update(event.target);
    }, {capture: true, passive: true});
    document.addEventListener("focusin", (event) => {
        update(event.target);
    }, true);
    document.addEventListener("selectionchange", () => {
        const activeElement = document.activeElement;
        if (activeElement?.closest(INPUT_SELECTOR)) {
            update(activeElement);
            return;
        }
        const selection = window.getSelection();
        update(selection?.rangeCount ? selection.anchorNode : activeElement);
    });
    update(document.activeElement);
};
