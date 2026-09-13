import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("check-lang-keys.py")
SPEC = importlib.util.spec_from_file_location("check_lang_keys", SCRIPT)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class KernelPlaceholdersTest(unittest.TestCase):
    def test_argument_order(self):
        baseline = checker.format_arguments("%d %d %d %s")
        for message in ("%d %d %s %d", "%s %d %d %d"):
            self.assertNotEqual(baseline, checker.format_arguments(message))
        for message in ("%[1]d %[2]d %[4]s %[3]d", "%[4]s %[3]d %[1]d %d"):
            self.assertEqual(baseline, checker.format_arguments(message))

    def test_verbs_and_escaping(self):
        self.assertEqual({}, checker.format_arguments("100%%"))
        for verb in "vTtbcdoOxXUeEfFgGspq":
            self.assertEqual({(1, verb): 1}, checker.format_arguments("%" + verb))
        self.assertEqual({(1, "f"): 1}, checker.format_arguments("%08.2f"))
        self.assertNotEqual(checker.format_arguments("%v %v"), checker.format_arguments(""))
        self.assertNotEqual(checker.format_arguments("%s"), checker.format_arguments("%[1]s %[1]s"))

    def test_dynamic_width_precision(self):
        self.assertEqual(
            checker.format_arguments("%*.*f"),
            checker.format_arguments("%[1]*.[2]*[3]f"),
        )

    def test_invalid_directives(self):
        for message in ("%", "%[0]s", "%[x]s", "%[2", "%z"):
            with self.subTest(message=message), self.assertRaises(ValueError):
                checker.format_arguments(message)

    def test_repository_translations(self):
        directory = SCRIPT.parent.parent / "app/appearance/langs"
        data = {path.name: json.loads(path.read_text(encoding="utf-8"))
                for path in directory.glob("*.json")}
        self.assertTrue(checker.check_kernel_placeholders(data))

    def test_cli_rejects_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, message in (("en", "%v %v"), ("test", "missing")):
                (root / (name + ".json")).write_text(
                    json.dumps({"_kernel": {"210": message}}), encoding="utf-8")
            result = subprocess.run([sys.executable, str(SCRIPT), "--dir", directory],
                                    capture_output=True, text=True)
            self.assertEqual(1, result.returncode)
            self.assertIn("test.json _kernel.210", result.stdout)


if __name__ == "__main__":
    unittest.main()
