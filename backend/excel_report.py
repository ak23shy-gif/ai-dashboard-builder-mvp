"""Build the optional GA4 multi-sheet Excel report export."""
from __future__ import annotations

import asyncio
import calendar
import io
import json
from collections import defaultdict
from datetime import date, timedelta
from types import SimpleNamespace

import xlsxwriter


NAVY = "#1F3A5F"
LEAD_EVENTS = {
    "Book valuation": {"book_valuation"},
    "Online valuation": {"ivt:new-lead"},
    "Viewing booked": {"book_viewing"},
    "Branch enquiry": {"branch_contact_form"},
}
OTHER_EVENTS = {
    "Chats": {"chat", "chats", "chat_started", "live_chat"},
    "Saved properties": {"saved_properties"},
}


def _month_key(value):
    text = str(value or "")
    digits = "".join(ch for ch in text if ch.isdigit())
    return digits[:6] if len(digits) >= 6 else text


def _month_label(value):
    key = _month_key(value)
    if len(key) == 6 and key.isdigit():
        return f"{calendar.month_abbr[int(key[4:6])]} {key[:4]}"
    return str(value or "")


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


async def _collect(connector, resource, start, end, dimensions, metrics, options=None):
    query = SimpleNamespace(
        resource=resource,
        start=start,
        end=end,
        dimensions=dimensions,
        metrics=metrics,
        options=options or {},
        incremental=False,
    )
    rows = []
    async for batch in connector.extract(query):
        rows.extend(batch)
    return rows


async def _safe_collect(label, *args, **kwargs):
    try:
        return label, await _collect(*args, **kwargs), None
    except Exception as exc:  # One incompatible optional report must not destroy the workbook.
        return label, [], f"{label}: {exc}"


def _event_value(rows, month, names, channel=None):
    return sum(
        _number(row.get("keyEvents"))
        for row in rows
        if _month_key(row.get("yearMonth")) == month
        and row.get("eventName") in names
        and (channel is None or row.get("sessionDefaultChannelGroup") == channel)
    )


def _merge_previous(current, previous, key, metric="sessions"):
    prior = {row.get(key): row.get(metric) for row in previous}
    return [{**row, "previous_sessions": prior.get(row.get(key))} for row in current]


def _property_rows(rows, property_name, multiple):
    return [{**({"Property": property_name} if multiple else {}), **row} for row in rows]


def _sort(rows, fields, reverse_metric=None):
    if reverse_metric:
        return sorted(rows, key=lambda r: (-_number(r.get(reverse_metric)), *(str(r.get(k) or "") for k in fields)))
    return sorted(rows, key=lambda r: tuple(str(r.get(k) or "") for k in fields))


