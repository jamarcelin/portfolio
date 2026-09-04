"""
Compare embedding methods for photo search quality.

Setup:
    pip install open-clip-torch torch Pillow requests boto3
    pip install transformers accelerate qwen-omni-utils  # for lco-omni

Workflow:
    # 1. Download thumbnails from the live manifest
    python compare.py --download

    # 2. Build embedding index for each method
    python compare.py --index titan           # requires AWS creds
    python compare.py --index clip-vitb32     # local, ~600 MB model download on first run
    python compare.py --index clip-vitl14     # local, ~890 MB, higher quality
    python compare.py --index lco-omni        # local, ~14 GB model, Apple Silicon recommended

    # 3. Search and compare all indexed methods
    python compare.py --search "cherry blossoms at golden hour"
    python compare.py --search "moody fog in the mountains" --top 8

    # List available methods (what's been indexed)
    python compare.py --list
"""

import argparse
import base64
import io
import json
import math
import os
import sys
from pathlib import Path

import requests
from PIL import Image

# ── Paths ─────────────────────────────────────────────────────────────────────

PLAYGROUND = Path(__file__).parent
CACHE_DIR  = PLAYGROUND / "cache"
IMAGE_DIR  = CACHE_DIR / "images"
INDEX_DIR  = CACHE_DIR / "indices"

MANIFEST_URL = "https://joshs-photo-storage.s3.amazonaws.com/bin/manifest.json"

TITAN_MODEL_ID = "amazon.titan-embed-image-v1"
TITAN_MAX_EDGE = 1024


# ── Similarity ────────────────────────────────────────────────────────────────

def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0


def cosine_similarity_np(a, b):
    import numpy as np
    a, b = np.array(a), np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))


# ── Download helpers ───────────────────────────────────────────────────────────

def download_thumbnails():
    """Download all thumbnails from the live manifest into IMAGE_DIR."""
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Fetching manifest from {MANIFEST_URL} ...")
    r = requests.get(MANIFEST_URL, timeout=15)
    r.raise_for_status()
    photos = r.json()
    print(f"  {len(photos)} photos in manifest")

    skipped, downloaded, failed = 0, 0, 0
    for p in photos:
        thumb_url = p.get("thumb") or p.get("src")
        if not thumb_url:
            continue
        fname = thumb_url.split("/")[-1]
        dest = IMAGE_DIR / fname

        if dest.exists():
            skipped += 1
            continue

        try:
            img_r = requests.get(thumb_url, timeout=20)
            img_r.raise_for_status()
            dest.write_bytes(img_r.content)
            print(f"  ↓  {fname}")
            downloaded += 1
        except Exception as e:
            print(f"  ✗  {fname}: {e}")
            failed += 1

    print(f"\nDone — {downloaded} downloaded, {skipped} already cached, {failed} failed")
    print(f"Images at: {IMAGE_DIR}")


# ── Titan (AWS Bedrock) ────────────────────────────────────────────────────────

def _titan_client():
    import boto3
    return boto3.client("bedrock-runtime", region_name="us-east-1")


def _titan_image_to_b64(image_path):
    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    if max(w, h) > TITAN_MAX_EDGE:
        scale = TITAN_MAX_EDGE / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.standard_b64encode(buf.getvalue()).decode()


def titan_embed_image(client, image_path):
    body = {"inputImage": _titan_image_to_b64(image_path)}
    resp = client.invoke_model(modelId=TITAN_MODEL_ID, body=json.dumps(body))
    return json.loads(resp["body"].read())["embedding"]


def titan_embed_text(client, text):
    body = {"inputText": text}
    resp = client.invoke_model(modelId=TITAN_MODEL_ID, body=json.dumps(body))
    return json.loads(resp["body"].read())["embedding"]


def build_titan_index():
    images = sorted(IMAGE_DIR.glob("*.jpg")) + sorted(IMAGE_DIR.glob("*.png"))
    if not images:
        print(f"No images in {IMAGE_DIR}. Run --download first.")
        sys.exit(1)

    index_path = INDEX_DIR / "titan.json"
    index = {}
    if index_path.exists():
        with open(index_path) as f:
            index = json.load(f)

    client = _titan_client()
    new_count = 0
    for img_path in images:
        key = img_path.name
        if key in index:
            print(f"  skip  {key}")
            continue
        print(f"  embed {key} ...", end=" ", flush=True)
        try:
            index[key] = titan_embed_image(client, img_path)
            print("ok")
            new_count += 1
        except Exception as e:
            print(f"ERROR: {e}")

    with open(index_path, "w") as f:
        json.dump(index, f)
    print(f"\nTitan index: {len(index)} total, {new_count} new  →  {index_path}")


