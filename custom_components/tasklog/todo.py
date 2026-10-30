"""One Home Assistant to-do list per Tasklog area."""

from __future__ import annotations

import datetime
from typing import Any

from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.const import CONF_URL
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .api import TasklogError
from .const import DOMAIN, DONE_VISIBLE_FOR
from .coordinator import TasklogConfigEntry, TasklogCoordinator


async def async_setup_entry(hass: HomeAssistant, entry: TasklogConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    known: set[int] = set()

    @callback
    def add_new_areas() -> None:
        """Areas created in Tasklog later get their list on the next update."""
        new = [a for a in coordinator.data.areas if a["id"] not in known]
        known.update(a["id"] for a in new)
        if new:
            async_add_entities(TasklogTodoList(coordinator, entry, a) for a in new)

    add_new_areas()
    entry.async_on_unload(coordinator.async_add_listener(add_new_areas))


def _due(ticket: dict[str, Any]) -> datetime.date | datetime.datetime | None:
    if not ticket.get("due"):
        return None
    day = datetime.date.fromisoformat(ticket["due"])
    if not ticket.get("dueTime"):
        return day
    hour, minute = (int(x) for x in ticket["dueTime"].split(":"))
    return datetime.datetime.combine(day, datetime.time(hour, minute), tzinfo=dt_util.get_default_time_zone())


def _due_fields(due: datetime.date | datetime.datetime | None) -> dict[str, Any]:
    """Tasklog keeps a local date and an optional HH:MM."""
    if due is None:
        return {"due": None, "dueTime": None}
    if isinstance(due, datetime.datetime):
        local = dt_util.as_local(due) if due.tzinfo else due
        return {"due": local.date().isoformat(), "dueTime": local.strftime("%H:%M")}
    return {"due": due.isoformat(), "dueTime": None}


class TasklogTodoList(CoordinatorEntity[TasklogCoordinator], TodoListEntity):
    """Open tickets of an area; ticking one off finishes it in Tasklog."""

    _attr_has_entity_name = True
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
        | TodoListEntityFeature.SET_DUE_DATE_ON_ITEM
        | TodoListEntityFeature.SET_DUE_DATETIME_ON_ITEM
        | TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM
    )

    def __init__(self, coordinator: TasklogCoordinator, entry: TasklogConfigEntry, area: dict[str, Any]) -> None:
        super().__init__(coordinator)
        self._area_id: int = area["id"]
        self._attr_unique_id = f"{entry.entry_id}_area_{area['id']}"
        self._attr_name = area["name"]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Tasklog",
            manufacturer="Tasklog",
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=entry.data[CONF_URL],
        )

    @property
    def available(self) -> bool:
        return super().available and any(a["id"] == self._area_id for a in self.coordinator.data.areas)

    def _tickets(self) -> list[dict[str, Any]]:
        return [t for t in self.coordinator.data.tickets if t["areaId"] == self._area_id]

    @property
    def todo_items(self) -> list[TodoItem]:
        now = dt_util.utcnow()
        items: list[TodoItem] = []
        for t in self._tickets():
            done_at = dt_util.parse_datetime(t["doneAt"]) if t.get("doneAt") else None
            if t["status"] == "done" and (done_at is None or now - done_at > DONE_VISIBLE_FOR):
                continue
            items.append(
                TodoItem(
                    uid=str(t["id"]),
                    summary=t["title"],
                    status=TodoItemStatus.COMPLETED if t["status"] == "done" else TodoItemStatus.NEEDS_ACTION,
                    due=_due(t),
                    description=t.get("description") or None,
                    completed=done_at,
                )
            )
        return items

    def _ticket(self, uid: str | None) -> dict[str, Any]:
        for t in self._tickets():
            if str(t["id"]) == uid:
                return t
        raise HomeAssistantError(f"Ticket {uid} gibt es in Tasklog nicht (mehr)")

    async def async_create_todo_item(self, item: TodoItem) -> None:
        fields: dict[str, Any] = {"title": item.summary or "", "areaId": self._area_id, **_due_fields(item.due)}
        if item.description:
            fields["description"] = item.description
        await self._write(self.coordinator.api.create_ticket(fields))

    async def async_update_todo_item(self, item: TodoItem) -> None:
        ticket = self._ticket(item.uid)
        fields: dict[str, Any] = {"title": item.summary or ticket["title"], "description": item.description or "", **_due_fields(item.due)}
        done = item.status == TodoItemStatus.COMPLETED
        if done and ticket["status"] != "done":
            fields["status"] = "done"
        elif not done and ticket["status"] == "done":
            fields["status"] = "open"
        await self._write(self.coordinator.api.update_ticket(ticket["id"], fields))

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        for uid in uids:
            await self._write(self.coordinator.api.delete_ticket(self._ticket(uid)["id"]), refresh=False)
        await self.coordinator.async_refresh()

    async def _write(self, call: Any, refresh: bool = True) -> None:
        try:
            await call
        except TasklogError as err:
            raise HomeAssistantError(str(err)) from err
        # Right away, not debounced: the list should show the change as soon as it was made.
        if refresh:
            await self.coordinator.async_refresh()
