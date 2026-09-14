package apicontract

type FindAssetReferencesRequest struct {
	Path  *string  `json:"path" api:"optional,nonnullable"`
	Paths []string `json:"paths" api:"optional"`
}

type RelinkAssetRequest struct {
	OldPath  *string              `json:"oldPath" api:"optional,nonnullable"`
	NewPath  *string              `json:"newPath" api:"optional,nonnullable"`
	Mappings []AssetRelinkMapping `json:"mappings" api:"optional"`
	DryRun   bool                 `json:"dryRun" api:"optional"`
}

type AssetRelinkMapping struct {
	OldPath string `json:"oldPath"`
	NewPath string `json:"newPath"`
}

type AssetRelinkItemResult struct {
	OldPath    string           `json:"oldPath"`
	NewPath    string           `json:"newPath"`
	OK         bool             `json:"ok"`
	Reason     string           `json:"reason"`
	References []AssetReference `json:"references"`
	Updated    int              `json:"updated"`
}

type AssetReference struct {
	OldPath     string `json:"oldPath,omitempty"`
	Type        string `json:"type"`
	Notebook    string `json:"notebook"`
	RootID      string `json:"rootID"`
	Path        string `json:"path"`
	BlockID     string `json:"blockID"`
	AvID        string `json:"avID"`
	ValueID     string `json:"valueID"`
	Reference   string `json:"reference"`
	Replacement string `json:"replacement"`
	Relinkable  bool   `json:"relinkable"`
	Reason      string `json:"reason"`
}

type AssetReferencesData struct {
	UnavailableAttributeViews []UnavailableAssetAttributeView `json:"unavailableAttributeViews,omitempty"`
	Items                     []AssetRelinkItemResult         `json:"items,omitempty"`
	References                []AssetReference                `json:"references"`
	SkippedNotebooks          []string                        `json:"skippedNotebooks"`
	DryRun                    bool                            `json:"dryRun"`
	HistoryPath               string                          `json:"historyPath"`
	Updated                   int                             `json:"updated"`
}

type UnavailableAssetAttributeView struct {
	AvID         string `json:"avID"`
	Notebook     string `json:"notebook"`
	NotebookName string `json:"notebookName"`
	RootID       string `json:"rootID"`
	BlockID      string `json:"blockID"`
	Path         string `json:"path"`
	HPath        string `json:"hPath"`
	Reason       string `json:"reason"`
}
