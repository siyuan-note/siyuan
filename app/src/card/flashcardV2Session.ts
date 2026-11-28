import {bindFlashcardV2ImageViewport} from "./flashcardV2ImageViewport";
import {setFullscreen} from "../protyle/breadcrumb/action";
import {bindFlashcardV2ReviewCounter, flashcardV2ReviewCounterHTML} from "./flashcardV2ReviewCounter";
import {Dialog} from "../dialog";
import {AdaptiveDialog} from "../dialog/adaptiveDialog";
import {notifyFlashcardV2ReviewChange} from "./flashcardV2ReviewChanges";
import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {hideTooltip, showTooltip} from "../dialog/tooltip";
import {Menu} from "../plugin/Menu";
import {toggleMenu} from "../menus/menuToggle";
import {Constants} from "../constants";
import type {App} from "../index";
import {Protyle} from "../protyle";
import {fetchPost} from "../util/fetch";
import {isFlashcardV2Object, readFlashcardV2Revision} from "./flashcardV2Contract";
import {isBrowser, isMobile} from "../util/functions";
import {genUUID} from "../util/genID";
import {escapeAttr, escapeHtml} from "../util/escape";
import {
    hasFlashcardAnswer,
    hideFlashcardAnswer,
    shouldShowFlashcardRatingsImmediately,
    showFlashcardAnswer,
} from "./flashcardMode";
import {highlightRender} from "../protyle/render/highlightRender";
import {processRender} from "../protyle/util/processCode";
import {
    type IFlashcardV2RenderModel,
    type IFlashcardV2ChoiceController,
    type IFlashcardV2RevealController,
    type IFlashcardV2SourceReference,
    type IFlashcardV2TypedAnswerController,
    applyFlashcardV2AnkiCloze,
    createFlashcardV2TemplateStyle,
    flashcardV2ReferenceHTML,
    makeFlashcardV2ContentReadOnly,
    selectFlashcardV2References,
    prepareFlashcardV2Choice,
    prepareFlashcardV2Reveal,
    prepareFlashcardV2TypedAnswers,
    renderFlashcardV2Choice,
    renderFlashcardV2MultiLine,
    renderFlashcardV2AnkiTemplate
} from "./flashcardV2Render";
import {readFlashcardV2RenderModel} from "./flashcardV2Render";
import {
    checkFlashcardV2Answer,
    getFlashcardV2PluginType,
    type IFlashcardV2PluginAnswerController,
    type IFlashcardV2PluginRenderResult,
    snapshotFlashcardV2AnswerResult
} from "./flashcardV2Plugin";
import type {IFlashcardQueryAST} from "./flashcardV2Query";
import {
    canUseFlashcardV2ReviewActions,
    getFlashcardV2ReviewShortcutAction,
    shouldLoadFlashcardV2HeadingChildren,
} from "./flashcardV2State";
import {setFlashcardLocateBlockID} from "./flashcardLocate";
import {bindWorkspaceReviewOutline} from "./workspaceReviewOutline";
import {matchHotKey} from "../protyle/util/hotKey";
import {flashcardV2FlagMenuItems, setFlashcardV2FlagIcon} from "./flashcardV2Flag";
import {flashcardV2ReviewDay} from "./flashcardV2Calendar";
import {moveFlashcardReviewToTab, moveFlashcardReviewToWindow, openFlashcardReviewTab} from "./openFlashcardReviewTab";
import {deferFlashcardV2QueueCard, flashcardV2QueueBreakdown, refreshFlashcardV2Queue, selectFlashcardV2Queue} from "./flashcardV2Queue";
import {openFlashcardV2Due} from "./flashcardV2Due";
import {openFlashcardV2EditLater, type IFlashcardV2EditLater} from "./flashcardV2EditLater";
import {FlashcardV2WeakCards, flashcardV2SubsetOptions} from "./flashcardV2Study";

const showFlashcardV2ImageExplanation = (blockID: string, target: HTMLElement,
    isCurrent: () => boolean, snapshot?: Record<string, string>) => {
    const lang = window.siyuan.languages;
    const render = (dom?: string) => {
        if (!isCurrent() || !target.isConnected) {
            return;
        }
        if (!dom) {
            target.textContent = lang.refExpired;
            return;
        }
        const locate = document.createElement("button");
        locate.type = "button";
        locate.className = "b3-button b3-button--text";
        locate.setAttribute("data-flashcard-explanation-link", "");
        locate.textContent = (target.dataset.imageExplanationNumber ? target.dataset.imageExplanationNumber + ". " : "") +
            lang.jumpTo;
        locate.addEventListener("click", () => {
            const app = window.siyuan.ws.app;
            const action: TProtyleAction[] = [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL, Constants.CB_GET_HL];
            if (isMobile()) {
                void import("../mobile/editor").then(({openMobileFileById}) => openMobileFileById(app, blockID, action));
            } else {
                void import("../editor/util").then(({openFileById}) => openFileById({app, id: blockID, action}));
            }
        });
        const body = document.createElement("div");
        body.innerHTML = window.DOMPurify.sanitize(dom, {
            FORBID_TAGS: ["script", "style", "iframe", "frame", "frameset", "object", "embed"],
        });
        target.replaceChildren(locate, body);
        processRender(body);
        highlightRender(body);
        makeFlashcardV2ContentReadOnly(body);
    };
    if (snapshot) {
        render(snapshot[blockID]);
        return;
    }
    target.textContent = lang.loading;
    let loaded = false;
    void fetchPost("/api/block/getBlockDOMs", {ids: [blockID]}, (response) => {
        loaded = true;
        render(response.data[blockID]);
    }, undefined, () => {}).catch(error => console.error("Flashcard explanation failed", error)).finally(() => {
        if (!loaded) { render(); }
    });
};

interface IFlashcardV2SessionQueueCard {
    repeatDue?: number;
    sessionCard: {
        cardID: string;
        status: "queued" | "shown" | "reviewed" | "skipped";
        optionOrder?: string[];
        dynamicOptions?: Array<{ id: string, entityType: string, entityID: string }>;
    };
    card: {
        id: string;
        sourceID: string;
        flag: number;
        generationStatus: "active" | "disabledByTemplate" | "orphaned" | "deleted";
        editLater?: IFlashcardV2EditLater;
    };
    reviewState: {
        state: string;
        stateRevisionID: string;
        due: number;
        suspended: boolean;
        buriedUntil?: number;
    };
}

const reviewActionTip = (label: string, description: string): Pick<IMenu, "action" | "actionLabel" | "bind"> => ({
    action: "iconInfo",
    actionLabel: description,
    bind: (element) => {
        element.setAttribute("aria-description", description);
        const icon = element.querySelector(".b3-menu__action--hint");
        icon.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isMobile()) {
                showTooltip(escapeHtml(description), icon);
                return;
            }
            const tip = new AdaptiveDialog({
                title: escapeHtml(label),
                content: '<div class="b3-dialog__content">' + escapeHtml(description) + "</div>" +
                    '<div class="b3-dialog__action"><button type="button" class="b3-button b3-button--text">' +
                    escapeHtml(window.siyuan.languages.close) + "</button></div>",
            });
            tip.element.querySelector(".b3-dialog__action button").addEventListener("click", () => tip.destroy());
        });
    },
});

const openPendingEditList = () => {
    void import("./flashcardV2").then(({openFlashcardV2PendingEdits}) => openFlashcardV2PendingEdits());
};

interface IFlashcardV2ReviewResult {
    event: {
        eventID: string;
    };
    buriedSiblingIDs: string[];
    skippedSessionCardIDs: string[];
    beforeState: { suspended: boolean };
    afterState?: { suspended: boolean };
    leechTagged: boolean;
    presetRevisionID: string;
    schedulerVersion: string;
}

interface IFlashcardV2LastReview {
    cardID: string;
    sourceID: string;
    sourceType: string;
    eventID: string;
    index: number;
    skippedSessionCardIDs: string[];
    previousRating?: string;
}

export interface IFlashcardV2SessionTransfer {
    sessionID: string;
    index: number;
    queue: IFlashcardV2SessionQueueCard[];
    initialNewCardIDs?: string[];
    lastReview?: IFlashcardV2LastReview;
    deferredCardIDs: string[];
    ratings: [string, string][];
    answer?: {reveals: number, values: Array<{value: string, checked: boolean}>};
}

interface IFlashcardV2PlaybackController {
    activate: (side: "front" | "back") => void;
    speak: (side: "front" | "back") => void;
    cancel: () => void;
}

interface IFlashcardV2RenderedCard {
    shownAt: number;
    model: IFlashcardV2RenderModel;
    revealController?: IFlashcardV2RevealController;
    typedAnswerController?: IFlashcardV2TypedAnswerController;
    choiceController?: IFlashcardV2ChoiceController;
    pluginAnswerController?: IFlashcardV2PluginAnswerController;
    sourceBlockID?: string;
    playbackController: IFlashcardV2PlaybackController;
    pluginEdit?: () => Promise<void>;
}

export interface IFlashcardV2ReviewSessionOptions {
    reviewMode: "normal" | "reinforcement";
    reviewSetIDs?: string[];
    cardIDs?: string[];
    query?: IFlashcardQueryAST;
    includeSuspended?: boolean;
    includeBuried?: boolean;
    includePaused?: boolean;
    // 显式选择的强化练习使用本次额度，不更改每日设置或正常复习额度。
    practiceLimit?: number;
}

interface IFlashcardSessionSurface {
    element: HTMLElement;
    destroy: () => void;
    dispose: (callback?: () => void) => void;
    mount?: IFlashcardSessionMount;
    move?: (mount?: IFlashcardSessionMount) => boolean;
}

export interface IFlashcardSessionMount {
    element: HTMLElement;
    signal: AbortSignal;
    close: () => void;
}

const createSessionSurface = (options: ConstructorParameters<typeof AdaptiveDialog>[0],
    mount?: IFlashcardSessionMount): IFlashcardSessionSurface => {
    if (!mount) {
        let disposed: (() => void) | undefined;
        const Surface = options.mobileSheet ? AdaptiveDialog : Dialog;
        const dialog = new Surface({...options, destroyCallback: (value) => {
            options.destroyCallback?.(value);
            // 等待对话框从全局列表移除，再打开下一轮练习。
            if (disposed) {
                queueMicrotask(disposed);
            }
        }});
        return {element: dialog.element, destroy: () => dialog.destroy(), dispose: (callback) => {
            disposed = callback;
            dialog.destroy();
        }};
    }
    const element = document.createElement("div");
    element.className = "fn__flex-column fn__flex-1";
    element.style.minHeight = "0";
    element.innerHTML = options.content;
    mount.element.replaceChildren(element);
    const dispose = () => {
        mount.signal.removeEventListener("abort", dispose);
        options.destroyCallback?.();
        element.remove();
    };
    mount.signal.addEventListener("abort", dispose, {once: true});
    return {element, mount, destroy: mount.close, dispose: (callback) => {
        dispose();
        callback?.();
    }};
};

const createMovableSessionSurface = (options: ConstructorParameters<typeof Dialog>[0],
    initialMount?: IFlashcardSessionMount): IFlashcardSessionSurface => {
    const element = document.createElement("div");
    element.className = "fn__flex-column fn__flex-1 card__v2-session-host";
    element.innerHTML = options.content;
    const title = element.querySelector("[data-flashcard-title]");
    let version = 0;
    let ended = false;
    let host: {close: () => void, detach: () => void};
    let mount = initialMount;
    let afterClose: (() => void) | undefined;
    const finish = () => {
        ended = true;
        host.detach();
        options.destroyCallback?.();
        element.remove();
        if (afterClose) { queueMicrotask(afterClose); }
    };
    const attach = (target?: IFlashcardSessionMount) => {
        const generation = ++version;
        delete element.dataset.dialogClosing;
        const onClose = () => {
            if (generation === version && !ended) { finish(); }
        };
        mount = target;
        title.classList.toggle("fn__none", Boolean(mount));
        title.classList.toggle("resize__move", !mount);
        if (mount) {
            mount.element.replaceChildren(element);
            mount.signal.addEventListener("abort", onClose, {once: true});
            host = {close: mount.close, detach: () => target.signal.removeEventListener("abort", onClose)};
        } else {
            const dialog = new Dialog({...options, title: undefined, content: "", destroyCallback: onClose, beforeClose: () => {
                if (options.beforeClose?.() === false) { return false; }
                if (generation === version) { element.dataset.dialogClosing = "true"; }
                return true;
            }});
            dialog.element.setAttribute("data-key", Constants.DIALOG_OPENCARD);
            dialog.element.setAttribute("data-flashcard-v2-review", "");
            dialog.element.querySelector(".b3-dialog__container").setAttribute("aria-label", options.title);
            dialog.element.querySelector(".b3-dialog__body").appendChild(element);
            dialog.element.firstElementChild.addEventListener("click", (event: MouseEvent) => {
                if (typeof event.detail === "string") {
                    element.firstElementChild.dispatchEvent(new CustomEvent("click", {detail: event.detail}));
                }
            });
            host = {close: () => dialog.destroy(), detach: () => {}};
        }
    };
    attach(initialMount);
    return {
        element,
        get mount() { return mount; },
        destroy: () => host.close(),
        dispose: (callback) => {
            afterClose = callback;
            if (mount) {
                finish();
            } else {
                host.close();
            }
        },
        move: (target) => {
            if (ended || target?.signal.aborted || !element.isConnected || !target && !mount) {
                return false;
            }
            const previous = host;
            attach(target);
            previous.detach();
            previous.close();
            queueMicrotask(() => {
                if (element.isConnected) { element.focus({preventScroll: true}); }
            });
            return true;
        },
    };
};

