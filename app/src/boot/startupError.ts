import bundledLanguages from "../../appearance/boot/startup-languages.json";

const stageKeys = {
    page: "startupStagePage",
    configuration: "startupStageConfiguration",
    engine: "startupStageEngine",
    plugins: "startupStagePlugins",
    storage: "startupStageStorage",
    language: "startupStageLanguage",
    interface: "startupStageInterface",
} as const;

export type TStartupStage = keyof typeof stageKeys;
type TStartupStrings = typeof bundledLanguages.en;
const languages: Record<string, TStartupStrings> = bundledLanguages;

export const resolveStartupLanguage = (preferred: readonly string[]) => {
    for (const value of preferred) {
        const normalized = value.replace(/_/g, "-").toLowerCase();
        const exact = Object.keys(languages).find(key => key.toLowerCase() === normalized);
        if (exact) return exact;
        if (normalized.startsWith("zh")) return /(?:hant|tw|hk|mo)/.test(normalized) ? "zh-TW" : "zh-CN";
        const base = normalized.split("-")[0];
        if (base === "pt") return "pt-BR";
        if (languages[base]) return base;
    }
    return "en";
};

export const setStartupStage = (stage: TStartupStage) =>
    window.dispatchEvent(new CustomEvent("siyuan-startup-stage", {detail: stage}));

export const setStartupLanguage = (language: string) =>
    window.dispatchEvent(new CustomEvent("siyuan-startup-language", {detail: language}));

export const reportStartupError = (error: unknown) => {
    console.error("Mobile startup failed:", error);
    window.dispatchEvent(new CustomEvent("siyuan-startup-error", {detail: error}));
};

export const completeStartup = () => window.dispatchEvent(new Event("siyuan-startup-ready"));

// 启动回调自行接住异步错误，不改变通用请求工具的回调语义。
export const guardStartup = <T>(callback: (value: T) => unknown) => (value: T) => {
    return Promise.resolve().then(() => callback(value)).catch(reportStartupError);
};

