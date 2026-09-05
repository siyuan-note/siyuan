import {Dialog} from "../../dialog";
import {fetchPost} from "../../util/fetch";
import {escapeHtml} from "../../util/escape";
import {isMobile} from "../../util/functions";
import {transaction} from "../wysiwyg/transaction";
import {reloadProtyle} from "./reload";
import {waitForPendingTransactions} from "./transactionQueue";

export const canBatchConvertHeadings = (protyle: IProtyle, rootID: string, preview: boolean) => {
    return !!rootID && !!protyle && protyle.block.rootID === rootID && !preview && !protyle.disabled &&
        !protyle.lite && !window.siyuan.config.readonly && !window.siyuan.isPublish;
};

export const updateHeadingBatchButton = (button: HTMLButtonElement, protyle: IProtyle,
                                        hasHeadings: boolean, isCurrent: () => boolean) => {
    button.disabled = !isCurrent();
    if (button.disabled || hasHeadings) {
        return;
    }
    button.disabled = true;
    // 大纲不展示引述块等容器内的标题，空大纲仍需按完整文档判断。
    fetchPost("/api/block/getDocHeadingLevelTransaction", {
        id: protyle.block.rootID,
        notebook: protyle.notebookId,
    }, response => {
        if (button.isConnected && isCurrent()) {
            button.disabled = !response.data?.counts?.some((count: number) => count > 0);
        }
    });
};

export const showHeadingBatchDialog = async (protyle: IProtyle, isCurrent: () => boolean) => {
    const rootID = protyle.block.rootID;
    const available = () => isCurrent() && canBatchConvertHeadings(protyle, rootID, false);
    if (!available()) {
        return;
    }
    await protyle.wysiwyg.flushPendingInput();
    await waitForPendingTransactions(protyle);
    if (!available()) {
        return;
    }
    fetchPost("/api/block/getDocHeadingLevelTransaction", {
        id: rootID,
        notebook: protyle.notebookId,
    }, response => {
        if (!available() || !response.data) {
            return;
        }
        const languages = window.siyuan.languages;
        let counts: number[] = response.data.counts;
        let withSubheadingCounts: number[] = response.data.withSubheadingCounts;
        let closed = false;
        const dialog = new Dialog({
            title: languages.headingBatch,
            width: isMobile() ? "92vw" : "420px",
            content: `<div class="b3-dialog__content">
    <div class="ft__on-surface">${escapeHtml(languages.headingBatchScope.replace("{title}", response.data.title))}</div>
    <div class="fn__hr--b"></div>
    <label>${languages.headingBatchSource}<div class="fn__hr"></div><select class="b3-select fn__block" data-type="source"></select></label>
    <div class="fn__hr--b"></div>
    <label>${languages.headingBatchTarget}<div class="fn__hr"></div><select class="b3-select fn__block" data-type="target"></select></label>
    <div class="fn__hr--b"></div>
    <label class="fn__flex"><span class="fn__flex-1">${languages.tWithSubtitle}</span><input type="checkbox" class="b3-switch" data-type="withSubheadings"></label>
    <div class="fn__hr--b"></div>
    <div class="ft__on-surface" data-type="tip">${languages.headingBatchTip}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-type="convert"></button>
</div>`,
            destroyCallback() {
                closed = true;
            }
        });
        const source = dialog.element.querySelector('[data-type="source"]') as HTMLSelectElement;
        const target = dialog.element.querySelector('[data-type="target"]') as HTMLSelectElement;
        const convert = dialog.element.querySelector('[data-type="convert"]') as HTMLButtonElement;
        const withSubheadings = dialog.element.querySelector('[data-type="withSubheadings"]') as HTMLInputElement;
        const tip = dialog.element.querySelector('[data-type="tip"]');
        const update = () => {
            Array.from(target.options).forEach(option => {
                option.disabled = option.value === source.value;
            });
            if (target.value === source.value) {
                target.value = String(Number(source.value) === 6 ? 5 : Number(source.value) + 1);
            }
            const count = (withSubheadings.checked ? withSubheadingCounts : counts)[Number(source.value) - 1] || 0;
            tip.textContent = withSubheadings.checked ? languages.headingBatchWithSubheadingsTip : languages.headingBatchTip;
            convert.textContent = languages.headingBatchConvert.replace("{count}", String(count));
            convert.disabled = !count || !available();
        };
        const populate = () => {
            const previous = source.value;
            source.replaceChildren();
            counts.forEach((count, index) => {
                if (count) {
                    source.add(new Option(languages.headingBatchOption
                        .replace("{heading}", languages["heading" + (index + 1)])
                        .replace("{count}", String(count)), String(index + 1)));
                }
            });
            if (counts[Number(previous) - 1]) {
                source.value = previous;
            }
            source.disabled = source.options.length === 0;
            target.disabled = source.disabled;
            update();
        };
        for (let level = 1; level <= 6; level++) {
            target.add(new Option(languages["heading" + level], String(level)));
        }
        populate();
        source.addEventListener("change", update);
        target.addEventListener("change", update);
        withSubheadings.addEventListener("change", update);
        dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
        convert.addEventListener("click", async () => {
            if (convert.disabled || !available()) {
                return;
            }
            convert.disabled = true;
            source.disabled = true;
            target.disabled = true;
            withSubheadings.disabled = true;
            await protyle.wysiwyg.flushPendingInput();
            await waitForPendingTransactions(protyle);
            if (closed || !available()) {
                dialog.destroy();
                return;
            }
            void fetchPost("/api/block/getDocHeadingLevelTransaction", {
                id: rootID,
                notebook: protyle.notebookId,
                source: Number(source.value),
                target: Number(target.value),
                withSubheadings: withSubheadings.checked,
            }, result => {
                if (closed || !available() || !result.data) {
                    return;
                }
                const operations = result.data.transaction;
                if (!operations?.doOperations?.length) {
                    counts = result.data.counts;
                    withSubheadingCounts = result.data.withSubheadingCounts;
                    populate();
                    return;
                }
                transaction(protyle, operations.doOperations, operations.undoOperations, {
                    callback() {
                        if (protyle.block.rootID === rootID && protyle.element.isConnected) {
                            reloadProtyle(protyle, false);
                        }
                    }
                });
                dialog.destroy();
            }).finally(() => {
                if (!closed) {
                    source.disabled = source.options.length === 0;
                    target.disabled = source.disabled;
                    withSubheadings.disabled = false;
                    update();
                }
            });
        });
    });
};
