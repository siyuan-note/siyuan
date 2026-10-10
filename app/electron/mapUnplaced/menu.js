(() => {
    const bridge = window.unplacedMenu;
    const menu = document.getElementById("menu");
    const input = document.getElementById("search");
    const rows = document.getElementById("rows");
    const status = document.getElementById("status");
    const more = document.getElementById("more");
    const previous = document.getElementById("previous");
    let composing = false, timer, first = true, lastQuery = "", state, pending = false, awaitingSearch = false, searchSent = false;
    let reportedHeight = 0, reportedRevision = -1;
    const resize = () => {
        if (!state) return;
        // 临时解除当前原生窗口的高度限制，测量后立即恢复，避免逐次缩小。
        menu.classList.add("map-unplaced-menu--measure");
        const height = Math.max(50, Math.min(4096, Math.ceil(menu.getBoundingClientRect().height + 48)));
        menu.classList.remove("map-unplaced-menu--measure");
        if (height !== reportedHeight || state.revision !== reportedRevision) {
            reportedHeight = height;
            reportedRevision = state.revision;
            bridge.resize(height);
        }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(menu);
    const icon = (name, className) => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", className);
        svg.setAttribute("aria-hidden", "true");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#" + name);
        svg.append(use);
        return svg;
    };
    const disableRows = () => { for (const row of rows.children) row.disabled = true; };
    const search = () => {
        clearTimeout(timer);
        pending = true;
        awaitingSearch = true;
        searchSent = false;
        bridge.editing();
        disableRows();
        more.disabled = true;
        previous.disabled = true;
        timer = setTimeout(() => {
            lastQuery = input.value.trim();
            searchSent = true;
            bridge.search(lastQuery);
        }, 200);
    };
    input.addEventListener("compositionstart", () => {
        composing = true;
        pending = true;
        awaitingSearch = true;
        searchSent = false;
        clearTimeout(timer);
        disableRows();
        more.disabled = true;
        previous.disabled = true;
        bridge.editing();
    });
    input.addEventListener("compositionend", () => { composing = false; search(); });
    input.addEventListener("input", event => { if (!composing && !event.isComposing) search(); });
    more.addEventListener("click", () => {
        if (pending || !state || more.disabled) return;
        pending = true;
        disableRows();
        more.disabled = true;
        previous.disabled = true;
        if (state.error) bridge.retry(); else bridge.more();
    });
    previous.addEventListener("click", () => {
        if (pending || !state || previous.disabled) return;
        pending = true;
        disableRows();
        more.disabled = true;
        previous.disabled = true;
        bridge.previous();
    });
    document.getElementById("close").addEventListener("click", () => bridge.close("button"));
    document.addEventListener("pointerdown", event => {
        if (!menu.contains(event.target)) bridge.close("button");
    });
    // 共享 reset 去掉原生 outline；键盘焦点复用菜单已有的 current 状态反馈。
    document.addEventListener("focusin", event => {
        if (event.target.classList?.contains("b3-menu__item")) event.target.classList.add("b3-menu__item--current");
    });
    document.addEventListener("focusout", event => {
        event.target.classList?.remove("b3-menu__item--current");
    });
    document.addEventListener("keydown", event => {
        if (event.isComposing || composing) return;
        if (event.key === "Escape") { event.preventDefault(); bridge.close("escape"); return; }
        if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
        const buttons = Array.from(rows.children).filter(row => !row.disabled);
        if (!buttons.length) return;
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : (index < 0 ? buttons.length - 1 : (index + buttons.length - 1) % buttons.length);
        event.preventDefault();
        buttons[next].focus();
    });
    window.addEventListener("pagehide", () => { clearTimeout(timer); observer.disconnect(); state = undefined; });
    const applyTheme = theme => {
        document.documentElement.dataset.theme = theme.mode;
        document.documentElement.dataset.themeMode = theme.mode;
        document.documentElement.dataset.fontSize = String(theme.fontSize);
        resize();
    };
    bridge.subscribe(value => {
        applyTheme(value.theme);
        if (composing || awaitingSearch && (!searchSent || value.query !== lastQuery)) return;
        state = value;
        pending = value.loading;
        if (!value.loading) awaitingSearch = false;
        document.title = value.labels.title;
        document.getElementById("title").textContent = value.labels.title;
        document.getElementById("count").textContent = value.loading ? "" : String(value.total);
        document.getElementById("count").hidden = value.loading;
        input.placeholder = value.labels.search;
        input.setAttribute("aria-label", value.labels.search);
        if (first) { input.value = value.query; lastQuery = value.query; }
        const focusedID = document.activeElement?.dataset?.rowId;
        rows.replaceChildren();
        for (const row of value.rows) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "b3-menu__item av-records-panel-item";
            button.dataset.rowId = row.id;
            button.disabled = value.loading || value.error;
            const label = document.createElement("span");
            label.className = "b3-menu__label";
            label.textContent = row.title;
            button.append(icon("iconFile", "b3-menu__icon"));
            button.append(label);
            const open = document.createElement("span");
            open.className = "block__icon block__icon--show";
            open.setAttribute("aria-hidden", "true");
            open.append(icon("iconOpen", ""));
            button.append(open);
            button.addEventListener("click", () => { if (!pending && !button.disabled) bridge.select(row.id); });
            rows.append(button);
            if (focusedID === row.id) button.focus();
        }
        status.textContent = value.loading ? value.labels.loading : value.error ? value.labels.retry : value.rows.length ? "" : value.labels.empty;
        status.hidden = !status.textContent;
        more.textContent = value.error ? value.labels.retry : value.labels.more;
        more.hidden = !value.error && value.page * 50 >= value.total;
        more.disabled = value.loading;
        previous.textContent = value.labels.previous;
        previous.hidden = value.page <= 1;
        previous.disabled = value.loading;
        document.getElementById("close").textContent = value.labels.close;
        if (first) { first = false; input.focus(); }
        resize();
    }, applyTheme);
})();
