import type {MarkdownEditorSnapshot} from "./contracts";
import {MARKDOWN_DOCUMENT_BYTES, MARKDOWN_RENDER_BYTES, MARKDOWN_RECOVERY_BYTES, markdownByteLength} from "./limits";
import {markdownLinkDestination} from "./link";
import {createMarkdownResourcePolicy, isRelativeMarkdownResource, MarkdownResourceResolver} from "./resourcePolicy";

export type MarkdownEditorMode = "ir" | "wysiwyg" | "sv";

// Only the completion list is filtered. The parser keeps its original emoji map
// so opening and editing an existing document never deletes image shortcodes.
export const markdownUnicodeEmojiHints = (emojis: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(emojis).filter(([, value]) =>
        /^(?:\p{Extended_Pictographic}|\p{Emoji_Component})+$/u.test(value)));

const popoverHotkeys = new Set([
    "⌥Enter", "Alt+Enter", "⌘=", "Ctrl+=", "⌘-", "Ctrl+-",
    "⇧⌘=", "⇧⌘+", "Ctrl+Shift++", "⇧⌘-", "⇧⌘_", "Ctrl+Shift+_",
    ...["L", "C", "R", "F", "G", "U", "D", "X"].flatMap(key => [`⇧⌘${key}`, `Ctrl+Shift+${key}`]),
]);

export const markdownPopoverLabel = (label: string): string => {
    const start = label.lastIndexOf("<");
    return start > 0 && label.endsWith(">") && popoverHotkeys.has(label.slice(start + 1, -1)) ?
        label.slice(0, start) : label;
};

interface VditorSurface {
    element: HTMLElement;
    popover?: HTMLElement;
    composingLock?: boolean;
    processTimeoutId?: number;
    afterRenderTimeoutId?: number;
    hlToolbarTimeoutId?: number;
}

interface VditorInstance {
    version: string;
    vditor: {
        currentMode: MarkdownEditorMode;
        lute: Record<string, (...args: string[]) => string> & {GetEmojis(): Record<string, string>};
        options: {hint: {emoji: Record<string, string>}; outline: {enable: boolean}};
        ir: VditorSurface;
        wysiwyg: VditorSurface;
        sv: VditorSurface;
        toolbar: {element: HTMLElement};
        outline: {element: HTMLElement; toggle(vditor: unknown, show: boolean, focus: boolean): void};
        undo: {addToUndoStack(vditor: unknown): void};
        hint?: {timeId?: number};
        preview?: {render(vditor: unknown): void};
    };
    getValue(): string;
    getCurrentMode(): MarkdownEditorMode;
    setValue(value: string, clearStack?: boolean): void;
    insertMD(markdown: string): void;
    setTheme(theme: "classic" | "dark", contentTheme?: string, codeTheme?: string): void;
    setPreviewMode(mode: "both" | "editor"): void;
    focus(): void;
    destroy(): void;
}

export interface MarkdownEditorOptions {
    element: HTMLElement;
    initialValue: string;
    sessionId?: string;
    mode: MarkdownEditorMode;
    cdn: string;
    lutePath?: string;
    lang?: string;
    theme?: "light" | "dark";
    mobile?: boolean;
    outline?: boolean;
    onEdit(snapshot: MarkdownEditorSnapshot): void;
    onEditPending?(pending: boolean): void;
    onContentTooLarge?(): void;
    onModeChange?(mode: MarkdownEditorMode, origin: "user" | "automatic"): void;
    onSourceOnlyChange?(sourceOnly: boolean): void;
    onHistoryChange?(state: {canUndo: boolean; canRedo: boolean}): void;
    onOutlineChange?(state: MarkdownOutlineState): void;
    onLink?(url: string): void;
    resolveResource?: MarkdownResourceResolver;
    onResourceUnavailable?(): void;
}

export interface MarkdownOutlineState {
    enabled: boolean;
    visible: boolean;
    available: boolean;
}

