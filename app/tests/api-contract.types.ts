import type {APIPOSTRoutes, FetchGet, FetchPost, FetchSyncPost} from "../src/types/api";

declare const fetchPost: FetchPost;
declare const fetchGet: FetchGet;
declare const fetchSyncPost: FetchSyncPost;
declare const dynamicURL: string;

fetchPost("/api/system/version");
fetchPost("/api/notebook/lsNotebooks");
fetchPost("/api/notebook/lsNotebooks", {flashcard: null});
fetchPost("/api/attr/setBlockAttrs", {id: "id", attrs: {"custom-value": null}});
fetchPost("/api/history/searchHistory", {page: 1.5, type: null});
fetchPost(dynamicURL, {legacy: true});
fetchPost("/api/system/currentTime", {});

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

declare const notebooks: APIPOSTRoutes["/api/notebook/lsNotebooks"]["response"];
if (notebooks.code === 0) {
    // @ts-expect-error 成功码下的空数据也必须在严格模式下被检查。
    void notebooks.data.notebooks;
}
