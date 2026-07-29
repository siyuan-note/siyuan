import {Constants} from "../constants";
import {Dialog} from "../dialog";
import type {App} from "../index";
import {Protyle} from "../protyle";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {escapeHtml} from "../util/escape";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";

export interface IDocVersionRef {
    type: "current" | "history" | "snapshot";
    id?: string;
    path?: string;
    snapshot?: string;
    label: string;
}

interface IDocVersionContent {
    id: string;
    rootID: string;
    title: string;
    content: string;
}

interface IDocVersionDifference {
    id: string;
    statuses: Array<"left-only" | "right-only" | "modified" | "moved">;
}

interface IDocVersionDiff {
    left: IDocVersionContent;
    right: IDocVersionContent;
    differences: IDocVersionDifference[];
    large: boolean;
    titleModified: boolean;
}

const toProtyleResponse = (content: IDocVersionContent) => {
    return {
        code: 0,
        data: {
            ...content,
            box: "",
            path: "",
            parentID: "",
            parent2ID: "",
            mode: 0,
            blockCount: 0,
            scroll: {},
            type: "NodeDocument",
            eof: false,
            isBacklinkExpand: false,
            isSyncing: false,
        }
    } as IWebSocketData;
};

export const showDocVersionDiff = (app: App, leftRef: IDocVersionRef, rightRef: IDocVersionRef) => {
    let editors: Protyle[] = [];
    let diff: IDocVersionDiff;
    let differenceIndex = -1;

    const dialog = new Dialog({
        title: window.siyuan.languages.compare,
        content: `<div class="history__doc-compare fn__flex-column">
    <div class="history__action">
        <div class="block__icons">
            <span class="block__icon block__icon--show b3-tooltips b3-tooltips__e" data-type="diffPrevious" aria-label="${window.siyuan.languages.previousLabel}">
                <svg><use xlink:href="#iconUp"></use></svg>
            </span>
            <span class="block__icon block__icon--show b3-tooltips b3-tooltips__e" data-type="diffNext" aria-label="${window.siyuan.languages.nextLabel}">
                <svg><use xlink:href="#iconDown"></use></svg>
            </span>
            <span class="history__diff-count ft__on-surface">0/0</span>
            <span class="fn__flex-1"></span>
            <span class="block__icon block__icon--show b3-tooltips b3-tooltips__w" data-type="diffSwap" aria-label="${window.siyuan.languages.switchDirect}">
                <svg><use xlink:href="#iconScrollHoriz"></use></svg>
            </span>
        </div>
    </div>
    <div class="history__compare-scroll fn__flex-1">
        <div class="history__compare-editors fn__flex">
            <div class="history__compare-panel fn__flex-column">
                <div class="history__compare-label ft__on-surface ft__ellipsis">${escapeHtml(leftRef.label)}</div>
                <div class="protyle-title__input ft__center ft__breakword"></div>
                <div class="history__compare-content fn__flex-1"></div>
            </div>
            <div class="history__compare-panel fn__flex-column">
                <div class="history__compare-label ft__on-surface ft__ellipsis">${escapeHtml(rightRef.label)}</div>
                <div class="protyle-title__input ft__center ft__breakword"></div>
                <div class="history__compare-content fn__flex-1"></div>
            </div>
        </div>
    </div>
</div>`,
        width: isMobile() ? "100vw" : "90vw",
        height: isMobile() ? "100dvh" : "80vh",
        containerClassName: "b3-dialog__container--theme",
        destroyCallback() {
            editors.forEach((editor) => editor.destroy());
            editors = [];
        }
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_HISTORYCOMPARE);

    const rootElement = dialog.element.querySelector(".history__doc-compare") as HTMLElement;
    const editorsElement = rootElement.querySelector(".history__compare-editors") as HTMLElement;
    const countElement = rootElement.querySelector(".history__diff-count") as HTMLElement;
    const renderCount = () => {
        countElement.textContent = `${differenceIndex < 0 ? 0 : differenceIndex + 1}/${diff?.differences.length || 0}`;
    };
    const focusDifference = (step: number) => {
        if (!diff || diff.differences.length === 0) {
            return;
        }
        differenceIndex = (differenceIndex + step + diff.differences.length) % diff.differences.length;
        rootElement.querySelectorAll(".history__diff--focus").forEach((item) => {
            item.classList.remove("history__diff--focus");
        });
        const id = diff.differences[differenceIndex].id;
        editorsElement.querySelectorAll(".history__compare-panel").forEach((panel) => {
            const block = panel.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
            const target = block || (id === diff.left.rootID ? panel.querySelector(".protyle-title__input") : undefined);
            if (target) {
                target.classList.add("history__diff--focus");
                target.scrollIntoView({block: "center"});
            }
        });
        renderCount();
    };

    rootElement.addEventListener("click", (event) => {
        const target = (event.target as HTMLElement).closest("[data-type]") as HTMLElement;
        if (!target) {
            return;
        }
        if (target.dataset.type === "diffPrevious") {
            focusDifference(-1);
        } else if (target.dataset.type === "diffNext") {
            focusDifference(1);
        } else if (target.dataset.type === "diffSwap") {
            editorsElement.append(editorsElement.firstElementChild);
        }
    });

    fetchPost("/api/history/diffDocVersions", {
        left: {
            type: leftRef.type,
            id: leftRef.id || "",
            path: leftRef.path || "",
        },
        right: {
            type: rightRef.type,
            id: rightRef.id || "",
            path: rightRef.path || "",
        }
    }, (response) => {
        diff = response.data as IDocVersionDiff;
        const contents = [diff.left, diff.right];
        const refs = [leftRef, rightRef];
        editorsElement.querySelectorAll(".history__compare-panel").forEach((panel, index) => {
            const titleElement = panel.querySelector(".protyle-title__input");
            titleElement.textContent = contents[index].title;
            if (diff.titleModified) {
                titleElement.setAttribute("data-history-diff", "modified");
            }
            const contentElement = panel.querySelector(".history__compare-content") as HTMLElement;
            if (diff.large) {
                contentElement.innerHTML = '<textarea class="history__text fn__block" readonly></textarea>';
                (contentElement.firstElementChild as HTMLTextAreaElement).value = contents[index].content;
                return;
            }
            const editor = new Protyle(app, contentElement, {
                blockId: "",
                action: [Constants.CB_GET_HISTORY],
                history: {
                    created: refs[index].type === "history" ? refs[index].id || "" : "",
                    snapshot: refs[index].snapshot || "",
                },
                render: {
                    background: false,
                    gutter: false,
                    breadcrumb: false,
                    breadcrumbDocName: false,
                },
                typewriterMode: false,
            });
            disabledProtyle(editor.protyle);
            editors.push(editor);
            onGet({
                data: toProtyleResponse(contents[index]),
                protyle: editor.protyle,
                action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
            });
        });
        renderCount();
    });
    (document.activeElement as HTMLElement)?.blur();
};
