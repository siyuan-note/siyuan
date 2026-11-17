import {onFlashcardV2ReviewChange} from "./flashcardV2ReviewChanges";

export class FlashcardV2ManagementView {
    private version = 0;
    private closed = false;
    private listener: AbortController;
    public readonly selected = new Set<string>();
    private scrollTop = 0;
    private focusType = "";
    private focusID = "";
    private restoreFocus = false;
    private reload: () => void;

    public request(reload?: () => void) {
        if (reload) { this.reload = reload; }
        const version = ++this.version;
        return () => !this.closed && this.version === version;
    }

    public setRefresh(reload: () => void) {
        this.reload = reload;
    }

    public refresh() {
        if (!this.closed) { this.reload?.(); }
    }

    public close() {
        this.closed = true;
        this.listener?.abort();
    }

    public bind() {
        this.listener?.abort();
        this.listener = new AbortController();
        onFlashcardV2ReviewChange(() => this.refresh(), this.listener.signal);
        return {signal: this.listener.signal};
    }

    public capture(element: HTMLElement, preserve: boolean) {
        const active = element.ownerDocument.activeElement as HTMLElement;
        this.restoreFocus = element.contains(active);
        this.focusType = this.restoreFocus ? active.dataset.type || "" : "";
        this.focusID = this.restoreFocus ? active.closest<HTMLElement>(".b3-list-item")?.dataset.id || "" : "";
        this.scrollTop = preserve ? element.querySelector<HTMLElement>(".card__v2-management-list").scrollTop : 0;
        if (!preserve) {
            this.selected.clear();
            this.focusID = "";
        }
    }

    public reconcile(ids: string[]) {
        const visible = new Set(ids);
        this.selected.forEach(id => {
            if (!visible.has(id)) {
                this.selected.delete(id);
            }
        });
    }

    public restore(element: HTMLElement) {
        if (this.restoreFocus) {
            const target = [...element.querySelectorAll<HTMLElement>("[data-type]")].find(candidate =>
                candidate.dataset.type === this.focusType && !candidate.matches(":disabled") &&
                (candidate.closest<HTMLElement>(".b3-list-item")?.dataset.id || "") === this.focusID);
            (target || element.querySelector<HTMLElement>(".card__v2-management-list")).focus({preventScroll: true});
        }
        element.querySelector<HTMLElement>(".card__v2-management-list").scrollTop = this.scrollTop;
        this.restoreFocus = false;
    }
}
