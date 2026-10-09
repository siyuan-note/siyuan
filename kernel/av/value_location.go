package av

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ValueLocation 保留位置名称、原始坐标系和输入来源，不推断或转换坐标。
// 空指针表示坐标缺省；零是有效坐标，经纬度必须同时存在或同时为空。
type ValueLocation struct {
	Name             string   `json:"name,omitempty"`
	Latitude         *float64 `json:"latitude,omitempty"`
	Longitude        *float64 `json:"longitude,omitempty"`
	CoordinateSystem string   `json:"coordinateSystem,omitempty"`
	OriginalInput    string   `json:"originalInput,omitempty"`
}

// Location 仅为尚未存储的新输入提供坐标系默认值，不修改已有坐标的含义。
type Location struct {
	DefaultCoordinateSystem string `json:"defaultCoordinateSystem,omitempty"`
}

func IsLocationCoordinateSystem(value string) bool {
	switch value {
	case "", "unknown", "wgs84", "gcj02", "bd09":
		return true
	}
	return false
}

func (location *ValueLocation) IsEmpty() bool {
	return nil == location || "" == strings.TrimSpace(location.Name) &&
		(nil == location.Latitude || nil == location.Longitude)
}

// Normalize 仅校验数值和坐标系，缺省坐标系保持为未知，原始输入不参与值语义。
func (location *ValueLocation) Normalize() error {
	if nil == location {
		return nil
	}
	if (nil == location.Latitude) != (nil == location.Longitude) {
		return fmt.Errorf("location latitude and longitude must both be present or null")
	}
	if !IsLocationCoordinateSystem(location.CoordinateSystem) {
		return fmt.Errorf("invalid location coordinate system [%s]", location.CoordinateSystem)
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
	if "" == location.CoordinateSystem {
		location.CoordinateSystem = "unknown"
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
	crs := map[string]string{"wgs84": "WGS84", "gcj02": "GCJ-02", "bd09": "BD-09"}[location.CoordinateSystem]
	if "" == crs {
		crs = "unknown"
	}
	formatCoordinate := func(value float64) string {
		if 0 == value {
			return "0"
		}
		return strconv.FormatFloat(value, 'f', -1, 64)
	}
	coordinates := formatCoordinate(*location.Latitude) + ", " + formatCoordinate(*location.Longitude) + " [" + crs + "]"
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
		if nil != values && nil != values.Key && (KeyTypeLocation == values.Key.Type || nil != values.Key.Location) {
			return true
		}
	}
	var hasLocationKey func(*View) bool
	hasLocationKey = func(current *View) bool {
		if nil == current {
			return false
		}
		if nil != current.GroupKey && (KeyTypeLocation == current.GroupKey.Type || nil != current.GroupKey.Location) {
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

// NormalizeLocations 先检查全部位置，再应用缺省坐标系，避免失败时部分修改数据库。
func (view *AttributeView) NormalizeLocations() (err error) {
	if nil == view {
		return nil
	}
	validateKey := func(key *Key) error {
		if nil != key && nil != key.Location && !IsLocationCoordinateSystem(key.Location.DefaultCoordinateSystem) {
			return fmt.Errorf("invalid location default coordinate system [%s]", key.Location.DefaultCoordinateSystem)
		}
		return nil
	}
	for _, values := range view.KeyValues {
		if nil != values {
			if err = validateKey(values.Key); nil != err {
				return
			}
		}
	}
	var validateView func(*View) error
	validateView = func(current *View) error {
		if nil == current {
			return nil
		}
		if err := validateKey(current.GroupKey); nil != err {
			return err
		}
		for _, group := range current.Groups {
			if err := validateView(group); nil != err {
				return err
			}
		}
		return nil
	}
	for _, current := range view.Views {
		if err = validateView(current); nil != err {
			return
		}
	}
	var locations []*ValueLocation
	view.visitPersistedValues(func(value *Value) {
		if nil != err || nil == value.Location {
			return
		}
		candidate := *value.Location
		if err = candidate.Normalize(); nil == err {
			locations = append(locations, value.Location)
		}
	})
	if nil != err {
		return err
	}
	for _, location := range locations {
		_ = location.Normalize()
	}
	return nil
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
