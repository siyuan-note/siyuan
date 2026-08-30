export const DOCK_TRANSITION_DISABLED_CLASS = "layout--no-transition";

export const runWithoutDockTransitions = (
    elements: HTMLElement[],
    apply: () => void,
    flush: () => void,
) => {
    const addedElements = Array.from(new Set(elements)).filter((element) =>
        !element.classList.contains(DOCK_TRANSITION_DISABLED_CLASS));
    addedElements.forEach((element) => element.classList.add(DOCK_TRANSITION_DISABLED_CLASS));
    try {
        apply();
    } finally {
        try {
            flush();
        } finally {
            addedElements.forEach((element) => element.classList.remove(DOCK_TRANSITION_DISABLED_CLASS));
        }
    }
};
