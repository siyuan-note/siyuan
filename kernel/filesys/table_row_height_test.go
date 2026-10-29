// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTableRowHeightLegacyAndEncryptedRoundTrip(t *testing.T) {
	legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
	if err != nil {
		t.Fatal(err)
	}
	originalDir, originalProvider := util.DataDir, DEKProvider
	originalAcquire, originalRelease := DEKLockAcquire, DEKLockRelease
	util.DataDir = t.TempDir()
	DEKLockAcquire, DEKLockRelease = nil, nil
	t.Cleanup(func() {
		cache.ClearTreeCache()
		util.DataDir, DEKProvider = originalDir, originalProvider
		DEKLockAcquire, DEKLockRelease = originalAcquire, originalRelease
	})
	boxID, documentPath := "20260908000000-box0001", "/20260908000000-root001.sy"
	engine := util.NewLute()
	for _, encrypted := range []bool{false, true} {
		name := "plain"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			dek := bytes.Repeat([]byte{23}, 32)
			DEKProvider = func(string) ([]byte, error) {
				if encrypted {
					return bytes.Clone(dek), nil
				}
				return nil, nil
			}
			tree, loadErr := LoadTreeByData(legacy, boxID, documentPath, engine)
			if loadErr != nil {
				t.Fatal(loadErr)
			}
			table := tree.Root.FirstChild
			head, body := table.FirstChild.FirstChild, table.LastChild
			if head.IALAttr("style") != "" || body.IALAttr("style") != "" {
				t.Fatal("legacy rows must retain automatic height")
			}
			head.SetIALAttr("style", "height: 60px;")
			body.SetIALAttr("style", "height: 100px;")
			data := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
			if encrypted {
				data, loadErr = encryptDataWithDEK(boxID, documentPath, data, dek)
				if loadErr != nil {
					t.Fatal(loadErr)
				}
			}
			absPath := filepath.Join(util.DataDir, boxID, documentPath)
			if loadErr = os.MkdirAll(filepath.Dir(absPath), 0700); loadErr != nil {
				t.Fatal(loadErr)
			}
			if loadErr = os.WriteFile(absPath, data, 0600); loadErr != nil {
				t.Fatal(loadErr)
			}
			cache.ClearTreeCache()
			restored, loadErr := LoadTree(boxID, documentPath, engine)
			if loadErr != nil {
				t.Fatal(loadErr)
			}
			if restored.Root.Spec != "2" || restored.Root.FirstChild.FirstChild.FirstChild.IALAttr("style") != "height: 60px;" ||
				restored.Root.FirstChild.LastChild.IALAttr("style") != "height: 100px;" {
				t.Fatal("document read lost row height or changed the legacy document version")
			}
			if string(restored.Root.FirstChild.LastChild.FirstChild.FirstChild.Tokens) != "**literal** - list" {
				t.Fatal("document read changed legacy cell content")
			}
			dom := engine.Tree2BlockDOM(restored, engine.RenderOptions, engine.ParseOptions)
			for kind, output := range map[string]string{"editor": dom, "HTML": engine.BlockDOM2HTML(dom),
				"internal Markdown": engine.Md2BlockDOM(engine.BlockDOM2Md(dom), false)} {
				if !strings.Contains(output, `height: 60px;`) || !strings.Contains(output, `height: 100px;`) ||
					!strings.Contains(output, "literal") || !strings.Contains(output, " - list") || !strings.Contains(output, "bold") {
					t.Fatalf("%s lost row height or legacy cell content: %s", kind, output)
				}
			}
			if encrypted {
				data[len(data)-1] ^= 1
				if loadErr = os.WriteFile(absPath, data, 0600); loadErr != nil {
					t.Fatal(loadErr)
				}
				cache.ClearTreeCache()
				if _, loadErr = LoadTree(boxID, documentPath, engine); loadErr == nil {
					t.Fatal("authentication failure must be rejected")
				}
				retained, readErr := os.ReadFile(absPath)
				if readErr != nil || !bytes.Equal(retained, data) {
					t.Fatal("failed authentication changed the source ciphertext")
				}
			}
		})
	}
}
