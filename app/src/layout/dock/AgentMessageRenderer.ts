import {escapeHtml} from "../../util/escape";
import {setCodeTheme} from "../../protyle/render/util";
import {addScript} from "../../protyle/util/addScript";
import {Constants} from "../../constants";
import {mathRender} from "../../protyle/render/mathRender";
import {showMessage} from "../../dialog/message";
import type {App} from "../../index";
import {processSiYuanUri} from "../../editor/openLink";

export const renderTodoList = (result: string): string => {
    const L = window.siyuan.languages;
    const lines = result.split("\n");
    let html = '<div class="agent-chat__tool-card agent-chat__tool-card--todo">' +
    '<div class="agent-chat__todo-header">' +
        '<svg class="agent-chat__tool-icon"><use xlink:href="#iconList"></use></svg>' +
        '<span class="agent-chat__tool-title">' + (L.agentTodoList || "Todo List") + "</span>" +
    "</div>" +
    '<div class="agent-chat__todo-items">';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("- [x]")) {
            html += '<div class="agent-chat__todo-item agent-chat__todo-item--completed"><svg class="agent-chat__todo-status"><use xlink:href="#iconCheck"></use></svg>' + escapeHtml(line.substring(5).trim()) + "</div>";
        } else if (line.startsWith("- [/]")) {
            html += '<div class="agent-chat__todo-item agent-chat__todo-item--in-progress"><svg class="agent-chat__todo-status"><use xlink:href="#iconRefresh"></use></svg>' + escapeHtml(line.substring(5).trim()) + "</div>";
        } else if (line.startsWith("- [-]")) {
            html += '<div class="agent-chat__todo-item agent-chat__todo-item--cancelled"><svg class="agent-chat__todo-status"><use xlink:href="#iconCloseRound"></use></svg>' + escapeHtml(line.substring(5).trim()) + "</div>";
        } else if (line.startsWith("- [ ]")) {
            html += '<div class="agent-chat__todo-item agent-chat__todo-item--pending"><svg class="agent-chat__todo-status"><use xlink:href="#iconUncheck"></use></svg>' + escapeHtml(line.substring(5).trim()) + "</div>";
        }
    }
    html += "</div></div>";
    return html;
};

// hasModel=false 时渲染"未配置模型"提示块替代示例，避免用户点击示例后卡死。
export const renderWelcomeHTML = (hasModel = true): string => {
    const L = window.siyuan.languages;
    if (!hasModel) {
        return '<div class="agent-welcome">' +
            '<div class="agent-welcome__greeting">' + (L.agentWelcomeGreeting || "Hello, I am SiYuan Agent") + "</div>" +
            '<div class="agent-welcome__no-model">' +
                '<div class="agent-welcome__no-model-title">' + (L.agentNoModel || "No model configured") + "</div>" +
                '<div class="agent-welcome__no-model-tip">' + (L.agentNoModelTip || "Please configure a provider and model in Settings - AI first.") + "</div>" +
                '<button class="b3-button agent-welcome__go-setting" data-type="go-ai-setting">' + (L.agentGoToSetting || "Go to Settings") + "</button>" +
            "</div>" +
        "</div>";
    }
    return '<div class="agent-welcome">' +
        '<div class="agent-welcome__greeting">' + (L.agentWelcomeGreeting || "Hello, I am SiYuan Agent") + "</div>" +
        '<div class="agent-welcome__examples">' +
            '<div class="agent-welcome__example" data-text="' + escapeHtml(L.agentExample1 || "") + '">' + (L.agentExample1 || "") + "</div>" +
            '<div class="agent-welcome__example" data-text="' + escapeHtml(L.agentExample2 || "") + '">' + (L.agentExample2 || "") + "</div>" +
            '<div class="agent-welcome__example" data-text="' + escapeHtml(L.agentExample3 || "") + '">' + (L.agentExample3 || "") + "</div>" +
        "</div>" +
    "</div>";
};

