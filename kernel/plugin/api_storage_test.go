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

package plugin

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/dop251/goja"
)

func TestStorageGetResolvesFileContents(t *testing.T) {
	p, r := newDataObjectTestPlugin(t)
	p.storageDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(p.storageDir, "icon.png"), []byte("png"), 0644); err != nil {
		t.Fatal(err)
	}

	var err error
	r.withRuntime(func(rt *goja.Runtime) {
		siyuan := rt.NewObject()
		if err = injectStorage(p, rt, siyuan); err == nil {
			err = rt.Set("siyuan", siyuan)
		}
	})
	if err != nil {
		t.Fatalf("inject storage: %v", err)
	}

	got := r.await(`(async () => {
		const data = await siyuan.storage.get("icon.png");
		return JSON.stringify([await data.text(), Array.from(new Uint8Array(await data.arrayBuffer()))]);
	})()`)
	if want := `["png",[112,110,103]]`; got != want {
		t.Fatalf("storage data = %s, want %s", got, want)
	}
}
