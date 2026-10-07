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
	if nil == fileTree.ParentDocDoubleClickOpen || !*fileTree.ParentDocDoubleClickOpen {
		t.Fatal("parent document double-click opening should be enabled by default")
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

func TestFileTreeParentDocDoubleClickOpenCompatibility(t *testing.T) {
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{"parentDocClickExpand":true}`, true},
		{`{"parentDocDoubleClickOpen":null}`, true},
		{`{"parentDocDoubleClickOpen":false}`, false},
		{`{"parentDocDoubleClickOpen":true}`, true},
	} {
		t.Run(entry.body, func(t *testing.T) {
			var fileTree FileTree
			if err := json.Unmarshal([]byte(entry.body), &fileTree); err != nil {
				t.Fatal(err)
			}
			fileTree.NormalizeParentDocDoubleClickOpen()
			if nil == fileTree.ParentDocDoubleClickOpen || *fileTree.ParentDocDoubleClickOpen != entry.want {
				t.Fatalf("double-click preference: %v", fileTree.ParentDocDoubleClickOpen)
			}
			encoded, err := json.Marshal(&fileTree)
			if err != nil {
				t.Fatal(err)
			}
			var restored FileTree
			if err = json.Unmarshal(encoded, &restored); err != nil {
				t.Fatal(err)
			}
			if nil == restored.ParentDocDoubleClickOpen || *restored.ParentDocDoubleClickOpen != entry.want {
				t.Fatal("double-click preference was not preserved after serialization")
			}
		})
	}
}
