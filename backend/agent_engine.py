"""
Agent Engine v2: Sequential processing with 5 RPM rate limiting.
- Tickets processed one at a time
- Agent groups within a ticket run sequentially (A → B → C → D)
- Strict 5 requests per minute rate limiter
- Rich event emissions for animated frontend
- Retry logic with exponential backoff
"""

import asyncio
import json
import os
import time
from collections import deque
from typing import Any, Callable, Dict, List, Optional
from google import genai
from sample_data import QA_PARAMETERS, AGENT_GROUPS


# ─── Rate Limiter: 5 RPM ───

class RateLimiter:
    """Enforces max N requests per 60-second rolling window."""
    
    def __init__(self, max_requests: int = 5, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self.timestamps = deque()
    
    async def wait(self, callback=None, session_id=None, ticket_id=None, group_id=None):
        """Wait until we're allowed to make a request."""
        now = time.time()
        
        # Remove timestamps older than the window
        while self.timestamps and self.timestamps[0] < now - self.window:
            self.timestamps.popleft()
        
        # If at limit, wait until the oldest one expires
        if len(self.timestamps) >= self.max_requests:
            wait_time = self.timestamps[0] + self.window - now + 0.5  # +0.5s buffer
            if wait_time > 0:
                if callback:
                    await callback({
                        "type": "rate_limit_wait",
                        "session_id": session_id or "",
                        "ticket_id": ticket_id or "",
                        "group_id": group_id or "",
                        "wait_seconds": round(wait_time, 1),
                        "requests_in_window": len(self.timestamps),
                        "max_requests": self.max_requests,
                        "message": f"Rate limit: {len(self.timestamps)}/{self.max_requests} RPM used. Waiting {round(wait_time, 1)}s...",
                        "timestamp": time.time(),
                    })
                await asyncio.sleep(wait_time)
        
        # Record this request
        self.timestamps.append(time.time())


# Global rate limiter instance
rate_limiter = RateLimiter(max_requests=5, window_seconds=60)


def get_gemini_client():
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


# ─── Prompt Builders ───

def build_system_prompt(group_id: str, params: List[dict]) -> str:
    param_descriptions = "\n".join(
        [f"  Parameter {p['id']}: {p['name']}\n    Logic: {p['logic']}" for p in params]
    )
    return f"""You are an expert ITSM Quality Assurance auditor agent. You belong to Agent Group {group_id}: {AGENT_GROUPS[group_id]['name']}.

Your job is to evaluate ITSM incident tickets against specific quality parameters.

## Your Parameters to Evaluate:
{param_descriptions}

## Output Format:
For EACH parameter, provide your evaluation as a JSON array.
IMPORTANT: Output ONLY a valid JSON array, no markdown, no backticks, no extra text.

[
  {{
    "param_id": <integer>,
    "param_name": "<string>",
    "verdict": "PASS" or "FAIL",
    "score": <integer 1-10>,
    "confidence": <float 0.0-1.0>,
    "evidence": ["<exact quote from ticket>"],
    "reasoning": "<detailed step-by-step reasoning>"
  }}
]

## Rules:
1. Read ALL work notes and resolution notes carefully.
2. Quote exact evidence from the ticket.
3. Score from 1 (worst) to 10 (best).
4. If not applicable, score 8 with PASS and note "Not applicable".
5. Think step by step before judging.
"""


def build_ticket_prompt(ticket: dict) -> str:
    return f"""## Incident Ticket to Evaluate:

**Number:** {ticket.get('Number', 'N/A')}
**Opened:** {ticket.get('Opened', 'N/A')}
**Short Description:** {ticket.get('Short description', 'N/A')}
**Type:** {ticket.get('Type', 'N/A')}
**Affected User:** {ticket.get('Affected User', 'N/A')}
**Priority:** {ticket.get('Priority', 'N/A')}
**State:** {ticket.get('State', 'N/A')}
**Categorization:** {ticket.get('Categorization', 'N/A')}
**Assignment Group:** {ticket.get('Assignment group', 'N/A')}
**Assigned To:** {ticket.get('Assigned to', 'N/A')}
**Subcategory:** {ticket.get('Subcategory', 'N/A')}
**Reassignment Count:** {ticket.get('Reassignment count', 'N/A')}
**Country:** {ticket.get('Country', 'N/A')}
**Resolved By:** {ticket.get('Resolved by', 'N/A')}
**Updated:** {ticket.get('Updated', 'N/A')}

**Work Notes:**
{ticket.get('Work notes', 'N/A')}

**Resolution Notes:**
{ticket.get('Resolution notes', 'N/A')}

Evaluate this ticket against ALL your assigned parameters. Provide your JSON evaluation.
"""


def get_ticket_fields_for_group(group_id: str, ticket: dict) -> List[dict]:
    """Return which ticket fields are relevant for each agent group (for animation)."""
    base = [
        {"field": "Number", "value": ticket.get("Number", "")},
        {"field": "State", "value": ticket.get("State", "")},
        {"field": "Priority", "value": ticket.get("Priority", "")},
        {"field": "Short description", "value": ticket.get("Short description", "")[:80]},
    ]
    
    group_specific = {
        "A": [  # Closure & Resolution
            {"field": "Resolution notes", "value": (ticket.get("Resolution notes", "") or "")[:150]},
            {"field": "Work notes (closure)", "value": "Scanning for closure confirmation..."},
        ],
        "B": [  # Compliance & Process
            {"field": "Work notes (CAP)", "value": "Scanning for Cause/Action/Prevention..."},
            {"field": "Categorization", "value": ticket.get("Categorization", "")},
        ],
        "C": [  # Timeliness & SLA
            {"field": "Opened", "value": ticket.get("Opened", "")},
            {"field": "Updated", "value": ticket.get("Updated", "")},
            {"field": "Country", "value": ticket.get("Country", "")},
        ],
        "D": [  # Categorization & Hold
            {"field": "Categorization", "value": ticket.get("Categorization", "")},
            {"field": "Subcategory", "value": ticket.get("Subcategory", "")},
        ],
    }
    
    return base + group_specific.get(group_id, [])


# ─── Core Evaluation ───

async def evaluate_group(
    client: genai.Client,
    group_id: str,
    ticket: dict,
    callback: Callable,
    session_id: str,
):
    """Evaluate one agent group against one ticket with rich event streaming."""
    ticket_id = ticket["Number"]
    group_info = AGENT_GROUPS[group_id]
    params = [p for p in QA_PARAMETERS if p["group"] == group_id]

    # Phase 1: Agent waking up
    await callback({
        "type": "agent_started",
        "session_id": session_id,
        "ticket_id": ticket_id,
        "group_id": group_id,
        "group_name": group_info["name"],
        "params": [{"id": p["id"], "name": p["name"]} for p in params],
        "timestamp": time.time(),
    })
    await asyncio.sleep(0.4)

    # Phase 2: Data ingestion — show which fields the agent is reading
    fields = get_ticket_fields_for_group(group_id, ticket)
    for i, field in enumerate(fields):
        await callback({
            "type": "data_ingestion",
            "session_id": session_id,
            "ticket_id": ticket_id,
            "group_id": group_id,
            "field_name": field["field"],
            "field_value": field["value"],
            "field_index": i,
            "total_fields": len(fields),
            "timestamp": time.time(),
        })
        await asyncio.sleep(0.3)

    # Phase 3: Thinking / LLM call
    await callback({
        "type": "thinking",
        "session_id": session_id,
        "ticket_id": ticket_id,
        "group_id": group_id,
        "message": f"Analyzing {len(params)} parameters...",
        "timestamp": time.time(),
    })

    system_prompt = build_system_prompt(group_id, params)
    ticket_prompt = build_ticket_prompt(ticket)

    await callback({
        "type": "llm_call",
        "session_id": session_id,
        "ticket_id": ticket_id,
        "group_id": group_id,
        "message": f"Calling Gemini for Group {group_id}...",
        "timestamp": time.time(),
    })

    # Emit the actual prompt being sent
    await callback({
        "type": "llm_request",
        "session_id": session_id,
        "ticket_id": ticket_id,
        "group_id": group_id,
        "model": "gemini-2.5-flash",
        "prompt_system": system_prompt[:500] + ("..." if len(system_prompt) > 500 else ""),
        "prompt_user": ticket_prompt[:800] + ("..." if len(ticket_prompt) > 800 else ""),
        "prompt_tokens_approx": len((system_prompt + ticket_prompt).split()),
        "timestamp": time.time(),
    })

    # Call Gemini with retry logic
    full_response = ""
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            # Wait for rate limiter before calling API
            await rate_limiter.wait(
                callback=callback,
                session_id=session_id,
                ticket_id=ticket_id,
                group_id=group_id,
            )
            
            # Try streaming
            try:
                stream = client.models.generate_content_stream(
                    model="gemini-2.5-flash",
                    contents=[
                        {"role": "user", "parts": [{"text": system_prompt + "\n\n" + ticket_prompt}]}
                    ],
                )
                
                chunk_buffer = ""
                for chunk in stream:
                    if chunk.text:
                        full_response += chunk.text
                        chunk_buffer += chunk.text
                        
                        if len(chunk_buffer) > 40:
                            await callback({
                                "type": "chain_of_thought",
                                "session_id": session_id,
                                "ticket_id": ticket_id,
                                "group_id": group_id,
                                "chunk": chunk_buffer,
                                "timestamp": time.time(),
                            })
                            chunk_buffer = ""
                            await asyncio.sleep(0.03)
                
                if chunk_buffer:
                    await callback({
                        "type": "chain_of_thought",
                        "session_id": session_id,
                        "ticket_id": ticket_id,
                        "group_id": group_id,
                        "chunk": chunk_buffer,
                        "timestamp": time.time(),
                    })
                    
            except Exception as stream_err:
                # Log the streaming error
                await callback({
                    "type": "llm_error",
                    "session_id": session_id,
                    "ticket_id": ticket_id,
                    "group_id": group_id,
                    "error_type": "stream_fallback",
                    "error": str(stream_err),
                    "message": "Streaming failed, falling back to non-streaming",
                    "timestamp": time.time(),
                })
                # Fallback to non-streaming
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[
                        {"role": "user", "parts": [{"text": system_prompt + "\n\n" + ticket_prompt}]}
                    ],
                )
                full_response = response.text
                
                # Stream the response in chunks for animation
                words = full_response.split()
                for i in range(0, len(words), 8):
                    chunk = " ".join(words[i:i+8]) + " "
                    await callback({
                        "type": "chain_of_thought",
                        "session_id": session_id,
                        "ticket_id": ticket_id,
                        "group_id": group_id,
                        "chunk": chunk,
                        "timestamp": time.time(),
                    })
                    await asyncio.sleep(0.05)

            break  # Success, exit retry loop

        except Exception as e:
            error_msg = str(e)
            # Log the LLM error
            await callback({
                "type": "llm_error",
                "session_id": session_id,
                "ticket_id": ticket_id,
                "group_id": group_id,
                "error_type": "api_error",
                "error": error_msg,
                "attempt": attempt + 1,
                "timestamp": time.time(),
            })
            if attempt < max_retries - 1:
                wait_time = (attempt + 1) * 3  # 3s, 6s, 9s
                await callback({
                    "type": "agent_retry",
                    "session_id": session_id,
                    "ticket_id": ticket_id,
                    "group_id": group_id,
                    "attempt": attempt + 1,
                    "max_retries": max_retries,
                    "wait_seconds": wait_time,
                    "error": error_msg,
                    "timestamp": time.time(),
                })
                await asyncio.sleep(wait_time)
            else:
                await callback({
                    "type": "agent_error",
                    "session_id": session_id,
                    "ticket_id": ticket_id,
                    "group_id": group_id,
                    "error": error_msg,
                    "timestamp": time.time(),
                })
                return [
                    {
                        "param_id": p["id"],
                        "param_name": p["name"],
                        "verdict": "ERROR",
                        "score": 0,
                        "confidence": 0.0,
                        "evidence": [],
                        "reasoning": f"Agent error after {max_retries} retries: {error_msg}"
                    }
                    for p in params
                ]

    # Phase 4: Log the complete raw LLM response
    await callback({
        "type": "llm_response_complete",
        "session_id": session_id,
        "ticket_id": ticket_id,
        "group_id": group_id,
        "raw_response": full_response[:2000] + ("... [truncated]" if len(full_response) > 2000 else ""),
        "response_length": len(full_response),
        "timestamp": time.time(),
    })

    # Phase 5: Parse results
    results = parse_evaluation_response(full_response, group_id, params)

    # Log parse outcome
    parse_success = all(r["verdict"] != "UNKNOWN" for r in results)
    await callback({
        "type": "llm_parse_result",
        "session_id": session_id,
        "ticket_id": ticket_id,
        "group_id": group_id,
        "success": parse_success,
        "params_parsed": len(results),
        "verdicts": {r["param_id"]: r["verdict"] for r in results},
        "timestamp": time.time(),
    })

    # Phase 6: Emit results one by one (for typewriter animation)
    for result in results:
        await callback({
            "type": "param_result",
            "session_id": session_id,
            "ticket_id": ticket_id,
            "group_id": group_id,
            "result": result,
            "timestamp": time.time(),
        })
        await asyncio.sleep(0.5)  # Stagger for animation

    # Phase 6: Agent complete
    await callback({
        "type": "agent_complete",
        "session_id": session_id,
        "ticket_id": ticket_id,
        "group_id": group_id,
        "group_name": group_info["name"],
        "results": results,
        "timestamp": time.time(),
    })

    return results


