package apicontract

type FindAssetReferencesRequest struct {
	Path string `json:"path"`
}

type RelinkAssetRequest struct {
	OldPath string `json:"oldPath"`
	NewPath string `json:"newPath"`
	DryRun  bool   `json:"dryRun" api:"optional"`
}

type AssetReference struct {
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
	References       []AssetReference `json:"references"`
	SkippedNotebooks []string         `json:"skippedNotebooks"`
	DryRun           bool             `json:"dryRun"`
	HistoryPath      string           `json:"historyPath"`
	Updated          int              `json:"updated"`
}
