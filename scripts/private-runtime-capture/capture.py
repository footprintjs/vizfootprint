"""Capture a private runtime projection; never publish or change source metadata."""
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile
import zlib


PACKAGES = (
    {"name": "vizfootprint", "version": "0.1.0", "folder": "",
     "trees": ("dist",), "documents": ("package.json", "README.md", "PACKAGING.md")},
    {"name": "vizfootprint-ui", "version": "0.0.0", "folder": "ui",
     "trees": ("dist", "types"), "documents": ("package.json", "README.md")},
)


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(name):
    parts = PurePosixPath(name).parts
    require(parts and not name.startswith("/") and ".." not in parts
            and "\\" not in name and all(ord(c) >= 32 for c in name)
            and not any(p == "node_modules" or p.startswith(".env") for p in parts),
            "Unsafe runtime member: " + name)


def regular_bytes(path):
    require(stat.S_ISREG(path.lstat().st_mode), "Expected regular file: " + str(path))
    return path.read_bytes()


def runtime_payload(source, package):
    """Enumerate entire native output trees, plus the documented source documents."""
    folder = source / package["folder"]
    files = {}

    def add(path, relative):
        safe_name(relative)
        require(relative not in files, "Duplicate runtime member: " + relative)
        files[relative] = regular_bytes(path)

    def walk(directory, relative):
        require(stat.S_ISDIR(directory.lstat().st_mode), "Expected output directory: " + str(directory))
        for child in sorted(directory.iterdir()):
            name = relative + "/" + child.name
            safe_name(name)
            mode = child.lstat().st_mode
            if stat.S_ISDIR(mode):
                walk(child, name)
            else:
                add(child, name)

    for tree in package["trees"]:
        before = len(files)
        walk(folder / tree, tree)
        require(len(files) > before, "Empty build output: " + tree)
    for document in package["documents"]:
        add(folder / document, document)
    # UI has no separate license file: preserve the repository's MIT bytes.
    add(source / "LICENSE", "LICENSE")
    manifest = json.loads(files["package.json"])
    require(manifest["name"] == package["name"] and manifest["version"] == package["version"]
            and manifest.get("private") is True and manifest.get("license") == "MIT",
            "Unexpected private package identity")
    require(not manifest.get("bundleDependencies") and not manifest.get("bundledDependencies"),
            "Bundled dependencies are not allowed")

    def targets(value):
        if isinstance(value, str):
            require(value.startswith("./") and value[2:] in files,
                    "Missing public export target: " + value)
        elif isinstance(value, dict):
            for nested in value.values():
                targets(nested)
        else:
            raise ValueError("Unsupported export map")

    targets(manifest["exports"])
    for field in ("main", "module", "types", "unpkg", "jsdelivr"):
        if field in manifest:
            targets(manifest[field])
    return dict(sorted(files.items()))


def serialize_archive(files):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, data in sorted(files.items()):
            safe_name(name)
            member = tarfile.TarInfo("package/" + name)
            member.size = len(data)
            member.mode = 0o644
            member.uid = member.gid = member.mtime = 0
            member.uname = member.gname = ""
            archive.addfile(member, io.BytesIO(data))
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, filename="", mode="wb", compresslevel=9, mtime=0) as compressed:
        compressed.write(raw.getvalue())
    return output.getvalue()


