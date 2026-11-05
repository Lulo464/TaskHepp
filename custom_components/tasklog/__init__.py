"""Tasklog: tickets as Home Assistant to-do lists, one per area."""

from __future__ import annotations

import logging

from homeassistant.const import CONF_API_TOKEN, CONF_URL, Platform
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TasklogApi, TasklogError
from .coordinator import TasklogConfigEntry, TasklogCoordinator

PLATFORMS = [Platform.TODO]
EVENT_TAG_SCANNED = "tag_scanned"

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: TasklogConfigEntry) -> bool:
    api = TasklogApi(async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_API_TOKEN])
    coordinator = TasklogCoordinator(hass, entry, api)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    async def forward_tag(tag_id: str) -> None:
        try:
            result = await api.tag_scanned(tag_id)
        except TasklogError as err:
            _LOGGER.warning("Tag %s konnte nicht an Tasklog gemeldet werden: %s", tag_id, err)
            return
        if result.get("result") == "unknown":
            _LOGGER.debug("Tag %s ist in Tasklog noch nicht verknüpft", tag_id)
        else:
            await coordinator.async_refresh()  # the to-do lists show the change right away

    @callback
    def on_tag(event: Event) -> None:
        """NFC tags scanned with the Home Assistant app: Tasklog decides what they do."""
        if tag_id := event.data.get("tag_id"):
            entry.async_create_task(hass, forward_tag(str(tag_id)), f"tasklog tag {tag_id}")

    entry.async_on_unload(hass.bus.async_listen(EVENT_TAG_SCANNED, on_tag))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: TasklogConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