def parse_evaluation_response(response_text: str, group_id: str, params: List[dict]) -> List[dict]:
    """Parse the LLM response into structured results."""
    try:
        text = response_text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        
        start_idx = text.find("[")
        end_idx = text.rfind("]") + 1
        if start_idx != -1 and end_idx > start_idx:
            json_str = text[start_idx:end_idx]
            results = json.loads(json_str)
            
            normalized = []
            for r in results:
                normalized.append({
                    "param_id": r.get("param_id", 0),
                    "param_name": r.get("param_name", "Unknown"),
                    "verdict": r.get("verdict", "UNKNOWN").upper(),
                    "score": max(1, min(10, int(r.get("score", 5)))),
                    "confidence": max(0.0, min(1.0, float(r.get("confidence", 0.5)))),
                    "evidence": r.get("evidence", []),
                    "reasoning": r.get("reasoning", "No reasoning provided"),
                })
            return normalized
    except (json.JSONDecodeError, ValueError, KeyError):
        pass
    
    return [
        {
            "param_id": p["id"],
            "param_name": p["name"],
            "verdict": "UNKNOWN",
            "score": 5,
            "confidence": 0.3,
            "evidence": [],
            "reasoning": "Could not parse LLM response. Raw output in chain-of-thought."
        }
        for p in params
    ]


