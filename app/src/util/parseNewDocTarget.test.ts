import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getNewDocTargetFromSavePath, getNewDocTargetFromTree, NewDocTarget} from "./parseNewDocTarget";

const assertSubDoc = (target: NewDocTarget, expected: {
    targetNotebookId?: string;
    parentPath: string;
    title: string;
}) => {
    assert.equal(target.kind, "subDoc");
    if (target.kind === "subDoc") {
        if (expected.targetNotebookId !== undefined) {
            assert.equal(target.targetNotebookId, expected.targetNotebookId);
        }
        assert.equal(target.parentPath, expected.parentPath);
        assert.equal(target.title, expected.title);
    }
};

const assertHPath = (target: NewDocTarget, expected: {
    targetNotebookId?: string;
    hPath: string;
    title: string;
}) => {
    assert.equal(target.kind, "hPath");
    if (target.kind === "hPath") {
        if (expected.targetNotebookId !== undefined) {
            assert.equal(target.targetNotebookId, expected.targetNotebookId);
        }
        assert.equal(target.hPath, expected.hPath);
        assert.equal(target.title, expected.title);
    }
};

describe("getNewDocTargetFromSavePath", () => {
    // 聚焦嵌套文档：内核路径与人类路径成对出现
    const nestedDocPath = "/20260628041644-ndcuikw/20260628040939-kkaajwr.sy";
    const nestedHPath = "/parent1/parent2/docName";
    // 聚焦根级文档
    const rootDocPath = "/20260628041702-kqfrg7p.sy";
    const rootHPath = "/docName";
    const notebookId = "nb";

    const nestedContext = {
        hPath: nestedHPath,
        targetNotebookId: notebookId,
        currentNotebookId: notebookId,
        hasFocusTarget: true,
        currentPath: nestedDocPath,
    };

    describe("空模板", () => {
        it("有页签/选中 + 无 name → 当前文档下子文档", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: ""});
            assertSubDoc(target, {targetNotebookId: notebookId, parentPath: nestedDocPath, title: ""});
        });

        it("有页签/选中 + 显式标题 → 当前 hPath 下按名称新建", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "", name: "docName2"});
            assertHPath(target, {hPath: "/parent1/parent2/docName/docName2", title: "docName2"});
        });

        it("聚焦根级文档 + 无 name → 子文档", () => {
            const target = getNewDocTargetFromSavePath({
                ...nestedContext,
                templatePath: "",
                hPath: rootHPath,
                currentPath: rootDocPath,
            });
            assertSubDoc(target, {parentPath: rootDocPath, title: ""});
        });

        it("聚焦根级文档 + 显式标题 → 当前 hPath 下按名称新建", () => {
            const target = getNewDocTargetFromSavePath({
                ...nestedContext,
                templatePath: "",
                hPath: rootHPath,
                currentPath: rootDocPath,
                name: "docName2",
            });
            assertHPath(target, {hPath: "/docName/docName2", title: "docName2"});
        });

        it("选中笔记本根（currentPath=/）+ 无 name → 子文档", () => {
            const target = getNewDocTargetFromSavePath({
                ...nestedContext,
                templatePath: "",
                hPath: "/",
                currentPath: "/",
            });
            assertSubDoc(target, {parentPath: "/", title: ""});
        });

        it("无页签无选中 → 笔记本根", () => {
            const target = getNewDocTargetFromSavePath({
                ...nestedContext,
                templatePath: "",
                hasFocusTarget: false,
                hPath: "/",
                currentPath: "/",
            });
            assertHPath(target, {hPath: "/", title: ""});
        });

        it("无页签无选中 + 显式标题 → 笔记本根下按名称新建", () => {
            const target = getNewDocTargetFromSavePath({
                ...nestedContext,
                templatePath: "",
                hasFocusTarget: false,
                hPath: "/",
                name: "docName2",
            });
            assertHPath(target, {hPath: "/docName2", title: "docName2"});
        });
    });

    describe("容器路径（尾 /）", () => {
        it("绝对 /parent3/", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "/parent3/"});
            assertHPath(target, {hPath: "/parent3/", title: ""});
        });

        it("绝对 /parent3/ + 显式标题", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "/parent3/", name: "docName2"});
            assertHPath(target, {hPath: "/parent3/docName2", title: "docName2"});
        });

        it("绝对 /", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "/", hPath: "/"});
            assertHPath(target, {hPath: "/", title: ""});
        });

        it("绝对 /parent1/parent2/", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "/parent1/parent2/"});
            assertHPath(target, {hPath: "/parent1/parent2/", title: ""});
        });

        it("相对 parent3/", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "parent3/"});
            assertHPath(target, {hPath: "/parent1/parent2/docName/parent3/", title: ""});
        });

        it("相对 parent3/parent4/", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "parent3/parent4/"});
            assertHPath(target, {hPath: "/parent1/parent2/docName/parent3/parent4/", title: ""});
        });

        it("相对 ../", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../"});
            assertHPath(target, {hPath: "/parent1/parent2/", title: ""});
        });

        it("相对 ../ + 显式标题", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../", name: "docName2"});
            assertHPath(target, {hPath: "/parent1/parent2/docName2", title: "docName2"});
        });

        it("相对 ../../", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../../"});
            assertHPath(target, {hPath: "/parent1/", title: ""});
        });

        it("相对 ../parent3/", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../parent3/"});
            assertHPath(target, {hPath: "/parent1/parent2/parent3/", title: ""});
        });

        it("相对 ../../parent3/parent4/", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../../parent3/parent4/"});
            assertHPath(target, {hPath: "/parent1/parent3/parent4/", title: ""});
        });

        it("已在根时 ../", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../", hPath: "/"});
            assertHPath(target, {hPath: "/", title: ""});
        });

        it("模板首尾空白 trim", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "  parent3/  "});
            assertHPath(target, {hPath: "/parent1/parent2/docName/parent3/", title: ""});
        });
    });

    describe("文档名路径", () => {
        it("相对 docName2", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "docName2"});
            assertHPath(target, {hPath: "/parent1/parent2/docName/docName2", title: "docName2"});
        });

        it("相对 docName2 + 显式标题替换末段", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "docName2", name: "docName3"});
            assertHPath(target, {hPath: "/parent1/parent2/docName/docName3", title: "docName3"});
        });

        it("模板首尾空白 trim", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "  docName2  "});
            assertHPath(target, {hPath: "/parent1/parent2/docName/docName2", title: "docName2"});
        });

        it("绝对 /docName2", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "/docName2"});
            assertHPath(target, {hPath: "/docName2", title: "docName2"});
        });

        it("绝对 /docName2 + 显式标题替换末段", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "/docName2", name: "docName3"});
            assertHPath(target, {hPath: "/docName3", title: "docName3"});
        });

        it("相对 parent3/docName2", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "parent3/docName2"});
            assertHPath(target, {hPath: "/parent1/parent2/docName/parent3/docName2", title: "docName2"});
        });

        it("绝对 /parent3/docName2", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "/parent3/docName2"});
            assertHPath(target, {hPath: "/parent3/docName2", title: "docName2"});
        });

        it("相对 ../docName2", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../docName2"});
            assertHPath(target, {hPath: "/parent1/parent2/docName2", title: "docName2"});
        });

        it("相对 ../../docName2", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../../docName2"});
            assertHPath(target, {hPath: "/parent1/docName2", title: "docName2"});
        });

        it("相对 ../parent3/docName2", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../parent3/docName2"});
            assertHPath(target, {hPath: "/parent1/parent2/parent3/docName2", title: "docName2"});
        });

        it("已在根时 ../docName2（.. 在根无效）", () => {
            const target = getNewDocTargetFromSavePath({...nestedContext, templatePath: "../docName2", hPath: "/"});
            assertHPath(target, {hPath: "/docName2", title: "docName2"});
        });
    });

    describe("跨笔记本", () => {
        const crossNotebook = {
            ...nestedContext,
            targetNotebookId: "box-b",
            currentNotebookId: "box-a",
            hPath: "/",
            currentPath: nestedDocPath,
        };

        it("相对 docName2 → 补 / 后按目标笔记本根解析", () => {
            const target = getNewDocTargetFromSavePath({...crossNotebook, templatePath: "docName2"});
            assertHPath(target, {targetNotebookId: "box-b", hPath: "/docName2", title: "docName2"});
        });

        it("相对 parent3/parent4/ → 补 / 后按目标笔记本根解析", () => {
            const target = getNewDocTargetFromSavePath({...crossNotebook, templatePath: "parent3/parent4/"});
            assertHPath(target, {targetNotebookId: "box-b", hPath: "/parent3/parent4/", title: ""});
        });

        it("相对 ../docName2 → 补 / 后 .. 在根无效", () => {
            const target = getNewDocTargetFromSavePath({...crossNotebook, templatePath: "../docName2"});
            assertHPath(target, {targetNotebookId: "box-b", hPath: "/docName2", title: "docName2"});
        });

        it("绝对 /parent3/docName2 不受影响", () => {
            const target = getNewDocTargetFromSavePath({...crossNotebook, templatePath: "/parent3/docName2"});
            assertHPath(target, {targetNotebookId: "box-b", hPath: "/parent3/docName2", title: "docName2"});
        });

        it("空模板 + 无页签无选中 + 显式标题 → 目标笔记本根下按名称新建", () => {
            const target = getNewDocTargetFromSavePath({
                ...crossNotebook,
                templatePath: "",
                hasFocusTarget: false,
                name: "docName2",
            });
            assertHPath(target, {targetNotebookId: "box-b", hPath: "/docName2", title: "docName2"});
        });

        it("空模板 + 有聚焦 + 无 name → 回退到目标笔记本根空标题文档", () => {
            const target = getNewDocTargetFromSavePath({...crossNotebook, templatePath: ""});
            assertHPath(target, {targetNotebookId: "box-b", hPath: "/", title: ""});
        });

        it("空模板 + 有聚焦 + 显式标题 → 目标笔记本根下按名称新建（跨笔记本 hPath 基点为 /）", () => {
            const target = getNewDocTargetFromSavePath({...crossNotebook, templatePath: "", name: "docName2"});
            assertHPath(target, {targetNotebookId: "box-b", hPath: "/docName2", title: "docName2"});
        });
    });
});

