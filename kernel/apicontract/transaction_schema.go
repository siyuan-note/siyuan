package apicontract

import "reflect"

type transactionActionPayload struct {
	action       string
	data, result reflect.Type
}

var transactionActionPayloads = []transactionActionPayload{
	{"updateAttrs", reflect.TypeFor[TransactionAttributeChange](), reflect.TypeFor[Null]()},
	{"create", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"restoreCreatedDoc", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"removeCreatedDoc", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"update", reflect.TypeFor[string](), reflect.TypeFor[BlockOperationResult]()},
	{"insert", reflect.TypeFor[string](), reflect.TypeFor[BlockOperationResult]()},
	{"delete", reflect.TypeFor[BlockDeleteData](), reflect.TypeFor[BlockOperationResult]()},
	{"move", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"swapBlockRef", reflect.TypeFor[TransactionBlockSwap](), reflect.TypeFor[[]string]()},
	{"moveOutlineHeading", reflect.TypeFor[Null](), reflect.TypeFor[BlockOperationResult]()},
	{"append", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"appendInsert", reflect.TypeFor[string](), reflect.TypeFor[BlockOperationResult]()},
	{"prependInsert", reflect.TypeFor[string](), reflect.TypeFor[BlockOperationResult]()},
	{"foldHeading", reflect.TypeFor[Null](), reflect.TypeFor[BlockOperationResult]()},
	{"unfoldHeading", reflect.TypeFor[string](), reflect.TypeFor[BlockOperationResult]()},
	{"setAttrs", reflect.TypeFor[string](), reflect.TypeFor[BlockOperationResult]()},
	{"doUpdateUpdated", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"addFlashcards", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"removeFlashcards", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"setAttrViewName", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"setAttrViewNewItemTemplates", reflect.TypeFor[TransactionNewItemTemplates](), reflect.TypeFor[Null]()},
	{"setAttrViewFilters", reflect.TypeFor[[]*AVViewFilter](), reflect.TypeFor[Null]()},
	{"setAttrViewContextFilter", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"setAttrViewColRelationFilters", reflect.TypeFor[[]*AVViewFilter](), reflect.TypeFor[Null]()},
	{"setAttrViewColRollupFilters", reflect.TypeFor[[]*AVViewFilter](), reflect.TypeFor[Null]()},
	{"setAttrViewSorts", reflect.TypeFor[[]*AVViewSort](), reflect.TypeFor[Null]()},
	{"setAttrViewPageSize", reflect.TypeFor[float64](), reflect.TypeFor[Null]()},
	{"setAttrViewColWidth", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"setAttrViewColsWidth", reflect.TypeFor[map[string]string](), reflect.TypeFor[Null]()},
	{"setAttrViewColAlign", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"setAttrViewColWrap", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewColHidden", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewColPin", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewColIcon", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"setAttrViewColDesc", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"insertAttrViewBlock", reflect.TypeFor[Null](), reflect.TypeFor[TransactionInsertedItems]()},
	{"removeAttrViewBlock", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"addAttrViewCol", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"updateAttrViewCol", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"removeAttrViewCol", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"sortAttrViewRow", reflect.TypeFor[AVRowOrderChange](), reflect.TypeFor[Null]()},
	{"sortAttrViewCol", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"sortAttrViewKey", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"sortAttrViewBinding", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"updateAttrViewCell", reflect.TypeFor[AVValuePatch](), reflect.TypeFor[Null]()},
	{"updateAttrViewCells", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"updateAttrViewColOptions", reflect.TypeFor[[]*AVSelectOption](), reflect.TypeFor[Null]()},
	{"removeAttrViewColOption", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"updateAttrViewColOption", reflect.TypeFor[TransactionOptionChange](), reflect.TypeFor[Null]()},
	{"setAttrViewColOptionDesc", reflect.TypeFor[TransactionOptionDescription](), reflect.TypeFor[Null]()},
	{"setAttrViewCustomColors", reflect.TypeFor[TransactionCustomColors](), reflect.TypeFor[Null]()},
	{"setAttrViewColCalc", reflect.TypeFor[AVFieldCalc](), reflect.TypeFor[Null]()},
	{"updateAttrViewColNumberFormat", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"setAttrViewColDateFormat", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"replaceAttrViewBlock", reflect.TypeFor[Null](), reflect.TypeFor[TransactionReplacedItem]()},
	{"updateAttrViewColTemplate", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"addAttrViewView", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"removeAttrViewView", reflect.TypeFor[Null](), reflect.TypeFor[string]()},
	{"setAttrViewViewName", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"setAttrViewViewIcon", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"setAttrViewViewDesc", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"duplicateAttrViewView", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"duplicateAttrViewRow", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"sortAttrViewView", reflect.TypeFor[string](), reflect.TypeFor[Null]()},
	{"updateAttrViewColRelation", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"updateAttrViewColRollup", reflect.TypeFor[TransactionRollup](), reflect.TypeFor[Null]()},
	{"hideAttrViewName", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewColDateFillCreated", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewColDateFillSpecificTime", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewCreatedIncludeTime", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewUpdatedIncludeTime", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"duplicateAttrViewKey", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"setAttrViewCoverFrom", reflect.TypeFor[float64](), reflect.TypeFor[Null]()},
	{"setAttrViewCoverFromAssetKeyID", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"setAttrViewCardCoverPosition", reflect.TypeFor[TransactionCardCoverPosition](), reflect.TypeFor[Null]()},
	{"setAttrViewCardSize", reflect.TypeFor[float64](), reflect.TypeFor[Null]()},
	{"setAttrViewCardWidth", reflect.TypeFor[float64](), reflect.TypeFor[Null]()},
	{"setAttrViewCalendar", reflect.TypeFor[AVCalendarSettings](), reflect.TypeFor[Null]()},
	{"setAttrViewCardLayout", reflect.TypeFor[float64](), reflect.TypeFor[Null]()},
	{"setAttrViewColFullRow", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewFitImage", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewDisplayFieldName", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewDisplayEmptyFields", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewFillColBackgroundColor", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewShowIcon", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"setAttrViewWrapField", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"changeAttrViewLayout", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"setAttrViewBlockView", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"setAttrViewBlockVisibleViews", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"setAttrViewCardAspectRatio", reflect.TypeFor[float64](), reflect.TypeFor[Null]()},
	{"setAttrViewCardAspectRatioValue", reflect.TypeFor[float64](), reflect.TypeFor[Null]()},
	{"setAttrViewGroup", reflect.TypeFor[AVViewGroup](), reflect.TypeFor[Null]()},
	{"hideAttrViewGroup", reflect.TypeFor[float64](), reflect.TypeFor[Null]()},
	{"hideAttrViewAllGroups", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"foldAttrViewGroup", reflect.TypeFor[bool](), reflect.TypeFor[Null]()},
	{"foldAttrViewGroups", reflect.TypeFor[map[string]bool](), reflect.TypeFor[Null]()},
	{"syncAttrViewTableColWidth", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"removeAttrViewGroup", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
	{"sortAttrViewGroup", reflect.TypeFor[Null](), reflect.TypeFor[Null]()},
}

func transactionPayloadSchema(b *schemaBuilder, t reflect.Type, input bool) (*Schema, error) {
	if t == reflect.TypeFor[BlockOperation]() {
		name := "BlockOperation"
		if input {
			name += "Input"
		}
		if _, ok := b.definitions[name]; ok {
			return &Schema{Ref: "#/$defs/" + name}, nil
		}
		union := &Schema{}
		b.definitions[name] = union
		fields := &Schema{Type: "object", Properties: map[string]*Schema{}, AdditionalProperties: false}
		if err := b.fields(fields, t, input); err != nil {
			return nil, err
		}
		for _, payload := range transactionActionPayloads {
			switch payload.action {
			case "delete", "insert", "update", "foldHeading", "unfoldHeading", "setAttrs", "moveOutlineHeading", "appendInsert", "prependInsert":
			default:
				continue
			}
			data, err := b.schema(payload.data, true)
			if err != nil {
				return nil, err
			}
			result, err := b.schema(payload.result, input)
			if err != nil {
				return nil, err
			}
			union.AnyOf = append(union.AnyOf, transactionOperationBranch(fields, &Schema{Type: "string", Enum: []any{payload.action}}, nullable(data), nullable(result), input))
		}
		return &Schema{Ref: "#/$defs/" + name}, nil
	}
	if t == reflect.TypeFor[TransactionContext]() {
		const name = "TransactionContext"
		if _, ok := b.definitions[name]; ok {
			return &Schema{Ref: "#/$defs/" + name}, nil
		}
		extension, err := b.schema(reflect.TypeFor[JSONValue](), input)
		if err != nil {
			return nil, err
		}
		properties := map[string]*Schema{}
		for _, name := range []string{"focusId", "message", "ignoreProcess", "setRange", "removeFold", "moveGroupID",
			"headingBatchRootID", "notebook", "box", "boxID", "rootID", "blockID", "ignoreTip", "openFilteredItem",
			"protyleID", "filteredTipScope", "filteredTipToken", "filteredTipAppID", "undoFocusId", "undoFocusCalloutTitle",
			"undoFocusCollapseToEnd", "undoFocusEmbedId", "undoFocusEnd", "undoFocusEndId", "undoFocusEndIndex",
			"undoFocusIgnoreZWSP", "undoFocusIndex", "undoFocusStart", "undoFocusStartAtEnd", "undoFocusTableCell", "undoFocusTableSelection"} {
			properties[name] = &Schema{Type: "string"}
		}
		b.definitions[name] = nullable(&Schema{Type: "object", Properties: properties, AdditionalProperties: extension})
		return &Schema{Ref: "#/$defs/" + name}, nil
	}
	if t == reflect.TypeFor[*TransactionSource]() {
		schema, err := b.schema(reflect.TypeFor[TransactionSourceFields](), true)
		return nullable(schema), err
	}
	if t == reflect.TypeFor[TransactionSource]() {
		return b.schema(reflect.TypeFor[TransactionSourceFields](), true)
	}
	if t == reflect.TypeFor[TransactionOperationData]() {
		return b.schema(reflect.TypeFor[AVValuePatch](), true)
	}
	if t == reflect.TypeFor[TransactionHistoryResult]() {
		result := &Schema{}
		for _, member := range []reflect.Type{reflect.TypeFor[TransactionHistoryEmpty](), reflect.TypeFor[TransactionHistoryFailure](), reflect.TypeFor[TransactionHistoryApplied]()} {
			schema, err := b.schema(member, input)
			if err != nil {
				return nil, err
			}
			result.AnyOf = append(result.AnyOf, schema)
		}
		return result, nil
	}
	if t != reflect.TypeFor[TransactionOperation]() {
		return nil, nil
	}
	name := "TransactionOperation"
	if input {
		name += "Request"
	}
	if _, ok := b.definitions[name]; ok {
		return &Schema{Ref: "#/$defs/" + name}, nil
	}
	union := &Schema{}
	b.definitions[name] = union
	fields := &Schema{Type: "object", Properties: map[string]*Schema{}, AdditionalProperties: false}
	if err := b.fields(fields, reflect.TypeFor[TransactionOperationFields](), input); err != nil {
		return nil, err
	}
	actionNames := []any{}
	for _, payload := range transactionActionPayloads {
		actionNames = append(actionNames, payload.action)
		data, err := b.schema(payload.data, true)
		if err != nil {
			return nil, err
		}
		if payload.action == "setAttrViewCustomColors" {
			colors, err := b.schema(reflect.TypeFor[[]*AVAttributeViewCustomColor](), true)
			if err != nil {
				return nil, err
			}
			data = &Schema{AnyOf: []*Schema{data, colors}}
		}
		ret, err := b.schema(payload.result, input)
		if err != nil {
			return nil, err
		}
		branch := transactionOperationBranch(fields, &Schema{Type: "string", Enum: []any{payload.action}}, nullable(data), nullable(ret), input)
		union.AnyOf = append(union.AnyOf, branch)
	}
	b.definitions["UnknownTransactionAction"] = &Schema{Type: "string", Not: &Schema{Enum: actionNames}}
	opaque, err := b.schema(reflect.TypeFor[JSONValue](), input)
	if err != nil {
		return nil, err
	}
	union.AnyOf = append(union.AnyOf, transactionOperationBranch(fields, &Schema{Ref: "#/$defs/UnknownTransactionAction"}, opaque, opaque, input))
	return &Schema{Ref: "#/$defs/" + name}, nil
}

func transactionOperationBranch(base *Schema, action, data, result *Schema, input bool) *Schema {
	properties := map[string]*Schema{}
	for key, value := range base.Properties {
		properties[key] = value
	}
	properties["action"], properties["data"], properties["retData"] = action, data, result
	required := append([]string{}, base.Required...)
	addRequired := []string{"data", "retData"}
	if input {
		addRequired = []string{"action"}
	}
	for _, name := range addRequired {
		found := false
		for _, existing := range required {
			if existing == name {
				found = true
				break
			}
		}
		if !found {
			required = append(required, name)
		}
	}
	return &Schema{Type: "object", Properties: properties, Required: required, AdditionalProperties: false}
}
