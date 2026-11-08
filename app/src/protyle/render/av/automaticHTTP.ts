import type {AVHTTPAutomationJob} from "../../../types/api";
import {fetchSyncPost} from "../../../util/fetch";
import {getTemplateHTTPWindow, guardTemplateHTTPRequest} from "../../../template/http";
import {showMessage} from "../../../dialog/message";

const jobs = new Map<string, {sequence: number; cancel: () => void}>();
const latest = new Map<string, number>();
let socket: WebSocket;

export const scheduleAutomaticHTTP = (pending: AVHTTPAutomationJob[]) => {
    if (socket !== window.siyuan.ws?.ws) {
        jobs.forEach(job => job.cancel());
        jobs.clear();
        latest.clear();
        socket = window.siyuan.ws?.ws;
        const current = socket;
        socket?.addEventListener("close", () => {
            if (current !== socket) return;
            jobs.forEach(job => job.cancel());
            jobs.clear();
            latest.clear();
        }, {once: true});
    }
    pending.forEach(job => {
        const key = `${job.boxID || ""}/${job.avID}`;
        if ((latest.get(key) || 0) >= job.sequence) return;
        latest.delete(key);
        latest.set(key, job.sequence);
        if (latest.size > 256) latest.delete(latest.keys().next().value);
        const previous = jobs.get(key);
        if (previous && previous.sequence >= job.sequence) return;
        previous?.cancel();
        jobs.delete(key);
        const owner = Array.from(document.querySelectorAll<HTMLElement>(`[data-node-id="${CSS.escape(job.blockID)}"]`))
            .find(owner => !owner.closest(".fn__none") && owner.closest('.protyle-wysiwyg[contenteditable="true"]'));
        const current = () => owner?.isConnected && !owner.closest(".fn__none") &&
            !window.siyuan.config.readonly && !window.siyuan.isPublish && !!getTemplateHTTPWindow();
        if (!current()) return;
        const guard = guardTemplateHTTPRequest(current, owner);
        const state = {sequence: job.sequence, cancel: () => { clearTimeout(timer); guard.cancel(); guard.dispose(); }};
        jobs.set(key, state);
        const timer = setTimeout(async () => {
            try {
                if (!current() || guard.signal.aborted) return;
                const response = await fetchSyncPost("/api/av/runAttributeViewAutomation", {
                    avID: job.avID, blockID: job.blockID, ruleID: "", jobID: job.id,
                }, undefined, false, guard.signal);
                if (current() && !guard.signal.aborted && response.code !== 0 && response.code !== -409) {
                    showMessage(response.msg || window.siyuan.languages.templateHTTPFailed, 5000, "error");
                }
            } catch {
                if (current() && !guard.signal.aborted) showMessage(window.siyuan.languages.templateHTTPFailed, 5000, "error");
            } finally {
                guard.dispose();
                if (jobs.get(key) === state) jobs.delete(key);
            }
        }, 150);
    });
};
