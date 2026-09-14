package apicontract

import (
	"fmt"
	"mime/multipart"
)

type ExtensionCopyRequest struct {
	DOM      string                             `json:"dom"`
	Notebook *string                            `json:"notebook" api:"optional"`
	Href     *string                            `json:"href" api:"optional"`
	ClipType *string                            `json:"clipType" api:"optional"`
	Assets   *string                            `json:"assets" api:"optional"`
	Files    map[string][]*multipart.FileHeader `json:"-"`
}

type ExtensionCopyData struct {
	Markdown string `json:"md"`
	WithMath bool   `json:"withMath"`
}

func decodeExtensionCopyForm(form *multipart.Form) (ExtensionCopyRequest, error) {
	if len(form.Value["dom"]) == 0 {
		return ExtensionCopyRequest{}, fmt.Errorf("dom is required")
	}
	first := func(name string) *string {
		if values := form.Value[name]; len(values) > 0 {
			return &values[0]
		}
		return nil
	}
	return ExtensionCopyRequest{DOM: form.Value["dom"][0], Notebook: first("notebook"), Href: first("href"),
		ClipType: first("clipType"), Assets: first("assets"), Files: form.File}, nil
}

func extensionCopyRequestSchema() *Schema {
	result := object(map[string]*Schema{"dom": {Type: "string"}, "notebook": {Type: "string"},
		"href": {Type: "string"}, "clipType": {Type: "string"}, "assets": {Type: "string"}}, "dom")
	// 资源字段名由剪藏页面的 URL 决定；同名上传文件和文本仍保留表单的重复值。
	field := &Schema{AnyOf: []*Schema{{Type: "string"}, {Type: "string", Format: "binary"}}}
	result.AdditionalProperties = &Schema{AnyOf: []*Schema{field, {Type: "array", Items: field}}}
	return result
}

func init() {
	// 表单解析失败时仍返回既有空成功信封，不开始资源写入。
	ExtensionCopy.decodeFailure = func(err error) Response[*ExtensionCopyData] {
		return Success[*ExtensionCopyData](nil)
	}
}
