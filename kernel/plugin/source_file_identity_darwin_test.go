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

//go:build darwin

package plugin

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReadPluginSourceFileIdentityDetectsInPlaceWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kernel.js")
	if err := os.WriteFile(path, []byte("initial"), 0644); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	beforeDevice, beforeInode, beforeCTime := readPluginSourceFileIdentity(before)

	time.Sleep(10 * time.Millisecond)
	if err = os.WriteFile(path, []byte("changed"), 0644); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	afterDevice, afterInode, afterCTime := readPluginSourceFileIdentity(after)

	if beforeDevice != afterDevice || beforeInode != afterInode {
		t.Fatal("in-place write must preserve the file identity")
	}
	if beforeCTime == afterCTime {
		t.Fatal("in-place write must update ctime")
	}
}
