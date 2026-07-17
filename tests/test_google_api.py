from decimal import Decimal

from vigie_ads.google_api import decimal_to_micros, micros_to_decimal


def test_micros_to_decimal() -> None:
    assert micros_to_decimal(25_500_000) == Decimal("25.50")


def test_decimal_to_micros_rounds_to_nearest_micro() -> None:
    assert decimal_to_micros(Decimal("25.1234567")) == 25_123_457
