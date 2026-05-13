from fastapi import FastAPI
from uuid import uuid4

app = FastAPI(title="sdxl-kube fake API")

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/items/{user_name}")
async def read_item(user_name: str):
    resp = {"id": str(uuid4()), "name": user_name}
    return resp
