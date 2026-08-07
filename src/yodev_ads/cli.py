from __future__ import annotations

import json
from dataclasses import asdict
from decimal import Decimal
from typing import Annotated

import typer
from rich.markup import escape
from rich.panel import Panel
from rich.table import Table

from yodev_ads.auth import (
    adc_status,
    gcloud_path,
    get_developer_token,
    run_oauth_login,
    set_developer_token,
)
from yodev_ads.google_api import GoogleAdsGateway
from yodev_ads.settings import (
    BrandSettings,
    ClientProfile,
    ConfigStore,
    ConfigurationError,
    YodevAdsConfig,
    normalize_customer_id,
    normalize_profile_key,
)
from yodev_ads.ui import campaign_table, console, money

app = typer.Typer(
    name="yads",
    help="Elegant, guarded Google Ads operations for several clients.",
    no_args_is_help=True,
    rich_markup_mode="rich",
)
auth_app = typer.Typer(help="Manage OAuth and the developer token.", no_args_is_help=True)
accounts_app = typer.Typer(help="Discover Google Ads accounts.", no_args_is_help=True)
clients_app = typer.Typer(help="Manage local client profiles.", no_args_is_help=True)
campaigns_app = typer.Typer(help="Inspect and safely change campaigns.", no_args_is_help=True)
config_app = typer.Typer(help="Inspect local Ads by Yodev configuration.", no_args_is_help=True)
brand_app = typer.Typer(
    help="Customize the product identity and white label.", no_args_is_help=True
)

app.add_typer(auth_app, name="auth")
app.add_typer(accounts_app, name="accounts")
app.add_typer(clients_app, name="clients")
app.add_typer(campaigns_app, name="campaigns")
app.add_typer(config_app, name="config")
app.add_typer(brand_app, name="brand")


def _store() -> ConfigStore:
    return ConfigStore()


def _profile(profile_key: str | None = None) -> tuple[YodevAdsConfig, ClientProfile]:
    config = _store().load()
    return config, config.profile(profile_key)


def _gateway(profile_key: str | None = None) -> tuple[GoogleAdsGateway, ClientProfile]:
    config, profile = _profile(profile_key)
    return GoogleAdsGateway(config, profile), profile


def _error(error: Exception) -> None:
    try:
        brand = _store().load().brand
    except Exception:
        brand = BrandSettings()
    console.print(
        Panel(
            escape(str(error)),
            title=escape(f"{brand.logo} {brand.product_name}"),
            border_style="danger",
        )
    )
    raise typer.Exit(1)


@app.command()
def setup(
    manager_id: Annotated[str, typer.Option(help="Google Ads MCC ID.")],
    client_id: Annotated[str, typer.Option(help="Initial advertiser customer ID.")],
    name: Annotated[str, typer.Option(help="Initial client display name.")] = "Mail Certificate",
    profile: Annotated[str, typer.Option(help="Initial profile key.")] = "mail-certificate",
    currency: Annotated[str, typer.Option(help="ISO currency code.")] = "EUR",
    product_name: Annotated[str, typer.Option(help="White-label product name.")] = "Ads by Yodev",
    tagline: Annotated[
        str, typer.Option(help="White-label tagline.")
    ] = "Google Ads, sous contrôle.",
    logo: Annotated[str, typer.Option(help="Short logo glyph or emoji.")] = "◆",
    accent: Annotated[str, typer.Option(help="Rich terminal accent color.")] = "green",
    developer_token: Annotated[
        str | None,
        typer.Option("--developer-token", help="Token; hidden when prompted if omitted."),
    ] = None,
) -> None:
    """Create the initial safe, multi-client configuration."""
    try:
        store = _store()
        config = store.load()
        manager = normalize_customer_id(manager_id)
        customer = normalize_customer_id(client_id)
        key = normalize_profile_key(profile)
        config.default_manager_id = manager
        config.default_profile = key
        config.brand = BrandSettings(
            product_name=product_name,
            tagline=tagline,
            logo=logo,
            accent=accent,
        ).validate()
        config.profiles[key] = ClientProfile(
            key=key,
            name=name.strip(),
            customer_id=customer,
            manager_id=manager,
            currency_code=currency.upper(),
        )
        store.save(config)
        token = developer_token or get_developer_token()
        if not token:
            token = typer.prompt("Developer token", hide_input=True)
        set_developer_token(token)
    except Exception as error:
        _error(error)
    console.print(
        Panel.fit(
            f"[good]Ready[/good]  {name}\n[muted]Profile[/muted] {key}\n"
            f"[muted]Customer[/muted] {customer}\n[muted]Manager[/muted] {manager}",
            title=escape(f"{config.brand.logo} {config.brand.product_name}"),
            border_style=config.brand.accent,
        )
    )


