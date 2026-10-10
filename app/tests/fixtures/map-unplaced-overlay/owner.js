(() => {
    const bridge = window.fixtureOwner;
    const toggle = document.getElementById("open");
    const result = document.getElementById("result");
    const records = Array.from({length: 123}, (_, index) => ({id: "row-" + index,
        title: index === 0 ? "PRIVATE_FIXTURE <img src=x onerror=alert(1)>" : "合成记录 " + index}));
    const labels = {title: "未定位记录", search: "搜索", empty: "没有记录", loading: "加载中...", more: "下一页", previous: "上一页", retry: "重试", close: "关闭"};
    let sessionID, revision = 0, requestID = 0, page = 1, query = "", timer, generation = 0, opening = false;
    let theme = {mode: "light", fontSize: 16};
    const anchor = () => {
        const rect = toggle.getBoundingClientRect();
        const viewport = document.getElementById("scroll").getBoundingClientRect();
        const x = Math.max(0, rect.left, viewport.left), y = Math.max(0, rect.top, viewport.top);
        const right = Math.min(window.innerWidth, rect.right, viewport.right);
        const bottom = Math.min(window.innerHeight, rect.bottom, viewport.bottom);
        if (right <= x || bottom <= y) return;
        return {x, y, width: right - x, height: bottom - y};
    };
    const state = (loading = false) => {
        const filtered = records.filter(row => row.title.includes(query));
        return {revision: ++revision, requestID, query, page, total: filtered.length,
            rows: loading ? [] : filtered.slice((page - 1) * 50, page * 50), loading, error: false, theme, labels};
    };
    const update = loading => { if (sessionID) bridge.update({sessionID, state: state(loading)}); };
    const geometry = () => {
        if (!sessionID) return;
        const next = anchor();
        if (next) bridge.anchor({sessionID, anchor: next});
        else bridge.close({sessionID, reason: "anchor-hidden"});
    };
    toggle.addEventListener("click", async () => {
        if (opening) return;
        if (sessionID) { bridge.close({sessionID, reason: "button"}); return; }
        const position = anchor();
        if (!position) return;
        opening = true;
        requestID = 0;
        page = 1;
        query = "";
        try { sessionID = await bridge.open({state: state(), anchor: position}); }
        finally { opening = false; }
        toggle.setAttribute("aria-expanded", String(!!sessionID));
    });
    bridge.subscribe(message => {
        if (message.type === "closed") {
            if (message.sessionID !== sessionID) return;
            sessionID = undefined;
            clearTimeout(timer);
            generation++;
            toggle.setAttribute("aria-expanded", "false");
            if (message.restore) toggle.focus();
            result.textContent = "关闭：" + message.reason;
            return;
        }
        if (message.type === "select") {
            if (message.sessionID !== sessionID) return;
            sessionID = undefined;
            generation++;
            clearTimeout(timer);
            toggle.setAttribute("aria-expanded", "false");
            toggle.focus();
            result.textContent = "已选择合成记录：" + message.id;
            return;
        }
        if (message.sessionID !== sessionID) return;
        clearTimeout(timer);
        const current = ++generation;
        requestID = message.requestID;
        if (message.type === "editing") return;
        query = message.query;
        page = message.page;
        update(true);
        timer = setTimeout(() => { if (current === generation && sessionID === message.sessionID) update(false); }, 150);
    });
    document.getElementById("theme").addEventListener("click", () => {
        theme = {mode: theme.mode === "light" ? "dark" : "light", fontSize: theme.fontSize === 16 ? 24 : 16};
        if (sessionID) bridge.theme({sessionID, theme});
    });
    document.getElementById("zoom").addEventListener("click", () => { bridge.zoom(); setTimeout(geometry, 50); });
    document.getElementById("permission").addEventListener("click", () => bridge.permission());
    window.addEventListener("scroll", geometry, true);
    document.addEventListener("pointerdown", event => {
        if (sessionID && !toggle.contains(event.target)) bridge.close({sessionID, reason: "outside"});
    }, true);
    window.addEventListener("resize", geometry);
    window.addEventListener("pagehide", () => { clearTimeout(timer); generation++; });
})();