def search_titan(prompt, top_k):
    index_path = INDEX_DIR / "titan.json"
    if not index_path.exists():
        return None, "not indexed — run: python compare.py --index titan"

    with open(index_path) as f:
        index = json.load(f)

    client = _titan_client()
    qvec = titan_embed_text(client, prompt)

    scores = [(k, cosine_similarity(qvec, v)) for k, v in index.items()]
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:top_k], None


# ── Amazon Nova Multimodal Embeddings ─────────────────────────────────────────

NOVA_MODEL_ID = "amazon.nova-2-multimodal-embeddings-v1:0"
NOVA_DIM      = 1024   # 256 | 384 | 1024 | 3072


def nova_embed_image(client, image_path):
    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    if max(w, h) > TITAN_MAX_EDGE:
        scale = TITAN_MAX_EDGE / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = base64.standard_b64encode(buf.getvalue()).decode()

    body = {
        "taskType": "SINGLE_EMBEDDING",
        "singleEmbeddingParams": {
            "embeddingPurpose": "GENERIC_INDEX",
            "embeddingDimension": NOVA_DIM,
            "image": {
                "format": "jpeg",
                "detailLevel": "STANDARD_IMAGE",
                "source": {"bytes": b64},
            },
        },
    }
    resp = client.invoke_model(modelId=NOVA_MODEL_ID, body=json.dumps(body))
    return json.loads(resp["body"].read())["embeddings"][0]["embedding"]


def nova_embed_text(client, text):
    body = {
        "taskType": "SINGLE_EMBEDDING",
        "singleEmbeddingParams": {
            "embeddingPurpose": "GENERIC_INDEX",
            "embeddingDimension": NOVA_DIM,
            "text": {"truncationMode": "END", "value": text},
        },
    }
    resp = client.invoke_model(modelId=NOVA_MODEL_ID, body=json.dumps(body))
    return json.loads(resp["body"].read())["embeddings"][0]["embedding"]


def build_nova_index():
    images = sorted(IMAGE_DIR.glob("*.jpg")) + sorted(IMAGE_DIR.glob("*.png"))
    if not images:
        print(f"No images in {IMAGE_DIR}. Run --download first.")
        sys.exit(1)

    index_path = INDEX_DIR / "nova.json"
    index = {}
    if index_path.exists():
        with open(index_path) as f:
            index = json.load(f)

    client = _titan_client()   # same bedrock-runtime client
    new_count = 0
    for img_path in images:
        key = img_path.name
        if key in index:
            print(f"  skip  {key}")
            continue
        print(f"  embed {key} ...", end=" ", flush=True)
        try:
            index[key] = nova_embed_image(client, img_path)
            print("ok")
            new_count += 1
        except Exception as e:
            print(f"ERROR: {e}")

    with open(index_path, "w") as f:
        json.dump(index, f)
    print(f"\nNova index: {len(index)} total, {new_count} new  →  {index_path}")


def search_nova(prompt, top_k):
    index_path = INDEX_DIR / "nova.json"
    if not index_path.exists():
        return None, "not indexed — run: python compare.py --index nova"

    with open(index_path) as f:
        index = json.load(f)

    client = _titan_client()
    qvec = nova_embed_text(client, prompt)

    scores = [(k, cosine_similarity(qvec, v)) for k, v in index.items()]
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:top_k], None


# ── CLIP (open-clip-torch) ─────────────────────────────────────────────────────

CLIP_MODELS = {
    "clip-vitb32": ("ViT-B-32", "openai"),
    "clip-vitl14": ("ViT-L-14", "openai"),
}


def _load_clip(method):
    try:
        import open_clip
        import torch
    except ImportError:
        print("open-clip-torch not installed. Run: pip install open-clip-torch torch")
        sys.exit(1)

    arch, pretrained = CLIP_MODELS[method]
    print(f"  Loading {arch} ({pretrained}) ...")
    model, _, preprocess = open_clip.create_model_and_transforms(arch, pretrained=pretrained)
    tokenizer = open_clip.get_tokenizer(arch)
    model.eval()
    return model, preprocess, tokenizer


def build_clip_index(method):
    import torch

    images = sorted(IMAGE_DIR.glob("*.jpg")) + sorted(IMAGE_DIR.glob("*.png"))
    if not images:
        print(f"No images in {IMAGE_DIR}. Run --download first.")
        sys.exit(1)

    index_path = INDEX_DIR / f"{method}.json"
    index = {}
    if index_path.exists():
        with open(index_path) as f:
            index = json.load(f)

    model, preprocess, _ = _load_clip(method)

    new_count = 0
    with torch.no_grad():
        for img_path in images:
            key = img_path.name
            if key in index:
                print(f"  skip  {key}")
                continue
            print(f"  embed {key} ...", end=" ", flush=True)
            try:
                img = preprocess(Image.open(img_path).convert("RGB")).unsqueeze(0)
                vec = model.encode_image(img)
                vec = vec / vec.norm(dim=-1, keepdim=True)  # L2-normalize
                index[key] = vec.squeeze().tolist()
                print("ok")
                new_count += 1
            except Exception as e:
                print(f"ERROR: {e}")

    with open(index_path, "w") as f:
        json.dump(index, f)
    print(f"\n{method} index: {len(index)} total, {new_count} new  →  {index_path}")


