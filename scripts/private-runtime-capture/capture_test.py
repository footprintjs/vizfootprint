"""Behavior fixtures for the private archive boundary; no library build required."""
import gzip
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from capture import PACKAGES, inspect_archive, runtime_payload, serialize_archive


class RuntimeCaptureTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.source = Path(self.scratch.name)
        (self.source / "LICENSE").write_bytes(b"original MIT license\n")
        for package in PACKAGES:
            folder = self.source / package["folder"]
            for tree in package["trees"]:
                (folder / tree).mkdir(parents=True)
                (folder / tree / "index.js").write_bytes(b"export const value = 1;\n")
            for document in package["documents"]:
                (folder / document).write_bytes(b"original document\n")
            (folder / "package.json").write_text(json.dumps({
                "name": package["name"], "version": package["version"], "private": True,
                "license": "MIT", "exports": {".": "./dist/index.js"}, "main": "./dist/index.js",
                "files": ["src", "dist"],
            }, indent=2) + "\n")

    def core(self):
        return runtime_payload(self.source, PACKAGES[0])

    def archive(self, entries):
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, data, change in entries:
                member = tarfile.TarInfo("package/" + name)
                member.size, member.mode = len(data), 0o644
                for key, value in change.items():
                    setattr(member, key, value)
                archive.addfile(member, io.BytesIO(data))
        return gzip.compress(raw.getvalue(), compresslevel=9, mtime=0)

    def entries(self):
        return [(name, data, {}) for name, data in self.core().items()]

    def test_complete_original_projection_and_determinism(self):
        core, ui = self.core(), runtime_payload(self.source, PACKAGES[1])
        self.assertEqual(list(core), ["LICENSE", "PACKAGING.md", "README.md", "dist/index.js", "package.json"])
        self.assertEqual(list(ui), ["LICENSE", "README.md", "dist/index.js", "package.json", "types/index.js"])
        self.assertEqual(ui["LICENSE"], (self.source / "LICENSE").read_bytes())
        self.assertEqual(core["package.json"], (self.source / "package.json").read_bytes())
        data = serialize_archive(core)
        self.assertEqual(data, serialize_archive(dict(reversed(list(core.items())))))
        self.assertEqual([row["path"] for row in inspect_archive(data, core)], list(core))

    def test_missing_export_is_refused_before_capture(self):
        (self.source / "dist/index.js").unlink()
        (self.source / "dist/other.js").write_text("export {};\n")
        with self.assertRaisesRegex(ValueError, "Missing public export"):
            self.core()

    def test_nested_dependency_is_refused(self):
        nested = self.source / "dist/node_modules"
        nested.mkdir()
        (nested / "dependency.js").write_text("export {};\n")
        with self.assertRaisesRegex(ValueError, "Unsafe runtime member"):
            self.core()

    def test_symlink_is_refused(self):
        (self.source / "dist/link.js").symlink_to(self.source / "LICENSE")
        with self.assertRaisesRegex(ValueError, "Expected regular file"):
            self.core()

    def test_environment_file_is_refused(self):
        (self.source / "dist/.env").write_text("synthetic=only\n")
        with self.assertRaisesRegex(ValueError, "Unsafe runtime member"):
            self.core()

    def test_missing_output_directory_is_refused(self):
        (self.source / "dist/index.js").unlink()
        (self.source / "dist").rmdir()
        with self.assertRaises(FileNotFoundError):
            self.core()

    def test_member_omission_is_refused(self):
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            inspect_archive(self.archive(self.entries()[:-1]), self.core())

    def test_extra_member_is_refused(self):
        entries = self.entries() + [("unexpected.js", b"extra", {})]
        with self.assertRaisesRegex(ValueError, "Unexpected archive bytes"):
            inspect_archive(self.archive(entries), self.core())

    def test_changed_manifest_bytes_are_refused(self):
        entries = [(name, data + b" " if name == "package.json" else data, change)
                   for name, data, change in self.entries()]
        with self.assertRaisesRegex(ValueError, "Unexpected archive bytes: package.json"):
            inspect_archive(self.archive(entries), self.core())

    def test_changed_license_is_refused(self):
        ui = runtime_payload(self.source, PACKAGES[1])
        changed = {**ui, "LICENSE": b"substituted license"}
        with self.assertRaisesRegex(ValueError, "Unexpected archive bytes: LICENSE"):
            inspect_archive(serialize_archive(changed), ui)

    def test_duplicate_member_is_refused(self):
        entries = self.entries()
        with self.assertRaisesRegex(ValueError, "Duplicate archive member"):
            inspect_archive(self.archive(entries + [entries[0]]), self.core())

    def test_traversal_is_refused(self):
        with self.assertRaisesRegex(ValueError, "Unsafe runtime member"):
            inspect_archive(self.archive([("../escape", b"no", {})]), self.core())

    def test_noncanonical_metadata_is_refused(self):
        entries = self.entries()
        name, data, _ = entries[0]
        entries[0] = (name, data, {"mtime": 1})
        with self.assertRaisesRegex(ValueError, "Unexpected archive metadata"):
            inspect_archive(self.archive(entries), self.core())


if __name__ == "__main__":
    unittest.main()
