// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/88250/lute/ast"
)

// DocumentTarget 在渲染前保存标题段边界，变量产生的分隔符不改变文档层级。
type DocumentTarget struct {
	Version         int                  `json:"version"`
	Notebook        string               `json:"notebook"`
	Anchor          DocumentTargetAnchor `json:"anchor"`
	Up              int                  `json:"up"`
	Parents         []string             `json:"parents"`
	Title           string               `json:"title"`
	OnMissingParent string               `json:"onMissingParent"`
}

type DocumentTargetAnchor struct {
	Kind string `json:"kind"`
	ID   string `json:"id,omitempty"`
}

type DocumentTargets struct {
	Document  *DocumentTarget `json:"docCreateTarget,omitempty"`
	Reference *DocumentTarget `json:"refCreateTarget,omitempty"`
	DailyNote *DocumentTarget `json:"dailyNoteTarget,omitempty"`
}

func (targets DocumentTargets) Empty() bool {
	return targets.Document == nil && targets.Reference == nil && targets.DailyNote == nil
}

func (targets *DocumentTargets) UnmarshalJSON(data []byte) error {
	if _, err := documentTargetFields(data); err != nil {
		return err
	}
	type plain DocumentTargets
	var next plain
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&next); err != nil {
		return err
	}
	*targets = DocumentTargets(next)
	return nil
}

func (target *DocumentTarget) Validate() error {
	if target == nil {
		return nil
	}
	if target.Version != 2 || !ast.IsNodeIDPattern(target.Notebook) || target.Up < 0 || target.Up > 128 ||
		target.Parents == nil || len(target.Parents) > 128 ||
		(target.OnMissingParent != "create" && target.OnMissingParent != "error") {
		return errors.New("invalid structured document target")
	}
	switch target.Anchor.Kind {
	case "notebookRoot", "context":
		if target.Anchor.ID != "" {
			return errors.New("document target anchor must not contain an ID")
		}
	case "document":
		if !ast.IsNodeIDPattern(target.Anchor.ID) {
			return errors.New("document target anchor requires a document ID")
		}
	default:
		return errors.New("invalid document target anchor")
	}
	return nil
}

// UnmarshalJSON 拒绝未知版本及缺省字段，避免把不认识的配置按空目标覆盖。
func (target *DocumentTarget) UnmarshalJSON(data []byte) error {
	fields, err := documentTargetFields(data)
	if err != nil {
		return err
	}
	if _, err = documentTargetFields(fields["anchor"]); err != nil {
		return err
	}
	type plain DocumentTarget
	var next plain
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&next); err != nil {
		return err
	}
	for _, name := range []string{"version", "notebook", "anchor", "up", "parents", "title", "onMissingParent"} {
		if value, exists := fields[name]; !exists || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return errors.New("missing or null document target field: " + name)
		}
	}
	value := DocumentTarget(next)
	if err := value.Validate(); err != nil {
		return err
	}
	*target = value
	return nil
}

// documentTargetFields 保留字段出现次数，避免重复或大小写别名把未来版本遮盖成已知版本。
func documentTargetFields(data []byte) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return nil, errors.New("invalid document target object")
	}
	fields, seen := map[string]json.RawMessage{}, map[string]bool{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		name := token.(string)
		if seen[strings.ToLower(name)] {
			return nil, errors.New("duplicate document target field: " + name)
		}
		seen[strings.ToLower(name)] = true
		var value json.RawMessage
		if err = decoder.Decode(&value); err != nil {
			return nil, err
		}
		fields[name] = value
	}
	if token, err := decoder.Token(); err != nil || token != json.Delim('}') {
		return nil, errors.New("invalid document target object")
	}
	if decoder.Decode(new(json.RawMessage)) != io.EOF {
		return nil, errors.New("invalid document target suffix")
	}
	return fields, nil
}
