import {Editor} from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import Mention from "@tiptap/extension-mention";
import {Placeholder} from "@tiptap/extension-placeholder";
import {History} from "@tiptap/extension-history";
import {getIconByType} from "../../../editor/getIcon";
import {escapeHtml} from "../../../util/escape";

interface BlockHit {
    id: string;
    label: string;
    icon: string;
    hPath: string;
}

interface ComposerHandle {
    focus: () => void;
    destroy: () => void;
    getSendData: () => {text: string; references: {id: string; title: string}[]};
    clear: () => void;
    pushHistory: (text: string) => void;
    getHistory: () => string[];
    clearHistory: () => void;
    restoreHistory: (h: string[]) => void;
    insertMention: (id: string, label: string) => void;
    insertMentions: (mentions: Array<{id: string; label: string}>) => void;
}

// 内容变化回调（含用户输入、IME、程序化 clearContent 等所有 doc 变更）。
// 用于发送按钮启用/禁用等需要感知输入框内容的外部逻辑。
type OnChangeCallback = () => void;

export function mountComposer(host: HTMLElement, onSend: () => void, onChange?: OnChangeCallback): ComposerHandle {
    const L = window.siyuan.languages;

    let suggestionMenu: HTMLElement | null = null;
    let selectedIndex = 0;
    let suggestionCommand: ((item: BlockHit) => void) | null = null;
    let suggestionItems: BlockHit[] = [];

    const closeMenu = () => {
        if (suggestionMenu) {
            suggestionMenu.remove();
            suggestionMenu = null;
        }
        selectedIndex = 0;
        suggestionCommand = null;
        suggestionItems = [];
    };

    const history: string[] = [];
    let historyIdx = -1;
    let savedDraft = "";

    let slashActive = false;
    let slashRange: {from: number; to: number} | null = null;

    const updateHighlight = () => {
        if (!suggestionMenu) { return; }
        const items = suggestionMenu.querySelectorAll(".b3-list-item");
        for (let i = 0; i < items.length; i++) {
            items[i].classList.toggle("b3-list-item--focus", i === selectedIndex);
        }
    };

    const openMenu = (items: BlockHit[], command: (item: BlockHit) => void, clientRect?: () => DOMRect) => {
        closeMenu();
        if (items.length === 0) { return; }

        suggestionMenu = document.createElement("div");
        suggestionMenu.className = "b3-list b3-list--background agent-mention-menu protyle-hint";
        suggestionMenu.innerHTML = '<div style="flex: 1;overflow:auto;"></div>';
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const row = document.createElement("div");
            row.className = "b3-list-item b3-list-item--two";
            row.setAttribute("data-index", i.toString());
            const iconSvg = item.icon ? '<svg class="b3-list-item__graphic"><use xlink:href="#' + item.icon + '"></use></svg>' : "";
            const hPathText = item.hPath ? '<span class="b3-list-item__meta b3-list-item__showall">' + escapeHtml(item.hPath) + "</span>" : "";
            row.innerHTML = '<div class="b3-list-item__first">' + iconSvg + '<span class="b3-list-item__text">' + escapeHtml(item.label) + "</span></div>" + hPathText;
            row.addEventListener("mousedown", function (hit: BlockHit) {
                return function (e: MouseEvent) { e.preventDefault(); command(hit); };
            }(item));
            suggestionMenu.firstElementChild.appendChild(row);
        }

        document.body.appendChild(suggestionMenu);
        suggestionCommand = command;
        suggestionItems = items;
        selectedIndex = 0;
        updateHighlight();
        if (clientRect) {
            const rect = clientRect();
            let top = rect.top + rect.height + 4;
            let left = rect.left;
            const menuHeight = suggestionMenu.offsetHeight;
            if (top + menuHeight > window.innerHeight && rect.top > menuHeight + 4) {
                top = rect.top - menuHeight - 4;
            }
            const menuWidth = suggestionMenu.offsetWidth;
            if (left + menuWidth > window.innerWidth) {
                left = window.innerWidth - menuWidth - 8;
            }
            suggestionMenu.style.top = top + "px";
            suggestionMenu.style.left = left + "px";
        }
    };

    const editor = new Editor({
        element: host,
        extensions: [
            Document,
            Paragraph,
            Text,
            HardBreak,
            History,
            Placeholder.configure({
                placeholder: L.agentInputPlaceholder || "输入消息，@引用文档...",
            }),
            Mention.configure({
                HTMLAttributes: {class: "agent-mention-chip"},
                renderText: ({node}) => {
                    const label = node.attrs.label || node.attrs.id || "";
                    return "@" + label;
                },
                suggestion: {
                    char: "@",
                    allowToIncludeChar: true,
                    allowedPrefixes: null,
                    items: async function ({query}): Promise<BlockHit[]> {
                        try {
                            const resp = await fetch("/api/search/searchRefBlock", {
                                method: "POST",
                                headers: {"Content-Type": "application/json"},
                                body: JSON.stringify({k: query, id: "", rootID: "", beforeLen: 48, isDatabase: false, isSquareBrackets: true}),
                            });
                            const data = await resp.json();
                            const blocks = (data && data.data && data.data.blocks) ? data.data.blocks : [];
                            return blocks.slice(0, 10).map(function (b: Record<string, unknown>) {
                                const id = String(b.id || "");
                                const raw = String(b.content || b.refText || b.name || id);
                                // 内核返回的 content 已做 HTML 转义并可能含 <mark> 标签，先剥离标签再反转为纯文本，
                                // 否则 escapeHtml 会再次转义导致显示成 "&lt;" 等字面量。
                                const plain = Lute.UnEscapeHTMLStr(raw.replace(/<[^>]+>/g, "")).trim() || id;
                                const type = String(b.type || "NodeParagraph");
                                const sub = b.subType ? String(b.subType) : "";
                                return {
                                    id: id,
                                    label: plain.slice(0, 80),
                                    icon: getIconByType(type, sub),
                                    hPath: Lute.UnEscapeHTMLStr(String(b.hPath || "")),
                                };
                            });
                        } catch (e) {
                            return [];
                        }
                    },
                    command: function ({editor: ed, range, props}) {
                        const hit = props as BlockHit;
                        ed.chain().focus().insertContentAt(range, [
                            {type: "mention", attrs: {id: hit.id, label: hit.label}},
                            {type: "text", text: " "},
                        ]).run();
                    },
                    render: function () {
                        return {
                            onStart: function (props) {
                                suggestionCommand = function (item) { props.command(item); };
                                openMenu(props.items as BlockHit[], suggestionCommand!, props.clientRect?.bind(props));
                            },
                            onUpdate: function (props) {
                                suggestionCommand = function (item) { props.command(item); };
                                openMenu(props.items as BlockHit[], suggestionCommand!, props.clientRect?.bind(props));
                            },
                            onExit: function () { closeMenu(); },
                            onKeyDown: function (props) {
                                if (!suggestionMenu) { return false; }
                                if (props.event.key === "ArrowDown") {
                                    props.event.preventDefault();
                                    const items = suggestionMenu.querySelectorAll(".b3-list-item");
                                    if (items.length > 0) {
                                        selectedIndex = (selectedIndex + 1) % items.length;
                                        updateHighlight();
                                    }
                                    return true;
                                }
                                if (props.event.key === "ArrowUp") {
                                    props.event.preventDefault();
                                    const items = suggestionMenu.querySelectorAll(".b3-list-item");
                                    if (items.length > 0) {
                                        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                                        updateHighlight();
                                    }
                                    return true;
                                }
                                if (props.event.key === "Enter") {
                                    props.event.preventDefault();
                                    if (suggestionItems.length > 0 && suggestionCommand) {
                                        const idx = selectedIndex;
                                        if (idx >= 0 && idx < suggestionItems.length) {
                                            suggestionCommand(suggestionItems[idx]);
                                        }
                                    }
                                    return true;
                                }
                                if (props.event.key === "Escape") {
                                    closeMenu();
                                    return true;
                                }
                                return false;
                            },
                        };
                    },
                },
            }),
        ],
        editorProps: {
            attributes: {class: "agent-composer__pm"},
            handleKeyDown: function (_view, event) {
                // 阻止撤销/重做快捷键冒泡到全局处理器，避免影响文档编辑器
                if ((event.ctrlKey || event.metaKey) && !event.altKey) {
                    if (!event.shiftKey && (event.key === "z" || event.key === "Z")) {
                        // Ctrl+Z / Cmd+Z (undo)
                        event.stopPropagation();
                        return false;  // 让 TipTap History 扩展继续处理
                    }
                    if (event.shiftKey && (event.key === "z" || event.key === "Z")) {
                        // Ctrl+Shift+Z / Cmd+Shift+Z (redo)
                        event.stopPropagation();
                        return false;
                    }
                    if (!event.shiftKey && (event.key === "y" || event.key === "Y")) {
                        // Ctrl+Y / Cmd+Y (redo on Windows/Linux)
                        event.stopPropagation();
                        return false;
                    }
                }
                if (suggestionMenu && slashActive) {
                    if (event.key === "ArrowDown") {
                        event.preventDefault();
                        const items = suggestionMenu.querySelectorAll(".b3-list-item");
                        if (items.length > 0) {
                            selectedIndex = (selectedIndex + 1) % items.length;
                            updateHighlight();
                        }
                        return true;
                    }
                    if (event.key === "ArrowUp") {
                        event.preventDefault();
                        const items = suggestionMenu.querySelectorAll(".b3-list-item");
                        if (items.length > 0) {
                            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                            updateHighlight();
                        }
                        return true;
                    }
                    if (event.key === "Enter") {
                        event.preventDefault();
                        if (suggestionItems.length > 0 && suggestionCommand) {
                            const idx = selectedIndex;
                            if (idx >= 0 && idx < suggestionItems.length) {
                                suggestionCommand(suggestionItems[idx]);
                            }
                        }
                        return true;
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        closeMenu();
                        slashActive = false;
                        slashRange = null;
                        return true;
                    }
                    return false;
                }
                if (event.key === "Enter" && !event.shiftKey && !suggestionMenu) {
                    event.preventDefault();
                    onSend();
                    return true;
                }
                if (event.key === "ArrowUp" && !suggestionMenu) {
                    const navigating = historyIdx >= 0;
                    const isEmpty = _view.state.doc.childCount === 1 &&
                        _view.state.doc.firstChild?.childCount === 0;
                    if ((navigating || isEmpty) && history.length > 0) {
                        event.preventDefault();
                        if (historyIdx === -1) {
                            savedDraft = editor.state.doc.textContent;
                            historyIdx = history.length - 1;
                        } else if (historyIdx > 0) { historyIdx--; }
                        if (historyIdx >= 0) {
                            editor.commands.setContent(history[historyIdx]);
                        }
                        return true;
                    }
                }
                if (event.key === "ArrowDown" && !suggestionMenu && historyIdx >= 0) {
                    event.preventDefault();
                    historyIdx++;
                    if (historyIdx >= history.length) {
                        historyIdx = -1;
                        editor.commands.setContent(savedDraft || "");
                        savedDraft = "";
                    } else {
                        editor.commands.setContent(history[historyIdx]);
                    }
                    return true;
                }
                if (historyIdx >= 0 && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    historyIdx = -1;
                    savedDraft = "";
                }
                return false;
            },
        },
    });

    editor.on("update", function () {
        // 通知外部内容已变更（无论是否涉及 slash 命令处理）。
        if (onChange) { onChange(); }
        if (suggestionMenu && !slashActive) { return; }
        const {$from} = editor.state.selection;
        const textBefore = $from.parent.textBetween(0, $from.parentOffset);
        const match = textBefore.match(/(?:^|\s)\/(\S*)$/);
        if (match) {
            const query = match[1];
            const slashPos = $from.pos - query.length - 1;
            slashActive = true;
            slashRange = {from: slashPos, to: $from.pos};
            const slashCoords = editor.view.coordsAtPos($from.pos);
            const slashClientRect = function () {
                return {
                    left: slashCoords.left,
                    top: slashCoords.top,
                    right: slashCoords.right,
                    bottom: slashCoords.bottom,
                    width: slashCoords.right - slashCoords.left,
                    height: slashCoords.bottom - slashCoords.top,
                } as DOMRect;
            };

            const filterAndOpen = function (skills: BlockHit[]) {
                const q = query.toLowerCase();
                const filtered = !q ? skills : skills.filter(function (s) {
                    return s.label.toLowerCase().includes(q) || s.hPath.toLowerCase().includes(q);
                });
                suggestionCommand = function (item: BlockHit) {
                    editor.chain().focus().deleteRange({from: slashRange!.from, to: slashRange!.to}).insertContent(item.label + " ").run();
                    closeMenu();
                    slashActive = false;
                    slashRange = null;
                };
                openMenu(filtered, suggestionCommand!, slashClientRect);
            };

            // 每次打开 / 菜单都重新拉取 skill 列表，确保 install/remove/save/rename 后立即反映变化。
            fetch("/api/ai/agent/lsSkills", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
            }).then(function (r) { return r.json(); }).then(function (data) {
                const rawSkills = (data && data.data) ? data.data : [];
                const items: BlockHit[] = rawSkills.map(function (s: Record<string, string>) {
                    return {
                        id: s.name,
                        label: s.name,
                        icon: "",
                        hPath: s.description || "",
                    };
                });
                filterAndOpen(items);
            }).catch(function () {
                closeMenu();
                slashActive = false;
                slashRange = null;
            });
        } else if (slashActive) {
            closeMenu();
            slashActive = false;
            slashRange = null;
        }
    });

    return {
        focus: function () { editor.commands.focus(); },
        destroy: function () { closeMenu(); editor.destroy(); },
        getSendData: function () {
            const refs: {id: string; title: string}[] = [];
            const textParts: string[] = [];
            editor.state.doc.descendants(function (node) {
                if (node.type.name === "mention") {
                    refs.push({id: node.attrs.id, title: node.attrs.label});
                    textParts.push("@" + (node.attrs.label || node.attrs.id));
                } else if (node.isText && node.text) {
                    textParts.push(node.text);
                }
            });
            return {text: textParts.join("").trim(), references: refs};
        },
        clear: function () { editor.commands.clearContent(); },
        pushHistory: function (text: string) {
            if (!text || history[history.length - 1] === text) { return; }
            history.push(text);
            if (history.length > 50) { history.shift(); }
            historyIdx = -1;
        },
        getHistory: function () { return history.slice(); },
        clearHistory: function () { history.length = 0; historyIdx = -1; },
        restoreHistory: function (h: string[]) { history.length = 0; history.push(...h); historyIdx = -1; },
        insertMention: function (id: string, label: string) {
            editor.chain().focus().insertContent([
                {type: "mention", attrs: {id, label}},
                {type: "text", text: " "},
            ]).run();
        },
        insertMentions: function (mentions: Array<{id: string; label: string}>) {
            // 批量插入多个 mention chip，一次性 insertContent 避免多次 focus/选择重置。
            const nodes: Array<Record<string, unknown>> = [];
            for (const m of mentions) {
                nodes.push({type: "mention", attrs: {id: m.id, label: m.label}});
                nodes.push({type: "text", text: " "});
            }
            if (nodes.length) {
                editor.chain().focus().insertContent(nodes).run();
            }
        },
    };
}