def inspect_archive(data, expected):
    """Read back independently; refuse omitted, extra, duplicate or altered members."""
    require(data[:3] == b"\x1f\x8b\x08" and data[3] == 0 and data[4:8] == b"\0" * 4
            and data[8] == 2, "Unexpected deterministic gzip header")
    decoder = zlib.decompressobj(wbits=31)
    raw = decoder.decompress(data) + decoder.flush()
    require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
            "Expected a single complete gzip member")
    offset = 0
    while raw[offset:offset + 512] != b"\0" * 512:
        header = raw[offset:offset + 512]
        require(len(header) == 512 and header[257:263] == b"ustar\0"
                and header[156:157] in (b"0", b"\0"), "Expected regular ustar header")
        size = int(header[124:136].rstrip(b"\0 ") or b"0", 8)
        offset += 512 + ((size + 511) // 512) * 512
    padding = raw[offset:]
    require(len(raw) % tarfile.RECORDSIZE == 0 and len(padding) >= 1024
            and padding == b"\0" * len(padding), "Unexpected tar end or trailing data")
    inventory = []
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        for member in archive.getmembers():
            require(member.isfile() and member.name.startswith("package/"), "Expected package regular member")
            name = member.name[8:]
            safe_name(name)
            require(name not in seen, "Duplicate archive member")
            seen.add(name)
            require(member.mode == 0o644 and member.uid == member.gid == member.mtime == 0
                    and member.uname == member.gname == "", "Unexpected archive metadata")
            contents = archive.extractfile(member).read()
            require(name in expected and contents == expected[name], "Unexpected archive bytes: " + name)
            inventory.append({"path": name, "bytes": len(contents), "sha256": sha256(contents)})
    require([row["path"] for row in inventory] == sorted(expected), "Incomplete or unsorted runtime projection")
    return inventory


def command(cwd, *args):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def capture(source, output):
    producer = Path(__file__).resolve().parents[2]
    profile = json.loads(Path(__file__).with_name("profile.json").read_text())
    require(command(source, "git", "rev-parse", "HEAD") == profile["revision"], "Wrong source revision")
    require(command(source, "git", "rev-parse", "HEAD^{tree}") == profile["tree"], "Wrong source tree")
    require(not command(source, "git", "status", "--porcelain"), "Source checkout is dirty")
    require(not command(producer, "git", "status", "--porcelain"), "Producer checkout is dirty")
    require(sha256((source / "package-lock.json").read_bytes()) == profile["lockSha256"], "Wrong source lock")
    require(command(source, "npm", "--version") == profile["npm"], "Wrong npm version")
    producer_revision = command(producer, "git", "rev-parse", "HEAD")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        require(os.environ.get("GITHUB_SHA") == producer_revision
                and os.environ.get("GITHUB_REPOSITORY") == "footprintjs/vizfootprint",
                "Hosted producer identity mismatch")
    packages, archives = [], {}
    for package in PACKAGES:
        payload = runtime_payload(source, package)
        data = serialize_archive(payload)
        inventory = inspect_archive(data, payload)
        archive = f'{package["name"]}-{package["version"]}-{profile["revision"][:8]}.tgz'
        archives[archive] = data
        packages.append({"name": package["name"], "version": package["version"], "private": True,
                         "license": "MIT", "archive": archive, "sha256": sha256(data),
                         "integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode(),
                         "bundledDependencies": [], "files": inventory})
    provenance = {
        "format": 1,
        "source": {"repository": profile["repository"], "revision": profile["revision"], "clean": True},
        "packaging": {
            "kind": "private-runtime-snapshot",
            "metadata": "Original source package manifests, exports and license bytes; no registry publication.",
            "contents": "Complete native core dist, UI dist/types, original package documents and root MIT LICENSE; no dependency directories or authoring source trees.",
            "archive": "Sorted package/ regular files; ustar mode0644 uid/gid0 mtime0; gzip filename empty mtime0 level9. Runtime projection, not a native npm pack payload.",
        },
        "packages": packages,
    }
    receipt = {
        "qualification": "SOURCE-QUALIFIED PRIVATE",
        "origin": "GitHub Actions" if os.environ.get("GITHUB_ACTIONS") == "true" else "local",
        "sourceProfile": profile,
        "producer": {"revision": producer_revision,
                     "tree": command(producer, "git", "rev-parse", "HEAD^{tree}"), "clean": True},
        "toolchain": {"node": command(source, "node", "--version"), "npm": profile["npm"],
                      "python": command(source, "python3", "--version")},
        "hosted": {k: os.environ.get(k) for k in ("GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_WORKFLOW")},
        "validation": "Full runtime projection and all export targets read back byte-for-byte; public consumer proof is recorded separately in PROBE.json.",
        "completedLibraryGatesReused": True,
        "publication": False,
    }
    output.mkdir(parents=True, exist_ok=False)
    for filename, data in archives.items():
        (output / filename).write_bytes(data)
    for filename, value in (("provenance.json", provenance), ("CAPTURE.json", receipt)):
        (output / filename).write_text(json.dumps(value, indent=2) + "\n")
    print(json.dumps({"qualification": receipt["qualification"], "source": profile["revision"],
                      "packages": [{k: p[k] for k in ("name", "archive", "sha256")} for p in packages]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    capture(args.source.resolve(), args.output.resolve())
