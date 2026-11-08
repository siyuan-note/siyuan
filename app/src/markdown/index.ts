import "vditor/dist/index.css";
import "../assets/scss/markdown.scss";
import type {MarkdownBootstrap, MarkdownBridge, MarkdownCommand, MarkdownPreferences} from "./bridge";
import {createMarkdownEditor, MarkdownEditor, MarkdownEditorMode} from "./editor";
import {MarkdownSession, MarkdownSessionState} from "./session";
import {createNativeMarkdownBridge} from "./nativeBridge";
import {markdownErrorKey} from "./errors";
import {createMarkdownTree, MarkdownTree} from "./tree";
import {MarkdownTreeLocation} from "./treeContracts";
import {createMarkdownChoice, createMarkdownSubmenu, MarkdownChoice} from "./choiceMenu";
import {createMarkdownWindowChrome} from "./windowChrome";
import {createMarkdownTooltips} from "./tooltip";
import {createMarkdownSidebarShortcuts} from "./shortcuts";

declare const SIYUAN_VERSION: string;
(window as unknown as {SIYUAN_VERSION: string}).SIYUAN_VERSION = SIYUAN_VERSION;

interface MarkdownApplication {
    session: MarkdownSession;
    editor: MarkdownEditor;
    treeReady: Promise<void>;
    dispatch(message: MarkdownCommand): Promise<void>;
    destroy(): void;
}

