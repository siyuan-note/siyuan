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

var (
	GetChildBlocks     = define[BlockQueryRequest, []*ChildBlock]("getChildBlocks", "/api/block/getChildBlocks", JSONBody, ResponseOptions{NonNullable: true}, "POST")
	GetTailChildBlocks = define[TailChildBlocksRequest, []*ChildBlock]("getTailChildBlocks", "/api/block/getTailChildBlocks", JSONBody, ResponseOptions{NonNullable: true}, "POST")
)

var (
	CheckBlocksExist            = define[CheckBlocksExistRequest, map[string]bool]("checkBlocksExist", "/api/block/checkBlocksExist", JSONBody, ResponseOptions{}, "POST")
	GetOrderedListContinueStart = define[BlockQueryRequest, OrderedListStartData]("getOrderedListContinueStart", "/api/block/getOrderedListContinueStart", JSONBody, ResponseOptions{}, "POST")
)

var (
	GetContentWordCount = define[ContentWordCountRequest, WordCountData]("getContentWordCount", "/api/block/getContentWordCount", JSONBody, ResponseOptions{}, "POST")
	GetBlocksWordCount  = define[BlocksWordCountRequest, WordCountData]("getBlocksWordCount", "/api/block/getBlocksWordCount", JSONBody, ResponseOptions{}, "POST")
)

var SetNotebookConf = define[SetNotebookConfRequest, *NotebookConf]("setNotebookConf", "/api/notebook/setNotebookConf", JSONBody, ResponseOptions{}, "POST")

var ReorderNotebooks = define[ReorderNotebooksRequest, *ReorderData]("reorderNotebooks", "/api/notebook/reorder", StructJSONBody, ResponseOptions{DataOnError: true}, "POST")

var (
	OpenNotebook    = define[OpenNotebookRequest, Null]("openNotebook", "/api/notebook/openNotebook", JSONBody, ResponseOptions{}, "POST")
	GetNotebookConf = define[CloseNotebookRequest, NotebookConfData]("getNotebookConf", "/api/notebook/getNotebookConf", JSONBody, ResponseOptions{}, "POST")
)

var ImportNotebookCryptoBackup = define[ImportNotebookCryptoBackupRequest, Null]("importNotebookCryptoBackup", "/api/notebook/importNotebookCryptoBackup", MultipartBody, ResponseOptions{}, "POST")

var (
	GetNotebookInfo            = define[NotebookIDRequest, NotebookInfoData]("getNotebookInfo", "/api/notebook/getNotebookInfo", JSONBody, ResponseOptions{}, "POST")
	GetEncryptedNotebookStatus = define[EmptyRequest, EncryptedNotebookStatusData]("getEncryptedNotebookStatus", "/api/notebook/getEncryptedNotebookStatus", NoBody, ResponseOptions{}, "POST")
)

var (
	SetNotebookIcon    = define[SetNotebookIconRequest, Null]("setNotebookIcon", "/api/notebook/setNotebookIcon", JSONBody, ResponseOptions{}, "POST")
	ChangeSortNotebook = define[ChangeSortNotebookRequest, Null]("changeSortNotebook", "/api/notebook/changeSortNotebook", JSONBody, ResponseOptions{}, "POST")
	RenameNotebook     = define[RenameNotebookRequest, Null]("renameNotebook", "/api/notebook/renameNotebook", JSONBody, ResponseOptions{}, "POST")
	RemoveNotebook     = define[NotebookIDRequest, Null]("removeNotebook", "/api/notebook/removeNotebook", JSONBody, ResponseOptions{}, "POST")
	CreateNotebook     = define[CreateNotebookRequest, CreateNotebookData]("createNotebook", "/api/notebook/createNotebook", JSONBody, ResponseOptions{}, "POST")
	CloseNotebook      = define[CloseNotebookRequest, Null]("closeNotebook", "/api/notebook/closeNotebook", JSONBody, ResponseOptions{}, "POST")
)

var (
	GetPinnedDocs    = define[EmptyRequest, []PinnedDoc]("getPinnedDocs", "/api/filetree/getPinnedDocs", NoBody, ResponseOptions{NonNullable: true}, "POST")
	UpdatePinnedDocs = define[UpdatePinnedDocsRequest, Null]("updatePinnedDocs", "/api/filetree/updatePinnedDocs", JSONBody, ResponseOptions{}, "POST")
)

