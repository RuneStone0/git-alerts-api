#!/usr/bin/env python3
"""Browser and HTTP smoke for a deployed GitAlerts instance.

Contract with `run_git_alerts_tests.py` (the deploy gate):
  * called as `smoke.py --base URL [--http-only]`
  * prints `N passed, M failed` as the last line
  * exits 1 when anything fails
  * the gate requires at least 40 checks, so this file must keep breadth rather than depth

Why the shape of these checks: on 2026-11-26 the stack lost its `queue-publish` mount, nginx
answered `/factory/queue.json` with the SPA `index.html` and a 200, and nothing failed anywhere.
The factory snapshots are therefore parsed as JSON, not merely fetched, and they are checked before
the pages that render them.

Read-only: this suite issues GETs only and writes nothing.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

ROUTES = (
    "/", "/dashboard", "/programs", "/scans", "/scans/new", "/findings",
    "/queue", "/triage", "/integrations", "/settings", "/scans/1", "/programs/bitcoin",
)
SNAPSHOTS = (
    "/factory/queue.json", "/factory/review.json",
    "/factory/triage.json", "/factory/validation.json",
)
BROWSER_ROUTES = (
    ("/", "GitAlerts"),
    ("/findings", "Findings"),
    ("/queue", "Queue"),
    ("/triage", "Triage"),
    ("/programs", "Programs"),
    ("/settings", "Settings"),
)

passed: list[str] = []
failed: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    (passed if ok else failed).append(name if ok else f"{name}: {detail}")
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'' if ok else ' ' + detail}")


def get(base: str, path: str) -> tuple[int, str, bytes]:
    req = urllib.request.Request(base + path, headers={"User-Agent": "gitalerts-smoke"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.headers.get("content-type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", ""), e.read()
    except Exception as exc:  # connection refused, DNS, timeout
        return 0, "", str(exc).encode()


def http_layer(base: str) -> None:
    for route in ROUTES:
        code, ctype, body = get(base, route)
        text = body.decode("utf-8", "replace")
        check(f"{route} status 200", code == 200, f"got {code}")
        check(f"{route} html", "text/html" in ctype, ctype)
        check(f"{route} app root", '<div id="root">' in text, "no #root in the page")

    for path in SNAPSHOTS:
        code, _, body = get(base, path)
        check(f"{path} status 200", code == 200, f"got {code}")
        try:
            data = json.loads(body)
        except Exception:
            data = None
        # A 200 that parses as HTML means nginx fell back to the SPA: the exact mount failure.
        check(f"{path} is json", isinstance(data, dict), f"body starts {body[:24]!r}")
        check(f"{path} has generated_at", bool(isinstance(data, dict) and data.get("generated_at")))

    code, _, body = get(base, "/findings/?page_size=1")
    listing = None
    if code == 200:
        try:
            listing = json.loads(body)
        except Exception:
            listing = None
    check("/findings/ status 200", code == 200, f"got {code}")
    check("/findings/ is paginated", isinstance(listing, dict) and "results" in listing)
    rows = (listing or {}).get("results") or []
    check("/findings/ has a count", isinstance(listing, dict) and isinstance(listing.get("count"), int))
    check("/findings/ list hides the secret", bool(rows) and "value" not in rows[0],
          "list row carries value")
    if rows:
        fid = rows[0]["id"]
        code, _, body = get(base, f"/findings/{fid}/")
        detail = json.loads(body) if code == 200 else {}
        check("/findings/{id}/ carries the secret", "value" in detail, f"got {code}")
        check("/findings/{id}/ carries the claim fields",
              all(k in detail for k in ("human_verdict", "human_reason", "human_at")),
              sorted(detail)[:6].__str__())

    code, _, body = get(base, "/scans/?page_size=1")
    check("/scans/ status 200", code == 200, f"got {code}")
    check("/scans/ returns rows", b"results" in body or body.strip().startswith(b"["))

    code, _, body = get(base, "/programs/")
    check("/programs/ status 200", code == 200, f"got {code}")
    check("/programs/ returns a bare list", code == 200 and body.strip().startswith(b"["),
          body[:24].decode("utf-8", "replace"))

    code, _, _ = get(base, "/integrations/")
    check("/integrations/ status 200", code == 200, f"got {code}")

    # GET on the token endpoint must not mint anything.
    code, _, _ = get(base, "/api/token/")
    check("/api/token/ refuses GET", code == 405, f"got {code}")


def browser_layer(base: str) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        check("playwright importable", False, str(exc))
        return
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            for route, marker in BROWSER_ROUTES:
                page.goto(base + route, wait_until="load", timeout=25000)
                try:
                    page.wait_for_selector("nav", timeout=15000)
                    shell = True
                except Exception:
                    shell = False
                text = page.inner_text("body") if shell else ""
                check(f"{route} renders the shell", shell and len(text) > 200, f"{len(text)} chars")
                check(f"{route} shows {marker!r}", marker.lower() in text.lower(), text[:60])
                if route == "/queue":
                    # The incident this file exists for: the page said the snapshot was unreadable.
                    check("/queue is not reporting an unreadable snapshot",
                          "unreadable" not in text.lower(), text[:120])
            browser.close()
    except Exception as exc:
        check("browser layer ran", False, f"{type(exc).__name__}: {exc}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://192.168.1.66:8020")
    ap.add_argument("--http-only", action="store_true")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    print(f"smoke: {base}")
    http_layer(base)
    if not args.http_only:
        browser_layer(base)

    print(f"\n{len(passed)} passed, {len(failed)} failed")
    for line in failed:
        print(f"  - {line}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
