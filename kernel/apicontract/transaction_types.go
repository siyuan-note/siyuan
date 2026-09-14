package apicontract

import "encoding/json"

type TransactionBlockSwap struct {
	IncludeChildren bool `json:"includeChildren"`
	OriginalToEmbed bool `json:"originalToEmbed"`
}

type TransactionSourceFields struct {
	ID         *string `json:"id,omitempty" api:"optional"`
	ItemID     *string `json:"itemID,omitempty" api:"optional"`
	Content    *string `json:"content,omitempty" api:"optional"`
	IsDetached *bool   `json:"isDetached,omitempty" api:"optional"`
}

type TransactionSource struct{ TransactionOperationData }

type TransactionContext map[string]JSONValue

type TransactionCellUpdate struct {
	KeyID string                   `json:"keyID" api:"optional,nullable"`
	RowID string                   `json:"rowID" api:"optional,nullable"`
	Data  TransactionOperationData `json:"data" api:"optional,nullable"`
}

// TransactionOperationData 保留操作数据的字段省略、显式空值及模型层验证时序。
type TransactionOperationData struct{ raw json.RawMessage }

func (value *TransactionOperationData) UnmarshalJSON(data []byte) error {
	value.raw = append(value.raw[:0], data...)
	return nil
}

func (value TransactionOperationData) MarshalJSON() ([]byte, error) {
	if len(value.raw) == 0 {
		return []byte("null"), nil
	}
	return value.raw, nil
}

type TransactionOperationFields struct {
	Action            string                   `json:"action" api:"optional,nullable"`
	ID                string                   `json:"id" api:"optional,nullable"`
	RootID            string                   `json:"rootID" api:"optional,nullable"`
	ParentID          string                   `json:"parentID" api:"optional,nullable"`
	PreviousID        string                   `json:"previousID" api:"optional,nullable"`
	NextID            string                   `json:"nextID" api:"optional,nullable"`
	BlockIDs          []string                 `json:"blockIDs" api:"optional,nullable"`
	BlockID           string                   `json:"blockID" api:"optional,nullable"`
	DeckID            string                   `json:"deckID" api:"optional,nullable"`
	AvID              string                   `json:"avID" api:"optional,nullable"`
	SrcIDs            []string                 `json:"srcIDs" api:"optional,nullable"`
	Srcs              []*TransactionSource     `json:"srcs" api:"optional,nullable"`
	IsDetached        bool                     `json:"isDetached" api:"optional,nullable"`
	Name              string                   `json:"name" api:"optional,nullable"`
	Typ               string                   `json:"type" api:"optional,nullable,enum=|block|text|number|date|select|mSelect|url|email|phone|mAsset|template|created|updated|checkbox|relation|rollup|lineNumber"`
	Format            string                   `json:"format" api:"optional,nullable"`
	KeyID             string                   `json:"keyID" api:"optional,nullable"`
	RowID             string                   `json:"rowID" api:"optional,nullable"`
	IsTwoWay          bool                     `json:"isTwoWay" api:"optional,nullable"`
	BackRelationKeyID string                   `json:"backRelationKeyID" api:"optional,nullable"`
	RemoveDest        bool                     `json:"removeDest" api:"optional,nullable"`
	Layout            string                   `json:"layout" api:"optional,nullable"`
	GroupID           string                   `json:"groupID" api:"optional,nullable"`
	TargetGroupID     string                   `json:"targetGroupID" api:"optional,nullable"`
	ViewID            string                   `json:"viewID" api:"optional,nullable"`
	ViewIDs           []string                 `json:"viewIDs,omitempty" api:"optional,nullable"`
	IgnoreDefaultFill bool                     `json:"ignoreDefaultFill" api:"optional,nullable"`
	Context           TransactionContext       `json:"context" api:"optional,nullable"`
	CellUpdates       []*TransactionCellUpdate `json:"cellUpdates,omitempty" api:"optional,nullable"`
}

type TransactionOperation struct {
	TransactionOperationFields
	Data    TransactionOperationData `json:"data" api:"optional,nullable"`
	RetData TransactionOperationData `json:"retData" api:"optional,nullable"`
}

type Transaction struct {
	Timestamp             int64                   `json:"timestamp" api:"optional,nullable"`
	DoOperations          []*TransactionOperation `json:"doOperations" api:"optional,nullable"`
	UndoOperations        []*TransactionOperation `json:"undoOperations" api:"optional,nullable"`
	TemplateDocTreePlanID string                  `json:"templateDocTreePlanID,omitempty" api:"optional,nullable"`
}