export const mountMarkdownApplication = async (bridge: MarkdownBridge, root = document.getElementById("markdownApp"), initial?: MarkdownBootstrap): Promise<MarkdownApplication> => {
    let bootstrap: MarkdownBootstrap = initial ?? await bridge.bootstrap();
    const text = (key: string) => bootstrap.languages[key] ?? key;
    let preferences = bootstrap.preferences;
    let activeMode = preferences.mode;
    let systemDark = bootstrap.dark;
    let editor: MarkdownEditor;
    let session: MarkdownSession;
    let frozen = false;
    let targetGeneration = bootstrap.recovered?.targetGeneration ?? 0;
    let autoSave: ReturnType<typeof setTimeout>;
    let actionMessage = "";
    let resourceUnavailable = false;
    let preparing = false;
    let prepared = false;
    let exitSequence = 0;
    let pendingFileAction: Promise<unknown>;
    let themeSequence = 0;
    let editPending = false;
    let history = {canUndo: false, canRedo: false};
    let outline = {enabled: false, visible: false, available: false};
    let sourceOnly = false;
    let disposed = false;
    let tree: MarkdownTree = undefined;
    let modeChoice: MarkdownChoice = undefined;
    let themeChoice: MarkdownChoice = undefined;
    let fontChoice: MarkdownChoice = undefined;
    let appearanceMenu: ReturnType<typeof createMarkdownSubmenu> = undefined;
    let switching = false;
    let switchTask: Promise<boolean>;
    let pendingSwitch: {ticket: string; sessionId: string};
    let switchFailed = false;
    let documentGeneration = 0;
    const control = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`);

    document.documentElement.lang = bootstrap.lang;
    const platforms: Record<string, string> = {darwin: "mac", win32: "windows", linux: "linux", android: "android", ios: "ios", harmony: "harmony"};
    document.body.classList.add(`body--${platforms[bootstrap.platform] ?? bootstrap.platform}`);
    root.innerHTML = `<header class="markdown-header">
    <button type="button" class="block__icon block__icon--show block__icon--tap block__icon--inset markdown-tree-toggle" id="markdownTreeToggle"><svg aria-hidden="true"><use href="#iconPanelLeft"></use></svg></button>
    <button type="button" class="block__icon block__icon--show block__icon--tap block__icon--inset markdown-outline-toggle" id="markdownOutlineToggle" aria-expanded="false" aria-controls="markdownEditor-outline" disabled><svg aria-hidden="true"><use href="#iconOutline"></use></svg></button>
    <div class="markdown-heading" id="markdownFiles"><span id="markdownName" class="markdown-name"></span></div>
    <div class="markdown-header__drag" aria-hidden="true"></div>
    <button type="button" class="block__icon block__icon--show block__icon--tap block__icon--inset markdown-history" id="markdownUndo" disabled><svg aria-hidden="true"><use href="#iconUndo"></use></svg></button>
    <button type="button" class="block__icon block__icon--show block__icon--tap block__icon--inset markdown-history" id="markdownRedo" disabled><svg aria-hidden="true"><use href="#iconRedo"></use></svg></button>
    <details class="markdown-more" id="markdownMore">
        <summary class="block__icon block__icon--show block__icon--tap block__icon--inset markdown-more__button" id="markdownMoreButton" aria-controls="markdownActions" aria-expanded="false"><svg aria-hidden="true"><use href="#iconMore"></use></svg></summary>
        <div class="b3-menu markdown-menu" id="markdownActions">
            <button type="button" class="b3-menu__item" id="markdownNew"><svg class="b3-menu__icon" aria-hidden="true"><use href="#iconAddDoc"></use></svg><span class="b3-menu__label" data-label="new"></span></button>
            <button type="button" class="b3-menu__item" id="markdownOpen"><svg class="b3-menu__icon" aria-hidden="true"><use href="#iconFileText"></use></svg><span class="b3-menu__label" data-label="openBy"></span></button>
            <button type="button" class="b3-menu__item" id="markdownOpenFolder"><svg class="b3-menu__icon" aria-hidden="true"><use href="#iconFolder"></use></svg><span class="b3-menu__label" data-label="markdownOpenFolder"></span></button>
            <button type="button" class="b3-menu__item" id="markdownRevealFile" hidden><svg class="b3-menu__icon" aria-hidden="true"><use href="#iconFocus"></use></svg><span class="b3-menu__label" data-label="showInFolder"></span></button>
            <button type="button" class="b3-menu__item" id="markdownSave"><svg class="b3-menu__icon" aria-hidden="true"><use href="#iconSave"></use></svg><span class="b3-menu__label" data-label="save"></span></button>
            <button type="button" class="b3-menu__item" id="markdownSaveAs"><svg class="b3-menu__icon" aria-hidden="true"><use href="#iconDownloadAssets"></use></svg><span class="b3-menu__label" data-label="saveAs"></span></button>
            <hr class="b3-menu__separator">
            <button type="button" class="b3-menu__item" id="markdownInsertImage"><svg class="b3-menu__icon" aria-hidden="true"><use href="#iconImage"></use></svg><span class="b3-menu__label" data-label="insertImage"></span></button>
            <button type="button" class="b3-menu__item" id="markdownResources"><svg class="b3-menu__icon" aria-hidden="true"><use href="#iconKey"></use></svg><span class="b3-menu__label" data-label="markdownResources"></span></button>
            <button type="button" class="b3-menu__item" id="markdownRecovery" aria-expanded="false" aria-controls="markdownRecoveryPanel"><svg class="b3-menu__icon" aria-hidden="true"><use href="#iconHistory"></use></svg><span class="b3-menu__label" data-label="markdownRecovery"></span></button>
            <hr class="b3-menu__separator">
            <div id="markdownMode"></div>
            <div id="markdownPreferences"><div id="markdownTheme"></div><div id="markdownFont"></div></div>
            <div class="markdown-policy"><p id="markdownNotice" role="status"></p></div>
        </div>
    </details>
</header>
<div class="markdown-workspace">
    <aside class="markdown-tree" id="markdownTree" hidden></aside>
    <aside class="markdown-recovery" id="markdownRecoveryPanel" hidden><div class="markdown-recovery__heading"><strong data-label="markdownRecovery"></strong><button type="button" class="b3-button b3-button--text" id="markdownRecoveryClose" data-label="close"></button></div><p data-label="markdownPrivacy"></p><div id="markdownRecoveryList"></div></aside>
    <main class="markdown-editor" id="markdownEditor" aria-busy="true"></main>
</div>
<footer class="markdown-footer" id="markdownFooter" hidden>
    <div class="markdown-status"><span id="markdownStatus" role="status" aria-live="polite"></span><span class="markdown-status__actions" id="markdownProblemActions"><button type="button" class="b3-button b3-button--text" id="markdownRetry" data-label="retry" hidden></button><button type="button" class="b3-button b3-button--text" id="markdownReload" data-label="markdownReload" hidden></button><button type="button" class="b3-button b3-button--text" id="markdownOverwrite" data-label="markdownOverwrite" hidden></button></span></div>
</footer>`;
    let tooltips: ReturnType<typeof createMarkdownTooltips>;
    const sidebarShortcuts = createMarkdownSidebarShortcuts({
        platform: bootstrap.platform, keymap: bootstrap.keymap,
        canToggle: key => Boolean(editor) && !disposed && !frozen && !switching &&
            (key === "fileTree" || outline.available),
        isComposing: () => Boolean(session?.getState().composing),
        toggle(key) {control<HTMLButtonElement>(key === "fileTree" ? "markdownTreeToggle" : "markdownOutlineToggle").click();},
    });
    const updateSidebarShortcutHints = () => {
        control("markdownTreeToggle").dataset.tooltipShortcut = sidebarShortcuts.label("fileTree");
        control("markdownOutlineToggle").dataset.tooltipShortcut = outline.available ? sidebarShortcuts.label("outline") : "";
    };
    root.querySelectorAll<HTMLElement>("[data-label]").forEach(element => { element.textContent = text(element.dataset.label); });
    for (const [id, explanation] of [["markdownResources", "markdownPreviewPolicy"],
        ["markdownRecovery", "markdownPrivacy"]]) {
        const action = control(id);
        action.setAttribute("aria-description", text(explanation));
        action.insertAdjacentHTML("beforeend", `<svg id="${id}Info" class="b3-menu__icon b3-menu__icon--small" aria-hidden="true"><use href="#iconInfo"></use></svg>`);
        action.querySelector<SVGElement>(`#${id}Info`).dataset.tooltip = text(explanation);
    }
    const header = root.querySelector<HTMLElement>(".markdown-header");
    header.inert = true;
    control("markdownEditor").inert = true;
    control("markdownMoreButton").setAttribute("aria-label", text("more"));
    control("markdownMoreButton").dataset.tooltip = text("more");
    for (const [id, label] of [["markdownUndo", "undo"], ["markdownRedo", "redo"], ["markdownOutlineToggle", "outline"]]) {
        control(id).setAttribute("aria-label", text(label));
        control(id).dataset.tooltip = text(label);
        control(id).addEventListener("mousedown", event => event.preventDefault());
    }
    const more = control<HTMLDetailsElement>("markdownMore");
    const moreButton = control("markdownMoreButton");
    const closeMore = (restoreFocus = true) => {
        modeChoice?.close(); appearanceMenu?.close();
        if (!more.open) return;
        more.open = false;
        moreButton.setAttribute("aria-expanded", "false");
        if (restoreFocus && !frozen) moreButton.focus();
    };
    more.addEventListener("toggle", () => {
        if (!more.open) {modeChoice?.close(); appearanceMenu?.close();}
        if (frozen) more.open = false;
        moreButton.setAttribute("aria-expanded", String(more.open));
    });
    const dismissMore = (event: Event) => {
        if (more.open && !more.contains(event.target as Node)) closeMore(event.type === "pointerdown");
    };
    const menuKey = (event: KeyboardEvent) => {
        if (event.key === "Escape" && more.open) {
            if ((event.target as Element).closest('.markdown-choice[aria-expanded="true"]')) return;
            event.preventDefault(); event.stopImmediatePropagation(); closeMore();
        } else if (event.key === "ArrowDown" && event.target === moreButton && !frozen) {
            event.preventDefault(); more.open = true; control("markdownNew").focus();
        }
    };
    document.addEventListener("pointerdown", dismissMore);
    document.addEventListener("focusin", dismissMore);
    document.addEventListener("keydown", menuKey, true);
    const removeMenuListeners = () => {
        tooltips?.destroy();
        document.removeEventListener("keydown", menuKey, true);
        document.removeEventListener("pointerdown", dismissMore);
        document.removeEventListener("focusin", dismissMore);
    };
    let initializationClosing = false;
    const initializationCommand = async (message: MarkdownCommand) => {
        if (message.type === "keymap") {sidebarShortcuts.update(message.keymap); updateSidebarShortcutHints(); return;}
        let accepted = false;
        if (message.type === "cancel-quit") {preparing = false; prepared = false; frozen = false; return;}
        if (message.type === "prepare-quit") {preparing = true; prepared = true; frozen = true; accepted = true;}
        else if (message.type === "close") {
            initializationClosing = true;
            try {
                await bridge.host.releaseSession({sessionId: bootstrap.sessionId, targetGeneration: bootstrap.recovered?.targetGeneration ?? 0});
                removeMenuListeners();
                unsubscribeInitialization();
                accepted = true;
            } catch {initializationClosing = false;}
        } else if (message.type === "background") accepted = true;
        else return;
        await bridge.respond(message.id, accepted);
    };
    // 初始化期间不接受编辑；主题或编辑器资源加载失败时，窗口仍须能够安全关闭。
    const unsubscribeInitialization = bridge.onCommand(message => { void initializationCommand(message).catch((): void => undefined); });

    const applyTheme = async () => {
        const dark = preferences.theme === "dark" || (preferences.theme === "system" && systemDark);
        const sequence = ++themeSequence;
        const oldLink = document.getElementById("markdownThemeStyle") as HTMLLinkElement;
        const href = new URL(`./appearance/themes/${dark ? "midnight" : "daylight"}/theme.css`, location.href).href;
        if (oldLink.href !== href || !oldLink.sheet) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.media = "not all";
            link.href = href;
            await new Promise<void>((resolve, reject) => {
                link.onload = () => resolve();
                link.onerror = () => {link.remove(); reject(new Error("Markdown theme unavailable"));};
                document.head.append(link);
            });
            if (sequence !== themeSequence) {link.remove(); return;}
            oldLink.remove();
            link.id = "markdownThemeStyle";
            link.media = "all";
        }
        document.documentElement.dataset.themeMode = dark ? "dark" : "light";
        editor?.setTheme(dark ? "dark" : "light");
        windowChrome?.refresh();
    };
    root.style.setProperty("--markdown-font-size", `${preferences.fontSize}px`);

    const render = (state: MarkdownSessionState) => {
        if (disposed) return;
        const problem = state.lifecycle === "closed" ? undefined : state.problem;
        const recoveryError = state.lifecycle === "closed" ? undefined : state.recoveryError;
        const statusKeys: Record<MarkdownSessionState["status"], string> = {
            view: "markdownReadOnly", draft: "markdownDraft", dirty: "markdownUnsaved", saving: "markdownSaving",
            saved: "markdownSaved", conflict: "markdownConflict", blocked: "markdownError", closed: "close",
        };
        control("markdownName").textContent = state.target?.displayName ?? text("untitled");
        document.title = state.target?.displayName ?? text("untitled");
        const pendingStatus = editPending && ["saved", "view", "draft"].includes(state.status);
        const statusKey = !editPending && state.status === "draft" && !state.hasUnsavedChanges ? "" :
            pendingStatus || state.status === "draft" && state.draftRevision < state.revision ? "markdownUnsaved" :
            statusKeys[state.status];
        control("markdownStatus").textContent = actionMessage || text(recoveryError ? markdownErrorKey(recoveryError) :
            problem?.kind === "indeterminate" ? "markdownUncertain" : problem?.kind === "blocked" ? markdownErrorKey(problem.error) : statusKey);
        control("markdownStatus").dataset.status = actionMessage || recoveryError ? "blocked" : pendingStatus ? "dirty" : state.status;
        control("markdownFooter").hidden = !actionMessage && !recoveryError && !problem;
        const notices = [
            resourceUnavailable ? text("markdownResourceUnavailable") : "",
            sourceOnly ? text("markdownSourceOnly") : "",
            bootstrap.recovered ? text("markdownRecovered") : ""];
        control("markdownNotice").textContent = notices.filter(Boolean).join(" · ");
        control<HTMLButtonElement>("markdownRetry").hidden = pendingSwitch ? !switchFailed : problem?.kind !== "indeterminate" &&
            (problem?.kind !== "blocked" || !problem.error.recoverable);
        control<HTMLButtonElement>("markdownReload").hidden = problem?.kind !== "conflict";
        const overwrite = control<HTMLButtonElement>("markdownOverwrite");
        overwrite.hidden = problem?.kind !== "conflict";
        overwrite.disabled = frozen || problem?.kind !== "conflict" || !problem.baseline ||
            state.problemTargetHandle !== state.target?.handle;
        control<HTMLButtonElement>("markdownSave").disabled = frozen || state.composing;
        control<HTMLButtonElement>("markdownRevealFile").hidden = !bridge.revealFile;
        control<HTMLButtonElement>("markdownRevealFile").disabled = frozen || !state.target;
        control<HTMLButtonElement>("markdownUndo").disabled = frozen || state.composing || !history.canUndo;
        control<HTMLButtonElement>("markdownRedo").disabled = frozen || state.composing || !history.canRedo;
        const outlineToggle = control<HTMLButtonElement>("markdownOutlineToggle");
        outlineToggle.disabled = state.composing || !outline.available;
        outlineToggle.setAttribute("aria-disabled", String(frozen || outlineToggle.disabled));
        outlineToggle.setAttribute("aria-expanded", String(outline.visible));
        outlineToggle.dataset.tooltip = text(outline.available ? "outline" : "markdownOutlineUnavailable");
        updateSidebarShortcutHints();
        control<HTMLButtonElement>("markdownSaveAs").disabled = frozen || state.composing || problem?.kind === "indeterminate";
        control<HTMLButtonElement>("markdownInsertImage").disabled = frozen || state.composing || problem?.kind === "indeterminate";
        modeChoice?.setDisabled(frozen || state.composing);
        if (targetGeneration !== state.targetGeneration) {
            targetGeneration = state.targetGeneration;
            resourceUnavailable = false;
            editor?.refreshResources();
            void tree?.refresh();
        }
        const {sessionId, status, revision, savedRevision, draftRevision, targetGeneration: generation, composing} = state;
        void bridge.state({sessionId, status, revision, savedRevision, draftRevision, targetGeneration: generation, composing}).catch((): void => undefined);
    };

    const reportError = () => {
        if (disposed) return;
        actionMessage = text("markdownError");
        if (session) render(session.getState());
    };
    const documentError = () => {
        const generation = documentGeneration;
        return () => {if (!disposed && generation === documentGeneration) reportError();};
    };
    const scheduleAutoSave = () => {
        clearTimeout(autoSave);
        const state = session?.getState();
        if (disposed || frozen || editPending || !state || state.lifecycle !== "open" ||
            state.composing || state.problem || !state.target?.writable || !state.hasUnsavedChanges) return;
        autoSave = setTimeout(() => {void session.save().catch(documentError());}, 250);
    };
    const freeze = (value: boolean) => {
        if (disposed) return;
        frozen = value || switching || Boolean(pendingSwitch);
        clearTimeout(autoSave);
        if (frozen) closeMore(false);
        control("markdownEditor").inert = frozen;
        more.inert = frozen;
        control("markdownActions").inert = frozen;
        control("markdownPreferences").inert = frozen;
        control("markdownRecoveryPanel").inert = frozen;
        control("markdownProblemActions").inert = frozen && !pendingSwitch;
        tree?.freeze(frozen);
        render(session.getState());
        if (!frozen) scheduleAutoSave();
    };

    const windowChrome = createMarkdownWindowChrome({root, header, bridge: bridge.window, platform: bootstrap.platform, text, onError: reportError});
    // 窗口外壳独立于文档存活；仅重建编辑器，隔离同窗口不同文档的撤销历史和资源权限。
    const initializeDocument = async (next: MarkdownBootstrap) => {
        const generation = ++documentGeneration;
        const current = () => !disposed && generation === documentGeneration;
        clearTimeout(autoSave);
        editor?.destroy();
        editor = undefined;
        bootstrap = next;
        targetGeneration = next.recovered?.targetGeneration ?? 0;
        actionMessage = "";
        resourceUnavailable = false;
        editPending = false;
        sourceOnly = false;
        activeMode = preferences.mode;
        modeChoice?.setValue(activeMode);
        history = {canUndo: false, canRedo: false};
        control("markdownRecoveryPanel").hidden = true;
        control("markdownRecovery").setAttribute("aria-expanded", "false");
        control("markdownRecoveryList").replaceChildren();
        const element = control("markdownEditor");
        element.replaceChildren();
        element.className = "markdown-editor";
        element.inert = true;
        element.setAttribute("aria-busy", "true");
        const documentSession = new MarkdownSession({...next, host: bridge.host,
            onChange: state => {if (current()) render(state);}});
        session = documentSession;
        render(documentSession.getState());
        try {
            const nextEditor = await createMarkdownEditor({
                element: control("markdownEditor"), initialValue: next.content, sessionId: next.sessionId, mode: preferences.mode,
                cdn: new URL("./vditor", location.href).href, lang: next.lang,
                mobile: ["android", "ios", "harmony"].includes(next.platform),
                outline: outline.enabled,
                theme: preferences.theme === "dark" || (preferences.theme === "system" && systemDark) ? "dark" : "light",
                onHistoryChange(state) {if (!current()) return; history = state; render(documentSession.getState());},
                onOutlineChange(state) {if (!current()) return; outline = state; render(documentSession.getState());},
                resolveResource: async reference => {
                    if (!current()) return undefined;
                    const result = await bridge.resolveResource(reference);
                    return current() ? result : undefined;
                },
                onResourceUnavailable: () => {if (current()) {resourceUnavailable = true; render(documentSession.getState());}},
                onLink: url => {if (current()) void bridge.openLink(url).catch(() => {if (current()) reportError();});},
                onEditPending(pending) {
                    if (!current()) return;
                    editPending = pending;
                    if (pending) {clearTimeout(autoSave); documentSession.invalidateReload();}
                    else scheduleAutoSave();
                    render(documentSession.getState());
                },
                onContentTooLarge() {
                    if (!current()) return;
                    clearTimeout(autoSave);
                    actionMessage = text("markdownTooLarge");
                    render(documentSession.getState());
                    scheduleAutoSave();
                },
                onSourceOnlyChange(value) {
                    if (!current()) return;
                    sourceOnly = value;
                    render(documentSession.getState());
                },
                onModeChange(mode, origin) {
                    if (!current()) return;
                    activeMode = mode;
                    modeChoice?.setValue(mode);
                    if (origin === "user" && preferences.mode !== mode) {
                        preferences = {...preferences, mode};
                        runAction(() => bridge.preferences({mode}), false, true);
                    }
                },
                onEdit(snapshot) {
                    if (!current()) return;
                    if (actionMessage === text("markdownTooLarge")) actionMessage = "";
                    documentSession.updateEditor(snapshot);
                    scheduleAutoSave();
                },
            });
            if (!current() || initializationClosing) {
                nextEditor.destroy();
                throw new Error("Markdown document initialization was superseded");
            }
            editor = nextEditor;
            modeChoice?.setValue(preferences.mode);
        } catch (error) {
            if (current()) {
                documentGeneration++;
                outline = {...outline, visible: false, available: false};
                element.className = "markdown-editor";
                element.textContent = text("markdownLoadError");
                render(documentSession.getState());
            }
            throw error;
        } finally {
            if (!disposed && session === documentSession) element.setAttribute("aria-busy", "false");
        }
    };
    try {
        if (!("inert" in HTMLElement.prototype) || typeof TextEncoder !== "function" ||
            typeof MutationObserver !== "function" || typeof ResizeObserver !== "function" || typeof globalThis.crypto?.getRandomValues !== "function") {
            throw new Error("Required Markdown WebView capabilities are unavailable");
        }
        tooltips = createMarkdownTooltips(root);
        await applyTheme();
        if (initializationClosing) throw new Error("Markdown initialization was closed");
        await initializeDocument(bootstrap);
        header.inert = false;
        freeze(frozen);
    } catch (error) {
        control("markdownEditor").textContent = text("markdownLoadError");
        control("markdownEditor").setAttribute("aria-busy", "false");
        tooltips?.destroy();
        throw error;
    }

    const saveAs = async (allowFrozen = false): Promise<boolean> => {
        if ((frozen && !allowFrozen) || editor.flush().composing) return false;
        const wasFrozen = frozen;
        freeze(true);
        let candidateHandle: string;
        try {
            session.updateEditor(editor.flush());
            const state = session.getState();
            if (state.target && /!\[|<img\b/i.test(state.content) && !await bridge.confirm("save-as")) return false;
            const choice = await bridge.chooseSaveAs(state.target?.format ?? bootstrap.format ?? {bom: false, newline: "\n"});
            if (choice.kind !== "selected") return false;
            candidateHandle = choice.target.handle;
            const result = await session.saveAs(choice.target, {editor});
            if (result.kind === "saved") candidateHandle = undefined;
            return result.kind === "saved";
        } finally {
            if (candidateHandle) await bridge.cancelSaveAs(candidateHandle).catch((): void => undefined);
            if (!wasFrozen && !preparing) freeze(false);
        }
    };

    const save = async () => {
        if (frozen) return;
        const state = session.getState();
        if (!state.target || !state.target.writable) await saveAs();
        else await session.flush(editor);
    };
    const runAction = (run: () => void | Promise<unknown>, fileAction = false, windowAction = false) => {
        actionMessage = "";
        render(session.getState());
        const task = Promise.resolve().then(run).catch(windowAction ? reportError : documentError());
        if (fileAction) {
            const pending = Promise.all([pendingFileAction, task]);
            pendingFileAction = pending;
            void pending.finally(() => {if (pendingFileAction === pending) pendingFileAction = undefined;});
        }
    };
    const action = (id: string, run: () => void | Promise<unknown>) => {
        control(id).addEventListener("click", () => {
            if (frozen) return;
            closeMore();
            runAction(run, ["markdownSave", "markdownSaveAs", "markdownInsertImage", "markdownRetry", "markdownReload", "markdownOverwrite", "markdownResources"].includes(id),
                ["markdownNew", "markdownOpen", "markdownOpenFolder"].includes(id));
        });
    };
    action("markdownNew", () => bridge.newDocument());
    action("markdownOpen", () => bridge.openDocument());
    action("markdownOpenFolder", () => tree.chooseRoot());
    action("markdownRevealFile", () => bridge.revealFile?.());
    action("markdownSave", save);
    action("markdownUndo", () => editor.undo());
    action("markdownRedo", () => editor.redo());
    action("markdownOutlineToggle", () => editor.setOutline(!outline.enabled));
    action("markdownSaveAs", saveAs);
    action("markdownInsertImage", async () => {
        if (frozen || editor.flush().composing) return;
        if (!session.getState().target?.writable && !await saveAs()) return;
        const started = session.getState();
        freeze(true);
        try {
            const result = await bridge.insertImage();
            const current = session.getState();
            if (result.kind === "inserted" && current.lifecycle === "open" && !preparing &&
                current.sessionId === started.sessionId && current.targetGeneration === started.targetGeneration &&
                current.target?.handle === started.target?.handle) {
                if (!editor.insertImage(result.reference)) {reportError(); return;}
                session.updateEditor(editor.flush());
                await session.save();
            } else if (result.kind === "blocked") reportError();
        } finally {
            if (!preparing) freeze(false);
        }
    });
    action("markdownRetry", async () => { session.updateEditor(editor.flush()); await session.retry(); });
    action("markdownReload", async () => {
        const generation = documentGeneration;
        const currentSession = session;
        const currentEditor = editor;
        if (await bridge.confirm("reload") && !disposed && generation === documentGeneration) {
            currentSession.updateEditor(currentEditor.flush());
            if (await currentSession.reload({discardChanges: true}) && !disposed && generation === documentGeneration) {
                currentEditor.setValue(currentSession.getState().content);
            }
        }
    });
    action("markdownOverwrite", async () => {
        const generation = documentGeneration;
        const currentSession = session;
        currentSession.updateEditor(editor.flush());
        const problem = currentSession.getState().problem;
        if (problem?.kind === "conflict" && problem.baseline && await bridge.confirm("overwrite") &&
            !disposed && generation === documentGeneration) await currentSession.overwrite(problem.baseline);
    });
    action("markdownResources", async () => {
        const generation = documentGeneration;
        if (await bridge.authorizeResources() && !disposed && generation === documentGeneration) {
            resourceUnavailable = false;
            editor.refreshResources();
            render(session.getState());
        }
    });

    const showRecoveries = async (show = true) => {
        control("markdownRecoveryPanel").hidden = !show;
        control("markdownRecovery").setAttribute("aria-expanded", String(show));
        if (!show) {moreButton.focus(); return;}
        control("markdownRecoveryClose").focus();
        const generation = documentGeneration;
        const recoveries = await bridge.recoveries();
        if (disposed || generation !== documentGeneration) return;
        const list = control("markdownRecoveryList");
        list.replaceChildren();
        if (!recoveries.length) list.textContent = text("markdownNoRecovery");
        for (const recovery of recoveries) {
            const row = document.createElement("div");
            row.className = "markdown-recovery__item";
            const title = document.createElement("strong");
            title.textContent = recovery.displayName || text("untitled");
            const time = document.createElement("time");
            time.textContent = new Date(recovery.updatedAt).toLocaleString(bootstrap.lang);
            const buttons = document.createElement("div");
            buttons.className = "markdown-recovery__actions";
            for (const [key, callback] of [["markdownRecovery", () => bridge.recover(recovery.id)],
                ["delete", async () => {
                    await bridge.discardRecovery(recovery.id);
                    if (!disposed && generation === documentGeneration) await showRecoveries();
                }]] as const) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "b3-button b3-button--text";
                button.textContent = text(key);
                button.addEventListener("click", () => {if (!frozen) runAction(callback, false, true);});
                buttons.append(button);
            }
            row.append(title, time, buttons);
            list.append(row);
        }
    };
    action("markdownRecovery", () => showRecoveries(Boolean(control("markdownRecoveryPanel").hidden)));
    action("markdownRecoveryClose", () => showRecoveries(false));

    const updatePreferences = async (patch: Partial<Pick<MarkdownPreferences, "theme" | "fontSize">>) => {
        preferences = {...preferences, ...patch};
        if (patch.theme) await applyTheme();
        if (patch.fontSize) root.style.setProperty("--markdown-font-size", `${patch.fontSize}px`);
        preferences = await bridge.preferences(patch);
        if (disposed) return;
        modeChoice.setValue(activeMode);
        themeChoice.setValue(preferences.theme);
        fontChoice.setValue(String(preferences.fontSize));
    };
    const preferenceChoice = (id: "markdownTheme" | "markdownFont", label: string, values: Array<[string, string]>, value: string,
                              patch: (value: string) => Partial<Pick<MarkdownPreferences, "theme" | "fontSize">>) => createMarkdownChoice({
        element: control(id), label: text(label), values: values.map(([value, label]) => ({value, label: text(label)})), value,
        icon: {markdownTheme: "iconMode", markdownFont: "iconFont"}[id],
        onChange(value) {if (!frozen) {closeMore(); runAction(() => updatePreferences(patch(value)), false, true);}},
    });
    appearanceMenu = createMarkdownSubmenu({
        element: control("markdownPreferences"), label: text("appearance"), icon: "iconTheme",
        onClose() {themeChoice?.close(); fontChoice?.close();},
    });
    modeChoice = createMarkdownChoice({
        element: control("markdownMode"), label: text("markdownEditMode"), icon: "iconEdit", value: activeMode,
        values: [["ir", "markdownModeIR"], ["wysiwyg", "wysiwyg"], ["sv", "markdownModeSV"]].map(([value, label]) => ({value, label: text(label)})),
        onChange(mode) {if (!frozen) {closeMore(); editor.setMode(mode as MarkdownEditorMode);}},
    });
    themeChoice = preferenceChoice("markdownTheme", "appearanceMode", [["system", "themeOS"], ["light", "themeLight"], ["dark", "themeDark"]], preferences.theme, value => ({theme: value as MarkdownPreferences["theme"]}));
    fontChoice = preferenceChoice("markdownFont", "fontSize", [14, 16, 18, 20, 24, 28, 32].map(value => [String(value), String(value)]), String(preferences.fontSize), value => ({fontSize: Number(value)}));
    fontChoice.menu.classList.add("markdown-choice__menu--compact");

    const protectExit = async (kind: "close" | "prepare-quit"): Promise<boolean> => {
        const sequence = ++exitSequence;
        await pendingFileAction;
        if (disposed || sequence !== exitSequence || (preparing && !prepared)) return false;
        if (prepared && kind === "close") {
            const accepted = await session.close(editor);
            if (!accepted) {preparing = false; prepared = false; freeze(false);}
            return accepted;
        }
        preparing = true;
        freeze(true);
        let accepted = false;
        try {
            if (!await session.flush(editor) || session.getState().composing || sequence !== exitSequence) return false;
            let state = session.getState();
            if (state.problem?.kind === "indeterminate") return false;
            if (state.hasUnsavedChanges) {
                if (state.draftRevision < state.revision) return false;
                const choice = await bridge.confirmClose();
                if (sequence !== exitSequence || choice === "cancel") return false;
                if (choice === "save-as" && !await saveAs(true)) return false;
                if (sequence !== exitSequence) return false;
                state = session.getState();
                if (state.problem?.kind === "indeterminate") return false;
            }
            accepted = kind === "prepare-quit" || await session.close(editor);
            prepared = accepted && kind === "prepare-quit";
            return accepted;
        } finally {
            if (!accepted && sequence === exitSequence) {preparing = false; freeze(false);}
        }
    };
    const completeSwitch = async (): Promise<boolean> => {
        const candidate = pendingSwitch;
        switchFailed = false;
        actionMessage = "";
        render(session.getState());
        let next: MarkdownBootstrap;
        try {
            // 绑定交换可重试；回执丢失时由宿主快照确认新会话，不能恢复已释放的旧编辑器。
            try {next = await bridge.tree.commitOpen(candidate.ticket);}
            catch {
                try {next = await bridge.tree.commitOpen(candidate.ticket);}
                catch {next = await bridge.bootstrap();}
            }
            if (next.sessionId !== candidate.sessionId) throw new Error("Markdown switch is unconfirmed");
        } catch {
            if (disposed) return false;
            switchFailed = true;
            actionMessage = text("markdownError"); render(session.getState());
            control("markdownProblemActions").inert = false;
            return false;
        }
        if (disposed) return false;
        root.setAttribute("aria-busy", "true");
        try {
            await initializeDocument(next);
            if (disposed) return false;
            await tree.syncSelection();
            pendingSwitch = undefined;
            preparing = false;
            prepared = false;
            switching = false;
            freeze(false);
            return true;
        } catch {
            if (!disposed) {
                switchFailed = true;
                actionMessage = text("markdownLoadError");
                render(session.getState());
                control("markdownProblemActions").inert = false;
            }
            return false;
        } finally {
            if (!disposed) root.setAttribute("aria-busy", "false");
        }
    };
    const openTreeFile = async (location: MarkdownTreeLocation): Promise<boolean> => {
        if (frozen || disposed || switching) return false;
        switching = true; freeze(true);
        let ticket: string;
        let released = false;
        const task = (async () => {
            try {
                await pendingFileAction;
                if (!await session.checkpoint(editor)) return false;
                const candidate = await bridge.tree.prepareOpen(location);
                if (candidate.kind === "current") return true;
                if (candidate.kind !== "ready") {
                    if (candidate.kind === "blocked") {actionMessage = text(markdownErrorKey(candidate.error)); render(session.getState());}
                    return false;
                }
                ticket = candidate.ticket;
                if (!await protectExit("close")) return false;
                released = true;
                // 宿主切换资源绑定前，先使已释放编辑器的回调失效。
                documentGeneration++;
                clearTimeout(autoSave);
                pendingSwitch = candidate;
                return await completeSwitch();
            } finally {
                if (ticket && !released) await bridge.tree.cancelOpen(ticket).catch(reportError);
                switching = false;
                if (!disposed && !released) {preparing = false; freeze(false);}
            }
        })();
        switchTask = task;
        try {return await task;} finally {if (switchTask === task) switchTask = undefined;}
    };
    control("markdownRetry").addEventListener("click", () => {
        if (!pendingSwitch || switchTask || disposed) return;
        switchTask = completeSwitch().catch(() => {reportError(); return false;}).finally(() => {switchTask = undefined;});
    });
    tree = createMarkdownTree({
        element: control("markdownTree"), toggles: [control<HTMLButtonElement>("markdownTreeToggle")],
        bridge: bridge.tree, text,
        mobile: ["android", "ios", "harmony"].includes(bootstrap.platform), onOpen: openTreeFile,
        onError() {actionMessage = text("markdownFolderError"); render(session.getState());},
    });
    tree.freeze(frozen);
    const checkpointBackground = async (message: MarkdownCommand, draftOnly = false) => {
        const reportCurrentError = documentError();
        let accepted = false;
        try {
            clearTimeout(autoSave);
            accepted = draftOnly ? await session.checkpoint(editor) : await session.flush(editor);
            if (draftOnly && accepted) void session.save().catch(reportCurrentError);
        }
        catch {reportCurrentError();}
        finally {await bridge.respond(message.id, accepted);}
    };
    const command = async (message: MarkdownCommand) => {
        if (message.type === "keymap") {
            if (!disposed) {sidebarShortcuts.update(message.keymap); updateSidebarShortcutHints();}
            return;
        }
        if (message.type === "window-state") {windowChrome?.update(message.windowState); return;}
        // 候选云文件读取可能很慢；进入后台仍先保护当前文档的已提交输入。
        if (message.type === "background" && switchTask && !pendingSwitch && session.getState().lifecycle === "open") {
            await checkpointBackground(message, true);
            return;
        }
        if (switchTask) {
            if (message.type === "cancel-quit") {exitSequence++; return;}
            try {
                if (!await switchTask) {
                    if (["close", "prepare-quit", "background"].includes(message.type)) await bridge.respond(message.id, false);
                    return;
                }
            }
            catch {
                if (["close", "prepare-quit", "background"].includes(message.type)) await bridge.respond(message.id, false);
                return;
            }
        }
        if (disposed) return;
        if (pendingSwitch) {
            if (["close", "prepare-quit", "background"].includes(message.type)) await bridge.respond(message.id, false);
            return;
        }
        if (message.type === "tree-change") {await tree.refresh(); return;}
        if (message.type === "background") {
            await checkpointBackground(message);
            return;
        }
        if (message.type === "theme") {
            systemDark = message.dark;
            await applyTheme();
            return;
        }
        if (message.type === "cancel-quit") { exitSequence++; freeze(false); preparing = false; prepared = false; return; }
        if (message.type === "external-change") {
            void tree.refresh();
            const generation = documentGeneration;
            const currentSession = session;
            const currentEditor = editor;
            if (!frozen && !editPending && await currentSession.reload().catch(documentError()) && !disposed && generation === documentGeneration) {
                currentEditor.setValue(currentSession.getState().content);
            }
            return;
        }
        let accepted = false;
        const reportCurrentError = documentError();
        try {
            accepted = await protectExit(message.type);
        } catch {
            reportCurrentError();
        } finally {
            await bridge.respond(message.id, accepted);
        }
    };
    unsubscribeInitialization();
    const unsubscribe = bridge.onCommand(message => { void command(message).catch(reportError); });
    const shortcut = (event: KeyboardEvent) => {
        if (sidebarShortcuts.handle(event)) return;
        const modifier = bootstrap.platform === "darwin" || bootstrap.platform === "ios" ? event.metaKey : event.ctrlKey;
        if (!modifier || event.altKey || event.isComposing || !/^[nos]$/i.test(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (frozen || editor.flush().composing) return;
        closeMore();
        const run = event.key.toLowerCase() === "n" ? () => bridge.newDocument() :
            event.key.toLowerCase() === "o" ? () => bridge.openDocument() : event.shiftKey ? () => saveAs() : save;
        runAction(async () => { await run(); }, event.key.toLowerCase() === "s", event.key.toLowerCase() !== "s");
    };
    document.addEventListener("keydown", shortcut, true);
    render(session.getState());
    function destroyCurrent() {
        if (disposed) return;
        disposed = true; documentGeneration++; themeSequence++; exitSequence++;
        clearTimeout(autoSave); unsubscribe();
        document.removeEventListener("keydown", shortcut, true);
        removeMenuListeners();
        tree?.destroy(); modeChoice?.destroy(); appearanceMenu?.destroy(); themeChoice?.destroy(); fontChoice?.destroy();
        windowChrome?.destroy();
        editor?.destroy();
    }
    return {
        treeReady: tree.ready,
        get session() {return session;},
        get editor() {return editor;},
        dispatch: command,
        destroy: destroyCurrent,
    };
};

const markdownBridge = createNativeMarkdownBridge(window);
if (markdownBridge) {
    void mountMarkdownApplication(markdownBridge).catch(error => console.error("Markdown editor initialization failed", error));
}
