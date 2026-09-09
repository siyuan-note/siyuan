import type {App} from "../../index";
import {BacklinkContent} from "../../layout/dock/BacklinkContent";
import {registerMobileBacklinkPanel} from "../util/backlinkPanels";
import {flushMobileSecondaryEditor} from "../util/secondaryEditors";

export class MobileBacklinks extends BacklinkContent {
    private unregisterPanel: () => void;
    private updateVersion = 0;

    constructor(app: App, element: HTMLElement) {
        const protyle = window.siyuan.mobile.editor?.protyle;
        super({
            app,
            element,
            type: "local",
            surface: "mobile-dock",
            blockId: protyle?.block.id || "",
            rootId: protyle?.block.rootID,
            notebookId: protyle?.notebookId,
        });
        this.unregisterPanel = registerMobileBacklinkPanel(this);
    }

    public update() {
        const version = ++this.updateVersion;
        const protyle = window.siyuan.mobile.editor?.protyle;
        const blockId = protyle?.block.id || "";
        if (this.blockId !== blockId || this.notebookId !== (protyle?.notebookId || "")) {
            void Promise.all(this.editors.map(flushMobileSecondaryEditor)).then(() => {
                if (version === this.updateVersion) {
                    this.switchBlock(blockId, protyle?.block.rootID || "", protyle?.notebookId || "");
                }
            }).catch(error => console.error(error));
        } else {
            this.markIndexDirty({backlinkChanged: true, backlinkFull: true});
            this.refreshAfterIndex();
        }
    }

    public destroy() {
        this.updateVersion++;
        this.unregisterPanel?.();
        super.destroy();
    }

    public switchBlock(blockId: string, rootId: string, notebookId: string) {
        this.updateVersion++;
        super.switchBlock(blockId, rootId, notebookId);
    }
}
