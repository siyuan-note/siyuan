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

package util

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type legacyFont struct {
	directory   string
	file        string
	replacement string
	hashes      map[string]string
}

// 历史文件校验值来自仓库中的发行资源；1.0.3 和 1.311 取自提交 1ca0fbce9b 的父提交。
// LICENSE 按 LF 换行校验，以兼容不同平台的源码检出方式。
var legacyFonts = []legacyFont{
	{"JetBrainsMono-1.0.3", "JetBrainsMono-Regular.woff", "JetBrainsMono-2.304/JetBrainsMono-Regular.woff2", map[string]string{
		"JetBrainsMono-Regular.woff": "018579ddf1ed49dc710b4012e460bf53b50cb1c57937ad0190e049231158d4f9",
		"LICENSE":                    "dfbd64f8a465680b035eb2dc7326e4fa039ebab1d6b435ef05b39114abfb2699",
	}},
	{"LxgwWenKai-Lite-1.311", "LXGWWenKaiLite-Regular.ttf", "LxgwWenKaiGB-Lite-1.521/LXGWWenKaiGBLite-Regular.ttf", map[string]string{
		"LXGWWenKaiLite-Regular.ttf": "5426d47684418aa3876b4b14535c2572e1deeaae84d7d42ee9b817114edcfd55",
		"LICENSE":                    "6c9731e86205ff7b0b18dfa14d45442b61315576e660c3c7c32298a9a94fe52f",
	}},
	{"LxgwWenKai-Lite-1.501", "LXGWWenKaiLite-Regular.ttf", "LxgwWenKaiGB-Lite-1.521/LXGWWenKaiGBLite-Regular.ttf", map[string]string{
		"LXGWWenKaiLite-Regular.ttf": "ea08d142772c60fb2e7c396213302e55762680ded7fb20f9a9f5a6b352d2bcfe",
		"LICENSE":                    "ba5b13c50f860d8eae2342c334c062775f352f637b25870151a6cac35006383c",
	}},
	{"Noto-COLRv1-2.047", "Noto-COLRv1.woff2", "Noto-COLRv1-2.051/Noto-COLRv1.woff2", map[string]string{
		"Noto-COLRv1.woff2": "adb7c3f25f5c6bbf511fcf5e2d03e657e935f468e4b38eff5f010a7d3ba01449",
		"LICENSE":           "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2",
	}},
}

// LegacyFontReplacement 返回已知旧字体 URL 对应的新资源路径，仅用于旧文件缺失时的兼容读取。
func LegacyFontReplacement(relativePath string) string {
	for _, font := range legacyFonts {
		if relativePath == "fonts/"+font.directory+"/"+font.file {
			return "fonts/" + font.replacement
		}
	}
	return ""
}

// CleanupLegacyFonts 在新版资源复制成功后清理原版历史字体，不递归删除目录或跟随符号链接。
func CleanupLegacyFonts(appearanceRoot string) error {
	for _, directory := range []string{appearanceRoot, filepath.Join(appearanceRoot, "fonts")} {
		info, err := os.Lstat(directory)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
	}
	for _, font := range legacyFonts {
		if err := cleanupLegacyFont(filepath.Join(appearanceRoot, "fonts"), font); err != nil {
			return err
		}
	}
	return nil
}

func cleanupLegacyFont(root string, font legacyFont) error {
	// 新字体及所在目录必须已经可用，避免清理后没有可用的替代资源。
	parts := strings.Split(font.replacement, "/")
	for i := range parts {
		info, err := os.Lstat(filepath.Join(append([]string{root}, parts[:i+1]...)...))
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || (i < len(parts)-1 && !info.IsDir()) ||
			(i == len(parts)-1 && (!info.Mode().IsRegular() || info.Size() == 0)) {
			return nil
		}
	}
	directory := filepath.Join(root, font.directory)
	info, err := os.Lstat(directory)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		expected, known := font.hashes[entry.Name()]
		if !known || !entry.Type().IsRegular() {
			return nil
		}
		matches, matchErr := matchesLegacyFontFile(filepath.Join(directory, entry.Name()), entry.Name(), expected)
		if matchErr != nil {
			return matchErr
		}
		if !matches {
			return nil
		}
	}
	// 全部校验通过才删除已知文件；中断后可继续处理剩余文件，新加入的文件阻止目录删除。
	for _, entry := range entries {
		if err = os.Remove(filepath.Join(directory, entry.Name())); err != nil {
			return err
		}
	}
	return os.Remove(directory)
}

func matchesLegacyFontFile(path, name, expected string) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer file.Close()
	hash := sha256.New()
	if name == "LICENSE" {
		// 原版许可证不足 8 KiB，限制读取大小以保留异常文件并避免启动时占用过多内存。
		data, readErr := io.ReadAll(io.LimitReader(file, 8193))
		if readErr != nil {
			return false, readErr
		}
		if len(data) > 8192 {
			return false, nil
		}
		hash.Write(bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n")))
	} else if _, err = io.Copy(hash, file); err != nil {
		return false, err
	}
	return fmt.Sprintf("%x", hash.Sum(nil)) == expected, nil
}
