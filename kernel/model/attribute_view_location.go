package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func (tx *Transaction) doSetAttrViewColLocationDefaultCoordinateSystem(operation *Operation) *TxErr {
	if err := setAttrViewColLocationDefaultCoordinateSystem(operation); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return nil
}

func setAttrViewColLocationDefaultCoordinateSystem(operation *Operation) error {
	coordinateSystem, ok := operation.Data.(string)
	if !ok || "" == coordinateSystem || !av.IsLocationCoordinateSystem(coordinateSystem) {
		return errors.New("invalid location default coordinate system")
	}
	view, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return err
	}
	view, err = cloneAttributeViewForFieldMutation(view)
	if nil != err {
		return err
	}
	key, err := view.GetKey(operation.ID)
	if nil != err {
		return err
	}
	if av.KeyTypeLocation != key.Type {
		return errors.New("default coordinate system requires a location field")
	}
	key.Location = &av.Location{DefaultCoordinateSystem: coordinateSystem}
	return av.SaveAttributeView(view)
}

// 更新坐标或坐标系后清除过期来源；名称更新及显式提供的来源保持不变。
func normalizeAttributeViewLocationProvenance(previous, updated *av.ValueLocation, patch []byte) {
	if nil == updated {
		return
	}
	if present, clear := attributeViewLocationOriginalInputPresent(patch); present {
		if clear {
			updated.OriginalInput = ""
		}
		return
	}
	if nil == previous {
		previous = &av.ValueLocation{}
	}
	equalCoordinate := func(left, right *float64) bool {
		return nil == left && nil == right || nil != left && nil != right && *left == *right
	}
	coordinateSystem := func(value string) string {
		if "" == value {
			return "unknown"
		}
		return value
	}
	if !equalCoordinate(previous.Latitude, updated.Latitude) || !equalCoordinate(previous.Longitude, updated.Longitude) ||
		coordinateSystem(previous.CoordinateSystem) != coordinateSystem(updated.CoordinateSystem) {
		updated.OriginalInput = ""
	}
}

func attributeViewLocationOriginalInputPresent(patch []byte) (present, clear bool) {
	value := json.NewDecoder(bytes.NewReader(patch))
	if token, err := value.Token(); nil != err || token != json.Delim('{') {
		return
	}
	for value.More() {
		name, err := value.Token()
		var raw json.RawMessage
		if nil != err || nil != value.Decode(&raw) {
			return
		}
		if field, ok := name.(string); !ok || !strings.EqualFold(field, "location") {
			continue
		}
		location := json.NewDecoder(bytes.NewReader(raw))
		if token, err := location.Token(); nil != err || token != json.Delim('{') {
			continue
		}
		for location.More() {
			name, err := location.Token()
			var original json.RawMessage
			if nil != err || nil != location.Decode(&original) {
				return
			}
			if field, ok := name.(string); ok && strings.EqualFold(field, "originalInput") {
				present, clear = true, bytes.Equal(bytes.TrimSpace(original), []byte("null"))
			}
		}
	}
	return
}
