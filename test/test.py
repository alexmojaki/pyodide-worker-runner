import json
import os
from datetime import datetime
from pathlib import Path
from time import sleep

import pytest
from selenium import webdriver
from selenium.webdriver import DesiredCapabilities
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

assets_dir = Path(__file__).parent / "test_assets"
assets_dir.mkdir(exist_ok=True)

browserstack_username = os.environ.get("BROWSERSTACK_USERNAME")
browserstack_key = os.environ.get("BROWSERSTACK_ACCESS_KEY")
build = os.environ.get("BROWSERSTACK_BUILD_NAME", str(datetime.now()))
local_identifier = os.environ.get("BROWSERSTACK_LOCAL_IDENTIFIER")


def get_driver(caps):
    if browserstack_key:
        bstack = {
                "os": caps["os"],
                "osVersion": caps["os_version"],
                "projectName": "pyodide-worker-runner",
                "buildName": build,
                "local": "true",
                "networkLogs": "true",
                "consoleLogs": "verbose",
            "debug": "true",
            "seleniumLogs": "true",
            "appiumLogs": "true",
        }
        if local_identifier:
            bstack["localIdentifier"] = local_identifier
        desired_capabilities = {
            **caps,
            'bstack:options': bstack,
            "browserstack.console": "verbose",
        }
        driver = webdriver.Remote(
            command_executor=f"https://{browserstack_username}:{browserstack_key}"
            f"@hub-cloud.browserstack.com/wd/hub",
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
    if browserstack_key:
        for os_name, extra_browser, os_versions in [
            ["Windows", "Edge", ["11"]],
            ["OS X", "Safari", ["Monterey", "Big Sur"]],
        ]:
            for os_version in os_versions:
                for browser in ["Chrome", "Firefox", extra_browser]:
                    if browser in ["Safari"] and os_version == "Monterey":
                        url = "https://localhost:8002"
                        acceptSslCerts = True
                    elif browser in ["Firefox", "Safari"]:
                        url = "https://localhost:8001"
                        acceptSslCerts = True
                    else:
                        url = "http://localhost:8000"
                        acceptSslCerts = False
                    caps = dict(
                        os=os_name,
                        os_version=os_version,
                        browserName=browser,
                        acceptInsecurecerts=acceptSslCerts,
                        acceptSslCerts=acceptSslCerts,
                    )
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
        if browserstack_key:
            driver.execute_script(
                "browserstack_executor:"
                + json.dumps(
                    {
                        "action": "setSessionStatus",
                        "arguments": {"status": status},
                    }
                )
            )
            driver.quit()
        else:
            driver.save_screenshot(str(assets_dir / "screenshot.png"))
            (assets_dir / "logs.txt").write_text(
                "\n".join(entry["message"] for entry in driver.get_log("browser"))
            )
            (assets_dir / "page_source.html").write_text(driver.page_source)


def _tests(driver, url):
    driver.get(url)
    sleep(10)  # Prevent NoSuchFrameException with Safari
    elem = driver.find_element(By.ID, "result")
    text = elem.text
    print(text)
    assert "PASSED" in text
    assert "FAILED" not in text
