package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/88250/gulu"
	"github.com/gofrs/flock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func chatGPTAccountBindingIDs(ai *conf.AI) map[string]string {
	bindings := map[string]string{}
	if ai != nil {
		for _, provider := range ai.Providers {
			if provider != nil && provider.AuthType == "chatgpt" && provider.AccountID != "" {
				bindings[provider.ID] = provider.AccountID
			}
		}
	}
	return bindings
}

type chatGPTBindingFile struct {
	Exists bool   `json:"exists"`
	Data   []byte `json:"data"`
}

type chatGPTBindingJournal struct {
	Version int                  `json:"version"`
	Files   []chatGPTBindingFile `json:"files"`
}

func writeChatGPTBindingFile(path string, data []byte) error {
	return gulu.File.WriteFileSafer(path, data, 0600)
}

// writeChatGPTBindingConfiguration 在本机保存回滚日志，主配置字节保持原有凭据加密形式。
func writeChatGPTBindingConfiguration(bindingPath string, bindingData, configData []byte,
	write func(string, []byte) error) error {
	if err := recoverChatGPTBindingConfiguration(bindingPath); err != nil {
		return err
	}
	paths := []string{filepath.Join(util.ConfDir, "conf.json"), bindingPath}
	journal := chatGPTBindingJournal{Version: 1}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && !json.Valid(data) {
			return errors.New("invalid ChatGPT binding configuration file")
		}
		journal.Files = append(journal.Files, chatGPTBindingFile{Exists: err == nil, Data: data})
	}
	data, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	journalPath := bindingPath + ".pending"
	if err = writeChatGPTBindingFile(journalPath, data); err != nil {
		return err
	}
	rollback := func(cause error) error {
		if recoveryErr := recoverChatGPTBindingConfiguration(bindingPath); recoveryErr != nil {
			// 停止后续保存，保留日志供下次启动恢复，避免回滚覆盖稍后的配置。
			util.ReportFileSysFatalError(errors.Join(cause, recoveryErr))
		}
		return cause
	}
	for i, next := range [][]byte{configData, bindingData} {
		if err = write(paths[i], next); err != nil {
			return rollback(err)
		}
	}
	if err = os.Remove(journalPath); err != nil {
		return rollback(err)
	}
	return nil
}

// recoverChatGPTBindingConfiguration 只恢复两个固定路径；未知或损坏日志原样保留并报错。
func recoverChatGPTBindingConfiguration(bindingPath string) error {
	journalPath := bindingPath + ".pending"
	data, err := os.ReadFile(journalPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var journal chatGPTBindingJournal
	if err = json.Unmarshal(data, &journal); err != nil {
		return err
	}
	if journal.Version != 1 || len(journal.Files) != 2 {
		return errors.New("unsupported ChatGPT binding journal")
	}
	for _, original := range journal.Files {
		if original.Exists && !json.Valid(original.Data) || !original.Exists && len(original.Data) != 0 {
			return errors.New("invalid ChatGPT binding journal data")
		}
	}
	paths := []string{filepath.Join(util.ConfDir, "conf.json"), bindingPath}
	for i, original := range journal.Files {
		if original.Exists {
			err = writeChatGPTBindingFile(paths[i], original.Data)
		} else {
			err = os.Remove(paths[i])
			if os.IsNotExist(err) {
				err = nil
			}
		}
		if err != nil {
			return fmt.Errorf("restore ChatGPT binding configuration: %w", err)
		}
	}
	return os.Remove(journalPath)
}

// recoverChatGPTAccountBindings 在主配置加载前回滚中断的保存；没有日志时不创建本机文件。
func recoverChatGPTAccountBindings() error {
	path, err := util.ChatGPTService().BindingPath(util.WorkspaceDir)
	if err != nil {
		return err
	}
	if _, err = os.Stat(path + ".pending"); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	lock := flock.New(path + ".lock")
	locked, err := lock.TryLockContext(ctx, 50*time.Millisecond)
	if err != nil {
		return err
	}
	if !locked {
		return ctx.Err()
	}
	defer lock.Unlock()
	return recoverChatGPTBindingConfiguration(path)
}

// LoadChatGPTAccountBindings 用当前设备的工作空间绑定替换配置携带的账户引用，不迁移旧引用。
func LoadChatGPTAccountBindings(ai *conf.AI) error {
	if ai == nil {
		return nil
	}
	ai.ClearChatGPTAccountIDs()
	hasChatGPT := false
	for _, provider := range ai.Providers {
		if provider != nil && provider.AuthType == "chatgpt" {
			hasChatGPT = true
			break
		}
	}
	if !hasChatGPT {
		return nil
	}
	bindings, err := util.ChatGPTService().LoadBindings(util.WorkspaceDir)
	if err != nil {
		return err
	}
	for _, provider := range ai.Providers {
		if provider != nil && provider.AuthType == "chatgpt" {
			provider.AccountID = bindings[provider.ID]
		}
	}
	return nil
}
