import {Constants} from "../../../constants";
import {escapeHtml} from "../../../util/escape";
import {fetchPost} from "../../../util/fetch";
import {hintRef} from "../../../protyle/hint/extend";
import {blockRender} from "../../../protyle/render/blockRender";
import {matchHotKey} from "../../../protyle/util/hotKey";
import {isSkillHintRequestActive, shouldYieldSkillHint} from "./agentHintState";
import {uploadFiles} from "../../../protyle/upload";
import {previewImages} from "../../../protyle/preview/image";
import {removeCompressURL} from "../../../util/image";
import {mountProtyleLiteFragment} from "../../../protyle/lite/fragmentEditor";

export interface AgentComposerData {
    text: string;
    blockHTML: string;
    references: { id: string; title: string }[];
}

interface ComposerHandle {
    focus: (toEnd?: boolean) => void;
    destroy: () => void;
    getSendData: () => AgentComposerData;
    clear: () => void;
    pushHistory: (text: string) => void;
    getHistory: () => string[];
    clearHistory: () => void;
    restoreHistory: (h: string[]) => void;
    insertMention: (id: string, label: string) => void;
    insertMentions: (mentions: Array<{ id: string; label: string }>) => void;
    uploadImages: (files: FileList, element: HTMLInputElement) => void;
    isUploading: () => boolean;
    renderBlockHTML: (element: HTMLElement, onEmbedRender: () => void) => void;
}

type OnChangeCallback = () => void;

const AGENT_HINT_OVERLAY_CLASS = "protyle-hint--agent-overlay";
const AGENT_SKILL_SELECTOR = '[data-type~="text"][custom-agent-skill="true"]';
const skillHintRequestIDs = new WeakMap<IProtyle, number>();

interface ComposerOptions {
    initialContent?: string;
    initialBlockHTML?: string;
    placeholder?: string;
    onCancel?: () => void;
    enableHistory?: boolean;
}

const resetEmbedBlocks = (element: HTMLElement) => {
    element.querySelectorAll<HTMLElement>('[data-type="NodeBlockQueryEmbed"]').forEach((embedElement) => {
        embedElement.removeAttribute("data-render");
        embedElement.style.height = "";
        Array.from(embedElement.children).forEach((child) => {
            if (child.classList.contains("protyle-wysiwyg__embed")) {
                child.remove();
            }
        });
    });
};

const prepareAgentHint = (protyle: IProtyle) => {
    if (protyle.hint.element.classList.contains("fn__none")) {
        protyle.hint.element.style.zIndex = (++window.siyuan.zIndex).toString();
    }
};

const hintAgentRef = (key: string, protyle: IProtyle, source: THintSource): IHintData[] => {
    prepareAgentHint(protyle);
    return hintRef(key, protyle, source);
};

// / 技能菜单：异步拉取 lsSkills，选中后把技能名作为带持久标识的智能体行级元素插入。
// 返回 [] 占位，数据在 fetch 回调里通过 protyle.hint.genHTML 填充（与 hintRef 异步模式一致）。
const hintSkill = (key: string, protyle: IProtyle): IHintData[] => {
    const requestID = (skillHintRequestIDs.get(protyle) || 0) + 1;
    skillHintRequestIDs.set(protyle, requestID);
    if (shouldYieldSkillHint(key, protyle.options.hint.extend.map((item) => item.key))) {
        protyle.hint.enableExtend = false;
        protyle.hint.genHTML([], protyle, true, "hint");
        return [];
    }
    prepareAgentHint(protyle);
    protyle.hint.genLoading(protyle);
    fetchPost("/api/ai/agent/lsSkills", {}, (response) => {
        // 异步响应返回时输入状态可能已变化，避免 Esc 或其他提示触发后重新打开旧菜单。
        if (!isSkillHintRequestActive({
            requestID,
            currentRequestID: skillHintRequestIDs.get(protyle),
            enableExtend: protyle.hint.enableExtend,
            enableSlash: protyle.hint.enableSlash,
            splitChar: protyle.hint.splitChar,
            hidden: protyle.hint.element.classList.contains("fn__none"),
            connected: protyle.hint.element.isConnected,
        })) {
            return;
        }
        const rawSkills = (response && response.data) ? response.data : [];
        const q = key.toLowerCase();
        const dataList: IHintData[] = rawSkills
            .filter((s: Record<string, string>) => !q ||
                (s.name || "").toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q))
            .map((s: Record<string, string>) => ({
                value: '<span data-type="text" custom-agent-skill="true">' +
                    escapeHtml(s.name) + "</span> ",
                html: '<div class="b3-list-item__first"><svg class="b3-list-item__graphic">' +
                    '<use xlink:href="#iconSparkles"></use></svg><span class="b3-list-item__text">' +
                    escapeHtml(s.name) + "</span></div>" +
                    (s.description ? '<div class="b3-list-item__meta b3-list-item__showall">' + escapeHtml(s.description) + "</div>" : ""),
            }));
        if (dataList.length === 0) {
            dataList.push({value: "", html: window.siyuan.languages.emptyContent});
        }
        protyle.hint.genHTML(dataList, protyle, false, "hint");
    });
    return [];
};