func define[Request, Data any](name, path string, body BodyMode, response ResponseOptions, methods ...string) Endpoint[Request, Data] {
	d := Definition{Name: name, Path: path, Methods: methods, Body: body,
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
	Version       = define[EmptyRequest, string]("version", "/api/system/version", NoBody, ResponseOptions{}, "GET", "POST")
	GetBlockAttrs = define[BlockIDRequest, map[string]string]("getBlockAttrs", "/api/attr/getBlockAttrs", JSONBody, ResponseOptions{NonNullable: true}, "POST")
	SetBlockAttrs = define[SetBlockAttrsRequest, Null]("setBlockAttrs", "/api/attr/setBlockAttrs", JSONBody, ResponseOptions{}, "POST")
	SearchTag     = define[SearchTagRequest, SearchTagData]("searchTag", "/api/search/searchTag", JSONBody, ResponseOptions{}, "POST")
	ListNotebooks = define[ListNotebooksRequest, *ListNotebooksData]("lsNotebooks", "/api/notebook/lsNotebooks", LegacyOptionalBody, ResponseOptions{}, "POST")
	SearchHistory = define[SearchHistoryRequest, SearchHistoryData]("searchHistory", "/api/history/searchHistory", JSONBody, ResponseOptions{}, "POST")
	GetBlockInfo  = define[BlockInfoRequest, BlockInfoData]("getBlockInfo", "/api/block/getBlockInfo", JSONBody, ResponseOptions{AdditionalCodes: []int{3}, Text: true}, "POST")
)

var (
	CreateSnapshot  = define[CreateSnapshotRequest, CreateSnapshotData]("createSnapshot", "/api/repo/createSnapshot", JSONBody, ResponseOptions{}, "POST")
	CheckSnapshot   = define[EmptyRequest, CheckSnapshotData]("checkSnapshot", "/api/repo/checkSnapshot", NoBody, ResponseOptions{}, "POST")
	SetSnapshotMemo = define[SetSnapshotMemoRequest, Null]("setSnapshotMemo", "/api/repo/setSnapshotMemo", JSONBody, ResponseOptions{}, "POST")
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
	ClearTempFiles                      = define[EmptyRequest, Null]("clearTempFiles", "/api/system/clearTempFiles", NoBody, ResponseOptions{}, "POST")
	VacuumDataIndex                     = define[EmptyRequest, Null]("vacuumDataIndex", "/api/system/vacuumDataIndex", NoBody, ResponseOptions{}, "POST")
	RebuildDataIndex                    = define[EmptyRequest, Null]("rebuildDataIndex", "/api/system/rebuildDataIndex", NoBody, ResponseOptions{}, "POST")
	IgnoreAddMicrosoftDefenderExclusion = define[EmptyRequest, Null]("ignoreAddMicrosoftDefenderExclusion", "/api/system/ignoreAddMicrosoftDefenderExclusion", NoBody, ResponseOptions{}, "POST")
	AddMicrosoftDefenderExclusion       = define[EmptyRequest, Null]("addMicrosoftDefenderExclusion", "/api/system/addMicrosoftDefenderExclusion", NoBody, ResponseOptions{}, "POST")
	GetWorkspaceInfo                    = define[EmptyRequest, WorkspaceInfoData]("getWorkspaceInfo", "/api/system/getWorkspaceInfo", NoBody, ResponseOptions{}, "POST")
	GetNetwork                          = define[EmptyRequest, NetworkData]("getNetwork", "/api/system/getNetwork", NoBody, ResponseOptions{}, "POST")
	GetRuntimeInfo                      = define[EmptyRequest, SystemRuntimeInfoData]("getRuntimeInfo", "/api/system/getRuntimeInfo", NoBody, ResponseOptions{}, "POST")
	CurrentTime                         = define[EmptyRequest, int64]("currentTime", "/api/system/currentTime", NoBody, ResponseOptions{}, "POST")
	BootProgress                        = define[EmptyRequest, BootProgressData]("bootProgress", "/api/system/bootProgress", NoBody, ResponseOptions{}, "GET", "POST")
	SetFollowSystemLockScreen           = define[LockScreenRequest, Null]("setFollowSystemLockScreen", "/api/system/setFollowSystemLockScreen", JSONBody, ResponseOptions{}, "POST")
	SetAutoLaunch                       = define[AutoLaunchRequest, Null]("setAutoLaunch", "/api/system/setAutoLaunch", JSONBody, ResponseOptions{}, "POST")
	SetDownloadInstallPkg               = define[DownloadInstallPkgRequest, Null]("setDownloadInstallPkg", "/api/system/setDownloadInstallPkg", JSONBody, ResponseOptions{}, "POST")
	SetNetworkServe                     = define[NetworkServeRequest, Null]("setNetworkServe", "/api/system/setNetworkServe", JSONBody, ResponseOptions{}, "POST")
	SetNetworkServeTLS                  = define[NetworkServeTLSRequest, Null]("setNetworkServeTLS", "/api/system/setNetworkServeTLS", JSONBody, ResponseOptions{}, "POST")
	SetUpdateChannel                    = define[UpdateChannelRequest, Null]("setUpdateChannel", "/api/system/setUpdateChannel", JSONBody, ResponseOptions{}, "POST")
	SetNetworkProxy                     = define[NetworkProxy, Null]("setNetworkProxy", "/api/system/setNetworkProxy", JSONBody, ResponseOptions{}, "POST")
	GetBookmarkLabels                   = define[EmptyRequest, []string]("getBookmarkLabels", "/api/attr/getBookmarkLabels", NoBody, ResponseOptions{}, "POST")
	BatchGetBlockAttrs                  = define[BlockIDsRequest, map[string]map[string]string]("batchGetBlockAttrs", "/api/attr/batchGetBlockAttrs", JSONBody, ResponseOptions{NonNullable: true}, "POST")
	GetDOMText                          = define[DOMTextRequest, string]("getDOMText", "/api/block/getDOMText", JSONBody, ResponseOptions{}, "POST")
	RemoveBookmark                      = define[RemoveBookmarkRequest, Null]("removeBookmark", "/api/bookmark/removeBookmark", JSONBody, ResponseOptions{}, "POST")
	RenameBookmark                      = define[RenameBookmarkRequest, Null]("renameBookmark", "/api/bookmark/renameBookmark", JSONBody, ResponseOptions{}, "POST")
	RemoveTag                           = define[RemoveTagRequest, Null]("removeTag", "/api/tag/removeTag", JSONBody, ResponseOptions{}, "POST")
	RenameTag                           = define[RenameTagRequest, Null]("renameTag", "/api/tag/renameTag", JSONBody, ResponseOptions{}, "POST")
)

var (
	SetEditorReadOnly         = define[EditorReadOnlyRequest, Null]("setEditorReadOnly", "/api/setting/setEditorReadOnly", JSONBody, ResponseOptions{}, "POST")
	AddVirtualBlockRefExclude = define[VirtualBlockRefRequest, Null]("addVirtualBlockRefExclude", "/api/setting/addVirtualBlockRefExclude", JSONBody, ResponseOptions{}, "POST")
	AddVirtualBlockRefInclude = define[VirtualBlockRefRequest, Null]("addVirtualBlockRefInclude", "/api/setting/addVirtualBlockRefInclude", JSONBody, ResponseOptions{}, "POST")
	RefreshVirtualBlockRef    = define[EmptyRequest, Null]("refreshVirtualBlockRef", "/api/setting/refreshVirtualBlockRef", NoBody, ResponseOptions{}, "POST")
	GetPandocBin              = define[EmptyRequest, string]("getPandocBin", "/api/setting/getPandocBin", NoBody, ResponseOptions{}, "POST")
	ReindexHistory            = define[EmptyRequest, Null]("reindexHistory", "/api/history/reindexHistory", NoBody, ResponseOptions{}, "POST")
	ClearWorkspaceHistory     = define[EmptyRequest, Null]("clearWorkspaceHistory", "/api/history/clearWorkspaceHistory", NoBody, ResponseOptions{}, "POST")
	BatchSetBlockAttrs        = define[BatchSetBlockAttrsRequest, Null]("batchSetBlockAttrs", "/api/attr/batchSetBlockAttrs", JSONBody, ResponseOptions{}, "POST")
	GetTag                    = define[GetTagRequest, []*TagData]("getTag", "/api/tag/getTag", JSONBody, ResponseOptions{}, "POST")
)

var (
	GetBlockSiblingID     = define[BlockQueryRequest, BlockSiblingData]("getBlockSiblingID", "/api/block/getBlockSiblingID", JSONBody, ResponseOptions{}, "POST")
	GetBlockRelevantIDs   = define[BlockQueryRequest, BlockRelevantData]("getBlockRelevantIDs", "/api/block/getBlockRelevantIDs", JSONBody, ResponseOptions{}, "POST")
	GetUnfoldedParentID   = define[BlockQueryRequest, UnfoldedParentData]("getUnfoldedParentID", "/api/block/getUnfoldedParentID", JSONBody, ResponseOptions{}, "POST")
	CheckBlockFold        = define[BlockQueryRequest, BlockFoldData]("checkBlockFold", "/api/block/checkBlockFold", JSONBody, ResponseOptions{}, "POST")
	CheckBlockExist       = define[BlockQueryRequest, bool]("checkBlockExist", "/api/block/checkBlockExist", JSONBody, ResponseOptions{}, "POST")
	GetBlockIndex         = define[BlockQueryRequest, int]("getBlockIndex", "/api/block/getBlockIndex", JSONBody, ResponseOptions{}, "POST")
	GetBlocksIndexes      = define[BlocksQueryRequest, map[string]int]("getBlocksIndexes", "/api/block/getBlocksIndexes", JSONBody, ResponseOptions{}, "POST")
	GetHeadingChildrenIDs = define[BlockIDRequest, []string]("getHeadingChildrenIDs", "/api/block/getHeadingChildrenIDs", JSONBody, ResponseOptions{}, "POST")
	GetHeadingChildrenDOM = define[HeadingChildrenRequest, string]("getHeadingChildrenDOM", "/api/block/getHeadingChildrenDOM", JSONBody, ResponseOptions{}, "POST")
	AppendHeadingChildren = define[AppendHeadingChildrenRequest, Null]("appendHeadingChildren", "/api/block/appendHeadingChildren", JSONBody, ResponseOptions{}, "POST")
	GetDocBlocksOrders    = define[DocOrdersRequest, []string]("getDocBlocksOrders", "/api/block/getDocBlocksOrders", JSONBody, ResponseOptions{}, "POST")
)

var (
	EnableEncryptedNotebooks             = define[NotebookPasswordRequest, Null]("enableEncryptedNotebooks", "/api/notebook/enableEncryptedNotebooks", JSONBody, ResponseOptions{}, "POST")
	DisableEncryptedNotebooks            = define[EmptyRequest, Null]("disableEncryptedNotebooks", "/api/notebook/disableEncryptedNotebooks", NoBody, ResponseOptions{}, "POST")
	CreateEncryptedNotebook              = define[CreateEncryptedNotebookRequest, CreateNotebookData]("createEncryptedNotebook", "/api/notebook/createEncryptedNotebook", JSONBody, ResponseOptions{}, "POST")
	UnlockNotebook                       = define[UnlockNotebookRequest, Null]("unlockNotebook", "/api/notebook/unlockNotebook", JSONBody, ResponseOptions{}, "POST")
	UnlockAndOpenNotebook                = define[UnlockNotebookRequest, Null]("unlockAndOpenNotebook", "/api/notebook/unlockAndOpenNotebook", JSONBody, ResponseOptions{}, "POST")
	LockNotebook                         = define[NotebookIDRequest, Null]("lockNotebook", "/api/notebook/lockNotebook", JSONBody, ResponseOptions{}, "POST")
	SetEncryptedNotebookFollowSystemLock = define[EncryptedNotebookFollowSystemLockRequest, Null]("setEncryptedNotebookFollowSystemLock", "/api/notebook/setEncryptedNotebookFollowSystemLock", JSONBody, ResponseOptions{}, "POST")
	LockEncryptedNotebooksOnSystemLock   = define[EmptyRequest, Null]("lockEncryptedNotebooksOnSystemLock", "/api/notebook/lockEncryptedNotebooksOnSystemLock", JSONBody, ResponseOptions{}, "POST")
	SetNotebookCryptoAutoLock            = define[NotebookCryptoAutoLockRequest, Null]("setNotebookCryptoAutoLock", "/api/notebook/setNotebookCryptoAutoLock", JSONBody, ResponseOptions{}, "POST")
	ChangeMasterPassword                 = define[ChangeMasterPasswordRequest, Null]("changeMasterPassword", "/api/notebook/changeMasterPassword", JSONBody, ResponseOptions{}, "POST")
	ExportNotebookCryptoBackup           = define[EmptyRequest, NotebookCryptoBackupData]("exportNotebookCryptoBackup", "/api/notebook/exportNotebookCryptoBackup", NoBody, ResponseOptions{}, "POST")
	TouchEncryptedNotebooks              = define[EmptyRequest, Null]("touchEncryptedNotebooks", "/api/notebook/touchEncryptedNotebooks", NoBody, ResponseOptions{}, "POST")
)

var (
	GetBlockDOM           = define[BlockQueryRequest, BlockDOMData]("getBlockDOM", "/api/block/getBlockDOM", JSONBody, ResponseOptions{}, "POST")
	GetBlockDOMWithEmbed  = define[BlockQueryRequest, BlockDOMData]("getBlockDOMWithEmbed", "/api/block/getBlockDOMWithEmbed", JSONBody, ResponseOptions{}, "POST")
	GetBlockDOMs          = define[BlocksQueryRequest, map[string]string]("getBlockDOMs", "/api/block/getBlockDOMs", JSONBody, ResponseOptions{}, "POST")
	GetBlockDOMsWithEmbed = define[BlocksQueryRequest, map[string]string]("getBlockDOMsWithEmbed", "/api/block/getBlockDOMsWithEmbed", JSONBody, ResponseOptions{}, "POST")
	GetBlockKramdown      = define[BlockKramdownRequest, BlockKramdownData]("getBlockKramdown", "/api/block/getBlockKramdown", JSONBody, ResponseOptions{}, "POST")
	GetBlockKramdowns     = define[BlocksKramdownRequest, map[string]string]("getBlockKramdowns", "/api/block/getBlockKramdowns", JSONBody, ResponseOptions{}, "POST")
)

var (
	GetRefText                  = define[BlockQueryRequest, string]("getRefText", "/api/block/getRefText", JSONBody, ResponseOptions{}, "POST")
	GetRefIDs                   = define[RefIDsRequest, RefIDsData]("getRefIDs", "/api/block/getRefIDs", JSONBody, ResponseOptions{}, "POST")
	GetRefIDsByFileAnnotationID = define[FileAnnotationRefRequest, RefDefsData]("getRefIDsByFileAnnotationID", "/api/block/getRefIDsByFileAnnotationID", JSONBody, ResponseOptions{}, "POST")
	GetBlockDefIDsByRefText     = define[RefTextQueryRequest, RefDefsData]("getBlockDefIDsByRefText", "/api/block/getBlockDefIDsByRefText", JSONBody, ResponseOptions{}, "POST")
)

var (
	GetBlockTreeInfos          = define[BlocksQueryRequest, map[string]*BlockTreeInfo]("getBlockTreeInfos", "/api/block/getBlockTreeInfos", JSONBody, ResponseOptions{}, "POST")
	GetBlockBreadcrumb         = define[BlockBreadcrumbRequest, []*BlockPath]("getBlockBreadcrumb", "/api/block/getBlockBreadcrumb", JSONBody, ResponseOptions{}, "POST")
	GetBlockBreadcrumbChildren = define[BlockBreadcrumbChildrenRequest, *BlockBreadcrumbChildren]("getBlockBreadcrumbChildren", "/api/block/getBlockBreadcrumbChildren", JSONBody, ResponseOptions{}, "POST")
)

var GetDocInfo = define[BlockQueryRequest, *DocInfo]("getDocInfo", "/api/block/getDocInfo", JSONBody, ResponseOptions{}, "POST")

var GetDocsInfo = define[DocsInfoRequest, []*DocInfo]("getDocsInfo", "/api/block/getDocsInfo", JSONBody, ResponseOptions{}, "POST")

var GetTreeStat = define[TreeStatRequest, TreeStatData]("getTreeStat", "/api/block/getTreeStat", JSONBody, ResponseOptions{}, "POST")

var TransferBlockRef = define[TransferBlockRefRequest, Null]("transferBlockRef", "/api/block/transferBlockRef", JSONBody, ResponseOptions{}, "POST")

var SwapBlockRef = define[SwapBlockRefRequest, Null]("swapBlockRef", "/api/block/swapBlockRef", JSONBody, ResponseOptions{}, "POST")

var SetBlockReminder = define[BlockReminderRequest, Null]("setBlockReminder", "/api/block/setBlockReminder", JSONBody, ResponseOptions{}, "POST")

var UnfoldBlock = define[BlockIDRequest, Null]("unfoldBlock", "/api/block/unfoldBlock", JSONBody, ResponseOptions{}, "POST")

var FoldBlock = define[BlockIDRequest, Null]("foldBlock", "/api/block/foldBlock", JSONBody, ResponseOptions{}, "POST")

var MoveBlock = define[MoveBlockRequest, Null]("moveBlock", "/api/block/moveBlock", JSONBody, ResponseOptions{}, "POST")

var GetHeadingDeleteTransaction = define[BlockIDRequest, *BlockTransaction]("getHeadingDeleteTransaction", "/api/block/getHeadingDeleteTransaction", JSONBody, ResponseOptions{}, "POST")

var GetHeadingInsertTransaction = define[BlockIDRequest, *BlockTransaction]("getHeadingInsertTransaction", "/api/block/getHeadingInsertTransaction", JSONBody, ResponseOptions{}, "POST")

var GetHeadingFoldTransaction = define[HeadingFoldRequest, *BlockTransaction]("getHeadingFoldTransaction", "/api/block/getHeadingFoldTransaction", JSONBody, ResponseOptions{}, "POST")

var UpdateTaskListItemMarker = define[TaskListMarkerRequest, []*BlockTransaction]("updateTaskListItemMarker", "/api/block/updateTaskListItemMarker", JSONBody, ResponseOptions{}, "POST")

var BatchUpdateTaskListItemMarker = define[BatchTaskListMarkerRequest, []*BlockTransaction]("batchUpdateTaskListItemMarker", "/api/block/batchUpdateTaskListItemMarker", JSONBody, ResponseOptions{}, "POST")

var MoveOutlineHeading = define[MoveBlockRequest, []*BlockTransaction]("moveOutlineHeading", "/api/block/moveOutlineHeading", JSONBody, ResponseOptions{}, "POST")

var AppendDailyNoteBlock = define[DailyNoteBlockRequest, []*BlockTransaction]("appendDailyNoteBlock", "/api/block/appendDailyNoteBlock", JSONBody, ResponseOptions{}, "POST")

var PrependDailyNoteBlock = define[DailyNoteBlockRequest, []*BlockTransaction]("prependDailyNoteBlock", "/api/block/prependDailyNoteBlock", JSONBody, ResponseOptions{}, "POST")

var AppendBlock = define[AppendBlockRequest, []*BlockTransaction]("appendBlock", "/api/block/appendBlock", JSONBody, ResponseOptions{}, "POST")

var PrependBlock = define[PrependBlockRequest, []*BlockTransaction]("prependBlock", "/api/block/prependBlock", JSONBody, ResponseOptions{}, "POST")

var BatchAppendBlock = define[BatchParentBlockRequest, []*BlockTransaction]("batchAppendBlock", "/api/block/batchAppendBlock", JSONBody, ResponseOptions{}, "POST")

var BatchPrependBlock = define[BatchParentBlockRequest, []*BlockTransaction]("batchPrependBlock", "/api/block/batchPrependBlock", JSONBody, ResponseOptions{}, "POST")

var InsertBlock = define[InsertBlockRequest, []*BlockTransaction]("insertBlock", "/api/block/insertBlock", JSONBody, ResponseOptions{}, "POST")

var BatchInsertBlock = define[BatchInsertBlockRequest, []*BlockTransaction]("batchInsertBlock", "/api/block/batchInsertBlock", JSONBody, ResponseOptions{}, "POST")

var UpdateBlock = define[UpdateBlockRequest, []*BlockTransaction]("updateBlock", "/api/block/updateBlock", JSONBody, ResponseOptions{}, "POST")

var MigrateLegacyMindmaps = define[MigrateLegacyMindmapsRequest, MigrateLegacyMindmapsData]("migrateLegacyMindmaps", "/api/block/migrateLegacyMindmaps", JSONBody, ResponseOptions{}, "POST")

var BatchUpdateBlock = define[BatchUpdateBlockRequest, []*BlockTransaction]("batchUpdateBlock", "/api/block/batchUpdateBlock", JSONBody, ResponseOptions{}, "POST")

var DeleteBlock = define[DeleteBlockRequest, []*BlockTransaction]("deleteBlock", "/api/block/deleteBlock", JSONBody, ResponseOptions{}, "POST")

var CheckBlockRef = define[CheckBlockRefRequest, bool]("checkBlockRef", "/api/block/checkBlockRef", JSONBody, ResponseOptions{DataOnError: true}, "POST")

var GetHeadingLevelTransaction = define[HeadingLevelRequest, *BlockTransaction]("getHeadingLevelTransaction", "/api/block/getHeadingLevelTransaction", JSONBody, ResponseOptions{}, "POST")

var GetDocHeadingLevelTransaction = define[DocHeadingLevelRequest, *DocHeadingLevelData]("getDocHeadingLevelTransaction", "/api/block/getDocHeadingLevelTransaction", StructJSONBody, ResponseOptions{}, "POST")

var GetRecentUpdatedBlocks = define[EmptyRequest, []*SearchBlock]("getRecentUpdatedBlocks", "/api/block/getRecentUpdatedBlocks", NoBody, ResponseOptions{}, "POST")

var Zip = define[ZipRequest, Null]("zip", "/api/archive/zip", JSONBody, ResponseOptions{}, "POST")
var Unzip = define[UnzipRequest, Null]("unzip", "/api/archive/unzip", JSONBody, ResponseOptions{}, "POST")
var AutoSpace = define[TrimmedIDRequest, Null]("autoSpace", "/api/format/autoSpace", JSONBody, ResponseOptions{}, "POST")
var NetAssets2LocalAssets = define[TrimmedIDRequest, Null]("netAssets2LocalAssets", "/api/format/netAssets2LocalAssets", JSONBody, ResponseOptions{}, "POST")
var NetImg2LocalAssets = define[NetImageAssetsRequest, Null]("netImg2LocalAssets", "/api/format/netImg2LocalAssets", JSONBody, ResponseOptions{}, "POST")
var PushMsg = define[NotificationRequest, NotificationData]("pushMsg", "/api/notification/pushMsg", JSONBody, ResponseOptions{}, "POST")
var PushErrMsg = define[NotificationRequest, NotificationData]("pushErrMsg", "/api/notification/pushErrMsg", JSONBody, ResponseOptions{}, "POST")
var GetBookmark = define[EmptyRequest, []*Bookmark]("getBookmark", "/api/bookmark/getBookmark", NoBody, ResponseOptions{}, "POST")
var GetSnippet = define[GetSnippetRequest, SnippetsData]("getSnippet", "/api/snippet/getSnippet", JSONBody, ResponseOptions{}, "POST")
var SetSnippet = define[SetSnippetRequest, Null]("setSnippet", "/api/snippet/setSnippet", JSONBody, ResponseOptions{}, "POST")
var RemoveSnippet = define[TrimmedIDRequest, *Snippet]("removeSnippet", "/api/snippet/removeSnippet", JSONBody, ResponseOptions{}, "POST")
var FlushTransaction = define[EmptyRequest, Null]("flushTransaction", "/api/sqlite/flushTransaction", NoBody, ResponseOptions{}, "POST")
var CopyStdMarkdown = define[CopyStdMarkdownRequest, string]("copyStdMarkdown", "/api/lute/copyStdMarkdown", JSONBody, ResponseOptions{}, "POST")
var Md2HTML = define[MarkdownHTMLRequest, HTMLData]("md2HTML", "/api/lute/md2html", JSONBody, ResponseOptions{}, "POST")
var SpinBlockDOM = define[DOMTextRequest, DOMData]("spinBlockDOM", "/api/lute/spinBlockDOM", JSONBody, ResponseOptions{AdditionalCodes: []int{413}}, "POST")

var ReloadTag = define[EmptyRequest, Null]("reloadTag", "/api/ui/reloadTag", NoBody, ResponseOptions{}, "POST")
var ReloadFiletree = define[EmptyRequest, Null]("reloadFiletree", "/api/ui/reloadFiletree", NoBody, ResponseOptions{}, "POST")
var ReloadProtyle = define[BlockIDRequest, Null]("reloadProtyle", "/api/ui/reloadProtyle", JSONBody, ResponseOptions{}, "POST")
var ReloadAttributeView = define[BlockIDRequest, Null]("reloadAttributeView", "/api/ui/reloadAttributeView", JSONBody, ResponseOptions{}, "POST")
var ReloadUI = define[EmptyRequest, Null]("reloadUI", "/api/ui/reloadUI", NoBody, ResponseOptions{}, "POST")
var ReloadIcon = define[EmptyRequest, Null]("reloadIcon", "/api/ui/reloadIcon", NoBody, ResponseOptions{}, "POST")
var ReloadTheme = define[EmptyRequest, Null]("reloadTheme", "/api/ui/reloadTheme", NoBody, ResponseOptions{}, "POST")

var GetLocalStorage = define[EmptyRequest, map[string]JSONValue]("getLocalStorage", "/api/storage/getLocalStorage", NoBody, ResponseOptions{}, "POST")
var GetLocalStorageVal = define[StorageKeyRequest, JSONValue]("getLocalStorageVal", "/api/storage/getLocalStorageVal", JSONBody, ResponseOptions{}, "POST")
var GetLocalStorageVals = define[StorageKeysRequest, map[string]JSONValue]("getLocalStorageVals", "/api/storage/getLocalStorageVals", JSONBody, ResponseOptions{}, "POST")
var SetLocalStorageVal = define[StorageSetRequest, Null]("setLocalStorageVal", "/api/storage/setLocalStorageVal", JSONBody, ResponseOptions{}, "POST")
var SetLocalStorageVals = define[StorageSetKeysRequest, Null]("setLocalStorageVals", "/api/storage/setLocalStorageVals", JSONBody, ResponseOptions{}, "POST")
var RemoveLocalStorageVal = define[StorageRemoveRequest, Null]("removeLocalStorageVal", "/api/storage/removeLocalStorageVal", JSONBody, ResponseOptions{}, "POST")
var RemoveLocalStorageVals = define[StorageRemoveKeysRequest, Null]("removeLocalStorageVals", "/api/storage/removeLocalStorageVals", JSONBody, ResponseOptions{}, "POST")
var GetOutlineStorage = define[OutlineStorageRequest, map[string]JSONValue]("getOutlineStorage", "/api/storage/getOutlineStorage", JSONBody, ResponseOptions{}, "POST")
var SetOutlineStorage = define[OutlineStorageSetRequest, Null]("setOutlineStorage", "/api/storage/setOutlineStorage", JSONBody, ResponseOptions{}, "POST")
var RemoveOutlineStorage = define[OutlineStorageRequest, Null]("removeOutlineStorage", "/api/storage/removeOutlineStorage", JSONBody, ResponseOptions{}, "POST")
var GetViewState = define[StorageKeyRequest, map[string]JSONValue]("getViewState", "/api/storage/getViewState", JSONBody, ResponseOptions{}, "POST")
var PatchViewState = define[ViewStatePatchRequest, map[string]JSONValue]("patchViewState", "/api/storage/patchViewState", JSONBody, ResponseOptions{}, "POST")
var RemoveViewState = define[StorageKeyRequest, Null]("removeViewState", "/api/storage/removeViewState", JSONBody, ResponseOptions{}, "POST")
var GetRecentDocs = define[RecentDocsRequest, []*RecentDoc]("getRecentDocs", "/api/storage/getRecentDocs", LegacyOptionalBody, ResponseOptions{}, "POST")

var ResetBlockAttrs = define[EmptyRequest, Null]("resetBlockAttrs", "/api/attr/resetBlockAttrs", NoBody, ResponseOptions{}, "POST")
var SearchAttributeViewNonRelationKey = define[EmptyRequest, Null]("searchAttributeViewNonRelationKey", "/api/av/searchAttributeViewNonRelationKey", NoBody, ResponseOptions{}, "POST")
var SetLocalStorage = define[EmptyRequest, Null]("setLocalStorage", "/api/storage/setLocalStorage", NoBody, ResponseOptions{}, "POST")
var DeprecatedReloadUI = define[EmptyRequest, Null]("deprecatedReloadUI", "/api/system/reloadUI", NoBody, ResponseOptions{}, "POST")

var GetCriteria = define[EmptyRequest, []*Criterion]("getCriteria", "/api/storage/getCriteria", NoBody, ResponseOptions{}, "POST")
var SetCriterion = define[SetCriterionRequest, Null]("setCriterion", "/api/storage/setCriterion", JSONBody, ResponseOptions{}, "POST")
var RemoveCriterion = define[RemoveCriterionRequest, Null]("removeCriterion", "/api/storage/removeCriterion", JSONBody, ResponseOptions{}, "POST")

var UpdateRecentDocOpenTime = define[RecentDocUpdateRequest, Null]("updateRecentDocOpenTime", "/api/storage/updateRecentDocOpenTime", JSONBody, ResponseOptions{}, "POST")
var UpdateRecentDocViewTime = define[RecentDocUpdateRequest, Null]("updateRecentDocViewTime", "/api/storage/updateRecentDocViewTime", JSONBody, ResponseOptions{}, "POST")
var UpdateRecentDocCloseTime = define[RecentDocUpdateRequest, Null]("updateRecentDocCloseTime", "/api/storage/updateRecentDocCloseTime", JSONBody, ResponseOptions{}, "POST")
var BatchUpdateRecentDocCloseTime = define[RecentDocsUpdateRequest, Null]("batchUpdateRecentDocCloseTime", "/api/storage/batchUpdateRecentDocCloseTime", JSONBody, ResponseOptions{}, "POST")

var GetDocOutline = define[OutlineRequest, []*SearchPath]("getDocOutline", "/api/outline/getDocOutline", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetDocHeadingNumbers = define[HeadingNumbersRequest, map[string]string]("getDocHeadingNumbers", "/api/outline/getDocHeadingNumbers", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var GetInlineStyles = define[EmptyRequest, *InlineStyles]("getInlineStyles", "/api/storage/getInlineStyles", NoBody, ResponseOptions{}, "POST")
var SetInlineStyles = define[SetInlineStylesRequest, *InlineStyles]("setInlineStyles", "/api/storage/setInlineStyles", JSONBody, ResponseOptions{}, "POST")
var SetWorkspaceAVPalette = define[WorkspaceAVPaletteRequest, *InlineStyles]("setWorkspaceAVPalette", "/api/storage/setWorkspaceAVPalette", JSONBody, ResponseOptions{}, "POST")

var HTML2BlockDOM = define[HTMLClipboardRequest, HTMLClipboardData]("html2BlockDOM", "/api/lute/html2BlockDOM", JSONBody, ResponseOptions{}, "POST")

var WPSPresentation2BlockDOM = define[WPSPresentationRequest, WPSPresentationData]("wpsPresentation2BlockDOM", "/api/lute/wpsPresentation2BlockDOM", JSONBody, ResponseOptions{DataOnError: true}, "POST")

var LoadPetals = define[LoadPetalsRequest, []*Petal]("loadPetals", "/api/petal/loadPetals", JSONBody, ResponseOptions{}, "POST")

var SetPetalEnabled = define[SetPetalEnabledRequest, *Petal]("setPetalEnabled", "/api/petal/setPetalEnabled", JSONBody, ResponseOptions{}, "POST")

var SetPetalPublishEnabled = define[SetPetalPublishEnabledRequest, *Petal]("setPetalPublishEnabled", "/api/petal/setPetalPublishEnabled", JSONBody, ResponseOptions{}, "POST")

var GetPluginPublishInfo = define[PluginPublishRequest, PluginPublishInfo]("getPluginPublishInfo", "/api/petal/getPluginPublishInfo", JSONBody, ResponseOptions{AdditionalCodes: []int{400, 403, 500}}, "POST")
var SetPluginPublishDataGrant = define[SetPluginPublishDataGrantRequest, Null]("setPluginPublishDataGrant", "/api/petal/setPluginPublishDataGrant", JSONBody, ResponseOptions{AdditionalCodes: []int{400, 403, 500}}, "POST")
var SavePluginPublishData = define[SavePluginPublishDataRequest, Null]("savePluginPublishData", "/api/petal/savePluginPublishData", JSONBody, ResponseOptions{AdditionalCodes: []int{400, 403, 500}}, "POST")
var LoadPluginPublishData = define[PluginPublishRequest, map[string]PublishDataValue]("loadPluginPublishData", "/api/petal/loadPluginPublishData", JSONBody, ResponseOptions{NonNullable: true, AdditionalCodes: []int{400, 403, 404, 500}}, "POST")

var Pandoc = define[PandocRequest, PandocData]("pandoc", "/api/convert/pandoc", JSONBody, ResponseOptions{}, "POST")

var PostBroadcastMessage = define[BroadcastMessageRequest, BroadcastChannelData]("postMessage", "/api/broadcast/postMessage", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var GetBroadcastChannelInfo = define[BroadcastChannelRequest, BroadcastChannelData]("getChannelInfo", "/api/broadcast/getChannelInfo", JSONBody, ResponseOptions{}, "POST")

var GetBroadcastChannels = define[EmptyRequest, BroadcastChannelsData]("getChannels", "/api/broadcast/getChannels", NoBody, ResponseOptions{}, "POST")

var BroadcastPublish = define[MultipartFields, BroadcastPublishData]("broadcastPublish", "/api/broadcast/publish", MultipartBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var SetCloudReminder = define[CloudReminderRequest, Null]("setCloudReminder", "/api/cloud/setCloudReminder", JSONBody, ResponseOptions{}, "POST")
var GetCloudSpace = define[EmptyRequest, CloudSpaceData]("getCloudSpace", "/api/cloud/getCloudSpace", NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var RemoveShorthands = define[RemoveShorthandsRequest, Null]("removeShorthands", "/api/inbox/removeShorthands", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetShorthand = define[TrimmedIDRequest, *Shorthand]("getShorthand", "/api/inbox/getShorthand", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetShorthands = define[ShorthandsRequest, *ShorthandsData]("getShorthands", "/api/inbox/getShorthands", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var ReadClipboardFilePaths = define[EmptyRequest, []ClipboardFile]("readFilePaths", "/api/clipboard/readFilePaths", NoBody, ResponseOptions{NonNullable: true}, "POST")
var WriteClipboardFilePath = define[ClipboardPathRequest, Null]("writeFilePath", "/api/clipboard/writeFilePath", JSONBody, ResponseOptions{}, "POST")
var PrepareRichText = define[PrepareRichTextRequest, *RichClipboardPrepared]("prepareRichText", "/api/clipboard/prepareRichText", JSONBody, ResponseOptions{}, "POST")
var CleanupRichText = define[CleanupRichTextRequest, Null]("cleanupRichText", "/api/clipboard/cleanupRichText", JSONBody, ResponseOptions{}, "POST")

var StartFreeTrial = define[EmptyRequest, Null]("startFreeTrial", "/api/account/startFreeTrial", NoBody, ResponseOptions{}, "POST")

var UseActivationCode = define[ActivationCodeRequest, Null]("useActivationcode", "/api/account/useActivationcode", JSONBody, ResponseOptions{}, "POST")

var CheckActivationCode = define[CheckActivationCodeRequest, Null]("checkActivationcode", "/api/account/checkActivationcode", JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")

var DeactivateUser = define[EmptyRequest, Null]("deactivateUser", "/api/account/deactivate", NoBody, ResponseOptions{}, "POST")

var AccountLogin = define[AccountLoginRequest, *AccountLoginData]("login", "/api/account/login", JSONBody, ResponseOptions{AdditionalCodes: []int{1, 10}, DataOnError: true}, "POST")

var GetUniqueFilename = define[FilePathRequest, FilePathData]("getUniqueFilename", "/api/file/getUniqueFilename", JSONBody, ResponseOptions{AdditionalCodes: []int{-3}}, "POST")

var ReadDirectory = define[ReadDirectoryRequest, []DirectoryEntry]("readDir", "/api/file/readDir", JSONBody, ResponseOptions{AdditionalCodes: []int{-3, 403, 404, 409, 500}, NonNullable: true}, "POST")

var RenameFile = define[RenameFileRequest, Null]("renameFile", "/api/file/renameFile", JSONBody, ResponseOptions{AdditionalCodes: []int{-3, 403, 404, 409, 500}}, "POST")

var RemoveFile = define[RemoveFileRequest, Null]("removeFile", "/api/file/removeFile", JSONBody, ResponseOptions{AdditionalCodes: []int{-3, 403, 404, 500}}, "POST")

var GlobalCopyFiles = define[CopyFilesRequest, Null]("globalCopyFiles", "/api/file/globalCopyFiles", JSONBody, ResponseOptions{AdditionalCodes: []int{-2, -3, 403}}, "POST")

var WorkspaceCopyFiles = define[CopyFilesRequest, Null]("workspaceCopyFiles", "/api/file/workspaceCopyFiles", JSONBody, ResponseOptions{AdditionalCodes: []int{-2, -3, 403}}, "POST")

var CopyFile = define[CopyFileRequest, Null]("copyFile", "/api/file/copyFile", JSONBody, ResponseOptions{AdditionalCodes: []int{-2}}, "POST")

var PutFile = define[PutFileRequest, Null]("putFile", "/api/file/putFile", FormBody, ResponseOptions{AdditionalCodes: []int{-3, 400, 403, 500}}, "POST")

var GetFile = define[FilePathRequest, BinaryContent]("getFile", "/api/file/getFile", JSONBody,
	ResponseOptions{Output: BinaryOutput, ErrorStatus: 202, AdditionalCodes: []int{-3, 403, 404, 409, 500, 503}}, "POST")

var QuerySQL = define[SQLQueryRequest, SQLRows]("SQL", "/api/query/sql", JSONBody, ResponseOptions{AdditionalCodes: []int{1}, NonNullable: true}, "POST")

var RenderSprig = define[RenderSprigRequest, string]("renderSprig", "/api/template/renderSprig", JSONBody, ResponseOptions{}, "POST")

var GetDocSaveAsTemplateInfo = define[TemplateDocumentRequest, TemplateDocumentInfo]("getDocSaveAsTemplateInfo", "/api/template/getDocSaveAsTemplateInfo", JSONBody, ResponseOptions{}, "POST")

var DocSaveAsTemplate = define[SaveTemplateRequest, Null]("docSaveAsTemplate", "/api/template/docSaveAsTemplate", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var RenderTemplate = define[RenderTemplateRequest, RenderTemplateData]("renderTemplate", "/api/template/render", JSONBody, ResponseOptions{}, "POST")

var ManageTemplateFiles = define[TemplateFileRequest, TemplateManagementData]("manageTemplateFiles", "/api/template/manage", StructJSONBody, ResponseOptions{}, "POST")

var ResetGraph = define[EmptyRequest, ResetGraphData]("resetGraph", "/api/graph/resetGraph", NoBody, ResponseOptions{}, "POST")

var ResetLocalGraph = define[EmptyRequest, ResetLocalGraphData]("resetLocalGraph", "/api/graph/resetLocalGraph", NoBody, ResponseOptions{}, "POST")

var SetGraphConf = define[SetGraphConfRequest, GraphConfigurationData]("setGraphConf", "/api/graph/setGraphConf", JSONBody, ResponseOptions{}, "POST")

var GetGraph = define[GlobalGraphRequest, GlobalGraphData]("getGraph", "/api/graph/getGraph", JSONBody, ResponseOptions{DataOnError: true}, "POST")

var GetLocalGraph = define[LocalGraphRequest, LocalGraphData]("getLocalGraph", "/api/graph/getLocalGraph", JSONBody, ResponseOptions{DataOnError: true}, "POST")

var RefreshBacklink = define[RefreshBacklinkRequest, Null]("refreshBacklink", "/api/ref/refreshBacklink", JSONBody, ResponseOptions{}, "POST")

var GetBackmentionDoc = define[BackmentionDocumentRequest, BacklinkContextData]("getBackmentionDoc", "/api/ref/getBackmentionDoc", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var GetBacklinkDoc = define[BacklinkDocumentRequest, BacklinkContextData]("getBacklinkDoc", "/api/ref/getBacklinkDoc", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var GetBacklink2 = define[BacklinkListRequest, BacklinkListData]("getBacklink2", "/api/ref/getBacklink2", JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var GetGlobalBacklinks = define[GlobalBacklinkListRequest, GlobalBacklinkListData]("getGlobalBacklinks", "/api/ref/getGlobalBacklinks", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetGlobalBacklinkContexts = define[GlobalBacklinkContextRequest, GlobalBacklinkContextData]("getGlobalBacklinkContexts", "/api/ref/getGlobalBacklinkContexts", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var ContinueImportSY = define[ContinueImportSYRequest, ImportDocumentData]("continueImportSY", "/api/import/continueImportSY", JSONBody, ResponseOptions{}, "POST")

var CancelImportSY = define[ImportTokenRequest, Null]("cancelImportSY", "/api/import/cancelImportSY", JSONBody, ResponseOptions{}, "POST")

var StartObsidianVaultAnalysis = define[ObsidianAnalysisRequest, *ObsidianVaultTask]("startObsidianVaultAnalysis", "/api/import/startObsidianVaultAnalysis", JSONBody, ResponseOptions{}, "POST")

var GetObsidianVaultTask = define[ObsidianTaskRequest, *ObsidianVaultTask]("getObsidianVaultTask", "/api/import/getObsidianVaultTask", JSONBody, ResponseOptions{}, "POST")

var StartObsidianVaultImport = define[ObsidianImportRequest, *ObsidianVaultTask]("startObsidianVaultImport", "/api/import/startObsidianVaultImport", JSONBody, ResponseOptions{}, "POST")

var CancelObsidianVaultTask = define[ObsidianTaskRequest, *ObsidianVaultTask]("cancelObsidianVaultTask", "/api/import/cancelObsidianVaultTask", JSONBody, ResponseOptions{DataOnError: true}, "POST")

var ImportStdMd = define[ImportMarkdownRequest, Null]("importStdMd", "/api/import/importStdMd", JSONBody, ResponseOptions{}, "POST")

var ImportData = define[ImportDataRequest, Null]("importData", "/api/import/importData", MultipartBody, ResponseOptions{}, "POST")

var ImportZipMd = define[ImportZipMarkdownRequest, Null]("importZipMd", "/api/import/importZipMd", MultipartBody, ResponseOptions{}, "POST")

var ImportSY = define[ImportSYRequest, Null]("importSY", "/api/import/importSY", MultipartBody, ResponseOptions{}, "POST")

var ImportSYNotebook = define[ImportDataRequest, ImportNotebookData]("importSYNotebook", "/api/import/importSYNotebook", MultipartBody, ResponseOptions{}, "POST")

var ImportSYAuto = define[ImportSYRequest, ImportAutoData]("importSYAuto", "/api/import/importSYAuto", MultipartBody, ResponseOptions{DataOnError: true}, "POST")

var GetHistoryItems = define[HistoryItemsRequest, HistoryItemsData]("getHistoryItems", "/api/history/getHistoryItems", JSONBody, ResponseOptions{}, "POST")

var GetNotebookHistory = define[EmptyRequest, NotebookHistoryData]("getNotebookHistory", "/api/history/getNotebookHistory", NoBody, ResponseOptions{}, "POST")

var GetDocHistoryContent = define[DocHistoryContentRequest, DocHistoryContentData]("getDocHistoryContent", "/api/history/getDocHistoryContent", JSONBody, ResponseOptions{}, "POST")

var CreateDocHistory = define[CreateDocHistoryRequest, Null]("createDocHistory", "/api/history/createDocHistory", JSONBody, ResponseOptions{}, "POST")

var CreateAssetHistory = define[CreateAssetHistoryRequest, Null]("createAssetHistory", "/api/history/createAssetHistory", JSONBody, ResponseOptions{}, "POST")

var RollbackDocHistory = define[HistoryPathRequest, Null]("rollbackDocHistory", "/api/history/rollbackDocHistory", JSONBody, ResponseOptions{}, "POST")

var RollbackAssetsHistory = define[HistoryPathRequest, Null]("rollbackAssetsHistory", "/api/history/rollbackAssetsHistory", JSONBody, ResponseOptions{}, "POST")

var RollbackNotebookHistory = define[HistoryPathRequest, Null]("rollbackNotebookHistory", "/api/history/rollbackNotebookHistory", JSONBody, ResponseOptions{}, "POST")

var RollbackAttributeViewHistory = define[HistoryPathRequest, Null]("rollbackAttributeViewHistory", "/api/history/rollbackAttributeViewHistory", JSONBody, ResponseOptions{}, "POST")

var DiffDocVersions = define[DiffDocVersionsRequest, *DocVersionDiffResult]("diffDocVersions", "/api/history/diffDocVersions", JSONBody, ResponseOptions{}, "POST")

var SearchAssetByName = define[SearchAssetRequest, []*SearchAsset]("searchAsset", "/api/search/searchAsset", JSONBody, ResponseOptions{}, "POST")

var SearchWidget = define[SearchKeywordRequest, SearchWidgetData]("searchWidget", "/api/search/searchWidget", JSONBody, ResponseOptions{}, "POST")

var SearchTemplate = define[SearchKeywordRequest, SearchTemplateData]("searchTemplate", "/api/search/searchTemplate", JSONBody, ResponseOptions{}, "POST")

var RemoveSearchTemplate = define[SearchPathRequest, Null]("removeTemplate", "/api/search/removeTemplate", JSONBody, ResponseOptions{}, "POST")

var GetAssetContent = define[AssetContentRequest, AssetContentData]("getAssetContent", "/api/search/getAssetContent", JSONBody, ResponseOptions{}, "POST")

var GetAssetContentByPath = define[SearchPathRequest, AssetContentData]("getAssetContentByPath", "/api/search/getAssetContentByPath", JSONBody, ResponseOptions{}, "POST")

var ListInvalidBlockRefs = define[SearchPageRequest, SearchBlocksData]("listInvalidBlockRefs", "/api/search/listInvalidBlockRefs", JSONBody, ResponseOptions{}, "POST")

var UpdateEmbedBlock = define[UpdateEmbedBlockRequest, Null]("updateEmbedBlock", "/api/search/updateEmbedBlock", JSONBody, ResponseOptions{}, "POST")

var FullTextSearchAssetContent = define[SearchAssetContentRequest, SearchAssetContentData]("fullTextSearchAssetContent", "/api/search/fullTextSearchAssetContent", JSONBody, ResponseOptions{}, "POST")

var GetEmbedBlock = define[GetEmbedBlockRequest, EmbedBlocksData]("getEmbedBlock", "/api/search/getEmbedBlock", JSONBody, ResponseOptions{}, "POST")

var SearchEmbedBlock = define[SearchEmbedBlockRequest, EmbedBlocksData]("searchEmbedBlock", "/api/search/searchEmbedBlock", JSONBody, ResponseOptions{}, "POST")

var FindReplace = define[FindReplaceRequest, Null]("findReplace", "/api/search/findReplace", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var SemanticSearchBlock = define[SearchBlockRequest, SearchBlocksData]("semanticSearchBlock", "/api/search/semanticSearchBlock", JSONBody, ResponseOptions{}, "POST")

var FullTextSearchBlock = define[FullTextSearchBlockRequest, *FullTextSearchBlockData]("fullTextSearchBlock", "/api/search/fullTextSearchBlock", JSONBody, ResponseOptions{}, "POST")

var SearchRefBlock = define[SearchRefBlockRequest, SearchRefData]("searchRefBlock", "/api/search/searchRefBlock", JSONBody, ResponseOptions{DataOnError: true}, "POST")

var ListLoadedPlugins = define[EmptyRequest, []*LoadedPlugin]("listLoadedPlugins", "/api/plugin/listLoadedPlugins", NoBody, ResponseOptions{}, "POST")

var ListLoadedPluginsGET = define[EmptyRequest, []*LoadedPlugin]("listLoadedPluginsGET", "/api/plugin", NoBody, ResponseOptions{}, "GET")

var GetLoadedPlugin = define[LoadedPluginRequest, *LoadedPlugin]("getLoadedPlugin", "/api/plugin/getLoadedPlugin", JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4}}, "POST")

var GetLoadedPluginRPC = define[LoadedPluginRequest, *LoadedPlugin]("getLoadedPluginRPC", "/api/plugin/rpc", JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4}}, "GET")

var GetLoadedPluginRPCByName = define[LoadedPluginRequest, *LoadedPlugin]("getLoadedPluginRPCByName", "/api/plugin/rpc/:name", JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4}}, "GET")

var PluginRPCHTTP = define[PluginRPCBatchRequest, PluginRPCResponse]("pluginJsonRpcHttp", "/api/plugin/rpc", JSONBody, ResponseOptions{Output: DirectJSONOutput, NoContent: true}, "POST")

var PluginRPCHTTPByName = define[PluginRPCBatchRequest, PluginRPCResponse]("pluginJsonRpcHttpByName", "/api/plugin/rpc/:name", JSONBody, ResponseOptions{Output: DirectJSONOutput, NoContent: true}, "POST")

var PluginRPCWebSocket = define[EmptyRequest, PluginRPCFailure]("pluginJsonRpcWebSocket", "/ws/plugin/rpc", NoBody, WebSocketOptions[PluginRPCBatchRequest, PluginRPCMessage](404), "GET")

var PluginRPCWebSocketByName = define[EmptyRequest, PluginRPCFailure]("pluginJsonRpcWebSocketByName", "/ws/plugin/rpc/:name", NoBody, WebSocketOptions[PluginRPCBatchRequest, PluginRPCMessage](404), "GET")

var InstallLocalBazaarPackage = define[InstallLocalBazaarPackageRequest, BazaarLocalInstallResult]("installLocalBazaarPackage", "/api/bazaar/installLocalBazaarPackage", MultipartBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var BatchUpdatePackage = define[BatchUpdatePackageRequest, Null]("batchUpdatePackage", "/api/bazaar/batchUpdatePackage", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetUpdatedPackage = define[GetUpdatedPackageRequest, BazaarUpdatedData]("getUpdatedPackage", "/api/bazaar/getUpdatedPackage", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UpdateBazaarPackage = define[UpdateBazaarPackageRequest, BazaarPackagesData]("updateBazaarPackage", "/api/bazaar/updateBazaarPackage", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledPackageSize = define[GetInstalledPackageSizeRequest, BazaarPackageSizeData]("getInstalledPackageSize", "/api/bazaar/getInstalledPackageSize", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarPackage = define[GetBazaarPackageRequest, BazaarPackageDetail]("getBazaarPackage", "/api/bazaar/getBazaarPackage", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarPackageRatings = define[GetBazaarPackageRatingsRequest, BazaarRatingsData]("getBazaarPackageRatings", "/api/bazaar/getBazaarPackageRatings", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarPackageUserRatings = define[GetBazaarPackageUserRatingsRequest, BazaarUserRatingsResult]("getBazaarPackageUserRatings", "/api/bazaar/getBazaarPackageUserRatings", JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var GetBazaarPackageRating = define[GetBazaarPackageRatingRequest, BazaarRatingResult]("getBazaarPackageRating", "/api/bazaar/getBazaarPackageRating", JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var SetBazaarPackageRating = define[SetBazaarPackageRatingRequest, BazaarRatingResult]("setBazaarPackageRating", "/api/bazaar/setBazaarPackageRating", JSONBody, ResponseOptions{AdditionalCodes: []int{1}, DataOnError: true}, "POST")
var GetBazaarPackageREADME = define[GetBazaarPackageREADMERequest, BazaarREADMEData]("getBazaarPackageREADME", "/api/bazaar/getBazaarPackageREADME", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarPlugin = define[GetBazaarPluginRequest, BazaarPackagesData]("getBazaarPlugin", "/api/bazaar/getBazaarPlugin", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledPlugin = define[GetInstalledPluginRequest, BazaarPackagesData]("getInstalledPlugin", "/api/bazaar/getInstalledPlugin", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var InstallBazaarPlugin = define[InstallBazaarPluginRequest, BazaarPackagesData]("installBazaarPlugin", "/api/bazaar/installBazaarPlugin", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarPlugin = define[UninstallBazaarPluginRequest, BazaarPackagesData]("uninstallBazaarPlugin", "/api/bazaar/uninstallBazaarPlugin", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarWidget = define[GetBazaarWidgetRequest, BazaarPackagesData]("getBazaarWidget", "/api/bazaar/getBazaarWidget", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledWidget = define[GetInstalledWidgetRequest, BazaarPackagesData]("getInstalledWidget", "/api/bazaar/getInstalledWidget", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var InstallBazaarWidget = define[InstallBazaarWidgetRequest, BazaarPackagesData]("installBazaarWidget", "/api/bazaar/installBazaarWidget", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarWidget = define[UninstallBazaarWidgetRequest, BazaarPackagesData]("uninstallBazaarWidget", "/api/bazaar/uninstallBazaarWidget", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarIcon = define[GetBazaarIconRequest, BazaarPackagesData]("getBazaarIcon", "/api/bazaar/getBazaarIcon", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledIcon = define[GetInstalledIconRequest, BazaarPackagesData]("getInstalledIcon", "/api/bazaar/getInstalledIcon", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var InstallBazaarIcon = define[InstallBazaarIconRequest, BazaarAppearancePackagesData]("installBazaarIcon", "/api/bazaar/installBazaarIcon", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarIcon = define[UninstallBazaarIconRequest, BazaarAppearancePackagesData]("uninstallBazaarIcon", "/api/bazaar/uninstallBazaarIcon", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarTemplate = define[GetBazaarTemplateRequest, BazaarPackagesData]("getBazaarTemplate", "/api/bazaar/getBazaarTemplate", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledTemplate = define[GetInstalledTemplateRequest, BazaarPackagesData]("getInstalledTemplate", "/api/bazaar/getInstalledTemplate", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var InstallBazaarTemplate = define[InstallBazaarTemplateRequest, BazaarPackagesData]("installBazaarTemplate", "/api/bazaar/installBazaarTemplate", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarTemplate = define[UninstallBazaarTemplateRequest, BazaarPackagesData]("uninstallBazaarTemplate", "/api/bazaar/uninstallBazaarTemplate", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBazaarTheme = define[GetBazaarThemeRequest, BazaarPackagesData]("getBazaarTheme", "/api/bazaar/getBazaarTheme", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetInstalledTheme = define[GetInstalledThemeRequest, BazaarPackagesData]("getInstalledTheme", "/api/bazaar/getInstalledTheme", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var InstallBazaarTheme = define[InstallBazaarThemeRequest, BazaarAppearancePackagesData]("installBazaarTheme", "/api/bazaar/installBazaarTheme", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var UninstallBazaarTheme = define[UninstallBazaarThemeRequest, BazaarAppearancePackagesData]("uninstallBazaarTheme", "/api/bazaar/uninstallBazaarTheme", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")

var SetSyncEnable = define[SyncEnabledRequest, Null]("setSyncEnable", "/api/sync/setSyncEnable", JSONBody, ResponseOptions{}, "POST")
var SetSyncInterval = define[SyncIntervalRequest, Null]("setSyncInterval", "/api/sync/setSyncInterval", JSONBody, ResponseOptions{}, "POST")
var SetSyncPerception = define[SyncEnabledRequest, Null]("setSyncPerception", "/api/sync/setSyncPerception", JSONBody, ResponseOptions{}, "POST")
var SetSyncLAN = define[SyncLANRequest, SyncLANStatus]("setSyncLAN", "/api/sync/setSyncLAN", JSONBody, ResponseOptions{}, "POST")
var GetSyncLANStatus = define[EmptyRequest, SyncLANStatus]("getSyncLANStatus", "/api/sync/getSyncLANStatus", NoBody, ResponseOptions{}, "POST")
var SetSyncGenerateConflictDoc = define[SyncEnabledRequest, Null]("setSyncGenerateConflictDoc", "/api/sync/setSyncGenerateConflictDoc", JSONBody, ResponseOptions{}, "POST")
var SetSyncMode = define[SyncModeRequest, Null]("setSyncMode", "/api/sync/setSyncMode", JSONBody, ResponseOptions{}, "POST")
var SetSyncProvider = define[SyncProviderRequest, Null]("setSyncProvider", "/api/sync/setSyncProvider", JSONBody, ResponseOptions{}, "POST")
var SetSyncProviderS3 = define[SetSyncS3Request, SyncS3Data]("setSyncProviderS3", "/api/sync/setSyncProviderS3", JSONBody, ResponseOptions{}, "POST")
var SetSyncProviderWebDAV = define[SetSyncWebDAVRequest, SyncWebDAVData]("setSyncProviderWebDAV", "/api/sync/setSyncProviderWebDAV", JSONBody, ResponseOptions{}, "POST")
var SetSyncProviderLocal = define[SetSyncLocalRequest, SyncLocalData]("setSyncProviderLocal", "/api/sync/setSyncProviderLocal", JSONBody, ResponseOptions{}, "POST")
var SetCloudSyncDir = define[SyncNameRequest, Null]("setCloudSyncDir", "/api/sync/setCloudSyncDir", JSONBody, ResponseOptions{}, "POST")
var SetSyncAssetDownloadMode = define[SyncModeRequest, SyncAssetDownloadModeData]("setSyncAssetDownloadMode", "/api/sync/setSyncAssetDownloadMode", JSONBody, ResponseOptions{}, "POST")
var CreateCloudSyncDir = define[SyncNameRequest, Null]("createCloudSyncDir", "/api/sync/createCloudSyncDir", JSONBody, ResponseOptions{}, "POST")
var RemoveCloudSyncDir = define[SyncNameRequest, string]("removeCloudSyncDir", "/api/sync/removeCloudSyncDir", JSONBody, ResponseOptions{}, "POST")
var ListCloudSyncDir = define[EmptyRequest, CloudSyncDirsData]("listCloudSyncDir", "/api/sync/listCloudSyncDir", NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var PerformSync = define[PerformSyncRequest, Null]("performSync", "/api/sync/performSync", JSONBody, ResponseOptions{}, "POST")
var PerformBootSync = define[EmptyRequest, Null]("performBootSync", "/api/sync/performBootSync", NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetBootSync = define[EmptyRequest, Null]("getBootSync", "/api/sync/getBootSync", NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var GetSyncInfo = define[EmptyRequest, SyncInfoData]("getSyncInfo", "/api/sync/getSyncInfo", NoBody, ResponseOptions{}, "POST")
var ExportSyncProviderS3 = define[EmptyRequest, SyncProviderExportData]("exportSyncProviderS3", "/api/sync/exportSyncProviderS3", NoBody, ResponseOptions{}, "POST")
var ImportSyncProviderS3 = define[SyncProviderImportRequest, SyncS3Data]("importSyncProviderS3", "/api/sync/importSyncProviderS3", MultipartBody, ResponseOptions{DataOnError: true}, "POST")
var ExportSyncProviderWebDAV = define[EmptyRequest, SyncProviderExportData]("exportSyncProviderWebDAV", "/api/sync/exportSyncProviderWebDAV", NoBody, ResponseOptions{}, "POST")
var ImportSyncProviderWebDAV = define[SyncProviderImportRequest, SyncWebDAVData]("importSyncProviderWebDAV", "/api/sync/importSyncProviderWebDAV", MultipartBody, ResponseOptions{DataOnError: true}, "POST")

var GetRiffCardsByBlockIDs = define[RiffBlockIDsRequest, RiffBlocksData]("getRiffCardsByBlockIDs", "/api/riff/getRiffCardsByBlockIDs", JSONBody, ResponseOptions{}, "POST")
var BatchSetRiffCardsDueTime = define[SetRiffCardsDueRequest, Null]("batchSetRiffCardsDueTime", "/api/riff/batchSetRiffCardsDueTime", JSONBody, ResponseOptions{}, "POST")
var ResetRiffCards = define[ResetRiffCardsRequest, Null]("resetRiffCards", "/api/riff/resetRiffCards", JSONBody, ResponseOptions{}, "POST")
var GetNotebookRiffCards = define[RiffCardsRequest, RiffCardsData]("getNotebookRiffCards", "/api/riff/getNotebookRiffCards", JSONBody, ResponseOptions{}, "POST")
var GetTreeRiffCards = define[RiffCardsRequest, RiffCardsData]("getTreeRiffCards", "/api/riff/getTreeRiffCards", JSONBody, ResponseOptions{}, "POST")
var GetRiffCards = define[RiffCardsRequest, RiffCardsData]("getRiffCards", "/api/riff/getRiffCards", JSONBody, ResponseOptions{}, "POST")
var ReviewRiffCard = define[ReviewRiffCardRequest, Null]("reviewRiffCard", "/api/riff/reviewRiffCard", JSONBody, ResponseOptions{}, "POST")
var SkipReviewRiffCard = define[RiffCardRequest, Null]("skipReviewRiffCard", "/api/riff/skipReviewRiffCard", JSONBody, ResponseOptions{}, "POST")
var GetNotebookRiffDueCards = define[RiffNotebookDueCardsRequest, RiffDueCardsData]("getNotebookRiffDueCards", "/api/riff/getNotebookRiffDueCards", JSONBody, ResponseOptions{}, "POST")
var GetTreeRiffDueCards = define[RiffTreeDueCardsRequest, RiffDueCardsData]("getTreeRiffDueCards", "/api/riff/getTreeRiffDueCards", JSONBody, ResponseOptions{}, "POST")
var GetRiffDueCards = define[RiffDueCardsRequest, RiffDueCardsData]("getRiffDueCards", "/api/riff/getRiffDueCards", JSONBody, ResponseOptions{}, "POST")
var RemoveRiffCards = define[RiffDeckCardsRequest, *RiffDeck]("removeRiffCards", "/api/riff/removeRiffCards", JSONBody, ResponseOptions{}, "POST")
var AddRiffCards = define[RiffDeckCardsRequest, *RiffDeck]("addRiffCards", "/api/riff/addRiffCards", JSONBody, ResponseOptions{}, "POST")
var RenameRiffDeck = define[RenameRiffDeckRequest, Null]("renameRiffDeck", "/api/riff/renameRiffDeck", JSONBody, ResponseOptions{}, "POST")
var RemoveRiffDeck = define[RiffDeckRequest, Null]("removeRiffDeck", "/api/riff/removeRiffDeck", JSONBody, ResponseOptions{}, "POST")
var CreateRiffDeck = define[CreateRiffDeckRequest, *RiffDeck]("createRiffDeck", "/api/riff/createRiffDeck", JSONBody, ResponseOptions{}, "POST")
var GetRiffDecks = define[EmptyRequest, []*RiffDeck]("getRiffDecks", "/api/riff/getRiffDecks", NoBody, ResponseOptions{NonNullable: true}, "POST")

var SetRepoIndexRetentionDays = define[SetRepoIndexRetentionDaysRequest, Null]("setRepoIndexRetentionDays", "/api/repo/setRepoIndexRetentionDays", JSONBody, ResponseOptions{}, "POST")
var SetRetentionIndexesDaily = define[SetRetentionIndexesDailyRequest, Null]("setRetentionIndexesDaily", "/api/repo/setRetentionIndexesDaily", JSONBody, ResponseOptions{}, "POST")
var GetRepoFile = define[GetRepoFileRequest, BinaryContent]("getRepoFile", "/api/repo/getRepoFile", JSONBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200}, "POST")
var RollbackRepoSnapshotFile = define[RollbackRepoSnapshotFileRequest, Null]("rollbackRepoSnapshotFile", "/api/repo/rollbackRepoSnapshotFile", JSONBody, ResponseOptions{}, "POST")
var OpenRepoSnapshotFile = define[OpenRepoSnapshotFileRequest, RepoOpenFileData]("openRepoSnapshotFile", "/api/repo/openRepoSnapshotFile", JSONBody, ResponseOptions{}, "POST")
var DiffRepoSnapshots = define[DiffRepoSnapshotsRequest, RepoDiffData]("diffRepoSnapshots", "/api/repo/diffRepoSnapshots", JSONBody, ResponseOptions{}, "POST")
var CheckoutRepo = define[CheckoutRepoRequest, Null]("checkoutRepo", "/api/repo/checkoutRepo", JSONBody, ResponseOptions{}, "POST")
var DownloadCloudSnapshot = define[DownloadCloudSnapshotRequest, Null]("downloadCloudSnapshot", "/api/repo/downloadCloudSnapshot", JSONBody, ResponseOptions{}, "POST")
var UploadCloudSnapshot = define[UploadCloudSnapshotRequest, Null]("uploadCloudSnapshot", "/api/repo/uploadCloudSnapshot", JSONBody, ResponseOptions{}, "POST")
var GetRepoSnapshots = define[GetRepoSnapshotsRequest, RepoSnapshotsData]("getRepoSnapshots", "/api/repo/getRepoSnapshots", JSONBody, ResponseOptions{}, "POST")
var SearchRepoFile = define[SearchRepoFileRequest, RepoSearchData]("searchRepoFile", "/api/repo/searchRepoFile", JSONBody, ResponseOptions{}, "POST")
var GetRepoDocHistory = define[GetRepoDocHistoryRequest, RepoDocHistoryData]("getRepoDocHistory", "/api/repo/getRepoDocHistory", JSONBody, ResponseOptions{}, "POST")
var ExportRepoFile = define[ExportRepoFileRequest, RepoExportData]("exportRepoFile", "/api/repo/exportRepoFile", JSONBody, ResponseOptions{}, "POST")
var GetCloudRepoSnapshots = define[GetCloudRepoSnapshotsRequest, RepoCloudSnapshotsData]("getCloudRepoSnapshots", "/api/repo/getCloudRepoSnapshots", JSONBody, ResponseOptions{}, "POST")
var GetCloudRepoTagSnapshots = define[EmptyRequest, RepoCloudTagsData]("getCloudRepoTagSnapshots", "/api/repo/getCloudRepoTagSnapshots", NoBody, ResponseOptions{}, "POST")
var RemoveCloudRepoTagSnapshot = define[RemoveCloudRepoTagSnapshotRequest, Null]("removeCloudRepoTagSnapshot", "/api/repo/removeCloudRepoTagSnapshot", JSONBody, ResponseOptions{}, "POST")
var GetRepoTagSnapshots = define[EmptyRequest, RepoTagsData]("getRepoTagSnapshots", "/api/repo/getRepoTagSnapshots", NoBody, ResponseOptions{}, "POST")
var RemoveRepoTagSnapshot = define[RemoveRepoTagSnapshotRequest, Null]("removeRepoTagSnapshot", "/api/repo/removeRepoTagSnapshot", JSONBody, ResponseOptions{}, "POST")
var TagSnapshot = define[TagSnapshotRequest, Null]("tagSnapshot", "/api/repo/tagSnapshot", JSONBody, ResponseOptions{}, "POST")
var ImportRepoKey = define[ImportRepoKeyRequest, RepoKeyData]("importRepoKey", "/api/repo/importRepoKey", JSONBody, ResponseOptions{}, "POST")
var InitRepoKeyFromPassphrase = define[InitRepoKeyFromPassphraseRequest, RepoKeyData]("initRepoKeyFromPassphrase", "/api/repo/initRepoKeyFromPassphrase", JSONBody, ResponseOptions{}, "POST")
var InitRepoKey = define[EmptyRequest, RepoKeyData]("initRepoKey", "/api/repo/initRepoKey", NoBody, ResponseOptions{}, "POST")
var ResetRepo = define[EmptyRequest, Null]("resetRepo", "/api/repo/resetRepo", NoBody, ResponseOptions{}, "POST")
var PurgeRepo = define[EmptyRequest, Null]("purgeRepo", "/api/repo/purgeRepo", NoBody, ResponseOptions{}, "POST")
var PurgeCloudRepo = define[EmptyRequest, Null]("purgeCloudRepo", "/api/repo/purgeCloudRepo", NoBody, ResponseOptions{}, "POST")

var MoveLocalShorthands = define[FileTreeNotebookRequest, []string]("moveLocalShorthands", "/api/filetree/moveLocalShorthands", JSONBody, ResponseOptions{}, "POST")
var ListDocTree = define[FileTreePathRequest, FileTreeDocTreeData]("listDocTree", "/api/filetree/listDocTree", JSONBody, ResponseOptions{}, "POST")
var UpsertIndexes = define[FileTreePathsRequest, Null]("upsertIndexes", "/api/filetree/upsertIndexes", JSONBody, ResponseOptions{}, "POST")
var RemoveIndexes = define[FileTreePathsRequest, Null]("removeIndexes", "/api/filetree/removeIndexes", JSONBody, ResponseOptions{}, "POST")
var Doc2Heading = define[FileTreeDocHeadingRequest, FileTreeDocHeadingData]("doc2Heading", "/api/filetree/doc2Heading", JSONBody, ResponseOptions{}, "POST")
var Heading2Doc = define[FileTreeHeadingDocRequest, Null]("heading2Doc", "/api/filetree/heading2Doc", JSONBody, ResponseOptions{}, "POST")
var Li2Doc = define[FileTreeListItemDocRequest, Null]("li2Doc", "/api/filetree/li2Doc", JSONBody, ResponseOptions{}, "POST")
var GetHPathByPath = define[FileTreePathRequest, string]("getHPathByPath", "/api/filetree/getHPathByPath", JSONBody, ResponseOptions{}, "POST")
var GetHPathsByPaths = define[FileTreePathsRequest, []string]("getHPathsByPaths", "/api/filetree/getHPathsByPaths", JSONBody, ResponseOptions{}, "POST")
var GetHPathByID = define[FileTreeIDRequest, string]("getHPathByID", "/api/filetree/getHPathByID", JSONBody, ResponseOptions{}, "POST")
var GetPathByID = define[FileTreeTrimIDRequest, FileTreeDocPathData]("getPathByID", "/api/filetree/getPathByID", JSONBody, ResponseOptions{}, "POST")
var GetFullHPathByID = define[FileTreeOptionalIDRequest, *string]("getFullHPathByID", "/api/filetree/getFullHPathByID", JSONBody, ResponseOptions{}, "POST")
var GetIDsByHPath = define[FileTreeOptionalPathRequest, []string]("getIDsByHPath", "/api/filetree/getIDsByHPath", JSONBody, ResponseOptions{}, "POST")
var MoveDocs = define[FileTreeMoveRequest, Null]("moveDocs", "/api/filetree/moveDocs", JSONBody, ResponseOptions{}, "POST")
var MoveDocsByID = define[FileTreeMoveIDsRequest, Null]("moveDocsByID", "/api/filetree/moveDocsByID", JSONBody, ResponseOptions{}, "POST")
var RemoveDoc = define[FileTreePathRequest, Null]("removeDoc", "/api/filetree/removeDoc", JSONBody, ResponseOptions{}, "POST")
var RemoveDocByID = define[FileTreeTrimIDRequest, Null]("removeDocByID", "/api/filetree/removeDocByID", JSONBody, ResponseOptions{}, "POST")
var RemoveDocs = define[FileTreePathsRequest, Null]("removeDocs", "/api/filetree/removeDocs", JSONBody, ResponseOptions{}, "POST")
var RenameDoc = define[FileTreeRenameRequest, Null]("renameDoc", "/api/filetree/renameDoc", JSONBody, ResponseOptions{}, "POST")
var RenameDocByID = define[FileTreeRenameIDRequest, Null]("renameDocByID", "/api/filetree/renameDocByID", JSONBody, ResponseOptions{}, "POST")
var DuplicateDoc = define[FileTreeIDRequest, FileTreeDuplicateData]("duplicateDoc", "/api/filetree/duplicateDoc", JSONBody, ResponseOptions{}, "POST")
var DuplicateDocTree = define[FileTreeIDRequest, FileTreeDuplicateData]("duplicateDocTree", "/api/filetree/duplicateDocTree", JSONBody, ResponseOptions{}, "POST")
var CreateDoc = define[FileTreeCreateRequest, FileTreeCreateData]("createDoc", "/api/filetree/createDoc", JSONBody, ResponseOptions{}, "POST")
var CreateDailyNote = define[FileTreeDailyNoteRequest, FileTreeCreateData]("createDailyNote", "/api/filetree/createDailyNote", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var CreateDocWithMd = define[FileTreeCreateMarkdownRequest, string]("createDocWithMd", "/api/filetree/createDocWithMd", JSONBody, ResponseOptions{}, "POST")
var GetDocCreateSavePath = define[FileTreeNotebookRequest, FileTreeCreateSavePathData]("getDocCreateSavePath", "/api/filetree/getDocCreateSavePath", JSONBody, ResponseOptions{}, "POST")
var GetRefCreateSavePath = define[FileTreeNotebookRequest, FileTreeSavePathData]("getRefCreateSavePath", "/api/filetree/getRefCreateSavePath", JSONBody, ResponseOptions{}, "POST")
var GetShorthandSavePath = define[FileTreeNotebookRequest, FileTreeSavePathData]("getShorthandSavePath", "/api/filetree/getShorthandSavePath", JSONBody, ResponseOptions{}, "POST")
var ChangeSort = define[FileTreeChangeSortRequest, Null]("changeSort", "/api/filetree/changeSort", JSONBody, ResponseOptions{}, "POST")
var ReorderDocs = define[FileTreeReorderRequest, *FileTreeReorderData]("reorderDocs", "/api/filetree/reorderDocs", StructJSONBody, ResponseOptions{DataOnError: true}, "POST")
var SetSort = define[FileTreeSetSortRequest, *FileTreeSetSortData]("setSort", "/api/filetree/setSort", StructJSONBody, ResponseOptions{DataOnError: true}, "POST")
var SetDocSortMode = define[FileTreeSortModeRequest, *FileTreeSortModeData]("setDocSortMode", "/api/filetree/setDocSortMode", StructJSONBody, ResponseOptions{DataOnError: true}, "POST")
var SearchDocs = define[FileTreeSearchRequest, []*FileTreeSearchDoc]("searchDocs", "/api/filetree/searchDocs", JSONBody, ResponseOptions{}, "POST")
var ListDocsByPath = define[FileTreeListRequest, FileTreeListData]("listDocsByPath", "/api/filetree/listDocsByPath", JSONBody, ResponseOptions{}, "POST")
var GetDoc = define[FileTreeGetDocRequest, FileTreeGetDocData]("getDoc", "/api/filetree/getDoc", JSONBody, ResponseOptions{AdditionalCodes: []int{1, 3}}, "POST")
var SetPublishAccess = define[FileTreeSetPublishRequest, Null]("setPublishAccess", "/api/filetree/setPublishAccess", JSONBody, ResponseOptions{}, "POST")
var GetPublishAccess = define[FileTreePublishIDsRequest, FileTreePublishData]("getPublishAccess", "/api/filetree/getPublishAccess", JSONBody, ResponseOptions{}, "POST")
var AuthFilePublishAccess = define[FileTreeAuthPublishRequest, Null]("authFilePublishAccess", "/api/filetree/authFilePublishAccess", JSONBody, ResponseOptions{AdditionalErrorStatuses: []int{429}}, "POST")

var ExportCodeBlock = define[ExportIDRequest, ExportPathData]("exportCodeBlock", "/api/export/exportCodeBlock", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportAttributeView = define[ExportAttributeViewRequest, ExportZipData]("exportAttributeView", "/api/export/exportAttributeView", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var Export2Liandi = define[ExportIDRequest, Null]("export2Liandi", "/api/export/export2Liandi", JSONBody, ResponseOptions{}, "POST")
var ExportDataInFolder = define[ExportFolderRequest, ExportNameData]("exportDataInFolder", "/api/export/exportDataInFolder", JSONBody, ResponseOptions{}, "POST")
var ExportData = define[EmptyRequest, ExportZipData]("exportData", "/api/export/exportData", NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportResources = define[ExportResourcesRequest, ExportPathData]("exportResources", "/api/export/exportResources", JSONBody, ResponseOptions{AdditionalCodes: []int{1}, Text: true}, "POST")
var ExportNotebookMd = define[ExportNotebookMarkdownRequest, ExportNamedZipData]("exportNotebookMd", "/api/export/exportNotebookMd", JSONBody, ResponseOptions{}, "POST")
var ExportNotebooksMd = define[ExportNotebooksMarkdownRequest, ExportNamedZipData]("exportNotebooksMd", "/api/export/exportNotebooksMd", JSONBody, ResponseOptions{}, "POST")
var ExportMds = define[ExportDocumentsMarkdownRequest, ExportNamedZipData]("exportMds", "/api/export/exportMds", JSONBody, ResponseOptions{}, "POST")
var ExportMd = define[ExportMarkdownRequest, ExportNamedZipData]("exportMd", "/api/export/exportMd", JSONBody, ResponseOptions{}, "POST")
var ExportNotebookSY = define[ExportIDRequest, ExportZipData]("exportNotebookSY", "/api/export/exportNotebookSY", JSONBody, ResponseOptions{}, "POST")
var ExportNotebooksSY = define[ExportNotebooksRequest, ExportZipData]("exportNotebooksSY", "/api/export/exportNotebooksSY", JSONBody, ResponseOptions{}, "POST")
var ExportSYs = define[ExportIDsRequest, ExportZipData]("exportSYs", "/api/export/exportSYs", JSONBody, ResponseOptions{}, "POST")
var ExportSY = define[ExportIDRequest, ExportZipData]("exportSY", "/api/export/exportSY", JSONBody, ResponseOptions{}, "POST")
var ExportMdContent = define[ExportMarkdownContentRequest, ExportMarkdownContentData]("exportMdContent", "/api/export/exportMdContent", JSONBody, ResponseOptions{}, "POST")
var ExportDocx = define[ExportDocxRequest, ExportPathData]("exportDocx", "/api/export/exportDocx", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportMdHTML = define[ExportMarkdownHTMLRequest, ExportHTMLData]("exportMdHTML", "/api/export/exportMdHTML", JSONBody, ResponseOptions{}, "POST")
var ExportTempContent = define[ExportTempContentRequest, ExportURLData]("exportTempContent", "/api/export/exportTempContent", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var ExportBrowserHTML = define[ExportBrowserHTMLRequest, ExportZipData]("exportBrowserHTML", "/api/export/exportBrowserHTML", JSONBody, ResponseOptions{}, "POST")
var ExportPreviewHTML = define[ExportPreviewHTMLRequest, ExportPreviewHTMLData]("exportPreviewHTML", "/api/export/exportPreviewHTML", JSONBody, ResponseOptions{}, "POST")
var ExportHTML = define[ExportHTMLRequest, ExportHTMLData]("exportHTML", "/api/export/exportHTML", JSONBody, ResponseOptions{}, "POST")
var ProcessPDF = define[ProcessPDFRequest, Null]("processPDF", "/api/export/processPDF", JSONBody, ResponseOptions{}, "POST")
var ExportPreview = define[ExportIDRequest, ExportPreviewData]("exportPreview", "/api/export/preview", JSONBody, ResponseOptions{}, "POST")
var ExportAsFile = define[ExportAsFileRequest, ExportFileData]("exportAsFile", "/api/export/exportAsFile", MultipartBody, ResponseOptions{}, "POST")
var CopyExportFile = define[CopyExportFileRequest, Null]("copyExportFile", "/api/export/copyExportFile", JSONBody, ResponseOptions{AdditionalCodes: []int{-2}}, "POST")
var ExportEPUB = define[ExportIDRequest, ExportNamedZipData]("exportEPUB", "/api/export/exportEPUB", JSONBody, ResponseOptions{}, "POST")
var ExportRTF = define[ExportIDRequest, ExportNamedZipData]("exportRTF", "/api/export/exportRTF", JSONBody, ResponseOptions{}, "POST")
var ExportODT = define[ExportIDRequest, ExportNamedZipData]("exportODT", "/api/export/exportODT", JSONBody, ResponseOptions{}, "POST")
var ExportMediaWiki = define[ExportIDRequest, ExportNamedZipData]("exportMediaWiki", "/api/export/exportMediaWiki", JSONBody, ResponseOptions{}, "POST")
var ExportOrgMode = define[ExportIDRequest, ExportNamedZipData]("exportOrgMode", "/api/export/exportOrgMode", JSONBody, ResponseOptions{}, "POST")
var ExportOPML = define[ExportIDRequest, ExportNamedZipData]("exportOPML", "/api/export/exportOPML", JSONBody, ResponseOptions{}, "POST")
var ExportTextile = define[ExportIDRequest, ExportNamedZipData]("exportTextile", "/api/export/exportTextile", JSONBody, ResponseOptions{}, "POST")
var ExportAsciiDoc = define[ExportIDRequest, ExportNamedZipData]("exportAsciiDoc", "/api/export/exportAsciiDoc", JSONBody, ResponseOptions{}, "POST")
var ExportReStructuredText = define[ExportIDRequest, ExportNamedZipData]("exportReStructuredText", "/api/export/exportReStructuredText", JSONBody, ResponseOptions{}, "POST")

var StatAsset = define[AssetPathRequest, AssetStatData]("statAsset", "/api/asset/statAsset", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var FullReindexAssetContent = define[EmptyRequest, Null]("fullReindexAssetContent", "/api/asset/fullReindexAssetContent", NoBody, ResponseOptions{}, "POST")
var GetImageOCRText = define[AssetOCRTextRequest, AssetTextData]("getImageOCRText", "/api/asset/getImageOCRText", JSONBody, ResponseOptions{}, "POST")
var SetImageOCRText = define[SetAssetOCRTextRequest, Null]("setImageOCRText", "/api/asset/setImageOCRText", JSONBody, ResponseOptions{}, "POST")
var AssetOCR = define[AssetPathRequest, AssetOCRData]("ocr", "/api/asset/ocr", JSONBody, ResponseOptions{}, "POST")
var RenameAsset = define[RenameAssetRequest, AssetRenameData]("renameAsset", "/api/asset/renameAsset", JSONBody, ResponseOptions{}, "POST")
var FindAssetReferences = define[FindAssetReferencesRequest, AssetReferencesData]("findAssetReferences", "/api/asset/findAssetReferences", JSONBody, ResponseOptions{DataOnError: true}, "POST")
var RelinkAsset = define[RelinkAssetRequest, AssetReferencesData]("relinkAsset", "/api/asset/relinkAsset", JSONBody, ResponseOptions{DataOnError: true}, "POST")
var GetDocImageAssets = define[AssetDocumentRequest, []string]("getDocImageAssets", "/api/asset/getDocImageAssets", JSONBody, ResponseOptions{}, "POST")
var GetDocAssets = define[AssetDocumentAssetsRequest, []string]("getDocAssets", "/api/asset/getDocAssets", JSONBody, ResponseOptions{}, "POST")
var SetFileAnnotation = define[SetAssetAnnotationRequest, Null]("setFileAnnotation", "/api/asset/setFileAnnotation", JSONBody, ResponseOptions{}, "POST")
var GetFileAnnotation = define[AssetPathRequest, AssetAnnotationData]("getFileAnnotation", "/api/asset/getFileAnnotation", JSONBody, ResponseOptions{AdditionalCodes: []int{1, 403}}, "POST")
var RemoveUnusedAsset = define[AssetPathRequest, AssetPathData]("removeUnusedAsset", "/api/asset/removeUnusedAsset", JSONBody, ResponseOptions{}, "POST")

// 未引用资源扫描失败时返回标准错误，禁止使用不完整的引用集合清理资源。
var RemoveUnusedAssets = define[EmptyRequest, AssetPathsData]("removeUnusedAssets", "/api/asset/removeUnusedAssets", NoBody, ResponseOptions{}, "POST")

// 扫描失败返回标准错误，不将失败表示为成功的空列表。
var GetUnusedAssets = define[EmptyRequest, []*AssetUnusedItem]("getUnusedAssets", "/api/asset/getUnusedAssets", NoBody, ResponseOptions{}, "POST")
var GetMissingAssets = define[EmptyRequest, []*AssetUnusedItem]("getMissingAssets", "/api/asset/getMissingAssets", NoBody, ResponseOptions{}, "POST")

// ResolveAssetPath 返回普通资源路径；已解锁的加密资源返回保留原始名称的受管临时明文副本路径。
var ResolveAssetPath = define[AssetPathRequest, string]("resolveAssetPath", "/api/asset/resolveAssetPath", JSONBody, ResponseOptions{}, "POST")
var AssetUploadCloud = define[AssetCloudUploadRequest, Null]("uploadCloud", "/api/asset/uploadCloud", JSONBody, ResponseOptions{}, "POST")
var AssetUploadCloudByAssetsPaths = define[AssetPathsCloudUploadRequest, Null]("uploadCloudByAssetsPaths", "/api/asset/uploadCloudByAssetsPaths", JSONBody, ResponseOptions{}, "POST")
var InsertLocalAssets = define[InsertLocalAssetsRequest, AssetUploadData]("insertLocalAssets", "/api/asset/insertLocalAssets", JSONBody, ResponseOptions{DataOnError: true}, "POST")
var InsertCover = define[InsertCoverRequest, AssetInsertCoverData]("insertCover", "/api/asset/insertCover", JSONBody, ResponseOptions{}, "POST")
var UploadAsset = define[UploadAssetRequest, AssetUploadData]("uploadAsset", "/api/asset/upload", MultipartBody, ResponseOptions{}, "POST")

var SetConfSnippet = define[SetConfSnippetRequest, *SettingSnpt]("setConfSnippet", "/api/setting/setSnippet", JSONBody, ResponseOptions{}, "POST")
var SetBazaar = define[SetBazaarRequest, *SettingBazaar]("setBazaar", "/api/setting/setBazaar", JSONBody, ResponseOptions{}, "POST")
var SetAI = define[SetAIRequest, *SettingAI]("setAI", "/api/setting/setAI", JSONBody, ResponseOptions{}, "POST")
var SetSecrets = define[SetSecretsRequest, *SettingSecrets]("setSecrets", "/api/setting/setSecrets", JSONBody, ResponseOptions{}, "POST")
var SetVariables = define[SetVariablesRequest, *SettingVariables]("setVariables", "/api/setting/setVariables", JSONBody, ResponseOptions{}, "POST")
var SetFlashcard = define[SetFlashcardRequest, *SettingFlashcard]("setFlashcard", "/api/setting/setFlashcard", JSONBody, ResponseOptions{}, "POST")
var SetEditor = define[SetEditorRequest, *SettingEditor]("setEditor", "/api/setting/setEditor", JSONBody, ResponseOptions{}, "POST")
var SetExport = define[SetExportRequest, *SettingExport]("setExport", "/api/setting/setExport", JSONBody, ResponseOptions{}, "POST")
var SetFiletree = define[SetFiletreeRequest, *SettingFileTree]("setFiletree", "/api/setting/setFiletree", JSONBody, ResponseOptions{}, "POST")
var SetSearch = define[SetSearchRequest, *SettingSearch]("setSearch", "/api/setting/setSearch", JSONBody, ResponseOptions{}, "POST")
var SetAppearance = define[SetAppearanceRequest, *SettingAppearance]("setAppearance", "/api/setting/setAppearance", JSONBody, ResponseOptions{}, "POST")
var SetEntryVisibility = define[SetEntryVisibilityRequest, *SettingEntryVisibility]("setEntryVisibility", "/api/setting/setEntryVisibility", JSONBody, ResponseOptions{}, "POST")
var SetPublish = define[SetPublishRequest, SettingPublishData]("setPublish", "/api/setting/setPublish", JSONBody, ResponseOptions{}, "POST")
var GetBootAppearances = define[EmptyRequest, SettingBootAppearancesData]("getBootAppearances", "/api/setting/getBootAppearances", NoBody, ResponseOptions{}, "POST")
var SetBootAppearance = define[SettingBootAppearanceRequest, *SettingBootAppearanceSelection]("setBootAppearance", "/api/setting/setBootAppearance", JSONBody, ResponseOptions{}, "POST")
var SetBazaarPetalDisabled = define[SettingPetalDisabledRequest, SettingPetalDisabledData]("setBazaarPetalDisabled", "/api/setting/setBazaarPetalDisabled", JSONBody, ResponseOptions{}, "POST")
var SetKeymap = define[SettingKeymapRequest, Null]("setKeymap", "/api/setting/setKeymap", JSONBody, ResponseOptions{}, "POST")
var SetTheme = define[SettingThemeRequest, Null]("setTheme", "/api/setting/setTheme", JSONBody, ResponseOptions{}, "POST")
var SetIcon = define[SettingIconRequest, Null]("setIcon", "/api/setting/setIcon", JSONBody, ResponseOptions{}, "POST")
var GetPublish = define[EmptyRequest, SettingPublishData]("getPublish", "/api/setting/getPublish", NoBody, ResponseOptions{}, "POST")
var GetCloudUser = define[SettingCloudUserRequest, *SettingUser]("getCloudUser", "/api/setting/getCloudUser", JSONBody, ResponseOptions{AdditionalCodes: []int{1, 255}, DataOnError: true}, "POST")
var LogoutCloudUser = define[EmptyRequest, Null]("logoutCloudUser", "/api/setting/logoutCloudUser", NoBody, ResponseOptions{}, "POST")
var Login2faCloudUser = define[SettingLogin2faRequest, Login2faEnvelope]("login2faCloudUser", "/api/setting/login2faCloudUser", JSONBody, ResponseOptions{Output: DirectJSONOutput}, "POST")
var SetEmoji = define[SettingEmojiRequest, Null]("setEmoji", "/api/setting/setEmoji", JSONBody, ResponseOptions{}, "POST")

var RemoveUnusedAttributeView = define[RemoveUnusedAttributeViewRequest, AVIDData]("removeUnusedAttributeView", "/api/av/removeUnusedAttributeView", JSONBody, ResponseOptions{}, "POST")
var RemoveUnusedAttributeViews = define[EmptyRequest, AVPathsData]("removeUnusedAttributeViews", "/api/av/removeUnusedAttributeViews", NoBody, ResponseOptions{}, "POST")
var GetUnusedAttributeViews = define[EmptyRequest, []*AssetUnusedItem]("getUnusedAttributeViews", "/api/av/getUnusedAttributeViews", NoBody, ResponseOptions{}, "POST")
var GetAttributeViewItemIDsByBoundIDs = define[GetAttributeViewItemIDsByBoundIDsRequest, map[string]string]("getAttributeViewItemIDsByBoundIDs", "/api/av/getAttributeViewItemIDsByBoundIDs", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewBoundBlockIDsByItemIDs = define[GetAttributeViewBoundBlockIDsByItemIDsRequest, map[string]string]("getAttributeViewBoundBlockIDsByItemIDs", "/api/av/getAttributeViewBoundBlockIDsByItemIDs", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewItemStatuses = define[GetAttributeViewItemStatusesRequest, map[string]string]("getAttributeViewItemStatuses", "/api/av/getAttributeViewItemStatuses", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewAddingBlockDefaultValues = define[GetAttributeViewAddingBlockDefaultValuesRequest, AVValuesData]("getAttributeViewAddingBlockDefaultValues", "/api/av/getAttributeViewAddingBlockDefaultValues", JSONBody, ResponseOptions{}, "POST")
var BatchReplaceAttributeViewBlocks = define[BatchReplaceAttributeViewBlocksRequest, Null]("batchReplaceAttributeViewBlocks", "/api/av/batchReplaceAttributeViewBlocks", JSONBody, ResponseOptions{}, "POST")
var SetAttrViewGroup = define[SetAttrViewGroupRequest, AVRenderResult]("setAttrViewGroup", "/api/av/setAttrViewGroup", JSONBody, ResponseOptions{DataOnError: true}, "POST")
var SetAttrViewFilters = define[SetAttrViewFiltersRequest, Null]("setAttrViewFilters", "/api/av/setAttrViewFilters", JSONBody, ResponseOptions{}, "POST")
var SetAttrViewContextFilter = define[SetAttrViewContextFilterRequest, AVContextFilterData]("setAttrViewContextFilter", "/api/av/setAttrViewContextFilter", JSONBody, ResponseOptions{}, "POST")
var SetAttrViewSorts = define[SetAttrViewSortsRequest, Null]("setAttrViewSorts", "/api/av/setAttrViewSorts", JSONBody, ResponseOptions{}, "POST")
var ChangeAttrViewLayout = define[ChangeAttrViewLayoutRequest, AVRenderResult]("changeAttrViewLayout", "/api/av/changeAttrViewLayout", JSONBody, ResponseOptions{DataOnError: true}, "POST")
var DuplicateAttributeViewBlock = define[DuplicateAttributeViewBlockRequest, AVDuplicateData]("duplicateAttributeViewBlock", "/api/av/duplicateAttributeViewBlock", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewKeysByAvID = define[GetAttributeViewKeysByAvIDRequest, []*AVKey]("getAttributeViewKeysByAvID", "/api/av/getAttributeViewKeysByAvID", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewKeysByID = define[GetAttributeViewKeysByIDRequest, []*AVKey]("getAttributeViewKeysByID", "/api/av/getAttributeViewKeysByID", JSONBody, ResponseOptions{}, "POST")
var GetMirrorDatabaseBlocks = define[GetMirrorDatabaseBlocksRequest, RefDefsData]("getMirrorDatabaseBlocks", "/api/av/getMirrorDatabaseBlocks", JSONBody, ResponseOptions{}, "POST")
var SetDatabaseBlockView = define[SetDatabaseBlockViewRequest, Null]("setDatabaseBlockView", "/api/av/setDatabaseBlockView", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewPrimaryKeyValues = define[GetAttributeViewPrimaryKeyValuesRequest, AVPrimaryValuesData]("getAttributeViewPrimaryKeyValues", "/api/av/getAttributeViewPrimaryKeyValues", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewRelationCandidates = define[GetAttributeViewRelationCandidatesRequest, AVRelationCandidatesData]("getAttributeViewRelationCandidates", "/api/av/getAttributeViewRelationCandidates", JSONBody, ResponseOptions{}, "POST")
var AppendAttributeViewDetachedBlocksWithValues = define[AppendAttributeViewDetachedBlocksWithValuesRequest, Null]("appendAttributeViewDetachedBlocksWithValues", "/api/av/appendAttributeViewDetachedBlocksWithValues", JSONBody, ResponseOptions{}, "POST")
var AddAttributeViewBlocks = define[AddAttributeViewBlocksRequest, Null]("addAttributeViewBlocks", "/api/av/addAttributeViewBlocks", JSONBody, ResponseOptions{}, "POST")
var RemoveAttributeViewBlocks = define[RemoveAttributeViewBlocksRequest, Null]("removeAttributeViewBlocks", "/api/av/removeAttributeViewBlocks", JSONBody, ResponseOptions{}, "POST")
var AddAttributeViewKey = define[AddAttributeViewKeyRequest, Null]("addAttributeViewKey", "/api/av/addAttributeViewKey", JSONBody, ResponseOptions{}, "POST")
var RemoveAttributeViewKey = define[RemoveAttributeViewKeyRequest, Null]("removeAttributeViewKey", "/api/av/removeAttributeViewKey", JSONBody, ResponseOptions{}, "POST")
var SortAttributeViewViewKey = define[SortAttributeViewViewKeyRequest, Null]("sortAttributeViewViewKey", "/api/av/sortAttributeViewViewKey", JSONBody, ResponseOptions{}, "POST")
var SortAttributeViewKey = define[SortAttributeViewKeyRequest, Null]("sortAttributeViewKey", "/api/av/sortAttributeViewKey", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewFilterSort = define[GetAttributeViewFilterSortRequest, AVFilterSortData]("getAttributeViewFilterSort", "/api/av/getAttributeViewFilterSort", JSONBody, ResponseOptions{}, "POST")
var SearchAttributeViewRollupDestKeys = define[SearchAttributeViewRollupDestKeysRequest, AVKeysData]("searchAttributeViewRollupDestKeys", "/api/av/searchAttributeViewRollupDestKeys", JSONBody, ResponseOptions{}, "POST")
var SearchAttributeViewRelationKey = define[SearchAttributeViewRelationKeyRequest, AVKeysData]("searchAttributeViewRelationKey", "/api/av/searchAttributeViewRelationKey", JSONBody, ResponseOptions{}, "POST")
var GetAttributeView = define[GetAttributeViewRequest, AVData]("getAttributeView", "/api/av/getAttributeView", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewPasteRows = define[GetAttributeViewPasteRowsRequest, AVPasteRowsData]("getAttributeViewPasteRows", "/api/av/getAttributeViewPasteRows", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewFieldViews = define[GetAttributeViewFieldViewsRequest, AVFieldViewsData]("getAttributeViewFieldViews", "/api/av/getAttributeViewFieldViews", JSONBody, ResponseOptions{}, "POST")
var CreateAttributeViewItem = define[CreateAttributeViewItemRequest, AVCreateItemResult]("createAttributeViewItem", "/api/av/createAttributeViewItem", JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var CreateAttributeViewItemWithMarkdown = define[CreateAttributeViewItemWithMarkdownRequest, AVCreateItemResult]("createAttributeViewItemWithMarkdown", "/api/av/createAttributeViewItemWithMarkdown", JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var CreateAttributeViewItemDocs = define[CreateAttributeViewItemDocsRequest, AVCreateItemDocsResult]("createAttributeViewItemDocs", "/api/av/createAttributeViewItemDocs", JSONBody, ResponseOptions{DataOnError: true, AdditionalCodes: []int{1}}, "POST")
var SearchAttributeView = define[SearchAttributeViewRequest, AVSearchData]("searchAttributeView", "/api/av/searchAttributeView", JSONBody, ResponseOptions{}, "POST")
var RenderSnapshotAttributeView = define[RenderSnapshotAttributeViewRequest, AVArchiveRenderData]("renderSnapshotAttributeView", "/api/av/renderSnapshotAttributeView", JSONBody, ResponseOptions{}, "POST")
var RenderHistoryAttributeView = define[RenderHistoryAttributeViewRequest, AVArchiveRenderData]("renderHistoryAttributeView", "/api/av/renderHistoryAttributeView", JSONBody, ResponseOptions{}, "POST")
var RenderAttributeView = define[RenderAttributeViewRequest, AVRenderResult]("renderAttributeView", "/api/av/renderAttributeView", JSONBody, ResponseOptions{DataOnError: true, FastJSON: true}, "POST")
var GetCurrentAttrViewImages = define[GetCurrentAttrViewImagesRequest, []string]("getCurrentAttrViewImages", "/api/av/getCurrentAttrViewImages", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewKeys = define[GetAttributeViewKeysRequest, []*AVBlockAttributeViewKeys]("getAttributeViewKeys", "/api/av/getAttributeViewKeys", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewSearchTarget = define[GetAttributeViewSearchTargetRequest, *AVAttributeViewSearchTarget]("getAttributeViewSearchTarget", "/api/av/getAttributeViewSearchTarget", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewBacklinks = define[GetAttributeViewBacklinksRequest, *AVAttributeViewBacklinks]("getAttributeViewBacklinks", "/api/av/getAttributeViewBacklinks", JSONBody, ResponseOptions{}, "POST")
var SetAttributeViewBlockAttr = define[SetAttributeViewBlockAttrRequest, AVValueData]("setAttributeViewBlockAttr", "/api/av/setAttributeViewBlockAttr", JSONBody, ResponseOptions{}, "POST")
var BatchSetAttributeViewBlockAttrs = define[BatchSetAttributeViewBlockAttrsRequest, Null]("batchSetAttributeViewBlockAttrs", "/api/av/batchSetAttributeViewBlockAttrs", JSONBody, ResponseOptions{}, "POST")
var GetAttributeViewRowSort = define[GetAttributeViewRowSortRequest, AVRowSortPreview]("getAttributeViewRowSort", "/api/av/getAttributeViewRowSort", StructJSONBody, ResponseOptions{}, "POST")

var AIChatGPT = define[AIMessageRequest, string]("chatGPT", "/api/ai/chatGPT", JSONBody, ResponseOptions{}, "POST")
var AIChatGPTWithAction = define[AIActionRequest, string]("chatGPTWithAction", "/api/ai/chatGPTWithAction", JSONBody, ResponseOptions{}, "POST")
var AIListEditorActions = define[EmptyRequest, []*AIEditorAction]("lsAIEditorActions", "/api/ai/editor/lsActions", NoBody, ResponseOptions{}, "POST")
var AISaveEditorAction = define[AIEditorActionSaveRequest, *AIEditorAction]("saveAIEditorAction", "/api/ai/editor/saveAction", JSONBody, ResponseOptions{}, "POST")
var AIRemoveEditorAction = define[AIEditorActionIDRequest, Null]("removeAIEditorAction", "/api/ai/editor/removeAction", JSONBody, ResponseOptions{}, "POST")
var AITestModel = define[AIModelRequest, AIModelTestData]("testModel", "/api/ai/testModel", JSONBody, ResponseOptions{}, "POST")
var AITestEmbeddingModel = define[EmptyRequest, AIEmbeddingTestData]("testEmbeddingModel", "/api/ai/testEmbeddingModel", NoBody, ResponseOptions{}, "POST")
var AITestRerankModel = define[EmptyRequest, AIRerankTestData]("testRerankModel", "/api/ai/testRerankModel", NoBody, ResponseOptions{}, "POST")
var AITestDecisionModel = define[EmptyRequest, AIDecisionTestData]("testDecisionModel", "/api/ai/testDecisionModel", NoBody, ResponseOptions{}, "POST")
var AIListModels = define[AIProviderRequest, AIModelsData]("listModels", "/api/ai/listModels", JSONBody, ResponseOptions{}, "POST")
var AIGetEmbeddingStat = define[EmptyRequest, *AIEmbeddingStat]("embeddingStat", "/api/ai/embeddingStat", NoBody, ResponseOptions{}, "POST")
var AIGetMCPStatus = define[EmptyRequest, []AIMCPStatus]("mcpStatus", "/api/ai/mcpStatus", NoBody, ResponseOptions{}, "POST")
var AIGetMCPEnvironment = define[EmptyRequest, AIMCPEnvironmentData]("mcpEnvironmentVariables", "/api/ai/mcpEnvironmentVariables", NoBody, ResponseOptions{}, "POST")
var AIMCPOAuthAuthorize = define[AIMCPIDRequest, Null]("mcpOAuthAuthorize", "/api/ai/mcpOAuthAuthorize", JSONBody, ResponseOptions{}, "POST")
var AIMCPOAuthDisconnect = define[AIMCPIDRequest, Null]("mcpOAuthDisconnect", "/api/ai/mcpOAuthDisconnect", JSONBody, ResponseOptions{}, "POST")
var AIReindexEmbedding = define[EmptyRequest, Null]("reindexEmbedding", "/api/ai/reindexEmbedding", NoBody, ResponseOptions{}, "POST")
var AIRetryFailedEmbedding = define[EmptyRequest, Null]("retryFailedEmbedding", "/api/ai/retryFailedEmbedding", NoBody, ResponseOptions{}, "POST")
var AIAgentConfirm = define[AIConfirmRequest, Null]("agentChatConfirm", "/api/ai/agent/confirm", StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409}}, "POST")
var AIAgentSetPermission = define[AIPermissionRequest, AIPermissionData]("setAgentSessionPermission", "/api/ai/agent/setPermission", StructJSONBody, ResponseOptions{}, "POST")
var AIAgentQuestion = define[AIQuestionRequest, Null]("agentChatQuestion", "/api/ai/agent/question", StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409}}, "POST")
var AIAgentBrowserCapabilityResult = define[AIBrowserCapabilityResultRequest, Null]("agentChatBrowserCapabilityResult", "/api/ai/agent/browserCapabilityResult", StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409}}, "POST")
var AIListCapabilities = define[EmptyRequest, []AICapabilityManifest]("lsCapabilities", "/api/ai/lsCapabilities", NoBody, ResponseOptions{}, "POST")
var AIAgentTitle = define[AITitleRequest, string]("agentChatTitle", "/api/ai/agent/title", StructJSONBody, ResponseOptions{}, "POST")
var AIListSessions = define[AISessionsRequest, AISessionList]("lsSessions", "/api/ai/agent/lsSessions", StructJSONBody, ResponseOptions{}, "POST")
var AIRemoveSession = define[AISessionIDRequest, Null]("removeSession", "/api/ai/agent/removeSession", StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{409, 500}}, "POST")
var AIListSkills = define[EmptyRequest, []AISkillInfo]("lsSkills", "/api/ai/agent/lsSkills", NoBody, ResponseOptions{}, "POST")
var AIListUserSkills = define[EmptyRequest, []AIUserSkillInfo]("lsUserSkills", "/api/ai/agent/lsUserSkills", NoBody, ResponseOptions{}, "POST")
var AIGetSkill = define[AISkillNameRequest, AISkillData]("getSkill", "/api/ai/agent/getSkill", StructJSONBody, ResponseOptions{}, "POST")
var AISaveSkill = define[AISkillSaveRequest, Null]("saveSkill", "/api/ai/agent/saveSkill", StructJSONBody, ResponseOptions{}, "POST")
var AIRemoveSkill = define[AISkillNameRequest, Null]("removeSkill", "/api/ai/agent/removeSkill", StructJSONBody, ResponseOptions{}, "POST")
var AIRenameSkill = define[AISkillRenameRequest, Null]("renameSkill", "/api/ai/agent/renameSkill", StructJSONBody, ResponseOptions{}, "POST")
var AIManageSkills = define[AISkillFileRequest, AISkillFileData]("manageSkills", "/api/ai/agent/manageSkills", JSONBody, ResponseOptions{}, "POST")

var AIEditorChat = define[AIEditorChatRequest, Null]("aiEditorChat", "/api/ai/editor/chat", StructJSONBody, aiEditorSSEOptions(), "POST")
var AIAgentChat = define[AIAgentChatRequest, Null]("agentChat", "/api/ai/agent/chat", StructJSONBody, aiAgentSSEOptions(), "POST")
var AIMCPOAuthCallback = define[EmptyRequest, BinaryContent]("mcpOAuthCallback", "/api/ai/mcp/oauth/callback/:flowID", NoBody, HTTPContentOptions(HTTPContentVariant{Status: 200, ContentType: "text/html"}, HTTPContentVariant{Status: 400, ContentType: "text/html"}, HTTPContentVariant{Status: 403, ContentType: "text/plain"}), "GET")
var AIGetSession = define[AISessionIDRequest, *AISession]("getSession", "/api/ai/agent/getSession", StructJSONBody, ResponseOptions{AdditionalErrorStatuses: []int{500}}, "POST")
var AISaveSession = define[AISession, AISessionSaveData]("saveSession", "/api/ai/agent/saveSession", StructJSONBody, ResponseOptions{DataOnError: true, AdditionalErrorStatuses: []int{400, 409, 500}}, "POST")

var NetworkEcho = define[EmptyRequest, NetworkEchoData]("echo", "/api/network/echo", RawBody, ResponseOptions{}, "ANY")
var NetworkEchoPath = define[EmptyRequest, NetworkEchoData]("echoPath", "/api/network/echo/*path", RawBody, ResponseOptions{}, "ANY")
var NetworkForwardProxy = define[NetworkForwardRequest, NetworkForwardData]("forwardProxy", "/api/network/forwardProxy", JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2, 3, 4, 5, 6, 7, 8, 10}}, "POST")
var NetworkHTTPProxy = define[EmptyRequest, ProxyFailure]("httpProxy", "/api/network/proxy", RawBody, ProxyOptions(HTTPProxy), "ANY")
var NetworkEventSourceProxy = define[EmptyRequest, ProxyFailure]("esProxy", "/es/network/proxy", NoBody, ProxyOptions(EventSourceProxy), "GET")
var NetworkWebSocketProxy = define[EmptyRequest, ProxyFailure]("wsProxy", "/ws/network/proxy", NoBody, ProxyOptions(WebSocketProxy), "GET")

var PluginPrivateService = define[EmptyRequest, PluginServiceContent]("pluginPrivateWebServer", "/plugin/private/:name/*path", RawBody, PluginServiceOptions(), "ANY")

var GetDynamicIcon = define[DynamicIconRequest, BinaryContent]("getDynamicIcon", "/api/icon/getDynamicIcon", NoBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200, ContentVariants: []HTTPContentVariant{{Status: 200, ContentType: "image/svg+xml"}}, EmptyResponseStatuses: []int{500}}, "GET")

var ExtensionCopy = define[ExtensionCopyRequest, *ExtensionCopyData]("extensionCopy", "/api/extension/copy", MultipartBody, ResponseOptions{DataOnError: true}, "POST")

var SystemBootProgressSSE = define[EmptyRequest, Null]("bootProgressSSE", "/api/system/bootProgressSSE", NoBody, SSEOptions(SSEEvent[BootProgressData]("")), "GET")
var SystemGetBootAppearance = define[EmptyRequest, *SettingBootAppearance]("getBootAppearance", "/api/system/getBootAppearance", NoBody, ResponseOptions{EmptyResponseStatuses: []int{403}}, "GET")
var SystemGetCaptcha = define[EmptyRequest, BinaryContent]("getCaptcha", "/api/system/getCaptcha", NoBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200, ContentVariants: []HTTPContentVariant{{Status: 200, ContentType: "image/png"}}, EmptyResponseStatuses: []int{500}}, "GET")
var SystemOIDCCallback = define[SystemOIDCCallbackRequest, BinaryContent]("oidcCallback", "/api/system/oidc/callback", NoBody, HTTPContentOptions(HTTPContentVariant{Status: 200, ContentType: "text/html"}), "GET")
var SystemAddCustomEmoji = define[SystemCustomEmojiRequest, SystemPathData]("addCustomEmoji", "/api/system/addCustomEmoji", FormBody, ResponseOptions{AdditionalCodes: []int{400, 413}}, "POST")
var SystemCheckUpdate = define[SystemCheckUpdateRequest, Null]("checkUpdate", "/api/system/checkUpdate", JSONBody, ResponseOptions{}, "POST")
var SystemCheckWorkspaceDir = define[SystemPathRequest, SystemWorkspaceCheckData]("checkWorkspaceDir", "/api/system/checkWorkspaceDir", JSONBody, ResponseOptions{}, "POST")
var SystemCreateWorkspaceDir = define[SystemPathRequest, Null]("createWorkspaceDir", "/api/system/createWorkspaceDir", JSONBody, ResponseOptions{}, "POST")
var SystemDismissOnboarding = define[EmptyRequest, *SystemOnboarding]("dismissOnboarding", "/api/system/dismissOnboarding", NoBody, ResponseOptions{}, "POST")
var SystemEnsureOnboarding = define[EmptyRequest, *SystemOnboarding]("ensureOnboarding", "/api/system/ensureOnboarding", NoBody, ResponseOptions{}, "POST")
var SystemExit = define[SystemExitRequest, SystemExitData]("exit", "/api/system/exit", JSONBody, ResponseOptions{AdditionalCodes: []int{1, 2}, DataOnError: true}, "POST")
var SystemExportConf = define[EmptyRequest, SystemExportConfData]("exportConf", "/api/system/exportConf", NoBody, ResponseOptions{}, "POST")
var SystemExportLog = define[EmptyRequest, SystemZipData]("exportLog", "/api/system/exportLog", NoBody, ResponseOptions{}, "POST")
var SystemExportTLSCABundle = define[EmptyRequest, SystemPathData]("exportTLSCABundle", "/api/system/exportTLSCABundle", NoBody, ResponseOptions{}, "POST")
var SystemExportTLSCACert = define[EmptyRequest, SystemPathData]("exportTLSCACert", "/api/system/exportTLSCACert", NoBody, ResponseOptions{}, "POST")
var SystemGetChangelog = define[SystemChangelogRequest, SystemChangelogData]("getChangelog", "/api/system/getChangelog", LegacyOptionalBody, ResponseOptions{}, "POST")
var SystemGetConf = define[EmptyRequest, SystemConfData]("getConf", "/api/system/getConf", NoBody, ResponseOptions{}, "POST")
var SystemGetCustomFonts = define[EmptyRequest, []*SystemCustomFont]("getCustomFonts", "/api/system/getCustomFonts", NoBody, ResponseOptions{}, "POST")
var SystemGetEmojiConf = define[EmptyRequest, []*SystemEmojiGroup]("getEmojiConf", "/api/system/getEmojiConf", NoBody, ResponseOptions{}, "POST")
var SystemGetMobileWorkspaces = define[EmptyRequest, []string]("getMobileWorkspaces", "/api/system/getMobileWorkspaces", NoBody, ResponseOptions{}, "POST")
var SystemGetSysFonts = define[EmptyRequest, []*SystemFont]("getSysFonts", "/api/system/getSysFonts", NoBody, ResponseOptions{}, "POST")
var SystemGetWorkspaces = define[EmptyRequest, []*SystemWorkspace]("getWorkspaces", "/api/system/getWorkspaces", NoBody, ResponseOptions{}, "POST")
var SystemImportConf = define[SystemImportConfRequest, Null]("importConf", "/api/system/importConf", MultipartBody, ResponseOptions{}, "POST")
var SystemImportCustomFont = define[SystemImportFileRequest, *SystemCustomFont]("importCustomFont", "/api/system/importCustomFont", MultipartBody, ResponseOptions{AdditionalCodes: []int{400, 413}}, "POST")
var SystemImportTLSCABundle = define[SystemImportFileRequest, SystemMessageData]("importTLSCABundle", "/api/system/importTLSCABundle", MultipartBody, ResponseOptions{}, "POST")
var SystemLoginAuth = define[SystemLoginAuthRequest, Null]("loginAuth", "/api/system/loginAuth", JSONBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var SystemLogoutAuth = define[EmptyRequest, Null]("logoutAuth", "/api/system/logoutAuth", NoBody, ResponseOptions{AdditionalCodes: []int{1}}, "POST")
var SystemOIDCMobileCallback = define[SystemOIDCMobileRequest, SystemOIDCMobileData]("oidcMobileCallback", "/api/system/oidc/mobileCallback", StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCPoll = define[SystemOIDCPollRequest, SystemOIDCPollData]("oidcPoll", "/api/system/oidc/poll", StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCStart = define[SystemOIDCStartRequest, SystemOIDCStartData]("oidcStart", "/api/system/oidc/start", StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidateStart = define[SystemOIDCRequest, SystemOIDCStartData]("oidcValidateStart", "/api/system/oidc/validate", StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidateActivate = define[SystemOIDCPollRequest, SystemOIDCActivateData]("oidcValidateActivate", "/api/system/oidc/validateActivate", StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidateCancel = define[SystemOIDCPollRequest, Null]("oidcValidateCancel", "/api/system/oidc/validateCancel", StructJSONBody, ResponseOptions{}, "POST")
var SystemOIDCValidatePoll = define[SystemOIDCPollRequest, SystemOIDCValidatePollData]("oidcValidatePoll", "/api/system/oidc/validatePoll", StructJSONBody, ResponseOptions{}, "POST")
var SystemRemoveCustomFont = define[SystemRemoveCustomFontRequest, SystemRemoveCustomFontData]("removeCustomFont", "/api/system/removeCustomFont", JSONBody, ResponseOptions{AdditionalCodes: []int{400, 404}}, "POST")
var SystemRemoveWorkspaceDir = define[SystemPathRequest, Null]("removeWorkspaceDir", "/api/system/removeWorkspaceDir", JSONBody, ResponseOptions{}, "POST")
var SystemRemoveWorkspaceDirPhysically = define[SystemPathRequest, Null]("removeWorkspaceDirPhysically", "/api/system/removeWorkspaceDirPhysically", JSONBody, ResponseOptions{}, "POST")
var SystemSetAPIToken = define[SystemAPITokenRequest, Null]("setAPIToken", "/api/system/setAPIToken", JSONBody, ResponseOptions{}, "POST")
var SystemSetAccessAuthCode = define[SystemAccessAuthCodeRequest, Null]("setAccessAuthCode", "/api/system/setAccessAuthCode", JSONBody, ResponseOptions{}, "POST")
var SystemSetAppearanceMode = define[SystemAppearanceModeRequest, SystemAppearanceData]("setAppearanceMode", "/api/system/setAppearanceMode", JSONBody, ResponseOptions{}, "POST")
var SystemSetOIDC = define[SystemOIDCRequest, *SystemOIDC]("setOIDC", "/api/system/setOIDC", StructJSONBody, ResponseOptions{}, "POST")
var SystemSetUILayout = define[SystemUILayoutRequest, Null]("setUILayout", "/api/system/setUILayout", JSONBody, ResponseOptions{}, "POST")
var SystemSetWorkspaceDir = define[SystemPathRequest, Null]("setWorkspaceDir", "/api/system/setWorkspaceDir", JSONBody, ResponseOptions{}, "POST")
var SystemAddUIProcess = define[SystemUIProcessRequest, Null]("addUIProcess", "/api/system/uiproc", NoBody, ResponseOptions{EmptyResponseStatuses: []int{200}}, "POST")

var PerformTransactions = define[PerformTransactionsRequest, []*Transaction]("performTransactions", "/api/transactions", JSONBody, ResponseOptions{}, "POST")
var UndoState = define[TransactionUndoStateRequest, TransactionUndoState]("undoState", "/api/transactions/undoState", JSONBody, ResponseOptions{}, "POST")
var PerformUndo = define[TransactionHistoryRequest, TransactionHistoryResult]("performUndo", "/api/transactions/undo", JSONBody, ResponseOptions{}, "POST")
var PerformRedo = define[TransactionHistoryRequest, TransactionHistoryResult]("performRedo", "/api/transactions/redo", JSONBody, ResponseOptions{}, "POST")
var ClearHistory = define[TransactionClearHistoryRequest, Null]("clearHistory", "/api/transactions/clearHistory", JSONBody, ResponseOptions{}, "POST")

var BroadcastWebSocket = define[EmptyRequest, Null]("broadcast", "/ws/broadcast", NoBody, RawWebSocketOptions(), "GET")
var BroadcastSubscribe = define[EmptyRequest, Null]("broadcastSubscribe", "/es/broadcast/subscribe", NoBody, RawSSEOptions(), "GET")
