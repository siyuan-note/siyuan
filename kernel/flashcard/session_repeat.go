// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package flashcard

import "context"

// canRepeatSessionCard 仅允许当前会话产生的学习排期回队，其他会话或管理操作产生的排期不继承。
// 回队资格从已认证的持久修订推导，读取队列不改写状态，保留撤销评分所需的修订链。
func (projection *Projection) canRepeatSessionCard(ctx context.Context, card SessionCard, state ReviewState) (bool, error) {
	if card.Status != "reviewed" || (state.State != "learning" && state.State != "relearning") || state.Due <= 0 {
		return false, nil
	}
	var sameBatch bool
	err := projection.db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM entities current
		JOIN entity_revisions session_revision ON session_revision.revision_id = current.revision_id
		JOIN entity_revisions state_revision ON state_revision.batch_id = session_revision.batch_id
		WHERE current.entity_type = ? AND current.entity_id = ? AND current.deleted = 0
		AND state_revision.revision_id = ? AND state_revision.entity_type = ? AND state_revision.entity_id = ?
	)`, EntitySessionCard, card.ID, state.StateRevisionID, EntityReviewState, card.CardID).Scan(&sameBatch)
	return sameBatch, err
}