let flashcardV2ReviewOpening = false;

const nextLocalDay = (now: number) => {
    const date = new Date(now);
    date.setHours(24, 0, 0, 0);
    return date.getTime();
};

const referenceHTML = (references: IFlashcardV2SourceReference[], doms: Record<string, string>) => {
    return references.map((reference) => flashcardV2ReferenceHTML(reference, doms)).join("");
};

const loadFlashcardV2DOMs = (model: IFlashcardV2RenderModel, references: IFlashcardV2SourceReference[],
    callback: (doms: Record<string, string>) => void) => {
    const blockIDs = references.map((reference) => reference.entityID);
    let headingRequest: ReturnType<typeof fetchPost> | undefined;
    return fetchPost("/api/block/getBlockDOMs", {ids: blockIDs}, (response) => {
        const doms = response.data as Record<string, string>;
        if (model.schema?.builtinType === "block-flashcard" && references.length === 1) {
            const blockID = references[0].entityID;
            const template = document.createElement("template");
            template.innerHTML = doms[blockID] || "";
            const sourceElement = [...template.content.querySelectorAll<HTMLElement>("[data-node-id]")]
                .find((element) => element.dataset.nodeId === blockID);
            if (sourceElement && shouldLoadFlashcardV2HeadingChildren(
                sourceElement.getAttribute("data-type"), sourceElement.getAttribute("fold"), window.siyuan.config.flashcard.heading)) {
                headingRequest = fetchPost("/api/block/getHeadingChildrenDOM", {
                    id: blockID,
                    removeFoldAttr: true,
                }, (headingResponse) => callback({[blockID]: headingResponse.data as string}));
                return;
            }
        }
        callback(doms);
    }).then(() => headingRequest);
};