export const renderQuestionCardHTML = (rawQuestions: Array<Record<string, unknown>>, questionID: string): string => {
    const L = window.siyuan.languages;
    let html = '<div class="agent-chat__question-card">';
    for (let qi = 0; qi < rawQuestions.length; qi++) {
        const q = rawQuestions[qi];
        const header = (q.header as string) || "";
        const question = (q.question as string) || "";
        const options = q.options as Array<Record<string, unknown>> || [];
        const multiple = q.multiple as boolean || false;
        const custom = q.custom as boolean !== false;

        html += '<div class="agent-chat__question-item">';
        if (header) {
            html += '<div class="agent-chat__question-header">' + escapeHtml(header) + "</div>";
        }
        if (question) {
            html += '<div class="agent-chat__question-text">' + escapeHtml(question) + "</div>";
        }
        html += '<div class="agent-chat__question-options" data-qi="' + qi + '">';
        const inputType = multiple ? "checkbox" : "radio";
        const inputName = "q_" + questionID + "_" + qi;
        for (let oi = 0; oi < options.length; oi++) {
            const opt = options[oi];
            const label = (opt.label as string) || "";
            const desc = (opt.description as string) || "";
            html += '<label class="agent-chat__question-option">' +
                '<input type="' + inputType + '" name="' + inputName + '" value="' + escapeHtml(label) + '">' +
                '<span class="agent-chat__question-option-label">' + escapeHtml(label) + "</span>";
            if (desc) {
                html += '<span class="agent-chat__question-option-desc">' + escapeHtml(desc) + "</span>";
            }
            html += "</label>";
        }
        if (custom) {
            html += '<input class="agent-chat__question-custom" placeholder="' + (L.agentQuestionCustom || "Type your own answer...") + '" data-qi="' + qi + '">';
        }
        html += "</div></div>";
    }
    html += '<div class="agent-chat__question-submit">' +
        '<button class="b3-button b3-button--text agent-chat__question-submit-btn">' +
        (L.agentQuestionSubmit || "Submit") + "</button>" +
    "</div></div>";
    return html;
};

export const renderRetryCardHTML = (attempt: number, maxRetries: number): string => {
    return '<div class="agent-chat__thinking-card">' +
    '<div class="agent-chat__thinking-header">' +
        '<span class="agent-chat__thinking-text">' + escapeHtml("Retrying (" + attempt + "/" + maxRetries + ")...") + "</span>" +
    "</div>" +
"</div>";
};

export const renderToolsLineHTML = (newTools: Array<{name: string}>): string => {
    let detailLines = "<div class=\"agent-chat__thinking-tools-line\"><span class=\"agent-chat__thinking-summary\">Tool calls:</span>";
    for (let i = 0; i < newTools.length; i++) {
        detailLines += '<span class="agent-chat__thinking-tool">' + escapeHtml(newTools[i].name) + "</span>";
    }
    detailLines += "</div>";
    return detailLines;
};

// createThinkingCardElement 用于流式过程中的单个思考卡片。
// 工具调用只接收名字列表（arguments/result 在 assistant entry 存一份）；
// 标题文本由调用方传入（已通过 i18n 从 duration 生成）。
export const createThinkingCardElement = (step: {reasoning: string; text: string; toolNames?: string[]; reasoningContent: string}): HTMLElement => {
    let detail = "";
    if (step.toolNames && step.toolNames.length > 0) {
        detail += '<div class="agent-chat__thinking-tools-line"><span class="agent-chat__thinking-summary">Tool calls:</span>';
        for (let j = 0; j < step.toolNames.length; j++) {
            detail += '<span class="agent-chat__thinking-tool">' + escapeHtml(step.toolNames[j]) + "</span>";
        }
        detail += "</div>";
    }
    if (step.reasoningContent) {
        detail += "<div>" + escapeHtml(step.reasoningContent) + "</div>";
    }

    const el = document.createElement("div");
    el.className = "agent-chat__msg agent-chat__msg--thinking agent-chat__msg--thinking-done";
    el.innerHTML = '<div class="agent-chat__thinking-card">' +
    '<div class="agent-chat__thinking-header">' +
        '<span class="agent-chat__thinking-arrow">' +
            '<svg class="agent-chat__thinking-arrow--expand"><use xlink:href="#iconExpand"></use></svg>' +
            '<svg class="agent-chat__thinking-arrow--contract fn__none"><use xlink:href="#iconContract"></use></svg>' +
        "</span>" +
        '<span class="agent-chat__thinking-text">' + escapeHtml(step.text) + "</span>" +
    "</div>" +
    '<div class="agent-chat__thinking-body">' +
        detail +
    "</div>" +
"</div>";
    return el;
};

