"""
WordMan — MDX/MDD 词典提取服务
用法: python app.py --mdx 词典.mdx [--mdd 词典.mdd] [--port 8765]
"""

import re
import json
import hashlib
import zipfile
import argparse
import threading
import socket
import uuid
from pathlib import Path
from datetime import datetime

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from bs4 import BeautifulSoup, NavigableString
from mdict_utils import reader as mdx_reader
from mdict_utils.base.readmdict import MDD


# ─────────────────────────────────────────────
# 工具函数
# ─────────────────────────────────────────────

def safe_filename(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"[^\w\s\-']", "", name)
    name = re.sub(r"\s+", "_", name)
    return name or hashlib.md5(name.encode()).hexdigest()[:8]


def extract_sound_path(href: str) -> str:
    return href.replace("sound://", "").strip("/")


def get_text_clean(tag) -> str:
    if tag is None:
        return ""
    raw = tag.get_text(separator=" ")
    return re.sub(r"\s+", " ", raw).strip()


def _normalize_apostrophe(text: str) -> str:
    return (
        text
        .replace('\u2018', "'").replace('\u2019', "'")
        .replace('\u201C', '"').replace('\u201D', '"')
        .replace('\uff07', "'").replace('&apos;', "'")
    )


# ─────────────────────────────────────────────
# 朗文5 HTML 解析
# ─────────────────────────────────────────────

def _parse_single_entry(entry, word: str) -> dict:
    """解析单个 ldoceEntry 块，返回与原脚本完全一致的 flat dict"""
    result: dict = {
        "word":            word,
        "pos":             "",
        "gram":            "",
        "register":        "",
        "pron":            [],
        "senses":          [],
        "corpus_examples": [],
        "word_family":     [],
        "etym":            "",
    }

    # ── Head ──
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

    # ── Senses ──
    senses_out = []
    for sense in entry.find_all(class_="Sense", recursive=True):
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
                    ex["en_txt"] = _normalize_apostrophe(
                        get_text_clean(exa).strip().lstrip("•").strip()
                    )
                if ex["en_txt"]:
                    s["examples"].append(ex)

            senses_out.append(s)

    result["senses"] = senses_out

    # ── 语料库例句 ──
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

    # ── 词族 ──
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
                ex = {"en_txt": "", "cn_txt": "", "audio": ""}
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


def remap_audio(data, path_map: dict):
    """递归把音频原始路径替换为本地相对路径"""
    if isinstance(data, dict):
        return {
            k: (path_map.get(v, v) if k == "audio" and isinstance(v, str) else remap_audio(v, path_map))
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [remap_audio(i, path_map) for i in data]
    return data


# ─────────────────────────────────────────────
# MDD 音频提取
# ─────────────────────────────────────────────

class MddExtractor:
    def __init__(self, mdd_path: str):
        self.mdd_path = mdd_path
        self._md = None
        self._key_map: dict = {}
        self._loaded = False
        self._lock = threading.Lock()

    def _load(self):
        if self._loaded:
            return
        with self._lock:
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
            print(f"  MDD 索引加载完成，共 {len(self._key_map)} 条")

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
# 任务管理
# ─────────────────────────────────────────────

class JobManager:
    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._lock = threading.Lock()

    def create(self, job_id: str):
        with self._lock:
            self._jobs[job_id] = {
                "id": job_id,
                "status": "pending",
                "progress": [],
                "total": 0,
                "done_count": 0,
                "not_found": [],
                "zip_path": None,
                "error": None,
                "created_at": datetime.now().isoformat(),
            }

    def get(self, job_id: str) -> dict | None:
        return self._jobs.get(job_id)

    def update(self, job_id: str, **kwargs):
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(kwargs)

    def append_progress(self, job_id: str, msg: str):
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id]["progress"].append(msg)


jobs = JobManager()


# ─────────────────────────────────────────────
# 后台提取线程
# ─────────────────────────────────────────────

