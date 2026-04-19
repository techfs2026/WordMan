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
    return INDEX_HTML


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
        "progress":   job["progress"][-40:],
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
# 前端页面（蓝白风格 · WordMan）
# ─────────────────────────────────────────────

INDEX_HTML = r"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WordMan</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:          #f0f4ff;
    --surface:     #ffffff;
    --border:      #dde3f0;
    --border-hi:   #b8c4e0;
    --text:        #1a1d2e;
    --muted:       #8892b0;
    --accent:      #2563eb;
    --accent-lo:   rgba(37,99,235,.08);
    --accent-hi:   #1d4ed8;
    --accent-glow: rgba(37,99,235,.2);
    --green:       #16a34a;
    --red:         #dc2626;
    --amber:       #d97706;
    --mono:        'DM Mono', monospace;
    --sans:        'Outfit', sans-serif;
    --r:           14px;
    --shadow:      0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(37,99,235,.06);
    --shadow-hi:   0 4px 24px rgba(37,99,235,.14);
  }

  html, body { min-height: 100vh; background: var(--bg); color: var(--text); font-family: var(--sans); -webkit-font-smoothing: antialiased; }

  body {
    display: grid;
    place-items: start center;
    padding: 2.5rem 1rem 4rem;
    background-image:
      radial-gradient(ellipse 110% 55% at 50% -5%, rgba(37,99,235,.09) 0%, transparent 65%),
      linear-gradient(180deg, #eef2ff 0%, #f0f4ff 100%);
  }

  .shell { width: 100%; max-width: 600px; display: flex; flex-direction: column; gap: 1.25rem; }

  /* Header */
  header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border); }

  .logo { display: flex; align-items: center; gap: .875rem; }

  .logo-mark {
    width: 44px; height: 44px;
    background: var(--accent);
    border-radius: 13px;
    display: grid; place-items: center;
    box-shadow: 0 4px 16px var(--accent-glow);
    flex-shrink: 0;
  }
  .logo-mark svg { width: 22px; height: 22px; }

  .brand-name { font-size: 1.4rem; font-weight: 800; letter-spacing: -.02em; }
  .brand-sub  { font-family: var(--mono); font-size: .67rem; color: var(--muted); margin-top: 2px; letter-spacing: .04em; }

  .chip {
    font-family: var(--mono); font-size: .68rem;
    color: var(--accent); background: var(--accent-lo);
    border: 1px solid rgba(37,99,235,.18);
    border-radius: 20px; padding: 3px 10px;
  }

  /* Card */
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); padding: 1.5rem; box-shadow: var(--shadow); }

  .row-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: .75rem; }
  .row-label > span:first-child { font-size: .72rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }

  #word-count { font-family: var(--mono); font-size: .72rem; color: var(--muted); transition: color .2s; }
  #word-count.ok   { color: var(--green); }
  #word-count.warn { color: var(--amber); }
  #word-count.over { color: var(--red); }

  textarea {
    width: 100%; min-height: 160px;
    background: #f8faff; border: 1.5px solid var(--border); border-radius: 10px;
    color: var(--text); font-family: var(--mono); font-size: .875rem;
    line-height: 1.75; padding: .875rem 1rem; resize: vertical; outline: none;
    transition: border-color .2s, box-shadow .2s;
  }
  textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-lo); }
  textarea::placeholder { color: #b8c4e0; }

  .hint { font-family: var(--mono); font-size: .7rem; color: var(--muted); margin-top: .5rem; }

  /* Buttons */
  .btn {
    font-family: var(--sans); font-size: .9rem; font-weight: 600;
    cursor: pointer; border: none; border-radius: 10px;
    transition: all .15s; display: flex; align-items: center; justify-content: center; gap: .5rem;
  }
  .btn-primary {
    width: 100%; padding: .9rem;
    background: var(--accent); color: #fff; margin-top: 1rem;
    box-shadow: 0 2px 8px var(--accent-glow);
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hi); box-shadow: 0 6px 20px rgba(37,99,235,.3); transform: translateY(-1px); }
  .btn-primary:active:not(:disabled) { transform: none; }
  .btn-primary:disabled { opacity: .45; cursor: not-allowed; }

  .btn-outline {
    width: 100%; padding: .75rem;
    background: transparent; color: var(--accent);
    border: 1.5px solid var(--accent); margin-top: .5rem;
  }
  .btn-outline:hover { background: var(--accent-lo); }

  .btn-ghost {
    width: 100%; padding: .65rem;
    background: transparent; color: var(--muted);
    border: 1px solid var(--border); font-size: .82rem; margin-top: .5rem;
  }
  .btn-ghost:hover { color: var(--text); border-color: var(--border-hi); }

  /* Progress */
  #progress-section { display: none; }

  .prog-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: .875rem; }
  .prog-status { display: flex; align-items: center; gap: .5rem; font-size: .9rem; font-weight: 600; }

  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
  .dot.running { background: var(--accent); animation: blink 1.1s ease-in-out infinite; }
  .dot.done    { background: var(--green); animation: none; }
  .dot.error   { background: var(--red); animation: none; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

  .prog-ctr { font-family: var(--mono); font-size: .78rem; color: var(--muted); }

  .prog-track { background: var(--bg); border-radius: 4px; height: 5px; overflow: hidden; margin-bottom: 1rem; }
  .prog-fill { height: 100%; background: linear-gradient(90deg, var(--accent), #60a5fa); border-radius: 4px; transition: width .35s ease; width: 0%; }

  .log-box {
    background: #f8faff; border: 1px solid var(--border); border-radius: 10px;
    padding: .75rem 1rem; font-family: var(--mono); font-size: .73rem;
    line-height: 1.9; color: var(--muted); max-height: 200px; overflow-y: auto;
  }
  .log-box::-webkit-scrollbar { width: 3px; }
  .log-box::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 2px; }
  .log-line { white-space: pre-wrap; word-break: break-all; }
  .log-line.ok   { color: var(--green); }
  .log-line.warn { color: var(--amber); }
  .log-line.err  { color: var(--red); }
  .log-line.info { color: var(--accent); }

  /* Download */
  #download-section { display: none; }

  .dl-card {
    background: linear-gradient(135deg, #eff6ff 0%, #ffffff 55%);
    border: 1.5px solid rgba(37,99,235,.22);
    border-radius: var(--r); padding: 1.5rem;
    box-shadow: var(--shadow-hi);
  }
  .dl-title { font-size: .72rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: 1.1rem; }

  .qr-row { display: flex; gap: 1.5rem; align-items: flex-start; }

  .qr-wrap {
    flex-shrink: 0; padding: 8px;
    background: #fff; border: 2px solid var(--accent); border-radius: 12px;
    box-shadow: 0 2px 12px var(--accent-glow);
  }
  #qr-div { width: 120px; height: 120px; display: flex; align-items: center; justify-content: center; }
  #qr-div img, #qr-div canvas { border-radius: 4px; }

  .url-col { flex: 1; min-width: 0; }
  .url-lbl { font-size: .68rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: .4rem; }
  .url-chip {
    background: #eff6ff; border: 1px solid rgba(37,99,235,.2); border-radius: 7px;
    padding: .45rem .75rem; font-family: var(--mono); font-size: .75rem;
    color: var(--accent-hi); word-break: break-all; cursor: pointer; margin-bottom: .75rem;
    transition: border-color .2s, background .2s;
  }
  .url-chip:hover { border-color: var(--accent); background: #dbeafe; }
  .scan-tip { font-size: .75rem; color: var(--muted); line-height: 1.5; margin-bottom: .5rem; }

  .not-found {
    margin-top: 1rem; padding: .65rem .875rem;
    background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
    font-family: var(--mono); font-size: .72rem; color: var(--amber); line-height: 1.6;
  }
  .not-found strong { display: block; margin-bottom: 2px; font-family: var(--sans); }

  footer { text-align: center; font-family: var(--mono); font-size: .68rem; color: var(--muted); padding-top: .25rem; letter-spacing: .03em; }

  @media (max-width: 400px) { .qr-row { flex-direction: column; align-items: center; } }
</style>
</head>
<body>
<div class="shell">

  <header>
    <div class="logo">
      <div class="logo-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
      </div>
      <div>
        <div class="brand-name">WordMan</div>
        <div class="brand-sub">LDOCE5 · MDX/MDD → dist.zip</div>
      </div>
    </div>
    <div class="chip">● READY</div>
  </header>

  <!-- 输入 -->
  <div class="card" id="input-section">
    <div class="row-label">
      <span>输入单词</span>
      <span id="word-count">0 / 30</span>
    </div>
    <textarea id="words-input"
      placeholder="每行一个单词，或用空格 / 逗号分隔&#10;&#10;abandon&#10;benevolent&#10;cognitive"
      spellcheck="false"></textarea>
    <p class="hint">支持换行 · 空格 · 逗号，自动去重</p>
    <button class="btn btn-primary" id="submit-btn" disabled>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      生成 dist.zip
    </button>
  </div>

  <!-- 进度 -->
  <div class="card" id="progress-section">
    <div class="prog-hd">
      <div class="prog-status">
        <div class="dot" id="dot"></div>
        <span id="status-text">准备中…</span>
      </div>
      <span class="prog-ctr" id="prog-ctr">0 / 0</span>
    </div>
    <div class="prog-track"><div class="prog-fill" id="prog-fill"></div></div>
    <div class="log-box" id="log-box"></div>
  </div>

  <!-- 下载 -->
  <div id="download-section">
    <div class="dl-card">
      <div class="dl-title">📱 手机扫码下载 dist.zip</div>
      <div class="qr-row">
        <div class="qr-wrap"><div id="qr-div"></div></div>
        <div class="url-col">
          <div class="url-lbl">下载地址</div>
          <div class="url-chip" id="url-chip"></div>
          <p class="scan-tip">手机与电脑连同一 Wi-Fi，扫码即可下载</p>
          <button class="btn btn-outline" id="direct-btn">⬇ 直接下载到本机</button>
        </div>
      </div>
      <div id="not-found-block" style="display:none" class="not-found">
        <strong>⚠ 以下单词在词典中未找到</strong>
        <span id="not-found-words"></span>
      </div>
    </div>
    <button class="btn btn-ghost" id="reset-btn">↩ 重新提取</button>
  </div>

  <footer>词典本地加载 · 数据不上传 · 局域网访问</footer>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
const $ = id => document.getElementById(id);
const textarea    = $('words-input');
const wordCount   = $('word-count');
const submitBtn   = $('submit-btn');
const inputSec    = $('input-section');
const progressSec = $('progress-section');
const downloadSec = $('download-section');
const dot         = $('dot');
const statusText  = $('status-text');
const progFill    = $('prog-fill');
const progCtr     = $('prog-ctr');
const logBox      = $('log-box');
const urlChip     = $('url-chip');
const resetBtn    = $('reset-btn');
const directBtn   = $('direct-btn');
const notFoundBlk = $('not-found-block');
const notFoundWds = $('not-found-words');
const qrDiv       = $('qr-div');

let jobId = null, pollTimer = null, lastLogLen = 0;

function parseWords(raw) {
  return [...new Set(raw.split(/[\n,，\s]+/).map(w => w.trim()).filter(Boolean))];
}

textarea.addEventListener('input', () => {
  const n = parseWords(textarea.value).length;
  wordCount.textContent = `${n} / 30`;
  wordCount.className = n === 0 ? '' : n > 30 ? 'over' : n >= 25 ? 'warn' : 'ok';
  submitBtn.disabled = n === 0 || n > 30;
});

submitBtn.addEventListener('click', async () => {
  const words = parseWords(textarea.value);
  if (!words.length || words.length > 30) return;
  submitBtn.disabled = true;
  inputSec.style.display = 'none';
  progressSec.style.display = 'block';
  downloadSec.style.display = 'none';
  logBox.innerHTML = '';
  lastLogLen = 0;

  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({words: words.join('\n')}),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    jobId = data.job_id;
    pollTimer = setInterval(poll, 900);
  } catch(e) { showError(e.message); }
});

async function poll() {
  try {
    const res = await fetch(`/api/status/${jobId}`);
    const job = await res.json();
    const total = job.total || 1;
    const pct = Math.round(job.done_count / total * 100);
    progFill.style.width = pct + '%';
    progCtr.textContent = `${job.done_count} / ${total}`;
    if (job.status === 'running') { dot.className = 'dot running'; statusText.textContent = '正在提取…'; }
    const lines = job.progress || [];
    for (let i = lastLogLen; i < lines.length; i++) addLog(lines[i]);
    lastLogLen = lines.length;
    if (job.status === 'done') {
      clearInterval(pollTimer);
      progFill.style.width = '100%';
      dot.className = 'dot done';
      statusText.textContent = '提取完成 ✓';
      setTimeout(() => showDownload(job), 400);
    } else if (job.status === 'error') {
      clearInterval(pollTimer);
      showError(job.error || '未知错误');
    }
  } catch(e) {}
}

function addLog(line) {
  const div = document.createElement('div');
  const cls = /✅|✓|♪/.test(line) ? 'ok' : /⚠/.test(line) ? 'warn' : /✗|❌/.test(line) ? 'err' : /^\[/.test(line) ? 'info' : '';
  div.className = 'log-line' + (cls ? ' '+cls : '');
  div.textContent = line;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

function showError(msg) {
  dot.className = 'dot error';
  statusText.textContent = '出错了';
  addLog('❌ ' + msg);
}

function showDownload(job) {
  downloadSec.style.display = 'block';
  const url = `${location.origin}/api/download/${jobId}`;
  urlChip.textContent = url;
  urlChip.onclick = () => {
    navigator.clipboard.writeText(url).then(() => {
      urlChip.textContent = '✓ 已复制到剪贴板';
      setTimeout(() => urlChip.textContent = url, 1800);
    });
  };
  directBtn.onclick = () => { location.href = url; };

  // QR 码：传 div 元素
  qrDiv.innerHTML = '';
  if (window.QRCode) {
    new QRCode(qrDiv, {
      text: url,
      width: 120, height: 120,
      colorDark: '#1d4ed8',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } else {
    qrDiv.innerHTML = '<div style="font-size:.65rem;color:#8892b0;text-align:center;line-height:1.5;padding:8px">QR 库加载失败<br>请手动访问上方链接</div>';
  }

  if (job.not_found && job.not_found.length) {
    notFoundBlk.style.display = 'block';
    notFoundWds.textContent = job.not_found.join('、');
  }
}

resetBtn.addEventListener('click', () => {
  clearInterval(pollTimer);
  jobId = null; lastLogLen = 0;
  downloadSec.style.display = 'none';
  progressSec.style.display = 'none';
  inputSec.style.display = 'block';
  submitBtn.disabled = false;
  logBox.innerHTML = '';
  progFill.style.width = '0%';
  notFoundBlk.style.display = 'none';
  qrDiv.innerHTML = '';
  dot.className = 'dot';
});
</script>
</body>
</html>
"""


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