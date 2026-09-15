from decimal import Decimal

from yodev_ads.google_api import decimal_to_micros, micros_to_decimal


def test_micros_to_decimal() -> None:
    assert micros_to_decimal(25_500_000) == Decimal("25.50")


def test_decimal_to_micros_rounds_to_nearest_micro() -> None:
    assert decimal_to_micros(Decimal("25.1234567")) == 25_123_457


def test_gateway_loads_sdk_without_developer_token(monkeypatch) -> None:
    from google.auth.credentials import AnonymousCredentials

    from yodev_ads.google_api import GoogleAdsGateway
    from yodev_ads.settings import YodevAdsConfig

    monkeypatch.setattr(
        "google.ads.googleads.oauth2.get_application_default_credentials",
        lambda: AnonymousCredentials(),
    )
    monkeypatch.delenv("GOOGLE_ADS_DEVELOPER_TOKEN", raising=False)
    gateway = GoogleAdsGateway(YodevAdsConfig(default_manager_id="1234567890"))
    assert gateway.client.developer_token is None
    assert gateway.client.login_customer_id == "1234567890"
    assert gateway._service("GoogleAdsService") is not None
