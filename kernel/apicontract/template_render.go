// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"encoding/json"
	"fmt"
	"io"
)

type RenderTemplateRequest struct {
	// HTTPConfirmToken 仅供同窗口、同模板和目标在预览成功后30秒内插入一次；只复用确认，重新获取数据。
	HTTPConfirmToken                            string  `json:"httpConfirmToken" api:"optional"`
	Path                                        string  `json:"path"`
	ID                                          string  `json:"id"`
	Mode                                        *string `json:"mode" api:"optional"`
	Preview                                     bool    `json:"preview" api:"optional,nullable"`
	Content                                     *string `json:"content" api:"optional,nonnullable"`
	invalidMode, invalidPreview, invalidContent bool
}

// RenderMode 在文档和路径校验后解释模式，显式模式优先于 preview。
func (r RenderTemplateRequest) RenderMode() (string, error) {
	if r.invalidMode {
		return "", fmt.Errorf("Unsupported template render mode")
	}
	if r.Mode != nil {
		if *r.Mode != "preview" && *r.Mode != "editorInsert" {
			return "", fmt.Errorf("Unsupported template render mode")
		}
		return *r.Mode, nil
	}
	if r.invalidPreview {
		return "", fmt.Errorf("Field [preview] should be of type [Boolean]")
	}
	if r.Preview {
		return "preview", nil
	}
	return "content", nil
}

func (r RenderTemplateRequest) PreviewSource(mode string) (*string, error) {
	if r.invalidContent || (r.Content != nil && mode != "preview") {
		return nil, fmt.Errorf("Source content is only supported for template preview")
	}
	return r.Content, nil
}

type TemplatePlanNode struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	ParentID string `json:"parentID"`
	HPath    string `json:"hPath"`
	Depth    int    `json:"depth"`
}

type TemplatePlan struct {
	ID    string              `json:"id"`
	Count int                 `json:"count"`
	Nodes []*TemplatePlanNode `json:"nodes"`
}

type RenderTemplateData struct {
	// HTTPConfirmToken 是服务端签发的一次性确认交接标识；失效或上下文变化时按常规重新确认。
	HTTPConfirmToken string        `json:"httpConfirmToken,omitempty"`
	Path             string        `json:"path"`
	Content          string        `json:"content"`
	DocTreePlan      *TemplatePlan `json:"docTreePlan,omitempty"`
}

func init() {
	RenderTemplate.decodeRequest = func(reader io.Reader) (request RenderTemplateRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/template/render")
		if err != nil {
			return request, err
		}
		if request.Path, err = legacyField[string](fields, "path", "String", true); err != nil {
			return request, err
		}
		if request.ID, err = legacyField[string](fields, "id", "String", true); err != nil {
			return request, err
		}
		if request.HTTPConfirmToken, err = legacyField[string](fields, "httpConfirmToken", "String", false); err != nil {
			return request, err
		}
		if raw, exists := fields["mode"]; exists {
			request.invalidMode = json.Unmarshal(raw, &request.Mode) != nil
		}
		if raw, exists := fields["preview"]; exists {
			request.invalidPreview = json.Unmarshal(raw, &request.Preview) != nil
		}
		if raw, exists := fields["content"]; exists {
			request.invalidContent = json.Unmarshal(raw, &request.Content) != nil || request.Content == nil
		}
		return
	}
}
