package model

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type collectionReview struct {
	tx        *Transaction
	boxID     string
	rules     []*av.AutomationRule
	uncertain bool
	version   string
	trees     map[string]*parse.Tree
	matches   map[string]map[string]bool
	present   map[string]map[string]bool
}

func (tx *Transaction) newCollectionReview(view *av.AttributeView, boxID string) *collectionReview {
	data, _ := json.Marshal(view.Automations)
	ret := &collectionReview{tx: tx, boxID: boxID, version: fmt.Sprintf("%x", sha256.Sum256(data)),
		trees: map[string]*parse.Tree{}, matches: map[string]map[string]bool{}, present: map[string]map[string]bool{}}
	if view.Automations != nil {
		for _, rule := range view.Automations.Rules {
			if rule == nil || !rule.Enabled || rule.Trigger != "block" {
				continue
			}
			if err := tx.validateBlockCollectionRule(view, rule, boxID); err != nil {
				ret.uncertain = true
				continue
			}
			ret.rules = append(ret.rules, rule)
		}
	}
	return ret
}

// 仅有明确的不匹配结论才能进入清理预览；不可读取和没有规则均不解释为不匹配。
func (review *collectionReview) item(row *av.Value) *apicontract.AVCollectionReviewItem {
	ret := &apicontract.AVCollectionReviewItem{Status: "unknown", Reason: "invalidItem"}
	if row == nil {
		return ret
	}
	ret.ItemID = row.BlockID
	ret.IsDetached = row.IsDetached
	if row.Block == nil {
		return ret
	}
	ret.BlockID, ret.Content = row.Block.ID, util.UnescapeHTML(row.Block.Content)
	if row.IsDetached || row.Block.ID == "" {
		ret.Reason = "detached"
		return ret
	}
	if len(review.rules) == 0 {
		ret.Reason = "noRules"
		if review.uncertain {
			ret.Reason = "invalidRule"
		}
		return ret
	}
	ret.Reason = "unavailable"
	bt := attributeViewBindingBlockTree(row.Block.ID, review.boxID)
	if bt == nil || !IsSameCryptoBoundary(review.boxID, bt.BoxID) {
		return ret
	}
	tree, loaded := review.trees[bt.RootID]
	if !loaded {
		var err error
		tree, err = review.tx.loadTreeByBlockTree(bt)
		if err != nil {
			review.trees[bt.RootID] = nil
			ret.Reason = "unreadable"
			return ret
		}
		review.trees[bt.RootID] = tree
		review.present[bt.RootID] = map[string]bool{}
		for id := range collectionNodes(tree) {
			review.present[bt.RootID][id] = true
		}
		matches := map[string]bool{}
		for _, rule := range review.rules {
			for id := range collectionMatches(rule.BlockSource, tree) {
				matches[id] = true
			}
		}
		review.matches[bt.RootID] = matches
	}
	if tree == nil {
		ret.Reason = "unreadable"
		return ret
	}
	if !review.present[bt.RootID][row.Block.ID] {
		return ret
	}
	ret.HPath = tree.HPath
	if review.matches[bt.RootID][row.Block.ID] {
		ret.Status, ret.Reason = "matched", ""
	} else if !review.uncertain {
		ret.Status, ret.Reason = "unmatched", ""
	} else {
		ret.Reason = "invalidRule"
	}
	return ret
}

func ReviewAttributeViewCollection(avID string, page int, status string) (*apicontract.AVCollectionReview, error) {
	if status != "" && status != "matched" && status != "unmatched" && status != "unknown" {
		return nil, fmt.Errorf("invalid collection review status")
	}
	FlushTxQueue()
	tx := &Transaction{luteEngine: util.NewLute(), trees: map[string]*parse.Tree{}}
	defer tx.finishAttributeViewMutation(false)
	_, boxID := av.FindAttributeViewPath(avID)
	view, err := tx.readAttributeViewForMutation(avID, "", boxID)
	if err != nil {
		return nil, err
	}
	review := tx.newCollectionReview(view, boxID)
	ret := &apicontract.AVCollectionReview{Items: []*apicontract.AVCollectionReviewItem{}, RuleVersion: review.version}
	if page < 1 {
		page = 1
	}
	values := view.GetBlockKeyValues().Values
	count := 0
	for _, row := range values {
		item := review.item(row)
		switch item.Status {
		case "matched":
			ret.Matched++
		case "unmatched":
			ret.Unmatched++
		default:
			ret.Unknown++
		}
		if status != "" && item.Status != status {
			continue
		}
		if count/100 == page-1 {
			ret.Items = append(ret.Items, item)
		}
		count++
	}
	ret.HasMore = page <= count/100 && count > page*100
	return ret, nil
}

func (tx *Transaction) doCleanupAttrViewBlocks(op *Operation) *TxErr {
	if tx.isReplay {
		return nil
	}
	fail := func(err error) *TxErr { return &TxErr{code: TxErrHandleAttributeView, id: op.AvID, msg: err.Error()} }
	data, err := json.Marshal(op.Data)
	if err != nil {
		return fail(err)
	}
	var request apicontract.AVCollectionCleanup
	if err = json.Unmarshal(data, &request); err != nil {
		return fail(err)
	}
	if len(request.Items) == 0 || len(request.Items) > 100 {
		return fail(fmt.Errorf("invalid collection cleanup item count"))
	}
	_, boxID := av.FindAttributeViewPath(op.AvID)
	view, err := tx.readAttributeViewForMutation(op.AvID, op.BlockID, boxID)
	if err != nil {
		return fail(err)
	}
	review := tx.newCollectionReview(view, boxID)
	if request.RuleVersion == "" || request.RuleVersion != review.version {
		return fail(fmt.Errorf("collection rules changed; refresh the review before cleaning up"))
	}
	var removals []*av.Value
	seen := map[string]bool{}
	for _, item := range request.Items {
		if item == nil || seen[item.ItemID] {
			continue
		}
		seen[item.ItemID] = true
		row := view.GetBlockValue(item.ItemID)
		if row == nil || row.Block == nil || row.Block.ID != item.BlockID {
			continue
		}
		if review.item(row).Status == "unmatched" {
			removals = append(removals, row)
		}
	}
	if len(removals) == 0 {
		return nil
	}
	if tx.attributeViewAutomations == nil {
		tx.attributeViewAutomations = &attributeViewAutomationState{time: time.Now().UnixMilli(), recordUndo: len(tx.UndoOperations) > 0}
	}
	if tx.attributeViewRollback == nil {
		tx.attributeViewRollback = &attributeViewRollback{views: map[string]*av.AttributeView{}, trees: map[string]*parse.Tree{}, leases: map[string]bool{}}
	}
	for _, row := range removals {
		if err = tx.removeCollectedItem(view, row, boxID); err != nil {
			return fail(err)
		}
	}
	return nil
}
