#!/usr/bin/env python3
"""
MDX/MDD 词典数据提取器（朗文5专版）
用法: python extract.py --mdx 词典.mdx --mdd 词典.mdd --words words.txt
"""

import os
import re
import json
import argparse
import hashlib
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString
from mdict_utils import reader
from mdict_utils.base.readmdict import MDX, MDD


# ─────────────────────────────────────────────
# 工具函数
# ─────────────────────────────────────────────

def safe_filename(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"[^\w\s\-']", "", name)
    name = re.sub(r"\s+", "_", name)
    return name or hashlib.md5(name.encode()).hexdigest()[:8]


def extract_sound_path(href: str) -> str:
    """从 sound://xxx 或普通路径中提取相对路径"""
    return href.replace("sound://", "").strip("/")


def get_text_clean(tag) -> str:
    """提取标签文本，确保单词间有空格（防止连字）"""
    if tag is None:
        return ""
    parts = []
    for child in tag.descendants:
        if isinstance(child, NavigableString):
            txt = str(child)
            if txt.strip():
                parts.append(txt)
        elif child.name in ("a", "span", "b", "i", "em", "strong"):
            pass
    raw = tag.get_text(separator=" ")
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw


def _normalize_apostrophe(text: str) -> str:
    """将中文弯引号 ' ' 替换为英文直引号 '"""
    # return text.replace('\u2018', "'").replace('\u2019', "'")
    return ( 
        text
        .replace('\u2018', "'")
        .replace('\u2019', "'")
        .replace('\u201C', '"')
        .replace('\u201D', '"')
        .replace('＇', "'")
        .replace('&apos;', "'")
    )


# ─────────────────────────────────────────────
# 朗文5 HTML 解析器（新格式，支持多词性）
# ─────────────────────────────────────────────

