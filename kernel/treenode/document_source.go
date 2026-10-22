package treenode

import (
	"bytes"
	"encoding/json"
	"errors"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
)

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
	if errors.Is(root.Properties.err, documentaddressing.ErrModeConflict) {
		return "", root.Properties.err
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
	if err := documentaddressing.CheckLegacyTitleProperties(data); err != nil {
		if properties.err == nil || errors.Is(err, documentaddressing.ErrModeConflict) {
			properties.err = err
		}
	}
	return nil
}
