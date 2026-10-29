// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package memo 管理工作空间长期记忆的文件状态，不包含模型调用或权限推断。
package memo

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const MaxFileSize = 128 * 1024
const MaxResults = 200

var ErrConflict = errors.New("memory revision conflict")
var ErrWithdrawn = errors.New("memory has been withdrawn")
var ErrInvalid = errors.New("invalid memory data")
var ErrIncomplete = errors.New("memory scan incomplete")
var idPattern = regexp.MustCompile(`^[0-9]{14}-[a-z0-9]{7}$`)

type Source struct {
	Kind     string `yaml:"kind" json:"kind"`
	ID       string `yaml:"id" json:"id"`
	Revision string `yaml:"revision" json:"revision"`
	Evidence string `yaml:"evidence,omitempty" json:"evidence,omitempty"`
}
type Record struct {
	Schema     int      `yaml:"schema" json:"schema"`
	ID         string   `yaml:"id" json:"id"`
	Kind       string   `yaml:"kind" json:"kind"`
	Subject    string   `yaml:"subject" json:"subject"`
	Scope      string   `yaml:"scope" json:"scope"`
	State      string   `yaml:"state" json:"state"`
	Sources    []Source `yaml:"sources" json:"sources"`
	Created    string   `yaml:"created" json:"created"`
	Updated    string   `yaml:"updated" json:"updated"`
	Confirmed  string   `yaml:"confirmed,omitempty" json:"confirmed,omitempty"`
	ValidFrom  string   `yaml:"validFrom,omitempty" json:"validFrom,omitempty"`
	ValidUntil string   `yaml:"validUntil,omitempty" json:"validUntil,omitempty"`
	Reason     string   `yaml:"reason,omitempty" json:"reason,omitempty"`
	Supersedes string   `yaml:"supersedes,omitempty" json:"supersedes,omitempty"`
	Operations []string `yaml:"operations" json:"operations"`
	// 授权引用只由明确重新记住操作写入，自动整理不得伪造。
	Authorizations []string `yaml:"authorizations,omitempty" json:"authorizations,omitempty"`
	Content        string   `yaml:"-" json:"content"`
}
type Entry struct {
	Record   Record `json:"record"`
	Revision string `json:"revision"`
}
type SearchOptions struct {
	Terms, Scopes, States   []string
	Limit, Offset           int
	IncludeInactiveValidity bool
}
type SearchResult struct {
	Entries    []Entry  `json:"entries"`
	Incomplete bool     `json:"incomplete"`
	Errors     []string `json:"errors"`
}
type Snapshot struct {
	Entries     []Entry
	Fingerprint string
	Partial     bool
	RecordCount int
}
type Projection struct {
	Content     string `json:"content"`
	Fingerprint string `json:"fingerprint"`
}
type ForgetResult struct {
	ID             string `json:"id"`
	WithdrawalID   string `json:"withdrawalId"`
	CleanupPending bool   `json:"cleanupPending"`
}
type withdrawal struct {
	Schema    int      `yaml:"schema"`
	ID        string   `yaml:"id"`
	Target    string   `yaml:"target"`
	Sources   []Source `yaml:"sources"`
	Operation string   `yaml:"operation"`
	Created   string   `yaml:"created"`
	// 仅保存旧写入身份的摘要，阻止延迟重试被误当成新的显式授权。
	// JSON 省略空值，保持旧撤回文件已有授权摘要兼容。
	OperationHashes []string `yaml:"operationHashes,omitempty" json:",omitempty"`
}

func NewID() string {
	b := make([]byte, 7)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return time.Now().UTC().Format("20060102150405") + "-" + string(b)
}
func revision(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func contains(values []string, s string) bool {
	for _, v := range values {
		if v == s {
			return true
		}
	}
	return false
}
func validateRecord(r Record) error {
	if r.Schema != 1 || !idPattern.MatchString(r.ID) || strings.TrimSpace(r.Content) == "" || r.Subject == "" || r.Scope == "" || r.Kind == "" || len(r.Sources) == 0 || len(r.Operations) == 0 {
		return ErrInvalid
	}
	if !contains([]string{"candidate", "active", "review", "disabled", "superseded"}, r.State) {
		return ErrInvalid
	}
	for _, op := range r.Operations {
		if op == "" || len(op) > 256 {
			return ErrInvalid
		}
	}
	for _, authorization := range r.Authorizations {
		if len(authorization) != 64 {
			return ErrInvalid
		}
		if _, err := hex.DecodeString(authorization); err != nil {
			return ErrInvalid
		}
	}
	for _, s := range r.Sources {
		if s.Kind == "" || s.ID == "" || s.Revision == "" {
			return ErrInvalid
		}
	}
	for _, v := range []string{r.Created, r.Updated, r.Confirmed, r.ValidFrom, r.ValidUntil} {
		if v != "" {
			if _, err := time.Parse(time.RFC3339Nano, v); err != nil {
				return fmt.Errorf("%w: timestamp", ErrInvalid)
			}
		}
	}
	if r.Created == "" || r.Updated == "" || (r.Supersedes != "" && !idPattern.MatchString(r.Supersedes)) {
		return ErrInvalid
	}
	return nil
}

// Usable 校验事实状态与有效期；调用方仍需校验来源权限及撤回状态。
func Usable(r Record) bool {
	if r.State != "active" {
		return false
	}
	now := time.Now().UTC()
	if r.ValidFrom != "" {
		t, _ := time.Parse(time.RFC3339Nano, r.ValidFrom)
		if now.Before(t) {
			return false
		}
	}
	if r.ValidUntil != "" {
		t, _ := time.Parse(time.RFC3339Nano, r.ValidUntil)
		if !now.Before(t) {
			return false
		}
	}
	return true
}
func checkContext(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
