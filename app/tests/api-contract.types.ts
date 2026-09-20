import type {APIGETRoutes, APIPOSTRoutes, FetchGet, FetchPost, FetchSyncPost, JSONValue} from "../src/types/api";
import {ContractFormData} from "../src/util/contractFormData";

declare const fetchPost: FetchPost;
declare const fetchGet: FetchGet;
declare const fetchSyncPost: FetchSyncPost;
declare const dynamicURL: string;

fetchPost("/api/ai/agent/manageSkills", {action: "list"}, response => {
    if (response.code === 0) {
        const entries: {path: string, isDir: boolean, editable: boolean}[] | null | undefined = response.data.entries;
        const content: string | undefined = response.data.content;
        const revision: string | undefined = response.data.revision;
        void [entries, content, revision];
    }
});
fetchPost("/api/ai/agent/manageSkills", {action: "write", path: "example/SKILL.md", content: "", revision: "hash"});
// @ts-expect-error 技能管理操作不能省略。
fetchPost("/api/ai/agent/manageSkills", {});
// @ts-expect-error 文件修订号必须是字符串。
fetchPost("/api/ai/agent/manageSkills", {action: "write", path: "example/SKILL.md", revision: 1});
// @ts-expect-error 技能文件定位使用相对路径，不接受显示名称。
fetchPost("/api/ai/agent/manageSkills", {action: "read", name: "example"});
// @ts-expect-error 技能文件管理只支持 POST。
fetchGet("/api/ai/agent/manageSkills", () => undefined);

fetchPost("/api/petal/savePluginPublishData", {packageName: "example", data: {theme: "dark", enabled: true, count: 1, empty: null}});
fetchPost("/api/petal/setPluginPublishDataGrant", {packageName: "example", fields: ["theme"], enabled: true});
// @ts-expect-error 公开字段不能包含未经独立授权的嵌套对象。
fetchPost("/api/petal/savePluginPublishData", {packageName: "example", data: {settings: {token: "secret"}}});
// @ts-expect-error 授权必须携带管理员实际查看的字段清单。
fetchPost("/api/petal/setPluginPublishDataGrant", {packageName: "example", enabled: true});
// @ts-expect-error 发布数据接口只支持 POST。
fetchGet("/api/petal/loadPluginPublishData", () => undefined);
fetchPost("/api/petal/loadPluginPublishData", {packageName: "example"}, response => {
    if (response.code === 0) {
        const value: string | number | boolean | null = response.data.theme;
        void value;
    }
});

fetchPost("/api/setting/setEditor", {markdown: {inlineMath: null}, fontFamilies: null});
fetchPost("/api/setting/setAI", {mcp: {servers: [{name: "server", env: {KEY: "value"}}]}});
fetchPost("/api/setting/setKeymap", {data: {extension: {items: [null, false, 1, "text", {}]}}});
fetchPost("/api/setting/setTheme", {theme: "theme", modes: [0, 1]});
// @ts-expect-error 编辑器字号必须为数字。
fetchPost("/api/setting/setEditor", {fontSize: "16"});
// @ts-expect-error AI 配置只接受声明的字段。
fetchPost("/api/setting/setAI", {mcp: {unknown: true}});
// @ts-expect-error 环境变量值必须为字符串。
fetchPost("/api/setting/setAI", {mcp: {servers: [{env: {KEY: false}}]}});
// @ts-expect-error 主题模式的规范调用使用数字数组。
fetchPost("/api/setting/setTheme", {theme: "theme", modes: [false]});
fetchPost("/api/setting/login2faCloudUser", {token: "token", code: "123456"}, response => {
    const outerCode: number = response.code;
    if (response.data && "msg" in response.data) {
        const cloudCode: number = response.data.code;
        const message: string = response.data.msg;
        const token: JSONValue = response.data.token;
        // @ts-expect-error 云端扩展字段在使用前必须检查类型。
        const tokenString: string = response.data.token;
        void [cloudCode, message, token, tokenString];
    }
    void outerCode;
});

