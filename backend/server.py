"""
FastAPI server with Excel upload + WebSocket for real-time ITSM QA evaluation.
"""

import asyncio
import json
import os
import uuid
import time
from typing import Dict, List
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from sample_data import QA_PARAMETERS, AGENT_GROUPS
from excel_parser import parse_excel, validate_tickets, get_ticket_summary
from agent_engine import run_full_evaluation

app = FastAPI(title="ITSM QA Agent Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── State ───
class AppState:
    """Holds uploaded tickets and session state."""
    def __init__(self):
        self.tickets: List[Dict] = []
        self.upload_info: Dict = {}
        self.active_sessions: Dict[str, bool] = {}

state = AppState()


# ─── Connection Manager ───
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
    
    def disconnect(self, client_id: str):
        self.active_connections.pop(client_id, None)
    
    async def send_event(self, client_id: str, event: dict):
        ws = self.active_connections.get(client_id)
        if ws:
            try:
                await ws.send_json(event)
            except Exception:
                self.disconnect(client_id)
    
    async def broadcast(self, event: dict):
        disconnected = []
        for client_id, ws in self.active_connections.items():
            try:
                await ws.send_json(event)
            except Exception:
                disconnected.append(client_id)
        for cid in disconnected:
            self.disconnect(cid)

manager = ConnectionManager()


# ─── REST Endpoints ───

@app.get("/api/health")
async def health_check():
    api_key = os.getenv("GEMINI_API_KEY", "")
    return {
        "status": "ok",
        "api_key_configured": len(api_key) > 0,
        "tickets_loaded": len(state.tickets),
        "qa_parameters": len(QA_PARAMETERS),
        "agent_groups": len(AGENT_GROUPS),
    }


@app.post("/api/upload")
async def upload_excel(file: UploadFile = File(...)):
    """Upload an Excel file and parse tickets from the 'Incidents' sheet."""
    if not file.filename.endswith(('.xlsx', '.xls', '.xlsm')):
        raise HTTPException(status_code=400, detail="Please upload an Excel file (.xlsx)")
    
    try:
        file_bytes = await file.read()
        tickets = parse_excel(file_bytes, sheet_name="Incidents")
        validation = validate_tickets(tickets)
        
        if not validation["valid"]:
            raise HTTPException(status_code=400, detail=validation.get("error", "Invalid file"))
        
        # Store tickets in state
        state.tickets = tickets
        state.upload_info = {
            "filename": file.filename,
            "uploaded_at": time.time(),
            **validation,
        }
        
        return {
            "success": True,
            "filename": file.filename,
            **validation,
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse Excel: {str(e)}")


@app.get("/api/tickets")
async def get_tickets():
    """Return parsed ticket summaries."""
    if not state.tickets:
        return {"tickets": [], "upload_info": None}
    
    return {
        "tickets": [get_ticket_summary(t) for t in state.tickets],
        "upload_info": state.upload_info,
    }


@app.get("/api/parameters")
async def get_parameters():
    return {
        "parameters": QA_PARAMETERS,
        "groups": AGENT_GROUPS,
    }


# ─── WebSocket Endpoint ───

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            
            if action == "start_evaluation":
                if not state.tickets:
                    await manager.send_event(client_id, {
                        "type": "session_error",
                        "error": "No tickets loaded. Please upload an Excel file first.",
                        "timestamp": time.time(),
                    })
                    continue
                
                session_id = str(uuid.uuid4())[:8]
                state.active_sessions[session_id] = True
                
                # Select specific tickets or all
                ticket_ids = data.get("ticket_ids")
                if ticket_ids:
                    tickets = [t for t in state.tickets if t.get("Number") in ticket_ids]
                else:
                    tickets = state.tickets
                
                async def ws_callback(event):
                    if not state.active_sessions.get(session_id, False):
                        return
                    await manager.send_event(client_id, event)
                
                # Run in background
                asyncio.create_task(
                    run_evaluation_task(tickets, ws_callback, session_id, client_id)
                )
                
                await manager.send_event(client_id, {
                    "type": "evaluation_queued",
                    "session_id": session_id,
                    "ticket_count": len(tickets),
                    "timestamp": time.time(),
                })
            
            elif action == "cancel_evaluation":
                session_id = data.get("session_id")
                if session_id:
                    state.active_sessions[session_id] = False
                    await manager.send_event(client_id, {
                        "type": "evaluation_cancelled",
                        "session_id": session_id,
                        "timestamp": time.time(),
                    })
            
            elif action == "ping":
                await manager.send_event(client_id, {"type": "pong", "timestamp": time.time()})
    
    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except Exception:
        manager.disconnect(client_id)


async def run_evaluation_task(tickets, callback, session_id, client_id):
    """Background task to run full evaluation."""
    try:
        await run_full_evaluation(tickets, callback, session_id)
    except Exception as e:
        await manager.send_event(client_id, {
            "type": "session_error",
            "session_id": session_id,
            "error": str(e),
            "timestamp": time.time(),
        })
    finally:
        state.active_sessions.pop(session_id, None)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)