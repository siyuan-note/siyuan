import type {App} from "../index";
import type {PluginSnapshot} from "../types/api";
import {mobileConfirmDialog} from "../dialog/mobileConfirmDialog";
import {fetchSyncPost} from "../util/fetch";
import {unloadPlugin} from "../plugin/loader";
import {escapeHtml} from "../util/escape";
import {filesize} from "filesize";
import dayjs from "dayjs";
import {mountSnapshotDetail} from "./snapshotDetail";
import {TPluginSnapshotPart} from "./pluginSnapshotPaths";
import {createPluginSnapshotSelect} from "./pluginSnapshotSelect";

export const mountPluginSnapshots = (app: App, root: HTMLElement, setRestoring: (busy: boolean) => void) => {
    const lang = window.siyuan.languages;
    let disposed = false;
    let request = 0;
    let page = 1;
    let pageCount = 0;
    let name = "";
    let busy = false;
    let restoring = false;
    let query: AbortController;
    let detail: ReturnType<typeof mountSnapshotDetail>;
    root.innerHTML = `<form class="history__snapshot-toolbar" data-plugin-search>
<div data-plugin-select></div><button class="b3-button" type="submit">${lang.search}</button>
</form><div class="history__plugin-panels"><div class="history__plugin-results">
<div class="history__snapshot-toolbar" data-plugin-result aria-live="polite"></div>
<ul class="history__plugin-list" data-plugin-list></ul>
<div class="history__plugin-pagination"><button type="button" class="b3-button b3-button--text" data-plugin-page="previous" disabled>${lang.previousLabel}</button>
<button type="button" class="b3-button b3-button--text" data-plugin-page="next" disabled>${lang.nextLabel}</button></div></div>
<div class="history__plugin-detail fn__none"><div class="history__snapshot-toolbar"><button type="button" class="b3-button b3-button--text" data-plugin-back>${lang.back}</button><span data-plugin-detail-title></span></div><div class="history__plugin-detail-content"></div></div></div>`;
    const form = root.querySelector<HTMLFormElement>("[data-plugin-search]");
    const picker = createPluginSnapshotSelect(root.querySelector("[data-plugin-select]"), () => { void search(1); });
    const input = picker.input;
    const list = root.querySelector("[data-plugin-list]");
    const result = root.querySelector("[data-plugin-result]");
    const previous = root.querySelector<HTMLButtonElement>('[data-plugin-page="previous"]');
    const next = root.querySelector<HTMLButtonElement>('[data-plugin-page="next"]');
    const active = () => !disposed && root.isConnected && !root.classList.contains("fn__none");
    const closeDetail = () => {
        detail?.destroy();
        detail = undefined;
        root.classList.remove("history__plugin-panel--detail");
        root.querySelector(".history__plugin-detail").classList.add("fn__none");
        root.querySelector(".history__plugin-detail-content").replaceChildren();
    };
    const setBusy = (value: boolean) => {
        busy = value;
        picker.close();
        form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(item => item.disabled = value);
        list.querySelectorAll<HTMLButtonElement>("button").forEach(item => item.disabled = value ||
            (item.dataset.pluginRestore === "true" && window.siyuan.config.readonly));
        previous.disabled = value || page <= 1;
        next.disabled = value || page >= pageCount;
    };
    const restore = (snapshot: PluginSnapshot, packageName: string) => {
        if (busy || !active() || window.siyuan.config.readonly) { return; }
        mobileConfirmDialog(lang.rollback, lang.pluginSnapshotRestoreTip.replace("${name}", () => escapeHtml(packageName)), async () => {
            if (!active() || busy || window.siyuan.config.readonly) { return false; }
            restoring = true;
            setBusy(true);
            setRestoring(true);
            try {
                if (app.plugins.some(plugin => plugin.name === packageName)) {
                    const disabled = await fetchSyncPost("/api/petal/setPetalEnabled", {packageName, enabled: false, app: app.appId});
                    if (disabled.code !== 0) { return false; }
                }
                await unloadPlugin(app, packageName);
                if (!active()) { return false; }
                const response = await fetchSyncPost("/api/repo/restorePluginSnapshot", {name: packageName, id: snapshot.id});
                if (response.code !== 0) { return false; }
                if (!disposed) { result.textContent = lang.pluginSnapshotRestored.replace("${id}", response.data.backupID); }
                return true;
            } finally {
                restoring = false;
                setRestoring(false);
                if (!disposed) { setBusy(false); }
            }
        }, undefined, false, undefined, undefined, {awaitConfirm: true});
    };
    const open = (snapshot: PluginSnapshot, packageName: string, part: TPluginSnapshotPart) => {
        if (busy || !active()) { return; }
        closeDetail();
        root.classList.add("history__plugin-panel--detail");
        root.querySelector(".history__plugin-detail").classList.remove("fn__none");
        root.querySelector("[data-plugin-detail-title]").textContent = part === "program" ? lang.pluginSnapshotOpenProgram : lang.pluginSnapshotOpenData;
        detail = mountSnapshotDetail(app, root.querySelector(".history__plugin-detail-content"),
            {...snapshot, fileID: "", tags: [packageName]}, "", {plugin: {name: packageName, part}});
    };
    const search = async (targetPage: number) => {
        if (busy || !active() || !picker.canSubmit()) { return; }
        const packageName = input.value.trim();
        if (!packageName) { return; }
        query?.abort();
        query = new AbortController();
        const sequence = ++request;
        setBusy(true);
        closeDetail();
        result.textContent = "";
        list.replaceChildren();
        try {
            const response = await fetchSyncPost("/api/repo/getPluginSnapshots", {name: packageName, page: targetPage}, undefined, false, query.signal);
            if (disposed || request !== sequence) { return; }
            if (response.code !== 0) { result.textContent = response.msg; return; }
            name = packageName;
            page = targetPage;
            pageCount = response.data.pageCount;
            result.textContent = lang.pageCountAndSnapshotCount.replace("${x}", String(response.data.pageCount)).replace("${y}", String(response.data.totalCount));
            response.data.snapshots.forEach(snapshot => {
                const row = document.createElement("li");
                row.className = "history__association";
                const title = document.createElement("div");
                title.textContent = `${dayjs(snapshot.created).format("YYYY-MM-DD HH:mm:ss")} ${snapshot.id.substring(0, 7)}`;
                const stat = document.createElement("div");
                stat.className = "ft__on-surface";
                stat.textContent = lang.pluginSnapshotStats.replace("${programCount}", String(snapshot.program.count))
                    .replace("${programSize}", String(filesize(snapshot.program.size, {standard: "si", base: 10})))
                    .replace("${dataCount}", String(snapshot.data.count)).replace("${dataSize}", String(filesize(snapshot.data.size, {standard: "si", base: 10})));
                const memo = document.createElement("div");
                memo.className = "history__association-memo";
                memo.textContent = snapshot.memo;
                const actions = document.createElement("div");
                actions.className = "fn__flex history__repo-actions";
                for (const part of ["data", "program"] as const) {
                    const button = document.createElement("button");
                    button.className = "b3-button b3-button--text";
                    button.type = "button";
                    button.textContent = part === "data" ? lang.pluginSnapshotOpenData : lang.pluginSnapshotOpenProgram;
                    button.addEventListener("click", () => open(snapshot, packageName, part));
                    actions.append(button);
                }
                const button = document.createElement("button");
                button.className = "b3-button b3-button--outline";
                button.type = "button";
                button.dataset.pluginRestore = "true";
                button.textContent = lang.rollback;
                button.addEventListener("click", () => restore(snapshot, packageName));
                actions.append(button);
                row.append(title, stat, memo, actions);
                list.append(row);
            });
            if (!response.data.snapshots.length) { list.textContent = lang.emptyContent; }
        } catch (error) {
            if (!disposed && request === sequence) { result.textContent = String(error); }
        } finally { if (!disposed && request === sequence) { setBusy(false); } }
    };
    root.querySelector("[data-plugin-back]").addEventListener("click", closeDetail);
    form.addEventListener("submit", event => { event.preventDefault(); void search(1); });
    previous.addEventListener("click", () => { input.value = name; void search(page - 1); });
    next.addEventListener("click", () => { input.value = name; void search(page + 1); });
    return {canClose: () => !restoring, destroy: () => {
        if (disposed) { return; }
        disposed = true; request++;
        query?.abort();
        picker.destroy();
        closeDetail();
    }};
};
