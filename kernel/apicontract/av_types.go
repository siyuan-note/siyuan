package apicontract

type AVTable struct {
	// 仅日历布局返回字段绑定及一周起始日；创建、更新系统时间作为只读日期源。
	Calendar *AVCalendarSettings `json:"calendar,omitempty" api:"optional"`
	// 回显本次请求的日期范围，省略范围的请求不返回此字段。
	CalendarRange *AVCalendarRange `json:"calendarRange,omitempty" api:"optional"`
	// 可访问且通过筛选的定位条目的开始时间，单位为毫秒；无有效定位日期时省略。
	// 发布读取先过滤不可访问条目，再重新计算此日期、定位行索引及 rowCount。
	CalendarTargetDate *int64 `json:"calendarTargetDate,omitempty" api:"optional"`
	*AVBaseInstance
	Columns  []*AVTableColumn `json:"columns" api:"optional,nullable"`
	Rows     []*AVTableRow    `json:"rows" api:"optional,nullable"`
	RowCount int              `json:"rowCount" api:"optional,nullable"`
}

type AVBaseInstance struct {
	ID               string           `json:"id" api:"optional,nullable"`
	Icon             string           `json:"icon" api:"optional,nullable"`
	Name             string           `json:"name" api:"optional,nullable"`
	Desc             string           `json:"desc" api:"optional,nullable"`
	HideAttrViewName bool             `json:"hideAttrViewName" api:"optional,nullable"`
	Filters          []*AVViewFilter  `json:"filters" api:"optional,nullable"`
	Sorts            []*AVViewSort    `json:"sorts" api:"optional,nullable"`
	Group            *AVViewGroup     `json:"group" api:"optional,nullable"`
	PageSize         int              `json:"pageSize" api:"optional,nullable"`
	ShowIcon         bool             `json:"showIcon" api:"optional,nullable"`
	WrapField        bool             `json:"wrapField" api:"optional,nullable"`
	GroupKey         *AVKey           `json:"groupKey,omitempty" api:"optional,nullable"`
	GroupValue       *AVValue         `json:"groupValue,omitempty" api:"optional,nullable"`
	Groups           []AVViewInstance `json:"groups,omitempty" api:"optional,nullable"`
	GroupCalc        *AVGroupCalc     `json:"groupCalc,omitempty" api:"optional,nullable"`
	GroupFolded      bool             `json:"groupFolded" api:"optional,nullable"`
	GroupHidden      int              `json:"groupHidden" api:"optional,nullable"`
}

type AVViewFilter struct {
	Column        string          `json:"column" api:"optional,nullable"`
	ValueSource   string          `json:"valueSource,omitempty" api:"optional,nullable,enum=stored|rendered"`
	Qualifier     string          `json:"quantifier,omitempty" api:"optional,nullable"`
	Operator      string          `json:"operator" api:"optional,nullable,enum=|=|!=|>|>=|<|<=|Contains|Does not contains|Contains any item|Does not contain any item|Is empty|Is not empty|Starts with|Ends with|Is between|Is true|Is false"`
	Value         *AVValue        `json:"value" api:"optional,nullable"`
	RelativeDate  *AVRelativeDate `json:"relativeDate,omitempty" api:"optional,nullable"`
	RelativeDate2 *AVRelativeDate `json:"relativeDate2,omitempty" api:"optional,nullable"`
	DateEndpoint  string          `json:"dateEndpoint,omitempty" api:"optional,nullable,enum=start|end"`
	Combination   string          `json:"combination,omitempty" api:"optional,nullable,enum=and|or"`
	Filters       []*AVViewFilter `json:"filters,omitempty" api:"optional,nullable"`
}

type AVValue struct {
	ID              string           `json:"id,omitempty" api:"optional,nullable"`
	KeyID           string           `json:"keyID,omitempty" api:"optional,nullable"`
	BlockID         string           `json:"blockID,omitempty" api:"optional,nullable"`
	Type            string           `json:"type,omitempty" api:"optional,nullable,enum=block|text|number|date|select|mSelect|url|email|phone|mAsset|template|created|updated|checkbox|relation|rollup|lineNumber"`
	IsDetached      bool             `json:"isDetached,omitempty" api:"optional,nullable"`
	CreatedAt       int64            `json:"createdAt,omitempty" api:"optional,nullable"`
	UpdatedAt       int64            `json:"updatedAt,omitempty" api:"optional,nullable"`
	Block           *AVValueBlock    `json:"block,omitempty" api:"optional,nullable"`
	Text            *AVValueText     `json:"text,omitempty" api:"optional,nullable"`
	Number          *AVValueNumber   `json:"number,omitempty" api:"optional,nullable"`
	Date            *AVValueDate     `json:"date,omitempty" api:"optional,nullable"`
	MSelect         []*AVValueSelect `json:"mSelect,omitempty" api:"optional,nullable"`
	URL             *AVValueURL      `json:"url,omitempty" api:"optional,nullable"`
	Email           *AVValueEmail    `json:"email,omitempty" api:"optional,nullable"`
	Phone           *AVValuePhone    `json:"phone,omitempty" api:"optional,nullable"`
	MAsset          []*AVValueAsset  `json:"mAsset,omitempty" api:"optional,nullable"`
	Template        *AVValueTemplate `json:"template,omitempty" api:"optional,nullable"`
	Created         *AVValueCreated  `json:"created,omitempty" api:"optional,nullable"`
	Updated         *AVValueUpdated  `json:"updated,omitempty" api:"optional,nullable"`
	Checkbox        *AVValueCheckbox `json:"checkbox,omitempty" api:"optional,nullable"`
	Relation        *AVValueRelation `json:"relation,omitempty" api:"optional,nullable"`
	Rollup          *AVValueRollup   `json:"rollup,omitempty" api:"optional,nullable"`
	RenderedContent string           `json:"renderedContent,omitempty" api:"optional,nullable"`
}

