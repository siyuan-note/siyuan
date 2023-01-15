// SiYuan - Build Your Eternal Digital Garden
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
	"bytes"
	"context"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/dgraph-io/ristretto"
	"github.com/siyuan-note/logging"
)

var tesseractEnabled bool

func initTesseract() {
	ver := getTesseractVer()
	if "" == ver {
		return
	}

	logging.LogInfof("tesseract-ocr enabled [ver=%s]", ver)
}

func getTesseractVer() (ret string) {
	cmd := exec.Command("tesseract", "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil == err && strings.HasPrefix(string(data), "tesseract v") {
		parts := bytes.Split(data, []byte("\n"))
		if 0 < len(parts) {
			ret = strings.TrimPrefix(string(parts[0]), "tesseract ")
			ret = strings.TrimSpace(ret)
			tesseractEnabled = true
		}
		return
	}
	return
}

var ocrResultCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 100000,
	MaxCost:     1000 * 1000 * 64,
	BufferItems: 64,
})

func Tesseract(imgAbsPath string) string {
	if ContainerStd != Container || !tesseractEnabled {
		return ""
	}

	info, err := os.Stat(imgAbsPath)
	if nil != err {
		return ""
	}

	cached, ok := ocrResultCache.Get(imgAbsPath)
	if ok {
		return cached.(string)
	}

	defer logging.Recover()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "tesseract", "-c", "debug_file=/dev/null", imgAbsPath, "stdout", "-l", "chi_sim+eng")
	gulu.CmdAttr(cmd)
	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		logging.LogWarnf("tesseract [path=%s, size=%d] timeout", imgAbsPath, info.Size())
		return ""
	}

	if nil != err {
		logging.LogWarnf("tesseract [path=%s, size=%d] failed: %s", imgAbsPath, info.Size(), err)
		return ""
	}

	ret := string(output)
	ret = strings.ReplaceAll(ret, "\r", "")
	ret = strings.ReplaceAll(ret, "\n", "")
	logging.LogInfof("tesseract [path=%s, size=%d]: %s", imgAbsPath, info.Size(), ret)
	ocrResultCache.Set(imgAbsPath, ret, info.Size())
	return ret
}