describe("getNewDocTargetFromTree", () => {
    const notebookId = "nb";
    // 文档树 data-path：带 .sy 的内核路径
    const parentDocPath = "/20260628041644-ndcuikw.sy";
    const nestedDocPath = "/20260628041644-ndcuikw/20260628040939-kkaajwr.sy";
    // pathPosix().dirname()：同级插入时传入的父目录（无 .sy、无尾斜杠）
    const parentDirPath = "/20260628041644-ndcuikw";
    const rootPath = "/";

    describe("文档树 + 新建子文档（currentPath 为 data-path）", () => {
        const treeContext = {currentNotebookId: notebookId, currentPath: parentDocPath};

        it("空模板", () => {
            const target = getNewDocTargetFromTree({...treeContext, templatePath: ""});
            assertSubDoc(target, {targetNotebookId: notebookId, parentPath: parentDocPath, title: ""});
        });

        it("空模板 + 显式标题", () => {
            const target = getNewDocTargetFromTree({...treeContext, templatePath: "", name: "docName2"});
            assertSubDoc(target, {parentPath: parentDocPath, title: "docName2"});
        });

        it("单段模板 docName2", () => {
            const target = getNewDocTargetFromTree({...treeContext, templatePath: "docName2"});
            assertSubDoc(target, {parentPath: parentDocPath, title: "docName2"});
        });

        it("单段模板 docName2 + 显式标题", () => {
            const target = getNewDocTargetFromTree({...treeContext, templatePath: "docName2", name: "docName3"});
            assertSubDoc(target, {parentPath: parentDocPath, title: "docName3"});
        });

        it("多段模板 parent3/docName2（仅取末段为标题，父路径不变）", () => {
            const target = getNewDocTargetFromTree({...treeContext, templatePath: "parent3/docName2"});
            assertSubDoc(target, {parentPath: parentDocPath, title: "docName2"});
        });

        it("绝对模板 /docName2（落点仍为 currentPath，仅影响标题）", () => {
            const target = getNewDocTargetFromTree({...treeContext, templatePath: "/docName2"});
            assertSubDoc(target, {parentPath: parentDocPath, title: "docName2"});
        });

        it("容器模板 docName2/（树入口不解析容器链，无 name 时空标题）", () => {
            const target = getNewDocTargetFromTree({...treeContext, templatePath: "docName2/"});
            assertSubDoc(target, {parentPath: parentDocPath, title: ""});
        });

        it("容器模板 docName2/ + 显式标题", () => {
            const target = getNewDocTargetFromTree({...treeContext, templatePath: "docName2/", name: "docName2"});
            assertSubDoc(target, {parentPath: parentDocPath, title: "docName2"});
        });

        it("模板首尾空白 trim", () => {
            const target = getNewDocTargetFromTree({...treeContext, templatePath: "  docName2  "});
            assertSubDoc(target, {parentPath: parentDocPath, title: "docName2"});
        });

        it("嵌套文档下新建子文档", () => {
            const target = getNewDocTargetFromTree({
                currentNotebookId: notebookId,
                currentPath: nestedDocPath,
                templatePath: "docName2",
            });
            assertSubDoc(target, {parentPath: nestedDocPath, title: "docName2"});
        });
    });

    describe("同级插入（currentPath 为 dirname，无 .sy）", () => {
        it("嵌套文档的同级插入", () => {
            const target = getNewDocTargetFromTree({
                currentNotebookId: notebookId,
                currentPath: parentDirPath,
                templatePath: "docName2",
            });
            assertSubDoc(target, {parentPath: parentDirPath, title: "docName2"});
        });

        it("根级文档的同级插入（dirname 为 /）", () => {
            const target = getNewDocTargetFromTree({
                currentNotebookId: notebookId,
                currentPath: rootPath,
                templatePath: "",
            });
            assertSubDoc(target, {parentPath: rootPath, title: ""});
        });
    });

    describe("笔记本根（currentPath 为 /）", () => {
        it("空模板", () => {
            const target = getNewDocTargetFromTree({
                currentNotebookId: notebookId,
                currentPath: rootPath,
                templatePath: "",
            });
            assertSubDoc(target, {parentPath: rootPath, title: ""});
        });

        it("单段模板 + 显式标题", () => {
            const target = getNewDocTargetFromTree({
                currentNotebookId: notebookId,
                currentPath: rootPath,
                templatePath: "docName2",
                name: "docName3",
            });
            assertSubDoc(target, {parentPath: rootPath, title: "docName3"});
        });
    });
});
