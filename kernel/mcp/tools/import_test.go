// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"strings"
	"testing"
)

func TestImportDataDescriptionExplainsOverwrite(t *testing.T) {
	for _, text := range []string{"current workspace", "overwriting existing files at matching paths", "retaining files absent from the backup", "user explicitly requests restoring a backup", "approves overwriting current data"} {
		if !strings.Contains(ImportTool.Description, text) {
			t.Fatalf("import description is missing %q", text)
		}
	}
}
