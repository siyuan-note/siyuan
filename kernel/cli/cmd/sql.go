// SiYuan - Refactor your thinking
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

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"text/tabwriter"

	"github.com/siyuan-note/siyuan/kernel/sql"

	"github.com/spf13/cobra"
)

var sqlCmd = &cobra.Command{
	Use:   "sql <statement>",
	Short: "Execute SQL query",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		stmt := args[0]
		limit, _ := cmd.Flags().GetInt("limit")
		if limit < 1 {
			limit = 100
		}

		if err := sql.CheckSingleStatement(stmt); err != nil {
			return err
		}
		if err := sql.CheckReadonlyStatement(stmt); err != nil {
			return err
		}
		rows, err := sql.Query(stmt, limit)
		if err != nil {
			return err
		}

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(rows, "", "  ")
			fmt.Println(string(data))
		default:
			printSQLResult(rows)
		}
		return nil
	},
}

func printSQLResult(rows []map[string]any) {
	if len(rows) == 0 {
		fmt.Println("No results.")
		return
	}

	cols := make([]string, 0, len(rows[0]))
	for k := range rows[0] {
		cols = append(cols, k)
	}
	sort.Strings(cols)

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	for _, col := range cols {
		fmt.Fprintf(w, "%s\t", col)
	}
	fmt.Fprintln(w)

	for _, row := range rows {
		for _, col := range cols {
			fmt.Fprintf(w, "%v\t", row[col])
		}
		fmt.Fprintln(w)
	}
	w.Flush()

	fmt.Printf("\n%d row(s)\n", len(rows))
}

func init() {
	sqlCmd.Flags().IntP("limit", "l", 100, "max rows returned")

	rootCmd.AddCommand(sqlCmd)
}
