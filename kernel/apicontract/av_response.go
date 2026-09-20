package apicontract

type AVIDData struct {
	ID string `json:"id"`
}
type AVPathsData struct {
	Paths []string `json:"paths"`
}
type AVValuesData struct {
	Values map[string]*AVValue `json:"values"`
}
type AVValueData struct {
	Value *AVValue `json:"value"`
}
type AVDuplicateData struct {
	AvID    string `json:"avID"`
	BlockID string `json:"blockID"`
}
type AVContextFilterData struct {
	ContextFilter *AVAttributeViewContextFilter `json:"contextFilter"`
}
type AVPrimaryValuesData struct {
	Name     string       `json:"name"`
	BlockIDs []string     `json:"blockIDs"`
	Rows     *AVKeyValues `json:"rows"`
	Total    int          `json:"total"`
}
type AVRelationCandidatesData struct {
	Name         string                        `json:"name"`
	BlockIDs     []string                      `json:"blockIDs"`
	CustomColors []*AVAttributeViewCustomColor `json:"customColors"`
	NotebookID   string                        `json:"notebookID"`
	Columns      []*AVTableColumn              `json:"columns"`
	SelectedRows []*AVTableRow                 `json:"selectedRows"`
	Rows         []*AVTableRow                 `json:"rows"`
	Total        int                           `json:"total"`
}
type AVFilterSortData struct {
	Filters []*AVViewFilter `json:"filters"`
	Sorts   []*AVViewSort   `json:"sorts"`
}
type AVKeysData struct {
	Keys []*AVKey `json:"keys"`
}
type AVData struct {
	Av *AVAttributeViewData `json:"av"`
}
type AVPasteRowsData struct {
	View            *AVTable `json:"view"`
	InferableKeyIDs []string `json:"inferableKeyIDs"`
}
type AVFieldViewsData struct {
	Views []*AVAttributeViewFieldView `json:"views"`
}
type AVSearchData struct {
	Results []*AVAvSearchResult `json:"results"`
}
type AVArchiveRenderData struct {
	Name                   string                        `json:"name"`
	ID                     string                        `json:"id"`
	CustomColors           []*AVAttributeViewCustomColor `json:"customColors"`
	ColorOrder             []string                      `json:"colorOrder"`
	UsedCustomColorIndexes []int                         `json:"usedCustomColorIndexes"`
	ViewType               string                        `json:"viewType" api:"enum=table|list|gallery|kanban|calendar"`
	ViewID                 string                        `json:"viewID"`
	Views                  []*AVViewData                 `json:"views"`
	View                   AVViewInstance                `json:"view"`
	IsMirror               bool                          `json:"isMirror"`
	NewItemTemplates       []*AVNewItemTemplate          `json:"newItemTemplates"`
	DefaultTemplateID      string                        `json:"defaultTemplateID"`
}
type AVRenderData struct {
	AVArchiveRenderData
	ContextFilter       *AVAttributeViewContextFilter        `json:"contextFilter"`
	ContextFilterFields []*AVAttributeViewContextFilterField `json:"contextFilterFields"`
	Target              *AVAttributeViewRenderTarget         `json:"target,omitempty"`
}
type AVViewNotFound struct {
	Error string `json:"error" api:"const=\"viewNotFound\""`
}
type AVUnavailableNotebook struct {
	UnavailableNotebook bool `json:"unavailableNotebook" api:"const=true"`
}
type AVGroupPaging struct {
	Page     *float64 `json:"page" api:"optional"`
	PageSize *float64 `json:"pageSize" api:"optional"`
}
type AVBlockSource struct {
	ID         string  `json:"id" api:"optional,nullable"`
	ItemID     *string `json:"itemID" api:"optional"`
	Content    *string `json:"content" api:"optional"`
	IsDetached bool    `json:"isDetached"`
}
type AVCellUpdate struct {
	KeyID  string        `json:"keyID"`
	ItemID *string       `json:"itemID" api:"optional"`
	RowID  *string       `json:"rowID" api:"optional"`
	Value  *AVValuePatch `json:"value" api:"optional"`
}
type AVRowOrder struct {
	ItemIDs []string            `json:"itemIDs"`
	Groups  map[string][]string `json:"groups"`
	Sorts   []*AVViewSort       `json:"sorts"`
}
type AVRowOrderChange struct {
	RowOrder      *AVRowOrder `json:"rowOrder"`
	Expected      *AVRowOrder `json:"expected"`
	ValidateGroup *string     `json:"validateGroup,omitempty"`
}
type AVRowSortPreview struct {
	Conflict       bool                  `json:"conflict"`
	DoOperations   []*AVRowSortOperation `json:"doOperations"`
	UndoOperations []*AVRowSortOperation `json:"undoOperations"`
}

type AVRowSortOperation struct {
	Action            string            `json:"action" api:"const=\"sortAttrViewRow\""`
	Data              *AVRowOrderChange `json:"data"`
	ID                string            `json:"id"`
	RootID            string            `json:"rootID"`
	ParentID          string            `json:"parentID"`
	PreviousID        string            `json:"previousID"`
	NextID            string            `json:"nextID"`
	RetData           Null              `json:"retData"`
	BlockIDs          []string          `json:"blockIDs"`
	BlockID           string            `json:"blockID"`
	DeckID            string            `json:"deckID"`
	AvID              string            `json:"avID"`
	SrcIDs            []string          `json:"srcIDs"`
	Srcs              Null              `json:"srcs"`
	IsDetached        bool              `json:"isDetached"`
	Name              string            `json:"name"`
	Typ               string            `json:"type" api:"const=\"\""`
	Format            string            `json:"format"`
	KeyID             string            `json:"keyID"`
	RowID             string            `json:"rowID"`
	IsTwoWay          bool              `json:"isTwoWay"`
	BackRelationKeyID string            `json:"backRelationKeyID"`
	RemoveDest        bool              `json:"removeDest"`
	Layout            string            `json:"layout"`
	GroupID           string            `json:"groupID"`
	TargetGroupID     string            `json:"targetGroupID"`
	ViewID            string            `json:"viewID"`
	ViewIDs           []string          `json:"viewIDs,omitempty"`
	IgnoreDefaultFill bool              `json:"ignoreDefaultFill"`
	Context           map[string]string `json:"context"`
}
