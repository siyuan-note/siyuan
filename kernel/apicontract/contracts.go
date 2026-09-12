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
