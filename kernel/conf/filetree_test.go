// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
	if nil == fileTree.BoxDocEnabled {
		t.Fatal("box document setting should be initialized")
	}
	if *fileTree.BoxDocEnabled {
		t.Fatal("box documents should be disabled for new users")
	}
	if nil == fileTree.UseSVGDefaultIcon {
		t.Fatal("default icon setting should be initialized")
	}
	if !*fileTree.UseSVGDefaultIcon {
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
