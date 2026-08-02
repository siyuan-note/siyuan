package model

import (
	"errors"
	"fmt"
	"path"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// AttributeViewItemUpdateData is the single-operation payload used by the
// calendar bound-page update endpoint. It deliberately keeps the document
// rename and AV field writes behind one kernel request.
type AttributeViewItemUpdateData struct {
	AvID         string
	ItemID       string
	BoundBlockID string
	PrimaryKey   string
	FieldValues  map[string]*av.Value
}

func (tx *Transaction) doUpdateAttributeViewItem(operation *Operation) (ret *TxErr) {
	data, err := decodeAttributeViewItemUpdateData(operation.Data)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, msg: "invalid attribute view item update"}
	}
	if err = UpdateAttributeViewItem(tx, data); err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: data.AvID, msg: err.Error()}
	}
	return nil
}

func decodeAttributeViewItemUpdateData(value any) (*AttributeViewItemUpdateData, error) {
	if data, ok := value.(*AttributeViewItemUpdateData); ok && data != nil {
		return data, nil
	}
	raw, err := gulu.JSON.MarshalJSON(value)
	if err != nil {
		return nil, err
	}
	data := &AttributeViewItemUpdateData{}
	if err = gulu.JSON.UnmarshalJSON(raw, data); err != nil {
		return nil, err
	}
	if data.AvID == "" || data.ItemID == "" || data.BoundBlockID == "" {
		return nil, errors.New("invalid attribute view item update")
	}
	return data, nil
}

func emptyAttributeViewValue(keyType av.KeyType) *av.Value {
	value := &av.Value{Type: keyType}
	switch keyType {
	case av.KeyTypeText:
		value.Text = &av.ValueText{}
	case av.KeyTypeNumber:
		value.Number = &av.ValueNumber{}
	case av.KeyTypeDate:
		value.Date = &av.ValueDate{}
	case av.KeyTypeSelect, av.KeyTypeMSelect:
		value.MSelect = []*av.ValueSelect{}
	case av.KeyTypeURL:
		value.URL = &av.ValueURL{}
	case av.KeyTypeEmail:
		value.Email = &av.ValueEmail{}
	case av.KeyTypePhone:
		value.Phone = &av.ValuePhone{}
	case av.KeyTypeMAsset:
		value.MAsset = []*av.ValueAsset{}
	case av.KeyTypeCheckbox:
		value.Checkbox = &av.ValueCheckbox{}
	case av.KeyTypeRelation:
		value.Relation = &av.ValueRelation{BlockIDs: []string{}, Contents: []*av.Value{}}
	}
	return value
}

// UpdateAttributeViewItem updates a bound calendar page and its AV fields as
// one application-level operation. The page rename is performed first so a
// validation or field-write error can never expose the new fields under the
// old page title. If a later field write fails, the original page title is
// restored before the error is returned.
//
// This is intentionally not exposed as two frontend requests. The endpoint
// owns the ordering and compensation boundary, so callers cannot observe the
// old split rename-then-transactions protocol.
func UpdateAttributeViewItem(tx *Transaction, data *AttributeViewItemUpdateData) error {
	if data == nil || data.AvID == "" || data.ItemID == "" || data.BoundBlockID == "" {
		return errors.New("attribute view item update requires avID, itemID and boundBlockID")
	}

	attrView, err := av.ParseAttributeView(data.AvID)
	if err != nil {
		return err
	}
	blockValues := attrView.GetBlockKeyValues()
	if blockValues == nil {
		return errors.New("attribute view has no block field")
	}

	var boundValue *av.Value
	for _, value := range blockValues.Values {
		if value != nil && value.BlockID == data.ItemID {
			boundValue = value
			break
		}
	}
	if boundValue == nil || boundValue.Block == nil || boundValue.Block.ID != data.BoundBlockID || boundValue.IsDetached {
		return fmt.Errorf("attribute view item [%s] is not bound to document [%s]", data.ItemID, data.BoundBlockID)
	}

	resolved, err := resolveCallerItemFieldValues(attrView, data.FieldValues)
	if err != nil {
		return err
	}

	originalTree, err := LoadTreeByBlockID(data.BoundBlockID)
	if err != nil {
		return err
	}
	tree, err := LoadTreeByBlockID(data.BoundBlockID)
	if err != nil {
		return err
	}
	tx.originalTrees[data.BoundBlockID] = originalTree
	oldTitle := tree.Root.IALAttr("title")
	nextTitle := normalizeDocTitle(data.PrimaryKey)
	if nextTitle == "" {
		nextTitle = oldTitle
	}

	if nextTitle != oldTitle {
		tree.HPath = path.Join(path.Dir(tree.HPath), nextTitle)
		tree.Root.SetIALAttr("title", nextTitle)
		tree.Root.RemoveIALAttr(NodeAttrTitleEmpty)
		tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
		tx.writeTree(tree)
		tx.renamedTrees[data.BoundBlockID] = tree
	}

	tx.deferAttrViewSave = true
	defer func() { tx.deferAttrViewSave = false }()
	// Keep the block primary key and every mapped field on the same deferred AV
	// snapshot. Without seeding this map, UpdateAttributeViewCell parses a second
	// copy and the new document title never reaches the persisted AV block value.
	boundValue.Block.Content = nextTitle
	boundValue.UpdatedAt = util.CurrentTimeMillis()
	tx.deferredAttrViews[data.AvID] = attrView
	oldFieldValues := map[string]*av.Value{}
	for keyID := range resolved {
		for _, keyValues := range attrView.KeyValues {
			if keyValues.Key.ID != keyID {
				continue
			}
			found := false
			for _, value := range keyValues.Values {
				if value.BlockID == data.ItemID {
					copiedData, copyErr := gulu.JSON.MarshalJSON(value)
					if copyErr != nil {
						return copyErr
					}
					copied := &av.Value{}
					if copyErr = gulu.JSON.UnmarshalJSON(copiedData, copied); copyErr != nil {
						return copyErr
					}
					oldFieldValues[keyID] = copied
					found = true
					break
				}
			}
			if !found {
				oldFieldValues[keyID] = emptyAttributeViewValue(keyValues.Key.Type)
			}
			break
		}
	}
	for keyID, value := range resolved {
		if _, err = UpdateAttributeViewCell(tx, data.AvID, keyID, data.ItemID, value); err != nil {
			return err
		}
	}
	if !tx.isReplay {
		tx.UndoOperations = append(tx.UndoOperations, &Operation{
			Action: "updateAttributeViewItem", AvID: data.AvID, ID: data.ItemID,
			Data: &AttributeViewItemUpdateData{AvID: data.AvID, ItemID: data.ItemID, BoundBlockID: data.BoundBlockID, PrimaryKey: oldTitle, FieldValues: oldFieldValues},
		})
	}

	// Make the operation visible to the transaction's AV refresh path.
	tx.relatedAvIDs = append(tx.relatedAvIDs, data.AvID)
	return nil
}
