import {escapeHtml} from "../../../util/escape";
import {processSiYuanUri} from "../../../util/uri";
import {highlightRender} from "../../../protyle/render/highlightRender";
import {mathRender} from "../../../protyle/render/mathRender";
import {mermaidRender} from "../../../protyle/render/mermaidRender";
import {flowchartRender} from "../../../protyle/render/flowchartRender";
import {graphvizRender} from "../../../protyle/render/graphvizRender";
import {chartRender} from "../../../protyle/render/chartRender";
import {mindmapRender} from "../../../protyle/render/mindmapRender";
import {abcRender} from "../../../protyle/render/abcRender";
import {plantumlRender} from "../../../protyle/render/plantumlRender";
import {htmlRender} from "../../../protyle/render/htmlRender";
import {showMessage} from "../../../dialog/message";
import {openLink} from "../../../editor/openLink";
import {previewImages} from "../../../protyle/preview/image";
import {getDiagramBlock, previewDiagram} from "../../../protyle/preview/diagram";
import {removeCompressURL} from "../../../util/image";
/// #if !MOBILE
import {openGlobalSearch} from "../../../search/util";
/// #else
import {popSearch} from "../../../mobile/menu/search";
/// #endif

import type {App} from "../../../index";

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
    if (!rawQuestions || !rawQuestions.length) {
        return html + "</div>";
    }
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
    const text = (window.siyuan.languages.agentRetrying || "Retrying (${attempt}/${maxRetries})...")
        .replace("${attempt}", attempt.toString())
        .replace("${maxRetries}", maxRetries.toString());
    return '<div class="agent-chat__thinking-card">' +
    '<div class="agent-chat__thinking-header">' +
        '<span class="agent-chat__thinking-text">' + escapeHtml(text) + "</span>" +
    "</div>" +
"</div>";
};

export const renderToolsLineHTML = (newTools: Array<{name: string; running?: boolean}>): string => {
    let detailLines = "<div class=\"agent-chat__thinking-tools-line\"><span class=\"agent-chat__thinking-summary\">Tool calls:</span>";
    for (let i = 0; i < newTools.length; i++) {
        const runningClass = newTools[i].running ? " agent-chat__thinking-tool--running" : "";
        detailLines += '<span class="agent-chat__thinking-tool' + runningClass + '">' + escapeHtml(newTools[i].name) + "</span>";
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
        el.setAttribute("data-user-interacted", "true");
        const isExpanded = body.classList.contains("agent-chat__thinking-body--expanded");
        const isDone = el.classList.contains("agent-chat__msg--thinking-done");
        if (isDone) {
            // 思考完成后：两态 toggle（折叠↔完全展开），不经过预览中间态。
            if (isExpanded) {
                body.classList.remove("agent-chat__thinking-body--expanded");
                expandIcon.classList.remove("fn__none");
                contractIcon.classList.add("fn__none");
            } else {
                body.classList.remove("agent-chat__thinking-body--preview");
                body.classList.add("agent-chat__thinking-body--expanded");
                expandIcon.classList.add("fn__none");
                contractIcon.classList.remove("fn__none");
            }
        } else {
            // 流式中：三态循环（完全折叠 → 预览 → 完全展开 → 完全折叠）。
            const isPreview = body.classList.contains("agent-chat__thinking-body--preview");
            if (isExpanded) {
                body.classList.remove("agent-chat__thinking-body--expanded");
                expandIcon.classList.remove("fn__none");
                contractIcon.classList.add("fn__none");
            } else if (isPreview) {
                body.classList.remove("agent-chat__thinking-body--preview");
                body.classList.add("agent-chat__thinking-body--expanded");
                expandIcon.classList.add("fn__none");
                contractIcon.classList.remove("fn__none");
            } else {
                body.classList.add("agent-chat__thinking-body--preview");
            }
        }
    });
};

// 为容器内所有代码块（pre）和公式块（div[data-subtype=math]）注入复制按钮。
export const addCopyButtons = (container: HTMLElement): void => {
    // 代码块复制 code 文本；公式块复制 data-content（KaTeX 渲染前的原始 LaTeX）。
    const targets: Array<{ selector: string; getText: (el: HTMLElement) => string }> = [
        {selector: "pre", getText: (el) => (el.querySelector("code")?.textContent || "").trimEnd().replace(/\n$/, "")},
        {selector: '[data-subtype="math"]', getText: (el) => el.getAttribute("data-content") || ""}
    ];
    targets.forEach(({selector, getText}) => {
        container.querySelectorAll<HTMLElement>(selector).forEach((block) => {
            if (block.querySelector(".protyle-icon")) {
                return;
            }
            const wrap = document.createElement("div");
            wrap.className = "protyle-icons";
            wrap.appendChild(createCopyButton(() => getText(block)));
            block.appendChild(wrap);
        });
    });
};

