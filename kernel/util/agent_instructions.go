// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/88250/lute/ast"
)

const MaxAgentInstructionsSize = 32 * 1024

var agentInstructionsLock sync.Mutex
var ErrAgentInstructionsTooLarge = errors.New("AGENTS.md must be at most 32 KiB")
var ErrAgentInstructionsConflict = errors.New("AGENTS.md changed; reload it before saving")
var ErrAgentInstructionsLocationConflict = errors.New("data/ai/AGENTS.md and data/storage/ai/AGENTS.md differ; merge the files and remove the old file")

type AgentInstructions struct {
	Content  string
	Revision string
}

func AgentInstructionsPath() string {
	return filepath.Join(DataDir, "storage", "ai", "AGENTS.md")
}

func LegacyAgentInstructionsPath() string {
	return filepath.Join(DataDir, "ai", "AGENTS.md")
}

// 仅访问工作空间内的固定文件，拒绝链接和特殊文件，不创建读取时缺失的目录。
func openAgentInstructionsRoot(create, legacy bool) (*os.Root, error) {
	root, err := os.OpenRoot(DataDir)
	if err != nil {
		return nil, err
	}
	parts := []string{"storage", "ai"}
	if legacy {
		parts = []string{"ai"}
	}
	for _, part := range parts {
		if create {
			if err = root.Mkdir(part, 0755); err != nil && !errors.Is(err, os.ErrExist) {
				root.Close()
				return nil, err
			}
		}
		info, statErr := root.Lstat(part)
		if statErr != nil {
			root.Close()
			return nil, statErr
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			root.Close()
			return nil, errors.New("AGENTS.md storage is not a regular directory")
		}
		next, openErr := root.OpenRoot(part)
		root.Close()
		if openErr != nil {
			return nil, openErr
		}
		root = next
	}
	return root, nil
}

func validateAgentInstructions(content string) error {
	if len(content) > MaxAgentInstructionsSize {
		return ErrAgentInstructionsTooLarge
	}
	return validateManagedSkillSource(content)
}

func readAgentInstructions(root *os.Root) (AgentInstructions, error) {
	ret := AgentInstructions{Revision: "missing"}
	info, err := root.Lstat("AGENTS.md")
	if errors.Is(err, os.ErrNotExist) {
		return ret, nil
	}
	if err != nil {
		return ret, err
	}
	if !info.Mode().IsRegular() {
		return ret, errors.New("AGENTS.md is not a regular file")
	}
	if info.Size() > MaxAgentInstructionsSize {
		return ret, ErrAgentInstructionsTooLarge
	}
	file, err := root.Open("AGENTS.md")
	if err != nil {
		return ret, err
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, MaxAgentInstructionsSize+1))
	if err != nil {
		return ret, err
	}
	if err = validateAgentInstructions(string(content)); err != nil {
		return ret, err
	}
	return AgentInstructions{Content: string(content), Revision: fmt.Sprintf("%x", sha256.Sum256(content))}, nil
}

func ReadAgentInstructions() (AgentInstructions, error) {
	agentInstructionsLock.Lock()
	defer agentInstructionsLock.Unlock()
	return readCompatibleAgentInstructions()
}

func readAgentInstructionsLocation(legacy bool) (AgentInstructions, error) {
	root, err := openAgentInstructionsRoot(false, legacy)
	if errors.Is(err, os.ErrNotExist) {
		return AgentInstructions{Revision: "missing"}, nil
	}
	if err != nil {
		return AgentInstructions{}, err
	}
	defer root.Close()
	return readAgentInstructions(root)
}

// 兼容读取不迁移文件，保留只读模式及读取接口无写入的约定。
func readCompatibleAgentInstructions() (AgentInstructions, error) {
	current, err := readAgentInstructionsLocation(false)
	if err != nil {
		return AgentInstructions{}, err
	}
	legacy, err := readAgentInstructionsLocation(true)
	if err != nil {
		return AgentInstructions{}, err
	}
	if current.Revision == "missing" {
		return legacy, nil
	}
	if legacy.Revision != "missing" && legacy.Revision != current.Revision {
		return AgentInstructions{}, ErrAgentInstructionsLocationConflict
	}
	return current, nil
}

