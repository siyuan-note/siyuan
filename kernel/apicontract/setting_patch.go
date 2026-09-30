package apicontract

import (
	"encoding/json"
	"errors"
	"io"
)

// PatchSettingRequest 每次仅更新一个配置域。对象递归合并，数组和 null 整体替换，省略字段保留当前值。
// 旧设置接口的整份配置提交和默认值语义不变；失败不发出配置变更通知。
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
			case "editor", "export", "fileTree", "search", "appearance", "flashcard", "ai", "secrets", "variables", "keymap":
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
			r.namespace, r.patch = namespace, patch
		}
		return
	}
}
