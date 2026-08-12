// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package flashcard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// LegacyQuickCard 是旧 riff API 可以无歧义表示的单块快速卡。
type LegacyQuickCard struct {
	Card            Card        `json:"card"`
	ReviewState     ReviewState `json:"reviewState"`
	BlockID         string      `json:"blockID"`
	SourcePriority  string      `json:"sourcePriority"`
	DefaultPresetID string      `json:"defaultPresetID"`
}

// LegacyReviewSetInfo 保存旧卡包与新版复习集的显式映射。
type LegacyReviewSetInfo struct {
	DeckID      string `json:"deckID"`
	ReviewSetID string `json:"reviewSetID"`
	Name        string `json:"name"`
	Size        int    `json:"size"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// LegacyQuickSchemaID 返回迁移快速卡使用的内置卡型 ID。
func LegacyQuickSchemaID() string {
	return legacyQuickSchemaID
}

// LegacyQuickTemplateID 返回迁移快速卡使用的内置模板 ID。
func LegacyQuickTemplateID() string {
	return legacyQuickTemplateID
}

// LegacyPresetID 返回迁移快速卡使用的默认预设 ID。
func LegacyPresetID() string {
	return legacyPresetID
}

// LegacyReviewSetID 返回旧卡包对应的稳定复习集 ID。
func LegacyReviewSetID(deckID string) string {
	return DeterministicID("legacy-review-set", deckID)
}

// LegacyQuickSourceID 返回一个块对应的稳定快速卡源 ID。
func LegacyQuickSourceID(blockID string) string {
	return DeterministicID("legacy-card-source", blockID)
}

// LegacyQuickCardID 返回一个块对应的稳定快速卡 ID。
func LegacyQuickCardID(blockID string) string {
	sourceID := LegacyQuickSourceID(blockID)
	return GeneratedCardID(sourceID, legacyQuickTemplateID, "legacy-quick")
}

// LegacyQuickCards 返回旧卡包中仍启用的单块快速卡，空卡包 ID 表示全部旧复习集。
func (projection *Projection) LegacyQuickCards(ctx context.Context, deckID string) ([]LegacyQuickCard, error) {
	args := []any{EntityCard, EntityReviewState, legacyQuickTemplateID, GenerationActive}
	membershipClause := ""
	if deckID != "" {
		membershipClause = ` AND EXISTS (SELECT 1 FROM review_set_memberships m
			WHERE m.review_set_id = ? AND m.card_id = c.id AND m.mode = ?)
			AND NOT EXISTS (SELECT 1 FROM review_set_memberships m
			WHERE m.review_set_id = ? AND m.card_id = c.id AND m.mode = ?)`
		reviewSetID := LegacyReviewSetID(deckID)
		args = append(args, reviewSetID, MembershipInclude, reviewSetID, MembershipExclude)
	} else {
		membershipClause = ` AND EXISTS (SELECT 1 FROM review_set_memberships m JOIN review_sets rs
			ON rs.id = m.review_set_id WHERE m.card_id = c.id AND m.mode = ? AND rs.legacy_deck_id <> '')`
		args = append(args, MembershipInclude)
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT ce.payload, se.payload, r.entity_id, s.priority,
		s.default_preset_id FROM cards c
		JOIN entities ce ON ce.entity_type = ? AND ce.entity_id = c.id AND ce.deleted = 0
		JOIN review_states state ON state.card_id = c.id
		JOIN entities se ON se.entity_type = ? AND se.entity_id = c.id AND se.deleted = 0
		JOIN card_sources s ON s.id = c.source_id
		JOIN card_source_refs r ON r.id = s.primary_ref_id AND r.source_id = s.id AND r.entity_type = 'block'
		WHERE c.template_id = ? AND c.generation_status = ?`+membershipClause+`
		ORDER BY state.due, c.id`, args...)
	if err != nil {
		return nil, fmt.Errorf("query legacy-compatible flashcards: %w", err)
	}
	defer rows.Close()
	ret := make([]LegacyQuickCard, 0)
	for rows.Next() {
		var cardPayload, statePayload []byte
		var item LegacyQuickCard
		if err = rows.Scan(&cardPayload, &statePayload, &item.BlockID, &item.SourcePriority,
			&item.DefaultPresetID); err != nil {
			return nil, fmt.Errorf("scan legacy-compatible flashcard: %w", err)
		}
		if err = decodeStrictJSON(cardPayload, &item.Card); err != nil {
			return nil, err
		}
		if err = decodeStrictJSON(statePayload, &item.ReviewState); err != nil {
			return nil, err
		}
		ret = append(ret, item)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy-compatible flashcards: %w", err)
	}
	return ret, nil
}

