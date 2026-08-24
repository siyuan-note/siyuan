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

package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAgentLogToolReadsSearchesAndRedacts(t *testing.T) {
	workspace := t.TempDir()
	originalWorkspace, originalData, originalConfDir, originalLogPath :=
		util.WorkspaceDir, util.DataDir, util.ConfDir, util.LogPath
	originalConf := model.Conf
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.ConfDir = filepath.Join(workspace, "conf")
	util.LogPath = filepath.Join(workspace, "temp", "siyuan.log")
	model.Conf = model.NewAppConf()
	model.Conf.Api = &kernelConf.API{Token: "api-token-123456"}
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, util.ConfDir, util.LogPath =
			originalWorkspace, originalData, originalConfDir, originalLogPath
		model.Conf = originalConf
	})

	if err := os.MkdirAll(filepath.Dir(util.LogPath), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	content := strings.Join([]string{
		"boot complete",
		"database failed",
		"database context",
		"request /api/search/fullTextSearchBlock?token=historical-token-789012",
		"configured credential api-token-123456",
		"Authorization: Bearer header-secret-12345",
		"shutdown complete",
	}, "\n")
	if err := os.WriteFile(util.LogPath, []byte(content), 0644); err != nil {
		t.Fatalf("write log: %v", err)
	}

	if _, err := resolvePath(filepath.Join("temp", "siyuan.log")); err == nil {
		t.Fatal("the general file tool must continue to reject the raw kernel log")
	}

	tail, err := agentLogHandler(map[string]any{"action": "tail", "limit": float64(4)})
	if err != nil || tail.IsError || len(tail.Content) != 1 {
		t.Fatalf("tail failed: result=%#v err=%v", tail, err)
	}
	tailText := tail.Content[0].Text
	for _, secret := range []string{"historical-token-789012", "api-token-123456", "header-secret-12345"} {
		if strings.Contains(tailText, secret) {
			t.Fatalf("tail leaked secret %q: %s", secret, tailText)
		}
	}
	if strings.Count(tailText, agentLogRedacted) != 3 || !strings.Contains(tailText, "4: request") ||
		!strings.Contains(tailText, "7: shutdown complete") || strings.Contains(tailText, "3: database context") {
		t.Fatalf("unexpected tail output: %s", tailText)
	}

	read, err := agentLogHandler(map[string]any{"action": "read", "offset": float64(2), "limit": float64(2)})
	if err != nil || read.IsError || len(read.Content) != 1 {
		t.Fatalf("read failed: result=%#v err=%v", read, err)
	}
	readText := read.Content[0].Text
	if !strings.Contains(readText, "2: database failed") || !strings.Contains(readText, "3: database context") ||
		strings.Contains(readText, "4: request") {
		t.Fatalf("unexpected read output: %s", readText)
	}

	search, err := agentLogHandler(map[string]any{
		"action": "search", "query": "DATABASE", "context": float64(1), "limit": float64(1),
	})
	if err != nil || search.IsError || len(search.Content) != 1 {
		t.Fatalf("search failed: result=%#v err=%v", search, err)
	}
	searchText := search.Content[0].Text
	if !strings.Contains(searchText, "1: boot complete") || !strings.Contains(searchText, "2: database failed") ||
		!strings.Contains(searchText, "3: database context") || strings.Contains(searchText, "4: request") {
		t.Fatalf("unexpected search output: %s", searchText)
	}

	stat, err := agentLogHandler(map[string]any{"action": "stat"})
	if err != nil || stat.IsError || len(stat.Content) != 1 || !strings.Contains(stat.Content[0].Text, "Lines: 7") {
		t.Fatalf("unexpected stat result: result=%#v err=%v", stat, err)
	}
}

func TestAgentLogOutputLimitPreservesUTF8(t *testing.T) {
	text := strings.Repeat("界", agentLogMaxOutputBytes)
	result := truncateAgentLogOutput(text)
	if len(result) > agentLogMaxOutputBytes || !strings.Contains(result, "[output truncated]") || !utf8.ValidString(result) {
		t.Fatalf("invalid truncated output: bytes=%d", len(result))
	}
}
