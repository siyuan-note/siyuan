import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getLiteFragmentHost} from "./liteFragment";

interface ITestElement {
    className: string;
    parentElement: ITestElement | null;
    classList: { contains: (className: string) => boolean };
}

// 模拟 DOM：非片段内容向上查找时以 null 结束
const createElement = (className: string, parentElement: ITestElement | null = null): ITestElement => {
    const element: ITestElement = {
        className,
        parentElement,
        classList: {
            contains: (name: string) => element.className.split(" ").includes(name),
        },
    };
    return element;
};

describe("getLiteFragmentHost", () => {
    it("resolves the fragment host from content inside a table cell editor", () => {
        const documentWysiwyg = createElement("protyle-wysiwyg");
        const tableBlock = createElement("table", documentWysiwyg);
        const cell = createElement("", tableBlock);
        const host = createElement("table__cell-editor protyle-lite-fragment", cell);
        const fragmentWysiwyg = createElement("protyle-wysiwyg", host);
        const paragraph = createElement("p", fragmentWysiwyg);

        assert.equal(getLiteFragmentHost(paragraph as unknown as HTMLElement), host);
        assert.equal(getLiteFragmentHost(fragmentWysiwyg as unknown as HTMLElement), host);
        assert.equal(getLiteFragmentHost(host as unknown as HTMLElement), host);
    });

    it("keeps the outermost fragment host when fragments are nested", () => {
        const outerHost = createElement("table__cell-editor protyle-lite-fragment");
        const outerWysiwyg = createElement("protyle-wysiwyg", outerHost);
        const innerHost = createElement("av__cell-editor protyle-lite-fragment", outerWysiwyg);
        const innerWysiwyg = createElement("protyle-wysiwyg", innerHost);
        const paragraph = createElement("p", innerWysiwyg);

        assert.equal(getLiteFragmentHost(paragraph as unknown as HTMLElement), outerHost);
    });

    it("returns undefined for content that is not inside a fragment", () => {
        const wysiwyg = createElement("protyle-wysiwyg");
        const heading = createElement("h2", wysiwyg);

        assert.equal(getLiteFragmentHost(heading as unknown as HTMLElement), undefined);
    });
});
