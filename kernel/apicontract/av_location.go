package apicontract

import (
	"bytes"
	"encoding/json"
)

// UnmarshalJSON 拒绝额外坐标字段，包括不能按 WGS84 解释的其他坐标系声明。
func (value *AVValueLocation) UnmarshalJSON(data []byte) error {
	type plainLocation AVValueLocation
	next := plainLocation(*value)
	if next.Latitude != nil {
		latitude := *next.Latitude
		next.Latitude = &latitude
	}
	if next.Longitude != nil {
		longitude := *next.Longitude
		next.Longitude = &longitude
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&next); err != nil {
		return err
	}
	*value = AVValueLocation(next)
	return nil
}
