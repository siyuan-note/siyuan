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
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	"github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/logging"
)

var (
	tesseractEnabled   bool
	assetsTexts        = map[string]string{}
	assetsTextsLock    = sync.Mutex{}
	assetsTextsChanged = false
)

func GetAssetText(asset string) string {
	assetsTextsLock.Lock()
	ret, ok := assetsTexts[asset]
	assetsTextsLock.Unlock()
	if ok {
		return ret
	}

	assetsPath := GetDataAssetsAbsPath()
	assetAbsPath := strings.TrimPrefix(asset, "assets")
	assetAbsPath = filepath.Join(assetsPath, assetAbsPath)
	ret = Tesseract(assetAbsPath)
	assetsTextsLock.Lock()
	assetsTexts[asset] = ret
	assetsTextsLock.Unlock()
	return ret
}

func Tesseract(imgAbsPath string) string {
	if ContainerStd != Container || !tesseractEnabled {
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
	ret = strings.ReplaceAll(ret, "\t", " ")
	reg := regexp.MustCompile("\\s{2,}")
	ret = reg.ReplaceAllString(ret, " ")
	logging.LogInfof("tesseract [path=%s, size=%d, text=%s, elapsed=%dms]", imgAbsPath, info.Size(), ret, time.Since(now).Milliseconds())
	return ret
}

func AutoOCRAssets() {
	if !tesseractEnabled {
		return
	}

	for {
		assetsPath := GetDataAssetsAbsPath()
		assets := getUnOCRAssetsAbsPaths()

		waitGroup := &sync.WaitGroup{}
		lock := &sync.Mutex{}
		p, _ := ants.NewPoolWithFunc(4, func(arg interface{}) {
			defer waitGroup.Done()

			assetAbsPath := arg.(string)
			text := Tesseract(assetAbsPath)
			p := strings.TrimPrefix(assetAbsPath, assetsPath)
			p = "assets" + filepath.ToSlash(p)
			lock.Lock()
			assetsTexts[p] = text
			lock.Unlock()
			assetsTextsChanged = true
		})
		for _, assetAbsPath := range assets {
			waitGroup.Add(1)
			p.Invoke(assetAbsPath)
		}
		waitGroup.Wait()
		p.Release()

		time.Sleep(7 * time.Second)
	}
}

func getUnOCRAssetsAbsPaths() (ret []string) {
	assetsPath := GetDataAssetsAbsPath()
	var assetsPaths []string
	filepath.Walk(assetsPath, func(path string, info os.FileInfo, err error) error {
		name := info.Name()
		if info.IsDir() {
			if strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}

		lowerName := strings.ToLower(name)
		if !strings.HasSuffix(lowerName, ".png") && !strings.HasSuffix(lowerName, ".jpg") && !strings.HasSuffix(lowerName, ".jpeg") {
			return nil
		}

		assetsPaths = append(assetsPaths, path)
		return nil
	})

	assetsTextsTmp := assetsTexts
	for _, absPath := range assetsPaths {
		p := strings.TrimPrefix(absPath, assetsPath)
		p = "assets" + filepath.ToSlash(p)
		if _, ok := assetsTextsTmp[p]; ok {
			continue
		}
		ret = append(ret, absPath)
	}
	return
}

func AutoFlushAssetsTexts() {
	for {
		SaveAssetsTexts()
		time.Sleep(7 * time.Second)
	}
}

func LoadAssetsTexts() {
	assetsPath := GetDataAssetsAbsPath()
	assetsTextsPath := filepath.Join(assetsPath, "ocr-texts.json")
	if !gulu.File.IsExist(assetsTextsPath) {
		return
	}

	start := time.Now()
	var err error
	fh, err := os.OpenFile(assetsTextsPath, os.O_RDWR, 0644)
	if nil != err {
		logging.LogErrorf("open assets texts failed: %s", err)
		return
	}
	defer fh.Close()

	data, err := io.ReadAll(fh)
	if nil != err {
		logging.LogErrorf("read assets texts failed: %s", err)
		return
	}

	assetsTextsLock.Lock()
	if err = gulu.JSON.UnmarshalJSON(data, &assetsTexts); nil != err {
		logging.LogErrorf("unmarshal assets texts failed: %s", err)
		if err = os.RemoveAll(assetsTextsPath); nil != err {
			logging.LogErrorf("removed corrupted assets texts failed: %s", err)
		}
		return
	}
	assetsTextsLock.Unlock()
	debug.FreeOSMemory()

	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("read assets texts [%s] to [%s], elapsed [%.2fs]", humanize.Bytes(uint64(len(data))), assetsTextsPath, elapsed)
	}
	return
}

func SaveAssetsTexts() {
	if !assetsTextsChanged {
		return
	}

	start := time.Now()

	assetsTextsLock.Lock()
	data, err := gulu.JSON.MarshalIndentJSON(assetsTexts, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal assets texts failed: %s", err)
		return
	}
	assetsTextsLock.Unlock()

	assetsPath := GetDataAssetsAbsPath()
	assetsTextsPath := filepath.Join(assetsPath, "ocr-texts.json")
	if err = gulu.File.WriteFileSafer(assetsTextsPath, data, 0644); nil != err {
		logging.LogErrorf("write assets texts failed: %s", err)
		return
	}
	debug.FreeOSMemory()

	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("save assets texts [size=%s] to [%s], elapsed [%.2fs]", humanize.Bytes(uint64(len(data))), assetsTextsPath, elapsed)
	}

	assetsTextsChanged = false
}

func initTesseract() {
	ver := getTesseractVer()
	if "" == ver {
		return
	}

	logging.LogInfof("tesseract-ocr enabled [ver=%s]", ver)
}

func getTesseractVer() (ret string) {
	if ContainerStd != Container {
		return
	}

	cmd := exec.Command("tesseract", "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil != err {
		logging.LogWarnf("tesseract-ocr not found: %s", err)
	}
	logging.LogWarnf("tesseract --version: %s", string(data))
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
