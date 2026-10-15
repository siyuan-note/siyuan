package model

import (
	"bytes"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type importedEmojiFile struct {
	source string
	target string
}

// importEmojiFiles 预检或复制包内表情，相同内容复用已有文件，内容冲突时保留源和目标并返回错误。
func importEmojiFiles(root string, checkOnly bool) (dirs []string, err error) {
	var files []importedEmojiFile
	err = filepath.WalkDir(root, func(p string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if p == root || !entry.IsDir() || entry.Name() != "emojis" {
			return nil
		}
		dirs = append(dirs, p)
		if err := filepath.WalkDir(p, func(source string, item fs.DirEntry, readErr error) error {
			if readErr != nil {
				return readErr
			}
			if item.IsDir() {
				return nil
			}
			if !item.Type().IsRegular() {
				return fmt.Errorf("import custom emoji [%s]: %w", source, fs.ErrInvalid)
			}
			relative, err := filepath.Rel(p, source)
			if err != nil {
				return err
			}
			parts := strings.Split(filepath.ToSlash(relative), "/")
			for i, part := range parts {
				if !util.IsValidExistingEmojiFileName(part) {
					parts[i] = util.FilterUploadEmojiFileName(part)
				}
			}
			files = append(files, importedEmojiFile{source: source, target: filepath.Join(util.DataDir, "emojis", filepath.Join(parts...))})
			return nil
		}); err != nil {
			return err
		}
		return fs.SkipDir
	})
	if err != nil {
		return
	}
	for _, file := range files {
		if err = importEmojiFile(file.source, file.target, checkOnly); err != nil {
			return
		}
	}
	return
}

func existingImportedEmoji(target string, data []byte) (exists bool, err error) {
	info, err := os.Lstat(target)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return true, fmt.Errorf("import custom emoji [%s]: %w", target, os.ErrExist)
	}
	existing, err := os.ReadFile(target)
	if err != nil {
		return true, err
	}
	if !bytes.Equal(existing, data) {
		return true, fmt.Errorf("import custom emoji [%s]: different content: %w", target, os.ErrExist)
	}
	return true, nil
}

func importEmojiFile(source, target string, checkOnly bool) error {
	data, err := filelock.ReadFile(source)
	if err != nil {
		return err
	}
	filelock.Lock(target)
	defer filelock.Unlock(target)
	if exists, err := existingImportedEmoji(target, data); err != nil || exists || checkOnly {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if os.IsExist(err) {
		if exists, checkErr := existingImportedEmoji(target, data); exists {
			return checkErr
		}
	}
	if err != nil {
		return err
	}
	info, _ := file.Stat()
	_, err = file.Write(data)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil && info != nil {
		if current, statErr := os.Lstat(target); statErr == nil && os.SameFile(info, current) {
			_ = os.Remove(target)
		}
	}
	return err
}
