"""Tasklog: tickets as Home Assistant to-do lists, one per area."""

from __future__ import annotations

from homeassistant.const import CONF_API_TOKEN, CONF_URL, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TasklogApi
from .coordinator import TasklogConfigEntry, TasklogCoordinator

PLATFORMS = [Platform.TODO]


async def async_setup_entry(hass: HomeAssistant, entry: TasklogConfigEntry) -> bool:
    api = TasklogApi(async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_API_TOKEN])
    coordinator = TasklogCoordinator(hass, entry, api)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: TasklogConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
