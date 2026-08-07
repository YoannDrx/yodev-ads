from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from google.ads.googleads.client import GoogleAdsClient
from google.api_core import protobuf_helpers

from yodev_ads.auth import get_developer_token
from yodev_ads.settings import ClientProfile, ConfigurationError, YodevAdsConfig


@dataclass(slots=True)
class CampaignRow:
    campaign_id: str
    name: str
    status: str
    channel_type: str
    budget: Decimal
    impressions: int = 0
    clicks: int = 0
    cost: Decimal = Decimal("0")
    conversions: Decimal = Decimal("0")


def micros_to_decimal(value: int | float | str) -> Decimal:
    return (Decimal(str(value)) / Decimal("1000000")).quantize(Decimal("0.01"))


def decimal_to_micros(value: Decimal) -> int:
    return int((value * Decimal("1000000")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


class GoogleAdsGateway:
    def __init__(self, config: YodevAdsConfig, profile: ClientProfile | None = None) -> None:
        token = get_developer_token()
        if not token:
            raise ConfigurationError(
                "Developer token missing. Run `yads auth token-set` or set "
                "GOOGLE_ADS_DEVELOPER_TOKEN."
            )
        manager_id = config.manager_id_for(profile)
        self.client = GoogleAdsClient.load_from_dict(
            {
                "developer_token": token,
                "login_customer_id": manager_id,
                "use_application_default_credentials": True,
                "use_proto_plus": True,
            }
        )

    def list_accessible_customers(self) -> list[str]:
        service = self.client.get_service("CustomerService")
        response = service.list_accessible_customers()
        return [resource_name.rsplit("/", 1)[-1] for resource_name in response.resource_names]

    def _search(self, customer_id: str, query: str) -> Iterable[Any]:
        service = self.client.get_service("GoogleAdsService")
        for batch in service.search_stream(customer_id=customer_id, query=query):
            yield from batch.results

    def list_campaigns(self, customer_id: str) -> list[CampaignRow]:
        query = """
            SELECT
              campaign.id,
              campaign.name,
              campaign.status,
              campaign.advertising_channel_type,
              campaign_budget.amount_micros
            FROM campaign
            WHERE campaign.status != 'REMOVED'
            ORDER BY campaign.name
        """
        return [
            CampaignRow(
                campaign_id=str(row.campaign.id),
                name=row.campaign.name,
                status=row.campaign.status.name,
                channel_type=row.campaign.advertising_channel_type.name,
                budget=micros_to_decimal(row.campaign_budget.amount_micros),
            )
            for row in self._search(customer_id, query)
        ]

    def campaign_performance(self, customer_id: str, days: int = 30) -> list[CampaignRow]:
        end = date.today() - timedelta(days=1)
        start = end - timedelta(days=max(days - 1, 0))
        query = f"""
            SELECT
              campaign.id,
              campaign.name,
              campaign.status,
              campaign.advertising_channel_type,
              campaign_budget.amount_micros,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions
            FROM campaign
            WHERE campaign.status != 'REMOVED'
              AND segments.date BETWEEN '{start.isoformat()}' AND '{end.isoformat()}'
            ORDER BY metrics.cost_micros DESC
        """
        return [
            CampaignRow(
                campaign_id=str(row.campaign.id),
                name=row.campaign.name,
                status=row.campaign.status.name,
                channel_type=row.campaign.advertising_channel_type.name,
                budget=micros_to_decimal(row.campaign_budget.amount_micros),
                impressions=int(row.metrics.impressions),
                clicks=int(row.metrics.clicks),
                cost=micros_to_decimal(row.metrics.cost_micros),
                conversions=Decimal(str(row.metrics.conversions)).quantize(Decimal("0.01")),
            )
            for row in self._search(customer_id, query)
        ]

    def set_campaign_status(
        self,
        customer_id: str,
        campaign_id: str,
        status: str,
        *,
        apply: bool,
    ) -> None:
        campaign_service = self.client.get_service("CampaignService")
        operation = self.client.get_type("CampaignOperation")
        campaign = operation.update
        campaign.resource_name = campaign_service.campaign_path(customer_id, campaign_id)
        campaign.status = getattr(self.client.enums.CampaignStatusEnum, status.upper())
        operation.update_mask.CopyFrom(protobuf_helpers.field_mask(None, campaign._pb))
        campaign_service.mutate_campaigns(
            customer_id=customer_id,
            operations=[operation],
            validate_only=not apply,
        )

    def set_campaign_budget(
        self,
        customer_id: str,
        campaign_id: str,
        amount: Decimal,
        *,
        apply: bool,
    ) -> None:
        query = f"""
            SELECT campaign.campaign_budget
            FROM campaign
            WHERE campaign.id = {int(campaign_id)}
            LIMIT 1
        """
        rows = list(self._search(customer_id, query))
        if not rows:
            raise ConfigurationError(f"Campaign {campaign_id} was not found.")
        budget_service = self.client.get_service("CampaignBudgetService")
        operation = self.client.get_type("CampaignBudgetOperation")
        budget = operation.update
        budget.resource_name = rows[0].campaign.campaign_budget
        budget.amount_micros = decimal_to_micros(amount)
        operation.update_mask.CopyFrom(protobuf_helpers.field_mask(None, budget._pb))
        budget_service.mutate_campaign_budgets(
            customer_id=customer_id,
            operations=[operation],
            validate_only=not apply,
        )
