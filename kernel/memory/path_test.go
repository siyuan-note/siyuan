// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memory

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestMemoryStorageRootUsesCanonicalPath(t *testing.T) {
	dataDir := t.TempDir()
	if StorageDir != "storage/ai/memory" || SyncPrefix != "/storage/ai/memory/" || Path(dataDir) != filepath.Join(dataDir, "storage", "ai", "memory") {
		t.Fatal("storage and sync roots disagree")
	}
	root, err := NewStore(dataDir).root(true)
	if err != nil {
		t.Fatal(err)
	}
	root.Close()
	if _, err = os.Stat(Path(dataDir)); err != nil {
		t.Fatal(err)
	}
	if _, err = NewStore(dataDir).Search(context.Background(), SearchOptions{}); err != nil {
		t.Fatal(err)
	}
}
