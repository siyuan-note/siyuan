// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// PDF 资源只按最终页面中的链接导出，记录本次创建项以便失败时逐项回滚。
type pdfExportAssets struct {
	directory string
	boxID     string
	files     map[string]string
	created   []pdfExportAsset
}

type pdfExportAsset struct {
	path string
	info os.FileInfo
}

func pdfAssetSourceURI(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	asset := strings.TrimPrefix(u.Path, "/export/temp/")
	asset = strings.TrimPrefix(asset, "/")
	if !strings.HasPrefix(asset, "assets/") {
		return "", fmt.Errorf("invalid PDF asset link: %s", raw)
	}
	if u.RawQuery != "" {
		asset += "?" + u.RawQuery
	}
	return asset, nil
}

func (exported *pdfExportAssets) record(p string) error {
	info, err := os.Lstat(p)
	if err == nil {
		exported.created = append(exported.created, pdfExportAsset{p, info})
	}
	return err
}

func (exported *pdfExportAssets) rollback() {
	for i := len(exported.created) - 1; i >= 0; i-- {
		created := exported.created[i]
		if info, err := os.Lstat(created.path); err == nil && os.SameFile(info, created.info) {
			// 目录仅在为空时删除，保留其他导出或用户后来写入的文件。
			_ = os.Remove(created.path)
		}
	}
}

func (exported *pdfExportAssets) copy(sourceURI string) (string, error) {
	source, err := GetAssetAbsPathInBox(sourceURI, exported.boxID)
	if err != nil {
		return "", err
	}
	if result, ok := exported.files[source]; ok {
		return result, nil
	}
	info, err := os.Stat(source)
	if err != nil {
		return "", err
	}
	if !info.IsDir() && !info.Mode().IsRegular() {
		return "", fmt.Errorf("PDF asset is not a regular file: %s", source)
	}
	if err = os.Mkdir(exported.directory, 0755); err == nil {
		if err = exported.record(exported.directory); err != nil {
			return "", err
		}
	} else if !os.IsExist(err) {
		return "", err
	}
	rootInfo, err := os.Lstat(exported.directory)
	if err != nil {
		return "", err
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("PDF assets destination is not a regular directory: %s", exported.directory)
	}
	name := filepath.Base(AssetPathWithoutQuery(sourceURI))
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	var target string
	var output *os.File
	for n := 0; ; n++ {
		candidate := name
		if n > 0 {
			candidate = stem + "-" + strconv.Itoa(n) + ext
		}
		target = filepath.Join(exported.directory, candidate)
		if info.IsDir() {
			err = os.Mkdir(target, 0755)
		} else {
			output, err = os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		}
		if os.IsExist(err) {
			continue
		}
		if err != nil {
			if _, existsErr := os.Lstat(target); existsErr == nil {
				continue
			}
			return "", err
		}
		break
	}
	if err = exported.record(target); err != nil {
		if output != nil {
			_ = output.Close()
		}
		return "", err
	}
	if info.IsDir() {
		err = filepath.WalkDir(source, func(p string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil || p == source {
				return walkErr
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("symbolic link in PDF asset directory: %s", p)
			}
			relative, relErr := filepath.Rel(source, p)
			if relErr != nil {
				return relErr
			}
			dest := filepath.Join(target, relative)
			if entry.IsDir() {
				if mkdirErr := os.Mkdir(dest, 0755); mkdirErr != nil {
					return mkdirErr
				}
				return exported.record(dest)
			}
			file, createErr := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
			if createErr != nil {
				return createErr
			}
			if recordErr := exported.record(dest); recordErr != nil {
				_ = file.Close()
				return recordErr
			}
			return copyPDFAssetBytes(p, "", exported.boxID, file)
		})
	} else {
		err = copyPDFAssetBytes(source, sourceURI, exported.boxID, output)
	}
	if err != nil {
		return "", err
	}
	result := (&url.URL{Path: "assets/" + filepath.Base(target)}).String()
	if exported.files == nil {
		exported.files = map[string]string{}
	}
	exported.files[source] = result
	return result, nil
}

func copyPDFAssetBytes(source, sourceURI, boxID string, output *os.File) (err error) {
	defer func() {
		if closeErr := output.Close(); err == nil {
			err = closeErr
		}
	}()
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("PDF asset is not a regular file: %s", source)
	}
	var input io.Reader
	if IsEncryptedAssetPath(source) {
		plain, readErr := readAssetBytesInBox(boxID, sourceURI, false)
		if readErr != nil {
			return readErr
		}
		defer clear(plain)
		input = bytes.NewReader(plain)
	} else {
		file, openErr := os.Open(source)
		if openErr != nil {
			return openErr
		}
		defer file.Close()
		input = file
	}
	_, err = io.Copy(output, input)
	return err
}
