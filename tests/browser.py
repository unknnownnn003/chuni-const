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


def check_touch(page, viewport):
    session = page.context.new_cdp_session(page)
    box = viewport.bounding_box()
    x, y = round(box["x"] + 220), round(box["y"] + 130)

    def touch(kind, *points):
        session.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [
                {"x": px, "y": py, "id": i} for i, (px, py) in enumerate(points)
            ],
        })

    viewport.evaluate("v => v.scrollTo(0, 0)")
    touch("touchStart", (x, y))
    touch("touchMove", (x - 55, y - 65))
    touch("touchEnd")
    assert viewport.evaluate("v => v.scrollLeft >= 50 && v.scrollTop >= 60")
    touch("touchStart", (x - 40, y), (x + 40, y))
    touch("touchMove", (x - 60, y), (x + 60, y))
    touch("touchEnd")
    assert page.locator("#zoomReset").inner_text() == "150%"
    page.locator("#zoomReset").click()
    assert page.locator("#zoomReset").inner_text() == "100%"
    session.detach()


def exercise(url):
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width, height in [(1440, 900), (390, 844)]:
            page = browser.new_page(
                viewport={"width": width, "height": height}, has_touch=width < 760
            )
            errors = []
            history_requests = []
            page.on("request", lambda request: history_requests.append(request.url)
                    if "/data/history" in request.url else None)
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
            viewport.scroll_into_view_if_needed()
            assert viewport.evaluate("v => getComputedStyle(v).scrollbarWidth") == "none"
            assert page.locator("#sort option:checked").inner_text() == "默认排序"
            assert page.locator("#stats,#guide,#compare,#change").count() == 0
            box = page.locator(".song").first.bounding_box()
            x, y = box["x"] + 90, box["y"] + 55
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x - 65, y - 50, steps=5)
            page.mouse.up()
            assert viewport.evaluate("v => v.scrollLeft >= 60 && v.scrollTop >= 45")
            assert not page.locator("dialog").is_visible()
            if width < 760:
                check_touch(page, viewport)
            else:
                page.keyboard.down("Control")
                page.mouse.wheel(0, -120)
                page.keyboard.up("Control")
                page.wait_for_function("document.querySelector('#zoomReset').textContent !== '100%'")
                page.locator("#zoomReset").click()
            page.locator("#zoomIn").click()
            assert page.locator("#zoomReset").inner_text() == "115%"
            viewport.evaluate("v => v.scrollTo(650, 70000)")
            page.wait_for_function("document.querySelector('.block').offsetTop > 50000")
            box = viewport.bounding_box()
            assert abs(page.locator(".song").first.bounding_box()["x"] - box["x"]) < 2
            assert abs(page.locator("#head").bounding_box()["y"] - box["y"]) < 2
            pin = page.locator(".song").first.bounding_box()
            for selector in (".diffhead", ".block > .badge"):
                frozen = page.locator(selector).first.bounding_box()
                assert abs(frozen["x"] - (pin["x"] + pin["width"])) < 2
                assert frozen["x"] + frozen["width"] < box["x"] + box["width"]
            assert page.locator(".cell").count() < 1400
            page.locator("#zoomReset").click()
            viewport.evaluate("v => v.scrollTo(0, 0)")
            page.wait_for_function("document.querySelector('.block').offsetTop === 0")
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
            page.locator("#q").fill("dual")
            reunion = page.locator(".block").filter(has=page.get_by_text(
                "RE:UNION -Duo Blade Against-", exact=True
            ))
            assert reunion.locator(".badge").all_text_contents() == ["BAS", "ADV", "EXP", "MAS"]
            page.locator('#diff [data-d="EXP"]').click()
            assert reunion.locator(".badge").all_text_contents() == ["EXP"]
            page.locator('#diff [data-d=""]').click()
            page.locator("#q").fill("World Vanquisher")
            page.wait_for_function(
                "document.querySelector('.song strong')?.textContent==='World Vanquisher'"
            )
            assert page.locator(".song").count() > 0
            page.locator(".song").first.click()
            page.wait_for_selector("dialog[open] .mini")
            assert page.locator(".mini tbody tr").count() == 22
            assert page.locator("#detail > :last-child").evaluate(
                "element => element.classList.contains('mini')"
            )
            assert page.locator("#events,#eventCount,.event").count() == 0
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
            page.locator("#reset").click()
            page.locator("#filters").click()
            page.locator("#q").fill("天体観測")
            page.locator(".song").first.click()
            page.wait_for_function("document.querySelector('dialog[open] h2')?.textContent === '天体観測'")
            assert "Techno Kitchen" in page.locator(".detailmeta").first.inner_text()
            assert page.locator(".mini tbody tr").first.locator("td").first.get_attribute("title") == "Techno Kitchen"
            page.keyboard.press("Escape")
            page.wait_for_function("!document.querySelector('dialog').open")
            page.locator("#q").fill("")
            page.emulate_media(reduced_motion="reduce")
            page.locator("#q").fill("Sinfonie Nr. 9 d-moll op. 125")
            tutorials = page.locator(".block").filter(has=page.locator(".song"))
            assert tutorials.count() == 4
            for block in tutorials.all():
                values = block.locator(".cell").all_text_contents()
                assert values and set(values) == {"-"}
                block.locator(".song").click()
                page.wait_for_selector("dialog[open] .mini")
                values = page.locator("dialog .mini td").all_text_contents()
                assert values and set(values) == {"-"}
                page.keyboard.press("Escape")
                page.wait_for_function("!document.querySelector('dialog').open")
            page.locator("#q").fill("")
            page.evaluate("window.scrollTo(0,0)")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            assert not errors, errors
            assert not history_requests, history_requests
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
