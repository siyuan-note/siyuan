// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"path/filepath"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
)

const MaxToolOutputChars = 40000

func TruncateToolOutput(text, sessionID string) string {
	runes := []rune(text)
	if len(runes) <= MaxToolOutputChars || sessionID == "" {
		return text
	}

	outputDir := filepath.Join(DataDir, "storage", "ai", "agent", "sessions", sessionID, "output")
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return text
	}

	name := ast.NewNodeID() + ".txt"
	path := filepath.Join(outputDir, name)
	if err := filelock.WriteFile(path, []byte(text)); err != nil {
		return text
	}

	relPath := filepath.Join("data", "storage", "ai", "agent", "sessions", sessionID, "output", name)
	return string(runes[:MaxToolOutputChars]) + "\n\n...content truncated. Full output: " + relPath
}
