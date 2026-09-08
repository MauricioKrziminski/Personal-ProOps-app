#!/usr/bin/env python3
"""Exercise real inbound HTTP/HMAC through fake_meta, entirely on loopback.

Run from repository root:
  agent/.venv/bin/python agent/scripts/verify_signed_inbound.py

Uses the production inbound router and signature/thread functions. Only persistence
and task scheduling are in-memory doubles. Never starts main.py's production
lifespan, opens database pools, runs Cloud Tasks, sends WhatsApp, or reads .env.
This proves the inbound boundary, NOT worker/LLM execution or outgoing delivery.
"""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

AGENT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_ROOT))

import httpx
import uvicorn
from app.routes import inbound
from fastapi import FastAPI

from app import config, security

SECRET = "local-fixture-hmac-secret-not-a-real-credential"
PHONE = "5551999999999"
CLICK = "pa:fixture-pending:c:change_card"
TEXT = "gastei 125 no mercado no cartão Nubank"


def main() -> None:
    settings = config.Settings(
        _env_file=None,
        whatsapp_app_secret=SECRET,
        whatsapp_verify_token="local-verify-fixture",
        thread_salt="local-fixture-thread-salt-32-characters",
        database_url="",
        whatsapp_token="",
        debounce_backend="inline",
    )
    queue: dict[str, dict] = {}
    sessions: dict[str, dict] = {}
    scheduled: list[str] = []
    cancelled: list[str | None] = []

    async def enqueue(**message):
        if message["wa_message_id"] in queue:
            return False
        queue[message["wa_message_id"]] = message
        return True

    async def ensure_session(phone, thread):
        assert phone == PHONE
        return sessions.setdefault(thread, {})

    async def set_debounce_task(thread, name):
        sessions[thread]["debounce_task_name"] = name

    async def cancel(name):
        cancelled.append(name)

    async def schedule(thread):
        scheduled.append(thread)
        return f"local-task-{len(scheduled)}"

    app = FastAPI()
    app.include_router(inbound.router)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    url = f"http://127.0.0.1:{sock.getsockname()[1]}"
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    patches = [
        patch.object(config, "get_settings", return_value=settings),
        patch.object(security, "get_settings", return_value=settings),
        patch.object(inbound, "get_settings", return_value=settings),
        patch.object(inbound.db, "enqueue", side_effect=enqueue),
        patch.object(inbound.db, "ensure_session", side_effect=ensure_session),
        patch.object(inbound.db, "set_debounce_task", side_effect=set_debounce_task),
        patch.object(inbound.tasks, "cancel", side_effect=cancel),
        patch.object(inbound.tasks, "schedule_debounce", side_effect=schedule),
    ]
    try:
        for mocked in patches:
            mocked.start()
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert server.started, "isolated uvicorn server did not start"
        with tempfile.TemporaryDirectory(prefix="proops-inbound-") as cwd:
            for arguments in ([TEXT], ["--click", CLICK, "Trocar de Cartão"]):
                result = subprocess.run(
                    [sys.executable, str(AGENT_ROOT / "scripts/fake_meta.py"),
                     "--url", url, "--phone", PHONE, *arguments],
                    env={"WHATSAPP_APP_SECRET": SECRET},
                    cwd=cwd, capture_output=True, text=True, timeout=15, check=True,
                )
                assert "[200]" in result.stdout, result.stdout + result.stderr
                print(result.stdout.strip())
        assert len(queue) == 2, "both signed payloads must be enqueued"
        text_row, click_row = list(queue.values())
        assert text_row["message_type"] == "text"
        assert text_row["payload"]["text"]["body"] == TEXT
        assert click_row["message_type"] == "interactive"
        assert click_row["payload"]["interactive"] == {
            "type": "list_reply", "list_reply": {"id": CLICK, "title": "Trocar de Cartão"},
        }, "the click id and display title must survive HTTP unchanged"
        expected_thread = security.thread_id_for(PHONE)
        assert text_row["thread_id"] == click_row["thread_id"] == expected_thread
        assert scheduled == [expected_thread, expected_thread]
        assert cancelled == [None, "local-task-1"], "second arrival must cancel previous debounce"

        spec = importlib.util.spec_from_file_location("fake_meta", AGENT_ROOT / "scripts/fake_meta.py")
        fake_meta = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fake_meta)
        raw = json.dumps(fake_meta.payload(PHONE, TEXT)).encode()
        signature = "sha256=" + hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
        with httpx.Client(base_url=url, trust_env=False) as client:
            invalid = client.post("/whatsapp-inbound", content=raw, headers={"X-Hub-Signature-256": "sha256=invalid"})
            assert invalid.status_code == 401, "POST invalid HMAC is 401 in the current router"
            tampered = client.post("/whatsapp-inbound", content=raw + b" ", headers={"X-Hub-Signature-256": signature})
            assert tampered.status_code == 401, "signature must cover exact raw bytes"
            missing = client.post("/whatsapp-inbound", content=raw)
            assert missing.status_code == 401
            assert len(queue) == 2 and len(scheduled) == 2, "rejected requests must have no side effects"
            assert client.get("/whatsapp-inbound", params={"hub.mode": "subscribe", "hub.verify_token": "wrong"}).status_code == 403
        print(json.dumps({
            "result": "PASS", "signed_text": 200, "signed_change_card": 200,
            "invalid_hmac": 401, "tampered_body": 401, "missing_signature": 401,
            "invalid_get_verification_token": 403, "queue_rows": len(queue),
            "debounce_scheduled": len(scheduled), "prior_debounce_cancelled": True,
            "scope": "real loopback HTTP + inbound router + HMAC; DB/tasks in memory; no worker/LLM/outbound",
        }, ensure_ascii=False))
    finally:
        server.should_exit = True
        if thread.ident is not None:
            thread.join(timeout=10)
        sock.close()
        for mocked in reversed(patches):
            mocked.stop()


if __name__ == "__main__":
    main()