export interface MarkdownEditor {
    flush(): MarkdownEditorSnapshot;
    setValue(value: string): void;
    setMode(mode: MarkdownEditorMode): void;
    setTheme(theme: "light" | "dark"): void;
    setOutline(enabled: boolean): void;
    undo(): void;
    redo(): void;
    refreshResources(): void;
    insertImage(reference: string): boolean;
    focus(): void;
    destroy(): void;
}

export type MarkdownVditorFactory = (element: HTMLElement, options: Record<string, unknown>) => VditorInstance;

// Vditor 的声明向全局注入同名 Lute/IOptions；边界只引入运行时代码，避免污染主编辑器类型。
const createVditor: MarkdownVditorFactory = (element, settings) => {
    const dependency = require("vditor");
    const Constructor = dependency.default ?? dependency;
    return new Constructor(element, settings);
};

const languages = new Set(["de_DE", "en_US", "es_ES", "fr_FR", "ja_JP", "ko_KR", "pt_BR", "ru_RU", "sv_SE", "vi_VN", "zh_CN", "zh_TW"]);
export const markdownEditorLanguage = (language = "en_US"): string => {
    const normalized = language.replace("-", "_");
    if (languages.has(normalized)) return normalized;
    return [...languages].find(value => value.startsWith(normalized + "_")) ?? "en_US";
};

const renderedMethods = new Set(["Md2VditorDOM", "Md2VditorIRDOM", "SpinVditorDOM", "SpinVditorIRDOM",
    "HTML2VditorDOM", "HTML2VditorIRDOM", "Md2HTML", "VditorDOM2HTML", "VditorIRDOM2HTML"]);
const htmlInputMethods = new Set(["SpinVditorDOM", "SpinVditorIRDOM", "HTML2VditorDOM", "HTML2VditorIRDOM",
    "VditorDOM2Md", "VditorIRDOM2Md", "HTML2Md", "VditorDOM2HTML", "VditorIRDOM2HTML"]);