fetchPost("/api/filetree/getDoc", {id: "document", notebook: "box", querySubTypes: {heading: {h1: true}}}, response => {
    if (response.code === 0) {
        const content: string = response.data.content;
        const required: boolean = response.data.publishAccessRequired;
        void [content, required];
    } else {
        const prompt: 1 | 3 = response.code;
        void prompt;
    }
});
fetchPost("/api/filetree/getFullHPathByID", {}, response => {
    const path: string | null = response.data;
    void path;
});
fetchPost("/api/filetree/setDocSortMode", {id: "document", sortMode: null});
fetchPost("/api/filetree/moveDocs", {fromPaths: [], toPath: "/", toNotebook: "box", callback: {request: 1}});
// @ts-expect-error 文档读取必须提供 ID。
fetchPost("/api/filetree/getDoc", {});
// @ts-expect-error 文档加载数量必须为数值。
fetchPost("/api/filetree/getDoc", {id: "document", size: "10"});
// @ts-expect-error 文档排序方式必须为整数或 null。
fetchPost("/api/filetree/setDocSortMode", {id: "document", sortMode: "1"});
// @ts-expect-error 文档排序方式字段不能省略。
fetchPost("/api/filetree/setDocSortMode", {id: "document"});
// @ts-expect-error 文档创建字段不能拼错。
fetchPost("/api/filetree/createDocWithMd", {notebook: "box", path: "/Doc", markDown: "text"});
// @ts-expect-error 发布配置必须提供完整字段。
fetchPost("/api/filetree/setPublishAccess", {id: "document", visible: true});

fetchPost("/api/asset/upload", new ContractFormData({"file[]": [new Blob(), new Blob()], assetsDirPath: "assets"}), response => {
    const uploaded: string | undefined = response.data.succMap?.["example.txt"];
    void uploaded;
});
fetchPost("/api/asset/statAsset", {path: "assets/example.txt"}, response => {
    if (response.code === 0) {
        const downloaded: false | undefined = response.data.downloaded;
        void downloaded;
    }
});
fetchPost("/api/asset/getImageOCRText", {path: null});
// @ts-expect-error 批量上传文件必须为二进制数组。
fetchPost("/api/asset/upload", new ContractFormData({"file[]": ["example.txt"]}));
// @ts-expect-error 附件地址必须为字符串。
fetchPost("/api/asset/statAsset", {path: 123});
// @ts-expect-error 本地附件插入必须提供路径数组。
fetchPost("/api/asset/insertLocalAssets", {id: "document"});

fetchPost("/api/export/exportHTML", {id: "document", pdf: false}, response => {
    const folder: string | undefined = response.data.folder;
    void folder;
});
fetchPost("/api/export/exportMd", {id: "document", blockRefMode: 1.5, addTitle: null}, response => {
    const zip: string = response.data.zip;
    void zip;
});
fetchPost("/api/export/exportCodeBlock", {id: "block"}, response => {
    if (response.code === 0) {
        const path: string = response.data.path;
        void path;
    }
});
fetchPost("/api/export/exportAsFile", new ContractFormData({file: new Blob(), type: "text/plain"}));
// @ts-expect-error HTML 导出必须显式指定 PDF 模式。
fetchPost("/api/export/exportHTML", {id: "document"});
// @ts-expect-error Markdown 导出模式必须为数字。
fetchPost("/api/export/exportMd", {id: "document", blockRefMode: "1"});
// @ts-expect-error 文件上传必须包含 MIME 类型。
fetchPost("/api/export/exportAsFile", new ContractFormData({file: new Blob()}));
// @ts-expect-error 导出请求不能包含拼错的参数。
fetchPost("/api/export/exportHTML", {id: "document", pdf: false, savepath: ""});

fetchPost("/api/repo/getRepoSnapshots", {page: 1}, response => {
    const snapshots = response.data.snapshots;
    void snapshots;
});
fetchPost("/api/repo/getRepoFile", {id: "file"}, response => {
    const content: JSONValue = response;
    void content;
});
// @ts-expect-error 仓库保留时间必须为数值。
fetchPost("/api/repo/setRepoIndexRetentionDays", {days: "180"});
// @ts-expect-error 导入仓库密钥需要密钥字段。
fetchPost("/api/repo/importRepoKey", {});

fetchPost("/api/riff/getRiffDecks", {}, response => {
    const decks: Array<{id: string; name: string} | null> = response.data;
    void decks;
});
fetchPost("/api/riff/resetRiffCards", {type: "deck", id: "deck", deckID: "deck", blockIDs: null});
fetchPost("/api/riff/getRiffDueCards", {deckID: "deck"}, response => {
    const due: string | undefined = response.data.cards?.[0]?.nextDues?.["1"];
    void due;
});
// @ts-expect-error 复习卡片时必须提供评分。
fetchPost("/api/riff/reviewRiffCard", {deckID: "deck", cardID: "card"});
// @ts-expect-error 复习评分必须为数值。
fetchPost("/api/riff/reviewRiffCard", {deckID: "deck", cardID: "card", rating: "1"});

