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
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

var (
	TesseractEnabled   bool
	AssetsTexts        = map[string]string{}
	AssetsTextsLock    = sync.Mutex{}
	AssetsTextsChanged = false

	TesseractLangs []string
)

func GetAssetText(asset string) string {
	AssetsTextsLock.Lock()
	ret, ok := AssetsTexts[asset]
	AssetsTextsLock.Unlock()
	if ok {
		return ret
	}

	assetsPath := GetDataAssetsAbsPath()
	assetAbsPath := strings.TrimPrefix(asset, "assets")
	assetAbsPath = filepath.Join(assetsPath, assetAbsPath)
	ret = Tesseract(assetAbsPath)
	AssetsTextsLock.Lock()
	AssetsTexts[asset] = ret
	AssetsTextsLock.Unlock()
	return ret
}

func Tesseract(imgAbsPath string) string {
	if ContainerStd != Container || !TesseractEnabled {
		return ""
	}

	info, err := os.Stat(imgAbsPath)
	if nil != err {
		return ""
	}

	defer logging.Recover()

	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()

	now := time.Now()
	cmd := exec.CommandContext(ctx, "tesseract", "-c", "debug_file=/dev/null", imgAbsPath, "stdout", "-l", strings.Join(TesseractLangs, "+"))
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
	ret = strings.ReplaceAll(ret, "\t", " ")
	reg := regexp.MustCompile("\\s{2,}")
	ret = reg.ReplaceAllString(ret, " ")
	logging.LogInfof("tesseract [path=%s, size=%d, text=%s, elapsed=%dms]", imgAbsPath, info.Size(), ret, time.Since(now).Milliseconds())
	msg := fmt.Sprintf("OCR [%s] [%s]", info.Name(), ret)
	PushStatusBar(msg)
	return ret
}

func initTesseract() {
	ver := getTesseractVer()
	if "" == ver {
		return
	}

	langs := getTesseractLangs()
	if 1 > len(langs) {
		logging.LogWarnf("no tesseract langs found")
		TesseractEnabled = false
		return
	}
	if !gulu.Str.Contains("eng", langs) {
		logging.LogWarnf("no eng tesseract lang found")
		return
	}
	if !gulu.Str.Contains("chi_sim", langs) {
		logging.LogWarnf("no chi_sim tesseract lang found")
		return
	}

	for _, lang := range langs {
		if "eng" == lang || "chi_sim" == lang {
			TesseractLangs = append(TesseractLangs, lang)
		}
	}
	logging.LogInfof("tesseract-ocr enabled [ver=%s, langs=%s]", ver, strings.Join(TesseractLangs, "+"))
}

func getTesseractVer() (ret string) {
	if ContainerStd != Container {
		return
	}

	cmd := exec.Command("tesseract", "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil == err && strings.HasPrefix(string(data), "tesseract ") {
		parts := bytes.Split(data, []byte("\n"))
		if 0 < len(parts) {
			ret = strings.TrimPrefix(string(parts[0]), "tesseract ")
			ret = strings.TrimSpace(ret)
			TesseractEnabled = true
		}
		return
	}
	return
}

func getTesseractLangs() (ret []string) {
	if !TesseractEnabled {
		return nil
	}

	cmd := exec.Command("tesseract", "--list-langs")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil != err {
		return nil
	}

	parts := bytes.Split(data, []byte("\n"))
	if 0 < len(parts) {
		parts = parts[1:]
	}
	for _, part := range parts {
		part = bytes.TrimSpace(part)
		if 0 == len(part) {
			continue
		}
		ret = append(ret, string(part))
	}
	return
}
