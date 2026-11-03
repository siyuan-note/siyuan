// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/88250/lute/ast"
)

const RelationDetailViewSpec = 1

// 配置附属于源关联字段，ViewID 引用目标库现有表格视图，不保存关联条目快照。
type RelationDetailView struct {
	Spec    int    `json:"spec"`
	Enabled bool   `json:"enabled"`
	ViewID  string `json:"viewID"`

	// 保留未知版本及扩展字段，普通字段编辑不能丢失新客户端保存的配置。
	extra   map[string]json.RawMessage
	unknown json.RawMessage
}

func (config *RelationDetailView) UnmarshalJSON(data []byte) error {
	var version struct {
		Spec int `json:"spec"`
	}
	if err := json.Unmarshal(data, &version); err != nil {
		return err
	}
	if version.Spec != RelationDetailViewSpec {
		*config = RelationDetailView{Spec: version.Spec, unknown: append(json.RawMessage(nil), data...)}
		return nil
	}
	type plain RelationDetailView
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var extra map[string]json.RawMessage
	if err := json.Unmarshal(data, &extra); err != nil {
		return err
	}
	delete(extra, "spec")
	delete(extra, "enabled")
	delete(extra, "viewID")
	*config = RelationDetailView(decoded)
	if len(extra) > 0 {
		config.extra = extra
	}
	return nil
}

func (config RelationDetailView) MarshalJSON() ([]byte, error) {
	if config.Spec != RelationDetailViewSpec && len(config.unknown) > 0 {
		return config.unknown, nil
	}
	type plain RelationDetailView
	data, err := json.Marshal(plain(config))
	if err != nil || len(config.extra) == 0 {
		return data, err
	}
	var object map[string]json.RawMessage
	if err = json.Unmarshal(data, &object); err != nil {
		return nil, err
	}
	for key, value := range config.extra {
		object[key] = value
	}
	return json.Marshal(object)
}

func (config *RelationDetailView) Validate() error {
	if config == nil {
		return nil
	}
	if config.Spec != RelationDetailViewSpec {
		return fmt.Errorf("unsupported relation detail view specification [%d]", config.Spec)
	}
	if (config.Enabled || config.ViewID != "") && !ast.IsNodeIDPattern(config.ViewID) {
		return errors.New("invalid relation detail view ID")
	}
	return nil
}

func (attrView *AttributeView) HasRelationDetailViews() bool {
	if attrView == nil {
		return false
	}
	for _, kv := range attrView.KeyValues {
		if kv != nil && kv.Key != nil && kv.Key.Relation != nil && kv.Key.Relation.DetailView != nil {
			return true
		}
	}
	return false
}

// 已删除的默认视图返回可修复错误，不改写配置、替换视图或创建视图。
func (attrView *AttributeView) ResolveRelationDetailView(config *RelationDetailView) (*View, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	if config == nil || !config.Enabled {
		return nil, errors.New("relation detail view is disabled")
	}
	if attrView == nil {
		return nil, ErrViewNotFound
	}
	if view := attrView.GetView(config.ViewID); view != nil {
		if view.LayoutType != LayoutTypeTable || view.Table == nil || view.Table.BaseLayout == nil {
			return nil, errors.New("relation detail view requires a table view")
		}
		return view, nil
	}
	return nil, ErrViewNotFound
}
