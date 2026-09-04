"""
POC: Generate an image embedding using Amazon Titan Embed Image V1.

Usage:
    python test.py <image_path> [optional text]

Examples:
    python test.py photo.jpg
    python test.py photo.jpg "sunset over mountains"
"""

import sys
import json
import base64
import io
import boto3
from PIL import Image

MAX_EDGE = 1024
MODEL_ID = "amazon.titan-embed-image-v1"


def load_and_resize(image_path):
    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    if max(w, h) > MAX_EDGE:
        scale = MAX_EDGE / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    print(f"Image: {image_path}  →  {img.size[0]}×{img.size[1]} px  ({len(buf.getvalue())/1024:.1f} KB)")
    return base64.standard_b64encode(buf.getvalue()).decode("utf-8")


def main():
    if len(sys.argv) < 2:
        print("Usage: python test.py <image_path> [optional text]")
        sys.exit(1)

    image_path = sys.argv[1]
    input_text = sys.argv[2] if len(sys.argv) > 2 else None

    image_b64 = load_and_resize(image_path)

    body = {"inputImage": image_b64}
    if input_text:
        body["inputText"] = input_text

    client = boto3.client("bedrock-runtime", region_name="us-east-1")
    response = client.invoke_model(modelId=MODEL_ID, body=json.dumps(body))
    result = json.loads(response["body"].read())

    embedding = result["embedding"]
    print(f"Embedding dimensions : {len(embedding)}")
    print(f"First 8 values       : {[round(v, 6) for v in embedding[:8]]}")
    if input_text:
        print(f"Input text           : {input_text}")


if __name__ == "__main__":
    main()
