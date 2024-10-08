import os
from datetime import datetime
from pathlib import Path

import pytest
from selenium import webdriver
from selenium.webdriver.common.options import ArgOptions
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.safari.options import Options as SafariOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.common.by import By

assets_dir = Path(__file__).parent / "test_assets"
assets_dir.mkdir(exist_ok=True)

sauce_tunnel = os.environ.get("SAUCE_TUNNEL")
build = os.environ.get("BUILD_NAME", str(datetime.now()))


def get_driver(options: ArgOptions):
    if sauce_tunnel:
        options.set_capability("sauce:options", {
            "tunnelName": sauce_tunnel,
            "build": build,
            "name": "pyodide-worker-runner",
        })

        url = "https://{SAUCE_USERNAME}:{SAUCE_ACCESS_KEY}@ondemand.eu-central-1.saucelabs.com:443/wd/hub".format(
            **os.environ
        )
        driver = webdriver.Remote(
            command_executor=url,
            options=options,
        )
    else:
        options = ChromeOptions()
        options.add_argument("--headless")
        options.add_argument("--disable-gpu")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        driver = webdriver.Chrome(options=options)
    driver.implicitly_wait(60)
    return driver


def params():
    if sauce_tunnel:
        for os_name, extra_browser, os_versions in [
            ["Windows", "MicrosoftEdge", ["11", "10"]],
            ["macOS", "Safari", ["13", "12"]],
        ]:
            for os_version in os_versions:
                for browser in ["Chrome", "Firefox", extra_browser]:
                    options: ArgOptions = {
                        "Chrome": ChromeOptions,
                        "Firefox": FirefoxOptions,
                        "Safari": SafariOptions,
                        "MicrosoftEdge": EdgeOptions,
                    }[browser]()
                    options.browser_version = "latest"
                    options.platform_name = f"{os_name} {os_version}"
                    url = "http://localhost:8000"
                    yield options, url
    else:
        yield None, "http://localhost:8000/"


@pytest.mark.parametrize("caps,url", list(params()))
def test_lib(caps, url):
    driver = get_driver(caps)
    status = "passed"
    try:
        _tests(driver, url)
    except Exception:
        status = "failed"
        raise
    finally:
        if sauce_tunnel:
            driver.execute_script(f"sauce:job-result={status}")
            driver.quit()
        else:
            driver.save_screenshot(str(assets_dir / "screenshot.png"))
            (assets_dir / "logs.txt").write_text(
                "\n".join(entry["message"] for entry in driver.get_log("browser"))
            )
            (assets_dir / "page_source.html").write_text(driver.page_source)


def _tests(driver, url):
    driver.get(url)
    elem = driver.find_element(By.ID, "result")
    text = elem.text
    print(text)
    assert "PASSED" in text
    assert "FAILED" not in text
