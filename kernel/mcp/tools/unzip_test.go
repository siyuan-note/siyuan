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
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

type probeZipEntry struct {
	name    string
	body    string
	symlink bool
}

func writeProbeZip(t *testing.T, zipPath string, entries []probeZipEntry) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(zipPath), 0755); err != nil {
		t.Fatalf("mkdir [%s] failed: %v", zipPath, err)
	}
	file, err := os.Create(zipPath)
	if err != nil {
		t.Fatalf("create zip [%s] failed: %v", zipPath, err)
	}
	writer := zip.NewWriter(file)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Deflate}
		if entry.symlink {
			header.SetMode(os.ModeSymlink | 0777)
		}
		target, createErr := writer.CreateHeader(header)
		if createErr != nil {
			t.Fatalf("create zip entry [%s] failed: %v", entry.name, createErr)
		}
		if _, createErr = target.Write([]byte(entry.body)); createErr != nil {
			t.Fatalf("write zip entry [%s] failed: %v", entry.name, createErr)
		}
	}
	if err = writer.Close(); err != nil {
		t.Fatalf("close zip writer failed: %v", err)
	}
	if err = file.Close(); err != nil {
		t.Fatalf("close zip file failed: %v", err)
	}
}

// TestSecurityReproUnzipRejectsSensitiveMembers 验证解压会逐个校验成员的最终输出路径：
// 成员不能覆盖敏感文件，也不能通过上跳或符号链接条目逃逸目标目录，见 GHSA-9g6v-r3xf-673q。
func TestSecurityReproUnzipRejectsSensitiveMembers(t *testing.T) {
	setupProbeWorkspace(t)
	confFile := filepath.Join(util.ConfDir, "conf.json")
	writeProbeFile(t, confFile, `{"accessAuthCode":"ORIGINAL"}`)
	publishAccess := filepath.Join(util.DataDir, ".siyuan", "publishAccess.json")
	writeProbeFile(t, publishAccess, `{"password":"ORIGINAL"}`)

	// 成员 conf.json 解压到 conf 目录被拒绝，且原文件保持不变
	writeProbeZip(t, filepath.Join(util.DataDir, "conf.zip"), []probeZipEntry{{name: "conf.json", body: "OVERWRITTEN"}})
	if result, _ := unzipHandler(map[string]any{"zipPath": "data/conf.zip", "destPath": "conf"}); !result.IsError {
		t.Errorf("unzip(conf.json -> conf) = %q, want forbidden", probeText(result))
	}
	if data, _ := os.ReadFile(confFile); string(data) != `{"accessAuthCode":"ORIGINAL"}` {
		t.Errorf("sensitive file was overwritten: %q", string(data))
	}

	// 成员 publishAccess.json 解压到 data/.siyuan 被拒绝
	writeProbeZip(t, filepath.Join(util.DataDir, "access.zip"), []probeZipEntry{{name: "publishAccess.json", body: "OVERWRITTEN"}})
	if result, _ := unzipHandler(map[string]any{"zipPath": "data/access.zip", "destPath": "data/.siyuan"}); !result.IsError {
		t.Errorf("unzip(publishAccess.json -> data/.siyuan) = %q, want forbidden", probeText(result))
	}
	if data, _ := os.ReadFile(publishAccess); string(data) != `{"password":"ORIGINAL"}` {
		t.Errorf("publishAccess.json was overwritten: %q", string(data))
	}

	// 上跳条目与符号链接条目被拒绝
	writeProbeZip(t, filepath.Join(util.DataDir, "slip.zip"), []probeZipEntry{{name: "../outside.txt", body: "escaped"}})
	if result, _ := unzipHandler(map[string]any{"zipPath": "data/slip.zip", "destPath": "data/out"}); !result.IsError {
		t.Errorf("unzip(../outside.txt) = %q, want forbidden", probeText(result))
	}
	if _, err := os.Stat(filepath.Join(util.WorkspaceDir, "outside.txt")); !os.IsNotExist(err) {
		t.Errorf("path traversal entry escaped the destination: %v", err)
	}
	writeProbeZip(t, filepath.Join(util.DataDir, "link.zip"), []probeZipEntry{{name: "link", body: "../conf/conf.json", symlink: true}})
	if result, _ := unzipHandler(map[string]any{"zipPath": "data/link.zip", "destPath": "data/out"}); !result.IsError {
		t.Errorf("unzip(symlink entry) = %q, want forbidden", probeText(result))
	}

	// 无害压缩包正常解压，普通目录仍然可用
	writeProbeZip(t, filepath.Join(util.DataDir, "harmless.zip"), []probeZipEntry{
		{name: "notes/ok.txt", body: "harmless"},
		{name: "empty/", body: ""},
	})
	if result, _ := unzipHandler(map[string]any{"zipPath": "data/harmless.zip", "destPath": "data/out"}); result.IsError {
		t.Errorf("unzip(harmless) failed: %q", probeText(result))
	}
	data, err := os.ReadFile(filepath.Join(util.DataDir, "out", "notes", "ok.txt"))
	if err != nil || !strings.Contains(string(data), "harmless") {
		t.Errorf("harmless archive was not extracted: %q %v", string(data), err)
	}
	if info, err := os.Stat(filepath.Join(util.DataDir, "out", "empty")); err != nil || !info.IsDir() {
		t.Errorf("archive directory entry was not created: %v", err)
	}
}
