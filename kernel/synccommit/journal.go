// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	intentVersion     = 2
	receiptVersion    = 1
	maxJournalBytes   = int64(64 * 1024 * 1024)
	maxIntentChanges  = 100_000
	receiptRetention  = 24 * time.Hour
	contentHashPrefix = "sha256:"
)

type Intent struct {
	Version   int            `json:"version"`
	SessionID string         `json:"sessionId"`
	Owner     string         `json:"owner,omitempty"`
	Changes   []IntentChange `json:"changes"`
}

type IntentChange struct {
	Operation   Operation `json:"operation"`
	Path        string    `json:"path"`
	TargetName  string    `json:"targetName"`
	StagedName  string    `json:"stagedName,omitempty"`
	BackupName  string    `json:"backupName,omitempty"`
	Size        int64     `json:"size,omitempty"`
	Hash        string    `json:"hash,omitempty"`
	IfNoneMatch bool      `json:"ifNoneMatch,omitempty"`
}

func journalRoot() string                 { return filepath.Join(util.TempDir, "kernel-sync") }
func intentDir() string                   { return filepath.Join(journalRoot(), "wal") }
func receiptDir() string                  { return filepath.Join(journalRoot(), "receipts") }
func IntentPath(sessionID string) string  { return filepath.Join(intentDir(), sessionID+".json") }
func receiptPath(sessionID string) string { return filepath.Join(receiptDir(), sessionID+".json") }

func validSessionID(sessionID string) bool {
	if len(sessionID) != 48 {
		return false
	}
	decoded, err := hex.DecodeString(sessionID)
	return err == nil && len(decoded) == 24 && strings.ToLower(sessionID) == sessionID
}

func writeJSONDurable(dir, finalPath, prefix string, value any) (renamed bool, err error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return false, err
	}
	if int64(len(encoded)) > maxJournalBytes {
		return false, errors.New("kernel sync journal is too large")
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return false, err
	}
	temporary, err := os.CreateTemp(dir, prefix)
	if err != nil {
		return false, err
	}
	temporaryPath := temporary.Name()
	keep := false
	defer func() {
		_ = temporary.Close()
		if !keep {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err = temporary.Chmod(0600); err == nil {
		_, err = temporary.Write(encoded)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return false, err
	}
	if err = MoveFile(temporaryPath, finalPath, true); err != nil {
		return false, err
	}
	keep = true
	return true, syncDirectory(dir)
}

func syncDirectory(dir string) error {
	directory, err := os.Open(dir)
	if err != nil {
		if runtime.GOOS == "windows" {
			return nil
		}
		return err
	}
	err = directory.Sync()
	closeErr := directory.Close()
	if runtime.GOOS == "windows" {
		return nil
	}
	return errors.Join(err, closeErr)
}

func readJSONStrict(path string, value any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > maxJournalBytes {
		return errors.New("invalid kernel sync journal file")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, maxJournalBytes+1))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(value); err != nil {
		return err
	}
	var trailing any
	if err = decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("kernel sync journal contains trailing data")
		}
		return err
	}
	return nil
}

func writeIntent(intent Intent) (string, bool, error) {
	if err := validateIntent(intent); err != nil {
		return "", false, err
	}
	path := IntentPath(intent.SessionID)
	renamed, err := writeJSONDurable(intentDir(), path, ".intent-", intent)
	return path, renamed, err
}

func readIntent(path string) (Intent, error) {
	var intent Intent
	if err := readJSONStrict(path, &intent); err != nil {
		return Intent{}, err
	}
	if filepath.Base(path) != intent.SessionID+".json" {
		return Intent{}, errors.New("intent filename does not match session")
	}
	return intent, validateIntent(intent)
}

func validateIntent(intent Intent) error {
	if (intent.Version != 1 && intent.Version != intentVersion) || !validSessionID(intent.SessionID) ||
		len(intent.Changes) == 0 || len(intent.Changes) > maxIntentChanges {
		return errors.New("invalid kernel sync intent header")
	}
	if intent.Version >= intentVersion && (intent.Owner == "" || len(intent.Owner) > 256) {
		return errors.New("invalid kernel sync intent owner")
	}
	seen := map[string]struct{}{}
	for _, change := range intent.Changes {
		if change.Path == "" || change.TargetName == "" || filepath.Base(change.TargetName) != change.TargetName {
			return errors.New("invalid kernel sync intent path")
		}
		if change.BackupName != "" && !validSiblingName(change.BackupName, ".siyuan-sync-backup-") {
			return errors.New("invalid kernel sync intent backup")
		}
		if _, exists := seen[change.Path]; exists {
			return errors.New("duplicate kernel sync intent path")
		}
		seen[change.Path] = struct{}{}
		switch change.Operation {
		case OperationWrite:
			if !validSiblingName(change.StagedName, ".siyuan-stage-") || change.Size < 0 || !validContentHash(change.Hash) {
				return errors.New("invalid kernel sync intent write")
			}
		case OperationDelete:
			if change.StagedName != "" {
				return errors.New("invalid kernel sync intent deletion")
			}
		default:
			return errors.New("invalid kernel sync intent operation")
		}
	}
	return nil
}

func validSiblingName(name, prefix string) bool {
	if len(name) != len(prefix)+32+len(".tmp") || !strings.HasPrefix(name, prefix) ||
		!strings.HasSuffix(name, ".tmp") || filepath.Base(name) != name {
		return false
	}
	random := strings.TrimSuffix(strings.TrimPrefix(name, prefix), ".tmp")
	decoded, err := hex.DecodeString(random)
	return err == nil && len(decoded) == 16 && random == strings.ToLower(random)
}

func validContentHash(hash string) bool {
	if len(hash) != len(contentHashPrefix)+sha256.Size*2 || !strings.HasPrefix(hash, contentHashPrefix) {
		return false
	}
	decoded, err := hex.DecodeString(strings.TrimPrefix(hash, contentHashPrefix))
	return err == nil && len(decoded) == sha256.Size && hash == strings.ToLower(hash)
}

func writeReceipt(receipt Receipt) (bool, error) {
	if receipt.Version != receiptVersion || !validSessionID(receipt.SessionID) || receipt.Generation == 0 || receipt.CommittedAt.IsZero() {
		return false, errors.New("invalid kernel sync receipt")
	}
	return writeJSONDurable(receiptDir(), receiptPath(receipt.SessionID), ".receipt-", receipt)
}

func LookupReceipt(sessionID, owner string) (Receipt, bool) {
	if !validSessionID(sessionID) {
		return Receipt{}, false
	}
	var receipt Receipt
	if err := readJSONStrict(receiptPath(sessionID), &receipt); err != nil {
		return Receipt{}, false
	}
	if receipt.Version != receiptVersion || receipt.SessionID != sessionID || receipt.Owner != owner ||
		receipt.CommittedAt.Before(time.Now().Add(-receiptRetention)) {
		return Receipt{}, false
	}
	return receipt, true
}

func retireIntent(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func listIntentPaths() ([]string, error) {
	entries, err := os.ReadDir(intentDir())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			paths = append(paths, filepath.Join(intentDir(), entry.Name()))
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func pruneReceipts(now time.Time) error {
	entries, err := os.ReadDir(receiptDir())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr == nil && info.ModTime().Before(now.Add(-receiptRetention)) {
			if removeErr := os.Remove(filepath.Join(receiptDir(), entry.Name())); removeErr != nil && !os.IsNotExist(removeErr) {
				return fmt.Errorf("remove expired receipt %s: %w", entry.Name(), removeErr)
			}
		}
	}
	return nil
}
