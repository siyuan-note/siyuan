package apicontract

type Criterion struct {
	Name string `json:"name" api:"optional,nullable"`
	// 排序方式：0 按块类型（默认），1 按创建时间升序，2 按创建时间降序，3 按更新时间升序，4 按更新时间降序，
	// 5 按内容顺序，6 按相关度升序，7 按相关度降序
	Sort         int                    `json:"sort" api:"optional,nullable"`
	Group        int                    `json:"group" api:"optional,nullable"`      // 0：不分组，1：按文档分组
	HasReplace   bool                   `json:"hasReplace" api:"optional,nullable"` // 是否有替换
	Method       int                    `json:"method" api:"optional,nullable"`     // 0：文本，1：查询语法，2：SQL，3：正则表达式，4：语义搜索
	HPath        string                 `json:"hPath" api:"optional,nullable"`
	IDPath       []string               `json:"idPath" api:"optional,nullable"`
	K            string                 `json:"k" api:"optional,nullable"`            // 搜索关键字
	R            string                 `json:"r" api:"optional,nullable"`            // 替换关键字
	Types        *CriterionTypes        `json:"types" api:"optional,nullable"`        // 类型过滤选项
	SubTypes     SearchSubTypes         `json:"subTypes" api:"optional,nullable"`     // 子类型过滤选项
	ReplaceTypes *CriterionReplaceTypes `json:"replaceTypes" api:"optional,nullable"` // 替换类型过滤选项
}

type CriterionTypes struct {
	CustomBlock *bool `json:"customBlock,omitempty" api:"optional,nullable"`

	MathBlock     bool `json:"mathBlock" api:"optional,nullable"`
	Table         bool `json:"table" api:"optional,nullable"`
	Blockquote    bool `json:"blockquote" api:"optional,nullable"`
	SuperBlock    bool `json:"superBlock" api:"optional,nullable"`
	Paragraph     bool `json:"paragraph" api:"optional,nullable"`
	Document      bool `json:"document" api:"optional,nullable"`
	Heading       bool `json:"heading" api:"optional,nullable"`
	List          bool `json:"list" api:"optional,nullable"`
	ListItem      bool `json:"listItem" api:"optional,nullable"`
	CodeBlock     bool `json:"codeBlock" api:"optional,nullable"`
	HtmlBlock     bool `json:"htmlBlock" api:"optional,nullable"`
	EmbedBlock    bool `json:"embedBlock" api:"optional,nullable"`
	DatabaseBlock bool `json:"databaseBlock" api:"optional,nullable"`
	AudioBlock    bool `json:"audioBlock" api:"optional,nullable"`
	VideoBlock    bool `json:"videoBlock" api:"optional,nullable"`
	IFrameBlock   bool `json:"iframeBlock" api:"optional,nullable"`
	WidgetBlock   bool `json:"widgetBlock" api:"optional,nullable"`
	Callout       bool `json:"callout" api:"optional,nullable"`
	Tabs          bool `json:"tabs" api:"optional,nullable"`
	TabItem       bool `json:"tabItem" api:"optional,nullable"`
}

type CriterionReplaceTypes struct {
	Text              bool `json:"text" api:"optional,nullable"`
	ImgText           bool `json:"imgText" api:"optional,nullable"`
	ImgTitle          bool `json:"imgTitle" api:"optional,nullable"`
	ImgSrc            bool `json:"imgSrc" api:"optional,nullable"`
	AText             bool `json:"aText" api:"optional,nullable"`
	ATitle            bool `json:"aTitle" api:"optional,nullable"`
	AHref             bool `json:"aHref" api:"optional,nullable"`
	Code              bool `json:"code" api:"optional,nullable"`
	Em                bool `json:"em" api:"optional,nullable"`
	Strong            bool `json:"strong" api:"optional,nullable"`
	InlineMath        bool `json:"inlineMath" api:"optional,nullable"`
	InlineMemo        bool `json:"inlineMemo" api:"optional,nullable"`
	BlockRef          bool `json:"blockRef" api:"optional,nullable"`
	FileAnnotationRef bool `json:"fileAnnotationRef" api:"optional,nullable"`
	Kbd               bool `json:"kbd" api:"optional,nullable"`
	Mark              bool `json:"mark" api:"optional,nullable"`
	S                 bool `json:"s" api:"optional,nullable"`
	Sub               bool `json:"sub" api:"optional,nullable"`
	Sup               bool `json:"sup" api:"optional,nullable"`
	Tag               bool `json:"tag" api:"optional,nullable"`
	U                 bool `json:"u" api:"optional,nullable"`
	DocTitle          bool `json:"docTitle" api:"optional,nullable"`
	CodeBlock         bool `json:"codeBlock" api:"optional,nullable"`
	MathBlock         bool `json:"mathBlock" api:"optional,nullable"`
	HtmlBlock         bool `json:"htmlBlock" api:"optional,nullable"`
}

type SearchSubTypes struct {
	Heading  map[string]bool `json:"heading" api:"optional,nullable"`
	List     map[string]bool `json:"list" api:"optional,nullable"`
	ListItem map[string]bool `json:"listItem" api:"optional,nullable"`
}

type SetCriterionRequest struct {
	Criterion *Criterion `json:"criterion" api:"legacyobject"`
}

type RemoveCriterionRequest struct {
	Name string `json:"name" api:"trim"`
}
