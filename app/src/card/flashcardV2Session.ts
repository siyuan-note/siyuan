import {Dialog} from "../dialog";
import {showMessage} from "../dialog/message";
import {Menu} from "../plugin/Menu";
import {Constants} from "../constants";
import type {App} from "../index";
import {Protyle} from "../protyle";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
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
    prepareFlashcardV2Choice,
    prepareFlashcardV2Reveal,
    prepareFlashcardV2TypedAnswers,
    renderFlashcardV2Choice,
    renderFlashcardV2MultiLine,
    renderFlashcardV2AnkiTemplate
} from "./flashcardV2Render";
import {
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

interface IFlashcardV2SessionQueueCard {
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
    };
    reviewState: {
        due: number;
        suspended: boolean;
        buriedUntil?: number;
    };
}

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
    query?: IFlashcardQueryAST;
    includeSuspended?: boolean;
    includeBuried?: boolean;
    includePaused?: boolean;
}

const flashcardV2FlagColors = ["", "#d14343", "#d97706", "#2f9e44", "#3b82f6", "#8b5cf6", "#0891b2", "#db2777"];
let flashcardV2ReviewOpening = false;

const nextLocalDay = (now: number) => {
    const date = new Date(now);
    date.setHours(24, 0, 0, 0);
    return date.getTime();
};

