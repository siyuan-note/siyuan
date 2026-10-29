// Keep hidden mobile controls out of focus navigation on WebView versions without inert.
export const installInertFallback = (doc: Document) => {
    const prototype = doc.defaultView.HTMLElement.prototype;
    if ("inert" in prototype) return;
    Object.defineProperty(prototype, "inert", {
        configurable: true,
        get() { return this.hasAttribute("inert"); },
        set(value: boolean) { this.toggleAttribute("inert", Boolean(value)); },
    });
    let previous: HTMLElement;
    const rejectFocus = () => {
        const active = doc.activeElement as HTMLElement;
        if (!active?.closest("[inert]")) return;
        active.blur();
        if (previous?.isConnected && !previous.closest("[inert]")) previous.focus({preventScroll: true});
    };
    doc.addEventListener("focusin", event => {
        if ((event.target as HTMLElement).closest("[inert]")) {
            event.stopImmediatePropagation();
            rejectFocus();
        } else {
            previous = event.target as HTMLElement;
        }
    }, true);
    doc.addEventListener("click", event => {
        if ((event.target as Element).closest("[inert]")) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
    doc.addEventListener("keydown", event => {
        if (event.key !== "Tab" || event.defaultPrevented) return;
        const candidates = Array.from(doc.querySelectorAll<HTMLElement>(
            "a[href],button,input,select,textarea,[tabindex],[contenteditable]"
        )).filter(element => (element.tabIndex >= 0 || (element.isContentEditable && !element.hasAttribute("tabindex"))) &&
            !element.matches(":disabled") && element.getClientRects().length &&
            getComputedStyle(element).visibility === "visible");
        candidates.sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
        const step = event.shiftKey ? -1 : 1;
        const index = candidates.indexOf(doc.activeElement as HTMLElement);
        let next = index < 0 ? (event.shiftKey ? candidates.length - 1 : 0) : index + step;
        if (!candidates[next]?.closest("[inert]")) return;
        event.preventDefault();
        while (candidates[next]?.closest("[inert]")) next += step;
        const target = candidates[next] || (event.shiftKey ? candidates.slice().reverse() : candidates)
            .find(element => !element.closest("[inert]"));
        target?.focus();
    });
    new MutationObserver(rejectFocus).observe(doc.documentElement, {attributes: true, attributeFilter: ["inert"], subtree: true});
};
