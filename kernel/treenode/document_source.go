// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"bytes"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
)

var ErrDocumentTitleSpec = errors.New("document title requires spec " + DocumentTitleSpec)

func documentTitleSpecUpgradeRequired(spec string) bool {
	version, err := strconv.Atoi(spec)
	required, _ := strconv.Atoi(DocumentTitleSpec)
	return spec == "" || err == nil && version < required
}

// CheckDocumentTitleWriteSpecJSON 仅用于已通过源格式检查的原始文件写入，不收紧既有源的读取及恢复。
// 不改写请求字节；含斜杠标题必须声明足够的 Spec，重复属性不能遮盖版本要求。
func CheckDocumentTitleWriteSpecJSON(data []byte) error {
	var root struct {
		Spec       string
		Properties documentTitleSpecProperties
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return err
	}
	if root.Properties.requiresStructured && documentTitleSpecUpgradeRequired(root.Spec) {
		return ErrDocumentTitleSpec
	}
	return nil
}

type documentTitleSpecProperties struct {
	requiresStructured bool
}

func (properties *documentTitleSpecProperties) UnmarshalJSON(data []byte) error {
	requiresSpec, err := documentaddressing.CheckTitleProperties(data)
	properties.requiresStructured = properties.requiresStructured || requiresSpec
	return err
}

// checkDocumentSourceJSON 保留重复字段中遇到的兼容错误，在容错解析前确定标题和源版本能否处理。
func checkDocumentSourceJSON(data []byte) (string, error) {
	if !bytes.HasPrefix(bytes.TrimSpace(data), []byte("{")) {
		return "", errors.New("invalid document source")
	}
	var root struct {
		Spec       documentSourceSpec
		Properties documentSourceProperties
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return "", err
	}
	if root.Spec.err != nil {
		return "", root.Spec.err
	}
	return root.Spec.value, root.Properties.err
}

type documentSourceSpec struct {
	value string
	err   error
}

func (spec *documentSourceSpec) UnmarshalJSON(data []byte) error {
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		if spec.err == nil {
			spec.err = errors.New("invalid document spec")
		}
	} else if err = CheckSpec(&parse.Tree{Root: &ast.Node{Spec: value}}); err != nil {
		if spec.err == nil || errors.Is(err, ErrSpecTooNew) {
			spec.err = err
		}
	}
	spec.value = value
	return nil
}

type documentSourceProperties struct {
	err error
}

func (properties *documentSourceProperties) UnmarshalJSON(data []byte) error {
	if _, err := documentaddressing.CheckTitleProperties(data); err != nil {
		if properties.err == nil {
			properties.err = err
		}
	}
	return nil
}