// 已发送消息历史（↑↓ 翻阅），独立于 protyle 的 undo/redo。
class ComposerHistory {
    private items: string[] = [];
    private idx = -1;       // -1 表示未在浏览历史（正在编辑草稿）
    private savedDraft = "";

    push(text: string) {
        if (!text || this.items[this.items.length - 1] === text) {
            return;
        }
        this.items.push(text);
        if (this.items.length > 50) {
            this.items.shift();
        }
        this.idx = -1;
    }

    get(): string[] {
        return this.items.slice();
    }

    clear() {
        this.items = [];
        this.idx = -1;
    }

    restore(h: string[]) {
        this.items = [];
        this.items.push(...h);
        this.idx = -1;
    }

    has(): boolean {
        return this.items.length > 0;
    }

    isBrowsing(): boolean {
        return this.idx !== -1;
    }

    resetCursor() {
        this.idx = -1;
    }

    beginBrowsing(currentDraft: string): string {
        this.savedDraft = currentDraft;
        this.idx = this.items.length - 1;
        return this.items[this.idx];
    }

    navigateUp(): string {
        if (this.idx > 0) {
            this.idx--;
        }
        return this.items[this.idx];
    }

    navigateDown(): string {
        this.idx++;
        if (this.idx >= this.items.length) {
            this.idx = -1;
            return this.savedDraft;
        }
        return this.items[this.idx];
    }
}