type AVValueBlock struct {
	ID         string `json:"id,omitempty" api:"optional,nullable"`
	Icon       string `json:"icon,omitempty" api:"optional,nullable"`
	Content    string `json:"content" api:"optional,nullable"`
	RefSubtype string `json:"refSubtype,omitempty" api:"optional,nullable,enum=s|d"`
	Created    int64  `json:"created,omitempty" api:"optional,nullable"`
	Updated    int64  `json:"updated,omitempty" api:"optional,nullable"`
}

type AVValueText struct {
	Content string           `json:"content" api:"optional,nullable"`
	Rich    *AVValueTextRich `json:"rich,omitempty" api:"optional,nullable"`
}

type AVValueTextRich struct {
	Spec    int    `json:"spec" api:"optional,nullable,const=1"`
	Format  string `json:"format" api:"optional,nullable,enum=kramdown"`
	Content string `json:"content" api:"optional,nullable"`
}

type AVValueNumber struct {
	Content          float64 `json:"content" api:"optional,nullable"`
	IsNotEmpty       bool    `json:"isNotEmpty" api:"optional,nullable"`
	Format           string  `json:"format" api:"optional,nullable"`
	FormattedContent string  `json:"formattedContent" api:"optional,nullable"`
}

type AVValueDate struct {
	Content          int64  `json:"content" api:"optional,nullable"`
	IsNotEmpty       bool   `json:"isNotEmpty" api:"optional,nullable"`
	HasEndDate       bool   `json:"hasEndDate" api:"optional,nullable"`
	IsNotTime        bool   `json:"isNotTime" api:"optional,nullable"`
	Content2         int64  `json:"content2" api:"optional,nullable"`
	IsNotEmpty2      bool   `json:"isNotEmpty2" api:"optional,nullable"`
	FormattedContent string `json:"formattedContent" api:"optional,nullable"`
}

type AVValueSelect struct {
	Content       string                `json:"content" api:"optional,nullable"`
	Color         string                `json:"color" api:"optional,nullable"`
	ResolvedColor *AVAttributeViewColor `json:"resolvedColor,omitempty" api:"optional,nullable"`
}

type AVAttributeViewColor struct {
	Light AVAttributeViewColorTheme `json:"light" api:"optional,nullable"`
	Dark  AVAttributeViewColorTheme `json:"dark" api:"optional,nullable"`
}

type AVAttributeViewColorTheme struct {
	Color           string `json:"color" api:"optional,nullable"`
	BackgroundColor string `json:"backgroundColor" api:"optional,nullable"`
}

type AVValueURL struct {
	Content string `json:"content" api:"optional,nullable"`
}

type AVValueEmail struct {
	Content string `json:"content" api:"optional,nullable"`
}

type AVValuePhone struct {
	Content string `json:"content" api:"optional,nullable"`
}

type AVValueAsset struct {
	Type    string `json:"type" api:"optional,nullable,enum=file|image"`
	Name    string `json:"name" api:"optional,nullable"`
	Content string `json:"content" api:"optional,nullable"`
}

type AVValueTemplate struct {
	Content string `json:"content" api:"optional,nullable"`
}

type AVValueCreated struct {
	Content          int64  `json:"content" api:"optional,nullable"`
	IsNotEmpty       bool   `json:"isNotEmpty" api:"optional,nullable"`
	Content2         int64  `json:"content2" api:"optional,nullable"`
	IsNotEmpty2      bool   `json:"isNotEmpty2" api:"optional,nullable"`
	FormattedContent string `json:"formattedContent" api:"optional,nullable"`
}