fetchPost("/api/sync/setSyncLAN", {enabled: true, maxConcurrentReqs: 2.5}, response => {
    const peers: number = response.data.connectedPeers;
    void peers;
});
fetchPost("/api/sync/setSyncProviderS3", {s3: {endpoint: "https://example.invalid", pathStyle: true}});
// @ts-expect-error 同步开关只接受布尔值。
fetchPost("/api/sync/setSyncEnable", {enabled: "true"});
// @ts-expect-error 同步配置中的超时不是字符串。
fetchPost("/api/sync/setSyncProviderS3", {s3: {timeout: "30"}});
fetchPost("/api/sync/importSyncProviderWebDAV", new ContractFormData({file: new Blob()}));

fetchPost("/api/bazaar/getBazaarPackageRating", {packageType: "plugin", packageName: "example"}, response => {
    if (response.data && "rating" in response.data && response.data.rating) {
        const distribution: [number, number, number, number, number] = response.data.rating.distribution;
        void distribution;
    }
});
// @ts-expect-error 集市评分参数必须为数值。
fetchPost("/api/bazaar/setBazaarPackageRating", {packageType: "plugin", packageName: "example", rating: "5"});
// @ts-expect-error 集市包名列表只能包含字符串。
fetchPost("/api/bazaar/getBazaarPackageRatings", {packageType: "plugin", packageNames: [1]});
fetchPost("/api/bazaar/installLocalBazaarPackage", new ContractFormData({file: new Blob(), overwrite: "true"}));

type RPCWebSocket = APIGETRoutes["/ws/plugin/rpc"]["websocket"];
const rpcCall: RPCWebSocket["incoming"] = {jsonrpc: "2.0", method: "call", id: 1};
const rpcNotice: RPCWebSocket["outgoing"] = {jsonrpc: "2.0", method: "event", params: null};
// @ts-expect-error 批量调用不能为空。
const rpcEmptyBatch: RPCWebSocket["incoming"] = [];
// @ts-expect-error 出站通知不能携带调用 ID。
const rpcInvalidNotice: RPCWebSocket["outgoing"] = {jsonrpc: "2.0", method: "event", id: 1};
// @ts-expect-error HTTP 中间件信封不是连接内的消息。
const rpcInvalidFrame: RPCWebSocket["outgoing"] = {code: -1, msg: "denied", data: null};
void [rpcCall, rpcNotice, rpcEmptyBatch, rpcInvalidNotice, rpcInvalidFrame];

fetchPost("/api/plugin/rpc", {jsonrpc: "2.0", method: "notify"}, response => {
    const empty: "" | object = response;
    // @ts-expect-error 纯通知请求的回调可能为空字符串。
    const objectOnly: object = response;
    void [empty, objectOnly];
});
fetchGet("/ws/plugin/rpc", response => {
    if (typeof response === "string") {
        const rejection: string = response;
        void rejection;
    }
    // @ts-expect-error 普通 GET 可能收到拒绝升级的文本。
    const objectOnly: object = response;
    void objectOnly;
});

fetchPost("/api/plugin/rpc", {jsonrpc: "2.0", method: "call", params: {key: [1, true]}, id: 1}, response => {
    if (response !== "" && !Array.isArray(response) && "jsonrpc" in response) {
        const version: "2.0" = response.jsonrpc;
        const id: string | number | null = response.id;
        void [version, id];
    }
});
fetchPost("/api/plugin/rpc/:name", [{jsonrpc: "2.0", method: "notify"}, {jsonrpc: "2.0", method: "call", id: null}]);
// @ts-expect-error RPC 请求需要协议版本。
fetchPost("/api/plugin/rpc", {method: "call"});
// @ts-expect-error RPC 关联标识不接受布尔值。
fetchPost("/api/plugin/rpc", {jsonrpc: "2.0", method: "call", id: true});
// @ts-expect-error RPC 参数应为数组或对象。
fetchPost("/api/plugin/rpc", {jsonrpc: "2.0", method: "call", params: "text"});

fetchPost("/api/plugin/getLoadedPlugin", {name: "plugin"}, response => {
    if (response.code === 0 && response.data) {
        const state: number = response.data.stateCode;
        const descriptions: string[] | null | undefined = response.data.methods?.[0]?.descriptions;
        void [state, descriptions];
    }
    // @ts-expect-error 插件查询的非零业务码不携带插件信息。
    const state: number = response.data.stateCode;
    void state;
});
// @ts-expect-error 插件名称必须为字符串。
fetchPost("/api/plugin/getLoadedPlugin", {name: 1});
fetchPost("/api/plugin/listLoadedPlugins", undefined, response => {
    const name: string | undefined = response.data?.[0]?.name;
    void name;
});

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

