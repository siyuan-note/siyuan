// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"encoding/json"
	"fmt"
	"io"
)

type SaveTemplateRequest struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Overwrite    bool   `json:"overwrite"`
	DatabaseMode string `json:"databaseMode" api:"optional"`
	Directory    string `json:"directory" api:"optional"`
}

func init() {
	DocSaveAsTemplate.decodeRequest = func(reader io.Reader) (request SaveTemplateRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/template/docSaveAsTemplate")
		if err != nil {
			return request, err
		}
		if request.ID, err = legacyField[string](fields, "id", "String", true); err != nil {
			return request, err
		}
		if request.Name, err = legacyField[string](fields, "name", "String", true); err != nil {
			return request, err
		}
		if request.Overwrite, err = legacyField[bool](fields, "overwrite", "Boolean", true); err != nil {
			return request, err
		}
		request.DatabaseMode = "copy"
		if raw, exists := fields["databaseMode"]; exists {
			if string(raw) == "null" || json.Unmarshal(raw, &request.DatabaseMode) != nil {
				request.DatabaseMode = "invalid"
			}
		}
		if raw, exists := fields["directory"]; exists {
			if string(raw) == "null" || json.Unmarshal(raw, &request.Directory) != nil {
				return request, fmt.Errorf("Invalid template directory")
			}
		}
		return
	}
}

type RenderSprigRequest struct {
	Template string `json:"template"`
}

type TemplateDocumentRequest struct {
	ID string `json:"id"`
}

type TemplateDocumentInfo struct {
	Name        string `json:"name"`
	Directory   string `json:"directory"`
	HasDatabase bool   `json:"hasDatabase"`
}

// TemplateHTTPReplyRequest 只响应指定窗口当前执行的确认；持久许可仅授予内核识别的当前模板版本。
type TemplateHTTPReplyRequest struct {
	// Scope 为 once（当前执行同来源）或 template（内核可信来源当前版本的持久许可）；客户端不能自行指定可信来源。
	Scope       string `json:"scope" api:"optional"`
	ExecutionID string `json:"executionID"`
	ConfirmID   string `json:"confirmID"`
	Approved    bool   `json:"approved"`
	App         string `json:"app"`
	Session     string `json:"session"`
}

// TemplateHTTPCancelRequest 用于窗口、预览及导航生命周期清理，不提供取消按钮。
type TemplateHTTPCancelRequest struct {
	// HTTPConfirmToken 用于关闭或切换预览时撤销尚未消费的确认交接。
	HTTPConfirmToken string `json:"httpConfirmToken" api:"optional"`
	ExecutionID      string `json:"executionID"`
	App              string `json:"app"`
	Session          string `json:"session"`
}

// TemplateHTTPPermissionRequest 只查询或撤销许可；创建持久许可必须响应当前窗口的有效确认。
// 文件 path 是模板目录相对路径；数据库由 avID、keyID 与 template/renderTemplate 槽位标识。
type TemplateHTTPPermissionRequest struct {
	Action string `json:"action"`
	Kind   string `json:"kind" api:"optional"`
	Path   string `json:"path" api:"optional"`
	AVID   string `json:"avID" api:"optional"`
	KeyID  string `json:"keyID" api:"optional"`
	Slot   string `json:"slot" api:"optional"`
}
type TemplateHTTPPermissionData struct {
	Allowed bool `json:"allowed"`
}
