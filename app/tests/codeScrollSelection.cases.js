module.exports = async () => {
    const assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const load = window.navigationModules;
    const {scrollCenter} = load("util/codeScrollCenter");
    const {focusAdjacentVerticalRegion} = load("wysiwyg/verticalNavigation");
    const {isCaretAtVerticalBoundary} = load("wysiwyg/verticalCaret");
    const {focusByRange} = load("util/selectionOffsets");
    const setup = (markup, whiteSpace, title = "") => {
        document.body.innerHTML = `<div class="protyle-content" style="height:200px;width:500px;overflow:auto">
            <div class="protyle-wysiwyg" contenteditable="true" style="font:20px/30px monospace">
                <div class="code-block" data-node-id="code" data-type="NodeCodeBlock">
                    <div class="hljs" style="overflow:auto;max-height:90px"><div class="fn__none"></div><div contenteditable="true" style="white-space:${whiteSpace}">${markup}</div></div>
                </div>
                <div class="av" contenteditable="false" data-node-id="av" data-type="NodeAttributeView">
                    <div><div data-type="av-search" contenteditable="plaintext-only" style="width:0"></div></div>
                    <div class="av__title" contenteditable="true" style="min-height:30px">${title}</div>
                    <div class="av__cursor" contenteditable="true">\u200b</div>
                </div>
            </div></div>`;
        const editor = document.querySelector(".protyle-wysiwyg");
        const block = editor.firstElementChild;
        const code = block.querySelector(".hljs").lastElementChild;
        const protyle = {contentElement: editor.parentElement, wysiwyg: {element: editor}};
        editor.focus();
        return {protyle, editor, block, code};
    };
    const point = (code, offset) => {
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && offset > node.textContent.length) {
            offset -= node.textContent.length;
            node = walker.nextNode();
        }
        return [node || code, offset];
    };
    const offset = (code, node, position) => {
        const prefix = document.createRange();
        prefix.selectNodeContents(code);
        prefix.setEnd(node, position);
        return prefix.toString().length;
    };
    let cases = 0;
    // 粘贴后的异步滚动必须保留折叠光标，才能继续经过正文的数据库边界导航。
    for (const whiteSpace of ["pre", "pre-wrap"]) {
        for (const markup of ["abcxyz\n", "<span>abc</span><span>xyz</span>\n", "abc\n\n", "\n"]) {
            for (const title of ["", "database title"]) {
                const {protyle, editor, block, code} = setup(markup, whiteSpace, title);
                const range = document.createRange();
                const end = code.textContent.length - 1;
                range.setStart(...point(code, end));
                range.collapse(true);
                focusByRange(range);
                editor.addEventListener("keydown", event => {
                    const current = getSelection().getRangeAt(0);
                    if (event.key === "ArrowDown" && current.collapsed &&
                        isCaretAtVerticalBoundary(code, current, "down") &&
                        focusAdjacentVerticalRegion(protyle, block, "down", 20, current.startContainer) === "moved") {
                        protyle.wysiwyg.preventKeyup = true;
                        event.preventDefault();
                    }
                });
                window.navigationKeyup.bind(protyle);
                // 在独立事件轮次中执行实际滚动入口，覆盖粘贴完成后延迟回调的选区生命周期。
                await new Promise(resolve => setTimeout(() => {
                    scrollCenter(protyle, undefined, "nearest", "smooth");
                    resolve();
                }, 0));
                const selection = getSelection();
                assert.equal(selection.isCollapsed, true, `${whiteSpace}/${markup}: scrolling expanded the caret`);
                assert.equal(offset(code, selection.anchorNode, selection.anchorOffset), end);
                assert.equal(code.textContent, markup.replace(/<[^>]+>/g, ""));
                assert.equal(code.querySelector("br"), null);
                await ipcRenderer.invoke("vertical-navigation-key", "Down");
                assert.ok(editor.querySelector(".av__title").contains(getSelection().anchorNode));
                assert.notEqual(document.activeElement.dataset.type, "av-search");
                cases++;
            }
        }
    }
    // 滚动不能改变真实文字选区或反向选择的锚点，也不能重置代码块横向滚动。
    for (const backward of [false, true]) {
        const {protyle, code} = setup("<span>abc</span><span>xyz</span>\n" + "long ".repeat(100) + "\n", "pre");
        const selection = getSelection();
        const start = point(code, 2);
        const end = point(code, 5);
        selection.setBaseAndExtent(...(backward ? end : start), ...(backward ? start : end));
        const text = selection.toString();
        const html = code.innerHTML;
        const scroller = code.parentElement;
        scroller.scrollLeft = 40;
        scrollCenter(protyle);
        assert.equal(selection.isCollapsed, false);
        assert.equal(selection.toString(), text);
        assert.equal(offset(code, selection.anchorNode, selection.anchorOffset), backward ? 5 : 2);
        assert.equal(offset(code, selection.focusNode, selection.focusOffset), backward ? 2 : 5);
        assert.equal(code.innerHTML, html);
        assert.equal(scroller.scrollLeft, 40);
        cases++;
    }
    return cases;
};
