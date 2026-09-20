package apicontract

import (
	"errors"
	json "github.com/goccy/go-json"
	"reflect"
)

// AVViewInstance 表示表格、列表、画廊或看板及其递归分组实例，列表复用表格的行列结构。
type AVViewInstance struct {
	table   *AVTable
	gallery *AVGallery
	kanban  *AVKanban
}

func NewAVTableInstance(value *AVTable) AVViewInstance     { return AVViewInstance{table: value} }
func NewAVGalleryInstance(value *AVGallery) AVViewInstance { return AVViewInstance{gallery: value} }
func NewAVKanbanInstance(value *AVKanban) AVViewInstance   { return AVViewInstance{kanban: value} }

func (value AVViewInstance) MarshalJSON() ([]byte, error) {
	if value.table != nil {
		return json.Marshal(value.table)
	}
	if value.gallery != nil {
		return json.Marshal(value.gallery)
	}
	if value.kanban != nil {
		return json.Marshal(value.kanban)
	}
	return nil, errors.New("attribute view instance is not set")
}

func avPayloadSchema(b *schemaBuilder, t reflect.Type, input bool) (*Schema, error) {
	if t == reflect.TypeFor[*AVValuePatch]() {
		schema, err := b.schema(reflect.TypeFor[AVValue](), input)
		return nullable(schema), err
	}
	if t == reflect.TypeFor[AVValuePatch]() {
		return b.schema(reflect.TypeFor[AVValue](), input)
	}
	switch t {
	case reflect.TypeFor[AVTable](), reflect.TypeFor[AVTableColumn](), reflect.TypeFor[AVTableCell](),
		reflect.TypeFor[AVGallery](), reflect.TypeFor[AVGalleryField](), reflect.TypeFor[AVGalleryFieldValue](),
		reflect.TypeFor[AVKanban](), reflect.TypeFor[AVKanbanField](), reflect.TypeFor[AVKanbanFieldValue](),
		reflect.TypeFor[AVLayoutCalendar](), reflect.TypeFor[AVLayoutTable](), reflect.TypeFor[AVViewTableColumn](), reflect.TypeFor[AVLayoutGallery](),
		reflect.TypeFor[AVViewGalleryCardField](), reflect.TypeFor[AVLayoutKanban](), reflect.TypeFor[AVViewKanbanField]():
		return avEmbeddedPayloadSchema(b, t, input)
	}
	var members []reflect.Type
	switch t {
	case reflect.TypeFor[AVViewInstance]():
		members = []reflect.Type{reflect.TypeFor[AVTable](), reflect.TypeFor[AVGallery](), reflect.TypeFor[AVKanban]()}
	case reflect.TypeFor[AVRenderResult]():
		members = []reflect.Type{reflect.TypeFor[AVRenderData](), reflect.TypeFor[AVViewNotFound]()}
	case reflect.TypeFor[AVCreateItemResult]():
		members = []reflect.Type{reflect.TypeFor[AVCreateAttributeViewItemResult](), reflect.TypeFor[AVUnavailableNotebook]()}
	case reflect.TypeFor[AVCreateItemDocsResult]():
		members = []reflect.Type{reflect.TypeFor[AVCreateAttributeViewItemDocsResult](), reflect.TypeFor[AVUnavailableNotebook]()}
	default:
		return nil, nil
	}
	name := t.Name()
	if _, ok := b.definitions[name]; ok {
		return &Schema{Ref: "#/$defs/" + name}, nil
	}
	result := &Schema{}
	b.definitions[name] = result
	for _, member := range members {
		schema, err := b.schema(member, input)
		if err != nil {
			return nil, err
		}
		result.AnyOf = append(result.AnyOf, schema)
	}
	return &Schema{Ref: "#/$defs/" + name}, nil
}

// avEmbeddedPayloadSchema 保留匿名基类指针为 nil 时省略整组字段的 JSON 行为。
func avEmbeddedPayloadSchema(b *schemaBuilder, t reflect.Type, input bool) (*Schema, error) {
	name := t.Name()
	if _, ok := b.definitions[name]; ok {
		return &Schema{Ref: "#/$defs/" + name}, nil
	}
	result := &Schema{}
	b.definitions[name] = result
	var base reflect.Type
	var own []reflect.StructField
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.Anonymous && field.Type.Kind() == reflect.Pointer {
			base = field.Type.Elem()
		} else {
			own = append(own, field)
		}
	}
	if base == nil {
		return nil, errors.New("attribute view embedded base is missing")
	}
	for _, present := range []bool{true, false} {
		fields := append([]reflect.StructField{}, own...)
		if present {
			for i := 0; i < base.NumField(); i++ {
				field := base.Field(i)
				shadowed := false
				for _, child := range own {
					if child.Name == field.Name {
						shadowed = true
						break
					}
				}
				if !shadowed {
					fields = append(fields, field)
				}
			}
		}
		object := &Schema{Type: "object", Properties: map[string]*Schema{}, AdditionalProperties: false}
		if err := b.fields(object, reflect.StructOf(fields), input); err != nil {
			return nil, err
		}
		result.AnyOf = append(result.AnyOf, object)
	}
	return &Schema{Ref: "#/$defs/" + name}, nil
}

type AVRenderResult struct {
	success *AVRenderData
	failure *AVViewNotFound
}

func NewAVRenderResult(value AVRenderData) AVRenderResult { return AVRenderResult{success: &value} }
func NewAVRenderResultError(value AVViewNotFound) AVRenderResult {
	return AVRenderResult{failure: &value}
}
func (value AVRenderResult) MarshalJSON() ([]byte, error) {
	if value.success != nil {
		return json.Marshal(value.success)
	}
	if value.failure != nil {
		return json.Marshal(value.failure)
	}
	return nil, errors.New("attribute view response variant is not set")
}

type AVCreateItemResult struct {
	success *AVCreateAttributeViewItemResult
	failure *AVUnavailableNotebook
}

func NewAVCreateItemResult(value AVCreateAttributeViewItemResult) AVCreateItemResult {
	return AVCreateItemResult{success: &value}
}
func NewAVCreateItemResultError(value AVUnavailableNotebook) AVCreateItemResult {
	return AVCreateItemResult{failure: &value}
}
func (value AVCreateItemResult) MarshalJSON() ([]byte, error) {
	if value.success != nil {
		return json.Marshal(value.success)
	}
	if value.failure != nil {
		return json.Marshal(value.failure)
	}
	return nil, errors.New("attribute view response variant is not set")
}

type AVCreateItemDocsResult struct {
	success *AVCreateAttributeViewItemDocsResult
	failure *AVUnavailableNotebook
}

func NewAVCreateItemDocsResult(value AVCreateAttributeViewItemDocsResult) AVCreateItemDocsResult {
	return AVCreateItemDocsResult{success: &value}
}
func NewAVCreateItemDocsResultError(value AVUnavailableNotebook) AVCreateItemDocsResult {
	return AVCreateItemDocsResult{failure: &value}
}
func (value AVCreateItemDocsResult) MarshalJSON() ([]byte, error) {
	if value.success != nil {
		return json.Marshal(value.success)
	}
	if value.failure != nil {
		return json.Marshal(value.failure)
	}
	return nil, errors.New("attribute view response variant is not set")
}
