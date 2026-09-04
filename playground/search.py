"""
Search images by text prompt using Titan Embed Image V1 + cosine similarity.

Usage:
    # Build the index (run once, or re-run to add new images):
    python search.py --index <image_dir>

    # Search:
    python search.py --search "snowy mountain peak"
    python search.py --search "foggy valley" --top 3
"""

import sys
import json
import base64
import io
import math
import argparse
import glob
import os
import boto3
from PIL import Image

MAX_EDGE   = 1024
MODEL_ID   = "amazon.titan-embed-image-v1"
INDEX_FILE = "embeddings.json"

client = boto3.client("bedrock-runtime", region_name="us-east-1")


# ── Helpers ───────────────────────────────────────────────────────────────────

def image_to_b64(image_path):
    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    if max(w, h) > MAX_EDGE:
        scale = MAX_EDGE / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.standard_b64encode(buf.getvalue()).decode("utf-8")


def embed_image(image_path):
    body = {"inputImage": image_to_b64(image_path)}
    resp = client.invoke_model(modelId=MODEL_ID, body=json.dumps(body))
    return json.loads(resp["body"].read())["embedding"]


def embed_text(text):
    body = {"inputText": text}
    resp = client.invoke_model(modelId=MODEL_ID, body=json.dumps(body))
    return json.loads(resp["body"].read())["embedding"]


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0


# ── Index ─────────────────────────────────────────────────────────────────────

def build_index(image_dir):
    exts = ("*.jpg", "*.jpeg", "*.png", "*.webp")
    paths = []
    for ext in exts:
        paths.extend(glob.glob(os.path.join(image_dir, "**", ext), recursive=True))
    paths.sort()

    # Load existing index so we skip already-embedded images
    index = {}
    if os.path.exists(INDEX_FILE):
        with open(INDEX_FILE) as f:
            index = json.load(f)

    new_count = 0
    for path in paths:
        if path in index:
            print(f"  skip  {path}")
            continue
        print(f"  embed {path} ...", end=" ", flush=True)
        try:
            index[path] = embed_image(path)
            print("ok")
            new_count += 1
        except Exception as e:
            print(f"ERROR: {e}")

    with open(INDEX_FILE, "w") as f:
        json.dump(index, f)

    print(f"\nIndex saved to {INDEX_FILE}  ({len(index)} total, {new_count} new)")


# ── Search ────────────────────────────────────────────────────────────────────

def search(prompt, top_k=1):
    if not os.path.exists(INDEX_FILE):
        print(f"No index found. Run: python search.py --index <image_dir>")
        sys.exit(1)

    with open(INDEX_FILE) as f:
        index = json.load(f)

    print(f"Embedding prompt: \"{prompt}\" ...")
    query_vec = embed_text(prompt)

    scores = [
        (path, cosine_similarity(query_vec, vec))
        for path, vec in index.items()
    ]
    scores.sort(key=lambda x: x[1], reverse=True)

    print(f"\nTop {top_k} result(s) for \"{prompt}\":\n")
    for rank, (path, score) in enumerate(scores[:top_k], 1):
        print(f"  {rank}.  {path}  (score: {score:.4f})")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--index",  metavar="DIR", help="Directory of images to index")
    parser.add_argument("--search", metavar="PROMPT", help="Text prompt to search")
    parser.add_argument("--top",    metavar="N", type=int, default=1)
    args = parser.parse_args()

    if args.index:
        build_index(args.index)
    elif args.search:
        search(args.search, top_k=args.top)
    else:
        parser.print_help()
