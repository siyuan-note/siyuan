import {Editor} from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import Mention from "@tiptap/extension-mention";
import {Placeholder} from "@tiptap/extension-placeholder";
import {History} from "@tiptap/extension-history";
import {getIconByType} from "../../editor/getIcon";

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
}

export function mountComposer(host: HTMLElement, onSend: () => void): ComposerHandle {
    const L = window.siyuan.languages;

    const escapeHtmlHelper = function (text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    };

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

    const updateHighlight = () => {
        if (!suggestionMenu) { return; }
        const items = suggestionMenu.querySelectorAll(".agent-mention-menu__item");
        for (let i = 0; i < items.length; i++) {
            items[i].classList.toggle("agent-mention-menu__item--active", i === selectedIndex);
        }
    };

    const openMenu = (items: BlockHit[], command: (item: BlockHit) => void, clientRect?: () => DOMRect) => {
        closeMenu();
        if (items.length === 0) { return; }

        suggestionMenu = document.createElement("div");
        suggestionMenu.className = "agent-mention-menu";
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const row = document.createElement("div");
            row.className = "agent-mention-menu__item";
            row.setAttribute("data-index", i.toString());
            const iconSvg = item.icon ? '<svg class="agent-mention-menu__icon"><use xlink:href="#' + item.icon + '"></use></svg>' : "";
            const hPathText = item.hPath ? '<div class="agent-mention-menu__hpath">' + escapeHtmlHelper(item.hPath) + "</div>" : "";
            row.innerHTML = '<div class="agent-mention-menu__first">' + iconSvg + '<span class="agent-mention-menu__text">' + escapeHtmlHelper(item.label) + "</span></div>" + hPathText;
            row.addEventListener("mousedown", function (hit: BlockHit) {
                return function (e: MouseEvent) { e.preventDefault(); command(hit); };
            }(item));
            suggestionMenu.appendChild(row);
        }

        document.body.appendChild(suggestionMenu);
        suggestionCommand = command;
        suggestionItems = items;
        selectedIndex = 0;
        updateHighlight();
        if (clientRect) {
            const rect = clientRect();
            let top = rect.top + rect.height + 4;
            const left = rect.left;
            const menuHeight = suggestionMenu.offsetHeight;
            if (top + menuHeight > window.innerHeight && rect.top > menuHeight + 4) {
                top = rect.top - menuHeight - 4;
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
                                const plain = raw.replace(/<[^>]+>/g, "").trim() || id;
                                const type = String(b.type || "NodeParagraph");
                                const sub = b.subType ? String(b.subType) : "";
                                return {
                                    id: id,
                                    label: plain.slice(0, 80),
                                    icon: getIconByType(type, sub),
                                    hPath: String(b.hPath || ""),
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
                                    const items = suggestionMenu.querySelectorAll(".agent-mention-menu__item");
                                    if (items.length > 0) {
                                        selectedIndex = (selectedIndex + 1) % items.length;
                                        updateHighlight();
                                    }
                                    return true;
                                }
                                if (props.event.key === "ArrowUp") {
                                    props.event.preventDefault();
                                    const items = suggestionMenu.querySelectorAll(".agent-mention-menu__item");
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
    };
}
