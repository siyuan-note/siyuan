import type {App} from "../index";
import type {PluginSnapshot} from "../types/api";
import {Dialog} from "../dialog";
import {mobileConfirmDialog} from "../dialog/mobileConfirmDialog";
import {fetchSyncPost} from "../util/fetch";
import {unloadPlugin} from "../plugin/loader";
import {escapeHtml} from "../util/escape";
import {isMobile} from "../util/functions";
import dayjs from "dayjs";
import {openSnapshotDetail} from "./snapshotDetail";

export const openPluginSnapshots = (app: App) => {
    const lang = window.siyuan.languages;
    let disposed = false;
    let request = 0;
    let page = 1;
    let pageCount = 0;
    let name = "";
    let busy = false;
    let restoring = false;
    const dialog = new Dialog({
        title: lang.pluginSnapshots,
        content: `<div class="b3-dialog__content">
<form class="fn__flex" data-plugin-search>
    <input class="b3-text-field fn__flex-1" required spellcheck="false" aria-label="${lang.plugin}" placeholder="${lang.plugin}">
    <span class="fn__space"></span><button class="b3-button" type="submit">${lang.search}</button>
</form>
<div class="fn__hr"></div><div data-plugin-result aria-live="polite"></div>
<ul class="history__plugin-list" data-plugin-list></ul>
<div class="history__plugin-pagination">
    <button type="button" class="b3-button b3-button--text" data-plugin-page="previous" disabled>${lang.previousLabel}</button>
    <button type="button" class="b3-button b3-button--text" data-plugin-page="next" disabled>${lang.nextLabel}</button>
</div></div>`,
        width: isMobile() ? "92vw" : "640px",
        destroyCallback: () => { disposed = true; request++; },
        beforeClose: () => !restoring,
    });
    const form = dialog.element.querySelector<HTMLFormElement>("[data-plugin-search]");
    const input = form.querySelector("input");
    const list = dialog.element.querySelector("[data-plugin-list]");
    const result = dialog.element.querySelector("[data-plugin-result]");
    const previous = dialog.element.querySelector<HTMLButtonElement>('[data-plugin-page="previous"]');
    const next = dialog.element.querySelector<HTMLButtonElement>('[data-plugin-page="next"]');
    const setBusy = (value: boolean) => {
        busy = value;
        form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(item => item.disabled = value);
        list.querySelectorAll("button").forEach(item => item.disabled = value || window.siyuan.config.readonly);
        previous.disabled = value || page <= 1;
        next.disabled = value || page >= pageCount;
    };
    const restore = (snapshot: PluginSnapshot, packageName: string) => {
        if (busy || disposed || window.siyuan.config.readonly) { return; }
        mobileConfirmDialog(lang.rollback, lang.pluginSnapshotRestoreTip.replace("${name}", () => escapeHtml(packageName)), async () => {
            if (disposed || busy) { return false; }
            restoring = true;
            setBusy(true);
            try {
                if (app.plugins.some(plugin => plugin.name === packageName)) {
                    const disabled = await fetchSyncPost("/api/petal/setPetalEnabled", {
                        packageName, enabled: false, app: app.appId,
                    });
                    if (disabled.code !== 0) { return false; }
                }
                await unloadPlugin(app, packageName);
                const response = await fetchSyncPost("/api/repo/restorePluginSnapshot", {name: packageName, id: snapshot.id});
                if (response.code !== 0) { return false; }
                if (!disposed) {
                    result.textContent = lang.pluginSnapshotRestored.replace("${id}", response.data.backupID);
                }
                return true;
            } finally {
                restoring = false;
                if (!disposed) { setBusy(false); }
            }
        }, undefined, false, undefined, undefined, {awaitConfirm: true});
    };
    const search = async (targetPage: number) => {
        if (busy || disposed) { return; }
        const packageName = input.value.trim();
        if (!packageName) { return; }
        const sequence = ++request;
        setBusy(true);
        result.textContent = "";
        list.replaceChildren();
        try {
            const response = await fetchSyncPost("/api/repo/getPluginSnapshots", {name: packageName, page: targetPage});
            if (disposed || request !== sequence) { return; }
            if (response.code !== 0) { result.textContent = response.msg; return; }
            name = packageName;
            page = targetPage;
            pageCount = response.data.pageCount;
            result.textContent = lang.pageCountAndSnapshotCount.replace("${x}", String(response.data.pageCount))
                .replace("${y}", String(response.data.totalCount));
            response.data.snapshots.forEach(snapshot => {
                const row = document.createElement("li");
                row.className = "history__association";
                const title = document.createElement("div");
                title.textContent = `${dayjs(snapshot.created).format("YYYY-MM-DD HH:mm:ss")} ${snapshot.id.substring(0, 7)}`;
                const stat = document.createElement("div");
                stat.className = "ft__on-surface";
                stat.textContent = lang.pluginSnapshotStats.replace("${programCount}", String(snapshot.program.count))
                    .replace("${programSize}", String(snapshot.program.size)).replace("${dataCount}", String(snapshot.data.count))
                    .replace("${dataSize}", String(snapshot.data.size));
                const memo = document.createElement("div");
                memo.className = "history__association-memo";
                memo.textContent = snapshot.memo;
                const button = document.createElement("button");
                button.className = "b3-button b3-button--outline";
                button.type = "button";
                button.textContent = lang.rollback;
                button.addEventListener("click", () => restore(snapshot, packageName));
                const open = document.createElement("button");
                open.className = "b3-button b3-button--text";
                open.type = "button";
                open.textContent = lang.openBy;
                open.addEventListener("click", () => {
                    void openSnapshotDetail(app, {...snapshot, fileID: "", tags: [packageName]}, "", packageName);
                });
                const actions = document.createElement("div");
                actions.className = "fn__flex history__repo-actions";
                actions.append(open, button);
                row.append(title, stat, memo, actions);
                list.append(row);
            });
            if (!response.data.snapshots.length) { list.textContent = lang.emptyContent; }
            previous.disabled = page <= 1;
            next.disabled = page >= response.data.pageCount;
        } catch (error) {
            if (!disposed && request === sequence) { result.textContent = String(error); }
        } finally {
            if (!disposed && request === sequence) { setBusy(false); }
        }
    };
    form.addEventListener("submit", event => { event.preventDefault(); void search(1); });
    previous.addEventListener("click", () => { input.value = name; void search(page - 1); });
    next.addEventListener("click", () => { input.value = name; void search(page + 1); });
};