def search_clip(method, prompt, top_k):
    import torch

    index_path = INDEX_DIR / f"{method}.json"
    if not index_path.exists():
        return None, f"not indexed — run: python compare.py --index {method}"

    with open(index_path) as f:
        index = json.load(f)

    model, _, tokenizer = _load_clip(method)

    with torch.no_grad():
        tokens = tokenizer([prompt])
        qvec = model.encode_text(tokens)
        qvec = qvec / qvec.norm(dim=-1, keepdim=True)
        qvec = qvec.squeeze().tolist()

    scores = [(k, cosine_similarity_np(qvec, v)) for k, v in index.items()]
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:top_k], None


# ── LCO-Embedding-Omni-7B ─────────────────────────────────────────────────────

LCO_MODEL_ID  = "LCO-Embedding/LCO-Embedding-Omni-7B"
LCO_IMG_PROMPT  = "\nSummarize the above image in one word:"
LCO_TEXT_PROMPT = "{}\nSummarize the above text in one word:"

_lco_model = None
_lco_processor = None


def _load_lco():
    global _lco_model, _lco_processor
    if _lco_model is not None:
        return _lco_model, _lco_processor

    try:
        import torch
        from transformers import Qwen2_5OmniThinkerForConditionalGeneration, Qwen2_5OmniProcessor
    except ImportError:
        print("transformers not installed. Run: pip install transformers accelerate qwen-omni-utils")
        sys.exit(1)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    dtype  = torch.bfloat16

    print(f"  Loading {LCO_MODEL_ID} on {device} ({dtype}) …")
    print("  (first run downloads ~14 GB — this will take a while)")

    _lco_processor = Qwen2_5OmniProcessor.from_pretrained(LCO_MODEL_ID)
    _lco_model = Qwen2_5OmniThinkerForConditionalGeneration.from_pretrained(
        LCO_MODEL_ID,
        torch_dtype=dtype,
        device_map=device,
    )
    _lco_model.eval()
    print("  Model loaded.")
    return _lco_model, _lco_processor


def lco_embed_image(image_path):
    import torch
    from qwen_omni_utils import process_mm_info

    model, processor = _load_lco()
    device = next(model.parameters()).device

    img = Image.open(image_path).convert("RGB")
    messages = [[{
        "role": "user",
        "content": [
            {"type": "image", "image": img},
            {"type": "text",  "text": LCO_IMG_PROMPT},
        ],
    }]]

    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    audio_in, image_in, video_in = process_mm_info(messages, use_audio_in_video=False)

    inputs = processor(
        text=text, audio=audio_in, images=image_in, videos=video_in,
        return_tensors="pt", padding=True,
    ).to(device)

    with torch.no_grad():
        hidden = model(**inputs, output_hidden_states=True, return_dict=True).hidden_states[-1]
        vec = hidden[:, -1, :].float()
        vec = vec / vec.norm(dim=-1, keepdim=True)
    return vec.squeeze().tolist()


def lco_embed_text(text):
    import torch

    model, processor = _load_lco()
    device = next(model.parameters()).device

    prompt = LCO_TEXT_PROMPT.format(text)
    messages = [[{"role": "user", "content": [{"type": "text", "text": prompt}]}]]

    text_input = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=text_input, return_tensors="pt", padding=True).to(device)

    with torch.no_grad():
        hidden = model(**inputs, output_hidden_states=True, return_dict=True).hidden_states[-1]
        vec = hidden[:, -1, :].float()
        vec = vec / vec.norm(dim=-1, keepdim=True)
    return vec.squeeze().tolist()


def build_lco_index():
    images = sorted(IMAGE_DIR.glob("*.jpg")) + sorted(IMAGE_DIR.glob("*.png"))
    if not images:
        print(f"No images in {IMAGE_DIR}. Run --download first.")
        sys.exit(1)

    index_path = INDEX_DIR / "lco-omni.json"
    index = {}
    if index_path.exists():
        with open(index_path) as f:
            index = json.load(f)

    # Load model once before the loop
    _load_lco()

    new_count = 0
    for img_path in images:
        key = img_path.name
        if key in index:
            print(f"  skip  {key}")
            continue
        print(f"  embed {key} ...", end=" ", flush=True)
        try:
            index[key] = lco_embed_image(img_path)
            print("ok")
            new_count += 1
            # Flush to disk every 10 images so progress isn't lost on interrupt
            if new_count % 10 == 0:
                with open(index_path, "w") as f:
                    json.dump(index, f)
        except Exception as e:
            print(f"ERROR: {e}")

    with open(index_path, "w") as f:
        json.dump(index, f)
    print(f"\nlco-omni index: {len(index)} total, {new_count} new  →  {index_path}")


