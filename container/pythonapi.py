from fastapi import FastAPI
from pydantic import BaseModel
from uuid import uuid4
import time

app = FastAPI(title="sdxl-kube fake API")

class GenerateRequest(BaseModel):
    prompt: str
    runName: str | None = None
    width: int = 1024
    height: int = 1024

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/generate")
async def generate(req: GenerateRequest):
    start = time.perf_counter()
    run_name = str(uuid4().hex)[:8]
    path = f"generated/{run_name}.png"

    return {
        "modal_path": path,
        "s3_url": f"https://mock-sdxl-kube.local/{path}",
        "content_type": "image/png",
        "width": req.width,
        "height": req.height,
        "inference_time_s": round(time.perf_counter() - start, 2),
    }


@app.get("/items/{user_name}")
async def read_item(user_name: str):
    resp = {"id": str(uuid4()), "name": user_name}
    return resp