type AVValueUpdated struct {
	Content          int64  `json:"content" api:"optional,nullable"`
	IsNotEmpty       bool   `json:"isNotEmpty" api:"optional,nullable"`
	Content2         int64  `json:"content2" api:"optional,nullable"`
	IsNotEmpty2      bool   `json:"isNotEmpty2" api:"optional,nullable"`
	FormattedContent string `json:"formattedContent" api:"optional,nullable"`
}

type AVValueCheckbox struct {
	Checked bool `json:"checked" api:"optional,nullable"`
}

type AVValueRelation struct {
	BlockIDs []string   `json:"blockIDs" api:"optional,nullable"`
	Contents []*AVValue `json:"contents" api:"optional,nullable"`
}

type AVValueRollup struct {
	Contents []*AVValue `json:"contents" api:"optional,nullable"`
}

type AVRelativeDate struct {
	Count     int `json:"count" api:"optional,nullable"`
	Unit      int `json:"unit" api:"optional,nullable"`
	Direction int `json:"direction" api:"optional,nullable"`
}

type AVViewSort struct {
	Column       string `json:"column" api:"optional,nullable"`
	ValueSource  string `json:"valueSource,omitempty" api:"optional,nullable,enum=stored|rendered"`
	Order        string `json:"order" api:"optional,nullable,enum=|ASC|DESC"`
	DateEndpoint string `json:"dateEndpoint,omitempty" api:"optional,nullable,enum=start|end"`
}

type AVViewGroup struct {
	Field       string        `json:"field" api:"optional,nullable"`
	ValueSource string        `json:"valueSource,omitempty" api:"optional,nullable,enum=stored|rendered"`
	Method      int           `json:"method" api:"optional,nullable"`
	Range       *AVGroupRange `json:"range,omitempty" api:"optional,nullable"`
	Order       int           `json:"order" api:"optional,nullable"`
	HideEmpty   bool          `json:"hideEmpty" api:"optional,nullable"`
}

type AVGroupRange struct {
	NumStart float64 `json:"numStart" api:"optional,nullable"`
	NumEnd   float64 `json:"numEnd" api:"optional,nullable"`
	NumStep  float64 `json:"numStep" api:"optional,nullable"`
}

type AVKey struct {
	ID             string            `json:"id" api:"optional,nullable"`
	Name           string            `json:"name" api:"optional,nullable"`
	Type           string            `json:"type" api:"optional,nullable,enum=block|text|number|date|select|mSelect|url|email|phone|mAsset|template|created|updated|checkbox|relation|rollup|lineNumber"`
	Icon           string            `json:"icon" api:"optional,nullable"`
	Desc           string            `json:"desc" api:"optional,nullable"`
	Options        []*AVSelectOption `json:"options,omitempty" api:"optional,nullable"`
	NumberFormat   string            `json:"numberFormat" api:"optional,nullable"`
	DateFormat     string            `json:"dateFormat,omitempty" api:"optional,nullable,enum=|full|month-day-year|day-month-year|year-month-day"`
	Template       string            `json:"template" api:"optional,nullable"`
	RenderTemplate string            `json:"renderTemplate,omitempty" api:"optional,nullable"`
	Relation       *AVRelation       `json:"relation,omitempty" api:"optional,nullable"`
	Rollup         *AVRollup         `json:"rollup,omitempty" api:"optional,nullable"`
	Date           *AVDate           `json:"date,omitempty" api:"optional,nullable"`
	Created        *AVCreated        `json:"created,omitempty" api:"optional,nullable"`
	Updated        *AVUpdated        `json:"updated,omitempty" api:"optional,nullable"`
}

type AVSelectOption struct {
	Name          string                `json:"name" api:"optional,nullable"`
	Color         string                `json:"color" api:"optional,nullable"`
	Desc          string                `json:"desc" api:"optional,nullable"`
	ResolvedColor *AVAttributeViewColor `json:"resolvedColor,omitempty" api:"optional,nullable"`
}

type AVRelation struct {
	AvID             string          `json:"avID" api:"optional,nullable"`
	IsTwoWay         bool            `json:"isTwoWay" api:"optional,nullable"`
	BackKeyID        string          `json:"backKeyID" api:"optional,nullable"`
	CandidateFilters []*AVViewFilter `json:"candidateFilters,omitempty" api:"optional,nullable"`
}

type AVRollup struct {
	RelationKeyID string          `json:"relationKeyID" api:"optional,nullable"`
	KeyID         string          `json:"keyID" api:"optional,nullable"`
	Calc          *AVRollupCalc   `json:"calc" api:"optional,nullable"`
	Filters       []*AVViewFilter `json:"filters,omitempty" api:"optional,nullable"`
}

type AVRollupCalc struct {
	Operator string   `json:"operator" api:"optional,nullable"`
	Result   *AVValue `json:"result" api:"optional,nullable"`
}

