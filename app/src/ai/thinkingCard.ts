export const bindThinkingCardToggle = (el: HTMLElement, onLayoutChange?: () => void): void => {
    const header = el.querySelector(".agent-chat__thinking-header") as HTMLElement;
    const body = el.querySelector(".agent-chat__thinking-body") as HTMLElement;
    const expandIcon = el.querySelector(".agent-chat__thinking-arrow--expand") as HTMLElement;
    const contractIcon = el.querySelector(".agent-chat__thinking-arrow--contract") as HTMLElement;
    const latestElement = el.querySelector(".agent-chat__thinking-latest") as HTMLElement | null;
    if (!header || !body || !expandIcon || !contractIcon) {
        return;
    }
    if (onLayoutChange) {
        body.addEventListener("transitionend", (event) => {
            if (event.target === body && (event as TransitionEvent).propertyName === "max-height") {
                onLayoutChange();
            }
        });
    }
    header.addEventListener("click", () => {
        el.setAttribute("data-user-interacted", "true");
        const expanded = !body.classList.contains("agent-chat__thinking-body--expanded");
        body.classList.remove("agent-chat__thinking-body--preview");
        body.classList.toggle("agent-chat__thinking-body--expanded", expanded);
        expandIcon.classList.toggle("fn__none", expanded);
        contractIcon.classList.toggle("fn__none", !expanded);

        if (latestElement) {
            const showLatest = !expanded && !el.classList.contains("agent-chat__msg--thinking-done");
            latestElement.classList.toggle("fn__none", !showLatest);
            if (showLatest) {
                latestElement.scrollLeft = latestElement.scrollWidth;
            }
        }
        onLayoutChange?.();
    });
};
