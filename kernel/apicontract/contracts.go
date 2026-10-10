// 包 apicontract 定义 HTTP 接口的线协议，不依赖内核启动或持久化模型。
package apicontract

import (
	"io"
	"reflect"
)

type BodyMode string

type OutputMode string

const BinaryOutput OutputMode = "binary"

const DirectJSONOutput OutputMode = "directJSON"

const WebSocketOutput OutputMode = "websocket"

const (
	JSONBody           BodyMode = "json"
	MultipartBody      BodyMode = "multipart"
	FormBody           BodyMode = "form"
	StructJSONBody     BodyMode = "structJSON"
	NoBody             BodyMode = "none"
	LegacyOptionalBody BodyMode = "legacyOptional"
)

type Definition struct {
	Name                    string
	Path                    string
	Methods                 []string
	Authorization           Authorization
	Body                    BodyMode
	Request                 reflect.Type
	Data                    reflect.Type
	ErrorCodes              []int
	ErrorText               bool
	DataNonNullable         bool
	DataOnError             bool
	Output                  OutputMode
	ErrorStatus             int
	NoContent               bool
	WebSocket               *WebSocketDefinition
	SSE                     *SSEDefinition
	Proxy                   *ProxyDefinition
	PluginService           *PluginServiceDefinition
	ContentVariants         []HTTPContentVariant
	FastJSON                bool
	EmptyResponseStatuses   []int
	AdditionalErrorStatuses []int
}

type Endpoint[Request, Data any] struct {
	definition    Definition
	decodeRequest func(io.Reader) (Request, error)
	decodeFailure func(error) Response[Data]
}

type ResponseOptions struct {
	AdditionalCodes         []int
	Text                    bool
	NonNullable             bool
	DataOnError             bool
	Output                  OutputMode
	ErrorStatus             int
	NoContent               bool
	WebSocket               *WebSocketDefinition
	SSE                     *SSEDefinition
	Proxy                   *ProxyDefinition
	PluginService           *PluginServiceDefinition
	ContentVariants         []HTTPContentVariant
	FastJSON                bool
	EmptyResponseStatuses   []int
	AdditionalErrorStatuses []int
}

var definitions []Definition

