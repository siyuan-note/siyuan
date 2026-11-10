// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ErrAutomaticHTTPObsolete = errors.New("automatic HTTP execution is obsolete")

type attributeViewHTTPOwner struct {
	app, session string
	connection   *melody.Session
}

type attributeViewHTTPAutomation struct {
	apicontract.AVHTTPAutomationJob
	boxID, version    string
	owner             *attributeViewHTTPOwner
	rules             map[string][]string
	expires           time.Time
	claimed, overflow bool
	cancel            context.CancelFunc
}

var attributeViewHTTPAutomations = struct {
	sync.Mutex
	jobs     map[string]*attributeViewHTTPAutomation
	active   map[string]string
	sequence int64
}{jobs: map[string]*attributeViewHTTPAutomation{}, active: map[string]string{}}

func (tx *Transaction) SetHTTPAutomationOwner(app, session string) {
	connection, _ := util.BindableInteractiveSession(app, session)
	if connection != nil {
		tx.httpAutomationOwner = &attributeViewHTTPOwner{app, session, connection}
	}
}

func (tx *Transaction) queueHTTPAutomation(source *attributeViewAutomationSource, rule *av.AutomationRule, item string) {
	if tx.httpAutomationOwner == nil || source.blockID == "" {
		return
	}
	if tx.pendingHTTPAutomations == nil {
		tx.pendingHTTPAutomations = map[string]*attributeViewHTTPAutomation{}
	}
	key := source.boxID + "/" + source.before.ID
	job := tx.pendingHTTPAutomations[key]
	if job == nil {
		job = &attributeViewHTTPAutomation{AVHTTPAutomationJob: apicontract.AVHTTPAutomationJob{AVID: source.before.ID, BlockID: source.blockID, BoxID: source.boxID},
			boxID: source.boxID, owner: tx.httpAutomationOwner, rules: map[string][]string{}}
		tx.pendingHTTPAutomations[key] = job
	}
	if slices.Contains(job.rules[rule.ID], item) {
		return
	}
	count := 0
	for _, items := range job.rules {
		count += len(items)
	}
	if count >= maxAutomationOperations {
		job.overflow = true
		return
	}
	job.rules[rule.ID] = append(job.rules[rule.ID], item)
}

func dropAttributeViewHTTPAutomation(job *attributeViewHTTPAutomation) {
	if job.cancel != nil {
		job.cancel()
	}
	delete(attributeViewHTTPAutomations.jobs, job.ID)
	key := job.boxID + "/" + job.AVID
	if attributeViewHTTPAutomations.active[key] == job.ID {
		delete(attributeViewHTTPAutomations.active, key)
	}
}

// 待执行记录只保存标识和摘要，不持有明文结果或笔记本租约。
func (tx *Transaction) commitHTTPAutomations(changed []string) {
	now := time.Now()
	versions := map[string]string{}
	version := func(job *attributeViewHTTPAutomation) string {
		key := job.boxID + "/" + job.AVID
		if value, exists := versions[key]; exists {
			return value
		}
		view, err := av.ParseAttributeViewForIndexInBox(job.AVID, job.boxID)
		value := ""
		if err == nil {
			value = attributeViewAutomationVersion(view)
		}
		versions[key] = value
		return value
	}
	for _, job := range tx.pendingHTTPAutomations {
		job.version = version(job)
	}
	attributeViewHTTPAutomations.Lock()
	var active []*attributeViewHTTPAutomation
	for _, job := range attributeViewHTTPAutomations.jobs {
		if slices.Contains(changed, job.AVID) {
			active = append(active, job)
		}
	}
	attributeViewHTTPAutomations.Unlock()
	for _, job := range active {
		version(job)
	}
	attributeViewHTTPAutomations.Lock()
	defer attributeViewHTTPAutomations.Unlock()
	for _, job := range attributeViewHTTPAutomations.jobs {
		if now.After(job.expires) {
			dropAttributeViewHTTPAutomation(job)
		}
	}
	for _, job := range tx.pendingHTTPAutomations {
		key := job.boxID + "/" + job.AVID
		if previous := attributeViewHTTPAutomations.jobs[attributeViewHTTPAutomations.active[key]]; previous != nil {
			count := 0
			for _, items := range job.rules {
				count += len(items)
			}
			for rule, items := range previous.rules {
				for _, item := range items {
					if slices.Contains(job.rules[rule], item) {
						continue
					}
					if count >= maxAutomationOperations {
						job.overflow = true
						break
					}
					job.rules[rule] = append(job.rules[rule], item)
					count++
				}
			}
			job.overflow = job.overflow || previous.overflow
			dropAttributeViewHTTPAutomation(previous)
		}
		for len(attributeViewHTTPAutomations.jobs) >= 128 {
			var oldest *attributeViewHTTPAutomation
			for _, candidate := range attributeViewHTTPAutomations.jobs {
				if oldest == nil || candidate.Sequence < oldest.Sequence {
					oldest = candidate
				}
			}
			dropAttributeViewHTTPAutomation(oldest)
		}
		attributeViewHTTPAutomations.sequence++
		job.ID, job.Sequence, job.expires = rand.Text(), attributeViewHTTPAutomations.sequence, now.Add(5*time.Minute)
		attributeViewHTTPAutomations.jobs[job.ID], attributeViewHTTPAutomations.active[key] = job, job.ID
		tx.httpAutomationJobs = append(tx.httpAutomationJobs, &job.AVHTTPAutomationJob)
	}
	for _, job := range attributeViewHTTPAutomations.jobs {
		if current, exists := versions[job.boxID+"/"+job.AVID]; exists && current != job.version &&
			tx.pendingHTTPAutomations[job.boxID+"/"+job.AVID] == nil &&
			(tx.storedAutomation == nil || tx.storedAutomation.jobID != job.ID) {
			dropAttributeViewHTTPAutomation(job)
		}
	}
	tx.pendingHTTPAutomations = nil
}

func (tx *Transaction) HTTPAutomationJobs() []*apicontract.AVHTTPAutomationJob {
	return tx.httpAutomationJobs
}

func ClaimAttributeViewHTTPAutomation(ctx context.Context, id, avID, blockID, app, session string) (*attributeViewHTTPAutomation, context.Context, func(), error) {
	connection, _ := util.BindableInteractiveSession(app, session)
	attributeViewHTTPAutomations.Lock()
	defer attributeViewHTTPAutomations.Unlock()
	job := attributeViewHTTPAutomations.jobs[id]
	if job == nil || job.claimed || time.Now().After(job.expires) {
		return nil, nil, nil, ErrAutomaticHTTPObsolete
	}
	if job.AVID != avID || job.BlockID != blockID ||
		job.owner.app != app || job.owner.session != session || connection == nil || connection != job.owner.connection {
		return nil, nil, nil, fmt.Errorf("automatic HTTP execution is unavailable")
	}
	job.claimed = true
	ctx, cancel := context.WithDeadline(ctx, job.expires)
	job.cancel = cancel
	finish := func() {
		attributeViewHTTPAutomations.Lock()
		defer attributeViewHTTPAutomations.Unlock()
		dropAttributeViewHTTPAutomation(job)
	}
	return job, ctx, finish, nil
}

func RunAttributeViewHTTPAutomation(ctx context.Context, job *attributeViewHTTPAutomation, runtime *TemplateHTTPExecution) (*Transaction, error) {
	var tx *Transaction
	err := runStoredAttributeViewAutomation(ctx, job.AVID, job.BlockID, "", runtime.Runtime, job, &tx)
	return tx, err
}
