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

type AgentInstructions struct {
	Content  string
	Revision string
}

func AgentInstructionsPath() string {
	return filepath.Join(DataDir, "ai", "AGENTS.md")
}

// 仅访问工作空间内的固定文件，拒绝链接和特殊文件，不创建读取时缺失的目录。
func openAgentInstructionsRoot(create bool) (*os.Root, error) {
	root, err := os.OpenRoot(DataDir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if create {
		if err = root.Mkdir("ai", 0755); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
	}
	info, err := root.Lstat("ai")
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("AGENTS.md storage is not a regular directory")
	}
	return root.OpenRoot("ai")
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
	root, err := openAgentInstructionsRoot(false)
	if errors.Is(err, os.ErrNotExist) {
		return AgentInstructions{Revision: "missing"}, nil
	}
	if err != nil {
		return AgentInstructions{}, err
	}
	defer root.Close()
	return readAgentInstructions(root)
}

// 修订校验和原子替换共用临界区，失败时保留原文；空内容同样是有效版本。
func SaveAgentInstructions(content, revision string) (AgentInstructions, error) {
	agentInstructionsLock.Lock()
	defer agentInstructionsLock.Unlock()
	if err := validateAgentInstructions(content); err != nil {
		return AgentInstructions{}, err
	}
	if revision == "" {
		return AgentInstructions{}, ErrAgentInstructionsConflict
	}
	root, err := openAgentInstructionsRoot(true)
	if err != nil {
		return AgentInstructions{}, err
	}
	defer root.Close()
	current, err := readAgentInstructions(root)
	if err != nil {
		return AgentInstructions{}, err
	}
	if current.Revision != revision {
		return AgentInstructions{}, ErrAgentInstructionsConflict
	}
	mode := os.FileMode(0644)
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
	if current.Revision != "missing" {
		err = file.Chmod(mode)
	}
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
