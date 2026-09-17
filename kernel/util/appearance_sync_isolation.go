package util

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/siyuan-note/filelock"
)

const appearanceIsolationMarker = "# siyuan-appearance-isolation:"
const appearanceIsolationClockName = ".appearance-syncignore-clock-v1"
const maxAppearanceIsolationSecond int64 = (1<<63 - 1) / 1000

type appearanceIsolationClock struct {
	Version  int   `json:"version"`
	Modified int64 `json:"modified"`
}

var appearanceIsolationBlock = []string{
	appearanceIsolationMarker + "v1:begin",
	"/themes/",
	"/icons/",
	"/storage/bazaar/themes/",
	"/storage/bazaar/icons/",
	appearanceIsolationMarker + "v1:end",
}

// EnsureAppearanceSyncIsolation 在生成本地外观目录前持久化旧引擎可识别的隔离规则；调用方不能持有外观锁。
func EnsureAppearanceSyncIsolation() error {
	rulePath := filepath.Join(DataDir, ".siyuan", "syncignore")
	filelock.Lock(rulePath)
	defer filelock.Unlock(rulePath)

	original, info, err := readAppearanceIsolationRules(rulePath)
	if err != nil {
		return err
	}
	updated, err := updateAppearanceIsolationRules(original)
	if err != nil {
		return err
	}
	if bytes.Equal(original, updated) {
		if _, err = reserveAppearanceIsolationTime(rulePath, info, false); err != nil {
			return err
		}
		return syncAppearanceIsolationDirectory(filepath.Dir(rulePath))
	}
	if err = os.MkdirAll(filepath.Dir(rulePath), 0755); err != nil {
		return err
	}
	if err = syncAppearanceIsolationDirectory(filepath.Dir(filepath.Dir(rulePath))); err != nil {
		return err
	}
	if err = writeAppearanceIsolationRules(rulePath, original, updated, info); err != nil {
		return err
	}
	return nil
}

// AppearanceUserSyncIgnoreLines 仅移除完整的受管规则，保留用户自行编写的同名规则及其顺序。
func AppearanceUserSyncIgnoreLines(lines []string) ([]string, error) {
	ranges, err := appearanceIsolationRanges(lines)
	if err != nil {
		return nil, err
	}
	ret := make([]string, 0, len(lines))
	start := 0
	for _, block := range ranges {
		ret = append(ret, lines[start:block[0]]...)
		start = block[1]
	}
	return append(ret, lines[start:]...), nil
}

func appearanceIsolationRanges(lines []string) ([][2]int, error) {
	var ret [][2]int
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSuffix(lines[i], "\r")
		if i == 0 {
			line = strings.TrimPrefix(line, "\ufeff")
		}
		if !strings.HasPrefix(line, appearanceIsolationMarker) {
			continue
		}
		if line != appearanceIsolationBlock[0] || len(lines)-i < len(appearanceIsolationBlock) {
			return nil, errors.New("unsupported or incomplete appearance sync isolation block")
		}
		for j, expected := range appearanceIsolationBlock {
			actual := strings.TrimSuffix(lines[i+j], "\r")
			if i+j == 0 {
				actual = strings.TrimPrefix(actual, "\ufeff")
			}
			if actual != expected {
				return nil, fmt.Errorf("invalid appearance sync isolation block at line %d", i+j+1)
			}
		}
		ret = append(ret, [2]int{i, i + len(appearanceIsolationBlock)})
		i += len(appearanceIsolationBlock) - 1
	}
	return ret, nil
}

func updateAppearanceIsolationRules(original []byte) ([]byte, error) {
	rawLines := bytes.SplitAfter(original, []byte("\n"))
	lines := make([]string, len(rawLines))
	for i, raw := range rawLines {
		lines[i] = string(bytes.TrimSuffix(raw, []byte("\n")))
	}
	ranges, err := appearanceIsolationRanges(lines)
	if err != nil {
		return nil, err
	}
	var updated []byte
	start := 0
	for _, block := range ranges {
		updated = append(updated, bytes.Join(rawLines[start:block[0]], nil)...)
		start = block[1]
	}
	updated = append(updated, bytes.Join(rawLines[start:], nil)...)
	if bytes.HasPrefix(original, []byte("\xef\xbb\xbf")) && !bytes.HasPrefix(updated, []byte("\xef\xbb\xbf")) {
		updated = append([]byte("\xef\xbb\xbf"), updated...)
	}
	newline := "\n"
	if bytes.Contains(original, []byte("\r\n")) {
		newline = "\r\n"
	}
	if len(updated) != 0 && updated[len(updated)-1] != '\n' {
		updated = append(updated, newline...)
	}
	updated = append(updated, strings.Join(appearanceIsolationBlock, newline)...)
	return append(updated, newline...), nil
}

func readAppearanceIsolationRules(rulePath string) ([]byte, os.FileInfo, error) {
	info, err := os.Lstat(rulePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, nil, errors.New("appearance sync isolation requires a regular syncignore file")
	}
	data, err := os.ReadFile(rulePath)
	return data, info, err
}

