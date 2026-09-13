package apicontract

import "encoding/json"

// JSONValue 仅用于协议明确允许任意 JSON 的透传字段，零值表示 null。
type JSONValue struct{ raw json.RawMessage }

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
