package treenode

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
)

// documentTitleSourceJSON 在节点容错解析之前拒绝重复源、未知格式及空载荷。
type documentTitleSourceJSON struct {
	seen   bool
	source *ast.DocumentTitle
}

func (value *documentTitleSourceJSON) UnmarshalJSON(data []byte) error {
	if value.seen || bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return fmt.Errorf("%w: duplicate or null rich source", documentaddressing.ErrInvalidTitle)
	}
	value.seen = true
	source, err := ast.ParseDocumentTitleJSON(data)
	if err != nil {
		return fmt.Errorf("%w: invalid rich source", documentaddressing.ErrInvalidTitle)
	}
	if _, err := parse.ParseDocumentTitle(source); err != nil {
		return fmt.Errorf("%w: invalid rich source", documentaddressing.ErrInvalidTitle)
	}
	value.source = source
	return nil
}

func restoreDocumentTitleSource(data []byte, tree *parse.Tree) error {
	var root struct{ DocumentTitle documentTitleSourceJSON }
	if err := json.Unmarshal(data, &root); err != nil {
		return err
	}
	tree.Root.DocumentTitle = root.DocumentTitle.source
	return RefreshDocumentTitle(tree.Root)
}

// ParseJSON 验证文档源，并补齐通用旧解析器未复制的专用根字段。
func ParseJSON(data []byte, options *parse.Options) (*parse.Tree, bool, error) {
	if err := CheckSpecJSON(data); err != nil {
		return nil, false, err
	}
	tree, fixed, err := dataparser.ParseJSON(data, options)
	if err == nil {
		err = restoreDocumentTitleSource(data, tree)
	}
	return tree, fixed, err
}

// ParseJSONWithoutFix 用于历史、副本与资源扫描，保留专用标题源并禁止未知格式被容错覆盖。
func ParseJSONWithoutFix(data []byte, options *parse.Options) (*parse.Tree, error) {
	if err := CheckSpecJSON(data); err != nil {
		return nil, err
	}
	tree, err := dataparser.ParseJSONWithoutFix(data, options)
	if err == nil {
		err = restoreDocumentTitleSource(data, tree)
	}
	return tree, err
}
