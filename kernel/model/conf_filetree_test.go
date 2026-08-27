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

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestNormalizeFileTreeDefaultIcon(t *testing.T) {
	for _, test := range []struct {
		name           string
		fileTree       *conf.FileTree
		confFileExists bool
		want           bool
	}{
		{name: "new user", want: true},
		{name: "existing configuration without file tree", confFileExists: true},
		{name: "existing configuration without setting", fileTree: &conf.FileTree{}, confFileExists: true},
		{
			name:           "existing configuration with setting enabled",
			fileTree:       &conf.FileTree{UseSVGDefaultIcon: new(true)},
			confFileExists: true,
			want:           true,
		},
		{
			name:           "existing configuration with setting disabled",
			fileTree:       &conf.FileTree{UseSVGDefaultIcon: new(false)},
			confFileExists: true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			fileTree := normalizeFileTreeDefaultIcon(test.fileTree, test.confFileExists)
			if nil == fileTree.UseSVGDefaultIcon {
				t.Fatal("default icon setting should be initialized")
			}
			if test.want != *fileTree.UseSVGDefaultIcon {
				t.Fatalf("unexpected default icon setting: got %t, want %t", *fileTree.UseSVGDefaultIcon, test.want)
			}
		})
	}
}
