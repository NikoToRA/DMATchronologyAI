from contextlib import asynccontextmanager
from datetime import date
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .api import sessions, participants, chronology, settings, zoom, session_hq, incidents, chat
from .websocket.manager import connection_manager
from .services.storage import storage_service
from .config import settings as app_settings
from .models.schemas import Incident, Session, SessionKind

# 物資支援班専用UI用の災害設定
BUSSHI_INCIDENT_NAME = "2026年DMAT関東ブロック訓練"
BUSSHI_INCIDENT_DATE = date(2026, 1, 30)


async def ensure_busshi_incident():
    """物資支援班専用UIに必要な災害を作成（存在しない場合のみ）、不足セッションがあれば追加"""
    existing = await storage_service.list_incidents()
    target_incident = None
    for inc in existing:
        if inc.incident_name == BUSSHI_INCIDENT_NAME:
            target_incident = inc
            break

    kind_labels = {
        SessionKind.ACTIVITY_COMMAND: "活動指揮",
        SessionKind.TRANSPORT_COORDINATION: "搬送調整",
        SessionKind.INFO_ANALYSIS: "情報分析",
        SessionKind.LOGISTICS_SUPPORT: "物資支援",
    }
    required_kinds = [
        SessionKind.ACTIVITY_COMMAND,
        SessionKind.TRANSPORT_COORDINATION, 
        SessionKind.INFO_ANALYSIS, 
        SessionKind.LOGISTICS_SUPPORT
    ]

    if target_incident:
        print(f"  Busshi incident found: {target_incident.incident_id}")
        
        # 不足しているセッションを確認・作成
        updated = False
        current_sessions = target_incident.sessions or {}
        
        for kind in required_kinds:
            if kind not in current_sessions:
                print(f"    Missing session kind: {kind}. Creating...")
                title = f"{BUSSHI_INCIDENT_NAME} {BUSSHI_INCIDENT_DATE.strftime('%Y/%m/%d')} {kind_labels[kind]}"
                session = Session(
                    title=title,
                    session_kind=kind,
                    incident_name=BUSSHI_INCIDENT_NAME,
                    incident_date=BUSSHI_INCIDENT_DATE,
                    incident_id=target_incident.incident_id,
                    zoom_meeting_id=None,
                )
                created_session = await storage_service.create_session(session)
                current_sessions[kind] = created_session.session_id
                updated = True
        
        if updated:
             # update_incidentには変更するフィールドのdictを渡す
             await storage_service.update_incident(target_incident.incident_id, {"sessions": current_sessions})
             print("    Updated incident with missing sessions.")
             
        return target_incident

    # 災害を新規作成
    print(f"  Creating busshi incident: {BUSSHI_INCIDENT_NAME}")
    incident = Incident(
        incident_name=BUSSHI_INCIDENT_NAME,
        incident_date=BUSSHI_INCIDENT_DATE,
    )

    # 4つの部門セッションを作成
    for kind in required_kinds:
        title = f"{BUSSHI_INCIDENT_NAME} {BUSSHI_INCIDENT_DATE.strftime('%Y/%m/%d')} {kind_labels[kind]}"
        session = Session(
            title=title,
            session_kind=kind,
            incident_name=BUSSHI_INCIDENT_NAME,
            incident_date=BUSSHI_INCIDENT_DATE,
            incident_id=incident.incident_id,
            zoom_meeting_id=None,
        )
        created = await storage_service.create_session(session)
        incident.sessions[kind] = created.session_id

    created_incident = await storage_service.create_incident(incident)
    print(f"  Busshi incident created: {created_incident.incident_id}")
    return created_incident


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Starting DMAT ChronologyAI Backend...")
    print(f"Environment: {app_settings.app_env}")
    print(f"Storage: {'Azure Blob' if storage_service.use_azure else 'Local'}")

    # 物資支援班専用災害の自動作成
    try:
        await ensure_busshi_incident()
    except Exception as e:
        print(f"  Warning: Failed to ensure busshi incident: {e}")

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
app.include_router(chat.router, prefix="/api")


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