export const installStartupError = (target: Window, version: string, timeout = 30000) => {
    const document = target.document;
    let language = resolveStartupLanguage(target.navigator.languages || [target.navigator.language]);
    let stage: TStartupStage = "page";
    let failure: {stage: TStartupStage; error: string} | undefined;
    let ready = false;
    let timer: number;

    const render = () => {
        if (!failure || ready || !document.body) return;
        const strings = languages[language];
        let loading = document.getElementById("loading");
        if (!loading) {
            loading = document.createElement("div");
            loading.id = "loading";
            document.body.appendChild(loading);
        }
        loading.className = "b3-dialog b3-dialog--open startup-error";
        loading.style.removeProperty("z-index");
        loading.setAttribute("role", "alertdialog");
        loading.setAttribute("aria-modal", "true");
        loading.setAttribute("aria-labelledby", "startupErrorTitle");
        loading.lang = language;
        loading.dir = ["ar", "he"].includes(language) ? "rtl" : "ltr";
        const container = document.createElement("div");
        container.className = "b3-dialog__container startup-error__container";
        const title = document.createElement("div");
        title.id = "startupErrorTitle";
        title.className = "b3-dialog__header";
        title.textContent = strings.startupFailed;
        const content = document.createElement("div");
        content.className = "b3-dialog__content";
        const phase = document.createElement("p");
        phase.textContent = strings.startupStage.replace("${stage}", strings[stageKeys[failure.stage]]);
        const details = document.createElement("pre");
        details.className = "startup-error__details";
        details.tabIndex = 0;
        details.dir = "ltr";
        details.textContent = `SiYuan ${version}\nstage=${failure.stage}\nlanguage=${language}\n${target.navigator.userAgent}\n\n${failure.error}`;
        content.append(phase, details);
        const actions = document.createElement("div");
        actions.className = "b3-dialog__action startup-error__actions";
        const reload = document.createElement("button");
        reload.type = "button";
        reload.className = "b3-button startup-error__button";
        reload.textContent = strings.startupReload;
        reload.addEventListener("click", () => target.location.reload());
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "b3-button b3-button--outline startup-error__button";
        copy.textContent = strings.startupCopy;
        copy.addEventListener("click", async () => {
            const selection = target.getSelection();
            const range = document.createRange();
            range.selectNodeContents(details);
            selection?.removeAllRanges();
            selection?.addRange(range);
            let copied = false;
            try {
                copied = document.execCommand("copy");
            } catch (_error) {
                // 系统禁用旧复制命令时继续尝试异步剪贴板。
            }
            if (!copied) {
                try {
                    await target.navigator.clipboard.writeText(details.textContent);
                    copied = true;
                } catch (_error) {
                    // 保留已选中的文本，允许使用系统复制菜单。
                }
            }
            copy.textContent = copied ? strings.copied : strings.startupCopyFailed;
        });
        actions.append(reload, copy);
        container.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Tab") return;
            const elements: HTMLElement[] = [details, reload, copy];
            const index = elements.indexOf(document.activeElement as HTMLElement);
            event.preventDefault();
            elements[(index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length].focus();
        });
        container.append(title, content, actions);
        loading.replaceChildren(container);
        reload.focus();
    };

    const fail = (error: unknown) => {
        if (ready || failure) return;
        target.clearTimeout(timer);
        const value = error && typeof error === "object" && "stack" in error ? error.stack : error;
        failure = {stage, error: String(value || error).slice(0, 20000)};
        document.documentElement.setAttribute("data-startup-state", "failed");
        render();
    };
    const armTimeout = () => {
        target.clearTimeout(timer);
        if (!ready && !failure && !document.hidden) {
            timer = target.setTimeout(() => fail(languages[language].startupTimeout), timeout);
        }
    };
    const setStage = (event: CustomEvent<TStartupStage>) => {
        if (!(event.detail in stageKeys)) return;
        stage = event.detail;
        document.documentElement.setAttribute("data-startup-stage", stage);
        armTimeout();
    };
    const setLanguage = (event: CustomEvent<string>) => {
        language = resolveStartupLanguage([event.detail]);
        render();
    };
    const onError = (event: ErrorEvent) => {
        if (event.target !== target) {
            const element = event.target as HTMLScriptElement;
            // 只有主程序资源属于启动必需项，图片和扩展资源失败不终止启动。
            if (element?.tagName !== "SCRIPT" || !element.src.includes("/stage/build/mobile/")) return;
            fail(new Error(new URL(element.src, target.location.href).pathname));
        } else {
            fail(event.error || `${event.message}\n${event.filename}:${event.lineno}:${event.colno}`);
        }
    };
    const onRejection = (event: PromiseRejectionEvent) => fail(event.reason);
    const onFailure = (event: CustomEvent<unknown>) => fail(event.detail);
    const complete = () => {
        ready = true;
        target.clearTimeout(timer);
        document.documentElement.setAttribute("data-startup-state", "ready");
        const errorLayer = document.querySelector(".startup-error");
        if (errorLayer) {
            errorLayer.remove();
            document.body.style.removeProperty("background-color");
        }
        dispose();
    };
    const dispose = () => {
        target.clearTimeout(timer);
        target.removeEventListener("error", onError, true);
        target.removeEventListener("unhandledrejection", onRejection);
        target.removeEventListener("siyuan-startup-stage", setStage);
        target.removeEventListener("siyuan-startup-language", setLanguage);
        target.removeEventListener("siyuan-startup-error", onFailure);
        target.removeEventListener("siyuan-startup-ready", complete);
        document.removeEventListener("DOMContentLoaded", render);
        document.removeEventListener("visibilitychange", armTimeout);
    };
    document.documentElement.setAttribute("data-startup-state", "loading");
    document.documentElement.setAttribute("data-startup-stage", stage);
    target.addEventListener("error", onError, true);
    target.addEventListener("unhandledrejection", onRejection);
    target.addEventListener("siyuan-startup-stage", setStage);
    target.addEventListener("siyuan-startup-language", setLanguage);
    target.addEventListener("siyuan-startup-error", onFailure);
    target.addEventListener("siyuan-startup-ready", complete);
    document.addEventListener("DOMContentLoaded", render);
    document.addEventListener("visibilitychange", armTimeout);
    armTimeout();
    return {fail, complete, dispose};
};
