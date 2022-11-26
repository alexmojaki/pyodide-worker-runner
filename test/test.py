import os
from datetime import datetime
from pathlib import Path

import pytest
from selenium import webdriver
from selenium.webdriver import DesiredCapabilities
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

assets_dir = Path(__file__).parent / "test_assets"
assets_dir.mkdir(exist_ok=True)

sauce_tunnel = os.environ.get("SAUCE_TUNNEL")
build = os.environ.get("BUILD_NAME", str(datetime.now()))


def get_driver(caps):
    if sauce_tunnel:
        desired_capabilities = {
            **caps,
            "sauce:options": {
                "tunnelName": sauce_tunnel,
                "build": build,
                "name": "pyodide-worker-runner",
            },
        }
        url = "https://{SAUCE_USERNAME}:{SAUCE_ACCESS_KEY}@ondemand.eu-central-1.saucelabs.com:443/wd/hub".format(
            **os.environ
        )
        driver = webdriver.Remote(
            command_executor=url,
            desired_capabilities=desired_capabilities,
        )
    else:
        options = Options()
        options.add_argument("--headless")
        options.add_argument("--disable-gpu")
        desired_capabilities = DesiredCapabilities.CHROME
        desired_capabilities["goog:loggingPrefs"] = {"browser": "ALL"}
        driver = webdriver.Chrome(
            options=options,
            desired_capabilities=desired_capabilities,
        )
    driver.implicitly_wait(45)
    return driver


def params():
    if sauce_tunnel:
        for os_name, extra_browser, os_versions in [
            ["Windows", "MicrosoftEdge", ["11", "10"]],
            ["macOS", "Safari", ["12", "11.00"]],
        ]:
            for os_version in os_versions[:1]:  # TODO use all versions
                for browser in ["Chrome", "Firefox", extra_browser]:
                    caps = dict(
                        platform=f"{os_name} {os_version}",
                        version="latest",
                        browserName=browser,
                    )
                    url = "http://localhost:8000"
                    if browser == "Safari" and os_version == "12":
                        yield caps | {"version": "15"}, url
                        url = "http://localhost:8003"
                        yield caps, url
                    else:
                        yield caps, url
    else:
        yield None, "http://localhost:8080/"


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
