package apicontract

type SearchPageRequest struct {
	Page     *float64 `json:"page" api:"optional"`
	PageSize *float64 `json:"pageSize" api:"optional"`
}

func (r SearchPageRequest) Pagination() (page, pageSize int) {
	page, pageSize = 1, 32
	if r.Page != nil && int(*r.Page) > 0 {
		page = int(*r.Page)
	}
	if r.PageSize != nil && int(*r.PageSize) > 0 {
		pageSize = int(*r.PageSize)
	}
	return
}

type SearchBlocksData struct {
	Blocks            []*SearchBlock `json:"blocks"`
	MatchedBlockCount int            `json:"matchedBlockCount"`
	MatchedRootCount  int            `json:"matchedRootCount"`
	PageCount         int            `json:"pageCount"`
}

type UpdateEmbedBlockRequest struct {
	ID      string `json:"id"`
	Content string `json:"content"`
}

type SearchKeywordRequest struct {
	K string `json:"k"`
}

type SearchPathRequest struct {
	Path string `json:"path"`
}

type SearchAssetRequest struct {
	// K 保留原有文件名和路径的关键词搜索与排序语义。
	K string `json:"k"`
	// Exts 可省略或留空以搜索全部类型，扩展名接受 png 和 .png 两种写法，匹配时不区分大小写。
	Exts []string `json:"exts" api:"optional,nullable"`
	// Match 在关键词和扩展名筛选后、分页前作用于原始文件名或 assets/ 相对路径。
	Match *SearchAssetMatch `json:"match" api:"optional,nullable"`
	// Page 和 PageSize 同时支持省略；省略时保留第一页和现有搜索上限的行为，显式值必须为正且 PageSize 不超过搜索上限。
	Page     *int `json:"page" api:"optional,nullable"`
	PageSize *int `json:"pageSize" api:"optional,nullable"`
}

type SearchAssetMatch struct {
	// Field 省略时匹配去掉资源 ID 的文件名；path 匹配返回的 assets/ 相对路径。
	Field string `json:"field,omitempty" api:"optional,nullable,enum=name|path"`
	// Mode 的 prefix 和 suffix 不区分大小写；regex 使用 Go 正则语法，默认区分大小写，可用 (?i) 忽略大小写。
	Mode string `json:"mode" api:"enum=prefix|suffix|regex"`
	// Value 最多 1024 字节，空字符串不筛选；无效正则返回错误，不退回到普通文本匹配。
	Value string `json:"value"`
}

type SearchAsset struct {
	HName   string `json:"hName"`
	Path    string `json:"path"`
	Updated int64  `json:"updated"`
}

type SearchWidgetResult struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

type SearchWidgetData struct {
	Widgets []*SearchWidgetResult `json:"widgets"`
	K       string                `json:"k"`
}

type SearchTemplateResult struct {
	Path         string `json:"path"`
	RelativePath string `json:"relativePath"`
	Content      string `json:"content"`
}

type SearchTemplateData struct {
	Templates []*SearchTemplateResult `json:"templates"`
	K         string                  `json:"k"`
}

type AssetContent struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Ext     string `json:"ext"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	HSize   string `json:"hSize"`
	Updated int64  `json:"updated"`
	Content string `json:"content"`
}

type AssetContentRequest struct {
	ID          string  `json:"id"`
	Query       string  `json:"query"`
	QueryMethod float64 `json:"queryMethod"`
}

type AssetContentData struct {
	AssetContent *AssetContent `json:"assetContent"`
}

type SearchAssetContentRequest struct {
	SearchPageRequest
	Query   string          `json:"query" api:"optional,nullable"`
	Types   map[string]bool `json:"types" api:"optional,nullable"`
	Method  float64         `json:"method" api:"optional,nullable"`
	OrderBy float64         `json:"orderBy" api:"optional,nullable"`
}

type SearchAssetContentData struct {
	AssetContents     []*AssetContent `json:"assetContents"`
	MatchedAssetCount int             `json:"matchedAssetCount"`
	PageCount         int             `json:"pageCount"`
}

type EmbedBlockOptions struct {
	EmbedBlockID string  `json:"embedBlockID"`
	HeadingMode  float64 `json:"headingMode" api:"optional,nullable"`
	Breadcrumb   bool    `json:"breadcrumb" api:"optional,nullable"`
	Notebook     string  `json:"notebook" api:"optional,nullable,ignoretype"`
}

type GetEmbedBlockRequest struct {
	EmbedBlockOptions
	IncludeIDs []string `json:"includeIDs"`
}

type SearchEmbedBlockRequest struct {
	EmbedBlockOptions
	Stmt       string    `json:"stmt"`
	ExcludeIDs []*string `json:"excludeIDs"`
}

type EmbedBlock struct {
	Block               *SearchBlock `json:"block"`
	BlockPaths          []*BlockPath `json:"blockPaths"`
	AllowChildOperation bool         `json:"allowChildOperation"`
}

type EmbedBlocksData struct {
	Blocks []*EmbedBlock `json:"blocks"`
}
