"""
sdxl-kube Backend API — standalone FastAPI server.

Runs SDXL + LoRA inference on GPU, saves generated images to S3.
Designed to run in a Kubernetes pod with GPU access.

Environment variables:
    AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — S3 credentials
    S3_BUCKET — bucket name (default: sdxl-kube-gallery)
    S3_REGION — AWS region (default: us-east-1)
    HF_TOKEN — HuggingFace token for model download
    ADAPTER_PATH — path to LoRA adapter weights (local or S3)
    MODEL_ID — base model (default: stabilityai/stable-diffusion-xl-base-1.0)
"""

import io
import os
import time
import uuid

import boto3
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="sdxl-kube API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Config ---
MODEL_ID = os.environ.get("MODEL_ID", "stabilityai/stable-diffusion-xl-base-1.0")
VAE_ID = os.environ.get("VAE_ID", "madebyollin/sdxl-vae-fp16-fix")
ADAPTER_PATH = os.environ.get("ADAPTER_PATH", "/models/adapters/v1")
S3_BUCKET = os.environ.get("S3_BUCKET", "sdxl-kube-gallery")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
NEGATIVE_PROMPT = (
    "blurry, low quality, distorted, deformed, ugly, bad anatomy, "
    "watermark, signature, text, logo"
)

# --- Global state (loaded once at startup) ---
pipeline = None
s3_client = None


def load_pipeline():
    """Load SDXL + LoRA pipeline. Called once at startup."""
    global pipeline, s3_client

    from diffusers import AutoencoderKL, StableDiffusionXLPipeline

    print(f"Loading VAE from {VAE_ID}...")
    vae = AutoencoderKL.from_pretrained(VAE_ID, torch_dtype=torch.float16)

    print(f"Loading base model from {MODEL_ID}...")
    pipeline = StableDiffusionXLPipeline.from_pretrained(
        MODEL_ID,
        vae=vae,
        torch_dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
    ).to("cuda")

    # Optimizations
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    pipeline.unet.to(memory_format=torch.channels_last)
    pipeline.vae.to(memory_format=torch.channels_last)

    # Load LoRA adapter
    if os.path.exists(ADAPTER_PATH):
        print(f"Loading LoRA adapter from {ADAPTER_PATH}...")
        pipeline.load_lora_weights(ADAPTER_PATH)
    else:
        print(f"WARNING: LoRA adapter not found at {ADAPTER_PATH}, running base model only")

    # Warm-up inference (primes CUDA kernels)
    print("Running warm-up inference...")
    t0 = time.perf_counter()
    pipeline(
        prompt="hopper style painting, warm-up",
        negative_prompt=NEGATIVE_PROMPT,
        width=512,
        height=512,
        num_inference_steps=5,
        generator=torch.Generator("cuda").manual_seed(0),
    )
    print(f"Warm-up complete in {time.perf_counter() - t0:.1f}s")

    # S3 client
    s3_client = boto3.client("s3", region_name=S3_REGION)
    print("Pipeline ready.")


@app.on_event("startup")
async def startup():
    load_pipeline()


# --- Models ---
class GenerateRequest(BaseModel):
    prompt: str
    runName: str | None = None
    adapterName: str = "v1"
    guidanceScale: float = 7.5
    numSteps: int = 50
    width: int = 1024
    height: int = 1024


class GenerateResponse(BaseModel):
    modal_path: str  # kept for compatibility with existing FE
    s3_url: str
    content_type: str = "image/png"
    width: int
    height: int
    inference_time_s: float


# --- Routes ---
@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": pipeline is not None,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    if pipeline is None:
        raise HTTPException(503, "Model not loaded yet")

    run_name = req.runName or f"gen-{uuid.uuid4().hex[:8]}"
    s3_key = f"generated/{run_name}.png"

    t0 = time.perf_counter()
    result = pipeline(
        prompt=req.prompt,
        negative_prompt=NEGATIVE_PROMPT,
        width=req.width,
        height=req.height,
        guidance_scale=req.guidanceScale,
        num_inference_steps=req.numSteps,
        generator=torch.Generator("cuda"),
    ).images[0]
    inference_time = time.perf_counter() - t0

    # Save to S3
    buf = io.BytesIO()
    result.save(buf, format="PNG", quality=95)
    buf.seek(0)
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=s3_key,
        Body=buf.getvalue(),
        ContentType="image/png",
    )

    s3_url = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{s3_key}"

    print(f"Generated {run_name} in {inference_time:.2f}s → {s3_url}")

    return GenerateResponse(
        modal_path=s3_key,
        s3_url=s3_url,
        width=req.width,
        height=req.height,
        inference_time_s=round(inference_time, 2),
    )
