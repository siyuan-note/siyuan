import {Dialog} from "../dialog";
import {showMessage} from "../dialog/message";
import {escapeAttr, escapeHtml} from "../util/escape";
import {fetchSyncPost} from "../util/fetch";

interface IObsidianAnalysis {
    vaultName: string;
    notebookName: string;
    markdownCount: number;
    syntheticParentCount: number;
    nameAdjustmentCount: number;
    importableAssetCount: number;
    importableAssetSize: number;
    unreferencedFileCount: number;
    wikiLinkCount: number;
    embedCount: number;
    blockIDCount: number;
    footnoteCount: number;
    commentCount: number;
    missingCount: number;
    ambiguousCount: number;
    unsupportedCount: number;
    skippedHiddenCount: number;
    skippedLinkCount: number;
    skippedSpecialCount: number;
    skippedNestedVaultCount: number;
    warnings: string[];
}

interface IObsidianResult {
    notebookName: string;
    markdownCount: number;
    syntheticParentCount: number;
    importedAttachmentCount: number;
    convertedLinkCount: number;
    convertedEmbedCount: number;
    convertedFootnoteCount: number;
    preservedCommentCount: number;
    preservedUnresolvedCount: number;
    skippedPathCount: number;
    incomplete: boolean;
}

interface IObsidianTask {
    taskID: string;
    state: string;
    progress: number;
    error?: string;
    analysis?: IObsidianAnalysis;
    result?: IObsidianResult;
}

const terminalStates = ["ready", "completed", "failed", "cancelled"];
const cancellableStates = ["queued", "analyzing", "ready", "revalidating", "staging"];

