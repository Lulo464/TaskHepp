"""Set up Tasklog with its address and an API token."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_API_TOKEN, CONF_URL
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TasklogApi, TasklogAuthError, TasklogError
from .const import DOMAIN


class TasklogConfigFlow(ConfigFlow, domain=DOMAIN):
    """Asks for the Tasklog address and a token with the right tickets:write."""

    VERSION = 1

    async def _check(self, url: str, token: str) -> str | None:
        try:
            await TasklogApi(async_get_clientsession(self.hass), url, token).areas()
        except TasklogAuthError:
            return "invalid_auth"
        except TasklogError:
            return "cannot_connect"
        return None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip().rstrip("/")
            await self.async_set_unique_id(url.lower())
            self._abort_if_unique_id_configured()
            if not (error := await self._check(url, user_input[CONF_API_TOKEN])):
                return self.async_create_entry(title="Tasklog", data={CONF_URL: url, CONF_API_TOKEN: user_input[CONF_API_TOKEN]})
            errors["base"] = error
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_URL): str, vol.Required(CONF_API_TOKEN): str}),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        entry = self._get_reauth_entry()
        if user_input is not None:
            if not (error := await self._check(entry.data[CONF_URL], user_input[CONF_API_TOKEN])):
                return self.async_update_reload_and_abort(entry, data_updates={CONF_API_TOKEN: user_input[CONF_API_TOKEN]})
            errors["base"] = error
        return self.async_show_form(
            step_id="reauth_confirm", data_schema=vol.Schema({vol.Required(CONF_API_TOKEN): str}), errors=errors,
        )