type PerformTransactionsRequest struct {
	Transactions    []*Transaction `json:"transactions"`
	ReqID           float64        `json:"reqId"`
	App             string         `json:"app" api:"optional"`
	Session         string         `json:"session" api:"optional"`
	DecodeError     error          `json:"-"`
	TransactionJSON []byte         `json:"-"`
}

type TransactionHistoryRequest struct {
	RootID  string `json:"rootID"`
	App     string `json:"app" api:"optional"`
	Session string `json:"session" api:"optional"`
}

type TransactionUndoStateRequest struct {
	RootID string `json:"rootID"`
}
type TransactionClearHistoryRequest struct {
	RootID string `json:"rootID" api:"optional"`
}
type TransactionUndoState struct {
	CanUndo            bool     `json:"canUndo"`
	CanRedo            bool     `json:"canRedo"`
	PeekMutatedRootIDs []string `json:"peekMutatedRootIDs"`
}
type TransactionHistoryEmpty struct {
	CanUndo bool `json:"canUndo" api:"const=false"`
	CanRedo bool `json:"canRedo" api:"const=false"`
}
type TransactionHistoryFailure struct {
	Failed bool   `json:"failed" api:"const=true"`
	Msg    string `json:"msg"`
}
type TransactionHistoryApplied struct {
	DoOperations   []*TransactionOperation `json:"doOperations"`
	UndoOperations []*TransactionOperation `json:"undoOperations"`
	MutatedRootIDs []string                `json:"mutatedRootIDs"`
	CanUndo        bool                    `json:"canUndo"`
	CanRedo        bool                    `json:"canRedo"`
	IsUndo         bool                    `json:"isUndo"`
}
type TransactionHistoryResult struct {
	empty   *TransactionHistoryEmpty
	failure *TransactionHistoryFailure
	applied *TransactionHistoryApplied
}

func EmptyTransactionHistory() TransactionHistoryResult {
	return TransactionHistoryResult{empty: &TransactionHistoryEmpty{}}
}
func FailedTransactionHistory(msg string) TransactionHistoryResult {
	return TransactionHistoryResult{failure: &TransactionHistoryFailure{Failed: true, Msg: msg}}
}
func AppliedTransactionHistory(data TransactionHistoryApplied) TransactionHistoryResult {
	return TransactionHistoryResult{applied: &data}
}
func (value TransactionHistoryResult) MarshalJSON() ([]byte, error) {
	if value.empty != nil {
		return json.Marshal(value.empty)
	}
	if value.failure != nil {
		return json.Marshal(value.failure)
	}
	return json.Marshal(value.applied)
}

type TransactionNewItemTemplates struct {
	Templates         []*AVNewItemTemplate `json:"templates" api:"optional,nullable"`
	DefaultTemplateID string               `json:"defaultTemplateID,omitempty" api:"optional,nullable"`
}
type TransactionRollup struct {
	Calc *AVRollupCalc `json:"calc" api:"optional"`
}

type TransactionAttributeChange struct {
	Old        map[string]string `json:"old" api:"optional,nullable"`
	New        map[string]string `json:"new" api:"optional,nullable"`
	DataAVType *string           `json:"data-av-type,omitempty" api:"optional"`
}
type TransactionOptionChange struct {
	OldName  string  `json:"oldName"`
	OldColor *string `json:"oldColor,omitempty" api:"optional"`
	NewName  string  `json:"newName"`
	NewDesc  string  `json:"newDesc"`
	NewColor string  `json:"newColor"`
}
type TransactionOptionDescription struct {
	Name string `json:"name"`
	Desc string `json:"desc"`
}
type TransactionCustomColors struct {
	Colors []*AVAttributeViewCustomColor `json:"colors" api:"optional,nullable"`
	Order  []string                      `json:"order" api:"optional,nullable"`
}
type TransactionCardCoverPosition struct {
	Source   string               `json:"source" api:"optional,nullable"`
	Position *AVCardCoverPosition `json:"position" api:"optional"`
}
type TransactionInsertedItems struct {
	InsertedItemIDs []string `json:"insertedItemIDs"`
	ExistingItemIDs []string `json:"existingItemIDs"`
}
type TransactionReplacedItem struct {
	TargetItemID string `json:"targetItemID"`
	Duplicate    bool   `json:"duplicate"`
}
