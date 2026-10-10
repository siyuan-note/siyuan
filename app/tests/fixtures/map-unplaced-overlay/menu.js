(() => {
    const bridge = window.unplacedMenu;
    const input = document.getElementById("search");
    const rows = document.getElementById("rows");
    const status = document.getElementById("status");
    const more = document.getElementById("more");
    let composing = false, timer, first = true, lastQuery = "", state, pending = false, awaitingSearch = false, searchSent = false;
    const disableRows = () => { for (const row of rows.children) row.disabled = true; };
    const search = () => {
        clearTimeout(timer);
        pending = true;
        awaitingSearch = true;
        searchSent = false;
        bridge.editing();
        disableRows();
        more.disabled = true;
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
        bridge.editing();
    });
    input.addEventListener("compositionend", () => { composing = false; search(); });
    input.addEventListener("input", event => { if (!composing && !event.isComposing) search(); });
    more.addEventListener("click", () => {
        if (pending || !state || more.disabled) return;
        pending = true;
        disableRows();
        more.disabled = true;
        if (state.error) bridge.search(lastQuery); else bridge.more();
    });
    document.getElementById("close").addEventListener("click", () => bridge.close("button"));
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
    window.addEventListener("pagehide", () => { clearTimeout(timer); state = undefined; });
    bridge.subscribe(value => {
        if (composing || awaitingSearch && (!searchSent || value.query !== lastQuery)) return;
        state = value;
        pending = value.loading;
        if (!value.loading) awaitingSearch = false;
        document.documentElement.dataset.theme = value.theme.mode;
        document.documentElement.dataset.fontSize = String(value.theme.fontSize);
        document.title = value.labels.title;
        document.getElementById("title").textContent = value.labels.title;
        document.getElementById("count").textContent = value.loading ? "" : String(value.total);
        input.placeholder = value.labels.search;
        input.setAttribute("aria-label", value.labels.search);
        if (first) { input.value = value.query; lastQuery = value.query; }
        const focusedID = document.activeElement?.dataset?.rowId;
        rows.replaceChildren();
        for (const row of value.rows) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "b3-menu__item";
            button.dataset.rowId = row.id;
            button.disabled = value.loading || value.error;
            const label = document.createElement("span");
            label.className = "b3-menu__label";
            label.textContent = row.label;
            button.append(label);
            button.addEventListener("click", () => { if (!pending && !button.disabled) bridge.select(row.id); });
            rows.append(button);
            if (focusedID === row.id) button.focus();
        }
        status.textContent = value.loading ? value.labels.loading : value.error ? value.labels.retry : value.rows.length ? "" : value.labels.empty;
        more.textContent = value.error ? value.labels.retry : value.labels.more;
        more.hidden = !value.error && (value.page * 50 >= value.total || value.rows.length >= 500);
        more.disabled = value.loading;
        document.getElementById("close").textContent = value.labels.close;
        if (first) { first = false; input.focus(); }
    });
})();