def _parse_single_entry(entry, word: str) -> dict:
    """解析单个 ldoceEntry 块，返回一个词性组的结构化数据"""
    result: dict = {
        "word":     word,
        "pos":      "",
        "gram":     "",
        "register": "",
        "pron":     [],
        "senses":   [],
        "corpus_examples": [],
        "word_family": [],
        "etym":     "",
    }

    # ── Head：词性 / 语法 / 音标 / 音频 ──
    head = entry.find(class_="Head")
    if head:
        pos_tag = head.find(class_="lm5pp_POS")
        if pos_tag:
            result["pos"] = get_text_clean(pos_tag).strip()

        gram_tag = head.find(class_="GRAM")
        if gram_tag:
            result["gram"] = get_text_clean(gram_tag).strip()

        reg_tag = head.find(class_="REGISTERLAB")
        if reg_tag:
            result["register"] = get_text_clean(reg_tag).strip()

        pron_tag = head.find(class_="PRON")
        raw_pron = get_text_clean(pron_tag).strip() if pron_tag else ""
        pron_text = re.sub(r'\s+', '', raw_pron)

        bre_link = head.find("a", class_="brefile")
        bre_audio = extract_sound_path(bre_link["href"]) if bre_link else ""

        ame_link = head.find("a", class_="amefile")
        ame_audio = extract_sound_path(ame_link["href"]) if ame_link else ""

        proncode = head.find("a", class_="PronCodes")
        if proncode and not ame_audio:
            href = proncode.get("href", "")
            if href.startswith("sound://"):
                ame_audio = extract_sound_path(href)

        result["pron"] = [
            {"bre": pron_text, "audio": bre_audio},
            {"ame": pron_text, "audio": ame_audio},
        ]

    # ── Senses：义项 ──
    senses_out = []
    for sense in entry.find_all(class_="Sense", recursive=True):
        # 跳过嵌套在词源里的 Sense
        parent = sense.parent
        while parent and parent != entry:
            if "etym" in (parent.get("class") or []):
                break
            parent = parent.parent
        else:
            s: dict = {"activ": "", "en": "", "cn": "", "examples": []}

            activ = sense.find(class_="ACTIV")
            if activ:
                s["activ"] = get_text_clean(activ).strip()

            for def_tag in sense.find_all(class_="DEF"):
                cn = def_tag.find(class_="cn_txt")
                if cn:
                    s["cn"] = _normalize_apostrophe(get_text_clean(cn).strip())
                else:
                    s["en"] = _normalize_apostrophe(get_text_clean(def_tag).strip())

            for exa in sense.find_all(class_="EXAMPLE"):
                ex: dict = {"en_txt": "", "cn_txt": "", "audio": ""}

                spk = exa.find("a", class_="exafile")
                if spk and spk.get("href"):
                    ex["audio"] = extract_sound_path(spk["href"])

                en_span = exa.find(class_="english")
                if en_span:
                    cn_node = en_span.find(class_="cn_txt")
                    if cn_node:
                        ex["cn_txt"] = _normalize_apostrophe(get_text_clean(cn_node).strip())
                        cn_node.extract()
                    ex["en_txt"] = _normalize_apostrophe(get_text_clean(en_span).strip())
                else:
                    raw_txt = _normalize_apostrophe(
                        get_text_clean(exa).strip().lstrip("•").strip()
                    )
                    ex["en_txt"] = raw_txt

                if ex["en_txt"]:
                    s["examples"].append(ex)

            senses_out.append(s)

    result["senses"] = senses_out

    # ── 语料库例句（词条级，位于该 entry 内） ──
    corpus_block = entry.find(class_="assetlink")
    if corpus_block:
        for exa in corpus_block.find_all(class_="exa"):
            ex: dict = {"en_txt": "", "cn_txt": "", "audio": ""}
            spk = exa.find("a", class_="exafile")
            if spk and spk.get("href"):
                ex["audio"] = extract_sound_path(spk["href"])
            text = _normalize_apostrophe(
                get_text_clean(exa).strip().lstrip("•").strip()
            )
            ex["en_txt"] = text
            if text:
                result["corpus_examples"].append(ex)

    # ── 词族（词条级） ──
    wf_block = entry.find(class_="LDOCE_word_family")
    if wf_block:
        family_out = []
        current = {"pos": "", "words": []}
        for el in wf_block.children:
            if not hasattr(el, "get"):
                continue
            cls = " ".join(el.get("class") or [])
            txt = get_text_clean(el).strip()
            if "pos" in cls and txt:
                if current["words"]:
                    family_out.append(current)
                current = {"pos": txt, "words": []}
            elif "newfamily" in cls and "pos" not in cls and txt:
                current["words"].append(txt)
        if current["words"]:
            family_out.append(current)
        result["word_family"] = family_out

    # ── 词源 ──
    etym = entry.find(class_="etym")
    if etym:
        sense_tag = etym.find(class_="Sense")
        result["etym"] = get_text_clean(sense_tag).strip() if sense_tag else ""

    return result


def parse_ldoce5(raw_html: str, word: str) -> dict:
    soup = BeautifulSoup(raw_html, "html.parser")
    all_entries = soup.find_all(class_="ldoceEntry")

    if not all_entries:
        return {
            "word": word,
            "entries": [],
            "_raw_html": str(soup)[:500],
        }

    entries_out = [_parse_single_entry(e, word) for e in all_entries]

    # ── 顶层词族 ──
    word_family: list = []
    wf_block = soup.find(class_="LDOCE_word_family")
    if wf_block:
        in_entry = any(wf_block in list(e.descendants) for e in all_entries)
        if not in_entry:
            current = {"pos": "", "words": []}
            for el in wf_block.children:
                if not hasattr(el, "get"):
                    continue
                cls = " ".join(el.get("class") or [])
                txt = get_text_clean(el).strip()
                if "pos" in cls and txt:
                    if current["words"]:
                        word_family.append(current)
                    current = {"pos": txt, "words": []}
                elif "newfamily" in cls and "pos" not in cls and txt:
                    current["words"].append(txt)
            if current["words"]:
                word_family.append(current)

    # ── 顶层语料库 ──
    corpus_examples: list = []
    corpus_block = soup.find(class_="assetlink")
    if corpus_block:
        in_entry = any(corpus_block in list(e.descendants) for e in all_entries)
        if not in_entry:
            for exa in corpus_block.find_all(class_="exa"):
                ex: dict = {"en_txt": "", "cn_txt": "", "audio": ""}
                spk = exa.find("a", class_="exafile")
                if spk and spk.get("href"):
                    ex["audio"] = extract_sound_path(spk["href"])
                text = _normalize_apostrophe(
                    get_text_clean(exa).strip().lstrip("•").strip()
                )
                ex["en_txt"] = text
                if text:
                    corpus_examples.append(ex)

    return {
        "word": word,
        "entries": entries_out,
        "word_family": word_family,
        "corpus_examples": corpus_examples,
    }