// 构建单个复制按钮，getText 返回要复制的文本。
const createCopyButton = (getText: () => string): HTMLElement => {
    const btn = document.createElement("span");
    btn.className = "protyle-icon protyle-icon--only ariaLabel";
    btn.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
    btn.setAttribute("aria-label", window.siyuan.languages.copy);
    btn.setAttribute("data-position", "4north");
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const text = getText();
        navigator.clipboard.writeText(text).then(() => {
            showMessage(window.siyuan.languages.copied, 2000);
        }).catch(() => {
            showMessage(window.siyuan.languages.copied, 2000);
        });
    });
    return btn;
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
    // Assistant 使用 b3-typography，用户消息使用只读 protyle-wysiwyg，两种结构都复用 highlightRender。
    const contentSelector = ".b3-typography, .protyle-wysiwyg";
    const contentElements = container.matches(contentSelector)
        ? [container as HTMLElement]
        : Array.from(container.querySelectorAll<HTMLElement>(contentSelector));
    contentElements.forEach((item) => highlightRender(item));
    mathRender(container);
    mermaidRender(container);
    flowchartRender(container);
    graphvizRender(container);
    chartRender(container);
    mindmapRender(container);
    abcRender(container);
    plantumlRender(container);
    htmlRender(container);
    addCopyButtons(container);
    if (container.dataset.agentPreviewBound !== "true") {
        container.dataset.agentPreviewBound = "true";
        container.addEventListener("dblclick", (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const img = target.closest("img:not(.emoji)") as HTMLImageElement;
            if (!img || !container.contains(img)) {
                const diagramElement = getDiagramBlock(target.closest("[data-subtype]") as HTMLElement);
                if (diagramElement && container.contains(diagramElement)) {
                    previewDiagram(diagramElement);
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }
            const srcList = Array.from(container.querySelectorAll<HTMLImageElement>("img:not(.emoji)"))
                .map((item) => removeCompressURL(item.dataset.src || item.getAttribute("src") || ""));
            const currentSrc = removeCompressURL(img.dataset.src || img.getAttribute("src") || "");
            if (currentSrc) {
                previewImages(srcList, currentSrc);
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }
    if (!app) {
        return;
    }
    container.querySelectorAll<HTMLAnchorElement>('a[href^="siyuan://"]').forEach((link) => {
        const href = link.getAttribute("href") || "";
        link.setAttribute("data-type", "a");
        link.setAttribute("data-href", href);
    });
    if (container.dataset.agentLinkBound === "true") {
        return;
    }
    container.dataset.agentLinkBound = "true";
    // dock 内没有 Protyle WYSIWYG 的点击分派，使用事件委托覆盖流式及嵌入块异步插入的内容。
    container.addEventListener("click", (event: MouseEvent) => {
        if (event.defaultPrevented) {
            return;
        }
        const target = event.target as HTMLElement;
        const ref = target.closest('[data-type~="block-ref"]') as HTMLElement;
        const refID = ref?.dataset.id;
        if (refID && container.contains(ref)) {
            event.preventDefault();
            event.stopPropagation();
            void processSiYuanUri(app, "siyuan://blocks/" + refID);
            return;
        }
        const fileRef = target.closest('[data-type~="file-annotation-ref"][data-id]') as HTMLElement;
        const fileID = fileRef?.dataset.id;
        if (fileID && container.contains(fileRef)) {
            event.preventDefault();
            event.stopPropagation();
            openLink(app, fileID, event, event.ctrlKey || event.metaKey);
            return;
        }
        const tag = target.closest('[data-type~="tag"]') as HTMLElement;
        if (tag && container.contains(tag)) {
            event.preventDefault();
            event.stopPropagation();
            /// #if !MOBILE
            openGlobalSearch(app, `#${tag.textContent}#`, true, {method: 0});
            /// #else
            popSearch(app, {
                hasReplace: false,
                method: 0,
                hPath: "",
                idPath: [],
                k: `#${tag.textContent}#`,
                r: "",
                page: 1,
            });
            /// #endif
            return;
        }
        const link = target.closest('[data-type~="a"][data-href], a[href]') as HTMLElement;
        if (!link || !container.contains(link)) {
            return;
        }
        const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
        if (href) {
            event.preventDefault();
            event.stopPropagation();
            if (!processSiYuanUri(app, href)) {
                openLink(app, href, event, event.ctrlKey || event.metaKey);
            }
        }
    });
};
