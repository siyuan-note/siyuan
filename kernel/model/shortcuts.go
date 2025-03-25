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

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func ShortcutsAppendToDailynote() {
	dailynotesDir := filepath.Join(util.ShortcutsPath, "dailynotes")
	if !gulu.File.IsDir(dailynotesDir) {
		return
	}

	dir, err := os.ReadDir(dailynotesDir)
	if nil != err {
		logging.LogErrorf("read dir [%s] failed: %s", dailynotesDir, err)
		return
	}

	buff := bytes.Buffer{}
	var toRemoves []string
	for _, entry := range dir {
		if entry.IsDir() {
			continue
		}

		if filepath.Ext(entry.Name()) != ".md" {
			continue
		}

		p := filepath.Join(dailynotesDir, entry.Name())
		data, readErr := os.ReadFile(p)
		if nil != readErr {
			logging.LogErrorf("read file [%s] failed: %s", p, readErr)
			continue
		}

		buff.Write(bytes.TrimSpace(data))
		buff.WriteString("\n\n")
		logging.LogInfof("read dailynote [%s] content [%s]", p, data)
		toRemoves = append(toRemoves, p)
	}

	defer func() {
		for _, p := range toRemoves {
			if err := os.Remove(p); nil != err {
				logging.LogErrorf("remove file [%s] failed: %s", p, err)
			}
		}
	}()

	content := strings.TrimSpace(buff.String())
	if 1 > len(content) {
		return
	}

	logging.LogInfof("append dailynote content [%s]", content)
}