type AVDate struct {
	AutoFillNow      bool `json:"autoFillNow" api:"optional,nullable"`
	FillSpecificTime bool `json:"fillSpecificTime" api:"optional,nullable"`
}

type AVCreated struct {
	IncludeTime bool `json:"includeTime" api:"optional,nullable"`
}

type AVUpdated struct {
	IncludeTime bool `json:"includeTime" api:"optional,nullable"`
}

type AVGroupCalc struct {
	Field     string       `json:"field" api:"optional,nullable"`
	FieldCalc *AVFieldCalc `json:"calc" api:"optional,nullable"`
}

type AVFieldCalc struct {
	Operator string   `json:"operator" api:"optional,nullable"`
	Result   *AVValue `json:"result" api:"optional,nullable"`
	Template string   `json:"template,omitempty" api:"optional,nullable"`
}

type AVTableColumn struct {
	*AVBaseInstanceField
	Pin   bool   `json:"pin" api:"optional,nullable"`
	Width string `json:"width" api:"optional,nullable"`
	Align string `json:"align" api:"optional,nullable,enum=|left|center|right"`
}

type AVBaseInstanceField struct {
	ID             string            `json:"id" api:"optional,nullable"`
	Name           string            `json:"name" api:"optional,nullable"`
	Type           string            `json:"type" api:"optional,nullable,enum=block|text|number|date|select|mSelect|url|email|phone|mAsset|template|created|updated|checkbox|relation|rollup|lineNumber"`
	Icon           string            `json:"icon" api:"optional,nullable"`
	Wrap           bool              `json:"wrap" api:"optional,nullable"`
	Hidden         bool              `json:"hidden" api:"optional,nullable"`
	Desc           string            `json:"desc" api:"optional,nullable"`
	Calc           *AVFieldCalc      `json:"calc" api:"optional,nullable"`
	Options        []*AVSelectOption `json:"options,omitempty" api:"optional,nullable"`
	NumberFormat   string            `json:"numberFormat" api:"optional,nullable"`
	DateFormat     string            `json:"dateFormat,omitempty" api:"optional,nullable,enum=|full|month-day-year|day-month-year|year-month-day"`
	Template       string            `json:"template" api:"optional,nullable"`
	RenderTemplate string            `json:"renderTemplate,omitempty" api:"optional,nullable"`
	Relation       *AVRelation       `json:"relation,omitempty" api:"optional,nullable"`
	Rollup         *AVRollup         `json:"rollup,omitempty" api:"optional,nullable"`
	Date           *AVDate           `json:"date,omitempty" api:"optional,nullable"`
	Created        *AVCreated        `json:"created,omitempty" api:"optional,nullable"`
	Updated        *AVUpdated        `json:"updated,omitempty" api:"optional,nullable"`
}

type AVTableRow struct {
	ID    string         `json:"id" api:"optional,nullable"`
	Cells []*AVTableCell `json:"cells" api:"optional,nullable"`
}

type AVTableCell struct {
	*AVBaseValue
	Color   string `json:"color" api:"optional,nullable"`
	BgColor string `json:"bgColor" api:"optional,nullable"`
}

type AVBaseValue struct {
	ID        string   `json:"id" api:"optional,nullable"`
	Value     *AVValue `json:"value" api:"optional,nullable"`
	ValueType string   `json:"valueType" api:"optional,nullable,enum=block|text|number|date|select|mSelect|url|email|phone|mAsset|template|created|updated|checkbox|relation|rollup|lineNumber"`
}

type AVGallery struct {
	*AVBaseInstance
	CoverFrom            int               `json:"coverFrom" api:"optional,nullable"`
	CoverFromAssetKeyID  string            `json:"coverFromAssetKeyID,omitempty" api:"optional,nullable"`
	CardAspectRatio      int               `json:"cardAspectRatio" api:"optional,nullable"`
	CardAspectRatioValue float64           `json:"cardAspectRatioValue" api:"optional,nullable"`
	CardSize             int               `json:"cardSize" api:"optional,nullable"`
	CardWidth            int               `json:"cardWidth" api:"optional,nullable"`
	CardLayout           int               `json:"cardLayout" api:"optional,nullable"`
	FitImage             bool              `json:"fitImage" api:"optional,nullable"`
	DisplayFieldName     bool              `json:"displayFieldName" api:"optional,nullable"`
	DisplayEmptyFields   bool              `json:"displayEmptyFields" api:"optional,nullable"`
	Fields               []*AVGalleryField `json:"fields" api:"optional,nullable"`
	Cards                []*AVGalleryCard  `json:"cards" api:"optional,nullable"`
	CardCount            int               `json:"cardCount" api:"optional,nullable"`
}

type AVGalleryField struct {
	*AVBaseInstanceField
	FullRow bool `json:"fullRow" api:"optional,nullable"`
}

