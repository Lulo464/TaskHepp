"""End-to-end: Home Assistant with the Tasklog integration against a real Tasklog server."""

import datetime

import aiohttp
from homeassistant import config_entries
from homeassistant.components.todo import DOMAIN as TODO_DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import entity_registry as er

from custom_components.tasklog.const import DOMAIN

TITLE = "HA-Test: Blumen gießen"


async def _tickets(conf):
    async with aiohttp.ClientSession() as s, s.get(f"{conf['url']}/api/tickets?limit=1000", headers={"Authorization": f"Bearer {conf['api_token']}"}) as r:
        return await r.json()


async def _set_up(hass: HomeAssistant, conf) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], conf)
    assert result["type"] is FlowResultType.CREATE_ENTRY, result
    await hass.async_block_till_done()


async def test_wrong_token_is_rejected(hass: HomeAssistant, tasklog) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {**tasklog, "api_token": "falsch"})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_auth"}
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {**tasklog, "url": "http://127.0.0.1:9"})
    assert result["errors"] == {"base": "cannot_connect"}


async def test_areas_become_todo_lists(hass: HomeAssistant, tasklog) -> None:
    await _set_up(hass, tasklog)
    entities = [e.entity_id for e in er.async_entries_for_config_entry(er.async_get(hass), hass.config_entries.async_entries(DOMAIN)[0].entry_id)]
    assert "todo.tasklog_zuhause" in entities and "todo.tasklog_arbeit" in entities
    open_home = [t for t in await _tickets(tasklog) if t["area"] == "Zuhause" and t["status"] != "done"]
    assert hass.states.get("todo.tasklog_zuhause").state == str(len(open_home))


async def test_add_complete_and_remove_from_home_assistant(hass: HomeAssistant, tasklog) -> None:
    await _set_up(hass, tasklog)
    entity = "todo.tasklog_zuhause"

    # Add with a due time: lands in Tasklog in the area, with local date and time.
    due = datetime.datetime(2030, 6, 1, 18, 30)
    await hass.services.async_call(TODO_DOMAIN, "add_item", {"item": TITLE, "due_datetime": due.isoformat(), "description": "aus HA"}, target={"entity_id": entity}, blocking=True)
    ticket = next(t for t in await _tickets(tasklog) if t["title"] == TITLE)
    assert (ticket["area"], ticket["due"], ticket["dueTime"], ticket["description"], ticket["status"]) == ("Zuhause", "2030-06-01", "18:30", "aus HA", "open")

    items = await hass.services.async_call(TODO_DOMAIN, "get_items", {}, target={"entity_id": entity}, blocking=True, return_response=True)
    item = next(i for i in items[entity]["items"] if i["summary"] == TITLE)
    assert item["status"] == "needs_action" and item["uid"] == str(ticket["id"])

    # Ticking it off in Home Assistant finishes the ticket; un-ticking reopens it.
    await hass.services.async_call(TODO_DOMAIN, "update_item", {"item": TITLE, "status": "completed"}, target={"entity_id": entity}, blocking=True)
    assert next(t for t in await _tickets(tasklog) if t["id"] == ticket["id"])["status"] == "done"
    items = await hass.services.async_call(TODO_DOMAIN, "get_items", {"status": "completed"}, target={"entity_id": entity}, blocking=True, return_response=True)
    assert any(i["uid"] == str(ticket["id"]) for i in items[entity]["items"])  # stays visible as done for a while
    await hass.services.async_call(TODO_DOMAIN, "update_item", {"item": ticket["id"].__str__(), "status": "needs_action", "rename": TITLE + " (neu)"}, target={"entity_id": entity}, blocking=True)
    again = next(t for t in await _tickets(tasklog) if t["id"] == ticket["id"])
    assert (again["status"], again["title"]) == ("open", TITLE + " (neu)")

    await hass.services.async_call(TODO_DOMAIN, "remove_item", {"item": [str(ticket["id"])]}, target={"entity_id": entity}, blocking=True)
    assert not any(t["id"] == ticket["id"] for t in await _tickets(tasklog))


async def _call(conf, method, path, body=None):
    async with aiohttp.ClientSession() as s, s.request(method, f"{conf['url']}{path}", json=body, headers={"Authorization": f"Bearer {conf['api_token']}"}) as r:
        return await r.json() if r.status != 204 else None


async def test_scanned_tags_go_to_tasklog(hass: HomeAssistant, tasklog) -> None:
    await _set_up(hass, tasklog)
    areas = await _call(tasklog, "GET", "/api/areas")
    home = next(a for a in areas if a["name"] == "Zuhause")
    ticket = await _call(tasklog, "POST", "/api/tickets", {"title": "HA-Test: Tag", "areaId": home["id"]})

    # An unknown tag is offered for linking in Tasklog.
    hass.bus.async_fire("tag_scanned", {"tag_id": "ha-test-unbekannt", "device_id": "x"})
    await hass.async_block_till_done()
    assert (await _call(tasklog, "GET", "/api/tags/ha/last"))["tagId"] == "ha-test-unbekannt"

    for old in await _call(tasklog, "GET", "/api/tags"):
        if old["haTagId"] == "ha-test-tag":  # left over from an aborted run
            await _call(tasklog, "DELETE", f"/api/tags/{old['id']}")
    tag = await _call(tasklog, "POST", "/api/tags", {"name": "HA-Test", "action": "done", "ticketId": ticket["id"], "haTagId": "ha-test-tag"})
    assert tag["haTagId"] == "ha-test-tag", tag
    hass.bus.async_fire("tag_scanned", {"tag_id": "ha-test-tag", "device_id": "x"})
    await hass.async_block_till_done()
    assert next(t for t in await _tickets(tasklog) if t["id"] == ticket["id"])["status"] == "done"
    await _call(tasklog, "DELETE", f"/api/tags/{tag['id']}")
    await _call(tasklog, "DELETE", f"/api/tickets/{ticket['id']}")
