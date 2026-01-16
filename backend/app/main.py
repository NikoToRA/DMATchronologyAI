from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .api import sessions, participants, chronology, settings, zoom, session_hq, incidents
from .websocket.manager import connection_manager
from .services.storage import storage_service
from .config import settings as app_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Starting DMAT ChronologyAI Backend...")
    print(f"Environment: {app_settings.app_env}")
    print(f"Storage: {'Azure Blob' if storage_service.use_azure else 'Local'}")
    yield
    # Shutdown
    await storage_service.close()
    print("Shutting down...")


app = FastAPI(
    title="DMAT ChronologyAI API",
    description="災害医療チーム向けリアルタイムクロノロジー自動生成システム",
    version="1.0.0",
    lifespan=lifespan
)

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本番では適切に制限
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# APIルーター登録
app.include_router(sessions.router, prefix="/api")
app.include_router(incidents.router, prefix="/api")
app.include_router(participants.router, prefix="/api")
app.include_router(chronology.router, prefix="/api")
app.include_router(session_hq.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(zoom.router, prefix="/api")


@app.get("/")
async def root():
    return {
        "name": "DMAT ChronologyAI API",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


# WebSocketエンドポイント
@app.websocket("/ws")
async def websocket_global(websocket: WebSocket):
    """全体通知用WebSocket"""
    await connection_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # クライアントからのメッセージは現状処理しない（将来拡張用）
    except WebSocketDisconnect:
        connection_manager.disconnect(websocket)


@app.websocket("/ws/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str):
    """セッション固有のWebSocket"""
    await connection_manager.connect(websocket, session_id)
    try:
        while True:
            data = await websocket.receive_text()
            # クライアントからのメッセージは現状処理しない
    except WebSocketDisconnect:
        connection_manager.disconnect(websocket, session_id)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