@app.command()
def doctor() -> None:
    """Check local configuration, OAuth and Google Ads prerequisites."""
    brand = _store().load().brand
    table = Table(
        title=escape(f"{brand.logo} {brand.product_name} diagnostics"),
        header_style="brand",
        box=None,
    )
    table.add_column("Check")
    table.add_column("Status")
    table.add_column("Detail")
    try:
        config = _store().load()
        config_ok = bool(config.default_manager_id and config.profiles)
        config_detail = (
            f"{len(config.profiles)} profile(s), manager {config.default_manager_id}"
            if config_ok
            else "Run `yads setup`"
        )
    except Exception as error:
        config_ok, config_detail = False, str(error)
    checks = [
        ("Configuration", config_ok, config_detail),
        ("Developer token", bool(get_developer_token()), "Keychain or environment"),
        ("gcloud", bool(gcloud_path()), gcloud_path() or "Not installed"),
    ]
    adc_ok, adc_detail = adc_status()
    checks.append(("OAuth ADC", adc_ok, adc_detail))
    for label, ok, detail in checks:
        table.add_row(label, "[good]OK[/good]" if ok else "[danger]MISSING[/danger]", detail)
    console.print(table)
    if not all(check[1] for check in checks):
        raise typer.Exit(1)


@auth_app.command("token-set")
def auth_token_set() -> None:
    """Store the Google Ads developer token in the system keychain."""
    try:
        set_developer_token(typer.prompt("Developer token", hide_input=True))
    except Exception as error:
        _error(error)
    console.print("[good]Developer token stored in the system keychain.[/good]")


@auth_app.command("login")
def auth_login(
    client_id: Annotated[str, typer.Option(help="Google OAuth desktop client ID.")],
    client_secret: Annotated[
        str | None,
        typer.Option("--client-secret", help="OAuth secret; hidden when prompted if omitted."),
    ] = None,
) -> None:
    """Create Google Cloud Application Default Credentials."""
    try:
        secret = client_secret or typer.prompt("OAuth client secret", hide_input=True)
        path = run_oauth_login(client_id, secret)
    except Exception as error:
        _error(error)
    console.print(f"[good]Google OAuth credentials are ready at {path}.[/good]")


@clients_app.command("add")
def clients_add(
    key: Annotated[str, typer.Argument(help="Short profile key.")],
    customer_id: Annotated[str, typer.Option(help="Advertiser customer ID.")],
    name: Annotated[str, typer.Option(help="Client display name.")],
    manager_id: Annotated[str | None, typer.Option(help="Optional MCC override.")] = None,
    currency: Annotated[str, typer.Option(help="ISO currency code.")] = "EUR",
) -> None:
    try:
        store = _store()
        config = store.load()
        normalized_key = normalize_profile_key(key)
        config.profiles[normalized_key] = ClientProfile(
            key=normalized_key,
            name=name.strip(),
            customer_id=normalize_customer_id(customer_id),
            manager_id=normalize_customer_id(manager_id) if manager_id else None,
            currency_code=currency.upper(),
        )
        config.default_profile = config.default_profile or normalized_key
        store.save(config)
    except Exception as error:
        _error(error)
    console.print(f"[good]Profile {normalized_key} saved.[/good]")