export function mountComposer(host: HTMLElement, onSend: () => void, onChange?: OnChangeCallback,
                              options: ComposerOptions = {}): ComposerHandle {
    const history = new ComposerHistory();
    const L = window.siyuan.languages;
    const enableHistory = options.enableHistory !== false;

    const fragment = mountProtyleLiteFragment(host, {
        initialMarkdown: options.initialContent,
        initialBlockHTML: options.initialBlockHTML,
        placeholder: options.placeholder || L.agentInputPlaceholder,
        emptyClass: "agent-composer--empty",
        hintOverlayClass: AGENT_HINT_OVERLAY_CLASS,
        onChange,
        protyleOptions: {
            hint: {
                // / 技能菜单（覆盖默认的块插入菜单 hintSlash）；[[ 块引用由 protyle 默认 extend 提供
                extend: [{
                    key: "((",
                    hint: hintAgentRef,
                }, {
                    key: "【【",
                    hint: hintAgentRef,
                }, {
                    key: "（（",
                    hint: hintAgentRef,
                }, {
                    key: "[[",
                    hint: hintAgentRef,
                }, {
                    key: "/",
                    hint: hintSkill,
                }, {
                    key: "、",
                    hint: hintSkill,
                }],
            },
        },
        afterSetContent: (protyle, element) => {
            resetEmbedBlocks(element);
            blockRender(protyle, element);
        },
    });
    const protyle = fragment.instance;
    const p = fragment.protyle;
    const wysiwyg = p.wysiwyg!;

    // 智能体输入框没有文档 ID，直接预览输入框中的图片，避免走依赖文档资源列表的默认逻辑。
    wysiwyg.element.addEventListener("dblclick", (event: MouseEvent) => {
        const image = (event.target as HTMLElement).closest("img:not(.emoji)") as HTMLImageElement | null;
        if (!image || !wysiwyg.element.contains(image)) {
            return;
        }
        const currentSrc = removeCompressURL(image.dataset.src || image.getAttribute("src") || "");
        if (!currentSrc) {
            return;
        }
        const srcList = Array.from(wysiwyg.element.querySelectorAll<HTMLImageElement>("img:not(.emoji)"))
            .map((item) => removeCompressURL(item.dataset.src || item.getAttribute("src") || ""))
            .filter(Boolean);
        event.preventDefault();
        event.stopImmediatePropagation();
        previewImages(srcList, currentSrc);
    }, true);

    // capture 阶段拦截 hint 选择、发送快捷键、历史翻页；undo/redo 交给 protyle 的 keydown（调 LocalUndo）。
    wysiwyg.element.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        // hint 面板可见时，Enter/方向键主动调 hint.select 完成选择，避免 capture 与冒泡的时序问题。
        const hintEl = p.hint?.element;
        if (hintEl && !hintEl.classList.contains("fn__none")) {
            if (event.key === "Enter" || event.key.indexOf("Arrow") > -1) {
                if (p.hint!.select(event, p)) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.general.agentSend.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            onSend();
            return;
        }
        if (event.key === "Escape" && options.onCancel) {
            event.preventDefault();
            event.stopPropagation();
            options.onCancel();
            return;
        }

        // ↑ 翻历史：仅在空输入或已处于历史浏览时触发
        if (enableHistory && event.key === "ArrowUp" && !event.shiftKey) {
            const isEmpty = (wysiwyg.element.textContent || "").replace(new RegExp(Constants.ZWSP, "g"), "").trim() === "";
            if ((history.isBrowsing() || isEmpty) && history.has()) {
                event.preventDefault();
                event.stopPropagation();
                const target = history.isBrowsing() ?
                    history.navigateUp() : history.beginBrowsing(wysiwyg.element.innerHTML);
                fragment.setMarkdown(target);
                return;
            }
        }
        // ↓ 翻历史：仅浏览中触发
        if (enableHistory && event.key === "ArrowDown" && history.isBrowsing()) {
            event.preventDefault();
            event.stopPropagation();
            const target = history.navigateDown();
            if (history.isBrowsing()) {
                fragment.setMarkdown(target);
            } else {
                fragment.setBlockHTML(target);
            }
            return;
        }

        // 用户开始新输入时退出历史浏览
        if (enableHistory && history.isBrowsing() && event.key.length === 1 &&
            !event.ctrlKey && !event.metaKey && !event.altKey) {
            history.resetCursor();
        }
    }, true);

    const getMarkdown = (): string => {
        return fragment.getMarkdown((element) => {
            element.querySelectorAll(AGENT_SKILL_SELECTOR).forEach((skillElement) => {
                skillElement.replaceWith(document.createTextNode(skillElement.textContent || ""));
            });
        });
    };

    const getBlockHTML = (): string => {
        return fragment.getBlockHTML(resetEmbedBlocks);
    };

    return {
        focus: (toEnd = false) => {
            fragment.focus(toEnd);
        },
        destroy: fragment.destroy,
        getSendData: () => {
            const references: { id: string; title: string }[] = [];
            wysiwyg.element.querySelectorAll('[data-type~="block-ref"]').forEach((ref) => {
                references.push({
                    id: ref.getAttribute("data-id") || "",
                    title: ref.textContent || "",
                });
            });
            return {text: getMarkdown(), blockHTML: getBlockHTML(), references};
        },
        clear: () => {
            fragment.clear();
            history.resetCursor();
        },
        pushHistory: (text: string) => history.push(text),
        getHistory: () => history.get(),
        clearHistory: () => history.clear(),
        restoreHistory: (h: string[]) => history.restore(h),
        insertMention: (id: string, label: string) => {
            protyle.insert('<span data-type="block-ref" data-id="' + id + '" data-subtype="d">' +
                escapeHtml(label) + "</span>" + Constants.ZWSP);
        },
        insertMentions: (mentions: Array<{ id: string; label: string }>) => {
            const html = mentions.map((m) =>
                '<span data-type="block-ref" data-id="' + m.id + '" data-subtype="d">' +
                escapeHtml(m.label) + "</span>" + Constants.ZWSP + " "
            ).join("");
            if (html) {
                protyle.insert(html);
            }
        },
        uploadImages: (files, element) => {
            uploadFiles(p, files, element, undefined, () => {
                onChange?.();
            }, {
                source: "file-picker",
                target: "editor",
                allowedInputKinds: ["files"],
            });
            onChange?.();
        },
        isUploading: () => p.upload?.isUploading || false,
        renderBlockHTML: (element, onEmbedRender) => {
            resetEmbedBlocks(element);
            blockRender(p, element, undefined, onEmbedRender);
        },
    };
}
