"""Small client for the Tasklog REST API."""

from __future__ import annotations

from typing import Any

import aiohttp


class TasklogError(Exception):
    """Tasklog could not be reached or answered with an error."""


class TasklogAuthError(TasklogError):
    """The API token is wrong or lacks the right (tickets:write)."""


class TasklogApi:
    """Talks to Tasklog with an API token (Admin → Einstellungen → API-Tokens, right tickets:write)."""

    def __init__(self, session: aiohttp.ClientSession, url: str, token: str) -> None:
        self._session = session
        self._url = url.rstrip("/")
        self._token = token

    async def _request(self, method: str, path: str, json: dict[str, Any] | None = None) -> Any:
        try:
            async with self._session.request(
                method,
                f"{self._url}{path}",
                json=json,
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as res:
                if res.status in (401, 403):
                    raise TasklogAuthError(f"Tasklog lehnt das Token ab ({res.status})")
                if res.status >= 400:
                    try:
                        message = (await res.json()).get("error", res.reason)
                    except (aiohttp.ContentTypeError, ValueError):
                        message = res.reason
                    raise TasklogError(f"Tasklog: {message} ({res.status})")
                if res.status == 204:
                    return None
                return await res.json()
        except aiohttp.ClientError as err:
            raise TasklogError(f"Tasklog nicht erreichbar: {err}") from err
        except TimeoutError as err:
            raise TasklogError("Tasklog antwortet nicht") from err

    async def areas(self) -> list[dict[str, Any]]:
        return await self._request("GET", "/api/areas")

    async def tickets(self) -> list[dict[str, Any]]:
        return await self._request("GET", "/api/tickets?limit=1000")

    async def create_ticket(self, fields: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/tickets", fields)

    async def update_ticket(self, ticket_id: int, fields: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PATCH", f"/api/tickets/{ticket_id}", fields)

    async def delete_ticket(self, ticket_id: int) -> None:
        await self._request("DELETE", f"/api/tickets/{ticket_id}")

    async def tag_scanned(self, tag_id: str) -> dict[str, Any]:
        """Hands a scanned Home Assistant tag to Tasklog, which runs the linked action (or remembers it for linking)."""
        return await self._request("POST", "/api/tags/ha", {"tagId": tag_id})
