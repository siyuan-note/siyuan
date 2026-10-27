// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package chatgpt

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gofrs/flock"
)

type accountBindings struct {
	Version   int               `json:"version"`
	Providers map[string]string `json:"providers"`
}

// BindingPath 返回按本机工作空间路径隔离的绑定文件，供主配置与绑定的可恢复提交使用。
func (s *Service) BindingPath(workspace string) (string, error) {
	if workspace == "" {
		return "", errors.New("ChatGPT account binding requires a workspace")
	}
	path, err := filepath.Abs(workspace)
	if err != nil {
		return "", err
	}
	if resolved, resolveErr := filepath.EvalSymlinks(path); resolveErr == nil {
		path = resolved
	}
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	digest := sha256.Sum256([]byte(filepath.Clean(path)))
	return filepath.Join(s.dir, "bindings", hex.EncodeToString(digest[:])+".json"), nil
}

func readAccountBindings(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var saved accountBindings
	if err = json.Unmarshal(data, &saved); err != nil {
		return nil, err
	}
	if saved.Version != 1 || saved.Providers == nil {
		return nil, errors.New("unsupported ChatGPT account binding format")
	}
	return saved.Providers, nil
}

// LoadBindings 读取原子写入的本机绑定，不加载或刷新登录凭证。
func (s *Service) LoadBindings(workspace string) (map[string]string, error) {
	path, err := s.BindingPath(workspace)
	if err != nil {
		return nil, err
	}
	return readAccountBindings(path)
}

// SaveBindings 在进程间加锁后替换当前工作空间的绑定；损坏或未知格式保留原文件并报错。
func (s *Service) SaveBindings(ctx context.Context, workspace string, providers map[string]string) error {
	return s.UpdateBindings(ctx, workspace, providers, atomicWrite)
}

// UpdateBindings 在绑定锁内校验原文件，将写入交给调用方协调主配置提交；回调返回前不释放锁。
func (s *Service) UpdateBindings(ctx context.Context, workspace string, providers map[string]string,
	persist func(string, []byte) error) error {
	path, err := s.BindingPath(workspace)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	lock := flock.New(path + ".lock")
	locked, err := lock.TryLockContext(ctx, 50*time.Millisecond)
	if err != nil {
		return err
	}
	if !locked {
		return ctx.Err()
	}
	defer lock.Unlock()
	if _, err = readAccountBindings(path); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if providers == nil {
		providers = map[string]string{}
	}
	data, err := json.Marshal(accountBindings{Version: 1, Providers: providers})
	if err != nil {
		return err
	}
	return persist(path, data)
}