func writeAppearanceIsolationRules(rulePath string, original, updated []byte, previous os.FileInfo) error {
	modified, err := reserveAppearanceIsolationTime(rulePath, previous, true)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(rulePath), ".appearance-syncignore-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	defer temp.Close()
	if _, err = temp.Write(updated); err != nil {
		return err
	}
	mode := os.FileMode(0644)
	if previous != nil {
		mode = previous.Mode().Perm()
	}
	if err = temp.Chmod(mode); err != nil {
		return err
	}
	if err = os.Chtimes(tempPath, modified, modified); err != nil {
		return err
	}
	if err = temp.Sync(); err != nil {
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	current, info, err := readAppearanceIsolationRules(rulePath)
	if err != nil {
		return err
	}
	if !bytes.Equal(current, original) || (previous == nil) != (info == nil) ||
		(previous != nil && (!os.SameFile(previous, info) || !previous.ModTime().Equal(info.ModTime()))) {
		return errors.New("syncignore changed while preparing appearance isolation")
	}
	if err = os.Rename(tempPath, rulePath); err != nil {
		return err
	}
	return syncAppearanceIsolationDirectory(filepath.Dir(rulePath))
}

// reserveAppearanceIsolationTime 先持久预留秒数，规则快照还原或时钟回退后也不会复用本机已发布的旧文件标识。
func reserveAppearanceIsolationTime(rulePath string, previous os.FileInfo, advance bool) (time.Time, error) {
	clockPath := filepath.Join(filepath.Dir(rulePath), appearanceIsolationClockName)
	data, info, err := readAppearanceIsolationRules(clockPath)
	if err != nil {
		return time.Time{}, err
	}
	clock := appearanceIsolationClock{Version: 1}
	if info != nil {
		clock.Version = 0
		decoder := json.NewDecoder(bytes.NewReader(data))
		start, tokenErr := decoder.Token()
		if tokenErr != nil || start != json.Delim('{') {
			return time.Time{}, errors.New("invalid appearance isolation clock")
		}
		seen := map[string]bool{}
		for decoder.More() {
			token, fieldErr := decoder.Token()
			name, ok := token.(string)
			if fieldErr != nil || !ok || seen[name] {
				return time.Time{}, errors.New("invalid appearance isolation clock fields")
			}
			seen[name] = true
			switch name {
			case "version":
				err = decoder.Decode(&clock.Version)
			case "modified":
				err = decoder.Decode(&clock.Modified)
			default:
				return time.Time{}, errors.New("unsupported appearance isolation clock field")
			}
			if err != nil {
				return time.Time{}, err
			}
		}
		end, tokenErr := decoder.Token()
		if tokenErr != nil || end != json.Delim('}') || !seen["version"] || !seen["modified"] ||
			clock.Version != 1 || clock.Modified <= 0 || clock.Modified >= maxAppearanceIsolationSecond {
			return time.Time{}, errors.New("unsupported or invalid appearance isolation clock")
		}
		if err = decoder.Decode(new(interface{})); err != io.EOF {
			return time.Time{}, errors.New("invalid trailing appearance isolation clock data")
		}
	}
	seconds := clock.Modified
	if previous != nil && previous.ModTime().Unix() > seconds {
		seconds = previous.ModTime().Unix()
	}
	if advance || info == nil {
		if now := time.Now().Unix(); now > seconds {
			seconds = now
		}
	}
	if advance {
		seconds++
	}
	if seconds <= 0 || seconds >= maxAppearanceIsolationSecond {
		return time.Time{}, errors.New("invalid appearance isolation timestamp")
	}
	if info != nil && seconds == clock.Modified {
		return time.Unix(seconds, 0), nil
	}
	clock.Modified = seconds
	data, err = json.Marshal(clock)
	if err != nil {
		return time.Time{}, err
	}
	temp, err := os.CreateTemp(filepath.Dir(rulePath), ".appearance-clock-*.tmp")
	if err != nil {
		return time.Time{}, err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	defer temp.Close()
	if _, err = temp.Write(data); err != nil {
		return time.Time{}, err
	}
	if err = temp.Sync(); err != nil {
		return time.Time{}, err
	}
	if err = temp.Close(); err != nil {
		return time.Time{}, err
	}
	if err = os.Rename(tempPath, clockPath); err != nil {
		return time.Time{}, err
	}
	if err = syncAppearanceIsolationDirectory(filepath.Dir(rulePath)); err != nil {
		return time.Time{}, err
	}
	return time.Unix(seconds, 0), nil
}

func syncAppearanceIsolationDirectory(directory string) error {
	if runtime.GOOS != "windows" {
		dir, openErr := os.Open(directory)
		if openErr != nil {
			return openErr
		}
		defer dir.Close()
		if err := dir.Sync(); err != nil {
			return err
		}
	}
	return nil
}
