// 包 apicontract 定义 HTTP 接口的线协议，不依赖内核启动或持久化模型。
package apicontract

import (
	"io"
	"reflect"
)

type BodyMode string

const (
	JSONBody           BodyMode = "json"
	MultipartBody      BodyMode = "multipart"
	StructJSONBody     BodyMode = "structJSON"
	NoBody             BodyMode = "none"
	LegacyOptionalBody BodyMode = "legacyOptional"
)

type Definition struct {
	Name            string
	Path            string
	Methods         []string
	Body            BodyMode
	Request         reflect.Type
	Data            reflect.Type
	ErrorCodes      []int
	ErrorText       bool
	DataNonNullable bool
	DataOnError     bool
}

type Endpoint[Request, Data any] struct {
	definition    Definition
	decodeRequest func(io.Reader) (Request, error)
}

type ResponseOptions struct {
	AdditionalCodes []int
	Text            bool
	NonNullable     bool
	DataOnError     bool
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
		ErrorCodes: append([]int{-1}, response.AdditionalCodes...), ErrorText: response.Text, DataNonNullable: response.NonNullable, DataOnError: response.DataOnError}
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
	EnableEncryptedNotebooks   = define[NotebookPasswordRequest, Null]("enableEncryptedNotebooks", "/api/notebook/enableEncryptedNotebooks", JSONBody, ResponseOptions{}, "POST")
	DisableEncryptedNotebooks  = define[EmptyRequest, Null]("disableEncryptedNotebooks", "/api/notebook/disableEncryptedNotebooks", NoBody, ResponseOptions{}, "POST")
	CreateEncryptedNotebook    = define[CreateEncryptedNotebookRequest, CreateNotebookData]("createEncryptedNotebook", "/api/notebook/createEncryptedNotebook", JSONBody, ResponseOptions{}, "POST")
	UnlockNotebook             = define[UnlockNotebookRequest, Null]("unlockNotebook", "/api/notebook/unlockNotebook", JSONBody, ResponseOptions{}, "POST")
	UnlockAndOpenNotebook      = define[UnlockNotebookRequest, Null]("unlockAndOpenNotebook", "/api/notebook/unlockAndOpenNotebook", JSONBody, ResponseOptions{}, "POST")
	LockNotebook               = define[NotebookIDRequest, Null]("lockNotebook", "/api/notebook/lockNotebook", JSONBody, ResponseOptions{}, "POST")
	SetNotebookCryptoAutoLock  = define[NotebookCryptoAutoLockRequest, Null]("setNotebookCryptoAutoLock", "/api/notebook/setNotebookCryptoAutoLock", JSONBody, ResponseOptions{}, "POST")
	ChangeMasterPassword       = define[ChangeMasterPasswordRequest, Null]("changeMasterPassword", "/api/notebook/changeMasterPassword", JSONBody, ResponseOptions{}, "POST")
	ExportNotebookCryptoBackup = define[EmptyRequest, NotebookCryptoBackupData]("exportNotebookCryptoBackup", "/api/notebook/exportNotebookCryptoBackup", NoBody, ResponseOptions{}, "POST")
	TouchEncryptedNotebooks    = define[EmptyRequest, Null]("touchEncryptedNotebooks", "/api/notebook/touchEncryptedNotebooks", NoBody, ResponseOptions{}, "POST")
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

var ReloadTag = define[EmptyRequest, Null]("reloadTag", "/api/ui/reloadTag", NoBody, ResponseOptions{}, "POST")
var ReloadFiletree = define[EmptyRequest, Null]("reloadFiletree", "/api/ui/reloadFiletree", NoBody, ResponseOptions{}, "POST")
var ReloadProtyle = define[BlockIDRequest, Null]("reloadProtyle", "/api/ui/reloadProtyle", JSONBody, ResponseOptions{}, "POST")
var ReloadAttributeView = define[BlockIDRequest, Null]("reloadAttributeView", "/api/ui/reloadAttributeView", JSONBody, ResponseOptions{}, "POST")
var ReloadUI = define[EmptyRequest, Null]("reloadUI", "/api/ui/reloadUI", NoBody, ResponseOptions{}, "POST")
var ReloadIcon = define[EmptyRequest, Null]("reloadIcon", "/api/ui/reloadIcon", NoBody, ResponseOptions{}, "POST")
var ReloadTheme = define[EmptyRequest, Null]("reloadTheme", "/api/ui/reloadTheme", NoBody, ResponseOptions{}, "POST")
