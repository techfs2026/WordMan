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
    # 递归提取，在块级标签间插入空格
    parts = []
    for child in tag.descendants:
        if isinstance(child, NavigableString):
            txt = str(child)
            if txt.strip():
                parts.append(txt)
        elif child.name in ("a", "span", "b", "i", "em", "strong"):
            # 内联元素：直接取文本，不加空格（会由 descendant 遍历处理）
            pass
    # 用 get_text 但加空格分隔符，再清理多余空白
    raw = tag.get_text(separator=" ")
    # 修复连字：在驼峰/数字边界加空格（防止 BeautifulSoup 把相邻 tag 文本拼接）
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw


# ─────────────────────────────────────────────
# 朗文5 HTML 解析器（新格式）
# ─────────────────────────────────────────────

def parse_ldoce5(raw_html: str, word: str) -> dict:
    """
    解析朗文5 HTML，返回符合新 schema 的结构化数据。

    输出格式：
    {
      word, pos, gram, register,
      pron: [{ bre, audio }, { ame, audio }],
      senses: [{ activ, en, cn, examples: [{ en_txt, cn_txt, audio }] }],
      corpus_examples: [{ en_txt, cn_txt, audio }],
      word_family: [{ pos, words: [str] }],
      etym: str
    }
    """
    soup = BeautifulSoup(raw_html, "html.parser")

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

    entry = soup.find(class_="ldoceEntry")
    if not entry:
        # 可能是重定向词条（@word）
        redirect = soup.find(class_="entry_content")
        result["_raw_html"] = str(soup)[:500]
        return result

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

        # 音标文本（IPA）
        pron_tag = head.find(class_="PRON")
        raw_pron = get_text_clean(pron_tag).strip() if pron_tag else ""
        # 去掉音标字母之间多余空格（BeautifulSoup有时会在标签间插入空格）
        pron_text = re.sub(r'\s+', '', raw_pron)

        # 英音
        bre_link = head.find("a", class_="brefile")
        bre_audio = extract_sound_path(bre_link["href"]) if bre_link else ""

        # 美音
        ame_link = head.find("a", class_="amefile")
        ame_audio = extract_sound_path(ame_link["href"]) if ame_link else ""

        # PronCodes 里也有音标+美音
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
        # 跳过嵌套 Sense（词源里的 Sense）
        parent = sense.parent
        while parent and parent != entry:
            if "etym" in (parent.get("class") or []):
                break
            parent = parent.parent
        else:
            # 正常义项
            s: dict = {"activ": "", "en": "", "cn": "", "examples": []}

            activ = sense.find(class_="ACTIV")
            if activ:
                s["activ"] = get_text_clean(activ).strip()

            # 释义：英文 / 中文（朗文5双语版用 cn_txt）
            for def_tag in sense.find_all(class_="DEF"):
                cn = def_tag.find(class_="cn_txt")
                if cn:
                    s["cn"] = get_text_clean(cn).strip()
                else:
                    # 英文释义：去掉内部 a 标签只取文字
                    s["en"] = get_text_clean(def_tag).strip()

            # 例句
            for exa in sense.find_all(class_="EXAMPLE"):
                ex: dict = {"en_txt": "", "cn_txt": "", "audio": ""}

                # 例句音频
                spk = exa.find("a", class_="exafile")
                if spk and spk.get("href"):
                    ex["audio"] = extract_sound_path(spk["href"])

                # 英文例句
                en_span = exa.find(class_="english")
                if en_span:
                    # 去掉中文翻译子节点再取文本
                    cn_node = en_span.find(class_="cn_txt")
                    if cn_node:
                        ex["cn_txt"] = get_text_clean(cn_node).strip()
                        cn_node.extract()
                    ex["en_txt"] = get_text_clean(en_span).strip()
                else:
                    # 纯文本例句
                    raw_txt = get_text_clean(exa).strip().lstrip("•").strip()
                    ex["en_txt"] = raw_txt

                if ex["en_txt"]:
                    s["examples"].append(ex)

            senses_out.append(s)

    result["senses"] = senses_out

    # ── 语料库例句 ──
    corpus_block = entry.find(class_="assetlink")
    if not corpus_block:
        corpus_block = soup.find("div", class_="assetlink")
    if corpus_block:
        for exa in corpus_block.find_all(class_="exa"):
            ex: dict = {"en_txt": "", "cn_txt": "", "audio": ""}
            spk = exa.find("a", class_="exafile")
            if spk and spk.get("href"):
                ex["audio"] = extract_sound_path(spk["href"])
            text = get_text_clean(exa).strip().lstrip("•").strip()
            ex["en_txt"] = text
            if text:
                result["corpus_examples"].append(ex)

    # ── 词族 ──
    wf_block = soup.find(class_="LDOCE_word_family")
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
    etym = soup.find(class_="etym")
    if etym:
        sense_tag = etym.find(class_="Sense")
        result["etym"] = get_text_clean(sense_tag).strip() if sense_tag else ""

    return result


def extract_all_sound_paths(data: dict) -> list[str]:
    """从解析结果中收集所有音频路径"""
    paths = []
    for p in data.get("pron", []):
        if p.get("audio"):
            paths.append(p["audio"])
    for s in data.get("senses", []):
        for ex in s.get("examples", []):
            if ex.get("audio"):
                paths.append(ex["audio"])
    for ex in data.get("corpus_examples", []):
        if ex.get("audio"):
            paths.append(ex["audio"])
    # 去重保序
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

        # 解析为新格式
        parsed = parse_ldoce5(raw, word)

        # 收集所有音频路径
        all_sound_paths = extract_all_sound_paths(parsed)

        # 导出音频文件，并更新 parsed 里的路径为本地路径
        path_map: dict[str, str] = {}  # original_path -> local_file
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

        # 将 parsed 中所有 audio 字段替换为本地路径
        def remap(data: dict) -> dict:
            """递归替换 audio 字段"""
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
    return dist


# ─────────────────────────────────────────────
# HTTP 服务器
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

    @app.route("/audio/<path:filename>", methods=["GET", "OPTIONS"])
    def audio(filename):
        response = make_response(
            send_from_directory(
                os.path.join(dist_dir, "audio"),
                filename
            )
        )
        return response
    
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
    parser.add_argument("--mdx", required=True)
    parser.add_argument("--mdd", default=None)
    parser.add_argument("--words", default="words.txt")
    parser.add_argument("--dist", default="dist")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--serve-only", action="store_true")
    args = parser.parse_args()

    if not args.serve_only:
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