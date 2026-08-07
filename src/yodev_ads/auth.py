from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import keyring
from google_auth_oauthlib.flow import InstalledAppFlow

KEYRING_SERVICE = "yodev-ads"
KEYRING_USERNAME = "google-ads-developer-token"
GOOGLE_ADS_SCOPES = ["https://www.googleapis.com/auth/adwords"]


def get_developer_token() -> str | None:
    environment_token = os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN")
    if environment_token:
        return environment_token.strip()
    token = keyring.get_password(KEYRING_SERVICE, KEYRING_USERNAME)
    return token.strip() if token else None


def set_developer_token(token: str) -> None:
    normalized = token.strip()
    if len(normalized) != 22 or not normalized.isalnum():
        raise ValueError("A Google Ads developer token must be 22 alphanumeric characters.")
    keyring.set_password(KEYRING_SERVICE, KEYRING_USERNAME, normalized)


def gcloud_path() -> str | None:
    return shutil.which("gcloud")


def adc_path() -> Path:
    configured = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".config" / "gcloud" / "application_default_credentials.json"


def adc_status() -> tuple[bool, str]:
    path = adc_path()
    if not path.exists():
        return False, f"Application Default Credentials not found at {path}"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False, f"Application Default Credentials at {path} are unreadable"
    credential_type = payload.get("type", "unknown") if isinstance(payload, dict) else "unknown"
    return True, f"Application Default Credentials found ({credential_type})"


def run_oauth_login(client_id: str, client_secret: str) -> Path:
    normalized_id = client_id.strip()
    normalized_secret = client_secret.strip()
    if not normalized_id.endswith(".apps.googleusercontent.com"):
        raise ValueError("The OAuth client ID must end with .apps.googleusercontent.com.")
    if not normalized_secret:
        raise ValueError("The OAuth client secret cannot be empty.")

    flow = InstalledAppFlow.from_client_config(
        {
            "installed": {
                "client_id": normalized_id,
                "client_secret": normalized_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": ["http://localhost"],
            }
        },
        GOOGLE_ADS_SCOPES,
    )
    credentials = flow.run_local_server(
        host="localhost",
        port=0,
        authorization_prompt_message="Opening Google OAuth in your browser…",
        success_message="Ads by Yodev OAuth is ready. You can close this tab.",
        open_browser=True,
    )
    if not credentials.refresh_token:
        raise RuntimeError("Google did not return a refresh token. Revoke access and retry.")

    path = adc_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.loads(credentials.to_json())
    payload["type"] = "authorized_user"
    path.write_text(json.dumps(payload), encoding="utf-8")
    path.chmod(0o600)
    return path
