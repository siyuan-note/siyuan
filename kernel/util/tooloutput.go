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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
