from pathlib import Path

import pytest

from yodev_ads.settings import (
    BrandSettings,
    ClientProfile,
    ConfigStore,
    ConfigurationError,
    YodevAdsConfig,
    normalize_customer_id,
    normalize_profile_key,
)


def test_normalize_customer_id_accepts_google_format() -> None:
    assert normalize_customer_id("449-439-2373") == "4494392373"


@pytest.mark.parametrize("value", ["", "123", "abcdefghij", "12345678901"])
def test_normalize_customer_id_rejects_invalid_values(value: str) -> None:
    with pytest.raises(ConfigurationError):
        normalize_customer_id(value)


def test_normalize_profile_key() -> None:
    assert normalize_profile_key("Mail Certificate") == "mail-certificate"


def test_config_round_trip(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json")
    profile = ClientProfile(
        key="mail-certificate",
        name="Mail Certificate",
        customer_id="4494392373",
        manager_id="1234567890",
    )
    store.save(
        YodevAdsConfig(
            brand=BrandSettings(
                product_name="Campaign Desk",
                tagline="One calm place for every account.",
                logo="◇",
                accent="magenta",
                locale="en-GB",
            ),
            default_manager_id="1234567890",
            default_profile=profile.key,
            profiles={profile.key: profile},
        )
    )

    loaded = store.load()

    assert loaded.default_profile == "mail-certificate"
    assert loaded.schema_version == 3
    assert loaded.brand.product_name == "Campaign Desk"
    assert loaded.brand.accent == "magenta"
    assert loaded.profile().customer_id == "4494392373"
    assert loaded.manager_id_for(loaded.profile()) == "1234567890"


def test_brand_rejects_unsafe_accent() -> None:
    with pytest.raises(ConfigurationError):
        BrandSettings(accent="blink on red").validate()


def test_v1_config_is_migrated_with_default_brand(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(
        '{"default_manager_id":"1234567890","profiles":{}}',
        encoding="utf-8",
    )

    config = ConfigStore(path).load()

    assert config.schema_version == 3
    assert config.brand.product_name == "Ads by Yodev"


def test_custom_product_name_is_preserved() -> None:
    config = YodevAdsConfig.from_dict({"brand": {"product_name": "Campaign Desk"}, "profiles": {}})

    assert config.brand.product_name == "Campaign Desk"