// ResolveLegacyCard 将旧卡片 ID 或新版快速卡 ID 解析为唯一的当前卡片。
func (projection *Projection) ResolveLegacyCard(ctx context.Context, deckID, legacyCardID string) (
	LegacyQuickCard, bool, error) {
	if strings.TrimSpace(legacyCardID) == "" {
		return LegacyQuickCard{}, false, errors.New("legacy flashcard ID is required")
	}
	query := `SELECT payload FROM entities WHERE entity_type = ? AND deleted = 0`
	args := []any{EntityLegacyCardAlias}
	if deckID != "" {
		query += ` AND json_extract(payload, '$.legacyDeckID') = ?`
		args = append(args, deckID)
	}
	query += ` AND json_extract(payload, '$.legacyCardID') = ? ORDER BY entity_id`
	args = append(args, legacyCardID)
	rows, err := projection.db.QueryContext(ctx, query, args...)
	if err != nil {
		return LegacyQuickCard{}, false, fmt.Errorf("resolve legacy flashcard alias: %w", err)
	}
	resolvedIDs := map[string]struct{}{}
	for rows.Next() {
		var payload []byte
		if err = rows.Scan(&payload); err != nil {
			_ = rows.Close()
			return LegacyQuickCard{}, false, err
		}
		var alias LegacyCardAlias
		if err = decodeStrictJSON(payload, &alias); err != nil {
			_ = rows.Close()
			return LegacyQuickCard{}, false, err
		}
		resolvedIDs[alias.CardID] = struct{}{}
	}
	if err = rows.Close(); err != nil {
		return LegacyQuickCard{}, false, err
	}
	if len(resolvedIDs) > 1 {
		return LegacyQuickCard{}, false, errors.New("legacy flashcard ID is ambiguous across review sets")
	}
	cards, err := projection.LegacyQuickCards(ctx, deckID)
	if err != nil {
		return LegacyQuickCard{}, false, err
	}
	for _, card := range cards {
		_, aliasMatch := resolvedIDs[card.Card.ID]
		if aliasMatch || len(resolvedIDs) == 0 && card.Card.ID == legacyCardID {
			return card, true, nil
		}
	}
	return LegacyQuickCard{}, false, nil
}

// PreviewReviewDues 返回当前排期状态下四种评分对应的下一次到期时间。
func (store *Store) PreviewReviewDues(ctx context.Context, cardID string, reviewedAt int64) (
	map[ReviewRating]int64, error) {
	if reviewedAt <= 0 {
		return nil, errors.New("flashcard preview time is required")
	}
	cardRevision, found, err := store.projection.CurrentEntity(ctx, EntityCard, cardID)
	if err != nil || !found || cardRevision.Deleted {
		if err != nil {
			return nil, err
		}
		return nil, ErrEntityNotFound
	}
	var card Card
	if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil {
		return nil, err
	}
	sourceRevision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, card.SourceID)
	if err != nil || !found || sourceRevision.Deleted {
		if err != nil {
			return nil, err
		}
		return nil, ErrEntityNotFound
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
		return nil, err
	}
	presetID := card.PresetOverrideID
	if presetID == "" {
		presetID = source.DefaultPresetID
	}
	presetRevision, found, err := store.projection.CurrentEntity(ctx, EntitySchedulerPreset, presetID)
	if err != nil || !found || presetRevision.Deleted {
		if err != nil {
			return nil, err
		}
		return nil, ErrEntityNotFound
	}
	var preset SchedulerPreset
	if err = decodeStrictJSON(presetRevision.Payload, &preset); err != nil {
		return nil, err
	}
	stateRevision, found, err := store.projection.CurrentEntity(ctx, EntityReviewState, card.ID)
	if err != nil || !found || stateRevision.Deleted {
		if err != nil {
			return nil, err
		}
		return nil, ErrEntityNotFound
	}
	var state ReviewState
	if err = decodeStrictJSON(stateRevision.Payload, &state); err != nil {
		return nil, err
	}
	ret := make(map[ReviewRating]int64, 4)
	for _, rating := range []ReviewRating{ReviewAgain, ReviewHard, ReviewGood, ReviewEasy} {
		after, scheduleErr := scheduleReview(state.ReviewStateSnapshot, preset, ReviewRequest{
			CardID: card.ID, Rating: rating, ReviewedAt: reviewedAt, ReviewMode: "normal",
		})
		if scheduleErr != nil {
			return nil, scheduleErr
		}
		ret[rating] = after.Due
	}
	return ret, nil
}