# ─── Orchestration: Sequential Ticket → Sequential Groups ───

async def evaluate_ticket(
    client: genai.Client,
    ticket: dict,
    callback: Callable,
    session_id: str,
):
    """Evaluate one ticket: groups run sequentially (A → B → C → D)."""
    ticket_id = ticket["Number"]
    
    # Emit ticket metadata for frontend animation
    await callback({
        "type": "ticket_started",
        "session_id": session_id,
        "ticket_id": ticket_id,
        "short_description": ticket.get("Short description", ""),
        "priority": ticket.get("Priority", ""),
        "state": ticket.get("State", ""),
        "affected_user": ticket.get("Affected User", ""),
        "country": ticket.get("Country", ""),
        "categorization": ticket.get("Categorization", ""),
        "timestamp": time.time(),
    })

    all_results = []

    # Run groups SEQUENTIALLY — rate limiter handles timing
    for group_id in ["A", "B", "C", "D"]:
        # Small visual delay between groups
        if all_results:
            await asyncio.sleep(0.5)
        
        results = await evaluate_group(client, group_id, ticket, callback, session_id)
        all_results.extend(results)

    # Ticket summary
    pass_count = sum(1 for r in all_results if r["verdict"] == "PASS")
    fail_count = sum(1 for r in all_results if r["verdict"] == "FAIL")
    avg_score = sum(r["score"] for r in all_results) / len(all_results) if all_results else 0

    await callback({
        "type": "ticket_complete",
        "session_id": session_id,
        "ticket_id": ticket_id,
        "summary": {
            "total_params": len(all_results),
            "pass_count": pass_count,
            "fail_count": fail_count,
            "avg_score": round(avg_score, 1),
            "results": all_results,
        },
        "timestamp": time.time(),
    })

    return all_results


async def run_full_evaluation(
    tickets: List[dict],
    callback: Callable,
    session_id: str,
):
    """Process all tickets SEQUENTIALLY to stay within Gemini free tier limits."""
    client = get_gemini_client()
    
    await callback({
        "type": "session_started",
        "session_id": session_id,
        "total_tickets": len(tickets),
        "total_params": len(QA_PARAMETERS),
        "agent_groups": {k: v["name"] for k, v in AGENT_GROUPS.items()},
        "timestamp": time.time(),
    })

    all_results = []

    # Process tickets ONE BY ONE
    for i, ticket in enumerate(tickets):
        try:
            # Small visual pause between tickets
            if i > 0:
                await asyncio.sleep(0.5)
            
            results = await evaluate_ticket(client, ticket, callback, session_id)
            all_results.append(results)
            
        except Exception as e:
            await callback({
                "type": "ticket_error",
                "session_id": session_id,
                "ticket_id": ticket.get("Number", "unknown"),
                "error": str(e),
                "timestamp": time.time(),
            })

    await callback({
        "type": "session_complete",
        "session_id": session_id,
        "timestamp": time.time(),
    })

    return all_results