const selectReferences = (references: IFlashcardV2SourceReference[], spec?: IFlashcardV2RenderModel["template"]["frontSpec"]) => {
    if (!spec) {
        return [];
    }
    const fieldIDs = new Set(spec.fieldIDs || []);
    if (spec.fieldID) {
        fieldIDs.add(spec.fieldID);
    }
    const roles = new Set(spec.roles || []);
    if (spec.role) {
        roles.add(spec.role);
    }
    if (fieldIDs.size === 0 && roles.size === 0) {
        return [];
    }
    return references.filter((reference) => fieldIDs.has(reference.fieldID) || roles.has(reference.role));
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
                sourceElement.getAttribute("data-type"), sourceElement.getAttribute("fold"))) {
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
    return (element.textContent || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
};

const renderFlashcardV2Context = (model: IFlashcardV2RenderModel, sourceBlockID: string,
    sensitiveReferences: IFlashcardV2SourceReference[], sensitiveTextValues: string[],
    doms: Record<string, string>, element: HTMLElement, isCurrent: () => boolean) => {
    const policy = model.template.contextPolicy;
    element.classList.add("fn__none");
    element.innerHTML = "";
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
            if (item.id === sourceBlockID || !item.name?.trim() || !policy.breadcrumb && index !== 0 ||
                !policy.documentTitle && index === 0 && allPaths.length > 1) {
                return false;
            }
            const name = item.name.replace(/\s+/g, " ").trim().toLocaleLowerCase();
            return name.length < 3 || !sensitiveTexts.some((answer) => answer === name || answer.includes(name));
        });
        if (paths.length > 0) {
            element.insertAdjacentHTML("beforeend", `<div class="card__v2-context-path">${paths.map((item) =>
                `<span data-node-id="${escapeAttr(item.id)}">${escapeHtml(item.name || "")}</span>`)
                .join('<span class="fn__space"></span>/<span class="fn__space"></span>')}</div>`);
            showContext();
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
                    void media.play().catch(() => undefined);
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

const setActionsVisible = (dialog: Dialog, revealed: boolean) => {
    dialog.element.querySelector('[data-flashcard-action="reveal"]').classList.toggle("fn__none", revealed);
    dialog.element.querySelector('[data-flashcard-action="ratings"]').classList.toggle("fn__none", !revealed);
    dialog.element.querySelector('[data-flashcard-action="finish"]').classList.add("fn__none");
};

const setReviewActionsEnabled = (dialog: Dialog, enabled: boolean) => {
    const contentElement = dialog.element.querySelector(".card__block");
    contentElement?.setAttribute("aria-busy", enabled ? "false" : "true");
    dialog.element.querySelectorAll<HTMLButtonElement>("[data-type=show], [data-rating]").forEach((button) => {
        button.disabled = !enabled;
    });
};

const setUndoVisible = (dialog: Dialog, visible: boolean) => {
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
    app.plugins.forEach((plugin) => plugin.eventBus.emit(type, detail));
};

interface IFlashcardV2SessionTag {
    id: string;
    parentID?: string;
    name: string;
}

const flashcardV2SessionTagPath = (tag: IFlashcardV2SessionTag, tags: Map<string, IFlashcardV2SessionTag>) => {
    const names = [tag.name];
    const seen = new Set([tag.id]);
    let parentID = tag.parentID;
    while (parentID && !seen.has(parentID)) {
        seen.add(parentID);
        const parent = tags.get(parentID);
        if (!parent) {
            break;
        }
        names.unshift(parent.name);
        parentID = parent.parentID;
    }
    return names.join(" / ");
};

const openFlashcardV2SessionTags = (targetType: "source" | "card", targetID: string,
    selectedTagIDs: string[]) => {
    fetchPost("/api/flashcard/listEntities", {
        entityType: "tag",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const tags = (response.data.entities as Array<{ payload: IFlashcardV2SessionTag }>)
            .map((revision) => revision.payload);
        const selected = new Set(selectedTagIDs);
        const byID = new Map(tags.map((tag) => [tag.id, tag]));
        const choices = [...tags]
            .sort((left, right) => flashcardV2SessionTagPath(left, byID)
                .localeCompare(flashcardV2SessionTagPath(right, byID)))
            .map((tag) => `<label class="b3-list-item b3-list-item--narrow">
<span class="b3-list-item__text">${escapeHtml(flashcardV2SessionTagPath(tag, byID))}</span>
<input class="b3-switch" type="checkbox" value="${escapeAttr(tag.id)}"${selected.has(tag.id) ? " checked" : ""}>
</label>`).join("");
        const tagDialog = new Dialog({
            title: window.siyuan.languages.tag,
            width: isMobile() ? "92vw" : "520px",
            height: "70vh",
            content: `<div class="b3-dialog__content card__v2-panel"><div class="b3-list b3-list--background fn__flex-1 card__v2-panel-list">${choices || `<div class="card__empty">${window.siyuan.languages.emptyContent}</div>`}</div></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        });
        const buttons = tagDialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => tagDialog.destroy());
        buttons[1].addEventListener("click", () => {
            const tagIDs = [...tagDialog.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')]
                .map((input) => input.value).sort();
            fetchPost("/api/flashcard/setTagAssignments", {
                operationID: genUUID(),
                targetType,
                targetIDs: [targetID],
                tagIDs,
                changedAt: Date.now(),
            }, () => tagDialog.destroy());
        });
    });
};

const openFlashcardV2SessionDue = (cardID: string, due: number, callback: () => void) => {
    const date = new Date(due || Date.now());
    const value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const dueDialog = new Dialog({
        title: window.siyuan.languages.setDueTime,
        width: isMobile() ? "92vw" : "420px",
        content: `<div class="b3-dialog__content card__v2-form"><input class="b3-text-field fn__block" type="datetime-local" value="${value}"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
    });
    const input = dueDialog.element.querySelector("input") as HTMLInputElement;
    const buttons = dueDialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
    buttons[0].addEventListener("click", () => dueDialog.destroy());
    buttons[1].addEventListener("click", () => {
        const nextDue = new Date(input.value).getTime();
        if (!Number.isFinite(nextDue)) {
            input.focus();
            return;
        }
        fetchPost("/api/flashcard/manageCards", {
            operationID: genUUID(),
            cardIDs: [cardID],
            action: "setDue",
            changedAt: Date.now(),
            due: nextDue,
        }, () => {
            dueDialog.destroy();
            callback();
        });
    });
    input.focus();
};

const sessionCompletionContent = (canUndo: boolean) => `<div class="card__empty-icon">🔮</div>
<span>${window.siyuan.languages.noDueCard}</span>
<span class="card__v2-completion-actions">
    ${canUndo ? `<button data-type="undo-review" class="b3-button b3-button--outline"><svg><use xlink:href="#iconUndo"></use></svg>${window.siyuan.languages.undo}</button>` : ""}
    <button data-type="finish" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</span>`;

const sessionContent = () => `<div class="b3-dialog__content fn__flex-column card__v2-session">
<div data-flashcard-toolbar class="fn__flex card__v2-session-toolbar">
    <span data-flashcard-count class="ft__on-surface"></span>
    <span class="fn__flex-1"></span>
    <button data-type="read-aloud" class="block__icon ariaLabel${typeof window.speechSynthesis === "undefined" ? " fn__none" : ""}" aria-label="${window.siyuan.languages.flashcardReadAloud}"><svg><use xlink:href="#iconPlay"></use></svg></button>
    <button data-type="edit-source" class="block__icon ariaLabel" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></button>
    <button data-type="more" class="block__icon ariaLabel" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></button>
    <button data-type="undo-review" class="block__icon ariaLabel fn__none" aria-label="${window.siyuan.languages.undo}"><svg><use xlink:href="#iconUndo"></use></svg></button>
</div>
<div class="card__block fn__flex-1 card__v2-session-content" aria-busy="true">
    <div data-flashcard-context class="card__v2-context ft__secondary fn__none"></div>
    <div class="protyle-wysiwyg" contenteditable="false" data-flashcard-front></div>
    <div class="fn__none" data-flashcard-answer><div class="fn__hr"></div><div class="protyle-wysiwyg" contenteditable="false"></div></div>
</div>
<div data-flashcard-action="reveal" class="fn__flex card__action card__v2-session-actions">
    <button data-type="show" class="b3-button b3-button--text" disabled><div class="card__icon">👀</div>${window.siyuan.languages.cardShowAnswer}</button>
    <span class="fn__space"></span>
    <button data-type="skip" class="b3-button b3-button--cancel"><div class="card__icon">💤</div>${window.siyuan.languages.skip}</button>
</div>
<div data-flashcard-action="ratings" class="fn__flex card__action card__v2-session-actions fn__none">
    <button data-rating="again" class="b3-button b3-button--error" disabled><div class="card__icon">🙈</div>${window.siyuan.languages.cardRatingAgain}</button>
    <span class="fn__space"></span>
    <button data-rating="hard" class="b3-button b3-button--warning" disabled><div class="card__icon">😬</div>${window.siyuan.languages.cardRatingHard}</button>
    <span class="fn__space"></span>
    <button data-rating="good" class="b3-button b3-button--info" disabled><div class="card__icon">😊</div>${window.siyuan.languages.cardRatingGood}</button>
    <span class="fn__space"></span>
    <button data-rating="easy" class="b3-button b3-button--success" disabled><div class="card__icon">🌈</div>${window.siyuan.languages.cardRatingEasy}</button>
</div>
<div data-flashcard-action="finish" class="fn__flex card__action card__v2-session-actions fn__none">
    <button data-type="finish" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>
</div>`;

const renderSessionCard = (dialog: Dialog, queue: IFlashcardV2SessionQueueCard[], index: number,
    isCurrent: () => boolean, callback: (rendered: IFlashcardV2RenderedCard) => void,
    unavailable: () => void) => {
    const current = queue[index];
    const contentElement = dialog.element.querySelector(".card__block") as HTMLElement;
    const contextElement = dialog.element.querySelector("[data-flashcard-context]") as HTMLElement;
    const frontElement = dialog.element.querySelector("[data-flashcard-front]") as HTMLElement;
    const answerElement = dialog.element.querySelector("[data-flashcard-answer]") as HTMLElement;
    dialog.element.querySelector("[data-flashcard-template-style]")?.remove();
    dialog.element.querySelector("[data-flashcard-toolbar]").classList.remove("fn__none");
    contextElement.classList.add("fn__none");
    contextElement.innerHTML = "";
    frontElement.className = "protyle-wysiwyg";
    frontElement.innerHTML = "";
    answerElement.classList.add("fn__none");
    (answerElement.querySelector(".protyle-wysiwyg") as HTMLElement).innerHTML = "";
    contentElement.className = "card__block fn__flex-1 card__v2-session-content";
    dialog.element.querySelector("[data-flashcard-count]").textContent = `${index + 1} / ${queue.length}`;
    setActionsVisible(dialog, false);
    setReviewActionsEnabled(dialog, false);
    let modelLoaded = false;
    void fetchPost("/api/flashcard/getRenderModel", {cardID: current.card.id}, (modelResponse) => {
        if (!isCurrent()) {
            return;
        }
        const model = modelResponse.data as IFlashcardV2RenderModel;
        const templateStyle = createFlashcardV2TemplateStyle(model.template.style || "", contentElement);
        if (templateStyle) {
            dialog.element.appendChild(templateStyle);
        }
        const dynamicReferences: IFlashcardV2SourceReference[] = (current.sessionCard.dynamicOptions || [])
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
        modelLoaded = true;
        void loadFlashcardV2DOMs(model, references, (doms) => {
            if (!isCurrent()) {
                return;
            }
            let frontReferences = selectReferences(references, model.template.frontSpec);
            if (frontReferences.length === 0) {
                frontReferences = references.slice(0, 1);
            }
            let backReferences = selectReferences(references, model.template.backSpec);
            if (backReferences.length === 0) {
                backReferences = references;
            }
            const frontIDs = new Set(frontReferences.map((reference) => reference.entityID));
            const answerReferences = backReferences.filter((reference) => !frontIDs.has(reference.entityID));
            const ankiFront = renderFlashcardV2AnkiTemplate(model, "front", doms);
            const ankiBack = ankiFront === undefined ? undefined :
                renderFlashcardV2AnkiTemplate(model, "back", doms, ankiFront);
            const specialFront = renderFlashcardV2Choice(model, doms, current.sessionCard.optionOrder || []) ??
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
                    '<input class="b3-text-field fn__block" data-flashcard-type-answer autocomplete="off">');
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
            const revealController = pluginResult?.revealController || prepareFlashcardV2Reveal(frontElement, model);
            const typedAnswerController = prepareFlashcardV2TypedAnswers(frontElement, model, doms);
            const choiceController = prepareFlashcardV2Choice(frontElement, model);
            const playbackController = prepareFlashcardV2Playback(model, frontElement, answerElement,
                specialFront !== undefined);
            const hasInternalAnswer = hasFlashcardAnswer(frontElement, window.siyuan.config.flashcard);
            if (hasInternalAnswer) {
                hideFlashcardAnswer(contentElement, window.siyuan.config.flashcard);
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
            renderFlashcardV2Context(model, sourceBlockID, sensitiveReferences, sensitiveTextValues, doms,
                contextElement, isCurrent);
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
            playbackController.activate("front");
            (frontElement.querySelector("[data-anki-type-answer], [data-flashcard-type-answer]") as
                HTMLInputElement)?.focus();
        }).then(() => {
            if (!blocksLoaded && isCurrent()) {
                unavailable();
            }
        });
    }).then(() => {
        if (!modelLoaded && isCurrent()) {
            unavailable();
        }
    });
};

const openFlashcardV2SourceEditor = (app: App, blockID: string, callback: () => void) => {
    const editorHolder: { current?: Protyle } = {};
    const dialog = new Dialog({
        title: window.siyuan.languages.edit,
        width: isMobile() ? "100vw" : "80vw",
        height: isMobile() ? "100dvh" : "78vh",
        content: '<div data-type="flashcardSourceEditor" style="height:100%"></div>',
        destroyCallback: () => {
            editorHolder.current?.destroy();
            if (window.siyuan.mobile?.popEditor === editorHolder.current) {
                window.siyuan.mobile.popEditor = null;
            }
            callback();
        },
        resizeCallback: () => editorHolder.current?.resize(),
    });
    const editor = new Protyle(app, dialog.element.querySelector('[data-type="flashcardSourceEditor"]'), {
        blockId: blockID,
        action: [Constants.CB_GET_ALL],
        render: {
            background: true,
            breadcrumbDocName: true,
            gutter: true,
            title: true,
        },
        typewriterMode: false,
    });
    editorHolder.current = editor;
    if (window.siyuan.mobile) {
        window.siyuan.mobile.popEditor = editor;
    }
    dialog.editors = {source: editor};
    editor.resize();
};

export const openFlashcardV2ReviewSession = (app: App, reviewSetID: string, name: string,
    options: IFlashcardV2ReviewSessionOptions = {reviewMode: "normal"}) => {
    const existing = window.siyuan.dialogs.find((item) =>
        item.element.getAttribute("data-key") === Constants.DIALOG_OPENCARD ||
        item.element.hasAttribute("data-flashcard-v2-review"));
    if (existing) {
        existing.destroy();
        return;
    }
    if (flashcardV2ReviewOpening) {
        return;
    }
    flashcardV2ReviewOpening = true;
    const sessionID = genUUID();
    let sessionStarted = false;
    void fetchPost("/api/flashcard/startSession", {
        operationID: genUUID(),
        sessionID,
        reviewSetID,
        query: options.query,
        reviewMode: options.reviewMode,
        seed: sessionID,
        now: Date.now(),
        newLimit: window.siyuan.config.flashcard.newCardLimit,
        reviewLimit: window.siyuan.config.flashcard.reviewCardLimit,
        includeSuspended: options.reviewMode === "reinforcement" && Boolean(options.includeSuspended),
        includeBuried: options.reviewMode === "reinforcement" && Boolean(options.includeBuried),
        includePaused: options.reviewMode === "reinforcement" && Boolean(options.includePaused),
    }, () => {
        sessionStarted = true;
        let queueLoaded = false;
        void fetchPost("/api/flashcard/getSessionQueue", {sessionID}, (queueResponse) => {
            queueLoaded = true;
            const queue = (queueResponse.data.cards as IFlashcardV2SessionQueueCard[])
                .filter((item) => item.card.generationStatus === "active" &&
                    (item.sessionCard.status === "queued" || item.sessionCard.status === "shown"));
            emitFlashcardV2Lifecycle(app, "flashcard-review-session-started", {
                sessionID,
                reviewSetID,
                reviewMode: options.reviewMode,
                cardCount: queue.length,
            });
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
                    const completionDialog = new Dialog({
                        title: name,
                        width: isMobile() ? "92vw" : "520px",
                        content: `<div class="b3-dialog__content card__empty card__empty--space card__v2-completion">${sessionCompletionContent(false)}</div>`,
                    });
                    completionDialog.element.setAttribute("data-flashcard-v2-review", "");
                    flashcardV2ReviewOpening = false;
                    completionDialog.element.querySelector('[data-type="finish"]').addEventListener("click", () => {
                        completionDialog.destroy();
                    });
                }).then(() => {
                    if (!completionShown) {
                        flashcardV2ReviewOpening = false;
                    }
                });
                return;
            }
            let index = 0;
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
            let renderPending = true;
            let completedPending = false;
            let lastReview: IFlashcardV2LastReview | undefined;
            let renderGeneration = 0;
            let sessionEndEmitted = false;
            const flagDefinitions = new Map<number, string>();
            void fetchPost("/api/flashcard/listEntities", {
                entityType: "flagDefinition",
                options: {limit: 7, offset: 0},
            }, (response) => {
                (response.data.entities as Array<{ payload: { flag: number, name: string } }>).forEach((revision) => {
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
            const dialog = new Dialog({
                title: name,
                positionId: Constants.DIALOG_OPENCARD,
                width: isMobile() ? "100vw" : "860px",
                height: isMobile() ? "100dvh" : "78vh",
                content: sessionContent(),
                destroyCallback: () => {
                    renderGeneration++;
                    playbackController?.cancel();
                    if (!sessionFinished) {
                        sessionFinished = true;
                        const status = completedPending ? "completed" : "abandoned";
                        finishSession(sessionID, status, () => emitSessionEnded(status));
                    }
                },
            });
            dialog.element.setAttribute("data-key", Constants.DIALOG_OPENCARD);
            dialog.element.setAttribute("data-flashcard-v2-review", "");
            flashcardV2ReviewOpening = false;
            const canUseReviewActions = () => canUseFlashcardV2ReviewActions({
                renderPending,
                requestPending,
                sessionFinished,
                index,
                queueLength: queue.length,
            });
            const acceptRendered = (rendered: IFlashcardV2RenderedCard) => {
                playbackController?.cancel();
                shownAt = rendered.shownAt;
                revealController = rendered.revealController;
                typedAnswerController = rendered.typedAnswerController;
                choiceController = rendered.choiceController;
                pluginAnswerController = rendered.pluginAnswerController;
                sourceBlockID = rendered.sourceBlockID;
                setFlashcardLocateBlockID(dialog.element, sourceBlockID);
                playbackController = rendered.playbackController;
                currentModel = rendered.model;
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
            };
            const renderCurrent = () => {
                const generation = ++renderGeneration;
                setFlashcardLocateBlockID(dialog.element);
                renderPending = true;
                revealController = undefined;
                typedAnswerController = undefined;
                choiceController = undefined;
                pluginAnswerController = undefined;
                sourceBlockID = undefined;
                currentModel = undefined;
                pluginEdit = undefined;
                answerResult = undefined;
                renderSessionCard(dialog, queue, index,
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
                renderGeneration++;
                setFlashcardLocateBlockID(dialog.element);
                renderPending = false;
                completedPending = true;
                setReviewActionsEnabled(dialog, true);
                dialog.element.querySelector("[data-flashcard-count]").textContent = `${queue.length} / ${queue.length}`;
                const contentElement = dialog.element.querySelector(".card__block");
                const frontElement = contentElement.querySelector("[data-flashcard-front]");
                dialog.element.querySelector("[data-flashcard-toolbar]").classList.add("fn__none");
                contentElement.querySelector("[data-flashcard-context]").classList.add("fn__none");
                frontElement.className = "card__empty card__empty--space card__v2-completion";
                frontElement.innerHTML = sessionCompletionContent(Boolean(lastReview));
                contentElement.querySelector("[data-flashcard-answer]").classList.add("fn__none");
                dialog.element.querySelector('[data-flashcard-action="reveal"]').classList.add("fn__none");
                dialog.element.querySelector('[data-flashcard-action="ratings"]').classList.add("fn__none");
                dialog.element.querySelector('[data-flashcard-action="finish"]').classList.add("fn__none");
            };
            const nextCard = () => {
                playbackController?.cancel();
                index++;
                while (index < queue.length && queue[index].sessionCard.status !== "queued" &&
                queue[index].sessionCard.status !== "shown") {
                    index++;
                }
                if (index < queue.length) {
                    completedPending = false;
                    renderCurrent();
                    return;
                }
                showCompletion();
            };
            const reveal = () => {
                if (!canUseReviewActions()) {
                    return;
                }
                const contentElement = dialog.element.querySelector(".card__block");
                const complete = revealController?.revealNext() ?? true;
                if (complete) {
                    answerResult = pluginAnswerController?.check() ?? choiceController?.check() ??
                        typedAnswerController?.check();
                    showFlashcardAnswer(contentElement);
                    dialog.element.querySelector("[data-flashcard-answer]").classList.remove("fn__none");
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
                setActionsVisible(dialog, complete);
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
                    (item.sessionCard.status === "queued" || item.sessionCard.status === "shown"));
                const updateNext = (position: number) => {
                    if (position >= active.length) {
                        requestPending = false;
                        lastReview = undefined;
                        setUndoVisible(dialog, false);
                        nextCard();
                        return;
                    }
                    let updated = false;
                    void fetchPost("/api/flashcard/updateSessionCard", {
                        operationID: genUUID(),
                        sessionID,
                        cardID: active[position].card.id,
                        status: "skipped",
                        skipReason: reason,
                        updatedAt: Date.now(),
                    }, () => {
                        updated = true;
                        active[position].sessionCard.status = "skipped";
                        updateNext(position + 1);
                    }).then(() => {
                        if (!updated) {
                            requestPending = false;
                        }
                    });
                };
                updateNext(0);
            };
            const manageAndSkip = (cardIDs: string[], action: string, values: Record<string, unknown>,
                reason: string) => {
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
                    skipManagedSessionCards(cardIDs, reason);
                }).then(() => {
                    if (!managed) {
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
                    requestPending = false;
                }).then(() => {
                    if (!managed) {
                        requestPending = false;
                    }
                });
            };
            const queryCurrentCardTags = (targetType: "source" | "card") => {
                const current = queue[index];
                fetchPost("/api/flashcard/queryCards", {
                    query: {version: 1, root: {
                        operator: "predicate", field: "cardID", comparator: "equal", value: current.card.id,
                    }},
                    options: {
                        now: Date.now(), includeInactive: true, includeSuspended: true,
                        includeBuried: true, includePaused: true, includeConflicts: true, limit: 1,
                    },
                }, (response) => {
                    const result = response.data.cards?.[0] as {
                        cardTagIDs?: string[], sourceTagIDs?: string[]
                    } | undefined;
                    openFlashcardV2SessionTags(targetType,
                        targetType === "card" ? current.card.id : current.card.sourceID,
                        targetType === "card" ? result?.cardTagIDs || [] : result?.sourceTagIDs || []);
                });
            };
            const openCurrentManagementMenu = (button: HTMLElement) => {
                const current = queue[index];
                const menu = new Menu();
                menu.addItem({
                    id: "flashcardV2EditSource",
                    icon: "iconEdit",
                    label: window.siyuan.languages.edit,
                    click: () => (dialog.element.querySelector('[data-type="edit-source"]') as HTMLElement).click(),
                });
                const buried = (current.reviewState.buriedUntil || 0) > Date.now();
                menu.addItem({
                    id: "flashcardV2Bury",
                    label: buried ? window.siyuan.languages.flashcardUnbury : window.siyuan.languages.flashcardBury,
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
                    label: current.reviewState.suspended ? window.siyuan.languages.continueReview1 :
                        window.siyuan.languages.flashcardSuspendCard,
                    click: () => current.reviewState.suspended ?
                        manageWithoutSkipping([current.card.id], "resume", {}) :
                        manageAndSkip([current.card.id], "suspend", {}, "userSuspended"),
                });
                menu.addItem({
                    id: "flashcardV2SuspendSource",
                    icon: "iconPause",
                    label: window.siyuan.languages.flashcardSuspendSource,
                    click: () => {
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
                            const cardIDs = (response.data.cards as Array<{ card: { id: string } }>)
                                .map((item) => item.card.id);
                            if (cardIDs.length === 0) {
                                requestPending = false;
                                return;
                            }
                            manageAndSkip(cardIDs, "suspend", {}, "sourceSuspended");
                        }).then(() => {
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
                    click: () => manageAndSkip([current.card.id], "reset", {}, "userReset"),
                });
                menu.addItem({
                    id: "flashcardV2SetDue",
                    icon: "iconCalendar",
                    label: window.siyuan.languages.setDueTime,
                    click: () => openFlashcardV2SessionDue(current.card.id, current.reviewState.due,
                        () => {
                            requestPending = true;
                            skipManagedSessionCards([current.card.id], "dueChanged");
                        }),
                });
                menu.addItem({
                    id: "flashcardV2SetFlag",
                    icon: "iconBookmark",
                    label: `${window.siyuan.languages.cardStatus} - ${flagDefinitions.get((current.card.flag + 1) % 8) || (current.card.flag + 1) % 8}`,
                    bind: (element) => {
                        const nextFlag = (current.card.flag + 1) % 8;
                        if (nextFlag > 0) {
                            (element.querySelector("svg") as SVGElement).style.color = flashcardV2FlagColors[nextFlag];
                        }
                    },
                    click: () => manageWithoutSkipping([current.card.id], "setFlag", {
                        flag: (current.card.flag + 1) % 8,
                    }),
                });
                menu.addItem({
                    id: "flashcardV2CardTags",
                    icon: "iconTag",
                    label: `${window.siyuan.languages.tag} - ${window.siyuan.languages.riffCard}`,
                    click: () => queryCurrentCardTags("card"),
                });
                menu.addItem({
                    id: "flashcardV2SourceTags",
                    icon: "iconTag",
                    label: `${window.siyuan.languages.tag} - ${window.siyuan.languages.flashcardCardSource}`,
                    click: () => queryCurrentCardTags("source"),
                });
                if (isMobile()) {
                    menu.fullscreen();
                } else {
                    const rect = button.getBoundingClientRect();
                    menu.open({x: rect.left, y: rect.bottom});
                }
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
            dialog.element.addEventListener("click", (event) => {
                const target = event.target as HTMLElement;
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
                        rating: ratingElement.dataset.rating,
                        reviewedAt,
                        durationMS: Math.max(0, Math.round(performance.now() - shownAt)),
                        sessionID,
                        reviewSetID,
                        reviewMode: options.reviewMode,
                        buryUntil: nextLocalDay(reviewedAt),
                        answerResult: submittedAnswerResult,
                    }, (response) => {
                        reviewed = true;
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
                        nextCard();
                    }).then(() => {
                        if (!reviewed) {
                            requestPending = false;
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
                        queue[undoing.index].sessionCard.status = "queued";
                        undoing.skippedSessionCardIDs.forEach((cardID) => {
                            const item = queue.find((candidate) => candidate.card.id === cardID);
                            if (item) {
                                item.sessionCard.status = "queued";
                            }
                        });
                        index = undoing.index;
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
                if (target.closest('[data-type="finish"]') && !requestPending) {
                    requestPending = true;
                    let finished = false;
                    void finishSession(sessionID, "completed", () => {
                        finished = true;
                        if (!sessionFinished) {
                            sessionFinished = true;
                            emitSessionEnded("completed");
                            dialog.destroy();
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
                    });
                    return;
                }
                if (target.closest('[data-type="show"]')) {
                    reveal();
                    return;
                }
                if (target.closest('[data-type="skip"]') && !requestPending) {
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
                    }).then(() => {
                        if (!skipped) {
                            requestPending = false;
                        }
                    });
                }
            });
            dialog.element.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.repeat || requestPending) {
                    return;
                }
                const eventTarget = event.target as HTMLElement;
                const editing = Boolean(eventTarget.closest("input,textarea,select,[contenteditable=true]"));
                if (editing) {
                    if (event.key === "Enter" &&
                        eventTarget.matches("[data-anki-type-answer], [data-flashcard-type-answer]")) {
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
            renderCurrent();
        }).then(() => {
            if (!queueLoaded) {
                flashcardV2ReviewOpening = false;
                void finishSession(sessionID, "abandoned");
            }
        });
    }).then(() => {
        if (!sessionStarted) {
            flashcardV2ReviewOpening = false;
        }
    });
};