const formatSize = (size: number) => {
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KiB`;
    }
    return `${(size / 1024 / 1024).toFixed(1)} MiB`;
};

const formatStats = (template: string, values: Record<string, string | number>) => {
    return Object.entries(values).reduce((result, [key, value]) => {
        return result.replace(`\${${key}}`, value.toString());
    }, template);
};

const formatNonZeroStats = (template: string, counts: number[], values: Record<string, string | number>) => {
    return template.split(window.siyuan.languages.obsidianStatsSeparator)
        .filter((_, index) => counts[index] > 0)
        .map((item) => formatStats(item, values))
        .join(window.siyuan.languages.obsidianStatsSeparator);
};

const formatBasicStats = (analysis: IObsidianAnalysis) => formatNonZeroStats(
    window.siyuan.languages.obsidianBasicStats,
    [analysis.markdownCount, analysis.importableAssetCount],
    {
        markdown: analysis.markdownCount,
        assets: window.siyuan.languages.assets,
        count: analysis.importableAssetCount,
        size: formatSize(analysis.importableAssetSize),
    });

const formatSyntaxStats = (analysis: IObsidianAnalysis) => formatNonZeroStats(
    window.siyuan.languages.obsidianSyntaxStats,
    [analysis.wikiLinkCount, analysis.embedCount, analysis.blockIDCount, analysis.footnoteCount, analysis.commentCount],
    {
        wikiLink: analysis.wikiLinkCount,
        embed: analysis.embedCount,
        blockID: analysis.blockIDCount,
        footnote: analysis.footnoteCount,
        comment: analysis.commentCount,
    });

const cancelTask = (taskID: string) => {
    return fetchSyncPost("/api/import/cancelObsidianVaultTask", {taskID});
};

const pollTask = async (taskID: string, onUpdate: (task: IObsidianTask) => void) => {
    while (true) {
        const response = await fetchSyncPost("/api/import/getObsidianVaultTask", {taskID});
        if (response.code !== 0) {
            return undefined;
        }
        const task = response.data as IObsidianTask;
        onUpdate(task);
        if (terminalStates.includes(task.state)) {
            return task;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 800));
    }
};

const showProgress = async (taskID: string, importing: boolean) => {
    let taskState = "";
    let cancelled = false;
    const dialog = new Dialog({
        title: window.siyuan.languages.obsidianVaultImport,
        content: `<div class="b3-dialog__content">
    <div style="display: flex;align-items: center;gap: 8px">
        <svg class="fn__rotate" style="display: block;flex: none;height: 16px;width: 16px"><use xlink:href="#iconRefresh"></use></svg>
        <span data-type="status">${window.siyuan.languages[importing ? "obsidianImporting" : "obsidianAnalyzing"]}</span>
    </div>
    <div class="fn__hr"></div>
    <div class="b3-progress"><div class="b3-progress__bar" style="width: 0"></div></div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${window.siyuan.languages.cancel}</button>
</div>`,
        width: "480px",
        disableClose: true,
    });
    dialog.element.querySelector('[data-type="cancel"]').addEventListener("click", async () => {
        if (taskState && !cancellableStates.includes(taskState)) {
            return;
        }
        cancelled = true;
        await cancelTask(taskID);
    });
    const task = await pollTask(taskID, (updatedTask) => {
        taskState = updatedTask.state;
        const progressElement = dialog.element.querySelector(".b3-progress__bar") as HTMLElement;
        progressElement.style.width = `${updatedTask.progress}%`;
        const cancelElement = dialog.element.querySelector('[data-type="cancel"]') as HTMLButtonElement;
        cancelElement.disabled = !cancellableStates.includes(updatedTask.state);
    });
    dialog.destroy();
    if (cancelled || !task) {
        return undefined;
    }
    return task;
};

const showFailure = (task: IObsidianTask) => {
    if (!task.result?.incomplete) {
        showMessage(task.error || window.siyuan.languages.obsidianImportFailed, 0, "error");
        return;
    }
    new Dialog({
        title: window.siyuan.languages.obsidianImportFailed,
        content: `<div class="b3-dialog__content">
    <div class="ft__breakword">${escapeHtml(task.error || window.siyuan.languages.obsidianImportFailed)}</div>
    <div class="fn__hr"></div>
    <div class="b3-label">${escapeHtml(task.result.notebookName)}</div>
</div>`,
        width: "520px",
    });
};

const showConfirmation = (taskID: string, analysis: IObsidianAnalysis, onComplete?: () => void) => {
    const skippedCount = analysis.skippedHiddenCount + analysis.skippedLinkCount + analysis.skippedSpecialCount + analysis.skippedNestedVaultCount;
    const warnings = analysis.warnings || [];
    const basicStats = formatBasicStats(analysis);
    const syntaxStats = formatSyntaxStats(analysis);
    const issues = [
        analysis.missingCount > 0 ? window.siyuan.languages.obsidianMissingTargets.replace("${count}", analysis.missingCount.toString()) : "",
        analysis.ambiguousCount > 0 ? window.siyuan.languages.obsidianAmbiguousTargets.replace("${count}", analysis.ambiguousCount.toString()) : "",
        analysis.unsupportedCount > 0 ? window.siyuan.languages.obsidianUnsupportedTargets.replace("${count}", analysis.unsupportedCount.toString()) : "",
    ].filter(Boolean);
    const dialog = new Dialog({
        title: window.siyuan.languages.obsidianVaultImport,
        content: `<div class="b3-dialog__content">
    <div class="b3-label">${window.siyuan.languages.obsidianCompatibilityTip}</div>
    <div class="b3-label">${escapeHtml(analysis.vaultName)}${basicStats ? `<div>${escapeHtml(basicStats)}</div>` : ""}</div>
    ${syntaxStats ? `<div class="b3-label">${escapeHtml(syntaxStats)}</div>` : ""}
    ${issues.length > 0 ? `<div class="b3-label">${window.siyuan.languages.obsidianIssueSummary}<div class="b3-label__text">${issues.join("<br>")}</div></div>` : ""}
    ${warnings.length > 0 ? `<div class="b3-label">${window.siyuan.languages.obsidianUnreadableFiles.replace("${count}", warnings.length.toString())}<div class="b3-label__text">${warnings.map((item) => escapeHtml(item)).join("<br>")}</div></div>` : ""}
    ${skippedCount > 0 ? `<div class="b3-label">${window.siyuan.languages.obsidianSkippedSummary.replace("${count}", skippedCount.toString())}</div>` : ""}
    ${analysis.unreferencedFileCount > 0 ? `<div class="b3-label">${window.siyuan.languages.obsidianUnreferencedTip.replace("${count}", analysis.unreferencedFileCount.toString())}</div>` : ""}
    <label class="b3-label" style="display: flex;align-items: center"><span style="white-space: nowrap">${window.siyuan.languages.newNotebook}</span><span class="fn__space"></span><input class="b3-text-field fn__flex-1" data-type="notebook-name" value="${escapeAttr(analysis.notebookName)}"></label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-type="confirm">${window.siyuan.languages.import}</button>
        </div>`,
        width: "620px",
        destroyCallback: () => {
            if (!dialog.data?.confirmed) {
                cancelTask(taskID);
            }
        },
    });
    dialog.element.querySelector('[data-type="cancel"]').addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector('[data-type="confirm"]').addEventListener("click", async () => {
        const nameElement = dialog.element.querySelector('[data-type="notebook-name"]') as HTMLInputElement;
        const notebookName = nameElement.value.trim();
        if (!notebookName) {
            nameElement.focus();
            return;
        }
        dialog.data = {confirmed: true};
        dialog.destroy();
        const response = await fetchSyncPost("/api/import/startObsidianVaultImport", {
            taskID,
            notebookName,
        });
        if (response.code !== 0) {
            return;
        }
        const task = await showProgress(taskID, true);
        if (task?.state === "completed" && task.result) {
            showMessage(window.siyuan.languages.imported);
            onComplete?.();
        } else if (task?.state === "failed") {
            showFailure(task);
        }
    });
};

export const importObsidianVault = async (localPath: string, onComplete?: () => void) => {
    const response = await fetchSyncPost("/api/import/startObsidianVaultAnalysis", {localPath});
    if (response.code !== 0) {
        return;
    }
    const startedTask = response.data as IObsidianTask;
    const task = await showProgress(startedTask.taskID, false);
    if (task?.state === "ready" && task.analysis) {
        showConfirmation(task.taskID, task.analysis, onComplete);
    } else if (task?.state === "failed") {
        showFailure(task);
    }
};
