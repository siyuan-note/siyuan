import {getUndoStateSnapshot, requestRedo, requestUndo, subscribeUndoState} from "../undo/globalUndo";
import {finishListMindmaps} from "../render/listMindmap";
import {escapeAttr} from "../../util/escape";

export class DocumentHistory {
    public element = document.createElement("div");
    private rootID?: string;
    private unsubscribe?: () => void;
    private pending = false;
    private disposed = false;

    constructor(private protyle: IProtyle) {
        this.element.className = "protyle-breadcrumb__history fn__flex";
        this.element.innerHTML = (["undo", "redo"] as const).map(type =>
            `<button class="block__icon fn__flex-center ariaLabel" disabled data-type="${type}" aria-label="${escapeAttr(window.siyuan.languages[type])}"><svg><use xlink:href="#icon${type === "undo" ? "Undo" : "Redo"}"></use></svg></button>`).join("");
        this.element.classList.add("fn__none");
        this.element.addEventListener("pointerdown", event => event.preventDefault());
        this.element.addEventListener("click", event => {
            const button = (event.target as Element).closest<HTMLButtonElement>("button");
            if (!button) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            void this.run(button.dataset.type === "redo").catch(error => console.error(error));
        });
    }

    public refresh(rootID: string) {
        if (this.disposed) {
            return;
        }
        if (this.rootID !== rootID) {
            this.unsubscribe?.();
            this.rootID = rootID;
            this.unsubscribe = rootID ? subscribeUndoState(rootID, () => this.render()) : undefined;
        }
        this.render();
    }

    private render() {
        const state = getUndoStateSnapshot(this.rootID);
        this.element.classList.toggle("fn__none", this.protyle.disabled || !state.canUndo && !state.canRedo && !this.pending);
        this.element.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
            button.disabled = this.protyle.disabled || this.pending || state.pending ||
                !(button.dataset.type === "undo" ? state.canUndo : state.canRedo);
        });
    }

    private async run(redo: boolean) {
        const protyle = this.protyle;
        const rootID = this.rootID;
        const documentID = protyle.block.rootID;
        const notebookID = protyle.notebookId;
        const button = this.element.querySelector<HTMLButtonElement>(`[data-type="${redo ? "redo" : "undo"}"]`);
        if (this.disposed || button.disabled || !rootID || this.pending) {
            return;
        }
        this.pending = true;
        this.render();
        try {
            if (!await finishListMindmaps(protyle) || this.disposed || protyle.disabled || !protyle.element.isConnected ||
                protyle.block.rootID !== documentID || protyle.notebookId !== notebookID) {
                return;
            }
            protyle.wysiwyg.flushPendingInput();
            await (redo ? requestRedo(protyle, rootID) : requestUndo(protyle, rootID));
        } finally {
            this.pending = false;
            this.render();
        }
    }

    public destroy() {
        this.disposed = true;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
