package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/ocr"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// ImportOCRModels 使用固定目标文件名和内容摘要标识，不信任上传文件名或绝对路径。
func ImportOCRModels(ctx context.Context, files []*multipart.FileHeader) (string, error) {
	if len(files) != 4 {
		return "", errors.New("four OCR model files are required")
	}
	root := filepath.Join(util.DataDir, "ocr", "models")
	for _, directory := range []string{filepath.Dir(root), root} {
		if err := os.Mkdir(directory, 0755); err != nil && !os.IsExist(err) {
			return "", err
		}
		info, err := os.Lstat(directory)
		if err != nil {
			return "", err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("OCR models must use a workspace directory")
		}
	}
	if err := os.MkdirAll(util.TempDir, 0755); err != nil {
		return "", err
	}
	staging, err := os.MkdirTemp(util.TempDir, "ocr-import-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(staging)
	digest := sha256.New()
	for i, path := range []string{"det/inference.onnx", "det/inference.yml", "rec/inference.onnx", "rec/inference.yml"} {
		limit := int64(256 * 1024 * 1024)
		if strings.HasSuffix(path, ".yml") {
			limit = 1024 * 1024
		}
		if files[i] == nil || files[i].Size <= 0 || files[i].Size > limit {
			return "", errors.New("invalid OCR model file size")
		}
		source, openErr := files[i].Open()
		if openErr != nil {
			return "", openErr
		}
		destination := filepath.Join(staging, filepath.FromSlash(path))
		if err = os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
			source.Close()
			return "", err
		}
		target, createErr := os.Create(destination)
		if createErr != nil {
			source.Close()
			return "", createErr
		}
		digest.Write([]byte(path + "\x00"))
		count, copyErr := io.Copy(io.MultiWriter(target, digest), io.LimitReader(source, limit+1))
		source.Close()
		closeErr := target.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if count != files[i].Size || count > limit {
			return "", errors.New("invalid OCR model file size")
		}
	}
	if err = ocr.ValidateModels(staging); err != nil {
		return "", err
	}
	runtimeConfig := currentPaddleConfig()
	runtimeConfig.Directory = staging
	provider := &ocr.PaddleProvider{Config: func() ocr.PaddleConfig { return runtimeConfig }}
	defer provider.Close()
	if err = provider.Validate(ctx); err != nil {
		return "", err
	}
	id := hex.EncodeToString(digest.Sum(nil))
	destination := filepath.Join(root, id)
	if info, statErr := os.Lstat(destination); statErr == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("invalid OCR model directory")
		}
		return id, ocr.ValidateModels(destination)
	} else if !os.IsNotExist(statErr) {
		return "", statErr
	}
	if err = os.Rename(staging, destination); err != nil {
		return "", err
	}
	IncSyncIfNeeded(destination)
	return id, nil
}
