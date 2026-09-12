// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package flashcard

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type presetDailyUsage struct {
	newCards    int
	reviewCards int
}

type presetDailyBudget struct {
	usage    map[string]presetDailyUsage
	reviewed map[string]struct{}
	presets  map[string]SchedulerPreset
}

// StudyDayOptions 保存当前查询时刻及客户端本地复习日界。
type StudyDayOptions struct {
	Now            int64 `json:"now,omitempty"`
	ReviewDayStart int64 `json:"reviewDayStart,omitempty"`
	ReviewDayEnd   int64 `json:"reviewDayEnd,omitempty"`
}

// reviewDayBounds 使用调用方的本地日界，未提供时按内核本地日历计算，兼容夏令时切换。
func reviewDayBounds(now, start, end int64) (int64, int64, error) {
	if start == 0 && end == 0 {
		local := time.UnixMilli(now).In(time.Local)
		day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
		return day.UnixMilli(), day.AddDate(0, 0, 1).UnixMilli(), nil
	}
	if start > now || end <= now || end-start < int64(23*time.Hour/time.Millisecond) ||
		end-start > int64(25*time.Hour/time.Millisecond) {
		return 0, 0, errors.New("flashcard review day boundaries are invalid")
	}
	return start, end, nil
}

// dailyPresetBudget 按当天首次有效正常评分计算用量，不为缺少原状态的导入历史推测新卡类别。
func (projection *Projection) dailyPresetBudget(ctx context.Context, start, end int64) (*presetDailyBudget, error) {
	undone, err := projection.undoneReviewEventIDs(ctx, "")
	if err != nil {
		return nil, err
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT review.event_id, review.card_id,
		COALESCE(preset.entity_id, ''), review.before_state
		FROM review_events review
		LEFT JOIN entity_revisions preset ON preset.revision_id = review.preset_revision_id
			AND preset.entity_type = ?
		WHERE review.reviewed_at >= ? AND review.reviewed_at < ?
			AND review.kind = 'review' AND review.review_mode = 'normal'
		ORDER BY review.reviewed_at, review.event_id`, EntitySchedulerPreset, start, end)
	if err != nil {
		return nil, fmt.Errorf("query flashcard daily preset usage: %w", err)
	}
	defer rows.Close()
	budget := &presetDailyBudget{usage: map[string]presetDailyUsage{}, reviewed: map[string]struct{}{},
		presets: map[string]SchedulerPreset{}}
	for rows.Next() {
		var eventID, cardID, presetID string
		var beforePayload []byte
		if err = rows.Scan(&eventID, &cardID, &presetID, &beforePayload); err != nil {
			return nil, fmt.Errorf("scan flashcard daily preset usage: %w", err)
		}
		if _, found := undone[eventID]; found {
			continue
		}
		if _, found := budget.reviewed[cardID]; found {
			continue
		}
		if len(beforePayload) == 0 || presetID == "" {
			continue
		}
		var before ReviewStateSnapshot
		if err = decodeStrictJSON(beforePayload, &before); err != nil {
			return nil, err
		}
		budget.reviewed[cardID] = struct{}{}
		usage := budget.usage[presetID]
		if before.State == "new" {
			usage.newCards++
		} else {
			usage.reviewCards++
		}
		budget.usage[presetID] = usage
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate flashcard daily preset usage: %w", err)
	}
	return budget, nil
}

func (budget *presetDailyBudget) selectCard(ctx context.Context, projection *Projection,
	cardID, presetID, state string) (bool, error) {
	if _, found := budget.reviewed[cardID]; found {
		return true, nil
	}
	preset, found := budget.presets[presetID]
	if !found {
		revision, exists, err := projection.CurrentEntity(ctx, EntitySchedulerPreset, presetID)
		if err != nil {
			return false, err
		}
		if !exists || revision.Deleted {
			return false, fmt.Errorf("%w: scheduler preset [%s]", ErrEntityNotFound, presetID)
		}
		if err = decodeStrictJSON(revision.Payload, &preset); err != nil {
			return false, err
		}
		budget.presets[presetID] = preset
	}
	usage := budget.usage[presetID]
	if state == "new" {
		if usage.newCards >= preset.NewLimit {
			return false, nil
		}
		usage.newCards++
	} else {
		if usage.reviewCards >= preset.ReviewLimit {
			return false, nil
		}
		usage.reviewCards++
	}
	budget.usage[presetID] = usage
	return true, nil
}

func (projection *Projection) limitStudyQueueByPreset(ctx context.Context, results []CardSearchResult,
	start, end int64) ([]CardSearchResult, error) {
	budget, err := projection.dailyPresetBudget(ctx, start, end)
	if err != nil {
		return nil, err
	}
	selected := make([]CardSearchResult, 0, len(results))
	for _, result := range results {
		allowed, selectErr := budget.selectCard(ctx, projection, result.Card.ID, result.EffectivePresetID,
			result.ReviewState.State)
		if selectErr != nil {
			return nil, selectErr
		}
		if allowed {
			selected = append(selected, result)
		}
	}
	return selected, nil
}

// SessionQueueAt 根据当前日额度临时隐藏超限卡，保留持久会话顺序，使撤销后可以重新出卡。
func (projection *Projection) SessionQueueAt(ctx context.Context, sessionID string,
	options StudyDayOptions) ([]SessionQueueCard, error) {
	now := options.Now
	if now <= 0 {
		return nil, errors.New("flashcard session queue time is invalid")
	}
	queue, err := projection.SessionQueue(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	revision, found, err := projection.CurrentEntity(ctx, EntityStudySession, sessionID)
	if err != nil {
		return nil, err
	}
	if !found || revision.Deleted {
		return nil, ErrEntityNotFound
	}
	var session StudySession
	if err = decodeStrictJSON(revision.Payload, &session); err != nil {
		return nil, err
	}
	if session.ReviewMode != "normal" || session.Status != "active" {
		return queue, nil
	}
	start, end := options.ReviewDayStart, options.ReviewDayEnd
	if start == 0 && end == 0 && now >= session.ReviewDayStart && now < session.ReviewDayEnd {
		start, end = session.ReviewDayStart, session.ReviewDayEnd
	}
	start, end, err = reviewDayBounds(now, start, end)
	if err != nil {
		return nil, err
	}
	budget, err := projection.dailyPresetBudget(ctx, start, end)
	if err != nil {
		return nil, err
	}
	eligible, err := projection.eligibleSessionCards(ctx, queue, now)
	if err != nil {
		return nil, err
	}
	for index := range queue {
		item := &queue[index]
		if item.SessionCard.Status == "reviewed" {
			current, available := eligible[item.Card.ID]
			if !available {
				continue
			}
			repeat, repeatErr := projection.canRepeatSessionCard(ctx, item.SessionCard, current.ReviewState)
			if repeatErr != nil {
				return nil, repeatErr
			}
			if !repeat {
				continue
			}
			allowed, selectErr := budget.selectCard(ctx, projection, item.Card.ID, current.EffectivePresetID,
				current.ReviewState.State)
			if selectErr != nil {
				return nil, selectErr
			}
			if allowed {
				item.RepeatDue = current.ReviewState.Due
			}
			continue
		}
		if item.SessionCard.Status != "queued" && item.SessionCard.Status != "shown" {
			continue
		}
		current, available := eligible[item.Card.ID]
		if !available || current.ReviewState.Due > now ||
			(item.SessionCard.StateRevisionID != "" && item.SessionCard.StateRevisionID != current.ReviewState.StateRevisionID) {
			item.SessionCard.Status = "skipped"
			item.SessionCard.SkipReason = "no-longer-eligible"
			continue
		}
		allowed, selectErr := budget.selectCard(ctx, projection, item.Card.ID, current.EffectivePresetID,
			current.ReviewState.State)
		if selectErr != nil {
			return nil, selectErr
		}
		if !allowed {
			item.SessionCard.Status = "skipped"
			item.SessionCard.SkipReason = "preset-daily-limit"
		}
	}
	return queue, nil
}

func (projection *Projection) eligibleSessionCards(ctx context.Context, queue []SessionQueueCard,
	now int64) (map[string]CardSearchResult, error) {
	cardIDs := make([]string, 0, len(queue))
	for _, item := range queue {
		if item.SessionCard.Status == "queued" || item.SessionCard.Status == "shown" || item.SessionCard.Status == "reviewed" {
			cardIDs = append(cardIDs, item.Card.ID)
		}
	}
	return projection.eligibleCardsByID(ctx, cardIDs, now)
}

func (projection *Projection) eligibleCardsByID(ctx context.Context, cardIDs []string,
	now int64) (map[string]CardSearchResult, error) {
	ret := make(map[string]CardSearchResult, len(cardIDs))
	for offset := 0; offset < len(cardIDs); offset += 500 {
		end := min(offset+500, len(cardIDs))
		value, err := CanonicalJSON(cardIDs[offset:end])
		if err != nil {
			return nil, err
		}
		query := QueryAST{Version: QueryVersion, Root: QueryExpression{Operator: QueryPredicate,
			Field: "cardID", Comparator: QueryIn, Value: value}}
		results, err := projection.SearchCards(ctx, &query, CardSearchOptions{Now: now})
		if err != nil {
			return nil, err
		}
		for _, result := range results {
			ret[result.Card.ID] = result
		}
	}
	return ret, nil
}
