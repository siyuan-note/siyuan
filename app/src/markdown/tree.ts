import {getDocTreeWindow} from "../layout/dock/docTree/DocTreeModel";
import type {MarkdownTreeBridge, MarkdownTreeLocation, MarkdownTreeNode, MarkdownTreeState, MarkdownTreeView} from "./treeContracts";

interface TreeRow {
    node?: MarkdownTreeNode;
    parent?: string;
    depth: number;
    message?: string;
    retry?: boolean;
}

export const createMarkdownTree = (options: {
    element: HTMLElement;
    toggle: HTMLButtonElement;
    bridge: MarkdownTreeBridge;
    text(key: string): string;
    mobile: boolean;
    onOpen(location: MarkdownTreeLocation): Promise<boolean>;
    onError(): void;
}) => {
    const {element, toggle, bridge, text} = options;
    element.innerHTML = `<div class="markdown-tree__notice" role="status"></div>
<div class="markdown-tree__viewport" role="tree" tabindex="0"><div class="b3-list b3-list--background"></div></div>
<button type="button" class="b3-button b3-button--text markdown-tree__choose"></button>
<div class="markdown-tree__resize" role="separator" tabindex="0" aria-orientation="vertical"></div>`;
    const notice = element.querySelector<HTMLElement>(".markdown-tree__notice");
    const viewport = element.querySelector<HTMLElement>(".markdown-tree__viewport");
    const list = viewport.firstElementChild as HTMLElement;
    const choose = element.querySelector<HTMLButtonElement>(".markdown-tree__choose");
    const resize = element.querySelector<HTMLElement>(".markdown-tree__resize");
    viewport.setAttribute("aria-label", text("markdownFiles"));
    resize.setAttribute("aria-label", text("markdownFiles"));
    choose.textContent = text("markdownOpenFolder");
    toggle.setAttribute("aria-label", text("markdownFiles"));
    toggle.setAttribute("aria-controls", element.id);
    const events = new AbortController();
    const {signal} = events;
    const narrow = matchMedia("(max-width: 700px)");
    const drawer = () => options.mobile || narrow.matches;
    let disposed = false;
    let frozen = false;
    let drawerOpen = false;
    let desktopVisible = true;
    let initialized = false;
    let choosing = false;
    let width = 240;
    let refreshSequence = 0;
    let version = 0;
    let selected: string;
    let focused: string;
    let frame = 0;
    let saveTimer: ReturnType<typeof setTimeout>;
    let state: MarkdownTreeState = {kind: "empty", generation: 0, expanded: [], width, visible: true};
    let expanded = new Set<string>();
    const children = new Map<string, MarkdownTreeNode[]>();
    const errors = new Map<string, string>();
    const pending = new Map<string, object>();
    let rows: TreeRow[] = [];
    const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: "base"});
    const location = (nodeId: string): MarkdownTreeLocation => ({rootId: state.rootId, generation: state.generation, nodeId});
    const shown = () => drawer() ? drawerOpen : desktopVisible;
    const updateVisibility = () => {
        const visible = shown();
        element.hidden = !visible;
        element.dataset.drawer = String(drawer());
        element.style.setProperty("--markdown-tree-width", `${width}px`);
        element.parentElement.classList.toggle("markdown-workspace--drawer", drawer() && visible);
        for (const sibling of Array.from(element.parentElement.children)) {
            if (sibling !== element) (sibling as HTMLElement).inert = frozen || drawer() && visible;
        }
        toggle.setAttribute("aria-expanded", String(visible));
        resize.hidden = drawer();
        resize.setAttribute("aria-valuenow", String(width));
        resize.setAttribute("aria-valuemin", "180");
        resize.setAttribute("aria-valuemax", "480");
    };
    const saveView = () => {
        clearTimeout(saveTimer);
        if (!initialized) return;
        const view: MarkdownTreeView = {width, visible: desktopVisible};
        if (state.rootId) Object.assign(view, {rootId: state.rootId, generation: state.generation, expanded: [...expanded].slice(-256)});
        return bridge.saveView(view).catch(() => {if (!disposed) options.onError();});
    };
    const scheduleSave = () => {clearTimeout(saveTimer); saveTimer = setTimeout(saveView, 150);};
    const renderWindow = () => {
        if (disposed) return;
        const active = viewport.contains(document.activeElement);
        const height = Math.max(28, parseFloat(getComputedStyle(element).getPropertyValue("--b3-ui-list-height")) || (drawer() ? 44 : 28)) + 2;
        const range = getDocTreeWindow(rows.length, viewport.scrollTop, viewport.clientHeight, height);
        const fragment = document.createDocumentFragment();
        viewport.removeAttribute("aria-activedescendant");
        const spacer = (size: number) => {const item = document.createElement("div"); item.style.height = `${size}px`; item.setAttribute("role", "presentation"); fragment.append(item);};
        spacer(range.before);
        rows.slice(range.start, range.end).forEach((row, offset) => {
            const item = document.createElement("div");
            item.className = "b3-list-item markdown-tree__row";
            item.style.setProperty("--markdown-tree-depth", String(row.depth));
            item.dataset.row = String(range.start + offset);
            if (!row.node) {
                item.setAttribute("role", "presentation");
                const label = document.createElement(row.retry ? "button" : "span");
                label.className = row.retry ? "b3-button b3-button--text" : "b3-list-item__text";
                label.textContent = row.message;
                if (row.retry) label.dataset.retry = row.parent;
                item.append(label);
            } else {
                const node = row.node;
                const directory = node.kind === "directory";
                item.id = `markdown-tree-row-${range.start + offset}`;
                item.dataset.nodeId = node.id;
                item.setAttribute("role", "treeitem");
                item.setAttribute("aria-level", String(row.depth + 1));
                item.setAttribute("aria-selected", String(node.id === selected));
                if (directory) item.setAttribute("aria-expanded", String(expanded.has(node.id)));
                item.classList.toggle("b3-list-item--focus", node.id === selected);
                item.classList.toggle("markdown-tree__row--focused", node.id === focused && active);
                item.innerHTML = `<span class="b3-list-item__toggle"><svg class="b3-list-item__arrow${expanded.has(node.id) ? " b3-list-item__arrow--open" : ""}"${directory ? "" : ' style="visibility:hidden"'}><use href="#iconRight"></use></svg></span><svg class="b3-list-item__graphic" aria-hidden="true"><use href="#${directory ? "iconFolder" : "iconMarkdown"}"></use></svg><span class="b3-list-item__text"></span>`;
                item.querySelector(".b3-list-item__text").textContent = node.name;
                item.title = node.name;
                if (focused === node.id) viewport.setAttribute("aria-activedescendant", item.id);
            }
            fragment.append(item);
        });
        spacer(range.after);
        list.replaceChildren(fragment);
    };
    const project = () => {
        rows = [];
        const seen = new Set<string>();
        const visit = (node: MarkdownTreeNode, depth: number) => {
            if (depth > 64 || seen.has(node.id) || rows.length > 20000) return;
            seen.add(node.id);
            rows.push({node, depth});
            if (node.kind !== "directory" || !expanded.has(node.id)) return;
            if (errors.has(node.id)) rows.push({depth: depth + 1, parent: node.id, message: errors.get(node.id), retry: true});
            else if (!children.has(node.id)) rows.push({depth: depth + 1, message: text("loading")});
            else if (!children.get(node.id).length) rows.push({depth: depth + 1, message: text("empty")});
            else children.get(node.id).forEach(child => visit(child, depth + 1));
        };
        if (state.kind === "ready") visit({id: state.rootId, name: state.rootName, kind: "directory"}, 0);
        renderWindow();
    };
    const discard = (nodeId: string) => {
        const previous = children.get(nodeId);
        children.delete(nodeId); pending.delete(nodeId); errors.delete(nodeId); expanded.delete(nodeId);
        previous?.forEach(child => {if (child.kind === "directory") discard(child.id);});
    };
    const load = async (nodeId: string, force = false) => {
        if (disposed || state.kind !== "ready" || pending.has(nodeId) || (!force && children.has(nodeId))) return;
        const expected = version;
        const request = location(nodeId);
        const token = {};
        pending.set(nodeId, token); errors.delete(nodeId); project();
        try {
            const result = await bridge.list(request);
            if (disposed || version !== expected || pending.get(nodeId) !== token) return;
            if (result.kind === "blocked") {
                errors.set(nodeId, text(result.error.code === "size" ? "markdownFolderLimit" : "markdownFolderError"));
            } else if (result.entries.length > 10000) {
                errors.set(nodeId, text("markdownFolderLimit"));
            } else if (result.rootId !== request.rootId || result.generation !== request.generation || result.nodeId !== nodeId ||
                result.entries.some(node => typeof node.id !== "string" || typeof node.name !== "string" || !["file", "directory"].includes(node.kind))) {
                errors.set(nodeId, text("markdownFolderError"));
            } else {
                const entries = [...result.entries].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "directory" ? -1 : 1) || collator.compare(a.name, b.name));
                const currentIds = new Set(entries.map(node => node.id));
                children.get(nodeId)?.forEach(child => {if (child.kind === "directory" && !currentIds.has(child.id)) discard(child.id);});
                children.set(nodeId, entries);
                for (const child of entries) if (child.kind === "directory" && expanded.has(child.id)) void load(child.id, force);
            }
        } catch { if (!disposed && version === expected) errors.set(nodeId, text("markdownFolderError")); }
        finally {
            if (pending.get(nodeId) === token) pending.delete(nodeId);
            if (!disposed && version === expected) project();
        }
    };
    const applyState = (next: MarkdownTreeState, force = false) => {
        const changed = state.rootId !== next.rootId || state.generation !== next.generation;
        if (!initialized) {width = Math.max(180, Math.min(480, next.width || 240)); desktopVisible = next.visible; initialized = true;}
        if (changed || force) {version++; pending.clear(); errors.clear();}
        if (changed) {children.clear(); viewport.scrollTop = 0;}
        if (changed) expanded = new Set(next.expanded.slice(-256));
        if (changed || selected !== next.currentNodeId) {
            if (next.rootId) expanded.add(next.rootId);
            next.currentPath?.forEach(id => expanded.add(id));
        }
        selected = next.currentNodeId;
        if (!focused || changed) focused = selected || next.rootId;
        state = next;
        notice.textContent = next.kind === "permission-required" ? text("markdownFolderPermission") :
            next.kind === "blocked" ? text("markdownFolderError") : "";
        notice.hidden = !notice.textContent;
        choose.hidden = next.kind === "ready";
        viewport.hidden = next.kind !== "ready";
        updateVisibility(); project();
        if (next.kind === "ready" && shown() && expanded.has(next.rootId)) return load(next.rootId, force);
    };
    const refresh = async () => {
        const sequence = ++refreshSequence;
        try {
            const next = await bridge.state();
            if (!disposed && sequence === refreshSequence) await applyState(next, true);
        } catch {if (!disposed && sequence === refreshSequence) {notice.hidden = false; notice.textContent = text("markdownFolderError"); choose.hidden = false;}}
    };
    const chooseRoot = async () => {
        if (frozen || disposed || choosing) return;
        choosing = true;
        await saveView();
        if (disposed) {choosing = false; return;}
        const sequence = ++refreshSequence;
        try {
            const next = await bridge.chooseRoot();
            if (!disposed && next.kind !== "cancelled") {
                // 宿主可能先通知目录变化再返回选择结果；刷新后的数据仍保留用户展开面板的意图。
                if (sequence === refreshSequence) await applyState(next, true);
                else await refresh();
                if (disposed) return;
                if (drawer()) drawerOpen = true; else desktopVisible = true;
                updateVisibility();
                if (state.rootId) void load(state.rootId);
                scheduleSave();
            }
        } catch {if (!disposed) options.onError();}
        finally {choosing = false;}
    };
    const fold = (id: string, open = !expanded.has(id)) => {
        if (frozen) return;
        if (open) {expanded.add(id); void load(id, true);} else expanded.delete(id);
        if (expanded.size > 256) expanded.delete(expanded.values().next().value);
        project(); scheduleSave();
    };
    const activate = async (row: TreeRow) => {
        if (frozen || !row.node) return;
        focused = row.node.id;
        if (row.node.kind === "directory") fold(row.node.id);
        else {
            try {if (await options.onOpen(location(row.node.id)) && !disposed && drawer()) {drawerOpen = false; updateVisibility();}}
            catch {if (!disposed) options.onError();}
        }
    };
    viewport.addEventListener("click", event => {
        const retry = (event.target as Element).closest<HTMLElement>("[data-retry]");
        if (retry && !frozen) {children.delete(retry.dataset.retry); void load(retry.dataset.retry); return;}
        const item = (event.target as Element).closest<HTMLElement>("[data-row]");
        if (!item || !(event.target as Element).closest("[data-node-id]")) return;
        const row = rows[Number(item.dataset.row)];
        viewport.focus(); void activate(row);
    }, {signal});
    viewport.addEventListener("scroll", () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(renderWindow);}, {passive: true, signal});
    const updateFocus = () => {
        const active = document.activeElement === viewport;
        viewport.querySelectorAll<HTMLElement>("[data-node-id]").forEach(item =>
            item.classList.toggle("markdown-tree__row--focused", active && item.dataset.nodeId === focused));
    };
    viewport.addEventListener("focus", updateFocus, {signal});
    viewport.addEventListener("blur", updateFocus, {signal});
    viewport.addEventListener("keydown", event => {
        if (frozen) return;
        const navigable = rows.filter(row => row.node);
        let index = navigable.findIndex(row => row.node.id === focused);
        if (index < 0) index = 0;
        const row = navigable[index];
        if (!row) return;
        if (event.key === "ArrowDown") index = Math.min(index + 1, navigable.length - 1);
        else if (event.key === "ArrowUp") index = Math.max(0, index - 1);
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = navigable.length - 1;
        else if (event.key === "ArrowRight" && row.node.kind === "directory") fold(row.node.id, true);
        else if (event.key === "ArrowLeft") {
            if (expanded.has(row.node.id)) fold(row.node.id, false);
            else {for (let i = index - 1; i >= 0; i--) if (navigable[i].depth < row.depth) {index = i; break;}}
        } else if (event.key === "Enter" || event.key === " ") void activate(row);
        else return;
        event.preventDefault(); event.stopPropagation();
        focused = navigable[index].node.id;
        const position = rows.findIndex(value => value.node?.id === focused);
        const height = Math.max(28, parseFloat(getComputedStyle(element).getPropertyValue("--b3-ui-list-height")) || (drawer() ? 44 : 28)) + 2;
        if (position * height < viewport.scrollTop) viewport.scrollTop = position * height;
        else if ((position + 1) * height > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = (position + 1) * height - viewport.clientHeight;
        renderWindow();
    }, {signal});
    const hideDrawer = (restoreFocus = true) => {if (drawerOpen) {drawerOpen = false; updateVisibility(); if (restoreFocus) toggle.focus();}};
    document.addEventListener("focusin", event => {
        if (drawer() && drawerOpen && !element.contains(event.target as Node) && !toggle.contains(event.target as Node)) hideDrawer(false);
    }, {signal});
    document.addEventListener("pointerdown", event => {
        if (drawer() && drawerOpen && !element.contains(event.target as Node) && !toggle.contains(event.target as Node)) hideDrawer();
    }, {signal});
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && drawer() && drawerOpen) {event.preventDefault(); hideDrawer();}
    }, {signal});
    toggle.addEventListener("click", () => {
        if (frozen) return;
        if (drawer()) drawerOpen = !drawerOpen; else {desktopVisible = !desktopVisible; scheduleSave();}
        updateVisibility(); if (shown()) {void refresh(); viewport.focus();}
    }, {signal});
    choose.addEventListener("click", () => {void chooseRoot();}, {signal});
    let drag: {x: number; width: number};
    resize.addEventListener("pointerdown", event => {
        if (frozen || drawer()) return;
        event.preventDefault(); drag = {x: event.clientX, width}; resize.setPointerCapture(event.pointerId);
    }, {signal});
    resize.addEventListener("pointermove", event => {
        if (!drag) return;
        const direction = getComputedStyle(element).direction === "rtl" ? -1 : 1;
        width = Math.round(Math.max(180, Math.min(480, drag.width + (event.clientX - drag.x) * direction))); updateVisibility();
    }, {signal});
    const finishDrag = () => {if (drag) {drag = undefined; scheduleSave();}};
    resize.addEventListener("pointerup", finishDrag, {signal});
    resize.addEventListener("pointercancel", finishDrag, {signal});
    resize.addEventListener("keydown", event => {
        if (frozen || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault(); width = Math.max(180, Math.min(480, width + (event.key === "ArrowLeft" ? -16 : 16))); updateVisibility(); scheduleSave();
    }, {signal});
    const resizeObserver = new ResizeObserver(() => {updateVisibility(); renderWindow();});
    resizeObserver.observe(viewport);
    narrow.addEventListener("change", () => {updateVisibility(); renderWindow(); if (shown()) void refresh();}, {signal});
    updateVisibility();
    const ready = refresh();
    return {
        ready,
        refresh,
        chooseRoot,
        freeze(value: boolean) {frozen = value; element.inert = value; toggle.disabled = value; updateVisibility();},
        destroy() {
            if (disposed) return;
            saveView(); disposed = true; version++; refreshSequence++;
            clearTimeout(saveTimer); cancelAnimationFrame(frame); events.abort(); resizeObserver.disconnect();
            element.parentElement?.classList.remove("markdown-workspace--drawer");
            if (element.parentElement) for (const sibling of Array.from(element.parentElement.children)) {
                if (sibling !== element) (sibling as HTMLElement).inert = frozen;
            }
        },
    };
};

export type MarkdownTree = ReturnType<typeof createMarkdownTree>;