// 修订校验和原子替换共用临界区，失败时保留原文；空内容同样是有效版本。
// migrated 标识迁移已写入新位置或移除旧文件，供调用者在部分失败时也通知同步。
func SaveAgentInstructions(content, revision string) (saved AgentInstructions, migrated bool, err error) {
	agentInstructionsLock.Lock()
	defer agentInstructionsLock.Unlock()
	if err := validateAgentInstructions(content); err != nil {
		return AgentInstructions{}, false, err
	}
	if revision == "" {
		return AgentInstructions{}, false, ErrAgentInstructionsConflict
	}
	current, err := readCompatibleAgentInstructions()
	if err != nil {
		return AgentInstructions{}, false, err
	}
	if current.Revision != revision {
		return AgentInstructions{}, false, ErrAgentInstructionsConflict
	}
	root, err := openAgentInstructionsRoot(true, false)
	if err != nil {
		return AgentInstructions{}, false, err
	}
	defer root.Close()
	canonical, err := readAgentInstructions(root)
	if err != nil {
		return AgentInstructions{}, false, err
	}
	// 先在新位置持久保存旧版原文，再移除旧文件，最后写入用户修改。
	// 中途失败时至少保留一份完整原文；相同的双文件状态可安全重试。
	if canonical.Revision == "missing" && current.Revision != "missing" {
		legacyRoot, openErr := openAgentInstructionsRoot(false, true)
		if openErr != nil {
			return AgentInstructions{}, false, openErr
		}
		info, statErr := legacyRoot.Stat("AGENTS.md")
		legacyRoot.Close()
		if statErr != nil {
			return AgentInstructions{}, false, statErr
		}
		if _, err = writeAgentInstructions(root, current.Content, "missing", info.Mode().Perm()); err != nil {
			return AgentInstructions{}, false, err
		}
		migrated = true
	}
	if _, err = readCompatibleAgentInstructions(); err != nil {
		return AgentInstructions{}, migrated, err
	}
	removed, err := removeLegacyAgentInstructions(revision)
	migrated = migrated || removed
	if err != nil {
		return AgentInstructions{}, migrated, err
	}
	saved, err = writeAgentInstructions(root, content, revision, 0644)
	return saved, migrated, err
}

func removeLegacyAgentInstructions(revision string) (bool, error) {
	root, err := openAgentInstructionsRoot(false, true)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer root.Close()
	current, err := readAgentInstructions(root)
	if err != nil || current.Revision == "missing" {
		return false, err
	}
	if current.Revision != revision {
		return false, ErrAgentInstructionsConflict
	}
	err = root.Remove("AGENTS.md")
	return err == nil, err
}

func writeAgentInstructions(root *os.Root, content, revision string, mode os.FileMode) (AgentInstructions, error) {
	current, err := readAgentInstructions(root)
	if err != nil {
		return AgentInstructions{}, err
	}
	if current.Revision != revision {
		return AgentInstructions{}, ErrAgentInstructionsConflict
	}
	if current.Revision != "missing" {
		info, statErr := root.Stat("AGENTS.md")
		if statErr != nil {
			return AgentInstructions{}, statErr
		}
		mode = info.Mode().Perm()
	}
	name := ".agents-" + ast.NewNodeID()
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return AgentInstructions{}, err
	}
	defer root.Remove(name)
	// 保留用户为已有文件设置的访问权限。
	err = file.Chmod(mode)
	if err == nil {
		_, err = file.WriteString(content)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return AgentInstructions{}, err
	}
	if closeErr != nil {
		return AgentInstructions{}, closeErr
	}
	current, err = readAgentInstructions(root)
	if err != nil {
		return AgentInstructions{}, err
	}
	if current.Revision != revision {
		return AgentInstructions{}, ErrAgentInstructionsConflict
	}
	if err = root.Rename(name, "AGENTS.md"); err != nil {
		return AgentInstructions{}, err
	}
	return AgentInstructions{Content: content, Revision: fmt.Sprintf("%x", sha256.Sum256([]byte(content)))}, nil
}

func AgentInstructionsError(err error, language string) string {
	key := ""
	switch {
	case errors.Is(err, ErrAgentInstructionsTooLarge):
		key = "agentInstructionsTooLarge"
	case errors.Is(err, ErrAgentInstructionsConflict):
		key = "agentInstructionsConflict"
	case errors.Is(err, ErrAgentInstructionsLocationConflict):
		key = "agentInstructionsLocationConflict"
	case errors.Is(err, ErrSkillEncoding):
		key = "agentSkillEncodingTip"
	case errors.Is(err, ErrSkillBinary):
		key = "agentSkillBinaryTip"
	}
	if key != "" {
		if message := I18nTerm(language, key); strings.TrimSpace(message) != "" {
			return "AGENTS.md: " + message
		}
	}
	return "AGENTS.md: " + err.Error()
}
