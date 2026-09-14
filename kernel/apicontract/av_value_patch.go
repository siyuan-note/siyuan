package apicontract

import "encoding/json"

// AVValuePatch 保留字段省略和显式 null，使单元格更新能够合并现有值。
type AVValuePatch struct{ raw json.RawMessage }

func (value *AVValuePatch) UnmarshalJSON(data []byte) error {
	var fields AVValue
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	value.raw = append(value.raw[:0], data...)
	return nil
}
func (value AVValuePatch) MarshalJSON() ([]byte, error) {
	if len(value.raw) == 0 {
		return []byte("null"), nil
	}
	return value.raw, nil
}
