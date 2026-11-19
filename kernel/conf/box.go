// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"reflect"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// BoxConf 维护 .siyuan/conf.json 笔记本配置。
type BoxConf struct {
	DocCreateTarget       *DocumentTarget `json:"docCreateTarget,omitempty"`
	RefCreateTarget       *DocumentTarget `json:"refCreateTarget,omitempty"`
	DailyNoteTarget       *DocumentTarget `json:"dailyNoteTarget,omitempty"`
	MetadataVersion       int             `json:"-"`                     // 已认证配置载荷版本，只在内存中保存
	Name                  string          `json:"name"`                  // 笔记本名称
	Sort                  int             `json:"sort"`                  // 排序字段
	Icon                  string          `json:"icon"`                  // 图标
	Closed                bool            `json:"closed"`                // 是否处于关闭状态
	RefCreateSaveBox      string          `json:"refCreateSaveBox"`      // 块引时新建文档存储笔记本
	RefCreateSavePath     string          `json:"refCreateSavePath"`     // 块引时新建文档存储路径
	DocCreateSaveBox      string          `json:"docCreateSaveBox"`      // 新建文档存储笔记本
	DocCreateSavePath     string          `json:"docCreateSavePath"`     // 新建文档存储路径
	DocCreateTemplatePath string          `json:"docCreateTemplatePath"` // 新建文档使用的模板路径
	DailyNoteSavePath     string          `json:"dailyNoteSavePath"`     // 新建日记存储路径
	DailyNoteTemplatePath string          `json:"dailyNoteTemplatePath"` // 新建日记使用的模板路径
	SortMode              int             `json:"sortMode"`              // 排序方式
	Encrypted             bool            `json:"encrypted"`             // 是否为加密笔记本
	BoxCrypt              *BoxEncryption  `json:"boxCrypt"`              // 笔记本加密参数，仅 Encrypted=true 时有值

	Extra map[string]json.RawMessage `json:"-"` // 当前版本未知的顶层配置字段
}

type boxConfJSON BoxConf

var boxConfJSONNames = func() map[string]struct{} {
	names := map[string]struct{}{}
	for field := range reflect.TypeFor[boxConfJSON]().Fields() {
		name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
		if name != "-" {
			if name == "" {
				name = field.Name
			}
			names[name] = struct{}{}
		}
	}
	return names
}()

func isBoxConfJSONName(name string) bool {
	if _, known := boxConfJSONNames[name]; known {
		return true
	}
	for known := range boxConfJSONNames {
		if strings.EqualFold(name, known) {
			return true
		}
	}
	return false
}

func (c *BoxConf) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if err := json.Unmarshal(data, (*boxConfJSON)(c)); err != nil {
		return err
	}
	for name := range fields {
		if isBoxConfJSONName(name) {
			delete(fields, name)
		}
	}
	c.Extra = nil
	if len(fields) > 0 {
		c.Extra = fields
	}
	return nil
}

func (c BoxConf) MarshalJSON() ([]byte, error) {
	data, err := json.Marshal(boxConfJSON(c))
	if err != nil || len(c.Extra) == 0 {
		return data, err
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	for name, value := range c.Extra {
		if !isBoxConfJSONName(name) {
			fields[name] = value
		}
	}
	return json.Marshal(fields)
}

// BoxEncryption 维护单个加密笔记本的密钥包络参数。WrappedDEK 是用全局 KEK 加密后的 DEK，本身可落盘。
type BoxEncryption struct {
	Spec       int    `json:"spec"`               // 当前包络规范标识，WrappedDEK 绑定 boxID AAD
	WrappedDEK []byte `json:"wrappedDEK"`         // 用 KEK 经 AES-GCM 加密后的 DEK
	WrapNonce  []byte `json:"wrapNonce"`          // 包络用的 GCM nonce（从加密信封中提取）
	Metadata   []byte `json:"metadata,omitempty"` // 用 DEK 加密的图标和排序元数据
	CreatedAt  int64  `json:"createdAt"`          // 创建时间，单位毫秒，便于未来按时间轮换密钥
}

func NewBoxConf() *BoxConf {
	return &BoxConf{
		Name:                  "Untitled",
		Closed:                true,
		DailyNoteSavePath:     "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
		DailyNoteTemplatePath: "",
		SortMode:              util.SortModeFileTree,
		Encrypted:             false,
	}
}