@clients_app.command("list")
def clients_list() -> None:
    try:
        config = _store().load()
    except Exception as error:
        _error(error)
    table = Table(header_style="brand", box=None)
    table.add_column("")
    table.add_column("Profile")
    table.add_column("Client")
    table.add_column("Customer ID")
    table.add_column("Manager ID")
    for key, profile in sorted(config.profiles.items()):
        table.add_row(
            "●" if key == config.default_profile else "",
            key,
            profile.name,
            profile.customer_id,
            profile.manager_id or config.default_manager_id or "—",
        )
    console.print(table)


@clients_app.command("use")
def clients_use(key: str) -> None:
    try:
        store = _store()
        config = store.load()
        normalized = normalize_profile_key(key)
        config.profile(normalized)
        config.default_profile = normalized
        store.save(config)
    except Exception as error:
        _error(error)
    console.print(f"[good]Active profile: {normalized}[/good]")


@accounts_app.command("list")
def accounts_list(as_json: Annotated[bool, typer.Option("--json")] = False) -> None:
    """List accounts directly accessible to the OAuth identity."""
    try:
        config = _store().load()
        gateway = GoogleAdsGateway(config)
        customer_ids = gateway.list_accessible_customers()
    except Exception as error:
        _error(error)
    if as_json:
        typer.echo(json.dumps(customer_ids, indent=2))
        return
    table = Table(
        title=escape(f"{config.brand.product_name} · accessible Google Ads accounts"),
        header_style="brand",
        box=None,
    )
    table.add_column("Customer ID")
    for customer_id in customer_ids:
        table.add_row(customer_id)
    console.print(table)


