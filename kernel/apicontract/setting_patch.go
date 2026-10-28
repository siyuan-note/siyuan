// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
)

// SettingIssue 指出配置字段的诊断，error 阻断提交，warning 表示已采用兼容默认值。
type SettingIssue struct {
	Field    string `json:"field"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// SettingPatchData 仅在存在诊断时返回；无诊断的成功响应继续使用 data: null。
type SettingPatchData struct {
	Issues []SettingIssue `json:"issues"`
}

// PatchSettingRequest 每次仅更新一个配置域。对象递归合并，数组整体替换，省略字段保持当前值，null 还原默认值。
// 失败不发出配置变更通知。
type PatchSettingRequest struct {
	Editor     *SettingEditor       `json:"editor" api:"optional"`
	Export     *SettingExport       `json:"export" api:"optional"`
	FileTree   *SettingFileTree     `json:"fileTree" api:"optional"`
	Search     *SettingSearch       `json:"search" api:"optional"`
	Appearance *SettingAppearance   `json:"appearance" api:"optional"`
	Flashcard  *SettingFlashcard    `json:"flashcard" api:"optional"`
	AI         *SettingAI           `json:"ai" api:"optional"`
	Secrets    *SettingSecrets      `json:"secrets" api:"optional"`
	Variables  *SettingVariables    `json:"variables" api:"optional"`
	Keymap     map[string]JSONValue `json:"keymap" api:"optional"`
	System     *PatchSystemSetting  `json:"system" api:"optional"`
	Sync       *PatchSyncSetting    `json:"sync" api:"optional"`
	Repo       *PatchRepoSetting    `json:"repo" api:"optional"`
	OCR        *SettingOCR          `json:"ocr" api:"optional"`
	Bazaar     *SettingBazaar       `json:"bazaar" api:"optional"`
	Publish    *SettingPublish      `json:"publish" api:"optional"`
	Snippet    *SettingSnpt         `json:"snippet" api:"optional"`
	namespace  string
	patch      json.RawMessage
}

func (r PatchSettingRequest) Namespace() string { return r.namespace }
func (r PatchSettingRequest) PatchJSON() []byte { return append([]byte(nil), r.patch...) }

// PatchSetting 返回成功后由客户端重新读取已鉴权的配置，不在广播中携带密码或 API 密钥。
func init() {
	PatchSetting.decodeRequest = func(reader io.Reader) (r PatchSettingRequest, err error) {
		var raw json.RawMessage
		if err = json.NewDecoder(reader).Decode(&raw); err != nil {
			return
		}
		if err = json.Unmarshal(raw, &r); err != nil {
			return
		}
		var fields map[string]json.RawMessage
		if err = json.Unmarshal(raw, &fields); err != nil {
			return
		}
		if len(fields) != 1 {
			return r, errors.New("exactly one settings namespace is required")
		}
		for namespace, patch := range fields {
			switch namespace {
			case "editor", "export", "fileTree", "search", "appearance", "flashcard", "ai", "secrets", "variables", "keymap", "system", "sync", "repo", "ocr", "bazaar", "publish", "snippet":
			default:
				return r, errors.New("unsupported settings namespace")
			}
			var object map[string]json.RawMessage
			if err = json.Unmarshal(patch, &object); err != nil {
				return
			}
			if len(object) == 0 {
				return r, errors.New("settings patch must be a nonempty object")
			}
			var restricted any
			switch namespace {
			case "system":
				restricted = PatchSystemSetting{}
			case "sync":
				restricted = PatchSyncSetting{}
			case "repo":
				restricted = PatchRepoSetting{}
			}
			if restricted != nil {
				allowed := map[string]bool{}
				typ := reflect.TypeOf(restricted)
				for field := range typ.Fields() {
					allowed[strings.Split(field.Tag.Get("json"), ",")[0]] = true
				}
				for field := range object {
					if !allowed[field] {
						return r, errors.New("unsupported settings field: " + namespace + "." + field)
					}
				}
			}
			r.namespace, r.patch = namespace, patch
		}
		return
	}
}

// PatchSystemSetting 仅允许写用户偏好，宿主信息、访问凭据和全局更新通道保留专用接口。
type PatchSystemSetting struct {
	AutoLaunch2                       *int          `json:"autoLaunch2" api:"optional"`
	LockScreenMode                    *int          `json:"lockScreenMode" api:"optional"`
	NetworkServe                      *bool         `json:"networkServe" api:"optional"`
	NetworkServeTLS                   *bool         `json:"networkServeTLS" api:"optional"`
	NetworkProxy                      *NetworkProxy `json:"networkProxy" api:"optional"`
	SettingsWindow                    *bool         `json:"settingsWindow" api:"optional"`
	EncryptedNotebookFollowSystemLock *bool         `json:"encryptedNotebookFollowSystemLock" api:"optional"`
}

// PatchSyncSetting 不切换提供商，来源切换仍需 setSyncProvider 的完整资源检查。
type PatchSyncSetting struct {
	Enabled             *bool           `json:"enabled" api:"optional"`
	Interval            *int            `json:"interval" api:"optional"`
	Mode                *int            `json:"mode" api:"optional"`
	Perception          *bool           `json:"perception" api:"optional"`
	GenerateConflictDoc *bool           `json:"generateConflictDoc" api:"optional"`
	AssetDownloadMode   *int            `json:"assetDownloadMode" api:"optional"`
	CloudName           *string         `json:"cloudName" api:"optional"`
	S3                  *SyncS3         `json:"s3" api:"optional"`
	WebDAV              *SyncWebDAV     `json:"webdav" api:"optional"`
	Local               *SyncLocal      `json:"local" api:"optional"`
	LAN                 *SyncLANRequest `json:"lan" api:"optional"`
}

type PatchRepoSetting struct {
	IndexRetentionDays    *int `json:"indexRetentionDays" api:"optional"`
	RetentionIndexesDaily *int `json:"retentionIndexesDaily" api:"optional"`
}