type AVGalleryCard struct {
	ID            string                 `json:"id" api:"optional,nullable"`
	Values        []*AVGalleryFieldValue `json:"values" api:"optional,nullable"`
	CoverURL      string                 `json:"coverURL" api:"optional,nullable"`
	CoverContent  string                 `json:"coverContent" api:"optional,nullable"`
	CoverPosition *AVCardCoverPosition   `json:"coverPosition,omitempty" api:"optional,nullable"`
}

type AVGalleryFieldValue struct {
	*AVBaseValue
}

type AVCardCoverPosition struct {
	Image string  `json:"image" api:"optional,nullable"`
	X     float64 `json:"x" api:"optional,nullable"`
	Y     float64 `json:"y" api:"optional,nullable"`
}

type AVKanban struct {
	*AVBaseInstance
	CoverFrom              int              `json:"coverFrom" api:"optional,nullable"`
	CoverFromAssetKeyID    string           `json:"coverFromAssetKeyID,omitempty" api:"optional,nullable"`
	CardAspectRatio        int              `json:"cardAspectRatio" api:"optional,nullable"`
	CardAspectRatioValue   float64          `json:"cardAspectRatioValue" api:"optional,nullable"`
	CardSize               int              `json:"cardSize" api:"optional,nullable"`
	CardWidth              int              `json:"cardWidth" api:"optional,nullable"`
	CardLayout             int              `json:"cardLayout" api:"optional,nullable"`
	FitImage               bool             `json:"fitImage" api:"optional,nullable"`
	DisplayFieldName       bool             `json:"displayFieldName" api:"optional,nullable"`
	DisplayEmptyFields     bool             `json:"displayEmptyFields" api:"optional,nullable"`
	FillColBackgroundColor bool             `json:"fillColBackgroundColor" api:"optional,nullable"`
	Fields                 []*AVKanbanField `json:"fields" api:"optional,nullable"`
	Cards                  []*AVKanbanCard  `json:"cards" api:"optional,nullable"`
	CardCount              int              `json:"cardCount" api:"optional,nullable"`
}

type AVKanbanField struct {
	*AVBaseInstanceField
	FullRow bool `json:"fullRow" api:"optional,nullable"`
}

type AVKanbanCard struct {
	ID            string                `json:"id" api:"optional,nullable"`
	Values        []*AVKanbanFieldValue `json:"values" api:"optional,nullable"`
	CoverURL      string                `json:"coverURL" api:"optional,nullable"`
	CoverContent  string                `json:"coverContent" api:"optional,nullable"`
	CoverPosition *AVCardCoverPosition  `json:"coverPosition,omitempty" api:"optional,nullable"`
}

type AVKanbanFieldValue struct {
	*AVBaseValue
}

type AVKeyValues struct {
	Key    *AVKey     `json:"key" api:"optional,nullable"`
	Values []*AVValue `json:"values,omitempty" api:"optional,nullable"`
}

type AVViewData struct {
	ID               string `json:"id" api:"optional,nullable"`
	Icon             string `json:"icon" api:"optional,nullable"`
	Name             string `json:"name" api:"optional,nullable"`
	Desc             string `json:"desc" api:"optional,nullable"`
	HideAttrViewName bool   `json:"hideAttrViewName" api:"optional,nullable"`
	Type             string `json:"type" api:"optional,nullable,enum=table|list|gallery|kanban|calendar"`
	PageSize         int    `json:"pageSize" api:"optional,nullable"`
}

type AVNewItemTemplate struct {
	ID                  string                          `json:"id" api:"optional,nullable"`
	Name                string                          `json:"name" api:"optional,nullable"`
	Icon                string                          `json:"icon,omitempty" api:"optional,nullable"`
	TargetType          string                          `json:"targetType" api:"optional,nullable,enum=detached|document"`
	PrimaryKeyTemplate  string                          `json:"primaryKeyTemplate,omitempty" api:"optional,nullable"`
	FieldValues         map[string]*AVNewItemFieldValue `json:"fieldValues,omitempty" api:"optional,nullable"`
	SaveLocation        *AVNewItemSaveLocation          `json:"saveLocation,omitempty" api:"optional,nullable"`
	ContentTemplatePath string                          `json:"contentTemplatePath,omitempty" api:"optional,nullable"`
	HideInFileTree      bool                            `json:"hideInFileTree,omitempty" api:"optional,nullable"`
}

type AVNewItemFieldValue struct {
	Mode  string   `json:"mode" api:"optional,nullable,enum=static|currentTime"`
	Value *AVValue `json:"value,omitempty" api:"optional,nullable"`
}

type AVNewItemSaveLocation struct {
	BoxID        string `json:"boxID,omitempty" api:"optional,nullable"`
	PathTemplate string `json:"pathTemplate" api:"optional,nullable"`
}

type AVAttributeViewContextFilter struct {
	Spec  int    `json:"spec" api:"optional,nullable,const=1"`
	KeyID string `json:"keyID" api:"optional,nullable"`
}

