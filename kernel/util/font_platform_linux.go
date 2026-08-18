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

//go:build linux && !android

package util

import (
	"context"
	"os/exec"
	"time"

	"github.com/siyuan-note/logging"
)

func loadPlatformFonts() []*Font {
	path, err := exec.LookPath("fc-list")
	if nil != err {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, "-f", fontconfigListFormat).Output()
	if nil != err {
		if ctx.Err() == context.DeadlineExceeded {
			logging.LogWarnf("load Fontconfig fonts timed out")
		} else {
			logging.LogWarnf("load Fontconfig fonts failed: %s", err)
		}
		return nil
	}
	return parseFontconfigFonts(output, Lang)
}