fetchPost("/api/ai/testModel", {model: "example", providerConfig: {baseURL: "https://example.invalid/v1", headers: {"X-Key": "value"}}}, (response) => {
    if (response.code === 0) {
        const matched: boolean = response.data.matched;
        void matched;
    }
});
fetchPost("/api/ai/agent/confirm", {confirmID: "id", approved: true, always: false});
fetchPost("/api/ai/agent/browserCapabilityResult", {callID: "id", structuredContent: {future: [true, null, 1]}, structuredContentSet: true});
// @ts-expect-error 模型名称必须是字符串
fetchPost("/api/ai/testModel", {model: 1});
// @ts-expect-error 确认结果必须是布尔值
fetchPost("/api/ai/agent/confirm", {approved: "yes"});
// @ts-expect-error 保存会话必须包含会话 ID
fetchPost("/api/ai/agent/saveSession", {title: "missing ID"});
const aiStreamContent: import("../src/types/api").APIPOSTRoutes["/api/ai/editor/chat"]["sse"]["events"]["content"] = {token: "text"};
void aiStreamContent;
// @ts-expect-error 流式内容必须是字符串
const invalidAIStreamContent: import("../src/types/api").APIPOSTRoutes["/api/ai/editor/chat"]["sse"]["events"]["content"] = {token: 1};
void invalidAIStreamContent;

// AV 契约的合法调用和固定结构拒绝用例，合并到共享类型检查文件。
fetchPost("/api/av/setAttributeViewBlockAttr", {avID: "av", keyID: "key", itemID: "item", value: {text: {}}});
fetchPost("/api/av/setAttributeViewBlockAttr", {avID: "av", keyID: "key", itemID: "item", value: {text: null}});
fetchPost("/api/av/setAttrViewGroup", {avID: "av", blockID: "block", group: {field: "key", method: 0}});
fetchPost("/api/av/batchSetAttributeViewBlockAttrs", {avID: "av", values: [{keyID: "key", itemID: "item", value: {checkbox: {checked: false}}}]});
fetchPost("/api/av/getAttributeViewPrimaryKeyValues", {id: "av", page: 2.5, pageSize: -1, blockIDs: ["block"]});
fetchPost("/api/av/changeAttrViewLayout", {avID: "av", blockID: "block", layoutType: "list"}, response => {
    if (response.code === 0 && "viewType" in response.data && response.data.viewType === "list" && "columns" in response.data.view) {
        const columns = response.data.view.columns;
        void columns;
    }
});
// @ts-expect-error 单元格文本内容不能是数字。
fetchPost("/api/av/setAttributeViewBlockAttr", {avID: "av", keyID: "key", value: {text: {content: 1}}});
// @ts-expect-error 批量修改必须包含字段 ID。
fetchPost("/api/av/batchSetAttributeViewBlockAttrs", {avID: "av", values: [{itemID: "item", value: {}}]});
// @ts-expect-error 分页参数必须是数字。
fetchPost("/api/av/getAttributeViewPrimaryKeyValues", {id: "av", page: "2"});
// @ts-expect-error 快照渲染必须指定快照 ID。
fetchPost("/api/av/renderSnapshotAttributeView", {id: "av"});
// @ts-expect-error 条目 ID 数组只接受字符串。
fetchPost("/api/av/createAttributeViewItemDocs", {avID: "av", blockID: "block", saveMode: "subDoc", itemIDs: [1]});

fetchPost("/api/network/forwardProxy", {url: "https://example.com", payload: {nested: [null, true, 1]}, headers: [{"X-Value": [1, true]}]}, response => {
    if (response.code === 0) {
        const upstreamStatus: number = response.data.status;
        const body: string = response.data.body;
        void [upstreamStatus, body];
    }
});
// @ts-expect-error 转发目标地址不可缺失。
fetchPost("/api/network/forwardProxy", {payload: "body"});
// @ts-expect-error 超时参数必须是数字。
fetchPost("/api/network/forwardProxy", {url: "https://example.com", timeout: "1000"});
fetchPost("/api/network/echo", {arbitrary: [1, true]}, response => {
    if (response.code === 0) {
        const raw: string | null = response.data.Context.RawData;
        const version: number | undefined = response.data.Request.TLS?.Version;
        void [raw, version];
        // @ts-expect-error 回显字段具有确定的结构。
        const invalid: string = response.data.Request.ContentLength;
        void invalid;
    }
});
const networkRawBody: APIPOSTRoutes["/api/network/proxy"]["request"] = new Blob(["raw"]);
void networkRawBody;

