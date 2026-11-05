import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location("notices", Path(__file__).with_name("generate-third-party-notices.py"))
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)


class MarkdownNoticesTests(unittest.TestCase):
    def test_scoped_generation_preserves_existing_notices_and_is_idempotent(self):
        existing = "# Existing notices\n\nUnrelated attribution stays unchanged.\n"
        section = notices.render_markdown_notices()
        updated = notices.update_markdown_notices(existing, section)
        self.assertTrue(updated.startswith(existing))
        self.assertEqual(notices.update_markdown_notices(updated, section), updated)
        for required in ("vditor 4.0.2-alpha.0", "diff-match-patch 1.0.5", "SIL OPEN FONT LICENSE",
                         "MathJax Consortium", "Copyright (c) 2009-2010, Design Science"):
            self.assertIn(required, updated)

    def test_scoped_generation_preserves_following_sections(self):
        section = notices.MARKDOWN_START + "\nold\n" + notices.MARKDOWN_END + "\n"
        source = "before\n" + section + "\nafter\n"
        replacement = section.replace("old", "new")
        self.assertEqual(notices.update_markdown_notices(source, replacement), "before\n" + replacement + "\nafter\n")

    def test_scoped_generation_rejects_incomplete_markers(self):
        for source in (notices.MARKDOWN_START, notices.MARKDOWN_END,
                       notices.MARKDOWN_END + notices.MARKDOWN_START):
            with self.subTest(source=source), self.assertRaises(ValueError):
                notices.update_markdown_notices(source, "replacement")


if __name__ == "__main__":
    unittest.main()
