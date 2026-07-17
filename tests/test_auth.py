from __future__ import annotations

import json
import stat

import pytest

from vigie_ads import auth


class FakeCredentials:
    refresh_token = "refresh-token"

    def to_json(self) -> str:
        return json.dumps({"type": "authorized_user", "refresh_token": self.refresh_token})


class FakeFlow:
    def run_local_server(self, **kwargs: object) -> FakeCredentials:
        assert kwargs["open_browser"] is True
        assert kwargs["host"] == "localhost"
        return FakeCredentials()


def test_run_oauth_login_writes_private_adc(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    target = tmp_path / "gcloud" / "application_default_credentials.json"
    captured: dict[str, object] = {}

    def from_client_config(config: dict, scopes: list[str]) -> FakeFlow:
        captured["config"] = config
        captured["scopes"] = scopes
        return FakeFlow()

    monkeypatch.setattr(auth, "adc_path", lambda: target)
    monkeypatch.setattr(auth.InstalledAppFlow, "from_client_config", from_client_config)

    result = auth.run_oauth_login(
        "client.apps.googleusercontent.com",
        "client-secret",
    )

    assert result == target
    assert json.loads(target.read_text()) == {
        "type": "authorized_user",
        "refresh_token": "refresh-token",
    }
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert captured["scopes"] == auth.GOOGLE_ADS_SCOPES
    assert captured["config"]["installed"]["client_secret"] == "client-secret"


@pytest.mark.parametrize("client_id", ["", "not-an-oauth-client"])
def test_run_oauth_login_rejects_invalid_client_id(client_id: str) -> None:
    with pytest.raises(ValueError, match="OAuth client ID"):
        auth.run_oauth_login(client_id, "secret")
