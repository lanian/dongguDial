#!/usr/bin/env python3
"""SQLite DB(User/Department 테이블) → PWA용 data/contacts.json 변환기.

Android 앱(net.donggu.contact)의 스키마를 그대로 읽어 정적 JSON 으로 export 한다.
표준 라이브러리(sqlite3)만 사용한다.

주의: 운영 DB(appdb.sqlite)는 SQLCipher 로 암호화되어 있다. 먼저 복호화한
평문 SQLite 파일을 만든 뒤 이 스크립트에 넘겨야 한다. 예)

    # SQLCipher CLI 로 복호화 (키는 운영자가 보유)
    sqlcipher appdb.sqlite \
      "PRAGMA key='<KEY>'; ATTACH DATABASE 'plain.sqlite' AS plain KEY '';
       SELECT sqlcipher_export('plain'); DETACH DATABASE plain;"

    python3 tools/export_contacts.py plain.sqlite

사용법:
    python3 tools/export_contacts.py <db파일> [-o data/contacts.json] [--include-inactive]
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import date

# 재직상태 정규화 (ContactEmploymentStatus.kt 와 동일)
CANONICAL = {"재직", "휴직", "파견", "교육", "미설정"}
LEGACY_ALIAS = {
    "재직중": "재직", "휴직중": "휴직", "파견중": "파견", "교육중": "교육",
    "미입력": "미설정", "미정": "미설정", "미지정": "미설정", "": "미설정",
}


def normalize_status(raw):
    s = (raw or "").strip()
    s = LEGACY_ALIAS.get(s, s)
    return s if s in CANONICAL else "미설정"


def table_exists(conn, name):
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=? COLLATE NOCASE",
        (name,),
    ).fetchone()
    return row is not None


def column_names(conn, table):
    return {r[1] for r in conn.execute("PRAGMA table_info(%s)" % table)}


def export_departments(conn, include_inactive):
    """Department 테이블에서 부서 목록 추출(직제: parent_id/level/sort_order). 없으면 빈 리스트."""
    if not table_exists(conn, "Department"):
        return []
    cols = column_names(conn, "Department")
    has_active = "is_active" in cols
    has_parent = "parent_id" in cols
    has_level = "level" in cols
    where = "" if include_inactive or not has_active else "WHERE is_active=1"
    rows = conn.execute(
        "SELECT _id, name, sort_order, %s, %s FROM Department %s ORDER BY sort_order, _id" % (
            "parent_id" if has_parent else "NULL",
            "level" if has_level else "0",
            where,
        )
    ).fetchall()
    return [
        {
            "id": r[0],
            "name": r[1] or "",
            "parentId": r[3] if r[3] is not None else 0,
            "level": r[4] if r[4] is not None else 0,
            "sortOrder": r[2] if r[2] is not None else 0,
        }
        for r in rows
    ]


def export_contacts(conn):
    cols = column_names(conn, "User")

    def pick(*candidates):
        """존재하는 첫 컬럼명 반환 (스키마 버전 차이 흡수)."""
        for c in candidates:
            if c in cols:
                return c
        return None

    field_map = {
        "id": pick("_id"),
        "name": pick("name"),
        "deptId": pick("dept_id"),
        "dept": pick("dept"),
        "team": pick("team"),
        "section": pick("section"),
        "position": pick("position"),
        "work": pick("work"),
        "phone": pick("phone"),
        "tel": pick("tel"),
        "birth": pick("birth"),
        "status": pick("employment_status"),
        "image": pick("image"),
        "memberSortOrder": pick("member_sort_order"),
    }
    selectable = {k: v for k, v in field_map.items() if v}
    sql = "SELECT %s FROM User ORDER BY %s" % (
        ", ".join('"%s"' % c for c in selectable.values()),
        "dept_id, member_sort_order, _id" if "dept_id" in cols else "_id",
    )

    contacts = []
    for row in conn.execute(sql):
        rec = dict(zip(selectable.keys(), row))
        name = (rec.get("name") or "").strip()
        if not name:
            continue  # 이름 없는 행(섹션 헤더/플레이스홀더) 제외
        contacts.append({
            "id": rec.get("id"),
            "name": name,
            "deptId": rec.get("deptId") or 0,
            "dept": rec.get("dept") or "",
            "team": rec.get("team") or "",
            "position": rec.get("position") or "",
            "work": rec.get("work") or "",
            "phone": rec.get("phone") or "",
            "tel": rec.get("tel") or "",
            "birth": rec.get("birth") or "",
            "status": normalize_status(rec.get("status")),
            "image": rec.get("image") or "",
            "memberSortOrder": rec.get("memberSortOrder") or 0,
        })
    return contacts


def synthesize_departments(contacts):
    """Department 테이블이 없을 때 User.dept 텍스트로 부서 목록 생성."""
    seen = {}
    order = 0
    for c in contacts:
        key = c["deptId"] or c["dept"]
        if not key or key in seen:
            continue
        order += 10
        seen[key] = {
            "id": c["deptId"] or (order // 10),
            "name": c["dept"] or "기타",
            "parentId": 0,
            "level": 0,
            "sortOrder": order,
        }
    return list(seen.values())


def main(argv=None):
    ap = argparse.ArgumentParser(description="SQLite → contacts.json 변환")
    ap.add_argument("db", help="평문 SQLite DB 파일 경로")
    here = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.normpath(os.path.join(here, "..", "data", "contacts.json"))
    ap.add_argument("-o", "--output", default=default_out, help="출력 JSON 경로")
    ap.add_argument("--include-inactive", action="store_true", help="비활성 부서도 포함")
    args = ap.parse_args(argv)

    if not os.path.exists(args.db):
        sys.exit("DB 파일을 찾을 수 없습니다: %s" % args.db)

    conn = sqlite3.connect(args.db)
    try:
        if not table_exists(conn, "User"):
            sys.exit("User 테이블이 없습니다. 복호화된 SQLite 파일인지 확인하세요.")
        contacts = export_contacts(conn)
        departments = export_departments(conn, args.include_inactive)
        if not departments:
            departments = synthesize_departments(contacts)
    finally:
        conn.close()

    payload = {
        "version": 1,
        "generatedAt": date.today().isoformat(),
        "departments": departments,
        "contacts": contacts,
    }
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("내보내기 완료: %s (부서 %d, 연락처 %d)" % (
        args.output, len(departments), len(contacts)))


if __name__ == "__main__":
    main()
