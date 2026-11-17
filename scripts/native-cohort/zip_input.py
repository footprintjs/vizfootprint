"""Original ZIP data intake only. No tar extraction, package import or installation."""
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import zipfile
import zlib

MAX_ZIP = 64 * 1024 * 1024


class DataRefused(Exception):
    pass


def require(ok):
    if not ok:
        raise DataRefused('original-zip-refused')


def original_members(raw, expected):
    require(0 < len(raw) <= MAX_ZIP and len(raw) == expected['size_in_bytes'])
    require('sha256:' + hashlib.sha256(raw).hexdigest() == expected['digest'])
    filename = expected['filename']
    require(filename in {'agentfootprint-15.0.0-rc.0.tgz', 'footprint-storydeck-0.13.3.tgz'})
    limits = {filename: 32 * 1024 * 1024, 'candidate.json': 8 * 1024 * 1024,
              'source-package.json': 1024 * 1024, 'source-package-lock.json': 8 * 1024 * 1024}
    result = {}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            require(len(infos) == 4 and sum(i.file_size for i in infos) <= 49 * 1024 * 1024)
            for info in infos:
                name = info.filename
                require(name in limits and name not in result and not info.is_dir())
                require(stat.S_IFMT(info.external_attr >> 16) in {0, stat.S_IFREG})
                require(not info.flag_bits & 1 and info.compress_type in {0, 8})
                require(0 <= info.file_size <= limits[name])
                with archive.open(info) as member:
                    data = member.read(limits[name] + 1)
                require(len(data) == info.file_size)
                result[name] = data
        require(set(result) == set(limits))
        return result
    except (zipfile.BadZipFile, zlib.error, OverflowError, RuntimeError, OSError, EOFError, ValueError):
        raise DataRefused('original-zip-refused') from None


def regular_bytes(path):
    require(path.parent.resolve() == path.parent.absolute())
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= MAX_ZIP)
        data = source.read(MAX_ZIP + 1)
        after = os.fstat(source.fileno())
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns))
    return data


def main():
    require(len(sys.argv) in {4, 5})
    source, expected_path, out = map(Path, sys.argv[1:4])
    expected = json.loads(regular_bytes(expected_path))
    members = original_members(regular_bytes(source), expected)
    require(out.is_absolute() and out.parent.resolve() == out.parent)
    if len(sys.argv) == 5:
        require(sys.argv[4] == '--verify' and set(p.name for p in out.iterdir()) == set(members))
        for name, data in members.items():
            require(regular_bytes(out / name) == data)
    else:
        out.mkdir(mode=0o700)  # A pre-existing or consumed output refuses.
        for name, data in members.items():
            with (out / name).open('xb') as target:
                target.write(data)
    print(json.dumps({'status': 'DATA_ONLY', 'members': len(members), 'digest': expected['digest']}))


if __name__ == '__main__':
    try:
        main()
    except (DataRefused, OSError, ValueError, KeyError, TypeError):
        print('{"status":"REFUSED","reason":"original-zip-refused"}')
        sys.exit(2)