// LegacyReviewSets 返回全部显式标记为旧卡包适配器的复习集。
func (projection *Projection) LegacyReviewSets(ctx context.Context) ([]LegacyReviewSetInfo, error) {
	ret := make([]LegacyReviewSetInfo, 0)
	for offset := 0; ; offset += maxEntityPageSize {
		page, err := projection.ListEntities(ctx, EntityReviewSet,
			EntityListOptions{Limit: maxEntityPageSize, Offset: offset})
		if err != nil {
			return nil, err
		}
		for _, revision := range page.Entities {
			var reviewSet ReviewSet
			if err = decodeStrictJSON(revision.Payload, &reviewSet); err != nil {
				return nil, err
			}
			if reviewSet.LegacyDeckID == "" {
				continue
			}
			cards, cardsErr := projection.LegacyQuickCards(ctx, reviewSet.LegacyDeckID)
			if cardsErr != nil {
				return nil, cardsErr
			}
			createdAt := revision.UpdatedAt
			if createdErr := projection.db.QueryRowContext(ctx, `SELECT MIN(updated_at) FROM entity_revisions
				WHERE entity_type = ? AND entity_id = ?`, EntityReviewSet, reviewSet.ID).Scan(&createdAt); createdErr != nil {
				return nil, fmt.Errorf("query legacy review set creation time: %w", createdErr)
			}
			ret = append(ret, LegacyReviewSetInfo{DeckID: reviewSet.LegacyDeckID, ReviewSetID: reviewSet.ID,
				Name: reviewSet.Name, Size: len(cards), CreatedAt: createdAt, UpdatedAt: revision.UpdatedAt})
		}
		if offset+len(page.Entities) >= page.Total {
			break
		}
	}
	sort.Slice(ret, func(i, j int) bool {
		if ret[i].UpdatedAt == ret[j].UpdatedAt {
			return ret[i].DeckID < ret[j].DeckID
		}
		return ret[i].UpdatedAt > ret[j].UpdatedAt
	})
	return ret, nil
}

// CreateLegacyReviewSet 创建一个供旧卡包 API 使用的静态复习集。
func (store *Store) CreateLegacyReviewSet(ctx context.Context, operationID, deckID, name string, updatedAt int64,
	newLimit, reviewLimit int) (LegacyReviewSetInfo, error) {
	if strings.TrimSpace(deckID) == "" || strings.TrimSpace(name) == "" || updatedAt <= 0 {
		return LegacyReviewSetInfo{}, errors.New("legacy review set identity, name and time are required")
	}
	reviewSetID := LegacyReviewSetID(deckID)
	if _, found, err := store.projection.CurrentEntity(ctx, EntityReviewSet, reviewSetID); err != nil {
		return LegacyReviewSetInfo{}, err
	} else if found {
		return LegacyReviewSetInfo{}, errors.New("legacy review set already exists")
	}
	reviewSet := ReviewSet{ID: reviewSetID, Name: name, LegacyDeckID: deckID, NewLimit: newLimit,
		ReviewLimit: reviewLimit, DefaultReviewMode: "normal"}
	payload, err := CanonicalJSON(reviewSet)
	if err != nil {
		return LegacyReviewSetInfo{}, err
	}
	if _, err = store.MutateEntities(ctx, operationID, []EntityMutation{{EntityType: EntityReviewSet,
		EntityID: reviewSetID, UpdatedAt: updatedAt, Payload: payload}}); err != nil {
		return LegacyReviewSetInfo{}, err
	}
	return LegacyReviewSetInfo{DeckID: deckID, ReviewSetID: reviewSetID, Name: name, CreatedAt: updatedAt,
		UpdatedAt: updatedAt}, nil
}

