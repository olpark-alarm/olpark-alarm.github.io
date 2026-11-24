#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""올팍 공연일 알림 — 공공데이터 가공 스크립트 (v2, 2026-11-24).

    python -I build_data.py <원본폴더> <site폴더> [사이트주소]

원본폴더(첨부/데이터) 구성
    api/cpm_*_p*.xml          「2025 차량입출차·공연·날씨 연계 데이터」 API 응답(시간대별 주차대수·공연명·날씨, 7,803건)
    sched/sched_YYYYMM.json   올림픽공원 누리집 「공연/행사 일정안내」 월별 일정(공연장·기간·시간)
    입출차_20240731.csv        「올림픽공원 입출차 정보」(2024-07, 입·출차 시각) — 분 단위 교차 검증
    주차장혼잡도_20260812.csv   「주차장 혼잡도 정보」(구역별 원활/혼잡/만차 상태 변경 기록)
    잔디시설정보_20250512.csv · 월별주차현황_20251231.csv · 테니스장이용_20251231.csv · 영문공연정보_20260901.csv

핵심 계산
    1) 2025 연계 데이터의 주차대수는 달마다 단위가 다르다(4·8·9월 중앙값이 다른 달의 약 1/4).
       → 날마다 '그달 공연 없는 평일 하루 평균'으로 나눠 척도를 맞춘다.
    2) 누리집 일정으로 날짜마다 공연장 유형을 붙인다(KSPO DOME > 핸드볼경기장 > 88잔디마당 > 올림픽홀, 7일 이하 공연만).
    3) 공연장 유형 × 평일/주말·공휴일 별로 시간대마다 '공연일 ÷ 공연 없는 날' 중앙값을 구하고,
       평일 1.3배·주말 1.5배 이상인 시간대(9~23시)를 '주차 증가 참고 시간대'로 쓴다.
       (2025년 주말은 대부분 공연일이라 공연 없는 주말·공휴일 기준일이 14일뿐 → 주말 기준을 높임)