const flashcardV2PlainText = (value: string) => {
    const element = document.createElement("div");
    element.innerHTML = value;
    return (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
};

const renderFlashcardV2Context = (model: IFlashcardV2RenderModel, sourceBlockID: string,
    sensitiveReferences: IFlashcardV2SourceReference[], sensitiveTextValues: string[],
    doms: Record<string, string>, element: HTMLElement, pathElement: HTMLElement, isCurrent: () => boolean,
    concealedBlockIDs: string[] = []) => {
    const policy = model.template.contextPolicy;
    const ancestorDepth = Math.min(5, Math.max(0, Math.floor(policy?.ancestorDepth || 0)));
    const adjacentBefore = Math.min(5, Math.max(0, Math.floor(policy?.adjacentBefore || 0)));
    const adjacentAfter = Math.min(5, Math.max(0, Math.floor(policy?.adjacentAfter || 0)));
    if (!sourceBlockID || !policy?.breadcrumb && !policy?.documentTitle && ancestorDepth === 0 &&
        adjacentBefore === 0 && adjacentAfter === 0) {
        return;
    }
    const sensitiveTexts = sensitiveReferences.map((reference) => doms[reference.entityID] || "")
        .concat(sensitiveTextValues).map(flashcardV2PlainText)
        .filter((value) => value.length >= 3);
    const sensitiveIDs = new Set(sensitiveReferences.map((reference) => reference.entityID));
    sensitiveIDs.add(sourceBlockID);
    concealedBlockIDs.forEach(id => sensitiveIDs.add(id));
    const containsSensitiveText = (value: string) => {
        const text = flashcardV2PlainText(value);
        return text.length >= 3 && sensitiveTexts.some((answer) => text.includes(answer) || answer.includes(text));
    };
    const showContext = () => {
        if (isCurrent() && element.childElementCount > 0) {
            element.classList.remove("fn__none");
        }
    };
    const appendContextBlocks = (ids: string[], className: string) => {
        const uniqueIDs = [...new Set(ids)].filter((id) => id && !sensitiveIDs.has(id));
        if (uniqueIDs.length === 0) {
            return;
        }
        fetchPost("/api/block/getBlockDOMs", {ids: uniqueIDs}, (response) => {
            if (!isCurrent()) {
                return;
            }
            const contextDOMs = response.data as Record<string, string>;
            const blocks = uniqueIDs.map((id) => {
                const holder = document.createElement("div");
                holder.innerHTML = contextDOMs[id] || "";
                holder.querySelectorAll("script,style").forEach((item) => item.remove());
                holder.querySelectorAll<HTMLElement>("[data-node-id]").forEach((item) => {
                    if (sensitiveIDs.has(item.dataset.nodeId)) {
                        item.remove();
                    }
                });
                if (!holder.textContent?.trim() || containsSensitiveText(holder.innerHTML)) {
                    return "";
                }
                return `<div class="card__v2-context-block ${className}" data-node-id="${escapeAttr(id)}">${holder.innerHTML}</div>`;
            }).filter(Boolean).join("");
            if (!blocks) {
                return;
            }
            element.insertAdjacentHTML("beforeend", blocks);
            processRender(element);
            highlightRender(element);
            makeFlashcardV2ContentReadOnly(element);
            showContext();
        });
    };
    fetchPost("/api/block/getBlockBreadcrumb", {
        id: sourceBlockID,
        excludeTypes: ["NodeTextMark-mark"],
    }, (response) => {
        if (!isCurrent()) {
            return;
        }
        const allPaths = response.data as Array<{ id: string, name?: string }>;
        const paths = allPaths.filter((item, index) => {
            if (item.id === sourceBlockID || concealedBlockIDs.includes(item.id) || !item.name?.trim() || !policy.breadcrumb && index !== 0 ||
                !policy.documentTitle && index === 0 && allPaths.length > 1) {
                return false;
            }
            const name = item.name.replace(/\s+/g, " ").trim().toLowerCase();
            return name.length < 3 || !sensitiveTexts.some((answer) => answer === name || answer.includes(name));
        });
        if (paths.length > 0) {
            const path = paths.map((item) => item.name.trim()).join(" / ");
            pathElement.textContent = path;
            pathElement.title = path;
        }
        const ancestors = ancestorDepth === 0 ? [] :
            allPaths.filter((item, index) => item.id !== sourceBlockID && index > 0)
                .slice(-ancestorDepth).map((item) => item.id);
        appendContextBlocks(ancestors, "card__v2-context-block--ancestor");
        if (adjacentBefore === 0 && adjacentAfter === 0) {
            return;
        }
        const sourceIndex = allPaths.findIndex((item) => item.id === sourceBlockID);
        const parentID = sourceIndex > 0 ? allPaths[sourceIndex - 1].id : "";
        if (!parentID) {
            return;
        }
        fetchPost("/api/block/getChildBlocks", {id: parentID}, (childrenResponse) => {
            if (!isCurrent()) {
                return;
            }
            const children = childrenResponse.data as Array<{ id: string }>;
            const index = children.findIndex((item) => item.id === sourceBlockID);
            if (index < 0) {
                return;
            }
            const adjacentIDs = children.slice(Math.max(0, index - adjacentBefore), index)
                .concat(children.slice(index + 1, index + 1 + adjacentAfter)).map((item) => item.id);
            appendContextBlocks(adjacentIDs, "card__v2-context-block--adjacent");
        });
    });
};

const flashcardV2SpeechText = (element: Element, model: IFlashcardV2RenderModel,
    spec?: IFlashcardV2RenderModel["template"]["frontSpec"]) => {
    const clone = element.cloneNode(true) as Element;
    clone.querySelectorAll(".fn__none,.card__v2-multi-line-answer--hidden,input,button,script,style,svg")
        .forEach((item) => item.remove());
    if (spec?.tts?.fieldIDs?.length) {
        const blockIDs = new Set(model.references.filter((reference) =>
            reference.fieldID && spec.tts.fieldIDs.includes(reference.fieldID)).map((reference) => reference.entityID));
        clone.querySelectorAll("[data-flashcard-reference]").forEach((reference) => {
            if (!blockIDs.has((reference as HTMLElement).dataset.flashcardReference)) {
                reference.remove();
            }
        });
    }
    return clone.textContent?.replace(/\s+/g, " ").trim() || "";
};

const prepareFlashcardV2Playback = (model: IFlashcardV2RenderModel, front: Element, back: Element,
    specialFront: boolean): IFlashcardV2PlaybackController => {
    const root = (side: "front" | "back") => side === "front" || specialFront ? front : back;
    const spec = (side: "front" | "back") => side === "front" ? model.template.frontSpec : model.template.backSpec;
    const speak = (side: "front" | "back", automatic: boolean) => {
        const tts = spec(side)?.tts;
        if (typeof window.speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined" ||
            tts?.enabled === false || automatic && !tts?.autoPlay) {
            return;
        }
        const text = flashcardV2SpeechText(root(side), model, spec(side));
        if (!text) {
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = tts?.lang?.slice(0, 35) || window.siyuan.config.appearance.lang;
        utterance.rate = Math.min(2, Math.max(.5, tts?.rate || 1));
        utterance.pitch = Math.min(2, Math.max(.5, tts?.pitch || 1));
        window.speechSynthesis.speak(utterance);
    };
    return {
        activate: (side) => {
            if (spec(side)?.mediaAutoplay) {
                root(side).querySelectorAll<HTMLMediaElement>("audio,video").forEach((media) => {
                    void media.play().catch((): void => undefined);
                });
            }
            speak(side, true);
        },
        speak: (side) => speak(side, false),
        cancel: () => {
            window.speechSynthesis?.cancel();
            [front, back].forEach((element) => element.querySelectorAll<HTMLMediaElement>("audio,video")
                .forEach((media) => media.pause()));
        },
    };
};

const setActionsVisible = (dialog: IFlashcardSessionSurface, revealed: boolean) => {
    dialog.element.querySelector('[data-flashcard-action="reveal"]').classList.toggle("fn__none", revealed);
    dialog.element.querySelector('[data-flashcard-action="ratings"]').classList.toggle("fn__none", !revealed);
    dialog.element.querySelector('[data-flashcard-action="finish"]').classList.add("fn__none");
};

const setReviewActionsEnabled = (dialog: IFlashcardSessionSurface, enabled: boolean) => {
    const contentElement = dialog.element.querySelector(".card__block");
    contentElement?.setAttribute("aria-busy", enabled ? "false" : "true");
    dialog.element.querySelectorAll<HTMLButtonElement>(
        "[data-type=show], [data-type=study-later], [data-type=skip], [data-type=flag], [data-rating]")
        .forEach(button => { button.disabled = !enabled; });
};

const setUndoVisible = (dialog: IFlashcardSessionSurface, visible: boolean) => {
    dialog.element.querySelector('[data-type="undo-review"]').classList.toggle("fn__none", !visible);
};

const finishSession = (sessionID: string, status: "completed" | "abandoned", callback?: () => void) => {
    return fetchPost("/api/flashcard/finishSession", {
        operationID: genUUID(),
        sessionID,
        status,
        endedAt: Date.now(),
    }, callback);
};

const emitFlashcardV2Lifecycle = (app: App, type: TEventBus, detail: Record<string, unknown>) => {
    notifyFlashcardV2ReviewChange(type);
    app.plugins.forEach((plugin) => plugin.eventBus.emit(type, detail));
};

const isFlashcardV2Flag = (value: unknown): value is {flag: number, name: string} => isFlashcardV2Object(value) &&
    typeof value.flag === "number" && typeof value.name === "string";

const sessionCompletionContent = (canUndo: boolean, reviewMode: IFlashcardV2ReviewSessionOptions["reviewMode"],
    weakCount = 0) => `<div class="card__empty-icon">🔮</div>
<span>${escapeHtml(window.siyuan.languages.flashcardNoEligibleCards)}</span>
${reviewMode === "normal" ? `<span class="ft__on-surface">${escapeHtml(window.siyuan.languages.flashcardNoEligibleCardsTip)}</span>` : ""}
${weakCount ? `<div class="fn__hr"></div><span class="ft__on-surface">${window.siyuan.languages.flashcardReviewReinforcementTip}</span>` : ""}
<span class="card__v2-completion-actions"><button data-type="pending-edits" class="b3-button b3-button--outline">${window.siyuan.languages.flashcardPendingEdits}</button>${weakCount ? `<button data-type="practice-weak" class="b3-button b3-button--outline">${escapeHtml(window.siyuan.languages.flashcardRetryWeak.replace("${count}", weakCount.toString()))}</button>` : ""}${canUndo ? `<button data-type="undo-review" class="b3-button b3-button--outline"><svg><use xlink:href="#iconUndo"></use></svg>${window.siyuan.languages.undo}</button>` : ""}<button data-type="finish" class="b3-button b3-button--text">${window.siyuan.languages.flashcardFinishSession}</button></span>`;

const flashcardSessionTitle = (name: string) => `<span class="fn__flex">
    <svg class="block__logoicon fn__flex-center fn__flex-shrink" aria-hidden="true"><use xlink:href="#iconRiffCard"></use></svg>
    <span class="fn__ellipsis fn__flex-center">${escapeHtml(name)}</span>
</span>`;

const sessionContent = (mobile = false, name = "") => `<div class="b3-dialog__content fn__flex-column card__v2-session">
<div class="card__v2-session-header">
<span data-flashcard-title class="card__v2-session-title">${flashcardSessionTitle(name)}</span>
<div data-flashcard-toolbar class="fn__flex card__v2-session-toolbar">
    <span data-flashcard-path class="card__v2-session-path ft__on-surface"></span>
    ${flashcardV2ReviewCounterHTML(mobile)}
    <button data-type="flag" class="block__icon block__icon--show ariaLabel" data-position="north" aria-label="${window.siyuan.languages.flashcardFlag}" aria-haspopup="menu" disabled><svg><use xlink:href="#iconFlag"></use></svg></button>
    <button data-type="read-aloud" class="block__icon block__icon--show ariaLabel${typeof window.speechSynthesis === "undefined" ? " fn__none" : ""}" aria-label="${window.siyuan.languages.flashcardReadAloud}"><svg><use xlink:href="#iconPlay"></use></svg></button>
    <button data-type="edit-source" class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></button>
    <button data-type="skip" class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.skip}" disabled><svg><use xlink:href="#iconForward"></use></svg></button>
    ${mobile ? "" : `<button data-type="review-fullscreen" class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.fullscreen}" aria-pressed="false"><svg><use xlink:href="#iconFullscreen"></use></svg></button>`}
    ${mobile ? "" : `<button data-type="review-placement" data-menu="true" class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.flashcardOpenMode}" aria-haspopup="menu"><svg aria-hidden="true"><use xlink:href="#iconOpen"></use></svg></button>`}
    <button data-type="more" class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></button>
    <button data-type="undo-review" class="block__icon block__icon--show ariaLabel fn__none" aria-label="${window.siyuan.languages.undo}"><svg><use xlink:href="#iconUndo"></use></svg></button>
</div>
</div>
<div class="fn__flex fn__flex-1 card__v2-session-body">
<div class="card__block fn__flex-1 card__v2-session-content" aria-busy="true">
    <div data-flashcard-context class="card__v2-context ft__on-surface fn__none"></div>
    <div class="protyle-wysiwyg" contenteditable="false" data-flashcard-front></div>
    <div class="fn__none" data-flashcard-answer><div class="fn__hr"></div><div class="protyle-wysiwyg" contenteditable="false"></div></div>
</div>
</div>
<div data-flashcard-skip-recovery class="fn__flex card__action card__v2-session-actions fn__none" role="status">
    <span class="ft__error">${window.siyuan.languages.flashcardSkipIncomplete}</span>
    <button data-type="retry-skip" class="b3-button b3-button--outline">${window.siyuan.languages.retry}</button>
</div>
<div data-flashcard-action="reveal" class="fn__flex card__action card__v2-session-actions">
    <button data-type="show" class="b3-button b3-button--text" disabled><div class="card__icon">👀</div>${window.siyuan.languages.cardShowAnswer}</button>
    <span class="fn__space"></span>
    <button data-type="study-later" class="b3-button b3-button--cancel ariaLabel" aria-label="${window.siyuan.languages.flashcardStudyLaterTip}" disabled><div class="card__icon">💤</div>${window.siyuan.languages.flashcardStudyLater}</button>
</div>
<div data-flashcard-action="ratings" class="fn__flex card__action card__v2-session-actions fn__none">
    <button data-rating="again" class="b3-button b3-button--error" disabled><div class="card__icon">🙈</div><span class="card__v2-rating-label">${window.siyuan.languages.cardRatingAgain}</span><span class="fn__block card__v2-rating-interval" data-rating-interval></span></button>
    <span class="fn__space"></span>
    <button data-rating="hard" class="b3-button b3-button--warning" disabled><div class="card__icon">😬</div><span class="card__v2-rating-label">${window.siyuan.languages.cardRatingHard}</span><span class="fn__block card__v2-rating-interval" data-rating-interval></span></button>
    <span class="fn__space"></span>
    <button data-rating="good" class="b3-button b3-button--info" disabled><div class="card__icon">😊</div><span class="card__v2-rating-label">${window.siyuan.languages.cardRatingGood}</span><span class="fn__block card__v2-rating-interval" data-rating-interval></span></button>
    <span class="fn__space"></span>
    <button data-rating="easy" class="b3-button b3-button--success" disabled><div class="card__icon">🌈</div><span class="card__v2-rating-label">${window.siyuan.languages.cardRatingEasy}</span><span class="fn__block card__v2-rating-interval" data-rating-interval></span></button>
</div>
<div data-flashcard-action="finish" class="fn__flex card__action card__v2-session-actions fn__none">
    <button data-type="finish" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>
</div>`;

const renderFlashcardV2Card = (dialog: IFlashcardSessionSurface,
    current: Pick<IFlashcardV2SessionQueueCard["sessionCard"], "cardID" | "optionOrder" | "dynamicOptions">,
    isCurrent: () => boolean, callback: (rendered: IFlashcardV2RenderedCard) => void,
    unavailable: () => void, {preview, includeRatingIntervals, draft}: {
        preview?: boolean;
        includeRatingIntervals?: boolean;
        draft?: {model: IFlashcardV2RenderModel, doms: Record<string, string>};
    } = {}) => {
    const contentElement = dialog.element.querySelector(".card__block") as HTMLElement;
    const contextElement = dialog.element.querySelector("[data-flashcard-context]") as HTMLElement;
    const pathElement = dialog.element.querySelector<HTMLElement>("[data-flashcard-path]");
    const frontElement = dialog.element.querySelector("[data-flashcard-front]") as HTMLElement;
    const answerElement = dialog.element.querySelector("[data-flashcard-answer]") as HTMLElement;
    pathElement.textContent = "";
    pathElement.title = "";
    contextElement.classList.add("fn__none");
    contextElement.innerHTML = "";
    setReviewActionsEnabled(dialog, false);
    const renderModel = (model: IFlashcardV2RenderModel) => {
        if (!isCurrent()) {
            return;
        }
        const dynamicReferences: IFlashcardV2SourceReference[] = (current.dynamicOptions || [])
            .filter((option) => option.entityType === "block")
            .map((option, optionIndex) => ({
                entityType: "block",
                entityID: option.entityID,
                role: `option:${option.id}`,
                sort: model.references.length + optionIndex,
            }));
        model.references = model.references.concat(dynamicReferences);
        const references = model.references.filter((reference) => reference.entityType === "block")
            .sort((left, right) => left.sort - right.sort);
        let blocksLoaded = false;
        const loadDOMs = (loaded: (doms: Record<string, string>) => void) => draft ?
            Promise.resolve().then(() => loaded(draft.doms)) : loadFlashcardV2DOMs(model, references, loaded);
        void loadDOMs((doms) => {
            if (!isCurrent()) {
                return;
            }
            dialog.element.querySelector("[data-flashcard-template-style]")?.remove();
            const templateStyle = createFlashcardV2TemplateStyle(model.template.style || "", contentElement);
            if (templateStyle) {
                dialog.element.appendChild(templateStyle);
            }
            dialog.element.querySelector("[data-flashcard-toolbar]").classList.remove("fn__none");
            frontElement.className = "protyle-wysiwyg";
            frontElement.innerHTML = "";
            answerElement.classList.add("fn__none");
            (answerElement.querySelector(".protyle-wysiwyg") as HTMLElement).innerHTML = "";
            contentElement.className = "card__block fn__flex-1 card__v2-session-content";
            setActionsVisible(dialog, false);
            dialog.element.querySelectorAll<HTMLButtonElement>("button[data-rating]").forEach(button => {
                button.querySelector("[data-rating-interval]").textContent =
                    model.ratingIntervals?.[button.dataset.rating] ?? "";
            });
            let frontReferences = selectFlashcardV2References(references, model.template.frontSpec);
            if (frontReferences.length === 0) {
                frontReferences = references.slice(0, 1);
            }
            let backReferences = selectFlashcardV2References(references, model.template.backSpec);
            if (backReferences.length === 0) {
                backReferences = references;
            }
            const frontIDs = new Set(frontReferences.map((reference) => reference.entityID));
            const answerReferences = backReferences.filter((reference) => !frontIDs.has(reference.entityID));
            const ankiFront = renderFlashcardV2AnkiTemplate(model, "front", doms);
            const ankiBack = ankiFront === undefined ? undefined :
                renderFlashcardV2AnkiTemplate(model, "back", doms, ankiFront);
            const specialFront = renderFlashcardV2Choice(model, doms, current.optionOrder || []) ??
                renderFlashcardV2MultiLine(model, doms);
            let hasRenderedAnswer = specialFront !== undefined ||
                (ankiBack !== undefined ? ankiBack.trim() !== "" : answerReferences.length > 0);
            frontElement.innerHTML = specialFront === undefined ?
                (ankiFront === undefined ? referenceHTML(frontReferences, doms) : ankiFront) : specialFront;
            if (model.schema?.builtinType === "block-flashcard") {
                frontElement.querySelectorAll("[data-flashcard-reference]").forEach((reference) => {
                    reference.setAttribute("data-flashcard-block-card", "true");
                });
            }
            if (model.source.sourceType === "typed-answer" && model.template.answerMode === "typed") {
                frontElement.insertAdjacentHTML("beforeend",
                    '<input class="b3-text-field b3-text-field--editor-font fn__block" data-flashcard-type-answer autocomplete="off">');
            }
            answerElement.querySelector(".protyle-wysiwyg").innerHTML = specialFront === undefined ?
                (ankiBack === undefined ? referenceHTML(answerReferences, doms) : ankiBack) : "";
            if (model.source.sourceType === "anki" && typeof model.card.variantData?.ord === "number") {
                const target = model.card.variantData.ord + 1;
                applyFlashcardV2AnkiCloze(frontElement, target, false);
                applyFlashcardV2AnkiCloze(answerElement, target, true);
            }
            let pluginResult: IFlashcardV2PluginRenderResult | undefined;
            let pluginRegistration: ReturnType<typeof getFlashcardV2PluginType>;
            if (model.source.sourceType.startsWith("plugin:")) {
                pluginRegistration = getFlashcardV2PluginType(model.source.sourceType);
                let pluginRendered = false;
                if (pluginRegistration?.render) {
                    try {
                        pluginResult = pluginRegistration.render({
                            sourceType: model.source.sourceType,
                            model,
                            doms,
                            frontElement,
                            backElement: answerElement.querySelector(".protyle-wysiwyg"),
                        }) || undefined;
                        pluginRendered = true;
                        hasRenderedAnswer = pluginResult?.hasAnswer !== false;
                    } catch (error) {
                        console.error(`Flashcard plugin renderer [${model.source.sourceType}] failed`, error);
                    }
                }
                if (!pluginRendered) {
                    frontElement.textContent = model.source.pluginData?.textFallback || model.source.sourceType;
                    answerElement.querySelector(".protyle-wysiwyg").textContent =
                        `${window.siyuan.languages.flashcardPluginUnavailable}: ${model.source.sourceType}`;
                    hasRenderedAnswer = true;
                }
            }
            answerElement.classList.add("fn__none");
            processRender(contentElement);
            highlightRender(contentElement);
            if (!model.source.sourceType.startsWith("plugin:")) {
                makeFlashcardV2ContentReadOnly(frontElement);
                makeFlashcardV2ContentReadOnly(answerElement);
            }
            const revealController = pluginResult?.revealController || prepareFlashcardV2Reveal(frontElement, model,
                bindFlashcardV2ImageViewport,
                (blockID, target) => showFlashcardV2ImageExplanation(blockID, target, isCurrent, draft?.doms));
            const typedAnswerController = prepareFlashcardV2TypedAnswers(frontElement, model, doms);
            const choiceController = prepareFlashcardV2Choice(frontElement, model);
            const playbackController = prepareFlashcardV2Playback(model, frontElement, answerElement,
                specialFront !== undefined);
            const flashcardConfig = window.siyuan.config.flashcard;
            // 文本遮挡控制器负责逐步显示标记，通用标记样式会遮住已经揭晓的步骤。
            const displayConfig = revealController && (model.source.sourceType === "cloze" || model.source.sourceType === "ordered") ?
                {...flashcardConfig, mark: false} : flashcardConfig;
            const hasInternalAnswer = hasFlashcardAnswer(frontElement, displayConfig);
            if (hasInternalAnswer) {
                hideFlashcardAnswer(contentElement, displayConfig);
            }
            if (shouldShowFlashcardRatingsImmediately(Boolean(revealController), hasInternalAnswer,
                hasRenderedAnswer)) {
                setActionsVisible(dialog, true);
            }
            const sourceBlockID = references.find((reference) => reference.id === model.source.primaryRefID)?.entityID ||
                references[0]?.entityID;
            const choiceAnswers = new Set(model.source.sourceType === "choice" &&
                "correctOptionIDs" in (model.source.generationConfig || {}) ?
                (model.source.generationConfig as { correctOptionIDs: string[] }).correctOptionIDs : []);
            const sensitiveReferences = references.filter((reference) => answerReferences.includes(reference) ||
                reference.role === "back" || reference.role.startsWith("answer:") ||
                reference.role.startsWith("option:") && choiceAnswers.has(reference.role.slice(7)));
            const sensitiveTextValues = [...frontElement.querySelectorAll(
                ".card__v2-occlusion,[data-multi-line-answer],span[data-type~=mark]")]
                .concat([...answerElement.querySelectorAll(".card__v2-anki-cloze")])
                .map((item) => item.textContent || "");
            // 草稿只使用经过权限检查的快照，避免再次读取正文触发修复写回。
            if (!draft) {
                const concealed = revealController?.concealedContent;
                renderFlashcardV2Context(model, sourceBlockID, sensitiveReferences,
                    sensitiveTextValues.concat(concealed?.texts.map(escapeHtml) || []), doms,
                    contextElement, pathElement, isCurrent, concealed?.blockIDs);
            }
            callback({
                shownAt: performance.now(),
                model,
                revealController,
                typedAnswerController,
                choiceController,
                pluginAnswerController: pluginResult?.answerController,
                sourceBlockID,
                playbackController,
                pluginEdit: pluginRegistration?.edit ? () => Promise.resolve(pluginRegistration.edit({
                    sourceType: model.source.sourceType,
                    model,
                    doms,
                })) : undefined,
            });
            blocksLoaded = true;
            if (!preview) {
                playbackController.activate("front");
            }
            (frontElement.querySelector("[data-anki-type-answer], [data-flashcard-type-answer], :not(.fn__none) > [data-flashcard-image-answer]") as
                HTMLInputElement)?.focus();
        }).then(() => {
            if (!blocksLoaded && isCurrent()) {
                unavailable();
            }
        });
    };
    if (draft) {
        renderModel(structuredClone(draft.model));
        return;
    }
    let modelLoaded = false;
    void fetchPost("/api/flashcard/getRenderModel", {cardID: current.cardID, includeRatingIntervals}, (response) => {
        modelLoaded = true;
        renderModel(readFlashcardV2RenderModel(response.data));
    }).then(() => {
        if (!modelLoaded && isCurrent()) {
            unavailable();
        }
    });
};

const renderSessionCard = (dialog: IFlashcardSessionSurface, queue: IFlashcardV2SessionQueueCard[], index: number,
    includeRatingIntervals: boolean,
    isCurrent: () => boolean, callback: (rendered: IFlashcardV2RenderedCard) => void,
    unavailable: () => void) => {
    renderFlashcardV2Card(dialog, queue[index].sessionCard, isCurrent, callback, unavailable, {includeRatingIntervals});
};

// 预览仅加载渲染模型和块内容，不打开复习会话，也不发送评分或会话事件。
export const openFlashcardV2Preview = (cardIDs: string[], initialIndex = 0,
    draft?: {models: IFlashcardV2RenderModel[], doms: Record<string, string>}) => {
    if (cardIDs.length === 0) {
        return;
    }
    let index = Math.min(cardIDs.length - 1, Math.max(0, initialIndex));
    let generation = 0;
    let rendered: IFlashcardV2RenderedCard | undefined;
    const dialog = createSessionSurface({
        title: window.siyuan.languages.flashcardPreview,
        width: "min(880px, 96vw)",
        height: "min(760px, 86vh)",
        destroyCallback: () => {
            generation++;
            rendered?.revealController?.destroy?.();
            rendered?.playbackController.cancel();
        },
        content: `<div class="b3-dialog__content fn__flex-column card__v2-session card__v2-preview">
<div data-flashcard-toolbar class="fn__flex card__v2-session-toolbar">
<button data-type="previous" class="b3-button b3-button--outline">${window.siyuan.languages.previous}</button>
<span data-flashcard-count class="fn__flex-shrink" aria-live="polite"></span>
<button data-type="next" class="b3-button b3-button--outline">${window.siyuan.languages.next}</button>
<span data-flashcard-path class="card__v2-session-path ft__on-surface"></span>
</div>
<div class="card__block fn__flex-1 card__v2-session-content" aria-busy="true">
<div data-flashcard-context class="card__v2-context ft__on-surface fn__none"></div>
<div class="protyle-wysiwyg" contenteditable="false" data-flashcard-front></div>
<div class="fn__none" data-flashcard-answer><div class="fn__hr"></div><div class="protyle-wysiwyg" contenteditable="false"></div></div>
</div>
<div data-flashcard-action="reveal" class="card__v2-preview-actions">
<button data-type="reset" class="b3-button b3-button--outline">${window.siyuan.languages.refresh}</button>
<button data-type="show" class="b3-button b3-button--text" disabled>${window.siyuan.languages.cardShowAnswer}</button>
<button data-type="retry" class="b3-button b3-button--text fn__none">${window.siyuan.languages.retry}</button>
</div>
<div data-flashcard-action="ratings" class="fn__none"></div>
<div data-flashcard-action="finish" class="fn__none"></div></div>`,
    });
    const show = dialog.element.querySelector<HTMLButtonElement>('[data-type="show"]');
    const retry = dialog.element.querySelector<HTMLButtonElement>('[data-type="retry"]');
    const load = () => {
        const request = ++generation;
        const isCurrent = () => request === generation && dialog.element.isConnected;
        rendered?.revealController?.destroy?.();
        rendered?.playbackController.cancel();
        rendered = undefined;
        show.disabled = true;
        show.classList.remove("fn__none");
        retry.classList.add("fn__none");
        dialog.element.querySelector('[data-flashcard-action="reveal"]').classList.remove("fn__none");
        dialog.element.querySelector("[data-flashcard-count]").textContent = `${index + 1} / ${cardIDs.length}`;
        dialog.element.querySelector<HTMLButtonElement>('[data-type="previous"]').disabled = index === 0;
        dialog.element.querySelector<HTMLButtonElement>('[data-type="next"]').disabled = index === cardIDs.length - 1;
        dialog.element.querySelector("[data-flashcard-front]").textContent = "";
        dialog.element.querySelector("[data-flashcard-answer]").classList.add("fn__none");
        renderFlashcardV2Card(dialog, {cardID: cardIDs[index]}, isCurrent, (result) => {
            rendered = result;
            setReviewActionsEnabled(dialog, true);
            dialog.element.querySelector('[data-flashcard-action="reveal"]').classList.remove("fn__none");
        }, () => {
            dialog.element.querySelector(".card__block").setAttribute("aria-busy", "false");
            dialog.element.querySelector("[data-flashcard-front]").textContent = window.siyuan.languages.flashcardLoadFailed;
            show.classList.add("fn__none");
            retry.classList.remove("fn__none");
        }, {preview: true, draft: draft ? {model: draft.models[index], doms: draft.doms} : undefined});
    };
    dialog.element.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-type]");
        if (!button || button.disabled) {
            return;
        }
        if (button.dataset.type === "show" && rendered) {
            if (rendered.revealController?.revealNext() ?? true) {
                checkFlashcardV2Answer(() => rendered.pluginAnswerController?.check() ??
                    rendered.choiceController?.check() ?? rendered.typedAnswerController?.check(),
                () => showMessage(window.siyuan.languages.flashcardAnswerCheckFailed, 6000, "error"));
                showFlashcardAnswer(dialog.element.querySelector(".card__block"));
                dialog.element.querySelector("[data-flashcard-answer]").classList.remove("fn__none");
                show.disabled = true;
            }
        } else if (["previous", "next", "reset", "retry"].includes(button.dataset.type)) {
            index += button.dataset.type === "previous" ? -1 : button.dataset.type === "next" ? 1 : 0;
            load();
        }
    });
    load();
};

export const openFlashcardV2SourceEditor = (app: App, blockID: string, callback: () => void, locate = false,
    references: readonly IFlashcardV2SourceReference[] = []) => {
    const editorHolder: { current?: Protyle } = {};
    const lang = window.siyuan.languages;
    const blocks = [...new Map(references.filter(ref => ref.entityType === "block").map(ref => [ref.entityID, ref])).values()]
        .sort((left, right) => left.sort - right.sort);
    const blockLabel = (reference: IFlashcardV2SourceReference) => {
        if (reference.role === "front" || reference.role === "question") { return lang.flashcardQuestion; }
        if (reference.role === "back" || reference.role.startsWith("answer:")) { return lang.flashcardManagementAnswer; }
        return lang.block;
    };
    const dialog = new Dialog({
        title: lang.edit,
        width: isMobile() ? "100vw" : "80vw",
        height: isMobile() ? "100dvh" : "78vh",
        content: `<div class="card__v2-source-editor">${blocks.length > 1 ?
            `<div class="card__v2-source-editor-blocks">${blocks.map((reference, index) =>
                `<button type="button" data-edit-block="${escapeAttr(reference.entityID)}" class="b3-button b3-button--outline" aria-pressed="false">${escapeHtml(blockLabel(reference))} ${index + 1}</button>`).join("")}</div>` : ""}
<div data-type="flashcardSourceEditor" class="card__v2-source-editor-body"></div></div>`,
        destroyCallback: () => {
            editorHolder.current?.destroy();
            if (window.siyuan.mobile?.popEditor === editorHolder.current) {
                window.siyuan.mobile.popEditor = null;
            }
            callback();
        },
        resizeCallback: () => editorHolder.current?.resize(),
    });
    const body = dialog.element.querySelector<HTMLElement>('[data-type="flashcardSourceEditor"]');
    const buttons = [...dialog.element.querySelectorAll<HTMLButtonElement>("[data-edit-block]")];
    const showBlock = (id: string) => {
        editorHolder.current?.destroy();
        body.replaceChildren();
        const editor = new Protyle(app, body, {
            blockId: id,
            action: locate ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL] : [Constants.CB_GET_ALL],
            render: {background: true, breadcrumbDocName: true, gutter: true, title: true},
            typewriterMode: false,
        });
        editorHolder.current = editor;
        if (window.siyuan.mobile) {
            window.siyuan.mobile.popEditor = editor;
        }
        dialog.editors = {source: editor};
        buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.editBlock === id)));
        editor.resize();
    };
    buttons.forEach(button => button.addEventListener("click", () => {
        if (button.getAttribute("aria-pressed") !== "true") {
            showBlock(button.dataset.editBlock);
        }
    }));
    showBlock(blockID);
};

export const openFlashcardV2ReviewSession = (app: App, reviewSetID: string, name: string,
    options: IFlashcardV2ReviewSessionOptions = {reviewMode: "normal"}, mount?: IFlashcardSessionMount,
    onTabOpened?: () => void, transfer?: IFlashcardV2SessionTransfer) => {
    if (mount?.signal.aborted) {
        return;
    }
    if (!mount && openFlashcardReviewTab(app, reviewSetID, name, options, onTabOpened)) {
        return;
    }
    const existing = !mount && window.siyuan.dialogs.find((item) =>
        item.element.getAttribute("data-key") === Constants.DIALOG_OPENCARD ||
        item.element.hasAttribute("data-flashcard-v2-review"));
    if (existing) {
        existing.destroy();
        return;
    }
    if (!mount && flashcardV2ReviewOpening) {
        return;
    }
    if (!mount) {
        flashcardV2ReviewOpening = true;
    }
    const mobile = !mount && isMobile();
    const mobileSheet = mobile ? {initiallyExpanded: true} : undefined;
    const releaseOpening = () => {
        if (!mount) {
            flashcardV2ReviewOpening = false;
        }
    };
    const sessionID = transfer?.sessionID || genUUID();
    const now = Date.now();
    const practiceLimit = options.reviewMode === "reinforcement" ? options.practiceLimit : undefined;
    let sessionStarted = false;
    const onSessionReady = () => {
        sessionStarted = true;
        const renderQueue = (queue: IFlashcardV2SessionQueueCard[]) => {
            if (!transfer) {
                emitFlashcardV2Lifecycle(app, "flashcard-review-session-started", {
                    sessionID,
                    reviewSetID,
                    reviewMode: options.reviewMode,
                    cardCount: queue.length,
                });
            }
            if (mount?.signal.aborted) {
                void finishSession(sessionID, "abandoned");
                return;
            }
            if (queue.length === 0) {
                let completionShown = false;
                void finishSession(sessionID, "completed", () => {
                    completionShown = true;
                    emitFlashcardV2Lifecycle(app, "flashcard-review-session-ended", {
                        sessionID,
                        reviewSetID,
                        reviewMode: options.reviewMode,
                        status: "completed",
                    });
                    if (mount?.signal.aborted) {
                        return;
                    }
                    const completionDialog = createSessionSurface({
                        title: mobile ? flashcardSessionTitle(name) : name,
                        mobileSheet,
                        width: "520px",
                        content: `<div class="b3-dialog__content card__empty card__empty--space card__v2-completion">${sessionCompletionContent(false, options.reviewMode)}</div>`,
                    }, mount);
                    completionDialog.element.setAttribute("data-flashcard-v2-review", "");
                    completionDialog.element.querySelector('[data-type="finish"]').addEventListener("click", () =>
                        completionDialog.destroy());
                    completionDialog.element.querySelector('[data-type="pending-edits"]').addEventListener("click", () => {
                        if (mount) {
                            openPendingEditList();
                        } else {
                            completionDialog.dispose(openPendingEditList);
                        }
                    });
                    releaseOpening();
                }).then(() => {
                    if (!completionShown) {
                        releaseOpening();
                    }
                });
                return;
            }
            // 卡片在学习和重学时会改变排期状态，分项进度沿用会话开始时的分类。
            const initialNewCardIDs = new Set(transfer?.initialNewCardIDs ?? queue
                .filter(item => item.reviewState.state === "new").map(item => item.card.id));
            const reviewProgress = (currentIndex = -1) => flashcardV2QueueBreakdown(queue, initialNewCardIDs, currentIndex);
            let index = transfer?.index || 0;
            let shownAt = performance.now();
            let revealController: IFlashcardV2RevealController | undefined;
            let typedAnswerController: IFlashcardV2TypedAnswerController | undefined;
            let choiceController: IFlashcardV2ChoiceController | undefined;
            let pluginAnswerController: IFlashcardV2PluginAnswerController | undefined;
            let answerResult: unknown;
            let sourceBlockID: string | undefined;
            let playbackController: IFlashcardV2PlaybackController | undefined;
            let currentModel: IFlashcardV2RenderModel | undefined;
            let pluginEdit: (() => Promise<void>) | undefined;
            let sessionFinished = false;
            let requestPending = false;
            let retryManagedSkip: (() => void) | undefined;
            let renderPending = true;
            let completedPending = false;
            let waitingTimer: number | undefined;
            const clearWaiting = () => {
                window.clearInterval(waitingTimer);
                waitingTimer = undefined;
            };
            let lastReview = transfer?.lastReview;
            let transferredAnswer = transfer?.answer;
            let restoringAnswer = false;
            let reveals = 0;
            const weakCards = new FlashcardV2WeakCards();
            transfer?.ratings.forEach(([id, rating]) => weakCards.record(id, rating));
            const deferredCardIDs = transfer?.deferredCardIDs || [];
            let renderGeneration = 0;
            let sessionEndEmitted = false;
            const flagDefinitions = new Map<number, string>();
            void fetchPost("/api/flashcard/listEntities", {
                entityType: "flagDefinition",
                options: {limit: 7, offset: 0},
            }, (response) => {
                response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardV2Flag)).forEach((revision) => {
                    flagDefinitions.set(revision.payload.flag, revision.payload.name);
                });
            });
            const emitSessionEnded = (status: "completed" | "abandoned") => {
                if (sessionEndEmitted) {
                    return;
                }
                sessionEndEmitted = true;
                emitFlashcardV2Lifecycle(app, "flashcard-review-session-ended", {
                    sessionID,
                    reviewSetID,
                    reviewMode: options.reviewMode,
                    status,
                });
            };
            let restoreFullscreen: (() => void) | undefined;
            const createReviewSurface = mobile ? createSessionSurface : createMovableSessionSurface;
            const dialog = createReviewSurface({
                title: mobile ? undefined : name,
                mobileSheet,
                positionId: Constants.DIALOG_OPENCARD,
                width: "min(80vw, 1024px)",
                height: "70vh",
                content: sessionContent(mobile, name),
                destroyCallback: () => {
                    restoreFullscreen?.();
                    reviewCounter?.destroy();
                    outline?.destroy();
                    clearWaiting();
                    renderGeneration++;
                    revealController?.destroy?.();
                    playbackController?.cancel();
                    if (!sessionFinished) {
                        sessionFinished = true;
                        const status = completedPending ? "completed" : "abandoned";
                        finishSession(sessionID, status, () => emitSessionEnded(status));
                    }
                },
            }, mount);
            const reviewCounter = bindFlashcardV2ReviewCounter(dialog.element, mobile,
                () => completedPending || sessionFinished ? undefined : queue[index]?.card.id);
            dialog.element.setAttribute("data-key", Constants.DIALOG_OPENCARD);
            dialog.element.setAttribute("data-flashcard-v2-review", "");
            if (mobile) {
                dialog.element.querySelector(".b3-dialog__container").setAttribute("aria-label", name);
            }
            const surface = dialog.element.querySelector(".card__v2-session");
            const fullscreen = surface.querySelector<HTMLButtonElement>('[data-type="review-fullscreen"]');
            if (fullscreen) {
                const changeFullscreen = (enabled: boolean) => {
                    setFullscreen(surface, enabled, fullscreen);
                    fullscreen.setAttribute("aria-pressed", String(enabled));
                    restoreFullscreen = enabled ? () => changeFullscreen(false) : undefined;
                };
                fullscreen.addEventListener("click", () => changeFullscreen(!surface.classList.contains("fullscreen")));
            }
            let outlineSourceOpen = false;
            const outline = bindWorkspaceReviewOutline(app, dialog.element, mobile, (blockID) => {
                if (outlineSourceOpen || sessionFinished || requestPending || renderPending ||
                    !dialog.element.isConnected || dialog.element.dataset.dialogClosing === "true") { return; }
                outlineSourceOpen = true;
                openFlashcardV2SourceEditor(app, blockID, () => {
                    outlineSourceOpen = false;
                    if (!sessionFinished && dialog.element.isConnected && dialog.element.dataset.dialogClosing !== "true") {
                        refreshCurrent();
                    }
                }, true);
            });
            releaseOpening();
            const canUseReviewActions = () => canUseFlashcardV2ReviewActions({
                renderPending,
                requestPending,
                sessionFinished,
                index,
                queueLength: queue.length,
            });
            const flagIcon = dialog.element.querySelector<SVGElement>('[data-type="flag"] svg');
            const answerInputs = () => [...dialog.element.querySelectorAll<HTMLInputElement>(
                "input[data-anki-type-answer], input[data-flashcard-type-answer], input[data-flashcard-image-answer], [data-choice-option] input")];
            const acceptRendered = (rendered: IFlashcardV2RenderedCard) => {
                playbackController?.cancel();
                shownAt = rendered.shownAt;
                revealController = rendered.revealController;
                typedAnswerController = rendered.typedAnswerController;
                choiceController = rendered.choiceController;
                pluginAnswerController = rendered.pluginAnswerController;
                sourceBlockID = rendered.sourceBlockID;
                setFlashcardLocateBlockID(dialog.element, sourceBlockID);
                outline.update(sourceBlockID);
                playbackController = rendered.playbackController;
                currentModel = rendered.model;
                queue[index].card.flag = rendered.model.card.flag ?? queue[index].card.flag;
                setFlashcardV2FlagIcon(flagIcon, queue[index].card.flag);
                pluginEdit = rendered.pluginEdit;
                answerResult = undefined;
                renderPending = false;
                setReviewActionsEnabled(dialog, true);
                emitFlashcardV2Lifecycle(app, "flashcard-review-card-shown", {
                    cardID: rendered.model.card.id,
                    sourceID: rendered.model.card.sourceID,
                    sourceType: rendered.model.source.sourceType,
                    sessionID,
                    reviewSetID,
                    reviewMode: options.reviewMode,
                    face: "front",
                });
                if (transferredAnswer) {
                    const saved = transferredAnswer;
                    transferredAnswer = undefined;
                    const inputs = answerInputs();
                    for (const [index, input] of inputs.entries()) {
                        if (saved.values[index]) {
                            input.value = saved.values[index].value;
                            input.checked = saved.values[index].checked;
                        }
                    }
                    restoringAnswer = true;
                    for (let step = 0; step < saved.reveals; step++) {
                        if (reveal()) { break; }
                    }
                    restoringAnswer = false;
                }
            };
            const renderCurrent = () => {
                reveals = 0;
                const deferred = deferredCardIDs.indexOf(queue[index].card.id);
                if (deferred >= 0) {
                    deferredCardIDs.splice(deferred, 1);
                }
                clearWaiting();
                completedPending = false;
                reviewCounter.update(reviewProgress(index));
                const generation = ++renderGeneration;
                outline.update();
                setFlashcardLocateBlockID(dialog.element);
                renderPending = true;
                revealController?.destroy?.();
                revealController = undefined;
                typedAnswerController = undefined;
                choiceController = undefined;
                pluginAnswerController = undefined;
                sourceBlockID = undefined;
                currentModel = undefined;
                pluginEdit = undefined;
                answerResult = undefined;
                renderSessionCard(dialog, queue, index, options.reviewMode === "normal",
                    () => !sessionFinished && generation === renderGeneration, acceptRendered, () => {
                        if (requestPending || sessionFinished || generation !== renderGeneration) {
                            return;
                        }
                        requestPending = true;
                        skipManagedSessionCards([queue[index].card.id], "unavailable");
                    });
            };
            const refreshCurrent = () => {
                if (!sessionFinished && index < queue.length) {
                    renderCurrent();
                }
            };
            const showCompletion = () => {
                outline.update();
                clearWaiting();
                renderGeneration++;
                setFlashcardLocateBlockID(dialog.element);
                renderPending = false;
                completedPending = true;
                revealController?.destroy?.();
                setReviewActionsEnabled(dialog, true);
                reviewCounter.update(reviewProgress());
                const contentElement = dialog.element.querySelector(".card__block");
                const frontElement = contentElement.querySelector("[data-flashcard-front]");
                dialog.element.querySelector("[data-flashcard-toolbar]").classList.add("fn__none");
                contentElement.querySelector("[data-flashcard-context]").classList.add("fn__none");
                frontElement.className = "card__empty card__empty--space card__v2-completion";
                frontElement.innerHTML = sessionCompletionContent(Boolean(lastReview), options.reviewMode,
                    weakCards.cards(queue).length);
                contentElement.querySelector("[data-flashcard-answer]").classList.add("fn__none");
                dialog.element.querySelector('[data-flashcard-action="reveal"]').classList.add("fn__none");
                dialog.element.querySelector('[data-flashcard-action="ratings"]').classList.add("fn__none");
                dialog.element.querySelector('[data-flashcard-action="finish"]').classList.add("fn__none");
            };
            const nextCard = () => {
                if (sessionFinished) {
                    return;
                }
                playbackController?.cancel();
                clearWaiting();
                requestPending = true;
                renderPending = true;
                setReviewActionsEnabled(dialog, false);
                const generation = ++renderGeneration;
                const queueNow = Date.now();
                let refreshed = false;
                void fetchPost("/api/flashcard/getSessionQueue", {
                    sessionID, now: queueNow, ...flashcardV2ReviewDay(queueNow),
                }, (response) => {
                    if (sessionFinished || generation !== renderGeneration) {
                        return;
                    }
                    refreshed = true;
                    refreshFlashcardV2Queue(queue, response.data.cards as IFlashcardV2SessionQueueCard[]);
                    requestPending = false;
                    const selection = selectFlashcardV2Queue(queue, Date.now(), deferredCardIDs);
                    index = selection.index < 0 ? queue.length : selection.index;
                    if (index < queue.length) {
                        renderCurrent();
                    } else if (selection.nextDue) {
                        showWaiting(selection.nextDue);
                    } else {
                        showCompletion();
                    }
                }).finally(() => {
                    if (!refreshed && !sessionFinished && generation === renderGeneration) {
                        requestPending = false;
                        showWaiting(0);
                    }
                });
            };
            const showWaiting = (due: number) => {
                showCompletion();
                completedPending = false;
                renderPending = true;
                index = queue.length;
                const front = dialog.element.querySelector("[data-flashcard-front]");
                front.innerHTML = `<div class="card__empty-icon">⏳</div><span data-flashcard-wait></span>
<span class="card__v2-completion-actions"><button data-type="finish" class="b3-button b3-button--text">${window.siyuan.languages.flashcardFinishSession}</button></span>`;
                if (lastReview) {
                    front.querySelector(".card__v2-completion-actions").insertAdjacentHTML("afterbegin",
                        `<button data-type="undo-review" class="b3-button b3-button--outline"><svg><use xlink:href="#iconUndo"></use></svg>${window.siyuan.languages.undo}</button>`);
                }
                const label = front.querySelector("[data-flashcard-wait]");
                const checkedAt = Date.now();
                const tick = () => {
                    const seconds = Math.max(0, Math.ceil((due - Date.now()) / 1000));
                    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
                    label.textContent = due ? window.siyuan.languages.flashcardWaitingDue.replace("${time}", time) :
                        window.siyuan.languages.loading;
                    if (!requestPending && (due && seconds === 0 || Date.now() - checkedAt >= (due ? 30000 : 3000))) {
                        nextCard();
                    }
                };
                waitingTimer = window.setInterval(tick, 1000);
                tick();
            };
            const refreshQueueAfterFailedReview = (reviewedIndex: number) => {
                if (sessionFinished || index !== reviewedIndex) {
                    requestPending = false;
                    return;
                }
                const queueNow = Date.now();
                const before = queue[reviewedIndex];
                let advanced = false;
                return fetchPost("/api/flashcard/getSessionQueue", {
                    sessionID, now: queueNow, ...flashcardV2ReviewDay(queueNow),
                }, (response) => {
                    if (sessionFinished || index !== reviewedIndex) {
                        return;
                    }
                    const refreshed = response.data.cards as IFlashcardV2SessionQueueCard[];
                    const current = refreshed.find((item) => item.card.id === before.card.id);
                    if (!current || current.sessionCard.status !== before.sessionCard.status ||
                        current.reviewState.stateRevisionID !== before.reviewState.stateRevisionID ||
                        current.card.generationStatus !== "active" || before.repeatDue && !current.repeatDue) {
                        refreshFlashcardV2Queue(queue, refreshed);
                        requestPending = false;
                        lastReview = undefined;
                        setUndoVisible(dialog, false);
                        advanced = true;
                        nextCard();
                    }
                }).finally(() => {
                    if (!advanced) {
                        requestPending = false;
                    }
                });
            };
            const reveal = () => {
                if (!canUseReviewActions()) {
                    return;
                }
                const contentElement = dialog.element.querySelector(".card__block");
                const complete = revealController?.revealNext() ?? true;
                reveals++;
                if (complete) {
                    answerResult = checkFlashcardV2Answer(() => pluginAnswerController?.check() ??
                        choiceController?.check() ?? typedAnswerController?.check() ?? revealController?.checkedAnswers,
                    () => showMessage(window.siyuan.languages.flashcardAnswerCheckFailed, 6000, "error"));
                    showFlashcardAnswer(contentElement);
                    dialog.element.querySelector("[data-flashcard-answer]").classList.remove("fn__none");
                    if (!restoringAnswer) {
                        playbackController?.activate("back");
                        emitFlashcardV2Lifecycle(app, "flashcard-review-answer-revealed", {
                            cardID: currentModel?.card.id,
                            sourceID: currentModel?.card.sourceID,
                            sourceType: currentModel?.source.sourceType,
                            sessionID,
                            reviewSetID,
                            reviewMode: options.reviewMode,
                            face: "back",
                        });
                    }
                }
                outline.reveal(complete);
                setActionsVisible(dialog, complete);
                return complete;
            };
            const updateManagedQueueCards = (data: {
                cards?: Record<string, IFlashcardV2SessionQueueCard["card"]>,
                states?: Record<string, IFlashcardV2SessionQueueCard["reviewState"]>
            }) => {
                queue.forEach((item) => {
                    if (data.cards?.[item.card.id]) {
                        item.card = data.cards[item.card.id];
                    }
                    if (data.states?.[item.card.id]) {
                        item.reviewState = data.states[item.card.id];
                    }
                });
            };
            const skipManagedSessionCards = (cardIDs: string[], reason: string) => {
                const selected = new Set(cardIDs);
                const active = queue.filter((item) => selected.has(item.card.id) &&
                    (item.sessionCard.status === "queued" || item.sessionCard.status === "shown" || item.repeatDue));
                const requests = active.map(item => ({
                    operationID: genUUID(), sessionID, cardID: item.card.id,
                    status: "skipped" as const, skipReason: reason, updatedAt: Date.now(),
                }));
                const alive = () => !sessionFinished && dialog.element.isConnected &&
                    dialog.element.dataset.dialogClosing !== "true";
                if (!alive()) { return; }
                requestPending = true;
                const recovery = dialog.element.querySelector<HTMLElement>("[data-flashcard-skip-recovery]");
                const retry = recovery.querySelector<HTMLButtonElement>('[data-type="retry-skip"]');
                const controls = Array.from(dialog.element.querySelectorAll<HTMLButtonElement>(
                    '[data-type="more"], [data-type="edit-source"], [data-type="undo-review"]'))
                    .map(button => ({button, disabled: button.disabled}));
                controls.forEach(({button}) => { button.disabled = true; });
                let position = 0;
                let inFlight = false;
                const run = async () => {
                    if (inFlight || !alive()) { return; }
                    inFlight = true;
                    retry.disabled = true;
                    recovery.classList.add("fn__none");
                    setReviewActionsEnabled(dialog, false);
                    try {
                        while (position < active.length && alive()) {
                            let updated = false;
                            await fetchPost("/api/flashcard/updateSessionCard", requests[position], () => {
                                updated = true;
                            }, undefined, undefined, undefined, 30000);
                            if (!alive()) { return; }
                            if (!updated) { return; }
                            active[position].sessionCard.status = "skipped";
                            position++;
                        }
                        if (!alive()) { return; }
                        retryManagedSkip = undefined;
                        controls.forEach(({button, disabled}) => { button.disabled = disabled; });
                        requestPending = false;
                        lastReview = undefined;
                        setUndoVisible(dialog, false);
                        nextCard();
                    } catch (error) {
                        console.error("Flashcard session skip failed", error);
                    } finally {
                        inFlight = false;
                        if (alive() && position < active.length) {
                            dialog.element.querySelector(".card__block").setAttribute("aria-busy", "false");
                            recovery.classList.remove("fn__none");
                            retry.disabled = false;
                        }
                    }
                };
                retryManagedSkip = () => { void run(); };
                retryManagedSkip();
            };
            const manageAndSkip = (cardIDs: string[], action: string, values: Record<string, unknown>,
                reason: string) => {
                if (requestPending || sessionFinished || !dialog.element.isConnected ||
                    dialog.element.dataset.dialogClosing === "true") { return; }
                requestPending = true;
                let managed = false;
                void fetchPost("/api/flashcard/manageCards", {
                    operationID: genUUID(),
                    cardIDs,
                    action,
                    changedAt: Date.now(),
                    ...values,
                }, (response) => {
                    managed = true;
                    if (sessionFinished || !dialog.element.isConnected ||
                        dialog.element.dataset.dialogClosing === "true") { return; }
                    updateManagedQueueCards(response.data);
                    skipManagedSessionCards(cardIDs, reason);
                }).catch(error => console.error("Flashcard management failed", error)).finally(() => {
                    if (!managed && !sessionFinished && dialog.element.isConnected &&
                        dialog.element.dataset.dialogClosing !== "true") {
                        requestPending = false;
                    }
                });
            };
            const manageWithoutSkipping = (cardIDs: string[], action: string, values: Record<string, unknown>) => {
                requestPending = true;
                let managed = false;
                void fetchPost("/api/flashcard/manageCards", {
                    operationID: genUUID(),
                    cardIDs,
                    action,
                    changedAt: Date.now(),
                    ...values,
                }, (response) => {
                    managed = true;
                    updateManagedQueueCards(response.data);
                    setFlashcardV2FlagIcon(flagIcon, queue[index]?.card.flag);
                    requestPending = false;
                }).catch(error => console.error("Flashcard management failed", error)).finally(() => {
                    if (!managed) {
                        requestPending = false;
                    }
                });
            };
            const currentFlagItems = (current: IFlashcardV2SessionQueueCard) =>
                flashcardV2FlagMenuItems(current.card.flag,
                    [...flagDefinitions].map(([flag, name]) => ({flag, name})), (flag) => {
                        if (canUseReviewActions() && queue[index].card.id === current.card.id) {
                            manageWithoutSkipping([current.card.id], "setFlag", {flag});
                        }
                    });
            const openCurrentFlagMenu = (button: HTMLElement) => {
                const current = queue[index];
                if (!isMobile()) {
                    hideTooltip();
                }
                toggleMenu({
                    target: button,
                    build: (_menu, session) => {
                        const menu = new Menu();
                        menu.element.classList.add("b3-menu--compact-icons");
                        currentFlagItems(current).forEach(item => menu.addItem(item));
                        if (isMobile()) {
                            session.show(() => menu.fullscreen());
                        } else {
                            const rect = button.getBoundingClientRect();
                            session.show(() => menu.open({x: rect.left, y: rect.bottom}));
                        }
                    },
                });
            };
            const queryCurrentCardTags = (targetType: "source" | "card") => {
                const current = queue[index];
                const generation = renderGeneration;
                const canOpen = () => !sessionFinished && dialog.element.isConnected &&
                    dialog.element.dataset.dialogClosing !== "true" && renderGeneration === generation &&
                    queue[index]?.card.id === current.card.id;
                fetchPost("/api/flashcard/queryCards", {
                    query: {version: 1, root: {
                        operator: "predicate", field: "cardID", comparator: "equal", value: current.card.id,
                    }},
                    options: {
                        now: Date.now(), includeInactive: true, includeSuspended: true,
                        includeBuried: true, includePaused: true, includeConflicts: true, limit: 1,
                    },
                }, (response) => {
                    const result = response.data.cards?.[0];
                    if (!result || !canOpen()) {
                        return;
                    }
                    const cardTarget = targetType === "card";
                    void import("./flashcardV2").then(({openFlashcardV2Tags}) => {
                        if (!canOpen()) {
                            return;
                        }
                        openFlashcardV2Tags(targetType, cardTarget ? current.card.id : current.card.sourceID,
                            (cardTarget ? result.cardTagIDs : result.sourceTagIDs) || [],
                            () => notifyFlashcardV2ReviewChange("flashcard-review-tags-changed"), undefined,
                            cardTarget ? result.sourceTagIDs || [] : undefined, canOpen);
                    });
                });
            };
            const openCurrentManagementMenu = (button: HTMLElement) => {
                const current = queue[index];
                toggleMenu({
                    target: button,
                    build: (_menu, session) => {
                        const menu = new Menu();
                        menu.element.classList.add("b3-menu--compact-icons");
                        const lang = window.siyuan.languages;
                        if (!dialog.mount && outline.available()) {
                            menu.addItem({
                                id: "flashcardV2WorkspaceOutline",
                                icon: "iconOutline",
                                label: lang.outline,
                                click: () => outline.toggle(),
                            });
                        }
                        menu.addItem({
                            id: "flashcardV2EditSource",
                            icon: "iconEdit",
                            label: lang.edit,
                            ...reviewActionTip(lang.edit, lang.flashcardReviewEditSourceTip),
                            click: () => (dialog.element.querySelector('[data-type="edit-source"]') as HTMLElement).click(),
                        });
                        menu.addItem({
                            id: "flashcardV2EditLater",
                            icon: "iconEdit",
                            label: lang.flashcardEditLater,
                            ...reviewActionTip(lang.flashcardEditLater, lang.flashcardEditLaterTip),
                            click: () => {
                                requestPending = true;
                                void openFlashcardV2EditLater(current.card.id, () => {
                                    lastReview = undefined;
                                    setUndoVisible(dialog, false);
                                    nextCard();
                                }, () => !sessionFinished).finally(() => { requestPending = false; });
                            },
                        });
                        menu.addItem({
                            id: "flashcardV2StudyLater",
                            label: lang.flashcardStudyLater,
                            ...reviewActionTip(lang.flashcardStudyLater, lang.flashcardStudyLaterTip),
                            click: () => (dialog.element.querySelector('[data-type="study-later"]') as HTMLElement).click(),
                        });
                        menu.addItem({
                            id: "flashcardV2Skip",
                            label: lang.skip,
                            ...reviewActionTip(lang.skip, lang.flashcardReviewSkipTip),
                            click: () => (dialog.element.querySelector('[data-type="skip"]') as HTMLElement).click(),
                        });
                        menu.addItem({
                            id: "flashcardV2PendingEdits",
                            icon: "iconEdit",
                            label: lang.flashcardPendingEdits,
                            ...reviewActionTip(lang.flashcardPendingEdits, lang.flashcardReviewPendingEditsTip),
                            click: openPendingEditList,
                        });
                        const buried = (current.reviewState.buriedUntil || 0) > Date.now();
                        const buryLabel = buried ? lang.flashcardUnbury : lang.flashcardBury;
                        menu.addItem({
                            id: "flashcardV2Bury",
                            label: buryLabel,
                            ...reviewActionTip(buryLabel, buried ? lang.flashcardReviewUnburyTip : lang.flashcardReviewBuryTip),
                            click: () => {
                                if (buried) {
                                    manageWithoutSkipping([current.card.id], "unbury", {});
                                    return;
                                }
                                manageAndSkip([current.card.id], "bury", {
                                    buriedUntil: nextLocalDay(Date.now()), reason: "user",
                                }, "userBuried");
                            },
                        });
                        menu.addItem({
                            id: "flashcardV2Suspend",
                            icon: current.reviewState.suspended ? "iconPlay" : "iconPause",
                            label: current.reviewState.suspended ? window.siyuan.languages.flashcardResumeReview :
                                window.siyuan.languages.flashcardSuspendUntilResumed,
                            click: () => current.reviewState.suspended ?
                                manageWithoutSkipping([current.card.id], "resume", {}) :
                                manageAndSkip([current.card.id], "suspend", {}, "userSuspended"),
                        });
                        menu.addItem({
                            id: "flashcardV2SuspendSource",
                            icon: "iconPause",
                            label: window.siyuan.languages.flashcardSuspendSource,
                            click: () => {
                                const isCurrent = () => !sessionFinished && dialog.element.isConnected &&
                                    queue[index]?.card.id === current.card.id;
                                if (!isCurrent() || requestPending) { return; }
                                requestPending = true;
                                let queried = false;
                                void fetchPost("/api/flashcard/queryCards", {
                                    query: {version: 1, root: {
                                        operator: "predicate", field: "sourceID", comparator: "equal",
                                        value: current.card.sourceID,
                                    }},
                                    options: {
                                        now: Date.now(), includeInactive: true, includeSuspended: true,
                                        includeBuried: true, includePaused: true, limit: 1000000,
                                    },
                                }, (response) => {
                                    queried = true;
                                    requestPending = false;
                                    if (!isCurrent()) { return; }
                                    const cardIDs = (response.data.cards as Array<{ card: { id: string } }>)
                                        .map((item) => item.card.id);
                                    if (cardIDs.length === 0) {
                                        requestPending = false;
                                        return;
                                    }
                                    confirmDialog({
                                        title: window.siyuan.languages.flashcardSuspendSource,
                                        text: `${window.siyuan.languages.flashcardSourceActionTip}<div>${window.siyuan.languages.riffCard} ${cardIDs.length}</div>`,
                                        confirm: () => {
                                            if (isCurrent() && !requestPending) {
                                                manageAndSkip(cardIDs, "suspend", {}, "sourceSuspended");
                                            }
                                        },
                                    });
                                }, undefined, undefined, undefined, 30000).then(() => {
                                    if (!queried) {
                                        requestPending = false;
                                    }
                                });
                            },
                        });
                        menu.addItem({
                            id: "flashcardV2Reset",
                            icon: "iconRefresh",
                            label: window.siyuan.languages.reset,
                            click: () => {
                                confirmDialog({
                                    title: window.siyuan.languages.reset,
                                    text: window.siyuan.languages.resetCardTip.replace("${x}", "1"),
                                    confirm: () => {
                                        if (!sessionFinished && dialog.element.isConnected && !requestPending &&
                                            queue[index]?.card.id === current.card.id) {
                                            manageAndSkip([current.card.id], "reset", {}, "userReset");
                                        }
                                    },
                                });
                            },
                        });
                        menu.addItem({
                            id: "flashcardV2SetDue",
                            icon: "iconCalendar",
                            label: window.siyuan.languages.setDueTime,
                            click: () => openFlashcardV2Due([current.card.id], current.reviewState.due,
                                () => {
                                    if (sessionFinished) {
                                        return;
                                    }
                                    requestPending = true;
                                    skipManagedSessionCards([current.card.id], "dueChanged");
                                }),
                        });
                        menu.addItem({
                            id: "flashcardV2SetFlag",
                            icon: "iconFlag",
                            label: window.siyuan.languages.flashcardFlag,
                            submenu: currentFlagItems(current),
                        });
                        menu.addItem({
                            id: "flashcardV2CardTags",
                            icon: "iconTag",
                            label: window.siyuan.languages.flashcardCurrentCardTags,
                            click: () => queryCurrentCardTags("card"),
                        });
                        menu.addItem({
                            id: "flashcardV2SourceTags",
                            icon: "iconTag",
                            label: window.siyuan.languages.flashcardSourceTags,
                            click: () => queryCurrentCardTags("source"),
                        });
                        if (isMobile()) {
                            session.show(() => menu.fullscreen());
                        } else {
                            const rect = button.getBoundingClientRect();
                            session.show(() => menu.open({x: rect.left, y: rect.bottom}));
                        }
                    },
                });
            };
            const handleReviewShortcut = (shortcut: string) => {
                const action = getFlashcardV2ReviewShortcutAction(shortcut);
                if (action === "revealOrGood") {
                    if (completedPending) {
                        (dialog.element.querySelector('.card__v2-completion [data-type="finish"]') as HTMLElement)
                            ?.click();
                        return true;
                    }
                    const finish = dialog.element.querySelector('[data-flashcard-action="finish"]');
                    if (!finish.classList.contains("fn__none")) {
                        (finish.querySelector('[data-type="finish"]') as HTMLElement)?.click();
                        return true;
                    }
                    const ratings = dialog.element.querySelector('[data-flashcard-action="ratings"]');
                    if (ratings.classList.contains("fn__none")) {
                        reveal();
                    } else {
                        (ratings.querySelector('[data-rating="good"]') as HTMLElement)?.click();
                    }
                    return true;
                }
                if (action && ["again", "hard", "good", "easy"].includes(action)) {
                    const ratings = dialog.element.querySelector('[data-flashcard-action="ratings"]');
                    if (!ratings.classList.contains("fn__none") && canUseReviewActions()) {
                        (ratings.querySelector(`[data-rating="${action}"]`) as HTMLElement)?.click();
                    }
                    return true;
                }
                if (action === "skip") {
                    (dialog.element.querySelector('[data-type="skip"]') as HTMLElement)?.click();
                    return true;
                }
                if (action === "undo") {
                    if (lastReview) {
                        (dialog.element.querySelector('[data-type="undo-review"]') as HTMLElement)?.click();
                    }
                    return true;
                }
                return false;
            };
            dialog.element.firstElementChild.addEventListener("click", (event: MouseEvent) => {
                if (typeof event.detail === "string") {
                    handleReviewShortcut(event.detail);
                }
            });
            let movingReview = false;
            dialog.element.addEventListener("click", (event) => {
                const target = event.target as HTMLElement;
                const placement = target.closest<HTMLElement>('[data-type="review-placement"]');
                if (placement && dialog.move && !movingReview) {
                    toggleMenu({target: placement, build: (_menu, popup) => {
                        const menu = new Menu();
                        const lang = window.siyuan.languages;
                        const targets = [
                            {mode: "dialog", icon: "iconOpen", label: lang.flashcardOpenDialog},
                            {mode: "tab", icon: "iconOpen", label: lang.openInNewTab},
                            {mode: "right", icon: "iconLayoutRight", label: lang.insertRight},
                            {mode: "bottom", icon: "iconLayoutBottom", label: lang.insertBottom},
                            ...(!isBrowser() ? [{mode: "window", icon: "iconOpenWindow", label: lang.openByNewWindow} as const] : []),
                        ] as const;
                        for (const {mode, icon, label} of targets) {
                            menu.addItem({icon, label, disabled: mode === "dialog" && !dialog.mount,
                                click: () => {
                                    if (movingReview || sessionFinished || requestPending || outlineSourceOpen) { return; }
                                    restoreFullscreen?.();
                                    if (mode === "dialog") {
                                        dialog.move();
                                        return;
                                    }
                                    if (mode === "window") {
                                        if (renderPending || completedPending || retryManagedSkip || !queue[index]) { return; }
                                        requestPending = true;
                                        const state: IFlashcardV2SessionTransfer = {
                                            sessionID, queue, index, lastReview, deferredCardIDs, ratings: weakCards.snapshot(),
                                            initialNewCardIDs: [...initialNewCardIDs],
                                            answer: currentModel?.source.pluginNamespace ? undefined : {
                                                reveals, values: answerInputs().map(({value, checked}) => ({value, checked})),
                                            },
                                        };
                                        void moveFlashcardReviewToWindow(reviewSetID, name, options, state, () => {
                                            if (sessionFinished || !dialog.element.isConnected) { return; }
                                            sessionFinished = true;
                                            return dialog.destroy;
                                        }).then(moved => {
                                            if (!moved && dialog.element.isConnected) { showMessage(lang.flashcardLoadFailed); }
                                        }).catch(error => {
                                            console.error("Flashcard review window relocation failed", error);
                                            if (dialog.element.isConnected) { showMessage(lang.flashcardLoadFailed); }
                                        }).finally(() => { requestPending = false; });
                                        return;
                                    }
                                    movingReview = true;
                                    void moveFlashcardReviewToTab(app, reviewSetID, name, options, mode, dialog.move, dialog.mount)
                                        .catch(error => console.error("Flashcard review relocation failed", error))
                                        .finally(() => { movingReview = false; });
                                },
                            });
                        }
                        const rect = placement.getBoundingClientRect();
                        popup.show(() => menu.open({x: rect.left, y: rect.bottom, h: rect.height}));
                    }});
                    return;
                }
                if (target.closest('[data-type="retry-skip"]')) {
                    retryManagedSkip?.();
                    return;
                }
                if (target.closest('[data-type="pending-edits"]')) {
                    if (dialog.mount) {
                        openPendingEditList();
                    } else {
                        dialog.dispose(openPendingEditList);
                    }
                    return;
                }
                const ratingElement = target.closest("[data-rating]") as HTMLElement;
                const ratingsElement = dialog.element.querySelector('[data-flashcard-action="ratings"]');
                if (ratingElement && !ratingsElement.classList.contains("fn__none") && canUseReviewActions()) {
                    requestPending = true;
                    const reviewedAt = Date.now();
                    const reviewedIndex = index;
                    const submittedAnswerResult = snapshotFlashcardV2AnswerResult(answerResult);
                    emitFlashcardV2Lifecycle(app, "flashcard-review-rating-submitted", {
                        cardID: currentModel?.card.id,
                        sourceID: currentModel?.card.sourceID,
                        sourceType: currentModel?.source.sourceType,
                        sessionID,
                        reviewSetID,
                        reviewMode: options.reviewMode,
                        rating: ratingElement.dataset.rating,
                        answerResult: snapshotFlashcardV2AnswerResult(submittedAnswerResult),
                    });
                    let reviewed = false;
                    void fetchPost("/api/flashcard/reviewCard", {
                        operationID: genUUID(),
                        cardID: queue[index].card.id,
                        stateRevisionID: queue[index].reviewState.stateRevisionID,
                        rating: ratingElement.dataset.rating,
                        reviewedAt,
                        ...flashcardV2ReviewDay(reviewedAt),
                        durationMS: Math.max(0, Math.round(performance.now() - shownAt)),
                        sessionID,
                        reviewSetID,
                        reviewMode: options.reviewMode,
                        buryUntil: nextLocalDay(reviewedAt),
                        answerResult: submittedAnswerResult,
                    }, (response) => {
                        reviewed = true;
                        if (sessionFinished) {
                            notifyFlashcardV2ReviewChange("flashcard-review-rating-completed");
                            return;
                        }
                        const result = response.data as IFlashcardV2ReviewResult;
                        queue[reviewedIndex].sessionCard.status = "reviewed";
                        (result.skippedSessionCardIDs || []).forEach((cardID) => {
                            const item = queue.find((candidate) => candidate.card.id === cardID);
                            if (item) {
                                item.sessionCard.status = "skipped";
                            }
                        });
                        lastReview = {
                            cardID: queue[reviewedIndex].card.id,
                            sourceID: currentModel?.card.sourceID || queue[reviewedIndex].card.sourceID,
                            sourceType: currentModel?.source.sourceType || "",
                            eventID: result.event.eventID,
                            index: reviewedIndex,
                            skippedSessionCardIDs: result.skippedSessionCardIDs || [],
                            previousRating: weakCards.record(queue[reviewedIndex].card.id, ratingElement.dataset.rating),
                        };
                        setUndoVisible(dialog, true);
                        requestPending = false;
                        emitFlashcardV2Lifecycle(app, "flashcard-review-rating-completed", {
                            cardID: currentModel?.card.id,
                            sourceID: currentModel?.card.sourceID,
                            sourceType: currentModel?.source.sourceType,
                            sessionID,
                            reviewSetID,
                            reviewMode: options.reviewMode,
                            rating: ratingElement.dataset.rating,
                            eventID: result.event.eventID,
                            beforeState: result.beforeState,
                            afterState: result.afterState,
                            buriedSiblingIDs: result.buriedSiblingIDs,
                            skippedSessionCardIDs: result.skippedSessionCardIDs,
                            leechTagged: result.leechTagged,
                            presetRevisionID: result.presetRevisionID,
                            schedulerVersion: result.schedulerVersion,
                        });
                        if (result.leechTagged || (!result.beforeState.suspended && result.afterState?.suspended)) {
                            showMessage(window.siyuan.languages.flashcardLeeches, 6000, "warning");
                        }
                        if (result.buriedSiblingIDs?.length) {
                            showMessage(window.siyuan.languages.flashcardReviewSiblingsBuried
                                .replace("${count}", String(result.buriedSiblingIDs.length)));
                        }
                        nextCard();
                    }).then(() => {
                        if (!reviewed) {
                            return refreshQueueAfterFailedReview(reviewedIndex);
                        }
                    });
                    return;
                }
                if (target.closest('[data-type="undo-review"]') && lastReview && !requestPending) {
                    requestPending = true;
                    const undoing = lastReview;
                    let undone = false;
                    void fetchPost("/api/flashcard/undoReview", {
                        operationID: genUUID(),
                        reviewEventID: undoing.eventID,
                        cardID: undoing.cardID,
                        undoneAt: Date.now(),
                    }, (response) => {
                        undone = true;
                        if (sessionFinished) {
                            notifyFlashcardV2ReviewChange("flashcard-review-undone");
                            return;
                        }
                        queue[undoing.index].sessionCard = response.data.sessionCard ||
                            {...queue[undoing.index].sessionCard, status: "queued"};
                        if (response.data.restoredState) {
                            queue[undoing.index].reviewState = response.data.restoredState;
                        }
                        queue[undoing.index].repeatDue = queue[undoing.index].sessionCard.status === "reviewed" ?
                            queue[undoing.index].reviewState.due : undefined;
                        undoing.skippedSessionCardIDs.forEach((cardID) => {
                            const item = queue.find((candidate) => candidate.card.id === cardID);
                            if (item) {
                                item.sessionCard.status = "queued";
                            }
                        });
                        index = undoing.index;
                        weakCards.restore(undoing.cardID, undoing.previousRating);
                        completedPending = false;
                        lastReview = undefined;
                        setUndoVisible(dialog, false);
                        requestPending = false;
                        emitFlashcardV2Lifecycle(app, "flashcard-review-undone", {
                            cardID: undoing.cardID,
                            sourceID: undoing.sourceID,
                            sourceType: undoing.sourceType,
                            sessionID,
                            reviewSetID,
                            reviewMode: options.reviewMode,
                            reviewEventID: undoing.eventID,
                            eventID: response.data.event?.eventID,
                            restoredState: response.data.restoredState,
                            restoredSiblingIDs: response.data.restoredSiblingIDs,
                            restoredSessionCardIDs: response.data.restoredSessionCardIDs,
                            leechTagRemoved: response.data.leechTagRemoved,
                        });
                        renderCurrent();
                    }).then(() => {
                        if (!undone) {
                            requestPending = false;
                        }
                    });
                    return;
                }
                const practiceWeak = Boolean(target.closest('[data-type="practice-weak"]'));
                if ((target.closest('[data-type="finish"]') || practiceWeak && completedPending) && !requestPending) {
                    const practiceIDs = practiceWeak ? weakCards.cards(queue) : [];
                    if (practiceWeak && practiceIDs.length === 0) {
                        return;
                    }
                    requestPending = true;
                    let finished = false;
                    void finishSession(sessionID, "completed", () => {
                        finished = true;
                        if (!sessionFinished) {
                            sessionFinished = true;
                            emitSessionEnded("completed");
                            if (practiceWeak) {
                                const currentMount = dialog.mount;
                                dialog.dispose(() => openFlashcardV2ReviewSession(app, "", name, {
                                    ...flashcardV2SubsetOptions("", undefined, practiceIDs, "reinforcement"),
                                    includeSuspended: options.includeSuspended,
                                    includeBuried: options.includeBuried,
                                    includePaused: options.includePaused,
                                }, currentMount));
                            } else {
                                dialog.destroy();
                            }
                        }
                    }).then(() => {
                        if (!finished && !sessionFinished) {
                            requestPending = false;
                        }
                    });
                    return;
                }
                if (target.closest('[data-type="read-aloud"]')) {
                    const ratings = dialog.element.querySelector('[data-flashcard-action="ratings"]');
                    playbackController?.speak(ratings.classList.contains("fn__none") ? "front" : "back");
                    return;
                }
                const more = target.closest('[data-type="more"]') as HTMLElement;
                if (more && !requestPending && index < queue.length) {
                    openCurrentManagementMenu(more);
                    return;
                }
                const flag = target.closest<HTMLElement>('[data-type="flag"]');
                if (flag && canUseReviewActions()) {
                    openCurrentFlagMenu(flag);
                    return;
                }
                if (target.closest('[data-type="edit-source"]') && sourceBlockID && !requestPending) {
                    if (pluginEdit) {
                        requestPending = true;
                        void pluginEdit().then(() => {
                            requestPending = false;
                            refreshCurrent();
                        }).catch((error) => {
                            console.error(`Flashcard plugin editor [${currentModel?.source.sourceType}] failed`, error);
                            requestPending = false;
                        });
                        return;
                    }
                    openFlashcardV2SourceEditor(app, sourceBlockID, () => {
                        refreshCurrent();
                    }, false, currentModel?.references);
                    return;
                }
                if (target.closest('[data-type="show"]')) {
                    reveal();
                    return;
                }
                if (target.closest('[data-type="study-later"]') && canUseReviewActions()) {
                    if (deferFlashcardV2QueueCard(queue, index, Date.now(), deferredCardIDs)) {
                        nextCard();
                    } else {
                        showMessage(window.siyuan.languages.flashcardStudyLaterUnavailable);
                    }
                    return;
                }
                if (target.closest('[data-type="skip"]') && canUseReviewActions()) {
                    requestPending = true;
                    let skipped = false;
                    void fetchPost("/api/flashcard/updateSessionCard", {
                        operationID: genUUID(),
                        sessionID,
                        cardID: queue[index].card.id,
                        status: "skipped",
                        skipReason: "user",
                        updatedAt: Date.now(),
                    }, () => {
                        skipped = true;
                        queue[index].sessionCard.status = "skipped";
                        lastReview = undefined;
                        setUndoVisible(dialog, false);
                        requestPending = false;
                        nextCard();
                    }).catch(error => console.error("Flashcard skip failed", error)).finally(() => {
                        if (!skipped) {
                            requestPending = false;
                        }
                    });
                }
            });
            dialog.element.addEventListener("keydown", (event: KeyboardEvent) => {
                if (matchHotKey(window.siyuan.config.keymap.general.outline, event)) {
                    if (!event.repeat && outline.available()) {
                        outline.toggle();
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                if (!getFlashcardV2ReviewShortcutAction(event.key, event)) {
                    return;
                }
                if (event.repeat || requestPending) {
                    return;
                }
                const eventTarget = event.target as HTMLElement;
                if ((event.key === "Enter" || event.key === " ") && eventTarget.closest("[data-flashcard-explanation-link]")) {
                    return;
                }
                const editing = Boolean(eventTarget.closest("input,textarea,select,[contenteditable=true]"));
                if (editing) {
                    if (event.key === "Enter" &&
                        eventTarget.matches("[data-anki-type-answer], [data-flashcard-type-answer], [data-flashcard-image-answer]")) {
                        reveal();
                        event.preventDefault();
                        event.stopPropagation();
                    }
                    return;
                }
                if (handleReviewShortcut(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
            dialog.element.setAttribute("tabindex", "-1");
            dialog.element.focus();
            setUndoVisible(dialog, !!lastReview);
            renderCurrent();
        };
        if (transfer) {
            renderQueue(transfer.queue);
            return;
        }
        if (mount?.signal.aborted) {
            void finishSession(sessionID, "abandoned");
            return;
        }
        let queueLoaded = false;
        const queueNow = Date.now();
        void fetchPost("/api/flashcard/getSessionQueue", {
            sessionID, now: queueNow, ...flashcardV2ReviewDay(queueNow),
        }, (response) => {
            queueLoaded = true;
            renderQueue((response.data.cards as IFlashcardV2SessionQueueCard[])
                .filter(item => item.card.generationStatus === "active" &&
                    (item.sessionCard.status === "queued" || item.sessionCard.status === "shown")));
        }).then(() => {
            if (!queueLoaded) {
                releaseOpening();
                void finishSession(sessionID, "abandoned");
            }
        });
    };
    if (transfer) {
        onSessionReady();
        return;
    }
    void fetchPost("/api/flashcard/startSession", {
        operationID: genUUID(),
        sessionID,
        reviewSetID,
        reviewSetIDs: options.reviewSetIDs,
        cardIDs: options.cardIDs,
        query: options.query,
        reviewMode: options.reviewMode,
        seed: sessionID,
        now,
        ...flashcardV2ReviewDay(now),
        newLimit: practiceLimit ?? window.siyuan.config.flashcard.newCardLimit,
        reviewLimit: practiceLimit ?? window.siyuan.config.flashcard.reviewCardLimit,
        includeSuspended: options.reviewMode === "reinforcement" && Boolean(options.includeSuspended),
        includeBuried: options.reviewMode === "reinforcement" && Boolean(options.includeBuried),
        includePaused: options.reviewMode === "reinforcement" && Boolean(options.includePaused),
    }, onSessionReady).then(() => {
        if (!sessionStarted) {
            releaseOpening();
        }
    });
};
