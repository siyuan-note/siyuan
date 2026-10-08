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

// MCP OAuth 协议入口返回标准 OAuth JSON 或授权页面，不使用内核结果信封。
var MCPOAuthResource = define[EmptyRequest, BinaryContent]("mcpOAuthResource", "/.well-known/oauth-protected-resource/mcp", PublicAccess, NoBody, mcpOAuthContentOptions(), "GET")
var MCPOAuthResourceRoot = define[EmptyRequest, BinaryContent]("mcpOAuthResourceRoot", "/.well-known/oauth-protected-resource", PublicAccess, NoBody, mcpOAuthContentOptions(), "GET")
var MCPOAuthMetadata = define[EmptyRequest, BinaryContent]("mcpOAuthMetadata", "/.well-known/oauth-authorization-server", PublicAccess, NoBody, mcpOAuthContentOptions(), "GET")
var MCPOAuthToken = define[MCPOAuthTokenRequest, BinaryContent]("mcpOAuthToken", "/oauth/mcp/token", PublicAccess, FormBody, mcpOAuthContentOptions(), "POST")
var MCPOAuthRevoke = define[MCPOAuthTokenRequest, BinaryContent]("mcpOAuthRevoke", "/oauth/mcp/revoke", PublicAccess, FormBody, mcpOAuthContentOptions(), "POST")
var MCPOAuthAuthorize = define[EmptyRequest, BinaryContent]("mcpOAuthServerAuthorize", "/oauth/mcp/authorize", PublicAccess, NoBody, HTTPContentOptions(HTTPContentVariant{Status: 200, ContentType: "text/html"}, HTTPContentVariant{Status: 302, ContentType: "text/html"}, HTTPContentVariant{Status: 400, ContentType: "text/html"}), "GET")
var MCPOAuthConsent = define[MCPOAuthConsentRequest, BinaryContent]("mcpOAuthConsent", "/oauth/mcp/consent", PublicAccess, FormBody, HTTPContentOptions(HTTPContentVariant{Status: 302, ContentType: "text/html"}, HTTPContentVariant{Status: 400, ContentType: "text/html"}), "POST")
var MCPOAuthGet = define[EmptyRequest, MCPOAuthStatus]("mcpOAuthGet", "/api/mcp/getOAuth", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var MCPOAuthSet = define[MCPOAuthConfig, Null]("mcpOAuthSet", "/api/mcp/setOAuth", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var MCPOAuthAddClient = define[MCPOAuthClientRequest, MCPOAuthClientSecret]("mcpOAuthAddClient", "/api/mcp/addOAuthClient", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var MCPOAuthRemoveClient = define[MCPOAuthRemoveRequest, Null]("mcpOAuthRemoveClient", "/api/mcp/removeOAuthClient", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var (
	GetChildBlocks     = define[BlockQueryRequest, []*ChildBlock]("getChildBlocks", "/api/block/getChildBlocks", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{NonNullable: true}, "POST")
	GetTailChildBlocks = define[TailChildBlocksRequest, []*ChildBlock]("getTailChildBlocks", "/api/block/getTailChildBlocks", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{NonNullable: true}, "POST")
)

var (
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
	GetWorkspaceStorage                 = define[EmptyRequest, WorkspaceStorageData]("getWorkspaceStorage", "/api/system/getWorkspaceStorage", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	GetNetwork                          = define[EmptyRequest, NetworkData]("getNetwork", "/api/system/getNetwork", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	GetRuntimeInfo                      = define[EmptyRequest, SystemRuntimeInfoData]("getRuntimeInfo", "/api/system/getRuntimeInfo", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
	CurrentTime                         = define[EmptyRequest, int64]("currentTime", "/api/system/currentTime", PublicAccess, NoBody, ResponseOptions{}, "POST")
	BootProgress                        = define[EmptyRequest, BootProgressData]("bootProgress", "/api/system/bootProgress", PublicAccess, NoBody, ResponseOptions{}, "GET", "POST")
	SetFollowSystemLockScreen           = define[LockScreenRequest, Null]("setFollowSystemLockScreen", "/api/system/setFollowSystemLockScreen", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetAutoLaunch                       = define[AutoLaunchRequest, Null]("setAutoLaunch", "/api/system/setAutoLaunch", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetDownloadInstallPkg               = define[DownloadInstallPkgRequest, Null]("setDownloadInstallPkg", "/api/system/setDownloadInstallPkg", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetSettingsWindow                   = define[SettingsWindowRequest, Null]("setSettingsWindow", "/api/system/setSettingsWindow", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetNetworkServe                     = define[NetworkServeRequest, Null]("setNetworkServe", "/api/system/setNetworkServe", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetNetworkServeTLS                  = define[NetworkServeTLSRequest, Null]("setNetworkServeTLS", "/api/system/setNetworkServeTLS", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetUpdateChannel                    = define[UpdateChannelRequest, Null]("setUpdateChannel", "/api/system/setUpdateChannel", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	SetNetworkProxy                     = define[NetworkProxy, Null]("setNetworkProxy", "/api/system/setNetworkProxy", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	GetBookmarkLabels                   = define[EmptyRequest, []string]("getBookmarkLabels", "/api/attr/getBookmarkLabels", AuthenticatedAccess, NoBody, ResponseOptions{}, "POST")
	BatchGetBlockAttrs                  = define[BlockIDsRequest, map[string]map[string]string]("batchGetBlockAttrs", "/api/attr/batchGetBlockAttrs", AuthenticatedAccess, JSONBody, ResponseOptions{NonNullable: true}, "POST")
	GetDOMText                          = define[DOMTextRequest, string]("getDOMText", "/api/block/getDOMText", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	RemoveBookmark                      = define[RemoveBookmarkRequest, Null]("removeBookmark", "/api/bookmark/removeBookmark", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RenameBookmark                      = define[RenameBookmarkRequest, Null]("renameBookmark", "/api/bookmark/renameBookmark", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RemoveTag                           = define[RemoveTagRequest, Null]("removeTag", "/api/tag/removeTag", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	RenameTag                           = define[RenameTagRequest, Null]("renameTag", "/api/tag/renameTag", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
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
	PrepareNotebookArchive               = define[PrepareNotebookArchiveRequest, NotebookArchiveData]("prepareNotebookArchive", "/api/notebook/prepareNotebookArchive", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	CommitNotebookArchive                = define[CommitNotebookArchiveRequest, Null]("commitNotebookArchive", "/api/notebook/commitNotebookArchive", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
	ImportNotebookArchive                = define[ImportNotebookArchiveRequest, Null]("importNotebookArchive", "/api/notebook/importNotebookArchive", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")
)

var (
	GetBlockDOM           = define[BlockQueryRequest, BlockDOMData]("getBlockDOM", "/api/block/getBlockDOM", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockDOMWithEmbed  = define[BlockQueryRequest, BlockDOMData]("getBlockDOMWithEmbed", "/api/block/getBlockDOMWithEmbed", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockDOMs          = define[BlocksQueryRequest, map[string]string]("getBlockDOMs", "/api/block/getBlockDOMs", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockDOMsWithEmbed = define[BlocksQueryRequest, map[string]string]("getBlockDOMsWithEmbed", "/api/block/getBlockDOMsWithEmbed", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockKramdown      = define[BlockKramdownRequest, BlockKramdownData]("getBlockKramdown", "/api/block/getBlockKramdown", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockKramdowns     = define[BlocksKramdownRequest, map[string]string]("getBlockKramdowns", "/api/block/getBlockKramdowns", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
	GetRefText                  = define[BlockQueryRequest, string]("getRefText", "/api/block/getRefText", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetRefIDs                   = define[RefIDsRequest, RefIDsData]("getRefIDs", "/api/block/getRefIDs", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetRefIDsByFileAnnotationID = define[FileAnnotationRefRequest, RefDefsData]("getRefIDsByFileAnnotationID", "/api/block/getRefIDsByFileAnnotationID", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
	GetBlockDefIDsByRefText     = define[RefTextQueryRequest, RefDefsData]("getBlockDefIDsByRefText", "/api/block/getBlockDefIDsByRefText", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
)

var (
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

// MoveBlock 同步移动块，previousID 优先于 parentID，省略 previousID 时移动到父块开头。
// 成功和主动跳过返回 code=0、data=null；事务校验或提交失败返回 code=-1、data=null 和原因。
var MoveBlock = define[MoveBlockRequest, Null]("moveBlock", "/api/block/moveBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var GetHeadingDeleteTransaction = define[BlockIDRequest, *BlockTransaction]("getHeadingDeleteTransaction", "/api/block/getHeadingDeleteTransaction", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var GetHeadingInsertTransaction = define[BlockIDRequest, *BlockTransaction]("getHeadingInsertTransaction", "/api/block/getHeadingInsertTransaction", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var GetHeadingFoldTransaction = define[HeadingFoldRequest, *BlockTransaction]("getHeadingFoldTransaction", "/api/block/getHeadingFoldTransaction", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var UpdateTaskListItemMarker = define[TaskListMarkerRequest, []*BlockTransaction]("updateTaskListItemMarker", "/api/block/updateTaskListItemMarker", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BatchUpdateTaskListItemMarker = define[BatchTaskListMarkerRequest, []*BlockTransaction]("batchUpdateTaskListItemMarker", "/api/block/batchUpdateTaskListItemMarker", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var MoveOutlineHeading = define[MoveBlockRequest, []*BlockTransaction]("moveOutlineHeading", "/api/block/moveOutlineHeading", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var AppendDailyNoteBlock = define[DailyNoteBlockRequest, []*BlockTransaction]("appendDailyNoteBlock", "/api/block/appendDailyNoteBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var PrependDailyNoteBlock = define[DailyNoteBlockRequest, []*BlockTransaction]("prependDailyNoteBlock", "/api/block/prependDailyNoteBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var AppendBlock = define[AppendBlockRequest, []*BlockTransaction]("appendBlock", "/api/block/appendBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var PrependBlock = define[PrependBlockRequest, []*BlockTransaction]("prependBlock", "/api/block/prependBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BatchAppendBlock = define[BatchParentBlockRequest, []*BlockTransaction]("batchAppendBlock", "/api/block/batchAppendBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BatchPrependBlock = define[BatchParentBlockRequest, []*BlockTransaction]("batchPrependBlock", "/api/block/batchPrependBlock", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

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
var GetSnippet = define[GetSnippetRequest, SnippetsData]("getSnippet", "/api/snippet/getSnippet", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
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

// ImportStdMd 将标准脚注定义导入为独立列表项，正文脚注转换为指向列表项的上标静态块引用。
// 多次引用共享同一目标；未定义的脚注不生成块引用，代码中的脚注文本保持原样，反链复用块引用索引。
var ImportStdMd = define[ImportMarkdownRequest, Null]("importStdMd", "/api/import/importStdMd", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var ImportData = define[ImportDataRequest, Null]("importData", "/api/import/importData", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

// ImportZipMd 对压缩包中的 Markdown 使用与 ImportStdMd 相同的脚注转换规则。
var ImportZipMd = define[ImportZipMarkdownRequest, Null]("importZipMd", "/api/import/importZipMd", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

var ImportSY = define[ImportSYRequest, Null]("importSY", "/api/import/importSY", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

var ImportSYNotebook = define[ImportDataRequest, ImportNotebookData]("importSYNotebook", "/api/import/importSYNotebook", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{}, "POST")

var ImportSYAuto = define[ImportSYRequest, ImportAutoData]("importSYAuto", "/api/import/importSYAuto", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{DataOnError: true}, "POST")

var GetHistoryItems = define[HistoryItemsRequest, HistoryItemsData]("getHistoryItems", "/api/history/getHistoryItems", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

var GetNotebookHistory = define[EmptyRequest, NotebookHistoryData]("getNotebookHistory", "/api/history/getNotebookHistory", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")

var GetDocHistoryContent = define[DocHistoryContentRequest, DocHistoryContentData]("getDocHistoryContent", "/api/history/getDocHistoryContent", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")

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

var FindReplace = define[FindReplaceRequest, Null]("findReplace", "/api/search/findReplace", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var SemanticSearchBlock = define[SearchBlockRequest, SearchBlocksData]("semanticSearchBlock", "/api/search/semanticSearchBlock", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")

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
var GetRepoSnapshots = define[GetRepoSnapshotsRequest, RepoSnapshotsData]("getRepoSnapshots", "/api/repo/getRepoSnapshots", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var SearchRepoFile = define[SearchRepoFileRequest, RepoSearchData]("searchRepoFile", "/api/repo/searchRepoFile", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetRepoDocHistory = define[GetRepoDocHistoryRequest, RepoDocHistoryData]("getRepoDocHistory", "/api/repo/getRepoDocHistory", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var ExportRepoFile = define[ExportRepoFileRequest, RepoExportData]("exportRepoFile", "/api/repo/exportRepoFile", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetCloudRepoSnapshots = define[GetCloudRepoSnapshotsRequest, RepoCloudSnapshotsData]("getCloudRepoSnapshots", "/api/repo/getCloudRepoSnapshots", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var GetCloudRepoTagSnapshots = define[EmptyRequest, RepoCloudTagsData]("getCloudRepoTagSnapshots", "/api/repo/getCloudRepoTagSnapshots", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var RemoveCloudRepoTagSnapshot = define[RemoveCloudRepoTagSnapshotRequest, Null]("removeCloudRepoTagSnapshot", "/api/repo/removeCloudRepoTagSnapshot", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
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

// CreateDocWithMd 保留编辑器 Markdown 语法选项，并按 ImportStdMd 的规则自动转换标准脚注。
// 请求字段、文档 ID 响应和笔记本权限规则不变；转义的脚注语法可用于保留字面文本。
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
var RenameAsset = define[RenameAssetRequest, AssetRenameData]("renameAsset", "/api/asset/renameAsset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var FindAssetReferences = define[FindAssetReferencesRequest, AssetReferencesData]("findAssetReferences", "/api/asset/findAssetReferences", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var RelinkAsset = define[RelinkAssetRequest, AssetReferencesData]("relinkAsset", "/api/asset/relinkAsset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{DataOnError: true}, "POST")
var GetDocImageAssets = define[AssetDocumentRequest, []string]("getDocImageAssets", "/api/asset/getDocImageAssets", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var GetDocAssets = define[AssetDocumentAssetsRequest, []string]("getDocAssets", "/api/asset/getDocAssets", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var SetFileAnnotation = define[SetAssetAnnotationRequest, Null]("setFileAnnotation", "/api/asset/setFileAnnotation", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetFileAnnotation = define[AssetPathRequest, AssetAnnotationData]("getFileAnnotation", "/api/asset/getFileAnnotation", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 403}}, "POST")

// path 为 data 相对资源路径。仅全局 assets/android-notification-texts.txt 普通文件允许显式删除，
// 无需未引用扫描；该文件仍不参与未引用资源列表和批量清理。其余资源必须经完整扫描确认未被引用。
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
var ResetSettings = define[ResetSettingsRequest, Null]("resetSettings", "/api/setting/resetSettings", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ConfirmSettingsReset = define[ConfirmSettingsResetRequest, Null]("confirmSettingsReset", "/api/setting/confirmSettingsReset", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetTheme = define[SettingThemeRequest, Null]("setTheme", "/api/setting/setTheme", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SetIcon = define[SettingIconRequest, Null]("setIcon", "/api/setting/setIcon", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var GetPublish = define[EmptyRequest, SettingPublishData]("getPublish", "/api/setting/getPublish", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var GetCloudUser = define[SettingCloudUserRequest, *SettingUser]("getCloudUser", "/api/setting/getCloudUser", AuthenticatedAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 255}, DataOnError: true}, "POST")
var LogoutCloudUser = define[EmptyRequest, Null]("logoutCloudUser", "/api/setting/logoutCloudUser", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var Login2faCloudUser = define[SettingLogin2faRequest, Login2faEnvelope]("login2faCloudUser", "/api/setting/login2faCloudUser", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{Output: DirectJSONOutput}, "POST")
var SetEmoji = define[SettingEmojiRequest, Null]("setEmoji", "/api/setting/setEmoji", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var RemoveUnusedAttributeView = define[RemoveUnusedAttributeViewRequest, AVIDData]("removeUnusedAttributeView", "/api/av/removeUnusedAttributeView", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var RemoveUnusedAttributeViews = define[EmptyRequest, AVPathsData]("removeUnusedAttributeViews", "/api/av/removeUnusedAttributeViews", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")

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
var AIGetAgentInstructions = define[EmptyRequest, AIAgentInstructionsData]("getAgentInstructions", "/api/ai/agent/getInstructions", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
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

var NetworkEcho = define[EmptyRequest, NetworkEchoData]("echo", "/api/network/echo", AuthenticatedAccess|AdminAccess, RawBody, ResponseOptions{}, "ANY")
var NetworkEchoPath = define[EmptyRequest, NetworkEchoData]("echoPath", "/api/network/echo/*path", AuthenticatedAccess|AdminAccess, RawBody, ResponseOptions{}, "ANY")
var NetworkForwardProxy = define[NetworkForwardRequest, NetworkForwardData]("forwardProxy", "/api/network/forwardProxy", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4, 5, 6, 7, 8, 10}}, "POST")
var NetworkHTTPProxy = define[EmptyRequest, ProxyFailure]("httpProxy", "/api/network/proxy", AuthenticatedAccess|AdminAccess, RawBody, ProxyOptions(HTTPProxy), "ANY")
var NetworkEventSourceProxy = define[EmptyRequest, ProxyFailure]("esProxy", "/es/network/proxy", AuthenticatedAccess|AdminAccess, NoBody, ProxyOptions(EventSourceProxy), "GET")
var NetworkWebSocketProxy = define[EmptyRequest, ProxyFailure]("wsProxy", "/ws/network/proxy", AuthenticatedAccess|AdminAccess, NoBody, ProxyOptions(WebSocketProxy), "GET")

var PluginPrivateService = define[EmptyRequest, PluginServiceContent]("pluginPrivateWebServer", "/plugin/private/:name/*path", AuthenticatedAccess|AdminAccess|WritableAccess, RawBody, PluginServiceOptions(), "ANY")

var GetDynamicIcon = define[DynamicIconRequest, BinaryContent]("getDynamicIcon", "/api/icon/getDynamicIcon", AuthenticatedAccess, NoBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200, ContentVariants: []HTTPContentVariant{{Status: 200, ContentType: "image/svg+xml"}}, EmptyResponseStatuses: []int{500}}, "GET")

var ExtensionCopy = define[ExtensionCopyRequest, *ExtensionCopyData]("extensionCopy", "/api/extension/copy", AuthenticatedAccess|AdminAccess|WritableAccess, MultipartBody, ResponseOptions{DataOnError: true}, "POST")

var SystemBootProgressSSE = define[EmptyRequest, Null]("bootProgressSSE", "/api/system/bootProgressSSE", PublicAccess, NoBody, SSEOptions(SSEEvent[BootProgressData]("")), "GET")
var SystemGetBootAppearance = define[EmptyRequest, *SettingBootAppearance]("getBootAppearance", "/api/system/getBootAppearance", PublicAccess, NoBody, ResponseOptions{EmptyResponseStatuses: []int{403}}, "GET")
var SystemGetCaptcha = define[EmptyRequest, BinaryContent]("getCaptcha", "/api/system/getCaptcha", PublicAccess, NoBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200, ContentVariants: []HTTPContentVariant{{Status: 200, ContentType: "image/png"}}, EmptyResponseStatuses: []int{500}}, "GET")
var SystemOIDCCallback = define[SystemOIDCCallbackRequest, BinaryContent]("oidcCallback", "/api/system/oidc/callback", PublicAccess, NoBody, HTTPContentOptions(HTTPContentVariant{Status: 200, ContentType: "text/html"}), "GET")
var SystemAddCustomEmoji = define[SystemCustomEmojiRequest, SystemPathData]("addCustomEmoji", "/api/system/addCustomEmoji", AuthenticatedAccess|AdminAccess|WritableAccess, FormBody, ResponseOptions{AdditionalCodes: []int{400, 413}}, "POST")
var SystemCheckUpdate = define[SystemCheckUpdateRequest, Null]("checkUpdate", "/api/system/checkUpdate", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
var SystemCheckWorkspaceDir = define[SystemPathRequest, SystemWorkspaceCheckData]("checkWorkspaceDir", "/api/system/checkWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemCreateWorkspaceDir = define[SystemPathRequest, Null]("createWorkspaceDir", "/api/system/createWorkspaceDir", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var SystemDismissOnboarding = define[EmptyRequest, *SystemOnboarding]("dismissOnboarding", "/api/system/dismissOnboarding", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var SystemEnsureOnboarding = define[EmptyRequest, *SystemOnboarding]("ensureOnboarding", "/api/system/ensureOnboarding", AuthenticatedAccess|AdminAccess|WritableAccess, NoBody, ResponseOptions{}, "POST")
var SystemExit = define[SystemExitRequest, SystemExitData]("exit", "/api/system/exit", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2}, DataOnError: true}, "POST")
var SystemExportConf = define[EmptyRequest, SystemExportConfData]("exportConf", "/api/system/exportConf", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemExportLog = define[EmptyRequest, SystemZipData]("exportLog", "/api/system/exportLog", AuthenticatedAccess|AdminAccess, NoBody, ResponseOptions{}, "POST")
var SystemAppendKeyboardLog = define[SystemKeyboardLogRequest, Null]("appendKeyboardLog", "/api/system/appendKeyboardLog", AuthenticatedAccess|AdminAccess, JSONBody, ResponseOptions{}, "POST")
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
var SystemAddUIProcess = define[SystemUIProcessRequest, Null]("addUIProcess", "/api/system/uiproc", AuthenticatedAccess, NoBody, ResponseOptions{EmptyResponseStatuses: []int{200}}, "POST")

var PerformTransactions = define[PerformTransactionsRequest, []*Transaction]("performTransactions", "/api/transactions", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var UndoState = define[TransactionUndoStateRequest, TransactionUndoState]("undoState", "/api/transactions/undoState", AuthenticatedAccess, JSONBody, ResponseOptions{}, "POST")
var PerformUndo = define[TransactionHistoryRequest, TransactionHistoryResult]("performUndo", "/api/transactions/undo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var PerformRedo = define[TransactionHistoryRequest, TransactionHistoryResult]("performRedo", "/api/transactions/redo", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")
var ClearHistory = define[TransactionClearHistoryRequest, Null]("clearHistory", "/api/transactions/clearHistory", AuthenticatedAccess|AdminAccess|WritableAccess, JSONBody, ResponseOptions{}, "POST")

var BroadcastWebSocket = define[EmptyRequest, Null]("broadcast", "/ws/broadcast", AuthenticatedAccess|AdminAccess, NoBody, RawWebSocketOptions(), "GET")
var BroadcastSubscribe = define[EmptyRequest, Null]("broadcastSubscribe", "/es/broadcast/subscribe", AuthenticatedAccess|AdminAccess, NoBody, RawSSEOptions(), "GET")
