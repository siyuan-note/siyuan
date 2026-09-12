// 包 apicontract 定义 HTTP 接口的线协议，不依赖内核启动或持久化模型。
package apicontract

import "reflect"

type BodyMode string

const (
	JSONBody           BodyMode = "json"
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
}

type Endpoint[Request, Data any] struct {
	definition Definition
}

type ResponseOptions struct {
	AdditionalCodes []int
	Text            bool
	NonNullable     bool
}

var definitions []Definition

func define[Request, Data any](name, path string, body BodyMode, response ResponseOptions, methods ...string) Endpoint[Request, Data] {
	d := Definition{Name: name, Path: path, Methods: methods, Body: body,
		Request: reflect.TypeFor[Request](), Data: reflect.TypeFor[Data](),
		ErrorCodes: append([]int{-1}, response.AdditionalCodes...), ErrorText: response.Text, DataNonNullable: response.NonNullable}
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