def run_extract(job_id: str, words: list[str], mdx_path: str, mdd_extractor: MddExtractor | None):
    jobs.update(job_id, status="running", total=len(words))

    work_dir = Path("jobs") / job_id
    audio_dir = work_dir / "audio"
    work_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(exist_ok=True)

    results = []
    not_found = []

    for idx, word in enumerate(words, 1):
        jobs.append_progress(job_id, f"[{idx}/{len(words)}] {word}")
        try:
            raw = mdx_reader.query(mdx_path, word)
        except Exception as e:
            jobs.append_progress(job_id, f"  ✗ 查询出错: {e}")
            not_found.append(word)
            jobs.update(job_id, done_count=idx)
            continue

        if not raw or not raw.strip():
            print(raw)
            jobs.append_progress(job_id, f"  ⚠ 未找到")
            not_found.append(word)
            jobs.update(job_id, done_count=idx)
            continue

        parsed = parse_ldoce5(raw, word)

        all_sound_paths = extract_all_sound_paths(parsed)

        path_map: dict[str, str] = {}

        if mdd_extractor and all_sound_paths:
            for sp in all_sound_paths:
                try:
                    audio_bytes = mdd_extractor.get_audio(sp)
                except Exception as e:
                    jobs.append_progress(job_id, f"  ✗ 音频出错: {e}")
                    continue
                if audio_bytes:
                    ext = Path(sp).suffix or ".mp3"
                    fname = f"{safe_filename(word)}_{hashlib.md5(sp.encode()).hexdigest()[:6]}{ext}"
                    (audio_dir / fname).write_bytes(audio_bytes)
                    path_map[sp] = f"audio/{fname}"
                    jobs.append_progress(job_id, f"  ♪ {fname}")

        parsed = remap_audio(parsed, path_map)
        results.append(parsed)
        jobs.update(job_id, done_count=idx)

    # 写 data.json
    data_json = {
        "generated_at": datetime.now().isoformat(),
        "total":        len(results),
        "not_found":    not_found,
        "words":        results,
    }
    (work_dir / "data.json").write_text(
        json.dumps(data_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 打包 zip
    zip_path = Path("jobs") / f"{job_id}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in work_dir.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(work_dir))

    jobs.update(job_id, status="done", not_found=not_found, zip_path=str(zip_path))
    jobs.append_progress(job_id, f"✅ 完成！成功 {len(results)} 个，未找到 {len(not_found)} 个")


# ─────────────────────────────────────────────
# Flask
# ─────────────────────────────────────────────

app = Flask(__name__)
CORS(app)

MDX_PATH = None
MDD_EXTRACTOR = None


@app.route("/")
def index():
    html_path = Path(__file__).parent / "index.html"
    return html_path.read_text(encoding="utf-8")


@app.route("/api/extract", methods=["POST"])
def api_extract():
    data = request.get_json(force=True)
    words_raw = data.get("words", "")
    words = [w.strip() for w in re.split(r"[\n,，\s]+", words_raw) if w.strip()]
    words = list(dict.fromkeys(words))  # 去重保序

    if not words:
        return jsonify({"error": "请输入至少一个单词"}), 400
    if len(words) > 30:
        return jsonify({"error": "最多支持 30 个单词"}), 400
    if not MDX_PATH:
        return jsonify({"error": "服务器未加载词典"}), 500

    job_id = uuid.uuid4().hex[:12]
    jobs.create(job_id)

    t = threading.Thread(
        target=run_extract,
        args=(job_id, words, MDX_PATH, MDD_EXTRACTOR),
        daemon=True,
    )
    t.start()

    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def api_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify({
        "status":     job["status"],
        "total":      job["total"],
        "done_count": job["done_count"],
        "not_found":  job["not_found"],
        "progress":   job["progress"][request.args.get("offset", 0, type=int):],
        "total_lines": len(job["progress"]),
        "error":      job["error"],
    })


@app.route("/api/download/<job_id>")
def api_download(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "任务不存在"}), 404
    if job["status"] != "done":
        return jsonify({"error": "任务尚未完成"}), 400
    zip_path = job["zip_path"]
    if not zip_path or not Path(zip_path).exists():
        return jsonify({"error": "文件不存在"}), 404
    return send_file(
        zip_path,
        as_attachment=True,
        download_name="dist.zip",
        mimetype="application/zip",
    )


@app.route("/health")
def health():
    return jsonify({"status": "ok", "mdx": MDX_PATH})


# ─────────────────────────────────────────────
# 局域网 IP（优先 192.168.x.x，其次 10.x）
# ─────────────────────────────────────────────

def get_lan_ip() -> str:
    candidates = []

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip.startswith("192.168.") or ip.startswith("10."):
                candidates.append(ip)
    except Exception:
        pass

    # 兜底
    if not candidates:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            candidates.append(s.getsockname()[0])
            s.close()
        except Exception:
            pass

    return candidates[0] if candidates else "127.0.0.1"


# ─────────────────────────────────────────────
# 主入口
# ─────────────────────────────────────────────

def main():
    global MDX_PATH, MDD_EXTRACTOR

    parser = argparse.ArgumentParser(description="WordMan — MDX 词典 HTTP 提取服务")
    parser.add_argument("--mdx",  required=True,  help="MDX 词典路径")
    parser.add_argument("--mdd",  default=None,   help="MDD 音频路径（可选）")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    if not Path(args.mdx).exists():
        print(f"❌ MDX 不存在: {args.mdx}")
        return

    MDX_PATH = args.mdx
    print(f"  MDX: {args.mdx}")

    if args.mdd:
        if Path(args.mdd).exists():
            MDD_EXTRACTOR = MddExtractor(args.mdd)
            print(f"  MDD: {args.mdd}（首次查词时加载索引）")
        else:
            print(f"  ⚠ MDD 不存在，跳过音频: {args.mdd}")

    Path("jobs").mkdir(exist_ok=True)

    lan_ip = get_lan_ip()
    print(f"\n🎵 WordMan 已启动")
    print(f"   本机:   http://127.0.0.1:{args.port}")
    print(f"   局域网: http://{lan_ip}:{args.port}")
    print(f"\n   在浏览器中打开上方地址，输入单词即可生成 dist.zip\n")

    app.run(host="0.0.0.0", port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()