def extract_all_sound_paths(data: dict) -> list[str]:
    """从解析结果中收集所有音频路径"""
    paths = []
    for entry in data.get("entries", []):
        for p in entry.get("pron", []):
            if p.get("audio"):
                paths.append(p["audio"])
        for s in entry.get("senses", []):
            for ex in s.get("examples", []):
                if ex.get("audio"):
                    paths.append(ex["audio"])
        for ex in entry.get("corpus_examples", []):
            if ex.get("audio"):
                paths.append(ex["audio"])
    for ex in data.get("corpus_examples", []):
        if ex.get("audio"):
            paths.append(ex["audio"])
    seen = set()
    return [p for p in paths if not (p in seen or seen.add(p))]


# ─────────────────────────────────────────────
# MDD 音频提取
# ─────────────────────────────────────────────

class MddExtractor:
    def __init__(self, mdd_path: str):
        self.mdd_path = mdd_path
        self._md = None
        self._key_map: dict[str, tuple] = {}
        self._loaded = False

    def _load(self):
        if self._loaded:
            return
        print(f"  正在加载 MDD 索引: {self.mdd_path} ...")
        self._md = MDD(self.mdd_path)
        key_list = self._md._key_list
        for i, (offset, key_bytes) in enumerate(key_list):
            key_str = key_bytes.decode("UTF-8").strip("\\").replace("\\", "/").lower()
            length = key_list[i + 1][0] - offset if (i + 1) < len(key_list) else -1
            self._key_map[key_str] = (offset, key_bytes, length)
        self._loaded = True
        print(f"  MDD 索引加载完成，共 {len(self._key_map)} 条音频资源")

    def get_audio(self, sound_path: str) -> bytes | None:
        self._load()
        normalized = sound_path.strip("\\").replace("\\", "/").lower()
        entry = self._key_map.get(normalized)
        if entry is None:
            basename = normalized.split("/")[-1]
            for k, v in self._key_map.items():
                if k.endswith(basename):
                    entry = v
                    break
        if entry is None:
            return None
        offset, key_bytes, length = entry
        from mdict_utils.reader import get_record
        return get_record(self._md, key_bytes, offset, length)


# ─────────────────────────────────────────────
# 主提取逻辑
# ─────────────────────────────────────────────

