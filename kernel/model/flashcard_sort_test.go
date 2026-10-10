package model

import (
	"reflect"
	"testing"
	"time"

	"github.com/open-spaced-repetition/go-fsrs/v3"
	"github.com/siyuan-note/riff"
)

func TestFlashcardManagementSortAllPermutations(t *testing.T) {
	cards := []riff.Card{
		&riff.FSRSCard{BaseCard: &riff.BaseCard{CID: "a"}, C: &fsrs.Card{Due: time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)}},
		&riff.FSRSCard{BaseCard: &riff.BaseCard{CID: "b"}, C: &fsrs.Card{}},
		&riff.FSRSCard{BaseCard: &riff.BaseCard{CID: "c"}, C: &fsrs.Card{Due: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)}},
		&riff.FSRSCard{BaseCard: &riff.BaseCard{CID: "d"}, C: &fsrs.Card{}},
		&riff.FSRSCard{BaseCard: &riff.BaseCard{CID: "e"}, C: &fsrs.Card{Due: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)}},
	}
	want := []string{"b", "d", "c", "e", "a"}
	checked := 0
	var permute func(int)
	permute = func(start int) {
		if start == len(cards) {
			ordered := append([]riff.Card(nil), cards...)
			sortFlashcardsByDue(ordered)
			var ids []string
			for _, card := range ordered {
				ids = append(ids, card.ID())
			}
			if !reflect.DeepEqual(ids, want) {
				t.Fatalf("input permutation produced unstable order: %v", ids)
			}
			checked++
			return
		}
		for i := start; i < len(cards); i++ {
			cards[start], cards[i] = cards[i], cards[start]
			permute(start + 1)
			cards[start], cards[i] = cards[i], cards[start]
		}
	}
	permute(0)
	if checked != 120 {
		t.Fatalf("missing input permutations: %d", checked)
	}
}
