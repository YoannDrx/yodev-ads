from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from platformdirs import user_config_path


class ConfigurationError(ValueError):
    """Raised when Vigie Ads configuration is invalid or incomplete."""


ALLOWED_ACCENTS = {"blue", "cyan", "green", "magenta", "red", "white", "yellow"}


def normalize_customer_id(value: str) -> str:
    normalized = value.replace("-", "").replace(" ", "")
    if len(normalized) != 10 or not normalized.isdigit():
        raise ConfigurationError("A Google Ads customer ID must contain exactly 10 digits.")
    return normalized


def normalize_profile_key(value: str) -> str:
    normalized = "-".join(value.lower().strip().replace("_", "-").split())
    if not normalized or any(
        not (character.isalnum() or character == "-") for character in normalized
    ):
        raise ConfigurationError("Profile keys may only contain letters, numbers and dashes.")
    return normalized


@dataclass(slots=True)
class ClientProfile:
    key: str
    name: str
    customer_id: str
    manager_id: str | None = None
    currency_code: str = "EUR"

    @classmethod
    def from_dict(cls, value: dict[str, str | None]) -> ClientProfile:
        return cls(
            key=normalize_profile_key(str(value["key"])),
            name=str(value["name"]),
            customer_id=normalize_customer_id(str(value["customer_id"])),
            manager_id=(
                normalize_customer_id(str(value["manager_id"])) if value.get("manager_id") else None
            ),
            currency_code=str(value.get("currency_code", "EUR")).upper(),
        )


@dataclass(slots=True)
class BrandSettings:
    product_name: str = "Vigihat"
    tagline: str = "Google Ads, sous contrôle."
    logo: str = "◆"
    accent: str = "cyan"
    locale: str = "fr-FR"
    support_url: str | None = None

    def validate(self) -> BrandSettings:
        self.product_name = self.product_name.strip()
        self.tagline = self.tagline.strip()
        self.logo = self.logo.strip()
        self.accent = self.accent.lower().strip()
        self.locale = self.locale.strip()
        self.support_url = self.support_url.strip() if self.support_url else None
        if not self.product_name or len(self.product_name) > 40:
            raise ConfigurationError("Product name must contain between 1 and 40 characters.")
        if len(self.tagline) > 120:
            raise ConfigurationError("Tagline must not exceed 120 characters.")
        if len(self.logo) > 8:
            raise ConfigurationError("Logo glyph must not exceed 8 characters.")
        if self.accent not in ALLOWED_ACCENTS:
            allowed = ", ".join(sorted(ALLOWED_ACCENTS))
            raise ConfigurationError(f"Accent must be one of: {allowed}.")
        if not self.locale:
            raise ConfigurationError("Locale must not be empty.")
        if self.support_url and not self.support_url.startswith(("https://", "http://")):
            raise ConfigurationError("Support URL must start with https:// or http://.")
        return self

    @classmethod
    def from_dict(cls, value: dict[str, object] | None) -> BrandSettings:
        value = value or {}
        return cls(
            product_name=str(value.get("product_name", "Vigihat")),
            tagline=str(value.get("tagline", "Google Ads, sous contrôle.")),
            logo=str(value.get("logo", "◆")),
            accent=str(value.get("accent", "cyan")),
            locale=str(value.get("locale", "fr-FR")),
            support_url=(str(value["support_url"]) if value.get("support_url") else None),
        ).validate()


@dataclass(slots=True)
class VigieConfig:
    schema_version: int = 2
    brand: BrandSettings = field(default_factory=BrandSettings)
    default_manager_id: str | None = None
    default_profile: str | None = None
    profiles: dict[str, ClientProfile] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> VigieConfig:
        raw_profiles = value.get("profiles", {})
        if not isinstance(raw_profiles, dict):
            raise ConfigurationError("The profiles configuration must be an object.")
        profiles = {
            key: ClientProfile.from_dict(profile)
            for key, profile in raw_profiles.items()
            if isinstance(profile, dict)
        }
        manager_id = value.get("default_manager_id")
        default_profile = value.get("default_profile")
        raw_brand = value.get("brand")
        if raw_brand is not None and not isinstance(raw_brand, dict):
            raise ConfigurationError("The brand configuration must be an object.")
        return cls(
            schema_version=2,
            brand=BrandSettings.from_dict(raw_brand),
            default_manager_id=(normalize_customer_id(str(manager_id)) if manager_id else None),
            default_profile=(
                normalize_profile_key(str(default_profile)) if default_profile else None
            ),
            profiles=profiles,
        )

    def profile(self, key: str | None = None) -> ClientProfile:
        selected = normalize_profile_key(key) if key else self.default_profile
        if not selected:
            raise ConfigurationError("No profile selected. Run `vigie clients use PROFILE`.")
        try:
            return self.profiles[selected]
        except KeyError as error:
            raise ConfigurationError(f"Unknown profile: {selected}") from error

    def manager_id_for(self, profile: ClientProfile | None = None) -> str:
        manager_id = (
            profile.manager_id if profile and profile.manager_id else self.default_manager_id
        )
        if not manager_id:
            raise ConfigurationError("No manager ID configured. Run `vigie setup` first.")
        return manager_id


class ConfigStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or user_config_path("vigie-ads", appauthor=False) / "config.json"

    def load(self) -> VigieConfig:
        if not self.path.exists():
            return VigieConfig()
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ConfigurationError(f"Unable to read {self.path}: {error}") from error
        if not isinstance(value, dict):
            raise ConfigurationError("The Vigie Ads configuration root must be an object.")
        return VigieConfig.from_dict(value)

    def save(self, config: VigieConfig) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": 2,
            "brand": asdict(config.brand.validate()),
            "default_manager_id": config.default_manager_id,
            "default_profile": config.default_profile,
            "profiles": {key: asdict(profile) for key, profile in sorted(config.profiles.items())},
        }
        temporary_path = self.path.with_suffix(".tmp")
        temporary_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        os.chmod(temporary_path, 0o600)
        temporary_path.replace(self.path)
