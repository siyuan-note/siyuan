import {fetchSyncPost} from "../../../util/fetch";
import {guardTemplateHTTPRequest} from "../../../template/http";
import {waitForPendingTransactions} from "../../util/transactionQueue";
import {initMirror, refreshUndoButtons} from "../../undo/globalUndo";

export const runManualAutomation = async (protyle: IProtyle, block: HTMLElement, host: HTMLElement,
                                           ruleID: string, button: HTMLButtonElement, status: HTMLElement) => {
    if (button.disabled || protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
        protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    const disabled = new Map<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement, boolean>();
    host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("input, button, select, textarea").forEach(control => {
        disabled.set(control, control.disabled);
        control.disabled = true;
    });
    status.classList.remove("fn__none", "ft__error");
    host.setAttribute("aria-busy", "true");
    status.textContent = window.siyuan.languages.loading;
    const guard = guardTemplateHTTPRequest(() => host.isConnected && button.isConnected && block.isConnected &&
        !protyle.disabled && !window.siyuan.config.readonly, block);
    try {
        await waitForPendingTransactions(protyle);
        if (guard.signal.aborted || !host.isConnected) return;
        const response = await fetchSyncPost("/api/av/runAttributeViewAutomation", {
            avID: block.dataset.avId, blockID: block.dataset.nodeId, ruleID,
        }, undefined, false, guard.signal);
        if (!host.isConnected) return;
        status.textContent = response.code === 0 ? "" : response.msg;
        status.classList.toggle("ft__error", response.code !== 0);
        if (response.code === 0) {
            await initMirror(protyle.block.rootID);
            refreshUndoButtons(protyle);
        }
    } catch (error) {
        if (host.isConnected && !guard.signal.aborted) {
            status.textContent = window.siyuan.languages.templateHTTPFailed;
            status.classList.add("ft__error");
        }
    } finally {
        guard.dispose();
        host.removeAttribute("aria-busy");
        disabled.forEach((value, control) => { control.disabled = value; });
    }
};
