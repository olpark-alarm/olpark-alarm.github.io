#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""매일 1회 — 올림픽공원 누리집 공연 일정을 다시 읽어 공연 목록(events.json)과 구독 피드(feeds/*.ics)를 갱신한다.

    python update_schedule.py <site폴더> [사이트주소]

- 인증키가 필요 없다(공개 일정 페이지가 쓰는 월별 JSON). 지난달~5개월 뒤, 6회 호출·간격 3.5초.
- 2025년 배율 모델(data/pattern.json)은 build_data.py가 연 1회 만든 것을 그대로 쓴다.
- 실패하면 기존 파일을 그대로 두고 끝낸다(화면에는 마지막 갱신 시각이 남는다).
"""

import json
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_data as B          # noqa: E402
import fetch_api as F           # noqa: E402

KST = timezone(timedelta(hours=9))


def months_around(today: date, back: int = 1, ahead: int = 5) -> list[str]:
    y, m = today.year, today.month - back
    out = []
    for _ in range(back + ahead + 1):
        while m < 1:
            m += 12; y -= 1
        while m > 12:
            m -= 12; y += 1
        out.append(f"{y}{m:02d}")
        m += 1
    return out


def main() -> int:
    site = Path(sys.argv[1])
    site_url = sys.argv[2] if len(sys.argv) > 2 else ""
    now = datetime.now(KST)
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "sched").mkdir()
        try:
            F.fetch_schedule(t / "sched", months_around(now.date()))
        except Exception as e:
            print("일정 갱신 실패 — 기존 파일 유지:", e)
            return 0
        ev = B.load_schedule(t)
    if ev.empty:
        print("일정 0건 — 기존 파일 유지")
        return 0
    pat = json.loads((site / "data" / "pattern.json").read_text(encoding="utf-8"))
    model = pat["model"]
    dcls = B.display_class(ev, model)
    show = ev[ev["date"] >= now.date() - timedelta(days=60)]
    events = [{"date": r.date.isoformat(), "seq": r.seq, "title": r.title, "venue": r.venue, "cls": r.cls,
               "begin": r.begin, "end": r.end, "tm": r.tm, "time": r.time, "url": r.url} for r in show.itertuples()]
    (site / "data" / "events.json").write_text(json.dumps(events, ensure_ascii=False), encoding="utf-8")
    meta_p = site / "data" / "meta.json"
    meta = json.loads(meta_p.read_text(encoding="utf-8"))
    meta.update({"built_at": now.strftime("%Y-%m-%d %H:%M KST"),
                 "events_span": [str(show["date"].min()), str(show["date"].max())],
                 "events_count": int(show["seq"].nunique()),
                 "holidays": sorted(str(h) for h in B.HOLIDAYS)})
    meta_p.write_text(json.dumps(meta, ensure_ascii=False, default=str), encoding="utf-8")
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    feed = ev[ev["date"] >= now.date() - timedelta(days=30)]
    by_day = {d: g.to_dict("records") for d, g in feed.groupby("date")}
    days = sorted(by_day)
    B.write_ics(site / "feeds" / "all.ics", days, by_day, dcls, model, stamp, site_url, "올림픽공원 공연일 알림")
    B.write_ics(site / "feeds" / "weekday.ics", [d for d in days if not B.is_weekend(d)], by_day, dcls, model, stamp, site_url, "올팍 공연일 · 평일")
    B.write_ics(site / "feeds" / "weekend.ics", [d for d in days if B.is_weekend(d)], by_day, dcls, model, stamp, site_url, "올팍 공연일 · 주말·공휴일")
    for js in range(7):
        py = (js - 1) % 7
        B.write_ics(site / "feeds" / f"dow-{js}.ics", [d for d in days if d.weekday() == py], by_day, dcls, model, stamp, site_url,
                    f"올팍 공연일 · {'일월화수목금토'[js]}요일")
    print(f"갱신: 공연 {meta['events_count']}건 {meta['events_span']} · 피드 날짜 {len(days)}일")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