"""

import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

KST = timezone(timedelta(hours=9))
RATIO = {"weekday": 1.3, "weekend": 1.5}   # 주말은 비교 기준일(공연 없는 주말·공휴일)이 적어 오전에도 1.2~1.3배가 나옴 → 1.5배
CLASSES = {"02": "KSPO", "03": "ARENA", "06": "LAWN", "01": "HALL"}   # 영향 큰 순서
CLASS_NAME = {"KSPO": "KSPO DOME", "ARENA": "티켓링크 라이브 아레나(핸드볼경기장)", "LAWN": "88잔디마당(야외 축제)",
              "HALL": "올림픽홀", "SMALL": "소규모 공연장(우리금융아트홀·뮤즈라이브 등)"}
ORDER = ["KSPO", "ARENA", "LAWN", "HALL"]
LONG_RUN = 7   # 7일 넘게 이어지는 공연(뮤지컬 장기 공연 등)은 '공연일' 판정에서 뺀다
# 앞으로의 공휴일(주말 기준 적용) — 한국천문연구원 달력자료(월력요항) 2026·2027, 대체공휴일 포함.
# 2025년 분석은 연계 데이터의 '휴일' 값을 쓴다. 2028년분은 월력요항 발표 뒤 추가.
HOLIDAYS = {date(2026, 12, 25)} | {date(2027, m, d) for m, d in (
    (1, 1), (2, 6), (2, 7), (2, 8), (2, 9), (3, 1), (5, 1), (5, 3), (5, 5), (5, 13), (6, 6), (7, 17), (7, 19),
    (8, 15), (8, 16), (9, 14), (9, 15), (9, 16), (10, 3), (10, 4), (10, 9), (10, 11), (12, 25), (12, 27))}


def venue_class(cd: str, plc: str) -> str:
    """공연장 코드가 비었거나 낯설면 이름으로 판정."""
    if cd in CLASSES:
        return CLASSES[cd]
    t = plc.replace(" ", "")
    for keys, c in (("KSPO|체조", "KSPO"), ("핸드볼|티켓링크|아레나", "ARENA"), ("88잔디", "LAWN"), ("올림픽홀", "HALL")):
        if re.search(keys, t):
            return c
    return "SMALL"


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5 or d in HOLIDAYS


def read(d: Path, name: str) -> pd.DataFrame:
    return pd.read_csv(d / name, encoding="cp949", low_memory=False)


# ---------------------------------------------------------------- 누리집 일정
WD = "월화수목금토일"
# 요일 표시: '토 오후 6시' '(토) 18:00' '토, 일 오후 5시' '수목금 19시'. 낱말 속 글자('일자별')와 '(월 공연없음)'은 뺀다
WD_TOKEN = r"(?<![가-힣])([월화수목금토일]{1,7})(?=\s*(?:요일)?\s*(?:\)|,|\s|오전|오후|낮|저녁|\d|$))(?!\s*(?:요일)?\s*\)?\s*공연\s*없)"


def _days_from_tm(tm: str, b: date, e: date) -> list[date] | None:
    """공연 시간 글(tm)에서 실제 공연 날짜를 고른다. 날짜·요일을 못 읽으면 None(기간 전체)."""
    tm = tm or ""
    span = [b + timedelta(days=k) for k in range((e - b).days + 1)]
    # ① 명시 날짜 '12.24' '12월 18일' '2026.12.18'
    found = set()
    for m in re.finditer(r"(?:(20\d\d)[.\s년]+)?(\d{1,2})\s*[.월]\s*(\d{1,2})\s*일?", tm):
        mo, dd = int(m.group(2)), int(m.group(3))
        for d in span:
            if d.month == mo and d.day == dd:
                found.add(d)
    if found:
        return sorted(found)
    # ② 요일 '수목금 19시 / 토 15시 / 일 14시' 'FRI 7PM'
    eng = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}
    wds = set()
    for m in re.finditer(WD_TOKEN, tm):
        wds |= {WD.index(c) for c in m.group(1)}
    for k, v in eng.items():
        if re.search(rf"\b{k}", tm.upper()):
            wds.add(v)
    if "주말" in tm:
        wds |= {5, 6}
    if "평일" in tm:
        wds |= {0, 1, 2, 3, 4}
    if wds and len(span) > 2:
        sel = [d for d in span if d.weekday() in wds]
        return sel or None
    return None


_ENG = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}


def _clock(seg: str) -> list[str]:
    """글 조각에서 시각을 'HH:MM'으로. '오후 6시 30분' '19시' '6PM' '7:30PM' '18:00' '9:00:00PM'. 표시 없는 1~9시는 오후로 본다(공연)."""
    out = []
    s = seg.replace("：", ":")
    for m in re.finditer(r"(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?", s):
        h, mi = int(m.group(1)), int(m.group(2))
        ap = (m.group(3) or "").upper()
        if ap == "PM" and h < 12:
            h += 12
        out.append((h, mi))
    s2 = re.sub(r"\d{1,2}:\d{2}(?::\d{2})?\s*(AM|PM|am|pm)?", " ", s)
    for m in re.finditer(r"(\d{1,2})\s*(PM|AM|pm|am)", s2):
        h = int(m.group(1)); ap = m.group(2).upper()
        out.append((h + 12 if ap == "PM" and h < 12 else h, 0))
    s3 = re.sub(r"\d{1,2}\s*(PM|AM|pm|am)", " ", s2)
    for m in re.finditer(r"(오전|오후|낮|저녁|밤)?\s*(\d{1,2})\s*시(?!간)\s*(?:(\d{1,2})\s*분|(반))?", s3):
        h = int(m.group(2)); mi = int(m.group(3)) if m.group(3) else (30 if m.group(4) else 0)
        ap = m.group(1) or ""
        if (ap in ("오후", "저녁", "밤") or (not ap and 1 <= h <= 9)) and h < 12:
            h += 12
        out.append((h, mi))
    if not out:  # '오후 5'처럼 '시'가 빠진 원문(누리집 글 잘림)
        for m in re.finditer(r"(오전|오후|저녁)\s*(\d{1,2})(?![\d:시])", s3):
            h = int(m.group(2))
            out.append((h + 12 if m.group(1) != "오전" and h < 12 else h, 0))
    seen = []
    for h, mi in out:
        t = f"{h:02d}:{mi:02d}"
        if 0 <= h < 24 and t not in seen:
            seen.append(t)
    return sorted(seen)


def times_for_day(tm: str, d: date) -> list[str]:
    """공연 시간 글(tm)에서 그날 시작 시각만 고른다. 못 읽으면 []."""
    tm = tm or ""
    if not tm.strip():
        return []
    # ① 명시 날짜 뒤 조각
    marks = list(re.finditer(r"(?:20\d\d\s*[.년]\s*)?(\d{1,2})\s*[.월/]\s*(\d{1,2})\s*일?", tm))
    for i, m in enumerate(marks):
        if (int(m.group(1)), int(m.group(2))) == (d.month, d.day):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(tm)
            t = _clock(tm[m.end():end])
            if t:
                return t
    if marks and any((int(m.group(1)), int(m.group(2))) != (d.month, d.day) for m in marks):
        pass  # 다른 날짜만 적혀 있으면 아래 요일·단일 시각으로
    # ② 요일 표시 사이 조각: '수목금 19시 30분 / 토 15시, 19시 / 일 14시' '(토) 18:00, (일) 16:00' 'FRI 7PM'
    toks = [(m.start(), m.end(), {WD.index(c) for c in m.group(1)})
            for m in re.finditer(WD_TOKEN, tm)]
    toks += [(m.start(), m.end(), {_ENG[m.group(1).upper()]}) for m in re.finditer(r"\b(MON|TUE|WED|THU|FRI|SAT|SUN)\b", tm, re.I)]
    toks.sort()
    for i, (a, b, wds) in enumerate(toks):
        if d.weekday() in wds:
            # '토, 일 오후 5시'처럼 요일 여럿이 시각 하나를 같이 쓰면 다음 조각의 시각을 쓴다
            for j in range(i, len(toks)):
                end = toks[j + 1][0] if j + 1 < len(toks) else len(tm)
                t = _clock(tm[toks[j][1]:end])
                if t:
                    return t
                if j > i and not re.fullmatch(r"[\s,·/]*", tm[toks[j - 1][1]:toks[j][0]]):
                    break
    # ③ 시각이 하나뿐이면 매일 같은 시각
    allt = _clock(tm)
    if len(allt) == 1 and not toks and not marks:
        return allt
    if len(allt) == 1:
        return allt
    return []


def tidy_title(t: str) -> str:
    """전각 괄호·겹친 빈칸 정리 — 읽기용."""
    t = html.unescape(t or "").strip()
    t = t.replace("［", "[").replace("］", "]").replace("〈", "〈").replace("＂", '"').replace("＆", "&").replace("：", ":")
    t = re.sub(r"\[\s+", "[", t)
    t = re.sub(r"\s+\]", "]", t)
    return re.sub(r"\s{2,}", " ", t)


def load_schedule(d: Path) -> pd.DataFrame:
    rows = {}
    for f in sorted((d / "sched").glob("sched_*.json")):
        for lst in json.loads(f.read_text(encoding="utf-8")):
            for x in lst:
                rows[x["evtSeq"]] = x
    out = []
    for x in rows.values():
        try:
            b = date.fromisoformat(x["beginDt"][:10]); e = date.fromisoformat(x["endDt"][:10])
        except (ValueError, TypeError):
            continue
        cd = (x.get("plcCd") or "").strip()
        n_days = (e - b).days + 1
        cls = venue_class(cd, x.get("plc") or "") if n_days <= LONG_RUN else "SMALL"
        days = _days_from_tm(x.get("tm") or "", b, e) or [b + timedelta(days=k) for k in range(n_days)]
        link = x.get("evtLink") if x.get("evtLinkYn") == "Y" else (x.get("rsvLink") if x.get("rsvLinkYn") == "Y" else "")
        tm = re.sub(r"\s+", " ", (x.get("tm") or "").strip())
        for day in days:
            out.append({"seq": str(x["evtSeq"]), "date": day, "title": tidy_title(x["title"]),
                        "venue": re.sub(r"\s+", " ", (x.get("plc") or "").strip()), "cd": cd, "cls": cls,
                        "begin": b.isoformat(), "end": e.isoformat(), "tm": tm,
                        "time": "·".join(times_for_day(tm, day)), "url": link or ""})
    return pd.DataFrame(out).sort_values(["date", "cls", "title"])


def day_class(ev: pd.DataFrame) -> dict:
    """날짜 → 그날 가장 영향이 큰 공연장 유형."""
    out = {}
    for d, g in ev.groupby("date"):
        s = set(g["cls"])
        out[d] = next((o for o in ORDER if o in s), "SMALL")
    return out


def display_class(ev: pd.DataFrame, model: dict) -> dict:
    """화면·구독용: 그날 공연장 중 같은 요일유형의 2025년 최고 배율이 가장 큰 곳(모델 없는 공연장은 뒤로)."""
    out = {}
    for d, g in ev.groupby("date"):
        key = "weekend" if is_weekend(d) else "weekday"
        cands = [c for c in set(g["cls"]) if c != "SMALL"]
        if not cands:
            out[d] = "SMALL"; continue
        out[d] = max(cands, key=lambda c: ((model.get(c) or {}).get(key) or {}).get("peak_r") or 0)
    return out


# ---------------------------------------------------------------- 2025 연계 데이터
def load_cpm(d: Path) -> pd.DataFrame:
    rows = []
    for f in sorted((d / "api").glob("cpm_*_p*.xml")):
        for it in ET.parse(f).getroot().iter("item"):
            g = {c.tag: (c.text or "") for c in it}
            kv = dict((k.strip(), v.strip()) for k, v in re.findall(r"([^,:]+):\s*([^,]*)", g["DESCRIPTION"]))
            rows.append({"ts": g["ISSUED_DATE"], "park": kv.get("주차대수"), "hol": kv.get("휴일", ""), "title": g["TITLE"]})
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], errors="coerce")
    df["park"] = pd.to_numeric(df["park"], errors="coerce")
    return df.dropna(subset=["ts", "park"]).sort_values("ts").drop_duplicates("ts")


def cpm_model(cpm: pd.DataFrame, dcls: dict, drop_months: tuple = ()) -> dict:
    df = cpm.copy()
    if drop_months:
        df = df[~df["ts"].dt.month.isin(drop_months)]
    raw_rows, raw_days = len(df), df["ts"].dt.date.nunique()
    df["d"] = df["ts"].dt.date
    df["h"] = df["ts"].dt.hour
    df["m"] = df["ts"].dt.to_period("M").astype(str)
    df["wk"] = (df["ts"].dt.dayofweek >= 5) | (df["hol"].str.len() > 0)
    cnt = df.groupby("d").size()
    df = df[df["d"].isin(set(cnt[cnt >= 22].index))]          # 하루 22시간 이상 기록된 날만
    df["cls"] = df["d"].map(lambda d: dcls.get(d, "NONE"))
    small_only = df[df["cls"] == "SMALL"].groupby("wk")["d"].nunique()
    df.loc[df["cls"] == "SMALL", "cls"] = "NONE"                 # 소규모·장기 공연만 있는 날 = 평소
    daily = df.groupby(["d", "m", "wk", "cls"])["park"].mean().reset_index()
    scale = daily[(daily["cls"] == "NONE") & (~daily["wk"])].groupby("m")["park"].median()
    df["z"] = df["park"] / df["m"].map(scale)
    df = df.dropna(subset=["z"])
    normal = df[df["cls"] == "NONE"].groupby(["wk", "h"])["z"].median()
    nd = df[df["cls"] == "NONE"].groupby("wk")["d"].nunique()
    ad = df.groupby("wk")["d"].nunique()                          # 분석한 평일·주말 일수(분모)
    base_we = sorted(set(df[(df["cls"] == "NONE") & df["wk"]]["d"]))
    model = {}
    for c in ORDER:
        for wk, key in ((False, "weekday"), (True, "weekend")):
            x = df[(df["cls"] == c) & (df["wk"] == wk)]
            if x["d"].nunique() == 0:
                continue
            r = x.assign(r=[z / normal[(wk, h)] for z, h in zip(x["z"], x["h"])])
            ratio = r.groupby("h")["r"].median().reindex(range(24)).round(2)
            thr = RATIO[key]
            hours = [h for h in range(24) if ratio[h] >= thr and 9 <= h <= 23]
            pk = r[(r["h"] >= 12) & (r["h"] <= 22)].groupby("d")["r"].max()
            ent = {"days": int(x["d"].nunique()), "ratio": [None if pd.isna(v) else float(v) for v in ratio.values],
                   "share_up": round(float((pk >= thr).mean()), 2), "threshold": thr}
            if hours:
                h0, h1 = min(hours), max(hours)
                ph = max(hours, key=lambda h: ratio[h])
                ent.update({"from": f"{h0:02d}:00", "to": f"{min(h1 + 1, 24):02d}:00", "peak_h": ph, "peak_r": float(ratio[ph])})
            model.setdefault(c, {})[key] = ent
    return {
        "model": model,
        "normal_days": {"weekday": int(nd.get(False, 0)), "weekend": int(nd.get(True, 0))},
        "analysed_days": {"weekday": int(ad.get(False, 0)), "weekend": int(ad.get(True, 0))},
        # 공연 없는 주말·공휴일 기준일의 구성: 실제 토·일 수와 소규모·장기 공연만 있던 날 수(한계 공개용)
        "baseline_weekend": {"days": len(base_we), "sat_sun": sum(1 for d in base_we if d.weekday() >= 5),
                             "dates": [str(d) for d in base_we]},
        "small_only_as_normal": {"weekday": int(small_only.get(False, 0)), "weekend": int(small_only.get(True, 0))},
        "rows": raw_rows, "days": raw_days, "days_used": int(df["d"].nunique()),
        "span": [str(cpm["ts"].min().date()), str(cpm["ts"].max().date())],
        "scale_by_month": {k: int(v) for k, v in scale.items()},
        "event_days": {c: int(df[df["cls"] == c]["d"].nunique()) for c in ORDER},
    }


# ---------------------------------------------------------------- 2024-07 교차 검증(분 단위)
def check_2024(d: Path, ev: pd.DataFrame) -> dict:
    """2024년 7월 분 단위 파일 — 누리집 실제 일정(공연장)으로 공연일을 붙여 저녁 최대 주차를 본다."""
    df = read(d, "입출차_20240731.csv")
    df.columns = ["day", "tin", "tout"]
    df["tin"] = pd.to_datetime(df["tin"]); df["tout"] = pd.to_datetime(df["tout"])
    dur = (df["tout"] - df["tin"]).dt.total_seconds() / 60
    x = df[(dur > 10) & (dur <= 24 * 60)]
    grid = pd.date_range("2024-07-01", "2024-08-01", freq="30min", inclusive="left")
    occ = pd.Series(np.searchsorted(np.sort(x["tin"].values), grid.values, side="right")
                    - np.searchsorted(np.sort(x["tout"].values), grid.values, side="right"), index=grid)
    aft = occ.between_time("14:00", "22:00")
    peak = aft.groupby(aft.index.date).max()
    at = aft.groupby(aft.index.date).idxmax()
    jul = ev[(ev["date"] >= date(2024, 7, 1)) & (ev["date"] <= date(2024, 7, 31))]
    dcls = day_class(jul)
    days = []
    for dd in sorted(peak.index):
        c = dcls.get(dd, "NONE")
        days.append({"date": str(dd), "wk": pd.Timestamp(dd).dayofweek >= 5, "cls": c, "peak": int(peak[dd]), "at": at[dd].strftime("%H:%M")})
    wd_none = [x["peak"] for x in days if not x["wk"] and x["cls"] in ("NONE", "SMALL")]
    base = float(np.median(wd_none))
    wkend = [x for x in days if x["wk"]]
    return {"rows": int(len(df)), "rows_used": int(len(x)), "capacity": 2200,
            "max_occ": int(occ.max()), "max_at": str(occ.idxmax()),
            "weekday_none_peak_median": int(base),
            "weekday_event": [dict(x, x_base=round(x["peak"] / base, 2)) for x in days if not x["wk"] and x["cls"] not in ("NONE", "SMALL")],
            "weekend_days": len(wkend), "weekend_event_days": sum(x["cls"] not in ("NONE", "SMALL") for x in wkend),
            "weekend": [x for x in wkend]}


# ---------------------------------------------------------------- 구역별 만차 기록 비중
def zones(d: Path) -> dict:
    cg = read(d, "주차장혼잡도_20260812.csv").rename(columns={"주차구역": "zone", "혼잡도": "level", "등록일": "date"})
    cg["date"] = pd.to_datetime(cg["date"], errors="coerce")
    res = {z: {"records": int(len(g)), "full_share": round(float((g["level"] == "만차").mean()), 3)} for z, g in cg.groupby("zone")}
    return {"span": [str(cg["date"].min().date()), str(cg["date"].max().date())], "records": int(len(cg)),
            "weekend_share": round(float((cg["date"].dt.dayofweek >= 5).mean()), 2), "zones": res}


def lawn(d: Path) -> list[dict]:
    lw = read(d, "잔디시설정보_20250512.csv").drop_duplicates(subset=["장소", "개방내용"])
    return [{"place": r["장소"], "kind": r["개방시간"], "rule": r["개방내용"]} for _, r in lw.iterrows()]


def stats(d: Path) -> dict:
    mp = read(d, "월별주차현황_20251231.csv")
    mp["주차대수"] = pd.to_numeric(mp["주차대수"], errors="coerce")
    tn = read(d, "테니스장이용_20251231.csv")
    tn["연도"] = pd.to_datetime(tn["시작일"]).dt.year
    return {"monthly_parking_by_place_year": mp.groupby(["연도", "주차장소"])["주차대수"].sum().unstack().to_dict(),
            "tennis_users_by_year": tn.groupby(["연도", "구분"])["이용자수"].sum().unstack().fillna(0).astype(int).to_dict()}


def eng_file_quality(d: Path) -> dict:
    ev = read(d, "영문공연정보_20260901.csv")
    dt = pd.to_datetime(ev["공연일자"], errors="coerce")
    per_day = dt.value_counts()
    return {"rows": int(len(ev)), "max_same_day": int(per_day.max()), "max_same_day_date": str(per_day.idxmax().date()),
            "monday_share": round(float((dt.dt.dayofweek == 0).mean()), 2)}


def perf_api_quality(d: Path) -> dict:
    items = []
    for f in sorted((d / "api").glob("perf_*_p*.xml")):
        items += [{c.tag: (c.text or "") for c in it} for it in ET.parse(f).getroot().iter("item")]
    if not items:
        return {}
    years = []
    for it in items:
        ys = re.findall(r"(20\d\d)[.\-/년]\s*\d{1,2}[.\-/월]", it.get("title", "") + " " + html.unescape(it.get("description", "")))
        if ys:
            years.append(max(map(int, ys)))
    return {"rows": len(items), "has_period_field": any(k in items[0] for k in ("period", "eventPeriod")),
            "reg_dates": sorted({it.get("regDate", "")[:10] for it in items})[:3], "latest_year_in_text": max(years) if years else None}


# ---------------------------------------------------------------- ICS
def ics_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def fold(line: str) -> str:
    out, cur = [], b""
    for ch in line:
        e = ch.encode("utf-8")
        if len(cur) + len(e) > 73:
            out.append(cur.decode("utf-8")); cur = b""
        cur += e
    out.append(cur.decode("utf-8"))
    return "\r\n ".join(out)


def window_of(model: dict, cls: str, d: date) -> dict:
    key = "weekend" if is_weekend(d) else "weekday"
    return (model.get(cls) or {}).get(key) or {}


def write_ics(path: Path, days: list, by_day: dict, dcls: dict, model: dict, stamp: str, site_url: str, name: str):
    L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//olpark-event-alert//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
         "X-WR-CALNAME:" + name, "X-WR-TIMEZONE:Asia/Seoul", "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H"]
    for d in days:
        evs = by_day[d]
        cls = dcls.get(d, "SMALL")
        w = window_of(model, cls, d)
        lines = [f"· {e['title']} ({e['venue']}{', ' + e['tm'] if e['tm'] else ''})" for e in evs]
        hint = (f"주차 증가 참고 시간대 {w['from']}~{w['to']} (2025년 {CLASS_NAME[cls]} 공연일 {w['days']}일 기준, "
                f"{w['peak_h']}시 평소의 {w['peak_r']}배)") if w.get("from") else "소규모·장기 공연: 주차 영향 분석 제외"
        desc = "\n".join(lines + [hint, "대중교통: 5·9호선 올림픽공원역", "예상 이용률: https://www.ksponco.or.kr/online/main/parking.do", site_url])
        summary = ("올팍 공연일" + (f" {w['from']}~{w['to']}" if w.get("from") else "") + ": " + evs[0]["title"]
                   + (f" 외 {len(evs) - 1}건" if len(evs) > 1 else ""))
        L += ["BEGIN:VEVENT", f"UID:olpark-{d.strftime('%Y%m%d')}@olpark-event-alert", f"DTSTAMP:{stamp}",
              f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{(d + timedelta(days=1)).strftime('%Y%m%d')}",
              fold("SUMMARY:" + ics_escape(summary)), fold("DESCRIPTION:" + ics_escape(desc)), "TRANSP:TRANSPARENT",
              "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:내일 올림픽공원 공연일", "TRIGGER:-PT6H", "END:VALARM", "END:VEVENT"]
    L.append("END:VCALENDAR")
    path.write_text("\r\n".join(L) + "\r\n", encoding="utf-8")


# ---------------------------------------------------------------- main
def main() -> int:
    src, site = Path(sys.argv[1]), Path(sys.argv[2])
    site_url = sys.argv[3] if len(sys.argv) > 3 else ""
    (site / "data").mkdir(parents=True, exist_ok=True)
    (site / "feeds").mkdir(parents=True, exist_ok=True)
    now = datetime.now(KST)

    ev = load_schedule(src)
    dcls = day_class(ev)
    cm = cpm_model(load_cpm(src), dcls)
    model = cm["model"]
    zn = zones(src)

    # 화면용 공연 목록: 오늘 기준 60일 전 ~ 일정이 있는 끝까지
    cut = now.date() - timedelta(days=60)
    show = ev[ev["date"] >= cut]
    events = [{"date": r.date.isoformat(), "seq": r.seq, "title": r.title, "venue": r.venue, "cls": r.cls,
               "begin": r.begin, "end": r.end, "tm": r.tm, "time": r.time, "url": r.url} for r in show.itertuples()]
    meta = {
        "built_at": now.strftime("%Y-%m-%d %H:%M KST"),
        "events_span": [str(show["date"].min()), str(show["date"].max())] if len(show) else [None, None],
        "events_count": int(show["seq"].nunique()),
        "sched_span": [str(ev["date"].min()), str(ev["date"].max())],
        "class_name": CLASS_NAME,
        "holidays": sorted(str(h) for h in HOLIDAYS),
        "cpm": {k: v for k, v in cm.items() if k != "model"},
        "check_2024": check_2024(src, ev),
        "sensitivity_wo_aug_sep": {c: {k: {kk: e.get(kk) for kk in ("days", "from", "to", "peak_h", "peak_r", "share_up")} for k, e in v.items()}
                                   for c, v in cpm_model(load_cpm(src), dcls, drop_months=(8, 9))["model"].items() if c in ("KSPO", "HALL")},
        "quality": {"eng_file": eng_file_quality(src), "perf_api": perf_api_quality(src)},
    }
    (site / "data" / "events.json").write_text(json.dumps(events, ensure_ascii=False), encoding="utf-8")
    (site / "data" / "pattern.json").write_text(json.dumps({"model": model, "ratio": RATIO, "normal_days": cm["normal_days"]}, ensure_ascii=False), encoding="utf-8")
    (site / "data" / "zones.json").write_text(json.dumps(zn, ensure_ascii=False), encoding="utf-8")
    (site / "data" / "lawn.json").write_text(json.dumps(lawn(src), ensure_ascii=False), encoding="utf-8")
    (site / "data" / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, default=str), encoding="utf-8")
    (site / "data" / "stats.json").write_text(json.dumps(stats(src), ensure_ascii=False, default=str), encoding="utf-8")

    # 구독 피드: 오늘 이후(+지난 30일) 공연일
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    feed = ev[ev["date"] >= now.date() - timedelta(days=30)]
    by_day = {d: g.to_dict("records") for d, g in feed.groupby("date")}
    days = sorted(by_day)
    dcls = display_class(ev, model)
    write_ics(site / "feeds" / "all.ics", days, by_day, dcls, model, stamp, site_url, "올림픽공원 공연일 알림")
    write_ics(site / "feeds" / "weekday.ics", [d for d in days if not is_weekend(d)], by_day, dcls, model, stamp, site_url, "올팍 공연일 · 평일")
    write_ics(site / "feeds" / "weekend.ics", [d for d in days if is_weekend(d)], by_day, dcls, model, stamp, site_url, "올팍 공연일 · 주말·공휴일")
    for js in range(7):
        py = (js - 1) % 7
        write_ics(site / "feeds" / f"dow-{js}.ics", [d for d in days if d.weekday() == py], by_day, dcls, model, stamp, site_url,
                  f"올팍 공연일 · {'일월화수목금토'[js]}요일")

    print(json.dumps({k: meta[k] for k in ("events_span", "events_count", "sched_span")}, ensure_ascii=False))
    print("cpm", json.dumps(meta["cpm"], ensure_ascii=False))
    for c, v in model.items():
        for k, e in v.items():
            print(f"{c:5s} {k:7s} days {e['days']:3d} up {e['share_up']:.0%} window {e.get('from')}~{e.get('to')} peak {e.get('peak_h')}h x{e.get('peak_r')}")
    print("check_2024", meta["check_2024"])
    print("quality", meta["quality"])
    print("feed days", len(days))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
