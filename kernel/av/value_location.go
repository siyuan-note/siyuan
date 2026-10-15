package av

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ValueLocation 保留位置名称、WGS84 坐标和输入来源，不执行坐标转换。
// 空指针表示坐标缺省；零是有效坐标，经纬度必须同时存在或同时为空。
type ValueLocation struct {
	Name          string   `json:"name,omitempty"`
	Latitude      *float64 `json:"latitude,omitempty"`
	Longitude     *float64 `json:"longitude,omitempty"`
	OriginalInput string   `json:"originalInput,omitempty"`
}

// UnmarshalJSON 拒绝额外字段，避免将带其他坐标系的结构静默解释为 WGS84。
func (location *ValueLocation) UnmarshalJSON(data []byte) error {
	type plainLocation ValueLocation
	next := plainLocation(*location)
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
	*location = ValueLocation(next)
	return nil
}

func (location *ValueLocation) IsEmpty() bool {
	return nil == location || "" == strings.TrimSpace(location.Name) &&
		(nil == location.Latitude || nil == location.Longitude)
}

// Normalize 仅校验 WGS84 经纬度范围，原始输入不参与值语义。
func (location *ValueLocation) Normalize() error {
	if nil == location {
		return nil
	}
	if (nil == location.Latitude) != (nil == location.Longitude) {
		return fmt.Errorf("location latitude and longitude must both be present or null")
	}
	if nil == location.Latitude {
		return nil
	}
	latitude, longitude := *location.Latitude, *location.Longitude
	if math.IsNaN(latitude) || math.IsInf(latitude, 0) || latitude < -90 || latitude > 90 {
		return fmt.Errorf("location latitude must be finite and between -90 and 90")
	}
	if math.IsNaN(longitude) || math.IsInf(longitude, 0) || longitude < -180 || longitude > 180 {
		return fmt.Errorf("location longitude must be finite and between -180 and 180")
	}
	return nil
}

func (location *ValueLocation) String() string {
	if nil == location {
		return ""
	}
	name := strings.TrimSpace(location.Name)
	if nil == location.Latitude || nil == location.Longitude {
		return name
	}
	formatCoordinate := func(value float64) string {
		if 0 == value {
			return "0"
		}
		return strconv.FormatFloat(value, 'f', -1, 64)
	}
	coordinates := formatCoordinate(*location.Latitude) + ", " + formatCoordinate(*location.Longitude) + " [WGS84]"
	if "" == name {
		return coordinates
	}
	return name + "; " + coordinates
}

// HasLocation 检查字段及所有持久化值，包含筛选、模板和嵌套汇总。
func (view *AttributeView) HasLocation() bool {
	if nil == view {
		return false
	}
	for _, values := range view.KeyValues {
		if nil != values && nil != values.Key && KeyTypeLocation == values.Key.Type {
			return true
		}
	}
	var hasLocationKey func(*View) bool
	hasLocationKey = func(current *View) bool {
		if nil == current {
			return false
		}
		if nil != current.GroupKey && KeyTypeLocation == current.GroupKey.Type {
			return true
		}
		for _, group := range current.Groups {
			if hasLocationKey(group) {
				return true
			}
		}
		return false
	}
	for _, current := range view.Views {
		if hasLocationKey(current) {
			return true
		}
	}
	found := false
	view.visitPersistedValues(func(value *Value) {
		if KeyTypeLocation == value.Type || nil != value.Location {
			found = true
		}
	})
	return found
}

// NormalizeLocations 校验全部持久化位置，不改写坐标或来源。
func (view *AttributeView) NormalizeLocations() (err error) {
	if nil == view {
		return nil
	}
	view.visitPersistedValues(func(value *Value) {
		if nil != err || nil == value.Location {
			return
		}
		err = value.Location.Normalize()
	})
	return err
}

func calcFieldLocation(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	if CalcOperatorTemplate == calc.Operator {
		calcFieldByTemplate(collection, field, fieldIndex)
		return
	}
	total, nonEmpty := len(collection.GetItems()), 0
	unique := map[string]bool{}
	for _, item := range collection.GetItems() {
		value := item.GetValues()[fieldIndex]
		if !value.IsEmpty() {
			nonEmpty++
			unique[value.String(false)] = true
		}
	}
	count, percent := 0, false
	switch calc.Operator {
	case CalcOperatorCountAll:
		count = total
	case CalcOperatorCountValues, CalcOperatorCountNotEmpty:
		count = nonEmpty
	case CalcOperatorCountUniqueValues:
		count = len(unique)
	case CalcOperatorCountEmpty:
		count = total - nonEmpty
	case CalcOperatorPercentEmpty:
		count, percent = total-nonEmpty, true
	case CalcOperatorPercentNotEmpty:
		count, percent = nonEmpty, true
	case CalcOperatorPercentUniqueValues:
		count, percent = len(unique), true
	default:
		return
	}
	if percent {
		if total > 0 {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(count)/float64(total), NumberFormatPercent)}
		}
	} else {
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(count), NumberFormatNone)}
	}
}
