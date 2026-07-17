from __future__ import annotations

from decimal import Decimal

from rich.console import Console
from rich.table import Table
from rich.theme import Theme

from vigie_ads.google_api import CampaignRow

console = Console(
    theme=Theme(
        {
            "brand": "bold cyan",
            "muted": "dim white",
            "good": "bold green",
            "warn": "bold yellow",
            "danger": "bold red",
        }
    )
)


def money(value: Decimal, currency_code: str = "EUR") -> str:
    symbol = "€" if currency_code == "EUR" else currency_code
    return f"{value:,.2f} {symbol}".replace(",", " ")


def campaign_table(
    rows: list[CampaignRow],
    *,
    currency_code: str = "EUR",
    performance: bool = False,
) -> Table:
    table = Table(header_style="brand", box=None, pad_edge=False)
    table.add_column("Campaign", style="bold")
    table.add_column("ID", style="muted")
    table.add_column("Status")
    table.add_column("Type")
    table.add_column("Budget", justify="right")
    if performance:
        table.add_column("Impr.", justify="right")
        table.add_column("Clicks", justify="right")
        table.add_column("Cost", justify="right")
        table.add_column("Conv.", justify="right")
    for row in rows:
        status_style = "good" if row.status == "ENABLED" else "warn"
        cells = [
            row.name,
            row.campaign_id,
            f"[{status_style}]{row.status}[/{status_style}]",
            row.channel_type,
            money(row.budget, currency_code),
        ]
        if performance:
            cells.extend(
                [
                    f"{row.impressions:,}",
                    f"{row.clicks:,}",
                    money(row.cost, currency_code),
                    f"{row.conversions:,.2f}",
                ]
            )
        table.add_row(*cells)
    return table
