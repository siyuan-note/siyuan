import {Editor} from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import Mention from "@tiptap/extension-mention";
import {Placeholder} from "@tiptap/extension-placeholder";
import {History} from "@tiptap/extension-history";

interface BlockHit {
    id: string;
    label: string;
}

interface ComposerHandle {
    focus: () => void;
    destroy: () => void;
    getSendData: () => {text: string; references: {id: string; title: string}[]};
    clear: () => void;
}

export function mountComposer(host: HTMLElement, onSend: () => void): ComposerHandle {
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

    const updateHighlight = () => {
        if (!suggestionMenu) { return; }
        var items = suggestionMenu.querySelectorAll(".agent-mention-menu__item");
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle("agent-mention-menu__item--active", i === selectedIndex);
        }
    };

    const openMenu = (items: BlockHit[], command: (item: BlockHit) => void, clientRect?: () => DOMRect) => {
        closeMenu();
        if (items.length === 0) { return; }

        suggestionMenu = document.createElement("div");
        suggestionMenu.className = "agent-mention-menu";
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var row = document.createElement("div");
            row.className = "agent-mention-menu__item";
            row.setAttribute("data-index", i.toString());
            row.textContent = item.label;
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
            var rect = clientRect();
            var top = rect.top + rect.height + 4;
            var left = rect.left;
            var menuHeight = suggestionMenu.offsetHeight;
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
                    var label = node.attrs.label || node.attrs.id || "";
                    return "@" + label;
                },
                suggestion: {
                    char: "@",
                    items: async function ({query}): Promise<BlockHit[]> {
                        try {
                            var resp = await fetch("/api/filetree/searchDocs", {
                                method: "POST",
                                headers: {"Content-Type": "application/json"},
                                body: JSON.stringify({k: query}),
                            });
                            var data = await resp.json();
                            var items = data?.data || [];
                            return items.slice(0, 10).map(function (b: Record<string, unknown>) {
                                return {
                                    id: String(b.path || ""),
                                    label: String(b.hPath || b.path || ""),
                                };
                            });
                        } catch (e) {
                            return [];
                        }
                    },
                    command: function ({editor: ed, range, props}) {
                        var hit = props as BlockHit;
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
                                    var items = suggestionMenu.querySelectorAll(".agent-mention-menu__item");
                                    if (items.length > 0) {
                                        selectedIndex = (selectedIndex + 1) % items.length;
                                        updateHighlight();
                                    }
                                    return true;
                                }
                                if (props.event.key === "ArrowUp") {
                                    props.event.preventDefault();
                                    var items = suggestionMenu.querySelectorAll(".agent-mention-menu__item");
                                    if (items.length > 0) {
                                        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                                        updateHighlight();
                                    }
                                    return true;
                                }
                                if (props.event.key === "Enter") {
                                    props.event.preventDefault();
                                    if (suggestionItems.length > 0 && suggestionCommand) {
                                        var idx = selectedIndex;
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
                return false;
            },
        },
    });

    return {
        focus: function () { editor.commands.focus(); },
        destroy: function () { closeMenu(); editor.destroy(); },
        getSendData: function () {
            var refs: {id: string; title: string}[] = [];
            var textParts: string[] = [];
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
    };
}