def extract(
    mdx_path: str,
    mdd_path: str | None,
    words_file: str,
    dist_dir: str = "dist",
):
    dist = Path(dist_dir)
    audio_dir = dist / "audio"
    dist.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    words_raw = Path(words_file).read_text(encoding="utf-8").splitlines()
    words = [w.strip() for w in words_raw if w.strip() and not w.startswith("#")]
    print(f"读取到 {len(words)} 个单词")

    mdd_extractor = MddExtractor(mdd_path) if mdd_path else None

    results = []
    not_found = []

    for idx, word in enumerate(words, 1):
        print(f"[{idx}/{len(words)}] 处理: {word}")

        raw = reader.query(mdx_path, word)
        if not raw or not raw.strip():
            print(f"  ⚠️  未找到: {word}")
            not_found.append(word)
            continue

        parsed = parse_ldoce5(raw, word)
        all_sound_paths = extract_all_sound_paths(parsed)

        path_map: dict[str, str] = {}
        if mdd_extractor:
            for sp in all_sound_paths:
                audio_bytes = mdd_extractor.get_audio(sp)
                if audio_bytes:
                    ext = Path(sp).suffix or ".mp3"
                    fname = f"{safe_filename(word)}_{hashlib.md5(sp.encode()).hexdigest()[:6]}{ext}"
                    (audio_dir / fname).write_bytes(audio_bytes)
                    path_map[sp] = f"audio/{fname}"
                    print(f"  ✓ 音频: {fname}")
                else:
                    print(f"  ✗ 音频未找到: {sp}")

        def remap(data: dict) -> dict:
            if isinstance(data, dict):
                return {k: (path_map.get(v, v) if k == "audio" and isinstance(v, str) else remap(v))
                        for k, v in data.items()}
            if isinstance(data, list):
                return [remap(i) for i in data]
            return data

        parsed = remap(parsed)
        results.append(parsed)

    data_json = {
        "generated_at": __import__("datetime").datetime.now().isoformat(),
        "total": len(results),
        "not_found": not_found,
        "words": results,
    }
    (dist / "data.json").write_text(
        json.dumps(data_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n✅ 完成！成功: {len(results)}，未找到: {len(not_found)}")

    # ── 打包成 zip ──────────────────────────────────────
    package_zip(dist)

    return dist


def package_zip(dist_dir: Path):
    """将 dist 目录打包成 dist.zip，供 PWA 本地导入使用"""
    import zipfile
    zip_path = dist_dir.parent / "dist.zip"
    print(f"\n📦 正在打包 {zip_path} ...")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in dist_dir.rglob("*"):
            if file.is_file():
                arcname = file.relative_to(dist_dir)
                zf.write(file, arcname)
    size_mb = zip_path.stat().st_size / 1024 / 1024
    print(f"✅ 打包完成：{zip_path}（{size_mb:.1f} MB）")
    print(f"   将 dist.zip 传输到手机，在应用「同步」页面选择该文件即可导入")


# ─────────────────────────────────────────────
# HTTP 服务器（保留，供局域网同步用）
# ─────────────────────────────────────────────

def serve(dist_dir: str = "dist", port: int = 8765):
    import socket
    from flask import Flask, send_from_directory, jsonify, make_response
    try:
        from flask_cors import CORS
        _has_cors = True
    except ImportError:
        _has_cors = False

    app = Flask(__name__, static_folder=dist_dir)
    if _has_cors:
        CORS(app, resources={r"/*": {"origins": "*"}})

    @app.route("/data.json")
    def data():
        return send_from_directory(dist_dir, "data.json")
   
    @app.route("/dist.zip")
    def zip_file():
        return send_from_directory(".", "dist.zip", as_attachment=True)

    @app.route("/audio/<path:filename>", methods=["GET", "OPTIONS"])
    def audio(filename):
        return make_response(send_from_directory(os.path.join(dist_dir, "audio"), filename))

    @app.route("/audio-b64/<path:filename>")
    def audio_b64(filename):
        import base64
        filepath = os.path.join(dist_dir, "audio", filename)
        try:
            with open(filepath, "rb") as f:
                data = base64.b64encode(f.read()).decode()
            ext = Path(filepath).suffix.lstrip(".") or "mp3"
            response = make_response(jsonify({"data": f"data:audio/{ext};base64,{data}"}))
            response.headers["Access-Control-Allow-Origin"] = "*"
            return response
        except FileNotFoundError:
            return jsonify({"error": "not found"}), 404

    @app.route("/ping")
    def ping():
        return jsonify({"status": "ok"})

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        lan_ip = "127.0.0.1"

    print(f"\n🌐 服务器已启动")
    print(f"   局域网: http://{lan_ip}:{port}")
    print(f"   本机:   http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mdx", required=False)
    parser.add_argument("--mdd", default=None)
    parser.add_argument("--words", default="words.txt")
    parser.add_argument("--dist", default="dist")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--serve-only", action="store_true")
    parser.add_argument("--zip-only", action="store_true", help="仅重新打包已有 dist 目录为 zip")
    args = parser.parse_args()

    if args.zip_only:
        dist = Path(args.dist)
        if not dist.exists():
            print(f"❌ dist 目录不存在: {dist}"); return
        package_zip(dist)
        return

    if not args.serve_only:
        if not args.mdx:
            print("❌ 请提供 --mdx 参数"); return
        if not Path(args.mdx).exists():
            print(f"❌ MDX 不存在: {args.mdx}"); return
        if not Path(args.words).exists():
            print(f"❌ words.txt 不存在: {args.words}"); return
        if args.mdd and not Path(args.mdd).exists():
            print(f"⚠️  MDD 不存在，跳过音频"); args.mdd = None
        extract(args.mdx, args.mdd, args.words, args.dist)

    serve(args.dist, args.port)


if __name__ == "__main__":
    main()