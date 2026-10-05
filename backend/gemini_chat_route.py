# Add this route to your existing FastAPI backend.
# Install nothing extra: this uses Python's standard library for the Gemini request.

import json
import os
from typing import Literal
from urllib import error, request

from fastapi import HTTPException
from pydantic import BaseModel, Field


class ChatHistoryItem(BaseModel):
    role: Literal["user", "model"]
    text: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    history: list[ChatHistoryItem] = Field(default_factory=list)


@app.post("/chat")
def chat_with_gemini(payload: ChatRequest):
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not configured on the server."
        )

    # Current lightweight Gemini model for new projects.
    # If your AI Studio project exposes a different free-tier model,
    # change GEMINI_MODEL in your environment instead of editing the code.
    model = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/"
        f"models/{model}:generateContent"
    )

    contents = []

    # Keep only recent context so free-tier usage stays small.
    for item in payload.history[-10:]:
        contents.append({
            "role": item.role,
            "parts": [{"text": item.text}]
        })

    # script.js already includes the latest user message in history.
    # If history is missing, add it here.
    if not contents or contents[-1].get("role") != "user":
        contents.append({
            "role": "user",
            "parts": [{"text": payload.message}]
        })

    body = {
        "systemInstruction": {
            "parts": [{
                "text": (
                    "You are GPU Finder Assistant, a concise helper inside a GPU comparison website. "
                    "Focus on GPUs, PC graphics, compatibility, VRAM, power requirements, "
                    "performance concepts, and helping users understand GPU choices. "
                    "Do not invent prices, benchmark numbers, or live stock. "
                    "If the user asks for site-specific GPU data that you were not given, tell them "
                    "to use the site's Browse or Compare data instead of fabricating values. "
                    "Keep normal answers brief and easy to read in a small chat window."
                )
            }]
        },
        "contents": contents,
        "generationConfig": {
            "temperature": 0.5,
            "maxOutputTokens": 350
        }
    }

    req = request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key
        },
        method="POST"
    )

    try:
        with request.urlopen(req, timeout=25) as response:
            result = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        try:
            google_error = json.loads(exc.read().decode("utf-8"))
            message = google_error.get("error", {}).get("message", "Gemini API request failed.")
        except Exception:
            message = "Gemini API request failed."

        raise HTTPException(status_code=502, detail=message)
    except Exception:
        raise HTTPException(status_code=502, detail="Could not connect to Gemini API.")

    try:
        reply = result["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError):
        raise HTTPException(status_code=502, detail="Gemini returned an empty response.")

    return {"reply": reply}
