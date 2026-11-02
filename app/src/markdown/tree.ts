import {getDocTreeWindow} from "../layout/dock/docTree/DocTreeModel";
import {animateMarkdownTreeRows} from "./treeAnimation";
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
    toggles: HTMLButtonElement[];
    bridge: MarkdownTreeBridge;
    text(key: string): string;
    mobile: boolean;
    onOpen(location: MarkdownTreeLocation): Promise<boolean>;
    onError(): void;
}) => {
    const {element, toggles, bridge, text} = options;
    let activeToggle = toggles[0];
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
    for (const toggle of toggles) {
        toggle.setAttribute("aria-label", text("markdownFiles"));
        toggle.setAttribute("aria-controls", element.id);
        toggle.title = text("markdownFiles");
    }
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
    let interaction = 0;
    let finishAnimation: () => void;
    let saveTimer: ReturnType<typeof setTimeout>;
    let state: MarkdownTreeState = {kind: "empty", generation: 0, expanded: [], width, visible: true};
    let expanded = new Set<string>();
    const children = new Map<string, MarkdownTreeNode[]>();
    const errors = new Map<string, string>();
    const pending = new Map<string, {done: Promise<void>}>();
    const expanding = new Map<string, object>();
    let rows: TreeRow[] = [];
    const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: "base"});
    const location = (nodeId: string): MarkdownTreeLocation => ({rootId: state.rootId, generation: state.generation, nodeId});
    const shown = () => drawer() ? drawerOpen : desktopVisible;
    const stopAnimation = () => {finishAnimation?.(); finishAnimation = undefined;};
    const rowHeight = () => Math.max(28, parseFloat(getComputedStyle(element).getPropertyValue("--b3-ui-list-height")) || (drawer() ? 44 : 28)) + 2;
    const updateVisibility = () => {
        const visible = shown();
        if (!visible) stopAnimation();
        element.hidden = !visible;
        element.dataset.drawer = String(drawer());
        element.style.setProperty("--markdown-tree-width", `${width}px`);
        element.parentElement.classList.toggle("markdown-workspace--drawer", drawer() && visible);
        for (const sibling of Array.from(element.parentElement.children)) {
            if (sibling !== element) (sibling as HTMLElement).inert = frozen || drawer() && visible;
        }
        for (const toggle of toggles) {
            const labelOnly = toggle.dataset.drawerToggle === "true" && !drawer();
            toggle.disabled = frozen || labelOnly;
            toggle.tabIndex = labelOnly ? -1 : 0;
            toggle.classList.toggle("markdown-heading--label", labelOnly);
            if (labelOnly) {
                toggle.removeAttribute("aria-label");
                toggle.removeAttribute("aria-controls");
                toggle.removeAttribute("aria-expanded");
            } else {
                toggle.setAttribute("aria-label", text("markdownFiles"));
                toggle.setAttribute("aria-controls", element.id);
                toggle.setAttribute("aria-expanded", String(visible));
            }
            toggle.title = labelOnly ? (state.rootName ?? "") : text("markdownFiles");
        }
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
        stopAnimation();
        const active = viewport.contains(document.activeElement);
        const height = rowHeight();
        const range = getDocTreeWindow(rows.length, viewport.scrollTop, viewport.clientHeight, height);
        const fragment = document.createDocumentFragment();
        viewport.removeAttribute("aria-activedescendant");
        const spacer = (size: number) => {const item = document.createElement("div"); item.dataset.treeSpacer = "true"; item.style.height = `${size}px`; item.setAttribute("role", "presentation"); fragment.append(item);};
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
                if (directory) {
                    item.setAttribute("aria-expanded", String(expanded.has(node.id)));
                    item.setAttribute("aria-busy", String(pending.has(node.id)));
                }
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
            if (node.kind !== "directory" || !expanded.has(node.id) || expanding.has(node.id)) return;
            if (errors.has(node.id)) rows.push({depth: depth + 1, parent: node.id, message: errors.get(node.id), retry: true});
            else if (!children.has(node.id)) rows.push({depth: depth + 1, message: text("loading")});
            else children.get(node.id).forEach(child => visit(child, depth + 1));
        };
        if (state.kind === "ready") {
            if (errors.has(state.rootId)) rows.push({depth: 0, parent: state.rootId, message: errors.get(state.rootId), retry: true});
            else if (!children.has(state.rootId)) rows.push({depth: 0, message: text("loading")});
            else children.get(state.rootId).forEach(child => visit(child, 0));
        }
        if (!rows.some(row => row.node?.id === focused)) {
            focused = rows.find(row => row.node?.id === selected)?.node?.id ?? rows.find(row => row.node)?.node?.id;
        }
        renderWindow();
    };
    const discard = (nodeId: string) => {
        const previous = children.get(nodeId);
        children.delete(nodeId); pending.delete(nodeId); errors.delete(nodeId); expanded.delete(nodeId); expanding.delete(nodeId);
        previous?.forEach(child => {if (child.kind === "directory") discard(child.id);});
    };
    const load = async (nodeId: string, force = false) => {
        if (disposed || state.kind !== "ready") return;
        if (pending.has(nodeId)) return pending.get(nodeId).done;
        if (!force && children.has(nodeId)) return;
        const expected = version;
        const request = location(nodeId);
        let complete: () => void;
        const token = {done: new Promise<void>(resolve => {complete = resolve;})};
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
            complete();
        }
    };
    const applyState = (next: MarkdownTreeState, force = false) => {
        const changed = state.rootId !== next.rootId || state.generation !== next.generation;
        if (!initialized) {width = Math.max(180, Math.min(480, next.width || 240)); desktopVisible = next.visible; initialized = true;}
        if (changed || force) {version++; pending.clear(); errors.clear(); expanding.clear(); interaction++;}
        if (changed) {children.clear(); viewport.scrollTop = 0;}
        if (changed) expanded = new Set(next.expanded.slice(-256));
        if (changed || selected !== next.currentNodeId) {
            if (next.rootId) expanded.add(next.rootId);
            next.currentPath?.forEach(id => expanded.add(id));
        }
        selected = next.currentNodeId;
        if (!focused || changed) focused = selected || next.rootId;
        state = next;
        if (next.rootId) expanded.add(next.rootId);
        viewport.setAttribute("aria-label", next.rootName ? `${text("markdownFiles")}: ${next.rootName}` : text("markdownFiles"));
        viewport.title = next.rootName ?? "";
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
    // 在同一授权根目录中切文档只更新选中状态；已加载时保留行节点、展开目录及滚动位置。
    const syncSelection = async () => {
        const sequence = ++refreshSequence;
        try {
            const next = await bridge.state();
            if (disposed || sequence !== refreshSequence) return;
            const sameRoot = state.kind === "ready" && next.kind === "ready" &&
                state.rootId === next.rootId && state.generation === next.generation;
            const pathReady = sameRoot && (next.currentPath ?? []).every(id => expanded.has(id) && children.has(id));
            if (!pathReady) {
                await applyState(next, !sameRoot);
                if (sameRoot) await Promise.all((next.currentPath ?? []).map(id => load(id)));
                return;
            }
            state = next;
            selected = next.currentNodeId;
            if (rows.some(row => row.node?.id === selected)) focused = selected;
            viewport.querySelectorAll<HTMLElement>("[data-node-id]").forEach(item => {
                const active = item.dataset.nodeId === selected;
                item.setAttribute("aria-selected", String(active));
                item.classList.toggle("b3-list-item--focus", active);
            });
            const focus = Array.from(viewport.querySelectorAll<HTMLElement>("[data-node-id]")).find(item => item.dataset.nodeId === focused);
            if (focus) viewport.setAttribute("aria-activedescendant", focus.id);
            else viewport.removeAttribute("aria-activedescendant");
            updateFocus();
        } catch {if (!disposed && sequence === refreshSequence) options.onError();}
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
        stopAnimation();
        const action = ++interaction;
        const expected = version;
        const position = rows.findIndex(row => row.node?.id === id);
        if (position < 0) return;
        const subtreeSize = () => {
            let end = position + 1;
            while (end < rows.length && rows[end].depth > rows[position].depth) end++;
            return end - position - 1;
        };
        const animate = (count: number, snapshot: Array<{position: number; element: HTMLElement}> = []) => {
            const bounds = list.querySelector<HTMLElement>(`[data-row="${position}"]`)?.getBoundingClientRect();
            const view = viewport.getBoundingClientRect();
            if (action === interaction && bounds && bounds.top >= view.top && bounds.bottom <= view.bottom) {
                finishAnimation = animateMarkdownTreeRows(list, position + 1, count, open, rowHeight(), snapshot);
            }
        };
        if (open) {
            if (expanded.has(id)) return;
            const intent = {};
            expanding.set(id, intent);
            expanded.add(id);
            void load(id, true).then(() => {
                if (disposed || expected !== version || expanding.get(id) !== intent) return;
                expanding.delete(id);
                project();
                if (rows[position]?.node?.id === id && shown() && !frozen) animate(subtreeSize());
            });
        } else {
            const count = subtreeSize();
            const snapshot = Array.from(list.querySelectorAll<HTMLElement>("[data-row]")).map(item => ({position: Number(item.dataset.row), element: item}))
                .filter(item => item.position > position && item.position <= position + count)
                .map(item => ({position: item.position, element: item.element.cloneNode(true) as HTMLElement}));
            expanded.delete(id); expanding.delete(id);
            project(); animate(count, snapshot);
        }
        if (expanded.size > 256) expanded.delete(expanded.values().next().value);
        scheduleSave();
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
    viewport.addEventListener("scroll", () => {stopAnimation(); interaction++; cancelAnimationFrame(frame); frame = requestAnimationFrame(renderWindow);}, {passive: true, signal});
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
        const folding = event.key === "ArrowRight" && row.node.kind === "directory" || event.key === "ArrowLeft" && expanded.has(row.node.id) ||
            ["Enter", " "].includes(event.key) && row.node.kind === "directory";
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
        const height = rowHeight();
        if (position * height < viewport.scrollTop) viewport.scrollTop = position * height;
        else if ((position + 1) * height > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = (position + 1) * height - viewport.clientHeight;
        if (folding) updateFocus(); else renderWindow();
    }, {signal});
    const hideDrawer = (restoreFocus = true) => {if (drawerOpen) {drawerOpen = false; updateVisibility(); if (restoreFocus) activeToggle.focus();}};
    const insideToggle = (target: EventTarget) => toggles.some(toggle => toggle.contains(target as Node));
    document.addEventListener("focusin", event => {
        if (drawer() && drawerOpen && !element.contains(event.target as Node) && !insideToggle(event.target)) hideDrawer(false);
    }, {signal});
    document.addEventListener("pointerdown", event => {
        if (drawer() && drawerOpen && !element.contains(event.target as Node) && !insideToggle(event.target)) hideDrawer();
    }, {signal});
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && drawer() && drawerOpen) {event.preventDefault(); hideDrawer();}
    }, {signal});
    for (const toggle of toggles) toggle.addEventListener("click", () => {
        if (frozen || toggle.disabled) return;
        activeToggle = toggle;
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
        syncSelection,
        chooseRoot,
        freeze(value: boolean) {frozen = value; if (value) {interaction++; stopAnimation();} element.inert = value; toggles.forEach(toggle => {toggle.disabled = value;}); updateVisibility();},
        destroy() {
            if (disposed) return;
            saveView(); disposed = true; version++; refreshSequence++; stopAnimation(); expanding.clear();
            clearTimeout(saveTimer); cancelAnimationFrame(frame); events.abort(); resizeObserver.disconnect();
            element.parentElement?.classList.remove("markdown-workspace--drawer");
            if (element.parentElement) for (const sibling of Array.from(element.parentElement.children)) {
                if (sibling !== element) (sibling as HTMLElement).inert = frozen;
            }
        },
    };
};

export type MarkdownTree = ReturnType<typeof createMarkdownTree>;
