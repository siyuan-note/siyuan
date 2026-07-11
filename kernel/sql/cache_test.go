// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package sql

import "testing"

// TestBlockCacheIsolatedByEncryptedBox 验证加密笔记本块不会污染全局缓存，且不同加密笔记本可安全使用相同块 ID。
func TestBlockCacheIsolatedByEncryptedBox(t *testing.T) {
	originalDisabled := cacheDisabled
	originalIsEncryptedBoxFn := IsEncryptedBoxFn
	defer func() {
		cacheDisabled = originalDisabled
		IsEncryptedBoxFn = originalIsEncryptedBoxFn
		ClearCache()
	}()

	cacheDisabled = false
	IsEncryptedBoxFn = func(boxID string) bool {
		return boxID == "encrypted-a" || boxID == "encrypted-b"
	}
	ClearCache()

	putBlockCache(&Block{ID: "shared-id", Box: "encrypted-a", Content: "secret-a"})
	putBlockCache(&Block{ID: "shared-id", Box: "encrypted-b", Content: "secret-b"})
	putBlockCache(&Block{ID: "normal-id", Box: "normal", Content: "normal"})
	blockCache.Wait()

	if block := getBlockCache("shared-id"); block != nil {
		t.Fatalf("global cache must not return encrypted block, got box %q", block.Box)
	}
	if block := getBlockCacheInBox("shared-id", "encrypted-a"); block == nil || block.Content != "secret-a" {
		t.Fatalf("encrypted-a cache miss or cross-box result: %#v", block)
	}
	if block := getBlockCacheInBox("shared-id", "encrypted-b"); block == nil || block.Content != "secret-b" {
		t.Fatalf("encrypted-b cache miss or cross-box result: %#v", block)
	}
	if block := getBlockCache("normal-id"); block == nil || block.Content != "normal" {
		t.Fatalf("normal block cache behavior changed: %#v", block)
	}

	removeBlockCache("shared-id")
	blockCache.Wait()
	if block := getBlockCacheInBox("shared-id", "encrypted-a"); block != nil {
		t.Fatalf("encrypted-a cache entry was not removed: %#v", block)
	}
	if block := getBlockCacheInBox("shared-id", "encrypted-b"); block != nil {
		t.Fatalf("encrypted-b cache entry was not removed: %#v", block)
	}
}