export const createMarkdownEditor = async (options: MarkdownEditorOptions,
    factory: MarkdownVditorFactory = createVditor,
): Promise<MarkdownEditor> => {
    const initialBytes = markdownByteLength(options.initialValue);
    if (initialBytes > MARKDOWN_RECOVERY_BYTES) throw new Error("Markdown recovery exceeds the supported limit");
    // 大文件直接使用源码文本框，避免初始化时先执行昂贵的富文本转换。
    let recoverySourceOnly = initialBytes > MARKDOWN_RENDER_BYTES;
    const {element} = options;
    const document = element.ownerDocument;
    const dark = options.theme === "dark";
    if (factory === createVditor) {
        // Vditor 在检查 cache.enable 前读取 getItem，并将禁用存储的原生 WebView 返回的 null 当作可用存储。
        // 独立页面没有浏览器存储，需要显式标记为不可用。
        Object.defineProperty(document.defaultView, "localStorage", {value: undefined, configurable: true});
    }
    const policy = createMarkdownResourcePolicy(document, options.resolveResource, options.onResourceUnavailable, options.sessionId);
    // 官方同步图标加载使用 XHR 和内联脚本；独立页面通过本地外部脚本满足严格 CSP。
    let iconSprite: SVGSVGElement;
    if (factory === createVditor && !document.getElementById("vditorIconScript")) {
        const script = document.createElement("script");
        script.id = "vditorIconScript";
        script.src = `${options.cdn}/dist/js/icons/ant.js`;
        await new Promise<void>((resolve, reject) => {
            script.onload = () => resolve();
            script.onerror = () => {script.remove(); reject(new Error("Markdown editor icons unavailable"));};
            document.head.append(script);
        });
        iconSprite = document.getElementById("vditor-icon-bold")?.closest("svg");
    }
    let instance: VditorInstance;
    let destroyed = false;
    let ready = false;
    let programmatic = false;
    let composing = false;
    let userPending = false;
    let edited = false;
    let scheduled = false;
    let notificationTimer: ReturnType<typeof setTimeout>;
    let maximumNotificationTimer: ReturnType<typeof setTimeout>;
    let inputVersion = 0;
    let cachedInput: {version: number; value: string};
    let generation = 0;
    let mode: MarkdownEditorMode = recoverySourceOnly ? "sv" : options.mode;
    let committed = options.initialValue;
    let rendered = "";
    let emitted: MarkdownEditorSnapshot = {content: committed, edited: false, composing: false};
    const listeners: Array<[string, EventListener]> = [];
    const historyButton = (action: "undo" | "redo") =>
        instance?.vditor.toolbar.element.querySelector<HTMLButtonElement>(`button[data-type="${action}"]`);
    const canHistory = (action: "undo" | "redo") => {
        const button = historyButton(action);
        return Boolean(button && !button.classList.contains("vditor-menu--disabled"));
    };
    let emittedHistory = {canUndo: false, canRedo: false};
    let finishInitialPreview: () => void;
    let outlineEnabled = options.outline ?? false;
    let emittedOutline: MarkdownOutlineState;
    const syncOutline = () => {
        if (destroyed || !ready) return;
        // Vditor 的源码模式与小于 520px 的窗口不展示大纲，保留开关意图供恢复时使用。
        const available = instance.getCurrentMode() !== "sv" && element.ownerDocument.defaultView.innerWidth >= 520;
        const visible = outlineEnabled && available;
        instance.vditor.options.outline.enable = outlineEnabled;
        if ((instance.vditor.outline.element.style.display === "block") !== visible) {
            instance.vditor.outline.toggle(instance.vditor, visible, false);
        }
        const state = {enabled: outlineEnabled, visible, available};
        if (emittedOutline && emittedOutline.enabled === state.enabled && emittedOutline.visible === state.visible &&
            emittedOutline.available === state.available) return;
        emittedOutline = state;
        options.onOutlineChange?.(state);
    };
    const notifyHistory = () => {
        if (destroyed) return;
        const state = {canUndo: canHistory("undo"), canRedo: canHistory("redo")};
        if (state.canUndo === emittedHistory.canUndo && state.canRedo === emittedHistory.canRedo) return;
        emittedHistory = state;
        options.onHistoryChange?.(state);
    };
    const historyObserver = new MutationObserver(notifyHistory);
    const normalizePopoverLabels = () => {
        // 只处理编辑器生成的浮动控件，正文属性、输入值和快捷键事件均保持原样。
        instance?.vditor.wysiwyg.popover?.querySelectorAll("[aria-label], [placeholder]").forEach(control => {
            for (const attribute of ["aria-label", "placeholder"]) {
                const value = control.getAttribute(attribute);
                if (value === null) continue;
                const label = markdownPopoverLabel(value);
                if (label !== value) control.setAttribute(attribute, label);
            }
        });
    };
    const popoverObserver = options.mobile ? new MutationObserver(normalizePopoverLabels) : undefined;
    const runHistory = (action: "undo" | "redo") => {
        if (destroyed || !ready || isComposing() || !canHistory(action)) return;
        const type = document.defaultView.navigator.userAgent.includes("iPhone") ? "touchstart" : "click";
        historyButton(action).dispatchEvent(new Event(type, {bubbles: true, cancelable: true}));
    };

    const activeSurface = () => instance?.vditor[instance.getCurrentMode()];
    const syncMode = (origin: "user" | "automatic" = "user") => {
        const next = instance.getCurrentMode();
        const changed = mode !== next;
        mode = next;
        rendered = instance.getValue();
        cachedInput = undefined;
        userPending = false;
        syncOutline();
        if (changed) {
            // 切换模式后立即记录基线，首笔输入不能抢在延迟快照之前覆盖它。
            instance.vditor.undo.addToUndoStack(instance.vditor);
            options.onModeChange?.(next, origin);
        }
    };
    const inEditor = (event: Event) => event.target instanceof Node &&
        (Boolean(activeSurface()?.element.contains(event.target)) || (event.target instanceof Element &&
            Boolean(event.target.closest(".vditor-panel, .vditor-hint")) && element.contains(event.target)));
    const isComposing = () => composing || Boolean(activeSurface()?.composingLock);

    const flush = (): MarkdownEditorSnapshot => {
        if (destroyed) return {content: committed, edited, composing: false};
        if (!ready || isComposing()) return {content: committed, edited, composing: isComposing()};
        if (instance.getCurrentMode() !== mode) {
            syncMode();
        }
        if (userPending) {
            const value = cachedInput?.version === inputVersion ? cachedInput.value : instance.getValue();
            if (value !== rendered) {
                committed = value;
                rendered = value;
                edited = true;
                userPending = false;
                const large = markdownByteLength(committed) > MARKDOWN_RENDER_BYTES;
                updateSourceOnly(large);
                if (large && mode !== "sv") activateSource();
            }
        }
        return {content: committed, edited, composing: false};
    };

    const updateSourceOnly = (value: boolean) => {
        const changed = recoverySourceOnly !== value;
        recoverySourceOnly = value;
        if (changed) instance.setPreviewMode(value ? "editor" : "both");
        // 关闭后调用受控渲染入口清掉已有预览计时器，其隐藏分支不会解析正文。
        if (value) instance.vditor.preview?.render(instance.vditor);
        if (changed) options.onSourceOnlyChange?.(value);
    };
    const activateSource = () => {
        updateSourceOnly(true);
        if (instance.getCurrentMode() === "sv") return;
        const wasProgrammatic = programmatic;
        programmatic = true;
        try {
            const button = element.querySelector<HTMLButtonElement>('button[data-mode="sv"]');
            const type = document.defaultView.navigator.userAgent.includes("iPhone") ? "touchstart" : "click";
            button.dispatchEvent(new Event(type, {bubbles: true, cancelable: true}));
            syncMode("automatic");
        } finally {programmatic = wasProgrammatic;}
    };

    const notify = () => {
        if (destroyed || !ready || programmatic) return;
        const snapshot = flush();
        if (snapshot.content === emitted.content && snapshot.edited === emitted.edited && snapshot.composing === emitted.composing) {
            if (!snapshot.composing) options.onEditPending?.(false);
            return;
        }
        emitted = snapshot;
        options.onEdit(snapshot);
        if (!snapshot.composing) options.onEditPending?.(false);
    };

    const allowModeSwitch = (nextMode: MarkdownEditorMode) => {
        notify();
        if (markdownByteLength(committed) <= MARKDOWN_RENDER_BYTES) return true;
        if (nextMode === "sv") {
            recoverySourceOnly = true;
            instance.setPreviewMode("editor");
            return true;
        }
        options.onModeChange?.(instance.getCurrentMode(), "automatic");
        options.onSourceOnlyChange?.(true);
        return false;
    };

    const schedule = () => {
        if (destroyed || programmatic) return;
        clearTimeout(notificationTimer);
        scheduled = true;
        const expectedGeneration = generation;
        const deliver = () => {
            clearTimeout(notificationTimer);
            clearTimeout(maximumNotificationTimer);
            maximumNotificationTimer = undefined;
            scheduled = false;
            if (expectedGeneration === generation) notify();
        };
        // Vditor commits its undo/input snapshot after 250 ms. Reuse that text
        // instead of serializing the whole DOM again on every keystroke.
        notificationTimer = setTimeout(deliver, 300);
        if (!maximumNotificationTimer) maximumNotificationTimer = setTimeout(deliver, 1000);
    };

    const markUserInput = () => {
        if (destroyed || programmatic || !ready) return;
        inputVersion++;
        cachedInput = undefined;
        userPending = true;
        options.onEditPending?.(true);
        schedule();
    };

    const listen = (type: string, handler: EventListener) => {
        element.addEventListener(type, handler, true);
        listeners.push([type, handler]);
    };

    const followLink = (link: Element) => {
        const destination = markdownLinkDestination(link, policy.originalAttribute);
        if (destination) options.onLink?.(destination);
    };

    // 输入监听只登记意图，合并序列化开销；关闭与另存为可同步 flush 最新已提交内容。
    listen("input", event => {
        if (!inEditor(event)) return;
        // 捕获阶段先关闭大源码的预览，阻止 Vditor 的目标监听器调度全文解析。
        if (event.target instanceof HTMLTextAreaElement && markdownByteLength(event.target.value) > MARKDOWN_RENDER_BYTES) updateSourceOnly(true);
        markUserInput();
    });
    listen("compositionstart", event => {
        if (!inEditor(event) || programmatic) return;
        composing = true;
        options.onEditPending?.(true);
        notify();
    });
    listen("compositionend", event => {
        if (!inEditor(event) || programmatic) return;
        composing = false;
        markUserInput();
    });
    for (const type of ["paste", "cut", "drop"]) listen(type, event => {
        if (!inEditor(event)) return;
        if ((type === "drop" && (event as DragEvent).dataTransfer?.files.length) ||
            (type === "paste" && (event as ClipboardEvent).clipboardData?.files.length)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            options.onResourceUnavailable?.();
            return;
        }
        if (type === "paste" || type === "drop") {
            const clipboard = type === "paste" ? (event as ClipboardEvent).clipboardData : (event as DragEvent).dataTransfer;
            const addition = clipboard?.getData("text/plain") || clipboard?.getData("text/html") || "";
            const surface = activeSurface()?.element;
            const selection = surface instanceof HTMLTextAreaElement ? surface.value.slice(surface.selectionStart, surface.selectionEnd) :
                document.getSelection()?.toString() ?? "";
            const currentBytes = markdownByteLength(flush().content);
            const nextBytes = currentBytes - Math.min(currentBytes, markdownByteLength(selection)) + markdownByteLength(addition);
            if (nextBytes > MARKDOWN_DOCUMENT_BYTES) {
                event.preventDefault();
                event.stopImmediatePropagation();
                options.onContentTooLarge?.();
                return;
            }
            if (nextBytes > MARKDOWN_RENDER_BYTES) {
                updateSourceOnly(true);
                if (instance.getCurrentMode() !== "sv") {
                    event.preventDefault(); event.stopImmediatePropagation();
                    activateSource(); markUserInput(); instance.insertMD(addition);
                    return;
                }
            }
        }
        markUserInput();
    });
    listen("keydown", event => {
        if (!inEditor(event)) return;
        const keyboard = event as KeyboardEvent;
        const modeKey = /^Digit[789]$/.test(keyboard.code) ? keyboard.code.slice(-1) : keyboard.key;
        if (keyboard.altKey && (keyboard.ctrlKey || keyboard.metaKey) && /^[789]$/.test(modeKey)) {
            if (isComposing()) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            const nextMode = modeKey === "7" ? "wysiwyg" : modeKey === "8" ? "ir" : "sv";
            if (!allowModeSwitch(nextMode)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            queueMicrotask(() => {
                if (!destroyed && ready) {
                    syncMode();
                }
            });
        } else if (!keyboard.isComposing && (keyboard.key.length === 1 ||
            /^(?:Backspace|Delete|Enter|Tab|Arrow(?:Left|Right|Up|Down))$/.test(keyboard.key))) {
            // Vditor 的按键命令可能直接改写正文并阻止原生 input，方向键也可能插入空段落。
            // 提前登记输入意图，正文是否改变仍由 flush 与渲染基线比较决定。
            markUserInput();
        }
    });
    const click = (event: Event) => {
        if (programmatic) return;
        if (!(event.target instanceof Element)) return;
        const link = event.target.closest("a");
        if (link && element.contains(link)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            followLink(link);
            return;
        }
        const modeButton = event.target.closest<HTMLButtonElement>("button[data-mode]");
        if (modeButton && element.contains(modeButton)) {
            if (isComposing()) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            if (!allowModeSwitch(modeButton.dataset.mode as MarkdownEditorMode)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            queueMicrotask(() => {
                if (destroyed || !ready) return;
                syncMode();
            });
        } else if (event.target.closest(".vditor-toolbar, .vditor-panel, .vditor-hint") ||
            (inEditor(event) && event.target.matches('input[type="checkbox"]'))) {
            markUserInput();
        }
    };
    listen("click", click);
    listen("touchstart", click);

    const observer = new MutationObserver(() => policy.hydrate(element));
    observer.observe(element, {childList: true, subtree: true, attributes: true,
        attributeFilter: ["src", "data-markdown-preserved"]});

    const clearInternalTimers = () => {
        if (!instance?.vditor) return;
        for (const surface of [instance.vditor.ir, instance.vditor.wysiwyg, instance.vditor.sv]) {
            clearTimeout(surface.processTimeoutId);
            clearTimeout(surface.afterRenderTimeoutId);
            clearTimeout(surface.hlToolbarTimeoutId);
        }
        clearTimeout(instance.vditor.hint?.timeId);
    };

    const setValue = (value: string) => {
        if (destroyed || !ready) return;
        programmatic = true;
        generation++;
        clearTimeout(notificationTimer);
        clearTimeout(maximumNotificationTimer);
        maximumNotificationTimer = undefined;
        scheduled = false;
        clearInternalTimers();
        policy.reset();
        composing = false;
        userPending = false;
        cachedInput = undefined;
        edited = false;
        committed = value;
        if (markdownByteLength(value) > MARKDOWN_RENDER_BYTES) activateSource();
        instance.setValue(value, true);
        if (markdownByteLength(value) <= MARKDOWN_RENDER_BYTES) updateSourceOnly(false);
        rendered = instance.getValue();
        emitted = {content: value, edited: false, composing: false};
        programmatic = false;
        policy.hydrate(element);
    };

    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        generation++;
        clearTimeout(notificationTimer);
        clearTimeout(maximumNotificationTimer);
        clearInternalTimers();
        observer.disconnect();
        historyObserver.disconnect();
        popoverObserver?.disconnect();
        element.ownerDocument.defaultView.removeEventListener("resize", syncOutline);
        policy.destroy();
        listeners.forEach(([type, handler]) => element.removeEventListener(type, handler, true));
        if (instance?.vditor) instance.destroy();
        if (iconSprite) {
            iconSprite.remove();
            document.getElementById("vditorIconScript")?.remove();
        }
    };

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            destroy();
            reject(new Error("Markdown editor initialization timed out"));
        }, 15000);
        try {
            instance = factory(element, {
                value: "", mode, cdn: options.cdn, _lutePath: options.lutePath,
                lang: markdownEditorLanguage(options.lang), theme: dark ? "dark" : "classic",
                cache: {enable: false}, undoDelay: 250, height: "100%", minHeight: 0,
                outline: {enable: outlineEnabled, position: "left"},
                toolbar: ["headings", "bold", "italic", "link", "list", "undo", "redo", "edit-mode"],
                preview: {mode: recoverySourceOnly ? "editor" : "both", actions: [], delay: 150, markdown: {sanitize: true},
                    theme: {current: dark ? "dark" : "light"}, hljs: {style: dark ? "github-dark" : "github"},
                    math: {engine: "KaTeX"}, render: {media: {enable: false}}, transform: policy.sanitize,
                    parse: () => {
                        policy.hydrate(element);
                        if (finishInitialPreview) {
                            const complete = finishInitialPreview;
                            finishInitialPreview = undefined;
                            queueMicrotask(complete);
                        }
                    }},
                link: {isOpen: false, click: followLink}, image: {isPreview: false},
                input: (value: string) => {
                    if (!userPending || programmatic || isComposing()) return;
                    cachedInput = {version: inputVersion, value};
                    if (!scheduled) schedule();
                },
                after: () => queueMicrotask(() => {
                    try {
                        if (destroyed) return;
                        if (instance.version !== "4.0.2-alpha.1") throw new Error("Unsupported Markdown editor version");
                        if (element.id) instance.vditor.outline.element.id = `${element.id}-outline`;
                        // 内部控件提供模式与快捷键入口，历史操作由标题行调用同一套撤销记录。
                        instance.vditor.toolbar.element.hidden = true;
                        if (popoverObserver && instance.vditor.wysiwyg.popover) {
                            popoverObserver.observe(instance.vditor.wysiwyg.popover, {childList: true, subtree: true,
                                attributes: true, attributeFilter: ["aria-label", "placeholder"]});
                            normalizePopoverLabels();
                        }
                        historyObserver.observe(instance.vditor.toolbar.element, {subtree: true, attributes: true, attributeFilter: ["class"]});
                        const lute = instance.vditor.lute;
                        const getEmojis = lute.GetEmojis.bind(lute);
                        lute.GetEmojis = () => markdownUnicodeEmojiHints(getEmojis());
                        instance.vditor.options.hint.emoji = markdownUnicodeEmojiHints(instance.vditor.options.hint.emoji);
                        new Set([...renderedMethods, ...htmlInputMethods]).forEach(name => {
                            const original = lute[name];
                            if (typeof original !== "function") return;
                            lute[name] = (...args: string[]) => {
                                if (htmlInputMethods.has(name)) args[0] = policy.restore(args[0]);
                                const result = original.apply(lute, args);
                                return renderedMethods.has(name) ? policy.sanitize(result) : result;
                            };
                        });
                        ready = true;
                        if (mode === "sv" && !recoverySourceOnly && options.initialValue.trim()) {
                            finishInitialPreview = () => {clearTimeout(timeout); resolve();};
                        }
                        setValue(options.initialValue);
                        syncOutline();
                        notifyHistory();
                        if (recoverySourceOnly) {
                            options.onModeChange?.("sv", "automatic");
                            options.onSourceOnlyChange?.(true);
                        }
                        if (!finishInitialPreview) {clearTimeout(timeout); resolve();}
                    } catch (error) {
                        clearTimeout(timeout);
                        destroy();
                        reject(error);
                    }
                }),
            });
        } catch (error) {
            clearTimeout(timeout);
            destroy();
            reject(error);
        }
    });

    element.ownerDocument.defaultView.addEventListener("resize", syncOutline);
    return {
        flush,
        setValue,
        setMode(nextMode) {
            if (destroyed || isComposing()) return;
            if (!allowModeSwitch(nextMode)) return;
            if (instance.getCurrentMode() === nextMode) {options.onModeChange?.(nextMode, "user"); return;}
            const button = element.querySelector<HTMLButtonElement>(`button[data-mode="${nextMode}"]`);
            if (!button) throw new Error("Markdown editor mode unavailable");
            programmatic = true;
            const type = document.defaultView.navigator.userAgent.includes("iPhone") ? "touchstart" : "click";
            button.dispatchEvent(new Event(type, {bubbles: true, cancelable: true}));
            syncMode();
            programmatic = false;
            policy.hydrate(element);
        },
        setTheme(theme) {
            if (!destroyed) instance.setTheme(theme === "dark" ? "dark" : "classic", theme, theme === "dark" ? "github-dark" : "github");
        },
        setOutline(enabled) {
            if (destroyed || !ready || isComposing()) return;
            outlineEnabled = enabled;
            syncOutline();
        },
        undo() {runHistory("undo");},
        redo() {runHistory("redo");},
        refreshResources() { if (!destroyed) policy.refresh(element); },
        insertImage(reference) {
            if (destroyed || isComposing() || !isRelativeMarkdownResource(reference) || /[<>]/.test(reference)) return false;
            markUserInput();
            instance.insertMD(`![](<${reference}>)`);
            policy.hydrate(element);
            return true;
        },
        focus() { if (!destroyed) instance.focus(); },
        destroy,
    };
};
