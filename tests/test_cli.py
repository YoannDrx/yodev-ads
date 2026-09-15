from typer.testing import CliRunner

from yodev_ads import cli
from yodev_ads.settings import ConfigStore


def test_setup_and_doctor_do_not_require_developer_token_or_gcloud(tmp_path, monkeypatch):
    store = ConfigStore(tmp_path / "config.json")
    monkeypatch.setattr(cli, "_store", lambda: store)
    monkeypatch.setattr(cli, "adc_status", lambda: (True, "OAuth credentials present"))
    monkeypatch.delenv("GOOGLE_ADS_DEVELOPER_TOKEN", raising=False)
    runner = CliRunner()
    result = runner.invoke(cli.app, ["setup", "--manager-id", "1234567890",
                                    "--client-id", "4494392373"], input="")
    assert result.exit_code == 0, result.output
    assert store.load().profile().customer_id == "4494392373"
    result = runner.invoke(cli.app, ["doctor"])
    assert result.exit_code == 0, result.output
    assert "Developer token" not in result.output


def test_doctor_still_requires_oauth(tmp_path, monkeypatch):
    store = ConfigStore(tmp_path / "config.json")
    monkeypatch.setattr(cli, "_store", lambda: store)
    runner = CliRunner()
    runner.invoke(cli.app, ["setup", "--manager-id", "1234567890",
                           "--client-id", "4494392373"])
    monkeypatch.setattr(cli, "adc_status", lambda: (False, "OAuth missing"))
    assert runner.invoke(cli.app, ["doctor"]).exit_code == 1
