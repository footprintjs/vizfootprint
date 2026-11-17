import hashlib
import io
from pathlib import Path
import stat
import tempfile
import unittest
import warnings
import zipfile
from unittest.mock import patch
from zip_input import DataRefused, original_members

NAME = 'footprint-storydeck-0.13.3.tgz'
FILES = {NAME: b'inert original bytes, never opened as a package', 'candidate.json': b'{}',
         'source-package.json': b'{}', 'source-package-lock.json': b'{}'}


def fixture(extra=(), change=None):
    out = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in [*FILES.items(), *extra]:
                info = zipfile.ZipInfo(name)
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                if change:
                    change(info)
                archive.writestr(info, data)
    return out.getvalue()


def expected(raw):
    return {'filename': NAME, 'size_in_bytes': len(raw),
            'digest': 'sha256:' + hashlib.sha256(raw).hexdigest()}


class OriginalZip(unittest.TestCase):
    def test_positive_is_data_only_and_writes_nothing(self):
        raw = fixture()
        with tempfile.TemporaryDirectory(prefix='viz-zip-data-') as directory:
            before = list(Path(directory).iterdir())
            self.assertEqual(original_members(raw, expected(raw)), FILES)
            self.assertEqual(list(Path(directory).iterdir()), before)

    def test_outer_digest_and_size_are_checked_before_zip_body(self):
        raw = fixture()
        for field, bad in [('digest', 'sha256:' + '0' * 64), ('size_in_bytes', len(raw) + 1)]:
            exp = expected(raw); exp[field] = bad
            with patch('zip_input.zipfile.ZipFile', side_effect=AssertionError('body opened')):
                with self.assertRaises(DataRefused):
                    original_members(raw, exp)

    def test_duplicate_traversal_directory_and_symlink_refuse(self):
        variants = [fixture([(NAME, b'twin')]), fixture([('../escape', b'x')]),
                    fixture(change=lambda i: setattr(i, 'external_attr', (stat.S_IFDIR | 0o700) << 16)),
                    fixture(change=lambda i: setattr(i, 'external_attr', (stat.S_IFLNK | 0o777) << 16))]
        for raw in variants:
            with self.assertRaises(DataRefused):
                original_members(raw, expected(raw))

    def test_corrupt_deflate_is_a_fixed_refusal(self):
        raw = bytearray(fixture())
        name_len = int.from_bytes(raw[26:28], 'little')
        raw[30 + name_len] = 7  # Invalid deflate block type; outer expectation intentionally updated.
        raw = bytes(raw)
        with self.assertRaises(DataRefused):
            original_members(raw, expected(raw))


if __name__ == '__main__':
    unittest.main()