type AVAttributeViewContextFilterField struct {
	ID         string `json:"id" api:"optional,nullable"`
	Name       string `json:"name" api:"optional,nullable"`
	Icon       string `json:"icon" api:"optional,nullable"`
	TargetAvID string `json:"targetAvID" api:"optional,nullable"`
}

type AVAttributeViewData struct {
	Spec               int                                        `json:"spec" api:"optional,nullable"`
	ID                 string                                     `json:"id" api:"optional,nullable"`
	Name               string                                     `json:"name" api:"optional,nullable"`
	CustomColors       []*AVAttributeViewCustomColor              `json:"customColors" api:"optional,nullable"`
	KeyValues          []*AVKeyValues                             `json:"keyValues" api:"optional,nullable"`
	KeyIDs             []string                                   `json:"keyIDs" api:"optional,nullable"`
	ViewID             string                                     `json:"viewID" api:"optional,nullable"`
	Views              []*AVView                                  `json:"views" api:"optional,nullable"`
	NewItemTemplates   []*AVNewItemTemplate                       `json:"newItemTemplates,omitempty" api:"optional,nullable"`
	DefaultTemplateID  string                                     `json:"defaultTemplateID,omitempty" api:"optional,nullable"`
	CardCoverPositions map[string]map[string]*AVCardCoverPosition `json:"cardCoverPositions,omitempty" api:"optional,nullable"`
}

type AVAttributeViewCustomColor struct {
	Index  int  `json:"index" api:"optional,nullable"`
	Hidden bool `json:"hidden,omitempty" api:"optional,nullable"`
	AVAttributeViewColor
}

type AVView struct {
	ID               string            `json:"id" api:"optional,nullable"`
	Icon             string            `json:"icon" api:"optional,nullable"`
	Name             string            `json:"name" api:"optional,nullable"`
	HideAttrViewName bool              `json:"hideAttrViewName" api:"optional,nullable"`
	Desc             string            `json:"desc" api:"optional,nullable"`
	Filters          []*AVViewFilter   `json:"filters,omitempty" api:"optional,nullable"`
	Sorts            []*AVViewSort     `json:"sorts,omitempty" api:"optional,nullable"`
	PageSize         int               `json:"pageSize" api:"optional,nullable"`
	LayoutType       string            `json:"type" api:"optional,nullable,enum=table|list|gallery|kanban|calendar"`
	Table            *AVLayoutTable    `json:"table,omitempty" api:"optional,nullable"`
	Calendar         *AVLayoutCalendar `json:"calendar,omitempty" api:"optional,nullable"`
	List             *AVLayoutTable    `json:"list,omitempty" api:"optional,nullable"`
	Gallery          *AVLayoutGallery  `json:"gallery,omitempty" api:"optional,nullable"`
	Kanban           *AVLayoutKanban   `json:"kanban,omitempty" api:"optional,nullable"`
	ItemIDs          []string          `json:"itemIds,omitempty" api:"optional,nullable"`
	Group            *AVViewGroup      `json:"group,omitempty" api:"optional,nullable"`
	GroupCreated     int64             `json:"groupCreated" api:"optional,nullable"`
	Groups           []*AVView         `json:"groups,omitempty" api:"optional,nullable"`
	GroupItemIDs     []string          `json:"groupItemIds" api:"optional,nullable"`
	GroupCalc        *AVGroupCalc      `json:"groupCalc,omitempty" api:"optional,nullable"`
	GroupKey         *AVKey            `json:"groupKey,omitempty" api:"optional,nullable"`
	GroupVal         *AVValue          `json:"groupVal,omitempty" api:"optional,nullable"`
	GroupFolded      bool              `json:"groupFolded" api:"optional,nullable"`
	GroupHidden      int               `json:"groupHidden" api:"optional,nullable"`
	GroupSort        int               `json:"groupSort" api:"optional,nullable"`
}

type AVLayoutTable struct {
	*AVBaseLayout
	Columns []*AVViewTableColumn `json:"columns" api:"optional,nullable"`
	RowIDs  []string             `json:"rowIds" api:"optional,nullable"`
}

type AVBaseLayout struct {
	Spec      int             `json:"spec" api:"optional,nullable"`
	ID        string          `json:"id" api:"optional,nullable"`
	ShowIcon  bool            `json:"showIcon" api:"optional,nullable"`
	WrapField bool            `json:"wrapField" api:"optional,nullable"`
	Filters   []*AVViewFilter `json:"filters,omitempty" api:"optional,nullable"`
	Sorts     []*AVViewSort   `json:"sorts,omitempty" api:"optional,nullable"`
	PageSize  int             `json:"pageSize,omitempty" api:"optional,nullable"`
}

