import {Constants} from "../constants";
import {Dialog} from "../dialog";
import type {App} from "../index";
import {Protyle} from "../protyle";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {escapeHtml} from "../util/escape";
import {fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {
    countDocVersionDifferences,
    type DocVersionDiffFilter,
    type IDocVersionDifference,
    type IDocVersionRef,
    matchesDocVersionDiffFilter,
    orderDocVersionRefs,
} from "./docDiffCore";

export type {IDocVersionRef} from "./docDiffCore";

interface IDocVersionContent {
    id: string;
    rootID: string;
    title: string;
    content: string;
}

interface IDocVersionDiff {
    left: IDocVersionContent;
    right: IDocVersionContent;
    differences: IDocVersionDifference[];
    large: boolean;
    fallback: boolean;
    message: string;
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

const getScrollAnchor = (element: HTMLElement) => {
    const elementRect = element.getBoundingClientRect();
    const x = elementRect.left + elementRect.width / 2;
    const y = Math.min(elementRect.bottom - 1, elementRect.top + Math.min(16, elementRect.height / 2));
    let anchor: HTMLElement | undefined;
    document.elementsFromPoint(x, y).find((item) => {
        const block = item.closest<HTMLElement>("[data-node-id]");
        if (block && element.contains(block)) {
            anchor = block;
            return true;
        }
        return false;
    });
    if (!anchor) {
        return;
    }
    return {
        id: anchor.dataset.nodeId,
        offset: anchor.getBoundingClientRect().top - elementRect.top,
    };
};

const syncDocVersionScroll = (source: HTMLElement, target: HTMLElement) => {
    const anchor = getScrollAnchor(source);
    const targetBlock = anchor?.id ?
        target.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(anchor.id)}"]`) : undefined;
    if (targetBlock) {
        const targetRect = target.getBoundingClientRect();
        target.scrollTop += targetBlock.getBoundingClientRect().top - targetRect.top - anchor.offset;
        return;
    }

    const sourceMax = source.scrollHeight - source.clientHeight;
    const targetMax = target.scrollHeight - target.clientHeight;
    target.scrollTop = sourceMax > 0 ? source.scrollTop / sourceMax * targetMax : 0;
};

export const showDocVersionDiff = (app: App, firstRef: IDocVersionRef, secondRef: IDocVersionRef) => {
    let [leftRef, rightRef] = orderDocVersionRefs(firstRef, secondRef);
    let editors: Protyle[] = [];
    let diff: IDocVersionDiff;
    let differenceIndex = -1;
    let filter: DocVersionDiffFilter = "all";
    let visibleDifferences: IDocVersionDifference[] = [];
    let requestId = 0;
    let isDestroyed = false;
    let isSyncingScroll = false;
    let removeScrollListeners = () => {
        // 初次渲染前没有需要移除的监听器。
    };

    const dialog = new Dialog({
        title: window.siyuan.languages.compare,
        content: `<div class="history__doc-compare fn__flex-column">
    <div class="history__action">
        <div class="block__icons">
            <span class="block__icon block__icon--show b3-tooltips b3-tooltips__e" data-type="diffPrevious" aria-label="${window.siyuan.languages.previousDifference}">
                <svg><use xlink:href="#iconUp"></use></svg>
            </span>
            <span class="block__icon block__icon--show b3-tooltips b3-tooltips__e" data-type="diffNext" aria-label="${window.siyuan.languages.nextDifference}">
                <svg><use xlink:href="#iconDown"></use></svg>
            </span>
            <span class="history__diff-count ft__on-surface">0/0</span>
            <div class="history__compare-legend fn__none"></div>
            <span class="fn__flex-1"></span>
            <span class="block__icon block__icon--show b3-tooltips b3-tooltips__w" data-type="diffSwap" aria-label="${window.siyuan.languages.switchDirect}">
                <svg><use xlink:href="#iconScrollHoriz"></use></svg>
            </span>
        </div>
    </div>
    <div class="history__compare-message fn__none"></div>
    <div class="history__compare-scroll fn__flex-1">
        <div class="history__compare-editors fn__flex">
            <div class="history__compare-panel fn__flex-column">
                <div class="history__compare-label ft__on-surface ft__ellipsis"></div>
                <div class="protyle-title__input ft__center ft__breakword"></div>
                <div class="history__compare-content fn__flex-1"></div>
            </div>
            <div class="history__compare-panel fn__flex-column">
                <div class="history__compare-label ft__on-surface ft__ellipsis"></div>
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
            isDestroyed = true;
            requestId++;
            removeScrollListeners();
            editors.forEach((editor) => editor.destroy());
            editors = [];
        }
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_HISTORYCOMPARE);

    const rootElement = dialog.element.querySelector(".history__doc-compare") as HTMLElement;
    const editorsElement = rootElement.querySelector(".history__compare-editors") as HTMLElement;
    const countElement = rootElement.querySelector(".history__diff-count") as HTMLElement;
    const legendElement = rootElement.querySelector(".history__compare-legend") as HTMLElement;
    const messageElement = rootElement.querySelector(".history__compare-message") as HTMLElement;
    const panels = Array.from(editorsElement.querySelectorAll<HTMLElement>(".history__compare-panel"));

    const destroyEditors = () => {
        removeScrollListeners();
        removeScrollListeners = () => {
            // 当前没有需要移除的监听器。
        };
        editors.forEach((editor) => editor.destroy());
        editors = [];
    };

    const renderCount = () => {
        countElement.textContent = `${differenceIndex < 0 ? 0 : differenceIndex + 1}/${visibleDifferences.length}`;
    };

    const setMessage = (message = "", retry = false) => {
        if (!message) {
            messageElement.classList.add("fn__none");
            messageElement.innerHTML = "";
            return;
        }
        messageElement.classList.remove("fn__none");
        messageElement.innerHTML = `<span>${escapeHtml(message)}</span>${retry ?
            `<button class="b3-button b3-button--outline" data-type="diffRetry">${window.siyuan.languages.retry}</button>` : ""}`;
    };

    const renderLoading = () => {
        destroyEditors();
        diff = undefined;
        visibleDifferences = [];
        differenceIndex = -1;
        renderCount();
        legendElement.classList.add("fn__none");
        setMessage();
        panels.forEach((panel, index) => {
            panel.querySelector(".history__compare-label").textContent = index === 0 ? leftRef.label : rightRef.label;
            panel.querySelector(".protyle-title__input").textContent = "";
            panel.querySelector(".history__compare-content").innerHTML =
                '<div class="fn__loading"><img style="height: 64px;width: 64px" src="/stage/loading-pure.svg"></div>';
        });
    };

    const renderFilters = () => {
        const counts = countDocVersionDifferences(diff.differences);
        const items: {value: DocVersionDiffFilter, label: string, count: number}[] = [
            {value: "all", label: window.siyuan.languages.all, count: counts.all},
            {value: "added", label: window.siyuan.languages.addAttr, count: counts.added},
            {value: "removed", label: window.siyuan.languages.remove, count: counts.removed},
            {value: "modified", label: window.siyuan.languages.update, count: counts.modified},
        ];
        legendElement.innerHTML = items.map((item) => {
            return `<button type="button" class="b3-chip b3-chip--middle b3-chip--pointer history__compare-filter history__compare-filter--${item.value}${filter === item.value ? " b3-chip--current" : ""}" data-type="diffFilter" data-value="${item.value}" aria-pressed="${filter === item.value}"><span></span>${item.label} ${item.count}</button>`;
        }).join("");
        legendElement.classList.remove("fn__none");
    };

    const applyFilter = () => {
        if (!diff) {
            return;
        }
        visibleDifferences = diff.differences.filter((item) => matchesDocVersionDiffFilter(item, filter));
        differenceIndex = -1;
        panels.forEach((panel) => {
            panel.querySelectorAll(".history__diff--filtered").forEach((item) => {
                item.classList.remove("history__diff--filtered");
            });
        });
        diff.differences.forEach((item) => {
            if (matchesDocVersionDiffFilter(item, filter)) {
                return;
            }
            panels.forEach((panel) => {
                const target = item.id === diff.left.rootID ?
                    panel.querySelector(".protyle-title__input") :
                    panel.querySelector(`[data-node-id="${CSS.escape(item.id)}"]`);
                target?.classList.add("history__diff--filtered");
            });
        });
        legendElement.querySelectorAll<HTMLElement>('[data-type="diffFilter"]').forEach((item) => {
            const current = item.dataset.value === filter;
            item.classList.toggle("b3-chip--current", current);
            item.setAttribute("aria-pressed", current.toString());
        });
        renderCount();
    };

    const focusDifference = (step: number) => {
        if (!diff || visibleDifferences.length === 0) {
            return false;
        }
        differenceIndex = (differenceIndex + step + visibleDifferences.length) % visibleDifferences.length;
        rootElement.querySelectorAll(".history__diff--focus").forEach((item) => {
            item.classList.remove("history__diff--focus");
        });
        const id = visibleDifferences[differenceIndex].id;
        isSyncingScroll = true;
        panels.forEach((panel, index) => {
            const block = panel.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
            const target = block || (id === diff.left.rootID ?
                panel.querySelector<HTMLElement>(".protyle-title__input") : undefined);
            if (!target) {
                return;
            }
            target.classList.add("history__diff--focus");
            const scrollElement = editors[index]?.protyle.contentElement;
            if (block && scrollElement) {
                const scrollRect = scrollElement.getBoundingClientRect();
                const blockRect = block.getBoundingClientRect();
                scrollElement.scrollTop += blockRect.top - scrollRect.top - (scrollRect.height - blockRect.height) / 2;
            }
        });
        requestAnimationFrame(() => {
            isSyncingScroll = false;
        });
        renderCount();
        return true;
    };

    const setupScrollSync = () => {
        if (editors.length !== 2) {
            return;
        }
        const left = editors[0].protyle.contentElement;
        const right = editors[1].protyle.contentElement;
        const sync = (source: HTMLElement, target: HTMLElement) => {
            if (isSyncingScroll) {
                return;
            }
            isSyncingScroll = true;
            syncDocVersionScroll(source, target);
            requestAnimationFrame(() => {
                isSyncingScroll = false;
            });
        };
        const syncLeft = () => sync(left, right);
        const syncRight = () => sync(right, left);
        left.addEventListener("scroll", syncLeft, {passive: true});
        right.addEventListener("scroll", syncRight, {passive: true});
        removeScrollListeners = () => {
            left.removeEventListener("scroll", syncLeft);
            right.removeEventListener("scroll", syncRight);
        };
    };

    const renderDiff = () => {
        const contents = [diff.left, diff.right];
        const refs = [leftRef, rightRef];
        panels.forEach((panel, index) => {
            panel.querySelector(".history__compare-label").textContent = refs[index].label;
            const titleElement = panel.querySelector(".protyle-title__input") as HTMLElement;
            titleElement.textContent = contents[index].title;
            if (diff.titleModified) {
                titleElement.setAttribute("data-history-diff", "modified");
            } else {
                titleElement.removeAttribute("data-history-diff");
            }
            const contentElement = panel.querySelector(".history__compare-content") as HTMLElement;
            if (diff.large || diff.fallback) {
                contentElement.innerHTML = '<textarea class="history__text fn__block" readonly></textarea>';
                (contentElement.firstElementChild as HTMLTextAreaElement).value = contents[index].content;
                return;
            }
            contentElement.innerHTML = "";
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
        if (diff.large || diff.fallback) {
            setMessage(diff.fallback ? diff.message : window.siyuan.languages._kernel[36]);
            visibleDifferences = [];
            differenceIndex = -1;
            legendElement.classList.add("fn__none");
            renderCount();
            return;
        }
        setupScrollSync();
        renderFilters();
        applyFilter();
        focusDifference(1);
    };

    const loadDiff = async () => {
        const currentRequestId = ++requestId;
        renderLoading();
        try {
            const response = await fetchSyncPost("/api/history/diffDocVersions", {
                left: {
                    type: leftRef.type,
                    id: leftRef.id || "",
                    path: leftRef.path || "",
                    snapshot: leftRef.snapshot || "",
                },
                right: {
                    type: rightRef.type,
                    id: rightRef.id || "",
                    path: rightRef.path || "",
                    snapshot: rightRef.snapshot || "",
                }
            });
            if (isDestroyed || currentRequestId !== requestId) {
                return;
            }
            if (response.code !== 0 || !response.data) {
                panels.forEach((panel) => {
                    panel.querySelector(".history__compare-content").innerHTML = "";
                });
                setMessage(response.msg || window.siyuan.languages.emptyContent, true);
                return;
            }
            diff = response.data as IDocVersionDiff;
            renderDiff();
        } catch (error) {
            if (isDestroyed || currentRequestId !== requestId) {
                return;
            }
            panels.forEach((panel) => {
                panel.querySelector(".history__compare-content").innerHTML = "";
            });
            setMessage(error instanceof Error ? error.message : String(error), true);
        }
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
            [leftRef, rightRef] = [rightRef, leftRef];
            loadDiff();
        } else if (target.dataset.type === "diffFilter") {
            const nextFilter = target.dataset.value as DocVersionDiffFilter;
            filter = filter === nextFilter ? "all" : nextFilter;
            applyFilter();
            focusDifference(1);
        } else if (target.dataset.type === "diffRetry") {
            loadDiff();
        }
    });
    dialog.element.addEventListener("historyKeydown", (event: CustomEvent<string>) => {
        let handled = false;
        if (event.detail === "ArrowUp") {
            handled = focusDifference(-1);
        } else if (event.detail === "ArrowDown") {
            handled = focusDifference(1);
        }
        if (handled) {
            event.preventDefault();
        }
    });

    loadDiff();
    (document.activeElement as HTMLElement)?.blur();
};
