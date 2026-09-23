package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func flashcardEditLaterData(result flashcardv2.CardEditLaterResult) apicontract.FlashcardEditLaterData {
	data := apicontract.FlashcardEditLaterData{CardID: result.CardID, RevisionID: result.RevisionID}
	if result.EditLater != nil {
		data.EditLater = &apicontract.FlashcardEditLater{Note: result.EditLater.Note, UpdatedAt: result.EditLater.UpdatedAt}
	}
	return data
}

var queryFlashcards = contractHandler(apicontract.QueryFlashcards, func(c *gin.Context,
	request apicontract.QueryFlashcardsRequest) apicontract.Response[apicontract.QueryFlashcardsData] {
	var query *flashcardv2.QueryAST
	if request.Query != nil {
		root, err := flashcardQueryExpression(request.Query.Root)
		if err != nil {
			return apicontract.Failure[apicontract.QueryFlashcardsData](-1, err.Error())
		}
		query = &flashcardv2.QueryAST{Version: request.Query.Version, Root: root}
	}
	options := request.Options
	results, err := model.QueryFlashcardV2Cards(c.Request.Context(), query, flashcardv2.CardSearchOptions{
		Now: options.Now, IncludeInactive: options.IncludeInactive, IncludeSuspended: options.IncludeSuspended,
		IncludeBuried: options.IncludeBuried, IncludePaused: options.IncludePaused,
		IncludeConflicts: options.IncludeConflicts, GroupBySource: options.GroupBySource,
		ReturnCards: options.ReturnCards, Limit: options.Limit, Offset: options.Offset,
	})
	if err != nil {
		return apicontract.Failure[apicontract.QueryFlashcardsData](-1, err.Error())
	}
	data, err := flashcardSearchData(results)
	if err != nil {
		return apicontract.Failure[apicontract.QueryFlashcardsData](-1, err.Error())
	}
	return apicontract.Success(data)
})

func flashcardQueryExpression(expression apicontract.FlashcardQueryExpression) (flashcardv2.QueryExpression, error) {
	result := flashcardv2.QueryExpression{Operator: flashcardv2.QueryOperator(expression.Operator),
		Field: expression.Field, Comparator: flashcardv2.QueryComparator(expression.Comparator)}
	if expression.Value != nil {
		value, err := expression.Value.MarshalJSON()
		if err != nil {
			return result, err
		}
		result.Value = value
	}
	for _, child := range expression.Children {
		converted, err := flashcardQueryExpression(child)
		if err != nil {
			return result, err
		}
		result.Children = append(result.Children, converted)
	}
	return result, nil
}

func flashcardSearchData(results []model.FlashcardV2CardSearchResult) (apicontract.QueryFlashcardsData, error) {
	data := apicontract.QueryFlashcardsData{Cards: make([]apicontract.FlashcardSearchResult, len(results))}
	for index, result := range results {
		card, state := result.Card, result.ReviewState
		converted := apicontract.FlashcardCard{
			ID: card.ID, SourceID: card.SourceID, TemplateID: card.TemplateID, VariantKey: card.VariantKey,
			GenerationStatus: string(card.GenerationStatus), Flag: card.Flag, PresetOverrideID: card.PresetOverrideID,
			PriorityOverride: card.PriorityOverride, CreatedAt: card.CreatedAt, UpdatedAt: card.UpdatedAt,
		}
		if len(card.VariantData) > 0 {
			value, err := apicontract.EncodedJSONValue(card.VariantData)
			if err != nil {
				return data, err
			}
			converted.VariantData = &value
		}
		if card.EditLater != nil {
			converted.EditLater = &apicontract.FlashcardEditLater{Note: card.EditLater.Note, UpdatedAt: card.EditLater.UpdatedAt}
		}
		data.Cards[index] = apicontract.FlashcardSearchResult{
			Card: converted,
			ReviewState: apicontract.FlashcardReviewState{
				CardID: state.CardID, State: state.State, Due: state.Due, LastReview: state.LastReview,
				Stability: state.Stability, Difficulty: state.Difficulty, ElapsedDays: state.ElapsedDays,
				ScheduledDays: state.ScheduledDays, Reps: state.Reps, Lapses: state.Lapses,
				Suspended: state.Suspended, BuriedUntil: state.BuriedUntil, BuriedReason: state.BuriedReason,
				StateRevisionID: state.StateRevisionID,
			},
			SourceType: result.SourceType, SourceStatus: result.SourceStatus, SourcePriority: result.SourcePriority,
			InheritedPriority: result.InheritedPriority, DefaultPresetID: result.DefaultPresetID,
			CardTagIDs: result.CardTagIDs, SourceTagIDs: result.SourceTagIDs, EffectiveTagIDs: result.EffectiveTagIDs,
			EffectivePriority: result.EffectivePriority, EffectivePresetID: result.EffectivePresetID,
			SourceNotebookID: result.SourceNotebookID, SourceRootID: result.SourceRootID, SourcePath: result.SourcePath,
			SourceAvailable: result.SourceAvailable, SourceBlockID: result.SourceBlockID, SourceTitle: result.SourceTitle,
		}
	}
	return data, nil
}
