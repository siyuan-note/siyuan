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
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

var (
	TesseractBin       = "tesseract"
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

func IsTesseractExtractable(p string) bool {
	lowerName := strings.ToLower(p)
	return strings.HasSuffix(lowerName, ".png") || strings.HasSuffix(lowerName, ".jpg") || strings.HasSuffix(lowerName, ".jpeg")
}

func Tesseract(imgAbsPath string) string {
	if ContainerStd != Container || !TesseractEnabled {
		return ""
	}

	defer logging.Recover()

	if !IsTesseractExtractable(imgAbsPath) {
		return ""
	}

	info, err := os.Stat(imgAbsPath)
	if nil != err {
		return ""
	}

	defer logging.Recover()

	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, TesseractBin, "-c", "debug_file=/dev/null", imgAbsPath, "stdout", "-l", strings.Join(TesseractLangs, "+"))
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
	ret = gulu.Str.RemoveInvisible(ret)
	ret = RemoveRedundantSpace(ret)
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

	TesseractLangs = filterTesseractLangs(langs)
	logging.LogInfof("tesseract-ocr enabled [ver=%s, langs=%s]", ver, strings.Join(TesseractLangs, "+"))
}

func filterTesseractLangs(langs []string) (ret []string) {
	ret = []string{}

	envLangsVal := os.Getenv("SIYUAN_TESSERACT_LANGS")
	if "" != envLangsVal {
		envLangs := strings.Split(envLangsVal, "+")
		for _, lang := range langs {
			if gulu.Str.Contains(lang, envLangs) {
				ret = append(ret, lang)
			}
		}
	} else {
		for _, lang := range langs {
			if "eng" == lang || strings.HasPrefix(lang, "chi") || "fra" == lang || "spa" == lang || "deu" == lang ||
				"rus" == lang || "osd" == lang {
				ret = append(ret, lang)
			}
		}
	}
	return ret
}

func getTesseractVer() (ret string) {
	if ContainerStd != Container {
		return
	}

	cmd := exec.Command(TesseractBin, "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil != err {
		if strings.Contains(err.Error(), "executable file not found") {
			// macOS 端 Tesseract OCR 安装后不识别 https://github.com/siyuan-note/siyuan/issues/7107
			TesseractBin = "/usr/local/bin/tesseract"
			cmd = exec.Command(TesseractBin, "--version")
			gulu.CmdAttr(cmd)
			data, err = cmd.CombinedOutput()
		}
	}
	if nil != err {
		return
	}

	if strings.HasPrefix(string(data), "tesseract ") {
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

	cmd := exec.Command(TesseractBin, "--list-langs")
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
