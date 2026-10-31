import {getUndoStateSnapshot, requestRedo, requestUndo, subscribeUndoState} from "../undo/globalUndo";
import {finishListMindmaps} from "../render/listMindmap";
import {MenuItem} from "../../menus/Menu";

export class DocumentHistory {
    private buttons: HTMLButtonElement[] = [];
    private rootID?: string;
    private unsubscribe?: () => void;
    private pending = false;
    private disposed = false;

    constructor(private protyle: IProtyle) {
    }

    public createMenuItems() {
        this.buttons = [];
        if (this.disposed || this.protyle.disabled) {
            return this.buttons;
        }
        const documentID = this.protyle.block.rootID;
        const notebookID = this.protyle.notebookId;
        this.buttons = (["undo", "redo"] as const).map(type => {
            const button = new MenuItem({
                id: type,
                label: window.siyuan.languages[type],
                icon: type === "undo" ? "iconUndo" : "iconRedo",
                click: () => {
                    void this.run(type === "redo", documentID, notebookID).catch(error => console.error(error));
                },
            }).element as HTMLButtonElement;
            return button;
        });
        this.refresh();
        return this.buttons;
    }

    public refresh() {
        if (this.disposed) {
            return;
        }
        const rootID = this.protyle.block.rootID;
        if (this.rootID !== rootID) {
            this.unsubscribe?.();
            this.rootID = rootID;
            this.unsubscribe = rootID ? subscribeUndoState(rootID, () => this.render()) : undefined;
        }
        this.render();
    }

    private render() {
        const state = getUndoStateSnapshot(this.rootID);
        this.buttons.forEach(button => {
            button.disabled = this.protyle.disabled || this.pending || state.pending ||
                !(button.dataset.id === "undo" ? state.canUndo : state.canRedo);
        });
    }

    private async run(redo: boolean, documentID: string, notebookID: string) {
        const protyle = this.protyle;
        const button = this.buttons.find(item => item.dataset.id === (redo ? "redo" : "undo"));
        if (this.disposed || !button || button.disabled || !documentID || this.pending || protyle.disabled ||
            protyle.block.rootID !== documentID || protyle.notebookId !== notebookID) {
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
            await (redo ? requestRedo(protyle, documentID) : requestUndo(protyle, documentID));
        } finally {
            this.pending = false;
            this.render();
        }
    }

    public destroy() {
        this.disposed = true;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.buttons = [];
    }
}
