import type {APIPOSTRoutes, FetchGet, FetchPost, FetchSyncPost, JSONValue} from "../src/types/api";
import {ContractFormData} from "../src/util/contractFormData";

declare const fetchPost: FetchPost;
declare const fetchGet: FetchGet;
declare const fetchSyncPost: FetchSyncPost;
declare const dynamicURL: string;

fetchPost("/api/search/fullTextSearchBlock", {query: "text", subTypes: {heading: {h1: true}}}, response => {
    if (response.data) {
        const count: number = response.data.matchedBlockCount;
        const docMode: boolean = response.data.docMode;
        void [count, docMode];
    }
});
fetchPost("/api/search/searchRefBlock", {reqId: [1]}, response => {
    const reqId: JSONValue = response.data.reqId;
    // @ts-expect-error 仅回传请求标识的结果没有块数组。
    const blocks: unknown[] = response.data.blocks;
    void [reqId, blocks];
});
fetchPost("/api/search/searchEmbedBlock", {embedBlockID: "id", stmt: "select * from blocks", excludeIDs: [null, "id"]});
// @ts-expect-error 普通嵌入查询不接受空值块 ID。
fetchPost("/api/search/getEmbedBlock", {embedBlockID: "id", includeIDs: [null]});
// @ts-expect-error 子类型筛选使用布尔值。
fetchPost("/api/search/fullTextSearchBlock", {subTypes: {heading: {h1: "true"}}});
// @ts-expect-error 替换操作必须提供待替换文本。
fetchPost("/api/search/findReplace", {k: "text", ids: []});
// @ts-expect-error 搜索分页参数使用数字。
fetchPost("/api/search/fullTextSearchAssetContent", {page: "1"});

fetchPost("/api/query/sql", {stmt: "SELECT 1", mode: "readonly"}, response => {
    if (response.code === 0) {
        const limit: number = response.limit;
        const truncated: boolean = response.truncated;
        const value: string | number | boolean | null | undefined = response.data[0]?.n;
        void [limit, truncated, value];
    }
});
// @ts-expect-error 查询语句不可缺省。
fetchPost("/api/query/sql", {});
// @ts-expect-error 查询模式必须为字符串或空值。
fetchPost("/api/query/sql", {stmt: "SELECT 1", mode: true});

fetchPost("/api/file/getFile", {path: "data/storage/plugin.json"}, response => {
    const content: JSONValue = response;
    // @ts-expect-error 文件内容可能是文本、数组或空值，不能直接按信封读取。
    void response.data;
    void content;
});
// @ts-expect-error 文件路径不可缺省。
fetchPost("/api/file/getFile", {});
// @ts-expect-error 文件路径必须为字符串。
fetchPost("/api/file/getFile", {path: 1});
fetchPost("/api/file/putFile", new ContractFormData({path: "temp/dir", isDir: "true"}));
fetchPost("/api/file/putFile", new ContractFormData({path: "temp/file", file: new Blob()}));
// @ts-expect-error 上传文件字段必须为二进制文件。
fetchPost("/api/file/putFile", new ContractFormData({file: "file"}));
// @ts-expect-error 表单布尔值以字符串传输。
fetchPost("/api/file/putFile", new ContractFormData({isDir: true}));

fetchSyncPost("/api/notebook/importNotebookCryptoBackup", new ContractFormData({file: new Blob(), password: "password"}));
// @ts-expect-error 上传请求必须包含文件。
fetchSyncPost("/api/notebook/importNotebookCryptoBackup", new ContractFormData({password: "password"}));
// @ts-expect-error 文件字段不能使用字符串。
fetchSyncPost("/api/notebook/importNotebookCryptoBackup", new ContractFormData({file: "backup.json"}));
// @ts-expect-error 普通表单没有已校验的字段类型。
fetchSyncPost("/api/notebook/importNotebookCryptoBackup", new FormData());

fetchPost("/api/system/version");
fetchPost("/api/notebook/lsNotebooks");
fetchPost("/api/notebook/lsNotebooks", {flashcard: null});
fetchPost("/api/attr/setBlockAttrs", {id: "id", attrs: {"custom-value": null}});
fetchPost("/api/history/searchHistory", {page: 1.5, type: null});
fetchPost(dynamicURL, {legacy: true});
fetchPost("/api/system/currentTime", {});
fetchPost("/api/attr/batchSetBlockAttrs", {blockAttrs: [{id: "id", attrs: {remove: null}}]});
fetchPost("/api/tag/getTag", {sort: 1.5, app: null});
fetchPost("/api/block/getHeadingChildrenDOM", {id: "id", removeFoldAttr: null});
fetchPost("/api/system/setAutoLaunch", {autoLaunch: 1.5});

// @ts-expect-error 批量请求中的嵌套属性对象不可缺省。
fetchPost("/api/attr/batchSetBlockAttrs", {blockAttrs: [{id: "id"}]});
// @ts-expect-error 字符串数组不接受 null 元素。
fetchPost("/api/attr/batchGetBlockAttrs", {ids: [null]});
// @ts-expect-error 标签响应没有文档路径。
fetchPost("/api/tag/getTag", {}, response => { void response.data?.[0]?.hPath; });
// @ts-expect-error 自动启动参数必须是数字。
fetchPost("/api/system/setAutoLaunch", {autoLaunch: "1"});
// @ts-expect-error POST 查询不能通过 GET 调用。
fetchGet("/api/block/getBlockSiblingID", () => {});