async def _property_report(source, connector, start, end, multiple):
    property_name = source.get("name") or source["resource"]
    current_start = end.replace(day=1)
    previous_end = current_start - timedelta(days=1)
    previous_start = previous_end.replace(day=1)
    current_start = max(start, current_start)
    daily_start = max(start, previous_start)
    common = (connector, source["resource"])
    reports = [
        ("monthly_core", start, end, ["yearMonth"], ["sessions", "totalUsers", "newUsers", "activeUsers", "screenPageViews", "engagedSessions", "engagementRate", "bounceRate", "averageSessionDuration"]),
        ("monthly_extra", start, end, ["yearMonth"], ["userEngagementDuration", "keyEvents"]),
        ("monthly_events", start, end, ["yearMonth", "eventName"], ["keyEvents"]),
        ("monthly_channel_events", start, end, ["yearMonth", "sessionDefaultChannelGroup", "eventName"], ["keyEvents"]),
        ("channels", start, end, ["yearMonth", "sessionDefaultChannelGroup"], ["sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("devices", start, end, ["yearMonth", "deviceCategory"], ["sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("new_returning", start, end, ["yearMonth", "newVsReturning"], ["sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("landing_current", current_start, end, ["landingPagePlusQueryString"], ["sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("landing_previous", previous_start, previous_end, ["landingPagePlusQueryString"], ["sessions"]),
        ("pages", current_start, end, ["pagePath"], ["screenPageViews", "activeUsers", "userEngagementDuration", "keyEvents"]),
        ("source_current", current_start, end, ["sessionSourceMedium"], ["sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("source_previous", previous_start, previous_end, ["sessionSourceMedium"], ["sessions"]),
        ("countries", current_start, end, ["country"], ["sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("cities", current_start, end, ["city"], ["sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("demographics", current_start, end, ["userAgeBracket", "userGender"], ["sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("browsers", current_start, end, ["browser", "operatingSystem", "deviceCategory"], ["sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("events", current_start, end, ["eventName"], ["eventCount", "activeUsers", "keyEvents"]),
        ("site_search", current_start, end, ["searchTerm"], ["eventCount", "activeUsers"]),
        ("daily", daily_start, end, ["date"], ["sessions", "activeUsers", "engagedSessions", "screenPageViews", "keyEvents"]),
    ]
    semaphore = asyncio.Semaphore(4)

    async def run(report):
        label, report_start, report_end, dimensions, metrics = report
        options = {}
        if label == "site_search":
            options["filters"] = json.dumps({"dimensionFilter": {"filter": {"fieldName": "eventName", "stringFilter": {"matchType": "EXACT", "value": "view_search_results"}}}})
        async with semaphore:
            return await _safe_collect(label, *common, report_start.isoformat(), report_end.isoformat(), dimensions, metrics, options)

    results = await asyncio.gather(*(run(report) for report in reports))
    data = {label: rows for label, rows, _ in results}
    warnings = [error for _, _, error in results if error]

    monthly = { _month_key(row["yearMonth"]): dict(row) for row in data["monthly_core"] }
    for row in data["monthly_extra"]:
        monthly.setdefault(_month_key(row["yearMonth"]), {}).update(row)
    for month, row in monthly.items():
        custom = {label: _event_value(data["monthly_events"], month, names) for label, names in {**LEAD_EVENTS, **OTHER_EVENTS}.items()}
        leads = sum(custom[label] for label in LEAD_EVENTS)
        paid_leads = sum(_event_value(data["monthly_channel_events"], month, names, "Paid Search") for names in LEAD_EVENTS.values())
        row.update({
            "Month": _month_label(month),
            "Pages/session": _number(row.get("screenPageViews")) / _number(row.get("sessions")) if _number(row.get("sessions")) else None,
            "Avg engagement time per active user (s)": _number(row.get("userEngagementDuration")) / _number(row.get("activeUsers")) if _number(row.get("activeUsers")) else None,
            "Leads": leads,
            "Lead conversion rate": leads / _number(row.get("sessions")) if _number(row.get("sessions")) else None,
            **custom,
            "Phone calls (Infinity)": None,
            "Google Ads cost (£)": None,
            "Ad clicks": None,
            "Ad impressions": None,
            "Paid Search leads": paid_leads,
            "CPL (£)": None,
        })

    output = {
        "monthly": _property_rows(_sort(list(monthly.values()), ["yearMonth"]), property_name, multiple),
        "channels": _property_rows(_sort(data["channels"], ["yearMonth", "sessionDefaultChannelGroup"]), property_name, multiple),
        "devices": _property_rows(_sort(data["devices"], ["yearMonth", "deviceCategory"]), property_name, multiple),
        "new_returning": _property_rows(_sort(data["new_returning"], ["yearMonth", "newVsReturning"]), property_name, multiple),
        "landing": _property_rows(_sort(_merge_previous(data["landing_current"], data["landing_previous"], "landingPagePlusQueryString"), ["landingPagePlusQueryString"], "sessions")[:2000], property_name, multiple),
        "pages": _property_rows(_sort(data["pages"], ["pagePath"], "screenPageViews")[:2000], property_name, multiple),
        "source_medium": _property_rows(_sort(_merge_previous(data["source_current"], data["source_previous"], "sessionSourceMedium"), ["sessionSourceMedium"], "sessions"), property_name, multiple),
        "countries": _property_rows(_sort(data["countries"], ["country"], "sessions"), property_name, multiple),
        "cities": _property_rows(_sort(data["cities"], ["city"], "sessions")[:1000], property_name, multiple),
        "demographics": _property_rows(_sort(data["demographics"], ["userAgeBracket", "userGender"], "sessions"), property_name, multiple),
        "browsers": _property_rows(_sort(data["browsers"], ["browser", "operatingSystem", "deviceCategory"], "sessions"), property_name, multiple),
        "events": _property_rows(_sort(data["events"], ["eventName"], "eventCount"), property_name, multiple),
        "site_search": _property_rows(_sort(data["site_search"], ["searchTerm"], "eventCount"), property_name, multiple),
        "daily": _property_rows(_sort(data["daily"], ["date"]), property_name, multiple),
    }
    return output, warnings


async def _ads_report(sources, connector_factory, start, end):
    accounts = []
    warnings = []
    seen = set()
    seen_connections = set()
    for source in sources:
        if source["connection_id"] in seen_connections:
            continue
        seen_connections.add(source["connection_id"])
        try:
            connector = connector_factory("ads", source["connection_id"])
            discovered = await connector.discover()
        except Exception as exc:
            warnings.append(f"Google Ads discovery: {exc}")
            continue
        for account in discovered:
            canonical = account["id"].split(":")[0]
            if canonical in seen:
                continue
            seen.add(canonical)
            try:
                rows = await _collect(
                    connector,
                    account["id"],
                    start.isoformat(),
                    end.isoformat(),
                    ["segments.month", "campaign.name"],
                    ["metrics.cost_micros", "metrics.clicks", "metrics.impressions"],
                    {"ads_report": "campaign"},
                )
                accounts.append((account.get("name") or canonical, rows))
            except Exception as exc:
                warnings.append(f"Google Ads {account.get('name') or canonical}: {exc}")
    multiple_accounts = len(accounts) > 1
    campaigns = []
    monthly = defaultdict(lambda: {"cost": 0.0, "clicks": 0, "impressions": 0})
    end_month = f"{end.year:04d}{end.month:02d}"
    for account_name, rows in accounts:
        for row in rows:
            month = _month_key(row.get("segments.month"))
            cost = _number(row.get("metrics.cost_micros")) / 1_000_000
            clicks = _number(row.get("metrics.clicks"))
            impressions = _number(row.get("metrics.impressions"))
            monthly[month]["cost"] += cost
            monthly[month]["clicks"] += clicks
            monthly[month]["impressions"] += impressions
            if month == end_month:
                campaigns.append({
                    **({"Google Ads account": account_name} if multiple_accounts else {}),
                    "Campaign": row.get("campaign.name"),
                    "Cost (£)": cost,
                    "Clicks": clicks,
                    "Impressions": impressions,
                })
    return _sort(campaigns, ["Campaign"], "Cost (£)"), dict(monthly), multiple_accounts, warnings


def _sheet_specs(month_label, previous_label, multiple, multiple_ads_accounts, start_year, end_year):
    p = ["Property"] if multiple else []
    a = ["Google Ads account"] if multiple_ads_accounts else []
    return [
        (f"Monthly {start_year}-{end_year}", "monthly", p + ["Month", "Sessions", "Total users", "New users", "Active users", "Page views", "Pages/session", "Engaged sessions", "Engagement rate", "Bounce rate", "Avg session duration (s)", "Avg engagement time per active user (s)", "Key events", "Leads", "Lead conversion rate", "Book valuation", "Online valuation", "Viewing booked", "Branch enquiry", "Chats", "Saved properties", "Phone calls (Infinity)", "Google Ads cost (£)", "Ad clicks", "Ad impressions", "Paid Search leads", "CPL (£)"],
         p + ["Month", "sessions", "totalUsers", "newUsers", "activeUsers", "screenPageViews", "Pages/session", "engagedSessions", "engagementRate", "bounceRate", "averageSessionDuration", "Avg engagement time per active user (s)", "keyEvents", "Leads", "Lead conversion rate", "Book valuation", "Online valuation", "Viewing booked", "Branch enquiry", "Chats", "Saved properties", "Phone calls (Infinity)", "Google Ads cost (£)", "Ad clicks", "Ad impressions", "Paid Search leads", "CPL (£)"]),
        ("Channels monthly", "channels", p + ["Month", "Channel", "Sessions", "Users", "Engaged sessions", "Key events"], p + ["yearMonth", "sessionDefaultChannelGroup", "sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("Devices monthly", "devices", p + ["Month", "Device", "Sessions", "Users", "Engaged sessions", "Key events"], p + ["yearMonth", "deviceCategory", "sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        ("New vs returning", "new_returning", p + ["Month", "Type", "Sessions", "Users", "Engaged sessions", "Key events"], p + ["yearMonth", "newVsReturning", "sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        (f"Google Ads campaigns {month_label}", "ads", a + ["Campaign", "Cost (£)", "Clicks", "Impressions"], a + ["Campaign", "Cost (£)", "Clicks", "Impressions"]),
        (f"Landing pages {month_label}", "landing", p + ["Landing page", "Sessions", "Users", "Engaged sessions", "Key events", f"{previous_label} sessions"], p + ["landingPagePlusQueryString", "sessions", "activeUsers", "engagedSessions", "keyEvents", "previous_sessions"]),
        (f"Pages {month_label}", "pages", p + ["Page path", "Page views", "Users", "Engagement time (s)", "Avg engagement per user (s)", "Key events"], p + ["pagePath", "screenPageViews", "activeUsers", "userEngagementDuration", "average_engagement", "keyEvents"]),
        (f"Source medium {month_label}", "source_medium", p + ["Source / medium", "Sessions", "Users", "Engaged sessions", "Key events", f"{previous_label} sessions"], p + ["sessionSourceMedium", "sessions", "activeUsers", "engagedSessions", "keyEvents", "previous_sessions"]),
        (f"Countries {month_label}", "countries", p + ["Country", "Sessions", "Users", "Engaged sessions", "Key events"], p + ["country", "sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        (f"Cities {month_label}", "cities", p + ["City", "Sessions", "Users", "Engaged sessions", "Key events"], p + ["city", "sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        (f"Demographics {month_label}", "demographics", p + ["Age", "Gender", "Sessions", "Users", "Engaged sessions", "Key events"], p + ["userAgeBracket", "userGender", "sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        (f"Browsers & OS {month_label}", "browsers", p + ["Browser", "OS", "Device", "Sessions", "Users", "Engaged sessions", "Key events"], p + ["browser", "operatingSystem", "deviceCategory", "sessions", "activeUsers", "engagedSessions", "keyEvents"]),
        (f"Events {month_label}", "events", p + ["Event", "Event count", "Users", "Key events"], p + ["eventName", "eventCount", "activeUsers", "keyEvents"]),
        (f"Site search terms {month_label}", "site_search", p + ["Search term", "Events", "Users"], p + ["searchTerm", "eventCount", "activeUsers"]),
        (f"Daily {previous_label}-{month_label}", "daily", p + ["Date", "Sessions", "Users", "Engaged sessions", "Page views", "Key events"], p + ["date", "sessions", "activeUsers", "engagedSessions", "screenPageViews", "keyEvents"]),
    ]


def _prepare_rows(key, rows):
    prepared = []
    for row in rows:
        item = dict(row)
        if "yearMonth" in item:
            item["yearMonth"] = _month_label(item["yearMonth"])
        if key == "pages":
            users = _number(item.get("activeUsers"))
            item["average_engagement"] = _number(item.get("userEngagementDuration")) / users if users else None
        prepared.append(item)
    return prepared


def _write_sheet(workbook, name, headers, fields, rows, formats):
    sheet = workbook.add_worksheet(name[:31])
    sheet.freeze_panes(1, 1)
    sheet.hide_gridlines(2)
    sheet.set_row(0, 24)
    for col, header in enumerate(headers):
        sheet.write(0, col, header, formats["header"])
    for row_index, row in enumerate(rows, 1):
        for col, field in enumerate(fields):
            value = row.get(field)
            header = headers[col]
            fmt = formats["body"]
            lower = header.lower()
            if "%" in header or "rate" in lower:
                fmt = formats["percent"]
            elif "£" in header or "cost" in lower or lower.startswith("cpl"):
                fmt = formats["currency"]
            elif isinstance(value, (int, float)) and not isinstance(value, bool):
                fmt = formats["decimal"] if any(word in lower for word in ("avg", "duration", "pages/session")) else formats["integer"]
            sheet.write(row_index, col, value, fmt)
    if rows:
        sheet.autofilter(0, 0, len(rows), len(headers) - 1)
    for col, header in enumerate(headers):
        width = min(70, max(12, len(header) + 2, max((len(str(row.get(fields[col]) or "")) for row in rows[:250]), default=0) + 1))
        sheet.set_column(col, col, width)


async def build_ga4_excel_report(spec, sources, connector_factory):
    """Return (xlsx bytes, warnings) for a completed GA4 extraction job."""
    start, end = date.fromisoformat(spec["start"]), date.fromisoformat(spec["end"])
    usable_sources = [source for source in sources if source.get("status") in ("complete", "skipped")]
    if not usable_sources:
        usable_sources = sources
    multiple = len(usable_sources) > 1
    reports = []
    warnings = []
    for source in usable_sources:
        connector = connector_factory("ga4", source["connection_id"])
        report, errors = await _property_report(source, connector, start, end, multiple)
        reports.append(report)
        warnings.extend(f"{source.get('name') or source['resource']} — {error}" for error in errors)
    combined = defaultdict(list)
    for report in reports:
        for key, rows in report.items():
            combined[key].extend(rows)
    ads_rows, ads_monthly, multiple_ads_accounts, ads_warnings = await _ads_report(usable_sources, connector_factory, start, end)
    combined["ads"] = ads_rows
    warnings.extend(ads_warnings)
    if not multiple and len({row.get("Google Ads account") for row in ads_rows if row.get("Google Ads account")}) <= 1:
        for row in combined["monthly"]:
            ad_values = ads_monthly.get(_month_key(row.get("yearMonth")))
            if not ad_values:
                continue
            row["Google Ads cost (£)"] = ad_values["cost"]
            row["Ad clicks"] = ad_values["clicks"]
            row["Ad impressions"] = ad_values["impressions"]
            row["CPL (£)"] = ad_values["cost"] / _number(row.get("Paid Search leads")) if _number(row.get("Paid Search leads")) else None

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    workbook.set_properties({"title": "Google Analytics report", "subject": f"{start.isoformat()} to {end.isoformat()}", "author": "Extract"})
    formats = {
        "header": workbook.add_format({"font_name": "Arial", "font_size": 10, "bold": True, "font_color": "#FFFFFF", "bg_color": NAVY, "align": "center", "valign": "vcenter", "border": 1, "border_color": "#FFFFFF"}),
        "body": workbook.add_format({"font_name": "Arial", "font_size": 10, "valign": "vcenter"}),
        "integer": workbook.add_format({"font_name": "Arial", "font_size": 10, "num_format": "#,##0", "valign": "vcenter"}),
        "decimal": workbook.add_format({"font_name": "Arial", "font_size": 10, "num_format": "#,##0.0", "valign": "vcenter"}),
        "percent": workbook.add_format({"font_name": "Arial", "font_size": 10, "num_format": "0.00%", "valign": "vcenter"}),
        "currency": workbook.add_format({"font_name": "Arial", "font_size": 10, "num_format": "£#,##0.00", "valign": "vcenter"}),
    }
    current_label = calendar.month_abbr[end.month]
    previous = end.replace(day=1) - timedelta(days=1)
    previous_label = calendar.month_abbr[previous.month]
    for sheet_name, key, headers, fields in _sheet_specs(current_label, previous_label, multiple, multiple_ads_accounts, start.year, end.year):
        _write_sheet(workbook, sheet_name, headers, fields, _prepare_rows(key, combined[key]), formats)

    notes = [
        ["CAC", "Not available", "CRM + total marketing spend"],
        ["Email open rate / unsubscribe rate", "Not available", "Email marketing platform"],
        ["CSAT / NPS", "Not available", "Review / survey tools"],
        ["Site speed", "Not available", "PageSpeed Insights / CrUX"],
        ["Phone calls (Infinity)", "Not connected", "Connect the Infinity API separately"],
        ["Google Ads campaign cost", "Connected" if ads_rows else "Not connected", "Included from accessible Google Ads accounts" if ads_rows else "Connect or approve Google Ads access"],
    ] + [["Report section", "Unavailable", warning] for warning in warnings]
    _write_sheet(workbook, "Not in GA4", ["Metric", "Status", "Where to get it"], ["metric", "status", "source"], [{"metric": r[0], "status": r[1], "source": r[2]} for r in notes], formats)
    workbook.close()
    return output.getvalue(), warnings