def search_lco(prompt, top_k):
    index_path = INDEX_DIR / "lco-omni.json"
    if not index_path.exists():
        return None, "not indexed — run: python compare.py --index lco-omni"

    with open(index_path) as f:
        index = json.load(f)

    qvec = lco_embed_text(prompt)

    scores = [(k, cosine_similarity_np(qvec, v)) for k, v in index.items()]
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:top_k], None


# ── Search ────────────────────────────────────────────────────────────────────

ALL_METHODS = ["titan", "nova", "clip-vitb32", "clip-vitl14", "lco-omni"]


def search_all(prompt, top_k):
    print(f'\nQuery: "{prompt}"  (top {top_k})\n')
    print("=" * 70)

    any_results = False
    for method in ALL_METHODS:
        index_path = INDEX_DIR / f"{method}.json"
        if not index_path.exists():
            continue

        any_results = True
        print(f"\n{'─'*70}")
        print(f"  Method: {method}")
        print(f"{'─'*70}")

        if method == "titan":
            results, err = search_titan(prompt, top_k)
        elif method == "nova":
            results, err = search_nova(prompt, top_k)
        elif method == "lco-omni":
            results, err = search_lco(prompt, top_k)
        else:
            results, err = search_clip(method, prompt, top_k)

        if err:
            print(f"  Error: {err}")
            continue

        for rank, (fname, score) in enumerate(results, 1):
            bar = "█" * int(score * 30)
            print(f"  {rank:2d}.  {score:.4f}  {bar:<30}  {fname}")

    if not any_results:
        print("No indices found. Run --index <method> first.")


def search_json(prompt, top_k):
    """Return search results as a JSON-serialisable dict (for machine consumers)."""
    import sys
    output = {"query": prompt, "top": top_k, "methods": {}}

    for method in ALL_METHODS:
        index_path = INDEX_DIR / f"{method}.json"
        if not index_path.exists():
            continue

        if method == "titan":
            results, err = search_titan(prompt, top_k)
        elif method == "nova":
            results, err = search_nova(prompt, top_k)
        elif method == "lco-omni":
            results, err = search_lco(prompt, top_k)
        else:
            results, err = search_clip(method, prompt, top_k)

        if err:
            output["methods"][method] = {"error": err}
        else:
            output["methods"][method] = [
                {"rank": rank, "file": fname, "score": round(score, 6)}
                for rank, (fname, score) in enumerate(results, 1)
            ]

    return output


# ── List ──────────────────────────────────────────────────────────────────────

def list_indices():
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Available indices in {INDEX_DIR}:\n")
    found = False
    for method in ALL_METHODS:
        p = INDEX_DIR / f"{method}.json"
        if p.exists():
            with open(p) as f:
                count = len(json.load(f))
            size_kb = p.stat().st_size // 1024
            print(f"  {method:<20}  {count} images  ({size_kb} KB)")
            found = True
    if not found:
        print("  (none yet — run --index <method>)")
    print()
    images = list(IMAGE_DIR.glob("*.jpg")) + list(IMAGE_DIR.glob("*.png")) if IMAGE_DIR.exists() else []
    print(f"Cached images: {len(images)} in {IMAGE_DIR}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Compare embedding methods for photo search",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--download", action="store_true", help="Download thumbnails from manifest")
    parser.add_argument("--index",  metavar="METHOD", help=f"Build index: {', '.join(ALL_METHODS)}")
    parser.add_argument("--search", metavar="QUERY",  help="Text query to search across all indexed methods")
    parser.add_argument("--top",    metavar="N", type=int, default=5, help="Number of results (default 5)")
    parser.add_argument("--list",   action="store_true", help="List available indices")
    parser.add_argument("--json",   action="store_true", help="Output search results as JSON (for machine consumers)")
    args = parser.parse_args()

    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    if args.download:
        download_thumbnails()
    elif args.index:
        method = args.index.lower()
        if method not in ALL_METHODS:
            print(f"Unknown method '{method}'. Choose from: {', '.join(ALL_METHODS)}")
            sys.exit(1)
        if not IMAGE_DIR.exists():
            print(f"No image cache found. Run --download first.")
            sys.exit(1)
        if method == "titan":
            build_titan_index()
        elif method == "nova":
            build_nova_index()
        elif method == "lco-omni":
            build_lco_index()
        else:
            build_clip_index(method)
    elif args.search:
        if args.json:
            result = search_json(args.search, args.top)
            import json as _json
            print(_json.dumps(result))
        else:
            search_all(args.search, args.top)
    elif args.list:
        list_indices()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
