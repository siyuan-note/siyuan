package apicontract

import (
	"encoding/json"
	"fmt"
)

// JSONValue 仅用于协议明确允许任意 JSON 的透传字段，零值表示 null。
type JSONValue struct{ raw json.RawMessage }

// EncodedJSONValue 保留业务层已编码的任意 JSON 值，包括整型结果的完整数字精度。
func EncodedJSONValue(data []byte) (JSONValue, error) {
	if !json.Valid(data) {
		return JSONValue{}, fmt.Errorf("invalid encoded JSON value")
	}
	return JSONValue{raw: append(json.RawMessage(nil), data...)}, nil
}

func (v JSONValue) StringValue() (value string, ok bool) {
	if len(v.raw) == 0 || v.raw[0] != '"' {
		return "", false
	}
	err := json.Unmarshal(v.raw, &value)
	return value, err == nil
}

func (v JSONValue) MarshalJSON() ([]byte, error) {
	if len(v.raw) == 0 {
		return []byte("null"), nil
	}
	return v.raw, nil
}

func (v *JSONValue) UnmarshalJSON(data []byte) error {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	normalized, err := json.Marshal(value)
	if err == nil {
		v.raw = normalized
	}
	return err
}