var MapGetConf = define[EmptyRequest, *MapConfig]("getMapConf", "/api/map/getConf", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var MapSetConf = define[MapSetConfRequest, *MapConfig]("setMapConf", "/api/map/setConf", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var MapGetRuntime = define[MapRuntimeRequest, *MapRuntime]("getMapRuntime", "/api/map/getRuntime", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// MCP OAuth 协议入口返回标准 OAuth JSON 或授权页面，不使用内核结果信封。
var MCPOAuthResource = define[EmptyRequest, BinaryContent]("mcpOAuthResource", "/.well-known/oauth-protected-resource/mcp", PublicAccess, NoBody, mcpOAuthContentOptions(), "GET")
var MCPOAuthResourceRoot = define[EmptyRequest, BinaryContent]("mcpOAuthResourceRoot", "/.well-known/oauth-protected-resource", PublicAccess, NoBody, mcpOAuthContentOptions(), "GET")
var MCPOAuthMetadata = define[EmptyRequest, BinaryContent]("mcpOAuthMetadata", "/.well-known/oauth-authorization-server", PublicAccess, NoBody, mcpOAuthContentOptions(), "GET")
var MCPOAuthToken = define[MCPOAuthTokenRequest, BinaryContent]("mcpOAuthToken", "/oauth/mcp/token", PublicAccess, FormBody, mcpOAuthContentOptions(), "POST")
var MCPOAuthRevoke = define[MCPOAuthTokenRequest, BinaryContent]("mcpOAuthRevoke", "/oauth/mcp/revoke", PublicAccess, FormBody, mcpOAuthContentOptions(), "POST")
var MCPOAuthAuthorize = define[EmptyRequest, BinaryContent]("mcpOAuthServerAuthorize", "/oauth/mcp/authorize", PublicAccess, NoBody, HTTPContentOptions(HTTPContentVariant{Status: 200, ContentType: "text/html"}, HTTPContentVariant{Status: 302, ContentType: "text/html"}, HTTPContentVariant{Status: 400, ContentType: "text/html"}), "GET")
var MCPOAuthConsent = define[MCPOAuthConsentRequest, BinaryContent]("mcpOAuthConsent", "/oauth/mcp/consent", PublicAccess, FormBody, HTTPContentOptions(HTTPContentVariant{Status: 302, ContentType: "text/html"}, HTTPContentVariant{Status: 400, ContentType: "text/html"}), "POST")

// 返回内置 MCP 服务端 OAuth 的公开地址、开关和预注册客户端列表，不返回凭证摘要或客户端密钥。
// 要求管理员权限；服务端 OAuth 与思源连接外部 MCP 的客户端 OAuth 配置相互独立，默认关闭。
// OAuth 使用授权码与 PKCE S256，支持 client_secret_basic 和 client_secret_post，不支持动态注册。
// 访问令牌最长有效一小时；offline_access 刷新令牌轮换并在授权后三十天过期，重放会撤销同一授权。
// OAuth 令牌只用于 /mcp，不能用于管理接口或其他内核 API，且不会解锁加密笔记本。
var MCPOAuthGet = define[EmptyRequest, MCPOAuthStatus]("mcpOAuthGet", "/api/mcp/getOAuth", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// 接收 enabled 和不含路径的 HTTPS publicURL，要求管理员权限并禁止只读模式。
// 启用需要锁屏密码或 OIDC 登录；关闭、修改地址或管理员认证配置会撤销已有授权。
// 服务端 OAuth 与连接外部 MCP 的客户端 OAuth 配置相互独立，默认关闭；协议说明见 `/api/mcp/getOAuth`。
var MCPOAuthSet = define[MCPOAuthConfig, Null]("mcpOAuthSet", "/api/mcp/setOAuth", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 接收 name 和精确匹配的 redirectURI，返回客户端 id 及仅显示一次的 secret。
// 要求管理员权限并禁止只读模式；OAuth 令牌只用于 /mcp，不解锁加密笔记本。
var MCPOAuthAddClient = define[MCPOAuthClientRequest, MCPOAuthClientSecret]("mcpOAuthAddClient", "/api/mcp/addOAuthClient", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 接收 id 删除客户端并撤销授权，或传 all: true 撤销全部授权但保留注册。
// 要求管理员权限并禁止只读模式。
var MCPOAuthRemoveClient = define[MCPOAuthRemoveRequest, Null]("mcpOAuthRemoveClient", "/api/mcp/removeOAuthClient", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var (
	GetChildBlocks     = define[BlockQueryRequest, []*ChildBlock]("getChildBlocks", "/api/block/getChildBlocks", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{NonNullable: true}, "POST")
	GetTailChildBlocks = define[TailChildBlocksRequest, []*ChildBlock]("getTailChildBlocks", "/api/block/getTailChildBlocks", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{NonNullable: true}, "POST")
)

var (
	// 接收 ids，忽略非字符串及无效块 ID，重复 ID 合并为一个结果。
	// notebook 为加密笔记本时只查询该库；省略或传入普通笔记本时查询全局库及本请求已持有租约的加密库。
	// 不存在或已锁定且无法确定归属的块返回 false；显式指定已锁定的加密笔记本返回 code=-1、data=null。
	// 发布读者的不可访问块不返回结果，加密响应租约保持到响应发送完成。
	CheckBlocksExist            = define[CheckBlocksExistRequest, map[string]bool]("checkBlocksExist", "/api/block/checkBlocksExist", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetOrderedListContinueStart = define[BlockQueryRequest, OrderedListStartData]("getOrderedListContinueStart", "/api/block/getOrderedListContinueStart", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
	GetContentWordCount = define[ContentWordCountRequest, WordCountData]("getContentWordCount", "/api/block/getContentWordCount", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlocksWordCount  = define[BlocksWordCountRequest, WordCountData]("getBlocksWordCount", "/api/block/getBlocksWordCount", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
)

var SetNotebookConf = define[SetNotebookConfRequest, *NotebookConf]("setNotebookConf", "/api/notebook/setNotebookConf", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var ReorderNotebooks = define[ReorderNotebooksRequest, *ReorderData]("reorderNotebooks", "/api/notebook/reorder", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{DataOnError: true}, "POST")

var (
	OpenNotebook    = define[OpenNotebookRequest, Null]("openNotebook", "/api/notebook/openNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	GetNotebookConf = define[CloseNotebookRequest, NotebookConfData]("getNotebookConf", "/api/notebook/getNotebookConf", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
)

var ImportNotebookCryptoBackup = define[ImportNotebookCryptoBackupRequest, Null]("importNotebookCryptoBackup", "/api/notebook/importNotebookCryptoBackup", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

var (
	GetNotebookInfo            = define[NotebookIDRequest, NotebookInfoData]("getNotebookInfo", "/api/notebook/getNotebookInfo", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetEncryptedNotebookStatus = define[EmptyRequest, EncryptedNotebookStatusData]("getEncryptedNotebookStatus", "/api/notebook/getEncryptedNotebookStatus", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
)

var (
	SetNotebookIcon    = define[SetNotebookIconRequest, Null]("setNotebookIcon", "/api/notebook/setNotebookIcon", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	ChangeSortNotebook = define[ChangeSortNotebookRequest, Null]("changeSortNotebook", "/api/notebook/changeSortNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RenameNotebook     = define[RenameNotebookRequest, Null]("renameNotebook", "/api/notebook/renameNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RemoveNotebook     = define[NotebookIDRequest, Null]("removeNotebook", "/api/notebook/removeNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	CreateNotebook     = define[CreateNotebookRequest, CreateNotebookData]("createNotebook", "/api/notebook/createNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	CloseNotebook      = define[CloseNotebookRequest, Null]("closeNotebook", "/api/notebook/closeNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
	GetPinnedDocs    = define[EmptyRequest, []PinnedDoc]("getPinnedDocs", "/api/filetree/getPinnedDocs", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{NonNullable: true}, "POST")
	UpdatePinnedDocs = define[UpdatePinnedDocsRequest, Null]("updatePinnedDocs", "/api/filetree/updatePinnedDocs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
)

func define[Request, Data any](name, path string, authorization Authorization, body BodyMode, response ResponseOptions, methods ...string) Endpoint[Request, Data] {
	d := Definition{Name: name, Path: path, Methods: methods, Authorization: authorization, Body: body,
		Request: reflect.TypeFor[Request](), Data: reflect.TypeFor[Data](),
		ErrorCodes: append([]int{-1}, response.AdditionalCodes...), ErrorText: response.Text, DataNonNullable: response.NonNullable, DataOnError: response.DataOnError,
		Output: response.Output, ErrorStatus: response.ErrorStatus, NoContent: response.NoContent, WebSocket: response.WebSocket, SSE: response.SSE, Proxy: response.Proxy, PluginService: response.PluginService,
		AdditionalErrorStatuses: append([]int(nil), response.AdditionalErrorStatuses...), ContentVariants: append([]HTTPContentVariant(nil), response.ContentVariants...), FastJSON: response.FastJSON,
		EmptyResponseStatuses: append([]int(nil), response.EmptyResponseStatuses...)}
	definitions = append(definitions, d)
	return Endpoint[Request, Data]{definition: d}
}

func (e Endpoint[Request, Data]) Definition() Definition { return e.definition }

func Definitions() []Definition { return append([]Definition(nil), definitions...) }

var (
	Version       = define[EmptyRequest, string]("version", "/api/system/version", PublicAccess, NoBody, ResponseOptions{}, "GET", "POST")
	GetBlockAttrs = define[BlockIDRequest, map[string]string]("getBlockAttrs", "/api/attr/getBlockAttrs", AuthenticatedAccess, JSONBody, ResponseOptions{NonNullable: true}, "POST")
	SetBlockAttrs = define[SetBlockAttrsRequest, Null]("setBlockAttrs", "/api/attr/setBlockAttrs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SearchTag     = define[SearchTagRequest, SearchTagData]("searchTag", "/api/search/searchTag", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	ListNotebooks = define[ListNotebooksRequest, *ListNotebooksData]("lsNotebooks", "/api/notebook/lsNotebooks", AuthenticatedAccess, LegacyOptionalBody, ResponseOptions{}, "POST")
	SearchHistory = define[SearchHistoryRequest, SearchHistoryData]("searchHistory", "/api/history/searchHistory", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockInfo  = define[BlockInfoRequest, BlockInfoData]("getBlockInfo", "/api/block/getBlockInfo", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{3}, Text: true}, "POST")
)

var (
	CreateSnapshot  = define[CreateSnapshotRequest, CreateSnapshotData]("createSnapshot", "/api/repo/createSnapshot", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	CheckSnapshot   = define[EmptyRequest, CheckSnapshotData]("checkSnapshot", "/api/repo/checkSnapshot", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	SetSnapshotMemo = define[SetSnapshotMemoRequest, Null]("setSnapshotMemo", "/api/repo/setSnapshotMemo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
)

type EmptyRequest struct{}

type BlockIDRequest struct {
	ID string `json:"id"`
}

type SetBlockAttrsRequest struct {
	ID    string             `json:"id"`
	Attrs map[string]*string `json:"attrs"`
}

type SearchTagRequest struct {
	K string `json:"k"`
}

type SearchTagData struct {
	Tags []string `json:"tags" api:"nonnullable"`
	K    string   `json:"k"`
}

type ListNotebooksRequest struct {
	Flashcard bool `json:"flashcard" api:"optional,nullable"`
}

// Notebook 仅承载接口公开的笔记本信息；转换测试校验其与现有序列化结果一致。
type Notebook struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Icon              string `json:"icon"`
	Sort              int    `json:"sort"`
	SortMode          int    `json:"sortMode"`
	Closed            bool   `json:"closed"`
	SubFileCount      int    `json:"subFileCount"`
	NewFlashcardCount int    `json:"newFlashcardCount"`
	DueFlashcardCount int    `json:"dueFlashcardCount"`
	FlashcardCount    int    `json:"flashcardCount"`
	Encrypted         bool   `json:"encrypted"`
	Unlocked          bool   `json:"unlocked"`
	State             string `json:"state,omitempty" api:"enum=Locked|Unlocking|Unlocked|Locking|Error"`
}

type ListNotebooksData struct {
	Notebooks     []*Notebook `json:"notebooks"`
	BoxDocEnabled bool        `json:"boxDocEnabled"`
}

// 数字保留 JSON 浮点语义，由业务入口沿用既有的整数转换及缺省值。
type SearchHistoryRequest struct {
	Notebook string   `json:"notebook" api:"optional,nullable"`
	Query    string   `json:"query" api:"optional,nullable"`
	Op       string   `json:"op" api:"optional,nullable"`
	Type     *float64 `json:"type" api:"optional"`
	Page     *float64 `json:"page" api:"optional"`
}

type SearchHistoryData struct {
	Histories  []string `json:"histories"`
	PageCount  int      `json:"pageCount"`
	TotalCount int      `json:"totalCount"`
}

type BlockInfoRequest struct {
	ID       string `json:"id" api:"trim"`
	Notebook string `json:"notebook" api:"optional,nullable,ignoretype"`
	// 附带的 ID 仍参与租约检查，保留旧入口对非字符串元素的忽略行为。
	IDs []string `json:"ids" api:"optional,filterstrings"`
}

type BlockInfoData interface{ blockInfoData() }

type BlockInfoCommon struct {
	RootID         string `json:"rootID"`
	RootTitle      string `json:"rootTitle"`
	RootTitleEmpty bool   `json:"rootTitleEmpty"`
	RootIcon       string `json:"rootIcon"`
}

type FullBlockInfo struct {
	BlockInfoCommon
	Box         string `json:"box"`
	Path        string `json:"path"`
	RootChildID string `json:"rootChildID"`
}

type PublishedBlockInfo struct {
	BlockInfoCommon
	PublishAccessRequired bool `json:"publishAccessRequired" api:"const=true"`
}

func (FullBlockInfo) blockInfoData()      {}
func (PublishedBlockInfo) blockInfoData() {}

var (
	ClearTempFiles                      = define[EmptyRequest, Null]("clearTempFiles", "/api/system/clearTempFiles", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	VacuumDataIndex                     = define[EmptyRequest, Null]("vacuumDataIndex", "/api/system/vacuumDataIndex", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	RebuildDataIndex                    = define[EmptyRequest, Null]("rebuildDataIndex", "/api/system/rebuildDataIndex", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	IgnoreAddMicrosoftDefenderExclusion = define[EmptyRequest, Null]("ignoreAddMicrosoftDefenderExclusion", "/api/system/ignoreAddMicrosoftDefenderExclusion", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	AddMicrosoftDefenderExclusion       = define[EmptyRequest, Null]("addMicrosoftDefenderExclusion", "/api/system/addMicrosoftDefenderExclusion", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	GetWorkspaceInfo                    = define[EmptyRequest, WorkspaceInfoData]("getWorkspaceInfo", "/api/system/getWorkspaceInfo", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	// 无需参数，要求管理员权限并允许只读模式，统计当前内核工作空间的本地文件大小。
	// totalSize 为普通文件字节数之和，assetsSize 是 data 的子集，不能重复累加；不含目录分配空间或链接目标。
	// directories 按 data、repo、history、temp、conf、other 排序，calculatedAt 为扫描完成的 Unix 毫秒时间。
	// 扫描不下载资源或解密文件，不返回绝对路径；并发请求共享扫描，完成后不缓存，不保证扫描期间的快照一致性。
	// 扫描期间已删除的子文件或子目录不计入；根目录丢失、权限错误等返回失败。
	// 读取失败或扫描超时返回 code=-1、data=null；调用方应保留旧结果的时间标记，并允许用户重试。
	GetWorkspaceStorage       = define[EmptyRequest, WorkspaceStorageData]("getWorkspaceStorage", "/api/system/getWorkspaceStorage", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	GetNetwork                = define[EmptyRequest, NetworkData]("getNetwork", "/api/system/getNetwork", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	GetRuntimeInfo            = define[EmptyRequest, SystemRuntimeInfoData]("getRuntimeInfo", "/api/system/getRuntimeInfo", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	CurrentTime               = define[EmptyRequest, int64]("currentTime", "/api/system/currentTime", PublicAccess, NoBody, ResponseOptions{}, "POST")
	BootProgress              = define[EmptyRequest, BootProgressData]("bootProgress", "/api/system/bootProgress", PublicAccess, NoBody, ResponseOptions{}, "GET", "POST")
	SetFollowSystemLockScreen = define[LockScreenRequest, Null]("setFollowSystemLockScreen", "/api/system/setFollowSystemLockScreen", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetAutoLaunch             = define[AutoLaunchRequest, Null]("setAutoLaunch", "/api/system/setAutoLaunch", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetDownloadInstallPkg     = define[DownloadInstallPkgRequest, Null]("setDownloadInstallPkg", "/api/system/setDownloadInstallPkg", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// 更新工作空间的独立设置窗口开关，仅桌面 Electron 客户端使用。
	SetSettingsWindow  = define[SettingsWindowRequest, Null]("setSettingsWindow", "/api/system/setSettingsWindow", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetNetworkServe    = define[NetworkServeRequest, Null]("setNetworkServe", "/api/system/setNetworkServe", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetNetworkServeTLS = define[NetworkServeTLSRequest, Null]("setNetworkServeTLS", "/api/system/setNetworkServeTLS", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetUpdateChannel   = define[UpdateChannelRequest, Null]("setUpdateChannel", "/api/system/setUpdateChannel", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetNetworkProxy    = define[NetworkProxy, Null]("setNetworkProxy", "/api/system/setNetworkProxy", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	GetBookmarkLabels  = define[EmptyRequest, []string]("getBookmarkLabels", "/api/attr/getBookmarkLabels", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
	BatchGetBlockAttrs = define[BlockIDsRequest, map[string]map[string]string]("batchGetBlockAttrs", "/api/attr/batchGetBlockAttrs", AuthenticatedAccess, JSONBody, ResponseOptions{NonNullable: true}, "POST")
	GetDOMText         = define[DOMTextRequest, string]("getDOMText", "/api/block/getDOMText", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	RemoveBookmark     = define[RemoveBookmarkRequest, Null]("removeBookmark", "/api/bookmark/removeBookmark", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RenameBookmark     = define[RenameBookmarkRequest, Null]("renameBookmark", "/api/bookmark/renameBookmark", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RemoveTag          = define[RemoveTagRequest, Null]("removeTag", "/api/tag/removeTag", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RenameTag          = define[RenameTagRequest, Null]("renameTag", "/api/tag/renameTag", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
	SetEditorReadOnly         = define[EditorReadOnlyRequest, Null]("setEditorReadOnly", "/api/setting/setEditorReadOnly", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	AddVirtualBlockRefExclude = define[VirtualBlockRefRequest, Null]("addVirtualBlockRefExclude", "/api/setting/addVirtualBlockRefExclude", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	AddVirtualBlockRefInclude = define[VirtualBlockRefRequest, Null]("addVirtualBlockRefInclude", "/api/setting/addVirtualBlockRefInclude", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RefreshVirtualBlockRef    = define[EmptyRequest, Null]("refreshVirtualBlockRef", "/api/setting/refreshVirtualBlockRef", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	GetPandocBin              = define[EmptyRequest, string]("getPandocBin", "/api/setting/getPandocBin", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	ReindexHistory            = define[EmptyRequest, Null]("reindexHistory", "/api/history/reindexHistory", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	ClearWorkspaceHistory     = define[EmptyRequest, Null]("clearWorkspaceHistory", "/api/history/clearWorkspaceHistory", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	BatchSetBlockAttrs        = define[BatchSetBlockAttrsRequest, Null]("batchSetBlockAttrs", "/api/attr/batchSetBlockAttrs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	GetTag                    = define[GetTagRequest, []*TagData]("getTag", "/api/tag/getTag", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
	GetBlockSiblingID     = define[BlockQueryRequest, BlockSiblingData]("getBlockSiblingID", "/api/block/getBlockSiblingID", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockRelevantIDs   = define[BlockQueryRequest, BlockRelevantData]("getBlockRelevantIDs", "/api/block/getBlockRelevantIDs", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetUnfoldedParentID   = define[BlockQueryRequest, UnfoldedParentData]("getUnfoldedParentID", "/api/block/getUnfoldedParentID", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	CheckBlockFold        = define[BlockQueryRequest, BlockFoldData]("checkBlockFold", "/api/block/checkBlockFold", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	CheckBlockExist       = define[BlockQueryRequest, bool]("checkBlockExist", "/api/block/checkBlockExist", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockIndex         = define[BlockQueryRequest, int]("getBlockIndex", "/api/block/getBlockIndex", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlocksIndexes      = define[BlocksQueryRequest, map[string]int]("getBlocksIndexes", "/api/block/getBlocksIndexes", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetHeadingChildrenIDs = define[BlockIDRequest, []string]("getHeadingChildrenIDs", "/api/block/getHeadingChildrenIDs", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetHeadingChildrenDOM = define[HeadingChildrenRequest, string]("getHeadingChildrenDOM", "/api/block/getHeadingChildrenDOM", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	AppendHeadingChildren = define[AppendHeadingChildrenRequest, Null]("appendHeadingChildren", "/api/block/appendHeadingChildren", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	GetDocBlocksOrders    = define[DocOrdersRequest, []string]("getDocBlocksOrders", "/api/block/getDocBlocksOrders", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
	EnableEncryptedNotebooks             = define[NotebookPasswordRequest, Null]("enableEncryptedNotebooks", "/api/notebook/enableEncryptedNotebooks", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	DisableEncryptedNotebooks            = define[EmptyRequest, Null]("disableEncryptedNotebooks", "/api/notebook/disableEncryptedNotebooks", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	CreateEncryptedNotebook              = define[CreateEncryptedNotebookRequest, CreateNotebookData]("createEncryptedNotebook", "/api/notebook/createEncryptedNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	UnlockNotebook                       = define[UnlockNotebookRequest, Null]("unlockNotebook", "/api/notebook/unlockNotebook", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
	UnlockAndOpenNotebook                = define[UnlockNotebookRequest, Null]("unlockAndOpenNotebook", "/api/notebook/unlockAndOpenNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	LockNotebook                         = define[NotebookIDRequest, Null]("lockNotebook", "/api/notebook/lockNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetEncryptedNotebookFollowSystemLock = define[EncryptedNotebookFollowSystemLockRequest, Null]("setEncryptedNotebookFollowSystemLock", "/api/notebook/setEncryptedNotebookFollowSystemLock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	LockEncryptedNotebooksOnSystemLock   = define[EmptyRequest, Null]("lockEncryptedNotebooksOnSystemLock", "/api/notebook/lockEncryptedNotebooksOnSystemLock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetNotebookCryptoAutoLock            = define[NotebookCryptoAutoLockRequest, Null]("setNotebookCryptoAutoLock", "/api/notebook/setNotebookCryptoAutoLock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	ChangeMasterPassword                 = define[ChangeMasterPasswordRequest, Null]("changeMasterPassword", "/api/notebook/changeMasterPassword", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	ExportNotebookCryptoBackup           = define[EmptyRequest, NotebookCryptoBackupData]("exportNotebookCryptoBackup", "/api/notebook/exportNotebookCryptoBackup", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	TouchEncryptedNotebooks              = define[EmptyRequest, Null]("touchEncryptedNotebooks", "/api/notebook/touchEncryptedNotebooks", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	GetNotebookArchiveCandidates         = define[EmptyRequest, NotebookArchiveCandidatesData]("getNotebookArchiveCandidates", "/api/notebook/getNotebookArchiveCandidates", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	// 接收已锁定的加密笔记本 ID，返回归档 ID 和下载路径，不删除源数据，要求管理员权限。
	// 下载完成后，必须由用户确认已保存归档，再调用 `/api/notebook/commitNotebookArchive` 并传入 saved: true。
	PrepareNotebookArchive = define[PrepareNotebookArchiveRequest, NotebookArchiveData]("prepareNotebookArchive", "/api/notebook/prepareNotebookArchive", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// 移出已导出的加密笔记本，要求管理员权限并禁止只读模式；saved: true 表示用户确认已保存归档。
	// 提交前重新检查源文件，内容变化需重新导出；重复提交同一归档不会重复移出，未选择的笔记本不受影响。
	CommitNotebookArchive = define[CommitNotebookArchiveRequest, Null]("commitNotebookArchive", "/api/notebook/commitNotebookArchive", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// 接收 multipart 的 file、旧 password 和可选密钥备份 key，要求管理员权限并禁止只读模式。
	// 恢复目标必须关闭同步，且没有加密密钥配置或加密数据；密文全部通过认证后才发布，恢复后保持锁定。
	ImportNotebookArchive = define[ImportNotebookArchiveRequest, Null]("importNotebookArchive", "/api/notebook/importNotebookArchive", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")
)

var (
	GetBlockDOM           = define[BlockQueryRequest, BlockDOMData]("getBlockDOM", "/api/block/getBlockDOM", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockDOMWithEmbed  = define[BlockQueryRequest, BlockDOMData]("getBlockDOMWithEmbed", "/api/block/getBlockDOMWithEmbed", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockDOMs          = define[BlocksQueryRequest, map[string]string]("getBlockDOMs", "/api/block/getBlockDOMs", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockDOMsWithEmbed = define[BlocksQueryRequest, map[string]string]("getBlockDOMsWithEmbed", "/api/block/getBlockDOMsWithEmbed", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	// 默认输出供阅读的 Markdown，将原生页签平铺并将脑图输出为普通列表。
	// 原生页签和脑图的结构化编辑应使用 getBlockDOM，并保留已有 ID 和属性。
	GetBlockKramdown  = define[BlockKramdownRequest, BlockKramdownData]("getBlockKramdown", "/api/block/getBlockKramdown", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockKramdowns = define[BlocksKramdownRequest, map[string]string]("getBlockKramdowns", "/api/block/getBlockKramdowns", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
	GetRefText                  = define[BlockQueryRequest, string]("getRefText", "/api/block/getRefText", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetRefIDs                   = define[RefIDsRequest, RefIDsData]("getRefIDs", "/api/block/getRefIDs", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetRefIDsByFileAnnotationID = define[FileAnnotationRefRequest, RefDefsData]("getRefIDsByFileAnnotationID", "/api/block/getRefIDsByFileAnnotationID", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockDefIDsByRefText     = define[RefTextQueryRequest, RefDefsData]("getBlockDefIDsByRefText", "/api/block/getBlockDefIDsByRefText", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
	// 标题结果包含可选的 `headingChildren`，表示完整文档同一容器内是否有下辖块。
	// 空段落也算下辖块，结果不受折叠或分页影响；非标题及旧版内核省略该字段，省略不能视为空标题。
	GetBlockTreeInfos          = define[BlocksQueryRequest, map[string]*BlockTreeInfo]("getBlockTreeInfos", "/api/block/getBlockTreeInfos", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockBreadcrumb         = define[BlockBreadcrumbRequest, []*BlockPath]("getBlockBreadcrumb", "/api/block/getBlockBreadcrumb", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockBreadcrumbChildren = define[BlockBreadcrumbChildrenRequest, *BlockBreadcrumbChildren]("getBlockBreadcrumbChildren", "/api/block/getBlockBreadcrumbChildren", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
)

var GetDocInfo = define[BlockQueryRequest, *DocInfo]("getDocInfo", "/api/block/getDocInfo", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var GetDocsInfo = define[DocsInfoRequest, []*DocInfo]("getDocsInfo", "/api/block/getDocsInfo", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var GetTreeStat = define[TreeStatRequest, TreeStatData]("getTreeStat", "/api/block/getTreeStat", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var TransferBlockRef = define[TransferBlockRefRequest, Null]("transferBlockRef", "/api/block/transferBlockRef", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var SwapBlockRef = define[SwapBlockRefRequest, Null]("swapBlockRef", "/api/block/swapBlockRef", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var SetBlockReminder = define[BlockReminderRequest, Null]("setBlockReminder", "/api/block/setBlockReminder", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var UnfoldBlock = define[BlockIDRequest, Null]("unfoldBlock", "/api/block/unfoldBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var FoldBlock = define[BlockIDRequest, Null]("foldBlock", "/api/block/foldBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 同步移动块，previousID 优先于 parentID，省略 previousID 时移动到父块开头。
// 成功和主动跳过返回 code=0、data=null；事务校验或提交失败返回 code=-1、data=null 和原因。
// 事务回滚时通知界面重载并显示错误；访问受加密笔记本权限及跨加密边界限制。
var MoveBlock = define[MoveBlockRequest, Null]("moveBlock", "/api/block/moveBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var GetHeadingDeleteTransaction = define[BlockIDRequest, *BlockTransaction]("getHeadingDeleteTransaction", "/api/block/getHeadingDeleteTransaction", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var GetHeadingInsertTransaction = define[BlockIDRequest, *BlockTransaction]("getHeadingInsertTransaction", "/api/block/getHeadingInsertTransaction", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var GetHeadingFoldTransaction = define[HeadingFoldRequest, *BlockTransaction]("getHeadingFoldTransaction", "/api/block/getHeadingFoldTransaction", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var UpdateTaskListItemMarker = define[TaskListMarkerRequest, []*BlockTransaction]("updateTaskListItemMarker", "/api/block/updateTaskListItemMarker", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BatchUpdateTaskListItemMarker = define[BatchTaskListMarkerRequest, []*BlockTransaction]("batchUpdateTaskListItemMarker", "/api/block/batchUpdateTaskListItemMarker", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var MoveOutlineHeading = define[MoveBlockRequest, []*BlockTransaction]("moveOutlineHeading", "/api/block/moveOutlineHeading", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var AppendDailyNoteBlock = define[DailyNoteBlockRequest, []*BlockTransaction]("appendDailyNoteBlock", "/api/block/appendDailyNoteBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var PrependDailyNoteBlock = define[DailyNoteBlockRequest, []*BlockTransaction]("prependDailyNoteBlock", "/api/block/prependDailyNoteBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 目标为原生页签或脑图容器时，只能插入各自的项目块。
// 输入同类型容器片段时展开其直属项目，保留目标容器属性及项目 ID；非法子块由事务校验拒绝。
// 原生页签和脑图的结构化编辑使用 getBlockDOM 和 dataType="dom"，并保留已有 ID 和属性。
var AppendBlock = define[AppendBlockRequest, []*BlockTransaction]("appendBlock", "/api/block/appendBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 目标为原生页签或脑图容器时，只能插入各自的项目块。
// 输入同类型容器片段时展开其直属项目，保留目标容器属性及项目 ID；非法子块由事务校验拒绝。
// 响应在事务排队后返回，code=0 不代表事务已通过校验；事务失败不落盘。
// 原生页签和脑图的结构化编辑使用 getBlockDOM 和 dataType="dom"，并保留已有 ID 和属性。
var PrependBlock = define[PrependBlockRequest, []*BlockTransaction]("prependBlock", "/api/block/prependBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BatchAppendBlock = define[BatchParentBlockRequest, []*BlockTransaction]("batchAppendBlock", "/api/block/batchAppendBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BatchPrependBlock = define[BatchParentBlockRequest, []*BlockTransaction]("batchPrependBlock", "/api/block/batchPrependBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 按 nextID、previousID、parentID 的顺序选择插入位置。
// 生效的同级锚点必须是非文档块；未使用的定位参数不参与节点类型校验，文档 parentID 插入到文档开头。
// 目标非法时返回 code=-1、data=null，成功返回已落盘的操作。
// 目标为原生页签或脑图容器时，只能插入各自的项目块；同类型容器片段展开为其直属项目。
// 展开保留目标容器属性及项目 ID；非法子块由事务校验拒绝。
// 原生页签和脑图的结构化编辑使用 getBlockDOM 和 dataType="dom"，并保留已有 ID 和属性。
var InsertBlock = define[InsertBlockRequest, []*BlockTransaction]("insertBlock", "/api/block/insertBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BatchInsertBlock = define[BatchInsertBlockRequest, []*BlockTransaction]("batchInsertBlock", "/api/block/batchInsertBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var UpdateBlock = define[UpdateBlockRequest, []*BlockTransaction]("updateBlock", "/api/block/updateBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var MigrateLegacyMindmaps = define[MigrateLegacyMindmapsRequest, MigrateLegacyMindmapsData]("migrateLegacyMindmaps", "/api/block/migrateLegacyMindmaps", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BatchUpdateBlock = define[BatchUpdateBlockRequest, []*BlockTransaction]("batchUpdateBlock", "/api/block/batchUpdateBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var DeleteBlock = define[DeleteBlockRequest, []*BlockTransaction]("deleteBlock", "/api/block/deleteBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var CheckBlockRef = define[CheckBlockRefRequest, bool]("checkBlockRef", "/api/block/checkBlockRef", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

var GetHeadingLevelTransaction = define[HeadingLevelRequest, *BlockTransaction]("getHeadingLevelTransaction", "/api/block/getHeadingLevelTransaction", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var GetDocHeadingLevelTransaction = define[DocHeadingLevelRequest, *DocHeadingLevelData]("getDocHeadingLevelTransaction", "/api/block/getDocHeadingLevelTransaction", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")

var GetRecentUpdatedBlocks = define[EmptyRequest, []*SearchBlock]("getRecentUpdatedBlocks", "/api/block/getRecentUpdatedBlocks", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")

var Zip = define[ZipRequest, Null]("zip", "/api/archive/zip", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var Unzip = define[UnzipRequest, Null]("unzip", "/api/archive/unzip", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AutoSpace = define[TrimmedIDRequest, Null]("autoSpace", "/api/format/autoSpace", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var NetAssets2LocalAssets = define[TrimmedIDRequest, Null]("netAssets2LocalAssets", "/api/format/netAssets2LocalAssets", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var NetImg2LocalAssets = define[NetImageAssetsRequest, Null]("netImg2LocalAssets", "/api/format/netImg2LocalAssets", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var PushMsg = define[NotificationRequest, NotificationData]("pushMsg", "/api/notification/pushMsg", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var PushErrMsg = define[NotificationRequest, NotificationData]("pushErrMsg", "/api/notification/pushErrMsg", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetBookmark = define[EmptyRequest, []*Bookmark]("getBookmark", "/api/bookmark/getBookmark", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")

// 为管理员返回完整列表的 revision，即使结果按类型、启用状态或关键字筛选。
// 全量编辑应读取 type="all"、enabled=2 且不设置 keyword；发布读者不获得 revision。
var GetSnippet = define[GetSnippetRequest, SnippetsData]("getSnippet", "/api/snippet/getSnippet", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// 可携带 getSnippet 返回的 revision，在同一临界区检查版本并保存。
// 版本不匹配返回 code=-1、msg="snippet revision conflict"，不覆盖当前片段；调用方应保留草稿供用户合并。
// 省略 revision 或传入 null 时无条件全量保存，不能防止旧列表覆盖并发修改。
var SetSnippet = define[SetSnippetRequest, Null]("setSnippet", "/api/snippet/setSnippet", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveSnippet = define[TrimmedIDRequest, *Snippet]("removeSnippet", "/api/snippet/removeSnippet", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var FlushTransaction = define[EmptyRequest, Null]("flushTransaction", "/api/sqlite/flushTransaction", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var CopyStdMarkdown = define[CopyStdMarkdownRequest, string]("copyStdMarkdown", "/api/lute/copyStdMarkdown", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var Md2HTML = define[MarkdownHTMLRequest, HTMLData]("md2HTML", "/api/lute/md2html", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var SpinBlockDOM = define[DOMTextRequest, DOMData]("spinBlockDOM", "/api/lute/spinBlockDOM", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{413}}, "POST")

var ReloadTag = define[EmptyRequest, Null]("reloadTag", "/api/ui/reloadTag", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var ReloadFiletree = define[EmptyRequest, Null]("reloadFiletree", "/api/ui/reloadFiletree", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var ReloadProtyle = define[BlockIDRequest, Null]("reloadProtyle", "/api/ui/reloadProtyle", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ReloadAttributeView = define[BlockIDRequest, Null]("reloadAttributeView", "/api/ui/reloadAttributeView", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ReloadUI = define[EmptyRequest, Null]("reloadUI", "/api/ui/reloadUI", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var ReloadIcon = define[EmptyRequest, Null]("reloadIcon", "/api/ui/reloadIcon", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var ReloadTheme = define[EmptyRequest, Null]("reloadTheme", "/api/ui/reloadTheme", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

var GetLocalStorage = define[EmptyRequest, map[string]JSONValue]("getLocalStorage", "/api/storage/getLocalStorage", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var GetLocalStorageVal = define[StorageKeyRequest, JSONValue]("getLocalStorageVal", "/api/storage/getLocalStorageVal", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetLocalStorageVals = define[StorageKeysRequest, map[string]JSONValue]("getLocalStorageVals", "/api/storage/getLocalStorageVals", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var SetLocalStorageVal = define[StorageSetRequest, Null]("setLocalStorageVal", "/api/storage/setLocalStorageVal", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetLocalStorageVals = define[StorageSetKeysRequest, Null]("setLocalStorageVals", "/api/storage/setLocalStorageVals", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveLocalStorageVal = define[StorageRemoveRequest, Null]("removeLocalStorageVal", "/api/storage/removeLocalStorageVal", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveLocalStorageVals = define[StorageRemoveKeysRequest, Null]("removeLocalStorageVals", "/api/storage/removeLocalStorageVals", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetOutlineStorage = define[OutlineStorageRequest, map[string]JSONValue]("getOutlineStorage", "/api/storage/getOutlineStorage", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var SetOutlineStorage = define[OutlineStorageSetRequest, Null]("setOutlineStorage", "/api/storage/setOutlineStorage", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveOutlineStorage = define[OutlineStorageRequest, Null]("removeOutlineStorage", "/api/storage/removeOutlineStorage", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetViewState = define[StorageKeyRequest, map[string]JSONValue]("getViewState", "/api/storage/getViewState", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var PatchViewState = define[ViewStatePatchRequest, map[string]JSONValue]("patchViewState", "/api/storage/patchViewState", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveViewState = define[StorageKeyRequest, Null]("removeViewState", "/api/storage/removeViewState", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetRecentDocs = define[RecentDocsRequest, []*RecentDoc]("getRecentDocs", "/api/storage/getRecentDocs", AuthenticatedAccess, LegacyOptionalBody, ResponseOptions{}, "POST")

var ResetBlockAttrs = define[EmptyRequest, Null]("resetBlockAttrs", "/api/attr/resetBlockAttrs", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var SearchAttributeViewNonRelationKey = define[EmptyRequest, Null]("searchAttributeViewNonRelationKey", "/api/av/searchAttributeViewNonRelationKey", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var SetLocalStorage = define[EmptyRequest, Null]("setLocalStorage", "/api/storage/setLocalStorage", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var DeprecatedReloadUI = define[EmptyRequest, Null]("deprecatedReloadUI", "/api/system/reloadUI", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

var GetCriteria = define[EmptyRequest, []*Criterion]("getCriteria", "/api/storage/getCriteria", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SetCriterion = define[SetCriterionRequest, Null]("setCriterion", "/api/storage/setCriterion", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveCriterion = define[RemoveCriterionRequest, Null]("removeCriterion", "/api/storage/removeCriterion", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var UpdateRecentDocOpenTime = define[RecentDocUpdateRequest, Null]("updateRecentDocOpenTime", "/api/storage/updateRecentDocOpenTime", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var UpdateRecentDocViewTime = define[RecentDocUpdateRequest, Null]("updateRecentDocViewTime", "/api/storage/updateRecentDocViewTime", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var UpdateRecentDocCloseTime = define[RecentDocUpdateRequest, Null]("updateRecentDocCloseTime", "/api/storage/updateRecentDocCloseTime", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var BatchUpdateRecentDocCloseTime = define[RecentDocsUpdateRequest, Null]("batchUpdateRecentDocCloseTime", "/api/storage/batchUpdateRecentDocCloseTime", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var GetDocOutline = define[OutlineRequest, []*SearchPath]("getDocOutline", "/api/outline/getDocOutline", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetDocHeadingNumbers = define[HeadingNumbersRequest, map[string]string]("getDocHeadingNumbers", "/api/outline/getDocHeadingNumbers", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var GetInlineStyles = define[EmptyRequest, *InlineStyles]("getInlineStyles", "/api/storage/getInlineStyles", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SetInlineStyles = define[SetInlineStylesRequest, *InlineStyles]("setInlineStyles", "/api/storage/setInlineStyles", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetWorkspaceAVPalette = define[WorkspaceAVPaletteRequest, *InlineStyles]("setWorkspaceAVPalette", "/api/storage/setWorkspaceAVPalette", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var HTML2BlockDOM = define[HTMLClipboardRequest, HTMLClipboardData]("html2BlockDOM", "/api/lute/html2BlockDOM", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var WPSPresentation2BlockDOM = define[WPSPresentationRequest, WPSPresentationData]("wpsPresentation2BlockDOM", "/api/lute/wpsPresentation2BlockDOM", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

var LoadPetals = define[LoadPetalsRequest, []*Petal]("loadPetals", "/api/petal/loadPetals", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var SetPetalEnabled = define[SetPetalEnabledRequest, *Petal]("setPetalEnabled", "/api/petal/setPetalEnabled", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var SetPetalPublishEnabled = define[SetPetalPublishEnabledRequest, *Petal]("setPetalPublishEnabled", "/api/petal/setPetalPublishEnabled", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var GetPluginPublishInfo = define[PluginPublishRequest, PluginPublishInfo]("getPluginPublishInfo", "/api/petal/getPluginPublishInfo", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{400, 403, 500}}, "POST")
var SetPluginPublishDataGrant = define[SetPluginPublishDataGrantRequest, Null]("setPluginPublishDataGrant", "/api/petal/setPluginPublishDataGrant", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{400, 403, 500}}, "POST")
var SavePluginPublishData = define[SavePluginPublishDataRequest, Null]("savePluginPublishData", "/api/petal/savePluginPublishData", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{400, 403, 500}}, "POST")
var LoadPluginPublishData = define[PluginPublishRequest, map[string]PublishDataValue]("loadPluginPublishData", "/api/petal/loadPluginPublishData", AuthenticatedAccess, JSONBody, ResponseOptions{NonNullable: true, AdditionalCodes: []int{400, 403, 404, 500}}, "POST")

var Pandoc = define[PandocRequest, PandocData]("pandoc", "/api/convert/pandoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var PostBroadcastMessage = define[BroadcastMessageRequest, BroadcastChannelData]("postMessage", "/api/broadcast/postMessage", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var GetBroadcastChannelInfo = define[BroadcastChannelRequest, BroadcastChannelData]("getChannelInfo", "/api/broadcast/getChannelInfo", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var GetBroadcastChannels = define[EmptyRequest, BroadcastChannelsData]("getChannels", "/api/broadcast/getChannels", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

var BroadcastPublish = define[MultipartFields, BroadcastPublishData]("broadcastPublish", "/api/broadcast/publish", AuthenticatedAccess|AdminAccess, MultipartBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var SetCloudReminder = define[CloudReminderRequest, Null]("setCloudReminder", "/api/cloud/setCloudReminder", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetCloudSpace = define[EmptyRequest, CloudSpaceData]("getCloudSpace", "/api/cloud/getCloudSpace", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var RemoveShorthands = define[RemoveShorthandsRequest, Null]("removeShorthands", "/api/inbox/removeShorthands", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetShorthand = define[TrimmedIDRequest, *Shorthand]("getShorthand", "/api/inbox/getShorthand", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetShorthands = define[ShorthandsRequest, *ShorthandsData]("getShorthands", "/api/inbox/getShorthands", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var ReadClipboardFilePaths = define[EmptyRequest, []ClipboardFile]("readFilePaths", "/api/clipboard/readFilePaths", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{NonNullable: true}, "POST")
var WriteClipboardFilePath = define[ClipboardPathRequest, Null]("writeFilePath", "/api/clipboard/writeFilePath", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var PrepareRichText = define[PrepareRichTextRequest, *RichClipboardPrepared]("prepareRichText", "/api/clipboard/prepareRichText", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 接收已解锁的加密 notebook 和 assets 引用数组，返回原引用到新引用的映射。
// 普通附件复制为独立加密副本，原文件保持不变；同一笔记本内复用已有附件，拒绝跨加密笔记本复制。
// 引用仅限工作空间 assets/ 路径，可包含查询参数、片段和 PDF 标注 ID；PDF 标注文件随附件复制。
// 整批准备成功后调用方再插入内容；失败返回 code=-1、data=null，并清理本批次新建附件。
// 要求管理员权限，禁止只读写入，响应持有加密笔记本请求租约。
var PreparePasteAssets = define[PreparePasteAssetsRequest, map[string]string]("preparePasteAssets", "/api/clipboard/preparePasteAssets", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{NonNullable: true}, "POST")
var CleanupRichText = define[CleanupRichTextRequest, Null]("cleanupRichText", "/api/clipboard/cleanupRichText", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var StartFreeTrial = define[EmptyRequest, Null]("startFreeTrial", "/api/account/startFreeTrial", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

var UseActivationCode = define[ActivationCodeRequest, Null]("useActivationcode", "/api/account/useActivationcode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var CheckActivationCode = define[CheckActivationCodeRequest, Null]("checkActivationcode", "/api/account/checkActivationcode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")

var DeactivateUser = define[EmptyRequest, Null]("deactivateUser", "/api/account/deactivate", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

var AccountLogin = define[AccountLoginRequest, *AccountLoginData]("login", "/api/account/login", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 10}, DataOnError: true}, "POST")

var GetUniqueFilename = define[FilePathRequest, FilePathData]("getUniqueFilename", "/api/file/getUniqueFilename", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-3}}, "POST")

var ReadDirectory = define[ReadDirectoryRequest, []DirectoryEntry]("readDir", "/api/file/readDir", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-3, 403, 404, 409, 500}, NonNullable: true}, "POST")

var RenameFile = define[RenameFileRequest, Null]("renameFile", "/api/file/renameFile", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-3, 403, 404, 409, 500}}, "POST")

var RemoveFile = define[RemoveFileRequest, Null]("removeFile", "/api/file/removeFile", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-3, 403, 404, 500}}, "POST")

var GlobalCopyFiles = define[CopyFilesRequest, Null]("globalCopyFiles", "/api/file/globalCopyFiles", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-2, -3, 403}}, "POST")

var WorkspaceCopyFiles = define[CopyFilesRequest, Null]("workspaceCopyFiles", "/api/file/workspaceCopyFiles", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-2, -3, 403}}, "POST")

var CopyFile = define[CopyFileRequest, Null]("copyFile", "/api/file/copyFile", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-2}}, "POST")

var PutFile = define[PutFileRequest, Null]("putFile", "/api/file/putFile", AuthenticatedAccess|AdminAccess|WritableAccess, FormBody, ResponseOptions{AdditionalCodes: []int{-3, 400, 403, 500}}, "POST")

var GetFile = define[FilePathRequest, BinaryContent]("getFile", "/api/file/getFile", AuthenticatedAccess, JSONBody,
	ResponseOptions{Output: BinaryOutput, ErrorStatus: 202, AdditionalCodes: []int{-3, 403, 404, 409, 500, 503}}, "POST")

var QuerySQL = define[SQLQueryRequest, SQLRows]("SQL", "/api/query/sql", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}, NonNullable: true}, "POST")

var RenderSprig = define[RenderSprigRequest, string]("renderSprig", "/api/template/renderSprig", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var GetDocSaveAsTemplateInfo = define[TemplateDocumentRequest, TemplateDocumentInfo]("getDocSaveAsTemplateInfo", "/api/template/getDocSaveAsTemplateInfo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var DocSaveAsTemplate = define[SaveTemplateRequest, Null]("docSaveAsTemplate", "/api/template/docSaveAsTemplate", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var RenderTemplate = define[RenderTemplateRequest, RenderTemplateData]("renderTemplate", "/api/template/render", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 读取模板源码时，可选的 sourceDocID 表示导出模板末尾文档属性中的静态来源 ID。
// 普通 Markdown、目录或未声明有效 ID 的模板不返回该字段；读取不会执行模板或检查源文档是否仍可访问。
// 打开来源时需按当前工作空间的文档访问规则处理失败；该字段不是预览上下文，也不保证模板与源文档保持同步。
var ManageTemplateFiles = define[TemplateFileRequest, TemplateManagementData]("manageTemplateFiles", "/api/template/manage", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")

var ResetGraph = define[EmptyRequest, ResetGraphData]("resetGraph", "/api/graph/resetGraph", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

var ResetLocalGraph = define[EmptyRequest, ResetLocalGraphData]("resetLocalGraph", "/api/graph/resetLocalGraph", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

var SetGraphConf = define[SetGraphConfRequest, GraphConfigurationData]("setGraphConf", "/api/graph/setGraphConf", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var GetGraph = define[GlobalGraphRequest, GlobalGraphData]("getGraph", "/api/graph/getGraph", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

var GetLocalGraph = define[LocalGraphRequest, LocalGraphData]("getLocalGraph", "/api/graph/getLocalGraph", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

var RefreshBacklink = define[RefreshBacklinkRequest, Null]("refreshBacklink", "/api/ref/refreshBacklink", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 提及数量提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，发布读者不发送提示。
var GetBackmentionDoc = define[BackmentionDocumentRequest, BacklinkContextData]("getBackmentionDoc", "/api/ref/getBackmentionDoc", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var GetBacklinkDoc = define[BacklinkDocumentRequest, BacklinkContextData]("getBacklinkDoc", "/api/ref/getBacklinkDoc", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 提及数量提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，发布读者不发送提示。
var GetBacklink2 = define[BacklinkListRequest, BacklinkListData]("getBacklink2", "/api/ref/getBacklink2", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var GetGlobalBacklinks = define[GlobalBacklinkListRequest, GlobalBacklinkListData]("getGlobalBacklinks", "/api/ref/getGlobalBacklinks", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetGlobalBacklinkContexts = define[GlobalBacklinkContextRequest, GlobalBacklinkContextData]("getGlobalBacklinkContexts", "/api/ref/getGlobalBacklinkContexts", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var ContinueImportSY = define[ContinueImportSYRequest, ImportDocumentData]("continueImportSY", "/api/import/continueImportSY", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var CancelImportSY = define[ImportTokenRequest, Null]("cancelImportSY", "/api/import/cancelImportSY", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var StartObsidianVaultAnalysis = define[ObsidianAnalysisRequest, *ObsidianVaultTask]("startObsidianVaultAnalysis", "/api/import/startObsidianVaultAnalysis", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var GetObsidianVaultTask = define[ObsidianTaskRequest, *ObsidianVaultTask]("getObsidianVaultTask", "/api/import/getObsidianVaultTask", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var StartObsidianVaultImport = define[ObsidianImportRequest, *ObsidianVaultTask]("startObsidianVaultImport", "/api/import/startObsidianVaultImport", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var CancelObsidianVaultTask = define[ObsidianTaskRequest, *ObsidianVaultTask]("cancelObsidianVaultTask", "/api/import/cancelObsidianVaultTask", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

// 标准脚注定义保存为独立列表项，正文引用转换为指向列表项的上标静态块引用。
// 多段内容保留在同一列表项内；多次引用共享目标，标签匹配忽略大小写，重复定义引用第一个匹配项。
// 未定义的脚注不生成块引用，代码和转义的脚注文本保持原样；反链复用块引用索引。
var ImportStdMd = define[ImportMarkdownRequest, Null]("importStdMd", "/api/import/importStdMd", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var ImportData = define[ImportDataRequest, Null]("importData", "/api/import/importData", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// 压缩包中的 Markdown 使用与 `/api/import/importStdMd` 相同的标准脚注转换规则。
var ImportZipMd = define[ImportZipMarkdownRequest, Null]("importZipMd", "/api/import/importZipMd", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// `.sy.zip` 导入复用同名同内容的自定义表情。
// 同名不同内容时返回错误并保留已有表情文件。
var ImportSY = define[ImportSYRequest, Null]("importSY", "/api/import/importSY", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// `.sy.zip` 导入复用同名同内容的自定义表情。
// 同名不同内容时返回错误并保留已有表情文件。
var ImportSYNotebook = define[ImportDataRequest, ImportNotebookData]("importSYNotebook", "/api/import/importSYNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// `.sy.zip` 导入复用同名同内容的自定义表情。
// 同名不同内容时返回错误并保留已有表情文件。
var ImportSYAuto = define[ImportSYRequest, ImportAutoData]("importSYAuto", "/api/import/importSYAuto", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{DataOnError: true}, "POST")

var GetHistoryItems = define[HistoryItemsRequest, HistoryItemsData]("getHistoryItems", "/api/history/getHistoryItems", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var GetNotebookHistory = define[EmptyRequest, NotebookHistoryData]("getNotebookHistory", "/api/history/getNotebookHistory", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

var GetDocHistoryContent = define[DocHistoryContentRequest, DocHistoryContentData]("getDocHistoryContent", "/api/history/getDocHistoryContent", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 接收文档 id、最多 32 个 searchHistory 时间戳 created，以及可选的 op（默认 all）。
// 每条结果包含 created、historyPath 和 snapshots，按快照创建时间倒序。
// snapshots 的每项包含 id、fileID、tags、memo 和 created；同一快照的多个标记合并到 tags。
// 仅匹配本地标记快照中认证解密后完整 .sy 数据相同的文件，不保证资源、数据库或引用内容相同。
// 无仓库密钥时关联为空；缺失历史、格式错误、读取或认证失败返回错误。
// 要求管理员权限，加密笔记本必须解锁，响应持有请求租约；不下载云端内容，不持久化摘要。
var GetDocHistorySnapshots = define[DocHistorySnapshotsRequest, DocHistorySnapshotsData]("getDocHistorySnapshots", "/api/history/getDocHistorySnapshots", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var CreateDocHistory = define[CreateDocHistoryRequest, Null]("createDocHistory", "/api/history/createDocHistory", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var CreateAssetHistory = define[CreateAssetHistoryRequest, Null]("createAssetHistory", "/api/history/createAssetHistory", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var RollbackDocHistory = define[HistoryPathRequest, Null]("rollbackDocHistory", "/api/history/rollbackDocHistory", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var RollbackAssetsHistory = define[HistoryPathRequest, Null]("rollbackAssetsHistory", "/api/history/rollbackAssetsHistory", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var RollbackNotebookHistory = define[HistoryPathRequest, Null]("rollbackNotebookHistory", "/api/history/rollbackNotebookHistory", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var RollbackAttributeViewHistory = define[HistoryPathRequest, Null]("rollbackAttributeViewHistory", "/api/history/rollbackAttributeViewHistory", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var DiffDocVersions = define[DiffDocVersionsRequest, *DocVersionDiffResult]("diffDocVersions", "/api/history/diffDocVersions", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var SearchAssetByName = define[SearchAssetRequest, []*SearchAsset]("searchAsset", "/api/search/searchAsset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var SearchWidget = define[SearchKeywordRequest, SearchWidgetData]("searchWidget", "/api/search/searchWidget", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var SearchTemplate = define[SearchKeywordRequest, SearchTemplateData]("searchTemplate", "/api/search/searchTemplate", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var RemoveSearchTemplate = define[SearchPathRequest, Null]("removeTemplate", "/api/search/removeTemplate", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var GetAssetContent = define[AssetContentRequest, AssetContentData]("getAssetContent", "/api/search/getAssetContent", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var GetAssetContentByPath = define[SearchPathRequest, AssetContentData]("getAssetContentByPath", "/api/search/getAssetContentByPath", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var ListInvalidBlockRefs = define[SearchPageRequest, SearchBlocksData]("listInvalidBlockRefs", "/api/search/listInvalidBlockRefs", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var UpdateEmbedBlock = define[UpdateEmbedBlockRequest, Null]("updateEmbedBlock", "/api/search/updateEmbedBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var FullTextSearchAssetContent = define[SearchAssetContentRequest, SearchAssetContentData]("fullTextSearchAssetContent", "/api/search/fullTextSearchAssetContent", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var GetEmbedBlock = define[GetEmbedBlockRequest, EmbedBlocksData]("getEmbedBlock", "/api/search/getEmbedBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var SearchEmbedBlock = define[SearchEmbedBlockRequest, EmbedBlocksData]("searchEmbedBlock", "/api/search/searchEmbedBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// method 缺省或为 null 时使用文本替换，支持文本（0）、查询语法（1）和正则表达式（3）。
// SQL（2）和语义搜索（4）返回 code=1 与提示信息，不执行替换；ids 为空时表示替换全部。
// 文本与查询语法替换的所有启用类型遵循搜索配置的 caseSensitive，替换串按字面量写入。
// 正则模式的大小写匹配由表达式决定，替换串支持捕获组展开。
var FindReplace = define[FindReplaceRequest, Null]("findReplace", "/api/search/findReplace", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var SemanticSearchBlock = define[SearchBlockRequest, SearchBlocksData]("semanticSearchBlock", "/api/search/semanticSearchBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// SQL 模式保留换行、注释与字面量大小写，支持带别名的完整块投影。
var FullTextSearchBlock = define[FullTextSearchBlockRequest, *FullTextSearchBlockData]("fullTextSearchBlock", "/api/search/fullTextSearchBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var SearchRefBlock = define[SearchRefBlockRequest, SearchRefData]("searchRefBlock", "/api/search/searchRefBlock", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

var ListLoadedPlugins = define[EmptyRequest, []*LoadedPlugin]("listLoadedPlugins", "/api/plugin/listLoadedPlugins", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")

var ListLoadedPluginsGET = define[EmptyRequest, []*LoadedPlugin]("listLoadedPluginsGET", "/api/plugin", AuthenticatedAccess, NoBody, ResponseOptions{}, "GET")

var GetLoadedPlugin = define[LoadedPluginRequest, *LoadedPlugin]("getLoadedPlugin", "/api/plugin/getLoadedPlugin", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4}}, "POST")

var GetLoadedPluginRPC = define[LoadedPluginRequest, *LoadedPlugin]("getLoadedPluginRPC", "/api/plugin/rpc", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4}}, "GET")

var GetLoadedPluginRPCByName = define[LoadedPluginRequest, *LoadedPlugin]("getLoadedPluginRPCByName", "/api/plugin/rpc/:name", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4}}, "GET")

var PluginRPCHTTP = define[PluginRPCBatchRequest, PluginRPCResponse]("pluginJsonRpcHttp", "/api/plugin/rpc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Output: DirectJSONOutput, NoContent: true}, "POST")

var PluginRPCHTTPByName = define[PluginRPCBatchRequest, PluginRPCResponse]("pluginJsonRpcHttpByName", "/api/plugin/rpc/:name", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Output: DirectJSONOutput, NoContent: true}, "POST")

var PluginRPCWebSocket = define[EmptyRequest, PluginRPCFailure]("pluginJsonRpcWebSocket", "/ws/plugin/rpc", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, WebSocketOptions[PluginRPCBatchRequest, PluginRPCMessage](404), "GET")

var PluginRPCWebSocketByName = define[EmptyRequest, PluginRPCFailure]("pluginJsonRpcWebSocketByName", "/ws/plugin/rpc/:name", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, WebSocketOptions[PluginRPCBatchRequest, PluginRPCMessage](404), "GET")

var InstallLocalBazaarPackage = define[InstallLocalBazaarPackageRequest, BazaarLocalInstallResult]("installLocalBazaarPackage", "/api/bazaar/installLocalBazaarPackage", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var BatchUpdatePackage = define[BatchUpdatePackageRequest, Null]("batchUpdatePackage", "/api/bazaar/batchUpdatePackage", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetUpdatedPackage = define[GetUpdatedPackageRequest, BazaarUpdatedData]("getUpdatedPackage", "/api/bazaar/getUpdatedPackage", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 下载完成提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，离线目标不回退广播。
var UpdateBazaarPackage = define[UpdateBazaarPackageRequest, BazaarPackagesData]("updateBazaarPackage", "/api/bazaar/updateBazaarPackage", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledPackageSize = define[GetInstalledPackageSizeRequest, BazaarPackageSizeData]("getInstalledPackageSize", "/api/bazaar/getInstalledPackageSize", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarPackage = define[GetBazaarPackageRequest, BazaarPackageDetail]("getBazaarPackage", "/api/bazaar/getBazaarPackage", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarPackageRatings = define[GetBazaarPackageRatingsRequest, BazaarRatingsData]("getBazaarPackageRatings", "/api/bazaar/getBazaarPackageRatings", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarPackageUserRatings = define[GetBazaarPackageUserRatingsRequest, BazaarUserRatingsResult]("getBazaarPackageUserRatings", "/api/bazaar/getBazaarPackageUserRatings", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var GetBazaarPackageRating = define[GetBazaarPackageRatingRequest, BazaarRatingResult]("getBazaarPackageRating", "/api/bazaar/getBazaarPackageRating", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var SetBazaarPackageRating = define[SetBazaarPackageRatingRequest, BazaarRatingResult]("setBazaarPackageRating", "/api/bazaar/setBazaarPackageRating", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var GetBazaarPackageREADME = define[GetBazaarPackageREADMERequest, BazaarREADMEData]("getBazaarPackageREADME", "/api/bazaar/getBazaarPackageREADME", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarPlugin = define[GetBazaarPluginRequest, BazaarPackagesData]("getBazaarPlugin", "/api/bazaar/getBazaarPlugin", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledPlugin = define[GetInstalledPluginRequest, BazaarPackagesData]("getInstalledPlugin", "/api/bazaar/getInstalledPlugin", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 下载完成提示使用可选请求头 X-SiYuan-App-ID 定向；插件重载事件仍广播。
var InstallBazaarPlugin = define[InstallBazaarPluginRequest, BazaarPackagesData]("installBazaarPlugin", "/api/bazaar/installBazaarPlugin", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarPlugin = define[UninstallBazaarPluginRequest, BazaarPackagesData]("uninstallBazaarPlugin", "/api/bazaar/uninstallBazaarPlugin", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarWidget = define[GetBazaarWidgetRequest, BazaarPackagesData]("getBazaarWidget", "/api/bazaar/getBazaarWidget", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledWidget = define[GetInstalledWidgetRequest, BazaarPackagesData]("getInstalledWidget", "/api/bazaar/getInstalledWidget", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 下载完成提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播。
var InstallBazaarWidget = define[InstallBazaarWidgetRequest, BazaarPackagesData]("installBazaarWidget", "/api/bazaar/installBazaarWidget", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarWidget = define[UninstallBazaarWidgetRequest, BazaarPackagesData]("uninstallBazaarWidget", "/api/bazaar/uninstallBazaarWidget", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarIcon = define[GetBazaarIconRequest, BazaarPackagesData]("getBazaarIcon", "/api/bazaar/getBazaarIcon", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledIcon = define[GetInstalledIconRequest, BazaarPackagesData]("getInstalledIcon", "/api/bazaar/getInstalledIcon", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 下载完成提示使用可选请求头 X-SiYuan-App-ID 定向；外观刷新事件仍广播。
var InstallBazaarIcon = define[InstallBazaarIconRequest, BazaarAppearancePackagesData]("installBazaarIcon", "/api/bazaar/installBazaarIcon", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarIcon = define[UninstallBazaarIconRequest, BazaarAppearancePackagesData]("uninstallBazaarIcon", "/api/bazaar/uninstallBazaarIcon", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarTemplate = define[GetBazaarTemplateRequest, BazaarPackagesData]("getBazaarTemplate", "/api/bazaar/getBazaarTemplate", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledTemplate = define[GetInstalledTemplateRequest, BazaarPackagesData]("getInstalledTemplate", "/api/bazaar/getInstalledTemplate", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 下载完成提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播。
var InstallBazaarTemplate = define[InstallBazaarTemplateRequest, BazaarPackagesData]("installBazaarTemplate", "/api/bazaar/installBazaarTemplate", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarTemplate = define[UninstallBazaarTemplateRequest, BazaarPackagesData]("uninstallBazaarTemplate", "/api/bazaar/uninstallBazaarTemplate", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarTheme = define[GetBazaarThemeRequest, BazaarPackagesData]("getBazaarTheme", "/api/bazaar/getBazaarTheme", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledTheme = define[GetInstalledThemeRequest, BazaarPackagesData]("getInstalledTheme", "/api/bazaar/getInstalledTheme", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 下载完成提示使用可选请求头 X-SiYuan-App-ID 定向；外观刷新事件仍广播。
var InstallBazaarTheme = define[InstallBazaarThemeRequest, BazaarAppearancePackagesData]("installBazaarTheme", "/api/bazaar/installBazaarTheme", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarTheme = define[UninstallBazaarThemeRequest, BazaarAppearancePackagesData]("uninstallBazaarTheme", "/api/bazaar/uninstallBazaarTheme", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var SetSyncEnable = define[SyncEnabledRequest, Null]("setSyncEnable", "/api/sync/setSyncEnable", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSyncInterval = define[SyncIntervalRequest, Null]("setSyncInterval", "/api/sync/setSyncInterval", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSyncPerception = define[SyncEnabledRequest, Null]("setSyncPerception", "/api/sync/setSyncPerception", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSyncLAN = define[SyncLANRequest, SyncLANStatus]("setSyncLAN", "/api/sync/setSyncLAN", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetSyncLANStatus = define[EmptyRequest, SyncLANStatus]("getSyncLANStatus", "/api/sync/getSyncLANStatus", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SetSyncGenerateConflictDoc = define[SyncEnabledRequest, Null]("setSyncGenerateConflictDoc", "/api/sync/setSyncGenerateConflictDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSyncMode = define[SyncModeRequest, Null]("setSyncMode", "/api/sync/setSyncMode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSyncProvider = define[SyncProviderRequest, Null]("setSyncProvider", "/api/sync/setSyncProvider", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSyncProviderS3 = define[SetSyncS3Request, SyncS3Data]("setSyncProviderS3", "/api/sync/setSyncProviderS3", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSyncProviderWebDAV = define[SetSyncWebDAVRequest, SyncWebDAVData]("setSyncProviderWebDAV", "/api/sync/setSyncProviderWebDAV", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSyncProviderLocal = define[SetSyncLocalRequest, SyncLocalData]("setSyncProviderLocal", "/api/sync/setSyncProviderLocal", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetCloudSyncDir = define[SyncNameRequest, Null]("setCloudSyncDir", "/api/sync/setCloudSyncDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSyncAssetDownloadMode = define[SyncModeRequest, SyncAssetDownloadModeData]("setSyncAssetDownloadMode", "/api/sync/setSyncAssetDownloadMode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var CreateCloudSyncDir = define[SyncNameRequest, Null]("createCloudSyncDir", "/api/sync/createCloudSyncDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveCloudSyncDir = define[SyncNameRequest, string]("removeCloudSyncDir", "/api/sync/removeCloudSyncDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ListCloudSyncDir = define[EmptyRequest, CloudSyncDirsData]("listCloudSyncDir", "/api/sync/listCloudSyncDir", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var PerformSync = define[PerformSyncRequest, Null]("performSync", "/api/sync/performSync", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var PerformBootSync = define[EmptyRequest, Null]("performBootSync", "/api/sync/performBootSync", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBootSync = define[EmptyRequest, Null]("getBootSync", "/api/sync/getBootSync", AuthenticatedAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetSyncInfo = define[EmptyRequest, SyncInfoData]("getSyncInfo", "/api/sync/getSyncInfo", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var ExportSyncProviderS3 = define[EmptyRequest, SyncProviderExportData]("exportSyncProviderS3", "/api/sync/exportSyncProviderS3", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var ImportSyncProviderS3 = define[SyncProviderImportRequest, SyncS3Data]("importSyncProviderS3", "/api/sync/importSyncProviderS3", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{DataOnError: true}, "POST")
var ExportSyncProviderWebDAV = define[EmptyRequest, SyncProviderExportData]("exportSyncProviderWebDAV", "/api/sync/exportSyncProviderWebDAV", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var ImportSyncProviderWebDAV = define[SyncProviderImportRequest, SyncWebDAVData]("importSyncProviderWebDAV", "/api/sync/importSyncProviderWebDAV", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{DataOnError: true}, "POST")

var GetRiffCardsByBlockIDs = define[RiffBlockIDsRequest, RiffBlocksData]("getRiffCardsByBlockIDs", "/api/riff/getRiffCardsByBlockIDs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var BatchSetRiffCardsDueTime = define[SetRiffCardsDueRequest, Null]("batchSetRiffCardsDueTime", "/api/riff/batchSetRiffCardsDueTime", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ResetRiffCards = define[ResetRiffCardsRequest, Null]("resetRiffCards", "/api/riff/resetRiffCards", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetNotebookRiffCards = define[RiffCardsRequest, RiffCardsData]("getNotebookRiffCards", "/api/riff/getNotebookRiffCards", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetTreeRiffCards = define[RiffCardsRequest, RiffCardsData]("getTreeRiffCards", "/api/riff/getTreeRiffCards", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// GetRiffCards 按到期时间升序分页，零到期时间的新卡排在前面，相同到期时间按卡片 ID 排序。
var GetRiffCards = define[RiffCardsRequest, RiffCardsData]("getRiffCards", "/api/riff/getRiffCards", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ReviewRiffCard = define[ReviewRiffCardRequest, Null]("reviewRiffCard", "/api/riff/reviewRiffCard", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SkipReviewRiffCard = define[RiffCardRequest, Null]("skipReviewRiffCard", "/api/riff/skipReviewRiffCard", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetNotebookRiffDueCards = define[RiffNotebookDueCardsRequest, RiffDueCardsData]("getNotebookRiffDueCards", "/api/riff/getNotebookRiffDueCards", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetTreeRiffDueCards = define[RiffTreeDueCardsRequest, RiffDueCardsData]("getTreeRiffDueCards", "/api/riff/getTreeRiffDueCards", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetRiffDueCards = define[RiffDueCardsRequest, RiffDueCardsData]("getRiffDueCards", "/api/riff/getRiffDueCards", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveRiffCards = define[RiffDeckCardsRequest, *RiffDeck]("removeRiffCards", "/api/riff/removeRiffCards", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AddRiffCards = define[RiffDeckCardsRequest, *RiffDeck]("addRiffCards", "/api/riff/addRiffCards", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RenameRiffDeck = define[RenameRiffDeckRequest, Null]("renameRiffDeck", "/api/riff/renameRiffDeck", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveRiffDeck = define[RiffDeckRequest, Null]("removeRiffDeck", "/api/riff/removeRiffDeck", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var CreateRiffDeck = define[CreateRiffDeckRequest, *RiffDeck]("createRiffDeck", "/api/riff/createRiffDeck", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetRiffDecks = define[EmptyRequest, []*RiffDeck]("getRiffDecks", "/api/riff/getRiffDecks", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{NonNullable: true}, "POST")

var SetRepoIndexRetentionDays = define[SetRepoIndexRetentionDaysRequest, Null]("setRepoIndexRetentionDays", "/api/repo/setRepoIndexRetentionDays", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var SetRetentionIndexesDaily = define[SetRetentionIndexesDailyRequest, Null]("setRetentionIndexesDaily", "/api/repo/setRetentionIndexesDaily", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetRepoFile = define[GetRepoFileRequest, BinaryContent]("getRepoFile", "/api/repo/getRepoFile", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200}, "POST")
var RollbackRepoSnapshotFile = define[RollbackRepoSnapshotFileRequest, Null]("rollbackRepoSnapshotFile", "/api/repo/rollbackRepoSnapshotFile", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var OpenRepoSnapshotFile = define[OpenRepoSnapshotFileRequest, RepoOpenFileData]("openRepoSnapshotFile", "/api/repo/openRepoSnapshotFile", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var DiffRepoSnapshots = define[DiffRepoSnapshotsRequest, RepoDiffData]("diffRepoSnapshots", "/api/repo/diffRepoSnapshots", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var CheckoutRepo = define[CheckoutRepoRequest, Null]("checkoutRepo", "/api/repo/checkoutRepo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var DownloadCloudSnapshot = define[DownloadCloudSnapshotRequest, Null]("downloadCloudSnapshot", "/api/repo/downloadCloudSnapshot", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var UploadCloudSnapshot = define[UploadCloudSnapshotRequest, Null]("uploadCloudSnapshot", "/api/repo/uploadCloudSnapshot", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 可选的 `id` 按 7 至 40 位十六进制 ID 前缀查询本地快照，忽略首尾空白和大小写。
// 前缀匹配多个快照时全部返回，按创建时间降序；page 仍为必填，但按 ID 查询时不参与分页。
// 省略或留空 ID 时按页查询；未找到返回空列表，格式错误、损坏或读取失败返回错误。
// includeFiles 默认为 false；传入 true 时必须提供完整 ID，并返回该快照的文件元数据，不读取正文。
// 结果的 tags 包含按名称排序的全部标记，未标记时为空数组；分页与 ID 查询均返回此字段。
// 可选的 startTime、endTime 按创建时间筛选后分页，也应用于 ID 查询。
// 时间为非负整数 Unix 毫秒时间戳，包含起点、不包含终点；省略或为 0 表示该端无界。
// 两端均非 0 时终点必须大于起点；ID 查询应用时间范围后仍忽略分页。
// 要求管理员权限，返回已有的快照元数据及资源下载状态，不下载或回滚快照。
var GetRepoSnapshots = define[GetRepoSnapshotsRequest, RepoSnapshotsData]("getRepoSnapshots", "/api/repo/getRepoSnapshots", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var SearchRepoFile = define[SearchRepoFileRequest, RepoSearchData]("searchRepoFile", "/api/repo/searchRepoFile", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 每个文件版本包含 snapshots，按文件 ID 关联全部本地标记快照。
// snapshots 按快照创建时间倒序，同一快照的多个标记合并；无关联时为空数组，不读取文件正文。
var GetRepoDocHistory = define[GetRepoDocHistoryRequest, RepoDocHistoryData]("getRepoDocHistory", "/api/repo/getRepoDocHistory", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportRepoFile = define[ExportRepoFileRequest, RepoExportData]("exportRepoFile", "/api/repo/exportRepoFile", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 可选的 startTime、endTime 按创建时间筛选后分页，筛选遍历索引页。
// 时间为非负整数 Unix 毫秒时间戳，包含起点、不包含终点；省略或为 0 表示该端无界。
// 两端均非 0 时终点必须大于起点；读取失败返回错误，不返回部分结果。
var GetCloudRepoSnapshots = define[GetCloudRepoSnapshotsRequest, RepoCloudSnapshotsData]("getCloudRepoSnapshots", "/api/repo/getCloudRepoSnapshots", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetCloudRepoTagSnapshots = define[EmptyRequest, RepoCloudTagsData]("getCloudRepoTagSnapshots", "/api/repo/getCloudRepoTagSnapshots", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var RemoveCloudRepoTagSnapshot = define[RemoveCloudRepoTagSnapshotRequest, Null]("removeCloudRepoTagSnapshot", "/api/repo/removeCloudRepoTagSnapshot", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 按标记逐行返回快照，tag 是当前行供上传、移除使用的标记，tags 是全部别名。
var GetRepoTagSnapshots = define[EmptyRequest, RepoTagsData]("getRepoTagSnapshots", "/api/repo/getRepoTagSnapshots", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var RemoveRepoTagSnapshot = define[RemoveRepoTagSnapshotRequest, Null]("removeRepoTagSnapshot", "/api/repo/removeRepoTagSnapshot", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var TagSnapshot = define[TagSnapshotRequest, Null]("tagSnapshot", "/api/repo/tagSnapshot", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ImportRepoKey = define[ImportRepoKeyRequest, RepoKeyData]("importRepoKey", "/api/repo/importRepoKey", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var InitRepoKeyFromPassphrase = define[InitRepoKeyFromPassphraseRequest, RepoKeyData]("initRepoKeyFromPassphrase", "/api/repo/initRepoKeyFromPassphrase", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var InitRepoKey = define[EmptyRequest, RepoKeyData]("initRepoKey", "/api/repo/initRepoKey", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var ResetRepo = define[EmptyRequest, Null]("resetRepo", "/api/repo/resetRepo", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var PurgeRepo = define[EmptyRequest, Null]("purgeRepo", "/api/repo/purgeRepo", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var PurgeCloudRepo = define[EmptyRequest, Null]("purgeCloudRepo", "/api/repo/purgeCloudRepo", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

var MoveLocalShorthands = define[FileTreeNotebookRequest, []string]("moveLocalShorthands", "/api/filetree/moveLocalShorthands", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ListDocTree = define[FileTreePathRequest, FileTreeDocTreeData]("listDocTree", "/api/filetree/listDocTree", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var UpsertIndexes = define[FileTreePathsRequest, Null]("upsertIndexes", "/api/filetree/upsertIndexes", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveIndexes = define[FileTreePathsRequest, Null]("removeIndexes", "/api/filetree/removeIndexes", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var Doc2Heading = define[FileTreeDocHeadingRequest, FileTreeDocHeadingData]("doc2Heading", "/api/filetree/doc2Heading", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var Heading2Doc = define[FileTreeHeadingDocRequest, Null]("heading2Doc", "/api/filetree/heading2Doc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var Li2Doc = define[FileTreeListItemDocRequest, Null]("li2Doc", "/api/filetree/li2Doc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetHPathByPath = define[FileTreePathRequest, string]("getHPathByPath", "/api/filetree/getHPathByPath", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetHPathsByPaths = define[FileTreePathsRequest, []string]("getHPathsByPaths", "/api/filetree/getHPathsByPaths", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetHPathByID = define[FileTreeIDRequest, string]("getHPathByID", "/api/filetree/getHPathByID", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetPathByID = define[FileTreeTrimIDRequest, FileTreeDocPathData]("getPathByID", "/api/filetree/getPathByID", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetFullHPathByID = define[FileTreeOptionalIDRequest, *string]("getFullHPathByID", "/api/filetree/getFullHPathByID", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetIDsByHPath = define[FileTreeOptionalPathRequest, []string]("getIDsByHPath", "/api/filetree/getIDsByHPath", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var MoveDocs = define[FileTreeMoveRequest, Null]("moveDocs", "/api/filetree/moveDocs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var MoveDocsByID = define[FileTreeMoveIDsRequest, Null]("moveDocsByID", "/api/filetree/moveDocsByID", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveDoc = define[FileTreePathRequest, Null]("removeDoc", "/api/filetree/removeDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveDocByID = define[FileTreeTrimIDRequest, Null]("removeDocByID", "/api/filetree/removeDocByID", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveDocs = define[FileTreePathsRequest, Null]("removeDocs", "/api/filetree/removeDocs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RenameDoc = define[FileTreeRenameRequest, Null]("renameDoc", "/api/filetree/renameDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RenameDocByID = define[FileTreeRenameIDRequest, Null]("renameDocByID", "/api/filetree/renameDocByID", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var DuplicateDoc = define[FileTreeIDRequest, FileTreeDuplicateData]("duplicateDoc", "/api/filetree/duplicateDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var DuplicateDocTree = define[FileTreeIDRequest, FileTreeDuplicateData]("duplicateDocTree", "/api/filetree/duplicateDocTree", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var CreateDoc = define[FileTreeCreateRequest, FileTreeCreateData]("createDoc", "/api/filetree/createDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var CreateDailyNote = define[FileTreeDailyNoteRequest, FileTreeCreateData]("createDailyNote", "/api/filetree/createDailyNote", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var GetDailyNoteInfo = define[DailyNoteInfoRequest, *DailyNoteInfo]("getDailyNoteInfo", "/api/filetree/getDailyNoteInfo", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 使用编辑器 Markdown 语法选项，并按 `/api/import/importStdMd` 的规则转换标准脚注。
// 转义的脚注语法保留为字面文本；返回创建的文档 ID，访问受笔记本权限限制。
var CreateDocWithMd = define[FileTreeCreateMarkdownRequest, string]("createDocWithMd", "/api/filetree/createDocWithMd", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetDocCreateSavePath = define[FileTreeNotebookRequest, FileTreeCreateSavePathData]("getDocCreateSavePath", "/api/filetree/getDocCreateSavePath", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetRefCreateSavePath = define[FileTreeNotebookRequest, FileTreeSavePathData]("getRefCreateSavePath", "/api/filetree/getRefCreateSavePath", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetShorthandSavePath = define[FileTreeNotebookRequest, FileTreeSavePathData]("getShorthandSavePath", "/api/filetree/getShorthandSavePath", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var ChangeSort = define[FileTreeChangeSortRequest, Null]("changeSort", "/api/filetree/changeSort", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ReorderDocs = define[FileTreeReorderRequest, *FileTreeReorderData]("reorderDocs", "/api/filetree/reorderDocs", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{DataOnError: true}, "POST")
var SetSort = define[FileTreeSetSortRequest, *FileTreeSetSortData]("setSort", "/api/filetree/setSort", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{DataOnError: true}, "POST")
var SetDocSortMode = define[FileTreeSortModeRequest, *FileTreeSortModeData]("setDocSortMode", "/api/filetree/setDocSortMode", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{DataOnError: true}, "POST")
var SearchDocs = define[FileTreeSearchRequest, []*FileTreeSearchDoc]("searchDocs", "/api/filetree/searchDocs", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var ListDocsByPath = define[FileTreeListRequest, FileTreeListData]("listDocsByPath", "/api/filetree/listDocsByPath", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetDoc = define[FileTreeGetDocRequest, FileTreeGetDocData]("getDoc", "/api/filetree/getDoc", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 3}}, "POST")
var SetPublishAccess = define[FileTreeSetPublishRequest, Null]("setPublishAccess", "/api/filetree/setPublishAccess", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetPublishAccess = define[FileTreePublishIDsRequest, FileTreePublishData]("getPublishAccess", "/api/filetree/getPublishAccess", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AuthFilePublishAccess = define[FileTreeAuthPublishRequest, Null]("authFilePublishAccess", "/api/filetree/authFilePublishAccess", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalErrorStatuses: []int{429}}, "POST")

var ExportCodeBlock = define[ExportIDRequest, ExportPathData]("exportCodeBlock", "/api/export/exportCodeBlock", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportAttributeView = define[ExportAttributeViewRequest, ExportZipData]("exportAttributeView", "/api/export/exportAttributeView", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var Export2Liandi = define[ExportIDRequest, Null]("export2Liandi", "/api/export/export2Liandi", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ExportDataInFolder = define[ExportFolderRequest, ExportNameData]("exportDataInFolder", "/api/export/exportDataInFolder", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportData = define[EmptyRequest, ExportZipData]("exportData", "/api/export/exportData", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportResources = define[ExportResourcesRequest, ExportPathData]("exportResources", "/api/export/exportResources", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}, Text: true}, "POST")
var ExportNotebookMd = define[ExportNotebookMarkdownRequest, ExportNamedZipData]("exportNotebookMd", "/api/export/exportNotebookMd", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportNotebooksMd = define[ExportNotebooksMarkdownRequest, ExportNamedZipData]("exportNotebooksMd", "/api/export/exportNotebooksMd", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportMds = define[ExportDocumentsMarkdownRequest, ExportNamedZipData]("exportMds", "/api/export/exportMds", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportMd = define[ExportMarkdownRequest, ExportNamedZipData]("exportMd", "/api/export/exportMd", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportNotebookSY = define[ExportIDRequest, ExportZipData]("exportNotebookSY", "/api/export/exportNotebookSY", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportNotebooksSY = define[ExportNotebooksRequest, ExportZipData]("exportNotebooksSY", "/api/export/exportNotebooksSY", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportSYs = define[ExportIDsRequest, ExportZipData]("exportSYs", "/api/export/exportSYs", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportSY = define[ExportIDRequest, ExportZipData]("exportSY", "/api/export/exportSY", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportMdContent = define[ExportMarkdownContentRequest, ExportMarkdownContentData]("exportMdContent", "/api/export/exportMdContent", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportDocx = define[ExportDocxRequest, ExportPathData]("exportDocx", "/api/export/exportDocx", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportMdHTML = define[ExportMarkdownHTMLRequest, ExportHTMLData]("exportMdHTML", "/api/export/exportMdHTML", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportTempContent = define[ExportTempContentRequest, ExportURLData]("exportTempContent", "/api/export/exportTempContent", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportBrowserHTML = define[ExportBrowserHTMLRequest, ExportZipData]("exportBrowserHTML", "/api/export/exportBrowserHTML", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 导出图片或 PDF 预览时，可选的 keepJSEmbed: true 保留脚本嵌入占位，默认不保留。
// 内核不执行脚本；调用方须遵守安全模式限制，并等待异步渲染完成后再导出。
var ExportPreviewHTML = define[ExportPreviewHTMLRequest, ExportPreviewHTMLData]("exportPreviewHTML", "/api/export/exportPreviewHTML", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportHTML = define[ExportHTMLRequest, ExportHTMLData]("exportHTML", "/api/export/exportHTML", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ProcessPDF = define[ProcessPDFRequest, Null]("processPDF", "/api/export/processPDF", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportPreview = define[ExportIDRequest, ExportPreviewData]("exportPreview", "/api/export/preview", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var ExportAsFile = define[ExportAsFileRequest, ExportFileData]("exportAsFile", "/api/export/exportAsFile", AuthenticatedAccess|AdminAccess, MultipartBody, ResponseOptions{}, "POST")
var CopyExportFile = define[CopyExportFileRequest, Null]("copyExportFile", "/api/export/copyExportFile", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-2}}, "POST")
var ExportEPUB = define[ExportIDRequest, ExportNamedZipData]("exportEPUB", "/api/export/exportEPUB", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportRTF = define[ExportIDRequest, ExportNamedZipData]("exportRTF", "/api/export/exportRTF", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportODT = define[ExportIDRequest, ExportNamedZipData]("exportODT", "/api/export/exportODT", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportMediaWiki = define[ExportIDRequest, ExportNamedZipData]("exportMediaWiki", "/api/export/exportMediaWiki", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportOrgMode = define[ExportIDRequest, ExportNamedZipData]("exportOrgMode", "/api/export/exportOrgMode", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportOPML = define[ExportIDRequest, ExportNamedZipData]("exportOPML", "/api/export/exportOPML", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportTextile = define[ExportIDRequest, ExportNamedZipData]("exportTextile", "/api/export/exportTextile", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportAsciiDoc = define[ExportIDRequest, ExportNamedZipData]("exportAsciiDoc", "/api/export/exportAsciiDoc", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportReStructuredText = define[ExportIDRequest, ExportNamedZipData]("exportReStructuredText", "/api/export/exportReStructuredText", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var StatAsset = define[AssetPathRequest, AssetStatData]("statAsset", "/api/asset/statAsset", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var FullReindexAssetContent = define[EmptyRequest, Null]("fullReindexAssetContent", "/api/asset/fullReindexAssetContent", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var GetImageOCRText = define[AssetOCRTextRequest, AssetTextData]("getImageOCRText", "/api/asset/getImageOCRText", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetImageOCRText = define[SetAssetOCRTextRequest, Null]("setImageOCRText", "/api/asset/setImageOCRText", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// AssetOCR 始终使用当前设备选择的提供商，内核可在无界面的环境中识别。
// ai 使用设备保存的 aiModelId，返回原样文本和空 ocrJSON，不虚构坐标；本地提供商保持 TSV 数据。
// 不自动回退到另一提供商；取消、模型或推理错误不覆盖已有文本，加密笔记本不参与 OCR。
var AssetOCR = define[AssetPathRequest, AssetOCRData]("ocr", "/api/asset/ocr", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// AIOCR 手动调用设备选择的 OCR AI 模型识别本地 assets/ 图片，不使用会话、工具。
// 未保存独立模型且本地提供商仍被选中时兼容智能体模型；显式模型失效时返回错误，不回退。
// path 保留 box 查询参数以隔离笔记本资源；拒绝加密资源和外部图片地址。
// 支持 PNG、JPEG、GIF、WebP，并将 BMP、TIFF 转为 PNG、HEIC/HEIF 转为 JPEG；其他格式返回错误。
// 保留原图分辨率，原始文件和发送图片均限制为 20 MiB、发送图片限制为四千万像素；HEIF 遵循预览解码限制。
// 支持现有 AI 生成协议，受 AI 功能开关、管理员权限和只读模式限制。
// 请求上限为两分钟，提供商配置的更短超时仍生效；模型不支持图片时返回错误，不降级为纯文本请求。
// 成功将完整文本（含换行和空白，图片无文字时可为空）保存到现有 OCR 存储并更新索引。
// 失败、取消、拒绝或截断时保留已有文本；不返回虚构的坐标和置信度。
var AIOCR = define[AssetPathRequest, AssetTextData]("aiOCR", "/api/ai/ocr", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var GetOCRConfig = define[EmptyRequest, OCRConfigData]("getOCRConfig", "/api/asset/getOCRConfig", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var SetOCRConfig = define[SettingOCR, SettingOCR]("setOCRConfig", "/api/asset/setOCRConfig", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ImportOCRModels = define[ImportOCRModelsRequest, OCRModel]("importOCRModels", "/api/asset/importOCRModels", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// 重命名普通笔记本资源，并同步字面量及百分号编码的文档、数据库引用。
// 引用及成功返回的 data.newPath 保留查询参数和片段；源资源解析失败返回 code=-1 和 5000 毫秒错误提示。
// 拒绝加密笔记本资源重命名；空名称或与原文件名相同的名称返回 code=0、data.newPath=""。
var RenameAsset = define[RenameAssetRequest, AssetRenameData]("renameAsset", "/api/asset/renameAsset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var FindAssetReferences = define[FindAssetReferencesRequest, AssetReferencesData]("findAssetReferences", "/api/asset/findAssetReferences", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var RelinkAsset = define[RelinkAssetRequest, AssetReferencesData]("relinkAsset", "/api/asset/relinkAsset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var GetDocImageAssets = define[AssetDocumentRequest, []string]("getDocImageAssets", "/api/asset/getDocImageAssets", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetDocAssets = define[AssetDocumentAssetsRequest, []string]("getDocAssets", "/api/asset/getDocAssets", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var SetFileAnnotation = define[SetAssetAnnotationRequest, Null]("setFileAnnotation", "/api/asset/setFileAnnotation", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetFileAnnotation = define[AssetPathRequest, AssetAnnotationData]("getFileAnnotation", "/api/asset/getFileAnnotation", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 403}}, "POST")

// path 为 data 相对资源路径，普通资源须通过完整未引用扫描。
// 全局 assets/android-notification-texts.txt 普通文件允许显式删除以关闭 Android 保活通知，无需未引用扫描。
// 目录和符号链接不能使用该例外；删除前保存资源历史并触发同步。
// 该文件不出现在 getUnusedAssets 中，也不被 removeUnusedAssets 批量清理。
var RemoveUnusedAsset = define[AssetPathRequest, AssetPathData]("removeUnusedAsset", "/api/asset/removeUnusedAsset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 未引用资源扫描失败时返回标准错误，禁止使用不完整的引用集合清理资源。
var RemoveUnusedAssets = define[EmptyRequest, AssetPathsData]("removeUnusedAssets", "/api/asset/removeUnusedAssets", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

// 扫描失败返回标准错误，不将失败表示为成功的空列表。
// 可选请求头 X-SiYuan-App-ID 将截断提示限定到对应前端，未提供时保留广播行为。
var GetUnusedAssets = define[EmptyRequest, []*AssetUnusedItem]("getUnusedAssets", "/api/asset/getUnusedAssets", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var GetMissingAssets = define[EmptyRequest, []*AssetUnusedItem]("getMissingAssets", "/api/asset/getMissingAssets", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// ResolveAssetPath 返回普通资源路径；已解锁的加密资源返回保留原始名称的受管临时明文副本路径。
var ResolveAssetPath = define[AssetPathRequest, string]("resolveAssetPath", "/api/asset/resolveAssetPath", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 上传提示生命周期使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，状态栏仍全局更新。
var AssetUploadCloud = define[AssetCloudUploadRequest, Null]("uploadCloud", "/api/asset/uploadCloud", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 上传提示生命周期使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，保留 ignorePushMsg 语义。
var AssetUploadCloudByAssetsPaths = define[AssetPathsCloudUploadRequest, Null]("uploadCloudByAssetsPaths", "/api/asset/uploadCloudByAssetsPaths", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var InsertLocalAssets = define[InsertLocalAssetsRequest, AssetUploadData]("insertLocalAssets", "/api/asset/insertLocalAssets", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var InsertCover = define[InsertCoverRequest, AssetInsertCoverData]("insertCover", "/api/asset/insertCover", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var UploadAsset = define[UploadAssetRequest, AssetUploadData]("uploadAsset", "/api/asset/upload", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

var SetConfSnippet = define[SetConfSnippetRequest, *SettingSnpt]("setConfSnippet", "/api/setting/setSnippet", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetBazaar = define[SetBazaarRequest, *SettingBazaar]("setBazaar", "/api/setting/setBazaar", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetAI = define[SetAIRequest, *SettingAI]("setAI", "/api/setting/setAI", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSecrets = define[SetSecretsRequest, *SettingSecrets]("setSecrets", "/api/setting/setSecrets", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetVariables = define[SetVariablesRequest, *SettingVariables]("setVariables", "/api/setting/setVariables", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetFlashcard = define[SetFlashcardRequest, *SettingFlashcard]("setFlashcard", "/api/setting/setFlashcard", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetEditor = define[SetEditorRequest, *SettingEditor]("setEditor", "/api/setting/setEditor", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// PatchSetting 保留省略字段，成功后客户端重新读取配置；通知不包含密码或密钥。
var PatchSetting = define[PatchSettingRequest, Null]("patchSetting", "/api/setting/patch", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetExport = define[SetExportRequest, *SettingExport]("setExport", "/api/setting/setExport", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetFiletree = define[SetFiletreeRequest, *SettingFileTree]("setFiletree", "/api/setting/setFiletree", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetSearch = define[SetSearchRequest, *SettingSearch]("setSearch", "/api/setting/setSearch", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetAppearance = define[SetAppearanceRequest, *SettingAppearance]("setAppearance", "/api/setting/setAppearance", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetEntryVisibility = define[SetEntryVisibilityRequest, *SettingEntryVisibility]("setEntryVisibility", "/api/setting/setEntryVisibility", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetPublish = define[SetPublishRequest, SettingPublishData]("setPublish", "/api/setting/setPublish", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetBootAppearances = define[EmptyRequest, SettingBootAppearancesData]("getBootAppearances", "/api/setting/getBootAppearances", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SetBootAppearance = define[SettingBootAppearanceRequest, *SettingBootAppearanceSelection]("setBootAppearance", "/api/setting/setBootAppearance", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetBazaarPetalDisabled = define[SettingPetalDisabledRequest, SettingPetalDisabledData]("setBazaarPetalDisabled", "/api/setting/setBazaarPetalDisabled", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetKeymap = define[SettingKeymapRequest, Null]("setKeymap", "/api/setting/setKeymap", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 接收可选的 exit（默认 false），要求管理员权限并禁止只读写入。
// 仅重置当前工作空间的普通偏好、内置快捷键和当前布局；保留笔记、历史、历史保留天数、学习进度、
// 账号、认证、同步、加密及恢复材料、AI/MCP、插件和代码片段及其启用状态、已保存布局、语言及应用级设置。
// 已连接的主客户端收到 prepareSettingsReset 后，须保存待提交内容并暂停布局保存，再用通知中的一次性
// token 调用 `/api/setting/confirmSettingsReset`，传入 saved: true；保存失败传 false，15 秒未确认则取消。
// 成功后 settingsReset 通知所有主客户端直接重载；exit: true 仅让管理本地内核的桌面主窗口重载后正常退出，
// 不直接停止远程内核；失败时 cancelSettingsReset 携带此次操作 ID，客户端应恢复正常保存。
// 插件调用前应先取得用户确认，并确保未保存内容已经提交；重复调用恢复同一组默认值。
var ResetSettings = define[ResetSettingsRequest, Null]("resetSettings", "/api/setting/resetSettings", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 确认 `/api/setting/resetSettings` 发起的重置，要求管理员权限并禁止只读写入。
// 接收 prepareSettingsReset 通知中的一次性 token；已保存待提交内容时传入 saved: true，保存失败传 false。
// 主客户端在确认前暂停布局保存；15 秒未确认则取消，收到 cancelSettingsReset 后恢复正常保存。
var ConfirmSettingsReset = define[ConfirmSettingsResetRequest, Null]("confirmSettingsReset", "/api/setting/confirmSettingsReset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetTheme = define[SettingThemeRequest, Null]("setTheme", "/api/setting/setTheme", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetIcon = define[SettingIconRequest, Null]("setIcon", "/api/setting/setIcon", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetPublish = define[EmptyRequest, SettingPublishData]("getPublish", "/api/setting/getPublish", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

// `cached: true` 仅返回内存中的账户，未登录时返回 null。
// 此模式忽略 token，不联网、不等待同步或切换资源来源；缓存结果不代表云端凭据仍然有效。
// 省略 cached 或传入 false 时执行账户恢复和令牌刷新；非管理员在两种模式下均得到 null。
// 客户端可先读取缓存完成初始化，再刷新账户，并通过 setCloudUser 主通道事件接收账户变化。
var GetCloudUser = define[SettingCloudUserRequest, *SettingUser]("getCloudUser", "/api/setting/getCloudUser", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 255}, DataOnError: true}, "POST")
var LogoutCloudUser = define[EmptyRequest, Null]("logoutCloudUser", "/api/setting/logoutCloudUser", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var Login2faCloudUser = define[SettingLogin2faRequest, Login2faEnvelope]("login2faCloudUser", "/api/setting/login2faCloudUser", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Output: DirectJSONOutput}, "POST")
var SetEmoji = define[SettingEmojiRequest, Null]("setEmoji", "/api/setting/setEmoji", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 先完整扫描普通笔记本的引用关系；扫描失败返回 code=-1，不创建清理历史或删除数据库。
// 加密笔记本及笔记本级数据库不参与全局未引用清理。
var RemoveUnusedAttributeView = define[RemoveUnusedAttributeViewRequest, AVIDData]("removeUnusedAttributeView", "/api/av/removeUnusedAttributeView", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 完整扫描成功后才备份并删除未引用的全局数据库；扫描失败返回 code=-1，保留源文件。
// 加密笔记本及笔记本级数据库不参与全局未引用清理。
var RemoveUnusedAttributeViews = define[EmptyRequest, AVPathsData]("removeUnusedAttributeViews", "/api/av/removeUnusedAttributeViews", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

// 完整扫描普通笔记本的数据库引用；读取或目录遍历失败返回 code=-1，不返回不完整的候选列表。
// 加密笔记本及笔记本级数据库不参与全局未引用清理。
// 截断提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，离线目标不回退广播。
var GetUnusedAttributeViews = define[EmptyRequest, []*AssetUnusedItem]("getUnusedAttributeViews", "/api/av/getUnusedAttributeViews", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var GetAttributeViewItemIDsByBoundIDs = define[GetAttributeViewItemIDsByBoundIDsRequest, map[string]string]("getAttributeViewItemIDsByBoundIDs", "/api/av/getAttributeViewItemIDsByBoundIDs", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewBoundBlockIDsByItemIDs = define[GetAttributeViewBoundBlockIDsByItemIDsRequest, map[string]string]("getAttributeViewBoundBlockIDsByItemIDs", "/api/av/getAttributeViewBoundBlockIDsByItemIDs", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewItemStatuses = define[GetAttributeViewItemStatusesRequest, map[string]string]("getAttributeViewItemStatuses", "/api/av/getAttributeViewItemStatuses", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewAddingBlockDefaultValues = define[GetAttributeViewAddingBlockDefaultValuesRequest, AVValuesData]("getAttributeViewAddingBlockDefaultValues", "/api/av/getAttributeViewAddingBlockDefaultValues", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var BatchReplaceAttributeViewBlocks = define[BatchReplaceAttributeViewBlocksRequest, Null]("batchReplaceAttributeViewBlocks", "/api/av/batchReplaceAttributeViewBlocks", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetAttrViewGroup = define[SetAttrViewGroupRequest, AVRenderResult]("setAttrViewGroup", "/api/av/setAttrViewGroup", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var SetAttrViewFilters = define[SetAttrViewFiltersRequest, Null]("setAttrViewFilters", "/api/av/setAttrViewFilters", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetAttrViewContextFilter = define[SetAttrViewContextFilterRequest, AVContextFilterData]("setAttrViewContextFilter", "/api/av/setAttrViewContextFilter", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetAttrViewSorts = define[SetAttrViewSortsRequest, Null]("setAttrViewSorts", "/api/av/setAttrViewSorts", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ChangeAttrViewLayout = define[ChangeAttrViewLayoutRequest, AVRenderResult]("changeAttrViewLayout", "/api/av/changeAttrViewLayout", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var DuplicateAttributeViewBlock = define[DuplicateAttributeViewBlockRequest, AVDuplicateData]("duplicateAttributeViewBlock", "/api/av/duplicateAttributeViewBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewKeysByAvID = define[GetAttributeViewKeysByAvIDRequest, []*AVKey]("getAttributeViewKeysByAvID", "/api/av/getAttributeViewKeysByAvID", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewKeysByID = define[GetAttributeViewKeysByIDRequest, []*AVKey]("getAttributeViewKeysByID", "/api/av/getAttributeViewKeysByID", AuthenticatedAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetMirrorDatabaseBlocks = define[GetMirrorDatabaseBlocksRequest, RefDefsData]("getMirrorDatabaseBlocks", "/api/av/getMirrorDatabaseBlocks", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetDatabaseBlockView = define[SetDatabaseBlockViewRequest, Null]("setDatabaseBlockView", "/api/av/setDatabaseBlockView", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewPrimaryKeyValues = define[GetAttributeViewPrimaryKeyValuesRequest, AVPrimaryValuesData]("getAttributeViewPrimaryKeyValues", "/api/av/getAttributeViewPrimaryKeyValues", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 可选的 `sort: {column, order}` 按关联数据库字段排序，order 为 ASC 或 DESC。
// 全部候选排序后分页，仅影响本次查询，不修改视图和 selectedRows 顺序。
// 省略 sort 时按创建时间倒序；不存在的字段或无效方向返回错误。
var GetAttributeViewRelationCandidates = define[GetAttributeViewRelationCandidatesRequest, AVRelationCandidatesData]("getAttributeViewRelationCandidates", "/api/av/getAttributeViewRelationCandidates", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AppendAttributeViewDetachedBlocksWithValues = define[AppendAttributeViewDetachedBlocksWithValuesRequest, Null]("appendAttributeViewDetachedBlocksWithValues", "/api/av/appendAttributeViewDetachedBlocksWithValues", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AddAttributeViewBlocks = define[AddAttributeViewBlocksRequest, Null]("addAttributeViewBlocks", "/api/av/addAttributeViewBlocks", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveAttributeViewBlocks = define[RemoveAttributeViewBlocksRequest, Null]("removeAttributeViewBlocks", "/api/av/removeAttributeViewBlocks", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AddAttributeViewKey = define[AddAttributeViewKeyRequest, Null]("addAttributeViewKey", "/api/av/addAttributeViewKey", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveAttributeViewKey = define[RemoveAttributeViewKeyRequest, Null]("removeAttributeViewKey", "/api/av/removeAttributeViewKey", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SortAttributeViewViewKey = define[SortAttributeViewViewKeyRequest, Null]("sortAttributeViewViewKey", "/api/av/sortAttributeViewViewKey", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SortAttributeViewKey = define[SortAttributeViewKeyRequest, Null]("sortAttributeViewKey", "/api/av/sortAttributeViewKey", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewFilterSort = define[GetAttributeViewFilterSortRequest, AVFilterSortData]("getAttributeViewFilterSort", "/api/av/getAttributeViewFilterSort", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SearchAttributeViewRollupDestKeys = define[SearchAttributeViewRollupDestKeysRequest, AVKeysData]("searchAttributeViewRollupDestKeys", "/api/av/searchAttributeViewRollupDestKeys", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SearchAttributeViewRelationKey = define[SearchAttributeViewRelationKeyRequest, AVKeysData]("searchAttributeViewRelationKey", "/api/av/searchAttributeViewRelationKey", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 返回数据库级 automations，所有视图共享；缺省表示没有自动化规则。
// 规则通过 `/api/transactions` 的 setAttrViewAutomations 操作整体保存。
var GetAttributeView = define[GetAttributeViewRequest, AVData]("getAttributeView", "/api/av/getAttributeView", AuthenticatedAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewPasteRows = define[GetAttributeViewPasteRowsRequest, AVPasteRowsData]("getAttributeViewPasteRows", "/api/av/getAttributeViewPasteRows", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewFieldViews = define[GetAttributeViewFieldViewsRequest, AVFieldViewsData]("getAttributeViewFieldViews", "/api/av/getAttributeViewFieldViews", AuthenticatedAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var CreateAttributeViewItem = define[CreateAttributeViewItemRequest, AVCreateItemResult]("createAttributeViewItem", "/api/av/createAttributeViewItem", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var CreateAttributeViewRelationItem = define[CreateAttributeViewRelationItemRequest, AVCreateItemResult]("createAttributeViewRelationItem", "/api/av/createAttributeViewRelationItem", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var CreateAttributeViewItemWithMarkdown = define[CreateAttributeViewItemWithMarkdownRequest, AVCreateItemResult]("createAttributeViewItemWithMarkdown", "/api/av/createAttributeViewItemWithMarkdown", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var CreateAttributeViewItemDocs = define[CreateAttributeViewItemDocsRequest, AVCreateItemDocsResult]("createAttributeViewItemDocs", "/api/av/createAttributeViewItemDocs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var SearchAttributeView = define[SearchAttributeViewRequest, AVSearchData]("searchAttributeView", "/api/av/searchAttributeView", AuthenticatedAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RenderSnapshotAttributeView = define[RenderSnapshotAttributeViewRequest, AVArchiveRenderData]("renderSnapshotAttributeView", "/api/av/renderSnapshotAttributeView", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var RenderHistoryAttributeView = define[RenderHistoryAttributeViewRequest, AVArchiveRenderData]("renderHistoryAttributeView", "/api/av/renderHistoryAttributeView", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var RenderAttributeView = define[RenderAttributeViewRequest, AVRenderResult]("renderAttributeView", "/api/av/renderAttributeView", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true, FastJSON: true}, "POST")
var GetAttributeViewCalendarUndated = define[AVCalendarUndatedRequest, AVCalendarUndatedData]("getAttributeViewCalendarUndated", "/api/av/getAttributeViewCalendarUndated", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetCurrentAttrViewImages = define[GetCurrentAttrViewImagesRequest, []string]("getCurrentAttrViewImages", "/api/av/getCurrentAttrViewImages", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewKeys = define[GetAttributeViewKeysRequest, []*AVBlockAttributeViewKeys]("getAttributeViewKeys", "/api/av/getAttributeViewKeys", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewSearchTarget = define[GetAttributeViewSearchTargetRequest, *AVAttributeViewSearchTarget]("getAttributeViewSearchTarget", "/api/av/getAttributeViewSearchTarget", AuthenticatedAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewBacklinks = define[GetAttributeViewBacklinksRequest, *AVAttributeViewBacklinks]("getAttributeViewBacklinks", "/api/av/getAttributeViewBacklinks", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var SetAttributeViewBlockAttr = define[SetAttributeViewBlockAttrRequest, AVValueData]("setAttributeViewBlockAttr", "/api/av/setAttributeViewBlockAttr", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var BatchSetAttributeViewBlockAttrs = define[BatchSetAttributeViewBlockAttrsRequest, Null]("batchSetAttributeViewBlockAttrs", "/api/av/batchSetAttributeViewBlockAttrs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewRowSort = define[GetAttributeViewRowSortRequest, AVRowSortPreview]("getAttributeViewRowSort", "/api/av/getAttributeViewRowSort", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")

var AIChatGPT = define[AIMessageRequest, string]("chatGPT", "/api/ai/chatGPT", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var AIChatGPTWithAction = define[AIActionRequest, string]("chatGPTWithAction", "/api/ai/chatGPTWithAction", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var AIListEditorActions = define[EmptyRequest, []*AIEditorAction]("lsAIEditorActions", "/api/ai/editor/lsActions", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AISaveEditorAction = define[AIEditorActionSaveRequest, *AIEditorAction]("saveAIEditorAction", "/api/ai/editor/saveAction", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AIRemoveEditorAction = define[AIEditorActionIDRequest, Null]("removeAIEditorAction", "/api/ai/editor/removeAction", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AITestModel = define[AIModelRequest, AIModelTestData]("testModel", "/api/ai/testModel", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var AITestEmbeddingModel = define[EmptyRequest, AIEmbeddingTestData]("testEmbeddingModel", "/api/ai/testEmbeddingModel", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AITestRerankModel = define[EmptyRequest, AIRerankTestData]("testRerankModel", "/api/ai/testRerankModel", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AITestDecisionModel = define[AIDecisionTestRequest, AIDecisionTestData]("testDecisionModel", "/api/ai/testDecisionModel", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var AIListModels = define[AIProviderRequest, AIModelsData]("listModels", "/api/ai/listModels", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 套餐授权接口仅供已鉴权管理员使用，遵守 AI 禁用开关及只读限制。
// 账户列表只返回身份及连接状态；令牌保存在主机私有目录，配置仅保存账户 ID。
var ChatGPTAccounts = define[EmptyRequest, []ChatGPTAccount]("chatGPTAccounts", "/api/ai/chatgpt/accounts", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{NonNullable: true}, "POST")

// 登录地址可能包含身份提示，客户端不得记录；回调使用独立的 IPv4 回环监听器。
var ChatGPTStart = define[ChatGPTAccountRequest, ChatGPTLogin]("chatGPTStart", "/api/ai/chatgpt/start", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ChatGPTStatus = define[ChatGPTLoginRequest, ChatGPTLoginStatus]("chatGPTStatus", "/api/ai/chatgpt/status", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ChatGPTCancel = define[ChatGPTLoginRequest, Null]("chatGPTCancel", "/api/ai/chatgpt/cancel", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 退出清除本地令牌并保留账户映射；revoked 表示远程撤销是否确认成功。
var ChatGPTLogout = define[ChatGPTAccountRequest, ChatGPTLogoutResult]("chatGPTLogout", "/api/ai/chatgpt/logout", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 删除指定的本机账户注册并终止其请求及登录尝试，不合并同邮箱注册；不修改提供商配置或主机 ID。
// 先尝试撤销会话，远程撤销未确认时仍清除本地记录并返回 revoked=false；缺失账户报错。
var ChatGPTRemove = define[ChatGPTAccountRequest, ChatGPTLogoutResult]("chatGPTRemove", "/api/ai/chatgpt/remove", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 导出使用至少 12 个字符的密码，先写入带版本的认证加密文件，再停止源主机刷新。
var ChatGPTExport = define[ChatGPTTransferRequest, ExportFileData]("chatGPTExport", "/api/ai/chatgpt/export", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 导入限制为 1 MiB，认证文件和账户身份后续期；失败保留账户及目标主机标识。
var ChatGPTImport = define[ChatGPTTransferRequest, ChatGPTAccount]("chatGPTImport", "/api/ai/chatgpt/import", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AIGetEmbeddingStat = define[EmptyRequest, *AIEmbeddingStat]("embeddingStat", "/api/ai/embeddingStat", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AIGetMCPStatus = define[EmptyRequest, []AIMCPStatus]("mcpStatus", "/api/ai/mcpStatus", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AIGetMCPEnvironment = define[EmptyRequest, AIMCPEnvironmentData]("mcpEnvironmentVariables", "/api/ai/mcpEnvironmentVariables", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AIMCPOAuthAuthorize = define[AIMCPIDRequest, Null]("mcpOAuthAuthorize", "/api/ai/mcpOAuthAuthorize", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AIMCPOAuthDisconnect = define[AIMCPIDRequest, Null]("mcpOAuthDisconnect", "/api/ai/mcpOAuthDisconnect", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AIReindexEmbedding = define[EmptyRequest, Null]("reindexEmbedding", "/api/ai/reindexEmbedding", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var AIRetryFailedEmbedding = define[EmptyRequest, Null]("retryFailedEmbedding", "/api/ai/retryFailedEmbedding", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var AIAgentConfirm = define[AIConfirmRequest, Null]("agentChatConfirm", "/api/ai/agent/confirm", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409}}, "POST")
var AIAgentSetPermission = define[AIPermissionRequest, AIPermissionData]("setAgentSessionPermission", "/api/ai/agent/setPermission", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var AIAgentQuestion = define[AIQuestionRequest, Null]("agentChatQuestion", "/api/ai/agent/question", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409}}, "POST")
var AIAgentBrowserCapabilityResult = define[AIBrowserCapabilityResultRequest, Null]("agentChatBrowserCapabilityResult", "/api/ai/agent/browserCapabilityResult", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409}}, "POST")
var AIListCapabilities = define[EmptyRequest, []AICapabilityManifest]("lsCapabilities", "/api/ai/lsCapabilities", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AIAgentTitle = define[AITitleRequest, string]("agentChatTitle", "/api/ai/agent/title", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")
var AIListSessions = define[AISessionsRequest, AISessionList]("lsSessions", "/api/ai/agent/lsSessions", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")
var AIRemoveSession = define[AISessionIDRequest, Null]("removeSession", "/api/ai/agent/removeSession", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409, 500}}, "POST")
var AIListSkills = define[EmptyRequest, []AISkillInfo]("lsSkills", "/api/ai/agent/lsSkills", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// AIListBuiltinSkills 独立于斜杠菜单的普通技能发现，只返回只读元数据，包括已禁用条目。
var AIListBuiltinSkills = define[EmptyRequest, []AIBuiltinSkillInfo]("lsBuiltinSkills", "/api/ai/agent/lsBuiltinSkills", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// 返回工作空间 data/ai/AGENTS.md 的 content 和 revision，要求管理员权限。
// 缺失文件返回空 content 和 missing 修订，不创建文件；非 UTF-8 文本、超出 32 KiB 或读取失败返回 code=-1。
var AIGetAgentInstructions = define[EmptyRequest, AIAgentInstructionsData]("getAgentInstructions", "/api/ai/agent/getInstructions", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// 接收 content 和读取时的 revision，要求管理员权限且禁止只读写入。
// 内容允许为空；修订冲突返回 code=-1 并保留原文。保存采用原子替换，并按工作空间同步忽略规则通知同步。
// 指令在下一轮用户对话生效，同轮工具调用和压缩使用固定快照，且不能覆盖工具权限、审批或访问控制。
var AISetAgentInstructions = define[AIAgentInstructionsSaveRequest, AIAgentInstructionsData]("setAgentInstructions", "/api/ai/agent/setInstructions", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AIListUserSkills = define[EmptyRequest, []AIUserSkillInfo]("lsUserSkills", "/api/ai/agent/lsUserSkills", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AIGetSkill = define[AISkillNameRequest, AISkillData]("getSkill", "/api/ai/agent/getSkill", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")
var AISaveSkill = define[AISkillSaveRequest, Null]("saveSkill", "/api/ai/agent/saveSkill", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var AIRemoveSkill = define[AISkillNameRequest, Null]("removeSkill", "/api/ai/agent/removeSkill", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var AIRenameSkill = define[AISkillRenameRequest, Null]("renameSkill", "/api/ai/agent/renameSkill", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var AIManageSkills = define[AISkillFileRequest, AISkillFileData]("manageSkills", "/api/ai/agent/manageSkills", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var AIEditorChat = define[AIEditorChatRequest, Null]("aiEditorChat", "/api/ai/editor/chat", AuthenticatedAccess|AdminAccess, StructJSONBody, aiEditorSSEOptions(), "POST")
var AIAgentChat = define[AIAgentChatRequest, Null]("agentChat", "/api/ai/agent/chat", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, aiAgentSSEOptions(), "POST")
var AIMCPOAuthCallback = define[EmptyRequest, BinaryContent]("mcpOAuthCallback", "/api/ai/mcp/oauth/callback/:flowID", PublicAccess, NoBody, HTTPContentOptions(HTTPContentVariant{Status: 200, ContentType: "text/html"}, HTTPContentVariant{Status: 400, ContentType: "text/html"}, HTTPContentVariant{Status: 403, ContentType: "text/plain"}), "GET")
var AIGetSession = define[AISessionIDRequest, *AISession]("getSession", "/api/ai/agent/getSession", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{500}}, "POST")
var AISaveSession = define[AISession, AISessionSaveData]("saveSession", "/api/ai/agent/saveSession", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{DataOnError: true, AdditionalErrorStatuses: []int{400, 409, 500}}, "POST")

// URL、TLS 和 Cookie 诊断对象包含标准库的原始 JSON。
// 已声明字段及其类型保持稳定；工具链新增的诊断字段通过 JSONValue 索引读取，不保证跨版本存在。
var NetworkEcho = define[EmptyRequest, NetworkEchoData]("echo", "/api/network/echo", AuthenticatedAccess|AdminAccess, RawBody, ResponseOptions{}, "ANY")

// URL、TLS 和 Cookie 诊断对象包含标准库的原始 JSON。
// 已声明字段及其类型保持稳定；工具链新增的诊断字段通过 JSONValue 索引读取，不保证跨版本存在。
var NetworkEchoPath = define[EmptyRequest, NetworkEchoData]("echoPath", "/api/network/echo/*path", AuthenticatedAccess|AdminAccess, RawBody, ResponseOptions{}, "ANY")
var NetworkForwardProxy = define[NetworkForwardRequest, NetworkForwardData]("forwardProxy", "/api/network/forwardProxy", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4, 5, 6, 7, 8, 10}}, "POST")
var NetworkHTTPProxy = define[EmptyRequest, ProxyFailure]("httpProxy", "/api/network/proxy", AuthenticatedAccess|AdminAccess, RawBody, ProxyOptions(HTTPProxy), "ANY")
var NetworkEventSourceProxy = define[EmptyRequest, ProxyFailure]("esProxy", "/es/network/proxy", AuthenticatedAccess|AdminAccess, NoBody, ProxyOptions(EventSourceProxy), "GET")
var NetworkWebSocketProxy = define[EmptyRequest, ProxyFailure]("wsProxy", "/ws/network/proxy", AuthenticatedAccess|AdminAccess, NoBody, ProxyOptions(WebSocketProxy), "GET")

var PluginPrivateService = define[EmptyRequest, PluginServiceContent]("pluginPrivateWebServer", "/plugin/private/:name/*path", AuthenticatedAccess|AdminAccess|WritableAccess, RawBody, PluginServiceOptions(), "ANY")

// GetDynamicIcon 从 URL 查询参数读取 type、color、date、lang、weekdayType、content 和 id，不读取请求体。
// type 默认 1，lang 默认内核语言，weekdayType 默认 1；文字图标（type=8）跟随全局字体列表和首选字重。
// 日期类图标使用内置字体和常规字重；未配置全局字体时使用内置列表，缺失字体由客户端继续回退。
var GetDynamicIcon = define[EmptyRequest, BinaryContent]("getDynamicIcon", "/api/icon/getDynamicIcon", AuthenticatedAccess, NoBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200, ContentVariants: []HTTPContentVariant{{Status: 200, ContentType: "image/svg+xml"}}, EmptyResponseStatuses: []int{500}}, "GET")

var ExtensionCopy = define[ExtensionCopyRequest, *ExtensionCopyData]("extensionCopy", "/api/extension/copy", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{DataOnError: true}, "POST")

var SystemBootProgressSSE = define[EmptyRequest, Null]("bootProgressSSE", "/api/system/bootProgressSSE", PublicAccess, NoBody, SSEOptions(SSEEvent[BootProgressData]("")), "GET")
var SystemGetBootAppearance = define[EmptyRequest, *SettingBootAppearance]("getBootAppearance", "/api/system/getBootAppearance", PublicAccess, NoBody, ResponseOptions{EmptyResponseStatuses: []int{403}}, "GET")
var SystemGetCaptcha = define[EmptyRequest, BinaryContent]("getCaptcha", "/api/system/getCaptcha", PublicAccess, NoBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200, ContentVariants: []HTTPContentVariant{{Status: 200, ContentType: "image/png"}}, EmptyResponseStatuses: []int{500}}, "GET")

// SystemOIDCCallback 从 URL 查询参数读取 state、code 和 error，验证登录事务及会话绑定，不读取请求体。
var SystemOIDCCallback = define[EmptyRequest, BinaryContent]("oidcCallback", "/api/system/oidc/callback", PublicAccess, NoBody, HTTPContentOptions(HTTPContentVariant{Status: 200, ContentType: "text/html"}), "GET")
var SystemAddCustomEmoji = define[SystemCustomEmojiRequest, SystemPathData]("addCustomEmoji", "/api/system/addCustomEmoji", AuthenticatedAccess|AdminAccess|WritableAccess, FormBody, ResponseOptions{AdditionalCodes: []int{400, 413}}, "POST")
var SystemCheckUpdate = define[SystemCheckUpdateRequest, Null]("checkUpdate", "/api/system/checkUpdate", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var SystemCheckWorkspaceDir = define[SystemPathRequest, SystemWorkspaceCheckData]("checkWorkspaceDir", "/api/system/checkWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemCreateWorkspaceDir = define[SystemPathRequest, Null]("createWorkspaceDir", "/api/system/createWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemDismissOnboarding = define[EmptyRequest, *SystemOnboarding]("dismissOnboarding", "/api/system/dismissOnboarding", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var SystemEnsureOnboarding = define[EmptyRequest, *SystemOnboarding]("ensureOnboarding", "/api/system/ensureOnboarding", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var SystemExit = define[SystemExitRequest, SystemExitData]("exit", "/api/system/exit", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2}, DataOnError: true}, "POST")
var SystemExportConf = define[EmptyRequest, SystemExportConfData]("exportConf", "/api/system/exportConf", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemExportLog = define[EmptyRequest, SystemZipData]("exportLog", "/api/system/exportLog", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemExportTLSCABundle = define[EmptyRequest, SystemPathData]("exportTLSCABundle", "/api/system/exportTLSCABundle", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemExportTLSCACert = define[EmptyRequest, SystemPathData]("exportTLSCACert", "/api/system/exportTLSCACert", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetChangelog = define[SystemChangelogRequest, SystemChangelogData]("getChangelog", "/api/system/getChangelog", AuthenticatedAccess, LegacyOptionalBody, ResponseOptions{}, "POST")
var SystemGetConf = define[EmptyRequest, SystemConfData]("getConf", "/api/system/getConf", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetCustomFonts = define[EmptyRequest, []*SystemCustomFont]("getCustomFonts", "/api/system/getCustomFonts", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetEmojiConf = define[EmptyRequest, []*SystemEmojiGroup]("getEmojiConf", "/api/system/getEmojiConf", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetMobileWorkspaces = define[EmptyRequest, []string]("getMobileWorkspaces", "/api/system/getMobileWorkspaces", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetSysFonts = define[EmptyRequest, []*SystemFont]("getSysFonts", "/api/system/getSysFonts", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetWorkspaces = define[EmptyRequest, []*SystemWorkspace]("getWorkspaces", "/api/system/getWorkspaces", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SystemImportConf = define[SystemImportConfRequest, Null]("importConf", "/api/system/importConf", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")
var SystemImportCustomFont = define[SystemImportFileRequest, *SystemCustomFont]("importCustomFont", "/api/system/importCustomFont", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{AdditionalCodes: []int{400, 413}}, "POST")
var SystemImportTLSCABundle = define[SystemImportFileRequest, SystemMessageData]("importTLSCABundle", "/api/system/importTLSCABundle", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")
var SystemLoginAuth = define[SystemLoginAuthRequest, Null]("loginAuth", "/api/system/loginAuth", PublicAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var SystemLogoutAuth = define[EmptyRequest, Null]("logoutAuth", "/api/system/logoutAuth", PublicAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var SystemOIDCMobileCallback = define[SystemOIDCMobileRequest, SystemOIDCMobileData]("oidcMobileCallback", "/api/system/oidc/mobileCallback", PublicAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCPoll = define[SystemOIDCPollRequest, SystemOIDCPollData]("oidcPoll", "/api/system/oidc/poll", PublicAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCStart = define[SystemOIDCStartRequest, SystemOIDCStartData]("oidcStart", "/api/system/oidc/start", PublicAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidateStart = define[SystemOIDCRequest, SystemOIDCStartData]("oidcValidateStart", "/api/system/oidc/validate", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidateActivate = define[SystemOIDCPollRequest, SystemOIDCActivateData]("oidcValidateActivate", "/api/system/oidc/validateActivate", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidateCancel = define[SystemOIDCPollRequest, Null]("oidcValidateCancel", "/api/system/oidc/validateCancel", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidatePoll = define[SystemOIDCPollRequest, SystemOIDCValidatePollData]("oidcValidatePoll", "/api/system/oidc/validatePoll", PublicAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemRemoveCustomFont = define[SystemRemoveCustomFontRequest, SystemRemoveCustomFontData]("removeCustomFont", "/api/system/removeCustomFont", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{400, 404}}, "POST")
var SystemRemoveWorkspaceDir = define[SystemPathRequest, Null]("removeWorkspaceDir", "/api/system/removeWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemRemoveWorkspaceDirPhysically = define[SystemPathRequest, Null]("removeWorkspaceDirPhysically", "/api/system/removeWorkspaceDirPhysically", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemSetAPIToken = define[SystemAPITokenRequest, Null]("setAPIToken", "/api/system/setAPIToken", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemSetAccessAuthCode = define[SystemAccessAuthCodeRequest, Null]("setAccessAuthCode", "/api/system/setAccessAuthCode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemSetAppearanceMode = define[SystemAppearanceModeRequest, SystemAppearanceData]("setAppearanceMode", "/api/system/setAppearanceMode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemSetOIDC = define[SystemOIDCRequest, *SystemOIDC]("setOIDC", "/api/system/setOIDC", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemSetUILayout = define[SystemUILayoutRequest, Null]("setUILayout", "/api/system/setUILayout", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemSetWorkspaceDir = define[SystemPathRequest, Null]("setWorkspaceDir", "/api/system/setWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// SystemAddUIProcess 从 URL 查询参数读取正整数 pid，不读取请求体；无效 pid 或注册表已满时返回空 200。
var SystemAddUIProcess = define[EmptyRequest, Null]("addUIProcess", "/api/system/uiproc", AuthenticatedAccess, NoBody, ResponseOptions{EmptyResponseStatuses: []int{200}}, "POST")

// move 操作支持 nextID，将块移到该同级锚点之前，优先于 previousID 和 parentID。
// 移动保留折叠标题下辖块顺序及源块身份，不将整列表自动拆成列表项；moveBlock 接口不接受 nextID。
// 数据库自动化通过 setAttrViewAutomations 操作整体保存，配置 spec 为 1，所有视图共享数据库级规则。
// addAttributeViewBlocks、setAttributeViewBlockAttr、batchSetAttributeViewBlockAttrs 触发启用的新增或字段变化规则。
// 自动操作与原修改一同提交，失败一起回滚；普通 API 写入不生成编辑器撤销记录。
// 自动化不串联，导入、同步、历史恢复和撤销重放不重新触发；重做保留原条目 ID 和触发时间。
// 跨库动作限于同一加密边界，要求目标可访问；单笔事务最多执行 1000 个自动操作。
var PerformTransactions = define[PerformTransactionsRequest, []*Transaction]("performTransactions", "/api/transactions", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var UndoState = define[TransactionUndoStateRequest, TransactionUndoState]("undoState", "/api/transactions/undoState", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var PerformUndo = define[TransactionHistoryRequest, TransactionHistoryResult]("performUndo", "/api/transactions/undo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var PerformRedo = define[TransactionHistoryRequest, TransactionHistoryResult]("performRedo", "/api/transactions/redo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ClearHistory = define[TransactionClearHistoryRequest, Null]("clearHistory", "/api/transactions/clearHistory", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BroadcastWebSocket = define[EmptyRequest, Null]("broadcast", "/ws/broadcast", AuthenticatedAccess|AdminAccess, NoBody, RawWebSocketOptions(), "GET")
var BroadcastSubscribe = define[EmptyRequest, Null]("broadcastSubscribe", "/es/broadcast/subscribe", AuthenticatedAccess|AdminAccess, NoBody, RawSSEOptions(), "GET")
