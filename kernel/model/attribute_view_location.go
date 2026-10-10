package model

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/av"
)

// 更新坐标后清除过期来源；名称更新及显式提供的来源保持不变。
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
	if !equalCoordinate(previous.Latitude, updated.Latitude) || !equalCoordinate(previous.Longitude, updated.Longitude) {
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
