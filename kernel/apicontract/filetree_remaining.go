package apicontract

type FileTreeNotebookRequest struct {
	Notebook string `json:"notebook"`
}
type FileTreePathRequest struct {
	Notebook  string `json:"notebook"`
	Path      string `json:"path"`
	pathError error
}
type FileTreePathsRequest struct {
	Paths []string `json:"paths"`
}
type FileTreeIDRequest struct {
	ID string `json:"id"`
}
type FileTreeTrimIDRequest struct {
	ID string `json:"id" api:"trim"`
}
type FileTreeOptionalIDRequest struct {
	ID *string `json:"id" api:"optional"`
}
type FileTreeOptionalPathRequest struct {
	Notebook *string `json:"notebook" api:"optional"`
	Path     *string `json:"path" api:"optional"`
}
type FileTreeDocHeadingRequest struct {
	SrcID    string `json:"srcID"`
	TargetID string `json:"targetID"`
	After    bool   `json:"after"`
}
type FileTreeBlockDocOptions struct {
	TargetPath   string `json:"targetPath" api:"optional,nullable"`
	PreviousPath string `json:"previousPath" api:"optional,nullable"`
	ToTop        bool   `json:"toTop" api:"optional,nullable"`
}
type FileTreeHeadingDocRequest struct {
	SrcHeadingID   string `json:"srcHeadingID"`
	TargetNotebook string `json:"targetNoteBook"`
	FileTreeBlockDocOptions
	fields fileTreeFields
}
type FileTreeListItemDocRequest struct {
	SrcListItemID  string `json:"srcListItemID"`
	TargetNotebook string `json:"targetNoteBook"`
	FileTreeBlockDocOptions
	fields fileTreeFields
}
type FileTreeMoveRequest struct {
	FromPaths  []string   `json:"fromPaths"`
	ToPath     string     `json:"toPath"`
	ToNotebook string     `json:"toNotebook"`
	Callback   *JSONValue `json:"callback" api:"optional"`
}
type FileTreeMoveIDsRequest struct {
	FromIDs  []string   `json:"fromIDs"`
	ToID     string     `json:"toID"`
	Callback *JSONValue `json:"callback" api:"optional"`
}
type FileTreeRenameRequest struct {
	FileTreePathRequest
	Title string `json:"title"`
}
type FileTreeRenameIDRequest struct {
	ID     *string `json:"id" api:"optional"`
	Title  string  `json:"title"`
	fields fileTreeFields
}
type FileTreeCreateOptions struct {
	SortTargetID          string `json:"sortTargetID" api:"optional,nullable,ignoretype"`
	SortPosition          string `json:"sortPosition" api:"optional,nullable,ignoretype"`
	DocCreateTemplatePath string `json:"docCreateTemplatePath" api:"optional,nullable,ignoretype"`
	ListDocTree           bool   `json:"listDocTree" api:"optional,nullable"`
}
type FileTreeCreateRequest struct {
	FileTreePathRequest
	Title string   `json:"title"`
	MD    string   `json:"md"`
	Sorts []string `json:"sorts" api:"optional,nullable"`
	FileTreeCreateOptions
}
type FileTreeDailyNoteRequest struct {
	Notebook string `json:"notebook"`
	App      string `json:"app" api:"optional,nullable"`
	fields   fileTreeFields
}
type FileTreeCreateMarkdownRequest struct {
	FileTreePathRequest
	Markdown     string  `json:"markdown"`
	Tags         string  `json:"tags" api:"optional,nullable"`
	ParentID     string  `json:"parentID" api:"optional,nullable"`
	ID           *string `json:"id" api:"optional"`
	WithMath     bool    `json:"withMath" api:"optional,nullable"`
	ClippingHref string  `json:"clippingHref" api:"optional,nullable"`
	TitleEmpty   bool    `json:"titleEmpty" api:"optional"`
	FileTreeCreateOptions
}
type FileTreeChangeSortRequest struct {
	Notebook string   `json:"notebook"`
	Paths    []string `json:"paths"`
}
type FileTreeReorderRequest struct {
	RespectSort bool     `json:"respectSort" api:"optional,nullable"`
	Preview     bool     `json:"preview" api:"optional,nullable"`
	RemoveSorts bool     `json:"removeSorts" api:"optional,nullable"`
	SourceIDs   []string `json:"sourceIDs" api:"optional,nullable"`
	TargetID    string   `json:"targetID" api:"optional,nullable"`
	Position    string   `json:"position" api:"optional,nullable"`
}
type FileTreeSortItem struct {
	ID   string `json:"id" api:"optional,nullable"`
	Sort *int   `json:"sort" api:"optional"`
}
type FileTreeSetSortRequest struct {
	NotebookSorts []*FileTreeSortItem `json:"notebookSorts" api:"optional,nullable"`
	DocSorts      []*FileTreeSortItem `json:"docSorts" api:"optional,nullable"`
}
type FileTreeSortModeRequest struct {
	ID             string `json:"id" api:"optional,nullable"`
	SortMode       *int   `json:"sortMode"`
	sortModeFields fileTreeFields
}
type FileTreeSearchRequest struct {
	K          string   `json:"k"`
	Flashcard  bool     `json:"flashcard" api:"optional,nullable"`
	ExcludeIDs []string `json:"excludeIDs" api:"optional,nullable"`
}
type FileTreeListOptions struct {
	Sort              *float64 `json:"sort" api:"optional"`
	Flashcard         bool     `json:"flashcard" api:"optional,nullable"`
	MaxListCount      *float64 `json:"maxListCount" api:"optional"`
	ShowHidden        bool     `json:"showHidden" api:"optional,nullable"`
	IgnoreMaxListHint bool     `json:"ignoreMaxListHint" api:"optional,nullable"`
	App               string   `json:"app" api:"optional,nullable"`
}
type FileTreeListRequest struct {
	FileTreePathRequest
	FileTreeListOptions
	fields fileTreeFields
}
type FileTreeGetDocOptions struct {
	IncludeDocInfo      bool                 `json:"includeDocInfo" api:"optional,nullable"`
	Index               float64              `json:"index" api:"optional,nullable"`
	Query               string               `json:"query" api:"optional,nullable"`
	QueryMethod         float64              `json:"queryMethod" api:"optional,nullable"`
	QueryTypes          map[string]bool      `json:"queryTypes" api:"optional,nullable"`
	QuerySubTypes       *SearchSubtypeFilter `json:"querySubTypes" api:"optional"`
	Mode                float64              `json:"mode" api:"optional,nullable"`
	Size                *float64             `json:"size" api:"optional"`
	StartID             *string              `json:"startID" api:"optional"`
	EndID               *string              `json:"endID" api:"optional"`
	IsBacklink          bool                 `json:"isBacklink" api:"optional,nullable"`
	OriginalRefBlockIDs map[string]string    `json:"originalRefBlockIDs" api:"optional,nullable"`
	Highlight           *bool                `json:"highlight" api:"optional"`
	ReqID               JSONValue            `json:"reqId" api:"optional,nullable"`
}
type FileTreeGetDocRequest struct {
	ID       string `json:"id" api:"trim"`
	Notebook string `json:"notebook" api:"optional,nullable,ignoretype"`
	FileTreeGetDocOptions
	fields fileTreeFields
}
type FileTreePublishOptions struct {
	Visible  bool   `json:"visible"`
	Password string `json:"password"`
	Disable  bool   `json:"disable"`
}
type FileTreeSetPublishRequest struct {
	ID string `json:"id"`
	FileTreePublishOptions
	fields fileTreeFields
}
type FileTreePublishIDsRequest struct {
	IDs []string `json:"ids"`
}
type FileTreeAuthPublishRequest struct {
	ID       string `json:"id"`
	Password string `json:"password"`
}
type FileTreeDocFile struct {
	ID       string             `json:"id"`
	Children []*FileTreeDocFile `json:"children,omitempty"`
}
type FileTreeDocTreeData struct {
	Tree []*FileTreeDocFile `json:"tree"`
}
type FileTreeDocHeadingData struct {
	SrcTreeBox  string `json:"srcTreeBox"`
	SrcTreePath string `json:"srcTreePath"`
}
type FileTreeDocPathData struct {
	Path     string `json:"path"`
	Notebook string `json:"notebook"`
}
type FileTreeDuplicateData struct {
	ID       string `json:"id"`
	Notebook string `json:"notebook"`
	Path     string `json:"path"`
	HPath    string `json:"hPath"`
}
type FileTreeCreateData struct {
	ID string `json:"id"`
}
type FileTreeSavePathData struct {
	Box  string `json:"box"`
	Path string `json:"path"`
}
type FileTreeCreateSavePathData struct {
	FileTreeSavePathData
	DocCreateTemplatePath string `json:"docCreateTemplatePath"`
}
type FileTreeReorderData struct {
	Changed    bool    `json:"changed"`
	Conflict   *bool   `json:"conflict,omitempty"`
	Notebook   *string `json:"notebook,omitempty"`
	ParentPath *string `json:"parentPath,omitempty"`
}
type FileTreeSetSortData struct {
	NotebookIDs []string `json:"notebookIDs"`
	DocIDs      []string `json:"docIDs"`
}
type FileTreeSortModeData struct {
	Box               string `json:"box"`
	ID                string `json:"id"`
	Path              string `json:"path"`
	SortMode          *int   `json:"sortMode"`
	EffectiveSortMode int    `json:"effectiveSortMode"`
}
type FileTreeSearchDoc struct {
	Path              string  `json:"path"`
	HPath             string  `json:"hPath"`
	Box               string  `json:"box"`
	BoxIcon           string  `json:"boxIcon"`
	Name              *string `json:"name,omitempty"`
	Alias             *string `json:"alias,omitempty"`
	NewFlashcardCount *string `json:"newFlashcardCount,omitempty"`
	DueFlashcardCount *string `json:"dueFlashcardCount,omitempty"`
	FlashcardCount    *string `json:"flashcardCount,omitempty"`
}
type FileTreeFile struct {
	Path              string `json:"path"`
	Name              string `json:"name"`
	TitleEmpty        bool   `json:"titleEmpty,omitempty"`
	Icon              string `json:"icon"`
	Name1             string `json:"name1"`
	Alias             string `json:"alias"`
	Memo              string `json:"memo"`
	Bookmark          string `json:"bookmark"`
	ID                string `json:"id"`
	Count             int    `json:"count"`
	Size              uint64 `json:"size"`
	HSize             string `json:"hSize"`
	Mtime             int64  `json:"mtime"`
	CTime             int64  `json:"ctime"`
	HMtime            string `json:"hMtime"`
	HCtime            string `json:"hCtime"`
	Sort              int    `json:"sort"`
	SubFileCount      int    `json:"subFileCount"`
	ChildrenSortMode  *int   `json:"childrenSortMode"`
	NewFlashcardCount int    `json:"newFlashcardCount"`
	DueFlashcardCount int    `json:"dueFlashcardCount"`
	FlashcardCount    int    `json:"flashcardCount"`
}
type FileTreeListData struct {
	Box               string          `json:"box"`
	Path              string          `json:"path"`
	Files             []*FileTreeFile `json:"files"`
	EffectiveSortMode int             `json:"effectiveSortMode"`
}
type FileTreeGetDocData struct {
	ID                    string            `json:"id"`
	Mode                  int               `json:"mode"`
	ParentID              string            `json:"parentID"`
	Parent2ID             string            `json:"parent2ID"`
	RootID                string            `json:"rootID"`
	Type                  string            `json:"type"`
	Content               string            `json:"content"`
	BlockCount            int               `json:"blockCount"`
	EOF                   bool              `json:"eof"`
	Scroll                bool              `json:"scroll"`
	Box                   string            `json:"box"`
	Path                  string            `json:"path"`
	IsSyncing             bool              `json:"isSyncing"`
	IsBacklinkExpand      bool              `json:"isBacklinkExpand"`
	Keywords              []string          `json:"keywords"`
	HeadingNumbers        map[string]string `json:"headingNumbers"`
	PublishAccessRequired bool              `json:"publishAccessRequired"`
	ReqID                 JSONValue         `json:"reqId"`
	DocInfo               *DocInfo          `json:"docInfo,omitempty"`
}
type FileTreePublishItem struct {
	ID       string `json:"id"`
	Visible  bool   `json:"visible"`
	Password string `json:"password"`
	Disable  bool   `json:"disable"`
}
type FileTreePublishData struct {
	PublishAccess []*FileTreePublishItem `json:"publishAccess"`
}