type AVViewTableColumn struct {
	*AVBaseField
	Pin   bool         `json:"pin" api:"optional,nullable"`
	Width string       `json:"width" api:"optional,nullable"`
	Align string       `json:"align,omitempty" api:"optional,nullable,enum=|left|center|right"`
	Calc  *AVFieldCalc `json:"calc,omitempty" api:"optional,nullable"`
}

type AVBaseField struct {
	ID     string       `json:"id" api:"optional,nullable"`
	Wrap   bool         `json:"wrap" api:"optional,nullable"`
	Hidden bool         `json:"hidden" api:"optional,nullable"`
	Desc   string       `json:"desc,omitempty" api:"optional,nullable"`
	Calc   *AVFieldCalc `json:"calc,omitempty" api:"optional,nullable"`
}

type AVLayoutGallery struct {
	*AVBaseLayout
	CoverFrom            int                       `json:"coverFrom" api:"optional,nullable"`
	CoverFromAssetKeyID  string                    `json:"coverFromAssetKeyID,omitempty" api:"optional,nullable"`
	CardAspectRatio      int                       `json:"cardAspectRatio" api:"optional,nullable"`
	CardAspectRatioValue float64                   `json:"cardAspectRatioValue" api:"optional,nullable"`
	CardSize             int                       `json:"cardSize" api:"optional,nullable"`
	CardWidth            int                       `json:"cardWidth" api:"optional,nullable"`
	CardLayout           int                       `json:"cardLayout" api:"optional,nullable"`
	FitImage             bool                      `json:"fitImage" api:"optional,nullable"`
	DisplayFieldName     bool                      `json:"displayFieldName" api:"optional,nullable"`
	DisplayEmptyFields   bool                      `json:"displayEmptyFields" api:"optional,nullable"`
	CardFields           []*AVViewGalleryCardField `json:"fields" api:"optional,nullable"`
	CardIDs              []string                  `json:"cardIds" api:"optional,nullable"`
}

type AVViewGalleryCardField struct {
	*AVBaseField
	FullRow bool `json:"fullRow" api:"optional,nullable"`
}

type AVLayoutKanban struct {
	*AVBaseLayout
	CoverFrom              int                  `json:"coverFrom" api:"optional,nullable"`
	CoverFromAssetKeyID    string               `json:"coverFromAssetKeyID,omitempty" api:"optional,nullable"`
	CardAspectRatio        int                  `json:"cardAspectRatio" api:"optional,nullable"`
	CardAspectRatioValue   float64              `json:"cardAspectRatioValue" api:"optional,nullable"`
	CardSize               int                  `json:"cardSize" api:"optional,nullable"`
	CardWidth              int                  `json:"cardWidth" api:"optional,nullable"`
	CardLayout             int                  `json:"cardLayout" api:"optional,nullable"`
	FitImage               bool                 `json:"fitImage" api:"optional,nullable"`
	DisplayFieldName       bool                 `json:"displayFieldName" api:"optional,nullable"`
	DisplayEmptyFields     bool                 `json:"displayEmptyFields" api:"optional,nullable"`
	FillColBackgroundColor bool                 `json:"fillColBackgroundColor" api:"optional,nullable"`
	Fields                 []*AVViewKanbanField `json:"fields" api:"optional,nullable"`
}

type AVViewKanbanField struct {
	*AVBaseField
	FullRow bool `json:"fullRow" api:"optional,nullable"`
}

type AVAttributeViewFieldView struct {
	ID     string `json:"id" api:"optional,nullable"`
	Icon   string `json:"icon" api:"optional,nullable"`
	Name   string `json:"name" api:"optional,nullable"`
	Type   string `json:"type" api:"optional,nullable,enum=table|list|gallery|kanban|calendar"`
	Hidden bool   `json:"hidden" api:"optional,nullable"`
}

type AVAvSearchResult struct {
	AvID       string              `json:"avID" api:"optional,nullable"`
	AvName     string              `json:"avName" api:"optional,nullable"`
	ViewName   string              `json:"viewName" api:"optional,nullable"`
	ViewID     string              `json:"viewID" api:"optional,nullable"`
	ViewLayout string              `json:"viewLayout" api:"optional,nullable,enum=|table|list|gallery|kanban|calendar"`
	BlockID    string              `json:"blockID" api:"optional,nullable"`
	HPath      string              `json:"hPath" api:"optional,nullable"`
	Matched    bool                `json:"matched,omitempty" api:"optional,nullable"`
	Children   []*AVAvSearchResult `json:"children,omitempty" api:"optional,nullable"`
}

