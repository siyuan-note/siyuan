import {fetchSyncPost} from "../../../util/fetch";
import {guardTemplateHTTPRequest} from "../../../template/http";
import {waitForPendingTransactions} from "../../util/transactionQueue";
import {initMirror, refreshUndoButtons} from "../../undo/globalUndo";
import type {AVAutomationRunResult, RunAttributeViewAutomationRequestInput} from "../../../types/api";

type RunState = {report?: AVAutomationRunResult; uncertain: boolean; busy: boolean; expires: number};
const runs = new Map<string, RunState>();

export const runManualAutomation = async (protyle: IProtyle, block: HTMLElement, host: HTMLElement,
                                           ruleID: string, button: HTMLButtonElement, status: HTMLElement,
                                           action: "start" | "retry" | "status" | "restart" = "start") => {
    if (button.disabled || host.getAttribute("aria-busy") === "true" || protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
        protyle.options.history?.created || protyle.options.history?.snapshot) return;
    const lang = window.siyuan.languages;
    const key = `${block.dataset.avId}/${block.dataset.nodeId}/${ruleID}`;
    runs.forEach((state, id) => { if (!state.busy && state.expires < Date.now()) runs.delete(id); });
    let state = runs.get(key);
    if ((action === "retry" || action === "status") && !state?.report) {
        status.classList.remove("fn__none");
        status.classList.add("ft__error");
        status.textContent = lang.automationRunExpired;
        return;
    }
    if (state?.busy) return;
    const current = () => host.isConnected && button.isConnected && block.isConnected &&
        !protyle.disabled && !window.siyuan.config.readonly && !window.siyuan.isPublish;
    const render = () => {
        if (!current()) return;
        status.classList.remove("fn__none");
        status.classList.add("av__automation-template-result");
        status.classList.toggle("ft__error", state.uncertain || !!state.report?.failed.length || !!state.report?.paused);
        status.textContent = state.uncertain ? lang.automationRunUnconfirmed : state.report ? lang.automationRunSummary
            .replace("${succeeded}", String(state.report.succeeded.length)).replace("${failed}", String(state.report.failed.length))
            .replace("${pending}", String(state.report.pending.length)).replace("${skipped}", String(state.report.skipped.length)) : lang.loading;
        if (state.report?.paused) {
            const reason = document.createElement("div");
            reason.textContent = state.report.paused === "budget" ? lang.automationRunBudget :
                state.report.paused === "changed" ? lang.automationRunChanged : lang.automationRunStopped;
            status.append(reason);
        }
        const controls = document.createElement("div");
        controls.className = "av__automation-row";
        const add = (label: string, next: typeof action) => {
            const control = document.createElement("button");
            control.type = "button";
            control.className = "b3-button b3-button--outline b3-button--wrap";
            control.textContent = label;
            control.disabled = state.busy;
            control.addEventListener("click", () => void runManualAutomation(protyle, block, host, ruleID, button, status, next));
            controls.append(control);
        };
        if (state.uncertain || state.report?.running) add(lang.automationCheckProgress, "status");
        else if (state.report && state.report.paused !== "changed" && (state.report.failed.length || state.report.pending.length)) {
            add(lang.automationRetryRemaining, "retry");
        }
        if (!state.uncertain && !state.report?.running) add(lang.automationRunAll, "restart");
        if (controls.children.length) status.append(controls);
        if (state.report?.failed.length) {
            const details = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = lang.automationFailedItems;
            details.append(summary);
            details.addEventListener("toggle", () => {
                if (!details.open || details.querySelector("ul")) return;
                const names = new Map<string, string>();
                block.querySelectorAll<HTMLElement>(".av__row[data-id]").forEach(row => {
                    names.set(row.dataset.id, row.querySelector<HTMLElement>('[data-dtype="block"]')?.textContent.trim());
                });
                const list = document.createElement("ul");
                state.report.failed.forEach(failure => {
                    const item = document.createElement("li");
                    item.textContent = names.get(failure.itemID) ? `${names.get(failure.itemID)} (${failure.itemID})` : failure.itemID;
                    list.append(item);
                });
                details.append(list);
            }, {once: true});
            status.append(details);
        }
    };
    if (action === "start" && state && (state.uncertain || state.report?.running || state.report?.pending.length || state.report?.failed.length)) {
        render();
        return;
    }
    if (!state || action === "start" || action === "restart") {
        if (runs.size >= 32) {
            const oldest = Array.from(runs).find(([, candidate]) => !candidate.busy);
            if (oldest) runs.delete(oldest[0]);
        }
        state = {uncertain: false, busy: false, expires: Date.now() + 15 * 60 * 1000};
        runs.set(key, state);
    }
    const disabled = new Map<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement, boolean>();
    host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("input, button, select, textarea").forEach(control => {
        disabled.set(control, control.disabled);
        control.disabled = true;
    });
    state.busy = true;
    host.setAttribute("aria-busy", "true");
    status.classList.remove("fn__none", "ft__error");
    status.textContent = lang.loading;
    const guard = guardTemplateHTTPRequest(current, block);
    const request = async (next: "start" | "run" | "retry" | "status") => {
        const data: RunAttributeViewAutomationRequestInput = {avID: block.dataset.avId, blockID: block.dataset.nodeId, ruleID, rows: true,
            action: next, ...(next === "start" ? {} : {runID: state.report.runID, step: state.report.step})};
        const response = await fetchSyncPost("/api/av/runAttributeViewAutomation", data, undefined, false, guard.signal);
        if (!current() || guard.signal.aborted) return false;
        if (response.code === -409) {
            runs.delete(key);
            state.report = undefined;
            status.textContent = lang.automationRunExpired;
            status.classList.add("ft__error");
            return false;
        }
        if (response.code < 0 || !response.data || !("runID" in response.data)) throw new Error(response.msg || lang.templateHTTPFailed);
        state.report = response.data;
        state.uncertain = false;
        render();
        return true;
    };
    try {
        await waitForPendingTransactions(protyle);
        if (guard.signal.aborted || !current()) return;
        if (!state.report) {
            if (!await request("start")) return;
        }
        if (action === "status") {
            await request("status");
            return;
        }
        let next: "run" | "retry" = action === "retry" ? "retry" : "run";
        do {
            if (!await request(next)) return;
            next = "run";
        } while (current() && !guard.signal.aborted && state.report.pending.length && !state.report.paused && !state.report.running);
    } catch {
        if (current() && !guard.signal.aborted) {
            state.uncertain = !!state.report;
            if (state.report) {
                try { await request("status"); } catch {
                    // 保存结果由内核进度确认，界面不重发动作。
                }
            } else {
                status.textContent = lang.templateHTTPFailed;
                status.classList.add("ft__error");
            }
        } else if (state.report) state.uncertain = true;
    } finally {
        guard.dispose();
        state.busy = false;
        host.removeAttribute("aria-busy");
        disabled.forEach((value, control) => { control.disabled = value; });
        if (current() && state.report) {
            render();
            await initMirror(protyle.block.rootID);
            refreshUndoButtons(protyle);
        }
    }
};
