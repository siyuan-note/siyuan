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
	K    string   `json:"k"`
	Exts []string `json:"exts" api:"optional,nullable"`
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
