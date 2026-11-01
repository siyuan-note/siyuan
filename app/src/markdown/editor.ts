import type {MarkdownEditorSnapshot} from "./contracts";
import {MARKDOWN_DOCUMENT_BYTES, MARKDOWN_RENDER_BYTES, MARKDOWN_RECOVERY_BYTES, markdownByteLength} from "./limits";
import {createMarkdownResourcePolicy, isExternalMarkdownLink, isRelativeMarkdownResource, MarkdownResourceResolver} from "./resourcePolicy";

export type MarkdownEditorMode = "ir" | "wysiwyg" | "sv";

interface VditorSurface {
    element: HTMLElement;
    composingLock?: boolean;
    processTimeoutId?: number;
    afterRenderTimeoutId?: number;
    hlToolbarTimeoutId?: number;
}

interface VditorInstance {
    version: string;
    vditor: {
        currentMode: MarkdownEditorMode;
        lute: Record<string, (...args: string[]) => string>;
        ir: VditorSurface;
        wysiwyg: VditorSurface;
        sv: VditorSurface;
        toolbar: {element: HTMLElement};
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
    onEdit(snapshot: MarkdownEditorSnapshot): void;
    onEditPending?(pending: boolean): void;
    onContentTooLarge?(): void;
    onModeChange?(mode: MarkdownEditorMode): void;
    onSourceOnlyChange?(sourceOnly: boolean): void;
    onLink?(url: string): void;
    resolveResource?: MarkdownResourceResolver;
    onResourceUnavailable?(): void;
}

export interface MarkdownEditor {
    flush(): MarkdownEditorSnapshot;
    setValue(value: string): void;
    setMode(mode: MarkdownEditorMode): void;
    setTheme(theme: "light" | "dark"): void;
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
        // Vditor 4.0.1 reads getItem before testing cache.enable and treats null
        // from storage-disabled native WebViews as an available Storage object.
        // This independent page has no browser storage; make that explicit.
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

    const activeSurface = () => instance?.vditor[instance.getCurrentMode()];
    const syncMode = () => {
        const next = instance.getCurrentMode();
        const changed = mode !== next;
        mode = next;
        rendered = instance.getValue();
        cachedInput = undefined;
        userPending = false;
        if (changed) options.onModeChange?.(next);
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
            syncMode();
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
        options.onModeChange?.(instance.getCurrentMode());
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
        const destination = policy.originalAttribute(link, "href");
        if (destination && isExternalMarkdownLink(destination)) options.onLink?.(destination);
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
        } else if ((keyboard.ctrlKey || keyboard.metaKey) && /^(?:[biklmuyz]|Enter)$/i.test(keyboard.key)) {
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
                toolbar: ["headings", "bold", "italic", "link", "list", "undo", "redo", "edit-mode"],
                preview: {mode: recoverySourceOnly ? "editor" : "both", actions: [], delay: 150, markdown: {sanitize: true},
                    theme: {current: dark ? "dark" : "light"}, hljs: {style: dark ? "github-dark" : "github"},
                    math: {engine: "KaTeX"}, render: {media: {enable: false}}, transform: policy.sanitize,
                    parse: () => policy.hydrate(element)},
                link: {isOpen: false, click: followLink}, image: {isPreview: false},
                input: (value: string) => {
                    if (!userPending || programmatic || isComposing()) return;
                    cachedInput = {version: inputVersion, value};
                    if (!scheduled) schedule();
                },
                after: () => queueMicrotask(() => {
                    try {
                        if (destroyed) return;
                        if (instance.version !== "4.0.1") throw new Error("Unsupported Markdown editor version");
                        // Retain Vditor's mode controls for its official switching path;
                        // the shared page supplies the visible selector on every platform.
                        const modeMenu = instance.vditor.toolbar.element.querySelector("button[data-mode]")
                            ?.closest<HTMLElement>(".vditor-toolbar__item");
                        if (modeMenu) modeMenu.hidden = true;
                        const lute = instance.vditor.lute;
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
                        setValue(options.initialValue);
                        if (recoverySourceOnly) {
                            options.onModeChange?.("sv");
                            options.onSourceOnlyChange?.(true);
                        }
                        clearTimeout(timeout);
                        resolve();
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

    return {
        flush,
        setValue,
        setMode(nextMode) {
            if (destroyed || isComposing()) return;
            if (!allowModeSwitch(nextMode)) return;
            if (instance.getCurrentMode() === nextMode) return;
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
