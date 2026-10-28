// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// CLI 单次命令在独立进程里执行，进程内没有 WebSocket 服务，util 的广播函数不会有任何接收者。
// 因此写操作后的界面刷新只能写入队列，由运行中的应用重放；广播方式属于静默失效。
func TestCLIWriteCommandsQueueReloadsInsteadOfBroadcasting(t *testing.T) {
	broadcasts := []string{"util.PushReloadFiletree(", "util.PushReloadTag(", "util.PushReloadUI(",
		"util.BroadcastByType("}
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") || name == "serve.go" {
			continue
		}
		data, readErr := os.ReadFile(filepath.Clean(name))
		if readErr != nil {
			t.Fatal(readErr)
		}
		source := string(data)
		for _, broadcast := range broadcasts {
			if strings.Contains(source, broadcast) {
				t.Errorf("%s calls %s, which cannot reach any client from a one-shot CLI process; "+
					"append the entry with model.AppendPushReload...Entry instead", name, broadcast)
			}
		}
	}
}
