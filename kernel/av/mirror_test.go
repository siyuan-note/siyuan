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

package av

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetBlockRelsByAVIDsReturnsReadError(t *testing.T) {
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = previousDataDir
	})

	mirrorPath := mirrorBlocksPath("")
	if err := os.MkdirAll(filepath.Dir(mirrorPath), 0755); nil != err {
		t.Fatalf("create mirror directory failed: %v", err)
	}
	if err := os.WriteFile(mirrorPath, []byte("invalid"), 0644); nil != err {
		t.Fatalf("write invalid mirror index failed: %v", err)
	}

	if _, err := GetBlockRelsByAVIDs([]string{"20260804000000-viewerr"}); nil == err {
		t.Fatal("an unreadable mirror index should return an error")
	}
}
