package flashcard

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// SetCardEditLaterRequest 仅修改当前卡片的编辑待办，原有排期和可用性设置保持独立。
type SetCardEditLaterRequest struct {
	OperationID        string `json:"operationID"`
	CardID             string `json:"cardID"`
	Enabled            bool   `json:"enabled"`
	Note               string `json:"note,omitempty"`
	ChangedAt          int64  `json:"changedAt"`
	ExpectedRevisionID string `json:"expectedRevisionID,omitempty"`
}

type CardEditLaterResult struct {
	CardID     string         `json:"cardID"`
	RevisionID string         `json:"revisionID"`
	EditLater  *CardEditLater `json:"editLater"`
}

// SetCardEditLater 原子记录编辑待办及审计事件，重复请求返回原结果。
func (store *Store) SetCardEditLater(ctx context.Context, request SetCardEditLaterRequest) (CardEditLaterResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return CardEditLaterResult{}, errors.New("flashcard store is closed")
	}
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.CardID) == "" ||
		request.ChangedAt <= 0 || len([]rune(request.Note)) > 4000 || (!request.Enabled && request.Note != "") {
		return CardEditLaterResult{}, errors.New("flashcard edit-later request is invalid")
	}
	input, err := CanonicalJSON(request)
	if err != nil {
		return CardEditLaterResult{}, err
	}
	if batch, found, findErr := store.findAppliedOperationLocked(ctx, request.OperationID); findErr != nil {
		return CardEditLaterResult{}, findErr
	} else if found {
		return cardEditLaterResultFromBatch(batch, request, input)
	}
	conflicted, err := store.projection.CardHasUnresolvedConflict(ctx, request.CardID)
	if err != nil {
		return CardEditLaterResult{}, err
	}
	if conflicted {
		return CardEditLaterResult{}, fmt.Errorf("flashcard [%s] has an unresolved entity conflict", request.CardID)
	}
	revision, found, err := store.projection.CurrentEntity(ctx, EntityCard, request.CardID)
	if err != nil {
		return CardEditLaterResult{}, err
	}
	if !found || revision.Deleted {
		return CardEditLaterResult{}, ErrEntityNotFound
	}
	if request.ExpectedRevisionID != "" && request.ExpectedRevisionID != revision.RevisionID {
		return CardEditLaterResult{}, ErrRevisionConflict
	}
	var card Card
	if err = decodeStrictJSON(revision.Payload, &card); err != nil {
		return CardEditLaterResult{}, err
	}
	before := card
	card.EditLater = nil
	if request.Enabled {
		card.EditLater = &CardEditLater{Note: request.Note, UpdatedAt: request.ChangedAt}
	}
	card.UpdatedAt = request.ChangedAt
	updated, err := NewOperationEntityRevision(request.OperationID, EntityCard, card.ID,
		[]string{revision.RevisionID}, request.ChangedAt, false, card)
	if err != nil {
		return CardEditLaterResult{}, err
	}
	payload, err := CanonicalJSON(CardManagementEventPayload{
		CardID: card.ID, Action: "editLater", ChangedAt: request.ChangedAt, Input: input,
		BeforeCard: &before, AfterCard: &card,
	})
	if err != nil {
		return CardEditLaterResult{}, err
	}
	event := Event{EventType: EventCardStateChanged,
		EventID:  DeterministicID("card-edit-later-event", request.OperationID, card.ID),
		EntityID: card.ID, OccurredAt: request.ChangedAt, Payload: payload}
	changes := []Change{{Kind: RecordEntityRevision, Revision: &updated}, {Kind: RecordEvent, Event: &event}}
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return CardEditLaterResult{}, err
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		return CardEditLaterResult{}, err
	}
	return cardEditLaterResultFromBatch(batch, request, input)
}

func cardEditLaterResultFromBatch(batch OperationBatch, request SetCardEditLaterRequest,
	input []byte) (CardEditLaterResult, error) {
	if len(batch.Changes) != 2 {
		return CardEditLaterResult{}, ErrOperationConflict
	}
	revision, event := batch.Changes[0].Revision, batch.Changes[1].Event
	if revision == nil || event == nil || revision.EntityType != EntityCard || revision.EntityID != request.CardID ||
		event.EventType != EventCardStateChanged {
		return CardEditLaterResult{}, ErrOperationConflict
	}
	var payload CardManagementEventPayload
	if err := decodeStrictJSON(event.Payload, &payload); err != nil || payload.Action != "editLater" ||
		string(payload.Input) != string(input) || payload.AfterCard == nil {
		return CardEditLaterResult{}, ErrOperationConflict
	}
	return CardEditLaterResult{CardID: request.CardID, RevisionID: revision.RevisionID,
		EditLater: payload.AfterCard.EditLater}, nil
}
