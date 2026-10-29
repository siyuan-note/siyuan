// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	Setting                 SettingWrite
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
	Setting                 SettingWrite
}

var definitions []Definition

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
	OpenNotebook = define[OpenNotebookRequest, Null]("openNotebook", "/api/notebook/openNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// GetNotebookConf 保留配置与权限过滤；管理员响应包含 documentCapabilities。
	// structuredPaths 声明 ID 与标题段接口支持，literalSlash 仅在 indexState=ready 时为 true。
	// titleFormats 列出支持的标题格式；revision 标识能力声明，不是文档路径或配置版本。
	// 能力声明不授予关闭或锁定笔记本的访问权，也不表示允许与旧客户端混用。
	// 认证、锁定和网络失败不能解释为缺少能力对象，失败后不得回退到旧接口继续写入。
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
	// GetPinnedDocs 按置顶顺序返回普通文档及与文档树一致的大小、属性和时间信息。
	// 关闭笔记本的条目标记 unavailable，详细信息为空；加密笔记本不返回置顶条目。
	GetPinnedDocs    = define[EmptyRequest, []PinnedDoc]("getPinnedDocs", "/api/filetree/getPinnedDocs", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{NonNullable: true}, "POST")
	UpdatePinnedDocs = define[UpdatePinnedDocsRequest, Null]("updatePinnedDocs", "/api/filetree/updatePinnedDocs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
)

func define[Request, Data any](name, path string, authorization Authorization, body BodyMode, response ResponseOptions, methods ...string) Endpoint[Request, Data] {
	d := Definition{Name: name, Path: path, Methods: methods, Authorization: authorization, Body: body,
		Request: reflect.TypeFor[Request](), Data: reflect.TypeFor[Data](),
		ErrorCodes: append([]int{-1}, response.AdditionalCodes...), ErrorText: response.Text, DataNonNullable: response.NonNullable, DataOnError: response.DataOnError,
		Output: response.Output, ErrorStatus: response.ErrorStatus, NoContent: response.NoContent, WebSocket: response.WebSocket, SSE: response.SSE, Proxy: response.Proxy, PluginService: response.PluginService,
		AdditionalErrorStatuses: append([]int(nil), response.AdditionalErrorStatuses...), ContentVariants: append([]HTTPContentVariant(nil), response.ContentVariants...), FastJSON: response.FastJSON,
		EmptyResponseStatuses: append([]int(nil), response.EmptyResponseStatuses...), Setting: response.Setting}
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
	// CreateSnapshot 创建快照；fullCheck 默认为 false，为 true 时读取所有本地已落盘文件核对内容。
	// 未下载资源沿用其逻辑版本；无变化时返回原快照并令 created 为 false。大文件较多时完整校验耗时更长。
	CreateSnapshot = define[CreateSnapshotRequest, CreateSnapshotData]("createSnapshot", "/api/repo/createSnapshot", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// CheckSnapshot 只读检查变更，复用已确认的本机大小及精细时间，记录缺失或变化时读取内容。
	// 不下载资源或写入缓存；大小和时间完全相同且没有本进程写入标记的外部修改需使用完整校验。
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
	IgnoreAddMicrosoftDefenderExclusion = define[EmptyRequest, Null]("ignoreAddMicrosoftDefenderExclusion", "/api/system/ignoreAddMicrosoftDefenderExclusion", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	AddMicrosoftDefenderExclusion       = define[EmptyRequest, Null]("addMicrosoftDefenderExclusion", "/api/system/addMicrosoftDefenderExclusion", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	GetWorkspaceInfo                    = define[EmptyRequest, WorkspaceInfoData]("getWorkspaceInfo", "/api/system/getWorkspaceInfo", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	// 无需参数，要求管理员权限并允许只读模式，统计当前内核工作空间的本地文件大小。
	// totalSize 为普通文件字节数之和，assetsSize 是 data 的子集，不能重复累加；不含目录分配空间或链接目标。
	// directories 按 data、repo、history、temp、conf、other 排序，calculatedAt 为扫描完成的 Unix 毫秒时间。
	// 扫描不下载资源或解密文件，不返回绝对路径；并发请求共享扫描，完成后不缓存，不保证扫描期间的快照一致性。
	// 扫描期间已删除的子文件或子目录不计入；根目录丢失、权限错误等返回失败。
	// 读取失败或扫描超时返回 code=-1、data=null；调用方应保留旧结果的时间标记，并允许用户重试。
	GetWorkspaceStorage = define[EmptyRequest, WorkspaceStorageData]("getWorkspaceStorage", "/api/system/getWorkspaceStorage", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	GetNetwork          = define[EmptyRequest, NetworkData]("getNetwork", "/api/system/getNetwork", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	// 无需请求体，要求管理员权限并允许只读模式，返回 {text} 诊断摘要：内核版本、运行时、操作系统、
	// 逻辑 CPU 数量、当前系统与进程内存，以及检测到的工作空间存储类型。
	// 无法探测的内存或存储返回 unknown，不把移动端存储推断为 SSD；文本不含工作空间路径、主机名和账户标识。
	GetRuntimeInfo = define[EmptyRequest, SystemRuntimeInfoData]("getRuntimeInfo", "/api/system/getRuntimeInfo", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	// 无需参数，要求管理员权限并允许只读模式，以当前内核进程身份诊断 data 目录的遍历。
	// text 为 JSON Lines，比较标准库和原始目录项，不读取正文、不写入工作空间、不下载或解密资源。
	// 首行包含思源版本、容器和移动端提供的系统版本，便于关联 Android/SDK 及具体内核版本。
	// Android/Linux 使用 4/8/32 KiB 缓冲区执行三轮；每轮至多 20000 个目录、100000 个目录项及 100 条详情。
	// 包含运行版本、UID、文件系统类型、零 inode、路径差异、目录变化及读取错误；路径相对于 data。
	// 不支持原始目录读取的平台返回 rawSupported=false，不将未执行的比较视为通过。
	// 并发诊断返回 code=-1；请求取消或 60 秒超时会停止后续扫描，不保证并发编辑时的原子快照。
	CheckFileTraversal        = define[EmptyRequest, SystemFileTraversalData]("checkFileTraversal", "/api/system/checkFileTraversal", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	CurrentTime               = define[EmptyRequest, int64]("currentTime", "/api/system/currentTime", PublicAccess, NoBody, ResponseOptions{}, "POST")
	BootProgress              = define[EmptyRequest, BootProgressData]("bootProgress", "/api/system/bootProgress", PublicAccess, NoBody, ResponseOptions{}, "GET", "POST")
	SetFollowSystemLockScreen = define[LockScreenRequest, Null]("setFollowSystemLockScreen", "/api/system/setFollowSystemLockScreen", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	SetAutoLaunch             = define[AutoLaunchRequest, Null]("setAutoLaunch", "/api/system/setAutoLaunch", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	SetDownloadInstallPkg     = define[DownloadInstallPkgRequest, Null]("setDownloadInstallPkg", "/api/system/setDownloadInstallPkg", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	// 更新工作空间的独立设置窗口开关，仅桌面 Electron 客户端使用。
	SetSettingsWindow  = define[SettingsWindowRequest, Null]("setSettingsWindow", "/api/system/setSettingsWindow", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	SetNetworkServe    = define[NetworkServeRequest, Null]("setNetworkServe", "/api/system/setNetworkServe", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	SetNetworkServeTLS = define[NetworkServeTLSRequest, Null]("setNetworkServeTLS", "/api/system/setNetworkServeTLS", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	SetUpdateChannel   = define[UpdateChannelRequest, Null]("setUpdateChannel", "/api/system/setUpdateChannel", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	SetNetworkProxy    = define[NetworkProxy, Null]("setNetworkProxy", "/api/system/setNetworkProxy", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	GetBookmarkLabels  = define[EmptyRequest, []string]("getBookmarkLabels", "/api/attr/getBookmarkLabels", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
	BatchGetBlockAttrs = define[BlockIDsRequest, map[string]map[string]string]("batchGetBlockAttrs", "/api/attr/batchGetBlockAttrs", AuthenticatedAccess, JSONBody, ResponseOptions{NonNullable: true}, "POST")
	GetDOMText         = define[DOMTextRequest, string]("getDOMText", "/api/block/getDOMText", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	RemoveBookmark     = define[RemoveBookmarkRequest, Null]("removeBookmark", "/api/bookmark/removeBookmark", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RenameBookmark     = define[RenameBookmarkRequest, Null]("renameBookmark", "/api/bookmark/renameBookmark", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RemoveTag          = define[RemoveTagRequest, Null]("removeTag", "/api/tag/removeTag", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RenameTag          = define[RenameTagRequest, Null]("renameTag", "/api/tag/renameTag", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
	SetEditorReadOnly         = define[EditorReadOnlyRequest, Null]("setEditorReadOnly", "/api/setting/setEditorReadOnly", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "editor"}}, "POST")
	AddVirtualBlockRefExclude = define[VirtualBlockRefRequest, Null]("addVirtualBlockRefExclude", "/api/setting/addVirtualBlockRefExclude", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "editor"}}, "POST")
	AddVirtualBlockRefInclude = define[VirtualBlockRefRequest, Null]("addVirtualBlockRefInclude", "/api/setting/addVirtualBlockRefInclude", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "editor"}}, "POST")
	RefreshVirtualBlockRef    = define[EmptyRequest, Null]("refreshVirtualBlockRef", "/api/setting/refreshVirtualBlockRef", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	GetPandocBin              = define[EmptyRequest, string]("getPandocBin", "/api/setting/getPandocBin", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	ReindexHistory            = define[EmptyRequest, Null]("reindexHistory", "/api/history/reindexHistory", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	ClearWorkspaceHistory     = define[EmptyRequest, Null]("clearWorkspaceHistory", "/api/history/clearWorkspaceHistory", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	BatchSetBlockAttrs        = define[BatchSetBlockAttrsRequest, Null]("batchSetBlockAttrs", "/api/attr/batchSetBlockAttrs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	GetTag                    = define[GetTagRequest, []*TagData]("getTag", "/api/tag/getTag", AuthenticatedAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "tag", Mode: SettingSilent}}, "POST")
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
	EnableEncryptedNotebooks  = define[NotebookPasswordRequest, Null]("enableEncryptedNotebooks", "/api/notebook/enableEncryptedNotebooks", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	DisableEncryptedNotebooks = define[EmptyRequest, Null]("disableEncryptedNotebooks", "/api/notebook/disableEncryptedNotebooks", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	CreateEncryptedNotebook   = define[CreateEncryptedNotebookRequest, CreateNotebookData]("createEncryptedNotebook", "/api/notebook/createEncryptedNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// 密钥恢复和解锁保持既有认证及源格式检查，保留原密文和恢复材料。
	UnlockNotebook = define[UnlockNotebookRequest, Null]("unlockNotebook", "/api/notebook/unlockNotebook", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
	// 解锁及挂载均保留源格式与认证检查；失败时不发布解锁状态或修复源数据。
	UnlockAndOpenNotebook = define[UnlockNotebookRequest, Null]("unlockAndOpenNotebook", "/api/notebook/unlockAndOpenNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	LockNotebook          = define[NotebookIDRequest, Null]("lockNotebook", "/api/notebook/lockNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// 保存本机加密笔记本锁屏策略，成功后广播 system 设置变更通知，供其他客户端重新读取配置。
	SetEncryptedNotebookFollowSystemLock = define[EncryptedNotebookFollowSystemLockRequest, Null]("setEncryptedNotebookFollowSystemLock", "/api/notebook/setEncryptedNotebookFollowSystemLock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
	LockEncryptedNotebooksOnSystemLock   = define[EmptyRequest, Null]("lockEncryptedNotebooksOnSystemLock", "/api/notebook/lockEncryptedNotebooksOnSystemLock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// 自动锁定分钟数由内核内存值驱动锁定行为，写入后无需广播供其他客户端重读。
	SetNotebookCryptoAutoLock = define[NotebookCryptoAutoLockRequest, Null]("setNotebookCryptoAutoLock", "/api/notebook/setNotebookCryptoAutoLock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "notebookCrypto", Mode: SettingSilent}}, "POST")
	// 改密恢复和密钥切换保留现存加密笔记本的认证、信封格式及中断恢复检查。
	ChangeMasterPassword         = define[ChangeMasterPasswordRequest, Null]("changeMasterPassword", "/api/notebook/changeMasterPassword", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	ExportNotebookCryptoBackup   = define[EmptyRequest, NotebookCryptoBackupData]("exportNotebookCryptoBackup", "/api/notebook/exportNotebookCryptoBackup", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	TouchEncryptedNotebooks      = define[EmptyRequest, Null]("touchEncryptedNotebooks", "/api/notebook/touchEncryptedNotebooks", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	GetNotebookArchiveCandidates = define[EmptyRequest, NotebookArchiveCandidatesData]("getNotebookArchiveCandidates", "/api/notebook/getNotebookArchiveCandidates", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
	// 接收已锁定的加密笔记本 ID，返回归档 ID 和下载路径，不删除源数据，要求管理员权限。
	// 下载完成后，必须由用户确认已保存归档，再调用 `/api/notebook/commitNotebookArchive` 并传入 saved: true。
	// 源格式或认证检查失败时返回 -1，保留源目录及密钥材料。
	PrepareNotebookArchive = define[PrepareNotebookArchiveRequest, NotebookArchiveData]("prepareNotebookArchive", "/api/notebook/prepareNotebookArchive", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// 移出已导出的加密笔记本，要求管理员权限并禁止只读模式；saved: true 表示用户确认已保存归档。
	// 提交前重新检查源文件，内容变化需重新导出；重复提交同一归档不会重复移出，未选择的笔记本不受影响。
	// 移出前保留归档及源目录检查，失败时保留原归档和密钥材料。
	CommitNotebookArchive = define[CommitNotebookArchiveRequest, Null]("commitNotebookArchive", "/api/notebook/commitNotebookArchive", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	// 接收 multipart 的 file、旧 password 和可选密钥备份 key，要求管理员权限并禁止只读模式。
	// 恢复目标必须关闭同步，且没有加密密钥配置或加密数据；密文全部通过认证后才发布，恢复后保持锁定。
	// 认证后、安装任何数据或密钥前检查全部源身份的寻址能力；不能通过旧归档降低本机已确认的要求。
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

// refID 指定引用块，defID 指定定义块；includeChildren 控制标题或列表的子块范围。
// originalToEmbed 省略或为 false 时在原定义位置保留引用，为 true 时替换为查询已移动定义 ID 的嵌入块。
// 成功响应的 data 为 null；可撤销的编辑器操作使用 /api/transactions 的 swapBlockRef 动作。
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

// 要求管理员身份，保留只读保护及加密笔记本请求租约；请求必须提供文档 id 和 notebook。
// 保存历史后在一次可撤销事务中转换能够完整解析的旧 mindmap 列表，返回 converted 数量与文档脑图的
// 权威 blocks（id、dom）。重复请求返回当前块内容而不重复转换，不完整的原文保持不变。
var MigrateLegacyMindmaps = define[MigrateLegacyMindmapsRequest, MigrateLegacyMindmapsData]("migrateLegacyMindmaps", "/api/block/migrateLegacyMindmaps", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BatchUpdateBlock = define[BatchUpdateBlockRequest, []*BlockTransaction]("batchUpdateBlock", "/api/block/batchUpdateBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var DeleteBlock = define[DeleteBlockRequest, []*BlockTransaction]("deleteBlock", "/api/block/deleteBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var CheckBlockRef = define[CheckBlockRefRequest, bool]("checkBlockRef", "/api/block/checkBlockRef", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

var GetHeadingLevelTransaction = define[HeadingLevelRequest, *BlockTransaction]("getHeadingLevelTransaction", "/api/block/getHeadingLevelTransaction", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var GetDocHeadingLevelTransaction = define[DocHeadingLevelRequest, *DocHeadingLevelData]("getDocHeadingLevelTransaction", "/api/block/getDocHeadingLevelTransaction", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")

var GetRecentUpdatedBlocks = define[EmptyRequest, []*SearchBlock]("getRecentUpdatedBlocks", "/api/block/getRecentUpdatedBlocks", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")

// Zip 的输出位置遵守笔记本能力及原始文档保护，不能用压缩文件覆盖文档源或能力记录。
var Zip = define[ZipRequest, Null]("zip", "/api/archive/zip", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// Unzip 在隔离目录解压并预检完整输出集合的能力记录及文档源，失败时不写入目标。
// 实际复制仍重新检查目标；后续并发变化或 I/O 失败可能留下已完成条目，不承诺整批回滚。
var Unzip = define[UnzipRequest, Null]("unzip", "/api/archive/unzip", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 格式化成功写盘后清理文档及关联跨文档撤销记录，并广播更新后的撤销状态。
var AutoSpace = define[TrimmedIDRequest, Null]("autoSpace", "/api/format/autoSpace", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 转换成功写盘后清理文档及关联跨文档撤销记录；未改写文档时保留历史。
var NetAssets2LocalAssets = define[TrimmedIDRequest, Null]("netAssets2LocalAssets", "/api/format/netAssets2LocalAssets", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 转换成功写盘后清理文档及关联跨文档撤销记录；未改写文档时保留历史。
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

// 标准 Markdown 复制按文档标题编号开关和编辑器编号格式添加编号，局部导出保留原文档编号。
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
var SetLocalStorageVal = define[StorageSetRequest, Null]("setLocalStorageVal", "/api/storage/setLocalStorageVal", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "localStorage", Mode: SettingSilent}}, "POST")
var SetLocalStorageVals = define[StorageSetKeysRequest, Null]("setLocalStorageVals", "/api/storage/setLocalStorageVals", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "localStorage", Mode: SettingSilent}}, "POST")
var RemoveLocalStorageVal = define[StorageRemoveRequest, Null]("removeLocalStorageVal", "/api/storage/removeLocalStorageVal", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "localStorage", Mode: SettingSilent}}, "POST")
var RemoveLocalStorageVals = define[StorageRemoveKeysRequest, Null]("removeLocalStorageVals", "/api/storage/removeLocalStorageVals", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "localStorage", Mode: SettingSilent}}, "POST")
var GetOutlineStorage = define[OutlineStorageRequest, map[string]JSONValue]("getOutlineStorage", "/api/storage/getOutlineStorage", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 写入 data/storage 下独立存储的端点都不是 conf.json 的配置段，因此只持锁不广播。
var SetOutlineStorage = define[OutlineStorageSetRequest, Null]("setOutlineStorage", "/api/storage/setOutlineStorage", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "storage", Mode: SettingSilent}}, "POST")
var RemoveOutlineStorage = define[OutlineStorageRequest, Null]("removeOutlineStorage", "/api/storage/removeOutlineStorage", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "storage", Mode: SettingSilent}}, "POST")
var GetViewState = define[StorageKeyRequest, map[string]JSONValue]("getViewState", "/api/storage/getViewState", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var PatchViewState = define[ViewStatePatchRequest, map[string]JSONValue]("patchViewState", "/api/storage/patchViewState", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "storage", Mode: SettingSilent}}, "POST")
var RemoveViewState = define[StorageKeyRequest, Null]("removeViewState", "/api/storage/removeViewState", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "storage", Mode: SettingSilent}}, "POST")
var GetRecentDocs = define[RecentDocsRequest, []*RecentDoc]("getRecentDocs", "/api/storage/getRecentDocs", AuthenticatedAccess, LegacyOptionalBody, ResponseOptions{}, "POST")

// 清空当前工作区的全部最近浏览、打开和关闭记录，不删除文档，也不修改文档创建和修改时间。
// 记录不参与数据同步；后续浏览、打开或关闭文档会重新产生记录。最近创建和最近修改列表不受影响。
// 仅允许可写工作区的管理员调用，无需请求参数；重复清空仍返回成功。
var ClearRecentDocs = define[EmptyRequest, Null]("clearRecentDocs", "/api/storage/clearRecentDocs", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

var GetCriteria = define[EmptyRequest, []*Criterion]("getCriteria", "/api/storage/getCriteria", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SetCriterion = define[SetCriterionRequest, Null]("setCriterion", "/api/storage/setCriterion", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "storage", Mode: SettingSilent}}, "POST")
var RemoveCriterion = define[RemoveCriterionRequest, Null]("removeCriterion", "/api/storage/removeCriterion", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "storage", Mode: SettingSilent}}, "POST")

var UpdateRecentDocOpenTime = define[RecentDocUpdateRequest, Null]("updateRecentDocOpenTime", "/api/storage/updateRecentDocOpenTime", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var UpdateRecentDocViewTime = define[RecentDocUpdateRequest, Null]("updateRecentDocViewTime", "/api/storage/updateRecentDocViewTime", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var UpdateRecentDocCloseTime = define[RecentDocUpdateRequest, Null]("updateRecentDocCloseTime", "/api/storage/updateRecentDocCloseTime", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var BatchUpdateRecentDocCloseTime = define[RecentDocsUpdateRequest, Null]("batchUpdateRecentDocCloseTime", "/api/storage/batchUpdateRecentDocCloseTime", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var GetDocOutline = define[OutlineRequest, []*SearchPath]("getDocOutline", "/api/outline/getDocOutline", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetDocHeadingNumbers = define[HeadingNumbersRequest, map[string]string]("getDocHeadingNumbers", "/api/outline/getDocHeadingNumbers", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var GetInlineStyles = define[EmptyRequest, *InlineStyles]("getInlineStyles", "/api/storage/getInlineStyles", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")

// 行级样式与数据库调色板变化由 reloadInlineStyles 专用推送通知其他窗口，不走配置段刷新。
var SetInlineStyles = define[SetInlineStylesRequest, *InlineStyles]("setInlineStyles", "/api/storage/setInlineStyles", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "storage", Mode: SettingSilent}}, "POST")
var SetWorkspaceAVPalette = define[WorkspaceAVPaletteRequest, *InlineStyles]("setWorkspaceAVPalette", "/api/storage/setWorkspaceAVPalette", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "storage", Mode: SettingSilent}}, "POST")

// 根据编辑器 mathDelimiterCompatibility 设置识别正文中的 \(...\) 和独占段落的 \[...\]，默认开启。
// 保留表格和文字格式，跳过代码及已有公式；未闭合分隔符保留为正文。输出使用既有公式节点。
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

// RenameFile 在创建目标父目录或移动源文件前预检文档源格式与规范路径，失败返回 -1。
// 移入由笔记本及文档 ID 组成的 .sy 路径时检查全部源文档；未知格式或标题冲突返回 -1，保留来源。
// 新移入的标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；不自动改写原始内容。
var RenameFile = define[RenameFileRequest, Null]("renameFile", "/api/file/renameFile", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-3, 403, 404, 409, 500}}, "POST")

// RemoveFile 保留既有敏感路径和加密边界检查；整本删除时校验树内全部文档寻址记录。
var RemoveFile = define[RemoveFileRequest, Null]("removeFile", "/api/file/removeFile", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-3, 403, 404, 500}}, "POST")

// GlobalCopyFiles 在创建目标目录及复制前预检整批规范路径和文档源；预检不兼容时返回 -1，不写入目标。
// 新复制的文档标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；不自动改写原始内容。
// 文档 ID 路径同时检查传入内容及现有源，实际写入前再次校验；后续并发变化或 I/O 失败不回滚已完成的复制。
// 原有敏感路径、加密笔记本和符号链接限制继续生效。
var GlobalCopyFiles = define[CopyFilesRequest, Null]("globalCopyFiles", "/api/file/globalCopyFiles", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-2, -3, 403}}, "POST")

// WorkspaceCopyFiles 在创建目标目录及复制前预检整批规范路径和文档源；预检不兼容时返回 -1，不写入目标。
// 新复制的文档标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；不自动改写原始内容。
// 文档 ID 路径同时检查传入内容及现有源，实际写入前再次校验；后续并发变化或 I/O 失败不回滚已完成的复制。
// 原有敏感路径、加密笔记本和符号链接限制继续生效。
var WorkspaceCopyFiles = define[CopyFilesRequest, Null]("workspaceCopyFiles", "/api/file/workspaceCopyFiles", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-2, -3, 403}}, "POST")

// CopyFile 在写入前检查文档源格式及规范路径，预检失败返回 -1。
// 目标为文档 ID 路径时，未知格式和标题冲突均返回 -1；实际写入在文件锁内重新校验现有源，不规范化内容。
// 新复制的文档标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；已有源的读取和恢复不受此写入检查影响。
// 工作空间外的加密资源解密导出仍要求既有授权和操作租约。
var CopyFile = define[CopyFileRequest, Null]("copyFile", "/api/file/copyFile", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{-2}}, "POST")

// PutFile 在创建目录、写入内容及更新时间前校验文档源格式与规范路径；不兼容时返回 -1。
// 文档 ID 路径检查传入内容及现有源的格式和标题；未知格式或标题冲突返回 -1，原文件和时间保持不变。
// 新传入的标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；已有低 Spec 源仍可读取并由合法内容替换。
// 实际文档写入在同一文件锁内重新校验现有源，保留请求字节；附件和插件文件不按文档格式解释。
var PutFile = define[PutFileRequest, Null]("putFile", "/api/file/putFile", AuthenticatedAccess|AdminAccess|WritableAccess, FormBody, ResponseOptions{AdditionalCodes: []int{-3, 400, 403, 500}}, "POST")

var GetFile = define[FilePathRequest, BinaryContent]("getFile", "/api/file/getFile", AuthenticatedAccess, JSONBody,
	ResponseOptions{Output: BinaryOutput, ErrorStatus: 202, AdditionalCodes: []int{-3, 403, 404, 409, 500, 503}}, "POST")

// QuerySQL 执行全局派生索引库 SQL，要求管理员身份及可写运行环境。
// mode 省略、null 或空字符串时允许单条读写语句；readonly 仅允许单条只读 SELECT 或 WITH 查询。
// multiple 按顺序执行多条读写语句，返回最后一条的结果；失败后停止，已完成的写入不自动回滚。
// 无结果列的语句成功时返回空数组，RETURNING 保留结果行；校验失败返回 -1，执行失败返回 1。
// 返回行数沿用搜索上限及显式外层 LIMIT 规则；直接修改索引不更新源文档、全文索引和块缓存。
var QuerySQL = define[SQLQueryRequest, SQLRows]("SQL", "/api/query/sql", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}, NonNullable: true}, "POST")

var RenderSprig = define[RenderSprigRequest, string]("renderSprig", "/api/template/renderSprig", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var GetDocSaveAsTemplateInfo = define[TemplateDocumentRequest, TemplateDocumentInfo]("getDocSaveAsTemplateInfo", "/api/template/getDocSaveAsTemplateInfo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var DocSaveAsTemplate = define[SaveTemplateRequest, Null]("docSaveAsTemplate", "/api/template/docSaveAsTemplate", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var RenderTemplate = define[RenderTemplateRequest, RenderTemplateData]("renderTemplate", "/api/template/render", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 读取模板源码时，可选的 sourceDocID 表示导出模板末尾文档属性中的静态来源 ID。
// 普通 Markdown、目录或未声明有效 ID 的模板不返回该字段；读取不会执行模板或检查源文档是否仍可访问。
// 打开来源时需按当前工作空间的文档访问规则处理失败；该字段不是预览上下文，也不保证模板与源文档保持同步。
var ManageTemplateFiles = define[TemplateFileRequest, TemplateManagementData]("manageTemplateFiles", "/api/template/manage", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")

var ResetGraph = define[EmptyRequest, ResetGraphData]("resetGraph", "/api/graph/resetGraph", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{Setting: SettingWrite{Namespace: "graph"}}, "POST")

var ResetLocalGraph = define[EmptyRequest, ResetLocalGraphData]("resetLocalGraph", "/api/graph/resetLocalGraph", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{Setting: SettingWrite{Namespace: "graph"}}, "POST")

var SetGraphConf = define[SetGraphConfRequest, GraphConfigurationData]("setGraphConf", "/api/graph/setGraphConf", AuthenticatedAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "graph"}}, "POST")

// 图谱查询需要与配置写入互斥；查询自带的配置由配置段发布负责通知。
var GetGraph = define[GlobalGraphRequest, GlobalGraphData]("getGraph", "/api/graph/getGraph", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true, Setting: SettingWrite{Namespace: "graph", Mode: SettingSilent}}, "POST")

var GetLocalGraph = define[LocalGraphRequest, LocalGraphData]("getLocalGraph", "/api/graph/getLocalGraph", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true, Setting: SettingWrite{Namespace: "graph", Mode: SettingSilent}}, "POST")

var RefreshBacklink = define[RefreshBacklinkRequest, Null]("refreshBacklink", "/api/ref/refreshBacklink", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 提及数量提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，发布读者不发送提示。
var GetBackmentionDoc = define[BackmentionDocumentRequest, BacklinkContextData]("getBackmentionDoc", "/api/ref/getBackmentionDoc", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// sourceFilter.database 在父块合并前按来源块的数据库字段筛选，不修改原数据库视图。
// 无条件仅筛数据库成员，失效字段不放宽结果；原来源筛选、排序及加密笔记本租约保持不变。
// blockSort 为 0（默认）时保持正文顺序，1 按匹配引用的锚文本自然升序，2 为自然降序，其他值回退正文顺序。
// 条目取首个匹配引用的锚文本并去除首尾空白；排序键相同时保持正文顺序，无锚文本的条目在两个方向均置后。
// 来源文档内部把整篇文档条目展开为可独立排序的引用，恢复正文顺序时重新合并；排序模式参与上下文版本哈希。
var GetBacklinkDoc = define[BacklinkDocumentRequest, BacklinkContextData]("getBacklinkDoc", "/api/ref/getBacklinkDoc", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 提及数量提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，发布读者不发送提示。
// 可选 sourceFilter.database 按单个数据库的字段筛选反链及数量，不影响提及或数据库原视图。
var GetBacklink2 = define[BacklinkListRequest, BacklinkListData]("getBacklink2", "/api/ref/getBacklink2", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")

// 返回实际绑定反链来源的数据库名称及字段元数据，不返回条目值。
// 忽略当前数据库条件并应用其他来源限制；发布读者不可查询，保持加密笔记本隔离及请求租约。
var GetBacklinkDatabases = define[BacklinkDatabasesRequest, []*BacklinkDatabase]("getBacklinkDatabases", "/api/ref/getBacklinkDatabases", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// sourceFilter.database 在完整结果分页前求值，快照绑定全部筛选条件；原分页、排序和访问检查保持不变。
var GetGlobalBacklinks = define[GlobalBacklinkListRequest, GlobalBacklinkListData]("getGlobalBacklinks", "/api/ref/getGlobalBacklinks", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 数据库条件与列表快照一致，不修改来源数据或原数据库视图。
// 必需的 snapshot 与最多 20 个属于该快照的块 ids 返回可独立编辑的块正文，保留面包屑和数据库引用信息。
// 返回前重新检查来源权限并持有加密笔记本请求租约；发布阅读者不能读取加密笔记本。
var GetGlobalBacklinkContexts = define[GlobalBacklinkContextRequest, GlobalBacklinkContextData]("getGlobalBacklinkContexts", "/api/ref/getGlobalBacklinkContexts", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var ContinueImportSY = define[ContinueImportSYRequest, ImportDocumentData]("continueImportSY", "/api/import/continueImportSY", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var CancelImportSY = define[ImportTokenRequest, Null]("cancelImportSY", "/api/import/cancelImportSY", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var StartObsidianVaultAnalysis = define[ObsidianAnalysisRequest, *ObsidianVaultTask]("startObsidianVaultAnalysis", "/api/import/startObsidianVaultAnalysis", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var GetObsidianVaultTask = define[ObsidianTaskRequest, *ObsidianVaultTask]("getObsidianVaultTask", "/api/import/getObsidianVaultTask", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// Markdown 公式分隔符遵循编辑器 mathDelimiterCompatibility 设置，默认兼容 \(...\)、\[...\]。
var StartObsidianVaultImport = define[ObsidianImportRequest, *ObsidianVaultTask]("startObsidianVaultImport", "/api/import/startObsidianVaultImport", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var CancelObsidianVaultTask = define[ObsidianTaskRequest, *ObsidianVaultTask]("cancelObsidianVaultTask", "/api/import/cancelObsidianVaultTask", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

// 标准脚注定义保存为独立列表项，正文引用转换为指向列表项的上标静态块引用。
// 多段内容保留在同一列表项内；多次引用共享目标，标签匹配忽略大小写，重复定义引用第一个匹配项。
// 未定义的脚注不生成块引用，代码和转义的脚注文本保持原样；反链复用块引用索引。
// 根据编辑器 mathDelimiterCompatibility 设置兼容 \(...\)、\[...\]，默认开启；保存和导出仍使用既有公式格式。
var ImportStdMd = define[ImportMarkdownRequest, Null]("importStdMd", "/api/import/importStdMd", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 旧 Data.zip 入口仍拒绝覆盖已有加密笔记本，也拒绝加密来源覆盖同 ID 的普通笔记本。
// 不会隐式选择冲突策略；交互式冲突处理使用 prepareDataImport、commitDataImport 和 cancelDataImport。
var ImportData = define[ImportDataRequest, Null]("importData", "/api/import/importData", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// 预检 Data.zip 并保存原件，返回加密冲突及需要认证的笔记本 ID，不修改活动数据。
// 预检有效期为 30 分钟；提交前必须显式选择 skip 或 overwrite，取消会移除尚未提交的暂存文件。
// 过期且未提交的预检在启动或下一次导入时清理；预检失败时也清理本次暂存副本。
// 存在未完成批次时，先在独占访问下恢复；恢复失败会继续阻断其他写入、笔记本操作和同步。
var PrepareDataImport = define[ImportDataRequest, DataImportPlan]("prepareDataImport", "/api/import/prepareDataImport", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// 按路径覆盖并保留目标独有文件，skip 保留冲突目录及其密钥材料，返回明确的跳过清单。
// 导入加密内容必须提供可认证兼容密钥的主密码；不同数据密钥或加密状态不能直接合并。
// 旧备份不回退当前密码或丢弃历史密钥；完整预检后提交，失败和中断可回滚，加密笔记本保持锁定。
// 成功批次的原件、旧密文和密钥材料保留在工作空间 conf/data-imports 下。
var CommitDataImport = define[CommitDataImportRequest, DataImportResult]("commitDataImport", "/api/import/commitDataImport", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 取消尚未提交的 Data.zip 预检，包括过期预检；不能删除已提交批次的恢复材料。
var CancelDataImport = define[DataImportRequest, Null]("cancelDataImport", "/api/import/cancelDataImport", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 压缩包中的 Markdown 使用与 `/api/import/importStdMd` 相同的标准脚注转换规则。
// 同样遵循编辑器 mathDelimiterCompatibility 设置，默认识别 \(...\)、\[...\]。
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

// GetAssetContent 按索引记录 ID 获取完整预览；queryMethod 为 0（关键词）或 1（查询语法）时使用 FTS 高亮，
// 为 3 时按搜索使用的 Go 正则语义高亮；为 2（SQL）时不将 SQL 用作 MATCH，返回不高亮的完整内容。
// 正则无效或仅命中文件名时仍返回完整内容；内容中的 HTML 会转义，仅输出 mark/br 标记。
var GetAssetContent = define[AssetContentRequest, AssetContentData]("getAssetContent", "/api/search/getAssetContent", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var GetAssetContentByPath = define[SearchPathRequest, AssetContentData]("getAssetContentByPath", "/api/search/getAssetContentByPath", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var ListInvalidBlockRefs = define[SearchPageRequest, SearchBlocksData]("listInvalidBlockRefs", "/api/search/listInvalidBlockRefs", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var UpdateEmbedBlock = define[UpdateEmbedBlockRequest, Null]("updateEmbedBlock", "/api/search/updateEmbedBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// FullTextSearchAssetContent 使用 method 选择 0（关键词）、1（查询语法）、2（管理员 SQL）或 3（正则表达式）。
// orderBy 为 0 时优先返回相关度高的结果，为 1 时优先返回相关度低的结果；2/3 分别为更新时间升序/降序。
// 相关度按 FTS5 的 BM25 分数解释（越小越相关）；正则无 FTS 相关度，相关度排序选项按路径排序；SQL 使用自身的排序。
var FullTextSearchAssetContent = define[SearchAssetContentRequest, SearchAssetContentData]("fullTextSearchAssetContent", "/api/search/fullTextSearchAssetContent", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// GetEmbedBlock 返回的文档面包屑项可附带 documentTitle，name 保留完整路径；标题不受路径分隔符影响。
var GetEmbedBlock = define[GetEmbedBlockRequest, EmbedBlocksData]("getEmbedBlock", "/api/search/getEmbedBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// SearchEmbedBlock 返回的文档面包屑项可附带 documentTitle，供客户端按偏好显示独立标题或完整 name 路径。
var SearchEmbedBlock = define[SearchEmbedBlockRequest, EmbedBlocksData]("searchEmbedBlock", "/api/search/searchEmbedBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// method 缺省或为 null 时使用文本替换，支持文本（0）、查询语法（1）和正则表达式（3）。
// SQL（2）和语义搜索（4）返回 code=1 与提示信息，不执行替换；ids 为空时表示替换全部。
// 文本与查询语法替换的所有启用类型遵循搜索配置的 caseSensitive，替换串按字面量写入。
// 正则模式的大小写匹配由表达式决定，替换串支持捕获组展开。
// 每次文档写盘成功后清理该文档及关联跨文档撤销记录，并广播更新后的撤销状态。
// 同一文档的标题、标签及正文汇总后仅提交一次，普通和加密文档均以已认证扫描源做条件写入。
// 并发修改或删除导致 code=1，保留当前文件及其撤销记录；此前已成功提交的文档不回滚。
var FindReplace = define[FindReplaceRequest, Null]("findReplace", "/api/search/findReplace", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var SemanticSearchBlock = define[SearchBlockRequest, SearchBlocksData]("semanticSearchBlock", "/api/search/semanticSearchBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// SQL 模式保留换行、注释与字面量大小写，支持带别名的完整块投影。
// 关键字和查询语法模式下，精确块 ID 仍遵循笔记本、文档路径、类型、子类型和忽略条件。
// 关键字模式的多词文档搜索按字面量匹配 %、_ 和反斜杠；按文档分组只整理当前页，不改变分页单位。
var FullTextSearchBlock = define[FullTextSearchBlockRequest, *FullTextSearchBlockData]("fullTextSearchBlock", "/api/search/fullTextSearchBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// SearchRefBlock 的 exactDocTitle 默认关闭，保留候选搜索行为；启用后仅匹配完整文档标题，
// 先区分大小写，再忽略大小写，同级匹配按 ID 升序取一个，排除 id 和 rootID。
// 精确匹配不受全文搜索字段、类型、忽略规则或结果上限影响；未匹配时 newDoc 为 true。
// 保留发布权限、加密笔记本租约和原有响应变体，查询或文档读取失败时返回错误。
var SearchRefBlock = define[SearchRefBlockRequest, SearchRefData]("searchRefBlock", "/api/search/searchRefBlock", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

var ListLoadedPlugins = define[EmptyRequest, []*LoadedPlugin]("listLoadedPlugins", "/api/plugin/listLoadedPlugins", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")

var ListLoadedPluginsGET = define[EmptyRequest, []*LoadedPlugin]("listLoadedPluginsGET", "/api/plugin", AuthenticatedAccess, NoBody, ResponseOptions{}, "GET")

var GetLoadedPlugin = define[LoadedPluginRequest, *LoadedPlugin]("getLoadedPlugin", "/api/plugin/getLoadedPlugin", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4}}, "POST")

var GetLoadedPluginRPC = define[LoadedPluginRequest, *LoadedPlugin]("getLoadedPluginRPC", "/api/plugin/rpc", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4}}, "GET")

var GetLoadedPluginRPCByName = define[LoadedPluginRequest, *LoadedPlugin]("getLoadedPluginRPCByName", "/api/plugin/rpc/:name", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4}}, "GET")

// 实际 RPC 方法与通知在脚本执行至 Promise 完成期间保留工作空间写入租约，
// 取消 HTTP 等待者不会提前释放；准入失败沿用 -32603，通知仍不回复。
var PluginRPCHTTP = define[PluginRPCBatchRequest, PluginRPCResponse]("pluginJsonRpcHttp", "/api/plugin/rpc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Output: DirectJSONOutput, NoContent: true}, "POST")

// PluginRPCHTTPByName 与查询参数形式使用相同的逐方法写入准入规则。
var PluginRPCHTTPByName = define[PluginRPCBatchRequest, PluginRPCResponse]("pluginJsonRpcHttpByName", "/api/plugin/rpc/:name", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Output: DirectJSONOutput, NoContent: true}, "POST")

// RPC 握手保留写权限检查，但不跨空闲连接持有工作空间写入租约。实际方法与通知各自
// 取得租约；同步应用、导入提交、只读或恢复失败时不进入脚本。调用失败沿用 JSON-RPC
// 内部错误（-32603），通知仍不回复；等待者取消后，未完成的方法继续保留租约。
var PluginRPCWebSocket = define[EmptyRequest, PluginRPCFailure]("pluginJsonRpcWebSocket", "/ws/plugin/rpc", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, WebSocketOptions[PluginRPCBatchRequest, PluginRPCMessage](404), "GET")

// PluginRPCWebSocketByName 与查询参数形式使用相同的握手和逐方法写入准入规则。
var PluginRPCWebSocketByName = define[EmptyRequest, PluginRPCFailure]("pluginJsonRpcWebSocketByName", "/ws/plugin/rpc/:name", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, WebSocketOptions[PluginRPCBatchRequest, PluginRPCMessage](404), "GET")

var InstallLocalBazaarPackage = define[InstallLocalBazaarPackageRequest, BazaarLocalInstallResult]("installLocalBazaarPackage", "/api/bazaar/installLocalBazaarPackage", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")

// 取消请求会停止当前下载及后续更新；已提交的包会保留并完成运行时刷新。
var BatchUpdatePackage = define[BatchUpdatePackageRequest, Null]("batchUpdatePackage", "/api/bazaar/batchUpdatePackage", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetUpdatedPackage = define[GetUpdatedPackageRequest, BazaarUpdatedData]("getUpdatedPackage", "/api/bazaar/getUpdatedPackage", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，离线目标不回退广播。
// 请求取消会中止下载、解压及尚未提交的替换；已提交的更新不会回滚。
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

// 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；插件重载事件仍广播。
// 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
var InstallBazaarPlugin = define[InstallBazaarPluginRequest, BazaarPackagesData]("installBazaarPlugin", "/api/bazaar/installBazaarPlugin", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarPlugin = define[UninstallBazaarPluginRequest, BazaarPackagesData]("uninstallBazaarPlugin", "/api/bazaar/uninstallBazaarPlugin", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarWidget = define[GetBazaarWidgetRequest, BazaarPackagesData]("getBazaarWidget", "/api/bazaar/getBazaarWidget", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledWidget = define[GetInstalledWidgetRequest, BazaarPackagesData]("getInstalledWidget", "/api/bazaar/getInstalledWidget", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播。
// 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
var InstallBazaarWidget = define[InstallBazaarWidgetRequest, BazaarPackagesData]("installBazaarWidget", "/api/bazaar/installBazaarWidget", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarWidget = define[UninstallBazaarWidgetRequest, BazaarPackagesData]("uninstallBazaarWidget", "/api/bazaar/uninstallBazaarWidget", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarIcon = define[GetBazaarIconRequest, BazaarPackagesData]("getBazaarIcon", "/api/bazaar/getBazaarIcon", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledIcon = define[GetInstalledIconRequest, BazaarPackagesData]("getInstalledIcon", "/api/bazaar/getInstalledIcon", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；外观刷新事件仍广播。
// 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
var InstallBazaarIcon = define[InstallBazaarIconRequest, BazaarAppearancePackagesData]("installBazaarIcon", "/api/bazaar/installBazaarIcon", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarIcon = define[UninstallBazaarIconRequest, BazaarAppearancePackagesData]("uninstallBazaarIcon", "/api/bazaar/uninstallBazaarIcon", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarTemplate = define[GetBazaarTemplateRequest, BazaarPackagesData]("getBazaarTemplate", "/api/bazaar/getBazaarTemplate", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledTemplate = define[GetInstalledTemplateRequest, BazaarPackagesData]("getInstalledTemplate", "/api/bazaar/getInstalledTemplate", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播。
// 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
var InstallBazaarTemplate = define[InstallBazaarTemplateRequest, BazaarPackagesData]("installBazaarTemplate", "/api/bazaar/installBazaarTemplate", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarTemplate = define[UninstallBazaarTemplateRequest, BazaarPackagesData]("uninstallBazaarTemplate", "/api/bazaar/uninstallBazaarTemplate", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarTheme = define[GetBazaarThemeRequest, BazaarPackagesData]("getBazaarTheme", "/api/bazaar/getBazaarTheme", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledTheme = define[GetInstalledThemeRequest, BazaarPackagesData]("getInstalledTheme", "/api/bazaar/getInstalledTheme", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；外观刷新事件仍广播。
// 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
var InstallBazaarTheme = define[InstallBazaarThemeRequest, BazaarAppearancePackagesData]("installBazaarTheme", "/api/bazaar/installBazaarTheme", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarTheme = define[UninstallBazaarThemeRequest, BazaarAppearancePackagesData]("uninstallBazaarTheme", "/api/bazaar/uninstallBazaarTheme", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var SetSyncEnable = define[SyncEnabledRequest, Null]("setSyncEnable", "/api/sync/setSyncEnable", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")
var SetSyncInterval = define[SyncIntervalRequest, Null]("setSyncInterval", "/api/sync/setSyncInterval", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")
var SetSyncPerception = define[SyncEnabledRequest, Null]("setSyncPerception", "/api/sync/setSyncPerception", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")
var SetSyncLAN = define[SyncLANRequest, SyncLANStatus]("setSyncLAN", "/api/sync/setSyncLAN", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")
var GetSyncLANStatus = define[EmptyRequest, SyncLANStatus]("getSyncLANStatus", "/api/sync/getSyncLANStatus", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SetSyncGenerateConflictDoc = define[SyncEnabledRequest, Null]("setSyncGenerateConflictDoc", "/api/sync/setSyncGenerateConflictDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")
var SetSyncMode = define[SyncModeRequest, Null]("setSyncMode", "/api/sync/setSyncMode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")

// completeAssets 为 true 时，在切换来源前从原提供商下载缺失的当前资源和历史快照内容；
// 省略、null 与 false 保留只检查完整性的行为。补齐过程保留下载模式和恢复密钥，失败时保留原提供商。
// 确认后的操作通过全局进度遮罩显示检查与补齐阶段，成功或失败均关闭遮罩。
var SetSyncProvider = define[SyncProviderRequest, Null]("setSyncProvider", "/api/sync/setSyncProvider", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")
var SetSyncProviderS3 = define[SetSyncS3Request, SyncS3Data]("setSyncProviderS3", "/api/sync/setSyncProviderS3", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")

// SetSyncProviderWebDAV 保存有效的 HTTP(S) 地址；地址不能为空，省略协议时补为 HTTPS，保留协议占位符兼容。
// 用户名和密码允许为空以支持匿名访问；校验失败保留原配置，更换来源仍须补齐资源和历史快照。
var SetSyncProviderWebDAV = define[SetSyncWebDAVRequest, SyncWebDAVData]("setSyncProviderWebDAV", "/api/sync/setSyncProviderWebDAV", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")

// SetSyncProviderLocal 在解析绝对路径前拒绝空白地址，避免将其当作内核工作目录保存。
// 保留现有路径存在性及工作空间边界校验；失败不覆盖原配置，更换来源仍须补齐资源和历史快照。
var SetSyncProviderLocal = define[SetSyncLocalRequest, SyncLocalData]("setSyncProviderLocal", "/api/sync/setSyncProviderLocal", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")

// ClearSyncProviderConfig 清除 provider 为 2（S3）、3（WebDAV）或 4（本地文件系统）的配置并同步落盘。
// 清除当前服务时先验证资源及历史快照完整性，再关闭同步；失败时保留原配置，不删除本地或云端数据。
// 响应包含当前同步开关及被清除服务的默认配置；其他服务配置、仓库密钥和下载模式保持不变。
var ClearSyncProviderConfig = define[ClearSyncProviderConfigRequest, ClearSyncProviderConfigData]("clearSyncProviderConfig", "/api/sync/clearSyncProviderConfig", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")

// GetSyncProviderConfigRules 返回服务类型 2（S3）、3（WebDAV）或 4（本地文件系统）的共用必填清单。
// endpoint、bucket 可省略；仅 S3 返回 Endpoint 可能让对象键多出前缀的提示，提示不阻断保存或同步。
// 此接口只做内存中的静态判定，不读取或保存用户配置，不接收凭据，不访问云端或文件系统。
// 未知服务返回 code -1；规则提示不替代保存时的完整校验和资源来源保护。只读模式下也可调用。
var GetSyncProviderConfigRules = define[SyncProviderConfigRulesRequest, SyncProviderConfigRulesData]("getSyncProviderConfigRules", "/api/sync/getSyncProviderConfigRules", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// TestSyncProviderS3 使用请求中的候选配置探测云端：写入探针对象、按前缀列举并比对、尽力删除探针，不读取或保存用户配置。
// 请求字段与保存接口一致；缺少必填项或地址无效时同样返回 code 0，由 kind 为 config 表示，避免与网络故障混淆。
// kind 为 ok 表示写入与列举指向同一个对象键；config 表示可确定的配置错误；network 表示网络或服务端不可达，无法判定配置。
// 探测会在桶内创建再删除 repo/objects/.s/siyuan-probe-<随机值>-probe，需要该前缀的写入与列举权限；未删除的探针会作为未引用对象被云端清理回收。
// 只读模式下也可调用，不修改已有快照或同步开关。
var TestSyncProviderS3 = define[TestSyncProviderS3Request, TestSyncProviderS3Data]("testSyncProviderS3", "/api/sync/testSyncProviderS3", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// TestSyncProviderWebDAV 只探测候选配置：验证端点为集合，创建独占探针目录并写入、读回比对，最后尽力删除。
// 不读取或保存同步配置，不修改快照或同步开关；只读模式可调用。kind 沿用 S3 的 ok/config/network 语义。
// cloudName 可省略；指定时在该云端目录的 siyuan/repo 下探测，省略时使用独占的随机云端目录并尽力删除。
// 上传失败后同样尝试清理；删除失败只记脱敏日志，不改变探测结果。需要集合查询、目录创建、读写和删除权限。
var TestSyncProviderWebDAV = define[TestSyncProviderWebDAVRequest, TestSyncProviderS3Data]("testSyncProviderWebDAV", "/api/sync/testSyncProviderWebDAV", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// TestSyncProviderLocal 只探测候选配置：端点必须是已有目录且不能与工作空间重叠。
// 在独占临时目录中写入、读回比对并尽力删除探针，不读取或保存同步配置；kind 沿用 S3 的 ok/config/network 语义。
// 只读模式可调用，不修改快照或同步开关。删除失败只记脱敏日志，不改变探测结果。
var TestSyncProviderLocal = define[TestSyncProviderLocalRequest, TestSyncProviderS3Data]("testSyncProviderLocal", "/api/sync/testSyncProviderLocal", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var SetCloudSyncDir = define[SyncNameRequest, Null]("setCloudSyncDir", "/api/sync/setCloudSyncDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")
var SetSyncAssetDownloadMode = define[SyncModeRequest, SyncAssetDownloadModeData]("setSyncAssetDownloadMode", "/api/sync/setSyncAssetDownloadMode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync"}}, "POST")
var CreateCloudSyncDir = define[SyncNameRequest, Null]("createCloudSyncDir", "/api/sync/createCloudSyncDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveCloudSyncDir = define[SyncNameRequest, string]("removeCloudSyncDir", "/api/sync/removeCloudSyncDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "sync", Mode: SettingSelfManaged}}, "POST")
var ListCloudSyncDir = define[EmptyRequest, CloudSyncDirsData]("listCloudSyncDir", "/api/sync/listCloudSyncDir", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var PerformSync = define[PerformSyncRequest, Null]("performSync", "/api/sync/performSync", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// CancelSyncCheckout 请求取消当前文件恢复任务，taskID 必须来自当前 syncProgress 消息。
// requested 只表示已接受取消请求，旧任务或已完成任务返回 false；可能先完成恢复，再收到请求。
// 取消同时传递到准备、云端请求和文件替换边界，保留已完成文件并清理当前临时文件。
// 解除界面编辑阻挡前同步已落盘变更的索引；不回滚已完成文件，不改变全部下载或按需下载设置。
// 只读模式可请求取消，不会更改同步配置；调用要求登录和管理员权限。
var CancelSyncCheckout = define[CancelSyncCheckoutRequest, CancelSyncCheckoutData]("cancelSyncCheckout", "/api/sync/cancelSyncCheckout", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// GetSyncCheckout 查询当前同步任务及单调递增版本，空任务表示当前没有同步任务。
// 普通后台同步不阻断编辑；准备落盘、应用改动和恢复索引期间 blocking 为 true。
// 前端启动和重连时查询，以恢复错过的开始、取消或结束通知；appID 和 clientID 用于匹配当前主连接的准备令牌。
// phase 为 preparing 时先阻止新输入、提交既有编辑，再使用 token 确认保存结果；取消不计入自动同步失败。
var GetSyncCheckout = define[SyncCheckoutClientRequest, SyncCheckoutSnapshot]("getSyncCheckout", "/api/sync/getSyncCheckout", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// ConfirmSyncCheckout 确认当前连接已停止新输入并提交既有编辑，saved 为 false 时本轮应用中止。
// token 仅来自该连接的 syncProgress 消息或状态查询，重复确认幂等，旧任务和未知令牌返回 requested 为 false。
// 必须确认全部既有连接，且等待期间没有新接入的连接，内核才会应用本地改动。
var ConfirmSyncCheckout = define[ConfirmSyncCheckoutRequest, CancelSyncCheckoutData]("confirmSyncCheckout", "/api/sync/confirmSyncCheckout", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var PerformBootSync = define[EmptyRequest, Null]("performBootSync", "/api/sync/performBootSync", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBootSync = define[EmptyRequest, Null]("getBootSync", "/api/sync/getBootSync", AuthenticatedAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetSyncInfo = define[EmptyRequest, SyncInfoData]("getSyncInfo", "/api/sync/getSyncInfo", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var ExportSyncProviderS3 = define[EmptyRequest, SyncProviderExportData]("exportSyncProviderS3", "/api/sync/exportSyncProviderS3", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var ImportSyncProviderS3 = define[SyncProviderImportRequest, SyncS3Data]("importSyncProviderS3", "/api/sync/importSyncProviderS3", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{DataOnError: true, Setting: SettingWrite{Namespace: "sync"}}, "POST")
var ExportSyncProviderWebDAV = define[EmptyRequest, SyncProviderExportData]("exportSyncProviderWebDAV", "/api/sync/exportSyncProviderWebDAV", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// ImportSyncProviderWebDAV 导入后使用与保存接口相同的地址校验；空白或无效地址不覆盖原配置。
var ImportSyncProviderWebDAV = define[SyncProviderImportRequest, SyncWebDAVData]("importSyncProviderWebDAV", "/api/sync/importSyncProviderWebDAV", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{DataOnError: true, Setting: SettingWrite{Namespace: "sync"}}, "POST")

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

// RemoveRiffCards waits for the document and deck transaction; persistence or
// commit failures return code -1 with null data. Empty deckID removes from all decks.
var RemoveRiffCards = define[RiffDeckCardsRequest, *RiffDeck]("removeRiffCards", "/api/riff/removeRiffCards", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// AddRiffCards waits for the document and deck transaction; persistence or commit
// failures return code -1 with null data instead of reporting an unsaved deck.
var AddRiffCards = define[RiffDeckCardsRequest, *RiffDeck]("addRiffCards", "/api/riff/addRiffCards", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RenameRiffDeck = define[RenameRiffDeckRequest, Null]("renameRiffDeck", "/api/riff/renameRiffDeck", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveRiffDeck = define[RiffDeckRequest, Null]("removeRiffDeck", "/api/riff/removeRiffDeck", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var CreateRiffDeck = define[CreateRiffDeckRequest, *RiffDeck]("createRiffDeck", "/api/riff/createRiffDeck", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetRiffDecks = define[EmptyRequest, []*RiffDeck]("getRiffDecks", "/api/riff/getRiffDecks", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{NonNullable: true}, "POST")

var SetRepoIndexRetentionDays = define[SetRepoIndexRetentionDaysRequest, Null]("setRepoIndexRetentionDays", "/api/repo/setRepoIndexRetentionDays", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "repo"}}, "POST")
var SetRetentionIndexesDaily = define[SetRetentionIndexesDailyRequest, Null]("setRetentionIndexesDaily", "/api/repo/setRetentionIndexesDaily", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "repo"}}, "POST")
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

// GetDocPaths 在指定笔记本内按文档 ID 读取结构化祖先链，要求管理员权限，加密响应保留操作租约。
// ids 必须包含 1 至 128 项，按首次出现顺序去重；缺失、其他笔记本或内容块身份列入 missingIDs。
// 文档标题、segments 与 revision 来自同一快照，displayPath 仅用于显示，不能反向解析身份。
// 索引未就绪返回 indexUnavailable，源格式和认证错误不能伪装成缺失；批量结果不承诺全局快照。
var GetDocPaths = define[GetDocPathsRequest, DocumentPathsResult]("getDocPaths", "/api/filetree/getDocPaths", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

// ResolveDocPath 从显式根位置或父文档 ID 逐级精确匹配 0 至 128 个非空标题段，只解析不创建。
// 标题不作 Unicode 归一化、宽窄转换或百分号解码；同父同名返回 ambiguous，不任取候选。
// candidates 按 ID 排序且最多 128 项，candidatesTruncated 标记截断；nameConditions 保留唯一及缺失条件。
// 空段数组返回起点，根位置的 resolved 为 null，start.id 为 null；笔记本文档 ID 规范化为逻辑根。
// 索引未就绪返回 indexUnavailable；标题段保留字面 /，不按笔记本选择不同的寻址模式。
var ResolveDocPath = define[ResolveDocPathRequest, ResolveDocPathResult]("resolveDocPath", "/api/filetree/resolveDocPath", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

// CreateDocByParent 在显式父文档 ID 或 null 根位置创建固定 ID 文档，不接收 path/hPath 或名称回退。
// title.format 首版只接受 plain，text 可为空；无效字符、超长标题及不支持的格式原样拒绝，不截断或清洗。
// 可选父路径 revision 与至多 128 项名称条件在源提交前分别校验；条件只能涉及目标祖先和最终父级。
// ID 冲突不覆盖、不自动更换；错误 data 包含稳定 reason、commitState、阶段及已完成步骤。
// 已落盘但排序或正文模板失败时保留源文档并返回其 ID，调用方不得把该错误当作未创建而重复提交。
// 保留标题中的 /，新写入含斜杠标题使用 Spec 6；普通文档不统一升级规格。
// 加密笔记本使用原有认证写入与响应租约；寻址规则不改变密文格式或密钥材料。
var CreateDocByParent = define[CreateDocByParentRequest, CreateDocByParentResult]("createDocByParent", "/api/filetree/createDocByParent", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{DataOnError: true}, "POST")

// GetDocCreateTarget 返回指定用途的有效目标及正文模板，不渲染模板、不猜测上下文或日期。
// version=1 保留旧路径语法；version=2 独立保存祖先和标题段。revision 覆盖生效配置及继承来源，
// 由配置创建时传回 expectedTarget，配置变化即返回 planChanged。读取需管理员及源笔记本操作租约。
var GetDocCreateTarget = define[GetDocCreateTargetRequest, DocumentCreateTargetData]("getDocCreateTarget", "/api/filetree/getDocCreateTarget", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// PlanDocCreate 只读编译有效创建目标，同一次计划使用相同时间，日期可指定为 YYYY-MM-DD。
// contextID 是源笔记本内的文档，child 使用该位置，configured 使用配置目标；title 可显式替换最终标题。
// 调用方提前保存最终 id，返回步骤已分配全部祖先 ID。按顺序向 createDocByParent 提交，不承诺跨文件原子性。
// reuse 仅用于明确允许复用的业务。existingID 非空时不创建；普通新建应保持 reuse=false。
// 上一步创建父文档后，将其返回的 revision 传为下一步 expectedParentRevision；错误或响应丢失时保留计划核对 ID。
var PlanDocCreate = define[PlanDocCreateRequest, DocumentCreatePlan]("planDocCreate", "/api/filetree/planDocCreate", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetPathByID = define[FileTreeTrimIDRequest, FileTreeDocPathData]("getPathByID", "/api/filetree/getPathByID", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetFullHPathByID = define[FileTreeOptionalIDRequest, *string]("getFullHPathByID", "/api/filetree/getFullHPathByID", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// GetIDsByHPath queries exact legacy display paths and verifies each candidate's real ancestor chain.
// Clean candidates have nonempty titles without ASCII / and no empty-title flag at every level.
// Returns every clean ID, an empty array for no matches, pathAmbiguous for mixed candidates,
// or legacyPathUnsupported for unsupported candidates only. Error data may include cleanIDs and
// unsupportedIDs, filtered by existing access restrictions. Missing, pending, inconsistent or failed
// metadata returns indexUnavailable. Prefer resolveDocPath with independent title segments.
var GetIDsByHPath = define[FileTreeOptionalPathRequest, LegacyPathIDsResult]("getIDsByHPath", "/api/filetree/getIDsByHPath", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

// MoveDocs evaluates block collection rules for moved documents and descendants entering a watched scope.
// Existing database rows and their field values are preserved. A collection failure is returned after the
// physical move; successfully moved documents remain at their new locations.
var MoveDocs = define[FileTreeMoveRequest, Null]("moveDocs", "/api/filetree/moveDocs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// MoveDocsByID has the same collection and partial-failure behavior as MoveDocs.
var MoveDocsByID = define[FileTreeMoveIDsRequest, Null]("moveDocsByID", "/api/filetree/moveDocsByID", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveDoc = define[FileTreePathRequest, Null]("removeDoc", "/api/filetree/removeDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveDocByID = define[FileTreeTrimIDRequest, Null]("removeDocByID", "/api/filetree/removeDocByID", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveDocs = define[FileTreePathsRequest, Null]("removeDocs", "/api/filetree/removeDocs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RenameDoc = define[FileTreeRenameRequest, Null]("renameDoc", "/api/filetree/renameDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RenameDocByID = define[FileTreeRenameIDRequest, Null]("renameDocByID", "/api/filetree/renameDocByID", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// DuplicateDoc evaluates block collection rules for the new document and its blocks, initializing only new rows.
var DuplicateDoc = define[FileTreeIDRequest, FileTreeDuplicateData]("duplicateDoc", "/api/filetree/duplicateDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 将单篇文档及全部子文档复制到同一笔记本的原父目录，返回副本根文档的 id、notebook、path 和 hPath。
// 为副本文档和块执行块收集规则，仅初始化新行。
// 副本内部块引用、块链接和查询嵌入的显式块 ID 统一重映射，数据库定义与行绑定保持为共享镜像。
// 源快照经过认证读取且不执行修复写回；运行期失败时清理新建文档并恢复排序，属运行时补偿，
// 不保证进程崩溃时的事务原子性。
var DuplicateDocTree = define[FileTreeIDRequest, FileTreeDuplicateData]("duplicateDocTree", "/api/filetree/duplicateDocTree", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var CreateDoc = define[FileTreeCreateRequest, FileTreeCreateData]("createDoc", "/api/filetree/createDoc", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// CreateDailyNote 省略 date、传空串或 null 时，按当天的命名和路径模板复用或创建，与日记按钮、快捷键一致。
// 显式指定日期（包括今天）时，先按目标笔记本的日记日期属性复用，改名或移动后仍可找到原日记。
// 多个日期匹配优先选择模板目标，否则按 ID 升序选择；无日期匹配时再复用或创建模板目标。
// 两种入口复用已有文档均不重新应用正文模板；普通入口补建模板目标后，日期入口可能改为优先选择该目标。
var CreateDailyNote = define[FileTreeDailyNoteRequest, FileTreeCreateData]("createDailyNote", "/api/filetree/createDailyNote", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// GetDailyNoteInfo 按日期属性预览日记，不创建文档；省略 date、传空串或 null 时查询当天。
// 多个日期匹配优先选择模板目标，否则按 ID 升序选择；无日期匹配时再检查模板目标。
var GetDailyNoteInfo = define[DailyNoteInfoRequest, *DailyNoteInfo]("getDailyNoteInfo", "/api/filetree/getDailyNoteInfo", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// 使用编辑器 Markdown 语法选项，并按 `/api/import/importStdMd` 的规则转换标准脚注。
// 转义的脚注语法保留为字面文本；返回创建的文档 ID，访问受笔记本权限限制。
// Every parent prefix is checked before writing; slash/empty-title candidates return pathAmbiguous.
// Multiple clean parents also return pathAmbiguous unless a valid matching parentID selects their
// real ancestor chain. An ID cannot bypass unsupported candidates. Unready or inconsistent metadata
// returns indexUnavailable. Prefer createDocByParent with a separate parent identity and title.
var CreateDocWithMd = define[FileTreeCreateMarkdownRequest, LegacyPathDocumentResult]("createDocWithMd", "/api/filetree/createDocWithMd", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

// 旧模板保持既有渲染及回退；对应的新目标对象生效时返回 structuredTemplateRequired，不读取历史路径。
var GetDocCreateSavePath = define[FileTreeNotebookRequest, FileTreeCreateSavePathResult]("getDocCreateSavePath", "/api/filetree/getDocCreateSavePath", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var GetRefCreateSavePath = define[FileTreeNotebookRequest, FileTreeSavePathResult]("getRefCreateSavePath", "/api/filetree/getRefCreateSavePath", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var GetShorthandSavePath = define[FileTreeNotebookRequest, FileTreeSavePathData]("getShorthandSavePath", "/api/filetree/getShorthandSavePath", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var ChangeSort = define[FileTreeChangeSortRequest, Null]("changeSort", "/api/filetree/changeSort", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ReorderDocs = define[FileTreeReorderRequest, *FileTreeReorderData]("reorderDocs", "/api/filetree/reorderDocs", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{DataOnError: true}, "POST")
var SetSort = define[FileTreeSetSortRequest, *FileTreeSetSortData]("setSort", "/api/filetree/setSort", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{DataOnError: true}, "POST")
var SetDocSortMode = define[FileTreeSortModeRequest, *FileTreeSortModeData]("setDocSortMode", "/api/filetree/setDocSortMode", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{DataOnError: true}, "POST")

// SearchDocs 保留兼容展示 hPath，并单独返回文档或笔记本的纯文本 title；客户端不能从 hPath 拆出标题或层级。
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

// Markdown 导出按各文档的标题编号开关和编辑器编号格式添加编号，不修改源文档。
var ExportNotebookMd = define[ExportNotebookMarkdownRequest, ExportNamedZipData]("exportNotebookMd", "/api/export/exportNotebookMd", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// Markdown 导出按各文档的标题编号开关和编辑器编号格式添加编号，不修改源文档。
var ExportNotebooksMd = define[ExportNotebooksMarkdownRequest, ExportNamedZipData]("exportNotebooksMd", "/api/export/exportNotebooksMd", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// Markdown 导出按各文档的标题编号开关和编辑器编号格式添加编号，不修改源文档。
var ExportMds = define[ExportDocumentsMarkdownRequest, ExportNamedZipData]("exportMds", "/api/export/exportMds", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// Markdown 导出按文档标题编号开关和编辑器编号格式添加编号，不修改源文档。
var ExportMd = define[ExportMarkdownRequest, ExportNamedZipData]("exportMd", "/api/export/exportMd", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportNotebookSY = define[ExportIDRequest, ExportZipData]("exportNotebookSY", "/api/export/exportNotebookSY", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportNotebooksSY = define[ExportNotebooksRequest, ExportZipData]("exportNotebooksSY", "/api/export/exportNotebooksSY", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportSYs = define[ExportIDsRequest, ExportZipData]("exportSYs", "/api/export/exportSYs", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportSY = define[ExportIDRequest, ExportZipData]("exportSY", "/api/export/exportSY", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// Markdown 内容按文档标题编号开关和编辑器编号格式添加编号，局部导出保留原文档编号。
var ExportMdContent = define[ExportMarkdownContentRequest, ExportMarkdownContentData]("exportMdContent", "/api/export/exportMdContent", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportDocx = define[ExportDocxRequest, ExportPathData]("exportDocx", "/api/export/exportDocx", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportMdHTML = define[ExportMarkdownHTMLRequest, ExportHTMLData]("exportMdHTML", "/api/export/exportMdHTML", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportTempContent = define[ExportTempContentRequest, ExportURLData]("exportTempContent", "/api/export/exportTempContent", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportBrowserHTML = define[ExportBrowserHTMLRequest, ExportZipData]("exportBrowserHTML", "/api/export/exportBrowserHTML", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 导出图片或 PDF 预览时，可选的 keepJSEmbed: true 保留脚本嵌入占位，默认不保留。
// 内核不执行脚本；调用方须遵守安全模式限制，并等待异步渲染完成后再导出。
// image=true 或 pdf=true 时可用 excludeTitleImage=true 排除题头图；省略、null 或 false 保留，独立于 addTitle。
// 未指定图片或 PDF 模式时忽略 excludeTitleImage；原始文档、正文图片及加密笔记本读取授权不受影响。
var ExportPreviewHTML = define[ExportPreviewHTMLRequest, ExportPreviewHTMLData]("exportPreviewHTML", "/api/export/exportPreviewHTML", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportHTML = define[ExportHTMLRequest, ExportHTMLData]("exportHTML", "/api/export/exportHTML", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// exportAssets=true 时仅复制 PDF 实际资源链接需要的外部文件，同名文件另存并更新链接，不覆盖已有文件。
// removeAssets=true 时把链接目标嵌入为附件，不在输出目录复制或清理资源；页面图片不额外复制。
// exportAssets 省略、null 或 false 保持已有处理方式；启用时保留加密笔记本读取租约，禁止写入加密目录。
// 启用时 path 必须为绝对路径，资源读取或 PDF 写入失败会报错，并撤销本次新建的外部资源文件。
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

// FullReindexAssetContent 提交异步重建任务，成功响应只代表任务已提交，不代表索引已经完成。
// 重建遍历及最后一批索引写入成功后，通过主 WebSocket 发送 assetContentIndexCompleted 并提示完成；
// 遍历或写入失败时提示失败，不发送完成事件。不支持或解析失败的文件会跳过，加密资源不进入全局索引。
var FullReindexAssetContent = define[EmptyRequest, Null]("fullReindexAssetContent", "/api/asset/fullReindexAssetContent", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

// GetImageOCRText 保留已有 text 字段；无文本、缺失 path 和加密资源返回空字符串。
// failed 来自实际识别失败，不由空文本推断；取消和不支持的图片不记为失败。
// 失败状态仅在当前内核运行期间保留最近 1024 个资源，成功识别或保存文本后清除，不写入 OCR 数据文件。
// 加密资源始终返回 failed=false；笔记本资源身份保留 box 参数，显示参数和片段不改变状态身份。
var GetImageOCRText = define[AssetOCRTextRequest, ImageOCRTextData]("getImageOCRText", "/api/asset/getImageOCRText", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
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
var SetOCRConfig = define[SettingOCR, SettingOCR]("setOCRConfig", "/api/asset/setOCRConfig", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "ocr", Merge: true}}, "POST")
var ImportOCRModels = define[ImportOCRModelsRequest, OCRModel]("importOCRModels", "/api/asset/importOCRModels", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// 重命名普通笔记本资源，并同步字面量及百分号编码的文档、数据库引用。
// 引用及成功返回的 data.newPath 保留查询参数和片段；源资源解析失败返回 code=-1 和 5000 毫秒错误提示。
// 拒绝加密笔记本资源重命名；空名称或与原文件名相同的名称返回 code=0、data.newPath=""。
var RenameAsset = define[RenameAssetRequest, AssetRenameData]("renameAsset", "/api/asset/renameAsset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var FindAssetReferences = define[FindAssetReferencesRequest, AssetReferencesData]("findAssetReferences", "/api/asset/findAssetReferences", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")

// 实际重链接成功写盘后清理文档及关联跨文档撤销记录；预览和写入失败不清理历史。
var RelinkAsset = define[RelinkAssetRequest, AssetReferencesData]("relinkAsset", "/api/asset/relinkAsset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var GetDocImageAssets = define[AssetDocumentRequest, []string]("getDocImageAssets", "/api/asset/getDocImageAssets", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// 返回文档图片及各自关联的实况照片原始视频；保留图片顺序，不合并相同封面。
var GetDocPreviewImages = define[AssetDocumentRequest, []DocumentPreviewImage]("getDocPreviewImages", "/api/asset/getDocPreviewImages", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// 按需生成 H.264/AAC 兼容预览，不修改原件，不同步缓存；输入限制为 64 MiB、十秒、600 帧和 4096×2160 像素。
// path 为相对资源 URL，路径中的百分号编码只解码一次，box 等查询参数保持原有资源解析语义。
// 普通资源的真实路径必须位于对应 assets 目录内；加密资源沿用 box 边界校验与解锁租约。
// 支持 SDR HEVC 4:2:0（8/10 位）或 AVC，以及 AAC 或 44.1/48 kHz 单声道、双声道整数 PCM。
// clientEncode 为 true 且 encode 为 true 时，调用方顺序读取帧并提交 Annex B 编码；否则直接读取预览。
// 客户端编码只对管理员开放，其他角色由内核生成预览，不能提交共享缓存内容。
// 会话五分钟内有效，编码任务两分钟超时；加密笔记本只使用内存，锁定时取消任务、清除会话与缓存。
var StartLivePhotoPreview = define[StartLivePhotoPreviewRequest, LivePhotoPreviewSession]("startLivePhotoPreview", "/api/asset/startLivePhotoPreview", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// 顺序读取零起始的 I420 帧，响应为 no-store 的二进制；错误返回 HTTP 422 的标准 JSON 信封。
var GetLivePhotoFrame = define[LivePhotoFrameRequest, BinaryContent]("getLivePhotoFrame", "/api/asset/getLivePhotoFrame", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 422}, "POST")

// 提交大端 uint32 帧数，随后逐帧提交大端 uint32 长度及 Annex B 数据；最多 64 MiB，帧数和尺寸必须匹配源片。
// 验证并等待 MP4 封装完成后返回；失败结果不能进入共享缓存。
var FinishLivePhotoPreview = define[FinishLivePhotoPreviewRequest, Null]("finishLivePhotoPreview", "/api/asset/finishLivePhotoPreview", AuthenticatedAccess|AdminAccess, MultipartBody, ResponseOptions{}, "POST")

// 等待并读取 MP4 兼容预览，响应为 no-store 的二进制；错误返回 HTTP 422 的标准 JSON 信封。
var GetLivePhotoPreview = define[LivePhotoPreviewRequest, BinaryContent]("getLivePhotoPreview", "/api/asset/getLivePhotoPreview", AuthenticatedAccess, JSONBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 422}, "POST")

// 取消会话并释放在途转换资源，已完成的缓存仍可在下一次播放时复用。
var CancelLivePhotoPreview = define[LivePhotoPreviewRequest, Null]("cancelLivePhotoPreview", "/api/asset/cancelLivePhotoPreview", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetDocAssets = define[AssetDocumentAssetsRequest, []string]("getDocAssets", "/api/asset/getDocAssets", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

// 保存 PDF 标注映射。省略 baseData 或传 null 保持旧版整份替换语义。
// 提供 baseData 时，将 data 相对该读取基线的逐条变化合并到当前映射，保留其他查看器对不同标注的修改。
// 同一标注已被不同内容修改或删除时返回 -1 / "annotation revision conflict"，不写入文件；重复的相同结果可成功。
// 基线和 data 必须为 JSON 对象字符串；加密笔记本先认证当前密文，租约和文件格式保持不变。
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
// keyword 可省略、为 null 或空白；非空时按完整文件名进行不区分大小写的字面量包含匹配。
// 完整未引用扫描后先筛选再截断，最多返回 512 项；空请求体按截断返回。
// all 为 true 时返回完整清单且不发送截断提示，供前端在当前面板内过滤；省略、null 或 false 保留截断行为。
// 可选请求头 X-SiYuan-App-ID 将截断提示限定到对应前端，未提供时保留广播行为。
var GetUnusedAssets = define[UnusedAssetsRequest, []*AssetUnusedItem]("getUnusedAssets", "/api/asset/getUnusedAssets", AuthenticatedAccess|AdminAccess, LegacyOptionalBody, ResponseOptions{}, "POST")

// GetUnusedEncryptedBoxAssets 扫描单个已解锁加密笔记本的文档、全部数据库定义及智能体会话引用。
// 任意扫描失败返回 -1，不返回不完整候选。锁定目标使用既有 314 语言消息；结果不截断。
// name 为响应期间可见的原始文件名，item 为 assets 相对路径，path 带目标 box 查询参数。
var GetUnusedEncryptedBoxAssets = define[EncryptedBoxAssetsRequest, []*AssetUnusedItem]("getUnusedEncryptedBoxAssets", "/api/asset/getUnusedEncryptedBoxAssets", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// RemoveUnusedEncryptedBoxAssets 重新验证用户确认的候选，备份认证后的原始密文后整批删除。
// 失败补偿恢复源文件，未提交的中断批次在启动同步前恢复；清理历史只索引脱敏元数据。
// 不改变现有全局清理行为，不修改加密格式，不生成全局资源索引或明文缓存。
var RemoveUnusedEncryptedBoxAssets = define[RemoveEncryptedBoxAssetsRequest, AssetPathsData]("removeUnusedEncryptedBoxAssets", "/api/asset/removeUnusedEncryptedBoxAssets", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// GetMissingAssets 扫描已打开笔记本中的丢失资源，成功时返回列表（无丢失资源时为空数组）。
// 资源清单读取、笔记本枚举、目录遍历失败或 panic 时返回 code -1、data null。
// 单篇文档无法读取时继续扫描其他文档，最终也返回 code -1，msg 包含被跳过的路径，不发布不完整的列表。
// 保留管理员鉴权和加密笔记本请求租约，不改变资源存在性判定或任何持久化格式。
var GetMissingAssets = define[EmptyRequest, []*AssetUnusedItem]("getMissingAssets", "/api/asset/getMissingAssets", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// ResolveAssetPath 返回普通资源路径；已解锁的加密资源返回保留原始名称的受管临时明文副本路径。
// 请求持有加密笔记本租约直至响应序列化完成，外部编辑不写回加密源数据。
var ResolveAssetPath = define[AssetPathRequest, string]("resolveAssetPath", "/api/asset/resolveAssetPath", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 上传提示生命周期使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，状态栏仍全局更新。
var AssetUploadCloud = define[AssetCloudUploadRequest, Null]("uploadCloud", "/api/asset/uploadCloud", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 上传提示生命周期使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，保留 ignorePushMsg 语义。
var AssetUploadCloudByAssetsPaths = define[AssetPathsCloudUploadRequest, Null]("uploadCloudByAssetsPaths", "/api/asset/uploadCloudByAssetsPaths", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var InsertLocalAssets = define[InsertLocalAssetsRequest, AssetUploadData]("insertLocalAssets", "/api/asset/insertLocalAssets", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var InsertCover = define[InsertCoverRequest, AssetInsertCoverData]("insertCover", "/api/asset/insertCover", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var UploadAsset = define[UploadAssetRequest, AssetUploadData]("uploadAsset", "/api/asset/upload", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

var SetConfSnippet = define[SetConfSnippetRequest, *SettingSnpt]("setConfSnippet", "/api/setting/setSnippet", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "snippet", Merge: true}}, "POST")
var SetBazaar = define[SetBazaarRequest, *SettingBazaar]("setBazaar", "/api/setting/setBazaar", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "bazaar", Merge: true}}, "POST")

// SetAI 使用共享规范化规则；智能体确认超时负数回退 600 秒，0 保留无限等待语义。
// web 初始搜索为 Exa、抓取为直接请求，可独立切换到共用密钥的 DeepSeek。
// 工具调用轮数和输出 token 上限的负数归零；温度超出 0–2 回退 1。
// 嵌入并发数和批大小省略、null 或小于 1 时分别使用 8 和 10，超过上限时分别限制为 64 和 128。
// 旧客户端的平铺 decision.endpoint、apiKey、name、timeout 迁移到 profiles.typesafe；提交 profiles 时以该对象为准。
// ChatGPT 账户绑定变化时与主配置一起可恢复提交，失败时回滚且不发布新配置；未变化时不访问绑定存储。
var SetAI = define[SetAIRequest, *SettingAI]("setAI", "/api/setting/setAI", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "ai", Merge: true}}, "POST")
var SetSecrets = define[SetSecretsRequest, *SettingSecrets]("setSecrets", "/api/setting/setSecrets", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "secrets", Merge: true}}, "POST")
var SetVariables = define[SetVariablesRequest, *SettingVariables]("setVariables", "/api/setting/setVariables", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "variables", Merge: true}}, "POST")

// SetFlashcard 使用与启动、导入相同的规范化规则；保留零张上限，非法记忆参数和权重恢复默认值。
// reviewMode 仅接受 0、1、2，越界值回退 0。
var SetFlashcard = define[SetFlashcardRequest, *SettingFlashcard]("setFlashcard", "/api/setting/setFlashcard", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "flashcard", Merge: true}}, "POST")

// SetEditor 使用与启动、导入相同的规范化规则并同步保存。
// 锚文本长度 1–5120 保持不变，小于 1 回退 64；字体大小超出 9–72 回退 16。
// backlinkGlobalSort、backlinkBlockSort、floatWindowMode、headingEmbedMode 仅接受 0、1、2，越界值回退 0。
// databaseAttrClickMode、databaseAttrViewMode 仅接受 0、1；codeTabSpaces 仅接受 0、2、4、6、8，越界值回退 0。
// 只提交 fontFamily、fontWeight 时按新的首选字体重建 fontFamilies；显式提交 fontFamilies 时以该列表为准。
var SetEditor = define[SetEditorRequest, *SettingEditor]("setEditor", "/api/setting/setEditor", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "editor", Merge: true}}, "POST")

// PatchSetting 保留省略字段，成功后客户端重新读取配置；通知不包含密码或密钥。
// export.blockRefMode 的旧值 0、1、5 按旧设置接口的兼容语义转换为 4；启动迁移由配置版本控制。
// 同步地址沿用专用保存接口的校验，更换来源须保留完整资源检查，间隔使用规范化后的值调度。
// 存在字段诊断时在 data.issues 返回；error 阻止写入，warning 随已规范化的成功结果返回。
// 编辑器、导出、搜索、文档树、外观、闪卡和智能体字段使用对应设置接口的范围规范化规则。
// system.autoLaunch2 仅接受 0、1、2，lockScreenMode 仅接受 0、1，越界值回退 0。
// sync.assetDownloadMode 的非法值仍拒绝写入；repo.indexRetentionDays 的正值不设上限。
var PatchSetting = define[PatchSettingRequest, *SettingPatchData]("patchSetting", "/api/setting/patch", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true, Setting: SettingWrite{Namespace: "*", Mode: SettingSelfManaged}}, "POST")

// SetExport 合并提交的导出配置，将 blockRefMode 的废弃值 0、1、5 转换为 4 后同步保存并回显。
// blockEmbedMode 仅接受 0、1，越界值回退 1；fileAnnotationRefMode 仅接受 0、1，越界值回退 0。
// blockRefMode 的其他取值原样保留；省略的字段保持当前值，null 还原默认值。
var SetExport = define[SetExportRequest, *SettingExport]("setExport", "/api/setting/setExport", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "export", Merge: true}}, "POST")

// SetFiletree 使用与启动、导入相同的路径和数值规范化规则。
// maxListCount 小于 1 回退 512，largeFileWarningSize 小于 2 回退 8，两者大于 10240 时截断至 10240。
var SetFiletree = define[SetFiletreeRequest, *SettingFileTree]("setFiletree", "/api/setting/setFiletree", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "fileTree", Merge: true}}, "POST")

// SetSearch 使用与启动、导入相同的规范化规则；limit 小于 1 回退 64，1–31 提升至 32，大于 10240 时截断至 10240。
// 反链提及关键词上限小于 1 回退 512。
var SetSearch = define[SetSearchRequest, *SettingSearch]("setSearch", "/api/setting/setSearch", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "search", Merge: true}}, "POST")

// SetAppearance 限定关闭按钮行为：closeButtonBehavior 仅接受 0、1，越界值回退 0。
// entryVisibility 省略时保持当前方案，null 还原默认显隐方案。
var SetAppearance = define[SetAppearanceRequest, *SettingAppearance]("setAppearance", "/api/setting/setAppearance", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "appearance", Merge: true}}, "POST")

// SetEntryVisibility 的版本 7 方案可用 defaults 指定 simple 或 full，未覆盖的显隐跟随该内置方案。
// 省略 defaults 的方案及旧版本方案保留独立显隐语义；entries 中的布尔值始终优先，未知入口和插件排序保留。
var SetEntryVisibility = define[SetEntryVisibilityRequest, *SettingEntryVisibility]("setEntryVisibility", "/api/setting/setEntryVisibility", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "appearance"}}, "POST")

// SetPublish 认证账户须提交完整数组，传 null 或空数组表示清空账户。
var SetPublish = define[SetPublishRequest, SettingPublishData]("setPublish", "/api/setting/setPublish", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "publish", Merge: true}}, "POST")

// GetSettingSection 读取单个配置段，字段与脱敏规则与 /api/system/getConf 一致，仅返回请求的配置段以减少传输量。
// namespace 必须是已注册的配置段；需要完整配置的启动和重连场景仍使用 /api/system/getConf。
var GetSettingSection = define[SettingGetSectionRequest, SettingSectionData]("getSettingSection", "/api/setting/getSection", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

var GetBootAppearances = define[EmptyRequest, SettingBootAppearancesData]("getBootAppearances", "/api/setting/getBootAppearances", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SetBootAppearance = define[SettingBootAppearanceRequest, *SettingBootAppearanceSelection]("setBootAppearance", "/api/setting/setBootAppearance", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "appearance", Mode: SettingSilent}}, "POST")
var SetBazaarPetalDisabled = define[SettingPetalDisabledRequest, SettingPetalDisabledData]("setBazaarPetalDisabled", "/api/setting/setBazaarPetalDisabled", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "bazaar"}}, "POST")

// SetKeymap 整体替换快捷键配置：data 必须提交完整的快捷键对象，只提交部分分组会清空未提交的快捷键。
// 单条快捷键请使用 /api/setting/patch 的 keymap 命名空间，该接口按对象递归合并。
var SetKeymap = define[SettingKeymapRequest, Null]("setKeymap", "/api/setting/setKeymap", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "keymap"}}, "POST")

// 接收可选的 exit（默认 false），要求管理员权限并禁止只读写入。
// 仅重置当前工作空间的普通偏好、内置快捷键和当前布局；保留笔记、历史、历史保留天数、学习进度、
// 账号、认证、同步、加密及恢复材料、AI/MCP、插件和代码片段及其启用状态、已保存布局、语言及应用级设置。
// 已连接的主客户端收到 prepareSettingsReset 后，须保存待提交内容并暂停布局保存，再用通知中的一次性
// token 调用 `/api/setting/confirmSettingsReset`，传入 saved: true；保存失败传 false，15 秒未确认则取消。
// 成功后 settingsReset 通知所有主客户端直接重载；exit: true 仅让管理本地内核的桌面主窗口重载后正常退出，
// 不直接停止远程内核；失败时 cancelSettingsReset 携带此次操作 ID，客户端应恢复正常保存。
// 插件调用前应先取得用户确认，并确保未保存内容已经提交；重复调用恢复同一组默认值。
var ResetSettings = define[ResetSettingsRequest, Null]("resetSettings", "/api/setting/resetSettings", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "*", Mode: SettingSelfManaged}}, "POST")

// 确认 `/api/setting/resetSettings` 发起的重置，要求管理员权限并禁止只读写入。
// 接收 prepareSettingsReset 通知中的一次性 token；已保存待提交内容时传入 saved: true，保存失败传 false。
// 主客户端在确认前暂停布局保存；15 秒未确认则取消，收到 cancelSettingsReset 后恢复正常保存。
var ConfirmSettingsReset = define[ConfirmSettingsResetRequest, Null]("confirmSettingsReset", "/api/setting/confirmSettingsReset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "*", Mode: SettingSelfManaged}}, "POST")
var SetTheme = define[SettingThemeRequest, Null]("setTheme", "/api/setting/setTheme", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "appearance"}}, "POST")
var SetIcon = define[SettingIconRequest, Null]("setIcon", "/api/setting/setIcon", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "appearance"}}, "POST")
var GetPublish = define[EmptyRequest, SettingPublishData]("getPublish", "/api/setting/getPublish", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

// `cached: true` 仅返回内存中的账户，未登录时返回 null。
// 此模式忽略 token，不联网、不等待同步或切换资源来源；缓存结果不代表云端凭据仍然有效。
// 省略 cached 或传入 false 时执行账户恢复和令牌刷新；非管理员在两种模式下均得到 null。
// 客户端可先读取缓存完成初始化，再刷新账户，并通过 setCloudUser 主通道事件接收账户变化。
var GetCloudUser = define[SettingCloudUserRequest, *SettingUser]("getCloudUser", "/api/setting/getCloudUser", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 255}, DataOnError: true}, "POST")
var LogoutCloudUser = define[EmptyRequest, Null]("logoutCloudUser", "/api/setting/logoutCloudUser", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var Login2faCloudUser = define[SettingLogin2faRequest, Login2faEnvelope]("login2faCloudUser", "/api/setting/login2faCloudUser", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Output: DirectJSONOutput}, "POST")
var SetEmoji = define[SettingEmojiRequest, Null]("setEmoji", "/api/setting/setEmoji", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "editor"}}, "POST")

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
// keyword 在分页前匹配字段内容；无显示模板的空主键也匹配当前语言的未命名占位文字，遵循搜索大小写设置。
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

// PreviewAttributeViewCollection 预览已保存且启用的普通块收集规则，不修改文档或数据库。
// 仅在目标数据库的加密边界内查询；page 从 1 开始，每页最多 100 个，hasMore 表示还有下一页。
var PreviewAttributeViewCollection = define[AVBlockCollectionPreviewRequest, *AVBlockCollectionPreview]("previewAttributeViewCollection", "/api/av/previewAttributeViewCollection", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")

// 按全部启用收集规则的并集检查已有条目，返回 matched、unmatched、unknown 和规则版本。
// 手动及自动绑定条目统一判断；游离、无可用规则或无法判断时保留，不隐式清理或补收。
// status 可选，按分类筛选后每页最多 100 项；省略时保留混合分页，全库计数不受筛选影响。
// unknown 条目通过 reason 说明原因；isDetached 表示游离条目，主动移出使用普通条目移出事务。
// reason 的 invalidItem、detached、noRules、invalidRule 分别表示绑定信息不完整、游离、无启用规则和规则无效，
// unavailable 表示源块不可用，unreadable 表示源内容读取失败；原因不包含原始错误或私密路径。
// 使用 cleanupAttrViewBlocks 事务明确移出预览后确认的条目，执行时重新检查并支持撤销。
var ReviewAttributeViewCollection = define[AVCollectionReviewRequest, *AVCollectionReview]("reviewAttributeViewCollection", "/api/av/reviewAttributeViewCollection", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")

// PreviewAttributeViewTemplate 在实际条目快照上预览模板赋值，返回通过类型和引用校验的字段值，不写入数据。
// 使用规则时区和可选的预览输入；加密笔记本遵守请求租约及相同加密边界，失败返回 code -1。
var PreviewAttributeViewTemplate = define[AVAutomationTemplatePreviewRequest, *AVValue]("previewAttributeViewTemplate", "/api/av/previewAttributeViewTemplate", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")
var GetAttributeViewPasteRows = define[GetAttributeViewPasteRowsRequest, AVPasteRowsData]("getAttributeViewPasteRows", "/api/av/getAttributeViewPasteRows", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewFieldViews = define[GetAttributeViewFieldViewsRequest, AVFieldViewsData]("getAttributeViewFieldViews", "/api/av/getAttributeViewFieldViews", AuthenticatedAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 按模板创建条目；templateID 为空时创建空白游离条目。openAfterCreate 返回模板的交互偏好：
// true 表示创建后分屏打开，false 表示不打开，省略时仅日历条目自动打开。API 本身不触发界面操作。
var CreateAttributeViewItem = define[CreateAttributeViewItemRequest, AVCreateItemResult]("createAttributeViewItem", "/api/av/createAttributeViewItem", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var CreateAttributeViewRelationItem = define[CreateAttributeViewRelationItemRequest, AVCreateItemResult]("createAttributeViewRelationItem", "/api/av/createAttributeViewRelationItem", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var CreateAttributeViewItemWithMarkdown = define[CreateAttributeViewItemWithMarkdownRequest, AVCreateItemResult]("createAttributeViewItemWithMarkdown", "/api/av/createAttributeViewItemWithMarkdown", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var CreateAttributeViewItemDocs = define[CreateAttributeViewItemDocsRequest, AVCreateItemDocsResult]("createAttributeViewItemDocs", "/api/av/createAttributeViewItemDocs", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var SearchAttributeView = define[SearchAttributeViewRequest, AVSearchData]("searchAttributeView", "/api/av/searchAttributeView", AuthenticatedAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RenderSnapshotAttributeView = define[RenderSnapshotAttributeViewRequest, AVArchiveRenderData]("renderSnapshotAttributeView", "/api/av/renderSnapshotAttributeView", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var RenderHistoryAttributeView = define[RenderHistoryAttributeViewRequest, AVArchiveRenderData]("renderHistoryAttributeView", "/api/av/renderHistoryAttributeView", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 渲染指定数据库视图，保留载体权限、加密笔记本租约、筛选和分页行为。
// temporarySort 可选，省略或 null 时使用已保存的排序；指定时以单字段规则覆盖本次渲染排序，先排序再分页。
// 临时排序的 order 必须为 ASC 或 DESC；字段缺失或不支持排序时恢复已保存规则。
// 临时排序不创建或保存数据库，不改变载体默认视图；支持现有 valueSource 和 dateEndpoint 语义。
var RenderAttributeView = define[RenderAttributeViewRequest, AVRenderResult]("renderAttributeView", "/api/av/renderAttributeView", AuthenticatedAccess, JSONBody, ResponseOptions{DataOnError: true, FastJSON: true}, "POST")
var GetAttributeViewCalendarUndated = define[AVCalendarUndatedRequest, AVCalendarUndatedData]("getAttributeViewCalendarUndated", "/api/av/getAttributeViewCalendarUndated", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// 获取当前视图可见资源字段中的全部图片，保留载体发布权限、加密笔记本租约、搜索和上下文筛选。
// groupID 可选，省略、null 或空字符串时保留整个视图行为；指定时仅返回该分组图片，分组不存在则报错。
// 分组先按组内手动顺序排列，再应用视图排序；同一单元格按资源顺序返回，不受分页或虚拟滚动限制。
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

// 按提供商协议验证实际生成能力，模型清单命中本身不代表测试通过。
// gemini-interactions 使用原生端点、store=false 和有限输出预算，必须收到已校验的流式终止事件。
// 测试允许无上游错误且不含工具调用的 incomplete 响应，避免思考耗尽测试预算导致误判；正常生成仍报错。
var AITestModel = define[AIModelRequest, AIModelTestData]("testModel", "/api/ai/testModel", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var AITestEmbeddingModel = define[EmptyRequest, AIEmbeddingTestData]("testEmbeddingModel", "/api/ai/testEmbeddingModel", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AITestRerankModel = define[EmptyRequest, AIRerankTestData]("testRerankModel", "/api/ai/testRerankModel", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// 用固定的 TypeSafe System One 样例测试已保存的可选 ai.decision 配置，返回 {matched, msg?}。
// 遵循全局人工智能禁用标记和请求取消，配置错误与供应商错误不会被转换为判断结果。
// 省略决策配置时补齐默认关闭的配置，关闭后保留密钥，并沿用现有配置加密存储机制。
var AITestDecisionModel = define[AIDecisionTestRequest, AIDecisionTestData]("testDecisionModel", "/api/ai/testDecisionModel", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

// 按提供商协议读取模型及上下文上限；gemini-interactions 使用原生模型清单并去除 models/ 前缀。
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

// Persist pinning for an existing session. Requires administrator write access.
// pinned is a required boolean. Repeated pin requests preserve the original millisecond timestamp;
// unpinning returns pinnedAt=0. Missing or corrupt sessions fail without replacing their data.
// Pinning does not change conversation revisions, timestamps or active turns; stale saveSession requests cannot overwrite it.
var AISetSessionPinned = define[AISessionPinnedRequest, AISessionPinnedData]("setAgentSessionPinned", "/api/ai/agent/setPinned", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AIAgentQuestion = define[AIQuestionRequest, Null]("agentChatQuestion", "/api/ai/agent/question", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409}}, "POST")
var AIAgentBrowserCapabilityResult = define[AIBrowserCapabilityResultRequest, Null]("agentChatBrowserCapabilityResult", "/api/ai/agent/browserCapabilityResult", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409}}, "POST")
var AIListCapabilities = define[EmptyRequest, []AICapabilityManifest]("lsCapabilities", "/api/ai/lsCapabilities", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AIAgentTitle = define[AITitleRequest, string]("agentChatTitle", "/api/ai/agent/title", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")

// Filter by title, then paginate sessions with pinned entries first, ordered by pinnedAt descending.
// Unpinned sessions retain createdAt descending order; equal timestamps use descending session IDs.
// Missing pinnedAt in older sessions means unpinned. Pinning survives index reconstruction.
var AIListSessions = define[AISessionsRequest, AISessionList]("lsSessions", "/api/ai/agent/lsSessions", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")
var AIRemoveSession = define[AISessionIDRequest, Null]("removeSession", "/api/ai/agent/removeSession", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409, 500}}, "POST")
var AIListSkills = define[EmptyRequest, []AISkillInfo]("lsSkills", "/api/ai/agent/lsSkills", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// AIListBuiltinSkills 独立于斜杠菜单的普通技能发现，只返回只读元数据，包括已禁用条目。
var AIListBuiltinSkills = define[EmptyRequest, []AIBuiltinSkillInfo]("lsBuiltinSkills", "/api/ai/agent/lsBuiltinSkills", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// 返回工作空间 data/storage/ai/AGENTS.md 的 content 和 revision，要求管理员权限。
// 兼容读取旧路径 data/ai/AGENTS.md，读取不迁移；两处内容不同时返回 code=-1，保留两份文件并提示合并。
// 缺失文件返回空 content 和 missing 修订，不创建文件；非 UTF-8 文本、超出 32 KiB 或读取失败返回 code=-1。
var AIGetAgentInstructions = define[EmptyRequest, AIAgentInstructionsData]("getAgentInstructions", "/api/ai/agent/getInstructions", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

// 接收 content 和读取时的 revision，要求管理员权限且禁止只读写入。
// 内容允许为空；修订冲突返回 code=-1 并保留原文。保存采用原子替换，并按工作空间同步忽略规则通知同步。
// 首次保存迁移旧路径 data/ai/AGENTS.md，先持久化原文到新路径再移除旧文件；旧路径的忽略规则需在保存前更新。
// 指令在下一轮用户对话生效，同轮工具调用和压缩使用固定快照，且不能覆盖工具权限、审批或访问控制。
var AISetAgentInstructions = define[AIAgentInstructionsSaveRequest, AIAgentInstructionsData]("setAgentInstructions", "/api/ai/agent/setInstructions", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var AIListUserSkills = define[EmptyRequest, []AIUserSkillInfo]("lsUserSkills", "/api/ai/agent/lsUserSkills", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var AIGetSkill = define[AISkillNameRequest, AISkillData]("getSkill", "/api/ai/agent/getSkill", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")
var AISaveSkill = define[AISkillSaveRequest, Null]("saveSkill", "/api/ai/agent/saveSkill", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var AIRemoveSkill = define[AISkillNameRequest, Null]("removeSkill", "/api/ai/agent/removeSkill", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var AIRenameSkill = define[AISkillRenameRequest, Null]("renameSkill", "/api/ai/agent/renameSkill", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")

// 使用严格字符串字段，通过管理员和只读检查管理工作空间技能文件。相对路径标识实际目录，
// 与文件头中的技能名称无关，允许普通的点开头名称。读写支持不超过 8 MiB 的 UTF-8 文本，
// 不依赖扩展名并保留原文字节。目录和资源读取保留基于内容的版本；不支持编辑的内容省略 content，
// 并增加可选的 readOnlyReason（binary、encoding 或 tooLarge）。
// 修改已有文件时重新校验内容并要求当前版本，与旧技能修改接口和安装共享临界区，成功后通知同步。
// 路径穿越、平台别名、链接、过期版本，以及单独修改不支持的内容或重命名、删除根 SKILL.md 均被拒绝。
var AIManageSkills = define[AISkillFileRequest, AISkillFileData]("manageSkills", "/api/ai/agent/manageSkills", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var AIEditorChat = define[AIEditorChatRequest, Null]("aiEditorChat", "/api/ai/editor/chat", AuthenticatedAccess|AdminAccess, StructJSONBody, aiEditorSSEOptions(), "POST")

// gemini-interactions 使用 store=false 和本地会话历史，nativeContent 版本 1 保留完整原生步骤及思考签名。
// 未知原生版本保留原会话并报错；缺失终止事件、失败或不完整的响应不会执行工具调用。
var AIAgentChat = define[AIAgentChatRequest, Null]("agentChat", "/api/ai/agent/chat", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, aiAgentSSEOptions(), "POST")
var AIMCPOAuthCallback = define[EmptyRequest, BinaryContent]("mcpOAuthCallback", "/api/ai/mcp/oauth/callback/:flowID", PublicAccess, NoBody, HTTPContentOptions(HTTPContentVariant{Status: 200, ContentType: "text/html"}, HTTPContentVariant{Status: 400, ContentType: "text/html"}, HTTPContentVariant{Status: 403, ContentType: "text/plain"}), "GET")

// 会话保留扩展字段。图片附件只持久化来源元数据，不包含图片字节。
// PDF 预览附件的 path 指向来源 PDF，pdfImage 记录 revision、page 和 object；恢复时认证读取来源并校验版本。
var AIGetSession = define[AISessionIDRequest, *AISession]("getSession", "/api/ai/agent/getSession", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{500}}, "POST")

// Save conversation content with revision checks. The stored pinnedAt is preserved regardless of the
// submitted snapshot; clients must use setPinned to update list pinning independently of active turns.
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

// SystemDownloadUpdate 异步下载当前更新通道中指定版本的桌面安装包，不修改自动下载设置。
// version 必须与该通道当前可用的新版本完全一致；不接受下载 URL，不支持的运行环境或缺少校验值时返回 -1。
// 成功返回 null，进度和完成状态沿用更新通知；下载包通过校验后可供退出安装，自动下载关闭时仍可使用。
// 需要管理员和可写权限；已有下载任务时复用下载互斥保护，并通知正在下载。
var SystemDownloadUpdate = define[SystemDownloadUpdateRequest, Null]("downloadUpdate", "/api/system/downloadUpdate", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemCheckWorkspaceDir = define[SystemPathRequest, SystemWorkspaceCheckData]("checkWorkspaceDir", "/api/system/checkWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemCreateWorkspaceDir = define[SystemPathRequest, Null]("createWorkspaceDir", "/api/system/createWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemDismissOnboarding = define[EmptyRequest, *SystemOnboarding]("dismissOnboarding", "/api/system/dismissOnboarding", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var SystemEnsureOnboarding = define[EmptyRequest, *SystemOnboarding]("ensureOnboarding", "/api/system/ensureOnboarding", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

// SystemExit 默认保留退出同步及更新选择，返回 0 表示完成、1 表示同步失败、2 表示等待更新选择。
// 普通退出请求断开时取消其同步或同步锁等待，不将取消报告为同步成功；已开始的数据清理仍完整执行。
// force 跳过本次同步，并等待活动同步取消及收尾后再关闭数据库；本地未上传数据保留。
// 可选 recoverExit 绑定当前进程和退出批次，只接管没有活动会话的桌面退出；不匹配返回 -1，有会话返回 3。
// 接管默认正常同步，recoverExit.force 为 true 时跳过同步但仍执行数据清理；跳过安装提示且不修改工作空间顺序。
// 顶层 force、execInstallPkg、setCurrentWorkspace 在接管时忽略；省略 recoverExit.force 保持正常同步。
// 省略或传入 null 时保持原行为及数字截断规则，认证、管理员权限及加密笔记本关闭流程不变。
var SystemExit = define[SystemExitRequest, SystemExitData]("exit", "/api/system/exit", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3}, DataOnError: true}, "POST")

// SystemExportConf 导出单个 JSON 文件的设置压缩包。
var SystemExportConf = define[EmptyRequest, SystemExportConfData]("exportConf", "/api/system/exportConf", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemExportLog = define[EmptyRequest, SystemZipData]("exportLog", "/api/system/exportLog", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemExportTLSCABundle = define[EmptyRequest, SystemPathData]("exportTLSCABundle", "/api/system/exportTLSCABundle", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemExportTLSCACert = define[EmptyRequest, SystemPathData]("exportTLSCACert", "/api/system/exportTLSCACert", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetChangelog = define[SystemChangelogRequest, SystemChangelogData]("getChangelog", "/api/system/getChangelog", AuthenticatedAccess, LegacyOptionalBody, ResponseOptions{Setting: SettingWrite{Namespace: "system", Mode: SettingSilent}}, "POST")
var SystemGetConf = define[EmptyRequest, SystemConfData]("getConf", "/api/system/getConf", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetCustomFonts = define[EmptyRequest, []*SystemCustomFont]("getCustomFonts", "/api/system/getCustomFonts", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetEmojiConf = define[EmptyRequest, []*SystemEmojiGroup]("getEmojiConf", "/api/system/getEmojiConf", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetMobileWorkspaces = define[EmptyRequest, []string]("getMobileWorkspaces", "/api/system/getMobileWorkspaces", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetSysFonts = define[EmptyRequest, []*SystemFont]("getSysFonts", "/api/system/getSysFonts", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemGetWorkspaces = define[EmptyRequest, []*SystemWorkspace]("getWorkspaces", "/api/system/getWorkspaces", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")

// SystemImportConf 导入前按启动和设置接口的相同规则规范化编辑器、导出、文档树、搜索和闪卡偏好，并同步保存。
// 同时导入外观及界面语言、OCR、代码片段总开关和普通变量；这些配置段缺失或为 null 时保留当前值。
// 主题、图标和代码片段内容等独立资源不随设置包迁移，外观资源列表使用目标工作空间的可用资源。
// 账号、API token、同步、锁屏密码、数据仓库和加密笔记本密钥保持不变；沿用本机代理及更新通道。
// ChatGPT 账户引用从本机工作空间绑定加载，忽略导入文件中的引用；本机绑定读取失败时中止导入。
// 忽略设置备份中的寻址模式记录，不改变笔记本源格式或加密恢复材料。
var SystemImportConf = define[SystemImportConfRequest, Null]("importConf", "/api/system/importConf", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{Setting: SettingWrite{Namespace: "*"}}, "POST")
var SystemImportCustomFont = define[SystemImportFileRequest, *SystemCustomFont]("importCustomFont", "/api/system/importCustomFont", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{AdditionalCodes: []int{400, 413}}, "POST")
var SystemImportTLSCABundle = define[SystemImportFileRequest, SystemMessageData]("importTLSCABundle", "/api/system/importTLSCABundle", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// SystemLoginAuth 校验锁屏密码并建立当前工作空间的会话。
// rememberMe 为 true 时 Cookie 有效期为 30 天；否则使用浏览器会话 Cookie，
// 本机桌面端登录还绑定本次内核启动，工作空间退出重开后须重新认证；隐藏窗口或取消退出不使会话失效。
// 浏览器、移动端及旧版未携带启动批次的 Cookie 保持原有有效性；旧会话重新登录后应用上述规则。
var SystemLoginAuth = define[SystemLoginAuthRequest, Null]("loginAuth", "/api/system/loginAuth", PublicAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

// SystemUploadLockScreenWallpaper 替换本工作空间唯一的壁纸文件，需管理员写权限。
// file 必须是 JPEG、PNG 或 WebP，最多 10 MiB、1600 万像素；重编码为 JPEG，移除元数据。
// 图片保存在 conf/lockscreen/wallpaper.jpg，不同步、不包含在设置导出中。
// 上传不修改 appearance.lockScreenWallpaper，客户端须通过配置 patch 启用；失败保留原文件。
var SystemUploadLockScreenWallpaper = define[SystemWallpaperUploadRequest, Null]("uploadLockScreenWallpaper", "/api/system/uploadLockScreenWallpaper", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// SystemRemoveLockScreenWallpaper 删除本工作空间唯一的壁纸文件，需管理员写权限；文件不存在时仍成功。
// 客户端应先通过配置 patch 关闭 appearance.lockScreenWallpaper，再删除图片。
var SystemRemoveLockScreenWallpaper = define[EmptyRequest, Null]("removeLockScreenWallpaper", "/api/system/removeLockScreenWallpaper", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

// SystemGetLockScreenWallpaper 无需登录，仅返回已启用的单张壁纸，不接受文件路径或笔记本参数。
// 成功返回 image/jpeg 且禁止缓存；未启用、文件缺失或不可读时返回无正文的 404，认证页保留默认背景。
var SystemGetLockScreenWallpaper = define[EmptyRequest, BinaryContent]("getLockScreenWallpaper", "/api/system/getLockScreenWallpaper", PublicAccess, NoBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 404, ContentVariants: []HTTPContentVariant{{Status: 200, ContentType: "image/jpeg"}}, EmptyResponseStatuses: []int{404}}, "GET")
var SystemLogoutAuth = define[EmptyRequest, Null]("logoutAuth", "/api/system/logoutAuth", PublicAccess, NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var SystemOIDCMobileCallback = define[SystemOIDCMobileRequest, SystemOIDCMobileData]("oidcMobileCallback", "/api/system/oidc/mobileCallback", PublicAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCPoll = define[SystemOIDCPollRequest, SystemOIDCPollData]("oidcPoll", "/api/system/oidc/poll", PublicAccess, StructJSONBody, ResponseOptions{}, "POST")

// SystemOIDCStart 发起 OIDC 登录；rememberMe 的会话有效期及本机桌面启动绑定与 loginAuth 一致。
var SystemOIDCStart = define[SystemOIDCStartRequest, SystemOIDCStartData]("oidcStart", "/api/system/oidc/start", PublicAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidateStart = define[SystemOIDCRequest, SystemOIDCStartData]("oidcValidateStart", "/api/system/oidc/validate", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidateActivate = define[SystemOIDCPollRequest, SystemOIDCActivateData]("oidcValidateActivate", "/api/system/oidc/validateActivate", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidateCancel = define[SystemOIDCPollRequest, Null]("oidcValidateCancel", "/api/system/oidc/validateCancel", AuthenticatedAccess|AdminAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidatePoll = define[SystemOIDCPollRequest, SystemOIDCValidatePollData]("oidcValidatePoll", "/api/system/oidc/validatePoll", PublicAccess, StructJSONBody, ResponseOptions{}, "POST")
var SystemRemoveCustomFont = define[SystemRemoveCustomFontRequest, SystemRemoveCustomFontData]("removeCustomFont", "/api/system/removeCustomFont", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{400, 404}, Setting: SettingWrite{Namespace: "*"}}, "POST")
var SystemRemoveWorkspaceDir = define[SystemPathRequest, Null]("removeWorkspaceDir", "/api/system/removeWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemRemoveWorkspaceDirPhysically = define[SystemPathRequest, Null]("removeWorkspaceDirPhysically", "/api/system/removeWorkspaceDirPhysically", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemSetAPIToken = define[SystemAPITokenRequest, Null]("setAPIToken", "/api/system/setAPIToken", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")

// SystemSetAccessAuthCode 修改锁屏密码并更新当前会话；已有有效会话保留其启动绑定及记住策略。
// 没有有效会话时，本机桌面端新建的会话绑定本次内核启动。
var SystemSetAccessAuthCode = define[SystemAccessAuthCodeRequest, Null]("setAccessAuthCode", "/api/system/setAccessAuthCode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
var SystemSetAppearanceMode = define[SystemAppearanceModeRequest, SystemAppearanceData]("setAppearanceMode", "/api/system/setAppearanceMode", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "appearance"}}, "POST")
var SystemSetOIDC = define[SystemOIDCRequest, *SystemOIDC]("setOIDC", "/api/system/setOIDC", AuthenticatedAccess|AdminAccess|WritableAccess, StructJSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "system"}}, "POST")
var SystemSetUILayout = define[SystemUILayoutRequest, Null]("setUILayout", "/api/system/setUILayout", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Setting: SettingWrite{Namespace: "uiLayout", Mode: SettingSilent}}, "POST")
var SystemSetWorkspaceDir = define[SystemPathRequest, Null]("setWorkspaceDir", "/api/system/setWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

// SystemAddUIProcess 从 URL 查询参数读取正整数 pid，不读取请求体；无效 pid 或注册表已满时返回空 200。
var SystemAddUIProcess = define[EmptyRequest, Null]("addUIProcess", "/api/system/uiproc", AuthenticatedAccess, NoBody, ResponseOptions{EmptyResponseStatuses: []int{200}}, "POST")

// move 操作支持 nextID，将块移到该同级锚点之前，优先于 previousID 和 parentID。
// 移动保留折叠标题下辖块顺序及源块身份，不将整列表自动拆成列表项；moveBlock 接口不接受 nextID。
// 数据库自动化通过 setAttrViewAutomations 操作整体保存，配置 spec 为 1 至 8，所有视图共享数据库级规则。
// blockSource.types 主类型包含全部子类型；spec 3 可指定 h:h1 至 h:h6、l:u/o/t、i:u/o/t、callout:类型名。
// blockSource 的 tagMatch、attributeMatch 缺省为 and；spec 3 支持各组独立设置 or，空组不限制，组间仍为 and。
// spec 4 的 blockSource.tagTarget 支持 block（标签所在块）和 container（最近合格容器），缺省保持原行为。
// spec 5 的 blockSource.documentDepth 限制各文档范围的子文档深度，0 仅自身，1 包含自身及一级子文档。
// spec 6 的属性 nameOperator 支持 contains 和 Go regex；缺省或 equals 保持精确名称匹配，值条件独立。
// spec 7 支持 blockSource.includeSelectedDocuments=false，排除所选文档及其内部块，子文档仍按深度匹配；缺省、null 或 true 保持包含自身。
// spec 8 的 blockSource.referenceID 匹配正文块引用；文档目标包含内部内容块，不含子文档、嵌入或数据库字段引用。
// 引用来源按反链规则归并后匹配类型和属性，标签条件约束同一来源块，tagTarget 不参与选择；目标须在同一加密边界。
// 排除自身不影响其他范围的并集；与 documentDepth=0 组合时对应文档范围为空。配置变更保留条目和字段，不自动补收或清理。
// 深度缺省或 null 不限，不影响笔记本范围，各范围仍取并集；修改不自动清理或补收已有内容。
// 容器按类型及属性条件选择并去重；全部标签须在同一个来源块中，文档容器须显式选择 d。
// 类型和属性始终筛选最终对象；默认首个内容块优先归属合格列表项，每次标签命中只选择一个对象。
// 无标签时收集对象不影响筛选；变更收集对象不转换已有条目，预览与实际收集使用相同规则。
// 自动收集只添加条目，原文失配及规则变更均保留已有条目和字段，再次匹配不会重新初始化。
// setAttrViewAutomations 新增范围最多包含 32 个去重后的笔记本或文档；既有超限规则可保留或删减，撤销重做不截断原范围。
// cleanupAttrViewBlocks 按全部启用收集规则复查已确认条目及绑定，仅移出明确失配条目，并支持撤销。
// 规则的 notifyOnSuccess 缺省或 null 为开启，仅实际变更且事务成功提交后通知，同一事务合并；错误提示不受其控制。
// 手动收集及清理、无变化、撤销重放和失败回滚不发送成功通知。
// addAttributeViewBlocks、setAttributeViewBlockAttr、batchSetAttributeViewBlockAttrs 触发启用的新增或字段变化规则。
// 自动操作与原修改一同提交，失败一起回滚；普通 API 写入不生成编辑器撤销记录。
// 自动化不串联，导入、同步、历史恢复和撤销重放不重新触发；重做保留原条目 ID 和触发时间。
// 字段失效或目标数据库被删除时，后续条目写入停用规则并保留配置，源修改仍提交；提交后提示失效引用。
// 修复后需手动启用，撤销源修改不重新启用规则；锁定、认证失败、损坏及实际写入失败仍一起回滚。
// 跨库动作限于同一加密边界，要求目标可访问；单笔事务最多执行 1000 个自动操作。
// swapBlockRef 必须独立提交：id 指定引用块，blockID 指定定义块，data 携带 includeChildren 和 originalToEmbed，
// retData 返回受影响的文档 ID。逆向操作使用受影响顶层块的私有内存快照；快照不传给客户端，也不接受客户端提交。
// 重放保留块 ID 和数据库绑定，内容或位置已改变时拒绝覆盖；提交失败时补偿已写入的文档。
// 撤销与重放为所有受影响文档持有笔记本租约，直至响应序列化完成。
var PerformTransactions = define[PerformTransactionsRequest, []*Transaction]("performTransactions", "/api/transactions", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var UndoState = define[TransactionUndoStateRequest, TransactionUndoState]("undoState", "/api/transactions/undoState", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var PerformUndo = define[TransactionHistoryRequest, TransactionHistoryResult]("performUndo", "/api/transactions/undo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var PerformRedo = define[TransactionHistoryRequest, TransactionHistoryResult]("performRedo", "/api/transactions/redo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ClearHistory = define[TransactionClearHistoryRequest, Null]("clearHistory", "/api/transactions/clearHistory", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BroadcastWebSocket = define[EmptyRequest, Null]("broadcast", "/ws/broadcast", AuthenticatedAccess|AdminAccess, NoBody, RawWebSocketOptions(), "GET")
var BroadcastSubscribe = define[EmptyRequest, Null]("broadcastSubscribe", "/es/broadcast/subscribe", AuthenticatedAccess|AdminAccess, NoBody, RawSSEOptions(), "GET")
