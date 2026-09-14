package apicontract

type MoveBlockRequest struct {
	ID         string  `json:"id"`
	ParentID   *string `json:"parentID" api:"optional"`
	PreviousID *string `json:"previousID" api:"optional"`
}

type TransferBlockRefRequest struct {
	FromID   string   `json:"fromID"`
	ToID     string   `json:"toID"`
	ReloadUI *bool    `json:"reloadUI" api:"optional"`
	RefIDs   []string `json:"refIDs" api:"optional,nullable"`
}

type SwapBlockRefRequest struct {
	RefID           string `json:"refID"`
	DefID           string `json:"defID"`
	IncludeChildren bool   `json:"includeChildren"`
	OriginalToEmbed bool   `json:"originalToEmbed" api:"optional"`
}

type BlockReminderRequest struct {
	ID    string `json:"id"`
	Timed string `json:"timed"`
}