// @ts-expect-error 路径拼写错误不能被误认为存量接口。
fetchPost("/api/attr/getBlockAtrrs", {id: "id"});
// @ts-expect-error 已迁移的 POST 接口不能通过 GET 调用。
fetchGet("/api/attr/getBlockAttrs", () => {});

// @ts-expect-error 已知接口不能省略必填请求体。
fetchPost("/api/attr/getBlockAttrs");
// @ts-expect-error 缺少必填字段时不能回退到存量签名。
fetchPost("/api/attr/getBlockAttrs", {});
// @ts-expect-error 请求字段类型错误时不能回退到存量签名。
fetchPost("/api/attr/getBlockAttrs", {id: 123});
// @ts-expect-error 显式声明的错误回调类型也不能触发宽松重载。
fetchPost("/api/search/searchTag", {k: ""}, (response: {data: number}) => response.data);
// @ts-expect-error 属性值支持字符串和 null，不支持数字。
fetchPost("/api/attr/setBlockAttrs", {id: "id", attrs: {key: 1}});
// @ts-expect-error 异步接口同样要求请求体。
fetchSyncPost("/api/attr/getBlockAttrs");
// @ts-expect-error 数字字符串不属于历史分页请求的数字类型。
fetchSyncPost("/api/history/searchHistory", {page: "2"});

fetchPost("/api/search/searchTag", {k: ""}, response => {
    const code: 0 = response.code;
    const tags: string[] = response.data.tags;
    // @ts-expect-error 拼错响应字段会报错。
    void response.data.tagz;
    // @ts-expect-error 回调数据不能退化为 any。
    const incorrect: number = response.data.k;
    void [code, tags, incorrect];
});

fetchPost("/api/block/getBlockInfo", {id: "id"}, response => {
    // @ts-expect-error 普通回调也可能收到正数错误码，不能假设必定成功。
    void response.data.rootID;
    if (response.code === 0) {
        const title: string = response.data.rootTitle;
        if (response.data.publishAccessRequired) {
            // @ts-expect-error 发布密码提示响应没有笔记本 ID。
            const box: string = response.data.box;
            void box;
        } else {
            const box: string = response.data.box;
            void box;
        }
        void title;
    }
});

fetchGet("/api/system/version", response => {
    if (response.code === 0) {
        const version: string = response.data;
        // @ts-expect-error 版本接口返回字符串。
        void response.data.version;
        void version;
    }
});

async function checkAsyncResult() {
    const response = await fetchSyncPost("/api/notebook/lsNotebooks", {});
    // @ts-expect-error 异步返回值包含失败响应，不能直接访问成功字段。
    void response.data.notebooks;
    if (response.code === 0 && response.data?.notebooks) {
        const notebook = response.data.notebooks[0];
        if (notebook) {
            const count: number = notebook.flashcardCount;
            void count;
        }
    }
}
void checkAsyncResult;

fetchPost("/api/block/getHeadingDeleteTransaction", {id: "id"}, response => {
    const operation = response.data?.doOperations?.[0];
    if (operation) {
        const data: string | {createEmptyParagraph: boolean} | null = operation.data;
        const result: string | string[] | null = operation.retData;
        // @ts-expect-error 块操作载荷不能退化为任意对象。
        void operation.data.content;
        // @ts-expect-error 返回值也可能是文本或空值，不能直接当作数组。
        const ids: string[] = operation.retData;
        void [data, result, ids];
    }
});

declare const notebooks: APIPOSTRoutes["/api/notebook/lsNotebooks"]["response"];

fetchPost("/api/block/checkBlockRef", {scope: "blocks", ids: ["id"]}, response => {
    const hasReference: boolean = response.data;
    void hasReference;
});
// @ts-expect-error 引用检查仅接受字符串数组。
fetchPost("/api/block/checkBlockRef", {ids: [42]});
// @ts-expect-error 标题级别必须为数字。
fetchPost("/api/block/getHeadingLevelTransaction", {id: "id", level: "2"});
// @ts-expect-error 文档标题转换开关必须为布尔值。
fetchPost("/api/block/getDocHeadingLevelTransaction", {id: "id", withSubheadings: "true"});
fetchPost("/api/block/getDocHeadingLevelTransaction", {id: "id"}, response => {
    if (response.data) {
        const counts: number[] = response.data.counts;
        // @ts-expect-error 标题转换结果没有内容字段。
        void response.data.content;
        void counts;
    }
});
fetchPost("/api/block/getRecentUpdatedBlocks", {}, response => {
    const block = response.data?.[0];
    if (block) {
        const content: string = block.content;
        // @ts-expect-error 最近更新块的内容不是数字。
        const invalid: number = block.content;
        void [content, invalid];
    }
});

if (notebooks.code === 0) {
    // @ts-expect-error 成功码下的空数据也必须在严格模式下被检查。
    void notebooks.data.notebooks;
}
