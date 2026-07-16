// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"testing"

	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestValidateDocumentPayloadRejectsAttributeRepair(t *testing.T) {
	const (
		boxID  = "20260101000000-abcdefg"
		rootID = "20260101000001-abcdefg"
	)
	tree := treenode.NewTree(boxID, "/"+rootID+".sy", "/Test", "Test")
	tree.Root.SetIALAttr("title", `&amp;" onmouseenter="require('child_process').exec('calc')`)
	luteEngine := util.NewLute()
	renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	data := renderer.Render()
	encodedEscaped := []byte(`\u0026amp;amp;\u0026quot; onmouseenter=\u0026quot;require('child_process').exec('calc')`)
	encodedVulnerable := []byte(`\u0026amp;\" onmouseenter=\"require('child_process').exec('calc')`)
	data = bytes.Replace(data, encodedEscaped, encodedVulnerable, 1)
	if bytes.Contains(data, encodedEscaped) {
		t.Fatal("failed to construct vulnerable document payload")
	}
	if _, err := ValidateDocumentPayloadBlockIDs(bytes.NewReader(data), int64(len(data)), rootID, int64(len(data)+1)); err == nil {
		t.Fatal("document requiring attribute escaping must be rejected")
	}
}