// RenameLegacyReviewSet 修改旧卡包对应复习集的显示名称。
func (store *Store) RenameLegacyReviewSet(ctx context.Context, operationID, deckID, name string,
	updatedAt int64) error {
	revision, reviewSet, err := store.legacyReviewSet(ctx, deckID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(name) == "" {
		return errors.New("legacy review set name is required")
	}
	reviewSet.Name = name
	payload, err := CanonicalJSON(reviewSet)
	if err != nil {
		return err
	}
	_, err = store.MutateEntities(ctx, operationID, []EntityMutation{{EntityType: EntityReviewSet,
		EntityID: reviewSet.ID, ExpectedRevisionID: revision.RevisionID, UpdatedAt: updatedAt, Payload: payload}})
	return err
}

// AddLegacyQuickCards 将块原子加入旧卡包对应的静态复习集。
func (store *Store) AddLegacyQuickCards(ctx context.Context, operationID, deckID string, blockIDs []string,
	updatedAt int64) ([]LegacyQuickCard, error) {
	if strings.TrimSpace(operationID) == "" || len(blockIDs) == 0 || updatedAt <= 0 {
		return nil, errors.New("legacy flashcard add operation, blocks and time are required")
	}
	_, reviewSet, err := store.legacyReviewSet(ctx, deckID)
	if err != nil {
		return nil, err
	}
	blockIDs = uniqueSortedStrings(blockIDs)
	mutations := make([]EntityMutation, 0, len(blockIDs)*5)
	for _, blockID := range blockIDs {
		sourceID := LegacyQuickSourceID(blockID)
		refID := DeterministicID("legacy-card-source-ref", sourceID, legacyQuickFieldID, blockID)
		cardID := LegacyQuickCardID(blockID)
		if err = store.appendLegacyEntityIfMissing(ctx, &mutations, EntityCardSourceRef, refID, updatedAt,
			CardSourceRef{ID: refID, SourceID: sourceID, FieldID: legacyQuickFieldID, EntityType: "block",
				EntityID: blockID, Role: "content", Required: true}); err != nil {
			return nil, err
		}
		if err = store.appendLegacyEntityIfMissing(ctx, &mutations, EntityCardSource, sourceID, updatedAt,
			CardSource{ID: sourceID, SchemaID: legacyQuickSchemaID, SourceType: "block", PrimaryRefID: refID,
				DefaultPresetID: legacyPresetID, GenerationConfig: json.RawMessage(`{"mode":"auto"}`),
				Status: "active"}); err != nil {
			return nil, err
		}
		cardRevision, found, findErr := store.projection.CurrentEntity(ctx, EntityCard, cardID)
		if findErr != nil {
			return nil, findErr
		}
		resetState := !found || cardRevision.Deleted
		if !found || cardRevision.Deleted {
			card := Card{ID: cardID, SourceID: sourceID, TemplateID: legacyQuickTemplateID,
				VariantKey: "legacy-quick", GenerationStatus: GenerationActive, CreatedAt: updatedAt, UpdatedAt: updatedAt}
			mutations = append(mutations, legacyMutation(EntityCard, cardID, cardRevision, found, updatedAt, card))
		} else {
			var card Card
			if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil {
				return nil, err
			}
			if card.GenerationStatus != GenerationActive {
				resetState = card.GenerationStatus == GenerationDeleted
				card.GenerationStatus = GenerationActive
				card.UpdatedAt = updatedAt
				mutations = append(mutations, legacyMutation(EntityCard, cardID, cardRevision, true, updatedAt, card))
			}
		}
		stateRevision, stateFound, stateErr := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
		if stateErr != nil {
			return nil, stateErr
		}
		if !stateFound || stateRevision.Deleted || resetState {
			state := ReviewState{CardID: cardID, ReviewStateSnapshot: ReviewStateSnapshot{State: "new", Due: updatedAt,
				StateRevisionID: OperationRevisionID(operationID, EntityReviewState, cardID)}}
			mutations = append(mutations, legacyMutation(EntityReviewState, cardID, stateRevision, stateFound,
				updatedAt, state))
		}
		membershipID := DeterministicID("legacy-review-set-membership", reviewSet.ID, cardID)
		membershipRevision, membershipFound, membershipErr := store.projection.CurrentEntity(ctx,
			EntityReviewSetMembership, membershipID)
		if membershipErr != nil {
			return nil, membershipErr
		}
		if !membershipFound || membershipRevision.Deleted {
			membership := ReviewSetMembership{ID: membershipID, ReviewSetID: reviewSet.ID, CardID: cardID,
				Mode: MembershipInclude}
			mutations = append(mutations, legacyMutation(EntityReviewSetMembership, membershipID,
				membershipRevision, membershipFound, updatedAt, membership))
		}
	}
	if len(mutations) != 0 {
		if _, err = store.MutateEntities(ctx, operationID, mutations); err != nil {
			return nil, err
		}
	}
	return store.projection.LegacyQuickCards(ctx, deckID)
}

// RemoveLegacyQuickCards 从一个或全部旧复习集中移除指定块对应的快速卡。
func (store *Store) RemoveLegacyQuickCards(ctx context.Context, operationID, deckID string, blockIDs []string,
	updatedAt int64) error {
	if strings.TrimSpace(operationID) == "" || updatedAt <= 0 {
		return errors.New("legacy flashcard remove operation and time are required")
	}
	if deckID != "" {
		if _, _, err := store.legacyReviewSet(ctx, deckID); err != nil {
			return err
		}
	}
	cards, err := store.projection.LegacyQuickCards(ctx, deckID)
	if err != nil {
		return err
	}
	requestedBlocks := stringSet(blockIDs)
	mutations := make([]EntityMutation, 0)
	for _, item := range cards {
		if len(requestedBlocks) != 0 {
			if _, found := requestedBlocks[item.BlockID]; !found {
				continue
			}
		}
		memberships, membershipErr := store.projection.legacyMembershipsForCard(ctx, item.Card.ID, deckID)
		if membershipErr != nil {
			return membershipErr
		}
		removedIDs := map[string]struct{}{}
		for _, membership := range memberships {
			removedIDs[membership.EntityID] = struct{}{}
			mutations = append(mutations, EntityMutation{EntityType: EntityReviewSetMembership,
				EntityID: membership.EntityID, ExpectedRevisionID: membership.RevisionID, UpdatedAt: updatedAt,
				Deleted: true, Payload: json.RawMessage(`{}`)})
		}
		remaining, remainingErr := store.projection.countLegacyMemberships(ctx, item.Card.ID, removedIDs)
		if remainingErr != nil {
			return remainingErr
		}
		if remaining == 0 {
			cardRevision, found, currentErr := store.projection.CurrentEntity(ctx, EntityCard, item.Card.ID)
			if currentErr != nil {
				return currentErr
			}
			if found && !cardRevision.Deleted {
				card := item.Card
				card.GenerationStatus = GenerationDeleted
				card.UpdatedAt = updatedAt
				mutations = append(mutations, legacyMutation(EntityCard, card.ID, cardRevision, true, updatedAt, card))
			}
		}
	}
	if len(mutations) == 0 {
		return nil
	}
	_, err = store.MutateEntities(ctx, operationID, mutations)
	return err
}

// RemoveLegacyReviewSet 删除旧卡包对应的成员关系和复习集。
func (store *Store) RemoveLegacyReviewSet(ctx context.Context, operationID, deckID string, updatedAt int64) error {
	revision, reviewSet, err := store.legacyReviewSet(ctx, deckID)
	if err != nil {
		return err
	}
	cards, err := store.projection.LegacyQuickCards(ctx, deckID)
	if err != nil {
		return err
	}
	mutations := make([]EntityMutation, 0, len(cards)*2+1)
	for _, item := range cards {
		memberships, membershipErr := store.projection.legacyMembershipsForCard(ctx, item.Card.ID, deckID)
		if membershipErr != nil {
			return membershipErr
		}
		removedIDs := make(map[string]struct{}, len(memberships))
		for _, membership := range memberships {
			removedIDs[membership.EntityID] = struct{}{}
			mutations = append(mutations, EntityMutation{EntityType: EntityReviewSetMembership,
				EntityID: membership.EntityID, ExpectedRevisionID: membership.RevisionID, UpdatedAt: updatedAt,
				Deleted: true, Payload: json.RawMessage(`{}`)})
		}
		remaining, remainingErr := store.projection.countLegacyMemberships(ctx, item.Card.ID, removedIDs)
		if remainingErr != nil {
			return remainingErr
		}
		if remaining == 0 {
			cardRevision, found, currentErr := store.projection.CurrentEntity(ctx, EntityCard, item.Card.ID)
			if currentErr != nil {
				return currentErr
			}
			if found && !cardRevision.Deleted {
				card := item.Card
				card.GenerationStatus = GenerationDeleted
				card.UpdatedAt = updatedAt
				mutations = append(mutations, legacyMutation(EntityCard, card.ID, cardRevision, true, updatedAt, card))
			}
		}
	}
	mutations = append(mutations, EntityMutation{EntityType: EntityReviewSet, EntityID: reviewSet.ID,
		ExpectedRevisionID: revision.RevisionID, UpdatedAt: updatedAt, Deleted: true, Payload: json.RawMessage(`{}`)})
	_, err = store.MutateEntities(ctx, operationID, mutations)
	return err
}

func (store *Store) legacyReviewSet(ctx context.Context, deckID string) (EntityRevision, ReviewSet, error) {
	if strings.TrimSpace(deckID) == "" {
		return EntityRevision{}, ReviewSet{}, errors.New("legacy deck ID is required")
	}
	revision, found, err := store.projection.CurrentEntity(ctx, EntityReviewSet, LegacyReviewSetID(deckID))
	if err != nil {
		return EntityRevision{}, ReviewSet{}, err
	}
	if !found || revision.Deleted {
		return EntityRevision{}, ReviewSet{}, ErrEntityNotFound
	}
	var reviewSet ReviewSet
	if err = decodeStrictJSON(revision.Payload, &reviewSet); err != nil {
		return EntityRevision{}, ReviewSet{}, err
	}
	if reviewSet.LegacyDeckID != deckID {
		return EntityRevision{}, ReviewSet{}, errors.New("review set is not a legacy deck adapter")
	}
	return revision, reviewSet, nil
}

func (store *Store) appendLegacyEntityIfMissing(ctx context.Context, mutations *[]EntityMutation,
	entityType EntityType, entityID string, updatedAt int64, payload any) error {
	revision, found, err := store.projection.CurrentEntity(ctx, entityType, entityID)
	if err != nil {
		return err
	}
	if found && !revision.Deleted {
		return nil
	}
	*mutations = append(*mutations, legacyMutation(entityType, entityID, revision, found, updatedAt, payload))
	return nil
}

func legacyMutation(entityType EntityType, entityID string, current EntityRevision, found bool, updatedAt int64,
	payload any) EntityMutation {
	encoded, err := CanonicalJSON(payload)
	if err != nil {
		panic(err)
	}
	mutation := EntityMutation{EntityType: entityType, EntityID: entityID, UpdatedAt: updatedAt, Payload: encoded}
	if found {
		mutation.ExpectedRevisionID = current.RevisionID
	}
	return mutation
}

func uniqueSortedStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	ret := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			continue
		}
		if _, found := seen[value]; found {
			continue
		}
		seen[value] = struct{}{}
		ret = append(ret, value)
	}
	sort.Strings(ret)
	return ret
}

