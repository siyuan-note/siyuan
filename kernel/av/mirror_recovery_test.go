// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"os"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMirrorRecoveryRetainsOriginalCryptoBoundary(t *testing.T) {
	oldData, oldEncrypted := util.DataDir, AVIsEncryptedBox
	util.DataDir = t.TempDir()
	private := ast.NewNodeID()
	AVIsEncryptedBox = func(box string) bool { return box == private }
	t.Cleanup(func() { util.DataDir, AVIsEncryptedBox = oldData, oldEncrypted })
	avID, blockID := ast.NewNodeID(), ast.NewNodeID()
	for _, exists := range []bool{false, true} {
		present := map[string]string{}
		if exists {
			present[blockID] = avID
		}
		if err := ReconcileBlockRels([]BlockRelRecovery{{ID: blockID, AttributeViewID: avID, BoxID: private}}, present); err == nil {
			t.Fatal("private mirror recovery fell back to global storage")
		}
		if _, err := os.Stat(mirrorBlocksPath("")); !os.IsNotExist(err) {
			t.Fatal("private mirror metadata entered global storage", err)
		}
	}
}