type AVBlockAttributeViewKeys struct {
	AvID          string                         `json:"avID" api:"optional,nullable"`
	AvName        string                         `json:"avName" api:"optional,nullable"`
	CustomColors  []*AVAttributeViewCustomColor  `json:"customColors" api:"optional,nullable"`
	BlockIDs      []string                       `json:"blockIDs" api:"optional,nullable"`
	KeyValues     []*AVKeyValues                 `json:"keyValues" api:"optional,nullable"`
	ItemPositions []*AVAttributeViewItemPosition `json:"itemPositions" api:"optional,nullable"`
}

type AVAttributeViewItemPosition struct {
	ViewID     string                              `json:"viewID" api:"optional,nullable"`
	PreviousID string                              `json:"previousID" api:"optional,nullable"`
	Groups     []*AVAttributeViewGroupItemPosition `json:"groups" api:"optional,nullable"`
}

type AVAttributeViewGroupItemPosition struct {
	GroupID    string `json:"groupID" api:"optional,nullable"`
	PreviousID string `json:"previousID" api:"optional,nullable"`
}

type AVAttributeViewSearchTarget struct {
	AvID            string   `json:"avID" api:"optional,nullable"`
	DatabaseBlockID string   `json:"databaseBlockID" api:"optional,nullable"`
	NotebookID      string   `json:"notebookID" api:"optional,nullable"`
	ViewID          string   `json:"viewID,omitempty" api:"optional,nullable"`
	GroupID         string   `json:"groupID,omitempty" api:"optional,nullable"`
	ItemID          string   `json:"itemID" api:"optional,nullable"`
	ValueID         string   `json:"valueID" api:"optional,nullable"`
	MatchedValueID  string   `json:"matchedValueID" api:"optional,nullable"`
	MatchedKeyID    string   `json:"matchedKeyID" api:"optional,nullable"`
	Title           string   `json:"title" api:"optional,nullable"`
	BoundBlockID    string   `json:"boundBlockID" api:"optional,nullable"`
	IsDetached      bool     `json:"isDetached" api:"optional,nullable"`
	Keywords        []string `json:"keywords" api:"optional,nullable"`
}

type AVAttributeViewBacklinks struct {
	Total int                        `json:"total" api:"optional,nullable"`
	Items []*AVAttributeViewBacklink `json:"items" api:"optional,nullable"`
}

type AVAttributeViewBacklink struct {
	AvID            string                             `json:"avID" api:"optional,nullable"`
	AvName          string                             `json:"avName" api:"optional,nullable"`
	BlockIDs        []string                           `json:"blockIDs" api:"optional,nullable"`
	DatabaseBlockID string                             `json:"databaseBlockID" api:"optional,nullable"`
	BoxID           string                             `json:"boxID" api:"optional,nullable"`
	DatabasePath    string                             `json:"databasePath" api:"optional,nullable"`
	ItemID          string                             `json:"itemID" api:"optional,nullable"`
	ValueID         string                             `json:"valueID" api:"optional,nullable"`
	Title           string                             `json:"title" api:"optional,nullable"`
	Icon            string                             `json:"icon" api:"optional,nullable"`
	BoundBlockID    string                             `json:"boundBlockID" api:"optional,nullable"`
	IsDetached      bool                               `json:"isDetached" api:"optional,nullable"`
	Relations       []*AVAttributeViewBacklinkRelation `json:"relations" api:"optional,nullable"`
}

type AVAttributeViewBacklinkRelation struct {
	KeyID        string `json:"keyID" api:"optional,nullable"`
	KeyName      string `json:"keyName" api:"optional,nullable"`
	TargetAvID   string `json:"targetAvID" api:"optional,nullable"`
	TargetItemID string `json:"targetItemID" api:"optional,nullable"`
}

type AVAttributeViewRenderTarget struct {
	Status   string `json:"status" api:"optional,nullable,enum=visible|filtered|itemNotFound|groupHidden"`
	ItemID   string `json:"itemID" api:"optional,nullable"`
	GroupID  string `json:"groupID,omitempty" api:"optional,nullable"`
	Index    int    `json:"index" api:"optional,nullable"`
	Offset   int    `json:"offset" api:"optional,nullable"`
	PageSize int    `json:"pageSize" api:"optional,nullable"`
}

type AVCreateAttributeViewItemResult struct {
	ItemID     string   `json:"itemID" api:"optional,nullable"`
	BlockID    string   `json:"blockID" api:"optional,nullable"`
	Content    string   `json:"content" api:"optional,nullable"`
	IsDetached bool     `json:"isDetached" api:"optional,nullable"`
	Warnings   []string `json:"warnings,omitempty" api:"optional,nullable"`
}

type AVCreateAttributeViewItemDocsResult struct {
	ItemIDs        []string `json:"itemIDs" api:"optional,nullable"`
	BlockIDs       []string `json:"blockIDs" api:"optional,nullable"`
	SkippedItemIDs []string `json:"skippedItemIDs,omitempty" api:"optional,nullable"`
	Warnings       []string `json:"warnings,omitempty" api:"optional,nullable"`
}