func (projection *Projection) legacyMembershipsForCard(ctx context.Context, cardID, deckID string) (
	[]EntityRevision, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT e.entity_id, e.revision_id, e.updated_at, e.payload
		FROM entities e JOIN review_set_memberships m ON m.id = e.entity_id
		JOIN review_sets rs ON rs.id = m.review_set_id
		WHERE e.entity_type = ? AND e.deleted = 0 AND m.card_id = ? AND m.mode = ? AND rs.legacy_deck_id <> ''
		ORDER BY e.entity_id`, EntityReviewSetMembership, cardID, MembershipInclude)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ret := make([]EntityRevision, 0)
	for rows.Next() {
		var revision EntityRevision
		var payload []byte
		if err = rows.Scan(&revision.EntityID, &revision.RevisionID, &revision.UpdatedAt, &payload); err != nil {
			return nil, err
		}
		revision.EntityType = EntityReviewSetMembership
		revision.Payload = payload
		if deckID != "" {
			var membership ReviewSetMembership
			if err = decodeStrictJSON(revision.Payload, &membership); err != nil {
				return nil, err
			}
			if membership.ReviewSetID != LegacyReviewSetID(deckID) {
				continue
			}
		}
		ret = append(ret, revision)
	}
	return ret, rows.Err()
}

func (projection *Projection) countLegacyMemberships(ctx context.Context, cardID string,
	removedIDs map[string]struct{}) (int, error) {
	memberships, err := projection.legacyMembershipsForCard(ctx, cardID, "")
	if err != nil {
		return 0, err
	}
	count := 0
	for _, membership := range memberships {
		if _, removed := removedIDs[membership.EntityID]; !removed {
			count++
		}
	}
	return count, nil
}
