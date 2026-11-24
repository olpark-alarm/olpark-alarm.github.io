#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""문화공공데이터광장(KCISA) 오픈API 원본 수집 — 한국체육산업개발(주) 데이터 2종.

    python -I fetch_api.py <저장폴더> [perf|cpm|all]

- perf : 올림픽공원 공연정보   https://api.kcisa.kr/openapi/service/rest/meta/KSCperf
- cpm  : 2025 차량입출차·공연·날씨 연계 데이터  https://api.kcisa.kr/openapi/API_CPM_009/request
- 인증키(API마다 따로 발급)는 DPAPI 저장소(`tools/secret_key.py set kcisa_perf` · `set kcisa_cpm`)에서만 읽고, **화면·파일·로그에 쓰지 않는다**
  (오류 메시지에서도 가린다). 운영(GitHub Actions)에서는 환경변수 KCISA_KEY_PERF·KCISA_KEY_CPM(저장소 비밀값)으로 받는다.
- 호출 간격 3.5초, 한 번 실행에 API당 최대 20쪽. 받은 응답은 원본 그대로 저장(가공은 build_data.py).
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

APIS = {
    "perf": "https://api.kcisa.kr/openapi/service/rest/meta/KSCperf",
    "cpm": "https://api.kcisa.kr/openapi/API_CPM_009/request",
}
ROWS = 1000
MAX_PAGES = 20
GAP = 3.5


def get_key(name: str) -> str:
    """API마다 서비스키가 따로 발급된다(문화공공데이터광장) → perf·cpm 키를 이름을 나눠 보관."""
    k = os.environ.get(f"KCISA_KEY_{name.upper()}")
    if k:
        return k.strip()
    vault = Path(__file__).resolve().parents[5]  # Contest/
    sys.path.insert(0, str(vault / "tools"))
    from secret_key import load_key
    k = load_key(f"kcisa_{name}")
    if not k:
        raise SystemExit(f"인증키 없음: Contest 폴더에서 `python -I tools/secret_key.py set kcisa_{name}` 를 먼저 실행")
    return k


def call(url: str, key: str, page: int) -> tuple[bytes, str]:
    q = urllib.parse.urlencode({"serviceKey": key, "numOfRows": ROWS, "pageNo": page})
    req = urllib.request.Request(f"{url}?{q}", headers={"User-Agent": "olpark-event-alert/1.0", "Accept": "application/json, application/xml;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read(), r.headers.get("Content-Type", "")
    except Exception as e:  # 오류 문구에 키가 섞이지 않게
        raise SystemExit("호출 실패: " + str(e).replace(key, "***").replace(urllib.parse.quote(key), "***"))


def total_count(body: bytes, ctype: str) -> int | None:
    t = body.decode("utf-8", "replace")
    m = re.search(r"<totalCount>\s*(\d+)\s*</totalCount>", t) or re.search(r'"totalCount"\s*:\s*"?(\d+)', t)
    return int(m.group(1)) if m else None


def fetch(name: str, out: Path, key: str, start: int = 1, gap: float = GAP) -> dict:
    """start쪽부터 받는다. 이미 받은 쪽 파일(같은 날짜)은 건너뛰고 개수만 센다(429 뒤 이어 받기)."""
    url = APIS[name]
    stamp = datetime.now().strftime("%Y%m%d")
    got, total, files = 0, None, []
    for page in range(1, MAX_PAGES + 1):
        done = out / f"{name}_{stamp}_p{page:02d}.xml"
        if page < start and done.exists():
            body = done.read_bytes()
            total = total if total is not None else total_count(body, "")
            got += len(re.findall(rb"<item>", body))
            continue
        if page > start:
            time.sleep(gap)
        body, ctype = call(url, key, page)
        ext = "json" if "json" in ctype or body.lstrip()[:1] in (b"{", b"[") else "xml"
        f = out / f"{name}_{stamp}_p{page:02d}.{ext}"
        f.write_bytes(body)
        files.append(f.name)
        total = total if total is not None else total_count(body, ctype)
        n = len(re.findall(rb"<item>", body)) or body.count(b'"TITLE"') or body.count(b'"title"')
        got += n
        print(f"{name} p{page}: {len(body):,}B · 항목 {n} · 누적 {got}/{total}")
        if n == 0 or total is None or got >= total:
            break
    return {"api": name, "total": total, "got": got, "files": files}


SCHED_URL = "https://www.ksponco.or.kr/olympicpark/eventInfo/eventInfoListAjax.es"


def fetch_schedule(out: Path, months: list[str]) -> dict:
    """기관 누리집 「올림픽공원 공연/행사 일정안내」가 쓰는 월별 일정(JSON, 인증 없음).
    오픈API 「올림픽공원 공연정보」에 공연 기간이 빠져 있어(2026-11 확인) 일정의 원천으로 쓴다. 월 1회 호출·간격 3.5초."""
    got = {}
    for i, ym in enumerate(months):
        if i:
            time.sleep(GAP)
        req = urllib.request.Request(SCHED_URL, data=json.dumps({"nowYM": ym, "plcCd": ""}).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json;charset=UTF-8", "User-Agent": "olpark-event-alert/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
        (out / f"sched_{ym}.json").write_bytes(body)
        n = len(json.loads(body)[0])
        got[ym] = n
        print(f"sched {ym}: {n}건")
    return got


def main() -> int:
    """python -I fetch_api.py <저장폴더> [perf|cpm|all] [시작쪽] [간격초]
       python -I fetch_api.py <저장폴더> sched 202611 202612 202701 202702"""
    if len(sys.argv) > 2 and sys.argv[2] == "sched":
        out = Path(sys.argv[1])
        out.mkdir(parents=True, exist_ok=True)
        fetch_schedule(out, sys.argv[3:])
        return 0
    out = Path(sys.argv[1])
    which = sys.argv[2] if len(sys.argv) > 2 else "all"
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    gap = float(sys.argv[4]) if len(sys.argv) > 4 else GAP
    out.mkdir(parents=True, exist_ok=True)
    res = []
    for i, name in enumerate(["perf", "cpm"] if which == "all" else [which]):
        if i:
            time.sleep(gap)
        res.append(fetch(name, out, get_key(name), start, gap))
    (out / f"_fetch_{datetime.now().strftime('%Y%m%d_%H%M')}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
