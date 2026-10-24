import {BottomBacklinkPanel, getBottomBacklinkBlockId} from "../../layout/dock/BottomBacklinkPanel";
import {registerMobileBacklinkPanel} from "./backlinkPanels";
import {flushMobileSecondaryEditor} from "./secondaryEditors";

type MobileBottomBacklink = {
    protyle: IProtyle;
    panel: BottomBacklinkPanel;
    closing?: Promise<void>;
};

let current: MobileBottomBacklink;
let generation = 0;

const closePanel = (record: MobileBottomBacklink) => {
    if (!record.closing) {
        const element = record.protyle.contentElement.querySelector(".sy__backlink--bottom");
        element?.setAttribute("inert", "");
        record.closing = Promise.all((record.panel.backlink?.editors || []).map(flushMobileSecondaryEditor)).then(() => {
            record.panel.destroy();
            if (current === record) {
                current = undefined;
            }
        }).catch(error => {
            element?.removeAttribute("inert");
            record.closing = undefined;
            throw error;
        });
    }
    return record.closing;
};

// 切换正文前提交反链编辑器的防抖输入，失败时保留面板和输入以便重试。
export const closeMobileBottomBacklinkPanel = () => {
    generation++;
    return current ? closePanel(current) : undefined;
};

export const updateMobileBottomBacklinkPanel = async (protyle = window.siyuan.mobile.editor?.protyle, reset = false) => {
    const version = ++generation;
    if (!protyle || protyle !== window.siyuan.mobile.editor?.protyle || protyle.element.classList.contains("fn__none")) {
        return;
    }
    const enabled = window.siyuan.config.editor.backlinkShowBottom;
    const backlink = current?.panel.backlink;
    if (current && (current.closing || reset || !enabled || current.protyle !== protyle || backlink &&
        (backlink.blockId !== getBottomBacklinkBlockId(protyle) || backlink.rootId !== protyle.block.rootID ||
            backlink.notebookId !== (protyle.notebookId || "")))) {
        await closePanel(current);
    }
    if (version !== generation || !enabled || protyle !== window.siyuan.mobile.editor?.protyle) {
        return;
    }
    current ??= {protyle, panel: new BottomBacklinkPanel(protyle, registerMobileBacklinkPanel)};
    current.panel.update();
};

export const destroyMobileBottomBacklinkPanel = (protyle: IProtyle) => {
    if (current?.protyle === protyle) {
        generation++;
        const record = current;
        current = undefined;
        record.panel.destroy();
    }
};
