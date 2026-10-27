// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	cmd := exec.CommandContext(ctx, path, "-f", fontconfigListFormat)
	cmd.WaitDelay = 2 * time.Second
	output, err := cmd.Output()
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