const pluginServiceRawBody: APIPOSTRoutes["/plugin/private/:name/*path"]["request"] = new Blob(["plugin data"]);
void pluginServiceRawBody;
fetchPost("/plugin/private/:name/*path", {extension: [true, null, 1]}, response => {
    const pluginPayload: JSONValue = response;
    void pluginPayload;
    // @ts-expect-error 插件服务载荷由插件决定，不能直接当作固定内核信封。
    const code: number = response.code;
    void code;
});

fetchPost("/api/system/exit", {execInstallPkg: 2.9, setCurrentWorkspace: null});
fetchPost("/api/system/setOIDC", {enabled: false, scopes: null, claimRules: [{claim: "group", values: null}]});
fetchPost("/api/system/setUILayout", {layout: {extension: [null, false, 1]}});
fetchPost("/api/system/importConf", new ContractFormData({file: [new Blob(["config"])]}));
// @ts-expect-error 配置导入使用文件列表。
fetchPost("/api/system/importConf", new ContractFormData({file: new Blob(["config"])}));
// @ts-expect-error 系统请求的数值标志不能使用字符串。
fetchPost("/api/system/exit", {execInstallPkg: "2"});
fetchPost("/api/system/getConf", {}, response => {
    if (response.code === 0 && response.data.conf) {
        const enabled: boolean | undefined = response.data.conf.notebookCrypto?.enabled;
        const layout: JSONValue | undefined = response.data.conf.uiLayout?.layout;
        void enabled;
        void layout;
        // @ts-expect-error 配置声明不包含未定义字段。
        const unmodeled = response.data.conf.unmodeled;
        void unmodeled;
    }
});
fetchPost("/api/system/oidc/poll", {pollToken: "token"}, response => {
    if (response.code === 0 && response.data.status === "completed") {
        const to: string = response.data.to;
        void to;
    }
});
fetchPost("/api/system/oidc/mobileCallback", {callbackURL: "siyuan:/oidc-callback"}, response => {
    if (response.code === 0) {
        if (response.data.validation === true) {
            const validated: true = response.data.validation;
            void validated;
        } else {
            const to: string = response.data.to;
            void to;
        }
    }
});

const transactionContractRequest: APIPOSTRoutes["/api/transactions"]["request"] = {
    reqId: 1,
    transactions: [{doOperations: [{action: "setAttrViewPageSize", data: 50}, {action: "updateAttrViewCell", data: {text: null}}]}],
};
void transactionContractRequest;

const invalidTransactionContractRequest: APIPOSTRoutes["/api/transactions"]["request"] = {
    reqId: 1,
    transactions: [{doOperations: [
        // @ts-expect-error 已知数值操作不能借用未知操作的兼容分支传入字符串。
        {action: "setAttrViewPageSize", data: "50"},
    ]}],
};
void invalidTransactionContractRequest;

const invalidUnknownTransactionRequest: APIPOSTRoutes["/api/transactions"]["request"] = {
    reqId: 1,
    transactions: [{doOperations: [
        // @ts-expect-error 未注册操作必须使用显式的兼容操作类型。
        {action: "unregistered-plugin-operation", data: {plugin: true}},
    ]}],
};
void invalidUnknownTransactionRequest;

const broadcastFrame: APIGETRoutes["/ws/broadcast"]["websocket"]["outgoing"] = new Blob([new Uint8Array([0, 255])]);
const broadcastDataEncoding: APIGETRoutes["/es/broadcast/subscribe"]["sse"]["raw"]["dataEncoding"] = "raw";
void [broadcastFrame, broadcastDataEncoding];
// @ts-expect-error 广播原始帧不能当作 JSON 对象。
const invalidBroadcastFrame: APIGETRoutes["/ws/broadcast"]["websocket"]["outgoing"] = {message: "text"};
void invalidBroadcastFrame;

fetchPost("/api/extension/copy", new ContractFormData({dom: "<p>clip</p>", "https://example.com/image.png": new Blob(["image"])}), response => {
    if (response.code === 0 && response.data) {
        const markdown: string = response.data.md;
        const withMath: boolean = response.data.withMath;
        void [markdown, withMath];
    }
});
// @ts-expect-error 剪藏请求必须携带 DOM 文本。
fetchPost("/api/extension/copy", new ContractFormData({notebook: "notebook"}));
const iconOutput: APIGETRoutes["/api/icon/getDynamicIcon"]["output"] = "binary";
void iconOutput;