@campaigns_app.command("list")
def campaigns_list(
    profile: Annotated[str | None, typer.Option()] = None,
    as_json: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """List non-removed campaigns for a client profile."""
    try:
        gateway, selected = _gateway(profile)
        rows = gateway.list_campaigns(selected.customer_id)
    except Exception as error:
        _error(error)
    if as_json:
        typer.echo(json.dumps([asdict(row) for row in rows], default=str, indent=2))
        return
    console.print(campaign_table(rows, currency_code=selected.currency_code))


def _confirmed_apply(apply: bool, yes: bool) -> bool:
    if apply and not yes:
        raise ConfigurationError("Production changes require both --apply and --yes.")
    return apply and yes


@campaigns_app.command("status")
def campaigns_status(
    campaign_id: Annotated[str, typer.Argument(help="Campaign ID.")],
    status: Annotated[str, typer.Argument(help="enabled or paused.")],
    profile: Annotated[str | None, typer.Option()] = None,
    apply: Annotated[bool, typer.Option(help="Execute instead of validate-only.")] = False,
    yes: Annotated[bool, typer.Option(help="Confirm the production mutation.")] = False,
) -> None:
    """Validate or apply a campaign status update."""
    normalized_status = status.upper()
    if normalized_status not in {"ENABLED", "PAUSED"}:
        _error(ConfigurationError("Status must be enabled or paused."))
    try:
        should_apply = _confirmed_apply(apply, yes)
        gateway, selected = _gateway(profile)
        gateway.set_campaign_status(
            selected.customer_id,
            campaign_id,
            normalized_status,
            apply=should_apply,
        )
    except Exception as error:
        _error(error)
    verb = "Applied" if should_apply else "Validated only"
    style = "good" if should_apply else "warn"
    console.print(f"[{style}]{verb}:[/{style}] campaign {campaign_id} → {normalized_status}")


@campaigns_app.command("budget")
def campaigns_budget(
    campaign_id: Annotated[str, typer.Argument(help="Campaign ID.")],
    daily_amount: Annotated[str, typer.Argument(help="Daily amount in the profile currency.")],
    profile: Annotated[str | None, typer.Option()] = None,
    apply: Annotated[bool, typer.Option(help="Execute instead of validate-only.")] = False,
    yes: Annotated[bool, typer.Option(help="Confirm the production mutation.")] = False,
) -> None:
    """Validate or apply a daily campaign-budget update."""
    try:
        amount = Decimal(daily_amount)
        if amount <= 0:
            raise ConfigurationError("Budget must be greater than zero.")
        should_apply = _confirmed_apply(apply, yes)
        gateway, selected = _gateway(profile)
        gateway.set_campaign_budget(
            selected.customer_id,
            campaign_id,
            amount,
            apply=should_apply,
        )
    except Exception as error:
        _error(error)
    verb = "Applied" if should_apply else "Validated only"
    style = "good" if should_apply else "warn"
    console.print(
        f"[{style}]{verb}:[/{style}] campaign {campaign_id} → "
        f"{money(amount, selected.currency_code)}/day"
    )


@app.command()
def dashboard(
    profile: Annotated[str | None, typer.Option()] = None,
    days: Annotated[int, typer.Option(min=1, max=365)] = 30,
) -> None:
    """Show a compact campaign-performance cockpit."""
    try:
        config, selected = _profile(profile)
        gateway = GoogleAdsGateway(config, selected)
        rows = gateway.campaign_performance(selected.customer_id, days=days)
    except Exception as error:
        _error(error)
    cost = sum((row.cost for row in rows), Decimal("0"))
    clicks = sum(row.clicks for row in rows)
    conversions = sum((row.conversions for row in rows), Decimal("0"))
    console.print(
        Panel.fit(
            f"[brand]{selected.name}[/brand]  ·  last {days} days\n"
            f"{money(cost, selected.currency_code)} spent  ·  "
            f"{clicks:,} clicks  ·  {conversions:,.2f} conversions",
            title=escape(f"{config.brand.logo} {config.brand.product_name}"),
            border_style=config.brand.accent,
        )
    )
    console.print(campaign_table(rows, currency_code=selected.currency_code, performance=True))


@config_app.command("path")
def config_path() -> None:
    typer.echo(_store().path)


@config_app.command("show")
def config_show() -> None:
    try:
        config = _store().load()
        payload = {
            "schema_version": config.schema_version,
            "brand": asdict(config.brand),
            "default_manager_id": config.default_manager_id,
            "default_profile": config.default_profile,
            "profiles": {
                key: {
                    "name": profile.name,
                    "customer_id": profile.customer_id,
                    "manager_id": profile.manager_id,
                    "currency_code": profile.currency_code,
                }
                for key, profile in config.profiles.items()
            },
            "developer_token": "configured" if get_developer_token() else "missing",
        }
    except Exception as error:
        _error(error)
    typer.echo(json.dumps(payload, indent=2))


@brand_app.command("show")
def brand_show() -> None:
    """Show the active white-label identity."""
    try:
        brand = _store().load().brand
    except Exception as error:
        _error(error)
    typer.echo(json.dumps(asdict(brand), indent=2, ensure_ascii=False))


@brand_app.command("set")
def brand_set(
    product_name: Annotated[str | None, typer.Option(help="Product display name.")] = None,
    tagline: Annotated[str | None, typer.Option(help="Short product promise.")] = None,
    logo: Annotated[str | None, typer.Option(help="Short glyph or emoji.")] = None,
    accent: Annotated[str | None, typer.Option(help="Terminal accent color.")] = None,
    locale: Annotated[str | None, typer.Option(help="Default locale, e.g. fr-FR.")] = None,
    support_url: Annotated[str | None, typer.Option(help="Optional support URL.")] = None,
) -> None:
    """Update selected white-label fields without touching credentials."""
    try:
        store = _store()
        config = store.load()
        brand = config.brand
        if product_name is not None:
            brand.product_name = product_name
        if tagline is not None:
            brand.tagline = tagline
        if logo is not None:
            brand.logo = logo
        if accent is not None:
            brand.accent = accent
        if locale is not None:
            brand.locale = locale
        if support_url is not None:
            brand.support_url = support_url or None
        config.brand = brand.validate()
        store.save(config)
    except Exception as error:
        _error(error)
    console.print(
        Panel.fit(
            escape(config.brand.tagline),
            title=escape(f"{config.brand.logo} {config.brand.product_name}"),
            border_style=config.brand.accent,
        )
    )
