// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"testing"
)

func TestNewFileTreeDefaults(t *testing.T) {
	fileTree := NewFileTree()
	if 0 != fileTree.DocIconClickMode {
		t.Fatal("clicking a document or notebook icon should change the icon by default")
	}
	if 0 != fileTree.ParentDocTitleClickMode {
		t.Fatal("clicking a parent document title should open the document by default")
	}
	if fileTree.BoxDocEnabled {
		t.Fatal("box documents should be disabled for new users")
	}
	if !fileTree.UseSVGDefaultIcon {
		t.Fatal("SVG default icons should be enabled for new users")
	}
}

func TestFileTreeClickModeSerialization(t *testing.T) {
	for _, entry := range []struct {
		body                 string
		docIcon, parentTitle int
	}{
		{`{"docIconClickMode":1,"parentDocTitleClickMode":2}`, 1, 2},
		{`{"docIconClickMode":0,"parentDocTitleClickMode":0}`, 0, 0},
		{`{"parentDocTitleClickMode":1}`, 0, 1},
		// 已废弃的布尔字段不再被读取，升级后按默认值生效
		{`{"docIconClickExpand":true,"parentDocClickExpand":true,"parentDocDoubleClickOpen":false}`, 0, 0},
	} {
		t.Run(entry.body, func(t *testing.T) {
			fileTree := NewFileTree()
			if err := json.Unmarshal([]byte(entry.body), fileTree); err != nil {
				t.Fatal(err)
			}
			if fileTree.DocIconClickMode != entry.docIcon || fileTree.ParentDocTitleClickMode != entry.parentTitle {
				t.Fatalf("click modes: %d, %d", fileTree.DocIconClickMode, fileTree.ParentDocTitleClickMode)
			}
			encoded, err := json.Marshal(fileTree)
			if err != nil {
				t.Fatal(err)
			}
			var restored FileTree
			if err = json.Unmarshal(encoded, &restored); err != nil {
				t.Fatal(err)
			}
			if restored.DocIconClickMode != entry.docIcon || restored.ParentDocTitleClickMode != entry.parentTitle {
				t.Fatal("click modes were not preserved after serialization")
			}
		})
	}
}
