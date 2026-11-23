"""Browser smoke test. Run after tools/build.py, or pass --url to test Pages."""

import argparse
import functools
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def exercise(url):
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width, height in [(1440, 900), (390, 844)]:
            page = browser.new_page(viewport={"width": width, "height": height})
            errors = []
            page.on("pageerror", lambda exc: errors.append(str(exc)))
            start = perf_counter()
            page.goto(url)
            page.wait_for_selector(".song")
            load = perf_counter() - start
            print(
                width,
                "initial matrix:",
                round(load, 2),
                "s",
                page.locator("#count").inner_text(),
            )
            initial_values = page.locator(".cell.released,.cell.first")
            assert initial_values.count() and initial_values.locator("i").count() == 0
            assert all(not text.startswith(("+", "＋", "◇")) for text in initial_values.all_text_contents())
            viewport = page.locator("#viewport")
            initial = page.locator(".song").first.bounding_box()["x"]
            viewport.evaluate("(v)=>v.scrollLeft=650")
            page.wait_for_timeout(100)
            assert abs(page.locator(".song").first.bounding_box()["x"] - initial) < 2
            viewport.evaluate("(v)=>v.scrollTop=70000")
            page.wait_for_timeout(150)
            assert page.locator(".cell").count() < 1400
            assert (
                page.locator("#head").bounding_box()["y"]
                >= viewport.bounding_box()["y"] - 2
            )
            viewport.evaluate("(v)=>{v.scrollLeft=0;v.scrollTop=0}")
            page.wait_for_timeout(80)
            page.locator("#q").fill("World Vanquisher")
            page.wait_for_function(
                "document.querySelector('.song strong')?.textContent==='World Vanquisher'"
            )
            assert page.locator(".song").count() > 0
            page.locator(".song").first.click()
            page.wait_for_selector("#events .event")
            assert page.locator(".mini tbody tr").count() == 22
            page.keyboard.press("Escape")
            page.wait_for_function("!document.querySelector('dialog').open")
            page.wait_for_timeout(400)
            page.locator("#q").fill("xyzzynothing")
            assert page.locator(".empty").is_visible()
            page.locator("#q").fill("")
            page.locator('#diff [data-d="WE"]').click()
            assert "★" in page.locator("#body").inner_text()
            page.locator("#filters").click()
            page.locator("#reset").click()
            page.locator("#ver").select_option("20")
            assert page.locator(".vhead").count() == 1
            page.locator("#ver").select_option("0")
            page.locator("#q").fill("情熱大陸")
            page.locator('#diff [data-d="EXP"]').click()
            page.locator("#min").fill("8.3")
            page.locator("#max").fill("8.3")
            assert page.locator(".cell").first.inner_text() == "8.3"
            page.locator("#reset").click()
            page.locator("#min").fill("14")
            page.locator("#max").fill("15")
            assert page.locator(".cell").count() > 0
            page.locator("#compare").click()
            assert page.locator(".vhead").count() == 2
            page.locator("#from").select_option("4")
            page.locator("#to").select_option("4")
            page.locator("#change").select_option("restored")
            assert page.locator(".empty").is_visible()
            page.locator("#change").select_option("up")
            page.locator("#reset").click()
            page.locator("#compare").click()
            page.locator("#filters").click()
            page.locator("#guide").click()
            assert page.locator(".guide").is_visible()
            page.locator(".close").click()
            page.wait_for_timeout(500)
            page.evaluate("window.scrollTo(0,0)")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            assert not errors, errors
            out = ROOT / "test-results"
            out.mkdir(exist_ok=True)
            page.screenshot(path=str(out / f"{width}.png"))
            page.close()
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url")
    args = parser.parse_args()
    if args.url:
        exercise(args.url)
    else:
        with ThreadingHTTPServer(
            ("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "dist"))
        ) as server:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                exercise(f"http://127.0.0.1:{server.server_port}/")
            finally:
                server.shutdown()
