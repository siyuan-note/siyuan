import * as assert from "node:assert/strict";
import {test} from "node:test";
import {browserSources, runBrowserCase} from "../../datePicker/test/browser";

test("iOS selection handles on sheet padding remain native", async () => {
    const sources = browserSources({
        "./bindBottomSheetDrag": "src/mobile/util/bindBottomSheetDrag.ts",
        "./mobileSheetGesture": "src/mobile/util/mobileSheetGesture.ts",
        "../../protyle/util/browserCompatibility": "src/protyle/util/browserCompatibility.ts",
        "../../protyle/wysiwyg/nativeTextMenu": "src/protyle/wysiwyg/nativeTextMenu.ts",
    });
    const output = await runBrowserCase(async sources => {
        const load = (name: string) => {
            const exports = {};
            new Function("exports", "require", sources[name])(exports, load);
            return exports;
        };
        const {bindBottomSheetDrag} = load("./bindBottomSheetDrag") as typeof import("./bindBottomSheetDrag");
        document.body.innerHTML = `<div id="scrim"></div><div id="sheet" style="width:320px;height:240px;padding:16px">
            <div class="protyle"><div class="protyle-wysiwyg"><div contenteditable="true" style="font:20px/24px sans-serif">alpha beta</div></div></div>
        </div>`;
        const sheet = document.querySelector<HTMLElement>("#sheet");
        const scrim = document.querySelector<HTMLElement>("#scrim");
        const editable = document.querySelector<HTMLElement>("[contenteditable]");
        editable.focus();
        const range = document.createRange();
        range.setStart(editable.firstChild, 0);
        range.setEnd(editable.firstChild, 5);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const rect = range.getBoundingClientRect();
        let closes = 0;
        const dispose = bindBottomSheetDrag(sheet, scrim, async () => {
            closes++;
            return false;
        });
        const drag = async (clientX: number, clientY: number) => {
            const target = document.elementFromPoint(clientX, clientY);
            if (target !== sheet) throw new Error("Expected the touch to hit sheet padding");
            const send = (type: string, y: number) => {
                const point = new Touch({identifier: 1, target, clientX, clientY: y});
                const event = new TouchEvent(type, {bubbles: true, cancelable: true,
                    touches: type === "touchend" ? [] : [point], changedTouches: [point]});
                target.dispatchEvent(event);
                return event.defaultPrevented;
            };
            send("touchstart", clientY);
            const prevented = send("touchmove", clientY + 80);
            const transform = sheet.style.transform;
            const previousCloses = closes;
            send("touchend", clientY + 80);
            await new Promise(resolve => setTimeout(resolve, 0));
            return {prevented, transform, closed: closes > previousCloses};
        };
        Object.defineProperty(navigator, "userAgent", {configurable: true, value: "iPhone"});
        const start = await drag(rect.left, rect.top - 6);
        const end = await drag(rect.right, rect.bottom + 6);
        const away = await drag(rect.right + 80, rect.bottom + 6);
        Object.defineProperty(navigator, "userAgent", {value: "Android"});
        const android = await drag(rect.right, rect.bottom + 6);
        dispose();
        return JSON.stringify({start, end, away, android});
    }, sources);
    const native = {prevented: false, transform: "", closed: false};
    const sheet = {prevented: true, transform: "translateY(80px)", closed: true};
    assert.deepEqual(JSON.parse(output), {start: native, end: native, away: sheet, android: sheet});
});