export const bindThinkingCardToggle = (el: HTMLElement): void => {
    const header = el.querySelector(".agent-chat__thinking-header") as HTMLElement;
    const body = el.querySelector(".agent-chat__thinking-body") as HTMLElement;
    const expandIcon = el.querySelector(".agent-chat__thinking-arrow--expand") as HTMLElement;
    const contractIcon = el.querySelector(".agent-chat__thinking-arrow--contract") as HTMLElement;
    if (!header || !body || !expandIcon || !contractIcon) { return; }
    header.addEventListener("click", () => {
        const isExpanded = body.classList.toggle("agent-chat__thinking-body--expanded");
        expandIcon.classList.toggle("fn__none", isExpanded);
        contractIcon.classList.toggle("fn__none", !isExpanded);
    });
};

export const highlightCodeBlocks = (container: HTMLElement): void => {
    const codeElements: Array<{el: HTMLElement; language: string}> = [];
    container.querySelectorAll("pre code:not(.hljs)").forEach((codeEl) => {
        const el = codeEl as HTMLElement;
        let language = "";
        for (const cls of el.className.split(" ")) {
            if (cls.startsWith("language-")) {
                language = cls.replace("language-", "");
                break;
            }
        }
        if (!language) {
            language = el.parentElement?.getAttribute("data-language") || "";
        }
        if (language) {
            codeElements.push({el, language});
        }
    });
    if (codeElements.length === 0) { return; }

    const process = () => {
        codeElements.forEach(({el, language}) => {
            if (!window.hljs.getLanguage(language)) {
                language = "plaintext";
            }
            el.classList.add("hljs");
            el.innerHTML = window.hljs.highlight(el.textContent || "", {language, ignoreIllegals: true}).value;
        });
    };

    if (window.hljs) {
        process();
    } else {
        setCodeTheme(Constants.PROTYLE_CDN);
        addScript(`${Constants.PROTYLE_CDN}/js/highlight.js/highlight.min.js?v=11.11.1`, "protyleHljsScript")
            .then(() => addScript(`${Constants.PROTYLE_CDN}/js/highlight.js/third-languages.js?v=2.0.1`, "protyleHljsThirdScript"))
            .then(process);
    }
};

export const addCopyButtons = (container: HTMLElement): void => {
    container.querySelectorAll("pre").forEach((pre) => {
        if (pre.querySelector(".agent-chat__copy-btn")) {
            return;
        }
        const wrap = document.createElement("div");
        wrap.className = "agent-chat__copy-wrap";
        const btn = document.createElement("span");
        btn.className = "agent-chat__copy-btn";
        btn.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
        btn.setAttribute("aria-label", window.siyuan.languages.copy);
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const code = pre.querySelector("code");
            const text = (code?.textContent || "").trimEnd().replace(/\n$/, "");
            navigator.clipboard.writeText(text).then(() => {
                showMessage(window.siyuan.languages.copied, 2000);
            }).catch(() => {
                showMessage(window.siyuan.languages.copied, 2000);
            });
        });
        wrap.appendChild(btn);
        pre.appendChild(wrap);
    });
};

export const postRender = (container: HTMLElement, app?: App): void => {
    container.querySelectorAll(".language-math").forEach((el) => {
        if (el.hasAttribute("data-subtype")) { return; }
        const content = el.textContent || "";
        const preParent = el.closest("pre");
        if (preParent) {
            const div = document.createElement("div");
            div.appendChild(document.createElement("span"));
            div.setAttribute("data-subtype", "math");
            div.setAttribute("data-content", content);
            preParent.replaceWith(div);
        } else {
            el.setAttribute("data-subtype", "math");
            el.setAttribute("data-content", content);
            if (el.tagName === "DIV" && !el.firstElementChild) {
                el.textContent = "";
                el.appendChild(document.createElement("span"));
            }
        }
    });
    container.querySelectorAll("pre > code[class*='language-']").forEach((code) => {
        const match = code.className.match(/language-(\S+)/);
        if (match) {
            code.parentElement?.setAttribute("data-language", match[1]);
        }
    });
    highlightCodeBlocks(container);
    mathRender(container);
    addCopyButtons(container);
    if (!app) {
        return;
    }
    // MarkdownStr 渲染出的 siyuan:// 块链接只是普通 <a href>，需补全 data-type/data-href
    // 才能接入全局 popover 浮窗系统；dock 内无 protyle 点击链路，需自行绑定点击打开块。
    container.querySelectorAll<HTMLAnchorElement>('a[href^="siyuan://"]').forEach((a) => {
        const href = a.getAttribute("href") || "";
        a.setAttribute("data-type", "a");
        a.setAttribute("data-href", href);
        a.addEventListener("click", (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            void processSiYuanUri(app, href);
        });
    });
};
